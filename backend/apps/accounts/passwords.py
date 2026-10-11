"""
Password helpers shared by the API, the management commands and the tests.

``password_problems`` is the single place that runs ``AUTH_PASSWORD_VALIDATORS``;
``generate_temporary_password`` builds the one-time passwords that administrators
hand to users (account creation without a password, "reset password").
"""
from __future__ import annotations

import secrets

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError

# Characters that are easy to mix up when someone reads a password aloud or retypes
# it (0/O, 1/l/I) are left out of the alphabet.
_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"
_LOWER = "abcdefghijkmnopqrstuvwxyz"
_DIGITS = "23456789"
_SYMBOLS = "!@#$%*-_=+?"
_CLASSES = (_UPPER, _LOWER, _DIGITS, _SYMBOLS)
_ALPHABET = "".join(_CLASSES)

TEMPORARY_PASSWORD_LENGTH = 14
MIN_TEMPORARY_PASSWORD_LENGTH = 12
# Random candidates fail the validators only by freak accident, so hitting this
# cap means AUTH_PASSWORD_VALIDATORS cannot be satisfied (e.g. a minimum length
# above TEMPORARY_PASSWORD_LENGTH). Fail loudly instead of spinning forever.
_MAX_ATTEMPTS = 100


def password_problems(password: str, user=None) -> list[str]:
    """Messages of every AUTH_PASSWORD_VALIDATORS rule ``password`` breaks; [] if it is acceptable.

    Pass ``user`` (it may be unsaved) so the similarity validator can compare the
    password with the account's employee_id / full_name / email.
    """
    try:
        validate_password(password, user)
    except ValidationError as exc:
        return list(exc.messages)
    return []


def generate_temporary_password(user=None, length: int = TEMPORARY_PASSWORD_LENGTH) -> str:
    """A random password with at least one upper-case letter, lower-case letter, digit and symbol.

    At least ``MIN_TEMPORARY_PASSWORD_LENGTH`` characters, and it is guaranteed to pass
    ``AUTH_PASSWORD_VALIDATORS`` (candidates that do not are discarded and redrawn).
    Callers must treat the result as a secret: return it once, never log or store it.
    """
    length = max(length, MIN_TEMPORARY_PASSWORD_LENGTH)
    for _ in range(_MAX_ATTEMPTS):
        # One from each class first, then fill up from the whole alphabet; the
        # shuffle keeps the guaranteed characters from always sitting at the front.
        chars = [secrets.choice(pool) for pool in _CLASSES]
        chars += [secrets.choice(_ALPHABET) for _ in range(length - len(chars))]
        secrets.SystemRandom().shuffle(chars)
        candidate = "".join(chars)
        if not password_problems(candidate, user):
            return candidate
    raise RuntimeError(
        f"No {length}-character password passed AUTH_PASSWORD_VALIDATORS in {_MAX_ATTEMPTS} attempts; "
        "check the validator settings."
    )
