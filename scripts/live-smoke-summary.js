import { pathToFileURL } from "node:url";
import {
  assertPersistable,
  emitPersistableOutput,
  serializePersistableJson,
  writePersistableJsonAtomic,
} from "../src/persistability.js";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const STATE_ACTIONS = new Set(["deleted", "not-created", "retained-by-explicit-keep-state"]);
const RUNTIME_ENV_ACTIONS = new Set(["deleted", "not-created"]);
const GATEWAY_ACTIONS = new Set(["not-started", "stopped"]);
const SCRUB_KEYS = Object.freeze([
  "stateAction",
  "runtimeEnvironmentAction",
  "gatewayProcessAction",
  "keepState",
]);
const SUMMARY_KEYS = Object.freeze([
  "agentId",
  "providerId",
  "modelId",
  "thinkingMode",
  "timeoutMs",
  "transportRequested",
  "gatewayStarted",
  "gatewayEphemeralAuthenticationGenerated",
  "blueprintDigest",
  "runtimePlanDigest",
  "runStateDigest",
  "runReportDigest",
  "runEvalDigest",
  "statusDigest",
  "scrubReportDigest",
  "runEvalExitCode",
  "statusExitCode",
]);

export function buildLiveSmokeScrubReport(input) {
  const fields = exactInput(input, SCRUB_KEYS);
  const candidate = {
    schemaVersion: "agentmo.live-smoke-scrub.v1",
    isolatedStateAction: allowed(fields.stateAction, STATE_ACTIONS),
    runtimeEnvironmentAction: allowed(fields.runtimeEnvironmentAction, RUNTIME_ENV_ACTIONS),
    gatewayProcessAction: allowed(fields.gatewayProcessAction, GATEWAY_ACTIONS),
    keepState: booleanValue(fields.keepState),
    credentialValuesPersistedByAgentMoEvidence: false,
  };
  return validatedCandidate(candidate, "live-smoke-scrub");
}

export function buildLiveSmokeSummary(input) {
  const fields = exactInput(input, SUMMARY_KEYS);
  const candidate = {
    schemaVersion: "agentmo.live-smoke-summary.v1",
    agentId: nonEmptyString(fields.agentId),
    providerId: nonEmptyString(fields.providerId),
    modelId: nonEmptyString(fields.modelId),
    thinkingMode: nonEmptyString(fields.thinkingMode),
    timeoutMs: nonNegativeInteger(fields.timeoutMs),
    transportRequested: allowed(fields.transportRequested, new Set(["gateway", "local"])),
    gatewayStarted: booleanValue(fields.gatewayStarted),
    gatewayEphemeralAuthenticationGenerated: booleanValue(fields.gatewayEphemeralAuthenticationGenerated),
    blueprint: artifactReference("operator-blueprint", fields.blueprintDigest),
    workspace: fixedPresence("isolated-openclaw-workspace"),
    runOutput: fixedPresence("isolated-agentmo-run-output"),
    artifacts: [
      artifactReference("agentmo-runtime-plan", fields.runtimePlanDigest),
      artifactReference("agentmo-run-state", fields.runStateDigest),
      artifactReference("agentmo-run-report", fields.runReportDigest),
      artifactReference("agentmo-run-eval", fields.runEvalDigest),
      artifactReference("agentmo-status", fields.statusDigest),
      artifactReference("agentmo-live-smoke-scrub", fields.scrubReportDigest),
    ],
    runEvalExitCode: nonNegativeInteger(fields.runEvalExitCode),
    statusExitCode: nonNegativeInteger(fields.statusExitCode),
    credentialValuesPersistedByAgentMoEvidence: false,
    certificationClaimed: false,
  };
  return validatedCandidate(candidate, "live-smoke-summary");
}

export async function persistLiveSmokeCandidate(candidate, options = {}) {
  const subject = options.subject;
  const outputFile = options.outputFile;
  if (typeof subject !== "string" || !["live-smoke-scrub", "live-smoke-summary"].includes(subject)) {
    throw invalidInput();
  }
  if (typeof outputFile !== "string" || outputFile.length === 0 || outputFile.includes("\0")) {
    throw invalidInput();
  }
  assertPersistable(candidate, { subject });
  await writePersistableJsonAtomic(outputFile, candidate, {
    subject,
    ...(options.io === undefined ? {} : { io: options.io }),
  });
  if (options.stdout !== true) return outputFile;
  await emitPersistableOutput({
    candidate,
    json: true,
    format: (value) => serializePersistableJson(value, { subject }),
    sink: options.sink ?? stdoutSink,
    options: { subject },
  });
  return outputFile;
}

async function main(args, env) {
  const kind = args[0];
  if (args.length !== 1 || !["scrub", "summary"].includes(kind)) throw invalidInput();
  const outputFile = requiredEnvironmentValue(env, "OUTPUT_FILE");
  if (kind === "scrub") {
    const candidate = buildLiveSmokeScrubReport({
      stateAction: requiredEnvironmentValue(env, "STATE_ACTION"),
      runtimeEnvironmentAction: requiredEnvironmentValue(env, "RUNTIME_ENVIRONMENT_ACTION"),
      gatewayProcessAction: requiredEnvironmentValue(env, "GATEWAY_PROCESS_ACTION"),
      keepState: parseBoolean(requiredEnvironmentValue(env, "KEEP_STATE")),
    });
    await persistLiveSmokeCandidate(candidate, {
      subject: "live-smoke-scrub",
      outputFile,
    });
    return;
  }

  const candidate = buildLiveSmokeSummary({
    agentId: requiredEnvironmentValue(env, "AGENT_ID"),
    providerId: requiredEnvironmentValue(env, "PROVIDER_ID"),
    modelId: requiredEnvironmentValue(env, "MODEL_ID"),
    thinkingMode: requiredEnvironmentValue(env, "THINKING_MODE"),
    timeoutMs: parseInteger(requiredEnvironmentValue(env, "TIMEOUT_MS")),
    transportRequested: requiredEnvironmentValue(env, "TRANSPORT_REQUESTED"),
    gatewayStarted: parseBoolean(requiredEnvironmentValue(env, "GATEWAY_STARTED")),
    gatewayEphemeralAuthenticationGenerated: parseBoolean(
      requiredEnvironmentValue(env, "GATEWAY_EPHEMERAL_AUTHENTICATION_GENERATED"),
    ),
    blueprintDigest: requiredEnvironmentValue(env, "BLUEPRINT_DIGEST"),
    runtimePlanDigest: requiredEnvironmentValue(env, "RUNTIME_PLAN_DIGEST"),
    runStateDigest: requiredEnvironmentValue(env, "RUN_STATE_DIGEST"),
    runReportDigest: requiredEnvironmentValue(env, "RUN_REPORT_DIGEST"),
    runEvalDigest: requiredEnvironmentValue(env, "RUN_EVAL_DIGEST"),
    statusDigest: requiredEnvironmentValue(env, "STATUS_DIGEST"),
    scrubReportDigest: requiredEnvironmentValue(env, "SCRUB_REPORT_DIGEST"),
    runEvalExitCode: parseInteger(requiredEnvironmentValue(env, "RUN_EVAL_EXIT")),
    statusExitCode: parseInteger(requiredEnvironmentValue(env, "STATUS_EXIT")),
  });
  await persistLiveSmokeCandidate(candidate, {
    subject: "live-smoke-summary",
    outputFile,
    stdout: true,
  });
}

function artifactReference(ref, digest) {
  return {
    ref,
    digest: digestValue(digest),
    hostPathPersisted: false,
  };
}

function fixedPresence(ref) {
  return {
    ref,
    present: true,
    hostPathPersisted: false,
  };
}

function exactInput(value, expectedKeys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw invalidInput();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw invalidInput();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")
    || keys.length !== expectedKeys.length
    || expectedKeys.some((key) => !keys.includes(key))) throw invalidInput();
  const copy = {};
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw invalidInput();
    copy[key] = descriptor.value;
  }
  return copy;
}

function validatedCandidate(candidate, subject) {
  assertPersistable(candidate, { subject });
  return deepFreeze(candidate);
}

function digestValue(value) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) throw invalidInput();
  return value;
}

function nonEmptyString(value) {
  if (typeof value !== "string" || value.trim().length === 0) throw invalidInput();
  return value;
}

function nonNegativeInteger(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw invalidInput();
  return value;
}

function booleanValue(value) {
  if (typeof value !== "boolean") throw invalidInput();
  return value;
}

function allowed(value, values) {
  if (typeof value !== "string" || !values.has(value)) throw invalidInput();
  return value;
}

function requiredEnvironmentValue(env, name) {
  const value = env[name];
  if (typeof value !== "string" || value.length === 0) throw invalidInput();
  return value;
}

function parseInteger(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw invalidInput();
  return parsed;
}

function parseBoolean(value) {
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw invalidInput();
}

function stdoutSink(text) {
  return new Promise((resolve, reject) => {
    process.stdout.write(text, (error) => (error ? reject(error) : resolve()));
  });
}

function invalidInput() {
  const error = new Error("Live-smoke summary input is invalid.");
  error.code = "AGENTMO_LIVE_SMOKE_SUMMARY_INVALID";
  return error;
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main(process.argv.slice(2), process.env);
}
