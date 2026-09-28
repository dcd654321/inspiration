Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$iconDirectory = Join-Path $projectRoot 'miniprogram\assets\tabbar'
[System.IO.Directory]::CreateDirectory($iconDirectory) | Out-Null

function New-Point([int] $x, [int] $y) {
  return [System.Drawing.Point]::new($x, $y)
}

function Save-TabIcon([string] $name, [string] $colorHex, [string] $variant) {
  $bitmap = [System.Drawing.Bitmap]::new(81, 81, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $pen = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml($colorHex), 4)
  try {
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

    switch ($name) {
      'record' {
        $graphics.DrawLine($pen, 27, 53, 52, 28)
        $graphics.DrawLine($pen, 33, 59, 58, 34)
        $graphics.DrawLine($pen, 27, 53, 33, 59)
        $graphics.DrawLine($pen, 52, 28, 58, 34)
        $graphics.DrawLine($pen, 21, 65, 27, 53)
        $graphics.DrawLine($pen, 21, 65, 33, 59)
      }
      'ideas' {
        $graphics.DrawLines($pen, [System.Drawing.Point[]] @(
          (New-Point 40 28), (New-Point 32 24), (New-Point 23 24), (New-Point 17 28),
          (New-Point 17 55), (New-Point 25 53), (New-Point 33 54), (New-Point 40 59)
        ))
        $graphics.DrawLines($pen, [System.Drawing.Point[]] @(
          (New-Point 40 28), (New-Point 48 24), (New-Point 57 24), (New-Point 64 28),
          (New-Point 64 55), (New-Point 56 53), (New-Point 48 54), (New-Point 40 59)
        ))
        $graphics.DrawLine($pen, 40, 28, 40, 59)
      }
      'mine' {
        $graphics.DrawEllipse($pen, 31, 17, 19, 19)
        $graphics.DrawArc($pen, 19, 43, 43, 30, 190, 160)
      }
      default { throw "Unknown tab icon: $name" }
    }

    $target = Join-Path $iconDirectory "$name-$variant.png"
    $bitmap.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output $target
  }
  finally {
    $pen.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

foreach ($name in @('record', 'ideas', 'mine')) {
  Save-TabIcon $name '#6f6f7b' 'idle'
  Save-TabIcon $name '#34377f' 'active'
}
