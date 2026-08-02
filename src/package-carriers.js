import { createHash } from "node:crypto";
import {
  BUILD_CONTRACT_SCHEMA_VERSION,
  OPENCLAW_RESOURCE_KINDS,
  validateBuildContract,
} from "./build-contract.js";
import {
  assertPersistable,
  serializePersistableJson,
} from "./persistability.js";

const ABSTRACT_HOOKS = Object.freeze([
  "after-attempt",
  "after-tool",
  "before-attempt",
  "before-checkpoint",
]);
const EVENT_BY_HOOK = Object.freeze({
  "after-attempt": "agent_end",
  "after-tool": "after_tool_call",
  "before-attempt": "before_agent_run",
  "before-checkpoint": "before_compaction",
});
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const REAPPROVAL_KEYS = Object.freeze([
  "authority",
  "decision",
  "recipe",
  "hookMappings",
]);
const RECIPE_KEYS = Object.freeze([
  "schemaVersion",
  "owner",
  "files",
  "recipeDigest",
]);
const RECIPE_FILE_KEYS = Object.freeze([
  "relativePath",
  "type",
  "mode",
  "content",
  "byteLength",
  "sha256",
]);
const HOOK_MAPPING_KEYS = Object.freeze([
  "abstractHook",
  "openclawEvent",
  "owner",
  "recipeDigest",
  "versionRange",
  "permission",
  "timeoutMs",
  "failureSemantics",
  "unsupportedBehavior",
]);

export class PackageCarrierError extends Error {
  constructor(code, errors = []) {
    super("Agent Package carrier selection was rejected.");
    this.name = "PackageCarrierError";
    this.code = code;
    this.errors = Object.freeze([...errors]);
  }
}

export function assertApprovedHookCarrierConsistency(buildContract) {
  assertContractBasis(buildContract);
  const targetVersion = targetVersionFor(buildContract);
  if (buildContract.nativePluginRecipe !== null
    && buildContract.nativePluginRecipe !== undefined) {
    if (!validateBuildContract(buildContract).ok) {
      throw new PackageCarrierError("AGENTMO_PACKAGE_BUILD_CONTRACT_INVALID");
    }
    const recipe = buildContract.nativePluginRecipe;
    const result = {
      target: "openclaw",
      targetVersion,
      carrier: "native-plugin",
      owner: recipe.owner,
      recipe: structuredClone(recipe),
      hooks: recipe.hookMappings.map((mapping) => ({
        ...structuredClone(mapping),
        recipeDigest: recipe.recipeDigest,
      })),
      unsupportedBehavior: ["automatic-external-plugin-install"],
      phase3ReapprovalRequired: true,
    };
    assertPersistable(result, { subject: "package-hook-carrier-consistency" });
    return deepFreeze(result);
  }
  const hooks = buildContract.specification?.loop?.hooks;
  const reapproval = buildContract.specification?.plugins?.phase3Reapproval;
  if (reapproval === undefined) {
    const errors = hooks.map((hook) => (
      `OpenClaw ${targetVersion} has no approved bundled owner for ${hook}.`
    ));
    throw new PackageCarrierError("AGENTMO_PACKAGE_HOOK_OWNER_UNAPPROVED", errors);
  }
  const errors = validateReapproval(buildContract, reapproval);
  if (errors.length > 0) {
    throw new PackageCarrierError("AGENTMO_PACKAGE_HOOK_RECIPE_INVALID", errors);
  }
  const result = {
    target: "openclaw",
    targetVersion,
    carrier: "native-plugin",
    owner: reapproval.recipe.owner,
    recipe: structuredClone(reapproval.recipe),
    hooks: structuredClone(reapproval.hookMappings),
    unsupportedBehavior: ["automatic-external-plugin-install"],
    phase3ReapprovalRequired: true,
  };
  assertPersistable(result, { subject: "package-hook-carrier-consistency" });
  return deepFreeze(result);
}

export function selectPackageCarriers(buildContract) {
  const hookConsistency = assertApprovedHookCarrierConsistency(buildContract);
  const entries = [];
  for (const resource of buildContract.resources) {
    const selection = selectionForResource(resource.kind, hookConsistency);
    entries.push({
      capabilityId: resource.id,
      resourceId: resource.id,
      ...selection,
    });
  }
  for (const mapping of hookConsistency.hooks) {
    entries.push({
      capabilityId: `hook:${mapping.abstractHook}`,
      resourceId: "resource:agent-loop",
      carrier: "native-plugin",
      owner: mapping.owner,
      necessity: "typed-hook-requires-in-process-owner",
      trust: "in-process-code",
      rationale: "OpenClaw typed lifecycle events require the Phase 3-approved native plugin recipe.",
      recipeDigest: mapping.recipeDigest,
      openclawEvent: mapping.openclawEvent,
      permission: mapping.permission,
      timeoutMs: mapping.timeoutMs,
      failureSemantics: mapping.failureSemantics,
      unsupportedBehavior: [...mapping.unsupportedBehavior],
    });
  }
  entries.sort((left, right) => left.capabilityId.localeCompare(right.capabilityId));
  const result = {
    schemaVersion: "agentmo.package-carrier-selection.v1",
    target: "openclaw",
    targetVersion: hookConsistency.targetVersion,
    entries,
    mcpCarrierCount: 0,
    certificationBoundary: {
      carrierSelectionOnly: true,
      packageBuilt: false,
      installed: false,
      runtime: false,
      domain: false,
      production: false,
    },
  };
  assertPersistable(result, { subject: "package-carrier-selection" });
  return deepFreeze(result);
}

function assertContractBasis(buildContract) {
  if (buildContract?.schemaVersion !== BUILD_CONTRACT_SCHEMA_VERSION
    || buildContract?.targetRuntime?.id !== "openclaw"
    || typeof buildContract?.targetRuntime?.observedVersion !== "string"
    || typeof buildContract?.targetRuntime?.displayRevision !== "string"
    || buildContract?.targetDescriptor === undefined
    || !sameArray([...buildContract.specification?.loop?.hooks ?? []].sort(), ABSTRACT_HOOKS)
    || !sameArray(buildContract.resources?.map(({ kind }) => kind), OPENCLAW_RESOURCE_KINDS)) {
    throw new PackageCarrierError("AGENTMO_PACKAGE_BUILD_CONTRACT_INVALID");
  }
  const reapproval = buildContract.specification?.plugins?.phase3Reapproval;
  if (reapproval === undefined) {
    if (!validateBuildContract(buildContract).ok) {
      throw new PackageCarrierError("AGENTMO_PACKAGE_BUILD_CONTRACT_INVALID");
    }
    return;
  }
  const base = structuredClone(buildContract);
  delete base.specification.plugins.phase3Reapproval;
  base.specification.plugins.selectedLane = "bundled";
  if (!validateBuildContract(base).ok) {
    throw new PackageCarrierError("AGENTMO_PACKAGE_BUILD_CONTRACT_INVALID");
  }
}

function validateReapproval(buildContract, reapproval) {
  const errors = [];
  if (buildContract.specification.plugins.selectedLane !== "workspace-local"
    || !plainObject(reapproval)
    || !hasExactKeys(reapproval, REAPPROVAL_KEYS)
    || reapproval.authority !== "exact-build-contract-bytes"
    || reapproval.decision !== "approve-package-local-native-plugin") {
    return ["package-local native plugin lacks exact Phase 3 reapproval."];
  }
  validateRecipe(reapproval.recipe, errors);
  const recipe = reapproval.recipe;
  if (!Array.isArray(reapproval.hookMappings)
    || !sameArray(reapproval.hookMappings.map(({ abstractHook }) => abstractHook), ABSTRACT_HOOKS)) {
    errors.push("hook mappings must cover all four abstract hooks in canonical order.");
    return errors;
  }
  for (const mapping of reapproval.hookMappings) {
    if (!plainObject(mapping)
      || !hasExactKeys(mapping, HOOK_MAPPING_KEYS)
      || mapping.openclawEvent !== EVENT_BY_HOOK[mapping.abstractHook]
      || mapping.owner !== recipe?.owner
      || mapping.recipeDigest !== recipe?.recipeDigest
      || mapping.versionRange !== targetVersionFor(buildContract)
      || typeof mapping.permission !== "string"
      || mapping.permission.length === 0
      || !Number.isSafeInteger(mapping.timeoutMs)
      || mapping.timeoutMs <= 0
      || mapping.failureSemantics !== "fail-closed"
      || !sortedUniqueStrings(mapping.unsupportedBehavior)
      || mapping.unsupportedBehavior.length === 0) {
      errors.push(`invalid approved hook mapping ${String(mapping?.abstractHook)}.`);
    }
  }
  return errors;
}

function targetVersionFor(buildContract) {
  return `${buildContract.targetRuntime.observedVersion}@${buildContract.targetRuntime.displayRevision}`;
}

function validateRecipe(recipe, errors) {
  if (!plainObject(recipe)
    || !hasExactKeys(recipe, RECIPE_KEYS)
    || recipe.schemaVersion !== "agentmo.native-plugin-recipe.v1"
    || recipe.owner !== "agentmo-openclaw-harness"
    || !Array.isArray(recipe.files)
    || recipe.files.length === 0
    || !DIGEST_PATTERN.test(recipe.recipeDigest ?? "")) {
    errors.push("native plugin recipe is incomplete.");
    return;
  }
  const paths = recipe.files.map((entry) => entry?.relativePath);
  if (!sameArray(paths, [...paths].sort()) || new Set(paths).size !== paths.length) {
    errors.push("native plugin recipe files must be sorted and unique.");
  }
  for (const file of recipe.files) {
    if (!plainObject(file)
      || !hasExactKeys(file, RECIPE_FILE_KEYS)
      || !portableRelativePath(file.relativePath)
      || !file.relativePath.startsWith("openclaw/plugin/")
      || file.type !== "file"
      || ![0o644, 0o755].includes(file.mode)
      || typeof file.content !== "string"
      || file.content.includes("\0")
      || file.byteLength !== Buffer.byteLength(file.content, "utf8")
      || file.sha256 !== sha256(Buffer.from(file.content, "utf8"))) {
      errors.push(`invalid native plugin recipe member ${String(file?.relativePath)}.`);
    }
  }
  const basis = {
    schemaVersion: recipe.schemaVersion,
    owner: recipe.owner,
    files: recipe.files,
  };
  const digest = sha256(Buffer.from(serializePersistableJson(basis, {
    subject: "native-plugin-recipe",
  }), "utf8"));
  if (recipe.recipeDigest !== digest) {
    errors.push("native plugin recipe digest does not bind canonical content.");
  }
}

function selectionForResource(kind, hookConsistency) {
  if (kind === "skills") {
    return {
      carrier: "skill",
      owner: "agent-package",
      necessity: "declarative-domain-instructions",
      trust: "workspace-instructions",
      rationale: "OpenClaw workspace skills satisfy the capability without executable code.",
    };
  }
  if (kind === "plugins" || kind === "agent-loop" || kind === "harness") {
    return {
      carrier: "native-plugin",
      owner: hookConsistency.owner,
      necessity: "approved-typed-hook-owner",
      trust: "in-process-code",
      rationale: "The exact Phase 3-approved recipe is required for typed lifecycle hooks.",
      recipeDigest: hookConsistency.recipe.recipeDigest,
    };
  }
  return {
    carrier: "workspace-content",
    owner: "agent-package",
    necessity: "portable-declarative-resource",
    trust: "workspace-content",
    rationale: "Portable package content is the lowest-trust sufficient OpenClaw carrier.",
  };
}

function portableRelativePath(value) {
  if (typeof value !== "string"
    || value.length === 0
    || value.includes("\0")
    || value.includes("\\")
    || value.startsWith("/")
    || value !== value.normalize("NFC")) {
    return false;
  }
  return value.split("/").every((segment) => (
    segment.length > 0 && segment !== "." && segment !== ".."
  ));
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function plainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function sortedUniqueStrings(value) {
  return Array.isArray(value)
    && value.every((entry) => typeof entry === "string" && entry.length > 0)
    && new Set(value).size === value.length
    && sameArray(value, [...value].sort());
}

function sameArray(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((entry, index) => entry === right[index]);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
