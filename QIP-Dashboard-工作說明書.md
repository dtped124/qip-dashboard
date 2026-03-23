# QIP 持續性監測指標儀表板 — 工作說明書

> **版本**：v1.1 | **日期**：2026-03-02
> **目的**：提供 Claude Code 完整的開發規格，一次性建置「醫院評鑑持續性監測指標儀表板」
> **v1.1 變更**：新增 TCPI 標竿匯入系統（§2.9）、分子/分母解析與管制圖選型（§2.10, §4.11）、狀態燈號改為六級制（§4.3）

---

## 一、專案背景

本系統為台灣某區域教學醫院（含竹北院區、竹東院區）的品管中心所開發。醫院需在 2027 年接受醫學中心評鑑，需要一套視覺化儀表板來呈現 110 年至 115 年（民國年）的持續性監測指標（QIP）數據，供院長、副院長、科主任快速判讀指標狀態、趨勢與標竿比較。

---

## 二、資料來源規格

### 2.1 檔案格式

- 來源檔案：`.xls`（舊版 Excel 格式）
- 檔名範例：`生醫115年醫院評鑑持續性監測指標-臨床指標呈核0226.xls`
- 解析套件：使用 SheetJS（xlsx library）在瀏覽器端解析

### 2.2 工作表結構（17 張工作表）

| 工作表名稱模式 | 說明 | 年份涵蓋 |
|---|---|---|
| `{年}年醫院評鑑持續性監測指標(竹北)` | 竹北院區單獨數據 | 110-115 年 |
| `{年}年醫院評鑑持續性監測指標(竹東)` | 竹東院區單獨數據 | 110-115 年 |
| `{年}年醫院評鑑持續性監測指標 (竹北+竹東)` | 兩院區合併數據 | 110-114 年 |

**優先解析的工作表**（核心數據源）：
- 各年度的竹北單獨、竹東單獨工作表（共 12 張）
- 合併工作表可作為驗證或備用

### 2.3 欄位結構（111-115 年的竹北/竹東工作表）

| 欄位位置 | 內容 | 備註 |
|---|---|---|
| Col A (0) | 類別（面向分類） | 合併儲存格，只有該區段第一行有值 |
| Col B (1) | 序號 NO | 正整數時才是指標資料行 |
| Col C (2) | 指標代碼 | 如 `HA01-01`、`HA02-11` |
| Col D (3) | QIP 指標名稱 | 完整中文名稱 |
| Col E-P (4-15) | 1 月 ~ 12 月數值 | 格式如 `115.01` ~ `115.12` |
| Col Q (16) | 本年度平均值 / 本年度成果 | 竹北標「平均值」，竹東標「成果」 |
| Col R (17) | 前一年平均值 / 區域醫院標竿 | 因年度而異 |
| Col S (18) | 前二年平均值 / 地區醫院標竿 | 因年度而異 |
| Col T (19) | 區域醫院標竿 | 部分年度有 |
| Col U (20) | 地區醫院標竿 | 部分年度有 |

**110 年工作表欄位差異**：
- 無指標代碼欄位（Col C 直接是指標名稱）
- 月份數值與分數合併在同一格（如 `3.33%\n(16/480)`）
- 標竿值在 Col P-Q（區域醫院平均值 / 地區醫院平均值）

### 2.4 數據行識別規則（含分子/分母提取）

Excel 中每個指標佔兩行：上排是數值行，下排是分子/分母行。**兩行都要解析**。

```
判斷邏輯：
1. Col B (NO) 為正整數 → 這是指標「數值行」，提取月份值和年均值
2. 前一行是指標行、且本行 Col E 起有 "(數字/數字)" 格式 → 這是「分子/分母行」
   → 解析每個月的 (numerator/denominator)，存入對應數據點
3. 其餘空白行 → 跳過
```

**分子/分母解析範例**：

```
數值行:   [NO=1] [HA01-01] [住院死亡率] [2.12] [2.02] [2.27] ...
分母行:   [    ] [       ] [          ] [(24/1130)] [(21/1040)] [(26/1144)] ...

解析結果:
  114年1月: value=2.12, numerator=24, denominator=1130
  114年2月: value=2.02, numerator=21, denominator=1040
```

**110 年特殊格式**：值與分數合併在同一格 `"3.33%\n(16/480)"`，需拆解：
```
const match = cellValue.match(/^([\d.]+)%?\s*\n?\((\d+)\/(\d+)\)$/);
// match[1]=3.33 (值), match[2]=16 (分子), match[3]=480 (分母)
```

**重要**：分子/分母數據是管制圖正確選型的基礎。沒有分子分母就只能用 I-MR Chart；有了分子分母就能升級到 P Chart 或 U Chart（見 §4.11）。

### 2.5 數值清洗規則

| 原始值 | 清洗後 | 說明 |
|---|---|---|
| `2.13` | `2.13`（百分比呈現） | 部分月份值為百分比 × 100 |
| `0.0198` | `0.0198`（小數呈現） | 部分年平均值為原始比率 |
| `0‰` 或 `0.73‰` | `0` 或 `0.73`（千分比） | 感染率指標使用 ‰ |
| `NR` | `null` | 無資料 |
| `NP` | `null` | 不適用 |
| 空字串 `""` | `null` | 尚未收集 |
| `(26/1223)` | numerator=26, denominator=1223 | 分子/分母行，提取並存入對應數據點 |
| `-` | `null` | 無變化或無資料 |

**關鍵：數值單位不一致問題**
- 月份值有時為 "百分比 ×100"（如 `2.13` 代表 2.13%），有時為小數（如 `0.0198`）
- 年平均值通常為小數（如 `0.0198`）
- **解析策略**：統一轉換為小數（0-1 範圍），呈現時再格式化為百分比或千分比
  - 若值 > 1 且該指標通常為比率 → 除以 100
  - 感染率指標（含 ‰ 標記）→ 除以 1000
  - 標竿值同樣需要統一單位

### 2.6 面向分類（9 大類）

| 面向 | 面向代碼前綴 | 竹北指標數 | 竹東指標數 | 建議配色 |
|---|---|---|---|---|
| 整體照護 | HA01 | 3 | 3 | `#3B82F6` 藍 |
| 加護照護 | HA02 | 5 | 5 | `#EF4444` 紅 |
| 手術照護 | HA03 | 4 | 4 | `#F97316` 橘 |
| 產科照護 | HA04 | 2 | 0（竹東無） | `#EC4899` 粉 |
| 急診照護 | HA05 | 3 | 2 | `#8B5CF6` 紫 |
| 重點照護 | HA06 | 9 | 2 | `#06B6D4` 青 |
| 感染管制 | HA07 | 1 | 1 | `#10B981` 綠 |
| 用藥安全 | HA08 | 1 | 1 | `#F59E0B` 黃 |
| 呼吸照護 | HA09 | 0（竹北無） | 4 | `#6366F1` 靛 |
| 經營管理 | HA10 | 5 | 5 | `#6B7280` 灰 |

> 竹北約 33 項指標，竹東約 27 項指標（含竹東獨有的呼吸照護 HA09 系列）

### 2.7 完整指標清單

#### 竹北院區（33 項）

```
整體照護:
  1. HA01-01  住院死亡率(含病危自動出院)
  2. HA01-02  出院14天內因相同或相關病情非計畫性再住院率
  3. HA01-03  急性病床住院案件住院日數超過30日比率 [季指標]

加護照護:
  4. HA02-01  48小時(含)內加護病房重返率
  5. HA02-02  加護病房死亡率(含病危自動出院)
  6. HA02-11  加護病房呼吸器相關肺炎(‰) [千分比]
  7. HA02-12  加護病房留置導尿管相關尿路感染(‰) [千分比]
  8. HA02-13  加護病房中心導管相關血流感染(‰) [千分比]

手術照護:
  9. HA03-01  手術後48小時內死亡率(含病危自動出院)
  10. HA03-02 所有手術病人住院期間非計畫相關重返手術室
  11. HA03-03 所有住院病人手術部位感染
  12. HA03-04 預防性抗生素在手術劃刀前1小時給予比率

產科照護:
  13. HA04-01 總剖腹產率
  14. HA04-02 初次剖腹產率

急診照護:
  15. HA05-01 急診轉住院比率
  16. HA05-02 急診會診超過30分鐘比率
  17. HA05-03 緊急重大外傷手術於30分鐘內進入開刀房比率

感染管制:
  18. HA07-01 醫療照護相關感染(‰) [千分比]

重點照護:
  19. HA06-01 全院腹膜透析病人比率
  20. HA06-11 急性心肌梗塞-STEMI到急診90分鐘內施予緊急PCI比率
  21. HA06-13 急性心肌梗塞住院中死亡率(含病危自動出院)
  22. HA06-32 急性心肌梗塞出院時給予乙型阻斷劑比率
  23. HA06-21 急性缺血性中風接受IV-tPA治療比率
  24. HA06-23 急性缺血性中風抵達急診60分鐘內接受IV-tPA治療比率
  25. HA06-24 急性缺血性腦中風接受IV-tPA治療發生症狀性腦出血比率
  26. HA06-25 急性缺血性中風發作2小時內抵達急診且3小時內施打IV-tPA
  27. HA06-31 接受安寧共同照護個案數 [絕對數]

用藥安全:
  32. HA08-01 藥物不良反應通報件數 [絕對數]

經營管理:
  33. HA10-01 異常事件通報件數 [絕對數]
  34. HA10-02 醫院員工遭受暴力事件數 [絕對數]
  35. HA10-03 醫院員工發生職業災害件數 [絕對數]
  36. HA10-04 急性一般病床開放率
  37. HA10-09 急性一般病床全日平均護病比
```

#### 竹東院區獨有指標（除上述共同指標外）

```
呼吸照護:
  29. HA09-01 慢性呼吸照護病房中心導管相關血流感染(‰) [千分比]
  30. HA09-02 慢性呼吸照護病房呼吸器相關肺炎(‰) [千分比]
  31. HA09-03 慢性呼吸照護病房留置導尿管相關尿路感染(‰) [千分比]
  32. HA09-04 慢性呼吸照護病房呼吸器脫離成功率

竹東無產科照護（HA04）和部分急診/重點照護指標
```

### 2.8 指標特殊屬性

| 屬性 | 適用指標 | 處理方式 |
|---|---|---|
| 季指標 | HA01-03 | 只有 1、4、7、10 月有值，其餘為 null |
| 千分比 (‰) | HA02-11/12/13, HA07-01, HA09-01/02/03 | 數值 × 1000 顯示，加 ‰ 後綴 |
| 絕對數 | HA06-31, HA08-01, HA10-01/02/03 | 不是比率，顯示為整數 |
| 反向指標 | HA03-04, HA06-11/23/24/25/32, HA06-01 | 越高越好（多數指標越低越好） |

### 2.9 TCPI 標竿匯入系統（新增 v1.1）

#### 2.9.1 背景

除了 QIP Excel 內附的標竿值外，醫院另有來自醫策會的 **TCPI（台灣臨床成效指標）年值報表**，檔名為 `2024-2025TCPI指標年值報表-綜合(公告版)`。此報表提供全國各層級醫院的同儕平均值，作為更權威的標竿來源。

#### 2.9.2 標竿對照規則

三個院區層級各自對照不同的 TCPI 同儕值：

| 院區 | 對照層級 | 說明 |
|---|---|---|
| **新竹**（兩院區合併） | 醫學中心 | 2027 年目標升格醫學中心 |
| **竹北** | 區域醫院 | 目前評鑑等級 |
| **竹東** | 地區醫院 | 目前評鑑等級 |

#### 2.9.3 QIP → TCPI 指標對應表

以下是 QIP 指標與 TCPI 指標的名稱對應關係。TCPI 的指標名稱可能與 QIP 略有不同，系統需根據此對應表進行配對。**TCPI 標竿值需附上年度標記**（如「113 年 TCPI」）。

| QIP 代碼 | QIP 指標名稱 | TCPI 對應指標名稱 | 備註 |
|---|---|---|---|
| HA01-01 | 住院死亡率(含病危自動出院) | 住院病人死亡率 | 定義一致 |
| HA01-02 | 出院14天內非計畫性再住院率 | 出院14天內非計畫性再住院率 | 完全一致 |
| HA01-03 | 住院日數超過30日比率 | — | TCPI 無直接對應 |
| HA02-01 | 48小時內加護病房重返率 | 加護病房48小時內非計畫重返率 | 定義一致 |
| HA02-02 | 加護病房死亡率 | 加護病房病人死亡率 | 定義一致 |
| HA02-11 | 加護病房呼吸器相關肺炎(‰) | 加護病房呼吸器相關肺炎發生密度 | 單位皆為 ‰ |
| HA02-12 | 加護病房導尿管相關尿路感染(‰) | 加護病房留置導尿管相關泌尿道感染發生密度 | 單位皆為 ‰ |
| HA02-13 | 加護病房中心導管相關血流感染(‰) | 加護病房中心導管相關血流感染發生密度 | 單位皆為 ‰ |
| HA03-01 | 手術後48小時內死亡率 | 手術後48小時(含)內死亡率 | 定義一致 |
| HA03-02 | 非計畫相關重返手術室 | 所有住院手術病人非計畫重返手術室比率 | 定義一致 |
| HA03-03 | 手術部位感染 | 所有住院手術病人手術部位感染率 | 定義一致 |
| HA03-04 | 預防性抗生素手術劃刀前1小時給予比率 | 手術前一小時(含)內預防性抗生素給予率 | 定義一致 |
| HA04-01 | 總剖腹產率 | 總剖腹產率 | 完全一致 |
| HA04-02 | 初次剖腹產率 | 初次剖腹產率 | 完全一致 |
| HA05-01 | 急診轉住院比率 | — | TCPI 無直接對應 |
| HA05-02 | 急診會診超過30分鐘比率 | — | TCPI 無直接對應 |
| HA05-03 | 緊急重大外傷手術30分鐘內入開刀房比率 | — | TCPI 無直接對應 |
| HA06-01 | 全院腹膜透析病人比率 | — | TCPI 無直接對應 |
| HA06-11 | STEMI 90分鐘內施予PCI比率 | 急性心肌梗塞到院後90分鐘內接受心導管介入治療比率 | 定義一致 |
| HA06-13 | 急性心肌梗塞住院中死亡率 | 急性心肌梗塞住院期間死亡率 | 定義一致 |
| HA06-21 | 急性缺血性中風接受IV-tPA比率 | 急性缺血性中風接受靜脈血栓溶解劑治療比率 | 定義一致 |
| HA06-23 | 急性缺血性中風60分鐘內接受IV-tPA比率 | — | TCPI 無直接對應（TCPI 有類似但時間定義不同） |
| HA06-24 | IV-tPA治療發生症狀性腦出血比率 | — | TCPI 無直接對應 |
| HA06-25 | 2小時內抵達且3小時內施打IV-tPA | — | TCPI 無直接對應 |
| HA06-31 | 接受安寧共同照護個案數 | — | TCPI 無直接對應（為絕對數） |
| HA06-32 | 急性心肌梗塞出院時給予乙型阻斷劑比率 | — | TCPI 無直接對應 |
| HA07-01 | 醫療照護相關感染(‰) | 全院醫療照護相關感染發生密度 | 單位皆為 ‰ |
| HA08-01 | 藥物不良反應通報件數 | — | TCPI 無直接對應（為絕對數） |
| HA09-01 | 慢性呼吸照護中心導管相關血流感染(‰) | — | TCPI 無直接對應 |
| HA09-02 | 慢性呼吸照護呼吸器相關肺炎(‰) | — | TCPI 無直接對應 |
| HA09-03 | 慢性呼吸照護導尿管相關尿路感染(‰) | — | TCPI 無直接對應 |
| HA09-04 | 慢性呼吸照護呼吸器脫離成功率 | — | TCPI 無直接對應 |
| HA10-01 | 異常事件通報件數 | — | 為絕對數 |
| HA10-02 | 醫院員工遭受暴力事件數 | — | 為絕對數 |
| HA10-03 | 醫院員工發生職業災害件數 | — | 為絕對數 |
| HA10-04 | 急性一般病床開放率 | — | TCPI 無直接對應 |
| HA10-09 | 急性一般病床全日平均護病比 | — | TCPI 無直接對應 |

> **約 16 個 QIP 指標可在 TCPI 找到直接對應**，其餘為空白（無 TCPI 標竿）。

#### 2.9.4 TCPI 匯入功能規格

系統需提供**獨立的 TCPI 標竿匯入入口**（與 QIP 資料匯入分開）：

```
位置：設定頁面 或 側邊導航「標竿管理」區塊
流程：
1. 上傳 TCPI 年值報表 Excel 檔案
2. 系統解析出指標名稱 + 三個層級（醫學中心/區域醫院/地區醫院）的值
3. 自動比對 QIP 指標（根據上表的對應關係）
4. 顯示配對預覽：已配對 N 項、未配對 M 項
5. 使用者確認後，TCPI 標竿值載入系統
6. 儀表板的標竿比較區自動新增 TCPI 標竿線
```

**標竿呈現方式**：在標竿比較圖中，每個指標可能有兩組標竿：
- **QIP 標竿**（原始 Excel 內的區域/地區醫院平均值）→ 淺色虛線
- **TCPI 標竿**（匯入的 TCPI 年值）→ 粗紅色虛線，標註「113年TCPI醫學中心」等文字

#### 2.9.5 TCPI 解析器需求

由於 TCPI 報表格式由醫策會制定，結構可能因年度微調。解析器需：
- 自動偵測報表中的指標名稱欄、醫學中心欄、區域醫院欄、地區醫院欄
- 使用模糊比對（Fuzzy Match）將 TCPI 指標名稱配對到 QIP 指標
- 配對失敗時允許使用者手動指定對應關係

### 2.10 分子/分母數據模型（新增 v1.1）

由於 Excel 報表中**每個指標都附有 (分子/分母)**，資料結構必須擴充以儲存這些原始數據：

```typescript
// 擴充後的月份數據點
export interface MonthlyDataPoint {
  year: number;           // 民國年 110-115
  month: number;          // 1-12
  value: number | null;   // 已計算的指標值（比率或密度）
  numerator: number | null;   // ★ 分子（如死亡人數）
  denominator: number | null; // ★ 分母（如住院人次）
}
```

**分子/分母解析函數**：

```typescript
function parseFraction(raw: string): { numerator: number; denominator: number } | null {
  // 格式: "(24/1130)" 或 "(0/59)"
  const match = String(raw).match(/\((\d+)\/(\d+)\)/);
  if (!match) return null;
  return {
    numerator: parseInt(match[1]),
    denominator: parseInt(match[2])
  };
}
```

**指標值自動驗算**：有了分子分母後，系統應自動從 `numerator / denominator` 計算值，與 Excel 上排的值交叉比對，確保數據一致性。若不一致則在匯入預覽中標示警告。

---

## 三、技術架構

### 3.1 技術棧

```
框架：Next.js 14+ (App Router)
語言：TypeScript
樣式：Tailwind CSS
圖表：Recharts
Excel 解析：SheetJS (xlsx)
狀態管理：React Context + useReducer
部署：Vercel（或靜態導出）
```

### 3.2 專案結構

```
qip-dashboard/
├── app/
│   ├── layout.tsx              # 根 Layout（含側邊導航）
│   ├── page.tsx                # 首頁（總覽儀表板）
│   ├── globals.css             # Tailwind + 自訂樣式
│   └── indicators/
│       └── [code]/
│           └── page.tsx        # 單一指標詳情頁（動態路由）
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx         # 側邊導航（面向分類 + 院區切換）
│   │   ├── Header.tsx          # 頂部標題列 + 搜尋
│   │   └── AlertBanner.tsx     # 警示橫幅
│   ├── dashboard/
│   │   ├── OverviewStats.tsx   # 總覽統計卡片（達標率、警示數等）
│   │   ├── CategorySection.tsx # 面向區段（含指標卡片列表）
│   │   ├── IndicatorCard.tsx   # 單一指標卡片
│   │   ├── StatusBadge.tsx     # 狀態燈號元件
│   │   ├── Sparkline.tsx       # 迷你趨勢圖
│   │   ├── TrendArrow.tsx      # 趨勢箭頭（↗ ↘ →）
│   │   └── ViewToggle.tsx      # 卡片/表格模式切換
│   ├── charts/
│   │   ├── YearOverlayChart.tsx    # 多年疊合趨勢圖（核心圖表）
│   │   ├── BenchmarkBar.tsx        # 標竿比較水平長條圖
│   │   ├── YearCompareBar.tsx      # 年度比較長條圖
│   │   └── ControlChart.tsx        # 管制圖（I-MR/P/U 自動選型）★ v1.1
│   ├── detail/
│   │   ├── IndicatorDetail.tsx     # 指標詳情 Modal/面板
│   │   ├── DataTable.tsx           # 完整數據表格（含分子/分母欄）
│   │   └── NoteSection.tsx         # 改善備註區（預留擴充）
│   └── import/
│       ├── FileUploader.tsx        # 拖放上傳元件（QIP 資料）
│       ├── TCPIUploader.tsx        # TCPI 標竿上傳元件 ★ v1.1
│       ├── ImportPreview.tsx       # 解析預覽確認
│       └── ImportSummary.tsx       # 匯入結果摘要
├── lib/
│   ├── types.ts                # TypeScript 型別定義
│   ├── constants.ts            # 面向配色、指標元資料
│   ├── excel-parser.ts         # QIP Excel 解析核心邏輯（含分子/分母）★
│   ├── tcpi-parser.ts          # TCPI 標竿報表解析器 ★ v1.1
│   ├── data-cleaner.ts         # 數值清洗與單位統一
│   ├── status-engine.ts        # 狀態燈號判定邏輯（六級制）
│   ├── trend-calculator.ts     # 趨勢計算（線性回歸斜率）
│   ├── chart-selector.ts       # 管制圖智慧選型引擎 ★ v1.1
│   ├── control-chart-calc.ts   # 管制圖界限計算（I-MR/P/U）★ v1.1
│   └── store.ts                # 全域狀態管理
├── data/
│   └── sample-data.json        # 預設範例資料（首次載入用）
├── public/
│   └── sample.xls              # 範例 Excel 檔（可選）
├── package.json
├── tsconfig.json
├── tailwind.config.ts
└── next.config.js
```

### 3.3 核心型別定義 (`lib/types.ts`)

```typescript
// 面向分類
export type Category =
  | '整體照護' | '加護照護' | '手術照護' | '產科照護'
  | '急診照護' | '重點照護' | '感染管制' | '用藥安全'
  | '呼吸照護' | '經營管理';

// 院區
export type Campus = '竹北' | '竹東';

// 指標狀態（六級制，v1.1 更新）
export type IndicatorStatus = 'alert' | 'warn' | 'watch' | 'good' | 'excellent' | 'neutral';

// 趨勢方向
export type TrendDirection = 'up' | 'down' | 'flat';

// 管制圖類型（v1.1 新增）
export type ControlChartType = 'I-MR' | 'P' | 'U' | 'C' | 'G' | 'EWMA' | 'CUSUM';

// 數據本質（v1.1 新增）
export type DataNature = 'continuous' | 'binomial_rate' | 'poisson_rate' | 'count';

// 單一月份數據點（v1.1 擴充：含分子/分母）
export interface MonthlyDataPoint {
  year: number;               // 民國年 110-115
  month: number;              // 1-12
  value: number | null;       // 已計算的比率或密度值
  numerator: number | null;   // ★ 分子（如死亡人數 26）
  denominator: number | null; // ★ 分母（如住院人次 1223）
}

// 年度摘要
export interface YearlySummary {
  year: number;
  average: number | null;
  benchmarkRegional: number | null;   // 區域醫院標竿（QIP Excel 內）
  benchmarkDistrict: number | null;   // 地區醫院標竿（QIP Excel 內）
}

// TCPI 標竿值（v1.1 新增）
export interface TCPIBenchmark {
  year: number;                        // TCPI 年度（如 113）
  medicalCenter: number | null;        // 醫學中心同儕值（新竹用）
  regionalHospital: number | null;     // 區域醫院同儕值（竹北用）
  districtHospital: number | null;     // 地區醫院同儕值（竹東用）
}

// 指標元資料（v1.1 擴充：管制圖 + TCPI 對應）
export interface IndicatorMeta {
  code: string;            // HA01-01
  name: string;            // 住院死亡率(含病危自動出院)
  category: Category;      // 整體照護
  unit: 'percent' | 'permille' | 'count' | 'ratio';
  isQuarterly: boolean;    // 季指標
  isReverse: boolean;      // true = 越高越好
  campuses: Campus[];      // ['竹北'] 或 ['竹北', '竹東']
  // ★ v1.1 新增
  dataNature: DataNature;                // 數據本質
  theoreticalChartType: ControlChartType; // 理論最佳管制圖
  tcpiName: string | null;               // TCPI 對應指標名稱（null = 無對應）
}

// 完整指標數據
export interface IndicatorData {
  meta: IndicatorMeta;
  campus: Campus;
  monthlyData: MonthlyDataPoint[];     // 所有年月數據（含分子/分母）
  yearlySummaries: YearlySummary[];    // 各年度摘要
  tcpiBenchmarks: TCPIBenchmark[];     // ★ TCPI 標竿值列表
  latestValue: number | null;          // 最新有值的月份
  latestMonth: string | null;          // 如 "115.01"
  status: IndicatorStatus;             // 當前狀態（六級制）
  trend: TrendDirection;               // 近期趨勢
  benchmarkValue: number | null;       // 當前適用的標竿值
  actualChartType: ControlChartType;   // ★ 實際使用的管制圖類型
}

// 全域狀態
export interface DashboardState {
  campus: Campus;
  indicators: IndicatorData[];
  loading: boolean;
  error: string | null;
  viewMode: 'card' | 'table';
  searchQuery: string;
  selectedCategory: Category | 'all';
  selectedYear: number;
  tcpiLoaded: boolean;                 // ★ TCPI 標竿是否已載入
}
```

---

## 四、功能規格

### 4.1 首頁總覽（Dashboard Overview）

**資訊層次（由快到慢）**：

1. **第一層（3 秒判讀）**：總覽統計列
   - 總指標數 / 達標數 / 警示數 / 注意數
   - 本月已收集比率
   - 圓餅圖或進度環呈現達標率

2. **第二層（10 秒瀏覽）**：按面向分組的指標卡片
   - 每個面向一個區塊，標題含面向名稱 + 配色
   - 面向下方為指標卡片排列

3. **警示橫幅**：自動浮現最近超標的指標（紅/黃燈），無警示時隱藏

### 4.2 指標卡片（Indicator Card）

每張卡片必須同時呈現四項資訊：

```
┌─────────────────────────────────────┐
│ 🔴 HA02-02                          │  ← 狀態燈號 + 指標代碼
│ 加護病房死亡率                        │  ← 指標名稱
│                                     │
│ 6.33%        [迷你趨勢線 ~~~~~~~~]  │  ← 最新值 + Sparkline
│ 標竿: 11.87%   趨勢: ↘             │  ← 標竿值 + 趨勢箭頭
│ 114年均: 9.38%                      │  ← 去年平均
└─────────────────────────────────────┘
```

### 4.3 狀態燈號邏輯 (`lib/status-engine.ts`)（v1.1 更新為六級制）

```typescript
function calculateStatus(
  value: number | null,
  benchmark: number | null,
  isReverse: boolean
): IndicatorStatus {
  if (value === null || benchmark === null) return 'neutral';

  // 計算偏離比例
  const ratio = isReverse ? value / benchmark : benchmark / value;
  // ratio > 1 表示表現優於標竿，< 1 表示劣於標竿

  // 正向指標（越低越好，如死亡率）
  if (!isReverse) {
    if (value <= benchmark * 0.5) return 'excellent'; // 遠優於標竿
    if (value <= benchmark * 0.8) return 'good';      // 明顯優於標竿
    if (value <= benchmark)       return 'watch';     // 達標但接近邊緣
    if (value <= benchmark * 1.3) return 'warn';      // 略超標竿
    return 'alert';                                    // 明顯超標
  }

  // 反向指標（越高越好，如遵從率）
  if (value >= benchmark * 1.5) return 'excellent';
  if (value >= benchmark * 1.2) return 'good';
  if (value >= benchmark)       return 'watch';
  if (value >= benchmark * 0.7) return 'warn';
  return 'alert';
}
```

狀態燈號視覺（六級制）：

| 狀態 | 顏色 | Tailwind Class | 中文標籤 | 說明 |
|---|---|---|---|---|
| alert | 紅 | `bg-red-500` | 警示 | 明顯超標，需立即介入 |
| warn | 橘 | `bg-orange-500` | 注意 | 略超標竿，需持續關注 |
| watch | 黃 | `bg-yellow-500` | 留意 | 達標但在邊緣，有滑落風險 |
| good | 綠 | `bg-green-500` | 良好 | 明顯優於標竿 |
| excellent | 藍 | `bg-blue-500` | 卓越 | 遠優於標竿，表現特出 |
| neutral | 灰 | `bg-gray-400` | 監測 | 無標竿值或無數據 |

### 4.4 趨勢計算 (`lib/trend-calculator.ts`)

使用最近 6 個有值的月份做線性回歸，取斜率方向：
- 斜率 > +閾值 → `up` ↗
- 斜率 < -閾值 → `down` ↘
- 其餘 → `flat` →

### 4.5 多年疊合趨勢圖（Year Overlay Chart）

這是詳情頁的**核心圖表**，設計規格如下：

```
Y軸: 指標值
X軸: 月份 (1-12月)

線條:
  - 115年: 粗實線 (#3B82F6)，帶數據點標記
  - 114年: 中粗實線 (#60A5FA)
  - 113年: 細虛線 (#93C5FD)
  - 112年: 細虛線 (#BFDBFE)
  - 標竿值: 紅色水平虛線 (#EF4444)

互動:
  - Tooltip 顯示各年同月數值
  - 可勾選/取消顯示特定年份
```

### 4.6 指標詳情頁

點擊卡片後展開（Modal 或右側面板），包含：

1. **指標基本資訊**：代碼、名稱、面向、計算公式說明
2. **多年疊合趨勢圖**
3. **年度比較長條圖**（112-115 年平均值）
4. **完整數據表格**（可展開所有月份）
5. **標竿比較**：自院值 vs 區域醫院 vs 地區醫院
6. **改善備註區**（預留擴充空間，目前為靜態文字框）

### 4.7 院區切換

- 側邊導航頂部放置院區切換（竹北 / 竹東）
- 切換後所有數據、卡片、圖表即時更新
- 竹東無產科照護等面向時，該區段自動隱藏
- 院區切換狀態記憶在 URL query（`?campus=竹北`）

### 4.8 搜尋與篩選

- 頂部搜尋列：支援指標代碼（HA02-01）或名稱關鍵字
- 側邊導航：點擊面向名稱快速捲動到該面向區段
- 表格模式支援欄位排序（按狀態、按值、按趨勢）

### 4.9 Excel 匯入功能

```
流程：
1. 點擊「匯入資料」按鈕
2. 拖放或選擇 .xls / .xlsx 檔案
3. 前端解析，顯示預覽：
   - 偵測到的工作表數量
   - 各工作表的年度和院區
   - 解析出的指標數量
   - 異常值警告（如值為負數或異常大）
4. 使用者確認後，數據載入到狀態中
5. 儀表板即時更新
```

### 4.10 檢視模式

- **卡片模式**（預設）：按面向分組的卡片牆，適合全局瀏覽
- **表格模式**：所有指標一覽表，可排序，適合逐項比對

### 4.11 管制圖系統（v1.1 新增 — 核心進階功能）

#### 4.11.1 設計原則

由於 Excel 報表中**每個指標都有分子/分母數據**，系統不再需要退回全部使用 I-MR Chart。改為**智慧選型**：根據每個指標的數據本質，自動選擇最正確的管制圖類型。

#### 4.11.2 指標管制圖選型總表

| QIP 代碼 | 指標名稱 | 數據本質 | 最佳圖型 | 選型理由 |
|---|---|---|---|---|
| HA01-01 | 住院死亡率 | 二項比率 | **P Chart** | 每位病人死亡/存活，分母(住院人次)可變 |
| HA01-02 | 非計畫性再住院率 | 二項比率 | **P Chart** | 每位離院者重返/未重返 |
| HA01-03 | 住院日數超過30日比率 | 二項比率 | **P Chart** | 季指標，分母為住院案件數 |
| HA02-01 | 48小時內ICU重返率 | 二項但稀有 | **I-MR** | 分母小(ICU轉出人次少)，p̄×n < 5 |
| HA02-02 | 加護病房死亡率 | 二項比率 | **P Chart** | 分母(ICU住院人次)夠大 |
| HA02-11 | 呼吸器相關肺炎(‰) | Poisson 但極稀有 | **I-MR** | 月事件數常為 0 |
| HA02-12 | 導尿管相關尿路感染(‰) | Poisson 密度 | **U Chart** | 事件計數/暴露人日，分母可變 |
| HA02-13 | 中心導管相關血流感染(‰) | Poisson 但稀有 | **I-MR** | 事件極少，但分母(導管日)較大 |
| HA03-01 | 手術後48小時內死亡率 | 二項但稀有 | **I-MR** | 事件極少(多數月份為 0) |
| HA03-02 | 非計畫重返手術室 | 二項但稀有 | **I-MR** | 事件稀少 |
| HA03-03 | 手術部位感染 | 二項但稀有 | **I-MR** | 事件稀少 |
| HA03-04 | 預防性抗生素給予比率 | 二項比率 | **P Chart** | 反向指標(越高越好)，分母大 |
| HA04-01 | 總剖腹產率 | 二項比率 | **P Chart** | 分母(活產數)穩定 |
| HA04-02 | 初次剖腹產率 | 二項比率 | **P Chart** | 同上 |
| HA05-01 | 急診轉住院比率 | 二項比率 | **P Chart** | 急診量大，分母充足 |
| HA05-02 | 急診會診超過30分鐘比率 | 二項比率 | **P Chart** | 分母(會診次數)大 |
| HA05-03 | 緊急外傷30分鐘內入開刀房 | 二項但稀有 | **I-MR** | 重大外傷案例少 |
| HA06-11 | STEMI 90分鐘內PCI比率 | 二項但稀有 | **I-MR** | STEMI 案例少 |
| HA06-13 | 急性心肌梗塞死亡率 | 二項但稀有 | **I-MR** | 案例少 |
| HA06-21 | 缺血性中風IV-tPA比率 | 二項但稀有 | **I-MR** | 案例少 |
| HA07-01 | 醫療照護相關感染(‰) | Poisson 密度 | **U Chart** | 事件計數/暴露人日 |
| HA08-01 | 藥物不良反應通報件數 | 計數 | **I-MR** | 絕對數，無分母 |
| HA09-01~03 | 慢性呼吸照護感染(‰) | Poisson 但極稀有 | **I-MR** | 事件極少 |
| HA09-04 | 呼吸器脫離成功率 | 二項但分母小 | **I-MR** | 竹東分母不足 |
| HA10-01~03 | 通報件數/暴力/職災 | 計數 | **I-MR** | 絕對數 |
| HA10-04 | 急性一般病床開放率 | 連續型 | **I-MR** | 純連續型比率 |
| HA10-09 | 護病比 | 連續型 | **I-MR** | 純連續型比率 |

**統計**：P Chart 9 個、U Chart 2 個、I-MR 22 個（含稀有事件退回）

#### 4.11.3 管制界限計算公式

**I-MR Chart**（所有指標的基礎層）：
```
CL = X̄（所有觀測值的平均）
MR = |X(i) - X(i-1)|
MR̄ = 移動全距的平均值

UCL = X̄ + 2.66 × MR̄
LCL = X̄ - 2.66 × MR̄     （LCL 不得 < 0）
（2.66 = 3/d₂，d₂ = 1.128 for n=2）
```

**P Chart**（二項比例，分母可變）：
```
p̄ = Σ numerator(i) / Σ denominator(i)

UCL(i) = p̄ + 3 × √( p̄(1-p̄) / denominator(i) )
LCL(i) = p̄ - 3 × √( p̄(1-p̄) / denominator(i) )

注意：管制界限隨每月分母 denominator(i) 變動（鋸齒狀）
      LCL 不得 < 0，UCL 不得 > 1
```

**U Chart**（Poisson 密度，分母可變）：
```
ū = Σ numerator(i) / Σ denominator(i)

UCL(i) = ū + 3 × √( ū / denominator(i) )
LCL(i) = ū - 3 × √( ū / denominator(i) )

注意：管制界限隨每月暴露量 denominator(i) 變動
      LCL 不得 < 0
```

#### 4.11.4 智慧選型引擎 (`lib/chart-selector.ts`)

```typescript
function determineChartType(
  indicator: IndicatorMeta,
  dataPoints: MonthlyDataPoint[]
): ControlChartType {
  // 有效數據點（有分子分母的）
  const validPoints = dataPoints.filter(
    dp => dp.numerator !== null && dp.denominator !== null
  );

  // 無分子分母 → 退回 I-MR
  if (validPoints.length < 12) return 'I-MR';

  // 連續型或絕對數 → I-MR
  if (indicator.dataNature === 'continuous' ||
      indicator.dataNature === 'count') return 'I-MR';

  // 二項比率型
  if (indicator.dataNature === 'binomial_rate') {
    const totalNum = validPoints.reduce((s, p) => s + p.numerator!, 0);
    const totalDen = validPoints.reduce((s, p) => s + p.denominator!, 0);
    const pBar = totalNum / totalDen;
    const avgN = totalDen / validPoints.length;
    // 稀有事件檢查：p̄ × n̄ < 5 則 P Chart 失效
    if (pBar * avgN < 5) return 'I-MR';
    return 'P';
  }

  // Poisson 密度型
  if (indicator.dataNature === 'poisson_rate') {
    const avgEvents = validPoints.reduce((s, p) => s + p.numerator!, 0) / validPoints.length;
    // 月平均事件數 < 1 則 U Chart 不穩定
    if (avgEvents < 1) return 'I-MR';
    return 'U';
  }

  return 'I-MR';
}
```

#### 4.11.5 管制圖 UI 規格

在指標詳情頁中，管制圖位於多年疊合趨勢圖下方：

```
┌──────────────────────────────────────────────┐
│ 管制圖：P Chart                    [切換圖型▼] │
│                                               │
│  UCL -----.----.----.----.---- (鋸齒狀虛線)    │
│           ·    ·    ·    ·                    │
│  CL  ─────────────────────── (中心線)         │
│           ·    ·    ·                         │
│  LCL -----.----.----.----.---- (鋸齒狀虛線)    │
│                                               │
│  X軸: 114.01 114.02 ... 115.01                │
│  紅色標記: 超出管制界限的異常點                   │
│  灰色區域: UCL-LCL 之間的管制帶                 │
└──────────────────────────────────────────────┘
```

**互動功能**：
- 右上角可切換查看 I-MR Chart（作為對照）
- 異常點（超出 UCL/LCL）標紅色圓點，hover 顯示詳情
- P Chart / U Chart 的管制界限為鋸齒狀（因分母逐月變化）
- 下方顯示管制圖類型和選型理由文字

### 4.12 TCPI 標竿匯入功能（v1.1 新增）

在側邊導航或設定頁增加「標竿管理」入口：

```
┌─────────────────────────────────┐
│ 📊 標竿管理                      │
│                                 │
│ QIP 標竿：已從 Excel 載入 ✅     │
│                                 │
│ TCPI 標竿：尚未載入              │
│ [上傳 TCPI 年值報表]             │
│                                 │
│ 上傳後將自動配對:                │
│  · 新竹合併 → 醫學中心標竿       │
│  · 竹北     → 區域醫院標竿       │
│  · 竹東     → 地區醫院標竿       │
└─────────────────────────────────┘
```

---

## 五、UI/UX 設計規範

### 5.1 整體風格

- **色調**：白底 + 淺灰背景（`bg-gray-50`），卡片白色（`bg-white`）
- **字型**：系統字型 `-apple-system, "Noto Sans TC", sans-serif`
- **圓角**：`rounded-lg`（8px）
- **陰影**：`shadow-sm`，hover 時 `shadow-md`
- **所有文字繁體中文**

### 5.2 響應式斷點

| 裝置 | 寬度 | 卡片欄數 | 側邊導航 |
|---|---|---|---|
| 桌面 | ≥1280px | 4 欄 | 固定展開 |
| 小桌面 | 1024-1279px | 3 欄 | 固定展開 |
| 平板 | 768-1023px | 2 欄 | 可收合 |
| 手機 | <768px | 1 欄 | 底部導航或漢堡 |

### 5.3 無障礙

- 狀態燈號除顏色外，加上文字標籤（優良/達標/注意/警示）
- 圖表提供 `aria-label`
- 鍵盤可操作（Tab 導航、Enter 展開詳情）

---

## 六、開發步驟（建議順序）

### Phase 1：基礎架構與數據層（優先）

```bash
# 步驟 1.1：初始化專案
npx create-next-app@latest qip-dashboard --typescript --tailwind --app --src-dir=false

# 步驟 1.2：安裝依賴
npm install xlsx recharts lucide-react

# 步驟 1.3：建立型別定義
# → lib/types.ts（完整型別如第三節）

# 步驟 1.4：建立常數定義
# → lib/constants.ts（面向配色、指標元資料映射表）

# 步驟 1.5：建立 Excel 解析器
# → lib/excel-parser.ts（核心邏輯，最複雜的部分）

# 步驟 1.6：建立數值清洗模組
# → lib/data-cleaner.ts

# 步驟 1.7：建立狀態引擎
# → lib/status-engine.ts + lib/trend-calculator.ts

# 步驟 1.8：建立全域狀態
# → lib/store.ts（Context + Reducer）
```

### Phase 2：核心 UI 元件

```
步驟 2.1：Layout 框架（Sidebar + Header）
步驟 2.2：OverviewStats 總覽列
步驟 2.3：IndicatorCard 指標卡片
步驟 2.4：StatusBadge 狀態燈號
步驟 2.5：Sparkline 迷你圖
步驟 2.6：CategorySection 面向區段
步驟 2.7：ViewToggle 檢視模式切換
步驟 2.8：AlertBanner 警示橫幅
```

### Phase 3：圖表與詳情

```
步驟 3.1：YearOverlayChart 多年疊合趨勢圖
步驟 3.2：YearCompareBar 年度比較圖
步驟 3.3：BenchmarkBar 標竿比較圖
步驟 3.4：IndicatorDetail 詳情面板
步驟 3.5：DataTable 完整數據表格
```

### Phase 4：匯入與互動

```
步驟 4.1：FileUploader 上傳元件
步驟 4.2：ImportPreview 預覽確認
步驟 4.3：搜尋功能
步驟 4.4：院區切換
步驟 4.5：URL 狀態同步
```

### Phase 5：管制圖與 TCPI 標竿（v1.1 升為核心功能）

```
步驟 5.1：chart-selector.ts 智慧選型引擎
步驟 5.2：ControlChart 元件（I-MR Chart 基礎層）
步驟 5.3：P Chart 實作（含鋸齒狀管制界限）
步驟 5.4：U Chart 實作
步驟 5.5：TCPI 標竿解析器（tcpi-parser.ts）
步驟 5.6：TCPI 匯入 UI（標竿管理頁面）
步驟 5.7：標竿比較圖整合 TCPI 數據線
```

### Phase 6：進階功能（可選）

```
步驟 6.1：PDF 匯出
步驟 6.2：NoteSection 改善備註
步驟 6.3：深色模式
```

---

## 七、Excel 解析器核心邏輯（`lib/excel-parser.ts`）

這是整個專案最複雜的部分，以下是 pseudocode：

```typescript
export function parseQIPExcel(workbook: XLSX.WorkBook): ParseResult {
  const results: IndicatorData[] = [];

  for (const sheetName of workbook.SheetNames) {
    // 1. 從工作表名稱解析年度和院區
    const { year, campus } = parseSheetName(sheetName);
    if (!campus) continue; // 跳過合併工作表

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    // 2. 解析表頭行，確定欄位映射
    const headerRow = rows[0];
    const columnMap = buildColumnMap(headerRow, year);

    // 3. 逐行解析（兩行一組：數值行 + 分子分母行）
    let currentCategory = '';
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];

      if (row[0]) currentCategory = String(row[0]).trim();

      const no = row[1];
      if (typeof no !== 'number' || no !== Math.floor(no) || no <= 0) continue;

      // 4. 提取指標基本資料
      const code = String(row[columnMap.codeCol] || '').trim();
      const name = String(row[columnMap.nameCol] || '').trim();

      // 5. 提取下一行的分子/分母（★ v1.1 新增）
      const fractionRow = (i + 1 < rows.length) ? rows[i + 1] : [];

      // 6. 提取月份數值 + 分子分母
      const monthlyValues = columnMap.months.map((col, idx) => {
        const value = cleanValue(row[col], code);
        const fraction = parseFraction(fractionRow[col]);
        return {
          year,
          month: idx + 1,
          value,
          numerator: fraction?.numerator ?? null,
          denominator: fraction?.denominator ?? null
        };
      });

      // 7. 提取年度摘要和標竿
      const yearAvg = cleanValue(row[columnMap.yearAvg], code);
      const benchmarks = extractBenchmarks(row, columnMap, year, campus);

      // 8. 合併到結果
      mergeIndicatorData(results, {
        code, name, category: currentCategory, campus,
        year, monthlyValues, yearAvg, benchmarks
      });
    }
  }

  return { indicators: results, errors: [] };
}

// ★ v1.1 新增：解析分子/分母
function parseFraction(raw: any): { numerator: number; denominator: number } | null {
  if (!raw) return null;
  const str = String(raw).trim();
  // 格式: "(24/1130)" 或 "24/1130"
  const match = str.match(/\(?(\d+)\/(\d+)\)?/);
  if (!match) return null;
  return { numerator: parseInt(match[1]), denominator: parseInt(match[2]) };
}

// 110 年特殊格式：值與分數合併在同一格
function parseComboCell(raw: any): {
  value: number | null;
  numerator: number | null;
  denominator: number | null;
} {
  if (!raw) return { value: null, numerator: null, denominator: null };
  const str = String(raw).trim();
  // 格式: "3.33%\n(16/480)" 或 "0%\n(0/40)"
  const match = str.match(/([\d.]+)%?\s*\n?\((\d+)\/(\d+)\)/);
  if (!match) return { value: cleanValue(raw, ''), numerator: null, denominator: null };
  return {
    value: parseFloat(match[1]),
    numerator: parseInt(match[2]),
    denominator: parseInt(match[3])
  };
}

function parseSheetName(name: string): { year: number; campus: Campus | null } {
  const yearMatch = name.match(/(\d{3})年/);
  const year = yearMatch ? parseInt(yearMatch[1]) : 0;
  const campus = name.includes('竹北') && !name.includes('竹東') ? '竹北'
               : name.includes('竹東') && !name.includes('竹北') ? '竹東'
               : null;
  return { year, campus };
}

function cleanValue(raw: any, indicatorCode: string): number | null {
  if (raw === '' || raw === null || raw === undefined) return null;
  const str = String(raw).trim();
  if (['NR', 'NP', '-', ''].includes(str)) return null;
  if (str.match(/^\(?\d+\/\d+\)?$/)) return null; // 純分子/分母字串

  let cleaned = str.replace(/‰/g, '').replace(/%/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;

  return num;
}
```

---

## 八、測試要點

### 8.1 數據解析驗證

使用原始 Excel 中的已知數據進行交叉驗證：

```
HA01-01 竹北 114年1月:
  value = 2.12, numerator = 24, denominator = 1130
  驗算: 24/1130 = 0.02124 → 2.12%（一致 ✓）

HA02-02 竹北 114年12月:
  value = 6.33, numerator = 5, denominator = 79
  驗算: 5/79 = 0.06329 → 6.33%（一致 ✓）

HA02-11 竹北 114年全年:
  所有月份 value = 0, numerator = 0
  管制圖應顯示零線（合法的零值）

HA01-03 季指標:
  只有 1/4/7/10 月有值，其餘為 null
  管制圖只繪製有值的點

HA02-13 竹北 114年1月:
  value = 2.83 (‰), numerator = 1, denominator = 353
  驗算: 1/353 × 1000 = 2.833‰（一致 ✓）
```

### 8.2 管制圖驗證（v1.1 新增）

```
HA01-01 竹北（P Chart）:
  p̄ = Σ死亡數 / Σ住院人次 = 276/13959 = 0.01977
  114年1月 UCL = 0.01977 + 3×√(0.01977×0.98023/1130) = 0.03228
  確認管制界限是鋸齒狀（因每月住院人次不同）

HA02-01 竹北（I-MR，因稀有事件）:
  確認系統判斷 p̄×n < 5 → 自動退回 I-MR
  ICU 轉出每月約 50-70 人，重返率約 1% → p̄×n ≈ 0.5 < 5

HA07-01（U Chart）:
  ū = Σ感染件數 / Σ住院人日
  確認管制界限隨每月人日數變化
```

### 8.2 邊界情況

- 115 年只有 1 月數據（其餘月份為 null）→ 趨勢應顯示 N/A 或 flat
- 竹東無產科照護指標 → 該面向區段應隱藏
- 標竿值為 NR → 狀態為 neutral
- 值為 0 的合法情況（如 0‰ 感染率）→ 不要視為 null

### 8.3 效能目標

- Excel 解析 < 3 秒
- 首頁載入（含所有卡片）< 1 秒
- 圖表互動流暢（60fps）

---

## 九、附錄

### 9.1 名詞對照

| 中文 | 英文 | 說明 |
|---|---|---|
| 持續性監測指標 | QIP (Quality Indicator Program) | 醫院評鑑的核心指標體系 |
| 面向 | Category / Dimension | 指標分類（9 大面向） |
| 標竿 | Benchmark | 全國同層級醫院的平均值 |
| 管制圖 | Control Chart | 統計製程管制工具 |
| 評鑑 | Accreditation | 醫院品質認證 |
| 品管中心 | Quality Management Center | 醫院品質管理部門 |

### 9.2 設計決策記錄

| 決策 | 選擇 | 理由 |
|---|---|---|
| 純前端 vs 有後端 | 純前端 | 品管中心人力有限，不需維運伺服器 |
| 資料儲存 | React 狀態（記憶體） | 避免 localStorage 限制；資料每次由 Excel 載入 |
| 圖表庫 | Recharts | React 生態最成熟，支援響應式 |
| 年份格式 | 民國年 | 醫院內部全用民國年，無需轉換 |
| 標竿比較基準 | 區域醫院（竹北）/ 地區醫院（竹東） | 配合醫院評鑑層級 |
| 狀態燈號級數 | 六級（v1.1） | 區分「達標邊緣」和「明顯優良」，提供更細膩的判讀 |
| 管制圖策略 | 智慧選型（v1.1） | 有分子分母就用正確圖型（P/U），否則退回 I-MR |
| TCPI 標竿 | 獨立匯入（v1.1） | TCPI 報表格式與 QIP 不同，需專屬解析器 |

### 9.3 原始檔案清單

```
1. 生醫115年醫院評鑑持續性監測指標-臨床指標呈核0226.xls
   → QIP 核心數據（110-115 年，17 張工作表）

2. 2024-2025TCPI指標年值報表-綜合(公告版).xlsx（待匯入）
   → TCPI 標竿值（醫學中心/區域醫院/地區醫院同儕平均）
   → 由使用者透過「標竿管理」功能上傳
```
