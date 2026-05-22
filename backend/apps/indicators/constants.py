"""
QIP 指標常數定義
包含所有預設指標元資料、類別色彩、狀態設定、TCPI 代碼對應
"""

# Category colors for dashboard display
CATEGORY_COLORS = {
    "整體照護": "#3B82F6",
    "加護照護": "#EF4444",
    "手術照護": "#F97316",
    "產科照護": "#EC4899",
    "急診照護": "#8B5CF6",
    "重點照護": "#06B6D4",
    "感染管制": "#10B981",
    "用藥安全": "#F59E0B",
    "呼吸照護": "#6366F1",
    "經營管理": "#6B7280",
}

CATEGORY_ORDER = [
    "整體照護", "加護照護", "手術照護", "產科照護",
    "急診照護", "感染管制", "重點照護", "用藥安全",
    "呼吸照護", "經營管理",
]

STATUS_CONFIG = {
    "excellent": {"text": "卓越", "color": "#2563EB", "bg": "#EFF6FF"},
    "good":      {"text": "良好", "color": "#16A34A", "bg": "#F0FDF4"},
    "watch":     {"text": "留意", "color": "#CA8A04", "bg": "#FEFCE8"},
    "warning":   {"text": "注意", "color": "#EA580C", "bg": "#FFF7ED"},
    "alert":     {"text": "警示", "color": "#DC2626", "bg": "#FEF2F2"},
    "neutral":   {"text": "監測", "color": "#9CA3AF", "bg": "#F9FAFB"},
}

ALL_CAMPUSES = ["竹北", "竹東", "新竹"]
ZHUBEI_HSINCHU = ["竹北", "新竹"]
ZHUDONG_HSINCHU = ["竹東", "新竹"]
HSINCHU_ONLY = ["新竹"]

# Complete indicator metadata - all 55 indicators
# Each entry: {name, category, unit, is_quarterly, direction, campuses, aliases, data_nature}
INDICATOR_META: dict[str, dict] = {
    # 整體照護 — binomial_rate
    "HA01-01": {"name": "住院死亡率(含病危自動出院)", "category": "整體照護", "unit": "percent", "is_quarterly": False, "direction": "lower", "campuses": ALL_CAMPUSES, "aliases": ["住院死亡千分率"], "data_nature": "binomial_rate"},
    "HA01-02": {"name": "出院14天內因相同或相關病情非計畫性再住院率", "category": "整體照護", "unit": "percent", "is_quarterly": False, "direction": "lower", "campuses": ALL_CAMPUSES, "aliases": ["非計畫再住院率", "14天再住院"], "data_nature": "binomial_rate"},
    "HA01-03": {"name": "急性病床住院案件住院日數超過30日比率", "category": "整體照護", "unit": "percent", "is_quarterly": False, "direction": "lower", "campuses": ALL_CAMPUSES, "aliases": ["住院超過30日", "住院日數超過三十日", "住院日數超過30日", "住院超過30天"], "data_nature": "binomial_rate"},

    # 加護照護 — percent: binomial_rate, permille: poisson_rate
    "HA02-01": {"name": "48小時(含)內加護病房重返率", "category": "加護照護", "unit": "percent", "is_quarterly": False, "direction": "lower", "campuses": ALL_CAMPUSES, "aliases": ["ICU重返率", "加護病房重返"], "data_nature": "binomial_rate"},
    "HA02-02": {"name": "加護病房死亡率(含病危自動出院)", "category": "加護照護", "unit": "percent", "is_quarterly": False, "direction": "lower", "campuses": ALL_CAMPUSES, "aliases": ["ICU死亡率"], "data_nature": "binomial_rate"},
    "HA02-11": {"name": "加護病房呼吸器相關肺炎(‰)", "category": "加護照護", "unit": "permille", "is_quarterly": False, "direction": "lower", "campuses": ALL_CAMPUSES, "aliases": ["VAP", "呼吸器相關肺炎"], "data_nature": "poisson_rate"},
    "HA02-12": {"name": "加護病房留置導尿管相關尿路感染(‰)", "category": "加護照護", "unit": "permille", "is_quarterly": False, "direction": "lower", "campuses": ALL_CAMPUSES, "aliases": ["CAUTI", "導尿管感染"], "data_nature": "poisson_rate"},
    "HA02-13": {"name": "加護病房中心導管相關血流感染(‰)", "category": "加護照護", "unit": "permille", "is_quarterly": False, "direction": "lower", "campuses": ALL_CAMPUSES, "aliases": ["CLABSI", "中心導管感染"], "data_nature": "poisson_rate"},

    # 手術照護 — binomial_rate
    "HA03-01": {"name": "手術後48小時內死亡率(含病危自動出院)", "category": "手術照護", "unit": "percent", "is_quarterly": False, "direction": "lower", "campuses": ALL_CAMPUSES, "aliases": ["手術死亡率"], "data_nature": "binomial_rate"},
    "HA03-02": {"name": "所有手術病人住院期間非計畫相關重返手術室", "category": "手術照護", "unit": "percent", "is_quarterly": False, "direction": "lower", "campuses": ALL_CAMPUSES, "aliases": ["非計畫重返手術室", "手術病人住院期間非計畫相關重返手術室"], "data_nature": "binomial_rate"},
    "HA03-03": {"name": "所有住院病人手術部位感染", "category": "手術照護", "unit": "percent", "is_quarterly": False, "direction": "lower", "campuses": ALL_CAMPUSES, "aliases": ["手術部位感染率", "SSI"], "data_nature": "binomial_rate"},
    "HA03-04": {"name": "預防性抗生素在手術劃刀前1小時給予比率", "category": "手術照護", "unit": "percent", "is_quarterly": False, "direction": "higher", "campuses": ALL_CAMPUSES, "aliases": ["預防性抗生素給予率"], "data_nature": "binomial_rate"},

    # 產科照護 — binomial_rate
    "HA04-01": {"name": "總剖腹產率", "category": "產科照護", "unit": "percent", "is_quarterly": False, "direction": "monitor", "campuses": ZHUBEI_HSINCHU, "aliases": [], "data_nature": "binomial_rate"},
    "HA04-02": {"name": "初次剖腹產率", "category": "產科照護", "unit": "percent", "is_quarterly": False, "direction": "monitor", "campuses": ZHUBEI_HSINCHU, "aliases": [], "data_nature": "binomial_rate"},

    # 急診照護 — binomial_rate
    "HA05-01": {"name": "急診轉住院比率", "category": "急診照護", "unit": "percent", "is_quarterly": False, "direction": "monitor", "campuses": ALL_CAMPUSES, "aliases": [], "data_nature": "binomial_rate"},
    "HA05-02": {"name": "急診會診超過30分鐘比率", "category": "急診照護", "unit": "percent", "is_quarterly": False, "direction": "lower", "campuses": ALL_CAMPUSES, "aliases": [], "data_nature": "binomial_rate"},
    "HA05-03": {"name": "緊急重大外傷手術於30分鐘內進入開刀房比率", "category": "急診照護", "unit": "percent", "is_quarterly": False, "direction": "higher", "campuses": ZHUBEI_HSINCHU, "aliases": [], "data_nature": "binomial_rate"},

    # 感染管制 — poisson_rate
    "HA07-01": {"name": "醫療照護相關感染(‰)", "category": "感染管制", "unit": "permille", "is_quarterly": False, "direction": "lower", "campuses": ALL_CAMPUSES, "aliases": ["醫療照護相關感染密度"], "data_nature": "poisson_rate"},

    # 重點照護 — mixed
    "HA06-01": {"name": "全院腹膜透析病人比率", "category": "重點照護", "unit": "percent", "is_quarterly": False, "direction": "higher", "campuses": ALL_CAMPUSES, "aliases": [], "data_nature": "binomial_rate"},
    "HA06-11": {"name": "急性心肌梗塞-STEMI到急診90分鐘內施予緊急PCI比率", "category": "重點照護", "unit": "percent", "is_quarterly": False, "direction": "higher", "campuses": ZHUBEI_HSINCHU, "aliases": ["STEMI PCI"], "data_nature": "binomial_rate"},
    "HA06-13": {"name": "急性心肌梗塞住院中死亡率(含病危自動出院)", "category": "重點照護", "unit": "percent", "is_quarterly": False, "direction": "lower", "campuses": ZHUBEI_HSINCHU, "aliases": ["AMI死亡率"], "data_nature": "binomial_rate"},
    "HA06-32": {"name": "急性心肌梗塞出院時給予乙型阻斷劑比率", "category": "重點照護", "unit": "percent", "is_quarterly": False, "direction": "higher", "campuses": ZHUBEI_HSINCHU, "aliases": [], "data_nature": "binomial_rate"},
    "HA06-21": {"name": "急性缺血性中風接受IV-tPA治療比率", "category": "重點照護", "unit": "percent", "is_quarterly": False, "direction": "higher", "campuses": ZHUBEI_HSINCHU, "aliases": ["tPA治療比率"], "data_nature": "binomial_rate"},
    "HA06-23": {"name": "急性缺血性中風抵達急診60分鐘內接受IV-tPA治療比率", "category": "重點照護", "unit": "percent", "is_quarterly": False, "direction": "higher", "campuses": ZHUBEI_HSINCHU, "aliases": [], "data_nature": "binomial_rate"},
    "HA06-24": {"name": "急性缺血性腦中風接受IV-tPA治療發生症狀性腦出血比率", "category": "重點照護", "unit": "percent", "is_quarterly": False, "direction": "lower", "campuses": ZHUBEI_HSINCHU, "aliases": [], "data_nature": "binomial_rate"},
    "HA06-25": {"name": "急性缺血性中風發作2小時內抵達急診且3小時內施打IV-tPA", "category": "重點照護", "unit": "percent", "is_quarterly": False, "direction": "higher", "campuses": ZHUBEI_HSINCHU, "aliases": [], "data_nature": "binomial_rate"},
    "HA06-31": {"name": "接受安寧共同照護個案數", "category": "重點照護", "unit": "count", "is_quarterly": False, "direction": "higher", "campuses": ALL_CAMPUSES, "aliases": [], "data_nature": "continuous"},

    # 用藥安全 — continuous
    "HA08-01": {"name": "藥物不良反應通報件數", "category": "用藥安全", "unit": "count", "is_quarterly": False, "direction": "higher", "campuses": ALL_CAMPUSES, "aliases": [], "data_nature": "continuous"},

    # 呼吸照護 — mixed
    "HA09-01": {"name": "慢性呼吸照護病房中心導管相關血流感染(‰)", "category": "呼吸照護", "unit": "permille", "is_quarterly": False, "direction": "lower", "campuses": ZHUDONG_HSINCHU, "aliases": ["亞急性呼吸照護病房中心導管相關血流感染"], "data_nature": "poisson_rate"},
    "HA09-02": {"name": "慢性呼吸照護病房呼吸器相關肺炎(‰)", "category": "呼吸照護", "unit": "permille", "is_quarterly": False, "direction": "lower", "campuses": ZHUDONG_HSINCHU, "aliases": ["亞急性呼吸照護病房呼吸器相關肺炎"], "data_nature": "poisson_rate"},
    "HA09-03": {"name": "慢性呼吸照護病房留置導尿管相關尿路感染(‰)", "category": "呼吸照護", "unit": "permille", "is_quarterly": False, "direction": "lower", "campuses": ZHUDONG_HSINCHU, "aliases": ["慢性呼吸照護病房留置導尿管尿管尿路感染", "亞急性呼吸照護病房留置導尿管相關尿路感染"], "data_nature": "poisson_rate"},
    "HA09-04": {"name": "慢性呼吸照護病房呼吸器脫離成功率", "category": "呼吸照護", "unit": "percent", "is_quarterly": False, "direction": "higher", "campuses": ZHUDONG_HSINCHU, "aliases": ["呼吸器脫離率", "亞急性呼吸照護病房呼吸器脫離成功率"], "data_nature": "binomial_rate"},
    "HA09-05": {"name": "亞急性呼吸照護病房氣切比率", "category": "呼吸照護", "unit": "percent", "is_quarterly": False, "direction": "monitor", "campuses": HSINCHU_ONLY, "aliases": [], "data_nature": "binomial_rate"},

    # 經營管理 — mixed
    "HA10-01": {"name": "異常事件通報件數", "category": "經營管理", "unit": "count", "is_quarterly": False, "direction": "higher", "campuses": ALL_CAMPUSES, "aliases": ["異常事件通報數"], "data_nature": "continuous"},
    "HA10-02": {"name": "醫院員工遭受暴力事件數", "category": "經營管理", "unit": "count", "is_quarterly": False, "direction": "lower", "campuses": ALL_CAMPUSES, "aliases": [], "data_nature": "continuous"},
    "HA10-03": {"name": "醫院員工發生職業災害件數", "category": "經營管理", "unit": "count", "is_quarterly": False, "direction": "lower", "campuses": ALL_CAMPUSES, "aliases": [], "data_nature": "continuous"},
    "HA10-04": {"name": "急性一般病床開放率", "category": "經營管理", "unit": "percent", "is_quarterly": False, "direction": "monitor", "campuses": ALL_CAMPUSES, "aliases": ["病床開放率"], "data_nature": "binomial_rate"},
    "HA10-09": {"name": "急性一般病床全日平均護病比", "category": "經營管理", "unit": "ratio", "is_quarterly": False, "direction": "lower", "campuses": ALL_CAMPUSES, "aliases": ["護病比"], "data_nature": "continuous"},
}

# 不計算管制圖的指標清單
# 依「QIP 管制圖判定」(Excel: 管制圖判定.xlsx, KPI 工作表) 之 SPC 欄位：
# 文件未指定 SPC 圖型者（純計數/比率型，無合適的傳統管制圖）。
# 注意：HA10-04 (急性一般病床開放率) 文件建議 P-chart，故不在此清單。
#       HA06-31 (安寧個案數)、HA08-01 (藥物不良反應通報) 文件未指定但
#       目前以 I-MR 處理，暫不加入跳過清單。
SKIP_SPC_INDICATORS: set[str] = {
    "HA10-01",  # 異常事件通報件數
    "HA10-02",  # 醫院員工遭受暴力事件數
    "HA10-03",  # 醫院員工發生職業災害件數
    "HA10-09",  # 急性一般病床全日平均護病比
}


# 110年無指標代碼，需透過名稱比對
NAME_TO_CODE: dict[str, str] = {
    "住院死亡率(含病危自動出院)": "HA01-01",
    "出院14天內因相同或相關病情非計畫性再住院率": "HA01-02",
    "急性病床住院案件住院日數超過30日比率": "HA01-03",
    "48小時(含)內加護病房重返率": "HA02-01",
    "加護病房死亡率(含病危自動出院)": "HA02-02",
    "加護病房呼吸器相關肺炎": "HA02-11",
    "加護病房留置導尿管相關尿路感染": "HA02-12",
    "加護病房中心導管相關血流感染": "HA02-13",
    "手術後48小時內死亡率(含病危自動出院)": "HA03-01",
    "所有手術病人住院期間非計畫相關重返手術室": "HA03-02",
    "所有住院病人手術部位感染": "HA03-03",
    "預防性抗生素在手術劃刀前1小時給予比率": "HA03-04",
    "總剖腹產率": "HA04-01",
    "初次剖腹產率": "HA04-02",
    "急診轉住院比率": "HA05-01",
    "急診會診超過30分鐘比率": "HA05-02",
    "緊急重大外傷手術於30分鐘內進入開刀房比率": "HA05-03",
    "醫療照護相關感染": "HA07-01",
    "全院腹膜透析病人比率": "HA06-01",
    "急性心肌梗塞-STEMI到急診90分鐘內施予緊急經": "HA06-11",
    "急性心肌梗塞住院中死亡率(含病危自動出院)": "HA06-13",
    "急性心肌梗塞出院時給予乙型阻斷劑比率": "HA06-32",
    "急性缺血性中風接受靜脈血栓溶解劑(IV-tPA)治": "HA06-21",
    "急性缺血性中風抵達急診60分鐘(含)內接受靜脈血栓": "HA06-23",
    "急性缺血性腦中風病人接受靜脈血栓溶解劑(IV-tP": "HA06-24",
    "急性缺血性中風發作2小時（含）內抵達急診，且在發作": "HA06-25",
    "接受安寧共同照護個案數": "HA06-31",
    "藥物不良反應通報件數": "HA08-01",
    "異常事件通報件數": "HA10-01",
    "醫院員工遭受暴力事件數": "HA10-02",
    "醫院員工發生職業災害件數": "HA10-03",
    "急性一般病床開放率": "HA10-04",
    "急性一般病床全日平均護病比": "HA10-09",
    "慢性呼吸照護病房中心導管相關血流感染": "HA09-01",
    "慢性呼吸照護病房呼吸器相關肺炎": "HA09-02",
    "慢性呼吸照護病房留置導尿管相關尿路感染": "HA09-03",
    "慢性呼吸照護病房呼吸器脫離成功率": "HA09-04",
}

# TCPI 代碼 → QIP 指標代碼對應表
TCPI_CODE_TO_QIP: dict[str, str] = {
    "Hosp-Mort-01": "HA01-01",
    "Hosp-UnR-01":  "HA01-02",
    "ICU-UnR-03":   "HA02-01",
    "ICU-Mort-01":  "HA02-02",
    "Sc-UnR-01":    "HA03-02",
    "SC-Infe-18":   "HA03-03",
    "SC-AntiP-01b": "HA03-04",
    "Obs-01":       "HA04-01",
    "Obs-02":       "HA04-02",
    "AMI-07":       "HA06-11",
    "STK-03":       "HA06-21",
    "AMI-15":       "HA06-13",
    "STK-04":       "HA06-23",
    "STK-05":       "HA06-24",
    "STK-02":       "HA06-25",
    "AMI-24":       "HA06-32",
    "RCC-BSI-04":   "HA09-01",
    "RCC-VAP-04":   "HA09-02",
    "RCC-UTI-03":   "HA09-03",
    "RCC-Integ01":  "HA09-04",
    "RCC-Integ04":  "HA09-05",
}

# ────────────────────────────────────────────────────────────────
# 子分類細項定義
# 來源 Excel（如 4月總表）裡，HA08-01 與 HA10-01 在主標題列下方還有
# 4 / 13 個子分類細項列。Parser 會把每個子分類的當月計數寫進
# DataPointSubcategory 表，給「要素清單匯出」使用。
#
# 順序必須與來源 Excel 內子分類列的順序、以及要素清單匯出的 -01..-NN
# 序號完全一致。
# ────────────────────────────────────────────────────────────────
SUBCATEGORY_DEFS: dict[str, list[str]] = {
    "HA08-01": [
        "HA08-01-01",  # 藥品不良反應通報件數
        "HA08-01-02",  # 醫療器材不良反應通報件數
        "HA08-01-03",  # 藥品不良品通報件數
        "HA08-01-04",  # 醫療器材不良品通報件數
    ],
    "HA10-01": [
        "HA10-01-01",  # 藥物事件通報件數
        "HA10-01-02",  # 跌倒事件通報件數
        "HA10-01-03",  # 手術事件通報件數
        "HA10-01-04",  # 輸血事件通報件數
        "HA10-01-05",  # 醫療照護事件通報件數
        "HA10-01-06",  # 公共意外事件通報件數
        "HA10-01-07",  # 治安事件通報件數
        "HA10-01-08",  # 傷害行為事件通報件數
        "HA10-01-09",  # 管路事件通報件數
        "HA10-01-10",  # 院內不預期心跳停止事件通報件數
        "HA10-01-11",  # 麻醉事件通報件數
        "HA10-01-12",  # 檢查/檢驗/病理切片事件通報件數
        "HA10-01-13",  # 其他事件通報件數
    ],
}


# 季指標月份
QUARTERLY_MONTHS = (1, 4, 7, 10)


def month_to_quarter(month: int) -> int:
    """月份 → 季度（1-4）"""
    return (month - 1) // 3 + 1
