import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildBirthReport } from "../src/birth-report.js";
import { BUILD_STATE_FILENAME } from "../src/build-state.js";
import { buildRunEval, executeRuntimeRun } from "../src/run-state.js";
import { scaffoldAgent } from "../src/scaffold.js";

async function loadExample() {
  return JSON.parse(await readFile(new URL("../examples/win9.agentmo.json", import.meta.url), "utf8"));
}

describe("birth report", () => {
  it("passes a declared birth gate without certifying runtime/domain behavior", async () => {
    const blueprint = await loadExample();
    const scaffoldDir = await mkdtemp(path.join(tmpdir(), "agentmo-birth-scaffold-"));
    await scaffoldAgent(blueprint, scaffoldDir, { target: "openclaw" });
    const buildState = JSON.parse(await readFile(path.join(scaffoldDir, BUILD_STATE_FILENAME), "utf8"));
    const { runState } = await executeRuntimeRun(blueprint, {
      target: "openclaw",
      workspace: "/tmp/workspace",
      message: "Say exactly: ok",
      runId: "birth-declared",
      now: "2026-07-06T00:00:00.000Z",
    });
    const runEval = buildRunEval(runState, { expectStatus: "declared" });
    const report = buildBirthReport(blueprint, { buildState, runState, runEval, expectStatus: "declared" });
    assert.equal(report.schemaVersion, "agentmo.birth-report.v1");
    assert.equal(report.ok, true, report.checks.filter((check) => !check.pass).map((check) => check.id).join(", "));
    assert.equal(report.artifactValid, true);
    assert.equal(report.birthReady, true);
    assert.equal(report.promotionEligible, false);
    assert.equal(report.birthStatus, "declared-ready");
    assert.equal(report.certificationBoundary.runtimeCertifiedByBirthReport, false);
    assert.match(report.nextActions.join("\n"), /live smoke/u);
  });

  it("fails closed for production-state run evidence", async () => {
    const blueprint = await loadExample();
    const scaffoldDir = await mkdtemp(path.join(tmpdir(), "agentmo-birth-prod-"));
    await scaffoldAgent(blueprint, scaffoldDir, { target: "openclaw" });
    const buildState = JSON.parse(await readFile(path.join(scaffoldDir, BUILD_STATE_FILENAME), "utf8"));
    const { runState } = await executeRuntimeRun(blueprint, {
      target: "openclaw",
      workspace: "/tmp/workspace",
      message: "Say exactly: ok",
      runId: "birth-prod",
      now: "2026-07-06T00:00:00.000Z",
    });
    runState.runtimeIdentity.sandboxScope.usesProductionState = true;
    const runEval = buildRunEval(runState, { expectStatus: "declared" });
    const report = buildBirthReport(blueprint, { buildState, runState, runEval, expectStatus: "declared" });
    assert.equal(report.ok, false);
    assert.equal(report.checks.find((check) => check.id === "sandbox_non_production").pass, false);
    assert.equal(report.birthStatus, "blocked");
  });

  it("fails closed when run-eval does not belong to the supplied run-state", async () => {
    const blueprint = await loadExample();
    const scaffoldDir = await mkdtemp(path.join(tmpdir(), "agentmo-birth-mismatch-"));
    await scaffoldAgent(blueprint, scaffoldDir, { target: "openclaw" });
    const buildState = JSON.parse(await readFile(path.join(scaffoldDir, BUILD_STATE_FILENAME), "utf8"));
    const first = await executeRuntimeRun(blueprint, {
      target: "openclaw",
      workspace: "/tmp/workspace",
      message: "Say exactly: ok",
      runId: "birth-first",
      now: "2026-07-06T00:00:00.000Z",
    });
    const second = await executeRuntimeRun(blueprint, {
      target: "openclaw",
      workspace: "/tmp/workspace",
      message: "Say exactly: ok",
      runId: "birth-second",
      now: "2026-07-06T00:00:00.000Z",
    });
    const runEval = buildRunEval(second.runState, { expectStatus: "declared" });
    const report = buildBirthReport(blueprint, { buildState, runState: first.runState, runEval, expectStatus: "declared" });
    assert.equal(report.ok, false);
    assert.equal(report.checks.find((check) => check.id === "run_eval_run_id").pass, false);
  });

  it("labels explicit failure evidence without declaring readiness", async () => {
    const blueprint = await loadExample();
    const scaffoldDir = await mkdtemp(path.join(tmpdir(), "agentmo-birth-failure-"));
    await scaffoldAgent(blueprint, scaffoldDir, { target: "openclaw" });
    const buildState = JSON.parse(await readFile(path.join(scaffoldDir, BUILD_STATE_FILENAME), "utf8"));
    const { runState } = await executeRuntimeRun(
      blueprint,
      {
        target: "openclaw",
        workspace: "/tmp/workspace",
        openClawStateDir: "/tmp/openclaw-state",
        message: "Say exactly: ok",
        runId: "birth-failure",
        now: "2026-07-06T00:00:00.000Z",
        live: true,
      },
      async () => ({ exitCode: 2, stdout: "", stderr: "", timedOut: false, durationMs: 1 }),
    );
    const runEval = buildRunEval(runState, { expectStatus: "failure" });
    const report = buildBirthReport(blueprint, { buildState, runState, runEval, expectStatus: "failure" });
    assert.equal(report.ok, true);
    assert.equal(report.artifactValid, true);
    assert.equal(report.birthReady, false);
    assert.equal(report.promotionEligible, false);
    assert.equal(report.evidenceLevel, "failure");
    assert.equal(report.birthStatus, "failure-evidence");
    assert.notEqual(report.birthStatus, "declared-ready");
  });

  it("passes live-success evidence for an isolated fake live run", async () => {
    const blueprint = await loadExample();
    const scaffoldDir = await mkdtemp(path.join(tmpdir(), "agentmo-birth-live-"));
    await scaffoldAgent(blueprint, scaffoldDir, { target: "openclaw" });
    const buildState = JSON.parse(await readFile(path.join(scaffoldDir, BUILD_STATE_FILENAME), "utf8"));
    const { runState } = await executeRuntimeRun(
      blueprint,
      {
        target: "openclaw",
        workspace: "/tmp/workspace",
        openClawStateDir: "/tmp/openclaw-state",
        message: "Say exactly: ok",
        runId: "birth-live",
        now: "2026-07-06T00:00:00.000Z",
        live: true,
      },
      async () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          status: "ok",
          payloads: [{ text: "api_key=secret-value-123456" }],
          meta: { transport: "local" },
        }),
        stderr: "",
        timedOut: false,
        durationMs: 1,
      }),
    );
    const runEval = buildRunEval(runState, { expectStatus: "success" });
    const report = buildBirthReport(blueprint, { buildState, runState, runEval, expectStatus: "success" });
    assert.equal(runState.evidence.rawOutputPreviewStored, false);
    assert.equal(runState.evidence.stdoutSummaryKind, "structured-json-summary");
    assert.equal(JSON.stringify(runState).includes("secret-value-123456"), false);
    assert.equal(report.ok, true, report.checks.filter((check) => !check.pass).map((check) => check.id).join(", "));
    assert.equal(report.artifactValid, true);
    assert.equal(report.birthReady, true);
    assert.equal(report.promotionEligible, true);
    assert.equal(report.evidenceLevel, "live-success");
    assert.equal(report.birthStatus, "born");
    assert.equal(report.certificationBoundary.domainCertifiedByBirthReport, false);
  });

  it("fails closed when live evidence stores raw runtime output previews", async () => {
    const blueprint = await loadExample();
    const scaffoldDir = await mkdtemp(path.join(tmpdir(), "agentmo-birth-raw-output-"));
    await scaffoldAgent(blueprint, scaffoldDir, { target: "openclaw" });
    const buildState = JSON.parse(await readFile(path.join(scaffoldDir, BUILD_STATE_FILENAME), "utf8"));
    const { runState } = await executeRuntimeRun(
      blueprint,
      {
        target: "openclaw",
        workspace: "/tmp/workspace",
        openClawStateDir: "/tmp/openclaw-state",
        message: "Say exactly: ok",
        runId: "birth-raw-output",
        now: "2026-07-06T00:00:00.000Z",
        live: true,
      },
      async () => ({ exitCode: 0, stdout: "ok", stderr: "", timedOut: false, durationMs: 1 }),
    );
    const runEval = buildRunEval(runState, { expectStatus: "success" });
    const report = buildBirthReport(blueprint, { buildState, runState, runEval, expectStatus: "success" });
    assert.equal(runEval.ok, false);
    assert.equal(report.ok, false);
    assert.equal(report.artifactValid, false);
    assert.equal(report.birthReady, false);
    assert.equal(report.checks.find((check) => check.id === "raw_output_preview_absent").pass, false);
  });

  it("fails birth-report closed when evidence summary stores raw output despite false flags", async () => {
    const blueprint = await loadExample();
    const scaffoldDir = await mkdtemp(path.join(tmpdir(), "agentmo-birth-raw-summary-"));
    await scaffoldAgent(blueprint, scaffoldDir, { target: "openclaw" });
    const buildState = JSON.parse(await readFile(path.join(scaffoldDir, BUILD_STATE_FILENAME), "utf8"));
    const { runState } = await executeRuntimeRun(
      blueprint,
      {
        target: "openclaw",
        workspace: "/tmp/workspace",
        openClawStateDir: "/tmp/openclaw-state",
        message: "Say exactly: ok",
        runId: "birth-raw-summary-evidence",
        now: "2026-07-06T00:00:00.000Z",
        live: true,
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

    const runEval = buildRunEval(runState, { expectStatus: "success" });
    const report = buildBirthReport(blueprint, { buildState, runState, runEval, expectStatus: "success" });
    assert.equal(runState.execution.stdout.summaryKind, "structured-json-summary");
    assert.equal(runEval.ok, false);
    assert.equal(report.ok, false);
    assert.equal(report.birthReady, false);
    assert.equal(runEval.checks.find((check) => check.id === "raw_output_preview_absent").pass, false);
    assert.equal(report.checks.find((check) => check.id === "raw_output_preview_absent").pass, false);
  });

  it("fails birth-report closed when live provider env evidence is missing", async () => {
    const blueprint = await loadExample();
    const scaffoldDir = await mkdtemp(path.join(tmpdir(), "agentmo-birth-missing-env-"));
    await scaffoldAgent(blueprint, scaffoldDir, { target: "openclaw" });
    const buildState = JSON.parse(await readFile(path.join(scaffoldDir, BUILD_STATE_FILENAME), "utf8"));
    const { runState } = await executeRuntimeRun(
      blueprint,
      {
        target: "openclaw",
        workspace: "/tmp/workspace",
        openClawStateDir: "/tmp/openclaw-state",
        provider: "deepseek",
        envFile: "/tmp/agentmo/.env",
        envFileContent: "DEEPSEEK_API_KEY=deepseek-secret-value\n",
        message: "Say exactly: ok",
        runId: "birth-missing-env",
        now: "2026-07-06T00:00:00.000Z",
        live: true,
      },
      async () => ({ exitCode: 0, stdout: JSON.stringify({ status: "ok", payloads: [], meta: { transport: "local" } }), stderr: "", timedOut: false, durationMs: 1 }),
    );
    runState.runtimeIdentity.runtimeEnv = null;
    const runEval = buildRunEval(runState, { expectStatus: "success" });
    const report = buildBirthReport(blueprint, { buildState, runState, runEval, expectStatus: "success" });

    assert.equal(runEval.ok, false);
    assert.equal(report.ok, false);
    assert.equal(report.checks.find((check) => check.id === "runtime_env_ready").pass, false);
  });

  it("fails birth-report closed when timeout cleanup cannot prove process-group closure", async () => {
    const blueprint = await loadExample();
    const scaffoldDir = await mkdtemp(path.join(tmpdir(), "agentmo-birth-process-group-"));
    await scaffoldAgent(blueprint, scaffoldDir, { target: "openclaw" });
    const buildState = JSON.parse(await readFile(path.join(scaffoldDir, BUILD_STATE_FILENAME), "utf8"));
    const { runState } = await executeRuntimeRun(
      blueprint,
      {
        target: "openclaw",
        workspace: "/tmp/workspace",
        openClawStateDir: "/tmp/openclaw-state",
        message: "Say exactly: ok",
        runId: "birth-timeout-cleanup-failed",
        now: "2026-07-06T00:00:00.000Z",
        live: true,
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
    const runEval = buildRunEval(runState, { expectStatus: "failure" });
    runEval.ok = true;
    runEval.checks = runEval.checks.map((check) => (check.id === "process_group_closed" ? { ...check, pass: true } : check));
    const report = buildBirthReport(blueprint, { buildState, runState, runEval, expectStatus: "failure" });

    assert.equal(report.ok, false);
    assert.equal(report.checks.find((check) => check.id === "process_group_closed").pass, false);
  });

  it("fails birth-report closed when timeout cleanup uses unsupported process-group verification", async () => {
    const blueprint = await loadExample();
    const scaffoldDir = await mkdtemp(path.join(tmpdir(), "agentmo-birth-unsupported-process-group-"));
    await scaffoldAgent(blueprint, scaffoldDir, { target: "openclaw" });
    const buildState = JSON.parse(await readFile(path.join(scaffoldDir, BUILD_STATE_FILENAME), "utf8"));
    const { runState } = await executeRuntimeRun(
      blueprint,
      {
        target: "openclaw",
        workspace: "/tmp/workspace",
        openClawStateDir: "/tmp/openclaw-state",
        message: "Say exactly: ok",
        runId: "birth-timeout-unsupported-process-group",
        now: "2026-07-06T00:00:00.000Z",
        live: true,
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
    const runEval = buildRunEval(runState, { expectStatus: "failure" });
    const report = buildBirthReport(blueprint, { buildState, runState, runEval, expectStatus: "failure" });

    assert.equal(runEval.ok, false);
    assert.equal(report.ok, false);
    assert.equal(report.checks.find((check) => check.id === "process_group_closed").pass, false);
  });

  it("fails birth-report closed when timeout cleanup lacks a positive process-group proof", async () => {
    const blueprint = await loadExample();
    const scaffoldDir = await mkdtemp(path.join(tmpdir(), "agentmo-birth-missing-process-group-proof-"));
    await scaffoldAgent(blueprint, scaffoldDir, { target: "openclaw" });
    const buildState = JSON.parse(await readFile(path.join(scaffoldDir, BUILD_STATE_FILENAME), "utf8"));
    const invalidProofs = [
      { runId: "birth-timeout-missing-process-group-proof", processGroupVerification: undefined },
      { runId: "birth-timeout-invalid-process-group-proof", processGroupVerification: "unsupported-process-group" },
    ];

    for (const invalidProof of invalidProofs) {
      const { runState } = await executeRuntimeRun(
        blueprint,
        {
          target: "openclaw",
          workspace: "/tmp/workspace",
          openClawStateDir: "/tmp/openclaw-state",
          message: "Say exactly: ok",
          runId: invalidProof.runId,
          now: "2026-07-06T00:00:00.000Z",
          live: true,
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
      const runEval = buildRunEval(runState, { expectStatus: "failure" });
      runEval.ok = true;
      runEval.checks = runEval.checks.map((check) => (check.id === "process_group_closed" ? { ...check, pass: true } : check));
      const report = buildBirthReport(blueprint, { buildState, runState, runEval, expectStatus: "failure" });

      assert.equal(report.ok, false);
      assert.equal(report.checks.find((check) => check.id === "process_group_closed").pass, false);
    }
  });
});
