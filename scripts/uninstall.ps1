[CmdletBinding()]
param(
    [switch]$RemoveFiles
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$installRoot = Join-Path $env:LOCALAPPDATA 'Programs\Mullvad Domain Split'
$helperPath = Join-Path $installRoot 'helper\MullvadHomeIPHelper.exe'
$launcherPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'Mullvad Home IP Helper.vbs'

Get-Process -Name 'MullvadHomeIPHelper' -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue

try {
    Get-CimInstance Win32_Process -Filter "Name = 'wscript.exe'" -ErrorAction Stop |
        Where-Object { $_.CommandLine -like '*Mullvad Home IP Helper.vbs*' } |
        ForEach-Object { Invoke-CimMethod -InputObject $_ -MethodName Terminate -ErrorAction SilentlyContinue | Out-Null }
} catch {
    Write-Warning "Could not stop the startup monitor: $($_.Exception.Message)"
}

if (Test-Path -LiteralPath $launcherPath -PathType Leaf) {
    Remove-Item -LiteralPath $launcherPath -Force
}

$mullvadCandidates = @(
    (Join-Path $env:ProgramFiles 'Mullvad VPN\resources\mullvad.exe'),
    (Join-Path $env:ProgramFiles 'Mullvad VPN\mullvad.exe')
)
$mullvad = $mullvadCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if ($null -ne $mullvad) {
    & $mullvad split-tunnel app remove $helperPath
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "Mullvad did not remove the exclusion (exit $LASTEXITCODE). It may already be absent."
    }
}

if ($RemoveFiles -and (Test-Path -LiteralPath $installRoot -PathType Container)) {
    $programsRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs')).TrimEnd('\')
    $resolvedInstall = [IO.Path]::GetFullPath($installRoot).TrimEnd('\')
    if (-not $resolvedInstall.StartsWith($programsRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or
        (Split-Path -Leaf $resolvedInstall) -ne 'Mullvad Domain Split') {
        throw "Refusing to remove unexpected path: $resolvedInstall"
    }
    Remove-Item -LiteralPath $resolvedInstall -Recurse -Force
}

Write-Host 'Auto-start and Mullvad exclusion removed.' -ForegroundColor Green
if (-not $RemoveFiles) {
    Write-Host "Installed files were retained at: $installRoot"
}
Write-Host 'Remove the unpacked extension from the browser separately.'

