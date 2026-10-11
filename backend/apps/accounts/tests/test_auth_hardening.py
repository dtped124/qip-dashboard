"""
Phase 3 tests: login lockout, password policy, forced password change, account
administration and the seed_admin command.

Lockout (django-axes)
  test_account_is_locked_after_the_failure_limit   N wrong passwords -> 429 ``locked``, then even the
                                                   right password is refused; both answers are identical
  test_reset_password_lifts_the_lockout            an administrator's reset unlocks the account
  ...                                              per-account scope, success resets, cool-off, admin site

Password gate (must_change_password)
  test_every_other_route_asks_for_the_password_change   walks every /api/ route: all say
                                                       403 ``password_change_required`` except the auth endpoints

Everything else: change-password rules, account creation / update validation, reset-password,
temporary password generation, the axes username hook and seed_admin.

Password hashing is switched to MD5 for the whole module (fast); the tests are about rules, not hashes.
"""
from __future__ import annotations

import io
import json
import logging
import os
import subprocess
import sys
from datetime import timedelta
from pathlib import Path

import pytest
from axes.models import AccessAttempt
from django.contrib.sessions.models import Session
from django.core.management import call_command
from django.core.management.base import CommandError
from django.http import HttpResponse
from django.utils import timezone

from apps.accounts import lockout, passwords
from apps.accounts.lockout import axes_username, lockout_message, unlock_account
from apps.accounts.models import User
from apps.accounts.passwords import generate_temporary_password, password_problems
from apps.accounts.permissions import require_roles
from apps.accounts.tests.test_permissions import api_routes, body, call, fill

pytestmark = pytest.mark.django_db

GOOD_PASSWORD = "correct-horse-battery-1"
NEW_PASSWORD = "Another-Fine-Pw-42"
LOGIN_URL = "/api/auth/login"
USERS_URL = "/api/admin/users"


@pytest.fixture(autouse=True)
def fast_password_hashing(settings):
    settings.PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]


@pytest.fixture(autouse=True)
def lockout_settings(settings):
    """Pin the lockout rules so the tests do not depend on the AXES_* environment variables."""
    settings.AXES_FAILURE_LIMIT = 5
    settings.AXES_COOLOFF_TIME = timedelta(minutes=15)


@pytest.fixture(autouse=True)
def no_seed_password_in_env(monkeypatch):
    monkeypatch.delenv("SEED_ADMIN_PASSWORD", raising=False)


@pytest.fixture
def member(make_user) -> User:
    """A viewer who knows GOOD_PASSWORD; may use the API."""
    return make_user("t_member", ["viewer"], password=GOOD_PASSWORD)


def post_json(client, url: str, payload: dict | None = None):
    return client.post(url, data=json.dumps(payload or {}), content_type="application/json")


def patch_json(client, url: str, payload: dict):
    return client.patch(url, data=json.dumps(payload), content_type="application/json")


def login(client, employee_id: str, password: str):
    return post_json(client, LOGIN_URL, {"employee_id": employee_id, "password": password})


def change_password(client, current: str, new: str):
    return post_json(client, "/api/auth/change-password", {"current_password": current, "new_password": new})


def reset_password(admin_client, user: User):
    return post_json(admin_client, f"{USERS_URL}/{user.pk}/reset-password")


def lock_out(client, employee_id: str, limit: int = 5):
    """Fail ``limit`` times; the last answer must already be the 429 that starts the lockout."""
    for _ in range(limit):
        resp = login(client, employee_id, "wrong-password")
    assert resp.status_code == 429
    return resp


LOCKED_BODY = {"detail": "登入失敗次數過多，請 15 分鐘後再試", "code": "locked"}


def test_the_test_passwords_satisfy_the_policy(member):
    assert password_problems(GOOD_PASSWORD, member) == []
    assert password_problems(NEW_PASSWORD, member) == []


# ── Lockout ──────────────────────────────────────────────────────


def test_account_is_locked_after_the_failure_limit(member, client_for):
    client = client_for()
    for attempt in range(1, 5):
        resp = login(client, member.employee_id, "wrong-password")
        assert resp.status_code == 400, f"attempt {attempt} must still be an ordinary failure"
        assert "code" not in body(resp)

    fifth = login(client, member.employee_id, "wrong-password")
    assert fifth.status_code == 429
    assert body(fifth) == LOCKED_BODY

    # From now on the right password is refused too - and with the very same answer.
    sixth = login(client, member.employee_id, GOOD_PASSWORD)
    assert sixth.status_code == 429
    assert body(sixth) == LOCKED_BODY
    assert client.get("/api/auth/me").status_code == 403  # no session was started

    # The failures were recorded against the account and the caller's address.
    attempt = AccessAttempt.objects.get(username=member.employee_id)
    assert attempt.failures_since_start == 5
    assert attempt.ip_address == "127.0.0.1"
    # ... without keeping any password
    assert "wrong-password" not in f"{attempt.post_data}{attempt.get_data}"


def test_attempts_while_locked_do_not_extend_the_lockout(member, client_for):
    client = client_for()
    lock_out(client, member.employee_id)
    recorded = AccessAttempt.objects.get(username=member.employee_id)
    for _ in range(3):
        assert login(client, member.employee_id, "wrong-password").status_code == 429
    after = AccessAttempt.objects.get(username=member.employee_id)
    assert (after.failures_since_start, after.attempt_time) == (recorded.failures_since_start, recorded.attempt_time)


def test_lockout_is_per_account(member, make_user, client_for):
    other = make_user("t_other", ["viewer"], password=GOOD_PASSWORD)
    client = client_for()
    lock_out(client, member.employee_id)
    assert login(client, other.employee_id, GOOD_PASSWORD).status_code == 200


def test_reset_password_lifts_the_lockout(member, admin_account, client_for):
    victim = client_for()
    lock_out(victim, member.employee_id)
    assert login(victim, member.employee_id, GOOD_PASSWORD).status_code == 429

    resp = reset_password(client_for(admin_account), member)
    assert resp.status_code == 200
    temporary = resp.json()["temporary_password"]

    resp = login(victim, member.employee_id, temporary)
    assert resp.status_code == 200
    assert resp.json()["must_change_password"] is True
    assert not AccessAttempt.objects.filter(username=member.employee_id).exists()


def test_a_successful_login_clears_earlier_failures(member, client_for):
    client = client_for()
    for _ in range(4):
        assert login(client, member.employee_id, "wrong-password").status_code == 400
    assert login(client, member.employee_id, GOOD_PASSWORD).status_code == 200
    # Another four failures would have been the 8th, 9th... without the reset.
    for _ in range(4):
        assert login(client, member.employee_id, "wrong-password").status_code == 400


def test_lockout_ends_after_the_cool_off(member, client_for, settings):
    client = client_for()
    lock_out(client, member.employee_id)
    assert login(client, member.employee_id, GOOD_PASSWORD).status_code == 429

    AccessAttempt.objects.update(attempt_time=timezone.now() - settings.AXES_COOLOFF_TIME - timedelta(seconds=1))
    assert login(client, member.employee_id, GOOD_PASSWORD).status_code == 200


def test_lock_message_names_the_configured_wait(member, client_for, settings):
    """Both answers (the attempt that locks, and those after it) quote the configured wait, not a fixed 15."""
    settings.AXES_COOLOFF_TIME = timedelta(minutes=30)
    client = client_for()
    expected = {"detail": "登入失敗次數過多，請 30 分鐘後再試", "code": "locked"}
    assert body(lock_out(client, member.employee_id)) == expected
    assert body(login(client, member.employee_id, GOOD_PASSWORD)) == expected


@pytest.mark.parametrize(
    "cool_off,minutes",
    [
        (timedelta(minutes=1), 1),
        (timedelta(minutes=15), 15),
        (timedelta(minutes=30), 30),
        (timedelta(hours=2), 120),
        (timedelta(seconds=61), 2),  # a started minute counts
        (timedelta(seconds=10), 1),
    ],
    ids=str,
)
def test_lock_message_follows_the_cool_off_setting(cool_off, minutes, settings):
    settings.AXES_COOLOFF_TIME = cool_off
    assert lockout_message() == f"登入失敗次數過多，請 {minutes} 分鐘後再試"


def test_failure_limit_follows_the_setting(member, client_for, settings):
    settings.AXES_FAILURE_LIMIT = 2
    client = client_for()
    assert login(client, member.employee_id, "wrong-password").status_code == 400
    assert login(client, member.employee_id, "wrong-password").status_code == 429


def test_a_spoofed_forwarded_for_header_cannot_dodge_the_lock(member, client_for):
    """Failures are keyed on the connection address; a client-chosen X-Forwarded-For must not give fresh counters."""
    client = client_for()
    payload = {"employee_id": member.employee_id, "password": "wrong-password"}
    for i in range(5):
        resp = client.post(
            LOGIN_URL,
            data=json.dumps(payload),
            content_type="application/json",
            headers={"X-Forwarded-For": f"203.0.113.{i}"},
        )
    assert resp.status_code == 429
    assert AccessAttempt.objects.get(username=member.employee_id).ip_address == "127.0.0.1"


@pytest.mark.parametrize("variable", ["AXES_FAILURE_LIMIT", "AXES_COOLOFF_MINUTES"])
def test_a_lockout_setting_below_one_is_refused_at_startup(variable):
    """A limit of 0 would lock every account before its first attempt; a cool-off of 0 makes failures
    expire at once, so the lock could never trigger. Both must stop startup instead of failing silently."""
    backend_dir = Path(__file__).resolve().parents[3]
    env = {**os.environ, "DJANGO_SETTINGS_MODULE": "config.settings.dev", variable: "0"}
    result = subprocess.run(
        [sys.executable, "-c", "import django; django.setup()"],
        cwd=backend_dir,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode != 0
    assert f"{variable} must be at least 1" in result.stderr


def test_failed_admin_site_logins_lock_the_same_account(member, client_for):
    """The Django admin login posts ``username``; it must count against the same account as the API."""
    client = client_for()
    form = {"username": member.employee_id, "password": "wrong-password"}
    for _ in range(4):
        assert client.post("/admin/login/", form).status_code == 200  # the form, with an error
    fifth = client.post("/admin/login/", form)
    assert fifth.status_code == 429
    assert body(fifth) == LOCKED_BODY
    assert login(client, member.employee_id, GOOD_PASSWORD).status_code == 429
    # axes keeps the posted form for its records: the password must be masked there
    attempt = AccessAttempt.objects.get(username=member.employee_id)
    assert "wrong-password" not in f"{attempt.post_data}{attempt.get_data}"


def test_admin_site_attempts_while_locked_do_not_extend_the_lockout(member, client_for):
    """AXES_RESET_COOL_OFF_ON_FAILURE_DURING_LOCKOUT=False: hammering the Django admin login must not keep
    an account locked for ever (the API login never records attempts while locked either)."""
    client = client_for()
    form = {"username": member.employee_id, "password": "wrong-password"}
    for _ in range(5):
        client.post("/admin/login/", form)
    recorded = AccessAttempt.objects.get(username=member.employee_id)

    for _ in range(3):
        assert client.post("/admin/login/", form).status_code == 429
    after = AccessAttempt.objects.get(username=member.employee_id)
    assert (after.failures_since_start, after.attempt_time) == (recorded.failures_since_start, recorded.attempt_time)


def test_an_over_long_account_name_never_reaches_axes(client_for):
    resp = login(client_for(), "x" * 300, "whatever-password")
    assert resp.status_code == 400
    assert "employee_id" in body(resp)
    assert not AccessAttempt.objects.exists()


def test_login_can_not_be_probed_with_a_malformed_body(client_for):
    client = client_for()
    for payload in ({"employee_id": ["a"], "password": "x"}, {"employee_id": "a"}, {"password": "x"}, {}):
        resp = post_json(client, LOGIN_URL, payload)
        assert resp.status_code == 400, payload
    assert not AccessAttempt.objects.exists()


# ── axes_username ────────────────────────────────────────────────


class _DrfLikeRequest:
    """What AxesProxyHandler may receive from a DRF view: parsed data on ``.data``."""

    def __init__(self, data):
        self.data = data


@pytest.mark.parametrize(
    "credentials,expected",
    [
        ({"employee_id": "a123", "password": "x"}, "a123"),  # API login
        ({"username": "a123", "password": "x"}, "a123"),  # Django admin form
        ({"employee_id": "api", "username": "form"}, "api"),  # employee_id first
        ({"employee_id": None, "username": "form"}, "form"),
        ({"employee_id": "  padded  "}, "padded"),
        ({"employee_id": 12345}, "12345"),  # DRF's CharField accepts numbers
        ({"employee_id": True}, None),
        ({"employee_id": ["a"]}, None),
        ({"employee_id": ""}, None),
        ({"employee_id": "x" * 400}, "x" * 255),  # fits AccessAttempt.username
        ({}, None),
        (None, None),
    ],
)
def test_axes_username_from_credentials(credentials, expected, rf):
    assert axes_username(rf.post("/x"), credentials) == expected


def test_axes_username_credentials_win_over_the_request(rf):
    request = rf.post("/x", data=json.dumps({"employee_id": "from-body"}), content_type="application/json")
    assert axes_username(request, {"employee_id": "from-credentials"}) == "from-credentials"


def test_axes_username_reads_a_json_body(rf):
    request = rf.post("/x", data=json.dumps({"employee_id": " from-body "}), content_type="application/json")
    assert axes_username(request) == "from-body"
    assert axes_username(request, {}) == "from-body"


def test_axes_username_reads_a_form_post(rf):
    assert axes_username(rf.post("/x", {"username": "from-form"})) == "from-form"
    assert axes_username(rf.post("/x", {"employee_id": "from-form"})) == "from-form"


def test_axes_username_reads_drf_data(rf):
    assert axes_username(_DrfLikeRequest({"employee_id": "from-data"})) == "from-data"
    assert axes_username(_DrfLikeRequest({"username": "from-data"})) == "from-data"


@pytest.mark.parametrize("raw", [b"not json", b"[1, 2]", b'"text"', b""])
def test_axes_username_ignores_a_body_that_is_not_a_json_object(raw, rf):
    assert axes_username(rf.post("/x", data=raw, content_type="application/json")) is None


def test_axes_username_survives_an_already_consumed_body(rf):
    request = rf.post("/x", data=json.dumps({"employee_id": "abc"}), content_type="application/json")
    request.read()  # what DRF does when it parses the stream: .body is unavailable afterwards
    assert axes_username(request) is None


# ── unlock_account ───────────────────────────────────────────────


def test_unlock_account_removes_only_that_accounts_failures(member, make_user, client_for):
    other = make_user("t_other", ["viewer"], password=GOOD_PASSWORD)
    client = client_for()
    for account in (member, other):
        assert login(client, account.employee_id, "wrong-password").status_code == 400
    assert AccessAttempt.objects.count() == 2

    assert unlock_account(member.employee_id) == 1
    assert list(AccessAttempt.objects.values_list("username", flat=True)) == [other.employee_id]


@pytest.mark.parametrize("empty", ["", None], ids=["empty-string", "none"])
def test_unlock_account_never_calls_axes_without_a_name(empty, monkeypatch):
    """axes' reset_attempts() with no filter deletes the failures of EVERY account: the guard must stop that."""
    calls = []
    monkeypatch.setattr(lockout.AxesProxyHandler, "reset_attempts", lambda **kwargs: calls.append(kwargs))
    assert unlock_account(empty) == 0
    assert calls == []


@pytest.mark.parametrize("empty", ["", None], ids=["empty-string", "none"])
def test_unlock_account_without_a_name_leaves_every_record_alone(empty, member, client_for):
    assert login(client_for(), member.employee_id, "wrong-password").status_code == 400
    assert unlock_account(empty) == 0
    assert AccessAttempt.objects.filter(username=member.employee_id).count() == 1


def test_unlock_account_hands_the_name_to_axes(monkeypatch):
    calls = []
    monkeypatch.setattr(lockout.AxesProxyHandler, "reset_attempts", lambda **kwargs: calls.append(kwargs) or 7)
    assert unlock_account("t_someone") == 7
    assert calls == [{"username": "t_someone"}]


# ── Password gate (must_change_password) ─────────────────────────

AUTH_ROUTES ={"/api/auth/login", "/api/auth/me", "/api/auth/logout", "/api/auth/change-password"}


def test_every_other_route_asks_for_the_password_change(make_user, client_for):
    """With the flag set - even for an administrator - nothing but the auth endpoints answers."""
    user = make_user("t_must_change", ["admin"], must_change_password=True)
    client = client_for(user)
    routes = [route for route, _ in api_routes() if route not in AUTH_ROUTES]
    assert len(routes) >= 50, f"route discovery looks broken: only {len(routes)} routes found"

    failures = []
    for route in routes:
        url = fill(route)
        for method in ("GET", "POST", "PUT", "PATCH", "DELETE"):
            resp = call(client, method, url)
            expected = {"detail": "請先變更密碼", "code": "password_change_required"}
            if resp.status_code != 403 or body(resp) != expected:
                failures.append(f"{method} {url} -> {resp.status_code} {resp.content[:80]!r}")
    assert not failures, "routes reachable while the password change is pending:\n" + "\n".join(failures)


def test_a_user_who_must_change_the_password_keeps_the_auth_endpoints(make_user, client_for):
    user = make_user("t_must_change", ["reviewer"], must_change_password=True, password=GOOD_PASSWORD)
    client = client_for(user)

    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert body(me)["must_change_password"] is True
    # Reached the view (which rejects the empty body), not the gate:
    assert post_json(client, "/api/auth/change-password").status_code == 400
    assert post_json(client, "/api/auth/logout").status_code == 200


def test_the_gate_opens_once_the_password_is_changed(make_user, client_for):
    user = make_user("t_must_change", ["viewer"], must_change_password=True, password=GOOD_PASSWORD)
    client = client_for(user)
    assert client.get("/api/v1/dashboard/").status_code == 403

    assert change_password(client, GOOD_PASSWORD, NEW_PASSWORD).status_code == 200
    assert client.get("/api/v1/dashboard/").status_code == 200


def test_login_reports_the_pending_password_change(make_user, client_for):
    make_user("t_must_change", ["viewer"], must_change_password=True, password=GOOD_PASSWORD)
    client = client_for()
    resp = login(client, "t_must_change", GOOD_PASSWORD)
    assert resp.status_code == 200
    assert resp.json()["must_change_password"] is True
    assert client.get("/api/v1/dashboard/").status_code == 403


def test_require_roles_refuses_a_user_who_must_change_the_password(rf):
    @require_roles()
    def view(request):
        return HttpResponse("ok")

    request = rf.get("/x")
    request.user = User(employee_id="m", roles=["admin"], must_change_password=True)
    resp = view(request)
    assert resp.status_code == 403
    assert json.loads(resp.content) == {"detail": "請先變更密碼", "code": "password_change_required"}

    request.user = User(employee_id="m", roles=["admin"], must_change_password=False)
    assert view(request).status_code == 200


# ── change-password ──────────────────────────────────────────────


def test_change_password_needs_the_right_current_password(member, client_for):
    resp = change_password(client_for(member), "not-my-password", NEW_PASSWORD)
    assert resp.status_code == 400
    assert "current_password" in resp.json()
    member.refresh_from_db()
    assert member.check_password(GOOD_PASSWORD)


@pytest.mark.parametrize("payload", [{}, {"new_password": NEW_PASSWORD}, {"current_password": GOOD_PASSWORD}])
def test_change_password_needs_both_fields(payload, member, client_for):
    resp = post_json(client_for(member), "/api/auth/change-password", payload)
    assert resp.status_code == 400
    member.refresh_from_db()
    assert member.check_password(GOOD_PASSWORD)


@pytest.mark.parametrize(
    "weak",
    ["Ab1!xyz", "1234567890123", "t_member-2025"],
    ids=["shorter-than-10", "digits-only", "contains-the-employee-id"],
)
def test_change_password_rejects_weak_new_passwords(weak, member, client_for):
    expected = password_problems(weak, member)
    assert expected, "the example is supposed to break at least one validator"

    resp = change_password(client_for(member), GOOD_PASSWORD, weak)
    assert resp.status_code == 400
    assert resp.json() == {"new_password": expected}  # the validators' own messages
    member.refresh_from_db()
    assert member.check_password(GOOD_PASSWORD)


# (attribute, its value, a password that is too close to it). The model has no first/last name, so the
# similarity validator is configured with exactly these three fields and each one has to be watched.
SIMILARITY_CASES = [
    ("employee_id", "t_member", "t_member-2025"),
    ("full_name", "Wang Xiaoming", "wangxiaoming1"),
    ("email", "xiaoming.wang@example.com", "xiaoming.wang1"),
]


@pytest.mark.parametrize(
    "attribute,value,weak", SIMILARITY_CASES, ids=[attribute for attribute, _, _ in SIMILARITY_CASES]
)
def test_similarity_validator_watches_every_configured_attribute(attribute, value, weak, member, client_for):
    # In isolation: the password is refused because of that one attribute, and fine without it.
    neutral = {"employee_id": "t_neutral", "full_name": "Neutral Person", "email": ""}
    assert password_problems(weak, User(**{**neutral, attribute: value}))
    assert password_problems(weak, User(**neutral)) == []

    # Through the API, for an account that really has that value.
    User.objects.filter(pk=member.pk).update(**{attribute: value})
    member.refresh_from_db()
    resp = change_password(client_for(member), GOOD_PASSWORD, weak)
    assert resp.status_code == 400
    assert resp.json() == {"new_password": password_problems(weak, member)}
    assert resp.json()["new_password"]


def test_change_password_rejects_the_current_password_as_the_new_one(member, client_for):
    resp = change_password(client_for(member), GOOD_PASSWORD, GOOD_PASSWORD)
    assert resp.status_code == 400
    assert "new_password" in resp.json()


def test_change_password_keeps_this_session_and_ends_the_others(make_user, client_for):
    user = make_user("t_changer", ["viewer"], must_change_password=True, password=GOOD_PASSWORD)
    here, elsewhere = client_for(user), client_for(user)

    resp = change_password(here, GOOD_PASSWORD, NEW_PASSWORD)
    assert resp.status_code == 200
    assert here.get("/api/auth/me").status_code == 200  # this session survives ...
    assert elsewhere.get("/api/auth/me").status_code == 403  # ... every other one is signed out

    user.refresh_from_db()
    assert user.must_change_password is False
    assert login(client_for(), user.employee_id, GOOD_PASSWORD).status_code == 400
    assert login(client_for(), user.employee_id, NEW_PASSWORD).status_code == 200


def test_passwords_are_compared_verbatim(make_user, client_for):
    """No silent trimming: a password with a trailing space must keep working."""
    user = make_user("t_spacey", ["viewer"], must_change_password=True, password=GOOD_PASSWORD)
    padded = NEW_PASSWORD + " "
    assert change_password(client_for(user), GOOD_PASSWORD, padded).status_code == 200
    assert login(client_for(), user.employee_id, padded).status_code == 200
    assert login(client_for(), user.employee_id, NEW_PASSWORD).status_code == 400


# ── Creating accounts ────────────────────────────────────────────


def new_account(**overrides) -> dict:
    return {
        "employee_id": "t_new_hire",
        "full_name": "新進同仁",
        "email": "new.hire@example.com",
        "roles": ["reporter"],
        **overrides,
    }


@pytest.mark.parametrize("password", [None, ""], ids=["omitted", "blank"])
def test_create_without_a_password_returns_a_temporary_one(password, admin_account, client_for):
    payload = new_account()
    if password is not None:
        payload["password"] = password
    resp = post_json(client_for(admin_account), USERS_URL, payload)

    assert resp.status_code == 201
    data = resp.json()
    temporary = data.pop("temporary_password")
    assert resp["Cache-Control"] == "no-store"
    assert data["employee_id"] == "t_new_hire"
    assert data["must_change_password"] is True
    assert "password" not in data

    user = User.objects.get(employee_id="t_new_hire")
    assert user.must_change_password is True
    assert user.check_password(temporary)
    assert password_problems(temporary, user) == []
    # ... and it is a working credential:
    signed_in = login(client_for(), "t_new_hire", temporary)
    assert signed_in.status_code == 200
    assert signed_in.json()["must_change_password"] is True


def test_create_with_a_chosen_password_does_not_echo_one(admin_account, client_for):
    resp = post_json(client_for(admin_account), USERS_URL, new_account(password=NEW_PASSWORD))
    assert resp.status_code == 201
    assert "temporary_password" not in resp.json()
    assert "password" not in resp.json()
    user = User.objects.get(employee_id="t_new_hire")
    assert user.check_password(NEW_PASSWORD)
    assert user.must_change_password is True


@pytest.mark.parametrize(
    "weak",
    ["short1A!", "0123456789012", "t_new_hire-1"],
    ids=["shorter-than-10", "digits-only", "contains-the-employee-id"],
)
def test_create_rejects_a_weak_chosen_password(weak, admin_account, client_for):
    candidate = User(employee_id="t_new_hire", full_name="新進同仁", email="new.hire@example.com")
    expected = password_problems(weak, candidate)
    assert expected

    resp = post_json(client_for(admin_account), USERS_URL, new_account(password=weak))
    assert resp.status_code == 400
    assert resp.json() == {"password": expected}
    assert not User.objects.filter(employee_id="t_new_hire").exists()


@pytest.mark.parametrize(
    "fields,weak",
    [
        ({"full_name": "Wang Xiaoming"}, "wangxiaoming1"),
        ({"email": "xiaoming.wang@example.com"}, "xiaoming.wang1"),
    ],
    ids=["full_name", "email"],
)
def test_create_compares_a_chosen_password_with_the_name_and_email_too(fields, weak, admin_account, client_for):
    payload = new_account(**fields)
    candidate = User(employee_id=payload["employee_id"], full_name=payload["full_name"], email=payload["email"])
    expected = password_problems(weak, candidate)
    assert expected

    resp = post_json(client_for(admin_account), USERS_URL, {**payload, "password": weak})
    assert resp.status_code == 400
    assert resp.json() == {"password": expected}
    assert not User.objects.filter(employee_id=payload["employee_id"]).exists()


@pytest.mark.parametrize("roles", [["superuser"], ["reporter", "boss"], ["Admin"], [""]], ids=str)
def test_create_rejects_unknown_roles(roles, admin_account, client_for):
    resp = post_json(client_for(admin_account), USERS_URL, new_account(roles=roles))
    assert resp.status_code == 400
    assert "roles" in resp.json()
    assert not User.objects.filter(employee_id="t_new_hire").exists()


@pytest.mark.parametrize(
    "roles",
    ["admin", {"admin": True}, 7, None, [["admin"]], [None], [1], [{"role": "admin"}]],
    ids=str,
)
def test_create_rejects_roles_that_are_not_a_list_of_names(roles, admin_account, client_for):
    resp = post_json(client_for(admin_account), USERS_URL, new_account(roles=roles))
    assert resp.status_code == 400
    assert "roles" in resp.json()
    assert not User.objects.filter(employee_id="t_new_hire").exists()


def test_create_accepts_every_known_role_and_drops_repeats(admin_account, client_for):
    resp = post_json(
        client_for(admin_account), USERS_URL, new_account(roles=["viewer", "reporter", "viewer", "reviewer", "admin"])
    )
    assert resp.status_code == 201
    assert resp.json()["roles"] == ["viewer", "reporter", "reviewer", "admin"]


def test_create_without_roles_makes_an_account_with_no_role(admin_account, client_for):
    payload = new_account()
    del payload["roles"]
    resp = post_json(client_for(admin_account), USERS_URL, payload)
    assert resp.status_code == 201
    assert resp.json()["roles"] == []


# ── Updating accounts ────────────────────────────────────────────


@pytest.mark.parametrize("roles", [["superuser"], "admin", {"admin": True}, [None]], ids=str)
def test_update_validates_roles_too(roles, member, admin_account, client_for):
    resp = patch_json(client_for(admin_account), f"{USERS_URL}/{member.pk}", {"roles": roles})
    assert resp.status_code == 400
    assert "roles" in resp.json()
    member.refresh_from_db()
    assert member.roles == ["viewer"]


def test_an_administrator_cannot_remove_their_own_admin_role(admin_account, client_for):
    url = f"{USERS_URL}/{admin_account.pk}"
    resp = patch_json(client_for(admin_account), url, {"roles": ["viewer", "reporter"]})
    assert resp.status_code == 400
    assert body(resp)["code"] == "cannot_remove_own_admin_role"
    assert "管理員" in body(resp)["detail"]
    admin_account.refresh_from_db()
    assert admin_account.roles == ["admin"]


def test_an_administrator_cannot_deactivate_themselves(admin_account, client_for):
    resp = patch_json(client_for(admin_account), f"{USERS_URL}/{admin_account.pk}", {"is_active": False})
    assert resp.status_code == 400
    assert body(resp)["code"] == "cannot_deactivate_self"
    assert "停用" in body(resp)["detail"]
    admin_account.refresh_from_db()
    assert admin_account.is_active is True


def test_an_administrator_may_still_edit_themselves_otherwise(admin_account, client_for):
    client = client_for(admin_account)
    url = f"{USERS_URL}/{admin_account.pk}"
    assert patch_json(client, url, {"full_name": "新名字"}).status_code == 200
    assert patch_json(client, url, {"roles": ["admin", "reviewer"]}).status_code == 200
    assert patch_json(client, url, {"is_active": True}).status_code == 200
    admin_account.refresh_from_db()
    assert (admin_account.full_name, admin_account.roles) == ("新名字", ["admin", "reviewer"])


def test_an_administrator_may_demote_or_deactivate_someone_else(member, admin_account, client_for):
    client = client_for(admin_account)
    url = f"{USERS_URL}/{member.pk}"
    assert patch_json(client, url, {"roles": ["reporter", "admin"]}).status_code == 200
    assert patch_json(client, url, {"roles": ["viewer"], "is_active": False}).status_code == 200
    member.refresh_from_db()
    assert (member.roles, member.is_active) == (["viewer"], False)


# ── Sessions ─────────────────────────────────────────────────────


def test_every_request_renews_the_session(member, client_for, settings):
    """SESSION_COOKIE_AGE is an idle timeout: using the API pushes the expiry out again."""
    client = client_for(member)
    key = client.session.session_key
    Session.objects.filter(session_key=key).update(expire_date=timezone.now() + timedelta(minutes=5))

    resp = client.get("/api/auth/me")
    assert resp.status_code == 200
    renewed = Session.objects.get(session_key=key).expire_date
    assert renewed > timezone.now() + timedelta(seconds=settings.SESSION_COOKIE_AGE) - timedelta(minutes=1)
    assert int(resp.cookies["sessionid"]["max-age"]) == settings.SESSION_COOKIE_AGE  # the cookie is renewed too


def test_a_request_without_a_session_does_not_create_one(client_for):
    """Renewal must not turn anonymous traffic into session rows."""
    before = Session.objects.count()
    assert client_for().get("/api/auth/me").status_code == 403
    assert Session.objects.count() == before


# ── reset-password ───────────────────────────────────────────────


def test_reset_password_returns_a_one_time_temporary_password(member, admin_account, client_for, caplog):
    caplog.set_level(logging.DEBUG)
    admin = client_for(admin_account)

    resp = reset_password(admin, member)
    assert resp.status_code == 200
    assert set(resp.json()) == {"temporary_password"}
    assert resp["Cache-Control"] == "no-store"
    temporary = resp.json()["temporary_password"]

    member.refresh_from_db()
    assert member.must_change_password is True
    assert member.check_password(temporary)
    assert not member.check_password(GOOD_PASSWORD)
    assert password_problems(temporary, member) == []
    assert len(temporary) >= 12

    assert temporary not in caplog.text  # never logged
    assert temporary.encode() not in admin.get(f"{USERS_URL}/{member.pk}").content  # nor readable later
    assert temporary.encode() not in admin.get(USERS_URL).content


def test_every_reset_draws_a_new_password(member, admin_account, client_for):
    admin = client_for(admin_account)
    first = reset_password(admin, member).json()["temporary_password"]
    second = reset_password(admin, member).json()["temporary_password"]
    assert first != second


def test_reset_password_signs_the_user_out_everywhere(member, admin_account, client_for):
    session = client_for(member)
    assert session.get("/api/auth/me").status_code == 200
    reset_password(client_for(admin_account), member)
    assert session.get("/api/auth/me").status_code == 403


def test_reset_password_for_an_unknown_user_is_a_404(admin_account, client_for):
    resp = post_json(client_for(admin_account), f"{USERS_URL}/999999/reset-password")
    assert resp.status_code == 404


# ── Temporary passwords ──────────────────────────────────────────


def test_generated_passwords_have_every_character_class_and_pass_the_validators():
    seen = set()
    for _ in range(200):
        pw = generate_temporary_password()
        seen.add(pw)
        assert len(pw) >= 12
        assert any(c.isupper() for c in pw)
        assert any(c.islower() for c in pw)
        assert any(c.isdigit() for c in pw)
        assert any(not c.isalnum() for c in pw)
        assert not set(pw) & set("0O1lI"), "look-alike characters must stay out"
        assert password_problems(pw) == []
    assert len(seen) == 200


def test_generated_passwords_are_checked_against_the_user(monkeypatch):
    user = User(employee_id="somebody", full_name="Some Body")
    seen = []

    def spy(password, user=None):
        seen.append(user)
        return []

    monkeypatch.setattr(passwords, "password_problems", spy)
    generate_temporary_password(user)
    assert seen == [user]


def test_generation_redraws_until_the_validators_are_satisfied(monkeypatch):
    answers = iter([["too similar"], ["too common"], []])
    calls = []

    def fake(password, user=None):
        calls.append(password)
        return next(answers)

    monkeypatch.setattr(passwords, "password_problems", fake)
    result = generate_temporary_password()
    assert len(calls) == 3
    assert result == calls[-1]
    assert len(set(calls)) == 3  # a fresh draw each time


def test_generation_gives_up_instead_of_looping_forever(monkeypatch):
    monkeypatch.setattr(passwords, "password_problems", lambda password, user=None: ["never good enough"])
    with pytest.raises(RuntimeError, match="AUTH_PASSWORD_VALIDATORS"):
        generate_temporary_password()


# ── seed_admin ───────────────────────────────────────────────────

SEED_PASSWORD = "Teal-Meadow-Lantern-52"


def seed_admin(*args) -> str:
    out, err = io.StringIO(), io.StringIO()
    call_command("seed_admin", *args, stdout=out, stderr=err)
    return out.getvalue() + err.getvalue()


def test_seed_admin_needs_a_password_to_create_the_account():
    with pytest.raises(CommandError, match="SEED_ADMIN_PASSWORD"):
        seed_admin()
    assert not User.objects.filter(employee_id="admin").exists()


def test_seed_admin_rejects_a_weak_password():
    probe = User(employee_id="admin", full_name="系統管理員", email="admin@example.com")
    for weak in ("short1A!", "0123456789012", "password123456"):
        problems = password_problems(weak, probe)
        assert problems, weak
        with pytest.raises(CommandError) as excinfo:
            seed_admin("--password", weak)
        for message in problems:
            assert message in str(excinfo.value)
    assert not User.objects.filter(employee_id="admin").exists()


def test_seed_admin_creates_the_account_without_echoing_the_password(client_for):
    output = seed_admin("--password", SEED_PASSWORD)

    assert SEED_PASSWORD not in output
    admin = User.objects.get(employee_id="admin")
    assert admin.check_password(SEED_PASSWORD)
    assert admin.must_change_password is True
    assert (admin.is_active, admin.is_staff, admin.is_superuser) == (True, True, True)
    assert admin.roles == ["admin"]
    signed_in = login(client_for(), "admin", SEED_PASSWORD)
    assert signed_in.status_code == 200
    assert signed_in.json()["must_change_password"] is True


def test_seed_admin_reads_the_password_from_the_environment(monkeypatch):
    monkeypatch.setenv("SEED_ADMIN_PASSWORD", SEED_PASSWORD)
    output = seed_admin()
    assert SEED_PASSWORD not in output
    assert User.objects.get(employee_id="admin").check_password(SEED_PASSWORD)


def test_seed_admin_option_beats_the_environment(monkeypatch):
    monkeypatch.setenv("SEED_ADMIN_PASSWORD", "From-The-Environment-77")
    seed_admin("--password", SEED_PASSWORD)
    assert User.objects.get(employee_id="admin").check_password(SEED_PASSWORD)


def test_seed_admin_skips_an_existing_account_quietly(monkeypatch):
    seed_admin("--password", SEED_PASSWORD)
    User.objects.filter(employee_id="admin").update(must_change_password=False)
    monkeypatch.setenv("SEED_ADMIN_PASSWORD", "From-The-Environment-77")

    output = seed_admin()  # no CommandError, even with a different password around
    assert "已存在" in output
    assert "From-The-Environment-77" not in output
    admin = User.objects.get(employee_id="admin")
    assert admin.check_password(SEED_PASSWORD)
    assert admin.must_change_password is False  # untouched


def test_seed_admin_skips_an_existing_account_without_needing_a_password():
    seed_admin("--password", SEED_PASSWORD)
    assert "已存在" in seed_admin()  # SEED_ADMIN_PASSWORD is not set (autouse fixture)


def test_seed_admin_reset_needs_a_password():
    seed_admin("--password", SEED_PASSWORD)
    with pytest.raises(CommandError, match="SEED_ADMIN_PASSWORD"):
        seed_admin("--reset")
    assert User.objects.get(employee_id="admin").check_password(SEED_PASSWORD)


def test_seed_admin_reset_replaces_the_password_and_demands_a_change():
    seed_admin("--password", SEED_PASSWORD)
    admin = User.objects.get(employee_id="admin")
    admin.must_change_password = False
    admin.is_active = False
    admin.roles = ["viewer"]
    admin.save()

    output = seed_admin("--reset", "--password", "Amber-Harbor-Quartz-31")

    assert "Amber-Harbor-Quartz-31" not in output
    admin.refresh_from_db()
    assert admin.check_password("Amber-Harbor-Quartz-31")
    assert not admin.check_password(SEED_PASSWORD)
    assert admin.must_change_password is True
    assert admin.is_active is True
    assert admin.roles == ["viewer", "admin"]  # administrator role restored, nothing else touched


def test_seed_admin_reset_also_lifts_a_login_lockout(client_for):
    seed_admin("--password", SEED_PASSWORD)
    client = client_for()
    lock_out(client, "admin")
    assert login(client, "admin", SEED_PASSWORD).status_code == 429

    seed_admin("--reset", "--password", SEED_PASSWORD)
    assert login(client, "admin", SEED_PASSWORD).status_code == 200


def test_removed_password_constants_stay_removed():
    """The old built-in passwords lived in these two modules; nothing may bring them back."""
    from apps.accounts import views
    from apps.accounts.management.commands import seed_admin as seed_module

    assert not hasattr(seed_module, "DEFAULT_PASSWORD")
    assert not hasattr(views, "DEFAULT_RESET_PASSWORD")
