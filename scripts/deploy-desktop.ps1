$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $projectRoot

Write-Host "1/3 Frontend build (UTF-8)..."
npm run build
if ($LASTEXITCODE -ne 0) { throw "Frontend build failed." }

Write-Host "2/3 Tauri release build..."
npm run tauri:build -- --no-bundle
if ($LASTEXITCODE -ne 0) { throw "Tauri build failed." }

Write-Host "3/3 Desktop shortcut..."
& (Join-Path $PSScriptRoot "create-desktop-shortcut.ps1")

Write-Host "Done. Launch ClimbCenterManager from your desktop."
