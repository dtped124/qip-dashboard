from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("indicators", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="indicator",
            name="has_denominator",
            field=models.BooleanField(default=True, verbose_name="有分母"),
        ),
        migrations.AddField(
            model_name="indicator",
            name="entry_mode",
            field=models.CharField(
                choices=[("manual", "手動填報"), ("case_list", "個案清單審查")],
                default="manual",
                max_length=20,
                verbose_name="填報模式",
            ),
        ),
    ]
