"""
``manage.py unlock_account`` (lift a login lockout whatever the letter case) and the Django admin's duplicate check
for account names that differ only in case.

django-axes keeps failures under the case-folded name, so the stock ``axes_reset_username`` (exact match) cannot
unlock an employee id with capital letters; ``unlock_account`` can.
"""
from __future__ import annotations

import io
from datetime import timedelta

import pytest
from axes.models import AccessAttempt
from django.core.cache import cache
from django.core.management import call_command

from apps.accounts import password_throttle
from apps.accounts.models import User
from apps.accounts.tests.test_auth_hardening import GOOD_PASSWORD, lock_out, login

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def fast_hashing_and_pinned_lockout(settings):
    settings.PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
    settings.AXES_FAILURE_LIMIT = 5
    settings.AXES_COOLOFF_TIME = timedelta(minutes=15)


def run(*names) -> str:
    out = io.StringIO()
    call_command("unlock_account", *names, stdout=out)
    return out.getvalue()


# ── unlock_account ───────────────────────────────────────────────


def test_a_mixed_case_name_unlocks_an_account_with_capital_letters(make_user, client_for):
    make_user("Ab12", ["viewer"], password=GOOD_PASSWORD)
    anon = client_for()
    lock_out(anon, "Ab12")
    assert login(anon, "Ab12", GOOD_PASSWORD).status_code == 429  # locked even for the right password

    text = run("aB12")  # neither the stored spelling nor the lower-case one axes keeps

    assert text.startswith("unlocked aB12: ")
    assert not AccessAttempt.objects.filter(username="ab12").exists()
    assert login(anon, "Ab12", GOOD_PASSWORD).status_code == 200


def test_several_names_can_be_unlocked_in_one_call(make_user, client_for):
    for name in ("Ab12", "Cd34"):
        make_user(name, ["viewer"], password=GOOD_PASSWORD)
        lock_out(client_for(), name)

    text = run("AB12", "cd34")

    assert "unlocked AB12:" in text and "unlocked cd34:" in text
    assert AccessAttempt.objects.count() == 0


def test_it_also_forgets_the_change_password_guess_count(make_user):
    user = make_user("Ab12", ["viewer"], password=GOOD_PASSWORD)
    cache.set(password_throttle.cache_key(user), 4, 600)

    run("ab12")

    assert cache.get(password_throttle.cache_key(user)) is None


def test_a_name_without_failures_or_account_is_reported_and_exits_normally(make_user):
    make_user("Ab12", ["viewer"])

    assert run("AB12").strip() == "no attempts for AB12"  # an account, but nothing recorded
    assert run("nobody").strip() == "no attempts for nobody"  # no such account at all
    assert User.objects.count() == 1


def test_other_accounts_keep_their_failures(make_user, client_for):
    make_user("Ab12", ["viewer"], password=GOOD_PASSWORD)
    make_user("Cd34", ["viewer"], password=GOOD_PASSWORD)
    lock_out(client_for(), "Ab12")
    lock_out(client_for(), "Cd34")

    run("AB12")

    assert AccessAttempt.objects.filter(username="cd34").exists()
    assert login(client_for(), "Cd34", GOOD_PASSWORD).status_code == 429


# ── Django admin: employee_id is unique ignoring case ────────────

ADMIN_ADD_URL = "/admin/accounts/user/add/"


@pytest.fixture
def staff_client(make_user, client_for):
    root = make_user("t_root", ["admin"], is_staff=True, is_superuser=True)
    return client_for(root)


def add_payload(employee_id: str) -> dict:
    return {
        "employee_id": employee_id,
        "full_name": "測試人員",
        "email": "",
        "campus": "",
        "roles": '["viewer"]',
        "password1": GOOD_PASSWORD,
        "password2": GOOD_PASSWORD,
    }


def test_the_admin_site_refuses_a_second_spelling_of_an_account_name(staff_client):
    first = staff_client.post(ADMIN_ADD_URL, add_payload("abc"))
    assert first.status_code == 302, first.context["adminform"].form.errors if first.context else first.content
    count = User.objects.count()

    second = staff_client.post(ADMIN_ADD_URL, add_payload("ABC"))

    assert second.status_code == 200  # the form again, with the error
    assert "此帳號已存在（帳號不分大小寫）" in second.context["adminform"].form.errors["employee_id"]
    assert User.objects.count() == count
    assert not User.objects.filter(employee_id="ABC").exists()


def test_the_admin_change_form_checks_case_too_but_not_against_itself(staff_client, make_user):
    make_user("abc", ["viewer"])
    other = make_user("xyz", ["viewer"])
    url = f"/admin/accounts/user/{other.pk}/change/"

    def change_payload(employee_id: str) -> dict:
        return {
            "employee_id": employee_id,
            "password": other.password,  # UserAdminForm renders the hash as an ordinary required field
            "full_name": other.full_name,
            "email": "",
            "campus": "",
            "roles": ["viewer"],
            "is_active": "on",
            "date_joined_0": "2026-01-01",
            "date_joined_1": "00:00:00",
        }

    clash = staff_client.post(url, change_payload("ABC"))
    assert clash.status_code == 200
    assert "此帳號已存在（帳號不分大小寫）" in clash.context["adminform"].form.errors["employee_id"]

    renamed_case_only = staff_client.post(url, change_payload("XYZ"))  # its own name in other letters: allowed
    assert renamed_case_only.status_code == 302, renamed_case_only.context["adminform"].form.errors
    other.refresh_from_db()
    assert other.employee_id == "XYZ"
