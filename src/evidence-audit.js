import { createHash } from "node:crypto";
import { containsSecretLikeValue, REDACTED_SECRET } from "./secret-redaction.js";

export const SAFE_OUTPUT_SUMMARY_KINDS = new Set(["empty", "structured-json-summary", "unstructured-digest-summary"]);

const RAW_STORED_FLAG_FIELDS = new Set([
  "rawTranscriptStored",
  "rawTranscriptsStored",
  "rawToolBodyStored",
  "rawToolBodiesStored",
  "rawOutputPreviewStored",
  "rawOutputPreviewsStored",
  "stdoutPreviewStored",
  "stdoutPreviewsStored",
  "stderrPreviewStored",
  "stderrPreviewsStored",
  "rawPreviewStored",
  "rawPreviewsStored",
  "rawStdoutPreviewStored",
  "rawStdoutPreviewsStored",
  "rawStderrPreviewStored",
  "rawStderrPreviewsStored",
]);

const RAW_CONTENT_FIELDS = new Set([
  "rawTranscript",
  "rawTranscripts",
  "rawToolBody",
  "rawToolBodies",
  "rawOutputPreview",
  "rawOutputPreviews",
  "rawPreview",
  "rawPreviews",
  "rawStdoutPreview",
  "rawStdoutPreviews",
  "rawStderrPreview",
  "rawStderrPreviews",
  "stdoutPreview",
  "stdoutPreviews",
  "stderrPreview",
  "stderrPreviews",
]);

const RAW_KIND_FIELDS = new Set(["kind", "type", "evidenceKind", "evidenceType", "summaryKind"]);
const RAW_KIND_VALUES = new Set([
  "raw-transcript",
  "raw-transcripts",
  "raw-tool-body",
  "raw-tool-bodies",
  "raw-output-preview",
  "raw-output-previews",
  "raw-stdout-preview",
  "raw-stderr-preview",
]);

export function hashString(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function hashStableJson(value) {
  return hashString(stableStringify(value));
}

export function hashRuntimeJson(value) {
  return hashString(JSON.stringify(value));
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function auditEvidence(value, options = {}) {
  const findings = [];
  const secretValues = Array.isArray(options.secretValues) ? options.secretValues : [];
  visit(value, "$", null, findings, secretValues);
  const secretFindings = findings.filter((finding) => finding.kind === "secret-like-value");
  const rawFindings = findings.filter((finding) => finding.kind.startsWith("raw-"));
  return {
    ok: findings.length === 0,
    findings,
    secretFindings,
    rawFindings,
  };
}

export function hasAuditFindings(value, options = {}) {
  return !auditEvidence(value, options).ok;
}

export function isSafeOutputSummaryKind(summaryKind) {
  return SAFE_OUTPUT_SUMMARY_KINDS.has(summaryKind);
}

export function hasStoredContent(value) {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return value === true;
}

function visit(value, pointer, key, findings, secretValues) {
  if (typeof value === "string") {
    if (value !== REDACTED_SECRET && containsSecretLikeValue(value, secretValues)) {
      findings.push({ kind: "secret-like-value", pointer, message: "secret-like string value detected" });
    }
    if (isRawSummaryKindField(key, value)) {
      findings.push({ kind: "raw-summary-kind", pointer, message: "raw output preview summary kind detected" });
    }
    if (isRawEvidenceKindField(key, value)) {
      findings.push({ kind: "raw-evidence-kind", pointer, message: "raw evidence kind detected" });
    }
    return;
  }

  if (isRawStoredFlag(key, value)) {
    findings.push({ kind: "raw-stored-flag", pointer, message: `${key} is true` });
  }
  if (RAW_CONTENT_FIELDS.has(key) && hasStoredContent(value)) {
    findings.push({ kind: "raw-content-field", pointer, message: `${key} contains stored content` });
  }

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) visit(item, `${pointer}[${index}]`, String(index), findings, secretValues);
    return;
  }
  if (value && typeof value === "object") {
    for (const [childKey, item] of Object.entries(value)) {
      visit(item, `${pointer}.${childKey}`, childKey, findings, secretValues);
    }
  }
}

function isRawStoredFlag(key, value) {
  return RAW_STORED_FLAG_FIELDS.has(key) && value === true;
}

function isRawSummaryKindField(key, value) {
  return (key === "summaryKind" || (typeof key === "string" && key.endsWith("SummaryKind"))) && value === "raw-output-preview";
}

function isRawEvidenceKindField(key, value) {
  if (!RAW_KIND_FIELDS.has(key)) return false;
  const normalized = value.trim().toLowerCase();
  return RAW_KIND_VALUES.has(normalized);
}
