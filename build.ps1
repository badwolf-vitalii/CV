$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$PersonalFile = Join-Path $Root "personal.yaml"
$SourceFile = Join-Path $Root "cv.typ"
$OutputDirectory = Join-Path $Root "output"
$OutputFile = Join-Path $OutputDirectory "Vitalii_Hanych_CV.pdf"

if (-not (Test-Path $PersonalFile)) {
    throw "personal.yaml is missing. Copy personal.example.yaml to personal.yaml and fill in your private contact details."
}

if (-not (Get-Command typst -ErrorAction SilentlyContinue)) {
    throw "Typst CLI was not found in PATH. Install Typst before building the CV."
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

& typst compile $SourceFile $OutputFile
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host "CV generated: $OutputFile"
