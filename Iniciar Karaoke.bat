@echo off
title Karaoke
cd /d "%~dp0"
if not exist "venv\Scripts\python.exe" (
  echo Primeira vez: instalando dependencias...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
  if errorlevel 1 (
    echo.
    echo A instalacao falhou. Veja a mensagem acima.
    pause
    exit /b 1
  )
)
"venv\Scripts\python.exe" app.py
pause
