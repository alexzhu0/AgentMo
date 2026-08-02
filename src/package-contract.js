import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  assertPersistable,
  serializePersistableJson,
} from "./persistability.js";

export const AGENT_PACKAGE_SCHEMA_VERSION = "agentmo.package-manifest.v1";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$/u;
const TARGET_VERSION_PATTERN =
  /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?@[a-f0-9]{7,40}$/u;
const MANIFEST_KEYS = Object.freeze([
  "schemaVersion",
  "packageId",
  "packageVersion",
  "sourceBindings",
  "targetCompatibility",
  "capabilityIds",
  "capabilityLedger",
  "members",
  "inventoryDigest",
  "ownership",
  "permissions",
  "evidenceRefs",
  "certificationBoundary",
  "remainingRisks",
]);
const SOURCE_BINDING_KEYS = Object.freeze([
  "blueprintDigest",
  "buildContractDigest",
  "designPlanDigest",
  "discoveryApprovalDigest",
  "decisionLedgerDigest",
  "planApprovalDigest",
]);
const TARGET_COMPATIBILITY_KEYS = Object.freeze([
  "target",
  "version",
  "sourceRevision",
  "exactRevisionRequired",
]);
const LEDGER_KEYS = Object.freeze([
  "capabilityId",
  "resourceId",
  "carrier",
  "owner",
  "necessity",
  "trust",
  "memberPaths",
  "recipeDigest",
  "targetMapping",
  "permission",
  "approvalRequirement",
  "timeoutMs",
  "failureSemantics",
  "unsupportedBehavior",
]);
const TARGET_MAPPING_KEYS = Object.freeze([
  "target",
  "event",
  "versionRange",
]);
const MEMBER_KEYS = Object.freeze([
  "relativePath",
  "type",
  "mode",
  "byteLength",
  "sha256",
]);
const OWNERSHIP_KEYS = Object.freeze([
  "packageOwner",
  "managedMemberPaths",
  "externalStateIncluded",
]);
const CERTIFICATION_KEYS = Object.freeze([
  "deterministicPackageMechanism",
  "installed",
  "runtime",
  "domain",
  "production",
]);
const CARRIERS = new Set(["workspace-content", "skill", "native-plugin", "mcp"]);
const FIXED_FILE_MODES = new Set([0o644, 0o755]);

export function validateAgentPackageManifest(value, context = {}) {
  const errors = [];
  try {
    if (!plainObject(value) || !hasExactKeys(value, MANIFEST_KEYS)) {
      return result(["package manifest must contain only canonical fields."]);
    }
    if (value.schemaVersion !== AGENT_PACKAGE_SCHEMA_VERSION) {
      errors.push("invalid schemaVersion.");
    }
    if (!ID_PATTERN.test(value.packageId ?? "")) errors.push("invalid packageId.");
    if (!VERSION_PATTERN.test(value.packageVersion ?? "")) errors.push("invalid packageVersion.");
    validateSourceBindings(value.sourceBindings, errors);
    validateTargetCompatibility(value.targetCompatibility, errors);
    validateMembers(value.members, errors);
    if (!DIGEST_PATTERN.test(value.inventoryDigest ?? "")
      || value.inventoryDigest !== digestInventory(value.members)) {
      errors.push("inventoryDigest must bind the exact canonical member inventory.");
    }
    if (!sortedUniqueStrings(value.capabilityIds) || value.capabilityIds.length === 0) {
      errors.push("capabilityIds must be a non-empty sorted unique array.");
    }
    const ledger = validatePackageCapabilityLedger(value.capabilityLedger, {
      capabilityIds: value.capabilityIds,
      members: value.members,
      allowMcp: false,
    });
    errors.push(...ledger.errors);
    validateOwnership(value.ownership, value.members, errors);
    if (!sortedUniqueStrings(value.permissions) || value.permissions.length === 0) {
      errors.push("permissions must be a non-empty sorted unique array.");
    }
    if (!sortedUniqueStrings(value.evidenceRefs) || value.evidenceRefs.length === 0) {
      errors.push("evidenceRefs must be a non-empty sorted unique array.");
    }
    validateCertificationBoundary(value.certificationBoundary, errors);
    if (!sortedUniqueStrings(value.remainingRisks) || value.remainingRisks.length === 0) {
      errors.push("remainingRisks must be a non-empty sorted unique array.");
    }
    if (!plainObject(context) || !hasOnlyKeys(context, ["observedMembers"])) {
      errors.push("manifest validation context contains unsupported fields.");
    } else if (context.observedMembers !== undefined) {
      const observedErrors = [];
      validateMembers(context.observedMembers, observedErrors);
      if (observedErrors.length > 0
        || !isDeepStrictEqual(context.observedMembers, value.members)) {
        errors.push("observed members must exactly match the canonical member inventory.");
      }
    }
    assertPersistable(value, { subject: "package-manifest" });
  } catch (error) {
    errors.push(`unsafe package manifest shape${error?.code ? `: ${error.code}` : ""}.`);
  }
  return result(errors);
}

export function validatePackageCapabilityLedger(value, context = {}) {
  const errors = [];
  try {
    if (!Array.isArray(value)
      || !plainObject(context)
      || !hasOnlyKeys(context, ["capabilityIds", "members", "allowMcp"])) {
      return result(["capability ledger or validation context is invalid."]);
    }
    const capabilityIds = context.capabilityIds;
    const members = context.members;
    if (!sortedUniqueStrings(capabilityIds)
      || !Array.isArray(members)
      || value.length !== capabilityIds.length
      || !sameArray(value.map((entry) => entry?.capabilityId), capabilityIds)) {
      errors.push("capability ledger must cover each declared capability exactly once.");
    }
    const memberPaths = new Set(
      Array.isArray(members) ? members.map((entry) => entry?.relativePath) : [],
    );
    const referencedPaths = [];
    for (const entry of value) {
      validateLedgerEntry(entry, memberPaths, context.allowMcp === true, errors);
      if (Array.isArray(entry?.memberPaths)) referencedPaths.push(...entry.memberPaths);
    }
    if (memberPaths.size !== referencedPaths.length
      || new Set(referencedPaths).size !== referencedPaths.length
      || Array.from(memberPaths).some((memberPath) => !referencedPaths.includes(memberPath))) {
      errors.push("capability ledger must index every member exactly once.");
    }
    assertPersistable(value, { subject: "package-capability-ledger" });
  } catch (error) {
    errors.push(`unsafe capability ledger shape${error?.code ? `: ${error.code}` : ""}.`);
  }
  return result(errors);
}

function validateLedgerEntry(entry, memberPaths, allowMcp, errors) {
  if (!plainObject(entry) || !hasExactKeys(entry, LEDGER_KEYS)) {
    errors.push("capability ledger entries must contain only canonical fields.");
    return;
  }
  if (!ID_PATTERN.test(entry.capabilityId ?? "")
    || !ID_PATTERN.test(entry.resourceId ?? "")
    || !CARRIERS.has(entry.carrier)
    || !ID_PATTERN.test(entry.owner ?? "")
    || !nonEmptyString(entry.necessity)
    || !nonEmptyString(entry.trust)
    || !sortedUniqueStrings(entry.memberPaths)
    || entry.memberPaths.length === 0
    || entry.memberPaths.some((memberPath) => !memberPaths.has(memberPath))
    || !nonEmptyString(entry.permission)
    || !nonEmptyString(entry.approvalRequirement)
    || entry.failureSemantics !== "fail-closed"
    || !sortedUniqueStrings(entry.unsupportedBehavior)) {
    errors.push(`invalid capability ledger entry ${String(entry.capabilityId)}.`);
  }
  if (!plainObject(entry.targetMapping)
    || !hasExactKeys(entry.targetMapping, TARGET_MAPPING_KEYS)
    || entry.targetMapping.target !== "openclaw"
    || !TARGET_VERSION_PATTERN.test(entry.targetMapping.versionRange ?? "")) {
    errors.push(`invalid target mapping for ${String(entry.capabilityId)}.`);
  }
  if (entry.carrier === "native-plugin") {
    if (!DIGEST_PATTERN.test(entry.recipeDigest ?? "")
      || !nonEmptyString(entry.targetMapping?.event)
      || !Number.isSafeInteger(entry.timeoutMs)
      || entry.timeoutMs <= 0
      || entry.unsupportedBehavior.length === 0
      || entry.trust !== "in-process-code") {
      errors.push(`native plugin capability ${String(entry.capabilityId)} lacks executable authority.`);
    }
  } else if (entry.carrier === "mcp") {
    if (!allowMcp) errors.push("MCP is not approved for the current v1 resource graph.");
    if (!DIGEST_PATTERN.test(entry.recipeDigest ?? "")
      || !Number.isSafeInteger(entry.timeoutMs)
      || entry.timeoutMs <= 0) {
      errors.push(`MCP capability ${String(entry.capabilityId)} lacks executable authority.`);
    }
  } else if (entry.recipeDigest !== null
    || entry.targetMapping?.event !== null
    || entry.timeoutMs !== null) {
    errors.push(`declarative capability ${String(entry.capabilityId)} has elevated carrier fields.`);
  }
}

function validateSourceBindings(value, errors) {
  if (!plainObject(value)
    || !hasExactKeys(value, SOURCE_BINDING_KEYS)
    || SOURCE_BINDING_KEYS.some((key) => !DIGEST_PATTERN.test(value[key] ?? ""))) {
    errors.push("sourceBindings must contain exact Plan and Produce-entry digests.");
  }
}

function validateTargetCompatibility(value, errors) {
  if (!Array.isArray(value)
    || value.length === 0
    || !sameArray(value.map((entry) => entry?.target), [...value.map((entry) => entry?.target)].sort())
    || new Set(value.map((entry) => entry?.target)).size !== value.length) {
    errors.push("targetCompatibility must be sorted and unique.");
    return;
  }
  for (const entry of value) {
    if (!plainObject(entry)
      || !hasExactKeys(entry, TARGET_COMPATIBILITY_KEYS)
      || !ID_PATTERN.test(entry.target ?? "")
      || !nonEmptyString(entry.version)
      || !/^[a-f0-9]{8,64}$/u.test(entry.sourceRevision ?? "")
      || entry.exactRevisionRequired !== true) {
      errors.push("invalid target compatibility entry.");
    }
  }
}

function validateMembers(value, errors) {
  if (!Array.isArray(value)
    || value.length === 0
    || !sameArray(value.map((entry) => entry?.relativePath), [
      ...value.map((entry) => entry?.relativePath),
    ].sort(comparePortablePaths))) {
    errors.push("members must be a non-empty canonically sorted array.");
    return;
  }
  const exactPaths = new Set();
  const foldedPaths = new Set();
  for (const entry of value) {
    if (!plainObject(entry)
      || !hasExactKeys(entry, MEMBER_KEYS)
      || !portableRelativePath(entry.relativePath)
      || entry.type !== "file"
      || !FIXED_FILE_MODES.has(entry.mode)
      || !Number.isSafeInteger(entry.byteLength)
      || entry.byteLength < 0
      || !DIGEST_PATTERN.test(entry.sha256 ?? "")) {
      errors.push(`invalid package member ${String(entry?.relativePath)}.`);
      continue;
    }
    const folded = entry.relativePath.normalize("NFC").toLocaleLowerCase("en-US");
    if (exactPaths.has(entry.relativePath) || foldedPaths.has(folded)) {
      errors.push(`colliding package member ${entry.relativePath}.`);
    }
    exactPaths.add(entry.relativePath);
    foldedPaths.add(folded);
  }
}

function validateOwnership(value, members, errors) {
  const paths = Array.isArray(members) ? members.map(({ relativePath }) => relativePath) : [];
  if (!plainObject(value)
    || !hasExactKeys(value, OWNERSHIP_KEYS)
    || value.packageOwner !== "agentmo"
    || value.externalStateIncluded !== false
    || !sameArray(value.managedMemberPaths, paths)) {
    errors.push("ownership must bind every canonical member and exclude external state.");
  }
}

function validateCertificationBoundary(value, errors) {
  if (!plainObject(value)
    || !hasExactKeys(value, CERTIFICATION_KEYS)
    || value.deterministicPackageMechanism !== true
    || value.installed !== false
    || value.runtime !== false
    || value.domain !== false
    || value.production !== false) {
    errors.push("package certification boundary cannot promote install, runtime, domain, or production.");
  }
}

function digestInventory(members) {
  if (!Array.isArray(members)) return null;
  const bytes = Buffer.from(serializePersistableJson(members, {
    subject: "package-member-inventory",
  }), "utf8");
  return `sha256:${cryptoHash(bytes)}`;
}

function cryptoHash(bytes) {
  return createHash("sha256")
    .update(bytes)
    .digest("hex");
}

function portableRelativePath(value) {
  if (typeof value !== "string"
    || value.length === 0
    || value.length > 512
    || value.includes("\0")
    || value.includes("\\")
    || value.startsWith("/")
    || value !== value.normalize("NFC")) {
    return false;
  }
  const segments = value.split("/");
  return segments.every((segment) => (
    segment.length > 0
    && segment !== "."
    && segment !== ".."
    && !segment.endsWith(" ")
    && !segment.endsWith(".")
  ));
}

function comparePortablePaths(left, right) {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

function result(errors) {
  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze([...errors]),
  });
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

function hasOnlyKeys(value, keys) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 512;
}

function sortedUniqueStrings(value) {
  return Array.isArray(value)
    && value.every(nonEmptyString)
    && new Set(value).size === value.length
    && sameArray(value, [...value].sort());
}

function sameArray(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}
