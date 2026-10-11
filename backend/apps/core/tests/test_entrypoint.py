"""
backend/entrypoint.sh, run against stand-in `python` and `gunicorn` executables that only log how they
were called: what starts, in which order, with which arguments and settings module.
"""
from __future__ import annotations

import shutil
import stat
import subprocess
from pathlib import Path

import pytest
from django.conf import settings

ENTRYPOINT = Path(settings.BASE_DIR) / "entrypoint.sh"

pytestmark = pytest.mark.skipif(shutil.which("sh") is None, reason="needs a POSIX shell")

PYTHON_SHIM = (
    "#!/bin/sh\n"
    'echo "python $* [settings=$DJANGO_SETTINGS_MODULE]" >> "$QIP_TEST_LOG"\n'
    'exit "${QIP_TEST_PYTHON_EXIT:-0}"\n'
)
GUNICORN_SHIM = (
    "#!/bin/sh\n"
    'echo "gunicorn $* [settings=$DJANGO_SETTINGS_MODULE]" >> "$QIP_TEST_LOG"\n'
)

BOOTSTRAP_LINE = "python manage.py bootstrap [settings={}]"


@pytest.fixture
def run_entrypoint(tmp_path):
    """run(*args, **env) -> (CompletedProcess, [log line of every stand-in that was started])."""
    shims = tmp_path / "bin"
    shims.mkdir()
    for name, text in (("python", PYTHON_SHIM), ("gunicorn", GUNICORN_SHIM)):
        path = shims / name
        path.write_text(text, newline="\n")
        path.chmod(path.stat().st_mode | stat.S_IEXEC)
    log = tmp_path / "calls.log"

    def run(*args, **env):
        full_env = {"PATH": f"{shims}:/usr/bin:/bin", "QIP_TEST_LOG": str(log), **env}
        proc = subprocess.run(
            ["sh", str(ENTRYPOINT), *args], env=full_env, cwd=tmp_path, capture_output=True, text=True, timeout=30,
        )
        lines = log.read_text().splitlines() if log.exists() else []
        return proc, lines

    return run


def test_the_script_is_posix_sh_with_unix_line_endings():
    raw = ENTRYPOINT.read_bytes()
    assert b"\r" not in raw, "a CRLF checkout breaks `#!/bin/sh` inside the container (.gitattributes forces LF)"
    assert raw.startswith(b"#!/bin/sh\n")
    assert subprocess.run(["sh", "-n", str(ENTRYPOINT)], capture_output=True).returncode == 0


def test_bootstraps_then_serves_with_the_defaults(run_entrypoint):
    proc, lines = run_entrypoint()
    assert proc.returncode == 0
    assert lines == [
        BOOTSTRAP_LINE.format("config.settings.prod"),
        "gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 3 --timeout 120 --access-logfile - "
        "[settings=config.settings.prod]",
    ]


def test_port_workers_and_timeout_come_from_the_environment(run_entrypoint):
    _, lines = run_entrypoint(PORT="9100", GUNICORN_WORKERS="2", GUNICORN_TIMEOUT="45")
    assert "--bind 0.0.0.0:9100 --workers 2 --timeout 45" in lines[-1]


def test_an_explicit_settings_module_is_kept(run_entrypoint):
    _, lines = run_entrypoint(DJANGO_SETTINGS_MODULE="config.settings.dev")
    assert lines[0] == BOOTSTRAP_LINE.format("config.settings.dev")
    assert lines[-1].endswith("[settings=config.settings.dev]")


@pytest.mark.parametrize("value", ["0", "false", "no", "FALSE", "False", "No", "NO"])
def test_an_explicit_off_value_goes_straight_to_the_server(run_entrypoint, value):
    proc, lines = run_entrypoint(RUN_BOOTSTRAP=value)
    assert proc.returncode == 0
    assert [line.split()[0] for line in lines] == ["gunicorn"]


@pytest.mark.parametrize("value", ["1", "true", "yes", "on", "", "off", "disabled", "2"])
def test_any_other_value_still_runs_the_bootstrap(run_entrypoint, value):
    """Only 0, false and no (any case) switch it off: a guess such as RUN_BOOTSTRAP=true or =off must not
    silently start the server on an empty or half-migrated database."""
    proc, lines = run_entrypoint(RUN_BOOTSTRAP=value)
    assert proc.returncode == 0
    assert [line.split()[0] for line in lines] == ["python", "gunicorn"]


def test_a_given_command_replaces_gunicorn_after_the_bootstrap(run_entrypoint):
    proc, lines = run_entrypoint("echo", "from the command line")
    assert proc.stdout == "from the command line\n"
    assert lines == [BOOTSTRAP_LINE.format("config.settings.prod")]


def test_a_failed_bootstrap_stops_the_container_before_the_server_starts(run_entrypoint):
    proc, lines = run_entrypoint(QIP_TEST_PYTHON_EXIT="3")
    assert proc.returncode == 3
    assert [line.split()[0] for line in lines] == ["python"]
