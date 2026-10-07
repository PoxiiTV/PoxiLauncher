@echo off
chcp 65001 >nul
title PoxiLauncher - build
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=

rem Carga las variables de .env (URL de actualizaciones) para el empaquetado
if exist .env (
  for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env") do set "%%a=%%b"
)

if not exist node_modules call npm install || goto :error
call npm test || goto :error
call npm run dist || goto :error

echo.
echo Listo. Instalador (pequeno) en release\nsis-web y portable en release\
explorer release
exit /b

:error
echo.
echo Algo ha fallado. Revisa el mensaje de arriba.
pause
