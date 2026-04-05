"""
重新計算所有指標的異常偵測結果（Alert 表）。
用於管制圖邏輯變更後刷新快取。

用法: python manage.py refresh_alerts
"""
from django.core.management.base import BaseCommand

from apps.analysis.services.anomaly_detector import analyze_indicator
from apps.analysis.services.control_chart import MonthlyDataPoint
from apps.indicators.models import Alert, DataPoint, Indicator, TCPIBenchmark


class Command(BaseCommand):
    help = "重新計算所有指標的異常偵測結果"

    def handle(self, *args, **options):
        indicators = Indicator.objects.filter(is_active=True)
        total = 0

        for ind in indicators:
            # Find all campuses with data
            campuses = (
                DataPoint.objects.filter(indicator_id=ind.code)
                .values_list("campus", flat=True)
                .distinct()
            )

            for campus in campuses:
                dps = DataPoint.objects.filter(
                    indicator_id=ind.code, campus=campus,
                ).order_by("year", "month")

                monthly_data = [
                    MonthlyDataPoint(
                        year=dp.year, month=dp.month, value=dp.value,
                        numerator=dp.numerator, denominator=dp.denominator,
                    )
                    for dp in dps
                ]

                if not monthly_data:
                    continue

                # Peer value
                peer_value = None
                tcpi = TCPIBenchmark.objects.filter(indicator_id=ind.code).order_by("-year").first()
                if tcpi:
                    if campus == "新竹":
                        peer_value = tcpi.medical_center
                    elif campus == "竹北":
                        peer_value = tcpi.regional_hospital
                    elif campus == "竹東":
                        peer_value = tcpi.district_hospital

                skip_cc = ind.code.startswith("HA10")
                result = analyze_indicator(
                    monthly_data, peer_value, ind.direction, ind.data_nature,
                    skip_control_chart=skip_cc,
                )

                # Clear and recreate alerts
                Alert.objects.filter(indicator_id=ind.code, campus=campus).delete()
                for anomaly in result.anomalies:
                    if (anomaly.direction == "unfavorable"
                            and anomaly.severity in ("alert", "warning", "watch")
                            and anomaly.year and anomaly.month):
                        Alert.objects.create(
                            indicator_id=ind.code,
                            campus=campus,
                            severity=anomaly.severity,
                            mechanism=anomaly.mechanism,
                            rule=anomaly.rule,
                            message=anomaly.message,
                            year=anomaly.year,
                            month=anomaly.month,
                        )
                total += 1

        self.stdout.write(self.style.SUCCESS(f"已重新計算 {total} 組指標/院區的異常偵測結果"))
