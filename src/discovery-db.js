import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateDiscoveryManifest } from "./discovery.js";
import {
  assertPersistable,
  PersistabilityError,
  serializePersistableJson,
  writePersistableJsonAtomic,
  writePersistableTextAtomic,
} from "./persistability.js";
import {
  containsHostAbsolutePath,
  containsSecretLikeValue,
  isDeniedDurableLocation,
  redactManagedText,
  redactSecrets,
} from "./secret-redaction.js";

export const DISCOVERY_DB_SCHEMA_VERSION = "agentmo.discovery-db.v1";
export const DISCOVERY_PACK_SCHEMA_VERSION = "agentmo.discovery-pack.v1";
export const DISCOVERY_DB_FILENAME = "agentmo-discovery-db.json";
export const DISCOVERY_FACTS_FILENAME = "facts.jsonl";
export const DISCOVERY_COVERAGE_FILENAME = "coverage.json";

const MODULE_REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

export async function loadDiscoveryDb(filePath, options = {}) {
  if (options.subject !== "discovery-db") {
    const { AgentMoUnsupportedArtifactError } = await import("./artifact-registry.js");
    throw new AgentMoUnsupportedArtifactError("subject_identity_mismatch");
  }
  const { loadAdmittedArtifact } = await import("./artifact-admission.js");
  return (await loadAdmittedArtifact({
    filePath,
    subject: "discovery-db",
    expectedDigest: options.expectedDigest,
    maxBytes: options.maxBytes,
    openInput: options.openInput,
  })).value;
}

export function validateDiscoveryDb(value) {
  const errors = [];
  if (!isObject(value)) return { ok: false, errors: ["Discovery DB must be an object."], warnings: [] };
  if (value.schemaVersion !== DISCOVERY_DB_SCHEMA_VERSION) errors.push(`schemaVersion must be ${DISCOVERY_DB_SCHEMA_VERSION}`);
  if (typeof value.agentId !== "string" || value.agentId.trim().length === 0) errors.push("agentId must be a non-empty string.");
  for (const field of ["sources", "facts", "userNeedInputs", "forbiddenDataHandling"]) {
    if (!Array.isArray(value[field])) errors.push(`${field} must be an array.`);
  }
  if (!isObject(value.sourceManifest)) errors.push("sourceManifest must be an object.");
  if (!isObject(value.outputs) || !Array.isArray(value.outputs?.database) || !Array.isArray(value.outputs?.retrieval)) {
    errors.push("outputs must contain database and retrieval arrays.");
  }
  if (!isObject(value.coverage)) errors.push("coverage must be an object.");
  if (!isObject(value.safety)) errors.push("safety must be an object.");
  if (!isObject(value.validation) || value.validation.ok !== true) errors.push("validation.ok must be true.");
  if (value.safety?.rawSecretsStored !== false
    || value.safety?.rawTranscriptsStored !== false
    || value.safety?.rawToolBodiesStored !== false) {
    errors.push("safety raw-material flags must be false.");
  }
  if (value.safety?.workspaceOk === false || value.workspace?.ok === false) errors.push("workspace evidence must be safe.");
  return { ok: errors.length === 0, errors, warnings: [] };
}

export function buildDiscoveryDb(manifest, options = {}) {
  const validation = sanitizeValidation(validateDiscoveryManifest(manifest));
  const sourceInventory = Array.isArray(manifest?.source_inventory) ? manifest.source_inventory.filter(isObject) : [];
  const deniedSourceLocationFindings = collectDeniedSourceLocationFindings(sourceInventory);
  const sources = sourceInventory.map((source) => sanitizeSource(source, options)).sort((left, right) => left.id.localeCompare(right.id));
  const facts = sources.flatMap((source) =>
    source.extractionFields.map((field, index) => ({
      id: deriveDiscoveryRecordId(source.id, `field:${String(index + 1).padStart(2, "0")}`),
      sourceId: source.id,
      kind: "extraction_field",
      text: field,
      trustLevel: source.trustLevel,
      refs: typeof source.location === "string" && source.location.length > 0 ? [source.location] : [],
      tags: [source.type],
    })),
  );
  const userNeedInputs = sanitizeStringArray(manifest?.user_need_inputs);
  const databaseOutputs = sanitizeStringArray(manifest?.database_outputs);
  const retrievalOutputs = sanitizeStringArray(manifest?.retrieval_outputs);
  const forbiddenDataHandling = sanitizeStringArray(manifest?.forbidden_data_handling);
  const redactionFindings = collectRedactionFindings(manifest, "$", [], { ignoreLocationKeys: true });
  const db = {
    schemaVersion: DISCOVERY_DB_SCHEMA_VERSION,
    agentId: typeof manifest?.agent_id === "string" ? sanitizeText(manifest.agent_id) : null,
    sourceManifest: {
      schemaVersion: typeof manifest?.schemaVersion === "string" ? sanitizeText(manifest.schemaVersion) : null,
      path: safeManifestPath(options.manifestPath, options.repoRoot),
    },
    sources,
    facts,
    userNeedInputs,
    outputs: {
      database: databaseOutputs,
      retrieval: retrievalOutputs,
    },
    refreshPolicy: isObject(manifest?.refresh_policy)
      ? {
          cadence: sanitizeText(manifest.refresh_policy.cadence ?? ""),
          owner: sanitizeText(manifest.refresh_policy.owner ?? ""),
          staleAfter: sanitizeText(manifest.refresh_policy.stale_after ?? ""),
        }
      : null,
    forbiddenDataHandling,
    coverage: summarizeCoverage(sources, facts, databaseOutputs, retrievalOutputs, userNeedInputs),
    safety: {
      rawSecretsStored: false,
      rawTranscriptsStored: false,
      rawToolBodiesStored: false,
      redactedInputStringCount: redactionFindings.length,
      deniedSourceLocationCount: deniedSourceLocationFindings.length,
      deniedSourceLocationFindings,
      managedEvidenceExcludes: ["credential values", "raw transcripts", "raw tool bodies", "production runtime state"],
    },
    validation: {
      ok: validation.ok,
      warnings: validation.warnings,
      errors: validation.errors,
    },
  };
  return db;
}

export function deriveDiscoveryRecordId(sourceId, suffix) {
  const candidate = `${sourceId}:${suffix}`;
  if (!containsSecretLikeValue(candidate) && !containsHostAbsolutePath(candidate)) return candidate;
  return `source-${createHash("sha256").update(String(sourceId)).digest("hex")}:${suffix}`;
}

export function buildDiscoveryPack(manifest, options = {}) {
  const discoveryDb = buildDiscoveryDb(manifest, options);
  const factsJsonl = discoveryDb.facts.map((fact) => JSON.stringify(fact)).join("\n");
  const coverage = discoveryDb.coverage;
  const inputFindings = collectRedactionFindings(manifest, "$", [], { ignoreLocationKeys: true });
  const deniedSourceLocationFindings = Array.isArray(discoveryDb.safety?.deniedSourceLocationFindings)
    ? discoveryDb.safety.deniedSourceLocationFindings
    : [];
  const outputFindings = collectRedactionFindings(discoveryDb);
  const ok =
    discoveryDb.validation.ok &&
    inputFindings.length === 0 &&
    deniedSourceLocationFindings.length === 0 &&
    outputFindings.length === 0;
  return {
    schemaVersion: DISCOVERY_PACK_SCHEMA_VERSION,
    ok,
    files: {
      discoveryDb: DISCOVERY_DB_FILENAME,
      facts: DISCOVERY_FACTS_FILENAME,
      coverage: DISCOVERY_COVERAGE_FILENAME,
    },
    discoveryDb,
    factsJsonl: factsJsonl.length > 0 ? `${factsJsonl}\n` : "",
    coverage,
    checks: [
      {
        id: "manifest_validation",
        pass: discoveryDb.validation.ok,
        message: discoveryDb.validation.ok ? "discovery manifest is valid" : "discovery manifest has validation errors",
      },
      {
        id: "input_redaction",
        pass: inputFindings.length === 0,
        message:
          inputFindings.length === 0
            ? "discovery manifest input contains no secret-like string values or host absolute paths"
            : `discovery manifest input contained sensitive string values at ${inputFindings.join(", ")}`,
      },
      {
        id: "durable_source_location_policy",
        pass: deniedSourceLocationFindings.length === 0,
        message:
          deniedSourceLocationFindings.length === 0
            ? "source_inventory locations are safe to persist"
            : `source_inventory locations were denied by durable privacy policy at ${deniedSourceLocationFindings.join(", ")}`,
      },
      {
        id: "managed_evidence_sanitized",
        pass: outputFindings.length === 0,
        message:
          outputFindings.length === 0
            ? "managed discovery pack contains no secret-like string values or host absolute paths"
            : "managed discovery pack contains sensitive string values",
      },
    ],
  };
}

export async function writeDiscoveryPack(outDir, pack) {
  const prepared = prepareDiscoveryPack(pack);
  const root = path.resolve(outDir);
  const discoveryDbPath = path.join(root, DISCOVERY_DB_FILENAME);
  const factsPath = path.join(root, DISCOVERY_FACTS_FILENAME);
  const coveragePath = path.join(root, DISCOVERY_COVERAGE_FILENAME);
  await writePersistableJsonAtomic(discoveryDbPath, pack.discoveryDb, { subject: "discovery-db" });
  await writePersistableTextAtomic(factsPath, prepared.factsJsonl, { subject: "discovery-facts" });
  await writePersistableJsonAtomic(coveragePath, pack.coverage, { subject: "discovery-coverage" });
  return {
    outDir: ".",
    discoveryDbPath: DISCOVERY_DB_FILENAME,
    factsPath: DISCOVERY_FACTS_FILENAME,
    coveragePath: DISCOVERY_COVERAGE_FILENAME,
  };
}

export function formatDiscoveryPack(pack, paths = {}) {
  const lines = [
    `AgentMo discovery pack: ${pack.discoveryDb.agentId ?? "unknown"}`,
    `Status: ${pack.ok ? "pass" : "fail"}`,
    `Sources: ${pack.discoveryDb.coverage.sourceCount}`,
    `Facts: ${pack.discoveryDb.coverage.factCount}`,
    `Database outputs: ${pack.discoveryDb.coverage.databaseOutputCount}`,
    `Retrieval outputs: ${pack.discoveryDb.coverage.retrievalOutputCount}`,
  ];
  if (paths.discoveryDbPath) lines.push(`Discovery DB: ${paths.discoveryDbPath}`);
  if (paths.factsPath) lines.push(`Facts: ${paths.factsPath}`);
  if (paths.coveragePath) lines.push(`Coverage: ${paths.coveragePath}`);
  for (const check of pack.checks) lines.push(`- ${check.pass ? "PASS" : "FAIL"} ${check.id}: ${check.message}`);
  return `${lines.join("\n")}\n`;
}

function sanitizeSource(source, options = {}) {
  return {
    id: sanitizeText(source.id ?? ""),
    type: sanitizeText(source.type ?? ""),
    trustLevel: sanitizeText(source.trust_level ?? ""),
    description: sanitizeText(source.description ?? ""),
    location:
      options.normalizeSourceLocations === false
        ? sanitizeRawSourceLocation(source.location, options)
        : safeSourceLocation(source.location, options.repoRoot),
    extractionFields: sanitizeStringArray(source.extraction_fields),
  };
}

function sanitizeRawSourceLocation(location, options = {}) {
  if (typeof location !== "string" || location.trim().length === 0 || location.includes("\0")) return null;
  const trimmed = location.trim();
  if (options.applyDurableLocationPolicy !== false && isDeniedDurableLocation(trimmed)) return null;
  return redactSecrets(trimmed);
}

function safeSourceLocation(location, repoRoot = MODULE_REPO_ROOT) {
  if (typeof location !== "string" || location.trim().length === 0 || location.includes("\0")) return null;
  const trimmed = location.trim();
  if (path.isAbsolute(trimmed)) return safeAbsoluteSourcePath(trimmed, repoRoot);
  if (isWindowsAbsolutePath(trimmed)) return safeWindowsAbsoluteSourcePath(trimmed, repoRoot);

  const parsedUrl = parseAbsoluteUrl(trimmed);
  if (parsedUrl?.protocol === "file:") {
    try {
      return safeAbsoluteSourcePath(fileURLToPath(parsedUrl), repoRoot);
    } catch {
      return null;
    }
  }
  if (parsedUrl) return isDeniedDurableLocation(trimmed) ? null : sanitizeText(trimmed);

  if (isDeniedDurableLocation(trimmed)) return null;
  return sanitizeText(trimmed);
}

function safeAbsoluteSourcePath(location, repoRoot = MODULE_REPO_ROOT) {
  const absoluteRepoRoot = path.resolve(repoRoot ?? MODULE_REPO_ROOT);
  const absoluteLocation = path.resolve(location);
  if (!isPathInsideOrEqual(absoluteLocation, absoluteRepoRoot)) return null;
  const relativePath = normalizeSlashes(path.relative(absoluteRepoRoot, absoluteLocation));
  if (isDeniedDurableLocation(relativePath)) return null;
  return relativePath.length > 0 ? sanitizeText(relativePath) : null;
}

function safeWindowsAbsoluteSourcePath(location, repoRoot = MODULE_REPO_ROOT) {
  if (!isWindowsAbsolutePath(repoRoot)) return null;
  const absoluteRepoRoot = path.win32.resolve(repoRoot);
  const absoluteLocation = path.win32.resolve(location);
  const relativePath = path.win32.relative(absoluteRepoRoot, absoluteLocation);
  if (relativePath === "" || relativePath.startsWith("..") || path.win32.isAbsolute(relativePath)) return null;
  const normalizedRelativePath = relativePath.split("\\").join("/");
  if (isDeniedDurableLocation(normalizedRelativePath)) return null;
  return normalizedRelativePath.length > 0 ? sanitizeText(normalizedRelativePath) : null;
}

function parseAbsoluteUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isWindowsAbsolutePath(value) {
  return typeof value === "string" && /^(?:[a-zA-Z]:[\\/]|\\\\)/u.test(value);
}

function safeManifestPath(manifestPath, repoRoot = MODULE_REPO_ROOT) {
  if (typeof manifestPath !== "string" || manifestPath.trim().length === 0) return null;
  if (manifestPath.includes("\0")) return null;
  const absoluteRepoRoot = path.resolve(repoRoot ?? MODULE_REPO_ROOT);
  const absoluteManifestPath = path.resolve(absoluteRepoRoot, manifestPath);
  if (!isPathInsideOrEqual(absoluteManifestPath, absoluteRepoRoot)) return null;
  const relativePath = normalizeSlashes(path.relative(absoluteRepoRoot, absoluteManifestPath));
  return relativePath.length > 0 ? sanitizeText(relativePath) : null;
}

function isPathInsideOrEqual(childPath, parentPath) {
  const relativePath = path.relative(parentPath, childPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function normalizeSlashes(value) {
  return value.split(path.sep).join("/");
}

function summarizeCoverage(sources, facts, databaseOutputs, retrievalOutputs, userNeedInputs) {
  return {
    sourceCount: sources.length,
    factCount: facts.length,
    databaseOutputCount: databaseOutputs.length,
    retrievalOutputCount: retrievalOutputs.length,
    userNeedInputCount: userNeedInputs.length,
    sourceTypes: countBy(sources.map((source) => source.type)),
    trustLevels: countBy(sources.map((source) => source.trustLevel)),
    sourceIds: sources.map((source) => source.id),
  };
}

function sanitizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string").map((item) => sanitizeText(item));
}

function sanitizeText(value) {
  return redactManagedText(String(value));
}

function sanitizeValidation(validation) {
  return {
    ok: Boolean(validation?.ok),
    warnings: sanitizeStringArray(validation?.warnings),
    errors: sanitizeStringArray(validation?.errors),
  };
}

function collectRedactionFindings(value, pointer = "$", findings = [], options = {}) {
  if (typeof value === "string") {
    if (containsSecretLikeValue(value) || containsHostAbsolutePath(value)) findings.push(pointer);
    return findings;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) collectRedactionFindings(item, `${pointer}[${index}]`, findings, options);
    return findings;
  }
  if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (options.ignoreLocationKeys === true && key === "location") continue;
      collectRedactionFindings(item, `${pointer}.${key}`, findings, options);
    }
  }
  return findings;
}

function collectDeniedSourceLocationFindings(sourceInventory) {
  const findings = [];
  for (const [index, source] of sourceInventory.entries()) {
    if (typeof source.location === "string" && isDeniedDurableLocation(source.location)) {
      findings.push(`$.source_inventory[${index}].location`);
    }
  }
  return findings;
}

function countBy(values) {
  const counts = {};
  for (const value of values.filter((item) => typeof item === "string" && item.length > 0).sort()) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

export async function writeJsonAtomic(filePath, value) {
  await writePersistableJsonAtomic(filePath, value, { subject: "discovery-json" });
}

export async function writeTextAtomic(filePath, content) {
  assertPersistable(content, { subject: "discovery-text" });
  await writePersistableTextAtomic(filePath, content, { subject: "discovery-text" });
}

export function serializeDiscoveryJsonl(records, subject = "discovery-jsonl") {
  assertPersistable(records, { subject });
  const lines = records.map((record) => {
    assertPersistable(record, { subject });
    return JSON.stringify(record);
  });
  const text = lines.length > 0 ? `${lines.join("\n")}\n` : "";
  assertPersistable(text, { subject });
  return text;
}

function prepareDiscoveryPack(pack) {
  assertPersistable(pack, { subject: "discovery-pack" });
  const factsJsonl = serializeDiscoveryJsonl(pack.discoveryDb.facts, "discovery-facts");
  if (pack.factsJsonl !== factsJsonl) throw new PersistabilityError("AGENTMO_PERSISTABILITY_CANDIDATE_MISMATCH");
  return {
    discoveryDbText: serializePersistableJson(pack.discoveryDb, { subject: "discovery-db" }),
    factsJsonl,
    coverageText: serializePersistableJson(pack.coverage, { subject: "discovery-coverage" }),
  };
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
