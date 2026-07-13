import { containsSecretLikeValue, redactSecrets } from "./secret-redaction.js";
import { validateSourceRefs } from "./source-refs.js";

export const USER_NEED_SCHEMA_VERSION = "agentmo.user-need.v1";

export async function loadUserNeed(filePath, options = {}) {
  if (options.subject !== "user-need") {
    const { AgentMoUnsupportedArtifactError } = await import("./artifact-registry.js");
    throw new AgentMoUnsupportedArtifactError("subject_identity_mismatch");
  }
  const { loadAdmittedArtifact } = await import("./artifact-admission.js");
  return (await loadAdmittedArtifact({
    filePath,
    subject: "user-need",
    expectedDigest: options.expectedDigest,
    maxBytes: options.maxBytes,
    openInput: options.openInput,
  })).value;
}

export function validateUserNeed(need) {
  const errors = [];
  const warnings = [];
  if (!isObject(need)) return { ok: false, errors: ["User-need must be a JSON object."], warnings };

  if (need.schemaVersion !== USER_NEED_SCHEMA_VERSION) errors.push(`schemaVersion must be ${USER_NEED_SCHEMA_VERSION}`);
  requireString(need, "agent_id", errors);
  requireString(need, "domain", errors);
  requireString(need, "problem", errors);
  requireStringArray(need, "target_users", errors);
  requireStringArray(need, "primary_tasks", errors);
  requireStringArray(need, "success_criteria", errors);
  requireStringArray(need, "hard_failures", errors);
  validateOutputPreferences(need.output_preferences, errors);
  optionalStringArray(need, "runtime_preferences", errors);
  optionalStringArray(need, "source_refs", errors);
  const sourceRefValidation = validateSourceRefs(need.source_refs ?? [], { fieldPath: "source_refs" });
  errors.push(...sourceRefValidation.errors);

  if (typeof need.problem === "string" && need.problem.trim().length < 24) {
    warnings.push("problem is short; make sure the agent opportunity is concrete enough to evaluate.");
  }
  if (Array.isArray(need.primary_tasks)) {
    for (const [index, task] of need.primary_tasks.entries()) {
      if (typeof task === "string" && isVagueTask(task)) warnings.push(`primary_tasks[${index}] is vague; prefer an observable workflow task.`);
    }
  }
  const redactionFindings = collectRedactionFindings(need);
  if (redactionFindings.length > 0) {
    errors.push(`secret-like string values are not allowed in user-need input: ${redactionFindings.join(", ")}`);
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function summarizeUserNeed(need) {
  return {
    schemaVersion: isObject(need) ? need.schemaVersion : undefined,
    agent_id: isObject(need) ? sanitizeText(need.agent_id ?? "") : undefined,
    domain: isObject(need) ? sanitizeText(need.domain ?? "") : undefined,
    target_user_count: Array.isArray(need?.target_users) ? need.target_users.filter(nonEmptyString).length : 0,
    primary_task_count: Array.isArray(need?.primary_tasks) ? need.primary_tasks.filter(nonEmptyString).length : 0,
    success_criteria_count: Array.isArray(need?.success_criteria) ? need.success_criteria.filter(nonEmptyString).length : 0,
    hard_failure_count: Array.isArray(need?.hard_failures) ? need.hard_failures.filter(nonEmptyString).length : 0,
    source_refs: Array.isArray(need?.source_refs) ? validateSourceRefs(need.source_refs, { fieldPath: "source_refs" }).refs : [],
    output_preferences: isObject(need?.output_preferences)
      ? {
          language: sanitizeText(need.output_preferences.language ?? ""),
          format: sanitizeText(need.output_preferences.format ?? ""),
          evidence_style: sanitizeText(need.output_preferences.evidence_style ?? ""),
        }
      : null,
  };
}

export function buildUserNeedReport(need) {
  const validation = validateUserNeed(need);
  return {
    kind: "agentmo_user_need_report",
    version: "0.1",
    ok: validation.ok,
    summary: summarizeUserNeed(need),
    warnings: validation.warnings,
    errors: validation.errors,
  };
}

export function formatUserNeedReport(report) {
  const lines = [
    `AgentMo user need: ${report.summary.agent_id ?? "unknown"}`,
    `Status: ${report.ok ? "pass" : "fail"}`,
    `Domain: ${report.summary.domain ?? "unknown"}`,
    `Target users: ${report.summary.target_user_count}`,
    `Primary tasks: ${report.summary.primary_task_count}`,
    `Success criteria: ${report.summary.success_criteria_count}`,
    `Hard failures: ${report.summary.hard_failure_count}`,
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

function validateOutputPreferences(value, errors) {
  if (!isObject(value)) {
    errors.push("output_preferences must be an object.");
    return;
  }
  requireString(value, "output_preferences.language", errors);
  requireString(value, "output_preferences.format", errors);
  requireString(value, "output_preferences.evidence_style", errors);
}

function isVagueTask(value) {
  const normalized = value.trim().toLowerCase();
  return normalized.length < 12 || ["help", "assist", "support", "answer questions", "do work"].includes(normalized);
}

function requireString(object, fieldPath, errors) {
  const key = fieldPath.split(".").at(-1);
  if (!nonEmptyString(object?.[key])) errors.push(`${fieldPath} must be a non-empty string.`);
}

function requireStringArray(object, fieldPath, errors) {
  const key = fieldPath.split(".").at(-1);
  const value = object?.[key];
  if (!Array.isArray(value)) {
    errors.push(`${fieldPath} must be an array.`);
    return;
  }
  for (const [index, item] of value.entries()) {
    if (!nonEmptyString(item)) errors.push(`${fieldPath}[${index}] must be a non-empty string.`);
  }
}

function optionalStringArray(object, fieldPath, errors) {
  const key = fieldPath.split(".").at(-1);
  if (!(key in object)) return;
  requireStringArray(object, fieldPath, errors);
}

function collectRedactionFindings(value, pointer = "$", findings = []) {
  if (typeof value === "string") {
    if (containsSecretLikeValue(value)) findings.push(pointer);
    return findings;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) collectRedactionFindings(item, `${pointer}[${index}]`, findings);
    return findings;
  }
  if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) collectRedactionFindings(item, `${pointer}.${key}`, findings);
  }
  return findings;
}

function sanitizeText(value) {
  return redactSecrets(String(value));
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
