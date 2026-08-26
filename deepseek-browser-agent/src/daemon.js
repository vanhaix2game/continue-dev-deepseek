// src/daemon.js — HTTP daemon mode: run DeepSeek Agent as a continuous service
'use strict';

const http      = require('http');
const fs        = require('fs');
const path      = require('path');
const config    = require('./config');
const logger    = require('./logger');
const DeepSeekAgent = require('./agent');

const DAEMON_PORT   = config.DAEMON_PORT || 7860;
const TASK_QUEUE_DIR = path.join(config.WORKING_DIR, 'task-queue');
const RESULTS_DIR    = path.join(config.WORKING_DIR, 'task-results');

// Ensure directories exist
fs.mkdirSync(TASK_QUEUE_DIR, { recursive: true });
fs.mkdirSync(RESULTS_DIR,    { recursive: true });

// ── State ────────────────────────────────────────────────────────────────────
let agent          = null;
let isProcessing   = false;
let currentTask    = null;
let taskHistory    = [];
let server         = null;

// ── HTTP Request Handler ─────────────────────────────────────────────────────

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

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data, null, 2));
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${DAEMON_PORT}`);

  // ── CORS ─────────────────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── Routes ───────────────────────────────────────────────────────────────

  // GET / — status page
  if (url.pathname === '/' && req.method === 'GET') {
    return sendJson(res, 200, {
      status:    'running',
      agent:     isProcessing ? 'busy' : 'idle',
      currentTask,
      uptime:    Math.floor(process.uptime()),
      tasksDone: taskHistory.length,
      port:      DAEMON_PORT,
      usage: {
        'POST /api/task':     'Submit a task { "task": "..." }',
        'GET  /api/status':   'Check daemon status',
        'GET  /api/history':  'View task history',
        'POST /api/cancel':   'Cancel current task',
      },
    });
  }

  // GET /api/status
  if (url.pathname === '/api/status' && req.method === 'GET') {
    return sendJson(res, 200, {
      agent:    isProcessing ? 'busy' : 'idle',
      currentTask,
      uptime:   Math.floor(process.uptime()),
      tasksDone: taskHistory.length,
      lastTask: taskHistory[taskHistory.length - 1] || null,
    });
  }

  // POST /api/task — submit a new task
  if (url.pathname === '/api/task' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      if (!body.task || typeof body.task !== 'string') {
        return sendJson(res, 400, { error: 'Missing "task" field (string)' });
      }
      if (isProcessing) {
        return sendJson(res, 409, {
          error:   'Agent is busy',
          currentTask,
          tip:     'POST /api/cancel to cancel current task, or wait',
        });
      }

      // Process task immediately
      const result = await processTask(body.task, body.workingDir);
      return sendJson(res, 200, { success: true, result });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // POST /api/cancel
  if (url.pathname === '/api/cancel' && req.method === 'POST') {
    if (!isProcessing) {
      return sendJson(res, 200, { message: 'No task running' });
    }
    // Force stop by setting max iterations to 0
    config.MAX_ITERATIONS = 0;
    return sendJson(res, 200, { message: 'Cancellation requested', currentTask });
  }

  // GET /api/history
  if (url.pathname === '/api/history' && req.method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '20');
    return sendJson(res, 200, {
      total: taskHistory.length,
      tasks: taskHistory.slice(-limit),
    });
  }

  // 404
  sendJson(res, 404, { error: 'Not found', routes: ['/', '/api/task', '/api/status', '/api/history', '/api/cancel'] });
}

// ── Task Processing ──────────────────────────────────────────────────────────

async function processTask(taskText, workingDir) {
  isProcessing = true;
  currentTask  = taskText.slice(0, 100);
  config.MAX_ITERATIONS = 60; // Reset in case it was cancelled

  const startTime = Date.now();
  const taskId    = `task_${Date.now()}`;

  logger.header(`New Task: ${taskText.slice(0, 80)}`);

  try {
    // Create a fresh agent for each task (new conversation)
    agent = new DeepSeekAgent({ saveLog: true });

    // Set working directory if provided
    if (workingDir && fs.existsSync(workingDir)) {
      config.WORKING_DIR = path.resolve(workingDir);
    }

    await agent.init();
    const result = await agent.run(taskText);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const record  = {
      id:       taskId,
      task:     taskText,
      result,
      elapsed:  `${elapsed}s`,
      status:   'completed',
      timestamp: new Date().toISOString(),
    };

    taskHistory.push(record);

    // Save result to file
    const resultFile = path.join(RESULTS_DIR, `${taskId}.json`);
    fs.writeFileSync(resultFile, JSON.stringify(record, null, 2), 'utf8');

    logger.success(`Task completed in ${elapsed}s → ${resultFile}`);

    isProcessing = false;
    currentTask  = null;

    return result;
  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const record  = {
      id:        taskId,
      task:      taskText,
      error:     err.message,
      elapsed:   `${elapsed}s`,
      status:    'failed',
      timestamp: new Date().toISOString(),
    };

    taskHistory.push(record);
    logger.error(`Task failed: ${err.message}`);

    isProcessing = false;
    currentTask  = null;

    throw err;
  }
}

// ── File Queue Watcher ───────────────────────────────────────────────────────

function watchTaskQueue() {
  logger.info(`Watching task-queue folder: ${TASK_QUEUE_DIR}`);
  logger.info('Drop a .txt file into task-queue/ to submit a task\n');

  let processing = false;

  setInterval(async () => {
    if (isProcessing || processing) return;

    try {
      const files = fs.readdirSync(TASK_QUEUE_DIR)
        .filter(f => f.endsWith('.txt') || f.endsWith('.task'))
        .sort();

      if (files.length === 0) return;

      const file     = files[0];
      const filePath = path.join(TASK_QUEUE_DIR, file);
      const taskText = fs.readFileSync(filePath, 'utf8').trim();

      if (!taskText) {
        fs.unlinkSync(filePath);
        return;
      }

      processing = true;
      logger.info(`Processing queued task from file: ${file}`);

      try {
        await processTask(taskText);
        // Move to processed
        const doneDir = path.join(TASK_QUEUE_DIR, 'done');
        fs.mkdirSync(doneDir, { recursive: true });
        fs.renameSync(filePath, path.join(doneDir, file));
        logger.success(`Task from ${file} completed and moved to done/`);
      } catch (err) {
        const errDir = path.join(TASK_QUEUE_DIR, 'failed');
        fs.mkdirSync(errDir, { recursive: true });
        fs.renameSync(filePath, path.join(errDir, file));
        logger.error(`Task from ${file} failed and moved to failed/`);
      }

      processing = false;
    } catch {}
  }, 3000);
}

// ── Start Daemon ─────────────────────────────────────────────────────────────

async function startDaemon(opts = {}) {
  const port = opts.port || DAEMON_PORT;

  logger.banner();
  logger.info(`Starting DeepSeek Agent Daemon...`);
  logger.info(`Port           : ${port}`);
  logger.info(`Working Dir    : ${config.WORKING_DIR}`);
  logger.info(`Task Queue     : ${TASK_QUEUE_DIR}`);
  logger.info(`Results        : ${RESULTS_DIR}`);
  logger.info(`Headless       : ${config.HEADLESS}`);
  console.log('');

  // Launch browser once (shared across tasks)
  agent = new DeepSeekAgent({ saveLog: true });
  await agent.init();
  logger.success('Browser initialized and ready!\n');

  // Start HTTP server
  server = http.createServer(handleRequest);
  server.listen(port, () => {
    logger.success(`HTTP API listening on http://localhost:${port}`);
    logger.info('Endpoints:');
    logger.dim(`  GET  /              — Status page`);
    logger.dim(`  POST /api/task      — Submit task { "task": "..." }`);
    logger.dim(`  GET  /api/status    — Agent status`);
    logger.dim(`  GET  /api/history   — Task history`);
    logger.dim(`  POST /api/cancel    — Cancel current task`);
    console.log('');
  });

  // Start file queue watcher
  watchTaskQueue();

  // Graceful shutdown
  const shutdown = async (code = 0) => {
    logger.info('\nShutting down daemon...');
    if (server) server.close();
    try { await agent.shutdown(); } catch {}
    process.exit(code);
  };

  process.on('SIGINT',  () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  process.on('uncaughtException', async err => {
    logger.error(`Uncaught: ${err.message}`);
    await shutdown(1);
  });
}

module.exports = { startDaemon };
