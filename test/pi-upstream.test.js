import assert from 'node:assert/strict';
import test from 'node:test';
import { stubPiUpstream } from './helpers/pi-https-fixture.js';
import { piBudgetFixture } from './helpers/pi-budget-fixture.js';
import { piHttpRequest, piNativeRequest, piNativeResponse } from './helpers/pi-http-fixture.js';
import { postPiMessages } from '../src/pi-upstream.js';

test('dispatches one bounded native HTTPS request after reservation', async t => {
  const f = await piBudgetFixture(t), admitted = await f.admit(); let calls = 0;
  stubPiUpstream(t, async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.minimax.cn/anthropic/v1/messages');
    assert.equal(options.method, 'POST');
    assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.agent, false);
    assert.equal(options.headers['content-length'], Buffer.byteLength(options.body));
    assert.equal(options.headers['x-api-key'], 'SYNTHETIC_KEY_MARKER');
    assert.equal((await f.summary()).projectReservedFen, 31);
    return piNativeResponse();
  });
  const result = await piHttpRequest(f.handler, piNativeRequest(f.text), { 'x-api-key': admitted.turnToken });
  assert.equal(result.statusCode, 200); assert.equal(calls, 1);
});

test('preserves failures without retry or secret output', async t => {
  let response, calls = 0;
  stubPiUpstream(t, async () => { calls++; return response; });
  for (const status of [503, 429, 401, 302]) {
    response = new Response('SYNTHETIC_BODY_MARKER', { status });
    const f = await piBudgetFixture(t), admitted = await f.admit(), before = calls;
    const reply = await piHttpRequest(f.handler, piNativeRequest(f.text), { 'x-api-key': admitted.turnToken });
    const failure = await f.controller.state(f.turnId);
    assert.equal(failure.upstreamStatus, status); assert.equal(calls, before + 1);
    assert.equal((await f.summary()).projectReservedFen, 31);
    assert.doesNotMatch(reply.text(), /SYNTHETIC_/);
  }
});

test('aborts before headers or during a stream without another request', async t => {
  let calls = 0;
  stubPiUpstream(t, async () => { calls++; return new Promise(() => {}); });
  const abort = new AbortController();
  const pending = postPiMessages({ body: '{}', apiKey: 'synthetic', signal: abort.signal });
  abort.abort(); await assert.rejects(pending); assert.equal(calls, 0);
});

test('bounds response streams and keeps failed reservations', async t => {
  let response, calls = 0;
  stubPiUpstream(t, async () => { calls++; return response; });
  for (const body of ['x'.repeat(1024 * 1024 + 1), new ReadableStream({ start(c) { c.error(new Error('SYNTHETIC_BODY_MARKER')); } })]) {
    response = new Response(body, { headers: { 'content-type': 'text/event-stream' } });
    const f = await piBudgetFixture(t), admitted = await f.admit(), before = calls;
    const reply = await piHttpRequest(f.handler, piNativeRequest(f.text), { 'x-api-key': admitted.turnToken });
    assert.equal(reply.statusCode, 502); assert.equal(calls, before + 1);
    assert.equal((await f.summary()).projectReservedFen, 31); assert.doesNotMatch(reply.text(), /SYNTHETIC_/);
  }
});

test('aborts after dispatch and while consuming a response stream', async t => {
  await t.test('before response headers', async t => {
    let calls = 0; stubPiUpstream(t, async () => { calls++; return new Promise(() => {}); });
    const abort = new AbortController(), pending = postPiMessages({ body: '{}', apiKey: 'synthetic', signal: abort.signal });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 1);
    abort.abort(); await assert.rejects(pending); assert.equal(calls, 1);
  });
  await t.test('after response headers', async t => {
    let calls = 0;
    stubPiUpstream(t, async () => { calls++; return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('partial')); } }), { headers: { 'content-type': 'text/event-stream' } }); });
    const abort = new AbortController(), response = await postPiMessages({ body: '{}', apiKey: 'synthetic', signal: abort.signal });
    const body = response.text(); abort.abort(); await assert.rejects(body); assert.equal(calls, 1);
  });
});
