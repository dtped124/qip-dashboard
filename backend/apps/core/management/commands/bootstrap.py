"""
Start-up routine for containers; backend/entrypoint.sh runs it before the server starts.

Every step is idempotent and the whole routine is serialised across replicas, so it is safe to run on
every start of every container:

  1. wait until PostgreSQL accepts connections (up to 60 tries, 2 seconds apart)
  2. take a session-level advisory lock, so replicas that start together bootstrap one after another
  3. create the schema DB_SCHEMA when it does not exist yet
  4. migrate
  5. seed the reference data with --only-missing (never overwrites what an administrator changed)
  6. create the admin account, only when SEED_ADMIN_PASSWORD is set (an existing admin is left alone)
  7. release the lock

Right after the schema-name check it also prints one unnumbered line: whether AD sign-in is on (and where it points).

Usage:
  python manage.py bootstrap
"""
import os
import re
import time

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import InterfaceError, OperationalError, connection

from apps.accounts.management.commands.seed_admin import PASSWORD_ENV_VAR

# Arbitrary 64-bit key. Every replica must lock the same one, so it is a constant, not configuration.
LOCK_KEY = int.from_bytes(b"QIPBOOT", "big")
WAIT_ATTEMPTS = 60
WAIT_SECONDS = 2
# DB_SCHEMA ends up in DDL (it cannot be a bind parameter), so only plain identifiers are accepted - and only
# lowercase ones: the search_path option of the connection (config/settings/base.py) is not quoted, so PostgreSQL
# folds it to lowercase, while CREATE SCHEMA below quotes the name. "Qip" would create the schema "Qip" and the
# application would then look for "qip".
SCHEMA_NAME_RE = re.compile(r"^[a-z_][a-z0-9_]*$")


class Command(BaseCommand):
    help = "Wait for the database, then create the schema, migrate and seed the base data (idempotent, replica-safe)"

    def handle(self, *args, **options):
        schema = settings.DB_SCHEMA
        if not SCHEMA_NAME_RE.fullmatch(schema):  # fullmatch: "$" would also let a trailing newline through
            raise CommandError(
                f"DB_SCHEMA {schema!r} is not a plain identifier "
                "(lowercase letters, digits and underscore; it must not start with a digit)"
            )

        self._report_ad_sign_in()
        self._wait_for_database()

        # The lock lives on a connection of its own: it is held until that session ends, whatever
        # migrate does to the default connection in the meantime.
        lock_connection = connection.copy()
        try:
            self._acquire_lock(lock_connection)
            self._ensure_schema(schema)
            self._migrate()
            self._seed_reference_data()
            self._seed_admin()
        finally:
            self._release_lock(lock_connection)
        self._step("done")

    def _step(self, message):
        self.stdout.write(f"[bootstrap] {message}")
        self.stdout.flush()

    def _report_ad_sign_in(self):
        """One unnumbered line saying whether sign-in goes through AD. Never prints the bind account or its password."""
        conf = settings.LDAP
        if not conf["ENABLED"]:
            self._step("AD 驗證：未啟用（僅本地密碼）")
            return
        local_only = ", ".join(sorted(conf["LOCAL_ONLY_ACCOUNTS"])) or "無，所有帳號含管理者都必須通過 AD"
        self._step(
            f"AD 驗證：啟用（{conf['SERVER_IP']}:{conf['PORT']}，base {conf['BASE_DN']}，"
            f"逾時 {conf['TIMEOUT']:g} 秒，本地帳號：{local_only}）"
        )

    def _run(self, command, **kwargs):
        call_command(command, stdout=self.stdout, stderr=self.stderr, **kwargs)

    def _wait_for_database(self):
        self._step(f"1/6 waiting for the database (up to {WAIT_ATTEMPTS} tries, {WAIT_SECONDS}s apart)")
        for attempt in range(1, WAIT_ATTEMPTS + 1):
            try:
                connection.ensure_connection()
                with connection.cursor() as cursor:
                    cursor.execute("SELECT 1")
            except (OperationalError, InterfaceError) as exc:
                if attempt == WAIT_ATTEMPTS:
                    raise CommandError(f"database not reachable after {WAIT_ATTEMPTS} tries: {exc}") from exc
                first_line = str(exc).strip().splitlines()[0] if str(exc).strip() else type(exc).__name__
                self._step(f"   try {attempt}/{WAIT_ATTEMPTS} failed: {first_line}")
                connection.close()
                time.sleep(WAIT_SECONDS)
            else:
                self._step("   database reachable")
                return

    def _acquire_lock(self, lock_connection):
        self._step("2/6 taking the advisory lock (blocks while another replica is bootstrapping)")
        with lock_connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_lock(%s)", [LOCK_KEY])
        self._step("   advisory lock held")

    def _ensure_schema(self, schema):
        with connection.cursor() as cursor:
            # pg_namespace, not information_schema: the latter hides schemas the role has no privilege on.
            # Checking first also keeps a role without CREATE on the database working when the
            # schema was created for it ahead of time (CREATE SCHEMA IF NOT EXISTS checks that privilege
            # before it checks existence).
            cursor.execute("SELECT 1 FROM pg_namespace WHERE nspname = %s", [schema])
            exists = cursor.fetchone() is not None
            if not exists:
                cursor.execute(f"CREATE SCHEMA IF NOT EXISTS {connection.ops.quote_name(schema)}")
        self._step(f'3/6 schema "{schema}" {"already exists" if exists else "created"}')

    def _migrate(self):
        self._step("4/6 migrate")
        self._run("migrate", interactive=False)

    def _seed_reference_data(self):
        self._step("5/6 seed reference data (--only-missing)")
        self._run("seed_entry_base", only_missing=True)
        self._run("seed_indicators", only_missing=True)

    def _seed_admin(self):
        if not os.environ.get(PASSWORD_ENV_VAR):
            self._step(f"6/6 seed_admin skipped ({PASSWORD_ENV_VAR} is empty)")
            return
        self._step("6/6 seed_admin (an existing admin account is left alone)")
        self._run("seed_admin")

    def _release_lock(self, lock_connection):
        try:
            if lock_connection.connection is not None:
                with lock_connection.cursor() as cursor:
                    cursor.execute("SELECT pg_advisory_unlock(%s)", [LOCK_KEY])
                self._step("advisory lock released")
        except Exception as exc:  # the lock goes away with its session anyway
            self.stderr.write(f"[bootstrap] could not release the advisory lock cleanly ({exc}); closing its session")
        finally:
            lock_connection.close()
