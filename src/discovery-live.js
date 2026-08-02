import { randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  rename,
  writeFile,
} from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import {
  buildDiscoveryDb,
  deriveDiscoveryRecordId,
  DISCOVERY_COVERAGE_FILENAME,
  DISCOVERY_DB_FILENAME,
  DISCOVERY_FACTS_FILENAME,
  serializeDiscoveryJsonl,
} from "./discovery-db.js";
import {
  isPublicNetworkAddress,
  normalizeDiscoveryLiveTransport,
} from "./discovery-live-transport.js";
import {
  buildDiscoveryObservations,
  buildDiscoveryRetrievalRecord,
} from "./discovery-provenance.js";
import {
  ARXIV_MIN_REQUEST_INTERVAL_MS,
  collectArxivSource,
} from "./collectors/arxiv.js";
import { collectGitHubSource } from "./collectors/github.js";
import { collectWebSource } from "./collectors/web.js";
import {
  assertPersistable,
  PersistabilityError,
  serializePersistableJson,
} from "./persistability.js";
import {
  SOURCE_CARDS_FILENAME,
  SOURCE_CARDS_SCHEMA_VERSION,
  SOURCE_CHUNKS_FILENAME,
} from "./discovery-source-workspace.js";
import {
  DISCOVERY_LIVE_POLICY_SCHEMA_VERSION,
  validateDiscoveryManifest,
} from "./discovery.js";

export const DISCOVERY_LIVE_SCHEMA_VERSION = "agentmo.discovery-live.v1";
export const DISCOVERY_RETRIEVALS_FILENAME = "retrievals.jsonl";

const DEFAULT_PUBLICATION_IO = Object.freeze({ mkdir, rename, writeFile });
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const LIVE_EVIDENCE_CLASSES = new Set(["primary", "first-party", "context", "community"]);
const DEFAULT_EVIDENCE_CLASS = Object.freeze({
  web: "context",
  github: "first-party",
  arxiv: "primary",
});

export const DISCOVERY_COLLECTOR_ADAPTERS = Object.freeze({
  web: collectWebSource,
  github: collectGitHubSource,
  arxiv: collectArxivSource,
});

const ALLOWED_ADAPTERS = new Set(Object.keys(DISCOVERY_COLLECTOR_ADAPTERS));

export class DiscoveryLiveError extends Error {
  constructor(code) {
    super("Discovery live operation failed.");
    this.name = "DiscoveryLiveError";
    this.code = code;
    this.category = "operation";
    this.guidance = "Review the bounded source policy and retry without exposing source content.";
  }
}

export async function buildDiscoveryLive(manifest, options = {}) {
  const validation = validateDiscoveryManifest(manifest);
  if (!validation.ok) throw fail("AGENTMO_DISCOVERY_LIVE_MANIFEST_INVALID");
  const policy = normalizeLivePolicy(manifest.collector);
  const sources = Array.isArray(manifest.source_inventory) ? manifest.source_inventory : [];
  if (sources.length > policy.maxSources) {
    throw fail("AGENTMO_DISCOVERY_LIVE_SOURCE_LIMIT");
  }
  const transport = normalizeDiscoveryLiveTransport(options.transport);
  const now = typeof options.now === "function" ? options.now : () => new Date();
  const monotonicNow = typeof options.monotonicNow === "function"
    ? options.monotonicNow
    : () => Date.now();
  const sleep = options.sleep === undefined
    ? (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
    : options.sleep;
  if (typeof sleep !== "function") throw fail("AGENTMO_DISCOVERY_LIVE_POLICY_INVALID");
  const started = readMonotonic(monotonicNow);
  let previousRequestStartedAt = null;
  const retrievals = [];

  for (const source of sources) {
    if (policy.adapter === "arxiv" && previousRequestStartedAt !== null) {
      const elapsed = readMonotonic(monotonicNow) - previousRequestStartedAt;
      const delay = Math.max(0, ARXIV_MIN_REQUEST_INTERVAL_MS - elapsed);
      const remainingBeforePace = policy.aggregateTimeoutMs - (readMonotonic(monotonicNow) - started);
      if (delay >= remainingBeforePace) throw fail("AGENTMO_DISCOVERY_LIVE_TIMEOUT");
      if (delay > 0) await sleep(delay);
    }
    const remaining = policy.aggregateTimeoutMs - (readMonotonic(monotonicNow) - started);
    if (remaining <= 0) throw fail("AGENTMO_DISCOVERY_LIVE_TIMEOUT");
    previousRequestStartedAt = readMonotonic(monotonicNow);
    retrievals.push(await retrieveSource(source, policy, transport, {
      now,
      timeoutMs: Math.min(policy.perSourceTimeoutMs, remaining),
    }));
  }

  return buildCandidate(manifest, policy, retrievals, options);
}

export function prepareDiscoveryLive(live) {
  assertPersistable(live, { subject: "discovery-live" });
  const facts = Array.isArray(live.discoveryDb?.facts) ? live.discoveryDb.facts : [];
  const chunks = Array.isArray(live.sourceChunks) ? live.sourceChunks : [];
  const retrievals = Array.isArray(live.retrievals) ? live.retrievals : [];
  const factsJsonl = serializeDiscoveryJsonl(facts, "discovery-facts");
  const sourceChunksJsonl = serializeDiscoveryJsonl(chunks, "discovery-source-chunks");
  const retrievalsJsonl = serializeDiscoveryJsonl(retrievals, "discovery-retrievals");
  if (
    live.factsJsonl !== factsJsonl
    || live.sourceChunksJsonl !== sourceChunksJsonl
    || live.retrievalsJsonl !== retrievalsJsonl
  ) {
    throw new PersistabilityError("AGENTMO_PERSISTABILITY_CANDIDATE_MISMATCH");
  }
  return Object.freeze({
    discoveryDbText: serializePersistableJson(live.discoveryDb, { subject: "discovery-db" }),
    factsJsonl,
    coverageText: serializePersistableJson(live.coverage, { subject: "discovery-coverage" }),
    sourceCardsText: serializePersistableJson(live.sourceCards, { subject: "discovery-source-cards" }),
    sourceChunksJsonl,
    retrievalsJsonl,
  });
}

export async function writeDiscoveryLive(outDir, live, options = {}) {
  const prepared = prepareDiscoveryLive(live);
  const root = path.resolve(outDir);
  await requireAbsent(root);
  const publicationIo = normalizePublicationIo(options.publicationIo);
  const parent = path.dirname(root);
  const staging = path.join(parent, `.agentmo-discovery-live-stage-${randomBytes(12).toString("hex")}`);
  const files = [
    [DISCOVERY_DB_FILENAME, prepared.discoveryDbText],
    [DISCOVERY_FACTS_FILENAME, prepared.factsJsonl],
    [DISCOVERY_COVERAGE_FILENAME, prepared.coverageText],
    [SOURCE_CARDS_FILENAME, prepared.sourceCardsText],
    [SOURCE_CHUNKS_FILENAME, prepared.sourceChunksJsonl],
    [DISCOVERY_RETRIEVALS_FILENAME, prepared.retrievalsJsonl],
  ];
  try {
    await publicationIo.mkdir(parent, { recursive: true });
    await publicationIo.mkdir(staging, { recursive: false, mode: 0o700 });
    for (const [basename, text] of files) {
      await publicationIo.writeFile(path.join(staging, basename), text, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    }
    await requireAbsent(root);
    await publicationIo.rename(staging, root);
  } catch {
    throw fail("AGENTMO_DISCOVERY_LIVE_PUBLICATION_FAILED");
  }
  return {
    outDir: ".",
    discoveryDbPath: DISCOVERY_DB_FILENAME,
    factsPath: DISCOVERY_FACTS_FILENAME,
    coveragePath: DISCOVERY_COVERAGE_FILENAME,
    sourceCardsPath: SOURCE_CARDS_FILENAME,
    sourceChunksPath: SOURCE_CHUNKS_FILENAME,
    retrievalsPath: DISCOVERY_RETRIEVALS_FILENAME,
  };
}

export function formatDiscoveryLive(live, paths = {}) {
  const lines = [
    `AgentMo live discovery: ${live.agentId}`,
    `Status: ${live.ok ? "pass" : "fail"}`,
    `Retrieved sources: ${live.retrievals.length}`,
    `Evidence: ${live.evidenceLevel}`,
    `Provider: ${live.discoveryDb.live.policy.adapter}`,
    `Observation basis: ${live.observations.basis}`,
    `Coverage gaps: ${live.observations.coverageGaps.length}`,
  ];
  if (paths.discoveryDbPath) lines.push(`Discovery DB: ${paths.discoveryDbPath}`);
  if (paths.retrievalsPath) lines.push(`Retrievals: ${paths.retrievalsPath}`);
  return `${lines.join("\n")}\n`;
}

async function retrieveSource(source, policy, transport, options) {
  const controller = new AbortController();
  let timeout;
  try {
    const deadline = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(fail("AGENTMO_DISCOVERY_LIVE_TIMEOUT"));
      }, options.timeoutMs);
    });
    return await Promise.race([
      retrieveSourceWithinDeadline(source, policy, transport, options, controller.signal),
      deadline,
    ]);
  } catch (error) {
    if (
      error?.code === "AGENTMO_DISCOVERY_LIVE_TIMEOUT"
      || error?.name === "AbortError"
    ) {
      throw fail("AGENTMO_DISCOVERY_LIVE_TIMEOUT");
    }
    if (typeof error?.code === "string" && error.code.startsWith("AGENTMO_DISCOVERY_LIVE_")) {
      throw fail(error.code);
    }
    throw fail("AGENTMO_DISCOVERY_LIVE_REQUEST_FAILED");
  } finally {
    clearTimeout(timeout);
  }
}

async function retrieveSourceWithinDeadline(source, policy, transport, options, signal) {
  const adapter = DISCOVERY_COLLECTOR_ADAPTERS[policy.adapter];
  if (typeof adapter !== "function") throw fail("AGENTMO_DISCOVERY_LIVE_POLICY_INVALID");
  const context = {
    source,
    policy,
    evidenceClass: sourceEvidenceClass(source, policy.adapter),
    lastResponse: null,
    fail,
    approveUrl: (value) => approvedUrl(value, policy.allowlist),
    async retrieve(value, profile) {
      const response = await retrieveApprovedResponse(
        value,
        policy,
        transport,
        signal,
        profile,
      );
      context.lastResponse = response;
      return response;
    },
    buildRecord(response, overrides = {}) {
      return buildDiscoveryRetrievalRecord({
        source,
        requestedUrl: response.requestedUrl,
        finalUrl: response.finalUrl,
        retrievedAt: normalizeNow(options.now),
        httpStatus: response.status,
        contentType: response.contentType,
        adapter: policy.adapter,
        bytes: response.bytes,
        ...overrides,
      });
    },
  };
  return adapter(context);
}

async function retrieveApprovedResponse(value, policy, transport, signal, profile) {
  const requestedUrl = approvedUrl(value, policy.allowlist);
  let currentUrl = requestedUrl;
  for (let redirects = 0; redirects <= policy.maxRedirects; redirects += 1) {
    const response = await requestTransport(transport, currentUrl, signal, profile);
    validateConnectedDestination(response);
    const status = Number(response?.status);
    if (REDIRECT_STATUSES.has(status)) {
      if (redirects >= policy.maxRedirects) throw fail("AGENTMO_DISCOVERY_LIVE_REDIRECT_LIMIT");
      const location = response?.headers?.location;
      if (typeof location !== "string" || location.length === 0) {
        throw fail("AGENTMO_DISCOVERY_LIVE_REDIRECT_INVALID");
      }
      currentUrl = approvedUrl(new URL(location, currentUrl).href, policy.allowlist);
      continue;
    }
    if (status !== 200) {
      return {
        requestedUrl,
        finalUrl: currentUrl,
        status,
        contentType: normalizeContentType(response?.headers?.["content-type"]),
        bytes: Buffer.alloc(0),
        headers: response?.headers ?? {},
      };
    }
    const contentType = normalizeContentType(response?.headers?.["content-type"]);
    if (!policy.allowedContentTypes.includes(contentType)) {
      throw fail("AGENTMO_DISCOVERY_LIVE_CONTENT_TYPE");
    }
    const declaredLength = parseDeclaredLength(response?.headers?.["content-length"]);
    if (declaredLength !== null && declaredLength > policy.maxBytesPerSource) {
      throw fail("AGENTMO_DISCOVERY_LIVE_RESPONSE_TOO_LARGE");
    }
    const bytes = await readBoundedBody(response?.body, policy.maxBytesPerSource, signal);
    return {
      requestedUrl,
      finalUrl: currentUrl,
      status,
      contentType,
      bytes,
      headers: response?.headers ?? {},
    };
  }
  throw fail("AGENTMO_DISCOVERY_LIVE_REDIRECT_LIMIT");
}

async function requestTransport(transport, url, signal, profile) {
  try {
    return await transport.request({
      url,
      signal,
      redirectMode: "manual",
      profile,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    if (typeof error?.code === "string" && error.code.startsWith("AGENTMO_DISCOVERY_LIVE_")) throw error;
    throw fail("AGENTMO_DISCOVERY_LIVE_REQUEST_FAILED");
  }
}

async function readBoundedBody(body, maximum, signal) {
  if (body === null || typeof body !== "object" || typeof body[Symbol.asyncIterator] !== "function") {
    throw fail("AGENTMO_DISCOVERY_LIVE_TRANSPORT_CONTRACT");
  }
  const chunks = [];
  let total = 0;
  try {
    for await (const value of body) {
      if (signal.aborted) throw fail("AGENTMO_DISCOVERY_LIVE_TIMEOUT");
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      total += chunk.length;
      if (total > maximum) throw fail("AGENTMO_DISCOVERY_LIVE_RESPONSE_TOO_LARGE");
      chunks.push(chunk);
    }
  } catch (error) {
    if (typeof error?.code === "string" && error.code.startsWith("AGENTMO_DISCOVERY_LIVE_")) throw error;
    throw fail("AGENTMO_DISCOVERY_LIVE_BODY_FAILED");
  }
  return Buffer.concat(chunks, total);
}

function buildCandidate(manifest, policy, retrievals, options) {
  const baseDb = buildDiscoveryDb(manifest, {
    manifestPath: options.manifestPath,
    repoRoot: options.repoRoot,
  });
  const observations = buildDiscoveryObservations(manifest, retrievals);
  const dedupBySource = new Map(observations.dedup.map((item) => [item.sourceId, item]));
  const freshnessBySource = new Map(observations.freshness.map((item) => [item.sourceId, item]));
  const gapsBySource = new Map(retrievals.map((item) => [
    item.sourceId,
    observations.coverageGaps.filter((gap) => gap.sourceId === item.sourceId),
  ]));
  const conflictsBySource = new Map(retrievals.map((item) => [
    item.sourceId,
    observations.conflictCandidates.filter((candidate) => candidate.sourceIds.includes(item.sourceId)),
  ]));
  const normalizedRetrievals = retrievals.map((retrieval) => ({
    ...retrieval,
    duplicateOf: dedupBySource.get(retrieval.sourceId)?.duplicateOf ?? null,
    freshness: freshnessBySource.get(retrieval.sourceId),
    conflictCandidates: conflictsBySource.get(retrieval.sourceId) ?? [],
    coverageGaps: gapsBySource.get(retrieval.sourceId) ?? [],
    observationBasis: observations.basis,
  }));
  const retrievalBySource = new Map(normalizedRetrievals.map((item) => [item.sourceId, item]));
  const chunks = normalizedRetrievals.map((retrieval) => {
    const source = baseDb.sources.find((item) => item.id === retrieval.sourceId);
    return {
      id: deriveDiscoveryRecordId(retrieval.sourceId, "chunk:01"),
      sourceId: retrieval.sourceId,
      kind: "source_chunk",
      text: retrieval.summary,
      trustLevel: "unverified",
      declaredTrustLevel: retrieval.declaredTrustLevel,
      evidenceClass: retrieval.evidenceClass,
      providerKind: retrieval.providerKind,
      providerPolicy: retrieval.providerPolicy,
      retrievalStatus: retrieval.retrievalStatus,
      confidence: retrieval.confidence,
      confidenceRationale: retrieval.confidenceRationale,
      originalLocation: retrieval.originalLocation,
      duplicateOf: retrieval.duplicateOf,
      freshness: retrieval.freshness,
      conflictCandidates: retrieval.conflictCandidates,
      coverageGaps: retrieval.coverageGaps,
      observationBasis: retrieval.observationBasis,
      refs: [retrieval.finalUrl],
      ref: {
        sourceId: retrieval.sourceId,
        location: retrieval.finalUrl,
        contentDigest: retrieval.contentDigest,
      },
      tags: [source?.type ?? "retrieval_corpus", policy.adapter],
      limits: {
        maxBytesPerSource: policy.maxBytesPerSource,
        maxChunksPerSource: 1,
      },
      truncated: retrieval.summaryTruncated,
    };
  });
  const discoveryDb = {
    ...baseDb,
    facts: [...baseDb.facts, ...chunks],
    coverage: {
      ...baseDb.coverage,
      factCount: baseDb.facts.length + chunks.length,
      liveSourceCount: retrievals.length,
      liveChunkCount: chunks.length,
    },
    safety: {
      ...baseDb.safety,
      liveMechanismOnly: true,
      responseBodiesStored: false,
    },
    live: {
      schemaVersion: DISCOVERY_LIVE_SCHEMA_VERSION,
      evidenceLevel: "bounded-mechanism-only",
      retrievalCount: retrievals.length,
      policy: durablePolicy(policy),
    },
  };
  const cards = baseDb.sources.map((source) => {
    const retrieval = retrievalBySource.get(source.id);
    return {
      sourceId: source.id,
      type: source.type,
      providerKind: retrieval?.providerKind ?? policy.adapter,
      providerPolicy: retrieval?.providerPolicy ?? durablePolicy(policy),
      declaredTrustLevel: source.trustLevel,
      originalLocation: retrieval?.originalLocation ?? source.location,
      location: retrieval?.finalUrl ?? source.location,
      status: retrieval ? "ingested" : "rejected",
      retrievalStatus: retrieval?.retrievalStatus ?? "not-retrieved",
      evidenceClass: retrieval?.evidenceClass ?? "none",
      confidence: retrieval?.confidence ?? "unverified",
      confidenceRationale: retrieval?.confidenceRationale
        ?? "No successful bounded retrieval established semantic correctness.",
      duplicateOf: retrieval?.duplicateOf ?? null,
      freshness: retrieval?.freshness ?? null,
      conflictCandidates: retrieval?.conflictCandidates ?? [],
      coverageGaps: retrieval?.coverageGaps ?? [],
      observationBasis: observations.basis,
      contentDigest: retrieval?.contentDigest ?? null,
      chunkCount: retrieval ? 1 : 0,
    };
  });
  const coverage = {
    ...discoveryDb.coverage,
    live: {
      sourceCount: baseDb.sources.length,
      retrievedCount: retrievals.length,
      rejectedCount: baseDb.sources.length - retrievals.length,
      mechanismOnly: true,
    },
  };
  discoveryDb.coverage = coverage;
  discoveryDb.observations = observations;
  const sourceCards = {
    schemaVersion: SOURCE_CARDS_SCHEMA_VERSION,
    version: 1,
    sourceRoot: null,
    cards,
  };
  const candidate = {
    schemaVersion: DISCOVERY_LIVE_SCHEMA_VERSION,
    ok: true,
    agentId: discoveryDb.agentId,
    evidenceLevel: "bounded-mechanism-only",
    files: {
      discoveryDb: DISCOVERY_DB_FILENAME,
      facts: DISCOVERY_FACTS_FILENAME,
      coverage: DISCOVERY_COVERAGE_FILENAME,
      sourceCards: SOURCE_CARDS_FILENAME,
      sourceChunks: SOURCE_CHUNKS_FILENAME,
      retrievals: DISCOVERY_RETRIEVALS_FILENAME,
    },
    discoveryDb,
    factsJsonl: serializeDiscoveryJsonl(discoveryDb.facts, "discovery-facts"),
    coverage,
    sourceCards,
    sourceChunks: chunks,
    sourceChunksJsonl: serializeDiscoveryJsonl(chunks, "discovery-source-chunks"),
    retrievals: normalizedRetrievals,
    retrievalsJsonl: serializeDiscoveryJsonl(normalizedRetrievals, "discovery-retrievals"),
    observations,
    certification: {
      semanticQuality: false,
      domainQuality: false,
      runtimeReady: false,
      productionReady: false,
    },
  };
  prepareDiscoveryLive(candidate);
  return candidate;
}

function normalizeLivePolicy(value) {
  if (!plainObject(value)
    || value.schemaVersion !== DISCOVERY_LIVE_POLICY_SCHEMA_VERSION
    || !ALLOWED_ADAPTERS.has(value.adapter)
    || !Array.isArray(value.allowlist)
    || value.allowlist.length === 0
    || new Set(value.allowlist).size !== value.allowlist.length
    || !positiveBound(value.maxSources, 32)
    || !positiveBound(value.maxBytesPerSource, 1_048_576)
    || !positiveBound(value.perSourceTimeoutMs, 60_000)
    || !positiveBound(value.aggregateTimeoutMs, 300_000)
    || value.aggregateTimeoutMs < value.perSourceTimeoutMs
    || !nonNegativeBound(value.maxRedirects, 5)
    || !Array.isArray(value.allowedContentTypes)
    || value.allowedContentTypes.length === 0
  ) {
    throw fail("AGENTMO_DISCOVERY_LIVE_POLICY_INVALID");
  }
  const allowlist = value.allowlist.map((item) => canonicalHttpsUrl(item));
  const allowedContentTypes = value.allowedContentTypes.map(normalizeContentType);
  if (new Set(allowlist).size !== allowlist.length
    || new Set(allowedContentTypes).size !== allowedContentTypes.length) {
    throw fail("AGENTMO_DISCOVERY_LIVE_POLICY_INVALID");
  }
  return Object.freeze({
    schemaVersion: DISCOVERY_LIVE_POLICY_SCHEMA_VERSION,
    adapter: value.adapter,
    allowlist: Object.freeze(allowlist),
    maxSources: value.maxSources,
    maxBytesPerSource: value.maxBytesPerSource,
    perSourceTimeoutMs: value.perSourceTimeoutMs,
    aggregateTimeoutMs: value.aggregateTimeoutMs,
    maxRedirects: value.maxRedirects,
    allowedContentTypes: Object.freeze(allowedContentTypes),
  });
}

function approvedUrl(value, allowlist) {
  const url = canonicalHttpsUrl(value);
  if (!allowlist.includes(url)) throw fail("AGENTMO_DISCOVERY_LIVE_DESTINATION_NOT_ALLOWED");
  return url;
}

function canonicalHttpsUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw fail("AGENTMO_DISCOVERY_LIVE_URL_INVALID");
  }
  if (url.protocol !== "https:") throw fail("AGENTMO_DISCOVERY_LIVE_HTTPS_REQUIRED");
  if (url.username || url.password) throw fail("AGENTMO_DISCOVERY_LIVE_URL_CREDENTIALS");
  if (url.hash) throw fail("AGENTMO_DISCOVERY_LIVE_URL_INVALID");
  if (isIP(url.hostname) !== 0 && !isPublicNetworkAddress(url.hostname)) {
    throw fail("AGENTMO_DISCOVERY_LIVE_PRIVATE_DESTINATION");
  }
  return url.href;
}

function validateConnectedDestination(response) {
  const addresses = [
    response?.remoteAddress,
    ...(Array.isArray(response?.resolvedAddresses) ? response.resolvedAddresses : []),
  ].filter((item) => typeof item === "string");
  if (addresses.length === 0 || addresses.some((item) => !isPublicNetworkAddress(item))) {
    throw fail("AGENTMO_DISCOVERY_LIVE_PRIVATE_DESTINATION");
  }
}

function normalizeContentType(value) {
  if (typeof value !== "string") return "";
  return value.split(";", 1)[0].trim().toLowerCase();
}

function parseDeclaredLength(value) {
  if (value === undefined || value === null || value === "") return null;
  if (!/^(?:0|[1-9]\d*)$/u.test(String(value))) {
    throw fail("AGENTMO_DISCOVERY_LIVE_CONTENT_LENGTH");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw fail("AGENTMO_DISCOVERY_LIVE_CONTENT_LENGTH");
  return parsed;
}

function normalizeNow(now) {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw fail("AGENTMO_DISCOVERY_LIVE_CLOCK_INVALID");
  }
  return value.toISOString();
}

function readMonotonic(now) {
  const value = now();
  if (!Number.isFinite(value)) throw fail("AGENTMO_DISCOVERY_LIVE_CLOCK_INVALID");
  return value;
}

function sourceEvidenceClass(source, adapter) {
  const value = source?.evidence_class ?? DEFAULT_EVIDENCE_CLASS[adapter];
  if (!LIVE_EVIDENCE_CLASSES.has(value)) {
    throw fail("AGENTMO_DISCOVERY_LIVE_EVIDENCE_CLASS_INVALID");
  }
  if (adapter === "arxiv" && value !== "primary") {
    throw fail("AGENTMO_DISCOVERY_LIVE_EVIDENCE_CLASS_INVALID");
  }
  return value;
}

function durablePolicy(policy) {
  return {
    schemaVersion: policy.schemaVersion,
    adapter: policy.adapter,
    approvedSourceCount: policy.allowlist.length,
    maxSources: policy.maxSources,
    maxBytesPerSource: policy.maxBytesPerSource,
    perSourceTimeoutMs: policy.perSourceTimeoutMs,
    aggregateTimeoutMs: policy.aggregateTimeoutMs,
    maxRedirects: policy.maxRedirects,
    allowedContentTypes: [...policy.allowedContentTypes],
  };
}

async function requireAbsent(file) {
  try {
    await lstat(file);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw fail("AGENTMO_DISCOVERY_LIVE_PUBLICATION_FAILED");
  }
  throw fail("AGENTMO_DISCOVERY_LIVE_OUTPUT_EXISTS");
}

function normalizePublicationIo(value) {
  const io = value ?? DEFAULT_PUBLICATION_IO;
  if (
    !plainObject(io)
    || typeof io.mkdir !== "function"
    || typeof io.rename !== "function"
    || typeof io.writeFile !== "function"
  ) {
    throw fail("AGENTMO_DISCOVERY_LIVE_PUBLICATION_ADAPTER_INVALID");
  }
  return io;
}

function positiveBound(value, maximum) {
  return Number.isSafeInteger(value) && value > 0 && value <= maximum;
}

function nonNegativeBound(value, maximum) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function plainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function fail(code) {
  return new DiscoveryLiveError(code);
}
