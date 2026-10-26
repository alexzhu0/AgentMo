import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { admittedArtifactProvenance } from './artifact-admission.js';
import { admitPackageArchiveManifest } from './package-archive.js';
import { validateBuildContract } from './build-contract.js';
import { validatePiTargetCarrierAdmission } from './pi-target-admission.js';
import { validatePlanApproval } from './plan-approval.js';
import { validateNativeAuthorityBinding } from './native-chat-authority.js';
import { assertNativeChatAbsentRoot } from './native-chat-files.js';
import { assertPersistable, serializePersistableJson } from './persistability.js';
import { isPiInstallReceiptAdmission } from './pi-install.js';
import { buildPiPackageProjection } from './targets/pi-package.js';
import { selectPackageCarriers } from './package-carriers.js';

export const PI_INSTALL_PLAN_SCHEMA_VERSION = 'agentmo.pi-install-plan.v1';
export const piHash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
export const piBytes = value => Buffer.from(serializePersistableJson(value, { subject: 'pi-lifecycle' }));
export const piKeys = (v, keys) => v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
export const piReject = () => { throw Object.assign(new Error('Pi lifecycle binding rejected.'), { code: 'AGENTMO_PI_LIFECYCLE_REJECTED' }); };
export const piIdentity = stat => ({ device: String(stat.dev), inode: String(stat.ino), birthtimeNs: String(stat.birthtimeNs) });
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const archives = new WeakMap();
export const PI_INSTALL_PATHS = Object.freeze(['agent.json', 'browser/client.js', 'browser/index.html', 'browser/style.css', 'runtime-binding.json', 'system.md']);
export const PI_STATE_DIRECTORIES = Object.freeze(['attempts', 'browser', 'sessions', 'turns']);
export const PI_RUNTIME_WRITES = Object.freeze(['sessions/<uuid>/registration.json', 'sessions/<uuid>/sdk-session.json',
  'sessions/<uuid>/sdk-file.json', 'sessions/<uuid>/*_<uuid>.jsonl', 'sessions/<uuid>/auth.json.lock',
  'turns/<uuid>.<state>.json', 'attempts/pi-*']);
const boundary = Object.freeze({ planOnly: true, installed: false, runtimeVerified: false, domainCertified: false, productionApproved: false });

export async function readPiPrivateFile(filePath, limit = 1024 * 1024, { privateMode = true } = {}) {
  let handle;
  try {
    if (!path.isAbsolute(filePath) || path.resolve(filePath) !== filePath || filePath.includes('\0')
      || await realpath(path.dirname(filePath)) !== path.dirname(filePath)) piReject();
    const before = await lstat(filePath, { bigint: true });
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = await handle.stat({ bigint: true });
    const valid = s => s.isFile() && !s.isSymbolicLink() && s.nlink === 1n && s.uid === BigInt(process.getuid())
      && (!privateMode || (s.mode & 0o777n) === 0o600n) && s.size <= BigInt(limit);
    if (!valid(before) || !valid(opened)) piReject();
    const bytes = Buffer.alloc(limit + 1); let size = 0;
    while (size <= limit) { const { bytesRead } = await handle.read(bytes, size, bytes.length - size, size); if (!bytesRead) break; size += bytesRead; }
    const after = await handle.stat({ bigint: true }), current = await lstat(filePath, { bigint: true });
    if (size > limit || [opened, after, current].some(s => !valid(s)
      || ['dev', 'ino', 'mode', 'size', 'mtimeNs', 'ctimeNs'].some(k => s[k] !== before[k]))) piReject();
    return { bytes: bytes.subarray(0, size), identity: piIdentity(current) };
  } finally { await handle?.close(); }
}

export async function admitPiPackageArchive({ filePath, expectedDigest }) {
  const observed = await readPiPrivateFile(filePath, 8 * 1024 * 1024);
  if (piHash(observed.bytes) !== expectedDigest) piReject();
  const envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(observed.bytes));
  const snapshot = await admitPackageArchiveManifest({ archivePath: filePath, expectedArchiveDigest: expectedDigest });
  if (snapshot.manifest.value.native_runtime !== 'pi' || snapshot.manifest.value.execution_profile !== 'native-chat') piReject();
  const admission = Object.freeze({ filePath, expectedDigest, manifest: snapshot.manifest });
  const files = envelope.members.filter(m => m.relativePath.startsWith('projections/pi/')).map(m => ({
    relativePath: m.relativePath.slice('projections/pi/'.length), mode: 0o600,
    byteLength: m.byteLength, sha256: m.sha256, bytes: Buffer.from(m.contentBase64, 'base64'),
  }));
  if (!isDeepStrictEqual(files.map(f => f.relativePath), PI_INSTALL_PATHS)) piReject();
  archives.set(admission, { files, binding: { archiveDigest: expectedDigest, manifestDigest: snapshot.manifestDigest,
    inventoryDigest: snapshot.inventoryDigest }, identity: observed.identity });
  return admission;
}

export function piArchiveSnapshot(admission) {
  const snapshot = archives.get(admission); if (!snapshot) piReject();
  return { ...snapshot, files: snapshot.files.map(f => ({ ...f, bytes: Buffer.from(f.bytes) })) };
}

export function piPlanningSources(admissions) {
  if (!piKeys(admissions, ['blueprint', 'buildContract', 'planApproval', 'targetDescriptor', 'targetCarrierAdmission', 'archive'])) piReject();
  const sourceNames = { blueprint: 'blueprint', buildContract: 'build-contract', planApproval: 'plan-approval',
    targetDescriptor: 'pi-target-descriptor', targetCarrierAdmission: 'pi-target-carrier-admission' };
  const sources = Object.fromEntries(Object.entries(sourceNames).map(([k, subject]) => [k,
    admittedArtifactProvenance(admissions[k], { subject, value: admissions[k]?.value })]));
  const archive = piArchiveSnapshot(admissions.archive), manifest = admissions.archive.manifest.value;
  const blueprint = admissions.blueprint.value, contract = admissions.buildContract.value;
  if (blueprint.native_runtime !== 'pi' || contract.native_runtime !== 'pi' || !validateBuildContract(contract).ok
    || !validatePlanApproval(admissions.planApproval.value, { blueprint, buildContract: contract,
      sources: { blueprint: sources.blueprint, buildContract: sources.buildContract } }).ok
    || !validatePiTargetCarrierAdmission(admissions.targetCarrierAdmission.value, { targetDescriptor: admissions.targetDescriptor.value,
      sources: Object.fromEntries(['blueprint', 'buildContract', 'planApproval', 'targetDescriptor'].map(k => [k, sources[k]])) }).ok
    || contract.bindings.blueprint.digest !== sources.blueprint.digest
    || !isDeepStrictEqual(contract.targetDescriptor, admissions.targetDescriptor.value)
    || ['blueprint', 'buildContract', 'planApproval'].some(k => manifest.sourceBindings[`${k}Digest`] !== sources[k].digest)
    || ['designPlan', 'discoveryApproval', 'decisionLedger'].some(k => manifest.sourceBindings[`${k}Digest`] !== contract.bindings[k].digest)
    || manifest.targetCompatibility[0].sdkClosureDigest !== admissions.targetDescriptor.value.closure.sdkClosureDigest) piReject();
  const projection = buildPiPackageProjection({ blueprint, buildContract: contract,
    carrierSelection: selectPackageCarriers(contract), targetAdmission: admissions.targetCarrierAdmission.value });
  if (!isDeepStrictEqual(archive.files.map(({ relativePath, bytes }) => ({ relativePath, bytes })),
    projection.map(({ relativePath, bytes }) => ({ relativePath: relativePath.slice('projections/pi/'.length), bytes })))) piReject();
  return { sources, archive, agentId: blueprint.agent_id, target: admissions.targetCarrierAdmission.value.target };
}

export function validatePiNativeBinding(v) {
  return piKeys(v, ['native_runtime', 'agentId', 'stateRootDigest', 'modelProfile', 'chatPort', 'proxyPort', 'budgetReference', 'targetDescriptorDigest', 'runtimeSourceDigest', 'packageArchiveDigest', 'buildContractDigest'])
    && v.native_runtime === 'pi' && /^[a-z][a-z0-9-]{0,63}$/u.test(v.agentId ?? '') && v.modelProfile === 'minimax-m3-cn-v1'
    && ['stateRootDigest', 'targetDescriptorDigest', 'runtimeSourceDigest', 'packageArchiveDigest', 'buildContractDigest'].every(k => DIGEST.test(v[k]))
    && [v.chatPort, v.proxyPort].every(p => Number.isInteger(p) && p >= 1024 && p <= 65535) && v.chatPort !== v.proxyPort
    && piKeys(v.budgetReference, ['version', 'rootDigest', 'policyDigest', 'inventoryDigest']) && v.budgetReference.version === 1
    && ['rootDigest', 'policyDigest', 'inventoryDigest'].every(k => DIGEST.test(v.budgetReference[k]));
}

export function validatePiApprovedCases(cases) {
  return Array.isArray(cases) && cases.length <= 19 && new Set(cases.map(c => c?.caseId)).size === cases.length
    && cases.every(c => piKeys(c, ['caseId', 'sessionId', 'inputDigest']) && /^[a-z][a-z0-9-]{0,63}$/u.test(c.caseId)
      && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(c.sessionId) && DIGEST.test(c.inputDigest));
}

export function buildPiInstallPlan(options) {
  if (!piKeys(options, ['lifecycle', 'admissions', 'stateRoot', 'authorityRootBinding', 'budgetReference', 'ports', 'predecessor',
    ...['approvedCases', 'restartAllowance', 'activationId'].filter(k => Object.hasOwn(options, k))])
    || !['install', 'activate'].includes(options.lifecycle) || !piKeys(options.ports, ['chat', 'proxy'])
    || !path.isAbsolute(options.stateRoot) || path.resolve(options.stateRoot) !== options.stateRoot
    || options.stateRoot === path.parse(options.stateRoot).root || options.stateRoot.includes('\0')
    || !validateNativeAuthorityBinding(options.authorityRootBinding)) piReject();
  const { sources, archive, agentId, target } = piPlanningSources(options.admissions);
  const activationId = options.activationId ?? null;
  if (options.lifecycle === 'install' ? activationId !== null : !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(activationId)) piReject();
  const approvedCases = structuredClone(options.approvedCases ?? []), restartAllowance = options.restartAllowance ?? 0;
  if (!validatePiApprovedCases(approvedCases) || ![0, 1].includes(restartAllowance)
    || options.lifecycle === 'install' && (approvedCases.length || restartAllowance) || !approvedCases.length && restartAllowance) piReject();
  let predecessor = null;
  if (options.lifecycle === 'install') { if (options.predecessor !== null) piReject(); }
  else {
    if (!isPiInstallReceiptAdmission(options.predecessor)) piReject();
    const r = options.predecessor.value;
    if (r.nativeBinding.stateRootDigest !== piHash(options.stateRoot)
      || !isDeepStrictEqual(r.sourceBindings, sources) || !isDeepStrictEqual(r.archiveBinding, archive.binding)
      || !isDeepStrictEqual(r.nativeBinding.budgetReference, options.budgetReference)
      || r.nativeBinding.chatPort !== options.ports.chat || r.nativeBinding.proxyPort !== options.ports.proxy) piReject();
    predecessor = { receiptDigest: options.predecessor.digest, installPlanDigest: r.installPlanDigest, rootIdentity: r.rootIdentity };
  }
  const value = { schemaVersion: PI_INSTALL_PLAN_SCHEMA_VERSION, execution_profile: 'native-chat', native_runtime: 'pi',
    lifecycle: options.lifecycle, sourceBindings: sources, archiveBinding: archive.binding, authorityRootBinding: options.authorityRootBinding,
    nativeBinding: { native_runtime: 'pi', agentId, stateRootDigest: piHash(options.stateRoot), modelProfile: 'minimax-m3-cn-v1', chatPort: options.ports.chat,
      proxyPort: options.ports.proxy, budgetReference: options.budgetReference, targetDescriptorDigest: sources.targetDescriptor.digest,
      runtimeSourceDigest: target.runtimeSourceDigest, packageArchiveDigest: archive.binding.archiveDigest, buildContractDigest: sources.buildContract.digest },
    operations: options.lifecycle === 'install' ? archive.files.map(({ bytes, ...file }) => ({ kind: 'write', ...file })) : [],
    directories: [...PI_STATE_DIRECTORIES], durableFiles: ['installation.started.json', 'installation.complete.json', 'installation.incomplete.json', 'install-receipt.json'],
    sensitiveActions: options.lifecycle === 'install' ? [] : [...(approvedCases.length ? ['load-minimax-key-in-memory'] : []), 'start-budget-proxy', 'start-pi-child'].map(id => ({ id })),
    conflicts: [], predecessor, activationId, approvedCases, restartAllowance,
    runtimeWrites: options.lifecycle === 'activate' ? [...PI_RUNTIME_WRITES] : [], certificationBoundary: { ...boundary } };
  value.installPlanDigest = piHash(piBytes(value));
  if (!validatePiInstallPlan(value).ok) piReject();
  return value;
}

export function validatePiInstallPlan(v) {
  try {
    if (!piKeys(v, ['schemaVersion', 'execution_profile', 'native_runtime', 'lifecycle', 'sourceBindings', 'archiveBinding', 'authorityRootBinding',
      'nativeBinding', 'operations', 'directories', 'durableFiles', 'sensitiveActions', 'conflicts', 'predecessor', 'activationId', 'approvedCases', 'restartAllowance', 'runtimeWrites', 'certificationBoundary', 'installPlanDigest'])
      || v.schemaVersion !== PI_INSTALL_PLAN_SCHEMA_VERSION || v.execution_profile !== 'native-chat' || v.native_runtime !== 'pi'
      || !['install', 'activate'].includes(v.lifecycle) || !validatePiNativeBinding(v.nativeBinding)
      || !validateNativeAuthorityBinding(v.authorityRootBinding) || v.authorityRootBinding.rootDigest === v.nativeBinding.stateRootDigest
      || !piKeys(v.archiveBinding, ['archiveDigest', 'manifestDigest', 'inventoryDigest']) || !Object.values(v.archiveBinding).every(d => DIGEST.test(d))
      || !piKeys(v.sourceBindings, ['blueprint', 'buildContract', 'planApproval', 'targetDescriptor', 'targetCarrierAdmission'])
      || Object.entries(v.sourceBindings).some(([k, p]) => !piKeys(p, ['identity', 'subject', 'digest']) || !DIGEST.test(p.digest)
        || p.subject !== { blueprint: 'blueprint', buildContract: 'build-contract', planApproval: 'plan-approval', targetDescriptor: 'pi-target-descriptor', targetCarrierAdmission: 'pi-target-carrier-admission' }[k]
        || p.identity !== { blueprint: '0.1', buildContract: 'agentmo.build-contract.v1', planApproval: 'agentmo.plan-approval.v1', targetDescriptor: 'agentmo.pi-target-descriptor.v1', targetCarrierAdmission: 'agentmo.pi-target-carrier-admission.v1' }[k])
      || v.nativeBinding.targetDescriptorDigest !== v.sourceBindings.targetDescriptor.digest
      || v.nativeBinding.buildContractDigest !== v.sourceBindings.buildContract.digest
      || v.nativeBinding.packageArchiveDigest !== v.archiveBinding.archiveDigest
      || !isDeepStrictEqual(v.directories, PI_STATE_DIRECTORIES)
      || !isDeepStrictEqual(v.durableFiles, ['installation.started.json', 'installation.complete.json', 'installation.incomplete.json', 'install-receipt.json'])
      || !isDeepStrictEqual(v.conflicts, []) || !isDeepStrictEqual(v.certificationBoundary, boundary)) piReject();
    const install = v.lifecycle === 'install';
    if (install ? v.activationId !== null : !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(v.activationId)) piReject();
    if (!validatePiApprovedCases(v.approvedCases) || ![0, 1].includes(v.restartAllowance)
      || install && (v.approvedCases.length || v.restartAllowance) || !v.approvedCases.length && v.restartAllowance
      || !isDeepStrictEqual(v.runtimeWrites, install ? [] : PI_RUNTIME_WRITES)) piReject();
    if (!Array.isArray(v.operations) || !isDeepStrictEqual(v.operations.map(op => op.relativePath), install ? PI_INSTALL_PATHS : [])
      || v.operations.some(op => !piKeys(op, ['kind', 'relativePath', 'mode', 'byteLength', 'sha256']) || op.kind !== 'write'
        || op.mode !== 0o600 || !DIGEST.test(op.sha256) || !Number.isSafeInteger(op.byteLength) || op.byteLength < 1 || op.byteLength > 1024 * 1024)
      || !isDeepStrictEqual(v.sensitiveActions, install ? [] : [...(v.approvedCases.length ? ['load-minimax-key-in-memory'] : []), 'start-budget-proxy', 'start-pi-child'].map(id => ({ id })))
      || (install ? v.predecessor !== null : !piKeys(v.predecessor, ['receiptDigest', 'installPlanDigest', 'rootIdentity'])
        || !DIGEST.test(v.predecessor.receiptDigest) || !DIGEST.test(v.predecessor.installPlanDigest)
        || !piKeys(v.predecessor.rootIdentity, ['device', 'inode', 'birthtimeNs'])
        || !Object.values(v.predecessor.rootIdentity).every(n => /^[0-9]+$/u.test(n)))) piReject();
    const { installPlanDigest, ...body } = v;
    if (piHash(piBytes(body)) !== installPlanDigest) piReject();
    assertPersistable(v, { subject: 'pi-install-plan' });
    return { ok: true, errors: [] };
  } catch { return { ok: false, errors: ['Exact Pi lifecycle plan required.'] }; }
}

export async function verifyPiPlanRoot({ plan, stateRoot }) {
  if (!validatePiInstallPlan(plan).ok || piHash(stateRoot) !== plan.nativeBinding.stateRootDigest) piReject();
  if (plan.lifecycle === 'install') return assertNativeChatAbsentRoot(stateRoot);
  if (await realpath(stateRoot) !== stateRoot) piReject();
  const stat = await lstat(stateRoot, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== BigInt(process.getuid()) || (stat.mode & 0o777n) !== 0o700n
    || !isDeepStrictEqual(piIdentity(stat), plan.predecessor.rootIdentity)) piReject();
}
