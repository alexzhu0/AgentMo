import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { loadAdmittedArtifact, admittedArtifactProvenance } from './artifact-admission.js';
import { buildPiTargetDescriptor } from './pi-target-descriptor.js';
import { admitPiPackageArchive, buildPiInstallPlan, piPlanningSources, piArchiveSnapshot, piBytes, piHash, piIdentity, piKeys, piReject, readPiPrivateFile } from './pi-install-plan.js';
import { admitPiInstallReceipt, isPiInstallReceiptAdmission } from './pi-install.js';
import { consumeNativeAuthoritySet, verifyNativeAuthorityConsumption } from './native-chat-authority.js';
import { validatePiInstallApproval, validatePiSensitiveActionDecision, validatePiConflictApproval } from './pi-install-approval.js';
import { validateCourseBudgetBinding, courseBudgetSummary } from './course-wiki-budget.js';
import { createPiTurnController, startPiBudgetProxy, validatePiPublicTurn } from './pi-budget-proxy.js';
import { writeNativeChatFile } from './native-chat-files.js';
import { readBoundedNoFollowFile } from './builder-package.js';
import { resolveRuntimeEnv } from './runtime-env.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const INPUT_KEYS = ['planAdmission', 'sourceAdmissions', 'sourceFiles', 'stateRoot', 'authorityRoot', 'targetPaths', 'budgetRoot'];
const SOURCE_KEYS = ['blueprint', 'buildContract', 'planApproval', 'targetDescriptor', 'targetCarrierAdmission', 'archive', 'installPlan', 'installReceipt', 'activationPlan'];
const snapshots = new WeakMap();
// Two full descriptor checks precede ready; shutdown also drains an in-flight check.
const OWNED_READY_TIMEOUT_MS = 300000;
const OWNED_STOP_TIMEOUT_MS = 300000;
const CHILD_STARTUP_STAGES = ['source-load', 'preflight', 'authority-consumption', 'control-files', 'sdk-import', 'session-prewarm', 'chat-listen'];
const STARTUP_CODES = ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'EADDRINUSE', 'PI_SDK_FAILURE',
  'AGENTMO_PI_RUNTIME_REJECTED', 'AGENTMO_PI_LIFECYCLE_REJECTED', 'AGENTMO_PI_TARGET_REJECTED', 'OTHER'];
const reject = () => { throw Object.assign(new Error('Pi runtime request rejected.'), { code: 'AGENTMO_PI_RUNTIME_REJECTED' }); };
const sourceSubject = { blueprint: 'blueprint', buildContract: 'build-contract', planApproval: 'plan-approval',
  targetDescriptor: 'pi-target-descriptor', targetCarrierAdmission: 'pi-target-carrier-admission', installPlan: 'pi-install-plan',
  installReceipt: 'pi-install-receipt', activationPlan: 'pi-install-plan' };
const planning = sources => Object.fromEntries(['blueprint', 'buildContract', 'planApproval', 'targetDescriptor', 'targetCarrierAdmission', 'archive'].map(k => [k, sources[k]]));

export async function runPiStartupStep(stage, operation, record) {
  if (!CHILD_STARTUP_STAGES.includes(stage)) reject();
  await record({ stage, state: 'starting', code: null });
  try {
    const result = await operation();
    await record({ stage, state: 'passed', code: null });
    return result;
  } catch (error) {
    await record({ stage, state: 'failed', code: STARTUP_CODES.includes(error?.code) ? error.code : 'OTHER' });
    throw error;
  }
}

export async function loadPiNativeSources(options) {
  if (!piKeys(options, ['sourceFiles', 'stateRoot', 'authorityRoot'])) reject();
  const { sourceFiles, stateRoot, authorityRoot } = options;
  if (!piKeys(sourceFiles, SOURCE_KEYS) || Object.values(sourceFiles).some(b => !piKeys(b, ['filePath', 'expectedDigest']))) reject();
  const sources = {};
  for (const k of ['blueprint', 'buildContract', 'planApproval', 'targetDescriptor']) sources[k] = await loadAdmittedArtifact({ ...sourceFiles[k], subject: sourceSubject[k] });
  sources.targetCarrierAdmission = await loadAdmittedArtifact({ ...sourceFiles.targetCarrierAdmission, subject: sourceSubject.targetCarrierAdmission,
    companions: { blueprint: sources.blueprint, 'build-contract': sources.buildContract, 'plan-approval': sources.planApproval, 'pi-target-descriptor': sources.targetDescriptor } });
  sources.archive = await admitPiPackageArchive(sourceFiles.archive);
  sources.installPlan = await loadAdmittedArtifact({ ...sourceFiles.installPlan, subject: 'pi-install-plan' });
  sources.installReceipt = await admitPiInstallReceipt({ ...sourceFiles.installReceipt,
    admissions: { ...planning(sources), plan: sources.installPlan }, stateRoot, authorityRoot });
  const planAdmission = await loadAdmittedArtifact({ ...sourceFiles.activationPlan, subject: 'pi-install-plan' });
  return { planAdmission, sourceAdmissions: sources };
}

export async function preflightPiNative(options) {
  if (!piKeys(options, INPUT_KEYS) || !piKeys(options.sourceAdmissions, SOURCE_KEYS.filter(k => k !== 'activationPlan'))) reject();
  const { planAdmission, sourceAdmissions, sourceFiles, stateRoot, authorityRoot, targetPaths, budgetRoot } = options;
  admittedArtifactProvenance(planAdmission, { subject: 'pi-install-plan', value: planAdmission.value });
  if (planAdmission.value.lifecycle !== 'activate' || !isPiInstallReceiptAdmission(sourceAdmissions.installReceipt)) reject();
  for (const k of SOURCE_KEYS.filter(k => !['archive', 'activationPlan'].includes(k))) {
    admittedArtifactProvenance(sourceAdmissions[k], { subject: sourceSubject[k], value: sourceAdmissions[k]?.value });
    if (sourceFiles?.[k]?.expectedDigest !== sourceAdmissions[k].digest) reject();
  }
  piPlanningSources(planning(sourceAdmissions));
  if (sourceFiles?.activationPlan?.expectedDigest !== planAdmission.digest
    || sourceFiles?.archive?.expectedDigest !== sourceAdmissions.archive.expectedDigest) reject();
  const fresh = await loadPiNativeSources({ sourceFiles, stateRoot, authorityRoot }), plan = fresh.planAdmission.value;
  if (fresh.planAdmission.digest !== planAdmission.digest || !isDeepStrictEqual(plan, planAdmission.value)
    || !isDeepStrictEqual(await buildPiTargetDescriptor(targetPaths), fresh.sourceAdmissions.targetDescriptor.value)) reject();
  const expected = buildPiInstallPlan({ lifecycle: 'activate', admissions: planning(fresh.sourceAdmissions), stateRoot,
    authorityRootBinding: plan.authorityRootBinding, budgetReference: plan.nativeBinding.budgetReference,
    ports: { chat: plan.nativeBinding.chatPort, proxy: plan.nativeBinding.proxyPort }, predecessor: fresh.sourceAdmissions.installReceipt,
    activationId: plan.activationId, approvedCases: plan.approvedCases, restartAllowance: plan.restartAllowance });
  if (!isDeepStrictEqual(expected, plan)) reject();
  await validateCourseBudgetBinding({ root: budgetRoot, budgetReference: plan.nativeBinding.budgetReference });
  for (const sessionId of new Set(plan.approvedCases.map(c => c.sessionId))) {
    const dir = path.join(stateRoot, 'sessions', sessionId), stat = await lstat(dir, { bigint: true });
    const registration = JSON.parse((await readPiPrivateFile(path.join(dir, 'registration.json'))).bytes);
    if (!piKeys(registration, ['schemaVersion', 'id', 'createdAt', 'bindingDigest', 'rootIdentity', 'directoryIdentity'])
      || registration.schemaVersion !== 'agentmo.pi-session-registration.v1' || registration.id !== sessionId
      || registration.bindingDigest !== piHash(piBytes(plan.nativeBinding)) || !isDeepStrictEqual(registration.directoryIdentity, piIdentity(stat))
      || !isDeepStrictEqual(registration.rootIdentity, plan.predecessor.rootIdentity) || !stat.isDirectory() || stat.isSymbolicLink()
      || stat.uid !== BigInt(process.getuid()) || (stat.mode & 0o777n) !== 0o700n) reject();
  }
  const result = Object.freeze({ schemaVersion: 'agentmo.pi-native-preflight.v1', activationPlanDigest: plan.installPlanDigest,
    nativeBindingDigest: piHash(piBytes(plan.nativeBinding)), modelRequests: 0 });
  snapshots.set(result, fresh); return result;
}

export function piChildEnvironment(stateRoot, nodeExecutablePath) {
  if (!path.isAbsolute(stateRoot) || path.resolve(stateRoot) !== stateRoot || !path.isAbsolute(nodeExecutablePath)) reject();
  return { PATH: `${path.dirname(nodeExecutablePath)}:/usr/bin:/bin`, HOME: stateRoot, TMPDIR: path.join(stateRoot, 'attempts'),
    PI_CODING_AGENT_DIR: stateRoot, PI_CODING_AGENT_SESSION_DIR: path.join(stateRoot, 'sessions'), PI_OFFLINE: '1', PI_TELEMETRY: '0',
    PI_SKIP_VERSION_CHECK: '1', NODE_DISABLE_COMPILE_CACHE: '1', AGENTMO_PI_CHILD: '1' };
}

function assertDecisions(plan, options) {
  const context = { plan, now: new Date().toISOString() };
  if (!validatePiInstallApproval(options.ordinaryApproval, context).ok || !validatePiConflictApproval(options.conflictApproval, context).ok
    || !Array.isArray(options.sensitiveDecisions) || options.sensitiveDecisions.length !== plan.sensitiveActions.length
    || options.sensitiveDecisions.some((d, i) => !validatePiSensitiveActionDecision(d, { ...context, action: plan.sensitiveActions[i] }).ok)) reject();
}
const basePath = (stateRoot, plan, index) => path.join(stateRoot, 'attempts', `pi-run-${plan.installPlanDigest.slice(7)}-${index}`);
async function existing(filePath) { try { return JSON.parse((await readPiPrivateFile(filePath)).bytes); } catch (e) { if (e.code !== 'ENOENT') throw e; return null; } }
function validStop(value, plan, runId) {
  return piKeys(value, ['schemaVersion', 'activationPlanDigest', 'runId', 'rootIdentity', 'status', 'reason', 'ownChildExited'])
    && value.schemaVersion === 'agentmo.pi-owned-stop.v1' && value.activationPlanDigest === plan.installPlanDigest && value.runId === runId
    && isDeepStrictEqual(value.rootIdentity, plan.predecessor.rootIdentity) && ['stopped', 'failed'].includes(value.status)
    && ['requested', 'signal', 'child-exit', 'child-error', 'protocol-failed', 'case-failed', 'startup-failed'].includes(value.reason)
    && typeof value.ownChildExited === 'boolean';
}
async function nextRun(stateRoot, plan, authorityRoot) {
  for (const name of (await readdir(path.join(stateRoot, 'attempts'))).filter(n=>n.startsWith('pi-run-')&&n.endsWith('.claim.json'))) {
    const match=/^pi-run-([a-f0-9]{64})-([01])\.claim\.json$/u.exec(name);if(!match)reject();
    if(`sha256:${match[1]}`===plan.installPlanDigest)continue;
    const base=path.join(stateRoot,'attempts',name.slice(0,-11));
    const claim=JSON.parse((await readPiPrivateFile(path.join(stateRoot,'attempts',name))).bytes);
    const stopped=JSON.parse((await readPiPrivateFile(`${base}.stopped.json`)).bytes);
    if(!piKeys(claim,['runId','activationPlanDigest','index','rootIdentity','consumptionDigest'])
      ||!UUID.test(claim.runId)||claim.activationPlanDigest!==`sha256:${match[1]}`
      ||claim.index!==Number(match[2])||!/^sha256:[a-f0-9]{64}$/u.test(claim.consumptionDigest)
      ||!isDeepStrictEqual(claim.rootIdentity,plan.predecessor.rootIdentity)
      ||!validStop(stopped,{installPlanDigest:claim.activationPlanDigest,predecessor:plan.predecessor},claim.runId)||!stopped.ownChildExited)reject();
  }

  for (let index = 0; index <= plan.restartAllowance; index++) {
    const base = basePath(stateRoot, plan, index), prior = await existing(`${base}.claim.json`);
    if (!prior) return { base, index };
    const stopped = await existing(`${base}.stopped.json`);
    if (!piKeys(prior, ['runId', 'activationPlanDigest', 'index', 'rootIdentity', 'consumptionDigest'])
      || prior.activationPlanDigest !== plan.installPlanDigest || prior.index !== index || !UUID.test(prior.runId)
      || !isDeepStrictEqual(prior.rootIdentity, plan.predecessor.rootIdentity) || !validStop(stopped, plan, prior.runId)
      || stopped.status !== 'stopped' || stopped.reason !== 'requested' || stopped.ownChildExited !== true) reject();
    await verifyNativeAuthorityConsumption({ authorityRoot, plan, consumptionDigest: prior.consumptionDigest });
  }
  reject();
}
function send(child, value) {
  return new Promise((resolve, rejectSend) => {
    if (!child.connected) return rejectSend(new Error('owned channel closed'));
    child.send(value, error => error ? rejectSend(new Error('owned channel failed')) : resolve());
  });
}
async function deadline(promise, ms) {
  let timer; try { return await Promise.race([promise, new Promise((_, rejectTimer) => { timer = setTimeout(() => rejectTimer(new Error('owned operation timed out')), ms); })]); }
  finally { clearTimeout(timer); }
}

export async function startPiNative(options) {
  const optional = ['apiKey', 'runtimeEnvFile', 'signal'].filter(k => Object.hasOwn(options ?? {}, k));
  if (!piKeys(options, [...INPUT_KEYS, 'ordinaryApproval', 'sensitiveDecisions', 'conflictApproval', 'approvedCases', ...optional])
    || options.apiKey !== undefined && options.runtimeEnvFile !== undefined || options.signal?.aborted) reject();
  const preflightArgs = Object.fromEntries(INPUT_KEYS.map(k => [k, options[k]]));
  const snapshot = await preflightPiNative(preflightArgs), fresh = snapshots.get(snapshot), plan = fresh.planAdmission.value;
  if (!isDeepStrictEqual(options.approvedCases, plan.approvedCases)
    || options.runtimeEnvFile !== undefined && (!plan.approvedCases.length || !path.isAbsolute(options.runtimeEnvFile))
    || options.apiKey !== undefined && (typeof options.apiKey !== 'string' || !options.apiKey || /[\r\n]/u.test(options.apiKey))) reject();
  assertDecisions(plan, options);
  const { stateRoot, authorityRoot, budgetRoot } = options, { base, index } = await nextRun(stateRoot, plan, authorityRoot), runId = randomUUID();
  const budgetBefore = await courseBudgetSummary({ root: budgetRoot, budgetReference: plan.nativeBinding.budgetReference });
  if (options.signal?.aborted) reject();
  const consumed = await consumeNativeAuthoritySet({ authorityRoot, stateRoot, plan, ordinaryApproval: options.ordinaryApproval,
    sensitiveDecisions: options.sensitiveDecisions, conflictApproval: options.conflictApproval });
  let proxy, child, stopping, closing = false, resolveCompletion, key = '', ownChildExited = true;
  const completion = new Promise(resolve => { resolveCompletion = resolve; });
  let childExit = Promise.resolve({ code: 0 });
  const stop = (reason = 'requested') => {
    if (stopping) return stopping;
    closing = true;
    stopping = (async () => {
      let clean = true;
      try { await proxy?.close(); } catch { clean = false; }
      if (child) {
        if (child.connected) await send(child, { type: 'shutdown', runId }).catch(() => { clean = false; });
        try { const result = await deadline(childExit, OWNED_STOP_TIMEOUT_MS); ownChildExited = true; if (result.code !== 0) clean = false; }
        catch { clean = false; ownChildExited = false; }
      }
      key = '';
      const result = { schemaVersion: 'agentmo.pi-owned-stop.v1', activationPlanDigest: plan.installPlanDigest, runId,
        rootIdentity: plan.predecessor.rootIdentity, status: clean && reason === 'requested' ? 'stopped' : 'failed', reason, ownChildExited };
      await writeNativeChatFile({ filePath: `${base}.stopped.json`, bytes: piBytes(result) }).catch(() => { result.status = 'failed'; });
      options.signal?.removeEventListener('abort', cancelled); resolveCompletion(result); return result;
    })(); return stopping;
  };
  const cancelled = () => { void stop('signal'); };
  try {
    await writeNativeChatFile({ filePath: `${base}.claim.json`, bytes: piBytes({ runId, activationPlanDigest: plan.installPlanDigest,
      index, rootIdentity: plan.predecessor.rootIdentity, consumptionDigest: consumed.consumptionDigest }) });
    if (options.signal?.aborted) throw new Error('cancelled');
    if (options.runtimeEnvFile) {
      const env = resolveRuntimeEnv({ envFile: options.runtimeEnvFile,
        envFileContent: new TextDecoder('utf-8', { fatal: true }).decode(await readBoundedNoFollowFile(options.runtimeEnvFile, 64 * 1024)), runtimeEnvAllowlist: ['MINIMAX_API_KEY'] });
      key = env.values.MINIMAX_API_KEY; env.values.MINIMAX_API_KEY = ''; env.secretValues.length = 0;
    } else key = options.apiKey ?? (plan.approvedCases.length ? '' : 'unavailable-in-read-only-mode');
    if (!key || /[\r\n]/u.test(key)) throw new Error('missing credential');
    const loginSecret = randomBytes(24).toString('hex'), stopCapability = randomBytes(32).toString('hex');
    const control = { schemaVersion: 'agentmo.pi-owned-control.v1', runId, activationPlanDigest: plan.installPlanDigest,
      rootIdentity: plan.predecessor.rootIdentity, chatPort: plan.nativeBinding.chatPort, stopCapability };
    const controlBytes = Buffer.from(`${JSON.stringify(control)}\n`);
    await writeNativeChatFile({ filePath: `${base}.control.json`, bytes: controlBytes });
    await writeNativeChatFile({ filePath: `${base}.login.txt`, bytes: Buffer.from(loginSecret) });
    const controller = await createPiTurnController({ binding: plan.nativeBinding, stateRoot, approvedCases: plan.approvedCases, activationId: plan.activationId });
    proxy = await startPiBudgetProxy({ binding: plan.nativeBinding, stateRoot, budgetRoot, apiKey: key, controller }); key = '';
    let readyResolve, readyReject, becameReady = false;
    const ready = new Promise((resolve, rejectReady) => { readyResolve = resolve; readyReject = rejectReady; });
    ready.catch(() => {});
    child = spawn(options.targetPaths.nodeExecutablePath, [fileURLToPath(import.meta.url), '--pi-owned-child'], {
      cwd: stateRoot, env: piChildEnvironment(stateRoot, options.targetPaths.nodeExecutablePath), shell: false, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    }); ownChildExited = false;
    childExit = new Promise(resolve => { child.once('exit', (code, signal) => { resolve({ code, signal }); if (!closing) void stop('child-exit'); });
      child.once('error', () => { readyReject(new Error('owned child failed')); resolve({ code: 1 }); if (!closing) void stop('child-error'); }); });
    const seen = new Set(); let startupSequence = 0, startupFailed = false;
    child.on('message', message => {
      void (async () => {
        if (message?.type === 'startup') {
          if (becameReady || startupFailed || !piKeys(message, ['type', 'runId', 'sequence', 'stage', 'state', 'code'])
            || message.runId !== runId || message.sequence !== startupSequence || startupSequence >= 14
            || message.stage !== CHILD_STARTUP_STAGES[Math.floor(startupSequence / 2)]
            || (startupSequence % 2 === 0 ? message.state !== 'starting' || message.code !== null
              : message.state === 'passed' ? message.code !== null : message.state !== 'failed' || !STARTUP_CODES.includes(message.code))) reject();
          startupSequence++; startupFailed = message.state === 'failed';
          child.emit('agentmo-pi-startup', { sequence: message.sequence, stage: message.stage, state: message.state, code: message.code });
          return;
        }
        if (message?.type === 'ready') {
          if (becameReady || !piKeys(message, ['type', 'runId', 'agentId', 'chatPort']) || message.runId !== runId
            || message.agentId !== plan.nativeBinding.agentId || message.chatPort !== plan.nativeBinding.chatPort
            || startupFailed || startupSequence !== 0 && startupSequence !== 14) reject();
          becameReady = true; readyResolve(); return;
        }
        if (!piKeys(message, ['type', 'runId', 'requestId', 'method', 'input']) || message.type !== 'call' || message.runId !== runId
          || !UUID.test(message.requestId) || seen.has(message.requestId) || seen.size >= 50000
          || !['admit', 'finish', 'state', 'status', 'stop'].includes(message.method)) reject();
        seen.add(message.requestId);
        let value;
        try {
          if (message.method === 'admit') { if (closing) reject(); value = await controller.admit(message.input); }
          else if (message.method === 'finish') value = await controller.finish(message.input);
          else if (message.method === 'state') { if (!piKeys(message.input, ['turnId'])) reject(); value = await controller.state(message.input.turnId); }
          else if (message.method === 'status') { if (!piKeys(message.input, [])) reject(); value = closing ? { canSend: false, nextCaseId: null } : await controller.status(); }
          else { if (!piKeys(message.input, [])) reject(); value = { stopping: true }; }
          await send(child, { type: 'result', runId, requestId: message.requestId, ok: true, value });
        } catch { await send(child, { type: 'result', runId, requestId: message.requestId, ok: false, value: null }); return; }
        if (message.method === 'stop') setImmediate(() => { void stop(); });
        if (message.method === 'finish' && value.status !== 'completed') setImmediate(() => { void stop('case-failed'); });
      })().catch(() => { readyReject(new Error('owned protocol failed')); void stop('protocol-failed'); });
    });
    await send(child, { type: 'init', runId, sourceFiles: options.sourceFiles, targetPaths: options.targetPaths, stateRoot, authorityRoot, budgetRoot,
      controlPath: `${base}.control.json`, controlDigest: piHash(controlBytes), loginPath: `${base}.login.txt`, consumptionDigest: consumed.consumptionDigest });
    options.signal?.addEventListener('abort', cancelled, { once: true });
    if (options.signal?.aborted) cancelled();
    await deadline(Promise.race([ready, completion.then(() => { throw new Error('owned startup stopped'); })]), OWNED_READY_TIMEOUT_MS);
    if (closing || options.signal?.aborted) throw new Error('startup stopped');
    const health = await fetch(`http://127.0.0.1:${plan.nativeBinding.chatPort}/`, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    const expectedHtml = piArchiveSnapshot(fresh.sourceAdmissions.archive).files.find(f => f.relativePath === 'browser/index.html');
    if (health.status !== 200 || !(health.headers.get('content-security-policy') ?? '').includes("frame-ancestors 'none'")
      || piHash(Buffer.from(await health.text())) !== expectedHtml.sha256 || closing || options.signal?.aborted) throw new Error('health failed');
    const budgetAfter = await courseBudgetSummary({ root: budgetRoot, budgetReference: plan.nativeBinding.budgetReference });
    if (budgetAfter.projectReservations !== budgetBefore.projectReservations || proxy.summary().modelRequests !== 0
      || proxy.summary().proxyRequests !== 0) throw new Error('unexpected startup request');
    return { entry: { schemaVersion: 'agentmo.pi-native-entry.v1', agentId: plan.nativeBinding.agentId,
      activationPlanDigest: plan.installPlanDigest, url: `http://127.0.0.1:${plan.nativeBinding.chatPort}/`, accessFile: `${base}.login.txt`,
      canSend: (await controller.status()).canSend, modelRequests: 0, newReservations: 0 }, completion, stop: () => stop() };
  } catch { await stop('startup-failed'); reject(); }
}

export async function stopPiNative({ planAdmission, stateRoot }) {
  admittedArtifactProvenance(planAdmission, { subject: 'pi-install-plan', value: planAdmission.value });
  const plan = planAdmission.value;
  if (plan.lifecycle !== 'activate' || piHash(stateRoot) !== plan.nativeBinding.stateRootDigest
    || !isDeepStrictEqual(piIdentity(await lstat(stateRoot, { bigint: true })), plan.predecessor.rootIdentity)) reject();
  for (let index = plan.restartAllowance; index >= 0; index--) {
    const base = basePath(stateRoot, plan, index), claim = await existing(`${base}.claim.json`); if (!claim) continue;
    const prior = await existing(`${base}.stopped.json`);
    if (prior) { if (!validStop(prior, plan, claim.runId) || prior.status !== 'stopped' || prior.ownChildExited !== true) reject(); return prior; }
    const control = await existing(`${base}.control.json`);
    if (!piKeys(control, ['schemaVersion', 'runId', 'activationPlanDigest', 'rootIdentity', 'chatPort', 'stopCapability'])
      || control.schemaVersion !== 'agentmo.pi-owned-control.v1' || control.runId !== claim.runId || !UUID.test(control.runId)
      || control.activationPlanDigest !== plan.installPlanDigest || control.chatPort !== plan.nativeBinding.chatPort
      || !isDeepStrictEqual(control.rootIdentity, plan.predecessor.rootIdentity) || !/^[a-f0-9]{64}$/u.test(control.stopCapability)) reject();
    await fetch(`http://127.0.0.1:${control.chatPort}/api/stop`, { method: 'POST', headers: { 'content-type': 'application/json',
      authorization: `AgentMoStop ${control.stopCapability}` }, body: '{}', redirect: 'error', signal: AbortSignal.timeout(5000) }).catch(() => {});
    for (let n = 0; n < OWNED_STOP_TIMEOUT_MS / 100; n++) {
      let stopped;
      try { stopped = await existing(`${base}.stopped.json`); }
      catch (error) {
        // A create-only receipt can still be writing; never accept it without a complete strict read.
        if (error.code !== 'AGENTMO_PI_LIFECYCLE_REJECTED' && !(error instanceof SyntaxError)) throw error;
      }
      if (stopped) { if (!validStop(stopped, plan, control.runId) || stopped.status !== 'stopped' || stopped.ownChildExited !== true) reject(); return stopped; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    reject();
  }
  reject();
}

async function runOwnedPiChild() {
  if (typeof process.send !== 'function' || !process.connected || process.env.AGENTMO_PI_CHILD !== '1'
    || ['MINIMAX_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'NODE_OPTIONS', 'HTTP_PROXY', 'HTTPS_PROXY'].some(k => Object.hasOwn(process.env, k))) reject();
  process.umask(0o077);
  let runId, starting = false, host, server, closing = false, closed = false, shutdown;
  let initialization = Promise.resolve();
  const pending = new Map();
  const call = (method, input) => {
    if (!runId || !process.connected || closed || closing && method !== 'finish') return Promise.reject(new Error('owned channel unavailable'));
    const requestId = randomUUID();
    return new Promise((resolve, rejectCall) => {
      const timer = setTimeout(() => { pending.delete(requestId); rejectCall(new Error('owned call timed out')); }, 30000);
      pending.set(requestId, { method, resolve: value => { clearTimeout(timer); resolve(value); }, reject: () => { clearTimeout(timer); rejectCall(new Error('owned call rejected')); } });
      process.send({ type: 'call', runId, requestId, method, input }, error => { if (error) { pending.get(requestId)?.reject(); pending.delete(requestId); } });
    });
  };
  const close = (failed = false) => {
    if (failed) process.exitCode = 1;
    closing = true;
    return shutdown ??= (async () => {
      await initialization.catch(() => {});
      await server?.close().catch(() => { process.exitCode = 1; });
      await host?.close().catch(() => { process.exitCode = 1; });
      closed = true; for (const request of pending.values()) request.reject(); pending.clear();
      if (process.connected) process.disconnect();
    })();
  };
  const validResult = (method, value) => {
    if (method === 'state' || method === 'finish') return validatePiPublicTurn(value);
    if (method === 'admit') return piKeys(value, ['kind', 'turnToken']) && value.kind === 'admitted' && /^[a-f0-9]{64}$/u.test(value.turnToken)
      || piKeys(value, ['kind', 'turn']) && value.kind === 'existing' && validatePiPublicTurn(value.turn);
    if (method === 'status') return piKeys(value, ['canSend', 'nextCaseId']) && typeof value.canSend === 'boolean'
      && (value.canSend ? /^[a-z][a-z0-9-]{0,63}$/u.test(value.nextCaseId) : value.nextCaseId === null);
    return method === 'stop' && piKeys(value, ['stopping']) && value.stopping === true;
  };
  process.on('message', message => {
    void (async () => {
      if (message?.type === 'shutdown') {
        if (!piKeys(message, ['type', 'runId']) || message.runId !== runId) reject(); await close(); return;
      }
      if (message?.type === 'result') {
        if (!piKeys(message, ['type', 'runId', 'requestId', 'ok', 'value']) || message.runId !== runId || typeof message.ok !== 'boolean') reject();
        const request = pending.get(message.requestId); if (!request) reject(); pending.delete(message.requestId);
        if (!message.ok) { if (message.value !== null) reject(); request.reject(); return; }
        if (!validResult(request.method, message.value)) { request.reject(); reject(); } request.resolve(message.value); return;
      }
      if (starting || !piKeys(message, ['type', 'runId', 'sourceFiles', 'targetPaths', 'stateRoot', 'authorityRoot', 'budgetRoot', 'controlPath', 'controlDigest', 'loginPath', 'consumptionDigest'])
        || message.type !== 'init' || !UUID.test(message.runId)) reject();
      starting = true; runId = message.runId;
      let sequence = 0;
      const step = (stage, operation) => runPiStartupStep(stage, operation,
        row => new Promise((resolve, rejectReport) => {
          if (!process.connected) return rejectReport(new Error('owned channel closed'));
          process.send({ type: 'startup', runId, sequence: sequence++, ...row },
            error => error ? rejectReport(new Error('owned startup report failed')) : resolve());
        }));
      initialization = (async () => {
        const inputs = await step('source-load', () => loadPiNativeSources({ sourceFiles: message.sourceFiles, stateRoot: message.stateRoot, authorityRoot: message.authorityRoot }));
        if (closing) return;
        await step('preflight', () => preflightPiNative({ ...inputs, sourceFiles: message.sourceFiles, stateRoot: message.stateRoot,
          authorityRoot: message.authorityRoot, budgetRoot: message.budgetRoot, targetPaths: message.targetPaths }));
        if (closing) return;
        const plan = inputs.planAdmission.value;
        await step('authority-consumption', () => verifyNativeAuthorityConsumption({ authorityRoot: message.authorityRoot, plan, consumptionDigest: message.consumptionDigest }));
        if (closing) return;
        const { control, loginSecret } = await step('control-files', async () => {
          const allowedControl = [0, 1].slice(0, plan.restartAllowance + 1).map(i => `${basePath(message.stateRoot, plan, i)}.control.json`);
          if (!allowedControl.includes(message.controlPath) || message.loginPath !== message.controlPath.replace(/\.control\.json$/u, '.login.txt')) reject();
          const controlBytes = (await readPiPrivateFile(message.controlPath)).bytes;
          if (piHash(controlBytes) !== message.controlDigest) reject();
          const control = JSON.parse(controlBytes), loginSecret = (await readPiPrivateFile(message.loginPath, 256)).bytes.toString('utf8');
          if (!piKeys(control, ['schemaVersion', 'runId', 'activationPlanDigest', 'rootIdentity', 'chatPort', 'stopCapability'])
            || control.schemaVersion !== 'agentmo.pi-owned-control.v1' || control.runId !== runId || control.activationPlanDigest !== plan.installPlanDigest
            || control.chatPort !== plan.nativeBinding.chatPort || !isDeepStrictEqual(control.rootIdentity, plan.predecessor.rootIdentity)
            || !/^[a-f0-9]{64}$/u.test(control.stopCapability) || !/^[a-f0-9]{48}$/u.test(loginSecret)) reject();
          return { control, loginSecret };
        });
        if (closing) return;
        const { createPiSessionHost } = await import('./pi-session-host.js');
        const { startPiChatServer } = await import('./pi-chat-server.js');
        if (closing) return;
        const sdk = await step('sdk-import', async () => {
          const { loadPiSdk } = await import('./pi-sdk.js');
          return loadPiSdk({ descriptorAdmission: inputs.sourceAdmissions.targetDescriptor, targetPaths: message.targetPaths });
        });
        if (closing) return;
        const turnClient = { admit: input => call('admit', input), finish: input => call('finish', input),
          state: turnId => call('state', { turnId }), status: () => call('status', {}) };
        await step('session-prewarm', async () => {
          host = await createPiSessionHost({ stateRoot: message.stateRoot, binding: plan.nativeBinding, sdk, turnClient, approvedCases: plan.approvedCases });
        });
        if (closing) return;
        const port = plan.nativeBinding.chatPort, httpHost = `127.0.0.1:${port}`;
        await step('chat-listen', async () => {
          server = await startPiChatServer({ port, host: httpHost, origin: `http://${httpHost}`, sessionHost: host,
            loginSecret, stopCapability: control.stopCapability, onStop: () => call('stop', {}) });
        });
        if (closing) return;
        process.send({ type: 'ready', runId, agentId: plan.nativeBinding.agentId, chatPort: port });
      })();
      await initialization;
    })().catch(() => { void close(true); });
  });
  process.on('disconnect', () => { if (!closing) void close(true); });
  process.on('SIGINT', () => { void close(); }); process.on('SIGTERM', () => { void close(); });
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === '--pi-owned-child') {
  runOwnedPiChild().catch(() => { process.exitCode = 1; if (process.connected) process.disconnect(); });
}
