"""
Phase 7 tests: /healthz, `manage.py bootstrap`, the --only-missing seeds, and the settings that differ
between development and production.

/healthz        open to anyone, 200 only when the database answers, 503 without saying why
bootstrap       step order, replica lock, retry loop, schema-name guard (steps are stubbed except where the
                test is about the SQL itself: the advisory lock and CREATE SCHEMA run for real)
--only-missing  an administrator's changes survive a restart (a deactivated indicator stays deactivated)
settings        DATABASE_URL / DB_* handling, and what production turns on (hosts, proxy header, WhiteNoise,
                JSON-only API, cookies)
"""
from __future__ import annotations

import importlib
import io
import os
import re
import subprocess
import sys
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace

import environ
import pytest
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import OperationalError, connection
from django.urls import reverse

from apps.core.management.commands import bootstrap
from apps.entry.models import Campus
from apps.indicators.constants import INDICATOR_META
from apps.indicators.models import Indicator
from config.settings.base import database_config, ldap_settings

pytestmark = pytest.mark.django_db


# ── /healthz ─────────────────────────────────────────────────────

class TestHealthz:
    def test_answers_200_to_anyone_and_is_never_cached(self, client):
        resp = client.get("/healthz")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}
        assert "no-store" in resp["Cache-Control"]
        assert reverse("healthz") == "/healthz"

    def test_head_is_fine_and_writes_are_refused(self, client):
        assert client.head("/healthz").status_code == 200
        assert client.post("/healthz").status_code == 405

    def test_503_without_a_reason_when_the_database_is_down(self, client, monkeypatch):
        class Down:
            def ensure_connection(self):
                raise OperationalError("connection to server at db-internal-host refused")

        monkeypatch.setattr("apps.core.views.connection", Down())
        resp = client.get("/healthz")
        assert resp.status_code == 503
        assert resp.json() == {"status": "unavailable"}
        assert b"db-internal-host" not in resp.content

    def test_503_when_a_kept_connection_has_gone_stale(self, client, monkeypatch):
        """ensure_connection() succeeds on a connection the server dropped; only the query notices."""

        class Stale:
            def ensure_connection(self):
                return None

            @contextmanager
            def cursor(self):
                raise OperationalError("server closed the connection unexpectedly")
                yield  # pragma: no cover

        monkeypatch.setattr("apps.core.views.connection", Stale())
        assert client.get("/healthz").status_code == 503


# ── bootstrap ────────────────────────────────────────────────────

class FakeConnection:
    """Stands in for django.db.connection while bootstrap waits: refuses `failures` times, then answers."""

    def __init__(self, failures):
        self.failures = failures
        self.attempts = 0
        self.closed = 0

    def ensure_connection(self):
        self.attempts += 1
        if self.attempts <= self.failures:
            raise OperationalError("connection refused\nsecond line that must not be echoed")

    @contextmanager
    def cursor(self):
        yield SimpleNamespace(execute=lambda *args, **kwargs: None)

    def close(self):
        self.closed += 1


class Calls(list):
    """The recorded step names; set ``fail_on`` to a management command name to make that command raise."""

    fail_on: str | None = None


@pytest.fixture
def steps(monkeypatch):
    """Replace every bootstrap step by a recorder and return the list the calls are appended to."""
    calls = Calls()
    command_class = bootstrap.Command
    monkeypatch.setattr(command_class, "_wait_for_database", lambda self: calls.append("wait"))
    monkeypatch.setattr(command_class, "_acquire_lock", lambda self, lock_connection: calls.append("lock"))
    monkeypatch.setattr(command_class, "_ensure_schema", lambda self, schema: calls.append(f"schema:{schema}"))
    monkeypatch.setattr(command_class, "_release_lock", lambda self, lock_connection: calls.append("release"))

    def fake_call_command(name, *args, **kwargs):
        calls.append(f"{name}:only-missing" if kwargs.get("only_missing") else name)
        if name == calls.fail_on:
            raise CommandError(f"{name} failed")

    monkeypatch.setattr(bootstrap, "call_command", fake_call_command)
    return calls


class TestBootstrap:
    def test_runs_the_steps_in_order_and_skips_the_admin_without_a_password(self, steps, monkeypatch):
        monkeypatch.delenv("SEED_ADMIN_PASSWORD", raising=False)
        out = io.StringIO()
        call_command("bootstrap", stdout=out)
        assert steps == [
            "wait", "lock", f"schema:{settings.DB_SCHEMA}",
            "migrate", "seed_entry_base:only-missing", "seed_indicators:only-missing",
            "release",
        ]
        assert "seed_admin skipped" in out.getvalue()
        assert out.getvalue().rstrip().endswith("done")

    def test_creates_the_admin_only_when_a_password_is_provided(self, steps, monkeypatch):
        monkeypatch.setenv("SEED_ADMIN_PASSWORD", "not-printed-anywhere")
        out = io.StringIO()
        call_command("bootstrap", stdout=out)
        assert steps[-2:] == ["seed_admin", "release"]
        assert "not-printed-anywhere" not in out.getvalue()

    def _ad_line(self, out):
        lines = [line for line in out.getvalue().splitlines() if "AD 驗證" in line]
        assert len(lines) == 1
        return lines[0]

    def test_says_that_ad_sign_in_is_off(self, steps, monkeypatch):
        monkeypatch.delenv("SEED_ADMIN_PASSWORD", raising=False)
        out = io.StringIO()
        call_command("bootstrap", stdout=out)
        assert self._ad_line(out) == "[bootstrap] AD 驗證：未啟用（僅本地密碼）"

    def test_says_that_ad_sign_in_is_on_and_never_prints_the_bind_values(self, steps, monkeypatch, settings):
        monkeypatch.delenv("SEED_ADMIN_PASSWORD", raising=False)
        settings.LDAP = {
            "ENABLED": True, "SERVER_IP": "ad.example.test", "PORT": 3890,
            "BIND_USER": "CN=svc-made-up,DC=example,DC=test", "BIND_PASS": "bind-made-up-secret",
            "BASE_DN": "DC=example,DC=test", "TIMEOUT": 3.0, "AUTO_CREATE": False,
            "DEFAULT_ROLE": "viewer", "LOCAL_ONLY_ACCOUNTS": frozenset({"breakglass", "admin"}),
        }
        out = io.StringIO()
        call_command("bootstrap", stdout=out)
        line = self._ad_line(out)
        for part in ("AD 驗證：啟用", "ad.example.test:3890", "base DC=example,DC=test", "逾時 3 秒",
                     "本地帳號：admin, breakglass"):
            assert part in line
        assert "svc-made-up" not in out.getvalue()
        assert "bind-made-up-secret" not in out.getvalue()
        # the line comes before the first numbered step
        assert out.getvalue().index("AD 驗證") < out.getvalue().index("seed_admin skipped")

    def test_warns_in_the_status_line_when_nobody_may_skip_ad(self, steps, monkeypatch, settings):
        monkeypatch.delenv("SEED_ADMIN_PASSWORD", raising=False)
        settings.LDAP = {
            "ENABLED": True, "SERVER_IP": "ad.example.test", "PORT": 389, "BIND_USER": "u", "BIND_PASS": "p",
            "BASE_DN": "DC=example,DC=test", "TIMEOUT": 2.5, "AUTO_CREATE": False,
            "DEFAULT_ROLE": "viewer", "LOCAL_ONLY_ACCOUNTS": frozenset(),
        }
        out = io.StringIO()
        call_command("bootstrap", stdout=out)
        line = self._ad_line(out)
        assert "本地帳號：無，所有帳號含管理者都必須通過 AD" in line
        assert "逾時 2.5 秒" in line

    def test_releases_the_lock_when_a_step_fails(self, steps, monkeypatch):
        monkeypatch.delenv("SEED_ADMIN_PASSWORD", raising=False)
        steps.fail_on = "migrate"
        with pytest.raises(CommandError, match="migrate failed"):
            call_command("bootstrap", stdout=io.StringIO())
        assert steps[-1] == "release"
        assert "seed_entry_base:only-missing" not in steps

    @pytest.mark.parametrize("name", ["qip", "_qip2", "tenant_a_1", "a"])
    def test_plain_lowercase_identifiers_pass_the_schema_guard(self, name):
        assert bootstrap.SCHEMA_NAME_RE.fullmatch(name)

    @pytest.mark.parametrize("name", ["Qip", "QIP_SCHEMA", "qipSchema"])
    def test_upper_case_names_are_refused_because_search_path_folds_them(self, steps, settings, name):
        """CREATE SCHEMA quotes the name, the unquoted search_path option does not: "Qip" would be created
        and "qip" searched. Only lowercase names make both sides agree."""
        settings.DB_SCHEMA = name
        with pytest.raises(CommandError, match="lowercase"):
            call_command("bootstrap", stdout=io.StringIO())
        assert steps == []

    @pytest.mark.parametrize("name", ["", "1qip", "qip-prod", "qip schema", 'a"b', "qip;", "qip\n", "public, other"])
    def test_anything_else_is_refused_before_a_step_runs(self, steps, settings, name):
        settings.DB_SCHEMA = name
        with pytest.raises(CommandError, match="DB_SCHEMA"):
            call_command("bootstrap", stdout=io.StringIO())
        assert steps == []

    def test_waits_until_the_database_answers(self, monkeypatch):
        fake = FakeConnection(failures=2)
        sleeps: list[float] = []
        monkeypatch.setattr(bootstrap, "connection", fake)
        monkeypatch.setattr(bootstrap.time, "sleep", sleeps.append)
        out = io.StringIO()

        bootstrap.Command(stdout=out)._wait_for_database()

        assert fake.attempts == 3
        assert sleeps == [bootstrap.WAIT_SECONDS] * 2
        assert fake.closed == 2
        assert "try 2/" in out.getvalue()
        assert "second line" not in out.getvalue()  # only the first line of a driver error is logged
        assert "database reachable" in out.getvalue()

    def test_gives_up_after_the_last_try(self, monkeypatch):
        fake = FakeConnection(failures=10**6)
        sleeps: list[float] = []
        monkeypatch.setattr(bootstrap, "connection", fake)
        monkeypatch.setattr(bootstrap, "WAIT_ATTEMPTS", 3)
        monkeypatch.setattr(bootstrap.time, "sleep", sleeps.append)

        with pytest.raises(CommandError, match="not reachable after 3 tries"):
            bootstrap.Command(stdout=io.StringIO())._wait_for_database()

        assert fake.attempts == 3
        assert len(sleeps) == 2  # no sleep after the final failure

    def test_the_advisory_lock_keeps_a_second_session_out(self):
        def try_lock(conn):
            with conn.cursor() as cursor:
                cursor.execute("SELECT pg_try_advisory_lock(%s)", [bootstrap.LOCK_KEY])
                return cursor.fetchone()[0]

        command = bootstrap.Command(stdout=io.StringIO())
        holder, other = connection.copy(), connection.copy()
        try:
            command._acquire_lock(holder)
            assert try_lock(other) is False  # a second replica has to wait
            command._release_lock(holder)
            assert try_lock(other) is True  # and gets in once the first one is done
        finally:
            other.close()
            holder.close()

    def test_a_missing_schema_is_created_once(self):
        name = "qip_pytest_bootstrap_schema"
        out = io.StringIO()
        command = bootstrap.Command(stdout=out)

        def schema_exists():
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1 FROM pg_namespace WHERE nspname = %s", [name])
                return cursor.fetchone() is not None

        assert not schema_exists()
        command._ensure_schema(name)
        command._ensure_schema(name)
        assert schema_exists()  # rolled back with the test transaction
        text = out.getvalue()
        assert text.index("created") < text.index("already exists")


# ── --only-missing ───────────────────────────────────────────────

FIRST_CODE, SECOND_CODE = list(INDICATOR_META)[:2]


class TestOnlyMissing:
    def test_indicators_keep_what_an_administrator_changed(self):
        call_command("seed_indicators", only_missing=True, stdout=io.StringIO())
        Indicator.objects.filter(code=FIRST_CODE).update(is_active=False, name="renamed by an admin")

        call_command("seed_indicators", only_missing=True, stdout=io.StringIO())

        ind = Indicator.objects.get(code=FIRST_CODE)
        assert ind.is_active is False
        assert ind.name == "renamed by an admin"

    def test_a_missing_indicator_is_added_and_reported(self):
        call_command("seed_indicators", only_missing=True, stdout=io.StringIO())
        Indicator.objects.filter(code=SECOND_CODE).delete()
        out = io.StringIO()

        call_command("seed_indicators", only_missing=True, stdout=out)

        assert Indicator.objects.filter(code=SECOND_CODE).exists()
        assert "新增 1 筆" in out.getvalue()
        assert f"略過 {len(INDICATOR_META) - 1} 筆" in out.getvalue()

    def test_the_default_run_still_overwrites_and_reactivates(self):
        call_command("seed_indicators", only_missing=True, stdout=io.StringIO())
        Indicator.objects.filter(code=FIRST_CODE).update(is_active=False)

        call_command("seed_indicators", stdout=io.StringIO())

        assert Indicator.objects.get(code=FIRST_CODE).is_active is True

    def test_entry_base_keeps_what_an_administrator_changed(self):
        call_command("seed_entry_base", only_missing=True, stdout=io.StringIO())
        Campus.objects.filter(code="zhubei").update(name="改過的名稱")

        out = io.StringIO()
        call_command("seed_entry_base", only_missing=True, stdout=out)
        assert Campus.objects.get(code="zhubei").name == "改過的名稱"
        assert "略過" in out.getvalue()

        call_command("seed_entry_base", stdout=io.StringIO())
        assert Campus.objects.get(code="zhubei").name == "竹北"

    @pytest.mark.parametrize("command", ["seed_indicators", "seed_entry_base"])
    def test_clear_and_only_missing_cannot_be_combined(self, command):
        with pytest.raises(CommandError, match="not allowed with"):
            call_command(command, "--clear", "--only-missing")


# ── settings ─────────────────────────────────────────────────────

DB_ENV = (
    "DATABASE_URL", "DB_NAME", "DB_USER", "DB_PASSWORD", "DB_HOST", "DB_PORT", "DB_CONN_MAX_AGE", "DB_CONNECT_TIMEOUT",
)


@pytest.fixture
def clean_db_env(monkeypatch):
    for key in DB_ENV:
        monkeypatch.delenv(key, raising=False)


class TestDatabaseConfig:
    def test_db_variables_are_used_without_a_url(self, monkeypatch, clean_db_env):
        monkeypatch.setenv("DB_NAME", "n")
        monkeypatch.setenv("DB_HOST", "h")
        monkeypatch.setenv("DB_PORT", "5440")

        config = database_config(environ.Env(), "qip")

        assert (config["NAME"], config["HOST"], config["PORT"]) == ("n", "h", "5440")
        assert config["OPTIONS"] == {"options": "-c search_path=qip,public", "connect_timeout": 5}
        assert config["CONN_MAX_AGE"] == 60
        assert config["CONN_HEALTH_CHECKS"] is True

    def test_a_url_wins_and_keeps_its_own_options(self, monkeypatch, clean_db_env):
        monkeypatch.setenv("DB_NAME", "ignored")
        monkeypatch.setenv(
            "DATABASE_URL",
            "postgres://app:p%40ss%3Aword@db.example.org:5433/prod?sslmode=require&options=-c%20statement_timeout%3D5000",
        )

        config = database_config(environ.Env(), "tenant_a")

        assert config["ENGINE"].endswith("postgresql")
        assert (config["NAME"], config["USER"]) == ("prod", "app")
        assert (config["HOST"], config["PORT"]) == ("db.example.org", 5433)
        assert config["PASSWORD"] == "p@ss:word"
        assert config["OPTIONS"]["sslmode"] == "require"
        assert config["OPTIONS"]["options"] == "-c statement_timeout=5000 -c search_path=tenant_a,public"

    def test_connection_lifetime_is_configurable(self, monkeypatch, clean_db_env):
        monkeypatch.setenv("DB_CONN_MAX_AGE", "0")
        assert database_config(environ.Env(), "qip")["CONN_MAX_AGE"] == 0

    def test_an_unreachable_database_is_given_up_on_after_a_few_seconds(self, monkeypatch, clean_db_env):
        """Without connect_timeout every attempt waits for the operating system (about two minutes), so
        bootstrap's retry loop would crawl while the database is still starting."""
        assert database_config(environ.Env(), "qip")["OPTIONS"]["connect_timeout"] == 5

        monkeypatch.setenv("DB_CONNECT_TIMEOUT", "12")
        assert database_config(environ.Env(), "qip")["OPTIONS"]["connect_timeout"] == 12

        monkeypatch.setenv("DB_CONNECT_TIMEOUT", "0")  # libpq: 0 waits for ever
        assert database_config(environ.Env(), "qip")["OPTIONS"]["connect_timeout"] == 0

    def test_a_connect_timeout_inside_the_url_wins(self, monkeypatch, clean_db_env):
        monkeypatch.setenv("DB_CONNECT_TIMEOUT", "12")
        monkeypatch.setenv("DATABASE_URL", "postgres://u:p@h:5432/d?connect_timeout=30")

        options = database_config(environ.Env(), "qip")["OPTIONS"]

        assert options["connect_timeout"] == 30
        assert options["options"] == "-c search_path=qip,public"

    def test_only_postgres_urls_are_accepted(self, monkeypatch, clean_db_env):
        monkeypatch.setenv("DATABASE_URL", "mysql://u:p@h/db")
        with pytest.raises(ImproperlyConfigured, match="postgres"):
            database_config(environ.Env(), "qip")

    def test_the_active_settings_are_the_development_ones(self):
        assert settings.DATABASES["default"]["CONN_MAX_AGE"] == 0  # runserver: one thread per request
        assert settings.DB_SCHEMA


# 64 characters, nothing in it that looks like a stand-in: the secret key every production test starts from.
VALID_SECRET_KEY = "0123456789abcdef" * 4
HOSTS = {"DJANGO_ALLOWED_HOSTS": "qip.example.org"}


@pytest.fixture
def load_prod(monkeypatch):
    """Import config.settings.prod afresh under the given environment; it is dropped again afterwards.

    A valid secret key is set unless the test passes its own: production refuses to start without one."""

    def load(**env):
        for key in ("DJANGO_ALLOWED_HOSTS", "SECURE_HSTS_SECONDS", "SECURE_SSL_REDIRECT",
                    "SESSION_COOKIE_SECURE", "CSRF_COOKIE_SECURE", "COLLECTSTATIC_ONLY"):
            monkeypatch.delenv(key, raising=False)
        monkeypatch.setenv("DJANGO_SECRET_KEY", VALID_SECRET_KEY)
        for key, value in env.items():
            monkeypatch.setenv(key, value)
        sys.modules.pop("config.settings.prod", None)
        return importlib.import_module("config.settings.prod")

    yield load
    sys.modules.pop("config.settings.prod", None)


class TestProductionSettings:
    def test_hosts_are_required(self, load_prod):
        with pytest.raises(ImproperlyConfigured, match="DJANGO_ALLOWED_HOSTS"):
            load_prod()
        with pytest.raises(ImproperlyConfigured, match="DJANGO_ALLOWED_HOSTS"):
            load_prod(DJANGO_ALLOWED_HOSTS=" , ")

    def test_hosts_are_trimmed(self, load_prod):
        prod = load_prod(DJANGO_ALLOWED_HOSTS="qip.example.org, localhost ,")
        assert prod.ALLOWED_HOSTS == ["qip.example.org", "localhost"]

    def test_safe_defaults(self, load_prod):
        prod = load_prod(DJANGO_ALLOWED_HOSTS="qip.example.org")
        assert prod.DEBUG is False
        assert prod.SECURE_PROXY_SSL_HEADER == ("HTTP_X_FORWARDED_PROTO", "https")
        assert prod.SESSION_COOKIE_SECURE is True
        assert prod.CSRF_COOKIE_SECURE is True
        assert prod.SECURE_HSTS_SECONDS == 0
        assert prod.SECURE_SSL_REDIRECT is False
        assert prod.SECURE_REDIRECT_EXEMPT == [r"^healthz$"]
        assert prod.X_FRAME_OPTIONS == "DENY"

    def test_environment_switches(self, load_prod):
        prod = load_prod(
            DJANGO_ALLOWED_HOSTS="qip.example.org",
            SECURE_HSTS_SECONDS="31536000",
            SECURE_SSL_REDIRECT="true",
            SESSION_COOKIE_SECURE="false",
            CSRF_COOKIE_SECURE="false",
        )
        assert prod.SECURE_HSTS_SECONDS == 31536000
        assert prod.SECURE_SSL_REDIRECT is True
        assert prod.SESSION_COOKIE_SECURE is False
        assert prod.CSRF_COOKIE_SECURE is False

    def test_whitenoise_sits_right_after_the_security_middleware_in_production_only(self, load_prod):
        prod = load_prod(DJANGO_ALLOWED_HOSTS="qip.example.org")
        security = prod.MIDDLEWARE.index("django.middleware.security.SecurityMiddleware")
        assert prod.MIDDLEWARE[security + 1] == "whitenoise.middleware.WhiteNoiseMiddleware"
        assert prod.STORAGES["staticfiles"]["BACKEND"] == "whitenoise.storage.CompressedManifestStaticFilesStorage"
        # development (and therefore the test run) must not need the package
        base = importlib.import_module("config.settings.base")
        assert "whitenoise.middleware.WhiteNoiseMiddleware" not in settings.MIDDLEWARE
        assert "whitenoise.middleware.WhiteNoiseMiddleware" not in base.MIDDLEWARE

    def test_the_api_speaks_json_only(self, load_prod):
        prod = load_prod(DJANGO_ALLOWED_HOSTS="qip.example.org")
        assert prod.REST_FRAMEWORK["DEFAULT_RENDERER_CLASSES"] == ["rest_framework.renderers.JSONRenderer"]
        # everything else of the base configuration is kept
        kept = "DEFAULT_PERMISSION_CLASSES"
        assert prod.REST_FRAMEWORK[kept] == settings.REST_FRAMEWORK[kept]

    def test_localhost_cors_rules_exist_in_development_only(self, load_prod):
        prod = load_prod(DJANGO_ALLOWED_HOSTS="qip.example.org")
        base = importlib.import_module("config.settings.base")
        dev = importlib.import_module("config.settings.dev")
        assert dev.CORS_ALLOWED_ORIGIN_REGEXES
        assert not hasattr(base, "CORS_ALLOWED_ORIGIN_REGEXES")
        assert not hasattr(prod, "CORS_ALLOWED_ORIGIN_REGEXES")
        assert "localhost" not in " ".join(prod.CSRF_TRUSTED_ORIGINS + prod.CORS_ALLOWED_ORIGINS)

    def test_celery_is_gone(self):
        assert not any(name.startswith("CELERY_") for name in dir(settings))


# ── production secret key ────────────────────────────────────────

def _stretched(stand_in, length=64):
    """A stand-in padded to a believable length with characters a template would not contain."""
    return (stand_in + "-" + "Zq7Rk" * 20)[:length]


def _collectstatic_env():
    """The variables on the Dockerfile's collectstatic RUN line, as a dict (backslash continuations joined)."""
    text = (Path(settings.BASE_DIR) / "Dockerfile").read_text(encoding="utf-8")
    statements = re.sub(r"\\\n\s*", " ", text).splitlines()
    line = next(s for s in statements if s.startswith("RUN") and "collectstatic" in s)
    return dict(re.findall(r"\b([A-Z_]+)=(\S+)", line))


class TestProductionSecretKey:
    """The key signs sessions and CSRF tokens: production must not start with an empty, short or stand-in one."""

    @pytest.mark.parametrize("value", ["", "   "])
    def test_an_empty_key_is_refused(self, load_prod, value):
        with pytest.raises(ImproperlyConfigured, match="DJANGO_SECRET_KEY is empty"):
            load_prod(DJANGO_SECRET_KEY=value, **HOSTS)

    def test_fifty_characters_are_the_minimum(self, load_prod):
        with pytest.raises(ImproperlyConfigured, match="has 49 characters"):
            load_prod(DJANGO_SECRET_KEY="k" + "9fA2" * 12, **HOSTS)
        prod = load_prod(DJANGO_SECRET_KEY="k" + "9fA2" * 12 + "z", **HOSTS)
        assert len(prod.SECRET_KEY) == 50

    def test_a_good_key_is_used_as_given(self, load_prod):
        assert load_prod(**HOSTS).SECRET_KEY == VALID_SECRET_KEY

    @pytest.mark.parametrize("stand_in", [
        "dev-secret-key-change-in-production",   # docker-compose.yml (development)
        "change-me-in-production",               # backend/.env.example
        "collectstatic-only",                    # the former Dockerfile
        "CHANGE-ME-IN-PRODUCTION",               # case does not matter
        "django-insecure-8x$kq",                 # what `django-admin startproject` generates
    ])
    def test_a_stand_in_is_refused_even_when_stretched_to_length(self, load_prod, stand_in):
        key = _stretched(stand_in)
        assert len(key) >= 50
        with pytest.raises(ImproperlyConfigured, match="placeholder"):
            load_prod(DJANGO_SECRET_KEY=key, **HOSTS)

    def test_the_message_never_repeats_the_key(self, load_prod):
        for key, match in ((_stretched("dev-secret-key-change-in-production"), "placeholder"),
                           ("tiny-secret-9z", "characters")):
            with pytest.raises(ImproperlyConfigured, match=match) as caught:
                load_prod(DJANGO_SECRET_KEY=key, **HOSTS)
            assert key not in str(caught.value)

    def test_the_backend_template_cannot_start_production(self, load_prod):
        """Copying backend/.env.example without editing it must not give a running production."""
        template = (Path(settings.BASE_DIR) / ".env.example").read_text(encoding="utf-8")
        key = re.search(r"^DJANGO_SECRET_KEY=(.*)$", template, re.M).group(1)
        with pytest.raises(ImproperlyConfigured):
            load_prod(DJANGO_SECRET_KEY=key, **HOSTS)

    def test_the_dockerfile_build_key_passes_only_while_collecting_static_files(self, load_prod):
        build = _collectstatic_env()
        key = build["DJANGO_SECRET_KEY"]
        assert build["COLLECTSTATIC_ONLY"] == "1"
        assert key.startswith("build-only-")
        assert len(key) >= 50

        hosts = {"DJANGO_ALLOWED_HOSTS": build["DJANGO_ALLOWED_HOSTS"]}
        with pytest.raises(ImproperlyConfigured, match="placeholder"):      # a running container
            load_prod(DJANGO_SECRET_KEY=key, **hosts)
        with pytest.raises(ImproperlyConfigured, match="placeholder"):
            load_prod(DJANGO_SECRET_KEY=key, COLLECTSTATIC_ONLY="0", **hosts)
        prod = load_prod(DJANGO_SECRET_KEY=key, COLLECTSTATIC_ONLY="1", **hosts)   # the image build
        assert prod.SECRET_KEY == key

    @pytest.mark.parametrize("key", [
        "short",
        "build-only-short",                                      # the prefix does not excuse a short key
        _stretched("dev-secret-key-change-in-production"),       # nor another stand-in
    ])
    def test_collectstatic_only_excuses_nothing_but_the_build_only_prefix(self, load_prod, key):
        with pytest.raises(ImproperlyConfigured):
            load_prod(DJANGO_SECRET_KEY=key, COLLECTSTATIC_ONLY="1", **HOSTS)

    def test_a_real_key_still_works_with_the_flag_set(self, load_prod):
        assert load_prod(COLLECTSTATIC_ONLY="1", **HOSTS).SECRET_KEY == VALID_SECRET_KEY


# ── AD / LDAP settings ───────────────────────────────────────────

LDAP_KEYS = (
    "LDAP_ENABLED", "LDAP_SERVER_IP", "LDAP_PORT", "LDAP_BIND_USER", "LDAP_BIND_PASS", "LDAP_BASE_DN", "LDAP_TIMEOUT",
    "LDAP_AUTO_CREATE", "LDAP_DEFAULT_ROLE", "LDAP_LOCAL_ONLY_ACCOUNTS",
)
# Made-up values; none of them may ever be echoed by an error message.
LDAP_VALUES = {
    "LDAP_ENABLED": "true",
    "LDAP_SERVER_IP": "ad.example.test",
    "LDAP_BIND_USER": "CN=svc-test,DC=example,DC=test",
    "LDAP_BIND_PASS": "Pw-Zq9-marker",
    "LDAP_BASE_DN": "DC=example,DC=test",
}
LDAP_REQUIRED = ("LDAP_SERVER_IP", "LDAP_BIND_USER", "LDAP_BIND_PASS", "LDAP_BASE_DN")


@pytest.fixture
def clean_ldap_env(monkeypatch):
    for key in LDAP_KEYS:
        monkeypatch.delenv(key, raising=False)


def enabled_env(monkeypatch, **overrides):
    for key, value in {**LDAP_VALUES, **overrides}.items():
        monkeypatch.setenv(key, value)


class TestLdapSettings:
    def test_off_without_any_key_is_fine_and_has_the_documented_defaults(self, clean_ldap_env):
        conf = ldap_settings(environ.Env())

        assert conf == {
            "ENABLED": False,
            "SERVER_IP": "",
            "PORT": 389,
            "BIND_USER": "",
            "BIND_PASS": "",
            "BASE_DN": "",
            "TIMEOUT": 3.0,
            "AUTO_CREATE": False,
            "DEFAULT_ROLE": "viewer",
            "LOCAL_ONLY_ACCOUNTS": frozenset(),
        }
        assert isinstance(conf["LOCAL_ONLY_ACCOUNTS"], frozenset)

    def test_the_module_level_setting_exists_and_has_the_same_keys(self, clean_ldap_env):
        import config.settings.base as base

        assert set(base.LDAP) == set(ldap_settings(environ.Env()))

    def test_off_validates_nothing(self, monkeypatch, clean_ldap_env):
        monkeypatch.setenv("LDAP_ENABLED", "false")
        monkeypatch.setenv("LDAP_PORT", "not-a-port")
        monkeypatch.setenv("LDAP_TIMEOUT", "soon")
        monkeypatch.setenv("LDAP_DEFAULT_ROLE", "admin")

        conf = ldap_settings(environ.Env())

        assert conf["ENABLED"] is False
        assert (conf["PORT"], conf["TIMEOUT"]) == (389, 3.0)  # unparsable: the defaults
        assert conf["DEFAULT_ROLE"] == "admin"  # not checked while AD is off

    def test_off_does_not_range_check_either(self, monkeypatch, clean_ldap_env):
        monkeypatch.setenv("LDAP_PORT", "0")
        monkeypatch.setenv("LDAP_TIMEOUT", "-4")

        conf = ldap_settings(environ.Env())

        assert (conf["ENABLED"], conf["PORT"], conf["TIMEOUT"]) == (False, 0, -4.0)

    def test_on_with_every_key_uses_the_values(self, monkeypatch, clean_ldap_env):
        enabled_env(
            monkeypatch, LDAP_PORT="3890", LDAP_TIMEOUT="1.5", LDAP_AUTO_CREATE="true", LDAP_DEFAULT_ROLE="reporter",
        )

        conf = ldap_settings(environ.Env())

        assert conf["ENABLED"] is True
        assert (conf["SERVER_IP"], conf["BIND_USER"], conf["BASE_DN"]) == (
            "ad.example.test", "CN=svc-test,DC=example,DC=test", "DC=example,DC=test",
        )
        assert conf["BIND_PASS"] == "Pw-Zq9-marker"
        assert (conf["PORT"], conf["TIMEOUT"]) == (3890, 1.5)
        assert (conf["AUTO_CREATE"], conf["DEFAULT_ROLE"]) == (True, "reporter")

    @pytest.mark.parametrize("missing", LDAP_REQUIRED)
    def test_on_without_a_required_key_stops_startup_naming_only_that_key(self, monkeypatch, clean_ldap_env, missing):
        enabled_env(monkeypatch)
        monkeypatch.delenv(missing)

        with pytest.raises(ImproperlyConfigured) as excinfo:
            ldap_settings(environ.Env())

        message = str(excinfo.value)
        assert missing in message
        assert all(key not in message for key in LDAP_REQUIRED if key != missing)
        assert all(value not in message for key, value in LDAP_VALUES.items() if key != "LDAP_ENABLED")

    @pytest.mark.parametrize("blank", ["", "   "])
    def test_a_blank_required_key_counts_as_missing(self, monkeypatch, clean_ldap_env, blank):
        enabled_env(monkeypatch, LDAP_BASE_DN=blank)
        with pytest.raises(ImproperlyConfigured, match="LDAP_BASE_DN"):
            ldap_settings(environ.Env())

    def test_every_missing_key_is_listed_at_once(self, monkeypatch, clean_ldap_env):
        monkeypatch.setenv("LDAP_ENABLED", "true")

        with pytest.raises(ImproperlyConfigured) as excinfo:
            ldap_settings(environ.Env())

        assert all(key in str(excinfo.value) for key in LDAP_REQUIRED)

    @pytest.mark.parametrize("port", ["0", "65536", "-1", "abc", "38.9"])
    def test_a_bad_port_is_refused_without_echoing_it(self, monkeypatch, clean_ldap_env, port):
        enabled_env(monkeypatch, LDAP_PORT=port)

        with pytest.raises(ImproperlyConfigured, match="LDAP_PORT") as excinfo:
            ldap_settings(environ.Env())

        assert str(excinfo.value) == "LDAP_PORT must be an integer between 1 and 65535"

    def test_blank_port_timeout_and_role_are_the_same_as_unset(self, monkeypatch, clean_ldap_env):
        enabled_env(monkeypatch, LDAP_PORT=" ", LDAP_TIMEOUT="", LDAP_DEFAULT_ROLE="")

        conf = ldap_settings(environ.Env())

        assert (conf["PORT"], conf["TIMEOUT"], conf["DEFAULT_ROLE"]) == (389, 3.0, "viewer")

    @pytest.mark.parametrize("port", ["1", "389", "636", "65535"])
    def test_ports_inside_the_range_pass(self, monkeypatch, clean_ldap_env, port):
        enabled_env(monkeypatch, LDAP_PORT=port)
        assert ldap_settings(environ.Env())["PORT"] == int(port)

    @pytest.mark.parametrize("timeout", ["0", "-1", "-0.5", "abc", "nan", "inf"])
    def test_a_bad_timeout_is_refused(self, monkeypatch, clean_ldap_env, timeout):
        enabled_env(monkeypatch, LDAP_TIMEOUT=timeout)
        with pytest.raises(ImproperlyConfigured, match="LDAP_TIMEOUT"):
            ldap_settings(environ.Env())

    def test_a_small_positive_timeout_passes(self, monkeypatch, clean_ldap_env):
        enabled_env(monkeypatch, LDAP_TIMEOUT="0.25")
        assert ldap_settings(environ.Env())["TIMEOUT"] == 0.25

    @pytest.mark.parametrize("role", ["admin", "reviewer", "root", "Viewer"])
    def test_only_viewer_and_reporter_may_be_the_default_role(self, monkeypatch, clean_ldap_env, role):
        enabled_env(monkeypatch, LDAP_DEFAULT_ROLE=role)
        with pytest.raises(ImproperlyConfigured, match="LDAP_DEFAULT_ROLE"):
            ldap_settings(environ.Env())

    @pytest.mark.parametrize("role", ["viewer", "reporter"])
    def test_the_allowed_default_roles_pass(self, monkeypatch, clean_ldap_env, role):
        enabled_env(monkeypatch, LDAP_DEFAULT_ROLE=role)
        assert ldap_settings(environ.Env())["DEFAULT_ROLE"] == role

    @pytest.mark.parametrize("password", ["$abc", "$", "$$x", "${HOME}", "a$b", " lead and trail "])
    def test_the_bind_password_is_kept_exactly_as_written(self, monkeypatch, clean_ldap_env, password):
        """django-environ would read a value starting with $ as a reference to another variable."""
        enabled_env(monkeypatch, LDAP_BIND_PASS=password)
        assert ldap_settings(environ.Env())["BIND_PASS"] == password

    def test_the_local_only_list_is_case_folded_and_trimmed(self, monkeypatch, clean_ldap_env):
        monkeypatch.setenv("LDAP_LOCAL_ONLY_ACCOUNTS", " Admin , ROOT ,, a1 ,  ")

        conf = ldap_settings(environ.Env())

        assert conf["LOCAL_ONLY_ACCOUNTS"] == frozenset({"admin", "root", "a1"})
        assert isinstance(conf["LOCAL_ONLY_ACCOUNTS"], frozenset)

    @pytest.mark.parametrize("value", ["", " ", ",", " , ,  "])
    def test_empty_entries_in_the_local_only_list_are_ignored(self, monkeypatch, clean_ldap_env, value):
        monkeypatch.setenv("LDAP_LOCAL_ONLY_ACCOUNTS", value)
        assert ldap_settings(environ.Env())["LOCAL_ONLY_ACCOUNTS"] == frozenset()

    def test_the_local_only_list_is_read_while_ad_is_off_too(self, monkeypatch, clean_ldap_env):
        monkeypatch.setenv("LDAP_LOCAL_ONLY_ACCOUNTS", "Admin")
        assert ldap_settings(environ.Env())["LOCAL_ONLY_ACCOUNTS"] == frozenset({"admin"})


def _prod_startup(extra_env):
    """Start production settings in a fresh interpreter (as the image build and gunicorn do); return the process.

    Every LDAP_* variable of this process is dropped first, so a developer's own settings cannot leak in.
    """
    backend_dir = Path(settings.BASE_DIR)
    env = {k: v for k, v in os.environ.items() if not k.startswith("LDAP_")}
    env.update({
        "DJANGO_SETTINGS_MODULE": "config.settings.prod",
        "DJANGO_SECRET_KEY": VALID_SECRET_KEY,
        **HOSTS,
        **extra_env,
    })
    return subprocess.run(
        [sys.executable, "-c", "import django; django.setup()"],
        cwd=backend_dir, env=env, capture_output=True, text=True, timeout=120,
    )


class TestLdapStartup:
    def test_the_image_build_environment_loads_production_settings_without_any_ldap_key(self):
        """The Dockerfile's collectstatic step has no LDAP_* variables; AD being off must not stop it."""
        result = _prod_startup({"COLLECTSTATIC_ONLY": "1"})
        assert result.returncode == 0, result.stderr

    def test_ad_on_with_a_missing_key_refuses_to_start_and_prints_no_value(self):
        given = {**LDAP_VALUES, "LDAP_SERVER_IP": ""}  # the server is the missing one

        result = _prod_startup(given)

        assert result.returncode != 0
        assert "ImproperlyConfigured" in result.stderr
        assert "LDAP_SERVER_IP" in result.stderr
        for key in ("LDAP_BIND_USER", "LDAP_BIND_PASS", "LDAP_BASE_DN"):
            assert LDAP_VALUES[key] not in result.stderr, f"the value of {key} leaked into the error output"

    def test_ad_on_with_every_key_starts(self):
        result = _prod_startup(LDAP_VALUES)
        assert result.returncode == 0, result.stderr


class TestImageContents:
    """The production image carries no test tools; the development compose file asks for them."""

    def test_the_production_requirements_have_no_test_tools(self):
        base = Path(settings.BASE_DIR)
        production = (base / "requirements.txt").read_text(encoding="utf-8").lower()
        assert not any(tool in production for tool in ("pytest", "ruff", "coverage"))

        development = (base / "requirements-dev.txt").read_text(encoding="utf-8")
        assert "-r requirements.txt" in development
        assert all(tool in development for tool in ("pytest", "pytest-django", "pytest-cov", "ruff"))

    def test_the_dockerfile_installs_them_only_when_asked(self):
        text = (Path(settings.BASE_DIR) / "Dockerfile").read_text(encoding="utf-8")
        assert re.search(r"^ARG INSTALL_DEV=0$", text, re.M)
        assert 'if [ "$INSTALL_DEV" = "1" ]; then pip install -r requirements-dev.txt; fi' in text
