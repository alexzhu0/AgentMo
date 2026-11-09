import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, lstat, rm, rename, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as authority from '../src/native-chat-authority.js';
const hash = b => 'sha256:' + createHash('sha256').update(b).digest('hex');
const identity = s => ({ device: String(s.dev), inode: String(s.ino), birthtimeNs: String(s.birthtimeNs) });
async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'pi-preflight-'))); t.after(() => rm(root, { recursive: true, force: true }));
  const authorityRoot = path.join(root, 'authority'), stateRoot = path.join(root, 'absent-agent');
  const previousBinding = await authority.createNativeAuthorityStore({ authorityRoot, stateRoot });
  const journal = path.join(authorityRoot, 'consumption.jsonl');
  const record = { installPlanDigest: hash('old-plan'), native_runtime: 'pi', lifecycle: 'install', decisions: [0, 1].map(n => ({ nonceDigest: hash('nonce-' + n), decisionDigest: hash('decision-' + n) })) };
  await writeFile(journal, Buffer.concat([await readFile(journal), Buffer.from(JSON.stringify(record) + '\n')]));
  const bytes = await readFile(journal);
  return { root, authorityRoot, stateRoot, previousBinding, journal, bytes, expectedJournalDigest: hash(bytes) };
}
test('observes a fresh binding after device drift without changing old approvals or journal bytes', async t => {
  const f = await fixture(t); assert.equal(typeof authority.observeNativeAuthorityStore, 'function');
  const stale = structuredClone(f.previousBinding);
  for (const key of ['rootIdentity', 'anchorIdentity', 'journalIdentity']) stale[key].device = '0';
  const fresh = await authority.observeNativeAuthorityStore({ authorityRoot: f.authorityRoot, previousBinding: stale, expectedJournalDigest: f.expectedJournalDigest });
  assert.deepEqual(fresh, f.previousBinding); assert.equal(stale.rootIdentity.device, '0');
  assert.deepEqual(await readFile(f.journal), f.bytes);
  await assert.rejects(lstat(f.stateRoot), { code: 'ENOENT' });
});
test('rejects a changed journal, replacement anchor, lock, copied root and unsafe permissions', async t => {
  for (const change of ['journal', 'anchor', 'lock', 'path', 'mode']) {
    const f = await fixture(t); let authorityRoot = f.authorityRoot;
    if (change === 'journal') await writeFile(f.journal, Buffer.concat([f.bytes, Buffer.from('{}\n')]));
    if (change === 'anchor') { const p = path.join(f.authorityRoot, 'identity.json'), b = await readFile(p); await rename(p, p + '.old'); await writeFile(p, b, { mode: 0o600 }); }
    if (change === 'lock') await writeFile(path.join(f.authorityRoot, 'consume.lock'), '', { mode: 0o600 });
    if (change === 'path') { authorityRoot += '-copy'; await mkdir(authorityRoot, { mode: 0o700 }); }
    if (change === 'mode') { const { chmod } = await import('node:fs/promises'); await chmod(f.journal, 0o644); }
    await assert.rejects(authority.observeNativeAuthorityStore({ authorityRoot, previousBinding: f.previousBinding, expectedJournalDigest: f.expectedJournalDigest }), { code: 'AGENTMO_NATIVE_AUTHORITY_REJECTED' });
  }
});
test('pins the complete journal bytes even when an appended record is valid', async t => {
  const f = await fixture(t);
  const record = { installPlanDigest: hash('another-plan'), native_runtime: 'pi', lifecycle: 'install',
    decisions: [0, 1].map(n => ({ nonceDigest: hash('new-nonce-' + n), decisionDigest: hash('new-decision-' + n) })) };
  const updated = Buffer.concat([f.bytes, Buffer.from(JSON.stringify(record) + '\n')]); await writeFile(f.journal, updated);
  await assert.rejects(authority.observeNativeAuthorityStore({ authorityRoot: f.authorityRoot, previousBinding: f.previousBinding,
    expectedJournalDigest: f.expectedJournalDigest }), { code: 'AGENTMO_NATIVE_AUTHORITY_REJECTED' });
  assert.deepEqual(await authority.observeNativeAuthorityStore({ authorityRoot: f.authorityRoot, previousBinding: f.previousBinding,
    expectedJournalDigest: hash(updated) }), f.previousBinding);
});
async function helpers() { return import('../scripts/pi-install-preflight.js'); }
test('rejects stale identities before traversing preservation trees with a short diagnostic', async t => {
  const f = await fixture(t), h = await helpers(), actual = identity(await lstat(f.authorityRoot, { bigint: true }));
  await assert.rejects(h.checkPiPreflight({ identities: [{ path: f.authorityRoot, identity: { ...actual, device: '0' } }], trees: [{ root: path.join(f.root, 'missing-tree'), digest: hash('unused') }] }), e => e.code === 'AGENTMO_PI_ENVIRONMENT_STALE' && e.message.length < 200);
});
test('streams preservation metadata and detects changes while allowing only the planned write locations', async t => {
  const f = await fixture(t), h = await helpers(), options = { mutablePaths: ['.', 'authority', 'authority/consumption.jsonl'], excludePaths: ['new-agent'] };
  const before = await h.piMetadataDigest(f.root, options);
  await mkdir(path.join(f.root, 'new-agent')); await writeFile(path.join(f.root, 'new-agent', 'new'), 'new');
  await writeFile(f.journal, Buffer.concat([f.bytes, Buffer.from('planned append\n')]));
  assert.deepEqual(await h.piMetadataDigest(f.root, options), before);
  await writeFile(path.join(f.root, 'unplanned'), 'unexpected');
  assert.notEqual((await h.piMetadataDigest(f.root, options)).digest, before.digest);
  await assert.rejects(h.checkPiPreflight({ identities: [], trees: [{ root: f.root, ...before, options }] }), e => e.code === 'AGENTMO_PI_PRESERVATION_CHANGED' && e.message.length < 200);
});
test('metadata hashing never follows a symlink into another tree', async t => {
  const f = await fixture(t), h = await helpers(), outside = await mkdtemp(path.join(tmpdir(), 'pi-outside-')); t.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(outside, path.join(f.root, 'link')); const before = await h.piMetadataDigest(f.root);
  await writeFile(path.join(outside, 'outside'), 'not part of tree');
  assert.deepEqual(await h.piMetadataDigest(f.root), before);
});
