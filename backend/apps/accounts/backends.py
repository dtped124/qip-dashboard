"""
Sign-in against the hospital's AD (LDAP), as an authentication backend.

``LdapBackend`` sits between django-axes and ``ModelBackend`` in ``AUTHENTICATION_BACKENDS`` and makes AD the only
door: with ``LDAP_ENABLED`` on, the local password of an account is never looked at - the one exception is an account
listed in ``LDAP_LOCAL_ONLY_ACCOUNTS`` (the break-glass administrators), which this backend leaves to ``ModelBackend``.
AD only says *who* the person is; roles and the campus come from the local account, which the quality center opens.

What each answer of AD (see ``apps.accounts.ldap``) turns into
* ``success``                        sign in the local account (or create it when ``LDAP_AUTO_CREATE`` is on)
* ``wrong_password`` / ``not_found`` / ``ambiguous``
                                     ``PermissionDenied``: ``authenticate()`` stops there (``ModelBackend`` does not
                                     run, so a local password cannot stand in) and still sends ``user_login_failed``,
                                     which is what django-axes counts
* ``error``                          AD gave no answer. ``LdapUnavailable`` for the JSON login (it passes through
                                     Django's ``authenticate()`` without a ``user_login_failed``, so axes does not
                                     count an outage as a wrong password); ``PermissionDenied`` for any other caller
                                     (the Django admin form), which cannot show a 503

The backend leaves two facts on the Django ``HttpRequest`` for the login serializer: ``ldap_status`` (the AD status,
or ``no_account`` when AD accepted the person but the system has no account) and it reads ``ldap_api_login``, which
the serializer sets to say "I can handle LdapUnavailable".

No log line carries a password.
"""
from __future__ import annotations

import logging

from django.conf import settings
from django.contrib.auth import BACKEND_SESSION_KEY, get_user_model
from django.contrib.auth.backends import ModelBackend
from django.core.cache import cache
from django.core.exceptions import PermissionDenied
from django.db import IntegrityError, transaction
from django.views.decorators.debug import sensitive_variables

from .ldap import LdapUnavailable, ad_full_name
from .ldap import authenticate as ldap_authenticate

logger = logging.getLogger(__name__)

LDAP_BACKEND = "apps.accounts.backends.LdapBackend"

NAME_MISMATCH_TTL = 7 * 24 * 60 * 60  # one ad_name_mismatch warning per person per week
_EMAIL_MAX_LENGTH = 254


def is_local_account(employee_id: str) -> bool:
    """True when ``employee_id`` uses its local password: AD is off, or the account is on the local-only list."""
    conf = settings.LDAP
    return (not conf["ENABLED"]) or (employee_id or "").strip().casefold() in conf["LOCAL_ONLY_ACCOUNTS"]


def session_auth_method(request) -> str | None:
    """How this request's session was signed in: ``"ldap"``, ``"local"``, or None without a session.

    ``"ldap"`` needs ``LDAP_ENABLED`` as well as the session's backend: ``Client.force_login`` (and any session made
    without a real login) stamps the first backend that has ``get_user`` - which is ``LdapBackend`` - on the session,
    and such a session must not be treated as an AD one.
    """
    session = getattr(request, "session", None)
    if session is None:
        return None
    if settings.LDAP["ENABLED"] and session.get(BACKEND_SESSION_KEY) == LDAP_BACKEND:
        return "ldap"
    return "local"


def _find_local(login_id: str):
    """``(user or None, ambiguous)``: the local account for ``login_id``, exact spelling first, then case-insensitively.

    ``employee_id`` is case sensitive in the database while AD is not, so two accounts can differ only in case.
    When no exact match exists and several do case-insensitively, nobody is picked (``ambiguous`` is True).
    """
    user_model = get_user_model()
    exact = user_model.objects.filter(employee_id=login_id).first()
    if exact is not None:
        return exact, False
    matches = list(user_model.objects.filter(employee_id__iexact=login_id)[:2])
    if len(matches) > 1:
        logger.warning("ldap sign-in: more than one local account matches %s case-insensitively", login_id)
        return None, True
    return (matches[0] if matches else None), False


def _unused_email(email: str, exclude_pk=None) -> str:
    """``email`` when no other account uses it (case-insensitively), else ""."""
    email = (email or "").strip()
    if not email or len(email) > _EMAIL_MAX_LENGTH:
        return ""
    others = get_user_model().objects.filter(email__iexact=email)
    if exclude_pk is not None:
        others = others.exclude(pk=exclude_pk)
    return "" if others.exists() else email


def _squash(name: str) -> str:
    """The name without any whitespace, for comparing a Chinese name written with and without a space."""
    return "".join((name or "").split())


def _report_name_mismatch(user, ad_name: str) -> None:
    """Log ``ad_name_mismatch`` for this person at most once in ``NAME_MISMATCH_TTL``."""
    try:
        first_time = cache.add(f"accounts:ad-name-mismatch:{user.pk}", 1, NAME_MISMATCH_TTL)
    except Exception:  # noqa: BLE001 - cache down: fail open (sign in, and log every time rather than never)
        logger.warning("ad_name_mismatch de-duplication unavailable: cache error", exc_info=True)
        first_time = True
    if first_time:
        logger.warning(
            "ad_name_mismatch employee_id=%s system=%s ad=%s", user.employee_id, user.full_name, ad_name
        )


def sync_from_ad(user, result) -> None:
    """Fill what the local account lacks from AD and clear the obligation to change the temporary password.

    Only gaps are filled: ``full_name``, ``campus``, ``roles`` are never touched (a different AD name is logged only).
    The account is saved here - before ``login()`` - because the session hash is derived from the password field.
    """
    attrs = result.attrs or {}
    changed = []

    if not user.email:
        mail = _unused_email(attrs.get("mail", ""), exclude_pk=user.pk)
        if mail:
            user.email = mail
            changed.append("email")

    ad_name = ad_full_name(attrs)
    if _squash(ad_name) and _squash(user.full_name) and _squash(ad_name) != _squash(user.full_name):
        _report_name_mismatch(user, ad_name)

    if user.must_change_password:
        # The temporary password was only ever meant for the first sign-in; AD has proven who this is.
        user.must_change_password = False
        user.set_unusable_password()
        changed += ["must_change_password", "password"]

    if changed:
        user.save(update_fields=changed)


def provision_from_ad(result, login_id: str = ""):
    """Create the local account for a person AD accepted (``LDAP_AUTO_CREATE``); the default role, no campus.

    Returns the account, or None when it could not be created (the caller then refuses the sign-in). A concurrent
    first sign-in of the same person loses the unique-key race; it then finds the account the winner created.
    """
    user_model = get_user_model()
    attrs = result.attrs or {}
    account = (result.account or login_id)[:20]
    full_name = (ad_full_name(attrs) or account)[:50]
    try:
        with transaction.atomic():
            user = user_model(
                username=account,
                employee_id=account,
                full_name=full_name,
                email=_unused_email(attrs.get("mail", "")),
                roles=[settings.LDAP["DEFAULT_ROLE"]],
                campus=None,
                must_change_password=False,
            )
            user.set_unusable_password()
            user.save()
    except IntegrityError:
        existing, _ambiguous = _find_local(account)
        if existing is None:
            logger.warning("ldap auto-create failed for employee_id=%s", account, exc_info=True)
        return existing
    logger.warning(
        "ldap auto-created account employee_id=%s role=%s (LDAP_AUTO_CREATE is on)",
        user.employee_id,
        settings.LDAP["DEFAULT_ROLE"],
    )
    return user


class LdapBackend(ModelBackend):
    """AD sign-in; see the module docstring. Session loading (``get_user``) is ``ModelBackend``'s."""

    @sensitive_variables()
    def authenticate(self, request, username=None, password=None, **kwargs):
        if request is not None:
            request.ldap_status = None
        login_id = (username or kwargs.get("employee_id") or "").strip()
        if not settings.LDAP["ENABLED"] or not login_id or password is None or is_local_account(login_id):
            return None  # not ours: ModelBackend compares the local password (AD off / local-only account)

        local, _ambiguous = _find_local(login_id)
        if local is not None and not local.is_active:
            raise PermissionDenied  # a deactivated account does not get to ask AD

        result = ldap_authenticate(login_id, password)
        if request is not None:
            request.ldap_status = result.status

        if result.status == "error":
            if getattr(request, "ldap_api_login", False):
                raise LdapUnavailable
            raise PermissionDenied
        if result.status != "success":
            # not_found, wrong_password, ambiguous (and any status this code does not know): fail closed.
            raise PermissionDenied

        user, ambiguous = _find_local(result.account or login_id)
        if ambiguous:
            raise PermissionDenied
        if user is None:
            if not settings.LDAP["AUTO_CREATE"]:
                if request is not None:
                    request.ldap_status = "no_account"
                raise PermissionDenied
            user = provision_from_ad(result, login_id)
            if user is None:
                raise PermissionDenied
        if not user.is_active:
            raise PermissionDenied

        sync_from_ad(user, result)
        return user
