# QIP 監測指標系統遷移計畫書

> **版本：** 1.0
> **建立日期：** 2026-03-22
> **目標：** 將現有 Next.js + IndexedDB 前端應用遷移為符合品管中心技術堆疊規範的 Django + PostgreSQL + Streamlit 架構

---

## 一、現有系統功能分析

### 1.1 資料模型（8 張表）

| 表名 | 說明 | 記錄數量級 |
|------|------|-----------|
| **indicators** | 指標元資料（代碼、名稱、類別、單位、方向、院區、資料性質） | ~55 筆預設 + 自訂 |
| **dataPoints** | 月份資料點（指標×院區×年×月→值/分子/分母） | 數千筆 |
| **yearlySummaries** | 年度彙總（年平均值、區域/地區標竿） | 數百筆 |
| **peerValues** | 同儕值（指標×院區→值） | ~165 筆 |
| **importLogs** | 匯入紀錄（時間、檔名、新增/更新/錯誤數） | 數十筆 |
| **alerts** | 異常偵測結果（機制、規則、嚴重度） | 數百筆 |
| **matchingRules** | 名稱比對記憶（Excel 名稱→指標代碼） | 數十筆 |
| **tcpiBenchmarks** | TCPI 同儕標竿值（醫學中心/區域/地區） | 數百筆 |

### 1.2 業務邏輯模組

#### A. 三重異常偵測引擎（核心功能）

| 機制 | 演算法 | 輸出 |
|------|--------|------|
| **管制圖分析** | I-MR / P Chart / U Chart + Western Electric Rules 1-5 | alert / warning / excellent |
| **月增減偵測** | 連續月份變化率 ≥ 10% | watch / excellent |
| **同儕值比較** | 與 TCPI 標竿偏差 ≥ 10% | watch / excellent |

- **圖表類型自動選擇**：根據 dataNature（continuous/binomial_rate/poisson_rate）+ 稀有事件檢查
  - binomial_rate：p̄×n̄ < 5 → 退回 I-MR
  - poisson_rate：月平均事件數 < 1 → 退回 I-MR
- **變動管制限**：P/U Chart 依各月樣本數計算個別 UCL/LCL
- **Western Electric Rules**：
  - Rule 1：單點超出 ±3σ（alert）
  - Rule 2：單點超出 ±2σ（warning）
  - Rule 3：連續 7 點在 CL 同側（warning）
  - Rule 4：連續 7 點遞增/遞減（warning）
  - Rule 5：連續 3 點中 2 點在 ±2σ 外（warning）

#### B. Excel 解析引擎

| 功能 | 說明 |
|------|------|
| **工作表解析** | 自動偵測年度（民國年）和院區（竹北/竹東/新竹） |
| **欄位結構適配** | 110 年 vs 111-115 年不同欄位配置 |
| **值清洗** | 處理 %/‰ 符號、NR/NP/N/A、分數格式 (n/d) |
| **單位正規化** | 依年度×院區判斷比率格式 vs 顯示格式，自動轉換 |
| **分子/分母提取** | 同儲存格 (110年) 或相鄰列 (111+年) |
| **異常值修正** | 中位數 20 倍偵測 + ÷100 自動修正 |
| **新竹格式** | 獨立解析器（hsinchu-parser） |
| **TCPI 解析** | TCPI 標竿 Excel 專用解析器 |

#### C. 五層名稱比對引擎

| 層級 | 策略 | 信心度 |
|------|------|--------|
| Layer 0 | 記憶規則優先（歷史確認的配對） | exact |
| Layer 1 | NAME_TO_CODE + 標準化完全匹配 | exact |
| Layer 2 | 別名匹配 | alias (0.95) |
| Layer 3 | 包含匹配（前綴/後綴重疊） | contains |
| Layer 4 | 模糊相似度（Levenshtein 40% + Dice 60%） | similar (≥0.6) |
| Layer 5 | 無法識別 | unrecognized |

- 標準化處理：全形→半形、括號移除、贅詞移除、同義字替換

#### D. 趨勢分析

- 最近 6 個有值月份做線性回歸
- 斜率 > 平均值 5% → up；< -5% → down；否則 flat

#### E. 狀態綜合判定

```
優先級：
🔴 Alert    — 管制圖 Rule 1（3σ 超限）
🟠 Warning  — 管制圖 Rule 2-5，或多重不利因素
🟡 Watch    — 僅月增減不利 或 僅同儕比較不利
🟢 Good     — 無任何異常
🔵 Excellent — 多重改善訊號 + 優於同儕
⚪ Neutral  — 資料不足
```

### 1.3 前端功能

| 頁面 | 功能 |
|------|------|
| **儀表板首頁** | 總覽統計 + 三種檢視（卡片/表格/熱力圖）+ 篩選（院區/類別/年度/搜尋） |
| **指標詳情** | 控制圖 + 年度疊合圖 + 年度比較長條圖 + 標竿長條圖 + 月份資料表 |
| **資料匯入** | 檔案拖曳上傳 + 匯入精靈 + 欄位配對審核 + 差異報告 |
| **設定** | 指標管理（CRUD）+ TCPI 標竿設定 |

### 1.4 常數資料

- **55 筆預設指標**：10 個類別，含名稱、別名、單位、方向、院區適用、資料性質
- **3 個院區**：竹北（區域醫院）、竹東（地區醫院）、新竹（醫學中心）
- **TCPI 代碼對應**：20+ 筆 TCPI_CODE_TO_QIP 映射
- **名稱對應**：30+ 筆 NAME_TO_CODE 映射

---

## 二、目標架構

```
qip-dashboard/                    # Django 專案根目錄
├── config/                       # Django 設定
│   ├── __init__.py
│   ├── settings/
│   │   ├── base.py               # 共用設定
│   │   ├── dev.py                # 開發環境
│   │   └── prod.py               # 正式環境
│   ├── urls.py
│   └── wsgi.py
├── apps/
│   ├── indicators/               # 指標管理 App
│   │   ├── models.py             # Indicator, DataPoint, YearlySummary...
│   │   ├── admin.py              # Django Admin 設定
│   │   ├── views.py              # API Views
│   │   ├── serializers.py        # DRF 序列化器
│   │   ├── urls.py
│   │   ├── constants.py          # 指標元資料、類別色彩
│   │   └── tests/
│   ├── imports/                  # Excel 匯入 App
│   │   ├── models.py             # ImportLog, MatchingRule
│   │   ├── admin.py
│   │   ├── services/
│   │   │   ├── excel_parser.py   # Excel 解析引擎
│   │   │   ├── hsinchu_parser.py # 新竹格式解析器
│   │   │   ├── tcpi_parser.py    # TCPI 解析器
│   │   │   ├── data_cleaner.py   # 資料清洗
│   │   │   └── matching.py       # 名稱比對引擎
│   │   ├── views.py
│   │   ├── urls.py
│   │   └── tests/
│   └── analysis/                 # 分析引擎 App
│       ├── services/
│       │   ├── control_chart.py  # 管制圖計算（I-MR/P/U）
│       │   ├── anomaly_detector.py # 三重異常偵測引擎
│       │   ├── monthly_change.py # 月增減偵測
│       │   ├── peer_comparison.py # 同儕值比較
│       │   └── trend_calculator.py # 趨勢分析
│       └── tests/
├── dashboard/                    # Streamlit 儀表板
│   ├── app.py                    # 主頁面
│   ├── pages/
│   │   ├── 1_📊_儀表板.py
│   │   ├── 2_📈_指標詳情.py
│   │   ├── 3_📥_資料匯入.py
│   │   └── 4_⚙️_設定.py
│   └── components/
│       ├── charts.py             # 圖表元件
│       ├── filters.py            # 篩選元件
│       └── status.py             # 狀態顯示元件
├── tests/
│   └── conftest.py
├── Dockerfile
├── docker-compose.yml
├── docker-compose.prod.yml
├── pyproject.toml
├── requirements.txt
├── manage.py
├── .env.example
├── .gitignore
└── README.md
```

---

## 三、遷移步驟

### Phase 1：Django 專案骨架（本次執行）

1. 建立 Django 專案與 App 結構
2. 定義 PostgreSQL 資料模型（models.py）
3. 設定 Django Admin
4. 建立 .env.example 與設定檔
5. 生成 migrations

### Phase 2：業務邏輯遷移（本次執行）

1. 翻譯管制圖演算法（I-MR / P / U Chart）為 Python（使用 numpy）
2. 翻譯 Western Electric Rules 異常偵測
3. 翻譯月增減偵測、同儕比較
4. 翻譯 Excel 解析引擎（使用 openpyxl）
5. 翻譯名稱比對引擎
6. 翻譯資料清洗邏輯
7. 翻譯趨勢計算

### Phase 3：Streamlit 儀表板（本次執行）

1. 建立多頁面 Streamlit 應用
2. 實作儀表板首頁（總覽統計 + 卡片/表格檢視）
3. 實作指標詳情頁（控制圖 + 趨勢圖）
4. 實作資料匯入頁
5. 實作設定頁

### Phase 4：Docker 與 DevOps（本次執行）

1. 撰寫 Dockerfile
2. 撰寫 docker-compose.yml（Django + PostgreSQL + Redis + Streamlit）
3. 撰寫 docker-compose.prod.yml

### Phase 5：測試（本次執行）

1. 管制圖計算單元測試
2. 異常偵測單元測試
3. Excel 解析整合測試

---

## 四、資料模型對照

### 現有 Dexie → 新 PostgreSQL

| Dexie 表 | Django Model | PostgreSQL 表名 | Schema |
|----------|-------------|-----------------|--------|
| indicators | Indicator | qip.indicators | qip |
| dataPoints | DataPoint | qip.data_points | qip |
| yearlySummaries | YearlySummary | qip.yearly_summaries | qip |
| peerValues | PeerValue | qip.peer_values | qip |
| importLogs | ImportLog | qip.import_logs | qip |
| alerts | Alert | qip.alerts | qip |
| matchingRules | MatchingRule | qip.matching_rules | qip |
| tcpiBenchmarks | TCPIBenchmark | qip.tcpi_benchmarks | qip |

### 欄位型別對照

| TypeScript | Python/Django |
|-----------|---------------|
| string | CharField / TextField |
| number | IntegerField / FloatField / DecimalField |
| number \| null | FloatField(null=True) |
| boolean | BooleanField |
| Date | DateTimeField |
| Campus (union type) | CharField(choices=...) |
| Category (union type) | CharField(choices=...) |
| enum | TextChoices |

---

## 五、技術對照

| 功能 | 現有（TypeScript） | 遷移後（Python） |
|------|-------------------|-----------------|
| 管制圖計算 | 手寫演算法 | numpy + 手寫（相同邏輯） |
| Excel 解析 | xlsx (SheetJS) | openpyxl |
| 字串相似度 | 手寫 Levenshtein + Dice | python-Levenshtein + 手寫 Dice |
| 狀態管理 | Zustand (client) | Django ORM (server) |
| 資料庫 | Dexie (IndexedDB) | PostgreSQL 16 |
| 視覺化 | Recharts | Plotly (Streamlit) |
| 檔案上傳 | 瀏覽器 FileReader | Django / Streamlit file_uploader |

---

## 六、風險與注意事項

1. **Excel 解析精度**：需確保 openpyxl 對 .xls 格式的相容性（可能需 xlrd 輔助）
2. **單位轉換邏輯**：最複雜的部分，需逐院區×年度驗證正確性
3. **管制圖精度**：浮點數運算在 Python 和 JS 間可能有微小差異，需容忍 1e-10 誤差
4. **中文處理**：Python 原生支援 Unicode，比 JS 更簡潔
5. **效能**：PostgreSQL 查詢比 IndexedDB 更快，且支援多人同時存取
