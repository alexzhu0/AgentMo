import path from "node:path";
import { lstat, realpath } from "node:fs/promises";
import { digestRawBytes } from "./artifact-admission.js";
import { admitBuilderCheckpointSummary } from "./builder-entry.js";
import {
  assertPersistable,
  serializePersistableJson,
} from "./persistability.js";
import {
  ImmutableJournalError,
  appendImmutableJournalEntry,
  assertImmutableJournalAdmission,
  loadImmutableJournal,
  readImmutableJournalAdmissionBytes,
} from "./builder-immutable-journal.js";
import { readAppendOnlyAuthority } from "./builder-append-only-authority.js";
import { assertBuilderPlatform } from "./builder-platform.js";

export const BUILDER_CHECKPOINT_SCHEMA_VERSION = "agentmo.builder-checkpoint.v4";
export const DEFAULT_MAX_BUILDER_CHECKPOINT_BYTES = 256 * 1024;

const LEGACY_V1_BUILDER_CHECKPOINT_SCHEMA_VERSION = "agentmo.builder-checkpoint.v1";
const LEGACY_V2_BUILDER_CHECKPOINT_SCHEMA_VERSION = "agentmo.builder-checkpoint.v2";
const LEGACY_V3_BUILDER_CHECKPOINT_SCHEMA_VERSION = "agentmo.builder-checkpoint.v3";
const CHECKPOINTS = new WeakSet();
const LEGACY_CHECKPOINTS = new WeakSet();
const CHECKPOINT_ADMISSIONS = new WeakSet();
const CHECKPOINT_ADMISSION_DETAILS = new WeakMap();
const CHECKPOINT_PROTOCOL_INTENTS = new WeakMap();
const LIFECYCLE_AUTHORITY_ADMISSIONS = new WeakSet();
const LIFECYCLE_AUTHORITY_ADMISSION_DETAILS = new WeakMap();
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SUBJECT_PATTERN = /^[a-z][a-z0-9-]{1,63}$/u;
const STAGES = new Set(["discover", "plan", "produce"]);
const NEXT_ACTIONS = new Set(["discover", "plan", "produce", "await-approval", "complete"]);
const BOUNDARIES = new Set([
  "artifact-created",
  "approval-required",
  "approval-resolved",
  "stage-transition",
  "manual-pause",
  "pre-compact",
  "post-compact",
  "session-restart",
]);
const PAUSE_REASONS = new Set([null, "user-request", "context-compaction", "session-restart", "approval-required"]);
const LEGACY_V1_CHECKPOINT_KEYS = Object.freeze([
  "schemaVersion",
  "workflowId",
  "adapterId",
  "stage",
  "boundary",
  "artifactRefs",
  "pendingDecision",
  "nextAction",
  "installReceiptDigest",
  "capabilitySnapshot",
  "eventLedger",
  "pauseReason",
]);
const LEGACY_V2_CHECKPOINT_KEYS = Object.freeze([
  ...LEGACY_V1_CHECKPOINT_KEYS,
  "codexDeliveryCursor",
  "codexUatChallenge",
]);
const LEGACY_V3_CHECKPOINT_KEYS = Object.freeze([
  ...LEGACY_V2_CHECKPOINT_KEYS,
  "hookDeactivationProtocol",
]);
const CHECKPOINT_KEYS = LEGACY_V3_CHECKPOINT_KEYS;
const HOOK_PROTOCOL_STATES = new Set([
  "open",
  "hook-prepared",
  "hook-finalized",
  "deactivation-fenced",
  "upgrade-reserved",
]);
const LEGACY_V3_HOOK_PROTOCOL_STATES = new Set([
  "open",
  "hook-prepared",
  "hook-finalized",
  "deactivation-fenced",
]);
const LEGACY_V3_HOOK_PROTOCOL_KEYS = Object.freeze([
  "state",
  "operationId",
  "predecessorCheckpointDigest",
  "lifecycleHeadDigest",
  "receiptDigest",
  "delivery",
  "observationDigest",
]);
const HOOK_PROTOCOL_KEYS = Object.freeze([
  ...LEGACY_V3_HOOK_PROTOCOL_KEYS,
  "upgradeReservation",
]);
const CODEX_UAT_SCENARIOS = new Set([
  "session-start",
  "skill-discovery",
  "user-prompt-non-trigger",
  "manual-pause",
  "pre-compact",
  "post-compact",
  "restart-resume",
  "duplicate-replay",
  "second-compaction",
  "upgrade-visibility",
  "deactivation-tombstone-visibility",
]);
const OPAQUE_CORRELATION_PATTERN = /^opaque:[a-f0-9]{64}$/u;
const COMPACT_STATES = new Set(["idle", "pre-applied", "post-applied"]);
const BUILDER_LIFECYCLE_AUTHORITY_PATH = ".agentmo/builder/lifecycle-authority";
const BUILDER_LIFECYCLE_NAMESPACE = "builder-lifecycle";
const BUILDER_LIFECYCLE_EVENT_SCHEMA_VERSION = "agentmo.builder-lifecycle-event.v3";
const CHECKPOINT_UPGRADE_COORDINATION_KIND = "checkpoint-upgrade-reservation";

export class BuilderCheckpointError extends Error {
  constructor(code) {
    super("Builder checkpoint operation was rejected.");
    this.name = "BuilderCheckpointError";
    this.code = code;
  }
}

export function buildBuilderCheckpoint(input) {
  assertCheckpointInputShape(input);
  const checkpoint = {
    schemaVersion: BUILDER_CHECKPOINT_SCHEMA_VERSION,
    workflowId: input?.workflowId,
    adapterId: input?.adapterId,
    stage: input?.stage,
    boundary: input?.boundary,
    artifactRefs: normalizeArtifactRefs(input?.artifactRefs),
    pendingDecision: normalizePendingDecision(input?.pendingDecision),
    nextAction: input?.nextAction,
    installReceiptDigest: input?.installReceiptDigest ?? null,
    capabilitySnapshot: normalizeCapabilitySnapshot(input?.capabilitySnapshot),
    eventLedger: normalizeEventLedger(input?.eventLedger),
    pauseReason: input?.pauseReason ?? null,
    codexDeliveryCursor: normalizeCodexDeliveryCursor(input?.codexDeliveryCursor),
    codexUatChallenge: normalizeCodexUatChallenge(input?.codexUatChallenge),
    hookDeactivationProtocol: normalizeHookDeactivationProtocol(
      input?.hookDeactivationProtocol,
    ),
  };
  validateBuilderCheckpoint(checkpoint);
  assertPersistable(checkpoint, { subject: "builder-checkpoint" });
  deepFreeze(checkpoint);
  CHECKPOINTS.add(checkpoint);
  return checkpoint;
}

export function validateBuilderCheckpoint(checkpoint) {
  if (!hasExactKeys(checkpoint, CHECKPOINT_KEYS)) fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  if (checkpoint.schemaVersion !== BUILDER_CHECKPOINT_SCHEMA_VERSION) fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  validateBuilderCheckpointCore(checkpoint);
  validateCodexDeliveryCursor(checkpoint.codexDeliveryCursor, checkpoint.eventLedger);
  validateCodexUatChallenge(checkpoint.codexUatChallenge);
  validateHookDeactivationProtocol(checkpoint.hookDeactivationProtocol);
  return { ok: true };
}

function validateBuilderCheckpointCore(checkpoint) {
  if (!ID_PATTERN.test(checkpoint.workflowId ?? "") || !SUBJECT_PATTERN.test(checkpoint.adapterId ?? "")) {
    fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  }
  if (!STAGES.has(checkpoint.stage) || !BOUNDARIES.has(checkpoint.boundary)) fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  validateArtifactRefs(checkpoint.artifactRefs);
  validatePendingDecision(checkpoint.pendingDecision);
  if (!NEXT_ACTIONS.has(checkpoint.nextAction) || !legalNextAction(checkpoint.stage, checkpoint.nextAction)) {
    fail("AGENTMO_BUILDER_CHECKPOINT_TRANSITION_REJECTED");
  }
  if ((checkpoint.nextAction === "await-approval") !== (checkpoint.pendingDecision !== null)) {
    fail("AGENTMO_BUILDER_CHECKPOINT_TRANSITION_REJECTED");
  }
  if (checkpoint.installReceiptDigest !== null && !DIGEST_PATTERN.test(checkpoint.installReceiptDigest)) {
    fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  }
  validateCapabilitySnapshot(checkpoint.capabilitySnapshot, checkpoint.adapterId);
  validateEventLedger(checkpoint.eventLedger);
  if (!PAUSE_REASONS.has(checkpoint.pauseReason)) fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  assertPersistable(checkpoint, { subject: "builder-checkpoint" });
}

export async function writeBuilderCheckpoint(filePath, checkpoint, options = {}) {
  assertBuilderPlatform();
  assertAuthenticBuilderCheckpoint(checkpoint);
  if (!options || typeof options !== "object" || Array.isArray(options)
    || Object.keys(options).some(
      (key) => !["expectedPreviousAdmission", "expectedPreviousDigest"].includes(key),
    )) {
    fail("AGENTMO_BUILDER_CHECKPOINT_AUTHORITY_REJECTED");
  }
  const serialized = serializePersistableJson(checkpoint, { subject: "builder-checkpoint" });
  const bytes = Buffer.from(serialized, "utf8");
  if (bytes.length > DEFAULT_MAX_BUILDER_CHECKPOINT_BYTES) fail("AGENTMO_BUILDER_CHECKPOINT_SIZE_REJECTED");
  if (Object.hasOwn(options, "expectedPreviousAdmission")
    && Object.hasOwn(options, "expectedPreviousDigest")) {
    fail("AGENTMO_BUILDER_CHECKPOINT_AUTHORITY_REJECTED");
  }
  let predecessorAdmission;
  if (Object.hasOwn(options, "expectedPreviousAdmission")) {
    assertBuilderCheckpointAdmission(options.expectedPreviousAdmission);
    predecessorAdmission = options.expectedPreviousAdmission;
  } else if (Object.hasOwn(options, "expectedPreviousDigest")
    && options.expectedPreviousDigest !== null) {
    predecessorAdmission = await loadBuilderCheckpoint(filePath, {
      expectedDigest: options.expectedPreviousDigest,
    });
  }
  const predecessorJournalAdmission = predecessorAdmission
    ? CHECKPOINT_ADMISSION_DETAILS.get(predecessorAdmission).journalAdmission
    : null;
  validateCheckpointTransition(
    predecessorAdmission?.value ?? null,
    checkpoint,
    predecessorAdmission?.digest ?? null,
    CHECKPOINT_PROTOCOL_INTENTS.get(checkpoint) ?? null,
  );
  let appendResult;
  try {
    appendResult = await appendImmutableJournalEntry({
      journalPath: filePath,
      canonicalBytes: bytes,
      maxValueBytes: DEFAULT_MAX_BUILDER_CHECKPOINT_BYTES,
      ...(predecessorJournalAdmission
        ? { expectedPredecessorAdmission: predecessorJournalAdmission }
        : {}),
    });
  } catch (error) {
    mapJournalError(error);
  }
  if (!appendResult.committed || appendResult.head === null) {
    fail("AGENTMO_BUILDER_CHECKPOINT_CONFLICT_REJECTED");
  }
  return checkpointAdmissionFromJournal(
    appendResult.head,
    filePath,
    checkpoint,
    appendResult,
  );
}

export async function loadBuilderCheckpoint(filePath, options = {}) {
  assertBuilderPlatform();
  const expectedDigest = options.expectedDigest;
  if (!DIGEST_PATTERN.test(expectedDigest ?? "")) fail("AGENTMO_BUILDER_CHECKPOINT_DIGEST_INVALID");
  let loaded;
  try {
    loaded = await loadImmutableJournal({
      journalPath: filePath,
      maxValueBytes: options.maxBytes ?? DEFAULT_MAX_BUILDER_CHECKPOINT_BYTES,
    });
  } catch (error) {
    mapJournalError(error);
  }
  if (loaded.head === null) fail("AGENTMO_BUILDER_CHECKPOINT_READ_FAILED");
  let headAdmission;
  let predecessorAdmission = null;
  for (const journalAdmission of loaded.entries) {
    const admission = checkpointAdmissionFromJournal(
      journalAdmission,
      filePath,
      undefined,
      journalAdmission === loaded.head
        ? {
            status: loaded.recoveryRequired
              ? "committed-recovery-required"
              : "committed-clean",
            recoveryRequired: loaded.recoveryRequired,
          }
        : null,
    );
    validateCheckpointTransition(
      predecessorAdmission?.value ?? null,
      admission.value,
      predecessorAdmission?.digest ?? null,
      "persisted",
    );
    // A resolution must be authenticated while it is the current authority
    // head. Once a later canonical checkpoint successor exists, that writer
    // has already re-admitted this exact head before it could append, so
    // revalidating an old resolution against today's lifecycle head would
    // incorrectly reject legitimate subsequent lifecycle work.
    if (journalAdmission === loaded.head) {
      await assertPersistedCheckpointResolution(
        predecessorAdmission,
        admission,
        filePath,
      );
    }
    predecessorAdmission = admission;
    if (journalAdmission === loaded.head) headAdmission = admission;
  }
  if (headAdmission.digest !== expectedDigest) fail("AGENTMO_BUILDER_CHECKPOINT_DIGEST_MISMATCH");
  return headAdmission;
}

export function checkpointSummaryAdmission(checkpointAdmission) {
  assertBuilderCheckpointAdmission(checkpointAdmission);
  const summary = {
    schemaVersion: "agentmo.builder-checkpoint-summary.v1",
    adapterId: checkpointAdmission.value.adapterId,
    workflowId: checkpointAdmission.value.workflowId,
    checkpointDigest: checkpointAdmission.digest,
    stage: checkpointAdmission.value.stage,
    nextAction: checkpointAdmission.value.nextAction,
  };
  const bytes = Buffer.from(`${JSON.stringify(summary, null, 2)}\n`, "utf8");
  return admitBuilderCheckpointSummary(bytes, digestRawBytes(bytes));
}

export function assertAuthenticBuilderCheckpoint(checkpoint) {
  if (!checkpoint || !CHECKPOINTS.has(checkpoint)) fail("AGENTMO_BUILDER_CHECKPOINT_AUTHORITY_REJECTED");
  validateBuilderCheckpoint(checkpoint);
  return checkpoint;
}

export function assertBuilderCheckpointAdmission(admission) {
  if (
    !admission ||
    !CHECKPOINT_ADMISSIONS.has(admission) ||
    admission.subject !== "builder-checkpoint" ||
    !DIGEST_PATTERN.test(admission.digest ?? "") ||
    (!CHECKPOINTS.has(admission.value) && !LEGACY_CHECKPOINTS.has(admission.value))
  ) {
    fail("AGENTMO_BUILDER_CHECKPOINT_AUTHORITY_REJECTED");
  }
  const details = CHECKPOINT_ADMISSION_DETAILS.get(admission);
  assertImmutableJournalAdmission(details.journalAdmission);
  if (digestRawBytes(details.canonicalBytes) !== admission.digest
    || details.journalAdmission.digest !== admission.digest
    || admission.sequence !== details.journalAdmission.sequence
    || admission.predecessorDigest !== details.journalAdmission.predecessorDigest) {
    fail("AGENTMO_BUILDER_CHECKPOINT_AUTHORITY_REJECTED");
  }
  validateAdmittedBuilderCheckpoint(admission.value);
  return admission;
}

/**
 * Captures an authenticated snapshot of the Builder lifecycle authority for
 * one exact checkpoint authority in one canonical project root.
 *
 * Upgrade reconciliation is cross-authority work: the checkpoint journal can
 * only be released after the lifecycle authority has committed the matching
 * transition (or while it remains exactly at the reservation predecessor).
 * A caller cannot construct this admission from a digest alone, nor use one
 * minted for a different checkpoint whose lifecycle happens to have the same
 * head. Both authorities are re-read immediately before reconciliation, so a
 * stale capability fails closed instead of clearing a reservation against a
 * later lifecycle head.
 */
export async function admitBuilderCheckpointLifecycleAuthority(options) {
  if (!hasKeySet(options, ["checkpointAdmission", "projectRoot", "expectedHeadDigest"])
    || typeof options.projectRoot !== "string"
    || options.projectRoot.length === 0
    || !DIGEST_PATTERN.test(options.expectedHeadDigest ?? "")) {
    fail("AGENTMO_BUILDER_CHECKPOINT_AUTHORITY_REJECTED");
  }
  const checkpointAdmission = options.checkpointAdmission;
  assertBuilderCheckpointAdmission(checkpointAdmission);
  const projectRoot = await admitCanonicalBuilderCheckpointProjectRoot(options.projectRoot);
  const checkpointAuthority = await admitCanonicalBuilderCheckpointAuthority(
    checkpointAdmission,
    projectRoot,
  );
  const authority = await readBuilderCheckpointLifecycleAuthority(projectRoot);
  if (authority.recoveryRequired !== null
    || authority.headDigest !== options.expectedHeadDigest) {
    fail("AGENTMO_BUILDER_CHECKPOINT_PROTOCOL_TRANSITION_REJECTED");
  }
  const admission = Object.freeze({
    subject: "builder-checkpoint-lifecycle-authority",
    headDigest: authority.headDigest,
  });
  LIFECYCLE_AUTHORITY_ADMISSIONS.add(admission);
  LIFECYCLE_AUTHORITY_ADMISSION_DETAILS.set(admission, Object.freeze({
    projectRoot,
    checkpointAuthority,
    headDigest: authority.headDigest,
    headRecordDigest: authority.headRecordDigest,
    headOutcomeDigest: authority.headOutcomeDigest,
    nextSequence: authority.nextSequence,
  }));
  return admission;
}

export function assertBuilderCheckpointLifecycleAuthorityAdmission(admission) {
  if (!admission
    || !LIFECYCLE_AUTHORITY_ADMISSIONS.has(admission)
    || admission.subject !== "builder-checkpoint-lifecycle-authority"
    || !DIGEST_PATTERN.test(admission.headDigest ?? "")) {
    fail("AGENTMO_BUILDER_CHECKPOINT_AUTHORITY_REJECTED");
  }
  const details = LIFECYCLE_AUTHORITY_ADMISSION_DETAILS.get(admission);
  if (!details
    || admission.headDigest !== details.headDigest
    || !details.checkpointAuthority
    || typeof details.projectRoot !== "string"
    || details.projectRoot.length === 0
    || typeof details.checkpointAuthority.path !== "string"
    || details.checkpointAuthority.path.length === 0
    || !DIGEST_PATTERN.test(details.checkpointAuthority.bindingDigest ?? "")
    || !DIGEST_PATTERN.test(details.headRecordDigest ?? "")
    || !DIGEST_PATTERN.test(details.headOutcomeDigest ?? "")
    || !Number.isSafeInteger(details.nextSequence)
    || details.nextSequence < 0) {
    fail("AGENTMO_BUILDER_CHECKPOINT_AUTHORITY_REJECTED");
  }
  return admission;
}

export async function loadBuilderCheckpointHead(filePath) {
  assertBuilderPlatform();
  let journal;
  try {
    journal = await loadImmutableJournal({
      journalPath: filePath,
      maxValueBytes: DEFAULT_MAX_BUILDER_CHECKPOINT_BYTES,
    });
  } catch (error) {
    mapJournalError(error);
  }
  if (journal.head === null) return null;
  return loadBuilderCheckpoint(filePath, { expectedDigest: journal.head.digest });
}

export async function upgradeBuilderCheckpointProtocol(filePath, admission) {
  assertBuilderCheckpointAdmission(admission);
  if (admission.value.schemaVersion === BUILDER_CHECKPOINT_SCHEMA_VERSION) return admission;
  if (![
    LEGACY_V2_BUILDER_CHECKPOINT_SCHEMA_VERSION,
    LEGACY_V3_BUILDER_CHECKPOINT_SCHEMA_VERSION,
  ].includes(admission.value.schemaVersion)) {
    fail("AGENTMO_BUILDER_CHECKPOINT_PROTOCOL_UPGRADE_REJECTED");
  }
  const { schemaVersion: _legacySchemaVersion, ...fields } = admission.value;
  const upgraded = buildBuilderCheckpoint(fields);
  CHECKPOINT_PROTOCOL_INTENTS.set(
    upgraded,
    admission.value.schemaVersion === LEGACY_V2_BUILDER_CHECKPOINT_SCHEMA_VERSION
      ? "upgrade-v2"
      : "upgrade-v3",
  );
  return writeBuilderCheckpoint(filePath, upgraded, {
    expectedPreviousAdmission: admission,
  });
}

export async function prepareBuilderHookCheckpoint(filePath, options) {
  const admission = options?.checkpointAdmission;
  const checkpoint = options?.checkpoint;
  assertBuilderCheckpointAdmission(admission);
  assertAuthenticBuilderCheckpoint(checkpoint);
  if (admission.value.schemaVersion !== BUILDER_CHECKPOINT_SCHEMA_VERSION
    || !["open", "hook-finalized"].includes(
      admission.value.hookDeactivationProtocol.state,
    )
    || !DIGEST_PATTERN.test(options.lifecycleHeadDigest ?? "")
    || !DIGEST_PATTERN.test(options.receiptDigest ?? "")) {
    fail("AGENTMO_BUILDER_CHECKPOINT_PROTOCOL_TRANSITION_REJECTED");
  }
  const delivery = normalizeHookDeliveryProtocol(options.delivery);
  validateHookDeliveryProtocol(delivery);
  const operationId = hookOperationId({
    predecessorCheckpointDigest: admission.digest,
    lifecycleHeadDigest: options.lifecycleHeadDigest,
    receiptDigest: options.receiptDigest,
    delivery,
  });
  const prepared = buildBuilderCheckpoint({
    ...checkpoint,
    hookDeactivationProtocol: {
      state: "hook-prepared",
      operationId,
      predecessorCheckpointDigest: admission.digest,
      lifecycleHeadDigest: options.lifecycleHeadDigest,
      receiptDigest: options.receiptDigest,
      delivery,
      observationDigest: null,
    },
  });
  CHECKPOINT_PROTOCOL_INTENTS.set(prepared, "hook-prepare");
  return writeBuilderCheckpoint(filePath, prepared, {
    expectedPreviousAdmission: admission,
  });
}

export async function finalizeBuilderHookCheckpoint(
  filePath,
  preparedAdmission,
  observationDigest,
) {
  assertBuilderCheckpointAdmission(preparedAdmission);
  const protocol = preparedAdmission.value.hookDeactivationProtocol;
  if (preparedAdmission.value.schemaVersion !== BUILDER_CHECKPOINT_SCHEMA_VERSION
    || protocol.state !== "hook-prepared"
    || (protocol.delivery.observationRequired
      ? !DIGEST_PATTERN.test(observationDigest ?? "")
      : observationDigest !== null)) {
    fail("AGENTMO_BUILDER_CHECKPOINT_PROTOCOL_TRANSITION_REJECTED");
  }
  const finalized = buildBuilderCheckpoint({
    ...preparedAdmission.value,
    hookDeactivationProtocol: {
      ...protocol,
      state: "hook-finalized",
      observationDigest,
    },
  });
  CHECKPOINT_PROTOCOL_INTENTS.set(finalized, "hook-finalize");
  return writeBuilderCheckpoint(filePath, finalized, {
    expectedPreviousAdmission: preparedAdmission,
  });
}

export async function fenceBuilderCheckpointDeactivation(filePath, options) {
  const admission = options?.checkpointAdmission;
  assertBuilderCheckpointAdmission(admission);
  if (admission.value.schemaVersion !== BUILDER_CHECKPOINT_SCHEMA_VERSION
    || !DIGEST_PATTERN.test(options.lifecycleHeadDigest ?? "")
    || !DIGEST_PATTERN.test(options.receiptDigest ?? "")) {
    fail("AGENTMO_BUILDER_CHECKPOINT_PROTOCOL_TRANSITION_REJECTED");
  }
  const current = admission.value.hookDeactivationProtocol;
  if (current.state === "hook-prepared") {
    fail("AGENTMO_BUILDER_CHECKPOINT_HOOK_PREPARED");
  }
  if (current.state === "upgrade-reserved") {
    fail("AGENTMO_BUILDER_CHECKPOINT_UPGRADE_RESERVED");
  }
  if (current.state === "deactivation-fenced") {
    if (current.lifecycleHeadDigest !== options.lifecycleHeadDigest
      || current.receiptDigest !== options.receiptDigest
      || current.operationId !== deactivationFenceOperationId(current)) {
      fail("AGENTMO_BUILDER_CHECKPOINT_DEACTIVATION_FENCED");
    }
    return admission;
  }
  const operationId = deactivationFenceOperationId({
    predecessorCheckpointDigest: admission.digest,
    lifecycleHeadDigest: options.lifecycleHeadDigest,
    receiptDigest: options.receiptDigest,
  });
  const fenced = buildBuilderCheckpoint({
    ...admission.value,
    hookDeactivationProtocol: {
      state: "deactivation-fenced",
      operationId,
      predecessorCheckpointDigest: admission.digest,
      lifecycleHeadDigest: options.lifecycleHeadDigest,
      receiptDigest: options.receiptDigest,
      delivery: null,
      observationDigest: null,
    },
  });
  CHECKPOINT_PROTOCOL_INTENTS.set(fenced, "deactivation-fence");
  return writeBuilderCheckpoint(filePath, fenced, {
    expectedPreviousAdmission: admission,
  });
}

export async function releaseBuilderCheckpointDeactivationFence(filePath, options) {
  if (!hasKeySet(options, [
    "checkpointAdmission",
    "lifecycleAuthorityAdmission",
    "receiptDigest",
  ])) {
    fail("AGENTMO_BUILDER_CHECKPOINT_PROTOCOL_TRANSITION_REJECTED");
  }
  const admission = options?.checkpointAdmission;
  assertBuilderCheckpointAdmission(admission);
  const protocol = admission.value.hookDeactivationProtocol;
  if (admission.value.schemaVersion !== BUILDER_CHECKPOINT_SCHEMA_VERSION
    || protocol.state !== "deactivation-fenced"
    || protocol.receiptDigest !== options.receiptDigest) {
    fail("AGENTMO_BUILDER_CHECKPOINT_PROTOCOL_TRANSITION_REJECTED");
  }
  const lifecycleAuthority = await assertCurrentBuilderCheckpointLifecycleAuthority(
    options.lifecycleAuthorityAdmission,
    admission,
    filePath,
  );
  if (!matchesCommittedBuilderCheckpointReactivation(lifecycleAuthority, protocol)) {
    fail("AGENTMO_BUILDER_CHECKPOINT_PROTOCOL_TRANSITION_REJECTED");
  }
  const released = buildBuilderCheckpoint({
    ...admission.value,
    hookDeactivationProtocol: undefined,
  });
  CHECKPOINT_PROTOCOL_INTENTS.set(released, "deactivation-release");
  return writeBuilderCheckpoint(filePath, released, {
    expectedPreviousAdmission: admission,
  });
}

export async function reserveBuilderCheckpointUpgrade(filePath, options) {
  const admission = options?.checkpointAdmission;
  assertBuilderCheckpointAdmission(admission);
  if (admission.value.schemaVersion !== BUILDER_CHECKPOINT_SCHEMA_VERSION
    || !DIGEST_PATTERN.test(options.lifecycleHeadDigest ?? "")
    || !DIGEST_PATTERN.test(options.receiptDigest ?? "")
    || !DIGEST_PATTERN.test(options.planDigest ?? "")
    || !DIGEST_PATTERN.test(options.successorReceiptDigest ?? "")
    || admission.value.installReceiptDigest !== options.receiptDigest
    || options.receiptDigest === options.successorReceiptDigest) {
    fail("AGENTMO_BUILDER_CHECKPOINT_PROTOCOL_TRANSITION_REJECTED");
  }
  const current = admission.value.hookDeactivationProtocol;
  const requested = {
    planDigest: options.planDigest,
    successorReceiptDigest: options.successorReceiptDigest,
  };
  if (current.state === "hook-prepared") {
    fail("AGENTMO_BUILDER_CHECKPOINT_HOOK_PREPARED");
  }
  if (current.state === "upgrade-reserved") {
    if (current.lifecycleHeadDigest === options.lifecycleHeadDigest
      && current.receiptDigest === options.receiptDigest
      && sameUpgradeReservation(current.upgradeReservation, requested)
      && current.operationId === upgradeReservationOperationId({
        predecessorCheckpointDigest: current.predecessorCheckpointDigest,
        lifecycleHeadDigest: current.lifecycleHeadDigest,
        receiptDigest: current.receiptDigest,
        upgradeReservation: current.upgradeReservation,
      })) {
      return admission;
    }
    fail("AGENTMO_BUILDER_CHECKPOINT_UPGRADE_RESERVED");
  }
  if (current.state === "deactivation-fenced") {
    fail("AGENTMO_BUILDER_CHECKPOINT_DEACTIVATION_FENCED");
  }
  if (![
    "open",
    "hook-finalized",
  ].includes(current.state)) {
    fail("AGENTMO_BUILDER_CHECKPOINT_PROTOCOL_TRANSITION_REJECTED");
  }
  const reservation = {
    state: "upgrade-reserved",
    operationId: upgradeReservationOperationId({
      predecessorCheckpointDigest: admission.digest,
      lifecycleHeadDigest: options.lifecycleHeadDigest,
      receiptDigest: options.receiptDigest,
      upgradeReservation: requested,
    }),
    predecessorCheckpointDigest: admission.digest,
    lifecycleHeadDigest: options.lifecycleHeadDigest,
    receiptDigest: options.receiptDigest,
    delivery: null,
    observationDigest: null,
    upgradeReservation: requested,
  };
  const reserved = buildBuilderCheckpoint({
    ...admission.value,
    hookDeactivationProtocol: reservation,
  });
  CHECKPOINT_PROTOCOL_INTENTS.set(reserved, "upgrade-reserve");
  return writeBuilderCheckpoint(filePath, reserved, {
    expectedPreviousAdmission: admission,
  });
}

export async function completeBuilderCheckpointUpgrade(filePath, options) {
  if (!hasKeySet(options, [
    "checkpointAdmission",
    "lifecycleAuthorityAdmission",
    "planDigest",
    "successorReceiptDigest",
  ])) {
    fail("AGENTMO_BUILDER_CHECKPOINT_PROTOCOL_TRANSITION_REJECTED");
  }
  const admission = options?.checkpointAdmission;
  assertBuilderCheckpointAdmission(admission);
  const protocol = admission.value.hookDeactivationProtocol;
  if (admission.value.schemaVersion !== BUILDER_CHECKPOINT_SCHEMA_VERSION
    || protocol.state !== "upgrade-reserved"
    || !DIGEST_PATTERN.test(options.planDigest ?? "")
    || !DIGEST_PATTERN.test(options.successorReceiptDigest ?? "")
    || !matchesUpgradeReservation(protocol, {
      planDigest: options.planDigest,
      successorReceiptDigest: options.successorReceiptDigest,
    })) {
    fail("AGENTMO_BUILDER_CHECKPOINT_PROTOCOL_TRANSITION_REJECTED");
  }
  const lifecycleAuthority = await assertCurrentBuilderCheckpointLifecycleAuthority(
    options.lifecycleAuthorityAdmission,
    admission,
    filePath,
  );
  if (!matchesCommittedBuilderCheckpointUpgrade(lifecycleAuthority, protocol)) {
    fail("AGENTMO_BUILDER_CHECKPOINT_PROTOCOL_TRANSITION_REJECTED");
  }
  const completed = buildBuilderCheckpoint({
    ...admission.value,
    installReceiptDigest: options.successorReceiptDigest,
    hookDeactivationProtocol: undefined,
  });
  CHECKPOINT_PROTOCOL_INTENTS.set(completed, "upgrade-complete");
  return writeBuilderCheckpoint(filePath, completed, {
    expectedPreviousAdmission: admission,
  });
}

export async function abortBuilderCheckpointUpgrade(filePath, options) {
  if (!hasKeySet(options, [
    "checkpointAdmission",
    "lifecycleAuthorityAdmission",
    "planDigest",
    "successorReceiptDigest",
  ])) {
    fail("AGENTMO_BUILDER_CHECKPOINT_PROTOCOL_TRANSITION_REJECTED");
  }
  const admission = options?.checkpointAdmission;
  assertBuilderCheckpointAdmission(admission);
  const protocol = admission.value.hookDeactivationProtocol;
  if (admission.value.schemaVersion !== BUILDER_CHECKPOINT_SCHEMA_VERSION
    || protocol.state !== "upgrade-reserved"
    || !DIGEST_PATTERN.test(options.planDigest ?? "")
    || !DIGEST_PATTERN.test(options.successorReceiptDigest ?? "")
    || admission.value.installReceiptDigest !== protocol.receiptDigest
    || !matchesUpgradeReservation(protocol, {
      planDigest: options.planDigest,
      successorReceiptDigest: options.successorReceiptDigest,
    })) {
    fail("AGENTMO_BUILDER_CHECKPOINT_PROTOCOL_TRANSITION_REJECTED");
  }
  const lifecycleAuthority = await assertCurrentBuilderCheckpointLifecycleAuthority(
    options.lifecycleAuthorityAdmission,
    admission,
    filePath,
  );
  if (!matchesCommittedBuilderCheckpointUpgradeAbort(lifecycleAuthority, protocol)) {
    fail("AGENTMO_BUILDER_CHECKPOINT_PROTOCOL_TRANSITION_REJECTED");
  }
  const aborted = buildBuilderCheckpoint({
    ...admission.value,
    hookDeactivationProtocol: undefined,
  });
  CHECKPOINT_PROTOCOL_INTENTS.set(aborted, "upgrade-abort");
  return writeBuilderCheckpoint(filePath, aborted, {
    expectedPreviousAdmission: admission,
  });
}

async function assertCurrentBuilderCheckpointLifecycleAuthority(
  admission,
  checkpointAdmission,
  checkpointPath,
) {
  assertBuilderCheckpointLifecycleAuthorityAdmission(admission);
  assertBuilderCheckpointAdmission(checkpointAdmission);
  const details = LIFECYCLE_AUTHORITY_ADMISSION_DETAILS.get(admission);
  if (!(await sameBoundBuilderCheckpointAuthority(
    checkpointAdmission,
    checkpointPath,
    details.checkpointAuthority,
  ))) {
    fail("AGENTMO_BUILDER_CHECKPOINT_AUTHORITY_REJECTED");
  }
  const currentCheckpoint = await loadBuilderCheckpoint(details.checkpointAuthority.path, {
    expectedDigest: checkpointAdmission.digest,
  });
  if (checkpointAuthorityBindingDigest(currentCheckpoint, details.checkpointAuthority.path)
    !== details.checkpointAuthority.bindingDigest) {
    fail("AGENTMO_BUILDER_CHECKPOINT_PROTOCOL_TRANSITION_REJECTED");
  }
  const authority = await readBuilderCheckpointLifecycleAuthority(details.projectRoot);
  if (authority.recoveryRequired !== null
    || authority.headDigest !== details.headDigest
    || authority.headRecordDigest !== details.headRecordDigest
    || authority.headOutcomeDigest !== details.headOutcomeDigest
    || authority.nextSequence !== details.nextSequence) {
    fail("AGENTMO_BUILDER_CHECKPOINT_PROTOCOL_TRANSITION_REJECTED");
  }
  return authority;
}

async function admitCanonicalBuilderCheckpointProjectRoot(value) {
  try {
    if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
      throw new Error("project root");
    }
    const projectRoot = await realpath(path.resolve(value));
    const stats = await lstat(projectRoot);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error("project root");
    return projectRoot;
  } catch {
    fail("AGENTMO_BUILDER_CHECKPOINT_AUTHORITY_REJECTED");
  }
}

async function admitCanonicalBuilderCheckpointAuthority(checkpointAdmission, projectRoot) {
  const checkpointPath = await admitCanonicalBuilderCheckpointPath(
    checkpointAdmission.filePath,
    projectRoot,
  );
  const bindingDigest = checkpointAuthorityBindingDigest(checkpointAdmission, checkpointPath);
  const current = await loadBuilderCheckpoint(checkpointPath, {
    expectedDigest: checkpointAdmission.digest,
  });
  if (checkpointAuthorityBindingDigest(current, checkpointPath) !== bindingDigest) {
    fail("AGENTMO_BUILDER_CHECKPOINT_PROTOCOL_TRANSITION_REJECTED");
  }
  return Object.freeze({ path: checkpointPath, bindingDigest });
}

async function admitCanonicalBuilderCheckpointPath(filePath, projectRoot) {
  try {
    if (typeof filePath !== "string" || filePath.length === 0 || filePath.includes("\0")) {
      throw new Error("checkpoint path");
    }
    const resolved = path.resolve(filePath);
    const checkpointPath = await realpath(resolved);
    const stats = await lstat(checkpointPath);
    if (!isPathWithin(projectRoot, checkpointPath)
      || !stats.isFile()
      || stats.isSymbolicLink()) {
      throw new Error("checkpoint path");
    }
    return checkpointPath;
  } catch {
    fail("AGENTMO_BUILDER_CHECKPOINT_AUTHORITY_REJECTED");
  }
}

async function sameBoundBuilderCheckpointAuthority(admission, filePath, bound) {
  if (!bound
    || typeof bound.path !== "string"
    || !DIGEST_PATTERN.test(bound.bindingDigest ?? "")
    || typeof filePath !== "string"
    || typeof admission.filePath !== "string") {
    return false;
  }
  let suppliedPath;
  let admittedPath;
  try {
    suppliedPath = await realpath(path.resolve(filePath));
    admittedPath = await realpath(path.resolve(admission.filePath));
  } catch {
    return false;
  }
  return suppliedPath === bound.path
    && admittedPath === bound.path
    && checkpointAuthorityBindingDigest(admission, bound.path) === bound.bindingDigest;
}

function checkpointAuthorityBindingDigest(admission, checkpointPath) {
  assertBuilderCheckpointAdmission(admission);
  if (typeof checkpointPath !== "string"
    || checkpointPath.length === 0
    || !Number.isSafeInteger(admission.sequence)
    || admission.sequence < 0
    || (admission.predecessorDigest !== null && !DIGEST_PATTERN.test(admission.predecessorDigest ?? ""))
    || !DIGEST_PATTERN.test(admission.publicationDigest ?? "")) {
    fail("AGENTMO_BUILDER_CHECKPOINT_AUTHORITY_REJECTED");
  }
  return protocolDigest({
    schemaVersion: "agentmo.builder-checkpoint-lifecycle-target.v1",
    checkpointDigest: admission.digest,
    sequence: admission.sequence,
    predecessorDigest: admission.predecessorDigest,
    publicationDigest: admission.publicationDigest,
    entryIdentity: admission.entryIdentity,
  }, "builder-checkpoint-lifecycle-target");
}

function isPathWithin(projectRoot, candidate) {
  const relative = path.relative(projectRoot, candidate);
  return relative.length > 0
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

async function readBuilderCheckpointLifecycleAuthority(projectRoot) {
  try {
    return await readAppendOnlyAuthority({
      projectRoot,
      relativeRoot: BUILDER_LIFECYCLE_AUTHORITY_PATH,
      namespace: BUILDER_LIFECYCLE_NAMESPACE,
    });
  } catch {
    fail("AGENTMO_BUILDER_CHECKPOINT_AUTHORITY_REJECTED");
  }
}

function matchesCommittedBuilderCheckpointUpgrade(authority, protocol) {
  const record = authority.records.at(-1);
  const event = record?.payload;
  return authority.recoveryRequired === null
    && record !== undefined
    && authority.nextSequence === record.sequence + 1
    && authority.headRecordDigest === record.digest
    && authority.headDigest !== protocol.lifecycleHeadDigest
    && record.idempotencyKey === `upgrade:${protocol.operationId.slice("sha256:".length)}`
    && event?.schemaVersion === BUILDER_LIFECYCLE_EVENT_SCHEMA_VERSION
    && event.action === "activate"
    && event.status === "active"
    && event.invokedAs === "upgrade"
    && event.predecessorReceiptDigest === protocol.receiptDigest
    && event.receipt?.digest === protocol.upgradeReservation.successorReceiptDigest
    && hasKeySet(event.coordination, ["kind", "operationId"])
    && event.coordination.kind === CHECKPOINT_UPGRADE_COORDINATION_KIND
    && event.coordination.operationId === protocol.operationId;
}

function matchesCommittedBuilderCheckpointReactivation(authority, protocol) {
  const record = authority.records.at(-1);
  const priorRecord = authority.records.at(-2);
  const event = record?.payload;
  const tombstone = priorRecord?.payload;
  return authority.recoveryRequired === null
    && record !== undefined
    && priorRecord !== undefined
    && authority.nextSequence === record.sequence + 1
    && authority.headRecordDigest === record.digest
    && authority.headDigest !== protocol.lifecycleHeadDigest
    && /^reactivate:[a-f0-9]{64}$/u.test(record.idempotencyKey ?? "")
    && event?.schemaVersion === BUILDER_LIFECYCLE_EVENT_SCHEMA_VERSION
    && event.action === "activate"
    && event.status === "active"
    && event.invokedAs === "reactivate"
    && event.scopeDigest === tombstone?.scopeDigest
    && DIGEST_PATTERN.test(event.scopeDigest ?? "")
    && event.predecessorReceiptDigest === protocol.receiptDigest
    && event.receipt?.digest === protocol.receiptDigest
    && event.coordination === null
    && /^deactivate:[a-f0-9]{64}$/u.test(priorRecord.idempotencyKey ?? "")
    && tombstone?.schemaVersion === BUILDER_LIFECYCLE_EVENT_SCHEMA_VERSION
    && tombstone.action === "deactivate"
    && tombstone.status === "deactivated"
    && tombstone.invokedAs === "deactivate"
    && tombstone.predecessorReceiptDigest === protocol.receiptDigest
    && tombstone.receipt?.digest === protocol.receiptDigest
    && tombstone.coordination === null;
}

function matchesCommittedBuilderCheckpointUpgradeAbort(authority, protocol) {
  const record = authority.records.at(-1);
  const event = record?.payload;
  return authority.recoveryRequired === null
    && record !== undefined
    && authority.nextSequence === record.sequence + 1
    && authority.headRecordDigest === record.digest
    && authority.headDigest !== protocol.lifecycleHeadDigest
    && record.idempotencyKey
      === `upgrade-abort:${protocol.operationId.slice("sha256:".length)}`
    && event?.schemaVersion === BUILDER_LIFECYCLE_EVENT_SCHEMA_VERSION
    && event.action === "activate"
    && event.status === "active"
    && event.invokedAs === "upgrade-abort"
    && event.predecessorReceiptDigest === protocol.receiptDigest
    && event.receipt?.digest === protocol.receiptDigest
    && hasKeySet(event.coordination, ["kind", "operationId"])
    && event.coordination.kind === "checkpoint-upgrade-abort"
    && event.coordination.operationId === protocol.operationId;
}

async function assertPersistedCheckpointResolution(predecessor, successor, filePath) {
  if (predecessor === null
    || predecessor.value.schemaVersion !== BUILDER_CHECKPOINT_SCHEMA_VERSION
    || successor.value.schemaVersion !== BUILDER_CHECKPOINT_SCHEMA_VERSION) {
    return;
  }
  const before = predecessor.value.hookDeactivationProtocol;
  const after = successor.value.hookDeactivationProtocol;
  const resolvesFence = before.state === "deactivation-fenced" && after.state === "open";
  const resolvesReservation = before.state === "upgrade-reserved" && after.state === "open";
  if (!resolvesFence && !resolvesReservation) return;
  const projectRoot = await resolvePersistedCheckpointProjectRoot(filePath);
  const authority = await readBuilderCheckpointLifecycleAuthority(projectRoot);
  const valid = resolvesFence
    ? matchesCommittedBuilderCheckpointReactivation(authority, before)
    : successor.value.installReceiptDigest === before.receiptDigest
      ? matchesCommittedBuilderCheckpointUpgradeAbort(authority, before)
      : matchesCommittedBuilderCheckpointUpgrade(authority, before);
  if (!valid) fail("AGENTMO_BUILDER_CHECKPOINT_PROTOCOL_TRANSITION_REJECTED");
}

async function resolvePersistedCheckpointProjectRoot(filePath) {
  try {
    const checkpointPath = await realpath(path.resolve(filePath));
    const checkpointsDirectory = path.dirname(checkpointPath);
    const agentmoDirectory = path.dirname(checkpointsDirectory);
    const projectRoot = path.dirname(agentmoDirectory);
    if (path.basename(checkpointPath) !== "builder.json"
      || path.basename(checkpointsDirectory) !== "checkpoints"
      || path.basename(agentmoDirectory) !== ".agentmo") {
      throw new Error("checkpoint path");
    }
    return await admitCanonicalBuilderCheckpointProjectRoot(projectRoot);
  } catch {
    fail("AGENTMO_BUILDER_CHECKPOINT_PROTOCOL_TRANSITION_REJECTED");
  }
}

function checkpointAdmissionFromJournal(journalAdmission, filePath, suppliedValue, appendResult = null) {
  try {
    assertImmutableJournalAdmission(journalAdmission);
  } catch (error) {
    mapJournalError(error);
  }
  const bytes = readImmutableJournalAdmissionBytes(journalAdmission);
  if (digestRawBytes(bytes) !== journalAdmission.digest) {
    fail("AGENTMO_BUILDER_CHECKPOINT_AUTHORITY_REJECTED");
  }
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    rejectMalformedJournalCheckpoint(journalAdmission);
  }
  const isLegacyV1 = parsed?.schemaVersion === LEGACY_V1_BUILDER_CHECKPOINT_SCHEMA_VERSION;
  const isLegacyV2 = parsed?.schemaVersion === LEGACY_V2_BUILDER_CHECKPOINT_SCHEMA_VERSION;
  const isLegacyV3 = parsed?.schemaVersion === LEGACY_V3_BUILDER_CHECKPOINT_SCHEMA_VERSION;
  try {
    if (isLegacyV1) {
      if (journalAdmission.sequence !== 0 || journalAdmission.predecessorDigest !== null) {
        fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
      }
      validateLegacyV1BuilderCheckpoint(parsed);
    } else if (isLegacyV2) {
      validateLegacyV2BuilderCheckpoint(parsed);
    } else if (isLegacyV3) {
      validateLegacyV3BuilderCheckpoint(parsed);
    } else {
      validateBuilderCheckpoint(parsed);
    }
  } catch (error) {
    if (error instanceof BuilderCheckpointError) rejectMalformedJournalCheckpoint(journalAdmission);
    throw error;
  }
  let canonical;
  try {
    canonical = Buffer.from(serializePersistableJson(parsed, {
      subject: "builder-checkpoint",
      maxBytes: DEFAULT_MAX_BUILDER_CHECKPOINT_BYTES,
    }), "utf8");
  } catch {
    rejectMalformedJournalCheckpoint(journalAdmission);
  }
  if (!bytes.equals(canonical)) rejectMalformedJournalCheckpoint(journalAdmission);

  let value;
  if (isLegacyV1) {
    const { schemaVersion: _legacySchemaVersion, ...legacyFields } = parsed;
    value = buildBuilderCheckpoint(legacyFields);
  } else if (isLegacyV2 || isLegacyV3) {
    deepFreeze(parsed);
    LEGACY_CHECKPOINTS.add(parsed);
    value = parsed;
  } else if (suppliedValue !== undefined) {
    assertAuthenticBuilderCheckpoint(suppliedValue);
    const suppliedBytes = Buffer.from(serializePersistableJson(suppliedValue, {
      subject: "builder-checkpoint",
      maxBytes: DEFAULT_MAX_BUILDER_CHECKPOINT_BYTES,
    }), "utf8");
    if (!suppliedBytes.equals(bytes)) fail("AGENTMO_BUILDER_CHECKPOINT_AUTHORITY_REJECTED");
    value = suppliedValue;
  } else {
    deepFreeze(parsed);
    CHECKPOINTS.add(parsed);
    value = parsed;
  }

  const admission = Object.freeze({
    subject: "builder-checkpoint",
    digest: journalAdmission.digest,
    value,
    sequence: journalAdmission.sequence,
    predecessorDigest: journalAdmission.predecessorDigest,
    publicationDigest: journalAdmission.publicationDigest,
    entryIdentity: journalAdmission.entryIdentity,
    filePath,
    appendStatus: appendResult?.status ?? "committed-clean",
    recoveryRequired: appendResult?.recoveryRequired ?? false,
  });
  CHECKPOINT_ADMISSIONS.add(admission);
  CHECKPOINT_ADMISSION_DETAILS.set(admission, Object.freeze({
    journalAdmission,
    canonicalBytes: Buffer.from(bytes),
  }));
  return admission;
}

function rejectMalformedJournalCheckpoint(journalAdmission) {
  fail(journalAdmission.sequence === 0
    ? "AGENTMO_BUILDER_CHECKPOINT_INVALID"
    : "AGENTMO_BUILDER_CHECKPOINT_CONFLICT_REJECTED");
}

function mapJournalError(error) {
  if (error instanceof ImmutableJournalError) {
    if (error.code === "AGENTMO_IMMUTABLE_JOURNAL_AUTHORITY_REJECTED") {
      fail("AGENTMO_BUILDER_CHECKPOINT_AUTHORITY_REJECTED");
    }
    fail("AGENTMO_BUILDER_CHECKPOINT_CONFLICT_REJECTED");
  }
  throw error;
}

function normalizeArtifactRefs(value) {
  if (!Array.isArray(value)) fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  return value.map((item) => ({
    subject: item?.subject,
    path: item?.path,
    digest: item?.digest,
  })).sort((left, right) => `${left.subject}:${left.path}`.localeCompare(`${right.subject}:${right.path}`));
}

function normalizePendingDecision(value) {
  if (value === null || value === undefined) return null;
  return {
    id: value.id,
    kind: value.kind,
    summaryDigest: value.summaryDigest,
  };
}

function normalizeCapabilitySnapshot(value) {
  if (!value || typeof value !== "object") fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  const required = Array.isArray(value.required)
    ? value.required
        .map((item) => ({ id: item?.id, status: item?.status }))
        .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    : value.required;
  return {
    adapterId: value.adapterId,
    evidenceLevel: value.evidenceLevel,
    digest: value.digest,
    required,
  };
}

function normalizeCodexDeliveryCursor(value) {
  if (value === undefined || value === null) {
    return {
      sessionDigest: null,
      sessionStart: null,
      compactionEpoch: 0,
      compactState: "idle",
      preCompact: null,
      postCompact: null,
    };
  }
  return {
    sessionDigest: value.sessionDigest,
    sessionStart: normalizeDeliveryRecord(value.sessionStart),
    compactionEpoch: value.compactionEpoch,
    compactState: value.compactState,
    preCompact: normalizeDeliveryRecord(value.preCompact),
    postCompact: normalizeDeliveryRecord(value.postCompact),
  };
}

function normalizeDeliveryRecord(value) {
  if (value === null || value === undefined) return null;
  return {
    identity: value.identity,
    sequence: value.sequence,
    eventDigest: value.eventDigest,
  };
}

function normalizeCodexUatChallenge(value) {
  if (value === null || value === undefined) return null;
  return {
    attemptId: value.attemptId,
    scenario: value.scenario,
    correlation: value.correlation,
  };
}

function normalizeHookDeactivationProtocol(value) {
  if (value === undefined || value === null) {
    return {
      state: "open",
      operationId: null,
      predecessorCheckpointDigest: null,
      lifecycleHeadDigest: null,
      receiptDigest: null,
      delivery: null,
      observationDigest: null,
      upgradeReservation: null,
    };
  }
  return {
    state: value.state,
    operationId: value.operationId,
    predecessorCheckpointDigest: value.predecessorCheckpointDigest,
    lifecycleHeadDigest: value.lifecycleHeadDigest,
    receiptDigest: value.receiptDigest,
    delivery: value.delivery === null ? null : {
      identity: value.delivery?.identity,
      type: value.delivery?.type,
      epoch: value.delivery?.epoch,
      sequence: value.delivery?.sequence,
      eventDigest: value.delivery?.eventDigest,
      applied: value.delivery?.applied,
      status: value.delivery?.status,
      observationRequired: value.delivery?.observationRequired,
    },
    observationDigest: value.observationDigest,
    upgradeReservation: value.upgradeReservation === null || value.upgradeReservation === undefined
      ? null
      : {
          planDigest: value.upgradeReservation?.planDigest,
          successorReceiptDigest: value.upgradeReservation?.successorReceiptDigest,
        },
  };
}

function assertCheckpointInputShape(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  const allowed = new Set(CHECKPOINT_KEYS);
  const actual = Object.keys(input);
  if (actual.some((key) => !allowed.has(key))) fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  const required = LEGACY_V1_CHECKPOINT_KEYS.filter((key) => key !== "schemaVersion");
  if (required.some((key) => !Object.hasOwn(input, key))) fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  if (Object.hasOwn(input, "schemaVersion") && input.schemaVersion !== BUILDER_CHECKPOINT_SCHEMA_VERSION) {
    fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  }
  if (!hasKeySet(input.capabilitySnapshot, ["adapterId", "evidenceLevel", "digest", "required"])) {
    fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  }
  if (!hasKeySet(input.eventLedger, ["cursor", "recentEvents"])) fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  if (Array.isArray(input.eventLedger.recentEvents)
    && input.eventLedger.recentEvents.some((item) => !hasKeySet(item, ["eventId", "sequence", "digest"]))) {
    fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  }
  if (input.pendingDecision !== null && !hasKeySet(input.pendingDecision, ["id", "kind", "summaryDigest"])) {
    fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  }
  if (Array.isArray(input.artifactRefs)
    && input.artifactRefs.some((item) => !hasKeySet(item, ["subject", "path", "digest"]))) {
    fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  }
  if (Array.isArray(input.capabilitySnapshot.required)
    && input.capabilitySnapshot.required.some((item) => !hasKeySet(item, ["id", "status"]))) {
    fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  }
  if (input.codexDeliveryCursor !== undefined) {
    assertCodexDeliveryCursorInputShape(input.codexDeliveryCursor);
  }
  if (input.codexUatChallenge !== undefined && input.codexUatChallenge !== null) {
    if (!hasKeySet(input.codexUatChallenge, ["attemptId", "scenario", "correlation"])) {
      fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
    }
  }
  if (input.hookDeactivationProtocol !== undefined) {
    if (!hasKeySet(input.hookDeactivationProtocol, HOOK_PROTOCOL_KEYS)
      && !hasKeySet(input.hookDeactivationProtocol, LEGACY_V3_HOOK_PROTOCOL_KEYS)) {
      fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
    }
    if (input.hookDeactivationProtocol.delivery !== null
      && !hasKeySet(input.hookDeactivationProtocol.delivery, [
        "identity",
        "type",
        "epoch",
        "sequence",
        "eventDigest",
        "applied",
        "status",
        "observationRequired",
      ])) {
      fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
    }
    if (input.hookDeactivationProtocol.upgradeReservation !== undefined
      && input.hookDeactivationProtocol.upgradeReservation !== null
      && !hasKeySet(input.hookDeactivationProtocol.upgradeReservation, [
        "planDigest",
        "successorReceiptDigest",
      ])) {
      fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
    }
  }
}

function assertCodexDeliveryCursorInputShape(value) {
  if (!hasKeySet(value, [
    "sessionDigest",
    "sessionStart",
    "compactionEpoch",
    "compactState",
    "preCompact",
    "postCompact",
  ])) {
    fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  }
  for (const record of [value.sessionStart, value.preCompact, value.postCompact]) {
    if (record !== null && !hasKeySet(record, ["identity", "sequence", "eventDigest"])) {
      fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
    }
  }
}

function normalizeEventLedger(value) {
  return {
    cursor: value?.cursor,
    recentEvents: Array.isArray(value?.recentEvents)
      ? value.recentEvents.map((item) => ({
          eventId: item?.eventId,
          sequence: item?.sequence,
          digest: item?.digest,
        }))
      : value?.recentEvents,
  };
}

function validateArtifactRefs(refs) {
  if (!Array.isArray(refs) || refs.length > 128) fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  const identities = new Set();
  let previous = null;
  for (const ref of refs) {
    if (!hasExactKeys(ref, ["subject", "path", "digest"])) fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
    if (!SUBJECT_PATTERN.test(ref.subject ?? "") || !portableRelativePath(ref.path) || !DIGEST_PATTERN.test(ref.digest ?? "")) {
      fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
    }
    const identity = `${ref.subject}:${ref.path}`;
    if (identities.has(identity) || (previous !== null && previous.localeCompare(identity) > 0)) {
      fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
    }
    identities.add(identity);
    previous = identity;
  }
}

function validatePendingDecision(value) {
  if (value === null) return;
  if (!hasExactKeys(value, ["id", "kind", "summaryDigest"])) fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  if (!ID_PATTERN.test(value.id ?? "") || !["approval", "decision"].includes(value.kind)) {
    fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  }
  if (!DIGEST_PATTERN.test(value.summaryDigest ?? "")) fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
}

function validateCapabilitySnapshot(value, adapterId) {
  if (!hasExactKeys(value, ["adapterId", "evidenceLevel", "digest", "required"])) {
    fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  }
  if (
    value.adapterId !== adapterId ||
    !["observed", "verified-behavior"].includes(value.evidenceLevel) ||
    !DIGEST_PATTERN.test(value.digest ?? "") ||
    !Array.isArray(value.required) ||
    value.required.length === 0 ||
    value.required.length > 64
  ) {
    fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  }
  let previous = null;
  for (const item of value.required) {
    if (!hasExactKeys(item, ["id", "status"]) || !SUBJECT_PATTERN.test(item.id ?? "")) {
      fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
    }
    if (!["observed", "missing", "incompatible"].includes(item.status) || (previous !== null && previous >= item.id)) {
      fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
    }
    previous = item.id;
  }
}

function validateEventLedger(value) {
  if (!hasExactKeys(value, ["cursor", "recentEvents"])) fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  if (!Number.isSafeInteger(value.cursor) || value.cursor < 0 || !Array.isArray(value.recentEvents)) {
    fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  }
  if (value.recentEvents.length > 64) {
    fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  }
  const ids = new Set();
  let previousSequence = null;
  for (const item of value.recentEvents) {
    if (!hasExactKeys(item, ["eventId", "sequence", "digest"])
      || !ID_PATTERN.test(item.eventId ?? "")
      || !Number.isSafeInteger(item.sequence)
      || item.sequence <= 0
      || item.sequence > value.cursor
      || !DIGEST_PATTERN.test(item.digest ?? "")
      || ids.has(item.eventId)
      || (previousSequence !== null && item.sequence <= previousSequence)) {
      fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
    }
    ids.add(item.eventId);
    previousSequence = item.sequence;
  }
  if ((value.cursor === 0) !== (value.recentEvents.length === 0)) fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  if (value.recentEvents.length > 0 && value.recentEvents.at(-1).sequence !== value.cursor) {
    fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  }
}

function validateLegacyV1BuilderCheckpoint(checkpoint) {
  if (!hasExactKeys(checkpoint, LEGACY_V1_CHECKPOINT_KEYS)
    || checkpoint.schemaVersion !== LEGACY_V1_BUILDER_CHECKPOINT_SCHEMA_VERSION) {
    fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  }
  validateBuilderCheckpointCore(checkpoint);
  return { ok: true };
}

function validateLegacyV2BuilderCheckpoint(checkpoint) {
  if (!hasExactKeys(checkpoint, LEGACY_V2_CHECKPOINT_KEYS)
    || checkpoint.schemaVersion !== LEGACY_V2_BUILDER_CHECKPOINT_SCHEMA_VERSION) {
    fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  }
  validateBuilderCheckpointCore(checkpoint);
  validateCodexDeliveryCursor(checkpoint.codexDeliveryCursor, checkpoint.eventLedger);
  validateCodexUatChallenge(checkpoint.codexUatChallenge);
  return { ok: true };
}

function validateLegacyV3BuilderCheckpoint(checkpoint) {
  if (!hasExactKeys(checkpoint, LEGACY_V3_CHECKPOINT_KEYS)
    || checkpoint.schemaVersion !== LEGACY_V3_BUILDER_CHECKPOINT_SCHEMA_VERSION) {
    fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  }
  validateBuilderCheckpointCore(checkpoint);
  validateCodexDeliveryCursor(checkpoint.codexDeliveryCursor, checkpoint.eventLedger);
  validateCodexUatChallenge(checkpoint.codexUatChallenge);
  validateLegacyV3HookDeactivationProtocol(checkpoint.hookDeactivationProtocol);
  return { ok: true };
}

function validateAdmittedBuilderCheckpoint(checkpoint) {
  if (checkpoint?.schemaVersion === LEGACY_V1_BUILDER_CHECKPOINT_SCHEMA_VERSION) {
    return validateLegacyV1BuilderCheckpoint(checkpoint);
  }
  if (checkpoint?.schemaVersion === LEGACY_V2_BUILDER_CHECKPOINT_SCHEMA_VERSION) {
    return validateLegacyV2BuilderCheckpoint(checkpoint);
  }
  if (checkpoint?.schemaVersion === LEGACY_V3_BUILDER_CHECKPOINT_SCHEMA_VERSION) {
    return validateLegacyV3BuilderCheckpoint(checkpoint);
  }
  return validateBuilderCheckpoint(checkpoint);
}

function validateHookDeactivationProtocol(value) {
  if (!hasExactKeys(value, HOOK_PROTOCOL_KEYS)
    || !HOOK_PROTOCOL_STATES.has(value.state)) {
    fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  }
  validateHookDeactivationProtocolFields(value, value.upgradeReservation);
}

function validateLegacyV3HookDeactivationProtocol(value) {
  if (!hasExactKeys(value, LEGACY_V3_HOOK_PROTOCOL_KEYS)
    || !LEGACY_V3_HOOK_PROTOCOL_STATES.has(value.state)) {
    fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  }
  validateHookDeactivationProtocolFields(value, null);
}

function validateHookDeactivationProtocolFields(value, upgradeReservation) {
  if (value.state === "open") {
    if ([value.operationId, value.predecessorCheckpointDigest, value.lifecycleHeadDigest,
      value.receiptDigest, value.delivery, value.observationDigest, upgradeReservation]
      .some((item) => item !== null)) {
      fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
    }
    return;
  }
  if ([value.operationId, value.predecessorCheckpointDigest, value.lifecycleHeadDigest,
    value.receiptDigest].some((item) => !DIGEST_PATTERN.test(item ?? ""))) {
    fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  }
  if (value.state === "deactivation-fenced") {
    if (value.delivery !== null || value.observationDigest !== null || upgradeReservation !== null) {
      fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
    }
    return;
  }
  if (value.state === "upgrade-reserved") {
    if (!hasExactKeys(upgradeReservation, ["planDigest", "successorReceiptDigest"])
      || !DIGEST_PATTERN.test(upgradeReservation.planDigest ?? "")
      || !DIGEST_PATTERN.test(upgradeReservation.successorReceiptDigest ?? "")
      || upgradeReservation.successorReceiptDigest === value.receiptDigest
      || value.delivery !== null
      || value.observationDigest !== null
      || value.operationId !== upgradeReservationOperationId({
        predecessorCheckpointDigest: value.predecessorCheckpointDigest,
        lifecycleHeadDigest: value.lifecycleHeadDigest,
        receiptDigest: value.receiptDigest,
        upgradeReservation,
      })) {
      fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
    }
    return;
  }
  if (upgradeReservation !== null) {
    fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  }
  validateHookDeliveryProtocol(value.delivery);
  if (value.state === "hook-prepared" && value.observationDigest !== null) {
    fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  }
  if (value.state === "hook-finalized"
    && (value.delivery.observationRequired
      ? !DIGEST_PATTERN.test(value.observationDigest ?? "")
      : value.observationDigest !== null)) {
    fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  }
}

function normalizeHookDeliveryProtocol(value) {
  return {
    identity: value?.identity,
    type: value?.type,
    epoch: value?.epoch,
    sequence: value?.sequence,
    eventDigest: value?.eventDigest,
    applied: value?.applied,
    status: value?.status,
    observationRequired: value?.observationRequired,
  };
}

function validateHookDeliveryProtocol(value) {
  if (!hasExactKeys(value, [
    "identity",
    "type",
    "epoch",
    "sequence",
    "eventDigest",
    "applied",
    "status",
    "observationRequired",
  ])
    || !DIGEST_PATTERN.test(value.identity ?? "")
    || !["SessionStart", "PreCompact", "PostCompact"].includes(value.type)
    || !Number.isSafeInteger(value.epoch)
    || value.epoch < 0
    || !Number.isSafeInteger(value.sequence)
    || value.sequence <= 0
    || !DIGEST_PATTERN.test(value.eventDigest ?? "")
    || typeof value.applied !== "boolean"
    || !["applied", "duplicate"].includes(value.status)
    || value.applied !== (value.status === "applied")
    || typeof value.observationRequired !== "boolean") {
    fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  }
}

function validateCheckpointTransition(predecessor, successor, predecessorDigest, intent) {
  validateAdmittedBuilderCheckpoint(successor);
  if (predecessor === null) {
    if (successor.schemaVersion === BUILDER_CHECKPOINT_SCHEMA_VERSION
      && successor.hookDeactivationProtocol.state !== "open") {
      fail("AGENTMO_BUILDER_CHECKPOINT_PROTOCOL_TRANSITION_REJECTED");
    }
    return;
  }
  validateAdmittedBuilderCheckpoint(predecessor);
  if (predecessor.schemaVersion === LEGACY_V1_BUILDER_CHECKPOINT_SCHEMA_VERSION) {
    fail("AGENTMO_BUILDER_CHECKPOINT_PROTOCOL_UPGRADE_REJECTED");
  }
  if (predecessor.schemaVersion === LEGACY_V2_BUILDER_CHECKPOINT_SCHEMA_VERSION) {
    if (successor.schemaVersion === LEGACY_V2_BUILDER_CHECKPOINT_SCHEMA_VERSION) return;
    if (successor.schemaVersion !== BUILDER_CHECKPOINT_SCHEMA_VERSION
      || successor.hookDeactivationProtocol.state !== "open"
      || !sameLegacyV2Core(predecessor, successor)
      || (intent !== "persisted" && intent !== "upgrade-v2")) {
      fail("AGENTMO_BUILDER_CHECKPOINT_PROTOCOL_UPGRADE_REJECTED");
    }
    return;
  }
  if (predecessor.schemaVersion === LEGACY_V3_BUILDER_CHECKPOINT_SCHEMA_VERSION) {
    if (successor.schemaVersion !== BUILDER_CHECKPOINT_SCHEMA_VERSION
      || successor.hookDeactivationProtocol.upgradeReservation !== null
      || !sameLegacyV3Core(predecessor, successor)
      || !sameLegacyV3Protocol(predecessor.hookDeactivationProtocol, successor.hookDeactivationProtocol)
      || (intent !== "persisted" && intent !== "upgrade-v3")) {
      fail("AGENTMO_BUILDER_CHECKPOINT_PROTOCOL_UPGRADE_REJECTED");
    }
    return;
  }
  if (successor.schemaVersion !== BUILDER_CHECKPOINT_SCHEMA_VERSION) {
    fail("AGENTMO_BUILDER_CHECKPOINT_PROTOCOL_TRANSITION_REJECTED");
  }
  const before = predecessor.hookDeactivationProtocol;
  const after = successor.hookDeactivationProtocol;
  if (before.state === "deactivation-fenced") {
    if (after.state === "deactivation-fenced") {
      if (!sameProtocol(before, after)
        || !sameCheckpointCoreExceptChallenge(predecessor, successor)
        || successor.codexUatChallenge?.scenario !== "deactivation-tombstone-visibility") {
        fail("AGENTMO_BUILDER_CHECKPOINT_DEACTIVATION_FENCED");
      }
      return;
    }
    if (after.state === "open"
      && sameCheckpointCore(predecessor, successor)
      && (intent === "persisted" || intent === "deactivation-release")) return;
    fail("AGENTMO_BUILDER_CHECKPOINT_DEACTIVATION_FENCED");
  }
  if (before.state === "upgrade-reserved") {
    if (after.state === "open"
      && ((intent === "persisted"
          && (sameCheckpointCore(predecessor, successor)
            || (sameCheckpointCoreExceptInstallReceipt(predecessor, successor)
              && successor.installReceiptDigest === before.upgradeReservation.successorReceiptDigest)))
        || (intent === "upgrade-abort" && sameCheckpointCore(predecessor, successor))
        || (intent === "upgrade-complete"
          && sameCheckpointCoreExceptInstallReceipt(predecessor, successor)
          && successor.installReceiptDigest === before.upgradeReservation.successorReceiptDigest))) {
      return;
    }
    fail("AGENTMO_BUILDER_CHECKPOINT_UPGRADE_RESERVED");
  }
  if (before.state === "hook-prepared") {
    if (after.state !== "hook-finalized"
      || !sameCheckpointCore(predecessor, successor)
      || before.operationId !== after.operationId
      || before.predecessorCheckpointDigest !== after.predecessorCheckpointDigest
      || before.lifecycleHeadDigest !== after.lifecycleHeadDigest
      || before.receiptDigest !== after.receiptDigest
      || !sameProtocolDelivery(before.delivery, after.delivery)
      || (intent !== "persisted" && intent !== "hook-finalize")) {
      fail("AGENTMO_BUILDER_CHECKPOINT_PROTOCOL_TRANSITION_REJECTED");
    }
    return;
  }
  if (after.state === "hook-prepared") {
    if (!["open", "hook-finalized"].includes(before.state)
      || after.predecessorCheckpointDigest !== predecessorDigest
      || after.receiptDigest !== successor.installReceiptDigest
      || after.operationId !== hookOperationId(after)
      || !validPreparedCoreTransition(predecessor, successor, after.delivery)
      || (intent !== "persisted" && intent !== "hook-prepare")) {
      fail("AGENTMO_BUILDER_CHECKPOINT_PROTOCOL_TRANSITION_REJECTED");
    }
    return;
  }
  if (after.state === "deactivation-fenced") {
    if (!["open", "hook-finalized"].includes(before.state)
      || !sameCheckpointCore(predecessor, successor)
      || after.predecessorCheckpointDigest !== predecessorDigest
      || after.receiptDigest !== successor.installReceiptDigest
      || after.operationId !== deactivationFenceOperationId(after)
      || (intent !== "persisted" && intent !== "deactivation-fence")) {
      fail("AGENTMO_BUILDER_CHECKPOINT_PROTOCOL_TRANSITION_REJECTED");
    }
    return;
  }
  if (after.state === "upgrade-reserved") {
    if (![
      "open",
      "hook-finalized",
    ].includes(before.state)
      || !sameCheckpointCore(predecessor, successor)
      || after.predecessorCheckpointDigest !== predecessorDigest
      || after.receiptDigest !== successor.installReceiptDigest
      || after.operationId !== upgradeReservationOperationId(after)
      || (intent !== "persisted" && intent !== "upgrade-reserve")) {
      fail("AGENTMO_BUILDER_CHECKPOINT_PROTOCOL_TRANSITION_REJECTED");
    }
    return;
  }
  if (after.state === "hook-finalized") {
    if (before.state !== "hook-finalized" || !sameProtocol(before, after)) {
      fail("AGENTMO_BUILDER_CHECKPOINT_PROTOCOL_TRANSITION_REJECTED");
    }
    return;
  }
  if (after.state !== "open") {
    fail("AGENTMO_BUILDER_CHECKPOINT_PROTOCOL_TRANSITION_REJECTED");
  }
}

function validPreparedCoreTransition(predecessor, successor, delivery) {
  if (!delivery.applied) return sameCheckpointCore(predecessor, successor);
  if (successor.eventLedger.cursor !== predecessor.eventLedger.cursor + 1
    || successor.eventLedger.cursor !== delivery.sequence) return false;
  const record = {
    eventId: `codex-${delivery.identity.slice("sha256:".length)}`,
    sequence: delivery.sequence,
    digest: delivery.eventDigest,
  };
  const expectedLedger = {
    cursor: delivery.sequence,
    recentEvents: [...predecessor.eventLedger.recentEvents, record].slice(-64),
  };
  const expectedBoundary = delivery.type === "SessionStart"
    ? ["session-restart", "session-restart"]
    : delivery.type === "PreCompact"
      ? ["pre-compact", "context-compaction"]
      : ["post-compact", "context-compaction"];
  if (!canonicalEqual(successor.eventLedger, expectedLedger, "builder-checkpoint-hook-ledger")
    || successor.workflowId !== predecessor.workflowId
    || successor.adapterId !== predecessor.adapterId
    || successor.stage !== predecessor.stage
    || successor.boundary !== expectedBoundary[0]
    || successor.pauseReason !== expectedBoundary[1]
    || successor.nextAction !== predecessor.nextAction
    || !canonicalEqual(successor.artifactRefs, predecessor.artifactRefs, "builder-checkpoint-hook-artifacts")
    || !canonicalEqual(successor.pendingDecision, predecessor.pendingDecision, "builder-checkpoint-hook-decision")
    || !canonicalEqual(
      successor.capabilitySnapshot,
      predecessor.capabilitySnapshot,
      "builder-checkpoint-hook-capabilities",
    )
    || !canonicalEqual(
      successor.codexUatChallenge,
      predecessor.codexUatChallenge,
      "builder-checkpoint-hook-challenge",
    )) return false;
  const cursorRecord = {
    identity: delivery.identity,
    sequence: delivery.sequence,
    eventDigest: delivery.eventDigest,
  };
  let expectedCursor;
  if (delivery.type === "SessionStart") {
    expectedCursor = {
      ...predecessor.codexDeliveryCursor,
      sessionDigest: successor.codexDeliveryCursor.sessionDigest,
      sessionStart: cursorRecord,
    };
    if (!DIGEST_PATTERN.test(expectedCursor.sessionDigest ?? "")
      || predecessor.codexDeliveryCursor.sessionDigest !== null
        && predecessor.codexDeliveryCursor.sessionDigest !== expectedCursor.sessionDigest) {
      return false;
    }
  } else if (delivery.type === "PreCompact") {
    expectedCursor = {
      ...predecessor.codexDeliveryCursor,
      compactionEpoch: predecessor.codexDeliveryCursor.compactionEpoch + 1,
      compactState: "pre-applied",
      preCompact: cursorRecord,
      postCompact: null,
    };
    if (delivery.epoch !== expectedCursor.compactionEpoch) return false;
  } else {
    expectedCursor = {
      ...predecessor.codexDeliveryCursor,
      compactState: "post-applied",
      postCompact: cursorRecord,
    };
    if (delivery.epoch !== predecessor.codexDeliveryCursor.compactionEpoch) return false;
  }
  return canonicalEqual(
    successor.codexDeliveryCursor,
    expectedCursor,
    "builder-checkpoint-hook-cursor",
  );
}

function sameLegacyV2Core(legacy, current) {
  const { schemaVersion: _currentSchema, hookDeactivationProtocol: _protocol, ...currentFields } = current;
  const { schemaVersion: _legacySchema, ...legacyFields } = legacy;
  return canonicalEqual(legacyFields, currentFields, "builder-checkpoint-v2-upgrade");
}

function sameLegacyV3Core(legacy, current) {
  const { schemaVersion: _currentSchema, hookDeactivationProtocol: _protocol, ...currentFields } = current;
  const { schemaVersion: _legacySchema, hookDeactivationProtocol: _legacyProtocol, ...legacyFields } = legacy;
  return canonicalEqual(legacyFields, currentFields, "builder-checkpoint-v3-upgrade");
}

function sameLegacyV3Protocol(legacy, current) {
  const { upgradeReservation, ...currentLegacyShape } = current;
  return upgradeReservation === null
    && canonicalEqual(legacy, currentLegacyShape, "builder-checkpoint-v3-protocol-upgrade");
}

function sameCheckpointCore(left, right) {
  const { hookDeactivationProtocol: _leftProtocol, ...leftCore } = left;
  const { hookDeactivationProtocol: _rightProtocol, ...rightCore } = right;
  return canonicalEqual(leftCore, rightCore, "builder-checkpoint-protocol-core");
}

function sameCheckpointCoreExceptChallenge(left, right) {
  const {
    hookDeactivationProtocol: _leftProtocol,
    codexUatChallenge: _leftChallenge,
    ...leftCore
  } = left;
  const {
    hookDeactivationProtocol: _rightProtocol,
    codexUatChallenge: _rightChallenge,
    ...rightCore
  } = right;
  return canonicalEqual(leftCore, rightCore, "builder-checkpoint-protocol-core");
}

function sameCheckpointCoreExceptInstallReceipt(left, right) {
  const {
    hookDeactivationProtocol: _leftProtocol,
    installReceiptDigest: _leftReceipt,
    ...leftCore
  } = left;
  const {
    hookDeactivationProtocol: _rightProtocol,
    installReceiptDigest: _rightReceipt,
    ...rightCore
  } = right;
  return canonicalEqual(leftCore, rightCore, "builder-checkpoint-upgrade-core");
}

function sameProtocol(left, right) {
  return canonicalEqual(left, right, "builder-checkpoint-protocol");
}

function sameProtocolDelivery(left, right) {
  return canonicalEqual(left, right, "builder-checkpoint-hook-delivery");
}

function canonicalEqual(left, right, subject) {
  return serializePersistableJson(left, { subject })
    === serializePersistableJson(right, { subject });
}

function hookOperationId(value) {
  return protocolDigest({
    schemaVersion: "agentmo.builder-hook-operation.v1",
    predecessorCheckpointDigest: value.predecessorCheckpointDigest,
    lifecycleHeadDigest: value.lifecycleHeadDigest,
    receiptDigest: value.receiptDigest,
    delivery: value.delivery,
  }, "builder-hook-operation");
}

function deactivationFenceOperationId(value) {
  return protocolDigest({
    schemaVersion: "agentmo.builder-deactivation-fence.v1",
    predecessorCheckpointDigest: value.predecessorCheckpointDigest,
    lifecycleHeadDigest: value.lifecycleHeadDigest,
    receiptDigest: value.receiptDigest,
  }, "builder-deactivation-fence");
}

function upgradeReservationOperationId(value) {
  return protocolDigest({
    schemaVersion: "agentmo.builder-upgrade-reservation.v1",
    predecessorCheckpointDigest: value.predecessorCheckpointDigest,
    lifecycleHeadDigest: value.lifecycleHeadDigest,
    receiptDigest: value.receiptDigest,
    planDigest: value.upgradeReservation?.planDigest,
    successorReceiptDigest: value.upgradeReservation?.successorReceiptDigest,
  }, "builder-upgrade-reservation");
}

function sameUpgradeReservation(left, right) {
  return canonicalEqual(left, right, "builder-upgrade-reservation");
}

function matchesUpgradeReservation(protocol, expected) {
  return sameUpgradeReservation(protocol.upgradeReservation, expected)
    && protocol.operationId === upgradeReservationOperationId({
      predecessorCheckpointDigest: protocol.predecessorCheckpointDigest,
      lifecycleHeadDigest: protocol.lifecycleHeadDigest,
      receiptDigest: protocol.receiptDigest,
      upgradeReservation: protocol.upgradeReservation,
    });
}

function protocolDigest(value, subject) {
  return digestRawBytes(Buffer.from(serializePersistableJson(value, { subject }), "utf8"));
}

function validateCodexDeliveryCursor(value, eventLedger) {
  if (!hasExactKeys(value, [
    "sessionDigest",
    "sessionStart",
    "compactionEpoch",
    "compactState",
    "preCompact",
    "postCompact",
  ])) {
    fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  }
  if (value.sessionDigest !== null && !DIGEST_PATTERN.test(value.sessionDigest ?? "")) {
    fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  }
  if (!Number.isSafeInteger(value.compactionEpoch)
    || value.compactionEpoch < 0
    || !COMPACT_STATES.has(value.compactState)) {
    fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  }
  validateDeliveryRecord(value.sessionStart, eventLedger);
  validateDeliveryRecord(value.preCompact, eventLedger);
  validateDeliveryRecord(value.postCompact, eventLedger);
  if ((value.sessionDigest === null) !== (value.sessionStart === null)) {
    fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  }
  if (value.compactState === "idle") {
    if (value.compactionEpoch !== 0 || value.preCompact !== null || value.postCompact !== null) {
      fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
    }
  } else if (value.compactState === "pre-applied") {
    if (value.compactionEpoch <= 0 || value.preCompact === null || value.postCompact !== null) {
      fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
    }
  } else if (value.compactState === "post-applied") {
    if (value.compactionEpoch <= 0
      || value.preCompact === null
      || value.postCompact === null
      || value.postCompact.sequence <= value.preCompact.sequence) {
      fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
    }
  }
}

function validateDeliveryRecord(value, eventLedger) {
  if (value === null) return;
  if (!hasExactKeys(value, ["identity", "sequence", "eventDigest"])
    || !DIGEST_PATTERN.test(value.identity ?? "")
    || !Number.isSafeInteger(value.sequence)
    || value.sequence <= 0
    || value.sequence > eventLedger.cursor
    || !DIGEST_PATTERN.test(value.eventDigest ?? "")) {
    fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  }
  const eventId = `codex-${value.identity.slice("sha256:".length)}`;
  const ledgerRecord = eventLedger.recentEvents.find((item) => item.eventId === eventId);
  if (ledgerRecord
    && (ledgerRecord.sequence !== value.sequence || ledgerRecord.digest !== value.eventDigest)) {
    fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  }
}

function validateCodexUatChallenge(value) {
  if (value === null) return;
  if (!hasExactKeys(value, ["attemptId", "scenario", "correlation"])
    || !ID_PATTERN.test(value.attemptId ?? "")
    || !CODEX_UAT_SCENARIOS.has(value.scenario)
    || !OPAQUE_CORRELATION_PATTERN.test(value.correlation ?? "")) {
    fail("AGENTMO_BUILDER_CHECKPOINT_INVALID");
  }
}

function legalNextAction(stage, nextAction) {
  const legal = {
    discover: new Set(["discover", "plan", "await-approval"]),
    plan: new Set(["plan", "produce", "await-approval"]),
    produce: new Set(["produce", "complete", "await-approval"]),
  };
  return legal[stage]?.has(nextAction) === true;
}

function portableRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 512 || value.includes("\\")) return false;
  if (value.startsWith("/") || value.startsWith("~") || /^[A-Za-z]:/u.test(value)) return false;
  const normalized = path.posix.normalize(value);
  return normalized === value && normalized !== "." && !normalized.startsWith("../") && !normalized.includes("/../");
}

function hasExactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key, index) => actual[index] === key);
}

function hasKeySet(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function fail(code) {
  throw new BuilderCheckpointError(code);
}
