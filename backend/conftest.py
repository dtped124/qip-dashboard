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
