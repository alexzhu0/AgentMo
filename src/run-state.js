import { randomUUID, createHash } from "node:crypto";
import { mkdir, open, stat, unlink } from "node:fs/promises";
import path from "node:path";
import {
  materializeRuntimePlanForRun,
  RUNTIME_PLAN_SCHEMA_VERSION,
  SUPPORTED_TRANSPORTS,
  TRANSIENT_MESSAGE_PLACEHOLDER,
  validateRuntimePlanArtifact,
} from "./runtime-plan.js";
import { assertRuntimeEnvReady, resolveRuntimeEnv } from "./runtime-env.js";
import { assertCurrentOpenClawTargetRuntime } from "./runtime-compatibility.js";
import { runRuntimeCommand } from "./runtime-execution.js";
import {
  assertPersistable,
  isRedactedSummary,
  isSecretPresence,
  serializePersistableJson,
  writePersistableJsonAtomic,
} from "./persistability.js";
import { redactSecrets } from "./secret-redaction.js";

export const RUN_STATE_SCHEMA_VERSION = "agentmo.run.v1";
export const RUN_INDEX_SCHEMA_VERSION = "agentmo.run-index.v1";
export const RUN_STATE_FILENAME = "agentmo-run-state.json";
export const RUN_INDEX_FILENAME = "agentmo-run-index.json";
export const OUTPUT_TEXT_LIMIT = 4000;
export const RUN_REPORT_SCHEMA_VERSION = "agentmo.run-report.v1";
export const RUN_EVAL_SCHEMA_VERSION = "agentmo.run-eval.v1";

export const RUN_EVAL_CHECK_IDS = Object.freeze([
  "schema",
  "execution",
  "source_runtime_plan_digest",
  "message_provenance",
  "replayability",
  "replay_fidelity",
  "identity_fields",
  "runtime_env_ready",
  "transport",
  "fallback_evidence",
  "sandbox",
  "sandbox_non_production",
  "certification_boundary",
  "process_group_closed",
  "output_summary_consistent",
  "output_body_absent",
  "expected_status",
  "require_exact_replay",
]);

const RUN_EVAL_CHECK_MESSAGES = Object.freeze({
  schema: "run-state schema is supported",
  execution: "execution evidence satisfies the canonical state machine",
  source_runtime_plan_digest: "source artifact digest is present",
  message_provenance: "message provenance is bounded and replayable",
  replayability: "run has replay metadata and message provenance",
  replay_fidelity: "replay fidelity is explicit",
  identity_fields: "runtime identity fields are present as separate fields",
  runtime_env_ready: "live provider runtime env descriptor satisfies required keys",
  transport: "transport field is present and explicit",
  fallback_evidence: "embedded fallback is backed by bounded evidence",
  sandbox: "sandbox scope is present",
  sandbox_non_production: "sandbox scope does not use production OpenClaw state",
  certification_boundary: "run evidence does not certify runtime/domain behavior",
  process_group_closed: "timed-out live runs prove process-group cleanup or fail closed",
  output_summary_consistent: "runtime output evidence uses exact bounded summaries",
  output_body_absent: "run evidence does not store output previews",
  expected_status: "execution status matches the optional expected status",
  require_exact_replay: "replay fidelity is exact when required",
});

const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;

export async function executeRuntimeRun(runtimePlan, options = {}, commandRunner = null) {
  if (!validateRuntimePlanArtifact(runtimePlan).ok) throw runStateError("AGENTMO_RUNTIME_PLAN_INVALID");
  const { admittedArtifactProvenance } = await import("./artifact-admission.js");
  const source = admittedArtifactProvenance(options.admission, {
    subject: "runtime-plan",
    value: runtimePlan,
  });
  if (options.live) assertCurrentOpenClawTargetRuntime();
  const runId = options.runId ?? generateRunId(options.now);
  const startedAt = isoTimestamp(options.now);
  const materialized = materializeRuntimePlanForRun(runtimePlan, { ...options, runId });
  const runtimeEnv = resolveRuntimeEnv(options);
  const durablePlan = materialized.durablePlan;
  durablePlan.runtimeIdentity.runtimeEnv = runtimeEnv.descriptor;
  durablePlan.runtimeIdentity.sandboxScope.environmentAllowlist = uniqueStrings([
    ...(durablePlan.runtimeIdentity.sandboxScope.environmentAllowlist ?? []),
    ...runtimeEnv.descriptor.presentNames,
  ]);
  materialized.transientRuntimeIdentity.runtimeEnv = runtimeEnv.descriptor;
  materialized.transientRuntimeIdentity.sandboxScope.environmentAllowlist = durablePlan.runtimeIdentity.sandboxScope.environmentAllowlist;
  assertRuntimeEnvReady(runtimeEnv.descriptor, {
    live: Boolean(options.live),
    provider: durablePlan.runtimeIdentity.provider,
    transport: durablePlan.runtimeIdentity.transport,
  });
  if (options.live
    && !materialized.transientRuntimeIdentity.sandboxScope.stateDir
    && durablePlan.runtimeIdentity.sandboxScope.usesProductionState !== true) {
    throw new Error("Live OpenClaw runs require --openclaw-state-dir <dir> or explicit --use-production-openclaw-state.");
  }
  if (options.out) await preflightRunIndexForWrite(options.out, options);

  const live = Boolean(options.live);
  const runner = commandRunner ?? runRuntimeCommand;
  const runnerOptions = { ...options, runtimeEnvValues: runtimeEnv.values };
  const runnerResult = live
    ? await runner(materialized.transientCommand, materialized.transientRuntimeIdentity, runnerOptions)
    : null;
  durablePlan.runtimeIdentity = resolveActualRuntimeIdentity(durablePlan.runtimeIdentity, runnerResult);
  const endedAt = isoTimestamp(options.endedAt ?? options.now);
  const execution = buildExecution({ live, runnerResult, startedAt, endedAt, secretValues: runtimeEnv.secretValues });
  const runState = buildRunState({
    durablePlan,
    options,
    source: {
      input: source,
      blueprint: cloneJson(durablePlan.source),
      runtimePlan: source,
    },
    runId,
    startedAt,
    endedAt,
    execution,
  });
  assertRunStateCandidate(runState);

  if (options.out) {
    const paths = await writeRunState(options.out, runState, {
      io: options.io,
      runIndexDigest: options.runIndexDigest,
      openInput: options.openInput,
    });
    return { runState, stateFile: paths.stateFile, indexFile: paths.indexFile };
  }
  return { runState, stateFile: null, indexFile: null };
}

export async function writeRunState(outDir, runState, options = {}) {
  assertRunStateCandidate(runState);
  const outputRoot = path.resolve(outDir);
  const stateRelativePath = path.posix.join("runs", runState.runId, RUN_STATE_FILENAME);
  const stateFile = path.join(outputRoot, ...stateRelativePath.split("/"));
  const indexFile = path.join(outputRoot, RUN_INDEX_FILENAME);
  const lockFile = path.join(outputRoot, ".agentmo-run-index.lock");
  const stateText = serializePersistableJson(runState, { subject: "run-state" });
  const stateDigest = digestBytes(Buffer.from(stateText, "utf8"));
  await mkdir(outputRoot, { recursive: true });
  let lockHandle;
  try {
    try {
      lockHandle = await open(lockFile, "wx", 0o600);
    } catch (error) {
      if (error?.code === "EEXIST") throw runStateError("AGENTMO_RUN_INDEX_BUSY");
      throw error;
    }
    const previousIndex = await readExistingRunIndex(outputRoot, indexFile, runState.updatedAt, options);
    const index = cloneJson(previousIndex);
    index.updatedAt = runState.updatedAt;
    index.latestRunId = runState.runId;
    const entry = {
      runId: runState.runId,
      agentId: runState.agentId,
      targetId: runState.target.id,
      statePath: stateRelativePath,
      stateDigest,
      status: runState.execution.status,
      executed: runState.execution.executed,
      updatedAt: runState.updatedAt,
    };
    index.runs = index.runs.filter((item) => item.runId !== runState.runId);
    index.runs.push(entry);
    index.runs.sort((left, right) => left.runId.localeCompare(right.runId));
    assertRunIndexCandidate(index);
    serializePersistableJson(index, { subject: "run-index" });

    const writerOptions = options.io ? { io: options.io } : {};
    await writePersistableJsonAtomic(stateFile, runState, { subject: "run-state", ...writerOptions });
    await writePersistableJsonAtomic(indexFile, index, { subject: "run-index", ...writerOptions });
    return { stateFile, indexFile, stateDigest };
  } finally {
    await lockHandle?.close();
    if (lockHandle) {
      try {
        await unlink(lockFile);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }
}

export async function loadRunState(filePath, options = {}) {
  if (options.subject !== "run-state") throw runStateError("AGENTMO_RUN_STATE_SUBJECT_REQUIRED");
  const { loadAdmittedArtifact } = await import("./artifact-admission.js");
  const admission = await loadAdmittedArtifact({
    filePath,
    subject: "run-state",
    expectedDigest: options.expectedDigest,
    maxBytes: options.maxBytes,
    openInput: options.openInput,
  });
  return options.returnAdmission === true ? admission : admission.value;
}

export async function loadRunIndex(runDir, options = {}) {
  if (options.subject !== "run-index") throw runStateError("AGENTMO_RUN_INDEX_SUBJECT_REQUIRED");
  const { loadAdmittedArtifact } = await import("./artifact-admission.js");
  const admission = await loadAdmittedArtifact({
    filePath: path.join(path.resolve(runDir), RUN_INDEX_FILENAME),
    subject: "run-index",
    expectedDigest: options.expectedDigest,
    maxBytes: options.maxBytes,
    openInput: options.openInput,
  });
  return options.returnAdmission === true ? admission : admission.value;
}

export async function resolveLatestRunStateFromDir(runDir, options = {}) {
  const indexAdmission = await loadRunIndex(runDir, {
    subject: "run-index",
    expectedDigest: options.runIndexDigest,
    returnAdmission: true,
  });
  const index = indexAdmission.value;
  const entry = index.latestRunId ? index.runs.find((item) => item.runId === index.latestRunId) : null;
  if (!entry?.statePath || !entry?.stateDigest) {
    throw new Error("Run index does not contain an exact latest run-state pointer.");
  }
  if (entry.stateDigest !== options.runStateDigest) throw runStateError("AGENTMO_RUN_INDEX_STATE_DIGEST_MISMATCH");
  const statePath = path.join(path.resolve(runDir), ...entry.statePath.split("/"));
  const stateAdmission = await loadRunState(statePath, {
    subject: "run-state",
    expectedDigest: options.runStateDigest,
    returnAdmission: true,
  });
  return {
    runState: stateAdmission.value,
    runStateAdmission: stateAdmission,
    runStatePath: statePath,
    runIndex: index,
    runIndexAdmission: indexAdmission,
  };
}

export async function preflightRunIndexForWrite(outDir, options = {}) {
  const outputRoot = path.resolve(outDir);
  await readExistingRunIndex(
    outputRoot,
    path.join(outputRoot, RUN_INDEX_FILENAME),
    isoTimestamp(options.now),
    options,
  );
}

export function validateRunStateArtifact(runState) {
  const errors = [];
  try {
    assertPersistable(runState, { subject: "run-state" });
    requireExactKeys(runState, [
      "schemaVersion", "runId", "parentRunId", "agentId", "target", "createdAt", "updatedAt", "source",
      "runtimeIdentity", "command", "message", "execution", "replay", "evidence", "certificationBoundary",
    ], "run_state", errors);
    if (runState?.schemaVersion !== RUN_STATE_SCHEMA_VERSION) errors.push("invalid_schema_version");
    if (!safeId(runState?.runId)) errors.push("invalid_run_id");
    if (runState?.parentRunId !== null && !safeId(runState?.parentRunId)) errors.push("invalid_parent_run_id");
    if (!isKebabId(runState?.agentId)) errors.push("invalid_agent_id");
    if (!validTarget(runState?.target)) errors.push("invalid_target");
    if (!validTimestamp(runState?.createdAt) || !validTimestamp(runState?.updatedAt)) errors.push("invalid_timestamp");
    if (!validRunSource(runState?.source)) errors.push("invalid_source");
    if (!validRuntimeIdentity(runState?.runtimeIdentity)) errors.push("invalid_runtime_identity");
    if (!validDurableCommand(runState?.command)) errors.push("invalid_command");
    if (!validMessageRecord(runState?.message)) errors.push("invalid_message");
    if (!validExecution(runState?.execution)) errors.push("invalid_execution");
    if (!validReplay(runState?.replay, runState)) errors.push("invalid_replay");
    if (!validEvidence(runState?.evidence, runState?.execution)) errors.push("invalid_evidence");
    if (!hasExactKeys(runState?.certificationBoundary, ["runEvidenceCertifiesRuntime", "note"])
      || runState.certificationBoundary.runEvidenceCertifiesRuntime !== false
      || !nonEmptyString(runState.certificationBoundary.note)) errors.push("invalid_certification_boundary");
  } catch {
    errors.push("unsafe_run_state_shape");
  }
  return { ok: errors.length === 0, errors };
}

export function validateRunIndexArtifact(index) {
  const errors = [];
  try {
    assertPersistable(index, { subject: "run-index" });
    requireExactKeys(index, ["schemaVersion", "updatedAt", "latestRunId", "runs"], "run_index", errors);
    if (index?.schemaVersion !== RUN_INDEX_SCHEMA_VERSION) errors.push("invalid_schema_version");
    if (!validTimestamp(index?.updatedAt)) errors.push("invalid_updated_at");
    if (index?.latestRunId !== null && !safeId(index?.latestRunId)) errors.push("invalid_latest_run_id");
    if (!Array.isArray(index?.runs)) errors.push("invalid_runs");
    else {
      let previous = null;
      const seen = new Set();
      for (const entry of index.runs) {
        const runId = entry?.runId;
        if (!safeId(runId) || !validRunIndexEntry(entry, runId) || seen.has(runId) || (previous !== null && previous >= runId)) {
          errors.push("invalid_run_entry");
        }
        seen.add(runId);
        previous = runId;
      }
      if (index.latestRunId !== null && !seen.has(index.latestRunId)) errors.push("latest_run_missing");
    }
  } catch {
    errors.push("unsafe_run_index_shape");
  }
  return { ok: errors.length === 0, errors };
}

export function buildRunReport(runState) {
  return {
    schemaVersion: RUN_REPORT_SCHEMA_VERSION,
    ok: validateRunStateArtifact(runState).ok,
    summary: summarizeRunState(runState),
    runtimeIdentity: runState?.runtimeIdentity ?? null,
    message: summarizeMessage(runState?.message),
    replay: runState?.replay ?? null,
    evidence: runState?.evidence ?? null,
    certificationBoundary: runState?.certificationBoundary ?? null,
    observationRef: runState ? `agentmo-run:${runState.runId}` : null,
  };
}

export function buildRunEval(runState, options = {}) {
  const expectedStatus = options.expectStatus ?? null;
  const requireExactReplay = options.requireExactReplay === true;
  const replayFidelityValue = messageFidelity(runState?.message, options);
  const checks = deriveRunEvalChecks(runState, {
    expectedStatus,
    requireExactReplay,
    replayFidelity: replayFidelityValue,
  });
  const report = {
    schemaVersion: RUN_EVAL_SCHEMA_VERSION,
    ok: checks.every((item) => item.pass),
    source: options.source ?? null,
    runId: runState?.runId ?? null,
    expectedStatus,
    actualStatus: runState?.execution?.status ?? null,
    replayFidelity: replayFidelityValue,
    requireExactReplay,
    checks,
    certificationBoundary: { runtimeCertifiedByRun: false, domainCertifiedByRun: false },
    evidenceLevels: {
      declaredReady: false,
      liveSuccess: false,
      domainCertified: false,
      deliveryReady: false,
      productionApproved: false,
    },
  };
  assertPersistable(report, { subject: "run-eval" });
  return report;
}

export async function buildRunEvalVerified(runState, options = {}) {
  const { admittedArtifactProvenance } = await import("./artifact-admission.js");
  const source = admittedArtifactProvenance(options.admission, {
    subject: "run-state",
    value: runState,
  });
  const report = buildRunEval(runState, { ...options, source });
  if (!validateRunEvalArtifact(report, { runState, source }).ok) throw runStateError("AGENTMO_RUN_EVAL_INVALID");
  return report;
}

export function validateRunEvalArtifact(report, context = {}) {
  const errors = [];
  try {
    assertPersistable(report, { subject: "run-eval" });
    requireExactKeys(report, [
      "schemaVersion", "ok", "source", "runId", "expectedStatus", "actualStatus", "replayFidelity",
      "requireExactReplay", "checks", "certificationBoundary", "evidenceLevels",
    ], "run_eval", errors);
    if (report?.schemaVersion !== RUN_EVAL_SCHEMA_VERSION) errors.push("invalid_schema_version");
    if (typeof report?.ok !== "boolean") errors.push("invalid_ok");
    if (!validArtifactProvenance(report?.source, [["run-state", RUN_STATE_SCHEMA_VERSION]])) errors.push("invalid_source");
    if (!safeId(report?.runId)) errors.push("invalid_run_id");
    if (report?.expectedStatus !== null && !["declared", "success", "failure"].includes(report.expectedStatus)) errors.push("invalid_expected_status");
    if (!["declared", "success", "failure"].includes(report?.actualStatus)) errors.push("invalid_actual_status");
    if (!["exact", "reconstructed", "unavailable"].includes(report?.replayFidelity)) errors.push("invalid_replay_fidelity");
    if (typeof report?.requireExactReplay !== "boolean") errors.push("invalid_replay_requirement");
    if (!validCanonicalRunEvalChecks(report)) errors.push("invalid_checks");
    if (context?.runState !== undefined
      && !runEvalMatchesSource(report, context.runState, context.source)) errors.push("source_evidence_mismatch");
    if (!hasExactKeys(report?.certificationBoundary, ["runtimeCertifiedByRun", "domainCertifiedByRun"])
      || report.certificationBoundary.runtimeCertifiedByRun !== false
      || report.certificationBoundary.domainCertifiedByRun !== false) errors.push("invalid_certification_boundary");
    if (!hasExactKeys(report?.evidenceLevels, ["declaredReady", "liveSuccess", "domainCertified", "deliveryReady", "productionApproved"])
      || Object.values(report.evidenceLevels).some((value) => value !== false)) errors.push("invalid_evidence_levels");
  } catch {
    errors.push("unsafe_run_eval_shape");
  }
  return { ok: errors.length === 0, errors };
}

export async function replayRunState(parentRunState, options = {}, commandRunner = null) {
  assertRunStateCandidate(parentRunState);
  const { admittedArtifactProvenance } = await import("./artifact-admission.js");
  const source = admittedArtifactProvenance(options.admission, {
    subject: "run-state",
    value: parentRunState,
  });
  if (options.live) assertCurrentOpenClawTargetRuntime();
  const fidelity = messageFidelity(parentRunState.message, options);
  if (options.requireExactReplay && fidelity !== "exact") throw runStateError("AGENTMO_REPLAY_EXACT_MESSAGE_REQUIRED");
  const transientBytes = transientMessageBytes(options);
  if (options.live && transientBytes === null) throw runStateError("AGENTMO_REPLAY_MESSAGE_REQUIRED");
  if (options.out) await preflightRunIndexForWrite(options.out, options);
  const runId = options.runId ?? generateRunId(options.now);
  const startedAt = isoTimestamp(options.now);
  const endedAt = isoTimestamp(options.endedAt ?? options.now);
  const runState = materializeReplayRunState(parentRunState, { ...options, runId, startedAt, endedAt, fidelity, source });
  if (transientBytes !== null) runState.message = messageRecordFromBytes(transientBytes);

  const runtimeEnv = resolveRuntimeEnv(options);
  if (options.envFile) {
    runState.runtimeIdentity.runtimeEnv = runtimeEnv.descriptor;
    runState.runtimeIdentity.sandboxScope.environmentAllowlist = uniqueStrings([
      ...(runState.runtimeIdentity.sandboxScope.environmentAllowlist ?? []),
      ...runtimeEnv.descriptor.presentNames,
    ]);
  }
  assertRuntimeEnvReady(options.live ? runtimeEnv.descriptor : runState.runtimeIdentity.runtimeEnv, {
    live: Boolean(options.live),
    provider: runState.runtimeIdentity.provider,
    transport: runState.runtimeIdentity.transport,
  });

  const live = Boolean(options.live);
  let runnerResult = null;
  if (live) {
    const transientRuntimeIdentity = hydrateRuntimeIdentity(runState.runtimeIdentity, options);
    if (!transientRuntimeIdentity.sandboxScope.stateDir && runState.runtimeIdentity.sandboxScope.usesProductionState !== true) {
      throw new Error("Live OpenClaw replay requires --openclaw-state-dir metadata or explicit production-state evidence.");
    }
    const messageText = decodeMessageBytes(transientBytes);
    const command = materializeReplayCommand(runState.command, transientRuntimeIdentity, messageText);
    const runner = commandRunner ?? runRuntimeCommand;
    runnerResult = await runner(command, transientRuntimeIdentity, { ...options, runtimeEnvValues: runtimeEnv.values });
  }
  runState.runtimeIdentity = resolveActualRuntimeIdentity(runState.runtimeIdentity, runnerResult);
  runState.execution = buildExecution({ live, runnerResult, startedAt, endedAt, secretValues: runtimeEnv.secretValues });
  runState.evidence = buildRuntimeOutputEvidence(runState.execution, runState.runtimeIdentity.evidenceBoundaries);
  setCommandMutationFlags(runState.command, runState.execution, runState.runtimeIdentity);
  runState.updatedAt = endedAt;
  assertRunStateCandidate(runState);
  if (options.out) {
    const paths = await writeRunState(options.out, runState, {
      io: options.io,
      runIndexDigest: options.runIndexDigest,
      openInput: options.openInput,
    });
    return { runState, stateFile: paths.stateFile, indexFile: paths.indexFile };
  }
  return { runState, stateFile: null, indexFile: null };
}

function buildRunState({ durablePlan, options, source, runId, startedAt, endedAt, execution }) {
  const command = cloneJson(durablePlan.command);
  setCommandMutationFlags(command, execution, durablePlan.runtimeIdentity);
  return {
    schemaVersion: RUN_STATE_SCHEMA_VERSION,
    runId,
    parentRunId: options.parentRunId ?? null,
    agentId: durablePlan.agentId,
    target: cloneJson(durablePlan.target),
    createdAt: startedAt,
    updatedAt: endedAt,
    source,
    runtimeIdentity: cloneJson(durablePlan.runtimeIdentity),
    command,
    message: cloneJson(durablePlan.message),
    execution,
    replay: {
      eligible: true,
      policy: "fresh-child-session",
      resumeSession: false,
      parentRunId: options.parentRunId ?? null,
      replayFidelity: "unavailable",
    },
    evidence: buildRuntimeOutputEvidence(execution, durablePlan.runtimeIdentity.evidenceBoundaries),
    certificationBoundary: cloneJson(durablePlan.certificationBoundary),
  };
}

function materializeReplayRunState(parentRunState, options) {
  const runState = cloneJson(parentRunState);
  const parentSessionKey = runState.runtimeIdentity.selector.executionSelector.sessionKey ?? null;
  const sessionKey = options.resumeSession ? parentSessionKey : `agentmo-${sanitizeSelectorPart(runState.agentId)}-${sanitizeSelectorPart(options.runId)}`;
  runState.runId = options.runId;
  runState.parentRunId = parentRunState.runId;
  runState.createdAt = options.startedAt;
  runState.updatedAt = options.endedAt;
  runState.source = {
    input: options.source,
    blueprint: cloneJson(parentRunState.source.blueprint),
    runtimePlan: cloneJson(parentRunState.source.runtimePlan),
  };
  if (options.resumeSession) {
    runState.runtimeIdentity.selector.executionSessionPolicy = "operator-supplied";
    runState.runtimeIdentity.selector.explicitSessionReuse = true;
    runState.runtimeIdentity.selector.executionSelector.generated = false;
  } else {
    runState.runtimeIdentity.selector.executionSessionPolicy = "fresh-per-run";
    runState.runtimeIdentity.selector.explicitSessionReuse = false;
    runState.runtimeIdentity.selector.executionSelector.sessionKey = sessionKey;
    runState.runtimeIdentity.selector.executionSelector.sessionId = null;
    runState.runtimeIdentity.selector.executionSelector.to = null;
    runState.runtimeIdentity.selector.executionSelector.generated = true;
    runState.command.args = rebuildCommandArgsForReplay(runState);
    runState.command.display = displayCommand(runState.command.executable, runState.command.args);
  }
  runState.replay = {
    eligible: true,
    policy: options.resumeSession ? "same-session-resume" : "fresh-child-session",
    resumeSession: Boolean(options.resumeSession),
    parentRunId: parentRunState.runId,
    replayFidelity: options.fidelity,
  };
  runState.command.mutatesOpenClawState = false;
  runState.command.mutatesProductionOpenClawState = false;
  runState.command.mutatesIsolatedOpenClawState = false;
  return runState;
}

function rebuildCommandArgsForReplay(runState) {
  const args = runState.command.executable === "pnpm" ? ["openclaw", "agent"] : ["agent"];
  const selector = runState.runtimeIdentity.selector.executionSelector;
  if (["local", "embedded-fallback"].includes(runState.runtimeIdentity.transport)) args.push("--local");
  args.push("--json");
  if (runState.runtimeIdentity.model) args.push("--model", runState.runtimeIdentity.model);
  if (runState.runtimeIdentity.thinking) args.push("--thinking", runState.runtimeIdentity.thinking);
  if (selector.agent) args.push("--agent", selector.agent);
  if (selector.sessionKey) args.push("--session-key", selector.sessionKey);
  if (selector.sessionId) args.push("--session-id", selector.sessionId);
  if (selector.to) args.push("--to", selector.to);
  args.push("--message", TRANSIENT_MESSAGE_PLACEHOLDER);
  return args;
}

function hydrateRuntimeIdentity(identity, options) {
  const hydrated = cloneJson(identity);
  hydrated.workspace = requiredPath(options.workspace, "workspace");
  hydrated.sandboxScope.workspaceRoot = hydrated.workspace;
  hydrated.sandboxScope.openClawSourceRoot = identity.sandboxScope.sourceRoot
    ? requiredPath(options.openClawSourceRoot, "OpenClaw source root")
    : null;
  hydrated.sandboxScope.stateDir = identity.sandboxScope.state
    ? requiredPath(options.openClawStateDir, "OpenClaw state")
    : null;
  return hydrated;
}

function materializeReplayCommand(command, runtimeIdentity, messageText) {
  return {
    ...cloneJson(command),
    cwd: runtimeIdentity.sandboxScope.openClawSourceRoot,
    args: command.args.map((arg) => (arg === TRANSIENT_MESSAGE_PLACEHOLDER ? messageText : arg)),
    display: displayCommand(command.executable, command.args.map((arg) => (arg === TRANSIENT_MESSAGE_PLACEHOLDER ? messageText : arg))),
  };
}

function buildExecution({ live, runnerResult, startedAt, endedAt, secretValues = [] }) {
  if (!live) {
    return {
      live: false, executed: false, status: "declared", exitCode: null, timedOut: false,
      processGroupClosed: null, processGroupCleanupFailed: false, processGroupVerification: null,
      startedAt, endedAt, durationMs: 0,
      stdout: summarizeOutput("", secretValues), stderr: summarizeOutput("", secretValues),
    };
  }
  const timedOut = runnerResult?.timedOut === true;
  const exitCode = Number.isInteger(runnerResult?.exitCode) ? runnerResult.exitCode : 1;
  const processGroupClosed = runnerResult?.processGroupClosed ?? null;
  const processGroupCleanupFailed = runnerResult?.processGroupCleanupFailed === true;
  const processGroupVerification = normalizeOptionalString(runnerResult?.processGroupVerification);
  const status = exitCode === 0 && !timedOut && !processGroupCleanupFailed ? "success" : "failure";
  return {
    live: true,
    executed: true,
    status,
    exitCode,
    timedOut,
    processGroupClosed,
    processGroupCleanupFailed,
    processGroupVerification,
    startedAt,
    endedAt,
    durationMs: Number.isFinite(runnerResult?.durationMs) ? Math.max(0, Math.trunc(runnerResult.durationMs)) : 0,
    stdout: summarizeOutput(String(runnerResult?.stdout ?? ""), secretValues),
    stderr: summarizeOutput(String(runnerResult?.stderr ?? ""), secretValues),
  };
}

function summarizeOutput(value, secretValues) {
  if (value.length === 0) return redactedSummary("", 0, "empty");
  const structured = summarizeStructuredRuntimeOutput(value, secretValues);
  if (structured !== null) return redactedSummary(structured, Buffer.byteLength(value), "structured-json-summary");
  const redacted = redactSecrets(value, secretValues);
  const summary = JSON.stringify({
    type: "unstructured-output-digest",
    sha256: hashHex(redacted),
    byteLength: Buffer.byteLength(value),
    redactedByteLength: Buffer.byteLength(redacted),
    lineCount: value.split(/\r?\n/u).length,
  });
  return redactedSummary(summary, Buffer.byteLength(value), "unstructured-digest-summary");
}

function summarizeStructuredRuntimeOutput(value, secretValues) {
  const parsed = parseStrictJsonObjectOutput(value);
  if (!parsed || !isRecognizableOpenClawJson(parsed)) return null;
  const meta = findOpenClawRuntimeMeta(parsed);
  const result = isRecord(parsed.result) ? parsed.result : null;
  return JSON.stringify(removeNullish({
    type: "openclaw-json-summary",
    status: normalizeOptionalString(parsed.status),
    ok: typeof parsed.ok === "boolean" ? parsed.ok : null,
    resultStatus: normalizeOptionalString(result?.status),
    payloadCount: Array.isArray(parsed.payloads) ? parsed.payloads.length : null,
    resultPayloadCount: Array.isArray(result?.payloads) ? result.payloads.length : null,
    meta: meta ? removeNullish({
      transport: safeMetaValue(meta.transport, secretValues),
      fallbackFrom: safeMetaValue(meta.fallbackFrom, secretValues),
      fallbackReasonDigest: typeof meta.fallbackReason === "string" ? hashHex(redactSecrets(meta.fallbackReason, secretValues)) : null,
    }) : null,
  }));
}

function buildRuntimeOutputEvidence(execution, boundaries) {
  return {
    boundaries,
    stdoutSummary: execution.stdout,
    stderrSummary: execution.stderr,
    stdoutPreviewStored: false,
    stderrPreviewStored: false,
    rawOutputPreviewStored: false,
    rawTranscriptStored: false,
    rawToolBodiesStored: false,
    processGroupClosed: execution.processGroupClosed,
    processGroupCleanupFailed: execution.processGroupCleanupFailed,
    processGroupVerification: execution.processGroupVerification,
    birthEligibility: "eligible-no-runtime-output-preview",
  };
}

function resolveActualRuntimeIdentity(runtimeIdentity, runnerResult) {
  if (!runnerResult) return runtimeIdentity;
  const structuredResult = resolveStructuredFallbackResult(runnerResult);
  if (structuredResult.evidence?.detected === true) {
    return { ...runtimeIdentity, transport: "embedded-fallback", fallbackFrom: "gateway", fallbackEvidence: structuredResult.evidence };
  }
  if (runtimeIdentity?.transport !== "gateway") return runtimeIdentity;
  const heuristicSource = structuredResult.stdoutJsonParsed ? String(runnerResult.stderr ?? "") : `${runnerResult.stdout ?? ""}\n${runnerResult.stderr ?? ""}`;
  if (!/\b(?:embedded[-\s]?fallback|fallback(?:ing)?\s+(?:to|into)\s+embedded|falling\s+back\s+to\s+embedded)\b/iu.test(heuristicSource)) return runtimeIdentity;
  return {
    ...runtimeIdentity,
    transport: "embedded-fallback",
    fallbackFrom: "gateway",
    fallbackEvidence: {
      detected: true,
      detectionMethod: "bounded-text-detection",
      source: structuredResult.stdoutJsonParsed ? "stderr" : "process-output",
      from: "gateway",
      to: "embedded",
      reason: "fallback marker detected",
      structured: false,
    },
  };
}

function resolveStructuredFallbackResult(runnerResult) {
  if (isRecord(runnerResult?.openClawResult)) {
    return { evidence: buildStructuredFallbackEvidence(runnerResult.openClawResult, "openclaw-result"), stdoutJsonParsed: parseJsonObjectFromOutput(runnerResult?.stdout) !== null };
  }
  const parsedStdout = parseJsonObjectFromOutput(runnerResult?.stdout);
  return { evidence: buildStructuredFallbackEvidence(parsedStdout, "stdout-json"), stdoutJsonParsed: parsedStdout !== null };
}

function buildStructuredFallbackEvidence(structuredResult, source) {
  const meta = findOpenClawRuntimeMeta(structuredResult);
  if (!meta) return null;
  const transport = normalizeOptionalString(meta.transport);
  const fallbackFrom = normalizeOptionalString(meta.fallbackFrom);
  const embedded = transport === "embedded" || transport === "embedded-fallback";
  if (fallbackFrom !== "gateway" || !embedded) return null;
  return {
    detected: true,
    detectionMethod: "openclaw-json-meta",
    source,
    from: "gateway",
    to: "embedded",
    reason: typeof meta.fallbackReason === "string" ? "structured reason redacted" : null,
    structured: true,
  };
}

function findOpenClawRuntimeMeta(value) {
  const root = isRecord(value) ? value : null;
  if (!root) return null;
  for (const candidate of [root.meta, isRecord(root.result) ? root.result.meta : null]) {
    if (isRecord(candidate) && (typeof candidate.transport === "string" || typeof candidate.fallbackFrom === "string")) return candidate;
  }
  return null;
}

function isRecognizableOpenClawJson(value) {
  if (!isRecord(value)) return false;
  const hasStatus = typeof value.status === "string" || typeof value.ok === "boolean";
  const shape = Array.isArray(value.payloads) || hasFallbackRuntimeMeta(value) || hasRecognizableOpenClawResult(value.result);
  if (hasStatus && shape) return true;
  const result = isRecord(value.result) ? value.result : null;
  return Boolean(result && (typeof result.status === "string" || typeof result.ok === "boolean") && hasRecognizableOpenClawResult(result));
}

function hasRecognizableOpenClawResult(value) {
  return isRecord(value) && (Array.isArray(value.payloads) || hasFallbackRuntimeMeta(value));
}

function hasFallbackRuntimeMeta(value) {
  const meta = findOpenClawRuntimeMeta(value);
  const transport = normalizeOptionalString(meta?.transport);
  return normalizeOptionalString(meta?.fallbackFrom) === "gateway" && ["embedded", "embedded-fallback"].includes(transport);
}

function parseStrictJsonObjectOutput(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  return parseJsonObject(value.trim());
}

function parseJsonObjectFromOutput(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  const direct = parseJsonObject(trimmed);
  if (direct) return direct;
  for (const line of trimmed.split(/\r?\n/u).reverse()) {
    const candidate = line.trim();
    if (candidate.startsWith("{") && candidate.endsWith("}")) {
      const parsed = parseJsonObject(candidate);
      if (parsed) return parsed;
    }
  }
  return null;
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function setCommandMutationFlags(command, execution, runtimeIdentity) {
  command.mutatesOpenClawState = execution.live;
  command.mutatesProductionOpenClawState = execution.live && runtimeIdentity.sandboxScope?.usesProductionState === true;
  command.mutatesIsolatedOpenClawState = execution.live && runtimeIdentity.sandboxScope?.usesProductionState !== true;
}

function messageFidelity(message, options) {
  const bytes = transientMessageBytes(options);
  if (bytes === null) return "unavailable";
  return digestBytes(bytes) === message?.sourceDigest && bytes.length === message?.byteLength ? "exact" : "reconstructed";
}

function transientMessageBytes(options) {
  if (Buffer.isBuffer(options.messageBytes)) return Buffer.from(options.messageBytes);
  if (typeof options.message === "string") return Buffer.from(options.message, "utf8");
  if (Buffer.isBuffer(options.messageFileContent)) return Buffer.from(options.messageFileContent);
  if (typeof options.messageFileContent === "string") return Buffer.from(options.messageFileContent, "utf8");
  return null;
}

function messageRecordFromBytes(bytes) {
  const summaryText = JSON.stringify({ type: "message-digest-summary", byteLength: bytes.length });
  return {
    sourceDigest: digestBytes(bytes),
    byteLength: bytes.length,
    summary: redactedSummary(summaryText, bytes.length, "unstructured-digest-summary"),
  };
}

function redactedSummary(text, originalLength, summaryKind) {
  return {
    kind: "RedactedSummary",
    summaryKind,
    sha256: hashHex(text),
    length: originalLength,
    redactedLength: text.length,
    text,
    redacted: true,
  };
}

function validRunSource(value) {
  return hasExactKeys(value, ["input", "blueprint", "runtimePlan"])
    && validArtifactProvenance(value.input, [
      ["runtime-plan", RUNTIME_PLAN_SCHEMA_VERSION],
      ["run-state", RUN_STATE_SCHEMA_VERSION],
    ])
    && validArtifactProvenance(value.blueprint, [["blueprint", "0.1"]])
    && validArtifactProvenance(value.runtimePlan, [["runtime-plan", RUNTIME_PLAN_SCHEMA_VERSION]]);
}

function validArtifactProvenance(value, bindings) {
  return hasExactKeys(value, ["identity", "subject", "digest"])
    && bindings.some(([subject, identity]) => value.subject === subject && value.identity === identity)
    && SHA256_DIGEST_PATTERN.test(value.digest);
}

function validRuntimeIdentity(value) {
  if (!plainObject(value) || !isSecretPresence(value.runtimeEnv) || !plainObject(value.selector) || !plainObject(value.sandboxScope)) return false;
  return value.runtime === "openclaw"
    && SUPPORTED_TRANSPORTS.includes(value.transport)
    && value.workspace?.kind === "TransientPathRef"
    && value.workspace?.persisted === false
    && value.sandboxScope.workspaceRoot?.kind === "TransientPathRef"
    && value.sandboxScope.workspaceRoot?.persisted === false
    && typeof value.sandboxScope.usesProductionState === "boolean"
    && validFallbackEvidence(value.fallbackEvidence);
}

function validFallbackEvidence(value) {
  return hasExactKeys(value, ["detected", "detectionMethod", "source", "from", "to", "reason", "structured"])
    && typeof value.detected === "boolean"
    && nonEmptyString(value.detectionMethod)
    && nullableString(value.source)
    && nullableString(value.from)
    && nullableString(value.to)
    && nullableString(value.reason)
    && typeof value.structured === "boolean";
}

function validDurableCommand(value) {
  if (!plainObject(value) || !Array.isArray(value.args)) return false;
  const allowed = ["backend", "cwd", "executable", "args", "display", "mutatesOpenClawState", "timeoutMs", "mutatesProductionOpenClawState", "mutatesIsolatedOpenClawState"];
  if (Object.keys(value).some((key) => !allowed.includes(key))) return false;
  return nonEmptyString(value.executable)
    && value.args.filter((arg) => arg === TRANSIENT_MESSAGE_PLACEHOLDER).length === 1
    && typeof value.display === "string"
    && typeof value.mutatesOpenClawState === "boolean"
    && typeof value.mutatesProductionOpenClawState === "boolean"
    && typeof value.mutatesIsolatedOpenClawState === "boolean"
    && Number.isSafeInteger(value.timeoutMs)
    && value.timeoutMs > 0;
}

function validMessageRecord(value) {
  return hasExactKeys(value, ["sourceDigest", "byteLength", "summary"])
    && SHA256_DIGEST_PATTERN.test(value.sourceDigest)
    && Number.isSafeInteger(value.byteLength)
    && value.byteLength >= 0
    && isRedactedSummary(value.summary)
    && value.summary.length === value.byteLength;
}

function validExecution(value) {
  const validShape = hasExactKeys(value, [
    "live", "executed", "status", "exitCode", "timedOut", "processGroupClosed", "processGroupCleanupFailed",
    "processGroupVerification", "startedAt", "endedAt", "durationMs", "stdout", "stderr",
  ])
    && typeof value.live === "boolean"
    && typeof value.executed === "boolean"
    && ["declared", "success", "failure"].includes(value.status)
    && (value.exitCode === null || Number.isInteger(value.exitCode))
    && typeof value.timedOut === "boolean"
    && (value.processGroupClosed === null || typeof value.processGroupClosed === "boolean")
    && typeof value.processGroupCleanupFailed === "boolean"
    && nullableString(value.processGroupVerification)
    && validTimestamp(value.startedAt)
    && validTimestamp(value.endedAt)
    && Number.isSafeInteger(value.durationMs)
    && value.durationMs >= 0
    && isRedactedSummary(value.stdout)
    && isRedactedSummary(value.stderr);
  if (!validShape) return false;

  if (value.status === "declared") {
    return value.live === false
      && value.executed === false
      && value.exitCode === null
      && value.timedOut === false
      && value.processGroupClosed === null
      && value.processGroupCleanupFailed === false
      && value.processGroupVerification === null;
  }
  if (value.live !== true || value.executed !== true || !Number.isInteger(value.exitCode)) return false;
  if (value.status === "success") {
    return value.exitCode === 0
      && value.timedOut === false
      && value.processGroupClosed === null
      && value.processGroupCleanupFailed === false
      && value.processGroupVerification === null;
  }
  if (value.exitCode === 0) return false;
  if (value.timedOut === false) {
    return value.processGroupClosed === null
      && value.processGroupCleanupFailed === false
      && value.processGroupVerification === null;
  }
  return typeof value.processGroupClosed === "boolean"
    && value.processGroupCleanupFailed === (value.processGroupClosed !== true);
}

function validReplay(value, runState) {
  return hasExactKeys(value, ["eligible", "policy", "resumeSession", "parentRunId", "replayFidelity"])
    && value.eligible === true
    && ["fresh-child-session", "same-session-resume"].includes(value.policy)
    && typeof value.resumeSession === "boolean"
    && value.parentRunId === runState.parentRunId
    && ["exact", "reconstructed", "unavailable"].includes(value.replayFidelity);
}

function validEvidence(value, execution) {
  return hasExactKeys(value, [
    "boundaries", "stdoutSummary", "stderrSummary", "stdoutPreviewStored", "stderrPreviewStored", "rawOutputPreviewStored",
    "rawTranscriptStored", "rawToolBodiesStored", "processGroupClosed", "processGroupCleanupFailed", "processGroupVerification", "birthEligibility",
  ])
    && plainObject(value.boundaries)
    && isRedactedSummary(value.stdoutSummary)
    && isRedactedSummary(value.stderrSummary)
    && JSON.stringify(value.stdoutSummary) === JSON.stringify(execution.stdout)
    && JSON.stringify(value.stderrSummary) === JSON.stringify(execution.stderr)
    && value.stdoutPreviewStored === false
    && value.stderrPreviewStored === false
    && value.rawOutputPreviewStored === false
    && value.rawTranscriptStored === false
    && value.rawToolBodiesStored === false
    && value.processGroupClosed === execution.processGroupClosed
    && value.processGroupCleanupFailed === execution.processGroupCleanupFailed
    && value.processGroupVerification === execution.processGroupVerification
    && value.birthEligibility === "eligible-no-runtime-output-preview";
}

function validTarget(value) {
  return hasExactKeys(value, ["id", "label", "verificationHintDigests", "unsupportedSurfaceDigests"])
    && value.id === "openclaw" && nonEmptyString(value.label)
    && digestArray(value.verificationHintDigests) && digestArray(value.unsupportedSurfaceDigests);
}

function validRunIndexEntry(value, runId) {
  return hasExactKeys(value, ["runId", "agentId", "targetId", "statePath", "stateDigest", "status", "executed", "updatedAt"])
    && value.runId === runId
    && isKebabId(value.agentId)
    && value.targetId === "openclaw"
    && value.statePath === path.posix.join("runs", runId, RUN_STATE_FILENAME)
    && SHA256_DIGEST_PATTERN.test(value.stateDigest)
    && ["declared", "success", "failure"].includes(value.status)
    && typeof value.executed === "boolean"
    && ((value.status === "declared" && value.executed === false)
      || (["success", "failure"].includes(value.status) && value.executed === true))
    && validTimestamp(value.updatedAt);
}

function assertRunStateCandidate(runState) {
  const validation = validateRunStateArtifact(runState);
  if (!validation.ok) throw runStateError("AGENTMO_RUN_STATE_INVALID");
}

function assertRunIndexCandidate(index) {
  const validation = validateRunIndexArtifact(index);
  if (!validation.ok) throw runStateError("AGENTMO_RUN_INDEX_INVALID");
}

async function readExistingRunIndex(outputRoot, indexFile, updatedAt, options) {
  let exists = false;
  try {
    const metadata = await stat(indexFile);
    if (!metadata.isFile()) throw runStateError("AGENTMO_RUN_INDEX_INVALID");
    exists = true;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (!exists) {
    if (options.runIndexDigest !== undefined) throw runStateError("AGENTMO_RUN_INDEX_NOT_FOUND");
    return { schemaVersion: RUN_INDEX_SCHEMA_VERSION, updatedAt, latestRunId: null, runs: [] };
  }
  if (typeof options.runIndexDigest !== "string") throw runStateError("AGENTMO_RUN_INDEX_DIGEST_REQUIRED");
  return loadRunIndex(outputRoot, {
    subject: "run-index",
    expectedDigest: options.runIndexDigest,
    openInput: options.openInput,
  });
}

function summarizeRunState(runState) {
  if (!runState) return null;
  return {
    runId: runState.runId ?? null,
    parentRunId: runState.parentRunId ?? null,
    agentId: runState.agentId ?? null,
    targetId: runState.target?.id ?? null,
    status: runState.execution?.status ?? null,
    executed: Boolean(runState.execution?.executed),
    exitCode: runState.execution?.exitCode ?? null,
    timedOut: runState.execution?.timedOut === true,
    processGroupClosed: runState.execution?.processGroupClosed ?? null,
    processGroupCleanupFailed: runState.execution?.processGroupCleanupFailed === true,
    transport: runState.runtimeIdentity?.transport ?? null,
    fallbackFrom: runState.runtimeIdentity?.fallbackFrom ?? null,
    fallbackEvidence: runState.runtimeIdentity?.fallbackEvidence ?? null,
    sandboxScope: runState.runtimeIdentity?.sandboxScope ?? null,
    replayEligible: Boolean(runState.replay?.eligible),
    replayFidelity: runState.replay?.replayFidelity ?? null,
    certificationClaimed: runState.certificationBoundary?.runEvidenceCertifiesRuntime === true,
  };
}

function summarizeMessage(message) {
  if (!message) return null;
  return { sourceDigest: message.sourceDigest, byteLength: message.byteLength, summary: message.summary };
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

function deriveRunEvalChecks(runState, options) {
  const sourceDigest = runState?.source?.input?.digest;
  const expectedStatus = options.expectedStatus;
  const requireExactReplay = options.requireExactReplay === true;
  const replayFidelity = options.replayFidelity;
  const outcomes = {
    schema: validateRunStateArtifact(runState).ok,
    execution: validExecution(runState?.execution),
    source_runtime_plan_digest: SHA256_DIGEST_PATTERN.test(sourceDigest ?? ""),
    message_provenance: validMessageRecord(runState?.message),
    replayability: Boolean(runState?.replay?.eligible && runState?.message?.sourceDigest),
    replay_fidelity: ["exact", "reconstructed", "unavailable"].includes(replayFidelity),
    identity_fields: validRuntimeIdentity(runState?.runtimeIdentity),
    runtime_env_ready: runtimeEnvReadyForEvidence(runState),
    transport: SUPPORTED_TRANSPORTS.includes(runState?.runtimeIdentity?.transport),
    fallback_evidence: runState?.runtimeIdentity?.transport !== "embedded-fallback"
      || runState?.runtimeIdentity?.fallbackEvidence?.detected === true,
    sandbox: Boolean(runState?.runtimeIdentity?.sandboxScope),
    sandbox_non_production: runState?.runtimeIdentity?.sandboxScope?.usesProductionState !== true,
    certification_boundary: runState?.certificationBoundary?.runEvidenceCertifiesRuntime === false,
    process_group_closed: timedOutProcessGroupClosed(runState),
    output_summary_consistent: hasConsistentOutputEvidence(runState),
    output_body_absent: hasRawOutputPreviewEvidence(runState) === false,
    expected_status: expectedStatus === null || runState?.execution?.status === expectedStatus,
    require_exact_replay: requireExactReplay === false || replayFidelity === "exact",
  };
  return RUN_EVAL_CHECK_IDS.map((id) => check(id, outcomes[id], RUN_EVAL_CHECK_MESSAGES[id]));
}

function validCanonicalRunEvalChecks(report) {
  if (!Array.isArray(report?.checks) || report.checks.length !== RUN_EVAL_CHECK_IDS.length) return false;
  const seen = new Set();
  for (let index = 0; index < RUN_EVAL_CHECK_IDS.length; index += 1) {
    const item = report.checks[index];
    const id = RUN_EVAL_CHECK_IDS[index];
    if (!hasExactKeys(item, ["id", "pass", "message"])
      || item.id !== id
      || seen.has(item.id)
      || typeof item.pass !== "boolean"
      || item.message !== RUN_EVAL_CHECK_MESSAGES[id]) return false;
    seen.add(item.id);
  }
  const expectedStatusPass = report.expectedStatus === null || report.actualStatus === report.expectedStatus;
  const expectedStatusCheck = report.checks.at(-2);
  const exactReplayCheck = report.checks.at(-1);
  if (expectedStatusCheck.pass !== expectedStatusPass
    || exactReplayCheck.pass !== (report.requireExactReplay === false || report.replayFidelity === "exact")) return false;
  return report.ok === report.checks.every((item) => item.pass);
}

function runEvalMatchesSource(report, runState, source) {
  if (source !== undefined && !sameProvenance(report.source, source)) return false;
  if (report.runId !== runState?.runId || report.actualStatus !== runState?.execution?.status) return false;
  const expectedChecks = deriveRunEvalChecks(runState, {
    expectedStatus: report.expectedStatus,
    requireExactReplay: report.requireExactReplay,
    replayFidelity: report.replayFidelity,
  });
  return JSON.stringify(report.checks) === JSON.stringify(expectedChecks);
}

function sameProvenance(left, right) {
  return left?.identity === right?.identity
    && left?.subject === right?.subject
    && left?.digest === right?.digest;
}

function hasRawOutputPreviewEvidence(runState) {
  return !isRedactedSummary(runState?.execution?.stdout)
    || !isRedactedSummary(runState?.execution?.stderr)
    || !isRedactedSummary(runState?.evidence?.stdoutSummary)
    || !isRedactedSummary(runState?.evidence?.stderrSummary)
    || runState?.evidence?.stdoutPreviewStored !== false
    || runState?.evidence?.stderrPreviewStored !== false
    || runState?.evidence?.rawOutputPreviewStored !== false
    || runState?.evidence?.rawTranscriptStored !== false
    || runState?.evidence?.rawToolBodiesStored !== false;
}

function hasConsistentOutputEvidence(runState) {
  return validEvidence(runState?.evidence, runState?.execution);
}

function safeMetaValue(value, secretValues) {
  const normalized = normalizeOptionalString(value);
  return normalized === null ? null : redactSecrets(normalized, secretValues);
}

function decodeMessageBytes(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw runStateError("AGENTMO_RUNTIME_MESSAGE_INVALID_UTF8");
  }
}

function requiredPath(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing required ${label} path.`);
  return path.resolve(value);
}

function check(id, pass, message) {
  return { id, pass, message };
}

function displayCommand(executable, args) {
  return [executable, ...args].map(shellQuote).join(" ");
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:=@+<>-]+$/u.test(value)) return value;
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function generateRunId(now) {
  const timestamp = isoTimestamp(now).replace(/[-:.]/gu, "");
  return `${timestamp}-${randomUUID().slice(0, 8)}`;
}

function isoTimestamp(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.trim().length > 0) return new Date(value).toISOString();
  return new Date().toISOString();
}

function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function hashHex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function removeNullish(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined));
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))).sort();
}

function sanitizeSelectorPart(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]+/gu, "-").replace(/^-+|-+$/gu, "") || "run";
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
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value) {
  return value === null || typeof value === "string";
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function stringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function digestArray(value) {
  return stringArray(value) && value.every((item) => SHA256_DIGEST_PATTERN.test(item));
}

function safeId(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(value);
}

function isKebabId(value) {
  return typeof value === "string" && /^[a-z][a-z0-9-]*$/u.test(value);
}

function validTimestamp(value) {
  return nonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function runStateError(code) {
  const error = new Error("Runtime artifact operation failed.");
  error.code = code;
  return error;
}
