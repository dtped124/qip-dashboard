"""設定頁 — 指標與標竿管理"""
import os
import sys

import streamlit as st

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")

import django
django.setup()

from apps.indicators.models import Indicator, TCPIBenchmark
from apps.indicators.constants import CATEGORY_ORDER

st.set_page_config(page_title="設定", page_icon="⚙️", layout="wide")
st.title("⚙️ 系統設定")

tab1, tab2 = st.tabs(["指標管理", "TCPI 標竿"])

with tab1:
    st.subheader("指標列表")
    st.caption("完整的指標管理請使用 Django Admin 後台")

    import pandas as pd
    indicators = Indicator.objects.all().order_by("code")
    df = pd.DataFrame([
        {
            "代碼": ind.code,
            "名稱": ind.name,
            "類別": ind.category,
            "單位": ind.get_unit_display(),
            "方向": ind.get_direction_display(),
            "啟用": "✅" if ind.is_active else "❌",
        }
        for ind in indicators
    ])
    if not df.empty:
        st.dataframe(df, use_container_width=True, hide_index=True)
    else:
        st.info("尚未載入指標，請先執行 seed 指令")

with tab2:
    st.subheader("TCPI 同儕標竿值")
    benchmarks = TCPIBenchmark.objects.all().order_by("-year", "indicator_id")
    df = pd.DataFrame([
        {
            "指標": b.indicator_id,
            "TCPI名稱": b.tcpi_name,
            "年度": b.year,
            "醫學中心": b.medical_center,
            "區域醫院": b.regional_hospital,
            "地區醫院": b.district_hospital,
        }
        for b in benchmarks
    ])
    if not df.empty:
        st.dataframe(df, use_container_width=True, hide_index=True)
    else:
        st.info("尚未載入 TCPI 標竿值")
