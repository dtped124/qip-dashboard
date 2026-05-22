"""
建立 / 重設預設管理員帳號 admin / Admin1234!

用法:
  python manage.py seed_admin             # 不存在才建，已存在則跳過
  python manage.py seed_admin --reset     # 強制重設密碼回 Admin1234!（含解鎖、清除「必須變更密碼」旗標）
  python manage.py seed_admin --password "新密碼"  # 自訂密碼（搭配 --reset）
"""
from django.core.management.base import BaseCommand

from apps.accounts.models import User, UserRole


DEFAULT_PASSWORD = "Admin1234!"


class Command(BaseCommand):
    help = "建立或重設預設系統管理員帳號"

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset",
            action="store_true",
            help="若帳號已存在，強制重設密碼並解除鎖定 / 必須變更密碼旗標",
        )
        parser.add_argument(
            "--password",
            default=DEFAULT_PASSWORD,
            help=f"指定新密碼（預設 {DEFAULT_PASSWORD}）",
        )

    def handle(self, *args, **options):
        employee_id = "admin"
        password = options["password"]
        reset = options["reset"]

        existing = User.objects.filter(employee_id=employee_id).first()
        if existing:
            if not reset:
                self.stdout.write(self.style.WARNING(
                    f"帳號 '{employee_id}' 已存在，跳過。要強制重設請加 --reset"
                ))
                return

            existing.set_password(password)
            existing.is_active = True
            existing.is_staff = True
            existing.is_superuser = True
            existing.must_change_password = False
            # 確保 roles 包含 ADMIN（避免之前被改掉）
            roles = list(existing.roles or [])
            if UserRole.ADMIN not in roles:
                roles.append(UserRole.ADMIN)
            existing.roles = roles
            existing.save()
            self.stdout.write(self.style.SUCCESS(
                f"[OK]已重設管理員 '{employee_id}'，密碼: {password}（roles={roles}，is_active=True）"
            ))
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
        user.set_password(password)
        user.save()
        self.stdout.write(self.style.SUCCESS(
            f"[OK]已建立管理員帳號: {employee_id} / {password}"
        ))
