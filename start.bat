@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   QIP Dashboard - Starting...
echo ============================================
echo.
echo [1/3] Starting backend (PostgreSQL + Redis + Django API)...
docker-compose up -d
echo.
echo [2/3] Running database migrations...
timeout /t 5 /nobreak >nul
docker-compose exec api python manage.py migrate --noinput
docker-compose exec api python manage.py seed_indicators
echo.
echo [3/3] Starting Next.js frontend...
start "QIP-Frontend" /min cmd /c "cd /d "%~dp0" && set PORT=3000 && node node_modules\next\dist\bin\next dev -p 3000"
echo Waiting for frontend to start...
timeout /t 8 /nobreak >nul
start "" http://localhost:3000
echo.
echo ============================================
echo   Backend API:  http://localhost:8001
echo   Frontend UI:  http://localhost:3000
echo   Admin:        http://localhost:8001/admin/
echo ============================================
echo.
echo All services started. Frontend window is minimized.
echo Press any key to stop all services...
pause >nul
echo Shutting down...
docker-compose down
taskkill /f /fi "WINDOWTITLE eq QIP-Frontend" >nul 2>&1
taskkill /f /im node.exe >nul 2>&1
