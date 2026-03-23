"""
儀表板首頁 — 持續性監測指標儀表板

重建原 Next.js 版面設計：
- 左側 sidebar：院區切換、類別導覽（含指標數量）
- 頂部 header：標題 + 即時時鐘 + 搜尋 + 匯入按鈕
- 主區域：依類別分組的指標卡片（含狀態標籤、數值、迷你折線圖、趨勢箭頭）
"""
import os
import sys
from datetime import datetime

import streamlit as st

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")

import django
django.setup()

from apps.indicators.models import Indicator, DataPoint, Alert, Campus, YearlySummary, TCPIBenchmark
from apps.indicators.constants import CATEGORY_COLORS, CATEGORY_ORDER, STATUS_CONFIG

st.set_page_config(page_title="QIP 儀表板", page_icon="📊", layout="wide")

# ── Global CSS to match original design ──
st.markdown("""
<style>
    /* Hide default Streamlit header/footer */
    #MainMenu {visibility: hidden;}
    footer {visibility: hidden;}
    header {visibility: hidden;}

    /* Reduce top padding */
    .block-container { padding-top: 1rem; padding-bottom: 0; }

    /* Card styles */
    .qip-card {
        background: white;
        border: 1px solid #E5E7EB;
        border-radius: 8px;
        padding: 14px 16px;
        margin-bottom: 12px;
        position: relative;
        transition: box-shadow 0.2s;
        min-height: 180px;
    }
    .qip-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.08); }

    .card-top { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .status-badge {
        display: inline-flex; align-items: center; gap: 4px;
        padding: 2px 8px; border-radius: 12px; font-size: 0.72em; font-weight: 600;
    }
    .card-code { font-family: monospace; font-size: 0.8em; color: #9CA3AF; }
    .card-name { font-weight: 600; color: #1F2937; font-size: 0.88em; line-height: 1.3;
                 overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .card-value { font-size: 1.6em; font-weight: 700; margin: 4px 0 2px; }
    .card-period { font-size: 0.75em; color: #9CA3AF; }
    .card-bottom { display: flex; justify-content: space-between; align-items: center;
                   border-top: 1px solid #F3F4F6; margin-top: 8px; padding-top: 6px; font-size: 0.75em; color: #9CA3AF; }
    .card-color-bar { position: absolute; right: 0; top: 12px; width: 4px; height: 28px; border-radius: 2px; }

    .anomaly-pill { display: inline-block; background: #FEE2E2; color: #DC2626;
                    padding: 1px 6px; border-radius: 8px; font-size: 0.65em; font-weight: 500; margin-right: 4px; }

    /* Trend arrow */
    .trend-up-bad { color: #DC2626; font-size: 0.78em; }
    .trend-up-good { color: #16A34A; font-size: 0.78em; }
    .trend-down-bad { color: #DC2626; font-size: 0.78em; }
    .trend-down-good { color: #16A34A; font-size: 0.78em; }
    .trend-flat { color: #9CA3AF; font-size: 0.78em; }

    /* Category section */
    .cat-header { display: flex; align-items: center; gap: 10px; margin: 20px 0 10px; }
    .cat-dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }
    .cat-name { font-size: 1.15em; font-weight: 700; color: #1F2937; }
    .cat-count { font-size: 0.8em; color: #9CA3AF; }

    /* Header */
    .header-bar { display: flex; justify-content: space-between; align-items: center;
                  padding: 8px 0 12px; border-bottom: 1px solid #F3F4F6; margin-bottom: 16px; }
    .header-left h1 { font-size: 1.3em; font-weight: 700; color: #1F2937; margin: 0; }
    .header-left p { font-size: 0.82em; color: #6B7280; margin: 2px 0 0; }
    .header-clock { display: inline-flex; align-items: center; gap: 6px; font-family: monospace;
                    font-size: 0.82em; color: #6B7280; }
    .clock-dot { width: 8px; height: 8px; border-radius: 50%; background: #16A34A;
                 display: inline-block; animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }

    /* Overview stats */
    .stat-card { background: white; border: 1px solid #E5E7EB; border-radius: 8px;
                 padding: 14px 18px; text-align: left; }
    .stat-label { font-size: 0.8em; color: #6B7280; margin-bottom: 4px; }
    .stat-value { font-size: 1.5em; font-weight: 700; }

    /* Sparkline SVG */
    .sparkline-container { display: inline-block; }

    /* Sidebar category */
    .sidebar-cat { display: flex; align-items: center; gap: 8px; padding: 6px 8px;
                   border-radius: 6px; margin-bottom: 2px; cursor: pointer; font-size: 0.88em; }
    .sidebar-cat:hover { background: #F3F4F6; }
    .sidebar-cat-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
    .sidebar-cat-count { margin-left: auto; color: #9CA3AF; font-size: 0.82em; }
</style>
""", unsafe_allow_html=True)

# ── Sidebar ──
with st.sidebar:
    st.markdown("### QIP 儀表板")
    st.markdown("##### 院區選擇")

    campus_options = [c.value for c in Campus]
    if "campus" not in st.session_state:
        st.session_state.campus = "竹北"

    cols = st.columns(len(campus_options))
    for i, c in enumerate(campus_options):
        with cols[i]:
            if st.button(c, key=f"campus_{c}", use_container_width=True,
                         type="primary" if st.session_state.campus == c else "secondary"):
                st.session_state.campus = c
                st.rerun()

    campus = st.session_state.campus

    # Category navigation
    all_indicators = list(Indicator.objects.filter(is_active=True))
    campus_indicators = [ind for ind in all_indicators if campus in ind.campuses]

    st.markdown("---")

    if "selected_category" not in st.session_state:
        st.session_state.selected_category = "全部"

    # "全部指標" button
    is_all = st.session_state.selected_category == "全部"
    if st.button("全部指標" if is_all else "全部指標", key="cat_all", use_container_width=True,
                 type="primary" if is_all else "secondary"):
        st.session_state.selected_category = "全部"
        st.rerun()

    for cat in CATEGORY_ORDER:
        cat_count = sum(1 for ind in campus_indicators if ind.category == cat)
        if cat_count == 0:
            continue
        color = CATEGORY_COLORS.get(cat, "#6B7280")
        is_selected = st.session_state.selected_category == cat
        label = f"{'**' if is_selected else ''}{cat}{'**' if is_selected else ''}　({cat_count})"

        if st.button(f"● {cat}　{cat_count}", key=f"cat_{cat}", use_container_width=True,
                     type="primary" if is_selected else "secondary"):
            st.session_state.selected_category = cat
            st.rerun()

    st.markdown("---")
    st.page_link("pages/3_📥_資料匯入.py", label="📤 匯入紀錄")
    st.page_link("pages/4_⚙️_設定.py", label="⚙️ 設定")

selected_category = st.session_state.selected_category

# ── Header ──
now = datetime.now()
campus_subtitle = {"竹北": "竹北院區", "竹東": "竹東院區", "新竹": "新竹院區"}.get(campus, campus)

h_left, h_right = st.columns([3, 2])
with h_left:
    st.markdown(f"""
    <div>
        <h1 style="font-size:1.3em;font-weight:700;margin:0;">持續性監測指標儀表板
            <span class="header-clock"><span class="clock-dot"></span> {now:%H:%M:%S}</span>
        </h1>
        <p style="font-size:0.82em;color:#6B7280;margin:2px 0 0;">{campus_subtitle} — 醫院評鑑 QIP 指標監測</p>
    </div>
    """, unsafe_allow_html=True)

with h_right:
    search_col, btn_col = st.columns([3, 1])
    with search_col:
        search_query = st.text_input("搜尋", placeholder="搜尋指標代碼或名稱...", label_visibility="collapsed")
    with btn_col:
        st.page_link("pages/3_📥_資料匯入.py", label="📤 匯入資料")

st.markdown("<div style='border-bottom:1px solid #F3F4F6;margin-bottom:16px;'></div>", unsafe_allow_html=True)

# ── Filter indicators ──
filtered = campus_indicators
if selected_category != "全部":
    filtered = [ind for ind in filtered if ind.category == selected_category]
if search_query:
    q = search_query.lower()
    filtered = [ind for ind in filtered if q in ind.code.lower() or q in ind.name.lower()]

# ── Overview Stats ──
total_count = len(filtered)
good_count = 0
alert_warning_count = 0
collected_count = 0

# Pre-load data points and alerts for all filtered indicators
data_cache: dict[str, list] = {}
alert_cache: dict[str, list] = {}
for ind in filtered:
    dps = list(DataPoint.objects.filter(
        indicator_id=ind.code, campus=campus
    ).order_by("year", "month").values("year", "month", "value"))
    data_cache[ind.code] = dps

    alerts = list(Alert.objects.filter(
        indicator_id=ind.code, campus=campus
    ).values("severity", "mechanism", "year", "month"))
    alert_cache[ind.code] = alerts

    if dps:
        collected_count += 1
        latest_alerts = [a for a in alerts if a["severity"] in ("alert", "warning", "watch")]
        if latest_alerts:
            alert_warning_count += 1
        else:
            good_count += 1

c1, c2, c3, c4 = st.columns(4)
with c1:
    st.markdown(f"""<div class="stat-card">
        <div class="stat-label">指標總數</div>
        <div class="stat-value" style="color:#2563EB;">{total_count}</div>
    </div>""", unsafe_allow_html=True)
with c2:
    pct = f"{good_count/total_count*100:.0f}%" if total_count > 0 else "0%"
    st.markdown(f"""<div class="stat-card">
        <div class="stat-label">良好以上</div>
        <div class="stat-value" style="color:#16A34A;">{good_count} <span style="font-size:0.5em;">{pct}</span></div>
    </div>""", unsafe_allow_html=True)
with c3:
    clr = "#DC2626" if alert_warning_count > 0 else "#CA8A04"
    st.markdown(f"""<div class="stat-card">
        <div class="stat-label">警示/注意</div>
        <div class="stat-value" style="color:{clr};">{alert_warning_count}</div>
    </div>""", unsafe_allow_html=True)
with c4:
    st.markdown(f"""<div class="stat-card">
        <div class="stat-label">已收集</div>
        <div class="stat-value" style="color:#7C3AED;">{collected_count} / {total_count}</div>
    </div>""", unsafe_allow_html=True)


# ── Helper functions ──

def make_sparkline_svg(values: list[float | None], color: str = "#DC2626", width: int = 120, height: int = 32) -> str:
    """Generate SVG sparkline from values (last 24 months)"""
    valid = [(i, v) for i, v in enumerate(values[-24:]) if v is not None]
    if len(valid) < 2:
        return f'<svg width="{width}" height="{height}"><line x1="0" y1="{height//2}" x2="{width}" y2="{height//2}" stroke="#E5E7EB" stroke-dasharray="4" /></svg>'

    min_v = min(v for _, v in valid)
    max_v = max(v for _, v in valid)
    range_v = max_v - min_v if max_v != min_v else 1
    pad = 3

    points = []
    for i, v in valid:
        x = pad + (i / max(len(values[-24:]) - 1, 1)) * (width - 2 * pad)
        y = pad + (1 - (v - min_v) / range_v) * (height - 2 * pad)
        points.append(f"{x:.1f},{y:.1f}")

    polyline = " ".join(points)
    last_x, last_y = points[-1].split(",")

    return f'''<svg width="{width}" height="{height}" viewBox="0 0 {width} {height}">
        <polyline points="{polyline}" fill="none" stroke="{color}" stroke-width="1.5"
                  stroke-linecap="round" stroke-linejoin="round" />
        <circle cx="{last_x}" cy="{last_y}" r="2.5" fill="{color}" />
    </svg>'''


def get_trend_html(values: list[float | None], direction: str) -> str:
    """Calculate trend and return HTML"""
    valid = [v for v in values if v is not None]
    if len(valid) < 3:
        return '<span class="trend-flat">— 持平</span>'

    recent = valid[-6:] if len(valid) >= 6 else valid
    n = len(recent)
    xs = list(range(n))
    avg_x = sum(xs) / n
    avg_y = sum(recent) / n
    num = sum((xs[i] - avg_x) * (recent[i] - avg_y) for i in range(n))
    den = sum((xs[i] - avg_x) ** 2 for i in range(n))

    if den == 0:
        return '<span class="trend-flat">— 持平</span>'

    slope = num / den
    threshold = abs(avg_y) * 0.05 or 0.01

    if slope > threshold:
        if direction == "lower":
            return '<span class="trend-up-bad">&#8599; 上升</span>'
        else:
            return '<span class="trend-up-good">&#8599; 上升</span>'
    elif slope < -threshold:
        if direction == "higher":
            return '<span class="trend-down-bad">&#8600; 下降</span>'
        else:
            return '<span class="trend-down-good">&#8600; 下降</span>'
    return '<span class="trend-flat">— 持平</span>'


def get_unit_symbol(unit: str) -> str:
    return {"percent": "%", "permille": "‰", "count": "", "ratio": ""}.get(unit, "")


def render_indicator_card(ind, cat_color: str):
    """Render a single indicator card matching the original design"""
    code = ind.code
    dps = data_cache.get(code, [])
    alerts = alert_cache.get(code, [])

    # Latest value
    valid_dps = [dp for dp in dps if dp["value"] is not None]
    if valid_dps:
        latest = max(valid_dps, key=lambda d: d["year"] * 100 + d["month"])
        value = latest["value"]
        period = f"{latest['year']}.{latest['month']:02d}"
    else:
        value = None
        period = ""

    # Status from alerts
    unfavorable = [a for a in alerts if a["severity"] in ("alert", "warning", "watch")]
    if any(a["severity"] == "alert" for a in unfavorable):
        status = "alert"
    elif any(a["severity"] == "warning" for a in unfavorable):
        status = "warning"
    elif any(a["severity"] == "watch" for a in unfavorable):
        status = "watch"
    elif valid_dps:
        status = "good"
    else:
        status = "neutral"

    si = STATUS_CONFIG.get(status, STATUS_CONFIG["neutral"])
    unit_sym = get_unit_symbol(ind.unit)

    # Value display
    if value is not None:
        if ind.unit in ("percent", "permille", "ratio"):
            value_str = f"{value:.2f}{unit_sym}"
        else:
            value_str = f"{value:.0f}"
    else:
        value_str = "—"

    # Sparkline
    all_values = [dp["value"] for dp in dps]
    sparkline = make_sparkline_svg(all_values, color="#DC2626" if status in ("alert", "warning") else "#9CA3AF")

    # Trend
    trend_html = get_trend_html(all_values, ind.direction)

    # Anomaly badges
    mechanisms = set()
    for a in unfavorable:
        if a["mechanism"] == "control_chart":
            mechanisms.add("管制圖")
        elif a["mechanism"] == "monthly_change":
            mechanisms.add("月增減")
        elif a["mechanism"] == "peer_comparison":
            mechanisms.add("同儕比較")
    anomaly_html = "".join(f'<span class="anomaly-pill">{m}</span>' for m in mechanisms)

    # Unfavorable count badge
    uf_count = len(unfavorable)
    uf_badge = f'<span style="background:#DC2626;color:white;border-radius:50%;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;font-size:0.65em;font-weight:700;">{uf_count}</span>' if uf_count > 0 else ""

    # Year average
    year_values = [dp["value"] for dp in dps if dp["value"] is not None and valid_dps and dp["year"] == valid_dps[-1]["year"]]
    year_avg = f"{sum(year_values)/len(year_values):.2f}{unit_sym}" if year_values else ""
    year_label = f"{valid_dps[-1]['year']}年均: {year_avg}" if year_values and valid_dps else ""

    # Peer/benchmark value
    peer_label = ""
    if valid_dps:
        latest_year = valid_dps[-1]["year"]
        ys = YearlySummary.objects.filter(indicator_id=code, campus=campus, year=latest_year).first()
        if ys:
            bv = None
            if campus == "竹北":
                bv = ys.benchmark_regional
            elif campus == "竹東":
                bv = ys.benchmark_district or ys.benchmark_regional
            if bv is not None:
                peer_label = f"標竿: {bv:.2f}{unit_sym}"

        if not peer_label:
            tcpi = TCPIBenchmark.objects.filter(indicator_id=code).order_by("-year").first()
            if tcpi:
                tv = None
                if campus == "新竹":
                    tv = tcpi.medical_center
                elif campus == "竹北":
                    tv = tcpi.regional_hospital
                elif campus == "竹東":
                    tv = tcpi.district_hospital
                if tv is not None:
                    peer_label = f"TCPI: {tv:.2f}{unit_sym}"

    badge_bg = si["bg"]
    badge_color = si["color"]

    st.markdown(f"""
    <div class="qip-card">
        <div class="card-color-bar" style="background:{cat_color};"></div>
        <div class="card-top">
            <span class="status-badge" style="background:{badge_bg};color:{badge_color};">
                <span style="width:6px;height:6px;border-radius:50%;background:{badge_color};display:inline-block;"></span>
                {si['text']}
            </span>
            <span class="card-code">{code}</span>
            {uf_badge}
        </div>
        <div class="card-name">{ind.name}</div>
        <div style="display:flex;justify-content:space-between;align-items:flex-end;">
            <div>
                <div class="card-value" style="color:{badge_color};">{value_str}</div>
                <div class="card-period">{period}</div>
            </div>
            <div class="sparkline-container">{sparkline}</div>
        </div>
        {anomaly_html}
        <div class="card-bottom">
            <span>{peer_label}</span>
            {trend_html}
        </div>
        <div style="font-size:0.72em;color:#9CA3AF;margin-top:2px;">{year_label}</div>
    </div>
    """, unsafe_allow_html=True)


# ── Render cards by category ──
if not filtered:
    st.markdown("""
    <div style="text-align:center;padding:60px 0;">
        <div style="font-size:3em;color:#D1D5DB;">📋</div>
        <h3 style="color:#6B7280;">尚無資料</h3>
        <p style="color:#9CA3AF;">請先匯入 QIP 指標 Excel 檔案</p>
    </div>
    """, unsafe_allow_html=True)
else:
    categories_to_show = CATEGORY_ORDER if selected_category == "全部" else [selected_category]

    for cat in categories_to_show:
        cat_inds = [ind for ind in filtered if ind.category == cat]
        if not cat_inds:
            continue

        color = CATEGORY_COLORS.get(cat, "#6B7280")
        st.markdown(f"""
        <div class="cat-header">
            <span class="cat-dot" style="background:{color};"></span>
            <span class="cat-name">{cat}</span>
            <span class="cat-count">{len(cat_inds)} 項指標</span>
        </div>
        """, unsafe_allow_html=True)

        # 4-column grid
        cols = st.columns(4)
        for i, ind in enumerate(cat_inds):
            with cols[i % 4]:
                render_indicator_card(ind, color)
