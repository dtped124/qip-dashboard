"""Production settings (container / cloud): everything that varies per deployment comes from the environment."""
from django.core.exceptions import ImproperlyConfigured

from . import base as _base
from .base import *  # noqa: F401, F403
from .base import env

DEBUG = False

# ── Secret key ───────────────────────────────────────────────────────────────
# The secret key signs sessions and CSRF tokens; whoever knows it can forge both. base.py reads it for every
# environment. Production reads it again and refuses to start on an empty value, a short one, or one that is
# still a stand-in from a template, a compose file or a Dockerfile of this repository.
# (Helper names start with an underscore: Django turns every upper-case module attribute into a setting.)
_MIN_SECRET_KEY_LENGTH = 50
# The Dockerfile runs collectstatic with a throw-away key that starts with this prefix. It is accepted only while
# COLLECTSTATIC_ONLY=1, which that one RUN line sets inline and which is not part of the image environment.
_BUILD_ONLY_KEY_PREFIX = "build-only-"
# Stand-ins used by this repository (backend/.env.example, docker-compose.yml, the former Dockerfile) and the
# prefix of the keys `django-admin startproject` generates. Compared case-insensitively, as substrings; each marker
# is long enough that a random key does not contain one by chance.
_PLACEHOLDER_KEY_MARKERS = (
    "change-me",
    "changeme",
    "dev-secret-key",
    "collectstatic-only",
    "django-insecure-",
    "your-secret-key",
    _BUILD_ONLY_KEY_PREFIX,
)


def check_secret_key(key, *, collectstatic_only=False):
    """Return ``key`` if production may use it, else raise ImproperlyConfigured. The message never repeats the key."""
    if not key.strip():
        raise ImproperlyConfigured(
            f"DJANGO_SECRET_KEY is empty: production needs a random string of at least {_MIN_SECRET_KEY_LENGTH} "
            "characters, e.g. python -c 'import secrets; print(secrets.token_urlsafe(64))'"
        )
    if len(key) < _MIN_SECRET_KEY_LENGTH:
        raise ImproperlyConfigured(
            f"DJANGO_SECRET_KEY has {len(key)} characters; production needs at least {_MIN_SECRET_KEY_LENGTH}"
        )
    if collectstatic_only and key.startswith(_BUILD_ONLY_KEY_PREFIX):
        return key
    lowered = key.lower()
    for marker in _PLACEHOLDER_KEY_MARKERS:
        if marker in lowered:
            raise ImproperlyConfigured(
                f"DJANGO_SECRET_KEY looks like a placeholder (it contains {marker!r}): "
                "generate a random one for this deployment"
            )
    return key


SECRET_KEY = check_secret_key(
    env("DJANGO_SECRET_KEY", default=""),
    collectstatic_only=env.bool("COLLECTSTATIC_ONLY", default=False),
)

# Hosts are required. base.py falls back to localhost for development; production must name its own.
# Besides the public host name, list every Host header Next may forward (Next sets X-Forwarded-Host to the
# Host it received) and the one the container healthcheck uses (localhost).
ALLOWED_HOSTS = [host.strip() for host in env.list("DJANGO_ALLOWED_HOSTS", default=[]) if host.strip()]
if not ALLOWED_HOSTS:
    raise ImproperlyConfigured(
        "DJANGO_ALLOWED_HOSTS is required in production: comma separated host names, "
        "e.g. qip.example.org,localhost"
    )

# TLS ends at the platform edge. The edge must send X-Forwarded-Proto: https and overwrite any value the
# client sent: Next's /api proxy passes the header through unchanged and Django reads its first comma
# separated value. The public host comes from X-Forwarded-Host (USE_X_FORWARDED_HOST in base.py; switch
# it off with the environment variable of the same name when no proxy sets that header).
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# HSTS. Leave at 0 until https works end to end, then raise it in steps (300, 86400, 31536000): browsers
# remember the value, so a mistake cannot be taken back for that long. Django adds the header only to the
# responses it produces (API, admin). The HTML comes from Next, so HSTS must also be set at the platform
# edge or through NEXT_HSTS_SECONDS (a build argument of Dockerfile.web, applied in next.config.mjs).
SECURE_HSTS_SECONDS = env.int("SECURE_HSTS_SECONDS", default=0)

# Redirect plain http to https. Off by default: the edge normally does it, and turning it on before the
# edge sends a correct X-Forwarded-Proto makes every request redirect forever. /healthz is exempt because
# container probes use plain http.
SECURE_SSL_REDIRECT = env.bool("SECURE_SSL_REDIRECT", default=False)
SECURE_REDIRECT_EXEMPT = [r"^healthz$"]

# Cookies travel over https only. Switch both off only to try the production stack over plain http on a
# workstation (docs/DEPLOYMENT.md).
SESSION_COOKIE_SECURE = env.bool("SESSION_COOKIE_SECURE", default=True)
CSRF_COOKIE_SECURE = env.bool("CSRF_COOKIE_SECURE", default=True)

SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"

# Static files (the admin's CSS and JS) are served by WhiteNoise from STATIC_ROOT, which collectstatic fills
# while the image is built. Only production loads it: development uses runserver's own static handling.
MIDDLEWARE = list(_base.MIDDLEWARE)
MIDDLEWARE.insert(
    MIDDLEWARE.index("django.middleware.security.SecurityMiddleware") + 1,
    "whitenoise.middleware.WhiteNoiseMiddleware",
)
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}

# JSON only: no browsable API (its HTML form is not something to expose on the internet).
REST_FRAMEWORK = {
    **_base.REST_FRAMEWORK,
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
}

# Everything to the console (stdout/stderr), where the platform collects logs. With DEBUG off Django would
# otherwise only e-mail errors to ADMINS, so a 500 would leave no trace at all.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "console": {"format": "%(asctime)s %(levelname)s %(name)s: %(message)s"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "console"},
    },
    "root": {"handlers": ["console"], "level": "INFO"},
    "loggers": {
        # 4xx/5xx responses, with the traceback of a 500
        "django.request": {"handlers": ["console"], "level": "WARNING", "propagate": False},
        # django-axes: failed logins and lockouts
        "axes": {"handlers": ["console"], "level": "INFO", "propagate": False},
    },
}
