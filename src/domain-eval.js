import { assertPersistable } from "./persistability.js";
import { validateBlueprint } from "./blueprint.js";

export const DOMAIN_EVAL_SCHEMA_VERSION = "agentmo.domain-eval.v1";
export const DOMAIN_CASES_SCHEMA_VERSION = "agentmo.domain-cases.v1";

const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,159}$/u;
const MAX_CASES = 1_000;
const MAX_REFS_PER_CASE = 100;

export const DOMAIN_EVAL_REQUIRED_CHECK_IDS = Object.freeze([
  "blueprint_valid",
  "domain_cases_valid",
  "source_admissions_exact",
  "agent_id_match",
  "target_match",
  "required_case_classes_covered",
  "case_thresholds_pass",
  "hard_failures_absent",
  "no_hard_failures",
  "evaluator_provenance_present",
  "rubric_provenance_present",
  "bounded_evidence_refs",
  "no_raw_or_secret_evidence",
]);

export async function loadDomainCases(filePath, options = {}) {
  if (options.subject !== "domain-cases") {
    throw domainError("AGENTMO_DOMAIN_CASES_SUBJECT_REQUIRED");
  }
  const { loadAdmittedArtifact } = await import("./artifact-admission.js");
  const admission = await loadAdmittedArtifact({
    filePath,
    subject: "domain-cases",
    expectedDigest: options.expectedDigest,
    maxBytes: options.maxBytes,
    openInput: options.openInput,
  });
  return options.returnAdmission === true ? admission : admission.value;
}

export function validateDomainCasesArtifact(value) {
  const errors = [];
  try {
    assertPersistable(value, { subject: "domain-cases" });
  } catch {
    return { ok: false, errors: ["domain_cases_not_persistable"] };
  }

  requireExactKeys(value, [
    "schemaVersion",
    "agentId",
    "targetId",
    "threshold",
    "evaluator",
    "rubric",
    "cases",
  ], "domain_cases_fields", errors);
  if (value?.schemaVersion !== DOMAIN_CASES_SCHEMA_VERSION) errors.push("domain_cases_schema_invalid");
  if (!safeId(value?.agentId)) errors.push("domain_cases_agent_id_invalid");
  if (!safeId(value?.targetId)) errors.push("domain_cases_target_id_invalid");
  if (!boundedScore(value?.threshold)) errors.push("domain_cases_threshold_invalid");
  if (!validEvaluator(value?.evaluator)) errors.push("domain_cases_evaluator_invalid");
  if (!validRubric(value?.rubric)) errors.push("domain_cases_rubric_invalid");
  if (!Array.isArray(value?.cases) || value.cases.length === 0 || value.cases.length > MAX_CASES) {
    errors.push("domain_cases_count_invalid");
  } else {
    const caseIds = new Set();
    for (const domainCase of value.cases) {
      if (!validDomainCase(domainCase)) errors.push("domain_case_invalid");
      if (safeId(domainCase?.id) && caseIds.has(domainCase.id)) errors.push("domain_case_id_duplicate");
      if (safeId(domainCase?.id)) caseIds.add(domainCase.id);
    }
  }
  return validation(errors);
}

export async function buildDomainEval(blueprint, domainCases, options = {}) {
  const blueprintValidation = validateBlueprint(blueprint);
  const domainCasesValidation = validateDomainCasesArtifact(domainCases);
  if (!blueprintValidation.ok) throw domainError("AGENTMO_DOMAIN_EVAL_BLUEPRINT_INVALID");
  if (!domainCasesValidation.ok) throw domainError("AGENTMO_DOMAIN_CASES_INVALID");

  const { admittedArtifactProvenance } = await import("./artifact-admission.js");
  const sources = {
    blueprint: admittedArtifactProvenance(options.admissions?.blueprint, {
      subject: "blueprint",
      value: blueprint,
    }),
    domainCases: admittedArtifactProvenance(options.admissions?.domainCases, {
      subject: "domain-cases",
      value: domainCases,
    }),
  };

  const requiredCaseClasses = uniqueSorted(asSafeIdArray(blueprint.eval?.required_case_classes));
  const requiredClassSet = new Set(requiredCaseClasses);
  const caseResults = domainCases.cases
    .map((domainCase) => buildCaseResult(domainCase, requiredClassSet))
    .sort((left, right) => left.caseId.localeCompare(right.caseId));
  const coveredCaseClasses = uniqueSorted(
    caseResults.filter((result) => result.required).map((result) => result.caseClass),
  );
  const missingCaseClasses = requiredCaseClasses.filter((caseClass) => !coveredCaseClasses.includes(caseClass));
  const requiredCaseResults = caseResults.filter((result) => result.required);
  const requestedTargetId = options.target ?? null;
  const effectiveTargetId = requestedTargetId ?? domainCases.targetId;
  const targetMatch = targetMatchesBlueprint({
    requestedTargetId,
    casesTargetId: domainCases.targetId,
    effectiveTargetId,
    blueprintTargetIds: blueprintTargetSet(blueprint),
  });
  const requiredCovered = requiredCaseClasses.length > 0 && missingCaseClasses.length === 0;
  const thresholdsPass = requiredCovered
    && requiredCaseResults.length > 0
    && requiredCaseResults.every((result) => result.passed && result.scorePass && result.hardFailureFree);
  const hardFailuresAbsent = caseResults.every((result) => result.hardFailureFree);
  const boundedEvidenceRefs = caseResults.every((result) => result.boundedEvidenceRefs);

  const checks = buildCanonicalDomainChecks({
    blueprintValid: true,
    domainCasesValid: true,
    sourceAdmissionsExact: true,
    agentIdMatch: domainCases.agentId === blueprint.agent_id,
    targetMatch,
    requiredCovered,
    thresholdsPass,
    hardFailuresAbsent,
    evaluatorProvenancePresent: validEvaluator(domainCases.evaluator),
    rubricProvenancePresent: validRubric(domainCases.rubric),
    boundedEvidenceRefs,
    noRawOrSecretEvidence: true,
  });
  const ok = checks.every((item) => item.pass);
  const report = {
    schemaVersion: DOMAIN_EVAL_SCHEMA_VERSION,
    ok,
    agentId: blueprint.agent_id,
    sources,
    target: {
      requested: requestedTargetId,
      cases: domainCases.targetId,
      effective: effectiveTargetId,
    },
    requiredCaseClasses,
    coveredCaseClasses,
    missingCaseClasses,
    threshold: domainCases.threshold,
    evaluator: { ...domainCases.evaluator },
    rubric: { ...domainCases.rubric },
    caseResults,
    checks,
    audit: {
      ok: true,
      findingCount: 0,
      secretFindingCount: 0,
      rawFindingCount: 0,
    },
    validation: {
      blueprintErrorCount: blueprintValidation.errors.length,
      blueprintWarningCount: blueprintValidation.warnings.length,
      domainCasesErrorCount: domainCasesValidation.errors.length,
    },
    runtimeCertifiedByDomainEval: false,
    domainCertifiedByDomainEval: ok,
    deliveryReadyByDomainEval: false,
    productionApprovedByDomainEval: false,
    certificationBoundary: {
      runtimeCertifiedByDomainEval: false,
      domainCertifiedByDomainEval: ok,
      deliveryReadyByDomainEval: false,
      productionApprovedByDomainEval: false,
    },
  };
  assertPersistable(report, { subject: "domain-eval" });
  const reportValidation = validateDomainEvalArtifact(report, {
    blueprint,
    domainCases,
    sources,
  });
  if (!reportValidation.ok) throw domainError("AGENTMO_DOMAIN_EVAL_INVALID");
  return deepFreeze(report);
}

export function validateDomainEvalArtifact(value, options = {}) {
  const errors = [];
  try {
    assertPersistable(value, { subject: "domain-eval" });
  } catch {
    return { ok: false, errors: ["domain_eval_not_persistable"] };
  }

  requireExactKeys(value, [
    "schemaVersion",
    "ok",
    "agentId",
    "sources",
    "target",
    "requiredCaseClasses",
    "coveredCaseClasses",
    "missingCaseClasses",
    "threshold",
    "evaluator",
    "rubric",
    "caseResults",
    "checks",
    "audit",
    "validation",
    "runtimeCertifiedByDomainEval",
    "domainCertifiedByDomainEval",
    "deliveryReadyByDomainEval",
    "productionApprovedByDomainEval",
    "certificationBoundary",
  ], "domain_eval_fields", errors);
  if (value?.schemaVersion !== DOMAIN_EVAL_SCHEMA_VERSION) errors.push("domain_eval_schema_invalid");
  if (typeof value?.ok !== "boolean") errors.push("domain_eval_ok_invalid");
  if (!safeId(value?.agentId)) errors.push("domain_eval_agent_id_invalid");
  if (!validSources(value?.sources)) errors.push("domain_eval_sources_invalid");
  if (!validTarget(value?.target)) errors.push("domain_eval_target_invalid");
  if (!sortedUniqueSafeIds(value?.requiredCaseClasses)
    || !sortedUniqueSafeIds(value?.coveredCaseClasses)
    || !sortedUniqueSafeIds(value?.missingCaseClasses)) errors.push("domain_eval_case_classes_invalid");
  if (!boundedScore(value?.threshold)) errors.push("domain_eval_threshold_invalid");
  if (!validEvaluator(value?.evaluator)) errors.push("domain_eval_evaluator_invalid");
  if (!validRubric(value?.rubric)) errors.push("domain_eval_rubric_invalid");
  if (!Array.isArray(value?.caseResults)
    || value.caseResults.length === 0
    || value.caseResults.length > MAX_CASES
    || !value.caseResults.every(validCaseResult)
    || !isSortedBy(value.caseResults, "caseId")) errors.push("domain_eval_case_results_invalid");
  const derivation = deriveDomainEvalAssessment(value, options);
  if (!derivation.coverageMatches) errors.push("domain_eval_coverage_invalid");
  if (!derivation.requiredFlagsMatch) errors.push("domain_eval_required_flags_invalid");
  if (!validChecks(value?.checks, derivation.checks) || value?.ok !== derivation.ok) {
    errors.push("domain_eval_checks_invalid");
  }
  if (!validAudit(value?.audit)) errors.push("domain_eval_audit_invalid");
  if (!validValidationSummary(value?.validation)) errors.push("domain_eval_validation_invalid");
  if (value?.runtimeCertifiedByDomainEval !== false
    || value?.domainCertifiedByDomainEval !== derivation.ok
    || value?.deliveryReadyByDomainEval !== false
    || value?.productionApprovedByDomainEval !== false
    || !validCertificationBoundary(value?.certificationBoundary, derivation.ok)) {
    errors.push("domain_eval_certification_boundary_invalid");
  }
  const result = validation(errors);
  return {
    ...result,
    domainCertified: result.ok && derivation.ok,
  };
}

export function formatDomainEval(report) {
  const lines = [
    `AgentMo domain eval: ${report.agentId ?? "unknown"}`,
    `Status: ${report.ok ? "pass" : "fail"}`,
    `Domain certified by domain-eval: ${report.domainCertifiedByDomainEval ? "yes" : "no"}`,
    `Target: ${report.target?.effective ?? "unspecified"}`,
    `Required case classes: ${report.requiredCaseClasses.join(", ") || "none"}`,
    `Covered case classes: ${report.coveredCaseClasses.join(", ") || "none"}`,
    "Certification: domain-eval does not certify runtime, delivery, or production approval",
  ];
  for (const item of report.checks) lines.push(`- ${item.pass ? "PASS" : "FAIL"} ${item.id}`);
  return `${lines.join("\n")}\n`;
}

function buildCaseResult(domainCase, requiredClassSet) {
  const scorePass = domainCase.score >= domainCase.threshold;
  const hardFailureFree = domainCase.hardFailureIds.length === 0;
  return {
    caseId: domainCase.id,
    caseClass: domainCase.caseClass,
    required: requiredClassSet.has(domainCase.caseClass),
    passed: domainCase.passed,
    score: domainCase.score,
    threshold: domainCase.threshold,
    scorePass,
    hardFailureIds: [...domainCase.hardFailureIds],
    hardFailureCount: domainCase.hardFailureIds.length,
    hardFailureFree,
    evidenceRefs: [...domainCase.evidenceRefs],
    evidenceRefCount: domainCase.evidenceRefs.length,
    boundedEvidenceRefs: domainCase.evidenceRefs.every(boundedEvidenceRef),
  };
}

function validDomainCase(value) {
  return hasExactKeys(value, [
    "id",
    "caseClass",
    "passed",
    "score",
    "threshold",
    "hardFailureIds",
    "evidenceRefs",
  ])
    && safeId(value.id)
    && safeId(value.caseClass)
    && typeof value.passed === "boolean"
    && boundedScore(value.score)
    && boundedScore(value.threshold)
    && sortedUniqueSafeIds(value.hardFailureIds)
    && Array.isArray(value.evidenceRefs)
    && value.evidenceRefs.length > 0
    && value.evidenceRefs.length <= MAX_REFS_PER_CASE
    && sortedUniqueStrings(value.evidenceRefs)
    && value.evidenceRefs.every(boundedEvidenceRef);
}

function validCaseResult(value) {
  return hasExactKeys(value, [
    "caseId",
    "caseClass",
    "required",
    "passed",
    "score",
    "threshold",
    "scorePass",
    "hardFailureIds",
    "hardFailureCount",
    "hardFailureFree",
    "evidenceRefs",
    "evidenceRefCount",
    "boundedEvidenceRefs",
  ])
    && safeId(value.caseId)
    && safeId(value.caseClass)
    && typeof value.required === "boolean"
    && typeof value.passed === "boolean"
    && boundedScore(value.score)
    && boundedScore(value.threshold)
    && value.scorePass === (value.score >= value.threshold)
    && sortedUniqueSafeIds(value.hardFailureIds)
    && value.hardFailureCount === value.hardFailureIds.length
    && value.hardFailureFree === (value.hardFailureIds.length === 0)
    && sortedUniqueStrings(value.evidenceRefs)
    && value.evidenceRefs.length > 0
    && value.evidenceRefs.length <= MAX_REFS_PER_CASE
    && value.evidenceRefs.every(boundedEvidenceRef)
    && value.evidenceRefCount === value.evidenceRefs.length
    && value.boundedEvidenceRefs === true;
}

function validSources(value) {
  return hasExactKeys(value, ["blueprint", "domainCases"])
    && validProvenance(value.blueprint, "blueprint", "0.1")
    && validProvenance(value.domainCases, "domain-cases", DOMAIN_CASES_SCHEMA_VERSION);
}

function validProvenance(value, subject, identity) {
  return hasExactKeys(value, ["identity", "subject", "digest"])
    && value.identity === identity
    && value.subject === subject
    && SHA256_DIGEST_PATTERN.test(value.digest);
}

function validTarget(value) {
  return hasExactKeys(value, ["requested", "cases", "effective"])
    && (value.requested === null || safeId(value.requested))
    && safeId(value.cases)
    && safeId(value.effective);
}

function validEvaluator(value) {
  return hasExactKeys(value, ["id", "version", "provenanceRef"])
    && safeId(value.id)
    && boundedString(value.version)
    && boundedReference(value.provenanceRef);
}

function validRubric(value) {
  return hasExactKeys(value, ["id", "version", "digest", "provenanceRef"])
    && safeId(value.id)
    && boundedString(value.version)
    && SHA256_DIGEST_PATTERN.test(value.digest)
    && boundedReference(value.provenanceRef);
}

function deriveDomainEvalAssessment(value, options) {
  const requiredCaseClasses = sortedUniqueSafeIds(value?.requiredCaseClasses)
    ? value.requiredCaseClasses
    : [];
  const requiredClassSet = new Set(requiredCaseClasses);
  const caseResults = Array.isArray(value?.caseResults) ? value.caseResults : [];
  const derivedCoveredCaseClasses = uniqueSorted(
    caseResults
      .filter((result) => safeId(result?.caseClass) && requiredClassSet.has(result.caseClass))
      .map((result) => result.caseClass),
  );
  const derivedMissingCaseClasses = requiredCaseClasses.filter(
    (caseClass) => !derivedCoveredCaseClasses.includes(caseClass),
  );
  const coverageMatches = sameStringArray(value?.coveredCaseClasses, derivedCoveredCaseClasses)
    && sameStringArray(value?.missingCaseClasses, derivedMissingCaseClasses)
    && disjointExhaustivePartition(
      requiredCaseClasses,
      value?.coveredCaseClasses,
      value?.missingCaseClasses,
    );
  const requiredFlagsMatch = caseResults.every(
    (result) => result?.required === requiredClassSet.has(result?.caseClass),
  );
  const requiredCaseResults = caseResults.filter(
    (result) => safeId(result?.caseClass) && requiredClassSet.has(result.caseClass),
  );
  const requiredCovered = requiredCaseClasses.length > 0 && derivedMissingCaseClasses.length === 0;
  const thresholdsPass = requiredCovered
    && requiredFlagsMatch
    && requiredCaseResults.length > 0
    && requiredCaseResults.every((result) => result?.passed === true
      && boundedScore(result?.score)
      && boundedScore(result?.threshold)
      && result.score >= result.threshold
      && Array.isArray(result?.hardFailureIds)
      && result.hardFailureIds.length === 0);
  const hardFailuresAbsent = caseResults.every(
    (result) => Array.isArray(result?.hardFailureIds) && result.hardFailureIds.length === 0,
  );
  const boundedEvidenceRefs = caseResults.every(
    (result) => Array.isArray(result?.evidenceRefs)
      && result.evidenceRefs.length > 0
      && result.evidenceRefs.every(boundedEvidenceRef),
  );
  const internalTargetMatch = validTarget(value?.target)
    && (value.target.requested === null
      ? value.target.effective === value.target.cases
      : value.target.requested === value.target.cases && value.target.effective === value.target.requested);
  const contextualTargetMatch = options?.blueprint
    ? targetMatchesBlueprint({
        requestedTargetId: value?.target?.requested ?? null,
        casesTargetId: value?.target?.cases,
        effectiveTargetId: value?.target?.effective,
        blueprintTargetIds: blueprintTargetSet(options.blueprint),
      })
    : true;
  const blueprintValid = options?.blueprint
    ? validateBlueprint(options.blueprint).ok
    : value?.validation?.blueprintErrorCount === 0;
  const domainCasesValid = options?.domainCases
    ? validateDomainCasesArtifact(options.domainCases).ok
    : value?.validation?.domainCasesErrorCount === 0;
  const sourceAdmissionsExact = validSources(value?.sources)
    && (!options?.sources
      || sameProvenance(value.sources.blueprint, options.sources.blueprint)
        && sameProvenance(value.sources.domainCases, options.sources.domainCases));
  const agentIdMatch = options?.blueprint
    ? value?.agentId === options.blueprint?.agent_id
      && (!options?.domainCases || options.domainCases.agentId === options.blueprint.agent_id)
    : canonicalCheckPass(value?.checks, "agent_id_match");
  const checks = buildCanonicalDomainChecks({
    blueprintValid,
    domainCasesValid,
    sourceAdmissionsExact,
    agentIdMatch,
    targetMatch: internalTargetMatch && contextualTargetMatch,
    requiredCovered,
    thresholdsPass,
    hardFailuresAbsent,
    evaluatorProvenancePresent: validEvaluator(value?.evaluator),
    rubricProvenancePresent: validRubric(value?.rubric),
    boundedEvidenceRefs,
    noRawOrSecretEvidence: true,
  });
  return {
    checks,
    ok: checks.every((item) => item.pass),
    coverageMatches,
    requiredFlagsMatch,
  };
}

function buildCanonicalDomainChecks(outcomes) {
  const passes = [
    outcomes.blueprintValid,
    outcomes.domainCasesValid,
    outcomes.sourceAdmissionsExact,
    outcomes.agentIdMatch,
    outcomes.targetMatch,
    outcomes.requiredCovered,
    outcomes.thresholdsPass,
    outcomes.hardFailuresAbsent,
    outcomes.hardFailuresAbsent,
    outcomes.evaluatorProvenancePresent,
    outcomes.rubricProvenancePresent,
    outcomes.boundedEvidenceRefs,
    outcomes.noRawOrSecretEvidence,
  ];
  return DOMAIN_EVAL_REQUIRED_CHECK_IDS.map((id, index) => check(id, passes[index]));
}

function validChecks(value, expectedChecks) {
  return Array.isArray(value)
    && value.length === DOMAIN_EVAL_REQUIRED_CHECK_IDS.length
    && value.every((item, index) => hasExactKeys(item, ["id", "pass"])
      && item.id === DOMAIN_EVAL_REQUIRED_CHECK_IDS[index]
      && typeof item.pass === "boolean"
      && item.pass === expectedChecks[index].pass);
}

function canonicalCheckPass(checks, id) {
  const match = Array.isArray(checks) ? checks.find((item) => item?.id === id) : null;
  return match?.pass === true;
}

function disjointExhaustivePartition(required, covered, missing) {
  if (!sortedUniqueSafeIds(covered) || !sortedUniqueSafeIds(missing)) return false;
  const requiredSet = new Set(required);
  const coveredSet = new Set(covered);
  const missingSet = new Set(missing);
  return covered.every((item) => requiredSet.has(item) && !missingSet.has(item))
    && missing.every((item) => requiredSet.has(item) && !coveredSet.has(item))
    && required.every((item) => coveredSet.has(item) !== missingSet.has(item));
}

function sameStringArray(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((item, index) => item === right[index]);
}

function sameProvenance(left, right) {
  return left?.identity === right?.identity
    && left?.subject === right?.subject
    && left?.digest === right?.digest;
}

function validAudit(value) {
  return hasExactKeys(value, ["ok", "findingCount", "secretFindingCount", "rawFindingCount"])
    && value.ok === true
    && value.findingCount === 0
    && value.secretFindingCount === 0
    && value.rawFindingCount === 0;
}

function validValidationSummary(value) {
  return hasExactKeys(value, ["blueprintErrorCount", "blueprintWarningCount", "domainCasesErrorCount"])
    && [value.blueprintErrorCount, value.blueprintWarningCount, value.domainCasesErrorCount].every(nonNegativeInteger)
    && value.blueprintErrorCount === 0
    && value.domainCasesErrorCount === 0;
}

function validCertificationBoundary(value, ok) {
  return hasExactKeys(value, [
    "runtimeCertifiedByDomainEval",
    "domainCertifiedByDomainEval",
    "deliveryReadyByDomainEval",
    "productionApprovedByDomainEval",
  ])
    && value.runtimeCertifiedByDomainEval === false
    && value.domainCertifiedByDomainEval === ok
    && value.deliveryReadyByDomainEval === false
    && value.productionApprovedByDomainEval === false;
}

function blueprintTargetSet(blueprint) {
  return new Set([
    blueprint.runtime,
    ...asSafeIdArray(blueprint.pipeline?.produce?.runtime_targets),
    ...(Array.isArray(blueprint.runtime_profiles) ? blueprint.runtime_profiles.map((profile) => profile?.id).filter(safeId) : []),
  ].filter(safeId));
}

function targetMatchesBlueprint({ requestedTargetId, casesTargetId, effectiveTargetId, blueprintTargetIds }) {
  if (requestedTargetId !== null && !safeId(requestedTargetId)) return false;
  if (requestedTargetId !== null && requestedTargetId !== casesTargetId) return false;
  return blueprintTargetIds.has(effectiveTargetId);
}

function boundedEvidenceRef(value) {
  return boundedReference(value)
    && !/^(?:raw|prompt|transcript|stdout|stderr|tool-body|tool-output):/iu.test(value)
    && !/(?:^|[-_.:/])(?:raw-)?(?:prompt|transcript|stdout|stderr|tool-body|tool-output)(?:$|[-_.:/])/iu.test(value);
}

function boundedReference(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 512
    && !value.includes("\0")
    && !/^(?:file:|\/|[A-Za-z]:[\\/])/u.test(value);
}

function boundedString(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 160 && !value.includes("\0");
}

function boundedScore(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function safeId(value) {
  return typeof value === "string" && SAFE_ID_PATTERN.test(value);
}

function sortedUniqueSafeIds(value) {
  return Array.isArray(value) && value.every(safeId) && sortedUniqueStrings(value);
}

function sortedUniqueStrings(value) {
  return Array.isArray(value)
    && new Set(value).size === value.length
    && value.every((item, index) => typeof item === "string" && (index === 0 || value[index - 1] < item));
}

function asSafeIdArray(value) {
  return Array.isArray(value) ? value.filter(safeId) : [];
}

function uniqueSorted(values) {
  return Array.from(new Set(values)).sort();
}

function check(id, pass) {
  return { id, pass: Boolean(pass) };
}

function requireExactKeys(value, keys, error, errors) {
  if (!hasExactKeys(value, keys)) errors.push(error);
}

function hasExactKeys(value, keys) {
  if (!plainObject(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function plainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isSortedBy(values, key) {
  return values.every((value, index) => index === 0 || values[index - 1][key] < value[key]);
}

function validation(errors) {
  const uniqueErrors = Array.from(new Set(errors)).sort();
  return { ok: uniqueErrors.length === 0, errors: uniqueErrors };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function domainError(code) {
  const error = new Error("Domain evaluation artifact contract failed.");
  error.name = "AgentMoDomainEvalError";
  error.code = code;
  return error;
}
