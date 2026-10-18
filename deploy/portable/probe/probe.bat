@echo off
rem ============================================================================
rem  QIP probe: can this PC run (1) embedded Python, (2) compiled Python wheels,
rem  (3) a portable PostgreSQL?   No admin rights, no installation, nothing is
rem  written outside this folder.  Result: probe-result.txt (same folder).
rem  Usage: double-click.  "probe.bat nopause" skips the final pause.
rem ============================================================================
setlocal EnableExtensions
set "ROOT=%~dp0"
set "RES=%ROOT%probe-result.txt"
set "STEP=%ROOT%probe-step.tmp"
rem the server inherits the redirect handle of "pg_ctl start", so that step gets its own temp file
set "STEP2=%ROOT%probe-start.tmp"
set "PYEXE=%ROOT%runtime\python\python.exe"
set "PGBIN=%ROOT%runtime\pgsql\bin"
set "PGDATA=%ROOT%probe-pgdata"
set "PGLOG=%ROOT%probe-pg.log"
set "PGPORT_PROBE=5499"
set "R_PYTHON=NOT-RUN"
set "R_IMPORTS=NOT-RUN"
set "R_INITDB=NOT-RUN"
set "R_START=NOT-RUN"
set "R_QUERY=NOT-RUN"
set "R_STOP=NOT-RUN"
set "R_PYCONN=NOT-RUN"

call :log "============================================================"
call :log "QIP PROBE RUN"
call :log "============================================================"
call :log "Date/time : %date% %time%"
call :log "Folder    : %ROOT%"
call :log "Computer  : %COMPUTERNAME%"
call :log "User      : %USERDOMAIN%\%USERNAME%"
for /f "delims=" %%V in ('ver') do set "OSVER=%%V"
call :log "OS ver    : %OSVER%"
whoami > "%STEP%" 2>&1
call :logfile "whoami    :"
whoami /groups 2>nul | findstr /c:"Mandatory Label" > "%STEP%" 2>&1
call :logfile "Integrity :"
net session >nul 2>&1
if errorlevel 1 (call :log "IS_ADMIN  : NO  (expected)") else (call :log "IS_ADMIN  : YES (the probe still does not need it)")
if exist "%SystemRoot%\System32\msvcp140.dll" (call :log "SYSTEM msvcp140.dll     : present") else (call :log "SYSTEM msvcp140.dll     : MISSING")
if exist "%SystemRoot%\System32\vcruntime140.dll" (call :log "SYSTEM vcruntime140.dll  : present") else (call :log "SYSTEM vcruntime140.dll  : MISSING")
if exist "%SystemRoot%\System32\vcruntime140_1.dll" (call :log "SYSTEM vcruntime140_1.dll: present") else (call :log "SYSTEM vcruntime140_1.dll: MISSING")
if exist "%ROOT%runtime\python\python.exe" (call :log "pack python.exe          : present") else (call :log "pack python.exe          : MISSING (zip not fully extracted?)")
if exist "%PGBIN%\postgres.exe" (call :log "pack postgres.exe        : present") else (call :log "pack postgres.exe        : MISSING (zip not fully extracted?)")
call :log ""

rem ---------------------------------------------------------------- 1. Python
call :log "--- [1/3] Embedded Python ---"
"%PYEXE%" -c "import sys; print(sys.version)" > "%STEP%" 2>&1
set "RC=%errorlevel%"
call :logfile ""
if "%RC%"=="0" (set "R_PYTHON=OK") else (set "R_PYTHON=FAIL (exit %RC%)")
call :log "PYTHON: %R_PYTHON%"
call :log ""

rem ---------------------------------------------------------------- 2. Python imports
call :log "--- [2/3] Python compiled packages ---"
"%PYEXE%" -c "import numpy, psycopg, ldap3; print('numpy', numpy.__version__, 'psycopg', psycopg.__version__, 'ldap3', ldap3.__version__); print('numpy sum check', float(numpy.arange(6.0).reshape(2,3).sum()), '(expect 15.0)'); print('psycopg impl', psycopg.pq.__impl__)" > "%STEP%" 2>&1
set "RC=%errorlevel%"
call :logfile ""
if "%RC%"=="0" (set "R_IMPORTS=OK") else (set "R_IMPORTS=FAIL (exit %RC%)")
call :log "PYTHON_IMPORTS: %R_IMPORTS%"
call :log ""

rem ---------------------------------------------------------------- 3. PostgreSQL
call :log "--- [3/3] Portable PostgreSQL ---"
rem clean leftovers of an earlier run (stop an old instance first, only if it is ours)
if exist "%PGDATA%\postmaster.pid" "%PGBIN%\pg_ctl.exe" -D "%PGDATA%" -m immediate stop >nul 2>&1
call :rmpgdata
if exist "%PGLOG%" del /q "%PGLOG%" >nul 2>&1

"%PGBIN%\initdb.exe" -D "%PGDATA%" -U qip -A trust -E UTF8 --no-locale > "%STEP%" 2>&1
set "RC=%errorlevel%"
if "%RC%"=="0" (set "R_INITDB=OK") else (set "R_INITDB=FAIL (exit %RC%)")
if not "%RC%"=="0" call :logfile "initdb output:"
call :log "PG_INITDB: %R_INITDB%"
if not "%RC%"=="0" goto :pg_done

"%PGBIN%\pg_ctl.exe" -D "%PGDATA%" -o "-p %PGPORT_PROBE% -h 127.0.0.1" -l "%PGLOG%" -w start > "%STEP2%" 2>&1
set "RC=%errorlevel%"
if "%RC%"=="0" (set "R_START=OK") else (set "R_START=FAIL (exit %RC%)")
if not "%RC%"=="0" type "%STEP2%"
if not "%RC%"=="0" type "%STEP2%" >> "%RES%"
call :log "PG_START: %R_START%"
if not "%RC%"=="0" goto :pg_done

"%PGBIN%\psql.exe" -h 127.0.0.1 -p %PGPORT_PROBE% -U qip -d postgres -c "select version()" > "%STEP%" 2>&1
set "RC=%errorlevel%"
call :logfile ""
if "%RC%"=="0" (set "R_QUERY=OK") else (set "R_QUERY=FAIL (exit %RC%)")
call :log "PG_QUERY: %R_QUERY%"

rem extra (informational): can the packaged Python reach the packaged PostgreSQL via psycopg?
if not "%R_IMPORTS%"=="OK" goto :pg_done
"%PYEXE%" -c "import psycopg; c = psycopg.connect(host='127.0.0.1', port=%PGPORT_PROBE%, user='qip', dbname='postgres'); print(c.execute('select 1+1').fetchone()); c.close()" > "%STEP%" 2>&1
if errorlevel 1 (set "R_PYCONN=FAIL") else (set "R_PYCONN=OK")
call :logfile ""
call :log "PG_PYTHON_CONNECT (extra): %R_PYCONN%"

:pg_done
rem always stop the server if we started it
if not "%R_START%"=="OK" goto :pg_after_stop
"%PGBIN%\pg_ctl.exe" -D "%PGDATA%" -w stop > "%STEP%" 2>&1
set "RC=%errorlevel%"
if "%RC%"=="0" (set "R_STOP=OK") else (set "R_STOP=FAIL (exit %RC%)")
if not "%RC%"=="0" call :logfile "pg_ctl stop output:"
:pg_after_stop
rem a start that failed or timed out may still have left a server behind: stop it quietly
if not "%R_START%"=="OK" if exist "%PGDATA%\postmaster.pid" "%PGBIN%\pg_ctl.exe" -D "%PGDATA%" -m immediate stop >nul 2>&1
call :log "PG_STOP: %R_STOP%"

set "R_PG=FAIL"
if "%R_INITDB%"=="OK" if "%R_START%"=="OK" if "%R_QUERY%"=="OK" if "%R_STOP%"=="OK" set "R_PG=OK"

if "%R_PG%"=="OK" (
  call :rmpgdata
  if exist "%PGDATA%" (call :log "WARNING: probe-pgdata could not be removed - please delete it by hand.") else (call :log "probe-pgdata removed.")
) else (
  call :log "PostgreSQL failed - keeping probe-pgdata and probe-pg.log for diagnosis. Last 20 lines of probe-pg.log:"
  call :tail20
)
if exist "%STEP%" del /q "%STEP%" >nul 2>&1
if exist "%STEP2%" del /q "%STEP2%" >nul 2>&1

call :log ""
call :log "============================== SUMMARY =============================="
call :log "1. PYTHON         : %R_PYTHON%"
call :log "2. PYTHON_IMPORTS : %R_IMPORTS%"
call :log "3. POSTGRESQL     : %R_PG%   (initdb %R_INITDB% / start %R_START% / query %R_QUERY% / stop %R_STOP%)"
call :log "====================================================================="
call :log "DONE.  Please send the file probe-result.txt (in this folder) back to the QC center."
call :log ""
if /i "%~1"=="nopause" goto :eof
pause
goto :eof

rem ---------------------------------------------------------------- helpers
:log
echo(%~1
>>"%RES%" echo(%~1
goto :eof

:logfile
rem  prints (and appends) the temp file; %~1 = optional heading line
if not "%~1"=="" call :log "%~1"
if not exist "%STEP%" goto :eof
type "%STEP%"
type "%STEP%" >> "%RES%"
goto :eof

:rmpgdata
rem  remove probe-pgdata; retry a few times because postgres.exe may need a moment to release its files
set "TRIES=0"
:rmpgdata_loop
if not exist "%PGDATA%" goto :eof
rmdir /s /q "%PGDATA%" >nul 2>&1
if not exist "%PGDATA%" goto :eof
set /a TRIES+=1
if %TRIES% GEQ 5 goto :eof
ping -n 3 127.0.0.1 >nul
goto :rmpgdata_loop

:tail20
if not exist "%PGLOG%" (call :log "(probe-pg.log does not exist)" & goto :eof)
set "SKIP=0"
for /f %%A in ('find /c /v "" ^< "%PGLOG%"') do set /a SKIP=%%A-20
if %SKIP% LSS 0 set "SKIP=0"
more +%SKIP% "%PGLOG%" > "%STEP%" 2>&1
call :logfile ""
goto :eof
