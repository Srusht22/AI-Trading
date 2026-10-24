@echo off
rem TradePilot AI MT5 connector launcher. Usage: tradepilot-connector <check|pair|start|stop|status|logs|reset|version>
setlocal
set "HERE=%~dp0"
if not exist "%HERE%.venv\Scripts\python.exe" (
  echo The connector is not installed yet. Run:  powershell -ExecutionPolicy Bypass -File "%HERE%setup.ps1"
  exit /b 2
)
set "PYTHONPATH=%HERE%"
"%HERE%.venv\Scripts\python.exe" -m tradepilot_connector %*
exit /b %ERRORLEVEL%
