import { createHash } from "node:crypto";
import { realpath, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDiscoveryDb,
  DISCOVERY_COVERAGE_FILENAME,
  DISCOVERY_DB_FILENAME,
  DISCOVERY_FACTS_FILENAME,
  writeJsonAtomic,
  writeTextAtomic,
} from "./discovery-db.js";
import { containsHostAbsolutePath, containsSecretLikeValue, redactManagedText } from "./secret-redaction.js";

export const DISCOVERY_WORKSPACE_SCHEMA_VERSION = "agentmo.discovery-workspace.v1";
export const SOURCE_CARDS_SCHEMA_VERSION = "agentmo.source-cards.v1";
export const SOURCE_CARDS_FILENAME = "source-cards.json";
export const SOURCE_CHUNKS_FILENAME = "source-chunks.jsonl";

const MODULE_REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const SUPPORTED_EXTENSIONS = new Set([".md", ".txt", ".json"]);
const DENIED_EXTENSIONS = new Set([".pem", ".key", ".p12", ".crt", ".cer", ".pfx"]);
const DENIED_FILENAMES = new Set([
  ".env",
  "credentials.json",
  "credential.json",
  "secrets.json",
  "secret.json",
  "tokens.json",
  "token.json",
  "credentials.txt",
  "credential.txt",
  "secrets.txt",
  "secret.txt",
  "tokens.txt",
  "token.txt",
]);
const DEFAULT_MAX_CHUNK_CHARS = 1200;
const DEFAULT_MAX_CHUNKS_PER_SOURCE = 8;
const DEFAULT_PREVIEW_CHARS = 400;

export async function buildDiscoveryWorkspace(manifest, options = {}) {
  const repoRoot = path.resolve(options.repoRoot ?? MODULE_REPO_ROOT);
  const sourceRootInput = options.sourceRoot ?? ".";
  const baseDb = buildDiscoveryDb(manifest, {
    manifestPath: options.manifestPath,
    normalizeSourceLocations: false,
    applyDurableLocationPolicy: false,
  });
  const sources = Array.isArray(baseDb.sources) ? baseDb.sources : [];
  const rootCheck = await resolveSourceRoot(sourceRootInput, repoRoot);
  const safeSourceManifest = sanitizeWorkspaceSourceManifest(baseDb.sourceManifest, options.manifestPath, repoRoot);
  const cards = [];
  const chunks = [];
  const workspaceChecks = [];
  const manifestRedactionCount = Number(baseDb.safety?.redactedInputStringCount ?? 0);

  workspaceChecks.push({
    id: "manifest_input_redaction",
    pass: manifestRedactionCount === 0,
    message:
      manifestRedactionCount === 0
        ? "discovery manifest input contains no secret-like string values"
        : `discovery manifest input contained ${manifestRedactionCount} secret-like string value(s) and was redacted`,
  });
  workspaceChecks.push(rootCheck.check);

  if (!rootCheck.ok) {
    for (const source of sources) {
      cards.push(rejectedCard(source, rootCheck.check.message, "source_root_outside_repo"));
    }
  } else {
    for (const source of sources) {
      const result = await ingestSource(source, rootCheck, options);
      cards.push(result.card);
      chunks.push(...result.chunks);
      workspaceChecks.push(...result.checks);
    }
  }

  const safeLocationBySourceId = new Map(
    cards
      .filter((card) => typeof card.sourceId === "string")
      .map((card) => [card.sourceId, typeof card.location === "string" && card.location.length > 0 ? card.location : null]),
  );
  const safeSources = baseDb.sources.map((source) =>
    safeLocationBySourceId.has(source.id) ? { ...source, location: safeLocationBySourceId.get(source.id) } : { ...source, location: null },
  );
  const safeBaseFacts = baseDb.facts.map((fact) => normalizeFactLocation(fact, safeLocationBySourceId));
  const sourceChunkFacts = chunks.map(sourceChunkToFact);
  const discoveryDb = {
    ...baseDb,
    sourceManifest: safeSourceManifest,
    sources: safeSources,
    facts: [...safeBaseFacts, ...sourceChunkFacts],
  };
  const sourceCards = {
    schemaVersion: SOURCE_CARDS_SCHEMA_VERSION,
    version: 1,
    sourceRoot: rootCheck.safeSourceRoot,
    cards,
  };
  const sourceChunksJsonl = chunks.map((chunk) => JSON.stringify(chunk)).join("\n");
  const redactionCount = cards.reduce((total, card) => total + Number(card.redactionCount ?? 0), 0);
  const truncationCount = cards.filter((card) => card.truncated === true).length + chunks.filter((chunk) => chunk.truncated === true).length;
  const outputFindings = collectSensitiveOutputFindings({ discoveryDb, sourceCards, chunks });
  const outputSecretCheck = {
    id: "managed_workspace_output_sanitized",
    pass: outputFindings.length === 0,
    message:
      outputFindings.length === 0
        ? "managed discovery workspace artifacts contain no secret-like string values or host absolute paths"
        : `managed discovery workspace artifacts contain sensitive string values at ${outputFindings.join(", ")}`,
  };
  workspaceChecks.push(outputSecretCheck);

  const workspaceOk = workspaceChecks.every((check) => check.pass);
  const workspaceFindings = workspaceChecks.filter((check) => !check.pass).map((check) => `${check.id}: ${check.message}`);
  const coverage = buildWorkspaceCoverage({
    baseCoverage: baseDb.coverage,
    cards,
    chunks,
    checks: workspaceChecks,
    factCount: discoveryDb.facts.length,
    redactionCount,
    truncationCount,
  });
  const validationErrors = Array.isArray(baseDb.validation?.errors) ? [...baseDb.validation.errors] : [];
  if (!workspaceOk) validationErrors.push(...workspaceFindings);

  discoveryDb.coverage = coverage;
  discoveryDb.safety = {
    ...discoveryDb.safety,
    workspaceOk,
    workspaceFindings,
    sourceRedactionCount: redactionCount,
    workspaceManagedEvidence: ["source cards", "bounded source chunks", "source_chunk facts"],
  };
  discoveryDb.validation = {
    ok: Boolean(baseDb.validation?.ok) && workspaceOk,
    warnings: Array.isArray(baseDb.validation?.warnings) ? baseDb.validation.warnings : [],
    errors: validationErrors,
  };
  discoveryDb.workspace = {
    schemaVersion: DISCOVERY_WORKSPACE_SCHEMA_VERSION,
    ok: workspaceOk,
    sourceRoot: rootCheck.safeSourceRoot,
    artifactFiles: {
      discoveryDb: DISCOVERY_DB_FILENAME,
      facts: DISCOVERY_FACTS_FILENAME,
      coverage: DISCOVERY_COVERAGE_FILENAME,
      sourceCards: SOURCE_CARDS_FILENAME,
      sourceChunks: SOURCE_CHUNKS_FILENAME,
    },
    checks: workspaceChecks,
  };

  const factsJsonl = discoveryDb.facts.map((fact) => JSON.stringify(fact)).join("\n");
  const checks = [
    {
      id: "manifest_validation",
      pass: Boolean(baseDb.validation?.ok),
      message: baseDb.validation?.ok ? "discovery manifest is valid" : "discovery manifest has validation errors",
    },
    ...workspaceChecks,
  ];
  const ok = Boolean(discoveryDb.validation.ok) && checks.every((check) => check.pass);

  return {
    schemaVersion: DISCOVERY_WORKSPACE_SCHEMA_VERSION,
    ok,
    agentId: discoveryDb.agentId,
    files: {
      discoveryDb: DISCOVERY_DB_FILENAME,
      facts: DISCOVERY_FACTS_FILENAME,
      coverage: DISCOVERY_COVERAGE_FILENAME,
      sourceCards: SOURCE_CARDS_FILENAME,
      sourceChunks: SOURCE_CHUNKS_FILENAME,
    },
    checks,
    discoveryDb,
    factsJsonl: factsJsonl.length > 0 ? `${factsJsonl}\n` : "",
    coverage,
    sourceCards,
    sourceChunksJsonl: sourceChunksJsonl.length > 0 ? `${sourceChunksJsonl}\n` : "",
  };
}

export async function writeDiscoveryWorkspace(outDir, workspace) {
  const root = path.resolve(outDir);
  const discoveryDbPath = path.join(root, DISCOVERY_DB_FILENAME);
  const factsPath = path.join(root, DISCOVERY_FACTS_FILENAME);
  const coveragePath = path.join(root, DISCOVERY_COVERAGE_FILENAME);
  const sourceCardsPath = path.join(root, SOURCE_CARDS_FILENAME);
  const sourceChunksPath = path.join(root, SOURCE_CHUNKS_FILENAME);
  await writeJsonAtomic(discoveryDbPath, workspace.discoveryDb);
  await writeTextAtomic(factsPath, workspace.factsJsonl);
  await writeJsonAtomic(coveragePath, workspace.coverage);
  await writeJsonAtomic(sourceCardsPath, workspace.sourceCards);
  await writeTextAtomic(sourceChunksPath, workspace.sourceChunksJsonl);
  return {
    outDir: ".",
    discoveryDbPath: DISCOVERY_DB_FILENAME,
    factsPath: DISCOVERY_FACTS_FILENAME,
    coveragePath: DISCOVERY_COVERAGE_FILENAME,
    sourceCardsPath: SOURCE_CARDS_FILENAME,
    sourceChunksPath: SOURCE_CHUNKS_FILENAME,
  };
}

export function formatDiscoveryWorkspace(workspace, paths = {}) {
  const lines = [
    `AgentMo discovery workspace: ${workspace.agentId ?? "unknown"}`,
    `Status: ${workspace.ok ? "pass" : "fail"}`,
    `Sources: ${workspace.coverage.workspace.sourceCount}`,
    `Ingested: ${workspace.coverage.workspace.ingestedCount}`,
    `Rejected: ${workspace.coverage.workspace.rejectedCount}`,
    `Chunks: ${workspace.coverage.workspace.chunkCount}`,
  ];
  if (paths.discoveryDbPath) lines.push(`Discovery DB: ${paths.discoveryDbPath}`);
  if (paths.factsPath) lines.push(`Facts: ${paths.factsPath}`);
  if (paths.coveragePath) lines.push(`Coverage: ${paths.coveragePath}`);
  if (paths.sourceCardsPath) lines.push(`Source cards: ${paths.sourceCardsPath}`);
  if (paths.sourceChunksPath) lines.push(`Source chunks: ${paths.sourceChunksPath}`);
  for (const check of workspace.checks) lines.push(`- ${check.pass ? "PASS" : "FAIL"} ${check.id}: ${check.message}`);
  return `${lines.join("\n")}\n`;
}

async function resolveSourceRoot(sourceRootInput, repoRoot) {
  const resolvedInput = path.resolve(sourceRootInput);
  let repoRealpath;
  let sourceRootRealpath;
  try {
    repoRealpath = await realpath(repoRoot);
  } catch (error) {
    return failedRootCheck(`repository root could not be resolved${safeErrorCode(error)}`);
  }
  try {
    sourceRootRealpath = await realpath(resolvedInput);
  } catch (error) {
    return failedRootCheck(`source-root could not be resolved${safeErrorCode(error)}`);
  }
  let rootStat;
  try {
    rootStat = await stat(sourceRootRealpath);
  } catch (error) {
    return failedRootCheck(`source-root could not be inspected${safeErrorCode(error)}`);
  }
  if (!rootStat.isDirectory()) {
    return failedRootCheck("source-root must be a directory");
  }
  if (!isPathInsideOrEqual(sourceRootRealpath, repoRealpath)) {
    return failedRootCheck("source-root realpath is outside the AgentMo repository root");
  }
  return {
    ok: true,
    repoRoot: repoRealpath,
    sourceRoot: sourceRootRealpath,
    safeSourceRoot: normalizeSlashes(path.relative(repoRealpath, sourceRootRealpath)) || ".",
    check: {
      id: "source_root_inside_repo",
      pass: true,
      message: "source-root realpath is inside the AgentMo repository root",
    },
  };
}

function failedRootCheck(message) {
  return {
    ok: false,
    sourceRoot: null,
    safeSourceRoot: null,
    check: {
      id: "source_root_inside_repo",
      pass: false,
      message,
    },
  };
}

function sanitizeWorkspaceSourceManifest(sourceManifest, manifestPath, repoRoot) {
  return {
    ...(isObject(sourceManifest) ? sourceManifest : {}),
    path: safeWorkspaceManifestPath(manifestPath, repoRoot),
  };
}

function safeWorkspaceManifestPath(manifestPath, repoRoot) {
  if (typeof manifestPath !== "string" || manifestPath.trim().length === 0) return null;
  if (manifestPath.includes("\0")) return null;
  const absoluteManifestPath = path.resolve(manifestPath);
  const absoluteRepoRoot = path.resolve(repoRoot);
  if (!isPathInsideOrEqual(absoluteManifestPath, absoluteRepoRoot)) return null;
  return normalizeSlashes(path.relative(absoluteRepoRoot, absoluteManifestPath)) || null;
}

async function ingestSource(source, rootCheck, options) {
  const checks = [];
  const location = typeof source.location === "string" ? source.location : "";
  const baseCard = sourceCardBase(source, durableSourceLocation(location, rootCheck));
  if (location.trim().length === 0) {
    return rejectSource(baseCard, "source location is required", "missing_location", checks);
  }
  if (location.includes("\0")) {
    return rejectSource(baseCard, "source location contains a NUL byte", "invalid_location", checks);
  }
  if (hasTraversalSegment(location)) {
    return rejectSource(baseCard, "source location contains traversal and is outside source-root policy", "path_traversal", checks);
  }
  const basename = path.basename(location).toLowerCase();
  const manifestExtension = path.extname(location).toLowerCase();
  if (isDeniedFilename(basename, manifestExtension)) {
    return rejectSource(baseCard, "source filename or credential extension is denied", "denied_secret_filename", checks);
  }
  if (!SUPPORTED_EXTENSIONS.has(manifestExtension)) {
    return rejectSource(baseCard, "source extension is not supported", "unsupported_extension", checks);
  }

  const candidate = path.isAbsolute(location) ? path.resolve(location) : path.resolve(rootCheck.sourceRoot, location);
  if (!isPathInsideOrEqual(candidate, rootCheck.sourceRoot)) {
    return rejectSource(baseCard, "source location resolves outside source-root", "outside_source_root", checks);
  }

  let fileRealpath;
  try {
    fileRealpath = await realpath(candidate);
  } catch (error) {
    return rejectSource(baseCard, `source realpath failed before read${safeErrorCode(error)}`, "realpath_failed", checks);
  }
  if (!isPathInsideOrEqual(fileRealpath, rootCheck.sourceRoot)) {
    return rejectSource(baseCard, "source realpath/symlink escape outside source-root", "symlink_escape", checks);
  }
  const realBasename = path.basename(fileRealpath).toLowerCase();
  const realExtension = path.extname(fileRealpath).toLowerCase();
  if (isDeniedFilename(realBasename, realExtension)) {
    return rejectSource(baseCard, "source realpath target is denied by filename policy", "denied_secret_filename", checks);
  }
  if (!SUPPORTED_EXTENSIONS.has(realExtension)) {
    return rejectSource(baseCard, "source realpath target extension is not supported", "unsupported_extension", checks);
  }
  const safeLocation = normalizeSlashes(path.relative(rootCheck.sourceRoot, fileRealpath));
  if (!isSafeDurableLocation(safeLocation)) {
    return rejectSource(baseCard, "source realpath target is not safe to persist", "unsafe_realpath_location", checks);
  }
  const safeBaseCard = { ...baseCard, location: safeLocation };

  let fileStat;
  try {
    fileStat = await stat(fileRealpath);
  } catch (error) {
    return rejectSource(safeBaseCard, `source stat failed before read${safeErrorCode(error)}`, "stat_failed", checks);
  }
  if (!fileStat.isFile()) {
    return rejectSource(safeBaseCard, "source path is not a regular file", "not_file", checks);
  }

  let raw;
  try {
    raw = await readFile(fileRealpath, "utf8");
  } catch (error) {
    return rejectSource(safeBaseCard, `source read failed${safeErrorCode(error)}`, "read_failed", checks);
  }

  const parsed = parseSourceText(raw, realExtension);
  if (!parsed.ok) {
    return rejectSource(safeBaseCard, parsed.reason, "parse_failed", checks);
  }

  const rawSecretLike = containsSecretLikeValue(parsed.text);
  const rawHostPathLike = containsHostAbsolutePath(parsed.text);
  const redactedText = redactManagedText(parsed.text);
  const outputSecretLike = containsSecretLikeValue(redactedText);
  const outputHostPathLike = containsHostAbsolutePath(redactedText);
  const normalizedText = normalizeText(redactedText);
  const chunks = chunkSourceText(source, normalizedText, {
    location: safeLocation,
    extension: realExtension,
    maxChunkChars: options.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS,
    maxChunksPerSource: options.maxChunksPerSource ?? DEFAULT_MAX_CHUNKS_PER_SOURCE,
  });
  if (chunks.length === 0) {
    return rejectSource(safeBaseCard, "source produced zero bounded chunks after normalization", "empty_source", checks);
  }
  const preview = boundedString(normalizedText, options.previewChars ?? DEFAULT_PREVIEW_CHARS);
  const truncated = preview.truncated || chunks.some((chunk) => chunk.truncated === true);
  const lineCount = countLines(parsed.text);
  const card = {
    ...safeBaseCard,
    status: "ingested",
    reason: null,
    extension: realExtension,
    byteSize: fileStat.size,
    contentHash: sha256(normalizedText),
    hashAlgorithm: "sha256:redacted-content",
    lineCount,
    preview: preview.text,
    redacted: rawSecretLike || rawHostPathLike,
    redactionCount: rawSecretLike || rawHostPathLike ? 1 : 0,
    truncated,
    chunkCount: chunks.length,
  };

  checks.push({
    id: `source_ingested:${source.id}`,
    pass: true,
    sourceId: source.id,
    message: `source ingested from ${card.location}`,
  });
  if (rawSecretLike) {
    checks.push({
      id: `source_secret_detection:${source.id}`,
      pass: false,
      sourceId: source.id,
      message: "source content contained secret-like values and was redacted",
    });
  }
  if (outputSecretLike) {
    checks.push({
      id: `source_output_secret_detection:${source.id}`,
      pass: false,
      sourceId: source.id,
      message: "redacted source output still contains secret-like values",
    });
  }
  if (outputHostPathLike) {
    checks.push({
      id: `source_output_path_detection:${source.id}`,
      pass: false,
      sourceId: source.id,
      message: "redacted source output still contains host absolute paths",
    });
  }
  return { card, chunks, checks };
}

function parseSourceText(raw, extension) {
  if (extension === ".json") {
    try {
      return { ok: true, text: stableStringify(JSON.parse(raw)) };
    } catch {
      return { ok: false, reason: "JSON source parse failed" };
    }
  }
  return { ok: true, text: raw };
}

function chunkSourceText(source, text, options) {
  const chunks = [];
  const lines = text.split("\n");
  let index = 0;
  let lineNumber = 1;
  while (index < lines.length && chunks.length < options.maxChunksPerSource) {
    const startLine = lineNumber;
    const piece = [];
    let size = 0;
    let chunkWasTruncated = false;
    while (index < lines.length) {
      const nextLine = lines[index];
      const addition = piece.length === 0 ? nextLine : `\n${nextLine}`;
      if (piece.length > 0 && size + addition.length > options.maxChunkChars) break;
      if (piece.length === 0 && addition.length > options.maxChunkChars) {
        piece.push(addition.slice(0, options.maxChunkChars));
        size = options.maxChunkChars;
        chunkWasTruncated = true;
        index += 1;
        lineNumber += 1;
        break;
      }
      piece.push(piece.length === 0 ? nextLine : addition);
      size += addition.length;
      index += 1;
      lineNumber += 1;
      if (size >= options.maxChunkChars) break;
    }
    const chunkText = piece.join("").trim();
    if (chunkText.length > 0) {
      const chunkNumber = chunks.length + 1;
      chunks.push({
        id: `${source.id}:chunk:${String(chunkNumber).padStart(2, "0")}`,
        sourceId: source.id,
        kind: "source_chunk",
        text: chunkText,
        trustLevel: source.trustLevel,
        refs: [options.location].filter((item) => typeof item === "string" && item.length > 0),
        ref: {
          sourceId: source.id,
          location: options.location,
          lineStart: startLine,
          lineEnd: Math.max(startLine, lineNumber - 1),
        },
        tags: [source.type, options.extension.replace(/^\./u, "")].filter((item) => item.length > 0),
        limits: {
          maxChunkChars: options.maxChunkChars,
          maxChunksPerSource: options.maxChunksPerSource,
        },
        truncated: chunkWasTruncated,
      });
    }
  }
  if (index < lines.length && chunks.length > 0) chunks[chunks.length - 1].truncated = true;
  return chunks;
}

function sourceChunkToFact(chunk) {
  return {
    id: chunk.id,
    sourceId: chunk.sourceId,
    kind: "source_chunk",
    text: chunk.text,
    trustLevel: chunk.trustLevel,
    refs: chunk.refs,
    tags: chunk.tags,
    ref: chunk.ref,
    limits: chunk.limits,
    truncated: chunk.truncated,
  };
}

function normalizeFactLocation(fact, safeLocationBySourceId) {
  if (!safeLocationBySourceId.has(fact.sourceId)) return fact;
  const safeLocation = safeLocationBySourceId.get(fact.sourceId);
  const normalized = { ...fact };
  if (Array.isArray(fact.refs)) normalized.refs = typeof safeLocation === "string" && safeLocation.length > 0 ? [safeLocation] : [];
  if (isObject(fact.ref) && typeof fact.ref.location === "string") {
    normalized.ref = {
      ...fact.ref,
      location: typeof safeLocation === "string" && safeLocation.length > 0 ? safeLocation : null,
    };
  }
  return normalized;
}

function rejectSource(baseCard, reason, code, checks) {
  const safeReason = genericRejectionReason(code, reason);
  const card = {
    ...baseCard,
    location: null,
    status: "rejected",
    reason: safeReason,
    rejectionCode: code,
    redacted: false,
    redactionCount: 0,
    truncated: false,
    chunkCount: 0,
  };
  return {
    card,
    chunks: [],
    checks: [
      ...checks,
      {
        id: `source_rejected:${baseCard.sourceId}`,
        pass: false,
        sourceId: baseCard.sourceId,
        reason: code,
        message: safeReason,
      },
    ],
  };
}

function rejectedCard(source, reason, code) {
  return {
    ...sourceCardBase(source, null),
    status: "rejected",
    reason: genericRejectionReason(code, reason),
    rejectionCode: code,
    redacted: false,
    redactionCount: 0,
    truncated: false,
    chunkCount: 0,
  };
}

function sourceCardBase(source, location) {
  return {
    sourceId: source.id,
    type: source.type,
    trustLevel: source.trustLevel,
    description: source.description,
    location: typeof location === "string" && location.length > 0 ? normalizeSlashes(location) : null,
  };
}

function buildWorkspaceCoverage({ baseCoverage, cards, chunks, checks, factCount, redactionCount, truncationCount }) {
  const rejectedCards = cards.filter((card) => card.status === "rejected");
  const skippedCards = cards.filter((card) => card.status === "skipped");
  const ingestedCards = cards.filter((card) => card.status === "ingested");
  const rejectionReasons = countBy(rejectedCards.map((card) => card.rejectionCode ?? card.reason ?? "rejected"));
  const workspace = {
    sourceCount: cards.length,
    ingestedCount: ingestedCards.length,
    skippedCount: skippedCards.length,
    rejectedCount: rejectedCards.length,
    chunkCount: chunks.length,
    redactionCount,
    truncationCount,
    rejectionReasons,
    checks: checks.map((check) => ({ id: check.id, pass: check.pass, message: check.message })),
  };
  return {
    ...baseCoverage,
    factCount,
    workspaceSourceCount: workspace.sourceCount,
    workspaceIngestedCount: workspace.ingestedCount,
    workspaceSkippedCount: workspace.skippedCount,
    workspaceRejectedCount: workspace.rejectedCount,
    workspaceChunkCount: workspace.chunkCount,
    workspaceRedactionCount: workspace.redactionCount,
    workspaceTruncationCount: workspace.truncationCount,
    workspaceRejectionReasons: workspace.rejectionReasons,
    workspace,
  };
}

function collectSensitiveOutputFindings(value, pointer = "$", findings = []) {
  if (typeof value === "string") {
    if (containsSecretLikeValue(value) || containsHostAbsolutePath(value)) findings.push(pointer);
    return findings;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) collectSensitiveOutputFindings(item, `${pointer}[${index}]`, findings);
    return findings;
  }
  if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) collectSensitiveOutputFindings(item, `${pointer}.${key}`, findings);
  }
  return findings;
}

function isDeniedFilename(basename, extension) {
  if (DENIED_EXTENSIONS.has(extension)) return true;
  if (DENIED_FILENAMES.has(basename)) return true;
  if (basename.startsWith(".env.")) return true;
  return /^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519|private-key|private_key)$/u.test(basename);
}

function hasTraversalSegment(location) {
  return location.split(/[\\/]+/u).includes("..");
}

function boundedString(value, limit) {
  const text = String(value).trim();
  if (text.length <= limit) return { text, truncated: false };
  return { text: text.slice(0, limit), truncated: true };
}

function normalizeText(value) {
  return String(value).replace(/\r\n?/gu, "\n").trim();
}

function countLines(value) {
  const normalized = String(value).replace(/\r\n?/gu, "\n");
  if (normalized.length === 0) return 0;
  return normalized.split("\n").length;
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function countBy(values) {
  const counts = {};
  for (const value of values.filter((item) => typeof item === "string" && item.length > 0).sort()) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function isPathInsideOrEqual(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function durableSourceLocation(location, rootCheck) {
  if (!rootCheck?.ok || typeof rootCheck.sourceRoot !== "string") return null;
  if (typeof location !== "string" || location.trim().length === 0 || location.includes("\0")) return null;
  const candidate = path.isAbsolute(location) ? path.resolve(location) : path.resolve(rootCheck.sourceRoot, location);
  if (!isPathInsideOrEqual(candidate, rootCheck.sourceRoot)) return null;
  const relativeLocation = normalizeSlashes(path.relative(rootCheck.sourceRoot, candidate)) || null;
  return isSafeDurableLocation(relativeLocation) ? relativeLocation : null;
}

function isSafeDurableLocation(location) {
  if (typeof location !== "string" || location.length === 0) return false;
  if (path.isAbsolute(location) || containsHostAbsolutePath(location) || containsSecretLikeValue(location)) return false;
  return !location
    .split("/")
    .filter((segment) => segment.length > 0)
    .some((segment) => isDeniedFilename(segment.toLowerCase(), path.extname(segment).toLowerCase()) || containsSecretLikeValue(segment));
}

function genericRejectionReason(code, fallback) {
  switch (code) {
    case "missing_location":
      return "source location is required";
    case "invalid_location":
      return "source location is invalid";
    case "path_traversal":
      return "source location is outside source-root policy";
    case "denied_secret_filename":
      return "source filename or credential extension is denied";
    case "unsupported_extension":
      return "source extension is not supported";
    case "outside_source_root":
      return "source location resolves outside source-root";
    case "realpath_failed":
      return "source realpath failed before read";
    case "symlink_escape":
      return "source realpath is outside source-root";
    case "unsafe_realpath_location":
      return "source realpath target is not safe to persist";
    case "stat_failed":
      return "source stat failed before read";
    case "not_file":
      return "source path is not a regular file";
    case "read_failed":
      return "source read failed";
    case "parse_failed":
      return typeof fallback === "string" && fallback.length > 0 ? fallback : "source parse failed";
    case "empty_source":
      return "source produced zero bounded chunks after normalization";
    case "source_root_outside_repo":
      return typeof fallback === "string" && fallback.length > 0 ? fallback : "source-root is outside policy";
    default:
      return "source was rejected by workspace safety policy";
  }
}

function normalizeSlashes(value) {
  return String(value).split(path.sep).join("/");
}

function safeErrorCode(error) {
  return typeof error?.code === "string" && error.code.length > 0 ? ` (${error.code})` : "";
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
