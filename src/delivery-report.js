import { BIRTH_REPORT_SCHEMA_VERSION } from "./birth-report.js";
import { BUILD_STATE_SCHEMA_VERSION } from "./build-state.js";
import { validateBlueprint } from "./blueprint.js";
import { DOMAIN_EVAL_SCHEMA_VERSION } from "./domain-eval.js";
import { auditEvidence, hashRuntimeJson, hashStableJson } from "./evidence-audit.js";
import { RUN_EVAL_SCHEMA_VERSION, RUN_STATE_SCHEMA_VERSION } from "./run-state.js";

export const DELIVERY_REPORT_SCHEMA_VERSION = "agentmo.delivery.v1";

export function buildDeliveryReport(blueprint, options = {}) {
  const buildState = options.buildState ?? null;
  const runState = options.runState ?? null;
  const runEval = options.runEval ?? null;
  const birthReport = options.birthReport ?? null;
  const domainEval = options.domainEval ?? null;
  const validation = validateBlueprint(blueprint);
  const stableBlueprintHash = hashStableJson(blueprint);
  const runtimeBlueprintHash = hashRuntimeJson(blueprint);
  const blueprintTargets = blueprintTargetSet(blueprint);
  const buildTargetId = buildState?.target?.id ?? buildState?.resolution?.selectedTargetId ?? null;
  const runTargetId = runState?.target?.id ?? null;
  const domainTargetId = domainEvalTargetId(domainEval);
  const evidenceAudit = auditEvidence({ buildState, runState, runEval, birthReport, domainEval });
  const evidenceLevel = resolveEvidenceLevel(runState);

  const buildStatePresent = isObject(buildState);
  const runStatePresent = isObject(runState);
  const runEvalPresent = isObject(runEval);
  const birthReportPresent = isObject(birthReport);
  const buildStateSchema = buildState?.schemaVersion === BUILD_STATE_SCHEMA_VERSION;
  const runStateSchema = runState?.schemaVersion === RUN_STATE_SCHEMA_VERSION;
  const runEvalSchema = runEval?.schemaVersion === RUN_EVAL_SCHEMA_VERSION;
  const birthReportSchema = birthReport?.schemaVersion === BIRTH_REPORT_SCHEMA_VERSION;
  const agentIdMatch =
    nonEmptyString(blueprint?.agent_id) &&
    buildState?.agentId === blueprint.agent_id &&
    runState?.agentId === blueprint.agent_id &&
    birthReport?.agentId === blueprint.agent_id &&
    (domainEval === null || domainEval?.agentId === blueprint.agent_id);
  const targetMatch =
    nonEmptyString(buildTargetId) &&
    buildTargetId === runTargetId &&
    blueprintTargets.has(buildTargetId) &&
    (!nonEmptyString(domainTargetId) || domainTargetId === buildTargetId);
  const buildStateBlueprintHashMatch = buildState?.source?.blueprintHash === stableBlueprintHash;
  const runStateBlueprintHashMatch = runState?.source?.blueprintHash === runtimeBlueprintHash;
  const runEvalRunIdMatch = nonEmptyString(runState?.runId) && runEval?.runId === runState.runId;
  const birthReportExpectationMatch =
    birthReport?.expectedStatus === runEval?.expectedStatus &&
    birthReport?.actualStatus === runState?.execution?.status &&
    runEval?.actualStatus === runState?.execution?.status &&
    birthReport?.evidenceLevel === evidenceLevel;
  const birthReportNonCertifying = hasNonCertifyingBoundary({ birthReport, runState, runEval });
  const validDomainEvalCertification = hasValidDomainEvalCertification({ domainEval, blueprint });
  const domainEvalValid = domainEval === null || validDomainEvalCertification;
  const domainCertified = domainEval !== null && validDomainEvalCertification;

  const checks = [
    check("blueprint_valid", validation.ok, validation.ok ? "blueprint validates" : "blueprint has validation errors"),
    check("blueprint_validation", validation.ok, validation.ok ? "blueprint validates" : "blueprint has validation errors"),
    check("build_state_present", buildStatePresent, "build-state artifact is present"),
    check("build_state_schema", buildStateSchema, `build-state schema is ${BUILD_STATE_SCHEMA_VERSION}`),
    check("run_state_present", runStatePresent, "run-state artifact is present"),
    check("run_state_schema", runStateSchema, `run-state schema is ${RUN_STATE_SCHEMA_VERSION}`),
    check("run_eval_present", runEvalPresent, "run-eval artifact is present"),
    check("run_eval_schema", runEvalSchema, `run-eval schema is ${RUN_EVAL_SCHEMA_VERSION}`),
    check("birth_report_present", birthReportPresent, "birth-report artifact is present"),
    check("birth_report_schema", birthReportSchema, `birth-report schema is ${BIRTH_REPORT_SCHEMA_VERSION}`),
    check("agent_id_match", agentIdMatch, "blueprint, build-state, run-state, birth-report, and domain-eval agent ids match"),
    check("target_match", targetMatch, "build-state, run-state, domain-eval, and blueprint target evidence match"),
    check("build_state_blueprint_hash_match", buildStateBlueprintHashMatch, "build-state stable blueprint hash matches supplied blueprint"),
    check("run_state_blueprint_hash_match", runStateBlueprintHashMatch, "run-state runtime JSON blueprint hash matches supplied blueprint"),
    check("run_eval_run_id_match", runEvalRunIdMatch, "run-eval runId matches run-state runId"),
    check("run_eval_run_id", runEvalRunIdMatch, "run-eval runId matches run-state runId"),
    check("birth_report_expectation_match", birthReportExpectationMatch, "birth-report expected/actual/evidenceLevel match run artifacts"),
    check("birth_expectation_matches", birthReportExpectationMatch, "birth-report expected/actual/evidenceLevel match run artifacts"),
    check("birth_report_ok", birthReport?.ok === true, "birth-report passed its fail-closed gate"),
    ...(domainEval === null
      ? [check("domain_eval_optional", true, "domain-eval artifact was not supplied; domain certification remains false")]
      : [check("domain_eval_ok", domainEval?.schemaVersion === DOMAIN_EVAL_SCHEMA_VERSION && domainEval?.ok === true, "domain-eval artifact is valid and passing")]),
    check("birth_report_non_certifying", birthReportNonCertifying, "birth/report/run evidence does not certify runtime or domain behavior"),
    check("certification_boundary", birthReportNonCertifying, "birth/report/run evidence does not certify runtime or domain behavior"),
    check("evidence_no_raw_or_secret", evidenceAudit.ok, evidenceAudit.ok ? "managed evidence contains no raw or secret-like evidence" : auditMessage(evidenceAudit)),
    check("no_raw_transcripts", !hasRawTranscriptFinding(evidenceAudit), "managed evidence does not store raw transcripts"),
    check("no_raw_tool_bodies", !hasRawToolBodyFinding(evidenceAudit), "managed evidence does not store raw tool bodies"),
    check("raw_output_preview_absent", !hasRawOutputPreviewFinding(evidenceAudit), "managed evidence does not store raw stdout/stderr previews"),
    check("managed_evidence_sanitized", evidenceAudit.secretFindings.length === 0, evidenceAudit.secretFindings.length === 0 ? "managed evidence contains no secret-like values" : `secret-like values found: ${evidenceAudit.secretFindings.map((finding) => finding.pointer).join(", ")}`),
    check("domain_eval_optional_or_valid", domainEvalValid, domainEval === null ? "domain-eval is optional and absent" : "domain-eval schema, agent id, ok status, and certification boundary are valid"),
  ];

  const ok = checks.every((item) => item.pass);
  const runtimePromotionEligible = ok && birthReport?.promotionEligible === true && birthReport?.evidenceLevel === "live-success";
  const deliveryReady = ok && runtimePromotionEligible && domainCertified;
  return {
    schemaVersion: DELIVERY_REPORT_SCHEMA_VERSION,
    ok,
    agentId: blueprint?.agent_id ?? null,
    target: {
      buildState: buildTargetId,
      runState: runTargetId,
      domainEval: domainTargetId,
    },
    runtimePromotionEligible,
    domainCertified,
    deliveryReady,
    artifacts: {
      blueprint: {
        available: true,
        path: options.blueprintPath ?? null,
        valid: validation.ok,
      },
      buildState: artifactSummary(buildState, options.buildStatePath, BUILD_STATE_SCHEMA_VERSION),
      runState: artifactSummary(runState, options.runStatePath, RUN_STATE_SCHEMA_VERSION),
      runEval: artifactSummary(runEval, options.runEvalPath, RUN_EVAL_SCHEMA_VERSION),
      birthReport: artifactSummary(birthReport, options.birthReportPath, BIRTH_REPORT_SCHEMA_VERSION),
      domainEval: domainEval === null ? { available: false, path: options.domainEvalPath ?? null, ok: false } : artifactSummary(domainEval, options.domainEvalPath, DOMAIN_EVAL_SCHEMA_VERSION),
    },
    hashes: {
      stableBlueprintHash,
      runtimeBlueprintHash,
      buildStateBlueprintHash: buildState?.source?.blueprintHash ?? null,
      runStateBlueprintHash: runState?.source?.blueprintHash ?? null,
    },
    evidence: {
      audit: summarizeAudit(evidenceAudit),
      runEvidenceLevel: evidenceLevel,
      birthEvidenceLevel: birthReport?.evidenceLevel ?? null,
    },
    checks,
    validation: {
      ok: validation.ok,
      warnings: validation.warnings,
      errors: validation.errors,
    },
    certificationBoundary: {
      runtimeCertifiedByDeliveryReport: false,
      domainCertifiedByDeliveryReport: false,
      productionApprovedByDeliveryReport: false,
      runtimeCertifiedByBirthReport: birthReport?.certificationBoundary?.runtimeCertifiedByBirthReport === true,
      domainCertifiedByBirthReport: birthReport?.certificationBoundary?.domainCertifiedByBirthReport === true,
      runtimeCertifiedByRun: runEval?.certificationBoundary?.runtimeCertifiedByRun === true || runState?.certificationBoundary?.runEvidenceCertifiesRuntime === true,
      domainCertifiedByRun: runEval?.certificationBoundary?.domainCertifiedByRun === true,
      runtimeCertifiedByDomainEval: domainEval?.certificationBoundary?.runtimeCertifiedByDomainEval === true,
      domainCertifiedByDomainEval: domainCertified,
      productionApprovedByDomainEval: domainEval?.certificationBoundary?.productionApprovedByDomainEval === true,
      domainCertifiedByDomainEvalSource: domainEval === null
        ? { available: false }
        : {
            available: true,
            schemaVersion: domainEval?.schemaVersion ?? null,
            ok: domainEval?.ok === true,
            agentId: domainEval?.agentId ?? null,
            target: domainEval?.target ?? null,
          },
    },
    nextActions: nextActions({ ok, domainCertified, runtimePromotionEligible, deliveryReady }),
  };
}

export function formatDeliveryReport(report) {
  const lines = [
    `AgentMo delivery report: ${report.agentId ?? "unknown"}`,
    `Status: ${report.ok ? "pass" : "fail"}`,
    `Domain certified by domain-eval: ${report.domainCertified ? "yes" : "no"}`,
    `Runtime promotion eligible: ${report.runtimePromotionEligible ? "yes" : "no"}`,
    `Delivery ready: ${report.deliveryReady ? "yes" : "no"}`,
    "Certification: delivery-report aggregates evidence only; it does not certify runtime, domain, or production approval",
  ];
  for (const checkItem of report.checks) lines.push(`- ${checkItem.pass ? "PASS" : "FAIL"} ${checkItem.id}: ${checkItem.message}`);
  if (report.nextActions.length > 0) {
    lines.push("", "Next actions:");
    for (const action of report.nextActions) lines.push(`- ${action}`);
  }
  return `${lines.join("\n")}\n`;
}

function artifactSummary(artifact, path, expectedSchemaVersion) {
  return {
    available: isObject(artifact),
    path: path ?? null,
    schemaVersion: artifact?.schemaVersion ?? null,
    expectedSchemaVersion,
    ok: artifact?.ok ?? null,
  };
}

function resolveEvidenceLevel(runState) {
  if (runState?.execution?.status === "success" && runState.execution.executed === true && runState.execution.live === true) return "live-success";
  if (runState?.execution?.status === "failure") return "failure";
  return "declared";
}

function hasNonCertifyingBoundary({ birthReport, runState, runEval }) {
  return (
    birthReport?.certificationBoundary?.runtimeCertifiedByBirthReport === false &&
    birthReport?.certificationBoundary?.domainCertifiedByBirthReport === false &&
    birthReport?.certificationBoundary?.runtimeCertifiedByRun === false &&
    birthReport?.certificationBoundary?.domainCertifiedByRun === false &&
    runState?.certificationBoundary?.runEvidenceCertifiesRuntime === false &&
    runEval?.certificationBoundary?.runtimeCertifiedByRun === false &&
    runEval?.certificationBoundary?.domainCertifiedByRun === false
  );
}

function hasValidDomainEvalCertification({ domainEval, blueprint }) {
  return (
    isObject(domainEval) &&
    domainEval.schemaVersion === DOMAIN_EVAL_SCHEMA_VERSION &&
    domainEval.ok === true &&
    nonEmptyString(blueprint?.agent_id) &&
    domainEval.agentId === blueprint.agent_id &&
    domainEval.runtimeCertifiedByDomainEval !== true &&
    domainEval.productionApprovedByDomainEval !== true &&
    domainEval.certificationBoundary?.runtimeCertifiedByDomainEval === false &&
    domainEval.certificationBoundary?.productionApprovedByDomainEval === false &&
    domainEval.certificationBoundary?.domainCertifiedByDomainEval === true &&
    domainEval.domainCertifiedByDomainEval === true
  );
}

function domainEvalTargetId(domainEval) {
  if (!domainEval) return null;
  return domainEval.target?.effective ?? domainEval.target?.cases ?? domainEval.targetId ?? domainEval.target?.id ?? null;
}

function blueprintTargetSet(blueprint) {
  return new Set(
    [
      blueprint?.runtime,
      ...(Array.isArray(blueprint?.runtime_profiles) ? blueprint.runtime_profiles.map((profile) => profile?.id) : []),
      ...(Array.isArray(blueprint?.pipeline?.produce?.runtime_targets) ? blueprint.pipeline.produce.runtime_targets : []),
    ].filter(nonEmptyString),
  );
}

function hasRawTranscriptFinding(audit) {
  return audit.rawFindings.some((finding) => /rawTranscripts?Stored|rawTranscripts?\b/u.test(finding.pointer));
}

function hasRawToolBodyFinding(audit) {
  return audit.rawFindings.some((finding) => /rawToolBod(?:y|ies)Stored|rawToolBod(?:y|ies)\b/u.test(finding.pointer));
}

function hasRawOutputPreviewFinding(audit) {
  return audit.rawFindings.some((finding) => /rawOutputPreviews?Stored|rawOutputPreviews?\b|stdoutPreviews?Stored|stdoutPreviews?\b|stderrPreviews?Stored|stderrPreviews?\b|rawPreviews?Stored|summaryKind|SummaryKind|rawStdoutPreviews?\b|rawStderrPreviews?\b/u.test(finding.pointer));
}

function summarizeAudit(audit) {
  return {
    ok: audit.ok,
    secretFindingCount: audit.secretFindings.length,
    rawFindingCount: audit.rawFindings.length,
    findings: audit.findings.map((finding) => ({ kind: finding.kind, pointer: finding.pointer, message: finding.message })),
  };
}

function auditMessage(audit) {
  const raw = audit.rawFindings.map((finding) => finding.pointer);
  const secret = audit.secretFindings.map((finding) => finding.pointer);
  const parts = [];
  if (raw.length > 0) parts.push(`raw evidence markers found: ${raw.join(", ")}`);
  if (secret.length > 0) parts.push(`secret-like values found: ${secret.join(", ")}`);
  return parts.join("; ") || "evidence audit failed";
}

function nextActions({ ok, domainCertified, runtimePromotionEligible, deliveryReady }) {
  if (!ok) return ["Fix failed delivery checks, rerun source evidence commands, then regenerate delivery-report."];
  if (!domainCertified) return ["Run domain-eval with deterministic bounded cases before domain certification claims."];
  if (!runtimePromotionEligible) return ["Collect live-success birth evidence before runtime promotion or delivery-ready claims."];
  if (!deliveryReady) return ["Resolve remaining delivery readiness blockers before release."];
  return [];
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function check(id, pass, message) {
  return { id, pass: Boolean(pass), message };
}
