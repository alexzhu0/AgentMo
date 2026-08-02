import { open, unlink } from "node:fs/promises";
import path from "node:path";
import {
  admittedArtifactProvenance,
  ArtifactAdmissionError,
  digestRawBytes,
} from "./artifact-admission.js";
import {
  BUILD_CONTRACT_SCHEMA_VERSION,
  validateBuildContract,
} from "./build-contract.js";
import {
  PersistabilityError,
  serializePersistableJson,
} from "./persistability.js";

export const PLAN_APPROVAL_SCHEMA_VERSION = "agentmo.plan-approval.v1";
export const PLAN_APPROVAL_PREVIEW_SCHEMA_VERSION = "agentmo.plan-approval-preview.v1";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const ADMITTED_PLAN_APPROVAL_CANDIDATES = new WeakSet();
const BINDING_KEYS = Object.freeze(["blueprint", "buildContract"]);
const PREVIEW_KEYS = Object.freeze([
  "schemaVersion",
  "decisionScope",
  "bindings",
  "approvalCoverage",
  "certificationBoundary",
]);
const APPROVAL_KEYS = Object.freeze([
  "schemaVersion",
  "decision",
  "decisionScope",
  "previewDigest",
  "bindings",
  "approvalCoverage",
  "certificationBoundary",
]);
const CERTIFICATION_BOUNDARY = Object.freeze({
  localOperatorIntentOnly: true,
  authenticatedOrganization: false,
  packageBuilt: false,
  packageInstalled: false,
  runtime: false,
  domain: false,
  production: false,
});

export class PlanApprovalError extends Error {
  constructor(code, errors = []) {
    super("Plan approval was rejected.");
    this.name = "PlanApprovalError";
    this.code = code;
    this.errors = [...errors];
  }
}

export function buildPlanApprovalPreview(blueprint, buildContract, options = {}) {
  const bindings = admittedBindings(blueprint, buildContract, options.admissions);
  assertContractBinding(buildContract, bindings);
  const body = {
    schemaVersion: PLAN_APPROVAL_PREVIEW_SCHEMA_VERSION,
    decisionScope: "enter-produce",
    bindings,
    approvalCoverage: buildApprovalCoverage(buildContract),
    certificationBoundary: { ...CERTIFICATION_BOUNDARY },
  };
  const bytes = Buffer.from(serializePersistableJson(body, {
    subject: "plan-approval-preview",
  }), "utf8");
  return deepFreeze({
    ...body,
    previewDigest: digestRawBytes(bytes),
  });
}

export function buildPlanApproval(blueprint, buildContract, options = {}) {
  if (options.approve !== true) {
    throw new PlanApprovalError("AGENTMO_PLAN_APPROVAL_REQUIRED");
  }
  if (!DIGEST_PATTERN.test(options.previewDigest ?? "")) {
    throw new PlanApprovalError("AGENTMO_PLAN_APPROVAL_PREVIEW_INVALID");
  }
  const preview = buildPlanApprovalPreview(blueprint, buildContract, options);
  if (preview.previewDigest !== options.previewDigest) {
    throw new PlanApprovalError("AGENTMO_PLAN_APPROVAL_PREVIEW_MISMATCH");
  }
  const approval = {
    schemaVersion: PLAN_APPROVAL_SCHEMA_VERSION,
    decision: "approve",
    decisionScope: "enter-produce",
    previewDigest: preview.previewDigest,
    bindings: preview.bindings,
    approvalCoverage: preview.approvalCoverage,
    certificationBoundary: { ...CERTIFICATION_BOUNDARY },
  };
  const validation = validatePlanApproval(approval, {
    blueprint,
    buildContract,
    sources: preview.bindings,
  });
  if (!validation.ok) {
    throw new PlanApprovalError("AGENTMO_PLAN_APPROVAL_INVALID", validation.errors);
  }
  serializePersistableJson(approval, { subject: "plan-approval" });
  ADMITTED_PLAN_APPROVAL_CANDIDATES.add(approval);
  return deepFreeze(approval);
}

export function validatePlanApproval(value, context) {
  const errors = [];
  try {
    if (!plainObject(value) || !hasExactKeys(value, APPROVAL_KEYS)) {
      return { ok: false, errors: ["approval must contain only canonical fields."] };
    }
    if (value.schemaVersion !== PLAN_APPROVAL_SCHEMA_VERSION) errors.push("invalid schemaVersion.");
    if (value.decision !== "approve") errors.push("decision must be approve.");
    if (value.decisionScope !== "enter-produce") errors.push("invalid decisionScope.");
    if (!DIGEST_PATTERN.test(value.previewDigest ?? "")) errors.push("invalid previewDigest.");
    validateBindings(value.bindings, errors);
    validateApprovalCoverage(value.approvalCoverage, errors);
    validateCertificationBoundary(value.certificationBoundary, errors);
    if (context !== undefined) validateContext(value, context, errors);
    serializePersistableJson(value, { subject: "plan-approval" });
  } catch {
    errors.push("unsafe plan approval shape.");
  }
  return { ok: errors.length === 0, errors };
}

export async function writePlanApproval(filePath, approval) {
  if (!ADMITTED_PLAN_APPROVAL_CANDIDATES.has(approval)) {
    throw new PersistabilityError("AGENTMO_PERSISTABILITY_UNADMITTED_CANDIDATE");
  }
  if (!validatePlanApproval(approval).ok) {
    throw new PersistabilityError("AGENTMO_PERSISTABILITY_INVALID_CANDIDATE");
  }
  const serialized = serializePersistableJson(approval, { subject: "plan-approval" });
  if (typeof filePath !== "string" || filePath.length === 0 || filePath.includes("\0")) {
    throw new PersistabilityError("AGENTMO_PERSISTABILITY_INVALID_OUTPUT_PATH");
  }
  const target = path.resolve(filePath);
  let handle;
  let created = false;
  try {
    handle = await open(target, "wx", 0o600);
    created = true;
    await handle.writeFile(serialized, "utf8");
    await handle.sync();
  } catch (error) {
    if (created) {
      try {
        await unlink(target);
      } catch {
        // Best effort for a newly-created partial approval.
      }
    }
    throw error;
  } finally {
    await handle?.close();
  }
  return filePath;
}

function admittedBindings(blueprint, buildContract, admissions) {
  if (!plainObject(admissions) || !hasExactKeys(admissions, BINDING_KEYS)) {
    throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_ADMISSION_RESULT_INVALID");
  }
  if (!validateBuildContract(buildContract).ok) {
    throw new PlanApprovalError("AGENTMO_PLAN_APPROVAL_CONTRACT_INVALID");
  }
  return {
    blueprint: admittedArtifactProvenance(admissions.blueprint, {
      subject: "blueprint",
      value: blueprint,
    }),
    buildContract: admittedArtifactProvenance(admissions.buildContract, {
      subject: "build-contract",
      value: buildContract,
    }),
  };
}

function assertContractBinding(buildContract, bindings) {
  if (buildContract.bindings?.blueprint?.digest !== bindings.blueprint.digest) {
    throw new PlanApprovalError("AGENTMO_PLAN_APPROVAL_STALE_INPUT");
  }
}

function buildApprovalCoverage(buildContract) {
  return {
    requirementDigests: digestIds(buildContract.traceGraph.requirementIds),
    capabilityDigests: digestIds(buildContract.traceGraph.capabilityIds),
    permissionDigests: digestIds(buildContract.traceGraph.permissionIds),
    acceptanceCaseDigests: digestIds(buildContract.traceGraph.acceptanceCaseIds),
    resourceDigests: digestIds(buildContract.traceGraph.resourceIds),
    evidenceObligationDigests: digestIds(buildContract.traceGraph.evidenceObligationIds),
  };
}

function digestIds(ids) {
  return ids.map((id) => digestRawBytes(Buffer.from(id, "utf8")));
}

function validateContext(value, context, errors) {
  if (!plainObject(context)
    || !plainObject(context.sources)
    || !hasExactKeys(context.sources, BINDING_KEYS)
    || context.blueprint === undefined
    || context.buildContract === undefined
    || !validateBuildContract(context.buildContract).ok) {
    errors.push("approval validation requires exact admitted blueprint and build contract.");
    return;
  }
  for (const key of BINDING_KEYS) {
    if (!sameProvenance(value.bindings?.[key], context.sources[key])) {
      errors.push(`bindings.${key} does not match admitted raw bytes.`);
    }
  }
  if (context.buildContract.bindings?.blueprint?.digest !== context.sources.blueprint.digest) {
    errors.push("build contract does not bind the exact blueprint.");
  }
  const expectedCoverage = buildApprovalCoverage(context.buildContract);
  if (JSON.stringify(value.approvalCoverage) !== JSON.stringify(expectedCoverage)) {
    errors.push("approval coverage is stale.");
  }
}

function validateBindings(value, errors) {
  if (!plainObject(value) || !hasExactKeys(value, BINDING_KEYS)) {
    errors.push("bindings must contain exact blueprint and build contract.");
    return;
  }
  validateProvenance(value.blueprint, "0.1", "blueprint", errors);
  validateProvenance(
    value.buildContract,
    BUILD_CONTRACT_SCHEMA_VERSION,
    "build-contract",
    errors,
  );
}

function validateProvenance(value, identity, subject, errors) {
  if (!plainObject(value)
    || !hasExactKeys(value, ["identity", "subject", "digest"])
    || value.identity !== identity
    || value.subject !== subject
    || !DIGEST_PATTERN.test(value.digest ?? "")) {
    errors.push(`invalid ${subject} provenance.`);
  }
}

function validateApprovalCoverage(value, errors) {
  const keys = [
    "requirementDigests",
    "capabilityDigests",
    "permissionDigests",
    "acceptanceCaseDigests",
    "resourceDigests",
    "evidenceObligationDigests",
  ];
  if (!plainObject(value) || !hasExactKeys(value, keys)) {
    errors.push("approvalCoverage must contain every governed class.");
    return;
  }
  for (const key of keys) {
    if (!Array.isArray(value[key])
      || value[key].length === 0
      || value[key].some((digest) => !DIGEST_PATTERN.test(digest))
      || new Set(value[key]).size !== value[key].length) {
      errors.push(`invalid approvalCoverage.${key}.`);
    }
  }
}

function validateCertificationBoundary(value, errors) {
  if (!plainObject(value) || !hasExactKeys(value, Object.keys(CERTIFICATION_BOUNDARY))) {
    errors.push("invalid certification boundary.");
    return;
  }
  for (const [key, expected] of Object.entries(CERTIFICATION_BOUNDARY)) {
    if (value[key] !== expected) errors.push(`invalid certificationBoundary.${key}.`);
  }
}

function sameProvenance(left, right) {
  return plainObject(left)
    && plainObject(right)
    && left.identity === right.identity
    && left.subject === right.subject
    && left.digest === right.digest;
}

function hasExactKeys(value, expected) {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function plainObject(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
