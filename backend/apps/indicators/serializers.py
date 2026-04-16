"""DRF Serializers for QIP indicators API."""
from rest_framework import serializers
from .models import Indicator, DataPoint, YearlySummary, Alert, TCPIBenchmark, PeerValue


class IndicatorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Indicator
        fields = [
            "code", "name", "category", "unit", "direction",
            "data_nature", "is_quarterly", "is_active",
            "campuses", "aliases", "formula", "description",
            "target_mode", "target_value",
        ]


class DataPointSerializer(serializers.ModelSerializer):
    class Meta:
        model = DataPoint
        fields = ["year", "month", "value", "numerator", "denominator"]


class YearlySummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = YearlySummary
        fields = ["year", "average", "benchmark_regional", "benchmark_district"]


class AlertSerializer(serializers.ModelSerializer):
    class Meta:
        model = Alert
        fields = ["year", "month", "mechanism", "rule", "severity", "message", "acknowledged"]


class TCPIBenchmarkSerializer(serializers.ModelSerializer):
    class Meta:
        model = TCPIBenchmark
        fields = ["year", "medical_center", "regional_hospital", "district_hospital"]


class PeerValueSerializer(serializers.ModelSerializer):
    class Meta:
        model = PeerValue
        fields = ["year", "source", "medical_center", "regional_hospital", "district_hospital"]
