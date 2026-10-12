# 部署說明（平台無關）

雲端平台尚未決定，所以本專案只交付「平台無關」的部分：兩個映像、一份 compose 樣板、啟動程序與健康檢查。
TLS、網域、反向代理／負載平衡器、託管資料庫、每 IP 限流、備份是平台的事，列在 [§7 平台待辦](#7-平台待辦本專案刻意不做)。

## 1. 架構

```
瀏覽器 ──HTTPS──▶ 平台邊緣（TLS、轉址、限流）──▶ web  Next.js standalone :3000   ← 唯一對外
                                                   │  /api/* 由 Next 在伺服器端轉給 api（next.config.mjs rewrites）
                                                   ▼
                                                  api  Django + gunicorn :8000     ← 僅內網
                                                   ├──▶ db     PostgreSQL（schema qip）
                                                   └──▶ redis  Django cache（變更密碼的猜測次數、儀表板算好的回應）
```

- 瀏覽器只連 web，`/api/*` 對它是同源，所以不需要 CORS，cookie 是同源 cookie。
- web 轉給 api 的位址（`API_INTERNAL_URL`）、等待逾時（`API_PROXY_TIMEOUT_MS`）和 HSTS（`NEXT_HSTS_SECONDS`）是 **build 時固化**：寫進 web 映像，改了要重新 build web，只重啟沒有用。`NEXT_PUBLIC_API_URL` 絕對不要設。
- Django 的 `/healthz` 不經 Next（Next 只代理 `/api/*`），所以只能在內網探測。
- AD 登入（選用，預設關閉）：啟用後 api 要連得到院內 AD 伺服器的 TCP 389（預設埠）；沒啟用就不需要，細節見 [§4.1](#41-啟用-ad-登入的順序)。

| 檔案 | 用途 |
|------|------|
| `Dockerfile.web` | web 映像：deps → builder（`next build`，standalone）→ runner（`node:20-alpine`、非 root、`node server.js`） |
| `backend/Dockerfile`、`backend/entrypoint.sh` | api 映像：`python:3.12-slim`、build 時 `collectstatic`、非 root（uid 10001）；入口 `qip-entrypoint` 先跑 `bootstrap` 再起 gunicorn |
| `backend/requirements.txt`、`backend/requirements-dev.txt` | 正式映像只裝前者；pytest、ruff 在後者，只有 build 引數 `INSTALL_DEV=1`（開發 compose 會傳）才裝 |
| `backend/apps/core/` | `manage.py bootstrap` 與 `GET /healthz` |
| `docker-compose.prod.yml` | db + redis + api + web 的樣板（只有 web 發佈 port）；project 名稱固定為 `qip-prod` |
| `.env.prod.example` | 正式環境變數樣板：複製成 `.env.prod` 填值（每個變數一行說明） |
| `backend/.env.example` | 在主機上直接跑 `manage.py` 用的樣板（複製成 `backend/.env`） |
| `docker-compose.yml`、`start.bat` | **開發**堆疊（postgres 5433／redis 6380／api 8001），見下一節 |

### 與開發堆疊的關係

開發堆疊與正式堆疊放在同一個目錄、可以同時存在於同一台機器的 Docker，但它們是兩套各自獨立的設定，靠下面這幾處分開：

| | 開發（`docker-compose.yml`） | 正式（`docker-compose.prod.yml`） |
|---|---|---|
| project 名稱 | `qip-dashboard`（目錄名） | `qip-prod`（檔案頂層的 `name:`；`-p` 可以蓋過它，§2 的試跑就用 `qip-prodtest`） |
| 設定檔 | 根目錄 `.env`（有沒有都行）：Compose 會自動讀它來內插 `DB_USER`、`DB_PASSWORD`、`SEED_ADMIN_PASSWORD` | `.env.prod`：指令一律帶 `--env-file .env.prod`，它會取代自動讀取的 `.env`，所以根目錄 `.env` 的內容碰不到正式堆疊 |
| 發佈的埠 | postgres 5433、redis 6380、api 8001（Next 的 dev server 在 3000，不是 compose 的服務） | 只有 web：`${WEB_BIND:-0.0.0.0}:${WEB_PORT:-3000}` |
| 映像 | `qip-dashboard-api`（`INSTALL_DEV=1`，有 pytest、ruff） | `qip-prod-api`、`qip-prod-web`（沒有） |
| volume、網路 | `qip-dashboard_*` | `qip-prod_*` |

- 為什麼要這樣分：如果兩份 compose 都用預設的 project 名稱（目錄名），兩邊同名的 `api`、`redis` 服務會被 Compose 當成同一個容器——`up` 會用正式的設定換掉開發的容器，`down` 會把它們刪掉，`--remove-orphans` 還會刪掉開發的 `postgres`。如果兩邊都讀根目錄 `.env`，開發堆疊會吃到正式的密碼，正式堆疊也會吃到開發的值。
- 所以樣板叫 `.env.prod.example`、複製出來的是 `.env.prod`：**不要**把正式的值放進根目錄的 `.env`，那是開發堆疊的檔案（兩者都已列入 `.gitignore`）。
- 唯一會撞的是埠：正式堆疊的 `WEB_PORT` 預設 3000，和 `npm run dev`／`next start` 一樣。要在開發機上同時跑，改 `WEB_PORT`（本機試跑用 3100）。

## 2. 本機試跑（production 形態、純 http）

用獨立的 project name（`-p qip-prodtest`，蓋過檔案裡的 `qip-prod`），不會碰到開發堆疊，也不會碰到真正的正式堆疊；web 發佈在 `127.0.0.1:3100`，只有這台機器連得到。

```bash
# 1. 產生 .env.prodtest（已列入 .gitignore，不入庫）。值用下面的指令產生，不要手打：
#      python -c "import secrets; print(secrets.token_urlsafe(48))"
#    內容（<...> 換成各自產生的隨機值；DB_PASSWORD 與 POSTGRES_PASSWORD 相同）：
#      ENV_FILE=.env.prodtest
#      DJANGO_SETTINGS_MODULE=config.settings.prod
#      DJANGO_SECRET_KEY=<隨機，至少 50 字元>
#      DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1,api
#      CSRF_TRUSTED_ORIGINS=http://localhost:3100
#      SESSION_COOKIE_SECURE=false
#      CSRF_COOKIE_SECURE=false
#      DB_NAME=qm_center
#      DB_USER=qm_admin
#      DB_PASSWORD=<隨機>
#      DB_HOST=db
#      DB_SCHEMA=qip
#      POSTGRES_DB=qm_center
#      POSTGRES_USER=qm_admin
#      POSTGRES_PASSWORD=<同 DB_PASSWORD>
#      REDIS_URL=redis://redis:6379/1
#      SEED_ADMIN_PASSWORD=<隨機>
#      WEB_PORT=3100
#      WEB_BIND=127.0.0.1

# 2. build 並啟動（第一次 build 要幾分鐘）
docker compose -p qip-prodtest -f docker-compose.prod.yml --env-file .env.prodtest up -d --build

# 3. 四個服務都要是 healthy（api 第一次要跑 bootstrap，約一分鐘內）
docker compose -p qip-prodtest -f docker-compose.prod.yml --env-file .env.prodtest ps

# 4. 看啟動程序做了什麼
docker compose -p qip-prodtest -f docker-compose.prod.yml --env-file .env.prodtest logs api

# 5. 試用：開 http://localhost:3100/entry/login ，帳號 admin，密碼是 .env.prodtest 的 SEED_ADMIN_PASSWORD，
#    第一次登入必須改密碼

# 6. 用完收掉（-v 連同 DB 與 media 的 volume 一起刪；--rmi all 連映像一起刪）
docker compose -p qip-prodtest -f docker-compose.prod.yml --env-file .env.prodtest down -v --rmi all --remove-orphans
docker builder prune -f --filter until=24h        # 清掉超過一天沒用到的 build 快取
```

- **正式堆疊的指令長得一樣**，只是用 `.env.prod`、不加 `-p`：`docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build`。
- **磁碟**：第一次 build 會用掉數 GB（兩個映像約 0.7 GB，build 快取約 2 GB，Docker Desktop 的虛擬磁碟還會跟著長）。build 前先看一下 C: 的剩餘空間；在 Windows 上，清理只把空間還給虛擬磁碟，要讓 C: 變大需要壓縮 vhdx。
- **build 快取**：`docker builder prune -a -f` 會清掉**這台機器上所有專案**的 build 快取，下次 build 全部重來，只在清楚後果時使用；上面的 `--filter until=24h` 只清舊的，剛 build 完的留著，下次 build 才快。
- **`--rmi all` 的訊息**：它也會試著刪 `postgres:16-alpine`、`redis:7-alpine`；開發堆疊正在用它們時會看到 `Resource is still in use`，這是正常的，那兩個映像不會被刪。
- **網路**：映像 build 要從 PyPI 與 npm 下載相依套件；網路慢時第一次 build 可能超過十分鐘，之後有快取。
- **為什麼 `SESSION_COOKIE_SECURE`、`CSRF_COOKIE_SECURE` 要設 false**：prod 設定預設 cookie 只走 HTTPS，瀏覽器在 `http://localhost` 不會送出 Secure cookie，登入後馬上又變成未登入。這兩個只用於本機 http 試跑，上線一律用預設（true）。
- **`ENV_FILE`**：`--env-file` 只決定 compose 檔裡的 `${...}` 內插；api 容器的環境變數來自它的 `env_file: ${ENV_FILE:-.env.prod}`。在檔案裡寫 `ENV_FILE=<自己的檔名>`，一個 `--env-file` 就同時管兩者。平常部署用 `.env.prod`，不必設。
- `DJANGO_ALLOWED_HOSTS` 要包含 `localhost`（容器探針的 Host）與 `api`（容器之間直接呼叫時）。

## 3. 上雲必填變數

完整清單與說明在 `.env.prod.example`。沒有標「build」的都是執行時環境變數。

| 變數 | 必填 | 說明 |
|------|------|------|
| `DJANGO_SECRET_KEY` | 是 | 至少 50 字元的隨機字串。**prod 啟動時會檢查**：空的、不足 50 字元、含範本或開發用的字樣（`change-me`、`dev-secret-key`、`django-insecure-`…）都會拒絕啟動；外洩要換（所有 session 會失效）。映像 build 時 `collectstatic` 用的 `build-only-…` 金鑰只在 `COLLECTSTATIC_ONLY=1` 時通過，執行時不要設這個變數 |
| `DJANGO_ALLOWED_HOSTS` | 是 | **prod 沒設會拒絕啟動。** 對外網域，加上 Next 轉來的 Host（Next 把收到的 Host 放進 `X-Forwarded-Host`）與探針用的 `localhost` |
| `DATABASE_URL` 或 `DB_*` | 是 | `DATABASE_URL`（`postgres://…`，可帶 `sslmode`，密碼特殊字元要 URL 編碼）有填就蓋過 `DB_*` |
| `DB_SCHEMA` | 否（預設 `qip`） | 只接受小寫英文字母、數字與底線，不以數字開頭（PostgreSQL 會把沒加引號的名稱轉成小寫）；bootstrap 會建立它 |
| `DB_CONNECT_TIMEOUT` | 否（預設 5） | 連不上資料庫時每次嘗試等幾秒；`DATABASE_URL` 自帶的 `connect_timeout` 優先；0 = 不設逾時 |
| `SEED_ADMIN_PASSWORD` | 首次 | 建立 `admin` 帳號的初始密碼（須通過密碼規則）；帳號已存在就略過，登入後建議從環境移除 |
| `API_INTERNAL_URL`（build） | 是 | web 容器看出去的 api 位址，compose 內是 `http://api:8000`；換位址要重新 build web |
| `REDIS_URL` | 建議 | 留空 = 每個行程各用自己的記憶體：變更密碼的猜測次數各算各的，**儀表板快取預設關閉**（別的行程——管理指令、其他 worker——的寫入清不到 web 行程記憶體裡的那一份，單一 worker 也一樣）。要快取、或有多個 worker，就填 |
| `REDIS_SOCKET_TIMEOUT` | 否（預設 2） | 連 Redis、等 Redis 回覆各最多等幾秒（> 0，可帶小數）；逾時視為 cache 不可用，請求照常處理 |
| `DASHBOARD_CACHE_ENABLED` | 否（預設：有填 `REDIS_URL` 才開） | 明設 true／false 蓋過預設。false = 儀表板每次重新計算（回應標頭 `X-Dashboard-Cache: BYPASS`），關閉期間的寫入仍讓版本號前進，之後再開不會讀到舊內容；沒有 Redis 還設 true，別的行程的寫入清不掉這份快取，只能等 TTL |
| `DASHBOARD_CACHE_TTL` | 否（預設 600） | 儀表板快取的保底存活秒數（至少 1，否則拒絕啟動）；資料變動會立刻使快取失效，TTL 只在「失效通知沒送成」（例如當時 Redis 連不上）時才有作用 |
| `CSRF_TRUSTED_ORIGINS` | 視情況 | 含 scheme 的對外來源（`https://qip.example.org`）。同源代理下通常不必填；平台改寫了 Host 或 scheme、POST 被擋時才填 |
| `SECURE_HSTS_SECONDS`、`NEXT_HSTS_SECONDS`（build） | 否 | HTTPS 確認可用後再分段調高，見 §7-3 |
| `SESSION_COOKIE_SECURE`、`CSRF_COOKIE_SECURE` | 否（預設 true） | 上線不要動 |
| `PORT`、`GUNICORN_WORKERS`、`GUNICORN_TIMEOUT` | 否 | 預設 8000／3／120 |
| `RUN_BOOTSTRAP` | 否（預設 1） | 只有 `0`、`false`、`no`（不分大小寫）才略過啟動程序；其他值（包含留空）都照常執行 |
| `WEB_PORT`、`WEB_BIND` | 否 | 只給 `docker-compose.prod.yml`：web 發佈的埠（預設 3000）與綁定的位址（預設 `0.0.0.0`；本機試跑用 `127.0.0.1`） |
| `LDAP_ENABLED` | 否（預設 false） | AD 驗證總開關。預設關閉時行為與沒有 AD 完全相同。由資訊室上線時改成 `true`；**改之前品管中心要先建好自己的 AD 員編管理者帳號**，見 [§4.1](#41-啟用-ad-登入的順序) |
| `LDAP_SERVER_IP` | 是（啟用時） | AD 伺服器位址（主機名稱或 IP），資訊室提供；api 容器必須連得到 |
| `LDAP_PORT` | 否（預設 389） | AD 埠，1–65535。**只能填明文 LDAP 埠；不要填 636（LDAPS），本系統不做 TLS**（走 389 明文 bind，與醫中系統相同） |
| `LDAP_BIND_USER` | 是（啟用時） | 查詢用服務帳號，資訊室提供；只用來搜尋員編對應的 DN |
| `LDAP_BIND_PASS` | 是（啟用時） | 上述服務帳號的密碼；不入庫。值含 `$` 時，在 `.env.prod` 用單引號整個包起來（`LDAP_BIND_PASS='…'`），否則 Compose 會把 `$xxx` 換成空字串；值裡不要有「空白＋`#`」 |
| `LDAP_BASE_DN` | 是（啟用時） | 搜尋人員的起點 DN，資訊室提供。DN 可含空白，照資訊室給的原樣填；值含 `$` 時同樣用單引號整個包起來；值裡不要有「空白＋`#`」 |
| `LDAP_TIMEOUT` | 否（預設 3） | 連線與等待回覆的逾時秒數（> 0，可帶小數）。AD 完全連不上時一次登入最壞約等 5 倍這個秒數，之後 30 秒內的登入直接回「無法連線到院內 AD」 |
| `LDAP_AUTO_CREATE` | 否（預設 false） | AD 驗證成功但系統沒有此帳號時是否自動建立。預設 false：回「尚未開通」，由品管中心開通帳號 |
| `LDAP_DEFAULT_ROLE` | 否（預設 viewer） | 自動建立帳號時給的角色，只接受 `viewer` 或 `reporter` |
| `LDAP_LOCAL_ONLY_ACCOUNTS` | 否（預設空） | 不走 AD、只比對本地密碼的員工編號，逗號分隔（例如 `admin`）。清單比對不分大小寫，但登入時帳號要與系統內寫法完全相同（`admin` 不能打成 `ADMIN`）。**留空 = 純 AD，連 `admin` 都登不進去**；要保留不依賴 AD 的緊急管理者就填 `admin` |

`LDAP_ENABLED=true` 時，`LDAP_SERVER_IP`、`LDAP_BIND_USER`、`LDAP_BIND_PASS`、`LDAP_BASE_DN` 缺任何一個，api 容器都拒絕啟動，錯誤訊息只列鍵名、不印值。`LDAP_ENABLED` 沒設或為 false 時，這組變數全部不檢查。

## 4. 首次啟動順序

api 容器的入口 `qip-entrypoint` 每次啟動都會：

1. `python manage.py bootstrap`（`RUN_BOOTSTRAP` 為 `0`、`false`、`no` 時略過）：
   1. 等資料庫（最多 60 次、每次嘗試最多等 `DB_CONNECT_TIMEOUT` 秒、失敗後隔 2 秒再試；等不到就以非 0 結束，由平台重啟）
   2. 取得 PostgreSQL advisory lock——多個副本同時啟動時，其餘的在這裡等前一個做完
   3. 檢查 `DB_SCHEMA`，不存在才 `CREATE SCHEMA`（名稱必須是 `^[a-z_][a-z0-9_]*$`：小寫，因為連線的 `search_path` 沒加引號，PostgreSQL 會把它轉成小寫，大寫的名稱會建出另一個 schema）
   4. `migrate --noinput`
   5. `seed_entry_base --only-missing`、`seed_indicators --only-missing`：只補缺的，**不覆寫**管理員改過的名稱，**不會**把被停用的指標重新啟用
   6. 有 `SEED_ADMIN_PASSWORD` 才跑 `seed_admin`（`admin` 已存在則略過，不會重設密碼）
   7. 放鎖。每一步在 log 印一行 `[bootstrap] …`
2. 沒有指定指令就啟動 gunicorn（`0.0.0.0:$PORT`）；有指令（`docker run image python manage.py …`）就改跑那個指令。

整個程序可以重複執行：重啟 api 只會看到 `No migrations to apply` 與「略過」。要更新指標的預設資料（名稱、單位、別名等），手動執行不帶旗標的 `python manage.py seed_indicators`——它會覆寫並**重新啟用**被停用的指標。

**AD 驗證狀態行**：`bootstrap` 在檢查 `DB_SCHEMA` 之後、等資料庫之前，多印一行不編號的狀態，一眼看出 AD 有沒有生效（不印 bind 帳號與密碼）：

```
[bootstrap] AD 驗證：未啟用（僅本地密碼）
[bootstrap] AD 驗證：啟用（<主機>:<埠>，base …，逾時 3 秒，本地帳號：無，所有帳號含管理者都必須通過 AD）
```

啟用但本地帳號清單為空時，那一句就是提醒：連 `admin` 都要通過 AD。

`GET /healthz`：不需登入，資料庫可連就回 200 `{"status":"ok"}`，否則 503（內容不說原因，原因寫在 log）。探針的 Host 要在 `DJANGO_ALLOWED_HOSTS` 內——平台若用 Pod IP 或內部名稱當 Host，把它加進去，或讓探針帶 `Host: localhost`。

### 4.1 啟用 AD 登入的順序

AD 登入**預設關閉**。關閉時系統行為與今天完全相同；由資訊室上線時自行把 `LDAP_ENABLED` 改成 `true`。啟用後 **AD 是唯一的門**：帳號必須通過 AD，系統裡的本地帳號只決定這個人的角色與院區；沒通過 AD 就什麼都進不去，連本地密碼都不行（只有 `LDAP_LOCAL_ONLY_ACCOUNTS` 清單內的帳號例外）。**帳號的開通權仍在品管中心**：AD 只認人，沒在系統裡建帳號的人，AD 密碼對也只會看到「尚未開通」。

下面六步有先後，請依序做；每一步標出由誰負責。

1. **【品管中心】在 LDAP 仍關閉時，先建好自己的 AD 員編管理者帳號——這是資訊室啟用前的必要條件。** 用 `admin` 登入 `/entry/admin` →「+ 新增使用者」，帳號填你自己的**員工編號**（必須與 AD 的 `sAMAccountName` 一致）、姓名、角色勾「管理員」。其他需要登入的同仁（審核者、填報者、檢視者）也趁此時盤點、建好。沒做這一步就啟用，系統會沒有任何管理者能登入。
2. **【品管中心決定】決定 `LDAP_LOCAL_ONLY_ACCOUNTS`。** 留空 = 純 AD：所有帳號都必須通過 AD，`admin` 從此登不進去；AD 當機時也沒有人能登入。要保留一個不依賴 AD 的緊急管理者，就填 `admin`（此時 `admin` 永不打 AD、只比本地密碼，AD 當機時它仍能登入；請保管好它的密碼）。
3. **【資訊室】填 LDAP 四個必填鍵，並把 `LDAP_ENABLED` 改成 `true`。** 正式環境寫在 `.env.prod`，開發環境寫在 `backend/.env`（兩者都不入庫）：`LDAP_SERVER_IP`、`LDAP_BIND_USER`、`LDAP_BIND_PASS`、`LDAP_BASE_DN`，埠不是 389 才設 `LDAP_PORT`（只能填明文 LDAP 埠，不要填 636）。格式（已實測）：DN 可含空白，照資訊室給的原樣填；值含 `$` 時在 `.env.prod` 用單引號整個包起來（`LDAP_BIND_PASS='…'`），否則 Compose 會把 `$xxx` 換成空字串——密碼開頭是 `$` 又沒加引號 → 容器拒絕啟動；`$` 在中間 → bind 失敗、所有人看到 503；值裡不要有「空白＋`#`」。缺任何一個，容器拒絕啟動並只印鍵名。
4. **【資訊室】先預檢，再重啟 api，看啟動 log 的狀態行。** 預檢：切換前用一次性容器、臨時打開 LDAP 跑 `--audit`，就能發現管理者不在 AD，不必先動到執行中的 api：

   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm -e RUN_BOOTSTRAP=0 -e LDAP_ENABLED=true api python manage.py ldap_check --audit
   ```

   （`.env.prod` 的四個必填鍵要已填好；結果怎麼判讀見第 5 步。）預檢沒問題再重啟 api。 改 `.env.prod` 後要**重建容器**才會讀到新值（`restart` 不會重新讀 `env_file`）：`docker compose -f docker-compose.prod.yml --env-file .env.prod up -d api`。log 要看到 `[bootstrap] AD 驗證：啟用（…）`，括號裡的主機、埠與本地帳號清單要和你填的一致。看到「未啟用」代表沒生效，見 §8。**啟用後，啟用前以本地密碼登入的 session 會在下一個請求被自動登出，使用者需重新登入（走 AD）；本地帳號清單內的帳號與 AD 登入的 session 不受影響。**
5. **【資訊室與品管中心】用 `ldap_check` 驗證。**

   ```bash
   # 正式（在 api 容器內執行；平台不是 compose 就用它的 shell）
   docker compose -f docker-compose.prod.yml --env-file .env.prod exec api python manage.py ldap_check                    # 服務帳號能不能 bind
   docker compose -f docker-compose.prod.yml --env-file .env.prod exec api python manage.py ldap_check --user <員編>      # 查某人：找到與否、姓名、mail、部門
   docker compose -f docker-compose.prod.yml --env-file .env.prod exec api python manage.py ldap_check --audit            # 所有啟用中的本地帳號是否都在 AD
   docker compose -f docker-compose.prod.yml --env-file .env.prod exec api python manage.py ldap_check --user <員編> --login   # 互動輸入該員編的 AD 密碼，測完整登入流程（不要加 -T）
   # 看 log
   docker compose -f docker-compose.prod.yml --env-file .env.prod logs api
   # 開發（-T 不配置終端機；--user <員編> --login 要輸入密碼，改用 docker compose exec api … 不加 -T）
   docker compose exec -T api python manage.py ldap_check
   ```

   `--audit` 列出「系統裡啟用中、但 AD 查無」的帳號（啟用後它們將無法登入），**管理者特別標 `[ADMIN]`**，另列「AD 姓名與系統姓名不一致」者（只是提醒，不影響登入）。**判讀**：清單為空（`LDAP_LOCAL_ONLY_ACCOUNTS` 留空）時，seed 管理者 `admin` 一定會列出並標註「seed 管理者；要保留請列入 `LDAP_LOCAL_ONLY_ACCOUNTS`」，這是預期、不算警告。**除了 `admin` 以外，不得有任何 `[ADMIN]` 查無**：有的話結尾出現 WARNING、結束碼 2，回到第 1 步修正員編，再重跑。只有非管理者查無或姓名不一致時結束碼為 0（示範帳號、測試帳號本來就不在 AD，出現是正常的，用不到就停用或刪除）。其他指令失敗時結束碼非 0；輸出不含密碼。

   **帳號被鎖住時解鎖**：`docker compose -f docker-compose.prod.yml --env-file .env.prod exec api python manage.py unlock_account <員編>`（不分大小寫，同時清掉改密碼嘗試計數；可一次列多個員編）。
6. **【品管中心】用自己的 AD 帳號登入驗證，再確認 `admin` 是否如預期。** 用你的員編＋AD 密碼登入：應成功、落在儀表板、**不會被要求改密碼**。再用 `admin` 的本地密碼登入：第 2 步留空 → 應被擋（「帳號或密碼錯誤」）；填了 `admin` → 應能登入。逐項勾選見 `docs/ACCEPTANCE_GUIDE.md` 的「AD 登入」一節。

**資訊室啟用前的建議**：在邊緣（反向代理）對 `/api/auth/login` 做**每 IP 限流**。登入頁可被拿來累計 AD 自己的鎖定次數；本系統的 axes 是每帳號 5 次／5 分鐘，只能限速，且經 Next 代理後看不到個別來源 IP，per-IP 限流只能在邊緣做。

**退回**：把 `LDAP_ENABLED` 改成 `false`（或刪掉那一行）並重建 api，行為立刻回到純本地密碼。AD 使用者在第一次 AD 登入時，若原本是「須改密碼」狀態，其臨時密碼已被作廢，退回後需由管理員在帳號管理頁重設。

### 4.2 AD 登入的已知限制

- **AD 當機時，只有 `LDAP_LOCAL_ONLY_ACCOUNTS` 裡的帳號能登入。** 清單為空則沒有人能登入，直到 AD 恢復或把 `LDAP_ENABLED` 關掉（「AD 是唯一的門」的代價）。
- 每個非清單帳號登入都先打 AD。AD 不可達時一次登入最壞多等約 5 倍 `LDAP_TIMEOUT` 秒，之後有 30 秒的斷路器：期間所有非清單帳號的登入立即回 503 `ldap_unavailable`。
- 「尚未開通」與「AD 查無」的失敗都計入登入鎖定，連續 5 次後鎖 5 分鐘。
- 從登入頁猜 AD 密碼，失敗也會累計到 **AD 自己**的鎖定原則；本系統的 5 次鎖定可以限速，但無法完全避免。用資訊室的測試帳號做錯密碼測試，不要用自己的。
- 預設走 389 明文 bind（與醫中系統相同），不做 LDAPS；要加密需資訊室提供 CA 憑證，另案處理。
- LDAP 開啟時，Django 後台的 `/admin/password_change/`（僅 `is_staff`）不受 AD 閘門限制（不受「AD 帳號不得在本系統改密碼」的限制）；後台本來就不對外（§7-6）。
- Django 後台 `/admin/login/` 在 AD 連不上時會計入鎖定次數（API 登入不會）。
- 帳號比對不分大小寫（`abc` 與 `ABC` 視為同一人），登入鎖定的計數也不分大小寫；但 `employee_id` 欄位本身仍分大小寫（既有行為）。
- 關閉 LDAP 退回時，AD 使用者的本地密碼若曾被作廢（第一次 AD 登入時帳號還是「須改密碼」狀態者），需要管理者重設。

## 5. 對外行為

- **代理標頭**：TLS 在平台邊緣結束，邊緣必須送 `X-Forwarded-Proto: https` 並**覆寫**客戶端自帶的值；Next 14.2 的 `/api` 代理原樣轉送 `X-Forwarded-Proto`、`X-Forwarded-For`，只把 `X-Forwarded-Host` 設成它收到的 Host。Django 取 `X-Forwarded-Proto` 逗號分隔的第一個值（`SECURE_PROXY_SSL_HEADER`）。
- **日誌**：全部寫 stdout／stderr（gunicorn access log、`django.request` 的 4xx／5xx 含 traceback、`axes` 的登入失敗與鎖定），交給平台收集。
- **靜態檔**：admin 用的 CSS／JS 在 build 時 `collectstatic`，由 WhiteNoise 在 `/static/` 提供。上傳的檔案（`/app/media`）**不會**被對外提供。
- **JSON 專用**：prod 的 DRF 只輸出 JSON（沒有可瀏覽的 API 頁面）。
- **儀表板快取**：`GET /api/v1/dashboard/` 算好的回應存在 Django cache（Redis），key 是 `dashboard:v<版本>:<campus>:<category>:<search>`，版本號在 `dashboard:version`（沒有過期時間）。**預設只在有填 `REDIS_URL` 時開啟**（`DASHBOARD_CACHE_ENABLED` 明設 true／false 可蓋過）：沒有 Redis 時每個行程各用自己的記憶體，管理指令（`wipe_datapoints`、`refresh_alerts`、`seed_indicators` 都在獨立的行程裡跑）與其他 worker 的 bump 清不到 web 行程記憶體裡的那一份，單一 worker 也一樣，會一直回舊資料到 TTL 為止——所以請用 Redis，或保持關閉。任何會改變儀表板的寫入——Excel 匯入、修正資料點、改目標值、TCPI 匯入、Django 後台編輯、`seed_indicators`／`refresh_alerts`／`wipe_datapoints`——完成後都讓版本號加 1，舊內容就不會再被讀到（TTL 到了自動消失）。**每次容器啟動的 `bootstrap` 會跑 `seed_indicators`，所以每次部署也會清一次**；要手動清（需要 Redis；記憶體快取跨不了行程，`manage.py shell` 裡的 bump 清不到 web 行程）：`exec api python manage.py shell -c "from apps.indicators.cache import bump_dashboard_cache; bump_dashboard_cache()"`。回應標頭 `X-Dashboard-Cache`：`HIT`（取自快取）、`MISS`（重新計算並存入）、`BYPASS`（沒用到快取：已關閉——包含沒有 Redis 的預設——、Redis 連不上、或請求的 key 太長）。內容不分角色（權限檢查在讀快取之前）。**記憶體**：每份 payload 約 150–280 KB，通常每院區一份（三院區不到 1 MB）；失效後舊版本的內容不會被刪，放到 TTL 到期，所以 TTL 內每多一次寫入就多一輪（最壞約 院區數 × 寫入次數 × 280 KB）。Redis 不通時照常運作（記 warning、重新計算），代價是那段時間的寫入沒能通知失效：Redis 恢復後最久 `DASHBOARD_CACHE_TTL` 秒內可能讀到舊內容。Redis 的 `maxmemory-policy` 請用 `noeviction` 或 `volatile-*`（版本號沒有過期時間，不會被 `volatile-*` 逐出）；`allkeys-*` 可能逐出版本號，逐出後版本號從 1 重來，最久 TTL 秒內可能讀到逐出前的舊內容。
- **連線池**：預設 `DB_CONN_MAX_AGE=60`（開發設定固定為 0）。若平台提供 PgBouncer，需用 session 模式或直連：bootstrap 的 advisory lock 是 session 層級，而且連線字串帶的 `options`（search_path）在 transaction 模式會被拒絕。

## 6. 檢查清單（上線前後）

```bash
# 在 api 容器內（compose 用 exec；平台用它的 shell／ssh）。映像是 python:3.12-slim，沒有 curl，用 python 打：
python manage.py check --deploy          # 預期的警告見下面
python manage.py migrate --check         # 沒有未套用的 migration
python -c "import urllib.request; print(urllib.request.urlopen('http://localhost:8000/healthz').status)"                     # 200
python -c "import urllib.request; print(urllib.request.urlopen('http://localhost:8000/static/admin/css/base.css').status)"   # 200

# 從外面
curl -s -o /dev/null -w "%{http_code}\n" https://<網域>/entry/login        # 200
curl -s -o /dev/null -w "%{http_code}\n" https://<網域>/api/auth/me        # 403（未登入）
curl -s https://<網域>/api/auth/options                                       # {"ldap_enabled": false}（啟用 AD 後是 true）
curl -s -o /dev/null -w "%{http_code}\n" https://<網域>/healthz            # 404（沒有經 Next 對外）
```

`check --deploy` 在 `.env.prod.example` 的建議值（cookie 用 Secure、`SECURE_HSTS_SECONDS=0`、`SECURE_SSL_REDIRECT=false`）下預期有兩個警告，都是刻意的：

- `security.W004`：沒設 HSTS。HTTPS 確認可用後再開（§7-3）；開了之後還會出現 W005（includeSubDomains）與 W021（preload）。
- `security.W008`：`SECURE_SSL_REDIRECT` 不是 true。由平台邊緣轉址時屬預期；邊緣一切就緒、決定改由 Django 轉址時設 `SECURE_SSL_REDIRECT=true`，這個警告就消失。

本機 http 試跑（§2）還會多 W012、W016（cookie 不是 Secure），那是試跑刻意關掉的。要看上線時的樣子：`exec -e SESSION_COOKIE_SECURE=true -e CSRF_COOKIE_SECURE=true api python manage.py check --deploy`。

## 7. 平台待辦（本專案刻意不做）

1. **`POST /api/auth/login` 的每 IP 限流。** 瀏覽器經 Next 代理到 Django，Django 看到的來源位址對所有人都一樣；`AXES_IPWARE_*` 在沒裝 django-ipware 的映像裡完全無效。所以登入鎖定（5 次失敗鎖 5 分鐘）實質上只看帳號：知道員工編號的人就能鎖住那個帳號（包含 admin），每次冷卻結束可再鎖。真正擋暴力破解與鎖帳號攻擊要在平台邊緣（負載平衡器／WAF）對這個路徑做每 IP 速率限制。細節見 `backend/config/settings/base.py` 的 AXES 註解。
2. **確認 api 的 `:8000` 不對外**（開發堆疊的 `:8001` 同理）。只有 web 該被連到：直連 Django 會繞過 Next 與邊緣的限流，也能自己帶 `X-Forwarded-*` 偽造 HTTPS 與主機名稱。`docker-compose.prod.yml` 不發佈 api／db／redis 的 port；換平台時要重新確認。
3. **HTTPS 與 HSTS。** 邊緣結束 TLS、把 http 轉址到 https、送 `X-Forwarded-Proto: https`（§5）。HSTS 瀏覽器會記住，先確認 HTTPS 全程可用，再分段調高（300 → 86400 → 31536000）。有兩個設定點，因為 HTML 由 Next 回應、API 與 admin 由 Django 回應：`NEXT_HSTS_SECONDS`（web build 時固化）與 `SECURE_HSTS_SECONDS`；或乾脆全部在邊緣設。邊緣一切就緒後再考慮 `SECURE_SSL_REDIRECT=true`（邊緣沒送正確的 `X-Forwarded-Proto` 就開，會無限轉址）。開 HSTS 後 `check --deploy` 會出現 W005（includeSubDomains）與 W021（preload）：是否加入取決於整個網域的所有子網域是否都走 HTTPS，要改 `config/settings/prod.py`。
4. **media volume 持久化，而且目前只能單一 api 副本。** 達文西匯入的「預覽 → 確認」要讀回上傳的檔案（`/app/media/davinci_imports/…`）：volume 要持久、對 uid 10001 可寫；多副本之間沒有共享檔案系統，預覽與確認落在不同副本就會找不到檔案。另外上傳的原始檔可能含未遮罩的個案資料，保留期限尚未決定。
5. **排程 `axes_reset_logs`。** django-axes 每次登入都留一筆 AccessLog，資料表只會長大：定期執行 `python manage.py axes_reset_logs --age-days 90`（天數自訂）。
6. **Django `/admin/` 不經 Next。** Next 只代理 `/api/*`，對外網域上的 `/admin/` 是 Next 的 404；admin 在 api 服務上。要用就走內網／port-forward 連 api，並把那個主機名稱加進 `DJANGO_ALLOWED_HOSTS`（必要時 `CSRF_TRUSTED_ORIGINS`），限制來源 IP。大多數管理工作用 `manage.py` 就夠了（`exec api python manage.py …`）。
7. **備份。** 資料在 PostgreSQL 與 media volume（`/app/media`）；compose 的 `db_data` volume 不是備份。PostgreSQL 用 `pg_dump`（或託管資料庫的時間點還原），例如 `docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > qm_center-$(date +%Y%m%d-%H%M).sql`。目前開發機的備份放在隨身碟 `D:\qip-backup\<yyyymmdd-hhmm>\`（`pg_dump` 輸出、`local-data/` 的真實 Excel 等）；那是開發資料的備份，**不是**雲端的備份方案。平台上要排程自動備份、異地保存，並演練過還原。
8. **其他。** gunicorn worker 數（`GUNICORN_WORKERS`）依 CPU 與記憶體調整；Redis 的連線與回覆逾時是 `REDIS_SOCKET_TIMEOUT`（預設 2 秒，P8）：Redis 卡住時用到 cache 的請求最多多等這麼久，然後照常處理；平台若覆寫 `HOSTNAME`（例如 Kubernetes 會把它設成 Pod 名稱），Next 會只聽那個位址：在 web 的環境設 `HOSTNAME=0.0.0.0`；映像掃描與依賴更新（`npm audit` 目前有已知漏洞的依賴，未處理；Python 相依在 `requirements.txt` 沒有鎖版本，每次 build 取當下最新）；日誌收集與告警。

## 8. 疑難排解

| 症狀 | 原因與處理 |
|------|-----------|
| `docker compose` 說 `POSTGRES_PASSWORD 必須設定` | 沒帶 `--env-file .env.prod`（或該檔沒填這個變數）。正式堆疊的指令一律要帶 `--env-file` |
| api 一直重啟，log 停在 `waiting for the database` | 資料庫位址／帳密錯，或還沒起來。`DB_HOST`、`DATABASE_URL`、`POSTGRES_*` 是否一致 |
| api 以 `DJANGO_ALLOWED_HOSTS is required` 結束 | prod 要求明確的主機名稱，補上 `DJANGO_ALLOWED_HOSTS` |
| api 以 `DJANGO_SECRET_KEY …` 結束 | 密鑰是空的、不足 50 字元，或還是範本／開發用的值：產生一個隨機的（`python -c "import secrets; print(secrets.token_urlsafe(64))"`） |
| api 以 `DB_SCHEMA … is not a plain identifier` 結束 | 只接受小寫英文字母、數字與底線，且不以數字開頭 |
| `/api/*` 回 400 `Invalid HTTP_HOST header` | 該 Host 不在 `DJANGO_ALLOWED_HOSTS`；平台改寫 Host 時，把它收到的 Host 加進去 |
| 登入成功但馬上變回未登入 | 用 http 存取，而 cookie 設為 Secure：本機試跑要把 `SESSION_COOKIE_SECURE`、`CSRF_COOKIE_SECURE` 設 false（§2）；上線則確認是 HTTPS |
| POST 回 403 `csrf_failed` | 瀏覽器看到的來源與 Django 看到的主機不同：確認邊緣保留 Host 或送 `X-Forwarded-Host`，必要時填 `CSRF_TRUSTED_ORIGINS` |
| 頁面正常但 `/api/*` 回 500／504 | web 烘進去的 `API_INTERNAL_URL` 不對或 api 沒起來：改 build 引數後重新 build web |
| web 映像 build 失敗在 `npm ci` | `package.json` 與 `package-lock.json` 不一致：先在本機 `npm install` 並提交 lock |
| api 啟動後 admin 沒有樣式 | `collectstatic` 在 build 時執行（失敗會中止 build）；確認用的是新建的映像，且請求走 `/static/` |
| 設了 `LDAP_ENABLED=true`，登入卻像是沒走 AD（本地密碼還能登入，或啟動行寫「AD 驗證：未啟用」） | 看 api 啟動 log 的 `[bootstrap] AD 驗證：…` 那一行。寫「未啟用」= 容器沒讀到 `LDAP_ENABLED=true`：確認 `.env.prod` 裡該行沒被註解掉（醫中系統也踩過：設定被註解掉）、值是 `true`（不是 `True ` 帶空白或引號）、改完用 `up -d api` 重建容器而不是 `restart`（`restart` 不會重新讀 `env_file`）。若寫「啟用」但本地帳號還能登入，檢查 `LDAP_LOCAL_ONLY_ACCOUNTS` 是不是把那個帳號列進去了 |
| 登入顯示「目前無法連線到院內 AD 驗證服務，請稍後再試或洽資訊室」（503 `ldap_unavailable`） | api 連不上 AD 或服務帳號 bind 失敗，**不計入登入鎖定**。從 api 容器執行 `ldap_check`（§4.1 第 5 步）：確認 api 所在的伺服器到 `LDAP_SERVER_IP:LDAP_PORT` 的 389 連得通（防火牆、VPN、網段）、`LDAP_BIND_USER`／`LDAP_BIND_PASS` 沒過期或被改。失敗後有 30 秒斷路器，修好後最多再等 30 秒才會重試，不必重啟。要立刻讓大家能登入：把緊急管理者（`LDAP_LOCAL_ONLY_ACCOUNTS`）用本地密碼登入，或暫時 `LDAP_ENABLED=false` 並重建 api |
| 管理者登不進去（啟用 AD 之後） | 通常是第 1 步沒做好：他的員編在系統裡沒有帳號（顯示「尚未開通」），或系統裡的員編與 AD 的 `sAMAccountName` 不同；或是用 `admin` 登入而清單為空（純 AD，`admin` 本來就進不來）。處理：把 `admin` 填進 `LDAP_LOCAL_ONLY_ACCOUNTS` 並重建 api，用 `admin` 的本地密碼登入後補建或修正員編；來不及的話暫時 `LDAP_ENABLED=false` 重建 api 回到本地登入。事後用 `ldap_check --audit` 確認所有管理者都在 AD |
| 同仁輸入的 AD 密碼是對的，卻顯示「AD 驗證成功，但系統尚未開通此帳號，請洽品管中心」（403 `account_not_provisioned`） | AD 認得這個人，但系統沒有對應帳號：請品管中心在帳號管理頁新增，**帳號（員工編號）必須與 AD 的 `sAMAccountName` 一致**（比對不分大小寫）。用 `ldap_check --user <員編>` 查 AD 那邊的帳號寫法，與系統裡的員編對照（常見是舊員編、多一個前導零或字母）。此狀況也計入登入鎖定 |
