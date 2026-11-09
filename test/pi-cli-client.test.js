import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { mkdtemp, realpath, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { connectPiCli } from '../src/pi-cli-client.js';
import { createPiConformanceHttpsRequest } from '../scripts/pi-sdk-conformance.js';
import { digest } from './helpers/pi-native-fixture.js';

async function fixture(t, terminal = {}) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'pi-cli-client-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const accessFile = path.join(root, `pi-run-${'a'.repeat(64)}-1.login.txt`), secret = '1'.repeat(48);
  await writeFile(accessFile, secret, { mode: 0o600 });
  const sessionId = randomUUID(), turnId = randomUUID(), text = 'Product: Atlas', calls = [];
  t.mock.method(http, 'request', createPiConformanceHttpsRequest(async (url, init) => {
    calls.push({ url, method: init.method });
    const route = new URL(url).pathname;
    if (route === '/api/login') {
      assert.equal(JSON.parse(init.body).password, secret);
      return Response.json({ authenticated: true }, { headers: { 'set-cookie': `agentmo_pi_session=${'2'.repeat(64)}; Path=/; HttpOnly` } });
    }
    assert.equal(init.headers.cookie, `agentmo_pi_session=${'2'.repeat(64)}`);
    if (route === '/api/turns') return Response.json({ sessionId, turnId, status: 'received' }, { status: 202 });
    if (route.endsWith('/events')) return new Response(`event: turn\ndata: ${JSON.stringify({ sessionId, turnId, status: 'completed', text: 'actual reply', ...terminal })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
    if (route === '/api/sessions' && init.method === 'POST') return Response.json({ id: sessionId }, { status: 201 });
    return Response.json({ sessions: [{ id: sessionId, createdAt: '2026-11-06T00:00:00.000Z' }], canSend: true, nextCaseId: 'cli-turn' });
  }));
  const caseSpec = { caseId: 'cli-turn', sessionId, inputDigest: digest(text) };
  return { accessFile, sessionId, turnId, text, caseSpec, calls };
}

test('submits exactly one matching turn and never reposts while polling', async t => {
  const f = await fixture(t), client = await connectPiCli({ accessFile: f.accessFile, port: 19492, mode: 'turn', caseSpec: f.caseSpec });
  const input = { ...f.caseSpec, turnId: f.turnId, text: f.text }; delete input.inputDigest;
  const reply = await client.submit(input);
  assert.equal(reply.replyText, 'actual reply'); assert.equal(reply.replyDigest, digest(reply.replyText));
  await assert.rejects(client.submit(input)); await assert.rejects(client.createSession());
  assert.equal(f.calls.filter(c => c.url.endsWith('/api/turns')).length, 1);
  await client.close(); await assert.rejects(client.listSessions());
});

test('rejects mismatched or failed public turns', async t => {
  for (const terminal of [{ turnId: randomUUID() }, { status: 'failed', text: undefined, causeCode: 'COURSE_WIKI_UPSTREAM_NETWORK', upstreamNetworkCode: 'ETIMEDOUT' }]) {
    await t.test(JSON.stringify(terminal), async t => {
      const f = await fixture(t, terminal), client = await connectPiCli({ accessFile: f.accessFile, port: 19492, mode: 'turn', caseSpec: f.caseSpec });
      await assert.rejects(client.submit({ caseId: 'cli-turn', sessionId: f.sessionId, turnId: f.turnId, text: f.text }));
      assert.equal(f.calls.filter(c => c.url.endsWith('/api/turns')).length, 1); await client.close();
    });
  }
});

test('session creation cannot send a turn or create twice', async t => {
  const f = await fixture(t), client = await connectPiCli({ accessFile: f.accessFile, port: 19492, mode: 'create-session', caseSpec: null });
  assert.equal((await client.createSession()).id, f.sessionId);
  await assert.rejects(client.createSession()); await assert.rejects(client.submit({})); await client.close();
});
