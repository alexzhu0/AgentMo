import { containsSecretLikeValue } from "./secret-redaction.js";

export const AGENTMO_PRODUCT_NAME = "AgentMo";
export const BLUEPRINT_IDENTITY_FIELD = "agentmo_version";
export const BLUEPRINT_SCHEMA_VERSION = "0.1";
export const CANONICAL_PIPELINE_PHASES = Object.freeze(["discover", "plan", "produce"]);
export const DESIGN_CONTRACT_VERSION = "agentmo.design-contract.v1";
export const TRANSITIONAL_BLUEPRINT_LOADER_CONSUMERS = Object.freeze({});

export const REQUIRED_TOP_LEVEL_FIELDS = [
  BLUEPRINT_IDENTITY_FIELD,
  "agent_id",
  "runtime",
  "status",
  "domain_genome",
  "pipeline",
  "architecture",
  "tools",
  "evidence",
  "eval",
  "governance",
  "release",
];

export const QUALITY_GATES = [
  {
    id: "domain_genome_defined",
    label: "Domain genome defined",
    check: (blueprint) =>
      isObject(blueprint.domain_genome) &&
      nonEmptyString(blueprint.domain_genome.domain) &&
      nonEmptyString(blueprint.domain_genome.purpose) &&
      nonEmptyArray(blueprint.domain_genome.task_classes),
  },
  {
    id: "pipeline_defined",
    label: "Discover-plan-produce pipeline defined",
    check: (blueprint) =>
      isObject(blueprint.pipeline) &&
      hasExactPipelinePhases(blueprint.pipeline) &&
      isObject(blueprint.pipeline.discover) &&
      isObject(blueprint.pipeline.plan) &&
      isObject(blueprint.pipeline.produce) &&
      nonEmptyArray(blueprint.pipeline.discover.data_sources) &&
      nonEmptyArray(blueprint.pipeline.discover.database_outputs) &&
      nonEmptyArray(blueprint.pipeline.plan.planning_outputs) &&
      nonEmptyArray(blueprint.pipeline.produce.coding_tools) &&
      nonEmptyArray(blueprint.pipeline.produce.generated_outputs),
  },
  {
    id: "architecture_defined",
    label: "Agent architecture defined",
    check: (blueprint) =>
      isObject(blueprint.architecture) &&
      nonEmptyString(blueprint.architecture.main_agent) &&
      Array.isArray(blueprint.architecture.routing_modes),
  },
  {
    id: "tool_contracts_defined",
    label: "Tool contracts defined",
    check: (blueprint) => Array.isArray(blueprint.tools) && blueprint.tools.length > 0 && blueprint.tools.every(isValidTool),
  },
  {
    id: "evidence_store_defined",
    label: "Evidence store defined",
    check: (blueprint) =>
      isObject(blueprint.evidence) &&
      nonEmptyArray(blueprint.evidence.stores) &&
      nonEmptyArray(blueprint.evidence.required_artifacts),
  },
  {
    id: "eval_suite_defined",
    label: "Eval suite defined",
    check: (blueprint) =>
      isObject(blueprint.eval) &&
      nonEmptyString(blueprint.eval.cases_path) &&
      nonEmptyString(blueprint.eval.rubric_path) &&
      nonEmptyArray(blueprint.eval.required_case_classes),
  },
  {
    id: "governance_defined",
    label: "Governance policy defined",
    check: (blueprint) =>
      isObject(blueprint.governance) &&
      nonEmptyArray(blueprint.governance.policies) &&
      nonEmptyArray(blueprint.governance.quality_gates),
  },
  {
    id: "release_trace_defined",
    label: "Release trace defined",
    check: (blueprint) =>
      isObject(blueprint.release) &&
      Array.isArray(blueprint.release.known_risks) &&
      (nonEmptyString(blueprint.release.latest_commit) || nonEmptyString(blueprint.release.release_ledger_path)),
  },
];

const VALID_STATUSES = new Set(["draft", "gestating", "born", "training", "certified", "released", "deprecated"]);
const VALID_RUNTIMES = new Set(["pi", "openclaw", "codex", "agentharness", "external"]);
const VALID_RUNTIME_PROFILE_ROLES = new Set(["primary", "alternate", "legacy", "migration_source", "governance", "builder"]);
const VALID_RUNTIME_PROFILE_STATUSES = new Set(["active", "planned", "legacy", "experimental", "deprecated"]);
const VALID_DESIGN_CONTRACT_SOURCES = new Set(["agentmo-stage2", "external-reviewed"]);
const DESIGN_CONTRACT_PROVENANCE_NOTE_MAX_LENGTH = 500;
const RUNTIME_CERTIFICATION_ARRAY_FIELDS = [
  "supported_assets",
  "unsupported_surfaces",
  "verification_commands",
  "risk_notes",
];

export async function loadAdmittedBlueprint(filePath, options = {}) {
  if (options.subject !== "blueprint") {
    const { AgentMoUnsupportedArtifactError } = await import("./artifact-registry.js");
    throw new AgentMoUnsupportedArtifactError("subject_identity_mismatch");
  }
  const { loadAdmittedArtifact } = await import("./artifact-admission.js");
  return loadAdmittedArtifact({
    filePath,
    subject: "blueprint",
    expectedDigest: options.expectedDigest,
    maxBytes: options.maxBytes,
    openInput: options.openInput,
  });
}

export function validateBlueprint(blueprint) {
  const errors = [];
  const warnings = [];

  if (!isObject(blueprint)) {
    return { ok: false, errors: ["Blueprint must be a JSON object."], warnings, gates: [] };
  }

  for (const field of REQUIRED_TOP_LEVEL_FIELDS) {
    if (!(field in blueprint)) errors.push(`Missing required field: ${field}`);
  }

  if (blueprint[BLUEPRINT_IDENTITY_FIELD] !== BLUEPRINT_SCHEMA_VERSION) {
    errors.push(`${BLUEPRINT_IDENTITY_FIELD} must be ${BLUEPRINT_SCHEMA_VERSION}`);
  }

  if (!nonEmptyString(blueprint.agent_id)) {
    errors.push("agent_id must be a non-empty string.");
  } else if (!/^[a-z][a-z0-9-]*$/u.test(blueprint.agent_id)) {
    errors.push("agent_id must use lowercase kebab-case, starting with a letter.");
  }

  validateDiscoveryManifestPath(blueprint, errors);
  validateDesignContract(blueprint.design_contract, errors);

  if (!VALID_RUNTIMES.has(blueprint.runtime)) {
    errors.push(`runtime must be one of: ${Array.from(VALID_RUNTIMES).join(", ")}`);
  }

  if (!VALID_STATUSES.has(blueprint.status)) {
    errors.push(`status must be one of: ${Array.from(VALID_STATUSES).join(", ")}`);
  }

  validateDomainGenome(blueprint.domain_genome, errors);
  validatePipeline(blueprint.pipeline, errors);
  validateRuntimeProfiles(blueprint, errors, warnings);
  validateArchitecture(blueprint.architecture, errors, warnings);
  validateTools(blueprint.tools, errors);
  validateEvidence(blueprint.evidence, errors);
  validateEval(blueprint.eval, errors);
  validateGovernance(blueprint.governance, errors, warnings);
  validateRelease(blueprint.release, errors, warnings);

  const gates = evaluateQualityGates(blueprint);
  const failedRequiredGates = gates.filter((gate) => gate.status === "fail");
  if (failedRequiredGates.length > 0) {
    for (const gate of failedRequiredGates) {
      errors.push(`Quality gate failed: ${gate.id}`);
    }
  }

  return { ok: errors.length === 0, errors, warnings, gates };
}

export function evaluateQualityGates(blueprint) {
  return QUALITY_GATES.map((gate) => ({
    id: gate.id,
    label: gate.label,
    status: safeCheck(gate.check, blueprint) ? "pass" : "fail",
  }));
}

export function summarizeBlueprint(blueprint) {
  const validation = validateBlueprint(blueprint);
  const specialistCount = Array.isArray(blueprint.architecture?.specialists)
    ? blueprint.architecture.specialists.length
    : 0;
  return {
    agent_id: blueprint.agent_id,
    runtime: blueprint.runtime,
    runtime_profiles: Array.isArray(blueprint.runtime_profiles)
      ? blueprint.runtime_profiles.map((profile) => profile.id).filter((id) => typeof id === "string")
      : [],
    runtime_certification: summarizeRuntimeCertification(blueprint),
    discovery_manifest_path: nonEmptyString(blueprint.discovery_manifest_path)
      ? blueprint.discovery_manifest_path
      : null,
    status: blueprint.status,
    domain: blueprint.domain_genome?.domain,
    pipeline_phases: summarizePipelinePhases(blueprint.pipeline),
    main_agent: blueprint.architecture?.main_agent,
    specialist_count: specialistCount,
    tool_count: Array.isArray(blueprint.tools) ? blueprint.tools.length : 0,
    eval_case_classes: Array.isArray(blueprint.eval?.required_case_classes)
      ? blueprint.eval.required_case_classes
      : [],
    quality_gates: validation.gates,
    ok: validation.ok,
  };
}

function validatePipeline(value, errors) {
  if (!isObject(value)) {
    errors.push("pipeline must be an object.");
    return;
  }

  if (!hasExactPipelinePhases(value)) {
    errors.push(`pipeline must contain exactly these phases: ${CANONICAL_PIPELINE_PHASES.join(", ")}.`);
  }

  validateDiscoverPhase(value.discover, errors);
  validatePlanPhase(value.plan, errors);
  validateProducePhase(value.produce, errors);
}

function validateDiscoverPhase(value, errors) {
  if (!isObject(value)) {
    errors.push("pipeline.discover must be an object.");
    return;
  }
  requireString(value, "pipeline.discover.purpose", errors);
  requireStringArray(value, "pipeline.discover.data_sources", errors);
  requireStringArray(value, "pipeline.discover.database_outputs", errors);
  requireStringArray(value, "pipeline.discover.user_need_inputs", errors);
  requireStringArray(value, "pipeline.discover.done_when", errors);
}

function validatePlanPhase(value, errors) {
  if (!isObject(value)) {
    errors.push("pipeline.plan must be an object.");
    return;
  }
  requireString(value, "pipeline.plan.purpose", errors);
  requireStringArray(value, "pipeline.plan.planning_inputs", errors);
  requireStringArray(value, "pipeline.plan.planning_outputs", errors);
  requireStringArray(value, "pipeline.plan.decision_gates", errors);
  requireStringArray(value, "pipeline.plan.done_when", errors);
}

function validateProducePhase(value, errors) {
  if (!isObject(value)) {
    errors.push("pipeline.produce must be an object.");
    return;
  }
  requireString(value, "pipeline.produce.purpose", errors);
  requireStringArray(value, "pipeline.produce.coding_tools", errors);
  requireStringArray(value, "pipeline.produce.runtime_targets", errors);
  requireStringArray(value, "pipeline.produce.generated_outputs", errors);
  requireStringArray(value, "pipeline.produce.verification_steps", errors);
  requireStringArray(value, "pipeline.produce.done_when", errors);
}

function summarizePipelinePhases(value) {
  if (!isObject(value)) return [];
  return CANONICAL_PIPELINE_PHASES.filter((phase) => isObject(value[phase]));
}

function hasExactPipelinePhases(value) {
  if (!isObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length === CANONICAL_PIPELINE_PHASES.length && CANONICAL_PIPELINE_PHASES.every((phase) => keys.includes(phase));
}

function validateRuntimeProfiles(blueprint, errors, warnings) {
  const value = blueprint.runtime_profiles;
  if (value === undefined) {
    warnings.push("runtime_profiles is not set; AgentMo can model multiple runtime architectures such as pi and openclaw.");
    return;
  }
  if (!Array.isArray(value)) {
    errors.push("runtime_profiles must be an array when provided.");
    return;
  }

  const ids = new Set();
  let hasPrimaryRuntimeProfile = false;
  for (const [index, profile] of value.entries()) {
    if (!isObject(profile)) {
      errors.push(`runtime_profiles[${index}] must be an object.`);
      continue;
    }

    requireString(profile, `runtime_profiles[${index}].id`, errors);
    requireString(profile, `runtime_profiles[${index}].role`, errors);
    requireString(profile, `runtime_profiles[${index}].status`, errors);
    requireString(profile, `runtime_profiles[${index}].purpose`, errors);
    requireStringArray(profile, `runtime_profiles[${index}].owned_surfaces`, errors);
    requireStringArray(profile, `runtime_profiles[${index}].evidence_boundaries`, errors);
    optionalStringArray(profile, `runtime_profiles[${index}].source_refs`, errors);
    optionalStringArray(profile, `runtime_profiles[${index}].transfer_rules`, errors);
    for (const field of RUNTIME_CERTIFICATION_ARRAY_FIELDS) {
      optionalStringArray(profile, `runtime_profiles[${index}].${field}`, errors);
    }
    optionalString(profile, `runtime_profiles[${index}].install_or_onramp`, errors);
    optionalString(profile, `runtime_profiles[${index}].owner`, errors);
    optionalIsoLikeDateString(profile, `runtime_profiles[${index}].last_verified_at`, errors);

    if (typeof profile.id === "string") {
      if (!VALID_RUNTIMES.has(profile.id)) {
        errors.push(`runtime_profiles[${index}].id must be one of: ${Array.from(VALID_RUNTIMES).join(", ")}`);
      }
      if (ids.has(profile.id)) errors.push(`runtime_profiles[${index}].id duplicates runtime profile ${profile.id}.`);
      ids.add(profile.id);
      if (profile.id === blueprint.runtime) hasPrimaryRuntimeProfile = true;
    }

    if (typeof profile.role === "string" && !VALID_RUNTIME_PROFILE_ROLES.has(profile.role)) {
      errors.push(
        `runtime_profiles[${index}].role must be one of: ${Array.from(VALID_RUNTIME_PROFILE_ROLES).join(", ")}`,
      );
    }
    if (typeof profile.status === "string" && !VALID_RUNTIME_PROFILE_STATUSES.has(profile.status)) {
      errors.push(
        `runtime_profiles[${index}].status must be one of: ${Array.from(VALID_RUNTIME_PROFILE_STATUSES).join(", ")}`,
      );
    }

    if (profile.status === "active" && (profile.role === "alternate" || profile.id === blueprint.runtime)) {
      if (!nonEmptyArray(profile.verification_commands)) {
        warnings.push(`runtime_profiles[${index}] (${profile.id ?? "unknown"}) is active but lacks verification_commands.`);
      }
      if (!nonEmptyArray(profile.unsupported_surfaces)) {
        warnings.push(`runtime_profiles[${index}] (${profile.id ?? "unknown"}) is active but lacks unsupported_surfaces disclosure.`);
      }
    }
  }

  if (value.length > 0 && !hasPrimaryRuntimeProfile) {
    errors.push(`runtime_profiles must include the primary runtime: ${blueprint.runtime}`);
  }
}

function validateDiscoveryManifestPath(blueprint, errors) {
  if (!("discovery_manifest_path" in blueprint)) return;
  if (!nonEmptyString(blueprint.discovery_manifest_path)) {
    errors.push("discovery_manifest_path must be a non-empty string when provided.");
  }
}

function validateDesignContract(value, errors) {
  if (value === undefined) return;
  if (!isObject(value)) {
    errors.push("design_contract must be an object when provided.");
    return;
  }

  validateDesignContractProvenance(value.provenance, errors);
}

function validateDesignContractProvenance(value, errors) {
  if (!isObject(value)) {
    errors.push("design_contract.provenance must be an object when design_contract is provided.");
    return;
  }

  if (!VALID_DESIGN_CONTRACT_SOURCES.has(value.source)) {
    errors.push(`design_contract.provenance.source must be one of: ${Array.from(VALID_DESIGN_CONTRACT_SOURCES).join(", ")}`);
  }
  if (typeof value.reviewed !== "boolean") {
    errors.push("design_contract.provenance.reviewed must be a boolean.");
  }
  if (value.source === "external-reviewed" && value.reviewed !== true) {
    errors.push("design_contract.provenance.reviewed must be true for external-reviewed designs.");
  }
  if ("review_ref" in value) optionalString(value, "design_contract.provenance.review_ref", errors);
  if (value.contract_version !== DESIGN_CONTRACT_VERSION) {
    errors.push(`design_contract.provenance.contract_version must be ${DESIGN_CONTRACT_VERSION}`);
  }
  requireString(value, "design_contract.provenance.notes", errors);
  if (typeof value.notes === "string" && value.notes.length > DESIGN_CONTRACT_PROVENANCE_NOTE_MAX_LENGTH) {
    errors.push(
      `design_contract.provenance.notes must be ${DESIGN_CONTRACT_PROVENANCE_NOTE_MAX_LENGTH} characters or fewer.`,
    );
  }

  const secretFindings = collectSecretLikeStringFindings(value, "design_contract.provenance");
  if (secretFindings.length > 0) {
    errors.push(`design_contract.provenance must not contain secret-like string values: ${secretFindings.join(", ")}`);
  }
}

function summarizeRuntimeCertification(blueprint) {
  if (!Array.isArray(blueprint.runtime_profiles)) return [];
  return blueprint.runtime_profiles.filter(isObject).map((profile) => {
    const verificationCommandCount = Array.isArray(profile.verification_commands)
      ? profile.verification_commands.filter(nonEmptyString).length
      : 0;
    const unsupportedSurfaceCount = Array.isArray(profile.unsupported_surfaces)
      ? profile.unsupported_surfaces.filter(nonEmptyString).length
      : 0;
    return {
      id: typeof profile.id === "string" ? profile.id : null,
      role: typeof profile.role === "string" ? profile.role : null,
      status: typeof profile.status === "string" ? profile.status : null,
      certification_status:
        verificationCommandCount > 0 && unsupportedSurfaceCount > 0 ? "evidence_disclosed" : "needs_disclosure",
      supported_assets: Array.isArray(profile.supported_assets) ? profile.supported_assets.filter(nonEmptyString) : [],
      unsupported_surfaces: Array.isArray(profile.unsupported_surfaces)
        ? profile.unsupported_surfaces.filter(nonEmptyString)
        : [],
      verification_commands: Array.isArray(profile.verification_commands)
        ? profile.verification_commands.filter(nonEmptyString)
        : [],
      risk_notes: Array.isArray(profile.risk_notes) ? profile.risk_notes.filter(nonEmptyString) : [],
      owner: nonEmptyString(profile.owner) ? profile.owner : null,
      last_verified_at: nonEmptyString(profile.last_verified_at) ? profile.last_verified_at : null,
    };
  });
}

function validateDomainGenome(value, errors) {
  if (!isObject(value)) {
    errors.push("domain_genome must be an object.");
    return;
  }
  requireString(value, "domain_genome.domain", errors);
  requireString(value, "domain_genome.purpose", errors);
  requireStringArray(value, "domain_genome.task_classes", errors);
  requireStringArray(value, "domain_genome.knowledge_sources", errors);
  requireStringArray(value, "domain_genome.hard_failures", errors);
}

function validateArchitecture(value, errors, warnings) {
  if (!isObject(value)) {
    errors.push("architecture must be an object.");
    return;
  }
  requireString(value, "architecture.main_agent", errors);
  if (!Array.isArray(value.specialists)) {
    errors.push("architecture.specialists must be an array.");
  } else {
    for (const [index, specialist] of value.specialists.entries()) {
      if (!isObject(specialist)) {
        errors.push(`architecture.specialists[${index}] must be an object.`);
        continue;
      }
      requireString(specialist, `architecture.specialists[${index}].id`, errors);
      requireString(specialist, `architecture.specialists[${index}].purpose`, errors);
    }
  }
  requireStringArray(value, "architecture.routing_modes", errors);
  if (Array.isArray(value.specialists) && value.specialists.length > 12) {
    warnings.push("architecture.specialists has more than 12 specialists; verify orchestration cost and context budget.");
  }
}

function validateTools(value, errors) {
  if (!Array.isArray(value)) {
    errors.push("tools must be an array.");
    return;
  }
  if (value.length === 0) errors.push("tools must contain at least one tool contract.");
  for (const [index, tool] of value.entries()) {
    if (!isObject(tool)) {
      errors.push(`tools[${index}] must be an object.`);
      continue;
    }
    requireString(tool, `tools[${index}].name`, errors);
    requireString(tool, `tools[${index}].purpose`, errors);
    requireStringArray(tool, `tools[${index}].allowed_when`, errors);
    requireStringArray(tool, `tools[${index}].forbidden_when`, errors);
    requireString(tool, `tools[${index}].evidence_policy`, errors);
  }
}

function validateEvidence(value, errors) {
  if (!isObject(value)) {
    errors.push("evidence must be an object.");
    return;
  }
  requireStringArray(value, "evidence.stores", errors);
  requireStringArray(value, "evidence.required_artifacts", errors);
  requireStringArray(value, "evidence.audit_rules", errors);
}

function validateEval(value, errors) {
  if (!isObject(value)) {
    errors.push("eval must be an object.");
    return;
  }
  requireString(value, "eval.cases_path", errors);
  requireString(value, "eval.rubric_path", errors);
  requireStringArray(value, "eval.required_case_classes", errors);
  requireStringArray(value, "eval.hard_failures", errors);
}

function validateGovernance(value, errors, warnings) {
  if (!isObject(value)) {
    errors.push("governance must be an object.");
    return;
  }
  requireStringArray(value, "governance.policies", errors);
  requireStringArray(value, "governance.quality_gates", errors);
  const requiredGateIds = new Set(QUALITY_GATES.map((gate) => gate.id));
  const declaredGateIds = new Set(Array.isArray(value.quality_gates) ? value.quality_gates : []);
  for (const gateId of requiredGateIds) {
    if (!declaredGateIds.has(gateId)) warnings.push(`governance.quality_gates does not list default gate: ${gateId}`);
  }
}

function validateRelease(value, errors, warnings) {
  if (!isObject(value)) {
    errors.push("release must be an object.");
    return;
  }
  if (!nonEmptyString(value.latest_commit) && !nonEmptyString(value.release_ledger_path)) {
    errors.push("release.latest_commit or release.release_ledger_path is required.");
  }
  if (!Array.isArray(value.known_risks)) errors.push("release.known_risks must be an array.");
  if (value.status === "released" && !nonEmptyString(value.latest_tag)) {
    warnings.push("released blueprints should include release.latest_tag.");
  }
}

function isValidTool(tool) {
  return (
    isObject(tool) &&
    nonEmptyString(tool.name) &&
    nonEmptyString(tool.purpose) &&
    nonEmptyArray(tool.allowed_when) &&
    Array.isArray(tool.forbidden_when) &&
    nonEmptyString(tool.evidence_policy)
  );
}

function safeCheck(check, blueprint) {
  try {
    return check(blueprint);
  } catch {
    return false;
  }
}

function requireString(object, path, errors) {
  const key = path.split(".").at(-1);
  if (!nonEmptyString(object?.[key])) errors.push(`${path} must be a non-empty string.`);
}

function requireStringArray(object, path, errors) {
  const key = path.split(".").at(-1);
  const value = object?.[key];
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array.`);
    return;
  }
  for (const [index, item] of value.entries()) {
    if (!nonEmptyString(item)) errors.push(`${path}[${index}] must be a non-empty string.`);
  }
}

function optionalString(object, path, errors) {
  const key = path.split(".").at(-1);
  if (!(key in object)) return;
  requireString(object, path, errors);
}

function optionalStringArray(object, path, errors) {
  const key = path.split(".").at(-1);
  if (!(key in object)) return;
  requireStringArray(object, path, errors);
}

function optionalIsoLikeDateString(object, path, errors) {
  const key = path.split(".").at(-1);
  if (!(key in object)) return;
  if (!nonEmptyString(object[key]) || !/^\d{4}-\d{2}-\d{2}(?:$|[T ])/u.test(object[key])) {
    errors.push(`${path} must be an ISO-like date string when provided.`);
  }
}

function collectSecretLikeStringFindings(value, pointer = "$", findings = []) {
  if (typeof value === "string") {
    if (containsSecretLikeValue(value)) findings.push(pointer);
    return findings;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) collectSecretLikeStringFindings(item, `${pointer}[${index}]`, findings);
    return findings;
  }
  if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      collectSecretLikeStringFindings(item, `${pointer}.${key}`, findings);
    }
  }
  return findings;
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}
