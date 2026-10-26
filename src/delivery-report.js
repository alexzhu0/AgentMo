import { verifyPiDeliverySources, isPiChatAcceptanceAdmission, validatePiChatAcceptanceArtifact } from './pi-chat-acceptance.js';
import { admittedArtifactProvenance as piProvenance } from './artifact-admission.js';
const piAcceptanceProvenance = h => piProvenance(h,{subject:'pi-native-chat-acceptance',value:h.value});
import { BIRTH_REPORT_SCHEMA_VERSION, validateBirthReportArtifact } from "./birth-report.js";
import { BUILD_STATE_SCHEMA_VERSION, validateBuildStateArtifact } from "./build-state.js";
import { validateBlueprint } from "./blueprint.js";
import { nativeChatModelProfile } from "./native-chat-model-profile.js";
import { DOMAIN_EVAL_SCHEMA_VERSION, validateDomainEvalArtifact } from "./domain-eval.js";
import { assertPersistable } from "./persistability.js";
import { NATIVE_CHAT_CASES, validateNativeChatAcceptanceArtifact, behaviorEvidenceDigest } from "./behavior-evidence.js";
import { validateAgentPackageManifest } from "./package-contract.js";
import { buildOpenClawInstallPlan, validateOpenClawInstallPlan } from "./openclaw-install-plan.js";
import { validateOpenClawInstallReceipt } from "./openclaw-install-receipt.js";
import {
  RUN_EVAL_SCHEMA_VERSION,
  RUN_STATE_SCHEMA_VERSION,
  validateRunEvalArtifact,
  validateRunStateArtifact,
} from "./run-state.js";

export const DELIVERY_REPORT_SCHEMA_VERSION = "agentmo.delivery.v1";

const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;

const DELIVERY_REPORT_BASE_CHECK_CONTRACT = freezeCheckContract([
  ["blueprint_valid", "blueprint validates independently"],
  ["build_state_valid", "build-state validates independently"],
  ["run_state_valid", "run-state validates independently"],
  ["run_eval_valid", "run-eval validates independently"],
  ["birth_report_valid", "birth-report validates independently"],
  ["agent_id_match", "all supplied artifacts have the same agent scope"],
  ["target_match", "all supplied target scopes agree"],
  ["build_state_blueprint_provenance", "build-state references the exact blueprint"],
  ["run_state_blueprint_provenance", "run-state references the exact blueprint"],
  ["run_eval_run_state_provenance", "run-eval references the exact run-state"],
  ["run_eval_run_id", "run-eval run id matches run-state"],
  ["birth_blueprint_provenance", "birth-report references the exact blueprint"],
  ["birth_build_state_provenance", "birth-report references the exact build-state"],
  ["birth_run_state_provenance", "birth-report references the exact run-state"],
  ["birth_run_eval_provenance", "birth-report references the exact run-eval"],
  ["birth_run_id", "birth-report run id matches run-state"],
  ["birth_expectation_match", "birth and run expectations agree"],
  ["birth_report_ok", "birth-report passes after independent validation"],
  ["birth_non_certifying", "birth evidence does not elevate other evidence levels"],
]);
const DELIVERY_REPORT_OPTIONAL_DOMAIN_CHECK_CONTRACT = freezeCheckContract([
  ["domain_eval_optional", "domain-eval is explicitly absent"],
]);
const DELIVERY_REPORT_DOMAIN_CHECK_CONTRACT = freezeCheckContract([
  ["domain_eval_valid", "domain-eval validates independently"],
  ["domain_eval_blueprint_provenance", "domain-eval references the exact blueprint"],
  ["domain_eval_non_transitive", "domain evidence does not elevate runtime, delivery, or production"],
  ["domain_eval_ok", "supplied bounded domain evaluation passes"],
]);

export const DELIVERY_REPORT_REQUIRED_CHECK_IDS = Object.freeze({
  withoutDomainEval: Object.freeze([
    ...DELIVERY_REPORT_BASE_CHECK_CONTRACT.map((item) => item.id),
    ...DELIVERY_REPORT_OPTIONAL_DOMAIN_CHECK_CONTRACT.map((item) => item.id),
  ]),
  withDomainEval: Object.freeze([
    ...DELIVERY_REPORT_BASE_CHECK_CONTRACT.map((item) => item.id),
    ...DELIVERY_REPORT_DOMAIN_CHECK_CONTRACT.map((item) => item.id),
  ]),
});

export async function buildDeliveryReport(blueprint, options = {}) {
  if (blueprint?.native_runtime === "pi") return buildPiDeliveryReport(blueprint, options);
  if (blueprint?.execution_profile === "native-chat") return buildNativeDeliveryReport(blueprint, options);
  if (Object.hasOwn(options, "nativeChat")) throw deliveryError("AGENTMO_DELIVERY_REPORT_INVALID");
  const buildState = options.buildState;
  const runState = options.runState;
  const runEval = options.runEval;
  const birthReport = options.birthReport;
  const domainEval = options.domainEval ?? null;
  const domainAdmission = options.admissions?.domainEval ?? null;
  if ((domainEval === null) !== (domainAdmission === null)) throw deliveryError("AGENTMO_DELIVERY_OPTIONAL_INPUT_INVALID");

  const { admittedArtifactProvenance } = await import("./artifact-admission.js");
  const sources = {
    blueprint: admittedArtifactProvenance(options.admissions?.blueprint, { subject: "blueprint", value: blueprint }),
    buildState: admittedArtifactProvenance(options.admissions?.buildState, { subject: "build-state", value: buildState }),
    runState: admittedArtifactProvenance(options.admissions?.runState, { subject: "run-state", value: runState }),
    runEval: admittedArtifactProvenance(options.admissions?.runEval, { subject: "run-eval", value: runEval }),
    birthReport: admittedArtifactProvenance(options.admissions?.birthReport, { subject: "birth-report", value: birthReport }),
    domainEval: domainEval === null
      ? null
      : admittedArtifactProvenance(domainAdmission, { subject: "domain-eval", value: domainEval }),
  };
  const assessment = deriveDeliveryAssessment({
    blueprint,
    buildState,
    runState,
    runEval,
    birthReport,
    domainEval,
    sources,
  });
  const {
    validation,
    buildTargetId,
    runTargetId,
    domainTargetId,
    checks,
    ok,
    domainCertified,
  } = assessment;
  const report = {
    schemaVersion: DELIVERY_REPORT_SCHEMA_VERSION,
    ok,
    agentId: blueprint?.agent_id ?? null,
    target: {
      buildState: buildTargetId,
      runState: runTargetId,
      domainEval: domainTargetId,
    },
    domainCertified,
    runtimePromotionEligible: false,
    deliveryReady: false,
    productionApproved: false,
    sources,
    evidenceLevels: assessment.evidenceLevels,
    checks,
    validation: {
      ok: validation.ok,
      warnings: validation.warnings,
      errors: validation.errors,
    },
    certificationBoundary: {
      runtimeCertifiedByDeliveryReport: false,
      domainCertifiedByDeliveryReport: false,
      deliveryReadyByDeliveryReport: false,
      productionApprovedByDeliveryReport: false,
      domainCertifiedByDomainEval: domainCertified,
    },
    nextActions: assessment.nextActions,
  };
  assertDeliveryReportCandidate(report, {
    blueprint,
    buildState,
    runState,
    runEval,
    birthReport,
    domainEval,
    sources,
  });
  return report;
}

export function validateDeliveryReportArtifact(report, options = {}) {
  if (report?.native_runtime === "pi") return validatePiDeliveryReport(report, options);
  if (report?.execution_profile === "native-chat") return validateNativeDeliveryReport(report, options);
  const errors = [];
  try {
    assertPersistable(report, { subject: "delivery-report" });
    requireExactKeys(report, [
      "schemaVersion", "ok", "agentId", "target", "domainCertified", "runtimePromotionEligible",
      "deliveryReady", "productionApproved", "sources", "evidenceLevels", "checks", "validation",
      "certificationBoundary", "nextActions",
    ], "delivery_report", errors);
    if (report?.schemaVersion !== DELIVERY_REPORT_SCHEMA_VERSION) errors.push("invalid_schema_version");
    if (typeof report?.ok !== "boolean" || !nonEmptyString(report?.agentId)) errors.push("invalid_identity");
    if (report?.runtimePromotionEligible !== false || report?.deliveryReady !== false || report?.productionApproved !== false) errors.push("invalid_promotion_boundary");
    if (!validTarget(report?.target, report?.sources?.domainEval)) errors.push("invalid_target");
    if (!validSources(report?.sources)) errors.push("invalid_sources");
    if (!validEvidenceLevels(report?.evidenceLevels, report?.domainCertified)) errors.push("invalid_evidence_levels");
    if (!validChecks(report?.checks, report, report?.sources?.domainEval !== null)) errors.push("invalid_checks");
    if (!validValidation(report?.validation)) errors.push("invalid_validation");
    if (!hasExactKeys(report?.certificationBoundary, [
      "runtimeCertifiedByDeliveryReport", "domainCertifiedByDeliveryReport", "deliveryReadyByDeliveryReport",
      "productionApprovedByDeliveryReport", "domainCertifiedByDomainEval",
    ])
      || report.certificationBoundary.runtimeCertifiedByDeliveryReport !== false
      || report.certificationBoundary.domainCertifiedByDeliveryReport !== false
      || report.certificationBoundary.deliveryReadyByDeliveryReport !== false
      || report.certificationBoundary.productionApprovedByDeliveryReport !== false
      || report.certificationBoundary.domainCertifiedByDomainEval !== report.domainCertified) errors.push("invalid_certification_boundary");
    if (report.domainCertified !== report.evidenceLevels.domainCertified || !stringArray(report?.nextActions)) errors.push("invalid_domain_boundary");
    if (hasDeliveryValidationContext(options)) {
      const derivation = deriveDeliveryAssessment(options);
      if (!sameJson(report.sources, options.sources)
        || !sameJson(report.checks, derivation.checks)
        || report.ok !== derivation.ok
        || report.agentId !== options.blueprint?.agent_id
        || report.target?.buildState !== derivation.buildTargetId
        || report.target?.runState !== derivation.runTargetId
        || report.target?.domainEval !== derivation.domainTargetId
        || report.domainCertified !== derivation.domainCertified
        || !sameJson(report.evidenceLevels, derivation.evidenceLevels)
        || !sameJson(report.validation, derivation.validation)
        || !sameJson(report.nextActions, derivation.nextActions)) {
        errors.push("delivery_report_source_derivation_invalid");
      }
    }
  } catch {
    errors.push("unsafe_delivery_report_shape");
  }
  return { ok: errors.length === 0, errors };
}

export function formatDeliveryReport(report) {
  if (report.execution_profile === "native-chat") return `AgentMo native entry: ${report.agentId}\nStatus: ${report.status}\nGlobal delivery/domain/production promotion: no\n${report.checks.map(c=>`${c.pass?'PASS':'FAIL'} ${c.id}`).join('\n')}\n`;
  const lines = [
    `AgentMo delivery report: ${report.agentId ?? "unknown"}`,
    `Status: ${report.ok ? "pass" : "fail"}`,
    `Bounded domain certification: ${report.domainCertified ? "yes" : "no"}`,
    "Runtime promotion eligible: no",
    "Delivery ready: no",
    "Production approved: no",
    "Certification: delivery aggregation does not promote runtime, delivery, or production evidence levels",
  ];
  for (const item of report.checks) lines.push(`- ${item.pass ? "PASS" : "FAIL"} ${item.id}: ${item.message}`);
  return `${lines.join("\n")}\n`;
}

function deriveDeliveryAssessment({
  blueprint,
  buildState,
  runState,
  runEval,
  birthReport,
  domainEval,
  sources,
}) {
  const blueprintValidation = validateBlueprint(blueprint);
  const validation = {
    ok: blueprintValidation.ok,
    warnings: blueprintValidation.warnings,
    errors: blueprintValidation.errors,
  };
  const buildTargetId = buildState?.target?.id ?? null;
  const runTargetId = runState?.target?.id ?? null;
  const domainTargetId = domainEval?.target?.effective ?? null;
  const runEvalValidation = validateRunEvalArtifact(runEval, {
    runState,
    source: sources?.runState,
  });
  const birthReportValidation = validateBirthReportArtifact(birthReport, {
    blueprint,
    buildState,
    runState,
    runEval,
    expectStatus: runEval?.expectedStatus,
    sources: {
      blueprint: sources?.blueprint,
      buildState: sources?.buildState,
      runState: sources?.runState,
      runEval: sources?.runEval,
    },
  });
  const domainEvalValidation = domainEval === null
    ? null
    : validateDomainEvalArtifact(domainEval, { blueprint });
  const domainCertified = domainEval !== null
    && domainEvalValidation.ok
    && domainEvalValidation.domainCertified === true;
  const basePasses = [
    blueprintValidation.ok,
    validateBuildStateArtifact(buildState).ok,
    validateRunStateArtifact(runState).ok,
    runEvalValidation.ok,
    birthReportValidation.ok,
    buildState?.agentId === blueprint?.agent_id
      && runState?.agentId === blueprint?.agent_id
      && birthReport?.agentId === blueprint?.agent_id
      && (domainEval === null || domainEval?.agentId === blueprint?.agent_id),
    buildTargetId === runTargetId && (domainEval === null || domainTargetId === runTargetId),
    sameProvenance(buildState?.source, sources?.blueprint),
    sameProvenance(runState?.source?.blueprint, sources?.blueprint),
    sameProvenance(runEval?.source, sources?.runState),
    runEval?.runId === runState?.runId,
    sameProvenance(birthReport?.sources?.blueprint, sources?.blueprint),
    sameProvenance(birthReport?.sources?.buildState, sources?.buildState),
    sameProvenance(birthReport?.sources?.runState, sources?.runState),
    sameProvenance(birthReport?.sources?.runEval, sources?.runEval),
    birthReport?.runtimeEvidence?.runId === runState?.runId,
    birthReport?.expectedStatus === runEval?.expectedStatus
      && birthReport?.actualStatus === runState?.execution?.status
      && runEval?.actualStatus === runState?.execution?.status,
    birthReportValidation.ok && birthReportValidation.artifactValid === true,
    birthReport?.promotionEligible === false
      && birthReport?.evidenceLevels?.domainCertified === false
      && birthReport?.evidenceLevels?.deliveryReady === false
      && birthReport?.evidenceLevels?.productionApproved === false,
  ];
  const baseChecks = buildChecksFromContract(DELIVERY_REPORT_BASE_CHECK_CONTRACT, basePasses);
  const domainChecks = domainEval === null
    ? buildChecksFromContract(DELIVERY_REPORT_OPTIONAL_DOMAIN_CHECK_CONTRACT, [true])
    : buildChecksFromContract(DELIVERY_REPORT_DOMAIN_CHECK_CONTRACT, [
        domainEvalValidation.ok,
        sameProvenance(domainEval?.sources?.blueprint, sources?.blueprint),
        domainEvalValidation.ok
          && domainEval?.certificationBoundary?.runtimeCertifiedByDomainEval === false
          && domainEval?.certificationBoundary?.deliveryReadyByDomainEval === false
          && domainEval?.certificationBoundary?.productionApprovedByDomainEval === false,
        domainCertified,
      ]);
  const checks = [...baseChecks, ...domainChecks];
  const ok = checks.every((item) => item.pass);
  const evidenceLevels = {
    declaredReady: birthReportValidation.ok && birthReport?.evidenceLevels?.declaredReady === true,
    liveSuccess: birthReportValidation.ok && birthReport?.evidenceLevels?.liveSuccess === true,
    domainCertified,
    deliveryReady: false,
    productionApproved: false,
  };
  return {
    validation,
    buildTargetId,
    runTargetId,
    domainTargetId,
    checks,
    ok,
    domainCertified,
    evidenceLevels,
    nextActions: nextActions({
      ok,
      domainCertified,
      liveSuccess: evidenceLevels.liveSuccess,
    }),
  };
}

function buildChecksFromContract(contract, passes) {
  return contract.map((spec, index) => check(spec.id, passes[index], spec.message));
}

function freezeCheckContract(entries) {
  return Object.freeze(entries.map(([id, message]) => Object.freeze({ id, message })));
}

function hasDeliveryValidationContext(options) {
  return options
    && Object.hasOwn(options, "blueprint")
    && Object.hasOwn(options, "buildState")
    && Object.hasOwn(options, "runState")
    && Object.hasOwn(options, "runEval")
    && Object.hasOwn(options, "birthReport")
    && Object.hasOwn(options, "domainEval")
    && Object.hasOwn(options, "sources");
}

function validTarget(value, domainSource) {
  return hasExactKeys(value, ["buildState", "runState", "domainEval"])
    && value.buildState === "openclaw"
    && value.runState === "openclaw"
    && (domainSource === null ? value.domainEval === null : value.domainEval === "openclaw");
}

function validSources(value) {
  return hasExactKeys(value, ["blueprint", "buildState", "runState", "runEval", "birthReport", "domainEval"])
    && validProvenance(value.blueprint, "blueprint", "0.1")
    && validProvenance(value.buildState, "build-state", BUILD_STATE_SCHEMA_VERSION)
    && validProvenance(value.runState, "run-state", RUN_STATE_SCHEMA_VERSION)
    && validProvenance(value.runEval, "run-eval", RUN_EVAL_SCHEMA_VERSION)
    && validProvenance(value.birthReport, "birth-report", BIRTH_REPORT_SCHEMA_VERSION)
    && (value.domainEval === null || validProvenance(value.domainEval, "domain-eval", DOMAIN_EVAL_SCHEMA_VERSION));
}

function validEvidenceLevels(value, domainCertified) {
  return hasExactKeys(value, ["declaredReady", "liveSuccess", "domainCertified", "deliveryReady", "productionApproved"])
    && typeof value.declaredReady === "boolean"
    && typeof value.liveSuccess === "boolean"
    && !(value.declaredReady && value.liveSuccess)
    && value.domainCertified === domainCertified
    && value.deliveryReady === false
    && value.productionApproved === false;
}

function validChecks(value, report, hasDomainEval) {
  const contract = [
    ...DELIVERY_REPORT_BASE_CHECK_CONTRACT,
    ...(hasDomainEval ? DELIVERY_REPORT_DOMAIN_CHECK_CONTRACT : DELIVERY_REPORT_OPTIONAL_DOMAIN_CHECK_CONTRACT),
  ];
  return Array.isArray(value)
    && value.length === contract.length
    && value.every((item, index) => hasExactKeys(item, ["id", "pass", "message"])
      && item.id === contract[index].id
      && item.message === contract[index].message
      && typeof item.pass === "boolean"
      && standaloneDeliveryCheckMatches(item, report))
    && report?.ok === value.every((item) => item.pass);
}

function standaloneDeliveryCheckMatches(item, report) {
  const hasDomainEval = report?.sources?.domainEval !== null;
  const expected = {
    blueprint_valid: report?.validation?.ok === true,
    target_match: report?.target?.buildState === report?.target?.runState
      && (!hasDomainEval || report?.target?.domainEval === report?.target?.runState),
    domain_eval_optional: !hasDomainEval,
    domain_eval_ok: report?.domainCertified === true,
  };
  return !Object.hasOwn(expected, item.id) || item.pass === expected[item.id];
}

function validValidation(value) {
  return hasExactKeys(value, ["ok", "warnings", "errors"])
    && value.ok === true && stringArray(value.warnings) && stringArray(value.errors);
}

function nextActions({ ok, domainCertified, liveSuccess }) {
  if (!ok) return ["Repair invalid or mismatched source evidence before rebuilding delivery-report."];
  if (!domainCertified) return ["Supply an independently admitted bounded domain evaluation if domain certification is required."];
  if (!liveSuccess) return ["Collect isolated live evidence independently; bounded domain evidence does not imply live success."];
  return ["Use a separate reviewed release decision; aggregation does not establish delivery or production approval."];
}

function sameProvenance(left, right) {
  return left?.identity === right?.identity && left?.subject === right?.subject && left?.digest === right?.digest;
}

function validProvenance(value, subject, identity) {
  return hasExactKeys(value, ["identity", "subject", "digest"])
    && value.identity === identity && value.subject === subject && SHA256_DIGEST_PATTERN.test(value.digest);
}

function assertDeliveryReportCandidate(report, options) {
  assertPersistable(report, { subject: "delivery-report" });
  if (!validateDeliveryReportArtifact(report, options).ok) throw deliveryError("AGENTMO_DELIVERY_REPORT_INVALID");
}

function check(id, pass, message) {
  return { id, pass: Boolean(pass), message };
}

function requireExactKeys(value, keys, label, errors) {
  if (!hasExactKeys(value, keys)) errors.push(`${label}_fields_invalid`);
}

function hasExactKeys(value, keys) {
  if (!plainObject(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function plainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function stringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function deliveryError(code) {
  const error = new Error("Delivery report artifact operation failed.");
  error.code = code;
  return error;
}

const NATIVE_SOURCE_SUBJECTS={blueprint:'blueprint',packageManifest:'package-manifest',activationPlan:'openclaw-install-plan',installReceipt:'openclaw-install-receipt',acceptance:'native-chat-acceptance'};
const NATIVE_CHECKS=freezeCheckContract([
  ['source_bindings','the native package, installed receipt and activation plan bind the exact blueprint'],
  ['native_acceptance_complete','all fixed cases independently pass for the exact native entry'],
  ['evidence_fresh','native entry observations are current at assessment time'],
]);
async function buildNativeDeliveryReport(blueprint, options) {
  if (!hasExactKeys(options.nativeChat,['packageManifest','activationPlan','installReceipt','acceptance'])
    || !hasExactKeys(options.admissions,Object.keys(NATIVE_SOURCE_SUBJECTS))
    || Object.keys(options).some(k=>!['nativeChat','admissions','now'].includes(k))) throw deliveryError('AGENTMO_DELIVERY_REPORT_INVALID');
  const {admittedArtifactProvenance}=await import('./artifact-admission.js');
  const sources={};
  for(const [key,subject] of Object.entries(NATIVE_SOURCE_SUBJECTS)){
    const value=key==='blueprint'?blueprint:options.nativeChat[key];
    if(key==='acceptance'&&value===null){if(options.admissions.acceptance!==null)throw deliveryError('AGENTMO_DELIVERY_OPTIONAL_INPUT_INVALID');sources[key]=null;}
    else sources[key]=admittedArtifactProvenance(options.admissions[key],{subject,value});
  }
  const assessedAt=options.now??Date.now();
  const assessment=nativeDeliveryAssessment({blueprint,nativeChat:options.nativeChat,sources,now:assessedAt});
  const report={schemaVersion:DELIVERY_REPORT_SCHEMA_VERSION,execution_profile:'native-chat',agentId:blueprint.agent_id,assessedAt,
    status:assessment.verified?'entry-verified':'partial',ok:assessment.verified,nativeEntryVerified:assessment.verified,
    domainCertified:false,runtimePromotionEligible:false,deliveryReady:false,productionApproved:false,
    sources,checks:assessment.checks,caseResults:assessment.caseResults,
    certificationBoundary:{boundedEntryObservationsOnly:true,reviewerAuthentication:false,domain:false,delivery:false,production:false},
    nextActions:assessment.verified?['Use the separately approved native entry; this report grants no broader certification.']:['Collect the missing exact native UI, model, input, recovery and budget observations with independent review.']};
  if(!validateNativeDeliveryReport(report,{blueprint,nativeChat:options.nativeChat,sources}).ok)throw deliveryError('AGENTMO_DELIVERY_REPORT_INVALID');
  return report;
}

function nativeDeliveryAssessment({blueprint,nativeChat,sources,now}){
  const {packageManifest:manifest,activationPlan:plan,installReceipt:receipt,acceptance}=nativeChat;
  if(!Number.isSafeInteger(now)||now<0||!validateBlueprint(blueprint).ok||blueprint.execution_profile!=='native-chat'
    ||!validateAgentPackageManifest(manifest).ok||manifest.execution_profile!=='native-chat'
    ||!validateOpenClawInstallPlan(plan).ok||plan.execution_profile!=='native-chat'||plan.lifecycle!=='activate'
    ||!validateOpenClawInstallReceipt(receipt).ok||receipt.execution_profile!=='native-chat')throw deliveryError('AGENTMO_DELIVERY_REPORT_INVALID');
  const original=buildOpenClawInstallPlan({execution_profile:'native-chat',lifecycle:'install',...Object.fromEntries(['archiveBinding','target','nativeBinding','authorityRootBinding','officialConfigDryRun'].map(k=>[k,plan[k]]))});
  const sourceMatch=manifest.packageId===blueprint.agent_id&&plan.nativeBinding.agentId===blueprint.agent_id
    &&blueprint.native_model_profile===plan.nativeBinding.modelProfile
    &&manifest.sourceBindings.blueprintDigest===sources.blueprint.digest&&sources.packageManifest.digest===plan.archiveBinding.manifestDigest
    &&manifest.inventoryDigest===plan.archiveBinding.inventoryDigest&&manifest.targetCompatibility.some(t=>t.target==='openclaw'&&t.version===plan.target.targetVersion&&t.sourceRevision===plan.target.targetRevision)
    &&receipt.status==='complete'&&receipt.installPlanDigest===original.installPlanDigest&&plan.predecessor.installPlanDigest===original.installPlanDigest
    &&receipt.archiveDigest===plan.archiveBinding.archiveSha256&&plan.predecessor.installReceiptDigest===sources.installReceipt.digest
    &&sameJson(receipt.binding,plan.nativeBinding)&&sameJson(receipt.rootIdentity,plan.predecessor.rootIdentity);
  let evidence={entryVerified:false,results:[]},fresh=false;
  if(acceptance!==null){
    evidence=validateNativeChatAcceptanceArtifact(acceptance);if(!evidence.ok)throw deliveryError('AGENTMO_DELIVERY_REPORT_INVALID');
    const runtime=acceptance.runtime;
    if(runtime.blueprintDigest!==sources.blueprint.digest||runtime.packageArchiveDigest!==plan.archiveBinding.archiveSha256
      ||runtime.installReceiptDigest!==sources.installReceipt.digest||runtime.activationPlanDigest!==plan.installPlanDigest
      ||runtime.nativeBindingDigest!==behaviorEvidenceDigest(plan.nativeBinding)||runtime.targetDescriptorDigest!==plan.nativeBinding.targetDescriptorDigest
      ||runtime.agentId!==blueprint.agent_id||runtime.targetVersion!==plan.target.targetVersion
      ||runtime.model!==nativeChatModelProfile(plan.nativeBinding.modelProfile).nativeModel)throw deliveryError('AGENTMO_DELIVERY_REPORT_INVALID');
    fresh=acceptance.observedAt<=now&&now-acceptance.observedAt<=3_600_000;
  }
  const checks=buildChecksFromContract(NATIVE_CHECKS,[sourceMatch,evidence.entryVerified,fresh]);
  return {verified:checks.every(c=>c.pass),checks,caseResults:evidence.results};
}

function validateNativeDeliveryReport(report, options){
  try{
    assertPersistable(report,{subject:'delivery-report'});
    if(!hasExactKeys(report,['schemaVersion','execution_profile','agentId','assessedAt','status','ok','nativeEntryVerified','domainCertified','runtimePromotionEligible','deliveryReady','productionApproved','sources','checks','caseResults','certificationBoundary','nextActions'])
      ||report.schemaVersion!==DELIVERY_REPORT_SCHEMA_VERSION||report.execution_profile!=='native-chat'||!nonEmptyString(report.agentId)||!Number.isSafeInteger(report.assessedAt)||report.assessedAt<0
      ||[report.domainCertified,report.runtimePromotionEligible,report.deliveryReady,report.productionApproved].some(v=>v!==false)
      ||!sameJson(report.certificationBoundary,{boundedEntryObservationsOnly:true,reviewerAuthentication:false,domain:false,delivery:false,production:false})
      ||!hasExactKeys(report.sources,Object.keys(NATIVE_SOURCE_SUBJECTS))||!Array.isArray(report.checks)||report.checks.length!==NATIVE_CHECKS.length
      ||!Array.isArray(report.caseResults)||report.caseResults.length>NATIVE_CHAT_CASES.length||!stringArray(report.nextActions))throw new Error();
    for(const [key,subject] of Object.entries(NATIVE_SOURCE_SUBJECTS)){
      const p=report.sources[key];if(key==='acceptance'&&p===null)continue;
      if(!hasExactKeys(p,['identity','subject','digest'])||p.subject!==subject||!nonEmptyString(p.identity)||!SHA256_DIGEST_PATTERN.test(p.digest))throw new Error();
    }
    for(const [i,c] of report.checks.entries())if(!hasExactKeys(c,['id','message','pass'])||c.id!==NATIVE_CHECKS[i].id||c.message!==NATIVE_CHECKS[i].message||typeof c.pass!=='boolean')throw new Error();
    const ids=new Set();for(const c of report.caseResults){if(!hasExactKeys(c,['id','passed','evidenceRefs'])||ids.has(c.id)||!NATIVE_CHAT_CASES.some(s=>s.id===c.id)||typeof c.passed!=='boolean'||!stringArray(c.evidenceRefs))throw new Error();ids.add(c.id);}
    const verified=report.checks.every(c=>c.pass);
    if(report.nativeEntryVerified!==verified||report.ok!==verified||report.status!==(verified?'entry-verified':'partial')
      ||verified&&(report.sources.acceptance===null||report.caseResults.length!==NATIVE_CHAT_CASES.length||report.caseResults.some(c=>!c.passed)))throw new Error();
    if(options?.nativeChat){const a=nativeDeliveryAssessment({...options,now:report.assessedAt});if(report.agentId!==options.blueprint.agent_id||!sameJson(report.sources,options.sources)||!sameJson(report.checks,a.checks)||!sameJson(report.caseResults,a.caseResults)||verified!==a.verified)throw new Error();}
    return {ok:true,errors:[]};
  }catch{return {ok:false,errors:['native_delivery_invalid']};}
}

const PI_SOURCE_SUBJECTS={blueprint:'blueprint',packageManifest:'package-manifest',activationPlan:'pi-install-plan',installReceipt:'pi-install-receipt',acceptance:'pi-native-chat-acceptance'};
const PI_LEGACY_GAPS=Object.freeze({status:'unresolved',count:15,evidencePath:'docs/poc/native-chat/acceptance.md'});
const PI_BOUNDARY=Object.freeze({boundedEntryObservationsOnly:true,reviewerAuthentication:false,domain:false,delivery:false,production:false});
function piDeliveryAssessment(blueprint,options,now) {
  const a=options.admissions;
  if(!hasExactKeys(options.nativeChat,['packageManifest','activationPlan','installReceipt','acceptance'])||!hasExactKeys(a,Object.keys(PI_SOURCE_SUBJECTS))
    ||!Number.isSafeInteger(now)||now<0||blueprint!==a.blueprint?.value||!validateBlueprint(blueprint).ok)throw deliveryError('AGENTMO_DELIVERY_REPORT_INVALID');
  for(const k of Object.keys(options.nativeChat))if(options.nativeChat[k] !== (a[k]?.value??null))throw deliveryError('AGENTMO_DELIVERY_REPORT_INVALID');
  const {acceptance,...base}=a,sources=verifyPiDeliverySources(base);
  let evidence={entryVerified:false,results:[]},fresh=false;
  if(acceptance===null) sources.acceptance=null;
  else {
    if(!isPiChatAcceptanceAdmission(acceptance))throw deliveryError('AGENTMO_DELIVERY_REPORT_INVALID');
    sources.acceptance=piAcceptanceProvenance(acceptance);
    const r=acceptance.value.runtime,p=a.activationPlan.value;
    if(r.blueprintDigest!==sources.blueprint.digest||r.packageArchiveDigest!==p.archiveBinding.archiveDigest||r.installReceiptDigest!==sources.installReceipt.digest
      ||r.activationPlanDigest!==p.installPlanDigest||r.nativeBindingDigest!==behaviorEvidenceDigest(p.nativeBinding))throw deliveryError('AGENTMO_DELIVERY_REPORT_INVALID');
    evidence=validatePiChatAcceptanceArtifact(acceptance.value);if(!evidence.ok)throw deliveryError('AGENTMO_DELIVERY_REPORT_INVALID');
    fresh=acceptance.value.observedAt<=now&&now-acceptance.value.observedAt<=3600000;
  }
  const checks=buildChecksFromContract(NATIVE_CHECKS,[true,evidence.entryVerified,fresh]);
  const piGaps=NATIVE_CHAT_CASES.filter(s=>!evidence.results.some(r=>r.id===s.id&&r.passed)).map(s=>s.id);
  if(!fresh&&!piGaps.length)piGaps.push('evidence-freshness');
  return {sources,checks,caseResults:evidence.results,verified:checks.every(c=>c.pass),piGaps};
}
async function buildPiDeliveryReport(blueprint,options) {
  if(Object.keys(options).some(k=>!['nativeChat','admissions','now'].includes(k)))throw deliveryError('AGENTMO_DELIVERY_REPORT_INVALID');
  const assessedAt=options.now??Date.now(),a=piDeliveryAssessment(blueprint,options,assessedAt);
  return {schemaVersion:DELIVERY_REPORT_SCHEMA_VERSION,execution_profile:'native-chat',native_runtime:'pi',agentId:blueprint.agent_id,assessedAt,
    status:a.verified?'entry-verified':'partial',ok:a.verified,nativeEntryVerified:a.verified,domainCertified:false,runtimePromotionEligible:false,deliveryReady:false,productionApproved:false,
    sources:a.sources,checks:a.checks,caseResults:a.caseResults,legacySourceGaps:{...PI_LEGACY_GAPS},piGaps:a.piGaps,certificationBoundary:{...PI_BOUNDARY},
    nextActions:a.verified?['Pi entry observations grant no domain, delivery or production certification.']:['Collect the missing separately approved Pi observations and independent reviews.']};
}
function validatePiDeliveryReport(report,options) {
  try {
    assertPersistable(report,{subject:'delivery-report'});
    if(!hasExactKeys(report,['schemaVersion','execution_profile','native_runtime','agentId','assessedAt','status','ok','nativeEntryVerified','domainCertified','runtimePromotionEligible','deliveryReady','productionApproved','sources','checks','caseResults','legacySourceGaps','piGaps','certificationBoundary','nextActions'])
      ||report.native_runtime!=='pi'||!sameJson(report.legacySourceGaps,PI_LEGACY_GAPS)||!sameJson(report.certificationBoundary,PI_BOUNDARY)
      ||!stringArray(report.piGaps)||new Set(report.piGaps).size!==report.piGaps.length||report.piGaps.some(id=>id!=='evidence-freshness'&&!NATIVE_CHAT_CASES.some(s=>s.id===id)))throw new Error();
    // Reuse the unchanged native report shape checks with its fixed source labels only.
    const {native_runtime,legacySourceGaps,piGaps,...base}=report;
    const nativeSources=Object.fromEntries(Object.entries(report.sources).map(([k,v])=>[k,v===null?null:{...v,subject:NATIVE_SOURCE_SUBJECTS[k]}]));
    if(!validateNativeDeliveryReport({...base,sources:nativeSources},{}).ok)throw new Error();
    for(const [k,subject] of Object.entries(PI_SOURCE_SUBJECTS))if(report.sources[k]!==null&&report.sources[k].subject!==subject)throw new Error();
    const gaps=NATIVE_CHAT_CASES.filter(s=>!report.caseResults.some(r=>r.id===s.id&&r.passed)).map(s=>s.id);
    if(!report.checks[2].pass&&!gaps.length)gaps.push('evidence-freshness');
    if(!sameJson(gaps,piGaps))throw new Error();
    if(options?.admissions) {
      const a=piDeliveryAssessment(options.blueprint,options,report.assessedAt);
      if(report.agentId!==options.blueprint.agent_id||!sameJson(report.sources,a.sources)||!sameJson(report.checks,a.checks)||!sameJson(report.caseResults,a.caseResults)||report.ok!==a.verified)throw new Error();
    } else if(options?.nativeChat)throw new Error();
    return {ok:true,errors:[]};
  } catch {return {ok:false,errors:['pi_delivery_invalid']};}
}
