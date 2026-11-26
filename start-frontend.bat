@echo off
setlocal
cd /d "%~dp0frontend"
where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js and npm were not found.
  echo Install the Node.js LTS version from https://nodejs.org/
  echo Then close this window and open the frontend launcher again.
  pause
  exit /b 1
)

call npm install
if errorlevel 1 (
  echo Failed to install frontend dependencies.
  pause
  exit /b 1
)

call npm run dev
if errorlevel 1 (
  echo Frontend server stopped with an error.
  pause
  exit /b 1
)
pause
