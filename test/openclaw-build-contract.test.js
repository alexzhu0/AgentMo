import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  admitNativePluginRecipe,
  buildBuildContract,
  computeNativePluginRecipeDigest,
  validateBuildContract,
} from "../src/build-contract.js";
import {
  buildPlanApproval,
  buildPlanApprovalPreview,
  validatePlanApproval,
} from "../src/plan-approval.js";
import {
  OPENCLAW_TARGET_DESCRIPTOR_SCHEMA_VERSION,
} from "../src/openclaw-target-descriptor.js";
import { serializePersistableJson } from "../src/persistability.js";
import { buildSupportContractInputs } from "./helpers/build-contract-fixture.js";

const sha256 = (bytes) => (
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`
);
const CLI = fileURLToPath(new URL("../bin/agentmo.js", import.meta.url));

function canonicalRecipe() {
  const files = [
    {
      relativePath: "openclaw/plugin/index.js",
      type: "file",
      mode: 0o644,
      encoding: "utf8",
      content: [
        "export default function register(api) {",
        "  api.on(\"before_agent_run\", async () => undefined);",
        "  api.on(\"after_tool_call\", async () => undefined);",
        "  api.on(\"before_compaction\", async () => undefined);",
        "  api.on(\"agent_end\", async () => undefined);",
        "}",
        "",
      ].join("\n"),
    },
    {
      relativePath: "openclaw/plugin/openclaw.plugin.json",
      type: "file",
      mode: 0o644,
      encoding: "utf8",
      content: `${JSON.stringify({
        id: "agentmo-openclaw-harness",
        name: "AgentMo OpenClaw Harness",
        version: "1.0.0",
        entry: "index.js",
      }, null, 2)}\n`,
    },
  ].map((file) => ({
    ...file,
    byteLength: Buffer.byteLength(file.content, "utf8"),
    sha256: sha256(Buffer.from(file.content, "utf8")),
  }));
  const recipe = {
    schemaVersion: "agentmo.native-plugin-recipe.v1",
    owner: "agentmo-openclaw-harness",
    files,
    hookMappings: [
      ["after-attempt", "agent_end", "observe-attempt-completion"],
      ["after-tool", "after_tool_call", "observe-tool-result-metadata"],
      ["before-attempt", "before_agent_run", "enforce-attempt-boundary"],
      ["before-checkpoint", "before_compaction", "enforce-checkpoint-boundary"],
    ].map(([abstractHook, openclawEvent, permission]) => ({
      abstractHook,
      openclawEvent,
      owner: "agentmo-openclaw-harness",
      versionRange: "2026.7.1-2@0790d9f",
      permission,
      timeoutMs: 5000,
      failureSemantics: "fail-closed",
      unsupportedBehavior: ["automatic-external-plugin-install"],
    })),
  };
  return {
    ...recipe,
    recipeDigest: computeNativePluginRecipeDigest(recipe),
  };
}

async function supportContract({ withRecipe = false, includeInputs = false } = {}) {
  const inputs = await buildSupportContractInputs();
  let recipe;
  let recipeAdmission;
  if (withRecipe) {
    recipe = canonicalRecipe();
    const recipePath = path.join(inputs.root, "native-plugin-recipe.json");
    const bytes = Buffer.from(serializePersistableJson(recipe, {
      subject: "native-plugin-recipe",
    }), "utf8");
    await writeFile(recipePath, bytes);
    recipeAdmission = await admitNativePluginRecipe({
      filePath: recipePath,
      expectedDigest: sha256(bytes),
    });
    recipe = recipeAdmission.value;
  }
  const contract = buildBuildContract(
    inputs.values.blueprint,
    inputs.values.designPlan,
    inputs.values.discoveryApproval,
    inputs.values.decisionLedger,
    {
      target: "openclaw",
      admissions: inputs.admissions,
      ...(withRecipe ? { nativePluginRecipe: recipe, nativePluginRecipeAdmission: recipeAdmission } : {}),
    },
  );
  return includeInputs ? { contract, inputs } : contract;
}

describe("OpenClaw build-contract binding", () => {
  it("requires an exact data-bound target descriptor rather than source constants", async () => {
    const inputs = await buildSupportContractInputs();
    const admissions = { ...inputs.admissions };
    delete admissions.targetDescriptor;
    assert.throws(
      () => buildBuildContract(
        inputs.values.blueprint,
        inputs.values.designPlan,
        inputs.values.discoveryApproval,
        inputs.values.decisionLedger,
        { target: "openclaw", admissions },
      ),
      (error) => error?.code === "AGENTMO_BUILD_CONTRACT_TARGET_DESCRIPTOR_REQUIRED",
    );
    assert.equal(OPENCLAW_TARGET_DESCRIPTOR_SCHEMA_VERSION,
      "agentmo.openclaw-target-descriptor.v1");
  });
  it("pins the inspected runtime and exposes every source-grounded construction mechanism", async () => {
    const { contract, inputs } = await supportContract({ includeInputs: true });
    assert.equal(contract.targetRuntime.id, "openclaw");
    assert.equal(contract.targetRuntime.sourceRevision,
      inputs.values.targetDescriptor.target.sourceRevision);
    assert.equal(contract.targetRuntime.displayRevision, "0790d9f");
    assert.equal(contract.targetRuntime.observedVersion, "2026.7.1-2");
    assert.equal(contract.targetRuntime.nodeRange,
      ">=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0");
    assert.equal(contract.targetRuntime.descriptorDigest,
      inputs.targetDescriptor.digest);
    assert.deepEqual(contract.targetDescriptor, inputs.values.targetDescriptor);
    assert.deepEqual(Object.keys(contract.specification), [
      "prompt",
      "skills",
      "tools",
      "plugins",
      "memory",
      "rag",
      "storage",
      "schedules",
      "harness",
      "loop",
      "runtimeBinding",
      "transitions",
      "recovery",
    ]);
    assert.deepEqual(
      contract.specification.prompt.bootstrapFiles.map(({ path }) => path),
      [
        "openclaw/workspace/AGENTS.md",
        "openclaw/workspace/SOUL.md",
        "openclaw/workspace/IDENTITY.md",
        "openclaw/workspace/USER.md",
        "openclaw/workspace/TOOLS.md",
        "openclaw/workspace/BOOTSTRAP.md",
        "openclaw/workspace/MEMORY.md",
        "openclaw/workspace/HEARTBEAT.md",
      ],
    );
    assert.equal(contract.specification.tools.toolsMdIsAuthority, false);
    assert.deepEqual(contract.specification.skills.limits, {
      maximumPerSource: 200,
      maximumInPrompt: 150,
      maximumPromptChars: 18000,
      maximumFileBytes: 256000,
    });
    assert.equal(contract.specification.plugins.scanRequiredBeforeInstall, true);
    assert.equal(contract.specification.memory.slotOwner, "memory-core");
    assert.deepEqual(contract.specification.memory.competingOwners, []);
    assert.equal(contract.specification.memory.rootFile, "openclaw/workspace/MEMORY.md");
    assert.equal(contract.specification.rag.embedding.secretRef.kind, "SecretRef");
    assert.equal(contract.specification.rag.embedding.dimensions, 1536);
    assert.equal(contract.specification.storage.productionPathsPersisted, false);
    assert.equal(contract.specification.schedules.registeredAtBuildContract, false);
    assert.equal(contract.specification.schedules.proposals[0].timezone, "Asia/Shanghai");
    assert.notEqual(contract.specification.harness.id, contract.specification.runtimeBinding.provider);
    assert.notEqual(contract.specification.harness.id, contract.specification.runtimeBinding.model);
    assert.equal(contract.specification.loop.maximumAttempts, 3);
    assert.equal(contract.specification.loop.toolLoopGuard.maximumRepeatedCalls, 3);
    assert.deepEqual(
      contract.specification.transitions.map(({ transition }) => transition),
      ["install", "load", "execute"],
    );
    assert.equal(JSON.stringify(contract).includes("/Users/"), false);
    assert.equal(JSON.stringify(contract).includes("/home/"), false);
    assert.equal(/sk-[A-Za-z0-9_-]{12,}/u.test(JSON.stringify(contract)), false);
  });

  it("rejects competing memory owners, prompt-only tools, secret values, and collapsed transitions", async () => {
    const contract = await supportContract();
    const mutations = [
      (value) => value.specification.memory.competingOwners.push("memory-lancedb"),
      (value) => { value.specification.tools.effectivePolicyPipeline = []; },
      (value) => { value.specification.rag.embedding.secretRef = "sk-private-secret-value"; },
      (value) => { value.specification.transitions[1].transition = "install"; },
      (value) => { value.targetRuntime.sourceRevision = "unrecognized"; },
      (value) => { value.specification.skills.limits.maximumInPrompt = 151; },
      (value) => { value.specification.schedules.proposals[0].retry.maximumAttempts = 99; },
      (value) => { value.specification.loop.maximumAttempts = 4; },
      (value) => { value.specification.storage.databases[0].extra = true; },
    ];
    for (const [index, mutate] of mutations.entries()) {
      const changed = structuredClone(contract);
      mutate(changed);
      const changedValidation = validateBuildContract(changed);
      assert.equal(
        changedValidation.ok,
        false,
        `mutation ${index}: ${JSON.stringify(changedValidation.errors)}`,
      );
    }
  });

  it("embeds only a raw-byte-admitted canonical recipe and makes every recipe mutation stale", async () => {
    const { contract, inputs } = await supportContract({
      withRecipe: true,
      includeInputs: true,
    });
    assert.equal(validateBuildContract(contract).ok, true);
    assert.equal(contract.nativePluginRecipe.schemaVersion, "agentmo.native-plugin-recipe.v1");
    assert.equal(JSON.stringify(contract).includes("native-plugin-recipe.json"), false);
    assert.deepEqual(
      contract.nativePluginRecipe.files.map(({ relativePath }) => relativePath),
      [
        "openclaw/plugin/index.js",
        "openclaw/plugin/openclaw.plugin.json",
      ],
    );

    const contractPath = path.join(inputs.root, "recipe-contract.json");
    const contractBytes = Buffer.from(`${JSON.stringify(contract, null, 2)}\n`, "utf8");
    await writeFile(contractPath, contractBytes);
    const { loadAdmittedArtifact } = await import("../src/artifact-admission.js");
    const contractAdmission = await loadAdmittedArtifact({
      filePath: contractPath,
      subject: "build-contract",
      expectedDigest: sha256(contractBytes),
    });
    const preview = buildPlanApprovalPreview(
      inputs.values.blueprint,
      contractAdmission.value,
      { admissions: { blueprint: inputs.blueprint, buildContract: contractAdmission } },
    );
    const approval = buildPlanApproval(
      inputs.values.blueprint,
      contractAdmission.value,
      {
        admissions: { blueprint: inputs.blueprint, buildContract: contractAdmission },
        approve: true,
        previewDigest: preview.previewDigest,
      },
    );
    assert.equal(validatePlanApproval(approval, {
      blueprint: inputs.values.blueprint,
      buildContract: contract,
      sources: approval.bindings,
    }).ok, true);

    const mutations = [
      (value) => value.nativePluginRecipe.files.reverse(),
      (value) => { value.nativePluginRecipe.files[0].relativePath = "../index.js"; },
      (value) => { value.nativePluginRecipe.files[0].mode = 0o755; },
      (value) => { value.nativePluginRecipe.files[0].encoding = "base64"; },
      (value) => { value.nativePluginRecipe.files[0].content += " "; },
      (value) => { value.nativePluginRecipe.files[0].sha256 = sha256("drift"); },
      (value) => { value.nativePluginRecipe.recipeDigest = sha256("drift"); },
      (value) => { value.nativePluginRecipe.hookMappings[0].openclawEvent = "before_agent_run"; },
      (value) => { value.nativePluginRecipe.hookMappings[0].permission = ""; },
      (value) => { value.nativePluginRecipe.hookMappings[0].timeoutMs = 0; },
      (value) => { value.nativePluginRecipe.hookMappings[0].failureSemantics = "ignore"; },
    ];
    for (const [index, mutate] of mutations.entries()) {
      const changed = structuredClone(contract);
      mutate(changed);
      const validation = validateBuildContract(changed);
      assert.equal(validation.ok, false, `mutation ${index}: ${JSON.stringify(validation.errors)}`);
      assert.equal(validatePlanApproval(approval, {
        blueprint: inputs.values.blueprint,
        buildContract: changed,
        sources: approval.bindings,
      }).ok, false);
    }
  });

  it("accepts the recipe only through an exact raw-byte-bound public CLI option", async () => {
    const inputs = await buildSupportContractInputs();
    const files = {
      blueprint: inputs.values.blueprint,
      "design-plan": inputs.values.designPlan,
      "discovery-approval": inputs.values.discoveryApproval,
      "native-plugin-recipe": canonicalRecipe(),
      "openclaw-target-descriptor": inputs.values.targetDescriptor,
    };
    const paths = {};
    const digests = {};
    for (const [subject, value] of Object.entries(files)) {
      const filePath = path.join(inputs.root, `${subject}.json`);
      const bytes = Buffer.from(serializePersistableJson(value, { subject }), "utf8");
      await writeFile(filePath, bytes);
      paths[subject] = filePath;
      digests[subject] = sha256(bytes);
    }
    paths["decision-ledger"] = path.join(inputs.root, "decision-ledger.json");
    digests["decision-ledger"] = inputs.decisionLedger.head.digest;
    paths["openclaw-target-descriptor"] = inputs.targetFiles.descriptorPath;
    digests["openclaw-target-descriptor"] = inputs.targetDescriptor.digest;
    assert.equal(digests.blueprint, inputs.blueprint.digest);
    assert.equal(digests["design-plan"], inputs.designPlan.digest);
    assert.equal(digests["discovery-approval"], inputs.discoveryApproval.digest);
    const output = path.join(inputs.root, "recipe-build-contract.json");
    const result = spawnSync(process.execPath, [
      CLI,
      "build-contract",
      paths.blueprint,
      "--design-plan",
      paths["design-plan"],
      "--discovery-approval",
      paths["discovery-approval"],
      "--decision-ledger",
      paths["decision-ledger"],
      "--target-descriptor",
      paths["openclaw-target-descriptor"],
      "--native-plugin-recipe",
      paths["native-plugin-recipe"],
      "--digest",
      `blueprint=${digests.blueprint}`,
      "--digest",
      `design-plan=${digests["design-plan"]}`,
      "--digest",
      `discovery-approval=${digests["discovery-approval"]}`,
      "--digest",
      `decision-ledger=${digests["decision-ledger"]}`,
      "--digest",
      `openclaw-target-descriptor=${digests["openclaw-target-descriptor"]}`,
      "--digest",
      `native-plugin-recipe=${digests["native-plugin-recipe"]}`,
      "--out",
      output,
      "--target",
      "openclaw",
      "--json",
    ], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, LANG: "C", LC_ALL: "C" },
    });
    assert.equal(result.status, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);
    const contract = JSON.parse(await (await import("node:fs/promises")).readFile(output, "utf8"));
    assert.deepEqual(contract.nativePluginRecipe, files["native-plugin-recipe"]);
    assert.equal(JSON.stringify(contract).includes(paths["native-plugin-recipe"]), false);
  });
});
