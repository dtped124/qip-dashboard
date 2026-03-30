# QIP 持續性監測指標填報系統 — 技術規格書 v1.3

> **文件用途**：供 Claude Code 直接消費，作為 `feature/data-entry` 分支的開發指引
> **前置文件**：QIP-Dashboard-工作說明書 v1.1（儀表板前端規格）
> **日期**：2026-03-29
> **v1.1 更新**：新增資料來源可插拔架構（§9），預留 HIS 串接擴充點
> **v1.2 更新**：新增個案清單審查路徑（§5A），雙軌並行設計——HIS 個案清單路徑與手動填報路徑共存
> **v1.3 更新**：同步已完成實作狀態——帳號系統、前端使用者管理、登入驗證保護、Django Admin checkbox 改善；全系統「帳號」更名為「帳號」

---

## 1. 專案背景與目標

### 1.1 現況問題

目前 QIP 指標資料的流程為：各院區品管人員每月在 Excel 填寫分子/分母 → 匯出成固定格式 .xls → 上傳到儀表板前端 → SheetJS 解析後存入 Dexie/IndexedDB。

此流程存在以下痛點：

- **格式易錯**：Excel 合併儲存格、文字混入數值欄（如 "NP"、"NR"）、百分比符號不一致
- **版本失控**：多人編輯同一份 Excel 無法追溯誰改了什麼
- **無即時回饋**：填完要等匯入儀表板後才知道是否觸發異常
- **無進度管理**：哪個院區、哪個月、哪些指標已填/待填，完全靠人工追蹤
- **資料不持久**：IndexedDB 綁定瀏覽器，換設備或清快取即遺失

### 1.2 目標

建置線上填報系統，讓指標資料從產生的那一刻起就是結構化的。具體目標：

1. 各院區指標負責人可在系統上直接填入分子/分母，即時計算比率
2. 品管中心可追蹤所有院區的填報進度，進行審核
3. 核准後的資料即時反映在監測儀表板上
4. 最終確認後送出至醫策會，資料鎖定不可再改
5. Excel 匯入保留為備援通道

### 1.3 與現有儀表板的架構轉變

填報系統的上線代表儀表板的資料來源從「前端解析 Excel + IndexedDB」轉變為「後端 Django API 統一供資料」。前端變成純呈現層，所有資料由後端 PostgreSQL 持久化儲存。任何人從任何設備登入都看到同一份資料。

---

## 2. 角色與權限模型

### 2.1 角色定義

系統有三種角色，一個帳號可同時擁有多種角色（例如品管中心人員可兼任某些指標的填報者）。

#### 角色 1：指標填報者（Indicator Reporter）

- **可見範圍**：僅看到自己被指派的指標（跨面向皆可）
- **可執行動作**：
  - 填寫分子、分母、備註
  - 暫存草稿（部分填寫可存）
  - 按面向送審
  - 被退回後修改並重新送審
- **不可執行**：查看其他人負責的指標、修改他人資料、審核

#### 角色 2：品管中心審核者（QA Reviewer）

- **可見範圍**：所有院區、所有指標的填報狀態與數值
- **可執行動作**：
  - 檢視各院區各面向的填報內容
  - 核准整個面向的填報資料
  - 退回整個面向（須附退回理由）
  - 對個別指標加註疑問（不退回整個面向）
  - 核准後、送出前：直接修改數值（系統留修改紀錄）或退回給填報者
  - 按下「送出至醫策會」正式鎖定
- **附加能力**：管理填報截止日設定

#### 角色 3：系統管理員（System Admin）

- **可執行動作**：
  - 帳號 CRUD（建立、停用、重設密碼）
  - 設定「指標 × 院區 × 負責人」對應關係
  - 解鎖已送出的月份資料（特殊情況）
  - 系統設定（全域截止日、院區定義、面向定義等）

### 2.2 帳號系統

**第一期：自建帳號** ✅ 已實作

- Django 內建 User Model 擴充（`backend/apps/accounts/models.py`）
- 欄位：帳號（employee_id）、姓名、Email、所屬院區、角色（JSONField）、狀態（啟用/停用）
- 登入方式：帳號 + 密碼
- Session-based authentication（Django default）
- 認證 API：`POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/me`
- CSRF 處理：login view 以 `@authentication_classes([])` + `csrf_exempt` 跳過 DRF SessionAuthentication 的 CSRF 強制檢查；其他 API 由前端 `apiFetch()` 自動帶 `X-CSRFToken` header
- 前端 AuthGuard（`components/layout/AuthGuard.tsx`）：所有頁面（含儀表板 `/`）需登入，未登入自動跳轉至 `/entry/login`
- 前端使用者管理（`components/entry/UserManagement.tsx`）：管理員可在 `/entry/admin` 頁面新增/編輯/停用帳號，角色以 checkbox 選取
- Django Admin 也已改善：角色欄位從 JSONField 手動輸入改為 CheckboxSelectMultiple widget（`backend/apps/accounts/admin.py`）

**未來擴充**：串接醫院 AD/LDAP（django-auth-ldap），以帳號登入自動對應院內身份。

### 2.3 指標負責人對應管理

資料模型：`IndicatorAssignment`

```
IndicatorAssignment:
  - indicator_code: str          # 指標代碼，如 "HA02-01"
  - campus: str                  # 院區，如 "zhubei"
  - user: FK → User              # 負責人
  - role: enum                   # "primary" | "deputy"（正職/代理人）
  - effective_from: date         # 生效起始日（民國年月）
  - effective_to: date | null    # 失效日（null = 現行有效）
  - created_by: FK → User        # 誰指派的
  - created_at: datetime
```

設計要點：

- 同一指標同一院區可有多個負責人（正職 + 代理人）
- 負責人變更時，舊紀錄設 `effective_to`，新增新紀錄，保留完整歷史
- 填報者登入後，系統以 `effective_from/to` 判定當前生效的指派

---

## 3. 資料狀態流

### 3.1 狀態定義

每個「面向 × 院區 × 月份」的組合是一個獨立的填報單元，有以下狀態：

```
未填(unfilled) → 草稿(draft) → 已送審(submitted) → 已核准(approved) → 已送出(finalized)
                     ↑              ↓                      ↓
                     └── 退回(reject) ──┘                    │
                     ↑                                      ↓
                     └────────── 退回修改(revise) ────────────┘
```

| 狀態 | 英文代碼 | 觸發動作 | 可操作者 | 資料可編輯 |
|------|---------|---------|---------|----------|
| 未填 | `unfilled` | 系統初始 | — | 否（尚無資料） |
| 草稿 | `draft` | 填報者首次暫存 | 填報者 | 是 |
| 已送審 | `submitted` | 填報者按送審 | 品管中心 | 否（填報者端鎖定） |
| 已核准 | `approved` | 品管中心核准 | 品管中心 | 是（僅品管中心可改） |
| 已送出 | `finalized` | 品管中心送出至醫策會 | 系統管理員（解鎖） | 否（完全鎖定） |

### 3.2 退回機制

**審核階段退回**（submitted → draft）：

- 品管中心退回整個面向
- 必須填寫退回理由
- 填報者收到通知，可看到退回理由
- 該面向所有指標回到草稿狀態，填報者可修改後重新送審

**送出前退回**（approved → draft）：

- 品管中心在核准後、送出前發現問題
- 可選擇：自己直接修改數值（留修改紀錄），或退回給填報者
- 退回理由必填

### 3.3 送審粒度

**按面向送審**。填報者填完某個面向的所有指標後，可單獨送審該面向，不需等其他面向完成。例如感染管制的數據月初就到手，可以先送；手術照護的數據隔兩天才齊，之後再送。

送審前提：該面向下所有自己負責的指標皆已填入數值（不可有空值）。

### 3.4 鎖定與解鎖

- **已送出（finalized）** 的資料完全鎖定，任何人不可修改
- 特殊情況下，系統管理員可解鎖特定月份，將狀態回退到 `approved`
- 解鎖操作留下完整 audit log（誰、何時、理由）

---

## 4. 資料模型設計

### 4.1 核心 Models

```python
# === 院區定義 ===
class Campus(models.Model):
    code = models.CharField(max_length=20, unique=True)       # "hsinchu", "zhubei", "zhudong"
    name = models.CharField(max_length=50)                     # "新竹", "竹北", "竹東"
    benchmark_level = models.CharField(max_length=20)          # "medical_center", "regional", "district"
    is_active = models.BooleanField(default=True)

# === 面向（類別）定義 ===
class Category(models.Model):
    code = models.CharField(max_length=20, unique=True)        # "HA01", "HA02", ...
    name = models.CharField(max_length=100)                    # "整體住院照護", "加護照護", ...
    sort_order = models.IntegerField()
    color = models.CharField(max_length=7)                     # 面向代表色 hex

# === 指標定義 ===
class Indicator(models.Model):
    code = models.CharField(max_length=20, unique=True)        # "HA02-01"
    name = models.CharField(max_length=200)                    # "住院死亡率"
    category = models.ForeignKey(Category, on_delete=models.CASCADE)
    data_type = models.CharField(max_length=20)                # "proportion", "rate", "count"
    chart_type = models.CharField(max_length=10)               # "P", "U", "IMR"
    direction = models.CharField(max_length=10)                # "lower", "higher", "monitor"
    has_denominator = models.BooleanField(default=True)
    entry_mode = models.CharField(max_length=20, default='manual')
    # entry_mode: "manual"（手動填報路徑）| "case_list"（HIS 個案清單路徑）
    sort_order = models.IntegerField()
    description = models.TextField(blank=True)                 # 指標定義說明
    campuses = models.ManyToManyField(Campus)                  # 哪些院區需要填報此指標

# === 月報表頭 ===
class MonthlyReport(models.Model):
    campus = models.ForeignKey(Campus, on_delete=models.CASCADE)
    year = models.IntegerField()                               # 民國年，如 115
    month = models.IntegerField()                              # 1-12
    category = models.ForeignKey(Category, on_delete=models.CASCADE)
    status = models.CharField(max_length=20, default='unfilled')
    # 狀態: unfilled / draft / submitted / approved / finalized

    submitted_at = models.DateTimeField(null=True)
    submitted_by = models.ForeignKey(User, null=True, related_name='submitted_reports')
    reviewed_at = models.DateTimeField(null=True)
    reviewed_by = models.ForeignKey(User, null=True, related_name='reviewed_reports')
    approved_at = models.DateTimeField(null=True)
    approved_by = models.ForeignKey(User, null=True, related_name='approved_reports')
    finalized_at = models.DateTimeField(null=True)
    finalized_by = models.ForeignKey(User, null=True, related_name='finalized_reports')
    rejection_reason = models.TextField(blank=True)
    is_late = models.BooleanField(default=False)               # 是否逾期繳交

    class Meta:
        unique_together = ['campus', 'year', 'month', 'category']

# === 指標數據（每個指標每月一筆） ===
class IndicatorEntry(models.Model):
    report = models.ForeignKey(MonthlyReport, on_delete=models.CASCADE)
    indicator = models.ForeignKey(Indicator, on_delete=models.CASCADE)
    numerator = models.DecimalField(max_digits=12, decimal_places=2, null=True)
    denominator = models.DecimalField(max_digits=12, decimal_places=2, null=True)
    value = models.DecimalField(max_digits=12, decimal_places=6, null=True)  # 計算值
    # 個案清單路徑專用：排除前的原始計數
    raw_numerator = models.IntegerField(null=True)               # 排除前分子
    raw_denominator = models.IntegerField(null=True)             # 排除前分母
    exclusion_count = models.IntegerField(default=0)             # 被排除個案數
    note = models.TextField(blank=True)                        # 填報備註
    filled_by = models.ForeignKey(User, null=True, related_name='filled_entries')
    filled_at = models.DateTimeField(null=True)
    data_source = models.CharField(max_length=20, default='manual')
    # data_source: "manual"（線上填報）| "excel"（Excel 匯入備援）| "his"（HIS 自動匯入）
    import_batch = models.ForeignKey('ImportBatch', null=True, blank=True, on_delete=models.SET_NULL)
    # 非手動填報時，記錄來自哪一次匯入批次

    class Meta:
        unique_together = ['report', 'indicator']

# === HA10 子類別（新竹專用） ===
class HA10SubEntry(models.Model):
    entry = models.ForeignKey(IndicatorEntry, on_delete=models.CASCADE)
    sub_code = models.CharField(max_length=20)                 # "HA10-10-01" ~ "HA10-10-13"
    sub_name = models.CharField(max_length=100)
    value = models.DecimalField(max_digits=10, decimal_places=2, null=True)

# === 個案紀錄（HIS 個案清單路徑） ===
class CaseRecord(models.Model):
    entry = models.ForeignKey(IndicatorEntry, on_delete=models.CASCADE)
    case_role = models.CharField(max_length=20)                  # "numerator" | "denominator"
    # 此個案屬於分子群還是分母群（一個病人可能同時在分母中）
    his_raw_data = models.JSONField(default=dict)                # HIS 原始欄位（彈性 schema）
    # 欄位內容由 HIS 匯入決定，典型欄位如：
    # { "chart_no": "A123456", "admission_date": "115-03-01",
    #   "discharge_date": "115-03-15", "outcome": "死亡",
    #   "dept": "ICU", "ward": "5A", "icd_codes": ["J96.0"] }
    # 具體欄位待 HIS 報表格式確認後定義
    is_excluded = models.BooleanField(default=False)
    excluded_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL,
                                    related_name='excluded_cases')
    excluded_at = models.DateTimeField(null=True)
    exclusion_reason = models.ForeignKey('ExclusionReason', null=True, blank=True,
                                         on_delete=models.SET_NULL)
    exclusion_note = models.TextField(blank=True)                # 自由填寫的補充說明
    reviewer_approved = models.BooleanField(null=True)           # 品管中心是否同意此排除
    reviewer_note = models.TextField(blank=True)                 # 品管中心審查意見
    created_at = models.DateTimeField(auto_now_add=True)

# === 排除理由預設選項 ===
class ExclusionReason(models.Model):
    code = models.CharField(max_length=20, unique=True)          # "NOT_ELIGIBLE", "DATA_ERROR", ...
    name = models.CharField(max_length=100)                      # "不符收案定義"
    description = models.TextField(blank=True)                   # 詳細說明
    sort_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)

# === 修改紀錄（audit log） ===
class EntryAuditLog(models.Model):
    entry = models.ForeignKey(IndicatorEntry, on_delete=models.CASCADE)
    field_name = models.CharField(max_length=50)               # "numerator", "denominator", "value"
    old_value = models.CharField(max_length=100)
    new_value = models.CharField(max_length=100)
    changed_by = models.ForeignKey(User, on_delete=models.CASCADE)
    changed_at = models.DateTimeField(auto_now_add=True)
    reason = models.TextField(blank=True)                      # 品管中心修改時填寫理由

# === 填報截止日設定 ===
class DeadlineSetting(models.Model):
    year = models.IntegerField()
    month = models.IntegerField()
    deadline_day = models.IntegerField(default=10)             # 預設每月10日
    note = models.CharField(max_length=200, blank=True)        # 如 "春節延長"

    class Meta:
        unique_together = ['year', 'month']

# === 資料匯入批次紀錄 ===
class ImportBatch(models.Model):
    source_type = models.CharField(max_length=20)              # "excel" | "his"
    source_name = models.CharField(max_length=200)             # 檔名或 HIS 系統名稱
    campus = models.ForeignKey(Campus, on_delete=models.CASCADE)
    year = models.IntegerField()
    month = models.IntegerField()
    status = models.CharField(max_length=20, default='pending')
    # status: "pending" | "preview" | "confirmed" | "failed"
    imported_by = models.ForeignKey(User, on_delete=models.CASCADE)
    imported_at = models.DateTimeField(auto_now_add=True)
    record_count = models.IntegerField(default=0)              # 本批匯入了幾筆
    error_log = models.TextField(blank=True)                   # 匯入錯誤訊息

# === 資料來源設定（HIS 串接預留） ===
class DataSourceConfig(models.Model):
    name = models.CharField(max_length=100, unique=True)       # "HIS-感控系統", "HIS-手術紀錄"
    source_type = models.CharField(max_length=20)              # "his_api" | "his_csv" | "his_db_view"
    connection_config = models.JSONField(default=dict)         # 連線設定（加密儲存）
    # his_api: { "url": "...", "auth_type": "..." }
    # his_csv: { "file_path": "...", "delimiter": "," }
    # his_db_view: { "db_alias": "...", "view_name": "..." }
    schedule = models.CharField(max_length=50, blank=True)     # cron 表達式，如 "0 2 5 * *"（每月5日凌晨2點）
    is_active = models.BooleanField(default=False)
    last_run_at = models.DateTimeField(null=True)
    last_run_status = models.CharField(max_length=20, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

# === HIS 欄位對應表 ===
class HISFieldMapping(models.Model):
    data_source = models.ForeignKey(DataSourceConfig, on_delete=models.CASCADE)
    indicator = models.ForeignKey(Indicator, on_delete=models.CASCADE)
    campus = models.ForeignKey(Campus, on_delete=models.CASCADE)
    his_numerator_field = models.CharField(max_length=200)     # HIS 端的分子欄位名稱
    his_denominator_field = models.CharField(max_length=200, blank=True)  # 分母欄位（計數型可空）
    his_date_field = models.CharField(max_length=200)          # 日期欄位
    transform_formula = models.TextField(blank=True)           # 轉換公式（如需特殊計算）
    is_active = models.BooleanField(default=True)
    note = models.TextField(blank=True)                        # 對應說明

    class Meta:
        unique_together = ['data_source', 'indicator', 'campus']
```

### 4.2 HA10 新竹院區特殊處理

新竹院區填報 HA10 時，介面展開 13 個子類別（HA10-10-01 ~ HA10-10-13）。每個子類別個別填入數值，系統自動加總寫入 `IndicatorEntry.value`。子類別數據存入 `HA10SubEntry`，僅供明細查看，不獨立建立管制圖。

竹北、竹東直接填寫 HA10-01 的加總值，不展開子類別。

### 4.3 歷史資料遷移

110-114 年的 Excel 歷史資料需全量遷移至後端資料庫。遷移方式：

1. 撰寫一次性 Django management command：`python manage.py migrate_excel_data`
2. 讀取既有 Excel 檔案，解析分子/分母/數值
3. 對應到 `Indicator` 定義，建立 `MonthlyReport`（status = `finalized`）和 `IndicatorEntry`（data_source = `excel`）
4. 遷移後的資料直接標記為 `finalized`，作為歷史基線
5. 遷移完成後驗證：與原始 Excel 逐項比對數值是否一致

---

## 5. 填報介面 UX 規格

### 5.1 填報者首頁（登入後）

```
┌──────────────────────────────────────────────────────────┐
│  QIP 指標填報系統                      [王小明] [登出]     │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  📋 當前填報期間：115年 3月                                │
│  ⏰ 截止日：115年 4月 10日（剩餘 5 天）                     │
│                                                          │
│  ┌─ ⚠️ 退回通知 ─────────────────────────────────────┐   │
│  │  感染管制 面向已被退回                               │   │
│  │  理由：HA07-03 分子數值疑似筆誤，請確認               │   │
│  │                                    [前往修改]       │   │
│  └────────────────────────────────────────────────────┘   │
│                                                          │
│  我的填報進度                                              │
│  ┌────────────────────┬────────┬──────────┐              │
│  │ 面向               │ 進度    │ 狀態      │              │
│  ├────────────────────┼────────┼──────────┤              │
│  │ 🏥 整體住院照護     │ 3/3    │ ✅ 已核准  │              │
│  │ 🫀 加護照護         │ 2/4    │ 📝 草稿   │              │
│  │ 🔬 感染管制         │ 4/4    │ 🔙 退回   │              │
│  │ 💊 用藥安全         │ 0/2    │ ⬜ 未填   │              │
│  └────────────────────┴────────┴──────────┘              │
│                                                          │
│  本月整體完成度：[████████░░░░] 9/13 指標已填               │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

設計要點：

- 院區不需選擇，系統自動依帳號判定
- 月份預設帶出「最近一個尚未 finalized 的月份」
- 只顯示填報者自己負責的指標所屬面向
- 退回通知以紅色橫幅置頂，最優先處理
- 未填和草稿的面向排在最前面（urgency sort）
- 逾期標記：超過截止日後，頂部出現黃色橫幅「本月資料已逾期」

### 5.2 面向填報表單

點進某個面向後，展開該面向下填報者負責的所有指標：

```
┌──────────────────────────────────────────────────────────┐
│  ← 返回  │  加護照護（115年 3月 · 竹北）         [暫存] [送審] │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌─────┬──────────┬───────┬───────┬────────┬──────┬────┐│
│  │代碼  │指標名稱    │分子    │分母    │比率     │上月值 │變動 ││
│  ├─────┼──────────┼───────┼───────┼────────┼──────┼────┤│
│  │HA03 │加護病房    │       │       │        │      │    ││
│  │-01  │死亡率     │ [12]  │ [450] │ 2.67%  │2.42% │+10%││
│  │     │          │       │       │        │      │ ⚠️ ││
│  ├─────┼──────────┼───────┼───────┼────────┼──────┼────┤│
│  │HA03 │加護病房    │       │       │        │      │    ││
│  │-02  │再入住率   │ [  ] │ [   ] │  —     │1.85% │ —  ││
│  ├─────┼──────────┼───────┼───────┼────────┼──────┼────┤│
│  │HA03 │非計畫性    │       │       │        │      │    ││
│  │-03  │拔管率     │ [3]  │ [820] │ 0.37%  │0.41% │-10%││
│  ├─────┼──────────┼───────┼───────┼────────┼──────┼────┤│
│  │HA03 │跌倒發生率  │       │       │        │      │    ││
│  │-04  │          │ [  ] │ [   ] │  —     │0.05% │ —  ││
│  └─────┴──────────┴───────┴───────┴────────┴──────┴────┘│
│                                                          │
│  備註欄（選填）：                                           │
│  HA03-01：[本月因 COVID 重症增加，死亡率上升          ]       │
│                                                          │
│              [暫存草稿]        [送審此面向]                  │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 5.3 即時驗證規則

填報時即時檢查，分為兩類：

**硬性阻擋（紅色，不可送審）**：

- 分子 > 分母（比率型指標）
- 數值為負數
- 非數字輸入
- 送審時有指標未填（該面向所有指標必須填完才能送審）

**柔性提醒（橙色，可忽略送審）**：

- 與上月值相比變動超過 ±30%（疑似打字錯誤）
- 分母為 0（合法但需確認：如該月無相關病患）
- 數值為 0 但上月非 0

柔性提醒在輸入框旁邊顯示橙色圖示和提示文字，填報者確認後仍可送審。

> **注意**：此處 ±30% 是「填報合理性」閾值，與儀表板的 ±10% 「月變動異常判定」不同。前者抓打字錯誤，後者做品質判定。

### 5.4 純計數型指標的介面適應

對於 `has_denominator = False` 的指標（如 HA10 異常事件通報數）：

- 隱藏分子、分母欄位
- 只顯示一個「數值」輸入框
- 不計算比率

新竹院區 HA10 的特殊呈現：

```
┌─────┬────────────────┬──────┬──────┬────┐
│代碼  │指標名稱          │數值   │上月值 │變動 │
├─────┼────────────────┼──────┼──────┼────┤
│HA10 │異常事件通報數     │ 156  │ 142  │+10%│
│-01  │（自動加總）       │      │      │    │
├─────┼────────────────┼──────┼──────┼────┤
│     │ ├ 藥物事件      │ [23] │  20  │    │
│     │ ├ 跌倒事件      │ [15] │  18  │    │
│     │ ├ 管路事件      │ [  ] │  12  │    │
│     │ ├ 手術事件      │ [  ] │   8  │    │
│     │ ├ ... (共13類)  │      │      │    │
│     │ └ 其他事件      │ [  ] │   5  │    │
└─────┴────────────────┴──────┴──────┴────┘
```

### 5.5 暫存與送審

**暫存**：

- 隨時可按，部分填寫也能存
- 存入 `MonthlyReport.status = 'draft'`
- 下次登入自動載入上次暫存的值

**送審**：

- 前提：該面向所有自己負責的指標皆已填入數值
- 按下後彈出確認對話框，列出所有指標的數值摘要
- 確認後 `MonthlyReport.status = 'submitted'`
- 填報者端鎖定，不可再編輯（除非被退回）

---

## 5A. 個案清單審查路徑 UX 規格（路徑 A）

> 本節描述 `entry_mode = "case_list"` 指標的專屬介面。
> `entry_mode = "manual"` 的指標沿用第 5 節的手動填報介面。
> 兩條路徑在同一個面向中可以共存（例如加護照護面向中，ICU 死亡率走個案清單，跌倒發生率走手動填報）。

### 5A.1 雙路徑並存的介面呈現

填報者進入某個面向時，系統根據每個指標的 `entry_mode` 決定呈現方式：

- `manual` 指標：顯示分子/分母輸入框（同第 5.2 節）
- `case_list` 指標：顯示「審查個案清單」按鈕，點擊展開個案清單

面向填報表單中，兩種指標混排在同一頁，按 `sort_order` 排序。`case_list` 指標的「分子/分母」欄位為系統自動計算，不可手動輸入。

```
┌─────┬──────────┬───────┬───────┬────────┬──────┬──────────────┐
│代碼  │指標名稱    │分子    │分母    │比率     │上月值 │來源           │
├─────┼──────────┼───────┼───────┼────────┼──────┼──────────────┤
│HA03 │ICU死亡率  │ 12    │ 450   │ 2.67%  │2.42% │ [審查清單]     │
│-01  │(個案清單)  │(排除2) │       │        │      │ 14→12 已審    │
├─────┼──────────┼───────┼───────┼────────┼──────┼──────────────┤
│HA03 │跌倒發生率  │ [  ]  │ [   ] │  —     │0.05% │ 手動填報       │
│-04  │(手動)     │       │       │        │      │              │
└─────┴──────────┴───────┴───────┴────────┴──────┴──────────────┘
```

### 5A.2 個案清單審查介面

點擊「審查清單」後，展開該指標的個案清單頁面：

```
┌──────────────────────────────────────────────────────────────┐
│  ← 返回  │  HA03-01 加護病房死亡率 · 115年3月 · 竹北            │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  摘要                                                         │
│  ┌──────────┬──────────┬──────────┬──────────┐               │
│  │ 分母(全部) │ 原始分子  │ 排除     │ 最終分子   │               │
│  │   450     │   14     │   2      │   12     │               │
│  │ ICU住院   │ 死亡     │          │          │               │
│  └──────────┴──────────┴──────────┴──────────┘               │
│                                                              │
│  篩選：[全部] [分子個案] [已排除]           比率：12/450 = 2.67% │
│                                                              │
│  ┌───┬────────┬────────┬────────┬──────┬────────┬──────────┐ │
│  │   │病歷號   │入院日   │出院日   │轉歸   │科別/病房 │狀態       │ │
│  ├───┼────────┼────────┼────────┼──────┼────────┼──────────┤ │
│  │ ☐ │A12345  │03/01   │03/08   │死亡   │ICU/5A  │✓ 保留     │ │
│  │ ☐ │A12346  │03/03   │03/12   │死亡   │ICU/5A  │✓ 保留     │ │
│  │ ☐ │A12347  │03/05   │03/05   │死亡   │ICU/5B  │✗ 已排除   │ │
│  │   │        │        │        │      │        │DOA，到院前 │ │
│  │   │        │        │        │      │        │死亡        │ │
│  │ ☐ │A12348  │03/07   │03/15   │死亡   │ICU/5A  │✓ 保留     │ │
│  │ ...│        │        │        │      │        │           │ │
│  │ ☐ │A12360  │03/22   │03/25   │死亡   │ICU/5B  │✗ 已排除   │ │
│  │   │        │        │        │      │        │資料錯誤，  │ │
│  │   │        │        │        │      │        │實為轉院    │ │
│  └───┴────────┴────────┴────────┴──────┴────────┴──────────┘ │
│                                                              │
│  選取個案後：  [排除選取個案]    [取消排除]                       │
│                                                              │
│  ┌─ 排除操作面板（選取個案後顯示）──────────────────────────┐   │
│  │ 排除理由：[▼ 不符收案定義        ]                       │   │
│  │ 補充說明：[到院前死亡(DOA)，非ICU住院期間死亡       ]      │   │
│  │                                         [確認排除]     │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                              │
│           [返回面向填報]                                       │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 5A.3 排除理由機制

採用「預設選項 + 自由填寫」混合模式：

**預設排除理由（ExclusionReason 表）**：

| 代碼 | 名稱 | 說明 |
|------|------|------|
| `NOT_ELIGIBLE` | 不符收案定義 | 個案不符合該指標的收案條件 |
| `DATA_ERROR` | 資料錯誤 | HIS 資料有誤（如轉歸代碼錯誤） |
| `DUPLICATE` | 重複個案 | 同一病人重複出現 |
| `TRANSFER` | 轉院/轉床 | 轉出非本院照護範圍 |
| `OTHER` | 其他 | 需在補充說明欄填寫具體原因 |

- 填報者必須選擇一個預設理由
- 選擇「其他」時，補充說明欄為必填
- 選擇其他理由時，補充說明欄為選填（但建議填寫）
- 未來可由系統管理員新增/修改預設理由

### 5A.4 個案清單路徑的送審規則

- 送審前提：該指標的所有分子個案都已審查完畢（每筆都標記為「保留」或「排除」）
- 排除的個案必須都有排除理由
- 送審時，系統自動計算最終分子/分母，寫入 `IndicatorEntry`
- `IndicatorEntry.raw_numerator` = 排除前的原始分子數
- `IndicatorEntry.numerator` = 排除後的最終分子數
- `IndicatorEntry.exclusion_count` = 被排除個案數

### 5A.5 品管中心審查個案清單路徑

品管中心審核 `case_list` 指標時，介面與 `manual` 指標不同：

- 除了看最終分子/分母/比率之外，額外顯示「原始分子 → 排除 N 人 → 最終分子」
- 可展開查看被排除個案的完整清單及每筆排除理由
- 品管中心可逐筆審查排除是否合理
  - 同意排除：`CaseRecord.reviewer_approved = True`
  - 不同意排除：`CaseRecord.reviewer_approved = False`，填寫意見，退回給填報者
- 如果有任何排除被品管中心否決，該面向退回，填報者需重新處理被否決的個案

### 5A.6 個案資料安全

個案清單包含病歷號等敏感資料，需額外注意：

- `CaseRecord.his_raw_data` 中的病歷號在前端顯示時部分遮蔽（如 A1\*\*\*\*6）
- 完整病歷號僅在填報者和品管中心的審查介面中可見
- API 回傳個案清單時，根據請求者角色決定是否回傳完整病歷號
- 個案清單資料不進入儀表板（儀表板只拿到彙總的分子/分母/比率）
- 系統日誌記錄所有個案清單的存取行為

### 5A.7 HIS 欄位的彈性設計

`CaseRecord.his_raw_data` 使用 JSONField，不鎖定欄位結構。原因：

1. HIS 報表格式尚未確認，不同指標可能來自不同 HIS 子系統
2. 不同指標的個案欄位可能不同（ICU 死亡率需要轉歸，感染率需要培養結果）
3. JSON 欄位讓系統能適應未來 HIS 格式變更，不需要改 schema

前端個案清單的表格欄位由 `HISFieldMapping` 的設定動態決定——哪些 JSON key 要顯示、以什麼順序、用什麼欄位名稱。等 HIS 格式確定後，只需設定對應關係，不需要改程式碼。

---

## 6. 品管中心審核介面

### 6.1 全景管理面板

```
┌──────────────────────────────────────────────────────────┐
│  QIP 審核管理                [115年 3月 ▼]  [李品管] [登出] │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  本月完成度                                                │
│  竹北 [████████░░] 7/9 面向已核准                          │
│  竹東 [██████░░░░] 5/9 面向已核准                          │
│  新竹 [██████████] 9/9 面向已核准   → [送出至醫策會]        │
│                                                          │
│  ⏰ 截止日：4月10日  │  逾期院區：竹東（用藥安全、經營管理）   │
│                                                          │
│  ┌──────────┬──────┬──────┬──────┐                       │
│  │ 面向      │ 新竹  │ 竹北  │ 竹東  │                       │
│  ├──────────┼──────┼──────┼──────┤                       │
│  │整體住院照護│ ✅   │ ✅    │ ✅   │                       │
│  │加護照護   │ ✅    │ 🔍   │ ✅   │                       │
│  │手術照護   │ ✅    │ ✅    │ 📝   │                       │
│  │產科照護   │ ✅    │ ✅    │ ✅   │                       │
│  │急診照護   │ ✅    │ ✅    │ ✅   │                       │
│  │重點照護   │ ✅    │ 📝   │ 🔍   │                       │
│  │感染管制   │ ✅    │ ✅    │ ✅   │                       │
│  │用藥安全   │ ✅    │ ✅    │ ⬜   │                       │
│  │經營管理   │ ✅    │ ✅    │ ⬜   │                       │
│  └──────────┴──────┴──────┴──────┘                       │
│                                                          │
│  圖例：✅ 已核准  🔍 已送審待審  📝 草稿  ⬜ 未填            │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 6.2 審核操作頁

點進某個「已送審（🔍）」的面向，展開所有指標的數值：

```
┌──────────────────────────────────────────────────────────┐
│  審核：竹北 · 加護照護 · 115年3月              [核准] [退回] │
├──────────────────────────────────────────────────────────┤
│  填報者：王小明  │  送審時間：2026/04/05 14:23              │
│                                                          │
│  ┌─────┬────────┬────┬─────┬──────┬──────┬──────┬────┐  │
│  │代碼  │名稱     │分子 │分母  │比率   │上月值 │變動   │狀態│  │
│  ├─────┼────────┼────┼─────┼──────┼──────┼──────┼────┤  │
│  │HA03 │ICU死亡率│ 12 │ 450 │2.67% │2.42% │+10.3%│ ⚠️ │  │
│  │-01  │        │    │     │      │      │      │    │  │
│  │HA03 │ICU再入住│  8 │ 432 │1.85% │1.85% │ 0.0% │ ✓  │  │
│  │-02  │率      │    │     │      │      │      │    │  │
│  │HA03 │非計畫拔管│ 3 │ 820 │0.37% │0.41% │-9.8% │ ✓  │  │
│  │-03  │率      │    │     │      │      │      │    │  │
│  │HA03 │跌倒發生率│ 1 │ 920 │0.11% │0.05% │+117% │ ❗ │  │
│  │-04  │        │    │     │      │      │      │    │  │
│  └─────┴────────┴────┴─────┴──────┴──────┴──────┴────┘  │
│                                                          │
│  填報者備註：                                              │
│  HA03-01：本月因 COVID 重症增加，死亡率上升                  │
│                                                          │
│  審核意見（退回時必填）：                                    │
│  [                                                    ]  │
│                                                          │
│           [核准此面向]      [退回此面向]                     │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 6.3 核准後最終修改

所有面向都核准後，品管中心進入「月報總覽」模式：

- 看到該院區該月的完整數據（全部面向、全部指標）
- 可直接點擊數值進行修改（inline edit）
- 修改時彈出理由輸入框
- 系統自動寫入 `EntryAuditLog`（改前值、改後值、修改者、時間、理由）
- 也可將特定面向退回給填報者重填
- 全部確認後，按下「送出至醫策會」（需二次確認對話框）

### 6.4 送出至醫策會

- 按鈕僅在該院區該月所有面向皆為 `approved` 時才可點擊
- 二次確認：「確認將 115年3月 竹北 全部指標送出至醫策會？送出後資料將鎖定不可修改。」
- 確認後所有 `MonthlyReport.status` → `finalized`
- 所有 `IndicatorEntry` 的數值正式進入儀表板監測圖表

---

## 7. 填報截止日管理

### 7.1 全域預設

- 預設截止日：每月 10 日
- 可在系統設定中修改全域預設值

### 7.2 月份級別覆寫

- 品管中心可針對特定月份調整截止日
- 例如：春節期間（115年1月）延長到 15 日
- 透過 `DeadlineSetting` 表管理

### 7.3 逾期處理

- 超過截止日後，填報者仍可填寫和送審
- 系統自動標記 `MonthlyReport.is_late = True`
- 品管中心全景面板上，逾期的格子加上特殊標記
- 不阻擋任何操作，僅作紀錄和提醒

---

## 8. API 設計

### 8.1 認證 ✅ 已實作

```
POST   /api/auth/login          # 帳號 + 密碼登入，回傳使用者資訊 + 設定 session cookie
POST   /api/auth/logout         # 登出，清除 session
GET    /api/auth/me             # 取得當前使用者資訊（角色、院區、負責指標）
```

**實作細節**：
- Login view 使用 `@authentication_classes([])` 避免 DRF SessionAuthentication 在登入時要求 CSRF token
- 前端 `lib/entry/api.ts` 的 `apiFetch()` 對非 GET 請求自動讀取 `csrftoken` cookie 並加入 `X-CSRFToken` header
- 所有請求使用 `credentials: 'include'` 攜帶 session cookie
- CORS 設定僅允許 `localhost:3000`

### 8.2 填報 API

```
# 取得填報者的任務清單
GET    /api/entry/my-tasks?year=115&month=3
       → 回傳：該使用者負責的指標列表、各面向狀態、截止日資訊

# 取得某面向的填報表單（含歷史值供參考）
GET    /api/entry/form?campus=zhubei&year=115&month=3&category=HA03
       → 回傳：該面向所有指標定義、當前已填值、上月值

# 暫存（部分或全部）
POST   /api/entry/save-draft
       body: { campus, year, month, category, entries: [{ indicator_code, numerator, denominator, note }] }

# 送審
POST   /api/entry/submit
       body: { campus, year, month, category }
       → 檢查該面向所有指標是否已填，未填則回 400
```

### 8.2A 個案清單 API（路徑 A 專用）

```
# 取得某指標的個案清單
GET    /api/case-list/?indicator=HA03-01&campus=zhubei&year=115&month=3
       → 回傳：CaseRecord 列表（含排除狀態）、摘要統計

# 排除個案
POST   /api/case-list/exclude
       body: { case_record_ids: [...], exclusion_reason_code, exclusion_note }

# 取消排除
POST   /api/case-list/restore
       body: { case_record_ids: [...] }

# 取得排除理由選項
GET    /api/case-list/exclusion-reasons
       → 回傳：ExclusionReason 列表

# 品管中心審查排除（逐筆）
POST   /api/case-list/review-exclusion
       body: { case_record_id, approved: bool, reviewer_note }
```

### 8.3 審核 API

```
# 取得審核全景
GET    /api/review/overview?year=115&month=3
       → 回傳：所有院區 × 所有面向的狀態矩陣

# 取得待審核面向的詳情
GET    /api/review/detail?campus=zhubei&year=115&month=3&category=HA03

# 核准
POST   /api/review/approve
       body: { campus, year, month, category }

# 退回
POST   /api/review/reject
       body: { campus, year, month, category, reason }

# 品管中心直接修改數值
PATCH  /api/review/edit-entry
       body: { entry_id, field, new_value, reason }

# 送出至醫策會
POST   /api/review/finalize
       body: { campus, year, month }
       → 檢查所有面向皆 approved，否則回 400
```

### 8.4 管理 API

```
# 指標負責人管理
GET    /api/admin/assignments?campus=zhubei
POST   /api/admin/assignments          # 新增指派
PATCH  /api/admin/assignments/:id      # 修改（設定 effective_to）
DELETE /api/admin/assignments/:id      # 刪除

# 截止日管理 ✅ 已實作
GET    /api/admin/deadlines?year=115
POST   /api/admin/deadlines            # 新增/修改特定月份截止日

# 帳號管理 ✅ 已實作
GET    /api/admin/users                # 列出所有使用者
POST   /api/admin/users                # 新增使用者（employee_id, full_name, email, campus, roles, password）
PATCH  /api/admin/users/:id            # 更新使用者（full_name, email, campus, roles, is_active）
GET    /api/admin/campuses             # 取得院區列表（供前端下拉選單）

# 資料來源設定（HIS 預留）
GET    /api/admin/data-sources
POST   /api/admin/data-sources
PATCH  /api/admin/data-sources/:id
GET    /api/admin/data-sources/:id/mappings      # 該來源的欄位對應
POST   /api/admin/data-sources/:id/mappings
PATCH  /api/admin/data-sources/:id/mappings/:mid
```

### 8.5 資料匯入 API

```
# Excel 上傳匯入
POST   /api/import/excel
       body: multipart/form-data（Excel 檔案 + campus + year + month）
       → 解析後建立 ImportBatch，回傳預覽資料

# HIS 手動觸發匯入（未來啟用）
POST   /api/import/his-trigger
       body: { data_source_id, campus, year, month }
       → 執行 HISAdapter.fetch_data，回傳預覽

# HIS webhook（HIS 主動推送，未來啟用）
POST   /api/import/his-webhook
       body: 依 HIS 端定義（經 adapter 轉換）
       → 驗證 + 建立 ImportBatch

# 確認匯入批次
POST   /api/import/confirm
       body: { batch_id }
       → ImportBatch.status = confirmed，資料寫入 IndicatorEntry

# 匯入批次紀錄
GET    /api/import/batches?campus=zhubei&year=115
```

### 8.6 資料供給 API（儀表板讀取）

```
# 儀表板取得指標數據（取代原本的 IndexedDB 讀取）
GET    /api/dashboard/indicators?campus=zhubei&from=112-01&to=115-03
       → 回傳：所有指標的月別數據序列（僅 finalized + approved 的資料）

# 取得 TCPI 標竿值
GET    /api/dashboard/benchmarks?campus=zhubei

# 取得管制圖計算所需的歷史序列
GET    /api/dashboard/chart-data?indicator=HA02-01&campus=zhubei&baseline=24
```

---

## 9. 資料來源架構（可插拔設計）

### 9.1 設計原則

系統採用「資料轉接器」（Adapter）模式，所有外部資料來源都透過統一介面寫入核心資料表。不論資料來自手動填報、Excel 匯入、或未來的 HIS 串接，最終都轉換成同一個格式：

```
標準化輸入格式：
{
  indicator_code: str,     # QIP 指標代碼
  campus: str,             # 院區代碼
  year: int,               # 民國年
  month: int,              # 月份
  numerator: Decimal,      # 分子（計數型指標此欄即為數值）
  denominator: Decimal,    # 分母（計數型指標為 null）
  source_type: str,        # "manual" | "excel" | "his"
}
```

### 9.2 目前實作的資料來源

**來源 1：線上手動填報（manual）** — 主要通道，由指標負責人逐項填入。

**來源 2：Excel 匯入（excel）** — 備援通道，流程如下：

1. 品管中心上傳 Excel 檔案
2. 系統解析（沿用現有的 SheetJS 解析邏輯，移至後端 Python 實作）
3. 建立 `ImportBatch` 紀錄，狀態 = `preview`
4. 顯示預覽：偵測到幾張工作表、幾項指標、解析出的數值
5. 品管中心確認後寫入 `IndicatorEntry`，`ImportBatch.status` = `confirmed`
6. `IndicatorEntry.data_source = 'excel'`，`import_batch` 指向該批次
7. 匯入的資料狀態直接設為 `approved`（需品管中心按送出後才 finalize）

### 9.3 資料來源衝突處理

- 如果某指標該月已有線上填報的資料（draft/submitted），Excel 或 HIS 匯入不可覆蓋
- 系統提示衝突，由品管中心決定保留哪一份
- 如果該月尚無任何資料，匯入直接寫入
- 每筆 `IndicatorEntry` 都記錄 `data_source` 和 `import_batch`，可追溯資料來源

### 9.4 後端 Adapter 抽象介面

```python
# core/adapters/base.py
from abc import ABC, abstractmethod
from dataclasses import dataclass
from decimal import Decimal
from typing import Optional

@dataclass
class IndicatorDataPoint:
    """所有資料來源的統一輸出格式"""
    indicator_code: str
    campus_code: str
    year: int
    month: int
    numerator: Optional[Decimal]
    denominator: Optional[Decimal]

class DataSourceAdapter(ABC):
    """所有資料來源轉接器的基底類別"""

    @abstractmethod
    def fetch_data(self, campus: str, year: int, month: int) -> list[IndicatorDataPoint]:
        """從來源取得資料，轉換為標準格式"""
        pass

    @abstractmethod
    def validate(self, data: list[IndicatorDataPoint]) -> list[str]:
        """驗證資料，回傳錯誤訊息列表（空 = 通過）"""
        pass

    def import_data(self, campus, year, month, imported_by):
        """統一的匯入流程：取得 → 驗證 → 預覽 → 確認寫入"""
        data = self.fetch_data(campus, year, month)
        errors = self.validate(data)
        if errors:
            return {'status': 'failed', 'errors': errors}
        batch = ImportBatch.objects.create(
            source_type=self.source_type,
            source_name=self.source_name,
            campus_id=campus, year=year, month=month,
            imported_by=imported_by, status='preview',
            record_count=len(data)
        )
        return {'status': 'preview', 'batch_id': batch.id, 'data': data}


# core/adapters/excel_adapter.py
class ExcelAdapter(DataSourceAdapter):
    source_type = 'excel'

    def __init__(self, file_path: str):
        self.file_path = file_path
        self.source_name = os.path.basename(file_path)

    def fetch_data(self, campus, year, month):
        # 沿用現有的 Excel 解析邏輯
        ...

    def validate(self, data):
        # 檢查指標代碼是否存在、分子/分母合理性
        ...


# core/adapters/his_adapter.py（未來實作）
class HISAdapter(DataSourceAdapter):
    source_type = 'his'

    def __init__(self, config: DataSourceConfig):
        self.config = config
        self.source_name = config.name
        self.mappings = HISFieldMapping.objects.filter(
            data_source=config, is_active=True
        )

    def fetch_data(self, campus, year, month):
        # 根據 config.source_type 決定取資料方式：
        # - his_api: 呼叫 HIS REST API
        # - his_csv: 讀取約定路徑的 CSV 匯出檔
        # - his_db_view: 查詢 HIS 資料庫的 View
        # 然後根據 HISFieldMapping 做欄位對應和轉換
        ...

    def validate(self, data):
        # 除基本檢查外，比對 HISFieldMapping 確認所有指標都有資料
        ...
```

### 9.5 HIS 串接預留設計（未來階段）

目前不實作 HIS 串接，但架構上預留以下擴充點：

**資料模型已就位**：`DataSourceConfig`（連線設定）和 `HISFieldMapping`（欄位對應）兩張表已建好結構，等 HIS 報表格式確定後只需填入設定資料。

**三種串接模式都支援**：

| 模式 | 說明 | 觸發方式 | 適用場景 |
|------|------|---------|---------|
| 排程自動拉 | Celery Beat 定時執行 adapter | cron 表達式 | HIS 有 API 或固定路徑 CSV |
| HIS 主動推送 | HIS 端呼叫本系統 webhook API | POST /api/import/his-webhook | HIS 有能力發 HTTP 請求 |
| 手動觸發 | 品管中心在管理介面按「從 HIS 匯入」 | 按鈕觸發 | 過渡期或不定期匯入 |

**匯入後的資料流**：HIS 匯入的資料會建立 `ImportBatch`，經品管中心預覽確認後寫入 `IndicatorEntry`（data_source = 'his'）。匯入後的審核流程與手動填報完全一致——品管中心仍需核准、最終送出。HIS 自動填入不代表自動核准。

**未來開發時需要確認的事項**：

1. HIS 端提供什麼格式？（API / CSV 匯出 / DB View / HL7）
2. 每個指標的分子分母在 HIS 的哪個系統、哪個報表、哪個欄位？
3. 匯入頻率？（每月一次 / 每日累計 / 即時）
4. 是否需要雙向同步（本系統修改後回寫 HIS）？——預設不需要

**第一期開發要做的事**：只需確保 `DataSourceAdapter` 介面存在、`data_source` 欄位支援 `his` 值、管理後台能看到 `DataSourceConfig` 和 `HISFieldMapping` 的 CRUD 頁面（即使目前沒有 HIS 資料可填）。這樣未來接 HIS 時，寫一個新的 `HISAdapter` 子類別 + 填入欄位對應就能上線。

---

## 10. 通知機制

### 10.1 第一期（最小可行）

- 填報者登入時，首頁顯示退回通知和截止日提醒
- 品管中心首頁顯示待審核數量和逾期院區

### 10.2 未來擴充

- Email 通知：截止日前 3 天提醒未完成的填報者
- Email 通知：退回時自動寄信給填報者
- Email 通知：品管中心收到新的送審
- 院內即時通訊整合（如有需要）

---

## 11. 技術棧

### 11.1 後端

| 組件 | 選擇 | 理由 |
|------|------|------|
| Framework | Django 5.x + DRF | 現有架構，成熟的 ORM 和認證系統 |
| Database | PostgreSQL 16 | 關聯式資料、ACID、JSON 欄位支援 |
| Auth | Django built-in + Session | 第一期簡單可靠，未來可接 AD |
| API | Django REST Framework | 標準化的 RESTful API |
| Task Queue | （第二期）Celery + Redis | Email 通知、排程催繳、HIS 定時匯入 |

### 11.2 前端

| 組件 | 選擇 | 理由 |
|------|------|------|
| Framework | Next.js 14 (App Router) + TypeScript | 與現有儀表板一致 |
| Styling | Tailwind CSS（不使用 shadcn/MUI） | 與現有儀表板一致，保持輕量 |
| State | Zustand | 填報表單狀態管理 |
| HTTP Client | 自建 `apiFetch()`（基於 fetch） | API 通訊，內建 CSRF token 處理 |
| Charts | Recharts | 與現有儀表板一致（即時回饋的迷你圖表） |
| Auth Guard | `components/layout/AuthGuard.tsx` | 所有頁面登入保護 |

### 11.3 部署

**開發環境**（✅ 已建置）：
- Docker Compose：PostgreSQL 16 + Redis 7 + Django API
- 前端：本機 `npm run dev`（Next.js dev server，port 3000）
- 後端 API：Docker container（port 8001 → 容器 8000）
- `start.bat`：一鍵啟動 Docker + 前端 + 自動開啟瀏覽器登入頁
- **注意**：`start.bat` 不使用 `--build` flag，避免 Docker image 快取導致容器 crash loop

**正式環境**（未來部署）：
- 後端：院內伺服器，Django + Gunicorn + Nginx
- 前端：同伺服器，Next.js build 靜態輸出或 SSR
- 資料庫：同伺服器 PostgreSQL
- 全部在院內網路，不對外

---

## 12. 開發階段規劃

### Phase 1：基礎建設（約 2-3 週）✅ 已完成

```
1.1  ✅ Django 專案初始化、Model 定義、migrate
1.2  ✅ 自建帳號系統（User Model 擴充、登入登出 API）
       - 登入 API：CSRF 豁免處理、session-based auth
       - 前端 AuthGuard：所有頁面（含儀表板）需登入
       - 前端登入頁：/entry/login
1.3  ✅ Indicator / Category / Campus 基礎資料 seeding
       - seed_entry_base（院區 3 筆、面向 10 筆、排除理由 5 筆）
       - seed_indicators（38 筆預設指標）
1.4  ✅ 帳號管理 API + 前端管理介面
       - 後端：GET/POST/PATCH /api/admin/users + GET /api/admin/campuses
       - 前端：UserManagement 元件（/entry/admin 頁面內）
       - Django Admin：角色欄位改為 CheckboxSelectMultiple
       - 指標負責人對應管理：Django Admin CRUD（待前端化）
```

**已知問題與解決方案**：
- Docker image 快取可能導致容器啟動命令錯誤 → `start.bat` 已移除 `--build`，migrate 改為容器啟動後 exec 執行
- CSRF token 在跨域 POST 時被 DRF SessionAuthentication 擋下 → login view 加 `@authentication_classes([])`

### Phase 2：填報功能（約 3-4 週）✅ 已完成

```
2.1  ✅ 填報 API（save-draft, submit）
       - views_entry.py：my_tasks, entry_form, entry_save_draft, entry_submit
       - services/entry_service.py：get_my_tasks, get_category_form, save_draft, submit_category
2.2  ✅ 填報者首頁（任務清單、進度概覽）
       - app/entry/page.tsx
2.3  ✅ 面向填報表單（分子/分母輸入、即時計算）
       - app/entry/[category]/page.tsx
2.4  ✅ 即時驗證（硬性阻擋 + 柔性提醒）
2.5  ✅ HA10 新竹子類別特殊介面（HA10SubEntry model）
2.6  ✅ 暫存與送審流程
```

### Phase 3：審核功能（約 2-3 週）✅ 已完成

```
3.1  ✅ 審核 API（approve, reject, edit-entry, finalize, unlock）
       - views_review.py：7 個 view 函式
       - services/review_service.py：完整審核服務層
3.2  ✅ 全景管理面板（矩陣式進度看板）
       - app/entry/review/page.tsx
3.3  ✅ 審核操作頁（查看數值、核准/退回）
       - app/entry/review/campus/[campus]/[category]/page.tsx
3.4  ✅ 核准後最終修改（inline edit + EntryAuditLog）
3.5  ✅ 送出至醫策會（二次確認 + 鎖定）
       - review_finalize + review_unlock（管理員解鎖）
```

### Phase 4：歷史資料遷移 + 儀表板整合（約 2-3 週）🔶 大部分完成

```
4.1  ✅ DataSourceAdapter 抽象介面 + ExcelAdapter 實作
       - adapters/base.py + adapters/excel_adapter.py
4.2  ✅ ImportBatch 匯入批次管理 API + 預覽/確認流程
       - views_import.py：import_excel, import_confirm, import_batches
       - services/import_service.py
4.3  ✅ Excel 歷史資料遷移 command
       - management/commands/migrate_excel_data.py
4.4  ⏳ 遷移後數據驗證（待實際執行 Excel 遷移時逐項比對）
4.5  ✅ 儀表板資料來源切換（IndexedDB → API）
4.6  ✅ dashboard API（entry-data, entry-benchmarks）
       - views_dashboard.py
4.7  ✅ Excel 匯入備援 UI
```

### Phase 5：截止日管理 + 通知（約 1 週）🔶 大部分完成

```
5.1  ✅ 截止日設定介面（/entry/admin 頁面內 DeadlineCard 元件）
5.2  ✅ 逾期自動標記（management/commands/mark_late_reports.py）
5.3  ⏳ Email 通知（需 Celery + SMTP，屬未來擴充）
```

### Phase 6：HIS 串接 + 個案清單路徑預留（約 1-2 週）🔶 大部分完成

```
6.1  ✅ CaseRecord / ExclusionReason Model + migrate
6.2  ✅ 排除理由預設資料 seeding（5 筆）
6.3  ✅ 個案清單 API（5 個 endpoint）
       - views_case_list.py：case_list, exclude, restore, exclusion_reasons, review_exclusion
6.4  ✅ 個案清單審查介面（填報者端）
       - app/entry/case-list/[indicator]/page.tsx
6.5  ✅ 品管中心排除審查介面（review_exclusion API）
6.6  ✅ DataSourceConfig / HISFieldMapping Model 已定義
6.7  🔶 HISAdapter 骨架（adapters/his_adapter.py placeholder，待 HIS 格式確認）
6.8  ✅ 匯入 API endpoint（his-trigger, his-webhook）路由註冊，回傳 501
```

> HIS 串接待報表格式確定後實作 `his_adapter.py`。個案清單的資料模型、API、介面皆已就位。

**整體進度：約 90% 完成**

### 剩餘待完成項目

| 項目 | 階段 | 說明 |
|------|------|------|
| 歷史資料遷移驗證 | 4.4 | 待實際執行 Excel 遷移後逐項比對數值 |
| Email 通知 | 5.3 | 需 Celery + SMTP 設定，截止日提醒/退回通知/送審通知 |
| HIS Adapter 實作 | 6.7 | 等待 HIS 報表格式確認後撰寫 |
| AD/LDAP 整合 | §2.2 | 未來擴充，串接醫院帳號系統 |
| 指標負責人管理前端化 | 1.4 | 目前僅 Django Admin CRUD，可考慮移至前端 |

---

## 13. 附錄：指標清單與院區對應

### 竹北院區（約 33 項指標）

依 9 大面向分布，每個面向 2-6 個指標不等。所有比率型指標皆有分子/分母。

### 竹東院區（約 27 項指標）

部分面向指標數量較少（如產科照護可能無此面向）。

### 新竹院區（合併報表）

指標項目與竹北類似，但 HA10 需展開 13 個子類別。標竿層級為醫學中心。

> 完整的 33+27 項指標清單及管制圖選型對應，請參閱 QIP-Control-Chart-Mapping-WorkPlan.md

---

## 14. 已實作關鍵檔案索引

### 14.1 後端 — 帳號系統（backend/apps/accounts/）

| 檔案 | 說明 |
|------|------|
| `models.py` | User Model 擴充，角色為 JSONField，verbose_name 統一為「帳號」 |
| `views.py` | login / logout / me API + 帳號 CRUD（list / create / update） |
| `serializers.py` | 登入序列化器、使用者序列化器 |
| `admin.py` | Django Admin 自訂 form，角色改為 CheckboxSelectMultiple |
| `urls.py` | login 路由包 `csrf_exempt()`，其餘路由正常 |

### 14.2 後端 — 填報系統核心（backend/apps/entry/）

| 檔案 | 說明 |
|------|------|
| `models.py` | 全部 13 個 Model（Campus ~ HISFieldMapping） |
| `serializers.py` | Campus / ReportCategory / IndicatorAssignment / DeadlineSetting |
| `views.py` | 院區、面向、指標負責人、截止日管理 API |
| `views_entry.py` | 填報 API（my-tasks, form, save-draft, submit） |
| `views_review.py` | 審核 API（overview, detail, approve, reject, edit-entry, finalize, unlock） |
| `views_import.py` | 匯入 API（excel, confirm, batches, his-trigger/webhook stub） |
| `views_case_list.py` | 個案清單 API（list, exclude, restore, exclusion-reasons, review） |
| `views_dashboard.py` | 儀表板資料供給 API（entry-data, entry-benchmarks） |
| `services/entry_service.py` | 填報業務邏輯（get_my_tasks, save_draft, submit_category） |
| `services/review_service.py` | 審核業務邏輯（approve, reject, edit, finalize, unlock） |
| `services/import_service.py` | 匯入業務邏輯（confirm_import_batch, write_preview_entries） |
| `services/period.py` | 期間工具（get_current_tw_year_month, get_current_period） |
| `adapters/base.py` | 資料來源轉接器抽象介面（IndicatorDataPoint, DataSourceAdapter） |
| `adapters/excel_adapter.py` | Excel 匯入轉接器（ExcelAdapter） |
| `adapters/his_adapter.py` | HIS 串接轉接器（placeholder） |
| `management/commands/seed_entry_base.py` | 院區 / 面向 / 排除理由 seed |
| `management/commands/seed_indicators.py` | 38 筆指標 seed |
| `management/commands/migrate_excel_data.py` | 歷史 Excel 資料遷移 |
| `management/commands/mark_late_reports.py` | 逾期報表標記 |

### 14.3 前端 — 填報系統頁面

| 檔案 | 說明 |
|------|------|
| `app/entry/login/page.tsx` | 登入頁面（帳號 + 密碼） |
| `app/entry/page.tsx` | 填報者首頁（任務清單、進度概覽） |
| `app/entry/[category]/page.tsx` | 面向填報表單（分子/分母輸入） |
| `app/entry/review/page.tsx` | 審核全景面板（矩陣式進度看板） |
| `app/entry/review/campus/[campus]/[category]/page.tsx` | 審核操作頁 |
| `app/entry/case-list/[indicator]/page.tsx` | 個案清單審查介面 |
| `app/entry/admin/page.tsx` | 管理員設定頁（截止日 + 帳號管理 + 快速連結） |

### 14.4 前端 — 共用元件與工具

| 檔案 | 說明 |
|------|------|
| `components/layout/AuthGuard.tsx` | 全站登入保護，未登入跳轉 `/entry/login` |
| `components/layout/ClientLayout.tsx` | 包裹 AuthGuard，登入頁使用 bare layout |
| `components/entry/UserManagement.tsx` | 使用者管理元件（表格 + 新增/編輯對話框） |
| `lib/entry/api.ts` | API 封裝，含 CSRF token 處理、`apiFetch()` |
| `lib/entry/types.ts` | TypeScript 介面定義（User, UserCreatePayload 等） |

### 14.5 部署 / 設定

| 檔案 | 說明 |
|------|------|
| `docker-compose.yml` | PostgreSQL 16 + Redis 7 + Django API（含 health check） |
| `start.bat` | Windows 一鍵啟動（不含 `--build`），導引至登入頁 |

---

*文件結束*
