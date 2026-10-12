"""Cache of GET /api/v1/dashboard/ (apps/indicators/cache.py).

  hit and miss          the first request computes and stores, the second is served without touching the dashboard
                        tables; every reader role shares one entry; the role check still runs first
  keys                  campus, category and search each get their own entry; awkward text cannot collide or warn
  invalidation          every write that can change the dashboard (API, management commands, Django admin) makes the
                        next request a MISS that shows the new data, also when the write fails half way (commands
                        included); a refused write changes nothing
  stale reads           a reader that started before a write cannot file its older result under the newer version
  fail-open             a broken cache costs the speed-up and logs a warning, never a 500
  switch and settings   DASHBOARD_CACHE_ENABLED (on by default only with a Redis), the TTL, the counter that never
                        expires, the Redis timeouts

Nothing here talks to Redis: backend/conftest.py gives every test its own in-process cache.
"""
from __future__ import annotations

import io
import json
import logging
import re
import warnings

import environ
import pytest
from django.contrib import admin
from django.core.cache import cache
from django.core.cache.backends.base import DEFAULT_TIMEOUT, CacheKeyWarning
from django.core.cache.backends.locmem import LocMemCache
from django.core.cache.backends.redis import RedisCache
from django.core.exceptions import ImproperlyConfigured
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.db import connection
from django.test import Client, RequestFactory
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from openpyxl import Workbook

from apps.accounts.models import User
from apps.imports.models import ImportLog
from apps.imports.services.excel_parser import ParsedDataPoint, ParseResult
from apps.indicators import views
from apps.indicators.admin import IndicatorAdmin
from apps.indicators.cache import (
    VERSION_KEY,
    bump_dashboard_cache,
    dashboard_cache_version,
    get_dashboard_payload,
    set_dashboard_payload,
)
from apps.indicators.constants import INDICATOR_META
from apps.indicators.management.commands import refresh_alerts, seed_indicators
from apps.indicators.models import Alert, DataPoint, Indicator, TCPIBenchmark
from config.settings.base import cache_config, dashboard_cache_settings

pytestmark = pytest.mark.django_db

URL = "/api/v1/dashboard/"
HEADER = "X-Dashboard-Cache"

# The tables the dashboard is computed from. A cache hit must not query any of them.
DASHBOARD_TABLE = re.compile(r'"(?:indicators|data_points|alerts|yearly_summaries|tcpi_benchmarks)"')
# A payload key as the cache stores it (prefix and version in front); the "dashboard:version" counter does not match.
PAYLOAD_KEY = re.compile(r"dashboard:v\d+:")


# ── Fixtures and helpers ─────────────────────────────────────────


def make_user(employee_id: str, roles: list[str], **extra) -> User:
    extra.setdefault("must_change_password", False)  # the model defaults to True, which the API refuses outright
    return User.objects.create_user(
        username=employee_id, employee_id=employee_id, full_name=f"Test {employee_id}", roles=roles, **extra
    )


def signed_in(user: User | None = None) -> Client:
    client = Client()
    if user is not None:
        client.force_login(user)
    return client


@pytest.fixture(autouse=True)
def cache_switched_on(settings):
    """Run these tests with the dashboard cache on, whatever the environment of the test run says.

    The switch defaults to off without REDIS_URL (see dashboard_cache_settings), while the tests always use the
    in-process cache of backend/conftest.py, REDIS_URL or not.
    """
    settings.DASHBOARD_CACHE_ENABLED = True


@pytest.fixture
def as_viewer() -> Client:
    return signed_in(make_user("t_viewer", ["viewer"]))


@pytest.fixture
def as_admin() -> Client:
    return signed_in(make_user("t_admin", ["admin"]))


@pytest.fixture
def world() -> dict[str, Indicator]:
    """Three indicators (HA01-01 in all campuses, HA02-11 in two, HA06-31 in 竹北 only) with 竹北 data."""
    indicators = {
        code: Indicator.objects.create(
            code=code, name=name, category=category, unit=unit, direction=direction, data_nature=nature,
            campuses=campuses,
        )
        for code, name, category, unit, direction, nature, campuses in [
            ("HA01-01", "住院死亡率", "整體照護", "percent", "lower", "binomial_rate", ["竹北", "竹東", "新竹"]),
            ("HA02-11", "呼吸器相關肺炎", "加護照護", "permille", "lower", "binomial_rate", ["竹北", "竹東"]),
            ("HA06-31", "安寧共同照護個案數", "重點照護", "count", "higher", "continuous", ["竹北"]),
        ]
    }
    # HA01-01, 竹北, 115/01..115/06: 2.0 2.2 1.9 2.1 2.0, and 2.5 for the latest month
    for month, numerator in enumerate([20, 22, 19, 21, 20, 25], start=1):
        DataPoint.objects.create(
            indicator=indicators["HA01-01"], campus="竹北", year=115, month=month,
            value=numerator / 10, numerator=numerator, denominator=1000,
        )
    for month in (1, 2, 3):
        DataPoint.objects.create(
            indicator=indicators["HA02-11"], campus="竹北", year=115, month=month,
            value=1.0, numerator=1, denominator=1000,
        )
    Alert.objects.create(
        indicator=indicators["HA01-01"], campus="竹北", year=115, month=6,
        mechanism="control_chart", rule="test", severity="warning", message="test alert",
    )
    TCPIBenchmark.objects.create(
        indicator=indicators["HA01-01"], tcpi_name="住院死亡率", year=114, regional_hospital=1.8,
    )
    return indicators


def get(client: Client, **params):
    return client.get(URL, {"campus": "竹北", **params})


def send_json(client: Client, method: str, url: str, body: dict):
    return getattr(client, method)(url, data=json.dumps(body), content_type="application/json")


def patch_target(client: Client, code: str = "HA01-01", **body):
    return send_json(client, "patch", f"/api/v1/indicators/{code}/", body or {"target_mode": True, "target_value": 1.0})


def post_tcpi(client: Client, *benchmarks):
    return send_json(client, "post", "/api/v1/tcpi/", {"benchmarks": list(benchmarks)})


def correct(client: Client, log: ImportLog, new_value: float = 9.9):
    return send_json(client, "post", "/api/v1/imports/correct-datapoint/", {
        "indicator_code": "HA01-01", "campus": "竹北", "year": 115, "month": 6,
        "new_value": new_value, "log_id": log.id, "error_text": "warn",
    })


def blank_workbook() -> SimpleUploadedFile:
    buffer = io.BytesIO()
    Workbook().save(buffer)
    return SimpleUploadedFile("blank.xlsx", buffer.getvalue())


def by_code(answer) -> dict[str, dict]:
    """The indicators of a dashboard answer (a response or an already decoded payload), keyed by code."""
    payload = answer if isinstance(answer, dict) else answer.json()
    return {row["code"]: row for row in payload["data"]}


def alerts_shown(answer, code: str = "HA01-01") -> list[tuple]:
    """The (year, month, severity, mechanism) of the alerts a dashboard answer shows for an indicator."""
    alerts = by_code(answer)[code]["monthly_alerts"]
    return sorted((a["year"], a["month"], a["severity"], a["mechanism"]) for a in alerts)


def alerts_stored(code: str = "HA01-01", campus: str = "竹北") -> list[tuple]:
    """The same tuples, straight from the database."""
    rows = Alert.objects.filter(indicator_id=code, campus=campus)
    return sorted((a.year, a.month, a.severity, a.mechanism) for a in rows)


def dashboard_queries(captured: CaptureQueriesContext) -> list[str]:
    return [q["sql"] for q in captured.captured_queries if DASHBOARD_TABLE.search(q["sql"])]


def dashboard_keys() -> list[str]:
    """Keys of the in-process cache that belong to the dashboard (LocMemCache keeps them in ``_cache``)."""
    return [key for key in cache._cache if "dashboard" in key]


def warm(client: Client, **params) -> dict:
    """Make sure the cache holds this request (the second answer is a HIT) and return its payload."""
    first = get(client, **params)
    assert first.status_code == 200
    assert get(client, **params)[HEADER] == "HIT", "the cache should be warm"
    return first.json()


def cache_is_down(monkeypatch, *methods: str) -> None:
    """Make the given cache operations raise, the way a Redis that is down does."""

    def boom(*args, **kwargs):
        raise ConnectionError("redis is down")

    for name in methods:
        monkeypatch.setattr(LocMemCache, name, boom)


ALL_CACHE_OPERATIONS = ("get", "get_or_set", "add", "set", "incr", "delete")


def cache_warnings(caplog) -> list[logging.LogRecord]:
    return [r for r in caplog.records if r.name == "apps.indicators.cache" and r.levelno == logging.WARNING]


# ── Hit and miss ─────────────────────────────────────────────────


def test_the_first_request_is_a_miss_that_reads_the_database(as_viewer, world):
    with CaptureQueriesContext(connection) as queries:
        resp = get(as_viewer)

    assert resp.status_code == 200
    assert resp[HEADER] == "MISS"
    assert resp.json()["total"] == 3
    assert any('"data_points"' in sql for sql in dashboard_queries(queries))


def test_the_second_request_is_a_hit_that_queries_no_dashboard_table(as_viewer, world):
    first = get(as_viewer)

    with CaptureQueriesContext(connection) as queries:
        second = get(as_viewer)

    assert second.status_code == 200
    assert second[HEADER] == "HIT"
    assert second.json() == first.json()
    assert queries.captured_queries, "the session and the user are still looked up: the capture works"
    assert dashboard_queries(queries) == []


def test_the_payload_comes_back_unchanged_from_the_cache(as_viewer, world):
    miss = get(as_viewer)
    hit = get(as_viewer)
    row = by_code(hit)["HA01-01"]

    assert hit.content == miss.content
    assert (row["latest_value"], row["latest_period"], row["status"]) == (2.5, "115.06", "warning")
    assert row["peer_value"] == 1.8 and row["peer_source"] == "TCPI"
    assert len(row["monthly_data"]) == 6


def test_every_reader_role_shares_one_entry(world):
    viewer = signed_in(make_user("t_v", ["viewer"]))
    reviewer = signed_in(make_user("t_r", ["reviewer"]))
    administrator = signed_in(make_user("t_a", ["admin"]))

    assert get(viewer)[HEADER] == "MISS"
    assert get(reviewer)[HEADER] == "HIT"
    assert get(administrator)[HEADER] == "HIT"


@pytest.mark.parametrize("who", ["anonymous", "no_role", "reporter", "must_change_password"])
def test_the_role_check_runs_before_the_cache(who, as_viewer, world):
    warm(as_viewer)
    users = {
        "anonymous": None,
        "no_role": make_user("t_none", []),
        "reporter": make_user("t_rep", ["reporter"]),
        "must_change_password": make_user("t_new", ["viewer"], must_change_password=True),
    }

    resp = get(signed_in(users[who]))

    assert resp.status_code == 403
    assert HEADER not in resp
    assert "latest_value" not in resp.content.decode()


def test_the_query_string_is_part_of_the_answer(as_viewer, world):
    """campus, category and search are different questions: each is computed once, then served on its own."""
    questions = [
        ({}, 3),
        ({"campus": "竹東"}, 2),
        ({"category": "整體照護"}, 1),
        ({"search": "HA02"}, 1),
        ({"campus": "竹東", "category": "加護照護", "search": "肺炎"}, 1),
    ]
    for params, total in questions:
        resp = as_viewer.get(URL, {"campus": "竹北", **params})
        assert resp[HEADER] == "MISS", f"{params} must not be answered from another question's entry"
        assert resp.json()["total"] == total, params

    for params, total in questions:
        resp = as_viewer.get(URL, {"campus": "竹北", **params})
        assert resp[HEADER] == "HIT", params
        assert resp.json()["total"] == total, params
    assert len([key for key in dashboard_keys() if ":v1:" in key]) == len(questions)


def test_leaving_out_the_campus_is_the_same_question_as_asking_for_the_default(as_viewer, world):
    assert as_viewer.get(URL)[HEADER] == "MISS"  # the view defaults to 竹北
    assert as_viewer.get(URL, {"campus": "竹北"})[HEADER] == "HIT"
    assert as_viewer.get(URL, {"campus": ""})[HEADER] == "MISS"  # an empty campus is a different (empty) answer


# ── The key ──────────────────────────────────────────────────────


def test_parts_that_differ_never_share_an_entry():
    """Without escaping the first three would all be "a:b:c:d"; escaping ":" but not "%" would merge the next two."""
    stored = [
        ("a:b", "c", "d"), ("a", "b:c", "d"), ("a", "b", "c:d"),
        ("x%3Ay", "", ""), ("x:y", "", ""),
        ("a", "", "b"), ("", "a", "b"),
    ]
    for index, parts in enumerate(stored):
        assert set_dashboard_payload(parts, {"who": index}) is True
    for index, parts in enumerate(stored):
        assert get_dashboard_payload(parts) == {"who": index}


def test_text_with_spaces_and_control_characters_is_stored_without_cache_key_warnings():
    parts = ("竹北", "", "hand hygiene\n\t\x00 x")
    with warnings.catch_warnings():
        warnings.simplefilter("error", CacheKeyWarning)
        assert set_dashboard_payload(parts, {"ok": True}) is True
        assert get_dashboard_payload(parts) == {"ok": True}


def test_a_request_with_an_absurdly_long_search_is_computed_but_not_stored(as_viewer, world):
    first = get(as_viewer, search="x" * 1000)
    second = get(as_viewer, search="x" * 1000)

    assert (first.status_code, second.status_code) == (200, 200)
    assert (first[HEADER], second[HEADER]) == ("BYPASS", "BYPASS")
    assert all("xxxxxxxxxx" not in key for key in dashboard_keys())


def test_a_payload_filed_under_a_wrong_type_is_ignored():
    assert set_dashboard_payload(("竹北", "", ""), "not a dict") is True  # type: ignore[arg-type]
    assert get_dashboard_payload(("竹北", "", "")) is None


# ── Invalidation ─────────────────────────────────────────────────


def test_bump_makes_the_next_request_a_miss(as_viewer, world):
    warm(as_viewer)
    before = dashboard_cache_version()

    bump_dashboard_cache()

    assert dashboard_cache_version() == before + 1
    with CaptureQueriesContext(connection) as queries:
        resp = get(as_viewer)
    assert resp[HEADER] == "MISS"
    assert any('"data_points"' in sql for sql in dashboard_queries(queries))
    assert get(as_viewer)[HEADER] == "HIT"


def test_bump_creates_the_counter_when_it_is_missing(as_viewer, world):
    warm(as_viewer)
    cache.delete(VERSION_KEY)  # evicted, or never written

    bump_dashboard_cache()

    assert cache.get(VERSION_KEY) == 2
    assert get(as_viewer)[HEADER] == "MISS"  # not the entry that was filed under version 1


def test_patching_a_target_invalidates_and_the_rewritten_alerts_show(as_admin, world):
    before = alerts_shown(warm(as_admin))
    assert before == alerts_stored(), "the cached answer matches the database"

    resp = patch_target(as_admin)  # rewrites the alerts of the indicator against the new target

    assert resp.status_code == 200
    after = get(as_admin)
    assert after[HEADER] == "MISS"
    assert alerts_stored() != before, "the write changed the alerts"
    assert alerts_shown(after) == alerts_stored()
    assert get(as_admin)[HEADER] == "HIT"


def test_a_tcpi_import_invalidates_and_the_new_peer_value_shows(as_admin, world):
    assert by_code(warm(as_admin))["HA01-01"]["peer_value"] == 1.8

    resp = post_tcpi(as_admin, {"indicatorCode": "HA01-01", "tcpiName": "x", "year": 114, "regionalHospital": 3.3})

    assert resp.status_code == 200 and resp.json()["saved"] == 1
    after = get(as_admin)
    assert after[HEADER] == "MISS"
    assert by_code(after)["HA01-01"]["peer_value"] == 3.3


def test_correcting_a_data_point_invalidates_and_the_new_value_shows(as_admin, world):
    log = ImportLog.objects.create(file_name="a.xlsx", file_size=1, errors=["warn"])
    assert by_code(warm(as_admin))["HA01-01"]["latest_value"] == 2.5

    resp = correct(as_admin, log)

    assert resp.status_code == 200
    after = get(as_admin)
    assert after[HEADER] == "MISS"
    assert by_code(after)["HA01-01"]["latest_value"] == 9.9


def test_an_upload_invalidates_even_when_it_adds_nothing(as_admin, world):
    warm(as_admin)

    resp = as_admin.post("/api/v1/imports/upload/", {"file": blank_workbook()})

    assert resp.status_code == 200
    assert ImportLog.objects.count() == 1
    assert get(as_admin)[HEADER] == "MISS"


def test_an_upload_that_adds_a_month_invalidates_and_the_new_month_shows(as_admin, world, monkeypatch):
    parsed = ParseResult(
        data_points=[ParsedDataPoint(
            indicator_code="HA01-01", campus="竹北", year=115, month=7, value=3.0, numerator=30, denominator=1000,
        )],
        sheets_processed=["115年竹北"],
    )
    monkeypatch.setattr("apps.imports.services.excel_parser.parse_qip_excel", lambda file_bytes, file_name: parsed)
    row = by_code(warm(as_admin))["HA01-01"]
    assert (row["latest_period"], row["latest_value"], len(row["monthly_data"])) == ("115.06", 2.5, 6)

    resp = as_admin.post("/api/v1/imports/upload/", {"file": blank_workbook()})

    assert resp.status_code == 200 and resp.json()["data"]["new"] == 1
    after = get(as_admin)
    assert after[HEADER] == "MISS"
    row = by_code(after)["HA01-01"]
    assert (row["latest_period"], row["latest_value"], len(row["monthly_data"])) == ("115.07", 3.0, 7)


def test_refreshing_the_alerts_invalidates_and_the_rewritten_alerts_show(as_admin, world):
    before = alerts_shown(warm(as_admin))  # the one alert the fixture made by hand
    assert before == alerts_stored()

    call_command("refresh_alerts", stdout=io.StringIO())

    after = get(as_admin)
    assert after[HEADER] == "MISS"
    assert alerts_stored() != before, "the command rewrote the alerts"
    assert alerts_shown(after) == alerts_stored()
    assert get(as_admin)[HEADER] == "HIT"


def test_wiping_the_data_invalidates_and_the_dashboard_shows_it(as_admin, world):
    assert by_code(warm(as_admin))["HA01-01"]["latest_value"] == 2.5

    call_command("wipe_datapoints", "--yes", stdout=io.StringIO())

    after = get(as_admin)
    assert after[HEADER] == "MISS"
    assert by_code(after)["HA01-01"]["latest_value"] is None
    assert by_code(after)["HA01-01"]["status"] == "neutral"


def test_a_cancelled_wipe_changes_nothing(as_admin, world, monkeypatch):
    warm(as_admin)
    monkeypatch.setattr("builtins.input", lambda prompt="": "no")

    call_command("wipe_datapoints", stdout=io.StringIO())

    assert DataPoint.objects.exists()
    assert get(as_admin)[HEADER] == "HIT"


@pytest.mark.parametrize("flags", [("--only-missing",), ()], ids=["only-missing", "update-all"])
def test_seeding_the_indicators_invalidates_and_the_new_rows_show(flags, as_admin, world):
    assert warm(as_admin)["total"] == 3

    call_command("seed_indicators", *flags, stdout=io.StringIO())

    after = get(as_admin)
    assert after[HEADER] == "MISS"
    assert after.json()["total"] > 3


def test_editing_in_the_django_admin_invalidates_after_the_commit(as_viewer, world, django_capture_on_commit_callbacks):
    warm(as_viewer)
    indicator = Indicator.objects.get(code="HA06-31")
    indicator.is_active = False

    with django_capture_on_commit_callbacks(execute=False) as callbacks:
        IndicatorAdmin(Indicator, admin.site).save_model(RequestFactory().post("/"), indicator, None, True)

    assert get(as_viewer)[HEADER] == "HIT", "nothing is invalidated while the edit can still be rolled back"
    for callback in callbacks:  # the commit
        callback()
    after = get(as_viewer)
    assert after[HEADER] == "MISS"
    assert after.json()["total"] == 2


def test_deleting_in_the_django_admin_invalidates(as_viewer, world, django_capture_on_commit_callbacks):
    assert by_code(warm(as_viewer))["HA01-01"]["latest_value"] == 2.5
    superuser = User.objects.create_superuser(
        username="t_root", employee_id="t_root", full_name="Root", email="root@example.org",
        password="not-used-by-force-login", must_change_password=False,
    )
    latest = DataPoint.objects.get(indicator_id="HA01-01", campus="竹北", year=115, month=6)
    url = reverse("admin:indicators_datapoint_delete", args=[latest.pk])

    with django_capture_on_commit_callbacks(execute=True):
        resp = signed_in(superuser).post(url, {"post": "yes"})

    assert resp.status_code == 302
    after = get(as_viewer)
    assert after[HEADER] == "MISS"
    assert by_code(after)["HA01-01"]["latest_value"] == 2.0


def test_deleting_selected_rows_in_the_django_admin_invalidates(as_viewer, world, django_capture_on_commit_callbacks):
    warm(as_viewer)
    queryset = DataPoint.objects.filter(indicator_id="HA02-11")

    with django_capture_on_commit_callbacks(execute=True):
        admin.site._registry[DataPoint].delete_queryset(RequestFactory().post("/"), queryset)

    after = get(as_viewer)
    assert after[HEADER] == "MISS"
    assert by_code(after)["HA02-11"]["latest_value"] is None


# A write that fails half way has still changed rows: it invalidates all the same.


def test_a_patch_that_fails_half_way_still_invalidates(as_admin, world, monkeypatch):
    warm(as_admin)

    def boom(indicator):
        raise RuntimeError("alerts could not be rewritten")

    monkeypatch.setattr(views, "_refresh_indicator_alerts", boom)

    with pytest.raises(RuntimeError, match="could not be rewritten"):
        patch_target(as_admin)

    assert Indicator.objects.get(code="HA01-01").target_value == 1.0  # the indicator itself was saved
    assert get(as_admin)[HEADER] == "MISS"


def test_a_tcpi_import_that_fails_half_way_still_invalidates(as_admin, world):
    warm(as_admin)

    with pytest.raises(AttributeError):  # the second item is not an object: raised after the first row is saved
        post_tcpi(
            as_admin,
            {"indicatorCode": "HA01-01", "tcpiName": "x", "year": 114, "regionalHospital": 3.3},
            "not an object",
        )

    assert TCPIBenchmark.objects.count() == 1  # the old rows are gone, one new row is in
    after = get(as_admin)
    assert after[HEADER] == "MISS"
    assert by_code(after)["HA01-01"]["peer_value"] == 3.3


def test_an_upload_that_fails_half_way_still_invalidates(as_admin, world, monkeypatch):
    warm(as_admin)

    def save_one_then_fail(parse_result, file_name, file_size):
        DataPoint.objects.filter(indicator_id="HA01-01", month=6).update(value=7.7)
        raise RuntimeError("stopped half way")

    monkeypatch.setattr("apps.imports.services.persistence.save_import_results", save_one_then_fail)

    with pytest.raises(RuntimeError, match="stopped half way"):
        as_admin.post("/api/v1/imports/upload/", {"file": blank_workbook()})

    after = get(as_admin)
    assert after[HEADER] == "MISS"
    assert by_code(after)["HA01-01"]["latest_value"] == 7.7


def test_refresh_alerts_that_fails_half_way_still_invalidates(as_admin, world, monkeypatch):
    warm(as_admin)
    real_analysis = refresh_alerts.analyze_indicator
    calls = []

    def fail_on_the_second_pair(*args, **kwargs):
        calls.append(args)
        if len(calls) == 2:
            raise RuntimeError("analysis failed")
        return real_analysis(*args, **kwargs)

    monkeypatch.setattr(refresh_alerts, "analyze_indicator", fail_on_the_second_pair)

    with pytest.raises(RuntimeError, match="analysis failed"):
        call_command("refresh_alerts", stdout=io.StringIO())

    assert not Alert.objects.filter(rule="test").exists(), "the first indicator's alerts were already rewritten"
    assert get(as_admin)[HEADER] == "MISS"


def test_seeding_that_fails_half_way_still_invalidates(as_admin, world, monkeypatch):
    warm(as_admin)
    code, meta = next(iter(INDICATOR_META.items()))
    monkeypatch.setattr(seed_indicators, "INDICATOR_META", {code: meta, "HA99-99": {}})  # the second has no fields

    with pytest.raises(KeyError):
        call_command("seed_indicators", stdout=io.StringIO())

    assert Indicator.objects.get(code=code).source == "preset", "the first indicator was already written"
    assert get(as_admin)[HEADER] == "MISS"


# A write that is refused or rejected changes nothing: the cache stays valid.


def test_refused_and_rejected_writes_leave_the_cache_alone(as_admin, as_viewer, world):
    warm(as_admin)
    corrupt = SimpleUploadedFile("bad.xlsx", b"plain text, not a workbook")
    outcomes = {
        "viewer patch": (patch_target(as_viewer), 403),
        "viewer tcpi": (post_tcpi(as_viewer, {"indicatorCode": "HA01-01", "year": 114}), 403),
        "viewer upload": (as_viewer.post("/api/v1/imports/upload/", {"file": blank_workbook()}), 403),
        "viewer correct": (correct(as_viewer, ImportLog(id=1)), 403),
        "non-numeric target": (patch_target(as_admin, target_mode=True, target_value="abc"), 400),
        "unknown indicator": (patch_target(as_admin, "HA99-99"), 404),
        "empty tcpi import": (post_tcpi(as_admin), 400),
        "upload without a file": (as_admin.post("/api/v1/imports/upload/", {}), 400),
        "upload of a non-workbook": (as_admin.post("/api/v1/imports/upload/", {"file": corrupt}), 400),
        "correct without fields": (send_json(as_admin, "post", "/api/v1/imports/correct-datapoint/", {}), 400),
        "correct of a missing point": (
            send_json(as_admin, "post", "/api/v1/imports/correct-datapoint/", {
                "indicator_code": "HA01-01", "campus": "竹北", "year": 99, "month": 1, "new_value": 1, "log_id": 1,
            }),
            404,
        ),
    }
    for name, (resp, status) in outcomes.items():
        assert resp.status_code == status, name

    assert get(as_admin)[HEADER] == "HIT"
    assert TCPIBenchmark.objects.count() == 1
    assert not ImportLog.objects.exists()


# ── Stale reads ──────────────────────────────────────────────────


def test_a_result_computed_before_a_bump_cannot_be_filed_under_the_new_version():
    parts = ("竹北", "", "")
    version = dashboard_cache_version()  # the reader starts here and reads the database ...
    bump_dashboard_cache()  # ... a writer commits and invalidates ...

    stored = set_dashboard_payload(parts, {"computed": "before the write"}, version=version)  # ... the reader is done

    assert stored is True
    assert get_dashboard_payload(parts) is None, "the old result must not be served under the new version"
    assert get_dashboard_payload(parts, version=version) == {"computed": "before the write"}


def test_the_view_files_its_result_under_the_version_it_started_with(as_viewer, world, monkeypatch):
    """A write that lands while the dashboard is being computed: the next request must compute again."""
    real_set = views.set_dashboard_payload

    def set_after_a_concurrent_write(*args, **kwargs):
        bump_dashboard_cache()
        return real_set(*args, **kwargs)

    monkeypatch.setattr(views, "set_dashboard_payload", set_after_a_concurrent_write)
    assert get(as_viewer)[HEADER] == "MISS"
    monkeypatch.undo()

    assert get(as_viewer)[HEADER] == "MISS", "the first answer was computed from data that is out of date by now"
    assert get(as_viewer)[HEADER] == "HIT"


def test_no_version_means_no_cache():
    parts = ("竹北", "", "")
    assert set_dashboard_payload(parts, {"x": 1}, version=None) is False
    assert get_dashboard_payload(parts, version=None) is None
    assert dashboard_keys() == []


# ── Fail-open ────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "broken",
    [("get",), ("add",), ("set",), ALL_CACHE_OPERATIONS],
    ids=["get", "add", "set", "everything"],
)
def test_a_broken_cache_never_breaks_the_dashboard(broken, as_viewer, world, monkeypatch, caplog):
    cache_is_down(monkeypatch, *broken)

    with caplog.at_level(logging.WARNING, logger="apps.indicators.cache"):
        answers = [get(as_viewer) for _ in range(3)]

    for resp in answers:
        assert resp.status_code == 200, "a cache outage must not turn into a 500"
        assert resp[HEADER] == "BYPASS"
        assert resp.json()["total"] == 3
    assert cache_warnings(caplog), "the outage has to be logged"


def test_a_failing_payload_read_is_a_miss_not_an_error(as_viewer, world, monkeypatch, caplog):
    real_get = LocMemCache.get

    def get_fails_for_payloads(self, key, default=None, version=None):
        if PAYLOAD_KEY.match(key):  # a payload, not the "dashboard:version" counter
            raise ConnectionError("redis is down")
        return real_get(self, key, default, version)

    monkeypatch.setattr(LocMemCache, "get", get_fails_for_payloads)

    with caplog.at_level(logging.WARNING, logger="apps.indicators.cache"):
        answers = [get(as_viewer) for _ in range(2)]

    assert [resp.status_code for resp in answers] == [200, 200]
    assert [resp[HEADER] for resp in answers] == ["MISS", "MISS"]  # computed and stored, but never read back
    assert cache_warnings(caplog)


def test_writes_go_through_while_the_cache_is_down(as_admin, world, monkeypatch, caplog):
    log = ImportLog.objects.create(file_name="a.xlsx", file_size=1, errors=["warn"])
    cache_is_down(monkeypatch, *ALL_CACHE_OPERATIONS)

    with caplog.at_level(logging.WARNING, logger="apps.indicators.cache"):
        assert patch_target(as_admin).status_code == 200
        tcpi = post_tcpi(as_admin, {"indicatorCode": "HA01-01", "tcpiName": "x", "year": 114, "regionalHospital": 3.3})
        assert tcpi.status_code == 200
        assert correct(as_admin, log).status_code == 200
        assert as_admin.post("/api/v1/imports/upload/", {"file": blank_workbook()}).status_code == 200
        assert get(as_admin).status_code == 200

    assert TCPIBenchmark.objects.get().regional_hospital == 3.3
    assert DataPoint.objects.get(indicator_id="HA01-01", month=6).value == 9.9
    assert len(cache_warnings(caplog)) >= 4, "each of the four writes tried to invalidate and said so"


def test_management_commands_and_the_admin_survive_a_cache_outage(
    world, monkeypatch, caplog, django_capture_on_commit_callbacks
):
    cache_is_down(monkeypatch, *ALL_CACHE_OPERATIONS)
    indicator = Indicator.objects.get(code="HA06-31")

    with caplog.at_level(logging.WARNING, logger="apps.indicators.cache"):
        call_command("refresh_alerts", stdout=io.StringIO())
        call_command("seed_indicators", "--only-missing", stdout=io.StringIO())
        call_command("wipe_datapoints", "--yes", stdout=io.StringIO())
        with django_capture_on_commit_callbacks(execute=True):
            IndicatorAdmin(Indicator, admin.site).save_model(RequestFactory().post("/"), indicator, None, True)

    assert not DataPoint.objects.exists()
    assert len(cache_warnings(caplog)) == 4, "one warning for each of the three commands and the admin save"


# ── The switch, the TTL and the counter ──────────────────────────


def test_the_switch_turns_the_cache_off(as_viewer, world, settings):
    settings.DASHBOARD_CACHE_ENABLED = False

    with CaptureQueriesContext(connection) as queries:
        first, second = get(as_viewer), get(as_viewer)

    assert (first.status_code, second.status_code) == (200, 200)
    assert (first[HEADER], second[HEADER]) == ("BYPASS", "BYPASS")
    assert first.json() == second.json()
    assert len([sql for sql in dashboard_queries(queries) if '"data_points"' in sql]) == 2, "computed both times"
    assert dashboard_keys() == [], "nothing is read from or written to the cache"


def test_a_cache_that_was_off_cannot_serve_what_was_written_meanwhile(as_viewer, world, settings):
    warm(as_viewer)
    settings.DASHBOARD_CACHE_ENABLED = False
    bump_dashboard_cache()  # a write made while the cache is off still moves the counter
    settings.DASHBOARD_CACHE_ENABLED = True

    assert get(as_viewer)[HEADER] == "MISS"


def test_payloads_live_for_the_configured_ttl(as_viewer, world, settings, monkeypatch):
    settings.DASHBOARD_CACHE_TTL = 77
    timeouts = {}
    real_set = LocMemCache.set

    def spy(self, key, value, timeout=DEFAULT_TIMEOUT, version=None):
        timeouts[key] = timeout
        return real_set(self, key, value, timeout, version)

    monkeypatch.setattr(LocMemCache, "set", spy)

    assert get(as_viewer)[HEADER] == "MISS"

    assert list(timeouts.values()) == [77]
    assert next(iter(timeouts)).startswith("dashboard:v1:竹北:")


def test_the_version_counter_never_expires(as_viewer, world):
    """If it expired it would restart at 1 and revive payloads filed under version 1 before the bumps."""
    warm(as_viewer)
    bump_dashboard_cache()

    assert cache._expire_info[cache.make_key(VERSION_KEY)] is None
    payload_key = next(key for key in cache._cache if PAYLOAD_KEY.search(key))
    assert cache._expire_info[payload_key] is not None


# ── Settings ─────────────────────────────────────────────────────


@pytest.fixture
def clean_cache_env(monkeypatch):
    for name in ("REDIS_URL", "REDIS_SOCKET_TIMEOUT"):
        monkeypatch.delenv(name, raising=False)


def test_without_a_redis_url_the_cache_lives_in_the_process(clean_cache_env):
    assert cache_config(environ.Env())["BACKEND"].endswith("locmem.LocMemCache")


def test_redis_calls_give_up_after_a_few_seconds(clean_cache_env, monkeypatch):
    """What redis-py does without a timeout depends on its release (none, or 5 s): the project pins its own."""
    monkeypatch.setenv("REDIS_URL", "redis://redis:6379/1")

    config = cache_config(environ.Env())
    assert config["BACKEND"].endswith("redis.RedisCache")
    assert config["LOCATION"] == "redis://redis:6379/1"
    assert config["OPTIONS"] == {"socket_connect_timeout": 2.0, "socket_timeout": 2.0}

    monkeypatch.setenv("REDIS_SOCKET_TIMEOUT", "0.5")
    assert cache_config(environ.Env())["OPTIONS"] == {"socket_connect_timeout": 0.5, "socket_timeout": 0.5}


def test_the_timeouts_reach_the_redis_connection_pool(clean_cache_env, monkeypatch):
    """Built straight from the config: no setting is touched and no connection is opened until a command is sent."""
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6399/1")
    config = cache_config(environ.Env())

    backend = RedisCache(config["LOCATION"], {"OPTIONS": config["OPTIONS"]})
    kwargs = backend._cache.get_client(write=True).connection_pool.connection_kwargs

    assert kwargs["socket_timeout"] == 2.0
    assert kwargs["socket_connect_timeout"] == 2.0


@pytest.mark.parametrize("value", ["0", "-1"])
def test_a_timeout_that_cannot_work_is_refused(value, clean_cache_env, monkeypatch):
    monkeypatch.setenv("REDIS_SOCKET_TIMEOUT", value)
    with pytest.raises(ImproperlyConfigured, match="REDIS_SOCKET_TIMEOUT"):
        cache_config(environ.Env())


@pytest.fixture
def clean_dashboard_env(monkeypatch):
    for name in ("DASHBOARD_CACHE_ENABLED", "DASHBOARD_CACHE_TTL"):
        monkeypatch.delenv(name, raising=False)


REDIS = "redis://redis:6379/1"


@pytest.mark.parametrize(
    ("redis_url", "switch", "enabled"),
    [
        ("", None, False),  # no Redis, no switch: off
        (REDIS, None, True),  # Redis, no switch: on
        ("", "true", True),  # an explicit value wins either way
        ("", "false", False),
        (REDIS, "true", True),
        (REDIS, "false", False),
    ],
)
def test_the_switch_defaults_to_on_only_when_there_is_a_redis(
    redis_url, switch, enabled, clean_dashboard_env, monkeypatch
):
    """Without Redis every process keeps its own copy, and a management command's bump cannot reach the web process."""
    if switch is not None:
        monkeypatch.setenv("DASHBOARD_CACHE_ENABLED", switch)

    assert dashboard_cache_settings(environ.Env(), redis_url)[0] is enabled


def test_without_redis_and_without_a_switch_the_dashboard_is_computed_every_time(
    as_viewer, world, settings, clean_dashboard_env
):
    settings.DASHBOARD_CACHE_ENABLED, _ = dashboard_cache_settings(environ.Env(), "")  # what REDIS_URL='' gives

    answers = [get(as_viewer) for _ in range(2)]

    assert [resp[HEADER] for resp in answers] == ["BYPASS", "BYPASS"]
    assert answers[0].json() == answers[1].json()
    assert dashboard_keys() == []


def test_with_redis_the_dashboard_is_cached_by_default(as_viewer, world, settings, clean_dashboard_env):
    settings.DASHBOARD_CACHE_ENABLED, _ = dashboard_cache_settings(environ.Env(), REDIS)

    assert [get(as_viewer)[HEADER] for _ in range(2)] == ["MISS", "HIT"]


def test_the_ttl_is_ten_minutes_unless_the_environment_says_otherwise(clean_dashboard_env, monkeypatch):
    assert dashboard_cache_settings(environ.Env(), REDIS)[1] == 600

    monkeypatch.setenv("DASHBOARD_CACHE_TTL", "30")
    assert dashboard_cache_settings(environ.Env(), REDIS)[1] == 30


@pytest.mark.parametrize("ttl", ["0", "-5"])
def test_a_ttl_below_one_second_refuses_to_start(ttl, clean_dashboard_env, monkeypatch):
    monkeypatch.setenv("DASHBOARD_CACHE_TTL", ttl)
    with pytest.raises(ImproperlyConfigured, match="DASHBOARD_CACHE_TTL must be at least 1 second"):
        dashboard_cache_settings(environ.Env(), REDIS)
