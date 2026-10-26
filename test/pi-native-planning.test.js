import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { loadAdmittedArtifact } from '../src/artifact-admission.js';
import { buildDesignPlan, validateDesignPlan, writeDesignPlan } from '../src/design-plan.js';
import { draftBlueprint, writeBlueprintDraft } from '../src/blueprint-draft.js';
import { validateBlueprint } from '../src/blueprint.js';
import { validateUserNeed } from '../src/user-need.js';
import * as profiles from '../src/native-chat-model-profile.js';
import { piNeed, withPiPlanningFixture, digest } from './helpers/pi-native-fixture.js';

test('propagates explicit Pi through authentic planning admissions', async () => {
  await withPiPlanningFixture(async f => {
    const plan = buildDesignPlan(f.db, f.need, f.options);
    assert.equal(plan.native_runtime, 'pi');
    assert.equal(plan.targetRuntime, 'pi');
    assert.deepEqual(plan.architecturePlan.specialistPlans, []);
    assert.deepEqual(plan.toolContractPlan.tools, []);
    await writeDesignPlan(path.join(f.root, 'plan.json'), plan);
    const planAdmission = await loadAdmittedArtifact({ filePath: path.join(f.root, 'plan.json'),
      subject: 'design-plan', expectedDigest: digest(await readFile(path.join(f.root, 'plan.json'))) });
    const blueprint = draftBlueprint(f.db, f.need, { runtime: 'pi', designPlan: planAdmission.value,
      admissions: { discoveryDb: f.admissions.discoveryDb, userNeed: f.admissions.userNeed, designPlan: planAdmission } });
    assert.equal(blueprint.native_runtime, 'pi');
    assert.equal(blueprint.runtime, 'pi');
    assert.deepEqual(blueprint.tools, []);
    assert.deepEqual(blueprint.architecture.specialists, []);
    assert.equal(validateBlueprint(blueprint).ok, true);
    await writeBlueprintDraft(path.join(f.root, 'blueprint.json'), blueprint);
    const wrong = { ...plan, native_runtime: undefined };
    assert.equal(validateDesignPlan(wrong).ok, false);
    assert.throws(() => draftBlueprint(f.db, f.need, { runtime: 'pi', designPlan: { ...plan, native_runtime: undefined } }));
    assert.equal(validateBlueprint({ ...blueprint, runtime: 'openclaw' }).ok, false);
    assert.throws(() => buildDesignPlan(f.db, f.need, { ...f.options, runtime: 'openclaw' }));
  });
});

test('rejects present null unknown or cross-profile runtime selectors', () => {
  for (const native_runtime of [null, undefined, 'openclaw', 'rpc', 'Pi']) {
    assert.equal(validateUserNeed({ ...piNeed(), native_runtime }).ok, false);
  }
  const need = piNeed();
  delete need.native_model_profile;
  assert.equal(validateUserNeed(need).ok, false);
  const nonNative = piNeed();
  delete nonNative.execution_profile;
  assert.equal(validateUserNeed(nonNative).ok, false);
  assert.throws(() => profiles.nativeChatRuntime({ ...piNeed(), native_runtime: null }));
});

test('preserves omitted runtime and legacy serialized blueprint bytes', async () => {
  const need = piNeed(); delete need.native_runtime;
  await withPiPlanningFixture(async f => {
    const plan = buildDesignPlan(f.db, f.need, f.options);
    assert.equal(plan.targetRuntime, 'openclaw');
    assert.equal(Object.hasOwn(plan, 'native_runtime'), false);
    const blueprint = draftBlueprint(f.db, f.need, { runtime: 'openclaw' });
    assert.equal(blueprint.runtime, 'openclaw');
    assert.equal(Object.hasOwn(blueprint, 'native_runtime'), false);
    const serialized = JSON.stringify(blueprint);
    assert.equal(validateBlueprint(JSON.parse(serialized)).ok, true);
    assert.equal(JSON.stringify(JSON.parse(serialized)), serialized);
    assert.equal(profiles.nativeChatRuntime(need), 'openclaw');
  }, need);
});
