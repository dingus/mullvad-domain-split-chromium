@echo off
cd /d "%~dp0"
echo Mullvad Home IP Helper - only works as intended if this EXE is excluded from Mullvad Split Tunneling.
echo Close this window to stop the helper.
echo.
"%~dp0MullvadHomeIPHelper.exe"
pause
