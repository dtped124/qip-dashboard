# HANDOFF 2026-10-11 16:10
- 任務：qip-dashboard 上雲＋角色分流（8 phase，一 phase 一 branch）。計畫檔：`C:\Users\akcho\.claude\plans\streamed-weaving-spindle.md`；拍板決策見記憶 `project_cloud_role_rollout.md`。
- 已完成：**P1 `feat/same-origin-api`**——`lib/http.ts` 統一 HTTP client（cookie + CSRF + 錯誤解析 + 下載）、`next.config.mjs` 以 rewrites 代理 `/api/*`（`API_INTERNAL_URL`，build 時固化）、前端全部改相對路徑、Django `USE_X_FORWARDED_HOST`（base.py，env 可關）、`auth_me` 發 csrftoken、TCPI POST 改讀 `request.data`。
  驗證：`next build` 通過；curl 經 proxy：尾斜線 GET 200 無轉址、登入 200、無 CSRF 的 POST 403、有 CSRF 200、PATCH target 200；瀏覽器：登入→儀表板 36 卡、匯出要素清單 200、達文西頁 200；TCPI POST 以 Django test client 在回滾交易內驗 403/200/400。fresh agent 審查退回的兩點（caller headers 可蓋 CSRF、env 空字串）已修。
- 下一步：**P2 `feat/backend-permissions`**（從 master 開分支）：新增 `viewer` 角色、`apps/accounts/permissions.py`、DRF 預設 `IsAuthenticated`、移除 `csrf_exempt`、權限矩陣逐端點、`test_permissions.py`。上線前先盤點既有帳號補 viewer。
  P2 順手修：`imports/views.py` 上傳非 Excel 會 500（BadZipFile 未捕捉，直打 8001 亦同，非 P1 造成）。
- 卡點 / 事故：P1 驗證時用 curl 回寫 TCPI，端點是「先全刪再新增」，Git Bash 文字管線把中文弄成 surrogate 致新增失敗，**40 筆 TCPI 標竿被清空**；已從 `../qip-portable/public/data/qip-export.json`（2026-10-09 匯出）還原 40 筆並核對中文正常。備份：scratchpad `tcpi-backup-40rows.json`。教訓已寫 `~/.claude/agent-ops/LESSONS.md`（2026-10-11）。**之後任何寫入驗證一律用 test client 回滾或先備份。**
- 相關檔案：`lib/http.ts`、`next.config.mjs`、`backend/config/settings/base.py`、`backend/apps/indicators/views.py`（tcpi_benchmarks）、`.env.local`（已移除 NEXT_PUBLIC_API_URL；設了會繞過代理）。
- 環境：根目錄 `docker compose up -d`（postgres 5433 / redis 6380 / api 8001）；前端 `preview_start qip-dev`（3000）。測試帳號用 `seed_admin` 的預設值（P3 會移除寫死密碼）。
