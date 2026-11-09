import path from 'node:path';
import { mkdir, readdir, lstat, realpath } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { loadAdmittedArtifact } from './artifact-admission.js';
import { loadPiInstalledSources, startPiNative } from './pi-native-runtime.js';
import { buildPiInstallPlan, piHash, piBytes, piKeys, piIdentity, readPiPrivateFile } from './pi-install-plan.js';
import { buildPiTargetDescriptor } from './pi-target-descriptor.js';
import { observeNativeAuthorityStore } from './native-chat-authority.js';
import { courseBudgetSummary, courseBudgetReference } from './course-wiki-budget.js';
import { buildPiInstallApproval, buildPiSensitiveActionDecision, buildPiConflictApproval } from './pi-install-approval.js';
import { writeNativeChatFile } from './native-chat-files.js';
import { connectPiCli } from './pi-cli-client.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const previews = new WeakMap();
const refuse = () => { throw Object.assign(new Error('Pi CLI scope rejected.'), { code: 'AGENTMO_PI_CLI_REJECTED' }); };
const absolute = value => typeof value === 'string' && path.isAbsolute(value) && path.resolve(value) === value && !value.includes('\0');
const freeze = value => { if (value && typeof value === 'object') { for (const v of Object.values(value)) freeze(v); Object.freeze(value); } return value; };

export async function listPiCliSessions({ installed }) {
  const binding = installed.sourceAdmissions.installReceipt.value.nativeBinding;
  const rootIdentity = installed.sourceAdmissions.installReceipt.value.rootIdentity;
  const base = path.join(installed.stateRoot, 'sessions'), rows = [];
  if (await realpath(base) !== base) refuse();
  for (const id of await readdir(base)) {
    if (!UUID.test(id)) refuse();
    const directory = path.join(base, id), stat = await lstat(directory, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== BigInt(process.getuid()) || (stat.mode & 0o777n) !== 0o700n) refuse();
    const value = JSON.parse((await readPiPrivateFile(path.join(directory, 'registration.json'))).bytes);
    if (!piKeys(value, ['schemaVersion', 'id', 'createdAt', 'bindingDigest', 'rootIdentity', 'directoryIdentity'])
      || value.schemaVersion !== 'agentmo.pi-session-registration.v1' || value.id !== id || !Number.isFinite(Date.parse(value.createdAt))
      || value.bindingDigest !== piHash(piBytes(binding)) || !isDeepStrictEqual(value.rootIdentity, rootIdentity)
      || !isDeepStrictEqual(value.directoryIdentity, piIdentity(stat))) refuse();
    rows.push({ id, createdAt: value.createdAt });
  }
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

async function snapshot(input) {
  const sourceFiles = structuredClone(input.sourceFiles), targetPaths = { ...input.targetPaths };
  for (const p of [input.stateRoot, input.authorityRoot, input.budgetRoot, ...Object.values(targetPaths)]) if (!absolute(p)) refuse();
  const { sourceAdmissions } = await loadPiInstalledSources({ sourceFiles, stateRoot: input.stateRoot, authorityRoot: input.authorityRoot });
  const installed = { sourceFiles, sourceAdmissions, targetPaths, stateRoot: input.stateRoot, authorityRoot: input.authorityRoot, budgetRoot: input.budgetRoot };
  if (!isDeepStrictEqual(await buildPiTargetDescriptor(targetPaths), sourceAdmissions.targetDescriptor.value)) refuse();
  const budgetReference = await courseBudgetReference({ root: installed.budgetRoot });
  const budget = await courseBudgetSummary({ root: installed.budgetRoot, budgetReference });
  const journalDigest = piHash((await readPiPrivateFile(path.join(installed.authorityRoot, 'consumption.jsonl'), 4 * 1024 * 1024)).bytes);
  const authorityRootBinding = await observeNativeAuthorityStore({ authorityRoot: installed.authorityRoot,
    previousBinding: sourceAdmissions.installPlan.value.authorityRootBinding, expectedJournalDigest: journalDigest });
  return { installed, budgetReference, budget, journalDigest, authorityRootBinding };
}
function planFor(state, { kind, sessionId, text, ports, activationId }) {
  const source = state.installed.sourceAdmissions;
  const admissions = Object.fromEntries(['blueprint', 'buildContract', 'planApproval', 'targetDescriptor', 'targetCarrierAdmission', 'archive'].map(k => [k, source[k]]));
  return buildPiInstallPlan({ lifecycle: 'activate', admissions, stateRoot: state.installed.stateRoot,
    authorityRootBinding: state.authorityRootBinding, budgetReference: state.budgetReference, ports,
    predecessor: source.installReceipt, activationId, restartAllowance: 0,
    approvedCases: kind === 'turn' ? [{ caseId: 'cli-turn', sessionId, inputDigest: piHash(text) }] : [] });
}

export async function preparePiCliRequest({ installed, kind, sessionId = null, text = null, ports, runtimeEnvFile }) {
  if (!['turn', 'create-session'].includes(kind) || !piKeys(ports, ['chat', 'proxy'])
    || kind === 'turn' && (!UUID.test(sessionId) || typeof text !== 'string' || !text.trim() || !text.isWellFormed()
      || [...text].length > 8000 || !absolute(runtimeEnvFile))
    || kind === 'create-session' && (runtimeEnvFile !== undefined || sessionId !== null || text !== null)) refuse();
  const state = await snapshot(installed);
  if (kind === 'turn' && (!(await listPiCliSessions({ installed: state.installed })).some(s => s.id === sessionId) || state.budget.remainingFen < 31)) refuse();
  const parameters = { kind, sessionId, text, ports: { ...ports }, activationId: randomUUID(), runtimeEnvFile };
  const plan = planFor(state, parameters), expiresAt = Date.now() + 300000;
  const view = { agentId: plan.nativeBinding.agentId, packageArchiveDigest: plan.nativeBinding.packageArchiveDigest,
    activationId: plan.activationId, installPlanDigest: plan.installPlanDigest, sessionId, inputDigest: text === null ? null : piHash(text),
    inputCodePoints: text === null ? 0 : [...text].length, maximumNewReservedFen: kind === 'turn' ? 31 : 0,
    cumulativeReservedFen: state.budget.totalReservedFen, expiresAt: new Date(expiresAt).toISOString(),
    effects: { sdk: '1.2.0', ports: { ...ports }, createSession: kind === 'create-session',
      modelRequests: kind === 'turn' ? 1 : 0, runtimeEnvFile: runtimeEnvFile ?? null, stopOwnedServices: true } };
  const previewDigest = piHash(JSON.stringify(view));
  const preview = freeze({ ...view, previewDigest, confirmationCode: `${randomBytes(6).toString('hex')}-${previewDigest.slice(-12)}` });
  previews.set(preview, { state, parameters, plan, expiresAt }); return preview;
}

export async function runApprovedPiCliRequest({ preview, confirmation, signal }) {
  const saved = previews.get(preview); previews.delete(preview);
  const result = { status: 'declined', sessionId: saved?.parameters.sessionId ?? null, newReservedFen: 0, cleanup: { status: 'not-started' } };
  if (!saved || confirmation !== preview.confirmationCode || Date.now() >= saved.expiresAt || signal?.aborted) return result;
  const { state, parameters, plan } = saved;
  let live, client, started = false;
  try {
    const fresh = await snapshot(state.installed);
    if (!isDeepStrictEqual(fresh.budget, state.budget) || fresh.journalDigest !== state.journalDigest
      || !isDeepStrictEqual(planFor(fresh, parameters), plan) || signal?.aborted || Date.now() >= saved.expiresAt) refuse();
    if (parameters.kind === 'turn' && !(await listPiCliSessions({ installed: fresh.installed })).some(s => s.id === parameters.sessionId)) refuse();
    const attempt = path.join(state.installed.stateRoot, 'attempts', `cli-${parameters.activationId}`);
    await mkdir(attempt, { mode: 0o700 });
    const save = async (name, value) => {
      const filePath = path.join(attempt, `${name}.json`), bytes = piBytes(value);
      await writeNativeChatFile({ filePath, bytes }); return { filePath, expectedDigest: piHash(bytes) };
    };
    const activationPlan = await save('plan', plan);
    const planAdmission = await loadAdmittedArtifact({ ...activationPlan, subject: 'pi-install-plan' });
    const common = { plan, decision: 'approve', issuedAt: new Date().toISOString(), expiresAt: new Date(saved.expiresAt).toISOString() };
    const ordinaryApproval = buildPiInstallApproval({ ...common, useNonce: randomUUID() });
    const conflictApproval = buildPiConflictApproval({ ...common, conflicts: [], useNonce: randomUUID() });
    const sensitiveDecisions = plan.sensitiveActions.map(action => buildPiSensitiveActionDecision({ ...common, action, useNonce: randomUUID() }));
    await save('ordinary', ordinaryApproval); await save('conflicts', conflictApproval);
    for (let i = 0; i < sensitiveDecisions.length; i++) await save(`sensitive-${i}`, sensitiveDecisions[i]);
    started = true;
    live = await startPiNative({ ...state.installed, planAdmission, sourceFiles: { ...state.installed.sourceFiles, activationPlan },
      ordinaryApproval, conflictApproval, sensitiveDecisions, approvedCases: plan.approvedCases,
      ...(parameters.kind === 'turn' ? { runtimeEnvFile: parameters.runtimeEnvFile } : {}), ...(signal ? { signal } : {}) });
    client = await connectPiCli({ accessFile: live.entry.accessFile, port: parameters.ports.chat, mode: parameters.kind, caseSpec: plan.approvedCases[0] ?? null });
    if (signal?.aborted) refuse();
    if (parameters.kind === 'create-session') {
      const created = await client.createSession(); result.status = 'created'; result.sessionId = created.id;
    } else {
      Object.assign(result, await client.submit({ ...plan.approvedCases[0], turnId: randomUUID(), text: parameters.text }));
    }
  } catch (error) { result.status = 'failed'; result.failureCode = /^COURSE_WIKI_[A-Z_]+$/u.test(error?.code ?? '') ? error.code : 'AGENTMO_PI_CLI_REQUEST_FAILED'; }
  finally {
    await client?.close().catch(() => {});
    if (live) {
      const stop = await live.stop().catch(() => null);
      result.cleanup = { status: stop?.status === 'stopped' && stop.ownChildExited === true ? 'stopped' : 'failed' };
      if (result.cleanup.status !== 'stopped') { result.status = 'failed'; result.failureCode ??= 'AGENTMO_PI_CLI_CLEANUP_FAILED'; }
    } else if (started) result.cleanup = { status: 'failed' };
    try {
      const after = await courseBudgetSummary({ root: state.installed.budgetRoot, budgetReference: state.budgetReference });
      result.newReservedFen = after.totalReservedFen - state.budget.totalReservedFen;
      if (result.newReservedFen < 0 || result.newReservedFen > preview.maximumNewReservedFen) refuse();
    } catch { result.status = 'failed'; result.newReservedFen = null; result.failureCode = 'AGENTMO_PI_CLI_ACCOUNTING_UNAVAILABLE'; }
  }
  return result;
}
