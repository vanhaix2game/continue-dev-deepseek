# Continue Dev + Browser AI Agents

> **AI Coding Assistant miễn phí 100%** — không cần API key, dùng browser (ChatGPT / DeepSeek)

## Tổng quan

Repo này chứa bộ tích hợp **Continue Dev** với 2 browser agent miễn phí:

| Agent | Công nghệ | Thư mục | Kết quả |
|-------|-----------|---------|---------|
| **ChatGPT (khuyên dùng)** | Puppeteer CDP + daemon, REAL Chrome profile | `chatgpt-browser-agent-master/` | ✅ Chạy tốt — chat + agentic loop + MCP (`mcp-cli.js`) |
| **DeepSeek** | Playwright persistent browser | `deepseek-browser-agent/` | Dual-mode (interactive + proxy) + tool `mcp_call` |

Ngoài ra còn nhiều config cho các nguồn model khác (OpenRouter free, Ollama local, API trả phí).

---

## 🔥 ChatGPT Browser Agent (hoạt động tốt nhất)

### Kiến trúc

```
Continue Dev (VS Code)
      │  OpenAI-compatible API: http://localhost:11436/v1
      ▼
openai-proxy.js  ──►  chatgpt daemon (chatgpt.js)
      │                    │  Puppeteer CDP connect
      │                    ▼
      │           Chrome REAL profile: ~/.chatgpt-cdp-profile
      │           (Port 9222, không automation flags)
      ▼
   chatgpt.com (tài khoản đã login)
```

**Bí quyết chống bot detection:**
- Chrome khởi động như **process OS bình thường** (không phải puppeteer.launch → không có automation flags)
- Kết nối qua **CDP** (`--remote-debugging-port=9222` + `puppeteer.connect`)
- Dùng **real Chrome profile** chứa session ChatGPT đã login
- Thư mục profile phải **khác thư mục mặc định** của Chrome (Chrome từ chối remote debugging trên `User Data` gốc)

### Cài đặt

```powershell
cd "D:\Project\AI\Continue dev\chatgpt-browser-agent-master"
npm install
```

### Setup login (1 lần, dùng Chrome THẬT)

```powershell
# 1. Xóa Chrome cũ
taskkill /IM chrome.exe /F

# 2. Copy profile có session ChatGPT (nếu có) sang thư mục non-default
$src  = "$env:LOCALAPPDATA\Google\Chrome\User Data\Profile 12"   # profile bạn hay dùng cho ChatGPT
$dst  = "$env:USERPROFILE\.chatgpt-cdp-profile\Default"
New-Item -ItemType Directory -Path $dst -Force
Copy-Item "$src\*" $dst -Recurse -Force

# 3. Mở Chrome với debug port
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 `
  --no-first-run --no-default-browser-check `
  --user-data-dir="$env:USERPROFILE\.chatgpt-cdp-profile" "https://chatgpt.com"

# 4. LOGIN ChatGPT trong cửa sổ Chrome đó (Chrome thật nên không bị chặn)
```

> Nếu chưa có profile nào login sẵn: mở Chrome (bước 3) rồi login thủ công bình thường — là được, vì đây là Chrome thật.

### Cách dùng

#### A) Chat với Continue Dev
```powershell
cd "D:\Project\AI\Continue dev\chatgpt-browser-agent-master"
node launcher.js
```
Trong Continue Dev chọn model **"ChatGPT Free (Direct)"**.

#### B) Agentic loop (ChatGPT tự chạy lệnh + sửa file)
```powershell
cd "D:\Project\AI\Continue dev\chatgpt-browser-agent-master"
node agent.js --auto --cwd "D:\path\to\project" "task mô tả"
```
- ChatGPT dùng `===RUN: <lệnh>===` → agent chạy shell, feed output lại
- ChatGPT dùng `===FILE: path===...===ENDFILE===` → agent ghi file
- `--auto`: không hỏi xác nhận. Bỏ `--auto`: duyệt từng lệnh/file.
- `--check "go build ./..."`: chạy lệnh kiểm tra sau mỗi lần sửa file, nếu fail thì gửi output lại cho ChatGPT tự sửa.

#### C) MCP server (dùng từ OpenCode / Claude Desktop)
```json
{
  "mcp": {
    "chatgpt": {
      "type": "local",
      "command": "node",
      "args": ["D:/Project/AI/Continue dev/chatgpt-browser-agent-master/mcp-server.js"]
    }
  }
}
```
Tools: `chatgpt_ask`, `chatgpt_status`, `chatgpt_stop`.

### Các file chính
| File | Mô tả |
|------|-------|
| `chatgpt.js` | Daemon CLI (launch/CDP, send prompt, stream wait) |
| `openai-proxy.js` | OpenAI-compatible proxy (port 11436) cho Continue Dev |
| `agent.js` | Agentic loop (===RUN=== / ===FILE=== / ===MCP===) |
| `mcp.js` + `mcp.json` | MCP stdio client (JSON-RPC) — nói chuyện với MCP server như ExceLLM |
| `mcp-cli.js` | CLI wrapper cho MCP: `node mcp-cli.js <server> <tool> '<json>'` |
| `mcp-server.js` | MCP server (JSON-RPC stdio) cho OpenCode/Claude |
| `launcher.js` | 1 lệnh khởi động Chrome + proxy |

---

## DeepSeek Browser Agent

Playwright-based, dual-mode:

```powershell
cd deepseek-browser-agent
npm install
node src/index.js --proxy          # proxy mode (port 11434)
node src/index.js --task "..."     # interactive mode
```

> Lưu ý: DeepSeek agent dùng `chat.deepseek.com`. Chrome mở ra → login → Enter.

---

## 🔌 MCP (điều khiển Excel THẬT bằng ExceLLM)

Cả 2 agent đều có thể gọi MCP server **ExceLLM** để đọc/ghi Excel đang mở (COM automation). Không cần API key — chỉ cần **Excel chạy** với workbook mở.

### Điều kiện
- Excel đang mở (có thể ẩn: `Visible=False`).
- MCP server `excellm` chạy được: `python -m excellm` (ExceLLM v1.28+, 34 tools).
- Test file mẫu: `C:\Users\CX-PC064\AppData\Local\Temp\opencode\mcp_test.xlsx` (sheet `Sheet`).

### Trong ChatGPT agent (mcp-cli.js)
```powershell
cd "D:\Project\AI\Continue dev\chatgpt-browser-agent-master"
node mcp-cli.js excellm list_open_workbooks '{}'
node mcp-cli.js excellm read '{"workbook_name":"mcp_test.xlsx","sheet_name":"Sheet","reference":"A1:B3"}'
```
agent.js prompt đã hướng dẫn ChatGPT gọi qua `===RUN: node mcp-cli.js <server> <tool> '<json>'===`.

### Trong DeepSeek agent (tool `mcp_call`)
```json
{"server":"excellm","tool":"list_open_workbooks","args":{}}
{"server":"excellm","tool":"read","args":{"workbook_name":"mcp_test.xlsx","sheet_name":"Sheet","reference":"A1:B3"}}
```
Tool `mcp_call` đã được define trong `deepseek-browser-agent/src/tools.js`, dùng client `src/mcp.js`.

### Lưu ý quan trọng
- ExceLLM tool list: `list_open_workbooks`, `read`, `write`, `search`, `manage_sheet`, `select_range`, `format`, `insert`, `delete`, `copy_range`, `sort_range`, `find_replace`, `explore`, `inspect_workbook`, `create_table`, `create_chart`, `create_pivot_table`, `execute_vba`, `capture_sheet`, ...
- Introspect trước khi đọc/ghi: gọi `list_open_workbooks` để biết tên workbook + sheet thật (vd sheet tên `Sheet` chứ không phải `Sheet1`).
- MCP client dùng `python -m excellm` mỗi lần gọi (1–2 giây), an toàn với bảng lớn.

---

## Continue Dev Config

Tất cả config lưu trong `configs/`:

| File | Mô tả |
|------|-------|
| `config-active-continue.yaml` | **Config ĐANG DÙNG** (backup từ `~/.continue/config.yaml`) |
| `config-free-browser.yaml` | DeepSeek/Playwright browser agents |
| `config-ollama-local.yaml` | Ollama local |
| `config-openrouter-free.yaml` | OpenRouter free models |
| `config-combined.yaml` | Tổng hợp nhiều nguồn |

### Vị trí config
- **Windows**: `%USERPROFILE%\.continue\config.yaml`
- **Linux/macOS**: `~/.continue/config.yaml`

### Model "ChatGPT Free (Direct)" — config đang dùng
```yaml
- name: "ChatGPT Free (Direct)"
  provider: openai
  model: chatgpt-free
  apiBase: http://localhost:11436/v1
  contextLength: 64000
  roles: [chat, edit, apply]
  capabilities: [tool_use]
```

---

## Troubleshooting

### `DevTools remote debugging requires a non-default data directory`
Chrome từ chối debug port khi `--user-data-dir` trỏ vào **User Data gốc**. Dùng thư mục riêng: `--user-data-dir="%USERPROFILE%\.chatgpt-cdp-profile"`.

### `Chrome debug port 9222 did not open`
Chrome đang mở chiếm profile. Xóa Chrome + dọn Singleton lock:
```powershell
taskkill /IM chrome.exe /F
Remove-Item "$env:USERPROFILE\.chatgpt-cdp-profile\Singleton*" -Force -EA SilentlyContinue
```
Rồi chạy lại launcher.

### `Daemon busy — try again in a moment`
Daemon xử lý 1 request/lần. Dừng proxy khi chạy agent nặng, hoặc đợi request trước xong.

### `Not logged in`
Chrome cần login ChatGPT. Mở cửa sổ do launcher tạo ra, login, quay lại. Nếu login bị chặn "Try a different browser" → đảm bảo Chrome mở bằng `--remote-debugging-port` + real profile (không dùng profile mặc định), KHÔNG quyền admin.

### Xóa toàn bộ session để setup lại
```powershell
Remove-Item "$env:USERPROFILE\.chatgpt-cdp-profile" -Recurse -Force
```

---

## Quy trình khởi động nhanh (sau khi đã setup login)

```powershell
taskkill /IM chrome.exe /F                             # dọn Chrome cũ (nếu có)
cd "D:\Project\AI\Continue dev\chatgpt-browser-agent-master"
node launcher.js                                       # Chrome + proxy tự bật
```
→ Chọn model **"ChatGPT Free (Direct)"** trong Continue Dev.

Cho agentic loop:
```powershell
node agent.js --auto --cwd "path\to\project" "task"
```

---

## License

MIT

## Credits
- [Continue Dev](https://continue.dev/)
- [chatgpt-browser-agent](https://github.com/abdallhMoukdad/chatgpt-browser-agent) (nền tảng CDP/daemon)
- [DeepSeek Browser Agent](https://github.com/Omar-Azam/deepseek-browser-agent)