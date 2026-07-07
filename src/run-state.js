import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildRuntimePlan, materializeRuntimePlanForRun, SUPPORTED_TRANSPORTS } from "./runtime-plan.js";
import { assertRuntimeEnvReady, resolveRuntimeEnv } from "./runtime-env.js";
import { runRuntimeCommand } from "./runtime-execution.js";
import { redactSecrets } from "./secret-redaction.js";

export const RUN_STATE_SCHEMA_VERSION = "agentmo.run.v1";
export const RUN_INDEX_SCHEMA_VERSION = "agentmo.run-index.v1";
export const RUN_STATE_FILENAME = "agentmo-run-state.json";
export const RUN_INDEX_FILENAME = "agentmo-run-index.json";
export const OUTPUT_TEXT_LIMIT = 4000;
export const RUN_REPORT_SCHEMA_VERSION = "agentmo.run-report.v1";
export const RUN_EVAL_SCHEMA_VERSION = "agentmo.run-eval.v1";

export async function executeRuntimeRun(blueprint, options = {}, commandRunner = null) {
  const runId = options.runId ?? generateRunId(options.now);
  const startedAt = isoTimestamp(options.now);
  const runtimePlan = materializeRuntimePlanForRun(buildRuntimePlan(blueprint, options), runId);
  const runtimeEnv = resolveRuntimeEnv(options);
  assertRuntimeEnvReady(runtimePlan.runtimeIdentity.runtimeEnv, {
    live: Boolean(options.live),
    provider: runtimePlan.runtimeIdentity.provider,
    transport: runtimePlan.runtimeIdentity.transport,
  });
  if (options.live && !runtimePlan.runtimeIdentity.sandboxScope.stateDir && runtimePlan.runtimeIdentity.sandboxScope.usesProductionState !== true) {
    throw new Error("Live OpenClaw runs require --openclaw-state-dir <dir> or explicit --use-production-openclaw-state.");
  }
  await materializeManagedMessageFile(runtimePlan, options);
  const live = Boolean(options.live);
  const runner = commandRunner ?? runRuntimeCommand;
  const runnerOptions = { ...options, runtimeEnvValues: runtimeEnv.values };
  const runnerResult = live ? await runner(runtimePlan.command, runtimePlan.runtimeIdentity, runnerOptions) : null;
  runtimePlan.runtimeIdentity = resolveActualRuntimeIdentity(runtimePlan.runtimeIdentity, runnerResult);
  const endedAt = isoTimestamp(options.endedAt ?? options.now);
  const execution = buildExecution({ live, runnerResult, startedAt, endedAt, secretValues: runtimeEnv.secretValues });
  const runState = buildRunState({ blueprint, options, runtimePlan, runId, startedAt, endedAt, execution });

  if (options.out) {
    const paths = await writeRunState(options.out, runState);
    return { runState, stateFile: paths.stateFile, indexFile: paths.indexFile };
  }
  return { runState, stateFile: null, indexFile: null };
}

export async function writeRunState(outDir, runState) {
  const outputRoot = path.resolve(outDir);
  const runDir = path.join(outputRoot, "runs", runState.runId);
  await mkdir(runDir, { recursive: true });
  const stateFile = path.join(runDir, RUN_STATE_FILENAME);
  await writeJsonAtomic(stateFile, runState);
  const indexFile = await updateRunIndex(outputRoot, runState, path.relative(outputRoot, stateFile));
  return { stateFile, indexFile };
}

export async function loadRunState(filePath) {
  const raw = await readFile(filePath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid run-state JSON ${filePath}: ${message}`);
  }
  if (parsed?.schemaVersion !== RUN_STATE_SCHEMA_VERSION) {
    throw new Error(`Unsupported run-state schema: ${parsed?.schemaVersion ?? "missing"}`);
  }
  return parsed;
}

export async function loadRunIndex(runDir) {
  const indexFile = path.join(path.resolve(runDir), RUN_INDEX_FILENAME);
  const raw = await readFile(indexFile, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid run index JSON ${indexFile}: ${message}`);
  }
  if (parsed?.schemaVersion !== RUN_INDEX_SCHEMA_VERSION) {
    throw new Error(`Unsupported run index schema: ${parsed?.schemaVersion ?? "missing"}`);
  }
  return parsed;
}

export async function resolveLatestRunStateFromDir(runDir) {
  const index = await loadRunIndex(runDir);
  if (!index.latestRunId || !index.runs?.[index.latestRunId]?.statePath) {
    throw new Error(`Run index ${path.join(path.resolve(runDir), RUN_INDEX_FILENAME)} does not contain a latest run-state pointer.`);
  }
  const statePath = path.join(path.resolve(runDir), index.runs[index.latestRunId].statePath);
  return { runState: await loadRunState(statePath), runStatePath: statePath, runIndex: index };
}

export function buildRunReport(runState) {
  return {
    schemaVersion: RUN_REPORT_SCHEMA_VERSION,
    ok: runState?.schemaVersion === RUN_STATE_SCHEMA_VERSION,
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
  const replayFidelityValue = options.replayFidelity ?? replayFidelityFromStoredEvidence(runState);
  return buildRunEvalReport(runState, { ...options, expectedStatus, replayFidelityValue });
}

export async function buildRunEvalVerified(runState, options = {}) {
  return buildRunEval(runState, { ...options, replayFidelity: await replayFidelity(runState) });
}

function buildRunEvalReport(runState, options) {
  const expectedStatus = options.expectedStatus;
  const transport = runState?.runtimeIdentity?.transport;
  const sandboxScope = runState?.runtimeIdentity?.sandboxScope;
  const blueprintHash = runState?.source?.blueprintHash;
  const replayFidelityValue = options.replayFidelityValue;
  const rawOutputPreviewStored = hasRawOutputPreviewEvidence(runState);
  const checks = [
    check("schema", runState?.schemaVersion === RUN_STATE_SCHEMA_VERSION, "run-state schema is supported"),
    check("execution", Boolean(runState?.execution?.status), "execution status is present"),
    check("source_blueprint_hash", typeof blueprintHash === "string" && blueprintHash.length > 0, "source blueprint hash is present"),
    check("message_provenance", hasMessageProvenance(runState?.message), "message provenance is bounded and replayable"),
    check("replayability", Boolean(runState?.replay?.eligible && runState?.message?.messageHash), "run has replay metadata and message provenance"),
    check("replay_fidelity", replayFidelityValue === "exact" || replayFidelityValue === "reconstructed", "replay fidelity is exact or reconstructed"),
    check("identity_fields", hasRuntimeIdentityFields(runState?.runtimeIdentity), "runtime identity fields are present as separate fields"),
    check("runtime_env_ready", runtimeEnvReadyForEvidence(runState), "live provider runtime env descriptor satisfies required keys"),
    check("transport", isKnownTransport(transport), "transport field is present and explicit"),
    check(
      "fallback_evidence",
      transport !== "embedded-fallback" || runState?.runtimeIdentity?.fallbackEvidence?.detected === true,
      "embedded fallback is backed by structured or compatibility fallback evidence",
    ),
    check("sandbox", Boolean(sandboxScope), "sandbox scope is present"),
    check("sandbox_non_production", sandboxScope?.usesProductionState !== true, "sandbox scope does not use production OpenClaw state"),
    check("certification_boundary", runState?.certificationBoundary?.runEvidenceCertifiesRuntime === false, "run evidence does not certify runtime/domain behavior"),
    check("process_group_closed", timedOutProcessGroupClosed(runState), "timed-out live runs prove process-group cleanup or fail closed"),
    check("raw_output_flags_consistent", hasConsistentRawOutputEvidence(runState), "raw stdout/stderr preview flags match stored evidence"),
    check("raw_output_preview_absent", rawOutputPreviewStored === false, "birth-eligible run evidence does not store raw stdout/stderr previews"),
  ];
  if (options.expectedBlueprintHash) {
    checks.push(check("blueprint_hash_freshness", blueprintHash === options.expectedBlueprintHash, "run-state blueprint hash matches expected blueprint hash"));
  }
  if (expectedStatus) {
    checks.push(check("expected_status", runState?.execution?.status === expectedStatus, `execution status matches ${expectedStatus}`));
  }
  if (options.requireExactReplay) {
    checks.push(check("require_exact_replay", replayFidelityValue === "exact", "replay fidelity is exact when required"));
  }
  const ok = checks.every((item) => item.pass);
  return {
    schemaVersion: RUN_EVAL_SCHEMA_VERSION,
    ok,
    runId: runState?.runId ?? null,
    expectedStatus,
    actualStatus: runState?.execution?.status ?? null,
    replayFidelity: replayFidelityValue,
    checks,
    certificationBoundary: {
      runtimeCertifiedByRun: false,
      domainCertifiedByRun: false,
    },
  };
}

export async function replayRunState(parentRunState, options = {}, commandRunner = null) {
  const runId = options.runId ?? generateRunId(options.now);
  const startedAt = isoTimestamp(options.now);
  const endedAt = isoTimestamp(options.endedAt ?? options.now);
  const live = Boolean(options.live);
  const runState = materializeReplayRunState(parentRunState, { ...options, runId, startedAt, endedAt });
  if (live && !runState.runtimeIdentity.sandboxScope.stateDir && runState.runtimeIdentity.sandboxScope.usesProductionState !== true) {
    throw new Error("Live OpenClaw replay requires --openclaw-state-dir metadata in the parent run-state or explicit production-state evidence.");
  }
  const runtimeEnv = resolveRuntimeEnv(options);
  if (runtimeEnv.descriptor) {
    runState.runtimeIdentity.runtimeEnv = runtimeEnv.descriptor;
    runState.runtimeIdentity.sandboxScope.environmentAllowlist = uniqueStrings([
      ...(runState.runtimeIdentity.sandboxScope.environmentAllowlist ?? []),
      ...runtimeEnv.descriptor.presentKeys,
    ]);
  }
  assertRuntimeEnvReady(live ? runtimeEnv.descriptor : runState.runtimeIdentity.runtimeEnv, {
    live,
    provider: runState.runtimeIdentity.provider,
    transport: runState.runtimeIdentity.transport,
  });
  const runner = commandRunner ?? runRuntimeCommand;
  runState.replay.replayFidelity = await replayFidelity(parentRunState);
  const runnerOptions = { ...options, runtimeEnvValues: runtimeEnv.values };
  const runnerResult = live ? await runner(runState.command, runState.runtimeIdentity, runnerOptions) : null;
  runState.runtimeIdentity = resolveActualRuntimeIdentity(runState.runtimeIdentity, runnerResult);
  runState.execution = live
    ? buildExecution({ live: true, runnerResult, startedAt, endedAt, secretValues: runtimeEnv.secretValues })
    : buildExecution({ live: false, runnerResult: null, startedAt, endedAt });
  runState.evidence = buildRuntimeOutputEvidence(runState.execution, runState.runtimeIdentity.evidenceBoundaries);
  setCommandMutationFlags(runState.command, runState.execution, runState.runtimeIdentity);
  runState.updatedAt = endedAt;
  if (options.out) {
    const paths = await writeRunState(options.out, runState);
    return { runState, stateFile: paths.stateFile, indexFile: paths.indexFile };
  }
  return { runState, stateFile: null, indexFile: null };
}

async function updateRunIndex(outputRoot, runState, stateRelativePath) {
  const indexFile = path.join(outputRoot, RUN_INDEX_FILENAME);
  let index = {
    schemaVersion: RUN_INDEX_SCHEMA_VERSION,
    updatedAt: runState.updatedAt,
    latestRunId: null,
    runs: {},
  };
  try {
    index = await loadRunIndex(outputRoot);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      index = {
        schemaVersion: RUN_INDEX_SCHEMA_VERSION,
        updatedAt: runState.updatedAt,
        latestRunId: null,
        runs: {},
      };
    } else {
      throw error;
    }
  }

  index.updatedAt = runState.updatedAt;
  index.latestRunId = runState.runId;
  index.runs[runState.runId] = {
    runId: runState.runId,
    agentId: runState.agentId,
    targetId: runState.target.id,
    statePath: stateRelativePath,
    status: runState.execution.status,
    executed: runState.execution.executed,
    updatedAt: runState.updatedAt,
  };
  await writeJsonAtomic(indexFile, index);
  return indexFile;
}

async function materializeManagedMessageFile(runtimePlan, options) {
  const messageFile = runtimePlan.message?.messageFile;
  if (!messageFile?.planned) return;
  if (runtimePlan.message.secretLikeContent === true) {
    runtimePlan.message.replayFidelityIfMaterialAvailable = "reconstructed";
    if (options.out || options.live) {
      throw new Error(
        "Refusing to persist secret-like inline message content under AgentMo run output. Pass --message-file <path> so AgentMo records path/digest metadata without copying the content.",
      );
    }
    return;
  }
  if (!options.out) {
    runtimePlan.message.replayFidelityIfMaterialAvailable = "reconstructed";
    return;
  }
  if (typeof options.message !== "string") {
    runtimePlan.message.replayFidelityIfMaterialAvailable = "reconstructed";
    return;
  }
  const outputRoot = path.resolve(options.out);
  const artifactPath = path.join(outputRoot, messageFile.path);
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, options.message, "utf8");
  const digest = hashString(options.message);
  messageFile.path = artifactPath;
  messageFile.digest = digest;
  messageFile.planned = false;
  messageFile.digestVerified = digest === runtimePlan.message.messageHash;
  runtimePlan.command.args = runtimePlan.command.args.map((arg) => (arg === `messages/${digest.slice(0, 16)}.txt` ? artifactPath : arg));
  runtimePlan.command.display = [runtimePlan.command.executable, ...runtimePlan.command.args].map(shellQuote).join(" ");
}

function buildRunState({ blueprint, options, runtimePlan, runId, startedAt, endedAt, execution }) {
  const command = {
    ...runtimePlan.command,
  };
  const evidence = buildRuntimeOutputEvidence(execution, runtimePlan.runtimeIdentity.evidenceBoundaries);
  setCommandMutationFlags(command, execution, runtimePlan.runtimeIdentity);
  return {
    schemaVersion: RUN_STATE_SCHEMA_VERSION,
    runId,
    parentRunId: options.parentRunId ?? null,
    agentId: blueprint.agent_id,
    target: runtimePlan.target,
    workspace: runtimePlan.runtimeIdentity.workspace,
    createdAt: startedAt,
    updatedAt: endedAt,
    source: {
      blueprintPath: options.file ?? options.blueprintPath ?? null,
      blueprintHash: hashString(JSON.stringify(blueprint)),
      scaffoldBuildStateHash: options.scaffoldBuildStateHash ?? null,
    },
    runtimeIdentity: runtimePlan.runtimeIdentity,
    command,
    message: runtimePlan.message,
    execution,
    replay: {
      eligible: true,
      policy: "fresh-child-session",
      resumeSession: false,
      parentRunId: options.parentRunId ?? null,
      replayFidelity: replayFidelityFromMessage(runtimePlan.message),
    },
    evidence,
    certificationBoundary: runtimePlan.certificationBoundary,
  };
}

function buildRuntimeOutputEvidence(execution, boundaries) {
  const stdoutPreviewStored = outputStoresRawPreview(execution?.stdout);
  const stderrPreviewStored = outputStoresRawPreview(execution?.stderr);
  const rawOutputPreviewStored = stdoutPreviewStored || stderrPreviewStored;
  return {
    boundaries,
    stdoutSummary: execution?.stdout?.preview ?? "",
    stderrSummary: execution?.stderr?.preview ?? "",
    stdoutSummaryKind: execution?.stdout?.summaryKind ?? "empty",
    stderrSummaryKind: execution?.stderr?.summaryKind ?? "empty",
    stdoutPreviewStored,
    stderrPreviewStored,
    rawOutputPreviewStored,
    rawTranscriptStored: rawOutputPreviewStored,
    rawToolBodiesStored: rawOutputPreviewStored,
    processGroupClosed: execution?.processGroupClosed ?? null,
    processGroupCleanupFailed: execution?.processGroupCleanupFailed === true,
    processGroupVerification: execution?.processGroupVerification ?? null,
    birthEligibility:
      rawOutputPreviewStored === false
        ? "eligible-empty-runtime-output-preview"
        : "blocked-raw-runtime-output-preview-stored",
  };
}

function materializeReplayRunState(parentRunState, options) {
  if (parentRunState?.schemaVersion !== RUN_STATE_SCHEMA_VERSION) {
    throw new Error(`Cannot replay unsupported run-state schema: ${parentRunState?.schemaVersion ?? "missing"}`);
  }
  assertReplayableRunState(parentRunState);
  const runState = JSON.parse(JSON.stringify(parentRunState));
  const parentSessionKey = runState.runtimeIdentity?.selector?.executionSelector?.sessionKey ?? null;
  const sessionKey = options.resumeSession ? parentSessionKey : `agentmo-${sanitizeSelectorPart(runState.agentId)}-${sanitizeSelectorPart(options.runId)}`;
  runState.runId = options.runId;
  runState.parentRunId = parentRunState.runId;
  runState.createdAt = options.startedAt;
  runState.updatedAt = options.endedAt;
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
    runState.command.display = [runState.command.executable, ...runState.command.args].map(shellQuote).join(" ");
  }
  runState.replay = {
    eligible: true,
    policy: options.resumeSession ? "same-session-resume" : "fresh-child-session",
    resumeSession: Boolean(options.resumeSession),
    parentRunId: parentRunState.runId,
    replayFidelity: "unknown",
  };
  runState.command.mutatesOpenClawState = false;
  runState.command.mutatesProductionOpenClawState = false;
  runState.command.mutatesIsolatedOpenClawState = false;
  return runState;
}

function setCommandMutationFlags(command, execution, runtimeIdentity) {
  command.mutatesOpenClawState = execution.live;
  command.mutatesProductionOpenClawState = execution.live && runtimeIdentity.sandboxScope?.usesProductionState === true;
  command.mutatesIsolatedOpenClawState = execution.live && runtimeIdentity.sandboxScope?.usesProductionState !== true;
}

function assertReplayableRunState(runState) {
  if (typeof runState.agentId !== "string" || runState.agentId.trim().length === 0) {
    throw new Error("Cannot replay run-state without agentId.");
  }
  if (!runState.command || typeof runState.command.executable !== "string" || !Array.isArray(runState.command.args)) {
    throw new Error("Cannot replay run-state without a command descriptor.");
  }
  if (!runState.runtimeIdentity?.selector?.executionSelector) {
    throw new Error("Cannot replay run-state without a runtime execution selector.");
  }
  if (!runState.runtimeIdentity?.sandboxScope) {
    throw new Error("Cannot replay run-state without sandbox scope evidence.");
  }
  if (!runState.message || typeof runState.message.messageHash !== "string" || typeof runState.message.messageMode !== "string") {
    throw new Error("Cannot replay run-state without message provenance.");
  }
}

function rebuildCommandArgsForReplay(runState) {
  const args = runState.command.executable === "pnpm" ? ["openclaw", "agent"] : ["agent"];
  const executionSelector = runState.runtimeIdentity.selector.executionSelector;
  if (runState.runtimeIdentity.transport === "local" || runState.runtimeIdentity.transport === "embedded-fallback") args.push("--local");
  args.push("--json");
  if (runState.runtimeIdentity.model) args.push("--model", runState.runtimeIdentity.model);
  if (runState.runtimeIdentity.thinking) args.push("--thinking", runState.runtimeIdentity.thinking);
  if (executionSelector.agent) args.push("--agent", executionSelector.agent);
  if (executionSelector.sessionKey) args.push("--session-key", executionSelector.sessionKey);
  if (executionSelector.sessionId) args.push("--session-id", executionSelector.sessionId);
  if (executionSelector.to) args.push("--to", executionSelector.to);
  if (runState.message.messageMode === "inline") args.push("--message", runState.message.inlineMessage);
  else args.push("--message-file", runState.message.messageFile.path);
  return args;
}

function summarizeRunState(runState) {
  if (!runState) return null;
  return {
    runId: runState.runId ?? null,
    parentRunId: runState.parentRunId ?? null,
    agentId: runState.agentId ?? null,
    targetId: runState.target?.id ?? null,
    workspace: runState.workspace ?? null,
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
    replayFidelity: runState.replay?.replayFidelity ?? runState.message?.replayFidelityIfMaterialAvailable ?? null,
    certificationClaimed: runState.certificationBoundary?.runEvidenceCertifiesRuntime === true,
  };
}

function summarizeMessage(message) {
  if (!message) return null;
  return {
    messageMode: message.messageMode ?? null,
    messageHash: message.messageHash ?? null,
    messageLength: message.messageLength ?? null,
    messagePreview: message.messagePreview ?? null,
    hasInlineMessage: typeof message.inlineMessage === "string",
    messageFile: message.messageFile ?? null,
  };
}

function check(id, pass, message) {
  return { id, pass, message };
}

function hasRuntimeIdentityFields(identity) {
  if (!identity || typeof identity !== "object") return false;
  return [
    "provider",
    "model",
    "thinking",
    "runtime",
    "channel",
    "selector",
    "workspace",
    "backend",
    "transport",
    "fallbackFrom",
    "fallbackEvidence",
    "sandboxScope",
    "runtimeEnv",
    "evidenceBoundaries",
  ].every((field) => field in identity);
}

function hasMessageProvenance(message) {
  if (!message || typeof message !== "object") return false;
  const knownMode = message.messageMode === "inline" || message.messageMode === "file";
  const hasHash = typeof message.messageHash === "string" && message.messageHash.length > 0;
  const hasLength = Number.isInteger(message.messageLength) && message.messageLength >= 0;
  if (!knownMode || !hasHash || !hasLength) return false;
  if (message.messageMode === "inline") return typeof message.inlineMessage === "string";
  if (typeof message.messageFile?.path !== "string" || typeof message.messageFile?.digest !== "string") return false;
  if (message.messageFile.digestVerified !== true) return false;
  try {
    const content = readFileSync(message.messageFile.path, "utf8");
    const digest = hashString(content);
    return digest === message.messageFile.digest && digest === message.messageHash;
  } catch (_error) {
    return false;
  }
}

function hasRawOutputPreviewEvidence(runState) {
  const evidence = runState?.evidence;
  if (!evidence || typeof evidence !== "object") return true;
  return (
    evidence.rawOutputPreviewStored === true ||
    streamStoresRawPreviewEvidence(evidence, "stdout") ||
    streamStoresRawPreviewEvidence(evidence, "stderr") ||
    streamStoresRawPreviewOutput(runState?.execution?.stdout) ||
    streamStoresRawPreviewOutput(runState?.execution?.stderr)
  );
}

function hasConsistentRawOutputEvidence(runState) {
  const evidence = runState?.evidence;
  if (!evidence || typeof evidence !== "object") return false;
  const stdoutPreviewStored = streamStoresRawPreviewOutput(runState?.execution?.stdout);
  const stderrPreviewStored = streamStoresRawPreviewOutput(runState?.execution?.stderr);
  const rawOutputPreviewStored = stdoutPreviewStored || stderrPreviewStored;
  return (
    streamStoresRawPreviewEvidence(evidence, "stdout") === stdoutPreviewStored &&
    streamStoresRawPreviewEvidence(evidence, "stderr") === stderrPreviewStored &&
    evidence.stdoutPreviewStored === stdoutPreviewStored &&
    evidence.stderrPreviewStored === stderrPreviewStored &&
    evidence.rawOutputPreviewStored === rawOutputPreviewStored &&
    evidence.rawTranscriptStored === rawOutputPreviewStored &&
    evidence.rawToolBodiesStored === rawOutputPreviewStored
  );
}

function hasStoredPreview(value) {
  return typeof value === "string" && value.length > 0;
}

function outputStoresRawPreview(output) {
  return output?.summaryKind === "raw-output-preview" && hasStoredPreview(output.preview);
}

function streamStoresRawPreviewOutput(output) {
  if (!output || typeof output !== "object") return true;
  if (output.summaryKind === "empty" || output.summaryKind === "structured-json-summary") return false;
  if (output.summaryKind === "raw-output-preview" || output.rawPreviewStored === true) return hasStoredPreview(output.preview);
  return hasStoredPreview(output.preview);
}

function streamStoresRawPreviewEvidence(evidence, streamName) {
  if (!evidence || typeof evidence !== "object") return true;
  const flagName = `${streamName}PreviewStored`;
  const summaryName = `${streamName}Summary`;
  const summaryKindName = `${streamName}SummaryKind`;
  const summaryKind = evidence[summaryKindName];
  const summaryStored = hasStoredPreview(evidence[summaryName]);
  if (evidence[flagName] === true) return true;
  if (summaryKind === "raw-output-preview") return summaryStored;
  if (summaryKind === "empty" || summaryKind === "structured-json-summary") return false;
  if (summaryStored) return true;
  return false;
}

function runtimeEnvReadyForEvidence(runState) {
  try {
    assertRuntimeEnvReady(runState?.runtimeIdentity?.runtimeEnv, {
      live: runState?.execution?.live === true,
      provider: runState?.runtimeIdentity?.provider,
      transport: runState?.runtimeIdentity?.transport,
    });
    return true;
  } catch (_error) {
    return false;
  }
}

function timedOutProcessGroupClosed(runState) {
  if (runState?.execution?.timedOut !== true) return true;
  const verification = runState.execution.processGroupVerification;
  return (
    runState.execution.processGroupClosed === true &&
    runState.execution.processGroupCleanupFailed !== true &&
    isPositiveProcessGroupVerification(verification) &&
    runState.evidence?.processGroupClosed === true &&
    runState.evidence?.processGroupCleanupFailed !== true &&
    runState.evidence?.processGroupVerification === verification
  );
}

function isPositiveProcessGroupVerification(verification) {
  return verification === "closed-after-sigterm-grace" || verification === "closed-after-sigkill-grace";
}

function isKnownTransport(transport) {
  return SUPPORTED_TRANSPORTS.includes(transport);
}

async function replayFidelity(runState) {
  if (typeof runState?.message?.inlineMessage === "string") return "exact";
  if (runState?.message?.messageFile?.digest && runState?.message?.messageFile?.path) {
    try {
      const content = await readFile(runState.message.messageFile.path, "utf8");
      return hashString(content) === runState.message.messageFile.digest ? "exact" : "reconstructed";
    } catch (_error) {
      return "reconstructed";
    }
  }
  return "reconstructed";
}

function replayFidelityFromMessage(message) {
  if (typeof message?.inlineMessage === "string") return "exact";
  if (message?.messageFile?.digestVerified === true) return "exact";
  return "reconstructed";
}

function replayFidelityFromStoredEvidence(runState) {
  if (!runState) return "unknown";
  if (typeof runState.message?.inlineMessage === "string") return "exact";
  if (hasMessageProvenance(runState.message)) return "exact";
  if (runState.replay?.eligible) return "reconstructed";
  return "unknown";
}

function buildExecution({ live, runnerResult, startedAt, endedAt, secretValues = [] }) {
  if (!live) {
    return {
      live: false,
      executed: false,
      status: "declared",
      exitCode: null,
      timedOut: false,
      processGroupClosed: null,
      processGroupCleanupFailed: false,
      processGroupVerification: null,
      startedAt,
      endedAt,
      durationMs: 0,
      stdout: summarizeOutput("", secretValues),
      stderr: summarizeOutput("", secretValues),
    };
  }

  const exitCode = Number.isInteger(runnerResult?.exitCode) ? runnerResult.exitCode : 1;
  return {
    live: true,
    executed: true,
    status: exitCode === 0 ? "success" : "failure",
    exitCode,
    timedOut: Boolean(runnerResult?.timedOut),
    processGroupClosed: runnerResult?.processGroupClosed ?? null,
    processGroupCleanupFailed: runnerResult?.processGroupCleanupFailed === true,
    processGroupVerification: runnerResult?.processGroupVerification ?? null,
    startedAt,
    endedAt,
    durationMs: Number.isFinite(runnerResult?.durationMs) ? runnerResult.durationMs : 0,
    stdout: summarizeOutput(runnerResult?.stdout ?? "", secretValues),
    stderr: summarizeOutput(runnerResult?.stderr ?? "", secretValues),
  };
}

function summarizeOutput(value, secretValues) {
  if (value.length === 0) {
    return {
      preview: "",
      summaryKind: "empty",
      length: 0,
      redactedLength: 0,
      truncated: false,
      rawPreviewStored: false,
    };
  }
  const structuredSummary = summarizeStructuredRuntimeOutput(value, secretValues);
  if (structuredSummary) {
    return {
      preview: structuredSummary,
      summaryKind: "structured-json-summary",
      length: value.length,
      redactedLength: structuredSummary.length,
      truncated: false,
      rawPreviewStored: false,
    };
  }
  const redacted = redactSecrets(value, secretValues);
  const truncated = redacted.length > OUTPUT_TEXT_LIMIT;
  return {
    preview: truncated ? `${redacted.slice(0, OUTPUT_TEXT_LIMIT - 1)}…` : redacted,
    summaryKind: "raw-output-preview",
    length: value.length,
    redactedLength: redacted.length,
    truncated,
    rawPreviewStored: true,
  };
}

function summarizeStructuredRuntimeOutput(value, secretValues) {
  const parsed = parseStrictJsonObjectOutput(value);
  if (!parsed || !isRecognizableOpenClawJson(parsed)) return null;
  const meta = findOpenClawRuntimeMeta(parsed);
  const result = isRecord(parsed.result) ? parsed.result : null;
  const summary = removeNullish({
    type: "openclaw-json-summary",
    status: normalizeOptionalString(parsed.status),
    ok: typeof parsed.ok === "boolean" ? parsed.ok : null,
    resultStatus: normalizeOptionalString(result?.status),
    payloadCount: Array.isArray(parsed.payloads) ? parsed.payloads.length : null,
    resultPayloadCount: Array.isArray(result?.payloads) ? result.payloads.length : null,
    meta: meta
      ? removeNullish({
          transport: redactSecrets(normalizeOptionalString(meta.transport) ?? "", secretValues) || null,
          fallbackFrom: redactSecrets(normalizeOptionalString(meta.fallbackFrom) ?? "", secretValues) || null,
          fallbackReason: redactSecrets(normalizeOptionalString(meta.fallbackReason) ?? "", secretValues) || null,
        })
      : null,
  });
  return JSON.stringify(summary);
}

function resolveActualRuntimeIdentity(runtimeIdentity, runnerResult) {
  if (!runnerResult) return runtimeIdentity;
  const structuredResult = resolveStructuredFallbackResult(runnerResult);
  const structuredEvidence = structuredResult.evidence;
  if (structuredEvidence?.detected === true) {
    return {
      ...runtimeIdentity,
      transport: "embedded-fallback",
      fallbackFrom: "gateway",
      fallbackEvidence: structuredEvidence,
    };
  }
  if (structuredEvidence) {
    return {
      ...runtimeIdentity,
      transport: normalizeStructuredTransport(structuredEvidence.to) ?? runtimeIdentity.transport,
      fallbackFrom: structuredEvidence.from ?? runtimeIdentity.fallbackFrom,
      fallbackEvidence: structuredEvidence,
    };
  }

  if (runtimeIdentity?.transport !== "gateway") return runtimeIdentity;
  const heuristicSource = structuredResult.stdoutJsonParsed ? (runnerResult.stderr ?? "") : `${runnerResult.stdout ?? ""}\n${runnerResult.stderr ?? ""}`;
  if (!/\b(?:embedded[-\s]?fallback|fallback(?:ing)?\s+(?:to|into)\s+embedded|falling\s+back\s+to\s+embedded)\b/iu.test(heuristicSource)) {
    return runtimeIdentity;
  }
  return {
    ...runtimeIdentity,
    transport: "embedded-fallback",
    fallbackFrom: "gateway",
    fallbackEvidence: {
      detected: true,
      detectionMethod: structuredResult.stdoutJsonParsed ? "stderr-heuristic" : "stdout-stderr-heuristic",
      source: structuredResult.stdoutJsonParsed ? "stderr" : "stdout/stderr",
      from: "gateway",
      to: "embedded",
      reason: "matched embedded fallback text",
      structured: false,
    },
  };
}

function resolveStructuredFallbackResult(runnerResult) {
  if (isRecord(runnerResult?.openClawResult)) {
    return {
      evidence: buildStructuredFallbackEvidence(runnerResult.openClawResult, "openclaw-result"),
      stdoutJsonParsed: parseJsonObjectFromOutput(runnerResult?.stdout) !== null,
    };
  }
  const parsedStdout = parseJsonObjectFromOutput(runnerResult?.stdout);
  return {
    evidence: buildStructuredFallbackEvidence(parsedStdout, "stdout-json"),
    stdoutJsonParsed: parsedStdout !== null,
  };
}

function buildStructuredFallbackEvidence(structuredResult, source) {
  const meta = findOpenClawRuntimeMeta(structuredResult);
  if (!meta) return null;

  const transport = normalizeOptionalString(meta.transport);
  const fallbackFrom = normalizeOptionalString(meta.fallbackFrom);
  const fallbackReason = normalizeOptionalString(meta.fallbackReason);
  const embeddedTransport = transport === "embedded" || transport === "embedded-fallback";
  const detected = fallbackFrom === "gateway" && embeddedTransport;
  if (!detected) return null;
  return {
    detected: true,
    detectionMethod: "openclaw-json-meta",
    source,
    from: "gateway",
    to: "embedded",
    reason: fallbackReason,
    structured: true,
  };
}

function findOpenClawRuntimeMeta(value) {
  const root = isRecord(value) ? value : null;
  if (!root) return null;
  const candidates = [root.meta, isRecord(root.result) ? root.result.meta : null];
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    if (typeof candidate.transport === "string" || typeof candidate.fallbackFrom === "string") return candidate;
  }
  return null;
}

function isRecognizableOpenClawJson(value) {
  if (!isRecord(value)) return false;
  const hasStatus = typeof value.status === "string" || typeof value.ok === "boolean";
  const hasOpenClawShape = Array.isArray(value.payloads) || hasFallbackRuntimeMeta(value) || hasRecognizableOpenClawResult(value.result);
  if (hasStatus && hasOpenClawShape) return true;
  const result = isRecord(value.result) ? value.result : null;
  return Boolean(result && (typeof result.status === "string" || typeof result.ok === "boolean") && hasRecognizableOpenClawResult(result));
}

function hasRecognizableOpenClawResult(value) {
  if (!isRecord(value)) return false;
  return Array.isArray(value.payloads) || hasFallbackRuntimeMeta(value);
}

function hasFallbackRuntimeMeta(value) {
  const meta = findOpenClawRuntimeMeta(value);
  const transport = normalizeOptionalString(meta?.transport);
  const fallbackFrom = normalizeOptionalString(meta?.fallbackFrom);
  return fallbackFrom === "gateway" && (transport === "embedded" || transport === "embedded-fallback");
}

function parseStrictJsonObjectOutput(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return parseJsonObject(trimmed);
}

function parseJsonObjectFromOutput(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const direct = parseJsonObject(trimmed);
  if (direct) return direct;
  const lines = trimmed.split(/\r?\n/u).reverse();
  for (const line of lines) {
    const candidate = line.trim();
    if (!candidate.startsWith("{") || !candidate.endsWith("}")) continue;
    const parsed = parseJsonObject(candidate);
    if (parsed) return parsed;
  }
  return null;
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function removeNullish(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined));
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeStructuredTransport(value) {
  const transport = normalizeOptionalString(value);
  if (transport === "embedded") return "local";
  if (transport && SUPPORTED_TRANSPORTS.includes(transport)) return transport;
  return null;
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryFile = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryFile, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporaryFile, filePath);
}

function generateRunId(now) {
  const timestamp = isoTimestamp(now).replace(/[-:.]/gu, "").replace("Z", "Z");
  return `${timestamp}-${randomUUID().slice(0, 8)}`;
}

function isoTimestamp(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.trim().length > 0) return new Date(value).toISOString();
  return new Date().toISOString();
}

function hashString(value) {
  return createHash("sha256").update(value).digest("hex");
}

function uniqueStrings(values) {
  return Array.from(
    new Set(
      values
        .filter((value) => typeof value === "string")
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  ).sort();
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:=@+-]+$/u.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function sanitizeSelectorPart(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]+/gu, "-").replace(/^-+|-+$/gu, "") || "run";
}
