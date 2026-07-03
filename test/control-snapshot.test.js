import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { buildPlan } from "../src/build-plan.js";
import { createBuildState } from "../src/build-state.js";
import { buildControlSnapshot, formatControlSnapshot } from "../src/control-snapshot.js";
import { executeRuntimeRun } from "../src/run-state.js";

async function loadExample() {
  return JSON.parse(await readFile(new URL("../examples/win9.agentmo.json", import.meta.url), "utf8"));
}

describe("control snapshot", () => {
  it("builds a stable JSON-serializable status snapshot", async () => {
    const blueprint = await loadExample();
    const snapshot = buildControlSnapshot(blueprint);
    const reparsed = JSON.parse(JSON.stringify(snapshot));

    assert.equal(reparsed.schemaVersion, "agentmo.control.v1");
    assert.equal(reparsed.agentId, "win9");
    assert.equal(reparsed.status, "certified");
    assert.equal(reparsed.lifecycle.stage, "certify");
    assert.equal(reparsed.pipeline.completed, 3);
    assert.equal(reparsed.pipeline.total, 3);
    assert.equal(reparsed.qualityGates.failed, 0);
    assert.equal(reparsed.runtime.primary, "pi");
    assert.deepEqual(
      reparsed.runtime.profiles.map((profile) => profile.id),
      ["pi", "openclaw"],
    );
    assert.equal(reparsed.latestBuildState.available, false);
    assert.equal(reparsed.latestBuildState.reason, "not_supplied");
    assert.equal(reparsed.latestRunState.available, false);
    assert.equal(reparsed.latestRunState.reason, "not_supplied");
  });

  it("summarizes supplied build-state target and operation counts", async () => {
    const blueprint = await loadExample();
    const plan = buildPlan(blueprint, { target: "openclaw" });
    const buildState = createBuildState(blueprint, plan, {
      blueprintPath: "examples/win9.agentmo.json",
      generatedAt: "2026-01-01T00:00:00.000Z",
      outputDir: "/tmp/win9-openclaw",
      target: "openclaw",
    });

    const snapshot = buildControlSnapshot(blueprint, { buildState, buildStatePath: "/tmp/win9-openclaw/agentmo-build-state.json" });

    assert.equal(snapshot.latestBuildState.available, true);
    assert.equal(snapshot.latestBuildState.path, "/tmp/win9-openclaw/agentmo-build-state.json");
    assert.equal(snapshot.latestBuildState.target.id, "openclaw");
    assert.equal(snapshot.latestBuildState.operations.domainOperationCount, plan.operations.length);
    assert.equal(snapshot.latestBuildState.operations.recordedOperationCount, plan.operations.length);
    assert.equal(snapshot.latestBuildState.resolution.selectedTargetId, "openclaw");
  });

  it("represents unreadable build-state as unavailable instead of throwing", async () => {
    const blueprint = await loadExample();
    const snapshot = buildControlSnapshot(blueprint, {
      buildStatePath: "/tmp/missing-agentmo-build-state.json",
      buildStateError: "ENOENT",
    });

    assert.equal(snapshot.latestBuildState.available, false);
    assert.match(snapshot.latestBuildState.reason, /unreadable: ENOENT/u);
    assert.match(formatControlSnapshot(snapshot), /Build state: unavailable/u);
  });

  it("summarizes supplied run-state without changing runtime certification", async () => {
    const blueprint = await loadExample();
    const { runState } = await executeRuntimeRun(blueprint, {
      target: "openclaw",
      workspace: "/tmp/agentmo-openclaw-workspace",
      message: "Say exactly: ok",
      runId: "status-run",
      now: "2026-07-03T00:00:00.000Z",
    });

    const snapshot = buildControlSnapshot(blueprint, {
      runState,
      runStatePath: "/tmp/agentmo-runs/runs/status-run/agentmo-run-state.json",
    });

    assert.equal(snapshot.latestRunState.available, true);
    assert.equal(snapshot.latestRunState.usable, true);
    assert.equal(snapshot.latestRunState.path, "/tmp/agentmo-runs/runs/status-run/agentmo-run-state.json");
    assert.equal(snapshot.latestRunState.target.id, "openclaw");
    assert.equal(snapshot.latestRunState.execution.status, "declared");
    assert.equal(snapshot.latestRunState.runtimeIdentity.transport, "unknown");
    assert.equal(snapshot.latestRunState.runtimeIdentity.sandboxScope.usesProductionState, false);
    assert.equal(snapshot.latestRunState.freshness, "current");
    assert.equal(snapshot.runtimeCertification.profiles.find((profile) => profile.id === "openclaw").certificationStatus, "verification_declared");
    assert.match(formatControlSnapshot(snapshot), /Run state: openclaw declared \(current\)/u);
  });

  it("reports stale run-state evidence as unusable and non-authoritative", async () => {
    const blueprint = await loadExample();
    const { runState } = await executeRuntimeRun(blueprint, {
      target: "openclaw",
      workspace: "/tmp/agentmo-openclaw-workspace",
      message: "Say exactly: ok",
      runId: "stale-run",
      now: "2026-07-03T00:00:00.000Z",
    });
    const stale = JSON.parse(JSON.stringify(runState));
    stale.source.blueprintHash = "stale-hash";

    const snapshot = buildControlSnapshot(blueprint, { runState: stale });

    assert.equal(snapshot.latestRunState.available, true);
    assert.equal(snapshot.latestRunState.usable, false);
    assert.equal(snapshot.latestRunState.freshness, "stale");
    assert.equal(snapshot.risks.includes("Latest run-state blueprint hash is stale."), true);
    assert.equal(snapshot.nextActions.includes("Refresh runtime evidence because the run-state blueprint hash is stale."), true);
  });

  it("keeps corrupt or risky run evidence fail-closed in risks and next actions", async () => {
    const blueprint = await loadExample();
    const unreadable = buildControlSnapshot(blueprint, {
      runStatePath: "/tmp/bad-run-state.json",
      runStateError: "Invalid run-state JSON /tmp/bad-run-state.json",
    });
    assert.equal(unreadable.latestRunState.available, false);
    assert.match(unreadable.latestRunState.reason, /unreadable/u);
    assert.equal(unreadable.risks.some((risk) => risk.includes("Latest run-state is unavailable")), true);

    const { runState } = await executeRuntimeRun(blueprint, {
      target: "openclaw",
      workspace: "/tmp/agentmo-openclaw-workspace",
      openClawStateDir: "/tmp/openclaw-state",
      message: "Say exactly: ok",
      live: true,
      runId: "failed-run",
      now: "2026-07-03T00:00:00.000Z",
    }, async () => ({ exitCode: 1, stdout: "", stderr: "failed", timedOut: false, durationMs: 2 }));
    runState.runtimeIdentity.sandboxScope.usesProductionState = true;

    const risky = buildControlSnapshot(blueprint, { runState });
    assert.equal(risky.latestRunState.usable, false);
    assert.equal(risky.latestRunState.execution.status, "failure");
    assert.equal(risky.risks.includes("Latest run-state failed-run recorded execution failure."), true);
    assert.equal(risky.risks.includes("Latest run-state used production OpenClaw state."), true);
    assert.equal(
      risky.nextActions.includes("Inspect failed runtime evidence and create an observe proposal if it indicates a blueprint/scaffold change."),
      true,
    );
    assert.equal(risky.nextActions.includes("Review production OpenClaw state usage before treating run evidence as safe."), true);
  });
});
