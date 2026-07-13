import { createHash } from "node:crypto";
import { admittedArtifactProvenance } from "./artifact-admission.js";
import {
  OBSERVATION_SCHEMA_VERSION,
  validateObservationRecord,
} from "./observation.js";
import {
  serializePersistableJson,
  writePersistableJsonAtomic,
} from "./persistability.js";
import { validateRunStateArtifact } from "./run-state.js";

export function buildRunObservation(runState, options = {}) {
  if (!validateRunStateArtifact(runState).ok) {
    throw observationError("AGENTMO_OBSERVATION_RUN_STATE_INVALID");
  }
  const source = admittedArtifactProvenance(options.admission, {
    subject: "run-state",
    value: runState,
  });
  const runId = runState.runId;
  const agentId = runState.agentId;
  const executionStatus = runState.execution.status;
  const targetId = runState.target.id;
  const failureMode = describeFailureMode(runState, executionStatus, targetId);
  const observation = {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    agentId,
    source,
    failureMode,
    proposedRegression: {
      id: regressionId(agentId, runId),
      description: `Preserve coverage for ${targetId} run ${runId}: ${failureMode}.`,
      expectedEvidence: "A bounded run-state, run-report, run-eval output, and reviewed fix before any governed artifact change.",
    },
    recommendedBlueprintChange: {
      section: "runtime_profiles",
      proposal: "Review the admitted run evidence before proposing a runtime-profile change; apply nothing automatically.",
    },
    status: "proposed",
    runEvidence: {
      runId,
      parentRunId: runState.parentRunId,
      targetId,
      runtime: runState.runtimeIdentity.runtime,
      provider: boundedMetadata(runState.runtimeIdentity.provider, 128),
      model: boundedMetadata(runState.runtimeIdentity.model, 256),
      channel: boundedMetadata(runState.runtimeIdentity.channel, 128),
      transport: runState.runtimeIdentity.transport,
      fallbackFrom: boundedMetadata(runState.runtimeIdentity.fallbackFrom, 128),
      executionStatus,
      exitCode: runState.execution.exitCode,
      timedOut: runState.execution.timedOut,
      replayFidelity: runState.replay.replayFidelity,
      stdoutSummary: cloneJson(runState.execution.stdout),
      stderrSummary: cloneJson(runState.execution.stderr),
      certificationBoundary: {
        runtimeCertifiedByRun: false,
        domainCertifiedByRun: false,
      },
    },
    mutation: {
      autoApplied: false,
      blueprintMutated: false,
      scaffoldMutated: false,
      runtimeMutated: false,
      evalsMutated: false,
      reason: "observe-run writes proposal evidence only; governed artifacts require separate review and verification.",
    },
  };
  assertObservationCandidate(observation);
  return observation;
}

export async function writeRunObservation(filePath, observation, options = {}) {
  assertObservationCandidate(observation);
  serializePersistableJson(observation, { subject: "observation" });
  const writerOptions = options.io ? { io: options.io } : {};
  return writePersistableJsonAtomic(filePath, observation, {
    subject: "observation",
    ...writerOptions,
  });
}

function describeFailureMode(runState, executionStatus, targetId) {
  if (executionStatus === "failure") {
    const exitCode = runState.execution.exitCode ?? "unknown";
    const timeout = runState.execution.timedOut ? " after timeout" : "";
    return `${targetId} runtime execution failed${timeout} with exit code ${exitCode}`;
  }
  if (executionStatus === "declared") {
    return `${targetId} runtime execution is declared but not live-verified`;
  }
  return `${targetId} runtime execution produced success evidence that still requires domain eval certification`;
}

function assertObservationCandidate(observation) {
  const validation = validateObservationRecord(observation);
  if (!validation.ok) throw observationError("AGENTMO_OBSERVATION_INVALID");
}

function sanitizeId(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]+/gu, "-").replace(/^-+|-+$/gu, "") || "evidence";
}

function regressionId(agentId, runId) {
  const stem = `${sanitizeId(agentId)}-${sanitizeId(runId)}`;
  const suffix = "-runtime-evidence";
  if (stem.length + suffix.length <= 128) return `${stem}${suffix}`;
  const digest = createHash("sha256").update(stem).digest("hex").slice(0, 24);
  return `${sanitizeId(agentId).slice(0, 64)}-${digest}${suffix}`;
}

function boundedMetadata(value, maximumBytes) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  return Buffer.byteLength(value) <= maximumBytes ? value : null;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function observationError(code) {
  const error = new Error("Observation artifact operation failed.");
  error.code = code;
  return error;
}
