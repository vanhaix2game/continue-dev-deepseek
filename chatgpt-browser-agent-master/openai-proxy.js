#!/usr/bin/env node
/**
 * openai-proxy.js — OpenAI-compatible proxy wrapping the chatgpt-browser-agent daemon.
 *
 * Continue Dev (or any OpenAI-compatible client) talks to this proxy via /v1/chat/completions.
 * The proxy forwards the prompt to the chatgpt daemon (chatgpt.js) which drives the real
 * Chrome-connected ChatGPT browser, then streams the reply back as SSE.
 *
 * Usage:  node openai-proxy.js [--port 11436] [--model chatgpt-free]
 */

'use strict';

const http  = require('http');
const fs    = require('fs');
const os    = require('os');
const path  = require('path');
const { spawn } = require('child_process');

const DAEMON_FILE = path.join(os.homedir(), '.chatgpt-poc-daemon.json');
const AGENT_DIR   = __dirname;

const DEFAULTS = {
  port:  11436,
  model: 'chatgpt-free',
};

function readDaemonState() {
  try {
    const state = JSON.parse(fs.readFileSync(DAEMON_FILE, 'utf8'));
    process.kill(state.pid, 0); // throws if dead
    return state;
  } catch { return null; }
}

async function ensureDaemon(log) {
  let state = readDaemonState();
  if (state) return state.port;

  log('[proxy] Starting chatgpt daemon...');
  const child = spawn(process.execPath, [path.join(AGENT_DIR, 'chatgpt.js'), '--daemon-internal'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1_000));
    state = readDaemonState();
    if (state) return state.port;
  }
  throw new Error('Daemon did not start. Check ~/.chatgpt-poc-daemon.log');
}

function httpPost(port, endpoint, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1', port, path: endpoint, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      },
      res => {
        let raw = '';
        res.on('data', c => (raw += c));
        res.on('end', () => {
          try { resolve(JSON.parse(raw)); }
          catch { reject(new Error('Invalid JSON from daemon')); }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ─── Convert OpenAI messages → single prompt ─────────────────────────────────
function messagesToPrompt(messages) {
  const parts = [];
  for (const m of messages) {
    const role = m.role || 'user';
    const content = Array.isArray(m.content)
      ? m.content.map(c => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n')
      : (m.content || '');
    if (role === 'system') {
      parts.push(`[System]\n${content}`);
    } else if (role === 'user') {
      parts.push(`[User]\n${content}`);
    } else if (role === 'assistant') {
      // Skip tool_use artifacts; keep plain text
      if (typeof content === 'string' && !content.includes('"toolCall"') && !content.includes('tool_use')) {
        parts.push(`[Assistant]\n${content}`);
      }
    }
  }
  return parts.join('\n\n');
}

function extractCodeBlocks(text) {
  const blocks = [];
  const re = /```[\w]*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text)) !== null) blocks.push(m[1].trimEnd());
  return blocks.length > 0 ? blocks.join('\n\n') : text;
}

// ─── SSE helpers ─────────────────────────────────────────────────────────────
function sendChunk(res, id, model, delta, finishReason = null) {
  const chunk = {
    id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

// ─── HTTP server ─────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
let PORT = DEFAULTS.port;
let MODEL = DEFAULTS.model;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--port') PORT = parseInt(argv[i + 1], 10);
  if (argv[i] === '--model') MODEL = argv[i + 1];
}

const server = http.createServer(async (req, res) => {
  // ── CORS ──────────────────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── GET /v1/models ────────────────────────────────────────────────────────
  if (req.method === 'GET' && (req.url === '/v1/models' || req.url === '/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      object: 'list',
      data: [
        { id: MODEL, object: 'model', owned_by: 'chatgpt-browser' },
        { id: 'chatgpt-4o', object: 'model', owned_by: 'chatgpt-browser' },
      ],
    }));
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── POST /v1/chat/completions ─────────────────────────────────────────────
  if (req.method === 'POST' && /\/chat\/completions$/.test(req.url)) {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', async () => {
      let parsed;
      try { parsed = JSON.parse(body); } catch { res.end('Invalid JSON'); return; }

      const messages  = parsed.messages || [];
      const model     = parsed.model || MODEL;
      const stream    = parsed.stream !== false;
      const reqId     = 'chatcmpl-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      // Fresh thread (<=2 messages) → start a new ChatGPT chat; otherwise continue the page
      const newChat   = messages.length <= 2;

      const prompt = messagesToPrompt(messages);

      if (stream) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        // initial role chunk
        sendChunk(res, reqId, model, { role: 'assistant', content: '' });

        try {
          const port  = await ensureDaemon(console.log);
          const flags = newChat ? '--new ' : '';
          // NOTE: spawnSync-style call via /ask is blocking for 5min max.
          const result = await httpPost(port, '/ask', {
            fullPrompt: prompt,
            codeOnly: false,
            newChat: !!newChat,
            uploadPath: null,
          });
          if (!result.ok) throw new Error(result.error || 'Daemon error');
          const text = result.response;

          // Stream the text in chunks
          const CHUNK = 64;
          for (let i = 0; i < text.length; i += CHUNK) {
            sendChunk(res, reqId, model, { content: text.slice(i, i + CHUNK) });
            await new Promise(r => setTimeout(r, 10));
          }
          sendChunk(res, reqId, model, {}, 'stop');
          res.write('data: [DONE]\n\n');
          res.end();
        } catch (err) {
          sendChunk(res, reqId, model, { content: `\n\n[Proxy error: ${err.message}]` }, 'stop');
          res.write('data: [DONE]\n\n');
          res.end();
        }
      } else {
        // Non-streaming: buffer then send one JSON response
        res.writeHead(200, { 'Content-Type': 'application/json' });
        try {
          const port  = await ensureDaemon(console.log);
          const result = await httpPost(port, '/ask', {
            fullPrompt: prompt,
            codeOnly: false,
            newChat: !!newChat,
            uploadPath: null,
          });
          if (!result.ok) throw new Error(result.error || 'Daemon error');
          const json = {
            id: reqId, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model,
            choices: [{ index: 0, message: { role: 'assistant', content: result.response }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          };
          res.end(JSON.stringify(json));
        } catch (err) {
          res.end(JSON.stringify({ error: { message: err.message } }));
        }
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[proxy] ChatGPT Browser Proxy listening on http://0.0.0.0:${PORT}`);
  console.log(`[proxy] Model: ${MODEL}  |  Daemon: auto-start`);
});