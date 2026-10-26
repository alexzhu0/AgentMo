import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { withPiInstallFixture } from './pi-install-fixture.js';
import { admitValue, digest } from './pi-native-fixture.js';
import { applyPiInstall, admitPiInstallReceipt } from '../../src/pi-install.js';
import { buildPiInstallPlan } from '../../src/pi-install-plan.js';
import { buildPiInstallApproval, buildPiSensitiveActionDecision, buildPiConflictApproval } from '../../src/pi-install-approval.js';
export async function withPiRuntimeFixture(fn) {
  return withPiInstallFixture(async f => {
    const receipt = await applyPiInstall(f.options); assert.equal(receipt.status, 'complete');
    const filePath = path.join(f.stateRoot, 'install-receipt.json'), expectedDigest = digest(await readFile(filePath));
    const installReceipt = await admitPiInstallReceipt({ filePath, expectedDigest,
      admissions: { ...f.sourceAdmissions, plan: f.options.planAdmission }, stateRoot: f.stateRoot, authorityRoot: f.authorityRoot });
    const plan = buildPiInstallPlan({ lifecycle: 'activate', activationId: '00000000-0000-4000-8000-000000000001', admissions: f.sourceAdmissions, stateRoot: f.stateRoot,
      authorityRootBinding: f.plan.authorityRootBinding, budgetReference: f.plan.nativeBinding.budgetReference,
      ports: { chat: 19492, proxy: 19493 }, predecessor: installReceipt });
    const activationPath = path.join(f.root, 'activation'); await import('node:fs/promises').then(fs => fs.mkdir(activationPath));
    const planAdmission = await admitValue(activationPath, plan, 'pi-install-plan');
    const common = { plan, decision: 'approve', issuedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() };
    const decisions = { ordinaryApproval: buildPiInstallApproval({ ...common, useNonce: 'pi-activate-ordinary' }),
      sensitiveDecisions: plan.sensitiveActions.map((action, i) => buildPiSensitiveActionDecision({ ...common, action, useNonce: `pi-activate-sensitive-${i}` })),
      conflictApproval: buildPiConflictApproval({ ...common, conflicts: [], useNonce: 'pi-activate-conflicts' }) };
    const sourceAdmissions = { ...f.sourceAdmissions, installPlan: f.options.planAdmission, installReceipt };
    const sourceFiles = { ...Object.fromEntries(['blueprint', 'buildContract', 'planApproval', 'targetDescriptor', 'targetCarrierAdmission'].map(k => [k, f.artifacts[k]])),
      archive: { filePath: f.sourceAdmissions.archive.filePath, expectedDigest: f.sourceAdmissions.archive.expectedDigest },
      installPlan: { filePath: path.join(f.root, 'pi-install-plan.json'), expectedDigest: f.options.planAdmission.digest },
      installReceipt: { filePath, expectedDigest }, activationPlan: { filePath: path.join(activationPath, 'pi-install-plan.json'), expectedDigest: planAdmission.digest } };
    return fn({ ...f, activationPlan: plan, runtimeOptions: { planAdmission, sourceAdmissions, sourceFiles,
      stateRoot: f.stateRoot, authorityRoot: f.authorityRoot, targetPaths: f.targetPaths, budgetRoot: f.budgetRoot }, decisions });
  });
}

