#!/usr/bin/env node
/**
 * agent.js — Codex-style agentic loop using chatgpt.com via chatgpt.js daemon
 *
 * ChatGPT can explore the codebase itself by requesting shell commands:
 *   ===RUN: ls cmd/api/===
 *   ===RUN: cat internal/data/users.go===
 * The agent executes them automatically and feeds the output back.
 * File writes use ===FILE=== blocks and ask for approval (unless --auto).
 *
 * Usage:
 *   node agent.js [options] "task description"
 *
 * Options:
 *   --files  f1,f2,...   Seed files to include upfront (optional)
 *   --check  "cmd"       Command to run after applying changes (e.g. "go build ./...")
 *   --cwd    /path       Working directory (default: process.cwd())
 *   --auto               Apply file changes without confirmation prompts
 *
 * Example:
 *   node agent.js --check "go build ./..." --cwd ~/GolandProjects/steroidCycleTracker \
 *     "add input validation to createUserHandler"
 */

'use strict';

const { spawnSync } = require('child_process');
const fs            = require('fs');
const path          = require('path');
const readline      = require('readline');
const mcp           = require('./mcp');

const SCRIPT    = path.join(__dirname, 'chatgpt.js');
const MAX_TURNS = 20; // safety cap on autonomous turns

// ─── CLI parsing ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { files: [], check: null, cwd: process.cwd(), auto: false, task: null };
  for (let i = 0; i < argv.length; i++) {
    if      (argv[i] === '--files') args.files = argv[++i].split(',').map(s => s.trim());
    else if (argv[i] === '--check') args.check = argv[++i];
    else if (argv[i] === '--cwd')   args.cwd   = path.resolve(argv[++i]);
    else if (argv[i] === '--auto')  args.auto  = true;
    else                            args.task  = argv[i];
  }
  return args;
}

// ─── ChatGPT call ─────────────────────────────────────────────────────────────

function ask(prompt, isNew = false) {
  const flags = [];
  if (isNew) flags.push('--new');
  flags.push(prompt);

  const result = spawnSync('node', [SCRIPT, ...flags], {
    encoding:  'utf8',
    timeout:   300_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return (result.stdout || '').trim() || (result.stderr || '').trim() || '(no response)';
}

// ─── Build MCP tool description ──────────────────────────────────────────────

async function mcpToolsDescription() {
  const servers = mcp.loadServers();
  const names = Object.keys(servers);
  if (names.length === 0) return '';

  const parts = [];
  for (const name of names) {
    try {
      const { tools } = await mcp.listTools(name, servers[name]);
      const lines = tools.map(t => {
        const first = (t.description || '').split('\n')[0].trim();
        return `- ${t.name}${first ? ': ' + first : ''}`;
      });
      parts.push(`MCP server "${name}": ${tools.length} tools\n${lines.join('\n')}`);
    } catch (e) {
      parts.push(`MCP server "${name}" unavailable: ${e.message}`);
    }
  }
  return parts.join('\n\n');
}

// ─── Build initial prompt ─────────────────────────────────────────────────────

function buildInitialPrompt(task, files, cwd, mcpDesc) {
  let prompt = '';

  if (files.length > 0) {
    prompt += `Here are some relevant files to start with:\n\n`;
    for (const f of files) {
      const fullPath = path.isAbsolute(f) ? f : path.join(cwd, f);
      const content  = fs.readFileSync(fullPath, 'utf8');
      prompt += `===FILE: ${f}===\n${content}\n===ENDFILE===\n\n`;
    }
  }

  prompt +=
    `Task: ${task}\n` +
    `Working directory: ${cwd}\n\n` +
    `You are a coding agent with access to the user's filesystem and MCP tools.\n` +
    `Use these plain-text formats — no markdown, no code fences:\n\n` +
    `To run a shell command (ls, cat, grep, go build, etc.):\n` +
    `===RUN: <command>===\n\n` +
    `To create or modify a file (output COMPLETE file content):\n` +
    `===FILE: path/to/file===\n` +
    `<complete content>\n` +
    `===ENDFILE===\n\n`;

  if (mcpDesc) {
    prompt +=
      `ACHTUNG — very important. You CAN call MCP tools. The RELIABLE way is via the shell CLI:\n` +
      `===RUN: node mcp-cli.js <server> <tool> '<json-args>'===\n\n` +
      `Examples:
===RUN: node mcp-cli.js excellm list_open_workbooks '{}'===
===RUN: node mcp-cli.js excellm read '{"workbook_name":"mcp_test.xlsx","sheet_name":"Sheet","reference":"A1:C3"}'===
===RUN: node mcp-cli.js excellm write '{"reference":"D1","data":99}'===\n\n` +
      `The ===MCP: server.tool===  block format also works as an alternative:
===MCP: excellm.read===
{"reference":"A1:C5"}
===ENDMCP===` +
      `\n\nYou will receive each tool's output automatically.\n\n` +
      `Available MCP tools by server:\n${mcpDesc}\n\n`;
  }

  prompt +=
    `Rules:\n` +
    `- Start by exploring if you need more context (ls, cat, grep, node mcp-cli.js ...).\n` +
    `- You will receive the output of each RUN command and MCP call automatically.\n` +
    `- To inspect or edit Excel/real live files, ALWAYS use the excellm MCP tools via node mcp-cli.js.\n` +
    `- Only output FILE blocks when you are ready to make changes.\n` +
    `- You can mix RUN, MCP and FILE blocks in one response.\n` +
    `- After file blocks, briefly explain what you changed and why.`;

  return prompt;
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

function parseRunBlocks(response) {
  const commands = [];
  const regex    = /===RUN:\s*([^\n=][^\n]*)===/g;
  let match;
  while ((match = regex.exec(response)) !== null) {
    commands.push(match[1].trim());
  }
  return commands;
}

function parseFileBlocks(response) {
  const changes = [];
  const regex   = /===FILE:\s*([^\n=]+)===\n([\s\S]*?)===ENDFILE===/g;
  let match;
  while ((match = regex.exec(response)) !== null) {
    changes.push({ path: match[1].trim(), content: match[2] });
  }
  return changes;
}

function parseMcpBlocks(response) {
  const calls = [];
  const regex = /===MCP:\s*([A-Za-z0-9_.\-]+)===\n?([\s\S]*?)===ENDMCP===/g;
  let match;
  while ((match = regex.exec(response)) !== null) {
    const full = match[1].trim();
    const dot  = full.indexOf('.');
    if (dot < 1) continue;
    const argsRaw = (match[2] || '').trim();
    let args = {};
    if (argsRaw) { try { args = JSON.parse(argsRaw); } catch {} }
    calls.push({ server: full.slice(0, dot), tool: full.slice(dot + 1), args });
  }
  return calls;
}

// ─── User input helper ────────────────────────────────────────────────────────

function askUser(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

// ─── Execute RUN commands ─────────────────────────────────────────────────────

async function execCommands(commands, cwd, auto) {
  const results = [];
  for (const cmd of commands) {
    console.log(`\n$ ${cmd}`);
    let run = 'y';
    if (!auto) {
      run = await askUser('Run this command? [y/n] ');
    }
    if (run === 'y' || run === '') {
      const result = spawnSync(cmd, { shell: true, encoding: 'utf8', cwd, timeout: 30_000 });
      const output = (result.stdout + result.stderr).trim() || '(no output)';
      console.log(output);
      results.push({ cmd, output });
    } else {
      console.log('  ✗ Skipped');
      results.push({ cmd, output: '(skipped by user)' });
    }
  }
  return results;
}

function buildCommandResults(results) {
  return results
    .map(r => `$ ${r.cmd}\n${r.output}`)
    .join('\n\n');
}

// ─── Execute MCP tool calls ───────────────────────────────────────────────────

async function execMcp(calls) {
  const results = [];
  for (const c of calls) {
    console.log(`\n[MCP] ${c.server}.${c.tool} ${Object.keys(c.args).length ? JSON.stringify(c.args) : ''}`);
    try {
      const output = await mcp.callTool(c.server, c.tool, c.args);
      console.log(output);
      results.push({ server: c.server, tool: c.tool, args: c.args, output });
    } catch (err) {
      console.log(`  ✗ ${err.message}`);
      results.push({ server: c.server, tool: c.tool, args: c.args, output: `(error) ${err.message}` });
    }
  }
  return results;
}

function buildMcpResults(results) {
  return results
    .map(r => `[MCP ${r.server}.${r.tool}] args=${JSON.stringify(r.args)}\n${r.output}`)
    .join('\n\n');
}

// ─── Apply file changes to disk ───────────────────────────────────────────────

async function applyChanges(changes, cwd, auto) {
  if (changes.length === 0) return;

  for (const change of changes) {
    const fullPath = path.isAbsolute(change.path)
      ? change.path
      : path.join(cwd, change.path);

    console.log(`\n─── ${change.path} (${change.content.split('\n').length} lines) ───`);

    let apply = 'y';
    if (!auto) {
      const lines     = change.content.split('\n');
      const preview   = lines.slice(0, 20).join('\n');
      const truncated = lines.length > 20;
      console.log(preview + (truncated ? '\n  ...(truncated — type "show" to see all)' : ''));

      apply = await askUser('Apply? [y/n/show] ');
      if (apply === 'show') {
        console.log('\n' + change.content);
        apply = await askUser('Apply? [y/n] ');
      }
    }

    if (apply === 'y' || apply === '') {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, change.content);
      console.log(`  ✓ Written: ${change.path}`);
    } else {
      console.log(`  ✗ Skipped: ${change.path}`);
    }
  }
}

// ─── Run check command ────────────────────────────────────────────────────────

function runCheck(cmd, cwd) {
  console.log(`\n[check] $ ${cmd}`);
  const result = spawnSync(cmd, { shell: true, encoding: 'utf8', cwd });
  const output = (result.stdout + result.stderr).trim();
  console.log(output || '(no output)');
  return { output, failed: result.status !== 0 };
}

// ─── Main loop ────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.task) {
    console.error(
      'Usage: node agent.js [--files f1,f2] [--check "cmd"] [--cwd /path] [--auto] "task"\n' +
      'Example: node agent.js --check "go build ./..." --cwd ~/project "add validation to createUserHandler"'
    );
    process.exit(1);
  }

  console.log(`\nTask : ${args.task}`);
  console.log(`CWD  : ${args.cwd}`);
  if (args.files.length) console.log(`Files: ${args.files.join(', ')}`);
  if (args.check)        console.log(`Check: ${args.check}`);
  console.log('');

  const mcpDesc = await mcpToolsDescription();
  if (mcpDesc) console.log(`[mcp] {"ok":true} MCP tools injected into prompt\n`);

  let prompt  = buildInitialPrompt(args.task, args.files, args.cwd, mcpDesc);
  let isNew   = true;
  let turns   = 0;

  // ── Autonomous loop ────────────────────────────────────────────────────────
  while (turns < MAX_TURNS) {
    turns++;
    console.log(`\nSending to ChatGPT... (turn ${turns})\n`);
    const response = ask(prompt, isNew);
    isNew = false;

    console.log('── ChatGPT ──────────────────────────────────────────────\n');
    console.log(response);
    console.log('\n─────────────────────────────────────────────────────────');

    const runCmds = parseRunBlocks(response);
    const changes = parseFileBlocks(response);
    const mcpCalls = parseMcpBlocks(response);

    // ── Execute requested commands / MCP calls ───────────────────────────────
    if (runCmds.length > 0 || mcpCalls.length > 0) {
      // Apply file changes BEFORE running anything (files may be needed)
      if (changes.length > 0) {
        await applyChanges(changes, args.cwd, args.auto);
        if (args.check) runCheck(args.check, args.cwd);
      }
      const results = [];
      if (mcpCalls.length > 0) {
        const mcpResults = await execMcp(mcpCalls);
        results.push(buildMcpResults(mcpResults));
      }
      if (runCmds.length > 0) {
        const cmdResults = await execCommands(runCmds, args.cwd, args.auto);
        results.push(buildCommandResults(cmdResults));
      }
      // Feed results back automatically — no user input needed
      prompt = results.filter(Boolean).join('\n\n');
      continue; // next autonomous turn
    }

    // ── Apply file changes ───────────────────────────────────────────────────
    if (changes.length > 0) {
      await applyChanges(changes, args.cwd, args.auto);
      if (args.check) {
        const check = runCheck(args.check, args.cwd);
        // If check failed, feed output back and let ChatGPT fix it
        if (check.failed) {
          console.log('\n[check failed — sending output back to ChatGPT]');
          prompt = `The check command failed. Here is the output:\n\n${check.output}\n\nPlease fix the errors.`;
          continue;
        }
      }
    }

    // ── No autonomous actions left — ask the user ────────────────────────────
    const next = await askUser('\nNext step (or "done"): ');
    if (!next || next.toLowerCase() === 'done') break;
    prompt = next;
  }

  if (turns >= MAX_TURNS) console.log(`\n[stopped after ${MAX_TURNS} autonomous turns]`);
  console.log('\nDone.');
}

main().catch(err => { console.error(err); process.exit(1); });
