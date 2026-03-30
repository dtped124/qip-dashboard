"""
填報期間輔助函式

- 民國年 ↔ 西元年轉換
- 取得「當前填報期間」（最近一個尚未 finalized 的月份）
- 取得截止日資訊
"""
import datetime

from apps.entry.models import Campus, DeadlineSetting, MonthlyReport, ReportStatus


def tw_year_month_to_date(tw_year: int, month: int) -> datetime.date:
    """民國年月 → 西元 date（取當月1日）"""
    return datetime.date(tw_year + 1911, month, 1)


def date_to_tw_year_month(d: datetime.date) -> tuple[int, int]:
    """西元 date → (民國年, 月)"""
    return d.year - 1911, d.month


def get_current_tw_year_month() -> tuple[int, int]:
    """取得今天的民國年月"""
    return date_to_tw_year_month(datetime.date.today())


def get_current_period(campus: Campus) -> dict:
    """
    取得「當前填報期間」：最近一個尚未 finalized 的月份。
    若所有月份皆已 finalized，回傳本月。
    """
    today = datetime.date.today()
    tw_year, month = date_to_tw_year_month(today)

    # 往回找最多 6 個月，找出第一個 unfilled 或 draft 的月份
    for delta in range(0, 6):
        m = month - delta
        y = tw_year
        while m <= 0:
            m += 12
            y -= 1

        # 檢查此月份是否有任何 finalized 的 report（代表已完成）
        has_finalized = MonthlyReport.objects.filter(
            campus=campus, year=y, month=m, status=ReportStatus.FINALIZED
        ).exists()

        if not has_finalized:
            return {"year": y, "month": m}

    return {"year": tw_year, "month": month}


def get_deadline_info(year: int, month: int) -> dict:
    """
    取得截止日資訊：
    - deadline_day：截止日（幾號）
    - deadline_date：西元截止日
    - days_remaining：剩餘天數（負數代表逾期）
    - is_overdue：是否逾期
    """
    try:
        setting = DeadlineSetting.objects.get(year=year, month=month)
        deadline_day = setting.deadline_day
    except DeadlineSetting.DoesNotExist:
        deadline_day = 10  # 全域預設每月10日

    # 截止日為下個月的 deadline_day（資料是上個月的）
    next_month = month + 1
    next_year = year
    if next_month > 12:
        next_month = 1
        next_year += 1
    deadline_date = datetime.date(next_year + 1911, next_month, deadline_day)

    today = datetime.date.today()
    days_remaining = (deadline_date - today).days

    return {
        "deadline_day": deadline_day,
        "deadline_date": deadline_date.strftime("%Y-%m-%d"),
        "tw_deadline_date": f"{next_year}年{next_month}月{deadline_day}日",
        "days_remaining": days_remaining,
        "is_overdue": days_remaining < 0,
    }
