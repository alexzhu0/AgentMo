import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildRuntimeCommandEnv, DEFAULT_RUNTIME_TIMEOUT_GRACE_MS, MAX_CAPTURED_OUTPUT_LENGTH, runRuntimeCommand } from "../src/runtime-execution.js";

describe("runtime execution adapter", () => {
  it("builds a constrained command environment from sandbox scope", () => {
    const isolated = buildRuntimeCommandEnv({ stateDir: "/tmp/openclaw-state", usesProductionState: false });
    assert.equal(isolated.OPENCLAW_STATE_DIR, "/tmp/openclaw-state");
    assert.equal("PATH" in isolated, Boolean(process.env.PATH));
    assert.equal("HOME" in isolated, false);

    const production = buildRuntimeCommandEnv({ usesProductionState: true });
    assert.equal("PATH" in production, Boolean(process.env.PATH));
    assert.equal("HOME" in production, Boolean(process.env.HOME));
    assert.equal("OPENCLAW_STATE_DIR" in production, false);

    const withRuntimeEnv = buildRuntimeCommandEnv(
      { environmentAllowlist: ["PATH", "DEEPSEEK_API_KEY"], usesProductionState: false },
      { DEEPSEEK_API_KEY: "deepseek-secret-value", OTHER_SECRET: "blocked" },
    );
    assert.equal(withRuntimeEnv.DEEPSEEK_API_KEY, "deepseek-secret-value");
    assert.equal("OTHER_SECRET" in withRuntimeEnv, false);

    const originalHttpsProxy = process.env.HTTPS_PROXY;
    process.env.HTTPS_PROXY = "http://127.0.0.1:7897";
    try {
      const withProxy = buildRuntimeCommandEnv({ environmentAllowlist: ["HTTPS_PROXY"], usesProductionState: false });
      assert.equal(withProxy.HTTPS_PROXY, "http://127.0.0.1:7897");
    } finally {
      if (originalHttpsProxy === undefined) delete process.env.HTTPS_PROXY;
      else process.env.HTTPS_PROXY = originalHttpsProxy;
    }
  });

  it("captures bounded command output", async () => {
    const result = await runRuntimeCommand(
      {
        executable: process.execPath,
        args: ["-e", `process.stdout.write("x".repeat(${MAX_CAPTURED_OUTPUT_LENGTH + 100}))`],
        timeoutMs: 5000,
      },
      { sandboxScope: { usesProductionState: false } },
    );

    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.length, MAX_CAPTURED_OUTPUT_LENGTH);
    assert.equal(result.timedOut, false);
  });

  it("times out long-running commands with exit code 124", async () => {
    const result = await runRuntimeCommand(
      {
        executable: process.execPath,
        args: ["-e", "setTimeout(() => {}, 5000)"],
        timeoutMs: 25,
      },
      { sandboxScope: { usesProductionState: false } },
    );

    assert.equal(result.exitCode, 124);
    assert.equal(result.timedOut, true);
    assert.equal(result.processGroupCleanupFailed, false);
  });

  it("terminates descendant processes when a command times out", { skip: process.platform === "win32" }, async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agentmo-runtime-timeout-"));
    const marker = path.join(dir, "descendant-survived.txt");
    const childScript = `
      const { spawn } = require("node:child_process");
      const marker = process.argv[1];
      spawn(process.execPath, ["-e", "setTimeout(() => require('node:fs').writeFileSync(process.argv[1], 'alive'), 300)", marker], { stdio: "ignore" });
      setTimeout(() => {}, 5000);
    `;

    const result = await runRuntimeCommand(
      {
        executable: process.execPath,
        args: ["-e", childScript, marker],
        timeoutMs: 25,
      },
      { sandboxScope: { usesProductionState: false } },
    );
    await new Promise((resolve) => {
      setTimeout(resolve, 500);
    });

    assert.equal(result.exitCode, 124);
    assert.equal(result.timedOut, true);
    assert.equal(result.processGroupClosed, true);
    await assert.rejects(() => access(marker));
  });

  it("waits for close after timeout before returning", { skip: process.platform === "win32" }, async () => {
    const result = await runRuntimeCommand(
      {
        executable: process.execPath,
        args: [
          "-e",
          `
            process.on("SIGTERM", () => {});
            setInterval(() => {}, 1000);
          `,
        ],
        timeoutMs: 25,
      },
      { sandboxScope: { usesProductionState: false } },
    );

    assert.equal(result.exitCode, 124);
    assert.equal(result.timedOut, true);
    assert.equal(result.processGroupClosed, true);
    assert.equal(result.durationMs >= DEFAULT_RUNTIME_TIMEOUT_GRACE_MS, true);
  });

  it("does not return before a SIGTERM-resistant descendant is force-killed", { skip: process.platform === "win32" }, async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agentmo-runtime-stubborn-descendant-"));
    const marker = path.join(dir, "stubborn-descendant-survived.txt");
    const childScript = `
      const { spawn } = require("node:child_process");
      const marker = process.argv[1];
      spawn(process.execPath, [
        "-e",
        "process.on('SIGTERM', () => {}); setTimeout(() => require('node:fs').writeFileSync(process.argv[1], 'alive'), 1200); setInterval(() => {}, 1000)",
        marker,
      ], { stdio: "ignore" });
      process.on("SIGTERM", () => process.exit(0));
      setInterval(() => {}, 1000);
    `;

    const result = await runRuntimeCommand(
      {
        executable: process.execPath,
        args: ["-e", childScript, marker],
        timeoutMs: 25,
      },
      { sandboxScope: { usesProductionState: false } },
    );
    await new Promise((resolve) => {
      setTimeout(resolve, 300);
    });

    assert.equal(result.exitCode, 124);
    assert.equal(result.timedOut, true);
    assert.equal(result.processGroupClosed, true);
    assert.equal(result.durationMs >= DEFAULT_RUNTIME_TIMEOUT_GRACE_MS, true);
    await assert.rejects(() => access(marker));
  });

  it("surfaces failed process-group cleanup evidence instead of silently passing", { skip: process.platform === "win32" }, async () => {
    const result = await runRuntimeCommand(
      {
        executable: process.execPath,
        args: [
          "-e",
          `
            process.on("SIGTERM", () => process.exit(0));
            setInterval(() => {}, 1000);
          `,
        ],
        timeoutMs: 25,
      },
      { sandboxScope: { usesProductionState: false } },
      {
        processGroupLivenessProbe: () => true,
      },
    );

    assert.equal(result.exitCode, 124);
    assert.equal(result.timedOut, true);
    assert.equal(result.processGroupClosed, false);
    assert.equal(result.processGroupCleanupFailed, true);
    assert.equal(result.processGroupVerification, "still-alive-after-sigkill-grace");
  });
});
