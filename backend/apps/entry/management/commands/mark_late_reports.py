"""
逾期自動標記（§7.3）

超過截止日後，將未完成（unfilled/draft/submitted）的 MonthlyReport
標記為 is_late = True。

可搭配 cron job 每日執行：
  0 0 * * * python manage.py mark_late_reports

Usage:
    python manage.py mark_late_reports
    python manage.py mark_late_reports --year 115 --month 3
"""
import datetime

from django.core.management.base import BaseCommand

from apps.entry.models import DeadlineSetting, MonthlyReport, ReportStatus
from apps.entry.services.period import date_to_tw_year_month, get_deadline_info


class Command(BaseCommand):
    help = "標記逾期的月報（超過截止日且尚未完成）"

    def add_arguments(self, parser):
        parser.add_argument("--year", type=int, help="指定民國年（預設：本月）")
        parser.add_argument("--month", type=int, help="指定月份（預設：本月）")

    def handle(self, *args, **options):
        today = datetime.date.today()
        tw_year, month = date_to_tw_year_month(today)

        year = options.get("year") or tw_year
        month = options.get("month") or month

        deadline_info = get_deadline_info(year, month)

        if not deadline_info["is_overdue"]:
            self.stdout.write(f"{year}年{month}月 尚未逾期（截止日：{deadline_info['tw_deadline_date']}），不標記")
            return

        # 標記未完成的 reports
        incomplete_statuses = [ReportStatus.UNFILLED, ReportStatus.DRAFT, ReportStatus.SUBMITTED]
        updated = MonthlyReport.objects.filter(
            year=year, month=month,
            status__in=incomplete_statuses,
            is_late=False,
        ).update(is_late=True)

        self.stdout.write(self.style.SUCCESS(
            f"已標記 {updated} 筆逾期月報（{year}年{month}月，截止日：{deadline_info['tw_deadline_date']}）"
        ))
