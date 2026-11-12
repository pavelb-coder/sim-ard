@echo off
chcp 65001 >nul
rem Локальный запуск RoboSim — http://localhost:8000
rem Нужен только Python 3 (или Node.js): https://www.python.org/downloads/
cd /d "%~dp0"
set PORT=8000

where python >nul 2>nul
if %errorlevel%==0 (
  start "RoboSim — сервер" cmd /k python -m http.server %PORT%
  timeout /t 2 >nul
  start "" http://localhost:%PORT%
  exit /b
)

where py >nul 2>nul
if %errorlevel%==0 (
  start "RoboSim — сервер" cmd /k py -m http.server %PORT%
  timeout /t 2 >nul
  start "" http://localhost:%PORT%
  exit /b
)

where npx >nul 2>nul
if %errorlevel%==0 (
  start "RoboSim — сервер" cmd /k npx --yes serve -l %PORT% .
  timeout /t 2 >nul
  start "" http://localhost:%PORT%
  exit /b
)

echo Не найден Python 3 или Node.js.
echo Поставьте Python: https://www.python.org/downloads/ (при установке включите "Add python.exe to PATH").
pause
