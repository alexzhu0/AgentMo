import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadAdmittedArtifact } from '../../src/artifact-admission.js';
import { appendDecisionEntry, loadDecisionLedger } from '../../src/decision-ledger.js';
import { buildDiscoveryApproval, buildDiscoveryApprovalPreview } from '../../src/discovery-approval.js';
import { buildDesignPlan } from '../../src/design-plan.js';
import { draftBlueprint } from '../../src/blueprint-draft.js';
import { buildBuildContract } from '../../src/build-contract.js';
import { buildPiTargetDescriptor } from '../../src/pi-target-descriptor.js';
import { buildPlanApproval, buildPlanApprovalPreview } from '../../src/plan-approval.js';

const example = name => new URL(`../../examples/${name}`, import.meta.url);
const baseNeed = JSON.parse(await readFile(example('support-triage.need.json'), 'utf8'));
export const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
export const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
export function piNeed() {
  return { ...structuredClone(baseNeed), agent_id: 'meeting-text', execution_profile: 'native-chat',
    native_runtime: 'pi', native_model_profile: 'minimax-m3-cn-v1' };
}

export async function admitValue(root, value, subject, companions) {
  const filePath = path.join(root, `${subject}.json`), bytes = jsonBytes(value);
  await writeFile(filePath, bytes, { flag: 'wx', mode: 0o600 });
  return loadAdmittedArtifact({ filePath, subject, expectedDigest: digest(bytes), ...(companions ? { companions } : {}) });
}

export async function withPiPlanningFixture(fn, need = piNeed()) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'agentmo-pi-planning-')));
  try {
    const manifest = { ...JSON.parse(await readFile(example('support-triage.discovery.json'), 'utf8')), agent_id: need.agent_id };
    const db = { ...JSON.parse(await readFile(example('fixtures/support-triage/prebuilt-discovery-db.json'), 'utf8')), agentId: need.agent_id };
    const discoveryManifest = await admitValue(root, manifest, 'discovery-manifest');
    const discoveryDb = await admitValue(root, db, 'discovery-db');
    const userNeed = await admitValue(root, need, 'user-need');
    const authority = { admissions: { discoveryManifest, discoveryDb } };
    const preview = buildDiscoveryApprovalPreview(discoveryManifest.value, discoveryDb.value, authority);
    const approval = buildDiscoveryApproval(discoveryManifest.value, discoveryDb.value, { ...authority, approve: true, previewDigest: preview.previewDigest });
    const discoveryApproval = await admitValue(root, approval, 'discovery-approval', {
      'discovery-manifest': discoveryManifest, 'discovery-db': discoveryDb,
    });
    const requirementRefs = ['primary_tasks', 'success_criteria', 'hard_failures'].flatMap((key, i) =>
      need[key].map((_, n) => `${['primary-task', 'success-criterion', 'hard-failure'][i]}-${String(n + 1).padStart(2, '0')}`)).sort();
    const journalPath = path.join(root, 'decisions.json');
    const appended = await appendDecisionEntry({ journalPath, entry: {
      entryId: 'pi-planning-test-01', entryKind: 'human-decision', subject: 'Synthetic planning fixture',
      reason: 'Exercise the bounded planning mechanism without runtime authorization.',
      sourceRefs: [], decisionRefs: [], requirementRefs,
    } });
    const decisionLedger = await loadDecisionLedger({ journalPath, expectedHeadDigest: appended.head.digest });
    const admissions = { discoveryManifest, discoveryDb, userNeed, discoveryApproval, decisionLedger };
    return await fn({ root, need: userNeed.value, manifest: discoveryManifest.value, db: discoveryDb.value, admissions, options: {
      runtime: Object.hasOwn(need, 'native_runtime') ? need.native_runtime : 'openclaw',
      manifest: discoveryManifest.value, discoveryApproval: discoveryApproval.value, decisionLedger, admissions,
    } });
  } finally { await rm(root, { recursive: true, force: true }); }
}

export async function withPiTargetFixture(fn) {
  const sdkRoot = await realpath(await mkdtemp(path.join(tmpdir(), 'agentmo-pi-target-')));
  const sdkDir = path.join(sdkRoot, 'node_modules/@earendil-works/pi-coding-agent');
  const coreDir = path.join(sdkRoot, 'node_modules/@earendil-works/pi-agent-core');
  const lockFilePath = path.join(sdkRoot, 'package-lock.json');
  try {
    for (const dir of [sdkDir, coreDir]) await mkdir(path.join(dir, 'dist'), { recursive: true });
    const sdkPackage = { name: '@earendil-works/pi-coding-agent', version: '1.2.0', type: 'module',
      main: 'dist/index.js', engines: { node: '>=22.19.0' }, dependencies: { '@earendil-works/pi-agent-core': '1.2.0' } };
    const corePackage = { name: '@earendil-works/pi-agent-core', version: '1.2.0', type: 'module', main: 'dist/index.js' };
    await writeFile(path.join(sdkDir, 'package.json'), jsonBytes(sdkPackage));
    await writeFile(path.join(coreDir, 'package.json'), jsonBytes(corePackage));
    await writeFile(path.join(sdkDir, 'dist/index.js'), 'export const syntheticTargetFixture = true;\n');
    await writeFile(path.join(coreDir, 'dist/index.js'), 'export const syntheticDependencyFixture = true;\n');
    const packages = { '': { dependencies: { '@earendil-works/pi-coding-agent': '1.2.0' } } };
    for (const name of ['pi-coding-agent', 'pi-agent-core']) packages[`node_modules/@earendil-works/${name}`] = {
      version: '1.2.0', resolved: `https://registry.npmjs.org/@earendil-works/${name}/-/${name}-1.2.0.tgz`,
      integrity: `sha512-${Buffer.alloc(64, 1).toString('base64')}`,
    };
    await writeFile(lockFilePath, jsonBytes({ lockfileVersion: 3, packages }));
    return await fn({ sdkRoot, sdkDir, coreDir, lockFilePath, nodeExecutablePath: await realpath(process.execPath) });
  } finally { await rm(sdkRoot, { recursive: true, force: true }); }
}

export async function withPiPackageFixture(fn) {
  return withPiTargetFixture(({ sdkRoot, nodeExecutablePath, lockFilePath }) => withPiPlanningFixture(async f => {
    const targetPaths = { sdkRoot, nodeExecutablePath, lockFilePath };
    const designPlan = await admitValue(f.root, buildDesignPlan(f.db, f.need, f.options), 'design-plan');
    const blueprint = await admitValue(f.root, draftBlueprint(f.db, f.need, { runtime: 'pi', designPlan: designPlan.value,
      admissions: { discoveryDb: f.admissions.discoveryDb, userNeed: f.admissions.userNeed, designPlan } }), 'blueprint');
    const targetDescriptor = await admitValue(f.root, await buildPiTargetDescriptor(targetPaths), 'pi-target-descriptor');
    const { discoveryApproval, decisionLedger } = f.admissions;
    const buildContract = await admitValue(f.root, buildBuildContract(blueprint.value, designPlan.value,
      discoveryApproval.value, decisionLedger, { target: 'pi', admissions: {
        blueprint, designPlan, discoveryApproval, decisionLedger, targetDescriptor,
      } }), 'build-contract');
    const authority = { admissions: { blueprint, buildContract } };
    const preview = buildPlanApprovalPreview(blueprint.value, buildContract.value, authority);
    const planApproval = await admitValue(f.root, buildPlanApproval(blueprint.value, buildContract.value,
      { ...authority, approve: true, previewDigest: preview.previewDigest }), 'plan-approval');
    const { buildPiTargetCarrierAdmission } = await import('../../src/pi-target-admission.js');
    const targetCarrierAdmission = await admitValue(f.root, await buildPiTargetCarrierAdmission({
      admissions: { blueprint, buildContract, planApproval, targetDescriptor }, targetPaths,
    }), 'pi-target-carrier-admission', {
      blueprint, 'build-contract': buildContract, 'plan-approval': planApproval, 'pi-target-descriptor': targetDescriptor,
    });
    const admissions = { blueprint, designPlan, discoveryApproval, decisionLedger, buildContract,
      planApproval, targetDescriptor, targetCarrierAdmission };
    const artifacts = Object.fromEntries(Object.entries(admissions).map(([name, a]) => [name, {
      filePath: name === 'decisionLedger' ? path.join(f.root, 'decisions.json')
        : path.join(f.root, `${a.subject}.json`), expectedDigest: a.digest ?? a.head.digest,
    }]));
    return fn({ ...f, admissions, targetPaths, artifacts });
  }));
}
