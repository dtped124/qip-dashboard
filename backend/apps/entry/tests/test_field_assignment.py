"""
Field-level assignment (Phase 5): who may write which field, and what the server does with it.

  TestValueRules          compute_value / parse_number
  TestAssignmentRules     active_assignments, fields_of, editable_fields, field_owners, resolve_campus
  TestFormIsReadOnly      GET /api/entry/form creates nothing and says who may edit what
  TestSaveDraftByField    save-draft writes only the user's fields and never clobbers other people's
  TestNothingToWrite      a save that names nothing to write creates and changes nothing
  TestLocking             the report and the entries are locked while a save runs (also with two connections)
  TestLegacyBehaviour     one owner, one campus, "both": nothing visible changes
  TestCountIndicators     indicators without a denominator
  TestHa10                the 13 sub-categories exist for HA10-01 at Hsinchu only (D10)
  TestLockedReports       submitted / approved / finalized reports are closed to reporters (KD1)
  TestCampusResolution    several campuses, explicit campus, no fallback to user.campus
  TestMyTasks             one row per campus x category, field progress
  TestAdminOnTheEntrySide admin passes the gate, fields still follow assignments (KD4)
  TestCaseListIndicators  read-only in the form (KD9)
"""
from __future__ import annotations

import datetime
import json
import threading
from decimal import Decimal

import pytest
from django.db import connection, connections, transaction
from django.test.utils import CaptureQueriesContext
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.entry.models import HA10SubEntry, IndicatorEntry, MonthlyReport
from apps.entry.services import assignments as asg
from apps.entry.services.entry_service import save_draft
from apps.entry.services.values import HA10_SUB_CATEGORIES, compute_value, parse_number, uses_sub_entries
from apps.entry.tests.conftest import MONTH, YEAR

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _world(world):
    """Campuses, categories and indicators exist in every test of this module."""
    return world


def code_of(exc) -> str:
    return exc.detail["code"]


# ── compute_value / parse_number ─────────────────────────────────

class TestValueRules:
    @pytest.mark.parametrize(
        "numerator, denominator, has_denominator, unit, expected",
        [
            (Decimal("5"), Decimal("100"), True, "percent", Decimal("5")),
            (Decimal("3"), Decimal("2000"), True, "permille", Decimal("1.5")),
            (Decimal("1"), Decimal("3"), True, "percent", Decimal("33.333333")),
            (Decimal("1"), Decimal("3"), True, "ratio", Decimal("0.333333")),
            (Decimal("0"), Decimal("10"), True, "percent", Decimal("0")),
            (Decimal("5"), Decimal("0"), True, "percent", None),  # zero denominator: no value
            (Decimal("5"), None, True, "percent", None),
            (None, Decimal("10"), True, "percent", None),
            (Decimal("7"), None, False, "count", Decimal("7")),  # no denominator: the value is the numerator
            (Decimal("7"), Decimal("9"), False, "count", Decimal("7")),  # a stray denominator is ignored
            (None, None, False, "count", None),
        ],
    )
    def test_compute_value(self, numerator, denominator, has_denominator, unit, expected):
        assert compute_value(numerator, denominator, has_denominator, unit) == expected

    @pytest.mark.parametrize(
        "raw, expected",
        [
            (None, None),
            (5, Decimal("5.00")),
            ("5", Decimal("5.00")),
            (" 7.5 ", Decimal("7.50")),
            (2.25, Decimal("2.25")),
            ("5.005", Decimal("5.01")),  # rounded half up, as the column would
            (0, Decimal("0.00")),
            (-3, Decimal("-3.00")),
            (10**10 - 1, Decimal("9999999999.00")),
        ],
    )
    def test_parse_number_accepts(self, raw, expected):
        assert parse_number(raw) == expected

    @pytest.mark.parametrize(
        "raw", ["", "  ", "abc", "1,000", True, "NaN", "Infinity", float("inf"), 10**10, "9999999999.999", [1], {}]
    )
    def test_parse_number_refuses(self, raw):
        with pytest.raises(ValueError):
            parse_number(raw)

    def test_parse_number_respects_the_column_size(self):
        assert parse_number("12345678.99", max_digits=10) == Decimal("12345678.99")
        with pytest.raises(ValueError):
            parse_number("100000000", max_digits=10)  # numeric(10, 2) holds 8 integer digits


# ── The assignment rules ─────────────────────────────────────────

class TestAssignmentRules:
    def test_an_assignment_is_in_force_for_every_month_it_touches(self, users, assign):
        alice = users["alice"]
        d = datetime.date
        assign(alice, "HA01-01", effective_from=d(2026, 3, 31))  # starts on the month's last day
        assign(alice, "HA01-02", effective_from=d(2026, 4, 1))  # starts the day after: not yet
        assign(alice, "HA02-11", effective_from=d(2026, 1, 1), effective_to=d(2026, 3, 1))  # ends on the first day
        assign(alice, "HA10-04", effective_from=d(2026, 1, 1), effective_to=d(2026, 2, 28))  # ended before: gone
        found = set(asg.active_assignments(YEAR, MONTH, user=alice).values_list("indicator_code", flat=True))
        assert found == {"HA01-01", "HA02-11"}

    def test_filters_and_the_category_prefix(self, users, assign, campuses):
        alice, bob = users["alice"], users["bob"]
        assign(alice, "HA01-01", "zhubei")
        assign(alice, "HA01-01-01", "zhubei")  # a variant of the same category
        assign(alice, "HA011-01", "zhubei")  # a different category whose code merely starts with "HA01"
        assign(alice, "HA01-02", "zhudong")
        assign(bob, "HA01-01", "zhubei")

        def codes(**kwargs):
            qs = asg.active_assignments(YEAR, MONTH, **kwargs)
            return sorted(qs.values_list("indicator_code", flat=True))

        assert codes(user=alice, campus=campuses["zhubei"], category_code="HA01") == ["HA01-01", "HA01-01-01"]
        assert codes(user=alice, category_code="HA01") == ["HA01-01", "HA01-01-01", "HA01-02"]
        assert codes(campus=campuses["zhubei"], category_code="HA01") == ["HA01-01", "HA01-01", "HA01-01-01"]
        assert codes(user=alice, campus=campuses["zhudong"]) == ["HA01-02"]

    def test_invalid_periods_are_a_400_not_a_crash(self):
        for year, month in [(115, 13), (115, 0), (115, "x"), (None, 3), (10**9, 3)]:
            with pytest.raises(ValidationError) as caught:
                asg.active_assignments(year, month)
            assert code_of(caught.value) == "invalid_period"

    def test_fields_of(self, users, assign):
        alice = users["alice"]
        assert asg.fields_of(assign(alice, "HA01-01", field="both")) == {"numerator", "denominator"}
        assert asg.fields_of(assign(alice, "HA01-02", field="numerator")) == {"numerator"}
        assert asg.fields_of(assign(alice, "HA02-11", field="denominator")) == {"denominator"}

    def test_required_fields(self, indicators, campuses):
        assert asg.required_fields(indicators["HA01-01"], campuses["zhubei"]) == {"numerator", "denominator"}
        assert asg.required_fields(indicators["HA06-31"], campuses["zhubei"]) == {"numerator"}
        # HA10-01 at Hsinchu: still just the numerator here; the 13 sub-categories are checked by the caller
        assert asg.required_fields(indicators["HA10-01"], campuses["hsinchu"]) == {"numerator"}
        assert asg.required_fields(None, campuses["zhubei"]) == {"numerator", "denominator"}  # legacy default

    def test_editable_fields(self, users, assign, campuses):
        alice, bob, carol = users["alice"], users["bob"], users["carol"]
        assign(alice, "HA01-01", field="numerator")
        assign(alice, "HA01-02", field="both")
        assign(bob, "HA06-31", field="both")  # a count indicator: the denominator does not exist
        assign(carol, "HA03-01", field="both")  # a case-list indicator: read-only in the form (KD9)
        zhubei = campuses["zhubei"]

        assert asg.editable_fields(alice, zhubei, YEAR, MONTH, "HA01") == {
            "HA01-01": {"numerator"},
            "HA01-02": {"numerator", "denominator"},
        }
        assert asg.editable_fields(bob, zhubei, YEAR, MONTH, "HA06") == {"HA06-31": {"numerator"}}
        assert asg.editable_fields(carol, zhubei, YEAR, MONTH, "HA03") == {"HA03-01": set()}
        # the raw responsibility keeps the case-list fields (the case-list pages ask for the numerator)
        assert asg.assigned_fields(carol, zhubei, YEAR, MONTH, "HA03") == {"HA03-01": {"numerator", "denominator"}}
        # somebody else's category, somebody else's campus
        assert asg.editable_fields(alice, zhubei, YEAR, MONTH, "HA06") == {}
        assert asg.editable_fields(alice, campuses["zhudong"], YEAR, MONTH, "HA01") == {}

    def test_admin_gets_no_extra_fields(self, users, assign, campuses):
        zhubei = campuses["zhubei"]
        assign(users["alice"], "HA01-01")
        assert asg.editable_fields(users["admin"], zhubei, YEAR, MONTH, "HA01") == {}
        assign(users["admin"], "HA01-02", field="denominator")
        assert asg.editable_fields(users["admin"], zhubei, YEAR, MONTH, "HA01") == {"HA01-02": {"denominator"}}

    def test_field_owners_spread_both_and_list_primaries_first(self, users, assign, campuses):
        alice, bob, carol = users["alice"], users["bob"], users["carol"]
        assign(carol, "HA01-01", field="both", role="deputy")
        assign(alice, "HA01-01", field="numerator")
        assign(bob, "HA01-01", field="denominator")
        assign(bob, "HA01-02", field="both", effective_to=datetime.date(2026, 2, 28))  # over: not an owner
        owners = asg.field_owners(campuses["zhubei"], YEAR, MONTH, "HA01")
        assert owners == {
            ("HA01-01", "numerator"): [alice, carol],
            ("HA01-01", "denominator"): [bob, carol],
        }
        assert asg.field_owners(campuses["zhudong"], YEAR, MONTH, "HA01") == {}


class TestResolveCampus:
    def test_the_only_campus_is_used_when_none_is_given(self, users, assign, campuses):
        assign(users["alice"], "HA01-01", "zhubei")
        assert asg.resolve_campus(users["alice"], "HA01", None, YEAR, MONTH) == campuses["zhubei"]
        assert asg.resolve_campus(users["alice"], "HA01", "", YEAR, MONTH) == campuses["zhubei"]
        assert asg.resolve_campus(users["alice"], "HA01", "zhubei", YEAR, MONTH) == campuses["zhubei"]

    def test_several_campuses_need_an_explicit_choice(self, users, assign, campuses):
        assign(users["alice"], "HA01-01", "zhubei")
        assign(users["alice"], "HA01-02", "zhudong")
        with pytest.raises(ValidationError) as caught:
            asg.resolve_campus(users["alice"], "HA01", None, YEAR, MONTH)
        assert code_of(caught.value) == "campus_required"
        assert asg.resolve_campus(users["alice"], "HA01", "zhudong", YEAR, MONTH) == campuses["zhudong"]

    def test_a_campus_outside_the_assignments_is_forbidden(self, users, assign):
        assign(users["alice"], "HA01-01", "zhubei")
        for code in ("zhudong", "nowhere"):
            with pytest.raises(PermissionDenied) as caught:
                asg.resolve_campus(users["alice"], "HA01", code, YEAR, MONTH)
            assert code_of(caught.value) == "campus_not_assigned"

    def test_assignments_of_another_category_do_not_count(self, users, assign):
        assign(users["alice"], "HA06-31", "zhubei")
        with pytest.raises(ValidationError) as caught:
            asg.resolve_campus(users["alice"], "HA01", None, YEAR, MONTH)
        assert code_of(caught.value) == "no_assignment"
        with pytest.raises(PermissionDenied):
            asg.resolve_campus(users["alice"], "HA01", "zhubei", YEAR, MONTH)

    def test_there_is_no_fallback_to_the_users_own_campus(self, make_user, campuses):
        resident = make_user("resident", ["reporter"], campus=campuses["zhubei"])
        with pytest.raises(ValidationError) as caught:
            asg.resolve_campus(resident, "HA01", None, YEAR, MONTH)
        assert code_of(caught.value) == "no_assignment"

    def test_an_expired_assignment_does_not_open_the_campus(self, users, assign):
        assign(users["alice"], "HA01-01", "zhubei", effective_to=datetime.date(2026, 2, 28))
        with pytest.raises(ValidationError):
            asg.resolve_campus(users["alice"], "HA01", None, YEAR, MONTH)

    def test_admin_may_name_any_campus_but_must_name_one(self, users, assign, campuses):
        admin = users["admin"]
        assert asg.resolve_campus(admin, "HA01", "hsinchu", YEAR, MONTH) == campuses["hsinchu"]
        with pytest.raises(ValidationError) as caught:
            asg.resolve_campus(admin, "HA01", None, YEAR, MONTH)
        assert code_of(caught.value) == "campus_required"
        with pytest.raises(ValidationError) as caught:
            asg.resolve_campus(admin, "HA01", "nowhere", YEAR, MONTH)
        assert code_of(caught.value) == "campus_not_found"
        assign(admin, "HA01-01", "zhudong")  # the admin's own assignment makes the campus unambiguous
        assert asg.resolve_campus(admin, "HA01", None, YEAR, MONTH) == campuses["zhudong"]

    def test_uses_sub_entries_is_ha10_01_at_hsinchu_only(self):
        assert uses_sub_entries("HA10-01", "hsinchu")
        assert not uses_sub_entries("HA10-01", "zhubei")
        assert not uses_sub_entries("HA10-04", "hsinchu")
        assert not uses_sub_entries("HA10-09", "hsinchu")


# ── GET /api/entry/form ──────────────────────────────────────────

class TestFormIsReadOnly:
    def test_get_form_never_creates_a_report(self, users, assign, api_for):
        assign(users["alice"], "HA01-01")
        before = (MonthlyReport.objects.count(), IndicatorEntry.objects.count())
        resp = api_for(users["alice"]).form("HA01")
        assert resp.status_code == 200
        assert (MonthlyReport.objects.count(), IndicatorEntry.objects.count()) == before == (0, 0)
        assert resp.json()["report"] == {
            "id": None, "status": "unfilled", "rejection_reason": "", "submitted_at": None,
            "is_late": False, "locked": False,
        }

    def test_the_form_keeps_every_legacy_key_and_adds_the_new_ones(self, users, assign, api_for):
        assign(users["alice"], "HA01-01")
        body = api_for(users["alice"]).form("HA01").json()
        assert set(body) >= {"report", "category", "campus", "period", "deadline", "indicators"}
        assert body["category"]["code"] == "HA01"
        assert body["campus"] == {"code": "zhubei", "name": "竹北"}
        assert body["period"] == {"year": YEAR, "month": MONTH}
        row = body["indicators"][0]
        legacy = {
            "indicator_code", "indicator_name", "unit", "direction", "has_denominator", "entry_mode",
            "numerator", "denominator", "value", "note", "prev_value", "prev_numerator", "prev_denominator",
            "change_pct", "sub_entries", "is_ha10_hsinchu",
        }
        new = {
            "editable_fields", "field_owners", "numerator_filled_by", "numerator_filled_at",
            "denominator_filled_by", "denominator_filled_at",
        }
        assert set(row) >= legacy | new
        assert row["editable_fields"] == ["numerator", "denominator"]
        assert row["field_owners"] == {"numerator": ["Name-alice"], "denominator": ["Name-alice"]}
        assert row["unit"] == "percent" and row["has_denominator"] is True and row["entry_mode"] == "manual"

    def test_only_the_users_own_indicators_are_listed(self, users, assign, api_for):
        # Chosen over also listing other people's rows read-only: clients written before this phase post
        # every listed row back on save, and a row that is not theirs would make the whole save a 403.
        assign(users["alice"], "HA01-01")
        assign(users["bob"], "HA01-02")
        for name, expected in (("alice", ["HA01-01"]), ("bob", ["HA01-02"])):
            rows = api_for(users[name]).form("HA01").json()["indicators"]
            assert [r["indicator_code"] for r in rows] == expected

    def test_a_half_assigned_indicator_shows_the_other_half(self, users, assign, api_for):
        assign(users["alice"], "HA01-01", field="numerator")
        assign(users["bob"], "HA01-01", field="denominator")
        bob_api = api_for(users["bob"])
        row = api_for(users["alice"]).form("HA01").json()["indicators"][0]
        assert row["editable_fields"] == ["numerator"]
        assert row["field_owners"] == {"numerator": ["Name-alice"], "denominator": ["Name-bob"]}
        assert row["denominator"] is None and row["denominator_filled_by"] is None

        assert bob_api.save("HA01", [{"indicator_code": "HA01-01", "denominator": 50}]).status_code == 200
        row = api_for(users["alice"]).form("HA01").json()["indicators"][0]
        assert row["denominator"] == 50.0
        assert row["denominator_filled_by"] == "Name-bob"
        assert row["denominator_filled_at"] is not None
        assert row["numerator_filled_by"] is None

    def test_previous_month_values_come_along(self, users, assign, api_for, campuses, categories):
        assign(users["alice"], "HA01-01", effective_from=datetime.date(2025, 1, 1))
        for year, month, value in ((YEAR, MONTH - 1, "4"), (YEAR - 1, 12, "9")):
            report = MonthlyReport.objects.create(
                campus=campuses["zhubei"], category=categories["HA01"], year=year, month=month, status="finalized"
            )
            IndicatorEntry.objects.create(
                report=report, indicator_code="HA01-01", numerator=Decimal(value), denominator=Decimal("100"),
                value=Decimal(value),
            )
        feb = api_for(users["alice"]).form("HA01", month=MONTH).json()["indicators"][0]
        assert (feb["prev_value"], feb["prev_numerator"], feb["prev_denominator"]) == (4.0, 4.0, 100.0)
        jan = api_for(users["alice"]).form("HA01", year=YEAR, month=1).json()["indicators"][0]
        assert jan["prev_value"] == 9.0  # December of the year before

    def test_missing_or_unknown_category_and_bad_period(self, users, assign, api_for):
        assign(users["alice"], "HA01-01")
        api = api_for(users["alice"])
        resp = api.client.get("/api/entry/form", {"year": YEAR, "month": MONTH})
        assert resp.status_code == 400
        assert resp.json()["code"] == "missing_params"
        assert api.form("HA01", month=13).status_code == 400
        assert api.form("HA01", month=13).json()["code"] == "invalid_period"
        assert api.form("ZZ99").status_code == 400  # nothing assigned in that category
        assert api.form("HA01", campus="nowhere").status_code == 403


# ── POST /api/entry/save-draft ───────────────────────────────────

class TestSaveDraftByField:
    @pytest.fixture
    def split(self, users, assign):
        """HA01-01 at Zhubei: alice owns the numerator, bob the denominator."""
        assign(users["alice"], "HA01-01", field="numerator")
        assign(users["bob"], "HA01-01", field="denominator")
        return users["alice"], users["bob"]

    def test_each_owner_writes_only_their_field_and_the_value_follows(self, split, api_for):
        alice, bob = split
        resp = api_for(alice).save("HA01", [{"indicator_code": "HA01-01", "numerator": 5}])
        assert resp.status_code == 200
        entry = IndicatorEntry.objects.get(indicator_code="HA01-01")
        assert (entry.numerator, entry.denominator, entry.value) == (Decimal("5"), None, None)
        assert entry.numerator_filled_by == alice and entry.numerator_filled_at is not None
        assert entry.denominator_filled_by is None and entry.denominator_filled_at is None

        resp = api_for(bob).save("HA01", [{"indicator_code": "HA01-01", "denominator": 100}])
        assert resp.status_code == 200
        entry.refresh_from_db()
        # bob's save kept alice's numerator and computed the value from both
        assert (entry.numerator, entry.denominator, entry.value) == (Decimal("5"), Decimal("100"), Decimal("5"))
        assert entry.numerator_filled_by == alice
        assert entry.denominator_filled_by == bob
        assert entry.filled_by == bob  # entry level: the last modifier
        assert entry.data_source == "manual"

        # the response carries the server's latest numbers, other people's field included
        row = resp.json()["entries"][0]
        assert (row["numerator"], row["denominator"], row["value"]) == (5.0, 100.0, 5.0)
        assert (row["numerator_filled_by"], row["denominator_filled_by"]) == ("Name-alice", "Name-bob")

    def test_a_payload_without_a_key_leaves_that_field_alone(self, split, api_for):
        alice, bob = split
        api_for(alice).save("HA01", [{"indicator_code": "HA01-01", "numerator": 5}])
        api_for(bob).save("HA01", [{"indicator_code": "HA01-01", "denominator": 100}])

        # alice corrects her numerator; her payload says nothing about the denominator
        assert api_for(alice).save("HA01", [{"indicator_code": "HA01-01", "numerator": 8}]).status_code == 200
        entry = IndicatorEntry.objects.get(indicator_code="HA01-01")
        assert (entry.numerator, entry.denominator, entry.value) == (Decimal("8"), Decimal("100"), Decimal("8"))
        assert entry.denominator_filled_by == bob  # still bob's number

    def test_a_field_the_user_does_not_own_is_refused_and_nothing_is_written(self, split, api_for):
        alice, bob = split
        api_for(bob).save("HA01", [{"indicator_code": "HA01-01", "denominator": 100}])
        before = IndicatorEntry.objects.get(indicator_code="HA01-01")

        resp = api_for(alice).save(
            "HA01",
            [
                {"indicator_code": "HA01-01", "numerator": 7, "denominator": 5, "note": "hello"},
            ],
        )
        assert resp.status_code == 400
        body = resp.json()
        assert body["code"] == "field_not_assigned"
        assert body["fields"] == [{"indicator_code": "HA01-01", "field": "denominator"}]
        after = IndicatorEntry.objects.get(indicator_code="HA01-01")
        assert (after.numerator, after.denominator, after.value, after.note) == (
            before.numerator, before.denominator, before.value, before.note
        )
        assert after.denominator == Decimal("100") and after.denominator_filled_by == bob

    def test_even_a_null_for_a_field_the_user_does_not_own_is_refused(self, split, api_for):
        alice, _ = split
        resp = api_for(alice).save("HA01", [{"indicator_code": "HA01-01", "numerator": 7, "denominator": None}])
        assert resp.status_code == 400
        assert resp.json()["code"] == "field_not_assigned"
        assert MonthlyReport.objects.count() == 0  # not even the report was created

    def test_one_refused_entry_stops_the_whole_payload(self, users, assign, api_for):
        alice = users["alice"]
        assign(alice, "HA01-01", field="numerator")
        assign(alice, "HA01-02", field="both")
        resp = api_for(alice).save(
            "HA01",
            [
                {"indicator_code": "HA01-02", "numerator": 3, "denominator": 10},  # fine on its own
                {"indicator_code": "HA01-01", "numerator": 4, "denominator": 10},  # denominator is not alice's
            ],
        )
        assert resp.status_code == 400
        assert IndicatorEntry.objects.count() == 0 and MonthlyReport.objects.count() == 0

    def test_an_unassigned_indicator_is_a_403_and_nothing_is_written(self, users, assign, api_for):
        assign(users["alice"], "HA01-01")
        resp = api_for(users["alice"]).save(
            "HA01",
            [
                {"indicator_code": "HA01-01", "numerator": 3, "denominator": 10},
                {"indicator_code": "HA01-02", "numerator": 4, "denominator": 10},
            ],
        )
        assert resp.status_code == 403
        body = resp.json()
        assert body["code"] == "not_assigned"
        assert body["codes"] == ["HA01-02"]
        assert IndicatorEntry.objects.count() == 0 and MonthlyReport.objects.count() == 0

    def test_an_indicator_of_another_campus_counts_as_unassigned(self, users, assign, api_for):
        assign(users["alice"], "HA01-01", "zhubei")
        assign(users["alice"], "HA01-02", "zhudong")
        resp = api_for(users["alice"]).save(
            "HA01", [{"indicator_code": "HA01-02", "numerator": 1, "denominator": 2}], campus="zhubei"
        )
        assert resp.status_code == 403 and resp.json()["code"] == "not_assigned"

    def test_null_clears_a_field_and_the_value_with_it(self, users, assign, api_for):
        assign(users["alice"], "HA01-01")
        api = api_for(users["alice"])
        api.save("HA01", [{"indicator_code": "HA01-01", "numerator": 5, "denominator": 50}])
        assert IndicatorEntry.objects.get().value == Decimal("10")

        assert api.save("HA01", [{"indicator_code": "HA01-01", "numerator": None}]).status_code == 200
        entry = IndicatorEntry.objects.get()
        assert (entry.numerator, entry.denominator, entry.value) == (None, Decimal("50"), None)

        assert api.save("HA01", [{"indicator_code": "HA01-01", "note": "only a note"}]).status_code == 200
        entry.refresh_from_db()
        assert (entry.numerator, entry.denominator, entry.note) == (None, Decimal("50"), "only a note")

    @pytest.mark.parametrize("bad", ["abc", "", "  ", True, "NaN", "inf", 10**10, [1], {"a": 1}])
    def test_a_value_that_is_not_a_number_is_a_400_and_nothing_is_written(self, users, assign, api_for, bad):
        assign(users["alice"], "HA01-01")
        resp = api_for(users["alice"]).save(
            "HA01", [{"indicator_code": "HA01-01", "numerator": 5, "denominator": bad}]
        )
        assert resp.status_code == 400
        body = resp.json()
        assert body["code"] == "invalid_number"
        assert body["errors"][0]["indicator_code"] == "HA01-01" and body["errors"][0]["field"] == "denominator"
        assert IndicatorEntry.objects.count() == 0

    def test_numbers_may_arrive_as_strings(self, users, assign, api_for):
        assign(users["alice"], "HA01-01")
        resp = api_for(users["alice"]).save(
            "HA01", [{"indicator_code": "HA01-01", "numerator": "3", "denominator": "12"}]
        )
        assert resp.status_code == 200
        assert IndicatorEntry.objects.get().value == Decimal("25")

    def test_a_value_too_large_for_the_column_is_a_400_not_a_500(self, users, assign, api_for):
        assign(users["alice"], "HA01-01")
        resp = api_for(users["alice"]).save(
            "HA01", [{"indicator_code": "HA01-01", "numerator": 9000000, "denominator": 0.01}]
        )
        assert resp.status_code == 400
        assert resp.json()["code"] == "value_out_of_range"
        assert IndicatorEntry.objects.count() == 0

    def test_saving_the_same_numbers_again_keeps_who_and_when(self, split, api_for):
        alice, _ = split
        api_for(alice).save("HA01", [{"indicator_code": "HA01-01", "numerator": 5}])
        entry = IndicatorEntry.objects.get()
        first = (entry.numerator_filled_by, entry.numerator_filled_at, entry.filled_by, entry.filled_at)

        # an autosave that resends the same number must not look like a new edit
        api_for(alice).save("HA01", [{"indicator_code": "HA01-01", "numerator": 5}])
        entry.refresh_from_db()
        assert (entry.numerator_filled_by, entry.numerator_filled_at, entry.filled_by, entry.filled_at) == first

    def test_a_note_needs_a_field_of_that_indicator_and_is_text(self, split, api_for):
        _, bob = split
        # a note alone is fine for somebody who owns half of the indicator
        assert api_for(bob).save("HA01", [{"indicator_code": "HA01-01", "note": "bob says"}]).status_code == 200
        assert IndicatorEntry.objects.get().note == "bob says"
        assert IndicatorEntry.objects.get().denominator is None  # a note does not touch the numbers
        # ... and a note is text
        resp = api_for(bob).save("HA01", [{"indicator_code": "HA01-01", "note": 5}])
        assert resp.status_code == 400 and resp.json()["code"] == "invalid_payload"

    def test_a_malformed_payload_is_a_400(self, users, assign, api_for):
        assign(users["alice"], "HA01-01")
        api = api_for(users["alice"])
        for entries in ("nope", [1], [{"numerator": 1}], [{"indicator_code": ""}], {"a": 1}):
            resp = api.save("HA01", entries)
            assert resp.status_code == 400, entries
            assert resp.json()["code"] == "invalid_payload"
        for payload in ({}, {"year": YEAR}, {"year": "x", "month": 3, "category": "HA01"}, []):
            resp = api.client.post("/api/entry/save-draft", data=json.dumps(payload),
                                   content_type="application/json")
            assert resp.status_code == 400, payload
            assert resp.json()["code"] == "missing_params"
        assert api.save("HA01", [], month=13).status_code == 400

    @pytest.mark.parametrize("overdue", [True, False])
    def test_the_first_save_moves_the_report_to_draft_and_flags_a_late_one(
        self, overdue, users, assign, api_for, monkeypatch
    ):
        from apps.entry.services import entry_service

        monkeypatch.setattr(entry_service, "get_deadline_info", lambda year, month: {"is_overdue": overdue})
        assign(users["alice"], "HA01-01")
        resp = api_for(users["alice"]).save("HA01", [{"indicator_code": "HA01-01", "numerator": 1}])
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "draft" and [e["indicator_code"] for e in body["entries"]] == ["HA01-01"]
        report = MonthlyReport.objects.get(pk=body["report_id"])
        assert report.status == "draft"
        assert report.is_late is overdue

    def test_a_draft_stays_a_draft_and_keeps_its_rejection_reason(self, users, assign, api_for, make_report):
        assign(users["alice"], "HA01-01")
        report = make_report("zhubei", "HA01", "draft", rejection_reason="check the denominator")
        resp = api_for(users["alice"]).save("HA01", [{"indicator_code": "HA01-01", "numerator": 1, "denominator": 2}])
        assert resp.status_code == 200
        report.refresh_from_db()
        assert report.status == "draft" and report.rejection_reason == "check the denominator"

    def test_value_is_recomputed_from_what_is_stored_not_from_the_payload(self, split, api_for):
        """A stale client (loaded before the other owner saved) cannot overwrite the other half."""
        alice, bob = split
        api_for(alice).save("HA01", [{"indicator_code": "HA01-01", "numerator": 3}])
        stale_form = api_for(alice).form("HA01").json()["indicators"][0]
        assert stale_form["denominator"] is None

        api_for(bob).save("HA01", [{"indicator_code": "HA01-01", "denominator": 60}])
        # alice saves what her (stale) form held, as a client that sends only her field would
        api_for(alice).save("HA01", [{"indicator_code": "HA01-01", "numerator": 6, "note": "n"}])
        entry = IndicatorEntry.objects.get()
        assert (entry.numerator, entry.denominator, entry.value) == (Decimal("6"), Decimal("60"), Decimal("10"))

    def test_precision_is_the_columns(self, users, assign, api_for):
        assign(users["alice"], "HA01-01")
        api_for(users["alice"]).save(
            "HA01", [{"indicator_code": "HA01-01", "numerator": 1, "denominator": 3}]
        )
        assert IndicatorEntry.objects.get().value == Decimal("33.333333")


class TestNothingToWrite:
    """A save that names nothing to write changes nothing: no report, no draft status, no entry."""

    @pytest.mark.parametrize(
        "category, entries",
        [
            ("HA01", []),
            ("HA01", [{"indicator_code": "HA01-01"}]),
            ("HA01", [{"indicator_code": "HA01-01", "sub_entries": []}]),
            ("HA06", [{"indicator_code": "HA06-31", "denominator": None}]),  # the null old forms send for counts
        ],
        ids=["no entries", "only the code", "empty sub_entries", "only the legacy null"],
    )
    def test_nothing_is_created(self, category, entries, users, assign, api_for):
        assign(users["alice"], "HA01-01")
        assign(users["alice"], "HA06-31")
        resp = api_for(users["alice"]).save(category, entries)
        assert resp.status_code == 200
        assert resp.json() == {"ok": True, "report_id": None, "status": "unfilled", "entries": []}
        assert MonthlyReport.objects.count() == 0 and IndicatorEntry.objects.count() == 0

    @pytest.mark.parametrize("state", ["unfilled", "draft"])
    def test_an_existing_report_is_left_as_it_is(self, state, users, assign, api_for, make_report, entry_for):
        assign(users["alice"], "HA01-01")
        report = make_report("zhubei", "HA01", state)
        entry_for(report, "HA01-01", 5, 100, 5)
        resp = api_for(users["alice"]).save("HA01", [{"indicator_code": "HA01-01"}])
        assert resp.status_code == 200
        body = resp.json()
        assert (body["report_id"], body["status"]) == (report.id, state)  # an unfilled report is not promoted
        assert [(e["indicator_code"], e["numerator"]) for e in body["entries"]] == [("HA01-01", 5.0)]
        report.refresh_from_db()
        assert (report.status, report.is_late) == (state, False)

    def test_an_unassigned_indicator_is_refused_even_with_nothing_to_write(self, users, assign, api_for):
        assign(users["alice"], "HA01-01")
        resp = api_for(users["alice"]).save("HA01", [{"indicator_code": "HA01-02"}])
        assert resp.status_code == 403 and resp.json()["code"] == "not_assigned"

    def test_a_closed_report_answers_before_anything_else(self, users, assign, api_for, make_report):
        assign(users["alice"], "HA01-01")
        make_report("zhubei", "HA01", "submitted")
        resp = api_for(users["alice"]).save("HA01", [])
        assert resp.status_code == 403 and resp.json()["code"] == "report_locked"

    def test_an_explicit_null_is_something_to_write(self, users, assign, api_for):
        """What a pre-phase-5 form posts for a blank row still opens the draft, as it always did."""
        assign(users["alice"], "HA01-01")
        resp = api_for(users["alice"]).save(
            "HA01", [{"indicator_code": "HA01-01", "numerator": None, "denominator": None, "note": ""}]
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "draft"
        entry = IndicatorEntry.objects.get()
        assert (entry.numerator, entry.denominator, entry.value, entry.note) == (None, None, None, "")

    def test_an_empty_sub_entries_list_counts_as_not_sent(self, users, assign, api_for):
        assign(users["alice"], "HA01-01")
        assign(users["alice"], "HA10-01", "zhubei")
        assign(users["bob"], "HA10-01", "hsinchu")
        # an ordinary indicator and an indicator of another campus ignore "sub_entries": [] ...
        resp = api_for(users["alice"]).save(
            "HA01", [{"indicator_code": "HA01-01", "numerator": 1, "denominator": 2, "sub_entries": []}]
        )
        assert resp.status_code == 200 and IndicatorEntry.objects.get().numerator == Decimal("1")
        resp = api_for(users["alice"]).save("HA10", [{"indicator_code": "HA10-01", "numerator": 12, "sub_entries": []}])
        assert resp.status_code == 200
        assert IndicatorEntry.objects.get(indicator_code="HA10-01").numerator == Decimal("12")
        # ... a numerator next to it at Hsinchu is still a numerator without sub-categories ...
        for empty in ([], None):
            resp = api_for(users["bob"]).save(
                "HA10", [{"indicator_code": "HA10-01", "numerator": 5, "sub_entries": empty}]
            )
            assert resp.status_code == 400 and resp.json()["code"] == "invalid_payload"
        # ... and on its own it is nothing to write
        resp = api_for(users["bob"]).save("HA10", [{"indicator_code": "HA10-01", "sub_entries": []}])
        assert resp.status_code == 200 and resp.json()["report_id"] is None
        assert not MonthlyReport.objects.filter(campus__code="hsinchu").exists()


# ── Locking ──────────────────────────────────────────────────────

class TestLocking:
    def test_a_save_locks_the_report_and_every_entry_it_writes(self, users, assign, api_for):
        assign(users["alice"], "HA01-01")
        api = api_for(users["alice"])
        entries = [{"indicator_code": "HA01-01", "numerator": 1, "denominator": 2}]
        for _ in range(2):  # the first save creates the rows, the second one finds them
            with CaptureQueriesContext(connection) as queries:
                assert api.save("HA01", entries).status_code == 200
            locking = [q["sql"] for q in queries.captured_queries if "FOR UPDATE" in q["sql"]]
            assert any('"entry_monthly_reports"' in sql for sql in locking), locking
            assert any('"entry_indicator_entries"' in sql for sql in locking), locking

    def test_a_submit_locks_the_report(self, users, assign, api_for):
        assign(users["alice"], "HA01-01")
        api = api_for(users["alice"])
        api.save("HA01", [{"indicator_code": "HA01-01", "numerator": 1, "denominator": 2}])
        with CaptureQueriesContext(connection) as queries:
            assert api.submit("HA01").status_code == 200
        assert any(
            "FOR UPDATE" in q["sql"] and '"entry_monthly_reports"' in q["sql"] for q in queries.captured_queries
        )


@pytest.mark.django_db(transaction=True)
class TestConcurrentSaves:
    def test_a_save_that_waits_for_the_lock_builds_on_what_the_other_owner_committed(
        self, users, assign, campuses, categories
    ):
        """
        alice's save is in flight (the report is locked and her number is about to be committed) when bob's
        save arrives. Bob must wait, then compute the value from alice's committed numerator and leave that
        numerator alone, even though he read nothing of it before waiting.
        """
        alice, bob = users["alice"], users["bob"]
        assign(alice, "HA01-01", field="numerator")
        assign(bob, "HA01-01", field="denominator")
        report = MonthlyReport.objects.create(
            campus=campuses["zhubei"], category=categories["HA01"], year=YEAR, month=MONTH, status="draft"
        )
        entry = IndicatorEntry.objects.create(report=report, indicator_code="HA01-01")

        outcome: dict = {}

        def bobs_save():
            try:
                outcome["result"] = save_draft(
                    bob, campuses["zhubei"], YEAR, MONTH, "HA01", [{"indicator_code": "HA01-01", "denominator": 100}]
                )
            except BaseException as exc:  # reported to the test thread below
                outcome["error"] = exc
            finally:
                connections.close_all()

        worker = threading.Thread(target=bobs_save)
        with transaction.atomic():
            MonthlyReport.objects.select_for_update().get(pk=report.pk)  # alice's save holds the report
            worker.start()
            worker.join(timeout=1.5)
            assert worker.is_alive(), "bob's save must wait for the report lock"
            IndicatorEntry.objects.filter(pk=entry.pk).update(numerator=Decimal("7"), numerator_filled_by=alice)
        worker.join(timeout=30)

        assert not worker.is_alive()
        assert "error" not in outcome, outcome.get("error")
        entry.refresh_from_db()
        assert (entry.numerator, entry.denominator, entry.value) == (Decimal("7"), Decimal("100"), Decimal("7"))
        assert entry.numerator_filled_by == alice and entry.denominator_filled_by == bob
        assert outcome["result"]["entries"][0]["numerator"] == 7.0


# ── Legacy: one owner, one campus, "both" ────────────────────────

class TestLegacyBehaviour:
    def test_fill_save_and_submit_work_as_before(self, users, assign, api_for):
        alice = users["alice"]
        assign(alice, "HA01-01")
        assign(alice, "HA01-02")
        api = api_for(alice)

        form = api.form("HA01").json()  # no campus parameter: the client does not know about it
        assert [r["indicator_code"] for r in form["indicators"]] == ["HA01-01", "HA01-02"]
        assert all(r["editable_fields"] == ["numerator", "denominator"] for r in form["indicators"])

        # what the old form posts: every row, numerator / denominator / note, nothing else
        resp = api.save("HA01", [
            {"indicator_code": "HA01-01", "numerator": 5, "denominator": 100, "note": ""},
            {"indicator_code": "HA01-02", "numerator": None, "denominator": None, "note": ""},
        ])
        assert resp.status_code == 200
        body = resp.json()
        assert body["ok"] is True and body["status"] == "draft"
        assert {"ok", "report_id", "status"} <= set(body)
        assert IndicatorEntry.objects.get(indicator_code="HA01-01").value == Decimal("5")

        tasks = api.tasks().json()
        row = tasks["categories"][0]
        assert (row["category_code"], row["status"], row["filled_count"], row["total_count"]) == ("HA01", "draft", 1, 2)
        assert tasks["overall_progress"] == {"filled": 1, "total": 2}

        resp = api.submit("HA01")
        assert resp.status_code == 400 and resp.json()["code"] == "incomplete"

        assert api.save("HA01", [
            {"indicator_code": "HA01-02", "numerator": 1, "denominator": 50, "note": "ok"},
        ]).status_code == 200
        resp = api.submit("HA01")
        assert resp.status_code == 200
        assert resp.json() == {"ok": True, "report_id": body["report_id"], "status": "submitted"}
        report = MonthlyReport.objects.get(pk=body["report_id"])
        assert report.status == "submitted" and report.submitted_by == alice and report.submitted_at is not None

        # submitted: closed to the reporter
        assert api.save("HA01", [{"indicator_code": "HA01-01", "numerator": 9, "denominator": 100}]).status_code == 403
        assert api.form("HA01").json()["report"]["locked"] is True

    def test_my_tasks_keeps_its_legacy_shape(self, users, assign, api_for):
        assign(users["alice"], "HA01-01")
        body = api_for(users["alice"]).tasks().json()
        assert set(body) == {"period", "deadline", "rejection_notices", "categories", "overall_progress"}
        row = body["categories"][0]
        assert set(row) >= {
            "category_code", "category_name", "category_color", "report_id", "status", "filled_count",
            "total_count", "rejection_reason",
        }
        assert row["report_id"] is None and row["status"] == "unfilled"


# ── Indicators without a denominator ─────────────────────────────

class TestCountIndicators:
    def test_a_count_indicator_has_only_a_numerator(self, users, assign, api_for):
        assign(users["alice"], "HA06-31")
        api = api_for(users["alice"])
        row = api.form("HA06").json()["indicators"][0]
        assert row["has_denominator"] is False
        assert row["editable_fields"] == ["numerator"]
        assert row["field_owners"] == {"numerator": ["Name-alice"], "denominator": []}

        # the pre-phase-5 form posts "denominator": null for these rows; that stays fine
        resp = api.save("HA06", [{"indicator_code": "HA06-31", "numerator": 4, "denominator": None, "note": ""}])
        assert resp.status_code == 200
        entry = IndicatorEntry.objects.get()
        assert (entry.numerator, entry.denominator, entry.value) == (Decimal("4"), None, Decimal("4"))
        assert entry.denominator_filled_by is None

    def test_a_real_denominator_for_a_count_indicator_is_refused(self, users, assign, api_for):
        assign(users["alice"], "HA06-31")
        resp = api_for(users["alice"]).save("HA06", [{"indicator_code": "HA06-31", "numerator": 4, "denominator": 7}])
        assert resp.status_code == 400
        assert resp.json()["code"] == "field_not_assigned"
        assert resp.json()["fields"] == [{"indicator_code": "HA06-31", "field": "denominator"}]
        assert IndicatorEntry.objects.count() == 0

    def test_a_denominator_row_left_over_from_before_never_edits_the_denominator(self, users, assign, api_for):
        # a "denominator" assignment on a count indicator (the serializer now refuses to create one)
        assign(users["alice"], "HA06-31", field="denominator")
        api = api_for(users["alice"])
        assert api.form("HA06").json()["indicators"][0]["editable_fields"] == []
        # ... an assignment is all a note takes
        assert api.save("HA06", [{"indicator_code": "HA06-31", "note": "n"}]).status_code == 200
        assert IndicatorEntry.objects.get().note == "n"

    def test_count_indicators_are_complete_with_a_numerator_alone(self, users, assign, api_for):
        assign(users["alice"], "HA06-31")
        api = api_for(users["alice"])
        api.save("HA06", [{"indicator_code": "HA06-31", "numerator": 0}])
        resp = api.submit("HA06")
        assert resp.status_code == 200, resp.content  # a zero count is a filled count


# ── HA10-01 at Hsinchu: 13 sub-categories ────────────────────────

SUB_CODES = [s["sub_code"] for s in HA10_SUB_CATEGORIES]


def sub_payload(values: dict[str, object] | list) -> list[dict]:
    """sub_entries rows for the given values (a list in sub-category order, or {sub_code: value})."""
    if isinstance(values, list):
        values = dict(zip(SUB_CODES, values, strict=False))
    return [{"sub_code": code, "sub_name": "ignored", "value": value} for code, value in values.items()]


class TestHa10:
    def test_ha10_01_at_hsinchu_is_entered_as_13_sub_categories(self, users, assign, api_for):
        assign(users["alice"], "HA10-01", "hsinchu")
        api = api_for(users["alice"])
        row = api.form("HA10").json()["indicators"][0]
        assert row["is_ha10_hsinchu"] is True
        assert [s["sub_code"] for s in row["sub_entries"]] == SUB_CODES
        assert all(s["value"] is None for s in row["sub_entries"])

        resp = api.save("HA10", [
            {"indicator_code": "HA10-01", "numerator": None, "denominator": None, "note": "",
             "sub_entries": sub_payload(list(range(1, 14)))},
        ])
        assert resp.status_code == 200, resp.content
        entry = IndicatorEntry.objects.get()
        assert (entry.numerator, entry.value) == (Decimal("91"), Decimal("91"))  # 1 + 2 + ... + 13
        assert entry.numerator_filled_by == users["alice"]
        assert HA10SubEntry.objects.filter(entry=entry).count() == 13
        # names come from the server's table, not from the payload
        assert HA10SubEntry.objects.get(entry=entry, sub_code="HA10-10-02").sub_name == "跌倒事件"

        body = resp.json()["entries"][0]
        assert body["is_ha10_hsinchu"] is True and body["numerator"] == 91.0
        assert [s["value"] for s in body["sub_entries"]] == [float(n) for n in range(1, 14)]

    def test_sub_categories_left_out_of_a_payload_keep_their_values(self, users, assign, api_for):
        assign(users["alice"], "HA10-01", "hsinchu")
        api = api_for(users["alice"])
        api.save("HA10", [{"indicator_code": "HA10-01", "sub_entries": sub_payload(list(range(1, 14)))}])
        api.save("HA10", [{"indicator_code": "HA10-01", "sub_entries": sub_payload({"HA10-10-01": 100})}])
        entry = IndicatorEntry.objects.get()
        assert entry.numerator == Decimal("190")  # 91 - 1 + 100
        api.save("HA10", [{"indicator_code": "HA10-01", "sub_entries": sub_payload({"HA10-10-13": None})}])
        entry.refresh_from_db()
        assert entry.numerator == Decimal("177")  # a null clears that sub-category: 190 - 13

    def test_with_no_sub_category_value_the_numerator_is_empty(self, users, assign, api_for):
        assign(users["alice"], "HA10-01", "hsinchu")
        api = api_for(users["alice"])
        api.save("HA10", [{"indicator_code": "HA10-01", "sub_entries": sub_payload({"HA10-10-01": 4})}])
        assert IndicatorEntry.objects.get().numerator == Decimal("4")
        api.save("HA10", [{"indicator_code": "HA10-01", "sub_entries": sub_payload({"HA10-10-01": None})}])
        entry = IndicatorEntry.objects.get()
        assert (entry.numerator, entry.value) == (None, None)

    def test_the_numerator_alone_cannot_be_set_for_it_but_is_ignored_next_to_sub_entries(self, users, assign, api_for):
        assign(users["alice"], "HA10-01", "hsinchu")
        api = api_for(users["alice"])
        resp = api.save("HA10", [{"indicator_code": "HA10-01", "numerator": 50}])
        assert resp.status_code == 400 and resp.json()["code"] == "invalid_payload"
        assert IndicatorEntry.objects.count() == 0

        # what the pre-phase-5 form posts: the numerator it displays, plus the sub-categories
        resp = api.save("HA10", [
            {"indicator_code": "HA10-01", "numerator": 50, "denominator": None,
             "sub_entries": sub_payload({"HA10-10-01": 2, "HA10-10-02": 3})},
        ])
        assert resp.status_code == 200
        assert IndicatorEntry.objects.get().numerator == Decimal("5")  # the sum wins

    def test_a_save_carrying_sub_entries_always_leaves_the_numerator_at_their_sum(self, users, assign, api_for):
        assign(users["alice"], "HA10-01", "hsinchu")
        api = api_for(users["alice"])
        subs = sub_payload(list(range(1, 14)))
        api.save("HA10", [{"indicator_code": "HA10-01", "sub_entries": subs}])
        entry = IndicatorEntry.objects.get()

        # the numerator has drifted away from its sub-categories (an old override, a repair in the admin site ...)
        IndicatorEntry.objects.filter(pk=entry.pk).update(
            numerator=Decimal("99"), value=Decimal("99"), numerator_filled_by=None
        )
        # the very same sub-categories again: none of them changes, and the numerator is repaired all the same
        assert api.save("HA10", [{"indicator_code": "HA10-01", "sub_entries": subs}]).status_code == 200
        entry.refresh_from_db()
        assert (entry.numerator, entry.value) == (Decimal("91"), Decimal("91"))
        assert entry.numerator_filled_by == users["alice"]

    def test_resending_the_same_sub_categories_keeps_who_and_when(self, users, assign, api_for):
        assign(users["alice"], "HA10-01", "hsinchu")
        api = api_for(users["alice"])
        subs = sub_payload(list(range(1, 14)))
        api.save("HA10", [{"indicator_code": "HA10-01", "sub_entries": subs}])
        entry = IndicatorEntry.objects.get()
        before = (entry.numerator_filled_by, entry.numerator_filled_at, entry.filled_at)
        api.save("HA10", [{"indicator_code": "HA10-01", "sub_entries": subs}])  # an autosave, nothing new
        entry.refresh_from_db()
        assert (entry.numerator_filled_by, entry.numerator_filled_at, entry.filled_at) == before

    def test_a_save_without_sub_entries_leaves_the_numerator_alone(self, users, assign, api_for):
        assign(users["alice"], "HA10-01", "hsinchu")
        api = api_for(users["alice"])
        api.save("HA10", [{"indicator_code": "HA10-01", "sub_entries": sub_payload(list(range(1, 14)))}])
        assert api.save("HA10", [{"indicator_code": "HA10-01", "note": "just a note"}]).status_code == 200
        entry = IndicatorEntry.objects.get()
        assert (entry.numerator, entry.note) == (Decimal("91"), "just a note")

    def test_sub_categories_are_the_numerator_so_they_need_that_right(self, users, assign, api_for):
        assign(users["alice"], "HA10-01", "hsinchu", field="denominator")  # inconsistent legacy row
        resp = api_for(users["alice"]).save("HA10", [
            {"indicator_code": "HA10-01", "sub_entries": sub_payload({"HA10-10-01": 1})},
        ])
        assert resp.status_code == 400
        assert resp.json()["code"] == "field_not_assigned"
        assert resp.json()["fields"] == [{"indicator_code": "HA10-01", "field": "numerator"}]

    def test_bad_sub_entries_are_refused(self, users, assign, api_for):
        assign(users["alice"], "HA10-01", "hsinchu")
        api = api_for(users["alice"])
        for subs, code in (
            (sub_payload({"HA10-10-01": "x"}), "invalid_number"),
            ([{"sub_code": "HA10-10-99", "value": 1}], "invalid_payload"),
            (["nope"], "invalid_payload"),
            ("nope", "invalid_payload"),
        ):
            resp = api.save("HA10", [{"indicator_code": "HA10-01", "sub_entries": subs}])
            assert resp.status_code == 400, subs
            assert resp.json()["code"] == code, subs
        assert IndicatorEntry.objects.count() == 0

    def test_ha10_01_at_other_campuses_has_no_sub_categories(self, users, assign, api_for):
        assign(users["alice"], "HA10-01", "zhubei")
        api = api_for(users["alice"])
        row = api.form("HA10").json()["indicators"][0]
        assert row["is_ha10_hsinchu"] is False and row["sub_entries"] == []

        resp = api.save("HA10", [{"indicator_code": "HA10-01", "sub_entries": sub_payload({"HA10-10-01": 1})}])
        assert resp.status_code == 400 and resp.json()["code"] == "invalid_payload"
        assert api.save("HA10", [{"indicator_code": "HA10-01", "numerator": 12}]).status_code == 200
        assert IndicatorEntry.objects.get().numerator == Decimal("12")

    def test_ha10_04_at_hsinchu_is_a_plain_percent_indicator(self, users, assign, api_for):
        assign(users["alice"], "HA10-04", "hsinchu")
        api = api_for(users["alice"])
        row = api.form("HA10").json()["indicators"][0]
        assert (row["is_ha10_hsinchu"], row["sub_entries"]) == (False, [])
        assert row["editable_fields"] == ["numerator", "denominator"]

        resp = api.save("HA10", [{"indicator_code": "HA10-04", "numerator": 8, "denominator": 10, "note": ""}])
        assert resp.status_code == 200
        entry = IndicatorEntry.objects.get()
        assert (entry.numerator, entry.denominator, entry.value) == (Decimal("8"), Decimal("10"), Decimal("80"))
        assert HA10SubEntry.objects.count() == 0


# ── Locked reports (KD1) ─────────────────────────────────────────

class TestLockedReports:
    @pytest.mark.parametrize("state", ["submitted", "approved", "finalized"])
    def test_reporters_cannot_save_into_a_closed_report(self, state, users, assign, api_for, make_report):
        assign(users["alice"], "HA01-01")
        make_report("zhubei", "HA01", state)
        resp = api_for(users["alice"]).save("HA01", [{"indicator_code": "HA01-01", "numerator": 1, "denominator": 2}])
        assert resp.status_code == 403
        body = resp.json()
        assert body["code"] == "report_locked" and body["status"] == state
        assert IndicatorEntry.objects.count() == 0
        assert MonthlyReport.objects.get().status == state

    @pytest.mark.parametrize("state", ["submitted", "approved", "finalized"])
    def test_the_form_says_locked(self, state, users, assign, api_for, make_report):
        assign(users["alice"], "HA01-01")
        make_report("zhubei", "HA01", state)
        report = api_for(users["alice"]).form("HA01").json()["report"]
        assert (report["status"], report["locked"]) == (state, True)

    @pytest.mark.parametrize("state", ["unfilled", "draft"])
    def test_open_reports_are_not_locked(self, state, users, assign, api_for, make_report):
        assign(users["alice"], "HA01-01")
        make_report("zhubei", "HA01", state)
        assert api_for(users["alice"]).form("HA01").json()["report"]["locked"] is False
        resp = api_for(users["alice"]).save("HA01", [{"indicator_code": "HA01-01", "numerator": 1, "denominator": 2}])
        assert resp.status_code == 200

    def test_the_lock_is_checked_before_anything_else(self, users, assign, api_for, make_report):
        assign(users["alice"], "HA01-01")
        make_report("zhubei", "HA01", "approved")
        # an unassigned indicator in a locked report: the lock answers first
        resp = api_for(users["alice"]).save("HA01", [{"indicator_code": "HA01-02", "numerator": 1}])
        assert resp.status_code == 403 and resp.json()["code"] == "report_locked"


# ── Several campuses, explicit campus ────────────────────────────

class TestCampusResolution:
    @pytest.fixture
    def two_campuses(self, users, assign):
        alice = users["alice"]
        assign(alice, "HA01-01", "zhubei")
        assign(alice, "HA01-01", "zhudong")
        return alice

    def test_without_a_campus_every_endpoint_asks_for_one(self, two_campuses, api_for):
        api = api_for(two_campuses)
        for resp in (
            api.form("HA01"),
            api.save("HA01", [{"indicator_code": "HA01-01", "numerator": 1, "denominator": 2}]),
            api.submit("HA01"),
        ):
            assert resp.status_code == 400
            assert resp.json() == {"detail": "請指定院區", "code": "campus_required"}
        assert IndicatorEntry.objects.count() == 0

    def test_a_campus_outside_the_assignments_is_a_403(self, two_campuses, api_for):
        api = api_for(two_campuses)
        for resp in (
            api.form("HA01", campus="hsinchu"),
            api.save("HA01", [], campus="hsinchu"),
            api.submit("HA01", campus="hsinchu"),
        ):
            assert resp.status_code == 403
            assert resp.json()["code"] == "campus_not_assigned"
        assert MonthlyReport.objects.count() == 0

    def test_each_campus_has_its_own_report_and_numbers(self, two_campuses, api_for):
        api = api_for(two_campuses)
        row = {"indicator_code": "HA01-01"}
        assert api.save("HA01", [{**row, "numerator": 5, "denominator": 100}], campus="zhubei").status_code == 200
        assert api.save("HA01", [{**row, "numerator": 9, "denominator": 100}], campus="zhudong").status_code == 200
        assert MonthlyReport.objects.count() == 2
        by_campus = {e.report.campus.code: e.numerator for e in IndicatorEntry.objects.select_related("report__campus")}
        assert by_campus == {"zhubei": Decimal("5"), "zhudong": Decimal("9")}
        assert api.form("HA01", campus="zhubei").json()["indicators"][0]["numerator"] == 5.0
        assert api.form("HA01", campus="zhudong").json()["indicators"][0]["numerator"] == 9.0
        assert api.form("HA01", campus="zhudong").json()["campus"]["code"] == "zhudong"

    def test_my_tasks_lists_the_two_campuses_as_separate_rows(self, two_campuses, api_for, make_report):
        make_report("zhubei", "HA01", "draft", rejection_reason="redo the numerator")
        make_report("zhudong", "HA01", "submitted")
        body = api_for(two_campuses).tasks().json()
        rows = {r["campus_code"]: r for r in body["categories"]}
        assert set(rows) == {"zhubei", "zhudong"}
        assert rows["zhubei"]["status"] == "draft" and rows["zhubei"]["rejection_reason"] == "redo the numerator"
        assert rows["zhudong"]["status"] == "submitted" and rows["zhudong"]["rejection_reason"] == ""
        assert rows["zhubei"]["campus_name"] == "竹北" and rows["zhudong"]["campus_name"] == "竹東"
        assert rows["zhubei"]["report_id"] != rows["zhudong"]["report_id"]
        # the rejection notice names the campus it is about
        notices = [(n["campus_code"], n["campus_name"], n["category_code"], n["reason"])
                   for n in body["rejection_notices"]]
        assert notices == [("zhubei", "竹北", "HA01", "redo the numerator")]
        assert body["overall_progress"] == {"filled": 0, "total": 2}

    def test_the_users_own_campus_is_not_a_fallback(self, make_user, campuses, api_for):
        resident = make_user("resident", ["reporter"], campus=campuses["zhubei"])
        api = api_for(resident)
        resp = api.form("HA01")
        assert resp.status_code == 400 and resp.json()["code"] == "no_assignment"
        assert api.save("HA01", []).status_code == 400
        assert api.submit("HA01").status_code == 400
        assert MonthlyReport.objects.count() == 0
        assert api.tasks().json()["categories"] == []

    def test_my_tasks_shows_nothing_for_other_peoples_rejections(self, users, assign, api_for, make_report):
        assign(users["alice"], "HA01-01")
        make_report("zhubei", "HA02", "draft", rejection_reason="not alice's category")
        assert api_for(users["alice"]).tasks().json()["rejection_notices"] == []


# ── my-tasks progress ────────────────────────────────────────────

class TestMyTasks:
    def test_progress_counts_fields_and_the_whole_category(self, users, assign, api_for):
        alice, bob = users["alice"], users["bob"]
        assign(alice, "HA01-01", field="numerator")
        assign(bob, "HA01-01", field="denominator")
        assign(bob, "HA01-02", field="both")

        def row(user):
            return api_for(user).tasks().json()["categories"][0]

        a, b = row(alice), row(bob)
        assert (a["my_total"], a["my_filled"], a["total_count"], a["filled_count"]) == (1, 0, 1, 0)
        assert (b["my_total"], b["my_filled"], b["total_count"], b["filled_count"]) == (3, 0, 2, 0)
        assert a["category_missing"] == b["category_missing"] == 4  # 2 + 2 required fields

        api_for(alice).save("HA01", [{"indicator_code": "HA01-01", "numerator": 5}])
        a, b = row(alice), row(bob)
        assert (a["my_filled"], a["filled_count"]) == (1, 1)
        assert (b["my_filled"], b["filled_count"]) == (0, 0)
        assert a["category_missing"] == b["category_missing"] == 3

        api_for(bob).save("HA01", [
            {"indicator_code": "HA01-01", "denominator": 100},
            {"indicator_code": "HA01-02", "numerator": 1, "denominator": 0},  # a zero denominator is filled
        ])
        a, b = row(alice), row(bob)
        assert (b["my_total"], b["my_filled"], b["filled_count"]) == (3, 3, 2)
        assert a["category_missing"] == b["category_missing"] == 0

    @pytest.mark.parametrize("year, month", [
        (115, -1), (115, 0), (115, 13), (1000000, 3), (115, 10**9), (-5000, 3), (8088, 12),
    ])
    @pytest.mark.parametrize("who", ["alice", "admin"])
    def test_an_impossible_period_is_a_400_not_a_500(self, who, year, month, users, assign, api_for):
        assign(users["alice"], "HA01-01")
        resp = api_for(users[who]).tasks(year, month)
        assert resp.status_code == 400
        assert resp.json() == {"detail": "年月不正確", "code": "invalid_period"}

    @pytest.mark.parametrize("year, month", [(115, -1), (115, 0), (115, 13), (1000000, 3), (8088, 12)])
    def test_the_other_endpoints_refuse_the_same_periods(self, year, month, users, assign, api_for):
        assign(users["alice"], "HA01-01")
        api = api_for(users["alice"])
        for resp in (
            api.form("HA01", year=year, month=month),
            api.save("HA01", [{"indicator_code": "HA01-01", "numerator": 1}], year=year, month=month),
            api.submit("HA01", year=year, month=month),
        ):
            assert resp.status_code == 400
            assert resp.json()["code"] == "invalid_period"
        assert MonthlyReport.objects.count() == 0

    def test_the_last_month_of_a_year_is_a_period(self, users, assign, api_for):
        assign(users["alice"], "HA01-01", effective_from=datetime.date(2025, 1, 1))
        body = api_for(users["alice"]).tasks(114, 12).json()
        assert body["deadline"]["tw_deadline_date"] == "115年1月10日"
        assert [c["category_code"] for c in body["categories"]] == ["HA01"]

    def test_a_count_indicator_has_one_field_to_fill(self, users, assign, api_for):
        assign(users["alice"], "HA06-31")
        row = api_for(users["alice"]).tasks().json()["categories"][0]
        assert (row["my_total"], row["category_missing"]) == (1, 1)

    def test_assignments_from_other_months_are_not_listed(self, users, assign, api_for):
        assign(users["alice"], "HA01-01", effective_to=datetime.date(2026, 2, 28))
        assert api_for(users["alice"]).tasks().json()["categories"] == []
        assert api_for(users["alice"]).tasks(month=2).json()["categories"][0]["category_code"] == "HA01"

    def test_an_indicator_nobody_owns_is_a_gap_in_the_category(self, users, assign, api_for):
        assign(users["alice"], "HA01-01", field="numerator")  # nobody owns the denominator
        row = api_for(users["alice"]).tasks().json()["categories"][0]
        assert row["category_missing"] == 2 and row["my_total"] == 1

    def test_ha10_01_at_hsinchu_is_filled_only_with_all_13_sub_categories(self, users, assign, api_for):
        assign(users["alice"], "HA10-01", "hsinchu")
        api = api_for(users["alice"])
        api.save("HA10", [{"indicator_code": "HA10-01", "sub_entries": sub_payload(list(range(1, 13)))}])  # 12 of 13
        row = api.tasks().json()["categories"][0]
        assert (row["my_filled"], row["category_missing"]) == (0, 1)
        api.save("HA10", [{"indicator_code": "HA10-01", "sub_entries": sub_payload({"HA10-10-13": 13})}])
        row = api.tasks().json()["categories"][0]
        assert (row["my_filled"], row["category_missing"]) == (1, 0)


# ── Admin on the entry side (KD4) ────────────────────────────────

class TestAdminOnTheEntrySide:
    def test_admin_passes_the_gate_but_has_no_fields_of_their_own(self, users, assign, api_for):
        assign(users["alice"], "HA01-01")
        api = api_for(users["admin"])
        assert api.tasks().status_code == 200
        form = api.form("HA01", campus="zhubei")
        assert form.status_code == 200
        assert form.json()["indicators"] == []  # the admin is assigned nothing here

        resp = api.save("HA01", [{"indicator_code": "HA01-01", "numerator": 1, "denominator": 2}], campus="zhubei")
        assert resp.status_code == 403 and resp.json()["code"] == "not_assigned"
        assert IndicatorEntry.objects.count() == 0

    def test_an_admin_edits_exactly_what_they_are_assigned(self, users, assign, api_for):
        assign(users["alice"], "HA01-01", field="numerator")
        assign(users["admin"], "HA01-01", field="denominator")
        api = api_for(users["admin"])
        assert api.form("HA01").json()["indicators"][0]["editable_fields"] == ["denominator"]
        assert api.save("HA01", [{"indicator_code": "HA01-01", "denominator": 40}]).status_code == 200
        resp = api.save("HA01", [{"indicator_code": "HA01-01", "numerator": 4}])
        assert resp.status_code == 400 and resp.json()["code"] == "field_not_assigned"

    def test_the_task_list_of_an_admin_is_their_own_assignments(self, users, assign, api_for):
        assign(users["alice"], "HA01-01")
        assert api_for(users["admin"]).tasks().json()["categories"] == []

    def test_a_viewer_or_reviewer_still_cannot_use_the_entry_api(self, users, api_for):
        for name in ("viewer", "reviewer"):
            assert api_for(users[name]).tasks().status_code == 403


# ── Case-list indicators (KD9) ───────────────────────────────────

class TestCaseListIndicators:
    def test_the_form_shows_a_case_list_indicator_but_offers_no_field(self, users, assign, api_for):
        assign(users["alice"], "HA03-01")
        row = api_for(users["alice"]).form("HA03").json()["indicators"][0]
        assert row["entry_mode"] == "case_list"
        assert row["editable_fields"] == []
        assert row["field_owners"] == {"numerator": ["Name-alice"], "denominator": ["Name-alice"]}

    def test_saving_numbers_for_a_case_list_indicator_is_refused(self, users, assign, api_for):
        assign(users["alice"], "HA03-01")
        api = api_for(users["alice"])
        resp = api.save("HA03", [{"indicator_code": "HA03-01", "numerator": 3, "denominator": 10}])
        assert resp.status_code == 400
        assert resp.json()["code"] == "field_not_assigned"
        assert {f["field"] for f in resp.json()["fields"]} == {"numerator", "denominator"}
        assert MonthlyReport.objects.count() == 0 and IndicatorEntry.objects.count() == 0

    def test_the_note_of_a_case_list_indicator_is_written(self, users, assign, api_for):
        assign(users["alice"], "HA03-01")
        api = api_for(users["alice"])
        resp = api.save("HA03", [{"indicator_code": "HA03-01", "note": "waiting for the HIS extract"}])
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "draft"
        assert [(e["indicator_code"], e["note"]) for e in body["entries"]] == [
            ("HA03-01", "waiting for the HIS extract")
        ]
        entry = IndicatorEntry.objects.get()
        assert entry.note == "waiting for the HIS extract"
        assert (entry.numerator, entry.denominator, entry.value) == (None, None, None)
        assert entry.filled_by == users["alice"]
        assert entry.numerator_filled_by is None and entry.denominator_filled_by is None  # no number was entered

        row = api.form("HA03").json()["indicators"][0]
        assert row["note"] == "waiting for the HIS extract" and row["editable_fields"] == []  # shown, still read-only

        assert api.save("HA03", [{"indicator_code": "HA03-01", "note": ""}]).status_code == 200
        entry.refresh_from_db()
        assert entry.note == ""

    def test_a_note_leaves_the_numbers_of_a_case_list_entry_alone(
        self, users, assign, api_for, make_report, entry_for
    ):
        assign(users["alice"], "HA03-01")
        report = make_report("zhubei", "HA03", "draft")
        entry = entry_for(report, "HA03-01", 3, 20, 15, raw_numerator=3)
        assert api_for(users["alice"]).save("HA03", [{"indicator_code": "HA03-01", "note": "n"}]).status_code == 200
        entry.refresh_from_db()
        assert (entry.numerator, entry.denominator, entry.value, entry.raw_numerator, entry.note) == (
            Decimal("3"), Decimal("20"), Decimal("15"), 3, "n"
        )
        assert entry.numerator_filled_by is None

    def test_the_note_of_a_case_list_indicator_needs_an_assignment(self, users, assign, api_for):
        assign(users["alice"], "HA03-01")
        resp = api_for(users["bob"]).save("HA03", [{"indicator_code": "HA03-01", "note": "x"}])
        assert resp.status_code == 400 and resp.json()["code"] == "no_assignment"  # bob holds nothing in HA03
        assign(users["bob"], "HA03-02")
        resp = api_for(users["bob"]).save("HA03", [{"indicator_code": "HA03-01", "note": "x"}])
        assert resp.status_code == 403 and resp.json()["code"] == "not_assigned"
        assert MonthlyReport.objects.count() == 0 and IndicatorEntry.objects.count() == 0

    def test_a_case_list_note_and_a_refused_number_in_one_payload_write_nothing(self, users, assign, api_for):
        assign(users["alice"], "HA03-01")
        assign(users["alice"], "HA01-01")
        resp = api_for(users["alice"]).save(
            "HA03", [{"indicator_code": "HA03-01", "note": "x", "numerator": 1}]
        )
        assert resp.status_code == 400 and resp.json()["code"] == "field_not_assigned"
        assert IndicatorEntry.objects.count() == 0 and MonthlyReport.objects.count() == 0
