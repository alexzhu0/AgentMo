import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildBuildContract,
  OPENCLAW_RESOURCE_KINDS,
  validateBuildContract,
} from "../src/build-contract.js";
import { buildSupportContractInputs } from "./helpers/build-contract-fixture.js";

async function supportContract() {
  const inputs = await buildSupportContractInputs();
  return buildBuildContract(
    inputs.values.blueprint,
    inputs.values.designPlan,
    inputs.values.discoveryApproval,
    inputs.values.decisionLedger,
    { target: "openclaw", admissions: inputs.admissions },
  );
}

describe("OpenClaw resource projection closure", () => {
  it("projects every required family exactly once with one owner and Phase 3/4/5 lifecycle", async () => {
    const contract = await supportContract();
    assert.deepEqual(
      contract.resources.map(({ kind }) => kind),
      OPENCLAW_RESOURCE_KINDS,
    );
    assert.equal(new Set(contract.resources.map(({ id }) => id)).size, OPENCLAW_RESOURCE_KINDS.length);
    for (const resource of contract.resources) {
      assert.equal(resource.owner, "phase-3");
      assert.deepEqual(resource.lifecycle, {
        declared: "phase-3",
        materialized: "phase-4",
        verified: "phase-5",
      });
      assert.equal(resource.sourceRefs.length + resource.decisionRefs.length > 0, true);
      assert.equal(resource.requirementRefs.length > 0, true);
      assert.equal(typeof resource.projection.disposition, "string");
      assert.equal(resource.evidenceObligationRefs.length > 0, true);
    }
  });

  it("rejects omitted, duplicated, conflicting, and silently projected resources", async () => {
    const contract = await supportContract();
    const mutations = [
      (value) => value.resources.pop(),
      (value) => value.resources.push(structuredClone(value.resources[0])),
      (value) => { value.resources[1].id = value.resources[0].id; },
      (value) => { value.resources[0].projection = {}; },
      (value) => { value.resources[0].lifecycle.verified = "phase-4"; },
      (value) => { value.resources[0].evidenceObligationRefs = []; },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(contract);
      mutate(changed);
      assert.equal(validateBuildContract(changed).ok, false);
    }
  });
});
