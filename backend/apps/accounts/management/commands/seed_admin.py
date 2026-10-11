"""
建立 / 重設初始系統管理員帳號 admin

密碼不寫在程式裡，也不會被印出來；來源（擇一，--password 優先）：
  --password "..."                      # 會留在 shell 歷史與程序清單，正式環境請改用環境變數
  環境變數 SEED_ADMIN_PASSWORD           # start.bat / docker-compose 會轉送此變數

密碼必須通過 AUTH_PASSWORD_VALIDATORS（至少 10 字元、不得太常見、不得全為數字、不得與帳號太相似）。
建立或重設後 must_change_password=True：第一次登入必須先變更密碼。

用法:
  SEED_ADMIN_PASSWORD=... python manage.py seed_admin           # 不存在才建，已存在則跳過（exit 0）
  SEED_ADMIN_PASSWORD=... python manage.py seed_admin --reset   # 重設已存在的 admin：新密碼、啟用、
                                                                #   補回管理員身分、清除登入鎖定
  python manage.py seed_admin --password "..." [--reset]        # 直接指定密碼
"""
import os

from django.core.management.base import BaseCommand, CommandError

from apps.accounts.lockout import unlock_account
from apps.accounts.models import User, UserRole
from apps.accounts.passwords import password_problems

PASSWORD_ENV_VAR = "SEED_ADMIN_PASSWORD"
EMPLOYEE_ID = "admin"
FULL_NAME = "系統管理員"
EMAIL = "admin@example.com"


class Command(BaseCommand):
    help = "建立或重設初始系統管理員帳號（密碼來自 --password 或環境變數 SEED_ADMIN_PASSWORD）"

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset",
            action="store_true",
            help="若帳號已存在，重設密碼、啟用帳號、補回管理員身分並清除登入鎖定",
        )
        parser.add_argument(
            "--password",
            default=None,
            help=f"管理員密碼（未指定時讀取環境變數 {PASSWORD_ENV_VAR}）",
        )

    def handle(self, *args, **options):
        reset = options["reset"]

        existing = User.objects.filter(employee_id=EMPLOYEE_ID).first()
        if existing and not reset:
            self.stdout.write(self.style.WARNING(
                f"帳號 '{EMPLOYEE_ID}' 已存在，跳過。要重設密碼請加 --reset"
            ))
            return

        password = options["password"] or os.environ.get(PASSWORD_ENV_VAR, "")
        if not password:
            raise CommandError(
                f"建立或重設 '{EMPLOYEE_ID}' 需要密碼：請用 --password 指定，或設定環境變數 {PASSWORD_ENV_VAR}"
            )

        user = existing or User(employee_id=EMPLOYEE_ID, full_name=FULL_NAME, email=EMAIL)
        problems = password_problems(password, user)
        if problems:
            raise CommandError("管理員密碼不符合密碼規則：\n  - " + "\n  - ".join(problems))

        roles = list(user.roles) if isinstance(user.roles, list) else []
        if UserRole.ADMIN not in roles:
            roles.append(UserRole.ADMIN.value)
        user.roles = roles
        user.is_active = True
        user.is_staff = True
        user.is_superuser = True
        # The password came from outside the app (a shell, an env file): make the first login replace it.
        user.must_change_password = True
        user.set_password(password)
        user.save()

        if existing:
            unlock_account(EMPLOYEE_ID)
            self.stdout.write(self.style.SUCCESS(
                f"[OK] 已重設管理員 '{EMPLOYEE_ID}' 的密碼並清除登入鎖定；下次登入須先變更密碼"
            ))
        else:
            self.stdout.write(self.style.SUCCESS(
                f"[OK] 已建立管理員帳號 '{EMPLOYEE_ID}'；第一次登入須先變更密碼"
            ))
