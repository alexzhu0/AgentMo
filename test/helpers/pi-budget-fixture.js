import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPiTurnController, createPiBudgetHandler } from '../../src/pi-budget-proxy.js';
import { initializeCourseBudget, initializeCourseProjectBudget, courseBudgetSummary } from '../../src/course-wiki-budget.js';
import { digest } from './pi-native-fixture.js';

export async function piBudgetFixture(t, text = '合成材料') {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'pi-proxy-'))); t.after(() => rm(root, { recursive: true, force: true }));
  const stateRoot = path.join(root, 'state'), budgetRoot = path.join(root, 'budget'), legacy = path.join(root, 'legacy');
  for (const p of [stateRoot, budgetRoot, legacy, path.join(stateRoot, 'turns'), path.join(stateRoot, 'attempts')]) await mkdir(p, { mode: 0o700 });
  await initializeCourseBudget({ root: legacy });
  const { budgetReference } = await initializeCourseProjectBudget({ root: budgetRoot, legacyRoots: [legacy] });
  const binding = { native_runtime: 'pi', agentId: 'meeting-text', stateRootDigest: digest(stateRoot), modelProfile: 'minimax-m3-cn-v1',
    chatPort: 19492, proxyPort: 19493, budgetReference, ...Object.fromEntries(['targetDescriptorDigest', 'runtimeSourceDigest',
      'packageArchiveDigest', 'buildContractDigest'].map(k => [k, digest(k)])) };
  const sessionId = randomUUID(), turnId = randomUUID(), approvedCases = [{ caseId: 'entry', sessionId, inputDigest: digest(text) }];
  const controller = await createPiTurnController({ binding, stateRoot, approvedCases });
  const handler = createPiBudgetHandler({ binding, stateRoot, budgetRoot, apiKey: 'SYNTHETIC_KEY_MARKER', controller });
  return { root, stateRoot, budgetRoot, binding, approvedCases, controller, handler, sessionId, turnId, text,
    admit: () => controller.admit({ ...approvedCases[0], turnId }),
    summary: () => courseBudgetSummary({ root: budgetRoot, budgetReference }) };
}
