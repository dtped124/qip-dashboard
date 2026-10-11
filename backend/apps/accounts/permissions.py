"""
Role-based access control for the QIP API.

Roles live in ``User.roles`` (a JSON list of ``UserRole`` values) and follow the
same rules everywhere in the API:

* ``admin`` passes every role check; so does Django's ``is_superuser``.
* ``is_staff`` is NOT a role. It only opens the Django admin site (/admin/) and
  must never be read as "administrator" by API code.
* "Dashboard readers" are viewer | reviewer | admin (see ``DASHBOARD_READERS``).

How to protect a view:

* DRF ``@api_view`` function: put ``@permission_classes([IsAdmin])`` (or another
  class below) *under* ``@api_view``.
* Plain Django view (returns ``JsonResponse`` / ``HttpResponse``): decorate it
  with ``@require_roles(...)`` or the ``require_readers`` / ``require_admin``
  shortcuts.

A DRF view that declares nothing falls back to ``IsAuthenticatedPasswordOK``
(``REST_FRAMEWORK["DEFAULT_PERMISSION_CLASSES"]``), which is deny-by-default for
anonymous users. Plain Django views have no such default, which is why
``tests/test_permissions.py`` walks every ``/api/`` route anonymously.
"""
from __future__ import annotations

import functools

from django.http import JsonResponse
from rest_framework.permissions import SAFE_METHODS, BasePermission

from apps.accounts.models import UserRole

ADMIN = UserRole.ADMIN.value
REPORTER = UserRole.REPORTER.value
REVIEWER = UserRole.REVIEWER.value
VIEWER = UserRole.VIEWER.value

# Who may read dashboards and indicator data (admin is implied by has_role).
DASHBOARD_READERS: tuple[str, ...] = (VIEWER, REVIEWER)

_NOT_AUTHENTICATED = "Authentication credentials were not provided."
_PERMISSION_DENIED = "You do not have permission to perform this action."


# ── Role helpers ─────────────────────────────────────────────────


def _is_active_user(user) -> bool:
    return bool(user is not None and user.is_authenticated and user.is_active)


def _roles_of(user) -> list[str]:
    """Role strings stored on the user. Malformed data counts as "no roles"
    (a bare string would otherwise match by substring)."""
    roles = getattr(user, "roles", None)
    if not isinstance(roles, (list, tuple)):
        return []
    return [r for r in roles if isinstance(r, str)]


def is_admin(user) -> bool:
    """Signed-in admin: the ``admin`` role or Django's ``is_superuser``."""
    return _is_active_user(user) and bool(user.is_superuser or ADMIN in _roles_of(user))


def has_role(user, *roles: str) -> bool:
    """True if the user is signed in and holds any of ``roles``; admin always does."""
    if not _is_active_user(user):
        return False
    if is_admin(user):
        return True
    owned = _roles_of(user)
    return any(role in owned for role in roles)


def _passes_base_gate(user) -> bool:
    """The check every permission below builds on: signed in, active account.

    TODO(next phase): add the ``must_change_password`` gate here, so that DRF
    classes and ``require_roles`` pick it up together. /api/auth/* views use
    plain ``IsAuthenticated`` on purpose and stay reachable for those users.
    """
    return _is_active_user(user)


# ── DRF permission classes ───────────────────────────────────────


class IsAuthenticatedPasswordOK(BasePermission):
    """Default for every DRF view: a signed-in, active user (any role, or none).

    This is the hook for the forced-password-change gate; see
    ``_passes_base_gate``. The role classes below inherit from it.
    """

    def has_permission(self, request, view) -> bool:
        return _passes_base_gate(request.user)


class _RolePermission(IsAuthenticatedPasswordOK):
    """Signed in AND holding one of ``allowed_roles`` (admin always passes)."""

    allowed_roles: tuple[str, ...] = ()

    def has_permission(self, request, view) -> bool:
        return super().has_permission(request, view) and has_role(request.user, *self.allowed_roles)


class CanViewDashboard(_RolePermission):
    """viewer | reviewer | admin."""

    allowed_roles = DASHBOARD_READERS


class IsReporter(_RolePermission):
    allowed_roles = (REPORTER,)


class IsReviewer(_RolePermission):
    allowed_roles = (REVIEWER,)


class IsReporterOrReviewer(_RolePermission):
    allowed_roles = (REPORTER, REVIEWER)


class IsAdmin(_RolePermission):
    allowed_roles = (ADMIN,)


class ReadersGetAdminWrite(IsAuthenticatedPasswordOK):
    """Safe methods: dashboard readers. Everything else: admin only."""

    def has_permission(self, request, view) -> bool:
        if not super().has_permission(request, view):
            return False
        allowed = DASHBOARD_READERS if request.method in SAFE_METHODS else (ADMIN,)
        return has_role(request.user, *allowed)


# ── Decorator for plain Django views ─────────────────────────────


def _json_403(detail: str, code: str) -> JsonResponse:
    return JsonResponse({"detail": detail, "code": code}, status=403)


def require_roles(*roles: str):
    """Guard a plain Django view; same error shape as the DRF handler.

    Anonymous -> 403 ``not_authenticated``; signed in without one of ``roles``
    (admin always passes) -> 403 ``permission_denied``. No roles given means
    "any signed-in user".
    """

    def decorator(view):
        @functools.wraps(view)
        def wrapper(request, *args, **kwargs):
            user = getattr(request, "user", None)
            if not _passes_base_gate(user):
                return _json_403(_NOT_AUTHENTICATED, "not_authenticated")
            if roles and not has_role(user, *roles):
                return _json_403(_PERMISSION_DENIED, "permission_denied")
            return view(request, *args, **kwargs)

        return wrapper

    return decorator


require_readers = require_roles(*DASHBOARD_READERS)
require_admin = require_roles(ADMIN)
