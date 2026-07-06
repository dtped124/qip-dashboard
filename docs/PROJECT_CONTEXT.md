# QIP 持續性監測指標儀表板 - 專案說明

## 📋 專案概述

本系統為**臺大醫院新竹分院（含新竹、竹北、竹東三院區）品管中心**開發的品質指標持續性監測儀表板，用以取代原本以 Excel 手動管理 55+ 個 QIP（Quality Indicator Project）指標的流程。

### 系統目標
- 追蹤三院區（新竹／竹北／竹東）10 大類別共 55+ 項品質指標的月度數值
- 提供 SPC 管制圖、異常偵測、同儕標竿比較的統計引擎
- 將「每三年一次評鑑大考」轉變為「每月小測驗」的持續性品質監測
- 管理多院區的指標填報、審核、定稿流程
- 支援 Excel 匯入 / HIS 自動匯入雙路徑

### 核心理念
從**事後補救**轉為**即時監控**，從**被動評鑑**轉為**主動改善**。

### 技術架構
- **前端框架**：Next.js 14（App Router）+ React 18 + TypeScript
- **前端樣式**：TailwindCSS
- **前端狀態**：Zustand + Dexie（IndexedDB 快取）
- **圖表**：Recharts
- **文件匯出**：docx、xlsx
- **後端框架**：Django 5 + Django REST Framework
- **資料庫**：PostgreSQL（schema `qip`）/ SQLite（開發）
- **部署**：Docker Compose（後端）+ Next.js Static Export（前端）

---

## 📁 專案結構

```
C:\claude\QIP monitor\qip-dashboard\
├── app/                              # Next.js App Router
│   ├── page.tsx                      # 首頁儀表板
│   ├── category/[id]/                # 分類詳情頁
│   ├── indicators/[code]/            # 指標詳情頁
│   ├── cross-campus/                 # 跨院區季度分析
│   ├── entry/                        # 填報系統前端
│   │   ├── login/                    # 登入
│   │   ├── [category]/               # 填報面向頁
│   │   ├── case-list/                # 個案清單審查
│   │   ├── review/                   # 審核
│   │   └── admin/                    # 帳號/指派/截止日管理
│   ├── import/                       # Excel 匯入頁
│   └── settings/                     # 系統設定（TCPI、AI、指標管理）
├── components/
│   ├── dashboard/                    # 儀表板卡片、矩陣、Sparkline
│   ├── detail/                       # 指標詳情（管制圖、異常列表）
│   ├── charts/                       # Recharts 包裝元件
│   ├── entry/                        # 填報表單、審核介面
│   ├── import/                       # Excel 匯入精靈
│   ├── ai/                           # AI 分析面板
│   ├── cross-campus/                 # 跨院區比較視圖
│   ├── settings/                     # 設定頁元件
│   └── layout/                       # 版型
├── lib/
│   ├── engine/                       # 統計引擎（前端 fallback）
│   │   ├── controlChart.ts           # SPC 管制圖（P/U/I-MR/X̄-R）
│   │   ├── anomalyDetector.ts        # Nelson Rule / 月增減 / 同儕
│   │   ├── monthlyChange.ts
│   │   └── peerComparison.ts
│   ├── db/                           # Dexie IndexedDB
│   ├── store/                        # Zustand store
│   ├── api.ts                        # 後端 API client
│   ├── matching/                     # 指標名稱模糊比對
│   ├── ai/                           # Claude API 串接
│   ├── export/                       # Word/Excel 匯出
│   ├── entry/                        # 填報端共用邏輯
│   ├── aggregation.ts                # 月→季彙總
│   └── tcpi-parser.ts                # TCPI 標竿解析
├── backend/
│   ├── manage.py
│   ├── config/
│   │   ├── settings/{base,dev,prod}.py
│   │   └── urls.py                   # 所有 URL 掛載
│   ├── apps/
│   │   ├── accounts/                 # 自訂 User（employee_id 登入）
│   │   ├── indicators/               # Indicator、DataPoint、YearlySummary、TCPI、Alert
│   │   ├── imports/                  # ImportLog、MatchingRule + Excel parser
│   │   ├── entry/                    # 填報系統（MonthlyReport、IndicatorEntry、Case...）
│   │   └── analysis/                 # 管制圖、異常偵測、趨勢、彙總引擎
│   ├── docker-compose.yml
│   ├── docker-compose.prod.yml
│   ├── Dockerfile
│   ├── init-db.sql                   # PostgreSQL schema 建立
│   ├── requirements.txt
│   └── start.bat
├── public/
├── out/                              # Next.js static export 輸出
├── 115年平衡計分卡關鍵指標-品管中心v2.xlsx
├── docker-compose.yml
├── next.config.mjs
├── package.json
├── start.bat
└── docs/                             # 本文件夾
```

---

## 🏛️ 指標分類架構（10 大類別）

| 類別代碼 | 類別名稱 | 代表色 | 典型指標 |
|---------|---------|--------|---------|
| HA01 | 整體照護 | `#3B82F6` 藍 | 住院死亡率、14 天再住院率 |
| HA02 | 加護照護 | `#EF4444` 紅 | ICU 重返率、VAP、CAUTI、CLABSI |
| HA03 | 手術照護 | `#F97316` 橘 | 手術部位感染、預防性抗生素 |
| HA04 | 產科照護 | `#EC4899` 粉 | 剖腹產率、會陰三度以上裂傷 |
| HA05 | 急診照護 | `#8B5CF6` 紫 | 急診 72 小時內再就醫、滯留率 |
| HA06 | 重點照護 | `#06B6D4` 青 | AMI、Stroke、HF 等特定疾病 |
| HA07 | 感染管制 | `#10B981` 綠 | 手部衛生、多重抗藥性菌株 |
| HA08 | 用藥安全 | `#F59E0B` 黃 | 給藥錯誤、高警訊藥品事件 |
| HA09 | 呼吸照護 | `#6366F1` 靛 | 呼吸器脫離率 |
| HA10 | 經營管理 | `#6B7280` 灰 | 病床使用率、平均住院日 |

### 資料層級
```
Campus (院區：新竹 / 竹北 / 竹東)
  └─ Indicator (指標，如 HA01-01, HA02-11...)
       └─ DataPoint (月份資料點：年 × 月 × 分子 × 分母 × 值)
       └─ YearlySummary (年度彙總)
       └─ PeerValue / TCPIBenchmark (同儕標竿)
       └─ Alert (異常警示：管制圖 / 月增減 / 同儕比較)
```

### 填報流程層級
```
ReportCategory (HA01, HA02, ...)
  └─ MonthlyReport (院區 × 年 × 月 × 面向的填報單元)
       └─ IndicatorEntry (指標數據)
            ├─ HA10SubEntry (HA10 子類別)
            └─ CaseRecord (個案清單，適用個案清單路徑指標)
```

---

## 🎯 當前版本：v2.x

### 已完成功能

#### 核心監測功能
- ✅ 三院區儀表板（新竹／竹北／竹東切換）
- ✅ 10 大類別指標分組展示（卡片 / 矩陣 / 表格三種視圖）
- ✅ 六級燈號狀態系統（卓越 / 良好 / 留意 / 注意 / 警示 / 監測中）
- ✅ Sparkline 趨勢迷你圖（最近 24 個月）
- ✅ 月度模式 + 季度模式雙軌
- ✅ 指標詳情頁：SPC 管制圖 + 異常列表 + 年度趨勢 + 同儕比較

#### SPC 統計引擎
- ✅ **管制圖自動選型**（依資料性質）
  - `binomial_rate`（二項比率）→ P 圖
  - `poisson_rate`（Poisson 密度）→ U 圖
  - `continuous`（連續型）→ I-MR 圖（單值移動全距）
- ✅ **固定型 vs 變動型管制界線**（依分母 n 變化與否）
- ✅ **Nelson Rule 異常偵測**（1/2/3/4 sigma、連續 8 點偏向等）
- ✅ **挑戰平均值模式**（Target Mode，以目標值取代 CL/UCL/LCL 計算基準）
- ✅ **月增減異常偵測**（對比前月變動百分比）
- ✅ **同儕比較**（對比 TCPI 標竿或區域/地區醫院同儕值）
- ✅ **純計數型指標跳過 SPC**（SKIP_SPC_INDICATORS 清單）

#### 跨院區與季度分析
- ✅ **跨院區季度分析頁**（`/cross-campus`）：三院區同指標並列
- ✅ **季度彙總邏輯**（月→季，考量資料性質：比率用加權、密度用加權、計數用加總）
- ✅ **季度管制圖**（重新計算 CL/UCL/LCL）
- ✅ **年均值**（分母加權平均，非簡單平均）

#### 資料匯入
- ✅ **Excel 匯入**（支援 111-115 年 17 張工作表結構）
- ✅ **指標名稱模糊比對**（MatchingRule 記憶使用者確認）
- ✅ **新竹院區特殊解析器**（hsinchu_parser.py 處理格式差異）
- ✅ **匯入預覽 + 警告展開**（新增 / 更新 / 未變更 / 錯誤列表）
- ✅ **匯入警告直接修正**（`/api/v1/imports/correct-datapoint/`）
- ✅ **TCPI 標竿 Excel 批次匯入**
- ✅ **DB 完整匯出**（`/api/v1/indicators/export/`，供 Portable 版本載入）

#### 填報系統（v2.0 新增）
- ✅ **自訂使用者模型**（`employee_id` 為登入識別，多角色 JSONField）
- ✅ **三種角色**：reporter（填報者）/ reviewer（品管審核）/ admin（系統管理）
- ✅ **指派機制**（IndicatorAssignment：指標 × 院區 × 負責人，支援生效期間與代理人）
- ✅ **月報表頭**（MonthlyReport：院區 × 年 × 月 × 面向）
- ✅ **填報狀態流**（unfilled → draft → submitted → approved → finalized）
- ✅ **指標數據**（IndicatorEntry：分子 / 分母 / 備註 / 填報者）
- ✅ **HA10 子類別明細**（HA10SubEntry）
- ✅ **個案清單路徑**（CaseRecord + ExclusionReason，品管中心審核排除）
- ✅ **修改紀錄**（EntryAuditLog，欄位級別異動軌跡）
- ✅ **截止日設定**（DeadlineSetting：可逐月調整，支援春節延長等備註）
- ✅ **審核流**（送審 / 退回 / 核准 / 定稿 / 解鎖）
- ✅ **HIS 串接預留**（DataSourceConfig + HISFieldMapping，webhook 端點已建立）

#### TCPI 標竿管理
- ✅ **TCPI Excel 解析**（tcpi-parser.ts）
- ✅ **TCPI 批次匯入 API**（先清後寫）
- ✅ **三層醫院標竿**（醫學中心 / 區域醫院 / 地區醫院，依院區自動選用）

#### AI 分析
- ✅ **Claude API 整合**（章節 8.6 規劃）
- ✅ **AI 深度分析面板**（指標詳情頁）
- ✅ **AI 季度報告摘要**

#### 其他功能
- ✅ **Word 報告匯出**（docx）
- ✅ **Excel 匯出**（匯出所有資料供 Portable 載入）
- ✅ **IndexedDB 本地快取**（Dexie，支援離線瀏覽）
- ✅ **Static Export 部署**（Next.js `next export` 純前端版本）

### 指標統計（55+ 項）

| 類別 | 指標數 | 資料性質 |
|------|--------|---------|
| HA01 整體照護 | 3 | binomial_rate |
| HA02 加護照護 | 6+ | binomial_rate / poisson_rate |
| HA03 手術照護 | 4+ | binomial_rate |
| HA04 產科照護 | 3+ | binomial_rate |
| HA05 急診照護 | 3+ | binomial_rate |
| HA06 重點照護 | 10+ | 混合 |
| HA07 感染管制 | 4+ | binomial_rate / poisson_rate |
| HA08 用藥安全 | 3+ | continuous / binomial_rate |
| HA09 呼吸照護 | 2+ | binomial_rate |
| HA10 經營管理 | 10+ | continuous |
| **總計** | **55+** | |

### 院區適用性
- **全院區指標**（ALL_CAMPUSES）：新竹 + 竹北 + 竹東
- **竹北 + 新竹**（ZHUBEI_HSINCHU）
- **竹東 + 新竹**（ZHUDONG_HSINCHU）
- **新竹限定**（HSINCHU_ONLY，如部分需醫學中心規模才有的指標）

---

## 👥 使用者角色

| 角色 | `roles` 值 | 說明 |
|------|----------|------|
| **系統管理員** | `admin` | 完整權限，管理帳號、指派、截止日、匯入 |
| **品管中心審核者** | `reviewer` | 審核月報、核准定稿、排除個案審核 |
| **指標填報者** | `reporter` | 填寫自己被指派的指標，上傳佐證 |

> 單一帳號可同時擁有多個角色（`roles` 為 JSON 陣列，如 `["reporter", "reviewer"]`）。

### 登入識別
- **帳號**：員工編號（`employee_id`），非 username
- **初始密碼**：員工編號，首次登入強制更改
- **管理員帳號**：由 `createsuperuser` 建立，或透過匯入腳本建立

---

## 🔌 後端 API 基礎路徑總覽

| Blueprint | URL 前綴 | 用途 |
|-----------|---------|------|
| accounts | `/api/auth/` | 登入 / 登出 / 改密碼 |
| indicators | `/api/v1/indicators/` | 指標 CRUD、月資料、分析 |
| imports | `/api/v1/imports/` | Excel 匯入、匯入紀錄 |
| dashboard | `/api/v1/dashboard/` | 儀表板批次載入 |
| tcpi | `/api/v1/tcpi/` | TCPI 標竿管理 |
| admin (accounts) | `/api/admin/users` | 使用者管理 |
| admin (assign) | `/api/admin/assignments` | 指派管理 |
| admin (deadline) | `/api/admin/deadlines` | 截止日設定 |
| entry | `/api/entry/` | 填報（my-tasks、form、save-draft、submit） |
| review | `/api/review/` | 審核（overview、approve、reject、finalize、unlock） |
| import | `/api/import/` | 填報系統匯入（excel、his-trigger、his-webhook） |
| case-list | `/api/case-list/` | 個案清單管理 |
| dashboard (entry) | `/api/dashboard/` | 填報系統版儀表板資料 |

---

## 📞 聯絡資訊

- **維護單位**：臺大醫院新竹分院 品管中心
- **用途**：115 年度起持續性品質指標監測
- **負責人**：AnKuo
