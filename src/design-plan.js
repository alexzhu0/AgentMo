import path from "node:path";
import {
  admittedArtifactProvenance,
  ArtifactAdmissionError,
} from "./artifact-admission.js";
import { DISCOVERY_DB_SCHEMA_VERSION } from "./discovery-db.js";
import {
  PersistabilityError,
  serializePersistableJson,
  writePersistableJsonAtomic,
} from "./persistability.js";
import { validateSourceRefs } from "./source-refs.js";
import { USER_NEED_SCHEMA_VERSION, validateUserNeed } from "./user-need.js";

export const DESIGN_PLAN_SCHEMA_VERSION = "agentmo.design-plan.v1";

const REQUIREMENT_TYPES = new Set(["primary_task", "success_criterion", "hard_failure"]);
const COVERAGE_LEVELS = new Set(["supported", "partial", "missing"]);
const ADMITTED_DESIGN_PLAN_CANDIDATES = new WeakSet();
const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "of",
  "or",
  "the",
  "to",
  "when",
  "with",
  "without",
  "plus",
  "every",
  "cases",
]);

export async function loadDesignPlan(filePath, options = {}) {
  if (options.subject !== "design-plan") {
    const { AgentMoUnsupportedArtifactError } = await import("./artifact-registry.js");
    throw new AgentMoUnsupportedArtifactError("subject_identity_mismatch");
  }
  const { loadAdmittedArtifact } = await import("./artifact-admission.js");
  return (await loadAdmittedArtifact({
    filePath,
    subject: "design-plan",
    expectedDigest: options.expectedDigest,
    maxBytes: options.maxBytes,
    openInput: options.openInput,
  })).value;
}

export function buildDesignPlan(discoveryDb, userNeed, options = {}) {
  assertDesignPlanInputs(discoveryDb, userNeed, options);
  const source = admittedDesignPlanSource(discoveryDb, userNeed, options.admissions);
  const targetRuntime = resolveRuntime(options.target, options.runtime);
  const sourceIds = collectSourceIds(discoveryDb);
  const factIds = collectFactIds(discoveryDb);
  const sourceRefValidation = validateSourceRefs(userNeed.source_refs ?? [], {
    sourceIds,
    factIds,
    fieldPath: "source_refs",
    requireKnownBareRefs: true,
  });
  if (!sourceRefValidation.ok) {
    throw new Error(`Invalid source_refs for design plan:\n${sourceRefValidation.errors.map((error) => `- ${error}`).join("\n")}`);
  }

  const requirementsTrace = buildRequirementsTrace(discoveryDb, userNeed);
  const gaps = buildGaps(requirementsTrace);
  const governMissingEvidence = options.governMissingEvidence !== false;
  const evalPlan = buildEvalPlan(userNeed, requirementsTrace, gaps, governMissingEvidence);
  const governanceGates = buildGovernanceGates(userNeed, requirementsTrace, gaps, governMissingEvidence);
  const validation = buildValidation(requirementsTrace, gaps, governanceGates, governMissingEvidence);
  const plan = {
    schemaVersion: DESIGN_PLAN_SCHEMA_VERSION,
    ok: validation.ok,
    agentId: sanitizeId(userNeed.agent_id),
    domain: sanitizeString(userNeed.domain),
    targetRuntime,
    source,
    userNeedSummary: summarizeNeed(userNeed, sourceRefValidation.refs),
    discoverySummary: summarizeDiscoveryDb(discoveryDb),
    requirementsTrace,
    evidenceMap: requirementsTrace.map((entry) => ({
      requirementId: entry.requirementId,
      coverage: entry.coverage,
      matchedFactRefs: entry.matchedFactRefs,
      matchedSourceIds: entry.matchedSourceIds,
    })),
    gaps,
    assumptions: gaps.map((gap) => ({
      id: `${gap.id}-assumption`,
      requirementId: gap.requirementId,
      text: "Treat unresolved evidence as an explicit evaluation and governance constraint, not as a production claim.",
    })),
    architecturePlan: buildArchitecturePlan(userNeed, targetRuntime),
    toolContractPlan: buildToolContractPlan(userNeed),
    evalPlan,
    evidencePolicy: buildEvidencePolicy(sourceRefValidation.refs),
    governanceGates,
    certificationBoundary: {
      designPlanCertifiesRuntime: false,
      designPlanCertifiesDomain: false,
      designPlanCertifiesProduction: false,
      notes: "Stage 2 planning records design intent only; Stage 3 must verify implementation, runtime evidence, and domain cases separately.",
    },
    validation,
  };
  ADMITTED_DESIGN_PLAN_CANDIDATES.add(plan);
  return plan;
}

export function validateDesignPlan(plan) {
  const errors = [];
  const warnings = [];
  if (!isObject(plan)) return { ok: false, errors: ["Design plan must be a JSON object."], warnings, gates: [] };

  if (plan.schemaVersion !== DESIGN_PLAN_SCHEMA_VERSION) errors.push(`schemaVersion must be ${DESIGN_PLAN_SCHEMA_VERSION}`);
  if (typeof plan.ok !== "boolean") errors.push("ok must be a boolean.");
  requireString(plan, "agentId", errors);
  requireString(plan, "domain", errors);
  requireString(plan, "targetRuntime", errors);
  validateDesignPlanSource(plan.source, errors);
  if (!Array.isArray(plan.requirementsTrace) || plan.requirementsTrace.length === 0) {
    errors.push("requirementsTrace must be a non-empty array.");
  } else {
    for (const [index, entry] of plan.requirementsTrace.entries()) validateTraceEntry(entry, index, errors);
  }
  requireArray(plan, "evidenceMap", errors);
  requireArray(plan, "gaps", errors);
  requireObject(plan, "architecturePlan", errors);
  requireObject(plan, "toolContractPlan", errors);
  requireObject(plan, "evalPlan", errors);
  requireObject(plan, "evidencePolicy", errors);
  requireArray(plan, "governanceGates", errors);
  requireObject(plan, "certificationBoundary", errors);
  requireObject(plan, "validation", errors);
  if (isObject(plan.validation)) {
    if (typeof plan.validation.ok !== "boolean") errors.push("validation.ok must be a boolean.");
    if (!Array.isArray(plan.validation.errors)) errors.push("validation.errors must be an array.");
    if (!Array.isArray(plan.validation.warnings)) errors.push("validation.warnings must be an array.");
  }
  const sensitivityFindings = collectSensitiveOutputFindings(plan);
  if (sensitivityFindings.length > 0) errors.push(`design-plan contains unbounded sensitive output at ${sensitivityFindings.join(", ")}`);
  const gates = Array.isArray(plan.governanceGates) ? plan.governanceGates : [];
  const failedGates = gates.filter((gate) => gate?.status === "fail");
  if (plan.ok === true && failedGates.length > 0) errors.push("ok cannot be true when governance gates fail.");
  if (plan.ok === true && plan.validation?.ok !== true) errors.push("ok cannot be true when validation.ok is not true.");
  return { ok: errors.length === 0, errors, warnings, gates };
}

export function buildDesignPlanReport(plan, options = {}) {
  const validation = validateDesignPlan(plan);
  return {
    schemaVersion: "agentmo.design-plan-report.v1",
    ok: validation.ok && plan.ok === true,
    designPlanPath: boundedPath(options.designPlanPath),
    agentId: plan.agentId,
    domain: plan.domain,
    targetRuntime: plan.targetRuntime,
    requirements: Array.isArray(plan.requirementsTrace) ? plan.requirementsTrace.length : 0,
    gaps: Array.isArray(plan.gaps) ? plan.gaps.length : 0,
    validation,
  };
}

export function formatDesignPlanReport(report) {
  const lines = [
    `AgentMo design plan: ${report.agentId ?? "unknown"}`,
    `Status: ${report.ok ? "pass" : "fail"}`,
    `Domain: ${report.domain ?? "unknown"}`,
    `Target runtime: ${report.targetRuntime ?? "unknown"}`,
    `Design plan: ${report.designPlanPath ?? "not written"}`,
    `Requirements: ${report.requirements}`,
    `Gaps: ${report.gaps}`,
  ];
  for (const warning of report.validation.warnings) lines.push(`WARN ${warning}`);
  for (const error of report.validation.errors) lines.push(`ERROR ${error}`);
  return `${lines.join("\n")}\n`;
}

export async function writeDesignPlan(filePath, plan) {
  if (!ADMITTED_DESIGN_PLAN_CANDIDATES.has(plan)) {
    throw new PersistabilityError("AGENTMO_PERSISTABILITY_UNADMITTED_CANDIDATE");
  }
  const validation = validateDesignPlan(plan);
  if (!validation.ok) throw new PersistabilityError("AGENTMO_PERSISTABILITY_INVALID_CANDIDATE");
  serializePersistableJson(plan, { subject: "design-plan" });
  const target = path.resolve(filePath);
  await writePersistableJsonAtomic(target, plan, { subject: "design-plan" });
  return filePath;
}

function admittedDesignPlanSource(discoveryDb, userNeed, admissions) {
  if (!isObject(admissions)
    || !hasExactKeys(admissions, ["discoveryDb", "userNeed"])) {
    throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_ADMISSION_RESULT_INVALID");
  }
  return {
    discoveryDb: admittedArtifactProvenance(admissions.discoveryDb, {
      subject: "discovery-db",
      value: discoveryDb,
    }),
    userNeed: admittedArtifactProvenance(admissions.userNeed, {
      subject: "user-need",
      value: userNeed,
    }),
  };
}

function validateDesignPlanSource(source, errors) {
  if (!isObject(source) || !hasExactKeys(source, ["discoveryDb", "userNeed"])) {
    errors.push("source must contain exact discoveryDb and userNeed admission provenance.");
    return;
  }
  validateAdmissionProvenance(
    source.discoveryDb,
    "discovery-db",
    DISCOVERY_DB_SCHEMA_VERSION,
    "source.discoveryDb",
    errors,
  );
  validateAdmissionProvenance(
    source.userNeed,
    "user-need",
    USER_NEED_SCHEMA_VERSION,
    "source.userNeed",
    errors,
  );
}

function validateAdmissionProvenance(value, subject, identity, fieldPath, errors) {
  if (!isObject(value) || !hasExactKeys(value, ["identity", "subject", "digest"])) {
    errors.push(`${fieldPath} must be exact identity, subject, and digest provenance.`);
    return;
  }
  if (value.identity !== identity) errors.push(`${fieldPath}.identity must be ${identity}.`);
  if (value.subject !== subject) errors.push(`${fieldPath}.subject must be ${subject}.`);
  if (!SHA256_DIGEST_PATTERN.test(value.digest)) errors.push(`${fieldPath}.digest must be an exact sha256 digest.`);
}

function hasExactKeys(value, expected) {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function assertDesignPlanInputs(discoveryDb, userNeed, options = {}) {
  if (discoveryDb?.schemaVersion !== DISCOVERY_DB_SCHEMA_VERSION) {
    throw new Error(`discovery-db schemaVersion must be ${DISCOVERY_DB_SCHEMA_VERSION}`);
  }
  if (userNeed?.schemaVersion !== USER_NEED_SCHEMA_VERSION) {
    throw new Error(`user-need schemaVersion must be ${USER_NEED_SCHEMA_VERSION}`);
  }
  const needValidation = validateUserNeed(userNeed);
  if (!needValidation.ok) {
    throw new Error(`Cannot build design plan for invalid user need:\n${needValidation.errors.map((error) => `- ${error}`).join("\n")}`);
  }
  if (typeof discoveryDb.agentId === "string" && discoveryDb.agentId !== userNeed.agent_id) {
    throw new Error(`discovery-db agentId ${discoveryDb.agentId} does not match user-need agent_id ${userNeed.agent_id}`);
  }
  if (discoveryDb.safety?.workspaceOk === false || discoveryDb.workspace?.ok === false) {
    throw new Error("Cannot build design plan from an unsafe workspace discovery-db safety state.");
  }
  if (discoveryDb.validation?.ok !== true) {
    throw new Error("Cannot build design plan from a discovery-db whose source manifest did not validate.");
  }
  resolveRuntime(options.target, options.runtime);
}

function buildRequirementsTrace(discoveryDb, userNeed) {
  const factIndex = buildFactIndex(discoveryDb);
  const groups = [
    ["primary_task", userNeed.primary_tasks],
    ["success_criterion", userNeed.success_criteria],
    ["hard_failure", userNeed.hard_failures],
  ];
  return groups.flatMap(([type, items]) =>
    items.map((text, index) => buildTraceEntry(type, text, index + 1, factIndex)),
  );
}

function buildTraceEntry(type, text, number, factIndex) {
  const matches = matchFacts(text, factIndex);
  const coverage = matches.length >= 2 ? "supported" : matches.length === 1 ? "partial" : "missing";
  const requirementId = `${type.replaceAll("_", "-")}-${String(number).padStart(2, "0")}`;
  return {
    requirementId,
    requirementType: type,
    requirementText: sanitizeString(text),
    coverage,
    matchedFactRefs: matches.map((match) => match.fact.id),
    matchedSourceIds: Array.from(new Set(matches.map((match) => match.fact.sourceId).filter(nonEmptyString))).sort(),
    planningImpact: planningImpact(type, coverage),
  };
}

function buildFactIndex(discoveryDb) {
  const sourcesById = new Map((Array.isArray(discoveryDb.sources) ? discoveryDb.sources : []).map((source) => [source.id, source]));
  return (Array.isArray(discoveryDb.facts) ? discoveryDb.facts : []).map((fact) => {
    const source = sourcesById.get(fact.sourceId) ?? {};
    const searchable = [
      fact.id,
      fact.sourceId,
      fact.kind,
      fact.text,
      ...(Array.isArray(fact.tags) ? fact.tags : []),
      source.id,
      source.type,
      source.description,
      ...(Array.isArray(source.extractionFields) ? source.extractionFields : []),
    ].join(" ");
    return { fact, tokens: tokenize(searchable) };
  });
}

function matchFacts(text, factIndex) {
  const requirementTokens = tokenize(text);
  const matches = factIndex
    .map((entry) => ({
      fact: entry.fact,
      score: overlapScore(requirementTokens, entry.tokens),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.fact.id.localeCompare(right.fact.id));
  const strong = matches.filter((entry) => entry.score >= 2);
  return (strong.length > 0 ? strong : matches).slice(0, 4);
}

function tokenize(text) {
  const words = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .split(/\s+/u)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
  const tokens = new Set(words);
  for (const word of words) {
    if (word.endsWith("ies") && word.length > 4) tokens.add(`${word.slice(0, -3)}y`);
    if (word.endsWith("s") && word.length > 4) tokens.add(word.slice(0, -1));
    if (word.endsWith("ing") && word.length > 5) tokens.add(word.slice(0, -3));
    if (word.endsWith("ed") && word.length > 4) tokens.add(word.slice(0, -2));
  }
  return tokens;
}

function overlapScore(left, right) {
  let score = 0;
  for (const token of left) if (right.has(token)) score += 1;
  return score;
}

function planningImpact(type, coverage) {
  if (coverage === "supported") {
    return "Use matched discovery facts as bounded planning evidence; keep Stage 3 validation separate.";
  }
  if (type === "hard_failure") {
    return "Convert unresolved hard-failure coverage into fail-closed eval cases and governance gates before delivery.";
  }
  return "Record the gap and require eval/governance coverage before treating the requirement as implementation-ready.";
}

function buildGaps(requirementsTrace) {
  return requirementsTrace
    .filter((entry) => entry.coverage !== "supported")
    .map((entry, index) => ({
      id: `gap-${String(index + 1).padStart(2, "0")}`,
      requirementId: entry.requirementId,
      coverage: entry.coverage,
      description: `Discovery evidence is ${entry.coverage} for ${entry.requirementType}: ${entry.requirementText}`,
      impact: entry.planningImpact,
      governed: true,
    }));
}

function buildEvalPlan(userNeed, requirementsTrace, gaps, governMissingEvidence) {
  return {
    strategy: "Evaluate every user requirement with bounded fact refs and explicit missing-evidence assertions.",
    requirementCases: requirementsTrace.map((entry) => ({
      requirementId: entry.requirementId,
      coverage: entry.coverage,
      expectedEvidenceRefs: entry.matchedFactRefs,
    })),
    hardFailures: requirementsTrace
      .filter((entry) => entry.requirementType === "hard_failure")
      .map((entry) => ({
        requirementId: entry.requirementId,
        requirementText: entry.requirementText,
        mustFailClosed: true,
      })),
    successCriteria: userNeed.success_criteria.map((criterion, index) => ({
      id: `success-criterion-${String(index + 1).padStart(2, "0")}`,
      text: sanitizeString(criterion),
    })),
    missingEvidenceChecks: governMissingEvidence
      ? gaps.map((gap) => ({
          gapId: gap.id,
          requirementId: gap.requirementId,
          expectedBehavior: "disclose missing evidence, request review input, or block promotion",
        }))
      : [],
  };
}

function buildGovernanceGates(userNeed, requirementsTrace, gaps, governMissingEvidence) {
  return [
    {
      id: "valid-input-contracts",
      status: "pass",
      rule: "Discovery DB and user-need artifacts validate before Stage 2 planning.",
    },
    {
      id: "trace-complete",
      status: requirementsTrace.length === userNeed.primary_tasks.length + userNeed.success_criteria.length + userNeed.hard_failures.length ? "pass" : "fail",
      rule: "Every primary task, success criterion, and hard failure has a trace entry.",
    },
    {
      id: "missing-evidence-governed",
      status: gaps.length === 0 || governMissingEvidence ? "pass" : "fail",
      rule: "Partial or missing evidence must become an explicit gap plus eval/governance constraint.",
    },
    {
      id: "fail-closed-hard-failures",
      status: requirementsTrace.some((entry) => entry.requirementType === "hard_failure") ? "pass" : "fail",
      rule: "Hard failures become fail-closed eval cases before Stage 3 delivery.",
    },
    {
      id: "certification-boundary",
      status: "pass",
      rule: "Design planning does not certify runtime, domain-wide behavior, or production approval.",
    },
  ];
}

function buildValidation(requirementsTrace, gaps, governanceGates, governMissingEvidence) {
  const errors = [];
  const warnings = [];
  if (requirementsTrace.length === 0) errors.push("requirementsTrace must not be empty.");
  if (gaps.length > 0) warnings.push(`${gaps.length} requirements have partial or missing evidence and must remain governed.`);
  if (gaps.length > 0 && !governMissingEvidence) errors.push("missing evidence is not converted into eval/governance constraints.");
  for (const gate of governanceGates) if (gate.status !== "pass") errors.push(`governance gate failed: ${gate.id}`);
  return { ok: errors.length === 0, errors, warnings, gates: governanceGates };
}

function summarizeNeed(userNeed, sourceRefs) {
  return {
    agentId: sanitizeString(userNeed.agent_id),
    domain: sanitizeString(userNeed.domain),
    problem: sanitizeString(userNeed.problem),
    targetUserCount: Array.isArray(userNeed.target_users) ? userNeed.target_users.length : 0,
    primaryTaskCount: Array.isArray(userNeed.primary_tasks) ? userNeed.primary_tasks.length : 0,
    successCriteriaCount: Array.isArray(userNeed.success_criteria) ? userNeed.success_criteria.length : 0,
    hardFailureCount: Array.isArray(userNeed.hard_failures) ? userNeed.hard_failures.length : 0,
    outputPreferences: {
      language: sanitizeString(userNeed.output_preferences?.language ?? ""),
      format: sanitizeString(userNeed.output_preferences?.format ?? ""),
      evidenceStyle: sanitizeString(userNeed.output_preferences?.evidence_style ?? ""),
    },
    sourceRefs,
  };
}

function summarizeDiscoveryDb(discoveryDb) {
  return {
    schemaVersion: discoveryDb.schemaVersion,
    agentId: discoveryDb.agentId,
    sourceCount: Array.isArray(discoveryDb.sources) ? discoveryDb.sources.length : 0,
    factCount: Array.isArray(discoveryDb.facts) ? discoveryDb.facts.length : 0,
    sourceIds: collectSourceIds(discoveryDb),
    databaseOutputs: Array.isArray(discoveryDb.outputs?.database) ? discoveryDb.outputs.database.map(sanitizeString) : [],
    retrievalOutputs: Array.isArray(discoveryDb.outputs?.retrieval) ? discoveryDb.outputs.retrieval.map(sanitizeString) : [],
  };
}

function buildArchitecturePlan(userNeed, targetRuntime) {
  const routingModes = userNeed.primary_tasks.map(slug).filter(nonEmptyString);
  return {
    mainAgent: `${sanitizeId(userNeed.agent_id)}-main`,
    targetRuntime,
    routingModes,
    specialistPlans: userNeed.primary_tasks.slice(0, 4).map((task) => ({
      id: `${sanitizeId(userNeed.agent_id)}-${slug(task).slice(0, 32)}`.replace(/-+$/u, ""),
      purpose: sanitizeString(task),
    })),
    boundary: "Stage 3 may implement this architecture only after validating the blueprint/design contract.",
  };
}

function buildToolContractPlan(userNeed) {
  return {
    policy: "Tool contracts must cite bounded fact refs or disclose missing evidence before user-facing claims.",
    tools: userNeed.primary_tasks.slice(0, 6).map((task) => ({
      name: `${sanitizeId(userNeed.agent_id)}_${slug(task).replaceAll("-", "_")}`.replace(/_+$/u, ""),
      purpose: `Support the workflow task: ${sanitizeString(task)}`,
      allowedWhen: [sanitizeString(task)],
      forbiddenWhen: userNeed.hard_failures.map(sanitizeString),
      evidencePolicy: "bounded fact refs or missing-evidence disclosure",
    })),
  };
}

function buildEvidencePolicy(sourceRefs) {
  return {
    allowedRefs: ["discovery source ids", "discovery fact ids", "repo-relative bounded paths", "http(s) URLs without credentials"],
    sourceRefs,
    storageRules: [
      "Persist bounded fact refs and summaries only.",
      "Do not persist sensitive values, full conversation logs, full tool responses, or production runtime state in Stage 2 artifacts.",
      "Missing evidence must remain visible in eval and governance gates.",
    ],
  };
}

function validateTraceEntry(entry, index, errors) {
  if (!isObject(entry)) {
    errors.push(`requirementsTrace[${index}] must be an object.`);
    return;
  }
  requireString(entry, `requirementsTrace[${index}].requirementId`, errors);
  if (!REQUIREMENT_TYPES.has(entry.requirementType)) {
    errors.push(`requirementsTrace[${index}].requirementType must be one of: ${Array.from(REQUIREMENT_TYPES).join(", ")}`);
  }
  requireString(entry, `requirementsTrace[${index}].requirementText`, errors);
  if (!COVERAGE_LEVELS.has(entry.coverage)) {
    errors.push(`requirementsTrace[${index}].coverage must be one of: ${Array.from(COVERAGE_LEVELS).join(", ")}`);
  }
  requireArray(entry, `requirementsTrace[${index}].matchedFactRefs`, errors);
  requireArray(entry, `requirementsTrace[${index}].matchedSourceIds`, errors);
  requireString(entry, `requirementsTrace[${index}].planningImpact`, errors);
}

function collectSourceIds(discoveryDb) {
  return (Array.isArray(discoveryDb.sources) ? discoveryDb.sources : []).map((source) => source.id).filter(nonEmptyString).sort();
}

function collectFactIds(discoveryDb) {
  return (Array.isArray(discoveryDb.facts) ? discoveryDb.facts : []).map((fact) => fact.id).filter(nonEmptyString).sort();
}

function resolveRuntime(target, runtime) {
  if (nonEmptyString(runtime)) return runtime;
  if (target === "agentmo") return "codex";
  if (target === undefined || target === null || target === "openclaw") return "openclaw";
  throw new Error(`Unknown design-plan target: ${target}. Expected one of: agentmo, openclaw`);
}

function boundedPath(filePath) {
  if (!nonEmptyString(filePath)) return null;
  return path.basename(filePath);
}

function collectSensitiveOutputFindings(value, pointer = "$", findings = []) {
  if (typeof value === "string") {
    if (path.posix.isAbsolute(value) || /^(?:[A-Za-z]:[\\/]|\\\\)/u.test(value) || value.includes("/home/")) findings.push(pointer);
    if (/\bsk-[A-Za-z0-9_-]{12,}\b/u.test(value) || /\bapi[_-]?key\s*=/iu.test(value)) findings.push(pointer);
    return findings;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) collectSensitiveOutputFindings(item, `${pointer}[${index}]`, findings);
    return findings;
  }
  if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) collectSensitiveOutputFindings(item, `${pointer}.${key}`, findings);
  }
  return findings;
}

function sanitizeString(value) {
  return String(value).trim();
}

function sanitizeId(value) {
  return slug(value);
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .replace(/-+/gu, "-") || "agent";
}

function requireString(object, fieldPath, errors) {
  const key = fieldPath.split(".").at(-1);
  if (!nonEmptyString(object?.[key])) errors.push(`${fieldPath} must be a non-empty string.`);
}

function requireArray(object, fieldPath, errors) {
  const key = fieldPath.split(".").at(-1);
  if (!Array.isArray(object?.[key])) errors.push(`${fieldPath} must be an array.`);
}

function requireObject(object, fieldPath, errors) {
  const key = fieldPath.split(".").at(-1);
  if (!isObject(object?.[key])) errors.push(`${fieldPath} must be an object.`);
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
