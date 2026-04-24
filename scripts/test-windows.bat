@echo off
setlocal

cd /d "%~dp0.."

where npm >nul 2>&1
if errorlevel 1 (
  echo [Fresh] npm was not found in PATH.
  echo Install Node.js first: https://nodejs.org/
  exit /b 1
)

if not exist "node_modules" (
  echo [Fresh] Installing dependencies...
  call npm.cmd install
  if errorlevel 1 (
    echo [Fresh] Failed to install dependencies.
    exit /b 1
  )
)

echo [Fresh] Launching Tauri dev app...
call npm.cmd run tauri:dev
set "APP_EXIT=%ERRORLEVEL%"

echo.
echo [Fresh] Tauri dev command exited with code %APP_EXIT%.

exit /b %APP_EXIT%
