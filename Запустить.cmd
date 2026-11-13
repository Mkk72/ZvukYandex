@echo off
rem ZvukYandex: launch without installer. Builds only when dist is missing.
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

if exist "%~dp0node_modules\electron\dist\electron.exe" (
  if not exist "%~dp0dist\main\index.js" (
    echo   First launch: building...
    call npm run build
    if errorlevel 1 (
      echo.
      echo   Build failed. See the output above.
      echo.
      pause
      exit /b 1
    )
  )
  start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0." --no-sandbox
  exit /b 0
)

if exist "%~dp0release\win-unpacked\ZvukYandex.exe" (
  start "" "%~dp0release\win-unpacked\ZvukYandex.exe" --no-sandbox
  exit /b 0
)

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js LTS is required for the first launch: https://nodejs.org/en/download
  echo.
  pause
  exit /b 1
)

echo   Dependencies are missing, installing...
call npm install
if errorlevel 1 (
  echo   npm install failed. Check the internet connection and try again.
  pause
  exit /b 1
)
call npm run build
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0." --no-sandbox