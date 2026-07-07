import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateDiscoveryManifest } from "./discovery.js";
import { containsSecretLikeValue, redactSecrets } from "./secret-redaction.js";

export const DISCOVERY_DB_SCHEMA_VERSION = "agentmo.discovery-db.v1";
export const DISCOVERY_PACK_SCHEMA_VERSION = "agentmo.discovery-pack.v1";
export const DISCOVERY_DB_FILENAME = "agentmo-discovery-db.json";
export const DISCOVERY_FACTS_FILENAME = "facts.jsonl";
export const DISCOVERY_COVERAGE_FILENAME = "coverage.json";

export async function loadDiscoveryDb(filePath) {
  const raw = await readFile(filePath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid discovery-db JSON ${filePath}: ${message}`);
  }
  if (parsed?.schemaVersion !== DISCOVERY_DB_SCHEMA_VERSION) {
    throw new Error(`Unsupported discovery-db schema: ${parsed?.schemaVersion ?? "missing"}`);
  }
  return parsed;
}

export function buildDiscoveryDb(manifest, options = {}) {
  const validation = validateDiscoveryManifest(manifest);
  const sourceInventory = Array.isArray(manifest?.source_inventory) ? manifest.source_inventory.filter(isObject) : [];
  const sources = sourceInventory.map((source) => sanitizeSource(source)).sort((left, right) => left.id.localeCompare(right.id));
  const facts = sources.flatMap((source) =>
    source.extractionFields.map((field, index) => ({
      id: `${source.id}:field:${String(index + 1).padStart(2, "0")}`,
      sourceId: source.id,
      kind: "extraction_field",
      text: field,
      trustLevel: source.trustLevel,
      refs: [source.location].filter((item) => item.length > 0),
      tags: [source.type],
    })),
  );
  const userNeedInputs = sanitizeStringArray(manifest?.user_need_inputs);
  const databaseOutputs = sanitizeStringArray(manifest?.database_outputs);
  const retrievalOutputs = sanitizeStringArray(manifest?.retrieval_outputs);
  const forbiddenDataHandling = sanitizeStringArray(manifest?.forbidden_data_handling);
  const redactionFindings = collectRedactionFindings(manifest);
  const db = {
    schemaVersion: DISCOVERY_DB_SCHEMA_VERSION,
    agentId: typeof manifest?.agent_id === "string" ? sanitizeText(manifest.agent_id) : null,
    sourceManifest: {
      schemaVersion: typeof manifest?.schemaVersion === "string" ? manifest.schemaVersion : null,
      path: typeof options.manifestPath === "string" ? path.resolve(options.manifestPath) : null,
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

export function buildDiscoveryPack(manifest, options = {}) {
  const discoveryDb = buildDiscoveryDb(manifest, options);
  const factsJsonl = discoveryDb.facts.map((fact) => JSON.stringify(fact)).join("\n");
  const coverage = discoveryDb.coverage;
  const inputFindings = collectRedactionFindings(manifest);
  const outputFindings = collectRedactionFindings(discoveryDb);
  const ok = discoveryDb.validation.ok && inputFindings.length === 0 && outputFindings.length === 0;
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
            ? "discovery manifest input contains no secret-like string values"
            : `discovery manifest input contained secret-like string values at ${inputFindings.join(", ")}`,
      },
      {
        id: "managed_evidence_sanitized",
        pass: outputFindings.length === 0,
        message: outputFindings.length === 0 ? "managed discovery pack contains no secret-like string values" : "managed discovery pack contains secret-like string values",
      },
    ],
  };
}

export async function writeDiscoveryPack(outDir, pack) {
  const root = path.resolve(outDir);
  await mkdir(root, { recursive: true });
  const discoveryDbPath = path.join(root, DISCOVERY_DB_FILENAME);
  const factsPath = path.join(root, DISCOVERY_FACTS_FILENAME);
  const coveragePath = path.join(root, DISCOVERY_COVERAGE_FILENAME);
  await writeJsonAtomic(discoveryDbPath, pack.discoveryDb);
  await writeTextAtomic(factsPath, pack.factsJsonl);
  await writeJsonAtomic(coveragePath, pack.coverage);
  return { outDir: root, discoveryDbPath, factsPath, coveragePath };
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

function sanitizeSource(source) {
  return {
    id: sanitizeText(source.id ?? ""),
    type: sanitizeText(source.type ?? ""),
    trustLevel: sanitizeText(source.trust_level ?? ""),
    description: sanitizeText(source.description ?? ""),
    location: sanitizeText(source.location ?? ""),
    extractionFields: sanitizeStringArray(source.extraction_fields),
  };
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
  return redactSecrets(String(value));
}

function collectRedactionFindings(value, pointer = "$", findings = []) {
  if (typeof value === "string") {
    if (containsSecretLikeValue(value)) findings.push(pointer);
    return findings;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) collectRedactionFindings(item, `${pointer}[${index}]`, findings);
    return findings;
  }
  if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) collectRedactionFindings(item, `${pointer}.${key}`, findings);
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

async function writeJsonAtomic(filePath, value) {
  await writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeTextAtomic(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryFile = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryFile, content, "utf8");
  await rename(temporaryFile, filePath);
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
