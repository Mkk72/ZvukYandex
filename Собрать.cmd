@echo off
rem ZvukYandex: rebuild after code changes. Launch with ?????????.cmd
setlocal
cd /d "%~dp0"

if not exist "%~dp0package.json" (
  echo.
  echo   Run this file from the project root where package.json is located.
  echo   Current folder: %~dp0
  echo.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js LTS is required: https://nodejs.org/en/download
  echo.
  pause
  exit /b 1
)

if not exist "%~dp0node_modules" (
  echo   Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo   npm install failed.
    pause
    exit /b 1
  )
)

call npm run build
if errorlevel 1 (
  echo.
  echo   Build failed - see the errors above.
  echo.
  pause
  exit /b 1
)

echo.
echo   Done: dist\main\index.js updated. Launch with ?????????.cmd
echo.
timeout /t 3 >nul