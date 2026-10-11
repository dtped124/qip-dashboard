"""
Error builders for the entry services.

Every error leaves the API as ``{"detail": "...", "code": "...", ...extra}`` (the shape the rest of
the API uses, see apps/accounts/exceptions.py). The extras (``missing``, ``codes``, ``fields`` ...) are
real JSON: DRF's own ``ValidationError(dict)`` would turn every value into a string (``false`` would
arrive as ``"False"``), so these classes keep the body as it was given.

They still subclass DRF's ``PermissionDenied`` / ``ValidationError`` / ``NotFound``, so the status code,
``isinstance`` checks and the exception handler behave as usual.
"""
from __future__ import annotations

from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError


class _CodedBody:
    """The body of a coded error: a plain dict with ``detail``, ``code`` and whatever else was passed."""

    code: str

    def _fill(self, detail: str, code: str, extra: dict) -> None:
        self.code = code
        self.detail = {"detail": detail, "code": code, **extra}

    def get_codes(self) -> str:
        return self.code

    def get_full_details(self) -> dict:
        return {"message": self.detail["detail"], "code": self.code}


class ForbiddenError(_CodedBody, PermissionDenied):
    """403"""

    def __init__(self, detail: str, code: str, **extra):
        self._fill(detail, code, extra)


class RejectedError(_CodedBody, ValidationError):
    """400"""

    def __init__(self, detail: str, code: str, **extra):
        self._fill(detail, code, extra)


class MissingError(_CodedBody, NotFound):
    """404"""

    def __init__(self, detail: str, code: str = "not_found", **extra):
        self._fill(detail, code, extra)


def forbidden(detail: str, code: str, **extra) -> ForbiddenError:
    """403 with a machine-readable ``code``."""
    return ForbiddenError(detail, code, **extra)


def rejected(detail: str, code: str, **extra) -> RejectedError:
    """400 with a machine-readable ``code``."""
    return RejectedError(detail, code, **extra)


def not_found(detail: str, code: str = "not_found", **extra) -> MissingError:
    """404 with a machine-readable ``code``."""
    return MissingError(detail, code, **extra)
