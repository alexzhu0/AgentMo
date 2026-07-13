import { isRedactedSummary, assertPersistable } from "./persistability.js";
import { RUN_STATE_SCHEMA_VERSION } from "./run-state.js";

export const OBSERVATION_SCHEMA_VERSION = "agentmo.observation.v1";
export const OBSERVATION_REPORT_SCHEMA_VERSION = "agentmo.observation-report.v1";

const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const KEBAB_ID_PATTERN = /^[a-z][a-z0-9-]*$/u;
const OBSERVATION_STATUSES = new Set(["proposed", "triaged", "regression_added", "resolved", "rejected"]);
const EXECUTION_STATUSES = new Set(["declared", "success", "failure"]);
const REPLAY_FIDELITIES = new Set(["exact", "reconstructed", "unavailable"]);
const TRANSPORTS = new Set(["gateway", "local", "embedded-fallback", "unknown"]);

export async function loadObservationRecord(filePath, options = {}) {
  if (options.subject !== "observation") throw observationError("AGENTMO_OBSERVATION_SUBJECT_REQUIRED");
  const { loadAdmittedArtifact } = await import("./artifact-admission.js");
  const admission = await loadAdmittedArtifact({
    filePath,
    subject: "observation",
    expectedDigest: options.expectedDigest,
    maxBytes: options.maxBytes,
    openInput: options.openInput,
  });
  return options.returnAdmission === true ? admission : admission.value;
}

export function validateObservationRecord(record) {
  const errors = [];
  const warnings = [];
  try {
    assertPersistable(record, { subject: "observation" });
  } catch {
    return { ok: false, errors: ["Observation record is not persistable."], warnings };
  }

  if (!plainObject(record)) {
    return { ok: false, errors: ["Observation record must be a JSON object."], warnings };
  }

  requireExactKeys(record, [
    "schemaVersion",
    "agentId",
    "source",
    "failureMode",
    "proposedRegression",
    "recommendedBlueprintChange",
    "status",
    "runEvidence",
    "mutation",
  ], "observation", errors);
  if (record.schemaVersion !== OBSERVATION_SCHEMA_VERSION) errors.push("invalid_schema_version");
  if (!KEBAB_ID_PATTERN.test(record.agentId ?? "")) errors.push("invalid_agent_id");
  if (!validRunStateProvenance(record.source)) errors.push("invalid_source");
  if (!boundedString(record.failureMode, 512)) errors.push("invalid_failure_mode");
  if (!validProposedRegression(record.proposedRegression)) errors.push("invalid_proposed_regression");
  if (!validBlueprintProposal(record.recommendedBlueprintChange)) errors.push("invalid_blueprint_proposal");
  if (!OBSERVATION_STATUSES.has(record.status)) errors.push("invalid_status");
  if (!validRunEvidence(record.runEvidence)) errors.push("invalid_run_evidence");
  if (!validMutationBoundary(record.mutation)) errors.push("invalid_mutation_boundary");

  return { ok: errors.length === 0, errors, warnings };
}

export function buildObservationReport(record) {
  const validation = validateObservationRecord(record);
  const admitted = validation.ok ? record : null;
  return {
    schemaVersion: OBSERVATION_REPORT_SCHEMA_VERSION,
    kind: "agentmo_observation_report",
    ok: validation.ok,
    summary: {
      schemaVersion: admitted?.schemaVersion ?? null,
      agentId: admitted?.agentId ?? null,
      source: admitted ? cloneJson(admitted.source) : null,
      failureMode: admitted?.failureMode ?? null,
      evidenceRefCount: admitted ? 1 : 0,
      status: admitted?.status ?? null,
      runId: admitted?.runEvidence?.runId ?? null,
      executionStatus: admitted?.runEvidence?.executionStatus ?? null,
    },
    proposedRegression: admitted ? cloneJson(admitted.proposedRegression) : null,
    recommendedBlueprintChange: {
      proposalOnly: true,
      value: admitted ? cloneJson(admitted.recommendedBlueprintChange) : null,
    },
    mutation: {
      autoApplied: false,
      blueprintMutated: false,
      scaffoldMutated: false,
      runtimeMutated: false,
      evalsMutated: false,
      reason: "Observation records are proposals; governed artifacts require a separate reviewed change.",
    },
    warnings: validation.warnings,
    errors: validation.errors,
  };
}

export function formatObservationReport(report) {
  const source = report.summary.source;
  const lines = [
    `AgentMo observation: ${report.summary.agentId ?? "unknown"}`,
    `Status: ${report.ok ? "valid" : "invalid"}`,
    `Source: ${source ? `${source.subject} ${source.digest}` : "unknown"}`,
    `Run: ${report.summary.runId ?? "unknown"}`,
    `Failure mode: ${report.summary.failureMode ?? "unknown"}`,
    `Evidence refs: ${report.summary.evidenceRefCount}`,
    `Mutation: ${report.mutation.autoApplied ? "auto-applied" : "proposal only"}`,
  ];

  if (report.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const warning of report.warnings) lines.push(`- ${warning}`);
  }

  if (report.errors.length > 0) {
    lines.push("", "Errors:");
    for (const error of report.errors) lines.push(`- ${error}`);
  }

  return `${lines.join("\n")}\n`;
}

function validRunStateProvenance(value) {
  return hasExactKeys(value, ["identity", "subject", "digest"])
    && value.identity === RUN_STATE_SCHEMA_VERSION
    && value.subject === "run-state"
    && SHA256_DIGEST_PATTERN.test(value.digest);
}

function validProposedRegression(value) {
  return hasExactKeys(value, ["id", "description", "expectedEvidence"])
    && SAFE_ID_PATTERN.test(value.id ?? "")
    && boundedString(value.description, 1024)
    && boundedString(value.expectedEvidence, 1024);
}

function validBlueprintProposal(value) {
  return hasExactKeys(value, ["section", "proposal"])
    && SAFE_ID_PATTERN.test(value.section ?? "")
    && boundedString(value.proposal, 1024);
}

function validRunEvidence(value) {
  return hasExactKeys(value, [
    "runId",
    "parentRunId",
    "targetId",
    "runtime",
    "provider",
    "model",
    "channel",
    "transport",
    "fallbackFrom",
    "executionStatus",
    "exitCode",
    "timedOut",
    "replayFidelity",
    "stdoutSummary",
    "stderrSummary",
    "certificationBoundary",
  ])
    && SAFE_ID_PATTERN.test(value.runId ?? "")
    && (value.parentRunId === null || SAFE_ID_PATTERN.test(value.parentRunId ?? ""))
    && value.targetId === "openclaw"
    && value.runtime === "openclaw"
    && nullableBoundedString(value.provider, 128)
    && nullableBoundedString(value.model, 256)
    && nullableBoundedString(value.channel, 128)
    && TRANSPORTS.has(value.transport)
    && nullableBoundedString(value.fallbackFrom, 128)
    && EXECUTION_STATUSES.has(value.executionStatus)
    && (value.exitCode === null || Number.isInteger(value.exitCode))
    && typeof value.timedOut === "boolean"
    && REPLAY_FIDELITIES.has(value.replayFidelity)
    && isRedactedSummary(value.stdoutSummary)
    && isRedactedSummary(value.stderrSummary)
    && hasExactKeys(value.certificationBoundary, ["runtimeCertifiedByRun", "domainCertifiedByRun"])
    && value.certificationBoundary.runtimeCertifiedByRun === false
    && value.certificationBoundary.domainCertifiedByRun === false;
}

function validMutationBoundary(value) {
  return hasExactKeys(value, [
    "autoApplied",
    "blueprintMutated",
    "scaffoldMutated",
    "runtimeMutated",
    "evalsMutated",
    "reason",
  ])
    && value.autoApplied === false
    && value.blueprintMutated === false
    && value.scaffoldMutated === false
    && value.runtimeMutated === false
    && value.evalsMutated === false
    && boundedString(value.reason, 512);
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

function boundedString(value, maximum) {
  return typeof value === "string" && value.trim().length > 0 && Buffer.byteLength(value) <= maximum;
}

function nullableBoundedString(value, maximum) {
  return value === null || boundedString(value, maximum);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function observationError(code) {
  const error = new Error("Observation artifact operation failed.");
  error.code = code;
  return error;
}
