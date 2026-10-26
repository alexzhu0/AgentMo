import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { access, readFile, writeFile } from 'node:fs/promises';
import { withPiPackageFixture, jsonBytes, digest } from './helpers/pi-native-fixture.js';
import { produceAgentPackage } from '../src/package-produce.js';
import { admitPackageArchiveManifest } from '../src/package-archive.js';
import { selectPackageCarriers } from '../src/package-carriers.js';
import { validateBuildContract } from '../src/build-contract.js';
import { spawnSync } from 'node:child_process';
import { getTargetAdapter } from '../src/targets/registry.js';
import { inspectAgentPackage } from '../src/package-inspect.js';
import { subjectsForCommand } from '../src/artifact-subjects.js';

test('produces an admitted Pi archive and rejects rehashed OpenClaw planning', async () => {
  await withPiPackageFixture(async f => {
    const c = f.admissions.buildContract.value;
    assert.equal(c.native_runtime, 'pi');
    assert.equal(c.specification.runtimeBinding.target, 'pi');
    assert.equal(c.specification.runtimeBinding.model, 'agentmo-budget/MiniMax-M3');
    const pi = getTargetAdapter('pi');
    assert.equal(pi.supports(f.admissions.blueprint.value), true);
    assert.ok(pi.planOperations(f.admissions.blueprint.value, {}).some(op => op.relativePath === 'pi/browser/client.js'));
    assert.equal(selectPackageCarriers(c).entries.find(e => e.resourceId === 'resource:harness').owner, 'pi');
    const outputRoot = path.join(f.root, 'package'), archivePath = path.join(f.root, 'agent.d42');
    const result = await produceAgentPackage({ artifacts: f.artifacts, outputRoot, archivePath });
    const archive = await admitPackageArchiveManifest({ archivePath, expectedArchiveDigest: result.archiveDigest });
    assert.equal(archive.members.length, 28);
    const m = archive.manifest.value;
    assert.equal(m.native_runtime, 'pi');
    assert.equal(m.targetCompatibility[0].target, 'pi');
    assert.equal(Object.hasOwn(m.targetCompatibility[0], 'sourceRevision'), false);
    const inspected = await inspectAgentPackage({ packagePath: archivePath, expectedArchiveDigest: result.archiveDigest });
    assert.equal(inspected.manifest.native_runtime, 'pi');
    assert.deepEqual(m.members.filter(x => x.relativePath.startsWith('projections/')).map(x => x.relativePath), [
      'projections/pi/agent.json', 'projections/pi/browser/client.js', 'projections/pi/browser/index.html',
      'projections/pi/browser/style.css', 'projections/pi/runtime-binding.json', 'projections/pi/system.md',
    ]);
    assert.equal(await readFile(path.join(outputRoot, 'projections/pi/browser/client.js'), 'utf8'),
      await readFile(new URL('../src/pi-chat-client.js', import.meta.url), 'utf8'));
    const wrong = structuredClone(c); delete wrong.native_runtime;
    assert.equal(validateBuildContract(wrong).ok, false);
    const oldPlan = { ...f.admissions.designPlan.value, targetRuntime: 'openclaw' }; delete oldPlan.native_runtime;
    const oldPath = path.join(f.root, 'rehashed-plan.json'), bytes = jsonBytes(oldPlan);
    await writeFile(oldPath, bytes, { flag: 'wx' });
    const rejected = path.join(f.root, 'rejected-package');
    await assert.rejects(produceAgentPackage({ artifacts: { ...f.artifacts,
      designPlan: { filePath: oldPath, expectedDigest: digest(bytes) } }, outputRoot: rejected,
      archivePath: path.join(f.root, 'rejected.d42') }));
    await assert.rejects(access(rejected));
  });
});

test('shared CLI requires Pi subjects and produces the same bounded archive', async () => {
  await withPiPackageFixture(async f => {
    const paths = { blueprint: 'blueprint', 'design-plan': 'designPlan', 'discovery-approval': 'discoveryApproval',
      'decision-ledger': 'decisionLedger', 'build-contract': 'buildContract', 'plan-approval': 'planApproval',
      'pi-target-descriptor': 'targetDescriptor', 'pi-target-carrier-admission': 'targetCarrierAdmission' };
    const args = ['bin/agentmo.js', 'package-produce', f.artifacts.blueprint.filePath, '--target', 'pi'];
    for (const [flag, key] of Object.entries(paths)) {
      if (flag !== 'blueprint') args.push(`--${flag.startsWith('pi-target-') ? flag.slice(3) : flag}`, f.artifacts[key].filePath);
    }
    for (const subject of subjectsForCommand('package-produce', { target: 'pi' })) {
      args.push('--digest', `${subject}=${f.artifacts[paths[subject]].expectedDigest}`);
    }
    args.push('--out', path.join(f.root, 'cli-package'), '--archive', path.join(f.root, 'cli.d42'), '--json');
    const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).certificationBoundary.installed, false);
  });
});
