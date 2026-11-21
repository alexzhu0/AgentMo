import assert from 'node:assert/strict';
import test from 'node:test';
import { workspacePolicy } from './helpers/pi-workspace-fixture.js';
import { piNeed, withPiPlanningFixture, withPiTargetFixture, admitValue } from './helpers/pi-native-fixture.js';
import { validateUserNeed } from '../src/user-need.js';
import { buildDesignPlan, validateDesignPlan } from '../src/design-plan.js';
import { draftBlueprint } from '../src/blueprint-draft.js';
import { validateBlueprint } from '../src/blueprint.js';
import { buildBuildContract, validateBuildContract } from '../src/build-contract.js';
import { buildPiTargetDescriptor } from '../src/pi-target-descriptor.js';

test('workspace policy rejects invalid limits, methods and runtime without fallback', () => {
  for (const mutate of [p=>p.limits.maxRequests=7,p=>p.skill.body+='changed',p=>p.inputPolicy.maxFiles=3,p=>p.extra=true,p=>p.skill.description='x'.repeat(257)]) {
    const p=workspacePolicy();mutate(p);assert.equal(validateUserNeed({...piNeed(),pi_workspace:p}).ok,false);
  }
  assert.equal(validateUserNeed({...piNeed(),native_runtime:undefined,pi_workspace:workspacePolicy()}).ok,false);
});

test('two domain skills survive authentic Plan Blueprint Contract admissions', async () => {
  const digests=[];
  for (const name of ['project-brief','support-handoff']) await withPiTargetFixture(async ({sdkRoot,nodeExecutablePath,lockFilePath}) => {
    const targetPaths={sdkRoot,nodeExecutablePath,lockFilePath};
    await withPiPlanningFixture(async f=>{
      const plan=buildDesignPlan(f.db,f.need,f.options);assert.deepEqual(plan.pi_workspace,f.need.pi_workspace);
      assert.equal(validateDesignPlan(plan).ok,true);
      const designPlan=await admitValue(f.root,plan,'design-plan');
      const bp=draftBlueprint(f.db,f.need,{runtime:'pi',designPlan:designPlan.value,admissions:{discoveryDb:f.admissions.discoveryDb,userNeed:f.admissions.userNeed,designPlan}});
      assert.deepEqual(bp.pi_workspace,plan.pi_workspace);assert.equal(validateBlueprint(bp).ok,true);
      const blueprint=await admitValue(f.root,bp,'blueprint');
      const targetDescriptor=await admitValue(f.root,await buildPiTargetDescriptor(targetPaths),'pi-target-descriptor');
      const {discoveryApproval,decisionLedger}=f.admissions;
      const contract=buildBuildContract(blueprint.value,designPlan.value,discoveryApproval.value,decisionLedger,{target:'pi',admissions:{blueprint,designPlan,discoveryApproval,decisionLedger,targetDescriptor}});
      assert.deepEqual(contract.pi_workspace,plan.pi_workspace);assert.equal(validateBuildContract(contract).ok,true);
      assert.equal(contract.specification.skills.enabled,true);assert.deepEqual(contract.specification.tools.declaredNames,['read','write']);
      assert.notEqual(contract.resources.find(r=>r.kind==='skills').necessity,'disabled');
      const admitted=await admitValue(f.root,contract,'build-contract');digests.push(admitted.digest);
      assert.equal(validateBuildContract({...contract,pi_workspace:{...contract.pi_workspace,skill:workspacePolicy('other-skill').skill}}).ok,false);
    },{...piNeed(),pi_workspace:workspacePolicy(name)});
  });
  assert.notEqual(digests[0],digests[1]);
});
