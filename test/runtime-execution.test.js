import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRuntimeCommandEnv, MAX_CAPTURED_OUTPUT_LENGTH, runRuntimeCommand } from "../src/runtime-execution.js";

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
  });
});
