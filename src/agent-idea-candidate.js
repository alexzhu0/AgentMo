export const AGENT_IDEA_CANDIDATE_SCHEMA_VERSION = "agentmo.agent-idea-candidate.v1";
export const AGENT_IDEA_CANDIDATE_SUBJECT = "agent-idea-candidate";

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
const IDEA_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const EXTRACTION_FIELD_WARNING = "evidenceIds cite extraction_field planning leads; they do not prove user need, value, capability, domain quality, or Plan readiness.";

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
    errors.push("Agent Idea Candidate must contain only the canonical Candidate fields.");
  }
  if (candidate.schemaVersion !== AGENT_IDEA_CANDIDATE_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${AGENT_IDEA_CANDIDATE_SCHEMA_VERSION}.`);
  }
  if (typeof candidate.ideaId !== "string" || !IDEA_ID_PATTERN.test(candidate.ideaId)) {
    errors.push("ideaId must be a lowercase bounded identifier.");
  }
  validateString(candidate.title, "title", 512, errors);
  validateStringArray(candidate.targetUsers, "targetUsers", { min: 1, max: 64, itemMax: 1024 }, errors);
  validateStringArray(candidate.candidateTasks, "candidateTasks", { min: 1, max: 64, itemMax: 2048 }, errors);
  validateString(candidate.valueHypothesis, "valueHypothesis", 4096, errors);
  validateSource(candidate.source, errors);
  validateStringArray(candidate.evidenceIds, "evidenceIds", { min: 1, max: 256, itemMax: 256 }, errors);
  if (Array.isArray(candidate.evidenceIds)
    && !isByteSortedUnique(candidate.evidenceIds)) {
    errors.push("evidenceIds must be sorted and unique.");
  }
  validateStringArray(candidate.evidenceGaps, "evidenceGaps", { min: 0, max: 64, itemMax: 2048 }, errors);
  validateStringArray(candidate.judgmentBoundaries, "judgmentBoundaries", { min: 1, max: 64, itemMax: 2048 }, errors);
  validateCertificationBoundary(candidate.certificationBoundary, errors);

  if (context !== undefined) {
    const resolved = resolveEvidence(candidate, context, errors);
    if (resolved.some((fact) => fact.kind === "extraction_field")) {
      warnings.push(EXTRACTION_FIELD_WARNING);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function summarizeAgentIdeaCandidate(candidate, context) {
  const facts = context === undefined
    ? []
    : resolveEvidence(candidate, context, []);
  return {
    schemaVersion: plainObject(candidate) ? candidate.schemaVersion : undefined,
    ideaId: plainObject(candidate) ? candidate.ideaId : undefined,
    targetUserCount: countStrings(candidate?.targetUsers),
    candidateTaskCount: countStrings(candidate?.candidateTasks),
    evidenceCount: countStrings(candidate?.evidenceIds),
    evidenceGapCount: countStrings(candidate?.evidenceGaps),
    judgmentBoundaryCount: countStrings(candidate?.judgmentBoundaries),
    evidenceKinds: countValues(facts.map((fact) => fact.kind)),
    trustLevels: countValues(facts.map((fact) => fact.trustLevel)),
    certificationBoundary: { ...AGENT_IDEA_CANDIDATE_CERTIFICATION_BOUNDARY },
  };
}

export function buildAgentIdeaCandidateReport(candidate, context) {
  const validation = validateAgentIdeaCandidate(candidate, context);
  return {
    kind: "agentmo_agent_idea_candidate_report",
    version: "0.1",
    ok: validation.ok,
    summary: summarizeAgentIdeaCandidate(candidate, context),
    warnings: validation.warnings,
    errors: validation.errors,
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
    errors.push(`${field} must be a non-empty string.`);
    return;
  }
  if (value.length > maxLength) errors.push(`${field} must be at most ${maxLength} characters.`);
}

function validateStringArray(value, field, limits, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array.`);
    return;
  }
  if (value.length < limits.min) errors.push(`${field} must contain at least ${limits.min} item.`);
  if (value.length > limits.max) errors.push(`${field} must contain at most ${limits.max} items.`);
  for (const [index, item] of value.entries()) {
    validateString(item, `${field}[${index}]`, limits.itemMax, errors);
  }
}

function validateSource(value, errors) {
  if (!plainObject(value) || !hasExactKeys(value, SOURCE_KEYS)) {
    errors.push("source must contain only discoveryDb provenance.");
    return;
  }
  const provenance = value.discoveryDb;
  if (!plainObject(provenance) || !hasExactKeys(provenance, PROVENANCE_KEYS)) {
    errors.push("source.discoveryDb must contain exact identity, subject, and digest provenance.");
    return;
  }
  if (provenance.identity !== "agentmo.discovery-db.v1") {
    errors.push("source.discoveryDb.identity must be agentmo.discovery-db.v1.");
  }
  if (provenance.subject !== "discovery-db") {
    errors.push("source.discoveryDb.subject must be discovery-db.");
  }
  if (!SHA256_DIGEST_PATTERN.test(provenance.digest ?? "")) {
    errors.push("source.discoveryDb.digest must be an exact sha256 digest.");
  }
}

function validateCertificationBoundary(value, errors) {
  const keys = Object.keys(AGENT_IDEA_CANDIDATE_CERTIFICATION_BOUNDARY);
  if (!plainObject(value) || !hasExactKeys(value, keys)) {
    errors.push("certificationBoundary must contain only the canonical proposal boundary fields.");
    return;
  }
  for (const [key, expected] of Object.entries(AGENT_IDEA_CANDIDATE_CERTIFICATION_BOUNDARY)) {
    if (value[key] !== expected) {
      errors.push(`certificationBoundary.${key} must be ${String(expected)}.`);
    }
  }
}

function resolveEvidence(candidate, context, errors) {
  if (!plainObject(context)
    || !plainObject(context.source)
    || !plainObject(context.discoveryDb)
    || !Array.isArray(context.discoveryDb.facts)) {
    errors.push("Candidate validation requires the exact admitted Discovery DB context.");
    return [];
  }
  const provenance = candidate?.source?.discoveryDb;
  if (!sameProvenance(provenance, context.source)) {
    errors.push("source.discoveryDb does not match the exact admitted Discovery DB.");
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
      errors.push(`evidenceIds[${index}] must resolve to exactly one Discovery DB fact.`);
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
  return value.every((item, index) => (
    index === 0
      || (typeof item === "string"
        && typeof value[index - 1] === "string"
        && Buffer.from(value[index - 1]).compare(Buffer.from(item)) < 0)
  ));
}

function countStrings(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.trim().length > 0).length
    : 0;
}

function countValues(values) {
  const counts = {};
  for (const value of values.filter((item) => typeof item === "string" && item.length > 0).sort()) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function formatCounts(value) {
  if (!plainObject(value)) return "none";
  const entries = Object.entries(value);
  return entries.length === 0
    ? "none"
    : entries.map(([key, count]) => `${key}=${count}`).join(", ");
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
