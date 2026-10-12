@echo off
cd /d "%~dp0"
echo Public IP reached through the local helper (should show your HOME public IP, not Mullvad):
echo.
curl.exe --max-time 15 --socks5-hostname 127.0.0.1:37651 https://api.ipify.org
echo.
echo.
echo If this shows the VPN IP, make sure Mullvad split tunneling EXCLUDES MullvadHomeIPHelper.exe.
pause
