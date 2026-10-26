import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { admittedArtifactProvenance } from './artifact-admission.js';
import { validateBuildContract } from './build-contract.js';
import { validateBlueprint } from './blueprint.js';
import { buildPiTargetDescriptor, validatePiTargetDescriptor, isPiNodeSupported } from './pi-target-descriptor.js';
import { validatePlanApproval } from './plan-approval.js';
import { assertPersistable, serializePersistableJson } from './persistability.js';
import { writeNativeChatFile } from './native-chat-files.js';

export const PI_TARGET_CARRIER_ADMISSION_SCHEMA_VERSION = 'agentmo.pi-target-carrier-admission.v1';
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const boundary = Object.freeze({ carrierAdmissionOnly: true, installed: false, runtime: false, domain: false, production: false });
const candidates = new WeakSet();
const keys = (v, names) => v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === names.length && names.every(k => Object.hasOwn(v, k));
const reject = () => { throw Object.assign(new Error('Pi carrier authority rejected.'), { code: 'AGENTMO_PI_CARRIER_REJECTED' }); };

function target(descriptor, descriptorDigest) {
  return { id: 'pi', version: descriptor.target.version, nodeRange: descriptor.target.nodeRange,
    nodeVersion: descriptor.target.nodeVersion, descriptorDigest,
    displayRevision: descriptor.closure.sdkClosureDigest.slice(7, 19), ...descriptor.closure };
}

export function validatePiTargetCarrierAdmission(value, context) {
  try {
    if (!keys(value, ['schemaVersion', 'execution_profile', 'native_runtime', 'decision', 'target', 'authorities', 'carrier', 'hookMappings', 'certificationBoundary'])
      || value.schemaVersion !== PI_TARGET_CARRIER_ADMISSION_SCHEMA_VERSION || value.execution_profile !== 'native-chat'
      || value.native_runtime !== 'pi' || value.decision !== 'admit-exact-target-and-native-runtime'
      || !keys(value.target, ['id', 'version', 'nodeRange', 'nodeVersion', 'descriptorDigest', 'displayRevision',
        'lockDigest', 'sdkClosureDigest', 'sdkFileCount', 'nodeExecutableDigest', 'runtimeSourceDigest', 'runtimeFileCount'])
      || value.target.id !== 'pi' || value.target.version !== '1.2.0' || value.target.nodeRange !== '>=22.19.0'
      || !isPiNodeSupported(value.target.nodeVersion)
      || value.target.displayRevision !== value.target.sdkClosureDigest?.slice(7, 19)
      || !['descriptorDigest', 'lockDigest', 'sdkClosureDigest', 'nodeExecutableDigest', 'runtimeSourceDigest'].every(k => DIGEST.test(value.target[k]))
      || !['sdkFileCount', 'runtimeFileCount'].every(k => Number.isSafeInteger(value.target[k]) && value.target[k] > 0)
      || !keys(value.authorities, ['blueprintDigest', 'buildContractDigest', 'planApprovalDigest', 'nativePluginRecipeDigest', 'targetDescriptorDigest'])
      || Object.entries(value.authorities).some(([k, v]) => k === 'nativePluginRecipeDigest' ? v !== null : !DIGEST.test(v))
      || !isDeepStrictEqual(value.carrier, { kind: 'native-runtime', owner: 'pi', implementationPathAccepted: false, mcp: false })
      || !isDeepStrictEqual(value.hookMappings, []) || !isDeepStrictEqual(value.certificationBoundary, boundary)) reject();
    if (context !== undefined) {
      if (!keys(context.sources, ['blueprint', 'buildContract', 'planApproval', 'targetDescriptor'])
        || !validatePiTargetDescriptor(context.targetDescriptor).ok
        || !isDeepStrictEqual(value.target, target(context.targetDescriptor, context.sources.targetDescriptor.digest))) reject();
      for (const k of ['blueprint', 'buildContract', 'planApproval', 'targetDescriptor']) {
        if (value.authorities[`${k}Digest`] !== context.sources[k].digest) reject();
      }
    }
    assertPersistable(value, { subject: 'pi-target-carrier-admission' });
    return { ok: true, errors: [] };
  } catch { return { ok: false, errors: ['Pi carrier must bind the exact admitted planning and target closure.'] }; }
}

export async function buildPiTargetCarrierAdmission({ admissions, targetPaths }) {
  if (!keys(admissions, ['blueprint', 'buildContract', 'planApproval', 'targetDescriptor'])) reject();
  const sources = Object.fromEntries(Object.entries(admissions).map(([k, a]) => [k,
    admittedArtifactProvenance(a, { subject: { blueprint: 'blueprint', buildContract: 'build-contract', planApproval: 'plan-approval',
      targetDescriptor: 'pi-target-descriptor' }[k], value: a.value })]));
  const { blueprint: { value: blueprint }, buildContract: { value: contract }, planApproval: { value: approval },
    targetDescriptor: { value: descriptor } } = admissions;
  if (!validateBlueprint(blueprint).ok || blueprint.native_runtime !== 'pi' || !validateBuildContract(contract).ok
    || contract.native_runtime !== 'pi' || contract.bindings.blueprint.digest !== sources.blueprint.digest
    || contract.bindings.targetDescriptor.digest !== sources.targetDescriptor.digest
    || !isDeepStrictEqual(contract.targetDescriptor, descriptor)
    || !validatePlanApproval(approval, { blueprint, buildContract: contract,
      sources: { blueprint: sources.blueprint, buildContract: sources.buildContract } }).ok
    || !isDeepStrictEqual(await buildPiTargetDescriptor(targetPaths), descriptor)) reject();
  const value = { schemaVersion: PI_TARGET_CARRIER_ADMISSION_SCHEMA_VERSION, execution_profile: 'native-chat', native_runtime: 'pi',
    decision: 'admit-exact-target-and-native-runtime', target: target(descriptor, sources.targetDescriptor.digest),
    authorities: { blueprintDigest: sources.blueprint.digest, buildContractDigest: sources.buildContract.digest,
      planApprovalDigest: sources.planApproval.digest, nativePluginRecipeDigest: null, targetDescriptorDigest: sources.targetDescriptor.digest },
    carrier: { kind: 'native-runtime', owner: 'pi', implementationPathAccepted: false, mcp: false }, hookMappings: [],
    certificationBoundary: { ...boundary } };
  if (!validatePiTargetCarrierAdmission(value).ok) reject();
  candidates.add(value);
  return value;
}

export async function writePiTargetCarrierAdmission(filePath, value) {
  if (!candidates.has(value) || !validatePiTargetCarrierAdmission(value).ok) reject();
  await writeNativeChatFile({ filePath: path.resolve(filePath),
    bytes: Buffer.from(serializePersistableJson(value, { subject: 'pi-target-carrier-admission' })) });
  return filePath;
}
