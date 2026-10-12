@echo off
cd /d "%~dp0"
echo IP from regular Windows apps (Mullvad VPN, assuming app is connected):
curl.exe --max-time 15 https://api.ipify.org
echo.
echo.
echo IP through home-IP helper (should be home/ISP public IP):
curl.exe --max-time 15 --socks5-hostname 127.0.0.1:37651 https://api.ipify.org
echo.
echo.
echo If both are the same: the helper may not be excluded from Mullvad VPN split tunneling.
pause
