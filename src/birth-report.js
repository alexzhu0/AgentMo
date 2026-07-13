import { validateBuildStateArtifact, BUILD_STATE_SCHEMA_VERSION } from "./build-state.js";
import { validateBlueprint } from "./blueprint.js";
import {
  assertPersistable,
  isRedactedSummary,
  isSecretPresence,
} from "./persistability.js";
import {
  RUN_EVAL_SCHEMA_VERSION,
  RUN_STATE_SCHEMA_VERSION,
  validateRunEvalArtifact,
  validateRunStateArtifact,
} from "./run-state.js";
import { assertRuntimeEnvReady } from "./runtime-env.js";

export const BIRTH_REPORT_SCHEMA_VERSION = "agentmo.birth-report.v1";
export const BIRTH_EVIDENCE_LEVELS = Object.freeze(["declared", "live-success", "failure"]);

const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;

const BIRTH_REPORT_CHECK_CONTRACT = Object.freeze([
  ["expected_status_supplied", "birth-report has an explicit supported execution expectation"],
  ["blueprint_validation", "blueprint validates independently"],
  ["build_state_schema", "build-state schema is independently valid"],
  ["run_state_schema", "run-state schema is independently valid"],
  ["run_eval_schema", "run-eval schema is independently valid"],
  ["build_state_agent", "build-state agent matches blueprint"],
  ["run_state_agent", "run-state agent matches blueprint"],
  ["target_match", "build-state target matches run-state target"],
  ["build_state_blueprint_provenance", "build-state references the exact admitted blueprint"],
  ["run_state_blueprint_provenance", "run-state references the exact admitted blueprint"],
  ["run_eval_run_state_provenance", "run-eval references the exact admitted run-state"],
  ["run_eval_run_id", "run-eval run id matches run-state"],
  ["run_eval_revalidated", "run-eval passes after independent schema validation"],
  ["expected_status", "run-state status matches the explicit expectation"],
  ["run_eval_actual_status", "run-eval actual status matches run-state"],
  ["run_eval_expected_status", "run-eval expectation matches birth-report"],
  ["runtime_env_ready", "runtime environment presence evidence is sufficient for this run"],
  ["sandbox_present", "sandbox scope evidence is present"],
  ["sandbox_non_production", "run evidence does not use production state"],
  ["run_non_certifying", "run-state is non-certifying"],
  ["run_eval_non_certifying", "run-eval is non-certifying"],
  ["process_group_closed", "timed-out live execution has positive process-group closure evidence"],
  ["transcript_body_absent", "run-state stores no transcript body"],
  ["tool_body_absent", "run-state stores no tool body"],
  ["output_body_absent", "runtime output is represented only by safe summaries"],
  ["evidence_level", "the explicit expectation matches the independently derived evidence level"],
].map(([id, message]) => Object.freeze({ id, message })));

export const BIRTH_REPORT_REQUIRED_CHECK_IDS = Object.freeze(
  BIRTH_REPORT_CHECK_CONTRACT.map((item) => item.id),
);

export async function buildBirthReport(blueprint, options = {}) {
  const buildState = options.buildState;
  const runState = options.runState;
  const runEval = options.runEval;
  const expectStatus = options.expectStatus ?? null;
  const { admittedArtifactProvenance } = await import("./artifact-admission.js");
  const sources = {
    blueprint: admittedArtifactProvenance(options.admissions?.blueprint, { subject: "blueprint", value: blueprint }),
    buildState: admittedArtifactProvenance(options.admissions?.buildState, { subject: "build-state", value: buildState }),
    runState: admittedArtifactProvenance(options.admissions?.runState, { subject: "run-state", value: runState }),
    runEval: admittedArtifactProvenance(options.admissions?.runEval, { subject: "run-eval", value: runEval }),
  };
  const validation = validateBlueprint(blueprint);
  const actualStatus = runState?.execution?.status ?? null;
  const evidenceLevel = resolveEvidenceLevel(runState);
  const checks = deriveBirthReportChecks({
    blueprint,
    buildState,
    runState,
    runEval,
    expectStatus,
    sources,
    validation,
    actualStatus,
    evidenceLevel,
  });
  const artifactValid = checks.every((item) => item.pass);
  const declaredReady = artifactValid && evidenceLevel === "declared";
  const liveSuccess = artifactValid && evidenceLevel === "live-success";
  const report = {
    schemaVersion: BIRTH_REPORT_SCHEMA_VERSION,
    ok: artifactValid,
    artifactValid,
    birthReady: declaredReady || liveSuccess,
    promotionEligible: false,
    agentId: blueprint?.agent_id ?? null,
    pipelineStage: "produce",
    evidenceLevel,
    birthStatus: resolveBirthStatus(artifactValid, evidenceLevel),
    expectedStatus: expectStatus,
    actualStatus,
    sources,
    runtimeEvidence: {
      runId: runState?.runId ?? null,
      targetId: runState?.target?.id ?? null,
      executionStatus: actualStatus,
      executed: runState?.execution?.executed === true,
      live: runState?.execution?.live === true,
      stdoutSummary: cloneJson(runState?.execution?.stdout ?? null),
      stderrSummary: cloneJson(runState?.execution?.stderr ?? null),
      runtimeEnv: cloneJson(runState?.runtimeIdentity?.runtimeEnv ?? null),
    },
    evidenceLevels: {
      declaredReady,
      liveSuccess,
      domainCertified: false,
      deliveryReady: false,
      productionApproved: false,
    },
    checks,
    validation: {
      ok: validation.ok,
      warnings: validation.warnings,
      errors: validation.errors,
    },
    certificationBoundary: {
      runtimeCertifiedByBirthReport: false,
      domainCertifiedByBirthReport: false,
      deliveryReadyByBirthReport: false,
      productionApprovedByBirthReport: false,
      runtimeCertifiedByRun: false,
      domainCertifiedByRun: false,
    },
    nextActions: nextActions(artifactValid, evidenceLevel, expectStatus),
  };
  assertBirthReportCandidate(report, {
    blueprint,
    buildState,
    runState,
    runEval,
    expectStatus,
    sources,
  });
  return report;
}

export function validateBirthReportArtifact(report, options = {}) {
  const errors = [];
  let sourceDerivation = null;
  try {
    assertPersistable(report, { subject: "birth-report" });
    requireExactKeys(report, [
      "schemaVersion", "ok", "artifactValid", "birthReady", "promotionEligible", "agentId", "pipelineStage",
      "evidenceLevel", "birthStatus", "expectedStatus", "actualStatus", "sources", "runtimeEvidence",
      "evidenceLevels", "checks", "validation", "certificationBoundary", "nextActions",
    ], "birth_report", errors);
    if (report?.schemaVersion !== BIRTH_REPORT_SCHEMA_VERSION) errors.push("invalid_schema_version");
    if (typeof report?.ok !== "boolean" || report.artifactValid !== report.ok) errors.push("invalid_ok");
    if (report?.promotionEligible !== false) errors.push("invalid_promotion_boundary");
    if (!nonEmptyString(report?.agentId) || report?.pipelineStage !== "produce") errors.push("invalid_scope");
    if (!BIRTH_EVIDENCE_LEVELS.includes(report?.evidenceLevel)) errors.push("invalid_evidence_level");
    if (!["declared", "success", "failure"].includes(report?.expectedStatus) || !["declared", "success", "failure"].includes(report?.actualStatus)) errors.push("invalid_status");
    if (!validSources(report?.sources)) errors.push("invalid_sources");
    if (!validRuntimeEvidence(report?.runtimeEvidence, report)) errors.push("invalid_runtime_evidence");
    if (!validEvidenceLevels(report?.evidenceLevels, report)) errors.push("invalid_evidence_levels");
    if (!validChecks(report?.checks, report)) errors.push("invalid_checks");
    if (!validValidation(report?.validation)) errors.push("invalid_validation");
    if (!hasExactFalseFields(report?.certificationBoundary, [
      "runtimeCertifiedByBirthReport", "domainCertifiedByBirthReport", "deliveryReadyByBirthReport",
      "productionApprovedByBirthReport", "runtimeCertifiedByRun", "domainCertifiedByRun",
    ])) errors.push("invalid_certification_boundary");
    if (!stringArray(report?.nextActions)) errors.push("invalid_next_actions");
    const expectedBirthReady = report.evidenceLevels.declaredReady || report.evidenceLevels.liveSuccess;
    if (report.birthReady !== expectedBirthReady || report.birthStatus !== resolveBirthStatus(report.ok, report.evidenceLevel)) errors.push("invalid_birth_status");
    if (hasBirthValidationContext(options)) {
      const derivation = deriveBirthReportAssessment(options);
      sourceDerivation = derivation;
      if (!sameJson(report.sources, options.sources)
        || !sameJson(report.checks, derivation.checks)
        || report.ok !== derivation.artifactValid
        || report.artifactValid !== derivation.artifactValid
        || report.birthReady !== derivation.birthReady
        || report.evidenceLevel !== derivation.evidenceLevel
        || report.birthStatus !== derivation.birthStatus
        || report.expectedStatus !== options.expectStatus
        || report.actualStatus !== derivation.actualStatus
        || !sameJson(report.runtimeEvidence, derivation.runtimeEvidence)
        || !sameJson(report.evidenceLevels, derivation.evidenceLevels)
        || !sameJson(report.validation, derivation.validation)
        || !sameJson(report.nextActions, derivation.nextActions)) {
        errors.push("birth_report_source_derivation_invalid");
      }
    }
  } catch {
    errors.push("unsafe_birth_report_shape");
  }
  const ok = errors.length === 0;
  return {
    ok,
    errors,
    artifactValid: ok && (sourceDerivation?.artifactValid ?? report?.artifactValid === true),
    birthReady: ok && (sourceDerivation?.birthReady ?? report?.birthReady === true),
  };
}

export function formatBirthReport(report) {
  const lines = [
    `AgentMo birth report: ${report.agentId ?? "unknown"}`,
    "Pipeline: Produce (internal birth gate)",
    `Artifact status: ${report.artifactValid ? "valid" : "invalid"}`,
    `Birth ready: ${report.birthReady ? "yes" : "no"}`,
    "Promotion eligible: no",
    `Birth status: ${report.birthStatus}`,
    `Evidence level: ${report.evidenceLevel}`,
    "Certification: birth-report does not certify runtime, domain, delivery, or production approval",
  ];
  for (const item of report.checks) lines.push(`- ${item.pass ? "PASS" : "FAIL"} ${item.id}: ${item.message}`);
  return `${lines.join("\n")}\n`;
}

function resolveBirthStatus(ok, evidenceLevel) {
  if (!ok) return "blocked";
  if (evidenceLevel === "live-success") return "born";
  if (evidenceLevel === "declared") return "declared-ready";
  if (evidenceLevel === "failure") return "failure-evidence";
  return "blocked";
}

function resolveEvidenceLevel(runState) {
  if (runState?.execution?.status === "success" && runState.execution.executed === true && runState.execution.live === true) return "live-success";
  if (runState?.execution?.status === "failure") return "failure";
  return "declared";
}

function evidenceLevelMatches(expectStatus, evidenceLevel, runState) {
  if (expectStatus === "success") return evidenceLevel === "live-success";
  if (expectStatus === "declared") return evidenceLevel === "declared" && runState?.execution?.executed === false;
  if (expectStatus === "failure") return evidenceLevel === "failure";
  return false;
}

function nextActions(artifactValid, evidenceLevel, expectStatus) {
  if (!artifactValid) return ["Repair the independently failed evidence checks before rebuilding birth-report."];
  if (expectStatus === "failure") return ["Keep failure evidence as proposal input; do not mutate governed artifacts automatically."];
  if (evidenceLevel === "declared") return ["Collect isolated live evidence separately; declared readiness does not imply live success."];
  return ["Evaluate bounded domain quality separately; live success does not imply domain, delivery, or production approval."];
}

function deriveBirthReportAssessment(options) {
  const blueprintValidation = validateBlueprint(options.blueprint);
  const validation = {
    ok: blueprintValidation.ok,
    warnings: blueprintValidation.warnings,
    errors: blueprintValidation.errors,
  };
  const actualStatus = options.runState?.execution?.status ?? null;
  const evidenceLevel = resolveEvidenceLevel(options.runState);
  const checks = deriveBirthReportChecks({
    ...options,
    validation,
    actualStatus,
    evidenceLevel,
  });
  const artifactValid = checks.every((item) => item.pass);
  const declaredReady = artifactValid && evidenceLevel === "declared";
  const liveSuccess = artifactValid && evidenceLevel === "live-success";
  return {
    validation,
    actualStatus,
    evidenceLevel,
    checks,
    artifactValid,
    birthReady: declaredReady || liveSuccess,
    birthStatus: resolveBirthStatus(artifactValid, evidenceLevel),
    runtimeEvidence: {
      runId: options.runState?.runId ?? null,
      targetId: options.runState?.target?.id ?? null,
      executionStatus: actualStatus,
      executed: options.runState?.execution?.executed === true,
      live: options.runState?.execution?.live === true,
      stdoutSummary: cloneJson(options.runState?.execution?.stdout ?? null),
      stderrSummary: cloneJson(options.runState?.execution?.stderr ?? null),
      runtimeEnv: cloneJson(options.runState?.runtimeIdentity?.runtimeEnv ?? null),
    },
    evidenceLevels: {
      declaredReady,
      liveSuccess,
      domainCertified: false,
      deliveryReady: false,
      productionApproved: false,
    },
    nextActions: nextActions(artifactValid, evidenceLevel, options.expectStatus),
  };
}

function deriveBirthReportChecks({
  blueprint,
  buildState,
  runState,
  runEval,
  expectStatus,
  sources,
  validation,
  actualStatus,
  evidenceLevel,
}) {
  const runEvalValidation = validateRunEvalArtifact(runEval, {
    runState,
    source: sources?.runState,
  });
  const runEvalRawOutputCheck = runEval?.checks?.find((item) => item?.id === "output_body_absent");
  const passes = [
    ["declared", "success", "failure"].includes(expectStatus),
    validation.ok,
    validateBuildStateArtifact(buildState).ok,
    validateRunStateArtifact(runState).ok,
    runEvalValidation.ok,
    buildState?.agentId === blueprint?.agent_id,
    runState?.agentId === blueprint?.agent_id,
    buildState?.target?.id === runState?.target?.id,
    sameProvenance(buildState?.source, sources?.blueprint),
    sameProvenance(runState?.source?.blueprint, sources?.blueprint),
    sameProvenance(runEval?.source, sources?.runState),
    runEval?.runId === runState?.runId,
    runEvalValidation.ok && runEval?.ok === true && runEval?.checks?.every((item) => item.pass === true),
    actualStatus === expectStatus,
    runEval?.actualStatus === actualStatus,
    runEval?.expectedStatus === expectStatus,
    runtimeEnvReadyForEvidence(runState),
    Boolean(runState?.runtimeIdentity?.sandboxScope),
    runState?.runtimeIdentity?.sandboxScope?.usesProductionState !== true,
    runState?.certificationBoundary?.runEvidenceCertifiesRuntime === false,
    hasExactFalseFields(runEval?.certificationBoundary, ["runtimeCertifiedByRun", "domainCertifiedByRun"]),
    timedOutProcessGroupClosed(runState),
    runState?.evidence?.rawTranscriptStored === false,
    runState?.evidence?.rawToolBodiesStored === false,
    runStateStoresRawOutputPreview(runState) === false
      && runEvalValidation.ok
      && runEvalRawOutputCheck?.pass === true,
    evidenceLevelMatches(expectStatus, evidenceLevel, runState),
  ];
  return BIRTH_REPORT_CHECK_CONTRACT.map((spec, index) => check(spec.id, passes[index], spec.message));
}

function hasBirthValidationContext(options) {
  return options
    && Object.hasOwn(options, "blueprint")
    && Object.hasOwn(options, "buildState")
    && Object.hasOwn(options, "runState")
    && Object.hasOwn(options, "runEval")
    && Object.hasOwn(options, "expectStatus")
    && Object.hasOwn(options, "sources");
}

function runtimeEnvReadyForEvidence(runState) {
  try {
    assertRuntimeEnvReady(runState?.runtimeIdentity?.runtimeEnv, {
      live: runState?.execution?.live === true,
      provider: runState?.runtimeIdentity?.provider,
      transport: runState?.runtimeIdentity?.transport,
    });
    return true;
  } catch {
    return false;
  }
}

function timedOutProcessGroupClosed(runState) {
  if (runState?.execution?.timedOut !== true) return true;
  const verification = runState.execution.processGroupVerification;
  return runState.execution.processGroupClosed === true
    && runState.execution.processGroupCleanupFailed !== true
    && ["closed-after-sigterm-grace", "closed-after-sigkill-grace"].includes(verification)
    && runState.evidence?.processGroupClosed === true
    && runState.evidence?.processGroupCleanupFailed !== true
    && runState.evidence?.processGroupVerification === verification;
}

function runStateStoresRawOutputPreview(runState) {
  return runState?.evidence?.rawOutputPreviewStored !== false
    || runState?.evidence?.stdoutPreviewStored !== false
    || runState?.evidence?.stderrPreviewStored !== false
    || !isRedactedSummary(runState?.execution?.stdout)
    || !isRedactedSummary(runState?.execution?.stderr)
    || !isRedactedSummary(runState?.evidence?.stdoutSummary)
    || !isRedactedSummary(runState?.evidence?.stderrSummary);
}

function validSources(value) {
  return hasExactKeys(value, ["blueprint", "buildState", "runState", "runEval"])
    && validProvenance(value.blueprint, "blueprint", "0.1")
    && validProvenance(value.buildState, "build-state", BUILD_STATE_SCHEMA_VERSION)
    && validProvenance(value.runState, "run-state", RUN_STATE_SCHEMA_VERSION)
    && validProvenance(value.runEval, "run-eval", RUN_EVAL_SCHEMA_VERSION);
}

function validRuntimeEvidence(value, report) {
  return hasExactKeys(value, ["runId", "targetId", "executionStatus", "executed", "live", "stdoutSummary", "stderrSummary", "runtimeEnv"])
    && nonEmptyString(value.runId)
    && value.targetId === "openclaw"
    && value.executionStatus === report.actualStatus
    && typeof value.executed === "boolean"
    && typeof value.live === "boolean"
    && isRedactedSummary(value.stdoutSummary)
    && isRedactedSummary(value.stderrSummary)
    && isSecretPresence(value.runtimeEnv);
}

function validEvidenceLevels(value, report) {
  if (!hasExactKeys(value, ["declaredReady", "liveSuccess", "domainCertified", "deliveryReady", "productionApproved"])) return false;
  const declared = report.ok && report.evidenceLevel === "declared";
  const live = report.ok && report.evidenceLevel === "live-success";
  return value.declaredReady === declared
    && value.liveSuccess === live
    && value.domainCertified === false
    && value.deliveryReady === false
    && value.productionApproved === false;
}

function validChecks(value, report) {
  return Array.isArray(value)
    && value.length === BIRTH_REPORT_CHECK_CONTRACT.length
    && value.every((item, index) => hasExactKeys(item, ["id", "pass", "message"])
      && item.id === BIRTH_REPORT_CHECK_CONTRACT[index].id
      && item.message === BIRTH_REPORT_CHECK_CONTRACT[index].message
      && typeof item.pass === "boolean"
      && standaloneBirthCheckMatches(item, report))
    && report?.ok === value.every((item) => item.pass);
}

function standaloneBirthCheckMatches(item, report) {
  const expected = {
    expected_status_supplied: ["declared", "success", "failure"].includes(report?.expectedStatus),
    blueprint_validation: report?.validation?.ok === true,
    expected_status: report?.actualStatus === report?.expectedStatus,
    run_non_certifying: report?.certificationBoundary?.runtimeCertifiedByRun === false,
    run_eval_non_certifying: report?.certificationBoundary?.runtimeCertifiedByRun === false
      && report?.certificationBoundary?.domainCertifiedByRun === false,
    evidence_level: runtimeEvidenceLevelMatches(report),
  };
  return !Object.hasOwn(expected, item.id) || item.pass === expected[item.id];
}

function runtimeEvidenceLevelMatches(report) {
  const runtime = report?.runtimeEvidence;
  if (report?.expectedStatus === "success") {
    return report.evidenceLevel === "live-success"
      && runtime?.executionStatus === "success"
      && runtime?.executed === true
      && runtime?.live === true;
  }
  if (report?.expectedStatus === "declared") {
    return report.evidenceLevel === "declared"
      && runtime?.executionStatus === "declared"
      && runtime?.executed === false
      && runtime?.live === false;
  }
  if (report?.expectedStatus === "failure") {
    return report.evidenceLevel === "failure" && runtime?.executionStatus === "failure";
  }
  return false;
}

function validValidation(value) {
  return hasExactKeys(value, ["ok", "warnings", "errors"])
    && value.ok === true
    && stringArray(value.warnings)
    && stringArray(value.errors);
}

function sameProvenance(left, right) {
  return left?.identity === right?.identity && left?.subject === right?.subject && left?.digest === right?.digest;
}

function validProvenance(value, subject, identity) {
  return hasExactKeys(value, ["identity", "subject", "digest"])
    && value.identity === identity && value.subject === subject && SHA256_DIGEST_PATTERN.test(value.digest);
}

function assertBirthReportCandidate(report, options) {
  assertPersistable(report, { subject: "birth-report" });
  if (!validateBirthReportArtifact(report, options).ok) throw birthReportError("AGENTMO_BIRTH_REPORT_INVALID");
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

function hasExactFalseFields(value, keys) {
  return hasExactKeys(value, keys) && keys.every((key) => value[key] === false);
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

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function birthReportError(code) {
  const error = new Error("Birth report artifact operation failed.");
  error.code = code;
  return error;
}
