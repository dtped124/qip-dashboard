import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    """
    第二步：加上 campus FK（等 entry.Campus 建好之後）
    """
    dependencies = [
        ("accounts", "0001_initial"),
        ("entry", "0001_initial"),   # entry 的 Campus 必須先存在
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="campus",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="users",
                to="entry.campus",
                verbose_name="所屬院區",
            ),
        ),
    ]
