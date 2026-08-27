/*
 * ChatGPT Browser Agent — Start All
 * Chạy: node launcher.js            (chế độ daemon/proxy cho Continue Dev)
 * Hoặc: node launcher.js --agent    (chế độ agentic loop — tự chạy lệnh/ghi file)
 */
'use strict';

const { spawn } = require('child_process');
const os   = require('os');
const path = require('path');
const fs   = require('fs');

const AGENT_DIR = __dirname;
const CHROME    = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE   = path.join(os.homedir(), '.chatgpt-cdp-profile');
const DEBUG_PORT = 9222;

async function portOpen(port) {
  try { await fetch(`http://127.0.0.1:${port}/json/version`); return true; }
  catch { return false; }
}

async function ensureChrome() {
  if (await portOpen(DEBUG_PORT)) {
    console.log(`[launcher] Chrome already running on port ${DEBUG_PORT}`);
    return;
  }
  console.log('[launcher] Starting Chrome with ChatGPT profile...');
  for (const lock of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    try { fs.unlinkSync(path.join(PROFILE, lock)); } catch {}
  }
  const child = spawn(CHROME, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=' + PROFILE,
    'https://chatgpt.com',
  ], { detached: true, stdio: 'ignore' });
  child.unref();

  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    if (await portOpen(DEBUG_PORT)) {
      console.log(`[launcher] Chrome ready on port ${DEBUG_PORT}`);
      return;
    }
    await new Promise(r => setTimeout(r, 800));
  }
  throw new Error(`Chrome did not open port ${DEBUG_PORT}. Is another Chrome using it?`);
}

async function main() {
  const args = process.argv.slice(2);
  const agentMode = args.includes('--agent');

  await ensureChrome();

  if (agentMode) {
    console.log('[launcher] Agent mode. Dùng:');
    console.log(`  cd "${AGENT_DIR}"`);
    console.log('  node agent.js --auto --cwd <project> "task description"');
    console.log('  (--auto không hỏi xác nhận; bỏ --auto nếu muốn duyệt từng thay đổi)');
    return;
  }

  // Proxy mode — cho Continue Dev
  const PROXY_PORT = 11436;
  try {
    const r = await fetch(`http://127.0.0.1:${PROXY_PORT}/health`);
    if (r.ok) {
      console.log(`[launcher] Proxy already running: http://localhost:${PROXY_PORT}`);
      console.log('[launcher] Model: "ChatGPT Free (Direct)" trong Continue Dev');
      return;
    }
  } catch {}

  const proxy = spawn('node', ['openai-proxy.js', '--port', String(PROXY_PORT)], {
    cwd: AGENT_DIR,
    stdio: 'inherit',
  });
  console.log(`[launcher] ChatGPT Proxy for Continue Dev: http://localhost:${PROXY_PORT}`);
  console.log('[launcher] Model: "ChatGPT Free (Direct)" trong Continue Dev');
  proxy.on('exit', c => console.log(`[launcher] Proxy exited (${c})`));
}

main().catch(e => { console.error('[launcher] ERROR:', e.message); process.exit(1); });