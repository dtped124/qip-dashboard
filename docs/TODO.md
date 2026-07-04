# 待辦事項清單 (TODO)

## 🔴 高優先級

### 1. HIS 串接實作（目前為預留）

**已完成**：`DataSourceConfig`、`HISFieldMapping` 模型已建立，`/api/import/his-trigger` / `/his-webhook` 端點框架已有。

**待完成**：
- [ ] HIS REST API adapter 實作（`apps/entry/adapters/`）
- [ ] HIS CSV 匯出自動排程（cron）
- [ ] HIS DB View 直連（唯讀）
- [ ] 轉換公式引擎：`HISFieldMapping.transform_formula` 安全 eval
- [ ] 排程執行記錄：`DataSourceConfig.last_run_at` / `last_run_status` 自動更新
- [ ] 失敗重試機制
- [ ] webhook 簽章驗證

### 2. 填報系統逾期提醒

**已完成**：`DeadlineSetting` 模型、`MonthlyReport.is_late` 欄位已存在。

**待完成**：
- [ ] 每日 cron：檢查逾期未送審的月報
- [ ] 自動 Email 提醒 reporter + 其代理人
- [ ] 逾期 3 天再發提醒給 reporter 的主管（需新增 `User.supervisor` FK）
- [ ] 月末總結：寄給 admin 逾期統計
- [ ] 儀表板首頁顯示「本月逾期 X 張月報」

### 3. 樂觀鎖防並發覆寫

**問題**：兩位 reporter 同時編輯同一 `IndicatorEntry`，後存者會覆蓋前存者。

- [ ] `IndicatorEntry` 新增 `updated_at` 檢查（類似 medical-center-tracker 的 `check_optimistic_lock`）
- [ ] 前端表單帶 `if_unmodified_since`
- [ ] 衝突時提示「已被他人修改，請重新載入」

---

### 4. 指標管理頁面完善

**已完成**：基本 CRUD、挑戰平均值開關。

**待完成**：
- [ ] 指標自訂（admin 可新增自訂指標，非 INDICATOR_META 預設）
- [ ] 別名管理（`aliases` 陣列的 UI）
- [ ] 跳過 SPC 清單管理（移至資料庫而非 constants.py）
- [ ] 院區適用性調整（目前在 `INDICATOR_META` 寫死）

### 5. AI 分析功能擴充

**已完成**：指標詳情頁的 AI 面板、跨院區季度 AI 摘要。

**待完成**：
- [ ] AI 回應快取（類似 medical-center-tracker 的 `AiResponseCache`）
- [ ] 月度品管會議報告自動生成（Word 格式）
- [ ] AI 改善建議歷史追蹤（同指標建議的演進）
- [ ] Claude Opus / Sonnet / Haiku 切換設定

---

## 🟡 中優先級

### 6. 匯出功能擴充
- [ ] 匯出某院區全部指標的 PDF 報告
- [ ] 匯出某年度全院區彙總 Excel
- [ ] 匯出填報系統月報 Excel（供離線審閱）

### 7. 權限細化
- [ ] reporter 的院區範圍限定（目前在前端過濾，應於 API 層強制）
- [ ] reviewer 的面向範圍（某 reviewer 只審 HA02 加護照護）
- [ ] 資料查看權限：敏感指標（如醫療糾紛）限特定角色

### 8. 使用者管理完善
- [ ] Excel 批次匯入使用者（從 HR 系統員工名單）
- [ ] 帳號停用流程（保留歷史操作，禁止登入）
- [ ] 密碼強度驗證（8+字元、大小寫、數字）
- [ ] 連續失敗鎖定（5 次 30 分鐘，類似 medical-center-tracker）

### 9. 操作日誌
- [ ] 全系統 `activity_logs` 表（登入、改指派、改截止日、匯入、解鎖定稿）
- [ ] admin 介面 `/settings/activity-logs`
- [ ] IP、User-Agent 記錄

### 10. 資料備份
- [ ] `/settings/backup`：一鍵 pg_dump
- [ ] 備份排程（每日 02:00 UTC+8）
- [ ] 從備份還原（admin 限定，高風險）
- [ ] 保留 30 天

---

## 🟢 低優先級

### 11. UI/UX
- [ ] 深色模式
- [ ] 行動裝置優化（目前僅桌面）
- [ ] 鍵盤快捷鍵（匯入、切換院區）
- [ ] 儀表板自訂（使用者釘選常看指標）
- [ ] 列印樣式（CSS `@media print`）

### 12. 圖表強化
- [ ] 管制圖可匯出為 PNG / SVG
- [ ] 年度趨勢圖疊加標竿線
- [ ] 熱力圖檢視（55 指標 × 12 月 × 3 院區）
- [ ] 雷達圖（多維度比較）

### 13. 國際化
- [ ] 英文介面（目前僅繁中）

### 14. 效能
- [ ] 儀表板 `/api/v1/dashboard/` 快取（redis）
- [ ] Indicator.PATCH 後的 `_refresh_indicator_alerts()` 改非同步（celery）
- [ ] 大量匯入改用 `bulk_create` + `update_fields`

---

## ✅ 已完成

### v2.x (2026-04)
- [x] **挑戰平均值模式**（`Indicator.target_mode` / `target_value`）
- [x] **年均值改用分母加權平均**
- [x] **匯入警告可展開並單筆修正**
- [x] **DB 匯出端點**（`/api/v1/indicators/export/`）
- [x] **指派解析修正 + 管制圖 / 填報 bug 修**

### v2.0 — 填報系統完整實作
- [x] 自訂使用者模型（`employee_id` 登入、多角色）
- [x] 帳號管理 API（CRUD、重設密碼）
- [x] 院區 / 面向模型（Campus、ReportCategory）
- [x] 指標負責人指派（primary / deputy、生效期間）
- [x] 月報表頭（5 階段狀態流）
- [x] 指標數據填寫（分子 / 分母 / 備註）
- [x] HA10 子類別明細（13 項）
- [x] 個案清單路徑（CaseRecord + ExclusionReason，二階段審核）
- [x] 修改紀錄（EntryAuditLog）
- [x] 填報截止日（DeadlineSetting）
- [x] 填報系統匯入（Excel + HIS webhook 預留）
- [x] 審核 API（overview / approve / reject / edit-entry / finalize / unlock）

### v1.x — AI 與 Word 匯出
- [x] Word 報告匯出（docx）
- [x] 季平均計算（依 data_nature 分流）
- [x] AI 解析修正
- [x] 跨院區季度分析頁（`/cross-campus`）
- [x] 季度管制圖
- [x] AI 深度分析整合（Claude API）

### v1.x — Django 後端遷移
- [x] 從純前端遷移至 Django REST 後端
- [x] PostgreSQL schema `qip`
- [x] Docker Compose 部署
- [x] 統計引擎 Python 移植

### v1.0 — 儀表板初版
- [x] Next.js 14 App Router
- [x] 三院區儀表板（卡片 / 矩陣 / 表格三種視圖）
- [x] 指標詳情頁（管制圖 + 異常列表）
- [x] SPC 統計引擎（P/U/I-MR + Nelson Rule）
- [x] Excel 匯入（17 張工作表 + 新竹特殊解析）
- [x] 指標名稱模糊比對 + 記憶
- [x] TCPI 標竿批次匯入
- [x] 六級燈號系統
- [x] IndexedDB 本地快取

---

## 💡 未來構想

### 1. 院區間自動比較提醒
- 某指標在 A 院區惡化，但 B 院區改善 → 自動提醒「可以互相學習」
- 引入改善因子分析（用 AI 對比兩院區的做法差異）

### 2. 品管會議自動議程生成
- 每季自動整理出「需討論的指標清單」：惡化超過 3 個月、跨院區差異大、低於同儕 20%
- 生成 Word 議程供品管主任列印

### 3. 指標關聯分析
- 指標之間的相關性（如 VAP ↑ 往往伴隨 ICU 住院日 ↑）
- 找出 leading indicator vs lagging indicator

### 4. 行動裝置 App
- 委員會前 30 秒看重點（React Native）
- push 通知：本月警示指標

### 5. 其他品質系統整合
- 與醫院 eKPI 平台整合
- 與 TCPI 原始系統 API 直連（取代 Excel 匯入）

---

## 📝 備註

- 每次部署後請更新 `CHANGELOG.md`
- 資料庫結構變更需先 `makemigrations` 並在 staging 驗證
- 重大功能請先在測試資料庫跑 regression
- AI 相關功能需設定 `ANTHROPIC_API_KEY` 環境變數
