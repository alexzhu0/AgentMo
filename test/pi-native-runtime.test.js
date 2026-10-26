import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { withPiInstallFixture } from './helpers/pi-install-fixture.js';
import { admitValue, digest } from './helpers/pi-native-fixture.js';
import { applyPiInstall, admitPiInstallReceipt } from '../src/pi-install.js';
import { buildPiInstallPlan } from '../src/pi-install-plan.js';
import { buildPiInstallApproval, buildPiSensitiveActionDecision, buildPiConflictApproval } from '../src/pi-install-approval.js';
import { preflightPiNative, startPiNative, piChildEnvironment } from '../src/pi-native-runtime.js';
import { stopPiNative } from '../src/pi-native-runtime.js';
import * as nativeRuntime from '../src/pi-native-runtime.js';
import childProcess from 'node:child_process';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import fs from 'node:fs';

import { withPiRuntimeFixture } from './helpers/pi-runtime-fixture.js';

test('preflights exact sources before consume spawn or env load', async () => {
  await withPiRuntimeFixture(async f => {
    const before = await readFile(path.join(f.authorityRoot, 'consumption.jsonl'));
    assert.equal((await preflightPiNative(f.runtimeOptions)).modelRequests, 0);
    const originalOpen = fs.promises.open, originalSpawn = childProcess.spawn, originalServer = http.createServer;
    const envPath = path.join(f.root, 'must-not-read.env'); let envReads = 0, spawnCalls = 0, serverCalls = 0;
    fs.promises.open = async (...args) => { if (args[0] === envPath) { envReads++; throw new Error('unexpected env read'); } return originalOpen(...args); };
    childProcess.spawn = () => { spawnCalls++; throw new Error('unexpected spawn'); };
    http.createServer = () => { serverCalls++; throw new Error('unexpected server'); }; syncBuiltinESMExports();
    try {
    for (const options of [
      { ...f.runtimeOptions, stateRoot: path.join(f.root, 'wrong-root') },
      { ...f.runtimeOptions, budgetRoot: path.join(f.root, 'wrong-budget') },
      { ...f.runtimeOptions, sourceAdmissions: { ...f.runtimeOptions.sourceAdmissions, installReceipt: structuredClone(f.runtimeOptions.sourceAdmissions.installReceipt) } },
      { ...f.runtimeOptions, sourceFiles: { ...f.runtimeOptions.sourceFiles, archive: { ...f.runtimeOptions.sourceFiles.archive, expectedDigest: digest('wrong-archive') } } },
    ]) await assert.rejects(startPiNative({ ...options, ...f.decisions, runtimeEnvFile: envPath, approvedCases: [] }));
    assert.deepEqual(await readFile(path.join(f.authorityRoot, 'consumption.jsonl')), before);
    assert.deepEqual({ envReads, spawnCalls, serverCalls }, { envReads: 0, spawnCalls: 0, serverCalls: 0 });
    } finally { fs.promises.open = originalOpen; childProcess.spawn = originalSpawn; http.createServer = originalServer; syncBuiltinESMExports(); }
    await writeFile(path.join(f.stateRoot, 'system.md'), 'changed');
    await assert.rejects(startPiNative({ ...f.runtimeOptions, ...f.decisions, apiKey: 'synthetic', approvedCases: [] }));
    assert.deepEqual(await readFile(path.join(f.authorityRoot, 'consumption.jsonl')), before);
  });
});

test('binds approved cases and restart allowance into the exact activation digest', async () => {
  await withPiRuntimeFixture(async f => {
    assert.equal(f.activationPlan.sensitiveActions.length, 2);
    const cases = [{ caseId: 'entry', sessionId: '00000000-0000-4000-8000-000000000001', inputDigest: digest('合成材料') }];
    const common = { lifecycle: 'activate', activationId: '00000000-0000-4000-8000-000000000001', admissions: f.sourceAdmissions, stateRoot: f.stateRoot,
      authorityRootBinding: f.plan.authorityRootBinding, budgetReference: f.plan.nativeBinding.budgetReference,
      ports: { chat: 19492, proxy: 19493 }, predecessor: f.runtimeOptions.sourceAdmissions.installReceipt };
    const paid = buildPiInstallPlan({ ...common, approvedCases: cases, restartAllowance: 1 });
    assert.deepEqual(paid.approvedCases, cases); assert.equal(paid.restartAllowance, 1);
    assert.equal(paid.sensitiveActions.length, 3);
    assert.notEqual(paid.installPlanDigest, f.activationPlan.installPlanDigest);
    const changed = buildPiInstallPlan({ ...common, approvedCases: [{ ...cases[0], inputDigest: digest('different') }], restartAllowance: 1 });
    assert.notEqual(paid.installPlanDigest, changed.installPlanDigest);
    const nextReadonly = buildPiInstallPlan({ ...common, activationId: '00000000-0000-4000-8000-000000000099' });
    assert.notEqual(nextReadonly.installPlanDigest, f.activationPlan.installPlanDigest);
    assert.equal(nextReadonly.activationId, '00000000-0000-4000-8000-000000000099');
  });
});

test('constructs an explicit child environment without inherited credentials', () => {
  const env = piChildEnvironment('/private/tmp/synthetic-pi', process.execPath);
  for (const key of ['MINIMAX_API_KEY', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'NODE_OPTIONS', 'HTTP_PROXY', 'AGENTMO_RUNTIME_ENV_FILE']) assert.equal(Object.hasOwn(env, key), false);
  assert.equal(env.PI_OFFLINE, '1'); assert.equal(env.PI_TELEMETRY, '0'); assert.equal(env.AGENTMO_PI_CHILD, '1');
});

function fakeResources({ ready = true, shutdown = true } = {}) {
  let child, spawnCalls = 0, closedServers = 0, occupied = false;
  class Child extends EventEmitter {
    connected = true; exitCode = null;
    send(message, callback) {
      this.messages ??= []; this.messages.push(message); callback?.();
      if (message.type === 'init') { this.init = message; if (ready) queueMicrotask(() => this.emit('message', { type: 'ready', runId: message.runId, agentId: 'meeting-text', chatPort: 19492 })); }
      if (message.type === 'shutdown' && shutdown) queueMicrotask(() => { this.connected = false; this.exitCode = 0; this.emit('exit', 0, null); this.emit('close', 0, null); });
    }
    kill() { throw new Error('must wait for owned IPC shutdown'); }
  }
  const spawn = () => { spawnCalls++; child = new Child(); return child; };
  const server = () => Object.assign(new EventEmitter(), {
    listen(port, host, ready) { assert.equal(host, '127.0.0.1'); queueMicrotask(() => occupied ? this.emit('error', Object.assign(new Error('occupied'), { code: 'EADDRINUSE' })) : ready()); },
    closeAllConnections() {}, close(callback) { closedServers++; callback(); },
  });
  return { spawn, server, child: () => child, counts: () => ({ spawnCalls, closedServers }), occupied: () => { occupied = true; } };
}

test('startup steps preserve outcomes and record only finite failure categories', async () => {
  assert.equal(typeof nativeRuntime.runPiStartupStep, 'function');
  const rows = [], record = async row => { rows.push(row); };
  assert.equal(await nativeRuntime.runPiStartupStep('sdk-import', async () => 42, record), 42);
  assert.deepEqual(rows.splice(0), [
    { stage: 'sdk-import', state: 'starting', code: null }, { stage: 'sdk-import', state: 'passed', code: null },
  ]);
  for (const [code, expected] of [['ENOENT', 'ENOENT'], ['private-provider-value', 'OTHER']]) {
    const error = Object.assign(new Error('private error, path and response must not be recorded'), { code });
    await assert.rejects(nativeRuntime.runPiStartupStep('session-prewarm', async () => { throw error; }, record), value => value === error);
    assert.deepEqual(rows.splice(0), [
      { stage: 'session-prewarm', state: 'starting', code: null }, { stage: 'session-prewarm', state: 'failed', code: expected },
    ]);
  }
});

for (const scenario of ['valid', 'extra field', 'out of order', 'wrong run']) {
  test(`admits only bounded child startup diagnostics: ${scenario}`, async () => {
    await withPiRuntimeFixture(async f => {
      const fake = fakeResources({ ready: false }), originalSpawn = childProcess.spawn, originalServer = http.createServer, originalFetch = globalThis.fetch;
      const observed = []; let run, healthRequests = 0;
      childProcess.spawn = () => {
        const child = fake.spawn(), send = child.send.bind(child);
        child.on('agentmo-pi-startup', row => observed.push(row));
        child.send = (message, callback) => {
          send(message, callback);
          if (message.type === 'init') queueMicrotask(() => {
            const stages = ['source-load', 'preflight', 'authority-consumption', 'control-files', 'sdk-import', 'session-prewarm', 'chat-listen'];
            const rows = stages.flatMap((stage, i) => ['starting', 'passed'].map((state, j) => ({
              type: 'startup', runId: message.runId, sequence: 2 * i + j, stage, state, code: null,
            })));
            if (scenario === 'extra field') rows[0].detail = 'must not enter diagnostics';
            if (scenario === 'out of order') rows[0].sequence = 1;
            if (scenario === 'wrong run') rows[0].runId = '00000000-0000-4000-8000-000000000001';
            if (scenario === 'valid') for (const row of rows) child.emit('message', row);
            else child.emit('message', rows[0]);
            if (scenario === 'valid') child.emit('message', { type: 'ready', runId: message.runId, agentId: 'meeting-text', chatPort: 19492 });
          });
        };
        return child;
      };
      http.createServer = fake.server; syncBuiltinESMExports();
      globalThis.fetch = async () => { healthRequests++; return new Response(await readFile('src/pi-chat.html'), { headers: { 'content-security-policy': "frame-ancestors 'none'" } }); };
      try {
        const starting = startPiNative({ ...f.runtimeOptions, ...f.decisions, approvedCases: [] });
        if (scenario === 'valid') {
          run = await starting; assert.equal(observed.length, 14); assert.equal(observed.at(-1).stage, 'chat-listen');
          assert.equal(observed.at(-1).state, 'passed'); assert.equal(healthRequests, 1); await run.stop();
        } else { await assert.rejects(starting); assert.deepEqual(observed, []); assert.equal(healthRequests, 0); }
        assert.deepEqual(fake.counts(), { spawnCalls: 1, closedServers: 1 });
      } finally { await run?.stop(); childProcess.spawn = originalSpawn; http.createServer = originalServer; globalThis.fetch = originalFetch; syncBuiltinESMExports(); }
    });
  });
}

for (const scenario of ['delayed-ready', 'loaded-ready', 'ready-timeout', 'cancel-during-validation', 'cancel-then-late-ready', 'cancel-before-init-callback']) {
  test(`bounded startup handles ${scenario} without retries or premature health checks`, async t => {
    await withPiRuntimeFixture(async f => {
      const cancelling = scenario.startsWith('cancel-');
      const fake = fakeResources({ ready: false, shutdown: !cancelling });
      const originalSpawn = childProcess.spawn, originalServer = http.createServer, originalFetch = globalThis.fetch;
      const controller = new AbortController();
      let spawned, run, settled = false, healthRequests = 0;
      const childCreated = new Promise(resolve => { spawned = resolve; });
      childProcess.spawn = () => {
        t.mock.timers.enable({ apis: ['setTimeout'] }); const child = fake.spawn();
        if (scenario === 'cancel-before-init-callback') {
          const send = child.send.bind(child);
          child.send = (message, callback) => { if (message.type === 'init') controller.abort(); send(message, callback); };
        }
        spawned(); return child;
      };
      http.createServer = fake.server; syncBuiltinESMExports();
      globalThis.fetch = async () => { healthRequests++; return new Response(await readFile('src/pi-chat.html'), {
        headers: { 'content-security-policy': "frame-ancestors 'none'" },
      }); };
      const tick = () => new Promise(resolve => setImmediate(resolve));
      const options = { ...f.runtimeOptions, ...f.decisions, approvedCases: [], signal: controller.signal };
      const started = startPiNative(options).then(value => { settled = true; run = value; return { value }; }, error => { settled = true; return { error }; });
      try {
        await childCreated; await tick(); await tick();
        const child = fake.child();
        if (cancelling) { controller.abort(); await tick(); await tick(); }
        t.mock.timers.tick(scenario === 'ready-timeout' ? 299999 : scenario === 'loaded-ready' ? 171076 : 37545);
        await tick(); await tick();
        assert.equal(settled, false);
        assert.equal(healthRequests, 0);
        if (scenario === 'cancel-then-late-ready') {
          child.emit('message', { type: 'ready', runId: child.init.runId, agentId: 'meeting-text', chatPort: 19492 });
          await tick(); await tick(); assert.equal(healthRequests, 0); assert.equal(settled, false);
        }
        if (scenario.endsWith('-ready') && !cancelling) child.emit('message', { type: 'ready', runId: child.init.runId, agentId: 'meeting-text', chatPort: 19492 });
        else if (scenario === 'ready-timeout') t.mock.timers.tick(1);
        else { child.connected = false; child.exitCode = 0; child.emit('exit', 0, null); }
        const result = await started;
        if (scenario.endsWith('-ready') && !cancelling) {
          assert.ok(result.value); assert.equal(result.value.entry.canSend, false);
          assert.equal(healthRequests, 1); assert.equal((await run.stop()).ownChildExited, true);
        } else {
          assert.equal(result.error?.code, 'AGENTMO_PI_RUNTIME_REJECTED');
          const stoppedName = (await readdir(path.join(f.stateRoot, 'attempts'))).find(name => name.endsWith('.stopped.json'));
          const stopped = JSON.parse(await readFile(path.join(f.stateRoot, 'attempts', stoppedName)));
          assert.equal(stopped.status, 'failed'); assert.equal(stopped.ownChildExited, true);
          assert.equal(stopped.reason, scenario === 'ready-timeout' ? 'startup-failed' : 'signal');
          const consumed = await readFile(path.join(f.authorityRoot, 'consumption.jsonl'));
          await assert.rejects(startPiNative({ ...options, signal: new AbortController().signal }));
          assert.deepEqual(await readFile(path.join(f.authorityRoot, 'consumption.jsonl')), consumed);
        }
        assert.deepEqual(fake.counts(), { spawnCalls: 1, closedServers: 1 });
      } finally {
        await run?.stop(); t.mock.timers.reset(); childProcess.spawn = originalSpawn;
        http.createServer = originalServer; globalThis.fetch = originalFetch; syncBuiltinESMExports();
      }
    });
  });
}

test('stop observer waits for owned startup validation to drain beyond fifteen seconds', async () => {
  await withPiRuntimeFixture(async f => {
    const fake = fakeResources({ shutdown: false }), originalSpawn = childProcess.spawn;
    const originalServer = http.createServer, originalFetch = globalThis.fetch, originalTimeout = globalThis.setTimeout;
    let run, elapsed = 0;
    childProcess.spawn = fake.spawn; http.createServer = fake.server; syncBuiltinESMExports();
    globalThis.fetch = async () => new Response(await readFile('src/pi-chat.html'), { headers: { 'content-security-policy': "frame-ancestors 'none'" } });
    try {
      run = await startPiNative({ ...f.runtimeOptions, ...f.decisions, approvedCases: [] });
      globalThis.fetch = async () => { void run.stop(); return new Response('{}', { status: 202 }); };
      globalThis.setTimeout = (callback, ms, ...args) => {
        if (ms !== 100) return originalTimeout(callback, ms, ...args);
        return setImmediate(() => {
          elapsed += 100;
          if (elapsed === 37600) { const child = fake.child(); child.connected = false; child.exitCode = 0; child.emit('exit', 0, null); }
          callback(...args);
        });
      };
      const result = await stopPiNative({ planAdmission: f.runtimeOptions.planAdmission, stateRoot: f.stateRoot });
      assert.equal(result.status, 'stopped'); assert.equal(result.ownChildExited, true);
      assert.ok(elapsed >= 37600); assert.deepEqual(fake.counts(), { spawnCalls: 1, closedServers: 1 });
    } finally {
      const child = fake.child(); if (child?.connected) { child.connected = false; child.emit('exit', 0, null); }
      await run?.stop(); childProcess.spawn = originalSpawn; http.createServer = originalServer;
      globalThis.fetch = originalFetch; globalThis.setTimeout = originalTimeout; syncBuiltinESMExports();
    }
  });
});

test('stop observer rejects an unfinished receipt at its bound without overwriting it', async () => {
  await withPiRuntimeFixture(async f => {
    const fake = fakeResources(), originalSpawn = childProcess.spawn, originalServer = http.createServer;
    const originalFetch = globalThis.fetch, originalTimeout = globalThis.setTimeout;
    let run, elapsed = 0;
    childProcess.spawn = fake.spawn; http.createServer = fake.server; syncBuiltinESMExports();
    globalThis.fetch = async () => new Response(await readFile('src/pi-chat.html'), { headers: { 'content-security-policy': "frame-ancestors 'none'" } });
    try {
      run = await startPiNative({ ...f.runtimeOptions, ...f.decisions, approvedCases: [] });
      const stoppedPath = run.entry.accessFile.replace(/\.login\.txt$/u, '.stopped.json');
      globalThis.fetch = async () => { await writeFile(stoppedPath, '{', { flag: 'wx', mode: 0o600 }); return new Response('{}', { status: 202 }); };
      globalThis.setTimeout = (callback, ms, ...args) => ms === 100
        ? setImmediate(() => { elapsed += 100; callback(...args); }) : originalTimeout(callback, ms, ...args);
      await assert.rejects(stopPiNative({ planAdmission: f.runtimeOptions.planAdmission, stateRoot: f.stateRoot }));
      assert.equal(elapsed, 300000); assert.equal(await readFile(stoppedPath, 'utf8'), '{');
      assert.equal((await run.stop()).status, 'failed');
      assert.equal(await readFile(stoppedPath, 'utf8'), '{');
    } finally {
      await run?.stop(); childProcess.spawn = originalSpawn; http.createServer = originalServer;
      globalThis.fetch = originalFetch; globalThis.setTimeout = originalTimeout; syncBuiltinESMExports();
    }
  });
});

test('starts only an owned isolated child and accepts a stop-only capability', async () => {
  await withPiRuntimeFixture(async f => {
    const fake = fakeResources(), originalSpawn = childProcess.spawn, originalServer = http.createServer, originalFetch = globalThis.fetch;
    let healthRequests = 0, captured;
    childProcess.spawn = (...args) => { captured = args; return fake.spawn(...args); }; http.createServer = fake.server; syncBuiltinESMExports();
    globalThis.fetch = async url => { healthRequests++; assert.equal(url, 'http://127.0.0.1:19492/');
      return new Response(await readFile('src/pi-chat.html'), { headers: { 'content-security-policy': "frame-ancestors 'none'" } }); };
    let run;
    try {
      run = await startPiNative({ ...f.runtimeOptions, ...f.decisions, approvedCases: [], apiKey: 'synthetic-test-only' });
      assert.equal(run.entry.canSend, false); assert.equal(run.entry.modelRequests, 0); assert.equal(healthRequests, 1);
      assert.equal(captured[0], f.targetPaths.nodeExecutablePath); assert.deepEqual(captured[1].slice(1), ['--pi-owned-child']);
      assert.equal(captured[2].shell, false); assert.equal(Object.hasOwn(captured[2].env, 'MINIMAX_API_KEY'), false);
      const child = fake.child(), requestId = '00000000-0000-4000-8000-000000000001';
      child.emit('message', { type: 'call', runId: child.init.runId, requestId, method: 'admit', input: {
        caseId: 'entry', sessionId: requestId, turnId: '00000000-0000-4000-8000-000000000002', inputDigest: digest('unapproved') } });
      await new Promise(resolve => setTimeout(resolve, 30));
      assert.equal(child.messages.find(m => m.type === 'result' && m.requestId === requestId).ok, false);
      const controlPath = run.entry.accessFile.replace(/\.login\.txt$/u, '.control.json'), original = await readFile(controlPath);
      const wrong = JSON.parse(original); wrong.rootIdentity = { device: '0', inode: '0', birthtimeNs: '0' }; await writeFile(controlPath, JSON.stringify(wrong));
      await assert.rejects(stopPiNative({ planAdmission: f.runtimeOptions.planAdmission, stateRoot: f.stateRoot })); assert.equal(healthRequests, 1);
      await writeFile(controlPath, original);
      let stopRequests = 0;
      globalThis.fetch = async (url, request) => {
        assert.equal(url, 'http://127.0.0.1:19492/api/stop'); assert.equal(request.method, 'POST');
        assert.ok(request.headers.authorization.startsWith('AgentMoStop ')); stopRequests++; void run.stop();
        return new Response('{}', { status: 202 });
      };
      assert.equal((await stopPiNative({ planAdmission: f.runtimeOptions.planAdmission, stateRoot: f.stateRoot })).status, 'stopped');
      assert.equal(stopRequests, 1); assert.equal((await run.completion).ownChildExited, true);
      assert.deepEqual(fake.counts(), { spawnCalls: 1, closedServers: 1 });
      const plan=buildPiInstallPlan({lifecycle:'activate',activationId:'00000000-0000-4000-8000-000000000099',admissions:f.sourceAdmissions,stateRoot:f.stateRoot,
        authorityRootBinding:f.plan.authorityRootBinding,budgetReference:f.plan.nativeBinding.budgetReference,ports:{chat:19492,proxy:19493},predecessor:f.runtimeOptions.sourceAdmissions.installReceipt});
      const dir=path.join(f.root,'next-activation');await import('node:fs/promises').then(fs=>fs.mkdir(dir));
      const planAdmission=await admitValue(dir,plan,'pi-install-plan');
      const common={plan,decision:'approve',issuedAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()};
      globalThis.fetch=async()=>new Response(await readFile('src/pi-chat.html'),{headers:{'content-security-policy':"frame-ancestors 'none'"}});
      run=await startPiNative({...f.runtimeOptions,planAdmission,sourceFiles:{...f.runtimeOptions.sourceFiles,activationPlan:{filePath:path.join(dir,'pi-install-plan.json'),expectedDigest:planAdmission.digest}},
        ordinaryApproval:buildPiInstallApproval({...common,useNonce:'next-ordinary'}),sensitiveDecisions:plan.sensitiveActions.map((action,i)=>buildPiSensitiveActionDecision({...common,action,useNonce:`next-sensitive-${i}`})),
        conflictApproval:buildPiConflictApproval({...common,conflicts:[],useNonce:'next-conflict'}),approvedCases:[],apiKey:'synthetic-test-only'});
      assert.equal(run.entry.canSend,false);await run.stop();assert.equal(fake.counts().spawnCalls,2);

    } finally { await run?.stop(); childProcess.spawn = originalSpawn; http.createServer = originalServer; globalThis.fetch = originalFetch; syncBuiltinESMExports(); }
  });
});

test('port ownership failure preserves consumed authority and never retries', async () => {
  await withPiRuntimeFixture(async f => {
    const fake = fakeResources(); fake.occupied(); const originalSpawn = childProcess.spawn, originalServer = http.createServer;
    childProcess.spawn = fake.spawn; http.createServer = fake.server; syncBuiltinESMExports();
    try {
      const options = { ...f.runtimeOptions, ...f.decisions, approvedCases: [], apiKey: 'synthetic-test-only' };
      await assert.rejects(startPiNative(options));
      const first = await readFile(path.join(f.authorityRoot, 'consumption.jsonl'));
      await assert.rejects(startPiNative(options)); assert.deepEqual(await readFile(path.join(f.authorityRoot, 'consumption.jsonl')), first);
      assert.equal(fake.counts().spawnCalls, 0);
    } finally { childProcess.spawn = originalSpawn; http.createServer = originalServer; syncBuiltinESMExports(); }
  });
});

test('rejects a foreign unsettled activation before consuming a new approval', async()=>withPiRuntimeFixture(async f=>{
  await writeFile(path.join(f.stateRoot,'attempts',`pi-run-${'f'.repeat(64)}-0.claim.json`),'{}',{mode:0o600});
  const before=await readFile(path.join(f.authorityRoot,'consumption.jsonl'));
  const resources=fakeResources();resources.occupied();const originalServer=http.createServer;http.createServer=resources.server;syncBuiltinESMExports();
  try {await assert.rejects(startPiNative({...f.runtimeOptions,...f.decisions,apiKey:'synthetic',approvedCases:[]}));}
  finally {http.createServer=originalServer;syncBuiltinESMExports();}
  assert.deepEqual(await readFile(path.join(f.authorityRoot,'consumption.jsonl')),before);
}));
