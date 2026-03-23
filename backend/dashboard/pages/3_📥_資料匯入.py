"""資料匯入頁 — 上傳 Excel 並匯入 QIP 指標資料"""
import os
import sys

import streamlit as st

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")

import django
django.setup()

from apps.imports.models import ImportLog

st.set_page_config(page_title="資料匯入", page_icon="📥", layout="wide")
st.title("📥 資料匯入")

st.markdown("""
支援格式：
- **竹北 / 竹東**：每個工作表 = 一個年度×院區（如「114年竹北」）
- **新竹**：單一工作表，橫向時間軸
- 支援 `.xls` 和 `.xlsx` 格式
""")

uploaded_file = st.file_uploader(
    "上傳 QIP 指標 Excel 檔案",
    type=["xlsx", "xls"],
    help="支援竹北、竹東、新竹三個院區的 QIP 指標 Excel 檔案",
)

if uploaded_file:
    st.info(f"📄 檔案：**{uploaded_file.name}** ({uploaded_file.size:,} bytes)")

    # Parse preview
    if st.button("🔍 預覽解析結果", type="secondary"):
        with st.spinner("解析中..."):
            from apps.imports.services.excel_parser import parse_qip_excel
            file_bytes = uploaded_file.read()
            uploaded_file.seek(0)
            result = parse_qip_excel(file_bytes, uploaded_file.name)
            st.session_state["parse_result"] = result
            st.session_state["file_bytes"] = file_bytes

    if "parse_result" in st.session_state:
        result = st.session_state["parse_result"]

        st.success("✅ 解析完成")

        col1, col2, col3, col4 = st.columns(4)
        with col1:
            st.metric("工作表", len(result.sheets_processed))
        with col2:
            codes = set(dp.indicator_code for dp in result.data_points)
            st.metric("指標數", len(codes))
        with col3:
            valid_dps = [dp for dp in result.data_points if dp.value is not None]
            st.metric("有效資料點", len(valid_dps))
        with col4:
            st.metric("警告/錯誤", len(result.errors))

        if result.sheets_processed:
            with st.expander("📋 處理的工作表"):
                for s in result.sheets_processed:
                    st.write(f"- {s}")

        if result.errors:
            with st.expander(f"⚠️ 警告與錯誤 ({len(result.errors)})", expanded=len(result.errors) <= 10):
                for e in result.errors:
                    if e.startswith("✅"):
                        st.success(e)
                    elif e.startswith("⚠"):
                        st.warning(e)
                    else:
                        st.error(e)

        with st.expander("📊 資料預覽（依指標）"):
            import pandas as pd
            from apps.indicators.constants import INDICATOR_META

            preview_data = []
            for dp in result.data_points:
                if dp.value is not None:
                    meta = INDICATOR_META.get(dp.indicator_code, {})
                    preview_data.append({
                        "代碼": dp.indicator_code,
                        "名稱": meta.get("name", ""),
                        "院區": dp.campus,
                        "年度": dp.year,
                        "月份": dp.month,
                        "值": dp.value,
                        "分子": dp.numerator,
                        "分母": dp.denominator,
                    })

            if preview_data:
                df = pd.DataFrame(preview_data)
                summary = df.groupby(["代碼", "名稱", "院區"]).agg(
                    月份數=("月份", "count"),
                    最小值=("值", "min"),
                    最大值=("值", "max"),
                    平均值=("值", "mean"),
                ).reset_index()
                st.dataframe(summary, use_container_width=True, hide_index=True)
            else:
                st.info("無有效資料點")

        st.markdown("---")
        if st.button("📥 確認匯入資料庫", type="primary", use_container_width=True):
            with st.spinner("寫入資料庫中..."):
                from apps.imports.services.persistence import save_import_results
                file_bytes = st.session_state["file_bytes"]
                log = save_import_results(result, uploaded_file.name, len(file_bytes))

            st.balloons()
            st.success(
                f"✅ 匯入完成！\n\n"
                f"- 新增：**{log.data_points_new}** 筆\n"
                f"- 更新：**{log.data_points_updated}** 筆\n"
                f"- 未變更：**{log.data_points_unchanged}** 筆"
            )

            if "parse_result" in st.session_state:
                del st.session_state["parse_result"]
            if "file_bytes" in st.session_state:
                del st.session_state["file_bytes"]

st.markdown("---")
st.subheader("📋 匯入紀錄")

logs = ImportLog.objects.all()[:20]
if logs:
    for log in logs:
        with st.container():
            c1, c2 = st.columns([3, 1])
            with c1:
                st.markdown(
                    f"**{log.file_name}** — "
                    f"新增 {log.data_points_new} | 更新 {log.data_points_updated} | "
                    f"未變更 {log.data_points_unchanged}"
                )
            with c2:
                st.caption(f"{log.created_at:%Y-%m-%d %H:%M}")
else:
    st.info("尚無匯入紀錄")
