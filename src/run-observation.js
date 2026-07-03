import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { OBSERVATION_SCHEMA_VERSION } from "./observation.js";
import { RUN_STATE_SCHEMA_VERSION } from "./run-state.js";

export function buildRunObservation(runState, options = {}) {
  if (runState?.schemaVersion !== RUN_STATE_SCHEMA_VERSION) {
    throw new Error(`Cannot build observation for unsupported run-state schema: ${runState?.schemaVersion ?? "missing"}`);
  }

  const runId = nonEmptyString(runState.runId) ?? "unknown-run";
  const agentId = nonEmptyString(runState.agentId) ?? "unknown-agent";
  const executionStatus = nonEmptyString(runState.execution?.status) ?? "unknown";
  const targetId = nonEmptyString(runState.target?.id) ?? "unknown-target";
  const source = `agentmo-run:${runId}`;
  const evidenceRefs = uniqueStrings([options.runStatePath, source]);
  const failureMode = describeFailureMode(runState, executionStatus, targetId);

  return {
    schemaVersion: OBSERVATION_SCHEMA_VERSION,
    agentId,
    source,
    failureMode,
    evidenceRefs,
    proposedRegression: {
      id: `${sanitizeId(agentId)}-${sanitizeId(runId)}-runtime-evidence`,
      description: `Preserve coverage for ${targetId} run ${runId}: ${failureMode}.`,
      expectedEvidence: "A bounded run-state, run-report, run-eval output, and reviewed fix evidence before any blueprint or scaffold change.",
    },
    recommendedBlueprintChange: {
      section: "runtime_profiles",
      proposal:
        "Review this run evidence before changing runtime profile, scaffold, prompts, tools, or evals; do not apply changes automatically from run-state evidence.",
    },
    status: "proposed",
    runEvidence: {
      runId,
      parentRunId: runState.parentRunId ?? null,
      targetId,
      runtime: runState.runtimeIdentity?.runtime ?? null,
      provider: runState.runtimeIdentity?.provider ?? null,
      model: runState.runtimeIdentity?.model ?? null,
      channel: runState.runtimeIdentity?.channel ?? null,
      transport: runState.runtimeIdentity?.transport ?? null,
      fallbackFrom: runState.runtimeIdentity?.fallbackFrom ?? null,
      executionStatus,
      exitCode: runState.execution?.exitCode ?? null,
      timedOut: Boolean(runState.execution?.timedOut),
      replayFidelity: runState.replay?.replayFidelity ?? runState.message?.replayFidelityIfMaterialAvailable ?? null,
      sandboxScope: runState.runtimeIdentity?.sandboxScope ?? null,
      certificationBoundary: {
        runtimeCertifiedByRun: false,
        domainCertifiedByRun: false,
      },
    },
    mutation: {
      autoApplied: false,
      reason: "observe-run creates proposal-only evidence; blueprint, tool, eval, and scaffold changes require separate review and verification.",
    },
  };
}

export async function writeRunObservation(filePath, observation) {
  const resolved = path.resolve(filePath);
  await mkdir(path.dirname(resolved), { recursive: true });
  const temporaryFile = `${resolved}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryFile, `${JSON.stringify(observation, null, 2)}\n`, "utf8");
  await rename(temporaryFile, resolved);
  return resolved;
}

function describeFailureMode(runState, executionStatus, targetId) {
  if (executionStatus === "failure") {
    const exitCode = runState.execution?.exitCode ?? "unknown";
    const timeout = runState.execution?.timedOut ? " after timeout" : "";
    return `${targetId} runtime execution failed${timeout} with exit code ${exitCode}`;
  }
  if (executionStatus === "declared") {
    return `${targetId} runtime execution is declared but not live-verified`;
  }
  if (executionStatus === "success") {
    return `${targetId} runtime execution produced success evidence that still requires domain eval certification`;
  }
  return `${targetId} runtime execution status is ${executionStatus}`;
}

function nonEmptyString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0)));
}

function sanitizeId(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]+/gu, "-").replace(/^-+|-+$/gu, "") || "evidence";
}
