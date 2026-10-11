"""
Submission, review and the other writers of IndicatorEntry (Phase 5).

  TestSubmit             the whole campus x category must be complete (KD2, KD3); who may submit (KD4)
  TestSubmitHa10         HA10-01 at Hsinchu needs all 13 sub-categories
  TestReviewEdit         reviewer edits (KD5)
  TestReviewDetail       the per-field "who filled it"
  TestUnlock             unlock reports the number of reports it unlocked
  TestCaseListWrites     excluding / restoring cases needs the numerator of that indicator and an open report
  TestCaseListReads      reading a case list needs an assignment (reviewers and admins read all)
  TestImport             the importer is who filled the imported numbers
"""
from __future__ import annotations

import datetime
import json
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied

from apps.entry.adapters.base import IndicatorDataPoint
from apps.entry.models import (
    CaseRecord,
    EntryAuditLog,
    ExclusionReason,
    HA10SubEntry,
    ImportBatch,
    IndicatorEntry,
    MonthlyReport,
)
from apps.entry.services.entry_service import submit_category
from apps.entry.services.import_service import write_preview_entries
from apps.entry.services.values import HA10_SUB_CATEGORIES
from apps.entry.tests.conftest import MONTH, YEAR
from apps.entry.views_case_list import _mask_chart_no, _sees_full_chart_no
from apps.indicators.models import Indicator

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _world(world):
    return world


def post(client, url, payload):
    return client.post(url, data=json.dumps(payload), content_type="application/json")


# ── Submit ───────────────────────────────────────────────────────

class TestSubmit:
    def test_the_gaps_name_their_owners_and_unassigned_fields_are_marked(self, users, assign, api_for):
        alice, bob = users["alice"], users["bob"]
        assign(alice, "HA01-01", field="numerator")
        assign(bob, "HA01-01", field="denominator")
        assign(alice, "HA01-02", field="numerator")  # nobody owns the denominator of HA01-02
        api_for(alice).save("HA01", [{"indicator_code": "HA01-01", "numerator": 5}])

        resp = api_for(alice).submit("HA01")
        assert resp.status_code == 400
        body = resp.json()
        assert body["code"] == "incomplete"
        assert body["missing"] == [
            {"indicator_code": "HA01-01", "indicator_name": "住院死亡率", "field": "denominator",
             "owners": ["Name-bob"], "unassigned": False},
            {"indicator_code": "HA01-02", "indicator_name": "14天非計畫再住院率", "field": "numerator",
             "owners": ["Name-alice"], "unassigned": False},
            {"indicator_code": "HA01-02", "indicator_name": "14天非計畫再住院率", "field": "denominator",
             "owners": [], "unassigned": True},
        ]
        assert "Name-bob" in body["detail"] and "未指派" in body["detail"]
        assert body["unfilled_codes"] == ["HA01-01", "HA01-02"]  # the key the pre-phase-5 error body had
        assert MonthlyReport.objects.get().status == "draft"

    def test_the_message_stays_short_for_a_long_list(self, users, assign, api_for, make_report):
        for code in ("HA01-01", "HA01-02", "HA02-11", "HA06-31", "HA10-01", "HA10-04"):
            assign(users["alice"], code)
        # everything of HA01 is empty, only 4 required fields: build a long list on purpose
        for n in range(1, 10):
            assign(users["alice"], f"HA01-0{n}-01")
        body = api_for(users["alice"]).submit("HA01").json()
        assert len(body["missing"]) == 22  # 11 indicators x 2 fields, none filled
        assert body["detail"].endswith("…等共 22 項")

    def test_a_zero_denominator_counts_as_filled(self, users, assign, api_for):
        assign(users["alice"], "HA01-01")
        api = api_for(users["alice"])
        api.save("HA01", [{"indicator_code": "HA01-01", "numerator": 0, "denominator": 0}])
        entry = IndicatorEntry.objects.get()
        assert (entry.numerator, entry.denominator, entry.value) == (Decimal("0"), Decimal("0"), None)
        resp = api.submit("HA01")
        assert resp.status_code == 200, resp.content  # used to be refused for ever: the value stays empty
        assert MonthlyReport.objects.get().status == "submitted"

    def test_a_missing_denominator_is_not_a_zero(self, users, assign, api_for):
        assign(users["alice"], "HA01-01")
        api = api_for(users["alice"])
        api.save("HA01", [{"indicator_code": "HA01-01", "numerator": 3}])
        resp = api.submit("HA01")
        assert resp.status_code == 400
        assert [(m["indicator_code"], m["field"]) for m in resp.json()["missing"]] == [("HA01-01", "denominator")]

    def test_everything_filled_submits_and_clears_the_rejection(self, users, assign, api_for, make_report):
        alice = users["alice"]
        assign(alice, "HA01-01")
        report = make_report("zhubei", "HA01", "draft", rejection_reason="fix it")
        api_for(alice).save("HA01", [{"indicator_code": "HA01-01", "numerator": 5, "denominator": 100}])
        resp = api_for(alice).submit("HA01")
        assert resp.status_code == 200
        assert resp.json() == {"ok": True, "report_id": report.id, "status": "submitted"}
        report.refresh_from_db()
        assert (report.status, report.submitted_by, report.rejection_reason) == ("submitted", alice, "")
        assert report.submitted_at is not None

    def test_the_whole_category_is_checked_not_just_my_part(self, users, assign, api_for):
        alice, bob = users["alice"], users["bob"]
        assign(alice, "HA01-01")
        assign(bob, "HA01-02")
        api_for(alice).save("HA01", [{"indicator_code": "HA01-01", "numerator": 5, "denominator": 100}])

        resp = api_for(alice).submit("HA01")  # alice is done, bob is not
        assert resp.status_code == 400
        assert {(m["indicator_code"], tuple(m["owners"])) for m in resp.json()["missing"]} == {
            ("HA01-02", ("Name-bob",))
        }

        api_for(bob).save("HA01", [{"indicator_code": "HA01-02", "numerator": 1, "denominator": 20}])
        assert api_for(alice).submit("HA01").status_code == 200  # either owner may submit the finished report
        assert MonthlyReport.objects.get().submitted_by == alice

    def test_another_category_or_campus_does_not_hold_it_back(self, users, assign, api_for):
        alice = users["alice"]
        assign(alice, "HA01-01", "zhubei")
        assign(users["bob"], "HA01-02", "zhudong")  # same category, other campus
        assign(users["bob"], "HA06-31", "zhubei")  # same campus, other category
        api_for(alice).save("HA01", [{"indicator_code": "HA01-01", "numerator": 5, "denominator": 100}])
        assert api_for(alice).submit("HA01").status_code == 200

    def test_assignments_that_ended_before_the_month_do_not_count(self, users, assign, api_for):
        alice = users["alice"]
        assign(alice, "HA01-01")
        assign(users["bob"], "HA01-02", effective_to=datetime.date(2026, 2, 28))
        api_for(alice).save("HA01", [{"indicator_code": "HA01-01", "numerator": 5, "denominator": 100}])
        assert api_for(alice).submit("HA01").status_code == 200

    def test_an_indicator_without_a_report_yet_is_all_gaps(self, users, assign, api_for):
        assign(users["alice"], "HA01-01")
        resp = api_for(users["alice"]).submit("HA01")
        assert resp.status_code == 400 and resp.json()["code"] == "incomplete"
        assert len(resp.json()["missing"]) == 2
        assert MonthlyReport.objects.count() == 0  # a refused submit creates nothing

    @pytest.mark.parametrize("state", ["submitted", "approved", "finalized"])
    def test_a_closed_report_cannot_be_submitted_again(self, state, users, assign, api_for, make_report, entry_for):
        assign(users["alice"], "HA01-01")
        report = make_report("zhubei", "HA01", state)
        entry_for(report, "HA01-01", 5, 100, 5)
        resp = api_for(users["alice"]).submit("HA01")
        assert resp.status_code == 403
        assert resp.json()["code"] == "report_locked"
        report.refresh_from_db()
        assert report.status == state

    def test_somebody_without_an_assignment_in_the_unit_may_not_submit(
        self, users, assign, api_for, make_report, entry_for
    ):
        assign(users["alice"], "HA01-01", "zhubei")
        assign(users["carol"], "HA06-31", "zhubei")  # same campus, other category
        assign(users["carol"], "HA01-01", "zhudong")  # same category, other campus
        report = make_report("zhubei", "HA01", "draft")
        entry_for(report, "HA01-01", 5, 100, 5)
        resp = api_for(users["carol"]).submit("HA01", campus="zhubei")
        assert resp.status_code == 403
        assert resp.json()["code"] == "campus_not_assigned"  # resolve_campus answers before the service is reached
        report.refresh_from_db()
        assert report.status == "draft"

    def test_nobody_in_the_category_at_all_has_to_name_a_campus_first(self, users, assign, api_for):
        assign(users["alice"], "HA01-01", "zhubei")
        api = api_for(users["bob"])  # holds no HA01 assignment anywhere
        resp = api.submit("HA01")
        assert resp.status_code == 400 and resp.json()["code"] == "no_assignment"
        resp = api.submit("HA01", campus="zhubei")
        assert resp.status_code == 403 and resp.json()["code"] == "campus_not_assigned"

    def test_the_service_keeps_its_own_check_for_direct_callers(self, users, assign, campuses):
        """Never reached through the API (see above); a caller of submit_category itself gets this one."""
        assign(users["alice"], "HA01-01", "zhubei")
        with pytest.raises(PermissionDenied) as caught:
            submit_category(users["bob"], campuses["zhubei"], YEAR, MONTH, "HA01")
        assert caught.value.detail["code"] == "not_assigned"

    def test_an_assignment_with_a_different_field_still_makes_me_a_submitter(self, users, assign, api_for):
        assign(users["alice"], "HA01-01", field="numerator")
        assign(users["bob"], "HA01-01", field="denominator")
        api_for(users["alice"]).save("HA01", [{"indicator_code": "HA01-01", "numerator": 5}])
        api_for(users["bob"]).save("HA01", [{"indicator_code": "HA01-01", "denominator": 100}])
        assert api_for(users["bob"]).submit("HA01").status_code == 200

    def test_admin_can_submit_on_behalf_of_the_unit(self, users, assign, api_for):
        admin = users["admin"]
        assign(users["alice"], "HA01-01")
        api = api_for(admin)

        resp = api.submit("HA01", campus="zhubei")  # nothing filled yet
        assert resp.status_code == 400 and resp.json()["code"] == "incomplete"
        assert resp.json()["missing"][0]["owners"] == ["Name-alice"]

        api_for(users["alice"]).save("HA01", [{"indicator_code": "HA01-01", "numerator": 5, "denominator": 100}])
        resp = api.submit("HA01", campus="zhubei")
        assert resp.status_code == 200
        assert MonthlyReport.objects.get().submitted_by == admin

    def test_admin_still_has_to_say_which_campus(self, users, assign, api_for):
        assign(users["alice"], "HA01-01")
        resp = api_for(users["admin"]).submit("HA01")
        assert resp.status_code == 400 and resp.json()["code"] == "campus_required"

    def test_nothing_assigned_means_nothing_to_submit(self, users, api_for):
        resp = api_for(users["admin"]).submit("HA01", campus="zhubei")
        assert resp.status_code == 400
        assert resp.json()["code"] == "no_indicators"
        assert MonthlyReport.objects.count() == 0

    def test_values_filled_by_an_import_count(self, users, assign, api_for, make_report, entry_for):
        assign(users["alice"], "HA01-01")
        report = make_report("zhubei", "HA01", "unfilled")  # what an import leaves behind
        entry_for(report, "HA01-01", 5, 100, 5, data_source="excel")
        assert api_for(users["alice"]).submit("HA01").status_code == 200

    def test_an_unknown_category_is_refused(self, users, assign, api_for):
        assign(users["admin"], "ZZ99-01", "zhubei")
        resp = api_for(users["admin"]).submit("ZZ99", campus="zhubei")
        assert resp.status_code == 404 and resp.json()["code"] == "category_not_found"


class TestSubmitHa10:
    def fill(self, report, values=None, numerator=None):
        entry = IndicatorEntry.objects.create(
            report=report, indicator_code="HA10-01", numerator=numerator, value=numerator
        )
        for sub, value in zip(HA10_SUB_CATEGORIES, values or [], strict=False):
            HA10SubEntry.objects.create(entry=entry, sub_code=sub["sub_code"], sub_name=sub["sub_name"], value=value)
        return entry

    def test_all_13_sub_categories_are_required_at_hsinchu(self, users, assign, api_for, make_report):
        assign(users["alice"], "HA10-01", "hsinchu")
        report = make_report("hsinchu", "HA10", "draft")
        self.fill(report, values=[1] * 12 + [None], numerator=12)
        resp = api_for(users["alice"]).submit("HA10")
        assert resp.status_code == 400
        gap = resp.json()["missing"][0]
        assert (gap["indicator_code"], gap["field"], gap["owners"]) == ("HA10-01", "numerator", ["Name-alice"])
        assert gap["sub_codes"] == ["HA10-10-13"]

    def test_no_sub_categories_at_all_lists_all_13(self, users, assign, api_for, make_report):
        assign(users["alice"], "HA10-01", "hsinchu")
        report = make_report("hsinchu", "HA10", "draft")
        self.fill(report, numerator=50)  # a numerator typed in by hand does not replace the sub-categories
        gap = api_for(users["alice"]).submit("HA10").json()["missing"][0]
        assert len(gap["sub_codes"]) == 13

    def test_zero_is_a_value_for_a_sub_category(self, users, assign, api_for, make_report):
        assign(users["alice"], "HA10-01", "hsinchu")
        report = make_report("hsinchu", "HA10", "draft")
        self.fill(report, values=[0] * 13, numerator=0)
        assert api_for(users["alice"]).submit("HA10").status_code == 200

    def test_other_campuses_need_no_sub_categories(self, users, assign, api_for, make_report):
        assign(users["alice"], "HA10-01", "zhubei")
        report = make_report("zhubei", "HA10", "draft")
        self.fill(report, numerator=12)
        assert api_for(users["alice"]).submit("HA10").status_code == 200

    def test_ha10_04_at_hsinchu_needs_a_numerator_and_a_denominator_only(self, users, assign, api_for):
        assign(users["alice"], "HA10-04", "hsinchu")
        api = api_for(users["alice"])
        api.save("HA10", [{"indicator_code": "HA10-04", "numerator": 8, "denominator": 10}])
        assert api.submit("HA10").status_code == 200

    def test_the_sub_categories_travel_through_save_and_submit(self, users, assign, api_for):
        assign(users["alice"], "HA10-01", "hsinchu")
        api = api_for(users["alice"])
        subs = [{"sub_code": s["sub_code"], "value": n} for n, s in enumerate(HA10_SUB_CATEGORIES, start=1)]
        assert api.save("HA10", [{"indicator_code": "HA10-01", "sub_entries": subs[:12]}]).status_code == 200
        assert api.submit("HA10").status_code == 400
        assert api.save("HA10", [{"indicator_code": "HA10-01", "sub_entries": subs[12:]}]).status_code == 200
        assert api.submit("HA10").status_code == 200
        assert IndicatorEntry.objects.get().numerator == Decimal("91")


# ── Reviewer edits (KD5) ─────────────────────────────────────────

@pytest.fixture
def filled_entry(users, make_report, entry_for):
    """An entry whose numerator was entered by alice and whose denominator by bob."""

    def _make(state="submitted", code="HA01-01", numerator=5, denominator=100, value=5, campus="zhubei"):
        stamp = timezone.now() - datetime.timedelta(days=1)
        report = make_report(campus, code[:4], state)
        return entry_for(
            report, code, numerator, denominator, value,
            filled_by=users["bob"], filled_at=stamp,
            numerator_filled_by=users["alice"], numerator_filled_at=stamp,
            denominator_filled_by=users["bob"], denominator_filled_at=stamp,
        )

    return _make


def edit(client, entry, field, new_value, reason="check"):
    payload = {"entry_id": entry.id, "field": field, "new_value": new_value, "reason": reason}
    return client.patch("/api/review/edit-entry", data=json.dumps(payload), content_type="application/json")


class TestReviewEdit:
    @pytest.mark.parametrize("state", ["submitted", "approved"])
    def test_a_reviewer_can_edit_a_submitted_or_approved_report(self, state, users, client_for, filled_entry):
        entry = filled_entry(state)
        resp = edit(client_for(users["reviewer"]), entry, "numerator", "6", "matches the HIS")
        assert resp.status_code == 200, resp.content
        assert resp.json()["field"] == "numerator" and resp.json()["new_value"] == "6.00"
        entry.refresh_from_db()
        assert (entry.numerator, entry.denominator, entry.value) == (Decimal("6"), Decimal("100"), Decimal("6"))

    @pytest.mark.parametrize("state, code", [("unfilled", "report_not_editable"), ("draft", "report_not_editable"),
                                             ("finalized", "report_finalized")])
    def test_while_reporters_own_the_report_the_reviewer_cannot_edit(
        self, state, code, users, client_for, filled_entry
    ):
        entry = filled_entry(state)
        resp = edit(client_for(users["reviewer"]), entry, "numerator", "6")
        assert resp.status_code == 400
        assert resp.json()["code"] == code
        entry.refresh_from_db()
        assert entry.numerator == Decimal("5")
        assert EntryAuditLog.objects.count() == 0

    def test_a_reviewer_edit_does_not_change_who_filled_the_number(self, users, client_for, filled_entry):
        entry = filled_entry("approved")
        before = (entry.filled_by_id, entry.filled_at, entry.numerator_filled_by_id, entry.numerator_filled_at,
                  entry.denominator_filled_by_id, entry.denominator_filled_at, entry.data_source)
        client = client_for(users["reviewer"])
        assert edit(client, entry, "numerator", "6").status_code == 200
        assert edit(client, entry, "denominator", "50").status_code == 200
        entry.refresh_from_db()
        after = (entry.filled_by_id, entry.filled_at, entry.numerator_filled_by_id, entry.numerator_filled_at,
                 entry.denominator_filled_by_id, entry.denominator_filled_at, entry.data_source)
        assert after == before
        assert entry.numerator_filled_by == users["alice"] and entry.denominator_filled_by == users["bob"]
        assert entry.value == Decimal("12")  # 6 / 50 * 100

    def test_the_audit_log_records_the_change(self, users, client_for, filled_entry):
        entry = filled_entry("submitted")
        edit(client_for(users["reviewer"]), entry, "denominator", "80", "typo")
        log = EntryAuditLog.objects.get()
        assert (log.entry_id, log.field_name, log.old_value, log.new_value, log.changed_by, log.reason) == (
            entry.id, "denominator", "100.00", "80.00", users["reviewer"], "typo"
        )

    def test_zero_is_a_number_not_a_blank(self, users, client_for, filled_entry):
        entry = filled_entry("submitted")
        client = client_for(users["reviewer"])
        assert edit(client, entry, "numerator", 0).status_code == 200  # JSON number 0 used to clear the field
        entry.refresh_from_db()
        assert entry.numerator == Decimal("0") and entry.value == Decimal("0")
        assert edit(client, entry, "numerator", 4).status_code == 200
        log = EntryAuditLog.objects.filter(new_value="4.00").get()
        assert log.old_value == "0.00"  # zero shows up as "0.00", not as an empty string

    @pytest.mark.parametrize("blank", ["", "  ", None])
    def test_a_blank_clears_the_field_and_the_value(self, blank, users, client_for, filled_entry):
        entry = filled_entry("submitted")
        assert edit(client_for(users["reviewer"]), entry, "numerator", blank).status_code == 200
        entry.refresh_from_db()
        assert (entry.numerator, entry.value) == (None, None)

    def test_a_zero_denominator_leaves_no_value(self, users, client_for, filled_entry):
        entry = filled_entry("submitted")
        assert edit(client_for(users["reviewer"]), entry, "denominator", "0").status_code == 200
        entry.refresh_from_db()
        assert (entry.denominator, entry.value) == (Decimal("0"), None)  # no stale value is left behind

    def test_the_value_of_an_indicator_with_a_denominator_cannot_be_edited(self, users, client_for, filled_entry):
        entry = filled_entry("submitted")
        resp = edit(client_for(users["reviewer"]), entry, "value", "9")
        assert resp.status_code == 400 and resp.json()["code"] == "value_not_editable"
        entry.refresh_from_db()
        assert entry.value == Decimal("5")
        assert EntryAuditLog.objects.count() == 0

    def test_the_value_of_a_count_indicator_is_its_numerator(self, users, client_for, filled_entry):
        entry = filled_entry("approved", code="HA06-31", numerator=4, denominator=None, value=4)
        resp = edit(client_for(users["reviewer"]), entry, "value", "7")
        assert resp.status_code == 200
        entry.refresh_from_db()
        assert (entry.numerator, entry.value) == (Decimal("7"), Decimal("7"))
        log = EntryAuditLog.objects.get()
        assert (log.field_name, log.old_value, log.new_value) == ("numerator", "4.00", "7.00")

    def test_a_count_indicator_has_no_denominator_to_edit(self, users, client_for, filled_entry):
        entry = filled_entry("approved", code="HA06-31", numerator=4, denominator=None, value=4)
        resp = edit(client_for(users["reviewer"]), entry, "denominator", "7")
        assert resp.status_code == 400 and resp.json()["code"] == "no_denominator"

    def test_editing_the_numerator_of_a_count_indicator_updates_the_value(self, users, client_for, filled_entry):
        entry = filled_entry("approved", code="HA06-31", numerator=4, denominator=None, value=4)
        assert edit(client_for(users["reviewer"]), entry, "numerator", "9").status_code == 200
        entry.refresh_from_db()
        assert entry.value == Decimal("9")

    def test_a_note_is_edited_and_a_long_one_is_cut_in_the_log_only(self, users, client_for, filled_entry):
        entry = filled_entry("submitted")
        note = "n" * 300
        assert edit(client_for(users["reviewer"]), entry, "note", note).status_code == 200
        entry.refresh_from_db()
        assert entry.note == note
        assert len(EntryAuditLog.objects.get().new_value) == 100

    @pytest.mark.parametrize("bad", ["abc", "NaN", "1e99", True])
    def test_a_bad_number_is_a_400(self, bad, users, client_for, filled_entry):
        entry = filled_entry("submitted")
        resp = edit(client_for(users["reviewer"]), entry, "numerator", bad)
        assert resp.status_code == 400 and resp.json()["code"] == "invalid_number"
        entry.refresh_from_db()
        assert entry.numerator == Decimal("5")

    def test_a_number_that_would_overflow_the_value_is_a_400(self, users, client_for, filled_entry):
        entry = filled_entry("submitted")  # denominator 100
        resp = edit(client_for(users["reviewer"]), entry, "numerator", "9000000")  # 9,000,000 / 100 * 100
        assert resp.status_code == 400 and resp.json()["code"] == "value_out_of_range"
        entry.refresh_from_db()
        assert entry.numerator == Decimal("5")

    @pytest.mark.parametrize("field", ["numerator", "value"])
    def test_the_numerator_of_ha10_01_at_hsinchu_is_the_sum_of_its_sub_categories(
        self, field, users, client_for, filled_entry
    ):
        entry = filled_entry("approved", code="HA10-01", campus="hsinchu", numerator=91, denominator=None, value=91)
        resp = edit(client_for(users["reviewer"]), entry, field, "5")
        assert resp.status_code == 400
        body = resp.json()
        assert body["code"] == "field_not_editable"
        assert "子項" in body["detail"]  # says where to go instead
        entry.refresh_from_db()
        assert (entry.numerator, entry.value) == (Decimal("91"), Decimal("91"))
        assert EntryAuditLog.objects.count() == 0

    def test_its_note_can_still_be_edited(self, users, client_for, filled_entry):
        entry = filled_entry("approved", code="HA10-01", campus="hsinchu", numerator=91, denominator=None, value=91)
        assert edit(client_for(users["reviewer"]), entry, "note", "checked against the incident log").status_code == 200
        entry.refresh_from_db()
        assert entry.note == "checked against the incident log" and entry.numerator == Decimal("91")

    def test_the_same_indicator_elsewhere_and_other_hsinchu_indicators_are_editable(
        self, users, client_for, filled_entry
    ):
        client = client_for(users["reviewer"])
        elsewhere = filled_entry("approved", code="HA10-01", campus="zhubei", numerator=12, denominator=None, value=12)
        assert edit(client, elsewhere, "numerator", "13").status_code == 200
        assert edit(client, elsewhere, "value", "14").status_code == 200  # a count: the value is the numerator
        elsewhere.refresh_from_db()
        assert (elsewhere.numerator, elsewhere.value) == (Decimal("14"), Decimal("14"))

        percent = filled_entry("submitted", code="HA10-04", campus="hsinchu", numerator=8, denominator=10, value=80)
        assert edit(client, percent, "numerator", "9").status_code == 200
        percent.refresh_from_db()
        assert (percent.numerator, percent.value) == (Decimal("9"), Decimal("90"))

    def test_other_columns_and_unknown_entries_are_refused(self, users, client_for, filled_entry):
        entry = filled_entry("submitted")
        client = client_for(users["reviewer"])
        for field in ("raw_numerator", "filled_by", "numerator_filled_by", "report"):
            resp = edit(client, entry, field, "1")
            assert resp.status_code == 400 and resp.json()["code"] == "field_not_editable", field
        missing = type("E", (), {"id": 999999})()
        assert edit(client, missing, "numerator", "1").json()["code"] == "entry_not_found"
        resp = client.patch("/api/review/edit-entry", data=json.dumps({"entry_id": "x", "field": "numerator"}),
                            content_type="application/json")
        assert resp.status_code == 400 and resp.json()["code"] == "entry_not_found"

    def test_a_reviewer_is_not_limited_by_assignments(self, users, client_for, filled_entry):
        entry = filled_entry("approved")
        # nobody holds any assignment at all, and a reviewer may still correct either field
        assert edit(client_for(users["reviewer"]), entry, "numerator", "7").status_code == 200
        assert edit(client_for(users["admin"]), entry, "denominator", "70").status_code == 200

    def test_reporters_and_viewers_cannot_use_it(self, users, client_for, filled_entry):
        entry = filled_entry("submitted")
        for name in ("alice", "viewer"):
            assert edit(client_for(users[name]), entry, "numerator", "6").status_code == 403

    def test_the_reporter_cannot_touch_the_report_after_the_reviewers_edit(self, users, api_for, client_for,
                                                                            filled_entry, assign):
        assign(users["alice"], "HA01-01", field="numerator")
        entry = filled_entry("submitted")
        edit(client_for(users["reviewer"]), entry, "numerator", "6")
        resp = api_for(users["alice"]).save("HA01", [{"indicator_code": "HA01-01", "numerator": 1}])
        assert resp.status_code == 403
        entry.refresh_from_db()
        assert entry.numerator == Decimal("6")


class TestReviewDetail:
    def test_each_field_says_who_filled_it(self, users, client_for, filled_entry):
        entry = filled_entry("submitted")
        resp = client_for(users["reviewer"]).get(
            "/api/review/detail", {"campus": "zhubei", "year": YEAR, "month": MONTH, "category": "HA01"}
        )
        assert resp.status_code == 200
        row = resp.json()["indicators"][0]
        assert row["entry_id"] == entry.id
        assert (row["numerator_filled_by"], row["denominator_filled_by"]) == ("Name-alice", "Name-bob")
        assert row["numerator_filled_at"] is not None and row["denominator_filled_at"] is not None
        assert row["filled_by"] == "Name-bob"  # the entry level keeps meaning "last modifier"
        assert {"numerator", "denominator", "value", "note", "data_source", "audit_logs"} <= set(row)

    def test_fields_nobody_filled_are_null(self, users, client_for, make_report, entry_for):
        entry_for(make_report("zhubei", "HA01", "submitted"), "HA01-01", 5, None, None)
        row = client_for(users["reviewer"]).get(
            "/api/review/detail", {"campus": "zhubei", "year": YEAR, "month": MONTH, "category": "HA01"}
        ).json()["indicators"][0]
        assert (row["numerator_filled_by"], row["numerator_filled_at"]) == (None, None)
        assert (row["denominator_filled_by"], row["denominator_filled_at"]) == (None, None)


class TestUnlock:
    def unlock(self, users, client_for, **overrides):
        payload = {"campus": "zhubei", "year": YEAR, "month": MONTH, "reason": "late correction"}
        payload.update(overrides)
        return post(client_for(users["admin"]), "/api/review/unlock", payload)

    def test_unlock_reports_how_many_reports_it_unlocked(self, users, client_for, make_report):
        finalized = [make_report("zhubei", cat, "finalized") for cat in ("HA01", "HA02", "HA03")]
        make_report("zhubei", "HA06", "approved")  # not finalized: left alone
        make_report("zhudong", "HA01", "finalized")  # another campus: left alone
        resp = self.unlock(users, client_for)
        assert resp.status_code == 200
        assert resp.json() == {"ok": True, "unlocked_count": 3}
        for report in finalized:
            report.refresh_from_db()
            assert report.status == "approved" and report.finalized_at is None and report.finalized_by is None
        assert MonthlyReport.objects.get(campus__code="zhudong").status == "finalized"

    def test_nothing_to_unlock_is_a_400(self, users, client_for, make_report):
        make_report("zhubei", "HA01", "approved")
        resp = self.unlock(users, client_for)
        assert resp.status_code == 400
        assert resp.json()["detail"] == "找不到已送出的報表"

    def test_only_admins_unlock(self, users, client_for, make_report):
        make_report("zhubei", "HA01", "finalized")
        resp = post(client_for(users["reviewer"]), "/api/review/unlock",
                    {"campus": "zhubei", "year": YEAR, "month": MONTH})
        assert resp.status_code == 403
        assert MonthlyReport.objects.get().status == "finalized"


# ── Case lists ───────────────────────────────────────────────────

@pytest.fixture
def case_world(users, assign, make_report, entry_for, indicators):
    """A case-list indicator HA03-01 with 3 numerator and 2 denominator cases; alice owns its numerator."""
    Indicator.objects.create(code="HA03-02", name="another case-list indicator", category="手術照護",
                             unit="percent", direction="lower", campuses=["竹北"], entry_mode="case_list")
    ExclusionReason.objects.create(code="DUPLICATE", name="重複個案")
    assign(users["alice"], "HA03-01", field="numerator")
    assign(users["bob"], "HA03-01", field="denominator")
    assign(users["carol"], "HA03-02", field="both")

    report = make_report("zhubei", "HA03", "draft")
    entry = entry_for(report, "HA03-01", 3, 20, 15, raw_numerator=3)
    other = entry_for(report, "HA03-02", 3, 20, 15, raw_numerator=3)

    def cases(target, role, n):
        return [CaseRecord.objects.create(entry=target, case_role=role, his_raw_data={"chart_no": f"{role}{i}"})
                for i in range(n)]

    return {
        "report": report, "entry": entry, "other": other,
        "numerator_cases": cases(entry, "numerator", 3), "denominator_cases": cases(entry, "denominator", 2),
        "other_cases": cases(other, "numerator", 2),
    }


def exclude(client, cases, reason="DUPLICATE", note=""):
    payload = {"case_record_ids": [c.id for c in cases], "exclusion_reason_code": reason, "exclusion_note": note}
    return post(client, "/api/case-list/exclude", payload)


def restore(client, cases):
    return post(client, "/api/case-list/restore", {"case_record_ids": [c.id for c in cases]})


class TestCaseListWrites:
    def test_the_numerator_owner_can_exclude_and_the_numerator_follows(self, users, client_for, case_world):
        entry, cases = case_world["entry"], case_world["numerator_cases"]
        resp = exclude(client_for(users["alice"]), cases[:2])
        assert resp.status_code == 200 and resp.json() == {"ok": True, "updated": 2}
        entry.refresh_from_db()
        assert (entry.raw_numerator, entry.exclusion_count, entry.numerator) == (3, 2, Decimal("1"))
        assert entry.value == Decimal("5")  # 1 / 20 * 100
        assert entry.numerator_filled_by == users["alice"] and entry.numerator_filled_at is not None
        assert entry.denominator_filled_by is None  # not touched
        assert CaseRecord.objects.filter(is_excluded=True, excluded_by=users["alice"]).count() == 2

    def test_restore_recounts_the_numerator(self, users, client_for, case_world):
        client = client_for(users["alice"])
        exclude(client, case_world["numerator_cases"])
        case_world["entry"].refresh_from_db()
        assert case_world["entry"].numerator == Decimal("0")
        resp = restore(client, case_world["numerator_cases"][:2])
        assert resp.status_code == 200
        case_world["entry"].refresh_from_db()
        assert case_world["entry"].numerator == Decimal("2") and case_world["entry"].value == Decimal("10")

    def test_somebody_without_the_numerator_of_that_indicator_is_refused(self, users, client_for, case_world):
        for name in ("bob", "carol", "admin"):  # bob owns only the denominator; carol another indicator; admin none
            resp = exclude(client_for(users[name]), case_world["numerator_cases"][:1])
            assert resp.status_code == 403, name
            assert resp.json()["code"] == "not_assigned", name
            assert restore(client_for(users[name]), case_world["numerator_cases"][:1]).status_code == 403
        assert CaseRecord.objects.filter(is_excluded=True).count() == 0
        case_world["entry"].refresh_from_db()
        assert case_world["entry"].numerator == Decimal("3")

    def test_one_foreign_id_refuses_the_whole_request(self, users, client_for, case_world):
        ids = case_world["numerator_cases"][:2] + case_world["other_cases"][:1]
        resp = exclude(client_for(users["alice"]), ids)
        assert resp.status_code == 403 and resp.json()["code"] == "not_assigned"
        assert CaseRecord.objects.filter(is_excluded=True).count() == 0

    def test_an_unknown_id_is_refused(self, users, client_for, case_world):
        payload = {"case_record_ids": [case_world["numerator_cases"][0].id, 999999],
                   "exclusion_reason_code": "DUPLICATE"}
        resp = post(client_for(users["alice"]), "/api/case-list/exclude", payload)
        assert resp.status_code == 403
        assert CaseRecord.objects.filter(is_excluded=True).count() == 0

    @pytest.mark.parametrize("state", ["submitted", "approved", "finalized"])
    def test_a_closed_report_cannot_be_changed(self, state, users, client_for, case_world):
        MonthlyReport.objects.filter(pk=case_world["report"].pk).update(status=state)
        client = client_for(users["alice"])
        resp = exclude(client, case_world["numerator_cases"][:1])
        assert resp.status_code == 403 and resp.json()["code"] == "report_locked"
        assert restore(client, case_world["numerator_cases"][:1]).status_code == 403
        assert CaseRecord.objects.filter(is_excluded=True).count() == 0

    def test_the_lock_does_not_leak_to_somebody_not_assigned(self, users, client_for, case_world):
        MonthlyReport.objects.filter(pk=case_world["report"].pk).update(status="approved")
        resp = exclude(client_for(users["carol"]), case_world["numerator_cases"][:1])
        assert resp.status_code == 403 and resp.json()["code"] == "not_assigned"

    def test_excluding_a_denominator_case_leaves_the_numerator_and_its_author(self, users, client_for, case_world):
        resp = exclude(client_for(users["alice"]), case_world["denominator_cases"][:1])
        assert resp.status_code == 200
        entry = case_world["entry"]
        entry.refresh_from_db()
        assert entry.numerator == Decimal("3") and entry.numerator_filled_by is None

    def test_ids_must_be_a_list_of_integers(self, users, client_for, case_world):
        client = client_for(users["alice"])
        cases = (([], "missing_params"), ("1,2", "invalid_ids"), (["a"], "invalid_ids"), ([True], "invalid_ids"),
                 ([1.5], "invalid_ids"))
        for ids, code in cases:
            resp = post(client, "/api/case-list/restore", {"case_record_ids": ids})
            assert resp.status_code == 400, ids
            assert resp.json()["code"] == code, ids

    def test_the_reason_checks_still_apply(self, users, client_for, case_world):
        client = client_for(users["alice"])
        cases = case_world["numerator_cases"][:1]
        assert exclude(client, cases, reason="NOPE").status_code == 400
        ExclusionReason.objects.create(code="OTHER", name="其他")
        assert exclude(client, cases, reason="OTHER", note=" ").status_code == 400
        assert exclude(client, cases, reason="OTHER", note="explained").status_code == 200

    def test_a_denominator_less_case_list_indicator_takes_the_count_as_its_value(self, users, client_for, case_world,
                                                                                assign):
        Indicator.objects.filter(code="HA03-01").update(has_denominator=False)
        resp = exclude(client_for(users["alice"]), case_world["numerator_cases"][:1])
        assert resp.status_code == 200
        entry = case_world["entry"]
        entry.refresh_from_db()
        assert (entry.numerator, entry.value) == (Decimal("2"), Decimal("2"))


def get_cases(client, indicator="HA03-01", campus="zhubei", year=YEAR, month=MONTH):
    return client.get("/api/case-list/", {"indicator": indicator, "campus": campus, "year": year, "month": month})


class TestCaseListReads:
    """
    Reviewers and admins read every case list. A reporter reads the ones of indicators assigned to them (any
    field) at that campus in that month, and then gets the chart numbers in full (§5A.6: the reporter in charge
    and the quality centre see them). Everybody else is refused before anything is looked up.
    """

    CHARTS = ["denominator0", "denominator1", "numerator0", "numerator1", "numerator2"]

    def charts(self, resp):
        return sorted(r["his_raw_data"]["chart_no"] for r in resp.json()["records"])

    @pytest.fixture
    def outsider(self, make_user, campuses):
        """A reporter whose account says zhubei, with no assignment at all."""
        return make_user("outsider", ["reporter"], campus=campuses["zhubei"])

    @pytest.mark.parametrize("who", ["alice", "bob"])  # the numerator owner and the denominator owner
    def test_a_reporter_with_an_assignment_reads_it(self, who, users, client_for, case_world):
        resp = get_cases(client_for(users[who]))
        assert resp.status_code == 200
        body = resp.json()
        assert body["entry_id"] == case_world["entry"].id
        assert body["summary"] == {"denominator_total": 5, "raw_numerator": 3, "excluded": 0, "final_numerator": 3}
        assert self.charts(resp) == self.CHARTS  # the reporter in charge sees the numbers in full

    def test_a_reporter_without_an_assignment_is_refused_whatever_the_account_says(
        self, outsider, client_for, case_world
    ):
        resp = get_cases(client_for(outsider))
        assert resp.status_code == 403
        assert resp.json() == {"detail": "你沒有這個指標在該院區的指派，無法查看個案清單", "code": "not_assigned"}
        assert b"numerator0" not in resp.content

    def test_the_account_campus_decides_nothing(self, users, campuses, client_for, case_world):
        users["alice"].campus = campuses["hsinchu"]  # assigned at zhubei, works at Hsinchu according to the account
        users["alice"].save()
        assert get_cases(client_for(users["alice"])).status_code == 200

    def test_only_the_indicator_campus_and_month_of_the_assignment_open_it(
        self, users, make_user, assign, client_for, case_world
    ):
        d = datetime.date
        assign(users["carol"], "HA03-02", "zhubei")  # another indicator, same campus
        elsewhere = make_user("elsewhere", ["reporter"])
        assign(elsewhere, "HA03-01", "zhudong")  # same indicator, another campus
        ended = make_user("ended", ["reporter"])
        assign(ended, "HA03-01", "zhubei", effective_to=d(2026, 2, 28))  # over before March
        future = make_user("future", ["reporter"])
        assign(future, "HA03-01", "zhubei", effective_from=d(2026, 4, 1))  # starts after March
        for who in (users["carol"], elsewhere, ended, future):
            resp = get_cases(client_for(who))
            assert resp.status_code == 403, who
            assert resp.json()["code"] == "not_assigned"

        assert get_cases(client_for(users["carol"]), indicator="HA03-02").status_code == 200  # her own one
        one_month = make_user("one_month", ["reporter"])
        assign(one_month, "HA03-01", "zhubei", effective_from=d(2026, 3, 1), effective_to=d(2026, 3, 31))
        assert get_cases(client_for(one_month)).status_code == 200
        assert get_cases(client_for(one_month), month=4).status_code == 403  # April is not covered

    @pytest.mark.parametrize("who", ["reviewer", "admin"])
    def test_reviewers_and_admins_read_any_case_list(self, who, users, client_for, case_world):
        resp = get_cases(client_for(users[who]))  # no assignments at all
        assert resp.status_code == 200
        assert self.charts(resp) == self.CHARTS

    def test_a_refused_reporter_learns_nothing_about_what_exists(self, outsider, users, client_for, case_world):
        mine = client_for(outsider)
        for kwargs in ({}, {"campus": "nowhere"}, {"campus": "zhudong"}, {"indicator": "HA03-99"}):
            resp = get_cases(mine, **kwargs)
            assert resp.status_code == 403, kwargs  # the same answer whether or not it exists
            assert resp.json()["code"] == "not_assigned"
        theirs = client_for(users["reviewer"])  # who is allowed hears the truth
        assert get_cases(theirs, campus="nowhere").status_code == 404
        assert get_cases(theirs, indicator="HA03-99").status_code == 404
        assert get_cases(theirs, campus="zhudong").status_code == 404

    def test_bad_parameters_are_a_400_for_everybody(self, users, client_for, case_world):
        for name in ("alice", "reviewer"):
            client = client_for(users[name])
            assert get_cases(client, month="").status_code == 400  # missing
            for year, month in ((YEAR, 13), (YEAR, -1), ("abc", MONTH), (1000000, MONTH), (YEAR, "x")):
                resp = get_cases(client, year=year, month=month)
                assert resp.status_code == 400, (year, month)
                assert resp.json()["code"] == "invalid_period"

    def test_viewers_still_have_no_access(self, users, client_for, case_world):
        resp = get_cases(client_for(users["viewer"]))
        assert resp.status_code == 403 and resp.json()["code"] == "permission_denied"

    def test_the_list_of_exclusion_reasons_stays_open_to_every_reporter(self, outsider, client_for, case_world):
        resp = client_for(outsider).get("/api/case-list/exclusion-reasons")
        assert resp.status_code == 200
        assert [r["code"] for r in resp.json()] == ["DUPLICATE"]


class TestWhoSeesTheFullChartNumber:
    """The rule behind the masking: reviewers, admins and anybody assigned at the campus that month."""

    def test_the_rule(self, users, make_user, assign, campuses):
        d = datetime.date
        outsider = make_user("outsider", ["reporter"], campus=campuses["zhubei"])
        assign(users["alice"], "HA01-01", "zhubei")  # any indicator, any field, at that campus
        assign(users["bob"], "HA01-01", "zhubei", field="denominator")
        assign(users["carol"], "HA01-01", "zhubei", effective_to=d(2026, 2, 28))

        def sees(user, campus="zhubei"):
            return _sees_full_chart_no(user, campuses[campus], YEAR, MONTH)

        assert sees(users["reviewer"]) and sees(users["admin"])
        assert sees(users["alice"]) and sees(users["bob"])
        assert not sees(users["alice"], "zhudong")  # assigned elsewhere
        assert not sees(outsider)  # the account's own campus counts for nothing
        assert not sees(users["carol"])  # the assignment is over

    def test_the_masking(self):
        assert _mask_chart_no("A123456789", False) == "A********9"
        assert _mask_chart_no("A123456789", True) == "A123456789"
        assert _mask_chart_no("AB", False) == "AB"  # too short to hide anything


# ── Excel import ─────────────────────────────────────────────────

class TestImport:
    def batch(self, users, campuses):
        return ImportBatch.objects.create(
            source_type="excel", source_name="march.xlsx", campus=campuses["zhubei"], year=YEAR, month=MONTH,
            status="preview", imported_by=users["reviewer"],
        )

    def test_the_importer_is_who_filled_the_numbers_that_came_in(self, users, campuses):
        batch = self.batch(users, campuses)
        points = [
            IndicatorDataPoint("HA01-01", "zhubei", YEAR, MONTH, Decimal("5"), Decimal("200")),
            IndicatorDataPoint("HA06-31", "zhubei", YEAR, MONTH, Decimal("4"), None),
            IndicatorDataPoint("HA02-11", "zhubei", YEAR, MONTH, Decimal("3"), Decimal("2000")),
        ]
        write_preview_entries(batch, points, users["reviewer"])
        entries = {e.indicator_code: e for e in IndicatorEntry.objects.all()}

        ratio = entries["HA01-01"]
        assert (ratio.numerator, ratio.denominator, ratio.value) == (Decimal("5"), Decimal("200"), Decimal("2.5"))
        assert ratio.numerator_filled_by == users["reviewer"] == ratio.denominator_filled_by
        assert ratio.numerator_filled_at is not None and ratio.denominator_filled_at is not None
        assert ratio.filled_by == users["reviewer"] and ratio.data_source == "excel" and ratio.import_batch == batch

        count = entries["HA06-31"]
        assert (count.numerator, count.denominator, count.value) == (Decimal("4"), None, Decimal("4"))
        assert count.numerator_filled_by == users["reviewer"]
        assert count.denominator_filled_by is None and count.denominator_filled_at is None  # nothing came in

        assert entries["HA02-11"].value == Decimal("1.5")  # permille

    def test_a_zero_denominator_leaves_no_value(self, users, campuses):
        write_preview_entries(
            self.batch(users, campuses),
            [IndicatorDataPoint("HA01-01", "zhubei", YEAR, MONTH, Decimal("5"), Decimal("0"))],
            users["reviewer"],
        )
        entry = IndicatorEntry.objects.get()
        assert (entry.denominator, entry.value) == (Decimal("0"), None)
        assert entry.denominator_filled_by == users["reviewer"]  # zero is a number that came in
