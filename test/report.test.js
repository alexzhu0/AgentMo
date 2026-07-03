import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildMotherReport, formatMotherReport } from "../src/report.js";

async function loadExample() {
  return JSON.parse(await readFile(new URL("../examples/win9.agentmo.json", import.meta.url), "utf8"));
}

const EXAMPLES_DIR = fileURLToPath(new URL("../examples/", import.meta.url));

describe("mother report", () => {
  it("builds a certified report for the Win9 blueprint", async () => {
    const blueprint = await loadExample();
    const report = buildMotherReport(blueprint, { baseDir: EXAMPLES_DIR });
    assert.equal(report.kind, "agentmother_report");
    assert.equal(report.ok, true);
    assert.equal(report.lifecycle.stage, "certify");
    assert.equal(report.release_readiness.status, "ready_with_risks");
    assert.equal(report.gates.failed, 0);
    assert.equal(report.runtime_certification.find((profile) => profile.id === "openclaw").certification_status, "evidence_disclosed");
    assert.equal(report.discovery.loaded, true);
    assert.equal(report.discovery.summary.source_count, 3);
  });

  it("formats a readable report", async () => {
    const blueprint = await loadExample();
    const text = formatMotherReport(buildMotherReport(blueprint, { baseDir: EXAMPLES_DIR }));
    assert.match(text, /AgentMother report: win9/u);
    assert.match(text, /Runtime profiles: pi, openclaw/u);
    assert.match(text, /Runtime certification:/u);
    assert.match(text, /openclaw: evidence_disclosed/u);
    assert.match(text, /Discovery:/u);
    assert.match(text, /Pipeline: discover -> plan -> produce/u);
    assert.match(text, /Quality gates: 8 passed, 0 failed/u);
  });

  it("reports certification disclosure warnings without claiming OpenClaw certification", async () => {
    const blueprint = await loadExample();
    delete blueprint.runtime_profiles[1].verification_commands;
    const report = buildMotherReport(blueprint, { baseDir: EXAMPLES_DIR });
    const openclaw = report.runtime_certification.find((profile) => profile.id === "openclaw");
    assert.equal(openclaw.certification_status, "needs_disclosure");
    assert.equal(
      report.warnings.some((warning) => warning.includes("(openclaw) is active but lacks verification_commands")),
      true,
    );
    assert.equal(report.summary.runtime, "pi");
  });
});
