"""
達文西 SPC / WER 引擎（davinci 模組自有實作，不呼叫 QIP analysis 模組）

沿用既有規則「思維」（開發計畫 9）：
- WER：Rule1 單點 ±3σ、Rule2 單點 ±2σ、Rule3 連續 7 點同側、
  Rule4 連續 7 點遞增/遞減、Rule5 連續 3 點中 2 點在 2σ 外
- 基線：取最近 24 個有效資料點；< 6 點不畫圖；6–23 全用並示警
- 雙層策略：比率型 I-MR 永遠呈現；P Chart 僅在當月人次 ≥ P_CHART_MIN_N
  時補充該點的變動管制限
- 評級（七項皆越低越好 → 上側為不利）：
  警示 alert：不利方向 3σ 超界、或連續 7 點上升（迄最新點）
  注意 warning：最新點 2σ 訊號（Rule2/Rule5 不利側）
  留意 watch：最新點連續 7 點偏高（Rule3 上側）
  監測 neutral：資料不足或無訊號（良好/卓越需標竿，Phase 5 才啟用）
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

BASELINE_MAX = 24   # 基線最多取最近 24 點
MIN_POINTS = 6      # < 6 點不畫管制圖
D2 = 1.128          # Moving Range subgroup n=2
IMR_FACTOR = 3 / D2  # ≈ 2.66

RATING_ALERT = "alert"      # 警示（紅）
RATING_WARNING = "warning"  # 注意（橘）
RATING_WATCH = "watch"      # 留意（黃）
RATING_NEUTRAL = "neutral"  # 監測（灰）

RATING_LABELS = {
    RATING_ALERT: "警示",
    RATING_WARNING: "注意",
    RATING_WATCH: "留意",
    RATING_NEUTRAL: "監測",
}


@dataclass
class SeriesPoint:
    """一期一點（月或季）。value 為比率(%) 或月平均。"""
    period: int | str
    label: str
    value: float | None
    numerator: int | None = None
    denominator: int | None = None


@dataclass
class WerSignal:
    rule: str          # Rule1..Rule5 / Rule4_up ...
    period: int | str
    label: str
    value: float | None
    side: str          # "high"（不利）/ "low"（有利側）
    severity: str      # alert / warning / watch
    message: str


@dataclass
class PLimit:
    """P Chart 變動管制限（僅人次 ≥ 門檻的期別有值）。"""
    period: int | str
    ucl: float
    lcl: float
    ucl2: float
    lcl2: float
    n: int


@dataclass
class SpcResult:
    has_chart: bool
    insufficient: bool              # < MIN_POINTS
    baseline_warning: bool          # 6–23 點：全用並示警
    baseline_n: int
    cl: float | None = None
    sigma: float | None = None
    ucl: float | None = None
    lcl: float | None = None
    ucl2: float | None = None
    lcl2: float | None = None
    p_cl: float | None = None                       # P chart 中心線（總事件/總人次 %）
    p_limits: list[PLimit] = field(default_factory=list)
    signals: list[WerSignal] = field(default_factory=list)
    rating: str = RATING_NEUTRAL                    # 以最新點判定
    rating_label: str = "監測"


def _imr_params(values: list[float]) -> tuple[float, float] | None:
    """回傳 (CL, sigma)。sigma = MR̄ / d2。"""
    if len(values) < 2:
        return None
    mrs = [abs(values[i] - values[i - 1]) for i in range(1, len(values))]
    mr_bar = sum(mrs) / len(mrs)
    cl = sum(values) / len(values)
    return cl, mr_bar / D2


def _detect_wer(
    points: list[SeriesPoint],
    cl: float,
    sigma: float,
) -> list[WerSignal]:
    """對有效點跑 WER Rule1–5。七項皆越低越好 → high 側為不利。"""
    signals: list[WerSignal] = []
    valid = [p for p in points if p.value is not None]
    if not valid or sigma <= 0:
        return signals

    ucl, lcl = cl + 3 * sigma, cl - 3 * sigma
    ucl2, lcl2 = cl + 2 * sigma, cl - 2 * sigma

    def add(rule: str, p: SeriesPoint, side: str, severity: str, msg: str) -> None:
        signals.append(WerSignal(
            rule=rule, period=p.period, label=p.label,
            value=p.value, side=side, severity=severity, message=msg,
        ))

    # Rule 1 / Rule 2：單點超界
    for p in valid:
        if p.value > ucl:
            add("Rule1", p, "high", "alert", f"{p.label} 超出 UCL（3σ）")
        elif p.value < lcl:
            add("Rule1", p, "low", "watch", f"{p.label} 低於 LCL（3σ，有利側）")
        elif p.value > ucl2:
            add("Rule2", p, "high", "warning", f"{p.label} 超出 2σ 警戒區")
        elif p.value < lcl2:
            add("Rule2", p, "low", "watch", f"{p.label} 低於 2σ（有利側）")

    # Rule 3：連續 7 點同側（>= 7：run 超過 7 點時，之後每一點都持續有訊號，
    # 否則第 8 點起訊號消失、最新點評級會錯誤回落成 neutral）
    run_side: str | None = None
    run_len = 0
    for p in valid:
        side = "high" if p.value > cl else "low" if p.value < cl else None
        if side is not None and side == run_side:
            run_len += 1
        else:
            run_side, run_len = side, (1 if side else 0)
        if run_len >= 7:
            label = "偏高" if run_side == "high" else "偏低（有利側）"
            add("Rule3", p, run_side, "watch", f"連續 {run_len} 點在 CL {label}")

    # Rule 4：連續 7 點遞增 / 遞減（>= 7，理由同上）
    inc_len = dec_len = 1
    for i in range(1, len(valid)):
        prev, cur = valid[i - 1], valid[i]
        inc_len = inc_len + 1 if cur.value > prev.value else 1
        dec_len = dec_len + 1 if cur.value < prev.value else 1
        if inc_len >= 7:
            add("Rule4", cur, "high", "alert", f"連續 {inc_len} 點上升（不利趨勢）")
        if dec_len >= 7:
            add("Rule4", cur, "low", "watch", f"連續 {dec_len} 點下降（有利趨勢）")

    # Rule 5：連續 3 點中 2 點在 2σ 外（同側）
    for i in range(2, len(valid)):
        window = valid[i - 2:i + 1]
        highs = [p for p in window if p.value > ucl2]
        lows = [p for p in window if p.value < lcl2]
        if len(highs) >= 2:
            add("Rule5", window[-1], "high", "warning", "連續 3 點中 2 點超出 2σ")
        elif len(lows) >= 2:
            add("Rule5", window[-1], "low", "watch", "連續 3 點中 2 點低於 2σ（有利側）")

    # 同一 (rule, period) 去重
    seen: set[tuple[str, int | str]] = set()
    out: list[WerSignal] = []
    for s in signals:
        key = (s.rule, s.period)
        if key not in seen:
            seen.add(key)
            out.append(s)
    return out


def _resolve_rating(signals: list[WerSignal], latest_period: int | str | None) -> str:
    """以最新點的訊號判定評級（不利側才升級）。"""
    if latest_period is None:
        return RATING_NEUTRAL
    latest = [s for s in signals if s.period == latest_period and s.side == "high"]
    if any(s.severity == "alert" for s in latest):
        return RATING_ALERT
    if any(s.severity == "warning" for s in latest):
        return RATING_WARNING
    if latest:
        return RATING_WATCH
    return RATING_NEUTRAL


def rating_at(signals: list[WerSignal], period: int | str) -> str:
    """某一期別的評級（供儀表板逐期上色）。"""
    return _resolve_rating(signals, period)


def compute_spc(
    points: list[SeriesPoint],
    kind: str,                    # rate / continuous
    p_chart_min_n: int = 20,
) -> SpcResult:
    """對一條期別序列計算 I-MR 基線 + WER + （比率型）P chart 補充限。

    基線規則：< 6 有效點不畫圖；6–23 全用並示警；≥ 24 取最近 24 點算
    CL/σ（WER 仍對全序列偵測，但界限以基線計）。
    """
    valid = [p for p in points if p.value is not None]
    n_valid = len(valid)

    if n_valid < MIN_POINTS:
        return SpcResult(
            has_chart=False, insufficient=True, baseline_warning=False,
            baseline_n=n_valid,
            rating=RATING_NEUTRAL, rating_label=RATING_LABELS[RATING_NEUTRAL],
        )

    baseline = valid[-BASELINE_MAX:]
    params = _imr_params([p.value for p in baseline])
    if params is None:
        return SpcResult(
            has_chart=False, insufficient=True, baseline_warning=False,
            baseline_n=n_valid,
            rating=RATING_NEUTRAL, rating_label=RATING_LABELS[RATING_NEUTRAL],
        )
    cl, sigma = params

    result = SpcResult(
        has_chart=True,
        insufficient=False,
        baseline_warning=n_valid < BASELINE_MAX,
        baseline_n=len(baseline),
        cl=round(cl, 3),
        sigma=round(sigma, 4),
        ucl=round(cl + 3 * sigma, 3),
        lcl=round(max(cl - 3 * sigma, 0.0), 3),   # 比率/時間/出血皆不可為負
        ucl2=round(cl + 2 * sigma, 3),
        lcl2=round(max(cl - 2 * sigma, 0.0), 3),
    )

    result.signals = _detect_wer(points, cl, sigma)
    latest_period = valid[-1].period if valid else None
    result.rating = _resolve_rating(result.signals, latest_period)
    result.rating_label = RATING_LABELS[result.rating]

    # P Chart 補充層（比率型；僅人次 ≥ 門檻的期別）
    if kind == "rate":
        with_nd = [
            p for p in valid
            if p.numerator is not None and p.denominator and p.denominator > 0
        ]
        if with_nd:
            total_num = sum(p.numerator for p in with_nd)
            total_den = sum(p.denominator for p in with_nd)
            if total_den > 0:
                p_bar = total_num / total_den          # 比例（0–1）
                result.p_cl = round(p_bar * 100, 3)    # 以 % 呈現
                for p in with_nd:
                    if p.denominator >= p_chart_min_n:
                        se = math.sqrt(max(p_bar * (1 - p_bar), 0.0) / p.denominator)
                        result.p_limits.append(PLimit(
                            period=p.period,
                            ucl=round(min((p_bar + 3 * se), 1.0) * 100, 3),
                            lcl=round(max((p_bar - 3 * se), 0.0) * 100, 3),
                            ucl2=round(min((p_bar + 2 * se), 1.0) * 100, 3),
                            lcl2=round(max((p_bar - 2 * se), 0.0) * 100, 3),
                            n=p.denominator,
                        ))

    return result
