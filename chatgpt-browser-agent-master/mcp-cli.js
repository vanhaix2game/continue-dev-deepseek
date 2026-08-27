'use strict';
/**
 * mcp-cli.js — Gọi 1 MCP tool từ command line, in kết quả ra stdout.
 * Dùng như cầu nối cho agent.js qua ===RUN=== (ChatGPT dùng shell chắc chắn hơn block MCP).
 *
 * Usage:
 *   node mcp-cli.js <server> <tool> '<json-args>'
 *   node mcp-cli.js excellm read '{"reference":"A1:C5"}'
 *   node mcp-cli.js excellm list_open_workbooks '{}'
 */

const mcp = require('./mcp');

async function main() {
  const [server, tool, argsRaw] = process.argv.slice(2);
  if (!server || !tool) {
    console.error('Usage: node mcp-cli.js <server> <tool> \'<json-args>\'');
    console.error('Servers: ' + Object.keys(mcp.loadServers()).join(', '));
    process.exit(1);
  }
  let args = {};
  if (argsRaw) { try { args = JSON.parse(argsRaw); } catch { console.error('Invalid JSON args'); process.exit(1); } }
  const out = await mcp.callTool(server, tool, args);
  console.log(out);
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });