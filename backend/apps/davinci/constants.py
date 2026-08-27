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

# ── 醫令碼分類表（機械手臂輔助手術認證術式） ──
# 來源：健保署「機械手臂輔助手術同意認證學會名單暨器官系統認證術式醫令範圍列表」
# （114/7/18 更新），歸類定案 2026-08-27：
# - 80025B 同時列於婦科(EI)/泌尿科(EF)認證範圍 → 歸婦科
# - priority = 分類表件數；個案無科別且多醫令跨器官系統時，取 priority 最大者
# 用途：竹北 VPN 申報資料無科別/術式名稱 → 顯示層推導（不回寫資料庫）
ORDER_CODE_REGISTRY: dict[str, dict] = {
    # 婦科
    "80425C": {"name": "腹腔鏡子宮肌瘤切除術", "organ": "婦科", "priority": 46},
    "80430B": {"name": "腹腔鏡次全子宮切除術", "organ": "婦科", "priority": 45},
    "80025B": {"name": "腹腔鏡陰道懸吊術", "organ": "婦科", "priority": 26},
    "80424B": {"name": "婦癌分期手術", "organ": "婦科", "priority": 12},
    "80416B": {"name": "腹腔鏡全子宮切除術", "organ": "婦科", "priority": 6},
    "80031C": {"name": "腹腔鏡骨盆腔子宮內膜異位症電燒及切除－重度", "organ": "婦科", "priority": 2},
    # 泌尿科
    "79417B": {"name": "腹腔鏡根除性攝護腺切除術併雙側骨盆腔淋巴切除術", "organ": "泌尿科", "priority": 77},
    "76031B": {"name": "腹腔鏡部分腎臟切除術", "organ": "泌尿科", "priority": 29},
    "76037B": {"name": "腹腔鏡根治性腎切除術", "organ": "泌尿科", "priority": 8},
    "76030B": {"name": "腹腔鏡腎臟輸尿管切除術", "organ": "泌尿科", "priority": 5},
    "78051B": {"name": "腹腔鏡膀胱全切除術及骨盆腔淋巴切除術併雙側輸尿管迴腸經皮分流術", "organ": "泌尿科", "priority": 1},
    # 大腸直腸外科
    "74221B": {"name": "腹腔鏡低前位直腸切除術", "organ": "大腸直腸外科", "priority": 73},
    "73045B": {"name": "腹腔鏡右側大腸切除術加吻合術", "organ": "大腸直腸外科", "priority": 16},
    "74224B": {"name": "腹腔鏡腹部會陰聯合切除術", "organ": "大腸直腸外科", "priority": 3},
    "73057B": {"name": "腹腔鏡左半結腸切除術", "organ": "大腸直腸外科", "priority": 2},
    "73048B": {"name": "腹腔鏡乙狀結腸切除術加吻合術－惡性", "organ": "大腸直腸外科", "priority": 1},
    # 胸腔／心臟外科
    "67050B": {"name": "胸腔鏡肺葉切除術", "organ": "胸腔／心臟外科", "priority": 33},
    "67053B": {"name": "胸腔鏡肺分葉切除術", "organ": "胸腔／心臟外科", "priority": 16},
    "71224B": {"name": "胸（腹）腔鏡食道切除術", "organ": "胸腔／心臟外科", "priority": 8},
    "70416B": {"name": "胸腔鏡縱膈腔腫瘤切除術（＜5cm）", "organ": "胸腔／心臟外科", "priority": 8},
    "70417B": {"name": "胸腔鏡縱膈腔腫瘤切除術（≧5cm）", "organ": "胸腔／心臟外科", "priority": 7},
    "71227B": {"name": "胸（腹）腔鏡食道胃管重建術", "organ": "胸腔／心臟外科", "priority": 2},
    # 消化外科
    "75215B": {"name": "腹腔鏡膽囊切除術", "organ": "消化外科", "priority": 3},
    "75619C": {"name": "腹腔鏡鼠蹊疝氣修補術－無腸切除", "organ": "消化外科", "priority": 3},
    "72059B": {"name": "腹腔鏡次全胃切除術併淋巴清除及腸胃重建", "organ": "消化外科", "priority": 1},
}


def lookup_order_code(code: str) -> dict | None:
    """查分類表：先精確比對，再取前 6 碼（院內碼常帶尾綴，如 74221B0G）。"""
    if not code:
        return None
    return ORDER_CODE_REGISTRY.get(code) or ORDER_CODE_REGISTRY.get(code[:6])


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
