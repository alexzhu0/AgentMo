import { open, unlink } from "node:fs/promises";
import path from "node:path";
import {
  admittedArtifactProvenance,
  ArtifactAdmissionError,
  digestRawBytes,
} from "./artifact-admission.js";
import {
  PersistabilityError,
  serializePersistableJson,
} from "./persistability.js";

export const DISCOVERY_APPROVAL_SCHEMA_VERSION = "agentmo.discovery-approval.v1";
export const DISCOVERY_APPROVAL_PREVIEW_SCHEMA_VERSION = "agentmo.discovery-approval-preview.v1";

const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const ADMITTED_APPROVAL_CANDIDATES = new WeakSet();
const APPROVAL_KEYS = Object.freeze([
  "schemaVersion",
  "decision",
  "decisionScope",
  "previewDigest",
  "bindings",
  "certificationBoundary",
]);
const PREVIEW_KEYS = Object.freeze([
  "schemaVersion",
  "decisionScope",
  "bindings",
  "certificationBoundary",
]);
const BINDING_KEYS = Object.freeze(["discoveryManifest", "discoveryDb"]);
const PROVENANCE_KEYS = Object.freeze(["identity", "subject", "digest"]);
const CERTIFICATION_BOUNDARY = Object.freeze({
  localOperatorIntentOnly: true,
  authenticatedOrganization: false,
  sourceQuality: false,
  runtime: false,
  package: false,
  domain: false,
  production: false,
});

export class DiscoveryApprovalError extends Error {
  constructor(code) {
    super("Discovery approval was rejected.");
    this.name = "DiscoveryApprovalError";
    this.code = code;
  }
}

export function buildDiscoveryApprovalPreview(manifest, discoveryDb, options = {}) {
  const bindings = admittedBindings(manifest, discoveryDb, options.admissions);
  const body = {
    schemaVersion: DISCOVERY_APPROVAL_PREVIEW_SCHEMA_VERSION,
    decisionScope: "enter-plan",
    bindings,
    certificationBoundary: { ...CERTIFICATION_BOUNDARY },
  };
  const bytes = Buffer.from(serializePersistableJson(body, {
    subject: "discovery-approval-preview",
  }), "utf8");
  return Object.freeze({
    ...body,
    previewDigest: digestRawBytes(bytes),
  });
}

export function buildDiscoveryApproval(manifest, discoveryDb, options = {}) {
  if (options.approve !== true) {
    throw new DiscoveryApprovalError("AGENTMO_DISCOVERY_APPROVAL_REQUIRED");
  }
  if (typeof options.previewDigest !== "string"
    || !SHA256_DIGEST_PATTERN.test(options.previewDigest)) {
    throw new DiscoveryApprovalError("AGENTMO_DISCOVERY_APPROVAL_PREVIEW_INVALID");
  }
  const preview = buildDiscoveryApprovalPreview(manifest, discoveryDb, options);
  if (preview.previewDigest !== options.previewDigest) {
    throw new DiscoveryApprovalError("AGENTMO_DISCOVERY_APPROVAL_PREVIEW_MISMATCH");
  }
  const approval = {
    schemaVersion: DISCOVERY_APPROVAL_SCHEMA_VERSION,
    decision: "approve",
    decisionScope: "enter-plan",
    previewDigest: preview.previewDigest,
    bindings: preview.bindings,
    certificationBoundary: { ...CERTIFICATION_BOUNDARY },
  };
  const validation = validateDiscoveryApproval(approval, {
    manifest,
    discoveryDb,
    sources: preview.bindings,
  });
  if (!validation.ok) {
    throw new DiscoveryApprovalError("AGENTMO_DISCOVERY_APPROVAL_INVALID");
  }
  serializePersistableJson(approval, { subject: "discovery-approval" });
  ADMITTED_APPROVAL_CANDIDATES.add(approval);
  return approval;
}

export function validateDiscoveryApproval(value, context) {
  const errors = [];
  if (!plainObject(value) || !hasExactKeys(value, APPROVAL_KEYS)) {
    return { ok: false, errors: ["approval must contain only the canonical approval fields."] };
  }
  if (value.schemaVersion !== DISCOVERY_APPROVAL_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${DISCOVERY_APPROVAL_SCHEMA_VERSION}.`);
  }
  if (value.decision !== "approve") errors.push("decision must be approve.");
  if (value.decisionScope !== "enter-plan") errors.push("decisionScope must be enter-plan.");
  if (!SHA256_DIGEST_PATTERN.test(value.previewDigest)) {
    errors.push("previewDigest must be an exact sha256 digest.");
  }
  validateBindings(value.bindings, errors);
  validateCertificationBoundary(value.certificationBoundary, errors);

  if (context !== undefined) {
    if (!plainObject(context)
      || !plainObject(context.sources)
      || !hasExactKeys(context.sources, BINDING_KEYS)
      || context.manifest === undefined
      || context.discoveryDb === undefined) {
      errors.push("approval validation requires the exact admitted manifest and discovery DB.");
    } else {
      for (const key of BINDING_KEYS) {
        if (!sameProvenance(value.bindings?.[key], context.sources[key])) {
          errors.push(`bindings.${key} does not match the admitted raw bytes.`);
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export async function writeDiscoveryApproval(filePath, approval) {
  if (!ADMITTED_APPROVAL_CANDIDATES.has(approval)) {
    throw new PersistabilityError("AGENTMO_PERSISTABILITY_UNADMITTED_CANDIDATE");
  }
  const validation = validateDiscoveryApproval(approval);
  if (!validation.ok) {
    throw new PersistabilityError("AGENTMO_PERSISTABILITY_INVALID_CANDIDATE");
  }
  const serialized = serializePersistableJson(approval, { subject: "discovery-approval" });
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
        // Best-effort removal of an incomplete, newly-created approval.
      }
    }
    throw error;
  } finally {
    await handle?.close();
  }
  return filePath;
}

function admittedBindings(manifest, discoveryDb, admissions) {
  if (!plainObject(admissions) || !hasExactKeys(admissions, BINDING_KEYS)) {
    throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_ADMISSION_RESULT_INVALID");
  }
  return {
    discoveryManifest: admittedArtifactProvenance(admissions.discoveryManifest, {
      subject: "discovery-manifest",
      value: manifest,
    }),
    discoveryDb: admittedArtifactProvenance(admissions.discoveryDb, {
      subject: "discovery-db",
      value: discoveryDb,
    }),
  };
}

function validateBindings(value, errors) {
  if (!plainObject(value) || !hasExactKeys(value, BINDING_KEYS)) {
    errors.push("bindings must contain exact discoveryManifest and discoveryDb provenance.");
    return;
  }
  validateProvenance(
    value.discoveryManifest,
    "agentmo.discovery.v1",
    "discovery-manifest",
    "bindings.discoveryManifest",
    errors,
  );
  validateProvenance(
    value.discoveryDb,
    "agentmo.discovery-db.v1",
    "discovery-db",
    "bindings.discoveryDb",
    errors,
  );
}

function validateProvenance(value, identity, subject, pointer, errors) {
  if (!plainObject(value) || !hasExactKeys(value, PROVENANCE_KEYS)) {
    errors.push(`${pointer} must contain exact identity, subject, and digest provenance.`);
    return;
  }
  if (value.identity !== identity) errors.push(`${pointer}.identity is invalid.`);
  if (value.subject !== subject) errors.push(`${pointer}.subject is invalid.`);
  if (!SHA256_DIGEST_PATTERN.test(value.digest)) errors.push(`${pointer}.digest is invalid.`);
}

function validateCertificationBoundary(value, errors) {
  const expectedKeys = Object.keys(CERTIFICATION_BOUNDARY);
  if (!plainObject(value) || !hasExactKeys(value, expectedKeys)) {
    errors.push("certificationBoundary must contain only the canonical boundary fields.");
    return;
  }
  for (const key of expectedKeys) {
    if (value[key] !== CERTIFICATION_BOUNDARY[key]) {
      errors.push(`certificationBoundary.${key} is invalid.`);
    }
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
