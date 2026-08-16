import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdtemp,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  admitNativePluginRecipe,
  buildBuildContract,
  computeNativePluginRecipeDigest,
  writeBuildContract,
} from "../src/build-contract.js";
import {
  loadAdmittedArtifact,
} from "../src/artifact-admission.js";
import {
  buildPlanApproval,
  buildPlanApprovalPreview,
  writePlanApproval,
} from "../src/plan-approval.js";
import {
  OPENCLAW_TARGET_CARRIER_ADMISSION_SCHEMA_VERSION,
  buildOpenClawTargetCarrierAdmission,
  validateOpenClawTargetCarrierAdmission,
  writeOpenClawTargetCarrierAdmission,
} from "../src/openclaw-target-admission.js";
import {
  buildOpenClawTargetDescriptor,
} from "../src/openclaw-target-descriptor.js";
import { serializePersistableJson } from "../src/persistability.js";
import { buildSupportContractInputs } from "./helpers/build-contract-fixture.js";
import { NATIVE_OPENCLAW_FS } from "./helpers/native-openclaw-fs.js";

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const CLI = fileURLToPath(new URL("../bin/agentmo.js", import.meta.url));

function recipeCandidate() {
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
  return { ...recipe, recipeDigest: computeNativePluginRecipeDigest(recipe) };
}

async function exactAuthorityChain(root) {
  const inputs = await buildSupportContractInputs();
  const recipePath = path.join(root, "native-plugin-recipe.json");
  const recipeBytes = Buffer.from(serializePersistableJson(recipeCandidate(), {
    subject: "native-plugin-recipe",
  }), "utf8");
  await writeFile(recipePath, recipeBytes);
  const recipeAdmission = await admitNativePluginRecipe({
    filePath: recipePath,
    expectedDigest: sha256(recipeBytes),
  });
  const contract = buildBuildContract(
    inputs.values.blueprint,
    inputs.values.designPlan,
    inputs.values.discoveryApproval,
    inputs.values.decisionLedger,
    {
      target: "openclaw",
      admissions: inputs.admissions,
      nativePluginRecipe: recipeAdmission.value,
      nativePluginRecipeAdmission: recipeAdmission,
    },
  );
  const contractPath = path.join(root, "build-contract.json");
  await writeBuildContract(contractPath, contract);
  const contractBytes = await readFile(contractPath);
  const buildContractAdmission = await loadAdmittedArtifact({
    filePath: contractPath,
    subject: "build-contract",
    expectedDigest: sha256(contractBytes),
  });
  const preview = buildPlanApprovalPreview(
    inputs.values.blueprint,
    buildContractAdmission.value,
    { admissions: { blueprint: inputs.blueprint, buildContract: buildContractAdmission } },
  );
  const approval = buildPlanApproval(
    inputs.values.blueprint,
    buildContractAdmission.value,
    {
      admissions: { blueprint: inputs.blueprint, buildContract: buildContractAdmission },
      approve: true,
      previewDigest: preview.previewDigest,
    },
  );
  const approvalPath = path.join(root, "plan-approval.json");
  await writePlanApproval(approvalPath, approval);
  const approvalBytes = await readFile(approvalPath);
  const planApprovalAdmission = await loadAdmittedArtifact({
    filePath: approvalPath,
    subject: "plan-approval",
    expectedDigest: sha256(approvalBytes),
  });
  return {
    inputs,
    recipeAdmission,
    buildContractAdmission,
    planApprovalAdmission,
    paths: { recipePath, contractPath, approvalPath },
  };
}

describe("OpenClaw exact target/carrier admission", () => {
  it("requires and re-admits the exact descriptor instead of caller target strings", async () => {
    assert.equal(typeof buildOpenClawTargetDescriptor, "function");
    assert.equal(
      buildOpenClawTargetCarrierAdmission.length <= 1,
      true,
    );
  });
  it("rejects stale, recipe-less, or mismatched authority and writes only exact value-blind bytes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-openclaw-target-admission-"));
    const executable = path.join(root, "openclaw");
    const targetRoot = path.join(root, "openclaw-target.json");
    await writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await writeFile(targetRoot, `${JSON.stringify({
      schemaVersion: "agentmo.openclaw-target-root.v1",
      id: "openclaw",
      version: "2026.6.11",
      sourceRevision: "29d018f0",
    })}\n`);

    const missingOutput = path.join(root, "missing.json");
    await assert.rejects(
      buildOpenClawTargetCarrierAdmission({
        blueprint: { agentmo_version: "0.1" },
        buildContract: { schemaVersion: "agentmo.build-contract.v1", nativePluginRecipe: null },
        planApproval: { schemaVersion: "agentmo.plan-approval.v1" },
        target: {
          executablePath: executable,
          executableDigest: sha256(await readFile(executable)),
          rootPath: targetRoot,
          rootDigest: sha256(await readFile(targetRoot)),
        },
        admissions: {},
      }),
    );
    await assert.rejects(access(missingOutput));
  });

  it("exposes no plugin implementation path or MCP authority", () => {
    assert.equal(
      OPENCLAW_TARGET_CARRIER_ADMISSION_SCHEMA_VERSION,
      "agentmo.openclaw-target-carrier-admission.v1",
    );
    assert.equal(validateOpenClawTargetCarrierAdmission({
      schemaVersion: OPENCLAW_TARGET_CARRIER_ADMISSION_SCHEMA_VERSION,
      pluginPath: "/tmp/plugin.js",
    }).ok, false);
    assert.equal(validateOpenClawTargetCarrierAdmission({
      schemaVersion: OPENCLAW_TARGET_CARRIER_ADMISSION_SCHEMA_VERSION,
      mcp: true,
    }).ok, false);
    assert.equal(typeof buildOpenClawTargetCarrierAdmission, "function");
    assert.equal(typeof writeOpenClawTargetCarrierAdmission, "function");
  });

  it("publishes one create-only exact admission and fresh-process re-admits its source chain", {
    skip: !NATIVE_OPENCLAW_FS,
  }, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-openclaw-target-success-"));
    const chain = await exactAuthorityChain(root);
    const executable = path.join(root, "openclaw");
    const targetRoot = path.join(root, "openclaw-target.json");
    await writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await writeFile(targetRoot, `${JSON.stringify({
      schemaVersion: "agentmo.openclaw-target-root.v1",
      id: "openclaw",
      version: "2026.6.11",
      sourceRevision: "29d018f0",
    })}\n`);
    const admission = await buildOpenClawTargetCarrierAdmission({
      blueprint: chain.inputs.values.blueprint,
      buildContract: chain.buildContractAdmission.value,
      planApproval: chain.planApprovalAdmission.value,
      admissions: {
        blueprint: chain.inputs.blueprint,
        buildContract: chain.buildContractAdmission,
        planApproval: chain.planApprovalAdmission,
        targetDescriptor: chain.inputs.targetDescriptor,
      },
      target: {
        executablePath: chain.inputs.targetFiles.executablePath,
        executableDigest: sha256(await readFile(chain.inputs.targetFiles.executablePath)),
        packageJsonPath: chain.inputs.targetFiles.packageJsonPath,
        packageJsonDigest: sha256(await readFile(chain.inputs.targetFiles.packageJsonPath)),
        buildInfoPath: chain.inputs.targetFiles.buildInfoPath,
        buildInfoDigest: sha256(await readFile(chain.inputs.targetFiles.buildInfoPath)),
      },
    });
    assert.equal(admission.authorities.nativePluginRecipeDigest,
      chain.buildContractAdmission.value.nativePluginRecipe.recipeDigest);
    assert.equal(JSON.stringify(admission).includes(root), false);
    assert.equal(admission.carrier.implementationPathAccepted, false);
    assert.equal(admission.carrier.mcp, false);

    const output = path.join(root, "target-carrier-admission.json");
    await assert.rejects(writeOpenClawTargetCarrierAdmission(output, admission));
    await writeOpenClawTargetCarrierAdmission(
      output,
      admission,
      chain.inputs.publication,
    );
    await assert.rejects(writeOpenClawTargetCarrierAdmission(
      output,
      admission,
      chain.inputs.publication,
    ));
    const outputBytes = await readFile(output);
    const reAdmitted = await loadAdmittedArtifact({
      filePath: output,
      subject: "openclaw-target-carrier-admission",
      expectedDigest: sha256(outputBytes),
      companions: {
        blueprint: chain.inputs.blueprint,
        "build-contract": chain.buildContractAdmission,
        "plan-approval": chain.planApprovalAdmission,
        "openclaw-target-descriptor": chain.inputs.targetDescriptor,
      },
    });
    assert.deepEqual(reAdmitted.value, admission);
  });

  it("preserves an unknown admission post-publication replacement", {
    skip: !NATIVE_OPENCLAW_FS,
  }, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-openclaw-admission-replacement-"));
    const chain = await exactAuthorityChain(root);
    const admission = await buildOpenClawTargetCarrierAdmission({
      blueprint: chain.inputs.values.blueprint,
      buildContract: chain.buildContractAdmission.value,
      planApproval: chain.planApprovalAdmission.value,
      admissions: {
        blueprint: chain.inputs.blueprint,
        buildContract: chain.buildContractAdmission,
        planApproval: chain.planApprovalAdmission,
        targetDescriptor: chain.inputs.targetDescriptor,
      },
      target: {
        executablePath: chain.inputs.targetFiles.executablePath,
        executableDigest: sha256(await readFile(chain.inputs.targetFiles.executablePath)),
        packageJsonPath: chain.inputs.targetFiles.packageJsonPath,
        packageJsonDigest: sha256(await readFile(chain.inputs.targetFiles.packageJsonPath)),
        buildInfoPath: chain.inputs.targetFiles.buildInfoPath,
        buildInfoDigest: sha256(await readFile(chain.inputs.targetFiles.buildInfoPath)),
      },
    });
    const output = path.join(root, "target-carrier-admission-replaced.json");
    const preservedOwned = path.join(root, "target-carrier-admission-owned.json");
    const sentinelBytes = Buffer.from('{"unknown":"admission replacement"}\n', "utf8");
    let sentinelIdentity;

    await assert.rejects(
      writeOpenClawTargetCarrierAdmission(
        output,
        admission,
        chain.inputs.publication,
        {
        afterPublication: async () => {
          await rename(output, preservedOwned);
          await writeFile(output, sentinelBytes, { flag: "wx", mode: 0o600 });
          sentinelIdentity = await stat(output, { bigint: true });
          throw new Error("injected admission post-publication replacement");
        },
      }),
      (error) => {
        const publication = error?.preservedPublications?.[0];
        return error?.recoveryRequired === true
          && publication?.kind === "openclaw-target-carrier-admission"
          && publication?.disposition === "preserved"
          && publication?.expectedIdentity !== undefined
          && publication?.observedIdentity !== undefined;
      },
    );

    const after = await stat(output, { bigint: true });
    assert.equal(after.dev, sentinelIdentity.dev);
    assert.equal(after.ino, sentinelIdentity.ino);
    assert.deepEqual(await readFile(output), sentinelBytes);
    assert.notDeepEqual(await readFile(preservedOwned), sentinelBytes);
  });

  it("preserves and itemizes complete private admission bytes when helper admission fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-openclaw-admission-helper-rejected-"));
    const chain = await exactAuthorityChain(root);
    const admission = await buildOpenClawTargetCarrierAdmission({
      blueprint: chain.inputs.values.blueprint,
      buildContract: chain.buildContractAdmission.value,
      planApproval: chain.planApprovalAdmission.value,
      admissions: {
        blueprint: chain.inputs.blueprint,
        buildContract: chain.buildContractAdmission,
        planApproval: chain.planApprovalAdmission,
        targetDescriptor: chain.inputs.targetDescriptor,
      },
      target: {
        executablePath: chain.inputs.targetFiles.executablePath,
        executableDigest: sha256(await readFile(chain.inputs.targetFiles.executablePath)),
        packageJsonPath: chain.inputs.targetFiles.packageJsonPath,
        packageJsonDigest: sha256(await readFile(chain.inputs.targetFiles.packageJsonPath)),
        buildInfoPath: chain.inputs.targetFiles.buildInfoPath,
        buildInfoDigest: sha256(await readFile(chain.inputs.targetFiles.buildInfoPath)),
      },
    });
    const output = path.join(root, "target-carrier-admission-helper-rejected.json");

    let failure;
    try {
      await writeOpenClawTargetCarrierAdmission(output, admission, {
        ...chain.inputs.publication,
        receiptDigest: `sha256:${"0".repeat(64)}`,
      });
    } catch (error) {
      failure = error;
    }
    const privateTemp = failure?.preservedPrivateTemps?.[0];
    assert.equal(failure?.recoveryRequired, true);
    assert.equal(privateTemp?.kind, "openclaw-target-carrier-admission");
    assert.equal(privateTemp?.disposition, "preserved");
    assert.equal(
      JSON.parse(await readFile(privateTemp.path, "utf8")).schemaVersion,
      OPENCLAW_TARGET_CARRIER_ADMISSION_SCHEMA_VERSION,
    );
    await assert.rejects(() => access(output));
  });

  it("itemizes an admission when failure follows atomic final rename", {
    skip: !NATIVE_OPENCLAW_FS,
  }, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-openclaw-admission-link-window-"));
    const chain = await exactAuthorityChain(root);
    const admission = await buildOpenClawTargetCarrierAdmission({
      blueprint: chain.inputs.values.blueprint,
      buildContract: chain.buildContractAdmission.value,
      planApproval: chain.planApprovalAdmission.value,
      admissions: {
        blueprint: chain.inputs.blueprint,
        buildContract: chain.buildContractAdmission,
        planApproval: chain.planApprovalAdmission,
        targetDescriptor: chain.inputs.targetDescriptor,
      },
      target: {
        executablePath: chain.inputs.targetFiles.executablePath,
        executableDigest: sha256(await readFile(chain.inputs.targetFiles.executablePath)),
        packageJsonPath: chain.inputs.targetFiles.packageJsonPath,
        packageJsonDigest: sha256(await readFile(chain.inputs.targetFiles.packageJsonPath)),
        buildInfoPath: chain.inputs.targetFiles.buildInfoPath,
        buildInfoDigest: sha256(await readFile(chain.inputs.targetFiles.buildInfoPath)),
      },
    });
    const output = path.join(root, "target-carrier-admission-link-window.json");
    let linkedIdentity;

    await assert.rejects(
      writeOpenClawTargetCarrierAdmission(
        output,
        admission,
        chain.inputs.publication,
        {
        afterNameCreated: async ({ expectedIdentity, sourceConsumed }) => {
          linkedIdentity = await stat(output, { bigint: true });
          assert.equal(String(linkedIdentity.dev), expectedIdentity.device);
          assert.equal(String(linkedIdentity.ino), expectedIdentity.inode);
          assert.equal(linkedIdentity.nlink, 1n);
          assert.equal(sourceConsumed, true);
          throw new Error("injected admission atomic-rename window failure");
        },
      }),
      (error) => {
        const publication = error?.preservedPublications?.[0];
        return error?.recoveryRequired === true
          && publication?.kind === "openclaw-target-carrier-admission"
          && publication?.expectedIdentity?.inode === String(linkedIdentity?.ino)
          && publication?.observedIdentity?.inode === String(linkedIdentity?.ino);
      },
    );

    const after = await stat(output, { bigint: true });
    assert.equal(after.dev, linkedIdentity.dev);
    assert.equal(after.ino, linkedIdentity.ino);
    assert.equal(after.nlink, 1n);
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), admission);
  });

  it("keeps legacy recipe-less authority inspectable but ineligible for the current target", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-openclaw-target-stale-"));
    const chain = await exactAuthorityChain(root);
    const legacy = structuredClone(chain.buildContractAdmission.value);
    delete legacy.targetDescriptor;
    delete legacy.bindings.targetDescriptor;
    legacy.targetRuntime = {
      id: "openclaw",
      sourceRevision: "29d018f0",
      observedVersion: "2026.6.11",
      nodeRange: ">=22.19.0 <23 || >=23.11.0",
      driftPolicy: "phase-4-must-fail-closed-on-unrecognized-drift",
    };
    legacy.nativePluginRecipe = null;
    const { validateBuildContract } = await import("../src/build-contract.js");
    assert.equal(validateBuildContract(legacy).ok, true);
    const legacyPath = path.join(root, "legacy-build-contract.json");
    const legacyBytes = Buffer.from(serializePersistableJson(legacy, {
      subject: "build-contract",
    }), "utf8");
    await writeFile(legacyPath, legacyBytes);
    const legacyAdmission = await loadAdmittedArtifact({
      filePath: legacyPath,
      subject: "build-contract",
      expectedDigest: sha256(legacyBytes),
    });
    await assert.rejects(
      buildOpenClawTargetCarrierAdmission({
        blueprint: chain.inputs.values.blueprint,
        buildContract: legacyAdmission.value,
        planApproval: chain.planApprovalAdmission.value,
        admissions: {
          blueprint: chain.inputs.blueprint,
          buildContract: legacyAdmission,
          planApproval: chain.planApprovalAdmission,
          targetDescriptor: chain.inputs.targetDescriptor,
        },
        target: {
          executablePath: chain.inputs.targetFiles.executablePath,
          executableDigest: sha256(await readFile(chain.inputs.targetFiles.executablePath)),
          packageJsonPath: chain.inputs.targetFiles.packageJsonPath,
          packageJsonDigest: sha256(await readFile(chain.inputs.targetFiles.packageJsonPath)),
          buildInfoPath: chain.inputs.targetFiles.buildInfoPath,
          buildInfoDigest: sha256(await readFile(chain.inputs.targetFiles.buildInfoPath)),
        },
      }),
      (error) => error?.code === "AGENTMO_OPENCLAW_RECIPE_AUTHORITY_REQUIRED",
    );
  });

  it("admits through the public fresh-process CLI and rejects every plugin-byte option", {
    skip: !NATIVE_OPENCLAW_FS,
  }, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-openclaw-target-cli-"));
    const chain = await exactAuthorityChain(root);
    const blueprintPath = path.join(root, "blueprint.json");
    const blueprintBytes = Buffer.from(serializePersistableJson(
      chain.inputs.values.blueprint,
      { subject: "blueprint" },
    ), "utf8");
    assert.equal(sha256(blueprintBytes), chain.inputs.blueprint.digest);
    await writeFile(blueprintPath, blueprintBytes);
    const output = path.join(root, "admission.json");
    const digestArgs = [
      `blueprint=${sha256(blueprintBytes)}`,
      `build-contract=${sha256(await readFile(chain.paths.contractPath))}`,
      `plan-approval=${sha256(await readFile(chain.paths.approvalPath))}`,
      `openclaw-target-descriptor=${chain.inputs.targetDescriptor.digest}`,
      `target-executable=${sha256(await readFile(chain.inputs.targetFiles.executablePath))}`,
      `target-package-json=${sha256(await readFile(chain.inputs.targetFiles.packageJsonPath))}`,
      `target-build-info=${sha256(await readFile(chain.inputs.targetFiles.buildInfoPath))}`,
    ].flatMap((binding) => ["--digest", binding]);
    const baseArgs = [
      CLI,
      "openclaw-target-admit",
      blueprintPath,
      "--build-contract",
      chain.paths.contractPath,
      "--plan-approval",
      chain.paths.approvalPath,
      "--target-descriptor",
      chain.inputs.targetFiles.descriptorPath,
      "--target-executable",
      chain.inputs.targetFiles.executablePath,
      "--target-package-json",
      chain.inputs.targetFiles.packageJsonPath,
      "--target-build-info",
      chain.inputs.targetFiles.buildInfoPath,
      ...digestArgs,
      "--fs-helper",
      chain.inputs.publication.helperPath,
      "--fs-helper-receipt",
      chain.inputs.publication.receiptPath,
      "--fs-helper-receipt-digest",
      chain.inputs.publication.receiptDigest,
      "--out",
      output,
      "--json",
    ];
    const missingTupleArgs = [...baseArgs];
    missingTupleArgs.splice(missingTupleArgs.indexOf("--fs-helper"), 6);
    const missingTuple = spawnSync(process.execPath, missingTupleArgs, {
      encoding: "utf8",
      env: { PATH: process.env.PATH, LANG: "C", LC_ALL: "C" },
    });
    assert.notEqual(missingTuple.status, 0);
    await assert.rejects(access(output));
    const rejected = spawnSync(
      process.execPath,
      [...baseArgs, "--plugin-path", path.join(root, "plugin.js")],
      {
        encoding: "utf8",
        env: { PATH: process.env.PATH, LANG: "C", LC_ALL: "C" },
      },
    );
    assert.notEqual(rejected.status, 0);
    await assert.rejects(access(output));

    const accepted = spawnSync(process.execPath, baseArgs, {
      encoding: "utf8",
      env: { PATH: process.env.PATH, LANG: "C", LC_ALL: "C" },
    });
    assert.equal(
      accepted.status,
      0,
      `stdout=${accepted.stdout}\nstderr=${accepted.stderr}`,
    );
    const outputBytes = await readFile(output);
    const value = JSON.parse(outputBytes);
    assert.equal(value.schemaVersion, OPENCLAW_TARGET_CARRIER_ADMISSION_SCHEMA_VERSION);
    assert.equal(value.carrier.mcp, false);
    assert.equal(JSON.stringify(value).includes(root), false);
  });
});
