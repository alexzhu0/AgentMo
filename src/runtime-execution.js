import { spawn } from "node:child_process";

export const MAX_CAPTURED_OUTPUT_LENGTH = 8000;
export const DEFAULT_RUNTIME_TIMEOUT_GRACE_MS = 1000;
const DETACHED_PROCESS_GROUP = process.platform !== "win32";
const PROXY_ENV_KEYS = new Set(["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"]);

export async function runRuntimeCommand(command, runtimeIdentity, options = {}) {
  const started = Date.now();
  const processGroupLivenessProbe = options.processGroupLivenessProbe ?? isProcessGroupAlive;
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let forceKill = null;
    let timeoutStartedAt = null;
    const timeoutMs = Number.isInteger(command.timeoutMs) && command.timeoutMs > 0 ? command.timeoutMs : 120000;
    const child = spawn(command.executable, command.args, {
      cwd: command.cwd ?? process.cwd(),
      env: buildRuntimeCommandEnv(runtimeIdentity?.sandboxScope, options.runtimeEnvValues),
      stdio: ["ignore", "pipe", "pipe"],
      detached: DETACHED_PROCESS_GROUP,
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      timeoutStartedAt = Date.now();
      terminateRuntimeChild(child, "SIGTERM");
      forceKill = setTimeout(() => {
        terminateRuntimeChild(child, "SIGKILL");
      }, DEFAULT_RUNTIME_TIMEOUT_GRACE_MS);
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendBounded(stderr, chunk);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      resolve({
        exitCode: timedOut ? 124 : 1,
        stdout,
        stderr: `${stderr}${error.message}`,
        timedOut,
        durationMs: Date.now() - started,
        processGroupClosed: timedOut ? false : null,
        processGroupCleanupFailed: timedOut,
      });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (!timedOut) {
        if (forceKill) clearTimeout(forceKill);
        resolve({
          exitCode: code ?? 1,
          stdout,
          stderr,
          timedOut: false,
          durationMs: Date.now() - started,
          processGroupClosed: null,
          processGroupCleanupFailed: false,
        });
        return;
      }
      waitForTimedOutProcessGroupExit(child.pid, timeoutStartedAt, processGroupLivenessProbe).then((processGroup) => {
        if (forceKill) clearTimeout(forceKill);
        resolve({
          exitCode: 124,
          stdout,
          stderr,
          timedOut: true,
          durationMs: Date.now() - started,
          processGroupClosed: processGroup.closed,
          processGroupCleanupFailed: !processGroup.closed,
          processGroupVerification: processGroup.verification,
        });
      });
    });
  });
}

function terminateRuntimeChild(child, signal) {
  if (DETACHED_PROCESS_GROUP && child.pid) {
    const groupSignaled = signalProcessGroup(child.pid, signal);
    if (groupSignaled) return;
  }
  signalChild(child, signal);
}

function signalProcessGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    return isNoSuchProcessError(error);
  }
}

async function waitForTimedOutProcessGroupExit(pid, timeoutStartedAt, isAlive) {
  if (!DETACHED_PROCESS_GROUP || !pid) {
    return { closed: false, verification: "unsupported-process-group" };
  }
  const graceDeadline = (timeoutStartedAt ?? Date.now()) + DEFAULT_RUNTIME_TIMEOUT_GRACE_MS + 50;
  while (Date.now() < graceDeadline) {
    await sleep(25);
  }
  if (!isAlive(pid)) return { closed: true, verification: "closed-after-sigterm-grace" };
  signalProcessGroup(pid, "SIGKILL");
  const killDeadline = Date.now() + 250;
  while (Date.now() < killDeadline) {
    if (!isAlive(pid)) return { closed: true, verification: "closed-after-sigkill-grace" };
    await sleep(25);
  }
  return { closed: false, verification: "still-alive-after-sigkill-grace" };
}

function isProcessGroupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return !isNoSuchProcessError(error);
  }
}

function signalChild(child, signal) {
  try {
    return child.kill(signal);
  } catch (error) {
    return isNoSuchProcessError(error);
  }
}

function isNoSuchProcessError(error) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ESRCH");
}

export function buildRuntimeCommandEnv(sandboxScope, runtimeEnvValues = {}) {
  const env = {};
  if (process.env.PATH) env.PATH = process.env.PATH;
  if (sandboxScope?.stateDir) env.OPENCLAW_STATE_DIR = sandboxScope.stateDir;
  if (sandboxScope?.usesProductionState && process.env.HOME) env.HOME = process.env.HOME;
  for (const key of sandboxScope?.environmentAllowlist ?? []) {
    if (key === "PATH" || key === "HOME" || key === "OPENCLAW_STATE_DIR") continue;
    if (typeof runtimeEnvValues[key] === "string") env[key] = runtimeEnvValues[key];
    else if (PROXY_ENV_KEYS.has(key) && typeof process.env[key] === "string") env[key] = process.env[key];
  }
  return env;
}

function appendBounded(current, chunk) {
  if (current.length >= MAX_CAPTURED_OUTPUT_LENGTH) return current;
  const value = String(chunk);
  const available = MAX_CAPTURED_OUTPUT_LENGTH - current.length;
  return `${current}${value.slice(0, available)}`;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
