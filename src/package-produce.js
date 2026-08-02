import { createHash, randomUUID } from "node:crypto";
import { constants as FS_CONSTANTS } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  admittedArtifactProvenance,
  loadAdmittedArtifact,
} from "./artifact-admission.js";
import {
  computeNativePluginRecipeDigest,
  validateBuildContract,
  validateNativePluginRecipe,
} from "./build-contract.js";
import {
  validateOpenClawTargetCarrierAdmission,
} from "./openclaw-target-admission.js";
import {
  buildPackageArchive,
  readPackageArchiveInventory,
} from "./package-archive.js";
import { publishOpenClawSafeFsObject } from "./openclaw-safe-fs.js";
import {
  assertApprovedHookCarrierConsistency,
  selectPackageCarriers,
} from "./package-carriers.js";
import {
  AGENT_PACKAGE_SCHEMA_VERSION,
  validateAgentPackageManifest,
} from "./package-contract.js";
import { validatePlanApproval } from "./plan-approval.js";
import {
  preparePersistableProductText,
  serializePersistableJson,
} from "./persistability.js";
import { buildOpenClawPackageProjection } from "./targets/openclaw-package.js";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const RESOURCE_PATHS = Object.freeze({
  prompt: "resources/prompts/system.md",
  "workspace-context": "resources/workspace/context.json",
  skills: "resources/skills/support-triage/SKILL.md",
  tools: "resources/tools/tool-bindings.json",
  "tool-policy": "resources/tools/tool-policy.json",
  plugins: "resources/plugins/agentmo-openclaw-harness.json",
  memory: "resources/memory/policy.json",
  rag: "resources/memory/rag-policy.json",
  storage: "resources/storage/policy.json",
  schedules: "resources/schedule-proposals/daily-collection.json",
  harness: "resources/harness/runtime.json",
  "agent-loop": "resources/runtime/loop.json",
  "runtime-binding": "resources/runtime/binding.json",
  permissions: "resources/permissions.json",
  "trust-boundaries": "resources/trust-boundaries.json",
  secrets: "resources/credential-setup-proposal.json",
  "install-transition": "resources/transitions/install.json",
  "load-transition": "resources/transitions/load.json",
  "execute-transition": "resources/transitions/execute.json",
  recovery: "resources/recovery.json",
  "acceptance-cases": "resources/evals/acceptance-cases.json",
  "evidence-obligations": "resources/evidence-boundary.json",
});

export class PackageProduceError extends Error {
  constructor(code, errors = []) {
    super("Agent Package production was rejected.");
    this.name = "PackageProduceError";
    this.code = code;
    this.errors = Object.freeze([...errors]);
  }
}

export async function produceAgentPackage(options = {}, hooks = {}) {
  assertExactObject(options, [
    "artifacts",
    "outputRoot",
    "archivePath",
    "helperPath",
    "receiptPath",
    "receiptDigest",
  ]);
  assertPublicationAuthority(options);
  assertExactObject(options.artifacts, [
    "blueprint",
    "designPlan",
    "discoveryApproval",
    "decisionLedger",
    "buildContract",
    "planApproval",
    "targetDescriptor",
    "targetCarrierAdmission",
  ]);
  for (const binding of Object.values(options.artifacts)) {
    assertExactObject(binding, ["filePath", "expectedDigest"]);
  }
  assertPublicationHooks(hooks);
  const outputRoot = outputPath(options.outputRoot);
  const archivePath = outputPath(options.archivePath);
  if (outputRoot === archivePath || outputRoot.startsWith(`${archivePath}${path.sep}`)
    || archivePath.startsWith(`${outputRoot}${path.sep}`)) {
    throw new PackageProduceError("AGENTMO_PACKAGE_OUTPUT_PATH_INVALID");
  }
  await requireAbsent(outputRoot);
  await requireAbsent(archivePath);

  const admitted = await admitExactSources(options.artifacts);
  const blueprint = admitted.blueprint.value;
  const designPlan = admitted.designPlan.value;
  const buildContract = admitted.buildContract.value;
  const planApproval = admitted.planApproval.value;
  const targetDescriptor = admitted.targetDescriptor.value;
  const targetAdmission = admitted.targetCarrierAdmission.value;
  revalidateAuthority({
    admitted,
    blueprint,
    buildContract,
    planApproval,
    targetDescriptor,
    targetAdmission,
  });

  const carrierSelection = selectPackageCarriers(buildContract);
  const ownership = new Map();
  const files = new Map();
  for (const resource of buildContract.resources) {
    const relativePath = RESOURCE_PATHS[resource.kind];
    if (!relativePath) throw new PackageProduceError("AGENTMO_PACKAGE_RESOURCE_UNSUPPORTED");
    const bytes = resourceText(resource.kind)
      ? productText(resourceText(resource.kind), relativePath)
      : jsonBytes(resourcePayload(resource, buildContract), relativePath);
    addFile(files, ownership, relativePath, 0o644, bytes, resource.id);
  }
  for (const entry of buildOpenClawPackageProjection({
    buildContract,
    carrierSelection,
    targetAdmission,
  })) {
    const capabilityId = projectionCapability(entry.relativePath);
    if (entry.relativePath.endsWith(".md") || entry.relativePath.endsWith(".js")) {
      productText(entry.bytes.toString("utf8"), entry.relativePath);
    }
    addFile(files, ownership, entry.relativePath, entry.mode, entry.bytes, capabilityId);
  }

  const members = [...files.entries()]
    .map(([relativePath, file]) => memberDescriptor(relativePath, file.mode, file.bytes))
    .sort((left, right) => comparePaths(left.relativePath, right.relativePath));
  const inventoryDigest = hash(Buffer.from(serializePersistableJson(members, {
    subject: "package-member-inventory",
  }), "utf8"));
  const capabilityLedger = carrierSelection.entries.map((selection) => (
    ledgerEntry(selection, ownership, buildContract, targetAdmission)
  ));
  const capabilityIds = capabilityLedger.map(({ capabilityId }) => capabilityId);
  const manifest = {
    schemaVersion: AGENT_PACKAGE_SCHEMA_VERSION,
    packageId: buildContract.agentId,
    packageVersion: "1.0.0",
    sourceBindings: {
      blueprintDigest: admitted.blueprint.digest,
      buildContractDigest: admitted.buildContract.digest,
      designPlanDigest: admitted.designPlan.digest,
      discoveryApprovalDigest: admitted.discoveryApproval.digest,
      decisionLedgerDigest: admitted.decisionLedger.digest,
      planApprovalDigest: admitted.planApproval.digest,
    },
    targetCompatibility: [{
      target: "openclaw",
      version: targetAdmission.target.version,
      sourceRevision: targetAdmission.target.sourceRevision,
      exactRevisionRequired: true,
    }],
    capabilityIds,
    capabilityLedger,
    members,
    inventoryDigest,
    ownership: {
      packageOwner: "agentmo",
      managedMemberPaths: members.map(({ relativePath }) => relativePath),
      externalStateIncluded: false,
    },
    permissions: buildContract.permissions.map(({ id }) => id).sort(),
    evidenceRefs: buildContract.evidenceObligations.map(({ id }) => id).sort(),
    certificationBoundary: {
      deterministicPackageMechanism: true,
      installed: false,
      runtime: false,
      domain: false,
      production: false,
    },
    remainingRisks: [...buildContract.remainingRisks].sort(),
  };
  const manifestValidation = validateAgentPackageManifest(manifest, { observedMembers: members });
  if (!manifestValidation.ok) {
    throw new PackageProduceError("AGENTMO_PACKAGE_MANIFEST_INVALID", manifestValidation.errors);
  }
  const manifestBytes = jsonBytes(manifest, "package-manifest");
  const stageRoot = `${outputRoot}.agentmo-stage-${process.pid}-${randomUUID()}`;
  const archiveStagePath = `${archivePath}.agentmo-stage-${process.pid}-${randomUUID()}`;
  let stageIdentity;
  let archiveStageIdentity;
  let archive;
  let directorySourceConsumed = false;
  let archiveSourceConsumed = false;
  let directoryPublication;
  let archivePublication;
  try {
    await mkdir(stageRoot, { recursive: false, mode: 0o700 });
    stageIdentity = await observeDirectory(stageRoot);
    const orderedFiles = [...files.entries()].sort(([left], [right]) => (
      comparePaths(left, right)
    ));
    const directories = [...new Set(orderedFiles.flatMap(([relativePath]) => (
      stagedDirectoryChain(stageRoot, relativePath)
    )))];
    await Promise.all(directories.map((directory) => (
      mkdir(directory, { recursive: true, mode: 0o755 })
    )));
    await Promise.all(orderedFiles.map(([relativePath, file]) => (
      writeNewFile(path.join(stageRoot, ...relativePath.split("/")), file.bytes, file.mode)
    )));
    await writeNewFile(path.join(stageRoot, "agentmo.package.json"), manifestBytes, 0o644);
    await syncDirectories(directories, stageRoot);
    stageIdentity = await observeDirectory(stageRoot);
    archive = await buildPackageArchive({ packageRoot: stageRoot });
    await hooks.afterArchiveBuild?.(Object.freeze({
      stageRoot,
      archiveDigest: archive.archiveDigest,
      manifestDigest: archive.manifestDigest,
      inventoryDigest: archive.inventoryDigest,
    }));
    await assertPackageDirectoryClosure(stageRoot, {
      archive,
      members,
      manifestDigest: hash(manifestBytes),
      inventoryDigest,
    });

    const directoryPublishResult = await publishStagedObject({
      outputPath: outputRoot,
      stagePath: stageRoot,
      stageIdentity,
      type: "directory",
      publicationAuthority: options,
    });
    if (directoryPublishResult.sourceConsumed === true) {
      directorySourceConsumed = true;
      directoryPublication = Object.freeze({
        kind: "package-directory",
        digest: hash(manifestBytes),
        identity: stageIdentity,
      });
    }
    if (directoryPublishResult.disposition !== "published") {
      throw new PackageProduceError("AGENTMO_PACKAGE_DIRECTORY_PUBLICATION_REFUSED");
    }
    directorySourceConsumed = true;
    directoryPublication ??= Object.freeze({
      kind: "package-directory",
      digest: hash(manifestBytes),
      identity: stageIdentity,
    });
    await hooks.afterDirectoryNameCreated?.(Object.freeze({
      ...directoryPublication,
      sourceConsumed: true,
    }));
    directoryPublication = Object.freeze({
      kind: "package-directory",
      digest: hash(manifestBytes),
      identity: await observeDirectory(outputRoot),
    });
    await hooks.afterDirectoryPublication?.(Object.freeze({
      ...directoryPublication,
      sourceConsumed: true,
    }));
    const observedDirectory = await observeDirectory(outputRoot);
    if (!sameIdentity(directoryPublication.identity, observedDirectory)) {
      throw new PackageProduceError("AGENTMO_PACKAGE_DIRECTORY_PUBLICATION_IDENTITY_DRIFT");
    }
    await assertPackageDirectoryClosure(outputRoot, {
      archive,
      members,
      manifestDigest: hash(manifestBytes),
      inventoryDigest,
    });

    archiveStageIdentity = await writeNewFile(archiveStagePath, archive.bytes, 0o644);
    const archivePublishResult = await publishStagedObject({
      outputPath: archivePath,
      stagePath: archiveStagePath,
      stageIdentity: archiveStageIdentity,
      type: "file",
      publicationAuthority: options,
    });
    if (archivePublishResult.sourceConsumed === true) {
      archiveSourceConsumed = true;
      archivePublication = Object.freeze({
        kind: "package-archive",
        digest: archive.archiveDigest,
        identity: archiveStageIdentity,
      });
    }
    if (archivePublishResult.disposition !== "published") {
      throw new PackageProduceError("AGENTMO_PACKAGE_ARCHIVE_PUBLICATION_REFUSED");
    }
    archiveSourceConsumed = true;
    archivePublication ??= Object.freeze({
      kind: "package-archive",
      digest: archive.archiveDigest,
      identity: archiveStageIdentity,
    });
    await hooks.afterArchiveNameCreated?.(Object.freeze({
      ...archivePublication,
      sourceConsumed: true,
    }));
    archivePublication = Object.freeze({
      kind: "package-archive",
      digest: archive.archiveDigest,
      identity: (await observeFile(archivePath)).identity,
    });
    await hooks.afterArchivePublication?.(Object.freeze({
      ...archivePublication,
      sourceConsumed: true,
    }));
    const observedArchive = await observeFile(archivePath);
    if (!sameIdentity(archivePublication.identity, observedArchive.identity)
      || observedArchive.digest !== archive.archiveDigest) {
      throw new PackageProduceError("AGENTMO_PACKAGE_ARCHIVE_PUBLICATION_IDENTITY_DRIFT");
    }
    const closure = await readPackageArchiveInventory({
      archivePath,
      expectedArchiveDigest: archive.archiveDigest,
    });
    if (!isDeepStrictEqual(closure.members, members)
      || closure.manifestDigest !== hash(manifestBytes)
      || closure.inventoryDigest !== inventoryDigest) {
      throw new PackageProduceError("AGENTMO_PACKAGE_ARCHIVE_VERIFICATION_FAILED");
    }
    await assertPackageDirectoryClosure(outputRoot, {
      archive,
      members,
      manifestDigest: hash(manifestBytes),
      inventoryDigest,
    });
    return Object.freeze({
      schemaVersion: "agentmo.package-produce-result.v1",
      outputRoot,
      archivePath,
      archiveDigest: archive.archiveDigest,
      manifestDigest: archive.manifestDigest,
      inventoryDigest,
      certificationBoundary: Object.freeze({
        installed: false,
        runtime: false,
        domain: false,
        production: false,
      }),
    });
  } catch (error) {
    if (!directorySourceConsumed && stageIdentity !== undefined
      && await pathIsAbsent(stageRoot)) {
      try {
        const observedIdentity = await observeDirectory(outputRoot);
        if (sameIdentity(stageIdentity, observedIdentity)) {
          directorySourceConsumed = true;
          directoryPublication = Object.freeze({
            kind: "package-directory",
            digest: hash(manifestBytes),
            identity: stageIdentity,
          });
        }
      } catch {
        // Unknown final state remains private/public recovery work below.
      }
    }
    if (!archiveSourceConsumed && archiveStageIdentity !== undefined
      && archive !== undefined && await pathIsAbsent(archiveStagePath)) {
      try {
        const observed = await observeFile(archivePath);
        if (sameIdentity(archiveStageIdentity, observed.identity)
          && observed.digest === archive.archiveDigest) {
          archiveSourceConsumed = true;
          archivePublication = Object.freeze({
            kind: "package-archive",
            digest: archive.archiveDigest,
            identity: archiveStageIdentity,
          });
        }
      } catch {
        // Unknown final state remains private/public recovery work below.
      }
    }
    const privateTemps = await preservedPrivateTempEvidence([
      ...(!directorySourceConsumed
        ? [{
            kind: "package-directory-stage",
            tempPath: stageRoot,
            expectedIdentity: stageIdentity,
            expectedDigest: hash(manifestBytes),
            expectedInventoryDigest: inventoryDigest,
            expectedArchiveDigest: archive?.archiveDigest ?? null,
            expectedMembers: members,
            type: "directory",
          }]
        : []),
      ...(!archiveSourceConsumed
        ? [{
            kind: "package-archive-stage",
            tempPath: archiveStagePath,
            expectedIdentity: archiveStageIdentity,
            expectedDigest: archive?.archiveDigest ?? null,
            expectedInventoryDigest: null,
            expectedArchiveDigest: archive?.archiveDigest ?? null,
            expectedMembers: null,
            type: "file",
          }]
        : []),
    ]);
    if (directoryPublication !== undefined || archivePublication !== undefined) {
      const failure = await packagePublicationFailure(error, {
        outputRoot,
        archivePath,
        directoryPublication,
        archivePublication,
      });
      failure.preservedPrivateTemps = Object.freeze(privateTemps);
      throw failure;
    }
    if (privateTemps.length > 0) {
      throw privateTempFailure(error, privateTemps);
    }
    throw error;
  }
}

async function admitExactSources(bindings) {
  const blueprint = await load(bindings.blueprint, "blueprint");
  const designPlan = await load(bindings.designPlan, "design-plan");
  const discoveryApproval = await load(bindings.discoveryApproval, "discovery-approval", {
    "design-plan": designPlan,
  });
  const decisionLedger = await load(bindings.decisionLedger, "decision-ledger");
  const buildContract = await load(bindings.buildContract, "build-contract");
  const planApproval = await load(bindings.planApproval, "plan-approval");
  const targetDescriptor = await load(bindings.targetDescriptor, "openclaw-target-descriptor");
  const targetCarrierAdmission = await load(
    bindings.targetCarrierAdmission,
    "openclaw-target-carrier-admission",
    {
      blueprint,
      "build-contract": buildContract,
      "plan-approval": planApproval,
      "openclaw-target-descriptor": targetDescriptor,
    },
  );
  return {
    blueprint, designPlan, discoveryApproval, decisionLedger, buildContract,
    planApproval, targetDescriptor, targetCarrierAdmission,
  };
}

function load(binding, subject, companions) {
  return loadAdmittedArtifact({
    filePath: binding.filePath,
    expectedDigest: binding.expectedDigest,
    subject,
    ...(companions === undefined ? {} : { companions }),
  });
}

function revalidateAuthority(context) {
  const {
    admitted, blueprint, buildContract, planApproval, targetDescriptor, targetAdmission,
  } = context;
  const recipe = buildContract.nativePluginRecipe;
  const recipeValidation = validateNativePluginRecipe(recipe, buildContract.targetRuntime);
  const contractValidation = validateBuildContract(buildContract);
  const targetValidation = validateOpenClawTargetCarrierAdmission(targetAdmission, {
    sources: {
      blueprint: provenance(admitted.blueprint, blueprint),
      buildContract: provenance(admitted.buildContract, buildContract),
      planApproval: provenance(admitted.planApproval, planApproval),
      targetDescriptor: provenance(admitted.targetDescriptor, targetDescriptor),
    },
  });
  const approvalValidation = validatePlanApproval(planApproval, {
    blueprint,
    buildContract,
    sources: {
      blueprint: provenance(admitted.blueprint, blueprint),
      buildContract: provenance(admitted.buildContract, buildContract),
    },
  });
  let carrier;
  try {
    carrier = assertApprovedHookCarrierConsistency(buildContract);
  } catch (error) {
    throw new PackageProduceError("AGENTMO_PACKAGE_CARRIER_AUTHORITY_INVALID", error?.errors);
  }
  if (!contractValidation.ok || !recipeValidation.ok || !targetValidation.ok || !approvalValidation.ok
    || computeNativePluginRecipeDigest(recipe) !== recipe.recipeDigest
    || carrier.recipe.recipeDigest !== recipe.recipeDigest
    || targetAdmission.authorities.blueprintDigest !== admitted.blueprint.digest
    || targetAdmission.authorities.buildContractDigest !== admitted.buildContract.digest
    || targetAdmission.authorities.planApprovalDigest !== admitted.planApproval.digest
    || targetAdmission.authorities.targetDescriptorDigest !== admitted.targetDescriptor.digest
    || targetAdmission.target.descriptorDigest !== admitted.targetDescriptor.digest
    || targetAdmission.authorities.nativePluginRecipeDigest !== recipe.recipeDigest
    || buildContract.bindings.blueprint?.digest !== admitted.blueprint.digest
    || buildContract.bindings.designPlan?.digest !== admitted.designPlan.digest
    || buildContract.bindings.discoveryApproval?.digest !== admitted.discoveryApproval.digest
    || buildContract.bindings.decisionLedger?.digest !== admitted.decisionLedger.digest
    || !isDeepStrictEqual(buildContract.targetDescriptor, targetDescriptor)) {
    throw new PackageProduceError("AGENTMO_PACKAGE_AUTHORITY_DRIFT", [
      ...contractValidation.errors,
      ...recipeValidation.errors,
      ...targetValidation.errors,
      ...approvalValidation.errors,
    ]);
  }
}

function provenance(admission, value) {
  return admittedArtifactProvenance(admission, { subject: admission.subject, value });
}

function resourcePayload(resource, contract) {
  const specific = {
    permissions: contract.permissions,
    "acceptance-cases": contract.acceptanceCases,
    "evidence-obligations": contract.evidenceObligations,
  }[resource.kind] ?? contract.specification[specificationKey(resource.kind)] ?? resource;
  return {
    schemaVersion: "agentmo.package-resource.v1",
    resourceId: resource.id,
    kind: resource.kind,
    declaredContract: specific,
    materialized: true,
    installed: false,
    runtimeVerified: false,
    domainVerified: false,
  };
}

function specificationKey(kind) {
  return ({
    "tool-policy": "tools",
    "workspace-context": "prompt",
    "runtime-binding": "runtimeBinding",
    "trust-boundaries": "permissions",
    secrets: "permissions",
    "install-transition": "transitions",
    "load-transition": "transitions",
    "execute-transition": "transitions",
    "acceptance-cases": "acceptanceCases",
    "evidence-obligations": "evidenceObligations",
    "agent-loop": "loop",
  })[kind] ?? kind;
}

function resourceText(kind) {
  if (kind === "prompt") {
    return "# Support Triage System\n\nClassify and prioritize support requests, cite bounded evidence, and fail closed when required policy or customer facts are missing.\n";
  }
  if (kind === "skills") {
    return "# Support Triage\n\nUse the declared tool and evidence contracts to classify tickets and draft reviewable responses. Do not execute external changes.\n";
  }
  return null;
}

function projectionCapability(relativePath) {
  if (relativePath.includes("/hooks/")) {
    return `hook:${path.posix.basename(relativePath, ".json")}`;
  }
  if (relativePath.includes("/plugins/")) return "resource:plugins";
  if (relativePath.endsWith("/SKILL.md")) return "resource:skills";
  if (relativePath.endsWith("/TOOLS.md")) return "resource:tools";
  if (relativePath.endsWith("/MEMORY.md")) return "resource:memory";
  if (relativePath.endsWith("/schedule-proposal.json")) return "resource:schedules";
  if (relativePath.endsWith("/credential-setup-proposal.json")) return "resource:secrets";
  if (relativePath.endsWith("/runtime-binding.json")) return "resource:runtime-binding";
  if (relativePath.endsWith("/config-patch.json")) return "resource:tool-policy";
  if (relativePath.endsWith("/capability-map.json")) return "resource:evidence-obligations";
  return "resource:workspace-context";
}

function ledgerEntry(selection, ownership, contract, targetAdmission) {
  const memberPaths = [...(ownership.get(selection.capabilityId) ?? [])].sort(comparePaths);
  const permission = selection.permission
    ?? contract.permissions.find(({ resourceId }) => resourceId === selection.resourceId)?.id
    ?? "permission:agent-loop";
  const native = selection.carrier === "native-plugin";
  return {
    capabilityId: selection.capabilityId,
    resourceId: selection.resourceId,
    carrier: selection.carrier,
    owner: selection.owner,
    necessity: selection.necessity,
    trust: selection.trust,
    memberPaths,
    recipeDigest: native ? contract.nativePluginRecipe.recipeDigest : null,
    targetMapping: {
      target: "openclaw",
      event: native ? (selection.openclawEvent ?? "before_agent_run") : null,
      versionRange: `${targetAdmission.target.version}@${targetAdmission.target.displayRevision}`,
    },
    permission,
    approvalRequirement: permission.startsWith("permission:")
      && contract.permissions.find(({ id }) => id === permission)?.approvalRequired === true
      ? "explicit-human-approval"
      : "contract-scoped",
    timeoutMs: native ? (selection.timeoutMs ?? 5000) : null,
    failureSemantics: "fail-closed",
    unsupportedBehavior: native
      ? [...new Set(selection.unsupportedBehavior ?? ["automatic-external-plugin-install"])].sort()
      : [],
  };
}

function addFile(files, ownership, relativePath, mode, bytes, capabilityId) {
  assertPortablePath(relativePath);
  if (!Buffer.isBuffer(bytes) || ![0o644, 0o755].includes(mode) || files.has(relativePath)) {
    throw new PackageProduceError("AGENTMO_PACKAGE_MEMBER_INVALID");
  }
  const folded = relativePath.normalize("NFC").toLocaleLowerCase("en-US");
  if ([...files.keys()].some((candidate) => (
    candidate.normalize("NFC").toLocaleLowerCase("en-US") === folded
  ))) {
    throw new PackageProduceError("AGENTMO_PACKAGE_MEMBER_COLLISION");
  }
  files.set(relativePath, { mode, bytes: Buffer.from(bytes) });
  const paths = ownership.get(capabilityId) ?? [];
  paths.push(relativePath);
  ownership.set(capabilityId, paths);
}

function stagedDirectoryChain(stageRoot, relativePath) {
  const segments = relativePath.split("/").slice(0, -1);
  return segments.map((_, index) => (
    path.join(stageRoot, ...segments.slice(0, index + 1))
  ));
}

async function writeNewFile(filePath, bytes, mode) {
  let handle;
  try {
    handle = await open(
      filePath,
      FS_CONSTANTS.O_WRONLY | FS_CONSTANTS.O_CREAT | FS_CONSTANTS.O_EXCL
        | (FS_CONSTANTS.O_NOFOLLOW ?? 0),
      mode,
    );
    await handle.writeFile(bytes);
    await handle.sync();
    return publicationIdentity(await handle.stat({ bigint: true }));
  } finally {
    await handle?.close();
  }
}

async function requireAbsent(filePath) {
  try {
    await stat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new PackageProduceError("AGENTMO_PACKAGE_OUTPUT_EXISTS");
}

function productText(text, subject) {
  preparePersistableProductText(text, { subject: "package-product-text" });
  return Buffer.from(text, "utf8");
}

function jsonBytes(value, subject) {
  return Buffer.from(serializePersistableJson(value, { subject: "package-member-json" }), "utf8");
}

function memberDescriptor(relativePath, mode, bytes) {
  return { relativePath, type: "file", mode, byteLength: bytes.length, sha256: hash(bytes) };
}

function hash(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function outputPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new PackageProduceError("AGENTMO_PACKAGE_OUTPUT_PATH_INVALID");
  }
  return path.resolve(value);
}

function assertPortablePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")
    || value.includes("\\") || value.startsWith("/") || value !== value.normalize("NFC")
    || value.split("/").some((segment) => (
      segment.length === 0 || segment === "." || segment === ".."
      || segment.endsWith(" ") || segment.endsWith(".")
    ))) {
    throw new PackageProduceError("AGENTMO_PACKAGE_MEMBER_PATH_INVALID");
  }
}

function assertExactObject(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length
    || !keys.every((key) => Object.hasOwn(value, key))) {
    throw new PackageProduceError("AGENTMO_PACKAGE_OPTIONS_INVALID");
  }
}

function assertPublicationAuthority(value) {
  if (!path.isAbsolute(value.helperPath ?? "")
    || !path.isAbsolute(value.receiptPath ?? "")
    || !DIGEST_PATTERN.test(value.receiptDigest ?? "")) {
    throw new PackageProduceError("AGENTMO_PACKAGE_PUBLICATION_AUTHORITY_REQUIRED");
  }
}

async function pathIsAbsent(filePath) {
  try {
    await lstat(filePath, { bigint: true });
    return false;
  } catch (error) {
    return error?.code === "ENOENT";
  }
}

function comparePaths(left, right) {
  return Buffer.from(left).compare(Buffer.from(right));
}

function assertPublicationHooks(value) {
  const allowed = new Set([
    "afterDirectoryNameCreated",
    "afterDirectoryPublication",
    "afterArchiveBuild",
    "afterArchiveNameCreated",
    "afterArchivePublication",
  ]);
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.has(key))
    || Object.values(value).some((callback) => typeof callback !== "function")) {
    throw new PackageProduceError("AGENTMO_PACKAGE_OPTIONS_INVALID");
  }
}

async function observeDirectory(directoryPath) {
  const observed = await lstat(directoryPath, { bigint: true });
  if (!observed.isDirectory() || observed.isSymbolicLink()) {
    throw new PackageProduceError("AGENTMO_PACKAGE_DIRECTORY_PUBLICATION_IDENTITY_DRIFT");
  }
  return publicationIdentity(observed);
}

async function observeFile(filePath, options = {}) {
  let handle;
  try {
    const before = await lstat(filePath, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink()
      || (options.requireSingleLink !== false && before.nlink !== 1n)) {
      throw new PackageProduceError("AGENTMO_PACKAGE_ARCHIVE_PUBLICATION_IDENTITY_DRIFT");
    }
    handle = await open(
      filePath,
      FS_CONSTANTS.O_RDONLY | (FS_CONSTANTS.O_NOFOLLOW ?? 0),
    );
    const opened = await handle.stat({ bigint: true });
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const current = await lstat(filePath, { bigint: true });
    if (!sameStats(before, opened)
      || !sameStats(opened, after)
      || !sameStats(after, current)) {
      throw new PackageProduceError("AGENTMO_PACKAGE_ARCHIVE_PUBLICATION_IDENTITY_DRIFT");
    }
    return Object.freeze({
      digest: hash(bytes),
      identity: publicationIdentity(after),
    });
  } finally {
    await handle?.close();
  }
}

async function syncDirectories(directories, root) {
  const ordered = [...new Set([...directories, root])]
    .sort((left, right) => Buffer.from(right).compare(Buffer.from(left)));
  for (const directory of ordered) await syncDirectory(directory);
}

async function syncDirectory(directoryPath) {
  const handle = await open(
    directoryPath,
    FS_CONSTANTS.O_RDONLY | (FS_CONSTANTS.O_DIRECTORY ?? 0)
      | (FS_CONSTANTS.O_NOFOLLOW ?? 0),
  );
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function publishStagedObject({
  outputPath,
  stagePath,
  stageIdentity,
  type,
  publicationAuthority,
}) {
  if (path.dirname(outputPath) !== path.dirname(stagePath)) {
    throw new PackageProduceError("AGENTMO_PACKAGE_OUTPUT_PATH_INVALID");
  }
  const publication = await publishOpenClawSafeFsObject({
    rootPath: path.dirname(outputPath),
    helperPath: publicationAuthority.helperPath,
    receiptPath: publicationAuthority.receiptPath,
    receiptDigest: publicationAuthority.receiptDigest,
    sourceRelativePath: path.basename(stagePath),
    destinationRelativePath: path.basename(outputPath),
    expectedIdentity: {
      device: stageIdentity.device,
      inode: stageIdentity.inode,
      type,
    },
  });
  if (publication.disposition === "published"
    && (publication.device !== stageIdentity.device
      || publication.inode !== stageIdentity.inode
      || publication.type !== type)) {
    throw new PackageProduceError("AGENTMO_PACKAGE_PUBLICATION_IDENTITY_DRIFT");
  }
  return publication;
}

async function preservedPrivateTempEvidence(candidates) {
  const preserved = [];
  for (const candidate of candidates) {
    let observedIdentity = null;
    let observedDigest = null;
    let observedInventoryDigest = null;
    let observation = "unknown";
    let disposition = "unknown";
    let reason = "private-temp-observation-failed";
    try {
      if (candidate.type === "directory") {
        observedIdentity = await observeDirectory(candidate.tempPath);
        if (candidate.expectedIdentity === undefined
          || !sameIdentity(candidate.expectedIdentity, observedIdentity)) {
          reason = "private-temp-identity-mismatch";
        } else {
          observedDigest = (await observeFile(
            path.join(candidate.tempPath, "agentmo.package.json"),
            { requireSingleLink: false },
          )).digest;
          if (candidate.expectedArchiveDigest === null) {
            disposition = "preserved";
            observation = "exact";
            reason = "private-temp-preserved-for-recovery";
          } else {
            try {
              const observed = await buildPackageArchive({
                packageRoot: candidate.tempPath,
              });
              observedDigest = observed.archiveDigest;
              observedInventoryDigest = observed.inventoryDigest;
              if (observed.archiveDigest === candidate.expectedArchiveDigest
                && observed.inventoryDigest === candidate.expectedInventoryDigest
                && isDeepStrictEqual(observed.members, candidate.expectedMembers)) {
                disposition = "preserved";
                observation = "exact";
                reason = "private-temp-preserved-for-recovery";
              } else {
                disposition = "preserved";
                observation = "mismatch";
                reason = "private-temp-closure-mismatch";
              }
            } catch (error) {
              if (isPackageClosureMismatch(error)) {
                disposition = "preserved";
                observation = "mismatch";
                reason = "private-temp-closure-mismatch";
              }
            }
          }
        }
      } else {
        const observed = await observeFile(candidate.tempPath, {
          requireSingleLink: false,
        });
        observedIdentity = observed.identity;
        observedDigest = observed.digest;
        if (candidate.expectedIdentity !== undefined
          && sameIdentity(candidate.expectedIdentity, observedIdentity)
          && candidate.expectedDigest === observedDigest) {
          disposition = "preserved";
          observation = "exact";
          reason = "private-temp-preserved-for-recovery";
        } else if (candidate.expectedIdentity !== undefined) {
          disposition = "preserved";
          observation = "mismatch";
          reason = "private-temp-closure-mismatch";
        } else {
          reason = "private-temp-identity-unknown";
        }
      }
    } catch {
      // Every known candidate remains represented as unknown recovery work.
    }
    preserved.push(Object.freeze({
      kind: candidate.kind,
      path: candidate.tempPath,
      type: candidate.type,
      disposition,
      observation,
      reason,
      expectedDigest: candidate.expectedDigest,
      observedDigest,
      expectedInventoryDigest: candidate.expectedInventoryDigest,
      observedInventoryDigest,
      expectedIdentity: candidate.expectedIdentity ?? null,
      observedIdentity,
    }));
  }
  return preserved;
}

async function assertPackageDirectoryClosure(root, expected) {
  let observed;
  try {
    observed = await buildPackageArchive({ packageRoot: root });
  } catch {
    throw new PackageProduceError(
      "AGENTMO_PACKAGE_DIRECTORY_CLOSURE_DRIFT",
    );
  }
  if (!observed.bytes.equals(expected.archive.bytes)
    || observed.archiveDigest !== expected.archive.archiveDigest
    || observed.manifestDigest !== expected.manifestDigest
    || observed.inventoryDigest !== expected.inventoryDigest
    || !isDeepStrictEqual(observed.members, expected.members)) {
    throw new PackageProduceError(
      "AGENTMO_PACKAGE_DIRECTORY_CLOSURE_DRIFT",
    );
  }
}

function isPackageClosureMismatch(error) {
  return typeof error?.code === "string"
    && /^AGENTMO_PACKAGE_ARCHIVE_(?:MEMBER|MANIFEST|INVENTORY)/u.test(
      error.code,
    );
}

function privateTempFailure(error, privateTemps) {
  const failure = error instanceof Error
    ? error
    : new PackageProduceError("AGENTMO_PACKAGE_PUBLICATION_INCOMPLETE");
  if (failure.code === undefined) {
    failure.code = "AGENTMO_PACKAGE_PUBLICATION_INCOMPLETE";
  }
  failure.recoveryRequired = true;
  failure.preservedPrivateTemps = Object.freeze(privateTemps);
  return failure;
}

async function packagePublicationFailure(error, context) {
  const failure = error instanceof Error
    ? error
    : new PackageProduceError("AGENTMO_PACKAGE_PUBLICATION_INCOMPLETE");
  const preserved = [];
  if (context.directoryPublication !== undefined) {
    preserved.push(await preservedDirectoryEvidence(
      context.outputRoot,
      context.directoryPublication,
    ));
  }
  if (context.archivePublication !== undefined) {
    preserved.push(await preservedFileEvidence(
      context.archivePath,
      context.archivePublication,
    ));
  }
  if (failure.code === undefined) {
    failure.code = "AGENTMO_PACKAGE_PUBLICATION_INCOMPLETE";
  }
  failure.recoveryRequired = true;
  failure.preservedPublications = Object.freeze(preserved);
  return failure;
}

async function preservedDirectoryEvidence(directoryPath, expected) {
  let observedIdentity = null;
  try {
    observedIdentity = await observeDirectory(directoryPath);
  } catch {
    // Absence or unsafe replacement remains explicit recovery work.
  }
  return Object.freeze({
    kind: expected.kind,
    disposition: "preserved",
    reason: observedIdentity === null
      ? "published-path-not-safely-observable"
      : "published-object-or-replacement-preserved",
    expectedDigest: expected.digest,
    observedDigest: null,
    expectedIdentity: expected.identity,
    observedIdentity,
  });
}

async function preservedFileEvidence(filePath, expected) {
  let observedIdentity = null;
  let observedDigest = null;
  try {
    const observed = await observeFile(filePath, { requireSingleLink: false });
    observedIdentity = observed.identity;
    observedDigest = observed.digest;
  } catch {
    // Absence or unsafe replacement remains explicit recovery work.
  }
  return Object.freeze({
    kind: expected.kind,
    disposition: "preserved",
    reason: observedIdentity === null
      ? "published-path-not-safely-observable"
      : "published-object-or-replacement-preserved",
    expectedDigest: expected.digest,
    observedDigest,
    expectedIdentity: expected.identity,
    observedIdentity,
  });
}

function publicationIdentity(stats) {
  return Object.freeze({
    device: String(stats.dev),
    inode: String(stats.ino),
    links: String(stats.nlink),
    mode: String(stats.mode),
    size: String(stats.size),
    modifiedNs: String(stats.mtimeNs),
    changedNs: String(stats.ctimeNs),
  });
}

function sameStats(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.nlink === right.nlink
    && left.mode === right.mode
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function sameIdentity(left, right) {
  return Object.keys(left).every((key) => left[key] === right[key]);
}
