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

export function validateAgentIdeaCandidate(candidate, context) {
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

  if (context !== undefined && errors.length === 0) {
    const beforeContextErrors = errors.length;
    const resolved = resolveEvidence(candidate, context, errors);
    if (errors.length === beforeContextErrors
      && resolved.some((fact) => fact.kind === "extraction_field")) {
      warnings.push(EXTRACTION_FIELD_WARNING);
    }
  }

  return { ok: errors.length === 0, errors: errors.slice(0, AGENT_IDEA_CANDIDATE_MAX_ERRORS), warnings };
}

export function summarizeAgentIdeaCandidate(candidate, context) {
  const shapeValidation = validateAgentIdeaCandidate(candidate);
  const shapeValid = shapeValidation.ok;
  const contextValid = context === undefined
    ? true
    : validateAgentIdeaCandidate(candidate, context).ok;
  const facts = shapeValid && context !== undefined && contextValid
    ? resolveEvidence(candidate, context, [])
    : [];
  return {
    schemaVersion: shapeValid ? candidate.schemaVersion : null,
    ideaId: shapeValid ? candidate.ideaId : null,
    targetUserCount: shapeValid ? countStrings(candidate.targetUsers) : 0,
    candidateTaskCount: shapeValid ? countStrings(candidate.candidateTasks) : 0,
    evidenceCount: shapeValid ? countStrings(candidate.evidenceIds) : 0,
    evidenceGapCount: shapeValid ? countStrings(candidate.evidenceGaps) : 0,
    judgmentBoundaryCount: shapeValid ? countStrings(candidate.judgmentBoundaries) : 0,
    evidenceKinds: countValues(facts.map((fact) => (
      REPORTED_EVIDENCE_KINDS.has(fact.kind) ? fact.kind : "other"
    ))),
    trustLevels: countValues(facts.map((fact) => (
      REPORTED_TRUST_LEVELS.has(fact.trustLevel) ? fact.trustLevel : "unknown"
    ))),
    certificationBoundary: { ...AGENT_IDEA_CANDIDATE_CERTIFICATION_BOUNDARY },
  };
}

export function buildAgentIdeaCandidateReport(candidate, context) {
  const validation = validateAgentIdeaCandidate(candidate, context);
  const errors = context === undefined
    ? boundedErrors([...validation.errors, "Candidate reporting requires the exact admitted Discovery DB context."])
    : validation.errors;
  return {
    kind: "agentmo_agent_idea_candidate_report",
    version: "0.1",
    ok: errors.length === 0,
    summary: summarizeAgentIdeaCandidate(candidate, context),
    warnings: validation.warnings,
    errors,
  };
}

export function formatAgentIdeaCandidateReport(report) {
  const summary = plainObject(report?.summary) ? report.summary : {};
  const lines = [
    `AgentMo Agent Idea Candidate: ${summary.ideaId ?? "unknown"}`,
    `Status: ${report?.ok === true ? "pass" : "fail"}`,
    `Target users: ${summary.targetUserCount ?? 0}`,
    `Candidate tasks: ${summary.candidateTaskCount ?? 0}`,
    `Evidence IDs: ${summary.evidenceCount ?? 0}`,
    `Evidence gaps: ${summary.evidenceGapCount ?? 0}`,
    `Judgment boundaries: ${summary.judgmentBoundaryCount ?? 0}`,
    `Evidence kinds: ${formatCounts(summary.evidenceKinds)}`,
    `Trust levels: ${formatCounts(summary.trustLevels)}`,
    "Plan authority: none",
  ];
  if (Array.isArray(report?.warnings) && report.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const warning of report.warnings) lines.push(`- ${warning}`);
  }
  if (Array.isArray(report?.errors) && report.errors.length > 0) {
    lines.push("", "Errors:");
    for (const error of report.errors) lines.push(`- ${error}`);
  }
  return `${lines.join("\n")}\n`;
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
