$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$defaultSource = Join-Path $projectRoot "assets\source\grabon-source.png"
$source = if ($args[0]) { $args[0] } else { $defaultSource }

if (-not (Test-Path $source)) {
    Write-Error "Source image not found: $source"
}

function Test-RedPixel([System.Drawing.Color]$c) {
    if ($c.A -lt 8) { return $false }
    $r = [int]$c.R
    $g = [int]$c.G
    $b = [int]$c.B
    return ($r -gt 70) -and ($r -gt ($g + 25)) -and ($r -gt ($b + 25))
}

function Convert-ToTransparentGrabon([System.Drawing.Bitmap]$inputBitmap) {
    $output = New-Object System.Drawing.Bitmap $inputBitmap.Width, $inputBitmap.Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    for ($y = 0; $y -lt $inputBitmap.Height; $y++) {
        for ($x = 0; $x -lt $inputBitmap.Width; $x++) {
            $pixel = $inputBitmap.GetPixel($x, $y)
            if (Test-RedPixel $pixel) {
                $output.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(255, $pixel.R, $pixel.G, $pixel.B))
            } else {
                $output.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0, 0, 0, 0))
            }
        }
    }
    return $output
}

function Get-ContentBounds([System.Drawing.Bitmap]$bitmap, [int]$startX, [int]$endX) {
    $minX = $bitmap.Width
    $minY = $bitmap.Height
    $maxX = 0
    $maxY = 0
    $found = $false
    for ($y = 0; $y -lt $bitmap.Height; $y++) {
        for ($x = $startX; $x -lt $endX; $x++) {
            if ($bitmap.GetPixel($x, $y).A -gt 8) {
                $found = $true
                if ($x -lt $minX) { $minX = $x }
                if ($y -lt $minY) { $minY = $y }
                if ($x -gt $maxX) { $maxX = $x }
                if ($y -gt $maxY) { $maxY = $y }
            }
        }
    }
    if (-not $found) { return $null }
    return @{ MinX = $minX; MinY = $minY; MaxX = $maxX; MaxY = $maxY }
}

function Find-LetterSplitX([System.Drawing.Bitmap]$bitmap) {
    $width = $bitmap.Width
    $counts = New-Object int[] $width
    for ($x = 0; $x -lt $width; $x++) {
        $count = 0
        for ($y = 0; $y -lt $bitmap.Height; $y++) {
            if ($bitmap.GetPixel($x, $y).A -gt 8) { $count++ }
        }
        $counts[$x] = $count
    }

    $searchEnd = [Math]::Min($width - 1, [int]($width * 0.35))
    $peak = 0
    for ($x = 0; $x -le $searchEnd; $x++) {
        if ($counts[$x] -gt $peak) { $peak = $counts[$x] }
    }
    $threshold = [Math]::Max(4, [int]($peak * 0.08))

    for ($x = [int]($width * 0.08); $x -le $searchEnd; $x++) {
        if ($counts[$x] -le $threshold) {
            $window = 6
            $empty = $true
            for ($dx = 0; $dx -lt $window; $dx++) {
                if (($x + $dx) -ge $width) { break }
                if ($counts[$x + $dx] -gt $threshold) { $empty = $false; break }
            }
            if ($empty) { return [Math]::Min($x, [int]($width * 0.18)) }
        }
    }
    return [int]($width * 0.18)
}

function New-SquareIcon([System.Drawing.Bitmap]$sourceBitmap, [hashtable]$bounds, [int]$size = 1024) {
    $contentWidth = $bounds.MaxX - $bounds.MinX + 1
    $contentHeight = $bounds.MaxY - $bounds.MinY + 1
    $pad = [Math]::Max($contentWidth, $contentHeight) * 0.12
    $squareSide = [Math]::Max($contentWidth, $contentHeight) + ($pad * 2)
    $canvas = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($canvas)
    $graphics.Clear([System.Drawing.Color]::FromArgb(0, 0, 0, 0))
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    $scale = ($size * 0.78) / $squareSide
    $drawWidth = $contentWidth * $scale
    $drawHeight = $contentHeight * $scale
    $destX = ($size - $drawWidth) / 2
    $destY = ($size - $drawHeight) / 2
    $srcRect = New-Object System.Drawing.Rectangle $bounds.MinX, $bounds.MinY, $contentWidth, $contentHeight
    $destRect = New-Object System.Drawing.RectangleF $destX, $destY, $drawWidth, $drawHeight
    $graphics.DrawImage($sourceBitmap, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
    $graphics.Dispose()
    return $canvas
}

function Save-Png([System.Drawing.Image]$image, [string]$path) {
    $dir = Split-Path -Parent $path
    if ($dir -and -not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    $image.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
}

$inputImage = [System.Drawing.Image]::FromFile($source)
$inputBitmap = New-Object System.Drawing.Bitmap $inputImage
$inputImage.Dispose()

$transparent = Convert-ToTransparentGrabon $inputBitmap

$logoPath = Join-Path $projectRoot "public\branding\grabon-logo.png"
Save-Png $transparent $logoPath

$splitX = Find-LetterSplitX $transparent
$gBounds = Get-ContentBounds $transparent 0 $splitX
if (-not $gBounds) {
    Write-Error "Could not detect G letter bounds"
}

$iconPath = Join-Path $projectRoot "src-tauri\icons\grabon-icon-1024.png"
$icon = New-SquareIcon $transparent $gBounds 1024
Save-Png $icon $iconPath

$markPath = Join-Path $projectRoot "public\branding\grabon-mark.png"
Copy-Item $iconPath $markPath -Force

$faviconPath = Join-Path $projectRoot "public\favicon.png"
$favicon = New-SquareIcon $transparent $gBounds 64
Save-Png $favicon $faviconPath

$inputBitmap.Dispose()
$transparent.Dispose()
$icon.Dispose()
$favicon.Dispose()

Write-Host "Created:"
Write-Host "  $logoPath"
Write-Host "  $iconPath"
Write-Host "  $faviconPath"
