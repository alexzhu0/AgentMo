import { BUILDER_LIFECYCLE_STAGES } from "./builders/contract.js";
import { digestRawBytes } from "./artifact-admission.js";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const CHECKPOINT_NEXT_ACTIONS = new Set([...BUILDER_LIFECYCLE_STAGES, "await-approval", "complete"]);
const ADMITTED_CHECKPOINT_SUMMARIES = new WeakSet();
const CHECKPOINT_SUMMARY_KEYS = Object.freeze([
  "schemaVersion",
  "adapterId",
  "workflowId",
  "checkpointDigest",
  "stage",
  "nextAction",
]);

export function admitBuilderCheckpointSummary(bytes, expectedDigest) {
  if (!Buffer.isBuffer(bytes) || !DIGEST_PATTERN.test(expectedDigest ?? "")) throw entryError();
  const actualDigest = digestRawBytes(bytes);
  if (actualDigest !== expectedDigest) throw entryError();
  let text;
  let value;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = JSON.parse(text);
  } catch {
    throw entryError();
  }
  if (!hasExactKeys(value, CHECKPOINT_SUMMARY_KEYS)) throw entryError();
  const canonical = `${JSON.stringify(value, null, 2)}\n`;
  if (!bytes.equals(Buffer.from(canonical, "utf8"))) throw entryError();
  validateCheckpointValue(value);
  deepFreeze(value);
  const admission = Object.freeze({
    subject: "builder-checkpoint-summary",
    digest: actualDigest,
    value,
  });
  ADMITTED_CHECKPOINT_SUMMARIES.add(admission);
  return admission;
}

export function buildBuilderEntry(options) {
  const probe = options?.probe;
  assertCompatibleProbe(probe);
  const requestedStage = options.requestedStage ?? null;
  const checkpoint = options.checkpoint ?? null;
  if (requestedStage !== null && !BUILDER_LIFECYCLE_STAGES.includes(requestedStage)) {
    throw entryError();
  }

  const admittedCheckpoint = checkpoint === null ? null : validateCheckpointSummary(checkpoint, probe.adapter.id);
  const expectedStage = admittedCheckpoint
    ? lifecycleStageForCheckpoint(admittedCheckpoint.value)
    : "discover";
  if (requestedStage !== null && requestedStage !== expectedStage) throw entryError();
  if (checkpoint === null && requestedStage !== null && requestedStage !== "discover") throw entryError();

  const mode = admittedCheckpoint ? "resume" : requestedStage ? "direct" : "start";
  const stage = requestedStage ?? expectedStage;
  const nextAction = admittedCheckpoint?.value.nextAction ?? stage;
  return {
    schemaVersion: "agentmo.builder-entry.v1",
    adapterId: probe.adapter.id,
    mode,
    stage,
    nextAction,
    proposalOnly: true,
    approval: {
      required: true,
      reason: admittedCheckpoint ? "resume-checkpoint" : `enter-${stage}`,
    },
    checkpoint: admittedCheckpoint
      ? {
          present: true,
          workflowId: admittedCheckpoint.value.workflowId,
          digest: admittedCheckpoint.value.checkpointDigest,
          summaryDigest: admittedCheckpoint.digest,
          stage: admittedCheckpoint.value.stage,
        }
      : { present: false },
    lifecycle: {
      stages: [...BUILDER_LIFECYCLE_STAGES],
      invariant: "Discover -> Plan -> Produce",
      directEntriesShareContract: true,
    },
    capabilitySnapshot: {
      evidenceLevel: probe.support.evidenceLevel,
      supportClaim: false,
      mutatesHost: probe.mutatesHost,
      externalCommandMutation: probe.externalCommandMutation,
      required: probe.observations
        .filter((item) => item.requirement === "required")
        .map((item) => ({ id: item.id, status: item.status })),
    },
    certificationBoundary: {
      hostBehaviorVerified: false,
      agentPackageQualityCertified: false,
      domainQualityCertified: false,
    },
  };
}

function assertCompatibleProbe(probe) {
  if (
    !probe ||
    probe.schemaVersion !== "agentmo.builder-probe.v1" ||
    probe.mutatesHost !== "unknown" ||
    probe.externalCommandMutation !== "unknown" ||
    probe.required?.ok !== true ||
    probe.support?.evidenceLevel !== "observed" ||
    probe.support?.claim !== false
  ) {
    throw entryError();
  }
}

function validateCheckpointSummary(admission, adapterId) {
  if (
    !admission ||
    !ADMITTED_CHECKPOINT_SUMMARIES.has(admission) ||
    admission.subject !== "builder-checkpoint-summary" ||
    !DIGEST_PATTERN.test(admission.digest ?? "") ||
    admission.value?.adapterId !== adapterId
  ) {
    throw entryError();
  }
  validateCheckpointValue(admission.value);
  return admission;
}

function validateCheckpointValue(value) {
  if (
    value?.schemaVersion !== "agentmo.builder-checkpoint-summary.v1" ||
    typeof value.workflowId !== "string" ||
    value.workflowId.length === 0 ||
    value.workflowId.length > 128 ||
    !DIGEST_PATTERN.test(value.checkpointDigest ?? "") ||
    !BUILDER_LIFECYCLE_STAGES.includes(value.stage) ||
    !CHECKPOINT_NEXT_ACTIONS.has(value.nextAction)
  ) {
    throw entryError();
  }
}

function lifecycleStageForCheckpoint(checkpoint) {
  return BUILDER_LIFECYCLE_STAGES.includes(checkpoint.nextAction)
    ? checkpoint.nextAction
    : checkpoint.stage;
}

function hasExactKeys(value, keys) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key, index) => Object.keys(value)[index] === key);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function entryError() {
  const error = new Error("Builder entry was rejected.");
  error.code = "AGENTMO_BUILDER_ENTRY_REJECTED";
  return error;
}
