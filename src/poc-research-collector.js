import { createHash } from "node:crypto";
import {
  DEFAULT_DISCOVERY_LIVE_TRANSPORT,
  isDiscoveryNetworkAddressAllowed,
  isPublicNetworkAddress,
  normalizeDiscoveryLiveTransport,
} from "./discovery-live-transport.js";
import {
  POC_RESEARCH_RECORD_SCHEMA_VERSION,
  canonicalResearchUrl,
  validateResearchRecord,
  validateResearchSourceRegistry,
} from "./poc-research-contract.js";

const COLLECTION_STATE_SCHEMA_VERSION = "agentmo.poc-research-collection-state.v1";
const COLLECTION_SCHEMA_VERSION = "agentmo.poc-research-collection.v1";
const MAX_RESPONSE_BYTES = 200_000;
const MAX_RECORDS_PER_SOURCE = 10;
const SECRET_SHAPED = /(?:api[_-]?key|secret|token|password)\s*=/iu;
const ADAPTER_PROFILES = Object.freeze({
  "aihot-v1": "web",
  "github-release": "github",
  "arxiv-atom": "arxiv",
  "official-feed": "web",
});

export function createEmptyResearchCollectionState(agentId) {
  return Object.freeze({
    schemaVersion: COLLECTION_STATE_SCHEMA_VERSION,
    agentId: requireAgentId(agentId),
    sources: Object.freeze({}),
  });
}

export function validateResearchCollectionState(value, agentId) {
  try {
    normalizeState(value, agentId);
    return Object.freeze({ ok: true, errors: Object.freeze([]) });
  } catch {
    return Object.freeze({ ok: false, errors: Object.freeze(["Research collection state is invalid."]) });
  }
}

export async function collectResearchSources({ registry, previousState, now, transport, networkMode = "public-only" } = {}) {
  if (!validateResearchSourceRegistry(registry).ok) throw collectionError("AGENTMO_POC_RESEARCH_INPUT_INVALID");
  const state = normalizeState(previousState, registry.agentId);
  const collectedAt = normalizeTimestamp(now);
  const boundedTransport = normalizeDiscoveryLiveTransport(transport ?? DEFAULT_DISCOVERY_LIVE_TRANSPORT);
  const records = [];
  const retrievals = [];
  const nextSources = { ...state.sources };
  let successfulSources = 0;
  let firstSourceFailure = null;

  for (const source of registry.sources) {
    const requestedUrl = registeredRequestUrl(source);
    const prior = state.sources[source.id];
    const headers = prior?.etag ? { "if-none-match": prior.etag } : {};
    try {
      let response;
      try {
        response = await boundedTransport.request({
          url: requestedUrl,
          headers,
          profile: ADAPTER_PROFILES[source.adapter],
          redirectMode: "manual",
        });
      } catch (error) {
        if (typeof error?.code === "string" && error.code.startsWith("AGENTMO_DISCOVERY_LIVE_")) throw error;
        throw collectionError("AGENTMO_POC_RESEARCH_RETRIEVAL_REJECTED");
      }
      validateResponse(source, requestedUrl, response, networkMode);
      const etag = boundedHeader(response.headers?.etag);
      if (response.status === 304) {
        retrievals.push(Object.freeze({ sourceId: source.id, status: "not-modified", requestedUrl, collectedAt }));
        if (etag) nextSources[source.id] = { etag };
        successfulSources += 1;
        continue;
      }
      const body = await readBoundedBody(response.body);
      if (SECRET_SHAPED.test(body)) throw collectionError("AGENTMO_POC_RESEARCH_RETRIEVAL_REJECTED");
      records.push(...recordsForSource(source, body, collectedAt));
      retrievals.push(Object.freeze({
        sourceId: source.id,
        status: "retrieved",
        requestedUrl,
        collectedAt,
        contentDigest: digest(body),
      }));
      nextSources[source.id] = etag ? { etag } : {};
      successfulSources += 1;
    } catch (error) {
      const failure = boundedSourceFailure(error);
      if (failure === null) throw error;
      firstSourceFailure ??= failure.error;
      retrievals.push(Object.freeze({ sourceId: source.id, status: "failed", code: failure.code, collectedAt }));
    }
  }

  if (successfulSources === 0 && firstSourceFailure !== null) throw firstSourceFailure;

  return deepFreeze({
    schemaVersion: COLLECTION_SCHEMA_VERSION,
    agentId: registry.agentId,
    records,
    retrievals,
    state: { schemaVersion: COLLECTION_STATE_SCHEMA_VERSION, agentId: registry.agentId, sources: nextSources },
  });
}

function boundedSourceFailure(error) {
  const code = error?.code;
  if (typeof code === "string" && code.startsWith("AGENTMO_DISCOVERY_LIVE_")) return { code, error };
  if (code === "AGENTMO_POC_RESEARCH_RETRIEVAL_REJECTED") return { code, error };
  if (code === "AGENTMO_POC_RESEARCH_INPUT_INVALID") {
    const mapped = collectionError("AGENTMO_POC_RESEARCH_RETRIEVAL_REJECTED");
    return { code: mapped.code, error: mapped };
  }
  return null;
}

function registeredRequestUrl(source) {
  const url = new URL(source.requestPath, source.origin);
  if (url.origin !== source.origin || !url.pathname.startsWith(source.pathPrefix)) {
    throw collectionError("AGENTMO_POC_RESEARCH_INPUT_INVALID");
  }
  return canonicalResearchUrl(url.href);
}

function validateResponse(source, requestedUrl, response, networkMode) {
  if (!response || typeof response !== "object" || (response.status !== 200 && response.status !== 304)) {
    throw collectionError("AGENTMO_POC_RESEARCH_RETRIEVAL_REJECTED");
  }
  let finalUrl;
  try { finalUrl = canonicalResearchUrl(response.url); } catch { throw collectionError("AGENTMO_POC_RESEARCH_RETRIEVAL_REJECTED"); }
  const expected = new URL(requestedUrl);
  const actual = new URL(finalUrl);
  if (actual.origin !== source.origin || actual.pathname !== expected.pathname || finalUrl !== requestedUrl) {
    throw collectionError("AGENTMO_POC_RESEARCH_RETRIEVAL_REJECTED");
  }
  const addresses = [response.remoteAddress, ...(Array.isArray(response.resolvedAddresses) ? response.resolvedAddresses : [])]
    .filter((address) => typeof address === "string");
  const hostname = new URL(source.origin).hostname;
  if (addresses.length > 0 && addresses.some((address) => !isDiscoveryNetworkAddressAllowed(address, networkMode, hostname))) {
    throw collectionError("AGENTMO_POC_RESEARCH_RETRIEVAL_REJECTED");
  }
  if (addresses.some((address) => !isPublicNetworkAddress(address)) && response.tlsAuthorized !== true) {
    throw collectionError("AGENTMO_POC_RESEARCH_RETRIEVAL_REJECTED");
  }
}

async function readBoundedBody(body) {
  if (typeof body === "string") return boundedText(body);
  if (Buffer.isBuffer(body)) return boundedText(body.toString("utf8"));
  if (!body || typeof body[Symbol.asyncIterator] !== "function") throw collectionError("AGENTMO_POC_RESEARCH_RETRIEVAL_REJECTED");
  const chunks = [];
  let total = 0;
  for await (const chunk of body) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_RESPONSE_BYTES) throw collectionError("AGENTMO_POC_RESEARCH_RETRIEVAL_REJECTED");
    chunks.push(buffer);
  }
  return boundedText(Buffer.concat(chunks).toString("utf8"));
}

function boundedText(value) {
  if (Buffer.byteLength(value, "utf8") > MAX_RESPONSE_BYTES) throw collectionError("AGENTMO_POC_RESEARCH_RETRIEVAL_REJECTED");
  return value;
}

function recordsForSource(source, body, collectedAt) {
  const rows = source.adapter === "aihot-v1" ? parseAihot(body)
    : source.adapter === "github-release" ? parseGitHubReleases(body)
      : source.adapter === "arxiv-atom" ? parseArxivAtom(body) : parseOfficialFeed(body);
  return rows.slice(0, MAX_RECORDS_PER_SOURCE).map((row) => createRecord(source, row, collectedAt));
}

function parseAihot(body) {
  let payload;
  try { payload = JSON.parse(body); } catch { throw collectionError("AGENTMO_POC_RESEARCH_RETRIEVAL_REJECTED"); }
  if (!Array.isArray(payload?.items)) throw collectionError("AGENTMO_POC_RESEARCH_RETRIEVAL_REJECTED");
  return payload.items.map((item) => ({
    title: safeText(item?.title), summary: safeText(item?.summary), url: item?.links?.aihot,
    publishedAt: item?.publishedAt ?? item?.discoveredAt, factClass: "community_signal",
  }));
}

function parseGitHubReleases(body) {
  let payload;
  try { payload = JSON.parse(body); } catch { throw collectionError("AGENTMO_POC_RESEARCH_RETRIEVAL_REJECTED"); }
  if (!Array.isArray(payload)) throw collectionError("AGENTMO_POC_RESEARCH_RETRIEVAL_REJECTED");
  return payload.map((item) => ({
    title: safeText(item?.name ?? item?.tag_name),
    summary: safeText(item?.body ?? item?.name ?? item?.tag_name), url: item?.html_url,
    publishedAt: item?.published_at ?? item?.created_at, factClass: "fact",
  }));
}

function parseArxivAtom(body) {
  return xmlEntries(body).map((entry) => ({
    title: xmlText(entry, "title"), summary: xmlText(entry, "summary"), url: xmlLink(entry),
    publishedAt: xmlText(entry, "published") || xmlText(entry, "updated"), factClass: "fact",
  }));
}

function parseOfficialFeed(body) {
  const items = [...body.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/giu)].map((match) => match[1]);
  const entries = items.length > 0 ? items : xmlEntries(body);
  if (entries.length === 0) throw collectionError("AGENTMO_POC_RESEARCH_RETRIEVAL_REJECTED");
  return entries.map((entry) => ({
    title: xmlText(entry, "title"), summary: xmlText(entry, "description") || xmlText(entry, "summary"),
    url: xmlText(entry, "link") || xmlLink(entry),
    publishedAt: xmlText(entry, "pubDate") || xmlText(entry, "published") || xmlText(entry, "updated"),
    factClass: "company_statement",
  }));
}

function xmlEntries(body) {
  return [...body.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/giu)].map((match) => match[1]);
}

function xmlText(fragment, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "iu").exec(fragment);
  return match ? decodeXml(match[1].replace(/<[^>]+>/gu, " ").trim()) : "";
}

function xmlLink(fragment) {
  const match = /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?>/iu.exec(fragment);
  return match ? decodeXml(match[1]) : "";
}

function decodeXml(value) {
  return value.replace(/&(?:amp|lt|gt|quot|apos);/gu, (entity) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" })[entity]);
}

function createRecord(source, row, collectedAt) {
  const title = safeText(row.title);
  const summary = safeText(row.summary);
  const url = canonicalResearchUrl(row.url);
  const publishedAt = normalizeTimestamp(row.publishedAt);
  if (SECRET_SHAPED.test(title) || SECRET_SHAPED.test(summary)) throw collectionError("AGENTMO_POC_RESEARCH_RETRIEVAL_REJECTED");
  const contentDigest = digest(JSON.stringify({ title, summary, url, publishedAt, sourceId: source.id }));
  const record = {
    schemaVersion: POC_RESEARCH_RECORD_SCHEMA_VERSION,
    id: `${source.id}-${contentDigest.slice(7, 23)}`,
    sourceId: source.id, title, url, publishedAt, collectedAt,
    sourceRole: source.sourceRole, trustTier: source.trustTier,
    domains: [...source.domains], scenarios: [...source.scenarios], factClass: row.factClass,
    summary, contentDigest, evidenceIds: [],
  };
  if (!validateResearchRecord(record).ok) throw collectionError("AGENTMO_POC_RESEARCH_RETRIEVAL_REJECTED");
  return Object.freeze(record);
}

function normalizeState(value, agentId) {
  if (value?.schemaVersion !== COLLECTION_STATE_SCHEMA_VERSION || value.agentId !== agentId || !isPlainObject(value.sources)) {
    throw collectionError("AGENTMO_POC_RESEARCH_INPUT_INVALID");
  }
  const sources = {};
  for (const [sourceId, entry] of Object.entries(value.sources)) {
    if (!isSafeId(sourceId) || !isPlainObject(entry) || !Object.keys(entry).every((key) => key === "etag")
      || (entry.etag !== undefined && (typeof entry.etag !== "string" || entry.etag.length > 1024))) {
      throw collectionError("AGENTMO_POC_RESEARCH_INPUT_INVALID");
    }
    sources[sourceId] = entry.etag ? { etag: entry.etag } : {};
  }
  return { sources };
}

function normalizeTimestamp(value) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw collectionError("AGENTMO_POC_RESEARCH_INPUT_INVALID");
  return new Date(value).toISOString();
}

function boundedHeader(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 1024 ? value : undefined;
}

function safeText(value) {
  if (typeof value !== "string") throw collectionError("AGENTMO_POC_RESEARCH_RETRIEVAL_REJECTED");
  const text = value.trim();
  if (text.length === 0 || text.length > 4_000) throw collectionError("AGENTMO_POC_RESEARCH_RETRIEVAL_REJECTED");
  return text;
}

function digest(value) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function requireAgentId(value) {
  if (!isSafeId(value)) throw collectionError("AGENTMO_POC_RESEARCH_INPUT_INVALID");
  return value;
}

function isSafeId(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,127}$/u.test(value);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function collectionError(code) {
  const error = new Error("AgentMo POC research collection failed.");
  error.code = code;
  return error;
}
