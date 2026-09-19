<#
.SYNOPSIS
    Builds the Minor Pentatonic Practice Desk from source on Windows.

.DESCRIPTION
    Runs the tests, then builds minor-pentatonic.exe, one file with the web pages
    embedded. Needs Go (https://go.dev/dl/). It also cross-compiles, so it works from
    macOS or Linux under PowerShell 7 too.

    This makes just the program. To package the ZIPs and the macOS app for a release,
    use scripts/release.sh. To install what you built, use scripts/install.ps1.

.EXAMPLE
    .\scripts\build.ps1
    .\scripts\build.ps1 -Arch arm64 -Out .\out -Version 2026.09.19
    powershell -ExecutionPolicy Bypass -File .\scripts\build.ps1 -SkipTests
#>
param(
    # x64 for most PCs, arm64 for Windows on Arm.
    [ValidateSet('x64', 'arm64')]
    [string]$Arch = $(if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }),

    # Shown in the app's footer and by `minor-pentatonic -version`.
    [ValidatePattern('^[A-Za-z0-9._+-]+$')]
    [string]$Version = "$(Get-Date -Format 'yyyy.MM.dd')-dev",

    # The folder to put minor-pentatonic.exe in.
    [string]$Out = '.',

    [switch]$SkipTests
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    throw 'Go is not installed. Get it from https://go.dev/dl/ and open a new PowerShell window.'
}

if (-not $SkipTests) {
    Write-Host '==> Running tests'
    & go vet ./...
    if ($LASTEXITCODE -ne 0) { throw 'go vet failed' }
    & go test ./...
    if ($LASTEXITCODE -ne 0) { throw 'tests failed' }
}

New-Item -ItemType Directory -Force -Path $Out | Out-Null
$exe = Join-Path (Resolve-Path -LiteralPath $Out).Path 'minor-pentatonic.exe'
$goarch = if ($Arch -eq 'arm64') { 'arm64' } else { 'amd64' }

Write-Host "==> Building minor-pentatonic.exe $Version for windows/$goarch"
$env:GOOS = 'windows'; $env:GOARCH = $goarch; $env:CGO_ENABLED = '0'
try {
    & go build -trimpath -ldflags "-s -w -X main.version=$Version" -o $exe .
    if ($LASTEXITCODE -ne 0) { throw 'go build failed' }
} finally {
    Remove-Item Env:GOOS, Env:GOARCH, Env:CGO_ENABLED -ErrorAction SilentlyContinue
}
$size = [math]::Round((Get-Item -LiteralPath $exe).Length / 1MB, 1)
Write-Host "==> Built $exe ($size MB)"
Write-Host '    Run it by double-clicking it, or from a terminal: .\minor-pentatonic.exe'
