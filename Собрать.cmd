@echo off
rem ZvukYandex: сборка после правок в коде. Запуск — Запустить.cmd
setlocal
cd /d "%~dp0"

if not exist "%~dp0package.json" (
  echo.
  echo   Запустите "Собрать.cmd" из корня проекта — там, где лежит package.json.
  echo   Текущая папка: %~dp0
  echo.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Нужен Node.js LTS — его нет в PATH.
  echo   Скачать: https://nodejs.org/en/download
  echo.
  pause
  exit /b 1
)

if not exist "%~dp0node_modules" (
  echo   Ставлю зависимости...
  call npm install
  if errorlevel 1 (
    echo   npm install не удался.
    pause
    exit /b 1
  )
)

call npm run build
if errorlevel 1 (
  echo.
  echo   Сборка не удалась — смотрите ошибки выше.
  echo.
  pause
  exit /b 1
)

echo.
echo   Готово: dist\main\index.js обновлён. Запуск — Запустить.cmd
echo.
timeout /t 3 >nul
