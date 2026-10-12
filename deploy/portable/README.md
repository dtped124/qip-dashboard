# deploy/portable - portable ("green") UAT build tooling

Scripts for building a no-install, no-admin Windows package of qip-dashboard so that colleagues on locked-down
hospital PCs can try it before go-live (plan: `~/.claude/plans/deep-chasing-thompson.md`, option C).
Nothing here is used by the normal Docker / `start.bat` deployment.

## Contents

| Path | Purpose |
|---|---|
| `build-probe.ps1` | Builds the **probe pack** `qip-probe-<yyyymmdd>.zip` (PowerShell 5.1, re-runnable). |
| `probe/probe.bat` | Copied into the pack. Double-click test that writes `probe-result.txt`. |
| `probe/README-探路包說明.txt` | Copied into the pack. Instructions for the colleague (Traditional Chinese, UTF-8 with BOM). |

## The probe pack

It answers, on a real hospital PC (standard user, no admin, nothing installed):

1. Does the embedded Python 3.12 run? (`PYTHON`)
2. Can it load compiled packages: numpy, psycopg (binary), ldap3? (`PYTHON_IMPORTS`)
3. Can a portable PostgreSQL 16 `initdb` / start / query / stop? (`PG_*`; `PG_PYTHON_CONNECT` is an extra check)

It also records whether the machine has `%SystemRoot%\System32\msvcp140.dll` / `vcruntime140*.dll`.
Result: **OK/OK/OK** means the plan can use portable PostgreSQL; PG fails but Python passes means fall back to SQLite;
Python imports fail means rethink (see the plan's checklist).

### Build

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File deploy\portable\build-probe.ps1
```

* Needs: PowerShell 5.1+, internet access to `python.org`, `files.pythonhosted.org` (via `pip download`) and
  `get.enterprisedb.com`, and a local `python` with `pip` (only used to fetch wheels while the wheel cache is empty;
  the target machine never runs pip).
* Refuses to run with less than 15 GB free on the cache drive (`-MinFreeGB`).
* Output: `local-data\uat\qip-probe-<yyyymmdd>.zip` (+ `.sha256`), about 60 MB, top folder `qip-probe\`.
  The zip itself is not byte-reproducible (timestamps), the inputs are.
* A second run downloads nothing: every cached file is re-verified against its pinned SHA256 ("cache hit").

### Where things live (all gitignored via `local-data/`)

`local-data` is resolved to the **main working tree** (`git rev-parse --git-common-dir`), also when run from a worktree.
Override with `-CacheDir` / `-OutDir`.

| What | Location |
|---|---|
| Download cache | `local-data\runtime-cache\` (`python-*-embed-amd64.zip`, `postgresql-*-windows-x64-binaries.zip`, `wheels\*.whl`) |
| Assembly folder (rebuilt each run) | `local-data\runtime-cache\stage-probe\qip-probe\` |
| Finished zip | `local-data\uat\` |

### Pinned versions

Pins are at the top of `build-probe.ps1` (`$PyVersion`, `$PgVersion`, `$WheelReqs`, and the `$Pins` SHA256 table).
To upgrade: change the version, set the SHA256 to `''`, run once (the script prints the new hash), paste the hash in.

| Component | Pin | Note |
|---|---|---|
| Embedded Python | 3.12.10 amd64 | last 3.12.x with Windows binaries (3.12.11+ is 404) |
| PostgreSQL | 16.15-5 (EDB binaries zip) | only `bin\`, `lib\`, `share\` kept; StackBuilder/wx DLLs and `*.lib` removed |
| numpy / psycopg(-binary) / ldap3 / pyasn1 / tzdata / typing_extensions | 2.5.4 / 3.3.6 / 2.9.1 / 0.6.4 / 2026.5 / 4.16.0 | cp312 win_amd64 wheels, unzipped into `Lib\site-packages` |

Notes for whoever extends this into the full UAT package:

* `python312._pth` is edited (`import site` enabled, `Lib\site-packages` added) so wheels are just unzipped, not installed.
* `pip download` evaluates environment markers for the *build* machine's Python (3.14), so conditional dependencies
  such as `typing_extensions` (needed by psycopg on Python < 3.13) must be listed in `$WheelReqs` by hand.
  The probe caught exactly this.
* No DLL is copied from the build machine. Embedded Python ships `vcruntime140.dll` / `vcruntime140_1.dll`, numpy's wheel
  bundles its own `msvcp140`; the PostgreSQL binaries do **not** ship the VC++ runtime and need the system's
  `msvcp140.dll` (loaded through the ICU DLLs) and `vcruntime140.dll`. Whether to bundle them
  (redistributable under the Microsoft VC++ Redistributable terms) is a decision for the full package.
* The PostgreSQL trial runs on port 5499, bound to 127.0.0.1, `trust` auth, superuser `qip`, empty cluster, and the data
  directory is deleted on success.
