import { createHash, timingSafeEqual } from "node:crypto";
import { open } from "node:fs/promises";
import {
  assertNoDuplicateIdentityMembers,
  companionSubjectsForDurableArtifact,
  resolveDurableArtifactDescriptor,
} from "./artifact-registry.js";
import { auditEvidence } from "./evidence-audit.js";
import { containsHostAbsolutePath } from "./secret-redaction.js";

export const DEFAULT_MAX_ARTIFACT_BYTES = 1024 * 1024;

const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const SUBJECT_PATTERN = /^[a-z][a-z0-9-]*$/u;
const ADMITTED_RESULTS = new WeakSet();
const SOURCE_AUTHENTIC_RESULTS = new WeakSet();
const SOURCE_CONTEXT_SUBJECTS = new Set(["run-eval", "birth-report", "delivery-report"]);
const RAW_ADMISSION_FIELDS = new Set([
  "rawtranscript",
  "rawtranscripts",
  "rawtoolbody",
  "rawtoolbodies",
  "rawstdoutpreview",
  "rawstdoutpreviews",
  "rawstderrpreview",
  "rawstderrpreviews",
  "stdoutpreview",
  "stdoutpreviews",
  "stderrpreview",
  "stderrpreviews",
]);
const ERROR_MESSAGES = Object.freeze({
  AGENTMO_ARTIFACT_BYTES_REQUIRED: "Artifact admission requires raw bytes.",
  AGENTMO_ARTIFACT_DIGEST_REQUIRED: "Every durable artifact subject requires an exact digest binding.",
  AGENTMO_ARTIFACT_DIGEST_DUPLICATE: "A durable artifact subject has more than one digest binding.",
  AGENTMO_ARTIFACT_DIGEST_UNKNOWN_SUBJECT: "A digest binding names an unsupported subject.",
  AGENTMO_ARTIFACT_DIGEST_INVALID: "A digest binding is malformed.",
  AGENTMO_ARTIFACT_DIGEST_MISMATCH: "Artifact bytes do not match the supplied digest.",
  AGENTMO_ARTIFACT_INPUT_TOO_LARGE: "Artifact input exceeds the bounded admission limit.",
  AGENTMO_ARTIFACT_READ_FAILED: "Artifact bytes could not be read safely.",
  AGENTMO_ARTIFACT_INVALID_UTF8: "Artifact bytes are not valid UTF-8.",
  AGENTMO_ARTIFACT_INVALID_JSON: "Artifact bytes are not valid JSON.",
  AGENTMO_ARTIFACT_UNSAFE_CONTENT: "Artifact content is unsafe for durable admission.",
  AGENTMO_ARTIFACT_COMPANION_SET_REQUIRED: "Derived artifact admission requires its exact admitted source set.",
  AGENTMO_ARTIFACT_ADMISSION_RESULT_INVALID: "Artifact admission result is not authentic for this subject and value.",
});

export class ArtifactAdmissionError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code] ?? "Artifact admission failed.");
    this.name = "ArtifactAdmissionError";
    this.code = code;
  }
}

export function digestRawBytes(bytes) {
  if (!Buffer.isBuffer(bytes)) {
    throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_BYTES_REQUIRED");
  }
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function parseDigestBindings(values, requiredSubjects) {
  if (!Array.isArray(values) || !Array.isArray(requiredSubjects)) {
    throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_DIGEST_INVALID");
  }
  const required = new Set(requiredSubjects);
  if (
    required.size !== requiredSubjects.length ||
    requiredSubjects.some((subject) => typeof subject !== "string" || !SUBJECT_PATTERN.test(subject))
  ) {
    throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_DIGEST_INVALID");
  }

  const parsed = Object.create(null);
  for (const binding of values) {
    if (typeof binding !== "string") {
      throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_DIGEST_INVALID");
    }
    const separator = binding.indexOf("=");
    if (separator <= 0 || separator !== binding.lastIndexOf("=")) {
      throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_DIGEST_INVALID");
    }
    const subject = binding.slice(0, separator);
    const digest = binding.slice(separator + 1);
    if (!SUBJECT_PATTERN.test(subject) || !SHA256_DIGEST_PATTERN.test(digest)) {
      throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_DIGEST_INVALID");
    }
    if (!required.has(subject)) {
      throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_DIGEST_UNKNOWN_SUBJECT");
    }
    if (Object.hasOwn(parsed, subject)) {
      throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_DIGEST_DUPLICATE");
    }
    parsed[subject] = digest;
  }

  if (requiredSubjects.some((subject) => !Object.hasOwn(parsed, subject))) {
    throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_DIGEST_REQUIRED");
  }
  return Object.freeze(parsed);
}

export async function loadAdmittedArtifact(options) {
  const subject = options?.subject;
  const expectedDigest = options?.expectedDigest;
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_ARTIFACT_BYTES;
  if (typeof subject !== "string" || !SUBJECT_PATTERN.test(subject)) {
    throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_DIGEST_UNKNOWN_SUBJECT");
  }
  if (typeof expectedDigest !== "string" || !SHA256_DIGEST_PATTERN.test(expectedDigest)) {
    throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_DIGEST_INVALID");
  }
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_READ_FAILED");
  }

  const bytes = await readBoundedArtifact(options?.filePath, maxBytes, options?.openInput ?? open);
  const actualDigest = digestRawBytes(bytes);
  if (!sameDigest(actualDigest, expectedDigest)) {
    throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_DIGEST_MISMATCH");
  }

  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_INVALID_UTF8");
  }

  try {
    assertNoDuplicateIdentityMembers(text);
  } catch (error) {
    if (error?.code === "AGENTMO_UNSUPPORTED_ARTIFACT") throw error;
    throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_INVALID_JSON");
  }

  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_INVALID_JSON");
  }

  const audit = auditEvidence(value);
  if (!audit.ok || containsUnsafeAdmissionContent(value)) {
    throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_UNSAFE_CONTENT");
  }
  const validationContext = buildSourceValidationContext(subject, value, options?.companions);
  const descriptor = resolveDurableArtifactDescriptor(value, subject, { validationContext });
  deepFreezeJson(value);
  const result = Object.freeze({
    identity: descriptor.identity,
    subject,
    digest: actualDigest,
    value,
  });
  ADMITTED_RESULTS.add(result);
  if (validationContext !== undefined) SOURCE_AUTHENTIC_RESULTS.add(result);
  return result;
}

export function admittedArtifactProvenance(result, options = {}) {
  if (!result || typeof result !== "object"
    || !ADMITTED_RESULTS.has(result)
    || result.subject !== options.subject
    || result.value !== options.value) {
    throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_ADMISSION_RESULT_INVALID");
  }
  return Object.freeze({
    identity: result.identity,
    subject: result.subject,
    digest: result.digest,
  });
}

function buildSourceValidationContext(subject, value, companions) {
  const requiredSubjects = companionSubjectsForDurableArtifact(subject, value);
  if (requiredSubjects === null) {
    if (companions !== undefined) {
      throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_COMPANION_SET_REQUIRED");
    }
    return undefined;
  }
  if (!plainObject(companions)) {
    throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_COMPANION_SET_REQUIRED");
  }
  const actualSubjects = Object.keys(companions);
  if (actualSubjects.length !== requiredSubjects.length
    || requiredSubjects.some((requiredSubject) => !Object.hasOwn(companions, requiredSubject))) {
    throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_COMPANION_SET_REQUIRED");
  }
  for (const companionSubject of requiredSubjects) {
    assertAuthenticCompanionAdmission(companions[companionSubject], companionSubject);
  }

  const valueFor = (companionSubject) => companions[companionSubject].value;
  const provenanceFor = (companionSubject) => admittedArtifactProvenance(
    companions[companionSubject],
    { subject: companionSubject, value: valueFor(companionSubject) },
  );
  if (subject === "run-eval") {
    return {
      runState: valueFor("run-state"),
      source: provenanceFor("run-state"),
    };
  }
  if (subject === "birth-report") {
    return {
      blueprint: valueFor("blueprint"),
      buildState: valueFor("build-state"),
      runState: valueFor("run-state"),
      runEval: valueFor("run-eval"),
      expectStatus: valueFor("run-eval")?.expectedStatus,
      sources: {
        blueprint: provenanceFor("blueprint"),
        buildState: provenanceFor("build-state"),
        runState: provenanceFor("run-state"),
        runEval: provenanceFor("run-eval"),
      },
    };
  }
  if (subject === "delivery-report") {
    const hasDomainEval = requiredSubjects.includes("domain-eval");
    return {
      blueprint: valueFor("blueprint"),
      buildState: valueFor("build-state"),
      runState: valueFor("run-state"),
      runEval: valueFor("run-eval"),
      birthReport: valueFor("birth-report"),
      domainEval: hasDomainEval ? valueFor("domain-eval") : null,
      sources: {
        blueprint: provenanceFor("blueprint"),
        buildState: provenanceFor("build-state"),
        runState: provenanceFor("run-state"),
        runEval: provenanceFor("run-eval"),
        birthReport: provenanceFor("birth-report"),
        domainEval: hasDomainEval ? provenanceFor("domain-eval") : null,
      },
    };
  }
  throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_COMPANION_SET_REQUIRED");
}

function assertAuthenticCompanionAdmission(result, subject) {
  if (!result
    || typeof result !== "object"
    || !ADMITTED_RESULTS.has(result)
    || result.subject !== subject
    || typeof result.identity !== "string"
    || !SHA256_DIGEST_PATTERN.test(result.digest)
    || result.value === undefined
    || (SOURCE_CONTEXT_SUBJECTS.has(subject) && !SOURCE_AUTHENTIC_RESULTS.has(result))) {
    throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_ADMISSION_RESULT_INVALID");
  }
}

function containsUnsafeAdmissionContent(value) {
  const stack = [value];
  let nodes = 0;
  while (stack.length > 0) {
    const item = stack.pop();
    nodes += 1;
    if (nodes > 20_000) return true;
    if (typeof item === "string") {
      if (containsAdmissionHostAbsolutePath(item)) return true;
      continue;
    }
    if (!item || typeof item !== "object") continue;
    if (Array.isArray(item)) {
      stack.push(...item);
      continue;
    }
    for (const [key, child] of Object.entries(item)) {
      if (containsAdmissionHostAbsolutePath(key)) return true;
      const normalized = key.toLowerCase().replace(/[_-]/gu, "");
      if (RAW_ADMISSION_FIELDS.has(normalized) && hasStoredContent(child)) return true;
      stack.push(child);
    }
  }
  return false;
}

function containsAdmissionHostAbsolutePath(value) {
  if (!containsHostAbsolutePath(value)) return false;
  const withoutPortableRelativeReferences = value.replace(
    /(^|[\s"'`(])(?:\.\.?[\\/])+(?:[^\s"'`<>),\]}]+)?/gmu,
    "$1[MANAGED_RELATIVE_REFERENCE]",
  );
  return containsHostAbsolutePath(withoutPortableRelativeReferences);
}

function hasStoredContent(value) {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return value === true;
}

function plainObject(value) {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

async function readBoundedArtifact(filePath, maxBytes, openInput) {
  let handle;
  try {
    handle = await openInput(filePath, "r");
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(maxBytes)) {
      throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_INPUT_TOO_LARGE");
    }

    const chunks = [];
    let position = 0;
    while (position <= maxBytes) {
      const remaining = maxBytes + 1 - position;
      const chunk = Buffer.alloc(Math.min(64 * 1024, remaining));
      const result = await handle.read(chunk, 0, chunk.length, position);
      if (!Number.isInteger(result?.bytesRead) || result.bytesRead < 0 || result.bytesRead > chunk.length) {
        throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_READ_FAILED");
      }
      if (result.bytesRead === 0) break;
      position += result.bytesRead;
      if (position > maxBytes) {
        throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_INPUT_TOO_LARGE");
      }
      chunks.push(chunk.subarray(0, result.bytesRead));
    }

    const after = await handle.stat({ bigint: true });
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      BigInt(position) !== after.size
    ) {
      throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_READ_FAILED");
    }
    return Buffer.concat(chunks, position);
  } catch (error) {
    if (error instanceof ArtifactAdmissionError) throw error;
    throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_READ_FAILED");
  } finally {
    try {
      await handle?.close();
    } catch {
      // Closing a read-only handle after the bytes were captured cannot change the admitted artifact.
    }
  }
}

function sameDigest(left, right) {
  const leftBytes = Buffer.from(left.slice("sha256:".length), "hex");
  const rightBytes = Buffer.from(right.slice("sha256:".length), "hex");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function deepFreezeJson(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreezeJson(child);
  return Object.freeze(value);
}
