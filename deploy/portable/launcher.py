"""
Launcher of the portable ("green") UAT package; copied to <package>\\app\\launcher.py by build-uat-portable.ps1.

The embedded Python reads python312._pth, so it ignores PYTHONPATH and does not put the script's folder or the current
directory on sys.path. Everything that needs the Django project therefore starts here, and this file puts
<package>\\app\\backend on sys.path first.

  python app\\launcher.py serve  --port 8011     run Django + the static front end with waitress (foreground)
  python app\\launcher.py manage bootstrap       run manage.py <args> from app\\backend
  python app\\launcher.py health --port 8011 --timeout 60     poll /healthz until 200 (exit 0) or time out (exit 1)
  python app\\launcher.py stop                  end the web server of THIS package (used by stop.bat)

`serve` writes its own PID to data\\django.pid and the port to data\\django.port, sends stdout/stderr to
logs\\django.log, and removes both files when it exits.
"""
import argparse
import atexit
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

APP_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(APP_DIR)
BACKEND = os.path.join(APP_DIR, "backend")
FRONTEND = os.path.join(APP_DIR, "web", "out")
DATA = os.path.join(ROOT, "data")
LOGS = os.path.join(ROOT, "logs")
PID_FILE = os.path.join(DATA, "django.pid")
PORT_FILE = os.path.join(DATA, "django.port")
HOST = "127.0.0.1"
RUNTIME = os.path.join(ROOT, "runtime")
FALLBACK_PORTS = (8011, 8012, 8013, 8014, 8015)


def _utf8_streams():
    """Chinese Windows defaults to cp950, which cannot print what Django prints (and mojibakes the logs)."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def _prepare_environment():
    _utf8_streams()
    sys.path.insert(0, BACKEND)
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.prod")
    os.environ.setdefault("FRONTEND_DIST_DIR", FRONTEND)


def cmd_serve(args):
    os.makedirs(DATA, exist_ok=True)
    os.makedirs(LOGS, exist_ok=True)
    log = open(os.path.join(LOGS, "django.log"), "a", buffering=1, encoding="utf-8", errors="replace")
    sys.stdout = log
    sys.stderr = log
    _prepare_environment()
    # The server never needs it; the administrator was created while the package was built.
    os.environ.pop("SEED_ADMIN_PASSWORD", None)

    def _cleanup():
        for path in (PID_FILE, PORT_FILE):
            try:
                os.remove(path)
            except OSError:
                pass

    atexit.register(_cleanup)
    with open(PID_FILE, "w", encoding="ascii") as handle:
        handle.write(str(os.getpid()))
    with open(PORT_FILE, "w", encoding="ascii") as handle:
        handle.write(str(args.port))

    print(f"[launcher] {time.strftime('%Y-%m-%d %H:%M:%S')} starting on http://{HOST}:{args.port}/ pid={os.getpid()}")
    from waitress import serve

    from config.wsgi import application

    serve(application, host=HOST, port=args.port, threads=8, ident="qip-uat")


def cmd_manage(args):
    _prepare_environment()
    os.chdir(BACKEND)
    import runpy

    sys.argv = ["manage.py"] + args.manage_args
    runpy.run_path(os.path.join(BACKEND, "manage.py"), run_name="__main__")


def cmd_health(args):
    url = f"http://{HOST}:{args.port}/healthz"
    deadline = time.time() + args.timeout
    started = time.time()
    last = "no answer yet"
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=3) as response:
                if response.status == 200:
                    print(f"healthz 200 after {time.time() - started:.1f}s")
                    return 0
                last = f"HTTP {response.status}"
        except urllib.error.HTTPError as exc:
            last = f"HTTP {exc.code}"
        except OSError as exc:
            last = str(exc)
        time.sleep(1)
    print(f"healthz did not answer 200 within {args.timeout}s ({last})")
    return 1


def _kernel32():
    import ctypes
    from ctypes import wintypes

    k = ctypes.WinDLL("kernel32", use_last_error=True)
    k.OpenProcess.restype = wintypes.HANDLE
    k.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    k.QueryFullProcessImageNameW.argtypes = (wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR,
                                             ctypes.POINTER(wintypes.DWORD))
    k.TerminateProcess.argtypes = (wintypes.HANDLE, wintypes.UINT)
    k.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
    k.CloseHandle.argtypes = (wintypes.HANDLE,)
    return k


def _image_path(pid):
    """Full path of the executable of process `pid`, or None (no such process / no access)."""
    import ctypes
    from ctypes import wintypes

    k = _kernel32()
    handle = k.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not handle:
        return None
    try:
        size = wintypes.DWORD(32768)
        buf = ctypes.create_unicode_buffer(size.value)
        if not k.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size)):
            return None
        return buf.value
    finally:
        k.CloseHandle(handle)


def _is_package_process(path):
    """True when the executable lies under <package>\\runtime\\ (the package's own python.exe)."""
    if not path:
        return False
    runtime = os.path.normcase(os.path.realpath(RUNTIME)) + os.sep
    return os.path.normcase(os.path.realpath(path)).startswith(runtime)


def _terminate(pid):
    """End this one process (not its tree); True when it was ended."""
    k = _kernel32()
    handle = k.OpenProcess(0x0001 | 0x00100000, False, pid)  # PROCESS_TERMINATE | SYNCHRONIZE
    if not handle:
        return False
    try:
        ok = bool(k.TerminateProcess(handle, 1))
        if ok:
            k.WaitForSingleObject(handle, 10000)
        return ok
    finally:
        k.CloseHandle(handle)


def _listening_pids(port):
    netstat = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32", "netstat.exe")
    try:
        out = subprocess.run([netstat, "-ano", "-p", "TCP"], capture_output=True, text=True, errors="replace").stdout
    except OSError:
        return set()
    pattern = rf"^\s*TCP\s+\S+:{port}\s+\S+\s+LISTENING\s+(\d+)\s*$"
    return {int(m.group(1)) for m in re.finditer(pattern, out, re.M)}


def cmd_stop(args):
    """Stop the web server of THIS package only: a PID is ended only when its executable lies under runtime\\."""
    candidates = []
    if os.path.exists(PID_FILE):
        try:
            with open(PID_FILE, encoding="ascii") as handle:
                candidates.append((int(handle.read().strip()), "pid file"))
        except (OSError, ValueError):
            pass
    else:
        print("No pid file; looking for this package's python.exe on ports 8011-8015 ...")
        for port in FALLBACK_PORTS:
            candidates += [(pid, f"port {port}") for pid in sorted(_listening_pids(port))]
    for pid, source in candidates:
        path = _image_path(pid)
        if path is None:
            print(f"Web server was not running (pid {pid}, {source}).")
        elif not _is_package_process(path):
            print(f"pid {pid} ({source}) belongs to another program ({os.path.basename(path)}): left alone.")
        elif _terminate(pid):
            print(f"Web server stopped (pid {pid}).")
        else:
            print(f"WARNING: could not stop pid {pid}.")
    for path in (PID_FILE, PORT_FILE):
        try:
            os.remove(path)
        except OSError:
            pass
    return 0


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "manage":
        # Hand everything after "manage" to manage.py untouched (argparse would choke on its --options).
        cmd_manage(argparse.Namespace(manage_args=sys.argv[2:]))
        return 0
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[1] if __doc__ else None)
    sub = parser.add_subparsers(dest="command", required=True)
    p_serve = sub.add_parser("serve")
    p_serve.add_argument("--port", type=int, default=8011)
    p_serve.set_defaults(func=cmd_serve)
    sub.add_parser("manage", help="manage.py <args> (handled before argparse, see main)")
    p_health = sub.add_parser("health")
    p_health.add_argument("--port", type=int, default=8011)
    p_health.add_argument("--timeout", type=int, default=60)
    p_health.set_defaults(func=cmd_health)
    sub.add_parser("stop").set_defaults(func=cmd_stop)
    args = parser.parse_args()
    return args.func(args) or 0


if __name__ == "__main__":
    sys.exit(main())
