$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$desktop = [Environment]::GetFolderPath("Desktop")
$releaseExe = Join-Path $projectRoot "src-tauri\target\release\climb-center-manager.exe"
$debugExe = Join-Path $projectRoot "src-tauri\target\debug\climb-center-manager.exe"
$iconSource = Join-Path $projectRoot "src-tauri\icons\icon.ico"
$shortcutPath = Join-Path $desktop "ClimbCenterManager.lnk"

$sourceExe = if (Test-Path $releaseExe) { $releaseExe } elseif (Test-Path $debugExe) { $debugExe } else { $null }

if (-not $sourceExe) {
  throw "Executable not found. Run npm run desktop:deploy or npm run tauri:build first."
}

$installDir = Join-Path $env:LOCALAPPDATA "ClimbCenterManager"
$installExe = Join-Path $installDir "ClimbCenterManager.exe"
$iconDest = Join-Path $installDir "icon.ico"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null

try {
  Copy-Item -LiteralPath $sourceExe -Destination $installExe -Force
} catch {
  Write-Warning "Could not update installed exe (app may be running). Icon shortcut will still be refreshed."
}

if (Test-Path $iconSource) {
  Copy-Item -LiteralPath $iconSource -Destination $iconDest -Force
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $installExe
$shortcut.WorkingDirectory = $installDir

if (Test-Path $iconDest) {
  $shortcut.IconLocation = "$iconDest,0"
} else {
  $shortcut.IconLocation = "$installExe,0"
}

$shortcut.Description = "Climbing Center Member Manager"
$shortcut.Save()

Write-Output "Installed: $installExe"
Write-Output "Desktop shortcut: $shortcutPath"
