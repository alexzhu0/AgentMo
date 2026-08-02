import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import https from "node:https";

const BOUNDED_RESPONSE_HEADERS = Object.freeze([
  "content-length",
  "content-type",
  "location",
  "retry-after",
  "link",
  "etag",
  "last-modified",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
]);

const REQUEST_PROFILES = Object.freeze({
  web: Object.freeze({
    accept: "text/plain, text/html, application/json",
    "user-agent": "AgentMo/0.1 bounded-discovery",
  }),
  github: Object.freeze({
    accept: "application/vnd.github+json",
    "user-agent": "AgentMo/0.1 bounded-discovery",
    "x-github-api-version": "2022-11-28",
  }),
  arxiv: Object.freeze({
    accept: "application/atom+xml",
    "user-agent": "AgentMo/0.1 bounded-discovery (metadata-only)",
  }),
});

export const DEFAULT_DISCOVERY_LIVE_TRANSPORT = Object.freeze({
  request: requestHttps,
});

export function normalizeDiscoveryLiveTransport(value) {
  const transport = value ?? DEFAULT_DISCOVERY_LIVE_TRANSPORT;
  if (
    transport === null
    || typeof transport !== "object"
    || Array.isArray(transport)
    || typeof transport.request !== "function"
  ) {
    throw new TypeError("Discovery live transport is invalid.");
  }
  return transport;
}

export function isPublicNetworkAddress(value) {
  if (typeof value !== "string" || isIP(value) === 0) return false;
  const address = value.toLowerCase().split("%", 1)[0];
  if (isIP(address) === 4) return isPublicIpv4(address);
  if (address === "::" || address === "::1") return false;
  if (address.startsWith("fe8") || address.startsWith("fe9")
    || address.startsWith("fea") || address.startsWith("feb")) return false;
  if (address.startsWith("fc") || address.startsWith("fd")) return false;
  if (address.startsWith("ff")) return false;
  if (address.startsWith("2001:db8")) return false;
  if (address.startsWith("::ffff:")) {
    return isPublicIpv4(address.slice("::ffff:".length));
  }
  return true;
}

async function requestHttps(request) {
  const url = new URL(request?.url);
  if (url.protocol !== "https:") throw transportError("AGENTMO_DISCOVERY_LIVE_HTTPS_REQUIRED");
  if (request?.redirectMode !== "manual") {
    throw transportError("AGENTMO_DISCOVERY_LIVE_TRANSPORT_CONTRACT");
  }
  const headers = REQUEST_PROFILES[request?.profile];
  if (headers === undefined) throw transportError("AGENTMO_DISCOVERY_LIVE_TRANSPORT_CONTRACT");
  const addresses = await resolvePublicAddresses(url.hostname);
  const selected = addresses[0];

  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: "GET",
      signal: request.signal,
      maxHeaderSize: 16_384,
      headers,
      lookup(_hostname, _options, callback) {
        callback(null, selected.address, selected.family);
      },
    }, (response) => {
      resolve({
        status: response.statusCode,
        url: url.href,
        remoteAddress: response.socket?.remoteAddress ?? selected.address,
        resolvedAddresses: addresses.map((item) => item.address),
        headers: boundedHeaders(response.headers),
        body: response,
      });
    });
    req.once("error", reject);
    req.end();
  });
}

async function resolvePublicAddresses(hostname) {
  if (isIP(hostname) !== 0) {
    if (!isPublicNetworkAddress(hostname)) {
      throw transportError("AGENTMO_DISCOVERY_LIVE_PRIVATE_DESTINATION");
    }
    return [{ address: hostname, family: isIP(hostname) }];
  }
  let addresses;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw transportError("AGENTMO_DISCOVERY_LIVE_DNS_FAILED");
  }
  if (
    addresses.length === 0
    || addresses.some((item) => !isPublicNetworkAddress(item.address))
  ) {
    throw transportError("AGENTMO_DISCOVERY_LIVE_PRIVATE_DESTINATION");
  }
  return addresses;
}

function boundedHeaders(headers) {
  const result = {};
  for (const key of BOUNDED_RESPONSE_HEADERS) {
    const value = headers?.[key];
    if (typeof value === "string") result[key] = value.slice(0, 1024);
    else if (Array.isArray(value) && typeof value[0] === "string") {
      result[key] = value[0].slice(0, 1024);
    }
  }
  return result;
}

function isPublicIpv4(address) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) {
    return false;
  }
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51) return false;
  if (a === 203 && b === 0) return false;
  return true;
}

function transportError(code) {
  const error = new Error("Discovery live transport rejected the request.");
  error.code = code;
  return error;
}
