import { createHash } from "node:crypto";
import path from "node:path";
import { assertPersistable, serializePersistableJson } from "./persistability.js";

export const BUILD_STATE_SCHEMA_VERSION = "agentmo.build-state.v1";
export const LEGACY_BUILD_STATE_SCHEMA_VERSION = "agentmo.build.v1";
export const BUILD_STATE_FILENAME = "agentmo-build-state.json";

const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const AUTHORIZED_SOURCE_IDENTITY = "0.1";

export async function createBuildState(blueprint, plan, options = {}) {
  const { admittedArtifactProvenance } = await import("./artifact-admission.js");
  const source = admittedArtifactProvenance(options.admission, {
    subject: "blueprint",
    value: blueprint,
  });
  const state = {
    schemaVersion: BUILD_STATE_SCHEMA_VERSION,
    generatedAt: options.generatedAt ?? null,
    agentId: blueprint.agent_id,
    target: {
      id: plan.selectedTargetId,
      label: plan.target?.label ?? plan.selectedTargetId,
      verificationHintDigests: (plan.target?.verificationHints ?? []).map(digestText),
      unsupportedSurfaces: [...(plan.target?.unsupportedSurfaces ?? [])],
    },
    request: {
      target: options.target ?? plan.selectedTargetId,
      profile: options.profile ?? options.profileId ?? null,
      outputRoot: {
        kind: "ManagedRelativeRef",
        relativePath: ".",
      },
    },
    resolution: {
      selectedTargetId: plan.selectedTargetId,
      selectedProfileId: plan.selectedProfileId,
      selectedModuleIds: [...plan.selectedModuleIds],
      domainOperationCount: plan.domainOperationCount,
      warnings: [...plan.warnings],
    },
    source,
    operations: plan.operations.map(summarizeOperation),
  };
  assertPersistable(state, { subject: "build-state" });
  const validation = validateBuildStateArtifact(state);
  if (!validation.ok) {
    const error = new Error("Build-state candidate is invalid.");
    error.code = "AGENTMO_BUILD_STATE_INVALID";
    throw error;
  }
  return deepFreeze(state);
}

export function validateBuildStateArtifact(state, options = {}) {
  if (options.legacy === true) return validateLegacyBuildState(state, "agentmother");
  if (options.legacyCanonical === true) return validateLegacyBuildState(state, "agentmo");

  const errors = [];
  try {
    assertPersistable(state, { subject: "build-state" });
    requireExactKeys(state, [
      "schemaVersion",
      "generatedAt",
      "agentId",
      "target",
      "request",
      "resolution",
      "source",
      "operations",
    ], "build_state", errors);
    if (state?.schemaVersion !== BUILD_STATE_SCHEMA_VERSION) errors.push("invalid_schema_version");
    if (state?.generatedAt !== null && !validTimestamp(state?.generatedAt)) errors.push("invalid_generated_at");
    if (!isKebabId(state?.agentId)) errors.push("invalid_agent_id");
    if (!validTarget(state?.target)) errors.push("invalid_target");
    if (!validRequest(state?.request)) errors.push("invalid_request");
    if (!validResolution(state?.resolution)) errors.push("invalid_resolution");
    if (!validSource(state?.source)) errors.push("invalid_source_provenance");
    if (!validOperations(state?.operations)) errors.push("invalid_operations");
    if (state?.resolution?.domainOperationCount !== state?.operations?.length) {
      errors.push("inconsistent_operation_count");
    }
    if (state?.target?.id !== state?.resolution?.selectedTargetId) errors.push("inconsistent_target");
  } catch {
    errors.push("unsafe_build_state_shape");
  }
  return { ok: errors.length === 0, errors };
}

export function serializeBuildState(state) {
  if (!validateBuildStateArtifact(state).ok) {
    const error = new Error("Build-state candidate is invalid.");
    error.code = "AGENTMO_BUILD_STATE_INVALID";
    throw error;
  }
  return serializePersistableJson(state, { subject: "build-state" });
}

export function buildStatePath(outputDir) {
  return path.join(outputDir, BUILD_STATE_FILENAME);
}

function summarizeOperation(operation) {
  if (typeof operation?.content !== "string") {
    const error = new Error("Build operation content is missing.");
    error.code = "AGENTMO_BUILD_STATE_INVALID";
    throw error;
  }
  return {
    kind: operation.kind,
    relativePath: operation.relativePath,
    contentDigest: digestText(operation.content),
    ownership: operation.ownership,
    source: operation.source,
    scaffoldOnly: operation.scaffoldOnly === true,
  };
}

function digestText(value) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function validTarget(value) {
  return hasExactKeys(value, ["id", "label", "verificationHintDigests", "unsupportedSurfaces"])
    && nonEmptyString(value.id)
    && nonEmptyString(value.label)
    && Array.isArray(value.verificationHintDigests)
    && value.verificationHintDigests.every((digest) => typeof digest === "string" && SHA256_DIGEST_PATTERN.test(digest))
    && stringArray(value.unsupportedSurfaces);
}

function validRequest(value) {
  return hasExactKeys(value, ["target", "profile", "outputRoot"])
    && nonEmptyString(value.target)
    && nullableString(value.profile)
    && hasExactKeys(value.outputRoot, ["kind", "relativePath"])
    && value.outputRoot.kind === "ManagedRelativeRef"
    && value.outputRoot.relativePath === ".";
}

function validResolution(value) {
  return hasExactKeys(value, [
    "selectedTargetId",
    "selectedProfileId",
    "selectedModuleIds",
    "domainOperationCount",
    "warnings",
  ])
    && nonEmptyString(value.selectedTargetId)
    && nullableString(value.selectedProfileId)
    && stringArray(value.selectedModuleIds)
    && nonNegativeInteger(value.domainOperationCount)
    && stringArray(value.warnings);
}

function validSource(value) {
  return hasExactKeys(value, ["identity", "subject", "digest"])
    && value.identity === AUTHORIZED_SOURCE_IDENTITY
    && value.subject === "blueprint"
    && SHA256_DIGEST_PATTERN.test(value.digest);
}

function validOperations(value) {
  if (!Array.isArray(value)) return false;
  const seen = new Set();
  const caseFolded = new Set();
  const paths = [];
  let previous = null;
  for (const operation of value) {
    if (!hasExactKeys(operation, [
      "kind",
      "relativePath",
      "contentDigest",
      "ownership",
      "source",
      "scaffoldOnly",
    ])
      || operation.kind !== "write-file"
      || !isManagedRelativePath(operation.relativePath)
      || operation.relativePath === BUILD_STATE_FILENAME
      || !SHA256_DIGEST_PATTERN.test(operation.contentDigest)
      || operation.ownership !== "managed"
      || !nonEmptyString(operation.source)
      || operation.scaffoldOnly !== true
      || seen.has(operation.relativePath)
      || caseFolded.has(operation.relativePath.toLowerCase())
      || paths.some((existing) => existing.startsWith(`${operation.relativePath}/`) || operation.relativePath.startsWith(`${existing}/`))
      || (previous !== null && comparePaths(previous, operation.relativePath) >= 0)) return false;
    seen.add(operation.relativePath);
    caseFolded.add(operation.relativePath.toLowerCase());
    paths.push(operation.relativePath);
    previous = operation.relativePath;
  }
  return true;
}

function isManagedRelativePath(value) {
  if (!nonEmptyString(value)
    || value.includes("\0")
    || value.includes("\\")
    || path.posix.isAbsolute(value)) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
    && path.posix.normalize(value) === value;
}

function comparePaths(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function validateLegacyBuildState(state, identity) {
  const errors = [];
  if (!plainObject(state)) return { ok: false, errors: ["build_state_not_object"] };
  if (state.schemaVersion !== LEGACY_BUILD_STATE_SCHEMA_VERSION) errors.push("invalid_schema_version");
  if (!nonEmptyString(state.generatedAt)) errors.push("invalid_generated_at");
  if (!nonEmptyString(state.agentId)) errors.push("invalid_agent_id");
  if (!legacyTarget(state.target)) errors.push("invalid_target");
  if (!legacyRequest(state.request)) errors.push("invalid_request");
  if (!legacyResolution(state.resolution)) errors.push("invalid_resolution");
  if (!legacySource(state.source, identity)) errors.push("invalid_source_provenance");
  if (!Array.isArray(state.operations) || state.operations.some((operation) => !legacyOperation(operation))) {
    errors.push("invalid_operations");
  } else if (state.resolution?.domainOperationCount !== state.operations.length) {
    errors.push("inconsistent_operation_count");
  }
  if (state.target?.id !== state.resolution?.selectedTargetId) errors.push("inconsistent_target");
  return { ok: errors.length === 0, errors };
}

function legacyTarget(value) {
  return plainObject(value)
    && nonEmptyString(value.id)
    && nonEmptyString(value.label)
    && stringArray(value.verificationHints)
    && stringArray(value.unsupportedSurfaces);
}

function legacyRequest(value) {
  return plainObject(value)
    && nullableString(value.blueprintPath)
    && nullableString(value.outputDir)
    && nonEmptyString(value.target)
    && typeof value.force === "boolean"
    && nullableString(value.profile);
}

function legacyResolution(value) {
  return plainObject(value)
    && nonEmptyString(value.selectedTargetId)
    && nullableString(value.selectedProfileId)
    && stringArray(value.selectedModuleIds)
    && nonNegativeInteger(value.domainOperationCount)
    && stringArray(value.warnings);
}

function legacySource(value, identity) {
  if (!plainObject(value)
    || !nullableString(value.blueprintPath)
    || typeof value.blueprintHash !== "string"
    || !/^[a-f0-9]{64}$/u.test(value.blueprintHash)) return false;
  if (identity === "agentmother") {
    return value.agentmotherVersion === "0.1"
      && value.blueprintVersion === "0.1"
      && !Object.hasOwn(value, "agentmoVersion");
  }
  return value.agentmoVersion === "0.1"
    && !Object.hasOwn(value, "agentmotherVersion")
    && !Object.hasOwn(value, "blueprintVersion");
}

function legacyOperation(value) {
  return plainObject(value)
    && nonEmptyString(value.kind)
    && nonEmptyString(value.relativePath)
    && nonEmptyString(value.ownership)
    && nonEmptyString(value.source)
    && typeof value.scaffoldOnly === "boolean"
    && (!Object.hasOwn(value, "destinationPath") || nonEmptyString(value.destinationPath));
}

function requireExactKeys(value, keys, label, errors) {
  if (!hasExactKeys(value, keys)) errors.push(`${label}_fields_invalid`);
}

function hasExactKeys(value, keys) {
  if (!plainObject(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function plainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function nullableString(value) {
  return value === null || typeof value === "string";
}

function stringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function validTimestamp(value) {
  return nonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function isKebabId(value) {
  return typeof value === "string" && /^[a-z][a-z0-9-]*$/u.test(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
