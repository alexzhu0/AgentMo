export const POC_RESEARCH_SOURCE_REGISTRY_SCHEMA_VERSION = "agentmo.poc-research-sources.v1";
export const POC_RESEARCH_RECORD_SCHEMA_VERSION = "agentmo.poc-research-record.v1";
export const POC_RESEARCH_DB_SCHEMA_VERSION = "agentmo.poc-research-db.v1";

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,127}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ADAPTERS = new Set(["aihot-v1", "github-release", "arxiv-atom", "official-feed"]);
const SOURCE_ROLES = new Set(["first-party", "curated", "community"]);
const TRUST_TIERS = new Set(["primary", "first-party", "community"]);
const DOMAINS = new Set(["ai-capability", "device-software", "white-collar-needs"]);
const SCENARIOS = new Set(["knowledge-documents", "meetings-collaboration", "data-analysis-decision"]);
const FACT_CLASSES = new Set(["fact", "company_statement", "community_signal", "agent_hypothesis"]);
const SECRET_SHAPED = /(?:api[_-]?key|secret|token|password)\s*=/iu;

export function validateResearchSourceRegistry(value) {
  const errors = [];
  if (!isPlainObject(value) || !hasExactKeys(value, ["schemaVersion", "agentId", "sources", "skillCandidates"])
    || value.schemaVersion !== POC_RESEARCH_SOURCE_REGISTRY_SCHEMA_VERSION) {
    return Object.freeze({ ok: false, errors: Object.freeze(["registry must use the closed source-registry shape."]) });
  }
  if (!SAFE_ID.test(value.agentId ?? "")) errors.push("agentId is invalid.");
  if (!Array.isArray(value.sources) || value.sources.length === 0 || value.sources.length > 16) {
    errors.push("sources must be a bounded non-empty list.");
  } else {
    const ids = new Set();
    for (const source of value.sources) validateSource(source, errors, ids);
  }
  if (!Array.isArray(value.skillCandidates) || value.skillCandidates.length > 16) {
    errors.push("skillCandidates must be a bounded list.");
  } else {
    const ids = new Set();
    for (const candidate of value.skillCandidates) validateSkillCandidate(candidate, errors, ids);
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

export function validateResearchRecord(value) {
  const errors = [];
  const keys = ["schemaVersion", "id", "sourceId", "title", "url", "publishedAt", "collectedAt", "sourceRole", "trustTier", "domains", "scenarios", "factClass", "summary", "contentDigest", "evidenceIds"];
  if (!isPlainObject(value) || !hasExactKeys(value, keys) || value.schemaVersion !== POC_RESEARCH_RECORD_SCHEMA_VERSION) {
    return Object.freeze({ ok: false, errors: Object.freeze(["record must use the closed research-record shape."]) });
  }
  if (!SAFE_ID.test(value.id ?? "") || !SAFE_ID.test(value.sourceId ?? "")) errors.push("record identifiers are invalid.");
  for (const field of ["title", "summary"]) {
    if (typeof value[field] !== "string" || value[field].trim().length === 0 || value[field].length > 4_000 || SECRET_SHAPED.test(value[field])) {
      errors.push(`${field} is invalid.`);
    }
  }
  try {
    canonicalResearchUrl(value.url);
  } catch {
    errors.push("url is invalid.");
  }
  for (const field of ["publishedAt", "collectedAt"]) {
    if (typeof value[field] !== "string" || Number.isNaN(Date.parse(value[field]))) errors.push(`${field} is invalid.`);
  }
  if (!SOURCE_ROLES.has(value.sourceRole) || !TRUST_TIERS.has(value.trustTier) || !FACT_CLASSES.has(value.factClass)) errors.push("record labels are invalid.");
  validateBoundedEnumList(value.domains, DOMAINS, "domains", errors);
  validateBoundedEnumList(value.scenarios, SCENARIOS, "scenarios", errors);
  if (!DIGEST.test(value.contentDigest ?? "")) errors.push("contentDigest is invalid.");
  if (!Array.isArray(value.evidenceIds) || value.evidenceIds.length > 8 || value.evidenceIds.some((id) => !SAFE_ID.test(id))) errors.push("evidenceIds are invalid.");
  if (value.factClass === "agent_hypothesis" && value.evidenceIds.length === 0) errors.push("hypotheses require retained evidence.");
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

export function canonicalResearchUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw researchError("AGENTMO_POC_RESEARCH_INPUT_INVALID");
  }
  if (url.protocol !== "https:" || url.username.length > 0 || url.password.length > 0) {
    throw researchError("AGENTMO_POC_RESEARCH_INPUT_INVALID");
  }
  url.hash = "";
  return url.toString();
}

function validateSource(value, errors, ids) {
  const keys = ["id", "adapter", "origin", "pathPrefix", "requestPath", "sourceRole", "trustTier", "domains", "scenarios"];
  if (!isPlainObject(value) || !hasExactKeys(value, keys)) {
    errors.push("source shape is invalid.");
    return;
  }
  if (!SAFE_ID.test(value.id ?? "") || ids.has(value.id)) errors.push("source id is invalid.");
  ids.add(value.id);
  if (!ADAPTERS.has(value.adapter)) errors.push("source adapter is invalid.");
  if (!isAllowedSourceOrigin(value.adapter, value.origin, value.pathPrefix, value.requestPath)) errors.push("source origin is invalid.");
  if (!SOURCE_ROLES.has(value.sourceRole) || !TRUST_TIERS.has(value.trustTier)) errors.push("source labels are invalid.");
  validateBoundedEnumList(value.domains, DOMAINS, "source domains", errors);
  validateBoundedEnumList(value.scenarios, SCENARIOS, "source scenarios", errors);
}

function validateSkillCandidate(value, errors, ids) {
  if (!isPlainObject(value) || !hasExactKeys(value, ["id", "origin", "admission"])) {
    errors.push("skill candidate shape is invalid.");
    return;
  }
  if (!SAFE_ID.test(value.id ?? "") || ids.has(value.id)) errors.push("skill candidate id is invalid.");
  ids.add(value.id);
  try {
    canonicalResearchUrl(value.origin);
  } catch {
    errors.push("skill candidate origin is invalid.");
  }
  if (value.admission !== "review-required") errors.push("skill candidate admission is invalid.");
}

function isAllowedSourceOrigin(adapter, origin, pathPrefix, requestPath) {
  if (typeof origin !== "string" || typeof pathPrefix !== "string" || !pathPrefix.startsWith("/")
    || typeof requestPath !== "string" || !requestPath.startsWith(pathPrefix)) return false;
  if (adapter === "aihot-v1") return origin === "https://aihot.virxact.com" && pathPrefix.startsWith("/api/v1/");
  if (adapter === "github-release") return origin === "https://api.github.com" && pathPrefix.startsWith("/repos/");
  if (adapter === "arxiv-atom") return origin === "https://export.arxiv.org" && pathPrefix === "/api/query";
  try {
    return canonicalResearchUrl(`${origin}${pathPrefix}`).startsWith(origin);
  } catch {
    return false;
  }
}

function validateBoundedEnumList(value, allowed, label, errors) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 4 || value.some((entry) => !allowed.has(entry)) || new Set(value).size !== value.length) {
    errors.push(`${label} are invalid.`);
  }
}

function hasExactKeys(value, keys) {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function researchError(code) {
  const error = new Error("AgentMo POC research input was rejected.");
  error.code = code;
  return error;
}
