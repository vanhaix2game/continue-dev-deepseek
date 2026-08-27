'use strict';
/**
 * mcp.js — MCP stdio client tối giản cho agent.js
 * Spawn MCP server (JSON-RPC over stdio), list tools, call tool.
 * Không phụ thuộc thư viện ngoài — chạy bằng Node core.
 */

const { spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, 'mcp.json');
const TIMEOUT_MS  = 60_000;

function loadServers() {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return raw.mcpServers || raw || {};
  } catch {
    return {};
  }
}

// Gửi 1 JSON-RPC request tới process, chờ response khớp id.
function request(proc, method, params) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 0x7fffffff);
    const payload = { jsonrpc: '2.0', id, method, params: params || {} };
    let buffer = '';
    const timer = setTimeout(() => {
      cleanup(); reject(new Error(`MCP timeout (${method})`));
    }, TIMEOUT_MS);

    const onData = c => {
      buffer += c.toString('utf8');
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === id) { cleanup(); resolve(msg); return; }
      }
    };
    const onErr = d => { /* swallow stderr */ };

    function cleanup() {
      clearTimeout(timer);
      proc.stdout.removeListener('data', onData);
      proc.stderr.removeListener('data', onErr);
    }

    proc.stdout.on('data', onData);
    proc.stderr.on('data', onErr);

    try { proc.stdin.write(JSON.stringify(payload) + '\n'); }
    catch (e) { cleanup(); reject(e); }
  });
}

// Bọc: spawn server mới → initialize → chạy fn → kill.
async function withServer(spec, fn) {
  const proc = spawn(spec.command, spec.args || [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
    env: { ...process.env, ...(spec.env || {}) },
  });

  let exited = false;
  proc.on('error', e => { exited = true; throw e; });
  proc.on('exit', () => { exited = true; });

  try {
    const init = await request(proc, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'chatgpt-agent', version: '1.0' },
    });
    if (init.error) throw new Error(`MCP ${spec.command}: ${init.error.message}`);
    if (init.result && init.result.instructions) {
      // description chỉ dùng để tham khảo
    }
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
    return await fn(proc);
  } catch (e) {
    if (e.message && e.message.startsWith('MCP timeout')) {
      throw new Error(`MCP server "${spec.command}" không phản hồi (có chạy được không?)`);
    }
    throw e;
  } finally {
    try { proc.kill(); } catch {}
    if (!exited) setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 500);
  }
}

async function listTools(name, spec) {
  return withServer(spec, async proc => {
    const res = await request(proc, 'tools/list');
    const tools = (res.result && res.result.tools) || [];
    return {
      name,
      tools: tools.map(t => ({
        name: t.name,
        description: t.description || '',
        schema: t.inputSchema || {},
      })),
    };
  });
}

async function callTool(serverName, toolName, args) {
  const spec = loadServers()[serverName];
  if (!spec) throw new Error(`MCP server "${serverName}" không có trong mcp.json`);
  return withServer(spec, async proc => {
    const res = await request(proc, 'tools/call', { name: toolName, arguments: args || {} });
    if (res.error) throw new Error(`${serverName}.${toolName}: ${res.error.message}`);
    const content = (res.result && res.result.content) || [];
    const structured = res.result && res.result.structuredContent;
    const texts = content.filter(c => c.type === 'text').map(c => c.text).join('\n');
    if (texts) return texts;
    if (structured !== undefined) return JSON.stringify(structured, null, 2);
    return '(empty result)';
  });
}

module.exports = { loadServers, listTools, callTool };