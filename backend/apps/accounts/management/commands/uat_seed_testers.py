"""
Prepare the accounts of a portable UAT package (deploy/portable/build-uat-portable.ps1 runs this on the staging
database before it is zipped).

  python manage.py uat_seed_testers --csv testers.csv --out passwords.md --reset-demo --scrub --default-roster

CSV (UTF-8, a BOM is fine), header row required:
  employee_id,full_name,roles,campus,assignments
  T001,Chen Mei,reporter|viewer,zhubei,HA03-01:numerator|HA03-02:both
  T002,Lin Wei,reviewer,,

* roles        viewer|reporter|reviewer|admin, separated by "|"
* campus       a campus code (hsinchu, zhubei, zhudong) or its name; may be empty
* assignments  CODE:FIELD pairs separated by "|" (FIELD = numerator, denominator or both; "CODE" alone means both).
               They are created at the row's campus, validated by the same serializer the admin UI uses, and a
               current assignment that already exists is left alone, so the command can be run again.

For every CSV row the account is created or updated (active, must change the password at the first login) and gets a
new temporary password, so a re-run issues fresh passwords.

--default-roster (switched on automatically when --out is given without --csv; with a CSV both sets are created)
creates the shared role accounts of ROSTER below, which testers use to play the different roles: viewer, reporter for
the numerator / the denominator / both, reviewer and a second administrator. They get 12-character passwords and never
have to change them. --reset-demo does the same for demo_a / demo_b / demo_r when they exist.

The passwords go to --out (Markdown) and nowhere else: stdout only carries counts. Keep that file out of the package.
--readme-snippet writes the Chinese account list (roster + demo accounts, with roles, assignments and passwords) that
build-uat-portable.ps1 puts into the README of the package; the admin account is never part of it.

--scrub makes every other account (not in the CSV, not a roster or demo account, not "admin") unusable for password
login so that real password hashes are not handed out with the package, and empties django-axes' attempt/access tables
and the session table. Everything runs in one transaction: any bad row aborts the run and nothing is written.
"""
import csv
import datetime
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.accounts import password_throttle
from apps.accounts.lockout import unlock_account
from apps.accounts.models import User, UserRole
from apps.accounts.passwords import generate_temporary_password
from apps.entry.models import AssignmentField, Campus, IndicatorAssignment
from apps.entry.serializers import IndicatorAssignmentSerializer

DEMO_ACCOUNTS = ("demo_a", "demo_b", "demo_r")
ADMIN_ACCOUNT = "admin"
EXPECTED_COLUMNS = ("employee_id", "full_name", "roles", "campus", "assignments")
ROSTER_PASSWORD_LENGTH = 12
# Shared accounts of the package: testers switch between them to play the different roles (order = README order).
ROSTER = (
    {"employee_id": "uat_viewer", "full_name": "測試-檢視者", "roles": ["viewer"], "campus": "", "assignments": []},
    {"employee_id": "uat_reporter_num", "full_name": "測試-填報者（分子）", "roles": ["reporter", "viewer"],
     "campus": "zhubei", "assignments": [("HA03-01", "numerator"), ("HA03-02", "numerator")]},
    {"employee_id": "uat_reporter_den", "full_name": "測試-填報者（分母）", "roles": ["reporter"],
     "campus": "zhubei", "assignments": [("HA03-01", "denominator"), ("HA03-02", "denominator")]},
    {"employee_id": "uat_reporter_both", "full_name": "測試-填報者（分子與分母）", "roles": ["reporter", "viewer"],
     "campus": "zhubei", "assignments": [("HA01-01", "both"), ("HA01-02", "both")]},
    {"employee_id": "uat_reviewer", "full_name": "測試-審核者", "roles": ["reviewer", "viewer"],
     "campus": "zhubei", "assignments": []},
    {"employee_id": "uat_admin", "full_name": "測試-管理者", "roles": ["admin"], "campus": "", "assignments": []},
)
ROSTER_IDS = tuple(spec["employee_id"] for spec in ROSTER)
# Assignments are in force from this day unless --effective-from says otherwise: early enough to cover every month
# that has data, so a tester can fill any period.
DEFAULT_EFFECTIVE_FROM = datetime.date(2020, 1, 1)


class Command(BaseCommand):
    help = "Create/update the UAT tester and role accounts and assignments, reset demo passwords, scrub the others"

    def add_arguments(self, parser):
        parser.add_argument("--csv", default=None, help="tester list (see the module docstring); optional")
        parser.add_argument("--out", default=None, help="Markdown file that receives the passwords")
        parser.add_argument("--default-roster", action="store_true",
                            help="create the shared role accounts (uat_*); automatic when --out is given without --csv")
        parser.add_argument("--readme-snippet", default=None,
                            help="write the Chinese account list (roster + demo, with passwords) for the README")
        parser.add_argument("--reset-demo", action="store_true", help="give demo_a / demo_b / demo_r new passwords")
        parser.add_argument("--scrub", action="store_true",
                            help="disable password login of all other accounts; empty axes and session tables")
        parser.add_argument("--effective-from", default=DEFAULT_EFFECTIVE_FROM.isoformat(),
                            help="start date of the created assignments (YYYY-MM-DD, default 2020-01-01)")

    def handle(self, *args, **options):
        csv_path = options["csv"]
        out_path = options["out"]
        reset_demo = options["reset_demo"]
        use_roster = options["default_roster"] or (not csv_path and bool(out_path))
        if (csv_path or reset_demo or use_roster) and not out_path:
            raise CommandError("--out is required whenever passwords are issued (--csv, --reset-demo, roster)")
        try:
            effective_from = datetime.date.fromisoformat(options["effective_from"])
        except ValueError:
            raise CommandError("--effective-from must be YYYY-MM-DD") from None

        rows = self._read_csv(Path(csv_path)) if csv_path else []

        issued: list[dict] = []
        counts = {"roster": 0, "accounts_created": 0, "accounts_updated": 0, "assignments_created": 0,
                  "assignments_kept": 0, "demo_reset": 0, "scrubbed": 0}
        with transaction.atomic():
            errors: list[str] = []
            for line_no, row in rows:
                try:
                    self._apply_spec(self._csv_spec(row), effective_from, issued, counts)
                except CommandError as exc:
                    errors.append(f"line {line_no}: {exc}")
            if errors:
                raise CommandError("CSV rejected, nothing was written:\n  " + "\n  ".join(errors))

            if use_roster:
                for spec in ROSTER:
                    self._apply_spec(dict(spec, kind="roster", must_change=False, length=ROSTER_PASSWORD_LENGTH),
                                     effective_from, issued, counts)
            if reset_demo:
                self._reset_demo(issued, counts)
            if options["scrub"]:
                keep = {row["employee_id"] for _, row in rows}
                keep |= set(DEMO_ACCOUNTS) | set(ROSTER_IDS) | {ADMIN_ACCOUNT}
                self._scrub(keep, counts)

        if out_path:
            self._write_report(Path(out_path), issued)
        if options["readme_snippet"]:
            self._write_snippet(Path(options["readme_snippet"]), issued)
        self.stdout.write(
            "uat_seed_testers: "
            f"{counts['roster']} roster accounts, {counts['accounts_created']} accounts created, "
            f"{counts['accounts_updated']} updated, "
            f"{counts['assignments_created']} assignments created ({counts['assignments_kept']} already there), "
            f"{counts['demo_reset']} demo accounts reset, {counts['scrubbed']} accounts scrubbed"
        )

    # ── CSV ────────────────────────────────────────────────────────────────

    def _read_csv(self, path: Path) -> list[tuple[int, dict]]:
        if not path.is_file():
            raise CommandError(f"CSV not found: {path}")
        with path.open(encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            header = tuple((name or "").strip() for name in (reader.fieldnames or ()))
            missing = [c for c in EXPECTED_COLUMNS if c not in header]
            if missing:
                raise CommandError(f"CSV header lacks: {', '.join(missing)} (expected {','.join(EXPECTED_COLUMNS)})")
            rows = []
            for line_no, raw in enumerate(reader, start=2):
                row = {(k or "").strip(): (v or "").strip() for k, v in raw.items() if k is not None}
                if not any(row.values()):
                    continue  # blank line
                rows.append((line_no, row))
        seen: dict[str, int] = {}
        for line_no, row in rows:
            key = row["employee_id"]
            if key in seen:
                raise CommandError(f"line {line_no}: employee_id repeated (first on line {seen[key]})")
            seen[key] = line_no
        return rows

    def _csv_spec(self, row: dict) -> dict:
        employee_id = row["employee_id"]
        if not employee_id:
            raise CommandError("employee_id is empty")
        if len(employee_id) > 20:
            raise CommandError("employee_id is longer than 20 characters")
        if employee_id == ADMIN_ACCOUNT or employee_id in DEMO_ACCOUNTS or employee_id in ROSTER_IDS:
            raise CommandError(f"{employee_id!r} is reserved (admin / demo / uat_* accounts are handled separately)")
        if not row["full_name"]:
            raise CommandError(f"{employee_id}: full_name is empty")

        roles = [r.strip() for r in row["roles"].split("|") if r.strip()]
        bad_roles = [r for r in roles if r not in UserRole.values]
        if bad_roles:
            raise CommandError(
                f"{employee_id}: unknown role {', '.join(bad_roles)} (allowed: {', '.join(UserRole.values)})"
            )
        assignments = self._parse_assignments(row["assignments"], employee_id)
        if assignments and not row["campus"]:
            raise CommandError(f"{employee_id}: assignments need a campus")
        return {"employee_id": employee_id, "full_name": row["full_name"], "roles": list(dict.fromkeys(roles)),
                "campus": row["campus"], "assignments": assignments, "kind": "tester", "must_change": True,
                "length": None}

    def _parse_assignments(self, text: str, employee_id: str) -> list[tuple[str, str]]:
        result: list[tuple[str, str]] = []
        for part in (p.strip() for p in text.split("|")):
            if not part:
                continue
            code, _, field = part.partition(":")
            code, field = code.strip(), (field.strip() or AssignmentField.BOTH.value)
            if not code:
                raise CommandError(f"{employee_id}: assignment {part!r} has no indicator code")
            if field not in AssignmentField.values:
                raise CommandError(
                    f"{employee_id}: assignment {part!r} has field {field!r} "
                    f"(allowed: {', '.join(AssignmentField.values)})"
                )
            result.append((code, field))
        return result

    # ── one account ────────────────────────────────────────────────────────

    def _apply_spec(self, spec: dict, effective_from: datetime.date, issued: list, counts: dict) -> None:
        employee_id = spec["employee_id"]
        campus = self._find_campus(spec["campus"], employee_id)

        user = User.objects.filter(employee_id=employee_id).first()
        created = user is None
        if created:
            user = User(employee_id=employee_id, username=employee_id)
        user.full_name = spec["full_name"]
        user.roles = list(spec["roles"])
        user.campus = campus
        user.is_active = True
        user.must_change_password = spec["must_change"]
        if spec["length"]:
            password = generate_temporary_password(user, spec["length"])
        else:
            password = generate_temporary_password(user)
        user.set_password(password)
        user.save()
        if not created:
            unlock_account(employee_id)
            password_throttle.reset(user)
        counts["roster" if spec["kind"] == "roster" else ("accounts_created" if created else "accounts_updated")] += 1
        for code, field in spec["assignments"]:
            self._ensure_assignment(user, campus, code, field, effective_from, counts)
        issued.append({"employee_id": employee_id, "full_name": user.full_name, "password": password,
                       "roles": list(spec["roles"]), "kind": spec["kind"], "assignments": self._describe(user)})

    def _find_campus(self, value: str, employee_id: str):
        if not value:
            return None
        campus = Campus.objects.filter(code__iexact=value).first() or Campus.objects.filter(name=value).first()
        if campus is None:
            known = ", ".join(Campus.objects.order_by("code").values_list("code", flat=True))
            raise CommandError(f"{employee_id}: unknown campus {value!r} (known: {known})")
        return campus

    def _ensure_assignment(self, user, campus, code: str, field: str, effective_from, counts: dict) -> None:
        current = IndicatorAssignment.objects.filter(
            user=user, campus=campus, indicator_code=code, field=field, effective_to__isnull=True
        )
        if current.exists():
            counts["assignments_kept"] += 1
            return
        # The admin UI's serializer owns the rules: the indicator exists, no denominator-only on a count
        # indicator, the assignee is an active reporter, and no overlapping current assignment.
        serializer = IndicatorAssignmentSerializer(data={
            "indicator_code": code, "campus": campus.pk, "user": user.pk, "field": field,
            "role": "primary", "effective_from": effective_from.isoformat(),
        })
        if not serializer.is_valid():
            raise CommandError(f"{user.employee_id}: assignment {code}:{field} rejected: {_flatten(serializer.errors)}")
        serializer.save()
        counts["assignments_created"] += 1

    @staticmethod
    def _describe(user) -> list[tuple[str, str, str]]:
        """[(campus name, indicator code, field label)] of the user's current assignments."""
        rows = IndicatorAssignment.objects.filter(user=user, effective_to__isnull=True).select_related("campus")
        return [(a.campus.name, a.indicator_code, AssignmentField(a.field).label)
                for a in rows.order_by("campus__code", "indicator_code", "field")]

    # ── demo accounts, scrub ───────────────────────────────────────────────

    def _reset_demo(self, issued: list, counts: dict) -> None:
        for employee_id in DEMO_ACCOUNTS:
            user = User.objects.filter(employee_id=employee_id).first()
            if user is None:
                continue
            password = generate_temporary_password(user)
            user.set_password(password)
            user.is_active = True
            user.must_change_password = False  # the README lists these passwords for everybody
            user.save()
            unlock_account(employee_id)
            password_throttle.reset(user)
            counts["demo_reset"] += 1
            issued.append({"employee_id": employee_id, "full_name": user.full_name, "password": password,
                           "roles": list(user.roles) if isinstance(user.roles, list) else [], "kind": "demo",
                           "assignments": self._describe(user)})

    def _scrub(self, keep: set[str], counts: dict) -> None:
        from axes.models import AccessAttempt, AccessFailureLog, AccessLog
        from django.contrib.sessions.models import Session

        for user in User.objects.exclude(employee_id__in=keep):
            user.set_unusable_password()
            user.save(update_fields=["password"])
            counts["scrubbed"] += 1
        AccessAttempt.objects.all().delete()
        AccessLog.objects.all().delete()
        AccessFailureLog.objects.all().delete()
        Session.objects.all().delete()

    # ── report and README snippet ──────────────────────────────────────────

    def _write_report(self, path: Path, issued: list) -> None:
        lines = [
            "# UAT accounts and passwords",
            "",
            f"Generated {datetime.datetime.now():%Y-%m-%d %H:%M}. "
            "Contains secrets: do NOT put this file into the package.",
            "",
        ]
        for kind, title, note in (
            ("roster", "Shared role accounts (listed in the tester README)", "No forced password change."),
            ("demo", "Demo accounts (listed in the tester README)", "No forced password change."),
            ("tester", "Personal tester accounts", "Each must change the password at the first login."),
        ):
            rows = [r for r in issued if r["kind"] == kind]
            if not rows:
                continue
            lines += [f"## {title}", "", note, ""]
            lines += ["| Account | Name | Password | Roles | Assignments |", "|---|---|---|---|---|"]
            for r in rows:
                assigned = "; ".join(f"{campus} {code} {label}" for campus, code, label in r["assignments"])
                roles = ", ".join(r["roles"])
                lines.append(f"| {r['employee_id']} | {r['full_name']} | `{r['password']}` | {roles} | {assigned} |")
            lines.append("")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    def _write_snippet(self, path: Path, issued: list) -> None:
        """Chinese account list for the README of the package: roster first, then the demo accounts."""
        lines = []
        for r in [x for x in issued if x["kind"] == "roster"] + [x for x in issued if x["kind"] == "demo"]:
            role_text = "、".join(UserRole(role).label for role in r["roles"] if role in UserRole.values)
            lines.append(f"   帳號：{r['employee_id']}　　密碼：{r['password']}")
            lines.append(f"       姓名：{r['full_name']}　　角色：{role_text}")
            if r["assignments"]:
                by_campus: dict[str, list[str]] = {}
                for campus, code, label in r["assignments"]:
                    by_campus.setdefault(campus, []).append(f"{code} {label}")
                text = "；".join(f"{campus}院區 " + "、".join(items) for campus, items in by_campus.items())
                lines.append(f"       指派：{text}")
            lines.append("")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("\n".join(lines).rstrip("\n") + "\n", encoding="utf-8")


def _flatten(errors) -> str:
    parts = []
    for key, value in errors.items():
        messages = value if isinstance(value, (list, tuple)) else [value]
        parts.append(f"{key}: {'; '.join(str(m) for m in messages)}")
    return " | ".join(parts)
