"""uat_seed_testers: tester accounts, assignments, demo reset and scrub for the portable UAT package."""
from __future__ import annotations

import datetime
from io import StringIO

import pytest
from axes.models import AccessAttempt, AccessLog
from django.contrib.sessions.models import Session
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.accounts.models import User
from apps.entry.models import Campus, IndicatorAssignment
from apps.indicators.models import Indicator

HEADER = "employee_id,full_name,roles,campus,assignments\n"
PASSWORD_FILE_MARKER = "Personal tester accounts"


@pytest.fixture
def world(db):
    campuses = {
        "hsinchu": Campus.objects.create(code="hsinchu", name="新竹", benchmark_level="medical_center"),
        "zhubei": Campus.objects.create(code="zhubei", name="竹北", benchmark_level="regional"),
    }
    for code, has_den in (("HA01-01", True), ("HA01-02", True), ("HA03-01", True), ("HA03-02", True),
                          ("HA06-31", False)):
        Indicator.objects.create(
            code=code, name=code, category="x", unit="percent" if has_den else "count", direction="lower",
            campuses=["竹北", "新竹"], has_denominator=has_den, entry_mode="manual",
        )
    return campuses


def write_csv(tmp_path, body: str, *, bom: bool = True):
    path = tmp_path / "testers.csv"
    path.write_text(HEADER + body, encoding="utf-8-sig" if bom else "utf-8", newline="")
    return path


def run(tmp_path, *args, csv_path=None, out="passwords.md"):
    argv = list(args)
    if csv_path is not None:
        argv += ["--csv", str(csv_path)]
    if out:
        argv += ["--out", str(tmp_path / out)]
    stdout = StringIO()
    call_command("uat_seed_testers", *argv, stdout=stdout)
    return stdout.getvalue()


def test_csv_creates_accounts_and_assignments(world, tmp_path):
    path = write_csv(
        tmp_path,
        "T001,陳小美,reporter|viewer,zhubei,HA03-01:numerator|HA03-02:both\n"
        "T002,林大偉,reviewer,,\n",
    )
    output = run(tmp_path, csv_path=path)

    t1 = User.objects.get(employee_id="T001")
    assert t1.full_name == "陳小美"
    assert t1.roles == ["reporter", "viewer"]
    assert t1.campus.code == "zhubei"
    assert t1.is_active and t1.must_change_password and t1.has_usable_password()
    t2 = User.objects.get(employee_id="T002")
    assert t2.roles == ["reviewer"] and t2.campus is None

    rows = {(a.indicator_code, a.field): a for a in IndicatorAssignment.objects.filter(user=t1)}
    assert set(rows) == {("HA03-01", "numerator"), ("HA03-02", "both")}
    assert all(a.campus.code == "zhubei" and a.effective_to is None for a in rows.values())
    assert rows[("HA03-01", "numerator")].effective_from == datetime.date(2020, 1, 1)
    assert IndicatorAssignment.objects.filter(user=t2).count() == 0

    # stdout carries counts only: no account names and no password
    assert "2 accounts created" in output and "2 assignments created" in output
    report = (tmp_path / "passwords.md").read_text(encoding="utf-8")
    assert "T001" in report and "T002" in report and PASSWORD_FILE_MARKER in report
    assert "T001" not in output


def test_report_holds_the_working_password_and_stdout_does_not(world, tmp_path):
    path = write_csv(tmp_path, "T001,陳小美,reporter,zhubei,HA03-01\n")
    output = run(tmp_path, csv_path=path)
    report = (tmp_path / "passwords.md").read_text(encoding="utf-8")
    password = next(line for line in report.splitlines() if line.startswith("| T001")).split("`")[1]
    assert User.objects.get(employee_id="T001").check_password(password)
    assert password not in output


def test_accepts_csv_without_bom_and_blank_lines(world, tmp_path):
    path = write_csv(tmp_path, "\nT001,A,viewer,,\n\n", bom=False)
    run(tmp_path, csv_path=path)
    assert User.objects.filter(employee_id="T001").exists()


def test_second_run_is_idempotent(world, tmp_path):
    path = write_csv(tmp_path, "T001,陳小美,reporter,zhubei,HA03-01:numerator|HA03-02:both\n")
    run(tmp_path, csv_path=path)
    first_hash = User.objects.get(employee_id="T001").password
    output = run(tmp_path, csv_path=path)

    assert User.objects.filter(employee_id="T001").count() == 1
    assert IndicatorAssignment.objects.filter(user__employee_id="T001").count() == 2
    assert "0 accounts created, 1 updated" in output
    assert "0 assignments created (2 already there)" in output
    # a re-run issues a fresh password
    assert User.objects.get(employee_id="T001").password != first_hash


def test_existing_account_is_updated_and_reactivated(world, tmp_path):
    User.objects.create_user(
        username="T001", employee_id="T001", full_name="old", roles=["viewer"], is_active=False,
        must_change_password=False,
    )
    path = write_csv(tmp_path, "T001,new name,reporter,hsinchu,\n")
    run(tmp_path, csv_path=path)
    user = User.objects.get(employee_id="T001")
    assert (user.full_name, user.roles, user.campus.code) == ("new name", ["reporter"], "hsinchu")
    assert user.is_active and user.must_change_password


@pytest.mark.parametrize("body, fragment", [
    ("T001,A,boss,,\n", "unknown role"),
    ("T001,A,reporter,mars,\n", "unknown campus"),
    ("T001,A,reporter,,HA03-01:both\n", "need a campus"),
    ("T001,A,reporter,zhubei,HA03-01:half\n", "allowed: both"),
    ("T001,A,reporter,zhubei,HA99-99:both\n", "HA99-99"),
    ("T001,A,viewer,zhubei,HA03-01:both\n", "填報者"),
    ("T001,A,reporter,zhubei,HA06-31:denominator\n", "denominator"),
    ("admin,A,viewer,,\n", "reserved"),
    ("demo_a,A,viewer,,\n", "reserved"),
    ("T001,A,viewer,,\nT001,B,viewer,,\n", "repeated"),
])
def test_bad_rows_abort_without_writing(world, tmp_path, body, fragment):
    path = write_csv(tmp_path, "T000,Good,viewer,,\n" + body)
    with pytest.raises(CommandError) as excinfo:
        run(tmp_path, csv_path=path)
    assert fragment in str(excinfo.value)
    assert not User.objects.filter(employee_id="T000").exists()  # the good row was rolled back too
    assert not (tmp_path / "passwords.md").exists()


def test_missing_header_column_is_rejected(world, tmp_path):
    path = tmp_path / "bad.csv"
    path.write_text("employee_id,full_name\nT001,A\n", encoding="utf-8")
    with pytest.raises(CommandError, match="lacks"):
        run(tmp_path, csv_path=path)


def test_out_is_required_when_passwords_are_issued(world, tmp_path):
    path = write_csv(tmp_path, "T001,A,viewer,,\n")
    with pytest.raises(CommandError, match="--out"):
        run(tmp_path, csv_path=path, out=None)


def test_reset_demo_gives_new_passwords_without_forcing_a_change(world, tmp_path):
    for name in ("demo_a", "demo_b", "demo_r"):
        User.objects.create_user(username=name, employee_id=name, full_name=name, roles=["viewer"],
                                 password="Old-pass-123!x", must_change_password=True)
    output = run(tmp_path, "--reset-demo")
    report = (tmp_path / "passwords.md").read_text(encoding="utf-8")
    assert "3 demo accounts reset" in output
    for name in ("demo_a", "demo_b", "demo_r"):
        user = User.objects.get(employee_id=name)
        assert not user.check_password("Old-pass-123!x")
        assert user.must_change_password is False and user.is_active
        password = next(line for line in report.splitlines() if line.startswith(f"| {name} ")).split("`")[1]
        assert user.check_password(password)


def test_reset_demo_skips_missing_demo_accounts(world, tmp_path):
    output = run(tmp_path, "--reset-demo")
    assert "0 demo accounts reset" in output


def test_scrub_spares_csv_demo_and_admin(world, tmp_path):
    make = lambda name, **kw: User.objects.create_user(  # noqa: E731
        username=name, employee_id=name, full_name=name, roles=["viewer"], password="Real-pass-123!x", **kw
    )
    make("admin")
    make("demo_a")
    make("G999")      # a real account that is not in the CSV
    make("G998")
    path = write_csv(tmp_path, "T001,A,viewer,,\n")
    output = run(tmp_path, "--scrub", "--reset-demo", csv_path=path)

    assert "2 accounts scrubbed" in output
    assert not User.objects.get(employee_id="G999").has_usable_password()
    assert not User.objects.get(employee_id="G998").has_usable_password()
    assert User.objects.get(employee_id="admin").check_password("Real-pass-123!x")
    assert User.objects.get(employee_id="demo_a").has_usable_password()
    assert User.objects.get(employee_id="T001").has_usable_password()


def test_scrub_alone_needs_no_out_and_empties_axes_and_sessions(world, tmp_path):
    User.objects.create_user(username="G1", employee_id="G1", full_name="G1", password="Real-pass-123!x")
    AccessAttempt.objects.create(username="G1", ip_address="127.0.0.1", failures_since_start=2)
    AccessLog.objects.create(username="G1", ip_address="127.0.0.1", user_agent="x", attempt_time=datetime.datetime.now(
        tz=datetime.UTC))
    Session.objects.create(session_key="abc", session_data="x",
                           expire_date=datetime.datetime.now(tz=datetime.UTC) + datetime.timedelta(days=1))
    run(tmp_path, "--scrub", out=None)
    assert AccessAttempt.objects.count() == 0 and AccessLog.objects.count() == 0 and Session.objects.count() == 0
    assert not User.objects.get(employee_id="G1").has_usable_password()


def test_csv_account_clears_an_existing_login_lock(world, tmp_path):
    User.objects.create_user(username="T001", employee_id="T001", full_name="A", roles=["viewer"])
    AccessAttempt.objects.create(username="T001", ip_address="127.0.0.1", failures_since_start=9)
    path = write_csv(tmp_path, "T001,A,viewer,,\n")
    run(tmp_path, csv_path=path)
    assert not AccessAttempt.objects.filter(username="T001").exists()


# ── shared role accounts (--default-roster) ───────────────────────────────

ROSTER_IDS = ("uat_viewer", "uat_reporter_num", "uat_reporter_den", "uat_reporter_both", "uat_reviewer", "uat_admin")


def table_rows(report: str) -> dict[str, list[str]]:
    rows = {}
    for line in report.splitlines():
        cells = [c.strip() for c in line.split("|")]
        if len(cells) > 5 and cells[1] and cells[1] not in ("Account", "---"):
            rows[cells[1]] = cells
    return rows


def test_roster_is_created_automatically_when_there_is_no_csv(world, tmp_path):
    output = run(tmp_path)  # --out only
    assert "6 roster accounts" in output
    for name in ROSTER_IDS:
        user = User.objects.get(employee_id=name)
        assert user.is_active and not user.must_change_password and user.has_usable_password()

    def assigned(name):
        rows = IndicatorAssignment.objects.filter(user__employee_id=name)
        return set(rows.values_list("indicator_code", "field", "campus__code"))

    assert User.objects.get(employee_id="uat_viewer").roles == ["viewer"]
    assert User.objects.get(employee_id="uat_reporter_num").roles == ["reporter", "viewer"]
    assert User.objects.get(employee_id="uat_reporter_den").roles == ["reporter"]
    assert User.objects.get(employee_id="uat_reviewer").roles == ["reviewer", "viewer"]
    assert User.objects.get(employee_id="uat_admin").roles == ["admin"]
    assert assigned("uat_reporter_num") == {("HA03-01", "numerator", "zhubei"), ("HA03-02", "numerator", "zhubei")}
    assert assigned("uat_reporter_den") == {("HA03-01", "denominator", "zhubei"), ("HA03-02", "denominator", "zhubei")}
    assert assigned("uat_reporter_both") == {("HA01-01", "both", "zhubei"), ("HA01-02", "both", "zhubei")}
    assert assigned("uat_viewer") == assigned("uat_reviewer") == assigned("uat_admin") == set()
    assert User.objects.get(employee_id="uat_reviewer").campus.code == "zhubei"

    rows = table_rows((tmp_path / "passwords.md").read_text(encoding="utf-8"))
    for name in ROSTER_IDS:
        password = rows[name][3].strip("`")
        assert len(password) == 12
        assert User.objects.get(employee_id=name).check_password(password)
        assert password not in output


def test_roster_is_not_automatic_with_a_csv_but_can_be_added(world, tmp_path):
    path = write_csv(tmp_path, "T001,A,viewer,,\n")
    run(tmp_path, csv_path=path)
    assert not User.objects.filter(employee_id__startswith="uat_").exists()
    output = run(tmp_path, "--default-roster", csv_path=path)
    assert "6 roster accounts" in output
    assert User.objects.filter(employee_id__startswith="uat_").count() == 6
    assert User.objects.filter(employee_id="T001").exists()


def test_roster_run_twice_is_idempotent_and_reissues_passwords(world, tmp_path):
    run(tmp_path)
    before = User.objects.get(employee_id="uat_viewer").password
    output = run(tmp_path)
    assert User.objects.filter(employee_id__startswith="uat_").count() == 6
    assert IndicatorAssignment.objects.count() == 6
    assert "0 assignments created (6 already there)" in output
    assert User.objects.get(employee_id="uat_viewer").password != before


def test_csv_cannot_take_a_roster_name(world, tmp_path):
    path = write_csv(tmp_path, "uat_viewer,A,viewer,,\n")
    with pytest.raises(CommandError, match="reserved"):
        run(tmp_path, csv_path=path)


def test_scrub_spares_the_roster_and_readme_snippet_is_chinese_and_has_no_admin(world, tmp_path):
    User.objects.create_user(username="admin", employee_id="admin", full_name="admin", roles=["admin"],
                             password="Real-pass-123!x")
    User.objects.create_user(username="G1", employee_id="G1", full_name="G1", password="Real-pass-123!x")
    User.objects.create_user(username="demo_a", employee_id="demo_a", full_name="示範甲", roles=["reporter"],
                             password="Real-pass-123!x")
    snippet = tmp_path / "snippet.txt"
    output = run(tmp_path, "--scrub", "--reset-demo", "--readme-snippet", str(snippet))
    assert "1 accounts scrubbed" in output
    assert all(User.objects.get(employee_id=n).has_usable_password() for n in ROSTER_IDS)
    text = snippet.read_text(encoding="utf-8")
    assert "uat_reporter_num" in text and "demo_a" in text
    assert "指派：竹北院區 HA03-01 分子、HA03-02 分子" in text
    assert "帳號：admin" not in text and "G1" not in text
    report = (tmp_path / "passwords.md").read_text(encoding="utf-8")
    password = table_rows(report)["uat_viewer"][3].strip("`")
    assert f"密碼：{password}" in text
