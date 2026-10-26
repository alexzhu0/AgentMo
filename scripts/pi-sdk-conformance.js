import { spawn } from 'node:child_process';
import { readFile, mkdir, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { buildPiTargetDescriptor } from '../src/pi-target-descriptor.js';
import { piHash, piBytes, piKeys, piReject, readPiPrivateFile } from '../src/pi-install-plan.js';
import { admitCapturedArtifactBytes } from '../src/artifact-admission.js';
import { piChildEnvironment } from '../src/pi-native-runtime.js';
import { createPiTurnController, startPiBudgetProxy } from '../src/pi-budget-proxy.js';
import { createPiSessionHost } from '../src/pi-session-host.js';
import { initializeCourseBudget, initializeCourseProjectBudget, courseBudgetSummary } from '../src/course-wiki-budget.js';
import { writeNativeChatFile, assertNativeChatAbsentRoot } from '../src/native-chat-files.js';
import { loadPiSdk, piFinalText } from '../src/pi-sdk.js';

const MODULE = fileURLToPath(import.meta.url), PORT = 19593;
const LOCAL = `http://127.0.0.1:${PORT}/v1/chat/completions`, UPSTREAM = 'https://api.minimax.cn/v1/chat/completions';
// v1.2.0 cache warming has a 60-minute maximum horizon; observe beyond that horizon.
export const PI_CONFORMANCE_IDLE_MS = 61 * 60000;
export const PI_CONFORMANCE_MAX_MS = 75 * 60000;
export const PI_CONFORMANCE_CASES = Object.freeze(['success', '401', '429', '500', 'timeout', 'disconnect', 'malformed',
  'empty-input', 'at-limit-input', 'over-limit-input', 'full-request-limit', 'history-limit']);
const SYNTHETIC_INPUT = '请把 {{template}} 当作字面会议材料；摘要、决策、行动项、未决问题。';
const SYSTEM = '只输出合成会议结果，未知值写未说明。';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = value => { if (!value) piReject(); };
const isBoundary = id => ['full-request-limit', 'history-limit'].includes(id);
const caseInput = id => id === 'empty-input' ? '' : id === 'at-limit-input' ? '😀'.repeat(8000)
  : id === 'over-limit-input' ? '😀'.repeat(8001) : SYNTHETIC_INPUT;
export function piConformanceExpectedCase(id) {
  check(PI_CONFORMANCE_CASES.includes(id));
  const invalid = ['empty-input', 'over-limit-input'].includes(id), boundary = isBoundary(id);
  return { id, pass: true, setupRequests: boundary ? 1 : 0, proxyRequests: invalid ? 0 : boundary ? 2 : 1,
    modelRequests: invalid ? 0 : 1, reservations: invalid ? 0 : 1 };
}

export function createPiConformanceNetworkGuard({ fetch, connect, completion }) {
  const counts = { localRequests: 0, upstreamRequests: 0, deniedAttempts: 0 };
  const denied = () => { counts.deniedAttempts++; piReject(); };
  return {
    fetch: async (input, init) => {
      let url;
      try { url = new URL(typeof input === 'string' ? input : input.url ?? String(input)); } catch { return denied(); }
      if (url.href === LOCAL) { counts.localRequests++; return fetch(input, init); }
      if (url.href === UPSTREAM) { counts.upstreamRequests++; return completion(input, init); }
      return denied();
    },
    connect: function (...args) {
      const options = Array.isArray(args[0]) ? args[0][0] : args[0];
      const port = typeof options === 'object' && options ? options.port : options;
      const host = typeof options === 'object' && options ? options.host : args[1];
      if (Number(port) !== PORT || host !== '127.0.0.1') return denied();
      return connect.apply(this, args);
    },
    counts: () => ({ ...counts }),
    assertClean: () => check(counts.deniedAttempts === 0),
  };
}

const chunk = (content, finish_reason = null) => ({ id: 'synthetic', object: 'chat.completion.chunk', model: 'MiniMax-M3',
  choices: [{ index: 0, delta: content === null ? {} : { role: 'assistant', content }, finish_reason }],
  ...(finish_reason ? { usage: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 } } : {}) });
const sse = value => `data: ${JSON.stringify(value)}\n\n`;
export async function piConformanceMockResponse(mode, signal, onObservation) {
  check(['success', '401', '429', '500', 'timeout', 'disconnect', 'malformed'].includes(mode));
  if (['401', '429', '500'].includes(mode)) return new Response('{}', { status: Number(mode) });
  if (mode === 'timeout') return new Promise((resolve, reject) => {
    const aborted = () => { onObservation('timeout-abort'); reject(new Error('synthetic request aborted')); };
    if (signal.aborted) aborted(); else signal.addEventListener('abort', aborted, { once: true });
  });
  if (mode === 'disconnect') return new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(sse(chunk('合成部分')))); },
    async pull(controller) { await wait(0); onObservation('partial-stream-disconnect'); controller.error(new Error('synthetic partial stream disconnected')); },
  }, { highWaterMark: 0 }), { headers: { 'content-type': 'text/event-stream' } });
  if (mode === 'malformed') return new Response('data: invalid\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  return new Response(sse(chunk('摘要：合成。决策：未说明。行动项：未说明。未决问题：未说明。'))
    + sse(chunk(null, 'stop')) + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
}

async function previewFor(targetPaths, workspaceRoot) {
  check(path.isAbsolute(workspaceRoot) && path.resolve(workspaceRoot) === workspaceRoot
    && await realpath(path.dirname(workspaceRoot)) === path.dirname(workspaceRoot));
  return { schemaVersion: 'agentmo.pi-sdk-conformance-preview.v1', target: await buildPiTargetDescriptor(targetPaths),
    workspaceRootDigest: piHash(workspaceRoot), scriptDigest: piHash(await readFile(MODULE)), port: PORT,
    cases: PI_CONFORMANCE_CASES.map(piConformanceExpectedCase), idleWindowMs: PI_CONFORMANCE_IDLE_MS, maxDurationMs: PI_CONFORMANCE_MAX_MS,
    ownedStop: { ipcGraceMs: 10000, sigtermGraceMs: 5000, finalSignal: 'SIGKILL' },
    sourceScope: 'fixed-synthetic-only', maxMockedUpstreamRequests: 10, maxSyntheticReservedFen: 310,
    historyFixture: 'official-appendMessage-after-one-successful-setup', realProviderRequests: 0, retries: 0, cleanup: false };
}
export async function buildPiSdkConformancePreview({ targetPaths, workspaceRoot }) {
  await assertNativeChatAbsentRoot(workspaceRoot); return previewFor(targetPaths, workspaceRoot);
}
export async function runPiSdkConformance(options) {
  check(piKeys(options, ['preview', 'approvedPreviewDigest', 'targetPaths', 'workspaceRoot']));
  const { preview, approvedPreviewDigest, targetPaths, workspaceRoot } = options;
  check(approvedPreviewDigest === piHash(piBytes(preview))
    && isDeepStrictEqual(preview, await buildPiSdkConformancePreview({ targetPaths, workspaceRoot })));
  await mkdir(workspaceRoot, { mode: 0o700 });
  await writeNativeChatFile({ filePath: path.join(workspaceRoot, 'conformance.claim.json'), bytes: piBytes({ approvedPreviewDigest }) });
  return new Promise((resolve, reject) => {
    const child = spawn(targetPaths.nodeExecutablePath, [MODULE, '--owned-conformance-child'], { cwd: workspaceRoot,
      env: piChildEnvironment(workspaceRoot, targetPaths.nodeExecutablePath), shell: false, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    let result = null, failed = false, stopping = false, exited = false, termTimer, killTimer;
    const stop = () => {
      failed = true; if (stopping || exited) return; stopping = true;
      if (child.connected) child.send({ type: 'stop' }, () => {});
      termTimer = setTimeout(() => { if (!exited) child.kill('SIGTERM'); }, 10000);
      killTimer = setTimeout(() => { if (!exited) child.kill('SIGKILL'); }, 15000);
    };
    const deadline = setTimeout(stop, PI_CONFORMANCE_MAX_MS);
    child.on('message', message => {
      if (!piKeys(message, ['type', 'result']) || message.type !== 'complete' || result || !validResult(message.result)) { stop(); return; }
      result = message.result;
    });
    child.once('error', stop);
    child.once('close', (code, signal) => {
      exited = true; clearTimeout(deadline); clearTimeout(termTimer); clearTimeout(killTimer);
      if (failed || code !== 0 || signal || !result) reject(Object.assign(new Error('Pi SDK conformance failed; retained synthetic workspace.'), { code: 'PI_CONFORMANCE_FAILED' }));
      else resolve(result);
    });
    child.send({ type: 'init', options }, error => { if (error) stop(); });
  });
}
function validResult(value) {
  return piKeys(value, ['schemaVersion', 'ok', 'caseResults', 'idleWindowMs', 'maxDurationMs', 'extraRequests', 'realProviderRequests', 'certificationBoundary'])
    && value.schemaVersion === 'agentmo.pi-sdk-conformance-result.v1' && value.ok === true
    && value.idleWindowMs === PI_CONFORMANCE_IDLE_MS && value.maxDurationMs === PI_CONFORMANCE_MAX_MS
    && value.extraRequests === 0 && value.realProviderRequests === 0
    && isDeepStrictEqual(value.caseResults, PI_CONFORMANCE_CASES.map(piConformanceExpectedCase))
    && isDeepStrictEqual(value.certificationBoundary, { syntheticSdkOnly: true, domainCertified: false, deliveryReady: false, productionApproved: false });
}
async function ownedConformance(options, abort) {
  const { preview, targetPaths, workspaceRoot } = options;
  check(isDeepStrictEqual(preview, await previewFor(targetPaths, workspaceRoot)) && options.approvedPreviewDigest === piHash(piBytes(preview)));
  const stat = await lstat(workspaceRoot);
  check(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid() && (stat.mode & 0o777) === 0o700);
  process.umask(0o077);
  const descriptor = admitCapturedArtifactBytes({ subject: 'pi-target-descriptor', bytes: piBytes(preview.target), expectedDigest: piHash(piBytes(preview.target)) });
  const originalFetch = globalThis.fetch, originalConnect = net.Socket.prototype.connect;
  let mode = 'success', currentInput = SYNTHETIC_INPUT, proxy = null, host = null;
  const observations = [], results = [];
  const guard = createPiConformanceNetworkGuard({ fetch: originalFetch, connect: originalConnect,
    completion: async (input, init) => {
      const body = JSON.parse(init.body);
      check(body.model === 'MiniMax-M3' && body.max_completion_tokens === 2048 && body.n === 1
        && body.thinking?.type === 'disabled' && body.service_tier === 'standard' && body.messages[0]?.role === 'system'
        && body.messages[0]?.content === SYSTEM && body.messages.at(-1)?.content === currentInput && !body.tools && !body.tool_choice);
      return piConformanceMockResponse(mode, init.signal, observation => observations.push(observation));
    } });
  globalThis.fetch = guard.fetch; net.Socket.prototype.connect = guard.connect;
  const close = async () => {
    const closingProxy = proxy, closingHost = host; proxy = null; host = null;
    const settled = await Promise.allSettled([closingProxy?.close(), closingHost?.close()]);
    check(settled.every(value => value.status === 'fulfilled')); guard.assertClean();
  };
  const stopped = () => { void close().catch(() => {}); };
  abort.signal.addEventListener('abort', stopped, { once: true });
  let failure;
  try {
    const sdk = await loadPiSdk({ descriptorAdmission: descriptor, targetPaths });
    guard.assertClean(); check(guard.counts().upstreamRequests === 0 && guard.counts().localRequests === 0);
    const legacy = path.join(workspaceRoot, 'legacy'), budgetRoot = path.join(workspaceRoot, 'budget');
    await mkdir(legacy, { mode: 0o700 }); await mkdir(budgetRoot, { mode: 0o700 }); await initializeCourseBudget({ root: legacy });
    const { budgetReference } = await initializeCourseProjectBudget({ root: budgetRoot, legacyRoots: [legacy] });
    for (const id of PI_CONFORMANCE_CASES) {
      check(!abort.signal.aborted); mode = ['success', 'at-limit-input'].includes(id) || isBoundary(id) ? 'success' : id;
      currentInput = caseInput(id);
      const stateRoot = path.join(workspaceRoot, `case-${id}`), activationId = randomUUID();
      for (const dir of ['', 'sessions', 'turns', 'attempts']) await mkdir(path.join(stateRoot, dir), { mode: 0o700 });
      await writeNativeChatFile({ filePath: path.join(stateRoot, 'system.md'), bytes: Buffer.from(SYSTEM) });
      const binding = { native_runtime: 'pi', agentId: 'meeting-text', stateRootDigest: piHash(stateRoot), modelProfile: 'minimax-m3-cn-v1',
        chatPort: PORT - 1, proxyPort: PORT, budgetReference, targetDescriptorDigest: descriptor.digest,
        runtimeSourceDigest: preview.target.closure.runtimeSourceDigest, packageArchiveDigest: piHash('synthetic-package'), buildContractDigest: piHash('synthetic-contract') };
      const before = guard.counts(), summary = await courseBudgetSummary({ root: budgetRoot, budgetReference });
      let controller = await createPiTurnController({ binding, stateRoot, approvedCases: [], activationId });
      host = await createPiSessionHost({ stateRoot, binding, sdk, turnClient: controller });
      const { id: sessionId } = await host.createSession();
      check((await host.readSession(sessionId)).messages.length === 0 && !(await host.status()).canSend);
      await host.close(); host = null;
      check(isDeepStrictEqual(guard.counts(), before)); guard.assertClean();
      const approvedCases = [ ...(isBoundary(id) ? [{ caseId: 'setup', sessionId, inputDigest: piHash(currentInput) }] : []),
        { caseId: 'entry', sessionId, inputDigest: piHash(currentInput) } ];
      controller = await createPiTurnController({ binding, stateRoot, approvedCases, activationId });
      proxy = await startPiBudgetProxy({ binding, stateRoot, budgetRoot, apiKey: 'SYNTHETIC_CONFORMANCE_ONLY', controller });
      host = await createPiSessionHost({ stateRoot, binding, sdk, turnClient: controller, approvedCases });
      check(isDeepStrictEqual(guard.counts(), before)); guard.assertClean();
      const submit = async caseId => {
        const turnId = randomUUID(); await host.submit({ caseId, sessionId, turnId, text: currentInput });
        let final; for await (const state of host.events(turnId, { signal: abort.signal })) final = state;
        check(!abort.signal.aborted && final); return { final, turnId };
      };
      if (isBoundary(id)) {
        const setup = await submit('setup'); check(setup.final.status === 'completed'); await host.close(); host = null;
        const sessionDir = path.join(stateRoot, 'sessions', sessionId);
        const meta = JSON.parse((await readPiPrivateFile(path.join(sessionDir, 'sdk-session.json'))).bytes);
        const manager = sdk.SessionManager.open(path.join(sessionDir, meta.fileName), sessionDir, stateRoot);
        const assistant = manager.getBranch().findLast(entry => entry.type === 'message' && entry.message?.role === 'assistant')?.message;
        piFinalText(assistant);
        // Synthetic boundary history uses the official writer; it does not claim real conversation quality.
        for (let index = 0; index < (id === 'full-request-limit' ? 8 : 16); index++) {
          manager.appendMessage({ role: 'user', content: [{ type: 'text', text: id === 'full-request-limit' ? 'x'.repeat(6500) : '合成历史' }], timestamp: index + 1 });
          manager.appendMessage(structuredClone(assistant));
        }
        host = await createPiSessionHost({ stateRoot, binding, sdk, turnClient: controller, approvedCases }); guard.assertClean();
      }
      if (['empty-input', 'over-limit-input'].includes(id)) {
        let rejected = false; try { await submit('entry'); } catch (error) { rejected = error.httpStatus === 400; } check(rejected);
      } else {
        const { final, turnId } = await submit('entry');
        const success = ['success', 'at-limit-input'].includes(id);
        check((final.status === 'completed') === success && (success || final.status === 'failed'));
        if (id === 'timeout') check(observations.filter(value => value === 'timeout-abort').length === 1);
        if (id === 'disconnect') check(observations.filter(value => value === 'partial-stream-disconnect').length === 1);
        if (id === 'success') {
          const deadline = Date.now() + PI_CONFORMANCE_IDLE_MS;
          while (Date.now() < deadline) {
            await wait(Math.min(1000, deadline - Date.now())); check(!abort.signal.aborted);
            guard.assertClean(); check(guard.counts().upstreamRequests === before.upstreamRequests + 1 && proxy.summary().proxyRequests === 1);
          }
          const prior = await host.readSession(sessionId); check(prior.messages.length === 2 && prior.turns[0].status === 'completed');
          await host.close(); host = null;
          controller = await createPiTurnController({ binding, stateRoot, approvedCases, activationId });
          host = await createPiSessionHost({ stateRoot, binding, sdk, turnClient: controller, approvedCases });
          check(isDeepStrictEqual(await host.readSession(sessionId), prior));
          for await (const state of host.events(turnId)) check(state.status === 'completed');
          const fresh = await host.createSession(); check((await host.readSession(fresh.id)).messages.length === 0);
          check(!(await host.status()).canSend); guard.assertClean();
        }
      }
      const expected = piConformanceExpectedCase(id), counts = proxy.summary();
      const after = await courseBudgetSummary({ root: budgetRoot, budgetReference });
      check(counts.proxyRequests === expected.proxyRequests && counts.modelRequests === expected.modelRequests
        && counts.newReservations === expected.reservations && after.projectReservedFen - summary.projectReservedFen === expected.reservations * 31
        && guard.counts().upstreamRequests - before.upstreamRequests === expected.modelRequests
        && guard.counts().localRequests - before.localRequests === expected.proxyRequests);
      guard.assertClean(); await close(); guard.assertClean(); check(!abort.signal.aborted); results.push(expected);
    }
  } catch (error) { failure = error; }
  try { await close(); guard.assertClean(); } catch (error) { failure ??= error; }
  abort.signal.removeEventListener('abort', stopped);
  globalThis.fetch = originalFetch; net.Socket.prototype.connect = originalConnect;
  if (failure) throw failure; check(!abort.signal.aborted);
  const result = { schemaVersion: 'agentmo.pi-sdk-conformance-result.v1', ok: true, caseResults: results,
    idleWindowMs: PI_CONFORMANCE_IDLE_MS, maxDurationMs: PI_CONFORMANCE_MAX_MS, extraRequests: 0, realProviderRequests: 0,
    certificationBoundary: { syntheticSdkOnly: true, domainCertified: false, deliveryReady: false, productionApproved: false } };
  check(validResult(result));
  await writeNativeChatFile({ filePath: path.join(workspaceRoot, 'conformance.result.json'), bytes: piBytes(result) }); return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === MODULE && process.argv[2] === '--owned-conformance-child') {
  if (typeof process.send !== 'function' || !process.connected || process.env.AGENTMO_PI_CHILD !== '1') piReject();
  let started = false; const abort = new AbortController();
  process.on('disconnect', () => abort.abort()); process.on('SIGINT', () => abort.abort()); process.on('SIGTERM', () => abort.abort());
  process.on('message', async message => {
    if (piKeys(message, ['type']) && message.type === 'stop') { abort.abort(); return; }
    if (started || !piKeys(message, ['type', 'options']) || message.type !== 'init') { abort.abort(); return; } started = true;
    try { const result = await ownedConformance(message.options, abort); process.send({ type: 'complete', result }, () => process.disconnect()); }
    catch { process.exitCode = 1; process.disconnect(); }
  });
}
