"""
Acceptance run of a portable UAT zip (build-uat-portable.ps1 output) on the build machine.

  python deploy/portable/verify-uat-portable.py --zip <qip-uat-portable-*.zip> --passwords <passwords .md> \
         --work <empty scratch folder> [--expect-port-fallback]

It extracts the ZIP (not the staging folder), runs start.bat / stop.bat exactly as a double click would (cmd /c, the final
`pause` fed with Enter), and checks over HTTP and with tasklist / netstat:

  run 1  start -> pages and API -> first-login password change -> account lock -> stop
  run 2  start again -> the data written in run 1 is still there -> stop
  run 3  start twice (second one only reopens) -> kill everything without stop.bat -> start again (stale
         postmaster.pid) -> stop

Passwords are read from the passwords file and the package's .env and are never printed. Exit code 0 = all checks passed.
"""
import argparse
import http.cookiejar
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

RESULTS = []
APPROVED_SQL = "SELECT count(*) FROM qip.entry_monthly_reports WHERE status = 'approved' AND year = 115 AND month IN (9, 11)"


def record(item, ok, detail="", seconds=None):
    RESULTS.append((item, ok, detail, seconds))
    flag = "PASS" if ok else "FAIL"
    extra = f" [{seconds:.1f}s]" if seconds is not None else ""
    print(f"  {flag}  {item}: {detail}{extra}", flush=True)


def listening(port):
    out = subprocess.run(["netstat", "-ano"], capture_output=True, text=True).stdout
    return bool(re.search(rf":{port}\s+\S+\s+LISTENING", out))


def read_passwords(path):
    """{account: password} from the Markdown tables written by uat_seed_testers / build-uat-portable."""
    result = {}
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        cells = [c.strip() for c in line.split("|")]
        if len(cells) >= 5 and "`" in cells[3]:
            result[cells[1]] = cells[3].strip("`")
    return result


class Client:
    def __init__(self, base):
        self.base = base
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def csrf(self):
        for c in self.jar:
            if c.name == "csrftoken":
                return c.value
        return ""

    def request(self, method, path, body=None, timeout=30):
        data = None
        headers = {}
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        if method != "GET" and self.csrf():
            headers["X-CSRFToken"] = self.csrf()
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with self.opener.open(req, timeout=timeout) as resp:
                return resp.status, resp.read()
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read()

    def json(self, method, path, body=None):
        status, raw = self.request(method, path, body)
        try:
            return status, json.loads(raw.decode("utf-8"))
        except ValueError:
            return status, {}


class Package:
    def __init__(self, root):
        self.root = Path(root)

    def run_bat(self, name, env_extra=None, log_name=None):
        env = dict(os.environ)
        env["QIP_NO_BROWSER"] = "1"
        env.update(env_extra or {})
        log = open(self.root.parent / (log_name or f"{name}.out.txt"), "wb")
        proc = subprocess.Popen(["cmd", "/c", str(self.root / name)], cwd=self.root, stdin=subprocess.PIPE,
                                stdout=log, stderr=subprocess.STDOUT, env=env)
        proc.stdin.write(b"\r\n" * 5)  # `echo.|` equivalent: answers the final pause
        proc.stdin.close()
        return proc, log

    def port(self):
        f = self.root / "data" / "django.port"
        return int(f.read_text().strip()) if f.exists() else None

    def db_url_password(self):
        text = (self.root / "app" / "backend" / ".env").read_text(encoding="utf-8")
        m = re.search(r"^DATABASE_URL=postgresql://qip:([^@]+)@", text, re.M)
        return m.group(1)

    def psql(self, sql):
        env = dict(os.environ, PGPASSWORD=self.db_url_password())
        exe = self.root / "runtime" / "pgsql" / "bin" / "psql.exe"
        out = subprocess.run([str(exe), "-h", "127.0.0.1", "-p", "5499", "-U", "qip", "-d", "qip", "-At", "-c", sql],
                             capture_output=True, text=True, env=env)
        return out.stdout.strip()

    def own_processes(self):
        ps = ("Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and "
              f"$_.ExecutablePath.StartsWith('{self.root}', [StringComparison]::OrdinalIgnoreCase) }} | "
              "ForEach-Object { $_.Name + ':' + $_.ProcessId }")
        out = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True).stdout
        return [x.strip() for x in out.splitlines() if x.strip()]


def start(pkg, label, expect_fallback=False):
    """Run start.bat; return (client, port, seconds until /healthz 200, seconds until the bat ended)."""
    t0 = time.time()
    proc, log = pkg.run_bat("start.bat", log_name=f"{label}-start.txt")
    ready = {}

    def watch():
        while time.time() - t0 < 120 and "t" not in ready:
            port = pkg.port()
            if port:
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{port}/healthz", timeout=2) as r:
                        if r.status == 200:
                            ready["t"] = time.time() - t0
                            ready["port"] = port
                            return
                except OSError:
                    pass
            time.sleep(0.25)

    th = threading.Thread(target=watch)
    th.start()
    try:
        proc.wait(timeout=180)
    except subprocess.TimeoutExpired:
        proc.kill()
    bat_seconds = time.time() - t0
    th.join()
    log.close()
    text = (pkg.root.parent / f"{label}-start.txt").read_text(errors="replace")
    port = ready.get("port")
    ok = port is not None
    detail = f"healthz 200 on port {port}" if ok else "no healthz 200 (see the start log)"
    record(f"{label}: start.bat -> /healthz 200", ok, detail, ready.get("t"))
    record(f"{label}: start.bat exit code", proc.returncode == 0, f"exit {proc.returncode}, bat ran {bat_seconds:.1f}s")
    if expect_fallback:
        record(f"{label}: 8011 busy -> automatic fallback", ok and port != 8011 and "port 8011 is in use" in text,
               f"port {port}; message present: {'port 8011 is in use' in text}")
    return (Client(f"http://127.0.0.1:{port}") if ok else None), port, ready.get("t"), text


def stop(pkg, label, port):
    t0 = time.time()
    proc, log = pkg.run_bat("stop.bat", log_name=f"{label}-stop.txt")
    try:
        proc.wait(timeout=120)
    except subprocess.TimeoutExpired:
        proc.kill()
    log.close()
    secs = time.time() - t0
    time.sleep(1)
    leftovers = pkg.own_processes()
    tl = subprocess.run(["tasklist", "/FI", "IMAGENAME eq postgres.exe", "/NH"], capture_output=True, text=True).stdout
    pg_left = "postgres.exe" in tl
    ports = [p for p in (port, 5499) if p and listening(p)]
    pidfile = (pkg.root / "data" / "pgdata" / "postmaster.pid").exists()
    record(f"{label}: stop.bat clean", proc.returncode == 0 and not leftovers and not pg_left and not ports and not pidfile,
           f"exit {proc.returncode}; package processes left: {len(leftovers)}; postgres.exe left: {pg_left}; "
           f"listening: {ports}; postmaster.pid: {pidfile}", secs)


def run1(pkg, passwords, expect_fallback):
    print("== run 1: first start", flush=True)
    client, port, _, _ = start(pkg, "run1", expect_fallback)
    if client is None:
        return None
    status, body = client.request("GET", "/")
    record("run1: GET /", status == 200 and b"<html" in body.lower(), f"HTTP {status}, {len(body)} bytes")
    status, body = client.request("GET", "/entry/login/")
    record("run1: GET /entry/login/", status == 200, f"HTTP {status}")
    status, _ = client.request("GET", "/api/auth/options")
    record("run1: GET /api/auth/options", status in (200, 404), f"HTTP {status} (404 = LDAP branch not in this build; "
           "200 would carry ldap_enabled)")
    status, _ = client.request("GET", "/api/auth/me")
    record("run1: GET /api/auth/me anonymous", status in (401, 403), f"HTTP {status}")
    static_js = next((pkg.root / "app" / "web" / "out" / "_next" / "static").rglob("*.js"))
    rel = static_js.relative_to(pkg.root / "app" / "web" / "out").as_posix()
    status, _ = client.request("GET", "/" + rel)
    record("run1: GET /_next/static js", status == 200, f"HTTP {status} /{rel[:40]}...")
    status, _ = client.request("GET", "/static/admin/css/base.css")
    record("run1: GET /static/admin/css/base.css", status == 200, f"HTTP {status}")

    # admin: login ok, must change password, dashboard gated
    status, data = client.json("POST", "/api/auth/login", {"employee_id": "admin", "password": passwords["admin"]})
    record("run1: admin login", status == 200 and data.get("must_change_password") is True,
           f"HTTP {status}, must_change_password={data.get('must_change_password')}")
    status, data = client.json("GET", "/api/v1/dashboard/")
    record("run1: dashboard behind the password gate", status == 403 and data.get("code") == "password_change_required",
           f"HTTP {status} code={data.get('code')}")

    # a tester: change the password, then the dashboard answers 200
    tester = next((k for k in passwords if k.startswith("UT") and k == "UT01"), None)
    new_pw = None
    if tester:
        tc = Client(client.base)
        tc.request("GET", "/api/auth/me")  # sets the csrf cookie
        status, data = tc.json("POST", "/api/auth/login", {"employee_id": tester, "password": passwords[tester]})
        record(f"run1: {tester} first login", status == 200 and data.get("must_change_password") is True, f"HTTP {status}")
        tc.request("GET", "/api/auth/me")
        new_pw = "Ut-Verify-Pass-2026!x"
        status, data = tc.json("POST", "/api/auth/change-password",
                               {"current_password": passwords[tester], "new_password": new_pw})
        record(f"run1: {tester} changes password", status == 200, f"HTTP {status}")
        status, _ = tc.request("GET", "/api/v1/dashboard/")
        record(f"run1: {tester} dashboard after the change", status == 200, f"HTTP {status}")
        status, _ = tc.request("GET", "/api/entry/my-tasks")
        record(f"run1: {tester} my-tasks", status == 200, f"HTTP {status}")

    sessions = {}

    def login(name):
        c = Client(client.base)
        c.request("GET", "/api/auth/me")  # csrf cookie
        status, data = c.json("POST", "/api/auth/login", {"employee_id": name, "password": passwords[name]})
        record(f"run1: {name} login", status == 200 and data.get("must_change_password") is False,
               f"HTTP {status}, must_change_password={data.get('must_change_password')}, roles={data.get('roles')}")
        c.request("GET", "/api/auth/me")
        sessions[name] = c

    for name in ("uat_viewer", "uat_reporter_num", "uat_reporter_den", "uat_reporter_both", "uat_reviewer",
                 "uat_admin", "demo_a", "demo_b", "demo_r"):
        if name in passwords:
            login(name)

    v = sessions.get("uat_viewer")
    if v:
        status, _ = v.request("GET", "/api/v1/dashboard/")
        record("run1: uat_viewer dashboard", status == 200, f"HTTP {status}")
        status, _ = v.request("GET", "/api/entry/my-tasks")
        record("run1: uat_viewer cannot use the entry API", status == 403, f"HTTP {status}")
    adm = sessions.get("uat_admin")
    if adm:
        status, data = adm.json("GET", "/api/admin/users")
        record("run1: uat_admin account list", status == 200 and isinstance(data, list), f"HTTP {status}")
        status, _ = adm.json("GET", "/api/admin/assignments")
        record("run1: uat_admin assignment list", status == 200, f"HTTP {status}")

    def save(c, category, entries, month=9):
        return c.json("POST", "/api/entry/save-draft", {"year": 115, "month": month, "category": category,
                                                        "campus": "zhubei", "entries": entries})

    def submit(c, category, month=9):
        return c.json("POST", "/api/entry/submit", {"year": 115, "month": month, "category": category,
                                                    "campus": "zhubei"})

    def review(c, action, category, month=9, **extra):
        body = {"campus": "zhubei", "year": 115, "month": month, "category": category}
        body.update(extra)
        return c.json("POST", f"/api/review/{action}", body)

    c, r = sessions.get("uat_reporter_both"), sessions.get("uat_reviewer")
    if c and r:  # flow A: one account owns numerator and denominator (HA01), the reviewer approves
        st1, _ = save(c, "HA01", [{"indicator_code": "HA01-01", "numerator": 3, "denominator": 100},
                                  {"indicator_code": "HA01-02", "numerator": 2, "denominator": 80}])
        st2, d2 = submit(c, "HA01")
        st3, d3 = review(r, "approve", "HA01")
        record("run1: flow HA01 save, submit, reviewer approves", (st1, st2, st3) == (200, 200, 200),
               f"HTTP {st1}/{st2}/{st3} {d2.get('code', '')} {d3.get('detail', '')}")
    n, dn, da, db = (sessions.get(k) for k in ("uat_reporter_num", "uat_reporter_den", "demo_a", "demo_b"))
    if n and dn and da and db and r:  # flow B: numerator and denominator belong to different people (HA03)
        s1, _ = save(n, "HA03", [{"indicator_code": "HA03-01", "numerator": 1},
                                 {"indicator_code": "HA03-02", "numerator": 1}], month=11)
        s2, _ = save(dn, "HA03", [{"indicator_code": "HA03-01", "denominator": 50},
                                  {"indicator_code": "HA03-02", "denominator": 50}], month=11)
        s3, d3 = submit(dn, "HA03", month=11)
        record("run1: flow HA03 num+den saved, submit refused while HA03-03 is open",
               (s1, s2) == (200, 200) and s3 == 400 and d3.get("code") == "incomplete",
               f"HTTP {s1}/{s2}/{s3} code={d3.get('code')}")
        s4, _ = save(da, "HA03", [{"indicator_code": "HA03-03", "numerator": 1}], month=11)
        s5, _ = save(db, "HA03", [{"indicator_code": "HA03-03", "denominator": 20}], month=11)
        s6, _ = submit(dn, "HA03", month=11)
        s7, d7 = review(r, "reject", "HA03", month=11, reason="verify reject")
        s8, _ = submit(dn, "HA03", month=11)
        s9, d9 = review(r, "approve", "HA03", month=11)
        record("run1: flow HA03 completed by demo_a/demo_b, submit, reject, resubmit, approve",
               (s4, s5, s6, s7, s8, s9) == (200,) * 6, f"HTTP {s4}/{s5}/{s6}/{s7}/{s8}/{s9} {d7.get('detail', '')}")
    status, _ = Client(client.base).request("GET", "/api/v1/dashboard/")
    record("run1: dashboard anonymous", status in (401, 403), f"HTTP {status}")

    # lockout: five wrong passwords, then even the right one is refused
    lock_user = "UT02" if "UT02" in passwords else "uat_viewer"
    lc = Client(client.base)
    codes = []
    for _ in range(5):
        codes.append(lc.json("POST", "/api/auth/login", {"employee_id": lock_user, "password": "wrong-password-1"})[0])
    status, _ = lc.json("POST", "/api/auth/login", {"employee_id": lock_user, "password": passwords[lock_user]})
    record("run1: 5 wrong passwords lock the account", codes[-1] == 429 or status == 429,
           f"statuses {codes}, then the right password -> HTTP {status}")

    users = pkg.psql("SELECT count(*) FROM qip.auth_users")
    record("run1: accounts in the database", users.isdigit(), f"{users} accounts")
    approved = pkg.psql(APPROVED_SQL)
    record("run1: approved reports are in the database", approved == "2", f"{approved} approved")
    stop(pkg, "run1", port)
    return {"users": users, "tester": tester, "new_pw": new_pw, "approved": approved}


def run2(pkg, passwords, state):
    print("== run 2: second start, data must still be there", flush=True)
    client, port, _, _ = start(pkg, "run2")
    if client is None:
        return
    users = pkg.psql("SELECT count(*) FROM qip.auth_users")
    record("run2: same number of accounts", state and users == state["users"], f"{users} (run 1: {state['users']})")
    if state.get("tester"):
        status, data = client.json("POST", "/api/auth/login", {"employee_id": state["tester"], "password": state["new_pw"]})
        record("run2: the changed password survived", status == 200 and data.get("must_change_password") is False,
               f"HTTP {status}")
    approved = pkg.psql(APPROVED_SQL)
    record("run2: approved reports survived the restart", approved == state["approved"], f"{approved} approved")
    status, data = client.json("POST", "/api/auth/login", {"employee_id": "admin", "password": passwords["admin"]})
    record("run2: admin login", status == 200, f"HTTP {status}")
    status, data = client.json("POST", "/api/auth/login",
                               {"employee_id": "uat_viewer", "password": passwords["uat_viewer"]})
    record("run2: the account locked in run 1 is still locked", status == 429, f"HTTP {status}")
    status, data = client.json("POST", "/api/auth/login",
                               {"employee_id": "uat_reviewer", "password": passwords["uat_reviewer"]})
    record("run2: uat_reviewer login", status == 200 and data.get("must_change_password") is False, f"HTTP {status}")
    stop(pkg, "run2", port)


def run3(pkg):
    print("== run 3: start twice, then crash recovery", flush=True)
    client, port, _, _ = start(pkg, "run3")
    if client is None:
        return
    proc, log = pkg.run_bat("start.bat", log_name="run3-start-again.txt")
    proc.wait(timeout=60)
    log.close()
    again = (pkg.root.parent / "run3-start-again.txt").read_text(errors="replace")
    record("run3: second start.bat only reopens", "Already running" in again and proc.returncode == 0,
           "message 'Already running' present" if "Already running" in again else "message missing")
    # crash: kill everything that belongs to the package without stop.bat
    for entry in pkg.own_processes():
        pid = entry.rsplit(":", 1)[1]
        subprocess.run(["taskkill", "/PID", pid, "/F"], capture_output=True)
    time.sleep(2)
    stale = (pkg.root / "data" / "pgdata" / "postmaster.pid").exists()
    record("run3: crash left a stale postmaster.pid", stale, f"postmaster.pid present: {stale}")
    client, port, _, text = start(pkg, "run3b")
    record("run3: restart after the crash", client is not None and "Removing stale postmaster.pid" in text,
           "stale pid removed and the server came up" if client else "did not come up")
    if client is not None:
        status, _ = client.request("GET", "/entry/login/")
        record("run3: login page after recovery", status == 200, f"HTTP {status}")
    stop(pkg, "run3b", port)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", required=True)
    ap.add_argument("--passwords", required=True)
    ap.add_argument("--work", required=True)
    ap.add_argument("--expect-port-fallback", action="store_true")
    ap.add_argument("--results", help="write a JSON summary here")
    args = ap.parse_args()

    work = Path(args.work)
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    t0 = time.time()
    with zipfile.ZipFile(args.zip) as z:
        z.extractall(work)
    tops = [p for p in work.iterdir() if p.is_dir()]
    record("extract zip", len(tops) == 1 and (tops[0] / "start.bat").exists(),
           f"{tops[0].name if tops else '?'} , {sum(1 for _ in tops[0].rglob('*') if _.is_file())} files", time.time() - t0)
    pkg = Package(tops[0])
    passwords = read_passwords(args.passwords)
    if args.expect_port_fallback:
        record("precondition: port 8011 is occupied", listening(8011), "needed to prove the fallback")

    state = run1(pkg, passwords, args.expect_port_fallback)
    if state:
        run2(pkg, passwords, state)
    run3(pkg)

    failed = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(failed)} passed, {len(failed)} failed")
    if args.results:
        Path(args.results).write_text(json.dumps(
            [{"item": i, "ok": ok, "detail": d, "seconds": s} for i, ok, d, s in RESULTS], ensure_ascii=False, indent=1),
            encoding="utf-8")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
