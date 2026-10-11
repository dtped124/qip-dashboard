# 更新日誌 (CHANGELOG)

## 雲端化 P3 — 登入防護與密碼政策（2026-10-11，`feat/auth-hardening`）

### ✨ 新功能 / 改進
- **登入鎖定**（django-axes 8.3.1）：同一帳號連續失敗 5 次鎖 5 分鐘（`AXES_FAILURE_LIMIT`、`AXES_COOLOFF_MINUTES`）；從第 5 次失敗起回 429 `locked`，訊息中的分鐘數取自設定；鎖定期間的嘗試不延長鎖定；登入成功會重置；重設密碼、`seed_admin --reset`、`manage.py axes_reset_username` 都能解鎖；Django 後台登入共用同一個計數
- **密碼政策**（`AUTH_PASSWORD_VALIDATORS`）：至少 10 字元、不得為常見密碼、不得全為數字、不得與帳號／姓名／Email 相似；套用於變更密碼、建立帳號、`seed_admin` 與 Django 後台
- **重設密碼改為隨機臨時密碼**（至少 12 字元，含大小寫、數字、符號）：只在回應中出現一次、不寫 log、不存明文；該使用者所有現有 session 隨之失效
- **強制改密碼**：`must_change_password` 為 true 時，除 `me` / `logout` / `change-password` 外所有 API 一律 403 `password_change_required`（DRF 與純 Django view 同一個閘門）；變更密碼必須帶 `current_password`
- 建立帳號時密碼改為選填（留空 → 系統產生臨時密碼）；`roles` 只接受 `UserRole` 的清單；管理員不能停用自己或拿掉自己的 admin 角色
- **session 改為閒置逾時**（預設 8 小時，每次請求續期，`SESSION_COOKIE_AGE` + `SESSION_SAVE_EVERY_REQUEST`）
- **前端**：帳號管理的臨時密碼視窗（只顯示一次、可複製）；登入頁的強制改密碼表單（重新整理後仍會出現，可登出）；`AuthGuard` 把必須改密碼的使用者導回登入頁

### 🔐 安全性
- 移除寫死在原始碼裡的預設密碼（`seed_admin` 的預設 admin 密碼、重設密碼的固定字串）；`seed_admin` 改讀 `--password` 或環境變數 `SEED_ADMIN_PASSWORD`，不再印出密碼；`start.bat` 不再顯示密碼；根目錄 `.gitignore` 加入 `.env`
- 已知限制：經 Next 代理後所有人的來源位址相同，鎖定實際上是「每個帳號」，知道帳號名稱的人能鎖住它（鎖定期間的嘗試不會延長鎖定，管理員可立即解鎖）；`AXES_IPWARE_*` 在沒裝 django-ipware 時無效；per-IP 限流要在平台邊緣（LB / WAF）做

### 📁 修改檔案
| 檔案 | 修改內容 |
|------|---------|
| `backend/config/settings/base.py` | axes（app / middleware / backend / `AXES_*`）、`AUTH_PASSWORD_VALIDATORS`、session 閒置逾時 |
| `backend/apps/accounts/lockout.py`（新） | axes 的帳號名稱與 429 回應 callable、`AccountLocked`、`unlock_account` |
| `backend/apps/accounts/passwords.py`（新） | `password_problems`、`generate_temporary_password` |
| `backend/apps/accounts/{permissions,serializers,views}.py` | 改密碼閘門、登入走 axes、變更密碼／建立帳號／roles 驗證、重設密碼 |
| `backend/apps/accounts/management/commands/seed_admin.py` | 密碼來源改為 `--password` / `SEED_ADMIN_PASSWORD`，不印密碼 |
| `backend/apps/accounts/tests/test_auth_hardening.py`（新） | 鎖定、閘門、密碼規則、帳號管理、`seed_admin` 測試 |
| `app/entry/login/page.tsx`、`components/entry/UserManagement.tsx`、`components/layout/AuthGuard.tsx` | 強制改密碼流程、臨時密碼視窗 |
| `start.bat`、`docker-compose.yml`、`backend/.env.example` | `SEED_ADMIN_PASSWORD` 轉送、AXES / session 設定範例 |

---

## 雲端化 P2 — 登入與角色權限（2026-10-11，`feat/backend-permissions`，PR #8）

### ✨ 新功能 / 改進
- **所有 `/api/` 預設需登入**（DRF `IsAuthenticatedPasswordOK`），57 條路由逐一登記權限決定（只有登入開放匿名）：admin 通過所有檢查，Django 的 `is_staff` 不再授予任何 API 權限；純 Django view 以 `require_roles` 保護
- 新增 `viewer`（儀表板檢視者）角色；達文西逐案端點（`cases/`、`export/`）限 reviewer｜admin，`import/logs/` 限 admin
- 認證／權限／CSRF 錯誤統一為 `{"detail", "code"}`（`not_authenticated`、`permission_denied`、`csrf_failed`）；CSRF 失敗改回 JSON
- 移除 imports 與 davinci 上傳端點的 `csrf_exempt`（登入是唯一例外）
- 前端：`lib/auth/roles.ts`（`homeFor`／`canAccess`）、登入頁依角色導頁、沒有角色的帳號登入後立即登出並說明、`lib/http.ts` 透傳後端的 `code`

### 🐛 Bug 修正
- `entry-benchmarks` 500（把 DRF Request 傳給另一個 `@api_view`）
- 損毀的 Excel 上傳回 500 → 改回 400 `BAD_FILE`

### ✅ 測試
- 130 條權限測試，含以 URL resolver 列舉所有 `/api/` 路由的 meta-test：新增端點若沒登記權限，測試會失敗

---

## 雲端化 P1 — 同源 API 代理與統一 HTTP client（2026-10-11，`feat/same-origin-api`）

### ✨ 新功能 / 改進
- `lib/http.ts`：統一的 fetch 封裝（帶 cookies、CSRF header、逾時、`ApiError` 錯誤解析、檔案下載）；前端所有 API 呼叫都改走它，移除 `NEXT_PUBLIC_API_URL` 預設值與直連 `localhost:8001` 的 fetch
- `next.config.mjs`：以 rewrites 把 `/api/*` 代理到 Django（`API_INTERNAL_URL`），保留結尾斜線、代理逾時 120 秒、可選 standalone 輸出 → 瀏覽器只呼叫同源的相對路徑，session 與 CSRF cookie 在同一個 origin，不再需要 CORS
- Django：`USE_X_FORWARDED_HOST`（可由環境變數控制）、`/api/auth/me` 設定 csrftoken cookie

### 🐛 Bug 修正
- TCPI POST 改讀 `request.data`（帶 session cookie 時讀 `request.body` 會丟 `RawPostDataException`）

---

## v2.x (2026-04-18) — SPC 目標模式 + 標籤校準合併至 master

### ✨ 新功能 / 改進
- **挑戰平均值模式（Target Mode）**：
  - `Indicator` 新增 `target_mode` / `target_value` 欄位
  - 啟用後以 `target_value` 取代統計算出的 p̄/ū/X̄ 作為 CL，UCL/LCL 重新計算
  - 對應吳文祥教授 SPC 範本同名機制
  - PATCH `/api/v1/indicators/{code}/` 支援更新
  - 更新後自動重算所有院區的 `Alert`（`_refresh_indicator_alerts()`）

### 🐛 Bug 修正
- **年均值改用分母加權平均**：原本簡單平均在分母差距大時偏誤，改為 `Σ(值×分母)/Σ(分母)`
- **匯入警告展開修正**：`ImportLog.errors` 陣列警告可展開檢視，並提供單筆修正 UI
- **DB 匯出端點**：新增 `/api/v1/indicators/export/` 匯出所有資料供 Portable 版本載入
- **指派解析修正**：`resolve campus from indicator assignments and fix control chart / entry bugs`

### 📁 修改檔案
| 檔案 | 修改內容 |
|------|---------|
| `backend/apps/indicators/models.py` | Indicator 新增 target_mode / target_value |
| `backend/apps/indicators/views.py` | indicator_detail 支援 PATCH；dashboard_bulk 年均值加權；export_all_data 新增 |
| `backend/apps/analysis/services/control_chart.py` | 支援 target_value 參數重算 CL/UCL/LCL |
| `backend/apps/analysis/services/anomaly_detector.py` | analyze_indicator 新增 target_value 參數 |
| `app/settings/indicators/` | 挑戰平均值模式開關 UI |

---

## v2.0 — 填報系統完整實作（e7e4554）

### ✨ 新功能
- **自訂使用者模型**（`apps.accounts.User`）
  - `employee_id` 為登入識別（取代 username）
  - `roles` JSONField，支援多角色並存（reporter / reviewer / admin）
  - `must_change_password` 首次登入強制改密碼
  - 所屬院區（`campus` FK）
- **帳號管理 API**
  - `/api/auth/login`（豁免 CSRF）
  - `/api/auth/logout`、`/me`、`/change-password`
  - `/api/admin/users` CRUD + 重設密碼
- **院區與面向**
  - `Campus` 模型（新竹 / 竹北 / 竹東，含 benchmark_level）
  - `ReportCategory` 模型（HA01-HA10 + 色碼 + 排序）
- **指派機制**
  - `IndicatorAssignment`：指標 × 院區 × 負責人
  - 支援正職（primary）+ 代理人（deputy）雙軌
  - 生效期間（`effective_from` / `effective_to`）
- **月報與填報**
  - `MonthlyReport`：院區 × 年 × 月 × 面向的填報單元
  - 五階段狀態流：`unfilled → draft → submitted → approved → finalized`
  - `IndicatorEntry`：分子 / 分母 / 自動計算值 / 備註
  - `HA10SubEntry`：HA10 經營管理的 13 項子類別
- **審核流程**
  - `/api/review/overview`：總覽矩陣（院區 × 面向）
  - `/api/review/approve` / `/reject` / `/edit-entry`
  - `/api/review/finalize`：定稿同步至 `data_points`
  - `/api/review/unlock`：admin 解鎖已定稿
- **個案清單路徑**
  - `CaseRecord`：HIS 原始資料 JSON
  - `ExclusionReason`：預設排除理由
  - 二階段審核：reporter 申請排除 → reviewer 核准
  - `raw_numerator` / `raw_denominator` / `exclusion_count`
- **修改紀錄**
  - `EntryAuditLog`：欄位級異動追蹤（field_name / old → new / 修改者 / 理由）
- **填報截止日**
  - `DeadlineSetting`：逐月設定，支援春節延長等備註
- **資料匯入（填報系統版）**
  - `/api/import/excel`：上傳 + 預覽 + 確認
  - `/api/import/batches`：匯入批次紀錄
  - HIS webhook 端點預留（`/api/import/his-trigger`、`/his-webhook`）
  - `DataSourceConfig` + `HISFieldMapping`：HIS 串接設定

### 📁 新增資料表
| 資料表 | 說明 |
|-------|------|
| `auth_users` | 使用者（取代 Django 預設） |
| `entry_campuses` | 院區 |
| `entry_categories` | 填報面向 |
| `entry_assignments` | 指標負責人指派 |
| `entry_monthly_reports` | 月報表頭 |
| `entry_indicator_entries` | 指標數據 |
| `entry_ha10_sub_entries` | HA10 子類別 |
| `entry_exclusion_reasons` | 排除理由選項 |
| `entry_case_records` | 個案紀錄 |
| `entry_audit_logs` | 修改紀錄 |
| `entry_deadline_settings` | 截止日 |
| `entry_import_batches` | 匯入批次 |
| `entry_data_source_configs` | HIS 資料來源 |
| `entry_his_field_mappings` | HIS 欄位對應 |

### 📁 新增頁面
| 路徑 | 說明 |
|------|------|
| `/entry/login` | 登入 |
| `/entry` | 我的任務 |
| `/entry/[category]` | 面向填報表單 |
| `/entry/case-list` | 個案清單審查 |
| `/entry/review` | 審核總覽 |
| `/entry/admin` | 帳號 / 指派 / 截止日管理 |

---

## v1.x — AI 解析修正、季平均計算、Word 報告匯出（0a40e09）

### ✨ 新功能
- **Word 報告匯出**：指標詳情頁可匯出 Word 文件，含管制圖截圖、異常列表、改善建議
- **季平均計算**：月→季彙總邏輯依 `data_nature` 分流
  - `binomial_rate` / `poisson_rate`：分子/分母加總後重算比率
  - `continuous`（加總型）：月值加總
  - `continuous`（平均型）：加權平均
- **AI 解析修正**：Claude API 回應的結構化解析

---

## v1.x — 跨院區季度分析、AI 分析整合、季度管制圖（3eba7b7）

### ✨ 新功能
- **跨院區季度分析頁**（`/cross-campus`）
  - 三院區同指標並列比較
  - 「先報喜再報憂」排序：進步指標優先
- **季度管制圖**：月資料先彙總為季後重算 CL/UCL/LCL
- **AI 深度分析整合**：指標詳情頁的 AI 面板，基於當前指標資料提供改善建議
- **AI 分析快取**：相同輸入避免重複呼叫 Claude API

---

## v1.x — Django REST 後端遷移（ead0f46）

### 🔄 架構重構
- 從 Next.js 純前端 + IndexedDB，遷移為 **Next.js 前端 + Django REST 後端**
- 後端 App 結構：accounts / indicators / imports / entry / analysis
- Docker Compose 部署（web + db + nginx）
- `init-db.sql`：PostgreSQL schema `qip` 初始化
- 統計引擎從 TypeScript 移植為 Python（`apps.analysis.services`）
- 向後相容：前端仍可透過 `export.json` 載入 IndexedDB（Portable 模式）

---

## v1.0 — QIP 監測指標儀表板初版（06343ef）

### ✨ 功能
- **Next.js 14 App Router** 基礎架構
- **儀表板首頁**：三院區切換、10 大類別分組、三種視圖
- **指標詳情頁**：SPC 管制圖、趨勢、同儕比較
- **SPC 統計引擎**（TypeScript）
  - P 圖、U 圖、I-MR 圖自動選型
  - Nelson Rule 異常偵測
  - 月增減、同儕比較
- **Excel 匯入**：17 張工作表解析（111-115 年）
- **指標名稱模糊比對**：使用者確認後寫入 `matching_rules`
- **TCPI 標竿匯入**：批次覆蓋模式
- **六級燈號系統**：excellent / good / watch / warning / alert / neutral
- **年度趨勢圖**、**Sparkline 迷你圖**
- **IndexedDB**（Dexie）本地快取

### 📊 初版指標統計
- 指標數：55+（HA01-HA10 十大類別）
- 院區數：3（新竹、竹北、竹東）
- 歷史資料：111-115 年共 5 年

---

## v0.1 — 初始化（47f1c7d）

- `create-next-app` 建立 Next.js 14 專案骨架
- TailwindCSS + TypeScript 基礎設定

---

## 📝 版本號規則

- **v0.x**：初始化階段
- **v1.x**：前端純 IndexedDB 版本
- **v2.x**：Django REST 後端 + 填報系統完整功能
- **v2.x-post**：補強版本（SPC 目標模式、匯出端點等）

## 🔗 相關分支

- `master`：主線（已整合 `feat/spc-target-mode-and-label-calibration`）
- 歷次功能分支：`feat/spc-target-mode-and-label-calibration`、`feat/filing-system`、`feat/django-migration` 等
