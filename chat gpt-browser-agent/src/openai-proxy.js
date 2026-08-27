// src/openai-proxy.js — OpenAI-compatible API proxy for ChatGPT Browser Agent
// Fully compatible with Continue Dev: streaming, tool calling, conversation
'use strict';

const http      = require('http');
const fs        = require('fs');
const path      = require('path');
const config    = require('./config');
const logger    = require('./logger');
const ChatGPTAgent = require('./agent');
const { ConversationManager, buildSystemPrompt } = require('./prompt');

const PROXY_PORT = config.PROXY_PORT || 11434;

let agent        = null;
let server       = null;

// ── Per-request state ────────────────────────────────────────────────────────
const sessions = new Map(); // sessionId -> { conversation, agent }

function getOrCreateSession(sessionId) {
  if (!sessions.has(sessionId)) {
    const conversation = new ConversationManager();
    sessions.set(sessionId, { conversation, busy: false });
  }
  return sessions.get(sessionId);
}

// ── OpenAI Format Helpers ────────────────────────────────────────────────────

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function generateId() {
  return 'chatcmpl-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

// ── Convert OpenAI messages to a single prompt ───────────────────────────────

function messagesToPrompt(messages) {
  // Extract system prompt and conversation
  const systemMsgs = messages.filter(m => m.role === 'system');
  const chatMsgs   = messages.filter(m => m.role !== 'system');

  // Build a comprehensive prompt
  const parts = [];

  // System instructions
  if (systemMsgs.length > 0) {
    parts.push('[System Instructions]\n' + systemMsgs.map(m => m.content).join('\n'));
  }

  // Chat history
  for (const msg of chatMsgs) {
    if (msg.role === 'user') {
      parts.push('[User]\n' + msg.content);
    } else if (msg.role === 'assistant') {
      parts.push('[Assistant]\n' + msg.content);
    }
  }

  return parts.join('\n\n');
}

// ── Agent Loop: run full send→parse→execute→feed-back cycle ─────────────────
//  Returns the final text after all tool calls have been executed server-side.
//  If res/writeChunk is provided, sends keepalive chunks so the client doesn't timeout.

async function runAgentLoop(browser, conversation, prompt, maxIter, res, requestId, modelId) {
  const { parseResponse, formatToolResult } = require('./parser');
  const { executeTool } = require('./tools');

  // Keepalive: send empty chunks periodically so streaming clients don't timeout
  let keepaliveTimer = null;
  const startKeepalive = () => {
    if (!res) return;
    keepaliveTimer = setInterval(() => {
      try {
        const keepalive = {
          id: requestId,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: modelId,
          choices: [{
            index: 0,
            delta: {},         // empty delta = keepalive
            finish_reason: null,
          }],
        };
        res.write(`data: ${JSON.stringify(keepalive)}\n\n`);
      } catch {}
    }, 8000); // every 8 seconds
  };
  const stopKeepalive = () => {
    if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
  };

  startKeepalive();

  try {
    // Build and send first message
    const dirListing = agent._getWorkingDirListing();
    const firstMsg = conversation.buildFirstMessage(prompt, dirListing);
    logger.dim(`[proxy] Sending message (${firstMsg.length} chars)...`);
    await browser.sendMessage(firstMsg);
    logger.dim(`[proxy] Message sent, waiting for response...`);

    for (let iter = 1; iter <= maxIter; iter++) {
      logger.dim(`[proxy] Iteration ${iter}/${maxIter}, waiting for response...`);
      const rawResponse = await browser.waitForResponse();

      if (!rawResponse || rawResponse.trim().length === 0) {
        logger.dim(`[proxy] Empty response, retrying...`);
        await browser.sendMessage('Please continue. If you are waiting for input, proceed with your best judgement.');
        continue;
      }

      logger.dim(`[proxy] Response received (${rawResponse.length} chars)`);
      conversation.addAssistantMessage(rawResponse);
      const parsed = parseResponse(rawResponse);

      // Tool call → execute locally, feed result back
      if (parsed.type === 'tool_call') {
        logger.dim(`[proxy] tool_call: ${parsed.name}`);
        let result;
        let isError = false;

        try {
          result = await executeTool(parsed.name, parsed.args);
        } catch (err) {
          result = `Error: ${err.message}`;
          isError = true;
        }

        const feedbackMsg = conversation.addToolResult(parsed.name, result, isError);
        await browser.sendMessage(feedbackMsg);
        continue;
      }

      // Parse error → ask retry
      if (parsed.type === 'error') {
        const recovery = conversation.addToolResult(
          'SYSTEM',
          `Parse error: ${parsed.message}\n\nPlease try again with valid JSON in your tool call.`,
          true
        );
        await browser.sendMessage(recovery);
        continue;
      }

    // Final response → done
    if (parsed.type === 'final') {
      logger.dim(`[proxy] Final response (${parsed.content.length} chars)`);
      return parsed.content;
    }
    }

    return '[Agent reached max iterations without final response]';
  } finally {
    stopKeepalive();
  }
}

// ── Handle streaming response ────────────────────────────────────────────────

async function handleStreaming(res, requestId, modelId, prompt, session) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  // Send initial chunk with role
  const roleChunk = {
    id: requestId,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [{
      index: 0,
      delta: { role: 'assistant', content: '' },
      finish_reason: null,
    }],
  };
  res.write(`data: ${JSON.stringify(roleChunk)}\n\n`);

  try {
    // Ensure agent is ready
    if (!agent) {
      agent = new ChatGPTAgent({ saveLog: false });
      await agent.init();
    }

    // Start new chat for this conversation
    await agent.browser.newChat();
    session.conversation = new ConversationManager();

    // Run full agent loop (tool calls executed server-side, keepalive chunks sent)
    const responseText = await runAgentLoop(
      agent.browser, session.conversation, prompt, config.MAX_ITERATIONS,
      res, requestId, modelId
    );

    // Stream the final response in chunks
    const chunkSize = 30;
    for (let i = 0; i < responseText.length; i += chunkSize) {
      const chunk = responseText.slice(i, i + chunkSize);
      const dataChunk = {
        id: requestId,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        choices: [{
          index: 0,
          delta: { content: chunk },
          finish_reason: null,
        }],
      };
      res.write(`data: ${JSON.stringify(dataChunk)}\n\n`);
    }

    // Send finish chunk
    const finishChunk = {
      id: requestId,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: 'stop',
      }],
    };
    res.write(`data: ${JSON.stringify(finishChunk)}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (err) {
    logger.error(`Streaming error: ${err.message}`);
    const errChunk = {
      id: requestId,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [{
        index: 0,
        delta: { content: `\n\n[Error: ${err.message}]` },
        finish_reason: 'stop',
      }],
    };
    res.write(`data: ${JSON.stringify(errChunk)}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

// ── Handle non-streaming response ────────────────────────────────────────────

async function handleNonStreaming(res, requestId, modelId, prompt, session) {
  try {
    if (!agent) {
      agent = new ChatGPTAgent({ saveLog: false });
      await agent.init();
    }

    // Start new chat
    await agent.browser.newChat();
    session.conversation = new ConversationManager();

    // Run full agent loop (tool calls executed server-side)
    const responseText = await runAgentLoop(
      agent.browser, session.conversation, prompt, config.MAX_ITERATIONS
    );

    const result = {
      id: requestId,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: responseText,
        },
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: Math.ceil(prompt.length / 4),
        completion_tokens: Math.ceil(responseText.length / 4),
        total_tokens: Math.ceil((prompt.length + responseText.length) / 4),
      },
    };

    sendJson(res, 200, result);

  } catch (err) {
    logger.error(`Non-streaming error: ${err.message}`);
    sendJson(res, 500, {
      error: { message: err.message, type: 'server_error' }
    });
  }
}

// ── Main chat completion handler ─────────────────────────────────────────────

async function handleChatCompletion(req, res) {
  let session = null;
  try {
    const body = await parseBody(req);
    const { messages, model, stream = true } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return sendJson(res, 400, {
        error: { message: 'messages array is required', type: 'invalid_request_error' }
      });
    }

    // Check if agent is busy
    for (const [, s] of sessions) {
      if (s.busy) {
        return sendJson(res, 429, {
          error: { message: 'Agent is busy', type: 'rate_limit_error' }
        });
      }
    }

    // Use a session ID based on the request
    const sessionId = body.user || 'default';
    session = getOrCreateSession(sessionId);
    session.busy = true;

    const requestId = generateId();
    const modelId   = model || 'chatgpt-free';
    const prompt    = messagesToPrompt(messages);

    logger.info(`Proxy: Request ${requestId.slice(-8)} (${messages.length} msgs, stream=${stream})`);

    if (stream) {
      await handleStreaming(res, requestId, modelId, prompt, session);
    } else {
      await handleNonStreaming(res, requestId, modelId, prompt, session);
    }

    logger.success(`Proxy: Response sent ${requestId.slice(-8)}`);

  } catch (err) {
    logger.error(`Proxy error: ${err.message}`);
    if (!res.headersSent) {
      sendJson(res, 500, {
        error: { message: err.message, type: 'server_error' }
      });
    }
  } finally {
    if (session) session.busy = false;
  }
}

// ── HTTP Server ──────────────────────────────────────────────────────────────

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PROXY_PORT}`);

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // GET / — status
  if (url.pathname === '/' && req.method === 'GET') {
    return sendJson(res, 200, {
      status: 'ok',
      service: 'ChatGPT Browser Agent - OpenAI Proxy',
      compatible: 'Continue Dev, OpenCode, any OpenAI client',
    });
  }

  // GET /v1/models
  if (url.pathname === '/v1/models' && req.method === 'GET') {
    return sendJson(res, 200, {
      object: 'list',
      data: [
        { id: 'chatgpt-free',   object: 'model', owned_by: 'chatgpt-browser' },
        { id: 'chatgpt-4o',     object: 'model', owned_by: 'chatgpt-browser' },
        { id: 'chatgpt-4o-pro', object: 'model', owned_by: 'chatgpt-browser' },
      ],
    });
  }

  // GET /v1/status
  if (url.pathname === '/v1/status' && req.method === 'GET') {
    return sendJson(res, 200, {
      status: agent ? 'ready' : 'not_initialized',
      uptime: Math.floor(process.uptime()),
      sessions: sessions.size,
    });
  }

  // POST /v1/chat/completions
  if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
    return handleChatCompletion(req, res);
  }

  // 404
  sendJson(res, 404, { error: { message: 'Not found' } });
}

// ── Start Proxy ──────────────────────────────────────────────────────────────

async function startProxy(opts = {}) {
  const port = opts.port || PROXY_PORT;

  logger.banner();
  logger.info(`Starting ChatGPT OpenAI Proxy (Continue Dev compatible)...`);
  logger.info(`Port: ${port}`);
  console.log('');

  // Launch browser
  config.HEADLESS = false;
  agent = new ChatGPTAgent({ saveLog: false });
  await agent.init();
  logger.success('Browser ready!\n');

  // Start server
  server = http.createServer(handleRequest);
  server.listen(port, () => {
    logger.success(`Proxy running at http://localhost:${port}`);
    console.log('');
    logger.info('Continue Dev config.yaml:');
    console.log(`
  - name: "ChatGPT Free (Browser)"
    provider: openai
    model: chatgpt-free
    apiBase: http://localhost:${port}/v1
    contextLength: 64000
    roles:
      - chat
      - edit
      - apply
    capabilities:
      - tool_use
`);
  });

  // Shutdown
  const shutdown = async (code = 0) => {
    logger.info('\nShutting down...');
    if (server) server.close();
    try { await agent.shutdown(); } catch {}
    process.exit(code);
  };
  process.on('SIGINT',  () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
}

module.exports = { startProxy };
