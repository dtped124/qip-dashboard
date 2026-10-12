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
| `build-runtime.ps1` | 建立**完整的嵌入式 runtime**：Python 3.12.10 ＋ `backend\requirements-portable.txt` 的所有 wheel（可重跑、用快取）。 |
| `run-native.ps1` | 開發機用：不經 Docker，用嵌入式 Python ＋ waitress 把後端（含靜態前端 `out\`）跑起來。 |
| `.env.portable.example` | `run-native.ps1`（之後 `start.bat`）讀的環境變數範本；複製成 `.env.portable`（已被 gitignore）。 |

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

## 完整 runtime 與原生執行（方案 C 步驟 3）

目標：Django 用 WhiteNoise 從 `/` 直接提供 Next.js 靜態匯出（`npm run build:export` → `out\`），並用 waitress 在 Windows 原生執行，
同事電腦不需要 node、Docker 或 Redis。前端與 API 同源，所以 CORS／CSRF／cookie 都不用動。

### 建 runtime

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File deploy\portable\build-runtime.ps1            # 要出貨的
powershell -NoProfile -ExecutionPolicy Bypass -File deploy\portable\build-runtime.ps1 -WithTests  # 開發機：加 pytest、pytest-django
```

* 輸出 `local-data\runtime-cache\runtime-full\python\`（約 120 MB 解開；加測試套件約 133 MB）與 `BUILD-INFO.txt`（每個 wheel 的 SHA256）。
  wheel 存在 `local-data\runtime-cache\wheels-full\`，探路包留下的 `wheels\` 會當 `--find-links` 重用。
* 最後一步用**嵌入式** python 實際 `import` 全部套件（django、rest_framework、psycopg、numpy、Levenshtein、ldap3、whitenoise、waitress、axes、environ、openpyxl、xlrd、corsheaders、redis），任何一個失敗腳本就失敗。
* `backend\requirements-portable.txt` 是 `requirements.txt` 的複本：去掉 `gunicorn`（Windows 跑不了），加 `waitress`、`typing_extensions`
  （`pip download` 用建置機的 Python 3.14 判斷環境標記，會漏掉 `python_version<"3.13"` 的相依）。改 `requirements.txt` 時要同步。
  `ldap3` 為 AD 登入（Phase 9 分支）預先放進去，這個分支的程式碼還沒 import 它。
* 嵌入式 Python 因為有 `python312._pth`，**不讀 `PYTHONPATH`、也不把目前目錄或 `manage.py` 所在目錄放進 `sys.path`**。
  所以直接 `python manage.py ...` 會找不到 `config`；`run-native.ps1` 一律用 `python -c`（先 `sys.path.insert(0, backend)` 再 `runpy` 執行 manage.py／waitress）。
  `pytest` 不受影響（`conftest.py` 會把 `backend\` 放進路徑）。

### 原生執行

```powershell
copy deploy\portable\.env.portable.example deploy\portable\.env.portable   # 填資料庫連線（DB_* 或 DATABASE_URL）
powershell -NoProfile -ExecutionPolicy Bypass -File deploy\portable\run-native.ps1
# 只做檢查：  ... run-native.ps1 -CheckOnly
```

流程：`manage.py check` → `migrate --check`（**只檢查，絕不 migrate／seed**；有未套用的 migration 或連不上資料庫就停）→ `collectstatic`
（填 `backend\staticfiles\`，admin 的 CSS／JS 用）→ waitress 綁 `127.0.0.1:8011`（`PORTABLE_HOST`／`PORTABLE_PORT` 可改）。
環境變數優先序：行程環境 ＞ `.env.portable` ＞ 腳本預設（`DJANGO_SETTINGS_MODULE=config.settings.prod`、`DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1`、
`SESSION_COOKIE_SECURE=false`、`CSRF_COOKIE_SECURE=false`、`LDAP_ENABLED=false`、`REDIS_URL` 空、`FRONTEND_DIST_DIR=<repo>\out`；
`DJANGO_SECRET_KEY` 沒給就每次隨機產生，重啟後登入狀態會失效）。

* 這台開發機的 8011 埠常被 Docker 佔用（`com.docker.backend`／`wslrelay` 佔了 `0.0.0.0` 與 `::1`），要同時跑請設 `PORTABLE_PORT`（驗證時用 8012）。
* 路由行為：有斜線的頁面（`/entry/login/`）直接回 HTML，無斜線的（`/entry/login`）回 302 到有斜線；不存在的路徑回 404；Django 的 `/api`、`/admin`、`/healthz` 照舊。
* `_next/static/*` 的 `Cache-Control` 是 WhiteNoise 預設的 `max-age=60`；檔名帶雜湊，要更久可以之後再調。
