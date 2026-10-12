"""
AD / LDAP client for the QIP API: the two-step check the hospital's information office prescribes.

1. A service account binds and searches ``LDAP_BASE_DN`` for the person whose ``sAMAccountName`` is the login id.
2. The distinguished name found there binds once more with the password the user typed; the server's answer to that
   bind is the verdict on the password.

``authenticate`` returns an ``LdapResult`` and never raises (apart from programming errors): whoever calls it decides
what each status means for the sign-in. Nothing in this module touches the User table or ``django.contrib.auth``.

Statuses
* ``success``         the password is right; ``account`` is the AD spelling of the login id, ``attrs`` its details
* ``wrong_password``  AD knows the account and refused the password (also: empty password, any other failure of
                      the second bind - fail closed)
* ``not_found``       no such account in AD (also: a login id that cannot be an AD account name; AD is not asked)
* ``ambiguous``       more than one AD entry carries that name; nobody is let in
* ``error``           AD could not give an answer (unreachable, timeout, service account refused, circuit open)

Circuit breaker: when the service-account step fails in a way that says AD or its network is down, the failure is
remembered in the cache for ``CIRCUIT_SECONDS`` and every attempt in that time returns ``error`` at once. Without it,
each sign-in would wait out the timeouts again while AD is down. A cache that cannot be reached is treated as "no
breaker" (fail-open, like password_throttle.py): the breaker only saves time, it decides nothing.

No log line carries a password.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field

import ldap3  # noqa: F401 - kept as a module attribute so a test can see which ldap3 this module talks to
from django.conf import settings
from django.core.cache import cache
from django.views.decorators.debug import sensitive_variables
from ldap3 import NONE, SUBTREE, Connection, Server
from ldap3.core.exceptions import (
    LDAPBindError,
    LDAPCommunicationError,
    LDAPResponseTimeoutError,
)
from ldap3.utils.conv import escape_filter_chars

logger = logging.getLogger(__name__)

# What an AD account name (sAMAccountName) may look like here: the employee number. Anything else is not
# looked up, so no search filter is ever built from odd characters and AD is not bothered with them.
LOGIN_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,20}$")

AD_ATTRIBUTES = ["sAMAccountName", "sn", "givenName", "displayName", "mail", "department"]

STATUSES = ("success", "wrong_password", "not_found", "error", "ambiguous")

CIRCUIT_KEY = "accounts:ldap-down"
CIRCUIT_SECONDS = 30

# Failures that say "AD or the path to it is down" (as opposed to "AD said no").
_DOWN_ERRORS = (LDAPCommunicationError, LDAPResponseTimeoutError, LDAPBindError)
# The same for the user's own bind: there a refused bind is the ordinary "wrong password", not an outage.
_USER_STAGE_DOWN_ERRORS = (LDAPCommunicationError, LDAPResponseTimeoutError)


@dataclass(frozen=True)
class LdapResult:
    status: str
    account: str | None = None
    attrs: dict = field(default_factory=dict)


class LdapUnavailable(Exception):  # noqa: N818 - the name is part of the interface the backend imports
    """AD gave no answer. Deliberately not a PermissionDenied: Django must not count it as a failed login."""


# ── Circuit breaker ──────────────────────────────────────────────


def mark_unavailable() -> None:
    """Remember for ``CIRCUIT_SECONDS`` that AD is down."""
    try:
        cache.set(CIRCUIT_KEY, 1, CIRCUIT_SECONDS)
    except Exception:  # noqa: BLE001 - Redis down, timeouts, ...: fail open, see the module docstring
        logger.warning("AD circuit breaker not set: cache unavailable", exc_info=True)


def is_unavailable() -> bool:
    """True while the breaker is open (AD failed less than ``CIRCUIT_SECONDS`` ago)."""
    try:
        return cache.get(CIRCUIT_KEY) is not None
    except Exception:  # noqa: BLE001 - fail open, see the module docstring
        logger.warning("AD circuit breaker not read: cache unavailable", exc_info=True)
        return False


# ── Helpers ──────────────────────────────────────────────────────


def build_filter(login_id: str) -> str:
    """The search filter for one person; ``login_id`` is escaped, so it can only ever be a value."""
    return f"(&(objectClass=user)(objectCategory=person)(sAMAccountName={escape_filter_chars(login_id)}))"


def ad_full_name(attrs: dict) -> str:
    """Surname + given name (Chinese names have no space between them), else the display name, else ""."""
    name = f"{(attrs.get('sn') or '').strip()}{(attrs.get('givenName') or '').strip()}"
    return name or (attrs.get("displayName") or "").strip()


def _first(values) -> str:
    if isinstance(values, (list, tuple)):
        values = values[0] if values else ""
    return "" if values is None else str(values).strip()


def _entry_attrs(entry) -> dict:
    """The wanted attributes of an entry as ``{name: first value as stripped text}`` ("" when AD has none)."""
    raw = {str(key).casefold(): value for key, value in (entry.entry_attributes_as_dict or {}).items()}
    return {name: _first(raw.get(name.casefold()) or []) for name in AD_ATTRIBUTES}


def _close(*connections) -> None:
    for connection in connections:
        if connection is None:
            continue
        try:
            connection.unbind()
        except Exception:  # noqa: BLE001 - closing is best effort; it must never change the verdict
            pass


# ── The two-step check ───────────────────────────────────────────


@sensitive_variables()
def authenticate(login_id: str, password: str, conf: dict | None = None) -> LdapResult:
    """Check ``login_id`` / ``password`` against AD; ``conf`` defaults to ``settings.LDAP``."""
    if conf is None:
        conf = settings.LDAP
    if not password:
        # An empty password makes some AD servers answer an "unauthenticated bind" with success.
        return LdapResult("wrong_password")
    if not isinstance(login_id, str) or not LOGIN_ID_RE.fullmatch(login_id):
        return LdapResult("not_found")
    if is_unavailable():
        logger.warning("AD sign-in skipped: AD marked unavailable in the last %s seconds", CIRCUIT_SECONDS)
        return LdapResult("error")

    timeout = conf["TIMEOUT"]
    service_conn = None
    user_conn = None
    try:
        # Step 1: the service account finds the person.
        try:
            server = Server(conf["SERVER_IP"], port=conf["PORT"], get_info=NONE, connect_timeout=timeout)
            service_conn = Connection(
                server,
                user=conf["BIND_USER"],
                password=conf["BIND_PASS"],
                auto_bind=True,
                auto_referrals=False,
                receive_timeout=timeout,
                read_only=True,
            )
            service_conn.search(
                conf["BASE_DN"],
                build_filter(login_id),
                search_scope=SUBTREE,
                attributes=AD_ATTRIBUTES,
                size_limit=2,
            )
            entries = list(service_conn.entries)
        except Exception as exc:  # noqa: BLE001 - any failure here means AD cannot answer
            if isinstance(exc, _DOWN_ERRORS):
                mark_unavailable()
            logger.warning("AD service-account step failed: %s: %s", type(exc).__name__, exc)
            return LdapResult("error")

        if not entries:
            return LdapResult("not_found")
        if len(entries) > 1:
            logger.warning("AD sign-in refused: more than one entry has the account name %s", login_id)
            return LdapResult("ambiguous")

        entry = entries[0]
        attrs = _entry_attrs(entry)

        # Step 2: the person's own bind is the verdict on the password.
        try:
            user_conn = Connection(
                server,
                user=entry.entry_dn,
                password=password,
                auto_referrals=False,
                receive_timeout=timeout,
            )
            bound = user_conn.bind()
        except _USER_STAGE_DOWN_ERRORS as exc:
            # No breaker here: one user's bind trouble says nothing about AD as a whole.
            logger.warning("AD user bind could not be completed: %s", type(exc).__name__)
            return LdapResult("error")
        except Exception as exc:  # noqa: BLE001 - e.g. a password the library refuses to encode: fail closed
            logger.info("AD user bind raised %s; treated as a wrong password", type(exc).__name__)
            return LdapResult("wrong_password")

        if bound:
            return LdapResult("success", account=attrs["sAMAccountName"] or login_id, attrs=attrs)
        result = getattr(user_conn, "result", None)
        result = result if isinstance(result, dict) else {}
        logger.info(
            "AD refused the password of %s: result code %s (%s)",
            login_id,
            result.get("result"),
            result.get("description"),
        )
        return LdapResult("wrong_password")
    except Exception as exc:  # noqa: BLE001 - defensive: anything from outside the two guarded steps; fail closed
        logger.warning("AD sign-in failed unexpectedly: %s", type(exc).__name__)
        return LdapResult("error")
    finally:
        _close(user_conn, service_conn)
