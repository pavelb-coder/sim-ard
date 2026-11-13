@echo off
chcp 65001 >nul
rem Локальный запуск RoboSim — http://localhost:8000
rem Нужен Python 3 или Node.js: https://www.python.org/downloads/
rem
rem   start.bat            порт 8000
rem   start.bat 9000       другой порт
setlocal
cd /d "%~dp0"
set PORT=%1
if "%PORT%"=="" set PORT=8000
set URL=http://localhost:%PORT%/

rem py -3 — самый надёжный вариант; обычный python может оказаться заглушкой
rem из Microsoft Store, поэтому проверяем, что он действительно запускается.
where py >nul 2>nul && py -3 -c "import sys" >nul 2>nul && goto :run_py
where python >nul 2>nul && python -c "import sys" >nul 2>nul && goto :run_python
where npx >nul 2>nul && goto :run_npx

echo Не найден Python 3 или Node.js.
echo Поставьте Python: https://www.python.org/downloads/
echo При установке включите галочку "Add python.exe to PATH".
pause
exit /b 1

:run_py
set PYCMD=py -3
goto :serve

:run_python
set PYCMD=python
goto :serve

:run_npx
echo RoboSim -^> %URL%   (закрыть окно сервера = остановить)
start "RoboSim - сервер" cmd /k npx --yes serve -l %PORT% .
timeout /t 2 >nul
start "" %URL%
exit /b 0

:serve
echo RoboSim -^> %URL%   (закрыть окно сервера = остановить)
start "RoboSim - сервер" cmd /k %PYCMD% -m http.server %PORT%
timeout /t 2 >nul
start "" %URL%
exit /b 0
