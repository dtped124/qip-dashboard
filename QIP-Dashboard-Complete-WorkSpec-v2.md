# QIP 持續性監測指標儀表板 — 完整工作說明書

> **版本**：v2.0（整合版）  
> **日期**：115 年 3 月  
> **用途**：交付 Claude Code 作為完整開發規格，一份文件涵蓋所有設計決策。  
> **部署方式**：Static Export（純前端），Portable 交付給承辦人。

---

## 目錄

1. [專案概述](#1-專案概述)
2. [資料層](#2-資料層)
3. [儲存層：Dexie / IndexedDB](#3-儲存層)
4. [統計引擎：SPC 管制圖](#4-統計引擎)
5. [異常偵測引擎](#5-異常偵測引擎)
6. [狀態系統：六級燈號](#6-狀態系統)
7. [指標管理與模糊比對](#7-指標管理與模糊比對)
8. [TCPI 標竿整合](#8-tcpi-標竿整合)
9. [月度模式 UI](#9-月度模式-ui)
10. [季度雙模式架構](#10-季度雙模式架構)
11. [季度變化分析頁](#11-季度變化分析頁)
12. [AI 深度分析整合（Claude API）](#12-ai-深度分析整合)
13. [**跨院區季度分析頁（新）**](#13-跨院區季度分析頁)
14. [匯出功能](#14-匯出功能)
15. [部署策略](#15-部署策略)
16. [技術棧與專案結構](#16-技術棧與專案結構)
17. [開發階段與時程](#17-開發階段與時程)

---

## 1. 專案概述

### 1.1 背景

新竹生醫園區醫院體系（含竹北院區、竹東院區、新竹主院區）的品質管理中心，需要一個持續性監測指標儀表板，取代目前以 Excel 手動管理約 60 個品質指標的方式。

核心理念：從「每三年一次評鑑大考」轉變為「每月小測驗」的持續性品質監測。

### 1.2 關鍵使用者與場景

| 使用者 | 場景 | 閱讀時間 | 核心問題 |
|--------|------|----------|---------|
| 品管人員 | 每月匯入新數據、檢視異常 | 5-10 分鐘 | 這個月哪些指標出問題？ |
| 委員會委員 | 每季審視改善進度 | 30 秒摘要 + 5 分鐘深入 | 這一季整體進步還是退步？ |
| 院級主管 | 策略性資源配置 | 2 秒結論 | 要把資源投在哪裡？ |

### 1.3 四層決策閱讀路徑

1. **2 秒全局掃描**：整體燈號分佈、異常數量
2. **30 秒優先檢視**：哪些指標亮紅燈
3. **2 分鐘指標深入**：管制圖、趨勢、同儕比較
4. **5 分鐘完整分析**：原因方向、改善建議、AI 輔助

### 1.4 設計原則

- **驅動改善行動**，不只展示數據
- **異常優先呈現**，正常指標可折疊
- **同時回答三個問題**：現在好不好（燈號）、跟以前比如何（趨勢）、跟別人比如何（同儕）
- **先報喜再報憂**（季度模式）

---

## 2. 資料層

### 2.1 資料來源

唯一資料來源為品管中心每月產出的 Excel 檔案（.xls / .xlsx）。

檔案結構：17 張工作表，每張對應一個「年度 × 院區」組合。

```
工作表命名規則：
  "115年竹北"、"115年竹東"
  "114年竹北"、"114年竹東"
  ...
  "110年竹北"（格式略有不同）
```

### 2.2 Excel 欄位結構（111-115 年）

| 欄位 | 內容 | 備註 |
|------|------|------|
| A | 面向分類名稱 | 合併儲存格，僅該區段首行有值 |
| B | 序號 NO | 正整數為指標行 |
| C | 指標代碼 | 如 HA01-01 |
| D | 指標名稱 | 含分子分母描述 |
| E-P | 1-12 月數值 | 可能含百分比符號、NR、NP、空字串 |
| Q | 年均值 | |
| R | 前年均值 | |
| S | 標竿值 | 可能為空 |

**110 年格式差異**：欄位順序可能不同，需額外處理。

### 2.3 數值清洗規則

| 原始值 | 清洗結果 | 說明 |
|--------|---------|------|
| `2.12` | `2.12` | 正常數值 |
| `2.12%` | `2.12` | 移除百分比符號 |
| `NR` | `null` | 無需報告 |
| `NP` | `null` | 不適用 |
| `""` (空字串) | `null` | 無數據 |
| `-` | `null` | 無數據 |
| `0` | `0` | 合法的零值（如 0‰ 感染率） |
| `(26/1223)` | `numerator=26, denominator=1223` | 分子/分母，提取並存入 |

### 2.4 數據行識別規則

```
判斷是否為指標資料行：
1. Col B (NO) 為正整數 → 這是指標行
2. Col B 非正整數、但 Col E 有 "(數字/數字)" 格式 → 分子/分母明細行，解析存入
3. 其餘空白行 → 跳過
```

### 2.5 面向分類識別

面向名稱在 Col A，是合併儲存格。解析策略：遇到 Col A 有值時更新 `currentCategory`，後續空白行繼承。

九大面向：整體照護、加護照護、手術照護、產科照護、急診照護、重點照護、感染管制、用藥安全、經營管理。

### 2.6 院區指標差異

| 面向 | 竹北 | 竹東 | 差異說明 |
|------|------|------|---------|
| 產科照護 | 有 | 無 | 竹東無產科 |
| 呼吸照護 | 無 | 有 | 竹東專有 |
| 其他 | ~33 項 | ~27 項 | 部分指標僅單院區收案 |

### 2.7 分子/分母數據

Excel 報表中每個指標都附有 `(分子/分母)`，為管制圖正確選型的基礎：

```typescript
function parseFraction(raw: string): { numerator: number; denominator: number } | null {
  const match = String(raw).match(/\((\d+)\/(\d+)\)/);
  if (!match) return null;
  return { numerator: parseInt(match[1]), denominator: parseInt(match[2]) };
}
```

有分子分母 → 可用 P Chart 或 U Chart；僅有比率值 → 退回 I-MR Chart。

### 2.8 HA10 異常事件通報：跨院區特殊處理

新竹主院區報告 13 個子類別（HA10-10-01 至 HA10-10-13），需自動加總為 HA10-01 以與竹北/竹東比較。子類別僅供明細查看，不獨立建管制圖。

```
竹北/竹東匯入：直接讀取 HA10-01 → 存為 dataPoint
新竹匯入：讀取 HA10-10-01~13 → 存子類別 + 自動加總存為 HA10-01
           若 Excel 有總計列，與自動加總交叉驗證
```

---

## 3. 儲存層：Dexie / IndexedDB

### 3.1 為什麼用 Dexie

- 純前端持久化，無需後端
- 支援 Static Export（portable 部署）
- 容量足夠（數百 MB），遠超 localStorage 的 5-10 MB
- 結構化查詢、索引、版本遷移

### 3.2 核心 Schema

```typescript
import Dexie from 'dexie';

const db = new Dexie('QIPDashboard');

db.version(6).stores({
  // 指標定義（預設 + 動態）
  indicators: 'id, category, *campus, direction, source, isActive',
  
  // 月度數據點
  dataPoints: '[indicatorId+campus+year+month], indicatorId, campus, year',
  
  // Excel 匯入記錄
  importLogs: '++id, importedAt, campus, year',
  
  // 模糊比對記憶
  matchingRules: 'normalizedName, indicatorId, confirmedAt',
  
  // TCPI 標竿值
  tcpiBenchmarks: '[indicatorId+year], indicatorId, year',
  
  // 季度評估結果
  quarterlyAssessments: 'id, indicatorId, campus, [year+quarter], quarterlyStatus',
  
  // 季度變化分析快取
  quarterlyChangeAnalysis: 'id, campus, [year+quarter], overallVerdict, calculatedAt',
  
  // 品管備註
  actionNotes: 'id, indicatorId, campus, [year+quarter], updatedAt',
  
  // AI 分析快取
  aiAnalysisCache: 'id, indicatorId, campus, [year+quarter], expiresAt',
  
  // 應用設定（含加密 API Key）
  settings: 'key',
});
```

### 3.3 核心型別定義

```typescript
// 指標狀態（六級制）
type IndicatorStatus = 'alert' | 'warn' | 'watch' | 'good' | 'excellent' | 'neutral';

// 管制圖類型
type ControlChartType = 'IMR' | 'P' | 'U';

// 數據本質
type DataNature = 'continuous' | 'binomial_rate' | 'poisson_rate' | 'count';

// 指標方向性
type Direction = 'lower' | 'higher' | 'monitor';

// 月度數據點
interface DataPoint {
  indicatorId: string;
  campus: 'zhubei' | 'zhudong';
  year: number;              // 民國年
  month: number;             // 1-12
  value: number | null;
  numerator: number | null;
  denominator: number | null;
}

// 指標定義
interface Indicator {
  id: string;
  source: 'preset' | 'custom';
  name: string;
  aliases: string[];
  category: string;
  campus: ('zhubei' | 'zhudong')[];
  direction: Direction;
  unit: '%' | '‰' | '次' | '件' | '人' | '天';
  dataNature: DataNature;
  chartType: ControlChartType;
  hasDenominator: boolean;
  peerValue: number | null;
  formula: string;
  description: string;
  isActive: boolean;
  createdAt: string;
}
```

---

## 4. 統計引擎：SPC 管制圖

### 4.1 雙層策略

```
Layer 1（基礎層）：所有指標一律繪製 I-MR Chart
  → 確保每個指標都有管制圖
  → 利用 I-MR 的穩健性作為基線

Layer 2（進階層）：當有分子/分母數據時，額外繪製正確圖型
  → P Chart：二項比率型（住院死亡率、SSI、遵從率等）
  → U Chart：Poisson 密度型（感染密度、跌倒密度等）
  → 提供更精確的管制界限（隨分母變動調整）
```

圖型由數據本質決定，相同指標代碼在不同院區使用相同圖型。

### 4.2 基線窗口

**所有管制界限計算只用最近 24 個有效數據點**（約 2 年）。

| 有效數據點數 | 行為 |
|-------------|------|
| < 6 | 不繪製管制圖，顯示「數據不足」 |
| 6 - 23 | 使用全部數據，顯示「⚠️ 基線不足 24 點」警示 |
| ≥ 24 | 取最近 24 個有效點計算 CL/UCL/LCL |

圖表可顯示所有歷史數據點，但管制線只基於最近 24 個月。

### 4.3 I-MR Chart 計算

```typescript
function calcIMRChart(values: number[]): { cl: number; ucl: number; lcl: number } {
  const n = values.length;
  const xBar = values.reduce((a, b) => a + b, 0) / n;
  
  // 移動全距
  const mrs: number[] = [];
  for (let i = 1; i < n; i++) {
    mrs.push(Math.abs(values[i] - values[i - 1]));
  }
  const mrBar = mrs.reduce((a, b) => a + b, 0) / mrs.length;
  
  // 2.66 = 3/d₂, d₂ = 1.128 for n=2
  const ucl = xBar + 2.66 * mrBar;
  const lcl = Math.max(0, xBar - 2.66 * mrBar);
  
  return { cl: xBar, ucl, lcl };
}
```

### 4.4 P Chart 計算

```typescript
function calcPChart(data: { numerator: number; denominator: number }[]): {
  pBar: number;
  controlLimits: { ucl: number; lcl: number }[];
} {
  const totalD = data.reduce((s, d) => s + d.numerator, 0);
  const totalN = data.reduce((s, d) => s + d.denominator, 0);
  const pBar = totalD / totalN;
  
  // 管制界限隨每期分母變動
  const controlLimits = data.map(d => ({
    ucl: Math.min(1, pBar + 3 * Math.sqrt(pBar * (1 - pBar) / d.denominator)),
    lcl: Math.max(0, pBar - 3 * Math.sqrt(pBar * (1 - pBar) / d.denominator)),
  }));
  
  return { pBar, controlLimits };
}

// 自動退回規則：若 pBar × 平均分母 < 5，退回 I-MR
```

### 4.5 U Chart 計算

```typescript
function calcUChart(data: { count: number; exposure: number }[]): {
  uBar: number;
  controlLimits: { ucl: number; lcl: number }[];
} {
  const totalC = data.reduce((s, d) => s + d.count, 0);
  const totalN = data.reduce((s, d) => s + d.exposure, 0);
  const uBar = totalC / totalN;
  
  const controlLimits = data.map(d => ({
    ucl: uBar + 3 * Math.sqrt(uBar / d.exposure),
    lcl: Math.max(0, uBar - 3 * Math.sqrt(uBar / d.exposure)),
  }));
  
  return { uBar, controlLimits };
}
```

### 4.6 西方電氣法則（異常判定）

除了「超出管制界限」外，還需偵測以下模式：

| 規則 | 說明 | 解讀 |
|------|------|------|
| 1 點超出 3σ | 單點超出 UCL 或 LCL | 最強異常信號 |
| 連續 7 點在中心線同側 | 7 個連續點全在 CL 以上或以下 | 製程偏移 |
| 連續 7 點遞增或遞減 | 明顯趨勢 | 系統性變化 |
| 2/3 點在 2σ 以外 | 連續 3 點中有 2 點超出 2σ | 早期警示 |

---

## 5. 異常偵測引擎：三層判定

### 5.1 三層架構

| 層次 | 判定方法 | 說明 |
|------|---------|------|
| Layer 1 | 管制圖違規 | SPC 統計判定（§4.6 西方電氣法則） |
| Layer 2 | 月增減 ±10% | 與上月相比變動超過 10% |
| Layer 3 | 同儕值比較 | 與 TCPI 同儕值比較，差距超過閾值 |

任一層觸發即標記為異常，但嚴重等級不同。

### 5.2 月增減偵測

```typescript
function detectMonthlyChange(current: number, previous: number | null): {
  triggered: boolean;
  changePercent: number | null;
  direction: 'increase' | 'decrease' | null;
} {
  if (previous === null || previous === 0) return { triggered: false, changePercent: null, direction: null };
  const change = (current - previous) / previous;
  return {
    triggered: Math.abs(change) >= 0.10,
    changePercent: change * 100,
    direction: change > 0 ? 'increase' : 'decrease',
  };
}
```

### 5.3 同儕值比較

竹北對照區域醫院同儕值，竹東對照地區醫院同儕值。

```typescript
function comparePeer(
  value: number,
  peerValue: number | null,
  direction: Direction,
  threshold: number = 0.10
): { assessment: 'better' | 'worse' | 'comparable'; gapPercent: number } {
  if (peerValue === null) return { assessment: 'comparable', gapPercent: 0 };
  const gap = (value - peerValue) / peerValue;
  if (Math.abs(gap) <= threshold) return { assessment: 'comparable', gapPercent: gap * 100 };
  if (direction === 'lower') return { assessment: gap < 0 ? 'better' : 'worse', gapPercent: gap * 100 };
  if (direction === 'higher') return { assessment: gap > 0 ? 'better' : 'worse', gapPercent: gap * 100 };
  return { assessment: 'comparable', gapPercent: gap * 100 };
}
```

---

## 6. 狀態系統：六級燈號

### 6.1 判定邏輯

```typescript
function calculateStatus(value: number | null, benchmark: number | null, direction: Direction): IndicatorStatus {
  if (value === null || benchmark === null) return 'neutral';
  if (direction === 'monitor') return 'neutral';

  if (direction === 'lower') {
    if (value <= benchmark * 0.5) return 'excellent';
    if (value <= benchmark * 0.8) return 'good';
    if (value <= benchmark)       return 'watch';
    if (value <= benchmark * 1.3) return 'warn';
    return 'alert';
  }
  // direction === 'higher'
  if (value >= benchmark * 1.5) return 'excellent';
  if (value >= benchmark * 1.2) return 'good';
  if (value >= benchmark)       return 'watch';
  if (value >= benchmark * 0.7) return 'warn';
  return 'alert';
}
```

### 6.2 視覺對照

| 狀態 | 顏色 | Tailwind | 中文 | 說明 |
|------|------|----------|------|------|
| alert | 紅 | `bg-red-500` | 警示 | 明顯超標，需立即介入 |
| warn | 橘 | `bg-orange-500` | 注意 | 略超標竿，需持續關注 |
| watch | 黃 | `bg-yellow-500` | 留意 | 達標但在邊緣 |
| good | 綠 | `bg-green-500` | 良好 | 明顯優於標竿 |
| excellent | 藍 | `bg-blue-500` | 卓越 | 遠優於標竿 |
| neutral | 灰 | `bg-gray-400` | 監測 | 無標竿或無數據 |

---

## 7. 指標管理與模糊比對

### 7.1 雙軌制

- **預設指標**：寫在 `constants/indicators.ts`，不可刪除，僅可編輯屬性
- **動態指標**：使用者可從 UI 新增，儲存於 IndexedDB，與預設指標功能完全相同

### 7.2 模糊比對引擎：五層策略

匯入 Excel 時，需將工作表中的指標名稱對應到系統指標。

**前處理**：全形→半形、移除空白、統一小寫、移除贅詞（「比率」→「率」）。

```
Layer 1: 完全比對 → 信心度 100%，直接配對
Layer 2: 別名比對 → 信心度 100%，直接配對
Layer 3: 包含比對 → 信心度 80%，自動配對但標記
Layer 4: 相似度比對（Levenshtein/Dice > 0.75）→ 信心度 60%，待人工確認
Layer 5: 無法配對 → 人工指派或新增為動態指標
```

### 7.3 比對記憶

使用者手動確認的配對結果存入 `matchingRules` 表，下次匯入時自動套用。

---

## 8. TCPI 標竿整合

### 8.1 三院區對照層級

| 院區 | 對照 TCPI 層級 | 說明 |
|------|---------------|------|
| 新竹（合併） | 醫學中心 | 2027 年升格目標 |
| 竹北 | 區域醫院 | 目前評鑑等級 |
| 竹東 | 地區醫院 | 目前評鑑等級 |

### 8.2 匯入流程

獨立的 TCPI 標竿匯入入口，流程：上傳 TCPI Excel → 解析 → 自動配對 QIP 指標 → 預覽確認 → 載入。

### 8.3 呈現方式

管制圖上同時顯示兩條標竿線：
- QIP 標竿（Excel 內附）→ 淺色虛線
- TCPI 標竿 → 粗紅色虛線，標註年度

約 16 個 QIP 指標可在 TCPI 找到直接對應，其餘為空白。

---

## 9. 月度模式 UI

### 9.1 全域總覽

```
┌─────────────────────────────────────────────────────────────┐
│  Header: [竹北院區 ▾]  [ ◉月度 | 季度 ]  [114年12月 ◂ ▸]   │
├─────────────────────────────────────────────────────────────┤
│  警示橫幅：本月有 3 項指標超出管制界限                        │
├─────────────────────────────────────────────────────────────┤
│  狀態摘要卡片：🔴×3  🟠×5  🟡×7  🟢×12  🔵×1  ⚪×5          │
├─────────────────────────────────────────────────────────────┤
│  ▼ 需關注指標（異常優先排序）                                 │
│    [指標卡片] [指標卡片] [指標卡片] ...                       │
│  ▶ 全部指標（可展開）                                        │
│    按九大面向分類顯示                                        │
└─────────────────────────────────────────────────────────────┘
```

### 9.2 指標卡片

每張卡片同時呈現：數值 + 狀態燈號 + Sparkline 趨勢 + 標竿比較。

### 9.3 指標詳情（點擊展開）

包含完整管制圖（多年疊合）、三層異常判定結果、同儕比較、歷史數據表。

### 9.4 檢視模式

卡片模式（全局瀏覽）和表格模式（逐項比對、排序）可切換。

---

## 10. 季度雙模式架構

### 10.1 切換機制

全域 `ViewModeSwitch` 切換月度/季度模式，影響總覽頁、類別頁、導航統計。使用 Zustand store 管理 `viewMode`。

### 10.2 季度定義

自然季：Q1=1-3月、Q2=4-6月、Q3=7-9月、Q4=10-12月。

### 10.3 季度彙整計算

- **比率型指標**（有分子分母）：季度值 = Σ三月分子 / Σ三月分母
- **僅有比率值**：季度值 = 三月算術平均
- **季內趨勢**：三個月逐月好轉 = improving、逐月惡化 = worsening、交替 = fluctuating、無顯著變化 = stable

### 10.4 持續異常判定

**用季末月（第三個月）是否仍超出管制界限**來判定。判定用末月，但呈現整季三個月軌跡。

### 10.5 季度模式 Tab 結構

```
┌──────────────┬──────────────┬──────────────────┐
│  📊 季度總覽  │  📋 異常追蹤  │  📈 季度變化分析  │
└──────────────┴──────────────┴──────────────────┘
```

### 10.6 季度總覽：四張摘要卡片

| 卡片 | 圖標 | 定義 |
|------|------|------|
| 持續異常 | 🔴 | 季末月仍超出管制界限 |
| 新發異常 | 🟠 | 上季末正常、本季末異常 |
| 已改善 | 🟢 | 上季末異常、本季末回歸正常 |
| 同儕落後 | 📊 | 季均值劣於 TCPI 同儕值 |

### 10.7 異常追蹤表

每個異常指標一行，含 sparkline、季末值、管制界限值、同儕差距、狀態標籤。按嚴重度排序（持續異常且惡化 → 排最前）。

---

## 11. 季度變化分析頁

### 11.1 核心目的

自動產出「本季 vs 上季」的優缺點分析與改善優先清單。取代手動撰寫的季度報告。

### 11.2 四層結構

**第一層：整體變化摘要（Executive Summary）**

堆疊比例條顯示改善/持平/退步的佔比。自動生成整體標語（▲ 整體進步 / ► 大致持平 / ▼ 整體需關注）。

判定規則：

| 狀態 | 觸發條件（滿足任一） |
|------|---------------------|
| **改善** | 上季末異常→本季末正常（IMP-1）；季均值優於上季≥5%（IMP-2）；異常中但逐月好轉（IMP-3）；同儕差距縮小≥5%（IMP-4） |
| **退步** | 上季末正常→本季末異常（DEC-1）；持續異常且惡化（DEC-2）；月增減≥10%往不利方向連續2月（DEC-3）；同儕差距擴大≥5%（DEC-4） |
| **持平** | 不符合上述任何條件 |

**第二層：優點區（先列，正向激勵）**

四個子類別：🎯 脫離異常 / 📈 趨勢好轉 / 🏃 追趕同儕 / ⭐ 維持優異。摘要層（小卡片計數）+ 詳情層（可展開表格 + 內嵌迷你管制圖）。

**第三層：缺點區**

四個子類別：🔥 新發異常 / ⚠️ 持續惡化 / 📉 趨勢危險 / 🔻 同儕拉開。含嚴重度星級標記（★ 1-3 星）。

**第四層：改善優先清單**

五維度加權排序：嚴重度（0-30）+ 趨勢（0-25）+ 同儕差距（0-20）+ 持續性（0-15）+ 影響量體（0-10）= 總分 100。

每個項目含：數據摘要、可能原因方向（規則引擎知識庫）、建議行動、品管備註欄位、AI 深度分析按鈕。

### 11.3 可能原因方向：規則引擎知識庫

以「面向 × 異常模式」二維查詢表，內建九大面向的通用原因清單。異常模式自動偵測：sudden_spike / gradual_increase / persistent_high / seasonal_variation / peer_gap_widening / new_abnormal。

知識庫放在獨立 JSON 檔案（`causeDirectionKB.json`），方便品管人員調整內容而不改程式碼。

### 11.4 比較對象

預設為前一季，但下拉選單可選任意歷史季度（包含去年同期）。當選擇非連續季度時，「連續異常季數」計算需跳過中間季度。

### 11.5 同期比較策略

**現階段不做同期比較的常態呈現**，但：
- 保留手動切換能力（下拉選單選去年同期）
- AI 分析的 prompt 自動附加去年同期數據（若有）
- 未來數據累積 2-3 年後，可加季節性自動偵測模組

---

## 12. AI 深度分析整合（Claude API）

### 12.1 架構

從瀏覽器直接呼叫 Anthropic Claude API。合理性：院內品管人員使用、Portable 部署、Anthropic Console 可設月度用量上限。

### 12.2 API Key 管理

「首次使用時輸入 + Web Crypto API 加密 + IndexedDB 儲存」。不寫死在程式碼裡，也不需每次重新輸入。

```typescript
// 加密使用 AES-GCM + PBKDF2 derived key
// 解密後的 key 僅存在記憶體中，不會以明文寫入儲存
```

設定面板提供：驗證 Key、清除 Key、更換 Key、模型選擇（預設 Sonnet）、回應語言。

### 12.3 資料安全檢查閘門

**每次送出 prompt 前自動執行**：

- **欄位白名單過濾**（只允許指標名稱、代碼、面向、聚合數值、分子、分母、管制界限、同儕值等）
- **PII 格式偵測**（身分證字號、病歷號、email），主要防止品管備註欄位意外貼入個資
- 安全檢查失敗時告知使用者哪些欄位被移除，使用者確認後才繼續

**注意：不遮蔽小樣本分子。** 許多指標（VAP、CLABSI、跌倒、重返手術室等）的月分子本來就常為 0-5，遮蔽後 AI 無法做有意義的分析。送出的資料為「指標層級的聚合統計」（如：竹北院區某月 CLABSI 2 例 / 1,100 導管人日），不含個案明細（病歷號、姓名、病房、日期），無法反推特定個人。真正需要防護的是備註欄位中的自由文字輸入——PII 偵測會處理這部分。

### 12.4 Prompt 工程

**System Prompt**：設定為資深醫院品質管理顧問，回答使用繁體中文，聚焦「為什麼」和「怎麼辦」。

**回應格式**：結構化 XML（key_findings / possible_causes / recommended_actions / additional_data_needed），方便前端解析。解析失敗時 fallback 顯示原始文字。

**Token 估算**：單次 ~1,500-2,100 tokens，約 0.5 元台幣。

### 12.5 快取機制

結果存入 `aiAnalysisCache` 表。失效條件：數據 hash 變更（新數據匯入）、超過 30 天、使用者手動重新分析、切換模型。

### 12.6 費用控制

- 前端內建用量追蹤（月度 token 用量 + 預估費用）
- 軟上限 $5 USD/月（顯示警告但允許繼續）
- 硬上限由 Anthropic Console 控制

### 12.7 觸發方式

Phase 1：單一指標按需分析（點按鈕）。Phase 2 預留：批次分析所有異常指標。

### 12.8 瀏覽器直呼必要 header

```typescript
headers: {
  'Content-Type': 'application/json',
  'x-api-key': apiKey,
  'anthropic-version': '2023-06-01',
  'anthropic-dangerous-direct-browser-access': 'true',
}
```

---

## 13. 跨院區季度分析頁

> **版本**：v1.0（2026-03 新增）
> **定位**：獨立功能頁，側邊欄入口位於「匯入紀錄」上方。
> **核心目的**：一頁掌握三個院區同一季的異常全貌、比較差異、找出共通問題。

---

### 13.1 側邊欄位置

```
QIP 儀表板
│
├── [全院指標]          ← 原有首頁
│
├── [季度分析]          ← 新增（位於匯入紀錄上方）★
│
├── [匯入紀錄]
├── [標竿管理]
└── [設定]
```

---

### 13.2 頁面架構：Tab 雙模式

```
┌─────────────────────────────────────────────────────────┐
│  季度跨院區分析                                           │
│  [本季 115Q1 ▾]  vs  [上季 114Q4 ▾]                      │
│                                                         │
│  ┌─────────────────┬─────────────────────────────────┐  │
│  │  📊 統整表       │  🤖 AI 分析（需啟用 AI）         │  │
│  └─────────────────┴─────────────────────────────────┘  │
│                                                         │
│  [Tab 內容區]                                           │
└─────────────────────────────────────────────────────────┘
```

**Tab 1：統整表**（不需 AI，純資料呈現）
**Tab 2：AI 分析**（需在設定中啟用 AI 並填入 API Key）

若 AI 未啟用，Tab 2 顯示灰色鎖定狀態，並引導至設定頁面。

---

### 13.3 Tab 1：統整表

#### 13.3.1 資料範圍

- **只顯示有異常的指標**（任一院區本季末月超出管制界限，或月增減 ≥ 10%）
- **只有單一院區才有的指標**仍顯示，以「院區特色」標示其他院區欄位

#### 13.3.2 表格結構

```
指標代碼  指標名稱        面向      竹北（本季↔上季）   竹東（本季↔上季）   新竹（本季↔上季）
HA01-01   住院死亡率      整體照護   🔴 ↑+15%         🟡 →持平           ⚪ 無資料
HA02-03   非計畫重返率    整體照護   🟢 ↓改善          🔴 ↑+8%           🔴 ↑+12%
IC03-01   導管感染密度    感染管制   ⚪ 院區特色        🔴 ↑+25%          ⚪ 院區特色
...
```

#### 13.3.3 儲存格內容規格

| 情況 | 顯示 |
|------|------|
| 有資料且有異常 | 🔴/🟠/🟡 + 箭頭 + 百分比變化 |
| 有資料但正常 | 🟢 改善 / 🟢 →持平（正常指標不列入，此欄不出現） |
| 該院區無此指標（永久性） | `⚪ 院區特色` |
| 該季無資料 | `— 無資料` |
| 院區本季尚未匯入 | `⏳ 未匯入` |

#### 13.3.4 排序規則

1. 三院區同時異常 → 最上方（共通問題）
2. 兩院區異常 → 次之
3. 單一院區異常 → 再次之
4. 同層內依面向分類排序

#### 13.3.5 篩選與互動

- **面向篩選**：下拉選單，可選單一面向
- **院區篩選**：可只看某一院區的異常
- **點擊指標列**：展開顯示該指標三院區的迷你 Sparkline（最近 6 個月）
- **匯出**：可匯出為 CSV 或列印

---

### 13.4 Tab 2：AI 分析

#### 13.4.1 啟用條件

- 設定頁面「啟用 AI 分析」= ON
- 已設定有效的 Claude API Key
- 未啟用時顯示引導說明而非灰底遮罩

#### 13.4.2 分析架構：4 次 AI 呼叫

```
使用者點擊 [開始 AI 分析]
        │
        ├── Call 1：竹北院區分析
        ├── Call 2：竹東院區分析
        ├── Call 3：新竹院區分析（若該季有資料）
        │           ↑ 三個呼叫可平行執行
        │
        └── Call 4：三院區共通問題分析
                    （在 Call 1-3 完成後執行，
                      輸入：各院區摘要 + 原始異常指標清單）
```

**費用提示**：點擊分析前顯示「本次預估費用約 NT$ 6-12（4 次呼叫），是否繼續？」

#### 13.4.3 UI 結構

```
┌─ AI 分析結果 ──────────────────────────────────────────┐
│  [115Q1 vs 114Q4]  分析完成：2026/03/28 22:05           │
│  [重新分析]  [匯出報告]                                  │
├─────────────────────────────────────────────────────────┤
│  🏥 竹北院區                              [展開/收合 ▾]  │
│  ┌─────────────────────────────────────────────────┐    │
│  │ 關鍵發現 / 可能原因 / 建議行動                    │    │
│  └─────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────┤
│  🏥 竹東院區                              [展開/收合 ▾]  │
│  └── 同上結構                                           │
├─────────────────────────────────────────────────────────┤
│  🏥 新竹院區                              [展開/收合 ▾]  │
│  └── 同上結構                                           │
├─────────────────────────────────────────────────────────┤
│  🔗 三院區共通問題                         [展開/收合 ▾]  │
│  ┌─────────────────────────────────────────────────┐    │
│  │ 共通問題摘要 / 可能的系統性原因 / 院級改善建議    │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

#### 13.4.4 各院區 Prompt 輸入內容

每個院區呼叫送入：
- 該院區本季所有異常指標清單（代碼、名稱、面向）
- 每個異常指標的：本季值、上季值、變化率、管制圖狀態、同儕差距
- 院區類別（竹北=區域醫院、竹東=地區醫院、新竹=醫學中心目標）

#### 13.4.5 共通問題 Prompt 輸入內容

Call 4 送入：
- Call 1-3 的 key_findings 摘要（壓縮版）
- 在 2 個以上院區同時異常的指標列表（作為 AI 判斷的數據基礎）
- 各院區的面向異常分佈（哪個面向這季最多問題）

#### 13.4.6 快取策略

- 每次分析結果快取 30 天
- 快取 key = `cross_campus_${year}_Q${quarter}`
- 資料有更新（新匯入）時自動失效
- 每個院區的結果分開快取（更新竹北資料只重新分析竹北）

---

### 13.5 設定整合：啟用 AI 分析開關

在 `/settings/ai` 頁面新增：

```
┌─ AI 分析設定 ─────────────────────────────────────┐
│                                                    │
│  [ON/OFF] 啟用 AI 分析功能                          │
│  關閉後：所有 AI 分析入口隱藏，資料不傳送至 API      │
│                                                    │
│  Claude API Key                                    │
│  [sk-ant-...              ] [顯示] [驗證] [清除]    │
│                                                    │
│  分析模型                                          │
│  ● Claude Sonnet 4.6（建議）                       │
│  ○ Claude Opus 4.6（最深入）                       │
│  ○ Claude Haiku 4.5（最快）                        │
└────────────────────────────────────────────────────┘
```

`aiEnabled: boolean` 存入 localStorage，全域控制所有 AI 功能顯示。

---

## 14. 匯出功能

### 14.1 月度報告

瀏覽器列印（Ctrl+P）作為臨時方案。

### 14.2 季度變化分析報告（PDF / Word）

**PDF**：`jsPDF` + `html2canvas`（管制圖截圖嵌入，解析度 2x retina）。
**Word**：`docx` npm 套件（程式碼產生 .docx，管制圖以圖片插入）。

報告結構：整體評估 → 優點（脫離異常/趨勢好轉/追趕同儕）→ 缺點（新發/持續/趨勢危險/同儕拉開）→ 改善優先清單 → 全指標狀態一覽 → 附件管制圖截圖。

---

## 15. 部署策略

### 15.1 Static Export（推薦）

Next.js `output: 'export'` 編譯為純靜態 HTML/CSS/JS。承辦人拿到資料夾，點開 `index.html` 就能用。Dexie/IndexedDB 在瀏覽器直接運作，零安裝。

**前提**：不使用 API Routes、SSR 等 server-side 功能。所有邏輯為 client-side。

### 15.2 開發 vs 交付

- **GitHub**：開發者（你）的版控和開發環境
- **交付**：每次更新後 `npm run build` 輸出靜態檔，複製到共用資料夾或隨身碟

### 15.3 AI 功能的網路需求

AI 深度分析需要網路連線（呼叫 Anthropic API）。其他所有功能完全離線可用。

---

## 16. 技術棧與專案結構

### 16.1 技術棧

| 層次 | 技術 | 用途 |
|------|------|------|
| 框架 | Next.js + TypeScript | 主框架 |
| 樣式 | Tailwind CSS | UI 樣式 |
| 圖表 | Recharts | 管制圖、趨勢圖、Sparkline |
| 儲存 | Dexie (IndexedDB) | 持久化資料庫 |
| Excel 解析 | SheetJS (xlsx) | .xls/.xlsx 讀取 |
| PDF 匯出 | jsPDF + html2canvas | 季度報告 |
| Word 匯出 | docx npm package | 季度報告 |
| 狀態管理 | Zustand | 全域狀態（viewMode 等） |
| AI | Anthropic Claude API | 深度分析（瀏覽器直呼） |

### 16.2 專案結構

```
src/
├── app/                              # Next.js App Router
│   ├── page.tsx                      # 全院總覽
│   ├── category/[id]/page.tsx        # 類別頁
│   ├── indicator/[id]/page.tsx       # 指標詳情
│   ├── import/page.tsx               # 匯入頁
│   ├── cross-campus/                 # ★ 新增：跨院區季度分析
│   │   └── page.tsx                  # 統整表 + AI 分析（Tab 雙模式）
│   ├── quarterly/
│   │   ├── overview/page.tsx         # 季度總覽
│   │   ├── tracking/page.tsx         # 異常追蹤
│   │   └── analysis/page.tsx         # 季度變化分析
│   └── settings/
│       ├── page.tsx                  # 設定總頁
│       ├── indicators/page.tsx       # 指標管理
│       ├── benchmarks/page.tsx       # TCPI 標竿管理
│       └── ai/page.tsx              # AI 設定（API Key + 啟用開關）
├── components/
│   ├── charts/
│   │   ├── ControlChart.tsx          # 管制圖元件
│   │   ├── TrendOverlay.tsx          # 多年度趨勢疊加
│   │   ├── Sparkline.tsx             # 迷你趨勢圖
│   │   └── StatusMatrix.tsx          # 狀態熱力圖
│   ├── cards/
│   │   ├── AlertCard.tsx             # 異常摘要卡片
│   │   ├── IndicatorCard.tsx         # 指標卡片
│   │   └── StatsSummary.tsx          # 統計摘要
│   ├── cross-campus/                 # ★ 新增
│   │   ├── CrossCampusTable.tsx      # 統整表（Tab 1）
│   │   ├── CampusAIPanel.tsx         # 單一院區 AI 分析結果
│   │   ├── CommonIssuesPanel.tsx     # 共通問題 AI 分析結果
│   │   └── CrossCampusAITab.tsx      # AI 分析 Tab 整體容器
│   ├── quarterly/
│   │   ├── ViewModeSwitch.tsx        # 月/季切換
│   │   ├── QuarterlySummaryCards.tsx  # 四張摘要卡片
│   │   ├── ChangeSection.tsx         # 優點/缺點共用區塊
│   │   ├── PriorityCard.tsx          # 改善優先清單卡片
│   │   └── AIPanelWidget.tsx         # AI 分析展開面板
│   ├── ai/
│   │   └── AIAnalysisPanel.tsx       # ★ 單指標 AI 分析面板（已實作）
│   ├── import/
│   │   ├── UploadZone.tsx            # 拖曳上傳
│   │   ├── ParsePreview.tsx          # 解析預覽
│   │   ├── MatchingReview.tsx        # 模糊比對確認
│   │   └── DiffReport.tsx            # 差異報告
│   ├── indicators/
│   │   ├── IndicatorForm.tsx         # 新增/編輯指標
│   │   └── IndicatorList.tsx         # 指標管理清單
│   └── layout/
│       ├── Sidebar.tsx               # 側邊導航（含季度分析入口）
│       ├── Header.tsx                # 頂部欄
│       └── CampusSwitch.tsx          # 院區切換
├── lib/
│   ├── db/
│   │   ├── schema.ts                # Dexie schema（§3.2）
│   │   ├── operations.ts            # CRUD 操作
│   │   └── migrations.ts            # 版本遷移
│   ├── engine/
│   │   ├── controlChart.ts          # SPC 計算（§4）
│   │   ├── anomalyDetector.ts       # 三層異常偵測（§5）
│   │   ├── statusEngine.ts          # 六級燈號（§6）
│   │   ├── quarterlyEngine.ts       # 季度彙整（§10）
│   │   └── changeAnalysisEngine.ts  # 季度變化分類（§11）
│   ├── matching/
│   │   ├── normalizer.ts            # 名稱標準化
│   │   ├── matchingEngine.ts        # 五層比對策略
│   │   └── similarity.ts            # 相似度計算
│   ├── ai/
│   │   ├── apiKeyManager.ts         # Key 加密儲存
│   │   ├── promptBuilder.ts         # Prompt 組裝
│   │   ├── claudeClient.ts          # API 呼叫
│   │   ├── safetyGate.ts            # 資料安全閘門
│   │   └── usageTracker.ts          # 費用追蹤
│   ├── parser/
│   │   ├── excelParser.ts           # Excel 解析
│   │   └── valueCleaner.ts          # 數值清洗
│   ├── export/
│   │   ├── pdfExporter.ts           # PDF 匯出
│   │   └── wordExporter.ts          # Word 匯出
│   ├── constants/
│   │   ├── indicators.ts            # 預設指標定義清單
│   │   ├── categories.ts            # 類別定義
│   │   └── causeDirectionKB.json    # 原因方向知識庫
│   └── types/
│       └── index.ts                 # 全域型別定義（§3.3）
├── stores/
│   └── dashboardStore.ts            # Zustand store
└── utils/
    ├── statistics.ts                # 統計工具
    └── formatters.ts                # 格式化工具
```

---

## 17. 開發階段與時程

### Phase 1：資料層 + 統計引擎（第 1-3 週）

- [ ] Dexie schema 建立（全部表）
- [ ] Excel 解析器（含分子/分母提取、110 年格式處理）
- [ ] 數值清洗引擎
- [ ] I-MR / P / U Chart 計算模組（含基線窗口 24 點）
- [ ] 三層異常偵測引擎
- [ ] 六級狀態引擎
- [ ] 單元測試

### Phase 2：月度 UI（第 3-5 週）

- [ ] 全域總覽頁（狀態摘要卡片、警示橫幅）
- [ ] 指標卡片元件（數值 + 燈號 + Sparkline + 標竿）
- [ ] 管制圖元件（Recharts，支援 I-MR/P/U 三種、西方電氣法則標記）
- [ ] 指標詳情頁（管制圖 + 三層判定 + 歷史數據）
- [ ] 卡片/表格雙模式切換
- [ ] 搜尋與面向篩選
- [ ] 院區切換

### Phase 3：匯入系統（第 5-6 週）

- [ ] 拖曳上傳 + Excel 解析預覽
- [ ] 模糊比對引擎（五層策略）
- [ ] 比對結果確認介面
- [ ] 比對記憶機制
- [ ] 資料驗證與差異報告
- [ ] 匯入後自動觸發重新計算

### Phase 4：指標管理 + TCPI（第 6-7 週）

- [ ] 指標管理頁面（CRUD + 別名管理）
- [ ] TCPI 標竿匯入流程
- [ ] 管制圖上 TCPI 標竿線顯示

### Phase 5：季度模式（第 7-10 週）

- [ ] ViewModeSwitch 全域切換
- [ ] 季度彙整計算引擎
- [ ] 季度總覽（四張摘要卡片 + 追蹤表）
- [ ] 季度變化分析頁（四層結構）
- [ ] 改善優先排序演算法
- [ ] 原因方向知識庫查詢
- [ ] Sparkline + 內嵌迷你管制圖

### Phase 6：AI 深度分析（第 10-11 週）

- [ ] API Key 加密儲存模組
- [ ] 資料安全檢查閘門
- [ ] Prompt 組裝 + 回應解析
- [ ] Claude API 呼叫（含錯誤處理、超時、重試）
- [ ] AI 分析面板 UI
- [ ] 快取機制
- [ ] 費用追蹤 + 用量顯示

### Phase 7：跨院區季度分析（第 11-12 週）

- [ ] Sidebar 新增「季度分析」入口（匯入紀錄上方）
- [ ] 跨院區頁面架構（`app/cross-campus/page.tsx`）
- [ ] Tab 1 — 統整表：`CrossCampusTable.tsx`
  - [ ] 讀取目前季度 + 上一季度所有院區數據
  - [ ] 只顯示有異常的指標（任一院區異常即列入）
  - [ ] 單一院區特有指標標示「院區特色」
  - [ ] 三院區欄位橫向比較（燈號 + 值 + 趨勢）
- [ ] Tab 2 — AI 分析（需 AI 啟用）：`CrossCampusAITab.tsx`
  - [ ] 費用提示（4 次 API 呼叫，約 NT$2-4）
  - [ ] 三院區並行分析（`CampusAIPanel.tsx` × 3）
  - [ ] 共通問題分析（`CommonIssuesPanel.tsx`，三院區結果出來後觸發）
  - [ ] 各分析卡片獨立快取（cache key = campus + quarter）
- [ ] 設定頁 AI 啟用開關（`app/settings/ai/page.tsx`）

### Phase 8：匯出 + 收尾（第 12-14 週）

- [ ] PDF 季度報告匯出（含管制圖截圖）
- [ ] Word 季度報告匯出
- [ ] 響應式設計（平板/手機）
- [ ] 效能最佳化
- [ ] Static Export 驗證
- [ ] 使用者手冊

### 總工期：約 14 週（不含 AI）/ 約 17 週（含 AI + 跨院區分析 + 匯出）

> AI 分析（Phase 6）與跨院區季度分析（Phase 7）可與 Phase 5 部分平行開發，實際 critical path 約 14 週。

---

## 給 Claude Code 的實作提示（精華版）

1. **先做月度，再做季度**：季度數據完全依賴月度引擎。
2. **管制圖基線 = 最近 24 個有效點**，不是全部歷史。
3. **相同指標代碼 = 相同圖型**，不因院區不同。
4. **分子/分母是升級管制圖的基礎**：有 → P/U Chart；無 → I-MR。
5. **原因方向知識庫用 JSON 配置**，不要 hardcode。
6. **優點區和缺點區共用 `ChangeSection` 元件**，用 props 切換。
7. **品管備註欄位 debounce 500ms 自動存檔**。
8. **AI 安全閘門是 non-negotiable 的**，不能跳過。
9. **不做 streaming**：AI 分析等全部回來再渲染，解析更可靠。
10. **Static Export 前提**：不用 API Routes、SSR。全部 client-side。
11. **`anthropic-dangerous-direct-browser-access` header 是必要的**。
12. **快取 hash 只包含影響分析結果的數據**，不含 timestamp。
13. **季末月判定持續異常**，但展示整季三個月軌跡。
14. **LCL 不得小於 0**；P Chart UCL 不得大於 1。
15. **年份用民國年**，不需轉換西元。
