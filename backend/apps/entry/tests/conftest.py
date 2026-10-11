"""Fixtures for the entry-system tests (field-level assignment, submission, review).

Everything runs against pytest-django's own test database. The period used throughout is ROC 115/03,
i.e. March 2026; assignments are created in force from 2026-01-01 unless a test says otherwise.
"""
from __future__ import annotations

import datetime
import json
from decimal import Decimal

import pytest
from django.test import Client

from apps.accounts.models import User
from apps.entry.models import Campus, IndicatorAssignment, IndicatorEntry, MonthlyReport, ReportCategory
from apps.indicators.models import Indicator

YEAR, MONTH = 115, 3
IN_FORCE_SINCE = datetime.date(2026, 1, 1)

# code, name, category, unit, has_denominator, entry_mode
INDICATORS = [
    ("HA01-01", "住院死亡率", "整體照護", "percent", True, "manual"),
    ("HA01-02", "14天非計畫再住院率", "整體照護", "percent", True, "manual"),
    ("HA02-11", "呼吸器相關肺炎", "加護照護", "permille", True, "manual"),
    ("HA03-01", "手術後48小時內死亡率", "手術照護", "percent", True, "case_list"),
    ("HA06-31", "安寧共同照護個案數", "重點照護", "count", False, "manual"),
    ("HA10-01", "異常事件通報件數", "經營管理", "count", False, "manual"),
    ("HA10-04", "急性一般病床開放率", "經營管理", "percent", True, "manual"),
]
CATEGORIES = [
    ("HA01", "整體住院照護", 1),
    ("HA02", "加護照護", 2),
    ("HA03", "手術照護", 3),
    ("HA06", "重點照護", 6),
    ("HA10", "經營管理", 10),
]


@pytest.fixture
def make_user(db):
    """make_user("t_x", ["reporter"], full_name="...") -> saved User (no usable password)."""

    def _make(employee_id: str, roles: list[str] | None = None, **extra) -> User:
        extra.setdefault("must_change_password", False)
        extra.setdefault("full_name", f"Name-{employee_id}")
        return User.objects.create_user(
            username=employee_id, employee_id=employee_id, roles=list(roles or []), **extra
        )

    return _make


@pytest.fixture
def users(make_user) -> dict[str, User]:
    return {
        "alice": make_user("alice", ["reporter"]),
        "bob": make_user("bob", ["reporter"]),
        "carol": make_user("carol", ["reporter"]),
        "reviewer": make_user("reviewer", ["reviewer"]),
        "admin": make_user("admin", ["admin"]),
        "viewer": make_user("viewer", ["viewer"]),
    }


@pytest.fixture
def campuses(db) -> dict[str, Campus]:
    return {
        "hsinchu": Campus.objects.create(code="hsinchu", name="新竹", benchmark_level="medical_center"),
        "zhubei": Campus.objects.create(code="zhubei", name="竹北", benchmark_level="regional"),
        "zhudong": Campus.objects.create(code="zhudong", name="竹東", benchmark_level="district"),
    }


@pytest.fixture
def categories(db) -> dict[str, ReportCategory]:
    return {
        code: ReportCategory.objects.create(code=code, name=name, sort_order=order)
        for code, name, order in CATEGORIES
    }


@pytest.fixture
def indicators(db) -> dict[str, Indicator]:
    return {
        code: Indicator.objects.create(
            code=code, name=name, category=category, unit=unit, direction="lower",
            campuses=["竹北", "竹東", "新竹"], has_denominator=has_den, entry_mode=mode,
        )
        for code, name, category, unit, has_den, mode in INDICATORS
    }


@pytest.fixture
def world(campuses, categories, indicators):
    """Campuses, categories and indicators, for tests that do not care about the details."""
    return {"campuses": campuses, "categories": categories, "indicators": indicators}


@pytest.fixture
def assign(campuses):
    """assign(user, "HA01-01", "zhubei", "numerator") -> IndicatorAssignment in force for the test period."""

    def _assign(user, code, campus="zhubei", field="both", *, role="primary",
                effective_from=IN_FORCE_SINCE, effective_to=None) -> IndicatorAssignment:
        return IndicatorAssignment.objects.create(
            indicator_code=code, campus=campuses[campus], user=user, role=role, field=field,
            effective_from=effective_from, effective_to=effective_to,
        )

    return _assign


@pytest.fixture
def make_report(campuses, categories):
    """make_report("zhubei", "HA01", "submitted") -> MonthlyReport of the test period."""

    def _make(campus: str, category: str, status: str = "draft", **extra) -> MonthlyReport:
        return MonthlyReport.objects.create(
            campus=campuses[campus], category=categories[category], year=YEAR, month=MONTH,
            status=status, **extra,
        )

    return _make


@pytest.fixture
def entry_for():
    """entry_for(report, "HA01-01", 5, 100) -> IndicatorEntry with the given numbers (value computed by hand)."""

    def _entry(report, code, numerator=None, denominator=None, value=None, **extra) -> IndicatorEntry:
        to_dec = lambda x: None if x is None else Decimal(str(x))  # noqa: E731
        return IndicatorEntry.objects.create(
            report=report, indicator_code=code, numerator=to_dec(numerator), denominator=to_dec(denominator),
            value=to_dec(value), **extra,
        )

    return _entry


class EntryApi:
    """The entry endpoints as one signed-in user sees them; every method returns the HTTP response."""

    def __init__(self, client: Client):
        self.client = client

    def tasks(self, year: int = YEAR, month: int = MONTH):
        return self.client.get("/api/entry/my-tasks", {"year": year, "month": month})

    def form(self, category: str, campus: str | None = None, year: int = YEAR, month: int = MONTH):
        params = {"year": year, "month": month, "category": category}
        if campus:
            params["campus"] = campus
        return self.client.get("/api/entry/form", params)

    def _post(self, url: str, payload: dict):
        return self.client.post(url, data=json.dumps(payload), content_type="application/json")

    def save(self, category: str, entries, campus: str | None = None, year: int = YEAR, month: int = MONTH):
        payload = {"year": year, "month": month, "category": category, "entries": entries}
        if campus:
            payload["campus"] = campus
        return self._post("/api/entry/save-draft", payload)

    def submit(self, category: str, campus: str | None = None, year: int = YEAR, month: int = MONTH):
        payload = {"year": year, "month": month, "category": category}
        if campus:
            payload["campus"] = campus
        return self._post("/api/entry/submit", payload)


@pytest.fixture
def client_for():
    """client_for(user) -> signed-in Client; server errors come back as 500 responses, not exceptions."""

    def _client(user: User | None = None, **client_kwargs) -> Client:
        client_kwargs.setdefault("raise_request_exception", False)
        client = Client(**client_kwargs)
        if user is not None:
            client.force_login(user)
        return client

    return _client


@pytest.fixture
def api_for(client_for):
    """api_for(user) -> EntryApi for that user."""

    def _api(user: User) -> EntryApi:
        return EntryApi(client_for(user))

    return _api
