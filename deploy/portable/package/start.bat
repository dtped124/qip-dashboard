@echo off
rem QIP UAT portable package - start. Double-click; no administrator rights, no PowerShell, nothing is installed.
rem Set QIP_NO_BROWSER=1 to skip opening the browser (used by the automated check).
rem Messages are plain ASCII on purpose (no code page problems). The Chinese instructions are in the README txt.
setlocal EnableExtensions EnableDelayedExpansion
title QIP UAT - start

set "SYS=%SystemRoot%\System32"
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "PY=%ROOT%\runtime\python\python.exe"
set "PGBIN=%ROOT%\runtime\pgsql\bin"
set "PGDATA=%ROOT%\data\pgdata"
set "LAUNCHER=%ROOT%\app\launcher.py"
set "PGPORT_UAT=5499"
set "DJPORT="

echo.
echo ===== QIP UAT portable package =====
echo Folder: %ROOT%

rem ---- sanity checks ---------------------------------------------------------------------------------
if not exist "%PY%" (
  echo ERROR: runtime\python\python.exe not found. Was the zip extracted completely?
  goto :fail
)
if not exist "%PGBIN%\pg_ctl.exe" (
  echo ERROR: runtime\pgsql\bin\pg_ctl.exe not found. Was the zip extracted completely?
  goto :fail
)
if not exist "%ROOT%\logs" mkdir "%ROOT%\logs"
if not exist "%ROOT%\data" mkdir "%ROOT%\data"

if not "%ROOT%"=="%ROOT: =%" echo WARNING: the folder path contains a space. It usually works, but C:\qip-uat is safer.
if /I not "%ROOT:OneDrive=%"=="%ROOT%" echo WARNING: this folder is inside OneDrive. Sync can lock database files. Please use C:\qip-uat.
"%PY%" -X utf8 -c "import sys; sys.exit(0 if sys.argv[1].isascii() else 1)" "%ROOT%" >nul 2>&1
if errorlevel 1 echo WARNING: the folder path contains non-ASCII characters. It may work, but C:\qip-uat is safer.

rem ---- already running? (double-clicked twice) ---------------------------------------------------------
if exist "%ROOT%\data\django.pid" if exist "%ROOT%\data\django.port" (
  set "OLDPID="
  set "OLDPORT="
  set /p OLDPID=<"%ROOT%\data\django.pid"
  set /p OLDPORT=<"%ROOT%\data\django.port"
  "%SYS%\tasklist.exe" /FI "PID eq !OLDPID!" /NH 2>nul | "%SYS%\find.exe" /I "python.exe" >nul
  if not errorlevel 1 (
    echo Already running on port !OLDPORT!. Opening the browser.
    if not defined QIP_NO_BROWSER start "" "http://127.0.0.1:!OLDPORT!/entry/login/"
    goto :done
  )
  echo Removing stale Django pid files from an earlier run.
  del "%ROOT%\data\django.pid" "%ROOT%\data\django.port" >nul 2>&1
)

rem ---- which ports are taken? ---------------------------------------------------------------------------
"%SYS%\netstat.exe" -ano > "%ROOT%\logs\ports.tmp" 2>nul

for %%P in (8011 8012 8013 8014 8015) do (
  if not defined DJPORT (
    "%SYS%\findstr.exe" /R /C:":%%P .*LISTENING" "%ROOT%\logs\ports.tmp" >nul
    if errorlevel 1 set "DJPORT=%%P"
  )
)
if not defined DJPORT (
  echo ERROR: ports 8011-8015 are all in use by other programs. Close them and try again.
  goto :fail
)
if not "!DJPORT!"=="8011" echo NOTE: port 8011 is in use by another program, using port !DJPORT! instead.

rem ---- PostgreSQL ---------------------------------------------------------------------------------------
if exist "%PGDATA%\postmaster.pid" (
  set "PGPID="
  set /p PGPID=<"%PGDATA%\postmaster.pid"
  "%SYS%\tasklist.exe" /FI "PID eq !PGPID!" /NH 2>nul | "%SYS%\find.exe" /I "postgres.exe" >nul
  if errorlevel 1 (
    echo Removing stale postmaster.pid from an unclean shutdown.
    del "%PGDATA%\postmaster.pid" >nul 2>&1
  )
)

"%PGBIN%\pg_ctl.exe" -D "%PGDATA%" status >nul 2>&1
if errorlevel 1 (
  "%SYS%\findstr.exe" /R /C:":%PGPORT_UAT% .*LISTENING" "%ROOT%\logs\ports.tmp" >nul
  if not errorlevel 1 (
    echo ERROR: port %PGPORT_UAT% is used by another program - maybe another copy of this package.
    echo        Run stop.bat of the other copy first, then start again.
    goto :fail
  )
  echo Starting the database ^(PostgreSQL, 127.0.0.1:%PGPORT_UAT%^) ...
  "%PGBIN%\pg_ctl.exe" -D "%PGDATA%" -o "-p %PGPORT_UAT% -h 127.0.0.1" -l "%ROOT%\logs\postgres.log" -w -t 60 start >> "%ROOT%\logs\pg_ctl.log" 2>&1
  if errorlevel 1 (
    echo ERROR: the database did not start. See logs\postgres.log and logs\pg_ctl.log
    goto :fail
  )
) else (
  echo The database is already running.
)

rem ---- migrate / seed (idempotent; normally nothing to do) ------------------------------------------------
set "DJANGO_SETTINGS_MODULE=config.settings.prod"
set "FRONTEND_DIST_DIR=%ROOT%\app\web\out"
set "SEED_ADMIN_PASSWORD="
echo Checking the database ...
"%PY%" -X utf8 "%LAUNCHER%" manage bootstrap >> "%ROOT%\logs\bootstrap.log" 2>&1
if errorlevel 1 (
  echo ERROR: bootstrap failed. See logs\bootstrap.log
  goto :fail
)

rem ---- web server -------------------------------------------------------------------------------------------
echo Starting the web server on port !DJPORT! ...
start "QIP-UAT-Django (do not close; use stop.bat)" /min "%PY%" -X utf8 "%LAUNCHER%" serve --port !DJPORT!
"%PY%" -X utf8 "%LAUNCHER%" health --port !DJPORT! --timeout 60
if errorlevel 1 (
  echo ERROR: the web server did not answer. See logs\django.log
  goto :fail
)

if not defined QIP_NO_BROWSER start "" "http://127.0.0.1:!DJPORT!/entry/login/"
echo.
echo Started. The login page opens in your browser: http://127.0.0.1:!DJPORT!/entry/login/
echo When you are finished, run stop.bat in this folder.
goto :done

:fail
echo.
echo Start-up failed. Please send the whole "logs" folder to the QC center.
del "%ROOT%\logs\ports.tmp" >nul 2>&1
pause
exit /b 1

:done
del "%ROOT%\logs\ports.tmp" >nul 2>&1
echo.
pause
exit /b 0
