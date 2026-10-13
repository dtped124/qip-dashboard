"""
Tests of ``manage.py ldap_check`` (apps/accounts/management/commands/ldap_check.py), all against a fake ``ldap3``.

``Server`` / ``Connection`` are replaced inside ``apps.accounts.ldap`` (the command goes through that module) and
``ldap.authenticate`` is faked for ``--login``; nothing here reaches a network. Every host, account, DN and password
below is made up. The command must never print a password or the bind account.
"""
from __future__ import annotations

import io
import re
from types import SimpleNamespace

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from ldap3.core.exceptions import LDAPSocketOpenError

from apps.accounts import ldap as ad
from apps.accounts.ldap import LdapResult
from apps.accounts.management.commands import ldap_check
from apps.accounts.models import User

pytestmark = pytest.mark.django_db

BIND_USER = "CN=svc-made-up,OU=Service,DC=example,DC=test"
BIND_PASS = "Bind-Pw-Zq9-unique-marker!"
USER_PASSWORD = "User-Pw-Zq9-unique-marker!"


@pytest.fixture
def ad_on(settings):
    settings.LDAP = {
        "ENABLED": True,
        "SERVER_IP": "ad.example.test",
        "PORT": 3890,
        "BIND_USER": BIND_USER,
        "BIND_PASS": BIND_PASS,
        "BASE_DN": "DC=example,DC=test",
        "TIMEOUT": 2.5,
        "AUTO_CREATE": False,
        "DEFAULT_ROLE": "viewer",
        "LOCAL_ONLY_ACCOUNTS": frozenset(),
    }
    return settings.LDAP


def person(account, sn="陳", given="小明", mail="", department="品管中心"):
    attributes = {
        "sAMAccountName": [account],
        "sn": [sn],
        "givenName": [given],
        "mail": [mail] if mail else [],
        "department": [department],
    }
    return SimpleNamespace(entry_dn=f"CN={account},OU=Staff,DC=example,DC=test", entry_attributes_as_dict=attributes)


class FakeDirectory:
    def __init__(self):
        self.people: dict[str, list] = {}  # casefolded account -> entries AD answers with
        self.bind_error: Exception | None = None
        self.connections: list[dict] = []
        self.searches: list[str] = []
        self.unbound = 0


@pytest.fixture
def directory(monkeypatch) -> FakeDirectory:
    fake = FakeDirectory()

    class FakeConnection:
        def __init__(self, server, **kwargs):
            fake.connections.append(kwargs)
            if kwargs.get("auto_bind") and fake.bind_error is not None:
                raise fake.bind_error
            self.entries = []

        def search(self, base, search_filter, **kwargs):
            fake.searches.append(search_filter)
            account = re.search(r"sAMAccountName=([^)]*)\)", search_filter).group(1)
            self.entries = list(fake.people.get(account.casefold(), []))

        def unbind(self):
            fake.unbound += 1

    monkeypatch.setattr(ad, "Server", lambda host, **kwargs: f"server:{host}")
    monkeypatch.setattr(ad, "Connection", FakeConnection)
    return fake


def run(*args, **options):
    out, err = io.StringIO(), io.StringIO()
    call_command("ldap_check", *args, stdout=out, stderr=err, **options)
    return out.getvalue() + err.getvalue()


def assert_no_secrets(text):
    for secret in (BIND_PASS, BIND_USER, "svc-made-up", USER_PASSWORD):
        assert secret not in text


# ── Off ──────────────────────────────────────────────────────────


@pytest.mark.parametrize("args", [(), ("--user", "T123"), ("--audit",)], ids=["bind", "user", "audit"])
def test_every_mode_refuses_to_run_with_ad_off(args, directory):
    with pytest.raises(CommandError, match="LDAP_ENABLED is false"):
        run(*args)
    assert directory.connections == []


# ── Service-account bind ─────────────────────────────────────────


def test_bind_mode_reports_ok_with_the_configured_timeouts_and_no_secrets(ad_on, directory):
    text = run()

    assert "service bind ok" in text
    assert_no_secrets(text)
    (kwargs,) = directory.connections
    assert (kwargs["user"], kwargs["password"], kwargs["auto_bind"]) == (BIND_USER, BIND_PASS, True)
    assert kwargs["receive_timeout"] == 2.5 and kwargs["read_only"] is True
    assert directory.unbound == 1


def test_bind_mode_failure_names_only_the_exception_class_and_exits_non_zero(ad_on, directory):
    directory.bind_error = LDAPSocketOpenError(f"cannot open socket to ad.example.test with {BIND_PASS}")

    with pytest.raises(CommandError) as raised:
        run()

    assert "LDAPSocketOpenError" in str(raised.value)
    assert_no_secrets(str(raised.value))


# ── --user ───────────────────────────────────────────────────────


def test_user_mode_prints_what_ad_knows_about_the_person(ad_on, directory):
    directory.people["t123"] = [person("T123", mail="t123@example.test")]

    text = run("--user", "T123")

    for part in ("found: T123", "陳小明", "t123@example.test", "品管中心"):
        assert part in text
    assert_no_secrets(text)
    assert len(directory.searches) == 1 and "sAMAccountName=T123" in directory.searches[0]


def test_user_mode_says_not_found_and_fails(ad_on, directory):
    out = io.StringIO()
    with pytest.raises(CommandError):
        call_command("ldap_check", "--user", "T404", stdout=out)
    assert "not found: T404" in out.getvalue()


def test_user_mode_never_searches_for_a_name_that_cannot_be_an_account(ad_on, directory):
    out = io.StringIO()
    with pytest.raises(CommandError):
        call_command("ldap_check", "--user", "a*)(uid=*", stdout=out)
    assert "not found" in out.getvalue()
    assert directory.searches == []


def test_user_mode_reports_a_name_that_is_not_unique(ad_on, directory):
    directory.people["t123"] = [person("T123"), person("T123")]
    out = io.StringIO()
    with pytest.raises(CommandError):
        call_command("ldap_check", "--user", "T123", stdout=out)
    assert "ambiguous" in out.getvalue()


# ── --login ──────────────────────────────────────────────────────


def test_login_mode_asks_for_the_password_hidden_and_prints_only_the_status(ad_on, monkeypatch):
    prompts, calls = [], []
    monkeypatch.setattr(ldap_check.getpass, "getpass", lambda prompt="": prompts.append(prompt) or USER_PASSWORD)
    monkeypatch.setattr(
        ad, "authenticate", lambda login_id, password: calls.append((login_id, password)) or LdapResult("success")
    )

    text = run("--user", "T123", "--login")

    assert "status: success" in text
    assert calls == [("T123", USER_PASSWORD)]
    assert len(prompts) == 1
    assert_no_secrets(text)
    assert_no_secrets(prompts[0])


@pytest.mark.parametrize("status", ["wrong_password", "not_found", "error", "ambiguous"])
def test_login_mode_exits_non_zero_for_anything_but_success(status, ad_on, monkeypatch):
    monkeypatch.setattr(ldap_check.getpass, "getpass", lambda prompt="": USER_PASSWORD)
    monkeypatch.setattr(ad, "authenticate", lambda login_id, password: LdapResult(status))
    out = io.StringIO()

    with pytest.raises(CommandError) as raised:
        call_command("ldap_check", "--user", "T123", "--login", stdout=out)

    assert f"status: {status}" in out.getvalue()
    assert_no_secrets(out.getvalue() + str(raised.value))


def test_login_needs_a_user(ad_on):
    with pytest.raises(CommandError, match="--user"):
        run("--login")


# ── --audit ──────────────────────────────────────────────────────


def test_audit_lists_accounts_missing_from_ad_marks_administrators_and_finds_name_differences(
    ad_on, directory, make_user, settings
):
    settings.LDAP = {**ad_on, "LOCAL_ONLY_ACCOUNTS": frozenset({"breakglass"})}
    make_user("boss", ["admin"])  # administrator, not in AD
    make_user("T200", ["viewer"])  # not in AD
    make_user("T123", ["viewer"])  # in AD, same name
    make_user("T124", ["viewer"])  # in AD, another name
    make_user("breakglass", ["admin"])  # local-only: never asked
    make_user("T300", ["viewer"], is_active=False)  # deactivated: not audited
    for name in ("T123", "T124"):
        directory.people[name.casefold()] = [person(name, sn="陳", given="小明")]
    User.objects.filter(employee_id="T123").update(full_name="陳 小明")  # spaces do not count as a difference
    User.objects.filter(employee_id="T124").update(full_name="王大華")

    out = io.StringIO()
    with pytest.raises(CommandError) as raised:  # "boss" is an administrator who is not in AD
        call_command("ldap_check", "--audit", stdout=out)
    text = out.getvalue()
    assert raised.value.returncode == 2
    assert "1 administrator account(s) are not in AD" in str(raised.value)

    assert "audited 4 active local account(s); 1 local-only account(s) skipped" in text
    assert re.search(r"\[ADMIN\] boss\b", text)
    assert "T200" in text and not re.search(r"\[ADMIN\] T200", text)
    assert "breakglass" not in text and "T300" not in text
    assert "WARNING: an administrator is missing from AD" in text
    assert re.search(r"T124\s+system=王大華\s+ad=陳小明", text)
    assert "T123" not in text
    assert_no_secrets(text)
    assert directory.unbound == 1
    searched = " ".join(directory.searches)
    assert "breakglass" not in searched and "T300" not in searched


def test_audit_lists_the_seed_admin_with_a_note_but_neither_warns_nor_fails(ad_on, directory, make_user):
    make_user("admin", ["admin"], is_superuser=True, is_staff=True)  # the seed administrator, not in AD
    make_user("T123", ["viewer"])
    directory.people["t123"] = [person("T123")]
    User.objects.filter(employee_id="T123").update(full_name="陳小明")

    text = run("--audit")  # exit code 0: no CommandError

    assert re.search(r"\[ADMIN] admin .*seed 管理者；要保留請列入 LDAP_LOCAL_ONLY_ACCOUNTS", text)
    assert "WARNING" not in text


def test_audit_seed_admin_in_any_letter_case_is_still_the_seed_admin(ad_on, directory, make_user):
    make_user("ADMIN", ["admin"])

    text = run("--audit")

    assert "seed 管理者" in text and "WARNING" not in text


def test_audit_fails_with_exit_code_2_when_another_administrator_is_missing_besides_the_seed_admin(
    ad_on, directory, make_user
):
    make_user("admin", ["admin"], is_superuser=True)
    make_user("boss", ["admin"])
    out = io.StringIO()

    with pytest.raises(CommandError) as raised:
        call_command("ldap_check", "--audit", stdout=out)

    assert raised.value.returncode == 2
    assert "1 administrator account(s) are not in AD" in str(raised.value)  # only boss counts
    assert "WARNING: an administrator is missing from AD" in out.getvalue()


def test_audit_exits_0_when_only_non_administrators_are_missing_or_names_differ(ad_on, directory, make_user):
    make_user("T200", ["viewer"])  # not in AD
    make_user("T124", ["viewer"])  # in AD under another name
    directory.people["t124"] = [person("T124")]
    User.objects.filter(employee_id="T124").update(full_name="王大華")

    text = run("--audit")  # no CommandError

    assert "not in AD, cannot sign in once AD is on: 1" in text
    assert "AD name differs from the system name: 1" in text
    assert "WARNING" not in text


def test_audit_with_everybody_in_ad_reports_nothing_to_fix(ad_on, directory, make_user):
    make_user("T123", ["viewer"])
    directory.people["t123"] = [person("T123")]
    User.objects.filter(employee_id="T123").update(full_name="陳小明")

    text = run("--audit")

    assert "not in AD, cannot sign in once AD is on: 0" in text
    assert "AD name differs from the system name: 0" in text
    assert "WARNING" not in text


def test_audit_cannot_be_combined_with_a_single_account(ad_on):
    with pytest.raises(CommandError):
        run("--audit", "--user", "T123")
