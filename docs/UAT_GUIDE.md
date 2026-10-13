# 同仁測試包（免安裝綠色版）操作手冊

> 對象：品管中心（打包、發放、回收的人）。目的：讓院內同仁在**不能安裝程式、不能互相連線、跑不起 node** 的醫院電腦上，解壓縮後雙擊就能測整套 qip-dashboard。
> 設計與決策見計畫檔 `~/.claude/plans/deep-chasing-thompson.md`（方案 C）；技術細節見 `deploy/portable/README.md`。

## 1. 包裡有什麼

```
qip-uat-portable-<日期>\
  start.bat / stop.bat            雙擊啟動／停止（不需系統管理員、不開 PowerShell）
  README-同仁測試說明.txt          給同仁的說明（含測試帳號與密碼、測試流程、回報格式）
  BUILD-INFO.txt                  版本（commit、日期、資料來源）
  runtime\python\                 Python 3.12 嵌入式版＋套件（Django、waitress、psycopg、numpy…）
  runtime\pgsql\                  可攜 PostgreSQL 16（bin、lib、share）
  app\web\out\                    Next.js 靜態匯出（由 Django 從 / 供應）
  app\backend\                    Django 程式（不含 tests、venv）＋ .env（打包時產生）
  app\launcher.py                 啟動器（serve／manage／health）
  data\pgdata\                    已還原開發資料、建好帳號的資料庫
  data\media\  logs\
```

* 同仁電腦上實際執行的只有 `python.exe`（Django＋waitress）與 PostgreSQL 的 `postgres.exe` 家族；都只綁 `127.0.0.1`（Django 預設 8011，被占用自動改 8012–8015；PostgreSQL 5499）。
* 登入用本地帳號；**包內沒有 AD 設定與任何 AD 帳密**（`LDAP_ENABLED=false`）。`.env` 內只有包內資料庫的隨機密碼與每次打包重新產生的 `DJANGO_SECRET_KEY`。
* 包內預建的帳號：
  * 共用角色帳號 `uat_viewer`／`uat_reporter_num`／`uat_reporter_den`／`uat_reporter_both`／`uat_reviewer`／`uat_admin`（密碼各自隨機 12 字，**不強制改密碼**，寫在包內 README，同仁換角色測用）；
  * 示範帳號 `demo_a`／`demo_b`／`demo_r`（密碼每次打包重設，同樣寫在 README）；
  * `admin`：**只給你本人**，密碼只在密碼檔，首次登入須改密碼；
  * 若有提供名單：每位同仁一個個人帳號（臨時密碼，首次登入須改，**不在包內**）。
  * 開發資料庫裡其他帳號（真實員編）的密碼雜湊已全部作廢（`set_unusable_password`），axes 紀錄與 session 已清空。

### 角色帳號與指派（竹北院區）

| 帳號 | 角色 | 指派 |
|---|---|---|
| `uat_viewer` | 檢視者 | — |
| `uat_reporter_num` | 填報者＋檢視者 | HA03-01 分子、HA03-02 分子 |
| `uat_reporter_den` | 填報者 | HA03-01 分母、HA03-02 分母 |
| `uat_reporter_both` | 填報者＋檢視者 | HA01-01 分子與分母、HA01-02 分子與分母 |
| `uat_reviewer` | 審核者＋檢視者 | — |
| `uat_admin` | 系統管理員 | — |
| `demo_a`／`demo_b` | 填報者 | 竹北 HA03-01／02／03 的分子（甲）、分母（乙） |
| `demo_r` | 審核者＋檢視者 | — |

> 送審規則：同一院區、同一面向**所有已指派的指標**都填好才能送審。HA03 面向還有 HA03-03（分子 `demo_a`、分母 `demo_b`），所以走 HA03 流程要換 `demo_a`／`demo_b` 補填；走 HA01（`uat_reporter_both`）最單純。

## 2. 準備 `uat-testers.csv`（可省略）

沒有名單也能打包（只有 admin、角色帳號、示範帳號）。要給每位同仁個人帳號時，建立 `local-data\uat-testers.csv`（UTF-8，有無 BOM 都可；Excel 另存「CSV UTF-8」）：

```csv
employee_id,full_name,roles,campus,assignments
G10001,王小明,reporter|viewer,zhubei,HA03-01:numerator|HA03-02:both
G10002,李小華,reviewer|viewer,,
```

| 欄位 | 說明 |
|---|---|
| `employee_id` | 帳號（≤20 字）；不可用 `admin`、`demo_*`、`uat_*` |
| `full_name` | 姓名 |
| `roles` | `viewer`／`reporter`／`reviewer`／`admin`，用 `|` 分隔 |
| `campus` | 院區代碼（`hsinchu`／`zhubei`／`zhudong`）或院區名稱；可空 |
| `assignments` | `指標代碼:欄位` 以 `|` 分隔，欄位為 `numerator`／`denominator`／`both`（省略 = both）；可空。需有院區與填報者角色；規則同帳號管理頁（分母只能指派給有分母的指標、同人同院區同指標不可重複涵蓋同一欄位） |

任何一列有誤，整批不寫入並指出是哪一行。同一份 CSV 重跑是冪等的（帳號更新、已存在的指派略過），但**每次打包都會重新核發臨時密碼**。

## 3. 打包

前置：`build-runtime.ps1` 做過一次（`local-data\runtime-cache\runtime-full`）、快取內有 PostgreSQL zip（探路包用過）、開發堆疊的 postgres 容器在跑（只做唯讀的 `pg_dump`）、C: 剩餘空間 ≥ 15 GB。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File deploy\portable\build-uat-portable.ps1 `
    [-TestersCsv local-data\uat-testers.csv] [-AdminPassword "<字串>"] [-DropDavinciCases] [-Clean]
```

* 約 3–5 分鐘（前端若比最後一次前端 commit 舊會先 `npm run build:export`）。
* 結束會印 zip 路徑、大小、SHA256（同時寫 `.sha256`）、帳號數、是否清掉達文西逐案。**不會印任何密碼**。
* 輸出（都在 `local-data`，已被 gitignore）：
  * `local-data\uat\qip-uat-portable-<日期>.zip`（＋`.sha256`）
  * `local-data\uat\uat-testers-passwords-<日期>.md` ← **密碼檔，不在包內**，含 admin、角色帳號、示範帳號、個人帳號
  * `local-data\runtime-cache\stage-uat\` ← 組裝資料夾，保留供比對；下次打包會重建，`-Clean` 可在完成後刪除
* `-DropDavinciCases`：清空 `davinci_cases`（達文西逐人次，含遮罩病歷號）；月彙總 `davinci_indicator_values` 與匯入紀錄保留。預設關＝完整複製資料。**院內資料外流風險高時請開。**
* 包內不含：Excel／CSV、`.env.prod*`、`tests`、`venv`、pytest、`local-data`。腳本在壓縮前會掃描，發現就中止。

## 4. 發放

1. 先用 §7 的驗收腳本在自己的電腦跑一次（綠燈才發）。
2. 把 zip 放到院內共用資料夾或隨身碟，**記錄發給誰、哪個版本（BUILD-INFO.txt 或 zip 的 SHA256）**。
3. 通知同仁：解壓到 `C:\qip-uat\`，照包內 `README-同仁測試說明.txt` 做；個人帳號與臨時密碼（若有）從密碼檔**只把那一行**私下給本人。
4. `admin` 的密碼不要給同仁。`uat_admin` 讓同仁看帳號管理頁與指派頁。

## 5. 同仁要做什麼

解壓 → 雙擊 `start.bat` → 瀏覽器自動開登入頁 → 依 README 的流程換帳號走一遍（填分子 → 填分母 → 送審 → 審核者退回／核准 → 檢視者看儀表板 → 管理者看帳號與指派頁）→ 測密碼鎖定與錯誤訊息 → `stop.bat` → 刪資料夾。問題用 README 的格式回報（截圖、步驟、時間、`logs\` 資料夾）。

## 6. 回收問題與收尾

* 彙整到 `local-data\uat-feedback.md`，開下一個 phase。同仁回傳的 `logs\` 看 `django.log`、`bootstrap.log`、`postgres.log`、`pg_ctl.log`。
* 每台電腦的資料各自獨立；問題重現要附 `logs\` 與版本（BUILD-INFO）。
* 測試結束：請同仁**刪除整個資料夾**（內含院內資料）並回覆；對照發放紀錄逐一確認。
* 密碼檔 `uat-testers-passwords-<日期>.md` 與舊的 zip 在確認不再使用後刪除。

## 7. 本機驗收（打包後必做）

```powershell
python deploy\portable\verify-uat-portable.py --zip local-data\uat\qip-uat-portable-<日期>.zip `
    --passwords local-data\uat\uat-testers-passwords-<日期>.md --work <空的暫存資料夾> --expect-port-fallback
```

從 **zip** 解開（不是 staging），用 `cmd /c start.bat`／`stop.bat`（最後的 pause 以 Enter 餵過，等同雙擊）依序驗證：頁面與 API（含密碼閘門、角色帳號、完整填報→送審→退回→核准流程）、密碼鎖定、停止後沒有殘留的 python／postgres 與監聽埠、再啟動資料仍在、重複雙擊 `start.bat`、強制終止後的當機復原。`--expect-port-fallback` 用於本機 8011 被 Docker 占用時，確認自動改用 8012。結果摘要見下表。

## 8. 免安裝檢核清單（計畫檔「免安裝（隨開即用）」逐項）

「本機實測」＝在開發機從 zip 解開跑 `verify-uat-portable.py` 的結果（日期見 BUILD-INFO）；「院內電腦」欄待在一台院內網域電腦實測後填寫。

| # | 項目 | 本機實測 | 院內電腦 |
|---|---|---|---|
| 1 | 不需系統管理員：不跑安裝程式、不寫登錄檔、不改 PATH／環境變數、不建服務、不開防火牆規則 | 結構上成立（只解壓縮與執行包內 exe；`start.bat` 僅設定自己行程的環境變數）；未做登錄檔差異比對 | |
| 2 | 不需事先裝任何東西（Python 嵌入式自帶 runtime；PostgreSQL 的 DLL 在 `bin\`） | Python 與 numpy／psycopg 自帶 VC 執行階段；**PostgreSQL 依賴系統的 `msvcp140.dll`／`vcruntime140.dll`，未隨包附帶**（探路包在院內電腦已證明可跑） | |
| 3 | 只綁 127.0.0.1（不觸發防火牆彈窗） | `netstat` 的 LISTENING 只有 `127.0.0.1:<Django 埠>` 與 `127.0.0.1:5499`；Windows 防火牆彈窗未驗證（需在無管理員的電腦上看） | |
| 4 | 相對路徑；資料與 log 都在資料夾內 | 解在任意資料夾（含路徑很長的暫存資料夾）即可跑；資料、log、pid 都在包內 | |
| 5 | 第一次啟動不下載、不 `pip install`；雙擊到登入頁 < 60 秒 | `start.bat` 到 `/healthz` 200：第一次約 36 秒（沒有 `__pycache__`，第一次要編譯 .pyc）；之後約 8–12 秒 | |
| 6 | 雙擊 `start.bat` 即可；`stop.bat` 停止；移除＝刪資料夾 | `cmd /c start.bat`／`stop.bat`（pause 以 Enter 餵過）exit 0；`stop.bat` 約 1 秒 | |
| 7 | 重複啟動無殘留程序；異常關機後能自我復原（`postmaster.pid` 殘留） | 三次啟動／停止後 `tasklist` 無包內 python／postgres、無 LISTENING、無 `postmaster.pid`；重複雙擊只重開瀏覽器；強制終止後再啟動會移除殘留 `postmaster.pid` 並恢復 | |

### 本機驗收結果（`verify-uat-portable.py`，2026-10-13，51 項全過）

| 項目 | 結果 | 秒數 |
|---|---|---|
| 解 zip（10217 檔） | OK | 18 |
| 本機 8011 被 Docker 占用 → 自動改 8012 | 發生了（訊息「port 8011 is in use … using port 8012」，`/healthz` 在 8012 回 200） | — |
| start.bat → /healthz 200（第一次／第二次／第三次） | 200 | 35.9／9.7／9.2 |
| `/`、`/entry/login/`、`/_next/static/*.js`、`/static/admin/css/base.css` | 200 | — |
| `/api/auth/options` | 404（此分支未含 AD 登入，PR #16 合併後應回 `ldap_enabled=false`） | — |
| `/api/auth/me`（未登入） | 403 | — |
| admin 登入 → `/api/v1/dashboard/` | 200 且 `must_change_password=true` → dashboard 403 `password_change_required`（閘門在） | — |
| 角色帳號 6 個＋示範帳號 3 個登入 | 200，`must_change_password=false`，角色正確 | — |
| `uat_viewer` 儀表板／填報 API | 200／403 | — |
| `uat_admin` 帳號清單、指派清單 | 200 | — |
| 流程 HA01：`uat_reporter_both` 暫存 → 送審 → `uat_reviewer` 核准 | 200／200／200 | — |
| 流程 HA03（115/11）：分子帳號、分母帳號暫存 → 送審被擋（400 `incomplete`，HA03-03 未填）→ `demo_a`／`demo_b` 補填 → 送審 → 退回 → 重送 → 核准 | 全部符合 | — |
| 密碼錯 5 次 | 第 5 次 429，之後正確密碼也 429；重啟後仍鎖定 | — |
| 個人帳號首次登入改密碼（需用 `-TestersCsv` 打包；已用範例名單驗證一次） | 200 → 改密碼 200 → 儀表板 200；重啟後新密碼仍有效 | — |
| stop.bat 後 | 無包內 python／postgres、8012／5499 無 LISTENING、無 `postmaster.pid` | 0.6–1.0 |
| 再啟動後資料 | 帳號數相同、已核准報表仍在 | — |
| 強制終止後再啟動 | 殘留 `postmaster.pid` 被移除，登入頁 200 | 16 |

## 9. 只在品管中心自己的電腦上：用綠色版做真 AD 登入驗證（選用）

同仁版的包**不含任何 AD 設定**。要在院內網域電腦上驗證 AD 登入（Phase 9），只在你自己那一份解壓後的包裡做，**不要把改過的包發給同仁**：

1. 用文字編輯器開 `appackend\.env`，在最後加上（值向資訊室或醫中系統的設定取得；鍵名與醫中系統相同）：
   ```
   LDAP_ENABLED=true
   LDAP_SERVER_IP=
   LDAP_PORT=389
   LDAP_BIND_USER=
   LDAP_BIND_PASS=
   LDAP_BASE_DN=
   LDAP_LOCAL_ONLY_ACCOUNTS=admin,uat_viewer,uat_reporter_num,uat_reporter_den,uat_reporter_both,uat_reviewer,uat_admin,demo_a,demo_b,demo_r
   ```
   `LDAP_LOCAL_ONLY_ACCOUNTS` 把包內的本地測試帳號全部列進去，它們才不會被 AD 擋住；其他帳號（例如你自己的員編）一律走 AD。值含 `$`、`#` 或空白時整個用單引號包起來。
2. `stop.bat` 再 `start.bat`；視窗裡要看到 `[bootstrap] AD 驗證：啟用（…）`。看到「未啟用」代表 `.env` 沒生效。
3. 服務帳號與查詢測試（不送任何使用者密碼）：在包的根目錄開 `cmd`，執行
   ```
   runtime\python\python.exe -X utf8 -c "import sys, runpy; sys.path.insert(0, r'appackend'); sys.argv=['manage.py','ldap_check','--user','<你的員編>']; runpy.run_path(r'appackend\manage.py', run_name='__main__')"
   ```
   （`manage.py` 讀 `appackend\.env`；`--audit` 會列出本地啟用帳號在 AD 查無者。）
4. 瀏覽器實測：先用 `admin` 在帳號管理頁建一個與你員編相同的帳號（角色隨意、不設密碼）；登出後用員編＋AD 密碼登入 → 應成功且不被要求改密碼；AD 密碼打錯 → 「帳號或密碼錯誤」，5 次鎖 5 分鐘（解鎖：`unlock_account <員編>`，呼叫方式同第 3 步把 `ldap_check` 換成 `unlock_account`）；系統沒建帳號的員編 → 「AD 驗證成功，但系統尚未開通此帳號，請洽品管中心」。
5. 測完把 `.env` 裡的 LDAP 五行刪掉或 `LDAP_ENABLED=false`，再 `stop.bat`／`start.bat`。結果照 `docs/ACCEPTANCE_GUIDE.md` §7A 勾選。
