import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { isProxy } from "node:util/types";
import {
  auditEvidence,
  isPersistabilityRawContentField,
  isRawMaterialKind,
  isRawStoredFlagField,
  normalizeEvidenceFieldName,
} from "./evidence-audit.js";
import {
  containsHostAbsolutePath,
  containsSecretLikeKey,
  containsSecretLikeValue,
  isSecretSafetyFlagKey,
  REDACTED_PATH,
  REDACTED_SECRET,
} from "./secret-redaction.js";

const CARRIER_KINDS = new Set(["SecretRef", "SecretPresence", "RedactedSummary"]);
const SAFE_REDACTED_SUMMARY_KINDS = new Set(["empty", "structured-json-summary", "unstructured-digest-summary"]);
const SECRET_REF_KEYS = ["kind", "source", "name"];
const SECRET_PRESENCE_KEYS = [
  "kind",
  "source",
  "allowedNames",
  "presentNames",
  "missingNames",
  "valuesPersisted",
];
const REDACTED_SUMMARY_KEYS = [
  "kind",
  "summaryKind",
  "sha256",
  "length",
  "redactedLength",
  "text",
  "redacted",
];
const HOSTILE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const POLICY_LANGUAGE_KEYS = new Set([
  "managedevidenceexcludes",
  "forbiddendatahandling",
]);
const SUBJECT_POINTER_KEYS = new Set(["subject", "pointer", "jsonpointer"]);
const SECRET_NAME_PATTERN = /^(?=.{1,128}$)[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/u;
const SAFE_SUBJECT_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const RAW_MATERIAL_TEXT_PATTERN = /(?:^|[^a-z0-9])raw[\s_.-]*(?:prompt|transcripts?|tool[\s_.-]*(?:body|output)s?|stdout|stderr)(?:[^a-z0-9]|$)/iu;
const DEFAULT_MAX_DEPTH = 128;
const DEFAULT_MAX_NODES = 20_000;
const DEFAULT_MAX_BYTES = 1_048_576;
const MAX_SECRET_NAMES = 128;
const MAX_REDACTED_TEXT_LENGTH = 512;
const DEFAULT_IO = Object.freeze({ mkdir, rename, writeFile });
const PERSISTABLE_PRODUCT_TEXTS = new WeakSet();

export class PersistabilityError extends Error {
  constructor(code) {
    super("Artifact candidate is not persistable.");
    this.name = "PersistabilityError";
    this.code = code;
    this.category = "persistability";
    this.guidance = "Use bounded ordinary data or an exact approved carrier.";
  }
}

export function isSecretRef(value) {
  const fields = exactDataFields(value, SECRET_REF_KEYS);
  return fields !== null
    && fields.kind === "SecretRef"
    && fields.source === "runtime-env"
    && isSecretName(fields.name);
}

export function isSecretPresence(value) {
  const fields = exactDataFields(value, SECRET_PRESENCE_KEYS);
  if (fields === null
    || fields.kind !== "SecretPresence"
    || fields.source !== "runtime-env"
    || fields.valuesPersisted !== false
    || !isSortedUniqueSecretNameArray(fields.allowedNames)
    || !isSortedUniqueSecretNameArray(fields.presentNames)
    || !isSortedUniqueSecretNameArray(fields.missingNames)) return false;

  const allowed = fields.allowedNames;
  const present = new Set(fields.presentNames);
  const missing = new Set(fields.missingNames);
  if (present.size + missing.size !== allowed.length) return false;
  return allowed.every((name) => present.has(name) !== missing.has(name));
}

export function isRedactedSummary(value) {
  const fields = exactDataFields(value, REDACTED_SUMMARY_KEYS);
  if (fields === null
    || fields.kind !== "RedactedSummary"
    || !SAFE_REDACTED_SUMMARY_KINDS.has(fields.summaryKind)
    || !DIGEST_PATTERN.test(fields.sha256)
    || !isBoundedNonNegativeInteger(fields.length)
    || !isBoundedNonNegativeInteger(fields.redactedLength)
    || fields.redacted !== true
    || typeof fields.text !== "string") return false;
  const internallyConsistentEmpty = fields.summaryKind !== "empty"
    || (fields.text === "" && fields.length === 0 && fields.redactedLength === 0);
  return internallyConsistentEmpty
    && Array.from(fields.text).length <= MAX_REDACTED_TEXT_LENGTH
    && fields.redactedLength === fields.text.length
    && fields.sha256 === sha256(fields.text)
    && isSafeString(fields.text, { rejectRawLanguage: true });
}

export function assertPersistable(value, options = {}) {
  validatePersistable(value, options);
  return value;
}

export function serializePersistableJson(value, options = {}) {
  const { clone, limits } = validatePersistable(value, options);
  const serialized = `${JSON.stringify(clone, null, 2)}\n`;
  assertFinalText(serialized, limits.maxBytes, { rejectRawLanguage: false });
  return serialized;
}

export async function writePersistableJsonAtomic(filePath, value, options = {}) {
  const serialized = serializePersistableJson(value, options);
  return writeValidatedTextAtomic(filePath, serialized, options);
}

export async function writePersistableTextAtomic(filePath, text, options = {}) {
  const { limits } = validatePersistable(text, options);
  assertFinalText(text, limits.maxBytes, { rejectRawLanguage: true });
  return writeValidatedTextAtomic(filePath, text, options);
}

// Scaffold prompts and skills are product data, not runtime evidence. This
// branded lane allows policy language only after the original text has passed
// secret checks and concrete host paths have been rejected. Callers cannot
// bypass the check by forging the returned wrapper.
export function preparePersistableProductText(text, options = {}) {
  if (typeof text !== "string" || text.includes("\0") || containsSecretLikeValue(text)) {
    fail("AGENTMO_PERSISTABILITY_SENSITIVE_MATERIAL");
  }
  const limits = normalizeLimits(options);
  if (Buffer.byteLength(text) > limits.maxBytes) {
    fail("AGENTMO_PERSISTABILITY_RESOURCE_BUDGET");
  }
  const masked = maskPortableProductReferences(text);
  validatePersistable({ forbiddenDataHandling: masked }, options);
  const candidate = Object.freeze({ text });
  PERSISTABLE_PRODUCT_TEXTS.add(candidate);
  return candidate;
}

export async function writePersistableProductTextAtomic(filePath, candidate, options = {}) {
  if (!candidate || typeof candidate !== "object" || !PERSISTABLE_PRODUCT_TEXTS.has(candidate)) {
    fail("AGENTMO_PERSISTABILITY_UNSUPPORTED_VALUE");
  }
  return writeValidatedTextAtomic(filePath, candidate.text, options);
}

export async function emitPersistableOutput(configuration) {
  if (configuration === null || typeof configuration !== "object" || isProxy(configuration)) {
    fail("AGENTMO_PERSISTABILITY_INVALID_OUTPUT_ADAPTER");
  }
  const prototype = Object.getPrototypeOf(configuration);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("AGENTMO_PERSISTABILITY_INVALID_OUTPUT_ADAPTER");
  }
  const fields = Object.getOwnPropertyDescriptors(configuration);
  const allowedKeys = new Set(["candidate", "format", "json", "sink", "options"]);
  if (Reflect.ownKeys(configuration).some((key) => typeof key !== "string" || !allowedKeys.has(key))) {
    fail("AGENTMO_PERSISTABILITY_INVALID_OUTPUT_ADAPTER");
  }
  for (const key of ["candidate", "format", "json", "sink"]) {
    if (!Object.hasOwn(fields, key) || !isEnumerableDataDescriptor(fields[key])) {
      fail("AGENTMO_PERSISTABILITY_INVALID_OUTPUT_ADAPTER");
    }
  }
  const candidate = fields.candidate.value;
  const formatter = fields.format.value;
  const json = fields.json.value;
  const sink = fields.sink.value;
  const options = outputEmitterOptions(fields.options);
  const { clone, limits } = validatePersistable(candidate, options);
  if (typeof formatter !== "function" || typeof json !== "boolean" || typeof sink !== "function") {
    fail("AGENTMO_PERSISTABILITY_INVALID_OUTPUT_ADAPTER");
  }
  const formatted = await formatter(clone, Object.freeze({ json }));
  if (typeof formatted !== "string") fail("AGENTMO_PERSISTABILITY_UNSUPPORTED_VALUE");
  assertFinalText(formatted, limits.maxBytes, { rejectRawLanguage: !json });
  const parsed = parseFormattedJson(formatted);
  validatePersistable(parsed.ok ? parsed.value : formatted, options);
  if (json) {
    const canonical = `${JSON.stringify(clone, null, 2)}\n`;
    if (!parsed.ok || formatted !== canonical) fail("AGENTMO_PERSISTABILITY_OUTPUT_MISMATCH");
  }
  return sink(formatted);
}

function outputEmitterOptions(descriptor) {
  if (descriptor === undefined) return {};
  if (!isEnumerableDataDescriptor(descriptor)) fail("AGENTMO_PERSISTABILITY_INVALID_OUTPUT_ADAPTER");
  const value = descriptor.value;
  if (value === null || typeof value !== "object" || isProxy(value) || Array.isArray(value)) {
    fail("AGENTMO_PERSISTABILITY_INVALID_OUTPUT_ADAPTER");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("AGENTMO_PERSISTABILITY_INVALID_OUTPUT_ADAPTER");
  }
  const allowedKeys = new Set(["subject", "maxDepth", "maxNodes", "maxBytes"]);
  const copy = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowedKeys.has(key)) fail("AGENTMO_PERSISTABILITY_INVALID_OUTPUT_ADAPTER");
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!isEnumerableDataDescriptor(field)) fail("AGENTMO_PERSISTABILITY_INVALID_OUTPUT_ADAPTER");
    copy[key] = field.value;
  }
  return copy;
}

function validatePersistable(value, options) {
  const limits = normalizeLimits(options);
  const subject = options?.subject ?? "artifact";
  if (typeof subject !== "string"
    || !SAFE_SUBJECT_PATTERN.test(subject)
    || !isSafeString(subject, { rejectRawLanguage: true })) {
    fail("AGENTMO_PERSISTABILITY_INVALID_SUBJECT");
  }
  const state = {
    active: new WeakSet(),
    limits,
    nodes: 0,
  };
  const clone = visit(value, null, 0, state, { allowPolicyLanguage: false });
  if (measureJsonBytes(clone, limits.maxBytes) > limits.maxBytes) {
    fail("AGENTMO_PERSISTABILITY_RESOURCE_BUDGET");
  }
  const audit = auditEvidence(clone);
  if (!audit.ok) fail("AGENTMO_PERSISTABILITY_SENSITIVE_MATERIAL");
  return { clone, limits };
}

function visit(value, key, depth, state, context) {
  state.nodes += 1;
  if (depth > state.limits.maxDepth || state.nodes > state.limits.maxNodes) {
    fail("AGENTMO_PERSISTABILITY_RESOURCE_BUDGET");
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (!isSafeString(value, {
      rejectRawLanguage: !context.allowPolicyLanguage,
      key,
    })) fail("AGENTMO_PERSISTABILITY_SENSITIVE_MATERIAL");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("AGENTMO_PERSISTABILITY_UNSUPPORTED_VALUE");
    return value;
  }
  if (typeof value !== "object" || isProxy(value)) {
    fail("AGENTMO_PERSISTABILITY_UNSUPPORTED_VALUE");
  }
  if (state.active.has(value)) fail("AGENTMO_PERSISTABILITY_CYCLE");

  const kind = ownDataValue(value, "kind");
  if (CARRIER_KINDS.has(kind) && !isExactCarrier(value, kind)) {
    fail("AGENTMO_PERSISTABILITY_INVALID_CARRIER");
  }

  state.active.add(value);
  try {
    if (Array.isArray(value)) return visitArray(value, depth, state, context);
    return visitObject(value, depth, state, context);
  } finally {
    state.active.delete(value);
  }
}

function visitArray(value, depth, state, context) {
  if (Object.getOwnPropertySymbols(value).length > 0) {
    fail("AGENTMO_PERSISTABILITY_UNSUPPORTED_VALUE");
  }
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    fail("AGENTMO_PERSISTABILITY_HOSTILE_OBJECT");
  }
  if (value.length > state.limits.maxNodes - state.nodes) {
    fail("AGENTMO_PERSISTABILITY_RESOURCE_BUDGET");
  }
  const keys = Reflect.ownKeys(value);
  const expectedKeys = new Set(["length", ...Array.from({ length: value.length }, (_, index) => String(index))]);
  if (keys.some((item) => typeof item !== "string" || !expectedKeys.has(item)) || keys.length !== expectedKeys.size) {
    fail("AGENTMO_PERSISTABILITY_UNSUPPORTED_VALUE");
  }
  const clone = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!isEnumerableDataDescriptor(descriptor)) fail("AGENTMO_PERSISTABILITY_ACCESSOR");
    clone.push(visit(descriptor.value, String(index), depth + 1, state, context));
  }
  return clone;
}

function visitObject(value, depth, state, context) {
  const prototype = Object.getPrototypeOf(value);
  if (Object.getOwnPropertySymbols(value).length > 0) {
    fail("AGENTMO_PERSISTABILITY_UNSUPPORTED_VALUE");
  }
  if (prototype !== Object.prototype && prototype !== null) {
    fail("AGENTMO_PERSISTABILITY_HOSTILE_OBJECT");
  }
  const clone = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") fail("AGENTMO_PERSISTABILITY_UNSUPPORTED_VALUE");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!isEnumerableDataDescriptor(descriptor)) fail("AGENTMO_PERSISTABILITY_ACCESSOR");
    if (HOSTILE_KEYS.has(key)) fail("AGENTMO_PERSISTABILITY_HOSTILE_OBJECT");
    assertSafeEntry(key, descriptor.value);
    const childContext = {
      allowPolicyLanguage: context.allowPolicyLanguage || POLICY_LANGUAGE_KEYS.has(normalizeEvidenceFieldName(key)),
    };
    clone[key] = visit(descriptor.value, key, depth + 1, state, childContext);
  }
  return clone;
}

function assertSafeEntry(key, value) {
  const normalizedKey = normalizeEvidenceFieldName(key);
  if (isRawStoredFlagField(key)) {
    if (value !== false) fail("AGENTMO_PERSISTABILITY_SENSITIVE_MATERIAL");
    return;
  }
  if (isSecretSafetyFlagKey(key)
    || normalizedKey === "valuespersisted"
    || normalizedKey === "fullpathpersisted") {
    if (value !== false) fail("AGENTMO_PERSISTABILITY_SENSITIVE_MATERIAL");
    return;
  }
  if (isPersistabilityRawContentField(key)) {
    if (normalizedKey === "prompt" && isDeclarativePromptContract(value)) return;
    if ((normalizedKey === "stdout" || normalizedKey === "stderr") && value !== null && typeof value === "object") {
      if (!isRedactedSummary(value)) fail("AGENTMO_PERSISTABILITY_SENSITIVE_MATERIAL");
      return;
    }
    if (hasStoredContent(value)) fail("AGENTMO_PERSISTABILITY_SENSITIVE_MATERIAL");
  }
  if (containsSecretLikeKey(key)) {
    if (isSecretSafetyFlagKey(key) && value === false) return;
    if (!isSecretCarrierContainer(value)) fail("AGENTMO_PERSISTABILITY_SENSITIVE_MATERIAL");
  }
  if (SUBJECT_POINTER_KEYS.has(normalizedKey) && typeof value === "string" && !isSafeSubjectPointer(value)) {
    fail("AGENTMO_PERSISTABILITY_SENSITIVE_MATERIAL");
  }
  if (typeof value === "string" && isRawMaterialKind(key, value)) {
    fail("AGENTMO_PERSISTABILITY_SENSITIVE_MATERIAL");
  }
}

// A build contract may describe prompt-file topology without storing prompt
// bodies. Keep this lane deliberately narrow: exact relative markdown paths,
// bounded construction metadata, and no prompt text.
function isDeclarativePromptContract(value) {
  const fields = exactDataFields(value, [
    "profile",
    "bootstrapFiles",
    "precedence",
    "staticSections",
    "dynamicSections",
    "budgets",
    "sourceDigests",
    "secretPolicy",
  ]);
  if (fields === null
    || fields.profile !== "openclaw-workspace-bootstrap"
    || !Array.isArray(fields.bootstrapFiles)
    || fields.bootstrapFiles.length === 0
    || fields.bootstrapFiles.length > 32
    || !Array.isArray(fields.precedence)
    || fields.precedence.length === 0
    || fields.precedence.length > 32) return false;
  const safeName = /^[A-Z][A-Z0-9_-]{0,63}\.md$/u;
  const safePath = /^openclaw\/workspace\/[A-Z][A-Z0-9_-]{0,63}\.md$/u;
  for (const entry of fields.bootstrapFiles) {
    const entryFields = exactDataFields(entry, [
      "path",
      "purpose",
      "required",
      "owner",
      "authority",
      "maxChars",
      "contentSourceRefs",
      "digest",
      "secretAllowed",
    ]);
    if (entryFields === null
      || typeof entryFields.path !== "string"
      || !safePath.test(entryFields.path)
      || typeof entryFields.purpose !== "string"
      || typeof entryFields.required !== "boolean"
      || typeof entryFields.owner !== "string"
      || typeof entryFields.authority !== "string"
      || !Number.isSafeInteger(entryFields.maxChars)
      || entryFields.maxChars < 1
      || !Array.isArray(entryFields.contentSourceRefs)
      || entryFields.contentSourceRefs.length !== 0
      || entryFields.digest !== null
      || entryFields.secretAllowed !== false) return false;
  }
  return fields.precedence.every((name) => typeof name === "string" && safeName.test(name))
    && Array.isArray(fields.staticSections)
    && fields.staticSections.length > 0
    && fields.staticSections.every((name) => typeof name === "string")
    && Array.isArray(fields.dynamicSections)
    && fields.dynamicSections.length > 0
    && fields.dynamicSections.every((name) => typeof name === "string")
    && exactDataFields(fields.budgets, [
      "maximumBootstrapFiles",
      "maximumStaticChars",
      "maximumDynamicChars",
      "overflow",
    ]) !== null
    && Array.isArray(fields.sourceDigests)
    && fields.sourceDigests.length === 0
    && Array.isArray(fields.secretPolicy)
    && fields.secretPolicy.length === 0;
}

function isSafeSubjectPointer(value) {
  return isSafeString(value, { rejectRawLanguage: true })
    && !/(?:^|[.$/:[\]-])(?:raw[\s_.-]*)?(?:prompt|transcript|tool[\s_.-]*(?:body|output)|stdout|stderr)(?:$|[.$/:[\]-])/iu.test(value);
}

function isSafeString(value, options = {}) {
  if (value === REDACTED_SECRET || value === REDACTED_PATH) return true;
  if (containsSecretLikeValue(value) || containsHostAbsolutePath(value)) return false;
  if (options.key && isRawMaterialKind(options.key, value)) return false;
  return options.rejectRawLanguage !== true || !RAW_MATERIAL_TEXT_PATTERN.test(value);
}

function isSecretCarrierContainer(value) {
  if (isSecretRef(value) || isSecretPresence(value)) return true;
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  if (Object.getOwnPropertySymbols(value).length > 0 || value.length > MAX_SECRET_NAMES) return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!isEnumerableDataDescriptor(descriptor) || (!isSecretRef(descriptor.value) && !isSecretPresence(descriptor.value))) return false;
  }
  return true;
}

function isExactCarrier(value, kind) {
  if (kind === "SecretRef") return isSecretRef(value);
  if (kind === "SecretPresence") return isSecretPresence(value);
  return isRedactedSummary(value);
}

function exactDataFields(value, expectedKeys) {
  if (value === null || typeof value !== "object" || isProxy(value) || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string") || ownKeys.length !== expectedKeys.length) return null;
  if (expectedKeys.some((key) => !ownKeys.includes(key))) return null;
  const fields = {};
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!isEnumerableDataDescriptor(descriptor)) return null;
    fields[key] = descriptor.value;
  }
  return fields;
}

function isSortedUniqueSecretNameArray(value) {
  if (!Array.isArray(value) || isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  if (value.length > MAX_SECRET_NAMES || Object.getOwnPropertySymbols(value).length > 0) return false;
  let previous = null;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!isEnumerableDataDescriptor(descriptor) || !isSecretName(descriptor.value)) return false;
    if (previous !== null && previous.localeCompare(descriptor.value) >= 0) return false;
    previous = descriptor.value;
  }
  const expectedKeys = new Set(["length", ...Array.from({ length: value.length }, (_, index) => String(index))]);
  return Reflect.ownKeys(value).every((key) => typeof key === "string" && expectedKeys.has(key));
}

function isSecretName(value) {
  return typeof value === "string" && SECRET_NAME_PATTERN.test(value);
}

function isBoundedNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= DEFAULT_MAX_BYTES;
}

function isEnumerableDataDescriptor(descriptor) {
  return descriptor !== undefined && descriptor.enumerable === true && Object.hasOwn(descriptor, "value");
}

function ownDataValue(value, key) {
  if (value === null || typeof value !== "object" || isProxy(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
}

function hasStoredContent(value) {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (value !== null && typeof value === "object") {
    if (isProxy(value)) return true;
    return Reflect.ownKeys(value).length > 0;
  }
  return value === true;
}

function normalizeLimits(options) {
  return {
    maxDepth: normalizeLimit(options?.maxDepth, DEFAULT_MAX_DEPTH),
    maxNodes: normalizeLimit(options?.maxNodes, DEFAULT_MAX_NODES),
    maxBytes: normalizeLimit(options?.maxBytes, DEFAULT_MAX_BYTES),
  };
}

function normalizeLimit(value, hardMaximum) {
  if (value === undefined) return hardMaximum;
  if (!Number.isSafeInteger(value) || value < 1 || value > hardMaximum) {
    fail("AGENTMO_PERSISTABILITY_INVALID_OPTIONS");
  }
  return value;
}

function assertFinalText(text, maxBytes, options) {
  if (typeof text !== "string") fail("AGENTMO_PERSISTABILITY_UNSUPPORTED_VALUE");
  if (Buffer.byteLength(text) > maxBytes) fail("AGENTMO_PERSISTABILITY_RESOURCE_BUDGET");
  if (!isSafeString(text, options)) fail("AGENTMO_PERSISTABILITY_SENSITIVE_MATERIAL");
}

function parseFormattedJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, value: null };
  }
}

function maskPortableProductReferences(text) {
  return text
    .replace(/(^|[\s"'`(])(?:\.\.?[\\/])+(?:[^\s"'`<>),\]}]+)?/gmu, "$1[MANAGED_RELATIVE_REFERENCE]")
    .replace(/<[^>\r\n]+>[\\/][^\s"'`<>),\]}]*/gu, "[MANAGED_RELATIVE_REFERENCE]");
}

function measureJsonBytes(value, maxBytes) {
  let bytes = 0;
  function add(text) {
    bytes += Buffer.byteLength(text);
    if (bytes > maxBytes) fail("AGENTMO_PERSISTABILITY_RESOURCE_BUDGET");
  }
  function measure(item) {
    if (item === null) {
      add("null");
      return;
    }
    if (typeof item === "string") {
      bytes += jsonStringByteLength(item);
      if (bytes > maxBytes) fail("AGENTMO_PERSISTABILITY_RESOURCE_BUDGET");
      return;
    }
    if (typeof item === "number") {
      add(Object.is(item, -0) ? "0" : String(item));
      return;
    }
    if (typeof item === "boolean") {
      add(item ? "true" : "false");
      return;
    }
    if (Array.isArray(item)) {
      add("[");
      for (let index = 0; index < item.length; index += 1) {
        if (index > 0) add(",");
        measure(item[index]);
      }
      add("]");
      return;
    }
    add("{");
    const entries = Object.entries(item);
    for (const [index, [key, child]] of entries.entries()) {
      if (index > 0) add(",");
      bytes += jsonStringByteLength(key);
      if (bytes > maxBytes) fail("AGENTMO_PERSISTABILITY_RESOURCE_BUDGET");
      add(":");
      measure(child);
    }
    add("}");
  }
  measure(value);
  return bytes;
}

function jsonStringByteLength(value) {
  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c || [0x08, 0x09, 0x0a, 0x0c, 0x0d].includes(code)) {
      bytes += 2;
    } else if (code <= 0x1f) {
      bytes += 6;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 6;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes += 6;
    } else if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

async function writeValidatedTextAtomic(filePath, text, options) {
  const io = options?.io ?? DEFAULT_IO;
  if (typeof filePath !== "string" || filePath.length === 0 || filePath.includes("\0")) {
    fail("AGENTMO_PERSISTABILITY_INVALID_OUTPUT_PATH");
  }
  if (typeof io?.mkdir !== "function" || typeof io?.writeFile !== "function" || typeof io?.rename !== "function") {
    fail("AGENTMO_PERSISTABILITY_INVALID_OUTPUT_ADAPTER");
  }
  const temporaryFile = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await io.mkdir(path.dirname(filePath), { recursive: true });
  await io.writeFile(temporaryFile, text, "utf8");
  await io.rename(temporaryFile, filePath);
  return filePath;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fail(code) {
  throw new PersistabilityError(code);
}
