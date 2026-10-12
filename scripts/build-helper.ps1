[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$helperRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'helper'
Push-Location $helperRoot
try {
    & go test ./...
    if ($LASTEXITCODE -ne 0) { throw 'Go tests failed.' }

    $oldGoOS = $env:GOOS
    $oldGoArch = $env:GOARCH
    try {
        $env:GOOS = 'windows'
        $env:GOARCH = 'amd64'
        & go build -trimpath -o MullvadHomeIPHelper.exe main.go
        if ($LASTEXITCODE -ne 0) { throw 'Go build failed.' }
    } finally {
        $env:GOOS = $oldGoOS
        $env:GOARCH = $oldGoArch
    }

    Get-FileHash -LiteralPath '.\MullvadHomeIPHelper.exe' -Algorithm SHA256
} finally {
    Pop-Location
}

