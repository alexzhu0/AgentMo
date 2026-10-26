import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { withPiPackageFixture, admitValue } from './pi-native-fixture.js';
import { produceAgentPackage } from '../../src/package-produce.js';
import { createNativeAuthorityStore } from '../../src/native-chat-authority.js';
import { admitPiPackageArchive, buildPiInstallPlan } from '../../src/pi-install-plan.js';
import { buildPiInstallApproval, buildPiConflictApproval } from '../../src/pi-install-approval.js';
import { initializeCourseBudget, initializeCourseProjectBudget } from '../../src/course-wiki-budget.js';

export async function withPiInstallFixture(fn) {
  return withPiPackageFixture(async f => {
    const archivePath = path.join(f.root, 'agent.d42');
    const produced = await produceAgentPackage({ artifacts: f.artifacts, outputRoot: path.join(f.root, 'package'), archivePath });
    const archive = await admitPiPackageArchive({ filePath: archivePath, expectedDigest: produced.archiveDigest });
    const stateRoot = path.join(f.root, 'state'), authorityRoot = path.join(f.root, 'authority');
    const authorityRootBinding = await createNativeAuthorityStore({ authorityRoot, stateRoot });
    const sourceAdmissions = { ...Object.fromEntries(['blueprint', 'buildContract', 'planApproval', 'targetDescriptor', 'targetCarrierAdmission'].map(k => [k, f.admissions[k]])), archive };
    const budgetRoot = path.join(f.root, 'budget'), legacyRoot = path.join(f.root, 'legacy');
    await mkdir(budgetRoot, { mode: 0o700 }); await mkdir(legacyRoot, { mode: 0o700 });
    await initializeCourseBudget({ root: legacyRoot });
    const { budgetReference } = await initializeCourseProjectBudget({ root: budgetRoot, legacyRoots: [legacyRoot] });
    const plan = buildPiInstallPlan({ lifecycle: 'install', admissions: sourceAdmissions, stateRoot, authorityRootBinding,
      budgetReference, ports: { chat: 19492, proxy: 19493 }, predecessor: null });
    const planAdmission = await admitValue(f.root, plan, 'pi-install-plan');
    const common = { plan, decision: 'approve', issuedAt: new Date(Date.now() - 1000).toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString() };
    const ordinaryApproval = buildPiInstallApproval({ ...common, useNonce: 'pi-install-ordinary' });
    const conflictApproval = buildPiConflictApproval({ ...common, conflicts: [], useNonce: 'pi-install-conflicts' });
    const options = { planAdmission, sourceAdmissions, stateRoot, authorityRoot, ordinaryApproval, conflictApproval, sensitiveDecisions: [] };
    return fn({ ...f, options, plan, stateRoot, authorityRoot, sourceAdmissions, budgetRoot });
  });
}

