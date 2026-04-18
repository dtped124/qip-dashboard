from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("indicators", "0002_indicator_entry_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="indicator",
            name="target_mode",
            field=models.BooleanField(default=False, verbose_name="挑戰平均值模式"),
        ),
        migrations.AddField(
            model_name="indicator",
            name="target_value",
            field=models.FloatField(blank=True, null=True, verbose_name="挑戰目標值"),
        ),
    ]
