"""
Session authentication with a JSON-friendly CSRF failure.

DRF's ``SessionAuthentication`` runs its own CSRF check for signed-in users and
raises a plain ``PermissionDenied("CSRF Failed: ...")``, so a failure on a DRF
view never reaches ``settings.CSRF_FAILURE_VIEW``. This subclass re-raises it
with the ``csrf_failed`` code and the same message as ``accounts.views.csrf_failure``
(used for plain Django views), so every endpoint reports CSRF problems alike.
"""
from rest_framework import exceptions
from rest_framework.authentication import SessionAuthentication


class CSRFFailed(exceptions.PermissionDenied):
    default_detail = "CSRF verification failed."
    default_code = "csrf_failed"


class QipSessionAuthentication(SessionAuthentication):
    def enforce_csrf(self, request):
        try:
            super().enforce_csrf(request)
        except exceptions.PermissionDenied as exc:
            raise CSRFFailed() from exc
