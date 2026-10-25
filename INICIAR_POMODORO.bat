@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
title Pomodoro - Inicio automatico
cd /d "%~dp0"

if not exist "backend\main.py" (
  echo [ERROR] No se encontro backend\main.py.
  echo Coloca este BAT en la carpeta principal del proyecto.
  pause
  exit /b 1
)
if not exist "requirements.txt" (
  echo [ERROR] Falta requirements.txt en esta carpeta.
  pause
  exit /b 1
)

echo ================================================
echo      POMODORO / ANTI-POMODORO - WINDOWS
echo ================================================
echo.
echo [1/3] Verificando Python y preparando dependencias...
set "PYTHON_BOOT="
where py >nul 2>nul
if not errorlevel 1 (
  py -3 -c "import sys; assert sys.version_info >= (3, 9)" >nul 2>nul
  if not errorlevel 1 set "PYTHON_BOOT=py -3"
)
if not defined PYTHON_BOOT (
  where python >nul 2>nul
  if not errorlevel 1 (
    python -c "import sys; assert sys.version_info >= (3, 9)" >nul 2>nul
    if not errorlevel 1 set "PYTHON_BOOT=python"
  )
)
if not defined PYTHON_BOOT (
  echo [ERROR] Se requiere Python 3.9 o posterior.
  echo Instalalo desde https://www.python.org/downloads/windows/
  echo Marca la opcion Add Python to PATH si corresponde.
  pause
  exit /b 1
)
if not exist ".venv\Scripts\python.exe" (
  echo Creando entorno virtual .venv ...
  %PYTHON_BOOT% -m venv ".venv"
  if errorlevel 1 goto :failed
)
echo Instalando o verificando librerias...
"%CD%\.venv\Scripts\python.exe" -m pip install -r "requirements.txt"
if errorlevel 1 goto :failed

echo.
echo [2/3] Detectando IPv4 de la red local...
set "LOCAL_IP="
for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$c = Get-NetIPConfiguration ^| Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' }; $v = $c ^| ForEach-Object { $_.IPv4Address.IPAddress } ^| Where-Object { ($_ -match '^(10\.|192\.168\.)' -or $_ -match '^172\.(1[6-9]\.|2[0-9]\.|3[01]\.)') } ^| Select-Object -First 1; if (-not $v) { $v = '127.0.0.1' }; Write-Output $v"`) do set "LOCAL_IP=%%I"
if not defined LOCAL_IP set "LOCAL_IP=127.0.0.1"

if "%LOCAL_IP%"=="127.0.0.1" (
  set "BIND_IP=127.0.0.1"
  echo Sin IPv4 LAN detectable. Se usara localhost.
) else (
  set "BIND_IP=0.0.0.0"
  echo ADVERTENCIA: El servidor sera accesible desde tu red local.
  echo Usalo solo en redes de confianza. NO abras puertos en el router.
)
echo Direccion: http://%LOCAL_IP%:8000/
echo.
echo [3/3] Iniciando servidor...

REM Abre el navegador cuando el servidor responda, hasta 20 segundos.
start "" /B powershell -NoProfile -ExecutionPolicy Bypass -Command "$url='http://%LOCAL_IP%:8000/'; for($i=0;$i -lt 40;$i++){ try { $r=Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2; if($r.StatusCode -eq 200){ Start-Process $url; exit 0 } } catch{}; Start-Sleep -Milliseconds 500 }; Write-Host 'No se pudo abrir el navegador: revisa el servidor.'"

pushd "backend"
"%CD%\..\.venv\Scripts\python.exe" -m uvicorn main:app --host %BIND_IP% --port 8000
set "EXIT_CODE=%ERRORLEVEL%"
popd
echo.
echo El servidor se detuvo. Codigo: %EXIT_CODE%
pause
exit /b %EXIT_CODE%

:failed
echo.
echo [ERROR] No se pudieron instalar los requisitos o crear el entorno.
echo Verifica tu conexion a Internet y tu instalacion de Python.
pause
exit /b 1
