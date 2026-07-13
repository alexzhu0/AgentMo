import { createHash } from "node:crypto";
import { containsSecretLikeKey, containsSecretLikeValue, REDACTED_SECRET } from "./secret-redaction.js";

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
  "rawPrompt",
  "rawPrompts",
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

const PERSISTABILITY_RAW_CONTENT_FIELDS = new Set([
  "prompt",
  "prompts",
  "rawPrompt",
  "rawPrompts",
  "transcript",
  "transcripts",
  "rawTranscript",
  "rawTranscripts",
  "toolBody",
  "toolBodies",
  "rawToolBody",
  "rawToolBodies",
  "toolOutput",
  "toolOutputs",
  "rawToolOutput",
  "rawToolOutputs",
  "stdout",
  "stderr",
  "rawStdout",
  "rawStderr",
  ...RAW_CONTENT_FIELDS,
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

const HOSTILE_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MIGRATION_RAW_CONTENT_FIELDS = new Set([
  "transcript",
  "transcripts",
  "stdout",
  "stdouts",
  "stderr",
  "stderrs",
  "output",
  "outputs",
  "commandOutput",
  "commandOutputs",
  "processOutput",
  "processOutputs",
  "toolOutput",
  "toolOutputs",
  "outputText",
  "outputTexts",
  "rawContent",
  "rawContents",
]);
const DEFAULT_RECURSION_MAX_DEPTH = 128;
const DEFAULT_RECURSION_MAX_NODES = 20_000;

function normalizeCandidateKey(key) {
  return typeof key === "string" ? key.toLowerCase().replace(/[^a-z0-9]/gu, "") : key;
}

const NORMALIZED_RAW_STORED_FLAG_FIELDS = new Set(
  Array.from(RAW_STORED_FLAG_FIELDS, normalizeCandidateKey),
);
const NORMALIZED_RAW_CONTENT_FIELDS = new Set(
  [...RAW_CONTENT_FIELDS, ...MIGRATION_RAW_CONTENT_FIELDS].map(normalizeCandidateKey),
);
const NORMALIZED_RAW_KIND_FIELDS = new Set(Array.from(RAW_KIND_FIELDS, normalizeCandidateKey));
const NORMALIZED_PERSISTABILITY_RAW_CONTENT_FIELDS = new Set(
  Array.from(PERSISTABILITY_RAW_CONTENT_FIELDS, normalizeCandidateKey),
);

export function normalizeEvidenceFieldName(key) {
  return normalizeCandidateKey(key);
}

export function isPersistabilityRawContentField(key) {
  return NORMALIZED_PERSISTABILITY_RAW_CONTENT_FIELDS.has(normalizeCandidateKey(key));
}

export function isRawStoredFlagField(key) {
  return NORMALIZED_RAW_STORED_FLAG_FIELDS.has(normalizeCandidateKey(key));
}

export function isRawMaterialKind(key, value) {
  return typeof value === "string" && (isRawSummaryKindField(key, value) || isRawEvidenceKindField(key, value));
}

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
  const state = { nodes: 0 };
  function visit(item, depth) {
    state.nodes += 1;
    if (depth > DEFAULT_RECURSION_MAX_DEPTH || state.nodes > DEFAULT_RECURSION_MAX_NODES) {
      const error = new Error("Resource budget exceeded.");
      error.code = "AGENTMO_RESOURCE_BUDGET_EXCEEDED";
      throw error;
    }
    if (Array.isArray(item)) return `[${item.map((child) => visit(child, depth + 1)).join(",")}]`;
    if (item && typeof item === "object") {
      return `{${Object.keys(item)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${visit(item[key], depth + 1)}`)
        .join(",")}}`;
    }
    return JSON.stringify(item);
  }
  return visit(value, 0);
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

export function auditMigrationCandidate(value, options = {}) {
  const reasons = new Set();
  const seen = new WeakSet();
  const maxDepth = options.maxDepth ?? DEFAULT_RECURSION_MAX_DEPTH;
  const maxNodes = options.maxNodes ?? DEFAULT_RECURSION_MAX_NODES;
  let nodes = 0;

  function inspect(item, key = null, depth = 0) {
    nodes += 1;
    if (depth > maxDepth || nodes > maxNodes) {
      const error = new Error("Resource budget exceeded.");
      error.code = "AGENTMO_RESOURCE_BUDGET_EXCEEDED";
      throw error;
    }
    if (typeof item === "string") {
      if (item !== REDACTED_SECRET && containsSecretLikeValue(item)) reasons.add("secret_shaped_value");
      if (isRawSummaryKindField(key, item) || isRawEvidenceKindField(key, item)) reasons.add("raw_content");
      return;
    }
    if (item === null || typeof item === "boolean") return;
    if (typeof item === "number") {
      if (!Number.isFinite(item)) reasons.add("non_json_value");
      return;
    }
    if (typeof item !== "object") {
      reasons.add("non_json_value");
      return;
    }
    if (seen.has(item)) {
      reasons.add("non_json_value");
      return;
    }
    seen.add(item);

    if (isRawStoredFlag(key, item)) reasons.add("raw_content");
    if (isMigrationRawContentField(key) && hasStoredContent(item)) {
      reasons.add("raw_content");
    }

    if (Array.isArray(item)) {
      if (item.length > maxNodes - nodes) {
        const error = new Error("Resource budget exceeded.");
        error.code = "AGENTMO_RESOURCE_BUDGET_EXCEEDED";
        throw error;
      }
      for (const child of item) inspect(child, null, depth + 1);
      return;
    }

    const keys = Object.keys(item);
    if (keys.length > maxNodes - nodes) {
      const error = new Error("Resource budget exceeded.");
      error.code = "AGENTMO_RESOURCE_BUDGET_EXCEEDED";
      throw error;
    }
    if (Object.getOwnPropertySymbols(item).length > 0) reasons.add("non_json_value");
    for (const childKey of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(item, childKey);
      if (HOSTILE_OBJECT_KEYS.has(childKey)) reasons.add("hostile_object_key");
      if (containsSecretLikeKey(childKey)) reasons.add("secret_shaped_key");
      if (!("value" in descriptor)) {
        reasons.add("non_json_value");
        continue;
      }
      const child = descriptor.value;
      if (isRawStoredFlag(childKey, child)) reasons.add("raw_content");
      if (isMigrationRawContentField(childKey) && hasStoredContent(child)) {
        reasons.add("raw_content");
      }
      inspect(child, childKey, depth + 1);
    }
  }

  try {
    inspect(value);
  } catch (error) {
    reasons.add(error?.code === "AGENTMO_RESOURCE_BUDGET_EXCEEDED" ? "resource_budget_exceeded" : "unsafe_object");
  }

  return {
    ok: reasons.size === 0,
    reasons: Array.from(reasons).sort(),
  };
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
    if (RAW_CONTENT_FIELDS.has(key) && hasStoredContent(value)) {
      findings.push({ kind: "raw-content-field", pointer, message: `${key} contains stored content` });
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
  return NORMALIZED_RAW_STORED_FLAG_FIELDS.has(normalizeCandidateKey(key)) && value === true;
}

function isMigrationRawContentField(key) {
  return NORMALIZED_RAW_CONTENT_FIELDS.has(normalizeCandidateKey(key));
}

function isRawSummaryKindField(key, value) {
  const normalized = normalizeCandidateKey(key);
  return (normalized === "summarykind" || (typeof normalized === "string" && normalized.endsWith("summarykind")))
    && value === "raw-output-preview";
}

function isRawEvidenceKindField(key, value) {
  if (!NORMALIZED_RAW_KIND_FIELDS.has(normalizeCandidateKey(key))) return false;
  const normalized = value.trim().toLowerCase();
  return RAW_KIND_VALUES.has(normalized);
}
