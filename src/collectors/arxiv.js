const MAX_ABSTRACT_CHARS = 1600;
export const ARXIV_MIN_REQUEST_INTERVAL_MS = 3000;

export async function collectArxivSource(context) {
  const requested = new URL(context.source.location);
  if (/\/(?:pdf|e-print)\//u.test(requested.pathname)) {
    throw context.fail("AGENTMO_DISCOVERY_LIVE_ARXIV_FULL_TEXT_DENIED");
  }
  if (requested.hostname !== "export.arxiv.org" || requested.pathname !== "/api/query") {
    throw context.fail("AGENTMO_DISCOVERY_LIVE_ARXIV_DESTINATION_INVALID");
  }
  const response = await context.retrieve(context.source.location, "arxiv");
  if (response.status !== 200) throw context.fail("AGENTMO_DISCOVERY_LIVE_HTTP_STATUS");
  const metadata = parseAtomMetadata(response.bytes);
  return context.buildRecord(response, {
    providerKind: "arxiv",
    providerPolicy: {
      format: "atom-metadata",
      politeProfile: true,
      minimumRequestIntervalMs: ARXIV_MIN_REQUEST_INTERVAL_MS,
      maxRequestsPerSource: 1,
      maxAbstractChars: MAX_ABSTRACT_CHARS,
      fullTextStored: false,
      licenseBasis: "metadata-only",
      rawBodyStored: false,
    },
    evidenceClass: context.evidenceClass,
    summaryText: [
      metadata.title,
      metadata.published,
      metadata.abstract,
    ].filter(Boolean).join(" — "),
    sourceTimestamp: metadata.published ?? metadata.updated,
  });
}

function parseAtomMetadata(bytes) {
  const xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const entry = tag(xml, "entry");
  if (entry === null) throw providerError("AGENTMO_DISCOVERY_LIVE_ARXIV_METADATA_INVALID");
  const title = clean(tag(entry, "title"));
  const abstract = clean(tag(entry, "summary")).slice(0, MAX_ABSTRACT_CHARS);
  if (title.length === 0 || abstract.length === 0) {
    throw providerError("AGENTMO_DISCOVERY_LIVE_ARXIV_METADATA_INVALID");
  }
  return {
    title,
    abstract,
    published: isoTimestamp(clean(tag(entry, "published"))),
    updated: isoTimestamp(clean(tag(entry, "updated"))),
  };
}

function tag(xml, name) {
  const match = String(xml).match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "iu"));
  return match?.[1] ?? null;
}

function clean(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/gu, " ")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&amp;/gu, "&")
    .replace(/&quot;/gu, "\"")
    .replace(/&#39;/gu, "'")
    .replace(/\s+/gu, " ")
    .trim();
}

function isoTimestamp(value) {
  if (value.length === 0) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function providerError(code) {
  const error = new Error("arXiv provider response was rejected.");
  error.code = code;
  return error;
}
