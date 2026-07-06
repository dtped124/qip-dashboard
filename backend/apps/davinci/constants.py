"""
達文西手術品質指標 — 常數定義

與 QIP 模組完全獨立（開發計畫 0.1/0.3：不共用 QIP 的別名表、指標定義、SPC 模組）。
決策定案（2026-07-04）：
- 指標代碼 DV01–DV07，單一面向「達文西手術品質」，七項皆越低越好
- 出血量 Minimum → 0、<50ml → 50（皆計入平均與分母，匯入報告標近似）
- 連續型月聚合：平均為主 + 中位數並列
- Y/N 旗標與內容欄衝突：內容欄有合法值 → 視為 Y（寧誤報不漏報）
- P Chart 補畫門檻：當月人次 >= 20（可設定）
"""

# ── 七項指標定義 ──
# kind: rate（比率型，P/I-MR 雙層）/ continuous（連續型，I-MR）
# case_field: DavinciCase 上對應的欄位名
DAVINCI_INDICATORS: dict[str, dict] = {
    "DV01": {
        "name": "術中轉換手術比率",
        "kind": "rate",
        "unit": "percent",
        "case_field": "conversion",
    },
    "DV02": {
        "name": "手術時間 skin to skin",
        "kind": "continuous",
        "unit": "min",
        "case_field": "op_time_min",
    },
    "DV03": {
        "name": "術中出血量",
        "kind": "continuous",
        "unit": "ml",
        "case_field": "blood_ml",
    },
    "DV04": {
        "name": "術中或術後14天內不良事件率",
        "kind": "rate",
        "unit": "percent",
        "case_field": "adverse_14d",
    },
    "DV05": {
        "name": "術中或術後30天嚴重併發症率",
        "kind": "rate",
        "unit": "percent",
        "case_field": "severe_comp_30d",
    },
    "DV06": {
        "name": "術後14天內感染率",
        "kind": "rate",
        "unit": "percent",
        "case_field": "infection_14d",
    },
    "DV07": {
        "name": "術後14天內再次手術率",
        "kind": "rate",
        "unit": "percent",
        "case_field": "reoperation_14d",
    },
}

DAVINCI_CATEGORY = "達文西手術品質"  # 單一面向（定案 #4）

# ── 事件代碼表（來源：健保申報系統畫面） ──

ADVERSE_EVENT_CODES: dict[str, str] = {
    "1": "心肌梗塞",
    "2": "冠狀動脈阻塞",
    "3": "心臟驟停",
    "4": "暫時性腦缺血發作",
    "5": "腦中風（含缺血性、出血性或原因不明）",
    "6": "進入點出血或血腫",
    "7": "非手術部位出血",
    "8": "新的洗腎需求",
    "9": "非計畫性的其他手術或介入治療",
    "10": "其他",
}

# Clavien-Dindo 分級
SEVERE_COMP_CODES: dict[str, str] = {
    "1": "Grade III-a（非全身麻醉下介入處置）",
    "2": "Grade III-b（全身麻醉下介入處置）",
    "3": "Grade IV-a（單一器官功能障礙，含洗腎）",
    "4": "Grade IV-b（多重器官功能障礙）",
    "5": "Grade V（病人死亡）",
    "6": "Suffix 'd'（出院時併發症未癒，需後續追蹤）",
}

# ── 院區別名（獨立於 QIP 別名表；院區代碼比對前先去前導 0） ──

CAMPUS_ALIASES: dict[str, str] = {
    "生醫醫院": "竹北",
    "433050018": "竹北",
    "新竹醫院": "新竹",
    "412040012": "新竹",
}

DAVINCI_CAMPUSES = ["竹北", "新竹"]  # 竹東無達文西（前端反白停用）

# ── SPC 參數 ──

P_CHART_MIN_N = 20  # 當月人次達門檻才補畫 P Chart（Phase 5 移入可設定表）

# ── 匯入欄位表頭對照 ──
# key = 內部欄位名，value = 可接受的表頭名稱清單（依序嘗試完全比對）
# 已知變體：生醫 11504「醫令序號」/ 11505「序號」；新竹表頭在第 2 列
HEADER_ALIASES: dict[str, list[str]] = {
    "campus_name": ["院區名稱"],
    "campus_code": ["院區代碼"],
    "period": ["費用年月"],
    "account": ["帳號"],
    "chart_no": ["病歷號"],
    "patient_name": ["病患姓名"],
    "davinci_type": ["達文西類型"],
    "order_code": ["醫令碼"],
    "order_name": ["醫令中文名稱"],
    "admission_date": ["入院日"],
    "discharge_date": ["出院日"],
    "op_date": ["執行起日"],
    "dept_code": ["科別"],
    "dept_name": ["科別名稱"],
    "surgeon": ["執行醫師姓名"],
    "adverse_flag": ["術中或術後14天內是否發生不良事件"],
    "adverse_content": ["不良事件(可複選，請以|分隔)", "不良事件"],
    "severe_flag": ["術中或術後30天發生嚴重併發症"],
    "severe_content": ["嚴重併發症"],
    "infection_flag": ["術後感染"],
    "blood_ml": ["出血量"],
    "conversion_flag": ["術中轉換手術方式(如轉開腹手術)", "術中轉換手術方式"],
    "conversion_reason": ["術中轉換手術方式之原因(如轉開腹手術)", "術中轉換手術方式之原因"],
    "reoperation_flag": ["再次手術"],
    "op_time": ["手術時間"],
    "brand": ["機械手臂輔助系統廠牌別"],
}

# 表頭定位用：一列同時含這兩個字串才視為表頭列
HEADER_DETECT_KEYS = ("院區名稱", "帳號")
