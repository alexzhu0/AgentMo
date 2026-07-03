import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildObservationReport, validateObservationRecord } from "../src/observation.js";
import { buildRunObservation, writeRunObservation } from "../src/run-observation.js";
import { executeRuntimeRun, loadRunState, RUN_STATE_FILENAME } from "../src/run-state.js";

async function loadExample() {
  return JSON.parse(await readFile(new URL("../examples/win9.agentmo.json", import.meta.url), "utf8"));
}

describe("run observation proposals", () => {
  it("converts failed run-state evidence into a proposal-only observation", async () => {
    const blueprint = await loadExample();
    const { runState } = await executeRuntimeRun(
      blueprint,
      {
        target: "openclaw",
        workspace: "/tmp/workspace",
        openClawStateDir: "/tmp/openclaw-state",
        message: "ping",
        live: true,
        runId: "failed-run",
        now: "2026-07-03T00:00:00.000Z",
      },
      async () => ({ exitCode: 2, stdout: "", stderr: "bad", timedOut: false, durationMs: 4 }),
    );

    const observation = buildRunObservation(runState, { runStatePath: "/tmp/runs/failed-run/agentmo-run-state.json" });
    const validation = validateObservationRecord(observation);
    const report = buildObservationReport(observation);

    assert.equal(validation.ok, true, validation.errors.join("\n"));
    assert.equal(observation.schemaVersion, "agentmo.observation.v1");
    assert.equal(observation.source, "agentmo-run:failed-run");
    assert.equal(observation.failureMode, "openclaw runtime execution failed with exit code 2");
    assert.deepEqual(observation.evidenceRefs, ["/tmp/runs/failed-run/agentmo-run-state.json", "agentmo-run:failed-run"]);
    assert.equal(observation.runEvidence.executionStatus, "failure");
    assert.equal(observation.runEvidence.certificationBoundary.runtimeCertifiedByRun, false);
    assert.equal(observation.mutation.autoApplied, false);
    assert.equal(report.recommendedBlueprintChange.proposalOnly, true);
    assert.equal(report.mutation.autoApplied, false);
  });

  it("writes observation sidecars without mutating run-state", async () => {
    const blueprint = await loadExample();
    const out = await mkdtemp(path.join(tmpdir(), "agentmo-observe-run-"));
    const run = await executeRuntimeRun(blueprint, {
      target: "openclaw",
      workspace: "/tmp/workspace",
      message: "ping",
      out,
      runId: "declared-run",
      now: "2026-07-03T00:00:00.000Z",
    });
    const stateFile = path.join(out, "runs", "declared-run", RUN_STATE_FILENAME);
    const before = JSON.stringify(await loadRunState(stateFile));
    const observation = buildRunObservation(run.runState, { runStatePath: stateFile });
    const observationFile = await writeRunObservation(path.join(out, "declared-run.observation.json"), observation);
    const saved = JSON.parse(await readFile(observationFile, "utf8"));
    const after = JSON.stringify(await loadRunState(stateFile));

    assert.equal(saved.source, "agentmo-run:declared-run");
    assert.equal(saved.failureMode, "openclaw runtime execution is declared but not live-verified");
    assert.equal(before, after);
  });
});
