"""
QIP 填報系統使用者帳號

擴充 Django AbstractUser，以帳號（employee_id）作為登入識別。
一個帳號可同時擁有多個角色。
"""
from django.contrib.auth.models import AbstractUser
from django.db import models


class UserRole(models.TextChoices):
    REPORTER = "reporter", "指標填報者"
    REVIEWER = "reviewer", "品管中心審核者"
    ADMIN = "admin", "系統管理員"


class User(AbstractUser):
    """
    自訂使用者模型。
    以 employee_id（帳號）取代 username 作為登入識別。
    """
    # 保留 username 欄位但設為非必填（AbstractUser 預設為必填）
    username = models.CharField("使用者名稱", max_length=150, blank=True)
    # 帳號：唯一識別，作為登入帳號
    employee_id = models.CharField("帳號", max_length=20, unique=True)
    full_name = models.CharField("姓名", max_length=50)
    # 所屬院區（nullable：管理員可能不屬於特定院區）
    campus = models.ForeignKey(
        "entry.Campus",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="所屬院區",
        related_name="users",
    )
    # 角色清單：儲存 UserRole.value 的列表，如 ["reporter", "reviewer"]
    roles = models.JSONField("角色", default=list)
    # 首次登入需改密碼
    must_change_password = models.BooleanField("需更改密碼", default=True)

    USERNAME_FIELD = "employee_id"
    # employee_id 以外的必填欄位（createsuperuser 時提示）
    REQUIRED_FIELDS = ["full_name", "email"]

    class Meta:
        db_table = "auth_users"
        verbose_name = "使用者"
        verbose_name_plural = "使用者"

    def __str__(self):
        return f"{self.employee_id} {self.full_name}"

    def has_role(self, role: str) -> bool:
        return role in self.roles

    @property
    def is_reporter(self) -> bool:
        return UserRole.REPORTER in self.roles

    @property
    def is_reviewer(self) -> bool:
        return UserRole.REVIEWER in self.roles

    @property
    def is_system_admin(self) -> bool:
        return UserRole.ADMIN in self.roles
