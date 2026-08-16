import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { it } from "node:test";
import {
  admitNativePluginRecipe,
  buildBuildContract,
  computeNativePluginRecipeDigest,
  writeBuildContract,
} from "../src/build-contract.js";
import { loadAdmittedArtifact } from "../src/artifact-admission.js";
import {
  buildPlanApproval,
  buildPlanApprovalPreview,
  writePlanApproval,
} from "../src/plan-approval.js";
import {
  buildOpenClawTargetCarrierAdmission,
  writeOpenClawTargetCarrierAdmission,
} from "../src/openclaw-target-admission.js";
import { readPackageArchiveInventory } from "../src/package-archive.js";
import { serializePersistableJson } from "../src/persistability.js";
import { buildOpenClawPackageProjection } from "../src/targets/openclaw-package.js";
import {
  buildApprovedPackageFixture,
  digestBytes,
  packageProduceOptions,
  produceAgentPackageFixture,
} from "./helpers/package-produce-fixture.js";
import { NATIVE_OPENCLAW_FS } from "./helpers/native-openclaw-fs.js";

it("projects complete OpenClaw-native resources and only recipe-derived plugin bytes", async () => {
  const fixture = await buildApprovedPackageFixture();
  const outputRoot = path.join(fixture.root, "package");
  const archivePath = path.join(fixture.root, "package.d42");
  await produceAgentPackageFixture(packageProduceOptions(fixture, outputRoot, archivePath));
  const required = [
    "projections/openclaw/workspace/AGENTS.md",
    "projections/openclaw/workspace/SOUL.md",
    "projections/openclaw/workspace/IDENTITY.md",
    "projections/openclaw/workspace/USER.md",
    "projections/openclaw/workspace/TOOLS.md",
    "projections/openclaw/workspace/MEMORY.md",
    "projections/openclaw/workspace/skills/support-triage/SKILL.md",
    "projections/openclaw/config/openclaw.agent.patch.json",
    "projections/openclaw/capability-map.json",
    "projections/openclaw/runtime-binding.json",
    "projections/openclaw/schedule-proposals/daily-collection.json",
    "projections/openclaw/credential-setup-proposal.json",
  ];
  for (const relativePath of required) {
    assert.equal((await readFile(path.join(outputRoot, relativePath))).length > 0, true);
  }
  for (const recipeFile of fixture.recipe.files) {
    const recipeRelativePath = recipeFile.relativePath.slice("openclaw/plugin/".length);
    const projectedPath = path.join(
      outputRoot,
      "projections/openclaw/plugins/agentmo-openclaw-harness",
      recipeRelativePath,
    );
    const bytes = await readFile(projectedPath);
    assert.deepEqual(bytes, Buffer.from(recipeFile.content, "utf8"));
    assert.equal(bytes.length, recipeFile.byteLength);
    assert.equal(digestBytes(bytes), recipeFile.sha256);
    assert.equal((await stat(projectedPath)).mode & 0o777, recipeFile.mode);
  }
  const manifest = JSON.parse(
    await readFile(path.join(outputRoot, "agentmo.package.json"), "utf8"),
  );
  assert.equal(
    manifest.members.some(({ relativePath }) => /(^|\/)mcp(\/|$)/iu.test(relativePath)),
    false,
  );
  assert.equal(
    JSON.stringify(manifest).toLowerCase().includes("mcp-server"),
    false,
  );
  assert.equal(manifest.certificationBoundary.installed, false);
  assert.equal(manifest.certificationBoundary.runtime, false);
});

it("preserves nested recipe paths and same-basename members through manifest and archive", async () => {
  const fixture = await buildNestedPackageFixture();
  const outputRoot = path.join(fixture.root, "nested-package");
  const archivePath = path.join(fixture.root, "nested-package.d42");
  const produced = await produceAgentPackageFixture(
    packageProduceOptions(fixture, outputRoot, archivePath),
  );
  const expectedPaths = [
    "projections/openclaw/plugins/agentmo-openclaw-harness/recipes/a/setup.md",
    "projections/openclaw/plugins/agentmo-openclaw-harness/recipes/b/setup.md",
  ];
  const manifest = JSON.parse(
    await readFile(path.join(outputRoot, "agentmo.package.json"), "utf8"),
  );
  const memberPaths = manifest.members.map(({ relativePath }) => relativePath);
  const closure = await readPackageArchiveInventory({
    archivePath,
    expectedArchiveDigest: produced.archiveDigest,
  });

  assert.deepEqual(
    memberPaths.filter((relativePath) => expectedPaths.includes(relativePath)),
    expectedPaths,
  );
  assert.deepEqual(memberPaths, [...memberPaths].sort(comparePaths));
  assert.deepEqual(closure.members, manifest.members);
  for (const [index, relativePath] of expectedPaths.entries()) {
    const bytes = await readFile(path.join(outputRoot, ...relativePath.split("/")));
    const source = fixture.recipe.files.find(({ relativePath: sourcePath }) => (
      sourcePath === `openclaw/plugin/recipes/${index === 0 ? "a" : "b"}/setup.md`
    ));
    assert.deepEqual(bytes, Buffer.from(source.content, "utf8"));
    assert.equal((await stat(path.join(outputRoot, ...relativePath.split("/")))).mode & 0o777,
      source.mode);
    assert.equal(digestBytes(bytes), source.sha256);
    assert.deepEqual(
      manifest.members.find((member) => member.relativePath === relativePath),
      {
        relativePath,
        type: "file",
        mode: source.mode,
        byteLength: source.byteLength,
        sha256: source.sha256,
      },
    );
  }
});

it("fails closed on traversal, absolute, normalized, and case-policy recipe collisions", () => {
  const invalidPaths = [
    "openclaw/plugin/../escape.js",
    "/openclaw/plugin/absolute.js",
    "openclaw/plugin/re\u0301cipe/setup.md",
  ];
  for (const relativePath of invalidPaths) {
    assert.throws(
      () => {
        const recipe = uncheckedRecipe([recipeFile(relativePath, "unsafe\n")]);
        buildOpenClawPackageProjection(projectionOptions(recipe));
      },
      (error) => error?.message === "AGENTMO_OPENCLAW_PACKAGE_AUTHORITY_INVALID"
        || error?.code?.startsWith("AGENTMO_PERSISTABILITY_"),
    );
  }

  const caseCollision = uncheckedRecipe([
    recipeFile("openclaw/plugin/recipes/A/setup.md", "upper\n"),
    recipeFile("openclaw/plugin/recipes/a/setup.md", "lower\n"),
  ]);
  assert.throws(
    () => buildOpenClawPackageProjection(projectionOptions(caseCollision)),
    /AGENTMO_OPENCLAW_PACKAGE_MEMBER_COLLISION/u,
  );
});

function recipeFile(relativePath, content, mode = 0o644) {
  return {
    relativePath,
    type: "file",
    mode,
    encoding: "utf8",
    content,
    byteLength: Buffer.byteLength(content, "utf8"),
    sha256: digestBytes(Buffer.from(content, "utf8")),
  };
}

function uncheckedRecipe(files) {
  const recipe = {
    schemaVersion: "agentmo.native-plugin-recipe.v1",
    owner: "agentmo-openclaw-harness",
    files,
    hookMappings: canonicalHookMappings(),
  };
  return { ...recipe, recipeDigest: computeNativePluginRecipeDigest(recipe) };
}

function projectionOptions(recipe) {
  return {
    buildContract: {
      nativePluginRecipe: recipe,
      targetRuntime: undefined,
    },
    carrierSelection: { mcpCarrierCount: 0, entries: [] },
    targetAdmission: {
      authorities: { nativePluginRecipeDigest: recipe.recipeDigest },
      carrier: {
        owner: recipe.owner,
        implementationPathAccepted: false,
        mcp: false,
      },
      target: {},
    },
  };
}

function canonicalHookMappings() {
  return [
    ["after-attempt", "agent_end"],
    ["after-tool", "after_tool_call"],
    ["before-attempt", "before_agent_run"],
    ["before-checkpoint", "before_compaction"],
  ].map(([abstractHook, openclawEvent]) => ({
    abstractHook,
    openclawEvent,
    owner: "agentmo-openclaw-harness",
    versionRange: "test-target",
    permission: `permission:${abstractHook}`,
    timeoutMs: 5000,
    failureSemantics: "fail-closed",
    unsupportedBehavior: ["automatic-external-plugin-install"],
  }));
}

async function buildNestedPackageFixture() {
  const fixture = await buildApprovedPackageFixture();
  const files = [
    ...fixture.recipe.files,
    recipeFile("openclaw/plugin/recipes/a/setup.md", "alpha\n"),
    recipeFile("openclaw/plugin/recipes/b/setup.md", "bravo\n", 0o755),
  ].sort((left, right) => comparePaths(left.relativePath, right.relativePath));
  const recipeBasis = {
    schemaVersion: fixture.recipe.schemaVersion,
    owner: fixture.recipe.owner,
    files,
    hookMappings: fixture.recipe.hookMappings,
  };
  const recipe = {
    ...recipeBasis,
    recipeDigest: computeNativePluginRecipeDigest(recipeBasis),
  };
  const recipePath = path.join(fixture.root, "nested-native-plugin-recipe.json");
  const recipeBytes = Buffer.from(serializePersistableJson(recipe, {
    subject: "native-plugin-recipe",
  }), "utf8");
  await writeFile(recipePath, recipeBytes, { flag: "wx" });
  const recipeAdmission = await admitNativePluginRecipe({
    filePath: recipePath,
    expectedDigest: digestBytes(recipeBytes),
  });
  const contract = buildBuildContract(
    fixture.inputs.values.blueprint,
    fixture.inputs.values.designPlan,
    fixture.inputs.values.discoveryApproval,
    fixture.inputs.values.decisionLedger,
    {
      target: "openclaw",
      admissions: fixture.inputs.admissions,
      nativePluginRecipe: recipeAdmission.value,
      nativePluginRecipeAdmission: recipeAdmission,
    },
  );
  const contractPath = path.join(fixture.root, "nested-build-contract.json");
  await writeBuildContract(contractPath, contract);
  const contractAdmission = await admit(contractPath, "build-contract");
  const preview = buildPlanApprovalPreview(
    fixture.inputs.values.blueprint,
    contractAdmission.value,
    {
      admissions: {
        blueprint: fixture.inputs.blueprint,
        buildContract: contractAdmission,
      },
    },
  );
  const approval = buildPlanApproval(
    fixture.inputs.values.blueprint,
    contractAdmission.value,
    {
      admissions: {
        blueprint: fixture.inputs.blueprint,
        buildContract: contractAdmission,
      },
      approve: true,
      previewDigest: preview.previewDigest,
    },
  );
  const approvalPath = path.join(fixture.root, "nested-plan-approval.json");
  await writePlanApproval(approvalPath, approval);
  const approvalAdmission = await admit(approvalPath, "plan-approval");
  const targetAdmission = await buildOpenClawTargetCarrierAdmission({
    blueprint: fixture.inputs.values.blueprint,
    buildContract: contractAdmission.value,
    planApproval: approvalAdmission.value,
    admissions: {
      blueprint: fixture.inputs.blueprint,
      buildContract: contractAdmission,
      planApproval: approvalAdmission,
      targetDescriptor: fixture.inputs.targetDescriptor,
    },
    target: {
      executablePath: fixture.inputs.targetFiles.executablePath,
      executableDigest: digestBytes(await readFile(fixture.inputs.targetFiles.executablePath)),
      packageJsonPath: fixture.inputs.targetFiles.packageJsonPath,
      packageJsonDigest: digestBytes(await readFile(fixture.inputs.targetFiles.packageJsonPath)),
      buildInfoPath: fixture.inputs.targetFiles.buildInfoPath,
      buildInfoDigest: digestBytes(await readFile(fixture.inputs.targetFiles.buildInfoPath)),
    },
  });
  const targetAdmissionPath = path.join(fixture.root, "nested-target-admission.json");
  if (NATIVE_OPENCLAW_FS) {
    await writeOpenClawTargetCarrierAdmission(
      targetAdmissionPath,
      targetAdmission,
      fixture.publication,
    );
  } else {
    await writeFile(targetAdmissionPath, Buffer.from(serializePersistableJson(
      targetAdmission,
      { subject: "openclaw-target-carrier-admission" },
    ), "utf8"), { flag: "wx", mode: 0o600 });
  }
  fixture.paths["build-contract"] = contractPath;
  fixture.paths["plan-approval"] = approvalPath;
  fixture.paths["openclaw-target-carrier-admission"] = targetAdmissionPath;
  fixture.digests["build-contract"] = digestBytes(await readFile(contractPath));
  fixture.digests["plan-approval"] = digestBytes(await readFile(approvalPath));
  fixture.digests["openclaw-target-carrier-admission"] = digestBytes(
    await readFile(targetAdmissionPath),
  );
  fixture.recipe = recipeAdmission.value;
  return fixture;
}

async function admit(filePath, subject) {
  const bytes = await readFile(filePath);
  return loadAdmittedArtifact({
    filePath,
    subject,
    expectedDigest: digestBytes(bytes),
  });
}

function comparePaths(left, right) {
  return Buffer.from(left).compare(Buffer.from(right));
}
