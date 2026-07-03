import { spawn } from "node:child_process";

export const MAX_CAPTURED_OUTPUT_LENGTH = 8000;
export const DEFAULT_RUNTIME_TIMEOUT_GRACE_MS = 1000;

export async function runRuntimeCommand(command, runtimeIdentity) {
  const started = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    const timeoutMs = Number.isInteger(command.timeoutMs) && command.timeoutMs > 0 ? command.timeoutMs : 120000;
    const child = spawn(command.executable, command.args, {
      cwd: command.cwd ?? process.cwd(),
      env: buildRuntimeCommandEnv(runtimeIdentity?.sandboxScope),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      const forceKill = setTimeout(() => {
        child.kill("SIGKILL");
      }, DEFAULT_RUNTIME_TIMEOUT_GRACE_MS);
      child.once("close", () => {
        clearTimeout(forceKill);
      });
      resolve({ exitCode: 124, stdout, stderr, timedOut: true, durationMs: Date.now() - started });
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
      resolve({ exitCode: 1, stdout, stderr: `${stderr}${error.message}`, timedOut: false, durationMs: Date.now() - started });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ exitCode: code ?? 1, stdout, stderr, timedOut: false, durationMs: Date.now() - started });
    });
  });
}

export function buildRuntimeCommandEnv(sandboxScope) {
  const env = {};
  if (process.env.PATH) env.PATH = process.env.PATH;
  if (sandboxScope?.stateDir) env.OPENCLAW_STATE_DIR = sandboxScope.stateDir;
  if (sandboxScope?.usesProductionState && process.env.HOME) env.HOME = process.env.HOME;
  return env;
}

function appendBounded(current, chunk) {
  if (current.length >= MAX_CAPTURED_OUTPUT_LENGTH) return current;
  const value = String(chunk);
  const available = MAX_CAPTURED_OUTPUT_LENGTH - current.length;
  return `${current}${value.slice(0, available)}`;
}
