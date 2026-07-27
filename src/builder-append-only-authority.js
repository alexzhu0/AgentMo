import { constants } from "node:fs";
import {
  lstat,
  open,
  readdir,
  readlink,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { digestRawBytes } from "./artifact-admission.js";
import { assertBuilderPlatform } from "./builder-platform.js";
import { runBuilderPosixEffect } from "./builder-posix-effect.js";
import { assertPersistable, serializePersistableJson } from "./persistability.js";

const AUTHORITY_SCHEMA_VERSION = "agentmo.append-only-authority.v1";
const PREPARED_SCHEMA_VERSION = "agentmo.append-only-prepared.v1";
const PREPARED_SCHEMA_VERSION_V2 = "agentmo.append-only-prepared.v2";
const OUTCOME_SCHEMA_VERSION = "agentmo.append-only-outcome.v1";
const OUTCOME_SCHEMA_VERSION_V2 = "agentmo.append-only-outcome.v2";
const CLAIM_ABORT_OUTCOME_SCHEMA_VERSION = "agentmo.append-only-claim-abort-outcome.v2";
const RECORD_STAGE_ABORT_OUTCOME_SCHEMA_VERSION = "agentmo.append-only-record-stage-abort-outcome.v2";
const PREPARED_STAGE_ABORT_OUTCOME_SCHEMA_VERSION = "agentmo.append-only-prepared-stage-abort-outcome.v2";
const CLAIM_SCHEMA_VERSION = "agentmo.append-only-claim.v2";
const LINEAGE_ANCHOR_SCHEMA_VERSION = "agentmo.append-only-lineage-anchor.v1";
const LINEAGE_PROVISION_SCHEMA_VERSION = "agentmo.append-only-lineage-provision.v1";
const ROOT_WITNESS_SCHEMA_VERSION = "agentmo.append-only-root-witness.v1";
const LINEAGE_KEY_SCHEMA_VERSION = "agentmo.append-only-lineage-key.v1";
const LINEAGE_ANCHOR_DIRECTORY = ".agentmo-append-only-lineage";
const LINEAGE_PROVISION_DIRECTORY = ".agentmo-append-only-provisioning";
const ROOT_WITNESS_DIRECTORY = ".agentmo-root-witness";
const EMPTY_DIGEST = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const NAMESPACE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u;
const IDEMPOTENCY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/u;
const SEQUENCE_PATTERN = /^\d{16}\.json$/u;
const STAGE_PATTERN = /^[a-f0-9]{64}\.(?:record|prepared|outcome)\.json$/u;
const COLOCATED_STAGE_PATTERN = /^[a-f0-9]{64}\.(?:record|prepared|outcome)\.stage\.json$/u;
const OUTCOME_SELECTION_PATTERN = /^[a-f0-9]{64}\.outcome\.selection$/u;
const STAGE_SELECTION_PATTERN = /^[a-f0-9]{64}\.(?:record|prepared|outcome)\.json\.selection$/u;
const COLOCATED_STAGE_SELECTION_PATTERN = /^[a-f0-9]{64}\.(?:record|prepared)\.stage\.json\.selection$/u;
const OUTCOME_SELECTION_TARGET_PATTERN = /^am-selected-file-v1\.([a-f0-9]{64})\.([1-9]\d{0,6})$/u;
const MAX_AUTHORITY_BYTES = 1024 * 1024;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

export class BuilderAppendOnlyAuthorityError extends Error {
  constructor(code) {
    super("Append-only authority operation was rejected.");
    this.name = "BuilderAppendOnlyAuthorityError";
    this.code = code;
  }
}

export async function readAppendOnlyAuthority(options = {}) {
  assertAppendOnlyPlatform();
  assertExactOptionKeys(options, ["projectRoot", "relativeRoot", "namespace"]);
  const location = await resolveStore(options, false);
  if (location === null) return emptyState(options.namespace);
  try {
    return await readAuthorityAt(location, options.namespace);
  } finally {
    await closeStore(location);
  }
}

export async function appendAppendOnlyRecord(options = {}) {
  assertAppendOnlyPlatform();
  assertExactOptionKeys(
    options,
    ["projectRoot", "relativeRoot", "namespace", "idempotencyKey", "payload"],
    ["expectedHeadDigest", "authorityCapability"],
  );
  const namespace = admitNamespace(options.namespace);
  const protectedRecoveryOnly = await protectedAuthorityRecoveryOnly(
    namespace,
    options.authorityCapability,
  );
  const idempotencyKey = admitIdempotencyKey(options.idempotencyKey);
  assertPersistable(options.payload, { subject: `${namespace}-append-only-record` });
  const location = await resolveStore(options, !protectedRecoveryOnly);
  if (location === null) fail("AGENTMO_APPEND_ONLY_AUTHORITY_REJECTED");
  try {
  let state = await readAuthorityAt(location, namespace);
  if (protectedRecoveryOnly && state.recoveryRequired === null) {
    fail("AGENTMO_APPEND_ONLY_AUTHORITY_REJECTED");
  }

  const payloadBytes = Buffer.from(serializePersistableJson(options.payload, {
    subject: `${namespace}-append-only-payload`,
  }), "utf8");
  const payloadDigest = digestRawBytes(payloadBytes);
  const prior = state.records.find((record) => record.idempotencyKey === idempotencyKey);
  if (prior !== undefined) {
    if (prior.payloadDigest !== payloadDigest) fail("AGENTMO_APPEND_ONLY_IDEMPOTENCY_CONFLICT");
    return resultForRecord(state, prior, false);
  }
  const priorAbort = state.aborted.find((record) => record.idempotencyKey === idempotencyKey);
  if (priorAbort !== undefined) {
    if (priorAbort.payloadDigest !== payloadDigest) {
      fail("AGENTMO_APPEND_ONLY_IDEMPOTENCY_CONFLICT");
    }
    return resultForAbort(state, priorAbort, false);
  }
  assertExpectedHead(state, options.expectedHeadDigest);

  const sequence = state.nextSequence;
  const envelope = Object.freeze({
    schemaVersion: AUTHORITY_SCHEMA_VERSION,
    namespace,
    sequence,
    idempotencyKey,
    predecessorRecordDigest: state.headRecordDigest,
    predecessorOutcomeDigest: state.headOutcomeDigest,
    payloadDigest,
    payload: options.payload,
  });
  const recordBytes = bytesFor(envelope, `${namespace}-append-only-envelope`);
  const recordDigest = digestRawBytes(recordBytes);
  const operationId = digestRawBytes(Buffer.from([
    namespace,
    String(sequence),
    state.headRecordDigest,
    state.headOutcomeDigest,
    idempotencyKey,
    recordDigest,
  ].join("\n"), "utf8")).slice("sha256:".length);
  const names = namesFor(sequence, operationId, recordDigest);

  if (state.recoveryRequired !== null) {
    const recovery = state.recoveryRequired;
    if (recovery.sequence !== sequence
      || recovery.recordDigest !== recordDigest
      || recovery.operationId !== operationId
      || recovery.idempotencyKey !== idempotencyKey) {
      fail("AGENTMO_APPEND_ONLY_PREPARED_RECOVERY_REQUIRED");
    }
  }

  const claim = Object.freeze({
    schemaVersion: CLAIM_SCHEMA_VERSION,
    namespace,
    sequence,
    operationId,
    idempotencyKey,
    predecessorRecordDigest: state.headRecordDigest,
    predecessorOutcomeDigest: state.headOutcomeDigest,
    recordDigest,
    payloadDigest,
  });
  const claimTarget = encodeClaimTarget(claim);
  const claimPath = `claims/${sequenceFile(sequence)}`;
  await publishClaim(location, claimPath, claimTarget);

  state = await readAuthorityAt(location, namespace);
  if (state.recoveryRequired === null
    || state.recoveryRequired.operationId !== operationId
    || state.recoveryRequired.recordDigest !== recordDigest) {
    fail("AGENTMO_APPEND_ONLY_SEQUENCE_CLAIM_LOST");
  }

  const recordStage = path.join(location.root, names.recordStage);
  await publishStage(
    location,
    recordStage,
    recordBytes,
    state.recoveryRequired.incompleteRecordStage?.identity ?? null,
  );

  const recordStageIdentity = await inspectSelectedExactFile(recordStage, recordBytes, [1n, 2n]);
  const claimIdentity = await inspectExactClaim(
    path.join(location.root, claimPath),
    claimTarget,
  );
  const prepared = state.recoveryRequired.preparedBytes === null
    ? Object.freeze({
        schemaVersion: PREPARED_SCHEMA_VERSION_V2,
        namespace,
        sequence,
        operationId,
        idempotencyKey,
        predecessorRecordDigest: state.headRecordDigest,
        predecessorOutcomeDigest: state.headOutcomeDigest,
        recordDigest,
        payloadDigest,
        claimPath,
        claimIdentity: identityOf(claimIdentity),
        recordStagePath: names.recordStage,
        recordStageIdentity: identityOf(recordStageIdentity),
        recordPath: names.record,
      })
    : parseJson(
        state.recoveryRequired.preparedBytes,
        "AGENTMO_APPEND_ONLY_PREPARED_INVALID",
      );
  const preparedBytes = state.recoveryRequired.preparedBytes
    ?? bytesFor(prepared, `${namespace}-append-only-prepared`);
  const preparedStage = path.join(location.root, names.preparedStage);
  const preparedFinal = path.join(location.root, names.prepared);
  await publishStage(
    location,
    preparedStage,
    preparedBytes,
    state.recoveryRequired.incompletePreparedStage?.identity ?? null,
  );
  await publishAbsentLink(
    location,
    preparedStage,
    preparedFinal,
    preparedBytes,
  );

  const recordFinal = path.join(location.root, names.record);
  await publishAbsentLink(location, recordStage, recordFinal, recordBytes);
  const preparedIdentity = await inspectLinkedPair(preparedStage, preparedFinal, preparedBytes);
  const recordIdentity = await inspectLinkedPair(recordStage, recordFinal, recordBytes);
  const outcome = Object.freeze({
    schemaVersion: OUTCOME_SCHEMA_VERSION_V2,
    namespace,
    sequence,
    operationId,
    outcome: "committed",
    idempotencyKey,
    predecessorRecordDigest: state.headRecordDigest,
    predecessorOutcomeDigest: state.headOutcomeDigest,
    recordDigest,
    payloadDigest,
    preparedPath: names.prepared,
    preparedStagePath: names.preparedStage,
    preparedIdentity: identityOf(preparedIdentity),
    recordPath: names.record,
    recordStagePath: names.recordStage,
    recordIdentity: identityOf(recordIdentity),
  });
  const outcomeBytes = bytesFor(outcome, `${namespace}-append-only-outcome`);
  const outcomeStage = path.join(location.root, names.outcomeStage);
  const outcomeFinal = path.join(location.root, names.outcome);
  await publishOutcomeStage(
    location,
    outcomeStage,
    names.outcomeSelection,
    outcomeBytes,
    state.recoveryRequired.incompleteStagedOutcome?.identity ?? null,
  );
  await publishAbsentLink(location, outcomeStage, outcomeFinal, outcomeBytes);

  state = await readAuthorityAt(location, namespace);
  const committed = state.records.find((entry) => entry.digest === recordDigest);
  if (!committed || state.recoveryRequired !== null) fail("AGENTMO_APPEND_ONLY_COMMIT_REVALIDATION_FAILED");
  return resultForRecord(state, committed, true);
  } finally {
    await closeStore(location);
  }
}

export async function abortAppendOnlyPrepared(options = {}) {
  assertAppendOnlyPlatform();
  assertExactOptionKeys(
    options,
    [
      "projectRoot",
      "relativeRoot",
      "namespace",
      "expectedPreparedRecordDigest",
      "reason",
    ],
    ["expectedHeadDigest"],
  );
  const namespace = admitNamespace(options.namespace);
  const location = await resolveStore(options, true);
  try {
  let state = await readAuthorityAt(location, namespace);
  if (!DIGEST_PATTERN.test(options.expectedPreparedRecordDigest ?? "")) {
    fail("AGENTMO_APPEND_ONLY_PREPARED_DIGEST_CHANGED");
  }
  const reason = options.reason;
  if (typeof reason !== "string" || !/^[A-Z][A-Z0-9_]{0,127}$/u.test(reason)) {
    fail("AGENTMO_APPEND_ONLY_ABORT_REASON_INVALID");
  }
  const priorAbort = state.aborted.find(
    (record) => record.recordDigest === options.expectedPreparedRecordDigest,
  );
  if (priorAbort !== undefined) {
    if (priorAbort.reason !== reason) fail("AGENTMO_APPEND_ONLY_IDEMPOTENCY_CONFLICT");
    return resultForAbort(state, priorAbort, false);
  }
  assertExpectedHead(state, options.expectedHeadDigest);
  const recovery = state.recoveryRequired;
  if (recovery === null) fail("AGENTMO_APPEND_ONLY_PREPARED_REQUIRED");
  if (options.expectedPreparedRecordDigest !== recovery.recordDigest) {
    fail("AGENTMO_APPEND_ONLY_PREPARED_DIGEST_CHANGED");
  }
  if (recovery.incompleteRecordStage !== null
    || recovery.incompletePreparedStage !== null) {
    fail("AGENTMO_APPEND_ONLY_SELECTED_WRITE_RECOVERY_REQUIRED");
  }

  const claimOnly = recovery.schemaVersion === CLAIM_SCHEMA_VERSION
    && recovery.preparedBytes === null
    && recovery.recordStagePresent === false;
  const recordStageOnly = recovery.schemaVersion === CLAIM_SCHEMA_VERSION
    && recovery.preparedBytes === null
    && recovery.recordStagePresent === true;
  let preparedIdentity;
  let preparedStageOnly = false;
  let recordFinalInspection = null;
  let recordStageIdentity = null;
  if (claimOnly) {
    preparedIdentity = await inspectExactClaim(
      path.join(location.root, recovery.claimPath),
      encodeClaimTarget(recovery),
    );
  } else if (recordStageOnly) {
    preparedIdentity = await inspectExactClaim(
      path.join(location.root, recovery.claimPath),
      encodeClaimTarget(recovery),
    );
    const recordStage = path.join(location.root, recovery.recordStagePath);
    const recordStageBytes = await readExactFile(recordStage);
    if (digestRawBytes(recordStageBytes) !== recovery.recordDigest) {
      fail("AGENTMO_APPEND_ONLY_RECORD_CHANGED");
    }
    recordStageIdentity = await inspectSelectedExactFile(recordStage, recordStageBytes, [1n]);
    recordFinalInspection = await inspectOptionalLinkedRecord(
      recordStage,
      path.join(location.root, recovery.recordPath),
      recordStageBytes,
    );
    if (recordFinalInspection !== null) {
      fail("AGENTMO_APPEND_ONLY_ABORTED_RECORD_LINK_CHANGED");
    }
  } else {
    const preparedStage = path.join(location.root, recovery.preparedStagePath);
    const preparedFinal = path.join(location.root, recovery.preparedPath);
    const preparedFinalInspection = await inspectOptionalLinkedRecord(
      preparedStage,
      preparedFinal,
      recovery.preparedBytes,
    );
    preparedStageOnly = recovery.schemaVersion === CLAIM_SCHEMA_VERSION
      && preparedFinalInspection === null;
    preparedIdentity = preparedFinalInspection ?? await inspectExactFile(
      preparedStage,
      recovery.preparedBytes,
      [1n],
    );
    const recordStage = path.join(location.root, recovery.recordStagePath);
    const recordStageBytes = await readExactFile(recordStage);
    if (digestRawBytes(recordStageBytes) !== recovery.recordDigest) {
      fail("AGENTMO_APPEND_ONLY_RECORD_CHANGED");
    }
    const recordFinal = path.join(location.root, recovery.recordPath);
    recordFinalInspection = await inspectOptionalLinkedRecord(
      recordStage,
      recordFinal,
      recordStageBytes,
    );
    if (preparedStageOnly && (recovery.recordLinked || recordFinalInspection !== null)) {
      fail("AGENTMO_APPEND_ONLY_ABORTED_RECORD_LINK_CHANGED");
    }
  }
  const names = recovery.schemaVersion === CLAIM_SCHEMA_VERSION
    ? namesForV2(recovery.sequence, recovery.operationId, recovery.recordDigest)
    : namesForV1(recovery.sequence, recovery.operationId, recovery.recordDigest);
  const outcome = Object.freeze({
    schemaVersion: claimOnly
      ? CLAIM_ABORT_OUTCOME_SCHEMA_VERSION
      : recordStageOnly
        ? RECORD_STAGE_ABORT_OUTCOME_SCHEMA_VERSION
        : preparedStageOnly
          ? PREPARED_STAGE_ABORT_OUTCOME_SCHEMA_VERSION
        : recovery.schemaVersion === CLAIM_SCHEMA_VERSION
        ? OUTCOME_SCHEMA_VERSION_V2
      : OUTCOME_SCHEMA_VERSION,
    namespace,
    sequence: recovery.sequence,
    operationId: recovery.operationId,
    outcome: "aborted",
    reason,
    idempotencyKey: recovery.idempotencyKey,
    predecessorRecordDigest: recovery.predecessorRecordDigest,
    predecessorOutcomeDigest: recovery.predecessorOutcomeDigest,
    recordDigest: recovery.recordDigest,
    payloadDigest: recovery.payloadDigest,
    preparedPath: claimOnly || recordStageOnly
      ? recovery.claimPath
      : preparedStageOnly
        ? recovery.preparedStagePath
        : recovery.preparedPath,
    preparedStagePath: claimOnly || recordStageOnly || preparedStageOnly
      ? null
      : recovery.preparedStagePath,
    preparedIdentity: identityOf(preparedIdentity),
    recordPath: recovery.recordPath,
    recordStagePath: recovery.recordStagePath,
    recordIdentity: recordStageOnly
      ? identityOf(recordStageIdentity)
      : recordFinalInspection === null ? null : identityOf(recordFinalInspection),
  });
  const outcomeBytes = bytesFor(outcome, `${namespace}-append-only-abort`);
  const outcomeStage = path.join(location.root, names.outcomeStage);
  const outcomeFinal = path.join(location.root, names.outcome);
  await publishOutcomeStage(
    location,
    outcomeStage,
    names.outcomeSelection,
    outcomeBytes,
    recovery.incompleteStagedOutcome?.identity ?? null,
  );
  await publishAbsentLink(location, outcomeStage, outcomeFinal, outcomeBytes);

  state = await readAuthorityAt(location, namespace);
  if (state.recoveryRequired !== null || state.nextSequence !== recovery.sequence + 1) {
    fail("AGENTMO_APPEND_ONLY_ABORT_REVALIDATION_FAILED");
  }
  const aborted = state.aborted.find((record) => record.recordDigest === recovery.recordDigest);
  if (aborted === undefined) fail("AGENTMO_APPEND_ONLY_ABORT_REVALIDATION_FAILED");
  return resultForAbort(state, aborted, true);
  } finally {
    await closeStore(location);
  }
}

/**
 * Completes only the final hard-link publication for an outcome stage that was
 * already admitted by the append-only reader. This never reconstructs a
 * record, rewrites a stage, or selects an outcome: a durable outcome stage
 * either links its exact bytes or remains fail-closed.
 */
export async function finalizeAppendOnlyStagedOutcome(options = {}) {
  assertAppendOnlyPlatform();
  assertExactOptionKeys(
    options,
    [
      "projectRoot",
      "relativeRoot",
      "namespace",
      "expectedHeadDigest",
      "expectedPreparedRecordDigest",
      "expectedStagedOutcomeDigest",
    ],
  );
  if (!DIGEST_PATTERN.test(options.expectedHeadDigest ?? "")
    || !DIGEST_PATTERN.test(options.expectedPreparedRecordDigest ?? "")
    || !DIGEST_PATTERN.test(options.expectedStagedOutcomeDigest ?? "")) {
    fail("AGENTMO_APPEND_ONLY_OUTCOME_STAGE_EXPECTATION_INVALID");
  }
  const namespace = admitNamespace(options.namespace);
  const location = await resolveStore(options, true);
  try {
    const state = await readAuthorityAt(location, namespace);
    assertExpectedHead(state, options.expectedHeadDigest);
    const recovery = state.recoveryRequired;
    if (recovery === null) fail("AGENTMO_APPEND_ONLY_OUTCOME_STAGE_REQUIRED");
    if (recovery.recordDigest !== options.expectedPreparedRecordDigest) {
      fail("AGENTMO_APPEND_ONLY_PREPARED_DIGEST_CHANGED");
    }
    if (recovery.stagedOutcome === null) fail("AGENTMO_APPEND_ONLY_OUTCOME_STAGE_REQUIRED");
    const outcome = recovery.stagedOutcome.value;
    const outcomeBytes = recovery.stagedOutcome.bytes;
    if (digestRawBytes(outcomeBytes) !== options.expectedStagedOutcomeDigest) {
      fail("AGENTMO_APPEND_ONLY_OUTCOME_STAGE_CHANGED");
    }
    const outcomeStage = path.join(location.root, stagePathForOutcome(outcome, "outcome"));
    const outcomeFinal = path.join(location.outcomes, sequenceFile(recovery.sequence));
    await inspectSelectedExactFile(outcomeStage, outcomeBytes, [1n]);
    await publishAbsentLink(location, outcomeStage, outcomeFinal, outcomeBytes);

    const finalized = await readAuthorityAt(location, namespace);
    if (finalized.recoveryRequired !== null || finalized.nextSequence !== recovery.sequence + 1) {
      fail("AGENTMO_APPEND_ONLY_OUTCOME_STAGE_FINALIZATION_FAILED");
    }
    if (outcome.outcome === "committed") {
      const record = finalized.records.find((entry) => (
        entry.sequence === recovery.sequence && entry.digest === recovery.recordDigest
      ));
      if (record === undefined) fail("AGENTMO_APPEND_ONLY_OUTCOME_STAGE_FINALIZATION_FAILED");
      return resultForRecord(finalized, record, true);
    }
    const aborted = finalized.aborted.find((entry) => (
      entry.sequence === recovery.sequence && entry.recordDigest === recovery.recordDigest
    ));
    if (aborted === undefined) fail("AGENTMO_APPEND_ONLY_OUTCOME_STAGE_FINALIZATION_FAILED");
    return resultForAbort(finalized, aborted, true);
  } finally {
    await closeStore(location);
  }
}

async function readAuthorityAt(location, namespaceCandidate) {
  const namespace = admitNamespace(namespaceCandidate);
  await assertStore(location);
  const outcomeEntries = await readDirectoryEntries(location, location.outcomes);
  for (const entry of outcomeEntries) {
    const admittedFile = entry.isFile()
      && (SEQUENCE_PATTERN.test(entry.name)
        || (COLOCATED_STAGE_PATTERN.test(entry.name) && entry.name.includes(".outcome.stage.")));
    const admittedSelection = entry.isSymbolicLink()
      && OUTCOME_SELECTION_PATTERN.test(entry.name);
    if (!admittedFile && !admittedSelection) {
      fail("AGENTMO_APPEND_ONLY_UNREGISTERED_AUTHORITY_ENTRY");
    }
  }
  const outcomeNames = outcomeEntries
    .filter((entry) => SEQUENCE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const preparedEntries = await readDirectoryEntries(location, location.prepared);
  for (const entry of preparedEntries) {
    const admittedFile = entry.isFile()
      && (SEQUENCE_PATTERN.test(entry.name)
        || (COLOCATED_STAGE_PATTERN.test(entry.name) && entry.name.includes(".prepared.stage.")));
    const admittedSelection = entry.isSymbolicLink()
      && COLOCATED_STAGE_SELECTION_PATTERN.test(entry.name)
      && entry.name.includes(".prepared.stage.");
    if (!admittedFile && !admittedSelection) {
      fail("AGENTMO_APPEND_ONLY_UNREGISTERED_PREPARED_ENTRY");
    }
  }
  const preparedNames = preparedEntries
    .filter((entry) => SEQUENCE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const entryNames = await readDirectoryEntries(location, location.entries);
  for (const entry of entryNames) {
    const admittedFile = entry.isFile()
      && (/^\d{16}\.[a-f0-9]{64}\.json$/u.test(entry.name)
        || (COLOCATED_STAGE_PATTERN.test(entry.name) && entry.name.includes(".record.stage.")));
    const admittedSelection = entry.isSymbolicLink()
      && COLOCATED_STAGE_SELECTION_PATTERN.test(entry.name)
      && entry.name.includes(".record.stage.");
    if (!admittedFile && !admittedSelection) {
      fail("AGENTMO_APPEND_ONLY_UNREGISTERED_RECORD_ENTRY");
    }
  }
  const stageNames = await readDirectoryEntries(location, location.stages);
  for (const entry of stageNames) {
    if (!(entry.isFile() && STAGE_PATTERN.test(entry.name))
      && !(entry.isSymbolicLink() && STAGE_SELECTION_PATTERN.test(entry.name))) {
      fail("AGENTMO_APPEND_ONLY_UNREGISTERED_STAGE_ENTRY");
    }
  }
  const claimEntries = location.claims === null
    ? []
    : await readDirectoryEntries(location, location.claims);
  for (const entry of claimEntries) {
    if (!entry.isSymbolicLink() || !SEQUENCE_PATTERN.test(entry.name)) {
      fail("AGENTMO_APPEND_ONLY_UNREGISTERED_CLAIM_ENTRY");
    }
  }
  const presentEntryNames = new Set(entryNames.map((entry) => entry.name));
  const presentPreparedNames = new Set(preparedEntries.map((entry) => entry.name));
  const presentOutcomeNames = new Set(outcomeEntries.map((entry) => entry.name));
  const presentStageNames = new Set(stageNames.map((entry) => entry.name));
  const presentClaimNames = new Set(claimEntries.map((entry) => entry.name));
  const registeredEntryNames = new Set();
  const registeredPreparedNames = new Set();
  const registeredOutcomeNames = new Set();
  const registeredStageNames = new Set();
  const registeredClaimNames = new Set();

  const records = [];
  const aborted = [];
  const idempotencyKeys = new Set();
  let headRecordDigest = EMPTY_DIGEST;
  let headOutcomeDigest = EMPTY_DIGEST;
  for (let sequence = 0; sequence < outcomeNames.length; sequence += 1) {
    const expectedName = sequenceFile(sequence);
    if (outcomeNames[sequence] !== expectedName) {
      fail("AGENTMO_APPEND_ONLY_SEQUENCE_GAP");
    }
    const outcomePath = path.join(location.outcomes, expectedName);
    const outcomeBytes = await readExactFile(outcomePath);
    const outcome = parseJson(outcomeBytes, "AGENTMO_APPEND_ONLY_OUTCOME_INVALID");
    validateOutcome(outcome, { namespace, sequence, headRecordDigest, headOutcomeDigest });
    assertCanonicalOutcomeBytes(outcome, outcomeBytes, namespace);
    const claimAbort = outcome.schemaVersion === CLAIM_ABORT_OUTCOME_SCHEMA_VERSION;
    const recordStageAbort = outcome.schemaVersion === RECORD_STAGE_ABORT_OUTCOME_SCHEMA_VERSION;
    const preparedStageAbort = outcome.schemaVersion === PREPARED_STAGE_ABORT_OUTCOME_SCHEMA_VERSION;
    const v2 = outcome.schemaVersion === OUTCOME_SCHEMA_VERSION_V2
      || claimAbort
      || recordStageAbort
      || preparedStageAbort;
    const outcomeSelectionName = `${outcome.operationId}.outcome.selection`;
    if (v2 && presentOutcomeNames.has(outcomeSelectionName)) {
      await readOutcomeSelection(
        path.join(location.outcomes, outcomeSelectionName),
        outcomeBytes,
      );
      registeredOutcomeNames.add(outcomeSelectionName);
    }
    const registerStage = (relativePath) => {
      const parent = path.dirname(relativePath);
      const name = path.basename(relativePath);
      const selectionName = path.basename(selectionPathForStagePath(relativePath));
      if (parent === "entries") {
        registeredEntryNames.add(name);
        registeredEntryNames.add(selectionName);
      } else if (parent === "prepared") {
        registeredPreparedNames.add(name);
        registeredPreparedNames.add(selectionName);
      } else if (parent === "outcomes") {
        registeredOutcomeNames.add(name);
        registeredOutcomeNames.add(selectionName);
      } else if (parent === "stages") {
        registeredStageNames.add(name);
        if (presentStageNames.has(selectionName)) {
          registeredStageNames.add(selectionName);
        }
      } else fail("AGENTMO_APPEND_ONLY_UNREGISTERED_STAGE_ENTRY");
    };
    if (!claimAbort && !recordStageAbort && !preparedStageAbort) {
      registerStage(outcome.recordStagePath);
      registerStage(outcome.preparedStagePath);
      registeredPreparedNames.add(expectedName);
    } else if (recordStageAbort) {
      registerStage(outcome.recordStagePath);
    } else if (preparedStageAbort) {
      registerStage(outcome.recordStagePath);
      registerStage(outcome.preparedPath);
    }
    registerStage(stagePathForOutcome(outcome, "outcome"));
    registeredOutcomeNames.add(expectedName);
    if (idempotencyKeys.has(outcome.idempotencyKey)) {
      fail("AGENTMO_APPEND_ONLY_IDEMPOTENCY_CONFLICT");
    }
    idempotencyKeys.add(outcome.idempotencyKey);
    let claim = null;
    if (v2) {
      if (!presentClaimNames.has(expectedName)) fail("AGENTMO_APPEND_ONLY_CLAIM_REQUIRED");
      const claimPathValue = path.join(location.claims, expectedName);
      claim = await readExactClaim(claimPathValue, {
        namespace,
        sequence,
        headRecordDigest,
        headOutcomeDigest,
      });
      registeredClaimNames.add(expectedName);
    }
    if (claimAbort) {
      if (outcome.preparedPath !== `claims/${expectedName}`
        || outcome.preparedStagePath !== null
        || outcome.recordIdentity !== null
        || preparedNames.includes(expectedName)) {
        fail("AGENTMO_APPEND_ONLY_OUTCOME_INVALID");
      }
      assertIdentity(claim.stats, outcome.preparedIdentity);
      if (claim.value.operationId !== outcome.operationId
        || claim.value.idempotencyKey !== outcome.idempotencyKey
        || claim.value.recordDigest !== outcome.recordDigest
        || claim.value.payloadDigest !== outcome.payloadDigest) {
        fail("AGENTMO_APPEND_ONLY_CLAIM_PREPARED_MISMATCH");
      }
    } else if (recordStageAbort) {
      if (outcome.preparedPath !== `claims/${expectedName}`
        || outcome.preparedStagePath !== null
        || preparedNames.includes(expectedName)) {
        fail("AGENTMO_APPEND_ONLY_OUTCOME_INVALID");
      }
      assertIdentity(claim.stats, outcome.preparedIdentity);
      if (claim.value.operationId !== outcome.operationId
        || claim.value.idempotencyKey !== outcome.idempotencyKey
        || claim.value.recordDigest !== outcome.recordDigest
        || claim.value.payloadDigest !== outcome.payloadDigest) {
        fail("AGENTMO_APPEND_ONLY_CLAIM_PREPARED_MISMATCH");
      }
      const recordStage = path.join(location.root, outcome.recordStagePath);
      const recordStageBytes = await readExactFile(recordStage);
      if (digestRawBytes(recordStageBytes) !== outcome.recordDigest) {
        fail("AGENTMO_APPEND_ONLY_RECORD_CHANGED");
      }
      const recordStageIdentity = await inspectSelectedExactFile(recordStage, recordStageBytes, [1n]);
      assertIdentity(recordStageIdentity, outcome.recordIdentity);
      if (presentEntryNames.has(path.basename(outcome.recordPath))) {
        fail("AGENTMO_APPEND_ONLY_ABORTED_RECORD_LINK_CHANGED");
      }
    } else if (preparedStageAbort) {
      if (outcome.preparedPath !== stagePathV2(outcome.operationId, "prepared")
        || outcome.preparedStagePath !== null
        || outcome.recordIdentity !== null
        || preparedNames.includes(expectedName)) {
        fail("AGENTMO_APPEND_ONLY_OUTCOME_INVALID");
      }
      const preparedStage = path.join(location.root, outcome.preparedPath);
      const preparedBytes = await readExactFile(preparedStage);
      const prepared = parseJson(preparedBytes, "AGENTMO_APPEND_ONLY_PREPARED_INVALID");
      validatePrepared(prepared, { namespace, sequence, headRecordDigest, headOutcomeDigest });
      if (prepared.schemaVersion !== PREPARED_SCHEMA_VERSION_V2
        || prepared.recordDigest !== outcome.recordDigest
        || prepared.operationId !== outcome.operationId
        || prepared.idempotencyKey !== outcome.idempotencyKey) {
        fail("AGENTMO_APPEND_ONLY_PREPARED_OUTCOME_MISMATCH");
      }
      const preparedIdentity = await inspectSelectedExactFile(preparedStage, preparedBytes, [1n]);
      assertIdentity(preparedIdentity, outcome.preparedIdentity);
      assertClaimMatchesPrepared(claim.value, prepared);
      assertIdentity(claim.stats, prepared.claimIdentity);
      const recordStage = path.join(location.root, outcome.recordStagePath);
      const recordStageBytes = await readExactFile(recordStage);
      if (digestRawBytes(recordStageBytes) !== outcome.recordDigest) {
        fail("AGENTMO_APPEND_ONLY_RECORD_CHANGED");
      }
      await inspectSelectedExactFile(recordStage, recordStageBytes, [1n]);
      if (presentEntryNames.has(path.basename(outcome.recordPath))) {
        fail("AGENTMO_APPEND_ONLY_ABORTED_RECORD_LINK_CHANGED");
      }
    } else {
      if (!preparedNames.includes(expectedName)) fail("AGENTMO_APPEND_ONLY_SEQUENCE_GAP");
      const preparedPath = path.join(location.root, outcome.preparedPath);
      const preparedStage = path.join(location.root, outcome.preparedStagePath);
      const preparedBytes = await readExactFile(preparedPath);
      const prepared = parseJson(preparedBytes, "AGENTMO_APPEND_ONLY_PREPARED_INVALID");
      validatePrepared(prepared, { namespace, sequence, headRecordDigest, headOutcomeDigest });
      if (v2 !== (prepared.schemaVersion === PREPARED_SCHEMA_VERSION_V2)) {
        fail("AGENTMO_APPEND_ONLY_PREPARED_OUTCOME_MISMATCH");
      }
      if (prepared.recordDigest !== outcome.recordDigest
        || prepared.operationId !== outcome.operationId
        || prepared.idempotencyKey !== outcome.idempotencyKey) {
        fail("AGENTMO_APPEND_ONLY_PREPARED_OUTCOME_MISMATCH");
      }
      const preparedIdentity = await inspectLinkedPair(preparedStage, preparedPath, preparedBytes);
      assertIdentity(preparedIdentity, outcome.preparedIdentity);
      if (v2) {
        assertClaimMatchesPrepared(claim.value, prepared);
        assertIdentity(claim.stats, prepared.claimIdentity);
      }
    }

    if (outcome.outcome === "committed") {
      const recordPath = path.join(location.root, outcome.recordPath);
      const recordStage = path.join(location.root, outcome.recordStagePath);
      const recordBytes = await readExactFile(recordPath);
      if (digestRawBytes(recordBytes) !== outcome.recordDigest) fail("AGENTMO_APPEND_ONLY_RECORD_CHANGED");
      const recordIdentity = await inspectLinkedPair(recordStage, recordPath, recordBytes);
      assertIdentity(recordIdentity, outcome.recordIdentity);
      const envelope = parseJson(recordBytes, "AGENTMO_APPEND_ONLY_RECORD_INVALID");
      validateEnvelope(envelope, {
        namespace,
        sequence,
        headRecordDigest,
        headOutcomeDigest,
        recordDigest: outcome.recordDigest,
        payloadDigest: outcome.payloadDigest,
        idempotencyKey: outcome.idempotencyKey,
      });
      records.push(Object.freeze({
        sequence,
        digest: outcome.recordDigest,
        path: outcome.recordPath,
        idempotencyKey: outcome.idempotencyKey,
        payloadDigest: outcome.payloadDigest,
        payload: envelope.payload,
        identity: identityOf(recordIdentity),
      }));
      registeredEntryNames.add(path.basename(outcome.recordPath));
      headRecordDigest = outcome.recordDigest;
    } else if (claimAbort) {
      if (presentEntryNames.has(path.basename(outcome.recordStagePath))
        || presentEntryNames.has(path.basename(outcome.recordPath))) {
        fail("AGENTMO_APPEND_ONLY_ABORTED_RECORD_LINK_CHANGED");
      }
      aborted.push(Object.freeze({
        sequence,
        recordDigest: outcome.recordDigest,
        reason: outcome.reason,
        idempotencyKey: outcome.idempotencyKey,
        payloadDigest: outcome.payloadDigest,
      }));
    } else if (recordStageAbort) {
      const recordStage = path.join(location.root, outcome.recordStagePath);
      const recordStageBytes = await readExactFile(recordStage);
      if (digestRawBytes(recordStageBytes) !== outcome.recordDigest) {
        fail("AGENTMO_APPEND_ONLY_RECORD_CHANGED");
      }
      const recordStageIdentity = await inspectSelectedExactFile(recordStage, recordStageBytes, [1n]);
      assertIdentity(recordStageIdentity, outcome.recordIdentity);
      if (presentEntryNames.has(path.basename(outcome.recordPath))) {
        fail("AGENTMO_APPEND_ONLY_ABORTED_RECORD_LINK_CHANGED");
      }
      aborted.push(Object.freeze({
        sequence,
        recordDigest: outcome.recordDigest,
        reason: outcome.reason,
        idempotencyKey: outcome.idempotencyKey,
        payloadDigest: outcome.payloadDigest,
      }));
    } else if (preparedStageAbort) {
      const preparedStage = path.join(location.root, outcome.preparedPath);
      const preparedBytes = await readExactFile(preparedStage);
      const preparedIdentity = await inspectSelectedExactFile(preparedStage, preparedBytes, [1n]);
      assertIdentity(preparedIdentity, outcome.preparedIdentity);
      if (preparedNames.includes(expectedName)
        || presentEntryNames.has(path.basename(outcome.recordPath))) {
        fail("AGENTMO_APPEND_ONLY_ABORTED_RECORD_LINK_CHANGED");
      }
      aborted.push(Object.freeze({
        sequence,
        recordDigest: outcome.recordDigest,
        reason: outcome.reason,
        idempotencyKey: outcome.idempotencyKey,
        payloadDigest: outcome.payloadDigest,
      }));
    } else {
      const recordStage = path.join(location.root, outcome.recordStagePath);
      const recordStageBytes = await readExactFile(recordStage);
      if (digestRawBytes(recordStageBytes) !== outcome.recordDigest) fail("AGENTMO_APPEND_ONLY_RECORD_CHANGED");
      const recordFinal = path.join(location.root, outcome.recordPath);
      const inspection = await inspectOptionalLinkedRecord(recordStage, recordFinal, recordStageBytes);
      if (outcome.recordIdentity === null) {
        if (inspection !== null) fail("AGENTMO_APPEND_ONLY_ABORTED_RECORD_LINK_CHANGED");
      } else {
        if (inspection === null) fail("AGENTMO_APPEND_ONLY_ABORTED_RECORD_LINK_CHANGED");
        assertIdentity(inspection, outcome.recordIdentity);
        registeredEntryNames.add(path.basename(outcome.recordPath));
      }
      aborted.push(Object.freeze({
        sequence,
        recordDigest: outcome.recordDigest,
        reason: outcome.reason,
        idempotencyKey: outcome.idempotencyKey,
        payloadDigest: outcome.payloadDigest,
      }));
    }
    const outcomeStage = path.join(location.root, stagePathForOutcome(outcome, "outcome"));
    await inspectLinkedPair(outcomeStage, outcomePath, outcomeBytes);
    headOutcomeDigest = digestRawBytes(outcomeBytes);
  }

  const nextSequence = outcomeNames.length;
  const nextName = sequenceFile(nextSequence);
  let recoveryRequired = null;
  if (presentClaimNames.has(nextName)) {
    const claimPathValue = path.join(location.claims, nextName);
    const claim = await readExactClaim(claimPathValue, {
      namespace,
      sequence: nextSequence,
      headRecordDigest,
      headOutcomeDigest,
    });
    registeredClaimNames.add(nextName);
    const names = namesForV2(nextSequence, claim.value.operationId, claim.value.recordDigest);
    const recordStageName = path.basename(names.recordStage);
    const recordFinalName = path.basename(names.record);
    const preparedStageName = path.basename(names.preparedStage);
    const outcomeStageName = path.basename(names.outcomeStage);
    const recordSelectionName = `${recordStageName}.selection`;
    const preparedSelectionName = `${preparedStageName}.selection`;
    let recordBytes = null;
    let recordInspection = null;
    let incompleteRecordStage = null;
    let recordSelection = null;
    if (presentEntryNames.has(recordSelectionName)) {
      recordSelection = await readOutcomeSelection(
        `${path.join(location.root, names.recordStage)}.selection`,
      );
      registeredEntryNames.add(recordSelectionName);
      incompleteRecordStage = incompleteSelectedFile(recordSelection);
    }
    if (presentEntryNames.has(recordStageName)) {
      const recordStage = path.join(location.root, names.recordStage);
      const candidate = await readStagedOutcomeCandidate(
        recordStage,
        recordSelection,
        "AGENTMO_APPEND_ONLY_RECORD_INVALID",
      );
      registeredEntryNames.add(recordStageName);
      if (candidate.value === null) {
        incompleteRecordStage = candidate.incomplete;
      } else {
        recordBytes = candidate.bytes;
        if (digestRawBytes(recordBytes) !== claim.value.recordDigest) {
          fail("AGENTMO_APPEND_ONLY_RECORD_CHANGED");
        }
        await inspectSelectedExactFile(recordStage, recordBytes, [1n, 2n]);
        incompleteRecordStage = null;
        if (presentEntryNames.has(recordFinalName)) {
          recordInspection = await inspectLinkedPair(
            recordStage,
            path.join(location.root, names.record),
            recordBytes,
          );
          registeredEntryNames.add(recordFinalName);
        }
      }
    } else if (presentEntryNames.has(recordFinalName)) {
      fail("AGENTMO_APPEND_ONLY_RECORD_CHANGED");
    }

    let preparedBytes = null;
    let incompletePreparedStage = null;
    let preparedSelection = null;
    if (presentPreparedNames.has(preparedSelectionName)) {
      preparedSelection = await readOutcomeSelection(
        `${path.join(location.root, names.preparedStage)}.selection`,
      );
      registeredPreparedNames.add(preparedSelectionName);
      incompletePreparedStage = incompleteSelectedFile(preparedSelection);
    }
    if (presentPreparedNames.has(preparedStageName)) {
      const preparedStage = path.join(location.root, names.preparedStage);
      registeredPreparedNames.add(preparedStageName);
      const candidate = await readStagedOutcomeCandidate(
        preparedStage,
        preparedSelection,
        "AGENTMO_APPEND_ONLY_PREPARED_INVALID",
      );
      if (candidate.value === null) {
        incompletePreparedStage = candidate.incomplete;
      } else {
        preparedBytes = candidate.bytes;
        const prepared = candidate.value;
        validatePrepared(prepared, {
          namespace,
          sequence: nextSequence,
          headRecordDigest,
          headOutcomeDigest,
        });
        assertClaimMatchesPrepared(claim.value, prepared);
        assertIdentity(claim.stats, prepared.claimIdentity);
        await inspectSelectedExactFile(preparedStage, preparedBytes, [1n, 2n]);
        incompletePreparedStage = null;
        if (preparedNames.includes(nextName)) {
          await inspectLinkedPair(
            preparedStage,
            path.join(location.prepared, nextName),
            preparedBytes,
          );
          registeredPreparedNames.add(nextName);
        }
      }
    } else if (preparedNames.includes(nextName)) {
      fail("AGENTMO_APPEND_ONLY_PREPARED_INVALID");
    }

    let stagedOutcome = null;
    let incompleteStagedOutcome = null;
    let outcomeSelection = null;
    const outcomeSelectionName = path.basename(names.outcomeSelection);
    if (presentOutcomeNames.has(outcomeSelectionName)) {
      outcomeSelection = await readOutcomeSelection(
        path.join(location.root, names.outcomeSelection),
      );
      registeredOutcomeNames.add(outcomeSelectionName);
      incompleteStagedOutcome = incompleteSelectedFile(outcomeSelection);
    }
    if (presentOutcomeNames.has(outcomeStageName)) {
      const outcomeStage = path.join(location.root, names.outcomeStage);
      const candidate = await readStagedOutcomeCandidate(outcomeStage, outcomeSelection);
      registeredOutcomeNames.add(outcomeStageName);
      if (candidate.value === null) {
        incompleteStagedOutcome = candidate.incomplete;
      } else {
        const outcome = candidate.value;
        const outcomeBytes = candidate.bytes;
        validateOutcome(outcome, {
          namespace,
          sequence: nextSequence,
          headRecordDigest,
          headOutcomeDigest,
        });
        assertCanonicalOutcomeBytes(outcome, outcomeBytes, namespace);
        if (outcomeSelection !== null) {
          await readOutcomeSelection(
            path.join(location.root, names.outcomeSelection),
            outcomeBytes,
          );
        }
        if (outcome.operationId !== claim.value.operationId
          || outcome.idempotencyKey !== claim.value.idempotencyKey
          || outcome.recordDigest !== claim.value.recordDigest
          || outcome.payloadDigest !== claim.value.payloadDigest) {
          fail("AGENTMO_APPEND_ONLY_PREPARED_OUTCOME_MISMATCH");
        }
        await assertStagedV2OutcomeAdmission({
          location,
          namespace,
          sequence: nextSequence,
          headRecordDigest,
          headOutcomeDigest,
          claim,
          names,
          recordBytes,
          preparedBytes,
          preparedLinked: preparedNames.includes(nextName),
          outcome,
        });
        await inspectSelectedExactFile(outcomeStage, outcomeBytes, [1n]);
        incompleteStagedOutcome = null;
        stagedOutcome = Object.freeze({ value: outcome, bytes: outcomeBytes });
      }
    }
    recoveryRequired = Object.freeze({
      ...claim.value,
      claimPath: names.claim,
      claimIdentity: identityOf(claim.stats),
      preparedPath: names.prepared,
      preparedStagePath: names.preparedStage,
      preparedBytes,
      recordPath: names.record,
      recordStagePath: names.recordStage,
      recordLinked: recordInspection !== null,
      recordStagePresent: recordBytes !== null,
      incompleteRecordStage,
      incompletePreparedStage,
      outcomeSelection,
      incompleteStagedOutcome,
      stagedOutcome,
    });
  } else if (preparedNames.includes(nextName)) {
    const preparedPath = path.join(location.prepared, nextName);
    const preparedBytes = await readExactFile(preparedPath);
    const prepared = parseJson(preparedBytes, "AGENTMO_APPEND_ONLY_PREPARED_INVALID");
    validatePrepared(prepared, {
      namespace,
      sequence: nextSequence,
      headRecordDigest,
      headOutcomeDigest,
    });
    if (prepared.schemaVersion !== PREPARED_SCHEMA_VERSION) {
      fail("AGENTMO_APPEND_ONLY_CLAIM_REQUIRED");
    }
    const preparedStage = path.join(location.root, stagePathV1(prepared.operationId, "prepared"));
    await inspectLinkedPair(preparedStage, preparedPath, preparedBytes);
    for (const legacyStagePath of [
      stagePathV1(prepared.operationId, "record"),
      stagePathV1(prepared.operationId, "prepared"),
    ]) {
      registeredStageNames.add(path.basename(legacyStagePath));
      const selectionName = path.basename(selectionPathForStagePath(legacyStagePath));
      if (presentStageNames.has(selectionName)) {
        registeredStageNames.add(selectionName);
      }
    }
    registeredPreparedNames.add(nextName);
    const recordStage = path.join(location.root, prepared.recordStagePath);
    const recordBytes = await readExactFile(recordStage);
    if (digestRawBytes(recordBytes) !== prepared.recordDigest) fail("AGENTMO_APPEND_ONLY_RECORD_CHANGED");
    const recordFinal = path.join(location.root, prepared.recordPath);
    const recordInspection = await inspectOptionalLinkedRecord(recordStage, recordFinal, recordBytes);
    if (recordInspection !== null) registeredEntryNames.add(path.basename(prepared.recordPath));
    const outcomeStagePath = stagePathV1(prepared.operationId, "outcome");
    const outcomeStageName = path.basename(outcomeStagePath);
    let stagedOutcome = null;
    if (presentStageNames.has(outcomeStageName)) {
      const outcomeStage = path.join(location.root, outcomeStagePath);
      const outcomeBytes = await readExactFile(outcomeStage);
      const outcome = parseJson(outcomeBytes, "AGENTMO_APPEND_ONLY_OUTCOME_INVALID");
      validateOutcome(outcome, {
        namespace,
        sequence: nextSequence,
        headRecordDigest,
        headOutcomeDigest,
      });
      assertCanonicalOutcomeBytes(outcome, outcomeBytes, namespace);
      if (outcome.operationId !== prepared.operationId
        || outcome.idempotencyKey !== prepared.idempotencyKey
        || outcome.recordDigest !== prepared.recordDigest
        || outcome.payloadDigest !== prepared.payloadDigest) {
        fail("AGENTMO_APPEND_ONLY_PREPARED_OUTCOME_MISMATCH");
      }
      const preparedIdentity = await inspectLinkedPair(preparedStage, preparedPath, preparedBytes);
      assertIdentity(preparedIdentity, outcome.preparedIdentity);
      if (recordInspection === null) {
        if (outcome.recordIdentity !== null) {
          fail("AGENTMO_APPEND_ONLY_ABORTED_RECORD_LINK_CHANGED");
        }
      } else {
        if (outcome.recordIdentity === null) {
          fail("AGENTMO_APPEND_ONLY_ABORTED_RECORD_LINK_CHANGED");
        }
        assertIdentity(recordInspection, outcome.recordIdentity);
      }
      await inspectSelectedExactFile(outcomeStage, outcomeBytes, [1n]);
      registeredStageNames.add(outcomeStageName);
      const outcomeSelectionName = path.basename(selectionPathForStagePath(outcomeStagePath));
      if (presentStageNames.has(outcomeSelectionName)) {
        registeredStageNames.add(outcomeSelectionName);
      }
      stagedOutcome = Object.freeze({ value: outcome, bytes: outcomeBytes });
    }
    recoveryRequired = Object.freeze({
      ...prepared,
      preparedPath: `prepared/${nextName}`,
      preparedStagePath: stagePathV1(prepared.operationId, "prepared"),
      preparedBytes,
      recordLinked: recordInspection !== null,
      stagedOutcome,
    });
  }
  if (preparedNames.some((name) => Number.parseInt(name, 10) > nextSequence)) {
    fail("AGENTMO_APPEND_ONLY_SEQUENCE_GAP");
  }
  if (!sameNameSet(presentEntryNames, registeredEntryNames)) {
    fail("AGENTMO_APPEND_ONLY_UNREGISTERED_RECORD_ENTRY");
  }
  if (!sameNameSet(presentStageNames, registeredStageNames)) {
    fail("AGENTMO_APPEND_ONLY_UNREGISTERED_STAGE_ENTRY");
  }
  if (!sameNameSet(presentPreparedNames, registeredPreparedNames)) {
    fail("AGENTMO_APPEND_ONLY_UNREGISTERED_PREPARED_ENTRY");
  }
  if (!sameNameSet(presentOutcomeNames, registeredOutcomeNames)) {
    fail("AGENTMO_APPEND_ONLY_UNREGISTERED_AUTHORITY_ENTRY");
  }
  if (!sameNameSet(presentClaimNames, registeredClaimNames)) {
    fail("AGENTMO_APPEND_ONLY_UNREGISTERED_CLAIM_ENTRY");
  }

  await assertStore(location);
  return Object.freeze({
    schemaVersion: AUTHORITY_SCHEMA_VERSION,
    namespace,
    status: records.length === 0 ? "empty" : "committed",
    records: Object.freeze(records),
    aborted: Object.freeze(aborted),
    headRecordDigest,
    headOutcomeDigest,
    headDigest: combinedHeadDigest(headRecordDigest, headOutcomeDigest),
    nextSequence,
    recoveryRequired,
  });
}

async function resolveStore(options, create) {
  const namespace = admitNamespace(options.namespace);
  if (typeof options.projectRoot !== "string" || options.projectRoot.length === 0) {
    fail("AGENTMO_APPEND_ONLY_PROJECT_ROOT_INVALID");
  }
  const components = admitRelativeRoot(options.relativeRoot);
  const relativeRoot = components.join("/");
  let projectRoot;
  try {
    projectRoot = await realpath(options.projectRoot);
  } catch {
    fail("AGENTMO_APPEND_ONLY_PROJECT_ROOT_INVALID");
  }
  const projectStats = await lstat(projectRoot, { bigint: true }).catch(() => null);
  if (!projectStats?.isDirectory() || projectStats.isSymbolicLink()) {
    fail("AGENTMO_APPEND_ONLY_PROJECT_ROOT_INVALID");
  }
  const directoryAuthorities = [];
  try {
    const projectAuthority = await acquireDirectoryAuthority(projectRoot, false, {
      expectedIdentity: directoryIdentity(projectStats),
    });
    directoryAuthorities.push(projectAuthority);
    let lineageAuthority = await retainStoreDirectory(
      projectAuthority,
      LINEAGE_ANCHOR_DIRECTORY,
      true,
      false,
    );
    if (lineageAuthority !== null) directoryAuthorities.push(lineageAuthority);
    let provisionAuthority = await retainStoreDirectory(
      projectAuthority,
      LINEAGE_PROVISION_DIRECTORY,
      true,
      false,
    );
    if (provisionAuthority !== null) directoryAuthorities.push(provisionAuthority);
    let witnessAuthority = await retainStoreDirectory(
      projectAuthority,
      ROOT_WITNESS_DIRECTORY,
      true,
      false,
    );
    if (witnessAuthority !== null) directoryAuthorities.push(witnessAuthority);
    let lineage = lineageAuthority === null
      ? null
      : await readAuthorityLineageAnchor(
        lineageAuthority,
        namespace,
        relativeRoot,
        projectAuthority.identity,
      );
    let provision = provisionAuthority === null
      ? null
      : await readAuthorityLineageProvision(
        provisionAuthority,
        namespace,
        relativeRoot,
        projectAuthority.identity,
      );
    let witness = witnessAuthority === null
      ? null
      : await readAuthorityRootWitness(
        witnessAuthority,
        namespace,
        relativeRoot,
        projectAuthority.identity,
      );
    const evidence = () => [lineage, provision, witness];
    const evidencePresent = () => evidence().some((item) => item !== null);
    const evidenceComplete = (item) => item !== null && item.value !== null;
    const allEvidenceComplete = () => evidence().every(evidenceComplete);
    if (lineage === null && (provision !== null || witness !== null)) {
      fail("AGENTMO_APPEND_ONLY_LINEAGE_ANCHOR_MISSING");
    }
    if (provision === null && witness !== null) {
      fail("AGENTMO_APPEND_ONLY_LINEAGE_PROVISION_MISSING");
    }
    if (evidenceComplete(lineage) && evidenceComplete(provision)) {
      assertAuthorityLineageProvision(lineage, provision);
    }
    if (allEvidenceComplete()) {
      assertAuthorityRootWitness(lineage, provision, witness);
    }
    if (!create && evidencePresent() && !allEvidenceComplete()) {
      if (lineage === null) {
        fail("AGENTMO_APPEND_ONLY_LINEAGE_ANCHOR_MISSING");
      }
      if (!evidenceComplete(lineage)) {
        fail("AGENTMO_APPEND_ONLY_LINEAGE_ANCHOR_INCOMPLETE");
      }
      if (provision === null) {
        fail("AGENTMO_APPEND_ONLY_LINEAGE_PROVISION_MISSING");
      }
      if (!evidenceComplete(provision)) {
        fail("AGENTMO_APPEND_ONLY_LINEAGE_PROVISION_INCOMPLETE");
      }
      if (witness === null) fail("AGENTMO_APPEND_ONLY_ROOT_WITNESS_MISSING");
      fail("AGENTMO_APPEND_ONLY_ROOT_WITNESS_INCOMPLETE");
    }
    const mayCreateStore = create && !evidencePresent();
    let storeAuthority = projectAuthority;
    for (const [index, component] of components.entries()) {
      const childAuthority = await retainStoreDirectory(
        storeAuthority,
        component,
        index === components.length - 1,
        mayCreateStore,
      );
      if (childAuthority === null) {
        if (evidencePresent()) {
          fail("AGENTMO_APPEND_ONLY_LINEAGE_ROOT_MISSING");
        }
        await closeDirectoryAuthorities(directoryAuthorities);
        return null;
      }
      directoryAuthorities.push(childAuthority);
      storeAuthority = childAuthority;
    }
    const creatingLineage = !evidencePresent();
    const repairingEvidence = create && evidencePresent() && !allEvidenceComplete();
    if (creatingLineage && !create) {
      fail("AGENTMO_APPEND_ONLY_LINEAGE_ANCHOR_MISSING");
    }
    if (creatingLineage || repairingEvidence) {
      const rootEntries = await readRetainedDirectoryEntries(storeAuthority);
      if (rootEntries.some((name) => ![
        "claims",
        "entries",
        "outcomes",
        "prepared",
        "stages",
      ].includes(name))) {
        fail("AGENTMO_APPEND_ONLY_LAYOUT_INCOMPLETE");
      }
    } else if (evidenceComplete(lineage)) {
      assertAuthorityLineageRoot(lineage.value, storeAuthority.identity);
    }
    for (const name of ["entries", "outcomes", "prepared", "stages"]) {
      const childAuthority = await retainStoreDirectory(
        storeAuthority,
        name,
        true,
        creatingLineage,
      );
      if (childAuthority === null) {
        fail("AGENTMO_APPEND_ONLY_LAYOUT_INCOMPLETE");
      }
      directoryAuthorities.push(childAuthority);
      if ((creatingLineage || repairingEvidence)
        && (await readRetainedDirectoryEntries(childAuthority)).length !== 0) {
        fail("AGENTMO_APPEND_ONLY_LAYOUT_INCOMPLETE");
      }
    }
    const claimsAuthority = await retainStoreDirectory(
      storeAuthority,
      "claims",
      true,
      creatingLineage,
    );
    if (claimsAuthority === null) fail("AGENTMO_APPEND_ONLY_LAYOUT_INCOMPLETE");
    directoryAuthorities.push(claimsAuthority);
    if ((creatingLineage || repairingEvidence)
      && (await readRetainedDirectoryEntries(claimsAuthority)).length !== 0) {
      fail("AGENTMO_APPEND_ONLY_LAYOUT_INCOMPLETE");
    }
    if (!evidenceComplete(lineage)) {
      if (lineageAuthority === null) {
        lineageAuthority = await retainStoreDirectory(
          projectAuthority,
          LINEAGE_ANCHOR_DIRECTORY,
          true,
          true,
        );
        directoryAuthorities.push(lineageAuthority);
      }
      lineage = await publishAuthorityLineageAnchor(
        lineageAuthority,
        namespace,
        relativeRoot,
        projectAuthority.identity,
        storeAuthority.identity,
        lineage?.incomplete?.identity ?? null,
      );
    }
    if (!evidenceComplete(provision)) {
      if (provisionAuthority === null) {
        provisionAuthority = await retainStoreDirectory(
          projectAuthority,
          LINEAGE_PROVISION_DIRECTORY,
          true,
          true,
        );
        directoryAuthorities.push(provisionAuthority);
      }
      provision = await publishAuthorityLineageProvision(
        provisionAuthority,
        namespace,
        relativeRoot,
        projectAuthority.identity,
        storeAuthority.identity,
        lineage,
        provision?.incomplete?.identity ?? null,
      );
    }
    if (!evidenceComplete(witness)) {
      if (witnessAuthority === null) {
        witnessAuthority = await retainStoreDirectory(
          projectAuthority,
          ROOT_WITNESS_DIRECTORY,
          true,
          true,
        );
        directoryAuthorities.push(witnessAuthority);
      }
      witness = await publishAuthorityRootWitness(
        witnessAuthority,
        namespace,
        relativeRoot,
        projectAuthority.identity,
        storeAuthority.identity,
        lineage,
        provision,
        witness?.incomplete?.identity ?? null,
      );
    }
    assertAuthorityLineageRoot(lineage.value, storeAuthority.identity);
    assertAuthorityLineageProvision(lineage, provision);
    assertAuthorityRootWitness(lineage, provision, witness);
    const authorityByPath = new Map(
      directoryAuthorities.map((authority) => [path.resolve(authority.path), authority]),
    );
    const location = Object.freeze({
      root: storeAuthority.path,
      entries: path.join(storeAuthority.path, "entries"),
      outcomes: path.join(storeAuthority.path, "outcomes"),
      prepared: path.join(storeAuthority.path, "prepared"),
      stages: path.join(storeAuthority.path, "stages"),
      claims: claimsAuthority?.path ?? null,
      lineage: Object.freeze({
        authority: lineageAuthority,
        provisionAuthority,
        witnessAuthority,
        namespace,
        relativeRoot,
        projectIdentity: projectAuthority.identity,
        storeIdentity: storeAuthority.identity,
      }),
      directoryAuthorities: Object.freeze(directoryAuthorities),
      authorityByPath,
    });
    await assertStore(location);
    if (create) await syncRetainedDirectory(location, storeAuthority.path);
    return location;
  } catch (error) {
    await closeDirectoryAuthorities(directoryAuthorities);
    throw error;
  }
}

function assertAppendOnlyPlatform() {
  try {
    assertBuilderPlatform();
  } catch {
    fail("AGENTMO_APPEND_ONLY_PLATFORM_UNSUPPORTED");
  }
}

async function readAuthorityLineageAnchor(
  lineageAuthority,
  namespace,
  relativeRoot,
  projectIdentity,
) {
  const name = lineageAnchorName(namespace, relativeRoot);
  const candidate = await readSelectedAuthorityCandidate(
    lineageAuthority,
    name,
    "AGENTMO_APPEND_ONLY_LINEAGE_ANCHOR_INVALID",
  );
  if (candidate === null || candidate.value === null) return candidate;
  const { bytes, value } = candidate;
  if (!plainObject(value)
    || !exactKeys(value, [
      "authorityRootIdentity",
      "namespace",
      "projectIdentity",
      "relativeRoot",
      "schemaVersion",
    ])
    || value.schemaVersion !== LINEAGE_ANCHOR_SCHEMA_VERSION
    || value.namespace !== namespace
    || value.relativeRoot !== relativeRoot
    || !validDirectoryIdentityModel(value.projectIdentity)
    || !validDirectoryIdentityModel(value.authorityRootIdentity)
    || !sameDirectoryIdentityModel(value.projectIdentity, projectIdentity)
    || !bytes.equals(bytesFor(value, `${namespace}-append-only-lineage-anchor`))) {
    fail("AGENTMO_APPEND_ONLY_LINEAGE_ANCHOR_INVALID");
  }
  return candidate;
}

async function publishAuthorityLineageAnchor(
  lineageAuthority,
  namespace,
  relativeRoot,
  projectIdentity,
  storeIdentity,
  existingIdentity,
) {
  const value = Object.freeze({
    schemaVersion: LINEAGE_ANCHOR_SCHEMA_VERSION,
    namespace,
    relativeRoot,
    projectIdentity,
    authorityRootIdentity: storeIdentity,
  });
  const bytes = bytesFor(value, `${namespace}-append-only-lineage-anchor`);
  await publishSelectedAuthorityFile(
    lineageAuthority,
    lineageAnchorName(namespace, relativeRoot),
    bytes,
    "AGENTMO_APPEND_ONLY_LINEAGE_ANCHOR_WRITE_FAILED",
    existingIdentity,
  );
  const admitted = await readAuthorityLineageAnchor(
    lineageAuthority,
    namespace,
    relativeRoot,
    projectIdentity,
  );
  if (admitted === null) fail("AGENTMO_APPEND_ONLY_LINEAGE_ANCHOR_MISSING");
  assertAuthorityLineageRoot(admitted.value, storeIdentity);
  return admitted;
}

async function publishSelectedAuthorityFile(
  authority,
  name,
  bytes,
  failureCode,
  existingIdentity,
) {
  const selectionName = `${name}.selection`;
  try {
    await assertDirectoryAuthority(authority);
    await runBuilderPosixEffect({
      action: "claim-symlink",
      name: selectionName,
      payload: outcomeSelectionTarget(bytes),
    }, { directoryAuthority: authority });
    await assertDirectoryAuthority(authority);
    await readOutcomeSelection(path.join(authority.path, selectionName), bytes);
    await runBuilderPosixEffect({
      action: "write-selected-file",
      authorizationName: selectionName,
      ...(existingIdentity === null ? {} : { existingIdentity }),
      name,
      payload: bytes.toString("base64"),
    }, { directoryAuthority: authority });
    await assertDirectoryAuthority(authority);
    await readOutcomeSelection(path.join(authority.path, selectionName), bytes);
  } catch (error) {
    if (error instanceof BuilderAppendOnlyAuthorityError) throw error;
    fail(failureCode);
  }
}

async function readAuthorityLineageProvision(
  provisionAuthority,
  namespace,
  relativeRoot,
  projectIdentity,
) {
  const name = lineageAnchorName(namespace, relativeRoot);
  const candidate = await readSelectedAuthorityCandidate(
    provisionAuthority,
    name,
    "AGENTMO_APPEND_ONLY_LINEAGE_PROVISION_INVALID",
  );
  if (candidate === null || candidate.value === null) return candidate;
  const { bytes, value } = candidate;
  if (!plainObject(value)
    || !exactKeys(value, [
      "authorityRootIdentity",
      "lineageAnchorDigest",
      "namespace",
      "projectIdentity",
      "relativeRoot",
      "schemaVersion",
    ])
    || value.schemaVersion !== LINEAGE_PROVISION_SCHEMA_VERSION
    || value.namespace !== namespace
    || value.relativeRoot !== relativeRoot
    || !validDirectoryIdentityModel(value.projectIdentity)
    || !validDirectoryIdentityModel(value.authorityRootIdentity)
    || !DIGEST_PATTERN.test(value.lineageAnchorDigest)
    || !sameDirectoryIdentityModel(value.projectIdentity, projectIdentity)
    || !bytes.equals(bytesFor(value, `${namespace}-append-only-lineage-provision`))) {
    fail("AGENTMO_APPEND_ONLY_LINEAGE_PROVISION_INVALID");
  }
  return candidate;
}

async function publishAuthorityLineageProvision(
  provisionAuthority,
  namespace,
  relativeRoot,
  projectIdentity,
  storeIdentity,
  lineage,
  existingIdentity,
) {
  const value = Object.freeze({
    schemaVersion: LINEAGE_PROVISION_SCHEMA_VERSION,
    namespace,
    relativeRoot,
    projectIdentity,
    authorityRootIdentity: storeIdentity,
    lineageAnchorDigest: digestRawBytes(lineage.bytes),
  });
  const bytes = bytesFor(value, `${namespace}-append-only-lineage-provision`);
  await publishSelectedAuthorityFile(
    provisionAuthority,
    lineageAnchorName(namespace, relativeRoot),
    bytes,
    "AGENTMO_APPEND_ONLY_LINEAGE_PROVISION_WRITE_FAILED",
    existingIdentity,
  );
  const admitted = await readAuthorityLineageProvision(
    provisionAuthority,
    namespace,
    relativeRoot,
    projectIdentity,
  );
  if (admitted === null) fail("AGENTMO_APPEND_ONLY_LINEAGE_PROVISION_MISSING");
  assertAuthorityLineageProvision(lineage, admitted);
  return admitted;
}

async function readAuthorityRootWitness(
  witnessAuthority,
  namespace,
  relativeRoot,
  projectIdentity,
) {
  const candidate = await readSelectedAuthorityCandidate(
    witnessAuthority,
    lineageAnchorName(namespace, relativeRoot),
    "AGENTMO_APPEND_ONLY_ROOT_WITNESS_INVALID",
  );
  if (candidate === null || candidate.value === null) return candidate;
  const { bytes, value } = candidate;
  if (!plainObject(value)
    || !exactKeys(value, [
      "authorityRootIdentity",
      "lineageAnchorDigest",
      "lineageProvisionDigest",
      "namespace",
      "projectIdentity",
      "relativeRoot",
      "schemaVersion",
    ])
    || value.schemaVersion !== ROOT_WITNESS_SCHEMA_VERSION
    || value.namespace !== namespace
    || value.relativeRoot !== relativeRoot
    || !validDirectoryIdentityModel(value.projectIdentity)
    || !validDirectoryIdentityModel(value.authorityRootIdentity)
    || !DIGEST_PATTERN.test(value.lineageAnchorDigest)
    || !DIGEST_PATTERN.test(value.lineageProvisionDigest)
    || !sameDirectoryIdentityModel(value.projectIdentity, projectIdentity)
    || !bytes.equals(bytesFor(value, `${namespace}-append-only-root-witness`))) {
    fail("AGENTMO_APPEND_ONLY_ROOT_WITNESS_INVALID");
  }
  return candidate;
}

async function publishAuthorityRootWitness(
  witnessAuthority,
  namespace,
  relativeRoot,
  projectIdentity,
  storeIdentity,
  lineage,
  provision,
  existingIdentity,
) {
  const value = Object.freeze({
    schemaVersion: ROOT_WITNESS_SCHEMA_VERSION,
    namespace,
    relativeRoot,
    projectIdentity,
    authorityRootIdentity: storeIdentity,
    lineageAnchorDigest: digestRawBytes(lineage.bytes),
    lineageProvisionDigest: digestRawBytes(provision.bytes),
  });
  const bytes = bytesFor(value, `${namespace}-append-only-root-witness`);
  await publishSelectedAuthorityFile(
    witnessAuthority,
    lineageAnchorName(namespace, relativeRoot),
    bytes,
    "AGENTMO_APPEND_ONLY_ROOT_WITNESS_WRITE_FAILED",
    existingIdentity,
  );
  const admitted = await readAuthorityRootWitness(
    witnessAuthority,
    namespace,
    relativeRoot,
    projectIdentity,
  );
  if (admitted === null || admitted.value === null) {
    fail("AGENTMO_APPEND_ONLY_ROOT_WITNESS_MISSING");
  }
  assertAuthorityRootWitness(lineage, provision, admitted);
  return admitted;
}

function assertAuthorityLineageRoot(value, storeIdentity) {
  if (!sameDirectoryIdentityModel(value.authorityRootIdentity, storeIdentity)) {
    fail("AGENTMO_APPEND_ONLY_LINEAGE_ROOT_CHANGED");
  }
}

function assertAuthorityRootWitness(lineage, provision, witness) {
  if (lineage?.value === null || provision?.value === null || witness?.value === null
    || !sameDirectoryIdentityModel(
      lineage.value.authorityRootIdentity,
      witness.value.authorityRootIdentity,
    )
    || !sameDirectoryIdentityModel(
      provision.value.authorityRootIdentity,
      witness.value.authorityRootIdentity,
    )
    || !sameDirectoryIdentityModel(
      lineage.value.projectIdentity,
      witness.value.projectIdentity,
    )
    || lineage.value.namespace !== witness.value.namespace
    || lineage.value.relativeRoot !== witness.value.relativeRoot
    || witness.value.lineageAnchorDigest !== digestRawBytes(lineage.bytes)
    || witness.value.lineageProvisionDigest !== digestRawBytes(provision.bytes)) {
    fail("AGENTMO_APPEND_ONLY_ROOT_WITNESS_INVALID");
  }
}

function assertAuthorityLineageProvision(lineage, provision) {
  if (lineage === null || provision === null
    || !sameDirectoryIdentityModel(
      lineage.value.authorityRootIdentity,
      provision.value.authorityRootIdentity,
    )
    || !sameDirectoryIdentityModel(
      lineage.value.projectIdentity,
      provision.value.projectIdentity,
    )
    || lineage.value.namespace !== provision.value.namespace
    || lineage.value.relativeRoot !== provision.value.relativeRoot
    || provision.value.lineageAnchorDigest !== digestRawBytes(lineage.bytes)) {
    fail("AGENTMO_APPEND_ONLY_LINEAGE_PROVISION_INVALID");
  }
}

function lineageAnchorName(namespace, relativeRoot) {
  const key = bytesFor({
    schemaVersion: LINEAGE_KEY_SCHEMA_VERSION,
    namespace,
    relativeRoot,
  }, `${namespace}-append-only-lineage-key`);
  return `${digestRawBytes(key).slice("sha256:".length)}.json`;
}

async function publishOutcomeStage(
  location,
  stagePathValue,
  selectionPathValue,
  bytes,
  existingIdentity = null,
) {
  if (selectionPathValue === null) {
    await publishStage(location, stagePathValue, bytes, existingIdentity);
    return;
  }
  const selectionPath = path.join(location.root, selectionPathValue);
  if (path.dirname(selectionPath) !== path.dirname(stagePathValue)) {
    fail("AGENTMO_APPEND_ONLY_OUTCOME_SELECTION_INVALID");
  }
  const authority = effectDirectoryAuthority(location, path.dirname(stagePathValue));
  const selectionTarget = outcomeSelectionTarget(bytes);
  try {
    await assertStore(location);
    await runBuilderPosixEffect({
      action: "claim-symlink",
      name: path.basename(selectionPath),
      payload: selectionTarget,
    }, { directoryAuthority: authority });
    await assertStore(location);
  } catch (error) {
    if (error instanceof BuilderAppendOnlyAuthorityError) throw error;
    fail("AGENTMO_APPEND_ONLY_OUTCOME_SELECTION_WRITE_FAILED");
  }
  await readOutcomeSelection(selectionPath, bytes);
  try {
    await assertStore(location);
    await runBuilderPosixEffect({
      action: "write-selected-file",
      authorizationName: path.basename(selectionPath),
      ...(existingIdentity === null ? {} : { existingIdentity }),
      name: path.basename(stagePathValue),
      payload: bytes.toString("base64"),
    }, { directoryAuthority: authority });
  } catch (error) {
    if (error instanceof BuilderAppendOnlyAuthorityError) throw error;
    fail("AGENTMO_APPEND_ONLY_STAGE_WRITE_FAILED");
  }
  await assertStore(location);
  await inspectSelectedExactFile(stagePathValue, bytes, [1n, 2n]);
}

async function publishStage(location, stagePathValue, bytes, existingIdentity = null) {
  const directory = path.dirname(stagePathValue);
  const authority = effectDirectoryAuthority(location, directory);
  const selectionPath = `${stagePathValue}.selection`;
  try {
    await assertStore(location);
    await runBuilderPosixEffect({
      action: "claim-symlink",
      name: path.basename(selectionPath),
      payload: outcomeSelectionTarget(bytes),
    }, { directoryAuthority: authority });
    await assertStore(location);
  } catch (error) {
    if (error instanceof BuilderAppendOnlyAuthorityError) throw error;
    fail("AGENTMO_APPEND_ONLY_STAGE_SELECTION_WRITE_FAILED");
  }
  await readOutcomeSelection(selectionPath, bytes);
  try {
    await assertStore(location);
    await runBuilderPosixEffect({
      action: "write-selected-file",
      authorizationName: path.basename(selectionPath),
      ...(existingIdentity === null ? {} : { existingIdentity }),
      name: path.basename(stagePathValue),
      payload: bytes.toString("base64"),
    }, { directoryAuthority: authority });
  } catch (error) {
    if (error instanceof BuilderAppendOnlyAuthorityError) throw error;
    fail("AGENTMO_APPEND_ONLY_STAGE_WRITE_FAILED");
  }
  await assertStore(location);
  await inspectSelectedExactFile(stagePathValue, bytes, [1n, 2n]);
}

async function publishAbsentLink(location, source, destination, bytes) {
  if (path.dirname(source) !== path.dirname(destination)) {
    fail("AGENTMO_APPEND_ONLY_LINK_DIRECTORY_MISMATCH");
  }
  const authority = effectDirectoryAuthority(location, path.dirname(destination));
  const selectionPath = selectionPathForStagePath(source);
  let sourceAuthority;
  try {
    await readOutcomeSelection(selectionPath, bytes);
    sourceAuthority = await retainExactFile(source, bytes, [1n, 2n]);
    await assertStore(location);
    await readOutcomeSelection(selectionPath, bytes);
    await runBuilderPosixEffect({
      action: "hardlink",
      name: path.basename(destination),
      payload: bytes.toString("base64"),
      sourceIdentity: sourceAuthority.identity,
      sourceName: path.basename(source),
    }, {
      directoryAuthority: authority,
      sourceAuthority,
    });
  } catch (error) {
    if (error instanceof BuilderAppendOnlyAuthorityError) throw error;
    fail("AGENTMO_APPEND_ONLY_LINK_FAILED");
  } finally {
    await sourceAuthority?.handle.close().catch(() => {});
  }
  await assertStore(location);
  await readOutcomeSelection(selectionPath, bytes);
  await inspectLinkedPair(source, destination, bytes);
}

async function publishClaim(location, relativePath, target) {
  if (location.claims === null || path.dirname(relativePath) !== "claims") {
    fail("AGENTMO_APPEND_ONLY_CLAIM_DIRECTORY_REQUIRED");
  }
  const authority = effectDirectoryAuthority(location, location.claims);
  try {
    await assertStore(location);
    await runBuilderPosixEffect({
      action: "claim-symlink",
      name: path.basename(relativePath),
      payload: target,
    }, { directoryAuthority: authority });
  } catch (error) {
    if (error instanceof BuilderAppendOnlyAuthorityError) throw error;
    if (error?.code === "AGENTMO_BUILDER_POSIX_EFFECT_CLAIM_CHANGED") {
      fail("AGENTMO_APPEND_ONLY_SEQUENCE_CLAIM_LOST");
    }
    fail("AGENTMO_APPEND_ONLY_CLAIM_WRITE_FAILED");
  }
  await assertStore(location);
  return inspectExactClaim(path.join(location.root, relativePath), target);
}

function effectDirectoryAuthority(location, directory) {
  const authority = location.authorityByPath.get(path.resolve(directory));
  if (authority === undefined || !authority.managed) {
    fail("AGENTMO_APPEND_ONLY_DIRECTORY_AUTHORITY_REJECTED");
  }
  return authority;
}

async function inspectOptionalLinkedRecord(stagePathValue, finalPath, bytes) {
  const finalStats = await lstat(finalPath, { bigint: true }).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (finalStats === null) {
    await inspectSelectedExactFile(stagePathValue, bytes, [1n]);
    return null;
  }
  return inspectLinkedPair(stagePathValue, finalPath, bytes);
}

async function assertStagedV2OutcomeAdmission({
  location,
  namespace,
  sequence,
  headRecordDigest,
  headOutcomeDigest,
  claim,
  names,
  recordBytes,
  preparedBytes,
  preparedLinked,
  outcome,
}) {
  const claimAbort = outcome.schemaVersion === CLAIM_ABORT_OUTCOME_SCHEMA_VERSION;
  const recordStageAbort = outcome.schemaVersion === RECORD_STAGE_ABORT_OUTCOME_SCHEMA_VERSION;
  const preparedStageAbort = outcome.schemaVersion === PREPARED_STAGE_ABORT_OUTCOME_SCHEMA_VERSION;
  const recordStage = path.join(location.root, names.recordStage);
  const recordFinal = path.join(location.root, names.record);
  const preparedStage = path.join(location.root, names.preparedStage);
  const preparedFinal = path.join(location.root, names.prepared);
  if (stagePathForOutcome(outcome, "outcome") !== names.outcomeStage
    || outcome.operationId !== claim.value.operationId
    || outcome.idempotencyKey !== claim.value.idempotencyKey
    || outcome.recordDigest !== claim.value.recordDigest
    || outcome.payloadDigest !== claim.value.payloadDigest) {
    fail("AGENTMO_APPEND_ONLY_PREPARED_OUTCOME_MISMATCH");
  }
  if (claimAbort) {
    if (preparedBytes !== null || preparedLinked || recordBytes !== null) {
      fail("AGENTMO_APPEND_ONLY_OUTCOME_INVALID");
    }
    assertIdentity(claim.stats, outcome.preparedIdentity);
    return;
  }
  if (recordStageAbort) {
    if (preparedBytes !== null || preparedLinked || recordBytes === null) {
      fail("AGENTMO_APPEND_ONLY_OUTCOME_INVALID");
    }
    assertIdentity(claim.stats, outcome.preparedIdentity);
    const recordInspection = await inspectOptionalLinkedRecord(recordStage, recordFinal, recordBytes);
    if (recordInspection !== null) fail("AGENTMO_APPEND_ONLY_ABORTED_RECORD_LINK_CHANGED");
    const recordStageIdentity = await inspectSelectedExactFile(recordStage, recordBytes, [1n]);
    assertIdentity(recordStageIdentity, outcome.recordIdentity);
    return;
  }
  if (preparedStageAbort) {
    if (preparedBytes === null || preparedLinked || recordBytes === null) {
      fail("AGENTMO_APPEND_ONLY_OUTCOME_INVALID");
    }
    const prepared = parseJson(preparedBytes, "AGENTMO_APPEND_ONLY_PREPARED_INVALID");
    validatePrepared(prepared, { namespace, sequence, headRecordDigest, headOutcomeDigest });
    if (prepared.schemaVersion !== PREPARED_SCHEMA_VERSION_V2
      || prepared.recordDigest !== outcome.recordDigest
      || prepared.operationId !== outcome.operationId
      || prepared.idempotencyKey !== outcome.idempotencyKey) {
      fail("AGENTMO_APPEND_ONLY_PREPARED_OUTCOME_MISMATCH");
    }
    assertClaimMatchesPrepared(claim.value, prepared);
    assertIdentity(claim.stats, prepared.claimIdentity);
    const preparedIdentity = await inspectSelectedExactFile(preparedStage, preparedBytes, [1n]);
    assertIdentity(preparedIdentity, outcome.preparedIdentity);
    const recordStageIdentity = await inspectSelectedExactFile(recordStage, recordBytes, [1n]);
    assertPreparedRecordStageIdentity(recordStageIdentity, prepared.recordStageIdentity);
    const recordInspection = await inspectOptionalLinkedRecord(recordStage, recordFinal, recordBytes);
    if (recordInspection !== null) fail("AGENTMO_APPEND_ONLY_ABORTED_RECORD_LINK_CHANGED");
    return;
  }
  if (preparedBytes === null || !preparedLinked || recordBytes === null) {
    fail("AGENTMO_APPEND_ONLY_OUTCOME_INVALID");
  }
  const prepared = parseJson(preparedBytes, "AGENTMO_APPEND_ONLY_PREPARED_INVALID");
  validatePrepared(prepared, { namespace, sequence, headRecordDigest, headOutcomeDigest });
  if (prepared.schemaVersion !== PREPARED_SCHEMA_VERSION_V2
    || prepared.recordDigest !== outcome.recordDigest
    || prepared.operationId !== outcome.operationId
    || prepared.idempotencyKey !== outcome.idempotencyKey) {
    fail("AGENTMO_APPEND_ONLY_PREPARED_OUTCOME_MISMATCH");
  }
  assertClaimMatchesPrepared(claim.value, prepared);
  assertIdentity(claim.stats, prepared.claimIdentity);
  const preparedIdentity = await inspectLinkedPair(preparedStage, preparedFinal, preparedBytes);
  assertIdentity(preparedIdentity, outcome.preparedIdentity);
  const recordStageIdentity = await inspectSelectedExactFile(recordStage, recordBytes, [1n, 2n]);
  assertPreparedRecordStageIdentity(recordStageIdentity, prepared.recordStageIdentity);
  const recordInspection = await inspectOptionalLinkedRecord(recordStage, recordFinal, recordBytes);
  if (outcome.outcome === "committed") {
    if (recordInspection === null) fail("AGENTMO_APPEND_ONLY_RECORD_CHANGED");
    assertIdentity(recordInspection, outcome.recordIdentity);
    const envelope = parseJson(recordBytes, "AGENTMO_APPEND_ONLY_RECORD_INVALID");
    validateEnvelope(envelope, {
      namespace,
      sequence,
      headRecordDigest,
      headOutcomeDigest,
      recordDigest: outcome.recordDigest,
      payloadDigest: outcome.payloadDigest,
      idempotencyKey: outcome.idempotencyKey,
    });
  } else if (outcome.recordIdentity === null) {
    if (recordInspection !== null) fail("AGENTMO_APPEND_ONLY_ABORTED_RECORD_LINK_CHANGED");
  } else {
    if (recordInspection === null) fail("AGENTMO_APPEND_ONLY_ABORTED_RECORD_LINK_CHANGED");
    assertIdentity(recordInspection, outcome.recordIdentity);
  }
}

async function inspectLinkedPair(stagePathValue, finalPath, bytes) {
  await inspectStageSelection(stagePathValue, bytes);
  const stageStats = await inspectExactFile(stagePathValue, bytes, [2n]);
  const finalStats = await inspectExactFile(finalPath, bytes, [2n]);
  await inspectStageSelection(stagePathValue, bytes);
  if (!sameIdentity(stageStats, finalStats)) fail("AGENTMO_APPEND_ONLY_LINK_IDENTITY_CHANGED");
  return finalStats;
}

async function inspectSelectedExactFile(filePath, bytes, expectedLinks) {
  await inspectStageSelection(filePath, bytes);
  const stats = await inspectExactFile(filePath, bytes, expectedLinks);
  await inspectStageSelection(filePath, bytes);
  return stats;
}

async function inspectStageSelection(stagePathValue, bytes) {
  const selectionPath = selectionPathForStagePath(stagePathValue);
  if (path.basename(path.dirname(stagePathValue)) !== "stages") {
    return readOutcomeSelection(selectionPath, bytes);
  }
  const selection = await readOptionalOutcomeSelection(selectionPath);
  if (selection !== null) await readOutcomeSelection(selectionPath, bytes);
  return selection;
}

async function inspectExactClaim(claimPath, expectedTarget) {
  try {
    const before = await lstat(claimPath, { bigint: true });
    const target = await readlink(claimPath, "utf8");
    const after = await lstat(claimPath, { bigint: true });
    if (!before.isSymbolicLink()
      || before.nlink !== 1n
      || before.uid !== BigInt(process.getuid())
      || before.size > 1024n
      || target !== expectedTarget
      || !sameIdentity(before, after)
      || before.size !== after.size
      || before.mtimeNs !== after.mtimeNs
      || before.ctimeNs !== after.ctimeNs) {
      fail("AGENTMO_APPEND_ONLY_CLAIM_CHANGED");
    }
    return after;
  } catch (error) {
    if (error instanceof BuilderAppendOnlyAuthorityError) throw error;
    fail("AGENTMO_APPEND_ONLY_CLAIM_READ_FAILED");
  }
}

async function readExactClaim(claimPath, expected) {
  let target;
  try {
    target = await readlink(claimPath, "utf8");
  } catch {
    fail("AGENTMO_APPEND_ONLY_CLAIM_READ_FAILED");
  }
  const stats = await inspectExactClaim(claimPath, target);
  return Object.freeze({
    target,
    stats,
    value: decodeClaimTarget(target, expected),
  });
}

async function readOutcomeSelection(selectionPath, expectedBytes = null) {
  try {
    const target = await readlink(selectionPath, "utf8");
    const stats = await inspectExactClaim(selectionPath, target);
    const match = OUTCOME_SELECTION_TARGET_PATTERN.exec(target);
    const length = match === null ? 0 : Number.parseInt(match[2], 10);
    if (match === null
      || !Number.isSafeInteger(length)
      || length <= 0
      || length > MAX_AUTHORITY_BYTES
      || (expectedBytes !== null
        && (expectedBytes.length !== length
          || outcomeSelectionTarget(expectedBytes) !== target))) {
      fail("AGENTMO_APPEND_ONLY_OUTCOME_SELECTION_INVALID");
    }
    return Object.freeze({
      target,
      digest: `sha256:${match[1]}`,
      length,
      identity: identityOf(stats),
    });
  } catch (error) {
    if (error?.code === "AGENTMO_APPEND_ONLY_OUTCOME_SELECTION_INVALID") throw error;
    fail("AGENTMO_APPEND_ONLY_OUTCOME_SELECTION_INVALID");
  }
}

async function readOptionalOutcomeSelection(selectionPath) {
  const stats = await lstat(selectionPath, { bigint: true }).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (stats === null) return null;
  return readOutcomeSelection(selectionPath);
}

async function readSelectedAuthorityCandidate(authority, name, invalidCode) {
  await assertDirectoryAuthority(authority);
  const filePath = path.join(authority.path, name);
  const selection = await readOptionalOutcomeSelection(`${filePath}.selection`);
  const fileStats = await lstat(filePath, { bigint: true }).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  await assertDirectoryAuthority(authority);
  if (fileStats === null) {
    return selection === null
      ? null
      : Object.freeze({
          bytes: null,
          incomplete: incompleteSelectedFile(selection),
          selection,
          value: null,
        });
  }
  if (selection === null) fail("AGENTMO_APPEND_ONLY_FILE_SELECTION_MISSING");
  const bytes = await readExactFile(filePath);
  if (bytes.length < selection.length) {
    const stats = await inspectExactFile(filePath, bytes, [1n]);
    return Object.freeze({
      bytes,
      incomplete: incompleteSelectedFile(selection, bytes, stats),
      selection,
      value: null,
    });
  }
  if (bytes.length !== selection.length) fail(invalidCode);
  await readOutcomeSelection(`${filePath}.selection`, bytes);
  await inspectExactFile(filePath, bytes, [1n]);
  await assertDirectoryAuthority(authority);
  return Object.freeze({
    bytes,
    incomplete: null,
    selection,
    value: parseJson(bytes, invalidCode),
  });
}

async function readStagedOutcomeCandidate(
  outcomeStage,
  selection,
  invalidCode = "AGENTMO_APPEND_ONLY_OUTCOME_INVALID",
) {
  const bytes = await readExactFile(outcomeStage);
  if (selection !== null && bytes.length < selection.length) {
    const stats = await inspectExactFile(outcomeStage, bytes, [1n]);
    return Object.freeze({
      bytes,
      incomplete: incompleteSelectedFile(selection, bytes, stats),
      value: null,
    });
  }
  try {
    return Object.freeze({
      bytes,
      incomplete: null,
      value: parseJson(bytes, invalidCode),
    });
  } catch (error) {
    if (error?.code !== invalidCode
      || selection === null
      || bytes.length >= selection.length) {
      throw error;
    }
    throw error;
  }
}

function incompleteSelectedFile(selection, bytes = null, stats = null) {
  return Object.freeze({
    bytes,
    identity: stats === null ? null : identityOf(stats),
    selectedDigest: selection.digest,
    selectedLength: selection.length,
  });
}

async function inspectExactFile(filePath, expectedBytes, expectedLinks) {
  const authority = await retainExactFile(filePath, expectedBytes, expectedLinks);
  try {
    return await authority.handle.stat({ bigint: true });
  } finally {
    await authority.handle.close().catch(() => {});
  }
}

async function retainExactFile(filePath, expectedBytes, expectedLinks) {
  let handle;
  try {
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.isSymbolicLink()
      || !expectedLinks.includes(before.nlink)
      || (before.mode & 0o077n) !== 0n
      || before.size > BigInt(MAX_AUTHORITY_BYTES)) {
      fail("AGENTMO_APPEND_ONLY_FILE_IDENTITY_INVALID");
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (!sameIdentity(before, after)
      || before.size !== after.size
      || before.mtimeNs !== after.mtimeNs
      || before.ctimeNs !== after.ctimeNs
      || !bytes.equals(expectedBytes)) {
      fail("AGENTMO_APPEND_ONLY_FILE_CHANGED");
    }
    return Object.freeze({
      handle,
      identity: identityOf(after),
    });
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error instanceof BuilderAppendOnlyAuthorityError) throw error;
    fail("AGENTMO_APPEND_ONLY_FILE_READ_FAILED");
  }
}

async function readExactFile(filePath) {
  let handle;
  try {
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(MAX_AUTHORITY_BYTES)) {
      fail("AGENTMO_APPEND_ONLY_FILE_IDENTITY_INVALID");
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (!sameIdentity(before, after)
      || before.size !== after.size
      || before.mtimeNs !== after.mtimeNs
      || before.ctimeNs !== after.ctimeNs) {
      fail("AGENTMO_APPEND_ONLY_FILE_CHANGED");
    }
    return bytes;
  } catch (error) {
    if (error instanceof BuilderAppendOnlyAuthorityError) throw error;
    fail("AGENTMO_APPEND_ONLY_FILE_READ_FAILED");
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function retainStoreDirectory(parentAuthority, name, managed, create) {
  const childPath = path.join(parentAuthority.path, name);
  const expectedIdentity = await inspectRetainedDirectoryChild(parentAuthority, name, managed);
  if (expectedIdentity !== null) {
    return acquireDirectoryAuthority(childPath, managed, {
      parentAuthority,
      name,
      expectedIdentity,
    });
  }
  if (!create) return null;
  let effect;
  try {
    effect = await runBuilderPosixEffect({
      action: "mkdir",
      name,
      payload: "",
    }, { directoryAuthority: parentAuthority });
  } catch (error) {
    if (error?.code === "AGENTMO_BUILDER_POSIX_EFFECT_DIRECTORY_CHANGED"
      || error?.code === "AGENTMO_BUILDER_POSIX_EFFECT_CHILD_FAILED") {
      fail("AGENTMO_APPEND_ONLY_DIRECTORY_AUTHORITY_REJECTED");
    }
    fail("AGENTMO_APPEND_ONLY_DIRECTORY_CREATE_FAILED");
  }
  return acquireDirectoryAuthority(childPath, managed, {
    parentAuthority,
    name,
    expectedIdentity: effect.identity,
  });
}

async function inspectRetainedDirectoryChild(parentAuthority, name, managed) {
  await assertDirectoryAuthority(parentAuthority);
  let stats;
  try {
    stats = await lstat(path.join(parentAuthority.path, name), { bigint: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    stats = null;
  }
  await assertDirectoryAuthority(parentAuthority);
  if (stats === null) return null;
  assertSafeDirectoryStat(stats, managed);
  return directoryIdentity(stats);
}

async function readRetainedDirectoryEntries(authority) {
  await assertDirectoryAuthority(authority);
  const entries = await readdir(authority.path);
  await assertDirectoryAuthority(authority);
  return entries;
}

async function acquireDirectoryAuthority(directoryPath, managed, {
  parentAuthority = null,
  name = null,
  expectedIdentity = null,
} = {}) {
  let handle;
  try {
    const resolvedPath = path.resolve(directoryPath);
    if (parentAuthority !== null) {
      if (typeof name !== "string"
        || name.length === 0
        || path.resolve(parentAuthority.path, name) !== resolvedPath) {
        fail("AGENTMO_APPEND_ONLY_DIRECTORY_AUTHORITY_REJECTED");
      }
      await assertDirectoryAuthority(parentAuthority);
    }
    const before = await lstat(directoryPath, { bigint: true });
    assertSafeDirectoryStat(before, managed);
    if (expectedIdentity !== null
      && !sameDirectoryIdentityModel(expectedIdentity, directoryIdentity(before))) {
      fail("AGENTMO_APPEND_ONLY_DIRECTORY_IDENTITY_CHANGED");
    }
    handle = await open(
      directoryPath,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const held = await handle.stat({ bigint: true });
    const after = await lstat(directoryPath, { bigint: true });
    assertSafeDirectoryStat(held, managed);
    assertSafeDirectoryStat(after, managed);
    if (!sameDirectoryIdentityModel(directoryIdentity(before), directoryIdentity(held))
      || !sameDirectoryIdentityModel(directoryIdentity(held), directoryIdentity(after))
      || (expectedIdentity !== null
        && !sameDirectoryIdentityModel(expectedIdentity, directoryIdentity(held)))) {
      fail("AGENTMO_APPEND_ONLY_DIRECTORY_IDENTITY_CHANGED");
    }
    return Object.freeze({
      path: resolvedPath,
      managed,
      handle,
      identity: directoryIdentity(held),
      parentAuthority,
      name,
    });
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error instanceof BuilderAppendOnlyAuthorityError) throw error;
    fail("AGENTMO_APPEND_ONLY_DIRECTORY_AUTHORITY_REJECTED");
  }
}

async function assertDirectoryAuthority(authority) {
  try {
    if (authority.parentAuthority !== null) {
      await assertDirectoryAuthority(authority.parentAuthority);
    }
    const held = await authority.handle.stat({ bigint: true });
    const current = await lstat(authority.path, { bigint: true });
    assertSafeDirectoryStat(held, authority.managed);
    assertSafeDirectoryStat(current, authority.managed);
    if (!sameDirectoryIdentityModel(authority.identity, directoryIdentity(held))
      || !sameDirectoryIdentity(held, current)
      || !sameDirectoryMetadata(held, current)) {
      fail("AGENTMO_APPEND_ONLY_DIRECTORY_IDENTITY_CHANGED");
    }
    if (authority.parentAuthority !== null) {
      const attached = await lstat(
        path.join(authority.parentAuthority.path, authority.name),
        { bigint: true },
      );
      assertSafeDirectoryStat(attached, authority.managed);
      if (!sameDirectoryIdentity(held, attached)
        || !sameDirectoryMetadata(held, attached)) {
        fail("AGENTMO_APPEND_ONLY_DIRECTORY_IDENTITY_CHANGED");
      }
      await assertDirectoryAuthority(authority.parentAuthority);
    }
  } catch (error) {
    if (error instanceof BuilderAppendOnlyAuthorityError) throw error;
    fail("AGENTMO_APPEND_ONLY_DIRECTORY_AUTHORITY_REJECTED");
  }
}

async function assertStore(location) {
  for (const authority of location.directoryAuthorities) {
    await assertDirectoryAuthority(authority);
  }
  const lineage = await readAuthorityLineageAnchor(
    location.lineage.authority,
    location.lineage.namespace,
    location.lineage.relativeRoot,
    location.lineage.projectIdentity,
  );
  if (lineage === null || lineage.value === null) {
    fail("AGENTMO_APPEND_ONLY_LINEAGE_ANCHOR_MISSING");
  }
  const provision = await readAuthorityLineageProvision(
    location.lineage.provisionAuthority,
    location.lineage.namespace,
    location.lineage.relativeRoot,
    location.lineage.projectIdentity,
  );
  if (provision === null || provision.value === null) {
    fail("AGENTMO_APPEND_ONLY_LINEAGE_PROVISION_MISSING");
  }
  const witness = await readAuthorityRootWitness(
    location.lineage.witnessAuthority,
    location.lineage.namespace,
    location.lineage.relativeRoot,
    location.lineage.projectIdentity,
  );
  if (witness === null || witness.value === null) {
    fail("AGENTMO_APPEND_ONLY_ROOT_WITNESS_MISSING");
  }
  assertAuthorityLineageRoot(lineage.value, location.lineage.storeIdentity);
  assertAuthorityLineageProvision(lineage, provision);
  assertAuthorityRootWitness(lineage, provision, witness);
}

async function closeStore(location) {
  await closeDirectoryAuthorities(location.directoryAuthorities);
}

async function closeDirectoryAuthorities(authorities) {
  await Promise.all(
    [...authorities].reverse().map(
      (authority) => authority.handle.close().catch(() => {}),
    ),
  );
}

async function readDirectoryEntries(location, directory) {
  await assertStore(location);
  const entries = await readdir(directory, { withFileTypes: true });
  await assertStore(location);
  return entries;
}

async function syncRetainedDirectory(location, directory) {
  const authority = location.authorityByPath.get(path.resolve(directory));
  if (authority === undefined) fail("AGENTMO_APPEND_ONLY_DIRECTORY_AUTHORITY_REJECTED");
  await assertDirectoryAuthority(authority);
  try {
    await authority.handle.sync();
  } catch {
    fail("AGENTMO_APPEND_ONLY_DIRECTORY_SYNC_FAILED");
  }
  await assertDirectoryAuthority(authority);
}

function assertSafeDirectoryStat(stats, managed) {
  const mode = stats?.mode & 0o777n;
  if (!stats?.isDirectory?.()
    || stats.isSymbolicLink?.()
    || stats.uid !== BigInt(process.getuid())
    || (managed ? mode !== BigInt(DIRECTORY_MODE) : (mode & 0o022n) !== 0n)) {
    fail("AGENTMO_APPEND_ONLY_DIRECTORY_METADATA_INVALID");
  }
}

function directoryIdentity(stats) {
  return Object.freeze({
    device: stats.dev.toString(10),
    inode: stats.ino.toString(10),
    uid: stats.uid.toString(10),
    gid: stats.gid.toString(10),
    mode: (stats.mode & 0o777n).toString(8),
  });
}

function validDirectoryIdentityModel(value) {
  return plainObject(value)
    && exactKeys(value, ["device", "gid", "inode", "mode", "uid"])
    && ["device", "gid", "inode", "uid"].every((key) => /^\d+$/u.test(value[key] ?? ""))
    && /^[0-7]{3,4}$/u.test(value.mode ?? "");
}

function sameDirectoryIdentityModel(left, right) {
  return left.device === right.device
    && left.inode === right.inode
    && left.uid === right.uid
    && left.gid === right.gid
    && left.mode === right.mode;
}

function sameDirectoryIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameDirectoryMetadata(left, right) {
  return left.uid === right.uid
    && left.gid === right.gid
    && (left.mode & 0o777n) === (right.mode & 0o777n);
}

function validateEnvelope(value, expected) {
  if (!plainObject(value)
    || value.schemaVersion !== AUTHORITY_SCHEMA_VERSION
    || value.namespace !== expected.namespace
    || value.sequence !== expected.sequence
    || value.idempotencyKey !== expected.idempotencyKey
    || value.predecessorRecordDigest !== expected.headRecordDigest
    || value.predecessorOutcomeDigest !== expected.headOutcomeDigest
    || value.payloadDigest !== expected.payloadDigest) {
    fail("AGENTMO_APPEND_ONLY_RECORD_INVALID");
  }
  const payloadDigest = digestRawBytes(Buffer.from(serializePersistableJson(value.payload, {
    subject: `${expected.namespace}-append-only-payload`,
  }), "utf8"));
  if (payloadDigest !== expected.payloadDigest) fail("AGENTMO_APPEND_ONLY_RECORD_INVALID");
}

function validatePrepared(value, expected) {
  if (!plainObject(value)
    || ![PREPARED_SCHEMA_VERSION, PREPARED_SCHEMA_VERSION_V2].includes(value.schemaVersion)
    || value.namespace !== expected.namespace
    || value.sequence !== expected.sequence
    || value.predecessorRecordDigest !== expected.headRecordDigest
    || value.predecessorOutcomeDigest !== expected.headOutcomeDigest
    || !/^[a-f0-9]{64}$/u.test(value.operationId ?? "")
    || !IDEMPOTENCY_PATTERN.test(value.idempotencyKey ?? "")
    || !DIGEST_PATTERN.test(value.recordDigest ?? "")
    || !DIGEST_PATTERN.test(value.payloadDigest ?? "")
    || value.recordPath !== recordPath(value.sequence, value.recordDigest)
    || !validIdentity(value.recordStageIdentity)
    || (value.schemaVersion === PREPARED_SCHEMA_VERSION
      && value.recordStagePath !== stagePathV1(value.operationId, "record"))
    || (value.schemaVersion === PREPARED_SCHEMA_VERSION_V2
      && (value.recordStagePath !== stagePathV2(value.operationId, "record")
        || value.claimPath !== `claims/${sequenceFile(value.sequence)}`
        || !validIdentity(value.claimIdentity)))) {
    fail("AGENTMO_APPEND_ONLY_PREPARED_INVALID");
  }
}

function validateOutcome(value, expected) {
  if (!plainObject(value)
    || ![
      OUTCOME_SCHEMA_VERSION,
      OUTCOME_SCHEMA_VERSION_V2,
      CLAIM_ABORT_OUTCOME_SCHEMA_VERSION,
      RECORD_STAGE_ABORT_OUTCOME_SCHEMA_VERSION,
      PREPARED_STAGE_ABORT_OUTCOME_SCHEMA_VERSION,
    ].includes(value.schemaVersion)
    || value.namespace !== expected.namespace
    || value.sequence !== expected.sequence
    || value.predecessorRecordDigest !== expected.headRecordDigest
    || value.predecessorOutcomeDigest !== expected.headOutcomeDigest
    || !["committed", "aborted"].includes(value.outcome)
    || !/^[a-f0-9]{64}$/u.test(value.operationId ?? "")
    || !IDEMPOTENCY_PATTERN.test(value.idempotencyKey ?? "")
    || !DIGEST_PATTERN.test(value.recordDigest ?? "")
    || !DIGEST_PATTERN.test(value.payloadDigest ?? "")
    || value.recordPath !== recordPath(value.sequence, value.recordDigest)
    || (value.schemaVersion === OUTCOME_SCHEMA_VERSION
      && (value.preparedPath !== `prepared/${sequenceFile(value.sequence)}`
        || value.preparedStagePath !== stagePathV1(value.operationId, "prepared")
        || value.recordStagePath !== stagePathV1(value.operationId, "record")))
    || (value.schemaVersion === OUTCOME_SCHEMA_VERSION_V2
      && (value.preparedPath !== `prepared/${sequenceFile(value.sequence)}`
        || value.preparedStagePath !== stagePathV2(value.operationId, "prepared")
        || value.recordStagePath !== stagePathV2(value.operationId, "record")))
    || (value.schemaVersion === CLAIM_ABORT_OUTCOME_SCHEMA_VERSION
      && (value.outcome !== "aborted"
        || value.preparedPath !== `claims/${sequenceFile(value.sequence)}`
        || value.preparedStagePath !== null
        || value.recordStagePath !== stagePathV2(value.operationId, "record")
        || value.recordIdentity !== null))
    || (value.schemaVersion === RECORD_STAGE_ABORT_OUTCOME_SCHEMA_VERSION
      && (value.outcome !== "aborted"
        || value.preparedPath !== `claims/${sequenceFile(value.sequence)}`
        || value.preparedStagePath !== null
        || value.recordStagePath !== stagePathV2(value.operationId, "record")
        || !validIdentity(value.recordIdentity)))
    || (value.schemaVersion === PREPARED_STAGE_ABORT_OUTCOME_SCHEMA_VERSION
      && (value.outcome !== "aborted"
        || value.preparedPath !== stagePathV2(value.operationId, "prepared")
        || value.preparedStagePath !== null
        || value.recordStagePath !== stagePathV2(value.operationId, "record")
        || value.recordIdentity !== null))
    || !validIdentity(value.preparedIdentity)
    || (value.outcome === "committed" && !validIdentity(value.recordIdentity))
    || (value.outcome === "aborted" && (typeof value.reason !== "string"
      || !/^[A-Z][A-Z0-9_]{0,127}$/u.test(value.reason)
      || (value.recordIdentity !== null && !validIdentity(value.recordIdentity))))) {
    fail("AGENTMO_APPEND_ONLY_OUTCOME_INVALID");
  }
}

function assertCanonicalOutcomeBytes(value, bytes, namespace) {
  if (!bytes.equals(bytesFor(value, `${namespace}-append-only-outcome-canonical`))) {
    fail("AGENTMO_APPEND_ONLY_OUTCOME_INVALID");
  }
}

function resultForRecord(state, record, changed) {
  return Object.freeze({
    status: "committed",
    changed,
    sequence: record.sequence,
    digest: record.digest,
    path: record.path,
    identity: record.identity,
    payload: record.payload,
    headRecordDigest: state.headRecordDigest,
    headOutcomeDigest: state.headOutcomeDigest,
    headDigest: state.headDigest,
  });
}

function resultForAbort(state, record, changed) {
  return Object.freeze({
    status: "aborted",
    changed,
    sequence: record.sequence,
    recordDigest: record.recordDigest,
    reason: record.reason,
    idempotencyKey: record.idempotencyKey,
    payloadDigest: record.payloadDigest,
    headRecordDigest: state.headRecordDigest,
    headOutcomeDigest: state.headOutcomeDigest,
    headDigest: state.headDigest,
  });
}

function namesFor(sequence, operationId, recordDigest) {
  return namesForV2(sequence, operationId, recordDigest);
}

function namesForV1(sequence, operationId, recordDigest) {
  const outcomeStage = stagePathV1(operationId, "outcome");
  return Object.freeze({
    recordStage: stagePathV1(operationId, "record"),
    preparedStage: stagePathV1(operationId, "prepared"),
    outcomeStage,
    outcomeSelection: `${outcomeStage}.selection`,
    prepared: `prepared/${sequenceFile(sequence)}`,
    outcome: `outcomes/${sequenceFile(sequence)}`,
    record: recordPath(sequence, recordDigest),
  });
}

function namesForV2(sequence, operationId, recordDigest) {
  return Object.freeze({
    claim: `claims/${sequenceFile(sequence)}`,
    recordStage: stagePathV2(operationId, "record"),
    preparedStage: stagePathV2(operationId, "prepared"),
    outcomeStage: stagePathV2(operationId, "outcome"),
    outcomeSelection: `outcomes/${operationId}.outcome.selection`,
    prepared: `prepared/${sequenceFile(sequence)}`,
    outcome: `outcomes/${sequenceFile(sequence)}`,
    record: recordPath(sequence, recordDigest),
  });
}

function recordPath(sequence, digest) {
  return `entries/${String(sequence).padStart(16, "0")}.${digest.slice("sha256:".length)}.json`;
}

function sequenceFile(sequence) {
  if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > 9_999_999_999_999_999) {
    fail("AGENTMO_APPEND_ONLY_SEQUENCE_INVALID");
  }
  return `${String(sequence).padStart(16, "0")}.json`;
}

function stagePathV1(operationId, kind) {
  return `stages/${operationId}.${kind}.json`;
}

function stagePathV2(operationId, kind) {
  const directory = kind === "record" ? "entries" : kind === "prepared" ? "prepared" : "outcomes";
  return `${directory}/${operationId}.${kind}.stage.json`;
}

function stagePathForOutcome(outcome, kind) {
  return [
    OUTCOME_SCHEMA_VERSION_V2,
    CLAIM_ABORT_OUTCOME_SCHEMA_VERSION,
    RECORD_STAGE_ABORT_OUTCOME_SCHEMA_VERSION,
    PREPARED_STAGE_ABORT_OUTCOME_SCHEMA_VERSION,
  ]
    .includes(outcome.schemaVersion)
    ? stagePathV2(outcome.operationId, kind)
    : stagePathV1(outcome.operationId, kind);
}

function selectionPathForStagePath(stagePathValue) {
  const name = path.basename(stagePathValue);
  if (path.dirname(stagePathValue).endsWith("outcomes")
    && name.endsWith(".outcome.stage.json")) {
    return path.join(
      path.dirname(stagePathValue),
      name.replace(/\.stage\.json$/u, ".selection"),
    );
  }
  return `${stagePathValue}.selection`;
}

function outcomeSelectionTarget(bytes) {
  return [
    "am-selected-file-v1",
    digestRawBytes(bytes).slice("sha256:".length),
    String(bytes.length),
  ].join(".");
}

function encodeClaimTarget(claim) {
  const key = Buffer.from(claim.idempotencyKey, "utf8").toString("base64url");
  const target = [
    "am-claim-v2",
    claim.operationId,
    claim.recordDigest.slice("sha256:".length),
    claim.payloadDigest.slice("sha256:".length),
    key,
  ].join(".");
  if (Buffer.byteLength(target, "utf8") > 1024) {
    fail("AGENTMO_APPEND_ONLY_CLAIM_INVALID");
  }
  return target;
}

function decodeClaimTarget(target, expected) {
  if (typeof target !== "string" || Buffer.byteLength(target, "utf8") > 1024) {
    fail("AGENTMO_APPEND_ONLY_CLAIM_INVALID");
  }
  const parts = target.split(".");
  if (parts.length !== 5
    || parts[0] !== "am-claim-v2"
    || !/^[a-f0-9]{64}$/u.test(parts[1] ?? "")
    || !/^[a-f0-9]{64}$/u.test(parts[2] ?? "")
    || !/^[a-f0-9]{64}$/u.test(parts[3] ?? "")
    || !/^[a-zA-Z0-9_-]+$/u.test(parts[4] ?? "")) {
    fail("AGENTMO_APPEND_ONLY_CLAIM_INVALID");
  }
  let idempotencyKey;
  try {
    const keyBytes = Buffer.from(parts[4], "base64url");
    if (keyBytes.toString("base64url") !== parts[4]) fail("AGENTMO_APPEND_ONLY_CLAIM_INVALID");
    idempotencyKey = new TextDecoder("utf-8", { fatal: true }).decode(keyBytes);
  } catch (error) {
    if (error instanceof BuilderAppendOnlyAuthorityError) throw error;
    fail("AGENTMO_APPEND_ONLY_CLAIM_INVALID");
  }
  if (!IDEMPOTENCY_PATTERN.test(idempotencyKey)) fail("AGENTMO_APPEND_ONLY_CLAIM_INVALID");
  const recordDigest = `sha256:${parts[2]}`;
  const payloadDigest = `sha256:${parts[3]}`;
  const operationId = digestRawBytes(Buffer.from([
    expected.namespace,
    String(expected.sequence),
    expected.headRecordDigest,
    expected.headOutcomeDigest,
    idempotencyKey,
    recordDigest,
  ].join("\n"), "utf8")).slice("sha256:".length);
  if (operationId !== parts[1]) fail("AGENTMO_APPEND_ONLY_CLAIM_INVALID");
  return Object.freeze({
    schemaVersion: CLAIM_SCHEMA_VERSION,
    namespace: expected.namespace,
    sequence: expected.sequence,
    operationId,
    idempotencyKey,
    predecessorRecordDigest: expected.headRecordDigest,
    predecessorOutcomeDigest: expected.headOutcomeDigest,
    recordDigest,
    payloadDigest,
  });
}

function assertClaimMatchesPrepared(claim, prepared) {
  if (claim.namespace !== prepared.namespace
    || claim.sequence !== prepared.sequence
    || claim.operationId !== prepared.operationId
    || claim.idempotencyKey !== prepared.idempotencyKey
    || claim.predecessorRecordDigest !== prepared.predecessorRecordDigest
    || claim.predecessorOutcomeDigest !== prepared.predecessorOutcomeDigest
    || claim.recordDigest !== prepared.recordDigest
    || claim.payloadDigest !== prepared.payloadDigest) {
    fail("AGENTMO_APPEND_ONLY_CLAIM_PREPARED_MISMATCH");
  }
}

function identityOf(stats) {
  return Object.freeze({
    device: stats.dev.toString(10),
    inode: stats.ino.toString(10),
    links: stats.nlink.toString(10),
    size: stats.size.toString(10),
  });
}

function validIdentity(value) {
  return plainObject(value)
    && ["device", "inode", "links", "size"].every((key) => /^\d+$/u.test(value[key] ?? ""));
}

function assertIdentity(stats, expected) {
  if (!validIdentity(expected)
    || stats.dev.toString(10) !== expected.device
    || stats.ino.toString(10) !== expected.inode
    || stats.nlink.toString(10) !== expected.links
    || stats.size.toString(10) !== expected.size) {
    fail("AGENTMO_APPEND_ONLY_REGISTERED_IDENTITY_CHANGED");
  }
}

function assertPreparedRecordStageIdentity(stats, expected) {
  if (!validIdentity(expected)
    || expected.links !== "1"
    || stats.dev.toString(10) !== expected.device
    || stats.ino.toString(10) !== expected.inode
    || stats.size.toString(10) !== expected.size) {
    fail("AGENTMO_APPEND_ONLY_REGISTERED_IDENTITY_CHANGED");
  }
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.nlink === right.nlink;
}

function sameNameSet(left, right) {
  return left.size === right.size && [...left].every((name) => right.has(name));
}

function parseJson(bytes, code) {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail(code);
  }
}

function bytesFor(value, subject) {
  assertPersistable(value, { subject });
  return Buffer.from(serializePersistableJson(value, { subject }), "utf8");
}

function assertExpectedHead(state, candidate) {
  if (candidate === undefined) return;
  if (!DIGEST_PATTERN.test(candidate ?? "") || candidate !== state.headDigest) {
    fail("AGENTMO_APPEND_ONLY_HEAD_CHANGED");
  }
}

function combinedHeadDigest(record, outcome) {
  return digestRawBytes(Buffer.from(serializePersistableJson({ record, outcome }, {
    subject: "append-only-authority-head",
  }), "utf8"));
}

function admitNamespace(value) {
  if (typeof value !== "string" || !NAMESPACE_PATTERN.test(value)) {
    fail("AGENTMO_APPEND_ONLY_NAMESPACE_INVALID");
  }
  return value;
}

async function protectedAuthorityRecoveryOnly(namespace, capability) {
  if (namespace === "builder-lifecycle") {
    const { isBuilderLifecycleAuthorityAppendCapability } = await import(
      "./builder-lifecycle.js"
    );
    if (isBuilderLifecycleAuthorityAppendCapability(capability)) return false;
    if (capability === undefined) return true;
    fail("AGENTMO_APPEND_ONLY_AUTHORITY_REJECTED");
  }
  if (capability !== undefined) fail("AGENTMO_APPEND_ONLY_REQUEST_REJECTED");
  return false;
}

function admitIdempotencyKey(value) {
  if (typeof value !== "string" || !IDEMPOTENCY_PATTERN.test(value)) {
    fail("AGENTMO_APPEND_ONLY_IDEMPOTENCY_KEY_INVALID");
  }
  return value;
}

function admitRelativeRoot(value) {
  if (typeof value !== "string"
    || value.length === 0
    || value.includes("\\")
    || path.posix.isAbsolute(value)) {
    fail("AGENTMO_APPEND_ONLY_RELATIVE_ROOT_INVALID");
  }
  const components = value.split("/");
  if ([
    LINEAGE_ANCHOR_DIRECTORY,
    LINEAGE_PROVISION_DIRECTORY,
    ROOT_WITNESS_DIRECTORY,
  ].includes(components[0])
    || components.some((component) => component.length === 0
    || component === "."
    || component === ".."
    || !/^[a-zA-Z0-9._-]+$/u.test(component))) {
    fail("AGENTMO_APPEND_ONLY_RELATIVE_ROOT_INVALID");
  }
  return components;
}

function emptyState(namespaceCandidate) {
  const namespace = admitNamespace(namespaceCandidate);
  return Object.freeze({
    schemaVersion: AUTHORITY_SCHEMA_VERSION,
    namespace,
    status: "empty",
    records: Object.freeze([]),
    aborted: Object.freeze([]),
    headRecordDigest: EMPTY_DIGEST,
    headOutcomeDigest: EMPTY_DIGEST,
    headDigest: combinedHeadDigest(EMPTY_DIGEST, EMPTY_DIGEST),
    nextSequence: 0,
    recoveryRequired: null,
  });
}

function plainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactKeys(value, keys) {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function assertExactOptionKeys(value, required, optional = []) {
  if (!plainObject(value)
    || required.some((key) => !Object.hasOwn(value, key))
    || Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))) {
    fail("AGENTMO_APPEND_ONLY_REQUEST_REJECTED");
  }
}

function fail(code) {
  throw new BuilderAppendOnlyAuthorityError(code);
}
