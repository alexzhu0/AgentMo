import { mkdir, lstat, realpath, readdir } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { admittedArtifactProvenance, loadAdmittedArtifact } from './artifact-admission.js';
import { consumeNativeAuthoritySet, verifyNativeAuthorityConsumption } from './native-chat-authority.js';
import { publishNativeChatFiles, writeNativeChatFile } from './native-chat-files.js';
import { admitPiPackageArchive, buildPiInstallPlan, piArchiveSnapshot, piPlanningSources, piBytes, piHash, piKeys,
  piIdentity, piReject, readPiPrivateFile, validatePiNativeBinding, PI_INSTALL_PATHS } from './pi-install-plan.js';

export const PI_INSTALL_RECEIPT_SCHEMA_VERSION = 'agentmo.pi-install-receipt.v1';
const receipts = new WeakSet();
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
export const isPiInstallReceiptAdmission = admission => receipts.has(admission);
const boundary = Object.freeze({ installed: true, runtimeVerified: false, nativeEntryVerified: false, domainCertified: false, productionApproved: false });

export function validatePiInstallReceipt(value) {
  try {
    if (!piKeys(value, ['schemaVersion', 'execution_profile', 'native_runtime', 'status', 'installPlanDigest', 'sourceBindings', 'archiveBinding',
      'nativeBinding', 'authorityConsumption', 'rootIdentity', 'files', 'directories', 'certificationBoundary'])
      || value.schemaVersion !== PI_INSTALL_RECEIPT_SCHEMA_VERSION || value.execution_profile !== 'native-chat' || value.native_runtime !== 'pi'
      || value.status !== 'complete' || !DIGEST.test(value.installPlanDigest) || !validatePiNativeBinding(value.nativeBinding)
      || !isDeepStrictEqual(value.certificationBoundary, boundary) || !DIGEST.test(value.authorityConsumption?.consumptionDigest)
      || value.authorityConsumption.installPlanDigest !== value.installPlanDigest
      || !piKeys(value.rootIdentity, ['device', 'inode', 'birthtimeNs'])
      || !Array.isArray(value.files) || !isDeepStrictEqual(value.files.map(f => f.relativePath), PI_INSTALL_PATHS)
      || value.files.some(f => !piKeys(f, ['relativePath', 'sha256', 'byteLength', 'identity']) || !DIGEST.test(f.sha256)
        || !Number.isSafeInteger(f.byteLength) || f.byteLength < 1 || !piKeys(f.identity, ['device', 'inode', 'birthtimeNs']))
      || !Array.isArray(value.directories) || !isDeepStrictEqual(value.directories.map(d => d.relativePath), ['attempts', 'browser', 'sessions', 'turns'])
      || value.directories.some(d => !piKeys(d, ['relativePath', 'identity']) || !piKeys(d.identity, ['device', 'inode', 'birthtimeNs']))) piReject();
    return { ok: true, errors: [] };
  } catch { return { ok: false, errors: ['Pi complete receipt requires exact installation facts.'] }; }
}

async function directory(root, expectedIdentity) {
  if (await realpath(root) !== root) piReject();
  const s = await lstat(root, { bigint: true });
  if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== BigInt(process.getuid()) || (s.mode & 0o777n) !== 0o700n) piReject();
  const actual = piIdentity(s);
  if (expectedIdentity && !isDeepStrictEqual(actual, expectedIdentity)) piReject();
  return actual;
}

export async function verifyPiInstallation({ receipt, plan, stateRoot, authorityRoot, sourceAdmissions }) {
  if (!validatePiInstallReceipt(receipt).ok || receipt.installPlanDigest !== plan.installPlanDigest || plan.lifecycle !== 'install'
    || piHash(stateRoot) !== plan.nativeBinding.stateRootDigest || !isDeepStrictEqual(receipt.nativeBinding, plan.nativeBinding)
    || !isDeepStrictEqual(receipt.sourceBindings, plan.sourceBindings) || !isDeepStrictEqual(receipt.archiveBinding, plan.archiveBinding)) piReject();
  const { sources, archive } = piPlanningSources(sourceAdmissions);
  if (!isDeepStrictEqual(sources, plan.sourceBindings) || !isDeepStrictEqual(archive.binding, plan.archiveBinding)) piReject();
  await verifyNativeAuthorityConsumption({ authorityRoot, plan, consumptionDigest: receipt.authorityConsumption.consumptionDigest });
  await directory(stateRoot, receipt.rootIdentity);
  const allowed = ['agent.json', 'attempts', 'browser', 'install-receipt.json', 'installation.complete.json', 'installation.started.json', 'runtime-binding.json', 'sessions', 'system.md', 'turns'];
  if ((await readdir(stateRoot)).some(name => !allowed.includes(name))) piReject();
  if (!isDeepStrictEqual((await readdir(path.join(stateRoot, 'browser'))).sort(), ['client.js', 'index.html', 'style.css'])) piReject();
  for (const row of receipt.files) {
    const observed = await readPiPrivateFile(path.join(stateRoot, row.relativePath));
    const op = plan.operations.find(op => op.relativePath === row.relativePath);
    if (!isDeepStrictEqual(row.identity, observed.identity) || piHash(observed.bytes) !== row.sha256
      || observed.bytes.length !== row.byteLength || row.sha256 !== op.sha256 || row.byteLength !== op.byteLength) piReject();
  }
  for (const row of receipt.directories) await directory(path.join(stateRoot, row.relativePath), row.identity);
  const started = JSON.parse((await readPiPrivateFile(path.join(stateRoot, 'installation.started.json'))).bytes);
  const completed = JSON.parse((await readPiPrivateFile(path.join(stateRoot, 'installation.complete.json'))).bytes);
  if (!isDeepStrictEqual(started, { installPlanDigest: plan.installPlanDigest, consumptionDigest: receipt.authorityConsumption.consumptionDigest })
    || !isDeepStrictEqual(completed, { installPlanDigest: plan.installPlanDigest, receiptDigest: piHash(piBytes(receipt)), rootIdentity: receipt.rootIdentity })) piReject();
  return receipt;
}

export async function applyPiInstall(options) {
  if (!piKeys(options, ['planAdmission', 'sourceAdmissions', 'ordinaryApproval', 'sensitiveDecisions', 'conflictApproval', 'stateRoot', 'authorityRoot'])) piReject();
  const { planAdmission, sourceAdmissions, stateRoot, authorityRoot, ordinaryApproval, sensitiveDecisions, conflictApproval } = options;
  admittedArtifactProvenance(planAdmission, { subject: 'pi-install-plan', value: planAdmission.value });
  const plan = planAdmission.value;
  piPlanningSources(sourceAdmissions);
  const archive = await admitPiPackageArchive({ filePath: sourceAdmissions.archive.filePath, expectedDigest: sourceAdmissions.archive.expectedDigest });
  const freshSources = { ...sourceAdmissions, archive };
  const expected = buildPiInstallPlan({ lifecycle: 'install', admissions: freshSources, stateRoot, authorityRootBinding: plan.authorityRootBinding,
    budgetReference: plan.nativeBinding.budgetReference, ports: { chat: plan.nativeBinding.chatPort, proxy: plan.nativeBinding.proxyPort }, predecessor: null });
  if (!isDeepStrictEqual(expected, plan)) piReject();
  const consumption = await consumeNativeAuthoritySet({ authorityRoot, stateRoot, plan, ordinaryApproval, sensitiveDecisions, conflictApproval });
  try {
    await publishNativeChatFiles({ root: stateRoot, files: [{ relativePath: 'installation.started.json', mode: 0o600,
      bytes: piBytes({ installPlanDigest: plan.installPlanDigest, consumptionDigest: consumption.consumptionDigest }) }] });
    for (const name of plan.directories) await mkdir(path.join(stateRoot, name), { mode: 0o700 });
    const files = [];
    for (const file of piArchiveSnapshot(archive).files) {
      await writeNativeChatFile({ filePath: path.join(stateRoot, file.relativePath), bytes: file.bytes });
      const observed = await readPiPrivateFile(path.join(stateRoot, file.relativePath));
      if (piHash(observed.bytes) !== file.sha256) piReject();
      files.push({ relativePath: file.relativePath, sha256: file.sha256, byteLength: file.byteLength, identity: observed.identity });
    }
    const receipt = { schemaVersion: PI_INSTALL_RECEIPT_SCHEMA_VERSION, execution_profile: 'native-chat', native_runtime: 'pi', status: 'complete',
      installPlanDigest: plan.installPlanDigest, sourceBindings: plan.sourceBindings, archiveBinding: plan.archiveBinding,
      nativeBinding: plan.nativeBinding, authorityConsumption: consumption, rootIdentity: await directory(stateRoot), files,
      directories: await Promise.all(plan.directories.map(async relativePath => ({ relativePath, identity: await directory(path.join(stateRoot, relativePath)) }))),
      certificationBoundary: { ...boundary } };
    if (!validatePiInstallReceipt(receipt).ok) piReject();
    await writeNativeChatFile({ filePath: path.join(stateRoot, 'install-receipt.json'), bytes: piBytes(receipt) });
    await writeNativeChatFile({ filePath: path.join(stateRoot, 'installation.complete.json'),
      bytes: piBytes({ installPlanDigest: plan.installPlanDigest, receiptDigest: piHash(piBytes(receipt)), rootIdentity: receipt.rootIdentity }) });
    await verifyPiInstallation({ receipt, plan, stateRoot, authorityRoot, sourceAdmissions: freshSources });
    return receipt;
  } catch {
    const incomplete = { schemaVersion: 'agentmo.pi-install-incomplete.v1', status: 'incomplete', installPlanDigest: plan.installPlanDigest,
      consumptionDigest: consumption.consumptionDigest, recoveryRequired: true, retryAllowed: false };
    await writeNativeChatFile({ filePath: path.join(stateRoot, 'installation.incomplete.json'), bytes: piBytes(incomplete) }).catch(() => {});
    return incomplete;
  }
}

export async function admitPiInstallReceipt({ filePath, expectedDigest, admissions, stateRoot, authorityRoot }) {
  if (!piKeys(admissions, ['blueprint', 'buildContract', 'planApproval', 'targetDescriptor', 'targetCarrierAdmission', 'archive', 'plan'])
    || filePath !== path.join(stateRoot, 'install-receipt.json')) piReject();
  const { plan, ...sourceAdmissions } = admissions;
  admittedArtifactProvenance(plan, { subject: 'pi-install-plan', value: plan.value });
  await readPiPrivateFile(filePath);
  const receipt = await loadAdmittedArtifact({ filePath, expectedDigest, subject: 'pi-install-receipt' });
  await verifyPiInstallation({ receipt: receipt.value, plan: plan.value, stateRoot, authorityRoot, sourceAdmissions });
  receipts.add(receipt);
  return receipt;
}
