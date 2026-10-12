"""
Server-side cache of ``GET /api/v1/dashboard/`` (``dashboard_bulk`` in views.py).

``dashboard_bulk`` rebuilds every indicator of a campus from scratch on each request: all months of DataPoint, Alert,
YearlySummary and TCPIBenchmark. The answer does not depend on who asks (the role check runs before the cache is
consulted), only on the query parameters and on the database, so one finished payload serves every reader.

Keys (Django's KEY_PREFIX and VERSION wrap them as usual)

    dashboard:version                                   an integer that never expires
    dashboard:v<version>:<campus>:<category>:<search>   the payload (a dict), gone after DASHBOARD_CACHE_TTL seconds

Invalidation is by version number. Every write that can change the dashboard calls ``bump_dashboard_cache()``, which
adds 1 to ``dashboard:version``: the payloads of older versions are never asked for again and age out on their own.

* Call it AFTER the write is committed. A reader that sees the new version before the commit would compute from the
  old rows and file the result under the new version.
* A reader reads the version once, BEFORE it computes, and files its result under that same version (the ``version``
  argument below). If a write lands while it computes, the stale result goes to a key nobody asks for any more.
* The counter is stored without an expiry. If it ever expired it would restart at 1 and bring back payloads that were
  filed under version 1 before the bumps.

Fail-open: any cache error (Redis down, timeout, ...) is logged as a warning and treated as "not cached". Reads miss,
writes are skipped, the dashboard is computed as it was before this cache existed; nothing in this module raises.
The price is on the write side: a bump that fails leaves the payloads of the old version readable until their TTL ends.

``DASHBOARD_CACHE_ENABLED=false`` stops payloads from being read or stored. ``bump_dashboard_cache()`` ignores the
switch on purpose, so the counter keeps up with the data and switching the cache back on cannot revive payloads that
are older than the changes made in between.

The switch defaults to on only when REDIS_URL is set (``dashboard_cache_settings`` in config/settings/base.py). With the
per-process memory cache every process holds its own copy, so a bump made in another process - a management command,
another gunicorn worker - never reaches the copy the web process serves (even with one worker, because the commands
always run in a process of their own).
"""
from __future__ import annotations

import logging
import re
from collections.abc import Sequence
from typing import Any

from django.conf import settings
from django.core.cache import cache

logger = logging.getLogger(__name__)

VERSION_KEY = "dashboard:version"
KEY_PREFIX = "dashboard"
# Django warns (CacheKeyWarning) about keys over 250 characters once it has put its prefix and version in front, so
# stay well below. A request that needs a longer key is not a real dashboard request: it is computed and not stored,
# which keeps a client from parking long arbitrary text in the cache.
MAX_KEY_LENGTH = 200

# Passed as ``version`` when the caller has not read the version itself.
_UNSET: Any = object()
# ":" separates the parts and "%" is the escape character, so both must be escaped for different parts never to
# produce the same key; control characters and spaces are what Django warns about.
_UNSAFE_CHARS = re.compile(r"[%:\x00-\x20\x7f]")


def _escape(part: str) -> str:
    """Make one key part safe: ``%XX`` for the characters above, everything else (the campus names) stays readable."""
    return _UNSAFE_CHARS.sub(lambda m: f"%{ord(m.group()):02X}", part)


def _enabled() -> bool:
    return bool(settings.DASHBOARD_CACHE_ENABLED)


def dashboard_cache_version() -> int | None:
    """The current version, or None when the cache is switched off or cannot be reached (callers then skip it)."""
    if not _enabled():
        return None
    try:
        return int(cache.get_or_set(VERSION_KEY, 1, timeout=None))
    except Exception:  # noqa: BLE001 - Redis down, timeouts, ...: fail open, see the module docstring
        logger.warning("dashboard cache version unreadable: the dashboard is computed without the cache", exc_info=True)
        return None


def _data_key(key_parts: Sequence[str], version: int | None) -> str | None:
    """The key of one payload, or None when this request must not use the cache."""
    if not _enabled():
        return None
    if version is _UNSET:
        version = dashboard_cache_version()
    if version is None:
        return None
    key = ":".join((KEY_PREFIX, f"v{version}", *(_escape(str(part)) for part in key_parts)))
    return key if len(key) <= MAX_KEY_LENGTH else None


def get_dashboard_payload(key_parts: Sequence[str], *, version: int | None = _UNSET) -> dict | None:
    """The cached payload for ``key_parts`` (campus, category, search), or None: not cached, or no cache to ask.

    Pass ``version`` (from ``dashboard_cache_version()``) when the same caller will also call
    ``set_dashboard_payload``: both calls then use the version read before the payload was computed.
    """
    key = _data_key(key_parts, version)
    if key is None:
        return None
    try:
        payload = cache.get(key)
    except Exception:  # noqa: BLE001 - fail open
        logger.warning("dashboard cache read failed: the dashboard is computed without the cache", exc_info=True)
        return None
    return payload if isinstance(payload, dict) else None


def set_dashboard_payload(key_parts: Sequence[str], payload: dict, *, version: int | None = _UNSET) -> bool:
    """Store ``payload`` for ``key_parts`` for DASHBOARD_CACHE_TTL seconds; False when it was not stored."""
    key = _data_key(key_parts, version)
    if key is None:
        return False
    try:
        cache.set(key, payload, settings.DASHBOARD_CACHE_TTL)
    except Exception:  # noqa: BLE001 - fail open
        logger.warning("dashboard cache write failed: the payload is not cached", exc_info=True)
        return False
    return True


def bump_dashboard_cache() -> None:
    """Invalidate every cached payload: call it after a committed write that can change the dashboard."""
    try:
        cache.add(VERSION_KEY, 1, timeout=None)  # incr() needs the key to exist; add() leaves an existing one alone
        cache.incr(VERSION_KEY)
    except Exception:  # noqa: BLE001 - fail open
        logger.warning(
            "dashboard cache not invalidated: payloads of the old version stay readable until they expire",
            exc_info=True,
        )
