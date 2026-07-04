# 更新日誌 (CHANGELOG)

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
