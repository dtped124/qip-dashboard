"""Signals of the accounts app; connected from ``AccountsConfig.ready()``."""
import logging

from django.contrib.auth.signals import user_logged_in
from django.dispatch import receiver

from .backends import LDAP_BACKEND

logger = logging.getLogger(__name__)


@receiver(user_logged_in)
def log_login_method(sender, request, user, **kwargs):
    """Record which door a sign-in used (the User table has no field for it). Covers /admin/login/ too."""
    method = "ldap" if getattr(user, "backend", "") == LDAP_BACKEND else "local"
    logger.info("login ok employee_id=%s method=%s", user.get_username(), method)
