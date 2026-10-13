from django.apps import AppConfig


class AccountsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.accounts"
    verbose_name = "帳號管理"

    def ready(self):
        from apps.accounts import signals  # noqa: F401 - connects the user_logged_in receiver
