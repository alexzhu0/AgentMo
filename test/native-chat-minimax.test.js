import { writeFile } from 'node:fs/promises';
import { decisions } from './helpers/native-chat-fixture.js';
import { serializePersistableJson } from '../src/persistability.js';
import { admitPackageArchiveManifest } from '../src/package-archive.js';
import { loadAdmittedArtifact, admitCapturedArtifactBytes } from '../src/artifact-admission.js';
import { probeOpenClawTarget } from '../src/openclaw-probe.js';
import assert from 'node:assert/strict';
import { readFile, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { buildSupportContractInputs } from './helpers/build-contract-fixture.js';
import { buildBuildContract, validateBuildContract } from '../src/build-contract.js';
import { validateUserNeed } from '../src/user-need.js';
import { fixture, source } from './helpers/native-chat-fixture.js';
import { buildOpenClawInstallPlan } from '../src/openclaw-install-plan.js';
import * as native from '../src/native-chat-runtime.js';
import { isOpenClawTargetNodeSupported } from '../src/runtime-compatibility.js';

const profile = 'minimax-m3-cn-v1';
const hash=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
const preflight=o=>Object.fromEntries(['plan','archivePath','executablePath','stateRoot','budgetRoot','descriptorAdmission','probeAdmission','blueprintAdmission','buildContractAdmission'].map(k=>[k,o[k]]));
const baseNeed = JSON.parse(await readFile(new URL('../examples/support-triage.need.json', import.meta.url)));

test('authentic M3 planning authority selects the same model through the build contract', async t => {
  const f = await buildSupportContractInputs({ userNeed: { ...baseNeed, execution_profile: 'native-chat', native_model_profile: profile } });
  t.after(() => rm(f.root, { recursive: true, force: true }));
  assert.equal(f.values.designPlan.native_model_profile, profile);
  assert.equal(f.values.blueprint.native_model_profile, profile);
  const contract = buildBuildContract(f.values.blueprint, f.values.designPlan, f.values.discoveryApproval,
    f.values.decisionLedger, { target: 'openclaw', admissions: f.admissions });
  assert.equal(contract.specification.runtimeBinding.model, 'MiniMax-M3');
  assert.equal(contract.specification.runtimeBinding.modelProfile, profile);
  assert.equal(validateBuildContract(contract).ok, true);
  const changed = structuredClone(contract);
  changed.specification.runtimeBinding.model = 'deepseek-v4-flash';
  assert.equal(validateBuildContract(changed).ok, false);
});

test('M3 selection cannot be smuggled into legacy needs or use an unknown value', () => {
  for (const native_model_profile of [null, undefined, 'MiniMax-M3', 'minimax-m3-global-v1']) {
    assert.equal(validateUserNeed({ ...baseNeed, execution_profile: 'native-chat', native_model_profile }).ok, false);
  }
  assert.equal(validateUserNeed({ ...baseNeed, native_model_profile: profile }).ok, false);
});

test('model selection in a plan cannot replace the admitted archive before authority consumption', {skip:!isOpenClawTargetNodeSupported(process.versions.node)}, async t => {
  const {options:o}=await fixture(t);
  const plan=buildOpenClawInstallPlan({execution_profile:'native-chat',lifecycle:'install',
    ...Object.fromEntries(['archiveBinding','target','authorityRootBinding','officialConfigDryRun'].map(k=>[k,o.plan[k]])),
    nativeBinding:{...o.plan.nativeBinding,modelProfile:profile}});
  const before=await readFile(path.join(o.authorityRoot,'consumption.jsonl'));
  await assert.rejects(native.preflightNativeChatInstall({...preflight(o),plan}));
  assert.deepEqual(await readFile(path.join(o.authorityRoot,'consumption.jsonl')),before);
  await assert.rejects(lstat(o.stateRoot),{code:'ENOENT'});
});

test('M3 installation derives model and activation key scope from genuine M3 archive', {skip:!isOpenClawTargetNodeSupported(process.versions.node)}, async t => {
  const executable=source.replace("model:'deepseek/deepseek-v4-flash'",'model:cfg.agents.defaults.model.primary');
  const {options:o}=await fixture(t,executable,undefined,profile);
  const receipt=await native.installNativeChat(o);assert.equal(receipt.status,'complete');
  const config=JSON.parse(await readFile(path.join(o.stateRoot,'config.json'),'utf8'));
  assert.equal(config.agents.defaults.model.primary,'minimax-cn/MiniMax-M3');
  assert.equal(config.models.providers['minimax-cn'].models[0].id,'MiniMax-M3');
  assert.equal(config.models.providers['minimax-cn'].apiKey.id,'AGENTMO_NATIVE_PROXY_TOKEN');
  const plan=buildOpenClawInstallPlan({execution_profile:'native-chat',lifecycle:'activate',
    ...Object.fromEntries(['archiveBinding','target','nativeBinding','authorityRootBinding','officialConfigDryRun'].map(k=>[k,o.plan[k]])),
    predecessor:{kind:'installed-native-root',installPlanDigest:o.plan.installPlanDigest,
      installReceiptDigest:hash(JSON.stringify(receipt,null,2)+'\n'),rootIdentity:receipt.rootIdentity}});
  assert.deepEqual(plan.sensitiveActions[0].environmentNames,['MINIMAX_API_KEY']);
  assert.deepEqual(plan.sensitiveActions[0].argv,['native-chat-proxy','https://api.minimax.cn/v1/chat/completions']);
  await native.preflightNativeChatActivation({...preflight(o),plan,installReceipt:receipt,authorityRoot:o.authorityRoot});
  const inputs={...preflight(o),plan,installReceipt:receipt,authorityRoot:o.authorityRoot};
  const journal=await readFile(path.join(o.authorityRoot,'consumption.jsonl'));
  for(const key of ['blueprintAdmission','buildContractAdmission']){
    const missing={...inputs};delete missing[key];await assert.rejects(native.preflightNativeChatActivation(missing));
    await assert.rejects(native.preflightNativeChatActivation({...inputs,[key]:{...inputs[key]}}));
  }
  assert.deepEqual(await readFile(path.join(o.authorityRoot,'consumption.jsonl')),journal);
});

const bytes=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
test('rehashed M3 resource cannot replace genuine DeepSeek planning authority through direct install',{skip:!isOpenClawTargetNodeSupported(process.versions.node)},async t=>{
 const executable=source.replace("model:'deepseek/deepseek-v4-flash'",'model:cfg.agents.defaults.model.primary');
 const {fixture:f,options:o,root}=await fixture(t,executable);
 const archive=JSON.parse(await readFile(o.archivePath)),index=archive.members.findIndex(m=>m.relativePath==='resources/runtime-binding.json');
 const resource=JSON.parse(Buffer.from(archive.members[index].contentBase64,'base64'));
 resource.declaredContract.model='MiniMax-M3';resource.declaredContract.modelProfile='minimax-m3-cn-v1';
 const payload=bytes(resource),manifest=JSON.parse(Buffer.from(archive.manifestContentBase64,'base64'));
 const descriptor={relativePath:archive.members[index].relativePath,type:'file',mode:archive.members[index].mode,byteLength:payload.length,sha256:hash(payload)};
 manifest.members[index]=descriptor;manifest.inventoryDigest=hash(Buffer.from(serializePersistableJson(manifest.members,{subject:'package-member-inventory'})));
 archive.manifestContentBase64=bytes(manifest).toString('base64');archive.manifestDigest=hash(bytes(manifest));archive.inventoryDigest=manifest.inventoryDigest;
 archive.members[index]={...descriptor,contentBase64:payload.toString('base64')};
 const archivePath=path.join(root,'rehashed-source.d42'),wire=bytes(archive),archiveDigest=hash(wire);await writeFile(archivePath,wire,{flag:'wx'});
 const admittedArchive=await admitPackageArchiveManifest({archivePath,expectedArchiveDigest:archiveDigest});
 const blueprint=await loadAdmittedArtifact({subject:'blueprint',filePath:f.paths.blueprint,expectedDigest:f.digests.blueprint});
 const contract=await loadAdmittedArtifact({subject:'build-contract',filePath:f.paths['build-contract'],expectedDigest:f.digests['build-contract']});
 const approval=await loadAdmittedArtifact({subject:'plan-approval',filePath:f.paths['plan-approval'],expectedDigest:f.digests['plan-approval']});
 const carrier=await loadAdmittedArtifact({subject:'openclaw-target-carrier-admission',filePath:f.paths['openclaw-target-carrier-admission'],expectedDigest:f.digests['openclaw-target-carrier-admission'],companions:{blueprint,'build-contract':contract,'plan-approval':approval,'openclaw-target-descriptor':o.descriptorAdmission}});
 const probe=await probeOpenClawTarget({archivePath,expectedArchiveDigest:archiveDigest,blueprintPath:f.paths.blueprint,expectedBlueprintDigest:f.digests.blueprint,buildContractPath:f.paths['build-contract'],expectedBuildContractDigest:f.digests['build-contract'],planApprovalPath:f.paths['plan-approval'],expectedPlanApprovalDigest:f.digests['plan-approval'],targetDescriptorPath:f.paths['openclaw-target-descriptor'],expectedTargetDescriptorDigest:f.digests['openclaw-target-descriptor'],targetCarrierAdmissionPath:f.paths['openclaw-target-carrier-admission'],expectedTargetCarrierAdmissionDigest:f.digests['openclaw-target-carrier-admission'],targetRoot:path.dirname(o.executablePath)});
 const probeAdmission=admitCapturedArtifactBytes({subject:'openclaw-probe',bytes:bytes(probe),expectedDigest:hash(bytes(probe)),companions:{'package-manifest':admittedArchive.manifest,'openclaw-target-carrier-admission':carrier,'openclaw-target-descriptor':o.descriptorAdmission}});
 const observation=probe.cli.observations.find(x=>x.id==='config-validation');
 const plan=buildOpenClawInstallPlan({execution_profile:'native-chat',lifecycle:'install',authorityRootBinding:o.plan.authorityRootBinding,
  archiveBinding:{archiveSha256:archiveDigest,manifestDigest:admittedArchive.manifestDigest,inventoryDigest:admittedArchive.inventoryDigest,members:admittedArchive.members},
  nativeBinding:{...o.plan.nativeBinding,modelProfile:'minimax-m3-cn-v1'},target:{...o.plan.target,probeFingerprintDigest:probe.fingerprintDigest},officialConfigDryRun:{commandDigest:hash(bytes(observation.argv)),resultDigest:observation.standardOutputFacts.digest,accepted:true}});
 const journal=path.join(o.authorityRoot,'consumption.jsonl'),before=await readFile(journal);
 await assert.rejects(native.installNativeChat({...o,plan,archivePath,probeAdmission,...decisions(plan,'rehash-source')}),{code:'AGENTMO_NATIVE_INSTALL_REJECTED'});
 assert.deepEqual(await readFile(journal),before);await assert.rejects(lstat(o.stateRoot),{code:'ENOENT'});
});
