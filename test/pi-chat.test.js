import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable, Writable } from 'node:stream';

const host = '127.0.0.1:19492', origin = `http://${host}`;
const sessionId = '00000000-0000-4000-8000-000000000001';
const turnId = '00000000-0000-4000-8000-000000000002';
const password = 'synthetic-login-only';
const sample = '<img src=x onerror=alert(1)> SYNTHETIC_BODY_MARKER';
const serverModule = () => import('../src/pi-chat-server.js');

class Reply extends Writable {
  chunks = []; headers = {}; statusCode = 200; headersSent = false;
  _write(chunk, _encoding, callback) { this.chunks.push(Buffer.from(chunk)); callback(); }
  writeHead(status, headers) { this.statusCode = status; this.headers = headers; this.headersSent = true; return this; }
  text() { return Buffer.concat(this.chunks).toString('utf8'); }
  json() { return JSON.parse(this.text()); }
}
async function request(handler, method, url, body, headers = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(req, { method, url, headers: { host, origin, 'content-type': 'application/json', ...headers }, socket: { remoteAddress: '127.0.0.1' } });
  const res = new Reply(); await handler(req, res); return res;
}
function fakeHost(canSend = false) {
  const calls = { submit: 0, create: 0, stop: 0 };
  return { calls, status: async () => ({ canSend, nextCaseId: canSend ? 'entry' : null }),
    listSessions: async () => [{ id: sessionId, createdAt: '2026-10-16T00:00:00.000Z' }],
    createSession: async () => { calls.create++; return { id: sessionId }; },
    readSession: async id => { assert.equal(id, sessionId); return { id, messages: [{ role: 'assistant', content: sample }], turns: [] }; },
    submit: async args => { calls.submit++; return { turnId: args.turnId, sessionId, status: 'received' }; },
    async *events(id) { assert.equal(id, turnId); yield { turnId, sessionId, status: 'completed', text: sample }; },
  };
}
async function fixture(canSend = false) {
  const sessionHost = fakeHost(canSend), { createPiChatHandler } = await serverModule();
  const handler = createPiChatHandler({ host, origin, sessionHost, loginSecret: password, onStop: async () => { sessionHost.calls.stop++; } });
  const login = await request(handler, 'POST', '/api/login', { password });
  assert.equal(login.statusCode, 200);
  assert.match(login.headers['set-cookie'], /HttpOnly/);
  assert.match(login.headers['set-cookie'], /SameSite=Strict/);
  return { handler, sessionHost, cookie: login.headers['set-cookie'].split(';')[0] };
}

test('rejects cross-origin malformed and read-only submissions before SDK', async () => {
  const { handler, sessionHost, cookie } = await fixture();
  const body = { caseId: 'entry', sessionId, turnId, text: '会议合成材料' };
  assert.equal((await request(handler, 'GET', '/api/sessions')).statusCode, 401);
  assert.equal((await request(handler, 'POST', '/api/turns', body, { cookie, origin: 'https://outside.invalid' })).statusCode, 403);
  assert.equal((await request(handler, 'POST', '/api/turns', body, { cookie, origin: '' })).statusCode, 403);
  assert.equal((await request(handler, 'POST', '/api/turns', body, { cookie, host: 'outside.invalid' })).statusCode, 403);
  assert.equal((await request(handler, 'POST', '/api/turns', { ...body, command: 'bash' }, { cookie })).statusCode, 400);
  assert.equal((await request(handler, 'POST', '/api/turns', body, { cookie })).statusCode, 409);
  assert.equal((await request(handler, 'GET', '/api/sessions/../../secret', undefined, { cookie })).statusCode, 404);
  assert.equal(sessionHost.calls.submit, 0);
  assert.equal(sessionHost.calls.create, 0);
});

test('caps failed logins and keeps credential samples out of errors', async () => {
  const { createPiChatHandler } = await serverModule(), sessionHost = fakeHost(true);
  const handler = createPiChatHandler({ host, origin, sessionHost, loginSecret: password, onStop: async () => {} });
  for (let n = 0; n < 5; n++) assert.equal((await request(handler, 'POST', '/api/login', { password: 'wrong' })).statusCode, 401);
  assert.equal((await request(handler, 'POST', '/api/login', { password })).statusCode, 429);
  const f = await fixture(true);
  f.sessionHost.submit = async () => { throw Object.assign(new Error('SYNTHETIC_BODY_MARKER'), { apiKey: 'SYNTHETIC_KEY_MARKER' }); };
  const response = await request(f.handler, 'POST', '/api/turns', { caseId: 'entry', sessionId, turnId, text: '合成材料' }, { cookie: f.cookie });
  assert.equal(response.statusCode, 500);
  assert.equal(response.text().includes('SYNTHETIC_'), false);
});

test('repeated event observation and session reads never submit or expose credentials', async () => {
  const { handler, sessionHost, cookie } = await fixture(true);
  for (let n = 0; n < 2; n++) {
    const response = await request(handler, 'GET', `/api/turns/${turnId}/events`, undefined, { cookie });
    assert.equal(response.statusCode, 200);
    assert.match(response.text(), /event: turn/);
    assert.equal(response.text().includes(sample), true);
    assert.equal(response.text().includes(password), false);
  }
  const response = await request(handler, 'GET', '/api/sessions', undefined, { cookie });
  assert.equal(response.json().canSend, true);
  assert.equal(response.json().nextCaseId, 'entry');
  assert.equal(sessionHost.calls.submit, 0);
  const page = await request(handler, 'GET', '/');
  assert.equal(page.statusCode, 200);
  assert.equal(page.text().includes(sample), false);
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
});

test('the independent CLI capability can only stop its own browser entry', async () => {
  const { createPiChatHandler } = await serverModule(), sessionHost = fakeHost(true), stopCapability = '1'.repeat(64);
  const handler = createPiChatHandler({ host, origin, sessionHost, loginSecret: password, stopCapability,
    onStop: async () => { sessionHost.calls.stop++; } });
  const headers = { authorization: `AgentMoStop ${stopCapability}`, origin: '' };
  assert.equal((await request(handler, 'POST', '/api/stop', {}, headers)).statusCode, 202);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(sessionHost.calls.stop, 1);
  assert.ok((await request(handler, 'POST', '/api/turns', { caseId: 'entry', sessionId, turnId, text: sample }, headers)).statusCode >= 400);
  assert.ok((await request(handler, 'POST', '/api/stop', {}, { ...headers, authorization: `AgentMoStop ${'2'.repeat(64)}` })).statusCode >= 400);
  assert.equal(sessionHost.calls.submit, 0);
});

class Element {
  children = []; events = new Map(); value = ''; textContent = ''; hidden = false; disabled = false;
  constructor(tagName = 'DIV') { this.tagName = tagName; }
  set innerHTML(_value) { throw new Error('Unsafe HTML rendering'); }
  addEventListener(name, callback) { this.events.set(name, callback); }
  replaceChildren(...children) { this.children = children; }
  append(...children) { this.children.push(...children); }
  setAttribute() {}
  focus() {}
}
test('refresh renders HTML as text and reads an existing session without posting', async () => {
  const { startPiChatClient } = await import('../src/pi-chat-client.js');
  const elements = new Map(['login-view', 'app-view', 'login-form', 'password', 'login-error', 'meeting-select',
    'new-meeting', 'messages', 'composer', 'material', 'send', 'stop', 'state'].map(id => [id, new Element()]));
  const document = { getElementById: id => elements.get(id), createElement: tag => new Element(tag) };
  const saved = new Map([['agentmo-pi-session', sessionId]]);
  const storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method ?? 'GET' });
    if (url === '/api/sessions') return Response.json({ sessions: [{ id: sessionId }], canSend: false });
    assert.equal(url, `/api/sessions/${sessionId}`);
    return Response.json({ id: sessionId, messages: [{ role: 'assistant', content: sample }], turns: [] });
  };
  await startPiChatClient({ document, fetch, storage });
  assert.equal(elements.get('send').disabled, true);
  assert.equal(elements.get('app-view').hidden, false);
  const rendered = JSON.stringify(elements.get('messages').children);
  assert.equal(rendered.includes(sample), true);
  assert.equal(calls.every(call => call.method === 'GET'), true);
  assert.equal([...saved.values()].some(value => value.includes(sample) || value.includes(password)), false);
});

test('uses the approved next case from the server without hidden UI edits', async () => {
  const { startPiChatClient } = await import('../src/pi-chat-client.js');
  const elements = new Map(['login-view', 'app-view', 'login-form', 'password', 'login-error', 'meeting-select',
    'new-meeting', 'messages', 'composer', 'material', 'send', 'stop', 'state'].map(id => [id, new Element()]));
  const document = { getElementById: id => elements.get(id), createElement: tag => new Element(tag) };
  const saved = new Map(), storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  let posted;
  const fetch = async (url, options = {}) => {
    if (url === '/api/sessions') return Response.json({ sessions: [{ id: sessionId }], canSend: true, nextCaseId: 'correction' });
    if (url === `/api/sessions/${sessionId}`) return Response.json({ id: sessionId, messages: [], turns: [] });
    if (url === '/api/turns') {
      posted = JSON.parse(options.body);
      return Response.json({ turnId: posted.turnId, sessionId, status: 'received' }, { status: 202 });
    }
    assert.equal(url, `/api/turns/${posted.turnId}/events`);
    return new Response(`event: turn\ndata: ${JSON.stringify({ turnId: posted.turnId, sessionId, status: 'completed', text: '合成结果' })}\n\n`);
  };
  await startPiChatClient({ document, fetch, storage });
  elements.get('material').value = '更正合成材料';
  await elements.get('composer').events.get('submit')({ preventDefault() {} });
  assert.equal(posted?.caseId, 'correction');
  assert.equal(posted.text, '更正合成材料');
});
