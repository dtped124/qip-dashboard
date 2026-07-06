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
pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver    # http://localhost:8000
```

#### 後端（Docker，PostgreSQL）
```bash
cd backend
docker compose up -d
# 初次啟動會執行 init-db.sql 建立 qip schema
docker compose exec web python manage.py migrate
docker compose exec web python manage.py createsuperuser
```

### 預設帳號
- **帳號**：員工編號（`employee_id`），如 `admin` 或 `10001`
- **初始密碼**：員工編號（`must_change_password=True`，首次登入強制變更）

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

```javascript
// next.config.mjs
const nextConfig = {
  output: process.env.STATIC_EXPORT === "true" ? "export" : undefined,
  // ...
}
```

Portable 版本：`STATIC_EXPORT=true npm run build`，資料改從 `/api/v1/indicators/export/` 匯出的 JSON 載入至 IndexedDB。

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
（目前無 unit test；建議加入 vitest + React Testing Library）

---

## 🚀 部署

### Docker Compose（生產）
```bash
cd backend
docker compose -f docker-compose.prod.yml up -d
```

設定：
- `DJANGO_SETTINGS_MODULE=config.settings.prod`
- `DB_HOST`、`DB_PASSWORD`、`SECRET_KEY` 走環境變數
- `ALLOWED_HOSTS` 含部署網域
- nginx 反向代理到 `8000`，靜態檔案從 `STATIC_ROOT` 提供

### 前端 Next.js
```bash
npm run build
npm start               # SSR 模式
# 或 Portable
STATIC_EXPORT=true npm run build   # → out/
```

### 資料庫遷移
```bash
docker compose exec web python manage.py makemigrations
docker compose exec web python manage.py migrate
```

### 初始化
1. `python manage.py migrate`
2. `python manage.py loaddata initial_indicators.json`（若有預設資料）
3. `python manage.py createsuperuser`
4. 前往 `/settings/tcpi` 匯入 TCPI 標竿

---

## 🐛 除錯

### 資料庫連線錯誤
- PostgreSQL schema `qip` 是否存在？→ 跑 `init-db.sql`
- `DB_HOST` 在 docker 內應為 `db`，外部為 `localhost`

### CORS
- dev 環境允許 `localhost:3000`，見 `config/settings/dev.py::CORS_ALLOWED_ORIGINS`
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
