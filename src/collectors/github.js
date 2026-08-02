export const GITHUB_API_VERSION = "2022-11-28";

const MAX_PAGES = 3;

export async function collectGitHubSource(context) {
  if (new URL(context.source.location).hostname !== "api.github.com") {
    throw context.fail("AGENTMO_DISCOVERY_LIVE_GITHUB_DESTINATION_INVALID");
  }
  const pages = [];
  const summaries = [];
  const pageMetadata = [];
  let url = context.source.location;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await context.retrieve(url, "github");
    if (response.status === 403 || response.status === 429) {
      throw context.fail("AGENTMO_DISCOVERY_LIVE_RATE_LIMITED");
    }
    if (response.status !== 200) throw context.fail("AGENTMO_DISCOVERY_LIVE_HTTP_STATUS");
    pages.push(response.bytes);
    summaries.push(summarizeJson(response.bytes));
    pageMetadata.push({
      etag: boundedHeader(response.headers?.etag),
      lastModified: boundedHeader(response.headers?.["last-modified"]),
      rateRemaining: boundedInteger(response.headers?.["x-ratelimit-remaining"]),
    });
    const next = nextLink(response.headers?.link);
    if (next === null) break;
    if (page === MAX_PAGES) throw context.fail("AGENTMO_DISCOVERY_LIVE_PAGE_LIMIT");
    url = context.approveUrl(next);
  }

  const bytes = Buffer.concat(pages.flatMap((item, index) =>
    index === 0 ? [item] : [Buffer.from("\n", "utf8"), item]));
  if (bytes.length > context.policy.maxBytesPerSource) {
    throw context.fail("AGENTMO_DISCOVERY_LIVE_RESPONSE_TOO_LARGE");
  }
  const lastMetadata = pageMetadata.at(-1) ?? {};
  return context.buildRecord({
    ...context.lastResponse,
    requestedUrl: context.source.location,
    finalUrl: url,
    bytes,
  }, {
    providerKind: "github",
    providerPolicy: {
      apiVersion: GITHUB_API_VERSION,
      pagination: "serial-bounded",
      maxPages: MAX_PAGES,
      pageCount: pages.length,
      rateRemaining: lastMetadata.rateRemaining,
      etagPresent: pageMetadata.some((item) => item.etag !== null),
      lastModifiedPresent: pageMetadata.some((item) => item.lastModified !== null),
      authStored: false,
      responseHeadersStored: false,
      rawBodyStored: false,
    },
    evidenceClass: context.evidenceClass,
    summaryText: summaries.filter(Boolean).join(" — "),
  });
}

function nextLink(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  if (value.length > 2048) throw providerError("AGENTMO_DISCOVERY_LIVE_LINK_INVALID");
  for (const part of value.split(",")) {
    const match = part.trim().match(/^<([^>]+)>;\s*rel="([^"]+)"$/u);
    if (match?.[2] === "next") return match[1];
  }
  return null;
}

function boundedHeader(value) {
  return typeof value === "string" && value.length > 0 ? value.slice(0, 256) : null;
}

function boundedInteger(value) {
  if (!/^(?:0|[1-9]\d*)$/u.test(String(value ?? ""))) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function summarizeJson(bytes) {
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw providerError("AGENTMO_DISCOVERY_LIVE_GITHUB_JSON_INVALID");
  }
  const values = Array.isArray(value) ? value : [value];
  const parts = [];
  for (const item of values.slice(0, 20)) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    for (const key of ["title", "name", "full_name", "description", "updated_at", "html_url"]) {
      if (typeof item[key] === "string" && item[key].trim().length > 0) {
        parts.push(item[key].trim().slice(0, 256));
      }
    }
  }
  return parts.join(" ");
}

function providerError(code) {
  const error = new Error("GitHub provider response was rejected.");
  error.code = code;
  return error;
}
