from django import forms
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from apps.accounts.models import User, UserRole


class RolesCheckboxWidget(forms.CheckboxSelectMultiple):
    """將 JSONField 的角色清單以 checkbox 呈現"""
    pass


class UserAdminForm(forms.ModelForm):
    roles = forms.MultipleChoiceField(
        choices=UserRole.choices,
        widget=RolesCheckboxWidget,
        required=False,
        label="角色",
    )

    class Meta:
        model = User
        fields = "__all__"

    def clean_roles(self):
        return list(self.cleaned_data.get("roles", []))


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    form = UserAdminForm
    list_display = ("employee_id", "full_name", "email", "campus", "display_roles", "is_active")
    list_filter = ("is_active", "campus")
    search_fields = ("employee_id", "full_name", "email")
    ordering = ("employee_id",)

    fieldsets = (
        (None, {"fields": ("employee_id", "password")}),
        ("個人資訊", {"fields": ("full_name", "email", "campus", "roles")}),
        ("權限", {"fields": ("is_active", "is_staff", "is_superuser")}),
        ("重要日期", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (None, {
            "classes": ("wide",),
            "fields": ("employee_id", "full_name", "email", "campus", "roles", "password1", "password2"),
        }),
    )

    @admin.display(description="角色")
    def display_roles(self, obj):
        label_map = dict(UserRole.choices)
        return ", ".join(label_map.get(r, r) for r in obj.roles) if obj.roles else "-"
