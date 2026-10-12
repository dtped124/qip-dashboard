"""
Check the AD (LDAP) connection from the server side. Meant for the information office and the quality center when
turning AD sign-in on, and whenever "AD does not work" has to be narrowed down.

It talks to AD only through apps.accounts.ldap (the same Server / Connection / filter / answer the login uses) and
never through django.contrib.auth, so running it cannot count as a failed login or open a session. No mode prints a
password or the bind account.

Modes (all need LDAP_ENABLED=true; otherwise the command stops with an error):
  python manage.py ldap_check                 service-account bind only: "service bind ok" or the exception class
  python manage.py ldap_check --user T123     look the person up with the service account (no password involved):
                                              found / not found, name, mail, department
  python manage.py ldap_check --user T123 --login
                                              the full two-step check for that person; the password is typed at a
                                              hidden prompt (getpass) and only the resulting status is printed
  python manage.py ldap_check --audit         every active local account looked up in AD: who is NOT in AD (those
                                              cannot sign in once AD is on; administrators are marked [ADMIN]) and
                                              whose AD name differs from the system name. Accounts on
                                              LDAP_LOCAL_ONLY_ACCOUNTS never use AD and are left out of the findings.

--audit also lists the seed account `admin` when it is not in AD, but only as a note (keep it by listing it in
LDAP_LOCAL_ONLY_ACCOUNTS); any other administrator who is not in AD prints a WARNING and exits with code 2.

Exit code: 0 when the mode did what it was asked; non-zero (CommandError) when AD is off, the bind fails, the person
is not found / the login is refused, AD cannot be asked, or (--audit) an administrator other than `admin` is not in AD.
"""
import getpass

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.accounts import ldap as ad
from apps.accounts.models import User, UserRole

SEED_ADMIN_ID = "admin"  # the account `seed_admin` creates; listed but not warned about (see _audit)


def _squash(name: str) -> str:
    return "".join((name or "").split())


class Command(BaseCommand):
    help = "Check the AD connection: service-account bind, one person's lookup or login, or an audit of local accounts"

    def add_arguments(self, parser):
        parser.add_argument("--user", help="look this account (sAMAccountName / employee id) up in AD")
        parser.add_argument(
            "--login",
            action="store_true",
            help="with --user: run the full two-step sign-in check; the password is asked for at a hidden prompt",
        )
        parser.add_argument(
            "--audit",
            action="store_true",
            help="look every active local account up in AD (administrators who are missing are marked [ADMIN])",
        )

    def handle(self, *args, **options):
        conf = settings.LDAP
        if not conf["ENABLED"]:
            raise CommandError("LDAP_ENABLED is false")
        if options["login"] and not options["user"]:
            raise CommandError("--login needs --user <account>")
        if options["audit"] and (options["user"] or options["login"]):
            raise CommandError("--audit cannot be combined with --user / --login")

        if options["audit"]:
            self._audit(conf)
        elif options["user"] and options["login"]:
            self._login(options["user"])
        elif options["user"]:
            self._show_user(conf, options["user"])
        else:
            self._bind_only(conf)

    # ── Service account ──────────────────────────────────────────

    def _service_connection(self, conf):
        """A bound read-only service connection; any failure becomes a CommandError naming only the exception class."""
        timeout = conf["TIMEOUT"]
        try:
            server = ad.Server(conf["SERVER_IP"], port=conf["PORT"], get_info=ad.NONE, connect_timeout=timeout)
            return ad.Connection(
                server,
                user=conf["BIND_USER"],
                password=conf["BIND_PASS"],
                auto_bind=True,
                auto_referrals=False,
                receive_timeout=timeout,
                read_only=True,
            )
        except Exception as exc:  # noqa: BLE001 - whatever the library raises, the operator gets its class
            raise CommandError(f"service bind failed: {type(exc).__name__}") from None

    def _lookup(self, connection, conf, login_id):
        """``("found", attrs)``, ``("not_found", {})`` or ``("ambiguous", {})`` for one account name."""
        if not ad.LOGIN_ID_RE.fullmatch(login_id):
            return "not_found", {}  # cannot be an AD account name (and is never put into a filter)
        try:
            connection.search(
                conf["BASE_DN"],
                ad.build_filter(login_id),
                search_scope=ad.SUBTREE,
                attributes=ad.AD_ATTRIBUTES,
                size_limit=2,
            )
            entries = list(connection.entries)
        except Exception as exc:  # noqa: BLE001
            raise CommandError(f"AD search failed: {type(exc).__name__}") from None
        if not entries:
            return "not_found", {}
        if len(entries) > 1:
            return "ambiguous", {}
        return "found", ad._entry_attrs(entries[0])

    def _close(self, connection):
        try:
            connection.unbind()
        except Exception:  # noqa: BLE001 - closing is best effort
            pass

    def _bind_only(self, conf):
        connection = self._service_connection(conf)
        self._close(connection)
        self.stdout.write(f"service bind ok ({conf['SERVER_IP']}:{conf['PORT']})")

    # ── One person ───────────────────────────────────────────────

    def _show_user(self, conf, login_id):
        connection = self._service_connection(conf)
        try:
            state, attrs = self._lookup(connection, conf, login_id)
        finally:
            self._close(connection)
        if state == "ambiguous":
            self.stdout.write(f"ambiguous: more than one AD entry has the account name {login_id}")
            raise CommandError("account name is not unique in AD")
        if state == "not_found":
            self.stdout.write(f"not found: {login_id}")
            raise CommandError("account not found in AD")
        self.stdout.write(f"found: {attrs.get('sAMAccountName') or login_id}")
        self.stdout.write(f"  name:       {ad.ad_full_name(attrs) or '-'}")
        self.stdout.write(f"  mail:       {attrs.get('mail') or '-'}")
        self.stdout.write(f"  department: {attrs.get('department') or '-'}")

    def _login(self, login_id):
        password = getpass.getpass(f"AD password for {login_id} (hidden): ")
        result = ad.authenticate(login_id, password)
        self.stdout.write(f"status: {result.status}")
        if result.status != "success":
            raise CommandError(f"AD sign-in check failed: {result.status}")

    # ── Audit ────────────────────────────────────────────────────

    def _audit(self, conf):
        local_only = conf["LOCAL_ONLY_ACCOUNTS"]
        accounts = User.objects.filter(is_active=True).order_by("employee_id")
        connection = self._service_connection(conf)
        missing, different, checked, skipped = [], [], 0, 0
        try:
            for user in accounts:
                if user.employee_id.strip().casefold() in local_only:
                    skipped += 1
                    continue
                checked += 1
                state, attrs = self._lookup(connection, conf, user.employee_id)
                if state != "found":
                    missing.append((user, state))
                    continue
                ad_name = ad.ad_full_name(attrs)
                if _squash(ad_name) and _squash(user.full_name) and _squash(ad_name) != _squash(user.full_name):
                    different.append((user, ad_name))
        finally:
            self._close(connection)

        self.stdout.write(f"audited {checked} active local account(s); {skipped} local-only account(s) skipped")
        self.stdout.write(f"not in AD, cannot sign in once AD is on: {len(missing)}")
        real_admins_missing = 0
        for user, state in missing:
            is_admin = user.is_superuser or UserRole.ADMIN.value in user.role_set()
            seed_admin = is_admin and user.employee_id.strip().casefold() == SEED_ADMIN_ID
            marker = "[ADMIN] " if is_admin else ""
            reason = "more than one AD entry" if state == "ambiguous" else "not found"
            note = ""
            if seed_admin:
                note = "  (seed 管理者；要保留請列入 LDAP_LOCAL_ONLY_ACCOUNTS)"
            elif is_admin:
                real_admins_missing += 1
            self.stdout.write(f"  {marker}{user.employee_id}  {user.full_name}  ({reason}){note}")
        if real_admins_missing:
            self.stdout.write("  WARNING: an administrator is missing from AD - nobody could manage accounts "
                              "except via LDAP_LOCAL_ONLY_ACCOUNTS")
        self.stdout.write(f"AD name differs from the system name: {len(different)}")
        for user, ad_name in different:
            self.stdout.write(f"  {user.employee_id}  system={user.full_name}  ad={ad_name}")
        if real_admins_missing:
            raise CommandError(f"{real_admins_missing} administrator account(s) are not in AD", returncode=2)
