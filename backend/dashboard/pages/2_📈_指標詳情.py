"""指標詳情頁 — 控制圖與趨勢分析（雙層管制圖支援）"""
import os
import sys

import plotly.graph_objects as go
import streamlit as st

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")

import django
django.setup()

from apps.indicators.models import Indicator, DataPoint, YearlySummary, TCPIBenchmark, Campus
from apps.indicators.constants import STATUS_CONFIG, CATEGORY_COLORS
from apps.analysis.services.control_chart import (
    MonthlyDataPoint, select_chart_type, compute_control_chart_params,
    compute_imr_chart_params, compute_p_chart_params, compute_u_chart_params,
    MIN_DATA_POINTS,
)
from apps.analysis.services.anomaly_detector import analyze_indicator

st.set_page_config(page_title="指標詳情", page_icon="📈", layout="wide")

# ── CSS ──
st.markdown("""
<style>
    #MainMenu {visibility: hidden;}
    footer {visibility: hidden;}
    header {visibility: hidden;}
    .block-container { padding-top: 1rem; }
    .baseline-info {
        background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px;
        padding: 10px 16px; font-size: 0.85em; color: #6B7280; margin-bottom: 12px;
    }
    .baseline-info strong { color: #1F2937; }
    .chart-params {
        display: flex; gap: 24px; font-size: 0.82em; color: #6B7280; margin-top: 4px;
    }
    .chart-params span { font-weight: 600; }
</style>
""", unsafe_allow_html=True)

# ── Sidebar ──
campus = st.sidebar.selectbox("院區", [c.value for c in Campus])
indicators = Indicator.objects.filter(is_active=True).order_by("code")
indicator_options = {f"{ind.code} {ind.name}": ind.code for ind in indicators}
selected = st.sidebar.selectbox("選擇指標", list(indicator_options.keys()))

if not selected:
    st.info("請從左側選擇指標")
    st.stop()

code = indicator_options[selected]
ind = Indicator.objects.get(code=code)

# ── Header ──
cat_color = CATEGORY_COLORS.get(ind.category, "#6B7280")
st.markdown(f"""
<div style="display:flex;align-items:center;gap:12px;margin-bottom:4px;">
    <span style="width:12px;height:12px;border-radius:50%;background:{cat_color};display:inline-block;"></span>
    <span style="font-size:1.4em;font-weight:700;">{ind.code} {ind.name}</span>
</div>
""", unsafe_allow_html=True)
st.caption(f"類別：{ind.category} | 單位：{ind.get_unit_display()} | 方向：{ind.get_direction_display()} | 資料性質：{ind.data_nature}")

# ── Load data ──
data_points = DataPoint.objects.filter(
    indicator_id=code, campus=campus
).order_by("year", "month")

if not data_points.exists():
    st.warning("此院區尚無資料")
    st.stop()

monthly_data = [
    MonthlyDataPoint(
        year=dp.year, month=dp.month, value=dp.value,
        numerator=dp.numerator, denominator=dp.denominator,
    )
    for dp in data_points
]

# Get peer value
peer_value = None
tcpi = TCPIBenchmark.objects.filter(indicator_id=code).order_by("-year").first()
if tcpi:
    if campus == "新竹":
        peer_value = tcpi.medical_center
    elif campus == "竹北":
        peer_value = tcpi.regional_hospital
    elif campus == "竹東":
        peer_value = tcpi.district_hospital

# Also try YearlySummary benchmarks
if peer_value is None:
    latest_ys = YearlySummary.objects.filter(
        indicator_id=code, campus=campus
    ).order_by("-year").first()
    if latest_ys:
        if campus == "竹北":
            peer_value = latest_ys.benchmark_regional
        elif campus == "竹東":
            peer_value = latest_ys.benchmark_district or latest_ys.benchmark_regional

# ── Run analysis ──
result = analyze_indicator(monthly_data, peer_value, ind.direction, ind.data_nature)

# Status display
status_info = STATUS_CONFIG.get(result.status, STATUS_CONFIG["neutral"])
peer_text = f" | 同儕值：{peer_value:.2f}" if peer_value else ""
st.markdown(f"""
<div style="padding:12px 16px;background:{status_info['bg']};border:1px solid {status_info['color']}30;border-radius:8px;margin-bottom:16px;">
    <span style="font-size:1.1em;font-weight:700;color:{status_info['color']};">
        狀態：{status_info['text']}
    </span>
    <span style="color:#6B7280;font-size:0.9em;">{peer_text}</span>
</div>
""", unsafe_allow_html=True)

# ── Dual-layer chart selection ──
sorted_data = sorted(
    [dp for dp in monthly_data if dp.value is not None],
    key=lambda dp: dp.year * 12 + dp.month,
)
recent_24 = sorted_data[-24:]

# Determine available charts
available_charts = ["I-MR"]  # Layer 1 always available

# Check if P/U chart is possible (Layer 2)
recommended_type = select_chart_type(recent_24, ind.data_nature)
has_nd_data = False
if recommended_type in ("P", "U"):
    with_nd = [dp for dp in recent_24 if dp.numerator is not None and dp.denominator is not None and dp.denominator > 0]
    if len(with_nd) >= MIN_DATA_POINTS:
        has_nd_data = True
        available_charts.append(recommended_type)

# Chart type selector
if len(available_charts) > 1:
    chart_labels = []
    for ct in available_charts:
        if ct == "I-MR":
            chart_labels.append("I-MR（基本）")
        elif ct == "P":
            chart_labels.append("P Chart ✦（推薦）")
        elif ct == "U":
            chart_labels.append("U Chart ✦（推薦）")

    selected_idx = st.radio(
        "管制圖類型",
        range(len(chart_labels)),
        format_func=lambda i: chart_labels[i],
        index=len(chart_labels) - 1,  # Default to recommended
        horizontal=True,
    )
    active_chart_type = available_charts[selected_idx]
else:
    active_chart_type = "I-MR"

# Compute chart params for selected type
if active_chart_type == "P":
    cc = compute_p_chart_params(recent_24)
elif active_chart_type == "U":
    cc = compute_u_chart_params(recent_24)
else:
    cc = compute_imr_chart_params(recent_24)

# ── Baseline info ──
if cc and recent_24:
    first_dp = recent_24[0]
    last_dp = recent_24[-1]
    baseline_text = f"{first_dp.year}/{first_dp.month:02d} – {last_dp.year}/{last_dp.month:02d}（{len(recent_24)} 個月）"
    unit_sym = {"percent": "%", "permille": "‰", "count": "", "ratio": ""}.get(ind.unit, "")

    st.markdown(f"""
    <div class="baseline-info">
        <strong>基線期間：</strong>{baseline_text}
        <div class="chart-params">
            <div>CL: <span>{cc.cl:.2f}{unit_sym}</span></div>
            <div>UCL: <span>{cc.ucl:.2f}{unit_sym}</span></div>
            <div>LCL: <span>{max(0, cc.lcl):.2f}{unit_sym}</span></div>
        </div>
    </div>
    """, unsafe_allow_html=True)

# ── Control chart rendering ──
if cc:
    valid_data = [dp for dp in monthly_data if dp.value is not None]
    x_labels = [f"{dp.year}/{dp.month:02d}" for dp in valid_data]
    y_values = [dp.value for dp in valid_data]

    fig = go.Figure()

    # Data line
    fig.add_trace(go.Scatter(
        x=x_labels, y=y_values,
        mode="lines+markers", name="數據",
        line=dict(color="#1C1917", width=2),
        marker=dict(size=5),
    ))

    # P/U charts have variable limits
    if cc.variable_limits and active_chart_type in ("P", "U"):
        # Build variable limit lines
        vl_x = [f"{vl.year}/{vl.month:02d}" for vl in cc.variable_limits]
        vl_ucl = [vl.ucl for vl in cc.variable_limits]
        vl_lcl = [vl.lcl for vl in cc.variable_limits]
        vl_ucl2 = [vl.ucl2 for vl in cc.variable_limits]
        vl_lcl2 = [vl.lcl2 for vl in cc.variable_limits]

        fig.add_trace(go.Scatter(
            x=vl_x, y=vl_ucl, mode="lines", name="UCL (3σ)",
            line=dict(color="#DC2626", width=1, dash="dot"),
        ))
        fig.add_trace(go.Scatter(
            x=vl_x, y=vl_lcl, mode="lines", name="LCL (3σ)",
            line=dict(color="#DC2626", width=1, dash="dot"),
        ))
        fig.add_trace(go.Scatter(
            x=vl_x, y=vl_ucl2, mode="lines", name="2σ 上",
            line=dict(color="#EA580C", width=1, dash="dot"),
        ))
        fig.add_trace(go.Scatter(
            x=vl_x, y=vl_lcl2, mode="lines", name="2σ 下",
            line=dict(color="#EA580C", width=1, dash="dot"),
        ))
    else:
        # I-MR: flat lines
        fig.add_hline(y=cc.ucl, line_dash="dot", line_color="#DC2626", annotation_text="UCL")
        if cc.lcl > 0:
            fig.add_hline(y=cc.lcl, line_dash="dot", line_color="#DC2626", annotation_text="LCL")
        fig.add_hline(y=cc.ucl2, line_dash="dot", line_color="#EA580C", annotation_text="2σ")
        if cc.lcl2 > 0:
            fig.add_hline(y=cc.lcl2, line_dash="dot", line_color="#EA580C")

    # CL (always flat)
    fig.add_hline(y=cc.cl, line_dash="dash", line_color="#6B7280", annotation_text="CL")

    # Peer value
    if peer_value:
        fig.add_hline(y=peer_value, line_dash="dashdot", line_color="#2563EB", annotation_text="同儕值")

    fig.update_layout(
        title=f"管制圖 ({active_chart_type})",
        xaxis_title="年/月",
        yaxis_title=ind.get_unit_display(),
        height=480,
        hovermode="x unified",
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
    )
    st.plotly_chart(fig, use_container_width=True)

# ── Anomalies table ──
if result.anomalies:
    st.subheader("異常偵測結果")
    # Show only recent anomalies
    recent_anomalies = sorted(
        [a for a in result.anomalies if a.year and a.month],
        key=lambda a: a.year * 12 + a.month,
        reverse=True,
    )[:15]
    for a in recent_anomalies:
        severity_icon = {"alert": "🔴", "warning": "🟠", "watch": "🟡", "excellent": "🔵"}.get(a.severity, "⚪")
        mech_label = {"control_chart": "管制圖", "monthly_change": "月增減", "peer_comparison": "同儕比較"}.get(a.mechanism, a.mechanism)
        period = f"{a.year}/{a.month:02d}" if a.year and a.month else ""
        st.markdown(f"{severity_icon} **{period}** [{mech_label}] {a.message}")

# ── Monthly data table ──
st.subheader("月份資料")
import pandas as pd
df = pd.DataFrame([
    {"年度": dp.year, "月份": dp.month, "值": dp.value,
     "分子": dp.numerator, "分母": dp.denominator}
    for dp in data_points
])
st.dataframe(df, use_container_width=True, hide_index=True)
