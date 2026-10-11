#!/bin/sh
# Container entrypoint (installed as /usr/local/bin/qip-entrypoint by the Dockerfile).
#
#   1. `manage.py bootstrap` (wait for the database, create the schema, migrate, seed) unless RUN_BOOTSTRAP is
#      0, false or no (any case)
#   2. start whatever was asked for: `docker run image <command>` runs <command>; with no command,
#      gunicorn serves the app on $PORT
#
# Settings: GUNICORN_WORKERS (3), GUNICORN_TIMEOUT (120 s: imports and exports are slow), PORT (8000).
set -eu

# Production unless the caller says otherwise (the development compose file sets config.settings.dev).
DJANGO_SETTINGS_MODULE="${DJANGO_SETTINGS_MODULE:-config.settings.prod}"
export DJANGO_SETTINGS_MODULE

# Only an explicit "off" skips the bootstrap. Any other value - unset, empty, "1", and also a guess such as
# "true" or "yes" - runs it, so a mistyped switch cannot start the server on an empty or half-migrated database.
case "${RUN_BOOTSTRAP:-1}" in
    0 | [Ff][Aa][Ll][Ss][Ee] | [Nn][Oo]) ;;
    *) python manage.py bootstrap ;;
esac

if [ "$#" -gt 0 ]; then
    exec "$@"
fi

exec gunicorn config.wsgi:application \
    --bind "0.0.0.0:${PORT:-8000}" \
    --workers "${GUNICORN_WORKERS:-3}" \
    --timeout "${GUNICORN_TIMEOUT:-120}" \
    --access-logfile -
