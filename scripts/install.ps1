# scripts/install.ps1 - Native Windows PowerShell Installer for Etemaro CLI
[CmdletBinding()]
param(
    [switch]$SkipInit
)

$ErrorActionPreference = "Stop"

Write-Host "Installing Etemaro CLI on Windows..." -ForegroundColor Cyan

# Check Node.js requirement
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js 22+ is required but was not found in PATH. Please install Node.js from https://nodejs.org"
    exit 1
}

$nodeVersionRaw = node -v
$nodeMajor = [int]($nodeVersionRaw.TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) {
    Write-Error "Node.js version 22 or higher is required. Detected: $nodeVersionRaw"
    exit 1
}

Write-Host "Detected Node.js $nodeVersionRaw (supported)" -ForegroundColor Green

# Check npm availability
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Error "npm was not found in PATH. Please ensure npm is installed with Node.js."
    exit 1
}

# Install @etemaro/cli globally
Write-Host "Installing @etemaro/cli globally via npm..." -ForegroundColor Cyan
npm install -g @etemaro/cli

if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to install @etemaro/cli via npm."
    exit 1
}

Write-Host "Etemaro CLI installed successfully." -ForegroundColor Green

# Optional initialization
if (-not $SkipInit) {
    Write-Host "Running first-time initialization..." -ForegroundColor Cyan
    if (Get-Command etemaro -ErrorAction SilentlyContinue) {
        etemaro init
    } else {
        Write-Host "To initialize, open a new terminal window and run: etemaro init" -ForegroundColor Yellow
    }
} else {
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  etemaro init" -ForegroundColor White
    Write-Host "  etemaro start --dry-run" -ForegroundColor White
}
