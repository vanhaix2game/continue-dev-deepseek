# ============================================================
# Install Script - Continue Dev + DeepSeek Browser Agent
# ============================================================
# Chay trong PowerShell: .\install.ps1
# ============================================================

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Continue Dev + DeepSeek Agent Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ── Kiem tra Node.js ──────────────────────────────────────────
Write-Host "[1/5] Kiem tra Node.js..." -ForegroundColor Yellow
try {
    $nodeVer = node --version
    Write-Host "  OK: $nodeVer" -ForegroundColor Green
} catch {
    Write-Host "  ERROR: Node.js chua cai dat!" -ForegroundColor Red
    Write-Host "  Tai tai: https://nodejs.org/" -ForegroundColor Yellow
    Write-Host "  Hoac chay: winget install OpenJS.NodeJS.LTS" -ForegroundColor Yellow
    exit 1
}

# ── Kiem tra VS Code ──────────────────────────────────────────
Write-Host "[2/5] Kiem tra VS Code..." -ForegroundColor Yellow
try {
    $codeVer = code --version 2>$null | Select-Object -First 1
    Write-Host "  OK: VS Code $codeVer" -ForegroundColor Green
} catch {
    Write-Host "  WARNING: VS Code khong tim thay trong PATH" -ForegroundColor Yellow
    Write-Host "  Cai tu: https://code.visualstudio.com/" -ForegroundColor Yellow
}

# ── Cai Continue Dev Extension ────────────────────────────────
Write-Host "[3/5] Cai Continue Dev extension..." -ForegroundColor Yellow
try {
    code --install-extension Continue.continue 2>$null
    Write-Host "  OK: Continue Dev da duoc cai" -ForegroundColor Green
} catch {
    Write-Host "  WARNING: Khong the cai extension tu CLI" -ForegroundColor Yellow
    Write-Host "  Cai thu cong: VS Code > Extensions > ghe 'Continue'" -ForegroundColor Yellow
}

# ── Cai DeepSeek Browser Agent ────────────────────────────────
Write-Host "[4/5] Cai DeepSeek Browser Agent..." -ForegroundColor Yellow
Push-Location "$PSScriptRoot\deepseek-browser-agent"
npm install
Pop-Location
Write-Host "  OK: DeepSeek Browser Agent da duoc cai" -ForegroundColor Green

# ── Copy config to Continue Dev ───────────────────────────────
Write-Host "[5/5] Copy config to Continue Dev..." -ForegroundColor Yellow
$continueDir = "$env:USERPROFILE\.continue"
$configSource = "$PSScriptRoot\configs\config-combined.yaml"
$configDest = "$continueDir\config.yaml"

# Backup config cu
if (Test-Path $configDest) {
    $backupName = "config.yaml.backup.$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Copy-Item $configDest "$continueDir\$backupName"
    Write-Host "  Da backup config cu: $backupName" -ForegroundColor Gray
}

# Copy config moi
Copy-Item $configSource $configDest -Force
Write-Host "  OK: Config da duoc copy" -ForegroundColor Green

# ── Tao shortcut ──────────────────────────────────────────────
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  CAI DAT THANH CONG!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Cach su dung:" -ForegroundColor Cyan
Write-Host ""
Write-Host "  1. Mo VS Code" -ForegroundColor White
Write-Host "  2. Ctrl+Shift+P > 'Continue: Open Chat'" -ForegroundColor White
Write-Host "  3. Chon model: 'DeepSeek Free (Browser)'" -ForegroundColor White
Write-Host ""
Write-Host "De chay DeepSeek Browser Agent:" -ForegroundColor Cyan
Write-Host ""
Write-Host "  cd deepseek-browser-agent" -ForegroundColor Gray
Write-Host "  node src/index.js --proxy" -ForegroundColor Gray
Write-Host ""
Write-Host "De chon config khac:" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Copy file tu configs/ vao $continueDir\config.yaml" -ForegroundColor Gray
Write-Host ""
