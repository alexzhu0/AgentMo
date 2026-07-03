import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { buildPlan } from "../src/build-plan.js";
import { assertTargetAdapter, getTargetAdapter, listTargetIds, listTargets } from "../src/targets/registry.js";

async function loadExample() {
  return JSON.parse(await readFile(new URL("../examples/win9.agentmo.json", import.meta.url), "utf8"));
}

describe("target registry", () => {
  it("lists AgentMo and OpenClaw targets in deterministic order", () => {
    assert.deepEqual(listTargetIds(), ["agentmo", "openclaw"]);
    assert.deepEqual(
      listTargets().map((target) => target.id),
      ["agentmo", "openclaw"],
    );
  });

  it("exposes the minimal target adapter contract", async () => {
    const blueprint = await loadExample();
    for (const id of listTargetIds()) {
      const adapter = getTargetAdapter(id);
      assert.equal(adapter.id, id);
      assert.equal(typeof adapter.label, "string");
      assert.equal(typeof adapter.supports, "function");
      assert.equal(typeof adapter.planOperations, "function");
      assert.equal(Array.isArray(adapter.verificationHints), true);
      assert.equal(adapter.supports(blueprint), true);
      const operations = adapter.planOperations(blueprint, {
        selectedTargetId: id,
        selectedProfileId: blueprint.runtime,
        selectedModuleIds: ["default"],
      });
      assert.equal(operations.length > 0, true);
      assert.equal(operations.every((operation) => operation.kind === "write-file"), true);
      assert.equal(operations.every((operation) => typeof operation.relativePath === "string"), true);
    }
  });

  it("throws clear unknown-target errors", () => {
    assert.throws(() => assertTargetAdapter("missing"), /Unknown target: missing. Expected one of: agentmo, openclaw/u);
  });

  it("uses default and explicit target resolution deterministically", async () => {
    const blueprint = await loadExample();
    assert.equal(buildPlan(blueprint).selectedTargetId, "agentmo");
    assert.equal(buildPlan(blueprint, { target: "openclaw" }).selectedTargetId, "openclaw");
    assert.throws(() => buildPlan(blueprint, { target: "missing" }), /Unknown target: missing/u);
  });

  it("honors explicit profile selection and stable missing-profile warnings", async () => {
    const blueprint = await loadExample();
    assert.equal(buildPlan(blueprint, { target: "openclaw", profileId: "pi" }).selectedProfileId, "pi");

    const missing = buildPlan(blueprint, { target: "agentmo", profileId: "missing" });
    assert.equal(missing.selectedProfileId, null);
    assert.deepEqual(missing.warnings, ["Requested runtime profile missing was not found; selectedProfileId is null."]);
  });

  it("falls back to null when no runtime profiles are available", async () => {
    const blueprint = await loadExample();
    delete blueprint.runtime_profiles;
    const plan = buildPlan(blueprint, { target: "openclaw" });
    assert.equal(plan.selectedProfileId, null);
    assert.deepEqual(plan.selectedModuleIds, ["default"]);
    assert.deepEqual(plan.warnings, [
      "No runtime profile matched target openclaw runtime openclaw; selectedProfileId is null.",
      "runtime_profiles is not set; AgentMother can model multiple runtime architectures such as pi and openclaw.",
    ]);
  });
});
