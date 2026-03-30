import django.contrib.auth.models
import django.contrib.auth.validators
import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("auth", "0012_alter_user_first_name_max_length"),
        # entry.Campus は後で定義するため、accounts は entry に依存しない
        # Campus FK は entry migration で追加
    ]

    operations = [
        migrations.CreateModel(
            name="User",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("password", models.CharField(max_length=128, verbose_name="password")),
                ("last_login", models.DateTimeField(blank=True, null=True, verbose_name="last login")),
                ("is_superuser", models.BooleanField(
                    default=False,
                    help_text="Designates that this user has all permissions without explicitly assigning them.",
                    verbose_name="superuser status",
                )),
                ("first_name", models.CharField(blank=True, max_length=150, verbose_name="first name")),
                ("last_name", models.CharField(blank=True, max_length=150, verbose_name="last name")),
                ("is_staff", models.BooleanField(
                    default=False,
                    help_text="Designates whether the user can log into this admin site.",
                    verbose_name="staff status",
                )),
                ("is_active", models.BooleanField(
                    default=True,
                    help_text="Designates whether this user should be treated as active.",
                    verbose_name="active",
                )),
                ("date_joined", models.DateTimeField(default=django.utils.timezone.now, verbose_name="date joined")),
                ("username", models.CharField(blank=True, max_length=150, verbose_name="使用者名稱")),
                ("employee_id", models.CharField(max_length=20, unique=True, verbose_name="工號")),
                ("full_name", models.CharField(max_length=50, verbose_name="姓名")),
                ("email", models.EmailField(blank=True, max_length=254, verbose_name="email address")),
                ("roles", models.JSONField(default=list, verbose_name="角色")),
                ("groups", models.ManyToManyField(
                    blank=True,
                    help_text="The groups this user belongs to.",
                    related_name="user_set",
                    related_query_name="user",
                    to="auth.group",
                    verbose_name="groups",
                )),
                ("user_permissions", models.ManyToManyField(
                    blank=True,
                    help_text="Specific permissions for this user.",
                    related_name="user_set",
                    related_query_name="user",
                    to="auth.permission",
                    verbose_name="user permissions",
                )),
            ],
            options={
                "verbose_name": "使用者",
                "verbose_name_plural": "使用者",
                "db_table": "auth_users",
            },
            managers=[
                ("objects", django.contrib.auth.models.UserManager()),
            ],
        ),
    ]
