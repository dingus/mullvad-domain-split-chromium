[CmdletBinding()]
param(
    [switch]$SkipMullvad,
    [switch]$NoStart
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$sourceRoot = Split-Path -Parent $PSScriptRoot
$installRoot = Join-Path $env:LOCALAPPDATA 'Programs\Mullvad Domain Split'
$helperRelative = 'helper\MullvadHomeIPHelper.exe'
$helperPath = Join-Path $installRoot $helperRelative
$startupFolder = [Environment]::GetFolderPath('Startup')
$launcherPath = Join-Path $startupFolder 'Mullvad Home IP Helper.vbs'

function Stop-ExistingHelper {
    Get-Process -Name 'MullvadHomeIPHelper' -ErrorAction SilentlyContinue |
        Stop-Process -Force -ErrorAction SilentlyContinue
}

function Stop-ExistingMonitor {
    try {
        Get-CimInstance Win32_Process -Filter "Name = 'wscript.exe'" -ErrorAction Stop |
            Where-Object { $_.CommandLine -like '*Mullvad Home IP Helper.vbs*' } |
            ForEach-Object { Invoke-CimMethod -InputObject $_ -MethodName Terminate -ErrorAction SilentlyContinue | Out-Null }
    } catch {
        Write-Warning "Could not stop an existing startup monitor: $($_.Exception.Message)"
    }
}

Stop-ExistingMonitor
Stop-ExistingHelper

$sourceResolved = [IO.Path]::GetFullPath($sourceRoot).TrimEnd('\')
$installResolved = [IO.Path]::GetFullPath($installRoot).TrimEnd('\')
if (-not $sourceResolved.Equals($installResolved, [StringComparison]::OrdinalIgnoreCase)) {
    New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
    foreach ($directory in @('assets', 'dist', 'helper', 'routing')) {
        $from = Join-Path $sourceRoot $directory
        if (-not (Test-Path -LiteralPath $from -PathType Container)) {
            throw "Required source directory is missing: $from"
        }
        Copy-Item -LiteralPath $from -Destination $installRoot -Recurse -Force
    }
    foreach ($file in @('background.js', 'chromium-compat.js', 'LICENSE.md', 'manifest.json', 'README.md')) {
        $from = Join-Path $sourceRoot $file
        if (Test-Path -LiteralPath $from -PathType Leaf) {
            Copy-Item -LiteralPath $from -Destination (Join-Path $installRoot $file) -Force
        }
    }
}

if (-not (Test-Path -LiteralPath $helperPath -PathType Leaf)) {
    throw "Helper executable was not installed: $helperPath"
}

$escapedHelper = $helperPath.Replace('"', '""')
$launcher = @"
Option Explicit
Const HelperPath = "$escapedHelper"
Const HealthURL = "http://127.0.0.1:37652/health"
Dim shell
Set shell = CreateObject("WScript.Shell")
WScript.Sleep 20000
Do
    If Not HelperIsHealthy() Then
        shell.Run Chr(34) & HelperPath & Chr(34), 0, False
        WScript.Sleep 5000
    End If
    WScript.Sleep 10000
Loop
Function HelperIsHealthy()
    On Error Resume Next
    Dim request
    Set request = CreateObject("MSXML2.XMLHTTP.6.0")
    request.Open "GET", HealthURL, False
    request.setRequestHeader "Cache-Control", "no-cache"
    request.Send
    HelperIsHealthy = (Err.Number = 0 And request.Status = 200)
    Err.Clear
    On Error GoTo 0
End Function
"@
Set-Content -LiteralPath $launcherPath -Value $launcher -Encoding ASCII

if (-not $SkipMullvad) {
    $mullvadCandidates = @(
        (Join-Path $env:ProgramFiles 'Mullvad VPN\resources\mullvad.exe'),
        (Join-Path $env:ProgramFiles 'Mullvad VPN\mullvad.exe')
    )
    $mullvad = $mullvadCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if ($null -eq $mullvad) {
        throw 'Mullvad CLI was not found. Re-run with -SkipMullvad to install without configuring the exclusion.'
    }
    & $mullvad split-tunnel app add $helperPath
    if ($LASTEXITCODE -ne 0) { throw "Mullvad exclusion failed with exit code $LASTEXITCODE." }
    & $mullvad split-tunnel set on
    if ($LASTEXITCODE -ne 0) { throw "Enabling Mullvad split tunneling failed with exit code $LASTEXITCODE." }
}

if (-not $NoStart) {
    Start-Process -FilePath (Join-Path $env:WINDIR 'System32\wscript.exe') -ArgumentList @('//B', $launcherPath)
}

Write-Host ''
Write-Host 'Mullvad Domain Split installed.' -ForegroundColor Green
Write-Host "Runtime: $installRoot"
Write-Host "Startup monitor: $launcherPath"
Write-Host 'Load the runtime folder as an unpacked extension in your Chromium browser.'

