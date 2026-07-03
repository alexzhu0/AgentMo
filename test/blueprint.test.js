import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { validateBlueprint, evaluateQualityGates, summarizeBlueprint } from "../src/blueprint.js";

async function loadExample() {
  return JSON.parse(await readFile(new URL("../examples/win9.agentmo.json", import.meta.url), "utf8"));
}

describe("blueprint validation", () => {
  it("accepts the Win9 reference blueprint", async () => {
    const blueprint = await loadExample();
    const result = validateBlueprint(blueprint);
    assert.equal(result.ok, true, result.errors.join("\n"));
    assert.equal(result.errors.length, 0);
    assert.equal(evaluateQualityGates(blueprint).every((gate) => gate.status === "pass"), true);
  });

  it("rejects missing required fields", async () => {
    const blueprint = await loadExample();
    delete blueprint.tools;
    const result = validateBlueprint(blueprint);
    assert.equal(result.ok, false);
    assert.equal(result.errors.some((error) => error.includes("Missing required field: tools")), true);
  });

  it("rejects invalid agent ids", async () => {
    const blueprint = await loadExample();
    blueprint.agent_id = "Win9 Agent";
    const result = validateBlueprint(blueprint);
    assert.equal(result.ok, false);
    assert.equal(result.errors.some((error) => error.includes("kebab-case")), true);
  });

  it("summarizes key blueprint shape", async () => {
    const blueprint = await loadExample();
    const summary = summarizeBlueprint(blueprint);
    assert.equal(summary.agent_id, "win9");
    assert.equal(summary.runtime, "pi");
    assert.deepEqual(summary.runtime_profiles, ["pi", "openclaw"]);
    assert.equal(summary.discovery_manifest_path, "win9.discovery.json");
    assert.equal(summary.runtime_certification.find((profile) => profile.id === "openclaw").certification_status, "evidence_disclosed");
    assert.deepEqual(summary.pipeline_phases, ["discover", "plan", "produce"]);
    assert.equal(summary.specialist_count, 9);
    assert.equal(summary.tool_count, 6);
  });

  it("rejects missing pipeline definitions", async () => {
    const blueprint = await loadExample();
    delete blueprint.pipeline.produce.coding_tools;
    const result = validateBlueprint(blueprint);
    assert.equal(result.ok, false);
    assert.equal(result.errors.some((error) => error.includes("pipeline.produce.coding_tools")), true);
    assert.equal(result.errors.some((error) => error.includes("Quality gate failed: pipeline_defined")), true);
  });

  it("accepts OpenClaw as a primary runtime when profiled explicitly", async () => {
    const blueprint = await loadExample();
    blueprint.runtime = "openclaw";
    blueprint.runtime_profiles = blueprint.runtime_profiles.map((profile) =>
      profile.id === "openclaw" ? { ...profile, role: "primary", status: "active" } : { ...profile, role: "alternate" },
    );
    const result = validateBlueprint(blueprint);
    assert.equal(result.ok, true, result.errors.join("\n"));
  });

  it("rejects malformed runtime profile source references", async () => {
    const blueprint = await loadExample();
    blueprint.runtime_profiles[1].source_refs = ["valid", ""];
    const result = validateBlueprint(blueprint);
    assert.equal(result.ok, false);
    assert.equal(
      result.errors.some((error) => error.includes("runtime_profiles[1].source_refs[1]")),
      true,
    );
  });

  it("keeps runtime certification metadata optional but validates it when present", async () => {
    const blueprint = await loadExample();
    delete blueprint.runtime_profiles[0].verification_commands;
    delete blueprint.runtime_profiles[0].unsupported_surfaces;
    const optional = validateBlueprint(blueprint);
    assert.equal(optional.ok, true, optional.errors.join("\n"));
    assert.equal(
      optional.warnings.some((warning) => warning.includes("(pi) is active but lacks verification_commands")),
      true,
    );

    blueprint.runtime_profiles[1].verification_commands = ["npm run check", ""];
    blueprint.runtime_profiles[1].last_verified_at = "recently";
    const malformed = validateBlueprint(blueprint);
    assert.equal(malformed.ok, false);
    assert.equal(
      malformed.errors.some((error) => error.includes("runtime_profiles[1].verification_commands[1]")),
      true,
    );
    assert.equal(
      malformed.errors.some((error) => error.includes("runtime_profiles[1].last_verified_at")),
      true,
    );
  });

  it("validates optional discovery manifest path shape without requiring it", async () => {
    const blueprint = await loadExample();
    delete blueprint.discovery_manifest_path;
    assert.equal(validateBlueprint(blueprint).ok, true);

    blueprint.discovery_manifest_path = "";
    const result = validateBlueprint(blueprint);
    assert.equal(result.ok, false);
    assert.equal(result.errors.some((error) => error.includes("discovery_manifest_path")), true);
  });
});
