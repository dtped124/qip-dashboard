# QIP 管制圖類型對照表 — Claude Code 工作計畫

> **文件用途**：供 Claude Code 讀取，作為實作管制圖選型邏輯的完整藍圖。
> **版本**：v1.0 | 2026-03-02
> **關聯文件**：`QIP-Dashboard-Project-Plan.md`（主專案計畫書）

---

## 0. 背景摘要

本醫院體系有三個院區：**新竹**（主院區，含完整指標定義）、**竹北**、**竹東**。三院區使用相同的指標代碼體系（HA01–HA10），但各院區依其服務項目收案不同範圍的指標。

**核心結論**：同一指標代碼 → 同一管制圖類型。管制圖選型取決於指標的「數據本質」，與院區無關。因此，管制圖選型邏輯只需建立一份**統一的對照表**，依指標代碼自動對應即可。

---

## 1. 管制圖類型判斷決策樹

Claude Code 實作時，需將以下決策邏輯寫入 `src/lib/engine/chartTypeSelector.ts`。

```
輸入：指標定義（含 dataNature, hasDenominator, denominatorUnit, dataType）

Step 1: 有分子/分母結構嗎？
  │
  ├─ 否 → dataNature = 'count'
  │        → chartType = 'IMR'  （純計數指標，亦可選 C Chart）
  │
  └─ 是 → Step 2
  
Step 2: 分母的單位是什麼？
  │
  ├─ 「人日數」(person-days) → dataNature = 'density'
  │   → chartType = 'U'  （密度指標，Poisson 分配）
  │
  └─ 「人次/案件數」(persons/cases) → Step 3
  
Step 3: 每個個案的結果是二元的嗎？（是/否、有/無、符合/不符合）
  │
  ├─ 是 → dataNature = 'proportion'
  │        → chartType = 'P'  （比例指標，二項分配）
  │
  └─ 否 → Step 4
  
Step 4: 計算結果是連續型數值嗎？（如比值、天數、時間）
  │
  ├─ 是 → dataNature = 'continuous'
  │        → chartType = 'IMR'
  │
  └─ 否 → chartType = 'U'  （可能同一分母個案多次發生事件）
```

### 1.1 TypeScript 型別定義

```typescript
// file: src/lib/types/chartTypes.ts

/** 管制圖類型 */
type ChartType = 'P' | 'U' | 'IMR' | 'C';

/** 數據本質 */
type DataNature = 'proportion' | 'density' | 'count' | 'continuous';

/** 分母單位類型 */
type DenominatorUnit = 'person-days' | 'persons' | 'cases' | 'procedures' | 'none';

/** 管制圖選型設定 */
interface ChartTypeConfig {
  /** 理論最佳管制圖（有分子分母時） */
  primaryChart: ChartType;
  /** 退回方案（僅有比率值時） */
  fallbackChart: ChartType;   // 永遠是 'IMR'
  /** 數據本質 */
  dataNature: DataNature;
  /** 分母單位 */
  denominatorUnit: DenominatorUnit;
  /** 判斷理由（供 UI tooltip 顯示） */
  reason: string;
}
```

### 1.2 選型函數實作

```typescript
// file: src/lib/engine/chartTypeSelector.ts

function selectChartType(indicator: IndicatorDefinition): ChartTypeConfig {
  // 無分母 → 計數指標
  if (!indicator.hasDenominator) {
    return {
      primaryChart: 'IMR',
      fallbackChart: 'IMR',
      dataNature: 'count',
      denominatorUnit: 'none',
      reason: '無分母，為單純計數指標，使用 I-MR Chart 追蹤趨勢',
    };
  }

  // 分母為人日數 → 密度指標
  if (indicator.denominatorUnit === 'person-days') {
    return {
      primaryChart: 'U',
      fallbackChart: 'IMR',
      dataNature: 'density',
      denominatorUnit: 'person-days',
      reason: '分母為暴露人日，屬密度指標，符合 Poisson 分配，使用 U Chart',
    };
  }

  // 分母為人次/案件數 且結果為二元 → 比例指標
  if (indicator.dataType === 'binary') {
    return {
      primaryChart: 'P',
      fallbackChart: 'IMR',
      dataNature: 'proportion',
      denominatorUnit: indicator.denominatorUnit,
      reason: '每個個案為二元結果（是/否），屬二項分配，使用 P Chart',
    };
  }

  // 連續型數值
  return {
    primaryChart: 'IMR',
    fallbackChart: 'IMR',
    dataNature: 'continuous',
    denominatorUnit: indicator.denominatorUnit,
    reason: '計算結果為連續型數值，使用 I-MR Chart',
  };
}
```

---

## 2. 完整指標對照表（三院區統一）

以下為 Claude Code 需寫入 `src/lib/constants/indicators.ts` 的完整指標定義。每個指標包含管制圖選型所需的所有欄位。

### 2.1 欄位說明

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | string | 指標代碼（如 `HA01-01`） |
| `name` | string | 指標中文全稱 |
| `category` | string | 所屬類別（九大類 + 亞急性呼吸照護 + 病人安全） |
| `campus` | string[] | 適用院區：`hsinchu`（新竹）, `zhubei`（竹北）, `zhudong`（竹東） |
| `hasDenominator` | boolean | 是否有分子/分母結構 |
| `numeratorDef` | string | 分子定義 |
| `denominatorDef` | string | 分母定義 |
| `denominatorUnit` | DenominatorUnit | 分母單位類型 |
| `dataType` | `'binary'` \| `'count-rate'` \| `'continuous'` \| `'count'` | 數據結構類型 |
| `dataNature` | DataNature | 數據本質（自動判定用） |
| `chartType` | ChartType | 管制圖類型（由決策樹判定） |
| `direction` | `'lower'` \| `'higher'` \| `'monitor'` | 方向性 |
| `unit` | string | 顯示單位 |
| `reason` | string | 管制圖選型理由 |

### 2.2 一般病人照護 (HA01)

| # | id | 指標名稱 | 分子 | 分母 | 分母單位 | 數據類型 | 管制圖 | 方向性 | 理由 |
|---|-----|---------|------|------|---------|---------|--------|--------|------|
| 1 | `HA01-01` | 住院死亡率(含病危自動出院) | 死亡人數(含病危自動出院) | 出院總人次 | persons | binary | **P** | lower | 每位出院病人：死亡/未死亡，二元結果 |
| 2 | `HA01-02` | 出院14天內非計畫性再住院率 | 14天內非計畫性再住院事件數 | 出院人次(不含死亡及病危自動出院) | persons | binary | **P** | lower | 每位出院病人：再住院/未再住院，二元結果 |
| 3 | `HA01-03` | 住院超過30天(季) | 住院超過30日的案件數 | 出院案件數(僅急性床) | cases | binary | **P** | lower | 每個出院案件：超過/未超過30天，二元結果 |

**院區適用**：三院區皆有（`hsinchu`, `zhubei`, `zhudong`）

### 2.3 加護病房照護 (HA02)

| # | id | 指標名稱 | 分子 | 分母 | 分母單位 | 數據類型 | 管制圖 | 方向性 | 理由 |
|---|-----|---------|------|------|---------|---------|--------|--------|------|
| 4 | `HA02-01` | 48小時內加護病房重返率 | 48小時內非計畫性重返ICU人次 | ICU轉出人次 | persons | binary | **P** | lower | 每位ICU轉出病人：重返/未重返，二元結果 |
| 5 | `HA02-02` | 加護病房死亡率(含病危自動出院) | ICU死亡人數(含病危自動出院) | ICU轉出及出院總人次 | persons | binary | **P** | lower | 每位ICU病人：死亡/未死亡，二元結果 |
| 6 | `HA02-11` | 加護病房呼吸器相關肺炎(VAP) | VAP感染件數 | 呼吸器使用人日數 | **person-days** | count-rate | **U** | lower | 分母為暴露「人日」，密度指標，Poisson分配 |
| 7 | `HA02-12` | 加護病房留置導尿管相關尿路感染(CAUTI) | CAUTI感染次數 | 導尿管使用人日數 | **person-days** | count-rate | **U** | lower | 分母為暴露「人日」，密度指標 |
| 8 | `HA02-13` | 加護病房中心導管相關血流感染(CLABSI) | CLABSI感染件數 | 中心導管使用人日數 | **person-days** | count-rate | **U** | lower | 分母為暴露「人日」，密度指標 |

**院區適用**：三院區皆有

### 2.4 手術照護 (HA03)

| # | id | 指標名稱 | 分子 | 分母 | 分母單位 | 數據類型 | 管制圖 | 方向性 | 理由 |
|---|-----|---------|------|------|---------|---------|--------|--------|------|
| 9 | `HA03-01` | 手術後48小時內死亡率 | 術後48小時內死亡人數 | 住院病人手術數 | procedures | binary | **P** | lower | 每台手術：死亡/未死亡，二元結果 |
| 10 | `HA03-02` | 非計畫相關重返手術室 | 非計畫性重返手術室次數 | 住院病人手術數 | procedures | binary | **P** | lower | 每台手術：重返/未重返，二元結果 |
| 11 | `HA03-03` | 手術部位感染 | 手術部位感染數 | 住院病人手術數 | procedures | binary | **P** | lower | 每台手術：感染/未感染，二元結果 |
| 12 | `HA03-04` | 預防性抗生素劃刀前1小時給予率 | 劃刀前60分鐘內給予抗生素手術次數 | 接受預防性抗生素之手術次數 | procedures | binary | **P** | higher | 每台手術：符合/不符合時限，二元結果 |

**院區適用**：三院區皆有

### 2.5 產科照護 (HA04)

| # | id | 指標名稱 | 分子 | 分母 | 分母單位 | 數據類型 | 管制圖 | 方向性 | 理由 |
|---|-----|---------|------|------|---------|---------|--------|--------|------|
| 13 | `HA04-01` | 總剖腹產率 | 總剖腹產數 | 總生產數 | persons | binary | **P** | monitor | 每次生產：剖腹產/非剖腹產，二元結果 |
| 14 | `HA04-02` | 初次剖腹產率 | 初次剖腹產數 | 未曾剖腹產的產婦數 | persons | binary | **P** | monitor | 每位初產婦：剖腹產/非剖腹產，二元結果 |

**院區適用**：`hsinchu`, `zhubei`（竹東無產科）

### 2.6 急診照護 (HA05)

| # | id | 指標名稱 | 分子 | 分母 | 分母單位 | 數據類型 | 管制圖 | 方向性 | 理由 |
|---|-----|---------|------|------|---------|---------|--------|--------|------|
| 15 | `HA05-01` | 急診轉住院比率 | 急診就診後直接住院之人次 | 急診總人次 | persons | binary | **P** | monitor | 每位急診病人：轉住院/未轉，二元結果 |
| 16 | `HA05-02` | 急診會診超過30分鐘比率 | 急診會診超過30分鐘之人次 | 急診會診總人次 | persons | binary | **P** | lower | 每次會診：超過/未超過30分鐘，二元結果 |
| 17 | `HA05-03` | 緊急重大外傷手術30分鐘內進開刀房率 | 30分鐘內進開刀房人次 | 緊急重大外傷手術總人次 | persons | binary | **P** | higher | 每位病人：符合/不符合，二元結果 |

**院區適用**：
- HA05-01, HA05-02：三院區皆有
- HA05-03：`hsinchu`, `zhubei`（竹東無此指標）

### 2.7 特殊照護 — 腎臟 (HA06-01)

| # | id | 指標名稱 | 分子 | 分母 | 分母單位 | 數據類型 | 管制圖 | 方向性 | 理由 |
|---|-----|---------|------|------|---------|---------|--------|--------|------|
| 18 | `HA06-01` | 全院腹膜透析病人比率 | 腹膜透析個案數 | 腹膜+血液透析個案總數 | persons | binary | **P** | higher | 每位透析病人：腹膜/血液，二元結果 |

**院區適用**：三院區皆有

### 2.8 特殊照護 — 心臟 (HA06-1x, HA06-3x)

| # | id | 指標名稱 | 分子 | 分母 | 分母單位 | 數據類型 | 管制圖 | 方向性 | 理由 |
|---|-----|---------|------|------|---------|---------|--------|--------|------|
| 19 | `HA06-11` | STEMI 90分鐘內PCI比率(D2W<90min) | 90分鐘內施予PCI病人次 | 所有STEMI施予PCI病人次 | persons | binary | **P** | higher | 每位STEMI-PCI病人：符合/不符合，二元結果 |
| 20 | `HA06-13` | 急性心肌梗塞住院死亡率 | AMI死亡人數(含病危自動出院) | AMI出院人次 | persons | binary | **P** | lower | 每位AMI病人：死亡/未死亡，二元結果 |
| 21 | `HA06-32` | AMI出院時給予乙型阻斷劑比率 | 出院時接受乙型阻斷劑之AMI病人次 | AMI出院人次 | persons | binary | **P** | higher | 每位AMI出院病人：給予/未給予，二元結果 |

**院區適用**：`hsinchu`, `zhubei`（竹東無心臟專科指標）

### 2.9 特殊照護 — 腦中風 (HA06-2x)

| # | id | 指標名稱 | 分子 | 分母 | 分母單位 | 數據類型 | 管制圖 | 方向性 | 理由 |
|---|-----|---------|------|------|---------|---------|--------|--------|------|
| 22 | `HA06-21` | 急性缺血性中風接受IV-tPA比率 | 接受IV-tPA治療病人次 | 所有急性缺血性中風到院病人次 | persons | binary | **P** | higher | 每位中風病人：接受/未接受，二元結果 |
| 23 | `HA06-23` | IV-tPA D2N<60min比率 | 60分鐘內接受IV-tPA病人次 | 接受IV-tPA治療病人次 | persons | binary | **P** | higher | 每位IV-tPA病人：符合/不符合，二元結果 |
| 24 | `HA06-24` | IV-tPA後症狀性腦出血比率 | 36小時內症狀性腦出血病人次 | 接受IV-tPA治療病人次 | persons | binary | **P** | lower | 每位IV-tPA病人：出血/未出血，二元結果 |
| 25 | `HA06-25` | 缺血性中風2hr到院3hr內施打IV-tPA | 符合條件且3小時內施打病人次 | 2小時內到院且符合適應症病人次 | persons | binary | **P** | higher | 每位符合條件病人：及時/未及時，二元結果 |

**院區適用**：`hsinchu`, `zhubei`（竹東無腦中風專科指標）

### 2.10 特殊照護 — 安寧 (HA06-31)

| # | id | 指標名稱 | 分子 | 分母 | 分母單位 | 數據類型 | 管制圖 | 方向性 | 理由 |
|---|-----|---------|------|------|---------|---------|--------|--------|------|
| 26 | `HA06-31` | 接受安寧共同照護個案數 | 個案數(累計) | **無** | none | count | **IMR** | higher | 無分母，為單純計數指標，追蹤月度趨勢 |

**院區適用**：三院區皆有

### 2.11 感染管制 (HA07)

| # | id | 指標名稱 | 分子 | 分母 | 分母單位 | 數據類型 | 管制圖 | 方向性 | 理由 |
|---|-----|---------|------|------|---------|---------|--------|--------|------|
| 27 | `HA07-01` | 醫療照護相關感染 | 醫療照護相關感染總人次 | 住院人日 | **person-days** | count-rate | **U** | lower | 分母為「住院人日」，密度指標，Poisson分配 |

**院區適用**：三院區皆有

### 2.12 藥物安全 (HA08)

| # | id | 指標名稱 | 分子 | 分母 | 分母單位 | 數據類型 | 管制圖 | 方向性 | 理由 |
|---|-----|---------|------|------|---------|---------|--------|--------|------|
| 28 | `HA08-01` | 藥物不良反應通報件數 | ADR+醫材不良反應+不良品(加總) | **無** | none | count | **IMR** | higher | 無分母，為多類通報加總，追蹤月度趨勢 |

**院區適用**：三院區皆有

### 2.13 亞急性/慢性呼吸照護 (HA09)

| # | id | 指標名稱 | 分子 | 分母 | 分母單位 | 數據類型 | 管制圖 | 方向性 | 理由 |
|---|-----|---------|------|------|---------|---------|--------|--------|------|
| 29 | `HA09-01` | 呼吸照護-中心導管血流感染(CLABSI) | CLABSI感染次數 | 中心導管使用人日數 | **person-days** | count-rate | **U** | lower | 分母為暴露「人日」，密度指標 |
| 30 | `HA09-02` | 呼吸照護-呼吸器相關肺炎(VAP) | VAP感染件數 | 呼吸器使用人日數 | **person-days** | count-rate | **U** | lower | 分母為暴露「人日」，密度指標 |
| 31 | `HA09-03` | 呼吸照護-導尿管尿路感染(CAUTI) | CAUTI感染次數 | 導尿管使用人日數 | **person-days** | count-rate | **U** | lower | 分母為暴露「人日」，密度指標 |
| 32 | `HA09-04` | 呼吸照護-呼吸器脫離成功率 | 成功脫離呼吸器且轉出人次 | 離開呼吸照護病房人次 | persons | binary | **P** | higher | 每位病人：成功脫離/未成功，二元結果 |
| 33 | `HA09-05` | 呼吸照護-氣切比率 | 有氣切人次 | 呼吸照護病房病人人次 | persons | binary | **P** | monitor | 每位病人：氣切/未氣切，二元結果 |

**院區適用**：
- HA09-01~04：`hsinchu`, `zhudong`（竹北無此病房）
- HA09-05：僅 `hsinchu`
- 注意：竹東稱「慢性呼吸照護」，新竹稱「亞急性呼吸照護」，但數據本質與管制圖類型完全相同

### 2.14 病人安全與其他 (HA10)

| # | id | 指標名稱 | 分子 | 分母 | 分母單位 | 數據類型 | 管制圖 | 方向性 | 理由 |
|---|-----|---------|------|------|---------|---------|--------|--------|------|
| 34 | `HA10-01` | 異常事件通報數 | 各類異常事件通報件數加總 | **無** | none | count | **IMR** | higher | 無分母，為多類通報加總。通報數越多代表安全文化越好。**注意**：新竹院區有 13 個子類別（HA10-10-01~13），需自動加總為此指標；竹北/竹東直接提供加總值。詳見第 9.1 節 |
| 35 | `HA10-02` | 醫院員工遭受暴力事件數 | 每月員工遭受暴力事件數 | **無** | none | count | **IMR** | lower | 無分母，為單純事件計數 |
| 36 | `HA10-03` | 醫院員工發生職業災害件數 | 每月員工職業災害件數 | **無** | none | count | **IMR** | lower | 無分母，為單純事件計數 |
| 37 | `HA10-04` | 急性一般病床開放率 | 實際開放床數 | 衛生局登記床數 | cases | binary | **P** | monitor | 有分子分母，但分母(登記床數)通常固定。可用P Chart或I-MR Chart |
| 38 | `HA10-09` | 急性一般病床全日平均護病比 | (床位數×佔床率×3)加總 | 三班護理人員數加總 | persons | **continuous** | **IMR** | lower | 護病比為連續型數值(非二元事件比例)，不符合二項或Poisson分配 |

**院區適用**：三院區皆有
**注意**：新竹院區的異常事件通報代碼為 `HA10-10`，竹北竹東為 `HA10-01`，需在別名系統中處理

---

## 3. 統計摘要

### 3.1 依管制圖類型統計

| 管制圖類型 | 數據本質 | 分配假設 | 指標數量 | 代表指標 |
|-----------|---------|---------|:--------:|---------|
| **P Chart** | 比例 (Proportion) | 二項分配 | **26** | 死亡率、再住院率、ICU重返率、感染率、剖腹產率、IV-tPA比率 |
| **U Chart** | 密度 (Density) | Poisson分配 | **7** | VAP、CAUTI、CLABSI(ICU及呼吸照護)、醫療照護相關感染 |
| **I-MR Chart** | 計數/連續值 | 近似常態 | **5** | 安寧共照個案數、通報件數、暴力/職災事件數、護病比 |
| **合計** | | | **38** | |

### 3.2 依院區統計

| 管制圖類型 | 新竹 | 竹北 | 竹東 |
|-----------|:----:|:----:|:----:|
| P Chart | 26 | 22 | 14 |
| U Chart | 7 | 4 | 7 |
| I-MR Chart | 5 | 5 | 5 |
| **P / I-MR** | 1 | 1 | 1 |
| **合計** | **39** | **32** | **27** |

### 3.3 各院區指標差異原因

| 指標代碼 | 新竹 | 竹北 | 竹東 | 原因 |
|---------|:----:|:----:|:----:|------|
| HA04-01/02 | ✓ | ✓ | ✗ | 竹東無產科 |
| HA05-03 | ✓ | ✓ | ✗ | 竹東無此緊急外傷手術指標 |
| HA06-11/13/32 | ✓ | ✓ | ✗ | 竹東無心臟專科 |
| HA06-21/23/24/25 | ✓ | ✓ | ✗ | 竹東無腦中風專科 |
| HA09-01~04 | ✓ | ✗ | ✓ | 竹北無呼吸照護病房 |
| HA09-05 | ✓ | ✗ | ✗ | 僅新竹有氣切比率 |

---

## 4. 管制圖計算公式規格

Claude Code 需在 `src/lib/engine/controlChart.ts` 實作以下三種管制圖的計算邏輯。

### 4.1 P Chart（比例管制圖）

適用於 `dataNature === 'proportion'` 的 26 個指標。

```typescript
interface PChartInput {
  /** 各期分子（不良數） */
  numerators: number[];
  /** 各期分母（樣本數） */
  denominators: number[];
}

interface PChartResult {
  /** 中心線 p̄ = Σd(i) / Σn(i) */
  CL: number;
  /** 各期管制上限（隨分母變動） */
  UCL: number[];
  /** 各期管制下限（隨分母變動） */
  LCL: number[];
}

function calcPChart(input: PChartInput): PChartResult {
  const totalD = sum(input.numerators);
  const totalN = sum(input.denominators);
  const pBar = totalD / totalN;  // 中心線

  const UCL = input.denominators.map(n =>
    Math.min(1, pBar + 3 * Math.sqrt(pBar * (1 - pBar) / n))
  );
  const LCL = input.denominators.map(n =>
    Math.max(0, pBar - 3 * Math.sqrt(pBar * (1 - pBar) / n))
  );

  return { CL: pBar, UCL, LCL };
}
```

**關鍵特性**：
- 管制界限隨每期分母 `n(i)` 變動，不是固定值
- `LCL` 不得 < 0，`UCL` 不得 > 1
- 需要原始分子/分母數據，無法僅用比率值計算
- 當 `p̄ × n(i) < 5` 時，常態近似不成立，應自動退回 I-MR Chart

### 4.2 U Chart（單位缺點率管制圖）

適用於 `dataNature === 'density'` 的 7 個指標。

```typescript
interface UChartInput {
  /** 各期事件數（缺點數） */
  counts: number[];
  /** 各期暴露量（人日數） */
  exposures: number[];
}

interface UChartResult {
  /** 中心線 ū = Σc(i) / Σn(i) */
  CL: number;
  /** 各期管制上限（隨暴露量變動） */
  UCL: number[];
  /** 各期管制下限（隨暴露量變動） */
  LCL: number[];
}

function calcUChart(input: UChartInput): UChartResult {
  const totalC = sum(input.counts);
  const totalN = sum(input.exposures);
  const uBar = totalC / totalN;  // 中心線

  const UCL = input.exposures.map(n =>
    uBar + 3 * Math.sqrt(uBar / n)
  );
  const LCL = input.exposures.map(n =>
    Math.max(0, uBar - 3 * Math.sqrt(uBar / n))
  );

  return { CL: uBar, UCL, LCL };
}
```

**關鍵特性**：
- 管制界限隨每期暴露量 `n(i)` 變動
- 通常以‰（千分比）呈現，計算時需統一單位
- `LCL` 不得 < 0

### 4.3 I-MR Chart（個別值-移動全距管制圖）

適用於所有指標的退回方案，以及 `dataNature === 'count'` 或 `'continuous'` 的 5 個指標。

```typescript
interface IMRChartInput {
  /** 各期數值（比率值或計數值） */
  values: number[];
}

interface IMRChartResult {
  /** 中心線 X̄ */
  CL: number;
  /** 管制上限（固定值） */
  UCL: number;
  /** 管制下限（固定值） */
  LCL: number;
  /** 2σ 警戒上限 */
  UCL2: number;
  /** 2σ 警戒下限 */
  LCL2: number;
  /** 移動全距平均 MR̄ */
  MRBar: number;
}

function calcIMRChart(input: IMRChartInput): IMRChartResult {
  const values = input.values.filter(v => v !== null && !isNaN(v));
  const XBar = mean(values);

  // 移動全距
  const MR: number[] = [];
  for (let i = 1; i < values.length; i++) {
    MR.push(Math.abs(values[i] - values[i - 1]));
  }
  const MRBar = mean(MR);

  // d2 = 1.128 for subgroup size n=2
  const sigma = MRBar / 1.128;

  return {
    CL: XBar,
    UCL: XBar + 3 * sigma,
    LCL: Math.max(0, XBar - 3 * sigma),
    UCL2: XBar + 2 * sigma,
    LCL2: Math.max(0, XBar - 2 * sigma),
    MRBar,
  };
}
```

**關鍵特性**：
- 管制界限為固定值（不隨分母變動）
- 使用移動全距 `MR̄` 而非樣本標準差 `s` 來估計 σ
- 常數 2.66 = 3/d₂（d₂ = 1.128, n=2）
- 最低需要 6 個數據點才能建立管制圖

---

## 5. 管制圖基線窗口（Baseline Window）

### 5.1 核心規則：最近 24 個數據點

管制圖的管制界限（CL, UCL, LCL）**僅使用最近 24 個有效數據點**計算，而非全部歷史數據。

```
為什麼是 24？
- 醫療品質指標通常為月報，24 點 = 最近 2 年的數據
- 足夠的數據量確保統計穩定性（遠超最低 6 點要求）
- 避免過早期的數據（可能反映不同管理模式或政策）稀釋當前的管制基線
- 符合 SPC 實務建議：基線期通常取 20-30 個數據點
```

### 5.2 計算邏輯

```typescript
// file: src/lib/engine/controlChart.ts

const BASELINE_WINDOW = 24;  // 管制圖基線窗口大小

/**
 * 從數據點陣列中取出用於計算管制界限的基線數據
 * 規則：取最近 24 個非 null 的有效數據點
 */
function getBaselineData(allDataPoints: DataPoint[]): DataPoint[] {
  const validPoints = allDataPoints
    .filter(dp => dp.value !== null && !isNaN(dp.value))
    .sort((a, b) => {
      // 依年月排序（升序）
      if (a.year !== b.year) return a.year - b.year;
      return a.month - b.month;
    });

  // 取最後 24 個
  return validPoints.slice(-BASELINE_WINDOW);
}
```

### 5.3 各管制圖的基線應用方式

| 管制圖 | 基線計算 | 說明 |
|--------|---------|------|
| **I-MR Chart** | `X̄` 和 `MR̄` 皆從最近 24 點計算 | UCL/LCL 為固定值（基於 24 點） |
| **P Chart** | `p̄ = Σd(i) / Σn(i)` 從最近 24 期的分子分母計算 | 但每期的 UCL(i)/LCL(i) 仍隨該期分母 n(i) 變動 |
| **U Chart** | `ū = Σc(i) / Σn(i)` 從最近 24 期的事件數和暴露量計算 | 同上，每期界限隨暴露量變動 |

### 5.4 邊界情況處理

| 情況 | 處理方式 |
|------|---------|
| 數據點 < 6 個 | 不繪製管制圖，顯示「數據不足（至少需 6 個月）」 |
| 數據點 6–23 個 | 使用全部數據計算管制界限，並顯示提示「基線期不足 24 個月，管制界限可能不夠穩定」 |
| 數據點 ≥ 24 個 | 使用最近 24 個計算管制界限（標準情況） |
| 中間有缺值月份 | 跳過缺值，往前取到滿 24 個有效數據點為止 |

### 5.5 圖表繪製範圍 vs 基線範圍

這兩者是不同的概念：

```
圖表繪製範圍：顯示所有歷史數據點（使用者可選擇年度範圍）
基線計算範圍：永遠只用最近 24 個有效點來算 CL/UCL/LCL

範例：某指標有 110 年 1 月 ~ 115 年 2 月共 62 個數據點
  → 圖表上顯示全部 62 個點的趨勢
  → 但管制界限是用 113 年 3 月 ~ 115 年 2 月（最近 24 個月）算出來的
  → 早期的數據點仍然會被標記是否超出管制界限（用當前的界限判定）
```

### 5.6 UI 呈現

管制圖元件上應顯示基線資訊：

```
管制圖標題列：
┌─────────────────────────────────────────────────┐
│ HA01-01 住院死亡率   [I-MR] [P Chart ✦]         │
│ 基線期間：113/03 – 115/02（24 個月）              │
│ CL: 12.3‰  UCL: 18.7‰  LCL: 5.9‰              │
└─────────────────────────────────────────────────┘
```

### 5.7 未來擴充：可調整的基線窗口

在 `/settings` 頁面提供基線窗口大小的設定選項：

```typescript
interface ControlChartSettings {
  baselineWindow: number;      // 預設 24，可調範圍 12–36
  minDataPoints: number;       // 預設 6，最低數據點要求
  sigmaMultiplier: number;     // 預設 3，管制界限 σ 倍數
  showWarningZone: boolean;    // 預設 true，是否顯示 2σ 警戒線
}
```

---

## 6. 雙層管制圖策略（實務實作重點）

這是本專案最重要的實務設計決策。

### 6.1 問題背景

QIP 報表中的 Excel 數據有兩種可能：
- **情況 A**：僅提供已計算好的比率值（如 `1.2%`）
- **情況 B**：同時提供分子和分母的原始數據

當只有情況 A 時，P Chart 和 U Chart 無法計算（它們需要原始分子分母），只能退回使用 I-MR Chart。

### 6.2 解決方案：雙層策略

```
Layer 1（基礎層，永遠啟用）:
  → 所有 38 個指標一律繪製 I-MR Chart
  → 使用已計算的比率值作為數據點
  → 確保每個指標都有管制圖可看

Layer 2（進階層，有原始數據時自動啟用）:
  → 26 個 P Chart 指標：當有分子 + 分母時，額外繪製 P Chart
  → 7 個 U Chart 指標：當有事件數 + 暴露人日時，額外繪製 U Chart
  → 提供更精確的管制界限（會隨分母變動而調整）
```

### 6.3 自動選擇邏輯

```typescript
// file: src/lib/engine/chartRenderer.ts

function getAvailableCharts(
  indicator: IndicatorDefinition,
  dataPoints: DataPoint[]
): ChartType[] {
  const charts: ChartType[] = ['IMR'];  // Layer 1 永遠可用

  // 檢查是否有分子分母原始數據
  const hasRawData = dataPoints.some(
    dp => dp.numerator !== null && dp.denominator !== null
  );

  if (hasRawData) {
    const config = selectChartType(indicator);
    if (config.primaryChart !== 'IMR') {
      charts.push(config.primaryChart);  // Layer 2
    }
  }

  return charts;
}
```

### 6.4 UI 呈現

當 Layer 2 可用時，管制圖元件上方顯示切換按鈕：

```
[ I-MR Chart ] [ P Chart ✦ ]     ← ✦ 表示推薦（理論最佳）
```

預設顯示 Layer 2（理論最佳），使用者可手動切換回 Layer 1。

---

## 7. 資料模型擴充

為支援雙層管制圖，每個數據點需要額外儲存分子和分母。

### 7.1 DataPoint 型別

```typescript
// file: src/lib/types/dataPoint.ts

interface DataPoint {
  id: string;                    // 自動產生的唯一 ID
  indicatorId: string;           // 指標代碼（如 HA01-01）
  campus: 'hsinchu' | 'zhubei' | 'zhudong';
  year: number;                  // 民國年（如 113）
  month: number;                 // 1-12
  value: number;                 // 最終比率值/計數值
  numerator: number | null;      // 分子原始值（可能為空）
  denominator: number | null;    // 分母原始值（可能為空）
  source: 'excel' | 'manual';   // 數據來源
  importedAt: string;            // 匯入時間 ISO 格式
}
```

### 7.2 Dexie Schema

```typescript
// file: src/lib/db/schema.ts

db.version(2).stores({
  indicators: 'id, category, *campus, source, isActive',
  dataPoints: '[indicatorId+campus+year+month], indicatorId, campus, year',
  alerts: '[indicatorId+campus+year+month+type], indicatorId, severity',
  importHistory: '++id, importedAt, campus',
  // 管制圖計算快取
  chartCache: '[indicatorId+campus+chartType], indicatorId',
});
```

---

## 8. 開發任務清單

以下為 Claude Code 應按順序執行的具體開發任務。

### Phase 0: 基礎型別與常數（預估 1 小時）

- [ ] **T0-1** 建立 `src/lib/types/chartTypes.ts`
  - 定義 `ChartType`, `DataNature`, `DenominatorUnit`, `ChartTypeConfig` 型別
- [ ] **T0-2** 建立 `src/lib/types/dataPoint.ts`
  - 定義 `DataPoint` 介面，含 numerator/denominator 欄位
- [ ] **T0-3** 更新 `src/lib/constants/indicators.ts`
  - 寫入本文件第 2 節的 38 個指標完整定義
  - 每個指標須包含：id, name, category, campus[], hasDenominator, numeratorDef, denominatorDef, denominatorUnit, dataType, dataNature, chartType, direction, unit, reason
  - 處理 `HA10-10` vs `HA10-01` 的代碼別名
- [ ] **T0-4** 建立院區指標映射表
  - `hsinchu`: 39 指標
  - `zhubei`: 32 指標（排除 HA04, HA09, 部分 HA05/HA06）
  - `zhudong`: 27 指標（排除 HA04, 部分 HA03/HA05/HA06）

### Phase 1: 管制圖計算引擎（預估 3 小時）

- [ ] **T1-1** 實作 `src/lib/engine/chartTypeSelector.ts`
  - `selectChartType()` 函數：依決策樹自動判定管制圖類型
  - 單元測試：驗證 38 個指標的判定結果符合本文件第 2 節
- [ ] **T1-2** 實作 `src/lib/engine/controlChart.ts`
  - `BASELINE_WINDOW = 24` 常數定義
  - `getBaselineData()`: 從全部數據中取最近 24 個有效點作為基線
  - `calcPChart()`: P Chart 計算（含 p̄×n < 5 自動退回邏輯）
  - `calcUChart()`: U Chart 計算
  - `calcIMRChart()`: I-MR Chart 計算（含 MR̄ 法估計 σ）
  - 所有管制界限計算皆使用基線窗口內的數據，非全部歷史數據
  - 邊界處理：< 6 點不繪製、6–23 點使用全部數據並提示、≥ 24 點取最近 24 個
  - 單元測試：給定已知數列，驗證 CL/UCL/LCL 計算正確
- [ ] **T1-3** 實作 `src/lib/engine/chartRenderer.ts`
  - `getAvailableCharts()`: 判斷當前指標可用的管制圖類型
  - 雙層策略邏輯：Layer 1 (IMR) 永遠可用，Layer 2 (P/U) 有原始數據時啟用
- [ ] **T1-4** 管制圖計算快取機制
  - 計算結果存入 `chartCache` 表
  - 數據更新時自動清除並重算對應快取

### Phase 2: 異常偵測引擎整合（預估 2 小時）

- [ ] **T2-1** 更新異常偵測引擎，整合管制圖類型
  - P Chart / U Chart 使用各自的管制界限判定異常
  - I-MR Chart 使用固定界限
  - Western Electric Rules 5 條規則適用所有圖型
- [ ] **T2-2** 方向性邏輯與管制圖類型結合
  - `lower` 指標 + P Chart：僅關注超出 UCL
  - `higher` 指標 + P Chart：僅關注低於 LCL
  - `monitor` 指標：雙向都關注
- [ ] **T2-3** 稀有事件處理
  - P Chart：當 `p̄ × n(i) < 5` 時自動退回 I-MR Chart
  - U Chart：當月事件數連續 3 個月為 0 時，標記「數據不足」
  - I-MR Chart：數據點 < 6 個時顯示「數據不足，無法建立管制圖」

### Phase 3: UI 管制圖元件（預估 4 小時）

- [ ] **T3-1** 管制圖元件支援多圖型切換
  - 在 `<ControlChart />` 元件上方加入 `[I-MR] [P Chart ✦]` 切換按鈕
  - 預設顯示 Layer 2（推薦圖型），可手動切換
- [ ] **T3-2** P Chart / U Chart 的管制界限繪製
  - P/U Chart 的管制界限是**曲線**（隨分母變動），非水平直線
  - 使用 Recharts 的 `<Area>` 元件繪製變動的管制界限帶
- [ ] **T3-3** 管制圖 tooltip 顯示管制圖類型與理由
  - hover 時顯示：「此指標使用 P Chart（比例管制圖），因每位出院病人的結果為死亡/未死亡的二元結果」
- [ ] **T3-4** 狀態矩陣熱力圖整合
  - 綜合判定顏色使用當前選擇的管制圖類型的結果

### Phase 4: Excel 匯入整合（預估 2 小時）

- [ ] **T4-1** 更新 Excel 解析器，擷取分子/分母原始數據
  - 辨識 Excel 中的「分子」「分母」欄位
  - 將原始數據存入 DataPoint 的 numerator/denominator 欄位
- [ ] **T4-2** 匯入後自動判定可用管制圖類型
  - 有分子分母 → 自動啟用 Layer 2
  - 僅有比率值 → 僅 Layer 1 (I-MR)
- [ ] **T4-3** 匯入差異報告中顯示管制圖類型資訊
  - 「偵測到 HA02-11 (VAP) 有分子/分母原始數據，已啟用 U Chart（進階層）」

---

## 9. 特殊處理備註

### 9.1 HA10 異常事件通報 — 跨院區代碼與子類別處理

這是三院區之間最複雜的指標對應問題，必須特別處理。

#### 9.1.1 實際資料結構差異

**新竹院區**的 Excel 中，異常事件通報拆成 13 個子類別，各自獨立記錄：

| 子類別代碼 | 名稱 |
|-----------|------|
| HA10-10-01 | 藥物事件通報件數（藥物+化療外滲） |
| HA10-10-02 | 跌倒事件通報件數 |
| HA10-10-03 | 手術事件通報件數 |
| HA10-10-04 | 輸血事件通報件數 |
| HA10-10-05 | 醫療照護事件通報件數 |
| HA10-10-06 | 公共意外事件通報件數 |
| HA10-10-07 | 治安事件通報件數 |
| HA10-10-08 | 傷害行為事件通報件數 |
| HA10-10-09 | 管路事件通報件數 |
| HA10-10-10 | 院內不預期心跳停止事件通報件數（急救） |
| HA10-10-11 | 麻醉事件通報件數 |
| HA10-10-12 | 檢查/檢驗/病理切片事件通報件數 |
| HA10-10-13 | 其他事件通報件數（問題醫材+行政+其他） |
| **總計** | **HA10-10-01 ~ HA10-10-13 的加總** |

**竹北院區 / 竹東院區**的 Excel 中，只有一個加總值，代碼為 `HA10-01`。

三者的「總計」數字是等價的：`HA10-01（竹北/竹東）= Σ HA10-10-01~13（新竹）`

#### 9.1.2 系統處理規則

```
統一代碼：HA10-01（異常事件通報數）
├─ 管制圖：I-MR Chart（使用加總值）
├─ 適用院區：三院區皆有
│
├─ 竹北/竹東匯入：直接讀取 HA10-01 的值 → 存為 HA10-01 的 dataPoint
│
├─ 新竹匯入：
│   ├─ 讀取 HA10-10-01 ~ HA10-10-13 共 13 筆子類別
│   ├─ 子類別存入 dataPoints，indicatorId = 'HA10-10-xx'
│   ├─ 自動加總 → 存為 HA10-01 的 dataPoint（用於管制圖和跨院區比較）
│   └─ 若 Excel 中已有「總計」列，與自動加總結果交叉驗證
│
└─ UI 呈現：
    ├─ 管制圖頁面：使用 HA10-01 加總值繪製管制圖（三院區一致）
    ├─ 新竹的指標詳情頁：額外顯示 13 個子類別的堆疊長條圖或明細表
    └─ 子類別不獨立建立管制圖
```

#### 9.1.3 TypeScript 實作

```typescript
// file: src/lib/constants/indicators.ts

// 主指標（三院區共用，用於管制圖）
{
  id: 'HA10-01',
  name: '異常事件通報數',
  aliases: ['異常事件通報件數', 'HA10-10'],  // 模糊比對用
  campus: ['hsinchu', 'zhubei', 'zhudong'],
  hasDenominator: false,
  dataNature: 'count',
  chartType: 'IMR',
  direction: 'higher',  // 通報數越多代表安全文化越好
  unit: '件',
  // 新竹院區特殊標記
  hsinchu_subCategories: [
    { id: 'HA10-10-01', name: '藥物事件' },
    { id: 'HA10-10-02', name: '跌倒事件' },
    { id: 'HA10-10-03', name: '手術事件' },
    { id: 'HA10-10-04', name: '輸血事件' },
    { id: 'HA10-10-05', name: '醫療照護事件' },
    { id: 'HA10-10-06', name: '公共意外事件' },
    { id: 'HA10-10-07', name: '治安事件' },
    { id: 'HA10-10-08', name: '傷害行為事件' },
    { id: 'HA10-10-09', name: '管路事件' },
    { id: 'HA10-10-10', name: '院內不預期心跳停止事件' },
    { id: 'HA10-10-11', name: '麻醉事件' },
    { id: 'HA10-10-12', name: '檢查/檢驗/病理切片事件' },
    { id: 'HA10-10-13', name: '其他事件' },
  ],
}

// Excel 匯入邏輯
function processHA10Import(campus: string, rawData: RawExcelData): void {
  if (campus === 'hsinchu') {
    // 1. 儲存 13 個子類別明細
    const subValues: number[] = [];
    for (const sub of HA10_SUB_CATEGORIES) {
      const value = rawData.getValue(sub.id);
      if (value !== null) {
        saveSubCategoryDataPoint(sub.id, campus, value);
        subValues.push(value);
      }
    }
    // 2. 自動加總並存為 HA10-01
    const total = subValues.reduce((a, b) => a + b, 0);
    saveDataPoint('HA10-01', campus, total);

    // 3. 若 Excel 有總計列，交叉驗證
    const excelTotal = rawData.getValue('HA10-10-total');
    if (excelTotal !== null && excelTotal !== total) {
      logWarning(`HA10 加總不一致：Excel 總計=${excelTotal}, 子類別合計=${total}`);
    }
  } else {
    // 竹北/竹東：直接讀取 HA10-01
    const value = rawData.getValue('HA10-01');
    saveDataPoint('HA10-01', campus, value);
  }
}
```

### 9.2 名稱差異

| 指標 | 新竹稱呼 | 竹東稱呼 | 管制圖是否受影響 |
|------|---------|---------|:------:|
| HA09 系列 | 亞急性呼吸照護 | 慢性呼吸照護 | 否 |

### 9.3 HA10-04 病床開放率特殊處理

此指標有分子分母結構，但分母（衛生局登記床數）通常為固定值。建議：
- 預設使用 **I-MR Chart**（因分母不變，P Chart 退化為固定界限，與 I-MR 差異不大）
- 若未來登記床數變動，可切換為 P Chart

### 9.4 HA10-09 護病比特殊處理

此指標雖有分子分母結構，但計算結果是連續型數值（非二元事件比例）。
- 固定使用 **I-MR Chart**
- 不提供 P Chart 或 U Chart 選項

---

## 10. 驗證測試計畫

### 10.1 管制圖選型驗證

建立自動化測試，確認每個指標的管制圖選型正確：

```typescript
// file: src/lib/engine/__tests__/chartTypeSelector.test.ts

const expectedMapping = [
  { id: 'HA01-01', expected: 'P',   nature: 'proportion' },
  { id: 'HA01-02', expected: 'P',   nature: 'proportion' },
  { id: 'HA01-03', expected: 'P',   nature: 'proportion' },
  { id: 'HA02-01', expected: 'P',   nature: 'proportion' },
  { id: 'HA02-02', expected: 'P',   nature: 'proportion' },
  { id: 'HA02-11', expected: 'U',   nature: 'density'    },
  { id: 'HA02-12', expected: 'U',   nature: 'density'    },
  { id: 'HA02-13', expected: 'U',   nature: 'density'    },
  { id: 'HA03-01', expected: 'P',   nature: 'proportion' },
  { id: 'HA03-02', expected: 'P',   nature: 'proportion' },
  { id: 'HA03-03', expected: 'P',   nature: 'proportion' },
  { id: 'HA03-04', expected: 'P',   nature: 'proportion' },
  { id: 'HA04-01', expected: 'P',   nature: 'proportion' },
  { id: 'HA04-02', expected: 'P',   nature: 'proportion' },
  { id: 'HA05-01', expected: 'P',   nature: 'proportion' },
  { id: 'HA05-02', expected: 'P',   nature: 'proportion' },
  { id: 'HA05-03', expected: 'P',   nature: 'proportion' },
  { id: 'HA06-01', expected: 'P',   nature: 'proportion' },
  { id: 'HA06-11', expected: 'P',   nature: 'proportion' },
  { id: 'HA06-13', expected: 'P',   nature: 'proportion' },
  { id: 'HA06-21', expected: 'P',   nature: 'proportion' },
  { id: 'HA06-23', expected: 'P',   nature: 'proportion' },
  { id: 'HA06-24', expected: 'P',   nature: 'proportion' },
  { id: 'HA06-25', expected: 'P',   nature: 'proportion' },
  { id: 'HA06-31', expected: 'IMR', nature: 'count'      },
  { id: 'HA06-32', expected: 'P',   nature: 'proportion' },
  { id: 'HA07-01', expected: 'U',   nature: 'density'    },
  { id: 'HA08-01', expected: 'IMR', nature: 'count'      },
  { id: 'HA09-01', expected: 'U',   nature: 'density'    },
  { id: 'HA09-02', expected: 'U',   nature: 'density'    },
  { id: 'HA09-03', expected: 'U',   nature: 'density'    },
  { id: 'HA09-04', expected: 'P',   nature: 'proportion' },
  { id: 'HA09-05', expected: 'P',   nature: 'proportion' },
  { id: 'HA10-01', expected: 'IMR', nature: 'count'      },
  { id: 'HA10-02', expected: 'IMR', nature: 'count'      },
  { id: 'HA10-03', expected: 'IMR', nature: 'count'      },
  { id: 'HA10-04', expected: 'P',   nature: 'proportion' },
  { id: 'HA10-09', expected: 'IMR', nature: 'continuous'  },
];
```

### 10.2 管制界限計算驗證

使用已知數據驗證三種管制圖的計算結果：

```typescript
// P Chart 驗證
// 假設 6 個月的數據：分子 [3,5,2,4,6,3]，分母 [100,120,95,110,130,105]
// p̄ = 23/660 = 0.03485
// 第 1 個月 UCL = 0.03485 + 3*sqrt(0.03485*0.96515/100) = 0.0897

// U Chart 驗證
// 假設 6 個月：事件數 [1,0,2,1,0,1]，暴露人日 [500,480,520,510,490,500]
// ū = 5/3000 = 0.001667
// 第 1 個月 UCL = 0.001667 + 3*sqrt(0.001667/500) = 0.007145

// I-MR Chart 驗證
// 假設 6 個月數值：[2.1, 1.8, 2.3, 2.0, 2.5, 1.9]
// X̄ = 2.1, MR = [0.3,0.5,0.3,0.5,0.6], MR̄ = 0.44
// σ = 0.44/1.128 = 0.39
// UCL = 2.1 + 3*0.39 = 3.27, LCL = max(0, 2.1 - 3*0.39) = 0.93
```

---

## 11. 給 Claude Code 的實作提示

1. **從 Phase 0 開始**：先把型別定義和 38 個指標常數寫好，這是所有後續工作的基礎。
2. **管制圖計算引擎是核心**：Phase 1 的三個計算函數必須 100% 正確，用單元測試驗證。
3. **雙層策略是設計精髓**：Layer 1 (I-MR) 保底 + Layer 2 (P/U) 精確，兩者共存而非互斥。
4. **P/U Chart 的管制界限是曲線**：這是與 I-MR Chart 最大的 UI 差異，繪製時注意。
5. **稀有事件自動退回**：P Chart 的 `p̄ × n < 5` 檢查必須實作，否則管制界限會失真。
6. **指標代碼是唯一鍵**：同一代碼在不同院區的管制圖類型完全相同，不需要按院區分別處理選型邏輯。
7. **HA10 異常事件通報的跨院區處理**：新竹有 13 個子類別（HA10-10-01~13），需自動加總為 HA10-01 才能與竹北/竹東比較。子類別僅作明細查看，不獨立建管制圖。詳見第 9.1 節。
8. **方向性很重要**：`HA03-04`（預防性抗生素）和多數指標的方向性不同（higher is better），確保 direction 欄位正確。
9. **基線窗口 = 最近 24 個有效數據點**：所有管制界限計算都只用最近 24 點，不是全部歷史數據。圖表可顯示全部歷史點，但管制線基於最近 24 個月。數據不足 24 點時按第 5.4 節的邊界規則處理。
