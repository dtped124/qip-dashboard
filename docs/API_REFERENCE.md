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

### GET /api/auth/options
登入頁用的公開設定（免登入；GET 不需要 CSRF token；回應帶 `Cache-Control: no-store`）。
```json
// Response 200
{"ldap_enabled": false}
```
- `ldap_enabled` 為 `true` 時，登入頁副標改為「請以員工編號與院內 AD 密碼登入」，帳號管理頁的新增對話框不顯示密碼欄。只回這一個布林值，不洩漏任何 AD 設定。

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
  "must_change_password": false,
  "auth_source": "local",
  "auth_method": "local"
}
```
- 帳號或密碼錯誤：400 `{"non_field_errors": ["帳號或密碼錯誤"]}`。
- **`auth_source`**（所有使用者物件都有，含 `GET /api/admin/users`）：這個帳號平常用什麼登入。`"ldap"` = 用院內 AD 密碼；`"local"` = 用本系統的本地密碼。`LDAP_ENABLED` 關閉時一律 `"local"`；啟用時，不在 `LDAP_LOCAL_ONLY_ACCOUNTS` 清單內的帳號是 `"ldap"`。不是資料庫欄位，由設定推得。
- **`auth_method`**（只在登入與 `GET /api/auth/me` 的回應）：**這一次 session** 是怎麼登入的，`"ldap"` 或 `"local"`。LDAP 啟用且這個 session 的認證後端是 AD 才是 `"ldap"`；LDAP 關閉後，原本的 AD session 立刻變回 `"local"`。
- **AD 登入**（`LDAP_ENABLED=true`，預設關閉；設定見 `docs/DEPLOYMENT.md`）：非 `LDAP_LOCAL_ONLY_ACCOUNTS` 的帳號先走 AD 兩階段驗證（服務帳號搜尋 → 以使用者 DN 驗證密碼），本地密碼不會被拿來登入；AD 成功且系統有此帳號才登入，角色來自本地帳號。額外的回應：
  - **403** `{"detail": "AD 驗證成功，但系統尚未開通此帳號，請洽品管中心", "code": "account_not_provisioned"}`：AD 認得這個人，但系統沒有他的帳號（`LDAP_AUTO_CREATE=false`）。計入登入鎖定。
  - **503** `{"detail": "目前無法連線到院內 AD 驗證服務，請稍後再試或洽資訊室", "code": "ldap_unavailable"}`：連不上 AD、逾時，或服務帳號 bind 失敗。**不計入登入鎖定**；失敗後 30 秒內其他登入直接回 503（斷路器）。
  - AD 密碼錯、AD 查無此人、帳號已停用：一律 400 `{"non_field_errors": ["帳號或密碼錯誤"]}`，計入登入鎖定（不洩漏帳號是否存在於 AD）。
  - `LDAP_LOCAL_ONLY_ACCOUNTS` 內的帳號不打 AD，只比本地密碼；清單為空時，連 `admin` 以本地密碼登入也是 400。
- AD 登入成功時，若帳號的 `must_change_password` 為 `true`，會自動清成 `false` 並作廢它的本地臨時密碼，所以 AD 使用者不會被要求改密碼。
- 回應與 `GET /api/auth/me` 的 `roles` 是**有效角色**：Django 超級使用者（`is_superuser`）一律含 `"admin"`，即使資料庫裡存的 `roles` 是空的（後端對這種帳號本來就放行所有檢查）。只改輸出，不寫回資料庫；`/api/admin/users*` 仍回資料庫裡存的角色。
- **登入鎖定**（django-axes；帳號比對與計數都不分大小寫，`a123` 與 `A123` 算同一個帳號）：同一帳號連續失敗 5 次（`AXES_FAILURE_LIMIT`）即鎖定 5 分鐘（`AXES_COOLOFF_MINUTES`）。從第 5 次失敗起，鎖定期間連正確密碼也一律回 **429** `{"detail": "登入失敗次數過多，請 5 分鐘後再試", "code": "locked"}`（訊息中的分鐘數取自 `AXES_COOLOFF_MINUTES`）；鎖定期間的嘗試不會延長鎖定（API 登入與 Django 後台都一樣）。登入成功會清掉該帳號先前的失敗次數。管理員重設該帳號的密碼（或 `seed_admin --reset`、`manage.py axes_reset_username <帳號>`）即時解鎖。Django 後台（`/admin/login/`）的失敗與此共用同一個計數。
- 注意：經 Next 代理後 Django 看到的來源位址對所有人都相同，鎖定實際上是「每個帳號」而非「每個來源」——知道帳號名稱的人可以用幾次錯誤密碼鎖住該帳號（每個冷卻期可重來一次）。本機制擋的是密碼猜測，不是阻斷服務；per-IP 限流要在平台邊緣（LB / WAF）做。
- `must_change_password` 為 `true` 時登入仍回 200，但在改完密碼之前，除了 `me`、`logout`、`change-password` 以外的 API 一律 403 `password_change_required`。

### POST /api/auth/logout
登出（清除 session）

### GET /api/auth/me
取得當前登入使用者資訊（`must_change_password` 為 true 時也可呼叫；含 `auth_source` 與 `auth_method`，見 `POST /api/auth/login`）。回應（含 403）一律帶 `Cache-Control: no-store`，瀏覽器與 proxy 都不得快取「現在是誰登入」。前端（`lib/auth/store.ts`）每次載入頁面只呼叫一次。

### POST /api/auth/change-password
更改自己的密碼（`must_change_password` 為 true 時也可呼叫）
```json
// Request
{"current_password": "...", "new_password": "..."}

// Response 200
{"detail": "密碼已更新"}
```
- **403** `{"detail": "您的密碼由院內 AD 管理，如需變更請洽資訊室", "code": "ldap_managed"}`：目前這個 session 是用 AD 登入的（`auth_method` 為 `"ldap"`）。AD 密碼不在本系統改，閘門在嘗試次數計數**之前**，不會累計猜測次數。用 `LDAP_LOCAL_ONLY_ACCOUNTS` 內的本地帳號登入者不受影響。
- 400：`current_password` 不正確、新密碼與目前密碼相同，或新密碼不符規則；錯誤依欄位回傳，如 `{"new_password": ["...", "..."]}`。
- **嘗試次數限制**（`PASSWORD_CHANGE_FAILURE_LIMIT`，預設 5；`PASSWORD_CHANGE_COOLOFF_MINUTES`，預設 5）：以使用者 id 在 Django cache 計數。同一使用者 **5 分鐘內連續 5 次**沒能證明目前密碼的呼叫照常回應（密碼錯誤是 400）；**第 6 次起回 429** `{"detail": "嘗試次數過多，請 5 分鐘後再試", "code": "too_many_attempts"}`，連正確密碼也一樣、不看 body，直到冷卻期過去。被拒的呼叫不會延長冷卻；證明了目前密碼（改密碼成功，或密碼對但新密碼被拒）就歸零，管理員重設該帳號的密碼（含 `seed_admin --reset`）也會歸零。這是為了讓被盜的 session 不能拿此端點猜密碼（登入鎖定看不到這裡的猜測）。計數存在 cache：`REDIS_URL` 為空時用行程內記憶體（每個 worker 各算各的）；cache 連不上（Redis 掛掉）時不節流、記一筆 warning，呼叫照常處理，不會回 500。
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
- **Query**：`campus`（省略時為 `竹北`）、`category`、`search`
- **伺服器端快取**（`backend/apps/indicators/cache.py`，P8）：算好的回應存在 Django cache（Redis），key 由 `campus`、`category`、`search` 與版本號組成；第二次起同樣的請求直接取自快取，不查 DataPoint／Alert 等表。權限檢查在讀快取之前（沒權限一律 403），所有可讀角色共用同一份。會改變儀表板的寫入——Excel 匯入、`correct-datapoint`、`PATCH /indicators/{code}/`（目標值）、`POST /tcpi/`、Django 後台編輯、`seed_indicators`／`refresh_alerts`／`wipe_datapoints`——完成後立刻使它失效；`DASHBOARD_CACHE_TTL`（預設 600 秒）是保底。Redis 連不上時照常重新計算並記 warning，不回 500
- **回應標頭 `X-Dashboard-Cache`**：`HIT`（取自快取）、`MISS`（重新計算並存入快取）、`BYPASS`（沒用到快取：`DASHBOARD_CACHE_ENABLED=false`——沒設定時，沒有 `REDIS_URL` 也是 false——、cache 連不上，或 `campus`／`category`／`search` 組成的 key 超過長度上限而不存；都是重新計算）
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

> `/api/admin/users*` 的所有回應（含錯誤與 403）都帶 `Cache-Control: no-store`。

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
- 新帳號一律 `must_change_password = true`（AD 帳號例外，見下）。
- `employee_id` 不分大小寫檢查重複：已有 `abc` 時再建 `ABC` 回 400 `{"employee_id": ["此帳號已存在（帳號不分大小寫）"]}`（AD 與登入都不分大小寫，兩筆會是同一個人）。
- **AD 帳號**（`LDAP_ENABLED=true`，且 `employee_id` 不在 `LDAP_LOCAL_ONLY_ACCOUNTS` 內）：帳號（員工編號）須與 AD 的 `sAMAccountName` 一致。系統**不產生臨時密碼**：帳號設為不可用密碼、`must_change_password = false`，201 回應**沒有** `temporary_password`；若請求帶了非空的 `password`，回 400 `{"detail": "AD 帳號不需要設定密碼，登入時使用 AD 密碼", "code": "ldap_managed"}`，不建立帳號。清單內的本地帳號照舊（產生臨時密碼、回傳一次）。
- `roles` 必須是清單，且每個值都是 `reporter` / `reviewer` / `admin` / `viewer` 之一（重複的會去除）；否則 400 `{"roles": [...]}`。

### GET/PATCH/DELETE /api/admin/users/{pk}
使用者 CRUD。PATCH 同樣驗證 `roles`。管理員不能對自己：停用帳號（400 `cannot_deactivate_self`）、移除自己的 `admin` 角色（400 `cannot_remove_own_admin_role`）、刪除帳號（400）。

### POST /api/admin/users/{pk}/reset-password
重設密碼：產生隨機臨時密碼，設 `must_change_password = true`，同時解除該帳號的登入鎖定與變更密碼的嘗試次數，並使其現有的所有 session 失效。
```json
// Response 200（只回這一次，不寫 log、不存明文；帶 Cache-Control: no-store）
{"temporary_password": "Xk7#mQ2-vR9pLw"}
```
臨時密碼至少 12 個字元，含大小寫字母、數字、符號，並通過密碼規則。
- **AD 帳號不能重設密碼**：`LDAP_ENABLED=true` 且該帳號不在 `LDAP_LOCAL_ONLY_ACCOUNTS` 內時回 400 `{"detail": "此帳號以 AD 登入，不需重設密碼；密碼問題請洽資訊室", "code": "ldap_managed"}`，不產生密碼、不解除鎖定。要解鎖 AD 帳號：等 5 分鐘，或在伺服器上 `manage.py axes_reset_username <帳號>`。

---

## 📌 指派管理 API（admin 限定）

### GET /api/admin/campuses
院區清單

### GET /api/admin/categories
填報面向清單

### GET /api/admin/assignments
指派列表（只列現行有效的列，即 `effective_to` 為 null）
- **Query**：`campus`（院區代碼，如 `zhubei`）、`indicator`（指標代碼）、`field`（`both` / `numerator` / `denominator`）
- `field` 是依儲存值精確比對：`?field=numerator` 只列「只負責分子」的列，不含 `both`；其他值回 400 `invalid_field`

### POST /api/admin/assignments
新增指派
```json
{
  "indicator_code": "HA01-01",
  "campus": 1,                          // 院區 id
  "user": 5,                            // 使用者 id
  "role": "primary",                    // primary / deputy
  "field": "numerator",                 // both（預設）/ numerator / denominator
  "effective_from": "2026-01-01",
  "effective_to": null
}
```
回應（201）是同樣的欄位加上 `id`、`campus_name`、`user_name`、`user_employee_id`、`created_by`、`created_at`。

**欄位級指派（D2）**：一個指標的分子與分母可以指派給不同的人。`field` 預設 `both`，舊資料 migrate 後全是 `both`。

**驗證**（POST 與 PATCH 相同；PATCH 先把送來的欄位疊在既有那一列上，再驗整列）。失敗回 400，格式是欄位驗證錯誤 `{"欄位": ["訊息"]}`，組合性的錯誤在 `non_field_errors`：
- 指標代碼必須存在（`indicator_code`）
- 沒有分母的指標（`has_denominator=false`）不能只指派分母（`field`）；`both` 與 `numerator` 可以
- 被指派者必須啟用中且有 `reporter` 角色，admin 角色也可以（`user`）。修改既有指派時只在「換人」或「把已結束的指派重新開啟」才重驗，所以結束一個已停用帳號的指派永遠做得到
- `effective_from <= effective_to`（`effective_to`）
- 同一 (指標, 院區, 使用者) 不能同時有兩筆現行（`effective_to` 為 null）而且涵蓋同一個欄位的指派；`both` 與任何欄位都重疊，`numerator` 與 `denominator` 不重疊（`non_field_errors`）。不同使用者不受限制（正職＋代理人可以負責同一欄位）

### GET/PATCH/DELETE /api/admin/assignments/{pk}
指派 CRUD。修改走上面同一套驗證；`DELETE` 是硬刪除，要保留歷史請 `PATCH` 設定 `effective_to`。

### GET /api/admin/deadlines
截止日列表

### POST /api/admin/deadlines
設定每月截止日
```json
{"year": 115, "month": 2, "deadline_day": 15, "note": "春節延長"}
```

---

## 📝 填報 API

權限：reporter（admin 也通過這道閘門，但能改哪些欄位仍然看指派，見 KD4）。

> **欄位級指派（P5）**：一個指標的「分子」與「分母」可以指派給不同的人（`IndicatorAssignment.field` ＝ `both` / `numerator` / `denominator`）。後端真的把關：存檔只寫你有權的欄位、絕不覆寫別人的欄位；送審檢查整個「院區 × 面向」。規則總覽見 `QIP-DataEntry-System-Spec-v1.3.md` §2.4。回應以「新增欄位」為主，但**不是完全向下相容**：與 P5 之前不同、舊前端會碰到的地方集中列在本節最後的「與 P5 之前的差異」。

**院區（`campus`）**：填報端所有端點用 `campus`（院區代碼，如 `zhubei`；GET 放 query、POST 放 body）決定在做哪個院區。**不再退回使用者帳號上的院區**：
- 有給 `campus`：必須是你在該面向、該月份有現行指派的院區，否則 403 `campus_not_assigned`。admin 不受此限（可指定任何院區），不存在的代碼是 400 `campus_not_found`
- 沒給：該面向只有一個院區 → 用它；有多個 → 400 `campus_required`（請指定院區）；一個都沒有 → 400 `no_assignment`（此面向沒有指派給你的指標；admin 則是 `campus_required`）

**月報鎖定（KD1）**：狀態為 `submitted`、`approved`、`finalized` 時填報者不能再改（回應的 `report.locked` 為 true），只有品管中心（審核端）能改。

### GET /api/entry/my-tasks?year=115&month=3
當前使用者的待辦。每個「院區 × 面向」一列（以前只用面向代碼當 key，兩個院區會互相蓋掉）。
```json
{
  "period": {"year": 115, "month": 3},
  "deadline": {"deadline_day": 10, "deadline_date": "2026-04-10", "tw_deadline_date": "115年4月10日",
               "days_remaining": 12, "is_overdue": false},
  "rejection_notices": [
    {"category_code": "HA02", "category_name": "加護照護", "campus_code": "zhubei", "campus_name": "竹北",
     "reason": "分母明顯錯誤", "report_id": 123}
  ],
  "categories": [
    {
      "category_code": "HA02", "category_name": "加護照護", "category_color": "#EF4444",
      "campus_code": "zhubei", "campus_name": "竹北",
      "report_id": 123, "status": "draft", "rejection_reason": "",
      "filled_count": 3, "total_count": 8,
      "my_filled": 5, "my_total": 12,
      "category_missing": 7
    }
  ],
  "overall_progress": {"filled": 3, "total": 8}
}
```
- `total_count` / `filled_count`：我負責的指標數／其中我負責的欄位都已填的指標數（既有欄位；「已填」改看必填欄位是否為 NULL，分母 0 算已填）
- `my_total` / `my_filled`：我負責的欄位數／已填的欄位數（只負責分子的指標算 1 個欄位；沒有分母的指標只有分子）
- `category_missing`：整個「院區 × 面向」還缺幾個必填欄位，不論負責人是誰（送審要全齊，見下）
- 只列我有現行指派的院區 × 面向；`rejection_notices` 同樣只含這些，並帶院區

### GET /api/entry/form?year=115&month=3&category=HA01&campus=zhubei
取得填報表單資料。**唯讀：不會建立任何資料**；月報還不存在時 `report.id` 是 null、`status` 是 `unfilled`。
```json
{
  "report": {"id": null, "status": "unfilled", "rejection_reason": "", "submitted_at": null,
             "is_late": false, "locked": false},
  "category": {"code": "HA01", "name": "整體住院照護", "color": "#3B82F6"},
  "campus": {"code": "zhubei", "name": "竹北"},
  "period": {"year": 115, "month": 3},
  "deadline": {"deadline_day": 10, "deadline_date": "2026-04-10", "tw_deadline_date": "115年4月10日",
               "days_remaining": 12, "is_overdue": false},
  "indicators": [
    {
      "indicator_code": "HA01-01", "indicator_name": "住院死亡率", "unit": "percent", "direction": "lower",
      "has_denominator": true, "entry_mode": "manual",
      "numerator": 5.0, "denominator": null, "value": null, "note": "",
      "prev_value": 4.0, "prev_numerator": 4.0, "prev_denominator": 100.0, "change_pct": 25.0,
      "sub_entries": [], "is_ha10_hsinchu": false,
      "editable_fields": ["numerator"],
      "field_owners": {"numerator": ["王小明"], "denominator": ["李大華"]},
      "numerator_filled_by": "王小明", "numerator_filled_at": "2026-03-05T09:12:00+08:00",
      "denominator_filled_by": null, "denominator_filled_at": null
    }
  ]
}
```
- `indicators` 只列**我有現行指派的指標**。別人專屬的指標不列：P5 之前的前端存檔時會把表單列出的每一列都送回來，若列出不屬於我的指標，整筆存檔就會被 403
- `editable_fields`：我能在這個指標填的欄位（`numerator`、`denominator` 的子集，依序）。沒有分母的指標只有 `numerator`；個案清單指標（`entry_mode=case_list`）一律是 `[]`（表單唯讀，KD9，數字來自個案清單頁與匯入）
- `field_owners`：兩個欄位各自的現行負責人姓名（沒有分母的指標 `denominator` 為 `[]`）；只負責一半時，另一半的值、負責人、是誰填的都在同一列裡
- `numerator_filled_by/at`、`denominator_filled_by/at`：這個欄位最後是誰、何時填的（姓名／ISO 時間；從未填過為 null）
- `report.locked`：後端算好的「填報者目前不能改」
- `is_ha10_hsinchu`／`sub_entries`（D10）：**只有 `HA10-01` × 新竹**是 13 類子項加總；其他 HA10 指標（含新竹的 `HA10-04`）和其他院區的 `HA10-01` 都是一般數字，`sub_entries` 為 `[]`

### POST /api/entry/save-draft
儲存草稿（狀態 unfilled → draft；已是 draft 則不變）
```json
{
  "year": 115, "month": 3, "category": "HA01", "campus": "zhubei",
  "entries": [
    {"indicator_code": "HA01-01", "numerator": 5, "note": "..."},
    {"indicator_code": "HA10-01", "sub_entries": [{"sub_code": "HA10-10-01", "value": 4}]}
  ]
}
```
規則（整筆在同一個交易、整個月報列被鎖住；任何一項不符就**什麼都不寫**）：
1. 月報是 `submitted`／`approved`／`finalized` → 403 `report_locked`（body 另有 `status`）
2. payload 裡有未指派給我的指標 → 403 `not_assigned`，`codes` 列出這些指標
3. payload 裡出現我沒有權限的欄位（key 有出現就算，連 `null` 也是）→ 400 `field_not_assigned`，`fields` 是 `[{"indicator_code", "field"}]`。例外：沒有分母的指標，`"denominator": null` 視為沒有（舊前端會送）
4. 只處理 payload 裡**有出現**的 key：沒出現 = 不動，`null` = 清空，字串數字（`"5"`）可以。不是數字（含 `""`、`NaN`、超出欄位範圍）→ 400 `invalid_number`，`errors` 列出是哪個欄位，不再靜默略過
5. 數值有變才更新該欄位與它的 `*_filled_by/at`（自動暫存重送同樣的值不會改變填報者）；`note` 有出現、且我有該指標的指派就寫（只負責一半欄位也行；個案清單指標沒有可編欄位，備註照樣能寫）。備註是整個指標共用的一欄，不分分子分母，兩位負責人都改它時後存的會蓋掉前一個
6. `value` 一律用鎖住後的最新分子／分母重算，所以別人剛填的分母會被用上，也不會被蓋掉
7. `HA10-01` × 新竹：`sub_entries` 視同分子（需有 `numerator` 權限），分子＝13 類加總（沒帶的子類別維持原值；全部為空則分子為 null）；只送 `numerator` 不送 `sub_entries` → 400 `invalid_payload`；同時送兩者時以加總為準。只要帶了 `sub_entries`，分子就一律被設成加總（即使子項沒變，這會修正與子項脫鉤的分子）。其他指標送**非空**的 `sub_entries` → 400 `invalid_payload`；空陣列 `[]`（或 `null`）視為沒送，不算錯
8. 個案清單指標的數字欄位不能由表單寫入（見 `editable_fields`），只送 `note` 則可以
9. **沒有可寫的東西就什麼都不建**：`entries` 為空、或每一筆只有 `indicator_code`（以及只有 `sub_entries: []`、沒有分母指標的 `"denominator": null` 這類等於沒送的內容）→ 不建立月報、不改狀態，回 200 `{"ok": true, "report_id": null, "status": "unfilled", "entries": []}`（月報已存在則回它的 id 與原狀態，不升成 draft）。有明確的 `null`（清空某欄）或 `"note": ""` 則算有東西要寫

```json
// 200
{
  "ok": true, "report_id": 123, "status": "draft",
  "entries": [
    {"indicator_code": "HA01-01", "numerator": 5.0, "denominator": 100.0, "value": 5.0, "note": "...",
     "numerator_filled_by": "王小明", "numerator_filled_at": "...",
     "denominator_filled_by": "李大華", "denominator_filled_at": "...",
     "filled_by": "王小明", "filled_at": "...", "sub_entries": [], "is_ha10_hsinchu": false}
  ]
}
```
`entries` 是伺服器端存檔後的最新值（payload 裡每個指標一列，含別人填的欄位）；前端應以它更新畫面。

### POST /api/entry/submit
送審（draft／unfilled → submitted）
```json
{"year": 115, "month": 3, "category": "HA01", "campus": "zhubei"}
```
- 資格：我在該院區、該面向有現行指派（哪個欄位都算），或我是 admin（可代為送審，KD4）。沒有資格時，錯誤在院區解析那一步就回了（上面「院區」）：`campus` 不在我的指派內 → 403 `campus_not_assigned`；沒帶 `campus` 且我在該面向沒有任何指派 → 400 `no_assignment`。送審本身不會再回 `not_assigned`（服務層留著那一道檢查，只防直接呼叫它的程式）
- 檢查範圍（KD3）：**整個「院區 × 面向」所有有現行指派的指標**，不只我自己的。每個必填欄位都不可為 NULL（KD2）：分子一律必填，有分母的指標分母也必填；**分母 0 算已填**（`value` 為 null，但可以送審）。`HA10-01` × 新竹另外要 13 個子類別都有值
- 月報已是 `submitted`／`approved`／`finalized` → 403 `report_locked`；該面向沒有任何指派 → 400 `no_indicators`
- 缺漏 → 400 `incomplete`：
```json
{
  "detail": "送審前提未達：以下必填欄位尚未填寫：HA01-01 分母（李大華）；HA01-02 分母（未指派）",
  "code": "incomplete",
  "missing": [
    {"indicator_code": "HA01-01", "indicator_name": "住院死亡率", "field": "denominator",
     "owners": ["李大華"], "unassigned": false},
    {"indicator_code": "HA01-02", "indicator_name": "...", "field": "denominator",
     "owners": [], "unassigned": true}
  ]
}
```
  `owners` 是該欄位的現行負責人；沒有人負責時 `owners` 為空、`unassigned` 為 true（訊息裡標「未指派」）。`HA10-01` × 新竹的缺漏另有 `sub_codes`（缺哪幾個子類別）。為了舊前端，body 仍帶 `unfilled_codes`（有缺漏的指標代碼）
- 成功：`{"ok": true, "report_id": 123, "status": "submitted"}`，並清掉退回理由、記下送審者與時間

### 填報端錯誤碼
全部是 `{"detail": "...", "code": "..."}`，另有下表的額外欄位。

| HTTP | code | 意義 |
|------|------|------|
| 403 | `report_locked` | 月報已送審／核准／送出，填報者不能改（`status`）。save-draft、submit、case-list exclude／restore 都會回 |
| 403 | `not_assigned` | save-draft：payload 有未指派給我的指標（`codes`）；`GET /api/case-list/`：我沒有該指標在該院區該月的指派；case-list exclude／restore：個案不屬於我負責分子的指標。（送審沒有資格時回的是 `campus_not_assigned`／`no_assignment`） |
| 403 | `campus_not_assigned` | 指定的 `campus` 不在我於該面向的有效指派院區內（form、save-draft、submit 都是） |
| 400 | `field_not_assigned` | payload 含我沒有權限的欄位（`fields`） |
| 400 | `incomplete` | 送審前提未達（`missing`） |
| 400 | `campus_required` | 有多個院區，請指定 `campus` |
| 400 | `no_assignment` | 此面向沒有指派給我的指標 |
| 400 | `campus_not_found` | admin 指定的院區代碼不存在 |
| 400 | `no_indicators` | 此院區×面向沒有任何現行指派，沒有東西可送審 |
| 400 | `invalid_number` | 不是數字或超出欄位範圍（`errors`） |
| 400 | `invalid_payload` | payload 格式錯誤（`errors` 或只有 `detail`） |
| 400 | `value_out_of_range` | 算出的值放不進欄位，請檢查分子與分母 |
| 400 | `invalid_period` | `year`／`month` 不正確 |
| 400 | `missing_params` | 缺 `year`／`month`／`category` |
| 404 | `category_not_found` | 沒有這個面向 |

### 與 P5 之前的差異（舊前端會碰到的）
P5 之前的前端（P6 之前仍在線上的版本）會碰到這些；表中沒有的欄位與端點沒有改變。

| 項目 | P5 之前 | 現在 |
|------|---------|------|
| 送審缺漏的錯誤 body | `{detail, ok, error, unfilled_codes}` | `{detail, code: "incomplete", missing, unfilled_codes}`，**不再有 `ok`、`error`** |
| `form` 的 `report.id` | 一律是數字（GET 會順手建立月報） | 月報還不存在時為 **`null`**，`status` 為 `unfilled`；GET 不再建立任何資料 |
| 月報被鎖時存檔／送審 | 400（`approved` 還能存） | **403 `report_locked`**；`approved` 也鎖 |
| 多個院區的面向，沒帶 `campus` | 悄悄用第一筆指派的院區 | 400 `campus_required` |
| 面向沒有任何指派 | 退回帳號所屬院區，顯示空表單 | 400 `no_assignment` |
| `campus` 不在指派內 | （沒有這個參數） | 403 `campus_not_assigned` |
| `my-tasks` 的列 | 一個面向一列（兩院區互相覆蓋） | 一個「院區 × 面向」一列，同一面向可能出現兩列 |
| 存檔 payload 含沒有權限的欄位或指標 | 照寫（缺的 key 還會把別人的值蓋成 NULL） | 400 `field_not_assigned`／403 `not_assigned`，整筆不寫 |
| 個案清單指標 | 表單可寫分子分母 | 數字欄位唯讀（`editable_fields: []`），舊表單送回數字 → 400 `field_not_assigned` |
| 沒有可寫的東西的存檔 | 建立 draft 月報 | 不建立、不改狀態，`report_id` 為 `null` |
| `GET /api/case-list/` | 任何登入的填報者／審核者都能讀任何個案清單，完整病歷號看 `user.campus` | reporter 需有該指標在該院區該月的現行指派，否則 403 `not_assigned`；reviewer／admin 全部可讀；完整病歷號看「reviewer／admin 或在該院區有現行指派」，不再看 `user.campus` |
| `year`／`month` 不合法 | 500 | 400 `invalid_period`（POST 的 `year`／`month` 缺或不是數字為 400 `missing_params`） |
| `filled_count`（`my-tasks`） | 分子或計算值不是 NULL 就算已填 | 必填欄位（分子；有分母的指標還有分母）都不是 NULL 才算（分母 0 算已填） |

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

### PATCH /api/review/edit-entry
審核者直接修改指標數據（自動寫入 EntryAuditLog）
```json
{
  "entry_id": 456,
  "field": "numerator",          // numerator / denominator / value / note
  "new_value": "6",              // 數字（字串或 JSON 數字皆可，0 就是 0）；空字串或 null = 清空；note 為文字
  "reason": "與 HIS 對帳修正"
}
```
- **不受欄位指派限制**（KD5）：審核者可以改分子或分母，不論它們指派給誰
- **只在月報為 `submitted`／`approved` 時可改**。`unfilled`／`draft` 是填報者的（改了會被他的自動暫存蓋掉）→ 400 `report_not_editable`；`finalized` → 400 `report_finalized`
- **不改**分子／分母的「誰填的」（`numerator_filled_by/at`、`denominator_filled_by/at`）與 `filled_by/at`，修改者只留在 `EntryAuditLog`
- 有分母的指標**不能直接改 `value`**（400 `value_not_editable`），請改分子或分母；沒有分母的指標 `value` 就是分子，改 `value` 等於改分子（audit log 記在 `numerator`）。沒有分母的指標改 `denominator` → 400 `no_denominator`
- 改分子／分母後 `value` 一律用 `compute_value` 重算（分母 0 或缺 → `value` 為 null，不再留下舊值）；算出的值放不進欄位 → 400 `value_out_of_range`
- **新竹 `HA10-01` 的分子（13 類子項加總）不能直接改**：`numerator`、`value` 一律 400 `field_not_editable`，訊息請對方改子項（可退回給填報者修正）；`note` 仍可改。其他院區的 `HA10-01` 與新竹的其他 HA10 指標不受影響
- 其他錯誤：400 `invalid_number`（不是數字）、`field_not_editable`（不在上面四個欄位內，或上一條）、`entry_not_found`
- 回應：`{"ok": true, "entry_id": 456, "field": "numerator", "new_value": "6.00", "value": "6.000000"}`

### POST /api/review/finalize
定稿（approved → finalized，寫入 data_points 表，鎖定不可改）
```json
{"report_id": 123}
```

### POST /api/review/unlock
解鎖已定稿月報（finalized → approved，限 admin）
```json
{"campus": "zhubei", "year": 115, "month": 3, "reason": "..."}
```
回應 `{"ok": true, "unlocked_count": 3}`（實際解鎖的月報數；以前永遠回 0）。該院區該月沒有已送出的月報 → 400。

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

### GET /api/case-list/?indicator=HA03-01&campus=zhubei&year=115&month=3
取得某指標某院區某月的個案清單（`entry_mode=case_list` 的指標）。權限：reporter、reviewer、admin。
- **誰能讀（P5）**：reviewer、admin 讀得到全部；reporter 只讀得到「我在該院區、該月有現行指派（哪個欄位都算）」的那個指標，否則 403 `not_assigned`。這一關在查任何資料之前，所以被拒的人分不出院區、月報、指標存不存在（不存在也是 403）；沒被拒的人才會得到 404（院區或指標數據不存在）。viewer 一律 403 `permission_denied`
- **完整病歷號**：reviewer、admin，以及在該院區該月有現行指派的人看到完整病歷號；其他人看到遮罩版（`A********9`）。能通過上一條的 reporter 必定在該院區有指派，所以實際上 reporter 讀到的是完整病歷號。帳號上的所屬院區（`user.campus`）與 Django 的 `is_staff` 都不影響
- `year`／`month` 不合法 → 400 `invalid_period`；缺參數 → 400
```json
{
  "entry_id": 456,
  "indicator_code": "HA03-01",
  "summary": {"denominator_total": 800, "raw_numerator": 25, "excluded": 3, "final_numerator": 22},
  "records": [
    {"id": 1, "case_role": "numerator", "his_raw_data": {"chart_no": "A123456789", "...": "..."},
     "is_excluded": false, "excluded_by": null, "excluded_at": null,
     "exclusion_reason_code": null, "exclusion_reason_name": null, "exclusion_note": "",
     "reviewer_approved": null, "reviewer_note": ""}
  ]
}
```

### POST /api/case-list/exclude
排除個案
```json
{
  "case_record_ids": [1, 2],
  "exclusion_reason_code": "DUPLICATE",
  "exclusion_note": "已轉院，不計入本院結果"
}
```
**權限（P5）**：`case_record_ids` 必須**全部**屬於「我有分子指派（`numerator` 或 `both`）的指標」的數據，而且月報填報者還能改（不是 `submitted`／`approved`／`finalized`）。任何一個不符（含不存在的 id）→ 403，什麼都不改：`not_assigned`，或 `report_locked`。admin 也一樣要有指派。`case_record_ids` 不是整數清單 → 400 `invalid_ids`，空的 → 400 `missing_params`。
排除後分子重算並記下 `numerator_filled_by/at`（分子有變才記）。

### POST /api/case-list/restore
恢復已排除個案（權限同上）
```json
{"case_record_ids": [1, 2]}
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

AD 登入（`LDAP_ENABLED=true`）另有三個 code，body 同樣是 `{"detail": "...", "code": "..."}`：

| code | HTTP | 出現位置與意義 |
|------|------|---------------|
| `account_not_provisioned` | 403 | `POST /api/auth/login`：AD 驗證成功，但系統沒有此帳號 → 請洽品管中心開通。計入登入鎖定 |
| `ldap_unavailable` | 503 | `POST /api/auth/login`：連不上院內 AD、逾時或服務帳號 bind 失敗 → 稍後再試或洽資訊室。不計入登入鎖定；失敗後 30 秒內直接回 503 |
| `ldap_managed` | 403／400 | 403：`POST /api/auth/change-password`，AD 登入的 session 不能在本系統改密碼。400：`POST /api/admin/users` 對 AD 帳號指定了 `password`，或 `POST /api/admin/users/{pk}/reset-password` 對 AD 帳號 → 密碼由 AD 管理，洽資訊室 |

另有兩種 **HTTP 429**：`locked`（`{"detail": "登入失敗次數過多，請 5 分鐘後再試", "code": "locked"}`）是登入失敗次數超過上限，見 `POST /api/auth/login`；`too_many_attempts`（`{"detail": "嘗試次數過多，請 5 分鐘後再試", "code": "too_many_attempts"}`）是變更密碼時沒能證明目前密碼的次數超過上限，見 `POST /api/auth/change-password`。

DRF 端點的其他例外（404、405 等）也會多一個 `code`；欄位驗證錯誤（`{"欄位": [...]}`）維持原格式。

---

## 🔐 權限矩陣

角色：`viewer`（儀表板檢視者）、`reporter`、`reviewer`、`admin`。**admin 通過所有檢查**（`is_superuser` 亦同；Django 的 `is_staff` 只決定能否進 `/admin/` 後台，與 API 權限無關）。「讀者」＝ viewer / reviewer / admin。下表 reporter、reviewer 也都隱含 admin。

| 端點 | 允許角色 |
|------|---------|
| `POST /api/auth/login` | 匿名（唯一豁免 CSRF 的端點） |
| `GET /api/auth/options` | 匿名（GET，無 CSRF 問題） |
| `/api/auth/me`、`logout`、`change-password` | 已登入即可（含尚未指派角色者，以及必須先變更密碼者）。**其餘所有端點**對 `must_change_password` 為 true 的使用者一律 403 `password_change_required`，不論角色 |
| `GET /api/v1/dashboard/`、`GET /api/v1/indicators/`、`GET /api/v1/indicators/{code}/`（含 `data`、`alerts`、`summaries`、`analysis`）、`GET /api/v1/tcpi/`、`GET /api/v1/indicators/export/element-list/`、`GET /api/dashboard/entry-data`、`entry-benchmarks` | 讀者 |
| `PATCH /api/v1/indicators/{code}/`、`POST /api/v1/tcpi/`、`GET /api/v1/indicators/export/`（全量匯出）、`/api/v1/imports/*` | admin |
| `GET /api/davinci/meta/`、`indicators/`、`indicators/{code}/series/`、`drilldown/`（彙總，不含逐案） | 讀者 |
| `GET /api/davinci/cases/`、`export/`（逐案明細：帳號、醫師姓名；xlsx 第二個工作表） | reviewer |
| `POST /api/davinci/import/`、`import/confirm/`、`GET /api/davinci/import/logs/` | admin |
| `/api/entry/*` | reporter（admin 通過這道閘門，但能改哪些欄位仍看指派；院區、欄位、月報鎖定的規則見「填報 API」） |
| `GET /api/case-list/` | reviewer｜admin 全部可讀；reporter 需有該指標在該院區該月的現行指派（否則 403 `not_assigned`） |
| `GET /api/case-list/exclusion-reasons` | reporter / reviewer |
| `POST /api/case-list/exclude`、`restore` | reporter，而且要有該指標分子的指派、月報未鎖定（否則 403 `not_assigned`／`report_locked`） |
| `POST /api/case-list/review-exclusion`、`/api/review/*`（`unlock` 除外）、`/api/import/*` | reviewer |
| `POST /api/review/unlock`、`/api/admin/*`（users、campuses、categories、assignments、deadlines） | admin |

實作：`backend/apps/accounts/permissions.py`；逐端點的測試契約：`backend/apps/accounts/tests/test_permissions.py` 的 `MATRIX`（新增端點若沒有登記進去，測試會失敗）。
