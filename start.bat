@echo off
setlocal

cd /d "%~dp0"

if not exist "node_modules" (
  echo Устанавливаю зависимости...
  call npm install
  if errorlevel 1 (
    echo.
    echo Не удалось установить зависимости.
    pause
    exit /b 1
  )
)

echo Запускаю D-Pressed на локальной сети...
echo После запуска откройте на телефоне адрес Network, который покажет Vite.
echo Телефон и компьютер должны быть подключены к одной Wi-Fi сети.
call npm run dev -- --host 0.0.0.0

if errorlevel 1 (
  echo.
  echo Сервер завершился с ошибкой.
  pause
)
