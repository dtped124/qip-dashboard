FROM python:3.12-slim

# Production unless a compose file or platform says otherwise: management commands run through
# `docker exec` / `run` (which do not go through the entrypoint) must not fall back to development settings.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DJANGO_SETTINGS_MODULE=config.settings.prod

WORKDIR /app

# No compiler and no -dev packages: every dependency ships a prebuilt wheel for Linux (psycopg[binary]
# bundles libpq), so the build needs neither apt nor a mirror. A future dependency without a wheel makes
# this step fail loudly; install gcc and the headers it needs in this RUN, and purge them again in it.
COPY requirements.txt .
RUN pip install -r requirements.txt

# Test and lint tools (pytest, ruff) only when asked for: the development compose file builds with INSTALL_DEV=1,
# the production image (default 0) does not carry them.
ARG INSTALL_DEV=0
COPY requirements-dev.txt .
RUN if [ "$INSTALL_DEV" = "1" ]; then pip install -r requirements-dev.txt; fi

COPY . .

# The entrypoint lives outside /app: the development compose file bind-mounts ./backend over /app.
# sed strips CRs in case the file was checked out with Windows line endings (.gitattributes asks for LF).
COPY entrypoint.sh /usr/local/bin/qip-entrypoint
RUN sed -i 's/\r$//' /usr/local/bin/qip-entrypoint \
    && chmod +x /usr/local/bin/qip-entrypoint

# Collect the admin's static files into STATIC_ROOT; WhiteNoise serves them. The values below only get
# the settings module to import (no database is touched); nothing here ends up in the runtime environment.
# prod.py refuses placeholder secret keys; it accepts a key that starts with "build-only-" (and is at least 50
# characters long) only while COLLECTSTATIC_ONLY=1, so this key cannot be used by a running container by accident.
# A failure must stop the build, so there is no `|| true`.
RUN COLLECTSTATIC_ONLY=1 \
    DJANGO_SECRET_KEY=build-only-key-used-by-collectstatic-at-image-build-signs-nothing \
    DJANGO_ALLOWED_HOSTS=localhost \
    python manage.py collectstatic --noinput --settings=config.settings.prod

# Run as an unprivileged user. /app/media (uploaded workbooks) is the only place the app writes to;
# mount a persistent volume there, writable by uid 10001.
# The home directory must exist and belong to the user: gunicorn 25.1+ puts its control socket in
# $HOME/.gunicorn and logs "Control server error: Permission denied: '/home/app'" at every start without it.
RUN groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --create-home --shell /usr/sbin/nologin app \
    && mkdir -p /app/media \
    && chown app:app /app/media
USER app

EXPOSE 8000

# No CMD: with no arguments the entrypoint starts gunicorn. `docker run <image> <command>` runs <command>
# (after the bootstrap) instead.
ENTRYPOINT ["qip-entrypoint"]
