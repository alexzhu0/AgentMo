import { createHash } from "node:crypto";
import path from "node:path";
import { validateBlueprint } from "./blueprint.js";
import { resolveRuntimeEnv } from "./runtime-env.js";
import { containsSecretLikeValue, redactSecrets } from "./secret-redaction.js";
import { assertTargetAdapter } from "./targets/registry.js";

export const RUNTIME_PLAN_SCHEMA_VERSION = "agentmo.runtime-plan.v1";
export const DEFAULT_MESSAGE_PREVIEW_LIMIT = 120;
export const DEFAULT_INLINE_MESSAGE_LIMIT = 200;
export const FRESH_RUN_SESSION_KEY_PLACEHOLDER = "<fresh-run-session-key>";
export const DEFAULT_COMMAND_TIMEOUT_MS = 120000;
export const SUPPORTED_TRANSPORTS = ["gateway", "local", "embedded-fallback", "unknown"];
export const SUPPORTED_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "adaptive", "xhigh", "max"];
export const RUNTIME_PROXY_ENV_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"];

const DEFAULT_BACKEND = "openclaw-cli";
const DEFAULT_TRANSPORT = "unknown";
const SUPPORTED_RUNTIME_TARGET = "openclaw";

export function buildRuntimePlan(blueprint, options = {}) {
  const validation = validateBlueprint(blueprint);
  if (!validation.ok) {
    throw new Error(`Cannot build runtime plan for invalid blueprint:\n${validation.errors.map((error) => `- ${error}`).join("\n")}`);
  }

  const targetId = options.target ?? SUPPORTED_RUNTIME_TARGET;
  const target = assertTargetAdapter(targetId, "runtime target");
  if (target.id !== SUPPORTED_RUNTIME_TARGET) {
    throw new Error(`Runtime planning supports target ${SUPPORTED_RUNTIME_TARGET}; received ${target.id}.`);
  }

  const workspace = resolveRequiredPath(options.workspace, "workspace");
  const sourceRoot = options.openClawSourceRoot ? path.resolve(options.openClawSourceRoot) : null;
  const runtimeEnv = resolveRuntimeEnv(options);
  const sandboxScope = buildSandboxScope({
    workspace,
    sourceRoot,
    stateDir: options.openClawStateDir,
    usesProductionState: options.useProductionOpenClawState === true,
    runtimeEnvDescriptor: runtimeEnv.descriptor,
  });
  const routingSelector = resolveSelector(blueprint, options);
  const message = resolveMessageProvenance(options, runtimeEnv.secretValues);
  const transport = normalizeTransport(options.transport);
  const model = normalizeOptionalString(options.model);
  const thinking = normalizeThinking(options.thinking);
  const command = buildCommand({ routingSelector, message, sourceRoot, timeoutMs: options.timeoutMs, transport, model, thinking });
  const runtimeProfile = findRuntimeProfile(blueprint, SUPPORTED_RUNTIME_TARGET);
  const evidenceBoundaries = buildEvidenceBoundaries(runtimeProfile);

  return {
    schemaVersion: RUNTIME_PLAN_SCHEMA_VERSION,
    agentId: blueprint.agent_id,
    target: {
      id: target.id,
      label: target.label,
      verificationHints: target.verificationHints ?? [],
      unsupportedSurfaces: target.unsupportedSurfaces ?? [],
    },
    selectedRuntimeProfileId: runtimeProfile?.id ?? null,
    executionSessionPolicy: routingSelector.executionSessionPolicy,
    runtimeIdentity: {
      provider: normalizeOptionalString(options.provider),
      model,
      thinking,
      runtime: SUPPORTED_RUNTIME_TARGET,
      channel: normalizeOptionalString(options.channel),
      selector: routingSelector,
      workspace,
      backend: DEFAULT_BACKEND,
      transport,
      fallbackFrom: normalizeOptionalString(options.fallbackFrom),
      fallbackEvidence: {
        detected: false,
        detectionMethod: "planned",
        source: null,
        from: null,
        to: null,
        reason: null,
        structured: false,
      },
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
    unsupportedSurfaces: uniqueStrings([...(target.unsupportedSurfaces ?? []), ...(runtimeProfile?.unsupported_surfaces ?? [])]),
  };
}

export function materializeRuntimePlanForRun(runtimePlan, runId) {
  if (typeof runId !== "string" || runId.trim().length === 0) {
    throw new Error("runId must be a non-empty string to materialize a runtime plan.");
  }
  const plan = JSON.parse(JSON.stringify(runtimePlan));
  const executionSelector = plan.runtimeIdentity?.selector?.executionSelector;
  if (executionSelector?.generated && executionSelector.sessionKey === FRESH_RUN_SESSION_KEY_PLACEHOLDER) {
    const sessionKey = `agentmo-${sanitizeSelectorPart(plan.agentId)}-${sanitizeSelectorPart(runId)}`;
    executionSelector.sessionKey = sessionKey;
    plan.command.args = plan.command.args.map((arg) => (arg === FRESH_RUN_SESSION_KEY_PLACEHOLDER ? sessionKey : arg));
    plan.command.display = [plan.command.executable, ...plan.command.args].map(shellQuote).join(" ");
  }
  return plan;
}

function resolveRequiredPath(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required ${label} path.`);
  }
  return path.resolve(value);
}

function resolveSelector(blueprint, options) {
  const agent = options.agent ?? blueprint.agent_id;
  if (typeof agent !== "string" || agent.trim().length === 0) {
    throw new Error("OpenClaw selector agent must be a non-empty string.");
  }

  const explicitSessionSelectors = [
    ["sessionKey", options.sessionKey],
    ["sessionId", options.sessionId],
    ["to", options.to],
  ].filter(([, value]) => typeof value === "string" && value.trim().length > 0);

  if (explicitSessionSelectors.length > 1) {
    throw new Error("Pass at most one of --session-key, --session-id, or --to for run-plan.");
  }

  const [explicitKind, explicitValue] = explicitSessionSelectors[0] ?? [];
  const executionSessionPolicy = explicitKind ? "operator-supplied" : "fresh-per-run";
  const executionSelector = {
    agent,
    sessionKey: null,
    sessionId: null,
    to: null,
    generated: false,
  };

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

function resolveMessageProvenance(options, secretValues) {
  const hasInlineMessage = typeof options.message === "string";
  const hasMessageFile = typeof options.messageFile === "string" && options.messageFile.trim().length > 0;
  if (hasInlineMessage && hasMessageFile) {
    throw new Error("Pass exactly one of --message or --message-file, not both.");
  }
  if (!hasInlineMessage && !hasMessageFile) {
    throw new Error("Missing message input. Pass --message <text> or --message-file <path>.");
  }

  if (hasMessageFile) {
    const filePath = path.resolve(options.messageFile);
    const content = typeof options.messageFileContent === "string" ? options.messageFileContent : "";
    const digest = hashString(content);
    const secretLikeContent = containsSecretLikeValue(content, secretValues);
    return {
      messageMode: "file",
      messageHash: digest,
      messageLength: content.length,
      messagePreview: previewString(redactSecrets(content, secretValues)),
      secretLikeContent,
      inlineMessage: null,
      messageFile: {
        path: filePath,
        digest,
        planned: false,
        digestVerified: true,
      },
      replayFidelityIfMaterialAvailable: "exact",
    };
  }

  const message = options.message;
  const digest = hashString(message);
  const secretLikeContent = containsSecretLikeValue(message, secretValues);
  const shouldUseManagedMessageFile = message.includes("\n") || message.length > DEFAULT_INLINE_MESSAGE_LIMIT || secretLikeContent;
  if (shouldUseManagedMessageFile) {
    return {
      messageMode: "file",
      messageHash: digest,
      messageLength: message.length,
      messagePreview: previewString(redactSecrets(message, secretValues)),
      secretLikeContent,
      inlineMessage: null,
      messageFile: {
        path: `messages/${digest.slice(0, 16)}.txt`,
        digest,
        planned: true,
        digestVerified: false,
      },
      replayFidelityIfMaterialAvailable: "exact",
    };
  }

  return {
    messageMode: "inline",
    messageHash: digest,
    messageLength: message.length,
    messagePreview: previewString(redactSecrets(message, secretValues)),
    secretLikeContent,
    inlineMessage: message,
    messageFile: null,
    replayFidelityIfMaterialAvailable: "exact",
  };
}

function buildCommand({ routingSelector, message, sourceRoot, timeoutMs, transport, model, thinking }) {
  const args = sourceRoot ? ["openclaw", "agent"] : ["agent"];
  if (transport === "local") args.push("--local");
  args.push("--json");
  if (model) args.push("--model", model);
  if (thinking) args.push("--thinking", thinking);
  if (routingSelector.executionSelector.agent) args.push("--agent", routingSelector.executionSelector.agent);
  if (routingSelector.executionSelector.sessionKey) args.push("--session-key", routingSelector.executionSelector.sessionKey);
  if (routingSelector.executionSelector.sessionId) args.push("--session-id", routingSelector.executionSelector.sessionId);
  if (routingSelector.executionSelector.to) args.push("--to", routingSelector.executionSelector.to);
  if (message.messageMode === "inline") args.push("--message", message.inlineMessage);
  else args.push("--message-file", message.messageFile.path);

  const executable = sourceRoot ? "pnpm" : "openclaw";
  return {
    backend: DEFAULT_BACKEND,
    cwd: sourceRoot,
    executable,
    args,
    display: [executable, ...args].map(shellQuote).join(" "),
    mutatesOpenClawState: false,
    timeoutMs: normalizeTimeoutMs(timeoutMs),
  };
}

function buildSandboxScope({ workspace, sourceRoot, stateDir, usesProductionState, runtimeEnvDescriptor }) {
  if (stateDir && usesProductionState) {
    throw new Error("Pass either --openclaw-state-dir or --use-production-openclaw-state, not both.");
  }
  const resolvedStateDir = stateDir ? path.resolve(stateDir) : null;
  const baseEnvironmentAllowlist = usesProductionState ? ["HOME", "OPENCLAW_STATE_DIR", "PATH"] : ["OPENCLAW_STATE_DIR", "PATH"];
  const proxyEnvironmentAllowlist = RUNTIME_PROXY_ENV_KEYS.filter((key) => typeof process.env[key] === "string" && process.env[key].trim().length > 0);
  return {
    stateDir: resolvedStateDir,
    workspaceRoot: workspace,
    openClawSourceRoot: sourceRoot,
    sourceMode: sourceRoot ? "source-checkout" : "packaged-cli",
    environmentAllowlist: uniqueStrings([...baseEnvironmentAllowlist, ...proxyEnvironmentAllowlist, ...(runtimeEnvDescriptor?.presentKeys ?? [])]),
    usesProductionState: Boolean(usesProductionState),
  };
}

function buildEvidenceBoundaries(runtimeProfile) {
  return {
    rawTranscriptsStored: false,
    rawToolBodiesStored: false,
    messagePreviewLimit: DEFAULT_MESSAGE_PREVIEW_LIMIT,
    inlineMessageLimit: DEFAULT_INLINE_MESSAGE_LIMIT,
    trajectoryPolicy: "bounded summaries and explicit artifact paths only",
    profileEvidenceBoundaries: runtimeProfile?.evidence_boundaries ?? [],
  };
}

function findRuntimeProfile(blueprint, id) {
  if (!Array.isArray(blueprint.runtime_profiles)) return null;
  return blueprint.runtime_profiles.find((profile) => profile && typeof profile === "object" && profile.id === id) ?? null;
}

function hashString(value) {
  return createHash("sha256").update(value).digest("hex");
}

function previewString(value) {
  if (value.length <= DEFAULT_MESSAGE_PREVIEW_LIMIT) return value;
  return `${value.slice(0, DEFAULT_MESSAGE_PREVIEW_LIMIT - 1)}…`;
}

function normalizeTimeoutMs(value) {
  if (value === undefined || value === null) return DEFAULT_COMMAND_TIMEOUT_MS;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new Error("--timeout-ms must be a positive integer.");
  }
  return numeric;
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeTransport(value) {
  const normalized = normalizeOptionalString(value) ?? DEFAULT_TRANSPORT;
  if (!SUPPORTED_TRANSPORTS.includes(normalized)) {
    throw new Error(`Unsupported --transport ${normalized}. Expected one of: ${SUPPORTED_TRANSPORTS.join(", ")}`);
  }
  return normalized;
}

function normalizeThinking(value) {
  const normalized = normalizeOptionalString(value);
  if (normalized === null) return null;
  if (!SUPPORTED_THINKING_LEVELS.includes(normalized)) {
    throw new Error(`Unsupported --thinking ${normalized}. Expected one of: ${SUPPORTED_THINKING_LEVELS.join(", ")}`);
  }
  return normalized;
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:=@+-]+$/u.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function sanitizeSelectorPart(value) {
  return value.replace(/[^A-Za-z0-9_.-]+/gu, "-").replace(/^-+|-+$/gu, "") || "run";
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0)));
}
