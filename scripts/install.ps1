<#
.SYNOPSIS
    Installs the Minor Pentatonic Practice Desk on Windows 10 or 11.

.DESCRIPTION
    Downloads the latest release from GitHub, checks it against the release's
    SHA-256 checksums, installs it, and adds a Start menu shortcut and an entry in
    Settings > Apps so it can be uninstalled like any other program.

    By default it installs for the current user only, which needs no administrator
    rights. -Scope AllUsers installs into Program Files for everyone on the PC; that
    needs administrator rights, and the script asks for them (a UAC prompt) when
    it is run from a saved file.

    The app itself only listens on 127.0.0.1, so Windows Firewall has nothing to ask.

.EXAMPLE
    # Quickest: run straight from GitHub. Piping into iex is not blocked by the
    # execution policy, so nothing needs changing.
    irm https://raw.githubusercontent.com/brucehoppe/minor-pentatonic-go/main/scripts/install.ps1 | iex

.EXAMPLE
    # From GitHub, with options:
    & ([scriptblock]::Create((irm https://raw.githubusercontent.com/brucehoppe/minor-pentatonic-go/main/scripts/install.ps1))) -DesktopShortcut

.EXAMPLE
    # From a saved copy. Windows marks downloaded scripts as coming from the internet,
    # and the default execution policy refuses to run them, so either unblock it once:
    Unblock-File .\install.ps1
    .\install.ps1
    # or bypass the policy for this one run only (it does not change any setting):
    powershell -ExecutionPolicy Bypass -File .\install.ps1

.EXAMPLE
    .\install.ps1 -Scope AllUsers        # everyone on this PC; asks for administrator rights
    .\install.ps1 -ZipPath .\minor-pentatonic-2026.09.18-windows-11-x64.zip   # offline
    .\install.ps1 -Uninstall
#>
[CmdletBinding()]
param(
    # CurrentUser needs no administrator rights. AllUsers installs into Program Files.
    [ValidateSet('CurrentUser', 'AllUsers')]
    [string]$Scope = 'CurrentUser',

    # A release tag such as v2026.09.18. Defaults to the latest release. It goes into a
    # URL, so only what a release tag contains is accepted.
    [ValidatePattern('^[A-Za-z0-9._-]+$')]
    [string]$Version = 'latest',

    # Install from a release ZIP already on disk instead of downloading one. Put the
    # matching SHA256SUMS-<version>.txt beside it and it is checked too.
    [string]$ZipPath,

    # Put the program somewhere else.
    [string]$InstallDir,

    [switch]$DesktopShortcut,

    # Add the install folder to PATH, so minor-pentatonic works in a terminal.
    [switch]$AddToPath,

    # Do not start the app when the install finishes.
    [switch]$NoLaunch,

    [switch]$Uninstall
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # the progress bar makes Invoke-WebRequest many times slower on 5.1

$Repo      = 'brucehoppe/minor-pentatonic-go'
$AppName   = 'Minor Pentatonic Practice Desk'
$ExeName   = 'minor-pentatonic.exe'
$UninstKey = 'MinorPentatonicPracticeDesk'
$Port      = 7534

function Write-Step([string]$Message) { Write-Host "==> $Message" -ForegroundColor Cyan }

# ------------------------------------------------------------ platform checks
if ($env:OS -ne 'Windows_NT') {
    throw "This installer is for Windows. On macOS use the .dmg from the Releases page; elsewhere run: go install github.com/$Repo@latest"
}
# Windows PowerShell 5.1 defaults to old TLS versions that GitHub refuses.
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }

function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return (New-Object Security.Principal.WindowsPrincipal $id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# ------------------------------------------------------------ authorization
# An all-users install writes to Program Files and HKLM, which needs an elevated
# PowerShell. When run from a saved file, relaunch elevated (Windows shows its UAC
# prompt) and pass the same options through. When piped from the web there is no
# file to relaunch, so say how to do it instead.
if ($Scope -eq 'AllUsers' -and -not (Test-Admin)) {
    if (-not $PSCommandPath) {
        throw "An all-users install needs administrator rights. Open PowerShell with 'Run as administrator' and run the command again, or leave out -Scope AllUsers to install just for you (no administrator rights needed)."
    }
    Write-Step 'Administrator rights are needed for an all-users install; Windows will ask.'
    $argv = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
    foreach ($p in $PSBoundParameters.GetEnumerator()) {
        if ($p.Value -is [switch]) { if ($p.Value) { $argv += "-$($p.Key)" } }
        else { $argv += "-$($p.Key)"; $argv += "`"$($p.Value)`"" }
    }
    $shell = (Get-Process -Id $PID).Path   # the same PowerShell that is running this
    try {
        $proc = Start-Process -FilePath $shell -ArgumentList $argv -Verb RunAs -Wait -PassThru
    } catch {
        throw 'The administrator prompt was declined, so nothing was installed. Run again without -Scope AllUsers to install just for you.'
    }
    exit $proc.ExitCode
}

# ------------------------------------------------------------ where things go
if ($Scope -eq 'AllUsers') {
    $defaultDir  = Join-Path $env:ProgramFiles 'Minor Pentatonic'
    $startMenu   = Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs'
    $desktop     = [Environment]::GetFolderPath('CommonDesktopDirectory')
    $uninstRoot  = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
    $pathTarget  = 'Machine'
} else {
    $defaultDir  = Join-Path $env:LOCALAPPDATA 'Programs\Minor Pentatonic'
    $startMenu   = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
    $desktop     = [Environment]::GetFolderPath('Desktop')
    $uninstRoot  = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
    $pathTarget  = 'User'
}
$uninstPath = Join-Path $uninstRoot $UninstKey
if (-not $InstallDir) {
    # an existing install keeps its folder, even if -InstallDir was used last time
    $existing = Get-ItemProperty -Path $uninstPath -ErrorAction SilentlyContinue
    if ($existing -and $existing.InstallLocation) { $InstallDir = $existing.InstallLocation } else { $InstallDir = $defaultDir }
}
$exePath      = Join-Path $InstallDir $ExeName
$startLink    = Join-Path $startMenu "$AppName.lnk"
$desktopLink  = Join-Path $desktop "$AppName.lnk"

# ------------------------------------------------------------ helpers
# Ask a running copy to quit (the app's own Quit), then make sure it has gone, so its
# files can be replaced or removed.
function Stop-App {
    try {
        Invoke-WebRequest -UseBasicParsing -Method Post -Uri "http://127.0.0.1:$Port/quit" `
            -Headers @{ 'X-Quit' = '1' } -TimeoutSec 2 | Out-Null
        Start-Sleep -Milliseconds 500
    } catch { }
    Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($ExeName)) -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $_.Path -like "$InstallDir*" } |
        Stop-Process -Force -ErrorAction SilentlyContinue
}

function Set-PathEntry([string]$Dir, [bool]$Present) {
    $current = [Environment]::GetEnvironmentVariable('Path', $pathTarget)
    $parts = @()
    if ($current) { $parts = $current -split ';' | Where-Object { $_ -and ($_.TrimEnd('\') -ne $Dir.TrimEnd('\')) } }
    if ($Present) { $parts += $Dir }
    [Environment]::SetEnvironmentVariable('Path', ($parts -join ';'), $pathTarget)
}

function New-Shortcut([string]$Link, [string]$Target) {
    $wsh = New-Object -ComObject WScript.Shell
    $s = $wsh.CreateShortcut($Link)
    $s.TargetPath = $Target
    $s.WorkingDirectory = Split-Path $Target
    $s.Description = $AppName
    $s.WindowStyle = 7   # start the small console window minimised
    $s.Save()
}

function Get-Arch {
    # PROCESSOR_ARCHITEW6432 is set when a 32-bit or emulated PowerShell runs on a
    # 64-bit machine, and names the machine's real architecture.
    $a = $env:PROCESSOR_ARCHITEW6432
    if (-not $a) { $a = $env:PROCESSOR_ARCHITECTURE }
    switch ($a) {
        'ARM64' { return 'arm64' }
        'AMD64' { return 'x64' }
        default { throw "No Windows build for the '$a' processor. Builds exist for x64 and ARM64." }
    }
}

# ------------------------------------------------------------ uninstall
if ($Uninstall) {
    Write-Step "Removing $AppName"
    Stop-App
    Remove-Item -LiteralPath $startLink, $desktopLink -Force -ErrorAction SilentlyContinue
    Set-PathEntry $InstallDir $false
    Remove-Item -LiteralPath $uninstPath -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $InstallDir) {
        # When Settings > Apps runs this, the uninstaller is inside the folder being
        # removed. PowerShell has already read it, so the delete still succeeds.
        Remove-Item -LiteralPath $InstallDir -Recurse -Force
    }
    Write-Host "$AppName has been removed. Your practice log lives in your browser and was not touched."
    return
}

# ------------------------------------------------------------ fetch
$work = Join-Path ([IO.Path]::GetTempPath()) ("minor-pentatonic-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
    $arch = Get-Arch
    $sums = $null

    if ($ZipPath) {
        $zip = (Resolve-Path -LiteralPath $ZipPath).Path
        $tag = 'local'
        # A folder can hold checksums for several releases: use the file that lists this ZIP.
        $zipName = Split-Path -Leaf $zip
        $listsZip = '\s\*?' + [regex]::Escape($zipName) + '\s*$'
        $sumsFile = Get-ChildItem -LiteralPath (Split-Path $zip) -Filter 'SHA256SUMS-*.txt' -ErrorAction SilentlyContinue |
            Where-Object { @(Get-Content -LiteralPath $_.FullName) -match $listsZip } | Select-Object -First 1
        if ($sumsFile) { $sums = Get-Content -LiteralPath $sumsFile.FullName }
        else { Write-Warning 'No SHA256SUMS file beside the ZIP lists it, so it cannot be verified. Only continue with a ZIP you trust.' }
    } else {
        if ($Version -eq 'latest') { $api = "https://api.github.com/repos/$Repo/releases/latest" }
        else { $api = "https://api.github.com/repos/$Repo/releases/tags/$Version" }
        Write-Step 'Finding the release'
        try {
            $release = Invoke-RestMethod -UseBasicParsing -Uri $api -Headers @{ 'User-Agent' = 'minor-pentatonic-installer' }
        } catch {
            throw "Could not reach GitHub ($api). Check the internet connection, or download the Windows ZIP from https://github.com/$Repo/releases and run: .\install.ps1 -ZipPath <file>"
        }
        $tag = $release.tag_name
        $asset = $release.assets | Where-Object { $_.name -like "*-windows-11-$arch.zip" } | Select-Object -First 1
        $sumsAsset = $release.assets | Where-Object { $_.name -like 'SHA256SUMS-*.txt' } | Select-Object -First 1
        if (-not $asset) { throw "Release $tag has no Windows $arch build." }
        if (-not $sumsAsset) { throw "Release $tag has no SHA256SUMS file, so its download cannot be verified. Nothing was installed." }

        Write-Step "Downloading $($asset.name) ($tag)"
        $zip = Join-Path $work $asset.name
        Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -OutFile $zip
        # Saved to disk rather than read from .Content: Windows PowerShell 5.1 returns
        # raw bytes for GitHub's application/octet-stream downloads.
        $sumsPath = Join-Path $work $sumsAsset.name
        Invoke-WebRequest -UseBasicParsing -Uri $sumsAsset.browser_download_url -OutFile $sumsPath
        $sums = Get-Content -LiteralPath $sumsPath
    }

    # ------------------------------------------------------------ verify
    if ($sums) {
        Write-Step 'Checking the SHA-256 checksum'
        $name = Split-Path $zip -Leaf
        $line = $sums | Where-Object { $_ -match "^\s*([0-9a-fA-F]{64})\s+\*?$([regex]::Escape($name))\s*$" } | Select-Object -First 1
        if (-not $line) { throw "$name is not listed in the checksum file. Nothing was installed." }
        $want = ($line.Trim() -split '\s+')[0].ToLowerInvariant()
        $got = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($got -ne $want) { throw "Checksum mismatch for $name (expected $want, got $got). The download is damaged or has been tampered with. Nothing was installed." }
    }

    # ------------------------------------------------------------ install
    Write-Step "Installing to $InstallDir"
    $unpacked = Join-Path $work 'unpacked'
    Expand-Archive -LiteralPath $zip -DestinationPath $unpacked -Force
    if (-not (Test-Path -LiteralPath (Join-Path $unpacked $ExeName))) { throw "The ZIP does not contain $ExeName." }

    Stop-App   # an upgrade cannot overwrite a running .exe
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Copy-Item -Path (Join-Path $unpacked '*') -Destination $InstallDir -Recurse -Force
    # Files that came from the internet carry a "mark of the web", which makes
    # SmartScreen stop every launch. The checksum above is what vouches for them.
    Get-ChildItem -LiteralPath $InstallDir -Recurse -File | Unblock-File

    # A standalone uninstaller, so removal works however this script was started.
    $uninstaller = Join-Path $InstallDir 'uninstall.ps1'
    $body = @"
# Removes the $AppName. Written by install.ps1.
`$ErrorActionPreference = 'Stop'
`$dir = '$($InstallDir -replace "'", "''")'
try { Invoke-WebRequest -UseBasicParsing -Method Post -Uri 'http://127.0.0.1:$Port/quit' -Headers @{ 'X-Quit' = '1' } -TimeoutSec 2 | Out-Null; Start-Sleep -Milliseconds 500 } catch { }
Get-Process -Name '$([IO.Path]::GetFileNameWithoutExtension($ExeName))' -ErrorAction SilentlyContinue | Where-Object { `$_.Path -and `$_.Path -like "`$dir*" } | Stop-Process -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath '$($startLink -replace "'", "''")', '$($desktopLink -replace "'", "''")' -Force -ErrorAction SilentlyContinue
`$p = [Environment]::GetEnvironmentVariable('Path', '$pathTarget')
if (`$p) { [Environment]::SetEnvironmentVariable('Path', ((`$p -split ';' | Where-Object { `$_ -and (`$_.TrimEnd('\') -ne `$dir.TrimEnd('\')) }) -join ';'), '$pathTarget') }
Remove-Item -LiteralPath '$uninstPath' -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath `$dir -Recurse -Force -ErrorAction SilentlyContinue
Write-Host '$AppName has been removed.'
"@
    Set-Content -LiteralPath $uninstaller -Value $body -Encoding UTF8

    Write-Step 'Adding shortcuts'
    New-Shortcut $startLink $exePath
    if ($DesktopShortcut) { New-Shortcut $desktopLink $exePath }
    if ($AddToPath) { Set-PathEntry $InstallDir $true }

    # Settings > Apps entry, so it uninstalls like any other program.
    New-Item -Path $uninstPath -Force | Out-Null
    $size = [int]((Get-ChildItem -LiteralPath $InstallDir -Recurse -File | Measure-Object Length -Sum).Sum / 1KB)
    $props = @{
        DisplayName     = $AppName
        DisplayVersion  = ($tag -replace '^v', '')
        Publisher       = 'Bruce Hoppe'
        InstallLocation = $InstallDir
        DisplayIcon     = $exePath
        URLInfoAbout    = "https://github.com/$Repo"
        UninstallString = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$uninstaller`""
        EstimatedSize   = $size
        NoModify        = 1
        NoRepair        = 1
    }
    foreach ($k in $props.Keys) {
        $type = 'String'; if ($props[$k] -is [int]) { $type = 'DWord' }
        New-ItemProperty -Path $uninstPath -Name $k -Value $props[$k] -PropertyType $type -Force | Out-Null
    }

    Write-Host ''
    Write-Host "$AppName $tag is installed." -ForegroundColor Green
    Write-Host "  Start it from the Start menu: $AppName"
    Write-Host '  Remove it from Settings > Apps, or run this script again with -Uninstall.'
    if ($AddToPath) { Write-Host '  Open a new terminal to use: minor-pentatonic' }

    if (-not $NoLaunch) { Start-Process -FilePath $exePath -WorkingDirectory $InstallDir -WindowStyle Minimized }
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
