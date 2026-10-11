@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   QIP Dashboard - Starting...
echo ============================================
echo.

echo [0/4] Cleaning up stale processes...
REM 殺掉殘留的 node 進程（避免 port 3000 衝突）
taskkill /f /im node.exe >nul 2>&1

echo [1/4] Building and starting backend containers...
docker-compose up -d
echo.
echo [2/4] Waiting for database to be ready...
timeout /t 8 /nobreak >nul

echo [3/4] Running migrations and seeding data...
REM Once the api image is rebuilt (docker-compose build api), its entrypoint runs "manage.py bootstrap" on every
REM start - wait for the database, create the schema, migrate, seed with --only-missing - and the commands below
REM find nothing left to do. They stay for the image that is running today, which has no entrypoint yet.
docker-compose exec api python manage.py migrate --noinput
REM seed_admin needs the initial admin password in the SEED_ADMIN_PASSWORD environment variable.
REM Set it in this console before running the script, with quotes:  set "SEED_ADMIN_PASSWORD=..."
REM and keep & ^ % ! out of the password (cmd treats them specially). It is NOT stored in the repo
REM and never printed. -e with the name only forwards the value untouched; if unset nothing is forwarded.
docker-compose exec -e SEED_ADMIN_PASSWORD api python manage.py seed_admin
REM --only-missing adds what is missing and leaves what an administrator changed alone (names, targets, indicators
REM that were switched off); without it every start would overwrite those changes.
docker-compose exec api python manage.py seed_entry_base --only-missing
docker-compose exec api python manage.py seed_indicators --only-missing
echo.
echo [4/4] Building frontend (production mode) and starting...
echo       (First build takes a few minutes; please wait)
REM 正式建置：所有頁面預先編譯，避免 dev 模式冷路由直連 404
call npm run build
if errorlevel 1 (
    echo Build failed - falling back to dev mode...
    start "QIP-Frontend" /min cmd /c "cd /d "%~dp0" && node node_modules\next\dist\bin\next dev -p 3000"
) else (
    start "QIP-Frontend" /min cmd /c "cd /d "%~dp0" && node node_modules\next\dist\bin\next start -p 3000"
)
echo Waiting for frontend to start...
timeout /t 10 /nobreak >nul
start "" http://localhost:3000/entry/login
echo.
echo ============================================
echo   Backend API:  http://localhost:8001
echo   Frontend UI:  http://localhost:3000
echo   Login:        http://localhost:3000/entry/login
echo   Admin:        http://localhost:8001/admin/
echo ============================================
echo.
echo   Login: admin
echo   首次登入請用 SEED_ADMIN_PASSWORD 設定的密碼，登入後須變更
echo.
echo All services started. Frontend window is minimized.
echo Press any key to stop all services...
pause >nul
echo Shutting down...
docker-compose down
taskkill /f /fi "WINDOWTITLE eq QIP-Frontend" >nul 2>&1
taskkill /f /im node.exe >nul 2>&1
