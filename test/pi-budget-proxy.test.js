import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { createPiTurnController, createPiBudgetHandler } from '../src/pi-budget-proxy.js';
import { piBudgetFixture as fixture } from './helpers/pi-budget-fixture.js';
import { digest } from './helpers/pi-native-fixture.js';
import { piHttpRequest } from './helpers/pi-http-fixture.js';

const request = text => ({ model: 'MiniMax-M3', messages: [{ role: 'user', content: text }], stream: false, max_tokens: 2048 });
const output = () => new Response(JSON.stringify({ model: 'MiniMax-M3', choices: [{ index: 0,
  message: { role: 'assistant', content: '合成答复' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 20, completion_tokens: 3, total_tokens: 23 } }));

const post = (f, body, token) => piHttpRequest(f.handler, body, { authorization: `Bearer ${token}` });
function upstream(t, fetch) { const previous = globalThis.fetch; globalThis.fetch = fetch; t.after(() => { globalThis.fetch = previous; }); }

test('admits one exact case and reserves once across duplicate and crash', async t => {
  const f = await fixture(t); let calls = 0; upstream(t, async () => { calls++; return output(); });
  const admitted = await f.admit(); assert.equal(admitted.kind, 'admitted');
  assert.equal((await f.admit()).kind, 'existing');
  await assert.rejects(f.controller.admit({ ...f.approvedCases[0], turnId: f.turnId, inputDigest: digest('changed') }));
  await assert.rejects(f.controller.admit({ ...f.approvedCases[0], turnId: randomUUID(), sessionId: randomUUID() }));
  assert.equal((await f.summary()).projectReservedFen, 0);
  assert.equal((await post(f, request(f.text), admitted.turnToken)).statusCode, 200);
  assert.equal((await post(f, request(f.text), admitted.turnToken)).statusCode, 409);
  assert.equal(calls, 1); assert.equal((await f.summary()).projectReservedFen, 31);
  assert.deepEqual(f.handler.summary(), { proxyRequests: 2, modelRequests: 1, newReservations: 1 });
  const recovered = await createPiTurnController({ binding: f.binding, stateRoot: f.stateRoot, approvedCases: f.approvedCases });
  assert.equal((await recovered.state(f.turnId)).status, 'interrupted');
  assert.equal((await recovered.admit({ ...f.approvedCases[0], turnId: f.turnId })).kind, 'existing');
  assert.equal((await recovered.status()).canSend, false);
  for (const name of await readdir(path.join(f.stateRoot, 'turns'))) {
    const body = await readFile(path.join(f.stateRoot, 'turns', name), 'utf8'); assert.ok(!body.includes(admitted.turnToken)); assert.ok(!body.includes(f.text));
  }
});

test('read-only scope and mismatched material spend nothing', async t => {
  const f = await fixture(t); let calls = 0; upstream(t, async () => { calls++; return output(); });
  const readonly = await createPiTurnController({ binding: f.binding, stateRoot: f.stateRoot, approvedCases: [] });
  await assert.rejects(readonly.admit({ ...f.approvedCases[0], turnId: f.turnId }));
  const admitted = await f.admit();
  assert.equal((await post(f, request('different'), admitted.turnToken)).statusCode, 400);
  assert.equal(calls, 0); assert.equal((await f.summary()).projectReservedFen, 0);
  assert.equal((await f.controller.status()).canSend, false);
});

test('rejects invalid UTF8 without spending', async t => {
  const f = await fixture(t), admitted = await f.admit();
  const response = await post(f, Buffer.from([0xc3, 0x28]), admitted.turnToken);
  assert.equal(response.statusCode, 400); assert.equal((await f.summary()).projectReservedFen, 0);
});

test('counts 8000 nonBMP and rejects 8001', async t => {
  const f = await fixture(t, '😀'.repeat(8000)); upstream(t, async () => output());
  const admitted = await f.admit();
  assert.equal((await post(f, request(f.text), admitted.turnToken)).statusCode, 200);
  const g = await fixture(t, '😀'.repeat(8001)), token = await g.admit();
  assert.equal((await post(g, request(g.text), token.turnToken)).statusCode, 400);
  assert.equal((await g.summary()).projectReservedFen, 0);
});

test('rejects 48KiB or 32-message overflow', async t => {
  for (const messages of [Array.from({ length: 33 }, () => ({ role: 'user', content: '合成材料' })),
    [{ role: 'system', content: 'x'.repeat(48 * 1024) }, { role: 'user', content: '合成材料' }]]) {
    const f = await fixture(t), admitted = await f.admit();
    assert.equal((await post(f, { ...request(f.text), messages }, admitted.turnToken)).statusCode, 400);
    assert.equal((await f.summary()).projectReservedFen, 0);
  }
});

test('records only observed status and enumerated cause', async t => {
  let reply; upstream(t, async () => { if (reply instanceof Error) throw reply; return reply; });
  for (const [response, status, cause] of [[new Response('SYNTHETIC_BODY_MARKER', { status: 502 }), 502, 'COURSE_WIKI_UPSTREAM_UNAVAILABLE'],
    [new Response('SYNTHETIC_BODY_MARKER'), 200, 'COURSE_WIKI_UPSTREAM_RESPONSE_INVALID'],
    [new Error('SYNTHETIC_KEY_MARKER SYNTHETIC_BODY_MARKER'), undefined, 'COURSE_WIKI_UPSTREAM_NETWORK']]) {
    reply = response;
    const f = await fixture(t), admitted = await f.admit(), result = await post(f, request(f.text), admitted.turnToken);
    assert.equal(result.statusCode, 502); assert.ok(!result.text().includes('SYNTHETIC_'));
    const state = await f.controller.state(f.turnId); assert.equal(state.status, 'failed');
    assert.equal(state.upstreamStatus, status); assert.equal(state.causeCode, cause);
    assert.equal((await f.controller.status()).canSend, false); assert.equal((await f.summary()).projectReservedFen, 31);
  }
});

test('keeps the batch closed if persisting the close marker fails', async t => {
  const f = await fixture(t);
  f.approvedCases.push({ caseId: 'correction', sessionId: f.sessionId, inputDigest: digest('更正') });
  const controller = await createPiTurnController({ binding: f.binding, stateRoot: f.stateRoot, approvedCases: f.approvedCases });
  await controller.admit({ ...f.approvedCases[0], turnId: f.turnId });
  const original = fs.promises.open;
  fs.promises.open = async (...args) => {
    if (typeof args[0] === 'string' && args[0].endsWith('.closed.json')) throw Object.assign(new Error('synthetic close failure'), { code: 'ENOSPC' });
    return original(...args);
  };
  syncBuiltinESMExports();
  try { await assert.rejects(controller.finish({ sessionId: f.sessionId, turnId: f.turnId, status: 'failed' })); }
  finally { fs.promises.open = original; syncBuiltinESMExports(); }
  assert.equal((await controller.status()).canSend, false);
  await assert.rejects(controller.admit({ ...f.approvedCases[1], turnId: randomUUID() }));
});

test('claims a case once across concurrent controller instances', async t => {
  const f = await fixture(t), other = await createPiTurnController({ binding: f.binding, stateRoot: f.stateRoot, approvedCases: f.approvedCases });
  const results = await Promise.allSettled([f.admit(), other.admit({ ...f.approvedCases[0], turnId: randomUUID() })]);
  assert.equal(results.filter(r => r.status === 'fulfilled' && r.value.kind === 'admitted').length, 1);
  assert.equal((await readdir(path.join(f.stateRoot, 'turns'))).filter(n => n.endsWith('.received.json')).length, 1);
  assert.equal((await f.summary()).projectReservedFen, 0);
});

test('requires upstream completion and a final entry before restoring completed', async t => {
  const f = await fixture(t); upstream(t, async () => output());
  const admitted = await f.admit();
  await assert.rejects(f.controller.finish({ sessionId: f.sessionId, turnId: f.turnId, status: 'completed', finalEntryId: 'entry0001' }));
  assert.equal((await post(f, request(f.text), admitted.turnToken)).statusCode, 200);
  await assert.rejects(f.controller.finish({ sessionId: f.sessionId, turnId: f.turnId, status: 'completed' }));
  assert.equal((await f.controller.finish({ sessionId: f.sessionId, turnId: f.turnId, status: 'completed', finalEntryId: 'entry0001' })).status, 'completed');
  const restored = await createPiTurnController({ binding: f.binding, stateRoot: f.stateRoot, approvedCases: f.approvedCases });
  assert.equal((await restored.state(f.turnId)).status, 'completed');
  assert.equal((await restored.admit({ ...f.approvedCases[0], turnId: f.turnId })).kind, 'existing');
  assert.equal((await f.summary()).projectReservedFen, 31);
});

test('a separately approved activation scopes a new batch without releasing old claims', async t => {
  const f = await fixture(t), firstId = '00000000-0000-4000-8000-000000000001', secondId = '00000000-0000-4000-8000-000000000002';
  const first = await createPiTurnController({ binding: f.binding, stateRoot: f.stateRoot, approvedCases: f.approvedCases, activationId: firstId });
  await first.admit({ ...f.approvedCases[0], turnId: f.turnId });
  await first.finish({ sessionId: f.sessionId, turnId: f.turnId, status: 'failed' });
  const second = await createPiTurnController({ binding: f.binding, stateRoot: f.stateRoot, approvedCases: f.approvedCases, activationId: secondId });
  assert.equal((await second.status()).canSend, true);
  await assert.rejects(second.admit({ ...f.approvedCases[0], turnId: f.turnId }));
  assert.equal((await second.admit({ ...f.approvedCases[0], turnId: randomUUID() })).kind, 'admitted');
  assert.equal((await readdir(path.join(f.stateRoot, 'turns'))).filter(n => n.endsWith('.received.json')).length, 2);
  assert.equal((await f.summary()).projectReservedFen, 0);
});
