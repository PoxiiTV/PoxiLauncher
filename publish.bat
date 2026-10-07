@echo off
chcp 65001 >nul
title PoxiLauncher - publicar actualización
cd /d "%~dp0"

rem Sube la versión de release\ al servidor de actualizaciones (MAIN_VITE_UPDATE_URL en .env)
rem y la publica como actual: las apps de tus amigos se actualizarán solas.
node scripts\publish.mjs %*
echo.
pause
