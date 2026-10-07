@echo off
chcp 65001 >nul
title PoxiLauncher (desarrollo)
cd /d "%~dp0"

rem Algunos entornos (VS Code) dejan esta variable puesta y Electron arrancaría como Node.
set ELECTRON_RUN_AS_NODE=

if not exist node_modules (
  echo Instalando dependencias...
  call npm install || goto :error
)
if not exist resources\bin\7z.exe (
  echo Descargando 7-Zip...
  call npm run bins || goto :error
)

call npm run dev
exit /b

:error
echo.
echo Algo ha fallado. Revisa el mensaje de arriba.
pause
