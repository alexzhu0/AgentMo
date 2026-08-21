import {
  appendImmutableJournalEntry,
  loadImmutableJournal,
  readImmutableJournalAdmissionBytes,
} from "./builder-immutable-journal.js";
import {
  PersistabilityError,
  serializePersistableJson,
} from "./persistability.js";

export const DECISION_LEDGER_SCHEMA_VERSION = "agentmo.decision-ledger.v1";
export const DECISION_ENTRY_SCHEMA_VERSION = "agentmo.decision-entry.v1";
export const DECISION_ENTRY_KINDS = Object.freeze([
  "fact",
  "inference",
  "unknown",
  "rejected-option",
  "human-decision",
]);

const ENTRY_KINDS = new Set(DECISION_ENTRY_KINDS);
const ENTRY_INPUT_KEYS = Object.freeze([
  "entryId",
  "entryKind",
  "subject",
  "reason",
  "sourceRefs",
  "decisionRefs",
  "requirementRefs",
]);
const DURABLE_ENTRY_KEYS = Object.freeze([
  "schemaVersion",
  "sequence",
  "predecessorDigest",
  ...ENTRY_INPUT_KEYS,
]);
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const MAX_LEDGER_ENTRIES = 256;
export const DECISION_ENTRY_MAX_BYTES = 64 * 1024;
const MAX_SUBJECT_LENGTH = 512;
const MAX_REASON_LENGTH = 4096;
const MAX_REFS = 128;
const ENTRY_REFERENCE_FIELDS = Object.freeze([
  "sourceRefs",
  "decisionRefs",
  "requirementRefs",
]);
const LEDGER_ADMISSIONS = new WeakMap();

export class DecisionLedgerError extends Error {
  constructor(code) {
    super("Decision ledger operation was rejected.");
    this.name = "DecisionLedgerError";
    this.code = code;
  }
}

export async function appendDecisionEntry(options) {
  if (!isPlainObject(options)
    || !hasOnlyKeys(options, ["journalPath", "expectedHeadDigest", "entry"])
    || typeof options.journalPath !== "string"
    || options.journalPath.length === 0) {
    fail("AGENTMO_DECISION_LEDGER_INVALID");
  }

  const current = await loadDecisionLedger({ journalPath: options.journalPath });
  const expectedHeadDigest = options.expectedHeadDigest;
  if (current.head === null) {
    if (expectedHeadDigest !== undefined && expectedHeadDigest !== null) {
      fail("AGENTMO_DECISION_LEDGER_STALE_HEAD");
    }
  } else if (!DIGEST_PATTERN.test(expectedHeadDigest ?? "")
    || expectedHeadDigest !== current.head.digest) {
    fail("AGENTMO_DECISION_LEDGER_STALE_HEAD");
  }

  const normalizedInput = normalizeEntryInput(options.entry);
  const knownIds = new Set(current.entries.map((entry) => entry.entryId));
  if (knownIds.has(normalizedInput.entryId)) {
    fail("AGENTMO_DECISION_LEDGER_DUPLICATE_ENTRY");
  }
  if (normalizedInput.decisionRefs.some((reference) => !knownIds.has(reference))) {
    fail("AGENTMO_DECISION_LEDGER_DANGLING_DECISION_REF");
  }

  const durableEntry = deepFreeze({
    schemaVersion: DECISION_LEDGER_SCHEMA_VERSION,
    sequence: current.entries.length,
    predecessorDigest: current.head?.digest ?? null,
    ...normalizedInput,
  });
  const canonicalBytes = Buffer.from(serializeLedgerEntry(durableEntry), "utf8");
  let outcome;
  try {
    outcome = await appendImmutableJournalEntry({
      journalPath: options.journalPath,
      canonicalBytes,
      ...(current.head === null
        ? {}
        : { expectedPredecessorAdmission: LEDGER_ADMISSIONS.get(current).head }),
      maxEntries: MAX_LEDGER_ENTRIES,
      maxValueBytes: DECISION_ENTRY_MAX_BYTES,
    });
  } catch (error) {
    if (error?.code === "AGENTMO_IMMUTABLE_JOURNAL_CONFLICT_REJECTED") {
      fail("AGENTMO_DECISION_LEDGER_STALE_HEAD");
    }
    throw error;
  }
  if (outcome.committed !== true) fail("AGENTMO_DECISION_LEDGER_STALE_HEAD");

  const ledger = await loadDecisionLedger({
    journalPath: options.journalPath,
    expectedHeadDigest: outcome.head.digest,
  });
  return deepFreeze({
    schemaVersion: DECISION_LEDGER_SCHEMA_VERSION,
    status: outcome.status,
    committed: true,
    recoveryRequired: ledger.recoveryRequired,
    head: ledger.head,
  });
}

export async function loadDecisionLedger(options) {
  if (!isPlainObject(options)
    || !hasOnlyKeys(options, ["journalPath", "expectedHeadDigest"])
    || typeof options.journalPath !== "string"
    || options.journalPath.length === 0) {
    fail("AGENTMO_DECISION_LEDGER_INVALID");
  }
  const expectedHeadDigest = options.expectedHeadDigest;
  if (expectedHeadDigest !== undefined
    && expectedHeadDigest !== null
    && !DIGEST_PATTERN.test(expectedHeadDigest)) {
    fail("AGENTMO_DECISION_LEDGER_INVALID");
  }

  let journal;
  try {
    journal = await loadImmutableJournal({
      journalPath: options.journalPath,
      maxEntries: MAX_LEDGER_ENTRIES,
      maxValueBytes: DECISION_ENTRY_MAX_BYTES,
    });
  } catch (error) {
    if (error?.code?.startsWith("AGENTMO_IMMUTABLE_JOURNAL_")) {
      fail("AGENTMO_DECISION_LEDGER_LINEAGE_INVALID");
    }
    throw error;
  }

  const entries = [];
  for (const admission of journal.entries) {
    const bytes = readImmutableJournalAdmissionBytes(admission);
    const durableEntry = parseDurableEntry(bytes);
    if (durableEntry.sequence !== admission.sequence
      || durableEntry.predecessorDigest !== admission.predecessorDigest) {
      fail("AGENTMO_DECISION_LEDGER_LINEAGE_INVALID");
    }
    entries.push(deepFreeze({
      ...durableEntry,
      valueDigest: admission.digest,
    }));
  }
  validateLineage(entries);

  const headEntry = entries.at(-1) ?? null;
  const head = headEntry === null
    ? null
    : deepFreeze({
        identity: DECISION_LEDGER_SCHEMA_VERSION,
        subject: "decision-ledger",
        digest: headEntry.valueDigest,
        sequence: headEntry.sequence,
        predecessorDigest: headEntry.predecessorDigest,
        entryId: headEntry.entryId,
      });
  if (expectedHeadDigest !== undefined && expectedHeadDigest !== null
    && head?.digest !== expectedHeadDigest) {
    fail("AGENTMO_DECISION_LEDGER_STALE_HEAD");
  }

  const ledger = deepFreeze({
    schemaVersion: DECISION_LEDGER_SCHEMA_VERSION,
    entries,
    head,
    recoveryRequired: journal.recoveryRequired,
  });
  const validation = validateDecisionLedger(ledger);
  if (!validation.ok) fail("AGENTMO_DECISION_LEDGER_LINEAGE_INVALID");
  LEDGER_ADMISSIONS.set(ledger, Object.freeze({ head: journal.head }));
  return ledger;
}

export function validateDecisionLedger(ledger) {
  const errors = [];
  if (!isPlainObject(ledger)
    || !hasExactKeys(ledger, ["schemaVersion", "entries", "head", "recoveryRequired"])) {
    return { ok: false, errors: ["ledger must use the closed decision-ledger shape"] };
  }
  if (ledger.schemaVersion !== DECISION_LEDGER_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${DECISION_LEDGER_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(ledger.entries) || ledger.entries.length > MAX_LEDGER_ENTRIES) {
    errors.push("entries must be a bounded array");
  } else {
    try {
      validateLineage(ledger.entries);
    } catch {
      errors.push("entries must form one closed predecessor-bound lineage");
    }
  }
  if (typeof ledger.recoveryRequired !== "boolean") {
    errors.push("recoveryRequired must be a boolean");
  }
  const expectedHead = Array.isArray(ledger.entries) ? ledger.entries.at(-1) ?? null : null;
  if (expectedHead === null) {
    if (ledger.head !== null) errors.push("empty ledger head must be null");
  } else if (!isPlainObject(ledger.head)
    || !hasExactKeys(ledger.head, [
      "identity",
      "subject",
      "digest",
      "sequence",
      "predecessorDigest",
      "entryId",
    ])
    || ledger.head.identity !== DECISION_LEDGER_SCHEMA_VERSION
    || ledger.head.subject !== "decision-ledger"
    || ledger.head.digest !== expectedHead.valueDigest
    || ledger.head.sequence !== expectedHead.sequence
    || ledger.head.predecessorDigest !== expectedHead.predecessorDigest
    || ledger.head.entryId !== expectedHead.entryId) {
    errors.push("head must exactly identify the final durable entry");
  }
  return { ok: errors.length === 0, errors };
}

export function validateDecisionEntry(value) {
  const errors = diagnoseDecisionEntry(value);
  return { ok: errors.length === 0, errors };
}

export function diagnoseDecisionEntry(value, options = {}) {
  const requireCanonicalRefs = options?.requireCanonicalRefs !== false;
  if (!isPlainObject(value)
    || !hasExactKeys(value, ["schemaVersion", ...ENTRY_INPUT_KEYS])
    || value.schemaVersion !== DECISION_ENTRY_SCHEMA_VERSION) {
    return ["decision entry must use the closed typed entry shape."];
  }

  const errors = [];
  if (!SAFE_ID_PATTERN.test(value.entryId ?? "")) {
    errors.push("entryId must be a bounded safe identifier.");
  }
  if (!ENTRY_KINDS.has(value.entryKind)) {
    errors.push("entryKind must be one of the closed decision kinds.");
  }
  if (!isBoundedText(value.subject, MAX_SUBJECT_LENGTH)) {
    errors.push("subject must be bounded non-empty text.");
  }
  if (!isBoundedText(value.reason, MAX_REASON_LENGTH)) {
    errors.push("reason must be bounded non-empty text.");
  }
  for (const field of ENTRY_REFERENCE_FIELDS) {
    if (!isSafeRefArray(value[field])) {
      errors.push(`${field} must be a bounded array of safe identifiers.`);
    } else if (requireCanonicalRefs && !isCanonicalRefArray(value[field])) {
      errors.push(`${field} must be a strictly ascending unique array of safe identifiers.`);
    } else if (!requireCanonicalRefs && !isUniqueRefArray(value[field])) {
      errors.push(`${field} must be a unique array of safe identifiers.`);
    }
  }
  if (errors.length > 0) return errors;

  try {
    if (requireCanonicalRefs) {
      normalizeEntryInput(Object.fromEntries(ENTRY_INPUT_KEYS.map((key) => [key, value[key]])));
    } else {
      normalizeEntryDraftInput(Object.fromEntries(ENTRY_INPUT_KEYS.map((key) => [key, value[key]])));
    }
    return [];
  } catch {
    return ["decision entry contains invalid or prohibited material."];
  }
}

// This is an authoring boundary only. It produces a new canonical candidate
// before its digest exists; append and durable admission remain strict readers.
export function canonicalizeDecisionEntryDraft(value) {
  const errors = diagnoseDecisionEntry(value, { requireCanonicalRefs: false });
  if (errors.length > 0) fail("AGENTMO_DECISION_LEDGER_INVALID_ENTRY");
  const normalized = normalizeEntryDraftInput(Object.fromEntries(
    ENTRY_INPUT_KEYS.map((key) => [key, value[key]]),
  ));
  return deepFreeze({
    schemaVersion: DECISION_ENTRY_SCHEMA_VERSION,
    ...normalized,
  });
}

export function validateDurableDecisionLedgerEntry(value) {
  try {
    if (!isPlainObject(value)
      || !hasExactKeys(value, DURABLE_ENTRY_KEYS)
      || value.schemaVersion !== DECISION_LEDGER_SCHEMA_VERSION
      || !Number.isSafeInteger(value.sequence)
      || value.sequence < 0
      || (value.predecessorDigest !== null && !DIGEST_PATTERN.test(value.predecessorDigest))) {
      return false;
    }
    normalizeEntryInput(Object.fromEntries(ENTRY_INPUT_KEYS.map((key) => [key, value[key]])));
    return true;
  } catch {
    return false;
  }
}

export function admittedDecisionLedgerProvenance(ledger) {
  if (!LEDGER_ADMISSIONS.has(ledger)
    || !validateDecisionLedger(ledger).ok
    || ledger.head === null) {
    fail("AGENTMO_DECISION_LEDGER_AUTHORITY_REJECTED");
  }
  return deepFreeze({
    identity: DECISION_LEDGER_SCHEMA_VERSION,
    subject: "decision-ledger",
    digest: ledger.head.digest,
  });
}

function normalizeEntryInput(value) {
  return normalizeEntryInputWithReferences(value, (references) => {
    if (!isCanonicalRefArray(references)) {
      fail("AGENTMO_DECISION_LEDGER_INVALID_ENTRY");
    }
    return [...references];
  });
}

function normalizeEntryDraftInput(value) {
  return normalizeEntryInputWithReferences(value, (references) => {
    if (!isUniqueRefArray(references)) {
      fail("AGENTMO_DECISION_LEDGER_INVALID_ENTRY");
    }
    return [...references].sort(compareCanonicalReference);
  });
}

function normalizeEntryInputWithReferences(value, normalizeReferences) {
  if (!isPlainObject(value) || !hasExactKeys(value, ENTRY_INPUT_KEYS)) {
    fail("AGENTMO_DECISION_LEDGER_INVALID_ENTRY");
  }
  if (!SAFE_ID_PATTERN.test(value.entryId ?? "")
    || !ENTRY_KINDS.has(value.entryKind)
    || !isBoundedText(value.subject, MAX_SUBJECT_LENGTH)
    || !isBoundedText(value.reason, MAX_REASON_LENGTH)) {
    fail("AGENTMO_DECISION_LEDGER_INVALID_ENTRY");
  }
  const candidate = {
    entryId: value.entryId,
    entryKind: value.entryKind,
    subject: value.subject,
    reason: value.reason,
    sourceRefs: normalizeReferences(value.sourceRefs),
    decisionRefs: normalizeReferences(value.decisionRefs),
    requirementRefs: normalizeReferences(value.requirementRefs),
  };
  try {
    serializePersistableJson(candidate, {
      subject: "decision-ledger",
      maxBytes: DECISION_ENTRY_MAX_BYTES,
    });
  } catch (error) {
    if (error instanceof PersistabilityError) {
      fail("AGENTMO_DECISION_LEDGER_PROHIBITED_MATERIAL");
    }
    throw error;
  }
  return deepFreeze(candidate);
}

function parseDurableEntry(bytes) {
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail("AGENTMO_DECISION_LEDGER_LINEAGE_INVALID");
  }
  if (!isPlainObject(value)
    || !hasExactKeys(value, DURABLE_ENTRY_KEYS)
    || value.schemaVersion !== DECISION_LEDGER_SCHEMA_VERSION
    || !Number.isSafeInteger(value.sequence)
    || value.sequence < 0
    || (value.predecessorDigest !== null && !DIGEST_PATTERN.test(value.predecessorDigest))) {
    fail("AGENTMO_DECISION_LEDGER_LINEAGE_INVALID");
  }
  const normalized = normalizeEntryInput(Object.fromEntries(
    ENTRY_INPUT_KEYS.map((key) => [key, value[key]]),
  ));
  const durable = {
    schemaVersion: DECISION_LEDGER_SCHEMA_VERSION,
    sequence: value.sequence,
    predecessorDigest: value.predecessorDigest,
    ...normalized,
  };
  if (!bytes.equals(Buffer.from(serializeLedgerEntry(durable), "utf8"))) {
    fail("AGENTMO_DECISION_LEDGER_LINEAGE_INVALID");
  }
  return durable;
}

function validateLineage(entries) {
  const ids = new Set();
  let predecessorDigest = null;
  for (const [index, entry] of entries.entries()) {
    if (!isPlainObject(entry)
      || !hasExactKeys(entry, [...DURABLE_ENTRY_KEYS, "valueDigest"])
      || entry.schemaVersion !== DECISION_LEDGER_SCHEMA_VERSION
      || entry.sequence !== index
      || entry.predecessorDigest !== predecessorDigest
      || !DIGEST_PATTERN.test(entry.valueDigest ?? "")) {
      fail("AGENTMO_DECISION_LEDGER_LINEAGE_INVALID");
    }
    normalizeEntryInput(Object.fromEntries(ENTRY_INPUT_KEYS.map((key) => [key, entry[key]])));
    if (ids.has(entry.entryId)
      || entry.decisionRefs.some((reference) => !ids.has(reference))) {
      fail("AGENTMO_DECISION_LEDGER_LINEAGE_INVALID");
    }
    ids.add(entry.entryId);
    predecessorDigest = entry.valueDigest;
  }
}

function serializeLedgerEntry(entry) {
  try {
    return serializePersistableJson(entry, {
      subject: "decision-ledger",
      maxBytes: DECISION_ENTRY_MAX_BYTES,
    });
  } catch (error) {
    if (error instanceof PersistabilityError) {
      fail("AGENTMO_DECISION_LEDGER_PROHIBITED_MATERIAL");
    }
    throw error;
  }
}

function isCanonicalRefArray(value) {
  return isSafeRefArray(value)
    && value.every((item, index) => index === 0
      || compareCanonicalReference(value[index - 1], item) < 0);
}

function isUniqueRefArray(value) {
  return isSafeRefArray(value) && new Set(value).size === value.length;
}

function isSafeRefArray(value) {
  return Array.isArray(value)
    && value.length <= MAX_REFS
    && value.every((item) => typeof item === "string" && SAFE_ID_PATTERN.test(item));
}

function compareCanonicalReference(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function isBoundedText(value, maxLength) {
  return typeof value === "string"
    && value.length > 0
    && Array.from(value).length <= maxLength
    && !value.includes("\0");
}

function hasOnlyKeys(value, keys) {
  const allowed = new Set(keys);
  return Reflect.ownKeys(value).every((key) => typeof key === "string" && allowed.has(key));
}

function hasExactKeys(value, keys) {
  return Reflect.ownKeys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function fail(code) {
  throw new DecisionLedgerError(code);
}
