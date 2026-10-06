param(
    [ValidateSet("en", "it")]
    [string]$Language = "en"
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$PackageFile = Join-Path $Root "package.json"
$NodeModules = Join-Path $Root "node_modules"
$PlaywrightModule = Join-Path $NodeModules "playwright-core"
$YamlModule = Join-Path $NodeModules "yaml"
$ScriptFile = Join-Path $Root "scripts\europass-fill.mjs"
$PersonalFile = Join-Path $Root "personal.yaml"

if (-not (Test-Path $PersonalFile)) {
    throw "personal.yaml is missing. Copy personal.example.yaml to personal.yaml and fill in your private contact details."
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js was not found in PATH. Install Node.js before running Europass automation."
}

$NpmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $NpmCommand) {
    $NpmCommand = Get-Command npm -ErrorAction SilentlyContinue
}

if (-not $NpmCommand) {
    throw "npm was not found in PATH. Install Node.js with npm before running Europass automation."
}

if (-not (Test-Path $PackageFile)) {
    throw "package.json is missing."
}

if (-not (Test-Path $PlaywrightModule) -or -not (Test-Path $YamlModule)) {
    Write-Host "Installing local Europass automation dependencies..."
    Push-Location $Root
    try {
        & $NpmCommand.Path install --no-fund --no-audit --package-lock=false
        if ($LASTEXITCODE -ne 0) {
            exit $LASTEXITCODE
        }
    }
    finally {
        Pop-Location
    }
}

$env:EUROPASS_LANG = $Language

Push-Location $Root
try {
    & node $ScriptFile
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}
finally {
    Pop-Location
}
