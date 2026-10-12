# 更新日誌 (CHANGELOG)

## 雲端化 P9 — AD／LDAP 登入（2026-10-12，`feat/ldap-auth`）

院內同仁要用 AD 帳密登入，比照醫中五大任務追蹤系統（2026-08 起已在正式機使用 AD 兩階段驗證）。規則的核心是使用者拍板的一句話：**「有通過 AD 才能進到下一步，由本地帳號決定權限；沒通過 AD 就什麼都沒有，連本地都不能進。」**——AD 是唯一的認證來源，系統裡的本地帳號只決定角色與院區，**帳號開通權仍在品管中心**。`LDAP_ENABLED` 預設 false，交付時 AD 一律關閉，由資訊室上線時自行啟用；關閉時行為與 P8 完全相同（沒有 User 欄位、沒有 migration）。

### ✨ 新功能 / 改進
- **AD 兩階段驗證**（新 `backend/apps/accounts/ldap.py`，純 Python 的 `ldap3`）：服務帳號 bind 搜尋員編 → 取得使用者 DN → 以該 DN 與輸入的密碼 bind。結果分 `success`／`wrong_password`／`not_found`／`error`／`ambiguous`。員編只收 `[A-Za-z0-9._-]` 且 1–20 字，空密碼不連線。連線與等待回覆都有逾時（`LDAP_TIMEOUT`，預設 3 秒；最壞等待約 5 倍），通訊類失敗另寫 30 秒斷路器，期間直接判定連不上
- **`LdapBackend`**（新 `backend/apps/accounts/backends.py`）：`AUTHENTICATION_BACKENDS` 固定三個 `[Axes, LdapBackend, ModelBackend]`（不依開關動態增減）。AD 成功且系統有此帳號 → 登入，角色來自本地帳號；系統無此帳號 → 403 `account_not_provisioned`「AD 驗證成功，但系統尚未開通此帳號，請洽品管中心」；AD 密碼錯、查無此人、帳號停用 → 400「帳號或密碼錯誤」並計入鎖定；AD 連不上 → 503 `ldap_unavailable`「目前無法連線到院內 AD 驗證服務，請稍後再試或洽資訊室」，**不計入鎖定**。本地密碼只對 `LDAP_LOCAL_ONLY_ACCOUNTS` 內的帳號有效（預設空 = 純 AD，連 `admin` 都登不進；要保留緊急管理者就填 `admin`）
- **十個設定鍵**（鍵名與醫中系統相同，全走環境變數）：`LDAP_ENABLED`、`LDAP_SERVER_IP`、`LDAP_PORT`（389）、`LDAP_BIND_USER`、`LDAP_BIND_PASS`、`LDAP_BASE_DN`、`LDAP_TIMEOUT`（3）、`LDAP_AUTO_CREATE`（false）、`LDAP_DEFAULT_ROLE`（viewer，只准 viewer／reporter）、`LDAP_LOCAL_ONLY_ACCOUNTS`。啟用時前四個必填，缺了容器拒絕啟動且錯誤訊息只印鍵名
- **AD 成功時只補不覆寫**：個人欄位（email）只補空缺；AD 姓名與系統姓名不一致只寫 log（`ad_name_mismatch`，同一人 7 天一次），不動 `full_name`、院區、角色。帳號旗標「須改密碼」為 true 時，AD 登入自動清旗標並作廢臨時密碼（AD 使用者不會被要求改密碼）
- **API**：新 `GET /api/auth/options`（免登入）→ `{"ldap_enabled": bool}`；所有使用者物件多 `auth_source`（`"ldap"`／`"local"`，由設定推得，不是欄位），登入與 `/me` 另有 `auth_method`；`POST /api/auth/change-password` 對 AD 登入的 session 回 403 `ldap_managed`「您的密碼由院內 AD 管理，如需變更請洽資訊室」；`POST /api/admin/users` 對 AD 帳號不產生臨時密碼（回應無 `temporary_password`，帶了 `password` 回 400 `ldap_managed`）；`POST /api/admin/users/{id}/reset-password` 對 AD 帳號回 400 `ldap_managed`「此帳號以 AD 登入，不需重設密碼；密碼問題請洽資訊室」；建帳號的 `employee_id` 改為不分大小寫檢查重複
- **維運**：啟動 log 多一行 `[bootstrap] AD 驗證：啟用（主機:埠，base …，逾時 N 秒，本地帳號：…）` 或 `AD 驗證：未啟用（僅本地密碼）`（不印 bind 帳密）；新指令 `python manage.py ldap_check`（服務帳號 bind）、`--user <員編>`（查某人）、`--login`（互動輸入密碼測完整登入）、`--audit`（列出本地啟用帳號在 AD 查無者，管理者標 `[ADMIN]`，以及 AD 姓名與系統姓名不一致者）。容器內：`docker compose -p qip-prod exec api python manage.py ldap_check …`（正式）、`docker compose exec -T api …`（開發；`--login` 不加 `-T`）
- **前端**：登入頁依 `/api/auth/options` 顯示「請以員工編號與院內 AD 密碼登入」，送出前去頭尾空白，403／503 與斷線顯示明確訊息（抽成純函式 `lib/auth/loginError.ts` 並有單元測試）；帳號管理頁對 AD 帳號顯示 `AD` 小標、隱藏「重設密碼」，AD 啟用時新增對話框不出現密碼欄、建立成功且回應有 `temporary_password` 才彈臨時密碼視窗
- **文件與樣板**：`.env.prod.example` 新增第五組「AD／LDAP 登入」、`backend/.env.example` 新段；`docs/DEPLOYMENT.md` 新增 §4.1「啟用 AD 登入的順序」（六步與責任分工）、§4.2 已知限制、變數表、狀態行、疑難排解；`docs/ACCEPTANCE_GUIDE.md` 新增「AD 登入」一節；`docs/API_REFERENCE.md`、`docs/USER_MANUAL.md`、`docs/DEVELOPMENT_GUIDE.md`、`HANDOFF.md`

### 🔧 變更 / 破壞點
- `LDAP_ENABLED` 沒設或為 false 時**行為不變**：LdapBackend 立即讓位給 ModelBackend，不連 AD、不讀其他 `LDAP_*`。沒有 migration、沒有 User 新欄位
- **啟用 AD 之前必須先做**：品管中心用 `admin` 建好自己的 AD 員編管理者帳號（帳號＝員工編號，與 AD 的 `sAMAccountName` 一致，角色管理員）。順序寫錯，啟用後系統沒有任何管理者能登入。完整六步見 `docs/DEPLOYMENT.md` §4.1
- **啟用後 `admin` 預設登不進去**（`LDAP_LOCAL_ONLY_ACCOUNTS` 為空 = 純 AD）。要保留不依賴 AD 的緊急管理者就把 `admin` 填進清單
- 登入鎖定的帳號計數改為**不分大小寫**（`lockout.py` 的 `axes_username` 與 `unlock_account` 都 casefold）：`a123` 錯 3 次加 `A123` 錯 2 次會在第 5 次鎖定；LDAP 關閉時也適用
- 新增相依套件 `ldap3>=2.9.1,<3`（純 Python，只依賴 pyasn1）：既有環境要重建 api 映像
- 帳號管理頁：AD 啟用時新增對話框沒有密碼欄；AD 帳號沒有「重設密碼」

### 🔐 安全性
- **AD 是唯一的門**：非清單帳號在 AD 失敗時**不退回本地密碼**（AD 查無、密碼錯、連不上都一樣）；「清單」是明確填入的例外，預設為空。停用帳號先擋，不打 AD
- **axes 計數改不分大小寫**：AD 與登入都不分大小寫，若鎖定仍分大小寫，換個大小寫就能繞過 5 次上限
- **LDAP filter 跳脫**：員編先過白名單 `^[A-Za-z0-9._-]{1,20}$`，再用 `escape_filter_chars` 組 filter，`*)(` 之類字串不可能改變查詢
- **密碼不入 log**：AD 密碼與服務帳號密碼不出現在 log、錯誤訊息、啟動狀態行或 `ldap_check` 輸出（`@sensitive_variables`；設定驗證的錯誤只列鍵名）；`LDAP_BIND_PASS` 用 `os.environ` 原樣讀取，`$` 開頭也不被當變數
- **pytest 永不連真 AD**：根 `conftest.py` 的 autouse fixture 關閉 `LDAP` 設定並把 `ldap3.Connection` 換成會丟例外的 stub；測試一律用假 AD
- 使用者 bind 階段的未知例外一律當驗證失敗（fail-closed）；連線與使用者階段的例外不會留下半開連線

### ⚠️ 已知限制
- **AD 當機時只有 `LDAP_LOCAL_ONLY_ACCOUNTS` 裡的帳號能登入**；清單為空則無人能登入，直到 AD 恢復或把 `LDAP_ENABLED` 關掉（「AD 是唯一的門」的代價，使用者已知）
- 每個非清單帳號登入都先打 AD；AD 不可達時最壞多等約 5×`LDAP_TIMEOUT` 秒，之後斷路器 30 秒內立即回 503
- 未開通者與 AD 查無者的失敗都進 axes 計數，5 次後鎖定 5 分鐘
- 透過登入頁猜 AD 密碼會累計到 AD 自己的鎖定原則；axes 限速但無法完全避免
- 預設 389 明文 bind（與醫中相同）；LDAPS 需資訊室提供 CA 憑證後另做
- Django 後台 `/admin/password_change/` 不受 `ldap_managed` 閘門限制（僅 `is_staff`）
- 帳號比對 iexact、axes 計數 casefold；`employee_id` 欄位本身仍大小寫敏感（既有行為）
- 關閉 LDAP 回退時，AD 使用者的本地密碼若曾被作廢（首次 AD 登入時旗標為 true 者），需管理者重設

### 📁 修改檔案
| 檔案 | 修改內容 |
|------|---------|
| `backend/apps/accounts/{ldap,backends,signals}.py`（新） | `ldap.py`：AD 兩階段驗證、filter 跳脫、斷路器、`LdapResult`、`LdapUnavailable`；`backends.py`：`LdapBackend`、`is_local_account`、`session_auth_method`、AUTO_CREATE；`signals.py`：登入方式 log（`user_logged_in`） |
| `backend/apps/accounts/management/commands/ldap_check.py`（新） | `ldap_check`：服務帳號 bind、`--user`、`--login`、`--audit` |
| `backend/apps/accounts/{serializers,views,urls,lockout,apps}.py` | 503／403 例外、`auth_source`／`auth_method`、建帳號與重設密碼的 AD 規則（含不分大小寫重複檢查）、`change_password` 的 `ldap_managed` 閘門、`GET /api/auth/options`、axes 計數 casefold、`ready()` 連接 receiver |
| `backend/config/settings/base.py` | `ldap_settings(env)`、`LDAP`、`AUTHENTICATION_BACKENDS` 第二位插入 `LdapBackend` |
| `backend/conftest.py` | autouse `ldap_off`：pytest 不連真 AD |
| `backend/apps/core/management/commands/bootstrap.py` | 啟動時的 AD 驗證狀態行 |
| `backend/requirements.txt` | `ldap3>=2.9.1,<3` |
| `backend/apps/accounts/tests/`、`backend/apps/core/tests/` | AD 客戶端、登入矩陣、`ldap_check`、設定、元測試（新路由登記）、鎖定大小寫 |
| `lib/auth/{loginError,useAuthOptions}.ts` | 登入錯誤訊息純函式（含單元測試）、讀取 `/api/auth/options` |
| `app/entry/login/page.tsx` | AD 副標、帳號去頭尾空白、403／503／斷線訊息 |
| `components/entry/UserManagement.tsx` | `AD` 小標、隱藏「重設密碼」、AD 啟用時新增對話框無密碼欄 |
| `lib/entry/{api,types}.ts` | `getAuthOptions()`、`User.auth_source`／`auth_method` |
| `.env.prod.example`、`backend/.env.example` | LDAP 十個鍵與說明（預設關閉） |
| `docs/DEPLOYMENT.md`、`docs/API_REFERENCE.md`、`docs/ACCEPTANCE_GUIDE.md`、`docs/USER_MANUAL.md`、`docs/DEVELOPMENT_GUIDE.md`、`docs/CHANGELOG.md`、`HANDOFF.md` | 見上 |

### ✅ 測試與驗證
<!-- TBD：測試數字與真 AD 實測結果由主對話補 -->
- 自動化（全用假 AD，`ldap3.Connection` 一律 mock）：設定驗證、AD 客戶端各狀態（含白名單、跳脫、兩個逾時、unbind 例外、斷路器、log 不含密碼）、登入矩陣（AD 成功／失敗／連不上／未開通／停用、清單內外帳號、AUTO_CREATE、鎖定與大小寫）、帳號 API（AD 帳號建立與重設）、`ldap_check` 四種模式、bootstrap 狀態行。數字：TBD
- 迴歸：`LDAP_ENABLED` 未設時既有測試全數維持基準；`ruff`、`manage.py check`、`makemigrations --check --dry-run` 結果：TBD
- 前端：`npm run test:unit`、`npm run lint`、`npx tsc --noEmit`：TBD
- 真 AD 實測（開發機連上院內 Wi-Fi，計畫 2026-10-13 中午後；密碼全程由使用者輸入）：`ldap_check` 三種模式、未開通 → 開通 → 登入、錯誤密碼 5 次鎖定、`admin` 本地密碼被擋 → 填入清單後可登入、關閉 LDAP 回到原樣：TBD

---

## 雲端化 P8 — 儀表板快取（2026-10-11，`perf/dashboard-cache`）

使用者最早的抱怨是「開啟太慢」。`GET /api/v1/dashboard/` 每次請求都從頭重算所有指標的所有月資料（DataPoint、Alert、YearlySummary、TCPIBenchmark 各一次查詢，再逐指標在 Python 裡彙整），Redis 早就設在 `CACHES`，整個 `backend/apps` 卻沒有任何 `cache.get`／`cache.set`。P8 讓第二次起的請求直接取自快取、資料變動時立刻失效、Redis 不通時照常運作（fail-open）。只動後端與文件，回應內容與前端都沒變。

### ✨ 新功能 / 改進
- **儀表板快取**（新 `backend/apps/indicators/cache.py`）：`dashboard_bulk` 在權限檢查之後先查快取，命中就直接回，未命中計算後存入。`dashboard_bulk` 讀的 query 參數只有 `campus`（省略時 `竹北`）、`category`、`search`，三個都進 key：`dashboard:v<版本>:<campus>:<category>:<search>`，版本號放在 `dashboard:version`（沒有過期時間），內容存 `DASHBOARD_CACHE_TTL` 秒（預設 600）。Django 會在 key 前面加 `:1:`，所以 Redis 裡看到的是 `:1:dashboard:version`、`:1:dashboard:v3:竹北::`。key 的各段會跳脫 `:`、`%`、空白與控制字元（`a:b`／`c` 與 `a`／`b:c` 不會撞成同一把），整把 key 超過 200 字元就不快取（照常計算）。回應不隨使用者而異，所以所有可讀角色共用同一份；權限檢查在讀快取之前（沒權限一律 403，不會因為快取裡有東西而放行）
- **回應標頭 `X-Dashboard-Cache`**：`HIT`（取自快取）、`MISS`（重新計算並存入）、`BYPASS`（沒用到快取：已關閉、cache 連不上、key 太長；都是重新計算）
- **失效靠版本號**：`bump_dashboard_cache()` 把 `dashboard:version` 加 1（key 不存在時先 `add`），舊版本的內容從此不會再被讀到，TTL 到了自己消失。兩個細節決定它會不會讀到舊資料：(1) bump 一律放在寫入**提交之後**（在 `transaction.atomic()` 裡用 `transaction.on_commit`），否則別人在 bump 與提交之間讀到的還是舊列，卻存在新版本底下；(2) 讀者**先讀版本號、再計算、存入時沿用那個版本**（`dashboard_cache_version()` 取得的值傳給 `get_`／`set_dashboard_payload(version=…)`），計算途中若有寫入，舊結果只會落在沒人再讀的舊版本 key。版本號不設過期：若會過期，它會從 1 重來，讓 bump 之前存在版本 1 的內容復活
- **失效點**（`grep -rn bump_dashboard_cache backend/apps`）：`POST /api/v1/imports/upload/`（`try/finally`：存到一半失敗，已寫的列也看得到，所以照樣失效）、`POST /api/v1/imports/correct-datapoint/`（改了值才失效）、`PATCH /api/v1/indicators/{code}/`（`try/finally` 包住重算 alerts）、`POST /api/v1/tcpi/`（`try/finally` 包住「先刪後寫」）；管理指令 `refresh_alerts`、`seed_indicators`（兩者都是 `try/finally`：逐筆改寫、各自提交，中途丟例外時已改的也要失效）、`wipe_datapoints`（單一 transaction，提交之後才 bump；取消不失效）；Django 後台的存檔、刪除、批次刪除（`DashboardModelAdmin`：Indicator、DataPoint、YearlySummary、TCPIBenchmark、Alert，`on_commit`）。被拒絕或驗證失敗的寫入（403、400、404）不失效。逐一核對過、**不需要**的：達文西（儀表板不讀它的表）、`migrate_excel_data`（只讀 DataPoint、寫 IndicatorEntry）、填報系統（沒有任何路徑寫這五張表）、`PeerValue`（儀表板不讀）
- **fail-open**（比照 `password_throttle.py`）：任何 cache 例外都記一筆 warning、當作沒有快取——讀不到版本號就整個請求不碰 cache（只等一次逾時）、讀 payload 失敗當未命中、存不進去回 `BYPASS`、bump 失敗只記 warning。寫入端點（匯入、PATCH、TCPI、修正）與管理指令在 cache 全壞時照常完成
- **`DASHBOARD_CACHE_ENABLED`**（預設：有填 `REDIS_URL` 才開，由 `base.py` 的 `dashboard_cache_settings(env, redis_url)` 決定；明設 true／false 蓋過預設）：false = 不讀、不存，每次都重新計算（標頭 `BYPASS`）。**沒有 Redis 時預設關閉**：行程內記憶體每個行程一份，管理指令（`wipe_datapoints`、`refresh_alerts`、bootstrap 的 `seed_indicators` 都在獨立的行程裡跑）與其他 worker 的 bump 清不到 web 行程的那一份，單一 worker 也一樣，會一直回舊資料到 TTL 為止。bump 刻意**不受**這個開關影響：關閉期間的寫入仍讓版本號前進，之後再開不會讀到關閉前存下的舊內容
- **`DASHBOARD_CACHE_TTL`**（預設 600，至少 1，否則 `ImproperlyConfigured`）：只在「失效通知沒送成」（例如當時 Redis 連不上）時才有作用
- **Redis 連線逾時 `REDIS_SOCKET_TIMEOUT`**（預設 2 秒，> 0）：HANDOFF 記的待辦「Redis 卡住時 change-password 會等」。`base.py` 的 Redis cache 現在帶 `socket_connect_timeout`、`socket_timeout`；沒指定時 redis-py 的行為隨版本而異（舊版不逾時，8.x 預設 5 秒）。新的 `cache_config(env)` 函式（比照 `database_config`）組出 `CACHES["default"]`，可單獨測試；`REDIS_URL` 這個設定值保留
- 文件與樣板：`.env.prod.example`、`backend/.env.example` 補三個變數與 `REDIS_URL` 沒填時的影響（`DASHBOARD_CACHE_ENABLED` 在樣板裡維持註解，免得複製樣板就蓋掉依 `REDIS_URL` 決定的預設）；`docs/DEPLOYMENT.md`（架構圖、§3 變數表、§5 儀表板快取、§7 Redis 逾時）、`docs/API_REFERENCE.md`（dashboard 端點的快取與標頭）、`docs/DEVELOPMENT_GUIDE.md`（新增寫入路徑時要呼叫 `bump_dashboard_cache()`）、`docs/TODO.md`

### 🔧 變更 / 破壞點
- API 的回應內容沒變，只多一個回應標頭 `X-Dashboard-Cache`
- **沒有 `REDIS_URL` 時，儀表板快取預設關閉**（`DASHBOARD_CACHE_ENABLED` 沒設定的情況）。開發堆疊與 `.env.prod.example` 都有 `REDIS_URL`，行為不變；`backend/.env` 若沒填 `REDIS_URL`，儀表板每次都重新計算（標頭 `BYPASS`）
- **每次容器啟動都會讓儀表板快取失效一次**：`bootstrap` 跑 `seed_indicators --only-missing`，指令結束時 bump。部署新版時這剛好當作快取重置（改了 `dashboard_bulk` 的輸出格式也不會讀到舊格式）；開發堆疊沒有這個步驟（`runserver` 自動重載不經 bootstrap），改了輸出格式要手動 bump：`docker compose exec -T api python manage.py shell -c "from apps.indicators.cache import bump_dashboard_cache; bump_dashboard_cache()"`。還原資料庫備份之後也要做
- `REDIS_URL` 有值時，cache 的 Redis 呼叫現在最多等 `REDIS_SOCKET_TIMEOUT`（預設 2）秒。Redis 不回應（不是拒絕連線）時，每個用到 cache 的請求最多多等這麼久，然後照常處理
- `base.py` 的 `CACHES` 改由 `cache_config(env)` 產生；`REDIS_URL` 空白時行為不變（行程內記憶體）；`DASHBOARD_CACHE_ENABLED`／`DASHBOARD_CACHE_TTL` 由 `dashboard_cache_settings(env, REDIS_URL)` 產生（都可單獨測試）

### 🐛 修正（稽核後補）
- **沒有 Redis 時快取會一直回舊資料**：行程內記憶體的快取，別的行程的 bump 清不到它——管理指令永遠是獨立行程，所以單一 worker 也一樣。預設改成「有填 `REDIS_URL` 才開」（明設 true／false 仍可蓋過）；`backend/.env.example` 原本寫「單一行程沒問題」、`docs/DEPLOYMENT.md` 的手動清快取指令也沒提到只在 Redis 下有效，一併改正；新測試：`REDIS_URL` 為空且沒設開關 → `BYPASS`、有 `REDIS_URL` → 預設啟用（六種組合）
- **管理指令中途出錯不會失效**：`refresh_alerts`、`seed_indicators` 逐筆改寫、各自提交，原本只在最後 bump。改成 `try/finally`（`handle` 包一層，原本的內容搬進 `_refresh_all`／`_seed`），並各加一條「中途丟例外，之後儀表板必須 `MISS`」的測試
- **測試與文件**：PATCH、`refresh_alerts`、upload 原本只斷言 `MISS`，補上回應與資料庫一致的斷言（alerts、`latest_period`）；本條目的驗證結果改為容器內的實測；`docs/DEPLOYMENT.md` §5 補記憶體估算

### ⚠️ 已知限制
- **失效通知可能漏**：bump 時 Redis 連不上，舊版本的內容在 Redis 恢復後最久還能被讀 `DASHBOARD_CACHE_TTL` 秒。Redis 的 `maxmemory-policy` 若是 `allkeys-*`，版本號可能被逐出，逐出後從 1 重來，同樣最久 TTL 秒內可能讀到逐出前的內容；用 `noeviction` 或 `volatile-*`（版本號沒有過期時間，不會被 `volatile-*` 逐出）
- **明設 `DASHBOARD_CACHE_ENABLED=true` 卻沒有 `REDIS_URL`**：快取只存在各行程的記憶體，管理指令與其他 worker 的寫入清不到 web 行程那一份，最久 TTL 秒內回舊資料（預設已經因此關閉）。開發堆疊是單一 `runserver` 加 Redis，不受影響
- Redis **不回應**時每個請求多等 `REDIS_SOCKET_TIMEOUT` 秒（沒有斷路器：不會因為剛失敗過就暫時不再試）；Redis 拒絕連線或 DNS 解析失敗則立刻失敗
- key 由用戶端的 query 決定（`search` 可以是任何字串）：每個不同的值多一筆最久存活 TTL 秒的內容。以 key 長度上限（200 字元）、TTL 與內網使用限制；不是針對惡意用戶設計的防線
- 失效後第一批同時抵達的請求會各自重算（沒有互斥鎖）；內容用 pickle 存在 Redis（Django RedisCache 的序列化方式），所以 Redis 只能內網可達（本來就是）
- 既有行為、非本案：`correct-datapoint` 只改值、不重算 Alert。快取會立刻顯示新值，燈號仍取自舊的 Alert，直到下一次匯入或 `refresh_alerts`

### 📁 修改檔案
| 檔案 | 修改內容 |
|------|---------|
| `backend/apps/indicators/cache.py`（新） | 版本號、`get_`／`set_dashboard_payload`、`dashboard_cache_version`、`bump_dashboard_cache`、key 跳脫與長度上限、fail-open |
| `backend/apps/indicators/views.py` | `dashboard_bulk` 查快取／存快取／`X-Dashboard-Cache`；PATCH 與 TCPI POST 的 `try/finally` bump |
| `backend/apps/imports/views.py` | upload（`try/finally`）與 correct-datapoint 的 bump |
| `backend/apps/indicators/management/commands/{refresh_alerts,wipe_datapoints,seed_indicators}.py` | 結束時 bump（`refresh_alerts`、`seed_indicators` 用 `try/finally`，內容搬進 `_refresh_all`／`_seed`） |
| `backend/apps/indicators/admin.py` | `DashboardModelAdmin`（`on_commit` bump）；五個後台類別改繼承它 |
| `backend/config/settings/base.py` | `cache_config(env)`、`dashboard_cache_settings(env, redis_url)`、`REDIS_SOCKET_TIMEOUT`、`DASHBOARD_CACHE_ENABLED`（預設隨 `REDIS_URL`）、`DASHBOARD_CACHE_TTL` |
| `backend/apps/indicators/tests/test_dashboard_cache.py`（新） | 65 條：命中／未命中、key、各失效點、寫到一半失敗、被拒絕的寫入、過期讀取、fail-open、開關、TTL、逾時設定 |
| `.env.prod.example`、`backend/.env.example` | 新變數與說明 |
| `docs/DEPLOYMENT.md`、`docs/API_REFERENCE.md`、`docs/DEVELOPMENT_GUIDE.md`、`docs/TODO.md`、`docs/CHANGELOG.md`、`HANDOFF.md` | 見上 |

### ✅ 測試與驗證
- 新測試 65 條（`backend/apps/indicators/tests/test_dashboard_cache.py`）：第一次 `MISS` 且查了 `data_points`；第二次 `HIT` 且對 indicators、data_points、alerts、yearly_summaries、tcpi_benchmarks 五張表 **0 次查詢**（只剩 session／使用者查詢）；bump 後重新 `MISS`；campus／category／search 各自獨立；PATCH、TCPI POST、correct-datapoint、upload、`refresh_alerts`、`wipe_datapoints`、`seed_indicators`、後台存檔／刪除／批次刪除之後都是 `MISS`，而且回應與資料庫一致（對 alerts、`peer_value`、`latest_value`／`latest_period`、`total` 有斷言；用空白活頁簿的上傳只斷言 `MISS`）；各寫入路徑與兩個逐筆改寫的管理指令「寫到一半失敗」仍失效；被拒絕的寫入（403／400／404）不失效；`cache.get`／`add`／`set`／`incr`／全部壞掉時回 200 與 `BYPASS`、寫入端點照常完成、記 warning；開關（含有沒有 `REDIS_URL` 的預設）、TTL、版本號不過期、Redis 逾時設定、`DASHBOARD_CACHE_TTL < 1` 拒絕啟動
- 突變檢查：逐一拿掉每個 bump、`version=` 的沿用、`timeout=None`、跳脫、型別檢查、長度上限、例外處理、逾時選項、TTL 驗證、兩個指令的 `try/finally`、開關的預設（共 35 種），每一種都至少讓一條測試失敗
- **容器內（開發堆疊：PostgreSQL 16 + Redis 7）**：
  - `docker compose exec -T api pytest apps/indicators/tests -q -p no:cacheprovider`：65 passed；全套 `pytest -q`：780 passed、23 skipped、1 failed——既有的 `test_control_chart.py::test_binomial_rare_event_returns_imr`，非本案
  - `manage.py check`：no issues；`makemigrations --check --dry-run`：No changes detected
  - 開發堆疊實測（Django test client、唯讀 GET、包在回滾的 transaction 裡；`/api/v1/dashboard/?campus=竹北`，payload 272 KB）：第一次 `MISS` 1498 ms（含冷啟動）、第二次與第三次 `HIT` 9.8 ms 與 11.4 ms；關閉快取（`BYPASS`，也就是改動前的行為）穩定在 23–24 ms，`HIT` 約快 2 倍多。Redis 裡有 `:1:dashboard:v2:竹北::`（TTL 598 秒）與 `:1:dashboard:version`
  - 專案外的實驗（Python 3.14、redis-py 8.1.0）：fakeredis 讓 Django 真正的 `RedisCache` 後端跑過一遍——版本號是 Redis 裡的整數、沒有 TTL、`INCR` 正常，舊版本 key 在 bump 後不被讀，逐出版本號後 bump 會重建，伺服器中斷時全部 fail-open；把 `REDIS_URL` 指到不會回應的位址（10.255.255.1），`cache.get` 在 2.1 秒後以 `TimeoutError` 失敗，`dashboard_cache_version()` 在 2.0 秒後回 `None`，`bump_dashboard_cache()` 在 2.0 秒後返回、不丟例外。沒做：實機停掉 redis 容器再打 dashboard（以單元測試與這個實驗涵蓋）

---

## 雲端化 P7 — 平台無關部署（2026-10-11，`feat/cloud-ready-deploy`）

雲端平台還沒決定，所以只交付「平台無關」的部分：兩個映像、一份 compose 樣板、啟動程序、健康檢查與 production 設定。TLS、網域、每 IP 限流、備份是平台的事，列在 `docs/DEPLOYMENT.md` §7。開發堆疊（根目錄 `docker-compose.yml`、`start.bat`）的流程不變，但它和正式堆疊現在明確分開（見下面「與開發堆疊分開」）。

### ✨ 新功能 / 改進
- **兩個映像**：`backend/Dockerfile`（`python:3.12-slim`；沒有 apt／編譯器，相依套件都用預編 wheel；build 時 `collectstatic`，失敗就中止 build，拿掉 `|| true`；非 root uid 10001 且有家目錄，`/app/media` 歸它；`ENTRYPOINT ["qip-entrypoint"]`、無 CMD）與新的 `Dockerfile.web`（deps → builder → runner 三階段；Next `standalone` 輸出；`node:20-alpine` 非 root；`HOSTNAME=0.0.0.0 PORT=3000`）。`API_INTERNAL_URL`、`API_PROXY_TIMEOUT_MS`、`NEXT_HSTS_SECONDS` 是 web 的 **build 引數**（`next.config.mjs` 在 `next build` 時求值並烘進路由表，改了要重新 build）；`NEXT_PUBLIC_API_URL` 不設，瀏覽器一律打同源 `/api/*`。兩個 `.dockerignore`（根目錄、`backend/`）把真實資料（`*.xls*`、`*.csv`、`media/`、`local-data/`）、`.env*`、`.git`、`venv` 擋在 build context 之外
- **正式映像不含測試工具**：`backend/requirements.txt` 只剩應用程式的相依；pytest、pytest-django、pytest-cov、ruff 搬到新的 `backend/requirements-dev.txt`（開頭 `-r requirements.txt`）。`backend/Dockerfile` 的 build 引數 `INSTALL_DEV` 預設 0，只有傳 1 才安裝它；根目錄開發 `docker-compose.yml` 的 `api` 以 `build.args.INSTALL_DEV: "1"` 建映像，所以 `docker compose exec api pytest` 照常能用
- **啟動程序**：`backend/entrypoint.sh`（POSIX sh、`set -eu`、LF）每次啟動先跑 `manage.py bootstrap`，再 `exec` 指定的指令，沒有指令就啟動 gunicorn（`0.0.0.0:$PORT`，`GUNICORN_WORKERS` 預設 3、`GUNICORN_TIMEOUT` 預設 120 秒）。只有 `RUN_BOOTSTRAP` 是 `0`、`false`、`no`（不分大小寫）才略過 bootstrap；其他值（包含留空，也包含 `true`、`off` 這類猜測）都照常執行，免得打錯字就在空資料庫上啟動伺服器。`bootstrap`（新 app `apps/core`）：等資料庫（最多 60 次、每次 2 秒）→ 在獨立連線上取 `pg_advisory_lock`（多副本同時啟動時依序進行）→ 檢查 `DB_SCHEMA`，不存在才 `CREATE SCHEMA` → `migrate --noinput` → `seed_entry_base --only-missing`、`seed_indicators --only-missing` → 設了 `SEED_ADMIN_PASSWORD` 才跑 `seed_admin`（`admin` 已存在則略過）→ 放鎖。每一步印一行 `[bootstrap] …`，任何一步失敗都放鎖後以非 0 結束。`DB_SCHEMA` 只接受 `^[a-z_][a-z0-9_]*$`（會進 DDL，所以要驗證；只收小寫，因為連線的 `search_path` 沒加引號、PostgreSQL 會把它轉成小寫，`CREATE SCHEMA` 加了引號——大寫的名稱會建出一個、卻去找另一個）
- **`GET /healthz`**（`apps/core/views.py`，純 Django view，不經 DRF、不需登入）：資料庫答得出 `SELECT 1` 就回 200 `{"status":"ok"}`，否則 503 `{"status":"unavailable"}`（原因只寫 log，不回給呼叫者）；`Cache-Control: no-store`。多做 `SELECT 1` 是因為 `CONN_MAX_AGE` 開著時，`ensure_connection()` 對「伺服器已經斷掉的舊連線」會直接成功。Next 只代理 `/api/*`，所以對外網域上沒有這個路徑
- **`seed_indicators`、`seed_entry_base` 加 `--only-missing`**（與 `--clear` 互斥）：只新增資料庫裡還沒有的項目，不覆寫管理員改過的名稱、目標值、排序，也**不會**把被停用的指標重新啟用（不帶旗標時行為不變，仍是 `update_or_create`）。`start.bat` 的兩個 seed 也改成帶 `--only-missing`；`migrate` 和 `seed_admin` 保留，加註解說明開發 api 映像重建後由 bootstrap 接手
- **`docker-compose.prod.yml`**（根目錄）：`db`（postgres:16-alpine）、`redis`、`api`、`web`；只有 `web` 發佈 port（`${WEB_BIND:-0.0.0.0}:${WEB_PORT:-3000}:3000`，本機試跑用 `WEB_BIND=127.0.0.1`）；各服務都有 healthcheck，`api` 等 `db`／`redis` healthy、`web` 等 `api` healthy；`api`、`web` 加 `init: true`（行程 1 是 tini：轉發 SIGTERM、回收殭屍行程）；`media` volume 掛在 `/app/media`。`api` 的環境來自 `env_file: ${ENV_FILE:-.env.prod}`；本機試跑時在 `--env-file` 那份檔案裡寫 `ENV_FILE=<自己的檔名>`，一個檔案同時管內插與容器環境
- **Django 設定**：`DATABASE_URL`（`postgres://…`，可帶 `sslmode` 等選項）有填就蓋過 `DB_*`，`search_path` 併進 libpq 的 `options` 而不是蓋掉它；`DB_CONN_MAX_AGE`（預設 60）＋ `CONN_HEALTH_CHECKS`；`DB_CONNECT_TIMEOUT`（預設 5 秒，寫進 `OPTIONS.connect_timeout`，`DATABASE_URL` 自帶的優先）——沒有它，連不上的資料庫每次嘗試要等作業系統的逾時（約兩分鐘），bootstrap 的重試迴圈等於卡死；`CORS_ALLOWED_ORIGINS`、`CSRF_TRUSTED_ORIGINS` 預設空清單。`prod.py` 重寫：`DJANGO_ALLOWED_HOSTS` 沒設就拒絕啟動；**`DJANGO_SECRET_KEY` 空的、不足 50 字元、或含範本字樣（`change-me`、`dev-secret-key`、`collectstatic-only`、`django-insecure-` …，不分大小寫）就拒絕啟動，錯誤訊息不重複金鑰**；`SECURE_PROXY_SSL_HEADER`；`SECURE_HSTS_SECONDS`（預設 0）；`SECURE_SSL_REDIRECT`（預設 false，`/healthz` 豁免）；`SESSION_COOKIE_SECURE`、`CSRF_COOKIE_SECURE` 預設 true（可由環境變數關掉，只為了在本機用 http 試跑）；靜態檔走 WhiteNoise（`CompressedManifestStaticFilesStorage`）；DRF 只輸出 JSON；日誌全部到 stdout／stderr（`django.request`、`axes`）。**WhiteNoise 只在 `prod.py` 才加進 `MIDDLEWARE`**，不放 `base.py`：開發映像不必裝這個套件，開發與測試照常跑。映像 build 時 `collectstatic` 用的金鑰是 `build-only-…`（65 字元），只在 `COLLECTSTATIC_ONLY=1`（只寫在那一行 `RUN`，不在映像環境裡）時通過，所以執行中的容器不會誤用它
- **`next.config.mjs`**：`headers()` 在 `NEXT_HSTS_SECONDS > 0` 時對所有回應送 `Strict-Transport-Security: max-age=…`（HTML 由 Next 回應，Django 的 `SECURE_HSTS_SECONDS` 只涵蓋 API 與 admin）；0、空值、非數字、負數都不送。同樣在 build 時固化
- **`.env.prod.example`**（根目錄，正式環境用，複製成 `.env.prod`；分 Web／Django／資料庫與快取／執行與管理四組，每個變數一行說明，含 media 單副本＋持久 volume 的說明）與 `backend/.env.example`（在主機上直接跑 `manage.py` 用；`DB_PORT` 與 `REDIS_URL` 改成開發堆疊在主機上對外的 5433／6380，並註明容器內是 5432／6379）。`.gitignore`：`.env.*` 一律忽略，只放行 `.env.example`、`.env.prod.example`，另加 `backend/staticfiles/`；`.gitattributes` 讓 `*.sh` 一律 LF（CRLF 的 `#!/bin/sh` 在容器裡會變成「no such file or directory」）
- **`docs/DEPLOYMENT.md`**（新）：架構、與開發堆疊的關係、本機 production 試跑、上雲必填變數、首次啟動順序、對外行為、上線檢查、平台待辦、疑難排解

### 與開發堆疊分開
- `docker-compose.prod.yml` 與 `docker-compose.yml` 在同一個目錄。原本兩份檔案都用目錄名 `qip-dashboard` 當 project 名稱，而且都讀根目錄的 `.env`：兩邊同名的 `api`、`redis` 會被 Compose 當成同一個容器（`up` 用正式設定換掉開發的容器，`down` 把它們刪掉，`--remove-orphans` 連 `postgres` 也刪），開發堆疊也會吃到正式的密碼。現在正式堆疊的 project 名稱固定為 `qip-prod`（檔案頂層的 `name:`，`-p` 仍可蓋過），設定檔是 `.env.prod`、指令一律帶 `--env-file .env.prod`（`--env-file` 會取代 Compose 自動讀取的 `.env`），容器、volume、網路都分開。根目錄 `.env`（有的話）只屬於開發堆疊。唯一會撞的是埠：`WEB_PORT` 預設 3000，和 `npm run dev` 一樣

### 🔧 變更 / 破壞點
- production 設定**必須**有 `DJANGO_ALLOWED_HOSTS`，也**必須**有合格的 `DJANGO_SECRET_KEY`，不然在載入設定時 `ImproperlyConfigured`。`manage.py` 的預設仍是 `config.settings.dev`；映像（`ENV`）與 `entrypoint.sh` 的預設是 `config.settings.prod`，根目錄開發 compose 明確設 `config.settings.dev`
- 正式堆疊的設定檔從 `.env` 改成 `.env.prod`（樣板 `.env.prod.example`），指令要帶 `--env-file .env.prod`
- `backend/requirements.txt` 不再含 pytest、ruff：在主機上開發請 `pip install -r requirements-dev.txt`；開發 api 映像要 `docker compose build api` 之後才用新的 `INSTALL_DEV=1` 設定（現有的舊映像本來就有 pytest）
- `DB_SCHEMA` 只接受小寫（原本 bootstrap 接受大寫，但 search_path 會找錯 schema）；`RUN_BOOTSTRAP` 的意義見上面
- `base.py` 不再預設放行 localhost 的 CORS／CSRF 來源；開發用的預設與 `localhost:*` regex 搬到 `dev.py`。`dev.py` 另把 `CONN_MAX_AGE` 固定為 0（`runserver` 每個請求一條新執行緒，持久連線不會被重用）
- api 映像現在有 `ENTRYPOINT`：`docker compose run api <指令>` 會先跑 bootstrap（`RUN_BOOTSTRAP=0` 可略過）；`docker compose exec` 不經過 entrypoint，用的是映像的 `DJANGO_SETTINGS_MODULE`（production）。開發 compose 的 `command: python manage.py runserver …` 不變，重建 api 映像後會多跑一次無害的 bootstrap，容器改以 uid 10001 執行
- 刪除：Streamlit 舊儀表板（`backend/dashboard/`）、`backend/docker-compose.yml`、`backend/docker-compose.prod.yml`、`backend/start.bat`；`CELERY_*` 設定（含 `QIP-Dashboard-工作說明書.md` 裡的範例）；`celery`、`streamlit`、`plotly`、`pandas` 四個相依套件（`backend/apps`、`backend/config` 沒有任何 import）。根目錄 `start.bat` 不再呼叫已刪的 backend compose

### 🐛 修正
- 驗證時發現：gunicorn 25.1 起會在 `$HOME/.gunicorn/` 建控制 socket，非 root 使用者沒有家目錄時每次啟動都記一行 `Control server error: Permission denied: '/home/app'`。`useradd` 改為 `--create-home`（不改 gunicorn 的參數，所以舊版 gunicorn 也不受影響）
- 稽核抓到並修掉：正式與開發堆疊撞 project 名稱、共用 `.env`（上面「與開發堆疊分開」）；`start.bat` 每次啟動都用不帶旗標的 seed 覆寫管理員改過的名稱與目標值、並重新啟用被停用的指標；prod 讓空的或範本的 `DJANGO_SECRET_KEY` 靜默通過（舊的 `collectstatic-only`、`dev-secret-key-change-in-production`）；`DB_SCHEMA` 大小寫與 search_path 不一致；`RUN_BOOTSTRAP=true` 之類的值悄悄略過 bootstrap；`.dockerignore` 只擋 `*.xls`／`*.xlsx`（改成 `**/*.xls*`、`**/*.csv`）；`DEPLOYMENT.md` 的容器內檢查用了映像裡沒有的 `curl`、也沒講清楚 `check --deploy` 在建議設定下會有 W004 與 W008

### ⚠️ 已知限制 / 平台待辦
- **每 IP 限流不在本專案**：Next 代理不補 `X-Forwarded-For`，Django 看到的來源位址對所有人都一樣，登入鎖定（5 次失敗鎖 5 分鐘）實質上只看帳號。`/api/auth/login` 的每 IP 速率限制要在平台邊緣做
- `:8000`（開發堆疊 `:8001`）不可對外；直連 Django 會繞過 Next 與邊緣的限流，也能自己帶 `X-Forwarded-*` 偽造 HTTPS 與主機名稱。`docker-compose.prod.yml` 只發佈 `web`
- HTTPS／HSTS 在平台邊緣處理（邊緣必須送並**覆寫** `X-Forwarded-Proto`）；HSTS 瀏覽器會記住，確認 HTTPS 全程可用後再分段調高（`NEXT_HSTS_SECONDS` 要重新 build web）
- **media volume 必須持久，而且目前只能單一 api 副本**：達文西匯入的「預覽 → 確認」要讀回 `/app/media/davinci_imports/…` 的檔案，多副本之間沒有共享檔案系統
- django-axes 每次登入留一筆 AccessLog，要排程 `manage.py axes_reset_logs --age-days N`；Django `/admin/` 不經 Next（對外網域上是 404），要走內網連 api；備份（`pg_dump`、media）與還原演練；`npm audit` 目前有已知漏洞的依賴，未處理；Python 相依在 `requirements.txt` 沒有鎖版本，每次 build 取當下最新
- 要更新指標的預設資料（名稱、單位、別名）得手動跑不帶旗標的 `seed_indicators`，它會覆寫並重新啟用被停用的指標
- 開發 api 映像（`qip-dashboard-api`）是舊的，沒有 whitenoise、entrypoint，也還沒用 `INSTALL_DEV`；它以 bind mount 讀 `./backend`，所以照常運作。下次 `docker compose build api` 才會換成新映像

### 📁 修改檔案
| 檔案 | 修改內容 |
|------|---------|
| `backend/apps/core/`（新） | `bootstrap` 指令、`healthz`、`tests/test_core.py`（健康檢查、bootstrap 步驟與鎖、schema 名稱、`--only-missing`、`DATABASE_URL`／逾時、prod 設定、金鑰檢查、映像內容）、`tests/test_entrypoint.py`（用假的 `python`／`gunicorn` 驗證入口腳本） |
| `backend/entrypoint.sh`（新）、`backend/Dockerfile`、`backend/.dockerignore` | 入口腳本；映像（非 root、collectstatic、無 apt、`INSTALL_DEV`）；build context 排除項 |
| `backend/config/settings/{base,dev,prod}.py`、`backend/config/urls.py` | 見上；`apps.core` 加進 `INSTALLED_APPS`、`/healthz` 路由 |
| `backend/apps/entry/management/commands/seed_entry_base.py`、`backend/apps/indicators/management/commands/seed_indicators.py` | `--only-missing` |
| `backend/requirements.txt`、`backend/requirements-dev.txt`（新）、`backend/pyproject.toml` | 加 `whitenoise`；刪 `celery`、`streamlit`、`plotly`、`pandas`；測試與 lint 工具搬到 dev 檔 |
| `Dockerfile.web`、`.dockerignore`、`docker-compose.prod.yml`、`.env.prod.example`、`backend/.env.example`、`.gitattributes`、`.gitignore`（新／改） | web 映像與部署樣板 |
| `next.config.mjs` | `headers()`：`NEXT_HSTS_SECONDS` |
| `docker-compose.yml`、`start.bat` | 刪 `CELERY_*` 與對已刪 backend compose 的呼叫；`INSTALL_DEV`；seed 帶 `--only-missing` |
| `backend/dashboard/`、`backend/docker-compose.yml`、`backend/docker-compose.prod.yml`、`backend/start.bat`（刪） | 退役的 Streamlit 與舊 compose |
| `docs/DEPLOYMENT.md`（新）、`docs/DEVELOPMENT_GUIDE.md`、`docs/PROJECT_CONTEXT.md`、`docs/TODO.md`、`docs/USER_MANUAL.md`、`docs/CHANGELOG.md`、`HANDOFF.md`、`QIP-Dashboard-工作說明書.md` | 部署說明；移除 Streamlit／celery／舊 compose 的字句 |

### ✅ 測試與驗證
- `docker compose exec -T api pytest -q -p no:cacheprovider`：715 passed、23 skipped、1 failed（既有的 `test_control_chart.py::test_binomial_rare_event_returns_imr`，非本案）；其中 `apps/core` 86 條（含金鑰檢查、schema 名稱、`connect_timeout`、`RUN_BOOTSTRAP` 各種值、映像內容）。`manage.py check` 無 issue、`makemigrations --check` 無變更；`npx tsc --noEmit` 零錯誤；`npx next lint` 只有既有的 3 個 exhaustive-deps 警告；`npm run test:unit` 126 條全綠
- `docker compose config`：根目錄開發檔通過，`api.build.args.INSTALL_DEV` 是 `1`、project 名稱仍是 `qip-dashboard`；`docker-compose.prod.yml` 通過，project 名稱是 `qip-prod`、web 的發佈位址是 `127.0.0.1:3100->3000`、`api` 沒有 `INSTALL_DEV`。`git check-ignore`：`.env`、`.env.prod`、`.env.prodtest` 被忽略，`.env.prod.example` 不被忽略。另用一個測試目錄確認：給了 `--env-file` 就不會讀目錄裡的 `.env`
- 本機 production 試跑（獨立 project `qip-prodtest`，web 在 `127.0.0.1:3100`；跑了兩次，第二次是稽核修正後重新 build）：
  - 第一次：四個服務 healthy；`/entry/login` 200、`/api/auth/me` 403、web 上的 `/healthz` 與 `/admin/` 404、api 內 `/healthz` 與 `/static/admin/css/base.css` 200；web 的 `/app/public` 為空、兩個映像裡都沒有 `.xls*`、`/app/media` 為空；`restart api` 後 log 有 `No migrations to apply` 與「略過」；兩個副本同時對空的 schema 跑 bootstrap：一個建立並 migrate，另一個等鎖後看到 `No migrations to apply`；經 3100 的端對端：seed admin 登入 → `/api/v1/dashboard/?campus=竹北` 403 `password_change_required` → 沒帶 CSRF 的 change-password 403 `csrf_failed`、帶了 200 → dashboard 200；`SECURE_SSL_REDIRECT=true` 時 `/healthz` 仍 200、其他路徑 301；經 Next 代理的 `X-Forwarded-Proto: https` 會被 Django 採用，不在 `DJANGO_ALLOWED_HOSTS` 的 Host 回 400
  - 第二次：四個服務 healthy、web 綁在 `127.0.0.1`；api 映像 414 MB（原本 470 MB），沒有 pytest、ruff、coverage（`import pytest` → `ModuleNotFoundError`）；`check --deploy` 在 `.env.prod.example` 的建議值下只有 W004（HSTS）與 W008（`SECURE_SSL_REDIRECT=false`）；api、web 的行程 1 是 `docker-init`；`DJANGO_SECRET_KEY=dev-secret-key-change-in-production-…` 在真實映像裡 exit 1、訊息不含金鑰；`RUN_BOOTSTRAP=true` 仍跑 bootstrap、`no` 略過；連不上的資料庫（`DB_HOST=10.255.255.1`）一次嘗試 5.0 秒就放棄；端對端登入流程同上
- 兩份 `.dockerignore` 用 `FROM scratch` 的測試 context 驗證：`a.xls`、`a.xlsx`、`a.xlsm`、`a.xlsb`、`A.XLS`、`b.Xlsx`、`a.csv`、`A.Csv`（任何深度）都擋掉，其他檔案照常進 context（匹配分大小寫，所以另加字元集的寫法）
- `git ls-files --eol backend/entrypoint.sh`（加入暫存區後）：`i/lf w/lf attr/text eol=lf`

---

## 雲端化 P6 — 欄位級指派：前端（2026-10-11，`feat/field-assignment-ui`）

只動前端與文件；後端是 P5。目的：讓前端跟上 P5 的後端把關——以前每次存檔都把整個面向所有指標整包送回（現在會被 400 `field_not_assigned` 擋）、不帶院區（多院區時 400 `campus_required`）、看不出哪個欄位是別人負責的、送審缺漏看不到負責人。

### ✨ 新功能 / 改進
- **只送「自己負責、而且改過」的欄位**（新增 `lib/entry/draft.ts`，純函式）：`buildDraftEntries(formValues, baseline, indicators)` 只輸出 `editable_fields` 內、數字與 baseline（載入時或上次存檔成功時伺服器的值）不同的 key；清空是 `null`；`note` 只在使用者改過才送（它是兩位負責人共用的一欄）；HA10-01 新竹的分子以 `sub_entries` 送（任一子項有改才送、送完整 13 筆，不送單獨的 `numerator`，否則後端 400）；沒有任何改動的指標不送，整份都沒改就不呼叫 API（也就不會建立空的月報）。`applyServerEntries(formValues, entries, baseline?)` 把存檔回應的最新值（回應只含這次存檔的指標，含該指標上他人剛填的欄位）合併回表單，使用者在請求飛行中又打的內容不會被覆蓋，與伺服器數字相同的輸入維持使用者打的樣子（「5.」、「5.10」不會在游標下被改寫）。取代 `lib/entry/api.ts` 的 `formValuesToDraftEntries`
- **院區一律明確**：`getEntryForm` / `saveDraft` / `submitCategory` 帶 `campus`（網址的 `?campus=`；沒有就用表單回應裡的院區）。沒帶 `campus` 時照樣送出，單一院區後端自己會用；多院區回 400 `campus_required`，畫面改成「請選擇院區」（從 `my-tasks` 列出該面向的院區），沒有任何院區時顯示說明並導回 `/entry`
- **我的任務 `/entry`**：一列是一個「院區 × 面向」（`key` 與連結都帶院區，不再互相蓋掉），多院區時院區用色塊標示；進度改用 `my_filled / my_total`（我負責的欄位數），並顯示「待他人填寫 n」（`category_missing − (my_total − my_filled)`）；退回通知帶院區、連結帶 `?campus=`；`approved` 也視為鎖定（與 KD1 一致）
- **填報表單 `/entry/[category]`**：分子、分母各依 `editable_fields`——不是自己負責的欄位唯讀（灰底）並標「由 王小明 填寫」（沒有負責人「未指派」），欄位旁小字顯示填報人與時間（「王小明 10/11 14:32」，台北時間）；HA10-01 新竹的子項依分子權限唯讀／可編，加總隨輸入即時更新；備註只要有任一欄位的權限就能編，鎖定時有內容仍顯示；個案清單列的連結補 `?campus=&year=&month=` 並改用站內導頁；`locked` 改用後端的 `report.locked`。存檔成功後以回應更新他人欄位與「填報人」小字，並把 baseline 設為已送出的值；403 `report_locked` → 重新載入成唯讀並提示。送審：先暫存再送審，400 `incomplete` 在畫面上方列出缺漏，每項「HA03-01 住院死亡率 — 分母（王小明）」，沒有負責人則「（未指派）」；成功後 1.5 秒導回 `/entry`
- **送審前檢查**（`lib/entry/validation.ts`）：必填只針對 `editable_fields`；他人（或沒人）負責的欄位還是空的只給 warning、不擋按鈕，最終由後端判定；個案清單指標沒有數值也只是 warning
- **指派頁 `/entry/admin/indicatorassignment`**：新增「負責欄位」欄（分子＋分母／僅分子／僅分母）與「覆蓋情況」欄，每個指標 × 院區顯示「分子：王小明｜分母：未指派」，缺人負責的欄位用橘色標出（從全部指派計算，搜尋人名不會讓另一位負責人的欄位看起來沒人負責），並加「欄位未覆蓋」統計卡；新增對話框加「負責欄位」radio（預設分子＋分母），`has_denominator=false` 的指標只能選分子＋分母並說明「此指標無分母」，個案清單指標提示「個案清單指標，表單唯讀」；批次指派的去重改為 指標 × 院區 × 人員 × 欄位（與後端同一個重疊規則：`both` 與任何欄位都重疊），逐項呼叫後端，失敗的項目依原因歸類列出（後端 400 的全部訊息，不只第一則）並刷新表格，已建立的不會重複。`IndicatorMetaResponse` 補上 `has_denominator`、`entry_mode`（後端 P5 已回傳）
- **審核明細**：分子、分母旁各顯示填報人與時間（`numerator_filled_by/at`、`denominator_filled_by/at`）；新竹 HA10-01 的分子顯示「由子項加總」並停用行內修改（後端會回 400 `field_not_editable`）
- 個案清單頁的「返回」帶 `?campus=`（否則多院區的面向會 400 `campus_required`）
- `npm run test:unit` 同時跑 `lib/auth/*.test.ts` 與 `lib/entry/*.test.ts`

### 🐛 修正
- **自動暫存存到的是上一次輸入之前的值**：`triggerAutoSave` 的 `useCallback` 與其中的 `doSave` 是舊 render 的閉包，3 秒後送出的 `formValues` 不含最後幾次按鍵。現在 `formValues`／baseline／表單資料放在 `useRef`，存檔與送審都從 ref 讀最新值，並以佇列依序執行（暫存、手動暫存、送審不會交錯）
- 離開頁面（或切換院區）時還沒送出的修改會先存一次；送審成功後的導頁計時器離頁時會清掉
- HA10-01 新竹：加總以前只在重新載入後才更新，送審驗證用到的是載入時的分子，填完 13 個子項仍可能被「送審前必須填寫數值」擋住

### ⚠️ 已知限制 / 後端缺口
- 審核頁行內修改維持原狀：只有 `approved` 才出現修改入口，且只能改分子（後端在 `submitted`／`approved` 都允許，也允許改分母）
- `GET /api/entry/form` 沒有回 `exclusion_count`，個案清單列的「(排除n)」永遠不顯示（型別有欄位、後端沒給）
- `docs/API_REFERENCE.md`：`GET /api/review/detail` 一行說明沒有列出逐欄的四個填報人欄位（後端有回）；`POST /api/case-list/review-exclusion` 文件寫 `case_id`，後端與前端實際用 `case_record_id`
- 填報頁不支援 `year`／`month` 查詢參數（一律當月），個案清單頁的「返回」因此只帶 `campus`
- 沒有前端元件測試框架：表單頁、指派頁、審核頁只經 `tsc`、`next lint` 與瀏覽器渲染確認，純邏輯（`draft.ts`、`validation.ts`、`assignments.ts`）有 `node --test`

### 📁 修改檔案
| 檔案 | 修改內容 |
|------|---------|
| `lib/entry/draft.ts`、`draft.test.ts`（新） | `buildDraftEntries`、`applyServerEntries`、`buildInitialValues`、`mergeSavedIntoIndicators`、`sumSubEntries`、`parseNum`；單元測試 |
| `lib/entry/assignments.ts`、`assignments.test.ts`（新） | 欄位重疊規則、覆蓋情況、指派錯誤訊息整理；單元測試 |
| `lib/entry/validation.ts`、`validation.test.ts`（新） | 必填只看 `editable_fields`、他人欄位 warning、`ownersLabel`／`filledStamp`／`missingLabel`／`parseMissing`／`usesSubEntries`；單元測試 |
| `lib/entry/types.ts`、`lib/entry/api.ts`、`lib/api.ts` | `CategoryTask`／`RejectionNotice` 院區與進度欄位、`IndicatorFormItem` 欄位權限與填報人、`report.locked`／`id: number \| null`、`field`、`SavedEntry`、`MissingField`／`SubmitIncompleteBody`；form／save／submit 帶 `campus`；審核型別四個填報人欄位；指標清單型別補 `has_denominator`／`entry_mode` |
| `app/entry/page.tsx` | 院區 × 面向列、`my_filled/my_total`、待他人填寫 |
| `app/entry/[category]/page.tsx`、`components/entry/IndicatorRow.tsx` | 院區、ref 版自動暫存、存檔合併、送審缺漏、唯讀欄位與填報人 |
| `app/entry/admin/indicatorassignment/page.tsx` | 負責欄位、覆蓋情況、批次去重與錯誤顯示 |
| `app/entry/review/campus/[campus]/[category]/page.tsx`、`app/entry/case-list/[indicator]/page.tsx` | 填報人顯示與 HA10 子項加總；返回帶院區 |
| `package.json`、`docs/USER_MANUAL.md`、`docs/CHANGELOG.md` | `test:unit` 範圍；11.5「分子／分母分派」與 11.1、11.2、14.2 的相應段落 |

### ✅ 測試
- `npm run test:unit`：126 條（既有 58 條 + `lib/entry` 68 條）全綠；`npx tsc --noEmit` 零錯誤；`npx next lint` 無錯誤（仍是既有的 3 個 exhaustive-deps 警告）

---

## 雲端化 P5 — 欄位級指派：後端（2026-10-11，`feat/field-assignment-api`）

只動後端；前端是 P6。回應結構以「新增欄位」為主，但**不是完全向下相容**：舊前端會碰到的差異逐項列在「破壞點」，完整對照表在 `docs/API_REFERENCE.md` 的「與 P5 之前的差異」。

### ✨ 新功能 / 改進
- **欄位級指派（D2）**：`IndicatorAssignment.field` ∈ `both`／`numerator`／`denominator`（預設與既有資料都是 `both`）。同一指標的分子與分母可以指派給不同的人，後端真的把關。`IndicatorEntry` 新增 `numerator_filled_by/at`、`denominator_filled_by/at`（分子、分母各自是誰填的；`filled_by/at` 仍是整筆的最後修改者）
- **存檔只寫有權的欄位、不覆寫別人的**（`save_draft` 重寫）：沒有指派的指標 → 403 `not_assigned`；payload 出現沒有權限的欄位 → 400 `field_not_assigned`；兩者都是整筆拒絕、什麼都不寫。payload 沒出現的欄位不動、`null` 才是清空、不是數字 → 400 `invalid_number`（以前靜默略過，缺的 key 還會把別人填的值覆寫成 NULL）。報表列與指標列都 `select_for_update`，`value` 用鎖住後的最新分子／分母重算；數值有變才更新欄位與 `*_filled_by/at`。回應多一個 `entries`（伺服器端最新值，含別人的欄位）。**沒有可寫的東西**（`entries` 為空、每筆只有指標代碼、只有 `sub_entries: []`）時不建立月報、不改狀態，回 `report_id: null`、`status: unfilled`；明確的 `null`（清空）或 `note: ""` 算有東西要寫
- **月報鎖定（KD1）**：`submitted`、`approved`、`finalized` 都鎖填報者（以前 `approved` 沒鎖）→ 403 `report_locked`。表單回應多 `report.locked`
- **送審（KD2、KD3）**：檢查「整個院區 × 面向」所有有現行指派的指標，不只送審者自己的；完整性看必填欄位是否為 NULL（分母 0 算已填，以前分母 0 的指標永遠送不出去）；`HA10-01` × 新竹另外要 13 個子類別都有值。缺漏 → 400 `incomplete`，`missing` 列出 `{indicator_code, indicator_name, field, owners, unassigned}`，沒負責人的標「未指派」。資格：該院區 × 面向有任一現行指派，或 admin（可代為送審，KD4）。沒有資格時，錯誤在院區解析那一步就回了：`campus` 不在指派內 → 403 `campus_not_assigned`；沒帶 `campus` 且該面向沒有任何指派 → 400 `no_assignment`。服務層另留一道 `not_assigned` 檢查，只防直接呼叫 `submit_category` 的程式，API 走不到
- **院區解析不再退回 `user.campus`**：`campus`（query／body）必須在使用者該面向的有效指派內（admin 例外）；沒給則只有一個院區才自動採用。新增 `services/assignments.py` 的 `resolve_campus`
- **GET 表單唯讀**：不再 `get_or_create` 月報；月報不存在時回 `status=unfilled`、`report.id=null`。每個指標多 `editable_fields`、`field_owners`、`numerator_filled_by/at`、`denominator_filled_by/at`。表單只列「我有指派」的指標（二擇一的另一個選項是連別人專屬的指標也列出、`editable_fields` 為空；沒選，因為舊前端存檔會把列出的每一列都送回來，列出不是我的指標會讓整筆存檔 403）
- **`my-tasks`**：改以 院區 × 面向 分組（以前用面向代碼當 key，兩個院區互相蓋掉；退回通知也會跑出不是自己的面向）。每列多 `campus_code`、`campus_name`、`my_filled`／`my_total`（我負責的欄位數）、`category_missing`（整個院區 × 面向還缺幾個必填欄位）；`rejection_notices` 帶院區
- **指派 API**：`field` 欄位與 `?field=` 篩選；`validate()` 把送來的值疊在既有那一列上再驗（PATCH 也驗）：指標存在、沒有分母的指標不能只指派分母、被指派者是啟用中的填報者（admin 也可）、`effective_from <= effective_to`、同一 (指標, 院區, 使用者) 的現行指派欄位不得重疊（`both` 與任何都重疊）。指標清單／詳情多 `has_denominator`、`entry_mode`
- **HA10 子類別收斂（D10）**：13 類加總只適用 `HA10-01` × 新竹；新竹的 `HA10-04` 等其他 HA10 指標和其他院區的 `HA10-01` 都是一般數字（以前所有 `HA10*` × 新竹都走子類別，`HA10-04` 因此被當成 13 類子項加總）。`uses_sub_entries()` 是唯一判斷處，`grep 'startswith("HA10")'` 已無輸出。填報者的存檔只要帶 `sub_entries`，分子一律被設成 13 類加總（子項沒變也一樣，會修正與子項脫鉤的分子）；`sub_entries: []`（或 `null`）視為沒送，其他指標送**非空**的 `sub_entries` 才是 400
- **個案清單指標在表單唯讀（KD9）**：`editable_fields` 為 `[]`，數字欄位寫入 → 400 `field_not_assigned`；**備註可以寫**（有該指標指派即可。以前備註被靜默丟掉，而且那次存檔還會順手建出一份 draft 月報）。個案的排除／恢復必須對該指標有分子指派、月報未鎖（否則 403 `not_assigned`／`report_locked`），重算後記下 `numerator_filled_by/at`
- **審核者修改（KD5）**：`edit_entry` 只在 `submitted`／`approved` 可改（`draft` 時改會被填報者的自動暫存蓋掉）；不受欄位指派限制、不改 `*_filled_by`；有分母的指標不能直接改 `value`；一律用 `compute_value` 重算。**新竹 `HA10-01` 的分子（13 類子項加總）也不能直接改**：`numerator`、`value` → 400 `field_not_editable`，訊息請對方改子項。審核詳情多四個逐欄「誰填的」欄位
- **共用 `compute_value`**（`services/values.py`）：取代 `_calculate_value`、`review_service` 與 `views_case_list` 各自一份的計算、`import_service._calc_value`。Excel 匯入把匯入者記為分子／分母的填報者

### 🔐 安全性
- **個案清單讀取要有指派（H1）**：`GET /api/case-list/` 以前任何登入的填報者／審核者都能讀任何指標 × 院區 × 月份的個案（含 `his_raw_data`），病歷號是否遮罩只看帳號上的 `user.campus`。現在 reviewer｜admin 讀得到全部；reporter 必須對該指標 × 院區 × 月份有現行指派（任一欄位），否則 403 `not_assigned`。這一關在查任何資料之前，被拒的人分不出院區、月報、指標存不存在（都是 403）。完整病歷號改依「reviewer｜admin 或在該院區有現行指派」，不再看 `user.campus`；能通過上一關的 reporter 必定在該院區有指派，所以實際上讀到的是完整病歷號，遮罩版只留給不符資格的呼叫者（目前沒有）。`exclusion-reasons` GET 維持原樣。`apps/accounts/tests` 的 `TestCaseListPatientNumberMasking` 隨之改成指派制
- 個案排除／恢復以前任何填報者都能對任何 id 操作，現在要對該指標有分子指派、月報未鎖

### 🐛 修正
- `unlock_month` 回傳的 `unlocked_count` 永遠是 0（update 之後才 count，狀態篩選已不成立）
- `edit_entry`：JSON 數字 `0` 被當成空白而清掉欄位；稽核紀錄把 0 記成空字串；分母改成 0 時舊的 `value` 留在原地；備註超過 100 字時稽核紀錄寫入失敗
- `_recalculate_entry` 沒有分母或分母為 0 時留下舊 `value`
- **年月不合法一律 400 `invalid_period`**：`my-tasks`、`form`、`save-draft`、`submit`、`GET /api/case-list/` 遇到 `month=-1`／`0`／`13`、`year=1000000`、民國 8088 年 12 月這類年月，以前都是 500。`my-tasks` 先驗年月再算截止日（截止日的日期運算碰到 `month=-1`、`year=1000000` 會直接 `ValueError`），`period_bounds` 也確認「下個月」存在。POST 的 `year`／`month` 缺或不是數字是 400 `missing_params`
- 算出的值放不進 `numeric(12,6)` 時回 400 `value_out_of_range`，不再是 500

### ⚠️ 破壞點（對舊前端，P6 之前）
- 送審缺漏的錯誤 body 不再有 `ok`、`error`，改為 `{detail, code: "incomplete", missing, unfilled_codes}`（前端型別只宣告了 `unfilled_codes`，沒讀 `ok`／`error`）
- `form` 的 `report.id` 在月報還不存在時是 `null`（型別原本是 `number`，因為以前 GET 會順手建立月報）
- 月報被鎖時存檔／送審由 400 改成 403 `report_locked`；`approved` 以前還能存，現在也鎖
- 使用者在某面向有多個院區的指派，`form`／`save-draft`／`submit` 不帶 `campus` → 400 `campus_required`（以前悄悄用第一筆指派的院區）。`/entry` 首頁同一個面向會出現兩列，`key` 重複，連結仍是 `/entry/<面向>`，點進去就是這個 400
- 使用者在某面向沒有任何指派卻打開 `/entry/<面向>` → 400 `no_assignment`（以前退回帳號院區，顯示空表單）
- `GET /api/case-list/`：沒有該指標指派的 reporter → 403 `not_assigned`（以前任何登入者都讀得到）；病歷號遮罩不再看 `user.campus`
- 指標只有部分欄位指派給我，舊表單會連另一個欄位一起送回 → 400 `field_not_assigned`（目前資料全是 `both`，不會遇到；P6 的表單只送 `editable_fields`）
- 個案清單指標若有指派，舊表單存檔會把它的分子／分母送回來 → 400 `field_not_assigned`（目前資料裡沒有個案清單指標）
- 沒有可寫內容的存檔（`entries: []`）不再建立 draft 月報
- `my-tasks` 的 `filled_count` 改看必填欄位是否為 NULL（比以前「分子或計算值不是 NULL」嚴格）

### 📁 修改檔案
| 檔案 | 修改內容 |
|------|---------|
| `backend/apps/entry/models.py`、`migrations/0003_field_level_assignment.py`（新） | `AssignmentField`、`IndicatorAssignment.field`、`IndicatorEntry` 四個逐欄填報者欄位（五個 AddField，不 backfill）、`MonthlyReport.locked_for_reporters` |
| `backend/apps/entry/services/assignments.py`（新） | `period_bounds`、`active_assignments`、`assigned_fields`／`editable_fields`、`required_fields`、`field_owners`、`resolve_campus` |
| `backend/apps/entry/services/values.py`（新） | `compute_value`、`parse_number`、`uses_sub_entries`、HA10 子類別表 |
| `backend/apps/entry/services/errors.py`（新） | `{"detail", "code", ...}` 的 403／400／404 例外（額外欄位保持 JSON 型別） |
| `backend/apps/entry/services/entry_service.py` | 重寫：`get_my_tasks`、`get_category_form`、`save_draft`、`submit_category` |
| `backend/apps/entry/services/{review,import}_service.py`、`views_case_list.py`、`views_review.py` | `edit_entry`／`unlock_month`／審核詳情；匯入記錄填報者；個案清單讀取授權、排除／恢復權限與重算；錯誤帶 `code` |
| `backend/apps/entry/views_entry.py`、`views.py`、`serializers.py`、`admin.py`、`backend/apps/indicators/serializers.py` | 院區解析、`?field=`、指派驗證、`has_denominator`／`entry_mode` |
| `backend/apps/entry/tests/`（新） | 309 條測試（`test_field_assignment.py`、`test_assignment_serializer.py`、`test_submit_and_review.py`） |
| `backend/apps/accounts/tests/test_permissions.py` | `TestCaseListPatientNumberMasking` 改成指派制（無指派 403、有指派讀到完整病歷號、`user.campus` 與 `is_staff` 不算） |
| `docs/API_REFERENCE.md`、`docs/DATABASE_SCHEMA.md`、`QIP-DataEntry-System-Spec-v1.3.md` | 填報／指派／審核／個案清單段、欄位、§2.4 欄位級指派補充 |
| `HANDOFF.md` | P5 已完成一行、已知缺口 |

### ✅ 測試
- 後端 `apps/entry/tests` 309 條、`apps/accounts/tests` 290 條（289 條加上個案清單讀取授權多出的 1 條）全綠；全套 `pytest -q`：628 通過、23 略過，唯一失敗仍是既有的 `test_control_chart.py::test_binomial_rare_event_returns_imr`；`manage.py test apps.davinci` 63 條 OK
- 鎖定行為有兩層測試：SQL 層（存檔鎖報表列與指標列）與真的雙連線（一個交易握著報表鎖時，另一人的存檔會等待，放行後以對方已提交的分子重算，不覆寫它）

---

## 雲端化 P4 — 前端認證狀態與角色分流（2026-10-11，`feat/role-routing`）

### ✨ 新功能 / 改進
- **認證狀態集中到 `lib/auth/store.ts`**（zustand）：`/api/auth/me` 每次載入頁面只打一次（以前 `AuthGuard` 每換一頁就重打一次）；登入、改密碼後直接 `setUser`。`lib/http.ts` 的 `onAuthError` 終於有人用：`not_authenticated` → 清掉 session，`password_change_required` → 標記需改密碼，`permission_denied` **不會**清 session。取捨：角色只在載入時讀一次，管理員中途改了角色要重新整理才會反映在選單上（後端每次請求都以資料庫為準）
- **路由守衛**（`AuthGuard` + `lib/auth/roles.ts` 的 `routeVerdict`）：未登入 → `/entry/login?next=<原頁>`；必須改密碼 → 登入頁的改密碼表單；頁面不屬於自己的角色 → 該角色的落地頁（`canAccess`／`homeFor`）；完全沒有角色 → 登出並導向 `/entry/login?reason=no_role`，登入頁顯示「此帳號尚未指派身分，請聯絡品管中心」。後端連不上時顯示「重試」而不是把人踢去登入頁。登入頁只接受站內、且該角色開得了的 `next`（擋掉 `//host`、`/.//host`、`/\host`、`/%2F%2Fhost`、登入頁本身）。登出進行中守衛不另做軟導頁，避免軟導頁先完成、舊頁面帶著前一位使用者的記憶體資料繼續存活
- **角色分流**：看資料者 → `/`、填報者 → `/entry`、審核者 → `/entry/review`、管理員全部。`canAccess` 補洞：`/entry/*` 底下沒列出的路徑歸填報者（以前落到讀者桶）；`/mock/*` 在 production 對所有人（含 admin）關閉（導回落地頁），非 production 維持免登入
- **帳號管理維持在 `/entry/admin`**，設定頁以「填報系統管理」卡進入。原計畫（D5）把帳號管理搬到設定頁底下的獨立頁，已由使用者撤銷，路由表不再列它、也沒有建那個頁面
- **填報者極簡殼 `EntryShell`**：只有標題、姓名、登出，讀者多一個「回儀表板」、審核者多一個「填報審核」；沒有儀表板側欄、匯入、匯出、設定。範圍與 `canAccess` 的填報者範圍是同一個定義（`isEntryWorkspace`）：`/entry` 底下除了 `/entry/login`、`/entry/review*`、`/entry/admin*` 以外的所有路徑（`/entry/foo` 也是）；後兩者維持儀表板外框。「回儀表板」對所有讀者（viewer｜reviewer｜admin）顯示，reviewer 看得到是刻意的
- **選單與按鈕依角色顯示**：側欄（季度分析、設定 → 讀者；匯入紀錄、標竿管理 → admin；新增「我的填報」→ 真正被指派為填報者的人；新增「填報審核」→ reviewer｜admin）、QIP 標題列（匯出要素清單 → 讀者；匯入資料 → admin）、達文西標題列（匯出 xlsx → reviewer｜admin；匯入 → admin）、設定頁卡片（新增「填報審核」卡）、挑戰目標值只有 admin 能編輯、審核頁標題列的連結
- **達文西下鑽**：沒有個案權限（非 reviewer｜admin）的人，最後一層分組不可再點、沒有「直接看個案」，並提示「個案明細僅審核者／管理員可檢視」；不會呼叫 `cases/`
- **首頁載入失敗依 `ApiError.code` 分流**：`permission_denied` → 「你的帳號沒有儀表板檢視權限，請聯絡品管中心」；`not_authenticated`／`password_change_required` 交給 `AuthGuard` 導頁；其他才是「無法連線後端」。QIP 與達文西的空狀態說明也依角色：只有 admin 被叫去點「匯入資料」，其他人看到「請聯絡品管中心」
- 帳號未設定院區不再擋住 `/entry`（院區由指標負責人指派決定，只留提示）
- `/entry/admin` 的「HIS 資料來源」不再連到 Django 後台（後台不經 Next 對外），只留說明文字
- **後端 F2**：`POST /api/auth/change-password` 加次數限制（`PASSWORD_CHANGE_FAILURE_LIMIT`、`PASSWORD_CHANGE_COOLOFF_MINUTES`，預設 5／5，環境變數可覆寫）：同一使用者 5 分鐘內連續 5 次沒能證明目前密碼（以使用者 id 在 Django cache 計數），第 6 次起回 429 `too_many_attempts`（連正確密碼也一樣，不看 body）；被拒的呼叫不延長冷卻；證明了目前密碼（改密碼成功，或密碼對但新密碼被拒）就歸零。管理員重設密碼與 `seed_admin --reset` 也會清掉計數，否則使用者拿臨時密碼做強制改密碼時會被舊的猜測擋住。cache 連不上（Redis 掛掉）時放行並記 warning，不會 500。`REDIS_URL` 為空時 cache 改用行程內記憶體（以前 `base.py` 沒有這個 fallback）
- **後端有效角色**：`/api/auth/me` 與登入回應的 `roles` 是有效角色，Django 超級使用者一律含 `admin`（只改輸出，不寫回資料庫；帳號管理畫面仍顯示資料庫裡存的角色）。以前 `roles` 為空的 superuser 通過所有後端檢查，卻會被前端當成沒有角色而登出
- **後端 F9**：`/api/auth/me` 與所有 `/api/admin/users*` 的回應（含錯誤與 403）帶 `Cache-Control: no-store`
- `backend/.dockerignore` 加上 `**/__pycache__`、`**/*.pyc`：原本的 `__pycache__`、`*.pyc` 只比對建置根目錄，各 app 底下的位元碼照樣進映像

### 🔐 安全性
- 刪除 `public/sample.xls` 與首頁的「載入範例資料」按鈕：真實院內資料不該放在可公開下載的位置（`lib/http.ts` 的 `fetchPublicFile` 也一併移除）；`public/` 底下其餘的真實資料檔已另行移到 `local-data/`（被 `.gitignore` 擋住，不再由 Next 對外提供）
- change-password 的猜密碼限制（F2）：被盜的 session 不能再拿此端點猜目前密碼；計數在 cache 裡，多 worker 部署請設 `REDIS_URL`
- 登入後導向（`?next=`）的開放導向防護：只接受站內單斜線路徑。實測抓到的繞法：`/.//evil.com` 經 URL 解析會正規化成 `//evil.com`，所以正規化之後的路徑也要再檢查一次
- 前端的選單只是「顯示什麼」，真正的權限仍由後端把關（P2）

### 🐛 修正
- 清掉既有的 6 個 lint 錯誤（未使用的 `router`／`reportId`／`HeadingLevel`／`noBorders`、`maskSmallNumerators` 補 eslint-disable、`app/import/page.tsx` 把三元式當陳述句），`npx next lint` 回到 0 錯誤（只剩 3 個既有警告）；寫法同 `cd6d6f4`

### 📁 修改檔案
| 檔案 | 修改內容 |
|------|---------|
| `lib/auth/store.ts`（新）、`lib/auth/useLogout.ts`（新） | 認證狀態、`ensureLoaded` 去重、`onAuthError` 接線；`signOut`（失敗也繼續）→ `clear()` → 整頁重載登入頁，可帶 `reason=no_role` |
| `lib/auth/roles.ts`、`lib/auth/roles.test.ts`（新） | `canAccess` 補 `/entry/*` 規則、移除不存在的帳號管理頁、`/mock` 在 production 關閉；新增 `canSeeDavinciCases`、`hasAssignedRole`、`isPublicPath`、`isEntryWorkspace`、`routeVerdict`、`safeNextPath`；58 條單元測試 |
| `package.json`、`tsconfig.json` | `test:unit` 指令；`allowImportingTsExtensions`（測試檔以 `.ts` 副檔名 import） |
| `components/layout/AuthGuard.tsx` | 改成讀 store 的純函式守衛，不再每換頁打 API |
| `components/layout/EntryShell.tsx`（新）、`components/layout/ClientLayout.tsx` | 填報者極簡殼；外框選擇 |
| `components/layout/{Sidebar,Header}.tsx`、`app/davinci/components/{DavinciHeader,DrilldownPanel}.tsx`、`app/settings/page.tsx`、`app/entry/review/page.tsx`、`app/entry/admin/page.tsx`、`components/detail/TargetPanel.tsx` | 依角色顯示 |
| `app/entry/login/page.tsx`、`app/entry/page.tsx`、`app/page.tsx`、`app/davinci/page.tsx`、`lib/http.ts` | 登入頁走 store、`next`、`reason`；填報首頁改用 store；首頁錯誤分流、空狀態依角色、移除範例資料；移除 `fetchPublicFile` |
| `app/entry/{[category],case-list/[indicator]}/page.tsx` | 外層不再自帶 `min-h-screen`（殼負責整頁高度） |
| `backend/apps/accounts/password_throttle.py`（新）、`views.py`、`serializers.py`、`management/commands/seed_admin.py` | F2 次數限制（含重設清除、fail-open）；F9 `no_store`；有效角色 |
| `backend/config/settings/base.py`、`backend/.env.example`、`backend/.dockerignore` | `PASSWORD_CHANGE_*`、`REDIS_URL` 為空時的 LocMem fallback；dockerignore |
| `backend/conftest.py`（新）、`backend/apps/accounts/tests/test_auth_followups.py`（新） | 所有測試改用行程內 cache（不碰 Redis）；F2、F9、有效角色的 41 條測試 |
| `public/sample.xls`（刪除） | 見安全性 |

### ✅ 測試
- 後端 `apps/accounts/tests` 289 條全綠（P3 的 248 條 + 41 條新測試）；F2 的冷卻期用假時鐘推進，不 sleep
- 前端 `npm run test:unit`（`node --test lib/auth/*.test.ts`）58 條全綠：`canAccess`（七種角色組合 × 代表路徑）、`homeFor`、`routeVerdict`、`safeNextPath`（含 `//evil.com`、`/.//evil.com`、`https://evil.com`、`/\evil.com`、`/%2F%2Fevil.com`，另有 20 萬筆隨機輸入）。需要 Node 22.18 以上（內建 TypeScript 型別剝除，不用建置）；因此 `roles.ts` 不能有執行期 import，只能 `import type`

---

## 雲端化 P3 — 登入防護與密碼政策（2026-10-11，`feat/auth-hardening`，PR #9）

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
