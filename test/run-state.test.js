import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildRunEval,
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
    let observedDeepSeekKey = null;
    const { runState } = await executeRuntimeRun(
      blueprint,
      {
        target: "openclaw",
        workspace: "/tmp/workspace",
        openClawStateDir: "/tmp/openclaw-state",
        provider: "deepseek",
        transport: "local",
        envFile: "/tmp/agentmo/.env",
        envFileContent: "DEEPSEEK_API_KEY=deepseek-secret-value\nDEEPSEEK_BASE_URL=https://api.deepseek.com\n",
        message: "ping",
        live: true,
        runId: "run-live",
        now: "2026-07-03T00:00:00.000Z",
      },
      async (_command, runtimeIdentity, options) => {
        observedStateDir = runtimeIdentity.sandboxScope.stateDir;
        observedDeepSeekKey = options.runtimeEnvValues.DEEPSEEK_API_KEY;
        return {
          exitCode: 0,
          stdout: 'ok api_key=secret {"token":"deepseek-secret-value"} sk-abcdefghijklmnop',
          stderr: "",
          timedOut: false,
          durationMs: 12,
        };
      },
    );

    assert.equal(runState.execution.executed, true);
    assert.equal(runState.execution.status, "success");
    assert.equal(runState.execution.exitCode, 0);
    assert.equal(runState.command.mutatesOpenClawState, true);
    assert.equal(runState.command.mutatesProductionOpenClawState, false);
    assert.equal(runState.command.mutatesIsolatedOpenClawState, true);
    assert.equal(runState.runtimeIdentity.sandboxScope.stateDir, path.resolve("/tmp/openclaw-state"));
    assert.equal(runState.runtimeIdentity.runtimeEnv.envFile.basename, ".env");
    assert.deepEqual(runState.runtimeIdentity.runtimeEnv.presentKeys, ["DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL"]);
    assert.equal(observedStateDir, path.resolve("/tmp/openclaw-state"));
    assert.equal(observedDeepSeekKey, "deepseek-secret-value");
    assert.equal(runState.execution.stdout.preview.includes("secret"), false);
    assert.equal(runState.execution.stdout.preview.includes("[REDACTED_SECRET]"), true);
    assert.equal(runState.evidence.rawOutputPreviewStored, true);
    assert.equal(runState.evidence.rawTranscriptStored, true);
    assert.equal(JSON.stringify(runState).includes("deepseek-secret-value"), false);
    assert.equal(JSON.stringify(runState).includes("/tmp/agentmo/.env"), false);
  });

  it("fails run-eval closed when raw runtime output previews are stored", async () => {
    const blueprint = await loadExample();
    const { runState } = await executeRuntimeRun(
      blueprint,
      {
        target: "openclaw",
        workspace: "/tmp/workspace",
        openClawStateDir: "/tmp/openclaw-state",
        message: "ping",
        live: true,
        runId: "run-live-raw-output",
        now: "2026-07-03T00:00:00.000Z",
      },
      async () => ({ exitCode: 0, stdout: "ok", stderr: "", timedOut: false, durationMs: 1 }),
    );

    const evaluation = buildRunEval(runState, { expectStatus: "success" });
    assert.equal(runState.evidence.rawOutputPreviewStored, true);
    assert.equal(evaluation.ok, false);
    assert.equal(evaluation.checks.find((check) => check.id === "raw_output_preview_absent").pass, false);
  });

  it("derives raw-output eval failures from execution even when evidence claims otherwise", async () => {
    const blueprint = await loadExample();
    const { runState } = await executeRuntimeRun(
      blueprint,
      {
        target: "openclaw",
        workspace: "/tmp/workspace",
        openClawStateDir: "/tmp/openclaw-state",
        message: "ping",
        live: true,
        runId: "run-live-tampered-evidence",
        now: "2026-07-03T00:00:00.000Z",
      },
      async () => ({ exitCode: 0, stdout: "raw diagnostics", stderr: "", timedOut: false, durationMs: 1 }),
    );
    runState.evidence.stdoutPreviewStored = false;
    runState.evidence.rawOutputPreviewStored = false;
    runState.evidence.rawTranscriptStored = false;
    runState.evidence.rawToolBodiesStored = false;

    const evaluation = buildRunEval(runState, { expectStatus: "success" });
    assert.equal(evaluation.ok, false);
    assert.equal(evaluation.checks.find((check) => check.id === "raw_output_flags_consistent").pass, false);
    assert.equal(evaluation.checks.find((check) => check.id === "raw_output_preview_absent").pass, false);
  });

  it("fails run-eval closed when evidence summary stores raw output despite false flags", async () => {
    const blueprint = await loadExample();
    const { runState } = await executeRuntimeRun(
      blueprint,
      {
        target: "openclaw",
        workspace: "/tmp/workspace",
        openClawStateDir: "/tmp/openclaw-state",
        message: "ping",
        live: true,
        runId: "run-live-tampered-summary-evidence",
        now: "2026-07-03T00:00:00.000Z",
      },
      async () => ({
        exitCode: 0,
        stdout: JSON.stringify({ status: "ok", payloads: [], meta: { transport: "local" } }),
        stderr: "",
        timedOut: false,
        durationMs: 1,
      }),
    );
    runState.evidence.stdoutSummaryKind = "raw-output-preview";
    runState.evidence.stdoutSummary = "raw diagnostics";
    runState.evidence.stdoutPreviewStored = false;
    runState.evidence.rawOutputPreviewStored = false;
    runState.evidence.rawTranscriptStored = false;
    runState.evidence.rawToolBodiesStored = false;

    const evaluation = buildRunEval(runState, { expectStatus: "success" });
    assert.equal(runState.execution.stdout.summaryKind, "structured-json-summary");
    assert.equal(evaluation.ok, false);
    assert.equal(evaluation.checks.find((check) => check.id === "raw_output_flags_consistent").pass, false);
    assert.equal(evaluation.checks.find((check) => check.id === "raw_output_preview_absent").pass, false);
  });

  it("treats mixed raw output plus JSON as raw output evidence", async () => {
    const blueprint = await loadExample();
    const { runState } = await executeRuntimeRun(
      blueprint,
      {
        target: "openclaw",
        workspace: "/tmp/workspace",
        openClawStateDir: "/tmp/openclaw-state",
        message: "ping",
        live: true,
        runId: "run-live-mixed-json",
        now: "2026-07-03T00:00:00.000Z",
      },
      async () => ({
        exitCode: 0,
        stdout: `raw diagnostic api_key=secret-value-123456\n${JSON.stringify({ status: "ok", payloads: [], meta: { transport: "local" } })}`,
        stderr: "",
        timedOut: false,
        durationMs: 1,
      }),
    );

    const evaluation = buildRunEval(runState, { expectStatus: "success" });
    assert.equal(runState.execution.stdout.summaryKind, "raw-output-preview");
    assert.equal(runState.evidence.rawOutputPreviewStored, true);
    assert.equal(evaluation.ok, false);
    assert.equal(evaluation.checks.find((check) => check.id === "raw_output_preview_absent").pass, false);
    assert.equal(JSON.stringify(runState).includes("secret-value-123456"), false);
  });

  it("does not treat arbitrary JSON stdout as structured OpenClaw evidence", async () => {
    const blueprint = await loadExample();
    const { runState } = await executeRuntimeRun(
      blueprint,
      {
        target: "openclaw",
        workspace: "/tmp/workspace",
        openClawStateDir: "/tmp/openclaw-state",
        message: "ping",
        live: true,
        runId: "run-live-arbitrary-json",
        now: "2026-07-03T00:00:00.000Z",
      },
      async () => ({ exitCode: 0, stdout: JSON.stringify({ foo: "bar" }), stderr: "", timedOut: false, durationMs: 1 }),
    );

    const evaluation = buildRunEval(runState, { expectStatus: "success" });
    assert.equal(runState.execution.stdout.summaryKind, "raw-output-preview");
    assert.equal(evaluation.ok, false);
  });

  it("rejects generic status JSON with empty meta or result as raw output evidence", async () => {
    const blueprint = await loadExample();
    const genericOutputs = [
      { runId: "run-live-generic-empty-meta", output: { ok: true, meta: {} } },
      { runId: "run-live-generic-empty-result", output: { status: "ok", result: {} } },
      { runId: "run-live-generic-ok-transport-meta", output: { ok: true, meta: { transport: "local" } } },
      { runId: "run-live-generic-status-transport-meta", output: { status: "ok", meta: { transport: "local" } } },
      { runId: "run-live-generic-status-fallback-from-meta", output: { status: "ok", meta: { fallbackFrom: "gateway" } } },
      { runId: "run-live-generic-result-fallback-from-meta", output: { status: "ok", result: { status: "ok", meta: { fallbackFrom: "gateway" } } } },
    ];

    for (const genericOutput of genericOutputs) {
      const { runState } = await executeRuntimeRun(
        blueprint,
        {
          target: "openclaw",
          workspace: "/tmp/workspace",
          openClawStateDir: "/tmp/openclaw-state",
          message: "ping",
          live: true,
          runId: genericOutput.runId,
          now: "2026-07-03T00:00:00.000Z",
        },
        async () => ({ exitCode: 0, stdout: JSON.stringify(genericOutput.output), stderr: "", timedOut: false, durationMs: 1 }),
      );

      const evaluation = buildRunEval(runState, { expectStatus: "success" });
      assert.equal(runState.execution.stdout.summaryKind, "raw-output-preview");
      assert.equal(runState.evidence.rawOutputPreviewStored, true);
      assert.equal(runState.runtimeIdentity.transport, "unknown");
      assert.equal(runState.runtimeIdentity.fallbackFrom, null);
      assert.equal(runState.runtimeIdentity.fallbackEvidence.detected, false);
      assert.equal(runState.runtimeIdentity.fallbackEvidence.detectionMethod, "planned");
      assert.equal(runState.runtimeIdentity.fallbackEvidence.structured, false);
      assert.equal(evaluation.ok, false);
      assert.equal(evaluation.checks.find((check) => check.id === "raw_output_preview_absent").pass, false);
    }
  });

  it("fails run-eval closed when live provider env descriptor is missing", async () => {
    const blueprint = await loadExample();
    const { runState } = await executeRuntimeRun(
      blueprint,
      {
        target: "openclaw",
        workspace: "/tmp/workspace",
        openClawStateDir: "/tmp/openclaw-state",
        provider: "deepseek",
        envFile: "/tmp/agentmo/.env",
        envFileContent: "DEEPSEEK_API_KEY=deepseek-secret-value\n",
        message: "ping",
        live: true,
        runId: "run-live-missing-env-eval",
        now: "2026-07-03T00:00:00.000Z",
      },
      async () => ({ exitCode: 0, stdout: JSON.stringify({ status: "ok", payloads: [], meta: { transport: "local" } }), stderr: "", timedOut: false, durationMs: 1 }),
    );
    runState.runtimeIdentity.runtimeEnv = null;

    const evaluation = buildRunEval(runState, { expectStatus: "success" });
    assert.equal(evaluation.ok, false);
    assert.equal(evaluation.checks.find((check) => check.id === "runtime_env_ready").pass, false);
  });

  it("fails run-eval closed when timeout cleanup cannot prove process-group closure", async () => {
    const blueprint = await loadExample();
    const { runState } = await executeRuntimeRun(
      blueprint,
      {
        target: "openclaw",
        workspace: "/tmp/workspace",
        openClawStateDir: "/tmp/openclaw-state",
        message: "ping",
        live: true,
        runId: "run-live-timeout-cleanup-failed",
        now: "2026-07-03T00:00:00.000Z",
      },
      async () => ({
        exitCode: 124,
        stdout: "",
        stderr: "",
        timedOut: true,
        durationMs: 1250,
        processGroupClosed: false,
        processGroupCleanupFailed: true,
        processGroupVerification: "still-alive-after-sigkill-grace",
      }),
    );

    const evaluation = buildRunEval(runState);
    assert.equal(runState.execution.processGroupClosed, false);
    assert.equal(runState.evidence.processGroupCleanupFailed, true);
    assert.equal(evaluation.ok, false);
    assert.equal(evaluation.checks.find((check) => check.id === "process_group_closed").pass, false);
  });

  it("fails run-eval closed when timeout cleanup uses unsupported process-group verification", async () => {
    const blueprint = await loadExample();
    const { runState } = await executeRuntimeRun(
      blueprint,
      {
        target: "openclaw",
        workspace: "/tmp/workspace",
        openClawStateDir: "/tmp/openclaw-state",
        message: "ping",
        live: true,
        runId: "run-live-timeout-unsupported-process-group",
        now: "2026-07-03T00:00:00.000Z",
      },
      async () => ({
        exitCode: 124,
        stdout: "",
        stderr: "",
        timedOut: true,
        durationMs: 1250,
        processGroupClosed: false,
        processGroupCleanupFailed: true,
        processGroupVerification: "unsupported-process-group",
      }),
    );

    const evaluation = buildRunEval(runState);
    assert.equal(runState.execution.processGroupVerification, "unsupported-process-group");
    assert.equal(evaluation.ok, false);
    assert.equal(evaluation.checks.find((check) => check.id === "process_group_closed").pass, false);
  });

  it("fails run-eval closed when timeout cleanup lacks a positive process-group proof", async () => {
    const blueprint = await loadExample();
    const invalidProofs = [
      { runId: "run-live-timeout-missing-process-group-proof", processGroupVerification: undefined },
      { runId: "run-live-timeout-invalid-process-group-proof", processGroupVerification: "unsupported-process-group" },
    ];

    for (const invalidProof of invalidProofs) {
      const { runState } = await executeRuntimeRun(
        blueprint,
        {
          target: "openclaw",
          workspace: "/tmp/workspace",
          openClawStateDir: "/tmp/openclaw-state",
          message: "ping",
          live: true,
          runId: invalidProof.runId,
          now: "2026-07-03T00:00:00.000Z",
        },
        async () => ({
          exitCode: 124,
          stdout: "",
          stderr: "",
          timedOut: true,
          durationMs: 1250,
          processGroupClosed: true,
          processGroupCleanupFailed: false,
          processGroupVerification: invalidProof.processGroupVerification,
        }),
      );

      const evaluation = buildRunEval(runState, { expectStatus: "failure" });
      assert.equal(runState.execution.processGroupClosed, true);
      assert.equal(evaluation.ok, false);
      assert.equal(evaluation.checks.find((check) => check.id === "process_group_closed").pass, false);
    }
  });

  it("does not represent gateway fallback as gateway execution", async () => {
    const blueprint = await loadExample();
    const { runState } = await executeRuntimeRun(
      blueprint,
      {
        target: "openclaw",
        workspace: "/tmp/workspace",
        openClawStateDir: "/tmp/openclaw-state",
        transport: "gateway",
        fallbackFrom: "pi",
        message: "ping",
        live: true,
        runId: "run-gateway-fallback",
        now: "2026-07-03T00:00:00.000Z",
      },
      async () => ({ exitCode: 0, stdout: "gateway unavailable; falling back to embedded", stderr: "", timedOut: false, durationMs: 12 }),
    );

    assert.equal(runState.runtimeIdentity.transport, "embedded-fallback");
    assert.equal(runState.runtimeIdentity.fallbackFrom, "gateway");
    assert.equal(runState.runtimeIdentity.fallbackEvidence.detected, true);
    assert.equal(runState.runtimeIdentity.fallbackEvidence.detectionMethod, "stdout-stderr-heuristic");
    assert.equal(runState.runtimeIdentity.fallbackEvidence.structured, false);
  });

  it("prefers OpenClaw JSON meta for gateway fallback evidence", async () => {
    const blueprint = await loadExample();
    let observedCommand = null;
    const { runState } = await executeRuntimeRun(
      blueprint,
      {
        target: "openclaw",
        workspace: "/tmp/workspace",
        openClawStateDir: "/tmp/openclaw-state",
        transport: "gateway",
        message: "ping",
        live: true,
        runId: "run-gateway-json-fallback",
        now: "2026-07-03T00:00:00.000Z",
      },
      async (command) => {
        observedCommand = command;
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            status: "ok",
            payloads: [{ text: "local" }],
            meta: {
              transport: "embedded",
              fallbackFrom: "gateway",
              fallbackReason: "gateway_timeout",
            },
          }),
          stderr: "",
          timedOut: false,
          durationMs: 12,
        };
      },
    );

    assert.equal(observedCommand.args.includes("--json"), true);
    assert.equal(runState.runtimeIdentity.transport, "embedded-fallback");
    assert.equal(runState.runtimeIdentity.fallbackFrom, "gateway");
    assert.deepEqual(runState.runtimeIdentity.fallbackEvidence, {
      detected: true,
      detectionMethod: "openclaw-json-meta",
      source: "stdout-json",
      from: "gateway",
      to: "embedded",
      reason: "gateway_timeout",
      structured: true,
    });
  });

  it("trusts OpenClaw JSON fallback meta even when planned transport is unknown", async () => {
    const blueprint = await loadExample();
    const { runState } = await executeRuntimeRun(
      blueprint,
      {
        target: "openclaw",
        workspace: "/tmp/workspace",
        openClawStateDir: "/tmp/openclaw-state",
        message: "ping",
        live: true,
        runId: "run-unknown-json-fallback",
        now: "2026-07-03T00:00:00.000Z",
      },
      async () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          status: "ok",
          meta: {
            transport: "embedded",
            fallbackFrom: "gateway",
            fallbackReason: "gateway_timeout",
          },
        }),
        stderr: "",
        timedOut: false,
        durationMs: 12,
      }),
    );

    assert.equal(runState.runtimeIdentity.transport, "embedded-fallback");
    assert.equal(runState.runtimeIdentity.fallbackFrom, "gateway");
    assert.deepEqual(runState.runtimeIdentity.fallbackEvidence, {
      detected: true,
      detectionMethod: "openclaw-json-meta",
      source: "stdout-json",
      from: "gateway",
      to: "embedded",
      reason: "gateway_timeout",
      structured: true,
    });
  });

  it("does not let JSON payload text spoof gateway fallback evidence", async () => {
    const blueprint = await loadExample();
    const { runState } = await executeRuntimeRun(
      blueprint,
      {
        target: "openclaw",
        workspace: "/tmp/workspace",
        openClawStateDir: "/tmp/openclaw-state",
        transport: "gateway",
        message: "ping",
        live: true,
        runId: "run-gateway-json-payload-text",
        now: "2026-07-03T00:00:00.000Z",
      },
      async () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          status: "ok",
          payloads: [{ text: "The app says it is falling back to embedded mode." }],
          meta: { durationMs: 1 },
        }),
        stderr: "",
        timedOut: false,
        durationMs: 12,
      }),
    );

    assert.equal(runState.runtimeIdentity.transport, "gateway");
    assert.equal(runState.runtimeIdentity.fallbackFrom, null);
    assert.equal(runState.runtimeIdentity.fallbackEvidence.detected, false);
    assert.equal(runState.runtimeIdentity.fallbackEvidence.detectionMethod, "planned");
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
      message: "line 1\nline 2",
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
    assert.match(await readFile(runState.message.messageFile.path, "utf8"), /line 2/u);
    assert.equal(runState.message.secretLikeContent, false);
  });

  it("refuses to persist secret-like inline messages under run output", async () => {
    const blueprint = await loadExample();
    const out = await mkdtemp(path.join(tmpdir(), "agentmo-run-secret-message-"));

    await assert.rejects(
      () =>
        executeRuntimeRun(blueprint, {
          target: "openclaw",
          workspace: "/tmp/workspace",
          message: "line 1\napi_key=secret sk-abcdefghijklmnop",
          out,
          runId: "run-secret-message",
          now: "2026-07-03T00:00:00.000Z",
        }),
      /Refusing to persist secret-like inline message content/u,
    );
    assert.deepEqual(await readdir(out), []);
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
