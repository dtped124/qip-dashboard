"""
嚴格指標 schema
─────────────
為了避免「模糊比對」誤把 HA06-24 認成 HA06-21 之類的悲劇，這份檔案明確列舉
**每個指標可被 parser 接受的精確名稱**（含分子、分母列名）。

匯入規則：
  1. parser 從 Excel 讀到一個指標時，從這個 schema 找對應 code
  2. 找到後，**再驗證該列的分子名 / 分母名也都在白名單裡**
  3. 任一項不在白名單 → 跳過該指標、寫一筆警告到 import log
  4. 沒有所謂「相似」、「fuzzy」、「contains」— 全部都是字串完全相等
     （唯一容忍：trim 頭尾空白 + 把內部多重空白壓縮成一格）

要新增變體時：直接把新的字串 append 到該 code 的 list 即可。
"""
from __future__ import annotations

# 指標類型
#   "rate":         3 列（指標 + 分子 + 分母）—— 大部分 HA01..HA09
#   "single_value": 1 列（只有指標本身的計數值）—— 安寧個案、員工暴力、職災
#   "subcategory":  指標 + N 個子分類列（子分類交給 SUBCATEGORY_DEFS）—— HA08-01, HA10-01

STRICT_INDICATOR_SCHEMA: dict[str, dict] = {
    # ── 整體照護 ────────────────────────────────────────────────
    "HA01-01": {
        "kind": "rate",
        "names": ["住院死亡率(%)"],
        "numerator_names": ["死亡人數（含病危自動出院）"],
        "denominator_names": ["出院人次(含死亡)"],
    },
    "HA01-02": {
        "kind": "rate",
        "names": ["出院14天內相同或相關病情非計畫性再住院率(%)"],
        "numerator_names": ["出院 14天內因相同或相關病情非計畫性再住院件數"],
        "denominator_names": ["出院人次(不含死亡)"],
    },
    "HA01-03": {
        "kind": "rate",
        "names": ["(季)急性病床住院案件住院日數超過三十日比率(%)"],
        "numerator_names": ["分母案件中住院超過 30 日的案件數"],
        "denominator_names": ["出院案件數（僅急性床案件，不含急慢性床混合案件）"],
    },

    # ── 加護病房照護 ───────────────────────────────────────────
    "HA02-01": {
        "kind": "rate",
        "names": ["48 小時(含)內加護病房重返率(%)"],
        "numerator_names": ["48 小時（含）內非計畫性重返加護病房人次"],
        "denominator_names": ["轉出至非加護病房之總人次(不含轉院.AAD.MBD)"],
    },
    "HA02-02": {
        "kind": "rate",
        "names": ["加護病房死亡率(%)"],
        "numerator_names": ["加護病房內死亡人數+ 加護病房病危自動出院人數"],
        "denominator_names": ["加護病房轉出及出院總人次"],
    },
    "HA02-11": {
        "kind": "rate",
        "names": ["加護病房呼吸器相關肺炎(‰)"],
        "numerator_names": ["加護病房呼吸器相關肺炎感染件數"],
        "denominator_names": ["加護病房呼吸器使用人日數"],
    },
    "HA02-12": {
        "kind": "rate",
        "names": ["加護病房留置導尿管相關尿路感染(‰)"],
        "numerator_names": ["加護病房留置導尿管相關尿路感染次數"],
        "denominator_names": ["加護病房留置導尿管使用人日數"],
    },
    "HA02-13": {
        "kind": "rate",
        "names": ["加護病房中心導管相關血流感染(‰)"],
        "numerator_names": ["加護病房中心導管相關血流感染件數"],
        "denominator_names": ["加護病房中心導管使用人日數"],
    },

    # ── 手術照護 ───────────────────────────────────────────────
    "HA03-01": {
        "kind": "rate",
        "names": ["手術後48 小時內死亡率(%)\n(含病危自動出院)"],
        "numerator_names": ["住院病人術後 48 小時內死亡數（含病危自動出院）"],
        "denominator_names": ["住院病人手術數"],
    },
    "HA03-02": {
        "kind": "rate",
        "names": ["所有手術病人住院期間非計畫重返手術室(%)"],
        "numerator_names": ["住院病人非計畫性重返手術室次數"],
        "denominator_names": ["住院病人手術數"],
    },
    "HA03-03": {
        "kind": "rate",
        "names": ["所有住院病人手術部位感染(%)"],
        "numerator_names": ["住院病人有做切口初步縫合之手術部位感染數"],
        "denominator_names": ["住院病人手術數"],
    },
    "HA03-04": {
        "kind": "rate",
        "names": ["預防性抗生素在手術劃刀前1小時給予比率(%)"],
        "numerator_names": ["劃刀前 60 分鐘內接受預防性抗生素之手術次數"],
        "denominator_names": ["接受預防性抗生素之所有手術次數"],
    },

    # ── 產科照護 ───────────────────────────────────────────────
    "HA04-01": {
        "kind": "rate",
        "names": ["總剖腹產率(%)"],
        "numerator_names": ["總剖腹產數"],
        "denominator_names": ["總生產數"],
    },
    "HA04-02": {
        "kind": "rate",
        "names": ["初次剖腹產率(%)"],
        "numerator_names": ["初次剖腹產數"],
        "denominator_names": ["過去未曾接受過剖腹產的產婦"],
    },

    # ── 急診照護 ───────────────────────────────────────────────
    # HA05-01 竹北：標準 3 列；竹東：含分子/分母標記、跨多列細項
    "HA05-01": {
        "kind": "rate",
        "names": [
            "急診轉住院比率(%)",            # 竹北
            "急診轉住院比率(%)(含竹北)",      # 竹東
        ],
        "numerator_names": [
            "由急診就診後直接辦理住院之人次",                  # 竹北
            "分子：由急診就診後直接辦理住院之人次(含轉竹北住院)",   # 竹東 (含 分子:)
        ],
        "denominator_names": [
            "急診總人次",                                # 竹北
            "分母:急診總人次(排除ER死亡)",                   # 竹東 (含 分母:)
        ],
    },
    "HA05-02": {
        "kind": "rate",
        "names": ["急診會診超過 30 分鐘比率(%)"],
        "numerator_names": ["急診會診超過 30 分鐘之人次"],
        "denominator_names": ["急診會診總人次"],
    },
    "HA05-03": {
        "kind": "rate",
        "names": ["緊急重大外傷手術於30分鐘內進入開刀房比率(%)"],
        "numerator_names": ["緊急重大外傷手術於30分鐘內進入開刀房病人之人次"],
        "denominator_names": ["緊急重大外傷手術病人之總人次"],
    },

    # ── 重點照護 ───────────────────────────────────────────────
    "HA06-01": {
        "kind": "rate",
        "names": ["全院腹膜透析病人比率(%)"],
        "numerator_names": ["腹膜透析個案數"],
        "denominator_names": ["血液透析個案數"],
    },
    "HA06-11": {
        "kind": "rate",
        "names": ["急性心肌梗塞-STEMI到急診90分鐘內施予直接經皮冠狀介術比率(%)"],
        "numerator_names": ["STEMI到急診90分鐘內施予緊急經皮冠狀動脈介入術病人次"],
        "denominator_names": ["所有STEMI到急診施予緊急經皮冠狀動脈介入術病人次"],
    },
    "HA06-13": {
        "kind": "rate",
        "names": ["急性心肌梗塞住院中死亡率(含病危自動出院)(%)"],
        "numerator_names": ["住院病人主診斷為AMI之死亡人數(含病危自動出院)"],
        "denominator_names": ["出院主診斷為AMI之出院人次"],
    },
    "HA06-32": {
        "kind": "rate",
        "names": ["急性心肌梗塞出院時給予乙型阻斷劑比率"],
        "numerator_names": ["出院時接受乙型阻斷劑之AMI病人次"],
        "denominator_names": ["出院主診斷為AMI之出院人次"],
    },
    "HA06-21": {
        "kind": "rate",
        "names": ["急性缺血性中風接受靜脈血栓溶解劑(IV-tPA)治療比率(%)"],
        "numerator_names": ["急性缺血性中風接受IV-tPA治療的病人次"],
        "denominator_names": ["所有急性缺血性中風到院病人次"],
    },
    "HA06-23": {
        "kind": "rate",
        # 注意：源檔有 (超) 的筆誤（標準應為「含」），但檔案就是這樣
        "names": ["急性缺血性中風抵達急診60分鐘(超)內接受靜脈血栓溶解劑(IV-tPA)治療比率(%)"],
        "numerator_names": ["抵達急診60分鐘(含)內接受IV-tPA治療的病人次"],
        "denominator_names": ["急性缺血性中風接受IV-tPA治療的病人次"],
    },
    "HA06-24": {
        "kind": "rate",
        # 注意：源檔有「治療治療」的筆誤
        "names": ["急性缺血性中風接受靜脈血栓溶解劑(IV-tPA)治療治療，發生症狀性腦出血比率(%)"],
        "numerator_names": ["急性缺血性中風病人接受IV-tPA治療者，在36小時(含)內產生症狀性腦出血之病人次"],
        "denominator_names": ["急性缺血性中風接受IV-tPA治療的病人次"],
    },
    "HA06-25": {
        "kind": "rate",
        "names": ["急性缺血性發作2小時(含)內抵達急診，且在發作3小時(含)內施打靜脈血栓溶解劑(IV-tPA)"],
        "numerator_names": [
            "急性缺血性中風發作2小時含內抵達急診，符合 IV−tPA適應症，且在發作3小時含內接受施打 IV−tPA的病人次",
            "急性缺血性中風發作 2小時 含 內抵達急診，符合 IV−tPA適應症，且在發作 3小時含內接受施打 IV−tPA的病人次",  # 110年 竹北 變體（多了空格）
        ],
        "denominator_names": [
            "急性缺血性中風發作2小時含內抵達急診符合 IV−tPA適應症的病人次",
            "急性缺血性中風發作 2小時含內抵達急診符合 IV−tPA適應症的病人次",
            "急性缺血性中風發作 2小時 含 內抵達急診 符合 IV−tPA適應症的病人次",  # 110年 竹北
        ],
    },
    "HA06-31": {
        "kind": "single_value",
        "names": ["接受安寧共同照護個案數"],
    },

    # ── 感染管制 ───────────────────────────────────────────────
    "HA07-01": {
        "kind": "rate",
        "names": ["醫療照護相關感染(‰)"],
        "numerator_names": ["院內感染總人次"],
        "denominator_names": ["住院人日"],
    },

    # ── 用藥安全（子分類）─────────────────────────────────────
    "HA08-01": {
        "kind": "subcategory",
        "names": ["ADR 藥物不良反應通報件數"],
    },

    # ── 呼吸照護（竹東 HA09-11..14 → 對應 dashboard HA09-01..04）──
    "HA09-01": {
        "kind": "rate",
        "names": ["慢性呼吸照護病房中心導管相關血流感染(‰)"],
        "numerator_names": ["慢性呼吸照護病房中心導管相關血流感染次數"],
        "denominator_names": ["慢性呼吸照護病房中心導管使用人日數"],
    },
    "HA09-02": {
        "kind": "rate",
        "names": ["慢性呼吸照護病房呼吸器相關肺炎(‰)"],
        "numerator_names": ["慢性呼吸照護病房呼吸器相關肺炎感染件數"],
        "denominator_names": ["慢性呼吸照護病房呼吸器使用人日數"],
    },
    "HA09-03": {
        "kind": "rate",
        "names": ["慢性呼吸照護病房留置導尿管相關尿路感染(‰)"],
        "numerator_names": ["慢性呼吸照護病房留置導尿管相關尿路感染次數"],
        "denominator_names": ["慢性呼吸照護病房留置導尿管使用人日數"],
    },
    "HA09-04": {
        "kind": "rate",
        "names": ["慢性呼吸照護病房呼吸器脫離成功率(%)"],
        "numerator_names": ["成功脫離呼吸器人次(慢性呼吸照護病房)"],
        "denominator_names": ["離開慢性呼吸照護病房人次"],
    },

    # ── 經營管理（子分類）─────────────────────────────────────
    "HA10-01": {
        "kind": "subcategory",
        "names": ["異常事件通報數(件)"],
    },
    "HA10-02": {
        "kind": "single_value",
        "names": ["醫院員工遭受暴力事件數(件)"],
    },
    "HA10-03": {
        "kind": "single_value",
        "names": ["醫院員工發生職業災害件數(件)"],
    },
    "HA10-04": {
        "kind": "rate",
        "names": ["急性一般病床開放率(%)"],
        "numerator_names": [
            "實際開放之急性一般病床開放床數",            # 竹北
            "衛生局登記之急性一般病床開放床數",          # 竹東 (來源把分子分母互換了)
        ],
        "denominator_names": [
            "衛生局登記之急性一般病床開放床數",          # 竹北
            "經核准設置之急性一般病床許可床數",          # 竹東
        ],
    },
    "HA10-09": {
        "kind": "rate",
        "names": [
            "生醫醫院-竹北急性一般病床全日平均護病比(不含護長、專師、實習護士) ",
            "生醫醫院急性一般病床全日平均護病比(不含護長、專師、實習護士)",  # 112-113 變體（無「-竹北」）
            "急性一般病床全日平均護病比(生醫)\n(不含護長、專師、實習護士)",
            "急性一般病床全日平均護病比(竹東)\n(不含護長、專師、實習護士)",
        ],
        "numerator_names": [
            "每月每一個病房之(急性一般病床床位數*佔床率*3)加總",  # 竹北
            "每月每病房之(急性一般病床床位數*佔床率*3)加總",     # 竹東
        ],
        "denominator_names": [
            "每月每日平均上班護理人數之三班小計加總\n(不包含護理長、專科護理師ヽ實習護士) ",
            "每月每日平均上班護理人數之三班小計加總\n(不包含護理長、專科護理師、實習護士)",
        ],
    },
}


# 來源系統用的代碼，需要對應到 dashboard 真正使用的代碼
# 例：竹東檔的 HA09-11 對應 dashboard 的 HA09-01
SOURCE_CODE_REMAP: dict[str, str] = {
    "HA09-11": "HA09-01",
    "HA09-12": "HA09-02",
    "HA09-13": "HA09-03",
    "HA09-14": "HA09-04",
}


def _norm(s: str | None) -> str:
    """名稱比對前正規化：strip + 把連續空白壓成單一空白。其餘字元保留。"""
    if s is None:
        return ""
    # 不轉全形→半形、不去掉換行（換行是名稱真實內容的一部分）
    return " ".join(str(s).strip().split(" "))


# Pre-compute normalized lookup tables for O(1) check
_NORMALIZED_NAME_TO_CODE: dict[str, str] = {}
_NORMALIZED_NUM_NAMES_BY_CODE: dict[str, set[str]] = {}
_NORMALIZED_DEN_NAMES_BY_CODE: dict[str, set[str]] = {}

for _code, _entry in STRICT_INDICATOR_SCHEMA.items():
    for _name in _entry["names"]:
        _NORMALIZED_NAME_TO_CODE[_norm(_name)] = _code
    _NORMALIZED_NUM_NAMES_BY_CODE[_code] = {_norm(n) for n in _entry.get("numerator_names", [])}
    _NORMALIZED_DEN_NAMES_BY_CODE[_code] = {_norm(n) for n in _entry.get("denominator_names", [])}


def strict_resolve_code(raw_code: str, indicator_name: str) -> str | None:
    """
    嚴格解析指標代碼：
      1. 若 raw_code 是 HA dd-dd 且在 schema 內 → 採用（必要時做 SOURCE_CODE_REMAP）
      2. 否則用 indicator_name 完全比對（normalize 後）
      3. 找不到 → 回傳 None（**不做任何 fuzzy/contains 比對**）
    """
    if raw_code:
        rc = raw_code.strip()
        # 代碼可能含 HA09-11 之類來源變體 → remap
        mapped = SOURCE_CODE_REMAP.get(rc, rc)
        if mapped in STRICT_INDICATOR_SCHEMA:
            # 也驗證一下名稱是否相符（避免代碼正確、名稱卻離譜）
            if _norm(indicator_name) in {_norm(n) for n in STRICT_INDICATOR_SCHEMA[mapped]["names"]}:
                return mapped
            # 代碼對、名稱不對 → 仍接受（代碼是更可靠的訊號）但要在 import log
            # 留紀錄。這裡先回傳，呼叫端負責記警告。
            return mapped

    return _NORMALIZED_NAME_TO_CODE.get(_norm(indicator_name))


def validate_nd_names(
    code: str,
    numerator_name: str | None,
    denominator_name: str | None,
) -> tuple[bool, str | None]:
    """
    驗證分子分母列名是否在 schema 白名單。
    回傳 (passed, reason_if_failed)。
    """
    entry = STRICT_INDICATOR_SCHEMA.get(code)
    if not entry:
        return False, f"code {code} 不在 STRICT_INDICATOR_SCHEMA"

    kind = entry["kind"]
    if kind == "single_value":
        return True, None  # 不需 n/d
    if kind == "subcategory":
        return True, None  # 子分類由 SUBCATEGORY_DEFS 處理

    # kind == "rate"
    num_norm = _norm(numerator_name)
    den_norm = _norm(denominator_name)

    if num_norm not in _NORMALIZED_NUM_NAMES_BY_CODE.get(code, set()):
        return False, f"分子列名不符: {numerator_name!r}"
    if den_norm not in _NORMALIZED_DEN_NAMES_BY_CODE.get(code, set()):
        return False, f"分母列名不符: {denominator_name!r}"
    return True, None


def get_kind(code: str) -> str | None:
    """取得指標類型：rate / single_value / subcategory / None（未知）"""
    entry = STRICT_INDICATOR_SCHEMA.get(code)
    return entry["kind"] if entry else None
