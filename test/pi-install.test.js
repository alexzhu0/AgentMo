import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { access, readFile, writeFile, lstat, cp } from 'node:fs/promises';
import { withPiPackageFixture, admitValue, digest, jsonBytes } from './helpers/pi-native-fixture.js';
import { withPiInstallFixture } from './helpers/pi-install-fixture.js';
import { createNativeAuthorityStore } from '../src/native-chat-authority.js';
import { admitPiPackageArchive, buildPiInstallPlan } from '../src/pi-install-plan.js';
import { buildPiInstallApproval, buildPiConflictApproval } from '../src/pi-install-approval.js';
import { applyPiInstall, admitPiInstallReceipt } from '../src/pi-install.js';
import { buildPackageArchive } from '../src/package-archive.js';


test('consumes exact Pi authority once and preserves partial installation', async () => {
  await withPiInstallFixture(async f => {
    const before = await readFile(path.join(f.authorityRoot, 'consumption.jsonl'));
    await assert.rejects(applyPiInstall({ ...f.options, sourceAdmissions: { ...f.sourceAdmissions, archive: { ...f.sourceAdmissions.archive } } }));
    await assert.rejects(applyPiInstall({ ...f.options, sourceAdmissions: { ...f.sourceAdmissions,
      targetCarrierAdmission: structuredClone(f.sourceAdmissions.targetCarrierAdmission) } }));
    await assert.rejects(applyPiInstall({ ...f.options, stateRoot: path.join(f.root, 'wrong-root') }));
    assert.deepEqual(await readFile(path.join(f.authorityRoot, 'consumption.jsonl')), before);
    const receipt = await applyPiInstall(f.options);
    assert.equal(receipt.status, 'complete');
    assert.equal(receipt.files.length, 6);
    for (const row of receipt.files) assert.equal((await lstat(path.join(f.stateRoot, row.relativePath))).mode & 0o777, 0o600);
    const filePath = path.join(f.stateRoot, 'install-receipt.json'), expectedDigest = digest(await readFile(filePath));
    const admitted = await admitPiInstallReceipt({ filePath, expectedDigest,
      admissions: { ...f.sourceAdmissions, plan: f.options.planAdmission }, stateRoot: f.stateRoot, authorityRoot: f.authorityRoot });
    assert.equal(admitted.value.status, 'complete');
    assert.throws(() => buildPiInstallPlan({ lifecycle: 'activate', activationId: '00000000-0000-4000-8000-000000000001', admissions: f.sourceAdmissions, stateRoot: f.stateRoot,
      authorityRootBinding: f.plan.authorityRootBinding, budgetReference: f.plan.nativeBinding.budgetReference,
      ports: { chat: 19492, proxy: 19493 }, predecessor: structuredClone(admitted) }));
    await assert.rejects(applyPiInstall(f.options));
    await writeFile(path.join(f.stateRoot, 'system.md'), 'changed');
    await assert.rejects(admitPiInstallReceipt({ filePath, expectedDigest,
      admissions: { ...f.sourceAdmissions, plan: f.options.planAdmission }, stateRoot: f.stateRoot, authorityRoot: f.authorityRoot }));
  });
  await withPiInstallFixture(async f => {
    const original = fs.promises.open;
    fs.promises.open = async (...args) => {
      if (args[0] === path.join(f.stateRoot, 'system.md')) throw Object.assign(new Error('synthetic write failure'), { code: 'ENOSPC' });
      return original(...args);
    };
    syncBuiltinESMExports();
    let receipt;
    try { receipt = await applyPiInstall(f.options); }
    finally { fs.promises.open = original; syncBuiltinESMExports(); }
    assert.equal(receipt.status, 'incomplete');
    await access(path.join(f.stateRoot, 'agent.json'));
    await assert.rejects(access(path.join(f.stateRoot, 'installation.complete.json')));
    assert.equal((await readFile(path.join(f.authorityRoot, 'consumption.jsonl'), 'utf8')).trim().split('\n').length, 2);
    await assert.rejects(applyPiInstall(f.options));
  });
});

test('rejects a rehashed Pi projection that differs from its admitted planning', async () => {
  await withPiInstallFixture(async f => {
    const packageRoot = path.join(f.root, 'changed-package'); await cp(path.join(f.root, 'package'), packageRoot, { recursive: true });
    const member = 'projections/pi/system.md', bytes = Buffer.from('A different system policy.\n');
    await writeFile(path.join(packageRoot, member), bytes);
    const manifestPath = path.join(packageRoot, 'agentmo.package.json'), manifest = JSON.parse(await readFile(manifestPath));
    Object.assign(manifest.members.find(m => m.relativePath === member), { byteLength: bytes.length, sha256: digest(bytes) });
    manifest.inventoryDigest = digest(jsonBytes(manifest.members)); await writeFile(manifestPath, jsonBytes(manifest));
    const archive = await buildPackageArchive({ packageRoot }), filePath = path.join(f.root, 'changed.d42');
    await writeFile(filePath, archive.bytes, { mode: 0o600 });
    const admitted = await admitPiPackageArchive({ filePath, expectedDigest: archive.archiveDigest });
    assert.throws(() => buildPiInstallPlan({ lifecycle: 'install', admissions: { ...f.sourceAdmissions, archive: admitted },
      stateRoot: f.stateRoot, authorityRootBinding: f.plan.authorityRootBinding, budgetReference: f.plan.nativeBinding.budgetReference,
      ports: { chat: 19492, proxy: 19493 }, predecessor: null }));
  });
});
