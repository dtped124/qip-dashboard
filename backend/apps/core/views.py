"""Platform probes. Plain Django views on purpose: no DRF, no session, no authentication."""
import logging

from django.db import connection
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_safe

logger = logging.getLogger(__name__)


@require_safe
@never_cache
def healthz(request):
    """GET /healthz: 200 ``{"status": "ok"}`` when the database answers, else 503.

    Open to everyone and not routed through DRF, so it keeps answering when auth, permissions or the
    session store are misconfigured. The body never says why it failed (the reason goes to the log):
    an unauthenticated caller learns nothing about the deployment.

    ``ensure_connection()`` alone is not enough with persistent connections (CONN_MAX_AGE): it returns
    at once when the worker still holds a connection that the database has since dropped. The
    ``SELECT 1`` makes the probe talk to the server.
    """
    try:
        connection.ensure_connection()
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
    except Exception as exc:  # any failure means "not ready"
        logger.warning("healthz: database check failed (%s: %s)", type(exc).__name__, exc)
        return JsonResponse({"status": "unavailable"}, status=503)
    return JsonResponse({"status": "ok"})
