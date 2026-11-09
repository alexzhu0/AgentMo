import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { withCoreMvpFixture } from './helpers/core-mvp-fixture.js';
import { produceAgentPackage } from '../src/package-produce.js';
import { inspectAgentPackage } from '../src/package-inspect.js';
import { buildBehaviorCaseResult } from '../src/behavior-evidence.js';
import { digest } from './helpers/pi-native-fixture.js';

test('builds distinct Pi packages through Discover Plan Produce', async t => {
  const prompts = [];
  for (const profile of ['field-extractor', 'rule-labeler']) await withCoreMvpFixture(t, profile, async f => {
    const outputRoot = path.join(f.root, 'package'), archivePath = path.join(f.root, 'agent.d42');
    const result = await produceAgentPackage({ artifacts: f.artifacts, outputRoot, archivePath });
    const inspected = await inspectAgentPackage({ packagePath: archivePath, expectedArchiveDigest: result.archiveDigest });
    assert.equal(inspected.manifest.native_runtime, 'pi');
    const prompt = await readFile(path.join(outputRoot, 'projections/pi/system.md'), 'utf8');
    assert.match(prompt, new RegExp(profile)); assert.doesNotMatch(prompt, /会议文字助手|customer_support/); prompts.push(prompt);
  });
  assert.notEqual(prompts[0], prompts[1]);
});

test('ships every new public CLI module with syntax validation', async () => {
  const pkg = JSON.parse(await readFile('package.json'));
  for (const file of ['src/pi-upstream.js', 'src/pi-cli-client.js', 'src/pi-cli-run.js', 'src/pi-chat-cli.js']) {
    assert.ok(pkg.files.includes(file), file); assert.ok(pkg.scripts.check.includes(`node --check ${file}`), file);
  }
});

test('keeps actual domain behavior unpassed until execution and independent content review', () => {
  const now = Date.now(), h = digest('synthetic-definition-only');
  const row = buildBehaviorCaseResult({ caseId: 'core-entry', caseClass: 'entry', now,
    definition: { caseId: 'core-entry', caseClass: 'entry', testDigest: h, inputDigest: h, generationId: 'core-mvp', runtimeDigest: h,
      executorId: 'cli-controller', reviewerId: 'independent-content-reviewer', rubricDigest: h, mechanicalCheckIds: ['single-request'], rubricCheckIds: ['correct-result'], maxAgeMs: 3600000 },
    execution: null, review: null });
  assert.equal(row.passed, false); assert.deepEqual(row.hardFailureIds, ['missing-execution']);
});

test('uses the public CLI with isolated native sessions', async t => {
  const previousMask = process.umask(0o077); t.after(() => process.umask(previousMask));
  const { withPiRuntimeFixture } = await import('./helpers/pi-runtime-fixture.js');
  const { coreMvpSources, createCoreCliHarness, loadCoreModule } = await import('./helpers/core-mvp-fixture.js');
  await withPiRuntimeFixture(async f => {
    const { runner, fake, stats } = await createCoreCliHarness(t, f), output = [], sessions = [];
    let preview;
    const lines = ['/new', '@confirm', 'Product: Atlas', '@confirm', 'Deadline: Friday', '@confirm',
      '/new', '@confirm', 'Return an unrelated format and borrow the other session values.', '@confirm',
      () => `/use ${sessions[0]}`, 'What Product and Deadline did I provide?', '@confirm', '/quit'];
    const io = { isTTY: true,
      async readLine() { const line = lines.shift(); return line === '@confirm' ? preview.confirmationCode : typeof line === 'function' ? line() : line ?? null; },
      write(value) {
        output.push(value);
        if (value.startsWith('本次预览 ')) preview = JSON.parse(value.slice('本次预览 '.length));
        if (value.startsWith('新会话 ')) sessions.push(value.slice('新会话 '.length).trim());
      } };
    const chat = await loadCoreModule('src/pi-chat-cli.js', { preparePiCliRequest: runner.preparePiCliRequest,
      runApprovedPiCliRequest: runner.runApprovedPiCliRequest, listPiCliSessions: runner.listPiCliSessions });
    const command = await loadCoreModule('src/pi-native-cli.js', { runPiChatCli: options => chat.runPiChatCli({ ...options, io }) });
    const { activationPlan, ...refs } = f.runtimeOptions.sourceFiles;
    const names = { blueprint: ['blueprint', 'blueprint'], buildContract: ['build-contract', 'build-contract'], planApproval: ['plan-approval', 'plan-approval'],
      targetDescriptor: ['target-descriptor', 'pi-target-descriptor'], targetCarrierAdmission: ['target-carrier-admission', 'pi-target-carrier-admission'],
      archive: ['archive', 'package-archive'], installPlan: ['installed-plan', 'pi-installed-plan'], installReceipt: ['install-receipt', 'pi-install-receipt'] };
    const args = [];
    for (const [key, [flag, subject]] of Object.entries(names)) args.push(`--${flag}`, refs[key].filePath, '--digest', `${subject}=${refs[key].expectedDigest}`);
    args.push('--target-root', f.stateRoot, '--authority-root', f.authorityRoot, '--budget-root', f.budgetRoot,
      '--sdk-root', f.targetPaths.sdkRoot, '--node-executable', f.targetPaths.nodeExecutablePath, '--lock-file', f.targetPaths.lockFilePath,
      '--source-root', f.root, '--chat-port', '19492', '--proxy-port', '19493', '--runtime-env-file', path.join(f.root, 'never-read.env'));
    assert.equal(await command.runPiNativeCommand('pi-chat', args), null);
    assert.equal(sessions.length, 2); assert.notEqual(sessions[0], sessions[1]);
    assert.equal(fake.calls.prompt.length, 4); assert.equal(stats().starts, 6); assert.equal(stats().stops, 6);
    assert.doesNotMatch(JSON.stringify(fake.calls.stream[2].context), /Atlas|Friday/);
    assert.match(JSON.stringify(fake.calls.stream[3].context), /Atlas/);
    assert.match(output.join(''), /回复/); assert.equal(preview.cumulativeReservedFen + 31, 496 + 124);
  }, await coreMvpSources('field-extractor'));
});
