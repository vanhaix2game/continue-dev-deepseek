#!/bin/bash
# ============================================================
# Install Script - Continue Dev + DeepSeek Browser Agent
# ============================================================
# Chay: chmod +x install.sh && ./install.sh
# ============================================================

set -e

echo ""
echo "========================================"
echo "  Continue Dev + DeepSeek Agent Setup"
echo "========================================"
echo ""

# ── Kiem tra Node.js ──────────────────────────────────────────
echo "[1/5] Kiem tra Node.js..."
if command -v node &> /dev/null; then
    echo "  OK: $(node --version)"
else
    echo "  ERROR: Node.js chua cai dat!"
    echo "  Tai tai: https://nodejs.org/"
    echo "  Hoac chay: brew install node (macOS)"
    exit 1
fi

# ── Kiem tra VS Code ──────────────────────────────────────────
echo "[2/5] Kiem tra VS Code..."
if command -v code &> /dev/null; then
    echo "  OK: VS Code"
else
    echo "  WARNING: VS Code khong tim thay trong PATH"
fi

# ── Cai Continue Dev Extension ────────────────────────────────
echo "[3/5] Cai Continue Dev extension..."
code --install-extension Continue.continue 2>/dev/null || true
echo "  OK: Continue Dev extension"

# ── Cai DeepSeek Browser Agent ────────────────────────────────
echo "[4/5] Cai DeepSeek Browser Agent..."
cd "$(dirname "$0")/deepseek-browser-agent"
npm install
cd ..
echo "  OK: DeepSeek Browser Agent"

# ── Copy config to Continue Dev ───────────────────────────────
echo "[5/5] Copy config to Continue Dev..."
CONTINUE_DIR="$HOME/.continue"
CONFIG_SRC="$(dirname "$0")/configs/config-combined.yaml"
CONFIG_DEST="$CONTINUE_DIR/config.yaml"

mkdir -p "$CONTINUE_DIR"

if [ -f "$CONFIG_DEST" ]; then
    BACKUP="$CONFIG_DEST.backup.$(date +%Y%m%d-%H%M%S)"
    cp "$CONFIG_DEST" "$BACKUP"
    echo "  Da backup: $BACKUP"
fi

cp "$CONFIG_SRC" "$CONFIG_DEST"
echo "  OK: Config copied"

# ── Hoan thanh ────────────────────────────────────────────────
echo ""
echo "========================================"
echo "  CAI DAT THANH CONG!"
echo "========================================"
echo ""
echo "Cach su dung:"
echo ""
echo "  1. Mo VS Code"
echo "  2. Ctrl+Shift+P > 'Continue: Open Chat'"
echo "  3. Chon model: 'DeepSeek Free (Browser)'"
echo ""
echo "De chay DeepSeek Browser Agent:"
echo ""
echo "  cd $(dirname "$0")/deepseek-browser-agent"
echo "  node src/index.js --proxy"
echo ""
