export const DISCOVERY_SCHEMA_VERSION = "agentmo.discovery.v1";
export const DISCOVERY_MANIFEST_SUBJECT = "discovery-manifest";

const VALID_SOURCE_TYPES = new Set([
  "document",
  "database",
  "retrieval_corpus",
  "tool_output",
  "user_interview",
  "runtime_trace",
  "manual_inventory",
]);

const VALID_TRUST_LEVELS = new Set(["verified", "trusted", "derived", "unverified", "unknown"]);

export async function loadDiscoveryManifest(filePath, options = {}) {
  await assertDiscoveryLoaderSubject(options.subject, DISCOVERY_MANIFEST_SUBJECT);
  const { loadAdmittedArtifact } = await import("./artifact-admission.js");
  return (await loadAdmittedArtifact({
    filePath,
    subject: DISCOVERY_MANIFEST_SUBJECT,
    expectedDigest: options.expectedDigest,
    maxBytes: options.maxBytes,
    openInput: options.openInput,
  })).value;
}

export function validateDiscoveryManifest(manifest) {
  const errors = [];
  const warnings = [];

  if (!isObject(manifest)) {
    return { ok: false, errors: ["Discovery manifest must be a JSON object."], warnings };
  }

  if (manifest.schemaVersion !== DISCOVERY_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${DISCOVERY_SCHEMA_VERSION}`);
  }
  requireString(manifest, "agent_id", errors);
  validateSourceInventory(manifest.source_inventory, errors, warnings);
  requireStringArray(manifest, "database_outputs", errors);
  requireStringArray(manifest, "retrieval_outputs", errors);
  requireStringArray(manifest, "user_need_inputs", errors);
  validateRefreshPolicy(manifest.refresh_policy, errors);
  requireStringArray(manifest, "forbidden_data_handling", errors);

  if (
    Array.isArray(manifest.database_outputs) &&
    Array.isArray(manifest.retrieval_outputs) &&
    manifest.database_outputs.length === 0 &&
    manifest.retrieval_outputs.length === 0
  ) {
    warnings.push("Discovery manifest has no database_outputs or retrieval_outputs.");
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function summarizeDiscoveryManifest(manifest) {
  const sourceInventory = Array.isArray(manifest?.source_inventory) ? manifest.source_inventory.filter(isObject) : [];
  return {
    schemaVersion: isObject(manifest) ? manifest.schemaVersion : undefined,
    agent_id: isObject(manifest) ? manifest.agent_id : undefined,
    source_count: sourceInventory.length,
    source_types: sortedUnique(sourceInventory.map((source) => source.type).filter(nonEmptyString)),
    trust_levels: sortedUnique(sourceInventory.map((source) => source.trust_level).filter(nonEmptyString)),
    database_outputs: Array.isArray(manifest?.database_outputs) ? manifest.database_outputs.filter(nonEmptyString) : [],
    retrieval_outputs: Array.isArray(manifest?.retrieval_outputs) ? manifest.retrieval_outputs.filter(nonEmptyString) : [],
    user_need_input_count: Array.isArray(manifest?.user_need_inputs)
      ? manifest.user_need_inputs.filter(nonEmptyString).length
      : 0,
    refresh_policy: isObject(manifest?.refresh_policy)
      ? {
          cadence: manifest.refresh_policy.cadence,
          owner: manifest.refresh_policy.owner,
          stale_after: manifest.refresh_policy.stale_after,
        }
      : null,
  };
}

export function buildDiscoveryReport(manifest) {
  const validation = validateDiscoveryManifest(manifest);
  return {
    kind: "agentmo_discovery_report",
    version: "0.1",
    ok: validation.ok,
    summary: summarizeDiscoveryManifest(manifest),
    warnings: validation.warnings,
    errors: validation.errors,
  };
}

export function formatDiscoveryReport(report) {
  const lines = [
    `AgentMo discovery report: ${report.summary.agent_id ?? "unknown"}`,
    `Sources: ${report.summary.source_count}`,
    `Source types: ${report.summary.source_types.join(", ") || "none"}`,
    `Trust levels: ${report.summary.trust_levels.join(", ") || "none"}`,
    `Database outputs: ${report.summary.database_outputs.length}`,
    `Retrieval outputs: ${report.summary.retrieval_outputs.length}`,
    `User-need inputs: ${report.summary.user_need_input_count}`,
    `Refresh cadence: ${report.summary.refresh_policy?.cadence ?? "unknown"}`,
  ];

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

function validateSourceInventory(value, errors, warnings) {
  if (!Array.isArray(value)) {
    errors.push("source_inventory must be an array.");
    return;
  }
  if (value.length === 0) errors.push("source_inventory must contain at least one source.");

  const ids = new Set();
  for (const [index, source] of value.entries()) {
    if (!isObject(source)) {
      errors.push(`source_inventory[${index}] must be an object.`);
      continue;
    }
    requireString(source, `source_inventory[${index}].id`, errors);
    requireString(source, `source_inventory[${index}].type`, errors);
    requireString(source, `source_inventory[${index}].trust_level`, errors);
    requireString(source, `source_inventory[${index}].description`, errors);
    requireStringArray(source, `source_inventory[${index}].extraction_fields`, errors);

    if (typeof source.id === "string") {
      if (ids.has(source.id)) errors.push(`source_inventory[${index}].id must be unique.`);
      ids.add(source.id);
    }

    if (typeof source.type === "string" && !VALID_SOURCE_TYPES.has(source.type)) {
      errors.push(
        `source_inventory[${index}].type must be one of: ${Array.from(VALID_SOURCE_TYPES).join(", ")}`,
      );
    }
    if (typeof source.trust_level === "string" && !VALID_TRUST_LEVELS.has(source.trust_level)) {
      errors.push(
        `source_inventory[${index}].trust_level must be one of: ${Array.from(VALID_TRUST_LEVELS).join(", ")}`,
      );
    }
    if (!nonEmptyString(source.location)) {
      warnings.push(`source_inventory[${index}] (${source.id ?? "unknown"}) has no location.`);
    }
  }
}

function validateRefreshPolicy(value, errors) {
  if (!isObject(value)) {
    errors.push("refresh_policy must be an object.");
    return;
  }
  requireString(value, "refresh_policy.cadence", errors);
  requireString(value, "refresh_policy.owner", errors);
  requireString(value, "refresh_policy.stale_after", errors);
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

function sortedUnique(values) {
  return Array.from(new Set(values)).sort();
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

async function assertDiscoveryLoaderSubject(actual, expected) {
  if (actual === expected) return;
  const { AgentMoUnsupportedArtifactError } = await import("./artifact-registry.js");
  throw new AgentMoUnsupportedArtifactError("subject_identity_mismatch");
}
