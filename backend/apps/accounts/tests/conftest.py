"""Fixtures for the permission tests: one account per role, plus a no-role account.

Accounts are created through the user manager and signed in with
``Client.force_login`` (the login endpoint is deliberately not involved).
pytest-django runs everything against its own test database.
"""
from __future__ import annotations

import pytest
from django.test import Client

from apps.accounts.models import User

# account name -> User.roles
ROLE_ACCOUNTS: dict[str, list[str]] = {
    "viewer": ["viewer"],
    "reporter": ["reporter"],
    "reviewer": ["reviewer"],
    "admin": ["admin"],
    "norole": [],
}


@pytest.fixture
def make_user(db):
    """make_user("t_x", ["viewer"], is_staff=True) -> saved User (no usable password)."""

    def _make(employee_id: str, roles: list[str] | None = None, **extra) -> User:
        # The model defaults to must_change_password=True; the matrix tests want
        # plain, fully usable accounts unless a test says otherwise.
        extra.setdefault("must_change_password", False)
        # UserManager.create_user() takes `username`; this project's login id is employee_id.
        return User.objects.create_user(
            username=employee_id,
            employee_id=employee_id,
            full_name=f"Test {employee_id}",
            roles=list(roles or []),
            **extra,
        )

    return _make


@pytest.fixture
def accounts(make_user) -> dict[str, User]:
    """The five standard accounts, keyed by ROLE_ACCOUNTS names."""
    return {name: make_user(f"t_{name}", roles) for name, roles in ROLE_ACCOUNTS.items()}


@pytest.fixture
def viewer(accounts) -> User:
    return accounts["viewer"]


@pytest.fixture
def reporter(accounts) -> User:
    return accounts["reporter"]


@pytest.fixture
def reviewer(accounts) -> User:
    return accounts["reviewer"]


@pytest.fixture
def admin_account(accounts) -> User:
    return accounts["admin"]


@pytest.fixture
def norole(accounts) -> User:
    return accounts["norole"]


@pytest.fixture
def client_for():
    """client_for(user) -> signed-in Client; client_for() -> anonymous Client.

    Server errors come back as 500 responses instead of being re-raised, so a
    permission test can tell "allowed but the view failed" apart from a crash
    in the test itself. Extra kwargs go to Client (e.g. enforce_csrf_checks=True).
    """

    def _client(user: User | None = None, **client_kwargs) -> Client:
        client_kwargs.setdefault("raise_request_exception", False)
        client = Client(**client_kwargs)
        if user is not None:
            client.force_login(user)
        return client

    return _client
