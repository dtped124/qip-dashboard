"""
QIP 監測指標儀表板 — Streamlit 主應用
新竹臺大分院品質管理中心
"""
import os
import sys

import streamlit as st

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")

import django
django.setup()

st.set_page_config(
    page_title="QIP 儀表板",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="expanded",
)

# Auto-redirect to dashboard
st.switch_page("pages/1_📊_儀表板.py")
