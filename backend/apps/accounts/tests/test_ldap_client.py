"""
Tests of apps/accounts/ldap.py, the AD client, against a fake ``ldap3``.

``Server`` and ``Connection`` are replaced inside ``apps.accounts.ldap`` by recording fakes (``FakeAd``); nothing here
needs a database, a network or an AD. The configuration is passed to ``authenticate(..., conf=...)`` directly (the
autouse ``ldap_off`` fixture of backend/conftest.py keeps ``settings.LDAP`` disabled and ``ldap3.Connection`` armed).

All host names, accounts, DNs and passwords below are made-up values.
"""
from __future__ import annotations

import logging

import pytest
from django.core.cache import cache
from ldap3.core.exceptions import (
    LDAPBindError,
    LDAPCommunicationError,
    LDAPResponseTimeoutError,
    LDAPSocketOpenError,
)

from apps.accounts import ldap as ad

SECRET = "Pw-Zq9-unique-marker!"  # a password that must never show up in a log line
BIND_SECRET = "Bind-Zq9-unique-marker!"
USER_DN = "CN=Test Person,OU=Staff,DC=example,DC=test"

CONF = {
    "ENABLED": True,
    "SERVER_IP": "ad.example.test",
    "PORT": 3890,
    "BIND_USER": "CN=svc-test,OU=Service,DC=example,DC=test",
    "BIND_PASS": BIND_SECRET,
    "BASE_DN": "DC=example,DC=test",
    "TIMEOUT": 2.5,
    "AUTO_CREATE": False,
    "DEFAULT_ROLE": "viewer",
    "LOCAL_ONLY_ACCOUNTS": frozenset(),
}


class FakeEntry:
    def __init__(self, dn=USER_DN, **attributes):
        self.entry_dn = dn
        self.entry_attributes_as_dict = attributes


def person(**overrides) -> FakeEntry:
    attributes = {
        "sAMAccountName": ["T123"],
        "sn": ["陳"],
        "givenName": ["小明"],
        "displayName": ["陳小明"],
        "mail": ["t123@example.test"],
        "department": ["品管中心"],
    }
    attributes.update(overrides)
    return FakeEntry(**attributes)


class FakeAd:
    """Records every Server / Connection and plays back what a test configured."""

    def __init__(self):
        self.servers: list[dict] = []
        self.connections: list[FakeConnection] = []
        self.entries: list[FakeEntry] = [person()]
        self.service_error: Exception | None = None  # raised by Connection(..., auto_bind=True)
        self.search_error: Exception | None = None
        self.bind_result = True
        self.bind_error: Exception | None = None  # raised by the user's bind()
        self.user_connect_error: Exception | None = None  # raised by Connection(...) of the user's bind
        self.unbind_error: Exception | None = None

    @property
    def service(self) -> FakeConnection:
        return next(c for c in self.connections if c.kwargs.get("auto_bind"))

    @property
    def user(self) -> FakeConnection:
        return next(c for c in self.connections if not c.kwargs.get("auto_bind"))


class FakeConnection:
    def __init__(self, ad_: FakeAd, server, **kwargs):
        self.ad = ad_
        self.server = server
        self.kwargs = kwargs
        self.is_service = bool(kwargs.get("auto_bind"))
        self.searches: list[dict] = []
        self.entries: list[FakeEntry] = []
        self.unbound = 0
        self.result = {"result": 49, "description": "invalidCredentials"}
        ad_.connections.append(self)
        error = ad_.service_error if self.is_service else ad_.user_connect_error
        if error is not None:
            raise error

    def search(self, search_base, search_filter, **kwargs):
        self.searches.append({"base": search_base, "filter": search_filter, **kwargs})
        if self.ad.search_error is not None:
            raise self.ad.search_error
        self.entries = list(self.ad.entries)
        return bool(self.entries)

    def bind(self):
        if self.ad.bind_error is not None:
            raise self.ad.bind_error
        return self.ad.bind_result

    def unbind(self):
        self.unbound += 1
        if self.ad.unbind_error is not None:
            raise self.ad.unbind_error


@pytest.fixture
def fake_ad(monkeypatch) -> FakeAd:
    fake = FakeAd()

    def server(host, **kwargs):
        fake.servers.append({"host": host, **kwargs})
        return f"server:{host}"

    def connection(srv, **kwargs):
        return FakeConnection(fake, srv, **kwargs)

    monkeypatch.setattr(ad, "Server", server)
    monkeypatch.setattr(ad, "Connection", connection)
    return fake


def run(login_id="T123", password=SECRET, conf=None):
    return ad.authenticate(login_id, password, conf=CONF if conf is None else conf)


# ── The safety net of backend/conftest.py ────────────────────────


def test_the_suite_is_armed_against_a_real_ad(settings):
    """Without a fake_ad fixture, any attempt to open a connection must fail the test instead of reaching a network."""
    import ldap3

    assert settings.LDAP["ENABLED"] is False
    with pytest.raises(pytest.fail.Exception, match="real LDAP connection attempted in tests"):
        ldap3.Connection("ad.example.test")
    with pytest.raises(pytest.fail.Exception, match="real LDAP connection attempted in tests"):
        ad.Connection("ad.example.test")


def test_an_unfaked_check_is_an_error_not_a_network_call():
    """The stub fails the test (a BaseException), so ``authenticate``'s ``except Exception`` cannot turn it into an
    ``error`` result: an un-faked AD call is never silently tolerated."""
    with pytest.raises(pytest.fail.Exception, match="real LDAP connection attempted in tests"):
        ad.authenticate("T123", SECRET, conf=CONF)


# ── Results ──────────────────────────────────────────────────────


def test_a_matching_password_is_a_success(fake_ad):
    result = run("t123")  # typed in lower case: the account is reported the way AD spells it

    assert result.status == "success"
    assert result.account == "T123"
    assert result.attrs == {
        "sAMAccountName": "T123",
        "sn": "陳",
        "givenName": "小明",
        "displayName": "陳小明",
        "mail": "t123@example.test",
        "department": "品管中心",
    }


def test_missing_and_blank_attributes_come_back_as_empty_text(fake_ad):
    fake_ad.entries = [FakeEntry(sAMAccountName=["  T123 "], mail=[], displayName=None, sn=["  陳  "])]

    result = run()

    assert result.status == "success"
    assert result.account == "T123"  # stripped
    assert result.attrs["mail"] == ""
    assert result.attrs["displayName"] == ""
    assert result.attrs["department"] == ""
    assert result.attrs["sn"] == "陳"


def test_the_account_falls_back_to_the_login_id_when_ad_returns_no_name(fake_ad):
    fake_ad.entries = [FakeEntry(sn=["陳"])]
    assert run("t123").account == "t123"


def test_no_entry_is_not_found(fake_ad):
    fake_ad.entries = []

    result = run()

    assert (result.status, result.account, result.attrs) == ("not_found", None, {})
    assert len(fake_ad.connections) == 1  # the user's own bind was never tried


def test_two_entries_are_ambiguous_and_nobody_is_bound(fake_ad, caplog):
    fake_ad.entries = [person(), person()]

    with caplog.at_level(logging.DEBUG):
        result = run()

    assert result.status == "ambiguous"
    assert len(fake_ad.connections) == 1
    assert any(r.levelno == logging.WARNING for r in caplog.records)


def test_a_refused_bind_is_a_wrong_password_and_the_reason_is_logged(fake_ad, caplog):
    fake_ad.bind_result = False

    with caplog.at_level(logging.DEBUG):
        result = run()

    assert result.status == "wrong_password"
    assert "49" in caplog.text and "invalidCredentials" in caplog.text
    assert fake_ad.user.kwargs["user"] == USER_DN
    assert fake_ad.user.kwargs["password"] == SECRET  # the password goes to AD, and only there


def test_a_wrong_password_does_not_open_the_breaker(fake_ad):
    fake_ad.bind_result = False
    run()
    assert cache.get(ad.CIRCUIT_KEY) is None


# ── Failures of the service-account step ─────────────────────────


@pytest.mark.parametrize(
    "error",
    [
        LDAPBindError("automatic bind not successful"),
        LDAPCommunicationError("socket error"),
        LDAPSocketOpenError("cannot connect"),
        LDAPResponseTimeoutError("no reply"),
    ],
    ids=lambda e: type(e).__name__,
)
def test_service_account_trouble_is_an_error_and_opens_the_breaker(fake_ad, error):
    fake_ad.service_error = error

    result = run()

    assert result.status == "error"
    assert cache.get(ad.CIRCUIT_KEY) is not None
    assert ad.is_unavailable()


def test_a_search_that_times_out_is_an_error_and_opens_the_breaker(fake_ad):
    fake_ad.search_error = LDAPResponseTimeoutError("no reply")

    assert run().status == "error"
    assert ad.is_unavailable()


def test_an_unexpected_service_step_failure_is_an_error_without_the_breaker(fake_ad):
    fake_ad.service_error = ValueError("something odd")

    assert run().status == "error"
    assert not ad.is_unavailable()


def test_a_connection_that_cannot_even_be_built_is_an_error_not_an_unbound_local(fake_ad):
    fake_ad.service_error = RuntimeError("constructor blew up")

    result = run()

    assert result.status == "error"
    assert [c.unbound for c in fake_ad.connections] == [0]  # nothing was bound, so nothing is closed twice


def test_with_the_breaker_open_ad_is_not_asked(fake_ad):
    ad.mark_unavailable()

    result = run()

    assert result.status == "error"
    assert fake_ad.servers == [] and fake_ad.connections == []


def test_after_an_outage_the_next_attempts_fail_at_once(fake_ad):
    fake_ad.service_error = LDAPCommunicationError("socket error")
    assert run().status == "error"
    assert len(fake_ad.connections) == 1

    assert run().status == "error"
    assert len(fake_ad.connections) == 1  # the breaker answered, AD was not touched


def test_the_breaker_lasts_thirty_seconds(monkeypatch):
    stored = {}
    monkeypatch.setattr(ad.cache, "set", lambda key, value, timeout=None: stored.update({key: (value, timeout)}))

    ad.mark_unavailable()

    assert stored == {ad.CIRCUIT_KEY: (1, 30)}
    assert (ad.CIRCUIT_KEY, ad.CIRCUIT_SECONDS) == ("accounts:ldap-down", 30)


def test_a_cache_that_fails_never_blocks_the_check(fake_ad, monkeypatch, caplog):
    def broken(*args, **kwargs):
        raise ConnectionError("cache is down")

    monkeypatch.setattr(ad.cache, "get", broken)
    monkeypatch.setattr(ad.cache, "set", broken)

    with caplog.at_level(logging.WARNING):
        assert run().status == "success"  # is_unavailable() failed open
        fake_ad.service_error = LDAPCommunicationError("socket error")
        assert run().status == "error"  # mark_unavailable() did not raise

    assert "cache unavailable" in caplog.text


# ── Failures of the user's own bind ──────────────────────────────


def test_a_communication_error_during_the_users_bind_is_an_error_without_the_breaker(fake_ad):
    fake_ad.bind_error = LDAPCommunicationError("socket error")

    assert run().status == "error"
    assert cache.get(ad.CIRCUIT_KEY) is None


def test_a_timeout_while_the_user_connects_is_an_error_without_the_breaker(fake_ad):
    fake_ad.user_connect_error = LDAPResponseTimeoutError("no reply")

    assert run().status == "error"
    assert cache.get(ad.CIRCUIT_KEY) is None


def test_any_other_error_during_the_users_bind_fails_closed_as_a_wrong_password(fake_ad):
    fake_ad.bind_error = ValueError("password has a character the library refuses")

    result = run()

    assert result.status == "wrong_password"
    assert cache.get(ad.CIRCUIT_KEY) is None


# ── Guards that keep AD out of it ────────────────────────────────


@pytest.mark.parametrize("password", ["", None], ids=["empty", "none"])
def test_an_empty_password_is_refused_without_any_connection(fake_ad, password):
    assert run(password=password).status == "wrong_password"
    assert fake_ad.servers == [] and fake_ad.connections == []


@pytest.mark.parametrize(
    "login_id",
    ["", " ", "a b", "a*b", "*", "a)(b", "x" * 21, "abc\n", "a\x00b", "名字", "a@b", "a,b", "a\\b", None],
)
def test_a_name_that_cannot_be_an_account_is_not_looked_up(fake_ad, login_id):
    assert run(login_id).status == "not_found"
    assert fake_ad.servers == [] and fake_ad.connections == []


@pytest.mark.parametrize("login_id", ["T123", "a", "x" * 20, "first.last", "user_name", "a-b", "9"])
def test_ordinary_account_names_are_looked_up(fake_ad, login_id):
    run(login_id)
    assert len(fake_ad.connections) >= 1


# ── What is sent to AD ───────────────────────────────────────────


def test_both_timeouts_and_the_other_options_reach_ldap3(fake_ad):
    run()

    assert fake_ad.servers == [
        {"host": "ad.example.test", "port": 3890, "get_info": ad.NONE, "connect_timeout": 2.5}
    ]
    service, user = fake_ad.service, fake_ad.user
    assert service.kwargs == {
        "user": CONF["BIND_USER"],
        "password": BIND_SECRET,
        "auto_bind": True,
        "auto_referrals": False,
        "receive_timeout": 2.5,
        "read_only": True,
    }
    assert user.kwargs == {
        "user": USER_DN,
        "password": SECRET,
        "auto_referrals": False,
        "receive_timeout": 2.5,
    }
    assert service.server == user.server  # one Server object for both steps


def test_the_search_asks_for_exactly_the_wanted_attributes(fake_ad):
    run("T123")

    (search,) = fake_ad.service.searches
    assert search["base"] == CONF["BASE_DN"]
    assert search["filter"] == "(&(objectClass=user)(objectCategory=person)(sAMAccountName=T123))"
    assert search["search_scope"] == ad.SUBTREE
    assert search["attributes"] == ["sAMAccountName", "sn", "givenName", "displayName", "mail", "department"]
    assert search["size_limit"] == 2


def test_the_configuration_defaults_to_settings_ldap(fake_ad, settings):
    settings.LDAP = {**CONF, "TIMEOUT": 7.0, "PORT": 1389}

    ad.authenticate("T123", SECRET)

    assert fake_ad.servers[0]["connect_timeout"] == 7.0
    assert fake_ad.servers[0]["port"] == 1389


def test_every_connection_is_closed_even_when_unbind_fails(fake_ad):
    fake_ad.unbind_error = RuntimeError("unbind blew up")

    result = run()

    assert result.status == "success"  # a failing unbind changes nothing
    assert [c.unbound for c in fake_ad.connections] == [1, 1]


def test_unbind_failures_do_not_change_a_refusal_either(fake_ad):
    fake_ad.unbind_error = RuntimeError("unbind blew up")
    fake_ad.bind_result = False
    assert run().status == "wrong_password"

    fake_ad.entries = []
    assert run().status == "not_found"


def test_connections_are_closed_after_every_outcome(fake_ad):
    fake_ad.bind_result = False
    run()
    assert [c.unbound for c in fake_ad.connections] == [1, 1]


# ── Helpers ──────────────────────────────────────────────────────


def test_build_filter_escapes_everything_that_could_change_the_query():
    assert ad.build_filter("T123") == "(&(objectClass=user)(objectCategory=person)(sAMAccountName=T123))"
    assert ad.build_filter("a*b(c)\\d") == (
        "(&(objectClass=user)(objectCategory=person)(sAMAccountName=a\\2ab\\28c\\29\\5cd))"
    )
    assert ad.build_filter("a\x00b").endswith("(sAMAccountName=a\\00b))")
    assert "*" not in ad.build_filter("*)(uid=*").split("sAMAccountName=")[1]


@pytest.mark.parametrize(
    "attrs,expected",
    [
        ({"sn": "陳", "givenName": "小明", "displayName": "Chen Xiaoming"}, "陳小明"),
        ({"sn": " 陳 ", "givenName": " 小明 "}, "陳小明"),
        ({"sn": "陳", "givenName": ""}, "陳"),
        ({"sn": "", "givenName": "", "displayName": " 陳小明 "}, "陳小明"),
        ({"displayName": "陳小明"}, "陳小明"),
        ({"sn": "", "givenName": "", "displayName": ""}, ""),
        ({}, ""),
    ],
)
def test_ad_full_name(attrs, expected):
    assert ad.ad_full_name(attrs) == expected


def test_the_login_id_pattern_is_the_documented_one():
    assert ad.LOGIN_ID_RE.pattern == r"^[A-Za-z0-9._-]{1,20}$"
    assert ad.AD_ATTRIBUTES == ["sAMAccountName", "sn", "givenName", "displayName", "mail", "department"]


def test_all_local_variables_are_hidden_from_error_reports():
    """Not just ``password``: ``repr(ldap3.Connection)`` contains the password it was built with, so the connection
    objects (and ``conf``, with the bind password) must be hidden too - ``sensitive_variables()`` hides everything."""
    from apps.accounts.backends import LdapBackend

    assert ad.authenticate.sensitive_variables == "__ALL__"
    assert LdapBackend.authenticate.sensitive_variables == "__ALL__"


def test_ldap_unavailable_is_not_a_permission_error():
    from django.core.exceptions import PermissionDenied

    assert issubclass(ad.LdapUnavailable, Exception)
    assert not issubclass(ad.LdapUnavailable, PermissionDenied)


def test_ldap_result_is_immutable():
    result = ad.LdapResult("error")
    assert (result.account, result.attrs) == (None, {})
    with pytest.raises(AttributeError):
        result.status = "success"


# ── No password in the log ───────────────────────────────────────


def test_no_log_line_contains_a_password(fake_ad, caplog):
    scenarios = [
        {},
        {"bind_result": False},
        {"entries": []},
        {"entries": [person(), person()]},
        {"service_error": LDAPCommunicationError("socket error")},
        {"search_error": LDAPResponseTimeoutError("no reply")},
        # exceptions of the user's own bind may carry anything: their text must not be logged at all
        {"bind_error": ValueError(f"cannot encode {SECRET}")},
        {"bind_error": LDAPCommunicationError(f"echoed {SECRET}")},
        {"user_connect_error": RuntimeError(f"echoed {SECRET}")},
        {"unbind_error": RuntimeError("unbind blew up")},
    ]
    with caplog.at_level(logging.DEBUG):
        for scenario in scenarios:
            cache.delete(ad.CIRCUIT_KEY)
            fake_ad.entries = [person()]
            fake_ad.bind_result = True
            fake_ad.service_error = fake_ad.search_error = fake_ad.bind_error = None
            fake_ad.user_connect_error = fake_ad.unbind_error = None
            for key, value in scenario.items():
                setattr(fake_ad, key, value)
            run()
        ad.mark_unavailable()
        run()  # the breaker answers

    assert caplog.records, "the scenarios were meant to log something"
    assert SECRET not in caplog.text
    assert BIND_SECRET not in caplog.text
    assert SECRET not in "".join(str(r.args) + str(r.exc_info) for r in caplog.records)
