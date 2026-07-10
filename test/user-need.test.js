import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { buildUserNeedReport, validateUserNeed } from "../src/user-need.js";

async function loadSupportNeed() {
  return JSON.parse(await readFile(new URL("../examples/support-triage.need.json", import.meta.url), "utf8"));
}

describe("user need", () => {
  it("validates and summarizes a concrete user-need brief", async () => {
    const need = await loadSupportNeed();
    const report = buildUserNeedReport(need);
    assert.equal(report.kind, "agentmo_user_need_report");
    assert.equal(report.ok, true);
    assert.equal(report.summary.agent_id, "support-triage");
    assert.equal(report.summary.primary_task_count, 3);
    assert.equal(report.summary.hard_failure_count, 4);
  });

  it("fails closed when required need fields are missing", async () => {
    const need = await loadSupportNeed();
    delete need.output_preferences;
    const validation = validateUserNeed(need);
    assert.equal(validation.ok, false);
    assert.match(validation.errors.join("\n"), /output_preferences must be an object/u);
  });

  it("fails closed when user-need input contains secret-like values", async () => {
    const need = await loadSupportNeed();
    need.problem = "Support flow api_key=secret-value-123456 should not be accepted.";
    const validation = validateUserNeed(need);
    assert.equal(validation.ok, false);
    assert.match(validation.errors.join("\n"), /secret-like string values are not allowed/u);
  });

  it("fails closed when source refs are not bounded review refs", async () => {
    const need = await loadSupportNeed();
    need.source_refs = ["../AgentHarness/README.md"];
    const validation = validateUserNeed(need);
    assert.equal(validation.ok, false);
    assert.match(validation.errors.join("\n"), /source_refs/);
  });

});
