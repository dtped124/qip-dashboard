# QIP 持續性監測指標儀表板 — 工作說明書

> **版本**：v2.0 | **日期**：2026-03-24
> **目的**：提供完整的系統規格與架構描述，作為與 Claude Chat 討論後續程式擴充的基礎文件
> **v2.0 變更**：全面更新為 Django REST Backend 架構、新增三院區支援（新竹/竹北/竹東）、三機制異常偵測系統、Zustand 狀態管理、Docker Compose 部署

---

## 一、專案背景

本系統為台灣某區域教學醫院（新竹院區、竹北院區、竹東院區）的品管中心所開發。醫院需在 2027 年接受醫學中心評鑑，需要一套視覺化儀表板來呈現 110 年至 115 年（民國年）的持續性監測指標（QIP）數據，供院長、副院長、科主任快速判讀指標狀態、趨勢與標竿比較。

**三個院區的評鑑層級**：
| 院區 | 評鑑層級 | TCPI 標竿對照 |
|---|---|---|
| **新竹**（兩院區合併） | 醫學中心（2027 年目標升格） | 醫學中心同儕值 |
| **竹北** | 區域醫院 | 區域醫院同儕值 |
| **竹東** | 地區醫院 | 地區醫院同儕值 |

---

## 二、技術架構（現行）

### 2.1 技術棧

```
前端 (Frontend):
  框架：Next.js 14.2 (App Router)
  語言：TypeScript 5
  樣式：Tailwind CSS 3.4
  圖表：Recharts 3.7
  狀態管理：Zustand 5.0
  圖標：Lucide React 0.575
  Excel 解析：SheetJS (xlsx)  ← 前端僅保留 legacy 程式碼，實際解析已移至後端

後端 (Backend):
  框架：Django 4.x + Django REST Framework
  語言：Python 3.x
  資料庫：PostgreSQL 16 (schema: qip)
  快取：Redis 7
  部署：Docker Compose

通訊：
  前端 → 後端：REST API (http://localhost:8001/api/v1/)
  環境變數：NEXT_PUBLIC_API_URL=http://localhost:8001
```

### 2.2 專案結構（現行）

```
qip-dashboard/
├── app/                              # Next.js App Router 頁面
│   ├── layout.tsx                   # 根 Layout（引入 ClientLayout）
│   ├── page.tsx                     # 首頁（總覽儀表板）
│   ├── globals.css                  # Tailwind + 自訂樣式
│   ├── import/
│   │   └── page.tsx                # 資料匯入頁（含匯入歷史）
│   ├── indicators/
│   │   └── [code]/
│   │       └── page.tsx            # 單一指標詳情頁（動態路由）
│   ├── category/
│   │   └── [id]/
│   │       └── page.tsx            # 面向分類檢視頁
│   ├── settings/
│   │   ├── page.tsx                # 設定總覽
│   │   ├── indicators/page.tsx     # 指標設定管理
│   │   └── tcpi/page.tsx           # TCPI 標竿設定
│   └── fonts/                       # 自訂字型檔
│
├── components/                      # React 元件
│   ├── charts/                     # 圖表元件
│   │   ├── ControlChart.tsx        # 管制圖（I-MR/P/U，含異常標記、σ 區域著色）
│   │   ├── YearOverlayChart.tsx    # 多年疊合趨勢圖
│   │   ├── YearCompareBar.tsx      # 年度比較長條圖
│   │   └── BenchmarkBar.tsx        # 標竿比較圖
│   ├── dashboard/                  # 儀表板元件
│   │   ├── IndicatorCard.tsx       # 指標卡片（含 sparkline、狀態、異常機制標記）
│   │   ├── StatusMatrix.tsx        # 熱力圖矩陣（滾動 12 月 / 8 季）
│   │   ├── CategorySection.tsx     # 面向分組區段
│   │   ├── OverviewStats.tsx       # 總覽統計面板
│   │   ├── StatusBadge.tsx         # 狀態燈號元件
│   │   ├── TrendArrow.tsx          # 趨勢方向箭頭
│   │   ├── Sparkline.tsx           # 迷你趨勢圖
│   │   ├── TableView.tsx           # 表格檢視模式
│   │   ├── ViewToggle.tsx          # 卡片/表格/熱力圖模式切換
│   │   └── PeriodToggle.tsx        # 月度/季度切換元件
│   ├── detail/
│   │   └── DataTable.tsx           # 完整數據表格（含年度聚合）
│   ├── import/
│   │   ├── ImportWizard.tsx        # 多步驟匯入精靈（上傳→預覽→差異→完成）
│   │   └── MatchingReview.tsx      # Excel 欄位配對預覽
│   ├── layout/
│   │   ├── ClientLayout.tsx        # 客戶端包裝器（Zustand Provider）
│   │   ├── Header.tsx              # 頂部導航列（院區選擇器、匯入按鈕）
│   │   ├── Sidebar.tsx             # 側邊導航列
│   │   └── AlertBanner.tsx         # 警示橫幅（顯示 alert 級別異常）
│   └── settings/
│       ├── IndicatorForm.tsx       # 指標新增/編輯表單
│       └── IndicatorTable.tsx      # 指標管理表格
│
├── lib/                             # 工具函式與狀態管理
│   ├── types.ts                    # TypeScript 型別定義（262 行）
│   ├── constants.ts                # 指標元資料 + 配色映射（38 項指標）
│   ├── api.ts                      # Django REST API 客戶端（340 行）
│   ├── aggregation.ts              # 月度 → 季度數據聚合
│   ├── store/
│   │   ├── dashboardStore.ts       # Zustand 全域狀態（92 行）
│   │   └── selectors.ts            # Store 選擇器函式
│   ├── db/                         # ★ Legacy — Dexie 瀏覽器資料庫（已停用）
│   │   ├── schema.ts
│   │   └── operations.ts
│   ├── engine/                     # ★ Legacy — 前端異常偵測（已移至後端）
│   │   ├── anomalyDetector.ts
│   │   ├── controlChart.ts
│   │   ├── monthlyChange.ts
│   │   └── peerComparison.ts
│   └── matching/                   # Excel 名稱正規化與配對記憶
│       ├── normalizer.ts
│       └── matchingMemory.ts
│
├── backend/                         # Django REST API
│   ├── manage.py
│   ├── config/
│   │   ├── settings/
│   │   │   ├── base.py            # 基礎設定
│   │   │   ├── dev.py             # 開發環境（DEBUG=True）
│   │   │   └── prod.py            # 正式環境
│   │   ├── urls.py                # 主路由（/api/v1/...）
│   │   └── wsgi.py
│   ├── apps/
│   │   ├── indicators/            # 指標元資料與 API
│   │   │   ├── models.py          # ORM 模型（7 個表）
│   │   │   ├── views.py           # REST 端點（11 個端點）
│   │   │   ├── serializers.py     # DRF 序列化器
│   │   │   ├── urls.py            # 路由定義
│   │   │   ├── constants.py       # 狀態列舉
│   │   │   ├── admin.py           # Django Admin 設定
│   │   │   └── migrations/
│   │   ├── imports/               # Excel 匯入管線
│   │   │   ├── models.py          # ImportLog, MatchingRule
│   │   │   ├── views.py           # 上傳 + 匯入歷史端點
│   │   │   ├── migrations/
│   │   │   └── services/
│   │   │       ├── excel_parser.py      # XLSX/XLS 解析核心
│   │   │       ├── hsinchu_parser.py    # 新竹院區格式處理
│   │   │       ├── data_cleaner.py      # 數據驗證與清洗
│   │   │       ├── matching.py          # 指標名稱模糊比對
│   │   │       └── persistence.py       # 批量寫入 + 觸發分析
│   │   └── analysis/              # 即時異常偵測服務
│   │       ├── apps.py
│   │       └── services/
│   │           ├── anomaly_detector.py  # 三機制偵測器（協調者）
│   │           ├── control_chart.py     # I-MR/P/U 管制圖計算
│   │           ├── monthly_change.py    # 月度變化偵測（±10%）
│   │           ├── peer_comparison.py   # 同儕比較偵測（±10%）
│   │           ├── trend_calculator.py  # 線性回歸趨勢
│   │           ├── aggregation.py       # 月度 → 季度聚合
│   │           └── tests/              # 單元測試
│   └── tests/
│       └── conftest.py
│
├── public/                          # 靜態資源
│   ├── sample.xls                  # 範例資料（Demo 載入用）
│   └── *.xlsx                      # TCPI 標竿檔案
│
├── docker-compose.yml              # 本地開發環境
├── docker-compose.prod.yml         # 正式部署
├── package.json                    # Next.js 依賴
├── tsconfig.json                   # TypeScript 設定
├── tailwind.config.ts              # Tailwind CSS 設定
├── .env.local                      # 前端環境變數
└── backend/.env.example            # 後端環境變數範本
```

### 2.3 Docker Compose 服務

```yaml
services:
  postgres:    # PostgreSQL 16-alpine, port 5433, DB: qm_center, schema: qip
  redis:       # Redis 7-alpine, port 6380
  api:         # Django API, port 8001 (自動 migrate + runserver)
```

環境變數：
```
DJANGO_SETTINGS_MODULE=config.settings.dev
DB_NAME=qm_center / DB_USER=qm_admin / DB_PASSWORD=devpassword
DB_HOST=postgres / DB_PORT=5432 / DB_SCHEMA=qip
REDIS_URL=redis://redis:6379/1
CELERY_BROKER_URL=redis://redis:6379/2
```

---

## 三、資料模型

### 3.1 後端資料庫模型（Django ORM）

#### 3.1.1 indicators 表（指標元資料）
```python
class Indicator(models.Model):
    code = CharField(PK, unique)        # "HA01-01"
    name = CharField                     # "住院死亡率(含病危自動出院)"
    category = CharField                 # "整體照護"
    unit = CharField                     # "percent" | "permille" | "count" | "ratio"
    direction = CharField                # "lower"(越低越好) | "higher"(越高越好) | "monitor"
    data_nature = CharField              # "continuous" | "binomial_rate" | "poisson_rate"
    is_quarterly = BooleanField          # 季指標
    is_active = BooleanField
    source = CharField                   # 資料來源
    aliases = JSONField                  # 別名列表（用於模糊比對）
    campuses = JSONField                 # 適用院區列表
    formula = TextField(nullable)        # 計算公式說明
    description = TextField(nullable)    # 指標說明
```

#### 3.1.2 data_points 表（月度數據）
```python
class DataPoint(models.Model):
    indicator_code = ForeignKey(Indicator)
    campus = CharField                   # "竹北" | "竹東" | "新竹"
    year = IntegerField                  # 民國年 110-115
    month = IntegerField                 # 1-12
    value = FloatField(nullable)         # 已計算的比率值
    numerator = IntegerField(nullable)   # 分子
    denominator = IntegerField(nullable) # 分母
    import_log = ForeignKey(ImportLog)   # 匯入批次
    # Unique: (indicator_code, campus, year, month)
```

#### 3.1.3 yearly_summaries 表（年度摘要）
```python
class YearlySummary(models.Model):
    indicator_code = ForeignKey(Indicator)
    campus = CharField
    year = IntegerField
    average = FloatField(nullable)              # 年度平均
    benchmark_regional = FloatField(nullable)   # 區域醫院標竿
    benchmark_district = FloatField(nullable)   # 地區醫院標竿
    # Unique: (indicator_code, campus, year)
```

#### 3.1.4 tcpi_benchmarks 表（TCPI 標竿值）
```python
class TCPIBenchmark(models.Model):
    indicator_code = ForeignKey(Indicator)
    tcpi_name = CharField                         # TCPI 指標名稱
    year = IntegerField                           # TCPI 年度
    medical_center = FloatField(nullable)         # 醫學中心同儕值
    regional_hospital = FloatField(nullable)      # 區域醫院同儕值
    district_hospital = FloatField(nullable)      # 地區醫院同儕值
    # Unique: (indicator_code, year)
```

#### 3.1.5 alerts 表（異常偵測結果）
```python
class Alert(models.Model):
    indicator_code = ForeignKey(Indicator)
    campus = CharField
    mechanism = CharField    # "control_chart" | "monthly_change" | "peer_comparison"
    rule = CharField         # "Rule 1 (3σ)" | "Rule 2 (2σ)" | ...
    severity = CharField     # "alert" | "warning" | "watch" | "good" | "excellent"
    message = TextField
    year = IntegerField
    month = IntegerField
    acknowledged = BooleanField(default=False)
    # Indexed: (indicator_code, campus, year, month), severity
```

#### 3.1.6 import_logs 表（匯入歷史）
```python
class ImportLog(models.Model):
    file_name = CharField
    file_size = IntegerField
    sheets_processed = JSONField          # 已處理的工作表清單
    data_points_new = IntegerField
    data_points_updated = IntegerField
    data_points_unchanged = IntegerField
    errors = JSONField                    # 錯誤清單
    created_at = DateTimeField(auto)
```

#### 3.1.7 matching_rules 表（名稱配對記憶）
```python
class MatchingRule(models.Model):
    excel_name = CharField
    normalized_name = CharField(indexed)  # 正規化名稱
    indicator_code = ForeignKey(Indicator)
```

### 3.2 前端型別定義（`lib/types.ts`）

```typescript
// 院區（★ v2.0：新增「新竹」= 兩院區合併）
export type Campus = '竹北' | '竹東' | '新竹';

// 面向分類（10 類）
export type Category =
  | '整體照護' | '加護照護' | '手術照護' | '產科照護'
  | '急診照護' | '重點照護' | '感染管制' | '用藥安全'
  | '呼吸照護' | '經營管理';

// 指標狀態（六級制）
export type IndicatorStatus = 'excellent' | 'good' | 'watch' | 'warning' | 'alert' | 'neutral';

// 指標方向
export type Direction = 'lower' | 'higher' | 'monitor';

// 數據本質
export type DataNature = 'continuous' | 'binomial_rate' | 'poisson_rate';

// 管制圖類型
export type ChartType = 'I-MR' | 'P' | 'U';

// 月份數據點
export interface MonthlyDataPoint {
  year: number;             // 民國年
  month: number;            // 1-12
  value: number | null;
  numerator?: number | null;
  denominator?: number | null;
}

// 指標元資料
export interface IndicatorMeta {
  code: string;
  name: string;
  category: Category;
  unit: string;
  direction: Direction;
  isQuarterly: boolean;
  dataNature: DataNature;
  isActive: boolean;
  campuses: Campus[];
  aliases: string[];
  formula?: string;
  description?: string;
}

// 管制圖參數
export interface ControlChartParams {
  chartType: ChartType;
  cl: number;               // 中心線
  ucl: number;              // 上管制界限 (3σ)
  lcl: number;              // 下管制界限 (3σ)
  sigma: number;
  ucl2: number;             // 2σ 界限
  lcl2: number;
  n: number;                // 數據點數
  variableLimits?: Array<{  // P/U Chart 變動界限
    year: number;
    month: number;
    ucl: number;
    lcl: number;
    ucl2: number;
    lcl2: number;
    sample_size: number;
  }>;
}

// 異常偵測結果
export interface AnomalyResult {
  mechanism: 'control_chart' | 'monthly_change' | 'peer_comparison';
  severity: 'excellent' | 'good' | 'watch' | 'warning' | 'alert';
  direction: 'unfavorable' | 'favorable';
  message: string;
  value: number;
  referenceValue?: number;
  rule?: string;            // 管制圖規則（Rule 1-5）
  year?: number;
  month?: number;
}

// 完整指標數據（前端主數據結構）
export interface IndicatorData {
  meta: IndicatorMeta;
  campus: Campus;
  monthlyData: MonthlyDataPoint[];
  yearlySummaries: YearlySummary[];
  latestValue: number | null;
  latestMonth: string | null;
  status: IndicatorStatus;
  trend: TrendDirection;
  benchmarkValue: number | null;
  peerValue: number | null;
  peerYear: number | null;
  anomalies: AnomalyResult[];
  controlChart: ControlChartParams;
}
```

---

## 四、REST API 端點

### 4.1 端點一覽

基礎路徑：`/api/v1/`

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/dashboard/?campus=竹北` | 批量載入儀表板數據（所有指標） |
| GET | `/indicators/` | 列出所有指標元資料 |
| GET | `/indicators/{code}/` | 單一指標詳情 |
| GET | `/indicators/{code}/data/?campus=竹北` | 指標完整月度數據 |
| GET | `/indicators/{code}/summaries/?campus=竹北` | 年度摘要 + TCPI 標竿 |
| GET | `/indicators/{code}/alerts/?campus=竹北` | 異常歷史 |
| GET | `/indicators/{code}/analysis/?campus=竹北&period=monthly` | **即時分析**（管制圖 + 異常偵測） |
| GET | `/tcpi/` | 列出所有 TCPI 標竿 |
| POST | `/tcpi/` | 批量匯入 TCPI 標竿（清除 + 重寫） |
| POST | `/imports/upload/` | 上傳 Excel 檔案（multipart/form-data） |
| GET | `/imports/logs/` | 匯入歷史紀錄 |

### 4.2 關鍵 API 回應格式

#### Dashboard API 回應
```json
{
  "data": [{
    "code": "HA01-01",
    "name": "住院死亡率(含病危自動出院)",
    "category": "整體照護",
    "unit": "percent",
    "direction": "lower",
    "data_nature": "binomial_rate",
    "is_quarterly": false,
    "latest_value": 2.12,
    "latest_period": "115.01",
    "sparkline": [2.02, 2.27, ...],        // 最近 24 個月
    "monthly_data": [...],                  // 完整月度數據
    "status": "watch",
    "mechanisms": ["peer_comparison"],       // 觸發的異常機制
    "unfavorable_count": 1,
    "year_avg": 2.15,
    "year_label": "114年",
    "peer_value": 1.98,
    "peer_source": "113年 TCPI 區域醫院",
    "trend": "down",
    "latest_anomalies": [...]
  }],
  "total": 33,
  "campus": "竹北"
}
```

#### Analysis API 回應
```json
{
  "status": "warning",
  "anomalies": [{
    "mechanism": "control_chart",
    "severity": "warning",
    "direction": "unfavorable",
    "message": "Rule 2: 值超過 2σ 管制界限",
    "value": 3.15,
    "rule": "Rule 2 (2σ)",
    "reference_value": 2.80,
    "year": 115,
    "month": 1
  }],
  "control_chart": {
    "chart_type": "P",
    "cl": 0.0198,
    "ucl": 0.0323,
    "lcl": 0.0073,
    "sigma": 0.00417,
    "ucl2": 0.0281,
    "lcl2": 0.0115,
    "n": 24,
    "variable_limits": [
      { "year": 114, "month": 1, "ucl": 0.0323, "lcl": 0.0073, "ucl2": 0.0281, "lcl2": 0.0115, "sample_size": 1130 }
    ]
  },
  "peer_value": 1.98
}
```

### 4.3 前端 API 客戶端（`lib/api.ts`）

五個主要函式：

```typescript
// 1. 批量載入儀表板（首頁用）
loadDashboardFromAPI(campus: Campus) → IndicatorData[]
// 呼叫 GET /api/v1/dashboard/?campus=竹北

// 2. 載入指標完整月度數據（詳情頁用）
loadIndicatorData(code, campus) → MonthlyDataPoint[]
// 呼叫 GET /api/v1/indicators/{code}/data/?campus=竹北

// 3. 載入年度摘要 + TCPI 標竿
loadIndicatorSummaries(code, campus) → { summaries, peerValue }
// 呼叫 GET /api/v1/indicators/{code}/summaries/?campus=竹北

// 4. 即時分析（管制圖 + 異常偵測）
loadAnalysis(code, campus, period?) → { status, anomalies, controlChart, peerValue }
// 呼叫 GET /api/v1/indicators/{code}/analysis/?campus=竹北&period=quarterly

// 5. 上傳 Excel
uploadExcel(file: File) → { id, new, updated, unchanged, sheets, errors }
// 呼叫 POST /api/v1/imports/upload/
```

所有請求使用 30 秒超時 + AbortController。

---

## 五、異常偵測系統（三機制）

### 5.1 架構概述

異常偵測由後端 `apps/analysis/services/` 即時計算，非預先儲存。由 `anomaly_detector.py`（協調者）呼叫三個獨立機制，最終解析出六級狀態。

```
anomaly_detector.py (協調者)
├── control_chart.py      # 機制 1: 管制圖分析
├── monthly_change.py     # 機制 2: 月度變化偵測
└── peer_comparison.py    # 機制 3: 同儕比較偵測
```

### 5.2 狀態解析優先順序

| 優先 | 狀態 | 觸發條件 | 顏色 |
|---|---|---|---|
| 1 | **alert** | 任何管制圖 Rule 1 (3σ 違規) | 紅 `bg-red-500` |
| 2 | **warning** | 管制圖 Rules 2-5，或 2+ 不利機制 + watch | 橘 `bg-orange-500` |
| 3 | **watch** | 單一不利機制（月度變化 OR 同儕比較） | 黃 `bg-yellow-500` |
| 4 | **good** | 無不利異常 | 綠 `bg-green-500` |
| 5 | **excellent** | 有利機制（2+ 類型）且無不利 | 藍 `bg-blue-500` |
| 6 | **neutral** | 無數據或無標竿 | 灰 `bg-gray-400` |

### 5.3 機制 1：管制圖分析（`control_chart.py`）

#### 圖型自動選型

```python
def select_chart_type(indicator, data_points):
    if data_nature == 'continuous':        → I-MR
    if < 6 points with N&D or < 50%:      → I-MR (fallback)
    if data_nature == 'binomial_rate':     → P Chart
    if data_nature == 'poisson_rate':      → U Chart
```

#### I-MR Chart 計算（最近 24 個月）
```
CL = X̄ (所有值平均)
MR = |X(i) - X(i-1)| (連續差值)
σ = MR̄ / d₂  (d₂ = 1.128, n=2)
UCL = CL + 3σ
LCL = max(0, CL - 3σ)
```

#### P Chart 計算（二項比率，變動界限）
```
p̄ = Σ numerator(i) / Σ denominator(i)
σ(i) = √( p̄ × (1-p̄) / n_i )
UCL(i) = p̄ + 3 × σ(i)
LCL(i) = max(0, p̄ - 3 × σ(i))
```

#### U Chart 計算（Poisson 密度，變動界限）
```
ū = Σ events(i) / Σ exposure(i)
σ(i) = √( ū / n_i )
UCL(i) = ū + 3 × σ(i)
LCL(i) = max(0, ū - 3 × σ(i))
```

#### Western Electric Rules（異常判定規則）
| 規則 | 說明 | 嚴重度 |
|---|---|---|
| Rule 1 | 單點超出 3σ | **alert** |
| Rule 2 | 單點超出 2σ | **warning** |
| Rule 3 | 連續 7+ 點在中心線同側 | **warning** |
| Rule 4 | 連續 7+ 點持續上升/下降 | **warning** |
| Rule 5 | 3 點中有 2 點超出 2σ | **warning** |

### 5.4 機制 2：月度變化偵測（`monthly_change.py`）

- 閾值：±10% 月度環比變化
- direction='lower'：↑+10% = **不利** (watch)，↓-10% = **有利** (excellent)
- direction='higher'：↑+10% = **有利** (excellent)，↓-10% = **不利** (watch)
- direction='monitor'：任何 ±10% = watch（大幅波動）

### 5.5 機制 3：同儕比較偵測（`peer_comparison.py`）

- 閾值：±10%（monitor 類型為 ±20%）
- direction='lower'：值 > peer×1.1 = **不利** (watch)；值 ≤ peer×0.9 = **有利** (excellent)
- direction='higher'：值 < peer×0.9 = **不利** (watch)；值 ≥ peer×1.1 = **有利** (excellent)

### 5.6 指標管制圖選型總表

| 代碼 | 名稱 | 數據本質 | 圖型 | 方向 |
|---|---|---|---|---|
| HA01-01 | 住院死亡率 | binomial_rate | P Chart | lower |
| HA01-02 | 非計畫性再住院率 | binomial_rate | P Chart | lower |
| HA01-03 | 住院日>30日比率（季） | binomial_rate | P Chart | lower |
| HA02-01 | 48hr ICU重返率 | binomial_rate | I-MR* | lower |
| HA02-02 | 加護病房死亡率 | binomial_rate | P Chart | lower |
| HA02-11 | 呼吸器相關肺炎(‰) | poisson_rate | I-MR* | lower |
| HA02-12 | 導尿管相關尿路感染(‰) | poisson_rate | U Chart | lower |
| HA02-13 | 中心導管相關血流感染(‰) | poisson_rate | I-MR* | lower |
| HA03-01 | 手術後48hr死亡率 | binomial_rate | I-MR* | lower |
| HA03-02 | 非計畫重返手術室 | binomial_rate | I-MR* | lower |
| HA03-03 | 手術部位感染 | binomial_rate | I-MR* | lower |
| HA03-04 | 預防性抗生素給予率 | binomial_rate | P Chart | **higher** |
| HA04-01 | 總剖腹產率 | binomial_rate | P Chart | lower |
| HA04-02 | 初次剖腹產率 | binomial_rate | P Chart | lower |
| HA05-01 | 急診轉住院比率 | binomial_rate | P Chart | lower |
| HA05-02 | 急診會診>30分鐘比率 | binomial_rate | P Chart | lower |
| HA05-03 | 重大外傷30min入開刀房 | binomial_rate | I-MR* | **higher** |
| HA06-01 | 腹膜透析病人比率 | binomial_rate | I-MR* | **higher** |
| HA06-11 | STEMI 90min內PCI率 | binomial_rate | I-MR* | **higher** |
| HA06-13 | 心肌梗塞住院死亡率 | binomial_rate | I-MR* | lower |
| HA06-21 | 缺血性中風IV-tPA率 | binomial_rate | I-MR* | **higher** |
| HA06-23 | 中風60min內IV-tPA率 | binomial_rate | I-MR* | **higher** |
| HA06-24 | IV-tPA症狀性腦出血率 | binomial_rate | I-MR* | lower |
| HA06-25 | 2hr抵達3hr內IV-tPA | binomial_rate | I-MR* | **higher** |
| HA06-31 | 安寧共同照護個案數 | continuous | I-MR | **higher** |
| HA06-32 | 出院時給予乙型阻斷劑率 | binomial_rate | I-MR* | **higher** |
| HA07-01 | 醫療照護相關感染(‰) | poisson_rate | U Chart | lower |
| HA08-01 | 藥物不良反應通報件數 | continuous | I-MR | **higher** |
| HA09-01 | 慢呼照護中心導管感染(‰) | poisson_rate | I-MR* | lower |
| HA09-02 | 慢呼照護呼吸器肺炎(‰) | poisson_rate | I-MR* | lower |
| HA09-03 | 慢呼照護導尿管感染(‰) | poisson_rate | I-MR* | lower |
| HA09-04 | 呼吸器脫離成功率 | binomial_rate | I-MR* | **higher** |
| HA09-05 | 入住呼吸照護病房比率 | binomial_rate | I-MR* | lower |
| HA10-01 | 異常事件通報件數 | continuous | I-MR | **higher** |
| HA10-02 | 員工遭受暴力事件數 | continuous | I-MR | lower |
| HA10-03 | 員工職業災害件數 | continuous | I-MR | lower |
| HA10-04 | 急性一般病床開放率 | continuous | I-MR | lower |
| HA10-09 | 全日平均護病比 | continuous | I-MR | lower |

> I-MR* = 理論上可用 P/U Chart，但因稀有事件（p̄×n < 5 或月事件數 < 1）退回 I-MR
> 統計：P Chart 9 個、U Chart 2 個、I-MR 27 個

---

## 六、資料來源規格

### 6.1 QIP Excel 檔案

- 格式：`.xls`（舊版 Excel）、`.xlsx`
- 工作表結構：`{年}年醫院評鑑持續性監測指標({院區})`
- 工作表涵蓋：110-115 年 × 竹北/竹東（12 張 + 合併工作表 5 張 = 17 張）

#### 欄位結構（111-115 年）
| 欄位 | 內容 |
|---|---|
| Col A (0) | 類別（合併儲存格） |
| Col B (1) | 序號 NO |
| Col C (2) | 指標代碼（如 HA01-01） |
| Col D (3) | QIP 指標名稱 |
| Col E-P (4-15) | 1-12 月數值 |
| Col Q (16) | 本年度平均值 |
| Col R-U (17-20) | 標竿值（因年度而異） |

#### 110 年特殊格式
- 無指標代碼欄位
- 月份值與分數合併：`"3.33%\n(16/480)"`

#### 數據行結構（兩行一組）
```
數值行:  [NO=1] [HA01-01] [名稱] [2.12] [2.02] [2.27] ...
分母行:  [    ] [       ] [    ] [(24/1130)] [(21/1040)] ...
```

### 6.2 數值清洗規則

| 原始值 | 清洗結果 |
|---|---|
| `2.13` | `2.13`（百分比） |
| `0‰` | `0`（千分比） |
| `NR` / `NP` / `-` / `""` | `null` |
| `(26/1223)` | numerator=26, denominator=1223 |

### 6.3 TCPI 標竿報表

- 檔案：`2024-2025TCPI指標年值報表-綜合(公告版).xlsx`
- 內容：全國各層級醫院同儕平均值
- 約 16 個 QIP 指標可在 TCPI 找到對應
- 匯入方式：透過 `POST /api/v1/tcpi/` 批量寫入

### 6.4 指標特殊屬性

| 屬性 | 適用指標 | 處理方式 |
|---|---|---|
| 季指標 | HA01-03 | 只有 1/4/7/10 月有值 |
| 千分比 (‰) | HA02-11/12/13, HA07-01, HA09-01/02/03 | 數值 ×1000 顯示 |
| 絕對數 | HA06-31, HA08-01, HA10-01/02/03 | 非比率，顯示整數 |
| 反向指標 | HA03-04, HA05-03, HA06-01/11/21/23/25/31/32, HA08-01, HA10-01 | 越高越好 |

---

## 七、前端功能規格

### 7.1 全域狀態管理（Zustand Store）

```typescript
interface DashboardStore {
  // UI 狀態
  campus: Campus;                        // 當前院區
  viewMode: 'card' | 'table' | 'heatmap'; // 檢視模式（三種）
  searchQuery: string;
  selectedCategory: Category | 'all';
  selectedYear: number;
  statusFilter: 'all' | 'alert';        // 僅顯示異常
  periodMode: 'monthly' | 'quarterly';  // 月度/季度切換
  loading: boolean;
  error: string | null;

  // 資料
  indicators: IndicatorData[];

  // Actions
  setCampus, setViewMode, setSearchQuery, etc.
}
```

**自動行為**：切換院區或指標變更時，自動選擇最近有數據的年度。

### 7.2 頁面功能

#### 7.2.1 首頁（`/`）— 總覽儀表板

- 載入時呼叫 `loadDashboardFromAPI(campus)` 批量取得所有指標
- 三種檢視模式：
  1. **卡片模式**（預設）：按面向分組的指標卡片牆
  2. **表格模式**：所有指標一覽表，可排序
  3. **熱力圖模式**：滾動 12 月 / 8 季 × 40+ 指標矩陣
- 面向篩選 + 關鍵字搜尋 + 狀態篩選
- 總覽統計：excellent/good/watch/warning/alert 計數

#### 7.2.2 指標詳情頁（`/indicators/[code]`）

載入三個 API：月度數據 + 年度摘要 + 即時分析

包含：
1. **管制圖**：σ 區域著色（1σ/2σ/3σ）、異常點標記、同儕線
2. **多年疊合趨勢圖**：各年線條不同粗細與顏色
3. **年度比較長條圖**
4. **標竿比較圖**
5. **完整數據表格**：含年度聚合
6. **異常清單**：含規則說明
7. **月度/季度切換**：季度聚合由前端 `aggregation.ts` 計算

#### 7.2.3 資料匯入頁（`/import`）

- ImportWizard 四步驟：上傳 → 預覽 → 差異 → 完成
- 呼叫 `POST /api/v1/imports/upload/`（Django 後端解析）
- 匯入歷史表格（`GET /api/v1/imports/logs/`）

#### 7.2.4 設定頁面（`/settings`）

- 指標管理：UI 已建立，API 未完全連接
- TCPI 標竿管理：`/settings/tcpi`

### 7.3 元件功能說明

| 元件 | 檔案 | 說明 |
|---|---|---|
| **IndicatorCard** | `components/dashboard/IndicatorCard.tsx` | 最新值 + sparkline + 狀態 + 趨勢 + 同儕值 + 異常數 + 觸發機制標記 |
| **StatusMatrix** | `components/dashboard/StatusMatrix.tsx` | 熱力圖矩陣，40+ 指標 × 12 月/8 季，依異常狀態著色 |
| **ControlChart** | `components/charts/ControlChart.tsx` | Recharts 線圖 + 1σ/2σ/3σ 著色區域 + UCL/LCL 線 + 異常標記 + 同儕線 |
| **YearOverlayChart** | `components/charts/YearOverlayChart.tsx` | 年度疊合線圖，各年不同色彩與粗細 |
| **PeriodToggle** | `components/dashboard/PeriodToggle.tsx` | 月度/季度切換器 |
| **Header** | `components/layout/Header.tsx` | 三院區選擇器 + 匯入按鈕 + 設定連結 |
| **AlertBanner** | `components/layout/AlertBanner.tsx` | 紅色橫幅顯示 alert 級別異常 |
| **ImportWizard** | `components/import/ImportWizard.tsx` | 多步驟匯入精靈 |

---

## 八、資料匯入管線（後端）

### 8.1 流程

```
1. 前端上傳 Excel → POST /api/v1/imports/upload/ (multipart/form-data)
2. excel_parser.py: 解析 XLSX/XLS，識別欄位結構
3. hsinchu_parser.py: 處理新竹院區特殊格式
4. matching.py: 指標名稱模糊比對（精確→別名→模糊）
5. data_cleaner.py: 數值驗證、null 處理、單位統一
6. persistence.py: 批量 upsert DataPoint（依唯一鍵）
   → 計算 YearlySummary（年度平均）
   → 觸發 anomaly_detector → 產生 Alert 記錄
7. 回傳 ImportLog（new/updated/unchanged/errors 計數）
```

### 8.2 名稱比對策略

```
優先順序：
1. 精確比對：indicator.code 完全一致
2. 別名比對：indicator.aliases 包含 Excel 名稱
3. 模糊比對：正規化後的名稱匹配
4. 記憶比對：matching_rules 表中的歷史對應
5. 失敗：列入 errors 清單
```

---

## 九、資料聚合（月度 → 季度）

### 9.1 前端聚合邏輯（`lib/aggregation.ts`）

```typescript
// 季度對應月份：Q1(1-3), Q2(4-6), Q3(7-10), Q4(10-12)
// 季度起始月：1, 4, 7, 10

聚合規則（依數據本質）：
- binomial_rate / poisson_rate:
    → Σ(numerator), Σ(denominator), ratio = Σnum / Σden
- continuous:
    → 平均非 null 值
```

### 9.2 後端聚合（`analysis/services/aggregation.py`）

同樣邏輯，用於 Analysis API 的 `period=quarterly` 參數。

---

## 十、已完成功能清單

| 功能 | 狀態 | 說明 |
|---|---|---|
| 儀表板三種檢視模式 | ✅ 完成 | 卡片/表格/熱力圖 |
| 三院區切換 | ✅ 完成 | 竹北/竹東/新竹 |
| 面向篩選 + 搜尋 | ✅ 完成 | |
| 六級狀態燈號 | ✅ 完成 | excellent → alert |
| Sparkline 趨勢圖 | ✅ 完成 | 最近 24 月 |
| 指標詳情頁 | ✅ 完成 | 完整圖表 + 數據表 |
| 管制圖視覺化 | ✅ 完成 | I-MR/P/U + σ 區域 + 異常標記 |
| 多年疊合趨勢圖 | ✅ 完成 | |
| 年度比較長條圖 | ✅ 完成 | |
| 標竿比較圖 | ✅ 完成 | |
| 月度/季度切換 | ✅ 完成 | 前端聚合 + 後端分析 |
| 三機制異常偵測 | ✅ 完成 | 管制圖 + 月度變化 + 同儕比較 |
| Western Electric Rules 1-5 | ✅ 完成 | |
| Excel 匯入 | ✅ 完成 | 後端解析 + 批量 upsert |
| 匯入歷史 | ✅ 完成 | |
| TCPI 標竿管理 | ✅ 完成 | 批量匯入 API |
| 同儕值顯示 | ✅ 完成 | 自動依院區對照 TCPI 層級 |
| Django REST Backend | ✅ 完成 | 11 個端點 |
| Docker Compose 部署 | ✅ 完成 | PostgreSQL + Redis + API |
| 熱力圖矩陣 | ✅ 完成 | 40+ 指標 × 12/8 期 |
| 警示橫幅 | ✅ 完成 | alert 級別自動浮現 |

---

## 十一、待擴充 / 未完成功能

| 功能 | 狀態 | 優先級 | 說明 |
|---|---|---|---|
| 設定頁 API 連接 | ⬜ 未完成 | 中 | UI 已建立，後端 CRUD API 待接 |
| PDF 匯出 | ⬜ 未完成 | 高 | 院長報告需要 |
| 改善備註系統 | ⬜ 未完成 | 中 | 各指標的改善措施記錄 |
| 使用者權限管理 | ⬜ 未完成 | 低 | 登入/權限控制 |
| Celery 非同步任務 | ⬜ 未完成 | 低 | 大量匯入時的背景處理 |
| 深色模式 | ⬜ 未完成 | 低 | |
| 前端 Legacy 清理 | ⬜ 未完成 | 低 | Dexie schema、前端 engine/ 已停用可移除 |
| TCPI 解析器 UI | ⬜ 部分 | 中 | API 已有，前端上傳 UI 待完善 |
| 自動化排程分析 | ⬜ 未完成 | 低 | 定期自動重算異常 |
| E2E 測試 | ⬜ 未完成 | 中 | 前端自動化測試 |

---

## 十二、設計決策記錄

| 決策 | 選擇 | 理由 |
|---|---|---|
| 架構 | 前後端分離（Next.js + Django） | 資料量增長後需後端持久化 + 複雜分析 |
| 資料庫 | PostgreSQL | 關聯式查詢、JSON 支援、成熟穩定 |
| 狀態管理 | Zustand | 比 Context+Reducer 更簡潔，選擇器效能佳 |
| 異常偵測位置 | 後端即時計算 | 集中管理分析邏輯，前端不需重算 |
| 管制圖策略 | 智慧選型（P/U/I-MR） | 有分子分母用正確圖型，稀有事件退回 I-MR |
| 圖表庫 | Recharts | React 生態成熟，支援響應式 |
| 年份格式 | 民國年 | 醫院內部全用民國年 |
| 狀態燈號 | 六級制 | 區分「達標邊緣」和「明顯優良」 |
| 匯入解析 | 後端（Django） | 集中處理 Excel 格式差異、觸發分析 |
| 季度聚合 | 前端 + 後端雙實作 | 前端即時切換、後端分析需要 |

---

## 十三、名詞對照

| 中文 | 英文 | 系統中的 key |
|---|---|---|
| 持續性監測指標 | QIP (Quality Indicator Program) | indicator |
| 面向 | Category | category |
| 標竿 | Benchmark | benchmark |
| 管制圖 | Control Chart | control_chart |
| 同儕值 | Peer Value | peer_value |
| 異常偵測 | Anomaly Detection | anomaly |
| 分子/分母 | Numerator/Denominator | numerator, denominator |
| 評鑑 | Accreditation | — |
| 品管中心 | Quality Management Center | — |
| 民國年 | ROC Year | year (110-115) |

---

## 十四、關鍵檔案快速索引

| 檔案 | 行數 | 用途 |
|---|---|---|
| `lib/types.ts` | 262 | 所有 TypeScript 型別定義 |
| `lib/constants.ts` | 300+ | 38 項指標元資料 + 配色 |
| `lib/api.ts` | 340 | Django REST API 客戶端 |
| `lib/store/dashboardStore.ts` | 92 | Zustand 全域狀態 |
| `lib/aggregation.ts` | — | 月度→季度聚合 |
| `app/page.tsx` | 166 | 主儀表板頁面 |
| `app/indicators/[code]/page.tsx` | — | 指標詳情頁 |
| `components/dashboard/StatusMatrix.tsx` | 329 | 熱力圖矩陣 |
| `components/charts/ControlChart.tsx` | 300+ | 管制圖視覺化 |
| `components/dashboard/IndicatorCard.tsx` | — | 指標卡片 |
| `backend/apps/indicators/models.py` | 217 | 7 個 ORM 模型 |
| `backend/apps/indicators/views.py` | 537 | 11 個 REST 端點 |
| `backend/apps/analysis/services/anomaly_detector.py` | 115 | 三機制協調者 |
| `backend/apps/analysis/services/control_chart.py` | 250+ | 管制圖計算引擎 |
| `backend/apps/analysis/services/monthly_change.py` | 78 | 月度變化偵測 |
| `backend/apps/analysis/services/peer_comparison.py` | 60 | 同儕比較偵測 |
| `backend/apps/imports/services/excel_parser.py` | 200+ | Excel 解析核心 |
| `docker-compose.yml` | 65 | 本地開發環境 |
