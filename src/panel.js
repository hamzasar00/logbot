'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const PANEL_DIR = path.join(ROOT_DIR, 'public');
const BOT_SCRIPT = path.join(__dirname, 'index.js');
try {
  require('dotenv').config({ path: path.join(ROOT_DIR, '.env') });
} catch {
  // Panel health/status endpoints stay usable before npm install finishes.
}
const HOST = process.env.PANEL_HOST || '127.0.0.1';
const PORT = Number.parseInt(process.env.PANEL_PORT || '8787', 10);
const MAX_LOGS = 250;
const MAX_BODY = 32 * 1024;

let botProcess = null;
let botStartedAt = null;
let logLines = [];

function addLog(message, stream = 'system') {
  const text = String(message || '').trim();
  if (!text) return;

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    logLines.push({
      at: new Date().toISOString(),
      stream,
      text: line.slice(0, 2000),
    });
  }
  if (logLines.length > MAX_LOGS) {
    logLines = logLines.slice(-MAX_LOGS);
  }
}

function isRunning() {
  return Boolean(botProcess && botProcess.exitCode === null && !botProcess.killed);
}

function statusSnapshot() {
  return {
    ok: true,
    running: isRunning(),
    pid: isRunning() ? botProcess.pid : null,
    startedAt: botStartedAt ? new Date(botStartedAt).toISOString() : null,
    uptimeSeconds: botStartedAt && isRunning()
      ? Math.floor((Date.now() - botStartedAt) / 1000)
      : 0,
    envConfigured: fs.existsSync(path.join(ROOT_DIR, '.env')),
    logs: logLines.slice(-80),
  };
}

function attachOutput(child, stream, label) {
  let pending = '';
  stream.on('data', (chunk) => {
    pending += chunk.toString();
    const parts = pending.split(/\r?\n/);
    pending = parts.pop() || '';
    for (const line of parts) addLog(line, label);
  });
  stream.on('end', () => {
    if (pending) addLog(pending, label);
  });
}

function startBot() {
  if (isRunning()) {
    return { started: false, reason: 'already_running' };
  }

  if (!fs.existsSync(BOT_SCRIPT)) {
    addLog(`Bot giriş dosyası bulunamadı: ${BOT_SCRIPT}`, 'error');
    return { started: false, reason: 'entry_missing' };
  }

  const child = spawn(process.execPath, [BOT_SCRIPT], {
    cwd: ROOT_DIR,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  botProcess = child;
  botStartedAt = Date.now();
  addLog(`Bot başlatıldı (PID ${child.pid}).`, 'system');
  attachOutput(child, child.stdout, 'stdout');
  attachOutput(child, child.stderr, 'stderr');

  child.on('error', (error) => {
    addLog(error.message, 'error');
  });

  child.on('exit', (code, signal) => {
    addLog(`Bot durdu (kod: ${code ?? 'yok'}, sinyal: ${signal || 'yok'}).`, 'system');
    if (botProcess === child) {
      botProcess = null;
      botStartedAt = null;
    }
  });

  return { started: true, pid: child.pid };
}

function stopBot() {
  if (!isRunning()) {
    return { stopped: false, reason: 'not_running' };
  }

  const child = botProcess;
  addLog('Bot durduruluyor...', 'system');

  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], (error) => {
      if (error) addLog(`Bot durdurulamadı: ${error.message}`, 'error');
    });
  } else {
    child.kill('SIGTERM');
  }

  return { stopped: true };
}

function restartBot() {
  if (!isRunning()) return startBot();

  stopBot();
  setTimeout(() => {
    if (!isRunning()) startBot();
  }, 700);
  return { restarting: true };
}

function json(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) {
        reject(new Error('İstek gövdesi çok büyük.'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function servePanel(res) {
  const file = path.join(PANEL_DIR, 'control-panel.html');
  fs.readFile(file, (error, content) => {
    if (error) return json(res, 500, { ok: false, error: 'Kontrol paneli bulunamadı.' });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(content);
  });
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || HOST}`);

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    return servePanel(res);
  }
  if (req.method === 'GET' && url.pathname === '/api/status') {
    return json(res, 200, statusSnapshot());
  }
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return json(res, 200, { ok: true, service: 'logbot-panel' });
  }

  if (req.method === 'POST') {
    if (url.pathname === '/api/start') return json(res, 200, { ...startBot(), ...statusSnapshot() });
    if (url.pathname === '/api/stop') return json(res, 200, { ...stopBot(), ...statusSnapshot() });
    if (url.pathname === '/api/restart') return json(res, 200, { ...restartBot(), ...statusSnapshot() });
  }

  if (url.pathname.startsWith('/api/')) {
    return json(res, 404, { ok: false, error: 'API endpoint bulunamadı.' });
  }

  return json(res, 404, { ok: false, error: 'Sayfa bulunamadı.' });
}

function openBrowser(url) {
  if (process.env.PANEL_OPEN_BROWSER === '0') return;
  const command = process.platform === 'win32'
    ? 'start'
    : process.platform === 'darwin'
      ? 'open'
      : 'xdg-open';
  const args = process.platform === 'win32' ? ['', url] : [url];
  execFile(command, args, () => {});
}

function createServer() {
  return http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      addLog(error.message, 'error');
      if (!res.headersSent) json(res, 500, { ok: false, error: 'Beklenmeyen panel hatası.' });
      else res.end();
    });
  });
}

function startPanel() {
  const server = createServer();
  server.listen(PORT, HOST, () => {
    const url = `http://${HOST}:${PORT}`;
    console.log(`Logbot kontrol paneli hazır: ${url}`);
    console.log('Panelden botu başlatabilir, durdurabilir ve yeniden başlatabilirsiniz.');
    setTimeout(() => openBrowser(url), 250);
  });

  const shutdown = () => {
    if (isRunning()) stopBot();
    server.close(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return server;
}

if (require.main === module) {
  startPanel();
}

module.exports = {
  createServer,
  startBot,
  stopBot,
  restartBot,
  statusSnapshot,
};