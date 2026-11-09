import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, realpath, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createPiSession, piFinalText } from '../src/pi-sdk.js';
import { stubPiUpstream } from './helpers/pi-https-fixture.js';
import { fakePiSdk, finalMessage } from './helpers/pi-sdk-fixture.js';
import { piBudgetFixture } from './helpers/pi-budget-fixture.js';
import { piHttpRequest } from './helpers/pi-http-fixture.js';

export const nativeRequest = text => ({ model: 'MiniMax-M3', stream: true, max_tokens: 2048,
  thinking: { type: 'disabled' }, messages: [{ role: 'user', content: [{ type: 'text', text }] }] });

test('uses the built-in MiniMax provider and SDK session without registering a provider', async t => {
  const prior = process.umask(0o077); t.after(() => process.umask(prior));
  const stateRoot = await realpath(await mkdtemp(path.join(tmpdir(), 'pi-native-provider-')));
  t.after(() => rm(stateRoot, { recursive: true, force: true }));
  const sessionId = randomUUID(), sessionDir = path.join(stateRoot, 'sessions', sessionId);
  await mkdir(sessionDir, { recursive: true, mode: 0o700 });
  const fake = fakePiSdk(), config = { stateRoot, sessionDir, sessionId, proxyPort: 19493, systemPrompt: 'Synthetic meeting assistant' };
  let session = await createPiSession({ sdk: fake.sdk, config, sessionFile: null, proxyCredential: '0'.repeat(64) });
  const reply = await session.prompt('Synthetic material');
  assert.equal(reply.text, finalMessage().content[0].text);
  assert.equal(fake.calls.create[0].model.provider, 'minimax-cn');
  assert.equal(fake.calls.create[0].model.api, 'anthropic-messages');
  assert.equal(fake.calls.stream[0].model.baseUrl, 'http://127.0.0.1:19493');
  assert.equal(fake.calls.stream[0].options.maxTokens, 2048);
  assert.equal(fake.calls.stream[0].options.maxRetries, 0);
  assert.equal(fake.calls.stream[0].options.reasoning, undefined);
  assert.equal(fake.calls.credential[0].provider, 'minimax-cn');
  const file = session.getSessionFile(); await session.dispose();
  session = await createPiSession({ sdk: fake.sdk, config, sessionFile: file, proxyCredential: '0'.repeat(64) });
  assert.equal(session.readEntries().filter(e => e.type === 'message').length, 2);
  await session.dispose();
  const bytes = await readFile(file), oldVersion = bytes.toString().replace('"version":3', '"version":2');
  await writeFile(file, oldVersion); const opens = fake.calls.open.length;
  await assert.rejects(createPiSession({ sdk: fake.sdk, config, sessionFile: file, proxyCredential: '0'.repeat(64) }));
  assert.equal(fake.calls.open.length, opens);
  assert.equal(await readFile(file, 'utf8'), oldVersion);
  await writeFile(file, bytes);
  const start = { type: 'message_start', message: { model: 'MiniMax-M3', id: 'synthetic', usage: { input_tokens: 20, output_tokens: 0 } } };
  const delta = { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } }, stop = { type: 'message_stop' };
  for (const events of [[], [stop], [start, delta], [start, stop],
    [{ ...start, message: { ...start.message, model: undefined } }, delta, stop],
    [{ ...start, message: { ...start.message, usage: undefined } }, delta, stop],
    [start, { ...delta, usage: undefined }, stop], [start, delta, stop, stop]]) {
    const bad = fakePiSdk(); bad.providerEvents(events);
    const s = await createPiSession({ sdk: bad.sdk, config, sessionFile: file, proxyCredential: '0'.repeat(64) });
    await assert.rejects(s.prompt('Synthetic material')); await s.dispose();
  }
  for (const changed of [{ provider: 'agentmo-budget' }, { api: 'openai-completions' }, { responseModel: 'other' },
    { stopReason: 'length' }, { rawStopReason: 'pause_turn' }, { rawStopReason: 'stop_sequence' },
    { responseId: undefined }, { usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 } },
    { content: [{ type: 'toolCall', id: 'x' }] }]) {
    assert.throws(() => piFinalText({ ...finalMessage(), ...changed }));
  }
});

test('passes native SSE bytes to Pi without parsing or rewriting supplier events', async t => {
  const f = await piBudgetFixture(t, '/x @file !cmd'), admitted = await f.admit(); let calls = 0;
  const body = 'event: message_start\ndata: {"native":"opaque synthetic event"}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n';
  stubPiUpstream(t, async (url, options) => {
    calls++; assert.equal(url, 'https://api.minimax.cn/anthropic/v1/messages');
    assert.equal(options.headers['x-api-key'], 'SYNTHETIC_KEY_MARKER');
    assert.equal(options.headers['anthropic-version'], '2023-06-01');
    assert.equal(options.rejectUnauthorized, true);
    assert.deepEqual(JSON.parse(options.body), nativeRequest(f.text));
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  });
  const result = await piHttpRequest(f.handler, nativeRequest(f.text), { 'x-api-key': admitted.turnToken });
  assert.equal(result.statusCode, 200); assert.equal(result.text(), body);
  assert.equal(calls, 1); assert.equal((await f.summary()).projectReservedFen, 31);
  assert.equal((await piHttpRequest(f.handler, nativeRequest(f.text), { 'x-api-key': admitted.turnToken })).statusCode, 409);
  assert.equal(calls, 1);
});

test('rejects native tool, image, thinking, model and request overflows before spending', async t => {
  let calls = 0;
  stubPiUpstream(t, async () => { calls++; throw new Error('must not send'); });
  for (const change of [r => { r.tools = [{ name: 'bash' }]; }, r => { r.thinking.type = 'enabled'; },
    r => { r.model = 'MiniMax-M3.1-Flash'; }, r => { r.max_tokens = 2049; }, r => { r.stream = false; },
    r => { r.messages[0].content[0] = { type: 'image', source: {} }; },
    r => { r.system = [{ type: 'text', text: 'x'.repeat(48 * 1024) }]; }]) {
    const f = await piBudgetFixture(t), admitted = await f.admit(), request = nativeRequest(f.text); change(request);
    assert.equal((await piHttpRequest(f.handler, request, { 'x-api-key': admitted.turnToken })).statusCode, 400);
    assert.equal((await f.summary()).projectReservedFen, 0);
  }
  assert.equal(calls, 0);
});
