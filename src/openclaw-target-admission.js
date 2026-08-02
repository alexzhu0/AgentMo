import { randomUUID } from "node:crypto";
import { constants as FS_CONSTANTS } from "node:fs";
import {
  lstat,
  open,
} from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  admittedArtifactProvenance,
  digestRawBytes,
} from "./artifact-admission.js";
import { validateBuildContract } from "./build-contract.js";
import { assertApprovedHookCarrierConsistency } from "./package-carriers.js";
import { publishOpenClawSafeFsObject } from "./openclaw-safe-fs.js";
import { validatePlanApproval } from "./plan-approval.js";
import {
  buildOpenClawTargetDescriptor,
  validateOpenClawTargetDescriptor,
} from "./openclaw-target-descriptor.js";
import {
  PersistabilityError,
  assertPersistable,
  serializePersistableJson,
} from "./persistability.js";

export const OPENCLAW_TARGET_CARRIER_ADMISSION_SCHEMA_VERSION =
  "agentmo.openclaw-target-carrier-admission.v1";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const ADMITTED_CANDIDATES = new WeakSet();
const TOP_LEVEL_KEYS = Object.freeze([
  "schemaVersion",
  "decision",
  "target",
  "authorities",
  "carrier",
  "hookMappings",
  "certificationBoundary",
]);
const TARGET_KEYS = Object.freeze([
  "id",
  "version",
  "sourceRevision",
  "displayRevision",
  "nodeRange",
  "descriptorDigest",
  "executableDigest",
  "packageJsonDigest",
  "buildInfoDigest",
  "targetRootDigest",
]);
const AUTHORITY_KEYS = Object.freeze([
  "blueprintDigest",
  "buildContractDigest",
  "planApprovalDigest",
  "nativePluginRecipeDigest",
  "targetDescriptorDigest",
]);
const CARRIER_KEYS = Object.freeze([
  "kind",
  "owner",
  "implementationPathAccepted",
  "mcp",
]);
const HOOK_KEYS = Object.freeze([
  "abstractHook",
  "openclawEvent",
  "permission",
  "timeoutMs",
  "failureSemantics",
]);
const EXPECTED_HOOKS = Object.freeze([
  Object.freeze(["after-attempt", "agent_end"]),
  Object.freeze(["after-tool", "after_tool_call"]),
  Object.freeze(["before-attempt", "before_agent_run"]),
  Object.freeze(["before-checkpoint", "before_compaction"]),
]);
const CERTIFICATION_BOUNDARY = Object.freeze({
  targetAndCarrierAdmissionOnly: true,
  pluginBytesMaterialized: false,
  packageBuilt: false,
  installed: false,
  runtime: false,
  domain: false,
  production: false,
});

export class OpenClawTargetAdmissionError extends Error {
  constructor(code, errors = []) {
    super("OpenClaw target/carrier admission was rejected.");
    this.name = "OpenClawTargetAdmissionError";
    this.code = code;
    this.errors = Object.freeze([...errors]);
  }
}

export async function buildOpenClawTargetCarrierAdmission(options = {}) {
  const {
    blueprint,
    buildContract,
    planApproval,
    admissions,
    target,
  } = options;
  const sources = exactSources(
    blueprint,
    buildContract,
    planApproval,
    admissions,
  );
  if (!validateBuildContract(buildContract).ok
    || buildContract.nativePluginRecipe === null
    || buildContract.nativePluginRecipe === undefined) {
    throw new OpenClawTargetAdmissionError("AGENTMO_OPENCLAW_RECIPE_AUTHORITY_REQUIRED");
  }
  const targetDescriptor = sources.targetDescriptor.value;
  if (!validateOpenClawTargetDescriptor(targetDescriptor).ok
    || !isDeepStrictEqual(buildContract.targetDescriptor, targetDescriptor)
    || buildContract.targetRuntime.descriptorDigest !== sources.targetDescriptor.digest) {
    throw new OpenClawTargetAdmissionError(
      "AGENTMO_OPENCLAW_TARGET_DESCRIPTOR_STALE",
    );
  }
  let carrier;
  try {
    carrier = assertApprovedHookCarrierConsistency(buildContract);
  } catch (error) {
    throw new OpenClawTargetAdmissionError(
      "AGENTMO_OPENCLAW_RECIPE_AUTHORITY_REQUIRED",
      error?.errors,
    );
  }
  if (!validatePlanApproval(planApproval, {
    blueprint,
    buildContract,
    sources: {
      blueprint: sources.blueprint,
      buildContract: sources.buildContract,
    },
  }).ok) {
    throw new OpenClawTargetAdmissionError("AGENTMO_OPENCLAW_PLAN_APPROVAL_STALE");
  }

  const observedDescriptor = await buildOpenClawTargetDescriptor({
    executablePath: target?.executablePath,
    packageJsonPath: target?.packageJsonPath,
    buildInfoPath: target?.buildInfoPath,
    digests: {
      "target-executable": target?.executableDigest,
      "target-package-json": target?.packageJsonDigest,
      "target-build-info": target?.buildInfoDigest,
    },
  });
  if (!isDeepStrictEqual(observedDescriptor, targetDescriptor)) {
    throw new OpenClawTargetAdmissionError("AGENTMO_OPENCLAW_TARGET_MISMATCH");
  }
  const memberDigest = (role) => (
    targetDescriptor.members.find((member) => member.role === role)?.sha256
  );

  const admission = {
    schemaVersion: OPENCLAW_TARGET_CARRIER_ADMISSION_SCHEMA_VERSION,
    decision: "admit-exact-target-and-native-plugin-recipe",
    target: {
      id: targetDescriptor.target.id,
      version: targetDescriptor.target.version,
      sourceRevision: targetDescriptor.target.sourceRevision,
      displayRevision: targetDescriptor.target.displayRevision,
      nodeRange: targetDescriptor.target.nodeRange,
      descriptorDigest: sources.targetDescriptor.digest,
      executableDigest: memberDigest("executable"),
      packageJsonDigest: memberDigest("package-json"),
      buildInfoDigest: memberDigest("build-info"),
      targetRootDigest: targetDescriptor.targetRoot.memberClosureDigest,
    },
    authorities: {
      blueprintDigest: sources.blueprint.digest,
      buildContractDigest: sources.buildContract.digest,
      planApprovalDigest: sources.planApproval.digest,
      nativePluginRecipeDigest: carrier.recipe.recipeDigest,
      targetDescriptorDigest: sources.targetDescriptor.digest,
    },
    carrier: {
      kind: "native-plugin",
      owner: carrier.owner,
      implementationPathAccepted: false,
      mcp: false,
    },
    hookMappings: carrier.hooks.map((mapping) => ({
      abstractHook: mapping.abstractHook,
      openclawEvent: mapping.openclawEvent,
      permission: mapping.permission,
      timeoutMs: mapping.timeoutMs,
      failureSemantics: mapping.failureSemantics,
    })),
    certificationBoundary: { ...CERTIFICATION_BOUNDARY },
  };
  const validation = validateOpenClawTargetCarrierAdmission(admission);
  if (!validation.ok) {
    throw new OpenClawTargetAdmissionError(
      "AGENTMO_OPENCLAW_TARGET_ADMISSION_INVALID",
      validation.errors,
    );
  }
  assertPersistable(admission, { subject: "openclaw-target-carrier-admission" });
  ADMITTED_CANDIDATES.add(admission);
  return deepFreeze(admission);
}

export function validateOpenClawTargetCarrierAdmission(value, context) {
  const errors = [];
  try {
    if (!plainObject(value) || !hasExactKeys(value, TOP_LEVEL_KEYS)) {
      return { ok: false, errors: ["admission must contain only canonical fields."] };
    }
    if (value.schemaVersion !== OPENCLAW_TARGET_CARRIER_ADMISSION_SCHEMA_VERSION
      || value.decision !== "admit-exact-target-and-native-plugin-recipe") {
      errors.push("invalid target/carrier admission identity.");
    }
    if (!plainObject(value.target)
      || !hasExactKeys(value.target, TARGET_KEYS)
      || value.target.id !== "openclaw"
      || typeof value.target.version !== "string"
      || value.target.version.length === 0
      || !/^[a-f0-9]{40}$/u.test(value.target.sourceRevision ?? "")
      || value.target.displayRevision !== value.target.sourceRevision.slice(0, 7)
      || typeof value.target.nodeRange !== "string"
      || value.target.nodeRange.length === 0
      || !DIGEST_PATTERN.test(value.target.descriptorDigest ?? "")
      || !DIGEST_PATTERN.test(value.target.executableDigest ?? "")
      || !DIGEST_PATTERN.test(value.target.packageJsonDigest ?? "")
      || !DIGEST_PATTERN.test(value.target.buildInfoDigest ?? "")
      || !DIGEST_PATTERN.test(value.target.targetRootDigest ?? "")) {
      errors.push("invalid exact OpenClaw target.");
    }
    if (!plainObject(value.authorities)
      || !hasExactKeys(value.authorities, AUTHORITY_KEYS)
      || Object.values(value.authorities).some((digest) => !DIGEST_PATTERN.test(digest))) {
      errors.push("invalid exact source authority digests.");
    }
    if (!plainObject(value.carrier)
      || !hasExactKeys(value.carrier, CARRIER_KEYS)
      || value.carrier.kind !== "native-plugin"
      || value.carrier.owner !== "agentmo-openclaw-harness"
      || value.carrier.implementationPathAccepted !== false
      || value.carrier.mcp !== false) {
      errors.push("invalid least-trust carrier admission.");
    }
    if (!Array.isArray(value.hookMappings)
      || value.hookMappings.length !== EXPECTED_HOOKS.length) {
      errors.push("hook mapping closure is incomplete.");
    } else {
      for (const [index, mapping] of value.hookMappings.entries()) {
        const [abstractHook, openclawEvent] = EXPECTED_HOOKS[index];
        if (!plainObject(mapping)
          || !hasExactKeys(mapping, HOOK_KEYS)
          || mapping.abstractHook !== abstractHook
          || mapping.openclawEvent !== openclawEvent
          || typeof mapping.permission !== "string"
          || mapping.permission.length === 0
          || !Number.isSafeInteger(mapping.timeoutMs)
          || mapping.timeoutMs <= 0
          || mapping.failureSemantics !== "fail-closed") {
          errors.push(`invalid hook mapping ${String(mapping?.abstractHook)}.`);
        }
      }
    }
    if (!plainObject(value.certificationBoundary)
      || !hasExactKeys(value.certificationBoundary, Object.keys(CERTIFICATION_BOUNDARY))
      || Object.entries(CERTIFICATION_BOUNDARY)
        .some(([key, expected]) => value.certificationBoundary[key] !== expected)) {
      errors.push("invalid certification boundary.");
    }
    if (context !== undefined) validateContext(value, context, errors);
    assertPersistable(value, { subject: "openclaw-target-carrier-admission" });
  } catch {
    errors.push("unsafe target/carrier admission shape.");
  }
  return { ok: errors.length === 0, errors };
}

export async function writeOpenClawTargetCarrierAdmission(
  filePath,
  admission,
  publicationAuthority,
  hooks = {},
) {
  if (!ADMITTED_CANDIDATES.has(admission)) {
    throw new PersistabilityError("AGENTMO_PERSISTABILITY_UNADMITTED_CANDIDATE");
  }
  if (!validateOpenClawTargetCarrierAdmission(admission).ok) {
    throw new PersistabilityError("AGENTMO_PERSISTABILITY_INVALID_CANDIDATE");
  }
  if (typeof filePath !== "string" || filePath.length === 0 || filePath.includes("\0")) {
    throw new PersistabilityError("AGENTMO_PERSISTABILITY_INVALID_OUTPUT_PATH");
  }
  assertPublicationAuthority(publicationAuthority);
  assertPublicationHooks(hooks);
  const bytes = serializePersistableJson(admission, {
    subject: "openclaw-target-carrier-admission",
  });
  const expectedDigest = digestRawBytes(Buffer.from(bytes, "utf8"));
  const outputPath = path.resolve(filePath);
  const stagePath = `${outputPath}.agentmo-stage-${process.pid}-${randomUUID()}`;
  let handle;
  let stageIdentity;
  let sourceConsumed = false;
  let published;
  try {
    handle = await open(stagePath, "wx", 0o600);
    stageIdentity = identity(await handle.stat({ bigint: true }));
    await handle.writeFile(bytes, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    stageIdentity = identity(await lstat(stagePath, { bigint: true }));
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
        type: "file",
      },
    });
    if (publication.sourceConsumed === true) {
      sourceConsumed = true;
      published = Object.freeze({
        digest: expectedDigest,
        identity: stageIdentity,
      });
    }
    if (publication.disposition !== "published"
      || publication.device !== stageIdentity.device
      || publication.inode !== stageIdentity.inode
      || publication.type !== "file") {
      throw new PersistabilityError(
        "AGENTMO_OPENCLAW_TARGET_ADMISSION_PUBLICATION_REFUSED",
      );
    }
    sourceConsumed = true;
    published ??= Object.freeze({
      digest: expectedDigest,
      identity: stageIdentity,
    });
    await hooks.afterNameCreated?.(Object.freeze({
      kind: "openclaw-target-carrier-admission",
      expectedDigest,
      expectedIdentity: published.identity,
      sourceConsumed: true,
    }));
    published = await observePublishedFile(outputPath, expectedDigest);
    await hooks.afterPublication?.(Object.freeze({
      kind: "openclaw-target-carrier-admission",
      expectedDigest,
      expectedIdentity: published.identity,
      sourceConsumed: true,
    }));
    const observed = await observePublishedFile(outputPath, expectedDigest);
    if (!sameIdentity(published.identity, observed.identity)) {
      throw new PersistabilityError(
        "AGENTMO_OPENCLAW_TARGET_ADMISSION_PUBLICATION_IDENTITY_DRIFT",
      );
    }
  } catch (error) {
    if (published === undefined && stageIdentity !== undefined) {
      published = await recoverConsumedPublication(
        outputPath,
        stagePath,
        expectedDigest,
        stageIdentity,
      );
      if (published !== undefined) sourceConsumed = true;
    }
    if (published !== undefined) {
      throw await publicationFailure(error, published, outputPath);
    }
    if (!sourceConsumed && stageIdentity !== undefined) {
      throw await privateTempFailure(
        error,
        stagePath,
        expectedDigest,
        stageIdentity,
      );
    }
    throw error;
  } finally {
    await handle?.close();
  }
  return filePath;
}

async function recoverConsumedPublication(
  outputPath,
  stagePath,
  expectedDigest,
  expectedIdentity,
) {
  try {
    await lstat(stagePath, { bigint: true });
    return undefined;
  } catch (error) {
    if (error?.code !== "ENOENT") return undefined;
  }
  try {
    const observed = await observePublishedFile(outputPath, expectedDigest);
    return sameIdentity(expectedIdentity, observed.identity)
      ? observed
      : undefined;
  } catch {
    return undefined;
  }
}

function assertPublicationAuthority(value) {
  if (!plainObject(value)
    || !hasExactKeys(value, ["helperPath", "receiptPath", "receiptDigest"])
    || !path.isAbsolute(value.helperPath ?? "")
    || !path.isAbsolute(value.receiptPath ?? "")
    || !DIGEST_PATTERN.test(value.receiptDigest ?? "")) {
    throw new PersistabilityError("AGENTMO_PERSISTABILITY_PUBLICATION_AUTHORITY_REQUIRED");
  }
}

function assertPublicationHooks(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => ![
      "afterNameCreated",
      "afterPublication",
    ].includes(key))
    || Object.values(value).some((callback) => typeof callback !== "function")) {
    throw new PersistabilityError("AGENTMO_PERSISTABILITY_INVALID_OUTPUT_PATH");
  }
}

async function observePublishedFile(filePath, expectedDigest) {
  const observed = await observeCurrentFile(filePath);
  if (observed.digest !== expectedDigest || observed.identity.links !== "1") {
    throw new PersistabilityError(
      "AGENTMO_OPENCLAW_TARGET_ADMISSION_PUBLICATION_IDENTITY_DRIFT",
    );
  }
  return Object.freeze(observed);
}

async function observeCurrentFile(filePath) {
  let handle;
  try {
    const before = await lstat(filePath, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink()) throw new Error("unsafe publication");
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
      throw new Error("publication changed during observation");
    }
    return {
      digest: digestRawBytes(bytes),
      identity: identity(after),
    };
  } finally {
    await handle?.close();
  }
}

async function publicationFailure(error, expected, filePath) {
  const failure = error instanceof Error
    ? error
    : new PersistabilityError(
      "AGENTMO_OPENCLAW_TARGET_ADMISSION_PUBLICATION_INCOMPLETE",
    );
  let observedIdentity = null;
  let observedDigest = null;
  try {
    const observed = await observeCurrentFile(filePath);
    observedIdentity = observed.identity;
    observedDigest = observed.digest;
  } catch {
    // Absence or an unsafe current object remains explicit recovery work.
  }
  if (failure.code === undefined) {
    failure.code = "AGENTMO_OPENCLAW_TARGET_ADMISSION_PUBLICATION_INCOMPLETE";
  }
  failure.recoveryRequired = true;
  failure.preservedPublications = Object.freeze([Object.freeze({
    kind: "openclaw-target-carrier-admission",
    disposition: "preserved",
    reason: observedIdentity === null
      ? "published-path-not-safely-observable"
      : "published-object-or-replacement-preserved",
    expectedDigest: expected.digest,
    observedDigest,
    expectedIdentity: expected.identity,
    observedIdentity,
  })]);
  return failure;
}

async function privateTempFailure(error, stagePath, expectedDigest, expectedIdentity) {
  const failure = error instanceof Error
    ? error
    : new PersistabilityError(
      "AGENTMO_OPENCLAW_TARGET_ADMISSION_PUBLICATION_INCOMPLETE",
    );
  let observedIdentity = null;
  let observedDigest = null;
  try {
    const observed = await observeCurrentFile(stagePath);
    observedIdentity = observed.identity;
    observedDigest = observed.digest;
  } catch {
    // Unknown private staging state is retained for explicit recovery.
  }
  if (failure.code === undefined) {
    failure.code = "AGENTMO_OPENCLAW_TARGET_ADMISSION_PUBLICATION_INCOMPLETE";
  }
  failure.recoveryRequired = true;
  failure.preservedPrivateTemps = Object.freeze([Object.freeze({
    kind: "openclaw-target-carrier-admission",
    path: stagePath,
    disposition: "preserved",
    reason: observedIdentity === null
      ? "private-temp-not-safely-observable"
      : "private-temp-preserved-for-recovery",
    expectedDigest,
    observedDigest,
    expectedIdentity,
    observedIdentity,
  })]);
  return failure;
}

function identity(stats) {
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

function exactSources(blueprint, buildContract, planApproval, admissions) {
  if (!plainObject(admissions)
    || !hasExactKeys(admissions, [
      "blueprint",
      "buildContract",
      "planApproval",
      "targetDescriptor",
    ])) {
    throw new OpenClawTargetAdmissionError("AGENTMO_OPENCLAW_SOURCE_AUTHORITY_INVALID");
  }
  admittedArtifactProvenance(admissions.targetDescriptor, {
    subject: "openclaw-target-descriptor",
    value: admissions.targetDescriptor.value,
  });
  return {
    blueprint: admittedArtifactProvenance(admissions.blueprint, {
      subject: "blueprint",
      value: blueprint,
    }),
    buildContract: admittedArtifactProvenance(admissions.buildContract, {
      subject: "build-contract",
      value: buildContract,
    }),
    planApproval: admittedArtifactProvenance(admissions.planApproval, {
      subject: "plan-approval",
      value: planApproval,
    }),
    targetDescriptor: admissions.targetDescriptor,
  };
}

function validateContext(value, context, errors) {
  if (!plainObject(context)
    || !plainObject(context.sources)
    || !hasExactKeys(context.sources, [
      "blueprint",
      "buildContract",
      "planApproval",
      "targetDescriptor",
    ])) {
    errors.push("exact source context is required.");
    return;
  }
  const expected = {
    blueprintDigest: context.sources.blueprint?.digest,
    buildContractDigest: context.sources.buildContract?.digest,
    planApprovalDigest: context.sources.planApproval?.digest,
    targetDescriptorDigest: context.sources.targetDescriptor?.digest,
  };
  for (const [key, digest] of Object.entries(expected)) {
    if (value.authorities?.[key] !== digest) errors.push(`${key} is stale.`);
  }
}

function plainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype
      || Object.getPrototypeOf(value) === null);
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
