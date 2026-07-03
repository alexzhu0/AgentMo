import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  executeRuntimeRun,
  loadRunIndex,
  loadRunState,
  RUN_INDEX_FILENAME,
  RUN_INDEX_SCHEMA_VERSION,
  RUN_STATE_FILENAME,
  RUN_STATE_SCHEMA_VERSION,
} from "../src/run-state.js";

async function loadExample() {
  return JSON.parse(await readFile(new URL("../examples/win9.agentmo.json", import.meta.url), "utf8"));
}

describe("run state", () => {
  it("writes non-live run-state and atomic run index", async () => {
    const blueprint = await loadExample();
    const out = await mkdtemp(path.join(tmpdir(), "agentmo-run-state-"));
    const { runState, stateFile, indexFile } = await executeRuntimeRun(blueprint, {
      target: "openclaw",
      workspace: "/tmp/workspace",
      message: "ping",
      out,
      runId: "run-001",
      now: "2026-07-03T00:00:00.000Z",
    });

    assert.equal(runState.schemaVersion, RUN_STATE_SCHEMA_VERSION);
    assert.equal(runState.runId, "run-001");
    assert.equal(runState.execution.executed, false);
    assert.equal(runState.execution.status, "declared");
    assert.equal(runState.runtimeIdentity.selector.executionSelector.sessionKey, "agentmo-win9-run-001");
    assert.equal(runState.runtimeIdentity.selector.executionSelector.generated, true);
    assert.equal(runState.command.args.includes("agentmo-win9-run-001"), true);
    assert.equal(runState.command.mutatesOpenClawState, false);
    assert.equal(runState.command.mutatesProductionOpenClawState, false);
    assert.equal(runState.command.mutatesIsolatedOpenClawState, false);
    assert.equal(runState.runtimeIdentity.sandboxScope.usesProductionState, false);
    assert.equal(runState.certificationBoundary.runEvidenceCertifiesRuntime, false);
    assert.equal(stateFile, path.join(out, "runs", "run-001", RUN_STATE_FILENAME));
    assert.equal(indexFile, path.join(out, RUN_INDEX_FILENAME));

    const loaded = await loadRunState(stateFile);
    assert.equal(loaded.runId, "run-001");
    const index = await loadRunIndex(out);
    assert.equal(index.schemaVersion, RUN_INDEX_SCHEMA_VERSION);
    assert.equal(index.latestRunId, "run-001");
    assert.equal(index.runs["run-001"].statePath, path.join("runs", "run-001", RUN_STATE_FILENAME));
  });

  it("generates distinct session keys for identical run inputs", async () => {
    const blueprint = await loadExample();
    const first = await executeRuntimeRun(blueprint, {
      target: "openclaw",
      workspace: "/tmp/workspace",
      message: "same",
      runId: "run-a",
      now: "2026-07-03T00:00:00.000Z",
    });
    const second = await executeRuntimeRun(blueprint, {
      target: "openclaw",
      workspace: "/tmp/workspace",
      message: "same",
      runId: "run-b",
      now: "2026-07-03T00:00:00.000Z",
    });

    assert.notEqual(
      first.runState.runtimeIdentity.selector.executionSelector.sessionKey,
      second.runState.runtimeIdentity.selector.executionSelector.sessionKey,
    );
  });

  it("records fake live runner success and redacts output", async () => {
    const blueprint = await loadExample();
    let observedStateDir = null;
    const { runState } = await executeRuntimeRun(
      blueprint,
      {
        target: "openclaw",
        workspace: "/tmp/workspace",
        openClawStateDir: "/tmp/openclaw-state",
        message: "ping",
        live: true,
        runId: "run-live",
        now: "2026-07-03T00:00:00.000Z",
      },
      async (_command, runtimeIdentity) => {
        observedStateDir = runtimeIdentity.sandboxScope.stateDir;
        return { exitCode: 0, stdout: "ok api_key=secret sk-abcdefghijklmnop", stderr: "", timedOut: false, durationMs: 12 };
      },
    );

    assert.equal(runState.execution.executed, true);
    assert.equal(runState.execution.status, "success");
    assert.equal(runState.execution.exitCode, 0);
    assert.equal(runState.command.mutatesOpenClawState, true);
    assert.equal(runState.command.mutatesProductionOpenClawState, false);
    assert.equal(runState.command.mutatesIsolatedOpenClawState, true);
    assert.equal(runState.runtimeIdentity.sandboxScope.stateDir, path.resolve("/tmp/openclaw-state"));
    assert.equal(observedStateDir, path.resolve("/tmp/openclaw-state"));
    assert.equal(runState.execution.stdout.preview.includes("secret"), false);
    assert.equal(runState.execution.stdout.preview.includes("[REDACTED_SECRET]"), true);
  });

  it("rejects live runs without explicit isolated or production OpenClaw state", async () => {
    const blueprint = await loadExample();
    await assert.rejects(
      () =>
        executeRuntimeRun(
          blueprint,
          {
            target: "openclaw",
            workspace: "/tmp/workspace",
            message: "ping",
            live: true,
            runId: "run-live-missing-state",
            now: "2026-07-03T00:00:00.000Z",
          },
          async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false, durationMs: 1 }),
        ),
      /Live OpenClaw runs require --openclaw-state-dir/u,
    );
  });

  it("records fake live runner failure without throwing", async () => {
    const blueprint = await loadExample();
    const { runState } = await executeRuntimeRun(
      blueprint,
      {
        target: "openclaw",
        workspace: "/tmp/workspace",
        openClawStateDir: "/tmp/openclaw-state",
        message: "ping",
        live: true,
        runId: "run-fail",
        now: "2026-07-03T00:00:00.000Z",
      },
      async () => ({ exitCode: 2, stdout: "", stderr: "bad", timedOut: false, durationMs: 4 }),
    );

    assert.equal(runState.execution.executed, true);
    assert.equal(runState.execution.status, "failure");
    assert.equal(runState.execution.exitCode, 2);
    assert.equal(runState.execution.stderr.preview, "bad");
  });

  it("materializes planned message files and redacts secret-like message evidence", async () => {
    const blueprint = await loadExample();
    const out = await mkdtemp(path.join(tmpdir(), "agentmo-run-message-"));
    const { runState } = await executeRuntimeRun(blueprint, {
      target: "openclaw",
      workspace: "/tmp/workspace",
      message: "line 1\napi_key=secret sk-abcdefghijklmnop",
      out,
      runId: "run-message",
      now: "2026-07-03T00:00:00.000Z",
    });

    assert.equal(runState.message.messageMode, "file");
    assert.equal(runState.message.messageFile.planned, false);
    assert.equal(runState.message.messageFile.digestVerified, true);
    assert.equal(runState.message.messageFile.path.startsWith(path.join(out, "messages")), true);
    assert.equal(runState.command.args.includes(runState.message.messageFile.path), true);
    assert.equal(runState.replay.replayFidelity, "exact");
    assert.match(await readFile(runState.message.messageFile.path, "utf8"), /api_key=secret/u);
    assert.equal(JSON.stringify(runState).includes("api_key=secret"), false);
    assert.equal(JSON.stringify(runState).includes("sk-abcdefghijklmnop"), false);
    assert.equal(runState.message.messagePreview.includes("[REDACTED_SECRET]"), true);
  });

  it("rejects malformed run-state and corrupt run index", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agentmo-run-corrupt-"));
    const statePath = path.join(dir, RUN_STATE_FILENAME);
    const indexPath = path.join(dir, RUN_INDEX_FILENAME);
    await writeFile(statePath, "{nope");
    await writeFile(indexPath, "{nope");
    await assert.rejects(() => loadRunState(statePath), /Invalid run-state JSON/u);
    await assert.rejects(() => loadRunIndex(dir), /Invalid run index JSON/u);
  });
});
