import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const STATES = new Set(['received', 'reserved', 'sent', 'completed', 'failed', 'interrupted']);
const TERMINAL = new Set(['completed', 'failed', 'interrupted']);
const exact = (v, fields) => v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).sort().join(',') === [...fields].sort().join(',');
const hash = value => createHash('sha256').update(value).digest();
const fail = (status = 400) => { throw Object.assign(new Error('Pi browser request rejected.'), { httpStatus: status }); };
const files = new Map([
  ['/', ['pi-chat.html', 'text/html; charset=utf-8']],
  ['/client.js', ['pi-chat-client.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['pi-chat.css', 'text/css; charset=utf-8']],
]);
const headers = {
  'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};
const reply = (res, status, value, extra = {}) => {
  res.writeHead(status, { ...headers, 'content-type': 'application/json; charset=utf-8', ...extra });
  res.end(JSON.stringify(value));
};
async function body(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') fail();
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 48 * 1024) fail(); chunks.push(chunk); }
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
    return value;
  } catch { fail(); }
}
function publicTurn(value, text = false) {
  if (!value || !UUID.test(value.turnId) || !UUID.test(value.sessionId) || !STATES.has(value.status)) fail(500);
  const result = { turnId: value.turnId, sessionId: value.sessionId, status: value.status };
  if (text && value.status === 'completed') {
    if (typeof value.text !== 'string' || Buffer.byteLength(value.text) > 128 * 1024) fail(500);
    result.text = value.text;
  }
  return result;
}

export function createPiChatHandler({ host, origin, sessionHost, loginSecret, stopCapability, onStop }) {
  if (!/^127\.0\.0\.1:[0-9]{1,5}$/.test(host) || origin !== `http://${host}`
    || typeof loginSecret !== 'string' || !loginSecret || loginSecret.length > 256 || /[\r\n]/.test(loginSecret)
    || stopCapability !== undefined && !/^[a-f0-9]{64}$/.test(stopCapability)
    || typeof onStop !== 'function') fail();
  const cookieValue = randomBytes(32).toString('hex'); let failedLogins = 0, stopping = false;
  const requestStop = res => {
    reply(res, 202, { stopping: true });
    if (!stopping) { stopping = true; setImmediate(() => { void Promise.resolve().then(onStop).catch(() => {}); }); }
  };
  const authenticated = req => typeof req.headers.cookie === 'string' && req.headers.cookie.split(';')
    .map(s => s.trim()).includes(`agentmo_pi_session=${cookieValue}`);
  return async (req, res) => {
    try {
      if (req.headers.host !== host || req.headers.origin && req.headers.origin !== origin) fail(403);
      const stopOnly = stopCapability !== undefined && req.method === 'POST' && req.url === '/api/stop'
        && typeof req.headers.authorization === 'string' && timingSafeEqual(hash(req.headers.authorization), hash(`AgentMoStop ${stopCapability}`));
      if (req.method === 'POST' && req.headers.origin !== origin && !stopOnly) fail(403);
      if (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//') || req.url.includes('?') || req.url.includes('#')) fail(404);
      const route = req.url;
      if (req.method === 'GET' && files.has(route)) {
        const [file, type] = files.get(route);
        const bytes = await readFile(new URL(file, import.meta.url));
        res.writeHead(200, { ...headers, 'content-type': type }); res.end(bytes); return;
      }
      if (route === '/api/login' && req.method === 'POST') {
        const input = await body(req);
        if (!exact(input, ['password']) || typeof input.password !== 'string' || input.password.length > 256) fail();
        if (failedLogins >= 5) fail(429);
        if (!timingSafeEqual(hash(input.password), hash(loginSecret))) { failedLogins++; fail(401); }
        reply(res, 200, { authenticated: true }, { 'set-cookie': `agentmo_pi_session=${cookieValue}; Path=/; HttpOnly; SameSite=Strict` }); return;
      }
      if (stopOnly) { if (!exact(await body(req), [])) fail(); requestStop(res); return; }
      if (!authenticated(req)) fail(401);
      if (route === '/api/sessions' && req.method === 'GET') {
        const sessions = (await sessionHost.listSessions()).map(row => {
          if (!UUID.test(row.id) || !Number.isFinite(Date.parse(row.createdAt))) fail(500);
          return { id: row.id, createdAt: new Date(row.createdAt).toISOString() };
        });
        const status = await sessionHost.status();
        if (typeof status?.canSend !== 'boolean' || status.canSend && !/^[a-z][a-z0-9-]{0,63}$/.test(status.nextCaseId ?? '')) fail(500);
        reply(res, 200, { sessions, canSend: status.canSend, nextCaseId: status.canSend ? status.nextCaseId : null }); return;
      }
      if (route === '/api/sessions' && req.method === 'POST') {
        if (!exact(await body(req), [])) fail();
        const created = await sessionHost.createSession(); if (!UUID.test(created?.id)) fail(500);
        reply(res, 201, { id: created.id }); return;
      }
      const session = route.match(/^\/api\/sessions\/([a-f0-9-]+)$/);
      if (session && UUID.test(session[1]) && req.method === 'GET') {
        const value = await sessionHost.readSession(session[1]);
        if (value?.id !== session[1] || !Array.isArray(value.messages) || !Array.isArray(value.turns)) fail(500);
        const messages = value.messages.map(m => {
          if (!['user', 'assistant'].includes(m.role) || typeof m.content !== 'string') fail(500);
          return { role: m.role, content: m.content };
        });
        reply(res, 200, { id: value.id, messages, turns: value.turns.map(t => publicTurn(t)) }); return;
      }
      if (route === '/api/turns' && req.method === 'POST') {
        const input = await body(req);
        if (!exact(input, ['caseId', 'sessionId', 'turnId', 'text']) || !UUID.test(input.sessionId) || !UUID.test(input.turnId)
          || !/^[a-z][a-z0-9-]{0,63}$/.test(input.caseId) || typeof input.text !== 'string' || !input.text.trim()
          || [...input.text].length > 8000 || !input.text.isWellFormed()) fail();
        if ((await sessionHost.status()).canSend !== true) fail(409);
        reply(res, 202, publicTurn(await sessionHost.submit(input))); return;
      }
      const events = route.match(/^\/api\/turns\/([a-f0-9-]+)\/events$/);
      if (events && UUID.test(events[1]) && req.method === 'GET') {
        const abort = new AbortController(), close = () => abort.abort(); res.once('close', close);
        try {
          for await (const event of sessionHost.events(events[1], { signal: abort.signal })) {
            const safe = publicTurn(event, true);
            if (safe.turnId !== events[1]) fail(500);
            if (!res.headersSent) res.writeHead(200, { ...headers, 'content-type': 'text/event-stream; charset=utf-8' });
            res.write(`event: turn\ndata: ${JSON.stringify(safe)}\n\n`);
            if (TERMINAL.has(safe.status)) break;
          }
          res.end();
        } finally { abort.abort(); res.off('close', close); }
        return;
      }
      if (route === '/api/stop' && req.method === 'POST') {
        if (!exact(await body(req), [])) fail();
        requestStop(res); return;
      }
      fail(404);
    } catch (error) {
      if (res.headersSent) { if (!res.writableEnded) res.end(); return; }
      const status = [400, 401, 403, 404, 409, 429].includes(error?.httpStatus) ? error.httpStatus : 500;
      reply(res, status, { error: { code: status === 409 ? 'READ_ONLY_OR_BUSY' : 'REQUEST_REJECTED',
        message: status === 409 ? '当前未开放发送，或已有请求正在处理。' : '请求未完成，不会自动重试。' } });
    }
  };
}

export async function startPiChatServer({ port, ...options }) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || options.host !== `127.0.0.1:${port}`) fail();
  const server = createServer(createPiChatHandler(options));
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  let closing;
  return { close: () => closing ??= new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}
