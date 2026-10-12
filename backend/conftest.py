"""Backend-wide pytest fixtures."""
import pytest


@pytest.fixture(autouse=True)
def local_memory_cache(settings):
    """Run every test against its own in-process cache, never the configured one (Redis in Docker).

    The change-password attempt counters are keyed by user id. Test databases hand out the same small
    ids as the development database, so counters written to a shared Redis would land on real accounts.
    The cache is emptied before each test so one test's counters cannot leak into the next.
    """
    from django.core.cache import cache

    settings.CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "qip-pytest",
        }
    }
    cache.clear()
    yield
    cache.clear()


class _NoRealLdapConnection:
    """Stands in for ldap3.Connection: a test that gets this far meant to talk to a real AD.

    ``pytest.fail`` raises ``Failed``, a BaseException: the ``except Exception`` handlers in apps.accounts.ldap cannot
    swallow it into an ``error`` result, so the test itself fails.
    """

    def __init__(self, *args, **kwargs):
        pytest.fail("real LDAP connection attempted in tests")


@pytest.fixture(autouse=True)
def ldap_off(settings, monkeypatch):
    """AD sign-in is off in every test, and no test can open a real LDAP connection.

    settings.LDAP is replaced by a disabled configuration whatever the environment or backend/.env says (a developer
    may have LDAP_* in it to try the real AD by hand). ldap3.Connection - and the name apps.accounts.ldap bound to it
    at import - is replaced by a stub that fails the test, so a test that forgets to fake the AD fails instead of
    reaching the hospital network. Tests of AD behaviour switch their own configuration on and fake Server /
    Connection themselves.
    """
    import ldap3

    settings.LDAP = {
        "ENABLED": False,
        "SERVER_IP": "",
        "PORT": 389,
        "BIND_USER": "",
        "BIND_PASS": "",
        "BASE_DN": "",
        "TIMEOUT": 3.0,
        "AUTO_CREATE": False,
        "DEFAULT_ROLE": "viewer",
        "LOCAL_ONLY_ACCOUNTS": frozenset(),
    }
    monkeypatch.setattr(ldap3, "Connection", _NoRealLdapConnection)
    try:
        from apps.accounts import ldap as accounts_ldap
    except ImportError:  # the client module does not exist yet / is being imported broken: nothing more to guard
        return
    monkeypatch.setattr(accounts_ldap, "Connection", _NoRealLdapConnection)
