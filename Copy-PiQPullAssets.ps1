<#
.SYNOPSIS
    Copies required binary assets into PiQPull chrome/ folder.

.DESCRIPTION
    Single-purpose: copies jszip.min.js and the three icon PNGs from the
    downloaded claude-exporter source into the PiQPull chrome/ directory.
    Does not touch any other files.

    Source:  PiQuixRootDownloads\Others\Agoramachinia\*\claude-exporter-main\chrome\
    Target:  PiQuix241\PiQPull\chrome\

.PARAMETER SourceRoot
    Override the source directory if you have a different extraction path.

.PARAMETER DryRun
    Preview what would be copied without writing anything.

.EXAMPLE
    .\Copy-PiQPullAssets.ps1
    .\Copy-PiQPullAssets.ps1 -DryRun
#>

[CmdletBinding()]
param(
    [string]$SourceRoot = '',
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Resolve paths
# ---------------------------------------------------------------------------

$piQuixParent = 'C:\PiQuix\PiQuix241'
$targetDir    = Join-Path $piQuixParent 'PiQPull\chrome'

if (-not $SourceRoot) {
    $downloadBase = Join-Path $piQuixParent 'PiQuixRootDownloads\Others\Agoramachinia'

    if (-not (Test-Path $downloadBase)) {
        Write-Error "Download base not found: $downloadBase"
        exit 1
    }

    # Find the extracted folder — pattern: *claude-exporter-main\chrome
    $candidates = Get-ChildItem -Path $downloadBase -Recurse -Filter 'manifest.json' -ErrorAction SilentlyContinue |
        Where-Object { $_.DirectoryName -match 'chrome$' } |
        Select-Object -First 1

    if (-not $candidates) {
        Write-Error "Could not locate chrome/ folder under $downloadBase. Extract the ZIP first."
        exit 1
    }

    $SourceRoot = $candidates.DirectoryName
}

Write-Host "PiQPull: Copy-PiQPullAssets" -ForegroundColor Cyan
Write-Host "  Source : $SourceRoot"
Write-Host "  Target : $targetDir"
if ($DryRun) { Write-Host '  Mode   : DRY RUN (no files written)' -ForegroundColor Yellow }
Write-Host ''

# ---------------------------------------------------------------------------
# Asset list
# ---------------------------------------------------------------------------

$assets = @(
    'jszip.min.js',
    'icon16.png',
    'icon48.png',
    'icon128.png',
    'icon.svg'
)

# ---------------------------------------------------------------------------
# Validate target exists
# ---------------------------------------------------------------------------

if (-not (Test-Path $targetDir)) {
    Write-Error "Target directory not found: $targetDir"
    exit 1
}

# ---------------------------------------------------------------------------
# Copy loop
# ---------------------------------------------------------------------------

$copied  = 0
$missing = 0

foreach ($asset in $assets) {
    $src  = Join-Path $SourceRoot $asset
    $dest = Join-Path $targetDir  $asset

    if (-not (Test-Path $src)) {
        Write-Warning "  MISSING  $asset (not found in source)"
        $missing++
        continue
    }

    if ($DryRun) {
        Write-Host "  WOULD COPY  $asset" -ForegroundColor Yellow
        $copied++
        continue
    }

    Copy-Item -Path $src -Destination $dest -Force
    Write-Host "  COPIED      $asset" -ForegroundColor Green
    $copied++
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

Write-Host ''
if ($DryRun) {
    Write-Host "Dry run complete. $copied/$($assets.Count) assets found. $missing missing." -ForegroundColor Yellow
} else {
    Write-Host "Done. $copied/$($assets.Count) assets copied. $missing missing." -ForegroundColor Cyan
    if ($missing -gt 0) {
        Write-Host 'Tip: icon.svg is optional. PNG icons are required.' -ForegroundColor DarkGray
    }
}
