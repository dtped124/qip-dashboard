"""
Session authentication with a JSON-friendly CSRF failure.

DRF's ``SessionAuthentication`` runs its own CSRF check for signed-in users and
raises a plain ``PermissionDenied("CSRF Failed: ...")``, so a failure on a DRF
view never reaches ``settings.CSRF_FAILURE_VIEW``. This subclass re-raises it
with the ``csrf_failed`` code and the same message as ``accounts.views.csrf_failure``
(used for plain Django views), so every endpoint reports CSRF problems alike.
"""
import logging

from django.conf import settings
from django.contrib.auth import BACKEND_SESSION_KEY
from rest_framework import exceptions
from rest_framework.authentication import SessionAuthentication

from .backends import LDAP_BACKEND, is_local_account

logger = logging.getLogger(__name__)


class CSRFFailed(exceptions.PermissionDenied):
    default_detail = "CSRF verification failed."
    default_code = "csrf_failed"


class QipSessionAuthentication(SessionAuthentication):
    def authenticate(self, request):
        """Session sign-in, except that a session which never passed AD stops counting once AD is on.

        A local session opened while ``LDAP_ENABLED`` was off would otherwise stay valid after AD is switched on
        (R13: AD is the only door). Such a session is flushed and treated as signed out, unless its account is on
        ``LDAP_LOCAL_ONLY_ACCOUNTS``. Switching AD off again changes nothing: the check only runs while AD is on.
        """
        result = super().authenticate(request)
        if result is None or not settings.LDAP["ENABLED"]:
            return result
        user = result[0]
        session = request._request.session
        if session.get(BACKEND_SESSION_KEY) != LDAP_BACKEND and not is_local_account(user.employee_id):
            logger.info("session invalidated after AD was enabled employee_id=%s", user.employee_id)
            session.flush()
            return None
        return result

    def enforce_csrf(self, request):
        try:
            super().enforce_csrf(request)
        except exceptions.PermissionDenied as exc:
            raise CSRFFailed() from exc
