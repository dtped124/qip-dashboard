# 開發指南

## 🚀 快速開始

### 環境需求
- **Node.js** 18+ (Next.js 14)
- **Python** 3.11+ (Django 5)
- **PostgreSQL** 15+（或 SQLite 開發）
- **Docker Desktop**（選用，生產推薦）
- Windows 10/11、macOS、Linux

### 專案結構
```
qip-dashboard/
├── app/, components/, lib/   ← 前端（Next.js）
├── backend/                   ← 後端（Django）
└── docs/                      ← 本文件夾
```

### 安裝步驟

#### 前端
```bash
# 於專案根目錄
npm install
npm run dev                   # http://localhost:3000
```

#### 後端（本機開發，SQLite）
```bash
cd backend
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate    # macOS/Linux
pip install -r requirements-dev.txt    # 應用程式的相依（requirements.txt）加 pytest、ruff
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver    # http://localhost:8000
```

#### 後端（Docker，PostgreSQL）
```bash
# 於專案根目錄：postgres 5433、redis 6380、api 8001（原始碼 bind mount，存檔自動重載）
docker compose up -d --build
# api 容器每次啟動都先跑 bootstrap：等資料庫 → 建 qip schema → migrate → seed（--only-missing）
# → 有設 SEED_ADMIN_PASSWORD 才建立 admin。進度看 log：
docker compose logs -f api
docker compose exec api python manage.py <指令>
```
Windows 可直接執行 `start.bat`（後端容器＋前端）。映像的相依套件（`backend/requirements.txt`）有變動時要重建：`docker compose build api`。
開發 compose 以 build 引數 `INSTALL_DEV=1` 建映像，所以容器裡有 pytest、ruff（`backend/requirements-dev.txt`）；正式映像不傳這個引數，不含它們。
根目錄的 `.env`（有的話）是開發堆疊的檔案——Compose 會自動讀它來內插 `DB_USER`、`DB_PASSWORD`、`SEED_ADMIN_PASSWORD`；正式堆疊用的是 `.env.prod`，兩者互不共用（見 [DEPLOYMENT.md](DEPLOYMENT.md) §1）。

### 初始帳號與密碼
- **帳號**：員工編號（`employee_id`），如 `admin` 或 `10001`
- **admin**：密碼不寫在程式裡。先設定環境變數 `SEED_ADMIN_PASSWORD`（或用 `--password "…"`），再執行 `python manage.py seed_admin`（`start.bat` 會轉送該變數；已存在的 admin 會略過，`--reset` 才會重設並解除登入鎖定）。密碼須通過密碼規則，建立或重設後 `must_change_password=True`，首次登入強制變更；指令不會印出密碼。
- **其他使用者**：由管理員在帳號管理頁新增；密碼留空 → 系統產生臨時密碼（只顯示一次），`must_change_password=True`。
- **AD 登入**（`LDAP_ENABLED`，預設關閉；鍵與說明見 `backend/.env.example`，啟用步驟見 [DEPLOYMENT.md](DEPLOYMENT.md) §4.1）：`AUTHENTICATION_BACKENDS` 固定是 `[AxesStandaloneBackend, apps.accounts.backends.LdapBackend, ModelBackend]`（不依開關增減）；`LdapBackend` 在關閉或帳號屬於 `LDAP_LOCAL_ONLY_ACCOUNTS` 時讓位給 `ModelBackend`，否則 AD 失敗不會退回本地密碼。AD 客戶端在 `apps/accounts/ldap.py`；pytest 一律關閉 AD 並禁止 `ldap3.Connection`（`backend/conftest.py`），測試登入分支請 monkeypatch `apps.accounts.backends.ldap_authenticate`。連線與帳號比對的檢查用 `docker compose exec -T api python manage.py ldap_check`（`--user <員編>`、`--user <員編> --login`、`--audit`；`--audit` 在清單為空時一定列出 seed `admin`，不算警告，其他管理者查無則結束碼 2）。
- **登入防護**：django-axes——同一帳號失敗 5 次鎖 5 分鐘（`AXES_FAILURE_LIMIT`、`AXES_COOLOFF_MINUTES`，見 `backend/.env.example`）；`python manage.py unlock_account <員編>` 可手動解鎖（不分大小寫，同時清改密碼嘗試計數；axes 計數以小寫儲存，官方 `axes_reset_username` 對含大寫的員編無效，勿用）。經 Next 代理後所有人的來源位址相同，鎖定實際上是「每個帳號」：知道帳號名稱的人就能鎖住它，每次冷卻結束可再鎖（`AXES_IPWARE_*` 在沒裝 django-ipware 時完全無效；真正的 per-IP 限流要在平台邊緣做），細節見 `config/settings/base.py` 的 AXES 註解。session 為閒置逾時 8 小時（`SESSION_COOKIE_AGE`，`SESSION_SAVE_EVERY_REQUEST` 讓每次請求都續期）。
- **變更密碼的猜密碼限制**：`POST /api/auth/change-password` 同一使用者 5 分鐘內連續 5 次沒能證明目前密碼，第 6 次起回 429 `too_many_attempts`，冷卻 5 分鐘（`PASSWORD_CHANGE_FAILURE_LIMIT`、`PASSWORD_CHANGE_COOLOFF_MINUTES`，見 `backend/.env.example`）。管理員重設密碼與 `seed_admin --reset` 會歸零。計數存在 Django cache：`REDIS_URL` 有值用 Redis，留空則用行程內記憶體（每個 worker 各算各的，多 worker 部署請設 `REDIS_URL`）；cache 連不上時放行並記 warning（不會 500）。pytest 一律改用行程內 cache（`backend/conftest.py`），不會碰 Redis。
- **儀表板快取**（`backend/apps/indicators/cache.py`）：`GET /api/v1/dashboard/` 的回應存在 Django cache，第二次起不查資料庫；回應標頭 `X-Dashboard-Cache` 是 `HIT`／`MISS`／`BYPASS`（`curl -i` 或瀏覽器開發者工具就能看到）。`DASHBOARD_CACHE_ENABLED` 預設「有填 `REDIS_URL` 才開」（行程內記憶體清不到別的行程的寫入，例如管理指令），明設 true／false 蓋過；`DASHBOARD_CACHE_TTL` 調保底存活時間（見 `backend/.env.example`）。**新增任何會寫 `Indicator`、`DataPoint`、`Alert`、`YearlySummary`、`TCPIBenchmark` 的程式碼，記得在寫入 commit 之後呼叫 `bump_dashboard_cache()`**（在 `transaction.atomic()` 裡用 `transaction.on_commit(bump_dashboard_cache)`；多步驟且非原子的寫入放進 `try/finally`，寫到一半失敗也要呼叫）。漏了的後果是儀表板最久 `DASHBOARD_CACHE_TTL` 秒內顯示舊資料。改了 `dashboard_bulk` 的回應格式時，部署會清掉快取（bootstrap 跑 `seed_indicators`）；本機要立刻清：`docker compose exec -T api python manage.py shell -c "from apps.indicators.cache import bump_dashboard_cache; bump_dashboard_cache()"`。

### 既有環境升級（上線登入防護 P3 時）
- **套件與資料表**：重建 api 映像（`backend/requirements.txt` 新增 `django-axes==8.3.1`），再執行 `docker compose exec -T api python manage.py migrate`（建立 axes 的資料表；`start.bat` 啟動時本來就會跑 migrate）。
- **舊版建立的 admin**：密碼仍是舊的，而且 `must_change_password=False`，升級不會替你改。請先在 shell 設好 `SEED_ADMIN_PASSWORD`，再執行 `docker compose exec -T -e SEED_ADMIN_PASSWORD api python manage.py seed_admin --reset`：換成新密碼、`must_change_password=True`、解除登入鎖定，下次登入須先變更密碼。
- **既有 `must_change_password=True` 的帳號**（例如管理員建好後從未登入的人）：升級後，除了 `me`、`logout`、`change-password` 以外所有 API 都回 403 `password_change_required`，直到他們改完密碼；登入頁會自動顯示改密碼表單。
- **其他既有帳號**（`must_change_password=False`）不受影響：密碼規則只檢查之後設定的新密碼，不追溯現有密碼；session 則改為閒置逾時 8 小時。

---

## 🏗️ 專案架構

### 前端路由（Next.js App Router）

| 路徑 | 檔案 | 說明 |
|------|------|------|
| `/` | `app/page.tsx` | 儀表板首頁（院區切換、類別分組） |
| `/category/[id]` | `app/category/[id]/page.tsx` | 類別詳情 |
| `/indicators/[code]` | `app/indicators/[code]/page.tsx` | 指標詳情（管制圖、異常列表） |
| `/cross-campus` | `app/cross-campus/page.tsx` | 跨院區季度分析 |
| `/import` | `app/import/page.tsx` | Excel 匯入精靈 |
| `/settings` | `app/settings/page.tsx` | 系統設定首頁 |
| `/settings/tcpi` | - | TCPI 標竿匯入 |
| `/settings/indicators` | - | 指標管理（目標模式開關） |
| `/settings/ai` | - | AI 分析設定 |
| `/entry/login` | - | 填報系統登入 |
| `/entry` | - | 填報總覽 |
| `/entry/[category]` | - | 某面向的填報表單 |
| `/entry/case-list` | - | 個案清單審查 |
| `/entry/review` | - | 審核介面 |
| `/entry/admin` | - | 帳號 / 指派 / 截止日管理 |

### 後端 Blueprint（Django Apps）

| App | Models | Views / URL 前綴 |
|-----|--------|-----------------|
| `accounts` | User | `/api/auth/`、`/api/admin/users` |
| `indicators` | Indicator, DataPoint, YearlySummary, PeerValue, TCPIBenchmark, Alert | `/api/v1/indicators/`、`/api/v1/dashboard/`、`/api/v1/tcpi/` |
| `imports` | ImportLog, MatchingRule | `/api/v1/imports/` |
| `entry` | Campus, ReportCategory, IndicatorAssignment, MonthlyReport, IndicatorEntry, HA10SubEntry, CaseRecord, ExclusionReason, EntryAuditLog, DeadlineSetting, ImportBatch, DataSourceConfig, HISFieldMapping | `/api/entry/`、`/api/review/`、`/api/import/`、`/api/case-list/`、`/api/dashboard/` |
| `analysis` | （無 model，純 service） | - |

### 統計引擎（apps.analysis.services）

| 模組 | 用途 |
|------|------|
| `control_chart.py` | 管制圖選型 + CL/UCL/LCL 計算（P/U/I-MR） |
| `anomaly_detector.py` | Nelson Rule 異常偵測 + 綜合分析 |
| `monthly_change.py` | 月增減變動判定 |
| `peer_comparison.py` | 同儕 / 標竿比較 |
| `aggregation.py` | 月→季彙總（依 data_nature 選邏輯） |
| `trend_calculator.py` | 線性回歸趨勢（up / down / flat） |

---

## 🔐 權限系統

### 三種角色（`apps.accounts.UserRole`）

| 角色 | 值 | 權限 |
|------|---|------|
| 系統管理員 | `admin` | 全部 |
| 品管中心審核者 | `reviewer` | 審核、核准、定稿、排除個案審核 |
| 指標填報者 | `reporter` | 填報自己被指派的指標 |

`User.roles` 為 `JSONField(default=list)`，支援多角色並存。

### 權限判斷範例

```python
def has_role(self, role: str) -> bool:
    return role in self.roles

@property
def is_system_admin(self) -> bool:
    return UserRole.ADMIN in self.roles
```

### View 權限裝飾器

Django 內建 `@login_required` + 自訂 permission 檢查：

```python
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated

@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def my_view(request):
    user = request.user
    if not user.is_system_admin:
        return Response({"error": {"code": "FORBIDDEN"}}, status=403)
    ...
```

### 指派範圍檢查（reporter）

```python
# 查 reporter 可填報的指標
def current_assignments(user, when=None):
    when = when or timezone.now().date()
    return IndicatorAssignment.objects.filter(
        user=user,
        effective_from__lte=when,
    ).filter(Q(effective_to__isnull=True) | Q(effective_to__gt=when))
```

---

## 📊 統計引擎重點

### 管制圖自動選型

```python
# apps/analysis/services/control_chart.py
def select_chart_type(data_nature: str) -> str:
    return {
        "binomial_rate": "P",
        "poisson_rate": "U",
        "continuous":    "I-MR",
    }[data_nature]
```

| 類型 | 適用 | 公式（簡化） |
|------|------|------------|
| P 圖 | 二項比率（%） | CL=p̄, UCL=p̄+3√(p̄(1-p̄)/n) |
| U 圖 | Poisson 密度（‰） | CL=ū, UCL=ū+3√(ū/n) |
| I-MR 圖 | 單點連續資料 | CL=X̄, UCL=X̄+2.66·M̄R |

### 挑戰平均值模式（Target Mode）

```python
# 啟用後，以 target_value 取代 p̄/ū/X̄
target = ind.target_value if ind.target_mode and ind.target_value is not None else None
result = analyze_indicator(..., target_value=target)
```

UCL/LCL 隨之以 target 重算；對應「吳文祥教授 SPC 範本」同名功能。

### 跳過 SPC 的指標

`apps/indicators/constants.py::SKIP_SPC_INDICATORS` — 純計數型（如「給藥錯誤件數」）不畫管制圖，僅以月增減 + 同儕偵測。

### 年均值（分母加權）

```python
# ❌ 錯誤：簡單平均
avg = sum(values) / len(values)

# ✅ 正確：分母加權
with_den = [dp for dp in dps if dp.get("denominator") and dp["denominator"] > 0]
if with_den:
    den_sum = sum(dp["denominator"] for dp in with_den)
    avg = sum(dp["value"] * dp["denominator"] for dp in with_den) / den_sum
else:
    avg = sum(dp["value"] for dp in dps) / len(dps)
```

---

## ⚠️ 開發注意事項

### 1. 民國年 vs 西元年

- **全系統一律使用民國年**（Year=115 表示 2026 年）
- 匯入 / 顯示 / API 皆為民國年
- 轉換函式位於 `lib/utils`（前端）和 Python `utils`（後端）

### 2. 院區 FK 設計

`DataPoint.campus` 採 `CharField` + `choices`，不是 FK，因：
- 儀表板查詢頻繁，避免 JOIN
- 院區選項穩定，不會增刪

`IndicatorAssignment.campus` 則採 FK `entry_campuses`，因需關聯填報系統的 `Campus.benchmark_level`。

### 3. `to_field="code"` 注意

```python
indicator = models.ForeignKey(
    Indicator, on_delete=models.CASCADE,
    to_field="code", db_column="indicator_code",
)
# indicator_id 實際存的是 code 字串（不是 pk）
```

查詢時使用 `indicator_id=code`，不是 `indicator=ind`。

### 4. `Indicator` PATCH 必須重算 Alerts

```python
ind.target_mode = True
ind.save()
_refresh_indicator_alerts(ind)   # ⚠️ 不能省略
```

改 `target_mode` / `target_value` 會改變 UCL/LCL → 改變異常判定 → 舊 Alert 失效。

### 5. TCPI POST 會先清後寫

```python
# apps/indicators/views.py::tcpi_benchmarks
TCPIBenchmark.objects.all().delete()   # ⚠️ 全清
for item in items:
    TCPIBenchmark.objects.create(...)
```

若只要增修單筆 TCPI，需另設端點，目前批次匯入為「覆蓋」語意。

### 6. Excel 匯入錯誤處理

`import_logs.errors` 為 JSON 陣列。警告（如「分母為 0」）也存於此，使用者可透過 `POST /api/v1/imports/correct-datapoint/` 直接修正並從陣列移除該條錯誤文字。

### 7. Next.js Static Export

綠色版用的純靜態匯出已實作，指令與限制見下方〈靜態匯出（綠色版用）〉；舊版的 `STATIC_EXPORT=true` 開關已不存在。

### 8. Dexie IndexedDB schema

```typescript
// lib/db/index.ts
this.version(1).stores({
  indicators: "code, category, is_active",
  dataPoints: "++id, [indicator_code+campus], year, month",
  ...
})
```

schema 升級需 bump version number + 寫 migration callback。

### 9. CSRF Token

前端非 login POST 請求需帶 CSRF：

```typescript
// lib/api.ts
const csrfToken = getCookie("csrftoken");
fetch(url, {
  method: "POST",
  credentials: "include",
  headers: {
    "Content-Type": "application/json",
    "X-CSRFToken": csrfToken,
  },
  body: JSON.stringify(data),
});
```

### 10. 並發填報 race

兩位 reporter 同時編輯同一 `IndicatorEntry` 不會互相覆蓋草稿？
- 目前以 `(report, indicator_code)` unique，後儲存者勝
- `EntryAuditLog` 保留所有欄位異動軌跡，可追溯

建議未來改用 `updated_at` 樂觀鎖（類似 medical-center-tracker 的 `check_optimistic_lock`）。

---

## 🧪 測試

### 後端
```bash
cd backend
python manage.py test apps.analysis         # 統計引擎測試
python manage.py test apps.imports          # Excel parser 測試
```

### 前端
```bash
npm run test:unit    # node --test lib/auth/*.test.ts：角色／路由政策（canAccess、homeFor、routeVerdict、safeNextPath）
```
沒有測試框架：Node 22.18 以上直接執行 `.ts`（內建型別剝除，不用建置）。被測的模組不能有執行期 import（Node 解析不了本專案不帶副檔名的 import 和 `@/` 別名，`import type` 會被剝掉所以可以），測試檔以 `.ts` 副檔名 import 它，`tsconfig.json` 因此開了 `allowImportingTsExtensions`。
其餘元件目前沒有 unit test；建議加入 vitest + React Testing Library。

---

## 🚀 部署

完整說明（本機 production 試跑、必填環境變數、啟動程序、平台待辦）在 [DEPLOYMENT.md](DEPLOYMENT.md)。重點：

### Docker Compose（正式環境樣板）
```bash
# 於專案根目錄；先 cp .env.prod.example .env.prod 並填值（不是 .env：那是開發堆疊的檔案）
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

- 四個服務：`db`、`redis`、`api`（`backend/Dockerfile`，Django + gunicorn）、`web`（`Dockerfile.web`，Next.js standalone）；只有 `web` 對外發佈 port（預設綁 `0.0.0.0`，`WEB_BIND` 可改）。
- project 名稱是 `qip-prod`（檔案頂層的 `name:`），開發堆疊是 `qip-dashboard`：容器、volume、網路各自獨立，同一台機器可以同時存在；唯一會撞的是埠（`WEB_PORT` 預設 3000，和 `npm run dev` 一樣）。
- `DJANGO_SETTINGS_MODULE=config.settings.prod` 是映像的預設；`DJANGO_SECRET_KEY`、`DJANGO_ALLOWED_HOSTS`、資料庫連線、`SEED_ADMIN_PASSWORD` 走環境變數（prod 沒設 `DJANGO_ALLOWED_HOSTS` 會拒絕啟動；`DJANGO_SECRET_KEY` 空的、不足 50 字元或還是範本／開發用的值也會拒絕）。
- 靜態檔由 WhiteNoise 提供；TLS、網域、限流在平台邊緣（見 DEPLOYMENT.md §7）。

### 前端 Next.js
```bash
npm run build
npm start               # SSR 模式（本機）
# 或 Portable（綠色版）
npm run build:export    # → out/，見下方〈靜態匯出（綠色版用）〉
# 容器：docker build -f Dockerfile.web -t qip-web .   （NEXT_OUTPUT=standalone；API_INTERNAL_URL 等在 build 時固化）
```

### 資料庫遷移
```bash
docker compose exec api python manage.py makemigrations
docker compose exec api python manage.py migrate
```

### 初始化
容器啟動時的 `manage.py bootstrap` 會自動做：建 `qip` schema → `migrate` → `seed_entry_base --only-missing`、`seed_indicators --only-missing` → （有 `SEED_ADMIN_PASSWORD` 才）`seed_admin`。手動操作：
1. `python manage.py bootstrap`（可重複執行）
2. 前往 `/settings/tcpi` 匯入 TCPI 標竿

---

## 📦 靜態匯出（綠色版用）

綠色版的同仁電腦跑不了 node.exe，改由嵌入式 Python 的 Django 直接供應前端靜態檔（與 `/api` 同源），所以沒有 Next 伺服器可用，所有頁面都必須在 build 時預先產出。

| | 一般 build（`npm run build`） | 靜態匯出（`npm run build:export`） |
|---|---|---|
| 環境變數 | 無（Docker 用 `NEXT_OUTPUT=standalone`） | `NEXT_OUTPUT=export`（由 `scripts/build-export.mjs` 設定，Windows／Linux 通用） |
| 產出 | `.next/`，需 `next start` 或 standalone server | `out/`：純 HTML／JS／CSS（約 150 頁、5 MB） |
| `rewrites()`（`/api` 轉發 Django） | 有 | **沒有**（export 不支援） |
| `headers()`（HSTS） | 有（`NEXT_HSTS_SECONDS`） | **沒有** |
| `trailingSlash` / `images.unoptimized` | 預設 | `true` / `true`（頁面為 `/x/index.html`） |
| 動態路由未列出的參數 | 照常即時產生、可開 | 404（只有清單內的參數有頁面） |

```bash
npm run build:export        # 產出 out/
python -m http.server 3011 --directory out   # 臨時檢查頁面是否存在（API 不通是正常的）
```

注意事項：

- **`/api` 必須同源由後端供應**：`lib/http.ts` 以相對路徑 `/api/...` 呼叫（`NEXT_PUBLIC_API_URL` 為空），匯出版沒有轉發，供應 `out/` 的 Django 必須同時提供 `/api`。用 `http.server` 開只能看頁面，打 API 會 404。
- **`.next/` 與 `out/` 共用建置快取**：`build:export` 之後要跑 `next start`，需重新 `npm run build`。兩者互不影響各自的行為，但不要在跑著 `next dev`／`next start` 的同一個目錄裡建置。
- **動態路由參數清單**在 `lib/export/staticParams.ts`（純常數），由各動態段資料夾的 `layout.export.tsx` 的 `generateStaticParams` 讀取（client page 不能自己 export 它）：

  | 路由 | 參數來源 | 頁數 |
  |---|---|---|
  | `/category/[id]` | `lib/constants.ts` `CATEGORY_ORDER` | 10 |
  | `/entry/[category]` | `seed_entry_base.py` 面向 HA01–HA10 | 10 |
  | `/entry/review/campus/[campus]/[category]` | `seed_entry_base.py` 院區 × 面向 | 3 × 10 = 30 |
  | `/entry/case-list/[indicator]` | `backend/apps/indicators/constants.py` `INDICATOR_META` | 39 |
  | `/indicators/[code]` | 同上 | 39 |
  | `/davinci/[code]` | `backend/apps/davinci/constants.py` `DAVINCI_INDICATORS`（DV01–DV07） | 7 |

- **同步規則**：後端 seed 變動（新增院區、面向、指標、達文西指標）時，要手動同步 `lib/export/staticParams.ts` 再重新 `build:export`；漏列的指標在綠色版沒有頁面（開了是 404）。透過介面新增、不在 seed 內的指標同樣沒有頁面。
- 這些 `layout.export.tsx` 只在匯出模式被當成 layout（`next.config.mjs` 在 `NEXT_OUTPUT=export` 時才把 `export.tsx` 加進 `pageExtensions`）；一般 build 完全不載入它們，路由表與沒有綠色版時相同（動態路由都是 ƒ），清單外的路徑（例如 `/indicators/ZZ99-99`）仍照常即時產生。

---

## 🐛 除錯

### 資料庫連線錯誤
- PostgreSQL schema `qip` 是否存在？→ `python manage.py bootstrap` 會建立（開發用 postgres 容器另會執行 `init-db.sql`）
- `DB_HOST`：開發 compose 內是 `postgres`，`docker-compose.prod.yml` 內是 `db`，主機上直接跑 `manage.py` 則是 `localhost`（埠 5433）
- 有設 `DATABASE_URL` 時它蓋過 `DB_*`

### CORS
- dev 環境允許 `localhost:3000` 與任何 localhost 埠，見 `config/settings/dev.py`（`CORS_ALLOWED_ORIGINS`、`CORS_ALLOWED_ORIGIN_REGEXES`）
- prod 預設不允許任何跨來源：瀏覽器只連 Next，`/api/*` 由 Next 轉給 Django（同源），不需要 CORS
- 若 cookie 跨域，需設 `CORS_ALLOW_CREDENTIALS = True`

### CSRF 失敗
- login 用 `@csrf_exempt`，其他 POST 需帶 `X-CSRFToken`
- SameSite 設定：dev 可設 `SESSION_COOKIE_SAMESITE = "Lax"`

### 管制圖計算異常
- 檢查資料量是否足夠（`I-MR` 建議 ≥ 12 點）
- `denominator` 是否為 0（P/U 圖需除以 n）
- `SKIP_SPC_INDICATORS` 清單是否含該指標

---

## 📦 版本發布

### 打包
```bash
# 前端 Static Export
STATIC_EXPORT=true npm run build
# out/ 即為可攜資料夾

# 後端 Docker image
docker build -t qip-backend:v2.x backend/
# 前端 Docker image（standalone）
docker build -f Dockerfile.web -t qip-web:v2.x .
```

### 資料庫遷移腳本
如有 schema 變更：
```bash
python manage.py makemigrations entry
python manage.py migrate
```

### Portable 模式匯出
```bash
# 從正在運作的後端匯出
curl http://localhost:8000/api/v1/indicators/export/ > public/data/export.json
# 前端 Static Export 讀取該 JSON 寫入 IndexedDB
```
