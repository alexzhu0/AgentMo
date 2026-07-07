import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildRunEval,
  buildRunReport,
  executeRuntimeRun,
  loadRunState,
  replayRunState,
  RUN_STATE_FILENAME,
} from "../src/run-state.js";

async function loadExample() {
  return JSON.parse(await readFile(new URL("../examples/win9.agentmo.json", import.meta.url), "utf8"));
}

async function createParentRunState() {
  const blueprint = await loadExample();
  const { runState } = await executeRuntimeRun(blueprint, {
    target: "openclaw",
    workspace: "/tmp/agentmo-workspace",
    message: "Say exactly: ok",
    runId: "parent-run",
    now: "2026-07-03T00:00:00.000Z",
  });
  return runState;
}

describe("runtime replay and eval", () => {
  it("summarizes run evidence without certifying runtime/domain behavior", async () => {
    const runState = await createParentRunState();
    const report = buildRunReport(runState);
    const evaluation = buildRunEval(runState, { expectStatus: "declared" });

    assert.equal(report.schemaVersion, "agentmo.run-report.v1");
    assert.equal(report.ok, true);
    assert.equal(report.observationRef, "agentmo-run:parent-run");
    assert.equal(report.certificationBoundary.runEvidenceCertifiesRuntime, false);
    assert.equal(evaluation.schemaVersion, "agentmo.run-eval.v1");
    assert.equal(evaluation.ok, true);
    assert.equal(evaluation.certificationBoundary.runtimeCertifiedByRun, false);
    assert.equal(evaluation.certificationBoundary.domainCertifiedByRun, false);
  });

  it("fails eval closed on expected-status mismatch or production state evidence", async () => {
    const runState = await createParentRunState();
    const mismatch = buildRunEval(runState, { expectStatus: "success" });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.checks.find((check) => check.id === "expected_status").pass, false);

    const productionStateRun = JSON.parse(JSON.stringify(runState));
    productionStateRun.runtimeIdentity.sandboxScope.usesProductionState = true;
    const productionEval = buildRunEval(productionStateRun);
    assert.equal(productionEval.ok, false);
    assert.equal(productionEval.checks.find((check) => check.id === "sandbox_non_production").pass, false);
  });

  it("replays into a fresh child session by default and writes child state", async () => {
    const runState = await createParentRunState();
    const out = await mkdtemp(path.join(tmpdir(), "agentmo-replay-"));
    const replay = await replayRunState(runState, {
      out,
      runId: "child-run",
      now: "2026-07-03T00:01:00.000Z",
    });

    const parentSession = runState.runtimeIdentity.selector.executionSelector.sessionKey;
    const childSession = replay.runState.runtimeIdentity.selector.executionSelector.sessionKey;
    assert.equal(replay.runState.parentRunId, "parent-run");
    assert.equal(replay.runState.execution.executed, false);
    assert.equal(replay.runState.execution.status, "declared");
    assert.equal(replay.runState.replay.policy, "fresh-child-session");
    assert.equal(replay.runState.replay.resumeSession, false);
    assert.equal(replay.runState.replay.replayFidelity, "exact");
    assert.notEqual(childSession, parentSession);
    assert.equal(replay.runState.command.args.includes(childSession), true);
    assert.equal(replay.runState.command.args.includes(parentSession), false);

    const saved = await loadRunState(path.join(out, "runs", "child-run", RUN_STATE_FILENAME));
    assert.equal(saved.runId, "child-run");
    assert.equal(saved.parentRunId, "parent-run");
  });

  it("preserves OpenClaw local transport and model flags during replay", async () => {
    const blueprint = await loadExample();
    const parent = await executeRuntimeRun(blueprint, {
      target: "openclaw",
      workspace: "/tmp/agentmo-workspace",
      transport: "local",
      model: "deepseek/deepseek-v4-flash",
      thinking: "off",
      message: "Say exactly: ok",
      runId: "model-parent",
      now: "2026-07-03T00:00:00.000Z",
    });
    const replay = await replayRunState(parent.runState, {
      runId: "model-child",
      now: "2026-07-03T00:01:00.000Z",
    });

    assert.equal(replay.runState.runtimeIdentity.transport, "local");
    assert.equal(replay.runState.runtimeIdentity.model, "deepseek/deepseek-v4-flash");
    assert.equal(replay.runState.runtimeIdentity.thinking, "off");
    assert.equal(replay.runState.command.args.includes("--local"), true);
    assert.equal(replay.runState.command.args.includes("--json"), true);
    assert.equal(replay.runState.command.args.includes("--model"), true);
    assert.equal(replay.runState.command.args.includes("deepseek/deepseek-v4-flash"), true);
    assert.equal(replay.runState.command.args.includes("--thinking"), true);
    assert.equal(replay.runState.command.args.includes("off"), true);
  });

  it("reuses the original session only with explicit resume-session", async () => {
    const runState = await createParentRunState();
    const replay = await replayRunState(runState, {
      runId: "resume-run",
      now: "2026-07-03T00:02:00.000Z",
      resumeSession: true,
    });

    assert.equal(replay.runState.replay.policy, "same-session-resume");
    assert.equal(replay.runState.replay.resumeSession, true);
    assert.equal(replay.runState.runtimeIdentity.selector.executionSessionPolicy, "operator-supplied");
    assert.equal(replay.runState.runtimeIdentity.selector.explicitSessionReuse, true);
    assert.equal(
      replay.runState.runtimeIdentity.selector.executionSelector.sessionKey,
      runState.runtimeIdentity.selector.executionSelector.sessionKey,
    );
    assert.equal(replay.runState.runtimeIdentity.selector.executionSelector.generated, false);
  });

  it("records live replay mutation flags against isolated state", async () => {
    const blueprint = await loadExample();
    const parent = await executeRuntimeRun(blueprint, {
      target: "openclaw",
      workspace: "/tmp/agentmo-workspace",
      openClawStateDir: "/tmp/openclaw-state",
      message: "Say exactly: ok",
      runId: "live-replay-parent",
      now: "2026-07-03T00:00:00.000Z",
    });
    const replay = await replayRunState(
      parent.runState,
      {
        live: true,
        runId: "live-replay-child",
        now: "2026-07-03T00:08:00.000Z",
      },
      async () => ({ exitCode: 0, stdout: "ok", stderr: "", timedOut: false, durationMs: 3 }),
    );

    assert.equal(replay.runState.execution.executed, true);
    assert.equal(replay.runState.command.mutatesOpenClawState, true);
    assert.equal(replay.runState.command.mutatesProductionOpenClawState, false);
    assert.equal(replay.runState.command.mutatesIsolatedOpenClawState, true);
  });

  it("passes env-file values and redaction context into live replay", async () => {
    const blueprint = await loadExample();
    const parent = await executeRuntimeRun(blueprint, {
      target: "openclaw",
      workspace: "/tmp/agentmo-workspace",
      openClawStateDir: "/tmp/openclaw-state",
      provider: "deepseek",
      model: "deepseek/deepseek-v4-flash",
      transport: "local",
      envFile: "/tmp/agentmo/.env",
      envFileContent: "DEEPSEEK_API_KEY=parent-secret\n",
      message: "Say exactly: ok",
      runId: "live-replay-env-parent",
      now: "2026-07-03T00:00:00.000Z",
    });
    await assert.rejects(
      () =>
        replayRunState(
          parent.runState,
          {
            live: true,
            runId: "live-replay-env-missing",
            now: "2026-07-03T00:08:00.000Z",
          },
          async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false, durationMs: 1 }),
        ),
      /Missing required runtime env key\(s\): DEEPSEEK_API_KEY/u,
    );

    let observedDeepSeekKey = null;
    const replay = await replayRunState(
      parent.runState,
      {
        live: true,
        envFile: "/tmp/agentmo/.env",
        envFileContent: "DEEPSEEK_API_KEY=replay-secret\nOPENCLAW_GATEWAY_URL=ws://127.0.0.1:28765\n",
        runId: "live-replay-env-child",
        now: "2026-07-03T00:08:00.000Z",
      },
      async (_command, _runtimeIdentity, options) => {
        observedDeepSeekKey = options.runtimeEnvValues.DEEPSEEK_API_KEY;
        return { exitCode: 0, stdout: "api_key=replay-secret", stderr: "", timedOut: false, durationMs: 3 };
      },
    );

    assert.equal(observedDeepSeekKey, "replay-secret");
    assert.equal(replay.runState.runtimeIdentity.runtimeEnv.envFile.basename, ".env");
    assert.deepEqual(replay.runState.runtimeIdentity.runtimeEnv.presentKeys, ["DEEPSEEK_API_KEY", "OPENCLAW_GATEWAY_URL"]);
    assert.equal(replay.runState.execution.stdout.preview.includes("replay-secret"), false);
    assert.equal(replay.runState.execution.stdout.preview.includes("[REDACTED_SECRET]"), true);
    assert.equal(JSON.stringify(replay.runState).includes("replay-secret"), false);
    assert.equal(replay.runState.runtimeIdentity.sandboxScope.environmentAllowlist.includes("OPENCLAW_GATEWAY_URL"), true);
  });

  it("fresh replay rewrites session-id and to selectors into a generated child session-key", async () => {
    const blueprint = await loadExample();
    const sessionIdParent = await executeRuntimeRun(blueprint, {
      target: "openclaw",
      workspace: "/tmp/agentmo-workspace",
      sessionId: "parent-session-id",
      message: "Say exactly: ok",
      runId: "session-id-parent",
      now: "2026-07-03T00:00:00.000Z",
    });
    const sessionIdReplay = await replayRunState(sessionIdParent.runState, {
      runId: "session-id-child",
      now: "2026-07-03T00:04:00.000Z",
    });
    assert.equal(sessionIdReplay.runState.runtimeIdentity.selector.executionSelector.sessionId, null);
    assert.equal(sessionIdReplay.runState.runtimeIdentity.selector.executionSelector.to, null);
    assert.equal(sessionIdReplay.runState.runtimeIdentity.selector.executionSessionPolicy, "fresh-per-run");
    assert.equal(sessionIdReplay.runState.runtimeIdentity.selector.explicitSessionReuse, false);
    assert.equal(sessionIdReplay.runState.runtimeIdentity.selector.executionSelector.sessionKey, "agentmo-win9-session-id-child");
    assert.equal(sessionIdReplay.runState.command.args.includes("--session-id"), false);
    assert.equal(sessionIdReplay.runState.command.args.includes("parent-session-id"), false);
    assert.equal(sessionIdReplay.runState.command.args.includes("--session-key"), true);

    const toParent = await executeRuntimeRun(blueprint, {
      target: "openclaw",
      workspace: "/tmp/agentmo-workspace",
      to: "telegram:abc",
      message: "Say exactly: ok",
      runId: "to-parent",
      now: "2026-07-03T00:00:00.000Z",
    });
    const toReplay = await replayRunState(toParent.runState, {
      runId: "to-child",
      now: "2026-07-03T00:05:00.000Z",
    });
    assert.equal(toReplay.runState.runtimeIdentity.selector.executionSelector.to, null);
    assert.equal(toReplay.runState.runtimeIdentity.selector.executionSessionPolicy, "fresh-per-run");
    assert.equal(toReplay.runState.runtimeIdentity.selector.explicitSessionReuse, false);
    assert.equal(toReplay.runState.runtimeIdentity.selector.executionSelector.sessionKey, "agentmo-win9-to-child");
    assert.equal(toReplay.runState.command.args.includes("--to"), false);
    assert.equal(toReplay.runState.command.args.includes("telegram:abc"), false);
  });

  it("labels replay fidelity reconstructed when exact message material is unavailable", async () => {
    const runState = await createParentRunState();
    const reconstructed = JSON.parse(JSON.stringify(runState));
    reconstructed.message.inlineMessage = null;
    reconstructed.message.messageFile = null;

    const replay = await replayRunState(reconstructed, {
      runId: "reconstructed-run",
      now: "2026-07-03T00:03:00.000Z",
    });

    assert.equal(replay.runState.replay.replayFidelity, "reconstructed");
    assert.equal(buildRunEval(replay.runState).ok, false);
    assert.equal(buildRunEval(replay.runState).checks.find((check) => check.id === "message_provenance").pass, false);
  });

  it("verifies message-file digest before labeling replay fidelity exact", async () => {
    const blueprint = await loadExample();
    const out = await mkdtemp(path.join(tmpdir(), "agentmo-message-fidelity-"));
    const parent = await executeRuntimeRun(blueprint, {
      target: "openclaw",
      workspace: "/tmp/agentmo-workspace",
      message: "line 1\nline 2",
      out,
      runId: "message-parent",
      now: "2026-07-03T00:00:00.000Z",
    });

    const exact = await replayRunState(parent.runState, {
      runId: "message-child",
      now: "2026-07-03T00:06:00.000Z",
    });
    assert.equal(exact.runState.replay.replayFidelity, "exact");

    await writeFile(parent.runState.message.messageFile.path, "tampered", "utf8");
    const tamperedEval = buildRunEval(parent.runState, { requireExactReplay: true });
    assert.equal(tamperedEval.ok, false);
    assert.equal(tamperedEval.checks.find((check) => check.id === "message_provenance").pass, false);
    assert.equal(tamperedEval.checks.find((check) => check.id === "require_exact_replay").pass, false);
    const reconstructed = await replayRunState(parent.runState, {
      runId: "message-tampered-child",
      now: "2026-07-03T00:07:00.000Z",
    });
    assert.equal(reconstructed.runState.replay.replayFidelity, "reconstructed");
  });

  it("rejects malformed replay sources with explicit errors", async () => {
    const runState = await createParentRunState();
    const missingCommand = JSON.parse(JSON.stringify(runState));
    delete missingCommand.command;
    await assert.rejects(() => replayRunState(missingCommand, { runId: "bad-run" }), /command descriptor/u);

    const missingSandbox = JSON.parse(JSON.stringify(runState));
    delete missingSandbox.runtimeIdentity.sandboxScope;
    await assert.rejects(() => replayRunState(missingSandbox, { runId: "bad-sandbox" }), /sandbox scope/u);
  });
});
