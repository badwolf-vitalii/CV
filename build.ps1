$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$PersonalFile = Join-Path $Root "personal.yaml"
$SourceFile = Join-Path $Root "cv.typ"
$OutputDirectory = Join-Path $Root "output"
$OutputFile = Join-Path $OutputDirectory "Vitalii_Hanych_CV.pdf"
$OptimizedPhotoFile = Join-Path $OutputDirectory ".cv-photo.jpg"
$OptimizedPhotoRelativePath = "output/.cv-photo.jpg"

function Get-YamlValue {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Key,

        [string]$DefaultValue = $null
    )

    $pattern = "^\s*" + [Regex]::Escape($Key) + "\s*:\s*(.*?)\s*$"

    foreach ($line in Get-Content -LiteralPath $Path) {
        $match = [Regex]::Match($line, $pattern)
        if (-not $match.Success) {
            continue
        }

        $value = $match.Groups[1].Value.Trim()

        if ($value.Length -ge 2) {
            $isDoubleQuoted = $value.StartsWith('"') -and $value.EndsWith('"')
            $isSingleQuoted = $value.StartsWith("'") -and $value.EndsWith("'")

            if ($isDoubleQuoted -or $isSingleQuoted) {
                $value = $value.Substring(1, $value.Length - 2)
            }
        }

        return $value
    }

    return $DefaultValue
}

function New-OptimizedPhoto {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourcePath,

        [Parameter(Mandatory = $true)]
        [string]$DestinationPath
    )

    Add-Type -AssemblyName System.Drawing

    $targetSize = 450
    $sourceImage = $null
    $bitmap = $null
    $graphics = $null

    try {
        $sourceImage = [System.Drawing.Image]::FromFile($SourcePath)
        $bitmap = [System.Drawing.Bitmap]::new($targetSize, $targetSize)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)

        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.Clear([System.Drawing.Color]::White)

        $cropSize = [Math]::Min($sourceImage.Width, $sourceImage.Height)
        $sourceX = [int](($sourceImage.Width - $cropSize) / 2)
        $sourceY = [int](($sourceImage.Height - $cropSize) / 2)

        $destinationRectangle = [System.Drawing.Rectangle]::new(0, 0, $targetSize, $targetSize)
        $sourceRectangle = [System.Drawing.Rectangle]::new($sourceX, $sourceY, $cropSize, $cropSize)

        $graphics.DrawImage(
            $sourceImage,
            $destinationRectangle,
            $sourceRectangle,
            [System.Drawing.GraphicsUnit]::Pixel
        )

        $bitmap.Save($DestinationPath, [System.Drawing.Imaging.ImageFormat]::Jpeg)
    }
    finally {
        if ($graphics) {
            $graphics.Dispose()
        }

        if ($bitmap) {
            $bitmap.Dispose()
        }

        if ($sourceImage) {
            $sourceImage.Dispose()
        }
    }
}

if (-not (Test-Path $PersonalFile)) {
    throw "personal.yaml is missing. Copy personal.example.yaml to personal.yaml and fill in your private contact details."
}

if (-not (Get-Command typst -ErrorAction SilentlyContinue)) {
    throw "Typst CLI was not found in PATH. Install Typst before building the CV."
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

$showPhotoValue = Get-YamlValue -Path $PersonalFile -Key "show_photo" -DefaultValue "false"
$showPhoto = $showPhotoValue.Trim().ToLowerInvariant() -eq "true"
$typstArguments = @("compile")

try {
    if ($showPhoto) {
        $photoPath = Get-YamlValue -Path $PersonalFile -Key "photo_path" -DefaultValue "photo.jpg"

        if ([System.IO.Path]::IsPathRooted($photoPath)) {
            $photoSourceFile = $photoPath
        }
        else {
            $photoSourceFile = Join-Path $Root $photoPath
        }

        if (-not (Test-Path $photoSourceFile)) {
            throw "Profile photo was not found: $photoSourceFile"
        }

        Write-Host "Optimizing profile photo..."
        New-OptimizedPhoto -SourcePath $photoSourceFile -DestinationPath $OptimizedPhotoFile

        $originalSizeKb = [Math]::Round((Get-Item $photoSourceFile).Length / 1KB, 1)
        $optimizedSizeKb = [Math]::Round((Get-Item $OptimizedPhotoFile).Length / 1KB, 1)
        Write-Host "Photo optimized: $originalSizeKb KB -> $optimizedSizeKb KB"

        $typstArguments += @("--input", "photo_path=$OptimizedPhotoRelativePath")
    }

    $typstArguments += @($SourceFile, $OutputFile)

    & typst @typstArguments
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}
finally {
    if (Test-Path $OptimizedPhotoFile) {
        Remove-Item -LiteralPath $OptimizedPhotoFile -Force
    }
}

Write-Host "CV generated: $OutputFile"
