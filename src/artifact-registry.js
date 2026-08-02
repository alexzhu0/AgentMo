import { createHash } from "node:crypto";
import { auditMigrationCandidate } from "./evidence-audit.js";
import { BLUEPRINT_SCHEMA_VERSION, validateBlueprint } from "./blueprint.js";
import {
  BUILD_STATE_SCHEMA_VERSION,
  LEGACY_BUILD_STATE_SCHEMA_VERSION,
  validateBuildStateArtifact,
} from "./build-state.js";
import { BIRTH_REPORT_SCHEMA_VERSION, validateBirthReportArtifact } from "./birth-report.js";
import { DELIVERY_REPORT_SCHEMA_VERSION, validateDeliveryReportArtifact } from "./delivery-report.js";
import {
  DISCOVERY_APPROVAL_SCHEMA_VERSION,
  validateDiscoveryApproval,
} from "./discovery-approval.js";
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
import { serializePersistableJson } from "./persistability.js";
import {
  OPENCLAW_PROBE_SCHEMA_VERSION,
  validateOpenClawProbe,
} from "./openclaw-probe-contract.js";
import {
  OPENCLAW_INSTALL_PRIVATE_JOURNAL_SCHEMA_VERSION,
  OPENCLAW_INSTALL_RECEIPT_SCHEMA_VERSION,
  validateOpenClawInstallJournal,
  validateOpenClawInstallReceipt,
} from "./openclaw-install-receipt.js";
import {
  OPENCLAW_INSTALL_FINALIZATION_SCHEMA_VERSION,
  OPENCLAW_INSTALL_POST_STATE_SCHEMA_VERSION,
  OPENCLAW_OFFICIAL_ACTION_RESULT_SCHEMA_VERSION,
  validateOpenClawInstallFinalizationEvidence,
  validateOpenClawInstallPostStateEvidence,
  validateOpenClawOfficialActionResultEvidence,
} from "./openclaw-install-evidence.js";
import {
  OPENCLAW_ABSENT_GENESIS_SCHEMA_VERSION,
  OPENCLAW_INSTALL_PLAN_SCHEMA_VERSION,
  validateOpenClawAbsentGenesisAuthority,
  validateOpenClawInstallPlan,
} from "./openclaw-install-plan.js";
import {
  OPENCLAW_CONFLICT_APPROVAL_SCHEMA_VERSION,
  OPENCLAW_INSTALL_APPROVAL_SCHEMA_VERSION,
  OPENCLAW_SENSITIVE_ACTION_DECISION_SCHEMA_VERSION,
} from "./openclaw-install-approval.js";
import {
  AGENT_PACKAGE_SCHEMA_VERSION,
  validateAgentPackageManifest,
} from "./package-contract.js";
import {
  validateOpenClawAuthorityRootBinding,
} from "./openclaw-authority-root-binding.js";
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

function validateContextBoundDiscoveryApproval(value, context) {
  if (context?.referencedByDesignPlan === true) {
    return validateSafely(() => (
      validateDiscoveryApproval(value).ok
      && validateDesignPlan(context.designPlan).ok
      && context.designPlan.source.discoveryApproval.identity === DISCOVERY_APPROVAL_SCHEMA_VERSION
      && context.designPlan.source.discoveryApproval.subject === "discovery-approval"
      && context.designPlan.source.discoveryApproval.digest === context.source.digest
    ));
  }
  return context !== undefined
    && validateSafely(() => validateDiscoveryApproval(value, context).ok);
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
    diagnose_canonical_input: (value) => safeValidationIssues(() => validateDiscoveryManifest(value).errors),
  }),
  Object.freeze({
    subject: "discovery-db",
    identity_field: "schemaVersion",
    identity: DISCOVERY_DB_SCHEMA_VERSION,
    legacy_inspector: "unsupported",
    validate_canonical_input: validateCanonicalDiscoveryDb,
  }),
  Object.freeze({
    subject: "discovery-approval",
    identity_field: "schemaVersion",
    identity: DISCOVERY_APPROVAL_SCHEMA_VERSION,
    legacy_inspector: "unsupported",
    required_companion_subjects: Object.freeze(["discovery-manifest", "discovery-db"]),
    validate_canonical_input: validateContextBoundDiscoveryApproval,
  }),
  Object.freeze({
    subject: "user-need",
    identity_field: "schemaVersion",
    identity: USER_NEED_SCHEMA_VERSION,
    legacy_inspector: "unsupported",
    validate_canonical_input: (value) => validateSafely(() => validateUserNeed(value).ok),
    diagnose_canonical_input: (value) => safeValidationIssues(() => validateUserNeed(value).errors),
  }),
  Object.freeze({
    subject: "decision-entry",
    identity_field: "schemaVersion",
    identity: "agentmo.decision-entry.v1",
    legacy_inspector: "unsupported",
    validate_canonical_input: validateCanonicalDecisionEntry,
  }),
  Object.freeze({
    subject: "decision-ledger",
    identity_field: "schemaVersion",
    identity: "agentmo.decision-ledger.v1",
    legacy_inspector: "unsupported",
    validate_canonical_input: validateCanonicalDecisionLedgerEntry,
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
    subject: "openclaw-target-descriptor",
    identity_field: "schemaVersion",
    identity: "agentmo.openclaw-target-descriptor.v1",
    legacy_inspector: "unsupported",
    validate_canonical_input: validateCanonicalOpenClawTargetDescriptor,
  }),
  Object.freeze({
    subject: "build-contract",
    identity_field: "schemaVersion",
    identity: "agentmo.build-contract.v1",
    legacy_inspector: "unsupported",
    validate_canonical_input: validateCanonicalBuildContract,
  }),
  Object.freeze({
    subject: "native-plugin-recipe",
    identity_field: "schemaVersion",
    identity: "agentmo.native-plugin-recipe.v1",
    legacy_inspector: "unsupported",
    validate_canonical_input: validateCanonicalNativePluginRecipe,
  }),
  Object.freeze({
    subject: "plan-approval",
    identity_field: "schemaVersion",
    identity: "agentmo.plan-approval.v1",
    legacy_inspector: "unsupported",
    validate_canonical_input: validateCanonicalPlanApproval,
  }),
  Object.freeze({
    subject: "openclaw-target-carrier-admission",
    identity_field: "schemaVersion",
    identity: "agentmo.openclaw-target-carrier-admission.v1",
    legacy_inspector: "unsupported",
    required_companion_subjects: Object.freeze([
      "blueprint",
      "build-contract",
      "plan-approval",
      "openclaw-target-descriptor",
    ]),
    validate_canonical_input: validateCanonicalOpenClawTargetCarrierAdmission,
  }),
  Object.freeze({
    subject: "package-manifest",
    identity_field: "schemaVersion",
    identity: AGENT_PACKAGE_SCHEMA_VERSION,
    legacy_inspector: "unsupported",
    validate_canonical_input: (value) => validateSafely(() => (
      validateAgentPackageManifest(value).ok
    )),
    diagnose_canonical_input: (value) => safeValidationIssues(() => (
      validateAgentPackageManifest(value).errors
    )),
  }),
  Object.freeze({
    subject: "openclaw-probe",
    identity_field: "schemaVersion",
    identity: OPENCLAW_PROBE_SCHEMA_VERSION,
    legacy_inspector: "unsupported",
    required_companion_subjects: Object.freeze([
      "package-manifest",
      "openclaw-target-carrier-admission",
      "openclaw-target-descriptor",
    ]),
    validate_canonical_input: (value, context) => validateSafely(
      () => validateOpenClawProbe(value, context).ok,
    ),
    diagnose_canonical_input: (value, context) => safeValidationIssues(
      () => validateOpenClawProbe(value, context).errors,
    ),
  }),
  Object.freeze({
    subject: "openclaw-install-private-journal",
    identity_field: "schemaVersion",
    identity: OPENCLAW_INSTALL_PRIVATE_JOURNAL_SCHEMA_VERSION,
    legacy_inspector: "unsupported",
    validate_canonical_input: (value) => validateSafely(() => (
      validateOpenClawInstallJournal(value).ok
    )),
    diagnose_canonical_input: (value) => safeValidationIssues(
      () => validateOpenClawInstallJournal(value).errors,
    ),
  }),
  Object.freeze({
    subject: "openclaw-install-post-state",
    identity_field: "schemaVersion",
    identity: OPENCLAW_INSTALL_POST_STATE_SCHEMA_VERSION,
    legacy_inspector: "unsupported",
    producer_authentication: "canonical-authority-reopen-only",
    validate_canonical_input: (value) => validateSafely(() => (
      validateOpenClawInstallPostStateEvidence(value).ok
    )),
    diagnose_canonical_input: (value) => safeValidationIssues(
      () => validateOpenClawInstallPostStateEvidence(value).errors,
    ),
  }),
  Object.freeze({
    subject: "openclaw-official-action-result",
    identity_field: "schemaVersion",
    identity: OPENCLAW_OFFICIAL_ACTION_RESULT_SCHEMA_VERSION,
    legacy_inspector: "unsupported",
    producer_authentication: "canonical-authority-reopen-only",
    validate_canonical_input: (value) => validateSafely(() => (
      validateOpenClawOfficialActionResultEvidence(value).ok
    )),
    diagnose_canonical_input: (value) => safeValidationIssues(
      () => validateOpenClawOfficialActionResultEvidence(value).errors,
    ),
  }),
  Object.freeze({
    subject: "openclaw-install-finalization",
    identity_field: "schemaVersion",
    identity: OPENCLAW_INSTALL_FINALIZATION_SCHEMA_VERSION,
    legacy_inspector: "unsupported",
    producer_authentication: "canonical-authority-reopen-only",
    validate_canonical_input: (value) => validateSafely(() => (
      validateOpenClawInstallFinalizationEvidence(value).ok
    )),
    diagnose_canonical_input: (value) => safeValidationIssues(
      () => validateOpenClawInstallFinalizationEvidence(value).errors,
    ),
  }),
  Object.freeze({
    subject: "openclaw-install-receipt",
    identity_field: "schemaVersion",
    identity: OPENCLAW_INSTALL_RECEIPT_SCHEMA_VERSION,
    legacy_inspector: "unsupported",
    required_companion_subjects: Object.freeze([
      "openclaw-install-plan",
      "openclaw-install-approval",
      "openclaw-sensitive-action-decision",
      "openclaw-conflict-approval",
      "openclaw-install-private-journal",
      "openclaw-probe",
      "openclaw-target-descriptor",
      "openclaw-install-post-state",
      "openclaw-official-action-result",
      "openclaw-install-finalization",
    ]),
    repeatable_companion_subjects: Object.freeze({
      "openclaw-sensitive-action-decision": Object.freeze({
        semanticOrder: "install-plan-sensitive-actions",
      }),
      "openclaw-official-action-result": Object.freeze({
        semanticOrder: "install-plan-sensitive-actions",
      }),
    }),
    validate_canonical_input: (value, context) => validateSafely(() => (
      validateOpenClawInstallReceipt(value, context).ok
    )),
    diagnose_canonical_input: (value, context) => safeValidationIssues(
      () => validateOpenClawInstallReceipt(value, context).errors,
    ),
  }),
  Object.freeze({
    subject: "openclaw-absent-genesis",
    identity_field: "schemaVersion",
    identity: OPENCLAW_ABSENT_GENESIS_SCHEMA_VERSION,
    legacy_inspector: "unsupported",
    validate_canonical_input: (value) => validateSafely(() => (
      validateOpenClawAbsentGenesisAuthority(value).ok
    )),
    diagnose_canonical_input: (value) => safeValidationIssues(
      () => validateOpenClawAbsentGenesisAuthority(value).errors,
    ),
  }),
  Object.freeze({
    subject: "openclaw-install-plan",
    identity_field: "schemaVersion",
    identity: OPENCLAW_INSTALL_PLAN_SCHEMA_VERSION,
    legacy_inspector: "unsupported",
    validate_canonical_input: (value) => validateSafely(() => (
      validateOpenClawInstallPlan(value).ok
    )),
    diagnose_canonical_input: (value) => safeValidationIssues(
      () => validateOpenClawInstallPlan(value).errors,
    ),
  }),
  Object.freeze({
    subject: "openclaw-install-approval",
    identity_field: "schemaVersion",
    identity: OPENCLAW_INSTALL_APPROVAL_SCHEMA_VERSION,
    legacy_inspector: "unsupported",
    validate_canonical_input: validateCanonicalOpenClawInstallApproval,
  }),
  Object.freeze({
    subject: "openclaw-sensitive-action-decision",
    identity_field: "schemaVersion",
    identity: OPENCLAW_SENSITIVE_ACTION_DECISION_SCHEMA_VERSION,
    legacy_inspector: "unsupported",
    validate_canonical_input:
      validateCanonicalOpenClawSensitiveActionDecision,
  }),
  Object.freeze({
    subject: "openclaw-conflict-approval",
    identity_field: "schemaVersion",
    identity: OPENCLAW_CONFLICT_APPROVAL_SCHEMA_VERSION,
    legacy_inspector: "unsupported",
    validate_canonical_input: validateCanonicalOpenClawConflictApproval,
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
  constructor(reason, options = {}) {
    super("Artifact identity is unsupported for safe loading or migration.");
    this.name = "AgentMoUnsupportedArtifactError";
    this.code = "AGENTMO_UNSUPPORTED_ARTIFACT";
    this.reason = reason;
    if (typeof options.subject === "string") this.subject = options.subject;
    if (Array.isArray(options.issues) && options.issues.length > 0) {
      this.issues = Object.freeze([...options.issues]);
    }
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

export function companionMultiplicityForDurableArtifact(subject) {
  const descriptor = DURABLE_DESCRIPTOR_BY_SUBJECT.get(subject);
  if (!descriptor?.required_companion_subjects) return null;
  return Object.freeze({
    repeatable: descriptor.repeatable_companion_subjects ?? Object.freeze({}),
  });
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
      throw new AgentMoUnsupportedArtifactError("schema_validation_failed", {
        subject,
        issues: descriptor.diagnose_canonical_input?.(value) ?? [],
      });
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

function safeValidationIssues(validate) {
  try {
    const issues = validate();
    if (!Array.isArray(issues)) return [];
    return issues
      .filter((issue) => typeof issue === "string" && issue.length > 0 && issue.length <= 240)
      .slice(0, 32);
  } catch {
    return [];
  }
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

function validateCanonicalBuildContract(value) {
  return validateSafely(() => (
    isObject(value)
    && (hasExactKeys(value, [
      "schemaVersion",
      "agentId",
      "status",
      "targetRuntime",
      "bindings",
      "specification",
      "resources",
      "permissions",
      "acceptanceCases",
      "evidenceObligations",
      "traceGraph",
      "remainingRisks",
      "certificationBoundary",
    ]) || hasExactKeys(value, [
      "schemaVersion",
      "agentId",
      "status",
      "targetRuntime",
      "nativePluginRecipe",
      "bindings",
      "specification",
      "resources",
      "permissions",
      "acceptanceCases",
      "evidenceObligations",
      "traceGraph",
      "remainingRisks",
      "certificationBoundary",
    ]) || hasExactKeys(value, [
      "schemaVersion",
      "agentId",
      "status",
      "targetDescriptor",
      "targetRuntime",
      "bindings",
      "specification",
      "resources",
      "permissions",
      "acceptanceCases",
      "evidenceObligations",
      "traceGraph",
      "remainingRisks",
      "certificationBoundary",
    ]) || hasExactKeys(value, [
      "schemaVersion",
      "agentId",
      "status",
      "targetDescriptor",
      "targetRuntime",
      "nativePluginRecipe",
      "bindings",
      "specification",
      "resources",
      "permissions",
      "acceptanceCases",
      "evidenceObligations",
      "traceGraph",
      "remainingRisks",
      "certificationBoundary",
    ]))
    && value.schemaVersion === "agentmo.build-contract.v1"
    && value.status === "construction-intent"
    && value.targetRuntime?.id === "openclaw"
    && typeof value.targetRuntime?.sourceRevision === "string"
    && Array.isArray(value.resources)
    && value.resources.length > 0
    && Array.isArray(value.permissions)
    && value.permissions.length === value.resources.length
    && Array.isArray(value.acceptanceCases)
    && value.acceptanceCases.length > 0
    && Array.isArray(value.evidenceObligations)
    && value.evidenceObligations.length === value.resources.length
    && value.certificationBoundary?.packageBuilt === false
    && value.certificationBoundary?.runtime === false
  ));
}

function validateCanonicalOpenClawTargetDescriptor(value) {
  return validateSafely(() => (
    isObject(value)
    && hasExactKeys(value, [
      "schemaVersion",
      "target",
      "targetRoot",
      "members",
      "provenance",
      "certificationBoundary",
      "authorityDigest",
    ])
    && value.schemaVersion === "agentmo.openclaw-target-descriptor.v1"
    && value.target?.id === "openclaw"
    && typeof value.target?.version === "string"
    && /^[a-f0-9]{40}$/u.test(value.target?.sourceRevision ?? "")
    && typeof value.target?.nodeRange === "string"
    && Array.isArray(value.members)
    && value.members.length === 3
    && /^sha256:[a-f0-9]{64}$/u.test(value.targetRoot?.memberClosureDigest ?? "")
    && /^sha256:[a-f0-9]{64}$/u.test(value.authorityDigest ?? "")
    && value.certificationBoundary?.targetIdentityObservationOnly === true
    && value.certificationBoundary?.runtime === false
    && value.certificationBoundary?.production === false
  ));
}

function validateCanonicalNativePluginRecipe(value) {
  return validateSafely(() => {
    if (!isObject(value)
      || !hasExactKeys(value, [
        "schemaVersion",
        "owner",
        "files",
        "hookMappings",
        "recipeDigest",
      ])
      || value.schemaVersion !== "agentmo.native-plugin-recipe.v1"
      || value.owner !== "agentmo-openclaw-harness"
      || !Array.isArray(value.files)
      || value.files.length === 0
      || !Array.isArray(value.hookMappings)
      || value.hookMappings.length !== 4
      || !/^sha256:[a-f0-9]{64}$/u.test(value.recipeDigest)) {
      return false;
    }
    return value.files.every((file) => (
      isObject(file)
      && hasExactKeys(file, [
        "relativePath",
        "type",
        "mode",
        "encoding",
        "content",
        "byteLength",
        "sha256",
      ])
      && typeof file.relativePath === "string"
      && file.relativePath.startsWith("openclaw/plugin/")
      && file.type === "file"
      && [0o644, 0o755].includes(file.mode)
      && file.encoding === "utf8"
      && typeof file.content === "string"
      && Number.isSafeInteger(file.byteLength)
      && /^sha256:[a-f0-9]{64}$/u.test(file.sha256)
    ));
  });
}

function validateCanonicalPlanApproval(value) {
  return validateSafely(() => (
    isObject(value)
    && hasExactKeys(value, [
      "schemaVersion",
      "decision",
      "decisionScope",
      "previewDigest",
      "bindings",
      "approvalCoverage",
      "certificationBoundary",
    ])
    && value.schemaVersion === "agentmo.plan-approval.v1"
    && value.decision === "approve"
    && value.decisionScope === "enter-produce"
    && /^sha256:[a-f0-9]{64}$/u.test(value.previewDigest)
    && value.certificationBoundary?.packageBuilt === false
    && value.certificationBoundary?.runtime === false
  ));
}

function validateCanonicalOpenClawTargetCarrierAdmission(value, context) {
  return validateSafely(() => (
    isObject(value)
    && hasExactKeys(value, [
      "schemaVersion",
      "decision",
      "target",
      "authorities",
      "carrier",
      "hookMappings",
      "certificationBoundary",
    ])
    && value.schemaVersion === "agentmo.openclaw-target-carrier-admission.v1"
    && value.decision === "admit-exact-target-and-native-plugin-recipe"
    && value.target?.id === "openclaw"
    && typeof value.target?.version === "string"
    && /^[a-f0-9]{40}$/u.test(value.target?.sourceRevision ?? "")
    && value.target?.displayRevision === value.target.sourceRevision.slice(0, 7)
    && /^sha256:[a-f0-9]{64}$/u.test(value.target?.descriptorDigest)
    && /^sha256:[a-f0-9]{64}$/u.test(value.target?.executableDigest)
    && /^sha256:[a-f0-9]{64}$/u.test(value.target?.packageJsonDigest)
    && /^sha256:[a-f0-9]{64}$/u.test(value.target?.buildInfoDigest)
    && /^sha256:[a-f0-9]{64}$/u.test(value.target?.targetRootDigest)
    && value.carrier?.kind === "native-plugin"
    && value.carrier?.owner === "agentmo-openclaw-harness"
    && value.carrier?.implementationPathAccepted === false
    && value.carrier?.mcp === false
    && Array.isArray(value.hookMappings)
    && value.hookMappings.length === 4
    && isObject(context?.sources)
    && value.authorities?.blueprintDigest === context.sources.blueprint?.digest
    && value.authorities?.buildContractDigest === context.sources.buildContract?.digest
    && value.authorities?.planApprovalDigest === context.sources.planApproval?.digest
    && value.authorities?.targetDescriptorDigest
      === context.sources["openclaw-target-descriptor"]?.digest
    && value.authorities?.nativePluginRecipeDigest
      === context.buildContract?.nativePluginRecipe?.recipeDigest
    && context.planApproval?.bindings?.buildContract?.digest
      === context.sources.buildContract?.digest
    && value.certificationBoundary?.pluginBytesMaterialized === false
    && value.certificationBoundary?.installed === false
    && value.certificationBoundary?.runtime === false
    && value.certificationBoundary?.domain === false
    && value.certificationBoundary?.production === false
  ));
}

function validateCanonicalDecisionEntry(value) {
  return validateSafely(() => {
    const keys = [
      "schemaVersion",
      "entryId",
      "entryKind",
      "subject",
      "reason",
      "sourceRefs",
      "decisionRefs",
      "requirementRefs",
    ];
    return isObject(value)
      && hasExactKeys(value, keys)
      && value.schemaVersion === "agentmo.decision-entry.v1"
      && validDecisionEntryBody(value);
  });
}

function validateCanonicalOpenClawInstallApproval(value) {
  return validateSafely(() => (
    isObject(value)
    && hasExactKeys(value, [
      "schemaVersion",
      "decision",
      "installPlanDigest",
      "archiveBinding",
      "authorityRootBinding",
      "lifecycle",
      "targetId",
      "scope",
      "authority",
      "issuedAt",
      "expiresAt",
      "useNonce",
    ])
    && value.schemaVersion === OPENCLAW_INSTALL_APPROVAL_SCHEMA_VERSION
    && validLifecycleDecisionBase(value)
    && ["install", "upgrade", "rollback", "uninstall"].includes(value.lifecycle)
    && value.targetId === "openclaw"
    && ["project", "user"].includes(value.scope)
    && exactJson(value.authority, {
      ordinaryManagedWrites: true,
      sensitiveActions: false,
      conflicts: false,
      broaderScope: false,
    })
  ));
}

function validateCanonicalOpenClawSensitiveActionDecision(value) {
  return validateSafely(() => (
    isObject(value)
    && hasExactKeys(value, [
      "schemaVersion",
      "decision",
      "installPlanDigest",
      "archiveBinding",
      "authorityRootBinding",
      "action",
      "issuedAt",
      "expiresAt",
      "useNonce",
    ])
    && value.schemaVersion === OPENCLAW_SENSITIVE_ACTION_DECISION_SCHEMA_VERSION
    && validLifecycleDecisionBase(value)
    && isObject(value.action)
    && hasExactKeys(value.action, [
      "actionId",
      "kind",
      "executable",
      "argv",
      "cwd",
      "scope",
      "target",
      "timeoutMs",
      "environmentNames",
    ])
    && nonEmpty(value.action.actionId)
    && ["network", "credential", "process", "external-command", "user-scope"]
      .includes(value.action.kind)
    && nonEmpty(value.action.executable)
    && Array.isArray(value.action.argv)
    && value.action.argv.every(nonEmpty)
    && nonEmpty(value.action.cwd)
    && ["project", "user"].includes(value.action.scope)
    && nonEmpty(value.action.target)
    && Number.isSafeInteger(value.action.timeoutMs)
    && value.action.timeoutMs > 0
    && value.action.timeoutMs <= 60_000
    && sortedUniqueStrings(value.action.environmentNames)
  ));
}

function validateCanonicalOpenClawConflictApproval(value) {
  return validateSafely(() => (
    isObject(value)
    && hasExactKeys(value, [
      "schemaVersion",
      "decision",
      "installPlanDigest",
      "archiveBinding",
      "authorityRootBinding",
      "conflicts",
      "issuedAt",
      "expiresAt",
      "useNonce",
    ])
    && value.schemaVersion === OPENCLAW_CONFLICT_APPROVAL_SCHEMA_VERSION
    && validLifecycleDecisionBase(value)
    && Array.isArray(value.conflicts)
    && sortedUniqueStrings(value.conflicts.map(({ path }) => path))
    && value.conflicts.every((conflict) => (
      isObject(conflict)
      && hasExactKeys(conflict, [
        "path",
        "currentDigest",
        "desiredDigest",
        "action",
      ])
      && portableRelativePath(conflict.path)
      && digestValue(conflict.currentDigest)
      && digestValue(conflict.desiredDigest)
      && ["preserve", "replace", "abort"].includes(conflict.action)
    ))
  ));
}

function validLifecycleDecisionBase(value) {
  return value.decision === "approve"
    && digestValue(value.installPlanDigest)
    && validLifecycleArchiveBinding(value.archiveBinding)
    && validateOpenClawAuthorityRootBinding(value.authorityRootBinding).ok
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u
      .test(value.issuedAt ?? "")
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u
      .test(value.expiresAt ?? "")
    && Date.parse(value.issuedAt) < Date.parse(value.expiresAt)
    && nonEmpty(value.useNonce);
}

function validLifecycleArchiveBinding(value) {
  return isObject(value)
    && hasExactKeys(value, [
      "archiveSha256",
      "manifestDigest",
      "inventoryDigest",
      "members",
    ])
    && digestValue(value.archiveSha256)
    && digestValue(value.manifestDigest)
    && digestValue(value.inventoryDigest)
    && Array.isArray(value.members)
    && value.members.length > 0
    && sortedUniqueStrings(value.members.map(({ relativePath }) => relativePath))
    && value.members.every((member) => (
      isObject(member)
      && hasExactKeys(member, [
        "relativePath",
        "type",
        "mode",
        "byteLength",
        "sha256",
      ])
      && portableRelativePath(member.relativePath)
      && member.type === "file"
      && [0o644, 0o755].includes(member.mode)
      && Number.isSafeInteger(member.byteLength)
      && member.byteLength >= 0
      && digestValue(member.sha256)
    ))
    && value.inventoryDigest === `sha256:${createHash("sha256")
      .update(Buffer.from(serializePersistableJson(value.members, {
        subject: "package-member-inventory",
      }), "utf8"))
      .digest("hex")}`;
}

function digestValue(value) {
  return /^sha256:[a-f0-9]{64}$/u.test(value ?? "");
}

function portableRelativePath(value) {
  return nonEmpty(value)
    && value.length <= 1024
    && !value.includes("\\")
    && !value.startsWith("/")
    && !/^[A-Za-z]:/u.test(value)
    && !value.split("/").some((segment) => (
      segment === "" || segment === "." || segment === ".."
    ));
}

function sortedUniqueStrings(value) {
  return Array.isArray(value)
    && value.every(nonEmpty)
    && value.every((item, index) => (
      index === 0 || Buffer.from(item).compare(Buffer.from(value[index - 1])) > 0
    ));
}

function nonEmpty(value) {
  return typeof value === "string" && value.length > 0 && !value.includes("\0");
}

function exactJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateCanonicalDecisionLedgerEntry(value) {
  return validateSafely(() => {
    const keys = [
      "schemaVersion",
      "sequence",
      "predecessorDigest",
      "entryId",
      "entryKind",
      "subject",
      "reason",
      "sourceRefs",
      "decisionRefs",
      "requirementRefs",
    ];
    return isObject(value)
      && hasExactKeys(value, keys)
      && value.schemaVersion === "agentmo.decision-ledger.v1"
      && Number.isSafeInteger(value.sequence)
      && value.sequence >= 0
      && (value.predecessorDigest === null
        || /^sha256:[a-f0-9]{64}$/u.test(value.predecessorDigest))
      && validDecisionEntryBody(value);
  });
}

function validDecisionEntryBody(value) {
  const id = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
  const kinds = new Set(["fact", "inference", "unknown", "rejected-option", "human-decision"]);
  return id.test(value.entryId ?? "")
    && kinds.has(value.entryKind)
    && typeof value.subject === "string"
    && value.subject.length > 0
    && value.subject.length <= 512
    && typeof value.reason === "string"
    && value.reason.length > 0
    && value.reason.length <= 4096
    && ["sourceRefs", "decisionRefs", "requirementRefs"].every((key) =>
      Array.isArray(value[key])
        && value[key].length <= 128
        && value[key].every((item) => typeof item === "string" && id.test(item))
        && value[key].every((item, index) => index === 0 || value[key][index - 1] < item));
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
