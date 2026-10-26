import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { loadAdmittedArtifact, admittedArtifactProvenance } from '../src/artifact-admission.js';
import { getArtifactContract } from '../src/artifact-contract.js';
import { withPiTargetFixture, jsonBytes, digest } from './helpers/pi-native-fixture.js';

const descriptorModule = () => import('../src/pi-target-descriptor.js');
const paths = f => ({ sdkRoot: f.sdkRoot, nodeExecutablePath: f.nodeExecutablePath, lockFilePath: f.lockFilePath });

test('observes dependency bytes and admits only the Pi descriptor subject', async () => {
  const { buildPiTargetDescriptor, validatePiTargetDescriptor } = await descriptorModule();
  await withPiTargetFixture(async f => {
    const first = await buildPiTargetDescriptor(paths(f));
    assert.equal(validatePiTargetDescriptor(first).ok, true);
    assert.equal(first.target.id, 'pi');
    assert.equal(first.target.version, '1.2.0');
    const descriptorPath = path.join(f.sdkRoot, 'descriptor.json'), bytes = jsonBytes(first);
    await writeFile(descriptorPath, bytes);
    const admitted = await loadAdmittedArtifact({ filePath: descriptorPath, subject: 'pi-target-descriptor', expectedDigest: digest(bytes) });
    assert.equal(admittedArtifactProvenance(admitted, { subject: 'pi-target-descriptor', value: admitted.value }).digest, digest(bytes));
    assert.throws(() => admittedArtifactProvenance({ ...admitted }, { subject: 'pi-target-descriptor', value: admitted.value }));
    await assert.rejects(loadAdmittedArtifact({ filePath: descriptorPath, subject: 'openclaw-target-descriptor', expectedDigest: digest(bytes) }));
    assert.equal(getArtifactContract('pi-target-descriptor').identity, 'agentmo.pi-target-descriptor.v1');
    await writeFile(path.join(f.coreDir, 'dist/index.js'), 'export const changedDependency = true;\n');
    const second = await buildPiTargetDescriptor(paths(f));
    assert.notEqual(second.closure.sdkClosureDigest, first.closure.sdkClosureDigest);
    assert.notEqual(digest(jsonBytes(second)), digest(bytes));
    assert.equal(first.certificationBoundary.runtimeVerified, false);
  });
});

test('refuses missing dependencies symlinks and malformed lock integrity', async () => {
  const { buildPiTargetDescriptor } = await descriptorModule();
  await withPiTargetFixture(async f => {
    const original = await readFile(f.lockFilePath);
    const lock = JSON.parse(original);
    lock.packages['node_modules/@earendil-works/pi-coding-agent'].integrity = 'unverified';
    await writeFile(f.lockFilePath, jsonBytes(lock));
    await assert.rejects(buildPiTargetDescriptor(paths(f)));
    await writeFile(f.lockFilePath, original);
    await rm(f.coreDir, { recursive: true });
    await assert.rejects(buildPiTargetDescriptor(paths(f)));
  });
  await withPiTargetFixture(async f => {
    const entry = path.join(f.sdkDir, 'dist/index.js');
    await rm(entry); await symlink(path.join(f.coreDir, 'dist/index.js'), entry);
    await assert.rejects(buildPiTargetDescriptor(paths(f)));
  });
});

test('refuses wrong SDK version unsupported Node or caller trust overrides', async () => {
  const { buildPiTargetDescriptor, validatePiTargetDescriptor } = await descriptorModule();
  await withPiTargetFixture(async f => {
    const descriptor = await buildPiTargetDescriptor(paths(f));
    assert.equal(validatePiTargetDescriptor({ ...descriptor, target: { ...descriptor.target, nodeVersion: '20.0.0' } }).ok, false);
    assert.equal(validatePiTargetDescriptor({ ...descriptor, carrier: 'openclaw' }).ok, false);
    await assert.rejects(buildPiTargetDescriptor({ ...paths(f), runtimeFiles: [] }));
    const pkg = JSON.parse(await readFile(path.join(f.sdkDir, 'package.json')));
    pkg.version = '9.0.0'; await writeFile(path.join(f.sdkDir, 'package.json'), jsonBytes(pkg));
    await assert.rejects(buildPiTargetDescriptor(paths(f)));
  });
});
