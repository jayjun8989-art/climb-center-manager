# Re-apply default login accounts on Supabase, then launch the desktop app.
# Admin: grabon / wkaqhek2222  |  ONCLE staff: oncle / oncle  |  GRABIT staff: grabit / grabit
#
# Option A (recommended): Supabase Dashboard > SQL Editor
#   Paste and run: supabase/migrations/20250101000010_reapply_default_accounts.sql
#
# Option B: psql with database URI
#   $env:SUPABASE_DB_URL = "postgresql://postgres.[ref]:[password]@..."
#   psql $env:SUPABASE_DB_URL -f supabase/migrations/20250101000010_reapply_default_accounts.sql

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$SeedFile = Join-Path $Root "supabase\migrations\20250101000010_reapply_default_accounts.sql"
$ProjectRef = "iknidqosbmqzgkhfaktc"

Write-Host "=== Climb Center Manager ?? ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "??? ?? ?? SQL (?? ??? ??):" -ForegroundColor Yellow
Write-Host "  $SeedFile"
Write-Host ""
Write-Host "Supabase SQL Editor:" -ForegroundColor Yellow
Write-Host "  https://supabase.com/dashboard/project/$ProjectRef/sql/new"
Write-Host ""

$dbUrl = $env:SUPABASE_DB_URL
if ($dbUrl -and (Get-Command psql -ErrorAction SilentlyContinue)) {
  Write-Host "SUPABASE_DB_URL + psql ? ?? ?? ?..." -ForegroundColor Green
  & psql $dbUrl -f $SeedFile
  if ($LASTEXITCODE -ne 0) {
    Write-Host "?? ?? ??. Dashboard SQL Editor?? ?? ?????." -ForegroundColor Red
  } else {
    Write-Host "?? ?? ??." -ForegroundColor Green
  }
} else {
  Write-Host "Dashboard SQL Editor?? ? SQL ??? ??? ? ??????." -ForegroundColor Yellow
  Write-Host "(?? ??: psql ?? + SUPABASE_DB_URL ?? ?? ??)" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "? ?? ?..." -ForegroundColor Cyan

$ReleaseExe = Join-Path $Root "src-tauri\target\release\climb-center-manager.exe"
$DebugExe = Join-Path $Root "src-tauri\target\debug\climb-center-manager.exe"

if (Test-Path $ReleaseExe) {
  Start-Process $ReleaseExe
} elseif (Test-Path $DebugExe) {
  Start-Process $DebugExe
} else {
  Set-Location $Root
  npm.cmd run tauri dev
}
