import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  buildBuildContract,
  validateBuildContract,
} from "../src/build-contract.js";
import {
  PackageCarrierError,
  assertApprovedHookCarrierConsistency,
  selectPackageCarriers,
} from "../src/package-carriers.js";
import { serializePersistableJson } from "../src/persistability.js";
import { buildSupportContractInputs } from "./helpers/build-contract-fixture.js";

const ABSTRACT_HOOKS = [
  "after-attempt",
  "after-tool",
  "before-attempt",
  "before-checkpoint",
];
const EVENT_BY_HOOK = {
  "after-attempt": "agent_end",
  "after-tool": "after_tool_call",
  "before-attempt": "before_agent_run",
  "before-checkpoint": "before_compaction",
};
const sha256 = (bytes) => (
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`
);

async function currentContract() {
  const inputs = await buildSupportContractInputs();
  return buildBuildContract(
    inputs.values.blueprint,
    inputs.values.designPlan,
    inputs.values.discoveryApproval,
    inputs.values.decisionLedger,
    { target: "openclaw", admissions: inputs.admissions },
  );
}

function approvedRecipe() {
  const files = [
    ["openclaw/plugin/index.js", 0o755, "export default function register(api) { api.registerHook({}); }\n"],
    ["openclaw/plugin/openclaw.plugin.json", 0o644, "{\"id\":\"agentmo-openclaw-harness\"}\n"],
  ].map(([relativePath, mode, content]) => ({
    relativePath,
    type: "file",
    mode,
    content,
    byteLength: Buffer.byteLength(content, "utf8"),
    sha256: sha256(Buffer.from(content, "utf8")),
  }));
  const basis = {
    schemaVersion: "agentmo.native-plugin-recipe.v1",
    owner: "agentmo-openclaw-harness",
    files,
  };
  return {
    ...basis,
    recipeDigest: sha256(Buffer.from(serializePersistableJson(basis, {
      subject: "native-plugin-recipe",
    }), "utf8")),
  };
}

async function reapprovedSuccessor() {
  const contract = structuredClone(await currentContract());
  const recipe = approvedRecipe();
  contract.specification.plugins.selectedLane = "workspace-local";
  contract.specification.plugins.phase3Reapproval = {
    authority: "exact-build-contract-bytes",
    decision: "approve-package-local-native-plugin",
    recipe,
    hookMappings: ABSTRACT_HOOKS.map((abstractHook) => ({
      abstractHook,
      openclawEvent: EVENT_BY_HOOK[abstractHook],
      owner: recipe.owner,
      recipeDigest: recipe.recipeDigest,
      versionRange: "2026.7.1-2@0790d9f",
      permission: abstractHook === "after-tool"
        ? "observe-bounded-tool-result-metadata"
        : "observe-bounded-agent-lifecycle",
      timeoutMs: 5000,
      failureSemantics: "fail-closed",
      unsupportedBehavior: ["automatic-external-plugin-install"],
    })),
  };
  return contract;
}

describe("lowest-trust package carrier selection", () => {
  it("fails the current exact Phase 3 contract because no bundled hook owner is approved", async () => {
    const contract = await currentContract();
    assert.equal(validateBuildContract(contract).ok, true);
    assert.deepEqual(contract.specification.loop.hooks, [
      "before-attempt",
      "after-tool",
      "before-checkpoint",
      "after-attempt",
    ]);
    assert.equal(contract.specification.plugins.selectedLane, "bundled");
    assert.throws(
      () => assertApprovedHookCarrierConsistency(contract),
      (error) => (
        error instanceof PackageCarrierError
        && error.code === "AGENTMO_PACKAGE_HOOK_OWNER_UNAPPROVED"
        && error.errors.includes("OpenClaw 2026.7.1-2@0790d9f has no approved bundled owner for before-attempt.")
      ),
    );
    assert.throws(
      () => selectPackageCarriers(contract),
      (error) => error?.code === "AGENTMO_PACKAGE_HOOK_OWNER_UNAPPROVED",
    );
  });

  it("accepts only a Phase 3-reapproved package-local recipe with all four exact event mappings", async () => {
    const contract = await reapprovedSuccessor();
    const result = assertApprovedHookCarrierConsistency(contract);
    assert.equal(result.carrier, "native-plugin");
    assert.equal(result.owner, "agentmo-openclaw-harness");
    assert.deepEqual(result.hooks.map(({ abstractHook }) => abstractHook), ABSTRACT_HOOKS);
    assert.deepEqual(
      Object.fromEntries(result.hooks.map(({ abstractHook, openclawEvent }) => (
        [abstractHook, openclawEvent]
      ))),
      EVENT_BY_HOOK,
    );
    assert.equal(result.recipe.files.every((entry) => !Object.hasOwn(entry, "sourcePath")), true);
    assert.equal(Object.hasOwn(result.recipe, "implementationPath"), false);
    assert.equal(Object.isFrozen(result), true);
  });

  it("rejects a hook declaration lacking any canonical recipe or mapping authority", async () => {
    const mutations = [
      (value) => { delete value.specification.plugins.phase3Reapproval.recipe; },
      (value) => { value.specification.plugins.phase3Reapproval.recipe.files[0].relativePath = "../plugin.js"; },
      (value) => { value.specification.plugins.phase3Reapproval.recipe.files[0].type = "symlink"; },
      (value) => { value.specification.plugins.phase3Reapproval.recipe.files[0].content = "drift\n"; },
      (value) => { value.specification.plugins.phase3Reapproval.recipe.files[0].mode = 0o777; },
      (value) => { value.specification.plugins.phase3Reapproval.recipe.files[0].byteLength += 1; },
      (value) => { value.specification.plugins.phase3Reapproval.recipe.files[0].sha256 = sha256("drift"); },
      (value) => { value.specification.plugins.phase3Reapproval.recipe.files.reverse(); },
      (value) => { value.specification.plugins.phase3Reapproval.hookMappings.pop(); },
      (value) => { value.specification.plugins.phase3Reapproval.hookMappings[0].openclawEvent = null; },
      (value) => { value.specification.plugins.phase3Reapproval.hookMappings[0].owner = "caller"; },
      (value) => { value.specification.plugins.phase3Reapproval.hookMappings[0].recipeDigest = sha256("other"); },
      (value) => { value.specification.plugins.phase3Reapproval.hookMappings[0].versionRange = "*"; },
      (value) => { value.specification.plugins.phase3Reapproval.hookMappings[0].permission = ""; },
      (value) => { value.specification.plugins.phase3Reapproval.hookMappings[0].timeoutMs = 0; },
      (value) => { value.specification.plugins.phase3Reapproval.hookMappings[0].failureSemantics = "ignore"; },
      (value) => { value.specification.plugins.phase3Reapproval.hookMappings[0].unsupportedBehavior = []; },
      (value) => { value.specification.plugins.phase3Reapproval.implementationPath = "/tmp/plugin.js"; },
    ];
    for (const mutate of mutations) {
      const changed = await reapprovedSuccessor();
      mutate(changed);
      assert.throws(
        () => assertApprovedHookCarrierConsistency(changed),
        (error) => error instanceof PackageCarrierError,
      );
    }
  });

  it("uses workspace content and skills below native plugin trust and emits no speculative MCP", async () => {
    const selection = selectPackageCarriers(await reapprovedSuccessor());
    assert.equal(selection.target, "openclaw");
    assert.equal(selection.targetVersion, "2026.7.1-2@0790d9f");
    assert.equal(selection.entries.some(({ carrier }) => carrier === "mcp"), false);
    assert.equal(
      selection.entries.find(({ capabilityId }) => capabilityId === "resource:skills")?.carrier,
      "skill",
    );
    assert.equal(
      selection.entries.find(({ capabilityId }) => capabilityId === "resource:workspace-context")
        ?.carrier,
      "workspace-content",
    );
    assert.equal(
      selection.entries.find(({ capabilityId }) => capabilityId === "hook:before-attempt")
        ?.carrier,
      "native-plugin",
    );
    assert.equal(Object.isFrozen(selection), true);
  });

  it("rejects missing or duplicated Phase 3 resources before carrier selection", async () => {
    const missing = await reapprovedSuccessor();
    missing.resources.pop();
    assert.throws(
      () => selectPackageCarriers(missing),
      (error) => error?.code === "AGENTMO_PACKAGE_BUILD_CONTRACT_INVALID",
    );

    const duplicated = await reapprovedSuccessor();
    duplicated.resources.push(structuredClone(duplicated.resources[0]));
    assert.throws(
      () => selectPackageCarriers(duplicated),
      (error) => error?.code === "AGENTMO_PACKAGE_BUILD_CONTRACT_INVALID",
    );
  });
});
