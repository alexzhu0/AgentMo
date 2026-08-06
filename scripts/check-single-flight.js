import { spawn } from "node:child_process";
import { open, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function runExclusiveCheck(task, options = {}) {
  if (typeof task !== "function"
    || options === null
    || typeof options !== "object"
    || Array.isArray(options)
    || Object.keys(options).some((key) => key !== "lockPath")
    || (options.lockPath !== undefined && typeof options.lockPath !== "string")) {
    throw checkError("AGENTMO_CHECK_INPUT_INVALID");
  }
  const lockPath = options.lockPath ?? defaultLockPath();
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") throw checkError("AGENTMO_CHECK_ALREADY_RUNNING");
    throw checkError("AGENTMO_CHECK_LOCK_UNAVAILABLE");
  }
  try {
    return await task();
  } finally {
    await lock.close();
    await unlink(lockPath).catch(() => {});
  }
}

function defaultLockPath() {
  const workspaceId = createHash("sha256").update(process.cwd()).digest("hex").slice(0, 20);
  return path.join(os.tmpdir(), `agentmo-main-check-${workspaceId}.lock`);
}

function runMainTests() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--test"], {
      env: { ...process.env, AGENTMO_TEST_LANE: "main" },
      stdio: "inherit",
    });
    const forward = (signal) => child.kill(signal);
    process.once("SIGINT", forward);
    process.once("SIGTERM", forward);
    child.once("error", () => resolve(1));
    child.once("exit", (code) => resolve(Number.isInteger(code) ? code : 1));
  });
}

function checkError(code) {
  const error = new Error(code === "AGENTMO_CHECK_ALREADY_RUNNING"
    ? "Another AgentMo main test run already owns this workspace."
    : "AgentMo main test single-flight could not start.");
  error.name = "AgentMoCheckError";
  error.code = code;
  return error;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await runExclusiveCheck(runMainTests);
  } catch (error) {
    process.stderr.write(`${error?.code ?? "AGENTMO_CHECK_FAILED"}\n`);
    process.exitCode = 1;
  }
}
