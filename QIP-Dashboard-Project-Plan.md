# QIP 持續性監測指標儀表板 — 專案計畫書

> **用途**：本文件作為與 Claude Code 溝通的完整藍圖，涵蓋需求、資料結構、異常偵測邏輯、技術架構與開發階段。

---

## 1. 專案概述

### 1.1 背景

本專案為某區域教學醫院（竹北院區 + 竹東院區）建置「QIP 持續性監測指標儀表板」。醫院每月產出品質指標報表（Excel），橫跨民國 110–115 年度。目前資料以人工 Excel 管理，缺乏自動化異常偵測與趨勢分析能力。

### 1.2 核心目標

將醫院評鑑從「每三年一次大考」轉型為「每月小考」的持續監測模式。儀表板必須能：

1. **自動偵測異常**：透過管制圖（Control Chart）、月增減幅度、同儕值比較三重機制
2. **累積歷史資料**：每月匯入新資料時自動新增數據點，並回溯核對歷史資料一致性
3. **視覺化決策支援**：讓管理層在 2 秒內掌握全院品質狀態

### 1.3 雙院區結構

| 院區 | 代碼 | 指標數量 | 特有類別 |
|------|------|----------|----------|
| 竹北 | `zhubei` | 約 33 項 | 產科照護 |
| 竹東 | `zhudong` | 約 27 項 | 呼吸照護 |

---

## 2. 資料結構規格

### 2.1 Excel 原始檔結構

每月報表為一份 Excel 檔案（`.xlsx`），包含約 17 個工作表（worksheets），每個工作表對應一個指標類別或院區組合。

#### 工作表命名慣例

```
{院區}_{類別簡稱}
例：竹北_整體性照護、竹東_加護病房、竹北_手術照護
```

#### 每張工作表的欄位結構

```
| 指標名稱 | 計算公式 | 方向性 | 同儕值 | 110年1月 | 110年2月 | ... | 115年12月 | 110年度 | 111年度 | ... |
```

**關鍵欄位說明**：

- **指標名稱**：中文全稱（如「非計畫性重返急診率(72hr)」）
- **計算公式**：分子/分母定義（文字描述）
- **方向性**：`↓`（越低越好）、`↑`（越高越好）、`→`（監測型，無明確好壞）
- **同儕值**：全國同層級醫院基準值（可能為空）
- **月份欄位**：`{民國年}{月}月` 格式，值為數值型（百分比/千分比/次數）
- **年度欄位**：該年度的加總或平均值

### 2.2 數值單位問題（重要）

原始 Excel 中**單位不一致**，解析時必須處理：

| 單位類型 | 範例指標 | 原始值範例 | 說明 |
|----------|----------|-----------|------|
| 百分比 `%` | 手術部位感染率 | `1.2` 或 `0.012` | 可能以小數或百分比呈現 |
| 千分比 `‰` | 住院死亡率、跌倒密度 | `15.2` | 每千人次/人日 |
| 純數值 | 事件通報件數 | `23` | 計次型指標 |

**解析規則**：若同一指標歷史數據中，部分值 < 1 而其他值 > 1，需判斷是否為單位不一致（如 `0.012` vs `1.2`），統一轉換為同一基準。

### 2.3 內部標準化資料格式

解析 Excel 後，所有資料應轉換為以下 JSON 結構儲存：

```json
{
  "indicator_id": "overall-1",
  "indicator_name": "住院死亡率",
  "category": "整體性照護",
  "campus": "zhubei",
  "direction": "lower",
  "unit": "‰",
  "peer_value": 15.2,
  "formula": "住院期間死亡人數 / 住院人次 × 1000",
  "data_points": [
    { "year": 110, "month": 1, "value": 14.3 },
    { "year": 110, "month": 2, "value": 15.1 },
    ...
  ],
  "yearly_summary": [
    { "year": 110, "value": 14.8 },
    ...
  ]
}
```

---

## 3. 九大指標類別與指標清單

### 3.1 類別總覽

| # | 類別 | 竹北 | 竹東 | 主要指標舉例 |
|---|------|:----:|:----:|------------|
| 1 | 整體性照護 | ✓ | ✓ | 住院死亡率、非計畫重返急診/ICU |
| 2 | 加護病房照護 | ✓ | ✓ | 院內感染密度、VAP、CLABSI、CAUTI |
| 3 | 手術照護 | ✓ | ✓ | 手術部位感染率、非計畫重返手術室 |
| 4 | 產科照護 | ✓ | ✗ | Apgar<7分比率、產後大出血率 |
| 5 | 急診照護 | ✓ | ✓ | 暫留>48hr、72hr再返率 |
| 6 | 關鍵照護 | ✓ | ✓ | 跌倒密度、約束盛行密度 |
| 7 | 感染管制 | ✓ | ✓ | 組合式照護執行率、手部衛生遵從率 |
| 8 | 用藥安全 | ✓ | ✓ | 藥物不良事件通報率、處方錯誤率 |
| 9 | 呼吸照護 | ✗ | ✓ | 呼吸器脫離率 |
| 10 | 經營管理 | ✓ | ✓ | 病床使用率 |

### 3.2 方向性定義

- **`lower`（↓ 越低越好）**：死亡率、感染率、錯誤率 — 超過上限為異常
- **`higher`（↑ 越高越好）**：遵從率、執行率、脫離率 — 低於下限為異常
- **`monitor`（→ 持續監測）**：通報率、病床使用率 — 劇烈波動為異常

---

## 4. 異常偵測引擎（三重機制）

這是本儀表板的核心價值。每個指標的每個新數據點都必須經過以下三重檢測。

### 4.1 機制一：管制圖（Control Chart）

採用 **X̄ 管制圖（Individual Chart / I-Chart）**，因每月僅一個數據點。

#### 4.1.1 管制界限計算

```
CL（中心線）= 所有歷史數據點的平均值 X̄
σ（標準差）= 樣本標準差（使用 n-1）
UCL（管制上限）= CL + 3σ
LCL（管制下限）= max(0, CL - 3σ)
```

**最低數據量要求**：至少需要 **6 個數據點** 才能建立管制圖；20 個以上較為穩定可靠。數據點不足時，應顯示提示訊息而非強行繪製管制圖。

#### 4.1.2 管制圖判定規則（Western Electric Rules 簡化版）

| 規則 | 條件 | 嚴重度 | 說明 |
|------|------|--------|------|
| Rule 1 | 單點超出 ±3σ | 🔴 Critical | 明確失控 |
| Rule 2 | 單點超出 ±2σ | 🟡 Warning | 警戒區域 |
| Rule 3 | 連續 7 點在 CL 同側 | 🟡 Warning | 趨勢偏移（shift） |
| Rule 4 | 連續 7 點遞增或遞減 | 🟡 Warning | 趨勢走勢（trend） |
| Rule 5 | 連續 3 點中有 2 點在 ±2σ 外 | 🟡 Warning | 不穩定波動 |

#### 4.1.3 方向性與管制圖的結合

- **`lower` 指標**：僅關注**超出 UCL** 為不良；低於 LCL 反而是好事（可標記為改善）
- **`higher` 指標**：僅關注**低於 LCL** 為不良；超出 UCL 反而是好事
- **`monitor` 指標**：UCL 和 LCL 都關注，雙向異常均需警示

### 4.2 機制二：月增減幅度 ≥ 10%

```
變化率 = (當月值 - 上月值) / |上月值| × 100%
```

#### 判定邏輯

| 方向性 | 增加 ≥10% | 減少 ≥10% |
|--------|----------|----------|
| `lower` | 🟡 不利警告 | ✅ 改善（正面） |
| `higher` | ✅ 改善（正面） | 🟡 不利警告 |
| `monitor` | ⚠️ 大幅波動 | ⚠️ 大幅波動 |

**邊界處理**：上月值為 0 時，不計算變化率，改為標記「基期為零」。

### 4.3 機制三：同儕值比較

與全國同層級醫院基準值比較，判定是否有顯著差異。

```
差異率 = (本院值 - 同儕值) / 同儕值 × 100%
```

#### 判定邏輯

| 方向性 | 條件 | 狀態 |
|--------|------|------|
| `lower` | 本院值 > 同儕值 × 1.10 | 🟡 顯著高於同儕（不利） |
| `lower` | 本院值 ≤ 同儕值 × 0.90 | ✅ 顯著優於同儕 |
| `higher` | 本院值 < 同儕值 × 0.90 | 🟡 顯著低於同儕（不利） |
| `higher` | 本院值 ≥ 同儕值 × 1.10 | ✅ 顯著優於同儕 |
| `monitor` | 差異率絕對值 > 20% | ⚠️ 與同儕差異大 |

**注意**：同儕值可能為空（部分指標無全國基準），此時跳過此機制。

### 4.4 綜合判定等級

每個指標的每個數據點，依據三重機制的結果，給予一個綜合狀態：

| 等級 | 顏色 | 條件 |
|------|------|------|
| 🔴 **Alert** | 紅色 | 管制圖 Rule 1 觸發（超出 3σ） |
| 🟠 **Warning** | 橙色 | 管制圖 Rule 2-5 觸發，或月增減不利 ≥10% 且同儕比較也不利 |
| 🟡 **Watch** | 黃色 | 僅觸發月增減 ≥10%（不利方向）或僅觸發同儕比較不利 |
| 🟢 **Good** | 綠色 | 無任何異常 |
| 🔵 **Excellent** | 藍色 | 改善方向且優於同儕 |

---

## 5. 資料持久化與匯入邏輯

### 5.1 儲存架構

使用 **IndexedDB**（瀏覽器端持久化資料庫），透過 `Dexie.js` 封裝操作。

> **為什麼不用後端資料庫？** 本專案為純前端應用（React SPA），無需架設伺服器，降低醫院 IT 部署門檻。IndexedDB 可儲存大量結構化資料且跨 session 持久保存。

#### 資料庫 Schema

```javascript
const db = new Dexie('QIPDatabase');
db.version(1).stores({
  // 指標定義表
  indicators: 'id, category, campus, direction',
  
  // 數據點表（核心）
  dataPoints: '[indicator_id+campus+year+month], indicator_id, campus, year, month, value',
  
  // 年度彙總表
  yearlySummary: '[indicator_id+campus+year], indicator_id, campus, year',
  
  // 匯入紀錄表（追蹤每次匯入）
  importLogs: '++id, timestamp, filename, status',
  
  // 異常紀錄表
  alerts: '++id, [indicator_id+campus+year+month], type, severity, timestamp',
  
  // 同儕基準值表（可獨立更新）
  peerValues: '[indicator_id+year], indicator_id, year'
});
```

### 5.2 每月資料匯入流程

```
使用者上傳 Excel
    │
    ▼
[1] SheetJS 解析工作表 ──→ 擷取所有月份數據
    │
    ▼
[2] 資料標準化 ──→ 統一單位、格式轉換、null 處理
    │
    ▼
[3] 比對現有資料庫 ──→ 逐筆核對：
    │   ├─ 新數據點 → INSERT
    │   ├─ 已存在且值相同 → SKIP
    │   └─ 已存在但值不同 → UPDATE + 記錄差異
    │
    ▼
[4] 觸發異常偵測引擎 ──→ 對所有新增/更新的數據點執行三重檢測
    │
    ▼
[5] 產生匯入報告 ──→ 顯示：
    ├─ 新增 N 筆數據點
    ├─ 更新 M 筆數據點（列出差異）
    ├─ 偵測到 K 項異常
    └─ 同儕值有無更新
```

### 5.3 歷史資料核對邏輯

每次匯入時，不僅新增當月資料，還要**回溯核對過去數據是否被修正**：

```
for each dataPoint in newExcelData:
    existingValue = db.get(indicator_id, campus, year, month)
    if existingValue exists AND existingValue ≠ newValue:
        log({
            type: "data_revision",
            indicator: indicator_id,
            period: year/month,
            old_value: existingValue,
            new_value: newValue,
            revision_date: now()
        })
        update db with newValue
```

這確保了醫院事後修正數據（如延遲通報的感染案例）時，系統能追蹤資料變更歷史。

---

## 6. 前端架構與 UI 設計

### 6.1 技術棧

```
框架：      Next.js 14+ (App Router) 或 Vite + React 18
語言：      TypeScript
樣式：      Tailwind CSS
圖表：      Recharts（管制圖、趨勢圖）
Excel 解析： SheetJS (xlsx)
資料庫：    Dexie.js (IndexedDB 封裝)
狀態管理：  Zustand（輕量）
```

### 6.2 頁面結構

```
/
├── 全院總覽儀表板（Dashboard Overview）
│   ├── 院區切換（竹北/竹東/雙院區比較）
│   ├── 異常指標摘要卡片
│   └── 全指標狀態矩陣（熱力圖）
│
├── /category/{categoryId}
│   └── 類別層級頁面（如：感染管制下的所有指標）
│
├── /indicator/{indicatorId}
│   ├── 管制圖（主圖）
│   ├── 趨勢疊加圖（多年度同月比較）
│   ├── 異常事件時間軸
│   ├── 同儕比較視覺化
│   └── 數據表格（可編輯）
│
├── /import
│   ├── Excel 上傳區
│   ├── 解析預覽
│   ├── 差異比對報告
│   └── 確認匯入
│
└── /settings
    ├── 同儕基準值管理
    ├── 管制圖參數設定（σ 倍數、最低數據點數）
    ├── 資料庫匯出/備份
    └── 匯入歷史紀錄
```

### 6.3 核心元件設計

#### 6.3.1 全院總覽 — 狀態矩陣（最重要的 2 秒視圖）

```
                    1月  2月  3月  4月  5月  6月  7月  8月  ...
住院死亡率           🟢  🟢  🟡  🟢  🟢  🟠  🟢  🟢
非計畫重返急診        🟢  🟢  🟢  🟢  🟡  🟢  🟢  🔴
加護病房感染密度      🟢  🟡  🟢  🟢  🟢  🟢  🟢  🟢
手術部位感染率        🟢  🟢  🟢  🔵  🟢  🟢  🟡  🟢
...
```

實作為一個 **熱力圖矩陣**，每個格子就是該指標該月的綜合判定顏色。點擊任一格可跳轉至該指標的管制圖詳情。

#### 6.3.2 管制圖元件（Control Chart Component）

```
Props:
  - dataPoints: Array<{year, month, value}>
  - controlLimits: { CL, UCL, LCL, UCL2, LCL2 }
  - peerValue: number | null
  - direction: 'lower' | 'higher' | 'monitor'
  - alerts: Array<Alert>

視覺元素：
  - 數據折線（主線）
  - CL 中心線（實線，深灰）
  - UCL/LCL 3σ 線（虛線，紅色）
  - UCL2/LCL2 2σ 線（虛線，橙色）
  - 同儕值參考線（點線，藍色）
  - 異常點標記（紅點放大 + tooltip）
  - 背景色帶：
    - 綠色帶：CL ± 1σ（正常區）
    - 黃色帶：1σ ~ 2σ（警戒區）
    - 紅色帶：2σ ~ 3σ（危險區）
```

#### 6.3.3 異常摘要卡片

每張卡片顯示一個異常指標的關鍵資訊：

```
┌─────────────────────────────────────┐
│ 🔴 住院死亡率          竹北院區      │
│                                     │
│ 當月值：18.7‰    同儕值：15.2‰      │
│ 管制上限：17.3‰  ← 超出 UCL        │
│ 較上月：+12.3%                      │
│                                     │
│ [迷你趨勢圖 sparkline ~~~~~~~~📍]   │
│                                     │
│ 觸發規則：3σ超限 / 月增>10% / 高於同儕│
│ > 查看詳情                          │
└─────────────────────────────────────┘
```

#### 6.3.4 匯入介面

```
Step 1: 拖曳上傳 Excel 檔案
Step 2: 系統解析並顯示：
        - 辨識到的院區
        - 辨識到的指標數量
        - 資料期間範圍
        - 預覽前 5 筆數據
Step 3: 差異比對報告
        - 新增數據點清單
        - 與既有資料的差異清單（值變更）
        - 異常偵測預警清單
Step 4: 確認匯入（或取消）
```

### 6.4 色彩系統

```css
:root {
  /* 狀態色 */
  --alert:     #DC2626;  /* 紅 - 失控 */
  --warning:   #EA580C;  /* 橙 - 警告 */
  --watch:     #CA8A04;  /* 黃 - 關注 */
  --good:      #16A34A;  /* 綠 - 正常 */
  --excellent: #2563EB;  /* 藍 - 優良 */
  
  /* 管制圖色帶 */
  --zone-normal:  rgba(22, 163, 74, 0.08);   /* 1σ 內 */
  --zone-caution: rgba(234, 88, 12, 0.08);   /* 1σ-2σ */
  --zone-danger:  rgba(220, 38, 38, 0.08);   /* 2σ-3σ */
  
  /* 界面色 */
  --bg-primary:   #FAFAF9;
  --bg-card:      #FFFFFF;
  --text-primary: #1C1917;
  --text-muted:   #78716C;
  --border:       #E7E5E4;
}
```

---

## 7. 指標管理機制

### 7.1 雙軌設計原則

指標來源採**預設 + 動態**雙軌制：

- **預設指標清單**：寫在 `src/lib/constants/indicators.ts`，隨程式碼部署，涵蓋目前已知的所有 QIP 指標（竹北約 33 項、竹東約 27 項）。這些指標無法從介面刪除，僅能編輯屬性。
- **動態新增指標**：使用者可從「設定 > 指標管理」介面自行新增指標，儲存於 IndexedDB 的 `indicators` 表。這些指標與預設指標享有完全相同的功能（管制圖、異常偵測、同儕比較）。

```typescript
// 指標完整型別定義
interface Indicator {
  id: string;
  source: 'preset' | 'custom';  // 區分來源
  name: string;
  aliases: string[];              // 別名清單，用於 Excel 模糊比對
  category: string;
  campus: ('zhubei' | 'zhudong')[];
  direction: 'lower' | 'higher' | 'monitor';
  unit: '%' | '‰' | '次' | '件' | '人' | '天';
  peerValue: number | null;
  formula: string;
  description: string;
  isActive: boolean;              // 可停用而非刪除
  createdAt: string;              // 動態新增的時間戳
}
```

### 7.2 指標管理介面

位於 `/settings/indicators`，功能如下：

```
┌──────────────────────────────────────────────────────────┐
│  指標管理                                    [＋ 新增指標] │
│──────────────────────────────────────────────────────────│
│  🔍 搜尋指標...          篩選：[全部▾] [竹北▾] [竹東▾]    │
│──────────────────────────────────────────────────────────│
│                                                          │
│  整體性照護 (3)                                           │
│  ┌────────────────────────────────────────────────────┐  │
│  │ 📌 住院死亡率              ‰  ↓  同儕:15.2  [編輯] │  │
│  │    預設指標 │ 竹北 竹東 │ 別名：住院死亡千分率       │  │
│  ├────────────────────────────────────────────────────┤  │
│  │ 📌 非計畫性重返急診率(72hr)  %  ↓  同儕:3.8  [編輯] │  │
│  │    預設指標 │ 竹北 竹東 │ 別名：72小時重返急診      │  │
│  ├────────────────────────────────────────────────────┤  │
│  │ 🔧 自訂指標A               %  ↑  同儕:--   [編輯]  │  │
│  │    動態新增 │ 竹北    │ 2025/03/01 新增  [停用][刪除]│  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  加護病房照護 (4)                                         │
│  ...                                                     │
└──────────────────────────────────────────────────────────┘
```

#### 新增指標表單欄位

| 欄位 | 必填 | 說明 |
|------|:----:|------|
| 指標名稱 | ✓ | 主要名稱，用於顯示 |
| 別名 | — | 可多筆，用於 Excel 模糊比對（如「CAUTI」↔「導尿管相關泌尿道感染」） |
| 類別 | ✓ | 下拉選擇九大類別，或可輸入新類別 |
| 適用院區 | ✓ | 勾選竹北 / 竹東（可複選） |
| 方向性 | ✓ | 越低越好 / 越高越好 / 持續監測 |
| 單位 | ✓ | 下拉選擇 |
| 同儕基準值 | — | 數值，可為空 |
| 計算公式 | — | 文字描述（分子/分母） |
| 說明 | — | 補充文字 |

### 7.3 Excel 指標名稱模糊比對引擎

匯入 Excel 時，需將工作表中的指標名稱對應到系統內的指標定義。由於 Excel 中的名稱可能有微小差異，採用**模糊比對**策略。

#### 7.3.1 標準化前處理

在比對之前，先將系統指標名稱和 Excel 來源名稱都經過同一套標準化流程：

```typescript
function normalizeName(raw: string): string {
  return raw
    .trim()
    // 1. 全形 → 半形
    .replace(/[\uff08]/g, '(')
    .replace(/[\uff09]/g, ')')
    .replace(/[\uff1a]/g, ':')
    .replace(/[\u3000]/g, ' ')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch =>
      String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
    )
    // 2. 移除所有空白
    .replace(/\s+/g, '')
    // 3. 統一小寫
    .toLowerCase()
    // 4. 移除常見贅詞
    .replace(/^指標[：:]/g, '')
    .replace(/比率$/g, '率')
    .replace(/比例$/g, '率');
}
```

#### 7.3.2 多層比對策略

比對依照信心度由高到低逐層嘗試，一旦命中即停止：

```
Layer 1: 完全比對
         normalizeName(excel名稱) === normalizeName(系統名稱)
         → 信心度 100%，直接配對

Layer 2: 別名比對
         normalizeName(excel名稱) === normalizeName(任一別名)
         → 信心度 100%，直接配對

Layer 3: 包含比對
         normalizeName(系統名稱).includes(normalizeName(excel名稱))
         或反向包含
         → 信心度 80%，自動配對但在匯入報告中標記

Layer 4: 相似度比對（Levenshtein / Dice coefficient）
         similarity(normalized_excel, normalized_system) > 0.75
         → 信心度 60%，不自動配對，列入「待確認」清單

Layer 5: 無法配對
         → 列入「未識別指標」清單，使用者可：
           (a) 手動指派到現有指標
           (b) 以此名稱新增為動態指標
           (c) 略過不匯入
```

#### 7.3.3 匯入時的比對結果介面

```
┌──────────────────────────────────────────────────────────┐
│  指標比對結果                                             │
│──────────────────────────────────────────────────────────│
│                                                          │
│  ✅ 自動配對成功 (28 項)                                  │
│  ┌──────────────────────────────────────────────────┐    │
│  │ Excel 名稱                  →  系統指標    信心度  │    │
│  │ 住院死亡率                  →  住院死亡率    100%  │    │
│  │ 非計畫性重返急診率（72hr）   →  非計畫性重返  100%  │    │
│  │ 手術部位感染率              →  手術部位感染率 100%  │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  ⚠️ 需要確認 (2 項)                                      │
│  ┌──────────────────────────────────────────────────┐    │
│  │ Excel: "CVC組合式照護落實率"                       │    │
│  │ 建議:  組合式照護執行率-CVC (相似度 78%)           │    │
│  │        [確認配對] [選擇其他指標▾] [新增為新指標]    │    │
│  ├──────────────────────────────────────────────────┤    │
│  │ Excel: "呼吸器脫離成功率"                          │    │
│  │ 建議:  呼吸器脫離率 (相似度 82%)                   │    │
│  │        [確認配對] [選擇其他指標▾] [新增為新指標]    │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  ❌ 未識別 (1 項)                                        │
│  ┌──────────────────────────────────────────────────┐    │
│  │ Excel: "門診抗生素使用密度"                         │    │
│  │ 系統中無相似指標                                    │    │
│  │ [手動指派到現有指標▾] [新增為新指標] [略過]         │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│                           [返回修改]  [確認並繼續匯入]    │
└──────────────────────────────────────────────────────────┘
```

#### 7.3.4 比對記憶機制

使用者手動確認的配對關係會被記憶，存入 IndexedDB 的 `matchingRules` 表：

```typescript
interface MatchingRule {
  excelName: string;           // Excel 中出現的原始名稱
  normalizedName: string;      // 標準化後的名稱
  indicatorId: string;         // 對應的系統指標 ID
  confirmedAt: string;         // 確認時間
}
```

下次匯入時，若同樣的 Excel 名稱再次出現，直接使用已記憶的配對結果，不再詢問。

### 7.4 Dexie Schema 更新

配合指標管理功能，新增 `matchingRules` 表：

```javascript
db.version(2).stores({
  // ...原有表不變...

  // 指標定義表（擴充）
  indicators: 'id, category, *campus, direction, source, isActive',

  // 名稱比對記憶表（新增）
  matchingRules: 'normalizedName, indicatorId, confirmedAt',
});
```

---

## 8. 開發階段規劃

### Phase 1：資料層（Data Layer）— 第 1-2 週

**目標**：建立 IndexedDB 資料庫、Excel 解析引擎、資料標準化模組

- [ ] 設定 Dexie.js schema 與資料庫初始化
- [ ] 實作 SheetJS Excel 解析器
  - 自動辨識院區與指標
  - 處理單位不一致（%, ‰, 小數）
  - null / 空值處理
- [ ] 資料標準化管線（raw → normalized JSON）
- [ ] 匯入比對邏輯（新增 / 更新 / 差異追蹤）
- [ ] 匯入紀錄與資料變更歷史
- [ ] 基礎 CRUD 操作封裝

**驗收標準**：能匯入一份完整 Excel，存入 IndexedDB，再次匯入同檔案時正確辨識「無新資料」。

### Phase 2：異常偵測引擎 — 第 2-3 週

**目標**：實作三重異常偵測機制

- [ ] 管制圖統計計算模組
  - CL / UCL / LCL / σ 計算
  - Western Electric Rules（5 條規則）
  - 最低數據量檢查（< 6 點時提示）
- [ ] 月增減幅度偵測
  - 變化率計算
  - 方向性判斷（不利 vs 改善）
- [ ] 同儕值比較模組
  - 差異率計算
  - 方向性敏感判定
- [ ] 綜合判定等級引擎
  - 整合三機制 → Alert / Warning / Watch / Good / Excellent
- [ ] 全部偵測結果寫入 alerts 表

**驗收標準**：給定一組已知數據，偵測結果與人工判讀一致。

### Phase 3：核心 UI 元件 — 第 3-5 週

**目標**：建立所有核心視覺元件

- [ ] 全院總覽頁
  - 院區切換器（Tab）
  - 狀態矩陣（熱力圖）
  - 異常摘要卡片列
  - 統計摘要（正常/警告/異常 指標數）
- [ ] 管制圖元件（Recharts）
  - 數據線 + 管制線 + 同儕線
  - 背景色帶（σ 區間）
  - 異常點標記與 tooltip
  - 年度切換 / 全期檢視
- [ ] 指標詳情頁
  - 管制圖（主圖）
  - 多年度趨勢疊加圖
  - 異常事件時間軸
  - 數據表格
- [ ] 類別頁面
  - 該類別下所有指標的迷你圖列表
  - 類別層級異常摘要

**驗收標準**：能在畫面上正確顯示帶管制線的圖表，異常點以紅色標記。

### Phase 4：匯入功能 — 第 5-6 週

**目標**：完成 Excel 匯入的完整 UI 流程

- [ ] 拖曳上傳介面
- [ ] 解析進度條與預覽
- [ ] 差異比對報告頁面
- [ ] 確認 / 取消匯入流程
- [ ] 匯入後自動重新計算管制圖與偵測結果
- [ ] 匯入歷史紀錄頁

**驗收標準**：從上傳 Excel 到看到更新後的儀表板，整個流程 < 30 秒。

### Phase 4.5：指標管理與模糊比對 — 第 6 週

**目標**：完成指標的動態新增/編輯介面與 Excel 模糊比對引擎

- [ ] 指標管理頁面（CRUD 介面）
  - 預設指標的編輯功能（不可刪除）
  - 動態指標的新增 / 編輯 / 停用 / 刪除
  - 別名管理（新增 / 移除）
- [ ] 模糊比對引擎
  - `normalizeName()` 標準化函數
  - 五層比對策略實作
  - Levenshtein / Dice 相似度計算
- [ ] 比對結果確認介面（自動配對 / 待確認 / 未識別）
- [ ] 比對記憶機制（matchingRules 表）
- [ ] 整合到匯入流程（Phase 4 的 Step 2 與 Step 3 之間插入比對步驟）

**驗收標準**：Excel 中「非計畫性重返急診率（72hr）」（全形括號）能自動配對到系統中的「非計畫性重返急診率(72hr)」（半形括號），信心度 100%。

### Phase 5：進階功能 — 第 7-9 週

- [ ] 資料庫匯出（JSON / Excel 備份）
- [ ] 同儕基準值管理介面（手動更新基準值）
- [ ] 管制圖參數設定（可調 σ 倍數、基期範圍）
- [ ] 雙院區比較視圖（並排管制圖）
- [ ] PDF 報告匯出（月報 / 季報格式）
- [ ] 響應式設計（平板 / 手機支援）

---

## 8. Excel 解析規則（詳細）

### 8.1 工作表辨識策略

```javascript
// 依工作表名稱判斷院區
function identifyCampus(sheetName) {
  if (sheetName.includes('竹北') || sheetName.includes('北院')) return 'zhubei';
  if (sheetName.includes('竹東') || sheetName.includes('東院')) return 'zhudong';
  return 'unknown'; // 需人工確認
}

// 依工作表名稱判斷類別
function identifyCategory(sheetName) {
  const mapping = {
    '整體': '整體性照護',
    '加護': '加護病房照護',
    '手術': '手術照護',
    '產科': '產科照護',
    '急診': '急診照護',
    '關鍵': '關鍵照護',
    '感染': '感染管制',
    '用藥': '用藥安全',
    '呼吸': '呼吸照護',
    '經營': '經營管理',
  };
  for (const [keyword, category] of Object.entries(mapping)) {
    if (sheetName.includes(keyword)) return category;
  }
  return 'unknown';
}
```

### 8.2 月份欄位解析

```javascript
// 欄位標題可能格式：
// "110年1月", "110/1", "1月", "110年度"
// 需容錯處理多種格式

function parseColumnHeader(header) {
  // 嘗試 "NNN年M月" 格式
  const match1 = header.match(/(\d{3})年(\d{1,2})月/);
  if (match1) return { year: parseInt(match1[1]), month: parseInt(match1[2]) };
  
  // 嘗試 "NNN/M" 格式
  const match2 = header.match(/(\d{3})\/(\d{1,2})/);
  if (match2) return { year: parseInt(match2[1]), month: parseInt(match2[2]) };
  
  // 嘗試年度彙總 "NNN年度"
  const match3 = header.match(/(\d{3})年度/);
  if (match3) return { year: parseInt(match3[1]), month: null, isYearly: true };
  
  return null;
}
```

### 8.3 數值清洗規則

```javascript
function cleanValue(raw, unit) {
  if (raw === null || raw === undefined || raw === '' || raw === '-' || raw === 'N/A') {
    return null;
  }
  
  let value = typeof raw === 'string' ? parseFloat(raw.replace(/[,%‰]/g, '')) : raw;
  
  if (isNaN(value)) return null;
  
  // 單位一致性檢查：如果是百分比指標但值為小數（如 0.012），轉換為百分比
  if (unit === '%' && value > 0 && value < 0.5) {
    value = value * 100;
  }
  
  return value;
}
```

---

## 9. 管制圖繪製規格（Recharts）

### 9.1 基本結構

```jsx
<ComposedChart data={chartData}>
  {/* 背景色帶 */}
  <ReferenceArea y1={LCL2} y2={UCL2} fill="var(--zone-normal)" />
  <ReferenceArea y1={UCL2} y2={UCL} fill="var(--zone-caution)" />
  <ReferenceArea y1={LCL} y2={LCL2} fill="var(--zone-caution)" />
  
  {/* 管制線 */}
  <ReferenceLine y={CL} stroke="#6B7280" strokeDasharray="5 5" label="CL" />
  <ReferenceLine y={UCL} stroke="#DC2626" strokeDasharray="8 4" label="UCL" />
  <ReferenceLine y={LCL} stroke="#DC2626" strokeDasharray="8 4" label="LCL" />
  
  {/* 同儕值 */}
  <ReferenceLine y={peerValue} stroke="#2563EB" strokeDasharray="3 3" label="同儕" />
  
  {/* 數據線 */}
  <Line dataKey="value" stroke="#1C1917" dot={renderDot} />
</ComposedChart>
```

### 9.2 異常點渲染

```jsx
function renderDot(props) {
  const { cx, cy, payload } = props;
  const alert = alerts.find(a => a.year === payload.year && a.month === payload.month);
  
  if (!alert) return <circle cx={cx} cy={cy} r={4} fill="#16A34A" />;
  
  const colorMap = {
    critical: '#DC2626',
    warning: '#EA580C',
    info: '#CA8A04',
  };
  
  return (
    <>
      <circle cx={cx} cy={cy} r={8} fill={colorMap[alert.severity]} opacity={0.3} />
      <circle cx={cx} cy={cy} r={5} fill={colorMap[alert.severity]} />
    </>
  );
}
```

---

## 10. 測試策略

### 10.1 單元測試

| 模組 | 測試重點 |
|------|---------|
| `calcControlLimits()` | 給定已知數列，驗證 CL/UCL/LCL 計算正確 |
| `detectAnomalies()` | 注入已知異常數據，驗證觸發正確規則 |
| `cleanValue()` | 各種邊界情況（null, 負數, 單位轉換） |
| `parseColumnHeader()` | 多種格式的月份標題 |

### 10.2 整合測試

| 場景 | 預期結果 |
|------|---------|
| 首次匯入完整 Excel | 所有指標正確建立，管制圖可顯示 |
| 二次匯入同檔案 | 顯示「無新資料」，資料庫不變 |
| 匯入含修正值的 Excel | 偵測到差異，顯示變更報告 |
| 匯入新月份資料 | 新增數據點，管制界限重新計算 |
| 數據點 < 6 個指標 | 管制圖顯示「數據不足」提示 |

### 10.3 模擬數據驗證

建立一組模擬數據，其中刻意植入：
- 1 個超出 3σ 的點
- 一段連續 7 點在 CL 上方的序列
- 1 個月增減超過 10% 的點
- 2 個高於同儕值 10% 以上的點

驗證儀表板能正確識別並標記所有異常。

---

## 11. 附錄

### 11.1 名詞對照

| 中文 | 英文 | 說明 |
|------|------|------|
| 管制圖 | Control Chart | 統計製程管制工具 |
| 中心線 | CL (Center Line) | 歷史平均值 |
| 管制上限 | UCL (Upper Control Limit) | CL + 3σ |
| 管制下限 | LCL (Lower Control Limit) | CL - 3σ |
| 同儕值 | Peer Value / Benchmark | 全國同層級醫院基準 |
| 持續性監測指標 | QIP (Quality Indicator Program) | 醫策會品質指標計畫 |

### 11.2 給 Claude Code 的提示

1. **優先順序**：Phase 1 (資料層) → Phase 2 (偵測引擎) → Phase 3 (UI) → Phase 4 (匯入) → Phase 5 (進階)
2. **可先用模擬數據開發 UI**，不必等真實 Excel；模擬數據產生器應作為獨立模組保留
3. **管制圖是核心元件**，投入最多時間確保其正確性與互動體驗
4. **TypeScript 嚴格模式**，所有函數都需要型別定義
5. **每個 Phase 完成後產出可運行的版本**，支持漸進式交付
6. **Dexie.js 的 liveQuery** 可用來實現資料變更時 UI 自動更新

### 11.3 檔案結構建議

```
src/
├── app/                          # Next.js App Router
│   ├── page.tsx                  # 全院總覽
│   ├── category/[id]/page.tsx    # 類別頁
│   ├── indicator/[id]/page.tsx   # 指標詳情
│   ├── import/page.tsx           # 匯入頁
│   └── settings/
│       ├── page.tsx              # 設定總頁
│       └── indicators/page.tsx   # 指標管理頁
├── components/
│   ├── charts/
│   │   ├── ControlChart.tsx      # 管制圖元件
│   │   ├── TrendOverlay.tsx      # 多年度趨勢疊加
│   │   ├── Sparkline.tsx         # 迷你趨勢圖
│   │   └── StatusMatrix.tsx      # 狀態熱力圖
│   ├── cards/
│   │   ├── AlertCard.tsx         # 異常摘要卡片
│   │   ├── IndicatorCard.tsx     # 指標卡片
│   │   └── StatsSummary.tsx      # 統計摘要
│   ├── import/
│   │   ├── UploadZone.tsx        # 拖曳上傳
│   │   ├── ParsePreview.tsx      # 解析預覽
│   │   ├── MatchingReview.tsx    # 模糊比對結果確認介面
│   │   └── DiffReport.tsx        # 差異報告
│   ├── indicators/
│   │   ├── IndicatorForm.tsx     # 新增/編輯指標表單
│   │   ├── IndicatorList.tsx     # 指標管理清單
│   │   └── AliasEditor.tsx       # 別名編輯器
│   └── layout/
│       ├── Sidebar.tsx           # 側邊導航
│       ├── Header.tsx            # 頂部欄
│       └── CampusSwitch.tsx      # 院區切換
├── lib/
│   ├── db/
│   │   ├── schema.ts             # Dexie schema（含 matchingRules）
│   │   ├── operations.ts         # CRUD 操作
│   │   └── migrations.ts         # 版本遷移
│   ├── engine/
│   │   ├── controlChart.ts       # 管制圖統計
│   │   ├── anomalyDetector.ts    # 異常偵測引擎
│   │   ├── monthlyChange.ts      # 月增減偵測
│   │   └── peerComparison.ts     # 同儕比較
│   ├── matching/
│   │   ├── normalizer.ts         # 名稱標準化（全半形、贅詞移除）
│   │   ├── matchingEngine.ts     # 五層比對策略
│   │   ├── similarity.ts         # Levenshtein / Dice 相似度
│   │   └── matchingMemory.ts     # 比對記憶 CRUD
│   ├── parser/
│   │   ├── excelParser.ts        # Excel 解析
│   │   ├── columnParser.ts       # 欄位標題解析
│   │   └── valueCleaner.ts       # 數值清洗
│   ├── types/
│   │   ├── indicator.ts          # 指標型別（含 source, aliases）
│   │   ├── dataPoint.ts          # 數據點型別
│   │   ├── alert.ts              # 異常型別
│   │   └── matching.ts           # 比對結果型別
│   └── constants/
│       ├── indicators.ts         # 預設指標定義清單
│       └── categories.ts         # 類別定義
├── stores/
│   └── dashboardStore.ts         # Zustand store
└── utils/
    ├── statistics.ts             # 統計工具函數
    ├── formatters.ts             # 格式化工具
    └── demoData.ts               # 模擬數據產生器
```
