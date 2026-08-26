# Continue Dev + DeepSeek Browser Agent

> **AI Coding Assistant mien phi 100%** - Khong can API key, khong can GPU

## Overview

Goi nay bao gom:
- **Continue Dev** - AI coding assistant cho VS Code/JetBrains
- **DeepSeek Browser Agent** - Su dung DeepSeek qua browser (mien phi)
- **Nhieu config** - Chon model phu hop voi may cua ban

## Quick Start

### Windows (PowerShell)
```powershell
git clone https://github.com/vanhaix2game/continue-dev-deepseek.git
cd continue-dev-deepseek
.\scripts\install.ps1
```

### Linux/macOS
```bash
git clone https://github.com/vanhaix2game/continue-dev-deepseek.git
cd continue-dev-deepseek
chmod +x scripts/install.sh
./scripts/install.sh
```

### Manual Install

1. **Cai VS Code**: https://code.visualstudio.com/
2. **Cai Continue Dev**: VS Code > Extensions > tim "Continue"
3. **Cai Node.js**: https://nodejs.org/
4. **Cai DeepSeek Browser Agent**:
   ```bash
   cd deepseek-browser-agent
   npm install
   ```
5. **Copy config**:
   ```powershell
   Copy-Item configs\config-combined.yaml "$env:USERPROFILE\.continue\config.yaml"
   ```
6. **Chay proxy**:
   ```bash
   node src/index.js --proxy
   ```
7. **Mo VS Code** > Continue Dev > chon model **"DeepSeek Free (Browser)"**

## Models

### Mien phi 100%

| Model | Nguon | Yeu cau |
|-------|-------|---------|
| DeepSeek Free (Browser) | Browser agent | Node.js, Chrome |
| DeepSeek Coder 6.7B | Ollama local | RAM 8GB+ |
| Qwen Coder 32B | OpenRouter | API key free |

### Gan nhu mien phi

| Model | Cost | Nguon |
|-------|------|-------|
| DeepSeek V4 Flash | $0.14/1M tokens | DeepSeek API |
| DeepSeek V4 Pro | $0.87/1M tokens | DeepSeek API |

## Configs

Chon config phu hop trong `configs/`:

| File | Mo ta |
|------|-------|
| `config-free-browser.yaml` | DeepSeek Browser Agent (mien phi) |
| `config-ollama-local.yaml` | Ollama local (mien phi, can RAM) |
| `config-openrouter-free.yaml` | OpenRouter free models |
| `config-combined.yaml` | Tat ca models (recommended) |

Copy file config vao:
- **Windows**: `%USERPROFILE%\.continue\config.yaml`
- **Linux/macOS**: `~/.continue/config.yaml`

## Architecture

```
VS Code / Continue Dev
        |
        v
  OpenAI API (localhost:11434)
        |
        v
  DeepSeek Browser Agent (proxy)
        |
        v
  Chrome Browser (chat.deepseek.com)
```

## Usage

### Chay DeepSeek Browser Agent
```bash
cd deepseek-browser-agent
node src/index.js --proxy
```

### Chon model trong Continue Dev
1. Mo Continue Dev chat (Ctrl+Shift+P > "Continue: Open Chat")
2. Nhap tin nhan binh thuong
3. De chon model khac: nhan ten model o tren cung

### Chay Ollama local
```bash
# Cai Ollama
winget install Ollama.Ollama  # Windows
brew install ollama           # macOS

# Tai model
ollama pull deepseek-coder:6.7b

# Chay
ollama serve
```

## Troubleshooting

### Proxy khong ket noi
- Kiem tra: `http://localhost:11434/v1/status`
- Restart proxy: `node src/index.js --proxy`

### Continue Dev khong thay model
- Ctrl+Shift+P > "Continue: Refresh Models"
- Restart VS Code

### Browser bi loi
- Xoa session: `Remove-Item -Recurse $env:USERPROFILE\.deepseek-agent\session`
- Chay lai proxy va login lai

## License

MIT License

## Credits

- [Continue Dev](https://continue.dev/)
- [DeepSeek](https://deepseek.com/)
- [DeepSeek Browser Agent](https://github.com/Omar-Azam/deepseek-browser-agent)
