@echo off
rem QIP UAT portable package - stop. Closes the web server and the database of THIS folder.
setlocal EnableExtensions EnableDelayedExpansion
title QIP UAT - stop

set "SYS=%SystemRoot%\System32"
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "PGBIN=%ROOT%\runtime\pgsql\bin"
set "PGDATA=%ROOT%\data\pgdata"

echo.
echo ===== QIP UAT portable package - stop =====

rem ---- web server: by pid file, else by the listening port ------------------------------------------------
if exist "%ROOT%\data\django.pid" (
  set "DJPID="
  set /p DJPID=<"%ROOT%\data\django.pid"
  if defined DJPID (
    "%SYS%\taskkill.exe" /PID !DJPID! /T /F >nul 2>&1
    if not errorlevel 1 (echo Web server stopped ^(pid !DJPID!^).) else (echo Web server was not running ^(pid !DJPID!^).)
  )
  del "%ROOT%\data\django.pid" >nul 2>&1
  del "%ROOT%\data\django.port" >nul 2>&1
) else (
  echo No pid file; looking for a python.exe that listens on ports 8011-8015 ...
  for %%P in (8011 8012 8013 8014 8015) do (
    for /f "tokens=5" %%A in ('"%SYS%\netstat.exe" -ano ^| "%SYS%\findstr.exe" /R /C:":%%P .*LISTENING"') do (
      "%SYS%\tasklist.exe" /FI "PID eq %%A" /NH 2>nul | "%SYS%\find.exe" /I "python.exe" >nul
      if not errorlevel 1 (
        "%SYS%\taskkill.exe" /PID %%A /T /F >nul 2>&1
        echo Stopped python.exe pid %%A that listened on port %%P.
      )
    )
  )
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
