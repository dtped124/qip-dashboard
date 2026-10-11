"""
Assignment API (Phase 5): the ``field`` column and the validation behind POST / PATCH.

  TestCreate        field defaults to "both", every choice is accepted, junk is not
  TestOverlap       one user cannot hold two current assignments that cover the same field
  TestAssignee      the assignee is an active reporter (an admin will do)
  TestDates         effective_from <= effective_to
  TestIndicator     the indicator exists; no denominator-only assignment for a count indicator
  TestPatch         a partial update is validated as the whole row it will become
  TestListFilter    GET ?field= (and the older filters)
  TestIndicatorApi  the indicator list / detail now say has_denominator and entry_mode
"""
from __future__ import annotations

import datetime
import json

import pytest

from apps.entry.models import IndicatorAssignment

pytestmark = pytest.mark.django_db

URL = "/api/admin/assignments"


@pytest.fixture(autouse=True)
def _world(world):
    return world


@pytest.fixture
def admin_client(users, client_for):
    return client_for(users["admin"])


@pytest.fixture
def body(campuses):
    """body(user, "HA01-01", field="numerator", campus="zhubei", **more) -> POST payload."""

    def _body(user, code="HA01-01", *, campus="zhubei", **more):
        payload = {
            "indicator_code": code,
            "campus": campuses[campus].id,
            "user": user.id,
            "role": "primary",
            "effective_from": "2026-01-01",
        }
        payload.update(more)
        return payload

    return _body


def post(client, payload):
    return client.post(URL, data=json.dumps(payload), content_type="application/json")


def patch(client, pk, payload):
    return client.patch(f"{URL}/{pk}", data=json.dumps(payload), content_type="application/json")


class TestCreate:
    def test_field_defaults_to_both_and_is_part_of_the_response(self, users, admin_client, body):
        resp = post(admin_client, body(users["alice"]))
        assert resp.status_code == 201, resp.content
        data = resp.json()
        assert data["field"] == "both"
        assert {"id", "indicator_code", "campus", "campus_name", "user", "user_name", "user_employee_id", "role",
                "field", "effective_from", "effective_to", "created_by", "created_at"} <= set(data)
        assert data["created_by"] == users["admin"].id
        assert IndicatorAssignment.objects.get(pk=data["id"]).field == "both"

    @pytest.mark.parametrize("field", ["both", "numerator", "denominator"])
    def test_every_field_choice_is_accepted(self, field, users, admin_client, body):
        resp = post(admin_client, body(users["alice"], field=field))
        assert resp.status_code == 201, resp.content
        assert resp.json()["field"] == field

    @pytest.mark.parametrize("junk", ["", "all", "Numerator", None, 3])
    def test_anything_else_is_refused(self, junk, users, admin_client, body):
        resp = post(admin_client, body(users["alice"], field=junk))
        assert resp.status_code == 400
        assert "field" in resp.json()

    def test_one_indicator_can_be_split_between_two_people(self, users, admin_client, body):
        assert post(admin_client, body(users["alice"], field="numerator")).status_code == 201
        assert post(admin_client, body(users["bob"], field="denominator")).status_code == 201

    def test_two_people_may_share_a_field(self, users, admin_client, body):
        """Primary and deputy: different users never collide."""
        assert post(admin_client, body(users["alice"], field="numerator")).status_code == 201
        assert post(admin_client, body(users["bob"], field="numerator", role="deputy")).status_code == 201
        assert post(admin_client, body(users["carol"], field="both", role="deputy")).status_code == 201

    def test_required_fields_are_still_required(self, admin_client):
        resp = post(admin_client, {})
        assert resp.status_code == 400
        assert {"indicator_code", "campus", "user", "effective_from"} <= set(resp.json())


class TestOverlap:
    def test_the_same_field_twice_is_refused(self, users, admin_client, body):
        assert post(admin_client, body(users["alice"], field="numerator")).status_code == 201
        resp = post(admin_client, body(users["alice"], field="numerator"))
        assert resp.status_code == 400
        assert "non_field_errors" in resp.json()
        assert IndicatorAssignment.objects.count() == 1

    def test_both_overlaps_with_any_current_assignment(self, users, admin_client, body):
        assert post(admin_client, body(users["alice"], field="denominator")).status_code == 201
        assert post(admin_client, body(users["alice"], field="both")).status_code == 400
        assert post(admin_client, body(users["bob"], field="both")).status_code == 201  # another person: fine

    def test_anything_overlaps_with_a_current_both(self, users, admin_client, body):
        assert post(admin_client, body(users["alice"], field="both")).status_code == 201
        for field in ("both", "numerator", "denominator"):
            assert post(admin_client, body(users["alice"], field=field)).status_code == 400

    def test_the_two_halves_do_not_overlap(self, users, admin_client, body):
        assert post(admin_client, body(users["alice"], field="numerator")).status_code == 201
        assert post(admin_client, body(users["alice"], field="denominator")).status_code == 201
        assert IndicatorAssignment.objects.count() == 2

    def test_another_campus_or_indicator_is_a_different_assignment(self, users, admin_client, body):
        assert post(admin_client, body(users["alice"], "HA01-01", campus="zhubei")).status_code == 201
        assert post(admin_client, body(users["alice"], "HA01-01", campus="zhudong")).status_code == 201
        assert post(admin_client, body(users["alice"], "HA01-02", campus="zhubei")).status_code == 201

    def test_a_finished_assignment_does_not_block_a_new_one(self, users, admin_client, body):
        old = post(admin_client, body(users["alice"], field="both", effective_to="2026-02-28"))
        assert old.status_code == 201
        successor = body(users["alice"], field="numerator", effective_from="2026-03-01")
        assert post(admin_client, successor).status_code == 201

    def test_handing_over_by_closing_the_old_row_first(self, users, admin_client, body):
        first = post(admin_client, body(users["alice"], field="both")).json()
        assert post(admin_client, body(users["alice"], field="numerator")).status_code == 400
        assert patch(admin_client, first["id"], {"effective_to": "2026-02-28"}).status_code == 200
        successor = body(users["alice"], field="numerator", effective_from="2026-03-01")
        assert post(admin_client, successor).status_code == 201

    def test_closing_a_duplicate_is_always_possible(self, users, admin_client, campuses):
        """Duplicates created before the rule existed must be fixable by ending one of them."""
        rows = [
            IndicatorAssignment.objects.create(
                indicator_code="HA01-01", campus=campuses["zhubei"], user=users["alice"],
                effective_from=datetime.date(2026, 1, 1),
            )
            for _ in range(2)
        ]
        assert patch(admin_client, rows[0].id, {"effective_to": "2026-03-31"}).status_code == 200


class TestAssignee:
    def test_a_reporter_is_fine(self, users, admin_client, body):
        assert post(admin_client, body(users["alice"])).status_code == 201

    def test_an_admin_is_fine(self, users, admin_client, body):
        assert post(admin_client, body(users["admin"])).status_code == 201

    def test_a_superuser_counts_as_an_admin(self, make_user, admin_client, body):
        boss = make_user("boss", [], is_superuser=True)
        assert post(admin_client, body(boss)).status_code == 201

    def test_other_roles_alone_are_not_enough(self, users, make_user, admin_client, body):
        for who in (users["viewer"], users["reviewer"], make_user("nobody", [])):
            resp = post(admin_client, body(who))
            assert resp.status_code == 400, who
            assert "user" in resp.json()
        assert IndicatorAssignment.objects.count() == 0

    def test_a_reporter_who_is_also_something_else_is_fine(self, make_user, admin_client, body):
        both = make_user("both", ["reporter", "reviewer"])
        assert post(admin_client, body(both)).status_code == 201

    def test_a_deactivated_account_is_refused(self, make_user, admin_client, body):
        gone = make_user("gone", ["reporter"], is_active=False)
        resp = post(admin_client, body(gone))
        assert resp.status_code == 400 and "user" in resp.json()

    def test_a_missing_user_is_refused(self, admin_client, body, users):
        payload = body(users["alice"])
        payload["user"] = 999999
        assert post(admin_client, payload).status_code == 400


class TestDates:
    def test_from_after_to_is_refused(self, users, admin_client, body):
        resp = post(admin_client, body(users["alice"], effective_from="2026-04-01", effective_to="2026-03-31"))
        assert resp.status_code == 400
        assert "effective_to" in resp.json()

    def test_a_single_day_is_fine(self, users, admin_client, body):
        resp = post(admin_client, body(users["alice"], effective_from="2026-03-01", effective_to="2026-03-01"))
        assert resp.status_code == 201

    def test_open_ended_is_fine(self, users, admin_client, body):
        resp = post(admin_client, body(users["alice"], effective_to=None))
        assert resp.status_code == 201 and resp.json()["effective_to"] is None


class TestIndicator:
    def test_an_unknown_indicator_is_refused(self, users, admin_client, body):
        resp = post(admin_client, body(users["alice"], "HA99-99"))
        assert resp.status_code == 400
        assert "indicator_code" in resp.json()

    def test_no_denominator_only_assignment_for_a_count_indicator(self, users, admin_client, body):
        resp = post(admin_client, body(users["alice"], "HA06-31", field="denominator"))
        assert resp.status_code == 400
        assert "field" in resp.json()
        assert IndicatorAssignment.objects.count() == 0

    @pytest.mark.parametrize("field", ["numerator", "both"])
    def test_numerator_and_both_are_fine_for_a_count_indicator(self, field, users, admin_client, body):
        assert post(admin_client, body(users["alice"], "HA06-31", field=field)).status_code == 201

    def test_a_denominator_is_fine_where_there_is_one(self, users, admin_client, body):
        assert post(admin_client, body(users["alice"], "HA01-01", field="denominator")).status_code == 201


class TestPatch:
    @pytest.fixture
    def row(self, users, admin_client, body):
        return post(admin_client, body(users["alice"], "HA01-01", field="numerator")).json()

    def test_the_response_carries_the_field(self, row, admin_client):
        resp = patch(admin_client, row["id"], {"role": "deputy"})
        assert resp.status_code == 200
        assert resp.json()["field"] == "numerator" and resp.json()["role"] == "deputy"

    def test_changing_the_field_works(self, row, admin_client):
        resp = patch(admin_client, row["id"], {"field": "denominator"})
        assert resp.status_code == 200 and resp.json()["field"] == "denominator"
        assert IndicatorAssignment.objects.get(pk=row["id"]).field == "denominator"

    def test_patch_into_a_collision_is_refused(self, users, row, admin_client, body):
        other = post(admin_client, body(users["alice"], "HA01-01", field="denominator")).json()
        for field in ("numerator", "both"):
            resp = patch(admin_client, other["id"], {"field": field})
            assert resp.status_code == 400, field
        assert IndicatorAssignment.objects.get(pk=other["id"]).field == "denominator"

    def test_patch_the_user_into_a_collision_is_refused(self, users, row, admin_client, body):
        bobs = post(admin_client, body(users["bob"], "HA01-01", field="numerator")).json()
        assert patch(admin_client, bobs["id"], {"user": users["alice"].id}).status_code == 400

    def test_patch_the_indicator_into_a_denominator_less_one_is_refused(self, users, admin_client, body):
        other = post(admin_client, body(users["alice"], "HA01-01", field="denominator")).json()
        resp = patch(admin_client, other["id"], {"indicator_code": "HA06-31"})
        assert resp.status_code == 400 and "field" in resp.json()

    def test_patch_the_field_alone_on_a_denominator_less_indicator_is_refused(self, users, admin_client, body):
        count = post(admin_client, body(users["alice"], "HA06-31", field="numerator")).json()
        resp = patch(admin_client, count["id"], {"field": "denominator"})
        assert resp.status_code == 400 and "field" in resp.json()
        assert IndicatorAssignment.objects.get(pk=count["id"]).field == "numerator"

    def test_patch_to_an_unknown_indicator_is_refused(self, row, admin_client):
        assert patch(admin_client, row["id"], {"indicator_code": "HA99-99"}).status_code == 400

    def test_patch_the_user_to_a_non_reporter_is_refused(self, users, row, admin_client):
        resp = patch(admin_client, row["id"], {"user": users["viewer"].id})
        assert resp.status_code == 400 and "user" in resp.json()
        assert IndicatorAssignment.objects.get(pk=row["id"]).user_id == users["alice"].id

    def test_patch_the_dates_is_checked_against_the_stored_ones(self, row, admin_client):
        resp = patch(admin_client, row["id"], {"effective_to": "2025-12-31"})  # stored from: 2026-01-01
        assert resp.status_code == 400 and "effective_to" in resp.json()
        resp = patch(admin_client, row["id"], {"effective_to": "2026-06-30"})
        assert resp.status_code == 200
        resp = patch(admin_client, row["id"], {"effective_from": "2026-07-01"})  # stored to: 2026-06-30
        assert resp.status_code == 400 and "effective_to" in resp.json()

    def test_ending_an_assignment_of_a_deactivated_account_stays_possible(self, users, row, admin_client):
        users["alice"].is_active = False
        users["alice"].save()
        assert patch(admin_client, row["id"], {"effective_to": "2026-03-31"}).status_code == 200

    def test_reopening_it_for_a_deactivated_account_is_refused(self, users, row, admin_client):
        patch(admin_client, row["id"], {"effective_to": "2026-03-31"})
        users["alice"].is_active = False
        users["alice"].save()
        resp = patch(admin_client, row["id"], {"effective_to": None})
        assert resp.status_code == 400 and "user" in resp.json()

    def test_an_unknown_assignment_is_a_404(self, admin_client):
        assert patch(admin_client, 999999, {"role": "deputy"}).status_code == 404

    def test_delete_still_removes_the_row(self, row, admin_client):
        assert admin_client.delete(f"{URL}/{row['id']}").status_code == 204
        assert IndicatorAssignment.objects.count() == 0

    def test_only_admins_may_change_assignments(self, users, row, client_for, body):
        for name in ("alice", "reviewer", "viewer"):
            client = client_for(users[name])
            assert patch(client, row["id"], {"role": "deputy"}).status_code == 403
            assert post(client, body(users["bob"])).status_code == 403


class TestListFilter:
    @pytest.fixture
    def rows(self, users, admin_client, body):
        made = {
            "n": post(admin_client, body(users["alice"], "HA01-01", field="numerator")).json(),
            "d": post(admin_client, body(users["bob"], "HA01-01", field="denominator")).json(),
            "b": post(admin_client, body(users["carol"], "HA01-02", field="both")).json(),
            "z": post(admin_client, body(users["carol"], "HA01-02", field="both", campus="zhudong")).json(),
        }
        post(admin_client, body(users["alice"], "HA01-02", field="both", effective_to="2026-02-28"))  # ended
        return made

    def ids(self, client, query=""):
        resp = client.get(f"{URL}{query}")
        assert resp.status_code == 200, resp.content
        return {row["id"] for row in resp.json()}

    def test_without_a_filter_every_current_row_is_listed(self, rows, admin_client):
        assert self.ids(admin_client) == {r["id"] for r in rows.values()}

    @pytest.mark.parametrize("field, expected", [("numerator", {"n"}), ("denominator", {"d"}), ("both", {"b", "z"})])
    def test_field_filter(self, field, expected, rows, admin_client):
        assert self.ids(admin_client, f"?field={field}") == {rows[k]["id"] for k in expected}

    def test_filters_combine(self, rows, admin_client):
        assert self.ids(admin_client, "?field=both&campus=zhubei") == {rows["b"]["id"]}
        assert self.ids(admin_client, "?indicator=HA01-01&field=denominator") == {rows["d"]["id"]}
        assert self.ids(admin_client, "?campus=zhudong") == {rows["z"]["id"]}
        assert self.ids(admin_client, "?indicator=HA01-01") == {rows["n"]["id"], rows["d"]["id"]}

    def test_an_unknown_field_value_is_a_400(self, rows, admin_client):
        resp = admin_client.get(f"{URL}?field=everything")
        assert resp.status_code == 400
        assert resp.json()["code"] == "invalid_field"

    def test_the_list_carries_the_field(self, rows, admin_client):
        by_id = {row["id"]: row for row in admin_client.get(URL).json()}
        assert by_id[rows["n"]["id"]]["field"] == "numerator"


class TestIndicatorApi:
    def test_list_and_detail_expose_has_denominator_and_entry_mode(self, users, client_for):
        client = client_for(users["viewer"])
        listed = {row["code"]: row for row in client.get("/api/v1/indicators/").json()["data"]}
        assert listed["HA01-01"]["has_denominator"] is True and listed["HA01-01"]["entry_mode"] == "manual"
        assert listed["HA06-31"]["has_denominator"] is False
        assert listed["HA03-01"]["entry_mode"] == "case_list"

        detail = client.get("/api/v1/indicators/HA06-31/").json()
        assert detail["has_denominator"] is False and detail["entry_mode"] == "manual"
        assert {"code", "name", "unit", "direction", "target_mode", "target_value"} <= set(detail)  # nothing removed

    def test_the_new_fields_cannot_be_written_through_patch(self, users, client_for, indicators):
        client = client_for(users["admin"])
        resp = client.patch(
            "/api/v1/indicators/HA01-01/", data=json.dumps({"has_denominator": False, "entry_mode": "case_list"}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        indicators["HA01-01"].refresh_from_db()
        assert indicators["HA01-01"].has_denominator is True and indicators["HA01-01"].entry_mode == "manual"
