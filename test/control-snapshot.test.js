import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { buildPlan } from "../src/build-plan.js";
import { createBuildState } from "../src/build-state.js";
import { buildControlSnapshot, formatControlSnapshot } from "../src/control-snapshot.js";

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
});
