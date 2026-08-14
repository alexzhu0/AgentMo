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
const REPORT_KEYS = Object.freeze(["kind", "version", "ok", "summary", "warnings", "errors"]);
const SUMMARY_KEYS = Object.freeze([
  "schemaVersion",
  "ideaId",
  "targetUserCount",
  "candidateTaskCount",
  "evidenceCount",
  "evidenceGapCount",
  "judgmentBoundaryCount",
  "evidenceKinds",
  "trustLevels",
  "certificationBoundary",
]);
const PUBLIC_SNAPSHOT_MAX_DEPTH = 64;
const PUBLIC_SNAPSHOT_MAX_NODES = 20_000;
const HOSTILE_INPUT_ERROR = "Agent Idea Candidate must contain only own JSON data properties.";
const UNRECOGNIZED_REPORT_ERROR = "Candidate report contained an unrecognized diagnostic.";

export function validateAgentIdeaCandidate(candidate, context) {
  const captured = captureCandidateInputs(candidate, context);
  if (!captured.ok) return invalidCandidateValidation();
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
  if (typeof candidate.ideaId !== "string" || !IDEA_ID_PATTERN.test(candidate.ideaId)) {
    addError(errors, "ideaId must be a lowercase bounded identifier.");
  }
  validateString(candidate.title, "title", AGENT_IDEA_CANDIDATE_LIMITS.title.maxLength, errors);
  validateStringArray(candidate.targetUsers, "targetUsers", AGENT_IDEA_CANDIDATE_LIMITS.targetUsers, errors);
  validateStringArray(candidate.candidateTasks, "candidateTasks", AGENT_IDEA_CANDIDATE_LIMITS.candidateTasks, errors);
  validateString(candidate.valueHypothesis, "valueHypothesis", AGENT_IDEA_CANDIDATE_LIMITS.valueHypothesis.maxLength, errors);
  validateSource(candidate.source, errors);
  validateStringArray(candidate.evidenceIds, "evidenceIds", AGENT_IDEA_CANDIDATE_LIMITS.evidenceIds, errors);
  if (Array.isArray(candidate.evidenceIds)
    && candidate.evidenceIds.length <= AGENT_IDEA_CANDIDATE_LIMITS.evidenceIds.maxItems
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
      warnings.push(EXTRACTION_FIELD_WARNING);
    }
  }

  return { ok: errors.length === 0, errors: errors.slice(0, AGENT_IDEA_CANDIDATE_MAX_ERRORS), warnings };
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
    : invalidCandidateValidation();
  const errors = context === undefined
    ? boundedErrors([...validation.errors, "Candidate reporting requires the exact admitted Discovery DB context."])
    : validation.errors;
  return {
    kind: "agentmo_agent_idea_candidate_report",
    version: "0.1",
    ok: errors.length === 0,
    summary: captured.ok
      ? summarizeCandidateSnapshot(captured.candidate, captured.context, context !== undefined)
      : emptyCandidateSummary(),
    warnings: validation.warnings,
    errors,
  };
}

export function formatAgentIdeaCandidateReport(report) {
  const normalized = normalizeAgentIdeaCandidateReport(report);
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
    const state = { active: new WeakSet(), nodes: 0 };
    return {
      ok: true,
      candidate: snapshotOwnJsonData(candidate, 0, state),
      context: context === undefined ? undefined : snapshotOwnJsonData(context, 0, state),
    };
  } catch {
    return { ok: false, candidate: null, context: undefined };
  }
}

function snapshotOwnJsonData(value, depth, state) {
  state.nodes += 1;
  if (depth > PUBLIC_SNAPSHOT_MAX_DEPTH || state.nodes > PUBLIC_SNAPSHOT_MAX_NODES) {
    throw new TypeError("bounded_candidate_snapshot_required");
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
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
    copy[index] = snapshotOwnJsonData(descriptor.value, depth + 1, state);
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
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!enumerableDataDescriptor(descriptor)) throw new TypeError("own_candidate_data_required");
    copy[key] = snapshotOwnJsonData(descriptor.value, depth + 1, state);
  }
  return copy;
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

function invalidCandidateValidation() {
  return { ok: false, errors: [HOSTILE_INPUT_ERROR], warnings: [] };
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

function normalizeAgentIdeaCandidateReport(report) {
  let captured;
  try {
    captured = snapshotOwnJsonData(report, 0, { active: new WeakSet(), nodes: 0 });
  } catch {
    return invalidNormalizedReport();
  }
  if (!plainObject(captured) || !hasExactKeys(captured, REPORT_KEYS)) {
    return invalidNormalizedReport();
  }
  const normalizedSummary = normalizeReportSummary(captured.summary);
  const diagnostics = normalizeReportDiagnostics(captured.errors, captured.warnings);
  const shapeOk = captured.kind === "agentmo_agent_idea_candidate_report"
    && captured.version === "0.1"
    && typeof captured.ok === "boolean"
    && normalizedSummary.ok
    && diagnostics.ok
    && (captured.ok ? diagnostics.errors.length === 0 : diagnostics.errors.length > 0);
  if (!shapeOk) return invalidNormalizedReport();
  return {
    ok: captured.ok,
    summary: normalizedSummary.value,
    warnings: diagnostics.warnings,
    errors: diagnostics.errors,
  };
}

function normalizeReportSummary(summary) {
  if (!plainObject(summary) || !hasExactKeys(summary, SUMMARY_KEYS)) return { ok: false };
  const schemaVersion = summary.schemaVersion === AGENT_IDEA_CANDIDATE_SCHEMA_VERSION
    ? summary.schemaVersion
    : summary.schemaVersion === null ? null : undefined;
  const ideaId = typeof summary.ideaId === "string" && IDEA_ID_PATTERN.test(summary.ideaId)
    ? summary.ideaId
    : summary.ideaId === null ? null : undefined;
  const countLimits = [
    ["targetUserCount", AGENT_IDEA_CANDIDATE_LIMITS.targetUsers.maxItems],
    ["candidateTaskCount", AGENT_IDEA_CANDIDATE_LIMITS.candidateTasks.maxItems],
    ["evidenceCount", AGENT_IDEA_CANDIDATE_LIMITS.evidenceIds.maxItems],
    ["evidenceGapCount", AGENT_IDEA_CANDIDATE_LIMITS.evidenceGaps.maxItems],
    ["judgmentBoundaryCount", AGENT_IDEA_CANDIDATE_LIMITS.judgmentBoundaries.maxItems],
  ];
  const counts = Object.create(null);
  for (let index = 0; index < countLimits.length; index += 1) {
    const [key, maximum] = countLimits[index];
    if (!boundedCount(summary[key], maximum)) return { ok: false };
    counts[key] = summary[key];
  }
  const evidenceKinds = normalizeCountMap(
    summary.evidenceKinds,
    new Set(["extraction_field", "source_chunk", "other"]),
    counts.evidenceCount,
  );
  const trustLevels = normalizeCountMap(
    summary.trustLevels,
    new Set([...REPORTED_TRUST_LEVELS, "unknown"]),
    counts.evidenceCount,
  );
  if (schemaVersion === undefined
    || ideaId === undefined
    || evidenceKinds === null
    || trustLevels === null
    || !exactCertificationBoundary(summary.certificationBoundary)) {
    return { ok: false };
  }
  return {
    ok: true,
    value: {
      schemaVersion,
      ideaId,
      ...counts,
      evidenceKinds,
      trustLevels,
      certificationBoundary: { ...AGENT_IDEA_CANDIDATE_CERTIFICATION_BOUNDARY },
    },
  };
}

function normalizeCountMap(value, allowedKeys, maximumTotal) {
  if (!plainObject(value)) return null;
  const keys = Object.keys(value);
  const normalized = {};
  let total = 0;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    const count = value[key];
    if (!allowedKeys.has(key) || !Number.isSafeInteger(count) || count <= 0) return null;
    total += count;
    if (total > maximumTotal) return null;
    normalized[key] = count;
  }
  return normalized;
}

function normalizeReportDiagnostics(errorValues, warningValues) {
  if (!Array.isArray(errorValues) || !Array.isArray(warningValues)) {
    return { ok: false, errors: [UNRECOGNIZED_REPORT_ERROR], warnings: [] };
  }
  if (errorValues.length + warningValues.length > AGENT_IDEA_CANDIDATE_MAX_ERRORS) {
    return { ok: false, errors: [UNRECOGNIZED_REPORT_ERROR], warnings: [] };
  }
  const errors = [];
  const warnings = [];
  for (let index = 0; index < errorValues.length; index += 1) {
    if (!knownCandidateDiagnostic(errorValues[index], false)) {
      return { ok: false, errors: [UNRECOGNIZED_REPORT_ERROR], warnings: [] };
    }
    errors[index] = errorValues[index];
  }
  for (let index = 0; index < warningValues.length; index += 1) {
    if (!knownCandidateDiagnostic(warningValues[index], true)) {
      return { ok: false, errors: [UNRECOGNIZED_REPORT_ERROR], warnings: [] };
    }
    warnings[index] = warningValues[index];
  }
  return { ok: true, errors, warnings };
}

function knownCandidateDiagnostic(value, warning) {
  if (warning) return value === EXTRACTION_FIELD_WARNING;
  if (typeof value !== "string" || value.length > 256) return false;
  if (new Set([
    HOSTILE_INPUT_ERROR,
    "Agent Idea Candidate must be a JSON object.",
    "Agent Idea Candidate must contain only the canonical Candidate fields.",
    `schemaVersion must be ${AGENT_IDEA_CANDIDATE_SCHEMA_VERSION}.`,
    "ideaId must be a lowercase bounded identifier.",
    "evidenceIds must be sorted and unique.",
    "source must contain only discoveryDb provenance.",
    "source.discoveryDb must contain exact identity, subject, and digest provenance.",
    "source.discoveryDb.identity must be agentmo.discovery-db.v1.",
    "source.discoveryDb.subject must be discovery-db.",
    "source.discoveryDb.digest must be an exact sha256 digest.",
    "certificationBoundary must contain only the canonical proposal boundary fields.",
    "Candidate validation requires the exact admitted Discovery DB context.",
    "source.discoveryDb does not match the exact admitted Discovery DB.",
    "Candidate reporting requires the exact admitted Discovery DB context.",
  ]).has(value)) return true;
  return /^(?:title|targetUsers(?:\[[0-9]{1,3}\])?|candidateTasks(?:\[[0-9]{1,3}\])?|valueHypothesis|evidenceIds(?:\[[0-9]{1,3}\])?|evidenceGaps(?:\[[0-9]{1,3}\])?|judgmentBoundaries(?:\[[0-9]{1,3}\])?) must (?:be a non-empty string|not contain an invalid Unicode scalar value|be at most (?:256|512|1024|2048|4096) characters|be an array|contain at least [01] item|contain at most (?:64|256) items)\.$/u.test(value)
    || /^certificationBoundary\.(?:proposalOnly|userNeedProven|valueProven|agentCapabilityProven|domainQualityProven|planReady|productionReady|enterPlanAuthorized|buildAuthorized|runtimeAuthorized) must be (?:true|false)\.$/u.test(value)
    || /^evidenceIds\[[0-9]{1,3}\] must resolve to exactly one Discovery DB fact\.$/u.test(value);
}

function invalidNormalizedReport() {
  return {
    ok: false,
    summary: emptyCandidateSummary(),
    warnings: [],
    errors: [UNRECOGNIZED_REPORT_ERROR],
  };
}

function boundedCount(value, maximum) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function exactCertificationBoundary(value) {
  const keys = Object.keys(AGENT_IDEA_CANDIDATE_CERTIFICATION_BOUNDARY);
  if (!plainObject(value) || !hasExactKeys(value, keys)) return false;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (value[key] !== AGENT_IDEA_CANDIDATE_CERTIFICATION_BOUNDARY[key]) return false;
  }
  return true;
}

function validateString(value, field, maxLength, errors) {
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) {
    addError(errors, `${field} must be a non-empty string.`);
    return;
  }
  if (hasUnpairedSurrogate(value)) {
    addError(errors, `${field} must not contain an invalid Unicode scalar value.`);
    return;
  }
  if ([...value].length > maxLength) addError(errors, `${field} must be at most ${maxLength} characters.`);
}

function validateStringArray(value, field, limits, errors) {
  if (!Array.isArray(value)) {
    addError(errors, `${field} must be an array.`);
    return;
  }
  if (value.length < limits.minItems) addError(errors, `${field} must contain at least ${limits.minItems} item.`);
  if (value.length > limits.maxItems) {
    addError(errors, `${field} must contain at most ${limits.maxItems} items.`);
    return;
  }
  for (const [index, item] of value.entries()) {
    if (errors.length >= AGENT_IDEA_CANDIDATE_MAX_ERRORS) break;
    validateString(item, `${field}[${index}]`, limits.itemMaxLength, errors);
  }
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
  for (const [key, expected] of Object.entries(AGENT_IDEA_CANDIDATE_CERTIFICATION_BOUNDARY)) {
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
  for (const fact of context.discoveryDb.facts) {
    if (!plainObject(fact) || typeof fact.id !== "string") continue;
    const existing = factsById.get(fact.id) ?? [];
    existing.push(fact);
    factsById.set(fact.id, existing);
  }
  const resolved = [];
  if (!Array.isArray(candidate?.evidenceIds)) return resolved;
  for (const [index, evidenceId] of candidate.evidenceIds.entries()) {
    const matches = factsById.get(evidenceId) ?? [];
    if (matches.length !== 1) {
      addError(errors, `evidenceIds[${index}] must resolve to exactly one Discovery DB fact.`);
      continue;
    }
    resolved.push(matches[0]);
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
  if (value.some((item) => typeof item !== "string" || hasUnpairedSurrogate(item))) return false;
  return value.every((item, index) => (
    index === 0
      || (typeof item === "string"
        && typeof value[index - 1] === "string"
        && Buffer.from(value[index - 1]).compare(Buffer.from(item)) < 0)
  ));
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
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.trim().length > 0).length
    : 0;
}

function countValues(values) {
  const counts = new Map();
  for (const value of values.filter((item) => typeof item === "string" && item.length > 0).sort()) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Object.fromEntries(counts);
}

function formatCounts(value) {
  if (!plainObject(value)) return "none";
  const entries = Object.entries(value);
  return entries.length === 0
    ? "none"
    : entries.map(([key, count]) => `${key}=${count}`).join(", ");
}

function addError(errors, message) {
  if (errors.length < AGENT_IDEA_CANDIDATE_MAX_ERRORS) errors.push(message);
}

function boundedErrors(errors) {
  return errors.slice(0, AGENT_IDEA_CANDIDATE_MAX_ERRORS);
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
