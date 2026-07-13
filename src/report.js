import { summarizeBlueprint, validateBlueprint } from "./blueprint.js";
import { summarizeDiscoveryManifest, validateDiscoveryManifest } from "./discovery.js";
import { assertPersistable } from "./persistability.js";

export const REPORT_KIND = "agentmo_report";
export const REPORT_VERSION = "0.1";

const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const PIPELINE_PHASES = ["discover", "plan", "produce"];

export async function buildAgentMoReport(blueprint, options = {}) {
  const { admittedArtifactProvenance } = await import("./artifact-admission.js");
  const blueprintSource = admittedArtifactProvenance(options.admissions?.blueprint ?? options.admission, {
    subject: "blueprint",
    value: blueprint,
  });
  const assessment = buildBlueprintAssessment(blueprint);
  const discovery = buildDiscoverySection(blueprint, options, admittedArtifactProvenance);
  const report = {
    kind: REPORT_KIND,
    version: REPORT_VERSION,
    ok: assessment.validation.ok && discovery.ok !== false,
    sources: {
      blueprint: blueprintSource,
      discoveryManifest: discovery.source,
    },
    summary: assessment.summary,
    produceMaturity: assessment.produceMaturity,
    gates: assessment.gates,
    releaseReadiness: {
      status: "not_evaluated",
      reason: "Blueprint validation does not establish delivery or production approval.",
      productionApproved: false,
    },
    runtimeCertification: assessment.runtimeCertification,
    discovery: {
      declared: discovery.declared,
      supplied: discovery.supplied,
      ok: discovery.ok,
      sourceCount: discovery.sourceCount,
      sourceTypes: discovery.sourceTypes,
      agentIdMatch: discovery.agentIdMatch,
    },
    evidenceLevels: emptyEvidenceLevels(),
    warnings: [...assessment.validation.warnings, ...discovery.warnings],
    errors: [...assessment.validation.errors, ...discovery.errors],
    certificationBoundary: {
      runtimeCertifiedByReport: false,
      domainCertifiedByReport: false,
      deliveryReadyByReport: false,
      productionApprovedByReport: false,
    },
  };
  assertReportCandidate(report);
  return report;
}

export function buildBlueprintAssessment(blueprint) {
  const validation = validateBlueprint(blueprint);
  const sourceSummary = summarizeBlueprint(blueprint);
  const gateItems = validation.gates.map((gate) => ({ id: gate.id, label: gate.label, status: gate.status }));
  return {
    validation,
    summary: {
      agentId: sourceSummary.agent_id ?? null,
      runtime: sourceSummary.runtime ?? null,
      runtimeProfiles: stringArrayOrEmpty(sourceSummary.runtime_profiles),
      status: sourceSummary.status ?? null,
      domain: sourceSummary.domain ?? null,
      pipelinePhases: stringArrayOrEmpty(sourceSummary.pipeline_phases),
      mainAgent: sourceSummary.main_agent ?? null,
      specialistCount: sourceSummary.specialist_count ?? 0,
      toolCount: sourceSummary.tool_count ?? 0,
      evalCaseClasses: stringArrayOrEmpty(sourceSummary.eval_case_classes),
      mechanismValid: validation.ok,
    },
    produceMaturity: inferProduceMaturity(blueprint, validation),
    gates: {
      passed: gateItems.filter((gate) => gate.status === "pass").length,
      failed: gateItems.filter((gate) => gate.status === "fail").length,
      items: gateItems,
    },
    runtimeCertification: summarizeRuntimeDisclosure(blueprint),
  };
}

export function validateReportArtifact(report) {
  const errors = [];
  try {
    assertPersistable(report, { subject: "report" });
  } catch {
    return { ok: false, errors: ["unsafe_report"] };
  }
  requireExactKeys(report, [
    "kind", "version", "ok", "sources", "summary", "produceMaturity", "gates", "releaseReadiness",
    "runtimeCertification", "discovery", "evidenceLevels", "warnings", "errors", "certificationBoundary",
  ], "report", errors);
  if (report?.kind !== REPORT_KIND || report?.version !== REPORT_VERSION) errors.push("invalid_identity");
  if (typeof report?.ok !== "boolean") errors.push("invalid_ok");
  if (!validSources(report?.sources)) errors.push("invalid_sources");
  if (!validSummary(report?.summary, report?.sources?.blueprint)) errors.push("invalid_summary");
  if (!validMaturity(report?.produceMaturity)) errors.push("invalid_maturity");
  if (!validGates(report?.gates)) errors.push("invalid_gates");
  if (!validReleaseReadiness(report?.releaseReadiness)) errors.push("invalid_release_readiness");
  if (!validRuntimeCertification(report?.runtimeCertification)) errors.push("invalid_runtime_certification");
  if (!validDiscovery(report?.discovery, report?.sources?.discoveryManifest)) errors.push("invalid_discovery");
  if (!validEvidenceLevels(report?.evidenceLevels, { domainCertified: false })) errors.push("invalid_evidence_levels");
  if (!stringArray(report?.warnings) || !stringArray(report?.errors)) errors.push("invalid_diagnostics");
  if (!hasExactFalseFields(report?.certificationBoundary, [
    "runtimeCertifiedByReport", "domainCertifiedByReport", "deliveryReadyByReport", "productionApprovedByReport",
  ])) errors.push("invalid_certification_boundary");
  return { ok: errors.length === 0, errors };
}

export function validateAgentMoReport(report, options = {}) {
  if (options.legacy === true || options.legacyCanonical === true) {
    return validateLegacyCompatibleReport(report, options);
  }
  return validateReportArtifact(report);
}

export function formatAgentMoReport(report) {
  const lines = [
    `AgentMo report: ${report.summary.agentId ?? "unknown"}`,
    `Status: ${report.summary.status ?? "unknown"}`,
    `Runtime: ${report.summary.runtime ?? "unknown"}`,
    `Runtime profiles: ${report.summary.runtimeProfiles.join(", ") || "none"}`,
    `Domain: ${report.summary.domain ?? "unknown"}`,
    `Pipeline: ${report.summary.pipelinePhases.join(" -> ") || "unknown"}`,
    `Produce maturity: ${report.produceMaturity.stage} (${report.produceMaturity.reason})`,
    `Quality gates: ${report.gates.passed} passed, ${report.gates.failed} failed`,
    `Release readiness: ${report.releaseReadiness.status}`,
  ];
  if (report.runtimeCertification.length > 0) {
    lines.push("", "Runtime evidence disclosure:");
    for (const profile of report.runtimeCertification) {
      lines.push(`- ${profile.id ?? "unknown"}: ${profile.evidenceDisclosure}; certifies runtime: no`);
    }
  }
  if (report.discovery.declared || report.discovery.supplied) {
    lines.push("", "Discovery:");
    lines.push(`- supplied: ${report.discovery.supplied ? "yes" : "no"}; sources: ${report.discovery.sourceCount}`);
  }
  for (const gate of report.gates.items) lines.push(`- ${gate.status.toUpperCase()} ${gate.id}: ${gate.label}`);
  if (report.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const warning of report.warnings) lines.push(`- ${warning}`);
  }
  if (report.errors.length > 0) {
    lines.push("", "Errors:");
    for (const error of report.errors) lines.push(`- ${error}`);
  }
  return `${lines.join("\n")}\n`;
}

function buildDiscoverySection(blueprint, options, admittedArtifactProvenance) {
  const declared = typeof blueprint?.discovery_manifest_path === "string" && blueprint.discovery_manifest_path.trim().length > 0;
  const manifest = options.discoveryManifest ?? null;
  const admission = options.admissions?.discoveryManifest ?? null;
  if (manifest === null) {
    if (admission !== null) throw reportError("AGENTMO_REPORT_DISCOVERY_INPUT_INVALID");
    return {
      declared,
      supplied: false,
      ok: null,
      source: null,
      sourceCount: 0,
      sourceTypes: [],
      agentIdMatch: null,
      warnings: declared ? ["A discovery manifest is declared but was not supplied as exact report evidence."] : [],
      errors: [],
    };
  }
  const source = admittedArtifactProvenance(admission, { subject: "discovery-manifest", value: manifest });
  const validation = validateDiscoveryManifest(manifest);
  const summary = summarizeDiscoveryManifest(manifest);
  const agentIdMatch = manifest.agent_id === blueprint.agent_id;
  return {
    declared,
    supplied: true,
    ok: validation.ok && agentIdMatch,
    source,
    sourceCount: summary.source_count ?? 0,
    sourceTypes: stringArrayOrEmpty(summary.source_types),
    agentIdMatch,
    warnings: validation.warnings,
    errors: [
      ...validation.errors,
      ...(agentIdMatch ? [] : ["Discovery manifest agent id does not match the blueprint."]),
    ],
  };
}

function summarizeRuntimeDisclosure(blueprint) {
  if (!Array.isArray(blueprint?.runtime_profiles)) return [];
  return blueprint.runtime_profiles.filter(plainObject).map((profile) => {
    const verificationCommandCount = stringArrayOrEmpty(profile.verification_commands).length;
    const unsupportedSurfaceCount = stringArrayOrEmpty(profile.unsupported_surfaces).length;
    return {
      id: typeof profile.id === "string" ? profile.id : null,
      declaredStatus: typeof profile.status === "string" ? profile.status : null,
      evidenceDisclosure: verificationCommandCount > 0 && unsupportedSurfaceCount > 0
        ? "evidence_disclosed"
        : "needs_disclosure",
      verificationCommandCount,
      unsupportedSurfaceCount,
      certifiesRuntime: false,
    };
  });
}

function inferProduceMaturity(blueprint, validation) {
  if (!validation.ok) return { stage: "blocked", reason: "blueprint validation failed" };
  const stages = {
    draft: ["conceive", "draft blueprint exists"],
    gestating: ["gestate", "domain genome is being shaped"],
    born: ["birth", "runtime scaffold is declared"],
    training: ["train", "eval suite is declared active"],
    certified: ["certify", "blueprint declares quality gates satisfied"],
    released: ["release", "blueprint declares release evidence recorded"],
    deprecated: ["retired", "agent is no longer active"],
  };
  const [stage, reason] = stages[blueprint.status] ?? ["unknown", "unrecognized Produce maturity status"];
  return { stage, reason };
}

function validateLegacyCompatibleReport(report, options) {
  const errors = [];
  const legacy = options.legacy === true;
  const maturityField = legacy ? "lifecycle" : "produce_maturity";
  const conflicting = legacy ? "produce_maturity" : "lifecycle";
  if (!plainObject(report)) return { ok: false, errors: ["report_not_object"] };
  if (report.kind !== (legacy ? "agentmother_report" : REPORT_KIND)) errors.push("invalid_identity");
  if (report.version !== REPORT_VERSION) errors.push("invalid_version");
  if (typeof report.ok !== "boolean") errors.push("invalid_ok");
  if (!plainObject(report.summary) || report.summary.ok !== report.ok) errors.push("invalid_summary");
  if (!validMaturity(report[maturityField])) errors.push("invalid_maturity");
  if (Object.hasOwn(report, conflicting)) errors.push("conflicting_maturity");
  if (!validGates(report.gates)) errors.push("invalid_gates");
  if (!plainObject(report.release_readiness) || !nonEmptyString(report.release_readiness.status) || !nonEmptyString(report.release_readiness.reason)) errors.push("invalid_release_readiness");
  if (!Array.isArray(report.runtime_certification) || report.runtime_certification.some((item) => !plainObject(item))) errors.push("invalid_runtime_certification");
  if (!plainObject(report.discovery)) errors.push("invalid_discovery");
  if (!stringArray(report.warnings) || !stringArray(report.errors)) errors.push("invalid_diagnostics");
  return { ok: errors.length === 0, errors };
}

function validSources(value) {
  return hasExactKeys(value, ["blueprint", "discoveryManifest"])
    && validProvenance(value.blueprint, "blueprint", "0.1")
    && (value.discoveryManifest === null || validProvenance(value.discoveryManifest, "discovery-manifest", "agentmo.discovery.v1"));
}

function validSummary(value) {
  return hasExactKeys(value, [
    "agentId", "runtime", "runtimeProfiles", "status", "domain", "pipelinePhases", "mainAgent",
    "specialistCount", "toolCount", "evalCaseClasses", "mechanismValid",
  ])
    && nonEmptyString(value.agentId)
    && nonEmptyString(value.runtime)
    && stringArray(value.runtimeProfiles)
    && nonEmptyString(value.status)
    && nonEmptyString(value.domain)
    && stringArray(value.pipelinePhases)
    && value.pipelinePhases.length === PIPELINE_PHASES.length
    && value.pipelinePhases.every((phase, index) => phase === PIPELINE_PHASES[index])
    && nonEmptyString(value.mainAgent)
    && nonNegativeInteger(value.specialistCount)
    && nonNegativeInteger(value.toolCount)
    && stringArray(value.evalCaseClasses)
    && value.mechanismValid === true;
}

function validMaturity(value) {
  return hasExactKeys(value, ["stage", "reason"]) && nonEmptyString(value.stage) && nonEmptyString(value.reason);
}

function validGates(value) {
  if (!hasExactKeys(value, ["passed", "failed", "items"]) || !nonNegativeInteger(value.passed) || !nonNegativeInteger(value.failed) || !Array.isArray(value.items)) return false;
  if (!value.items.every((item) => hasExactKeys(item, ["id", "label", "status"])
    && nonEmptyString(item.id) && nonEmptyString(item.label) && ["pass", "fail"].includes(item.status))) return false;
  return value.passed === value.items.filter((item) => item.status === "pass").length
    && value.failed === value.items.filter((item) => item.status === "fail").length;
}

function validReleaseReadiness(value) {
  return hasExactKeys(value, ["status", "reason", "productionApproved"])
    && value.status === "not_evaluated"
    && nonEmptyString(value.reason)
    && value.productionApproved === false;
}

function validRuntimeCertification(value) {
  return Array.isArray(value) && value.every((item) => hasExactKeys(item, [
    "id", "declaredStatus", "evidenceDisclosure", "verificationCommandCount", "unsupportedSurfaceCount", "certifiesRuntime",
  ])
    && nullableString(item.id)
    && nullableString(item.declaredStatus)
    && ["evidence_disclosed", "needs_disclosure"].includes(item.evidenceDisclosure)
    && nonNegativeInteger(item.verificationCommandCount)
    && nonNegativeInteger(item.unsupportedSurfaceCount)
    && item.certifiesRuntime === false);
}

function validDiscovery(value, source) {
  return hasExactKeys(value, ["declared", "supplied", "ok", "sourceCount", "sourceTypes", "agentIdMatch"])
    && typeof value.declared === "boolean"
    && value.supplied === (source !== null)
    && (value.ok === null || typeof value.ok === "boolean")
    && nonNegativeInteger(value.sourceCount)
    && stringArray(value.sourceTypes)
    && (value.agentIdMatch === null || typeof value.agentIdMatch === "boolean")
    && (value.supplied || (value.ok === null && value.sourceCount === 0 && value.agentIdMatch === null));
}

function emptyEvidenceLevels() {
  return {
    declaredReady: false,
    liveSuccess: false,
    domainCertified: false,
    deliveryReady: false,
    productionApproved: false,
  };
}

function validEvidenceLevels(value, expectations) {
  return hasExactKeys(value, ["declaredReady", "liveSuccess", "domainCertified", "deliveryReady", "productionApproved"])
    && value.declaredReady === false
    && value.liveSuccess === false
    && value.domainCertified === expectations.domainCertified
    && value.deliveryReady === false
    && value.productionApproved === false;
}

function hasExactFalseFields(value, keys) {
  return hasExactKeys(value, keys) && keys.every((key) => value[key] === false);
}

function validProvenance(value, subject, identity) {
  return hasExactKeys(value, ["identity", "subject", "digest"])
    && value.identity === identity
    && value.subject === subject
    && SHA256_DIGEST_PATTERN.test(value.digest);
}

function assertReportCandidate(report) {
  assertPersistable(report, { subject: "report" });
  if (!validateReportArtifact(report).ok) throw reportError("AGENTMO_REPORT_INVALID");
}

function requireExactKeys(value, keys, label, errors) {
  if (!hasExactKeys(value, keys)) errors.push(`${label}_fields_invalid`);
}

function hasExactKeys(value, keys) {
  if (!plainObject(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function plainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function nullableString(value) {
  return value === null || typeof value === "string";
}

function stringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function stringArrayOrEmpty(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function reportError(code) {
  const error = new Error("Report artifact operation failed.");
  error.code = code;
  return error;
}
