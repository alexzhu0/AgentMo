import { createHash } from "node:crypto";
import path from "node:path";
import { validateBlueprint } from "./blueprint.js";
import { assertPersistable, isRedactedSummary, isSecretPresence } from "./persistability.js";
import { resolveRuntimeEnv } from "./runtime-env.js";
import { assertTargetAdapter } from "./targets/registry.js";

export const RUNTIME_PLAN_SCHEMA_VERSION = "agentmo.runtime-plan.v1";
export const DEFAULT_MESSAGE_PREVIEW_LIMIT = 120;
export const DEFAULT_INLINE_MESSAGE_LIMIT = 200;
export const FRESH_RUN_SESSION_KEY_PLACEHOLDER = "<fresh-run-session-key>";
export const TRANSIENT_MESSAGE_PLACEHOLDER = "<transient-message>";
export const DEFAULT_COMMAND_TIMEOUT_MS = 120000;
export const SUPPORTED_TRANSPORTS = ["gateway", "local", "embedded-fallback", "unknown"];
export const SUPPORTED_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "adaptive", "xhigh", "max"];
export const RUNTIME_PROXY_ENV_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"];

const DEFAULT_BACKEND = "openclaw-cli";
const DEFAULT_TRANSPORT = "unknown";
const SUPPORTED_RUNTIME_TARGET = "openclaw";
const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const TRANSIENT_PATH_KIND = "TransientPathRef";

export async function buildRuntimePlan(blueprint, options = {}) {
  const validation = validateBlueprint(blueprint);
  if (!validation.ok) {
    throw new Error(`Cannot build runtime plan for invalid blueprint:\n${validation.errors.map((error) => `- ${error}`).join("\n")}`);
  }
  const { admittedArtifactProvenance } = await import("./artifact-admission.js");
  const source = admittedArtifactProvenance(options.admission, {
    subject: "blueprint",
    value: blueprint,
  });

  const targetId = options.target ?? SUPPORTED_RUNTIME_TARGET;
  const target = assertTargetAdapter(targetId, "runtime target");
  if (target.id !== SUPPORTED_RUNTIME_TARGET) {
    throw new Error(`Runtime planning supports target ${SUPPORTED_RUNTIME_TARGET}; received ${target.id}.`);
  }

  requireTransientPath(options.workspace, "workspace");
  const sourceRootSupplied = hasTransientPath(options.openClawSourceRoot);
  const runtimeEnv = resolveRuntimeEnv(options);
  const sandboxScope = buildSandboxScope({
    sourceRootSupplied,
    stateDirSupplied: hasTransientPath(options.openClawStateDir),
    usesProductionState: options.useProductionOpenClawState === true,
    runtimeEnvDescriptor: runtimeEnv.descriptor,
  });
  const routingSelector = resolveSelector(blueprint, options);
  const message = resolveMessageRecord(options);
  const transport = normalizeTransport(options.transport);
  const model = normalizeOptionalString(options.model);
  const thinking = normalizeThinking(options.thinking);
  const command = buildCommand({ routingSelector, sourceRootSupplied, timeoutMs: options.timeoutMs, transport, model, thinking });
  const runtimeProfile = findRuntimeProfile(blueprint, SUPPORTED_RUNTIME_TARGET);
  const evidenceBoundaries = buildEvidenceBoundaries(runtimeProfile);

  const plan = {
    schemaVersion: RUNTIME_PLAN_SCHEMA_VERSION,
    agentId: blueprint.agent_id,
    target: {
      id: target.id,
      label: target.label,
      verificationHintDigests: (target.verificationHints ?? []).map(digestText),
      unsupportedSurfaceDigests: (target.unsupportedSurfaces ?? []).map(digestText),
    },
    selectedRuntimeProfileId: runtimeProfile?.id ?? null,
    executionSessionPolicy: routingSelector.executionSessionPolicy,
    source,
    runtimeIdentity: {
      provider: normalizeOptionalString(options.provider),
      model,
      thinking,
      runtime: SUPPORTED_RUNTIME_TARGET,
      channel: normalizeOptionalString(options.channel),
      selector: routingSelector,
      workspace: transientPathRef("workspace"),
      backend: DEFAULT_BACKEND,
      transport,
      fallbackFrom: normalizeOptionalString(options.fallbackFrom),
      fallbackEvidence: plannedFallbackEvidence(),
      sandboxScope,
      runtimeEnv: runtimeEnv.descriptor,
      evidenceBoundaries,
    },
    message,
    command,
    certificationBoundary: {
      runEvidenceCertifiesRuntime: false,
      note: "Runtime command planning is evidence preparation only; it does not certify runtime parity or domain behavior.",
    },
    unsupportedSurfaceDigests: uniqueStrings(
      [...(target.unsupportedSurfaces ?? []), ...(runtimeProfile?.unsupported_surfaces ?? [])].map(digestText),
    ),
  };
  assertPersistable(plan, { subject: "runtime-plan" });
  const artifactValidation = validateRuntimePlanArtifact(plan);
  if (!artifactValidation.ok) throw runtimePlanInvalid();
  return deepFreeze(plan);
}

export function validateRuntimePlanArtifact(plan) {
  const errors = [];
  try {
    assertPersistable(plan, { subject: "runtime-plan" });
    requireExactKeys(plan, [
      "schemaVersion",
      "agentId",
      "target",
      "selectedRuntimeProfileId",
      "executionSessionPolicy",
      "source",
      "runtimeIdentity",
      "message",
      "command",
      "certificationBoundary",
      "unsupportedSurfaceDigests",
    ], "runtime_plan", errors);
    if (plan?.schemaVersion !== RUNTIME_PLAN_SCHEMA_VERSION) errors.push("invalid_schema_version");
    if (!isKebabId(plan?.agentId)) errors.push("invalid_agent_id");
    if (!validTarget(plan?.target)) errors.push("invalid_target");
    if (!nullableString(plan?.selectedRuntimeProfileId)) errors.push("invalid_runtime_profile");
    if (!validSessionPolicy(plan?.executionSessionPolicy)) errors.push("invalid_session_policy");
    if (!validSource(plan?.source)) errors.push("invalid_source");
    if (!validRuntimeIdentity(plan?.runtimeIdentity)) errors.push("invalid_runtime_identity");
    if (!validMessageRecord(plan?.message)) errors.push("invalid_message");
    if (!validCommand(plan?.command, plan?.runtimeIdentity)) errors.push("invalid_command");
    if (!hasExactKeys(plan?.certificationBoundary, ["runEvidenceCertifiesRuntime", "note"])
      || plan.certificationBoundary.runEvidenceCertifiesRuntime !== false
      || !nonEmptyString(plan.certificationBoundary.note)) errors.push("invalid_certification_boundary");
    if (!digestArray(plan?.unsupportedSurfaceDigests)) errors.push("invalid_unsupported_surfaces");
  } catch {
    errors.push("unsafe_runtime_plan_shape");
  }
  return { ok: errors.length === 0, errors };
}

export function materializeRuntimePlanForRun(runtimePlan, options = {}) {
  if (!validateRuntimePlanArtifact(runtimePlan).ok) throw runtimePlanInvalid();
  const runId = options.runId;
  if (typeof runId !== "string" || runId.trim().length === 0) {
    throw new Error("runId must be a non-empty string to materialize a runtime plan.");
  }
  const transientMessage = resolveTransientMessage(options);
  if (transientMessage.sourceDigest !== runtimePlan.message.sourceDigest
    || transientMessage.byteLength !== runtimePlan.message.byteLength) {
    const error = new Error("Transient message bytes do not match the admitted runtime plan.");
    error.code = "AGENTMO_RUNTIME_MESSAGE_DIGEST_MISMATCH";
    throw error;
  }
  const workspace = requireTransientPath(options.workspace, "workspace");
  const sourceRoot = runtimePlan.runtimeIdentity.sandboxScope.sourceRoot
    ? requireTransientPath(options.openClawSourceRoot, "OpenClaw source root")
    : null;
  const stateDir = runtimePlan.runtimeIdentity.sandboxScope.state
    ? requireTransientPath(options.openClawStateDir, "OpenClaw state")
    : null;
  if (runtimePlan.runtimeIdentity.sandboxScope.usesProductionState === true && stateDir) {
    throw new Error("Production OpenClaw state cannot also use an isolated state path.");
  }

  const durablePlan = cloneJson(runtimePlan);
  const executionSelector = durablePlan.runtimeIdentity.selector.executionSelector;
  if (executionSelector.generated && executionSelector.sessionKey === FRESH_RUN_SESSION_KEY_PLACEHOLDER) {
    const sessionKey = `agentmo-${sanitizeSelectorPart(durablePlan.agentId)}-${sanitizeSelectorPart(runId)}`;
    executionSelector.sessionKey = sessionKey;
    durablePlan.command.args = durablePlan.command.args.map((arg) => (arg === FRESH_RUN_SESSION_KEY_PLACEHOLDER ? sessionKey : arg));
    durablePlan.command.display = displayCommand(durablePlan.command.executable, durablePlan.command.args);
  }

  const transientCommand = {
    ...cloneJson(durablePlan.command),
    cwd: sourceRoot,
    args: durablePlan.command.args.map((arg) => (arg === TRANSIENT_MESSAGE_PLACEHOLDER ? transientMessage.text : arg)),
  };
  transientCommand.display = displayCommand(transientCommand.executable, transientCommand.args);
  const transientRuntimeIdentity = cloneJson(durablePlan.runtimeIdentity);
  transientRuntimeIdentity.workspace = workspace;
  transientRuntimeIdentity.sandboxScope.workspaceRoot = workspace;
  transientRuntimeIdentity.sandboxScope.openClawSourceRoot = sourceRoot;
  transientRuntimeIdentity.sandboxScope.stateDir = stateDir;
  return { durablePlan, transientCommand, transientRuntimeIdentity, transientMessage };
}

function resolveMessageRecord(options) {
  const transient = resolveTransientMessage(options);
  const summaryText = JSON.stringify({
    type: "message-digest-summary",
    byteLength: transient.byteLength,
  });
  return {
    sourceDigest: transient.sourceDigest,
    byteLength: transient.byteLength,
    summary: redactedSummary(summaryText, transient.byteLength, "unstructured-digest-summary"),
  };
}

function resolveTransientMessage(options) {
  const hasInline = typeof options.message === "string" || Buffer.isBuffer(options.messageBytes);
  const hasFile = hasTransientPath(options.messageFile) || options.messageFileContent !== undefined;
  if (hasInline && hasFile) throw new Error("Pass exactly one of --message or --message-file, not both.");
  if (!hasInline && !hasFile) throw new Error("Missing message input. Pass --message <text> or --message-file <path>.");
  const bytes = Buffer.isBuffer(options.messageBytes)
    ? Buffer.from(options.messageBytes)
    : Buffer.isBuffer(options.messageFileContent)
      ? Buffer.from(options.messageFileContent)
      : Buffer.from(hasInline ? options.message : String(options.messageFileContent ?? ""), "utf8");
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    const error = new Error("Runtime messages must be valid UTF-8.");
    error.code = "AGENTMO_RUNTIME_MESSAGE_INVALID_UTF8";
    throw error;
  }
  return {
    bytes,
    text,
    sourceDigest: digestBytes(bytes),
    byteLength: bytes.length,
  };
}

function buildCommand({ routingSelector, sourceRootSupplied, timeoutMs, transport, model, thinking }) {
  const args = sourceRootSupplied ? ["openclaw", "agent"] : ["agent"];
  if (transport === "local") args.push("--local");
  args.push("--json");
  if (model) args.push("--model", model);
  if (thinking) args.push("--thinking", thinking);
  if (routingSelector.executionSelector.agent) args.push("--agent", routingSelector.executionSelector.agent);
  if (routingSelector.executionSelector.sessionKey) args.push("--session-key", routingSelector.executionSelector.sessionKey);
  if (routingSelector.executionSelector.sessionId) args.push("--session-id", routingSelector.executionSelector.sessionId);
  if (routingSelector.executionSelector.to) args.push("--to", routingSelector.executionSelector.to);
  args.push("--message", TRANSIENT_MESSAGE_PLACEHOLDER);
  const executable = sourceRootSupplied ? "pnpm" : "openclaw";
  return {
    backend: DEFAULT_BACKEND,
    cwd: sourceRootSupplied ? transientPathRef("openclaw-source-root") : null,
    executable,
    args,
    display: displayCommand(executable, args),
    mutatesOpenClawState: false,
    timeoutMs: normalizeTimeoutMs(timeoutMs),
  };
}

function buildSandboxScope({ sourceRootSupplied, stateDirSupplied, usesProductionState, runtimeEnvDescriptor }) {
  if (stateDirSupplied && usesProductionState) {
    throw new Error("Pass either --openclaw-state-dir or --use-production-openclaw-state, not both.");
  }
  const baseEnvironmentAllowlist = usesProductionState ? ["HOME", "OPENCLAW_STATE_DIR", "PATH"] : ["OPENCLAW_STATE_DIR", "PATH"];
  const proxyEnvironmentAllowlist = RUNTIME_PROXY_ENV_KEYS.filter((key) => typeof process.env[key] === "string" && process.env[key].trim().length > 0);
  return {
    state: stateDirSupplied ? transientPathRef("openclaw-state") : null,
    workspaceRoot: transientPathRef("workspace"),
    sourceRoot: sourceRootSupplied ? transientPathRef("openclaw-source-root") : null,
    sourceMode: sourceRootSupplied ? "source-checkout" : "packaged-cli",
    environmentAllowlist: uniqueStrings([...baseEnvironmentAllowlist, ...proxyEnvironmentAllowlist, ...(runtimeEnvDescriptor?.presentNames ?? [])]),
    usesProductionState: Boolean(usesProductionState),
  };
}

function resolveSelector(blueprint, options) {
  const agent = options.agent ?? blueprint.agent_id;
  if (typeof agent !== "string" || agent.trim().length === 0) throw new Error("OpenClaw selector agent must be a non-empty string.");
  const explicitSessionSelectors = [["sessionKey", options.sessionKey], ["sessionId", options.sessionId], ["to", options.to]]
    .filter(([, value]) => typeof value === "string" && value.trim().length > 0);
  if (explicitSessionSelectors.length > 1) throw new Error("Pass at most one of --session-key, --session-id, or --to for run-plan.");
  const [explicitKind, explicitValue] = explicitSessionSelectors[0] ?? [];
  const executionSessionPolicy = explicitKind ? "operator-supplied" : "fresh-per-run";
  const executionSelector = { agent, sessionKey: null, sessionId: null, to: null, generated: false };
  if (explicitKind === "sessionKey") executionSelector.sessionKey = explicitValue;
  if (explicitKind === "sessionId") executionSelector.sessionId = explicitValue;
  if (explicitKind === "to") executionSelector.to = explicitValue;
  if (!explicitKind) {
    executionSelector.sessionKey = FRESH_RUN_SESSION_KEY_PLACEHOLDER;
    executionSelector.generated = true;
  }
  return {
    agent,
    routingSelector: { agent },
    executionSelector,
    executionSessionPolicy,
    explicitSessionReuse: Boolean(explicitKind),
  };
}

function validRuntimeIdentity(value) {
  if (!hasExactKeys(value, [
    "provider", "model", "thinking", "runtime", "channel", "selector", "workspace", "backend", "transport",
    "fallbackFrom", "fallbackEvidence", "sandboxScope", "runtimeEnv", "evidenceBoundaries",
  ])) return false;
  return nullableString(value.provider)
    && nullableString(value.model)
    && (value.thinking === null || SUPPORTED_THINKING_LEVELS.includes(value.thinking))
    && value.runtime === SUPPORTED_RUNTIME_TARGET
    && nullableString(value.channel)
    && validSelector(value.selector)
    && validTransientPathRef(value.workspace, "workspace")
    && value.backend === DEFAULT_BACKEND
    && SUPPORTED_TRANSPORTS.includes(value.transport)
    && nullableString(value.fallbackFrom)
    && validFallbackEvidence(value.fallbackEvidence)
    && validSandboxScope(value.sandboxScope)
    && isSecretPresence(value.runtimeEnv)
    && validEvidenceBoundaries(value.evidenceBoundaries);
}

function validSelector(value) {
  if (!hasExactKeys(value, ["agent", "routingSelector", "executionSelector", "executionSessionPolicy", "explicitSessionReuse"])) return false;
  const execution = value.executionSelector;
  return nonEmptyString(value.agent)
    && hasExactKeys(value.routingSelector, ["agent"])
    && value.routingSelector.agent === value.agent
    && hasExactKeys(execution, ["agent", "sessionKey", "sessionId", "to", "generated"])
    && execution.agent === value.agent
    && [execution.sessionKey, execution.sessionId, execution.to].filter(nonEmptyString).length === 1
    && typeof execution.generated === "boolean"
    && validSessionPolicy(value.executionSessionPolicy)
    && typeof value.explicitSessionReuse === "boolean";
}

function validSandboxScope(value) {
  return hasExactKeys(value, ["state", "workspaceRoot", "sourceRoot", "sourceMode", "environmentAllowlist", "usesProductionState"])
    && (value.state === null || validTransientPathRef(value.state, "openclaw-state"))
    && validTransientPathRef(value.workspaceRoot, "workspace")
    && (value.sourceRoot === null || validTransientPathRef(value.sourceRoot, "openclaw-source-root"))
    && ((value.sourceRoot === null && value.sourceMode === "packaged-cli") || (value.sourceRoot !== null && value.sourceMode === "source-checkout"))
    && sortedUniqueStrings(value.environmentAllowlist)
    && typeof value.usesProductionState === "boolean"
    && !(value.state !== null && value.usesProductionState);
}

function validMessageRecord(value) {
  return hasExactKeys(value, ["sourceDigest", "byteLength", "summary"])
    && SHA256_DIGEST_PATTERN.test(value.sourceDigest)
    && Number.isSafeInteger(value.byteLength)
    && value.byteLength >= 0
    && value.byteLength <= 1_048_576
    && isRedactedSummary(value.summary)
    && value.summary.length === value.byteLength;
}

function validCommand(value, runtimeIdentity) {
  if (!hasExactKeys(value, ["backend", "cwd", "executable", "args", "display", "mutatesOpenClawState", "timeoutMs"])) return false;
  const sourceMode = runtimeIdentity?.sandboxScope?.sourceMode;
  return value.backend === DEFAULT_BACKEND
    && ((sourceMode === "source-checkout" && validTransientPathRef(value.cwd, "openclaw-source-root")) || (sourceMode === "packaged-cli" && value.cwd === null))
    && ((sourceMode === "source-checkout" && value.executable === "pnpm") || (sourceMode === "packaged-cli" && value.executable === "openclaw"))
    && stringArray(value.args)
    && value.args.filter((item) => item === TRANSIENT_MESSAGE_PLACEHOLDER).length === 1
    && !value.args.some((item) => hasHostPath(item))
    && value.display === displayCommand(value.executable, value.args)
    && value.mutatesOpenClawState === false
    && Number.isSafeInteger(value.timeoutMs)
    && value.timeoutMs > 0;
}

function validTarget(value) {
  return hasExactKeys(value, ["id", "label", "verificationHintDigests", "unsupportedSurfaceDigests"])
    && value.id === SUPPORTED_RUNTIME_TARGET
    && nonEmptyString(value.label)
    && digestArray(value.verificationHintDigests)
    && digestArray(value.unsupportedSurfaceDigests);
}

function validSource(value) {
  return hasExactKeys(value, ["identity", "subject", "digest"])
    && value.identity === "0.1"
    && value.subject === "blueprint"
    && SHA256_DIGEST_PATTERN.test(value.digest);
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

function validEvidenceBoundaries(value) {
  return hasExactKeys(value, ["rawTranscriptsStored", "rawToolBodiesStored", "messagePreviewLimit", "inlineMessageLimit", "trajectoryPolicy", "profileEvidenceBoundaryDigests"])
    && value.rawTranscriptsStored === false
    && value.rawToolBodiesStored === false
    && value.messagePreviewLimit === DEFAULT_MESSAGE_PREVIEW_LIMIT
    && value.inlineMessageLimit === DEFAULT_INLINE_MESSAGE_LIMIT
    && nonEmptyString(value.trajectoryPolicy)
    && digestArray(value.profileEvidenceBoundaryDigests);
}

function buildEvidenceBoundaries(runtimeProfile) {
  return {
    rawTranscriptsStored: false,
    rawToolBodiesStored: false,
    messagePreviewLimit: DEFAULT_MESSAGE_PREVIEW_LIMIT,
    inlineMessageLimit: DEFAULT_INLINE_MESSAGE_LIMIT,
    trajectoryPolicy: "bounded summaries and explicit artifact references only",
    profileEvidenceBoundaryDigests: (runtimeProfile?.evidence_boundaries ?? []).map(digestText),
  };
}

function plannedFallbackEvidence() {
  return { detected: false, detectionMethod: "planned", source: null, from: null, to: null, reason: null, structured: false };
}

function redactedSummary(text, originalLength, summaryKind) {
  return {
    kind: "RedactedSummary",
    summaryKind,
    sha256: createHash("sha256").update(text, "utf8").digest("hex"),
    length: originalLength,
    redactedLength: text.length,
    text,
    redacted: true,
  };
}

function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function digestText(value) {
  return digestBytes(Buffer.from(String(value), "utf8"));
}

function transientPathRef(name) {
  return { kind: TRANSIENT_PATH_KIND, name, persisted: false };
}

function validTransientPathRef(value, name) {
  return hasExactKeys(value, ["kind", "name", "persisted"])
    && value.kind === TRANSIENT_PATH_KIND
    && value.name === name
    && value.persisted === false;
}

function requireTransientPath(value, label) {
  if (!hasTransientPath(value)) throw new Error(`Missing required ${label} path.`);
  return path.resolve(value);
}

function hasTransientPath(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasHostPath(value) {
  return typeof value === "string" && (path.isAbsolute(value) || /^[A-Za-z]:[\\/]/u.test(value));
}

function normalizeTimeoutMs(value) {
  if (value === undefined || value === null) return DEFAULT_COMMAND_TIMEOUT_MS;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) throw new Error("--timeout-ms must be a positive integer.");
  return numeric;
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeTransport(value) {
  const normalized = normalizeOptionalString(value) ?? DEFAULT_TRANSPORT;
  if (!SUPPORTED_TRANSPORTS.includes(normalized)) throw new Error(`Unsupported --transport ${normalized}. Expected one of: ${SUPPORTED_TRANSPORTS.join(", ")}`);
  return normalized;
}

function normalizeThinking(value) {
  const normalized = normalizeOptionalString(value);
  if (normalized === null) return null;
  if (!SUPPORTED_THINKING_LEVELS.includes(normalized)) throw new Error(`Unsupported --thinking ${normalized}. Expected one of: ${SUPPORTED_THINKING_LEVELS.join(", ")}`);
  return normalized;
}

function findRuntimeProfile(blueprint, id) {
  if (!Array.isArray(blueprint.runtime_profiles)) return null;
  return blueprint.runtime_profiles.find((profile) => profile && typeof profile === "object" && profile.id === id) ?? null;
}

function displayCommand(executable, args) {
  return [executable, ...args].map(shellQuote).join(" ");
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:=@+<>-]+$/u.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function sanitizeSelectorPart(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]+/gu, "-").replace(/^-+|-+$/gu, "") || "run";
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter(nonEmptyString).map((value) => value.trim()))).sort();
}

function sortedUniqueStrings(value) {
  return stringArray(value) && value.every((item, index) => index === 0 || value[index - 1] < item);
}

function validSessionPolicy(value) {
  return value === "fresh-per-run" || value === "operator-supplied";
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

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function nullableString(value) {
  return value === null || typeof value === "string";
}

function stringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function digestArray(value) {
  return stringArray(value) && value.every((item) => SHA256_DIGEST_PATTERN.test(item));
}

function isKebabId(value) {
  return typeof value === "string" && /^[a-z][a-z0-9-]*$/u.test(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function runtimePlanInvalid() {
  const error = new Error("Runtime-plan candidate is invalid.");
  error.code = "AGENTMO_RUNTIME_PLAN_INVALID";
  return error;
}
