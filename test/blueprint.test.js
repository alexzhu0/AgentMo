import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { DESIGN_CONTRACT_VERSION, validateBlueprint, evaluateQualityGates, summarizeBlueprint } from "../src/blueprint.js";

async function loadExample() {
  return JSON.parse(await readFile(new URL("../examples/win9.agentmo.json", import.meta.url), "utf8"));
}

async function loadSupportExample() {
  return JSON.parse(await readFile(new URL("../examples/support-triage.agentmo.json", import.meta.url), "utf8"));
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

  it("accepts bounded design-contract provenance when present", async () => {
    const blueprint = await loadSupportExample();
    const result = validateBlueprint(blueprint);
    assert.equal(result.ok, true, result.errors.join("\n"));
    assert.equal(blueprint.design_contract.provenance.source, "agentmo-stage2");
    assert.equal(blueprint.design_contract.provenance.reviewed, true);
    assert.equal(blueprint.design_contract.provenance.contract_version, DESIGN_CONTRACT_VERSION);
    assert.equal(
      blueprint.governance.policies.includes(
        "AgentMo-generated blueprints must preserve reviewed discovery/user-need provenance; Stage 3 admission is by valid design contract.",
      ),
      true,
    );
    assert.equal(blueprint.governance.policies.includes("discover-plan-produce order is mandatory"), false);
  });

  it("keeps design-contract provenance optional but validates it when present", async () => {
    const blueprint = await loadExample();
    assert.equal(validateBlueprint(blueprint).ok, true);

    blueprint.design_contract = { provenance: { source: "unreviewed", reviewed: "yes", contract_version: "old", notes: "" } };
    const malformed = validateBlueprint(blueprint);
    assert.equal(malformed.ok, false);
    assert.equal(malformed.errors.some((error) => error.includes("design_contract.provenance.source")), true);
    assert.equal(malformed.errors.some((error) => error.includes("design_contract.provenance.reviewed must be a boolean")), true);
    assert.equal(malformed.errors.some((error) => error.includes("design_contract.provenance.contract_version")), true);
    assert.equal(malformed.errors.some((error) => error.includes("design_contract.provenance.notes")), true);

    blueprint.design_contract = {
      provenance: {
        source: "external-reviewed",
        reviewed: false,
        review_ref: "api_key=secret-value-123456",
        contract_version: DESIGN_CONTRACT_VERSION,
        notes: "Reviewed outside AgentMo.",
      },
    };
    const secretLike = validateBlueprint(blueprint);
    assert.equal(secretLike.ok, false);
    assert.equal(secretLike.errors.some((error) => error.includes("reviewed must be true for external-reviewed")), true);
    assert.equal(secretLike.errors.some((error) => error.includes("secret-like string values")), true);
  });
});
