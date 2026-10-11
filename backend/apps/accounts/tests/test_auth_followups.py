"""
Review follow-ups of the auth work, delivered with the role-routing phase.

F2  POST /api/auth/change-password has a guess limit
      test_the_sixth_call_is_refused...      5 calls in a row that do not prove the current password are
                                             answered as usual (400); the 6th - even with the right password
                                             - is 429 ``too_many_attempts``
      ...                                    per account, the wait ends by itself, a refused call does not
                                             extend it, knowing the password ends the streak
      test_..._reset_ends_the_wait           an administrator's reset (API and ``seed_admin --reset``) ends it too
      test_a_cache_outage...                 fail-open: Redis down means no limit and a warning, never a 500
F6  /api/auth/me and login report the effective roles: a superuser always includes ``admin``
F9  /api/auth/me and every /api/admin/users* answer carry ``Cache-Control: no-store``

The cache is the in-process one the root conftest.py installs for every test; the wait is moved forward
with a fake clock (the cache reads ``time.time()``), nothing sleeps.
"""
from __future__ import annotations

import logging
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest
from django.core.cache import cache, caches
from django.core.cache.backends.locmem import LocMemCache

from apps.accounts import password_throttle
from apps.accounts.models import User
from apps.accounts.tests.test_auth_hardening import (
    GOOD_PASSWORD,
    NEW_PASSWORD,
    SEED_PASSWORD,
    change_password,
    login,
    post_json,
    reset_password,
    seed_admin,
)
from apps.accounts.tests.test_permissions import body, call

pytestmark = pytest.mark.django_db

CHANGE_PASSWORD_URL = "/api/auth/change-password"
USERS_URL = "/api/admin/users"
TOO_MANY_BODY = {"detail": "嘗試次數過多，請 5 分鐘後再試", "code": "too_many_attempts"}
NO_STORE = "no-store"


@pytest.fixture(autouse=True)
def fast_password_hashing(settings):
    settings.PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]


@pytest.fixture(autouse=True)
def throttle_settings(settings):
    """Pin the rules so the tests do not depend on the PASSWORD_CHANGE_* environment variables."""
    settings.PASSWORD_CHANGE_FAILURE_LIMIT = 5
    settings.PASSWORD_CHANGE_COOLOFF_MINUTES = 5


@pytest.fixture
def member(make_user) -> User:
    """A viewer who knows GOOD_PASSWORD."""
    return make_user("t_member", ["viewer"], password=GOOD_PASSWORD)


@pytest.fixture
def advance_clock(monkeypatch):
    """advance_clock(seconds): move the clock the cache expires entries by, without sleeping."""
    offset = [0.0]
    real_time = time.time
    monkeypatch.setattr(time, "time", lambda: real_time() + offset[0])

    def advance(seconds: float) -> None:
        offset[0] += seconds

    return advance


def wrong_guess(client):
    return change_password(client, "not-my-password", NEW_PASSWORD)


def wrong_guesses(client, count: int = 5):
    """`count` calls that do not prove the current password; each must still be an ordinary 400."""
    for attempt in range(1, count + 1):
        resp = wrong_guess(client)
        assert resp.status_code == 400, f"call {attempt} must still be answered normally"
        assert "current_password" in body(resp)


# ── F2: the guess limit ──────────────────────────────────────────


def test_tests_never_use_the_configured_cache():
    """Counters keyed by user id must not land in the Redis the development database's accounts live next to."""
    assert isinstance(caches["default"], LocMemCache)


def test_the_sixth_call_is_refused_even_with_the_right_password(member, client_for):
    client = client_for(member)
    wrong_guesses(client, 5)

    refused = wrong_guess(client)
    assert refused.status_code == 429
    assert body(refused) == TOO_MANY_BODY

    right = change_password(client, GOOD_PASSWORD, NEW_PASSWORD)
    assert right.status_code == 429
    assert body(right) == TOO_MANY_BODY
    member.refresh_from_db()
    assert member.check_password(GOOD_PASSWORD)  # nothing was changed


def test_a_refused_call_never_looks_at_the_body(member, client_for):
    client = client_for(member)
    wrong_guesses(client, 5)
    resp = post_json(client, CHANGE_PASSWORD_URL, {})  # would be a 400 for missing fields
    assert resp.status_code == 429
    assert body(resp) == TOO_MANY_BODY


def test_other_accounts_are_not_affected(member, make_user, client_for):
    other = make_user("t_other", ["viewer"], password=GOOD_PASSWORD)
    wrong_guesses(client_for(member), 5)
    assert wrong_guess(client_for(member)).status_code == 429

    assert change_password(client_for(other), GOOD_PASSWORD, NEW_PASSWORD).status_code == 200


def test_the_limit_follows_the_setting(member, client_for, settings):
    settings.PASSWORD_CHANGE_FAILURE_LIMIT = 2
    client = client_for(member)
    wrong_guesses(client, 2)
    assert wrong_guess(client).status_code == 429


def test_the_message_follows_the_configured_wait(member, client_for, settings):
    settings.PASSWORD_CHANGE_COOLOFF_MINUTES = 12
    client = client_for(member)
    wrong_guesses(client, 5)
    assert body(wrong_guess(client)) == {"detail": "嘗試次數過多，請 12 分鐘後再試", "code": "too_many_attempts"}


def test_the_wait_ends_after_the_cool_off(member, client_for, advance_clock):
    client = client_for(member)
    wrong_guesses(client, 5)
    assert wrong_guess(client).status_code == 429

    advance_clock(5 * 60 - 30)
    assert wrong_guess(client).status_code == 429  # 30 seconds to go

    advance_clock(31)
    assert change_password(client, GOOD_PASSWORD, NEW_PASSWORD).status_code == 200  # counted from zero again


def test_refused_calls_do_not_extend_the_wait(member, client_for, advance_clock):
    client = client_for(member)
    wrong_guesses(client, 5)
    advance_clock(4 * 60)
    assert wrong_guess(client).status_code == 429  # hammering while refused ...

    advance_clock(61)  # ... 5 minutes 1 second after the last call that was let in
    assert wrong_guess(client).status_code == 400


def test_the_wait_is_counted_from_the_last_call_that_was_let_in(member, client_for, advance_clock):
    """One early guess must not shorten the wait of the guesses that actually reach the limit."""
    client = client_for(member)
    wrong_guesses(client, 1)
    advance_clock(4 * 60 + 50)  # the first guess is about to leave its window ...
    wrong_guesses(client, 4)  # ... but the 5th guess still falls into it
    assert wrong_guess(client).status_code == 429

    advance_clock(3 * 60)  # more than 5 minutes after the first guess, less than 5 after the 5th
    assert wrong_guess(client).status_code == 429
    advance_clock(2 * 60 + 1)
    assert wrong_guess(client).status_code == 400


def test_the_count_starts_over_after_a_quiet_cool_off(member, client_for, advance_clock):
    client = client_for(member)
    wrong_guesses(client, 4)
    advance_clock(5 * 60 + 1)  # 4 old guesses expire without ever having reached the limit
    wrong_guesses(client, 5)
    assert wrong_guess(client).status_code == 429


def test_a_successful_change_resets_the_count(member, client_for):
    client = client_for(member)
    wrong_guesses(client, 4)
    assert change_password(client, GOOD_PASSWORD, NEW_PASSWORD).status_code == 200
    assert cache.get(password_throttle.cache_key(member)) is None

    wrong_guesses(client, 5)  # a full allowance again (this session survives the change, a fresh one would not)


def test_knowing_the_current_password_ends_the_streak_even_if_the_new_one_is_refused(member, client_for):
    client = client_for(member)
    for _ in range(8):  # more than the limit, but never a wrong current password
        resp = change_password(client, GOOD_PASSWORD, "short")
        assert resp.status_code == 400
        assert "new_password" in body(resp)
    assert change_password(client, GOOD_PASSWORD, NEW_PASSWORD).status_code == 200


def test_the_count_lives_in_the_cache_under_the_user_id(member, client_for):
    client = client_for(member)
    assert password_throttle.cache_key(member).endswith(f":{member.pk}")
    wrong_guesses(client, 2)
    assert cache.get(password_throttle.cache_key(member)) == 2

    wrong_guesses(client, 3)
    assert wrong_guess(client).status_code == 429
    cache.delete(password_throttle.cache_key(member))  # what the end of the wait does
    assert wrong_guess(client).status_code == 400


@pytest.mark.parametrize("variable", ["PASSWORD_CHANGE_FAILURE_LIMIT", "PASSWORD_CHANGE_COOLOFF_MINUTES"])
def test_a_throttle_setting_below_one_is_refused_at_startup(variable):
    """A limit of 0 would refuse every call before the first one; a window of 0 would expire every counter
    at once, so the limit could never trigger. Both must stop startup instead of failing silently."""
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


# ── F2: a password reset ends the wait ───────────────────────────


def test_an_admin_password_reset_ends_the_change_password_wait(member, admin_account, client_for):
    """The user must change the temporary password at the next sign-in: old guesses must not block that."""
    client = client_for(member)
    wrong_guesses(client, 5)
    assert wrong_guess(client).status_code == 429

    resp = reset_password(client_for(admin_account), member)
    assert resp.status_code == 200
    temporary = resp.json()["temporary_password"]
    assert cache.get(password_throttle.cache_key(member)) is None

    fresh = client_for()  # the old session ended with the reset
    assert login(fresh, member.employee_id, temporary).status_code == 200
    assert change_password(fresh, temporary, NEW_PASSWORD).status_code == 200


def test_seed_admin_reset_ends_the_change_password_wait(client_for):
    seed_admin("--password", SEED_PASSWORD)
    client = client_for(User.objects.get(employee_id="admin"))
    wrong_guesses(client, 5)
    assert wrong_guess(client).status_code == 429

    seed_admin("--reset", "--password", SEED_PASSWORD)
    assert cache.get(password_throttle.cache_key(User.objects.get(employee_id="admin"))) is None

    fresh = client_for()
    assert login(fresh, "admin", SEED_PASSWORD).status_code == 200
    assert change_password(fresh, SEED_PASSWORD, NEW_PASSWORD).status_code == 200


def test_seed_admin_without_reset_leaves_the_wait_alone(client_for):
    """An existing account is skipped when --reset is not given, and keeps its wait."""
    seed_admin("--password", SEED_PASSWORD)
    client = client_for(User.objects.get(employee_id="admin"))
    wrong_guesses(client, 5)

    assert "已存在" in seed_admin("--password", SEED_PASSWORD)
    assert wrong_guess(client).status_code == 429


# ── F2: fail-open when the cache is unreachable ───────────────────


def _cache_is_down(monkeypatch, *methods: str) -> None:
    """Make the given cache operations raise, the way a Redis that is down does."""

    def boom(*args, **kwargs):
        raise ConnectionError("redis is down")

    for name in methods:
        monkeypatch.setattr(LocMemCache, name, boom)


def _throttle_warnings(caplog) -> list[logging.LogRecord]:
    return [
        r for r in caplog.records if r.name == "apps.accounts.password_throttle" and r.levelno == logging.WARNING
    ]


def test_a_cache_outage_lets_change_password_through(member, client_for, monkeypatch, caplog):
    _cache_is_down(monkeypatch, "add", "incr", "set", "get", "delete")
    client = client_for(member)
    with caplog.at_level(logging.WARNING, logger="apps.accounts.password_throttle"):
        for attempt in range(1, 9):  # past the limit: nothing can be counted while the cache is down
            resp = wrong_guess(client)
            assert resp.status_code == 400, f"call {attempt}: an outage must not turn into a 500 or a 429"
            assert "current_password" in body(resp)
        done = change_password(client, GOOD_PASSWORD, NEW_PASSWORD)

    assert done.status_code == 200
    member.refresh_from_db()
    assert member.check_password(NEW_PASSWORD)
    assert _throttle_warnings(caplog), "the outage has to be logged"


def test_a_cache_outage_while_forgetting_the_count_does_not_fail_the_change(member, client_for, monkeypatch, caplog):
    client = client_for(member)
    wrong_guesses(client, 2)
    _cache_is_down(monkeypatch, "delete")  # counting works, clearing the count does not
    with caplog.at_level(logging.WARNING, logger="apps.accounts.password_throttle"):
        done = change_password(client, GOOD_PASSWORD, NEW_PASSWORD)

    assert done.status_code == 200
    assert _throttle_warnings(caplog)


def test_a_cache_outage_does_not_break_an_admin_reset(member, admin_account, client_for, monkeypatch, caplog):
    _cache_is_down(monkeypatch, "delete")
    with caplog.at_level(logging.WARNING, logger="apps.accounts.password_throttle"):
        resp = reset_password(client_for(admin_account), member)
        seed_admin("--password", SEED_PASSWORD)
        seed_admin("--reset", "--password", SEED_PASSWORD)  # must not raise either

    assert resp.status_code == 200
    assert "temporary_password" in resp.json()
    assert len(_throttle_warnings(caplog)) >= 2


# ── F6: effective roles ──────────────────────────────────────────


@pytest.mark.parametrize(
    "stored,effective",
    [
        ([], ["admin"]),
        (["viewer"], ["viewer", "admin"]),
        (["admin"], ["admin"]),
        (["admin", "viewer"], ["admin", "viewer"]),
        ("xadminx", ["admin"]),  # malformed JSON counts as no roles, like everywhere else
        ({"viewer": True}, ["admin"]),
    ],
    ids=str,
)
def test_me_lists_admin_for_a_superuser(stored, effective, make_user, client_for):
    superuser = make_user("t_super", [], is_superuser=True)
    User.objects.filter(pk=superuser.pk).update(roles=stored)

    resp = client_for(superuser).get("/api/auth/me")
    assert resp.status_code == 200
    assert resp.json()["roles"] == effective
    superuser.refresh_from_db()
    assert superuser.roles == stored  # effective roles only: nothing is written back


def test_login_lists_admin_for_a_superuser_too(make_user, client_for):
    """The SPA decides where to send the user from the login answer, so it has to be the same list."""
    make_user("t_super", [], is_superuser=True, must_change_password=False, password=GOOD_PASSWORD)
    resp = login(client_for(), "t_super", GOOD_PASSWORD)
    assert resp.status_code == 200
    assert resp.json()["roles"] == ["admin"]


@pytest.mark.parametrize("flags", [{"is_staff": True}, {}], ids=["staff", "plain"])
def test_only_a_superuser_gets_admin_added(flags, make_user, client_for):
    user = make_user("t_plain", [], **flags)
    assert client_for(user).get("/api/auth/me").json()["roles"] == []


def test_the_account_screens_show_the_stored_roles(make_user, admin_account, client_for):
    superuser = make_user("t_super", [], is_superuser=True)
    admin = client_for(admin_account)
    assert admin.get(f"{USERS_URL}/{superuser.pk}").json()["roles"] == []
    listed = {u["employee_id"]: u["roles"] for u in admin.get(USERS_URL).json()}
    assert listed["t_super"] == []


# ── F9: identity and account endpoints are never cached ──────────


def test_me_is_never_cached(accounts, client_for):
    for name, user in accounts.items():
        resp = client_for(user).get("/api/auth/me")
        assert resp.status_code == 200, name
        assert resp["Cache-Control"] == NO_STORE, name


def test_me_is_never_cached_for_a_user_who_must_change_the_password(make_user, client_for):
    user = make_user("t_must_change", ["viewer"], must_change_password=True)
    resp = client_for(user).get("/api/auth/me")
    assert resp.status_code == 200
    assert resp["Cache-Control"] == NO_STORE


def test_a_refused_me_is_not_cached_either(client_for):
    resp = client_for().get("/api/auth/me")
    assert resp.status_code == 403
    assert resp["Cache-Control"] == NO_STORE


def test_me_still_sets_the_csrf_cookie(viewer, client_for):
    """no_store sits between ensure_csrf_cookie and api_view: the cookie the SPA reads must survive."""
    resp = client_for(viewer).get("/api/auth/me")
    assert "csrftoken" in resp.cookies


def _admin_user_requests(victim: User) -> list[tuple[str, str, int]]:
    """(method, url, status an administrator gets) for every /api/admin/users* route; the delete goes last."""
    detail = f"{USERS_URL}/{victim.pk}"
    return [
        ("GET", USERS_URL, 200),
        ("POST", USERS_URL, 400),  # no body: the validation error is a response too
        ("GET", detail, 200),
        ("PATCH", detail, 200),
        ("POST", f"{detail}/reset-password", 200),
        ("GET", f"{USERS_URL}/999999", 404),
        ("POST", f"{USERS_URL}/999999/reset-password", 404),
        ("DELETE", detail, 204),
    ]


def test_every_admin_users_answer_is_never_cached(admin_account, make_user, client_for):
    victim = make_user("t_victim", ["viewer"])
    client = client_for(admin_account)
    for method, url, expected in _admin_user_requests(victim):
        resp = call(client, method, url)
        assert resp.status_code == expected, f"{method} {url}"
        assert resp["Cache-Control"] == NO_STORE, f"{method} {url}"


@pytest.mark.parametrize("who", ["anonymous", "viewer", "reporter", "reviewer"])
def test_refusals_on_admin_users_are_never_cached(who, accounts, make_user, client_for):
    victim = make_user("t_victim", ["viewer"])
    client = client_for(None if who == "anonymous" else accounts[who])
    for method, url, _ in _admin_user_requests(victim):
        resp = call(client, method, url)
        assert resp.status_code == 403, f"{method} {url}"
        assert resp["Cache-Control"] == NO_STORE, f"{method} {url}"
    assert User.objects.filter(pk=victim.pk).exists()


def test_the_password_gate_answer_on_admin_users_is_not_cached(make_user, client_for):
    user = make_user("t_must_change", ["admin"], must_change_password=True)
    resp = client_for(user).get(USERS_URL)
    assert resp.status_code == 403
    assert body(resp)["code"] == "password_change_required"
    assert resp["Cache-Control"] == NO_STORE
