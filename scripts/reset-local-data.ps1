# Climb Center Manager � ?? AppData ??? ???
# ? PC? SQLite DB, ??, ??? ??? ?????. Supabase ???? ???? ???? ????.

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "Climb Center Manager ?? ??? ???" -ForegroundColor Yellow
Write-Host "========================================"
Write-Host ""
Write-Host "?? ??? ?? ???? ?????:"
Write-Host ""

$candidateRoots = @(
    (Join-Path $env:APPDATA "com.rabbg.climb-center-manager"),
    (Join-Path $env:APPDATA "ClimbCenterManager"),
    (Join-Path $env:APPDATA "climb-center-manager"),
    (Join-Path $env:LOCALAPPDATA "com.rabbg.climb-center-manager"),
    (Join-Path $env:LOCALAPPDATA "ClimbCenterManager"),
    (Join-Path $env:LOCALAPPDATA "climb-center-manager")
) | Select-Object -Unique

$targets = @()

foreach ($root in $candidateRoots) {
    if (-not (Test-Path $root)) { continue }

    $targets += Get-Item -LiteralPath $root -Force

    foreach ($name in @(
        "climb-center-manager.db",
        "climb_center.db",
        "climb-center-manager.db-wal",
        "climb-center-manager.db-shm",
        "climb_center.db-wal",
        "climb_center.db-shm"
    )) {
        $file = Join-Path $root $name
        if (Test-Path $file) { $targets += Get-Item -LiteralPath $file -Force }
    }

    foreach ($dirName in @("backups", "sync")) {
        $dir = Join-Path $root $dirName
        if (Test-Path $dir) { $targets += Get-Item -LiteralPath $dir -Force -Recurse }
    }
}

if ($targets.Count -eq 0) {
    Write-Host "??? ?? ???? ????." -ForegroundColor Green
    exit 0
}

$targets |
    Sort-Object { $_.FullName } -Unique |
    ForEach-Object { Write-Host "  - $($_.FullName)" }

Write-Host ""
Write-Host "?? ?? Climb Center Manager ???? ?????????" -ForegroundColor Red
Write-Host "????? RESET ? ?????."
$confirm = Read-Host "??"

if ($confirm -ne "RESET") {
    Write-Host "???????. ???? ???? ?????." -ForegroundColor Cyan
    exit 1
}

foreach ($item in ($targets | Sort-Object FullName -Descending -Unique)) {
    if ($item.PSIsContainer) {
        Remove-Item -LiteralPath $item.FullName -Recurse -Force
    } else {
        Remove-Item -LiteralPath $item.FullName -Force
    }
    Write-Host "???: $($item.FullName)" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "?? ??? ???? ???????." -ForegroundColor Green
Write-Host "?? ?? ??? ? ????? Supabase?? ?? ???? ??? ? ????."
