import { readFile } from "node:fs/promises";

export const OBSERVATION_SCHEMA_VERSION = "agentmo.observation.v1";
export const OBSERVATION_REPORT_SCHEMA_VERSION = "agentmo.observation-report.v1";

const RECOMMENDED_STATUSES = new Set(["proposed", "triaged", "regression_added", "resolved", "rejected"]);

export async function loadObservationRecord(path) {
  const raw = await readFile(path, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON observation ${path}: ${message}`);
  }
}

export function validateObservationRecord(record) {
  const errors = [];
  const warnings = [];

  if (!isObject(record)) {
    return { ok: false, errors: ["Observation record must be a JSON object."], warnings };
  }

  if (record.schemaVersion !== OBSERVATION_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${OBSERVATION_SCHEMA_VERSION}`);
  }
  requireString(record.agentId, "agentId", errors);
  requireString(record.source, "source", errors);
  requireString(record.failureMode, "failureMode", errors);
  requireString(record.status, "status", errors);

  if (!nonEmptyStringArray(record.evidenceRefs)) {
    errors.push("evidenceRefs must contain at least one evidence reference.");
  }
  if (record.proposedRegression === undefined) {
    errors.push("proposedRegression is required so future changes are backed by a regression case.");
  }
  if (record.recommendedBlueprintChange === undefined) {
    warnings.push("recommendedBlueprintChange is not set; record captures evidence but no blueprint proposal.");
  }
  if (typeof record.status === "string" && !RECOMMENDED_STATUSES.has(record.status)) {
    warnings.push(`status ${record.status} is not one of the recommended statuses: ${Array.from(RECOMMENDED_STATUSES).join(", ")}.`);
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function buildObservationReport(record) {
  const validation = validateObservationRecord(record);
  return {
    schemaVersion: OBSERVATION_REPORT_SCHEMA_VERSION,
    kind: "agentmo_observation_report",
    ok: validation.ok,
    summary: {
      schemaVersion: record?.schemaVersion ?? null,
      agentId: record?.agentId ?? null,
      source: record?.source ?? null,
      failureMode: record?.failureMode ?? null,
      evidenceRefCount: Array.isArray(record?.evidenceRefs) ? record.evidenceRefs.length : 0,
      status: record?.status ?? null,
    },
    proposedRegression: record?.proposedRegression ?? null,
    recommendedBlueprintChange: {
      proposalOnly: true,
      value: record?.recommendedBlueprintChange ?? null,
    },
    mutation: {
      autoApplied: false,
      reason: "Observation records capture evidence and proposals only; blueprint/tool/eval changes require a reviewed regression and verification evidence.",
    },
    warnings: validation.warnings,
    errors: validation.errors,
  };
}

export function formatObservationReport(report) {
  const lines = [
    `AgentMo observation: ${report.summary.agentId ?? "unknown"}`,
    `Status: ${report.ok ? "valid" : "invalid"}`,
    `Source: ${report.summary.source ?? "unknown"}`,
    `Failure mode: ${report.summary.failureMode ?? "unknown"}`,
    `Evidence refs: ${report.summary.evidenceRefCount}`,
    `Mutation: ${report.mutation.autoApplied ? "auto-applied" : "proposal only"}`,
  ];

  if (report.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const warning of report.warnings) lines.push(`- ${warning}`);
  }

  if (report.errors.length > 0) {
    lines.push("", "Errors:");
    for (const error of report.errors) lines.push(`- ${error}`);
  }

  return `${lines.join("\n")}\n`;
}

function requireString(value, path, errors) {
  if (typeof value !== "string" || value.trim() === "") errors.push(`${path} must be a non-empty string.`);
}

function nonEmptyStringArray(value) {
  return Array.isArray(value) && value.some((item) => typeof item === "string" && item.trim() !== "");
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
