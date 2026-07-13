import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { access, mkdtemp, open, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildRunEval,
  buildRunEvalVerified,
  loadRunIndex,
  loadRunState,
  RUN_INDEX_FILENAME,
  RUN_INDEX_SCHEMA_VERSION,
  RUN_EVAL_CHECK_IDS,
  RUN_STATE_FILENAME,
  RUN_STATE_SCHEMA_VERSION,
  validateRunIndexArtifact,
  validateRunEvalArtifact,
  validateRunStateArtifact,
  writeRunState,
} from "../src/run-state.js";
import { digestRawBytes, loadAdmittedArtifact } from "../src/artifact-admission.js";
import { assertPersistable, isRedactedSummary } from "../src/persistability.js";
import {
  executeAdmittedRuntimeRun,
  admitRunStateValue,
  loadAdmittedRunIndexFile,
  loadAdmittedRunStateFile,
} from "./helpers/admitted-runtime.js";

async function loadExample() {
  return JSON.parse(await readFile(new URL("../examples/win9.agentmo.json", import.meta.url), "utf8"));
}

describe("run state", () => {
  it("preflights exact persistable state/index candidates without retaining message or host paths", async () => {
    const blueprint = await loadExample();
    const out = await mkdtemp(path.join(tmpdir(), "agentmo-run-closed-"));
    const canary = "run-message-canary";
    const result = await executeAdmittedRuntimeRun(blueprint, {
      target: "openclaw",
      workspace: "/private/host/workspace-canary",
      openClawStateDir: "/private/host/state-canary",
      message: canary,
      out,
      runId: "closed-run",
      now: "2026-07-03T00:00:00.000Z",
    });

    assert.equal(validateRunStateArtifact(result.runState).ok, true);
    assert.equal(isRedactedSummary(result.runState.message.summary), true);
    assert.equal(isRedactedSummary(result.runState.execution.stdout), true);
    assert.equal(isRedactedSummary(result.runState.execution.stderr), true);
    assert.doesNotThrow(() => assertPersistable(result.runState, { subject: "run-state" }));
    const stateBytes = await readFile(result.stateFile);
    const indexBytes = await readFile(result.indexFile);
    const index = JSON.parse(indexBytes.toString("utf8"));
    assert.equal(validateRunIndexArtifact(index).ok, true);
    assert.equal(index.runs.find((entry) => entry.runId === "closed-run").stateDigest, digestRawBytes(stateBytes));
    for (const forbidden of [canary, "/private/host", "workspace-canary", "state-canary"]) {
      assert.equal(stateBytes.includes(Buffer.from(forbidden)), false);
      assert.equal(indexBytes.includes(Buffer.from(forbidden)), false);
    }
  });

  it("rejects hostile complete candidates before the first runtime writer side effect", async () => {
    const blueprint = await loadExample();
    const { runState } = await executeAdmittedRuntimeRun(blueprint, {
      target: "openclaw",
      workspace: "/tmp/workspace",
      message: "ping",
      runId: "preflight-run",
      now: "2026-07-03T00:00:00.000Z",
    });
    const parent = await mkdtemp(path.join(tmpdir(), "agentmo-run-preflight-"));
    const cases = [
      (candidate) => { candidate.runtimeIdentity.fallbackEvidence.reason = "/private/host/fallback-canary"; },
      (candidate) => { candidate.execution.stdout.text = "output-canary"; },
      (candidate) => { candidate.runtimeIdentity.runtimeEnv.presentNames = ["DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY"]; },
      (candidate) => { candidate.runtimeIdentity.selector.executionSelector.agent = "api_key=selector-canary"; },
    ];

    for (const [index, mutate] of cases.entries()) {
      const candidate = JSON.parse(JSON.stringify(runState));
      mutate(candidate);
      const outputRoot = path.join(parent, `case-${index}`);
      await assert.rejects(
        () => writeRunState(outputRoot, candidate),
        (error) => {
          const serialized = JSON.stringify(error);
          assert.equal(error.message.includes("canary"), false);
          assert.equal(serialized.includes("canary"), false);
          return true;
        },
      );
      await assert.rejects(() => access(outputRoot), (error) => error.code === "ENOENT");
    }
  });

  it("admits state and index once each and closes family and byte-mutation swaps", async () => {
    const blueprint = await loadExample();
    const out = await mkdtemp(path.join(tmpdir(), "agentmo-run-admission-"));
    const result = await executeAdmittedRuntimeRun(blueprint, {
      target: "openclaw",
      workspace: "/tmp/workspace",
      message: "ping",
      out,
      runId: "admission-run",
      now: "2026-07-03T00:00:00.000Z",
    });
    const stateBytes = await readFile(result.stateFile);
    const indexBytes = await readFile(result.indexFile);
    let stateOpens = 0;
    let indexOpens = 0;
    const state = await loadRunState(result.stateFile, {
      subject: "run-state",
      expectedDigest: digestRawBytes(stateBytes),
      openInput: async (...args) => {
        stateOpens += 1;
        return open(...args);
      },
    });
    const index = await loadRunIndex(out, {
      subject: "run-index",
      expectedDigest: digestRawBytes(indexBytes),
      openInput: async (...args) => {
        indexOpens += 1;
        return open(...args);
      },
    });
    assert.equal(state.runId, "admission-run");
    assert.equal(index.latestRunId, "admission-run");
    assert.equal(stateOpens, 1);
    assert.equal(indexOpens, 1);
    await assert.rejects(
      () => loadAdmittedArtifact({
        filePath: result.stateFile,
        subject: "run-index",
        expectedDigest: digestRawBytes(stateBytes),
      }),
      (error) => error.code === "AGENTMO_UNSUPPORTED_ARTIFACT",
    );
    await assert.rejects(
      () => loadAdmittedArtifact({
        filePath: result.indexFile,
        subject: "run-state",
        expectedDigest: digestRawBytes(indexBytes),
      }),
      (error) => error.code === "AGENTMO_UNSUPPORTED_ARTIFACT",
    );
    await writeFile(result.stateFile, Buffer.concat([stateBytes, Buffer.from(" ")]));
    await assert.rejects(
      () => loadRunState(result.stateFile, {
        subject: "run-state",
        expectedDigest: digestRawBytes(stateBytes),
      }),
      (error) => error.code === "AGENTMO_ARTIFACT_DIGEST_MISMATCH",
    );
  });

  it("writes non-live run-state and atomic run index", async () => {
    const blueprint = await loadExample();
    const out = await mkdtemp(path.join(tmpdir(), "agentmo-run-state-"));
    const { runState, stateFile, indexFile } = await executeAdmittedRuntimeRun(blueprint, {
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

    const loaded = (await loadAdmittedRunStateFile(stateFile)).value;
    assert.equal(loaded.runId, "run-001");
    const index = (await loadAdmittedRunIndexFile(indexFile)).value;
    assert.equal(index.schemaVersion, RUN_INDEX_SCHEMA_VERSION);
    assert.equal(index.latestRunId, "run-001");
    assert.equal(index.runs.find((entry) => entry.runId === "run-001").statePath, path.join("runs", "run-001", RUN_STATE_FILENAME));
  });

  it("generates distinct session keys for identical run inputs", async () => {
    const blueprint = await loadExample();
    const first = await executeAdmittedRuntimeRun(blueprint, {
      target: "openclaw",
      workspace: "/tmp/workspace",
      message: "same",
      runId: "run-a",
      now: "2026-07-03T00:00:00.000Z",
    });
    const second = await executeAdmittedRuntimeRun(blueprint, {
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
    const { runState } = await executeAdmittedRuntimeRun(
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
    assert.deepEqual(runState.runtimeIdentity.sandboxScope.state, {
      kind: "TransientPathRef",
      name: "openclaw-state",
      persisted: false,
    });
    assert.deepEqual(runState.runtimeIdentity.runtimeEnv.presentNames, ["DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL"]);
    assert.equal(observedStateDir, path.resolve("/tmp/openclaw-state"));
    assert.equal(observedDeepSeekKey, "deepseek-secret-value");
    assert.equal(runState.execution.stdout.summaryKind, "unstructured-digest-summary");
    assert.equal(JSON.parse(runState.execution.stdout.text).type, "unstructured-output-digest");
    assert.equal(runState.execution.stdout.text.includes("deepseek-secret-value"), false);
    assert.equal(runState.evidence.rawOutputPreviewStored, false);
    assert.equal(runState.evidence.rawTranscriptStored, false);
    assert.equal(JSON.stringify(runState).includes("deepseek-secret-value"), false);
    assert.equal(JSON.stringify(runState).includes("/tmp/agentmo/.env"), false);
  });

  it("stores unstructured live output as digest-only evidence", async () => {
    const blueprint = await loadExample();
    const { runState } = await executeAdmittedRuntimeRun(
      blueprint,
      {
        target: "openclaw",
        workspace: "/tmp/workspace",
        openClawStateDir: "/tmp/openclaw-state",
        message: "ping",
        live: true,
        runId: "run-live-digest-output",
        now: "2026-07-03T00:00:00.000Z",
      },
      async () => ({ exitCode: 0, stdout: "ok", stderr: "", timedOut: false, durationMs: 1 }),
    );

    const evaluation = buildRunEval(runState, { expectStatus: "success" });
    assert.equal(runState.execution.stdout.summaryKind, "unstructured-digest-summary");
    assert.equal(runState.evidence.rawOutputPreviewStored, false);
    assert.equal(runState.evidence.birthEligibility, "eligible-no-runtime-output-preview");
    assert.equal(evaluation.ok, true, evaluation.checks.filter((check) => !check.pass).map((check) => check.id).join(", "));
  });

  it("fails run-eval closed when raw runtime output previews are stored", async () => {
    const blueprint = await loadExample();
    const { runState } = await executeAdmittedRuntimeRun(
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
    runState.execution.stdout = {
      preview: "ok",
      summaryKind: "raw-output-preview",
      length: 2,
      redactedLength: 2,
      truncated: false,
      rawPreviewStored: true,
    };
    runState.evidence.stdoutSummary = "ok";
    runState.evidence.stdoutSummaryKind = "raw-output-preview";
    runState.evidence.stdoutPreviewStored = true;
    runState.evidence.rawOutputPreviewStored = true;
    runState.evidence.rawTranscriptStored = true;
    runState.evidence.rawToolBodiesStored = true;

    const evaluation = buildRunEval(runState, { expectStatus: "success" });
    assert.equal(evaluation.ok, false);
    assert.equal(evaluation.checks.find((check) => check.id === "output_body_absent").pass, false);
  });

  it("derives raw-output eval failures from execution even when evidence claims otherwise", async () => {
    const blueprint = await loadExample();
    const { runState } = await executeAdmittedRuntimeRun(
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
    runState.execution.stdout = {
      preview: "raw diagnostics",
      summaryKind: "raw-output-preview",
      length: 15,
      redactedLength: 15,
      truncated: false,
      rawPreviewStored: true,
    };
    runState.evidence.stdoutPreviewStored = false;
    runState.evidence.rawOutputPreviewStored = false;
    runState.evidence.rawTranscriptStored = false;
    runState.evidence.rawToolBodiesStored = false;

    const evaluation = buildRunEval(runState, { expectStatus: "success" });
    assert.equal(evaluation.ok, false);
    assert.equal(evaluation.checks.find((check) => check.id === "output_summary_consistent").pass, false);
    assert.equal(evaluation.checks.find((check) => check.id === "output_body_absent").pass, false);
  });

  it("fails run-eval closed when evidence summary stores raw output despite false flags", async () => {
    const blueprint = await loadExample();
    const { runState } = await executeAdmittedRuntimeRun(
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
    runState.evidence.stdoutSummary = "raw diagnostics";
    runState.evidence.stdoutPreviewStored = false;
    runState.evidence.rawOutputPreviewStored = false;
    runState.evidence.rawTranscriptStored = false;
    runState.evidence.rawToolBodiesStored = false;

    const evaluation = buildRunEval(runState, { expectStatus: "success" });
    assert.equal(runState.execution.stdout.summaryKind, "structured-json-summary");
    assert.equal(evaluation.ok, false);
    assert.equal(evaluation.checks.find((check) => check.id === "output_summary_consistent").pass, false);
    assert.equal(evaluation.checks.find((check) => check.id === "output_body_absent").pass, false);
  });

  it("summarizes mixed raw output plus JSON as digest-only evidence", async () => {
    const blueprint = await loadExample();
    const { runState } = await executeAdmittedRuntimeRun(
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
    assert.equal(runState.execution.stdout.summaryKind, "unstructured-digest-summary");
    assert.equal(runState.evidence.rawOutputPreviewStored, false);
    assert.equal(evaluation.ok, true, evaluation.checks.filter((check) => !check.pass).map((check) => check.id).join(", "));
    assert.equal(JSON.stringify(runState).includes("secret-value-123456"), false);
  });

  it("does not treat arbitrary JSON stdout as structured OpenClaw evidence", async () => {
    const blueprint = await loadExample();
    const { runState } = await executeAdmittedRuntimeRun(
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
    assert.equal(runState.execution.stdout.summaryKind, "unstructured-digest-summary");
    assert.equal(evaluation.ok, true, evaluation.checks.filter((check) => !check.pass).map((check) => check.id).join(", "));
  });

  it("does not let generic status JSON spoof structured OpenClaw metadata", async () => {
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
      const { runState } = await executeAdmittedRuntimeRun(
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
      assert.equal(runState.execution.stdout.summaryKind, "unstructured-digest-summary");
      assert.equal(runState.evidence.rawOutputPreviewStored, false);
      assert.equal(runState.runtimeIdentity.transport, "unknown");
      assert.equal(runState.runtimeIdentity.fallbackFrom, null);
      assert.equal(runState.runtimeIdentity.fallbackEvidence.detected, false);
      assert.equal(runState.runtimeIdentity.fallbackEvidence.detectionMethod, "planned");
      assert.equal(runState.runtimeIdentity.fallbackEvidence.structured, false);
      assert.equal(evaluation.ok, true, evaluation.checks.filter((check) => !check.pass).map((check) => check.id).join(", "));
    }
  });

  it("fails run-eval closed when live provider env descriptor is missing", async () => {
    const blueprint = await loadExample();
    const { runState } = await executeAdmittedRuntimeRun(
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
    const { runState } = await executeAdmittedRuntimeRun(
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
    const { runState } = await executeAdmittedRuntimeRun(
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
      const { runState } = await executeAdmittedRuntimeRun(
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
    const { runState } = await executeAdmittedRuntimeRun(
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
    assert.equal(runState.runtimeIdentity.fallbackEvidence.detectionMethod, "bounded-text-detection");
    assert.equal(runState.runtimeIdentity.fallbackEvidence.structured, false);
  });

  it("prefers OpenClaw JSON meta for gateway fallback evidence", async () => {
    const blueprint = await loadExample();
    let observedCommand = null;
    const { runState } = await executeAdmittedRuntimeRun(
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
      reason: "structured reason redacted",
      structured: true,
    });
  });

  it("trusts OpenClaw JSON fallback meta even when planned transport is unknown", async () => {
    const blueprint = await loadExample();
    const { runState } = await executeAdmittedRuntimeRun(
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
      reason: "structured reason redacted",
      structured: true,
    });
  });

  it("does not let JSON payload text spoof gateway fallback evidence", async () => {
    const blueprint = await loadExample();
    const { runState } = await executeAdmittedRuntimeRun(
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
        executeAdmittedRuntimeRun(
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
    const { runState } = await executeAdmittedRuntimeRun(
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
    assert.equal(runState.execution.stderr.summaryKind, "unstructured-digest-summary");
    assert.equal(runState.execution.stderr.text.includes("bad"), false);
  });

  it("keeps multiline messages transient and creates no managed message artifact", async () => {
    const blueprint = await loadExample();
    const out = await mkdtemp(path.join(tmpdir(), "agentmo-run-message-"));
    const { runState } = await executeAdmittedRuntimeRun(blueprint, {
      target: "openclaw",
      workspace: "/tmp/workspace",
      message: "line 1\nline 2",
      out,
      runId: "run-message",
      now: "2026-07-03T00:00:00.000Z",
    });

    assert.equal(isRedactedSummary(runState.message.summary), true);
    assert.equal(runState.command.args.includes("<transient-message>"), true);
    assert.equal(runState.replay.replayFidelity, "unavailable");
    assert.equal(JSON.stringify(runState).includes("line 2"), false);
    assert.equal((await readdir(out)).includes("messages"), false);
  });

  it("persists only digest evidence for secret-like transient messages", async () => {
    const blueprint = await loadExample();
    const out = await mkdtemp(path.join(tmpdir(), "agentmo-run-secret-message-"));

    const canary = "line 1\napi_key=secret sk-abcdefghijklmnop";
    const result = await executeAdmittedRuntimeRun(blueprint, {
      target: "openclaw",
      workspace: "/tmp/workspace",
      message: canary,
      out,
      runId: "run-secret-message",
      now: "2026-07-03T00:00:00.000Z",
    });
    assert.equal((await readFile(result.stateFile, "utf8")).includes(canary), false);
    assert.equal((await readdir(out)).includes("messages"), false);
  });

  it("requires exact admission before merging an existing run index", async () => {
    const blueprint = await loadExample();
    const out = await mkdtemp(path.join(tmpdir(), "agentmo-run-index-exact-"));
    const first = await executeAdmittedRuntimeRun(blueprint, {
      target: "openclaw",
      workspace: "/tmp/workspace",
      message: "ping",
      runId: "index-first",
      now: "2026-07-03T00:00:00.000Z",
    });
    const second = await executeAdmittedRuntimeRun(blueprint, {
      target: "openclaw",
      workspace: "/tmp/workspace",
      message: "ping",
      runId: "index-second",
      now: "2026-07-03T00:01:00.000Z",
    });

    await writeRunState(out, first.runState);
    const indexFile = path.join(out, RUN_INDEX_FILENAME);
    const firstIndexBytes = await readFile(indexFile);
    let liveRunnerCalls = 0;
    await assert.rejects(
      () => executeAdmittedRuntimeRun(blueprint, {
        target: "openclaw",
        workspace: "/tmp/workspace",
        openClawStateDir: "/tmp/openclaw-state",
        message: "ping",
        out,
        live: true,
        runId: "index-live-missing-digest",
        now: "2026-07-03T00:00:30.000Z",
      }, async () => {
        liveRunnerCalls += 1;
        return { exitCode: 0, stdout: "", stderr: "", timedOut: false, durationMs: 1 };
      }),
      (error) => error?.code === "AGENTMO_RUN_INDEX_DIGEST_REQUIRED",
    );
    assert.equal(liveRunnerCalls, 0);
    await assert.rejects(
      () => writeRunState(out, second.runState),
      (error) => error?.code === "AGENTMO_RUN_INDEX_DIGEST_REQUIRED",
    );
    await assert.rejects(
      () => access(path.join(out, "runs", "index-second", RUN_STATE_FILENAME)),
      (error) => error?.code === "ENOENT",
    );

    await writeRunState(out, second.runState, { runIndexDigest: digestRawBytes(firstIndexBytes) });
    const admittedIndex = await loadRunIndex(out, {
      subject: "run-index",
      expectedDigest: digestRawBytes(await readFile(indexFile)),
    });
    assert.deepEqual(admittedIndex.runs.map((entry) => entry.runId), ["index-first", "index-second"]);
    assert.equal(admittedIndex.latestRunId, "index-second");
  });

  it("rejects tampered prior index bytes and serializes concurrent first writers", async () => {
    const blueprint = await loadExample();
    const candidates = await Promise.all(["alpha", "beta", "gamma"].map((suffix, index) => (
      executeAdmittedRuntimeRun(blueprint, {
        target: "openclaw",
        workspace: "/tmp/workspace",
        message: "ping",
        runId: `index-${suffix}`,
        now: `2026-07-03T00:0${index}:00.000Z`,
      })
    )));

    const tamperOut = await mkdtemp(path.join(tmpdir(), "agentmo-run-index-tamper-"));
    await writeRunState(tamperOut, candidates[0].runState);
    const indexFile = path.join(tamperOut, RUN_INDEX_FILENAME);
    const admittedBytes = await readFile(indexFile);
    const tampered = JSON.parse(admittedBytes.toString("utf8"));
    tampered.updatedAt = "2026-07-03T00:02:00.000Z";
    await writeFile(indexFile, `${JSON.stringify(tampered, null, 2)}\n`);
    await assert.rejects(
      () => writeRunState(tamperOut, candidates[1].runState, { runIndexDigest: digestRawBytes(admittedBytes) }),
      (error) => error?.code === "AGENTMO_ARTIFACT_DIGEST_MISMATCH",
    );
    await assert.rejects(
      () => access(path.join(tamperOut, "runs", "index-beta", RUN_STATE_FILENAME)),
      (error) => error?.code === "ENOENT",
    );

    const concurrentOut = await mkdtemp(path.join(tmpdir(), "agentmo-run-index-concurrent-"));
    const settled = await Promise.allSettled([
      writeRunState(concurrentOut, candidates[1].runState),
      writeRunState(concurrentOut, candidates[2].runState),
    ]);
    assert.equal(settled.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(settled.filter((result) => result.status === "rejected").length, 1);
    const concurrentBytes = await readFile(path.join(concurrentOut, RUN_INDEX_FILENAME));
    const concurrentIndex = await loadRunIndex(concurrentOut, {
      subject: "run-index",
      expectedDigest: digestRawBytes(concurrentBytes),
    });
    assert.equal(concurrentIndex.runs.length, 1);
  });

  it("enforces execution cross-field invariants and derives run-eval from legal state", async () => {
    const blueprint = await loadExample();
    const declared = await executeAdmittedRuntimeRun(blueprint, {
      target: "openclaw",
      workspace: "/tmp/workspace",
      message: "ping",
      runId: "state-machine-declared",
      now: "2026-07-03T00:00:00.000Z",
    });
    const success = await executeAdmittedRuntimeRun(blueprint, {
      target: "openclaw",
      workspace: "/tmp/workspace",
      openClawStateDir: "/tmp/openclaw-state",
      message: "ping",
      live: true,
      runId: "state-machine-success",
      now: "2026-07-03T00:00:00.000Z",
    }, async () => ({ exitCode: 0, stdout: "", stderr: "", timedOut: false, durationMs: 1 }));
    const failure = await executeAdmittedRuntimeRun(blueprint, {
      target: "openclaw",
      workspace: "/tmp/workspace",
      openClawStateDir: "/tmp/openclaw-state",
      message: "ping",
      live: true,
      runId: "state-machine-failure",
      now: "2026-07-03T00:00:00.000Z",
    }, async () => ({ exitCode: 2, stdout: "", stderr: "", timedOut: false, durationMs: 1 }));
    const cases = [
      [declared.runState, (execution) => { execution.live = true; }],
      [declared.runState, (execution) => { execution.executed = true; }],
      [declared.runState, (execution) => { execution.exitCode = 0; }],
      [success.runState, (execution) => { execution.exitCode = 7; }],
      [success.runState, (execution) => { execution.timedOut = true; }],
      [success.runState, (execution) => { execution.processGroupCleanupFailed = true; }],
      [failure.runState, (execution) => { execution.exitCode = 0; }],
      [failure.runState, (execution) => { execution.executed = false; }],
      [failure.runState, (execution) => {
        execution.timedOut = true;
        execution.processGroupClosed = true;
        execution.processGroupCleanupFailed = true;
      }],
      [failure.runState, (execution) => {
        execution.timedOut = true;
        execution.processGroupClosed = false;
        execution.processGroupCleanupFailed = false;
      }],
    ];
    for (const [source, mutate] of cases) {
      const candidate = JSON.parse(JSON.stringify(source));
      mutate(candidate.execution);
      candidate.evidence.processGroupClosed = candidate.execution.processGroupClosed;
      candidate.evidence.processGroupCleanupFailed = candidate.execution.processGroupCleanupFailed;
      candidate.evidence.processGroupVerification = candidate.execution.processGroupVerification;
      assert.equal(validateRunStateArtifact(candidate).ok, false);
      const evaluation = buildRunEval(candidate);
      assert.equal(evaluation.ok, false);
      assert.equal(evaluation.checks.find((item) => item.id === "execution").pass, false);
    }
  });

  it("requires the fixed run-eval check contract and can revalidate checks from source state", async () => {
    const blueprint = await loadExample();
    const { runState } = await executeAdmittedRuntimeRun(blueprint, {
      target: "openclaw",
      workspace: "/tmp/workspace",
      message: "ping",
      runId: "canonical-run-eval",
      now: "2026-07-03T00:00:00.000Z",
    });
    const admission = await admitRunStateValue(runState);
    const report = await buildRunEvalVerified(admission.value, {
      admission,
      expectStatus: "declared",
    });
    assert.deepEqual(report.checks.map((item) => item.id), RUN_EVAL_CHECK_IDS);
    assert.equal(validateRunEvalArtifact(report, { runState: admission.value }).ok, true);

    const mutations = [
      (candidate) => { candidate.checks = []; },
      (candidate) => { candidate.checks.splice(3, 1); },
      (candidate) => { candidate.checks[3] = JSON.parse(JSON.stringify(candidate.checks[2])); },
      (candidate) => { [candidate.checks[0], candidate.checks[1]] = [candidate.checks[1], candidate.checks[0]]; },
      (candidate) => { candidate.checks[0].id = "renamed"; },
      (candidate) => { candidate.checks[0].pass = false; candidate.ok = false; },
    ];
    for (const mutate of mutations) {
      const candidate = JSON.parse(JSON.stringify(report));
      mutate(candidate);
      assert.equal(validateRunEvalArtifact(candidate, { runState: admission.value }).ok, false);
    }

    const mismatch = await buildRunEvalVerified(admission.value, {
      admission,
      expectStatus: "success",
    });
    const forged = JSON.parse(JSON.stringify(mismatch));
    forged.checks.find((item) => item.id === "expected_status").pass = true;
    forged.ok = true;
    assert.equal(validateRunEvalArtifact(forged).ok, false);
  });

  it("rejects malformed run-state and corrupt run index", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agentmo-run-corrupt-"));
    const statePath = path.join(dir, RUN_STATE_FILENAME);
    const indexPath = path.join(dir, RUN_INDEX_FILENAME);
    await writeFile(statePath, "{nope");
    await writeFile(indexPath, "{nope");
    const digest = digestRawBytes(Buffer.from("{nope", "utf8"));
    await assert.rejects(
      () => loadRunState(statePath, { subject: "run-state", expectedDigest: digest }),
      (error) => error.code === "AGENTMO_ARTIFACT_INVALID_JSON",
    );
    await assert.rejects(
      () => loadRunIndex(dir, { subject: "run-index", expectedDigest: digest }),
      (error) => error.code === "AGENTMO_ARTIFACT_INVALID_JSON",
    );
  });
});
