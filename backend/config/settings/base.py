"""
Django base settings for QIP Dashboard.
品管中心 QIP 監測指標系統 — 共用設定
"""
import os
from datetime import timedelta
from pathlib import Path

import environ
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent.parent

env = environ.Env(
    DJANGO_DEBUG=(bool, False),
    DJANGO_ALLOWED_HOSTS=(list, ["localhost", "127.0.0.1"]),
)
environ.Env.read_env(BASE_DIR / ".env")

SECRET_KEY = env("DJANGO_SECRET_KEY")
DEBUG = env("DJANGO_DEBUG")
ALLOWED_HOSTS = env("DJANGO_ALLOWED_HOSTS")

# The Next.js /api proxy replaces Host with Django's own host and puts the
# browser's host in X-Forwarded-Host. Trust it so ALLOWED_HOSTS / CSRF origin
# checks compare against what the browser actually used. Only Next (or the
# platform's load balancer) should be able to reach Django directly.
USE_X_FORWARDED_HOST = env.bool("USE_X_FORWARDED_HOST", default=True)

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Third party
    "corsheaders",
    "rest_framework",
    "axes",
    # Local apps
    "apps.core",
    "apps.accounts",
    "apps.entry",
    "apps.indicators",
    "apps.imports",
    "apps.analysis",
    "apps.davinci",
]

AUTH_USER_MODEL = "accounts.User"

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    # django-axes: must be last; turns a flagged lockout into the AXES_LOCKOUT_CALLABLE response.
    "axes.middleware.AxesMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# Database — PostgreSQL with schema isolation.
# DATABASE_URL (postgres://user:password@host:5432/name?sslmode=require) wins when set, e.g. the string a
# managed database hands out; otherwise the DB_* variables are used. DB_SCHEMA is the schema the tables
# live in; `manage.py bootstrap` creates it when missing.
DB_SCHEMA = env("DB_SCHEMA", default="qip")


def database_config(env, schema):
    """Return DATABASES["default"] built from the environment.

    The schema's search_path is merged into libpq's ``options`` string next to whatever OPTIONS the URL
    brought (sslmode, ...), so a managed database's TLS settings survive.
    """
    if env("DATABASE_URL", default=""):
        config = env.db("DATABASE_URL")
        if "postgresql" not in config.get("ENGINE", ""):
            raise ImproperlyConfigured("DATABASE_URL must be a postgres:// URL")
    else:
        config = {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": env("DB_NAME", default="qm_center"),
            "USER": env("DB_USER", default="qm_admin"),
            "PASSWORD": env("DB_PASSWORD", default=""),
            "HOST": env("DB_HOST", default="localhost"),
            "PORT": env("DB_PORT", default="5432"),
        }

    options = dict(config.get("OPTIONS", {}))
    search_path = f"-c search_path={schema},public"
    options["options"] = f"{options['options']} {search_path}" if options.get("options") else search_path
    # Give up on an unreachable server after this many seconds (libpq connect_timeout) instead of waiting for the
    # operating system's TCP timeout, which is about two minutes per attempt: `manage.py bootstrap` retries
    # while the database is still starting. 0 waits for ever. A connect_timeout inside DATABASE_URL wins.
    options.setdefault("connect_timeout", env.int("DB_CONNECT_TIMEOUT", default=5))
    config["OPTIONS"] = options

    # Keep a connection for this many seconds instead of reconnecting per request; the health check
    # makes Django test a reused connection before the request uses it (a restarted or failed-over
    # database is noticed at once instead of surfacing as a 500).
    config["CONN_MAX_AGE"] = env.int("DB_CONN_MAX_AGE", default=60)
    config["CONN_HEALTH_CHECKS"] = True
    return config


DATABASES = {"default": database_config(env, DB_SCHEMA)}

# Cache — Redis when REDIS_URL is set. Empty or unset: per-process memory (LocMem), which is fine for one
# process (and for tests) but keeps separate counters per worker, so give a multi-worker deployment a Redis.
# Today the cache only holds the change-password attempt counters (apps/accounts/password_throttle.py).
REDIS_URL = env("REDIS_URL", default="")
if REDIS_URL:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.redis.RedisCache",
            "LOCATION": REDIS_URL,
        }
    }
else:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "qip-default",
        }
    }

# Internationalization
LANGUAGE_CODE = "zh-hant"
TIME_ZONE = "Asia/Taipei"
USE_I18N = True
USE_TZ = True

# Static files
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# Media files (uploaded Excel files)
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# REST Framework
REST_FRAMEWORK = {
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 100,
    "DATETIME_FORMAT": "%Y-%m-%dT%H:%M:%S%z",
    # Session cookie only (no HTTP Basic). QipSessionAuthentication is DRF's
    # SessionAuthentication plus a JSON `csrf_failed` code on CSRF failures.
    "DEFAULT_AUTHENTICATION_CLASSES": ["apps.accounts.authentication.QipSessionAuthentication"],
    # Deny by default: a view must opt out explicitly (see accounts/permissions.py).
    "DEFAULT_PERMISSION_CLASSES": ["apps.accounts.permissions.IsAuthenticatedPasswordOK"],
    "EXCEPTION_HANDLER": "apps.accounts.exceptions.exception_handler",
}

# CORS — the browser only talks to Next.js, which proxies /api/* to Django (same origin), so by default
# no other origin is allowed. List extra origins in CORS_ALLOWED_ORIGINS (comma separated); the localhost
# defaults for local development live in dev.py.
CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=[])
CORS_ALLOW_CREDENTIALS = True
# 讓前端 JS 能讀到 Content-Disposition（匯出檔案下載要從 header 取檔名）
CORS_EXPOSE_HEADERS = ["Content-Disposition"]

# Session & CSRF（供填報系統跨域 cookie 使用）
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_HTTPONLY = True
# Idle timeout: a login ends after this many seconds without a request (default 8 hours).
# SESSION_SAVE_EVERY_REQUEST renews the session and its cookie on every request, so the clock
# restarts with each use; without it the age would run from sign-in. The cost is one session
# row write per authenticated request.
SESSION_COOKIE_AGE = env.int("SESSION_COOKIE_AGE", default=8 * 3600)
SESSION_SAVE_EVERY_REQUEST = True
CSRF_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_HTTPONLY = False   # 前端需讀取 CSRF token
# JSON 403 {"detail", "code": "csrf_failed"} instead of Django's HTML page.
CSRF_FAILURE_VIEW = "apps.accounts.views.csrf_failure"
# Origins (scheme included, e.g. https://qip.example.org) allowed to POST although they differ from the host
# Django sees. Behind the Next proxy the public origin is X-Forwarded-Host, so it normally matches without
# being listed; list it anyway when the platform rewrites Host or the scheme. Empty by default.
CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=[])

# ── Login protection and password policy ────────────────────────────

AUTHENTICATION_BACKENDS = [
    # Must be first: it refuses a locked-out login before any real backend checks the password.
    "axes.backends.AxesStandaloneBackend",
    "django.contrib.auth.backends.ModelBackend",
]

# django-axes (8.3.1): after AXES_FAILURE_LIMIT failed logins an account is locked for
# AXES_COOLOFF_TIME. Both /api/auth/login and the Django admin login are covered.
#
# WARNING - what this lock is and is not:
# * It stops password GUESSING, not denial of service. Browsers reach Django through the Next.js
#   /api proxy, so REMOTE_ADDR is the same for every visitor and the lock works per account in
#   practice: anyone who knows an employee_id (the admin's included) can lock that account for
#   AXES_COOLOFF_TIME with a few wrong passwords, and again each time it expires. Attempts made
#   while locked do not extend the lock (AXES_RESET_COOL_OFF_ON_FAILURE_DURING_LOCKOUT), so the
#   attacker must start over once per cool-off period. An administrator can lift a lock at once:
#   reset the password, or `manage.py axes_reset_username <employee_id>`.
# * The AXES_IPWARE_* settings below only work with django-ipware, which this image does NOT
#   install: they are ignored and axes uses REMOTE_ADDR. A package-free alternative is
#   AXES_CLIENT_IP_CALLABLE (a function that returns the client address).
# * A real per-IP throttle has to sit at the platform edge (load balancer / WAF rate limit);
#   see the deployment phase.
AXES_FAILURE_LIMIT = env.int("AXES_FAILURE_LIMIT", default=5)
if AXES_FAILURE_LIMIT < 1:
    # axes locks once failures >= limit: 0 would lock every account before its first attempt.
    raise ImproperlyConfigured("AXES_FAILURE_LIMIT must be at least 1")
_axes_cooloff_minutes = env.int("AXES_COOLOFF_MINUTES", default=5)
if _axes_cooloff_minutes < 1:
    # axes would read 0 as "failures expire at once": the lock could never take effect.
    raise ImproperlyConfigured("AXES_COOLOFF_MINUTES must be at least 1")
AXES_COOLOFF_TIME = timedelta(minutes=_axes_cooloff_minutes)
# Failures are counted per (username, IP address); see the warning above for what the address is worth.
AXES_LOCKOUT_PARAMETERS = [["username", "ip_address"]]
# An attempt made while the account is locked must not push the end of the lock further out.
# (The API login already turns locked accounts away before authenticating; this covers the
# Django admin login and any other authenticate() caller.)
AXES_RESET_COOL_OFF_ON_FAILURE_DURING_LOCKOUT = False
# A successful login clears the earlier failures of that account.
AXES_RESET_ON_SUCCESS = True
# Dotted paths (apps/accounts/lockout.py): the account name a failure counts against
# (API body: employee_id, Django admin form: username), and the JSON 429 a locked-out
# request receives.
AXES_USERNAME_CALLABLE = "apps.accounts.lockout.axes_username"
AXES_LOCKOUT_CALLABLE = "apps.accounts.lockout.axes_lockout_response"
# How axes finds the client address. INERT here: AXES_IPWARE_* is read by django-ipware, which this
# image does not install, so axes uses REMOTE_ADDR whatever these say. To make them count: install
# django-ipware, make every proxy in front of Django pass X-Forwarded-For, set AXES_IPWARE_PROXY_COUNT
# to the number of those proxies and AXES_IPWARE_META_PRECEDENCE_ORDER=HTTP_X_FORWARDED_FOR,REMOTE_ADDR.
# The default trusts REMOTE_ADDR only: X-Forwarded-For is client-controlled unless every proxy sets it,
# and a spoofed value would give each attempt a fresh counter and defeat the lock.
AXES_IPWARE_PROXY_COUNT = env.int("AXES_IPWARE_PROXY_COUNT", default=0)
AXES_IPWARE_META_PRECEDENCE_ORDER = env.list("AXES_IPWARE_META_PRECEDENCE_ORDER", default=["REMOTE_ADDR"])

# POST /api/auth/change-password asks for the current password, so it needs its own guess limit (axes only
# watches the login). A signed-in user may call it PASSWORD_CHANGE_FAILURE_LIMIT times in a row without proving
# the current password; the next call, right password or not, is refused with 429 ``too_many_attempts`` until
# PASSWORD_CHANGE_COOLOFF_MINUTES have passed. Counted per user id in the cache (apps/accounts/password_throttle.py).
PASSWORD_CHANGE_FAILURE_LIMIT = env.int("PASSWORD_CHANGE_FAILURE_LIMIT", default=5)
if PASSWORD_CHANGE_FAILURE_LIMIT < 1:
    raise ImproperlyConfigured("PASSWORD_CHANGE_FAILURE_LIMIT must be at least 1")
PASSWORD_CHANGE_COOLOFF_MINUTES = env.int("PASSWORD_CHANGE_COOLOFF_MINUTES", default=5)
if PASSWORD_CHANGE_COOLOFF_MINUTES < 1:
    # A zero window would expire every counter at once and the limit could never trigger.
    raise ImproperlyConfigured("PASSWORD_CHANGE_COOLOFF_MINUTES must be at least 1")

# Applies to the API (change-password, account creation, seed_admin) and the Django admin.
AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
        # first_name/last_name are never filled in on this model; these are its identifying fields.
        "OPTIONS": {"user_attributes": ("employee_id", "full_name", "email")},
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 10},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
