import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isOpenClawTargetNodeSupported } from '../src/runtime-compatibility.js';
import { activationFixture } from './helpers/native-chat-fixture.js';
import { admitPackageArchiveManifest } from '../src/package-archive.js';
import { loadAdmittedArtifact, admitCapturedArtifactBytes } from '../src/artifact-admission.js';
import { buildDeliveryReport, validateDeliveryReportArtifact } from '../src/delivery-report.js';
import * as behavior from '../src/behavior-evidence.js';
import { getArtifactContract } from '../src/artifact-contract.js';
import { nativeChatModelProfile } from '../src/native-chat-model-profile.js';
import { gatewaySource } from './helpers/native-chat-fixture.js';

const bytes=x=>Buffer.from(`${JSON.stringify(x,null,2)}\n`);
const hash=x=>'sha256:'+createHash('sha256').update(x).digest('hex');
const canonical=x=>JSON.stringify(x,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const digest=x=>hash(canonical(x));
const now=2_000_000;

async function fixture(t,modelProfile){
  const executable=gatewaySource.replace("model:'deepseek/deepseek-v4-flash'",'model:cfg.agents.defaults.model.primary');
  const {fixture:f,options:o}=await activationFixture(t,executable,undefined,modelProfile);
  const blueprint=await loadAdmittedArtifact({subject:'blueprint',filePath:f.paths.blueprint,expectedDigest:f.digests.blueprint});
  const archive=await admitPackageArchiveManifest({archivePath:o.archivePath,expectedArchiveDigest:o.plan.archiveBinding.archiveSha256});
  const activationPlan=admitCapturedArtifactBytes({subject:'openclaw-install-plan',bytes:bytes(o.plan),expectedDigest:hash(bytes(o.plan))});
  const installReceipt=admitCapturedArtifactBytes({subject:'openclaw-install-receipt',bytes:bytes(o.installReceipt),expectedDigest:hash(bytes(o.installReceipt))});
  return {blueprint,options:o,nativeChat:{packageManifest:archive.manifest.value,activationPlan:activationPlan.value,installReceipt:installReceipt.value,acceptance:null},
    admissions:{blueprint,packageManifest:archive.manifest,activationPlan,installReceipt,acceptance:null}};
}
function sample(runtime){
  assert.equal(typeof behavior.nativeChatCaseDefinitions,'function');
  const definitions=behavior.nativeChatCaseDefinitions(runtime);
  return {schemaVersion:'agentmo.native-chat-acceptance.v1',runtime,observedAt:now,cases:definitions.map(definition=>{
    const spec=behavior.NATIVE_CHAT_CASES.find(c=>c.id===definition.caseId);
    const observation={agentId:runtime.agentId,targetVersion:runtime.targetVersion,model:runtime.model,sessionKey:spec.sessionRole==='fresh'?runtime.freshSessionKey:spec.sessionRole==='main'?runtime.mainSessionKey:`agent:${runtime.agentId}:acceptance-${spec.id}`,
      transport:spec.transport,providerMode:spec.providerMode,upstreamRequests:spec.upstreamRequests,toolCalls:0,backgroundRequests:0,budgetBeforeFen:100,budgetAfterFen:100+spec.reservedFen,
      inputCodePoints:[...behavior.NATIVE_CHAT_CASES.find(c=>c.id===definition.caseId).input].length,status:spec.status};
    const execution={...Object.fromEntries(['caseId','caseClass','testDigest','inputDigest','generationId','runtimeDigest','executorId'].map(k=>[k,definition[k]])),outputDigest:hash('synthetic output'),evidenceDigest:digest(observation),startedAt:now-200,completedAt:now-100,checks:definition.mechanicalCheckIds.map(id=>({id,pass:true}))};
    const review={executionDigest:digest(execution),reviewerId:definition.reviewerId,rubricDigest:definition.rubricDigest,reviewedAt:now-50,checks:definition.rubricCheckIds.map(id=>({id,pass:true}))};
    return {caseId:definition.caseId,observation,configuration:{caseId:definition.caseId,caseClass:definition.caseClass,definition,execution,review,now}};
  })};
}
function runtime(f){
  const plan=f.nativeChat.activationPlan;
  return {agentId:plan.nativeBinding.agentId,targetVersion:plan.target.targetVersion,model:nativeChatModelProfile(plan.nativeBinding.modelProfile).nativeModel,mainSessionKey:`agent:${plan.nativeBinding.agentId}:main`,freshSessionKey:`agent:${plan.nativeBinding.agentId}:fresh-acceptance`,
    blueprintDigest:f.blueprint.digest,packageArchiveDigest:plan.archiveBinding.archiveSha256,installReceiptDigest:f.admissions.installReceipt.digest,activationPlanDigest:plan.installPlanDigest,nativeBindingDigest:digest(plan.nativeBinding),targetDescriptorDigest:plan.nativeBinding.targetDescriptorDigest};
}
async function report(f,acceptance){
  const admission=acceptance===null?null:admitCapturedArtifactBytes({subject:'native-chat-acceptance',bytes:bytes(acceptance),expectedDigest:hash(bytes(acceptance))});
  return buildDeliveryReport(f.blueprint.value,{nativeChat:{...f.nativeChat,acceptance:admission?.value??null},admissions:{...f.admissions,acceptance:admission},now});
}

it('native delivery stays partial until exact native UI cases pass',{skip:!isOpenClawTargetNodeSupported(process.versions.node)},async t=>{
  const f=await fixture(t);
  const partial=await report(f,null);assert.equal(partial.nativeEntryVerified,false);assert.equal(partial.status,'partial');
  const accepted=sample(runtime(f));const complete=await report(f,accepted);
  assert.equal(complete.nativeEntryVerified,true);assert.equal(complete.status,'entry-verified');
  assert.equal(complete.deliveryReady,false);assert.equal(complete.domainCertified,false);assert.equal(complete.productionApproved,false);
  assert.equal(validateDeliveryReportArtifact(complete).ok,true);
  for(const id of ['at-limit-input','budget-concurrency','budget-recovery','full-request-limit','history-limit','unknown-structure','state-protection'])assert.ok(accepted.cases.some(c=>c.caseId===id),`mandatory ${id} evidence`);
  const companions={blueprint:f.blueprint,'package-manifest':f.admissions.packageManifest,'openclaw-install-plan':f.admissions.activationPlan,'openclaw-install-receipt':f.admissions.installReceipt,
    'native-chat-acceptance':admitCapturedArtifactBytes({subject:'native-chat-acceptance',bytes:bytes(accepted),expectedDigest:hash(bytes(accepted))})};
  assert.equal(admitCapturedArtifactBytes({subject:'delivery-report',bytes:bytes(complete),expectedDigest:hash(bytes(complete)),companions}).value.nativeEntryVerified,true);
  for(const mutate of [x=>x.cases[0].observation.providerMode='mock',x=>x.cases[0].observation.transport='installed-cli',x=>x.cases[0].observation.agentId='other',x=>x.cases[0].observation.targetVersion='other',x=>x.cases[0].observation.sessionKey='agent:other:main',x=>x.cases[0].observation.upstreamRequests=2,x=>x.cases[0].observation.toolCalls=1,x=>x.cases[0].configuration.review.checks[0].pass=false,x=>x.cases.splice(x.cases.findIndex(c=>c.caseId==='restart'),1),x=>x.cases.splice(x.cases.findIndex(c=>c.caseId==='over-limit-input'),1)]){
    const changed=structuredClone(accepted);mutate(changed);for(const c of changed.cases){c.configuration.execution.evidenceDigest=digest(c.observation);c.configuration.review.executionDigest=digest(c.configuration.execution);}const r=await report(f,changed);assert.equal(r.nativeEntryVerified,false);
  }
  const mismatch=structuredClone(accepted);mismatch.runtime.packageArchiveDigest=hash('other package');
  await assert.rejects(report(f,mismatch));
  const forged={...f,admissions:{...f.admissions,activationPlan:{...f.admissions.activationPlan}}};await assert.rejects(report(forged,accepted));
});

it('M3 acceptance cannot certify a DeepSeek runtime against M3 source bindings',{skip:!isOpenClawTargetNodeSupported(process.versions.node)},async t=>{
  const f=await fixture(t,'minimax-m3-cn-v1'),accepted=sample(runtime(f));
  assert.equal((await report(f,accepted)).nativeEntryVerified,true);
  const wrong=sample({...runtime(f),model:'deepseek/deepseek-v4-flash'});
  await assert.rejects(report(f,wrong));
});

it('native public delivery command exact-loads its sources and preserves a missing-acceptance gap',{skip:!isOpenClawTargetNodeSupported(process.versions.node)},async t=>{
  const f=await fixture(t);
  const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');
  const dir=await mkdtemp(path.join(tmpdir(),'native-delivery-cli-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const files={};for(const [name,value] of Object.entries({blueprint:f.blueprint.value,'install-plan':f.nativeChat.activationPlan,'install-receipt':f.nativeChat.installReceipt})){
    const data=bytes(value),file=path.join(dir,name+'.json');await writeFile(file,data);files[name]=[`--${name}`,file,`--${name}-sha256`,hash(data)];
  }
  const o=f.options;
  const args=['bin/agentmo.js','delivery-report','--execution-profile','native-chat',...files.blueprint,...files['install-plan'],...files['install-receipt'],'--archive',o.archivePath,'--archive-sha256',o.plan.archiveBinding.archiveSha256,'--json'];
  const run=spawnSync(process.execPath,args,{cwd:new URL('..',import.meta.url),encoding:'utf8',timeout:30_000});
  assert.equal(run.status,1);const value=JSON.parse(run.stdout);assert.equal(value.status,'partial');assert.equal(value.nativeEntryVerified,false);
  const wrong=spawnSync(process.execPath,args.map(v=>v===files['install-receipt'][3]?hash('wrong'):v),{cwd:new URL('..',import.meta.url),encoding:'utf8',timeout:30_000});
  assert.equal(wrong.status,1);assert.ok(!Object.hasOwn(JSON.parse(wrong.stdout),'nativeEntryVerified'));
});

it('native acceptance binds fixed definitions, observations, age and independent reviews without raw contents',()=>{
  const contract=getArtifactContract('native-chat-acceptance');assert.ok(contract);
  assert.equal(admitCapturedArtifactBytes({subject:'native-chat-acceptance',bytes:bytes(contract.minimalTemplate),expectedDigest:hash(bytes(contract.minimalTemplate))}).subject,'native-chat-acceptance');
  assert.equal(typeof behavior.validateNativeChatAcceptanceArtifact,'function');
  const r={agentId:'meeting',targetVersion:'2026.9.4',model:'deepseek/deepseek-v4-flash',mainSessionKey:'agent:meeting:main',freshSessionKey:'agent:meeting:fresh',...Object.fromEntries(['blueprintDigest','packageArchiveDigest','installReceiptDigest','activationPlanDigest','nativeBindingDigest','targetDescriptorDigest'].map(k=>[k,hash(k)]))};
  const value=sample(r);assert.equal(behavior.validateNativeChatAcceptanceArtifact(value).ok,true);
  for(const mutate of [x=>x.cases[0].configuration.definition.mechanicalCheckIds=['weaker'],x=>x.cases[0].configuration.execution.outputDigest='raw output',x=>x.cases[0].observation.rawTranscript='private',x=>x.cases[0].configuration.definition.inputDigest=hash('other input'),x=>x.runtime.freshSessionKey=x.runtime.mainSessionKey,x=>x.observedAt+=3_600_001]){
    const changed=structuredClone(value);mutate(changed);assert.equal(behavior.validateNativeChatAcceptanceArtifact(changed).ok,false);
  }
});
