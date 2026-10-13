"""
Lift the login lockout of one or more accounts, whatever case they are typed in.

django-axes records failed logins under the case-folded account name (see ``lockout.axes_username``), so the stock
``axes_reset_username <name>`` - an exact match - finds nothing for an employee id that has capital letters. This
command folds the name the same way before asking axes, and also forgets the change-password guess count
(``password_throttle``) of the matching local account(s), like the administrator's password reset does.

Usage:
  python manage.py unlock_account T123 [A456 ...]

Prints ``unlocked <name>: <n>`` (n = failed-login records removed) or ``no attempts for <name>``; exit code 0 either
way, also for a name that has no account.
"""
from django.core.management.base import BaseCommand

from apps.accounts import password_throttle
from apps.accounts.lockout import unlock_account
from apps.accounts.models import User


class Command(BaseCommand):
    help = "Lift the login lockout (django-axes failures) of accounts, case-insensitively"

    def add_arguments(self, parser):
        parser.add_argument("employee_id", nargs="+", help="account name(s) to unlock, in any letter case")

    def handle(self, *args, **options):
        for employee_id in options["employee_id"]:
            removed = unlock_account(employee_id)
            # The account may be spelled differently from the typed name; every case variant is cleared.
            for user in User.objects.filter(employee_id__iexact=employee_id.strip()):
                password_throttle.reset(user)
            if removed:
                self.stdout.write(f"unlocked {employee_id}: {removed}")
            else:
                self.stdout.write(f"no attempts for {employee_id}")
