param(
  [string]$SupabaseUrl = $env:VITE_SUPABASE_URL,
  [string]$AnonKey = $env:VITE_SUPABASE_ANON_KEY
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env"

if ((-not $SupabaseUrl -or -not $AnonKey) -and (Test-Path $envFile)) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*VITE_SUPABASE_URL=(.+)$') { $SupabaseUrl = $matches[1].Trim() }
    if ($_ -match '^\s*VITE_SUPABASE_ANON_KEY=(.+)$') { $AnonKey = $matches[1].Trim() }
  }
}

if (-not $SupabaseUrl -or -not $AnonKey) {
  Write-Error "Supabase URL/Key missing. Set .env or pass parameters."
}

$accounts = @(
  @{ Id = "grabon"; Password = "wkaqhek2222"; Label = "Admin" },
  @{ Id = "oncle"; Password = "oncle"; Label = "ONCLE staff" },
  @{ Id = "grabit"; Password = "grabit"; Label = "GRABIT staff" }
)

Write-Host "Testing logins against $SupabaseUrl"
$failed = 0

foreach ($account in $accounts) {
  $email = "$($account.Id)@oncle.local"
  $body = @{ email = $email; password = $account.Password } | ConvertTo-Json
  try {
    $null = Invoke-RestMethod `
      -Uri "$SupabaseUrl/auth/v1/token?grant_type=password" `
      -Method POST `
      -Headers @{ apikey = $AnonKey; "Content-Type" = "application/json" } `
      -Body $body
    Write-Host "[OK] $($account.Label): $($account.Id) / $($account.Password)"
  } catch {
    Write-Host "[FAIL] $($account.Label): $($account.Id) / $($account.Password)"
    $failed += 1
  }
}

if ($failed -gt 0) {
  Write-Host ""
  Write-Host "Run SQL migration 000014_fix_accounts_grabon.sql in Supabase SQL Editor, then retry."
  exit 1
}

Write-Host ""
Write-Host "All login accounts verified."
