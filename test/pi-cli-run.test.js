import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { withPiRuntimeFixture } from './helpers/pi-runtime-fixture.js';
import { preparePiCliRequest, runApprovedPiCliRequest } from '../src/pi-cli-run.js';

export function installed(f) {
  const { sourceFiles, ...rest } = f.runtimeOptions;
  const { activationPlan, ...refs } = sourceFiles;
  const { planAdmission, ...inputs } = rest;
  return { ...inputs, sourceFiles: refs };
}
const request = f => ({ installed: installed(f), kind: 'create-session', ports: { chat: 19492, proxy: 19493 } });

test('requires a fresh preview before every activation and turn', async () => {
  await withPiRuntimeFixture(async f => {
    const journal = path.join(f.authorityRoot, 'consumption.jsonl'), before = await readFile(journal), files = await readdir(path.join(f.stateRoot, 'attempts'));
    const first = await preparePiCliRequest(request(f)), second = await preparePiCliRequest(request(f));
    assert.notEqual(first.previewDigest, second.previewDigest);
    assert.equal(first.maximumNewReservedFen, 0);
    assert.equal((await runApprovedPiCliRequest({ preview: first, confirmation: 'no' })).status, 'declined');
    assert.equal((await runApprovedPiCliRequest({ preview: structuredClone(second), confirmation: second.confirmationCode })).status, 'declined');
    assert.deepEqual(await readFile(journal), before); assert.deepEqual(await readdir(path.join(f.stateRoot, 'attempts')), files);
  });
});

test('resumes only the admitted Agent session and rejects drift without writes', async () => {
  await withPiRuntimeFixture(async f => {
    await assert.rejects(preparePiCliRequest({ ...request(f), kind: 'turn', sessionId: randomUUID(), text: 'Product: Atlas', runtimeEnvFile: path.join(f.root, 'never-read.env') }));
    const preview = await preparePiCliRequest(request(f));
    const file = path.join(f.stateRoot, 'system.md'), original = await readFile(file);
    await writeFile(file, 'changed');
    const before = await readFile(path.join(f.authorityRoot, 'consumption.jsonl'));
    const outcome = await runApprovedPiCliRequest({ preview, confirmation: preview.confirmationCode });
    assert.equal(outcome.status, 'failed'); assert.equal(outcome.cleanup.status, 'not-started');
    assert.deepEqual(await readFile(path.join(f.authorityRoot, 'consumption.jsonl')), before);
    await writeFile(file, original);
  });
});

test('consumes new decisions once per synthetic request and preserves native history', async t => {
  const previousMask = process.umask(0o077); t.after(() => process.umask(previousMask));
  const { createCoreCliHarness } = await import('./helpers/core-mvp-fixture.js');
  await withPiRuntimeFixture(async f => {
    const { runner, plans, fake, stats } = await createCoreCliHarness(t, f);
    const opts = request(f), before = await readFile(path.join(f.authorityRoot, 'consumption.jsonl'));
    const preview = await runner.preparePiCliRequest(opts);
    const created = await runner.runApprovedPiCliRequest({ preview, confirmation: preview.confirmationCode });
    assert.equal(created.status, 'created'); assert.equal(created.newReservedFen, 0);
    for (const text of ['Product: Atlas', 'What Product did I give?']) {
      const preview = await runner.preparePiCliRequest({ ...opts, kind: 'turn', sessionId: created.sessionId, text, runtimeEnvFile: path.join(f.root, 'never-read.env') });
      const result = await runner.runApprovedPiCliRequest({ preview, confirmation: preview.confirmationCode });
      assert.equal(result.status, 'completed', JSON.stringify(result)); assert.equal(result.newReservedFen, 31);
      assert.equal(result.cleanup.status, 'stopped');
    }
    assert.equal(stats().starts, 3); assert.equal(stats().stops, 3);
    assert.equal(new Set(plans.map(p => p.activationId)).size, 3);
    assert.equal(plans[1].approvedCases.length, 1); assert.equal(plans[1].restartAllowance, 0);
    assert.ok(fake.calls.open.length > 0);
    assert.ok((await readFile(path.join(f.authorityRoot, 'consumption.jsonl'))).subarray(0, before.length).equals(before));
  });
});


test('a failed synthetic request retains one reservation and does not continue', async t => {
  const previousMask = process.umask(0o077); t.after(() => process.umask(previousMask));
  const { createCoreCliHarness } = await import('./helpers/core-mvp-fixture.js');
  await withPiRuntimeFixture(async f => {
    const { runner, stats } = await createCoreCliHarness(t, f, { upstreamStatus: 503 });
    let preview = await runner.preparePiCliRequest(request(f));
    const room = await runner.runApprovedPiCliRequest({ preview, confirmation: preview.confirmationCode });
    assert.equal(room.status, 'created');
    preview = await runner.preparePiCliRequest({ ...request(f), kind: 'turn', sessionId: room.sessionId, text: 'Product: Atlas', runtimeEnvFile: path.join(f.root, 'never-read.env') });
    const failed = await runner.runApprovedPiCliRequest({ preview, confirmation: preview.confirmationCode });
    assert.equal(failed.status, 'failed'); assert.equal(failed.newReservedFen, 31);
    assert.equal(failed.failureCode, 'COURSE_WIKI_UPSTREAM_UNAVAILABLE');
    assert.equal(stats().starts, 2); assert.equal(stats().stops, 2);
    assert.equal((await runner.runApprovedPiCliRequest({ preview, confirmation: preview.confirmationCode })).status, 'declined');
    assert.equal(stats().starts, 2);
  });
});

test('expired confirmation cannot write or consume an activation', async t => {
  await withPiRuntimeFixture(async f => {
    const preview = await preparePiCliRequest(request(f)), before = await readdir(path.join(f.stateRoot, 'attempts'));
    const clock = t.mock.method(Date, 'now', () => Date.parse(preview.expiresAt) + 1);
    try { assert.equal((await runApprovedPiCliRequest({ preview, confirmation: preview.confirmationCode })).status, 'declined'); }
    finally { clock.mock.restore(); }
    assert.deepEqual(await readdir(path.join(f.stateRoot, 'attempts')), before);
  });
});
