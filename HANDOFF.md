# HANDOFF 2026-10-12（P9 進行中）

## P10 待審：同仁上線前測試（UAT）的無 node 綠色版 — branch `feat/uat-portable`（2026-10-13，PR 見 GitHub）

- 背景與拍板（計畫檔 `C:\Users\akcho\.claude\plans\deep-chasing-thompson.md` 最上方）：院內電腦不能互相連線、node.exe 跑不起來、Python 只能嵌入式、無管理員 → 每位同仁各跑一份綠色版；前端靜態匯出由 Django（嵌入式 Python＋waitress）供應；資料庫＝可攜 PostgreSQL 16（探路包 2026-10-13 07:38 在院內網域電腦實證三段 OK）；登入用本地帳號（包內 `LDAP_ENABLED=false`、無 AD 帳密）。
- 已完成：靜態匯出模式（152 頁）、探路包、`FRONTEND_DIST_DIR`、嵌入式 runtime、`uat_seed_testers`（內建角色帳號 `uat_*`＋demo 重設＋scrub）、`build-uat-portable.ps1`、`start.bat`／`stop.bat`／`launcher.py`、`verify-uat-portable.py`（51 項全過：三次啟停、8011→8012 換埠、鎖定、填報→送審→審核流程、崩潰後復原）、`docs/UAT_GUIDE.md`（§9 說明如何在品管中心自己的那份包上開 AD 驗證）。master（含 P9 AD 登入）已合併進本分支。
- 產出（不入庫）：`local-data/uat/qip-uat-portable-20261013.zip`（85 MB，含 `.sha256`）、`local-data/uat/uat-testers-passwords-20261013.md`（admin 與角色帳號密碼，只給品管中心）、`local-data/uat/qip-probe-20261012.zip`。
- 下一步：(1) 使用者在一台院內電腦解壓實跑（`docs/UAT_GUIDE.md` §7–§8 檢核表的「院內電腦」欄）；(2) 真 AD 驗證在使用者自己的那份包上做（§9）；(3) 發給同仁、回收 `local-data/uat-feedback.md`；(4) PR 合併後 `deploy/portable/build-uat-portable.ps1 -RebuildFrontend -Clean` 可隨時重打。
- 注意：這台開發機 8011 被 Docker（wslrelay）占用，包會自動改 8012；嵌入式 Python 不讀 PYTHONPATH（`launcher.py` 負責 `sys.path`）；中文 Windows 預設 cp950 → bat 一律 `python -X utf8`；打包會把開發資料庫的達文西逐案一起複製（`-DropDavinciCases` 可清）。

