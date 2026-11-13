@echo off
rem ZvukYandex: запуск без установщика. Ничего не собирает — только запускает.
rem Собрать после правок в коде: Собрать.cmd
setlocal
cd /d "%~dp0"

if not exist "%~dp0package.json" (
  echo.
  echo   Запустите "Запустить.cmd" из корня проекта — там, где лежит package.json.
  echo   Текущая папка: %~dp0
  echo.
  pause
  exit /b 1
)

if exist "%~dp0node_modules\electron\dist\electron.exe" (
  if not exist "%~dp0dist\main\index.js" (
    echo   Первый запуск: собираю...
    call npm run build
    if errorlevel 1 (
      echo.
      echo   Сборка не удалась. Подробности — в выводе выше.
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
  echo   Для первого запуска нужен Node.js LTS — его нет в PATH.
  echo   Скачать: https://nodejs.org/en/download  ^(msi, установить с галочкой Add to PATH^)
  echo   После установки снова запустите этот файл.
  echo.
  pause
  exit /b 1
)

echo   Зависимостей нет, ставлю (это один раз)...
call npm install
if errorlevel 1 (
  echo.
  echo   npm install не удался. Проверьте доступ в интернет и повторите.
  echo   Node.js: https://nodejs.org/en/download
  echo.
  pause
  exit /b 1
)
call npm run build
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0." --no-sandbox
