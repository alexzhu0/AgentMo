import assert from "node:assert/strict";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  BUILD_CONTRACT_SCHEMA_VERSION,
  buildBuildContract,
  validateBuildContract,
  writeBuildContract,
} from "../src/build-contract.js";
import {
  buildPlanApproval,
  buildPlanApprovalPreview,
  PLAN_APPROVAL_SCHEMA_VERSION,
  validatePlanApproval,
  writePlanApproval,
} from "../src/plan-approval.js";
import {
  admitBuildContract,
  buildSupportContractInputs,
} from "./helpers/build-contract-fixture.js";

function contractOptions(inputs) {
  return {
    target: "openclaw",
    admissions: inputs.admissions,
  };
}

describe("Agent Package build contract", () => {
  it("constructs deterministic exact-bound bytes from authentic Plan authority", async () => {
    const inputs = await buildSupportContractInputs();
    const first = buildBuildContract(
      inputs.values.blueprint,
      inputs.values.designPlan,
      inputs.values.discoveryApproval,
      inputs.values.decisionLedger,
      contractOptions(inputs),
    );
    const second = buildBuildContract(
      inputs.values.blueprint,
      inputs.values.designPlan,
      inputs.values.discoveryApproval,
      inputs.values.decisionLedger,
      contractOptions(inputs),
    );

    assert.deepEqual(second, first);
    assert.equal(first.schemaVersion, BUILD_CONTRACT_SCHEMA_VERSION);
    assert.deepEqual(Object.keys(first.bindings), [
      "blueprint",
      "designPlan",
      "discoveryApproval",
      "decisionLedger",
      "targetDescriptor",
    ]);
    assert.equal(first.bindings.blueprint.digest, inputs.blueprint.digest);
    assert.equal(first.bindings.designPlan.digest, inputs.designPlan.digest);
    assert.equal(first.bindings.discoveryApproval.digest, inputs.discoveryApproval.digest);
    assert.equal(first.bindings.decisionLedger.digest, inputs.decisionLedger.head.digest);
    assert.equal(first.bindings.targetDescriptor.digest, inputs.targetDescriptor.digest);
    assert.equal(validateBuildContract(first).ok, true);

    const root = await mkdtemp(path.join(tmpdir(), "agentmo-build-contract-write-"));
    const firstPath = path.join(root, "first.json");
    const secondPath = path.join(root, "second.json");
    await writeBuildContract(firstPath, first);
    await writeBuildContract(secondPath, first);
    assert.equal(await readFile(secondPath, "utf8"), await readFile(firstPath, "utf8"));
    await assert.rejects(
      () => writeBuildContract(path.join(root, "forged.json"), structuredClone(first)),
      (error) => error?.code === "AGENTMO_PERSISTABILITY_UNADMITTED_CANDIDATE",
    );
  });

  it("rejects one-way, untraced, unowned, and incomplete contract graphs", async () => {
    const inputs = await buildSupportContractInputs();
    const contract = buildBuildContract(
      inputs.values.blueprint,
      inputs.values.designPlan,
      inputs.values.discoveryApproval,
      inputs.values.decisionLedger,
      contractOptions(inputs),
    );
    const mutations = [
      (value) => value.traceGraph.reverseTraceEdges.pop(),
      (value) => value.traceGraph.acceptanceCaseIds.pop(),
      (value) => { value.resources[0].sourceRefs = []; value.resources[0].decisionRefs = []; },
      (value) => { value.resources[0].owner = "phase-4"; },
      (value) => value.permissions.pop(),
      (value) => value.acceptanceCases.pop(),
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(contract);
      mutate(changed);
      assert.equal(validateBuildContract(changed).ok, false);
    }
  });

  it("preflights unsafe candidates before creating output", async () => {
    const inputs = await buildSupportContractInputs();
    const contract = buildBuildContract(
      inputs.values.blueprint,
      inputs.values.designPlan,
      inputs.values.discoveryApproval,
      inputs.values.decisionLedger,
      contractOptions(inputs),
    );
    contract.remainingRisks.push("/Users/operator/private-agent-state");
    const parent = await mkdtemp(path.join(tmpdir(), "agentmo-build-contract-preflight-"));
    const root = path.join(parent, "must-not-exist");
    await assert.rejects(() => writeBuildContract(path.join(root, "contract.json"), contract));
    await assert.rejects(() => access(root));
  });

  it("requires a separate exact preview/apply approval and invalidates every changed input class", async () => {
    const inputs = await buildSupportContractInputs();
    const contract = buildBuildContract(
      inputs.values.blueprint,
      inputs.values.designPlan,
      inputs.values.discoveryApproval,
      inputs.values.decisionLedger,
      contractOptions(inputs),
    );
    const buildContract = await admitBuildContract(inputs.root, contract, {
      blueprint: inputs.blueprint,
      "design-plan": inputs.designPlan,
      "discovery-approval": inputs.discoveryApproval,
    });
    const approvalInputs = {
      admissions: {
        blueprint: inputs.blueprint,
        buildContract,
      },
    };
    const preview = buildPlanApprovalPreview(
      inputs.values.blueprint,
      buildContract.value,
      approvalInputs,
    );
    assert.deepEqual(
      buildPlanApprovalPreview(inputs.values.blueprint, buildContract.value, approvalInputs),
      preview,
    );
    assert.throws(
      () => buildPlanApproval(inputs.values.blueprint, buildContract.value, {
        ...approvalInputs,
        previewDigest: preview.previewDigest,
      }),
      (error) => error?.code === "AGENTMO_PLAN_APPROVAL_REQUIRED",
    );
    const approval = buildPlanApproval(inputs.values.blueprint, buildContract.value, {
      ...approvalInputs,
      approve: true,
      previewDigest: preview.previewDigest,
    });
    assert.equal(approval.schemaVersion, PLAN_APPROVAL_SCHEMA_VERSION);
    assert.equal(approval.decisionScope, "enter-produce");
    assert.equal(approval.certificationBoundary.packageBuilt, false);
    assert.equal(approval.certificationBoundary.runtime, false);
    assert.equal(validatePlanApproval(approval, {
      blueprint: inputs.values.blueprint,
      buildContract: buildContract.value,
      sources: preview.bindings,
    }).ok, true);

    for (const [index, field] of [
      "requirements",
      "capabilities",
      "permissions",
      "acceptanceCases",
      "blueprint",
      "contract",
    ].entries()) {
      const staleSources = structuredClone(preview.bindings);
      const key = field === "blueprint" ? "blueprint" : "buildContract";
      staleSources[key].digest = `sha256:${String(index + 1).repeat(64)}`;
      assert.equal(validatePlanApproval(approval, {
        blueprint: inputs.values.blueprint,
        buildContract: buildContract.value,
        sources: staleSources,
      }).ok, false, field);
    }

    const out = path.join(inputs.root, "plan-approval.json");
    await writePlanApproval(out, approval);
    await assert.rejects(() => writePlanApproval(out, approval));
    await assert.rejects(
      () => writePlanApproval(path.join(inputs.root, "forged-plan-approval.json"), structuredClone(approval)),
      (error) => error?.code === "AGENTMO_PERSISTABILITY_UNADMITTED_CANDIDATE",
    );
  });
});
