import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildRuntimePlan, materializeRuntimePlanForRun, SUPPORTED_TRANSPORTS } from "./runtime-plan.js";
import { runRuntimeCommand } from "./runtime-execution.js";

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
  if (options.live && !runtimePlan.runtimeIdentity.sandboxScope.stateDir && runtimePlan.runtimeIdentity.sandboxScope.usesProductionState !== true) {
    throw new Error("Live OpenClaw runs require --openclaw-state-dir <dir> or explicit --use-production-openclaw-state.");
  }
  await materializeManagedMessageFile(runtimePlan, options);
  const live = Boolean(options.live);
  const runner = commandRunner ?? runRuntimeCommand;
  const runnerResult = live ? await runner(runtimePlan.command, runtimePlan.runtimeIdentity, options) : null;
  const endedAt = isoTimestamp(options.endedAt ?? options.now);
  const execution = buildExecution({ live, runnerResult, startedAt, endedAt });
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
  const checks = [
    check("schema", runState?.schemaVersion === RUN_STATE_SCHEMA_VERSION, "run-state schema is supported"),
    check("execution", Boolean(runState?.execution?.status), "execution status is present"),
    check("source_blueprint_hash", typeof blueprintHash === "string" && blueprintHash.length > 0, "source blueprint hash is present"),
    check("message_provenance", hasMessageProvenance(runState?.message), "message provenance is bounded and replayable"),
    check("replayability", Boolean(runState?.replay?.eligible && runState?.message?.messageHash), "run has replay metadata and message provenance"),
    check("replay_fidelity", replayFidelityValue === "exact" || replayFidelityValue === "reconstructed", "replay fidelity is exact or reconstructed"),
    check("identity_fields", hasRuntimeIdentityFields(runState?.runtimeIdentity), "runtime identity fields are present as separate fields"),
    check("transport", isKnownTransport(transport), "transport field is present and explicit"),
    check("sandbox", Boolean(sandboxScope), "sandbox scope is present"),
    check("sandbox_non_production", sandboxScope?.usesProductionState !== true, "sandbox scope does not use production OpenClaw state"),
    check("certification_boundary", runState?.certificationBoundary?.runEvidenceCertifiesRuntime === false, "run evidence does not certify runtime/domain behavior"),
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
  const runner = commandRunner ?? runRuntimeCommand;
  runState.replay.replayFidelity = await replayFidelity(parentRunState);
  runState.execution = live
    ? buildExecution({ live: true, runnerResult: await runner(runState.command, runState.runtimeIdentity, options), startedAt, endedAt })
    : buildExecution({ live: false, runnerResult: null, startedAt, endedAt });
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
    evidence: {
      boundaries: runtimePlan.runtimeIdentity.evidenceBoundaries,
      stdoutSummary: execution.stdout.preview,
      stderrSummary: execution.stderr.preview,
      rawTranscriptStored: false,
      rawToolBodiesStored: false,
    },
    certificationBoundary: runtimePlan.certificationBoundary,
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
    transport: runState.runtimeIdentity?.transport ?? null,
    fallbackFrom: runState.runtimeIdentity?.fallbackFrom ?? null,
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
    "runtime",
    "channel",
    "selector",
    "workspace",
    "backend",
    "transport",
    "fallbackFrom",
    "sandboxScope",
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

function buildExecution({ live, runnerResult, startedAt, endedAt }) {
  if (!live) {
    return {
      live: false,
      executed: false,
      status: "declared",
      exitCode: null,
      timedOut: false,
      startedAt,
      endedAt,
      durationMs: 0,
      stdout: summarizeOutput(""),
      stderr: summarizeOutput(""),
    };
  }

  const exitCode = Number.isInteger(runnerResult?.exitCode) ? runnerResult.exitCode : 1;
  return {
    live: true,
    executed: true,
    status: exitCode === 0 ? "success" : "failure",
    exitCode,
    timedOut: Boolean(runnerResult?.timedOut),
    startedAt,
    endedAt,
    durationMs: Number.isFinite(runnerResult?.durationMs) ? runnerResult.durationMs : 0,
    stdout: summarizeOutput(runnerResult?.stdout ?? ""),
    stderr: summarizeOutput(runnerResult?.stderr ?? ""),
  };
}

function summarizeOutput(value) {
  const redacted = redactSecrets(value);
  const truncated = redacted.length > OUTPUT_TEXT_LIMIT;
  return {
    preview: truncated ? `${redacted.slice(0, OUTPUT_TEXT_LIMIT - 1)}…` : redacted,
    length: value.length,
    redactedLength: redacted.length,
    truncated,
  };
}

function redactSecrets(value) {
  return String(value)
    .replace(/\b[A-Za-z0-9_-]*(?:api[_-]?key|token|secret|password)[A-Za-z0-9_-]*\s*=\s*[^\s]+/giu, "[REDACTED_SECRET]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/gu, "[REDACTED_SECRET]");
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

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:=@+-]+$/u.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function sanitizeSelectorPart(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]+/gu, "-").replace(/^-+|-+$/gu, "") || "run";
}
