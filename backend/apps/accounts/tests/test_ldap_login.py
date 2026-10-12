"""
Sign-in with AD (apps/accounts/backends.py) through the real ``POST /api/auth/login`` with django-axes switched on.

Two kinds of fake AD are used:

* ``fake_ldap``      replaces ``apps.accounts.backends.ldap_authenticate`` and plays back one ``LdapResult`` (most
                     tests: they are about what the backend, the serializer and axes make of each AD answer);
* ``fake_directory`` replaces ``Server`` / ``Connection`` inside ``apps.accounts.ldap`` so the *real* client runs
                     (circuit breaker, login-id whitelist, user-stage failures).

The rule under test (plan R13): with ``LDAP_ENABLED`` on, only AD opens the door - a local password counts for the
accounts on ``LDAP_LOCAL_ONLY_ACCOUNTS`` and for nobody else. "axes" below means the failures django-axes holds for the
account (``failures(name)``).

Every host, account, DN and password in this file is made up.
"""
from __future__ import annotations

import logging
from datetime import timedelta
from types import SimpleNamespace

import pytest
from axes.models import AccessAttempt
from django.contrib.auth import BACKEND_SESSION_KEY
from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.test import RequestFactory
from ldap3.core.exceptions import LDAPCommunicationError, LDAPSASLPrepError

from apps.accounts import backends, password_throttle
from apps.accounts import ldap as ad
from apps.accounts.backends import LDAP_BACKEND, session_auth_method
from apps.accounts.ldap import LdapResult
from apps.accounts.models import User
from apps.accounts.tests.test_auth_hardening import GOOD_PASSWORD, NEW_PASSWORD, change_password, login, post_json
from apps.accounts.tests.test_permissions import body

pytestmark = pytest.mark.django_db

AD_PASSWORD = "Ad-Pw-Zq9-unique-marker!"  # a password that must never show up in a log line
LOGIN_URL = "/api/auth/login"
USERS_URL = "/api/admin/users"
BAD_LOGIN = {"non_field_errors": ["帳號或密碼錯誤"]}
NOT_PROVISIONED = {"detail": "AD 驗證成功，但系統尚未開通此帳號，請洽品管中心", "code": "account_not_provisioned"}
UNAVAILABLE = {"detail": "目前無法連線到院內 AD 驗證服務，請稍後再試或洽資訊室", "code": "ldap_unavailable"}
LDAP_MANAGED_PASSWORD = {"detail": "您的密碼由院內 AD 管理，如需變更請洽資訊室", "code": "ldap_managed"}
LDAP_MANAGED_ACCOUNT = {"detail": "此帳號以 AD 登入，不需重設密碼；密碼問題請洽資訊室", "code": "ldap_managed"}
LOCKED_CODE = "locked"


@pytest.fixture(autouse=True)
def fast_hashing_and_pinned_lockout(settings):
    settings.PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
    settings.AXES_FAILURE_LIMIT = 5
    settings.AXES_COOLOFF_TIME = timedelta(minutes=15)


@pytest.fixture(autouse=True)
def no_seed_password_in_env(monkeypatch):
    monkeypatch.delenv("SEED_ADMIN_PASSWORD", raising=False)


# ── Helpers ──────────────────────────────────────────────────────


def ldap_on(settings, **overrides) -> dict:
    """Switch AD sign-in on with made-up connection values; ``overrides`` replace single keys."""
    conf = {
        "ENABLED": True,
        "SERVER_IP": "ad.example.test",
        "PORT": 389,
        "BIND_USER": "CN=svc-test,OU=Service,DC=example,DC=test",
        "BIND_PASS": "bind-pass-made-up",
        "BASE_DN": "DC=example,DC=test",
        "TIMEOUT": 3.0,
        "AUTO_CREATE": False,
        "DEFAULT_ROLE": "viewer",
        "LOCAL_ONLY_ACCOUNTS": frozenset(),
    }
    conf.update(overrides)
    conf["LOCAL_ONLY_ACCOUNTS"] = frozenset(name.casefold() for name in conf["LOCAL_ONLY_ACCOUNTS"])
    settings.LDAP = conf
    return conf


class FakeLdap:
    """Stands in for ``ldap.authenticate``: one configurable answer, every call recorded."""

    def __init__(self, status, account=None, attrs=None):
        self.status = status
        self.account = account
        self.attrs = attrs or {}
        self.calls: list[tuple[str, str]] = []

    def __call__(self, login_id, password, conf=None):
        self.calls.append((login_id, password))
        account = self.account if self.account is not None else (login_id if self.status == "success" else None)
        return LdapResult(self.status, account=account, attrs=dict(self.attrs))


def fake_ldap(monkeypatch, status, account=None, attrs=None) -> FakeLdap:
    fake = FakeLdap(status, account, attrs)
    monkeypatch.setattr("apps.accounts.backends.ldap_authenticate", fake)
    return fake


class FakeDirectory:
    """What the fake ``ldap3`` of ``fake_directory`` answers; ``constructed`` counts the connections made."""

    def __init__(self):
        self.entries = [directory_entry()]
        self.service_error: Exception | None = None
        self.bind_error: Exception | None = None
        self.bind_result = True
        self.constructed = 0


def directory_entry(account="T123", **overrides):
    attributes = {"sAMAccountName": [account], "sn": ["陳"], "givenName": ["小明"], "mail": ["t123@example.test"]}
    attributes.update(overrides)
    return SimpleNamespace(entry_dn=f"CN={account},OU=Staff,DC=example,DC=test", entry_attributes_as_dict=attributes)


def fake_directory(monkeypatch) -> FakeDirectory:
    directory = FakeDirectory()

    class FakeConnection:
        def __init__(self, server, **kwargs):
            directory.constructed += 1
            if kwargs.get("auto_bind") and directory.service_error is not None:
                raise directory.service_error
            self.entries = []
            self.result = {"result": 49, "description": "invalidCredentials"}

        def search(self, *args, **kwargs):
            self.entries = list(directory.entries)

        def bind(self):
            if directory.bind_error is not None:
                raise directory.bind_error
            return directory.bind_result

        def unbind(self):
            pass

    monkeypatch.setattr(ad, "Server", lambda host, **kwargs: "server")
    monkeypatch.setattr(ad, "Connection", FakeConnection)
    return directory


def failures(employee_id: str) -> int:
    """Failed logins django-axes holds for the account (it records them under the case-folded name)."""
    rows = AccessAttempt.objects.filter(username=employee_id.casefold())
    return sum(row.failures_since_start for row in rows)


def ad_login(client, employee_id: str, password: str = AD_PASSWORD):
    return login(client, employee_id, password)


@pytest.fixture
def local_user(make_user):
    """A viewer who also knows a local password (GOOD_PASSWORD) - which AD sign-in must not accept."""
    user = make_user("T123", ["viewer"], password=GOOD_PASSWORD)
    User.objects.filter(pk=user.pk).update(full_name="陳小明")
    user.refresh_from_db()
    return user


@pytest.fixture
def anon(client_for):
    return client_for()


def assert_signed_out(client):
    assert client.get("/api/auth/me").status_code == 403


# ── Row 2 / 3: AD off, nothing changes ───────────────────────────


def test_ad_off_the_local_password_signs_in_and_ad_is_never_asked(local_user, anon, monkeypatch):
    fake = fake_ldap(monkeypatch, "success")  # would let anybody in, if it were asked
    assert login(anon, "T123", "wrong-password").status_code == 400
    assert failures("T123") == 1

    resp = login(anon, "T123", GOOD_PASSWORD)

    assert resp.status_code == 200
    assert body(resp)["auth_method"] == "local"
    assert body(resp)["auth_source"] == "local"
    assert failures("T123") == 0  # a good login clears the earlier failure
    assert anon.session[BACKEND_SESSION_KEY] == "django.contrib.auth.backends.ModelBackend"
    assert fake.calls == []


def test_ad_off_a_force_logged_in_session_can_still_change_its_password(local_user, client_for):
    """Client.force_login stamps the first backend with get_user - LdapBackend - on the session. With AD off that
    must not make the session an AD one (it would be refused with 403 ldap_managed)."""
    client = client_for(local_user)
    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert body(me)["auth_method"] == "local"

    resp = change_password(client, GOOD_PASSWORD, NEW_PASSWORD)

    assert resp.status_code == 200, body(resp)
    assert client.get("/api/auth/me").status_code == 200  # the session survived the change


def test_session_auth_method_without_a_session_is_none(rf: RequestFactory):
    assert session_auth_method(rf.get("/")) is None
    assert session_auth_method(None) is None


# ── Row 4 / 5: AD accepts ────────────────────────────────────────


def test_ad_success_signs_in_the_existing_account_and_leaves_it_alone(local_user, anon, monkeypatch, settings):
    ldap_on(settings)
    fake = fake_ldap(monkeypatch, "wrong_password")
    assert ad_login(anon, "T123").status_code == 400
    assert failures("T123") == 1
    fake.status = "success"
    fake.attrs = {"sn": "王", "givenName": "大華", "mail": "ad@example.test"}  # AD disagrees about the name

    resp = ad_login(anon, "T123")

    assert resp.status_code == 200
    data = body(resp)
    assert (data["auth_method"], data["auth_source"], data["must_change_password"]) == ("ldap", "ldap", False)
    assert anon.session[BACKEND_SESSION_KEY] == LDAP_BACKEND
    assert failures("T123") == 0
    local_user.refresh_from_db()
    assert local_user.check_password(GOOD_PASSWORD)  # R9: a flag-free account keeps its local password
    assert (local_user.full_name, local_user.roles, local_user.campus) == ("陳小明", ["viewer"], None)
    assert fake.calls == [("T123", AD_PASSWORD), ("T123", AD_PASSWORD)]


def test_ad_success_clears_the_flag_voids_the_temporary_password_and_keeps_the_session(
    make_user, anon, monkeypatch, settings
):
    ldap_on(settings)
    make_user("T123", ["viewer"], password="Temp-Password-1", must_change_password=True)
    fake_ldap(monkeypatch, "success")

    resp = ad_login(anon, "T123")

    assert resp.status_code == 200
    assert body(resp)["must_change_password"] is False
    user = User.objects.get(employee_id="T123")
    assert user.must_change_password is False
    assert not user.has_usable_password()
    assert not user.check_password("Temp-Password-1")
    # The password field changed before login(): the session hash was computed from the new value.
    assert anon.get("/api/auth/me").status_code == 200
    assert anon.get("/api/v1/dashboard/").status_code == 200


# ── Row 6 / 9 / 11 / 12 / 14: AD refuses, nothing falls back to the local password ──


def test_r13_an_account_ad_does_not_know_cannot_use_its_local_password(local_user, anon, monkeypatch, settings):
    ldap_on(settings)
    fake = fake_ldap(monkeypatch, "not_found")

    resp = login(anon, "T123", GOOD_PASSWORD)

    assert resp.status_code == 400
    assert body(resp) == BAD_LOGIN
    assert failures("T123") == 1
    assert len(fake.calls) == 1
    assert_signed_out(anon)


def test_r3_a_wrong_ad_password_is_refused_even_when_it_is_the_local_password(
    local_user, anon, monkeypatch, settings
):
    ldap_on(settings)
    fake = fake_ldap(monkeypatch, "wrong_password")

    resp = login(anon, "T123", GOOD_PASSWORD)  # exactly the local password

    assert resp.status_code == 400
    assert body(resp) == BAD_LOGIN
    assert failures("T123") == 1  # ModelBackend did not run: it would have answered 200 and cleared the count
    assert len(fake.calls) == 1
    assert_signed_out(anon)


def test_ad_ambiguous_is_refused_like_a_wrong_password(local_user, anon, monkeypatch, settings):
    ldap_on(settings)
    fake_ldap(monkeypatch, "ambiguous")
    resp = login(anon, "T123", GOOD_PASSWORD)
    assert (resp.status_code, body(resp)) == (400, BAD_LOGIN)
    assert failures("T123") == 1


def test_ad_success_without_a_local_account_is_refused_as_not_provisioned(make_user, anon, monkeypatch, settings):
    ldap_on(settings)
    make_user("someone_else", ["viewer"])
    fake_ldap(monkeypatch, "success")
    before = User.objects.count()

    resp = ad_login(anon, "T555")

    assert resp.status_code == 403
    assert body(resp) == NOT_PROVISIONED
    assert failures("T555") == 1
    assert User.objects.count() == before
    assert_signed_out(anon)


def test_a_deactivated_account_is_refused_without_asking_ad(local_user, anon, monkeypatch, settings):
    ldap_on(settings)
    fake = fake_ldap(monkeypatch, "success")
    local_user.is_active = False
    local_user.save(update_fields=["is_active"])

    resp = ad_login(anon, "T123")

    assert (resp.status_code, body(resp)) == (400, BAD_LOGIN)
    assert failures("T123") == 1
    assert fake.calls == []


def test_a_login_id_with_filter_characters_never_reaches_ad(anon, monkeypatch, settings):
    ldap_on(settings)
    directory = fake_directory(monkeypatch)  # the real client: its whitelist stops the id before any connection

    resp = ad_login(anon, "a*)(uid=*")

    assert (resp.status_code, body(resp)) == (400, BAD_LOGIN)
    assert failures("a*)(uid=*") == 1
    assert directory.constructed == 0


# ── Row 7 / 8 / 10: AD cannot answer / odd answers (real client, fake ldap3) ──


def test_an_unreachable_ad_is_a_503_that_axes_does_not_count_and_the_breaker_stops_the_next_try(
    local_user, anon, monkeypatch, settings, caplog
):
    ldap_on(settings)
    directory = fake_directory(monkeypatch)
    directory.service_error = LDAPCommunicationError("socket closed")
    caplog.set_level(logging.WARNING)
    assert ad_login(anon, "T123", "wrong-one").status_code == 503  # the first ever attempt: nothing recorded
    assert failures("T123") == 0

    resp = login(anon, "T123", GOOD_PASSWORD)  # the local password is no way around an outage

    assert resp.status_code == 503
    assert body(resp) == UNAVAILABLE
    assert failures("T123") == 0
    assert ad.is_unavailable()  # row 7: the breaker was written
    assert directory.constructed == 1  # row 8: ... and the second attempt did not build a connection at all
    assert_signed_out(anon)
    assert GOOD_PASSWORD not in caplog.text and "wrong-one" not in caplog.text


def test_an_outage_keeps_the_failures_already_recorded(local_user, anon, monkeypatch, settings):
    ldap_on(settings)
    fake = fake_ldap(monkeypatch, "wrong_password")
    for _ in range(2):
        assert ad_login(anon, "T123").status_code == 400
    fake.status = "error"

    resp = ad_login(anon, "T123")

    assert (resp.status_code, body(resp)) == (503, UNAVAILABLE)
    assert failures("T123") == 2  # neither raised nor cleared


def test_an_open_breaker_answers_503_without_a_connection(local_user, anon, monkeypatch, settings):
    ldap_on(settings)
    directory = fake_directory(monkeypatch)
    ad.mark_unavailable()

    resp = ad_login(anon, "T123")

    assert (resp.status_code, body(resp)) == (503, UNAVAILABLE)
    assert directory.constructed == 0
    assert failures("T123") == 0


def test_a_user_bind_that_blows_up_is_a_wrong_password_and_does_not_open_the_breaker(
    local_user, anon, monkeypatch, settings
):
    ldap_on(settings)
    directory = fake_directory(monkeypatch)
    directory.bind_error = LDAPSASLPrepError("cannot prepare the password")

    resp = ad_login(anon, "T123")

    assert (resp.status_code, body(resp)) == (400, BAD_LOGIN)
    assert failures("T123") == 1
    assert not ad.is_unavailable()


def test_two_ad_entries_for_one_name_refuse_the_login_and_do_not_open_the_breaker(
    local_user, anon, monkeypatch, settings
):
    ldap_on(settings)
    directory = fake_directory(monkeypatch)
    directory.entries = [directory_entry(), directory_entry()]

    resp = ad_login(anon, "T123")

    assert (resp.status_code, body(resp)) == (400, BAD_LOGIN)
    assert failures("T123") == 1
    assert not ad.is_unavailable()


def test_the_real_client_end_to_end_signs_in_and_logs_no_password(local_user, anon, monkeypatch, settings, caplog):
    ldap_on(settings)
    fake_directory(monkeypatch)
    caplog.set_level(logging.INFO)

    resp = ad_login(anon, "T123")

    assert resp.status_code == 200
    assert body(resp)["auth_method"] == "ldap"
    assert AD_PASSWORD not in caplog.text


# ── Row 13 / 13b: the local-only list ────────────────────────────


def test_a_local_only_account_signs_in_with_its_local_password_and_never_asks_ad(
    make_user, anon, monkeypatch, settings
):
    ldap_on(settings, LOCAL_ONLY_ACCOUNTS={"admin"})
    make_user("admin", ["admin"], password=GOOD_PASSWORD)
    fake = fake_ldap(monkeypatch, "success")

    wrong = login(anon, "admin", "wrong-password")
    right = login(anon, "admin", GOOD_PASSWORD)

    assert wrong.status_code == 400
    assert right.status_code == 200
    assert (body(right)["auth_method"], body(right)["auth_source"]) == ("local", "local")
    assert anon.session[BACKEND_SESSION_KEY] == "django.contrib.auth.backends.ModelBackend"
    assert failures("admin") == 0  # the good login cleared the one failure
    assert fake.calls == []


def test_the_local_only_list_matches_any_spelling_and_still_never_asks_ad(make_user, anon, monkeypatch, settings):
    """``ADMIN`` is on the list (case-insensitively), so AD is not asked; the account itself is looked up the way
    ``employee_id`` always was (case sensitive), and "ADMIN" does not exist - the answer is the ordinary 400."""
    ldap_on(settings, LOCAL_ONLY_ACCOUNTS={"admin"})
    make_user("admin", ["admin"], password=GOOD_PASSWORD)
    fake = fake_ldap(monkeypatch, "success")

    resp = login(anon, "ADMIN", GOOD_PASSWORD)

    assert (resp.status_code, body(resp)) == (400, BAD_LOGIN)
    assert fake.calls == []


def test_without_a_local_only_list_even_admin_must_pass_ad(make_user, anon, monkeypatch, settings):
    ldap_on(settings)  # LOCAL_ONLY_ACCOUNTS is empty
    make_user("admin", ["admin"], password=GOOD_PASSWORD)
    fake = fake_ldap(monkeypatch, "not_found")

    resp = login(anon, "admin", GOOD_PASSWORD)

    assert (resp.status_code, body(resp)) == (400, BAD_LOGIN)
    assert failures("admin") == 1
    assert len(fake.calls) == 1


# ── Row 15 – 18: lockout ─────────────────────────────────────────


def test_five_wrong_ad_passwords_lock_the_account_and_ad_is_not_asked_again(local_user, anon, monkeypatch, settings):
    ldap_on(settings)
    fake = fake_ldap(monkeypatch, "wrong_password")
    answers = [ad_login(anon, "T123").status_code for _ in range(5)]
    assert answers == [400, 400, 400, 400, 429]
    assert failures("T123") == 5
    fake.status = "success"  # now the right password
    asked = len(fake.calls)

    sixth = ad_login(anon, "T123")

    assert sixth.status_code == 429
    assert body(sixth)["code"] == LOCKED_CODE
    assert len(fake.calls) == asked


def test_upper_and_lower_case_share_one_failure_counter(make_user, anon, monkeypatch, settings):
    ldap_on(settings)
    make_user("A123", ["viewer"])
    fake_ldap(monkeypatch, "wrong_password")

    answers = [ad_login(anon, "a123").status_code for _ in range(3)]
    answers += [ad_login(anon, "A123").status_code for _ in range(2)]

    assert answers == [400, 400, 400, 400, 429]
    attempt = AccessAttempt.objects.get()  # one record, not one per spelling
    assert (attempt.username, attempt.failures_since_start) == ("a123", 5)


def test_a_good_ad_login_in_the_other_case_clears_the_failures(make_user, anon, monkeypatch, settings):
    ldap_on(settings)
    make_user("A123", ["viewer"])
    fake = fake_ldap(monkeypatch, "wrong_password")
    for _ in range(4):
        assert ad_login(anon, "a123").status_code == 400
    fake.status = "success"
    fake.account = "A123"

    resp = ad_login(anon, "A123")

    assert resp.status_code == 200
    assert not AccessAttempt.objects.exists()


def test_a_name_that_is_not_provisioned_locks_after_five_tries_too(anon, monkeypatch, settings):
    ldap_on(settings)
    fake_ldap(monkeypatch, "success")

    statuses = [ad_login(anon, "T555").status_code for _ in range(5)]

    assert statuses == [403, 403, 403, 403, 429]


# ── Row 19: the Django admin site ────────────────────────────────


def test_admin_site_five_wrong_ad_passwords_lock_the_account(make_user, anon, monkeypatch, settings):
    ldap_on(settings)
    make_user("S1", ["admin"], is_staff=True)
    fake_ldap(monkeypatch, "wrong_password")
    form = {"username": "S1", "password": AD_PASSWORD}

    answers = [anon.post("/admin/login/", form).status_code for _ in range(5)]

    assert answers == [200, 200, 200, 200, 429]
    assert body(anon.post("/admin/login/", form))["code"] == LOCKED_CODE


def test_admin_site_signs_in_an_ad_staff_account_and_logs_the_method(
    make_user, anon, monkeypatch, settings, caplog
):
    ldap_on(settings)
    make_user("S1", ["admin"], is_staff=True)
    fake_ldap(monkeypatch, "success")
    caplog.set_level(logging.INFO)

    resp = anon.post("/admin/login/", {"username": "S1", "password": AD_PASSWORD})

    assert resp.status_code == 302
    assert anon.session[BACKEND_SESSION_KEY] == LDAP_BACKEND
    assert "login ok employee_id=S1 method=ldap" in caplog.text
    assert AD_PASSWORD not in caplog.text


def test_admin_site_with_ad_unreachable_shows_the_form_again_not_a_server_error(
    make_user, anon, monkeypatch, settings
):
    """The admin form cannot show a 503, and the local password is no fallback: a plain refusal (ldap_api_login is
    not set there, so the backend raises PermissionDenied instead of LdapUnavailable). Django counts that refusal as
    a failed login."""
    ldap_on(settings)
    make_user("S1", ["admin"], is_staff=True, password=GOOD_PASSWORD)
    fake_ldap(monkeypatch, "error")

    resp = anon.post("/admin/login/", {"username": "S1", "password": GOOD_PASSWORD})

    assert resp.status_code == 200
    assert "_auth_user_id" not in anon.session
    assert failures("S1") == 1


# ── Row 20 / 21: administering AD accounts ───────────────────────


def create_account(client, **fields):
    payload = {"employee_id": "abc", "full_name": "測試員", "roles": ["viewer"], **fields}
    return post_json(client, USERS_URL, payload)


def test_reset_password_refuses_an_ad_account_and_changes_nothing(
    local_user, accounts, client_for, settings
):
    ldap_on(settings)
    admin_client = client_for(accounts["admin"])
    before = User.objects.get(pk=local_user.pk)

    resp = post_json(admin_client, f"{USERS_URL}/{local_user.pk}/reset-password")

    assert resp.status_code == 400
    assert body(resp) == LDAP_MANAGED_ACCOUNT
    after = User.objects.get(pk=local_user.pk)
    assert (after.password, after.must_change_password) == (before.password, before.must_change_password)


def test_reset_password_still_works_for_a_local_only_account(make_user, accounts, client_for, settings):
    ldap_on(settings, LOCAL_ONLY_ACCOUNTS={"breakglass"})
    target = make_user("breakglass", ["admin"], password=GOOD_PASSWORD)

    resp = post_json(client_for(accounts["admin"]), f"{USERS_URL}/{target.pk}/reset-password")

    assert resp.status_code == 200
    assert body(resp)["temporary_password"]
    target.refresh_from_db()
    assert target.must_change_password is True


def test_creating_an_ad_account_hands_out_no_password(accounts, client_for, settings):
    ldap_on(settings)

    resp = create_account(client_for(accounts["admin"]))

    assert resp.status_code == 201, body(resp)
    assert "temporary_password" not in body(resp)
    assert body(resp)["auth_source"] == "ldap"
    user = User.objects.get(employee_id="abc")
    assert not user.has_usable_password()
    assert user.must_change_password is False


def test_creating_an_ad_account_with_a_password_is_refused(accounts, client_for, settings):
    ldap_on(settings)

    resp = create_account(client_for(accounts["admin"]), password="Some-Password-9x")

    assert resp.status_code == 400
    assert body(resp)["code"] == "ldap_managed"
    assert not User.objects.filter(employee_id="abc").exists()


def test_creating_a_local_only_account_still_gets_a_temporary_password(accounts, client_for, settings):
    ldap_on(settings, LOCAL_ONLY_ACCOUNTS={"abc"})

    resp = create_account(client_for(accounts["admin"]))

    assert resp.status_code == 201, body(resp)
    assert body(resp)["temporary_password"]
    assert body(resp)["auth_source"] == "local"
    user = User.objects.get(employee_id="abc")
    assert user.must_change_password is True
    assert user.check_password(body(resp)["temporary_password"])


def test_with_ad_off_creating_an_account_is_unchanged(accounts, client_for):
    resp = create_account(client_for(accounts["admin"]))
    assert resp.status_code == 201
    assert body(resp)["temporary_password"]
    assert body(resp)["auth_source"] == "local"


def test_an_account_name_that_differs_only_in_case_is_a_duplicate(accounts, client_for):
    admin_client = client_for(accounts["admin"])
    assert create_account(admin_client, employee_id="abc").status_code == 201

    resp = create_account(admin_client, employee_id="ABC")

    assert resp.status_code == 400
    assert "此帳號已存在（帳號不分大小寫）" in body(resp)["employee_id"]
    assert User.objects.filter(employee_id__iexact="abc").count() == 1


def test_auth_source_is_local_for_everybody_when_ad_is_off(accounts, client_for):
    rows = client_for(accounts["admin"]).get(USERS_URL).json()
    assert rows and {row["auth_source"] for row in rows} == {"local"}


def test_auth_source_marks_only_the_local_only_accounts_as_local_when_ad_is_on(
    make_user, accounts, client_for, settings
):
    ldap_on(settings, LOCAL_ONLY_ACCOUNTS={"t_viewer"})

    rows = {row["employee_id"]: row["auth_source"] for row in client_for(accounts["admin"]).get(USERS_URL).json()}

    assert rows["t_viewer"] == "local"
    assert rows["t_admin"] == "ldap"
    assert rows["t_reporter"] == "ldap"


# ── Row 22 / 23: what happens to a session that is already open ──


def test_an_ad_session_whose_flag_is_set_again_is_gated_but_cannot_change_the_password_here(
    local_user, anon, monkeypatch, settings
):
    ldap_on(settings)
    fake_ldap(monkeypatch, "success")
    assert ad_login(anon, "T123").status_code == 200
    User.objects.filter(pk=local_user.pk).update(must_change_password=True)

    gated = anon.get("/api/v1/dashboard/")
    attempt = change_password(anon, GOOD_PASSWORD, NEW_PASSWORD)
    logout = post_json(anon, "/api/auth/logout")

    assert (gated.status_code, body(gated)["code"]) == (403, "password_change_required")
    assert (attempt.status_code, body(attempt)) == (403, LDAP_MANAGED_PASSWORD)
    assert cache.get(password_throttle.cache_key(local_user)) is None  # the attempt was not counted
    assert logout.status_code == 200

    again = ad_login(anon, "T123")  # the next AD sign-in lifts the flag again
    assert again.status_code == 200
    local_user.refresh_from_db()
    assert local_user.must_change_password is False
    assert not local_user.has_usable_password()
    assert anon.get("/api/v1/dashboard/").status_code == 200


def test_switching_ad_off_turns_an_open_ad_session_into_a_local_one(local_user, anon, monkeypatch, settings):
    ldap_on(settings)
    fake_ldap(monkeypatch, "success")
    assert ad_login(anon, "T123").status_code == 200
    assert body(anon.get("/api/auth/me"))["auth_method"] == "ldap"

    ldap_on(settings, ENABLED=False)

    me = anon.get("/api/auth/me")
    assert me.status_code == 200
    assert body(me)["auth_method"] == "local"
    wrong = change_password(anon, "not-the-password", NEW_PASSWORD)
    assert wrong.status_code == 400  # it got to the password check: no ldap_managed refusal
    assert "current_password" in body(wrong)


# ── Switch-over: a local session opened while AD was off ─────────


def test_a_local_session_opened_before_ad_was_enabled_stops_working_once_ad_is_on(
    local_user, anon, monkeypatch, settings, caplog
):
    fake = fake_ldap(monkeypatch, "success")
    assert login(anon, "T123", GOOD_PASSWORD).status_code == 200  # AD off: a plain local sign-in
    assert anon.get("/api/auth/me").status_code == 200

    ldap_on(settings)  # empty local-only list: nobody keeps a local door
    with caplog.at_level(logging.INFO, logger="apps.accounts.authentication"):
        me = anon.get("/api/auth/me")

    assert (me.status_code, body(me)["code"]) == (403, "not_authenticated")
    assert "session invalidated after AD was enabled employee_id=T123" in caplog.text
    dashboard = anon.get("/api/v1/dashboard/")
    assert (dashboard.status_code, body(dashboard)["code"]) == (403, "not_authenticated")
    assert fake.calls == []  # the session is refused without asking AD
    assert BACKEND_SESSION_KEY not in anon.session  # and it was flushed, not just ignored


def test_a_local_only_account_keeps_its_local_session_when_ad_is_enabled(local_user, anon, monkeypatch, settings):
    fake = fake_ldap(monkeypatch, "success")
    assert login(anon, "T123", GOOD_PASSWORD).status_code == 200

    ldap_on(settings, LOCAL_ONLY_ACCOUNTS={"t123"})

    me = anon.get("/api/auth/me")
    assert me.status_code == 200
    assert body(me)["auth_method"] == "local"
    assert anon.get("/api/v1/dashboard/").status_code == 200
    assert fake.calls == []


def test_an_ad_session_survives_the_switch_check(local_user, anon, monkeypatch, settings):
    ldap_on(settings)
    fake_ldap(monkeypatch, "success")
    assert ad_login(anon, "T123").status_code == 200
    assert anon.session[BACKEND_SESSION_KEY] == LDAP_BACKEND

    assert anon.get("/api/auth/me").status_code == 200
    assert anon.get("/api/v1/dashboard/").status_code == 200


def test_switching_ad_on_and_off_again_leaves_a_local_session_alone_if_it_was_never_checked(
    local_user, anon, settings
):
    assert login(anon, "T123", GOOD_PASSWORD).status_code == 200
    ldap_on(settings)
    ldap_on(settings, ENABLED=False)  # switched back before the session made a single request

    assert anon.get("/api/auth/me").status_code == 200
    assert anon.get("/api/v1/dashboard/").status_code == 200


# ── Row 27: LDAP_AUTO_CREATE ─────────────────────────────────────

AD_PERSON = {"sn": "林", "givenName": "志明", "mail": "T200@example.test"}


def test_auto_create_makes_the_account_on_the_first_ad_login(anon, monkeypatch, settings):
    ldap_on(settings, AUTO_CREATE=True)
    fake = fake_ldap(monkeypatch, "success", account="T200", attrs=AD_PERSON)

    resp = ad_login(anon, "t200")  # typed in lower case; AD spells it T200

    assert resp.status_code == 200
    assert (body(resp)["employee_id"], body(resp)["auth_method"]) == ("T200", "ldap")
    user = User.objects.get(employee_id="T200")
    assert (user.full_name, user.email, user.roles, user.campus) == ("林志明", "T200@example.test", ["viewer"], None)
    assert user.must_change_password is False
    assert not user.has_usable_password()
    assert fake.calls == [("t200", AD_PASSWORD)]

    anon.post("/api/auth/logout")
    assert ad_login(anon, "t200").status_code == 200  # the second login finds the account
    assert User.objects.filter(employee_id__iexact="t200").count() == 1


def test_auto_create_uses_the_configured_default_role(anon, monkeypatch, settings):
    ldap_on(settings, AUTO_CREATE=True, DEFAULT_ROLE="reporter")
    fake_ldap(monkeypatch, "success", account="T200", attrs=AD_PERSON)
    assert ad_login(anon, "T200").status_code == 200
    assert User.objects.get(employee_id="T200").roles == ["reporter"]


def test_auto_create_never_adds_a_second_spelling_of_an_existing_name(anon, monkeypatch, settings):
    ldap_on(settings, AUTO_CREATE=True)
    User.objects.create_user(username="abc", employee_id="abc", full_name="甲", roles=["viewer"])
    User.objects.create_user(username="ABC", employee_id="ABC", full_name="乙", roles=["viewer"])
    fake_ldap(monkeypatch, "success", account="Abc", attrs=AD_PERSON)

    resp = ad_login(anon, "Abc")

    assert resp.status_code == 400  # two accounts differ only in case: nobody is picked
    assert User.objects.count() == 2
    assert failures("Abc") == 1


def test_auto_create_survives_the_race_of_two_first_logins(anon, monkeypatch, settings):
    """The account exists by the time the insert runs (a parallel first login won). The unique key refuses the
    second insert; the loser must find the winner's account and sign in, not fail and not duplicate it."""
    ldap_on(settings, AUTO_CREATE=True)
    fake_ldap(monkeypatch, "success", account="T200", attrs=AD_PERSON)
    User.objects.create_user(username="T200", employee_id="T200", full_name="林志明", roles=["viewer"])
    real_find = backends._find_local
    lookups = []

    def blind_at_first(login_id):
        lookups.append(login_id)
        # the lookup before AD and the one after it still see nothing (the winner commits later)
        return (None, False) if len(lookups) <= 2 else real_find(login_id)

    monkeypatch.setattr(backends, "_find_local", blind_at_first)

    with pytest.raises(IntegrityError), transaction.atomic():  # the premise: this very insert does collide
        User.objects.create_user(username="T200", employee_id="T200", full_name="x")
    resp = ad_login(anon, "T200")

    assert resp.status_code == 200, body(resp)
    assert User.objects.filter(employee_id__iexact="T200").count() == 1
    assert len(lookups) == 3


def test_without_auto_create_no_account_is_made(anon, monkeypatch, settings):
    ldap_on(settings)
    fake_ldap(monkeypatch, "success", account="T200", attrs=AD_PERSON)
    assert ad_login(anon, "T200").status_code == 403
    assert not User.objects.filter(employee_id__iexact="T200").exists()


# ── Row 28: /api/auth/options ────────────────────────────────────


@pytest.mark.parametrize("enabled", [False, True])
def test_options_tells_an_anonymous_caller_whether_ad_is_on(enabled, anon, settings):
    ldap_on(settings, ENABLED=enabled)

    resp = anon.get("/api/auth/options")

    assert resp.status_code == 200
    assert body(resp) == {"ldap_enabled": enabled}
    assert resp["Cache-Control"] == "no-store"


# ── Row 30: filling gaps and the name warning ────────────────────


def name_warnings(caplog) -> list[str]:
    return [r.getMessage() for r in caplog.records if r.getMessage().startswith("ad_name_mismatch employee_id=")]


def test_a_different_ad_name_is_logged_once_a_week_and_never_written(
    local_user, client_for, monkeypatch, settings, caplog
):
    ldap_on(settings)
    fake_ldap(monkeypatch, "success", attrs={"sn": "王", "givenName": "大華"})
    caplog.set_level(logging.WARNING)

    assert ad_login(client_for(), "T123").status_code == 200
    assert ad_login(client_for(), "T123").status_code == 200

    warnings = name_warnings(caplog)
    assert len(warnings) == 1
    assert "employee_id=T123" in warnings[0] and "system=陳小明" in warnings[0] and "ad=王大華" in warnings[0]
    local_user.refresh_from_db()
    assert local_user.full_name == "陳小明"


def test_a_name_that_differs_only_in_spaces_is_not_a_mismatch(local_user, anon, monkeypatch, settings, caplog):
    ldap_on(settings)
    fake_ldap(monkeypatch, "success", attrs={"sn": " 陳 ", "givenName": "小 明"})
    caplog.set_level(logging.WARNING)
    assert ad_login(anon, "T123").status_code == 200
    assert name_warnings(caplog) == []


def test_a_broken_cache_does_not_stop_the_login_or_the_name_warning(
    local_user, anon, monkeypatch, settings, caplog
):
    ldap_on(settings)
    fake_ldap(monkeypatch, "success", attrs={"sn": "王", "givenName": "大華"})

    def broken_add(*args, **kwargs):
        raise ConnectionError("cache is down")

    monkeypatch.setattr(backends, "cache", SimpleNamespace(add=broken_add))
    caplog.set_level(logging.WARNING)

    assert ad_login(anon, "T123").status_code == 200

    assert len(name_warnings(caplog)) == 1  # not de-duplicated, but not lost either
    assert "cache error" in caplog.text


def test_an_empty_email_is_filled_from_ad(local_user, anon, monkeypatch, settings):
    ldap_on(settings)
    fake_ldap(monkeypatch, "success", attrs={"mail": "t123@example.test"})
    assert ad_login(anon, "T123").status_code == 200
    local_user.refresh_from_db()
    assert local_user.email == "t123@example.test"


def test_an_email_somebody_else_already_uses_is_not_copied(local_user, make_user, anon, monkeypatch, settings):
    ldap_on(settings)
    make_user("T999", ["viewer"], email="T123@Example.test")
    fake_ldap(monkeypatch, "success", attrs={"mail": "t123@example.test"})
    assert ad_login(anon, "T123").status_code == 200
    local_user.refresh_from_db()
    assert local_user.email == ""


def test_an_existing_email_is_never_overwritten(make_user, anon, monkeypatch, settings):
    ldap_on(settings)
    make_user("T123", ["viewer"], email="mine@example.test")
    fake_ldap(monkeypatch, "success", attrs={"mail": "t123@example.test"})
    assert ad_login(anon, "T123").status_code == 200
    assert User.objects.get(employee_id="T123").email == "mine@example.test"


# ── The login-method log ─────────────────────────────────────────


def test_the_login_method_is_logged_for_ad_and_local_sign_ins_without_any_password(
    make_user, client_for, monkeypatch, settings, caplog
):
    ldap_on(settings, LOCAL_ONLY_ACCOUNTS={"admin"})
    make_user("T123", ["viewer"])
    make_user("admin", ["admin"], password=GOOD_PASSWORD)
    fake_ldap(monkeypatch, "success")
    caplog.set_level(logging.INFO)

    assert ad_login(client_for(), "T123").status_code == 200
    assert login(client_for(), "admin", GOOD_PASSWORD).status_code == 200

    assert "login ok employee_id=T123 method=ldap" in caplog.text
    assert "login ok employee_id=admin method=local" in caplog.text
    assert AD_PASSWORD not in caplog.text and GOOD_PASSWORD not in caplog.text
