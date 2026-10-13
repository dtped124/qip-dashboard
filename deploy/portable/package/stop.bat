@echo off
rem QIP UAT portable package - stop. Closes the web server and the database of THIS folder.
setlocal EnableExtensions EnableDelayedExpansion
title QIP UAT - stop

set "SYS=%SystemRoot%\System32"
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "PY=%ROOT%\runtime\python\python.exe"
set "LAUNCHER=%ROOT%\app\launcher.py"
set "PGBIN=%ROOT%\runtime\pgsql\bin"
set "PGDATA=%ROOT%\data\pgdata"

echo.
echo ===== QIP UAT portable package - stop =====

rem ---- web server: only a python.exe from THIS folder's runtime\ is ended (launcher.py stop checks the
rem      executable path of the pid in data\django.pid, or of the listener on ports 8011-8015 when there is no pid file)
if exist "%PY%" (
  "%PY%" -X utf8 "%LAUNCHER%" stop
) else (
  echo ERROR: runtime\python\python.exe not found; the web server was not stopped.
)

rem ---- database ---------------------------------------------------------------------------------------------
if exist "%PGBIN%\pg_ctl.exe" (
  "%PGBIN%\pg_ctl.exe" -D "%PGDATA%" status >nul 2>&1
  if errorlevel 1 (
    echo The database was not running.
  ) else (
    "%PGBIN%\pg_ctl.exe" -D "%PGDATA%" -m fast -w -t 60 stop > "%ROOT%\logs\pg_stop.log" 2>&1
    "%PGBIN%\pg_ctl.exe" -D "%PGDATA%" status >nul 2>&1
    if errorlevel 1 (echo Database stopped.) else (echo WARNING: the database is still running. See logs\pg_stop.log)
  )
)

echo.
echo Stopped. You can close this window. To remove the test copy, delete this whole folder.
echo.
pause
exit /b 0
