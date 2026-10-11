# API 端點說明

## 📡 API 概述

- **後端技術**：Django 5 + Django REST Framework
- **基礎網址**：`http://localhost:8000`（dev）
- **認證方式**：Session-based（Django 內建）+ CSRF Token
  - `POST /api/auth/login` 豁免 CSRF（首次登入無 cookie）
  - 其他所有寫入（POST / PUT / PATCH / DELETE）需帶 `X-CSRFToken` header
- **回應格式**：JSON
- **錯誤格式**：認證／權限／CSRF 錯誤為 `{"detail": "...", "code": "..."}`（見文末）；業務錯誤為 `{"error": {"code": "...", "message": "..."}}` 或 DRF 的欄位錯誤

---

## 🔐 認證 API

### POST /api/auth/login
使用者登入（豁免 CSRF）
```json
// Request
{"employee_id": "10001", "password": "Aa12345678"}

// Response 200（使用者物件，同 GET /api/auth/me）
{
  "id": 1,
  "employee_id": "10001",
  "full_name": "王小明",
  "email": "wang@hospital.com",
  "campus_code": "zhubei",
  "campus_name": "竹北",
  "roles": ["reporter"],
  "is_active": true,
  "must_change_password": false
}
```
- 帳號或密碼錯誤：400 `{"non_field_errors": ["帳號或密碼錯誤"]}`。
- **登入鎖定**（django-axes）：同一帳號連續失敗 5 次（`AXES_FAILURE_LIMIT`）即鎖定 5 分鐘（`AXES_COOLOFF_MINUTES`）。從第 5 次失敗起，鎖定期間連正確密碼也一律回 **429** `{"detail": "登入失敗次數過多，請 5 分鐘後再試", "code": "locked"}`（訊息中的分鐘數取自 `AXES_COOLOFF_MINUTES`）；鎖定期間的嘗試不會延長鎖定（API 登入與 Django 後台都一樣）。登入成功會清掉該帳號先前的失敗次數。管理員重設該帳號的密碼（或 `seed_admin --reset`、`manage.py axes_reset_username <帳號>`）即時解鎖。Django 後台（`/admin/login/`）的失敗與此共用同一個計數。
- 注意：經 Next 代理後 Django 看到的來源位址對所有人都相同，鎖定實際上是「每個帳號」而非「每個來源」——知道帳號名稱的人可以用幾次錯誤密碼鎖住該帳號（每個冷卻期可重來一次）。本機制擋的是密碼猜測，不是阻斷服務；per-IP 限流要在平台邊緣（LB / WAF）做。
- `must_change_password` 為 `true` 時登入仍回 200，但在改完密碼之前，除了 `me`、`logout`、`change-password` 以外的 API 一律 403 `password_change_required`。

### POST /api/auth/logout
登出（清除 session）

### GET /api/auth/me
取得當前登入使用者資訊（`must_change_password` 為 true 時也可呼叫）

### POST /api/auth/change-password
更改自己的密碼（`must_change_password` 為 true 時也可呼叫）
```json
// Request
{"current_password": "...", "new_password": "..."}

// Response 200
{"detail": "密碼已更新"}
```
- 400：`current_password` 不正確、新密碼與目前密碼相同，或新密碼不符規則；錯誤依欄位回傳，如 `{"new_password": ["...", "..."]}`。
- 密碼規則（`AUTH_PASSWORD_VALIDATORS`）：至少 10 個字元、不得是常見密碼、不得全為數字、不得與帳號／姓名／Email 太相似。
- 成功後 `must_change_password` 清為 `false`；目前的 session 保持登入，該使用者在其他裝置上的 session 會被登出。
- session 為閒置逾時：每次請求都會續期，閒置超過 `SESSION_COOKIE_AGE`（預設 8 小時）才失效。

---

## 📊 指標 API（儀表板版，向後相容）

### GET /api/v1/indicators/
取得所有啟用指標
- **Query**：`campus`（院區篩選）、`category`（類別篩選）
```json
{"data": [{...}], "total": 55}
```

### GET /api/v1/indicators/{code}/
取得指標詳情

### PATCH /api/v1/indicators/{code}/
更新指標設定（目前支援挑戰平均值模式）
```json
// Request
{"target_mode": true, "target_value": 5.2}

// Response：更新後的 Indicator 物件，並自動重算所有院區 Alerts
```

### GET /api/v1/indicators/{code}/data/?campus=竹北
取得指定指標 + 院區的月份資料
```json
{"data": [{"year":115,"month":3,"value":2.1,"numerator":21,"denominator":1000}], "total": 36}
```

### GET /api/v1/indicators/{code}/alerts/?campus=竹北
取得異常警示列表（依年月倒序）

### GET /api/v1/indicators/{code}/summaries/?campus=竹北
取得年度彙總 + TCPI 標竿
```json
{
  "data": [...],       // YearlySummary[]
  "tcpi": [...],       // TCPIBenchmark[]
  "total": 5
}
```

### GET /api/v1/indicators/{code}/analysis/?campus=竹北&period=monthly
即時分析（管制圖 + 異常偵測）
- **period**：`monthly`（預設）或 `quarterly`
```json
{
  "status": "warning",
  "anomalies": [
    {"mechanism": "control_chart", "severity": "alert", "direction": "unfavorable",
     "message": "超出 UCL（3σ）", "value": 8.5, "rule": "Nelson_1",
     "reference_value": 6.2, "year": 115, "month": 3}
  ],
  "control_chart": {
    "chart_type": "P",
    "cl": 5.2, "ucl": 7.8, "lcl": 2.6,
    "sigma": 0.87,
    "ucl2": 6.9, "lcl2": 3.5,
    "n": 1200,
    "target_mode": false,
    "target_value": null,
    "variable_limits": [
      {"year":115,"month":3,"ucl":7.9,"lcl":2.5,"ucl2":7.0,"lcl2":3.4,"sample_size":1250}
    ]
  },
  "peer_value": 4.8
}
```

### GET /api/v1/indicators/export/
匯出全部資料供 QIP Portable 版本載入
```json
{
  "version": 1,
  "exportedAt": "2026-04-18T10:00:00Z",
  "indicators": [...],
  "dataPoints": [...],
  "yearlySummaries": [...],
  "tcpiBenchmarks": [...],
  "importLogs": [...],
  "matchingRules": [...]
}
```

---

## 📊 儀表板批次載入

### GET /api/v1/dashboard/?campus=竹北
一次載入儀表板所需所有資料（所有指標 + 最新值 + sparkline + 狀態 + 標竿 + 趨勢）
- **Query**：`campus`（必填）、`category`、`search`
```json
{
  "data": [
    {
      "code": "HA01-01",
      "name": "住院死亡率",
      "category": "整體照護",
      "unit": "percent",
      "direction": "lower",
      "data_nature": "binomial_rate",
      "is_quarterly": false,
      "latest_value": 2.1,
      "latest_period": "115.03",
      "sparkline": [2.0, 2.1, 1.9, ...],       // 最近 24 個月
      "monthly_data": [{"year":115,"month":3,"value":2.1}, ...],
      "status": "warning",
      "mechanisms": ["control_chart", "peer_comparison"],
      "unfavorable_count": 2,
      "year_avg": 2.05,
      "year_label": "115",
      "peer_value": 1.8,
      "peer_source": "TCPI",
      "trend": "up",
      "latest_anomalies": [
        {"mechanism":"control_chart","severity":"warning","message":"超出 2σ"}
      ]
    }
  ],
  "total": 55,
  "campus": "竹北"
}
```

---

## 🏆 TCPI 標竿 API

### GET /api/v1/tcpi/
取得所有 TCPI 標竿
```json
{"data": [{"indicator_code":"HA01-01","tcpi_name":"...","year":114,
           "medical_center":1.5,"regional_hospital":1.8,"district_hospital":2.1}], "total": 220}
```

### POST /api/v1/tcpi/
批次匯入 TCPI 標竿（⚠️ **先清除所有既有資料再寫入**）
```json
// Request
{
  "benchmarks": [
    {
      "indicatorCode": "HA01-01",
      "tcpiName": "住院死亡率",
      "year": 114,
      "medicalCenter": 1.5,
      "regionalHospital": 1.8,
      "districtHospital": 2.1
    }
  ]
}

// Response
{"saved": 220, "total": 225}
```

> `indicator_code` 未在 `Indicator` 表中會被靜默跳過。

---

## 📤 Excel 匯入 API（指標儀表板用）

### POST /api/v1/imports/upload/
上傳 QIP 月報 Excel
- **Content-Type**：`multipart/form-data`
- **欄位**：`file`
```json
{
  "data": {
    "id": 12,
    "new": 120,
    "updated": 35,
    "unchanged": 505,
    "sheets": ["115年竹北", "115年竹東", "115年新竹", ...],
    "errors": ["警告：115/3 HA02-11 分母為 0", ...]
  }
}
```

### GET /api/v1/imports/logs/
取得最近 20 筆匯入紀錄
```json
{"data": [...], "total": 87}
```

### POST /api/v1/imports/correct-datapoint/
修正匯入警告中的資料點並移除該警告（v1.x 新增）
```json
// Request
{
  "indicator_code": "HA02-11",
  "campus": "竹北",
  "year": 115,
  "month": 3,
  "new_value": 2.5,       // null 代表不改值，僅移除警告
  "log_id": 12,
  "error_text": "警告：115/3 HA02-11 分母為 0"
}

// Response
{"status": "ok"}
```

---

## 👤 帳號管理 API（admin 限定）

### GET /api/admin/users
使用者清單
- **Query**：`campus`、`role`、`is_active`、`search`

### POST /api/admin/users
建立使用者
```json
// Request（password 選填）
{
  "employee_id": "10001",
  "full_name": "王小明",
  "email": "wang@hospital.com",
  "campus": 1,
  "roles": ["reporter"]
}

// Response 201：使用者物件；未給 password（或空字串）時另附一次性的臨時密碼
{"id": 7, "employee_id": "10001", "...": "...", "must_change_password": true, "temporary_password": "Xk7#mQ2-vR9pLw"}
```
- `password` 留空 → 系統產生隨機臨時密碼，**只在這個回應出現一次**（回應帶 `Cache-Control: no-store`，不寫 log、不存明文）；有填 → 必須符合密碼規則，不符回 400 `{"password": [...]}`，回應不含密碼。
- 新帳號一律 `must_change_password = true`。
- `roles` 必須是清單，且每個值都是 `reporter` / `reviewer` / `admin` / `viewer` 之一（重複的會去除）；否則 400 `{"roles": [...]}`。

### GET/PATCH/DELETE /api/admin/users/{pk}
使用者 CRUD。PATCH 同樣驗證 `roles`。管理員不能對自己：停用帳號（400 `cannot_deactivate_self`）、移除自己的 `admin` 角色（400 `cannot_remove_own_admin_role`）、刪除帳號（400）。

### POST /api/admin/users/{pk}/reset-password
重設密碼：產生隨機臨時密碼，設 `must_change_password = true`，同時解除該帳號的登入鎖定，並使其現有的所有 session 失效。
```json
// Response 200（只回這一次，不寫 log、不存明文；帶 Cache-Control: no-store）
{"temporary_password": "Xk7#mQ2-vR9pLw"}
```
臨時密碼至少 12 個字元，含大小寫字母、數字、符號，並通過密碼規則。

---

## 📌 指派管理 API（admin 限定）

### GET /api/admin/campuses
院區清單

### GET /api/admin/categories
填報面向清單

### GET /api/admin/assignments
指派列表
- **Query**：`indicator_code`、`campus_id`、`user_id`、`current_only=true`（僅現行有效）

### POST /api/admin/assignments
新增指派
```json
{
  "indicator_code": "HA01-01",
  "campus_id": 1,
  "user_id": 5,
  "role": "primary",                    // primary / deputy
  "effective_from": "2026-01-01",
  "effective_to": null
}
```

### GET/PATCH/DELETE /api/admin/assignments/{pk}
指派 CRUD（刪除 = 設定 `effective_to`）

### GET /api/admin/deadlines
截止日列表

### POST /api/admin/deadlines
設定每月截止日
```json
{"year": 115, "month": 2, "deadline_day": 15, "note": "春節延長"}
```

---

## 📝 填報 API

### GET /api/entry/my-tasks
當前使用者的待辦（依指派 + 狀態）
```json
{
  "pending": [
    {
      "report_id": 123,
      "campus": "竹北",
      "year": 115, "month": 3,
      "category": {"code":"HA02","name":"加護照護"},
      "status": "draft",
      "deadline": "2026-04-10",
      "is_overdue": false,
      "indicator_count": 8,
      "filled_count": 3
    }
  ],
  "completed": [...]
}
```

### GET /api/entry/form?report_id=123
取得填報表單資料
```json
{
  "report": {...},
  "indicators": [
    {
      "code": "HA02-01",
      "name": "ICU 重返率",
      "unit": "percent",
      "has_denominator": true,
      "entry_mode": "manual",
      "formula": "分子/分母 × 100",
      "current_entry": {
        "numerator": 5, "denominator": 120,
        "value": 4.17, "note": "..."
      }
    }
  ],
  "deadline": "2026-04-10"
}
```

### POST /api/entry/save-draft
儲存草稿（不變更狀態）
```json
{
  "report_id": 123,
  "entries": [
    {"indicator_code":"HA02-01","numerator":5,"denominator":120,"note":"..."}
  ]
}
```

### POST /api/entry/submit
送審（狀態 draft → submitted）
```json
{"report_id": 123}
```

---

## ✅ 審核 API（reviewer / admin）

### GET /api/review/overview
審核總覽（各院區各面向月報狀態）
- **Query**：`year`、`month`、`status`、`campus_id`

### GET /api/review/detail?report_id=123
查看月報詳情（含所有 IndicatorEntry + AuditLog）

### POST /api/review/approve
核准月報（submitted → approved）
```json
{"report_id": 123}
```

### POST /api/review/reject
退回月報（submitted → draft）
```json
{"report_id": 123, "reason": "HA02-01 分母明顯錯誤，請確認"}
```

### POST /api/review/edit-entry
審核者直接修改指標數據（自動寫入 EntryAuditLog）
```json
{
  "entry_id": 456,
  "field_name": "numerator",
  "new_value": 6,
  "reason": "與 HIS 對帳修正"
}
```

### POST /api/review/finalize
定稿（approved → finalized，寫入 data_points 表，鎖定不可改）
```json
{"report_id": 123}
```

### POST /api/review/unlock
解鎖已定稿月報（finalized → approved，限 admin）
```json
{"report_id": 123, "reason": "..."}
```

---

## 📥 填報系統匯入 API

### POST /api/import/excel
上傳填報系統用 Excel（分配至 MonthlyReport）
- **Content-Type**：`multipart/form-data`
- **欄位**：`file`、`campus_id`、`year`、`month`
- **Response**：`{"batch_id": 7, "preview": [...], "errors": [...]}`

### POST /api/import/confirm
確認匯入批次
```json
{"batch_id": 7}
```

### GET /api/import/batches
匯入批次列表

### POST /api/import/his-trigger
手動觸發 HIS 拉取
```json
{"data_source_id": 1, "year": 115, "month": 3}
```

### POST /api/import/his-webhook
HIS 系統推送 webhook（預留）

---

## 📋 個案清單 API

### GET /api/case-list/?entry_id=456
取得某指標數據的個案清單（分子群 / 分母群）
```json
{
  "numerator": [
    {"id":1,"chart_no":"A123","admission_date":"2026-03-01",
     "is_excluded":false,"exclusion_reason":null,"reviewer_approved":null}
  ],
  "denominator": [...],
  "stats": {
    "raw_numerator": 25, "raw_denominator": 800,
    "excluded_numerator": 3, "excluded_denominator": 12,
    "final_numerator": 22, "final_denominator": 788,
    "value": 2.79
  }
}
```

### POST /api/case-list/exclude
排除個案
```json
{
  "case_id": 1,
  "exclusion_reason_id": 3,
  "exclusion_note": "已轉院，不計入本院結果"
}
```

### POST /api/case-list/restore
恢復已排除個案
```json
{"case_id": 1}
```

### GET /api/case-list/exclusion-reasons
排除理由選項（啟用中）

### POST /api/case-list/review-exclusion
品管中心審核排除（reviewer）
```json
{
  "case_id": 1,
  "approved": true,          // 或 false
  "reviewer_note": "..."
}
```

---

## 📈 儀表板資料 API（填報系統版）

### GET /api/dashboard/entry-data
取得填報系統版儀表板資料（從 IndicatorEntry 即時計算）
- **Query**：`campus_id`、`year`、`month`、`category`

### GET /api/dashboard/entry-benchmarks
取得該月份的標竿參考值

---

## ⚠️ 錯誤回應格式

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "target_value 必須為數字"
  }
}
```

### 常見錯誤代碼
- `BAD_REQUEST` (400) — 參數錯誤
- `BAD_FILE` (400) — 上傳的檔案無法解析為 Excel
- 未登入／權限不足／CSRF：一律 403，見下節（不會回 401）
- `NOT_FOUND` (404) — 資源不存在
- `METHOD_NOT_ALLOWED` (405) — HTTP method 錯
- `CONFLICT` (409) — 狀態衝突（如重複送審）
- `INTERNAL_ERROR` (500) — 伺服器錯誤

### 認證 / 權限 / CSRF 錯誤
這四類一律 HTTP 403（未登入也是 403，不是 401），body 為 `{"detail": "...", "code": "..."}`：

| code | 意義 |
|------|------|
| `not_authenticated` | 未登入（或帳號已停用）→ 前端應導向登入頁 |
| `permission_denied` | 已登入但角色不符 |
| `password_change_required` | 已登入，但 `must_change_password` 為 true（新帳號、被管理員重設密碼）→ 前端應導向登入頁的改密碼表單；只有 `me`、`logout`、`change-password` 不受限 |
| `csrf_failed` | 寫入請求缺少或帶錯 `X-CSRFToken` |

另有 **HTTP 429 `locked`**（`{"detail": "登入失敗次數過多，請 5 分鐘後再試", "code": "locked"}`）：登入失敗次數超過上限，見 `POST /api/auth/login`。

DRF 端點的其他例外（404、405 等）也會多一個 `code`；欄位驗證錯誤（`{"欄位": [...]}`）維持原格式。

---

## 🔐 權限矩陣

角色：`viewer`（儀表板檢視者）、`reporter`、`reviewer`、`admin`。**admin 通過所有檢查**（`is_superuser` 亦同；Django 的 `is_staff` 只決定能否進 `/admin/` 後台，與 API 權限無關）。「讀者」＝ viewer / reviewer / admin。下表 reporter、reviewer 也都隱含 admin。

| 端點 | 允許角色 |
|------|---------|
| `POST /api/auth/login` | 匿名（唯一豁免 CSRF 的端點） |
| `/api/auth/me`、`logout`、`change-password` | 已登入即可（含尚未指派角色者，以及必須先變更密碼者）。**其餘所有端點**對 `must_change_password` 為 true 的使用者一律 403 `password_change_required`，不論角色 |
| `GET /api/v1/dashboard/`、`GET /api/v1/indicators/`、`GET /api/v1/indicators/{code}/`（含 `data`、`alerts`、`summaries`、`analysis`）、`GET /api/v1/tcpi/`、`GET /api/v1/indicators/export/element-list/`、`GET /api/dashboard/entry-data`、`entry-benchmarks` | 讀者 |
| `PATCH /api/v1/indicators/{code}/`、`POST /api/v1/tcpi/`、`GET /api/v1/indicators/export/`（全量匯出）、`/api/v1/imports/*` | admin |
| `GET /api/davinci/meta/`、`indicators/`、`indicators/{code}/series/`、`drilldown/`（彙總，不含逐案） | 讀者 |
| `GET /api/davinci/cases/`、`export/`（逐案明細：帳號、醫師姓名；xlsx 第二個工作表） | reviewer |
| `POST /api/davinci/import/`、`import/confirm/`、`GET /api/davinci/import/logs/` | admin |
| `/api/entry/*` | reporter |
| `GET /api/case-list/`、`GET /api/case-list/exclusion-reasons` | reporter / reviewer |
| `POST /api/case-list/exclude`、`restore` | reporter |
| `POST /api/case-list/review-exclusion`、`/api/review/*`（`unlock` 除外）、`/api/import/*` | reviewer |
| `POST /api/review/unlock`、`/api/admin/*`（users、campuses、categories、assignments、deadlines） | admin |

實作：`backend/apps/accounts/permissions.py`；逐端點的測試契約：`backend/apps/accounts/tests/test_permissions.py` 的 `MATRIX`（新增端點若沒有登記進去，測試會失敗）。
