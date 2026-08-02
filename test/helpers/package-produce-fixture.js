import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  loadAdmittedArtifact,
} from "../../src/artifact-admission.js";
import {
  admitNativePluginRecipe,
  buildBuildContract,
  computeNativePluginRecipeDigest,
  writeBuildContract,
} from "../../src/build-contract.js";
import {
  buildOpenClawTargetCarrierAdmission,
  writeOpenClawTargetCarrierAdmission,
} from "../../src/openclaw-target-admission.js";
import {
  buildPlanApproval,
  buildPlanApprovalPreview,
  writePlanApproval,
} from "../../src/plan-approval.js";
import { serializePersistableJson } from "../../src/persistability.js";
import { buildSupportContractInputs } from "./build-contract-fixture.js";

export const digestBytes = (bytes) => (
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`
);

export function canonicalNativePluginRecipe() {
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
    sha256: digestBytes(Buffer.from(file.content, "utf8")),
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

export async function buildApprovedPackageFixture(options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-package-produce-fixture-"));
  const inputs = await buildSupportContractInputs(options);
  const paths = {
    blueprint: path.join(root, "blueprint.json"),
    "design-plan": path.join(root, "design-plan.json"),
    "discovery-approval": path.join(root, "discovery-approval.json"),
    "decision-ledger": path.join(inputs.root, "decision-ledger.json"),
    "openclaw-target-descriptor": inputs.targetFiles.descriptorPath,
    "native-plugin-recipe": path.join(root, "native-plugin-recipe.json"),
    "build-contract": path.join(root, "build-contract.json"),
    "plan-approval": path.join(root, "plan-approval.json"),
    "openclaw-target-carrier-admission": path.join(root, "target-carrier-admission.json"),
  };
  await writeCanonical(paths.blueprint, inputs.values.blueprint, "blueprint");
  await writeCanonical(paths["design-plan"], inputs.values.designPlan, "design-plan");
  await writeCanonical(
    paths["discovery-approval"],
    inputs.values.discoveryApproval,
    "discovery-approval",
  );
  await writeCanonical(
    paths["native-plugin-recipe"],
    canonicalNativePluginRecipe(),
    "native-plugin-recipe",
  );
  const recipeBytes = await readFile(paths["native-plugin-recipe"]);
  const recipeAdmission = await admitNativePluginRecipe({
    filePath: paths["native-plugin-recipe"],
    expectedDigest: digestBytes(recipeBytes),
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
  await writeBuildContract(paths["build-contract"], contract);
  const buildContractAdmission = await admitStandalone(
    paths["build-contract"],
    "build-contract",
  );
  const preview = buildPlanApprovalPreview(
    inputs.values.blueprint,
    buildContractAdmission.value,
    {
      admissions: {
        blueprint: inputs.blueprint,
        buildContract: buildContractAdmission,
      },
    },
  );
  const approval = buildPlanApproval(
    inputs.values.blueprint,
    buildContractAdmission.value,
    {
      admissions: {
        blueprint: inputs.blueprint,
        buildContract: buildContractAdmission,
      },
      approve: true,
      previewDigest: preview.previewDigest,
    },
  );
  await writePlanApproval(paths["plan-approval"], approval);
  const planApprovalAdmission = await admitStandalone(
    paths["plan-approval"],
    "plan-approval",
  );
  const targetAdmission = await buildOpenClawTargetCarrierAdmission({
    blueprint: inputs.values.blueprint,
    buildContract: buildContractAdmission.value,
    planApproval: planApprovalAdmission.value,
    admissions: {
      blueprint: inputs.blueprint,
      buildContract: buildContractAdmission,
      planApproval: planApprovalAdmission,
      targetDescriptor: inputs.targetDescriptor,
    },
    target: {
      executablePath: inputs.targetFiles.executablePath,
      executableDigest: digestBytes(await readFile(inputs.targetFiles.executablePath)),
      packageJsonPath: inputs.targetFiles.packageJsonPath,
      packageJsonDigest: digestBytes(await readFile(inputs.targetFiles.packageJsonPath)),
      buildInfoPath: inputs.targetFiles.buildInfoPath,
      buildInfoDigest: digestBytes(await readFile(inputs.targetFiles.buildInfoPath)),
    },
  });
  await writeOpenClawTargetCarrierAdmission(
    paths["openclaw-target-carrier-admission"],
    targetAdmission,
    inputs.publication,
  );

  const digests = {};
  for (const [subject, filePath] of Object.entries(paths)) {
    if (subject === "native-plugin-recipe") continue;
    digests[subject] = digestBytes(await readFile(filePath));
  }
  return {
    root,
    inputs,
    paths,
    digests,
    recipe: recipeAdmission.value,
    contract: buildContractAdmission.value,
    approval: planApprovalAdmission.value,
    targetAdmission,
    publication: inputs.publication,
  };
}

export function packageProduceOptions(fixture, outputRoot, archivePath) {
  return {
    artifacts: {
      blueprint: binding(fixture, "blueprint"),
      designPlan: binding(fixture, "design-plan"),
      discoveryApproval: binding(fixture, "discovery-approval"),
      decisionLedger: binding(fixture, "decision-ledger"),
      buildContract: binding(fixture, "build-contract"),
      planApproval: binding(fixture, "plan-approval"),
      targetDescriptor: binding(fixture, "openclaw-target-descriptor"),
      targetCarrierAdmission: binding(
        fixture,
        "openclaw-target-carrier-admission",
      ),
    },
    outputRoot,
    archivePath,
    helperPath: fixture.publication.helperPath,
    receiptPath: fixture.publication.receiptPath,
    receiptDigest: fixture.publication.receiptDigest,
  };
}

async function writeCanonical(filePath, value, subject) {
  await writeFile(filePath, Buffer.from(serializePersistableJson(value, { subject }), "utf8"));
}

async function admitStandalone(filePath, subject) {
  const bytes = await readFile(filePath);
  return loadAdmittedArtifact({
    filePath,
    subject,
    expectedDigest: digestBytes(bytes),
  });
}

function binding(fixture, subject) {
  return {
    filePath: fixture.paths[subject],
    expectedDigest: fixture.digests[subject],
  };
}
