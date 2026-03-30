@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   QIP Dashboard - Starting...
echo ============================================
echo.
echo [1/4] Building and starting backend containers...
docker-compose up -d
echo.
echo [2/4] Waiting for database to be ready...
timeout /t 8 /nobreak >nul

echo [3/4] Running migrations and seeding data...
docker-compose exec api python manage.py migrate --noinput
docker-compose exec api python manage.py seed_entry_base
docker-compose exec api python manage.py seed_indicators
echo.
echo [4/4] Clearing Next.js cache and starting frontend...
if exist .next rmdir /s /q .next
start "QIP-Frontend" /min cmd /c "cd /d "%~dp0" && node node_modules\next\dist\bin\next dev -p 3000"
echo Waiting for frontend to start...
timeout /t 8 /nobreak >nul
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
