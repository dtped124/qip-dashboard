@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   QIP Dashboard - Starting...
echo ============================================
echo.

echo [0/4] Cleaning up stale processes...
REM 停掉可能衝突的 backend/docker-compose 容器
docker-compose -f backend\docker-compose.yml down >nul 2>&1
REM 殺掉殘留的 node 進程（避免 port 3000 衝突）
taskkill /f /im node.exe >nul 2>&1

echo [1/4] Building and starting backend containers...
docker-compose up -d
echo.
echo [2/4] Waiting for database to be ready...
timeout /t 8 /nobreak >nul

echo [3/4] Running migrations and seeding data...
docker-compose exec api python manage.py migrate --noinput
docker-compose exec api python manage.py seed_admin
docker-compose exec api python manage.py seed_entry_base
docker-compose exec api python manage.py seed_indicators
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
echo   Login: admin  /  Password: Admin1234!
echo.
echo All services started. Frontend window is minimized.
echo Press any key to stop all services...
pause >nul
echo Shutting down...
docker-compose down
taskkill /f /fi "WINDOWTITLE eq QIP-Frontend" >nul 2>&1
taskkill /f /im node.exe >nul 2>&1
