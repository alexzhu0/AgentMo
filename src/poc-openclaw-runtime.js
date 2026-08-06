import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { connect, createServer } from "node:net";
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
const MIN_DASHBOARD_PORT = 1024;
const MAX_DASHBOARD_PORT = 65_535;

export function buildPocDashboardUrl({ agentId, port }) {
  assertPocDashboardIdentity({ agentId, port });
  const session = encodeURIComponent(`agent:${agentId}:main`);
  return `http://127.0.0.1:${port}/chat?session=${session}`;
}

export function buildPocDashboardCommands(options) {
  assertPocDashboardOptions(options);
  const workspace = path.resolve(options.workspace);
  const profileHome = path.resolve(options.profileHome);
  const env = {
    ...buildIsolatedEnvironment(profileHome, options.runtimeEnvValues),
    OPENCLAW_GATEWAY_TOKEN: options.gatewayToken,
  };
  const common = ["--profile", options.profile];
  const modelId = options.model.slice("deepseek/".length);
  return Object.freeze({
    trustPlugin: Object.freeze({
      executable: options.executable ?? "openclaw",
      args: [...common, "config", "set", "plugins.allow", "[\"deepseek\"]", "--strict-json"],
      cwd: workspace,
      env,
    }),
    configureProvider: Object.freeze({
      executable: options.executable ?? "openclaw",
      args: [
        ...common, "config", "set", "models.providers.deepseek.apiKey",
        "{\"source\":\"env\",\"provider\":\"default\",\"id\":\"DEEPSEEK_API_KEY\"}", "--strict-json",
      ],
      cwd: workspace,
      env,
    }),
    configureModels: Object.freeze({
      executable: options.executable ?? "openclaw",
      args: [
        ...common, "config", "set", "models.providers.deepseek.models",
        JSON.stringify([{ id: modelId, name: modelId }]), "--strict-json",
      ],
      cwd: workspace,
      env,
    }),
    install: Object.freeze({
      executable: options.executable ?? "openclaw",
      args: [...common, "plugins", "install", "@openclaw/deepseek-provider", "--pin"],
      cwd: workspace,
      env,
    }),
    register: Object.freeze({
      executable: options.executable ?? "openclaw",
      args: [
        ...common, "agents", "add", options.agentId,
        "--agent-dir", path.join(workspace, ".agentmo-agent"),
        "--workspace", workspace,
        "--model", options.model,
        "--non-interactive", "--json",
      ],
      cwd: workspace,
      env,
    }),
    gateway: Object.freeze({
      executable: options.executable ?? "openclaw",
      args: [
        ...common, "gateway", "run", "--port", String(options.port),
        "--bind", "loopback", "--auth", "token", "--allow-unconfigured",
      ],
      cwd: workspace,
      env,
    }),
  });
}

export function openPocDashboardUrl(url, options = {}) {
  let parsed;
  try { parsed = new URL(url); } catch { throw pocRuntimeError("AGENTMO_POC_DASHBOARD_URL_INVALID"); }
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1"
    || !isDashboardPort(Number(parsed.port)) || parsed.pathname !== "/chat"
    || !parsed.searchParams.get("session")?.startsWith("agent:")
    || !parsed.hash.startsWith("#token=") || parsed.hash.length <= "#token=".length) {
    throw pocRuntimeError("AGENTMO_POC_DASHBOARD_URL_INVALID");
  }
  const platform = options.platform ?? process.platform;
  const launch = options.spawnProcess ?? spawn;
  const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  return new Promise((resolve, reject) => {
    const child = launch(command, args, { shell: false, detached: true, stdio: "ignore" });
    child.once("error", () => reject(pocRuntimeError("AGENTMO_POC_DASHBOARD_BROWSER_UNAVAILABLE")));
    child.once("spawn", () => { child.unref(); resolve(); });
  });
}

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

export async function runPocOpenClawDashboard(options) {
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
  const port = options.port ?? 18_889;
  if (!isDashboardPort(port) || !SAFE_PROFILE.test(options.profile ?? "")
    || !SAFE_MODEL.test(options.model ?? "") || ["default", "main"].includes(options.profile)) {
    throw pocRuntimeError("AGENTMO_POC_DASHBOARD_INPUT_INVALID");
  }
  const checkPort = options.checkPort ?? isLoopbackPortAvailable;
  if (!await checkPort(port)) {
    throw pocRuntimeError("AGENTMO_POC_DASHBOARD_PORT_OCCUPIED", Object.freeze({
      operation: "port-check",
      exitCode: 1,
      summary: "The requested loopback port is already in use.",
    }));
  }
  const profileHome = path.join(workspace, ".agentmo-poc-home");
  await mkdir(profileHome, { recursive: true, mode: 0o700 });
  const gatewayToken = (options.gatewayTokenFactory ?? createGatewayToken)();
  const commands = buildPocDashboardCommands({
    ...options,
    workspace,
    profileHome,
    port,
    gatewayToken,
    agentId: workspaceCheck.agentId,
    runtimeEnvValues: runtimeEnv.values,
  });
  const runCommand = options.runCommand ?? executePocOpenClawCommand;
  await runDashboardSetupCommand("plugin-trust", commands.trustPlugin, runCommand, runtimeEnv.secretValues);
  await runDashboardSetupCommand("provider-config", commands.configureProvider, runCommand, runtimeEnv.secretValues);
  await runDashboardSetupCommand("model-catalog", commands.configureModels, runCommand, runtimeEnv.secretValues);
  await runDashboardSetupCommand("plugin-install", commands.install, runCommand, runtimeEnv.secretValues, isPinnedDeepSeekPluginAlreadyInstalled);
  await runDashboardSetupCommand("register", commands.register, runCommand, runtimeEnv.secretValues,
    (result) => isAlreadyRegistered(result, workspaceCheck.agentId));
  const dashboardUrl = buildPocDashboardUrl({ agentId: workspaceCheck.agentId, port });
  const readiness = Object.freeze({
    ok: true,
    agentId: workspaceCheck.agentId,
    profile: options.profile,
    model: options.model,
    port,
    dashboardUrl,
    runtime: "isolated-openclaw-dashboard",
    scheduleExecuted: false,
    deliveryExecuted: false,
  });
  const runGateway = options.runGateway ?? executePocGateway;
  const exitCode = await runGateway(commands.gateway, {
    port,
    onListening: async () => {
      await options.onReady?.(readiness);
      if (options.openDashboard) {
        const authenticatedUrl = `${dashboardUrl}#token=${encodeURIComponent(gatewayToken)}`;
        await options.openDashboard(authenticatedUrl);
      }
    },
  });
  if (exitCode !== 0) {
    throw pocRuntimeError("AGENTMO_POC_DASHBOARD_GATEWAY_FAILED", Object.freeze({
      operation: "gateway",
      exitCode: Number.isInteger(exitCode) ? exitCode : 1,
      summary: "The isolated OpenClaw Gateway exited before a normal shutdown.",
    }));
  }
  return Object.freeze({ ok: true, exitCode: 0, agentId: workspaceCheck.agentId });
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

function assertPocDashboardOptions(options) {
  if (options === null || typeof options !== "object"
    || typeof options.workspace !== "string"
    || typeof options.profileHome !== "string"
    || !SAFE_PROFILE.test(options.profile ?? "")
    || !SAFE_PROFILE.test(options.agentId ?? "")
    || !SAFE_MODEL.test(options.model ?? "")
    || !isDashboardPort(options.port)
    || typeof options.gatewayToken !== "string"
    || options.gatewayToken.length < 16
    || (options.executable !== undefined && (typeof options.executable !== "string" || options.executable.length === 0))) {
    throw pocRuntimeError("AGENTMO_POC_DASHBOARD_INPUT_INVALID");
  }
}

function assertPocDashboardIdentity({ agentId, port }) {
  if (!SAFE_PROFILE.test(agentId ?? "") || !isDashboardPort(port)) {
    throw pocRuntimeError("AGENTMO_POC_DASHBOARD_INPUT_INVALID");
  }
}

function isDashboardPort(value) {
  return Number.isInteger(value) && value >= MIN_DASHBOARD_PORT && value <= MAX_DASHBOARD_PORT;
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

async function runDashboardSetupCommand(operation, command, runCommand, secretValues, acceptedFailure = () => false) {
  const result = await runCommand(command);
  if (result.exitCode !== 0 && !acceptedFailure(result)) {
    throw pocRuntimeError("AGENTMO_POC_DASHBOARD_SETUP_FAILED", runtimeDiagnostic(operation, result, secretValues));
  }
}

function isLoopbackPortAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

function executePocGateway(command, { port, onListening }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.args, {
      cwd: command.cwd,
      env: command.env,
      shell: false,
      stdio: ["ignore", process.stderr, process.stderr],
    });
    let settled = false;
    const forward = (signal) => child.kill(signal);
    const cleanup = () => {
      process.removeListener("SIGINT", forward);
      process.removeListener("SIGTERM", forward);
    };
    process.once("SIGINT", forward);
    process.once("SIGTERM", forward);
    child.once("error", () => {
      cleanup();
      if (!settled) reject(pocRuntimeError("AGENTMO_POC_DASHBOARD_UNAVAILABLE"));
    });
    child.once("exit", (code, signal) => {
      cleanup();
      settled = true;
      resolve(signal === "SIGINT" || signal === "SIGTERM" ? 0 : (Number.isInteger(code) ? code : 1));
    });
    waitForLoopbackPort(port, () => settled)
      .then(async (ready) => {
        if (!ready || settled) return;
        await onListening();
      })
      .catch(() => {});
  });
}

async function waitForLoopbackPort(port, hasExited) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && !hasExited()) {
    if (await canConnectLoopback(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

function canConnectLoopback(port) {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.setTimeout(250);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => resolve(false));
  });
}

function createGatewayToken() {
  return randomBytes(32).toString("hex");
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
