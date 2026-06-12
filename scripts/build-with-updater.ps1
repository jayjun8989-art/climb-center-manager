$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$keyPath = Join-Path $projectRoot "keys\tauri-update.key"
$tauriCli = Join-Path $projectRoot "node_modules\.bin\tauri.cmd"

if (-not (Test-Path $tauriCli)) {
  Write-Error "Tauri CLI not found. Run npm install first."
}

if (-not (Test-Path $keyPath)) {
  Write-Error @"
Signing key not found: $keyPath
Generate once:
  npm run tauri -- signer generate -w .\keys\tauri-update.key
"@
}

if (-not $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
  $secure = Read-Host "Signing key password (keys\tauri-update.key)" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

$env:TAURI_SIGNING_PRIVATE_KEY_PATH = $keyPath
Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue

$signPasswordArgs = @("-p", $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD)

Push-Location $projectRoot
try {
  & $tauriCli build
  $buildExit = $LASTEXITCODE

  $setupExe = Get-ChildItem "src-tauri\target\release\bundle\nsis\*-setup.exe" -ErrorAction SilentlyContinue |
    Select-Object -First 1

  if (-not $setupExe) {
    Write-Error "Setup executable not found under src-tauri\target\release\bundle\nsis"
  }

  Write-Host "Signing updater artifact: $($setupExe.Name)"
  & $tauriCli signer sign -f $keyPath @signPasswordArgs $setupExe.FullName
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Updater signature generation failed."
  }

  $sigPath = "$($setupExe.FullName).sig"
  if (-not (Test-Path $sigPath)) {
    Write-Error "Signature file was not created: $sigPath"
  }

  Write-Host "Updater artifacts:"
  Write-Host "  $($setupExe.FullName)"
  Write-Host "  $sigPath"
  Write-Host ""
  Write-Host "Next: run scripts/publish-latest-json.ps1 then upload setup.exe, .sig, and latest.json to GitHub Release."
  Write-Host "IMPORTANT: latest.json must be UTF-8 WITHOUT BOM (script handles this)."

  if ($buildExit -ne 0) {
    exit $buildExit
  }
} finally {
  Pop-Location
  Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PATH -ErrorAction SilentlyContinue
}
