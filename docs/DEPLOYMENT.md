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
                                                   └──▶ redis  Django cache（變更密碼的猜測次數）
```

- 瀏覽器只連 web，`/api/*` 對它是同源，所以不需要 CORS，cookie 是同源 cookie。
- web 轉給 api 的位址（`API_INTERNAL_URL`）、等待逾時（`API_PROXY_TIMEOUT_MS`）和 HSTS（`NEXT_HSTS_SECONDS`）是 **build 時固化**：寫進 web 映像，改了要重新 build web，只重啟沒有用。`NEXT_PUBLIC_API_URL` 絕對不要設。
- Django 的 `/healthz` 不經 Next（Next 只代理 `/api/*`），所以只能在內網探測。

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
| `REDIS_URL` | 建議 | 留空則每個 worker 各用記憶體，變更密碼的猜測次數各算各的 |
| `CSRF_TRUSTED_ORIGINS` | 視情況 | 含 scheme 的對外來源（`https://qip.example.org`）。同源代理下通常不必填；平台改寫了 Host 或 scheme、POST 被擋時才填 |
| `SECURE_HSTS_SECONDS`、`NEXT_HSTS_SECONDS`（build） | 否 | HTTPS 確認可用後再分段調高，見 §7-3 |
| `SESSION_COOKIE_SECURE`、`CSRF_COOKIE_SECURE` | 否（預設 true） | 上線不要動 |
| `PORT`、`GUNICORN_WORKERS`、`GUNICORN_TIMEOUT` | 否 | 預設 8000／3／120 |
| `RUN_BOOTSTRAP` | 否（預設 1） | 只有 `0`、`false`、`no`（不分大小寫）才略過啟動程序；其他值（包含留空）都照常執行 |
| `WEB_PORT`、`WEB_BIND` | 否 | 只給 `docker-compose.prod.yml`：web 發佈的埠（預設 3000）與綁定的位址（預設 `0.0.0.0`；本機試跑用 `127.0.0.1`） |

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

`GET /healthz`：不需登入，資料庫可連就回 200 `{"status":"ok"}`，否則 503（內容不說原因，原因寫在 log）。探針的 Host 要在 `DJANGO_ALLOWED_HOSTS` 內——平台若用 Pod IP 或內部名稱當 Host，把它加進去，或讓探針帶 `Host: localhost`。

## 5. 對外行為

- **代理標頭**：TLS 在平台邊緣結束，邊緣必須送 `X-Forwarded-Proto: https` 並**覆寫**客戶端自帶的值；Next 14.2 的 `/api` 代理原樣轉送 `X-Forwarded-Proto`、`X-Forwarded-For`，只把 `X-Forwarded-Host` 設成它收到的 Host。Django 取 `X-Forwarded-Proto` 逗號分隔的第一個值（`SECURE_PROXY_SSL_HEADER`）。
- **日誌**：全部寫 stdout／stderr（gunicorn access log、`django.request` 的 4xx／5xx 含 traceback、`axes` 的登入失敗與鎖定），交給平台收集。
- **靜態檔**：admin 用的 CSS／JS 在 build 時 `collectstatic`，由 WhiteNoise 在 `/static/` 提供。上傳的檔案（`/app/media`）**不會**被對外提供。
- **JSON 專用**：prod 的 DRF 只輸出 JSON（沒有可瀏覽的 API 頁面）。
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
8. **其他。** gunicorn worker 數（`GUNICORN_WORKERS`）依 CPU 與記憶體調整；Redis 沒有連線逾時，Redis 卡住時變更密碼的猜測計數會等（P8 處理）；平台若覆寫 `HOSTNAME`（例如 Kubernetes 會把它設成 Pod 名稱），Next 會只聽那個位址：在 web 的環境設 `HOSTNAME=0.0.0.0`；映像掃描與依賴更新（`npm audit` 目前有已知漏洞的依賴，未處理；Python 相依在 `requirements.txt` 沒有鎖版本，每次 build 取當下最新）；日誌收集與告警。

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
