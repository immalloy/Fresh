@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%" >nul

where dotnet >nul 2>&1
if errorlevel 1 (
    echo [ERROR] dotnet was not found on PATH.
    echo         Install .NET SDK from https://dotnet.microsoft.com/download
    popd >nul
    exit /b 1
)

for /f %%A in ('dotnet --list-sdks 2^>nul') do set "HAS_SDK=1"
if not defined HAS_SDK (
    echo [ERROR] No .NET SDK found. The app cannot be built or run.
    echo         Install .NET SDK from https://dotnet.microsoft.com/download
    popd >nul
    exit /b 1
)

echo Starting FreshApp...
dotnet run --project "FreshApp.csproj"
set "EXIT_CODE=%ERRORLEVEL%"

popd >nul
exit /b %EXIT_CODE%
