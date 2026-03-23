@echo off
chcp 437 >nul
cd /d "%~dp0"

echo ============================================================
echo   QIP Dashboard - Django + PostgreSQL + Streamlit
echo   Hsinchu NTUH Quality Management Center
echo ============================================================
echo.

:: Check Docker
where docker >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker is not installed or not in PATH.
    echo         Please install Docker Desktop first.
    echo         https://www.docker.com/products/docker-desktop
    pause
    exit /b 1
)

:: Check Docker daemon
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker daemon is not running.
    echo         Please start Docker Desktop first.
    pause
    exit /b 1
)

echo [1/4] Starting PostgreSQL + Redis ...
docker-compose up -d postgres redis
if %errorlevel% neq 0 (
    echo [ERROR] Failed to start database services.
    pause
    exit /b 1
)

echo.
echo [2/4] Building and starting Django + Streamlit ...
docker-compose up -d --build web streamlit
if %errorlevel% neq 0 (
    echo [ERROR] Failed to start application services.
    pause
    exit /b 1
)

echo.
echo [3/4] Waiting for database to be ready ...
timeout /t 5 /nobreak >nul

echo.
echo [4/4] Running database migrations and seeding ...
docker-compose exec -T web python manage.py migrate --noinput
docker-compose exec -T web python manage.py seed_indicators

echo.
echo ============================================================
echo   All services are running!
echo.
echo   Django Admin : http://localhost:8001/admin/
echo   Streamlit    : http://localhost:8501/
echo   API          : http://localhost:8001/api/v1/indicators/
echo.
echo   To stop all services:  docker-compose down
echo   To view logs:          docker-compose logs -f
echo ============================================================
echo.

start "" http://localhost:8501/
pause
