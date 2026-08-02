import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadAdmittedArtifact } from "../../src/artifact-admission.js";
import { draftBlueprint, writeBlueprintDraft } from "../../src/blueprint-draft.js";
import { appendDecisionEntry, loadDecisionLedger } from "../../src/decision-ledger.js";
import { buildDesignPlan, writeDesignPlan } from "../../src/design-plan.js";
import {
  buildDiscoveryApproval,
  buildDiscoveryApprovalPreview,
} from "../../src/discovery-approval.js";
import {
  buildOpenClawTargetDescriptor,
  writeOpenClawTargetDescriptor,
} from "../../src/openclaw-target-descriptor.js";
import { buildOpenClawFsKernel } from "../../src/openclaw-safe-fs.js";

const MANIFEST_FILE = new URL("../../examples/support-triage.discovery.json", import.meta.url);
const DB_FILE = new URL("../../examples/fixtures/support-triage/prebuilt-discovery-db.json", import.meta.url);
const NEED_FILE = new URL("../../examples/support-triage.need.json", import.meta.url);
let publicationFixturePromise;

export function getOpenClawFsPublicationFixture() {
  publicationFixturePromise ??= buildOpenClawFsPublicationFixture();
  return publicationFixturePromise;
}

export async function buildSupportContractInputs(options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-build-contract-fixture-"));
  const publication = await getOpenClawFsPublicationFixture();
  const targetRoot = path.join(root, "openclaw-target");
  const targetExecutablePath = path.join(targetRoot, "openclaw.mjs");
  const targetPackageJsonPath = path.join(targetRoot, "package.json");
  const targetBuildInfoPath = path.join(targetRoot, "dist", "build-info.json");
  await mkdir(path.dirname(targetBuildInfoPath), { recursive: true });
  await writeFile(
    targetExecutablePath,
    options.targetExecutableSource ?? "#!/usr/bin/env node\n",
    { mode: 0o755 },
  );
  await writeFile(targetPackageJsonPath, `${JSON.stringify({
    name: "openclaw",
    version: "2026.7.1-2",
    engines: {
      node: ">=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0",
    },
  }, null, 2)}\n`);
  await writeFile(targetBuildInfoPath, `${JSON.stringify({
    version: "2026.7.1-2",
    commit: "0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c",
    builtAt: "2026-07-28T00:00:00.000Z",
  }, null, 2)}\n`);
  const targetDescriptorCandidate = await buildOpenClawTargetDescriptor({
    executablePath: targetExecutablePath,
    packageJsonPath: targetPackageJsonPath,
    buildInfoPath: targetBuildInfoPath,
    digests: {
      "target-executable": sha256(await readFile(targetExecutablePath)),
      "target-package-json": sha256(await readFile(targetPackageJsonPath)),
      "target-build-info": sha256(await readFile(targetBuildInfoPath)),
    },
  });
  const targetDescriptorPath = path.join(root, "openclaw-target-descriptor.json");
  await writeOpenClawTargetDescriptor(
    targetDescriptorPath,
    targetDescriptorCandidate,
    publication,
  );
  const targetDescriptor = await admitFile(
    targetDescriptorPath,
    "openclaw-target-descriptor",
  );
  const discoveryManifest = await admitFile(MANIFEST_FILE, "discovery-manifest");
  const discoveryDb = await admitFile(DB_FILE, "discovery-db");
  const userNeed = await admitFile(NEED_FILE, "user-need");

  const discoveryApprovalInputs = {
    admissions: { discoveryManifest, discoveryDb },
  };
  const discoveryApprovalPreview = buildDiscoveryApprovalPreview(
    discoveryManifest.value,
    discoveryDb.value,
    discoveryApprovalInputs,
  );
  const discoveryApprovalCandidate = buildDiscoveryApproval(
    discoveryManifest.value,
    discoveryDb.value,
    {
      ...discoveryApprovalInputs,
      approve: true,
      previewDigest: discoveryApprovalPreview.previewDigest,
    },
  );
  const discoveryApproval = await admitValue(
    root,
    discoveryApprovalCandidate,
    "discovery-approval",
    {
      "discovery-manifest": discoveryManifest,
      "discovery-db": discoveryDb,
    },
  );

  const journalPath = path.join(root, "decision-ledger.json");
  const requirementRefs = requirementIds(userNeed.value);
  const appended = await appendDecisionEntry({
    journalPath,
    entry: {
      entryId: "human-decision-01",
      entryKind: "human-decision",
      subject: "Approve the bounded OpenClaw planning scope",
      reason: "Carry all evidence gaps into explicit package resources and acceptance obligations.",
      sourceRefs: [],
      decisionRefs: [],
      requirementRefs,
    },
  });
  const decisionLedger = await loadDecisionLedger({
    journalPath,
    expectedHeadDigest: appended.head.digest,
  });

  const designPlanCandidate = buildDesignPlan(discoveryDb.value, userNeed.value, {
    target: "openclaw",
    manifest: discoveryManifest.value,
    discoveryApproval: discoveryApproval.value,
    decisionLedger,
    admissions: {
      discoveryManifest,
      discoveryDb,
      discoveryApproval,
      userNeed,
      decisionLedger,
    },
  });
  const designPlanPath = path.join(root, "design-plan.json");
  await writeDesignPlan(designPlanPath, designPlanCandidate);
  const designPlan = await admitFile(designPlanPath, "design-plan");

  const blueprintCandidate = draftBlueprint(discoveryDb.value, userNeed.value, {
    target: "openclaw",
    designPlan: designPlan.value,
    admissions: { discoveryDb, userNeed, designPlan },
  });
  const blueprintPath = path.join(root, "blueprint.json");
  await writeBlueprintDraft(blueprintPath, blueprintCandidate);
  const blueprint = await admitFile(blueprintPath, "blueprint");

  return {
    root,
    publication,
    manifest: discoveryManifest,
    discoveryDb,
    userNeed,
    discoveryApproval,
    decisionLedger,
    designPlan,
    blueprint,
    targetDescriptor,
    targetFiles: {
      executablePath: targetExecutablePath,
      packageJsonPath: targetPackageJsonPath,
      buildInfoPath: targetBuildInfoPath,
      descriptorPath: targetDescriptorPath,
    },
    values: {
      discoveryApproval: discoveryApproval.value,
      decisionLedger,
      designPlan: designPlan.value,
      blueprint: blueprint.value,
      targetDescriptor: targetDescriptor.value,
    },
    admissions: {
      discoveryApproval,
      decisionLedger,
      designPlan,
      blueprint,
      targetDescriptor,
    },
  };
}

async function buildOpenClawFsPublicationFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-safe-fs-fixture-"));
  const helperPath = path.join(root, "openclaw-fs-kernel");
  const receiptPath = path.join(root, "openclaw-fs-kernel.receipt.json");
  const built = await buildOpenClawFsKernel({
    binaryOut: helperPath,
    receiptOut: receiptPath,
  });
  return Object.freeze({
    helperPath,
    receiptPath,
    receiptDigest: built.receiptDigest,
  });
}

export async function admitBuildContract(root, contract, companions) {
  void companions;
  return admitValue(root, contract, "build-contract");
}

export function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function admitFile(filePath, subject, companions) {
  const bytes = await readFile(filePath);
  return loadAdmittedArtifact({
    filePath,
    subject,
    expectedDigest: sha256(bytes),
    ...(companions ? { companions } : {}),
  });
}

async function admitValue(root, value, subject, companions) {
  const file = path.join(root, `${subject}-${randomUUID()}.json`);
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  await writeFile(file, bytes);
  return loadAdmittedArtifact({
    filePath: file,
    subject,
    expectedDigest: sha256(bytes),
    ...(companions ? { companions } : {}),
  });
}

function requirementIds(need) {
  return [
    ...need.primary_tasks.map((_, index) => `primary-task-${String(index + 1).padStart(2, "0")}`),
    ...need.success_criteria.map((_, index) => `success-criterion-${String(index + 1).padStart(2, "0")}`),
    ...need.hard_failures.map((_, index) => `hard-failure-${String(index + 1).padStart(2, "0")}`),
  ].sort();
}
