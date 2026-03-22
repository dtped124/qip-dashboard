@echo off
cd /d "%~dp0"
set PORT=3000
start "" http://localhost:3000
npm run dev
pause
