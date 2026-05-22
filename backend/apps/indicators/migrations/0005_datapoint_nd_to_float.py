from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("indicators", "0004_datapointsubcategory"),
    ]

    operations = [
        migrations.AlterField(
            model_name="datapoint",
            name="numerator",
            field=models.FloatField(blank=True, null=True, verbose_name="分子"),
        ),
        migrations.AlterField(
            model_name="datapoint",
            name="denominator",
            field=models.FloatField(blank=True, null=True, verbose_name="分母"),
        ),
    ]
