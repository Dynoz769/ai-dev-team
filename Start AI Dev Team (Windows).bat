@echo off
title AI Dev Team
cd /d "%~dp0"
echo.
echo   AI Dev Team
echo   ===========
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js is not installed yet.
  echo   Opening the download page: install the "LTS" version, then double-click this file again.
  start "" "https://nodejs.org/en/download"
  echo.
  pause
  exit /b 1
)

node -e "process.exit(+process.versions.node.split('.')[0] < 22 ? 1 : 0)"
if errorlevel 1 (
  echo   Your Node.js is too old. Version 22 or newer is needed.
  echo   Opening the download page: install the "LTS" version, then double-click this file again.
  start "" "https://nodejs.org/en/download"
  echo.
  pause
  exit /b 1
)

where git >nul 2>nul
if errorlevel 1 (
  echo   Git is not installed yet.
  echo   Opening the download page: install it with the default options, then double-click this file again.
  start "" "https://git-scm.com/download/win"
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo   First start: installing, this takes a minute...
  call npm install --no-fund --no-audit
  if errorlevel 1 (
    echo.
    echo   Installing failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

rem Open the browser once the app has had a few seconds to start.
start "" /b cmd /c "timeout /t 4 /nobreak >nul & start "" http://localhost:3000"
call npm start --silent
echo.
pause
