import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { BUILD_STATE_SCHEMA_VERSION } from "./build-state.js";
import { validateBlueprint } from "./blueprint.js";
import { RUN_EVAL_SCHEMA_VERSION, RUN_STATE_SCHEMA_VERSION } from "./run-state.js";
import { assertRuntimeEnvReady } from "./runtime-env.js";
import { containsSecretLikeValue } from "./secret-redaction.js";

export const BIRTH_REPORT_SCHEMA_VERSION = "agentmo.birth-report.v1";
export const BIRTH_EVIDENCE_LEVELS = Object.freeze(["declared", "live-success", "failure"]);

export async function loadJsonArtifact(filePath, subject) {
  const raw = await readFile(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${subject} JSON ${filePath}: ${message}`);
  }
}

export function buildBirthReport(blueprint, options = {}) {
  const buildState = options.buildState;
  const runState = options.runState;
  const runEval = options.runEval;
  const expectStatus = options.expectStatus ?? null;
  const validation = validateBlueprint(blueprint);
  const stableBlueprintHash = hashStableJson(blueprint);
  const runtimeBlueprintHash = hashRuntimeJson(blueprint);
  const actualStatus = runState?.execution?.status ?? null;
  const evidenceLevel = resolveEvidenceLevel(runState);
  const secretFindings = collectSecretLikeStringFindings({ buildState, runState, runEval });
  const runEvalRawOutputCheck = runEval?.checks?.find((item) => item?.id === "raw_output_preview_absent");
  const checks = [
    check("expected_status_supplied", typeof expectStatus === "string" && expectStatus.length > 0, "birth-report requires explicit --expect-status"),
    check("blueprint_validation", validation.ok, validation.ok ? "blueprint validates" : "blueprint has validation errors"),
    check("build_state_schema", buildState?.schemaVersion === BUILD_STATE_SCHEMA_VERSION, "build-state schema is supported"),
    check("build_state_agent", buildState?.agentId === blueprint.agent_id, "build-state agentId matches blueprint"),
    check("target_match", buildState?.target?.id === runState?.target?.id, "build-state target matches run-state target"),
    check("build_state_blueprint_hash", buildState?.source?.blueprintHash === stableBlueprintHash, "build-state source hash matches blueprint"),
    check("run_state_schema", runState?.schemaVersion === RUN_STATE_SCHEMA_VERSION, "run-state schema is supported"),
    check("run_state_agent", runState?.agentId === blueprint.agent_id, "run-state agentId matches blueprint"),
    check("run_state_blueprint_hash", runState?.source?.blueprintHash === runtimeBlueprintHash, "run-state source hash matches blueprint"),
    check("run_eval_schema", runEval?.schemaVersion === RUN_EVAL_SCHEMA_VERSION, "run-eval schema is supported"),
    check("run_eval_run_id", runEval?.runId === runState?.runId, "run-eval runId matches run-state runId"),
    check("run_eval_ok", runEval?.ok === true, "run-eval passed"),
    check("expected_status", Boolean(expectStatus) && actualStatus === expectStatus, `run-state execution status matches ${expectStatus ?? "<missing>"}`),
    check("run_eval_actual_status", runEval?.actualStatus === actualStatus, "run-eval actualStatus matches run-state execution status"),
    check("run_eval_expected_status", !expectStatus || runEval?.expectedStatus === expectStatus, "run-eval expectedStatus matches birth-report expectation"),
    check("runtime_env_ready", runtimeEnvReadyForEvidence(runState), "live provider runtime env descriptor satisfies required keys"),
    check("sandbox_present", Boolean(runState?.runtimeIdentity?.sandboxScope), "sandbox scope evidence is present"),
    check("sandbox_non_production", runState?.runtimeIdentity?.sandboxScope?.usesProductionState !== true, "run evidence does not use production OpenClaw state"),
    check("certification_boundary", runState?.certificationBoundary?.runEvidenceCertifiesRuntime === false, "run evidence does not certify runtime/domain behavior"),
    check("run_eval_boundary", runEval?.certificationBoundary?.runtimeCertifiedByRun === false && runEval?.certificationBoundary?.domainCertifiedByRun === false, "run-eval does not certify runtime/domain behavior"),
    check("process_group_closed", timedOutProcessGroupClosed(runState), "timed-out live runs prove process-group cleanup or fail closed"),
    check("no_raw_transcripts", runState?.evidence?.rawTranscriptStored === false, "managed evidence does not store raw transcripts"),
    check("no_raw_tool_bodies", runState?.evidence?.rawToolBodiesStored === false, "managed evidence does not store raw tool bodies"),
    check(
      "raw_output_preview_absent",
      runStateStoresRawOutputPreview(runState) === false && runEvalRawOutputCheck?.pass === true,
      "managed evidence does not store raw stdout/stderr previews",
    ),
    check("managed_evidence_sanitized", secretFindings.length === 0, secretFindings.length === 0 ? "managed evidence contains no secret-like string values" : `secret-like string values found: ${secretFindings.join(", ")}`),
    check("evidence_level", evidenceLevelMatches(expectStatus, evidenceLevel, runState), evidenceLevelMessage(expectStatus, evidenceLevel)),
  ];
  const artifactValid = checks.every((item) => item.pass);
  const birthReady = artifactValid && evidenceLevel !== "failure";
  const promotionEligible = artifactValid && evidenceLevel === "live-success";
  return {
    schemaVersion: BIRTH_REPORT_SCHEMA_VERSION,
    ok: artifactValid,
    artifactValid,
    birthReady,
    promotionEligible,
    agentId: blueprint?.agent_id ?? null,
    evidenceLevel,
    birthStatus: resolveBirthStatus(artifactValid, evidenceLevel),
    expectedStatus: expectStatus,
    actualStatus,
    artifacts: {
      blueprintPath: options.blueprintPath ?? null,
      buildStatePath: options.buildStatePath ?? null,
      runStatePath: options.runStatePath ?? null,
      runEvalPath: options.runEvalPath ?? null,
    },
    checks,
    validation: {
      ok: validation.ok,
      warnings: validation.warnings,
      errors: validation.errors,
    },
    certificationBoundary: {
      runtimeCertifiedByBirthReport: false,
      domainCertifiedByBirthReport: false,
      runtimeCertifiedByRun: false,
      domainCertifiedByRun: false,
    },
    nextActions: nextActions(artifactValid, birthReady, evidenceLevel, expectStatus),
  };
}

function resolveBirthStatus(ok, evidenceLevel) {
  if (!ok) return "blocked";
  if (evidenceLevel === "live-success") return "born";
  if (evidenceLevel === "declared") return "declared-ready";
  if (evidenceLevel === "failure") return "failure-evidence";
  return "blocked";
}

export function formatBirthReport(report) {
  const lines = [
    `AgentMo birth report: ${report.agentId ?? "unknown"}`,
    `Artifact status: ${report.artifactValid ? "valid" : "invalid"}`,
    `Birth ready: ${report.birthReady ? "yes" : "no"}`,
    `Promotion eligible: ${report.promotionEligible ? "yes" : "no"}`,
    `Birth status: ${report.birthStatus}`,
    `Evidence level: ${report.evidenceLevel}`,
    `Expected execution status: ${report.expectedStatus ?? "missing"}`,
    `Actual execution status: ${report.actualStatus ?? "unknown"}`,
    "Certification: not implied by birth-report evidence",
  ];
  for (const checkItem of report.checks) lines.push(`- ${checkItem.pass ? "PASS" : "FAIL"} ${checkItem.id}: ${checkItem.message}`);
  if (report.nextActions.length > 0) {
    lines.push("", "Next actions:");
    for (const action of report.nextActions) lines.push(`- ${action}`);
  }
  return `${lines.join("\n")}\n`;
}

function resolveEvidenceLevel(runState) {
  if (runState?.execution?.status === "success" && runState.execution.executed === true && runState.execution.live === true) return "live-success";
  if (runState?.execution?.status === "failure") return "failure";
  return "declared";
}

function evidenceLevelMatches(expectStatus, evidenceLevel, runState) {
  if (!expectStatus) return false;
  if (expectStatus === "success") return evidenceLevel === "live-success";
  if (expectStatus === "declared") return evidenceLevel === "declared" && runState?.execution?.executed === false;
  if (expectStatus === "failure") return evidenceLevel === "failure";
  return false;
}

function evidenceLevelMessage(expectStatus, evidenceLevel) {
  if (!expectStatus) return "birth-report requires explicit evidence expectation";
  if (expectStatus === "success") return evidenceLevel === "live-success" ? "live success evidence is present" : "success birth requires live-success evidence";
  if (expectStatus === "declared") return evidenceLevel === "declared" ? "declared evidence path is explicit" : "declared birth requires declared non-live evidence";
  if (expectStatus === "failure") return evidenceLevel === "failure" ? "failure evidence path is explicit" : "failure expectation requires failure evidence";
  return `unknown expected status: ${expectStatus}`;
}

function nextActions(artifactValid, birthReady, evidenceLevel, expectStatus) {
  if (!artifactValid) return ["Fix failed checks and rerun run-eval plus birth-report before claiming birth."];
  if (!birthReady && expectStatus === "failure") return ["Failure evidence is explicit; create an observe/evolve proposal before modifying the blueprint or runtime."];
  if (evidenceLevel === "declared") return ["Declared gate passed; run an isolated live smoke and rerun birth-report with --expect-status success before runtime promotion."];
  if (evidenceLevel === "live-success") return ["Live-success gate passed; still run domain eval/rubric review before certification or release claims."];
  return [];
}

function runtimeEnvReadyForEvidence(runState) {
  try {
    assertRuntimeEnvReady(runState?.runtimeIdentity?.runtimeEnv, {
      live: runState?.execution?.live === true,
      provider: runState?.runtimeIdentity?.provider,
      transport: runState?.runtimeIdentity?.transport,
    });
    return true;
  } catch (_error) {
    return false;
  }
}

function timedOutProcessGroupClosed(runState) {
  if (runState?.execution?.timedOut !== true) return true;
  const verification = runState.execution.processGroupVerification;
  return (
    runState.execution.processGroupClosed === true &&
    runState.execution.processGroupCleanupFailed !== true &&
    isPositiveProcessGroupVerification(verification) &&
    runState.evidence?.processGroupClosed === true &&
    runState.evidence?.processGroupCleanupFailed !== true &&
    runState.evidence?.processGroupVerification === verification
  );
}

function isPositiveProcessGroupVerification(verification) {
  return verification === "closed-after-sigterm-grace" || verification === "closed-after-sigkill-grace";
}

function runStateStoresRawOutputPreview(runState) {
  return (
    runState?.evidence?.rawOutputPreviewStored === true ||
    streamStoresRawPreview(runState?.evidence, "stdout") ||
    streamStoresRawPreview(runState?.evidence, "stderr") ||
    outputStoresRawPreview(runState?.execution?.stdout) ||
    outputStoresRawPreview(runState?.execution?.stderr)
  );
}

function streamStoresRawPreview(evidence, streamName) {
  if (!evidence || typeof evidence !== "object") return true;
  const flagName = `${streamName}PreviewStored`;
  const summaryName = `${streamName}Summary`;
  const summaryKindName = `${streamName}SummaryKind`;
  const summaryKind = evidence[summaryKindName];
  const summaryStored = hasStoredPreview(evidence[summaryName]);
  if (evidence[flagName] === true) return true;
  if (summaryKind === "raw-output-preview") return summaryStored;
  if (isSafeOutputSummaryKind(summaryKind)) return false;
  if (summaryStored) return true;
  return false;
}

function outputStoresRawPreview(output) {
  if (!output || typeof output !== "object") return true;
  if (output.summaryKind === "raw-output-preview" || output.rawPreviewStored === true) return hasStoredPreview(output.preview);
  if (isSafeOutputSummaryKind(output.summaryKind)) return false;
  return hasStoredPreview(output.preview);
}

function isSafeOutputSummaryKind(summaryKind) {
  return summaryKind === "empty" || summaryKind === "structured-json-summary" || summaryKind === "unstructured-digest-summary";
}

function hasStoredPreview(value) {
  return typeof value === "string" && value.length > 0;
}

function check(id, pass, message) {
  return { id, pass: Boolean(pass), message };
}

function collectSecretLikeStringFindings(value, pointer = "$", findings = []) {
  if (typeof value === "string") {
    if (containsSecretLikeValue(value) && value !== "[REDACTED_SECRET]") findings.push(pointer);
    return findings;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) collectSecretLikeStringFindings(item, `${pointer}[${index}]`, findings);
    return findings;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) collectSecretLikeStringFindings(item, `${pointer}.${key}`, findings);
  }
  return findings;
}

function hashRuntimeJson(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function hashStableJson(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
