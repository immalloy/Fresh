@echo off
REM ============================================================
REM FreshApp - Windows Launcher
REM ============================================================

echo.
echo ============================================================
echo   FreshApp Launcher
echo ============================================================
echo.
echo Starting FreshApp...
echo.

REM Change to script directory (repo root)
cd /d "%~dp0"

REM Check if build exists
if not exist "bin\Debug\net10.0\FreshApp.dll" (
    echo [INFO] Build not found. Running dotnet build...
    echo.
    dotnet build
    if errorlevel 1 (
        echo.
        echo [ERROR] Build failed. Please check the errors above.
        pause
        exit /b 1
    )
)

REM Run the application
echo [INFO] Launching FreshApp...
dotnet run --project FreshApp.csproj

REM If application exited with an error
if errorlevel 1 (
    echo.
    echo [ERROR] Application encountered an error.
    pause
    exit /b 1
)

echo.
echo [INFO] Application closed.
pause