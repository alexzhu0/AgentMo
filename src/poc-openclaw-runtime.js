import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { checkPocWorkspace } from "./poc-agent.js";
import { assertRuntimeEnvReady, resolveRuntimeEnv } from "./runtime-env.js";
import { redactManagedText } from "./secret-redaction.js";

const SAFE_PROFILE = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const SAFE_MODEL = /^deepseek\/[a-z0-9][a-z0-9._-]{0,127}$/u;
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_OUTPUT_LENGTH = 16_000;
const MAX_CAPTURED_ENVELOPE_LENGTH = 256_000;
const MAX_DIAGNOSTIC_LENGTH = 800;

export function buildPocOpenClawCommands(options) {
  assertPocRuntimeOptions(options);
  const workspace = path.resolve(options.workspace);
  const profileHome = path.resolve(options.profileHome);
  const env = buildIsolatedEnvironment(profileHome, options.runtimeEnvValues);
  const common = ["--profile", options.profile];
  return Object.freeze({
    trustPlugin: Object.freeze({
      executable: options.executable ?? "openclaw",
      args: [
        ...common,
        "config", "set", "plugins.allow", "[\"deepseek\"]", "--strict-json",
      ],
      cwd: workspace,
      env,
    }),
    configureProvider: Object.freeze({
      executable: options.executable ?? "openclaw",
      args: [
        ...common,
        "config", "set", "models.providers.deepseek.apiKey",
        "{\"source\":\"env\",\"provider\":\"default\",\"id\":\"DEEPSEEK_API_KEY\"}", "--strict-json",
      ],
      cwd: workspace,
      env,
    }),
    install: Object.freeze({
      executable: options.executable ?? "openclaw",
      args: [
        ...common,
        "plugins", "install", "@openclaw/deepseek-provider", "--pin",
      ],
      cwd: workspace,
      env,
    }),
    register: Object.freeze({
      executable: options.executable ?? "openclaw",
      args: [
        ...common,
        "agents", "add", options.agentId,
        "--agent-dir", path.join(workspace, ".agentmo-agent"),
        "--workspace", workspace,
        "--model", options.model,
        "--non-interactive",
        "--json",
      ],
      cwd: workspace,
      env,
    }),
    invoke: Object.freeze({
      executable: options.executable ?? "openclaw",
      args: [
        ...common,
        "agent", "--local",
        "--agent", options.agentId,
        "--model", options.model,
        "--message", options.message,
        "--session-key", `agent:${options.agentId}:poc`,
        "--timeout", "120",
        "--json",
      ],
      cwd: workspace,
      env,
    }),
  });
}

export async function runPocOpenClaw(options) {
  const workspace = path.resolve(options.workspace);
  const workspaceCheck = await checkPocWorkspace(workspace);
  const runtimeEnvContent = await readRuntimeEnvFile(options.runtimeEnvFile);
  const runtimeEnv = resolveRuntimeEnv({
    envFile: options.runtimeEnvFile,
    envFileContent: runtimeEnvContent,
  });
  assertRuntimeEnvReady(runtimeEnv.descriptor, {
    live: true,
    provider: "deepseek",
    transport: "local",
  });
  const profileHome = path.join(workspace, ".agentmo-poc-home");
  await mkdir(profileHome, { recursive: true, mode: 0o700 });
  const commands = buildPocOpenClawCommands({
    ...options,
    workspace,
    profileHome,
    agentId: workspaceCheck.agentId,
    runtimeEnvValues: runtimeEnv.values,
  });
  const runCommand = options.runCommand ?? executePocOpenClawCommand;
  const trust = await runCommand(commands.trustPlugin);
  if (trust.exitCode !== 0) {
    throw pocRuntimeError("AGENTMO_POC_OPENCLAW_PLUGIN_TRUST_FAILED", runtimeDiagnostic("plugin-trust", trust, runtimeEnv.secretValues));
  }
  const providerConfig = await runCommand(commands.configureProvider);
  if (providerConfig.exitCode !== 0) {
    throw pocRuntimeError("AGENTMO_POC_OPENCLAW_PROVIDER_CONFIG_FAILED", runtimeDiagnostic("provider-config", providerConfig, runtimeEnv.secretValues));
  }
  const installation = await runCommand(commands.install);
  if (installation.exitCode !== 0 && !isPinnedDeepSeekPluginAlreadyInstalled(installation)) {
    throw pocRuntimeError("AGENTMO_POC_OPENCLAW_PLUGIN_INSTALL_FAILED", runtimeDiagnostic("plugin-install", installation, runtimeEnv.secretValues));
  }
  const registration = await runCommand(commands.register);
  if (registration.exitCode !== 0 && !isAlreadyRegistered(registration, workspaceCheck.agentId)) {
    throw pocRuntimeError("AGENTMO_POC_OPENCLAW_REGISTER_FAILED", runtimeDiagnostic("register", registration, runtimeEnv.secretValues));
  }
  const invocation = await runCommand(commands.invoke);
  if (invocation.exitCode !== 0) {
    throw pocRuntimeError("AGENTMO_POC_OPENCLAW_INVOKE_FAILED", runtimeDiagnostic("invoke", invocation, runtimeEnv.secretValues));
  }
  const rawReply = boundedCapturedEnvelope(invocation.stdout);
  if (rawReply.trim().length === 0) {
    throw pocRuntimeError("AGENTMO_POC_OPENCLAW_EMPTY_REPLY", Object.freeze({
      operation: "invoke",
      exitCode: 0,
      summary: "OpenClaw returned no answer bytes.",
    }));
  }
  const reply = redactManagedText(extractPocReply(rawReply), runtimeEnv.secretValues);
  return Object.freeze({
    ok: true,
    agentId: workspaceCheck.agentId,
    recordCount: workspaceCheck.recordCount,
    profile: options.profile,
    runtimeEnv: runtimeEnv.descriptor,
    reply,
    runtime: "local-openclaw",
    scheduleExecuted: false,
    deliveryExecuted: false,
  });
}

function assertPocRuntimeOptions(options) {
  if (options === null || typeof options !== "object"
    || typeof options.workspace !== "string"
    || typeof options.profileHome !== "string"
    || !SAFE_PROFILE.test(options.profile ?? "")
    || !SAFE_PROFILE.test(options.agentId ?? "")
    || !SAFE_MODEL.test(options.model ?? "")
    || typeof options.message !== "string"
    || options.message.trim().length === 0
    || options.message.length > MAX_MESSAGE_LENGTH
    || (options.executable !== undefined && (typeof options.executable !== "string" || options.executable.length === 0))) {
    throw pocRuntimeError("AGENTMO_POC_RUNTIME_INPUT_INVALID");
  }
}

function buildIsolatedEnvironment(profileHome, runtimeEnvValues) {
  const env = { HOME: profileHome };
  if (process.env.PATH) env.PATH = process.env.PATH;
  for (const [key, value] of Object.entries(runtimeEnvValues ?? {})) {
    if (typeof value === "string") env[key] = value;
  }
  return Object.freeze(env);
}

async function readRuntimeEnvFile(filePath) {
  if (typeof filePath !== "string" || filePath.trim().length === 0) {
    throw pocRuntimeError("AGENTMO_POC_RUNTIME_ENV_REQUIRED");
  }
  try {
    return await readFile(filePath, "utf8");
  } catch {
    throw pocRuntimeError("AGENTMO_POC_RUNTIME_ENV_UNAVAILABLE");
  }
}

function executePocOpenClawCommand(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.args, {
      cwd: command.cwd,
      env: command.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout = boundedCapturedEnvelope(`${stdout}${chunk}`); });
    child.stderr.on("data", (chunk) => { stderr = boundedText(`${stderr}${chunk}`); });
    child.once("error", () => reject(pocRuntimeError("AGENTMO_POC_OPENCLAW_UNAVAILABLE")));
    child.once("close", (exitCode) => resolve({ exitCode: exitCode ?? 1, stdout, stderr }));
  });
}

function boundedText(value) {
  return String(value).slice(0, MAX_OUTPUT_LENGTH);
}

function boundedCapturedEnvelope(value) {
  return String(value).slice(0, MAX_CAPTURED_ENVELOPE_LENGTH);
}

function extractPocReply(raw) {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw pocRuntimeError("AGENTMO_POC_OPENCLAW_OUTPUT_INVALID", Object.freeze({
      operation: "invoke",
      exitCode: 0,
      summary: "OpenClaw returned non-JSON output.",
    }));
  }
  try {
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)
      || !Array.isArray(payload.payloads)) throw new Error("invalid response");
    const texts = payload.payloads
      .slice(0, 8)
      .map((entry) => (entry !== null && typeof entry === "object" && !Array.isArray(entry) && typeof entry.text === "string" ? entry.text : ""))
      .filter((text) => text.trim().length > 0);
    if (texts.length === 0) throw new Error("missing text");
    return boundedText(texts.join("\n\n"));
  } catch {
    throw pocRuntimeError("AGENTMO_POC_OPENCLAW_OUTPUT_INVALID", Object.freeze({
      operation: "invoke",
      exitCode: 0,
      summary: outputShapeSummary(payload),
    }));
  }
}

function outputShapeSummary(payload) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return "OpenClaw returned no usable text payload.";
  }
  const keys = Object.keys(payload)
    .filter((key) => /^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(key))
    .sort()
    .slice(0, 8);
  return keys.length === 0
    ? "OpenClaw returned no usable text payload."
    : `OpenClaw returned no usable text payload (keys: ${keys.join(",")}).`;
}

function runtimeDiagnostic(operation, result, secretValues) {
  return Object.freeze({
    operation,
    exitCode: Number.isInteger(result?.exitCode) ? result.exitCode : 1,
    summary: redactManagedText(boundedText(result?.stderr ?? ""), secretValues).slice(0, MAX_DIAGNOSTIC_LENGTH),
  });
}

function isAlreadyRegistered(result, agentId) {
  const escapedAgentId = agentId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return result?.exitCode === 1
    && new RegExp(`^Agent "${escapedAgentId}" already exists\\. Run openclaw --profile [a-z0-9-]{1,64} agents list to inspect configured agents\\.\\s*$`, "u").test(result?.stderr ?? "");
}

function isPinnedDeepSeekPluginAlreadyInstalled(result) {
  return result?.exitCode === 1
    && /^plugin already exists: .+ \(delete it first\)\nUse `openclaw plugins update <id-or-npm-spec>` to upgrade the tracked plugin, or rerun install with `--force` to replace it\.\n?$/u.test(result?.stderr ?? "");
}

function pocRuntimeError(code, pocDiagnostic = undefined) {
  const error = new Error("AgentMo POC OpenClaw operation was rejected.");
  error.code = code;
  if (pocDiagnostic !== undefined) error.pocDiagnostic = pocDiagnostic;
  return error;
}
