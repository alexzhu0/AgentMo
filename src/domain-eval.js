import { readFile } from "node:fs/promises";
import { auditEvidence } from "./evidence-audit.js";
import { validateBlueprint } from "./blueprint.js";

export const DOMAIN_EVAL_SCHEMA_VERSION = "agentmo.domain-eval.v1";
export const DOMAIN_CASES_SCHEMA_VERSION = "agentmo.domain-cases.v1";

export async function loadDomainCases(filePath) {
  const raw = await readFile(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid domain-cases JSON ${filePath}: ${message}`);
  }
}

export function buildDomainEval(blueprint, domainCases, options = {}) {
  const validation = validateBlueprint(blueprint);
  const cases = normalizeCases(domainCases);
  const requiredCaseClasses = asStringArray(blueprint?.eval?.required_case_classes);
  const requiredClassSet = new Set(requiredCaseClasses);
  const threshold = resolveThreshold(domainCases, options);
  const casesAudit = auditEvidence(domainCases);
  const evaluator = normalizeEvaluator(domainCases);
  const rubric = normalizeRubric(domainCases, blueprint);
  const casesAgentId = resolveAgentId(domainCases);
  const requestedTargetId = options.target ?? null;
  const casesTargetId = resolveTargetId(domainCases);
  const effectiveTargetId = requestedTargetId ?? casesTargetId ?? blueprint?.runtime ?? null;
  const blueprintTargetIds = blueprintTargetSet(blueprint);

  const caseResults = cases.map((domainCase, index) => buildCaseResult(domainCase, index, threshold, requiredClassSet));
  const coveredClasses = uniqueSorted(caseResults.map((result) => result.caseClass).filter((caseClass) => requiredClassSet.has(caseClass)));
  const missingCaseClasses = requiredCaseClasses.filter((caseClass) => !coveredClasses.includes(caseClass));
  const requiredCaseResults = caseResults.filter((result) => requiredClassSet.has(result.caseClass));
  const hardFailures = caseResults.flatMap((result) => result.hardFailures.map((failure) => ({ caseId: result.caseId, failure })));
  const evidenceFailures = caseResults.flatMap((result) =>
    result.evidenceChecks.filter((item) => item.pass === false).map((item) => ({ caseId: result.caseId, message: item.message })),
  );

  const schemaOk = domainCases?.schemaVersion === DOMAIN_CASES_SCHEMA_VERSION;
  const requiredCovered = requiredCaseClasses.length > 0 && missingCaseClasses.length === 0;
  const caseThresholdsPass =
    requiredCovered &&
    requiredCaseResults.length > 0 &&
    requiredCaseResults.every((result) => result.required === true && result.passed === true && result.scorePass === true);
  const hardFailuresAbsent = hardFailures.length === 0;
  const evaluatorProvenancePresent = hasEvaluatorProvenance(evaluator);
  const rubricProvenancePresent = hasRubricProvenance(rubric);
  const boundedEvidenceRefs = requiredCaseResults.length > 0 && requiredCaseResults.every((result) => result.boundedEvidenceRefs === true) && evidenceFailures.length === 0;
  const noRawOrSecretEvidence = casesAudit.ok;
  const agentIdMatch = nonEmptyString(casesAgentId) && casesAgentId === blueprint?.agent_id;
  const targetMatch = targetMatchesBlueprint({ requestedTargetId, casesTargetId, effectiveTargetId, blueprintTargetIds });

  const checks = [
    check("blueprint_valid", validation.ok, validation.ok ? "blueprint validates" : "blueprint has validation errors"),
    check("cases_schema", schemaOk, `domain cases schema is ${DOMAIN_CASES_SCHEMA_VERSION}`),
    check("agent_id_match", agentIdMatch, "domain cases agentId matches blueprint agent_id"),
    check("target_match", targetMatch, "requested/domain-cases target is covered by the blueprint runtime targets"),
    check("required_case_classes_covered", requiredCovered, missingCaseClasses.length === 0 ? "all required case classes are covered" : `missing required case classes: ${missingCaseClasses.join(", ")}`),
    check("case_thresholds_pass", caseThresholdsPass, "each required case passed and met its threshold"),
    check("hard_failures_absent", hardFailuresAbsent, hardFailuresAbsent ? "no hard failures recorded" : `hard failures recorded: ${hardFailures.map((item) => `${item.caseId}:${item.failure}`).join(", ")}`),
    check("no_hard_failures", hardFailuresAbsent, hardFailuresAbsent ? "no hard failures recorded" : "hard failures recorded"),
    check("evaluator_provenance_present", evaluatorProvenancePresent, "evaluator identity and provenance are present"),
    check("rubric_provenance_present", rubricProvenancePresent, "rubric provenance is present"),
    check("bounded_evidence_refs", boundedEvidenceRefs, boundedEvidenceRefs ? "case evidence uses bounded refs" : "case evidence includes missing, raw, or unbounded refs"),
    check("bounded_safe_evidence", boundedEvidenceRefs, boundedEvidenceRefs ? "case evidence uses bounded refs" : "case evidence includes missing, raw, or unbounded refs"),
    check("no_raw_or_secret_evidence", noRawOrSecretEvidence, noRawOrSecretEvidence ? "domain cases contain no raw or secret-like evidence" : auditMessage(casesAudit)),
    check("managed_evidence_sanitized", casesAudit.secretFindings.length === 0, casesAudit.secretFindings.length === 0 ? "managed evidence contains no secret-like values" : `secret-like values found: ${casesAudit.secretFindings.map((finding) => finding.pointer).join(", ")}`),
  ];

  const ok = checks.every((item) => item.pass);
  return {
    schemaVersion: DOMAIN_EVAL_SCHEMA_VERSION,
    ok,
    agentId: blueprint?.agent_id ?? null,
    target: {
      requested: requestedTargetId,
      cases: casesTargetId,
      effective: effectiveTargetId,
    },
    requiredCaseClasses,
    coveredCaseClasses: coveredClasses,
    missingCaseClasses,
    threshold,
    evaluator,
    rubric,
    caseResults,
    checks,
    audit: summarizeAudit(casesAudit),
    validation: {
      ok: validation.ok,
      warnings: validation.warnings,
      errors: validation.errors,
    },
    domainCertifiedByDomainEval: ok,
    productionApprovedByDomainEval: false,
    certificationBoundary: {
      runtimeCertifiedByDomainEval: false,
      domainCertifiedByDomainEval: ok,
      productionApprovedByDomainEval: false,
    },
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
    "Certification: domain-eval does not certify runtime or production approval",
  ];
  for (const checkItem of report.checks) lines.push(`- ${checkItem.pass ? "PASS" : "FAIL"} ${checkItem.id}: ${checkItem.message}`);
  return `${lines.join("\n")}\n`;
}

function buildCaseResult(domainCase, index, defaultThreshold, requiredClassSet) {
  const caseClass = caseClassOf(domainCase);
  const caseId = nonEmptyString(domainCase?.id) ? domainCase.id : `case-${index + 1}`;
  const threshold = resolveCaseThreshold(domainCase, defaultThreshold);
  const score = resolveScore(domainCase);
  const passed = resolvePassed(domainCase, score, threshold);
  const hardFailures = collectHardFailures(domainCase);
  const evidence = collectEvidence(domainCase);
  const evidenceChecks = evidence.length === 0
    ? [check("evidence_refs_present", false, "case has no bounded evidence refs")]
    : evidence.map((item, evidenceIndex) => check(`evidence_ref_${evidenceIndex + 1}`, isBoundedEvidence(item), evidenceMessage(item)));
  const boundedEvidenceRefs = evidence.length > 0 && evidenceChecks.every((item) => item.pass);
  const checks = [
    check("case_class_present", nonEmptyString(caseClass), "case class is present"),
    check("case_passed", passed === true, "case is marked passed"),
    check("case_score_threshold", Number.isFinite(score) && Number.isFinite(threshold) && score >= threshold, "case score meets threshold"),
    check("case_hard_failures_absent", hardFailures.length === 0, "case has no hard failures"),
    check("case_bounded_evidence_refs", boundedEvidenceRefs, "case evidence uses bounded refs"),
  ];
  return {
    caseId,
    caseClass,
    required: requiredClassSet.has(caseClass),
    score,
    threshold,
    passed,
    scorePass: Number.isFinite(score) && Number.isFinite(threshold) && score >= threshold,
    hardFailures,
    evidenceRefs: evidence.map((item) => evidenceRef(item)).filter(nonEmptyString),
    boundedEvidenceRefs,
    checks,
    evidenceChecks,
  };
}

function normalizeCases(domainCases) {
  if (Array.isArray(domainCases)) return domainCases;
  if (Array.isArray(domainCases?.cases)) return domainCases.cases;
  return [];
}

function caseClassOf(domainCase) {
  return domainCase?.caseClass ?? domainCase?.case_class ?? domainCase?.class ?? domainCase?.taskClass ?? null;
}

function resolveAgentId(domainCases) {
  if (Array.isArray(domainCases)) return null;
  return domainCases?.agentId ?? domainCases?.agent_id ?? domainCases?.agent?.id ?? null;
}

function resolveTargetId(domainCases) {
  if (Array.isArray(domainCases)) return null;
  const target = domainCases?.target ?? domainCases?.targetId ?? domainCases?.target_id;
  if (typeof target === "string") return target;
  return target?.id ?? null;
}

function resolveThreshold(domainCases, options) {
  const candidates = [
    options.threshold,
    domainCases?.threshold,
    domainCases?.scoreThreshold,
    domainCases?.score_threshold,
    domainCases?.minimumScore,
    domainCases?.minimum_score,
    domainCases?.rubric?.threshold,
    domainCases?.rubric?.minimumScore,
    domainCases?.rubric?.minimum_score,
  ];
  for (const candidate of candidates) {
    const number = Number(candidate);
    if (Number.isFinite(number)) return number;
  }
  return 1;
}

function resolveCaseThreshold(domainCase, defaultThreshold) {
  const candidates = [domainCase?.threshold, domainCase?.scoreThreshold, domainCase?.score_threshold, domainCase?.minimumScore, domainCase?.minimum_score, defaultThreshold];
  for (const candidate of candidates) {
    const number = Number(candidate);
    if (Number.isFinite(number)) return number;
  }
  return 1;
}

function resolveScore(domainCase) {
  const candidates = [domainCase?.score, domainCase?.result?.score, domainCase?.evaluation?.score, domainCase?.rubric?.score];
  for (const candidate of candidates) {
    const number = Number(candidate);
    if (Number.isFinite(number)) return number;
  }
  return Number.NaN;
}

function resolvePassed(domainCase, score, threshold) {
  if (typeof domainCase?.passed === "boolean") return domainCase.passed;
  if (typeof domainCase?.pass === "boolean") return domainCase.pass;
  if (typeof domainCase?.result?.passed === "boolean") return domainCase.result.passed;
  const status = String(domainCase?.status ?? domainCase?.result?.status ?? "").toLowerCase();
  if (["pass", "passed", "ok", "success"].includes(status)) return true;
  if (["fail", "failed", "failure", "error"].includes(status)) return false;
  return Number.isFinite(score) && Number.isFinite(threshold) && score >= threshold;
}

function collectHardFailures(domainCase) {
  const values = [];
  if (Array.isArray(domainCase?.hardFailures)) values.push(...domainCase.hardFailures);
  if (Array.isArray(domainCase?.hard_failures)) values.push(...domainCase.hard_failures);
  if (domainCase?.hardFailure === true) values.push("hardFailure");
  if (typeof domainCase?.hardFailure === "string") values.push(domainCase.hardFailure);
  if (domainCase?.hard_failure === true) values.push("hard_failure");
  if (typeof domainCase?.hard_failure === "string") values.push(domainCase.hard_failure);
  return values.filter(nonEmptyString);
}

function collectEvidence(domainCase) {
  const evidence = [];
  if (Array.isArray(domainCase?.evidence)) evidence.push(...domainCase.evidence);
  if (Array.isArray(domainCase?.evidenceRefs)) evidence.push(...domainCase.evidenceRefs);
  if (Array.isArray(domainCase?.evidence_refs)) evidence.push(...domainCase.evidence_refs);
  if (nonEmptyString(domainCase?.evidenceRef)) evidence.push(domainCase.evidenceRef);
  if (nonEmptyString(domainCase?.evidence_ref)) evidence.push(domainCase.evidence_ref);
  return evidence;
}

function isBoundedEvidence(item) {
  const ref = evidenceRef(item);
  if (!nonEmptyString(ref)) return false;
  if (isUnboundedRef(ref)) return false;
  if (typeof item === "object" && item !== null) {
    const kind = String(item.type ?? item.kind ?? item.evidenceType ?? item.evidenceKind ?? "").toLowerCase();
    if (isRawKind(kind)) return false;
    return auditEvidence(item).secretFindings.length === 0 && auditEvidence(item).rawFindings.length === 0;
  }
  return auditEvidence(ref).ok;
}

function evidenceRef(item) {
  if (typeof item === "string") return item;
  if (!item || typeof item !== "object") return null;
  return item.ref ?? item.uri ?? item.factRef ?? item.fact_ref ?? item.sourceRef ?? item.source_ref ?? item.id ?? null;
}

function evidenceMessage(item) {
  const ref = evidenceRef(item);
  if (!nonEmptyString(ref)) return "evidence ref is missing";
  if (isUnboundedRef(ref)) return `evidence ref is raw or unbounded: ${ref}`;
  if (typeof item === "object" && item !== null) {
    const kind = String(item.type ?? item.kind ?? item.evidenceType ?? item.evidenceKind ?? "").toLowerCase();
    if (isRawKind(kind)) return `evidence kind is raw: ${kind}`;
    const audit = auditEvidence(item);
    if (!audit.ok) return auditMessage(audit);
  }
  return `bounded evidence ref: ${ref}`;
}

function isUnboundedRef(ref) {
  const value = ref.trim().toLowerCase();
  if (value.length === 0) return true;
  if (value.startsWith("raw:") || value.startsWith("transcript:") || value.startsWith("stdout:") || value.startsWith("stderr:")) return true;
  return ["raw-transcript", "raw-tool-body", "raw-output-preview", "stdout-preview", "stderr-preview"].some((marker) => value.includes(marker));
}

function isRawKind(kind) {
  return ["raw-transcript", "raw-transcripts", "raw-tool-body", "raw-tool-bodies", "raw-output-preview", "raw-output-previews", "raw-stdout-preview", "raw-stderr-preview"].includes(kind);
}

function normalizeEvaluator(domainCases) {
  const source = domainCases?.evaluator ?? domainCases?.evaluatedBy ?? domainCases?.evaluation?.evaluator ?? {};
  return {
    id: source.id ?? source.name ?? null,
    name: source.name ?? null,
    version: source.version ?? null,
    provenance: source.provenance ?? source.provenanceRef ?? source.source ?? source.sourceRef ?? null,
  };
}

function normalizeRubric(domainCases, blueprint) {
  const source = domainCases?.rubric ?? domainCases?.rubricProvenance ?? domainCases?.evaluation?.rubric ?? {};
  return {
    id: source.id ?? null,
    path: source.path ?? source.rubricPath ?? domainCases?.rubricPath ?? blueprint?.eval?.rubric_path ?? null,
    version: source.version ?? null,
    hash: source.hash ?? source.sha256 ?? null,
    provenance: source.provenance ?? source.provenanceRef ?? source.source ?? source.sourceRef ?? null,
  };
}

function hasEvaluatorProvenance(evaluator) {
  return nonEmptyString(evaluator?.id) && hasProvenance(evaluator?.provenance);
}

function hasRubricProvenance(rubric) {
  return (nonEmptyString(rubric?.path) || nonEmptyString(rubric?.id)) && (hasProvenance(rubric?.provenance) || nonEmptyString(rubric?.hash));
}

function hasProvenance(value) {
  if (nonEmptyString(value)) return true;
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return false;
}

function blueprintTargetSet(blueprint) {
  return new Set(
    [
      blueprint?.runtime,
      ...asStringArray(blueprint?.pipeline?.produce?.runtime_targets),
      ...(Array.isArray(blueprint?.runtime_profiles) ? blueprint.runtime_profiles.map((profile) => profile?.id) : []),
    ].filter(nonEmptyString),
  );
}

function targetMatchesBlueprint({ requestedTargetId, casesTargetId, effectiveTargetId, blueprintTargetIds }) {
  if (nonEmptyString(requestedTargetId) && nonEmptyString(casesTargetId) && requestedTargetId !== casesTargetId) return false;
  if (!nonEmptyString(effectiveTargetId)) return true;
  return blueprintTargetIds.has(effectiveTargetId);
}

function summarizeAudit(audit) {
  return {
    ok: audit.ok,
    secretFindingCount: audit.secretFindings.length,
    rawFindingCount: audit.rawFindings.length,
    findings: audit.findings.map((finding) => ({ kind: finding.kind, pointer: finding.pointer, message: finding.message })),
  };
}

function auditMessage(audit) {
  const raw = audit.rawFindings.map((finding) => finding.pointer);
  const secret = audit.secretFindings.map((finding) => finding.pointer);
  const parts = [];
  if (raw.length > 0) parts.push(`raw evidence markers found: ${raw.join(", ")}`);
  if (secret.length > 0) parts.push(`secret-like values found: ${secret.join(", ")}`);
  return parts.join("; ") || "evidence audit failed";
}

function asStringArray(value) {
  return Array.isArray(value) ? value.filter(nonEmptyString) : [];
}

function uniqueSorted(values) {
  return Array.from(new Set(values)).sort();
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function check(id, pass, message) {
  return { id, pass: Boolean(pass), message };
}
