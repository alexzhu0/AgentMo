export const BUILDER_ADAPTER_CONTRACT_VERSION = "agentmo.builder-adapter.v1";

export const BUILDER_LIFECYCLE_STAGES = Object.freeze(["discover", "plan", "produce"]);

export const BUILDER_REQUIRED_LIFECYCLE_EVENTS = Object.freeze([
  "workflow-start",
  "stage-enter",
  "stage-exit",
  "manual-pause",
  "session-start",
  "pre-compact",
  "post-compact",
  "session-restart",
]);

export const BUILDER_EVIDENCE_LEVELS = Object.freeze([
  "declared",
  "observed",
  "verified-behavior",
]);

const CAPABILITY_REQUIREMENTS = new Set(["required", "optional"]);
const SUPPORT_DECLARATIONS = new Set(["candidate", "unsupported"]);
const FALLBACK_STATUSES = new Set(["disabled", "degraded"]);
const PROBE_KINDS = new Set(["version", "feature", "help", "feature-and-help"]);
const ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/u;

export function validateBuilderAdapter(candidate) {
  const errors = [];
  if (!isRecord(candidate)) {
    return { ok: false, errors: ["adapter must be an object"] };
  }

  if (candidate.contractVersion !== BUILDER_ADAPTER_CONTRACT_VERSION) {
    errors.push(`contractVersion must be ${BUILDER_ADAPTER_CONTRACT_VERSION}`);
  }
  if (!ID_PATTERN.test(candidate.id ?? "")) errors.push("id must be a bounded kebab-case identifier");
  if (!nonEmptyString(candidate.label)) errors.push("label must be a non-empty string");
  if (!SUPPORT_DECLARATIONS.has(candidate.supportDeclaration)) {
    errors.push("supportDeclaration must be candidate or unsupported");
  }
  if (candidate.supportClaim !== false) {
    errors.push("adapter descriptors cannot self-assert support");
  }

  validateCapabilities(candidate.capabilities, errors);
  validateLifecycleEvents(candidate.lifecycleEvents, errors);
  validateContextInjection(candidate.contextInjection, errors);
  validateRecovery(candidate.recovery, errors);
  validateDeduplication(candidate.deduplication, errors);
  validateEvidence(candidate.evidence, errors);
  validateStringArray(candidate.unsupportedSurfaces, "unsupportedSurfaces", errors);
  validateStringArray(candidate.degradedSurfaces, "degradedSurfaces", errors);

  return { ok: errors.length === 0, errors };
}

export function defineBuilderAdapter(candidate) {
  const validation = validateBuilderAdapter(candidate);
  if (!validation.ok) {
    throw new TypeError(`Invalid builder adapter: ${validation.errors.join("; ")}`);
  }
  return deepFreeze(cloneData(candidate));
}

function validateCapabilities(capabilities, errors) {
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    errors.push("capabilities must be a non-empty array");
    return;
  }
  const seen = new Set();
  for (const [index, capability] of capabilities.entries()) {
    const prefix = `capabilities[${index}]`;
    if (!isRecord(capability)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    if (!ID_PATTERN.test(capability.id ?? "")) errors.push(`${prefix}.id is invalid`);
    else if (seen.has(capability.id)) errors.push(`${prefix}.id is duplicated`);
    else seen.add(capability.id);
    if (!CAPABILITY_REQUIREMENTS.has(capability.requirement)) {
      errors.push(`${prefix}.requirement must be required or optional`);
    }
    if (!nonEmptyString(capability.description)) errors.push(`${prefix}.description is required`);
    if (!isRecord(capability.probe) || !PROBE_KINDS.has(capability.probe.kind)) {
      errors.push(`${prefix}.probe must declare a kind`);
    } else {
      if (["feature", "feature-and-help"].includes(capability.probe.kind)
        && !nonEmptyString(capability.probe.feature)) {
        errors.push(`${prefix}.probe.feature is required`);
      }
      if (["help", "feature-and-help"].includes(capability.probe.kind)
        && !nonEmptyString(capability.probe.command)) {
        errors.push(`${prefix}.probe.command is required`);
      }
    }
    if (capability.requirement === "optional") validateFallback(capability.fallback, prefix, errors);
    if (capability.requirement === "required" && capability.fallback !== null) {
      errors.push(`${prefix}.fallback must be null for required capabilities`);
    }
  }
}

function validateFallback(fallback, prefix, errors) {
  if (!isRecord(fallback)) {
    errors.push(`${prefix}.fallback must explicitly disable or declare a tested degradation`);
    return;
  }
  if (!FALLBACK_STATUSES.has(fallback.status)) errors.push(`${prefix}.fallback.status is invalid`);
  if (fallback.tested !== true) errors.push(`${prefix}.fallback.tested must be true`);
  if (!nonEmptyString(fallback.impact)) errors.push(`${prefix}.fallback.impact is required`);
}

function validateLifecycleEvents(events, errors) {
  validateStringArray(events, "lifecycleEvents", errors);
  if (!Array.isArray(events)) return;
  for (const event of BUILDER_REQUIRED_LIFECYCLE_EVENTS) {
    if (!events.includes(event)) errors.push(`lifecycleEvents is missing ${event}`);
  }
}

function validateContextInjection(value, errors) {
  if (!isRecord(value)) {
    errors.push("contextInjection must be an object");
    return;
  }
  if (value.authority !== "agentmo-artifacts") {
    errors.push("contextInjection.authority must be agentmo-artifacts");
  }
  validateStringArray(value.surfaces, "contextInjection.surfaces", errors, { allowEmpty: false });
}

function validateRecovery(value, errors) {
  if (!isRecord(value)) {
    errors.push("recovery must be an object");
    return;
  }
  if (value.authority !== "agentmo-checkpoint") errors.push("recovery.authority must be agentmo-checkpoint");
  if (value.compaction !== "artifact-first") errors.push("recovery.compaction must be artifact-first");
  if (value.restart !== "artifact-first") errors.push("recovery.restart must be artifact-first");
}

function validateDeduplication(value, errors) {
  if (!isRecord(value)) {
    errors.push("deduplication must be an object");
    return;
  }
  if (value.strategy !== "event-id-ledger") errors.push("deduplication.strategy must be event-id-ledger");
  if (!nonEmptyString(value.key)) errors.push("deduplication.key is required");
}

function validateEvidence(value, errors) {
  if (!isRecord(value)) {
    errors.push("evidence must be an object");
    return;
  }
  if (!BUILDER_EVIDENCE_LEVELS.includes(value.maximum)) errors.push("evidence.maximum is invalid");
  if (value.supportClaim !== false) errors.push("evidence.supportClaim must be false in a descriptor");
  if (value.domainQualityCertified !== false) errors.push("evidence.domainQualityCertified must be false");
}

function validateStringArray(value, field, errors, options = {}) {
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array`);
    return;
  }
  if (options.allowEmpty === false && value.length === 0) errors.push(`${field} must not be empty`);
  if (value.some((item) => !nonEmptyString(item))) errors.push(`${field} must contain only non-empty strings`);
  if (new Set(value).size !== value.length) errors.push(`${field} must not contain duplicates`);
}

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}
