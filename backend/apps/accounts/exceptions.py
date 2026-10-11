"""
DRF exception handler: DRF's own response plus a machine-readable ``code``.

``{"detail": "..."}`` stays exactly as DRF produces it; the added ``code``
(``not_authenticated``, ``permission_denied``, ``csrf_failed``, ``not_found`` ...)
lets the SPA tell "log in again" from "not allowed" without parsing text.
"""
from __future__ import annotations

from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.http import Http404
from rest_framework import exceptions
from rest_framework.views import exception_handler as drf_exception_handler


def _error_code(exc: Exception) -> str | None:
    # DRF's default handler turns these two Django exceptions into
    # NotFound / PermissionDenied; mirror that mapping here.
    if isinstance(exc, Http404):
        return "not_found"
    if isinstance(exc, DjangoPermissionDenied):
        return "permission_denied"
    if isinstance(exc, exceptions.APIException):
        codes = exc.get_codes()
        # Field-level validation errors give a dict/list of codes: no single code.
        if isinstance(codes, str):
            return codes
    return None


def exception_handler(exc, context):
    response = drf_exception_handler(exc, context)
    if response is None:
        return None  # unhandled error: let Django produce its 500

    # Field-level serializer errors have no single code (_error_code returns None),
    # so their dict is left as is; never overwrite an existing "code" key.
    if isinstance(response.data, dict) and "code" not in response.data:
        code = _error_code(exc)
        if code:
            response.data["code"] = code
    return response
