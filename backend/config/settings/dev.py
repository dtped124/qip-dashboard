"""Development settings."""
from .base import *  # noqa: F401, F403
from .base import DATABASES, env

DEBUG = True
ALLOWED_HOSTS = ["*"]

# runserver handles every request in a new thread, so a persistent connection would never be reused
# and would only pile up open connections: connect per request in development.
DATABASES["default"]["CONN_MAX_AGE"] = 0

# Origins of the local Next.js dev server. Production lists its own origins explicitly in the
# environment (base.py defaults to none).
CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=[
    "http://localhost:3000",
    "http://127.0.0.1:3000",
])
# 開發時允許 Claude preview 的 autoPort 區段（任何 localhost 埠）
CORS_ALLOWED_ORIGIN_REGEXES = [
    r"^http://localhost:\d+$",
    r"^http://127\.0\.0\.1:\d+$",
]
CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=[
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:*",
    "http://127.0.0.1:*",
])
