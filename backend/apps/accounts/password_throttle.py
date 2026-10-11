"""
Guess limit for ``POST /api/auth/change-password``.

The endpoint asks for the current password, so a stolen session cookie would turn it into a free
password-guessing oracle (the login lockout in lockout.py never sees these guesses). Every call is
counted per user id in Django's cache:

* calls 1..``PASSWORD_CHANGE_FAILURE_LIMIT`` are processed as usual (a wrong current password is a 400);
* the next call is refused with 429 ``too_many_attempts`` WITHOUT looking at the body, so the right
  password is refused too, until ``PASSWORD_CHANGE_COOLOFF_MINUTES`` have passed;
* refused calls do not extend the wait: the window is re-armed once, by the last call that was let in;
* proving the current password (see ``ChangePasswordSerializer.current_password_verified``) forgets the
  count, whether or not the new password was accepted; so does an administrator's password reset
  (the user must change the password at the next sign-in, which an old wait must not block).

The count is taken *before* the password is checked and with an atomic increment, so parallel requests
cannot all slip under the limit while the first of them is still hashing. With the LocMem cache
(``REDIS_URL`` empty, see settings) each worker keeps its own count.

Fail-open: if the cache cannot be reached (Redis down, timeout) the limit steps aside - a warning is
logged and the call goes through. A guess limit that locked every user out of the forced password change
whenever Redis hiccups would do more harm than the limit prevents (the caller already holds a valid session).
"""
from __future__ import annotations

import logging

from django.conf import settings
from django.core.cache import cache
from rest_framework import exceptions

logger = logging.getLogger(__name__)

TOO_MANY_CODE = "too_many_attempts"
TOO_MANY_STATUS = 429


def too_many_message() -> str:
    """The text a refused caller sees; the wait comes from PASSWORD_CHANGE_COOLOFF_MINUTES."""
    return f"嘗試次數過多，請 {settings.PASSWORD_CHANGE_COOLOFF_MINUTES} 分鐘後再試"


class TooManyPasswordAttempts(exceptions.APIException):
    """429 ``too_many_attempts``; the exception handler adds ``code`` to the ``detail`` body."""

    status_code = TOO_MANY_STATUS
    default_code = TOO_MANY_CODE
    default_detail = "嘗試次數過多，請稍後再試"  # only a fallback: __init__ builds the real text

    def __init__(self, detail=None, code=None):
        super().__init__(detail if detail is not None else too_many_message(), code)


def cache_key(user) -> str:
    """Where ``user``'s attempt count lives (tests inspect or clear it)."""
    return f"accounts:change-password-attempts:{user.pk}"


def _count_attempt(key: str, window: int, limit: int) -> int:
    """Add one to the count under ``key`` and return it (may raise whatever the cache raises)."""
    cache.add(key, 0, window)  # the first call of a window starts its clock; later calls leave it alone
    try:
        count = cache.incr(key)
    except ValueError:  # the window ended between add() and incr()
        count = 1
        cache.set(key, count, window)
    if count == limit:
        # The last call that is let in. If it fails, the wait starts now and lasts a full cool-off.
        cache.set(key, count, window)
    return count


def register_attempt(user) -> None:
    """Count one call; raise ``TooManyPasswordAttempts`` if it is over the limit."""
    limit = settings.PASSWORD_CHANGE_FAILURE_LIMIT
    window = settings.PASSWORD_CHANGE_COOLOFF_MINUTES * 60
    try:
        count = _count_attempt(cache_key(user), window, limit)
    except Exception:  # noqa: BLE001 - Redis down, timeouts, ...: fail open, see the module docstring
        logger.warning(
            "change-password attempt limit not applied to user %s: cache unavailable", user.pk, exc_info=True
        )
        return
    if count > limit:
        raise TooManyPasswordAttempts()


def reset(user) -> None:
    """Forget the count of ``user`` (the current password was proven, or an administrator reset it)."""
    try:
        cache.delete(cache_key(user))
    except Exception:  # noqa: BLE001 - fail open, see the module docstring
        logger.warning(
            "change-password attempt count of user %s not cleared: cache unavailable", user.pk, exc_info=True
        )
