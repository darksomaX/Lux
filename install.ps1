# Lux installer for Windows (PowerShell).
# One line (run in PowerShell):
#   irm https://raw.githubusercontent.com/darksomaX/Lux/main/install.ps1 | iex
#
# Or save-then-run (recommended over the pipe form):
#   curl.exe -fsSL https://raw.githubusercontent.com/darksomaX/Lux/main/install.ps1 -o install.ps1
#   powershell -ExecutionPolicy Bypass -File install.ps1

$ErrorActionPreference = "Stop"
$Repo = "https://github.com/darksomaX/Lux"
$Dir = "lux"

Write-Host "Lux installer" -ForegroundColor White
Write-Host "-------------"

function Test-Command($n) { return [bool](Get-Command $n -ErrorAction SilentlyContinue) }

if (-not (Test-Command git)) {
  Write-Host "git is required. Install from https://git-scm.com/ and re-run." -ForegroundColor Red
  exit 1
}
if (-not (Test-Command node)) {
  Write-Host "Node.js 18+ is required. Install from https://nodejs.org/ and re-run." -ForegroundColor Red
  exit 1
}
$nodeMajor = [int]((node -p 'process.versions.node.split(".")[0]'))
if ($nodeMajor -lt 18) {
  Write-Host "Node 18+ required, found $(node -v). Upgrade at https://nodejs.org/." -ForegroundColor Red
  exit 1
}

if (Test-Path $Dir) {
  Write-Host "Directory ./$Dir exists. Pulling latest..."
  Push-Location $Dir
  git pull --rebase
} else {
  Write-Host "Cloning $Repo into ./$Dir ..."
  git clone --depth 1 $Repo $Dir
  Push-Location $Dir
}

Write-Host "Installing dependencies (this can take a minute)..."
npm install
if ($LASTEXITCODE -ne 0) { Write-Host "npm install failed." -ForegroundColor Red; exit 1 }

Write-Host "Building client bundles..."
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "build failed." -ForegroundColor Red; exit 1 }

Pop-Location

$Port = if ($env:PORT) { $env:PORT } else { "8080" }
Write-Host ""
Write-Host "Done. Start Lux with:" -ForegroundColor Green
Write-Host "  cd $Dir ; npm start"
Write-Host ""
Write-Host "Then open http://localhost:$Port in Chromium."
Write-Host "The first-run unlock phrase is the single letter: a"
Write-Host "Change it in Settings (gear icon, top-left) before relying on it."
Write-Host ""
Write-Host "To host it for others, put it behind nginx or Caddy with TLS. See the README."
