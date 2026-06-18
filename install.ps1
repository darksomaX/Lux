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

# Integrity check: SHA-256 of all source files (excluding deps + build output).
Write-Host ""
Write-Host "Computing integrity hash of source files..." -ForegroundColor White
$files = Get-ChildItem -Recurse -File |
  Where-Object {
    $_.FullName -notmatch "node_modules" -and
    $_.FullName -notmatch "\\.git\\" -and
    $_.FullName -notmatch "public\\uv\\" -and
    $_.FullName -notmatch "public\\baremux\\" -and
    $_.FullName -notmatch "public\\epoxy\\" -and
    $_.FullName -notmatch "public\\scramjet\\" -and
    $_.FullName -notmatch "public\\libcurl\\" -and
    $_.Name -ne "package-lock.json"
  } | Sort-Object FullName
$hashes = $files | ForEach-Object { (Get-FileHash $_.FullName -Algorithm SHA256).Hash + "  " + $_.Name }
$combined = $hashes -join "`n"
$final = (Get-FileHash -Algorithm SHA256 -InputStream ([System.IO.MemoryStream]::new([System.Text.Encoding]::UTF8.GetBytes($combined)))).Hash
Write-Host "  Source integrity (SHA-256): $final" -ForegroundColor Cyan
Write-Host "  Verify this matches the hash in the release notes." -ForegroundColor Gray
Write-Host "  If it differs, your download may have been tampered with." -ForegroundColor Gray

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
