@echo off
setlocal
cd /d "%~dp0backend"
if not exist "venv\Scripts\python.exe" (
  python -m venv venv
  if errorlevel 1 (
    echo Failed to create the Python virtual environment.
    pause
    exit /b 1
  )
)

"venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
  echo Failed to install backend requirements.
  pause
  exit /b 1
)

"venv\Scripts\python.exe" app.py
pause
