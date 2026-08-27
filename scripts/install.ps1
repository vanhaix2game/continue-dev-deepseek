# ============================================================
# Install Script - Continue Dev + Browser AI Agents
# (ChatGPT CDP + DeepSeek Playwright)
# ============================================================
# Chay trong PowerShell: .\install.ps1
# ============================================================

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Continue Dev + Browser AI Agents" -ForegroundColor Cyan
Write-Host "  (ChatGPT CDP + DeepSeek)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ── Kiem tra Node.js ──────────────────────────────────────────
Write-Host "[1/6] Kiem tra Node.js..." -ForegroundColor Yellow
try {
    $nodeVer = node --version
    Write-Host "  OK: $nodeVer" -ForegroundColor Green
} catch {
    Write-Host "  ERROR: Node.js chua cai dat!" -ForegroundColor Red
    Write-Host "  Tai tai: https://nodejs.org/" -ForegroundColor Yellow
    Write-Host "  Hoac chay: winget install OpenJS.NodeJS.LTS" -ForegroundColor Yellow
    exit 1
}

# ── Kiem tra Chrome ───────────────────────────────────────────
Write-Host "[2/6] Kiem tra Google Chrome..." -ForegroundColor Yellow
$chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (Test-Path $chromePath) {
    Write-Host "  OK: Chrome found" -ForegroundColor Green
} else {
    Write-Host "  WARNING: Chrome chua tim thay tai $chromePath" -ForegroundColor Yellow
    Write-Host "  Cai Chrome: https://www.google.com/chrome/" -ForegroundColor Yellow
}

# ── Kiem tra VS Code ──────────────────────────────────────────
Write-Host "[3/6] Kiem tra VS Code..." -ForegroundColor Yellow
try {
    $codeVer = code --version 2>$null | Select-Object -First 1
    Write-Host "  OK: VS Code $codeVer" -ForegroundColor Green
} catch {
    Write-Host "  WARNING: VS Code khong tim thay trong PATH" -ForegroundColor Yellow
    Write-Host "  Cai tu: https://code.visualstudio.com/" -ForegroundColor Yellow
}

# ── Cai Continue Dev Extension ────────────────────────────────
Write-Host "[4/6] Cai Continue Dev extension..." -ForegroundColor Yellow
try {
    code --install-extension Continue.continue 2>$null
    Write-Host "  OK: Continue Dev da duoc cai" -ForegroundColor Green
} catch {
    Write-Host "  WARNING: Khong the cai extension tu CLI" -ForegroundColor Yellow
    Write-Host "  Cai thu cong: VS Code > Extensions > ghe 'Continue'" -ForegroundColor Yellow
}

# ── Cai ChatGPT Browser Agent (CDP daemon) ────────────────────
Write-Host "[5/6] Cai ChatGPT Browser Agent..." -ForegroundColor Yellow
Push-Location "$PSScriptRoot\chatgpt-browser-agent-master"
npm install
Pop-Location
Write-Host "  OK: ChatGPT Browser Agent da duoc cai" -ForegroundColor Green

# ── Cai DeepSeek Browser Agent ────────────────────────────────
Write-Host "[5b/6] Cai DeepSeek Browser Agent..." -ForegroundColor Yellow
Push-Location "$PSScriptRoot\deepseek-browser-agent"
npm install
Pop-Location
Write-Host "  OK: DeepSeek Browser Agent da duoc cai" -ForegroundColor Green

# ── Copy config to Continue Dev ───────────────────────────────
Write-Host "[6/6] Copy config to Continue Dev..." -ForegroundColor Yellow
$continueDir = "$env:USERPROFILE\.continue"
$configSource = "$PSScriptRoot\configs\config-active-continue.yaml"
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

# ── Setup ChatGPT login profile (neu chua co) ─────────────────
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  CAI DAT THANH CONG!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Buoc tiep theo - SETUP LOGIN ChatGPT:" -ForegroundColor Cyan
Write-Host ""
Write-Host "  1. Dong het Chrome: taskkill /IM chrome.exe /F" -ForegroundColor White
Write-Host "  2. Mo Chrome vao profile ChatGPT (1 lan dau tien):" -ForegroundColor White
Write-Host "     & `"C:\Program Files\Google\Chrome\Application\chrome.exe`" --remote-debugging-port=9222 --user-data-dir=`"$env:USERPROFILE\.chatgpt-cdp-profile`" https://chatgpt.com" -ForegroundColor Gray
Write-Host "  3. LOGIN ChatGPT trong cua so Chrome do, roi dong lai" -ForegroundColor White
Write-Host ""
Write-Host "Cach su dung ChatGPT:"
Write-Host ""
Write-Host "  cd chatgpt-browser-agent-master" -ForegroundColor Gray
Write-Host "  node launcher.js              # Chrome + proxy (port 11436)" -ForegroundColor Gray
Write-Host "  -> Continue Dev chon model 'ChatGPT Free (Direct)'" -ForegroundColor Gray
Write-Host ""
Write-Host "  # Agentic loop (ChatGPT tu chay lenh + sua file):" -ForegroundColor Gray
Write-Host "  node agent.js --auto --cwd D:\path\to\project \"task\"" -ForegroundColor Gray
Write-Host ""
Write-Host "Cach su dung DeepSeek:"
Write-Host ""
Write-Host "  cd deepseek-browser-agent" -ForegroundColor Gray
Write-Host "  node src/index.js --proxy      # proxy (port 11434)" -ForegroundColor Gray
Write-Host ""