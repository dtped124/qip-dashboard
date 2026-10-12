from django import forms
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.forms import UserCreationForm

from apps.accounts.models import User, UserRole
from apps.accounts.serializers import DUPLICATE_EMPLOYEE_ID_MESSAGE


class CaseInsensitiveEmployeeIdMixin:
    """Refuse an employee_id that differs from an existing one only in letter case ("abc" vs "ABC").

    The database constraint is case sensitive while AD and the login are not; the API serializer checks this too.
    """

    def clean_employee_id(self):
        value = self.cleaned_data.get("employee_id")
        if value:
            others = User.objects.filter(employee_id__iexact=value)
            if self.instance is not None and self.instance.pk is not None:
                others = others.exclude(pk=self.instance.pk)
            if others.exists():
                raise forms.ValidationError(DUPLICATE_EMPLOYEE_ID_MESSAGE)
        return value


class RolesCheckboxWidget(forms.CheckboxSelectMultiple):
    """將 JSONField 的角色清單以 checkbox 呈現"""
    pass


class UserAdminForm(CaseInsensitiveEmployeeIdMixin, forms.ModelForm):
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


class UserAdminAddForm(CaseInsensitiveEmployeeIdMixin, UserCreationForm):
    class Meta(UserCreationForm.Meta):
        model = User
        fields = ("employee_id",)


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    form = UserAdminForm
    add_form = UserAdminAddForm
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
