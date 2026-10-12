[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$installRoot = Join-Path $env:LOCALAPPDATA 'Programs\Mullvad Domain Split'
$helperPath = Join-Path $installRoot 'helper\MullvadHomeIPHelper.exe'
if (-not (Test-Path -LiteralPath $helperPath -PathType Leaf)) {
    throw "Helper is not installed at: $helperPath"
}

Write-Host 'Helper health:' -ForegroundColor Cyan
& $helperPath -check
if ($LASTEXITCODE -ne 0) { throw 'The helper health check failed.' }

$mullvadCandidates = @(
    (Join-Path $env:ProgramFiles 'Mullvad VPN\resources\mullvad.exe'),
    (Join-Path $env:ProgramFiles 'Mullvad VPN\mullvad.exe')
)
$mullvad = $mullvadCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if ($null -ne $mullvad) {
    Write-Host "`nMullvad status:" -ForegroundColor Cyan
    & $mullvad status
    & $mullvad split-tunnel get
}

Write-Host "`nHome-route connectivity:" -ForegroundColor Cyan
$ip = & curl.exe --silent --show-error --max-time 15 --socks5-hostname 127.0.0.1:37651 http://api.ipify.org
if ($LASTEXITCODE -ne 0 -or $ip -notmatch '^(?:\d{1,3}\.){3}\d{1,3}$') {
    throw 'The helper did not return a valid-looking public IPv4 address.'
}
Write-Host "Home route is working. Public IPv4: $ip" -ForegroundColor Green

