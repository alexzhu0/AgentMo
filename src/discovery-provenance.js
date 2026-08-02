import { digestRawBytes } from "./artifact-admission.js";
import {
  containsHostAbsolutePath,
  containsSecretLikeValue,
  redactManagedText,
} from "./secret-redaction.js";

export const DISCOVERY_RETRIEVAL_SCHEMA_VERSION = "agentmo.discovery-retrieval.v1";

const SUMMARY_LIMIT = 48;

export function buildDiscoveryRetrievalRecord(input) {
  if (!Buffer.isBuffer(input?.bytes)) {
    throw provenanceError("AGENTMO_ARTIFACT_BYTES_REQUIRED");
  }
  const contentDigest = digestRawBytes(input.bytes);
  let decoded;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
  } catch {
    throw provenanceError("AGENTMO_DISCOVERY_LIVE_INVALID_UTF8");
  }
  if (containsSecretLikeValue(decoded) || containsHostAbsolutePath(decoded)) {
    throw provenanceError("AGENTMO_DISCOVERY_LIVE_SENSITIVE_CONTENT");
  }
  const summaryInput = typeof input.summaryText === "string" ? input.summaryText : decoded;
  const sanitized = redactManagedText(summaryInput)
    .replace(/\r\n?/gu, "\n")
    .replace(/\s+/gu, " ")
    .trim();
  if (sanitized.length === 0) {
    throw provenanceError("AGENTMO_DISCOVERY_LIVE_EMPTY_CONTENT");
  }
  const summary = sanitized.slice(0, SUMMARY_LIMIT);
  return {
    schemaVersion: DISCOVERY_RETRIEVAL_SCHEMA_VERSION,
    sourceId: input.source.id,
    requestedUrl: input.requestedUrl,
    finalUrl: input.finalUrl,
    retrievedAt: input.retrievedAt,
    retrievalStatus: "succeeded",
    httpStatus: input.httpStatus,
    contentType: input.contentType,
    contentLength: input.bytes.length,
    contentDigest,
    providerKind: input.providerKind ?? input.adapter,
    providerPolicy: input.providerPolicy ?? {},
    provider: {
      adapter: input.providerKind ?? input.adapter,
      destinationHost: new URL(input.finalUrl).hostname,
    },
    declaredTrustLevel: input.source.trust_level,
    evidenceClass: input.evidenceClass ?? "context",
    confidence: "unverified",
    confidenceRationale: "Bounded retrieval does not establish semantic correctness.",
    originalLocation: input.requestedUrl,
    sourceTimestamp: input.sourceTimestamp ?? null,
    summary,
    summaryTruncated: sanitized.length > summary.length,
  };
}

export function buildDiscoveryObservations(manifest, retrievals) {
  const ordered = [...retrievals].sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  const firstByDigest = new Map();
  const dedup = ordered.map((retrieval) => {
    const duplicateOf = firstByDigest.get(retrieval.contentDigest) ?? null;
    if (duplicateOf === null) firstByDigest.set(retrieval.contentDigest, retrieval.sourceId);
    return {
      sourceId: retrieval.sourceId,
      contentDigest: retrieval.contentDigest,
      duplicateOf,
      basis: "exact-content-digest",
      semanticConclusion: false,
    };
  });
  const referenceTime = Math.max(...ordered.map((item) => Date.parse(item.retrievedAt)).filter(Number.isFinite));
  const freshness = ordered.map((retrieval) => ({
    sourceId: retrieval.sourceId,
    retrievedAt: retrieval.retrievedAt,
    ageSeconds: Math.max(0, Math.floor((referenceTime - Date.parse(retrieval.retrievedAt)) / 1000)),
    status: "observed",
    basis: "retrieval-age",
    semanticConclusion: false,
  }));
  const sourceById = new Map((manifest.source_inventory ?? []).map((source) => [source.id, source]));
  const conflictCandidates = [];
  for (let left = 0; left < ordered.length; left += 1) {
    for (let right = left + 1; right < ordered.length; right += 1) {
      const leftFields = new Set(sourceById.get(ordered[left].sourceId)?.extraction_fields ?? []);
      const sharedFields = (sourceById.get(ordered[right].sourceId)?.extraction_fields ?? [])
        .filter((field) => leftFields.has(field));
      if (sharedFields.length === 0) continue;
      conflictCandidates.push({
        sourceIds: [ordered[left].sourceId, ordered[right].sourceId],
        sharedFields: sharedFields.sort(),
        basis: "shared-extraction-field-candidate",
        adjudicated: false,
        semanticConclusion: false,
      });
    }
  }
  const coverageGaps = ordered.flatMap((retrieval) => {
    const source = sourceById.get(retrieval.sourceId);
    const summary = retrieval.summary.toLowerCase();
    return (source?.extraction_fields ?? [])
      .filter((field) => !fieldTokens(field).some((token) => summary.includes(token)))
      .sort()
      .map((field) => ({
        sourceId: retrieval.sourceId,
        field,
        basis: "mechanical-summary-token-absence",
        semanticConclusion: false,
      }));
  });
  return {
    basis: "mechanical-non-semantic",
    dedup,
    freshness,
    conflictCandidates,
    coverageGaps,
    remainingUncertainty: "These observations do not adjudicate truth, quality, or requirement satisfaction.",
  };
}

function fieldTokens(value) {
  return String(value).toLowerCase().split(/[^a-z0-9]+/u).filter((item) => item.length >= 3);
}

function provenanceError(code) {
  const error = new Error("Discovery live provenance rejected the response.");
  error.code = code;
  return error;
}
