#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import { open, mkdtemp, rm, writeFile, readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildBehaviorCaseResult } from '../src/behavior-evidence.js';

export const COURSE_WIKI_ACCEPTANCE_EXECUTABLE = '/Users/alexzhu/.local/bin/openclaw';
export const COURSE_WIKI_ACCEPTANCE_AGENT = 'course-wiki';

const ID = /^[a-z0-9][a-z0-9._:-]{0,119}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const MAX_EVIDENCE_AGE_MS = 5 * 60_000;
const COURSE_STAGE_PATHS = [[], ['small-select'], ['small-select', 'answer'],
  ['route'], ['route', 'retrieved-select'], ['route', 'retrieved-select', 'answer']];
const SAFE_GATEWAY_FAILURE_CODES = new Set([
  'COURSE_WIKI_REQUEST_INVALID', 'COURSE_WIKI_REQUEST_TOO_LARGE', 'COURSE_WIKI_DIAGNOSTIC_INVALID',
  'COURSE_WIKI_LIVE_NOT_AUTHORIZED', 'COURSE_WIKI_CONTEXT_MISSING', 'COURSE_WIKI_EVIDENCE_CONTEXT_MISSING',
  'COURSE_WIKI_DUPLICATE_REQUEST', 'COURSE_WIKI_WORKSPACE_INVALID', 'COURSE_WIKI_ALLOWANCE_EXHAUSTED',
  'COURSE_WIKI_BUDGET_REJECTED', 'COURSE_WIKI_CONSENT_REJECTED', 'COURSE_WIKI_OPERATION_BUSY',
  'COURSE_WIKI_EVIDENCE_TOO_LARGE', 'COURSE_WIKI_MODEL_EMPTY', 'COURSE_WIKI_MODEL_JSON_FENCED',
  'COURSE_WIKI_MODEL_JSON_INVALID', 'COURSE_WIKI_MODEL_RESPONSE_INVALID', 'COURSE_WIKI_UPSTREAM_DENIED',
  'COURSE_WIKI_UPSTREAM_NETWORK', 'COURSE_WIKI_UPSTREAM_RATE_LIMIT', 'COURSE_WIKI_UPSTREAM_RESPONSE_INVALID',
  'COURSE_WIKI_UPSTREAM_TIMEOUT', 'COURSE_WIKI_UPSTREAM_UNAVAILABLE', 'COURSE_WIKI_NATIVE_EXIT_FAILED',
  'COURSE_WIKI_NATIVE_OUTPUT_INVALID', 'COURSE_WIKI_NATIVE_SPAWN_FAILED', 'COURSE_WIKI_NATIVE_TIMEOUT',
  'COURSE_WIKI_GATEWAY_REJECTED',
]);
const APPROVED_CASE_BOUNDS = Object.freeze({
  greeting: [2, 3], capabilities: [2, 3], definition: [2, 3], followup: [4, 6],
  ambiguity: [2, 3], 'topic-switch': [4, 6], 'missing-evidence': [2, 3],
  'failure-recovery': [2, 3], 'import-docx': [3, 4], 'import-md': [3, 4],
  'import-txt': [3, 4], 'cross-document': [2, 3], 'corpus-update': [5, 6],
  'duplicate-import': [0, 0], 'failed-activation': [2, 3], restart: [2, 3],
  'document-injection': [3, 4], 'cumulative-budget': [0, 0],
});
const CONTEXT_KEYS = ['executable', 'agentId', 'generationId', 'runtimeDigest', 'executorId', 'reviewerId',
  'cwd', 'homeDir', 'stateDir', 'configPath', 'workspaceDir', 'xdgConfigDir', 'xdgDataDir',
  'xdgCacheDir', 'tempDir', 'timeoutMs', 'settlementMs', 'maxStdoutBytes', 'maxStderrBytes'];

class AcceptanceError extends Error {
  constructor(code = 'COURSE_WIKI_ACCEPTANCE_INVALID') {
    super('Course Wiki acceptance operation was rejected.');
    this.name = 'CourseWikiAcceptanceError';
    this.code = code;
  }
}

export async function runCourseWikiAcceptance(options) {
  const { caseCatalog, selectedCaseIds, inputFixtures, outputPath, runtimeContext,
    operatorPreflight, executeLifecycle, inspectExecution, inspectNativeFailure, reviewCase,
    requireProviderAccounting = false,
    nativeTransport = createNativeOpenClawTransport(), now = Date.now } = options ?? {};
  validateCatalog(caseCatalog);
  validateRuntimeContext(runtimeContext);
  absolutePath(outputPath);
  const selected = selectedIds(selectedCaseIds, caseCatalog);
  const fixtures = fixtureMap(inputFixtures);
  const definitions = new Map(caseCatalog.cases.map(caseDefinition => [caseDefinition.id,
    evidenceDefinition(caseDefinition, fixtures.get(caseDefinition.id), runtimeContext)]));
  const records = caseCatalog.cases.map(caseDefinition => pendingRecord(
    caseDefinition,
    definitions.get(caseDefinition.id),
    selected.has(caseDefinition.id) ? 'queued' : 'not-selected',
  ));
  const recordById = new Map(records.map(record => [record.id, record]));
  const output = await reserveOutput(outputPath);
  let failure = null;
  let activeContext = runtimeContext;
  try {
    for (const caseId of selectedCaseIds) {
      let record = recordById.get(caseId);
      if (failure) {
        replaceRecord(recordById, records, caseId, { ...record, status: 'stopped-after-failure' });
        continue;
      }
      const caseDefinition = caseCatalog.cases.find(value => value.id === caseId);
      const fixture = fixtures.get(caseId);
      if (!fixture || (fixture.kind === 'document-lifecycle' && typeof executeLifecycle !== 'function')) {
        failure = { caseId, code: fixture ? 'unsupported-lifecycle' : 'missing-input-fixture' };
        replaceRecord(recordById, records, caseId, { ...record, status: failure.code });
        continue;
      }
      const lifecyclePlan = fixture.kind === 'document-lifecycle' ? fixture.lifecycle : null;
      if (fixture.kind === 'document-lifecycle' && !lifecyclePlan) {
        failure = { caseId, code: 'missing-lifecycle-plan' };
        replaceRecord(recordById, records, caseId, { ...record, status: failure.code });
        continue;
      }
      const caseContext = lifecyclePlan ? { ...activeContext,
        generationId: lifecyclePlan.after.generationId, runtimeDigest: lifecyclePlan.after.runtimeDigest } : activeContext;
      const definition = evidenceDefinition(caseDefinition, fixture, caseContext);
      record = pendingRecord(caseDefinition, definition, 'queued');
      replaceRecord(recordById, records, caseId, record);
      if (typeof inspectExecution !== 'function' || typeof reviewCase !== 'function') {
        const code = typeof inspectExecution !== 'function' ? 'missing-execution-handler' : 'missing-independent-reviewer';
        failure = { caseId, code };
        replaceRecord(recordById, records, caseId, { ...record, status: code });
        continue;
      }
      if (typeof operatorPreflight !== 'function') {
        failure = { caseId, code: 'operator-preflight-rejected' };
        replaceRecord(recordById, records, caseId, { ...record, status: 'preflight-rejected' });
        continue;
      }
      const preflight = await checkedPreflight(operatorPreflight, caseId, fixture, activeContext).catch(() => null);
      if (!preflight) {
        failure = { caseId, code: 'operator-preflight-rejected' };
        replaceRecord(recordById, records, caseId, { ...record, status: 'preflight-rejected' });
        continue;
      }
      const startedAt = now();
      let nativeResult;
      let progress = { actualAttemptCount: 0, receivedAnswerCount: 0, sessionDigests: [] };
      let lifecycleEvidence = lifecyclePlan ? { planDigest: preflight.lifecyclePlanDigest,
        authorizedPaidRequests: preflight.authorizedPaidRequests, paidRequestCount: 0, receipt: null } : null;
      if (lifecyclePlan) {
        const controller = new AbortController();
        let closed = false;
        let rejectedProgress = false;
        let timer;
        try {
          const timeout = new Promise((resolve, reject) => {
            timer = setTimeout(() => {
              closed = true;
              reject(new AcceptanceError());
              controller.abort();
            }, activeContext.timeoutMs);
          });
          const receipt = frozenCopy(await Promise.race([timeout, executeLifecycle({ fixture,
            runtimeContext: { ...activeContext }, preflight, startedAt,
            deadlineAt: startedAt + activeContext.timeoutMs, signal: controller.signal,
            onProgress(value) {
              if (closed) return;
              try {
                value = frozenCopy(value);
                exact(value, ['paidRequestCount']);
                validatePaidCount(value.paidRequestCount, lifecyclePlan, lifecycleEvidence.paidRequestCount);
                lifecycleEvidence = { ...lifecycleEvidence, paidRequestCount: value.paidRequestCount };
              } catch (error) {
                rejectedProgress = true;
                closed = true;
                controller.abort();
                throw error;
              }
            } })]));
          requireThat(!rejectedProgress && !controller.signal.aborted);
          validateLifecycleReceipt(receipt, lifecyclePlan, preflight, lifecycleEvidence, startedAt, activeContext);
          lifecycleEvidence = { ...lifecycleEvidence, paidRequestCount: receipt.paidRequestCount,
            receipt };
          activeContext = caseContext;
        } catch {
          closed = true;
          controller.abort();
          failure = { caseId, code: 'lifecycle-execution-rejected' };
          replaceRecord(recordById, records, caseId, { ...record, status: failure.code,
            evidence: attemptEvidence(preflight, progress, lifecycleEvidence, fixture) });
          continue;
        } finally {
          closed = true;
          clearTimeout(timer);
        }
      }
      const lifecycleReceipt = lifecycleEvidence?.receipt;
      const onProgress = value => { progress = checkedProgress(value, fixture, progress); };
      try {
        const nativeFixture = lifecyclePlan ? { id: fixture.id, kind: 'native-agent-turns', turns: fixture.turns } : fixture;
        nativeResult = fixture.turns.length === 0 ? { outputs: [], trace: progress }
          : await nativeTransport.runCase({ fixture: nativeFixture, runtimeContext: caseContext, onProgress });
        validateNativeResult(nativeResult, fixture, caseContext);
        onProgress(nativeResult.trace);
      } catch (error) {
        const code = safeFailureCode(error, 'native-execution-failed');
        let failureAccounting = null;
        let settlementUnconfirmed = false;
        if (typeof inspectNativeFailure === 'function') {
          try {
            failureAccounting = checkedFailureAccounting(await inspectNativeFailure({
              caseId, caseDefinition, fixture, progress: { ...progress,
                sessionDigests: [...progress.sessionDigests] }, code,
            }));
          } catch (inspectionError) {
            failureAccounting = null;
            settlementUnconfirmed = inspectionError?.code === 'COURSE_WIKI_ACCEPTANCE_SETTLEMENT_UNCONFIRMED';
          }
        }
        failure = { caseId, code: settlementUnconfirmed ? 'native-settlement-unconfirmed'
          : typeof inspectNativeFailure === 'function' && !failureAccounting
            ? 'native-execution-unreconciled' : code };
        replaceRecord(recordById, records, caseId,
          { ...record, status: failure.code, evidence: attemptEvidence(preflight, progress,
            lifecycleEvidence, fixture, failureAccounting, settlementUnconfirmed ? 'unconfirmed' : null) });
        continue;
      }
      let mechanicalChecks;
      let providerAccounting = null;
      try {
        const inspection = await inspectExecution({ caseDefinition, fixture,
          outputs: nativeResult.outputs, trace: nativeResult.trace,
          ...(lifecycleReceipt ? { lifecycleReceipt } : {}) });
        if (Array.isArray(inspection)) {
          requireThat(!requireProviderAccounting);
          mechanicalChecks = inspection;
        } else {
          exact(inspection, ['checks', 'providerAccounting']);
          mechanicalChecks = inspection.checks;
          providerAccounting = checkedProviderAccounting(inspection.providerAccounting,
            caseCatalog.providerCallBoundsByCase[caseId], preflight.route, fixture.turns.length);
        }
        validateChecks(mechanicalChecks, caseDefinition.mechanicalCheckIds);
      } catch {
        failure = { caseId, code: 'execution-inspection-rejected' };
        replaceRecord(recordById, records, caseId,
          { ...record, status: failure.code, evidence: attemptEvidence(preflight, progress, lifecycleEvidence, fixture) });
        continue;
      }
      const completedAt = now();
      const evidence = attemptEvidence(preflight, progress, lifecycleEvidence, fixture,
        null, null, providerAccounting);
      const execution = {
        caseId,
        caseClass: caseDefinition.caseClass,
        testDigest: definition.testDigest,
        inputDigest: definition.inputDigest,
        outputDigest: canonicalDigest(lifecycleReceipt ? { outputs: nativeResult.outputs, lifecycleReceipt } : nativeResult.outputs),
        evidenceDigest: evidence.evidenceDigest,
        generationId: caseContext.generationId,
        runtimeDigest: caseContext.runtimeDigest,
        executorId: caseContext.executorId,
        startedAt,
        completedAt,
        checks: mechanicalChecks,
      };
      const executionDigest = canonicalDigest(execution);
      const storedEvidence = { ...evidence, executionDigest };
      const persistExpiredEvidence = evaluatedAt => {
        failure = { caseId, code: 'evidence-expired' };
        const result = buildBehaviorCaseResult({ caseId, caseClass: caseDefinition.caseClass,
          definition, execution: null, review: null, now: evaluatedAt });
        replaceRecord(recordById, records, caseId,
          { id: caseId, status: 'evidence-expired', definition, execution: null,
            review: null, evidence: storedEvidence, result });
      };
      if (mechanicalChecks.some(check => !check.pass)) {
        const evaluatedAt = now();
        let result;
        try {
          result = buildBehaviorCaseResult({ caseId, caseClass: caseDefinition.caseClass,
            definition, execution, review: null, now: evaluatedAt });
        } catch (error) {
          if (evaluatedAt - startedAt <= definition.maxAgeMs) throw error;
          persistExpiredEvidence(evaluatedAt);
          continue;
        }
        failure = { caseId, code: 'mechanical-check-failed' };
        replaceRecord(recordById, records, caseId,
          { id: caseId, status: 'failed', definition, execution, review: null, evidence: storedEvidence, result });
        continue;
      }
      let review = null;
      try {
        review = await reviewCase({ caseDefinition, fixture, outputs: nativeResult.outputs,
          definition, execution, executionDigest,
          ...(lifecycleReceipt ? { lifecycleReceipt } : {}) });
        if (review !== null) validateReviewShape(review);
      } catch {
        review = null;
      }
      let result;
      const evaluatedAt = now();
      try {
        result = buildBehaviorCaseResult({ caseId, caseClass: caseDefinition.caseClass,
          definition, execution, review, now: evaluatedAt });
      } catch (error) {
        if (evaluatedAt - startedAt > definition.maxAgeMs) {
          persistExpiredEvidence(evaluatedAt);
          continue;
        }
        review = null;
        result = buildBehaviorCaseResult({ caseId, caseClass: caseDefinition.caseClass,
          definition, execution, review: null, now: evaluatedAt });
      }
      if (!review) failure = { caseId, code: 'missing-independent-review' };
      else if (!result.passed) failure = { caseId, code: 'independent-review-failed' };
      replaceRecord(recordById, records, caseId,
        { id: caseId, status: result.passed ? 'passed' : 'failed', definition, execution,
          review, evidence: storedEvidence, result });
    }
    const artifact = buildArtifact(caseCatalog, selected, runtimeContext, records, failure);
    await output.writeFile(`${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
    await output.sync();
    return artifact;
  } finally {
    await output.close();
  }
}

// Matches the selected-corpus runtime's evidenceText byte boundary. Conservative
// per-case maxima are selected before any native/provider attempt.
export function courseWikiCorpusRoute(documents) {
  requireThat(Array.isArray(documents) && documents.length > 0);
  const text = documents.map(document => {
    requireThat(digest(document.sourceDigest) && Array.isArray(document.lines)
      && document.lines.every(line => typeof line === 'string'));
    return `SOURCE ${document.sourceDigest}\n${document.lines.map((line, index) => `${index + 1}|${line}`).join('\n')}`;
  }).join('\n\n');
  return Buffer.byteLength(text) <= 14 * 1024 ? 'smallCorpus' : 'largeCorpus';
}

export function approvedCourseCaseLimit(caseId, route) {
  requireThat(Object.hasOwn(APPROVED_CASE_BOUNDS, caseId)
    && (route === 'smallCorpus' || route === 'largeCorpus'));
  return APPROVED_CASE_BOUNDS[caseId][route === 'smallCorpus' ? 0 : 1];
}

export function safeCourseGatewayEvent(value) {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value));
  const { status, code } = value;
  const stageNames = status === 'failed' && value.stageNames === undefined ? [] : value.stageNames;
  const providerRequestCount = status === 'failed' && value.providerRequestCount === undefined
    ? 0 : value.providerRequestCount;
  requireThat(status === 'success' || status === 'failed');
  requireThat(Array.isArray(stageNames) && Number.isSafeInteger(providerRequestCount)
    && stageNames.length === providerRequestCount
    && COURSE_STAGE_PATHS.some(path => path.length === stageNames.length
      && path.every((stage, index) => stage === stageNames[index])));
  if (status === 'failed') requireThat(SAFE_GATEWAY_FAILURE_CODES.has(code));
  else requireThat(code === undefined);
  return { kind: 'gateway-result', status, ...(status === 'failed' ? { code } : {}),
    stageNames: [...stageNames], providerRequestCount };
}

export function parseCourseGatewayEvents(contents) {
  requireThat(typeof contents === 'string' && Buffer.byteLength(contents) <= 1024 * 1024
    && (contents === '' || contents.endsWith('\n')));
  if (!contents) return [];
  return contents.trimEnd().split('\n').map(line => {
    requireThat(Buffer.byteLength(line) <= 512);
    const value = JSON.parse(line);
    const safe = safeCourseGatewayEvent(value);
    requireThat(Object.keys(value).sort().join(',') === Object.keys(safe).sort().join(',')
      && value.kind === safe.kind);
    return safe;
  });
}

export function openCourseGatewayEventLog({ eventPath, ownedRoot }) {
  validateGatewayEventPath(eventPath, ownedRoot);
  const descriptor = openSync(eventPath, 'wx', 0o600);
  let closed = false;
  return Object.freeze({
    write(value) {
      requireThat(!closed);
      writeSync(descriptor, `${JSON.stringify(safeCourseGatewayEvent(value))}\n`);
      fsyncSync(descriptor);
    },
    close() { if (!closed) { closed = true; closeSync(descriptor); } },
  });
}

export async function readCourseGatewayEventLog({ eventPath, ownedRoot }) {
  validateGatewayEventPath(eventPath, ownedRoot);
  const stat = await lstat(eventPath);
  requireThat(stat.isFile() && stat.nlink === 1 && stat.size <= 1024 * 1024
    && (stat.mode & 0o077) === 0);
  return parseCourseGatewayEvents(await readFile(eventPath, 'utf8'));
}

function validateGatewayEventPath(eventPath, ownedRoot) {
  requireThat(typeof ownedRoot === 'string' && path.isAbsolute(ownedRoot)
    && path.normalize(ownedRoot) === ownedRoot && typeof eventPath === 'string'
    && path.isAbsolute(eventPath) && path.normalize(eventPath) === eventPath
    && path.dirname(eventPath) === ownedRoot
    && /^gateway-events-[a-z0-9-]{1,64}\.jsonl$/u.test(path.basename(eventPath)));
}

export function reconcileCourseGatewayEvents({ events, route, beforeReservations, afterReservations,
  maximumRequests, expectedTurns, allowFailure = false }) {
  requireThat(Array.isArray(events) && Number.isSafeInteger(expectedTurns) && expectedTurns >= 0
    && (route === 'smallCorpus' || route === 'largeCorpus')
    && events.length === expectedTurns && Number.isSafeInteger(beforeReservations)
    && Number.isSafeInteger(afterReservations) && afterReservations >= beforeReservations
    && Number.isSafeInteger(maximumRequests) && maximumRequests >= 0);
  const safe = events.map(safeCourseGatewayEvent);
  requireThat(allowFailure || safe.every(event => event.status === 'success'));
  const allowedPaths = route === 'smallCorpus' ? COURSE_STAGE_PATHS.slice(0, 3)
    : [COURSE_STAGE_PATHS[0], ...COURSE_STAGE_PATHS.slice(3)];
  requireThat(safe.every(event => allowedPaths.some(path => path.length === event.stageNames.length
    && path.every((stage, index) => stage === event.stageNames[index]))));
  const providerRequestCount = safe.reduce((count, event) => count + event.providerRequestCount, 0);
  requireThat(providerRequestCount === afterReservations - beforeReservations
    && providerRequestCount <= maximumRequests);
  return { providerRequestCount, stageNames: safe.flatMap(event => event.stageNames) };
}

export async function awaitCourseGatewaySettlement({ readEvents, beforeEvents, expectedEvents,
  timeoutMs, now = Date.now, pause = () => new Promise(resolve => setTimeout(resolve, 25)) }) {
  requireThat(typeof readEvents === 'function' && typeof now === 'function' && typeof pause === 'function'
    && Array.isArray(beforeEvents) && Number.isSafeInteger(expectedEvents) && expectedEvents >= 0
    && Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 120_000);
  const deadline = now() + timeoutMs;
  for (;;) {
    let allEvents;
    try { allEvents = await readEvents(); } catch {
      throw new AcceptanceError('COURSE_WIKI_ACCEPTANCE_SETTLEMENT_UNCONFIRMED');
    }
    requireThat(Array.isArray(allEvents) && allEvents.length <= beforeEvents.length + expectedEvents
      && JSON.stringify(allEvents.slice(0, beforeEvents.length)) === JSON.stringify(beforeEvents));
    if (allEvents.length === beforeEvents.length + expectedEvents) return allEvents;
    if (now() >= deadline) throw new AcceptanceError('COURSE_WIKI_ACCEPTANCE_SETTLEMENT_UNCONFIRMED');
    await pause();
  }
}

export function createNativeOpenClawTransport({
  spawnProcess = spawn,
  killProcess = process.kill.bind(process),
} = {}) {
  return Object.freeze({
    async runCase({ fixture, runtimeContext, onProgress = () => {} }) {
      validateRuntimeContext(runtimeContext);
      validateFixture(fixture);
      requireThat(typeof onProgress === 'function');
      if (fixture.kind !== 'native-agent-turns') throw new AcceptanceError('COURSE_WIKI_ACCEPTANCE_LIFECYCLE_UNSUPPORTED');
      const outputs = [];
      const sessionDigests = [];
      for (const turn of fixture.turns) {
        const turnDigest = canonicalDigest(turn.sessionId);
        const answer = await runNativeTurn({ turn, runtimeContext, spawnProcess, killProcess,
          onStarted() {
            sessionDigests.push(turnDigest);
            onProgress({ actualAttemptCount: sessionDigests.length,
              receivedAnswerCount: outputs.length, sessionDigests: [...sessionDigests] });
          } });
        outputs.push(answer);
        onProgress({ actualAttemptCount: sessionDigests.length,
          receivedAnswerCount: outputs.length, sessionDigests: [...sessionDigests] });
      }
      return { outputs, trace: { actualAttemptCount: sessionDigests.length,
        receivedAnswerCount: outputs.length, sessionDigests } };
    },
  });
}

async function runNativeTurn({ turn, runtimeContext, spawnProcess, killProcess, onStarted }) {
  const temporary = await mkdtemp(path.join(runtimeContext.tempDir, 'agentmo-course-wiki-acceptance-'));
  const messageFile = path.join(temporary, 'message.txt');
  try {
    await writeFile(messageFile, turn.message, { flag: 'wx', mode: 0o600 });
    const args = ['agent', '--local', '--agent', COURSE_WIKI_ACCEPTANCE_AGENT,
      '--session-id', turn.sessionId, '--thinking', 'off', '--verbose', 'off',
      '--timeout', String(Math.max(1, Math.ceil(runtimeContext.timeoutMs / 1000))),
      '--message-file', messageFile, '--json'];
    const environment = {
      PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
      HOME: runtimeContext.homeDir,
      OPENCLAW_STATE_DIR: runtimeContext.stateDir,
      OPENCLAW_CONFIG_PATH: runtimeContext.configPath,
      XDG_CONFIG_HOME: runtimeContext.xdgConfigDir,
      XDG_DATA_HOME: runtimeContext.xdgDataDir,
      XDG_CACHE_HOME: runtimeContext.xdgCacheDir,
      TMPDIR: runtimeContext.tempDir,
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
    };
    const raw = await boundedProcess({ runtimeContext, spawnProcess, killProcess, args, environment, onStarted });
    let parsed;
    try { parsed = JSON.parse(raw); } catch { throw new AcceptanceError('COURSE_WIKI_ACCEPTANCE_NATIVE_OUTPUT_INVALID'); }
    if (!parsed || parsed.meta?.stopReason !== 'stop' || parsed.meta.aborted !== false
      || parsed.meta.error != null || !Array.isArray(parsed.payloads)
      || parsed.payloads.length !== 1 || typeof parsed.payloads[0]?.text !== 'string'
      || (parsed.payloads[0].isError !== undefined && parsed.payloads[0].isError !== false)
      || !parsed.payloads[0].text.trim() || Buffer.byteLength(parsed.payloads[0].text) > runtimeContext.maxStdoutBytes) {
      throw new AcceptanceError('COURSE_WIKI_ACCEPTANCE_NATIVE_OUTPUT_INVALID');
    }
    return parsed.payloads[0].text;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function boundedProcess({ runtimeContext, spawnProcess, killProcess, args, environment, onStarted }) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnProcess(COURSE_WIKI_ACCEPTANCE_EXECUTABLE, args, {
        cwd: runtimeContext.cwd,
        env: environment,
        shell: false,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      reject(new AcceptanceError('COURSE_WIKI_ACCEPTANCE_NATIVE_SPAWN_FAILED'));
      return;
    }
    const stdout = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let failureCode = null;
    let done = false;
    let started = false;
    let settlementTimer;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timeoutTimer);
      clearTimeout(settlementTimer);
      if (error) {
        // A killed process may never close inherited pipes; release our handles at settlement.
        try { child.stdout.destroy(); } catch {}
        try { child.stderr.destroy(); } catch {}
        try { child.unref(); } catch {}
        reject(error);
      } else resolve(value);
    };
    const stop = code => {
      if (failureCode) return;
      failureCode = code;
      try { killProcess(-child.pid, 'SIGKILL'); } catch {}
      settlementTimer = setTimeout(() => finish(new AcceptanceError(code)), runtimeContext.settlementMs);
    };
    const timeoutTimer = setTimeout(() => stop('COURSE_WIKI_ACCEPTANCE_NATIVE_TIMEOUT'), runtimeContext.timeoutMs);
    child.stdout.on('data', chunk => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > runtimeContext.maxStdoutBytes) stop('COURSE_WIKI_ACCEPTANCE_NATIVE_OUTPUT_LIMIT');
      else stdout.push(chunk);
    });
    child.stderr.on('data', chunk => {
      stderrBytes += chunk.length;
      if (stderrBytes > runtimeContext.maxStderrBytes) stop('COURSE_WIKI_ACCEPTANCE_NATIVE_OUTPUT_LIMIT');
    });
    child.once('spawn', () => {
      if (started || done) return;
      started = true;
      try { onStarted(); }
      catch { stop('COURSE_WIKI_ACCEPTANCE_PROGRESS_REJECTED'); }
    });
    child.once('error', () => finish(new AcceptanceError('COURSE_WIKI_ACCEPTANCE_NATIVE_SPAWN_FAILED')));
    child.once('close', code => {
      if (failureCode) finish(new AcceptanceError(failureCode));
      else if (code !== 0) finish(new AcceptanceError('COURSE_WIKI_ACCEPTANCE_NATIVE_EXIT_FAILED'));
      else finish(null, Buffer.concat(stdout).toString('utf8'));
    });
  });
}

async function checkedPreflight(operatorPreflight, caseId, fixture, runtimeContext) {
  const checkedAt = Date.now();
  const plan = fixture.kind === 'document-lifecycle' ? fixture.lifecycle : null;
  if (plan) requireThat(plan.before.generationId === runtimeContext.generationId
    && plan.before.runtimeDigest === runtimeContext.runtimeDigest);
  const lifecyclePlanDigest = plan ? canonicalDigest(plan) : null;
  const supplied = await operatorPreflight({
    caseId,
    attemptsRequired: fixture.turns.length,
    generationId: runtimeContext.generationId,
    runtimeDigest: runtimeContext.runtimeDigest,
    ...(plan ? { lifecyclePlanDigest, paidRequestsRequired: plan.maxPaidRequests } : {}),
  });
  const result = plan ? frozenCopy(supplied) : supplied;
  exact(result, ['generationId', 'runtimeDigest', 'consentDigest', 'budgetDigest', 'authorizedAttempts', 'checkedAt', 'route',
    ...(plan ? ['lifecyclePlanDigest', 'authorizedPaidRequests'] : [])]);
  requireThat(result.generationId === runtimeContext.generationId);
  requireThat(result.runtimeDigest === runtimeContext.runtimeDigest);
  requireThat(result.route === 'smallCorpus' || result.route === 'largeCorpus');
  requireThat(digest(result.consentDigest) && digest(result.budgetDigest));
  requireThat(Number.isSafeInteger(result.authorizedAttempts) && result.authorizedAttempts >= fixture.turns.length);
  requireThat(Number.isSafeInteger(result.checkedAt) && result.checkedAt >= checkedAt - 60_000 && result.checkedAt <= Date.now());
  if (plan) {
    requireThat(result.lifecyclePlanDigest === lifecyclePlanDigest);
    requireThat(Number.isSafeInteger(result.authorizedPaidRequests)
      && result.authorizedPaidRequests >= plan.maxPaidRequests && result.authorizedPaidRequests <= 100);
  }
  return result;
}

function validateLifecycleReceipt(value, plan, preflight, progress, startedAt, context) {
  exact(value, ['operationId', 'planDigest', 'inputDigest', 'before', 'after', 'budgetBeforeDigest',
    'budgetAfterDigest', 'paidRequestCount', 'startedAt', 'completedAt']);
  requireThat(value.operationId === plan.operationId && value.planDigest === preflight.lifecyclePlanDigest
    && value.inputDigest === plan.inputDigest);
  for (const key of ['before', 'after']) {
    validateLifecycleIdentity(value[key]);
    requireThat(canonicalDigest(value[key]) === canonicalDigest(plan[key]));
  }
  requireThat(value.budgetBeforeDigest === preflight.budgetDigest && digest(value.budgetAfterDigest));
  validatePaidCount(value.paidRequestCount, plan, progress.paidRequestCount);
  requireThat(Number.isSafeInteger(value.startedAt) && value.startedAt >= startedAt);
  requireThat(Number.isSafeInteger(value.completedAt) && value.completedAt >= value.startedAt
    && value.completedAt <= Date.now() && Date.now() - startedAt <= context.timeoutMs);
}

function validatePaidCount(value, plan, previous) {
  requireThat(Number.isSafeInteger(value) && value >= previous && value <= plan.maxPaidRequests);
}

function validateLifecycleIdentity(value) {
  exact(value, ['generationId', 'runtimeDigest', 'sourceSetDigest', 'corpusDigest']);
  requireThat(id(value.generationId) && digest(value.runtimeDigest)
    && digest(value.sourceSetDigest) && digest(value.corpusDigest));
}

function evidenceDefinition(caseDefinition, fixture, runtimeContext) {
  return {
    caseId: caseDefinition.id,
    caseClass: caseDefinition.caseClass,
    testDigest: canonicalDigest(caseDefinition),
    inputDigest: canonicalDigest(fixture ?? { id: caseDefinition.id, status: 'fixture-not-supplied' }),
    generationId: runtimeContext.generationId,
    runtimeDigest: runtimeContext.runtimeDigest,
    executorId: runtimeContext.executorId,
    reviewerId: runtimeContext.reviewerId,
    rubricDigest: canonicalDigest(caseDefinition.rubric),
    mechanicalCheckIds: [...caseDefinition.mechanicalCheckIds],
    rubricCheckIds: caseDefinition.rubric.map(item => item.id),
    maxAgeMs: MAX_EVIDENCE_AGE_MS,
  };
}

function pendingRecord(caseDefinition, definition, status) {
  return {
    id: caseDefinition.id,
    status,
    definition,
    execution: null,
    review: null,
    evidence: null,
    result: buildBehaviorCaseResult({ caseId: caseDefinition.id, caseClass: caseDefinition.caseClass,
      definition, execution: null, review: null, now: Date.now() }),
  };
}

function attemptEvidence(preflight, progress, lifecycle = null, fixture, failureAccounting = null,
  settlement = null, providerAccounting = null) {
  const evidence = {
    consentDigest: preflight.consentDigest,
    budgetDigest: preflight.budgetDigest,
    preflightCheckedAt: preflight.checkedAt,
    authorizedAttempts: preflight.authorizedAttempts,
    actualAttemptCount: progress.actualAttemptCount,
    receivedAnswerCount: progress.receivedAnswerCount,
    sessionDigests: [...progress.sessionDigests],
    currentMessageDigests: fixture.turns.map(turn => canonicalDigest(turn.message)),
    ...(failureAccounting ? { failureAccounting } : {}),
    ...(providerAccounting ? { providerAccounting } : {}),
    ...(settlement ? { settlement } : {}),
    ...(lifecycle ? { lifecycle } : {}),
  };
  return { ...evidence, evidenceDigest: canonicalDigest(evidence) };
}

function checkedProviderAccounting(value, bounds, preflightRoute, turnCount) {
  exact(value, ['route', 'stageNames', 'providerRequestCount', 'reservationDelta']);
  requireThat(value.route === preflightRoute
    && Number.isSafeInteger(value.providerRequestCount) && value.providerRequestCount >= 0
    && value.providerRequestCount <= bounds[value.route]
    && value.reservationDelta === value.providerRequestCount
    && Array.isArray(value.stageNames) && value.stageNames.length === value.providerRequestCount
    && matchesFlattenedStagePaths(value.stageNames, value.route, turnCount));
  return { route: value.route, stageNames: [...value.stageNames],
    providerRequestCount: value.providerRequestCount, reservationDelta: value.reservationDelta };
}

function matchesFlattenedStagePaths(stageNames, route, turnCount) {
  const paths = route === 'smallCorpus' ? COURSE_STAGE_PATHS.slice(0, 3)
    : [COURSE_STAGE_PATHS[0], ...COURSE_STAGE_PATHS.slice(3)];
  let positions = new Set([0]);
  for (let turn = 0; turn < turnCount; turn++) {
    const next = new Set();
    for (const position of positions) for (const candidate of paths) {
      if (candidate.every((stage, index) => stageNames[position + index] === stage)) {
        next.add(position + candidate.length);
      }
    }
    positions = next;
  }
  return positions.has(stageNames.length);
}

function checkedFailureAccounting(value) {
  exact(value, ['providerRequestCount', 'stageNames', 'reservationDelta']);
  requireThat(Number.isSafeInteger(value.providerRequestCount)
    && value.providerRequestCount >= 0 && value.providerRequestCount <= 30
    && value.reservationDelta === value.providerRequestCount
    && Array.isArray(value.stageNames) && value.stageNames.length === value.providerRequestCount
    && value.stageNames.every(stage => COURSE_STAGE_PATHS.some(path => path.includes(stage))));
  return { providerRequestCount: value.providerRequestCount,
    stageNames: [...value.stageNames], reservationDelta: value.reservationDelta };
}

function buildArtifact(catalog, selected, context, records, failure) {
  const executed = records.filter(record => record.execution !== null).length;
  const reviewed = records.filter(record => record.review !== null).length;
  const passed = records.filter(record => record.result.passed).length;
  const complete = selected.size === catalog.cases.length && passed === catalog.cases.length && failure === null;
  return {
    schemaVersion: 'agentmo.course-wiki-acceptance-results.v1',
    claim: 'reviewed-behavior-evidence-only',
    status: complete ? 'complete' : 'incomplete',
    // Batch-start identity; individual records bind their own post-lifecycle target.
    generationId: context.generationId,
    runtimeDigest: context.runtimeDigest,
    executorId: context.executorId,
    reviewerId: context.reviewerId,
    selectedCaseIds: [...selected],
    coverage: { total: catalog.cases.length, selected: selected.size, executed, reviewed, passed, complete },
    failure,
    records,
  };
}

async function reserveOutput(outputPath) {
  try { return await open(outputPath, 'wx', 0o600); }
  catch (error) {
    if (error?.code === 'EEXIST') throw new AcceptanceError('COURSE_WIKI_ACCEPTANCE_OUTPUT_OCCUPIED');
    throw new AcceptanceError('COURSE_WIKI_ACCEPTANCE_OUTPUT_INVALID');
  }
}

function validateCatalog(value) {
  exact(value, ['schemaVersion', 'claim', 'providerCallBoundsByCase', 'cases']);
  requireThat(value.schemaVersion === 'agentmo.course-wiki-acceptance.v1');
  requireThat(value.claim === 'bounded-document-poc-only');
  requireThat(Array.isArray(value.cases) && value.cases.length === 18);
  exact(value.providerCallBoundsByCase, Object.keys(APPROVED_CASE_BOUNDS));
  for (const [caseId, bound] of Object.entries(value.providerCallBoundsByCase)) {
    exact(bound, ['smallCorpus', 'largeCorpus']);
    requireThat(bound.smallCorpus === approvedCourseCaseLimit(caseId, 'smallCorpus')
      && bound.largeCorpus === approvedCourseCaseLimit(caseId, 'largeCorpus'));
  }
  const seen = new Set();
  for (const item of value.cases) {
    exact(item, ['id', 'caseClass', 'steps', 'mechanicalCheckIds', 'rubric']);
    requireThat(id(item.id) && Object.hasOwn(APPROVED_CASE_BOUNDS, item.id)
      && id(item.caseClass) && !seen.has(item.id));
    seen.add(item.id);
    requireThat(Array.isArray(item.steps) && item.steps.length > 0
      && item.steps.every(step => typeof step === 'string' && step.trim() && step.length <= 500));
    validateIds(item.mechanicalCheckIds);
    requireThat(Array.isArray(item.rubric) && item.rubric.length > 0);
    for (const entry of item.rubric) {
      exact(entry, ['id', 'expectation']);
      requireThat(id(entry.id) && typeof entry.expectation === 'string'
        && entry.expectation.trim() && entry.expectation.length <= 500);
    }
    validateIds(item.rubric.map(entry => entry.id));
  }
}

function selectedIds(values, catalog) {
  requireThat(Array.isArray(values));
  const known = new Set(catalog.cases.map(item => item.id));
  const selected = new Set();
  for (const value of values) {
    requireThat(id(value) && known.has(value) && !selected.has(value));
    selected.add(value);
  }
  return selected;
}

function fixtureMap(values) {
  requireThat(Array.isArray(values));
  const fixtures = new Map();
  for (const value of values) {
    validateFixture(value);
    const fixture = frozenCopy(value);
    validateFixture(fixture);
    requireThat(!fixtures.has(fixture.id));
    fixtures.set(fixture.id, fixture);
  }
  return fixtures;
}

function validateFixture(value) {
  exact(value, ['id', 'kind', 'turns', ...(value?.kind === 'document-lifecycle' && Object.hasOwn(value, 'lifecycle') ? ['lifecycle'] : [])]);
  requireThat(id(value.id) && ['native-agent-turns', 'document-lifecycle'].includes(value.kind));
  requireThat(Array.isArray(value.turns) && value.turns.length <= 10);
  if (value.kind === 'native-agent-turns') requireThat(value.turns.length > 0 && value.turns.length <= 10);
  if (value.kind === 'document-lifecycle' && value.lifecycle) {
    const plan = value.lifecycle;
    exact(plan, ['operationId', 'inputDigest', 'before', 'after', 'maxPaidRequests']);
    requireThat(id(plan.operationId) && digest(plan.inputDigest));
    validateLifecycleIdentity(plan.before);
    validateLifecycleIdentity(plan.after);
    requireThat(Number.isSafeInteger(plan.maxPaidRequests) && plan.maxPaidRequests >= 0 && plan.maxPaidRequests <= 100);
  }
  value.turns.forEach((turn, index) => {
    exact(turn, ['sessionId', 'message', 'turn']);
    requireThat(id(turn.sessionId) && typeof turn.message === 'string' && turn.message.trim()
      && Buffer.byteLength(turn.message) <= 32 * 1024 && turn.turn === index + 1);
  });
}

function validateRuntimeContext(value) {
  exact(value, CONTEXT_KEYS);
  requireThat(value.executable === COURSE_WIKI_ACCEPTANCE_EXECUTABLE && value.agentId === COURSE_WIKI_ACCEPTANCE_AGENT);
  for (const key of ['generationId', 'executorId', 'reviewerId']) requireThat(id(value[key]));
  requireThat(value.executorId !== value.reviewerId && digest(value.runtimeDigest));
  for (const key of ['cwd', 'homeDir', 'stateDir', 'configPath', 'workspaceDir', 'xdgConfigDir',
    'xdgDataDir', 'xdgCacheDir', 'tempDir']) absolutePath(value[key]);
  requireThat(Number.isSafeInteger(value.timeoutMs) && value.timeoutMs > 0 && value.timeoutMs <= 120_000);
  requireThat(Number.isSafeInteger(value.settlementMs) && value.settlementMs > 0 && value.settlementMs <= 2_000);
  requireThat(Number.isSafeInteger(value.maxStdoutBytes) && value.maxStdoutBytes > 0 && value.maxStdoutBytes <= 2 * 1024 * 1024);
  requireThat(Number.isSafeInteger(value.maxStderrBytes) && value.maxStderrBytes > 0 && value.maxStderrBytes <= 128 * 1024);
}

function validateNativeResult(value, fixture, context) {
  exact(value, ['outputs', 'trace']);
  exact(value.trace, ['actualAttemptCount', 'receivedAnswerCount', 'sessionDigests']);
  requireThat(Array.isArray(value.outputs) && value.outputs.length === fixture.turns.length
    && value.outputs.every(output => typeof output === 'string' && Buffer.byteLength(output) <= context.maxStdoutBytes));
  requireThat(value.trace.actualAttemptCount === fixture.turns.length
    && value.trace.receivedAnswerCount === fixture.turns.length);
  checkedProgress(value.trace, fixture,
    { actualAttemptCount: 0, receivedAnswerCount: 0, sessionDigests: [] });
}

function checkedProgress(value, fixture, previous) {
  exact(value, ['actualAttemptCount', 'receivedAnswerCount', 'sessionDigests']);
  requireThat(Number.isSafeInteger(value.actualAttemptCount)
    && value.actualAttemptCount >= previous.actualAttemptCount
    && value.actualAttemptCount <= fixture.turns.length);
  requireThat(Number.isSafeInteger(value.receivedAnswerCount)
    && value.receivedAnswerCount >= previous.receivedAnswerCount
    && value.receivedAnswerCount <= value.actualAttemptCount);
  const expected = fixture.turns.slice(0, value.actualAttemptCount)
    .map(turn => canonicalDigest(turn.sessionId));
  requireThat(Array.isArray(value.sessionDigests)
    && value.sessionDigests.length === value.actualAttemptCount
    && value.sessionDigests.every((item, index) => item === expected[index]));
  requireThat(previous.sessionDigests.every((item, index) => value.sessionDigests[index] === item));
  return { actualAttemptCount: value.actualAttemptCount,
    receivedAnswerCount: value.receivedAnswerCount, sessionDigests: [...value.sessionDigests] };
}

function validateReviewShape(value) {
  exact(value, ['executionDigest', 'reviewerId', 'rubricDigest', 'reviewedAt', 'checks']);
}

function validateChecks(values, expected) {
  requireThat(Array.isArray(values) && values.length === expected.length);
  values.forEach((value, index) => {
    exact(value, ['id', 'pass']);
    requireThat(value.id === expected[index] && typeof value.pass === 'boolean');
  });
}

function replaceRecord(index, records, idValue, value) {
  const position = records.findIndex(record => record.id === idValue);
  records[position] = value;
  index.set(idValue, value);
}

function canonicalDigest(value) {
  const sorted = item => Array.isArray(item) ? item.map(sorted) : item && typeof item === 'object'
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, sorted(item[key])])) : item;
  return `sha256:${createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex')}`;
}

function frozenCopy(value) {
  const checkData = item => {
    if (item === null || typeof item !== 'object') {
      requireThat(item === null || ['string', 'number', 'boolean'].includes(typeof item));
      return;
    }
    requireThat([Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(item)));
    requireThat(Object.getOwnPropertySymbols(item).length === 0);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item))) {
      requireThat(Object.hasOwn(descriptor, 'value')
        && (descriptor.enumerable || (Array.isArray(item) && key === 'length')));
      checkData(descriptor.value);
    }
  };
  checkData(value);
  const copy = structuredClone(value);
  checkData(copy);
  const freeze = item => {
    if (item && typeof item === 'object') { Object.values(item).forEach(freeze); Object.freeze(item); }
    return item;
  };
  return freeze(copy);
}

function validateIds(values) {
  requireThat(Array.isArray(values) && values.length > 0 && values.length <= 100
    && values.every((value, index) => id(value) && (index === 0 || values[index - 1] < value)));
}

function exact(value, keys) {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
  const ownKeys = Reflect.ownKeys(value);
  requireThat(ownKeys.length === keys.length && ownKeys.every(key => keys.includes(key)));
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    requireThat(descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value'));
  }
}
function absolutePath(value) { requireThat(typeof value === 'string' && path.isAbsolute(value) && path.normalize(value) === value); }
function id(value) { return typeof value === 'string' && ID.test(value); }
function digest(value) { return typeof value === 'string' && DIGEST.test(value); }
function requireThat(value) { if (!value) throw new AcceptanceError(); }
function safeFailureCode(error, fallback) {
  return typeof error?.code === 'string' && /^COURSE_WIKI_ACCEPTANCE_[A-Z0-9_]+$/u.test(error.code)
    ? error.code.toLowerCase().replace(/^course_wiki_acceptance_/u, '').replaceAll('_', '-') : fallback;
}

export function resolveAcceptanceLaunch(argv) {
  if (Array.isArray(argv) && argv.length === 1 && argv[0] === '--help') return { help: true };
  throw new AcceptanceError('COURSE_WIKI_ACCEPTANCE_PROGRAMMATIC_ONLY');
}

async function main() {
  resolveAcceptanceLaunch(process.argv.slice(2));
  process.stdout.write('Usage: course-wiki-acceptance --help\nExecution is programmatic only: use a reviewed controller harness with a fixed import of runCourseWikiAcceptance from this runner. This command does not load operator files or run acceptance cases.\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(error => {
    const code = typeof error?.code === 'string' && /^COURSE_WIKI_ACCEPTANCE_[A-Z0-9_]+$/u.test(error.code)
      ? error.code : 'COURSE_WIKI_ACCEPTANCE_FAILED';
    process.stderr.write(`Course Wiki acceptance could not run (${code}).\n`);
    process.exitCode = 1;
  });
}
