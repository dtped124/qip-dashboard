"""
Login lockout (django-axes) glue for the QIP API.

axes counts failed logins per (username, IP address) and refuses further attempts
for ``AXES_COOLOFF_TIME`` once ``AXES_FAILURE_LIMIT`` is reached (see the AXES_*
block in ``config/settings/base.py``). The project-specific pieces live here:

* ``axes_username``         which account a failed login counts against
                            (``settings.AXES_USERNAME_CALLABLE``)
* ``axes_lockout_response`` what a locked-out caller gets from ``AxesMiddleware``
                            (``settings.AXES_LOCKOUT_CALLABLE``)
* ``AccountLocked``         the same answer, raised from inside DRF code
* ``is_locked_out`` / ``unlock_account``  ask axes whether an account is locked / forget its failures
"""
from __future__ import annotations

import json
import math
from collections.abc import Iterator, Mapping
from typing import Any

from axes.handlers.proxy import AxesProxyHandler
from axes.helpers import get_cool_off
from django.http import HttpRequest, JsonResponse
from rest_framework import exceptions

LOCKED_CODE = "locked"
LOCKED_STATUS = 429

# Keys that carry the account name: the API login body (and the credentials built
# from it) use ``employee_id``; the Django admin login form posts ``username``.
_USERNAME_KEYS = ("employee_id", "username")
# axes stores the name in AccessAttempt.username, a CharField(max_length=255).
_MAX_USERNAME_LENGTH = 255


def lockout_message() -> str:
    """The text locked-out callers see; the wait comes from AXES_COOLOFF_TIME."""
    cool_off = get_cool_off()
    if not cool_off:
        return "登入失敗次數過多，帳號已被鎖定，請聯絡系統管理員"
    minutes = max(1, math.ceil(cool_off.total_seconds() / 60))
    return f"登入失敗次數過多，請 {minutes} 分鐘後再試"


class AccountLocked(exceptions.APIException):
    """429 ``locked``: too many failed logins. Same body as ``axes_lockout_response``."""

    status_code = LOCKED_STATUS
    default_code = LOCKED_CODE
    default_detail = "登入失敗次數過多，請稍後再試"  # only a fallback: __init__ builds the real text

    def __init__(self, detail=None, code=None):
        super().__init__(detail if detail is not None else lockout_message(), code)


def axes_lockout_response(request, response=None, credentials=None) -> JsonResponse:
    """``settings.AXES_LOCKOUT_CALLABLE``: JSON 429 in the API's ``{detail, code}`` shape.

    axes calls this with ``(request, response, credentials)`` and, if that raises a
    TypeError, again with ``(request, credentials)``; the defaults accept both.
    """
    return JsonResponse({"detail": lockout_message(), "code": LOCKED_CODE}, status=LOCKED_STATUS)


# ── Which account does a failed login count against? ──────────────


def _as_username(value: Any) -> str | None:
    # DRF's CharField turns numbers into strings too, so a numeric employee_id is a valid name.
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        return None
    return str(value).strip()[:_MAX_USERNAME_LENGTH] or None


def _json_body(request) -> Mapping | None:
    try:
        parsed = json.loads(request.body)
    except Exception:  # noqa: BLE001 - stream already consumed by DRF, too large, not JSON, no .body at all
        return None
    return parsed if isinstance(parsed, dict) else None


def _request_payloads(request) -> Iterator[Mapping]:
    data = getattr(request, "data", None)  # a DRF Request: parsed JSON or form
    if isinstance(data, Mapping):
        yield data
    post = getattr(request, "POST", None)  # a form post, e.g. the Django admin login
    if post:
        yield post
    body = _json_body(request)  # a plain HttpRequest with a JSON body
    if body:
        yield body


def axes_username(request: HttpRequest, credentials: Mapping | None = None) -> str | None:
    """``settings.AXES_USERNAME_CALLABLE``: the account name a login attempt counts against.

    The ``credentials`` axes passes in come first, because they hold exactly what
    ``authenticate()`` saw: ``employee_id`` for the API login, ``username`` for the
    Django admin form. Only without them does it read the request itself.

    The name is case-folded: AD matches ``sAMAccountName`` case-insensitively, so ``a123`` and ``A123`` are the
    same person to AD and must share one failure counter, or typing the other case would double the guesses.
    """
    for key in _USERNAME_KEYS:
        name = _as_username((credentials or {}).get(key))
        if name:
            return name.casefold()
    # Fallback for callers that hand axes no credentials. No flow in this project does today:
    # authenticate(), the login signals and AxesMiddleware (via request.axes_credentials) all pass
    # them. It is here for axes_dispatch / AxesProxyHandler.is_allowed(request) should anyone use them.
    for payload in _request_payloads(request):
        for key in _USERNAME_KEYS:
            name = _as_username(payload.get(key))
            if name:
                return name.casefold()
    return None


# ── Asking axes ──────────────────────────────────────────────────


def is_locked_out(http_request: HttpRequest, employee_id: str) -> bool:
    """True if axes has already locked this account for the caller's address.

    It only compares the recorded failure count with the limit: the IP whitelist / blacklist
    settings are ignored (``AxesProxyHandler.is_allowed`` would honour them).
    ``http_request`` must be the Django ``HttpRequest`` (``drf_request._request``),
    the object ``AxesMiddleware`` inspects.
    """
    return AxesProxyHandler.is_locked(http_request, credentials={"employee_id": employee_id})


def unlock_account(employee_id: str) -> int:
    """Forget every failed login recorded for ``employee_id``; returns how many records went."""
    if not employee_id:
        # reset_attempts() without a filter would wipe the records of every account.
        return 0
    # Failures are recorded under the case-folded name (axes_username), so look them up the same way.
    return AxesProxyHandler.reset_attempts(username=employee_id.casefold())
