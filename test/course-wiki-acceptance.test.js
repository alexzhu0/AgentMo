import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const module = await import('../scripts/course-wiki-acceptance.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const catalog = JSON.parse(await readFile(new URL('../docs/poc/course-wiki/acceptance-cases.json', import.meta.url)));
const digest = value => `sha256:${createHash('sha256').update(String(value)).digest('hex')}`;
const sessionDigest = value => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;

test('case bounds and safe gateway events reconcile route spending without raw data', () => {
  assert.deepEqual(catalog.providerCallBoundsByCase.greeting, { smallCorpus: 2, largeCorpus: 3 });
  assert.deepEqual(catalog.providerCallBoundsByCase.followup, { smallCorpus: 4, largeCorpus: 6 });
  assert.equal(module.courseWikiCorpusRoute([{ sourceDigest: digest('source'), lines: ['x'] }]), 'smallCorpus');
  const safe = module.safeCourseGatewayEvent({ status: 'success', stageNames: ['route', 'retrieved-select', 'answer'],
    providerRequestCount: 3, rawAnswer: 'SECRET CANARY' });
  assert.deepEqual(safe, { kind: 'gateway-result', status: 'success', stageNames: ['route', 'retrieved-select', 'answer'], providerRequestCount: 3 });
  assert.deepEqual(module.safeCourseGatewayEvent({ status: 'failed', code: 'COURSE_WIKI_OPERATION_BUSY' }),
    { kind: 'gateway-result', status: 'failed', code: 'COURSE_WIKI_OPERATION_BUSY', stageNames: [], providerRequestCount: 0 });
  assert.deepEqual(module.reconcileCourseGatewayEvents({ events: [safe], route: 'largeCorpus', beforeReservations: 7,
    afterReservations: 10, maximumRequests: 3, expectedTurns: 1 }),
    { providerRequestCount: 3, stageNames: ['route', 'retrieved-select', 'answer'] });
  assert.throws(() => module.reconcileCourseGatewayEvents({ events: [safe], route: 'largeCorpus', beforeReservations: 7,
    afterReservations: 9, maximumRequests: 3, expectedTurns: 1 }));
  assert.throws(() => module.reconcileCourseGatewayEvents({ events: [safe, safe], route: 'largeCorpus', beforeReservations: 7,
    afterReservations: 13, maximumRequests: 6, expectedTurns: 1 }));
});

test('exclusive safe event bridge records only stage counts', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'course-events-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const eventPath = path.join(root, 'gateway-events-unit.jsonl');
  const bridge = module.openCourseGatewayEventLog({ eventPath, ownedRoot: root });
  bridge.write({ status: 'success', stageNames: ['small-select', 'answer'], providerRequestCount: 2,
    prompt: 'RAW PROMPT CANARY', output: 'RAW ANSWER CANARY' });
  bridge.close();
  const contents = await readFile(eventPath, 'utf8');
  assert.equal(contents.includes('RAW'), false);
  assert.deepEqual(module.parseCourseGatewayEvents(contents), [{ kind: 'gateway-result',
    status: 'success', stageNames: ['small-select', 'answer'], providerRequestCount: 2 }]);
  assert.deepEqual(await module.readCourseGatewayEventLog({ eventPath, ownedRoot: root }),
    module.parseCourseGatewayEvents(contents));
  assert.throws(() => module.openCourseGatewayEventLog({ eventPath, ownedRoot: root }));
});

test('failed native stage persists reconciled bounded accounting and stops later cases', async t => {
  const root = await temp(t);
  const context = runtime(root);
  const outputPath = path.join(root, 'failed-stage.json');
  let failureInspections = 0;
  const artifact = await module.runCourseWikiAcceptance({ caseCatalog: catalog,
    selectedCaseIds: ['greeting', 'capabilities'], inputFixtures: [fixture('greeting'), fixture('capabilities')],
    outputPath, runtimeContext: context, operatorPreflight: preflightFor(context),
    inspectExecution: passingChecks, reviewCase: passingReview,
    async inspectNativeFailure({ caseId, progress, code }) {
      failureInspections++;
      assert.equal(caseId, 'greeting');
      assert.equal(progress.actualAttemptCount, 1);
      assert.equal(code, 'native-exit-failed');
      return { providerRequestCount: 2, stageNames: ['small-select', 'answer'], reservationDelta: 2 };
    },
    nativeTransport: { async runCase({ fixture: value, onProgress }) {
      onProgress({ actualAttemptCount: 1, receivedAnswerCount: 0,
        sessionDigests: [sessionDigest(value.turns[0].sessionId)] });
      throw Object.assign(new Error('RAW PROVIDER CANARY'), { code: 'COURSE_WIKI_ACCEPTANCE_NATIVE_EXIT_FAILED' });
    } },
  });
  assert.equal(failureInspections, 1);
  assert.equal(artifact.status, 'incomplete');
  assert.equal(artifact.failure.code, 'native-exit-failed');
  assert.equal(artifact.records[1].status, 'stopped-after-failure');
  assert.deepEqual(artifact.records[0].evidence.failureAccounting,
    { providerRequestCount: 2, stageNames: ['small-select', 'answer'], reservationDelta: 2 });
  const stored = await readFile(outputPath, 'utf8');
  assert.equal(stored.includes('RAW PROVIDER CANARY'), false);
});

test('current-message evidence remains bound to the admitted native fixture', async t => {
  const root = await temp(t);
  const context = runtime(root);
  const input = fixture('greeting', ['original greeting']);
  const artifact = await module.runCourseWikiAcceptance({ caseCatalog: catalog,
    selectedCaseIds: ['greeting'], inputFixtures: [input], outputPath: path.join(root, 'bound-message.json'),
    runtimeContext: context, operatorPreflight: preflightFor(context),
    inspectExecution: passingChecks, reviewCase: passingReview,
    nativeTransport: { async runCase({ fixture: value }) {
      value.turns[0].message = 'TAMPERED RAW MESSAGE';
      return { outputs: ['transient'], trace: { actualAttemptCount: 1, receivedAnswerCount: 1,
        sessionDigests: [sessionDigest(value.turns[0].sessionId)] } };
    } },
  });
  assert.deepEqual(artifact.records[0].evidence.currentMessageDigests, [sessionDigest('original greeting')]);
  assert.equal(JSON.stringify(artifact).includes('TAMPERED RAW MESSAGE'), false);
});

test('failed child with delayed reservation stays settlement-unconfirmed and stops the batch', async t => {
  const root = await temp(t);
  const context = runtime(root);
  let clock = 0;
  let reservations = 4;
  const gatewayEvents = [];
  let nativeCalls = 0;
  const artifact = await module.runCourseWikiAcceptance({ caseCatalog: catalog,
    selectedCaseIds: ['greeting', 'capabilities'], inputFixtures: [fixture('greeting'), fixture('capabilities')],
    outputPath: path.join(root, 'unconfirmed.json'), runtimeContext: context,
    operatorPreflight: preflightFor(context), inspectExecution: passingChecks, reviewCase: passingReview,
    async inspectNativeFailure() {
      await module.awaitCourseGatewaySettlement({ readEvents: async () => gatewayEvents,
        beforeEvents: [], expectedEvents: 1, timeoutMs: 20,
        now: () => clock, pause: async () => { clock += 10; } });
      return { providerRequestCount: reservations - 4, stageNames: [], reservationDelta: reservations - 4 };
    },
    nativeTransport: { async runCase({ fixture: value, onProgress }) {
      nativeCalls++;
      onProgress({ actualAttemptCount: 1, receivedAnswerCount: 0,
        sessionDigests: [sessionDigest(value.turns[0].sessionId)] });
      throw Object.assign(new Error('child failed before gateway settled'),
        { code: 'COURSE_WIKI_ACCEPTANCE_NATIVE_EXIT_FAILED' });
    } },
  });
  reservations += 1;
  gatewayEvents.push({ kind: 'gateway-result', status: 'failed', code: 'COURSE_WIKI_UPSTREAM_TIMEOUT',
    stageNames: ['small-select'], providerRequestCount: 1 });
  assert.equal(nativeCalls, 1);
  assert.equal(artifact.failure.code, 'native-settlement-unconfirmed');
  assert.equal(artifact.records[0].evidence.settlement, 'unconfirmed');
  assert.equal(artifact.records[0].evidence.failureAccounting, undefined);
  assert.equal(artifact.records[1].status, 'stopped-after-failure');
});

test('successful cases persist their own route stage count and ledger delta in execution evidence', async t => {
  const root = await temp(t);
  const context = runtime(root);
  const outputPath = path.join(root, 'successful-accounting.json');
  const accounting = {
    greeting: { route: 'smallCorpus', stageNames: ['small-select'], providerRequestCount: 1, reservationDelta: 1 },
    capabilities: { route: 'smallCorpus', stageNames: ['small-select', 'answer'], providerRequestCount: 2, reservationDelta: 2 },
  };
  const artifact = await module.runCourseWikiAcceptance({ caseCatalog: catalog,
    selectedCaseIds: ['greeting', 'capabilities'], inputFixtures: [fixture('greeting'), fixture('capabilities')],
    outputPath, runtimeContext: context, operatorPreflight: preflightFor(context),
    inspectExecution({ caseDefinition }) {
      return { checks: passingChecks({ caseDefinition }), providerAccounting: accounting[caseDefinition.id] };
    },
    reviewCase: passingReview,
    nativeTransport: { async runCase({ fixture: value }) {
      return { outputs: ['safe answer'], trace: { actualAttemptCount: 1, receivedAnswerCount: 1,
        sessionDigests: [sessionDigest(value.turns[0].sessionId)] } };
    } },
  });
  for (const id of ['greeting', 'capabilities']) {
    const record = artifact.records.find(value => value.id === id);
    assert.equal(record.status, 'passed');
    assert.deepEqual(record.evidence.providerAccounting, accounting[id]);
    assert.equal(record.execution.evidenceDigest, record.evidence.evidenceDigest);
  }
  assert.notEqual(artifact.records[0].evidence.executionDigest, artifact.records[1].evidence.executionDigest);
  assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), artifact);
});

test('execution accounting route must match the selected preflight route', async t => {
  const root = await temp(t);
  const context = runtime(root);
  const outputPath = path.join(root, 'mismatched-route.json');
  const artifact = await module.runCourseWikiAcceptance({ caseCatalog: catalog,
    selectedCaseIds: ['greeting'], inputFixtures: [fixture('greeting')], outputPath,
    runtimeContext: context, operatorPreflight: preflightFor(context),
    requireProviderAccounting: true,
    inspectExecution({ caseDefinition }) {
      return { checks: passingChecks({ caseDefinition }), providerAccounting: {
        route: 'largeCorpus', stageNames: ['route', 'retrieved-select', 'answer'],
        providerRequestCount: 3, reservationDelta: 3 } };
    },
    reviewCase: passingReview,
    nativeTransport: { async runCase({ fixture: value }) {
      return { outputs: ['safe answer'], trace: { actualAttemptCount: 1,
        receivedAnswerCount: 1, sessionDigests: [sessionDigest(value.turns[0].sessionId)] } };
    } },
  });
  assert.equal(artifact.failure.code, 'execution-inspection-rejected');
  assert.equal(artifact.records[0].evidence.providerAccounting, undefined);
  assert.equal(JSON.parse(await readFile(outputPath, 'utf8')).records[0].evidence.providerAccounting, undefined);
});

test('execution accounting rejects out-of-order stages within one small-corpus turn', async t => {
  const root = await temp(t);
  const context = runtime(root);
  const artifact = await module.runCourseWikiAcceptance({ caseCatalog: catalog,
    selectedCaseIds: ['greeting'], inputFixtures: [fixture('greeting')],
    outputPath: path.join(root, 'out-of-order.json'), runtimeContext: context,
    operatorPreflight: preflightFor(context), requireProviderAccounting: true,
    inspectExecution({ caseDefinition }) {
      return { checks: passingChecks({ caseDefinition }), providerAccounting: {
        route: 'smallCorpus', stageNames: ['answer', 'small-select'],
        providerRequestCount: 2, reservationDelta: 2 } };
    },
    reviewCase: passingReview,
    nativeTransport: { async runCase({ fixture: value }) {
      return { outputs: ['safe answer'], trace: { actualAttemptCount: 1,
        receivedAnswerCount: 1, sessionDigests: [sessionDigest(value.turns[0].sessionId)] } };
    } },
  });
  assert.equal(artifact.failure.code, 'execution-inspection-rejected');
  assert.equal(artifact.records[0].evidence.providerAccounting, undefined);
});

test('altered case identity or reduced approved route ceiling is rejected before native work', async t => {
  const root = await temp(t);
  const context = runtime(root);
  let nativeCalls = 0;
  for (const mode of ['unknown-id', 'reduced-ceiling']) {
    const altered = structuredClone(catalog);
    let caseId = 'greeting';
    if (mode === 'unknown-id') {
      caseId = 'greeting-renamed';
      altered.cases.find(value => value.id === 'greeting').id = caseId;
      altered.providerCallBoundsByCase[caseId] = altered.providerCallBoundsByCase.greeting;
      delete altered.providerCallBoundsByCase.greeting;
    } else {
      altered.providerCallBoundsByCase.greeting = { smallCorpus: 1, largeCorpus: 1 };
    }
    await assert.rejects(module.runCourseWikiAcceptance({ caseCatalog: altered,
      selectedCaseIds: [caseId], inputFixtures: [fixture(caseId)],
      outputPath: path.join(root, `${mode}.json`), runtimeContext: context,
      operatorPreflight: preflightFor(context), inspectExecution: passingChecks, reviewCase: passingReview,
      nativeTransport: { async runCase() { nativeCalls++; throw new Error('must not run'); } },
    }));
  }
  assert.equal(nativeCalls, 0);
});

test('small-corpus preflight rejects large-route gateway stages despite matching ledger delta', () => {
  const event = { kind: 'gateway-result', status: 'success',
    stageNames: ['route', 'retrieved-select', 'answer'], providerRequestCount: 3 };
  assert.throws(() => module.reconcileCourseGatewayEvents({ events: [event], route: 'smallCorpus',
    beforeReservations: 4, afterReservations: 7, maximumRequests: 3, expectedTurns: 1 }));
});

test('safe gateway failure codes use an exact allowlist', () => {
  assert.deepEqual(module.safeCourseGatewayEvent({ status: 'failed', code: 'COURSE_WIKI_OPERATION_BUSY' }),
    { kind: 'gateway-result', status: 'failed', code: 'COURSE_WIKI_OPERATION_BUSY',
      stageNames: [], providerRequestCount: 0 });
  assert.throws(() => module.safeCourseGatewayEvent({ status: 'failed',
    code: 'COURSE_WIKI_PRIVATE_SECRET', stageNames: [], providerRequestCount: 0 }));
});

async function temp(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'course-acceptance-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ['cwd', 'home', 'state', 'workspace', 'xdg-config', 'xdg-data', 'xdg-cache', 'tmp']) {
    await mkdir(path.join(root, name));
  }
  await writeFile(path.join(root, 'config.json'), '{}\n');
  return root;
}

function runtime(root, overrides = {}) {
  return {
    executable: '/Users/alexzhu/.local/bin/openclaw',
    agentId: 'course-wiki',
    generationId: 'generation-1',
    runtimeDigest: digest('runtime'),
    executorId: 'course-wiki-native-runner',
    reviewerId: 'course-wiki-independent-reviewer',
    cwd: path.join(root, 'cwd'),
    homeDir: path.join(root, 'home'),
    stateDir: path.join(root, 'state'),
    configPath: path.join(root, 'config.json'),
    workspaceDir: path.join(root, 'workspace'),
    xdgConfigDir: path.join(root, 'xdg-config'),
    xdgDataDir: path.join(root, 'xdg-data'),
    xdgCacheDir: path.join(root, 'xdg-cache'),
    tempDir: path.join(root, 'tmp'),
    timeoutMs: 2_000,
    settlementMs: 50,
    maxStdoutBytes: 64 * 1024,
    maxStderrBytes: 16 * 1024,
    ...overrides,
  };
}

function fixture(id, messages = [`exact prompt for ${id}`]) {
  return {
    id,
    kind: 'native-agent-turns',
    turns: messages.map((message, index) => ({ sessionId: `acceptance-${id}`, message, turn: index + 1 })),
  };
}

function preflightFor(context, onCall = () => {}) {
  return async request => {
    await onCall(request);
    return {
      generationId: context.generationId,
      runtimeDigest: context.runtimeDigest,
      consentDigest: digest('consent'),
      budgetDigest: digest(`budget-${request.caseId}`),
      authorizedAttempts: request.attemptsRequired,
      checkedAt: Date.now(),
      route: 'smallCorpus',
    };
  };
}

function passingChecks({ caseDefinition }) {
  return caseDefinition.mechanicalCheckIds.map(id => ({ id, pass: true }));
}

function passingReview({ definition, executionDigest }) {
  return {
    executionDigest,
    reviewerId: definition.reviewerId,
    rubricDigest: definition.rubricDigest,
    reviewedAt: Date.now(),
    checks: definition.rubricCheckIds.map(id => ({ id, pass: true })),
  };
}

function requireExports() {
  assert.equal(typeof module.runCourseWikiAcceptance, 'function', 'acceptance runner is available');
  assert.equal(typeof module.createNativeOpenClawTransport, 'function', 'native transport is available');
}

function lifecycleFixture(context, { id = 'duplicate-import', turns = [], maxPaidRequests = 0,
  changed = false } = {}) {
  const before = { generationId: context.generationId, runtimeDigest: context.runtimeDigest,
    sourceSetDigest: digest('source-set-before'), corpusDigest: digest('corpus-before') };
  return { id, kind: 'document-lifecycle', turns,
    lifecycle: { operationId: `operation-${id}`, inputDigest: digest('private lifecycle inputs'),
      before, after: changed ? { generationId: 'generation-2', runtimeDigest: digest('runtime-2'),
        sourceSetDigest: digest('source-set-after'), corpusDigest: digest('corpus-after') } : { ...before },
      maxPaidRequests } };
}

function lifecyclePreflight(context, onCall = () => {}) {
  return async request => ({ ...await preflightFor(context, onCall)(request),
    lifecyclePlanDigest: request.lifecyclePlanDigest,
    authorizedPaidRequests: request.paidRequestsRequired });
}

function lifecycleReceipt({ fixture, preflight, startedAt }, overrides = {}) {
  return { operationId: fixture.lifecycle.operationId, planDigest: preflight.lifecyclePlanDigest,
    inputDigest: fixture.lifecycle.inputDigest, before: { ...fixture.lifecycle.before },
    after: { ...fixture.lifecycle.after }, budgetBeforeDigest: preflight.budgetDigest,
    budgetAfterDigest: digest('budget-after'), paidRequestCount: 0,
    startedAt, completedAt: Date.now(), ...overrides };
}

test('lifecycle executes a zero-native case only after reserved output and preflight with reviewed receipt', async t => {
  const root = await temp(t);
  const context = runtime(root);
  const input = lifecycleFixture(context);
  const outputPath = path.join(root, 'lifecycle.json');
  const calls = [];
  const result = await module.runCourseWikiAcceptance({ caseCatalog: catalog,
    selectedCaseIds: [input.id], inputFixtures: [input], outputPath, runtimeContext: context,
    operatorPreflight: lifecyclePreflight(context, async request => {
      await access(outputPath);
      assert.equal(request.attemptsRequired, 0);
      assert.equal(request.paidRequestsRequired, 0);
      calls.push('preflight');
    }),
    async executeLifecycle(request) {
      calls.push('lifecycle');
      await access(outputPath);
      return lifecycleReceipt(request);
    },
    inspectExecution(request) {
      calls.push('inspection');
      assert.deepEqual(request.outputs, []);
      assert.equal(request.lifecycleReceipt.operationId, 'operation-duplicate-import');
      return passingChecks(request);
    },
    reviewCase(request) {
      calls.push('review');
      assert.equal(request.lifecycleReceipt.after.corpusDigest, digest('corpus-before'));
      return passingReview(request);
    },
    nativeTransport: { async runCase() { throw new Error('zero-native case must not spawn'); } },
  });
  const record = result.records.find(value => value.id === input.id);
  assert.deepEqual(calls, ['preflight', 'lifecycle', 'inspection', 'review']);
  assert.equal(record.result.passed, true);
  assert.equal(record.evidence.actualAttemptCount, 0);
  assert.equal(record.evidence.lifecycle.paidRequestCount, 0);
  assert.equal(record.evidence.lifecycle.receipt.before.sourceSetDigest, digest('source-set-before'));
  assert.notEqual(record.execution.outputDigest, digest('[]'));
  assert.equal(JSON.stringify(record).includes(root), false);
  assert.equal(JSON.stringify(record).includes('private lifecycle inputs'), false);
});

test('lifecycle without explicit executor remains unsupported before preflight', async t => {
  const root = await temp(t);
  const context = runtime(root);
  const input = lifecycleFixture(context);
  let called = false;
  const result = await module.runCourseWikiAcceptance({ caseCatalog: catalog,
    selectedCaseIds: [input.id], inputFixtures: [input], outputPath: path.join(root, 'unsupported.json'),
    runtimeContext: context, operatorPreflight() { called = true; },
    inspectExecution: passingChecks, reviewCase: passingReview });
  assert.equal(called, false);
  assert.equal(result.failure.code, 'unsupported-lifecycle');
});

test('lifecycle advances only identity fields for native turns and later fresh preflight', async t => {
  const root = await temp(t);
  const context = runtime(root);
  const input = lifecycleFixture(context, { id: 'import-md', changed: true, maxPaidRequests: 2,
    turns: fixture('import-md').turns });
  const seen = [];
  const result = await module.runCourseWikiAcceptance({ caseCatalog: catalog,
    selectedCaseIds: [input.id, 'greeting'], inputFixtures: [input, fixture('greeting')],
    outputPath: path.join(root, 'transition.json'), runtimeContext: context,
    operatorPreflight(request) {
      seen.push(request.generationId);
      const current = { ...context, generationId: request.generationId, runtimeDigest: request.runtimeDigest };
      return request.caseId === input.id ? lifecyclePreflight(current)(request) : preflightFor(current)(request);
    },
    executeLifecycle(request) {
      request.onProgress({ paidRequestCount: 1 });
      return lifecycleReceipt(request, { paidRequestCount: 1 });
    },
    inspectExecution: passingChecks, reviewCase: passingReview,
    nativeTransport: { async runCase({ fixture: nativeFixture, runtimeContext }) {
      assert.equal(nativeFixture.kind, 'native-agent-turns');
      assert.deepEqual(runtimeContext, { ...context, generationId: 'generation-2', runtimeDigest: digest('runtime-2') });
      return { outputs: ['RAW LIFECYCLE ANSWER'], trace: { actualAttemptCount: 1,
        receivedAnswerCount: 1, sessionDigests: [sessionDigest(nativeFixture.turns[0].sessionId)] } };
    } },
  });
  assert.deepEqual(seen, ['generation-1', 'generation-2']);
  assert.equal(result.generationId, 'generation-1');
  for (const id of [input.id, 'greeting']) {
    const record = result.records.find(value => value.id === id);
    assert.equal(record.result.passed, true);
    assert.equal(record.definition.generationId, 'generation-2');
    assert.equal(record.execution.generationId, 'generation-2');
    assert.equal(record.evidence.actualAttemptCount, 1);
  }
  assert.equal(result.records.find(value => value.id === input.id).evidence.lifecycle.paidRequestCount, 1);
  assert.equal(JSON.stringify(result).includes('RAW LIFECYCLE ANSWER'), false);
});

test('lifecycle rejects absent malformed stale wrong-identity and over-budget receipts without native work', async t => {
  const invalid = [
    () => undefined,
    request => ({ ...lifecycleReceipt(request), rawDocument: 'RAW DOCUMENT CANARY' }),
    request => lifecycleReceipt(request, { planDigest: digest('wrong-plan') }),
    request => lifecycleReceipt(request, { inputDigest: digest('wrong-input') }),
    request => lifecycleReceipt(request, { after: { ...request.fixture.lifecycle.after, generationId: 'wrong-generation' } }),
    request => lifecycleReceipt(request, { before: { ...request.fixture.lifecycle.before, sourceSetDigest: digest('wrong-source') } }),
    request => lifecycleReceipt(request, { budgetBeforeDigest: digest('wrong-budget') }),
    request => lifecycleReceipt(request, { paidRequestCount: 2 }),
    request => lifecycleReceipt(request, { startedAt: request.startedAt - 1 }),
    request => lifecycleReceipt(request, { completedAt: Date.now() + 60_000 }),
  ];
  for (const [index, executeLifecycle] of invalid.entries()) {
    await t.test(`receipt variant ${index + 1}`, async t => {
      const root = await temp(t);
      const context = runtime(root);
      const input = lifecycleFixture(context, { id: 'import-md', maxPaidRequests: 1,
        turns: fixture('import-md').turns });
      let nativeCalls = 0;
      const result = await module.runCourseWikiAcceptance({ caseCatalog: catalog,
        selectedCaseIds: [input.id, 'greeting'], inputFixtures: [input, fixture('greeting')],
        outputPath: path.join(root, 'invalid-receipt.json'), runtimeContext: context,
        operatorPreflight: lifecyclePreflight(context), executeLifecycle,
        inspectExecution: passingChecks, reviewCase: passingReview,
        nativeTransport: { async runCase() { nativeCalls += 1; } } });
      const record = result.records.find(value => value.id === input.id);
      assert.equal(result.failure.code, 'lifecycle-execution-rejected');
      assert.equal(record.execution, null);
      assert.equal(record.evidence.actualAttemptCount, 0);
      assert.equal(record.evidence.lifecycle.receipt, null);
      assert.equal(record.result.passed, false);
      assert.equal(nativeCalls, 0);
      assert.equal(result.records.find(value => value.id === 'greeting').status, 'stopped-after-failure');
      assert.equal(JSON.stringify(result).includes('RAW DOCUMENT CANARY'), false);
    });
  }
});

test('lifecycle exceptions retain valid paid progress and preflight without retry or new active identity', async t => {
  const root = await temp(t);
  const context = runtime(root);
  const input = lifecycleFixture(context, { id: 'import-md', changed: true, maxPaidRequests: 2 });
  let calls = 0;
  const result = await module.runCourseWikiAcceptance({ caseCatalog: catalog,
    selectedCaseIds: [input.id, 'greeting'], inputFixtures: [input, fixture('greeting')],
    outputPath: path.join(root, 'progress.json'), runtimeContext: context,
    operatorPreflight: lifecyclePreflight(context),
    executeLifecycle(request) {
      calls += 1;
      request.onProgress({ paidRequestCount: 1 });
      throw new Error('RAW LIFECYCLE ERROR CANARY');
    }, inspectExecution: passingChecks, reviewCase: passingReview });
  const record = result.records.find(value => value.id === input.id);
  assert.equal(calls, 1);
  assert.equal(result.failure.code, 'lifecycle-execution-rejected');
  assert.equal(record.evidence.consentDigest, digest('consent'));
  assert.equal(record.evidence.lifecycle.paidRequestCount, 1);
  assert.equal(record.evidence.lifecycle.receipt, null);
  assert.equal(record.evidence.actualAttemptCount, 0);
  assert.equal(record.execution, null);
  assert.equal(result.records.find(value => value.id === 'greeting').definition.generationId, 'generation-1');
  assert.equal(JSON.stringify(result).includes('RAW LIFECYCLE ERROR CANARY'), false);
});

test('lifecycle still requires complete mechanical checks and a bound independent review', async t => {
  for (const mode of ['missing-check', 'failed-check', 'missing-review', 'wrong-review']) {
    await t.test(mode, async t => {
      const root = await temp(t);
      const context = runtime(root);
      const input = lifecycleFixture(context);
      const result = await module.runCourseWikiAcceptance({ caseCatalog: catalog,
        selectedCaseIds: [input.id], inputFixtures: [input], outputPath: path.join(root, 'review.json'),
        runtimeContext: context, operatorPreflight: lifecyclePreflight(context), executeLifecycle: lifecycleReceipt,
        inspectExecution: request => mode === 'missing-check' ? [] : passingChecks(request)
          .map((check, index) => ({ ...check, pass: mode !== 'failed-check' || index !== 0 })),
        reviewCase: request => mode === 'missing-review' ? null : { ...passingReview(request),
          ...(mode === 'wrong-review' ? { executionDigest: digest('other-run') } : {}) } });
      const record = result.records.find(value => value.id === input.id);
      assert.equal(record.result.passed, false);
      assert.notEqual(record.evidence.lifecycle.receipt, null);
      assert.equal(result.coverage.complete, false);
    });
  }
});

test('lifecycle rejects swallowed invalid progress while retaining the last valid paid count', async t => {
  const root = await temp(t);
  const context = runtime(root);
  const input = lifecycleFixture(context, { maxPaidRequests: 1 });
  const result = await module.runCourseWikiAcceptance({ caseCatalog: catalog,
    selectedCaseIds: [input.id], inputFixtures: [input], outputPath: path.join(root, 'invalid-progress.json'),
    runtimeContext: context, operatorPreflight: lifecyclePreflight(context),
    executeLifecycle(request) {
      request.onProgress({ paidRequestCount: 1 });
      try { request.onProgress({ paidRequestCount: 2 }); } catch {}
      return lifecycleReceipt(request, { paidRequestCount: 1 });
    }, inspectExecution: passingChecks, reviewCase: passingReview });
  const record = result.records.find(value => value.id === input.id);
  assert.equal(result.failure?.code, 'lifecycle-execution-rejected');
  assert.equal(record.evidence.lifecycle.paidRequestCount, 1);
  assert.equal(record.evidence.lifecycle.receipt, null);
  assert.equal(record.result.passed, false);
});

test('lifecycle timeout aborts bounded execution and preserves progress without native work', async t => {
  const root = await temp(t);
  const context = runtime(root, { timeoutMs: 20 });
  const input = lifecycleFixture(context, { maxPaidRequests: 1 });
  let aborted = false;
  const result = await module.runCourseWikiAcceptance({ caseCatalog: catalog,
    selectedCaseIds: [input.id], inputFixtures: [input], outputPath: path.join(root, 'timeout.json'),
    runtimeContext: context, operatorPreflight: lifecyclePreflight(context),
    executeLifecycle(request) {
      request.onProgress({ paidRequestCount: 1 });
      assert.equal(request.deadlineAt, request.startedAt + context.timeoutMs);
      return new Promise(resolve => request.signal.addEventListener('abort', () => {
        aborted = true;
        resolve(lifecycleReceipt(request, { paidRequestCount: 1 }));
      }, { once: true }));
    }, inspectExecution: passingChecks, reviewCase: passingReview });
  const record = result.records.find(value => value.id === input.id);
  assert.equal(aborted, true);
  assert.equal(result.failure?.code, 'lifecycle-execution-rejected');
  assert.equal(record.evidence.lifecycle.paidRequestCount, 1);
  assert.equal(record.evidence.lifecycle.receipt, null);
  assert.equal(record.result.passed, false);
});

test('lifecycle rejects accessor receipts before they can change sanitized fields during persistence', async t => {
  const root = await temp(t);
  const context = runtime(root);
  const input = lifecycleFixture(context);
  const result = await module.runCourseWikiAcceptance({ caseCatalog: catalog,
    selectedCaseIds: [input.id], inputFixtures: [input], outputPath: path.join(root, 'accessor.json'),
    runtimeContext: context, operatorPreflight: lifecyclePreflight(context),
    executeLifecycle(request) {
      const receipt = lifecycleReceipt(request);
      let reads = 0;
      Object.defineProperty(receipt, 'budgetAfterDigest', { enumerable: true,
        get: () => reads++ === 0 ? digest('budget-after') : '/RAW PRIVATE PATH CANARY' });
      return receipt;
    }, inspectExecution: passingChecks, reviewCase: passingReview });
  assert.equal(result.failure?.code, 'lifecycle-execution-rejected');
  assert.equal(JSON.stringify(result).includes('RAW PRIVATE PATH CANARY'), false);
});

function hiddenFieldSubstitution(value, key) {
  Object.defineProperty(value, key, { ...Object.getOwnPropertyDescriptor(value, key), enumerable: false });
  value.rawDocument = 'RAW HIDDEN FIELD CANARY';
  return value;
}

test('lifecycle rejects hidden required receipt fields instead of persisting substituted raw data', async t => {
  const root = await temp(t);
  const context = runtime(root);
  const input = lifecycleFixture(context);
  const outputPath = path.join(root, 'hidden-receipt.json');
  const result = await module.runCourseWikiAcceptance({ caseCatalog: catalog,
    selectedCaseIds: [input.id], inputFixtures: [input], outputPath, runtimeContext: context,
    operatorPreflight: lifecyclePreflight(context),
    executeLifecycle: request => hiddenFieldSubstitution(lifecycleReceipt(request), 'inputDigest'),
    inspectExecution: passingChecks, reviewCase: passingReview });
  assert.equal((await readFile(outputPath, 'utf8')).includes('RAW HIDDEN FIELD CANARY'), false);
  assert.equal(result.failure?.code, 'lifecycle-execution-rejected');
  assert.equal(result.records.find(value => value.id === input.id).evidence.lifecycle.receipt, null);
});

test('lifecycle rejects hidden required preflight fields before calling the executor', async t => {
  const root = await temp(t);
  const context = runtime(root);
  const input = lifecycleFixture(context);
  const outputPath = path.join(root, 'hidden-preflight.json');
  let executed = false;
  const result = await module.runCourseWikiAcceptance({ caseCatalog: catalog,
    selectedCaseIds: [input.id], inputFixtures: [input], outputPath, runtimeContext: context,
    operatorPreflight: async request => hiddenFieldSubstitution(await lifecyclePreflight(context)(request), 'consentDigest'),
    executeLifecycle(request) { executed = true; return lifecycleReceipt(request); },
    inspectExecution: passingChecks, reviewCase: passingReview });
  assert.equal(executed, false);
  assert.equal(result.failure?.code, 'operator-preflight-rejected');
  assert.equal((await readFile(outputPath, 'utf8')).includes('RAW HIDDEN FIELD CANARY'), false);
});

test('lifecycle rejects hidden required fixture fields before reserving output or executing work', async t => {
  const root = await temp(t);
  const context = runtime(root);
  const input = hiddenFieldSubstitution(lifecycleFixture(context), 'id');
  const outputPath = path.join(root, 'hidden-fixture.json');
  let called = false;
  await assert.rejects(module.runCourseWikiAcceptance({ caseCatalog: catalog,
    selectedCaseIds: ['duplicate-import'], inputFixtures: [input], outputPath, runtimeContext: context,
    operatorPreflight() { called = true; }, executeLifecycle() { called = true; },
    inspectExecution: passingChecks, reviewCase: passingReview }), { code: 'COURSE_WIKI_ACCEPTANCE_INVALID' });
  assert.equal(called, false);
  await assert.rejects(access(outputPath), { code: 'ENOENT' });
});

test('lifecycle rejects unexpected hidden and symbol fields without executing native work', async t => {
  for (const property of ['hidden', 'symbol']) await t.test(property, async t => {
    const root = await temp(t);
    const context = runtime(root);
    const input = lifecycleFixture(context, { turns: fixture('duplicate-import').turns });
    let nativeCalls = 0;
    const result = await module.runCourseWikiAcceptance({ caseCatalog: catalog,
      selectedCaseIds: [input.id], inputFixtures: [input], outputPath: path.join(root, 'extra-field.json'),
      runtimeContext: context, operatorPreflight: lifecyclePreflight(context),
      executeLifecycle(request) {
        const receipt = lifecycleReceipt(request);
        Object.defineProperty(receipt, property === 'symbol' ? Symbol('extra') : 'rawDocument',
          { value: 'RAW EXTRA FIELD CANARY', enumerable: false });
        return receipt;
      }, inspectExecution: passingChecks, reviewCase: passingReview,
      nativeTransport: { async runCase({ fixture }) {
        nativeCalls += 1;
        return { outputs: ['native answer'], trace: { actualAttemptCount: 1, receivedAnswerCount: 1,
          sessionDigests: [sessionDigest(fixture.turns[0].sessionId)] } };
      } } });
    assert.equal(result.failure?.code, 'lifecycle-execution-rejected');
    assert.equal(nativeCalls, 0);
    assert.equal(JSON.stringify(result).includes('RAW EXTRA FIELD CANARY'), false);
  });
});

test('lifecycle failed settlement aborts cooperative work and closes accounting before cancellation', async t => {
  for (const mode of ['throw', 'reject', 'invalid-receipt', 'invalid-progress']) await t.test(mode, async t => {
    const root = await temp(t);
    const context = runtime(root);
    const input = lifecycleFixture(context, { maxPaidRequests: 2 });
    let observedAbort = false;
    let childAction = false;
    let childSettled;
    const result = await module.runCourseWikiAcceptance({ caseCatalog: catalog,
      selectedCaseIds: [input.id], inputFixtures: [input], outputPath: path.join(root, 'cancelled.json'),
      runtimeContext: context, operatorPreflight: lifecyclePreflight(context),
      executeLifecycle(request) {
        request.onProgress({ paidRequestCount: 1 });
        childSettled = new Promise(resolve => {
          const timer = setTimeout(() => { childAction = true; resolve(); }, 20);
          request.signal.addEventListener('abort', () => {
            observedAbort = true;
            clearTimeout(timer);
            request.onProgress({ paidRequestCount: 2 });
            resolve();
          }, { once: true });
        });
        if (mode === 'throw') throw new Error('RAW FAILED CHILD CANARY');
        if (mode === 'reject') return Promise.reject(new Error('RAW FAILED CHILD CANARY'));
        if (mode === 'invalid-receipt') return lifecycleReceipt(request, { planDigest: digest('wrong-plan') });
        try { request.onProgress({ paidRequestCount: 3 }); } catch {}
        return childSettled.then(() => lifecycleReceipt(request, { paidRequestCount: 1 }));
      }, inspectExecution: passingChecks, reviewCase: passingReview });
    await childSettled;
    assert.equal(observedAbort, true);
    assert.equal(childAction, false);
    assert.equal(result.failure?.code, 'lifecycle-execution-rejected');
    const record = result.records.find(value => value.id === input.id);
    assert.equal(record.evidence.lifecycle.paidRequestCount, 1);
    assert.equal(record.evidence.lifecycle.receipt, null);
    assert.equal(record.evidence.actualAttemptCount, 0);
    assert.equal(record.result.passed, false);
    const stored = JSON.parse(await readFile(path.join(root, 'cancelled.json'), 'utf8'));
    assert.equal(stored.status, 'incomplete');
    assert.equal(stored.records.find(value => value.id === input.id).result.passed, false);
    assert.equal(JSON.stringify(result).includes('RAW FAILED CHILD CANARY'), false);
  });
});

test('runs a selected native case once and publishes only bound sanitized reviewed evidence', async t => {
  requireExports();
  const root = await temp(t);
  const outputPath = path.join(root, 'acceptance.json');
  const rawPrompt = 'RAW INPUT CANARY 7901';
  const rawAnswer = 'RAW ANSWER CANARY 7902';
  const calls = [];
  const nativeTransport = { async runCase(request) {
    calls.push(request.fixture.id);
    assert.equal(request.fixture.turns[0].message, rawPrompt);
    return { outputs: [rawAnswer], trace: { actualAttemptCount: 1, receivedAnswerCount: 1,
      sessionDigests: [sessionDigest('acceptance-greeting')] } };
  } };
  let reviewerSawRaw = false;
  const result = await module.runCourseWikiAcceptance({
    caseCatalog: catalog,
    selectedCaseIds: ['greeting'],
    inputFixtures: [fixture('greeting', [rawPrompt])],
    outputPath,
    runtimeContext: runtime(root),
    operatorPreflight: preflightFor(runtime(root), async () => access(outputPath)),
    inspectExecution: passingChecks,
    reviewCase(request) {
      reviewerSawRaw = request.outputs[0] === rawAnswer;
      return passingReview(request);
    },
    nativeTransport,
  });
  assert.deepEqual(calls, ['greeting']);
  assert.equal(reviewerSawRaw, true);
  assert.equal(result.records[0].result.passed, true);
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.total, 18);
  assert.equal(result.coverage.selected, 1);
  assert.equal(result.coverage.executed, 1);
  assert.equal(result.coverage.reviewed, 1);
  assert.equal(result.records.filter(record => record.status === 'not-selected').length, 17);
  const stored = await readFile(outputPath, 'utf8');
  assert.equal(stored.includes(rawPrompt), false);
  assert.equal(stored.includes(rawAnswer), false);
  const parsed = JSON.parse(stored);
  assert.equal(parsed.records[0].definition.inputDigest, result.records[0].definition.inputDigest);
  assert.equal(parsed.records[0].execution.outputDigest.startsWith('sha256:'), true);
  assert.equal(parsed.records[0].review.executionDigest, parsed.records[0].evidence.executionDigest);
});

test('leaves unselected and unsupported lifecycle cases pending without a paid preflight or transport call', async t => {
  requireExports();
  const root = await temp(t);
  let preflights = 0;
  let calls = 0;
  const context = runtime(root);
  const result = await module.runCourseWikiAcceptance({
    caseCatalog: catalog,
    selectedCaseIds: ['import-docx'],
    inputFixtures: [{ id: 'import-docx', kind: 'document-lifecycle', turns: [] }],
    outputPath: path.join(root, 'acceptance.json'),
    runtimeContext: context,
    operatorPreflight: preflightFor(context, () => { preflights += 1; }),
    inspectExecution: passingChecks,
    reviewCase: passingReview,
    nativeTransport: { async runCase() { calls += 1; throw new Error('must not run'); } },
  });
  assert.equal(preflights, 0);
  assert.equal(calls, 0);
  assert.equal(result.coverage.complete, false);
  const selected = result.records.find(record => record.id === 'import-docx');
  assert.equal(selected.status, 'unsupported-lifecycle');
  assert.equal(selected.result.passed, false);
  assert.deepEqual(selected.result.hardFailureIds, ['missing-execution']);
});

test('stops a paid batch after the first failed case without retries and preserves failed evidence', async t => {
  requireExports();
  const root = await temp(t);
  const context = runtime(root);
  const calls = [];
  let reviews = 0;
  const result = await module.runCourseWikiAcceptance({
    caseCatalog: catalog,
    selectedCaseIds: ['greeting', 'capabilities'],
    inputFixtures: [fixture('greeting'), fixture('capabilities')],
    outputPath: path.join(root, 'acceptance.json'),
    runtimeContext: context,
    operatorPreflight: preflightFor(context),
    inspectExecution({ caseDefinition }) {
      return caseDefinition.mechanicalCheckIds.map((id, index) => ({ id, pass: index !== 0 }));
    },
    reviewCase() { reviews += 1; throw new Error('must not review a mechanical failure'); },
    nativeTransport: { async runCase({ fixture: value }) {
      calls.push(value.id);
      return { outputs: ['transient'], trace: { actualAttemptCount: value.turns.length,
        receivedAnswerCount: value.turns.length,
        sessionDigests: value.turns.map(turn => sessionDigest(turn.sessionId)) } };
    } },
  });
  assert.deepEqual(calls, ['greeting']);
  assert.equal(reviews, 0);
  assert.equal(result.failure.code, 'mechanical-check-failed');
  assert.equal(result.records[0].result.passed, false);
  assert.equal(result.records[1].status, 'stopped-after-failure');
  const stored = JSON.parse(await readFile(path.join(root, 'acceptance.json'), 'utf8'));
  assert.equal(stored.records[0].execution.checks.some(check => !check.pass), true);
});

test('missing or uncertain independent review fails closed and stops the batch', async t => {
  requireExports();
  const root = await temp(t);
  const context = runtime(root);
  let calls = 0;
  const result = await module.runCourseWikiAcceptance({
    caseCatalog: catalog,
    selectedCaseIds: ['greeting', 'capabilities'],
    inputFixtures: [fixture('greeting'), fixture('capabilities')],
    outputPath: path.join(root, 'acceptance.json'),
    runtimeContext: context,
    operatorPreflight: preflightFor(context),
    inspectExecution: passingChecks,
    reviewCase: async () => null,
    nativeTransport: { async runCase({ fixture: value }) {
      calls += 1;
      return { outputs: ['transient'], trace: { actualAttemptCount: 1, receivedAnswerCount: 1,
        sessionDigests: [sessionDigest(value.turns[0].sessionId)] } };
    } },
  });
  assert.equal(calls, 1);
  assert.equal(result.failure.code, 'missing-independent-review');
  assert.equal(result.records[0].result.hardFailureIds.includes('missing-review'), true);
  assert.equal(result.records[1].status, 'stopped-after-failure');
  const stored = JSON.parse(await readFile(path.join(root, 'acceptance.json'), 'utf8'));
  assert.equal(stored.status, 'incomplete');
  assert.equal(stored.records[0].result.passed, false);
});

test('expired review persists a non-passing incomplete artifact without stale execution', async t => {
  const root = await temp(t);
  const context = runtime(root);
  const outputPath = path.join(root, 'expired-review.json');
  let clock = Date.now();
  let nativeCalls = 0;
  const artifact = await module.runCourseWikiAcceptance({
    caseCatalog: catalog,
    selectedCaseIds: ['greeting', 'capabilities'],
    inputFixtures: [fixture('greeting'), fixture('capabilities')],
    outputPath,
    runtimeContext: context,
    now: () => clock,
    operatorPreflight: preflightFor(context),
    inspectExecution: passingChecks,
    reviewCase(request) {
      clock += 300_001;
      return { ...passingReview(request), reviewedAt: clock };
    },
    nativeTransport: { async runCase({ fixture: value }) {
      nativeCalls += 1;
      return { outputs: ['RAW EXPIRED ANSWER CANARY'], trace: { actualAttemptCount: 1,
        receivedAnswerCount: 1, sessionDigests: [sessionDigest(value.turns[0].sessionId)] } };
    } },
  });
  const stored = await readFile(outputPath, 'utf8');
  assert.ok(stored.length > 0);
  assert.deepEqual(JSON.parse(stored), artifact);
  assert.equal(artifact.status, 'incomplete');
  assert.equal(artifact.failure.code, 'evidence-expired');
  assert.equal(nativeCalls, 1);
  const record = artifact.records.find(value => value.id === 'greeting');
  assert.equal(record.status, 'evidence-expired');
  assert.equal(record.execution, null);
  assert.equal(record.review, null);
  assert.equal(record.result.passed, false);
  assert.deepEqual(record.result.hardFailureIds, ['missing-execution']);
  assert.equal(record.evidence.actualAttemptCount, 1);
  assert.equal(record.evidence.receivedAnswerCount, 1);
  assert.deepEqual(record.evidence.sessionDigests, [sessionDigest('acceptance-greeting')]);
  assert.deepEqual(record.evidence.currentMessageDigests, [sessionDigest('exact prompt for greeting')]);
  assert.match(record.evidence.evidenceDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.match(record.evidence.executionDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(artifact.records.find(value => value.id === 'capabilities').status, 'stopped-after-failure');
  assert.equal(stored.includes('RAW EXPIRED ANSWER CANARY'), false);
});

test('expired mechanical checks persist a safe failure without review', async t => {
  const root = await temp(t);
  const context = runtime(root);
  const outputPath = path.join(root, 'expired-checks.json');
  let clock = Date.now();
  let reviews = 0;
  const artifact = await module.runCourseWikiAcceptance({
    caseCatalog: catalog, selectedCaseIds: ['greeting'], inputFixtures: [fixture('greeting')],
    outputPath, runtimeContext: context, now: () => clock,
    operatorPreflight: preflightFor(context),
    inspectExecution(request) {
      clock += 300_001;
      return passingChecks(request).map((check, index) => ({ ...check, pass: index !== 0 }));
    },
    reviewCase() { reviews += 1; return null; },
    nativeTransport: { async runCase({ fixture: value }) {
      return { outputs: ['RAW EXPIRED CHECK ANSWER CANARY'], trace: { actualAttemptCount: 1,
        receivedAnswerCount: 1, sessionDigests: [sessionDigest(value.turns[0].sessionId)] } };
    } },
  });
  const stored = await readFile(outputPath, 'utf8');
  assert.deepEqual(JSON.parse(stored), artifact);
  assert.equal(artifact.status, 'incomplete');
  assert.equal(artifact.failure.code, 'evidence-expired');
  assert.equal(reviews, 0);
  assert.equal(artifact.records[0].status, 'evidence-expired');
  assert.equal(artifact.records[0].execution, null);
  assert.equal(artifact.records[0].review, null);
  assert.equal(artifact.records[0].result.passed, false);
  assert.equal(artifact.records[0].evidence.actualAttemptCount, 1);
  assert.equal(stored.includes('RAW EXPIRED CHECK ANSWER CANARY'), false);
});

test('fresh false review persists as a reviewed non-passing result', async t => {
  const root = await temp(t);
  const context = runtime(root);
  const outputPath = path.join(root, 'false-review.json');
  const artifact = await module.runCourseWikiAcceptance({
    caseCatalog: catalog, selectedCaseIds: ['greeting'], inputFixtures: [fixture('greeting')],
    outputPath, runtimeContext: context, operatorPreflight: preflightFor(context),
    inspectExecution: passingChecks,
    reviewCase(request) {
      return { ...passingReview(request), checks: request.definition.rubricCheckIds
        .map((id, index) => ({ id, pass: index !== 0 })) };
    },
    nativeTransport: { async runCase({ fixture: value }) {
      return { outputs: ['RAW FALSE REVIEW ANSWER CANARY'], trace: { actualAttemptCount: 1,
        receivedAnswerCount: 1, sessionDigests: [sessionDigest(value.turns[0].sessionId)] } };
    } },
  });
  const stored = await readFile(outputPath, 'utf8');
  assert.deepEqual(JSON.parse(stored), artifact);
  assert.equal(artifact.status, 'incomplete');
  assert.equal(artifact.failure.code, 'independent-review-failed');
  assert.equal(artifact.records[0].status, 'failed');
  assert.equal(artifact.records[0].review.checks[0].pass, false);
  assert.equal(artifact.records[0].result.passed, false);
  assert.equal(stored.includes('RAW FALSE REVIEW ANSWER CANARY'), false);
});

test('claims the absent output before preflight and refuses occupied output or mismatched runtime authorization', async t => {
  requireExports();
  const root = await temp(t);
  const context = runtime(root);
  const occupied = path.join(root, 'occupied.json');
  await writeFile(occupied, 'foreign\n');
  let preflights = 0;
  await assert.rejects(module.runCourseWikiAcceptance({
    caseCatalog: catalog, selectedCaseIds: [], inputFixtures: [], outputPath: occupied,
    runtimeContext: context, operatorPreflight: preflightFor(context, () => { preflights += 1; }),
    inspectExecution: passingChecks, reviewCase: passingReview,
  }), { code: 'COURSE_WIKI_ACCEPTANCE_OUTPUT_OCCUPIED' });
  assert.equal(preflights, 0);

  let transports = 0;
  const result = await module.runCourseWikiAcceptance({
    caseCatalog: catalog, selectedCaseIds: ['greeting'], inputFixtures: [fixture('greeting')],
    outputPath: path.join(root, 'mismatch.json'), runtimeContext: context,
    operatorPreflight: async () => ({
      generationId: 'wrong-generation', runtimeDigest: context.runtimeDigest,
      consentDigest: digest('consent'), budgetDigest: digest('budget'), authorizedAttempts: 1,
      checkedAt: Date.now(),
    }),
    inspectExecution: passingChecks, reviewCase: passingReview,
    nativeTransport: { async runCase() { transports += 1; } },
  });
  assert.equal(transports, 0);
  assert.equal(result.failure.code, 'operator-preflight-rejected');
  assert.equal(result.records[0].status, 'preflight-rejected');
});

test('preserves preflight and zero-answer attempt evidence when the first native turn times out', async t => {
  requireExports();
  const root = await temp(t);
  const context = runtime(root, { timeoutMs: 5, settlementMs: 40 });
  const outputPath = path.join(root, 'first-turn-timeout.json');
  let child;
  let spawns = 0;
  const nativeTransport = module.createNativeOpenClawTransport({
    spawnProcess() {
      spawns += 1;
      child = new EventEmitter();
      child.pid = 7171;
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdout.write('RAW FIRST FAILURE CANARY');
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
    killProcess() { queueMicrotask(() => child.emit('close', null, 'SIGKILL')); },
  });
  const result = await module.runCourseWikiAcceptance({
    caseCatalog: catalog,
    selectedCaseIds: ['greeting'],
    inputFixtures: [fixture('greeting')],
    outputPath,
    runtimeContext: context,
    operatorPreflight: preflightFor(context),
    inspectExecution: passingChecks,
    reviewCase: passingReview,
    nativeTransport,
  });
  const record = result.records.find(value => value.id === 'greeting');
  assert.equal(spawns, 1);
  assert.notEqual(record.evidence, null);
  assert.equal(record.evidence.consentDigest, digest('consent'));
  assert.equal(record.evidence.budgetDigest, digest('budget-greeting'));
  assert.equal(record.evidence.authorizedAttempts, 1);
  assert.equal(record.evidence.actualAttemptCount, 1);
  assert.equal(record.evidence.receivedAnswerCount, 0);
  assert.deepEqual(record.evidence.sessionDigests, [sessionDigest('acceptance-greeting')]);
  assert.equal(record.execution, null);
  assert.equal(record.result.passed, false);
  const stored = await readFile(outputPath, 'utf8');
  assert.equal(stored.includes('RAW FIRST FAILURE CANARY'), false);
});

test('does not record an attempt when native spawn fails asynchronously before process start', async t => {
  requireExports();
  const root = await temp(t);
  const context = runtime(root);
  const outputPath = path.join(root, 'async-spawn-failure.json');
  let spawns = 0;
  const nativeTransport = module.createNativeOpenClawTransport({
    spawnProcess() {
      spawns += 1;
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      queueMicrotask(() => child.emit('error', new Error('RAW SPAWN FAILURE CANARY')));
      return child;
    },
  });
  const result = await module.runCourseWikiAcceptance({
    caseCatalog: catalog,
    selectedCaseIds: ['greeting'],
    inputFixtures: [fixture('greeting')],
    outputPath,
    runtimeContext: context,
    operatorPreflight: preflightFor(context),
    inspectExecution: passingChecks,
    reviewCase: passingReview,
    nativeTransport,
  });
  const record = result.records.find(value => value.id === 'greeting');
  assert.equal(spawns, 1);
  assert.equal(result.failure.code, 'native-spawn-failed');
  assert.equal(record.evidence.authorizedAttempts, 1);
  assert.equal(record.evidence.actualAttemptCount, 0);
  assert.equal(record.evidence.receivedAnswerCount, 0);
  assert.deepEqual(record.evidence.sessionDigests, []);
  assert.equal(record.execution, null);
  const stored = await readFile(outputPath, 'utf8');
  assert.equal(stored.includes('RAW SPAWN FAILURE CANARY'), false);
});

test('preserves one received answer and both attempted sessions when a later native turn exits', async t => {
  requireExports();
  const root = await temp(t);
  const context = runtime(root);
  const outputPath = path.join(root, 'later-turn-exit.json');
  let spawns = 0;
  const children = [];
  const nativeTransport = module.createNativeOpenClawTransport({
    spawnProcess() {
      spawns += 1;
      const child = new EventEmitter();
      child.pid = 7200 + spawns;
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      children.push(child);
      queueMicrotask(() => {
        child.emit('spawn');
        if (spawns === 1) {
          child.stdout.end(JSON.stringify({ payloads: [{ text: 'RAW FIRST ANSWER CANARY', mediaUrl: null }],
            meta: { agentMeta: { agentId: 'course-wiki' }, stopReason: 'stop', aborted: false } }));
          child.stderr.end();
          child.emit('close', 0, null);
        } else {
          child.stdout.end('RAW SECOND FAILURE CANARY');
          child.stderr.end();
          child.emit('close', 7, null);
        }
      });
      return child;
    },
  });
  const followup = {
    id: 'followup', kind: 'native-agent-turns', turns: [
      { sessionId: 'acceptance-followup', message: 'exact first prompt', turn: 1 },
      { sessionId: 'acceptance-followup', message: 'exact second prompt', turn: 2 },
    ],
  };
  const result = await module.runCourseWikiAcceptance({
    caseCatalog: catalog,
    selectedCaseIds: ['followup', 'capabilities'],
    inputFixtures: [followup, fixture('capabilities')],
    outputPath,
    runtimeContext: context,
    operatorPreflight: preflightFor(context),
    inspectExecution: passingChecks,
    reviewCase: passingReview,
    nativeTransport,
  });
  const record = result.records.find(value => value.id === 'followup');
  assert.equal(spawns, 2);
  assert.notEqual(record.evidence, null);
  assert.equal(record.evidence.authorizedAttempts, 2);
  assert.equal(record.evidence.actualAttemptCount, 2);
  assert.equal(record.evidence.receivedAnswerCount, 1);
  assert.deepEqual(record.evidence.sessionDigests,
    [sessionDigest('acceptance-followup'), sessionDigest('acceptance-followup')]);
  assert.equal(result.records.find(value => value.id === 'capabilities').status, 'stopped-after-failure');
  const stored = await readFile(outputPath, 'utf8');
  assert.equal(stored.includes('RAW FIRST ANSWER CANARY'), false);
  assert.equal(stored.includes('RAW SECOND FAILURE CANARY'), false);
});

test('preserves completed attempt evidence when post-run mechanical inspection is rejected', async t => {
  requireExports();
  const root = await temp(t);
  const context = runtime(root);
  const outputPath = path.join(root, 'inspection-rejected.json');
  let calls = 0;
  const result = await module.runCourseWikiAcceptance({
    caseCatalog: catalog,
    selectedCaseIds: ['greeting', 'capabilities'],
    inputFixtures: [fixture('greeting'), fixture('capabilities')],
    outputPath,
    runtimeContext: context,
    operatorPreflight: preflightFor(context),
    inspectExecution() { throw new Error('RAW INSPECTION CANARY'); },
    reviewCase: passingReview,
    nativeTransport: { async runCase() {
      calls += 1;
      return { outputs: ['RAW INSPECTION ANSWER CANARY'], trace: {
        actualAttemptCount: 1,
        receivedAnswerCount: 1,
        sessionDigests: [sessionDigest('acceptance-greeting')],
      } };
    } },
  });
  const record = result.records.find(value => value.id === 'greeting');
  assert.equal(calls, 1);
  assert.equal(record.status, 'execution-inspection-rejected');
  assert.equal(record.evidence.authorizedAttempts, 1);
  assert.equal(record.evidence.actualAttemptCount, 1);
  assert.equal(record.evidence.receivedAnswerCount, 1);
  assert.deepEqual(record.evidence.sessionDigests, [sessionDigest('acceptance-greeting')]);
  assert.equal(record.execution, null);
  assert.equal(result.records.find(value => value.id === 'capabilities').status, 'stopped-after-failure');
  const stored = await readFile(outputPath, 'utf8');
  assert.equal(stored.includes('RAW INSPECTION'), false);
});

test('native transport uses fixed OpenClaw identity, message files, isolated environment and bounded output', async t => {
  requireExports();
  const root = await temp(t);
  const context = runtime(root);
  let invocation;
  const spawnProcess = (executable, args, options) => {
    const child = new EventEmitter();
    child.pid = 4242;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const messageFile = args[args.indexOf('--message-file') + 1];
    invocation = { executable, args, options, prompt: readFileSync(messageFile, 'utf8') };
    queueMicrotask(() => {
      child.emit('spawn');
      child.stdout.end(JSON.stringify({
        payloads: [{ text: 'native raw answer', mediaUrl: null }],
        meta: { agentMeta: { agentId: 'course-wiki' }, stopReason: 'stop', aborted: false },
      }));
      child.stderr.end();
      child.emit('close', 0, null);
    });
    return child;
  };
  const transport = module.createNativeOpenClawTransport({ spawnProcess });
  const result = await transport.runCase({ fixture: fixture('greeting', ['private prompt']), runtimeContext: context });
  assert.equal(invocation.executable, '/Users/alexzhu/.local/bin/openclaw');
  assert.equal(invocation.args.includes('--message'), false);
  assert.equal(invocation.args.includes('--message-file'), true);
  assert.equal(invocation.args[invocation.args.indexOf('--agent') + 1], 'course-wiki');
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.detached, true);
  assert.equal(invocation.options.cwd, context.cwd);
  assert.equal(invocation.options.env.HOME, context.homeDir);
  assert.equal(invocation.options.env.OPENCLAW_STATE_DIR, context.stateDir);
  assert.equal(invocation.options.env.OPENCLAW_CONFIG_PATH, context.configPath);
  assert.equal(Object.hasOwn(invocation.options.env, 'DEEPSEEK_API_KEY'), false);
  assert.equal(invocation.prompt, 'private prompt');
  assert.deepEqual(result.outputs, ['native raw answer']);
  assert.equal(result.trace.actualAttemptCount, 1);
  assert.equal(result.trace.receivedAnswerCount, 1);
});

test('native metadata envelope accepts only one bounded successful non-error text payload', async t => {
  const cases = [
    ['pinned-success', value => value, true],
    ['missing-meta', ({ meta, ...value }) => ({ ...value, stopReason: 'stop' }), false],
    ['aborted', value => ({ ...value, meta: { ...value.meta, aborted: true } }), false],
    ['missing-aborted', value => ({ ...value, meta: { stopReason: 'stop' } }), false],
    ['metadata-error', value => ({ ...value, meta: { ...value.meta, error: { message: 'RAW META ERROR CANARY' } } }), false],
    ['payload-error', value => ({ ...value, payloads: [{ ...value.payloads[0], isError: true }] }), false],
    ['wrong-stop-reason', value => ({ ...value, meta: { ...value.meta, stopReason: 'error' } }), false],
    ['missing-stop-reason', value => ({ ...value, meta: { aborted: false } }), false],
    ['multiple-payloads', value => ({ ...value, payloads: [...value.payloads, ...value.payloads] }), false],
    ['missing-text', value => ({ ...value, payloads: [{ mediaUrl: null }] }), false],
    ['empty-text', value => ({ ...value, payloads: [{ text: '', mediaUrl: null }] }), false],
    ['blank-text', value => ({ ...value, payloads: [{ text: ' \n ', mediaUrl: null }] }), false],
  ];
  for (const [name, transform, accepted] of cases) await t.test(name, async t => {
    const root = await temp(t);
    const context = runtime(root);
    const envelope = transform({ payloads: [{ text: 'bounded native answer', mediaUrl: null }],
      meta: { stopReason: 'stop', aborted: false } });
    let starts = 0;
    const transport = module.createNativeOpenClawTransport({ spawnProcess() {
      const child = new EventEmitter();
      child.pid = 8383;
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      queueMicrotask(() => {
        child.emit('spawn');
        child.stdout.end(JSON.stringify(envelope));
        child.stderr.end();
        child.emit('close', 0, null);
      });
      return child;
    } });
    const run = transport.runCase({ fixture: fixture('greeting'), runtimeContext: context,
      onProgress(value) { starts = value.actualAttemptCount; } });
    if (accepted) {
      const result = await run;
      assert.deepEqual(result.outputs, ['bounded native answer']);
      assert.equal(result.trace.receivedAnswerCount, 1);
    } else {
      await assert.rejects(run, error => error.code === 'COURSE_WIKI_ACCEPTANCE_NATIVE_OUTPUT_INVALID'
        && !error.message.includes('RAW META ERROR CANARY'));
    }
    assert.equal(starts, 1);
  });
});

test('native timeout kills the process group, waits for settlement and returns only a sanitized error', async t => {
  requireExports();
  const root = await temp(t);
  const context = runtime(root, { timeoutMs: 5, settlementMs: 40 });
  const killed = [];
  let child;
  const spawnProcess = () => {
    child = new EventEmitter();
    child.pid = 5252;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdout.write('RAW TIMEOUT CANARY');
    queueMicrotask(() => child.emit('spawn'));
    return child;
  };
  const transport = module.createNativeOpenClawTransport({
    spawnProcess,
    killProcess(pid, signal) {
      killed.push([pid, signal]);
      queueMicrotask(() => child.emit('close', null, 'SIGKILL'));
    },
  });
  let caught;
  try { await transport.runCase({ fixture: fixture('greeting'), runtimeContext: context }); }
  catch (error) { caught = error; }
  assert.equal(caught.code, 'COURSE_WIKI_ACCEPTANCE_NATIVE_TIMEOUT');
  assert.equal(caught.message.includes('RAW TIMEOUT CANARY'), false);
  assert.deepEqual(killed, [[-5252, 'SIGKILL']]);
});

test('native output overflow kills the process group and never exposes captured bytes', async t => {
  requireExports();
  const root = await temp(t);
  const context = runtime(root, { maxStdoutBytes: 8, settlementMs: 40 });
  const killed = [];
  let child;
  const spawnProcess = () => {
    child = new EventEmitter();
    child.pid = 6262;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    queueMicrotask(() => {
      child.emit('spawn');
      child.stdout.write('RAW OUTPUT CANARY');
    });
    return child;
  };
  const transport = module.createNativeOpenClawTransport({
    spawnProcess,
    killProcess(pid, signal) {
      killed.push([pid, signal]);
      queueMicrotask(() => child.emit('close', null, 'SIGKILL'));
    },
  });
  let caught;
  try { await transport.runCase({ fixture: fixture('greeting'), runtimeContext: context }); }
  catch (error) { caught = error; }
  assert.equal(caught.code, 'COURSE_WIKI_ACCEPTANCE_NATIVE_OUTPUT_LIMIT');
  assert.equal(caught.message.includes('RAW OUTPUT CANARY'), false);
  assert.deepEqual(killed, [[-6262, 'SIGKILL']]);
});

test('native kill settlement releases retained pipes and child reference when close never arrives', async t => {
  const root = await temp(t);
  const context = runtime(root, { timeoutMs: 5, settlementMs: 5 });
  const child = new EventEmitter();
  child.pid = 7272;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let unreferenced = false;
  child.unref = () => { unreferenced = true; };
  const killed = [];
  const transport = module.createNativeOpenClawTransport({ spawnProcess() {
    queueMicrotask(() => child.emit('spawn'));
    return child;
  }, killProcess(pid, signal) { killed.push([pid, signal]); } });
  await assert.rejects(transport.runCase({ fixture: fixture('greeting'), runtimeContext: context }),
    { code: 'COURSE_WIKI_ACCEPTANCE_NATIVE_TIMEOUT' });
  assert.deepEqual(killed, [[-7272, 'SIGKILL']]);
  assert.equal(child.stdout.destroyed, true);
  assert.equal(child.stderr.destroyed, true);
  assert.equal(unreferenced, true);
});

test('default command-line launch requires the reviewed programmatic controller', () => {
  requireExports();
  assert.throws(() => module.resolveAcceptanceLaunch([]), {
    code: 'COURSE_WIKI_ACCEPTANCE_PROGRAMMATIC_ONLY',
  });
});

test('command-line execution arguments never load an operator file or create evidence', async t => {
  const root = await temp(t);
  const operatorPath = path.join(root, 'operator.mjs');
  const sentinel = path.join(root, 'operator-loaded');
  const outputPath = path.join(root, 'cli-evidence.json');
  const runner = fileURLToPath(new URL('../scripts/course-wiki-acceptance.mjs', import.meta.url));
  await writeFile(operatorPath, `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(sentinel)}, 'loaded');\n`);
  for (const args of [
    ['--operator-module', operatorPath, '--output', outputPath, '--case', 'greeting'],
    ['--help', '--operator-module', operatorPath],
    ['--operator-module', operatorPath, '--help'],
    ['--output', outputPath, '--case', 'greeting'],
    [],
  ]) {
    let failure;
    try {
      execFileSync(process.execPath, [runner, ...args], { cwd: root, env: {}, encoding: 'utf8',
        timeout: 2_000, maxBuffer: 64 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) { failure = error; }
    await assert.rejects(access(sentinel), { code: 'ENOENT' });
    await assert.rejects(access(outputPath), { code: 'ENOENT' });
    assert.equal(failure?.status, 1);
    assert.equal(failure.stdout, '');
    assert.match(failure.stderr, /COURSE_WIKI_ACCEPTANCE_PROGRAMMATIC_ONLY/u);
    assert.equal(failure.stderr.includes(operatorPath), false);
  }
});

test('command-line help is inert and points to the reviewed fixed-import controller harness', async t => {
  const root = await temp(t);
  const runner = fileURLToPath(new URL('../scripts/course-wiki-acceptance.mjs', import.meta.url));
  const help = execFileSync(process.execPath, [runner, '--help'], { cwd: root, env: {}, encoding: 'utf8',
    timeout: 2_000, maxBuffer: 64 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.match(help, /reviewed controller harness/u);
  assert.match(help, /fixed import/u);
  assert.match(help, /runCourseWikiAcceptance/u);
  assert.equal(help.includes('--operator-module'), false);
});
