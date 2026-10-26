import { isDeepStrictEqual } from 'node:util';
import { NATIVE_CHAT_CASES, buildBehaviorCaseResult, behaviorEvidenceDigest as hash } from './behavior-evidence.js';
import { assertPersistable } from './persistability.js';
import { admittedArtifactProvenance, admitCapturedArtifactBytes } from './artifact-admission.js';
import { isPiInstallReceiptAdmission } from './pi-install.js';
import { validatePiInstallPlan, piHash, piKeys, piReject, readPiPrivateFile } from './pi-install-plan.js';
import { verifyNativeAuthorityConsumption } from './native-chat-authority.js';
export const PI_CHAT_ACCEPTANCE_SCHEMA_VERSION = 'agentmo.pi-native-chat-acceptance.v1';
const DIGEST = /^sha256:[a-f0-9]{64}$/u, UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const runtimeDigests = ['blueprintDigest','packageArchiveDigest','installReceiptDigest','activationPlanDigest','nativeBindingDigest','targetDescriptorDigest','sdkClosureDigest','runtimeSourceDigest'];
const observed = new WeakSet();
export const isPiChatAcceptanceAdmission = value => observed.has(value);
const integer = n => Number.isSafeInteger(n) && n >= 0;
function check(value) { if (!value) piReject(); }
function validRuntime(r) {
  check(piKeys(r,['native_runtime','agentId','targetVersion','model','mainSessionKey','freshSessionKey','caseSessions','caseActivationDigests','caseConsumptionDigests',...runtimeDigests]));
  check(r.native_runtime === 'pi' && /^[a-z][a-z0-9-]{0,63}$/u.test(r.agentId) && r.targetVersion === '1.2.0' && r.model === 'agentmo-budget/MiniMax-M3'
    && UUID.test(r.mainSessionKey) && UUID.test(r.freshSessionKey) && r.mainSessionKey !== r.freshSessionKey && runtimeDigests.every(k=>DIGEST.test(r[k])));
  const ids=NATIVE_CHAT_CASES.map(s=>s.id);
  check(piKeys(r.caseSessions,ids) && piKeys(r.caseActivationDigests,ids) && piKeys(r.caseConsumptionDigests,ids));
  const isolated=[];
  for(const s of NATIVE_CHAT_CASES) { const session=r.caseSessions[s.id];
    check(UUID.test(session) && DIGEST.test(r.caseActivationDigests[s.id]) && DIGEST.test(r.caseConsumptionDigests[s.id]));
    if(s.sessionRole==='main') check(session===r.mainSessionKey);
    else if(s.sessionRole==='fresh') check(session===r.freshSessionKey);
    else { check(session!==r.mainSessionKey && session!==r.freshSessionKey);isolated.push(session); }
  }
  check(new Set(isolated).size===isolated.length);
}
export function piChatCaseDefinitions(runtime) {
  validRuntime(runtime);
  return NATIVE_CHAT_CASES.map(s=>({caseId:s.id,caseClass:'pi-native-chat',testDigest:hash({native_runtime:'pi',spec:s}),inputDigest:piHash(s.input),
    generationId:runtime.caseActivationDigests[s.id],runtimeDigest:hash(runtime),executorId:'pi-native-chat-operator',reviewerId:'independent-pi-chat-reviewer',rubricDigest:hash(s.rubric),
    mechanicalCheckIds:['exact-routing','no-background-requests','no-tools','single-budgeted-request'].sort(),rubricCheckIds:[...s.rubric],maxAgeMs:3600000}));
}
export function validatePiChatAcceptanceArtifact(v) {
  try {
    assertPersistable(v,{subject:'pi-native-chat-acceptance'});
    check(piKeys(v,['schemaVersion','runtime','observedAt','cases']) && v.schemaVersion===PI_CHAT_ACCEPTANCE_SCHEMA_VERSION && integer(v.observedAt));
    const definitions=piChatCaseDefinitions(v.runtime),seen=new Set(),results=[];
    check(Array.isArray(v.cases)&&v.cases.length<=19);
    for(const item of v.cases) {
      check(piKeys(item,['caseId','configuration','observation'])&&!seen.has(item.caseId));seen.add(item.caseId);
      const index=NATIVE_CHAT_CASES.findIndex(s=>s.id===item.caseId);check(index>=0);
      const s=NATIVE_CHAT_CASES[index],c=item.configuration,o=item.observation,r=v.runtime;
      check(isDeepStrictEqual(c?.definition,definitions[index])&&c.now===v.observedAt);
      check(piKeys(o,['native_runtime','agentId','targetVersion','model','sessionKey','activationPlanDigest','transport','providerMode','upstreamRequests','toolCalls','backgroundRequests','budgetBeforeFen','budgetAfterFen','inputCodePoints','status','stopReason','attempts']));
      check(['native_runtime','agentId','targetVersion','model','sessionKey','activationPlanDigest','transport','providerMode','status'].every(k=>typeof o[k]==='string'&&o[k].length<=160)
        && ['upstreamRequests','toolCalls','backgroundRequests','budgetBeforeFen','budgetAfterFen','inputCodePoints','attempts'].every(k=>integer(o[k])) && [null,'stop','length','toolUse','error','aborted'].includes(o.stopReason));
      if(c.execution!==null) check(c.execution.evidenceDigest===hash(o));
      const result=buildBehaviorCaseResult(c);
      const matches=o.native_runtime==='pi' && ['agentId','targetVersion','model'].every(k=>o[k]===r[k]) && o.sessionKey===r.caseSessions[s.id]
        && o.activationPlanDigest===r.caseActivationDigests[s.id] && o.transport===s.transport && o.providerMode===s.providerMode && o.status===s.status
        && o.toolCalls===0 && o.backgroundRequests===0 && o.upstreamRequests===s.upstreamRequests && o.attempts===1
        && o.inputCodePoints===[...s.input].length && o.budgetAfterFen-o.budgetBeforeFen===s.reservedFen && o.budgetAfterFen<=10000
        && o.stopReason===(s.status==='success'?'stop':null);
      results.push({id:s.id,passed:result.passed&&matches,evidenceRefs:result.evidenceRefs});
    }
    return {ok:true,errors:[],entryVerified:results.length===19&&results.every(r=>r.passed),results:results.sort((a,b)=>a.id.localeCompare(b.id))};
  } catch { return {ok:false,errors:['pi_chat_acceptance_invalid'],entryVerified:false,results:[]}; }
}
export function verifyPiDeliverySources({blueprint,packageManifest,activationPlan,installReceipt}) {
  check(isPiInstallReceiptAdmission(installReceipt));
  const a={blueprint,packageManifest,activationPlan,installReceipt},subjects={blueprint:'blueprint',packageManifest:'package-manifest',activationPlan:'pi-install-plan',installReceipt:'pi-install-receipt'};
  const sources=Object.fromEntries(Object.entries(a).map(([k,h])=>[k,admittedArtifactProvenance(h,{subject:subjects[k],value:h?.value})]));
  const b=blueprint.value,m=packageManifest.value,p=activationPlan.value,r=installReceipt.value;
  check(b.native_runtime==='pi'&&m.native_runtime==='pi'&&validatePiInstallPlan(p).ok&&p.lifecycle==='activate'
    && p.sourceBindings.blueprint.digest===sources.blueprint.digest && m.sourceBindings.blueprintDigest===sources.blueprint.digest
    && p.archiveBinding.manifestDigest===sources.packageManifest.digest && p.archiveBinding.inventoryDigest===m.inventoryDigest
    && p.predecessor.receiptDigest===sources.installReceipt.digest && p.predecessor.installPlanDigest===r.installPlanDigest
    && isDeepStrictEqual(p.predecessor.rootIdentity,r.rootIdentity)&&isDeepStrictEqual(p.nativeBinding,r.nativeBinding)
    && isDeepStrictEqual(p.sourceBindings,r.sourceBindings)&&isDeepStrictEqual(p.archiveBinding,r.archiveBinding));
  return sources;
}
export async function admitPiChatAcceptance(options) {
  check(piKeys(options,['filePath','expectedDigest','admissions','authorityRoot','stateRoot'])&&piKeys(options.admissions,['blueprint','packageManifest','activationPlan','installReceipt','acceptance','casePlans'])&&options.admissions.acceptance===null);
  const {casePlans,...a}=options.admissions;delete a.acceptance;
  const sources=verifyPiDeliverySources(a),p=a.activationPlan.value;
  const bytes=(await readPiPrivateFile(options.filePath)).bytes;check(piHash(bytes)===options.expectedDigest);
  const admission=admitCapturedArtifactBytes({subject:'pi-native-chat-acceptance',bytes,expectedDigest:options.expectedDigest}),v=admission.value,r=v.runtime;
  check(r.blueprintDigest===sources.blueprint.digest&&r.packageArchiveDigest===p.archiveBinding.archiveDigest&&r.installReceiptDigest===sources.installReceipt.digest
    &&r.activationPlanDigest===p.installPlanDigest&&r.nativeBindingDigest===hash(p.nativeBinding)&&r.targetDescriptorDigest===p.nativeBinding.targetDescriptorDigest
    &&r.runtimeSourceDigest===p.nativeBinding.runtimeSourceDigest&&r.sdkClosureDigest===a.packageManifest.value.targetCompatibility[0].sdkClosureDigest
    &&r.agentId===p.nativeBinding.agentId&&piHash(options.stateRoot)===p.nativeBinding.stateRootDigest&&piKeys(casePlans,v.cases.map(c=>c.caseId)));
  for(const item of v.cases) {
    const h=casePlans[item.caseId];admittedArtifactProvenance(h,{subject:'pi-install-plan',value:h?.value});const plan=h.value;
    check(validatePiInstallPlan(plan).ok&&plan.lifecycle==='activate'&&plan.installPlanDigest===r.caseActivationDigests[item.caseId]
      &&isDeepStrictEqual(plan.nativeBinding,p.nativeBinding)&&isDeepStrictEqual(plan.predecessor,p.predecessor)&&isDeepStrictEqual(plan.sourceBindings,p.sourceBindings)
      &&isDeepStrictEqual(plan.archiveBinding,p.archiveBinding)&&isDeepStrictEqual(plan.authorityRootBinding,p.authorityRootBinding)
      &&plan.approvedCases.some(c=>c.caseId===item.caseId&&c.sessionId===r.caseSessions[item.caseId]&&c.inputDigest===piHash(NATIVE_CHAT_CASES.find(s=>s.id===item.caseId).input)));
    await verifyNativeAuthorityConsumption({authorityRoot:options.authorityRoot,plan,consumptionDigest:r.caseConsumptionDigests[item.caseId]});
  }
  observed.add(admission);return admission;
}
