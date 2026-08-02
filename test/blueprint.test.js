import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { mkdtemp, open, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DESIGN_CONTRACT_VERSION,
  TRANSITIONAL_BLUEPRINT_LOADER_CONSUMERS,
  evaluateQualityGates,
  loadAdmittedBlueprint,
  summarizeBlueprint,
  validateBlueprint,
} from "../src/blueprint.js";

const WIN9_BLUEPRINT = new URL("../examples/win9.agentmo.json", import.meta.url);

function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function loadExample() {
  return JSON.parse(await readFile(WIN9_BLUEPRINT, "utf8"));
}

async function loadSupportExample() {
  return JSON.parse(await readFile(new URL("../examples/support-triage.agentmo.json", import.meta.url), "utf8"));
}

describe("blueprint validation", () => {
  it("admits exact blueprint bytes once and returns authentic provenance input", async () => {
    const bytes = await readFile(WIN9_BLUEPRINT);
    let opens = 0;
    const admission = await loadAdmittedBlueprint(WIN9_BLUEPRINT, {
      subject: "blueprint",
      expectedDigest: digestBytes(bytes),
      openInput: async (...args) => {
        opens += 1;
        return open(...args);
      },
    });

    assert.equal(opens, 1);
    assert.equal(admission.subject, "blueprint");
    assert.equal(admission.identity, "0.1");
    assert.equal(admission.digest, digestBytes(bytes));
    assert.equal(admission.value.agent_id, "win9");
    assert.equal(Object.isFrozen(admission.value), true);
  });

  it("fails closed for legacy, unknown, and wrong-subject blueprint inputs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-blueprint-loader-"));
    const legacy = new URL("./fixtures/migration/legacy-blueprint.json", import.meta.url);
    const legacyBytes = await readFile(legacy);
    await assert.rejects(
      () => loadAdmittedBlueprint(legacy, {
        subject: "blueprint",
        expectedDigest: digestBytes(legacyBytes),
      }),
      (error) => error?.code === "AGENTMO_MIGRATION_REQUIRED",
    );

    const unknownPath = path.join(root, "unknown.json");
    const unknown = await loadExample();
    unknown.agentmo_version = "9.9";
    const unknownBytes = Buffer.from(`${JSON.stringify(unknown, null, 2)}\n`, "utf8");
    await writeFile(unknownPath, unknownBytes);
    await assert.rejects(
      () => loadAdmittedBlueprint(unknownPath, {
        subject: "blueprint",
        expectedDigest: digestBytes(unknownBytes),
      }),
      (error) => error?.code === "AGENTMO_UNSUPPORTED_ARTIFACT",
    );

    const canonicalBytes = await readFile(WIN9_BLUEPRINT);
    await assert.rejects(
      () => loadAdmittedBlueprint(WIN9_BLUEPRINT, {
        subject: "handoff",
        expectedDigest: digestBytes(canonicalBytes),
      }),
      (error) => error?.code === "AGENTMO_UNSUPPORTED_ARTIFACT",
    );
  });

  it("keeps the transitional blueprint loader consumer count at zero", async () => {
    assert.equal(Object.isFrozen(TRANSITIONAL_BLUEPRINT_LOADER_CONSUMERS), true);
    assert.deepEqual(TRANSITIONAL_BLUEPRINT_LOADER_CONSUMERS, {});

    const cliSource = await readFile(new URL("../src/cli.js", import.meta.url), "utf8");
    const transitionalCalls = Array.from(cliSource.matchAll(/await loadBlueprint\(/gu));
    assert.equal(transitionalCalls.length, 0);
    for (const command of [
      "validate", "report", "plan", "handoff", "run-plan", "status", "scaffold",
      "birth-report", "domain-eval", "delivery-report",
    ]) {
      const branch = commandBranch(cliSource, command);
      assert.match(branch, /await loadAdmittedBlueprint\(/u);
      assert.doesNotMatch(branch, /await loadBlueprint\(/u);
    }
    const runBranch = commandBranch(cliSource, "run");
    assert.match(runBranch, /await loadAdmittedArtifact\(/u);
    assert.doesNotMatch(runBranch, /await loadBlueprint\(/u);
  });

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
    assert.equal(blueprint.design_contract.provenance.reviewed, false);
    assert.equal(blueprint.design_contract.provenance.contract_version, DESIGN_CONTRACT_VERSION);
    assert.equal(
      blueprint.governance.policies.includes(
        "AgentMo-generated blueprints preserve exact discovery/user-need provenance but remain draft and non-authoritative until explicit plan approval.",
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

function commandBranch(source, command) {
  const marker = `if (command === "${command}")`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing ${command} branch`);
  const next = source.indexOf("\n  if (command === ", start + marker.length);
  return source.slice(start, next === -1 ? source.length : next);
}
