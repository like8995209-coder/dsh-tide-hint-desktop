param(
  [string]$Source = "",
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

if ([string]::IsNullOrWhiteSpace($Source)) {
  $Source = Join-Path $ProjectRoot "assets\icon-original.png"
}

if (-not (Test-Path -LiteralPath $Source)) {
  throw "Icon source not found: $Source"
}

$iconDirectory = Join-Path $ProjectRoot "src-tauri\icons"
$assetDirectory = Join-Path $ProjectRoot "src\assets"
$publicDirectory = Join-Path $ProjectRoot "public"
New-Item -ItemType Directory -Force -Path $iconDirectory, $assetDirectory, $publicDirectory | Out-Null

$image = [System.Drawing.Image]::FromFile($Source)
try {
  # The supplied 2048px artwork contains broad white margins. Crop to the
  # rounded glass tile while retaining a small rim for the original glow.
  $crop = [System.Drawing.Rectangle]::new(186, 168, 1640, 1640)
  $canvas = [System.Drawing.Bitmap]::new(1024, 1024, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($canvas)
  try {
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

    $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $radius = 178
    $diameter = $radius * 2
    $width = 1024
    $height = 1024
    $path.AddArc(0, 0, $diameter, $diameter, 180, 90)
    $path.AddArc($width - $diameter, 0, $diameter, $diameter, 270, 90)
    $path.AddArc($width - $diameter, $height - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc(0, $height - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    $graphics.SetClip($path)
    $graphics.DrawImage($image, [System.Drawing.Rectangle]::new(0, 0, 1024, 1024), $crop, [System.Drawing.GraphicsUnit]::Pixel)
  } finally {
    $graphics.Dispose()
    if ($path) { $path.Dispose() }
  }

  $sourcePng = Join-Path $iconDirectory "icon-source.png"
  $canvas.Save($sourcePng, [System.Drawing.Imaging.ImageFormat]::Png)

  $webIcon = [System.Drawing.Bitmap]::new(128, 128, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $webGraphics = [System.Drawing.Graphics]::FromImage($webIcon)
  try {
    $webGraphics.Clear([System.Drawing.Color]::Transparent)
    $webGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $webGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $webGraphics.DrawImage($canvas, 0, 0, 128, 128)
  } finally {
    $webGraphics.Dispose()
  }
  $webIcon.Save((Join-Path $assetDirectory "app-icon.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $webIcon.Dispose()

  $favicon = [System.Drawing.Bitmap]::new(64, 64, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $faviconGraphics = [System.Drawing.Graphics]::FromImage($favicon)
  try {
    $faviconGraphics.Clear([System.Drawing.Color]::Transparent)
    $faviconGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $faviconGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $faviconGraphics.DrawImage($canvas, 0, 0, 64, 64)
  } finally {
    $faviconGraphics.Dispose()
  }
  $favicon.Save((Join-Path $publicDirectory "app-icon.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $favicon.Dispose()

  Write-Output $sourcePng
} finally {
  if ($canvas) { $canvas.Dispose() }
  $image.Dispose()
}
