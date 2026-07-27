import { spawn } from "node:child_process";
import { assertBuilderPlatform } from "./builder-platform.js";
import { assertBuilderAdapter } from "./builders/registry.js";

const MAX_CAPTURE_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;
const TERMINATION_GRACE_MS = 250;

const CODEX_READ_COMMANDS = Object.freeze([
  Object.freeze({ id: "version", args: Object.freeze(["--version"]) }),
  Object.freeze({ id: "features", args: Object.freeze(["features", "list"]) }),
  Object.freeze({ id: "plugin-help", args: Object.freeze(["plugin", "--help"]) }),
  Object.freeze({ id: "resume-help", args: Object.freeze(["resume", "--help"]) }),
  Object.freeze({ id: "doctor-help", args: Object.freeze(["doctor", "--help"]) }),
]);

export async function probeBuilderAdapter(options = {}) {
  assertBuilderPlatform();
  const adapter = assertBuilderAdapter(options.adapterId ?? "codex");
  const execute = options.execute ?? executeCodexReadCommand;
  const executions = new Map();

  for (const command of CODEX_READ_COMMANDS) {
    let raw;
    try {
      raw = await execute("codex", [...command.args], {
        maxBytes: MAX_CAPTURE_BYTES,
        timeoutMs: DEFAULT_TIMEOUT_MS,
      });
    } catch (error) {
      raw = { ok: false, failure: classifyExecutionFailure(error) };
    }
    executions.set(command.id, normalizeExecution(raw));
  }

  const version = parseCodexVersion(executions.get("version"));
  const features = parseFeatureList(executions.get("features"));
  const observations = adapter.capabilities.map((capability) =>
    observeCapability(capability, { executions, features, version }),
  );
  const missing = observations
    .filter((item) => item.requirement === "required" && item.status === "missing")
    .map((item) => item.id);
  const incompatible = observations
    .filter((item) => item.requirement === "required" && item.status === "incompatible")
    .map((item) => item.id);
  const degraded = observations
    .filter((item) => item.status === "degraded")
    .map((item) => item.id);
  const requiredOk = missing.length === 0 && incompatible.length === 0;

  return {
    schemaVersion: "agentmo.builder-probe.v1",
    adapter: {
      id: adapter.id,
      label: adapter.label,
      contractVersion: adapter.contractVersion,
      supportDeclaration: adapter.supportDeclaration,
      supportClaim: false,
    },
    host: {
      command: "codex",
      version,
      versionBasis: "codex --version",
    },
    // A PATH-selected external command cannot prove that it left unrelated
    // host state untouched, even when AgentMo supplies only observational argv.
    mutatesHost: "unknown",
    externalCommandMutation: "unknown",
    observations,
    required: {
      ok: requiredOk,
      missing,
      incompatible,
    },
    optional: { degraded },
    support: {
      status: requiredOk ? "observed-compatible" : "unsupported",
      evidenceLevel: "observed",
      claim: false,
      domainQualityCertified: false,
    },
    probeBasis: CODEX_READ_COMMANDS.map((command) => `codex ${command.args.join(" ")}`),
  };
}

export async function executeCodexReadCommand(command, args, options = {}) {
  assertBuilderPlatform();
  if (command !== "codex" || !isAllowedArgs(args)) {
    return { ok: false, failure: "command-not-allowed" };
  }
  const result = await runBoundedCodexCommand({
    command,
    args,
    env: minimalCodexProbeEnvironment(),
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBytes: options.maxBytes ?? MAX_CAPTURE_BYTES,
  });
  return {
    ok: result.ok,
    code: result.code,
    stdout: boundText(result.stdout, options.maxBytes),
    ...(result.ok ? {} : { failure: result.failure }),
  };
}

function runBoundedCodexCommand({ command, args, env, timeoutMs, maxBytes }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        env,
        shell: false,
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
        // Builder runs only on POSIX hosts.  Make the direct child the group
        // leader so a PATH-selected command cannot leave a stdio-holding
        // daemon behind after its direct PID has exited.
        detached: true,
      });
    } catch (error) {
      resolve({
        ok: false,
        code: Number.isInteger(error?.code) ? error.code : null,
        stdout: "",
        failure: classifyExecutionFailure(error),
      });
      return;
    }

    const chunks = [];
    let stdoutBytes = 0;
    let terminal = null;
    let directClosed = false;
    let settled = false;
    let deadline = null;
    let deadlineSettlementGrace = null;
    const deadlineAt = performance.now() + timeoutMs;
    const destroyChildStreams = () => {
      child.stdout?.destroy();
    };
    const lifecycle = createIsolatedProcessGroup(child, TERMINATION_GRACE_MS, () => {
      destroyChildStreams();
    });
    const capturedStdout = () => Buffer.concat(chunks).toString("utf8");
    const requestTermination = (outcome) => {
      if (terminal !== null || settled) return;
      terminal = outcome;
      lifecycle.requestShutdown();
    };
    const settleAfterReap = (code) => {
      if (settled) return;
      if (terminal === null && performance.now() >= deadlineAt) {
        terminal = { ok: false, code: null, failure: "timeout" };
      }
      settled = true;
      if (deadline !== null) clearTimeout(deadline);
      if (deadlineSettlementGrace !== null) clearTimeout(deadlineSettlementGrace);
      lifecycle.dispose();
      const stdout = terminal === null ? capturedStdout() : "";
      if (terminal !== null) {
        resolve({ ...terminal, stdout });
      } else if (code === 0) {
        resolve({ ok: true, code: 0, stdout, failure: null });
      } else {
        resolve({ ok: false, code: Number.isInteger(code) ? code : null, stdout, failure: "command-failed" });
      }
    };
    const waitForDirectCloseAndGroupReap = (code) => {
      lifecycle.waitForDeath().then(() => settleAfterReap(code));
    };

    child.once("error", (error) => {
      requestTermination({
        ok: false,
        code: Number.isInteger(error?.code) ? error.code : null,
        failure: classifyExecutionFailure(error),
      });
      if (child.pid === undefined) waitForDirectCloseAndGroupReap(null);
    });
    child.once("exit", () => {
      // A direct child may exit successfully after daemonizing a descendant.
      // Always retire its isolated group before accepting that exit.
      if (terminal === null && lifecycle.requestShutdown()) {
        terminal = { ok: false, code: null, failure: "command-failed" };
      }
    });
    child.once("close", (code) => {
      if (directClosed) return;
      directClosed = true;
      lifecycle.requestShutdown();
      waitForDirectCloseAndGroupReap(code);
    });
    child.stdout.on("error", () => requestTermination({
      ok: false,
      code: null,
      failure: "command-failed",
    }));
    child.stdout.on("data", (chunk) => {
      if (terminal !== null) return;
      const bytes = Buffer.from(chunk);
      stdoutBytes += bytes.byteLength;
      if (stdoutBytes > maxBytes) {
        requestTermination({ ok: false, code: null, failure: "output-too-large" });
        return;
      }
      chunks.push(bytes);
    });
    deadline = setTimeout(() => {
      if (settled) return;
      if (terminal === null) {
        terminal = { ok: false, code: null, failure: "timeout" };
      }
      lifecycle.requestShutdown();
      // A malicious PATH-shadow process can escape the original process group
      // while retaining stdout.  Closing our read end is the bounded final
      // settlement path; it cannot grant that escaped process authority.
      destroyChildStreams();
      child.unref();
      // Group reaping is best-effort.  A hostile command can escape its
      // process group (or become uninterruptible), so an unavailable group
      // must not turn this public deadline into an unbounded wait.
      deadlineSettlementGrace = setTimeout(
        () => settleAfterReap(null),
        TERMINATION_GRACE_MS * 2,
      );
      lifecycle.waitForDeath().then(() => settleAfterReap(null));
    }, timeoutMs);
  });
}

function createIsolatedProcessGroup(child, graceMs, destroyStreams) {
  const processGroupId = Number.isSafeInteger(child.pid) && child.pid > 0 ? child.pid : null;
  let shutdownRequested = false;
  let confirmedDead = processGroupId === null;
  let forceKillTimer = null;
  let pollTimer = null;
  const waiters = [];
  const groupIsDead = () => {
    if (confirmedDead) return true;
    try {
      process.kill(-processGroupId, 0);
      return false;
    } catch (error) {
      if (error?.code === "ESRCH") {
        confirmedDead = true;
        return true;
      }
      return false;
    }
  };
  const signalGroup = (signal) => {
    if (processGroupId === null || groupIsDead()) return;
    try {
      process.kill(-processGroupId, signal);
    } catch {
      // Liveness is proved separately before the caller settles.
    }
  };
  const resolveWhenDead = () => {
    if (!groupIsDead()) return false;
    if (forceKillTimer !== null) clearTimeout(forceKillTimer);
    if (pollTimer !== null) clearTimeout(pollTimer);
    forceKillTimer = null;
    pollTimer = null;
    for (const resolve of waiters.splice(0)) resolve();
    return true;
  };
  const pollForDeath = () => {
    if (resolveWhenDead() || pollTimer !== null) return;
    pollTimer = setTimeout(() => {
      pollTimer = null;
      pollForDeath();
    }, 10);
  };
  return {
    requestShutdown() {
      if (shutdownRequested) return !confirmedDead;
      shutdownRequested = true;
      if (resolveWhenDead()) return false;
      signalGroup("SIGTERM");
      forceKillTimer = setTimeout(() => {
        if (!groupIsDead()) {
          signalGroup("SIGKILL");
          try {
            destroyStreams();
          } catch {
            // The liveness probe remains the final authority.
          }
        }
        pollForDeath();
      }, graceMs);
      pollForDeath();
      return true;
    },
    waitForDeath() {
      if (resolveWhenDead()) return Promise.resolve();
      return new Promise((resolve) => {
        waiters.push(resolve);
        pollForDeath();
      });
    },
    dispose() {
      if (forceKillTimer !== null) clearTimeout(forceKillTimer);
      if (pollTimer !== null) clearTimeout(pollTimer);
      forceKillTimer = null;
      pollTimer = null;
    },
  };
}

function minimalCodexProbeEnvironment() {
  const env = Object.create(null);
  for (const name of [
    "PATH", "HOME", "CODEX_HOME", "LANG", "LC_ALL", "TMPDIR", "TERM", "SystemRoot",
  ]) {
    if (typeof process.env[name] === "string") env[name] = process.env[name];
  }
  return env;
}

function observeCapability(capability, context) {
  const probe = capability.probe;
  let observed = false;
  let explicitlyIncompatible = false;
  let basis = null;

  if (probe.kind === "version") {
    observed = context.version !== null;
    basis = "codex --version";
  } else if (probe.kind === "feature") {
    observed = context.features.get(probe.feature) === true;
    explicitlyIncompatible = context.features.get(probe.feature) === false;
    basis = `codex features list:${probe.feature}`;
  } else if (probe.kind === "help") {
    observed = context.executions.get(probe.command)?.ok === true;
    basis = commandBasis(probe.command);
  } else if (probe.kind === "feature-and-help") {
    const feature = context.features.get(probe.feature);
    observed = feature === true && context.executions.get(probe.command)?.ok === true;
    explicitlyIncompatible = feature === false;
    basis = `codex features list:${probe.feature} + ${commandBasis(probe.command)}`;
  }

  let status = observed ? "observed" : explicitlyIncompatible ? "incompatible" : "missing";
  if (!observed && capability.requirement === "optional") status = "degraded";
  return {
    id: capability.id,
    requirement: capability.requirement,
    status,
    basis,
    ...(status === "degraded" ? { fallback: { ...capability.fallback } } : {}),
  };
}

function parseCodexVersion(execution) {
  if (!execution?.ok) return null;
  const match = execution.stdout.match(/\bcodex(?:-cli)?\s+v?([0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?)\b/u);
  return match?.[1] ?? null;
}

function parseFeatureList(execution) {
  const features = new Map();
  if (!execution?.ok) return features;
  for (const line of execution.stdout.split(/\r?\n/u)) {
    const match = line.trim().match(/^([a-z][a-z0-9_-]*)\s+\S+\s+(true|false)$/u);
    if (match) features.set(match[1], match[2] === "true");
  }
  return features;
}

function normalizeExecution(raw) {
  return {
    ok: raw?.ok === true,
    code: Number.isInteger(raw?.code) ? raw.code : raw?.ok === true ? 0 : null,
    stdout: boundText(raw?.stdout),
    failure: raw?.ok === true ? null : normalizeFailure(raw?.failure),
  };
}

function normalizeFailure(value) {
  return ["not-found", "timeout", "output-too-large", "command-failed", "command-not-allowed"]
    .includes(value)
    ? value
    : "command-failed";
}

function classifyExecutionFailure(error) {
  if (error?.code === "ENOENT") return "not-found";
  if (error?.code === "ETIMEDOUT" || error?.killed === true) return "timeout";
  if (error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return "output-too-large";
  return "command-failed";
}

function boundText(value, maxBytes = MAX_CAPTURE_BYTES) {
  if (typeof value !== "string") return "";
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= maxBytes) return value;
  return bytes.subarray(0, maxBytes).toString("utf8");
}

function isAllowedArgs(args) {
  return CODEX_READ_COMMANDS.some((command) =>
    command.args.length === args.length && command.args.every((arg, index) => arg === args[index]),
  );
}

function commandBasis(commandId) {
  const command = CODEX_READ_COMMANDS.find((item) => item.id === commandId);
  return command ? `codex ${command.args.join(" ")}` : "unknown";
}
