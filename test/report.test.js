import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { buildMotherReport, formatMotherReport } from "../src/report.js";

async function loadExample() {
  return JSON.parse(await readFile(new URL("../examples/win9.agentmo.json", import.meta.url), "utf8"));
}

describe("mother report", () => {
  it("builds a certified report for the Win9 blueprint", async () => {
    const blueprint = await loadExample();
    const report = buildMotherReport(blueprint);
    assert.equal(report.kind, "agentmother_report");
    assert.equal(report.ok, true);
    assert.equal(report.lifecycle.stage, "certify");
    assert.equal(report.release_readiness.status, "ready_with_risks");
    assert.equal(report.gates.failed, 0);
  });

  it("formats a readable report", async () => {
    const blueprint = await loadExample();
    const text = formatMotherReport(buildMotherReport(blueprint));
    assert.match(text, /AgentMother report: win9/u);
    assert.match(text, /Runtime profiles: pi, openclaw/u);
    assert.match(text, /Pipeline: discover -> plan -> produce/u);
    assert.match(text, /Quality gates: 8 passed, 0 failed/u);
  });
});
