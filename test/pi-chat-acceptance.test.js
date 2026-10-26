import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { withPiRuntimeFixture } from './helpers/pi-runtime-fixture.js';
import { admitValue, digest } from './helpers/pi-native-fixture.js';
import { admitCapturedArtifactBytes } from '../src/artifact-admission.js';
import { buildDeliveryReport, validateDeliveryReportArtifact } from '../src/delivery-report.js';
import { NATIVE_CHAT_CASES, behaviorEvidenceDigest as hash } from '../src/behavior-evidence.js';
import { buildPiInstallPlan, piBytes } from '../src/pi-install-plan.js';
import { buildPiInstallApproval, buildPiSensitiveActionDecision, buildPiConflictApproval } from '../src/pi-install-approval.js';
import { consumeNativeAuthoritySet } from '../src/native-chat-authority.js';
import { piChatCaseDefinitions, validatePiChatAcceptanceArtifact, admitPiChatAcceptance } from '../src/pi-chat-acceptance.js';
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const now = Date.now();
function sample(runtime) {
  return {schemaVersion:'agentmo.pi-native-chat-acceptance.v1',runtime,observedAt:now,cases:piChatCaseDefinitions(runtime).map((definition,i)=>{
    const spec=NATIVE_CHAT_CASES[i];
    const observation={native_runtime:'pi',agentId:runtime.agentId,targetVersion:runtime.targetVersion,model:runtime.model,sessionKey:runtime.caseSessions[spec.id],
      activationPlanDigest:runtime.caseActivationDigests[spec.id],transport:spec.transport,providerMode:spec.providerMode,upstreamRequests:spec.upstreamRequests,toolCalls:0,backgroundRequests:0,
      budgetBeforeFen:100,budgetAfterFen:100+spec.reservedFen,inputCodePoints:[...spec.input].length,status:spec.status,stopReason:spec.status==='success'?'stop':null,attempts:1};
    const execution={...Object.fromEntries(['caseId','caseClass','testDigest','inputDigest','generationId','runtimeDigest','executorId'].map(k=>[k,definition[k]])),outputDigest:digest('synthetic'),evidenceDigest:hash(observation),startedAt:now-200,completedAt:now-100,checks:definition.mechanicalCheckIds.map(id=>({id,pass:true}))};
    const review={executionDigest:hash(execution),reviewerId:definition.reviewerId,rubricDigest:definition.rubricDigest,reviewedAt:now-50,checks:definition.rubricCheckIds.map(id=>({id,pass:true}))};
    return {caseId:spec.id,observation,configuration:{caseId:spec.id,caseClass:definition.caseClass,definition,execution,review,now}};
  })};
}
function rebind(value) { for(const c of value.cases) { c.configuration.execution.evidenceDigest=hash(c.observation);c.configuration.review.executionDigest=hash(c.configuration.execution); } return value; }
async function fixture(fn) {
  return withPiRuntimeFixture(async f=>{
    const caseSessions=Object.fromEntries(NATIVE_CHAT_CASES.map((s,i)=>[s.id,s.sessionRole==='main'?uuid(1):s.sessionRole==='fresh'?uuid(2):uuid(i+10)]));
    const casePlans={},caseActivationDigests={},caseConsumptionDigests={};
    for(const [i,s] of NATIVE_CHAT_CASES.entries()) {
      const plan=buildPiInstallPlan({lifecycle:'activate',activationId:uuid(i+100),admissions:f.sourceAdmissions,stateRoot:f.stateRoot,
        authorityRootBinding:f.plan.authorityRootBinding,budgetReference:f.plan.nativeBinding.budgetReference,ports:{chat:19492,proxy:19493},predecessor:f.runtimeOptions.sourceAdmissions.installReceipt,
        approvedCases:[{caseId:s.id,sessionId:caseSessions[s.id],inputDigest:digest(s.input)}]});
      const dir=path.join(f.root,`case-${i}`);await import('node:fs/promises').then(fs=>fs.mkdir(dir));casePlans[s.id]=await admitValue(dir,plan,'pi-install-plan');caseActivationDigests[s.id]=plan.installPlanDigest;
      const common={plan,decision:'approve',issuedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+60000).toISOString()};
      caseConsumptionDigests[s.id]=(await consumeNativeAuthoritySet({authorityRoot:f.authorityRoot,stateRoot:f.stateRoot,plan,
        ordinaryApproval:buildPiInstallApproval({...common,useNonce:`case-${i}-ordinary`}),sensitiveDecisions:plan.sensitiveActions.map((action,j)=>buildPiSensitiveActionDecision({...common,action,useNonce:`case-${i}-sensitive-${j}`})),
        conflictApproval:buildPiConflictApproval({...common,conflicts:[],useNonce:`case-${i}-conflict`})})).consumptionDigest;
    }
    const plan=f.activationPlan;
    const runtime={native_runtime:'pi',agentId:'meeting-text',targetVersion:'1.2.0',model:'agentmo-budget/MiniMax-M3',mainSessionKey:uuid(1),freshSessionKey:uuid(2),caseSessions,caseActivationDigests,caseConsumptionDigests,
      blueprintDigest:f.sourceAdmissions.blueprint.digest,packageArchiveDigest:plan.archiveBinding.archiveDigest,installReceiptDigest:f.runtimeOptions.sourceAdmissions.installReceipt.digest,
      activationPlanDigest:plan.installPlanDigest,nativeBindingDigest:hash(plan.nativeBinding),targetDescriptorDigest:plan.nativeBinding.targetDescriptorDigest,sdkClosureDigest:f.sourceAdmissions.targetDescriptor.value.closure.sdkClosureDigest,runtimeSourceDigest:plan.nativeBinding.runtimeSourceDigest};
    const admissions={blueprint:f.sourceAdmissions.blueprint,packageManifest:f.sourceAdmissions.archive.manifest,activationPlan:f.runtimeOptions.planAdmission,installReceipt:f.runtimeOptions.sourceAdmissions.installReceipt,acceptance:null};
    const nativeChat=Object.fromEntries(['packageManifest','activationPlan','installReceipt','acceptance'].map(k=>[k,admissions[k]?.value??null]));
    return fn({...f,runtime,casePlans,admissions,nativeChat});
  });
}
test('requires all nineteen Pi observations and independent reviews',async()=>fixture(async f=>{
  const build=(a,nowArg=now)=>buildDeliveryReport(f.admissions.blueprint.value,{nativeChat:{...f.nativeChat,acceptance:a?.value??null},admissions:{...f.admissions,acceptance:a},now:nowArg});
  const partial=await build(null);assert.equal(partial.status,'partial');assert.equal(partial.legacySourceGaps.count,15);assert.equal(partial.piGaps.length,19);
  const flags={blueprint:'blueprint',buildContract:'build-contract',planApproval:'plan-approval',targetDescriptor:'target-descriptor',targetCarrierAdmission:'target-carrier-admission',archive:'archive',installPlan:'installed-plan',installReceipt:'install-receipt',activationPlan:'install-plan'};
  const args=['--execution-profile','native-chat','--target-root',f.stateRoot,'--authority-root',f.authorityRoot,...Object.entries(f.runtimeOptions.sourceFiles).flatMap(([k,b])=>[`--${flags[k]}`,b.filePath,`--${flags[k]}-sha256`,b.expectedDigest]),'--json'];
  const {runNativeDeliveryCommand}=await import('../src/native-chat-cli.js');assert.equal((await runNativeDeliveryCommand(args)).report.status,'partial');
  const accepted=sample(f.runtime);assert.equal(validatePiChatAcceptanceArtifact(accepted).entryVerified,true);
  const admit=async value=>{const file=path.join(f.root,`accept-${Math.random()}.json`);await import('node:fs/promises').then(fs=>fs.writeFile(file,piBytes(value),{mode:0o600}));return admitPiChatAcceptance({filePath:file,expectedDigest:digest(piBytes(value)),admissions:{...f.admissions,casePlans:Object.fromEntries(value.cases.map(c=>[c.caseId,f.casePlans[c.caseId]]))},authorityRoot:f.authorityRoot,stateRoot:f.stateRoot});};
  const a=await admit(accepted),report=await build(a);assert.equal(report.nativeEntryVerified,true);
  assert.equal(report.deliveryReady,false);assert.equal(report.domainCertified,false);assert.equal(report.productionApproved,false);assert.equal(validateDeliveryReportArtifact(report).ok,true);
  const companions={blueprint:f.admissions.blueprint,'package-manifest':f.admissions.packageManifest,'pi-install-plan':f.admissions.activationPlan,'pi-install-receipt':f.admissions.installReceipt,'pi-native-chat-acceptance':a};
  assert.equal(admitCapturedArtifactBytes({subject:'delivery-report',bytes:piBytes(report),expectedDigest:digest(piBytes(report)),companions}).value.nativeEntryVerified,true);
  await assert.rejects(build(structuredClone(a)));
  await assert.rejects(buildDeliveryReport(f.admissions.blueprint.value,{nativeChat:f.nativeChat,admissions:{...f.admissions,installReceipt:structuredClone(f.admissions.installReceipt)},now}));
  const raw=admitCapturedArtifactBytes({subject:'pi-native-chat-acceptance',bytes:piBytes(accepted),expectedDigest:digest(piBytes(accepted))});await assert.rejects(build(raw));
  for(const mutate of [x=>x.cases.pop(),x=>x.cases[0].observation.sessionKey=uuid(99),x=>x.cases[0].observation.upstreamRequests=2,x=>x.cases[0].observation.providerMode='mock',x=>x.cases[0].observation.stopReason='length',x=>x.cases[0].observation.attempts=2,x=>x.cases[0].configuration.review.checks[0].pass=false]) {
    const v=structuredClone(accepted);mutate(v);rebind(v);const result=validatePiChatAcceptanceArtifact(v);assert.equal(result.entryVerified,false); if(result.ok) assert.equal((await build(await admit(v))).status,'partial');
  }
  for(const mutate of [x=>x.runtime.native_runtime='openclaw',x=>x.runtime.targetVersion='2026.9.4',x=>x.runtime.mainSessionKey='agent:meeting-text:main',x=>x.cases[0].configuration.definition.maxAgeMs=999999999,x=>x.observedAt+=3600001,x=>x.cases[0].observation.rawTranscript='private']) { const v=structuredClone(accepted);mutate(v);assert.equal(validatePiChatAcceptanceArtifact(v).ok,false); }
  assert.equal((await build(a,now+3600001)).status,'partial');
  for(const runtime of [{...f.runtime,sdkClosureDigest:digest('old')},{...f.runtime,caseConsumptionDigests:{...f.runtime.caseConsumptionDigests,entry:digest('not consumed')}},{...f.runtime,caseActivationDigests:{...f.runtime.caseActivationDigests,entry:digest('old OpenClaw plan')}}])await assert.rejects(admit(sample(runtime)));
  const bad=structuredClone(accepted);bad.schemaVersion='agentmo.native-chat-acceptance.v1';assert.throws(()=>admitCapturedArtifactBytes({subject:'pi-native-chat-acceptance',bytes:piBytes(bad),expectedDigest:digest(piBytes(bad))}));
  const missing={...f.casePlans};delete missing.entry;await assert.rejects(admitPiChatAcceptance({filePath:path.join(f.root,'missing'),expectedDigest:digest('x'),admissions:{...f.admissions,casePlans:missing},authorityRoot:f.authorityRoot,stateRoot:f.stateRoot}));
  const ledger=await readFile(path.join(f.authorityRoot,'consumption.jsonl'),'utf8');assert.equal(ledger.includes('synthetic output'),false);
}));
