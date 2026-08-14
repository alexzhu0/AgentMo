import { isProxy } from "node:util/types";

export const AGENT_IDEA_CANDIDATE_SCHEMA_VERSION = "agentmo.agent-idea-candidate.v1";
export const AGENT_IDEA_CANDIDATE_SUBJECT = "agent-idea-candidate";
export const AGENT_IDEA_CANDIDATE_MAX_ERRORS = 32;
export const AGENT_IDEA_CANDIDATE_ID_PATTERN_SOURCE = "^[a-z0-9][a-z0-9._:-]{0,127}$";
export const AGENT_IDEA_CANDIDATE_TEXT_PATTERN_SOURCE = "^(?=[\\s\\S]*\\S)(?:[^\\u0000\\uD800-\\uDFFF]|[\\uD800-\\uDBFF][\\uDC00-\\uDFFF])+$";

export const AGENT_IDEA_CANDIDATE_LIMITS = deepFreeze({
  title: { maxLength: 512 },
  targetUsers: { minItems: 1, maxItems: 64, itemMaxLength: 1024 },
  candidateTasks: { minItems: 1, maxItems: 64, itemMaxLength: 2048 },
  valueHypothesis: { maxLength: 4096 },
  evidenceIds: { minItems: 1, maxItems: 256, itemMaxLength: 256 },
  evidenceGaps: { minItems: 0, maxItems: 64, itemMaxLength: 2048 },
  judgmentBoundaries: { minItems: 1, maxItems: 64, itemMaxLength: 2048 },
});

export const AGENT_IDEA_CANDIDATE_CERTIFICATION_BOUNDARY = Object.freeze({
  proposalOnly: true,
  userNeedProven: false,
  valueProven: false,
  agentCapabilityProven: false,
  domainQualityProven: false,
  planReady: false,
  productionReady: false,
  enterPlanAuthorized: false,
  buildAuthorized: false,
  runtimeAuthorized: false,
});

const CANDIDATE_KEYS = Object.freeze([
  "schemaVersion",
  "ideaId",
  "title",
  "targetUsers",
  "candidateTasks",
  "valueHypothesis",
  "source",
  "evidenceIds",
  "evidenceGaps",
  "judgmentBoundaries",
  "certificationBoundary",
]);
const SOURCE_KEYS = Object.freeze(["discoveryDb"]);
const PROVENANCE_KEYS = Object.freeze(["identity", "subject", "digest"]);
const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const IDEA_ID_PATTERN = new RegExp(AGENT_IDEA_CANDIDATE_ID_PATTERN_SOURCE, "u");
const EXTRACTION_FIELD_WARNING = "evidenceIds cite extraction_field planning leads; they do not prove user need, value, capability, domain quality, or Plan readiness.";
const REPORTED_EVIDENCE_KINDS = new Set(["extraction_field", "source_chunk"]);
const REPORTED_TRUST_LEVELS = new Set(["verified", "trusted", "derived", "unverified", "unknown"]);
const PUBLIC_SNAPSHOT_MAX_DEPTH = 64;
const PUBLIC_SNAPSHOT_MAX_NODES = 20_000;
const CANDIDATE_SCHEMA_MAX_STRING_CODE_UNITS = 16_384 + (2 * (
  128
  + AGENT_IDEA_CANDIDATE_LIMITS.title.maxLength
  + (AGENT_IDEA_CANDIDATE_LIMITS.targetUsers.maxItems
    * AGENT_IDEA_CANDIDATE_LIMITS.targetUsers.itemMaxLength)
  + (AGENT_IDEA_CANDIDATE_LIMITS.candidateTasks.maxItems
    * AGENT_IDEA_CANDIDATE_LIMITS.candidateTasks.itemMaxLength)
  + AGENT_IDEA_CANDIDATE_LIMITS.valueHypothesis.maxLength
  + (AGENT_IDEA_CANDIDATE_LIMITS.evidenceIds.maxItems
    * AGENT_IDEA_CANDIDATE_LIMITS.evidenceIds.itemMaxLength)
  + (AGENT_IDEA_CANDIDATE_LIMITS.evidenceGaps.maxItems
    * AGENT_IDEA_CANDIDATE_LIMITS.evidenceGaps.itemMaxLength)
  + (AGENT_IDEA_CANDIDATE_LIMITS.judgmentBoundaries.maxItems
    * AGENT_IDEA_CANDIDATE_LIMITS.judgmentBoundaries.itemMaxLength)
));
const DISCOVERY_CONTEXT_MAX_STRING_CODE_UNITS = 1_100_000;
const HOSTILE_INPUT_ERROR = "Agent Idea Candidate must contain only own JSON data properties.";
const STRING_BUDGET_ERROR = "Agent Idea Candidate exceeds the bounded public string budget.";
const UNRECOGNIZED_REPORT_ERROR = "Candidate report contained an unrecognized diagnostic.";
const TRUSTED_REPORT_RENDER_STATES = new WeakMap();

class CandidateStringBudgetError extends TypeError {}

export function validateAgentIdeaCandidate(candidate, context) {
  const captured = captureCandidateInputs(candidate, context);
  if (!captured.ok) return invalidCandidateValidation(captured.stringBudgetExceeded);
  return validateCandidateSnapshot(captured.candidate, captured.context, context !== undefined);
}

function validateCandidateSnapshot(candidate, context, contextProvided) {
  const errors = [];
  const warnings = [];
  if (!plainObject(candidate)) {
    return {
      ok: false,
      errors: ["Agent Idea Candidate must be a JSON object."],
      warnings,
    };
  }
  if (!hasExactKeys(candidate, CANDIDATE_KEYS)) {
    addError(errors, "Agent Idea Candidate must contain only the canonical Candidate fields.");
  }
  if (candidate.schemaVersion !== AGENT_IDEA_CANDIDATE_SCHEMA_VERSION) {
    addError(errors, `schemaVersion must be ${AGENT_IDEA_CANDIDATE_SCHEMA_VERSION}.`);
  }
  if (typeof candidate.ideaId !== "string"
    || candidate.ideaId.length > 128
    || !IDEA_ID_PATTERN.test(candidate.ideaId)) {
    addError(errors, "ideaId must be a lowercase bounded identifier.");
  }
  validateString(candidate.title, "title", AGENT_IDEA_CANDIDATE_LIMITS.title.maxLength, errors);
  validateStringArray(candidate.targetUsers, "targetUsers", AGENT_IDEA_CANDIDATE_LIMITS.targetUsers, errors);
  validateStringArray(candidate.candidateTasks, "candidateTasks", AGENT_IDEA_CANDIDATE_LIMITS.candidateTasks, errors);
  validateString(candidate.valueHypothesis, "valueHypothesis", AGENT_IDEA_CANDIDATE_LIMITS.valueHypothesis.maxLength, errors);
  validateSource(candidate.source, errors);
  const evidenceIdsValid = validateStringArray(
    candidate.evidenceIds,
    "evidenceIds",
    AGENT_IDEA_CANDIDATE_LIMITS.evidenceIds,
    errors,
  );
  if (evidenceIdsValid
    && !isByteSortedUnique(candidate.evidenceIds)) {
    addError(errors, "evidenceIds must be sorted and unique.");
  }
  validateStringArray(candidate.evidenceGaps, "evidenceGaps", AGENT_IDEA_CANDIDATE_LIMITS.evidenceGaps, errors);
  validateStringArray(candidate.judgmentBoundaries, "judgmentBoundaries", AGENT_IDEA_CANDIDATE_LIMITS.judgmentBoundaries, errors);
  validateCertificationBoundary(candidate.certificationBoundary, errors);

  if (contextProvided && errors.length === 0) {
    const beforeContextErrors = errors.length;
    const resolved = resolveEvidence(candidate, context, errors);
    let citesExtractionField = false;
    for (let index = 0; index < resolved.length; index += 1) {
      if (resolved[index].kind === "extraction_field") {
        citesExtractionField = true;
        break;
      }
    }
    if (errors.length === beforeContextErrors && citesExtractionField) {
      appendArray(warnings, EXTRACTION_FIELD_WARNING);
    }
  }

  return { ok: errors.length === 0, errors: boundedErrors(errors), warnings };
}

export function summarizeAgentIdeaCandidate(candidate, context) {
  const captured = captureCandidateInputs(candidate, context);
  if (!captured.ok) return emptyCandidateSummary();
  return summarizeCandidateSnapshot(captured.candidate, captured.context, context !== undefined);
}

function summarizeCandidateSnapshot(candidate, context, contextProvided) {
  const shapeValidation = validateCandidateSnapshot(candidate, undefined, false);
  const shapeValid = shapeValidation.ok;
  const contextValid = !contextProvided
    ? true
    : validateCandidateSnapshot(candidate, context, true).ok;
  const facts = shapeValid && contextProvided && contextValid
    ? resolveEvidence(candidate, context, [])
    : [];
  const evidenceKinds = [];
  const trustLevels = [];
  for (let index = 0; index < facts.length; index += 1) {
    const fact = facts[index];
    evidenceKinds[index] = REPORTED_EVIDENCE_KINDS.has(fact.kind) ? fact.kind : "other";
    trustLevels[index] = REPORTED_TRUST_LEVELS.has(fact.trustLevel) ? fact.trustLevel : "unknown";
  }
  return {
    schemaVersion: shapeValid ? candidate.schemaVersion : null,
    ideaId: shapeValid ? candidate.ideaId : null,
    targetUserCount: shapeValid ? countStrings(candidate.targetUsers) : 0,
    candidateTaskCount: shapeValid ? countStrings(candidate.candidateTasks) : 0,
    evidenceCount: shapeValid ? countStrings(candidate.evidenceIds) : 0,
    evidenceGapCount: shapeValid ? countStrings(candidate.evidenceGaps) : 0,
    judgmentBoundaryCount: shapeValid ? countStrings(candidate.judgmentBoundaries) : 0,
    evidenceKinds: countValues(evidenceKinds),
    trustLevels: countValues(trustLevels),
    certificationBoundary: { ...AGENT_IDEA_CANDIDATE_CERTIFICATION_BOUNDARY },
  };
}

export function buildAgentIdeaCandidateReport(candidate, context) {
  const captured = captureCandidateInputs(candidate, context);
  const validation = captured.ok
    ? validateCandidateSnapshot(captured.candidate, captured.context, context !== undefined)
    : invalidCandidateValidation(captured.stringBudgetExceeded);
  const errors = boundedErrors(validation.errors);
  if (context === undefined) {
    addError(errors, "Candidate reporting requires the exact admitted Discovery DB context.");
  }
  const report = {
    kind: "agentmo_agent_idea_candidate_report",
    version: "0.1",
    ok: errors.length === 0,
    summary: captured.ok
      ? summarizeCandidateSnapshot(captured.candidate, captured.context, context !== undefined)
      : emptyCandidateSummary(),
    warnings: validation.warnings,
    errors,
  };
  TRUSTED_REPORT_RENDER_STATES.set(report, copyTrustedReportRenderState(report));
  return report;
}

export function formatAgentIdeaCandidateReport(report) {
  const normalized = TRUSTED_REPORT_RENDER_STATES.get(report) ?? invalidNormalizedReport();
  const summary = normalized.summary;
  const lines = [
    `AgentMo Agent Idea Candidate: ${summary.ideaId ?? "unknown"}`,
    `Status: ${normalized.ok ? "pass" : "fail"}`,
    `Target users: ${summary.targetUserCount}`,
    `Candidate tasks: ${summary.candidateTaskCount}`,
    `Evidence IDs: ${summary.evidenceCount}`,
    `Evidence gaps: ${summary.evidenceGapCount}`,
    `Judgment boundaries: ${summary.judgmentBoundaryCount}`,
    `Evidence kinds: ${formatCounts(summary.evidenceKinds)}`,
    `Trust levels: ${formatCounts(summary.trustLevels)}`,
    "Plan authority: none",
  ];
  if (normalized.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (let index = 0; index < normalized.warnings.length; index += 1) {
      lines.push(`- ${normalized.warnings[index]}`);
    }
  }
  if (normalized.errors.length > 0) {
    lines.push("", "Errors:");
    for (let index = 0; index < normalized.errors.length; index += 1) {
      lines.push(`- ${normalized.errors[index]}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function captureCandidateInputs(candidate, context) {
  try {
    const candidateState = snapshotState(CANDIDATE_SCHEMA_MAX_STRING_CODE_UNITS);
    const contextState = snapshotState(DISCOVERY_CONTEXT_MAX_STRING_CODE_UNITS);
    return {
      ok: true,
      candidate: snapshotOwnJsonData(candidate, 0, candidateState),
      context: context === undefined ? undefined : snapshotOwnJsonData(context, 0, contextState),
    };
  } catch (error) {
    return {
      ok: false,
      candidate: null,
      context: undefined,
      stringBudgetExceeded: error instanceof CandidateStringBudgetError,
    };
  }
}

function snapshotState(maxStringCodeUnits) {
  return {
    active: new WeakSet(),
    nodes: 0,
    stringCodeUnits: 0,
    maxStringCodeUnits,
  };
}

function snapshotOwnJsonData(value, depth, state) {
  state.nodes += 1;
  if (depth > PUBLIC_SNAPSHOT_MAX_DEPTH || state.nodes > PUBLIC_SNAPSHOT_MAX_NODES) {
    throw new TypeError("bounded_candidate_snapshot_required");
  }
  if (typeof value === "string") {
    consumeStringBudget(value, state);
    return value;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || isProxy(value)) {
    throw new TypeError("own_candidate_data_required");
  }
  if (state.active.has(value)) throw new TypeError("acyclic_candidate_data_required");

  state.active.add(value);
  try {
    if (Array.isArray(value)) return snapshotArray(value, depth, state);
    return snapshotObject(value, depth, state);
  } finally {
    state.active.delete(value);
  }
}

function snapshotArray(value, depth, state) {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError("ordinary_candidate_array_required");
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  const length = lengthDescriptor?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > PUBLIC_SNAPSHOT_MAX_NODES - state.nodes) {
    throw new TypeError("bounded_candidate_array_required");
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1) throw new TypeError("dense_candidate_array_required");
  const copy = new Array(length);
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!enumerableDataDescriptor(descriptor)) throw new TypeError("own_candidate_data_required");
    defineArrayIndex(copy, index, snapshotOwnJsonData(descriptor.value, depth + 1, state));
  }
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key !== "length" && (typeof key !== "string" || !canonicalArrayIndex(key, length))) {
      throw new TypeError("canonical_candidate_array_required");
    }
  }
  return copy;
}

function snapshotObject(value, depth, state) {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("ordinary_candidate_object_required");
  }
  const copy = Object.create(null);
  const keys = Reflect.ownKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (typeof key !== "string") throw new TypeError("string_candidate_key_required");
    consumeStringBudget(key, state);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!enumerableDataDescriptor(descriptor)) throw new TypeError("own_candidate_data_required");
    copy[key] = snapshotOwnJsonData(descriptor.value, depth + 1, state);
  }
  return copy;
}

function consumeStringBudget(value, state) {
  state.stringCodeUnits += value.length;
  if (state.stringCodeUnits > state.maxStringCodeUnits) {
    throw new CandidateStringBudgetError("bounded_candidate_string_budget_required");
  }
}

function defineArrayIndex(value, index, item) {
  Object.defineProperty(value, String(index), {
    configurable: true,
    enumerable: true,
    writable: true,
    value: item,
  });
}

function canonicalArrayIndex(key, length) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(key)) return false;
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === key;
}

function enumerableDataDescriptor(descriptor) {
  return descriptor !== undefined
    && descriptor.enumerable === true
    && Object.hasOwn(descriptor, "value");
}

function invalidCandidateValidation(stringBudgetExceeded = false) {
  return {
    ok: false,
    errors: [stringBudgetExceeded ? STRING_BUDGET_ERROR : HOSTILE_INPUT_ERROR],
    warnings: [],
  };
}

function emptyCandidateSummary() {
  return {
    schemaVersion: null,
    ideaId: null,
    targetUserCount: 0,
    candidateTaskCount: 0,
    evidenceCount: 0,
    evidenceGapCount: 0,
    judgmentBoundaryCount: 0,
    evidenceKinds: {},
    trustLevels: {},
    certificationBoundary: { ...AGENT_IDEA_CANDIDATE_CERTIFICATION_BOUNDARY },
  };
}

function copyTrustedReportRenderState(report) {
  const summary = report.summary;
  return {
    ok: report.errors.length === 0,
    summary: {
      schemaVersion: summary.schemaVersion,
      ideaId: summary.ideaId,
      targetUserCount: summary.targetUserCount,
      candidateTaskCount: summary.candidateTaskCount,
      evidenceCount: summary.evidenceCount,
      evidenceGapCount: summary.evidenceGapCount,
      judgmentBoundaryCount: summary.judgmentBoundaryCount,
      evidenceKinds: copyCountMap(summary.evidenceKinds),
      trustLevels: copyCountMap(summary.trustLevels),
      certificationBoundary: { ...AGENT_IDEA_CANDIDATE_CERTIFICATION_BOUNDARY },
    },
    warnings: boundedErrors(report.warnings),
    errors: boundedErrors(report.errors),
  };
}

function copyCountMap(value) {
  const copy = Object.create(null);
  const keys = Object.keys(value);
  for (let index = 0; index < keys.length; index += 1) {
    copy[keys[index]] = value[keys[index]];
  }
  return copy;
}

function invalidNormalizedReport() {
  return {
    ok: false,
    summary: emptyCandidateSummary(),
    warnings: [],
    errors: [UNRECOGNIZED_REPORT_ERROR],
  };
}

function validateString(value, field, maxLength, errors) {
  if (typeof value !== "string") {
    addError(errors, `${field} must be a non-empty string.`);
    return false;
  }
  if (value.length > maxLength * 2) {
    addError(errors, `${field} must be at most ${maxLength} characters.`);
    return false;
  }
  if (value.trim().length === 0 || value.includes("\0")) {
    addError(errors, `${field} must be a non-empty string.`);
    return false;
  }
  const inspection = inspectBoundedCodePoints(value, maxLength);
  if (inspection.invalidUnicodeScalar) {
    addError(errors, `${field} must not contain an invalid Unicode scalar value.`);
    return false;
  }
  if (inspection.tooLong) {
    addError(errors, `${field} must be at most ${maxLength} characters.`);
    return false;
  }
  return true;
}

function validateStringArray(value, field, limits, errors) {
  if (!Array.isArray(value)) {
    addError(errors, `${field} must be an array.`);
    return false;
  }
  let valid = true;
  if (value.length < limits.minItems) {
    addError(errors, `${field} must contain at least ${limits.minItems} item.`);
    valid = false;
  }
  if (value.length > limits.maxItems) {
    addError(errors, `${field} must contain at most ${limits.maxItems} items.`);
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!validateString(value[index], `${field}[${index}]`, limits.itemMaxLength, errors)) {
      valid = false;
    }
  }
  return valid;
}

function validateSource(value, errors) {
  if (!plainObject(value) || !hasExactKeys(value, SOURCE_KEYS)) {
    addError(errors, "source must contain only discoveryDb provenance.");
    return;
  }
  const provenance = value.discoveryDb;
  if (!plainObject(provenance) || !hasExactKeys(provenance, PROVENANCE_KEYS)) {
    addError(errors, "source.discoveryDb must contain exact identity, subject, and digest provenance.");
    return;
  }
  if (provenance.identity !== "agentmo.discovery-db.v1") {
    addError(errors, "source.discoveryDb.identity must be agentmo.discovery-db.v1.");
  }
  if (provenance.subject !== "discovery-db") {
    addError(errors, "source.discoveryDb.subject must be discovery-db.");
  }
  if (!SHA256_DIGEST_PATTERN.test(provenance.digest ?? "")) {
    addError(errors, "source.discoveryDb.digest must be an exact sha256 digest.");
  }
}

function validateCertificationBoundary(value, errors) {
  const keys = Object.keys(AGENT_IDEA_CANDIDATE_CERTIFICATION_BOUNDARY);
  if (!plainObject(value) || !hasExactKeys(value, keys)) {
    addError(errors, "certificationBoundary must contain only the canonical proposal boundary fields.");
    return;
  }
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    const expected = AGENT_IDEA_CANDIDATE_CERTIFICATION_BOUNDARY[key];
    if (value[key] !== expected) {
      addError(errors, `certificationBoundary.${key} must be ${String(expected)}.`);
    }
  }
}

function resolveEvidence(candidate, context, errors) {
  if (!plainObject(context)
    || !plainObject(context.source)
    || !plainObject(context.discoveryDb)
    || !Array.isArray(context.discoveryDb.facts)) {
    addError(errors, "Candidate validation requires the exact admitted Discovery DB context.");
    return [];
  }
  const provenance = candidate?.source?.discoveryDb;
  if (!sameProvenance(provenance, context.source)) {
    addError(errors, "source.discoveryDb does not match the exact admitted Discovery DB.");
  }
  const factsById = new Map();
  for (let index = 0; index < context.discoveryDb.facts.length; index += 1) {
    const fact = context.discoveryDb.facts[index];
    if (!plainObject(fact) || typeof fact.id !== "string") continue;
    const existing = factsById.get(fact.id) ?? [];
    appendArray(existing, fact);
    factsById.set(fact.id, existing);
  }
  const resolved = [];
  if (!Array.isArray(candidate?.evidenceIds)) return resolved;
  for (let index = 0; index < candidate.evidenceIds.length; index += 1) {
    const evidenceId = candidate.evidenceIds[index];
    const matches = factsById.get(evidenceId) ?? [];
    if (matches.length !== 1) {
      addError(errors, `evidenceIds[${index}] must resolve to exactly one Discovery DB fact.`);
      continue;
    }
    appendArray(resolved, matches[0]);
  }
  return resolved;
}

function sameProvenance(left, right) {
  return plainObject(left)
    && plainObject(right)
    && left.identity === right.identity
    && left.subject === right.subject
    && left.digest === right.digest;
}

function isByteSortedUnique(value) {
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (typeof item !== "string" || hasUnpairedSurrogate(item)) return false;
    if (index > 0) {
      const previous = value[index - 1];
      if (typeof previous !== "string"
        || Buffer.from(previous).compare(Buffer.from(item)) >= 0) return false;
    }
  }
  return true;
}

function inspectBoundedCodePoints(value, maximum) {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return { invalidUnicodeScalar: true, tooLong: false };
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return { invalidUnicodeScalar: true, tooLong: false };
    }
    count += 1;
    if (count > maximum) return { invalidUnicodeScalar: false, tooLong: true };
  }
  return { invalidUnicodeScalar: false, tooLong: false };
}

function hasUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function countStrings(value) {
  if (!Array.isArray(value)) return 0;
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (typeof item === "string" && item.trim().length > 0) count += 1;
  }
  return count;
}

function countValues(values) {
  const counts = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (typeof value === "string" && value.length > 0) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  const keys = [...counts.keys()];
  for (let right = 1; right < keys.length; right += 1) {
    let left = right;
    while (left > 0 && keys[left - 1] > keys[left]) {
      const previous = keys[left - 1];
      keys[left - 1] = keys[left];
      keys[left] = previous;
      left -= 1;
    }
  }
  const result = {};
  for (let index = 0; index < keys.length; index += 1) {
    result[keys[index]] = counts.get(keys[index]);
  }
  return result;
}

function formatCounts(value) {
  if (!plainObject(value)) return "none";
  const keys = Object.keys(value);
  if (keys.length === 0) return "none";
  let formatted = "";
  for (let index = 0; index < keys.length; index += 1) {
    if (index > 0) formatted += ", ";
    formatted += `${keys[index]}=${value[keys[index]]}`;
  }
  return formatted;
}

function addError(errors, message) {
  if (errors.length < AGENT_IDEA_CANDIDATE_MAX_ERRORS) appendArray(errors, message);
}

function boundedErrors(errors) {
  const copy = [];
  const length = Math.min(errors.length, AGENT_IDEA_CANDIDATE_MAX_ERRORS);
  for (let index = 0; index < length; index += 1) appendArray(copy, errors[index]);
  return copy;
}

function hasExactKeys(value, expected) {
  const keys = Object.keys(value);
  if (keys.length !== expected.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    if (!Object.hasOwn(value, expected[index])) return false;
  }
  return true;
}

function appendArray(value, item) {
  defineArrayIndex(value, value.length, item);
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
