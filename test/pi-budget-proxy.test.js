import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { createPiTurnController, createPiBudgetHandler, validatePiPublicTurn } from '../src/pi-budget-proxy.js';
import { piBudgetFixture as fixture } from './helpers/pi-budget-fixture.js';
import { digest } from './helpers/pi-native-fixture.js';
import { piHttpRequest, piNativeRequest, piNativeResponse } from './helpers/pi-http-fixture.js';

import { stubPiUpstream } from './helpers/pi-https-fixture.js';

const request = piNativeRequest;
const output = piNativeResponse;

const post = (f, body, token) => piHttpRequest(f.handler, body, { 'x-api-key': token });
const upstream = stubPiUpstream;

test('accepts the native SDK beta route and bare route without forwarding the query', async t => {
  const urls = []; upstream(t, async url => { urls.push(url); return output(); });
  for (const url of ['/v1/messages?beta=true', '/v1/messages']) {
    const f = await fixture(t), admitted = await f.admit();
    const reply = await piHttpRequest(f.handler, request(f.text), { 'x-api-key': admitted.turnToken }, url);
    assert.equal(reply.statusCode, 200, url);
    assert.equal((await f.summary()).projectReservedFen, 31);
    assert.deepEqual(f.handler.summary(), { proxyRequests: 1, modelRequests: 1, newReservations: 1 });
    assert.equal((await piHttpRequest(f.handler, request(f.text), { 'x-api-key': admitted.turnToken }, url)).statusCode, 409);
    assert.equal((await f.summary()).projectReservedFen, 31);
  }
  assert.deepEqual(urls, ['https://api.minimax.cn/anthropic/v1/messages', 'https://api.minimax.cn/anthropic/v1/messages']);
});

test('rejects other query strings and routes before claiming or reserving a model request', async t => {
  let calls = 0; upstream(t, async () => { calls++; return output(); });
  for (const url of ['/v1/messages?beta=false', '/v1/messages?beta=true&beta=true', '/v1/messages?beta=true&extra=1',
    '/v1/messages?extra=1', '/v1/messages?', '/v1/messages?beta=%74rue', '/v1/messages?beta=true#fragment', '/v1/messages/']) {
    const f = await fixture(t), admitted = await f.admit();
    assert.equal((await piHttpRequest(f.handler, request(f.text), { 'x-api-key': admitted.turnToken }, url)).statusCode, 400, url);
    assert.equal((await f.summary()).projectReservedFen, 0);
    assert.equal((await f.controller.state(f.turnId)).causeCode, 'PI_REQUEST_INVALID');
    assert.equal((await readdir(path.join(f.stateRoot, 'attempts'))).filter(n => /^pi-[a-f0-9]{64}\.claim$/.test(n)).length, 0);
  }
  assert.equal(calls, 0);
});

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
    assert.equal(state.upstreamNetworkCode, cause === 'COURSE_WIKI_UPSTREAM_NETWORK' ? 'UNKNOWN' : undefined);
    assert.equal((await f.controller.status()).canSend, false); assert.equal((await f.summary()).projectReservedFen, 31);
  }
});

test('retains safe nested network codes through failed turns and recovery without retrying', async t => {
  let failure, calls = 0;
  upstream(t, async () => { calls++; throw failure; });
  for (const code of ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT',
    'ENETUNREACH', 'EACCES', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE']) {
    failure = new TypeError('SYNTHETIC_KEY_MARKER', { cause: Object.assign(new Error('SYNTHETIC_BODY_MARKER'), { code }) });
    const f = await fixture(t), admitted = await f.admit(), beforeCalls = calls;
    const result = await post(f, request(f.text), admitted.turnToken);
    assert.equal(result.statusCode, 502);assert.equal(calls, beforeCalls + 1);
    const state = await f.controller.state(f.turnId);
    assert.equal(state.causeCode, 'COURSE_WIKI_UPSTREAM_NETWORK');
    assert.equal(state.upstreamNetworkCode, code);assert.equal(state.upstreamStatus, undefined);
    assert.equal(validatePiPublicTurn(state), true);
    const disk = await readFile(path.join(f.stateRoot, 'turns', `${f.turnId}.failed.json`), 'utf8');
    assert.equal(JSON.parse(disk).upstreamNetworkCode, code);
    assert(!disk.includes('SYNTHETIC_'));assert(!result.text().includes('SYNTHETIC_'));
    const recovered = await createPiTurnController({ binding: f.binding, stateRoot: f.stateRoot, approvedCases: f.approvedCases });
    assert.deepEqual(await recovered.state(f.turnId), state);assert.equal((await recovered.status()).canSend, false);
    assert.equal((await post(f, request(f.text), admitted.turnToken)).statusCode, 409);
    assert.equal(calls, beforeCalls + 1);assert.equal((await f.summary()).projectReservedFen, 31);
  }
});

test('bounds aggregate network diagnostics and omits messages, accessors and unknown codes', async t => {
  const coded = code => Object.assign(new Error('SYNTHETIC_BODY_MARKER'), { code });
  const cyclic = new Error('SYNTHETIC_BODY_MARKER');cyclic.cause = cyclic;
  const accessor = new Error();for (const k of ['code', 'cause', 'errors', 'message']) Object.defineProperty(accessor, k, { get() { throw Error('must not inspect private accessor'); } });
  const arrayProxy = new Proxy([], { get() { throw Error('SYNTHETIC_PRIVATE_ARRAY_ACCESSOR'); } });
  const revoked = Proxy.revocable([], {});revoked.revoke();
  let deep = coded('ENOTFOUND');for (let i=0;i<8;i++) deep = new Error('private', { cause: deep });
  let failure;upstream(t, async () => { throw failure; });
  for (const [error, want] of [[new TypeError('private', { cause: new AggregateError([coded('ECONNREFUSED'), coded('ECONNREFUSED')]) }), 'ECONNREFUSED'],
    [new AggregateError([coded('ENOTFOUND'), coded('CERT_HAS_EXPIRED')]), 'MULTIPLE'],
    [new AggregateError([...Array.from({ length: 8 }, () => coded('ECONNREFUSED')), coded('ENOTFOUND')]), 'UNKNOWN'],
    [coded('SYNTHETIC_KEY_MARKER'), 'UNKNOWN'], [cyclic, 'UNKNOWN'], [accessor, 'UNKNOWN'], [deep, 'UNKNOWN'],
    [Object.assign(new Error(), { errors: arrayProxy }), 'UNKNOWN'], [Object.assign(new Error(), { errors: revoked.proxy }), 'UNKNOWN']]) {
    failure = error;const f = await fixture(t), admitted = await f.admit();
    assert.equal((await post(f, request(f.text), admitted.turnToken)).statusCode, 502);
    const state = await f.controller.state(f.turnId);assert.equal(state.upstreamNetworkCode, want);
    const disk = await readFile(path.join(f.stateRoot, 'turns', `${f.turnId}.failed.json`), 'utf8');assert(!disk.includes('SYNTHETIC_'));
  }
});

test('rejects tampered or misplaced network diagnostics while accepting historical failed turns', async t => {
  upstream(t, async () => { throw Object.assign(new Error(), { code: 'ENOTFOUND' }); });
  const f = await fixture(t), admitted = await f.admit();await post(f, request(f.text), admitted.turnToken);
  const state = await f.controller.state(f.turnId);assert.equal(state.upstreamNetworkCode, 'ENOTFOUND');
  for (const override of [{ upstreamNetworkCode: 'SYNTHETIC_KEY_MARKER' }, { status: 'completed' },
    { causeCode: 'COURSE_WIKI_UPSTREAM_DENIED' }, { upstreamStatus: 502 }]) assert.equal(validatePiPublicTurn({ ...state, ...override }), false);
  const file = path.join(f.stateRoot, 'turns', `${f.turnId}.failed.json`), row = JSON.parse(await readFile(file));
  await fs.promises.writeFile(file, JSON.stringify({ ...row, upstreamNetworkCode: 'SYNTHETIC_KEY_MARKER' }));
  await assert.rejects(createPiTurnController({ binding: f.binding, stateRoot: f.stateRoot, approvedCases: f.approvedCases }));
  delete row.upstreamNetworkCode;await fs.promises.writeFile(file, JSON.stringify(row));
  const historical = await createPiTurnController({ binding: f.binding, stateRoot: f.stateRoot, approvedCases: f.approvedCases });
  assert.equal((await historical.state(f.turnId)).causeCode, 'COURSE_WIKI_UPSTREAM_NETWORK');
  assert.equal((await historical.state(f.turnId)).upstreamNetworkCode, undefined);
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
