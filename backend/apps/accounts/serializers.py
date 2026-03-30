from django.contrib.auth import authenticate
from rest_framework import serializers

from apps.accounts.models import User


class LoginSerializer(serializers.Serializer):
    employee_id = serializers.CharField(label="帳號")
    password = serializers.CharField(label="密碼", write_only=True, style={"input_type": "password"})

    def validate(self, data):
        user = authenticate(
            request=self.context.get("request"),
            employee_id=data["employee_id"],
            password=data["password"],
        )
        if not user:
            raise serializers.ValidationError("帳號或密碼錯誤")
        if not user.is_active:
            raise serializers.ValidationError("帳號已停用")
        data["user"] = user
        return data


class UserSerializer(serializers.ModelSerializer):
    campus_code = serializers.CharField(source="campus.code", read_only=True, allow_null=True)
    campus_name = serializers.CharField(source="campus.name", read_only=True, allow_null=True)

    class Meta:
        model = User
        fields = [
            "id",
            "employee_id",
            "full_name",
            "email",
            "campus_code",
            "campus_name",
            "roles",
            "is_active",
            "must_change_password",
        ]
        read_only_fields = fields


class UserCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)

    class Meta:
        model = User
        fields = [
            "employee_id",
            "full_name",
            "email",
            "campus",
            "roles",
            "password",
        ]

    def create(self, validated_data):
        password = validated_data.pop("password")
        user = User(**validated_data)
        user.must_change_password = True
        user.set_password(password)
        user.save()
        return user


class UserUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["full_name", "email", "campus", "roles", "is_active"]
