import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { runPiNativeCommand } from '../src/pi-native-cli.js';
import { withPiInstallFixture } from './helpers/pi-install-fixture.js';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { digest, jsonBytes } from './helpers/pi-native-fixture.js';
test('rejects extra execution flags and missing approvals without effects', async () => {
  for (const command of ['pi-target-describe', 'pi-target-admit', 'pi-install-preview', 'pi-install-approve', 'pi-install-apply', 'pi-native-serve', 'pi-native-stop']) {
    await assert.rejects(runPiNativeCommand(command, ['--upstream', 'https://outside.invalid', '--json']));
    await assert.rejects(runPiNativeCommand(command, ['--runtime-env', 'forbidden-alias', '--json']));
  }
  const help = spawnSync(process.execPath, ['bin/agentmo.js', '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0); assert.match(help.stdout, /pi-native-serve/u); assert.match(help.stdout, />=22\.19\.0/u);
  for (const command of ['pi-target-describe', 'pi-target-admit', 'pi-install-preview', 'pi-install-approve', 'pi-install-apply', 'pi-native-serve', 'pi-native-stop']) {
    const one = spawnSync(process.execPath, ['bin/agentmo.js', command, '--help'], { encoding: 'utf8' });
    assert.equal(one.status, 0, command); assert.match(one.stdout, />=22\.19\.0/u);
  }
});

test('executes exact describe admit preview approve and apply against synthetic sources', async () => {
  await withPiInstallFixture(async f => {
    const target = ['--sdk-root', f.targetPaths.sdkRoot, '--node-executable', f.targetPaths.nodeExecutablePath, '--lock-file', f.targetPaths.lockFilePath];
    const defs = { blueprint: ['blueprint', 'blueprint'], buildContract: ['build-contract', 'build-contract'], planApproval: ['plan-approval', 'plan-approval'],
      targetDescriptor: ['target-descriptor', 'pi-target-descriptor'], targetCarrierAdmission: ['target-carrier-admission', 'pi-target-carrier-admission'] };
    const sourceArgs = Object.entries(defs).flatMap(([key, [flag, subject]]) => ['--' + flag, f.artifacts[key].filePath, '--digest', `${subject}=${f.artifacts[key].expectedDigest}`]);
    const descriptorPath = path.join(f.root, 'cli-descriptor.json');
    const described = spawnSync(process.execPath, ['bin/agentmo.js', 'pi-target-describe', ...target, '--out', descriptorPath, '--json'], { encoding: 'utf8' });
    assert.equal(described.status, 0, described.stderr); assert.equal(JSON.parse(described.stdout).native_runtime, 'pi');
    const carrierArgs = Object.entries(defs).filter(([k]) => k !== 'targetCarrierAdmission').flatMap(([key, [flag, subject]]) =>
      ['--' + flag, f.artifacts[key].filePath, '--digest', `${subject}=${f.artifacts[key].expectedDigest}`]);
    assert.equal((await runPiNativeCommand('pi-target-admit', [...carrierArgs, ...target, '--out', path.join(f.root, 'cli-carrier.json'), '--json'])).artifact.carrier.owner, 'pi');
    const archiveArgs = ['--archive', f.sourceAdmissions.archive.filePath, '--digest', `package-archive=${f.sourceAdmissions.archive.expectedDigest}`];
    const authorityPath = path.join(f.root, 'authority-binding.json'); await writeFile(authorityPath, jsonBytes(f.plan.authorityRootBinding), { mode: 0o600 });
    const rootArgs = ['--target-root', f.stateRoot, '--authority-root', f.authorityRoot];
    const previewArgs = [...sourceArgs, ...archiveArgs, ...rootArgs, '--authority-binding', authorityPath,
      '--digest', `native-authority-binding=${digest(await readFile(authorityPath))}`, '--budget-root', f.budgetRoot, '--chat-port', '19492', '--proxy-port', '19493'];
    const planPath = path.join(f.root, 'cli-install-plan.json');
    const preview = await runPiNativeCommand('pi-install-preview', [...previewArgs, '--lifecycle', 'install', '--out', planPath, '--json']);
    assert.equal(preview.artifact.installPlanDigest, f.plan.installPlanDigest);
    const planArgs = ['--install-plan', planPath, '--digest', `pi-install-plan=${digest(await readFile(planPath))}`];
    const approvalPaths = {};
    for (const family of ['ordinary', 'conflicts']) {
      const filePath = path.join(f.root, `cli-${family}.json`);
      await runPiNativeCommand('pi-install-approve', [...planArgs, '--family', family, '--issued-at', new Date(Date.now() - 1000).toISOString(),
        '--expires-at', new Date(Date.now() + 600000).toISOString(), '--nonce', `cli-${family}-nonce`, '--approve', '--out', filePath, '--json']);
      approvalPaths[family] = filePath;
    }
    const result = await runPiNativeCommand('pi-install-apply', [...sourceArgs, ...archiveArgs, ...planArgs, ...rootArgs,
      '--ordinary-approval', approvalPaths.ordinary, '--digest', `pi-install-approval=${digest(await readFile(approvalPaths.ordinary))}`,
      '--conflict-approval', approvalPaths.conflicts, '--digest', `pi-conflict-approval=${digest(await readFile(approvalPaths.conflicts))}`, '--apply', '--json']);
    assert.equal(result.artifact.status, 'complete'); assert.equal(result.artifact.certificationBoundary.runtimeVerified, false);
    const receiptPath = path.join(f.stateRoot, 'install-receipt.json'), activationPath = path.join(f.root, 'cli-activate-plan.json');
    const activation = await runPiNativeCommand('pi-install-preview', [...previewArgs, '--lifecycle', 'activate', '--activation-id', '00000000-0000-4000-8000-000000000001',
      '--installed-plan', planPath, '--digest', `pi-installed-plan=${digest(await readFile(planPath))}`,
      '--install-receipt', receiptPath, '--digest', `pi-install-receipt=${digest(await readFile(receiptPath))}`, '--out', activationPath, '--json']);
    assert.deepEqual(activation.artifact.approvedCases, []); assert.equal(activation.artifact.sensitiveActions.length, 2);
    const before = await readFile(path.join(f.authorityRoot, 'consumption.jsonl'));
    await assert.rejects(runPiNativeCommand('pi-native-stop', ['--install-plan', activationPath, '--digest', `pi-install-plan=${digest(await readFile(activationPath))}`, ...rootArgs.filter((_, i) => i < 2), '--json']));
    assert.deepEqual(await readFile(path.join(f.authorityRoot, 'consumption.jsonl')), before);
  });
});
