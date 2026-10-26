import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, writeFile, readFile, readdir, chmod } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { createPiSessionHost } from '../src/pi-session-host.js';
import { createPiTurnController, createPiBudgetHandler } from '../src/pi-budget-proxy.js';
import { piBudgetFixture } from './helpers/pi-budget-fixture.js';
import { fakePiSdk, finalMessage } from './helpers/pi-sdk-fixture.js';
import { piHttpRequest } from './helpers/pi-http-fixture.js';
import { digest } from './helpers/pi-native-fixture.js';

async function fixture(t) {
  const oldUmask = process.umask(0o077); t.after(() => process.umask(oldUmask));
  const f = await piBudgetFixture(t, '/x @file !cmd'), fake = fakePiSdk();
  await mkdir(path.join(f.stateRoot, 'sessions'), { mode: 0o700 });
  await writeFile(path.join(f.stateRoot, 'system.md'), '只根据当前会议整理摘要、决策、行动项和待确认问题。', { mode: 0o600 });
  let controller = f.controller, handler;
  const turnClient = Object.fromEntries(['admit', 'finish', 'state', 'status'].map(k => [k, (...args) => controller[k](...args)]));
  const host = await createPiSessionHost({ stateRoot: f.stateRoot, binding: f.binding, sdk: fake.sdk, turnClient });
  const { id: sessionId } = await host.createSession();
  const approvedCases = [{ caseId: 'entry', sessionId, inputDigest: digest(f.text) }];
  controller = await createPiTurnController({ binding: f.binding, stateRoot: f.stateRoot, approvedCases });
  handler = createPiBudgetHandler({ binding: f.binding, stateRoot: f.stateRoot, budgetRoot: f.budgetRoot, apiKey: 'synthetic-upstream', controller });
  const previous = globalThis.fetch; let upstreamCalls = 0;
  globalThis.fetch = async () => { upstreamCalls++; return new Response(JSON.stringify({ model: 'MiniMax-M3',
    choices: [{ index: 0, message: { role: 'assistant', content: '合成最终回复' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 20, completion_tokens: 3, total_tokens: 23 } })); };
  t.after(() => { globalThis.fetch = previous; });
  const attempt = async () => {
    const token = fake.calls.credential.at(-1).credential;
    const result = await piHttpRequest(handler, { model: 'MiniMax-M3', stream: false, max_tokens: 2048,
      messages: [{ role: 'user', content: f.text }] }, { authorization: `Bearer ${token}` });
    assert.equal(result.statusCode, 200);
  };
  fake.sequence(async () => { await attempt(); return [{ type: 'message_end', message: finalMessage() }, { type: 'agent_settled', aborted: false }]; });
  return { ...f, ...fake, host, turnClient, sessionId, approvedCases, attempt, callsCount: () => upstreamCalls };
}
async function collect(host, turnId) { const values = []; for await (const value of host.events(turnId)) values.push(value); return values; }

test('prepares and restores an approved session without default credential files', async t => {
  const f = await fixture(t); await f.host.close();
  let host = await createPiSessionHost({ stateRoot: f.stateRoot, binding: f.binding, sdk: f.sdk,
    turnClient: f.turnClient, approvedCases: f.approvedCases });
  try {
    const room = path.join(f.stateRoot, 'sessions', f.sessionId);
    assert.equal((await readdir(room)).includes('auth.json'), false);
    const turnId = randomUUID();
    await host.submit({ caseId: 'entry', sessionId: f.sessionId, turnId, text: f.text });
    assert.equal((await collect(host, turnId)).at(-1).status, 'completed');
    await host.close();
    const recovered = fakePiSdk();
    host = await createPiSessionHost({ stateRoot: f.stateRoot, binding: f.binding, sdk: recovered.sdk,
      turnClient: f.turnClient, approvedCases: f.approvedCases });
    assert.deepEqual((await host.readSession(f.sessionId)).messages.map(row => row.content), [f.text, '合成最终回复']);
    assert.equal((await readdir(room)).includes('auth.json'), false);
    assert.equal(recovered.calls.prompt.length, 0); assert.equal(f.callsCount(), 1);
    await writeFile(path.join(room, 'auth.json'), '{}', { mode: 0o600 });
    await assert.rejects(host.readSession(f.sessionId));
    assert.equal(recovered.calls.prompt.length, 0);
  } finally { await host.close(); }
});

test('recovers an approved empty prewarm after exit without losing the first turn', async t => {
  const f = await fixture(t); await f.host.close();
  const open = () => createPiSessionHost({ stateRoot: f.stateRoot, binding: f.binding, sdk: f.sdk,
    turnClient: f.turnClient, approvedCases: f.approvedCases });
  let host = await open();
  const room = path.join(f.stateRoot, 'sessions', f.sessionId);
  try {
    assert.deepEqual((await readdir(room)).sort(), ['registration.json', 'sdk-session.json']);
    await host.close();
    host = await open();
    assert.deepEqual((await host.readSession(f.sessionId)).messages, []);
    const turnId = randomUUID();
    await host.submit({ caseId: 'entry', sessionId: f.sessionId, turnId, text: f.text });
    assert.equal((await collect(host, turnId)).at(-1).status, 'completed');
    assert.equal(f.callsCount(), 1);
    await host.close(); host = await open();
    assert.deepEqual((await host.readSession(f.sessionId)).messages.map(row => row.content), [f.text, '合成最终回复']);
    assert.equal(f.callsCount(), 1);
  } finally { await host.close(); }
});

for (const obstacle of ['history marker', 'null marker', 'false marker', 'zero marker', 'empty marker', 'received turn', 'unsafe metadata']) {
  test(`does not recreate missing prewarm history with ${obstacle}`, async t => {
    const f = await fixture(t); await f.host.close();
    const open = () => createPiSessionHost({ stateRoot: f.stateRoot, binding: f.binding, sdk: f.sdk,
      turnClient: f.turnClient, approvedCases: f.approvedCases });
    const host = await open(), room = path.join(f.stateRoot, 'sessions', f.sessionId);
    await host.close();
    const before = await readFile(path.join(room, 'sdk-session.json'));
    if (obstacle.endsWith('marker')) await writeFile(path.join(room, 'sdk-file.json'),
      JSON.stringify({ 'history marker': {}, 'null marker': null, 'false marker': false, 'zero marker': 0, 'empty marker': '' }[obstacle]), { mode: 0o600 });
    else if (obstacle === 'received turn') await f.turnClient.admit({ caseId: 'entry', sessionId: f.sessionId,
      turnId: randomUUID(), inputDigest: digest(f.text) });
    else await chmod(path.join(room, 'sdk-session.json'), 0o644);
    await assert.rejects(open());
    assert.ok(!(await readdir(room)).some(name => name.endsWith('.jsonl')));
    assert.deepEqual(await readFile(path.join(room, 'sdk-session.json')), before);
    assert.equal(f.callsCount(), 0);
  });
}

test('keeps SDK base credentials empty and rejects mutations and cancelled reads', async t => {
  const f = await fixture(t); await f.host.close();
  const host = await createPiSessionHost({ stateRoot: f.stateRoot, binding: f.binding, sdk: f.sdk,
    turnClient: f.turnClient, approvedCases: f.approvedCases });
  try {
    const store = f.calls.runtime[0].credentials;
    assert.ok(store, 'SDK must receive an empty nonpersistent credential store');
    assert.equal(await store.read('agentmo-budget'), undefined); assert.deepEqual(await store.list(), []);
    let called = false;
    await assert.rejects(store.modify('agentmo-budget', async () => { called = true; return { type: 'api_key', key: 'synthetic-only' }; }));
    await assert.rejects(store.delete('agentmo-budget')); assert.equal(called, false);
    assert.equal(await store.read('agentmo-budget'), undefined); assert.deepEqual(await store.list(), []);
    const abort = new AbortController(); abort.abort();
    await assert.rejects(store.read('agentmo-budget', { signal: abort.signal }), { name: 'AbortError' });
    await assert.rejects(store.list({ signal: abort.signal }), { name: 'AbortError' });
  } finally { await host.close(); }
});

test('restores persisted final response without resubmitting', async t => {
  const f = await fixture(t), turnId = randomUUID();
  assert.equal(f.calls.prompt.length, 0);
  const ack = await f.host.submit({ caseId: 'entry', sessionId: f.sessionId, turnId, text: f.text }); assert.equal(ack.status, 'received');
  const events = await collect(f.host, turnId); assert.equal(events.at(-1).status, 'completed'); assert.equal(events.at(-1).text, '合成最终回复');
  await f.host.close();
  const recovered = await createPiTurnController({ binding: f.binding, stateRoot: f.stateRoot, approvedCases: f.approvedCases });
  const fake = fakePiSdk(), host = await createPiSessionHost({ stateRoot: f.stateRoot, binding: f.binding, sdk: fake.sdk, turnClient: recovered });
  const value = await host.readSession(f.sessionId);
  assert.deepEqual(value.messages.map(m => m.content), [f.text, '合成最终回复']); assert.equal(value.turns[0].status, 'completed');
  await collect(host, turnId); await collect(host, turnId);
  assert.equal(fake.calls.prompt.length, 0); assert.equal(f.callsCount(), 1);
  const fresh = await host.createSession(); assert.deepEqual((await host.readSession(fresh.id)).messages, []);
  for (const name of await readdir(path.join(f.stateRoot, 'turns'))) assert.ok(!(await readFile(path.join(f.stateRoot, 'turns', name), 'utf8')).includes('合成最终回复'));
  await host.close();
});

test('marks uncertain turn interrupted after crash', async t => {
  const f = await fixture(t), turnId = randomUUID(); let release, persisted;
  const gate = new Promise(resolve => { release = resolve; }), reachedFinal = new Promise(resolve => { persisted = resolve; });
  f.sequence(async function* () { await f.attempt(); yield { type: 'message_end', message: finalMessage() }; persisted(); await gate; yield { type: 'agent_settled', aborted: false }; });
  await f.host.submit({ caseId: 'entry', sessionId: f.sessionId, turnId, text: f.text }); await reachedFinal;
  const recovered = await createPiTurnController({ binding: f.binding, stateRoot: f.stateRoot, approvedCases: f.approvedCases });
  const closing = f.host.close(); release(); await closing;
  const fake = fakePiSdk(), host = await createPiSessionHost({ stateRoot: f.stateRoot, binding: f.binding, sdk: fake.sdk, turnClient: recovered });
  const value = await host.readSession(f.sessionId); assert.equal(value.turns[0].status, 'interrupted');
  assert.equal((await host.status()).canSend, false); assert.equal(fake.calls.prompt.length, 0); assert.equal(f.callsCount(), 1);
  assert.equal((await host.submit({ caseId: 'entry', sessionId: f.sessionId, turnId, text: f.text })).status, 'interrupted');
  await host.close();
});

test('rejects unregistered sessions and changed private permissions before SDK access', async t => {
  const f = await fixture(t); await assert.rejects(f.host.readSession(randomUUID()));
  await chmod(path.join(f.stateRoot, 'sessions', f.sessionId, 'registration.json'), 0o644);
  await assert.rejects(f.host.readSession(f.sessionId)); assert.equal(f.calls.prompt.length, 0);
  await f.host.close();
});

test('event observation rechecks terminal state after a stale snapshot', async t => {
  const f = await fixture(t), turnId = randomUUID();
  await f.host.submit({ caseId: 'entry', sessionId: f.sessionId, turnId, text: f.text }); await collect(f.host, turnId);
  const realState = f.turnClient.state; let first = true;
  f.turnClient.state = async id => {
    const state = await realState(id);
    if (first) { first = false; return { turnId, sessionId: f.sessionId, status: 'sent' }; }
    return state;
  };
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 100);
  const values = []; try { for await (const event of f.host.events(turnId, { signal: abort.signal })) values.push(event); }
  finally { clearTimeout(timer); }
  assert.equal(values.at(-1).status, 'completed'); assert.equal(f.callsCount(), 1);
  await f.host.close();
});

test('waits for owned metadata publication before reading it', async t => {
  const f = await fixture(t), turnId = randomUUID(); let release, opened;
  const gate = new Promise(resolve => { release = resolve; }), reached = new Promise(resolve => { opened = resolve; });
  const original = fs.promises.open;
  fs.promises.open = async (...args) => {
    const handle = await original(...args);
    if (args[0] === path.join(f.stateRoot, 'sessions', f.sessionId, 'sdk-session.json') && typeof args[1] === 'number' && (args[1] & fs.constants.O_CREAT)) {
      const write = handle.writeFile.bind(handle); handle.writeFile = async (...values) => { opened(); await gate; return write(...values); };
    }
    return handle;
  };
  syncBuiltinESMExports();
  try {
    await f.host.submit({ caseId: 'entry', sessionId: f.sessionId, turnId, text: f.text }); await reached;
    let settled = false; const reading = f.host.readSession(f.sessionId).then(value => { settled = true; return value; }, error => { settled = true; throw error; });
    reading.catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(settled, false); release(); await reading; await collect(f.host, turnId);
  } finally { release(); fs.promises.open = original; syncBuiltinESMExports(); await f.host.close(); }
});
