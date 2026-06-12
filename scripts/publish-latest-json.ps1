# Write latest.json for GitHub Release (UTF-8 without BOM � required by Tauri updater)
param(
  [string]$Version = "",
  [string]$Notes = "???? ?? UI ?? ? updater ?? ??? ??",
  [string]$SigPath = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot

if (-not $Version) {
  $pkg = Get-Content (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
  $Version = $pkg.version
}

if (-not $SigPath) {
  $SigPath = Join-Path $projectRoot "src-tauri\target\release\bundle\nsis\ClimbCenterManager_${Version}_x64-setup.exe.sig"
}

if (-not (Test-Path $SigPath)) {
  Write-Error "Signature file not found: $SigPath`nRun signed tauri build first."
}

$signature = (Get-Content $SigPath -Raw).Trim()
$url = "https://github.com/jayjun8989-art/climb-center-manager/releases/download/v$Version/ClimbCenterManager_${Version}_x64-setup.exe"
$pubDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

$json = @{
  version  = $Version
  notes    = $Notes
  pub_date = $pubDate
  platforms = @{
    "windows-x86_64" = @{
      signature = $signature
      url       = $url
    }
  }
} | ConvertTo-Json -Depth 5

$outPath = Join-Path $projectRoot "latest.json"
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($outPath, $json + "`n", $utf8NoBom)

Write-Host "Wrote $outPath (UTF-8 no BOM)"
Write-Host "Upload to GitHub Release v$Version as latest.json"

# Verify no BOM
$head = [System.IO.File]::ReadAllBytes($outPath)[0..2]
if ($head[0] -eq 0xEF -and $head[1] -eq 0xBB -and $head[2] -eq 0xBF) {
  Write-Error "BOM detected � Tauri updater may fail to parse this file."
}
