import { auditMigrationCandidate } from "./evidence-audit.js";
import { BLUEPRINT_SCHEMA_VERSION, validateBlueprint } from "./blueprint.js";
import {
  BUILD_STATE_SCHEMA_VERSION,
  LEGACY_BUILD_STATE_SCHEMA_VERSION,
  validateBuildStateArtifact,
} from "./build-state.js";
import { BIRTH_REPORT_SCHEMA_VERSION, validateBirthReportArtifact } from "./birth-report.js";
import { DELIVERY_REPORT_SCHEMA_VERSION, validateDeliveryReportArtifact } from "./delivery-report.js";
import { DISCOVERY_DB_SCHEMA_VERSION, validateDiscoveryDb } from "./discovery-db.js";
import { DISCOVERY_SCHEMA_VERSION, validateDiscoveryManifest } from "./discovery.js";
import { DESIGN_PLAN_SCHEMA_VERSION, validateDesignPlan } from "./design-plan.js";
import {
  DOMAIN_CASES_SCHEMA_VERSION,
  DOMAIN_EVAL_SCHEMA_VERSION,
  validateDomainCasesArtifact,
  validateDomainEvalArtifact,
} from "./domain-eval.js";
import { HANDOFF_SCHEMA_VERSION, validateHandoffPackage } from "./handoff.js";
import { OBSERVATION_SCHEMA_VERSION, validateObservationRecord } from "./observation.js";
import { validateAgentMoReport, validateReportArtifact } from "./report.js";
import { RUNTIME_PLAN_SCHEMA_VERSION, validateRuntimePlanArtifact } from "./runtime-plan.js";
import {
  RUN_INDEX_SCHEMA_VERSION,
  RUN_EVAL_SCHEMA_VERSION,
  RUN_STATE_SCHEMA_VERSION,
  validateRunIndexArtifact,
  validateRunEvalArtifact,
  validateRunStateArtifact,
} from "./run-state.js";
import { USER_NEED_SCHEMA_VERSION, validateUserNeed } from "./user-need.js";

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const TOP_LEVEL_IDENTITY_MEMBERS = new Set([
  "agentmother_version",
  "agentmo_version",
  "kind",
  "version",
  "schemaVersion",
  "source",
]);
const BUILD_STATE_SOURCE_IDENTITY_MEMBERS = new Set([
  "agentmotherVersion",
  "agentmoVersion",
  "blueprintVersion",
  "identity",
  "subject",
  "digest",
]);
const PROVENANCE_IDENTITY_MEMBERS = new Set(["identity", "subject", "digest"]);
const JSON_IDENTITY_SCAN_MAX_DEPTH = 128;
const JSON_IDENTITY_SCAN_MAX_NODES = 20_000;

function transformBlueprint(value) {
  const output = cloneJsonValue(value);
  delete output.agentmother_version;
  output.agentmo_version = "0.1";
  return output;
}

function transformReport(value) {
  const output = cloneJsonValue(value);
  output.kind = "agentmo_report";
  if (hasOwn(output, "lifecycle")) {
    output.produce_maturity = output.lifecycle;
    delete output.lifecycle;
  }
  return output;
}

function transformBuildState(value) {
  const output = cloneJsonValue(value);
  output.source.agentmoVersion = output.source.agentmotherVersion;
  delete output.source.agentmotherVersion;
  delete output.source.blueprintVersion;
  return output;
}

function validateLegacyBlueprint(value) {
  return validateSafely(() => validateBlueprint(transformBlueprint(value)).ok);
}

function validateCanonicalBlueprint(value) {
  return validateSafely(() => validateBlueprint(value).ok);
}

function validateLegacyReport(value) {
  return validateSafely(() => validateAgentMoReport(value, { legacy: true }).ok);
}

function validateCanonicalReport(value) {
  return validateSafely(() => validateAgentMoReport(value, { legacyCanonical: true }).ok);
}

function validateLegacyBuildState(value) {
  return validateSafely(() => validateBuildStateArtifact(value, { legacy: true }).ok);
}

function validateCanonicalBuildState(value) {
  return validateSafely(() => validateBuildStateArtifact(value, { legacyCanonical: true }).ok);
}

function validateContextBoundRunEval(value, context) {
  return context !== undefined
    && validateSafely(() => validateRunEvalArtifact(value, context).ok);
}

function validateContextBoundBirthReport(value, context) {
  return context !== undefined
    && validateSafely(() => validateBirthReportArtifact(value, context).ok);
}

function validateContextBoundDeliveryReport(value, context) {
  return context !== undefined
    && validateSafely(() => validateDeliveryReportArtifact(value, context).ok);
}

export const LEGACY_ARTIFACT_REGISTRY = Object.freeze([
  Object.freeze({
    family: "blueprint",
    input_identity: "agentmother_version",
    input_version: "0.1",
    output_identity: "agentmo_version",
    output_version: "0.1",
    rule_id: "agentmo.migrate.blueprint.v0_1",
    output_basename: "blueprint.agentmo.json",
    ordinary_loader: "migration_required",
    validate_legacy_input: validateLegacyBlueprint,
    validate_canonical_output: validateCanonicalBlueprint,
    transform: transformBlueprint,
  }),
  Object.freeze({
    family: "report",
    input_identity: "agentmother_report",
    input_version: "0.1",
    output_identity: "agentmo_report",
    output_version: "0.1",
    rule_id: "agentmo.migrate.report.v0_1",
    output_basename: "report.agentmo.json",
    ordinary_loader: "migrate_only",
    validate_legacy_input: validateLegacyReport,
    validate_canonical_output: validateCanonicalReport,
    transform: transformReport,
  }),
  Object.freeze({
    family: "build_state",
    input_identity: "source.agentmotherVersion",
    input_version: "0.1",
    output_identity: "source.agentmoVersion",
    output_version: "0.1",
    rule_id: "agentmo.migrate.build-state.v1",
    output_basename: "build-state.agentmo.json",
    ordinary_loader: "migration_required",
    validate_legacy_input: validateLegacyBuildState,
    validate_canonical_output: validateCanonicalBuildState,
    transform: transformBuildState,
  }),
]);

const REGISTRY_BY_FAMILY = new Map(LEGACY_ARTIFACT_REGISTRY.map((record) => [record.family, record]));

export const DURABLE_ARTIFACT_REGISTRY = Object.freeze([
  Object.freeze({
    subject: "discovery-manifest",
    identity_field: "schemaVersion",
    identity: DISCOVERY_SCHEMA_VERSION,
    legacy_inspector: "unsupported",
    validate_canonical_input: (value) => validateSafely(() => validateDiscoveryManifest(value).ok),
  }),
  Object.freeze({
    subject: "discovery-db",
    identity_field: "schemaVersion",
    identity: DISCOVERY_DB_SCHEMA_VERSION,
    legacy_inspector: "unsupported",
    validate_canonical_input: validateCanonicalDiscoveryDb,
  }),
  Object.freeze({
    subject: "user-need",
    identity_field: "schemaVersion",
    identity: USER_NEED_SCHEMA_VERSION,
    legacy_inspector: "unsupported",
    validate_canonical_input: (value) => validateSafely(() => validateUserNeed(value).ok),
  }),
  Object.freeze({
    subject: "design-plan",
    identity_field: "schemaVersion",
    identity: DESIGN_PLAN_SCHEMA_VERSION,
    legacy_inspector: "unsupported",
    validate_canonical_input: validateCanonicalDesignPlan,
  }),
  Object.freeze({
    subject: "blueprint",
    identity_field: "agentmo_version",
    identity: BLUEPRINT_SCHEMA_VERSION,
    legacy_inspector: "migration_required",
    validate_canonical_input: (value) => validateSafely(() => validateBlueprint(value).ok),
  }),
  Object.freeze({
    subject: "handoff",
    identity_field: "schemaVersion",
    identity: HANDOFF_SCHEMA_VERSION,
    legacy_inspector: "unsupported",
    validate_canonical_input: (value) => validateSafely(() => validateHandoffPackage(value).ok),
  }),
  Object.freeze({
    subject: "build-state",
    identity_field: "schemaVersion",
    identity: BUILD_STATE_SCHEMA_VERSION,
    legacy_inspector: "migration_required",
    validate_canonical_input: (value) => validateSafely(() => validateBuildStateArtifact(value).ok),
  }),
  Object.freeze({
    subject: "runtime-plan",
    identity_field: "schemaVersion",
    identity: RUNTIME_PLAN_SCHEMA_VERSION,
    legacy_inspector: "unsupported",
    validate_canonical_input: (value) => validateSafely(() => validateRuntimePlanArtifact(value).ok),
  }),
  Object.freeze({
    subject: "run-state",
    identity_field: "schemaVersion",
    identity: RUN_STATE_SCHEMA_VERSION,
    legacy_inspector: "unsupported",
    validate_canonical_input: (value) => validateSafely(() => validateRunStateArtifact(value).ok),
  }),
  Object.freeze({
    subject: "run-index",
    identity_field: "schemaVersion",
    identity: RUN_INDEX_SCHEMA_VERSION,
    legacy_inspector: "unsupported",
    validate_canonical_input: (value) => validateSafely(() => validateRunIndexArtifact(value).ok),
  }),
  Object.freeze({
    subject: "observation",
    identity_field: "schemaVersion",
    identity: OBSERVATION_SCHEMA_VERSION,
    legacy_inspector: "unsupported",
    validate_canonical_input: (value) => validateSafely(() => validateObservationRecord(value).ok),
  }),
  Object.freeze({
    subject: "report",
    identity_field: "kind",
    identity: "agentmo_report",
    legacy_inspector: "unsupported",
    validate_canonical_input: (value) => validateSafely(() => validateReportArtifact(value).ok),
  }),
  Object.freeze({
    subject: "run-eval",
    identity_field: "schemaVersion",
    identity: RUN_EVAL_SCHEMA_VERSION,
    legacy_inspector: "unsupported",
    required_companion_subjects: Object.freeze(["run-state"]),
    validate_canonical_input: validateContextBoundRunEval,
  }),
  Object.freeze({
    subject: "birth-report",
    identity_field: "schemaVersion",
    identity: BIRTH_REPORT_SCHEMA_VERSION,
    legacy_inspector: "unsupported",
    required_companion_subjects: Object.freeze(["blueprint", "build-state", "run-state", "run-eval"]),
    validate_canonical_input: validateContextBoundBirthReport,
  }),
  Object.freeze({
    subject: "domain-cases",
    identity_field: "schemaVersion",
    identity: DOMAIN_CASES_SCHEMA_VERSION,
    legacy_inspector: "unsupported",
    validate_canonical_input: (value) => validateSafely(() => validateDomainCasesArtifact(value).ok),
  }),
  Object.freeze({
    subject: "domain-eval",
    identity_field: "schemaVersion",
    identity: DOMAIN_EVAL_SCHEMA_VERSION,
    legacy_inspector: "unsupported",
    validate_canonical_input: (value) => validateSafely(() => validateDomainEvalArtifact(value).ok),
  }),
  Object.freeze({
    subject: "delivery-report",
    identity_field: "schemaVersion",
    identity: DELIVERY_REPORT_SCHEMA_VERSION,
    legacy_inspector: "unsupported",
    required_companion_subjects: Object.freeze(["blueprint", "build-state", "run-state", "run-eval", "birth-report"]),
    optional_companion_subjects: Object.freeze(["domain-eval"]),
    validate_canonical_input: validateContextBoundDeliveryReport,
  }),
]);

const DURABLE_IDENTITY_FIELDS = Object.freeze(
  Array.from(new Set(DURABLE_ARTIFACT_REGISTRY.map((record) => record.identity_field))),
);
const DURABLE_DESCRIPTOR_BY_BINDING = new Map(
  DURABLE_ARTIFACT_REGISTRY.map((record) => [`${record.identity_field}\0${record.identity}`, record]),
);
const DURABLE_DESCRIPTOR_BY_SUBJECT = new Map(
  DURABLE_ARTIFACT_REGISTRY.map((record) => [record.subject, record]),
);

export class AgentMoMigrationRequiredError extends Error {
  constructor(record, subject = record.family) {
    super(`Legacy ${subject} requires explicit migration. Run \`agentmo migrate <input>\` to preview.`);
    this.name = "AgentMoMigrationRequiredError";
    this.code = "AGENTMO_MIGRATION_REQUIRED";
    this.family = record.family;
    this.rule_id = record.rule_id;
  }
}

export class AgentMoUnsupportedArtifactError extends Error {
  constructor(reason) {
    super("Artifact identity is unsupported for safe loading or migration.");
    this.name = "AgentMoUnsupportedArtifactError";
    this.code = "AGENTMO_UNSUPPORTED_ARTIFACT";
    this.reason = reason;
  }
}

export function inspectJsonIdentityMembers(raw, options = {}) {
  if (typeof raw !== "string") return { ok: false, reason: "invalid_json" };
  const maxDepth = options.maxDepth ?? JSON_IDENTITY_SCAN_MAX_DEPTH;
  const maxNodes = options.maxNodes ?? JSON_IDENTITY_SCAN_MAX_NODES;
  let index = 0;
  let nodes = 0;
  let duplicate = false;

  function fail(reason) {
    const error = new Error(reason);
    error.code = reason;
    throw error;
  }

  function useNode(depth) {
    nodes += 1;
    if (depth > maxDepth || nodes > maxNodes) fail("resource_budget_exceeded");
  }

  function skipWhitespace() {
    while (index < raw.length && /[\u0009\u000a\u000d\u0020]/u.test(raw[index])) index += 1;
  }

  function expect(character) {
    if (raw[index] !== character) fail("invalid_json");
    index += 1;
  }

  function parseString(decode) {
    const start = index;
    expect('"');
    while (index < raw.length) {
      const character = raw[index];
      if (character === '"') {
        index += 1;
        if (!decode) return null;
        try {
          return JSON.parse(raw.slice(start, index));
        } catch {
          fail("invalid_json");
        }
      }
      if (character.charCodeAt(0) < 0x20) fail("invalid_json");
      if (character === "\\") {
        index += 1;
        const escaped = raw[index];
        if (escaped === "u") {
          const digits = raw.slice(index + 1, index + 5);
          if (!/^[0-9a-fA-F]{4}$/u.test(digits)) fail("invalid_json");
          index += 5;
          continue;
        }
        if (!['"', "\\", "/", "b", "f", "n", "r", "t"].includes(escaped)) fail("invalid_json");
      }
      index += 1;
    }
    fail("invalid_json");
  }

  function parseNumber() {
    if (raw[index] === "-") index += 1;
    if (raw[index] === "0") {
      index += 1;
    } else {
      if (!/[1-9]/u.test(raw[index] ?? "")) fail("invalid_json");
      while (/[0-9]/u.test(raw[index] ?? "")) index += 1;
    }
    if (raw[index] === ".") {
      index += 1;
      if (!/[0-9]/u.test(raw[index] ?? "")) fail("invalid_json");
      while (/[0-9]/u.test(raw[index] ?? "")) index += 1;
    }
    if (raw[index] === "e" || raw[index] === "E") {
      index += 1;
      if (raw[index] === "+" || raw[index] === "-") index += 1;
      if (!/[0-9]/u.test(raw[index] ?? "")) fail("invalid_json");
      while (/[0-9]/u.test(raw[index] ?? "")) index += 1;
    }
  }

  function parseLiteral(literal) {
    if (raw.slice(index, index + literal.length) !== literal) fail("invalid_json");
    index += literal.length;
  }

  function parseArray(depth) {
    expect("[");
    skipWhitespace();
    if (raw[index] === "]") {
      index += 1;
      return;
    }
    while (true) {
      parseValue("other", depth + 1);
      skipWhitespace();
      if (raw[index] === "]") {
        index += 1;
        return;
      }
      expect(",");
      skipWhitespace();
    }
  }

  function parseObject(scope, depth) {
    expect("{");
    skipWhitespace();
    const seen = new Set();
    if (raw[index] === "}") {
      index += 1;
      return;
    }
    while (true) {
      if (raw[index] !== '"') fail("invalid_json");
      const key = parseString(true);
      const watched =
        scope === "root"
          ? TOP_LEVEL_IDENTITY_MEMBERS.has(key)
          : (scope === "source" && BUILD_STATE_SOURCE_IDENTITY_MEMBERS.has(key))
            || PROVENANCE_IDENTITY_MEMBERS.has(key);
      if (watched && seen.has(key)) duplicate = true;
      if (watched) seen.add(key);
      skipWhitespace();
      expect(":");
      skipWhitespace();
      parseValue(scope === "root" && key === "source" ? "source" : "other", depth + 1);
      skipWhitespace();
      if (raw[index] === "}") {
        index += 1;
        return;
      }
      expect(",");
      skipWhitespace();
    }
  }

  function parseValue(scope, depth) {
    useNode(depth);
    skipWhitespace();
    const character = raw[index];
    if (character === "{") parseObject(scope, depth);
    else if (character === "[") parseArray(depth);
    else if (character === '"') parseString(false);
    else if (character === "t") parseLiteral("true");
    else if (character === "f") parseLiteral("false");
    else if (character === "n") parseLiteral("null");
    else if (character === "-" || /[0-9]/u.test(character ?? "")) parseNumber();
    else fail("invalid_json");
  }

  try {
    skipWhitespace();
    parseValue("root", 0);
    skipWhitespace();
    if (index !== raw.length) fail("invalid_json");
  } catch (error) {
    return {
      ok: false,
      reason: error?.code === "resource_budget_exceeded" ? "resource_budget_exceeded" : "invalid_json",
    };
  }
  return duplicate ? { ok: false, reason: "duplicate_identity_member" } : { ok: true };
}

export function assertNoDuplicateIdentityMembers(raw) {
  const inspection = inspectJsonIdentityMembers(raw);
  if (!inspection.ok && inspection.reason !== "invalid_json") {
    throw new AgentMoUnsupportedArtifactError(inspection.reason);
  }
  return inspection;
}

export function inspectArtifactForMigration(value, options = {}) {
  if (!isObject(value)) return unsupported("non_object");

  try {
    const legacyFamilies = legacyFamilyMarkers(value);
    const canonicalFamilies = canonicalFamilyMarkers(value);

    if (hasReportSemanticConflict(value)) {
      return { status: "rejected", reason: "conflicting_identity" };
    }
    if (legacyFamilies.length > 1 || canonicalFamilies.length > 1) {
      return { status: "rejected", reason: "multiple_families" };
    }
    if (legacyFamilies.length > 0 && canonicalFamilies.length > 0) {
      return { status: "rejected", reason: "conflicting_identity" };
    }
    if (
      legacyFamilies.length === 0 &&
      canonicalFamilies.length === 1 &&
      canonicalVersionMatches(value, canonicalFamilies[0]) &&
      options.auditCanonical === false
    ) {
      return { status: "already_canonical", family: canonicalFamilies[0] };
    }

    const audit = auditMigrationCandidate(value);
    if (!audit.ok) {
      if (audit.reasons.includes("resource_budget_exceeded")) {
        return { status: "rejected", reason: "resource_budget_exceeded" };
      }
      return {
        status: "rejected",
        reason: "unsafe_content",
        findings: audit.reasons,
      };
    }

    if (legacyFamilies.length === 0) {
      if (canonicalFamilies.length === 0) return unsupported("unregistered_identity");
      const family = canonicalFamilies[0];
      if (!canonicalVersionMatches(value, family)) return unsupported("unknown_version");
      const record = REGISTRY_BY_FAMILY.get(family);
      return record.validate_canonical_output(value)
        ? { status: "already_canonical", family }
        : { status: "rejected", reason: "schema_validation_failed" };
    }

    const family = legacyFamilies[0];
    if (!legacyVersionMatches(value, family)) return unsupported("unknown_version");
    const record = REGISTRY_BY_FAMILY.get(family);
    if (!record.validate_legacy_input(value)) {
      return { status: "rejected", reason: "schema_validation_failed" };
    }
    const transformed = record.transform(value);
    if (!record.validate_canonical_output(transformed)) {
      return { status: "rejected", reason: "schema_validation_failed" };
    }
    return {
      status: "migration_required",
      family,
      rule_id: record.rule_id,
      output_basename: record.output_basename,
      ordinary_loader: record.ordinary_loader,
    };
  } catch {
    return { status: "rejected", reason: "unsafe_object" };
  }
}

export function transformLegacyArtifact(value) {
  const inspection = inspectArtifactForMigration(value);
  if (inspection.status !== "migration_required") {
    throw new AgentMoUnsupportedArtifactError(inspection.reason ?? inspection.status);
  }
  const record = REGISTRY_BY_FAMILY.get(inspection.family);
  const output = record.transform(value);
  if (!record.validate_canonical_output(output)) {
    throw new AgentMoUnsupportedArtifactError("schema_validation_failed");
  }
  return output;
}

export function assertArtifactLoadable(value, subject) {
  const inspection = inspectArtifactForMigration(value, { auditCanonical: false });
  if (inspection.status === "already_canonical") return value;
  if (inspection.status === "migration_required") {
    const record = REGISTRY_BY_FAMILY.get(inspection.family);
    if (record.ordinary_loader === "migration_required") {
      throw new AgentMoMigrationRequiredError(record, subject);
    }
  }
  throw new AgentMoUnsupportedArtifactError(inspection.reason ?? inspection.status);
}

export function listDurableArtifactDescriptors() {
  return DURABLE_ARTIFACT_REGISTRY.slice();
}

export function companionSubjectsForDurableArtifact(subject, value) {
  const descriptor = DURABLE_DESCRIPTOR_BY_SUBJECT.get(subject);
  if (!descriptor?.required_companion_subjects) return null;
  const subjects = [...descriptor.required_companion_subjects];
  if (descriptor.optional_companion_subjects?.includes("domain-eval")
    && value?.sources?.domainEval !== null
    && value?.sources?.domainEval !== undefined) {
    subjects.push("domain-eval");
  }
  return Object.freeze(subjects);
}

export function resolveDurableArtifactDescriptor(value, subject, options = {}) {
  if (!isObject(value)) throw new AgentMoUnsupportedArtifactError("non_object");
  const identityFields = DURABLE_IDENTITY_FIELDS.filter((field) => hasOwn(value, field));
  if (identityFields.length > 1) {
    throw new AgentMoUnsupportedArtifactError("conflicting_identity");
  }
  const identityField = identityFields[0] ?? null;
  const identity = identityField === null ? null : value[identityField];
  const descriptor = typeof identity === "string"
    ? DURABLE_DESCRIPTOR_BY_BINDING.get(`${identityField}\0${identity}`)
    : null;
  if (descriptor) {
    if (descriptor.subject !== subject) {
      throw new AgentMoUnsupportedArtifactError("subject_identity_mismatch");
    }
    if (!descriptor.validate_canonical_input(value, options.validationContext)) {
      throw new AgentMoUnsupportedArtifactError("schema_validation_failed");
    }
    return descriptor;
  }

  const migration = inspectArtifactForMigration(value, { auditCanonical: false });
  if (migration.status === "migration_required") {
    const record = REGISTRY_BY_FAMILY.get(migration.family);
    throw new AgentMoMigrationRequiredError(record, subject);
  }
  throw new AgentMoUnsupportedArtifactError(migration.reason ?? "unregistered_identity");
}

function legacyFamilyMarkers(value) {
  const families = [];
  if (hasOwn(value, "agentmother_version")) families.push("blueprint");
  if (hasOwn(value, "kind") && value.kind === "agentmother_report") families.push("report");
  if (hasOwn(value, "source") && isObject(value.source) && hasOwn(value.source, "agentmotherVersion")) {
    families.push("build_state");
  }
  return families;
}

function canonicalFamilyMarkers(value) {
  const families = [];
  if (hasOwn(value, "agentmo_version")) families.push("blueprint");
  if (hasOwn(value, "kind") && value.kind === "agentmo_report") families.push("report");
  if (hasOwn(value, "source") && isObject(value.source) && hasOwn(value.source, "agentmoVersion")) {
    families.push("build_state");
  }
  return families;
}

function legacyVersionMatches(value, family) {
  if (family === "blueprint") return value.agentmother_version === "0.1";
  if (family === "report") return hasOwn(value, "version") && value.version === "0.1";
  return (
    hasOwn(value, "schemaVersion") &&
    hasOwn(value.source, "blueprintVersion") &&
    value.source.agentmotherVersion === "0.1" &&
    value.source.blueprintVersion === "0.1" &&
    value.schemaVersion === LEGACY_BUILD_STATE_SCHEMA_VERSION
  );
}

function canonicalVersionMatches(value, family) {
  if (family === "blueprint") return value.agentmo_version === "0.1";
  if (family === "report") return hasOwn(value, "version") && value.version === "0.1";
  return (
    hasOwn(value, "schemaVersion") &&
    value.source.agentmoVersion === "0.1" &&
    value.schemaVersion === LEGACY_BUILD_STATE_SCHEMA_VERSION
  );
}

function hasReportSemanticConflict(value) {
  return (
    hasOwn(value, "kind") &&
    value.kind === "agentmother_report" &&
    hasOwn(value, "lifecycle") &&
    hasOwn(value, "produce_maturity")
  );
}

function cloneJsonValue(value) {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (isObject(value)) {
    const output = {};
    for (const [key, item] of Object.entries(value)) output[key] = cloneJsonValue(item);
    return output;
  }
  return value;
}

function unsupported(reason) {
  return { status: "unsupported", reason };
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateSafely(validate) {
  try {
    return validate() === true;
  } catch {
    return false;
  }
}

function validateCanonicalDiscoveryDb(value) {
  return validateSafely(() => validateDiscoveryDb(value).ok);
}

function validateCanonicalDesignPlan(value) {
  return validateSafely(() => validateDesignPlan(value).ok);
}
