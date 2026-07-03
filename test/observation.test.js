import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { buildObservationReport, validateObservationRecord } from "../src/observation.js";

async function loadExample() {
  return JSON.parse(await readFile(new URL("../examples/win9.observation.json", import.meta.url), "utf8"));
}

describe("observation records", () => {
  it("accepts the Win9 observation example", async () => {
    const observation = await loadExample();
    const result = validateObservationRecord(observation);
    assert.equal(result.ok, true, result.errors.join("\n"));

    const report = buildObservationReport(observation);
    assert.equal(report.schemaVersion, "agentmo.observation-report.v1");
    assert.equal(report.ok, true);
    assert.equal(report.summary.agentId, "win9");
    assert.equal(report.summary.evidenceRefCount, 2);
    assert.equal(report.recommendedBlueprintChange.proposalOnly, true);
    assert.equal(report.mutation.autoApplied, false);
  });

  it("rejects observations without evidence refs", async () => {
    const observation = await loadExample();
    observation.evidenceRefs = [];
    const result = validateObservationRecord(observation);
    assert.equal(result.ok, false);
    assert.equal(result.errors.some((error) => error.includes("evidenceRefs")), true);
  });

  it("rejects observations without a failure mode", async () => {
    const observation = await loadExample();
    delete observation.failureMode;
    const result = validateObservationRecord(observation);
    assert.equal(result.ok, false);
    assert.equal(result.errors.some((error) => error.includes("failureMode")), true);
  });

  it("treats recommended blueprint changes as proposals only", async () => {
    const observation = await loadExample();
    const before = JSON.stringify(observation);
    const report = buildObservationReport(observation);

    assert.equal(JSON.stringify(observation), before);
    assert.equal(report.recommendedBlueprintChange.proposalOnly, true);
    assert.equal(report.mutation.autoApplied, false);
  });
});
