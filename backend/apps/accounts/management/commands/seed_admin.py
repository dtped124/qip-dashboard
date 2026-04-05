"""
建立預設管理員帳號 admin / Admin1234!
用法: python manage.py seed_admin
"""
from django.core.management.base import BaseCommand

from apps.accounts.models import User, UserRole


class Command(BaseCommand):
    help = "建立預設系統管理員帳號（若尚未存在）"

    def handle(self, *args, **options):
        employee_id = "admin"
        if User.objects.filter(employee_id=employee_id).exists():
            self.stdout.write(self.style.WARNING(f"帳號 '{employee_id}' 已存在，跳過建立。"))
            return

        user = User(
            employee_id=employee_id,
            full_name="系統管理員",
            email="admin@example.com",
            roles=[UserRole.ADMIN],
            is_staff=True,
            is_superuser=True,
            must_change_password=False,
        )
        user.set_password("Admin1234!")
        user.save()
        self.stdout.write(self.style.SUCCESS(f"已建立管理員帳號: {employee_id} / Admin1234!"))
