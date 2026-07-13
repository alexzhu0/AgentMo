import { createHash } from "node:crypto";
import {
  LEGACY_ARTIFACT_REGISTRY,
  inspectJsonIdentityMembers,
  inspectArtifactForMigration,
  transformLegacyArtifact,
} from "./artifact-registry.js";
import { stableStringify } from "./evidence-audit.js";
import { assertPersistable } from "./persistability.js";

export const MIGRATION_PLAN_SCHEMA_VERSION = "agentmo.migration-plan.v1";
export const MIGRATION_RECEIPT_SCHEMA_VERSION = "agentmo.migration-receipt.v1";
export const DEFAULT_MAX_MIGRATION_INPUT_BYTES = 1024 * 1024;

const REGISTRY_BY_FAMILY = new Map(LEGACY_ARTIFACT_REGISTRY.map((record) => [record.family, record]));
const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const PLAN_FIELDS = new Set([
  "schemaVersion",
  "mode",
  "applicable",
  "input_count",
  "ready_count",
  "already_canonical_count",
  "rejected_count",
  "items",
  "plan_digest",
]);
const ITEM_FIELDS = new Set([
  "ordinal",
  "result",
  "family",
  "rule_id",
  "output_basename",
  "input_identity",
  "input_version",
  "input_digest",
  "output_identity",
  "output_version",
  "output_digest",
  "reason",
  "warnings",
]);
const REJECTION_REASONS = new Set([
  "conflicting_identity",
  "duplicate_identity_member",
  "input_too_large",
  "invalid_json",
  "invalid_utf8",
  "multiple_families",
  "non_object",
  "output_collision",
  "read_failed",
  "resource_budget_exceeded",
  "safe_content_required",
  "schema_validation_failed",
  "unknown_version",
  "unregistered_identity",
  "unsafe_content",
  "unsafe_object",
  "unsupported_artifact",
]);
const FIXED_WARNING_CODES = new Set(["migration_input_rejected", "migration_output_collision"]);
const READ_FAILURES = new WeakSet();
const READ_FAILURE_REASONS = new Set(["input_too_large", "read_failed"]);

export function migrationReadFailure(reason) {
  if (!READ_FAILURE_REASONS.has(reason)) {
    throw new TypeError("Migration read failure reason is unsupported.");
  }
  const result = Object.freeze({ reason });
  READ_FAILURES.add(result);
  return result;
}

export function planArtifactMigrationBytes(inputs, options = {}) {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new TypeError("At least one migration input is required.");
  }
  const maxInputBytes = options.maxInputBytes ?? DEFAULT_MAX_MIGRATION_INPUT_BYTES;
  if (!Number.isInteger(maxInputBytes) || maxInputBytes <= 0) {
    throw new TypeError("maxInputBytes must be a positive integer.");
  }

  const inspectedItems = [];
  for (const [index, input] of inputs.entries()) {
    if (Buffer.isBuffer(input)) {
      inspectedItems.push(
        input.byteLength > maxInputBytes
          ? rejectedItem(index + 1, "input_too_large")
          : inspectInputBytes(input, index + 1),
      );
      continue;
    }
    if (input && typeof input === "object" && READ_FAILURES.has(input)) {
      inspectedItems.push(rejectedItem(index + 1, input.reason));
      continue;
    }
    throw new TypeError("Migration byte planning requires exact Buffers or authentic read failures.");
  }
  const items = rejectOutputCollisions(inspectedItems);
  const applicable = items.every((item) => item.result === "ready" || item.result === "already_canonical");
  const core = {
    schemaVersion: MIGRATION_PLAN_SCHEMA_VERSION,
    mode: "preview",
    applicable,
    input_count: items.length,
    ready_count: items.filter((item) => item.result === "ready").length,
    already_canonical_count: items.filter((item) => item.result === "already_canonical").length,
    rejected_count: items.filter((item) => item.result === "rejected").length,
    items,
  };
  return {
    ...core,
    plan_digest: digestBytes(Buffer.from(stableStringify(core), "utf8")),
  };
}

export function buildMigrationReceipt(plan) {
  const validation = validateMigrationPlanForReceipt(plan);
  if (!validation.ok) {
    throw new TypeError("A valid migration plan is required to build a receipt model.");
  }
  return {
    schemaVersion: MIGRATION_RECEIPT_SCHEMA_VERSION,
    plan_digest: plan.plan_digest,
    result: plan.applicable ? "applicable" : "non_applicable",
    items: plan.items.map((item) => compactObject({
      ordinal: item.ordinal,
      result: item.result === "rejected" ? `rejected_${item.reason}` : item.result,
      rule_id: item.rule_id,
      input_identity: item.input_identity,
      input_version: item.input_version,
      input_digest: item.input_digest,
      output_identity: item.output_identity,
      output_version: item.output_version,
      output_digest: item.output_digest,
      warnings: Array.isArray(item.warnings) ? [...item.warnings] : [],
    })),
  };
}

export function validateMigrationPlanForReceipt(plan) {
  try {
    assertValidMigrationPlan(plan);
    return { ok: true, errors: [] };
  } catch {
    return { ok: false, errors: ["invalid_migration_plan"] };
  }
}

export function serializeMigrationPlan(plan) {
  return `${JSON.stringify(plan, null, 2)}\n`;
}

export function formatMigrationPlan(plan) {
  const lines = [
    "AgentMo migration preview",
    `Applicable: ${plan.applicable ? "yes" : "no"}`,
    `Inputs: ${plan.input_count}`,
    `Plan digest: ${plan.plan_digest}`,
  ];
  for (const item of plan.items) {
    const rule = item.rule_id ? ` via ${item.rule_id}` : "";
    const output = item.output_basename ? ` -> ${item.output_basename}` : "";
    const reason = item.reason ? ` (${item.reason})` : "";
    lines.push(`- #${item.ordinal} ${item.result}${reason}${rule}${output}`);
  }
  lines.push("Mutation: none (preview only)");
  return `${lines.join("\n")}\n`;
}

function inspectInputBytes(bytes, ordinal) {
  const inputDigest = digestBytes(bytes);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return rejectedItem(ordinal, "invalid_utf8", { input_digest: inputDigest });
  }

  const identityScan = inspectJsonIdentityMembers(text);
  if (!identityScan.ok) {
    return rejectedItem(ordinal, identityScan.reason, { input_digest: inputDigest });
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return rejectedItem(ordinal, "invalid_json", { input_digest: inputDigest });
  }

  try {
    const inspection = inspectArtifactForMigration(parsed);
    if (inspection.status === "migration_required") {
      const record = REGISTRY_BY_FAMILY.get(inspection.family);
      const outputBytes = serializeMigratedArtifact(transformLegacyArtifact(parsed));
      return {
        ordinal,
        result: "ready",
        family: record.family,
        rule_id: record.rule_id,
        output_basename: record.output_basename,
        input_identity: record.input_identity,
        input_version: record.input_version,
        input_digest: inputDigest,
        output_identity: record.output_identity,
        output_version: record.output_version,
        output_digest: digestBytes(outputBytes),
        warnings: [],
      };
    }
    if (inspection.status === "already_canonical") {
      const record = REGISTRY_BY_FAMILY.get(inspection.family);
      return {
        ordinal,
        result: "already_canonical",
        family: record.family,
        input_identity: record.output_identity,
        input_version: record.output_version,
        input_digest: inputDigest,
        output_identity: record.output_identity,
        output_version: record.output_version,
        output_digest: inputDigest,
        warnings: [],
      };
    }
    return rejectedItem(ordinal, inspection.reason ?? "unsupported_artifact", {
      input_digest: inputDigest,
    });
  } catch (error) {
    return rejectedItem(
      ordinal,
      error?.code === "AGENTMO_RESOURCE_BUDGET_EXCEEDED"
        || error?.code === "AGENTMO_PERSISTABILITY_RESOURCE_BUDGET"
        ? "resource_budget_exceeded"
        : "unsafe_content",
      { input_digest: inputDigest },
    );
  }
}

export function serializeMigratedArtifact(value) {
  assertPersistable(value, { subject: "migration-output" });
  const bytes = Buffer.from(`${stableStringify(value)}\n`, "utf8");
  const reparsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  assertPersistable(reparsed, { subject: "migration-output" });
  if (!bytes.equals(Buffer.from(`${stableStringify(reparsed)}\n`, "utf8"))) {
    throw new TypeError("Migration output bytes are not deterministic.");
  }
  return bytes;
}

function rejectOutputCollisions(items) {
  const counts = new Map();
  for (const item of items) {
    if (item.result === "ready") counts.set(item.output_basename, (counts.get(item.output_basename) ?? 0) + 1);
  }
  return items.map((item) => {
    if (item.result !== "ready" || counts.get(item.output_basename) === 1) return item;
    return {
      ...item,
      result: "rejected",
      reason: "output_collision",
      warnings: ["migration_output_collision"],
    };
  });
}

function rejectedItem(ordinal, reason, extra = {}) {
  return {
    ordinal,
    result: "rejected",
    reason,
    ...extra,
    warnings: ["migration_input_rejected"],
  };
}

function assertValidMigrationPlan(plan) {
  assertPlainObject(plan);
  assertExactFields(plan, PLAN_FIELDS);
  if (plan.schemaVersion !== MIGRATION_PLAN_SCHEMA_VERSION || plan.mode !== "preview") throw new Error();
  if (!Array.isArray(plan.items) || typeof plan.applicable !== "boolean") throw new Error();
  for (const field of ["input_count", "ready_count", "already_canonical_count", "rejected_count"]) {
    if (!Number.isInteger(plan[field]) || plan[field] < 0) throw new Error();
  }
  if (!SHA256_DIGEST_PATTERN.test(plan.plan_digest)) throw new Error();

  for (const [index, item] of plan.items.entries()) validatePlanItem(item, index + 1);
  const readyCount = plan.items.filter((item) => item.result === "ready").length;
  const canonicalCount = plan.items.filter((item) => item.result === "already_canonical").length;
  const rejectedCount = plan.items.filter((item) => item.result === "rejected").length;
  const applicable = rejectedCount === 0;
  if (
    plan.input_count !== plan.items.length ||
    plan.ready_count !== readyCount ||
    plan.already_canonical_count !== canonicalCount ||
    plan.rejected_count !== rejectedCount ||
    plan.applicable !== applicable
  ) {
    throw new Error();
  }

  const readyOutputs = plan.items.filter((item) => item.result === "ready").map((item) => item.output_basename);
  if (new Set(readyOutputs).size !== readyOutputs.length) throw new Error();
  const core = {
    schemaVersion: plan.schemaVersion,
    mode: plan.mode,
    applicable: plan.applicable,
    input_count: plan.input_count,
    ready_count: plan.ready_count,
    already_canonical_count: plan.already_canonical_count,
    rejected_count: plan.rejected_count,
    items: plan.items,
  };
  const expectedDigest = digestBytes(Buffer.from(stableStringify(core), "utf8"));
  if (plan.plan_digest !== expectedDigest) throw new Error();
}

function validatePlanItem(item, expectedOrdinal) {
  assertPlainObject(item);
  assertExactFields(item, ITEM_FIELDS);
  if (item.ordinal !== expectedOrdinal || !["ready", "already_canonical", "rejected"].includes(item.result)) {
    throw new Error();
  }
  if (!Array.isArray(item.warnings) || item.warnings.some((warning) => !FIXED_WARNING_CODES.has(warning))) {
    throw new Error();
  }
  if (new Set(item.warnings).size !== item.warnings.length) throw new Error();

  if (item.result === "ready") {
    if (item.reason !== undefined || item.warnings.length !== 0) throw new Error();
    validateRegistryTuple(item, true);
    return;
  }
  if (item.result === "already_canonical") {
    const record = REGISTRY_BY_FAMILY.get(item.family);
    if (
      !record ||
      item.rule_id !== undefined ||
      item.output_basename !== undefined ||
      item.reason !== undefined ||
      item.warnings.length !== 0 ||
      item.input_identity !== record.output_identity ||
      item.input_version !== record.output_version ||
      item.output_identity !== record.output_identity ||
      item.output_version !== record.output_version ||
      !validDigest(item.input_digest) ||
      item.output_digest !== item.input_digest
    ) {
      throw new Error();
    }
    return;
  }

  if (!REJECTION_REASONS.has(item.reason)) throw new Error();
  const expectedWarnings = item.reason === "output_collision" ? ["migration_output_collision"] : ["migration_input_rejected"];
  if (!sameArray(item.warnings, expectedWarnings)) throw new Error();
  if (item.reason === "output_collision") {
    validateRegistryTuple(item, true);
    return;
  }
  const allowedRejectedFields = new Set(["ordinal", "result", "reason", "input_digest", "warnings"]);
  if (Object.keys(item).some((key) => !allowedRejectedFields.has(key))) throw new Error();
  if (item.input_digest !== undefined && !validDigest(item.input_digest)) throw new Error();
}

function validateRegistryTuple(item, requireRule) {
  const record = REGISTRY_BY_FAMILY.get(item.family);
  if (
    !record ||
    (requireRule && item.rule_id !== record.rule_id) ||
    item.output_basename !== record.output_basename ||
    item.input_identity !== record.input_identity ||
    item.input_version !== record.input_version ||
    item.output_identity !== record.output_identity ||
    item.output_version !== record.output_version ||
    !validDigest(item.input_digest) ||
    !validDigest(item.output_digest)
  ) {
    throw new Error();
  }
}

function assertPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
}

function assertExactFields(value, allowed) {
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error();
}

function validDigest(value) {
  return typeof value === "string" && SHA256_DIGEST_PATTERN.test(value);
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
