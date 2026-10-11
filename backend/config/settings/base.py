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

# Database — PostgreSQL with schema isolation
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env("DB_NAME", default="qm_center"),
        "USER": env("DB_USER", default="qm_admin"),
        "PASSWORD": env("DB_PASSWORD", default=""),
        "HOST": env("DB_HOST", default="localhost"),
        "PORT": env("DB_PORT", default="5432"),
        "OPTIONS": {
            "options": f"-c search_path={env('DB_SCHEMA', default='qip')},public",
        },
    }
}

# Cache — Redis
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": env("REDIS_URL", default="redis://localhost:6379/1"),
    }
}

# Celery
CELERY_BROKER_URL = env("CELERY_BROKER_URL", default="redis://localhost:6379/2")
CELERY_RESULT_BACKEND = env("CELERY_RESULT_BACKEND", default="redis://localhost:6379/3")
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TIMEZONE = "Asia/Taipei"

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

# CORS — allow Next.js frontend
CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=[
    "http://localhost:3000",
    "http://127.0.0.1:3000",
])
# 開發時允許 Claude preview 的 autoPort 區段
CORS_ALLOWED_ORIGIN_REGEXES = [
    r"^http://localhost:\d+$",
    r"^http://127\.0\.0\.1:\d+$",
]
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
CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=[
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:*",
    "http://127.0.0.1:*",
])

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
