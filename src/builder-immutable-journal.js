import { constants } from "node:fs";
import {
  lstat,
  open,
  readdir,
} from "node:fs/promises";
import path from "node:path";

import { digestRawBytes } from "./artifact-admission.js";
import { assertBuilderPlatform } from "./builder-platform.js";
import { runBuilderPosixEffect } from "./builder-posix-effect.js";

export const IMMUTABLE_JOURNAL_ENTRY_SCHEMA_VERSION = "agentmo.immutable-journal-entry.v1";
export const IMMUTABLE_JOURNAL_APPEND_RESULT_SCHEMA_VERSION = "agentmo.immutable-journal-append-result.v1";
export const IMMUTABLE_JOURNAL_RECOVERY_SCHEMA_VERSION = "agentmo.immutable-journal-prepared.v2";
export const DEFAULT_MAX_IMMUTABLE_JOURNAL_VALUE_BYTES = 1024 * 1024;
export const DEFAULT_MAX_IMMUTABLE_JOURNAL_ENTRIES = 256;

const OUTCOME_SCHEMA_VERSION = "agentmo.immutable-journal-outcome.v1";
const ADMISSIONS = new WeakSet();
const ADMISSION_DETAILS = new WeakMap();
const PENDING_OUTCOME_LINKS = new Set();
const ACTIVE_OPERATION_IDS = new Set();
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const OPERATION_PATTERN = /^[a-f0-9]{64}$/u;
const ENTRY_KEYS = Object.freeze([
  "schemaVersion",
  "sequence",
  "predecessorDigest",
  "valueDigest",
  "valueBase64",
]);
const PREPARED_KEYS = Object.freeze([
  "schemaVersion",
  "operationId",
  "journalKey",
  "sequence",
  "predecessorDigest",
  "valueDigest",
  "publicationDigest",
  "publicationName",
  "entryStageName",
  "preparedName",
  "parentIdentity",
]);
const OUTCOME_KEYS = Object.freeze([
  "schemaVersion",
  "operationId",
  "journalKey",
  "sequence",
  "predecessorDigest",
  "valueDigest",
  "publicationDigest",
  "publicationName",
  "parentIdentity",
  "prepared",
  "entry",
]);
const INTERNAL_IDENTITY_KEYS = Object.freeze([
  "dev",
  "ino",
  "size",
  "uid",
  "gid",
  "mode",
  "links",
  "mtimeNs",
  "ctimeNs",
]);
const PARENT_IDENTITY_KEYS = Object.freeze(["dev", "ino", "uid", "gid", "mode"]);
const MAX_ENTRY_OVERHEAD_BYTES = 2048;
const MAX_EVIDENCE_BYTES = 32 * 1024;
const FILE_MODE = 0o600;
// A prepared link claims one sequence but never advances the readable chain.
// Entry bytes become authoritative only when a separately synced outcome pair
// binds every immutable name and inode. All evidence remains in place forever.

export class ImmutableJournalError extends Error {
  constructor(code) {
    super("Immutable journal operation was rejected.");
    this.name = "ImmutableJournalError";
    this.code = code;
  }
}

class PreparedClaimLost extends Error {}

export async function appendImmutableJournalEntry(options) {
  assertImmutableJournalPlatform();
  if (!options || typeof options !== "object") invalid();
  // Strip the private UAT capability before any global utility can observe the
  // caller object. The token may travel only in lexical arguments below.
  const hasAuthorityCapability = "authorityCapability" in options;
  const { authorityCapability, ...appendOptions } = options;
  const normalized = normalizeAppendOptions(appendOptions);
  await assertAppendAuthorityForCanonicalUatGenesis(
    normalized,
    hasAuthorityCapability,
    authorityCapability,
  );
  await ensureImmutableJournalParent(normalized.parentPath);
  const parent = await acquireParent(normalized);
  let outcomeLinked = false;
  let pendingOutcomePath = null;
  let desired = null;
  let publication = null;
  let prepared = null;
  let preparedNames = null;
  let activeOperationId = null;
  try {
    const loaded = await loadWithParent(normalized, parent);
    await assertAppendAuthorityForJournalLineage(
      normalized,
      loaded,
      hasAuthorityCapability,
      authorityCapability,
    );
    desired = selectDesiredAppend(normalized, loaded, parent);

    const valueDigest = digestRawBytes(normalized.canonicalBytes);
    publication = desired.sequence === 0
      ? Object.freeze({
          bytes: normalized.canonicalBytes,
          digest: valueDigest,
          name: normalized.basename,
          entryPath: normalized.journalPath,
        })
      : buildSuccessorPublication(
          normalized,
          desired.sequence,
          desired.predecessorDigest,
          valueDigest,
        );
    const operationId = operationIdFor({
      journalKey: parent.key,
      sequence: desired.sequence,
      predecessorDigest: desired.predecessorDigest,
      valueDigest,
      publicationDigest: publication.digest,
    });
    preparedNames = namesForPrepared(normalized, desired.sequence, operationId);
    prepared = deepFreezeRecord({
      schemaVersion: IMMUTABLE_JOURNAL_RECOVERY_SCHEMA_VERSION,
      operationId,
      journalKey: parent.key,
      sequence: desired.sequence,
      predecessorDigest: desired.predecessorDigest,
      valueDigest,
      publicationDigest: publication.digest,
      publicationName: publication.name,
      entryStageName: preparedNames.entryStageName,
      preparedName: preparedNames.preparedName,
      parentIdentity: parentIdentityModel(parent.stat),
    });
    const preparedBytes = serializePrepared(prepared);

    if (loaded.preparedClaim !== null
      && loaded.preparedClaim.record.operationId !== operationId) {
      return appendOutcome("rejected-before-commit", loaded.head, true);
    }
    if (ACTIVE_OPERATION_IDS.has(operationId)) {
      return appendOutcome("rejected-before-commit", loaded.head, true);
    }
    ACTIVE_OPERATION_IDS.add(operationId);
    activeOperationId = operationId;

    await publishImmutableFile(
      path.join(parent.path, preparedNames.preparedStageName),
      preparedBytes,
      parent,
      normalized,
      "prepared_stage",
    );
    try {
      await publishAbsentLink(
        path.join(parent.path, preparedNames.preparedStageName),
        path.join(parent.path, preparedNames.preparedName),
        preparedBytes,
        parent,
        normalized,
        "prepared",
      );
    } catch (error) {
      if (error instanceof PreparedClaimLost) {
        const observed = await loadWithParent(normalized, parent);
        return appendOutcome("rejected-before-commit", observed.head, true);
      }
      throw error;
    }
    await publishImmutableFile(
      path.join(parent.path, preparedNames.entryStageName),
      publication.bytes,
      parent,
      normalized,
      "entry_stage",
    );
    await publishAbsentLink(
      path.join(parent.path, preparedNames.entryStageName),
      publication.entryPath,
      publication.bytes,
      parent,
      normalized,
      "entry",
    );

    const preparedPair = await inspectLinkedPair(
      path.join(parent.path, preparedNames.preparedStageName),
      path.join(parent.path, preparedNames.preparedName),
      preparedBytes,
      MAX_EVIDENCE_BYTES,
    );
    const entryPair = await inspectLinkedPair(
      path.join(parent.path, preparedNames.entryStageName),
      publication.entryPath,
      publication.bytes,
      normalized.maxValueBytes * 2 + MAX_ENTRY_OVERHEAD_BYTES,
    );
    const outcome = deepFreezeRecord({
      schemaVersion: OUTCOME_SCHEMA_VERSION,
      operationId,
      journalKey: parent.key,
      sequence: desired.sequence,
      predecessorDigest: desired.predecessorDigest,
      valueDigest,
      publicationDigest: publication.digest,
      publicationName: publication.name,
      parentIdentity: parentIdentityModel(parent.stat),
      prepared: {
        stageName: preparedNames.preparedStageName,
        finalName: preparedNames.preparedName,
        identity: internalIdentityModel(preparedPair),
      },
      entry: {
        stageName: preparedNames.entryStageName,
        finalName: publication.name,
        identity: internalIdentityModel(entryPair),
      },
    });
    const outcomeBytes = serializeOutcome(outcome);
    const outcomeDigest = digestRawBytes(outcomeBytes);
    const outcomeNames = namesForOutcome(normalized, desired.sequence, operationId, outcomeDigest);
    await publishImmutableFile(
      path.join(parent.path, outcomeNames.outcomeStageName),
      outcomeBytes,
      parent,
      normalized,
      "outcome_stage",
    );
    pendingOutcomePath = path.join(parent.path, outcomeNames.outcomeName);
    PENDING_OUTCOME_LINKS.add(pendingOutcomePath);
    await publishAbsentLink(
      path.join(parent.path, outcomeNames.outcomeStageName),
      pendingOutcomePath,
      outcomeBytes,
      parent,
      normalized,
      "commit",
    );
    outcomeLinked = true;
    PENDING_OUTCOME_LINKS.delete(pendingOutcomePath);
    pendingOutcomePath = null;

    const committed = await loadWithParent(normalized, parent);
    const head = committed.head;
    if (head === null
      || head.sequence !== desired.sequence
      || head.digest !== valueDigest
      || head.publicationDigest !== publication.digest) {
      conflict();
    }

    return appendOutcome("committed-clean", head, false);
  } catch (error) {
    const hadPendingOutcome = pendingOutcomePath !== null;
    if (hadPendingOutcome) {
      PENDING_OUTCOME_LINKS.delete(pendingOutcomePath);
    }
    if ((outcomeLinked || hadPendingOutcome) && desired !== null) {
      try {
        await syncParent(parent);
        const observed = await loadWithParent(normalized, parent);
        if (observed.head?.sequence === desired.sequence
          && observed.head.digest === digestRawBytes(normalized.canonicalBytes)) {
          return appendOutcome("committed-recovery-required", observed.head, true);
        }
      } catch {
        // The exact committed outcome could not be revalidated. Fall through.
      }
    }
    if (error instanceof ImmutableJournalError) throw error;
    try {
      const observed = await loadWithParent(normalized, parent);
      return appendOutcome("rejected-before-commit", observed.head, observed.recoveryRequired);
    } catch {
      conflict();
    }
  } finally {
    if (pendingOutcomePath !== null) PENDING_OUTCOME_LINKS.delete(pendingOutcomePath);
    if (activeOperationId !== null) ACTIVE_OPERATION_IDS.delete(activeOperationId);
    await parent.handle.close().catch(() => {});
  }
}

export async function loadImmutableJournal(options) {
  assertImmutableJournalPlatform();
  const normalized = normalizeLoadOptions(options);
  const parent = await acquireParent(normalized);
  try {
    return publicJournalView(await loadWithParent(normalized, parent));
  } catch (error) {
    if (error instanceof ImmutableJournalError) throw error;
    conflict();
  } finally {
    await parent.handle.close().catch(() => {});
  }
}

export function assertImmutableJournalAdmission(admission) {
  if (!admission || !ADMISSIONS.has(admission)) authorityRejected();
  return admission;
}

export function readImmutableJournalAdmissionBytes(admission) {
  assertImmutableJournalAdmission(admission);
  return Buffer.from(ADMISSION_DETAILS.get(admission).bytes);
}

function normalizeAppendOptions(options) {
  const allowed = [
    "canonicalBytes",
    "expectedPredecessorAdmission",
    "journalPath",
    "maxEntries",
    "maxValueBytes",
  ];
  if (!options || typeof options !== "object" || Array.isArray(options)
    || Object.keys(options).some((key) => !allowed.includes(key))) {
    invalid();
  }
  const normalized = normalizeLoadOptions(options);
  if (!Buffer.isBuffer(options?.canonicalBytes)
    || options.canonicalBytes.length === 0
    || options.canonicalBytes.length > normalized.maxValueBytes) {
    invalid();
  }
  const hasExpected = Object.hasOwn(options, "expectedPredecessorAdmission");
  if (hasExpected) assertImmutableJournalAdmission(options.expectedPredecessorAdmission);
  return Object.freeze({
    ...normalized,
    canonicalBytes: Buffer.from(options.canonicalBytes),
    hasExpected,
    expectedPredecessorAdmission: hasExpected ? options.expectedPredecessorAdmission : null,
  });
}

async function assertAppendAuthorityForCanonicalUatGenesis(
  normalized,
  hasAuthorityCapability,
  authorityCapability,
) {
  if (!isCanonicalCodexUatEntryBytes(normalized.canonicalBytes)) return;
  await assertCanonicalCodexUatAppendCapability(hasAuthorityCapability, authorityCapability);
}

async function assertAppendAuthorityForJournalLineage(
  normalized,
  loaded,
  hasAuthorityCapability,
  authorityCapability,
) {
  if (loaded.entries.some((entry) => isCanonicalCodexUatEntryBytes(
    ADMISSION_DETAILS.get(entry).bytes,
  ))) {
    // Once a canonical UAT entry is committed, every successor is a UAT-lineage
    // mutation. Check this before inspecting the caller's successor bytes so a
    // generic importer cannot poison the canonical UAT loader with arbitrary data.
    await assertCanonicalCodexUatAppendCapability(hasAuthorityCapability, authorityCapability);
    return;
  }
  if (isCanonicalCodexUatEntryBytes(normalized.canonicalBytes)) {
    await assertCanonicalCodexUatAppendCapability(hasAuthorityCapability, authorityCapability);
    return;
  }
  if (hasAuthorityCapability) authorityRejected();
}

async function assertCanonicalCodexUatAppendCapability(
  hasAuthorityCapability,
  authorityCapability,
) {
  if (!hasAuthorityCapability) authorityRejected();
  let isCodexUatJournalAppendCapability;
  try {
    ({ isCodexUatJournalAppendCapability } = await import("./builder-codex-uat.js"));
  } catch {
    authorityRejected();
  }
  if (!isCodexUatJournalAppendCapability(authorityCapability)) {
    authorityRejected();
  }
}

function isCanonicalCodexUatEntryBytes(bytes) {
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return value?.schemaVersion === "agentmo.codex-uat-attempt-journal.v2";
  } catch {
    return false;
  }
}

function normalizeLoadOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) invalid();
  const journalPath = options.journalPath;
  if (typeof journalPath !== "string" || journalPath.length === 0 || journalPath.includes("\0")) invalid();
  const maxValueBytes = options.maxValueBytes ?? DEFAULT_MAX_IMMUTABLE_JOURNAL_VALUE_BYTES;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_IMMUTABLE_JOURNAL_ENTRIES;
  if (!Number.isSafeInteger(maxValueBytes) || maxValueBytes <= 0
    || !Number.isSafeInteger(maxEntries) || maxEntries <= 0 || maxEntries > 4096) {
    invalid();
  }
  const resolved = path.resolve(journalPath);
  const parentPath = path.dirname(resolved);
  const basename = path.basename(resolved);
  const publicationPrefix = `.${basename}.agentmo-journal.`;
  return Object.freeze({
    journalPath: resolved,
    parentPath,
    basename,
    publicationPrefix,
    retainedName: `.${basename}.agentmo-journal-retained`,
    maxValueBytes,
    maxEntries,
  });
}

async function acquireParent(normalized) {
  return acquireRetainedParent(
    normalized.parentPath,
    (stat) => `${stat.dev}:${stat.ino}:${normalized.basename}`,
  );
}

async function ensureImmutableJournalParent(parentPath) {
  const missing = [];
  let cursor = path.resolve(parentPath);
  while (true) {
    try {
      const stats = await lstat(cursor, { bigint: true });
      if (!stats.isDirectory() || stats.isSymbolicLink()) conflict();
      break;
    } catch (error) {
      if (error instanceof ImmutableJournalError) throw error;
      if (error?.code !== "ENOENT") platformUnsupported();
      const next = path.dirname(cursor);
      if (next === cursor) platformUnsupported();
      missing.unshift(path.basename(cursor));
      cursor = next;
    }
  }
  let parent = await acquireRetainedParent(cursor, () => null);
  try {
    for (const name of missing) {
      await runBuilderPosixEffect({
        action: "mkdir",
        name,
        payload: "",
      }, {
        directoryAuthority: effectDirectoryAuthority(parent),
      });
      await assertParent(parent);
      const next = await acquireRetainedParent(path.join(parent.path, name), () => null);
      await parent.handle.close().catch(() => {});
      parent = next;
    }
  } finally {
    await parent.handle.close().catch(() => {});
  }
}

async function acquireRetainedParent(parentPath, keyFor) {
  let handle;
  try {
    const resolved = path.resolve(parentPath);
    const before = await lstat(resolved, { bigint: true });
    assertSafeParentStat(before);
    handle = await open(
      resolved,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const held = await handle.stat({ bigint: true });
    const after = await lstat(resolved, { bigint: true });
    assertSafeParentStat(held);
    assertSafeParentStat(after);
    if (!sameDirectoryIdentity(before, held) || !sameDirectoryIdentity(held, after)) conflict();
    await handle.sync();
    return Object.freeze({
      handle,
      path: resolved,
      stat: held,
      key: keyFor(held),
    });
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error instanceof ImmutableJournalError) throw error;
    platformUnsupported();
  }
}

async function loadWithParent(normalized, parent) {
  await assertParent(parent);
  const directoryEntries = await readdir(parent.path, { withFileTypes: true });
  await assertParent(parent);
  if (directoryEntries.length > normalized.maxEntries * 8 + 256) conflict();
  const scoped = directoryEntries.filter(
    (entry) => entry.name === normalized.basename
      || entry.name === normalized.retainedName
      || entry.name.startsWith(normalized.publicationPrefix),
  );
  for (const entry of scoped) {
    if (!entry.isFile() || entry.isSymbolicLink()) conflict();
  }

  const expressions = nameExpressions(normalized);
  const genesisNames = new Set();
  const publicationNames = new Map();
  const preparedStageNames = new Map();
  const preparedFinalNames = new Map();
  const entryStageNames = new Map();
  const outcomeStageNames = new Map();
  const outcomeFinalNames = new Map();
  for (const { name } of scoped) {
    if (name === normalized.retainedName) conflict();
    if (name === normalized.basename) {
      genesisNames.add(name);
      continue;
    }
    let match;
    if ((match = expressions.publication.exec(name))) {
      insertUnique(publicationNames, name, Object.freeze({
        name,
        sequence: Number.parseInt(match[1], 10),
        digest: `sha256:${match[2]}`,
      }));
    } else if ((match = expressions.preparedStage.exec(name))) {
      insertUnique(preparedStageNames, match[1], name);
    } else if ((match = expressions.preparedFinal.exec(name))) {
      insertUnique(preparedFinalNames, Number.parseInt(match[1], 10), name);
    } else if ((match = expressions.entryStage.exec(name))) {
      insertUnique(entryStageNames, match[1], name);
    } else if ((match = expressions.outcomeStage.exec(name))) {
      insertUnique(outcomeStageNames, match[1], Object.freeze({ name, digest: `sha256:${match[2]}` }));
    } else if ((match = expressions.outcomeFinal.exec(name))) {
      insertUnique(outcomeFinalNames, Number.parseInt(match[1], 10), Object.freeze({
        name,
        digest: `sha256:${match[2]}`,
      }));
    } else {
      conflict();
    }
  }

  const candidates = new Map();
  for (const [operationId, name] of preparedStageNames) {
    const opened = await readBoundedFile(
      path.join(parent.path, name),
      MAX_EVIDENCE_BYTES,
      [1n, 2n],
    );
    const record = parsePrepared(opened.bytes, normalized, parent, operationId);
    candidates.set(operationId, Object.freeze({ name, record, bytes: opened.bytes, stat: opened.stat }));
  }

  const claims = new Map();
  for (const [sequence, name] of preparedFinalNames) {
    const opened = await readBoundedFile(path.join(parent.path, name), MAX_EVIDENCE_BYTES, [2n]);
    const record = parsePrepared(opened.bytes, normalized, parent);
    if (record.sequence !== sequence || record.preparedName !== name) conflict();
    const candidate = candidates.get(record.operationId);
    if (candidate === undefined || !candidate.bytes.equals(opened.bytes)) conflict();
    if (!sameIdentity(candidate.stat, opened.stat)
      || candidate.stat.nlink !== 2n
      || opened.stat.nlink !== 2n) {
      conflict();
    }
    claims.set(sequence, Object.freeze({ record, bytes: opened.bytes, stat: opened.stat, candidate }));
  }
  for (const candidate of candidates.values()) {
    const claimed = claims.get(candidate.record.sequence);
    if (candidate.stat.nlink === 2n
      && (claimed === undefined || claimed.record.operationId !== candidate.record.operationId)) {
      conflict();
    }
  }

  const entriesByOperation = new Map();
  for (const [operationId, name] of entryStageNames) {
    const candidate = candidates.get(operationId);
    const claim = candidate === undefined ? undefined : claims.get(candidate.record.sequence);
    if (claim === undefined || claim.record.operationId !== operationId) conflict();
    const opened = await readBoundedFile(
      path.join(parent.path, name),
      normalized.maxValueBytes * 2 + MAX_ENTRY_OVERHEAD_BYTES,
      [1n, 2n],
    );
    const decoded = decodePublication(normalized, claim.record, opened.bytes);
    entriesByOperation.set(operationId, Object.freeze({ name, ...opened, decoded }));
  }

  const publicationsBySequence = new Map();
  for (const [sequence, claim] of claims) {
    const expectedName = claim.record.publicationName;
    const present = sequence === 0
      ? genesisNames.has(normalized.basename)
      : publicationNames.has(expectedName);
    const stage = entriesByOperation.get(claim.record.operationId);
    if (!present) {
      if (stage?.stat.nlink === 2n) conflict();
      continue;
    }
    if (stage === undefined || stage.stat.nlink !== 2n) conflict();
    const opened = await readBoundedFile(
      path.join(parent.path, expectedName),
      normalized.maxValueBytes * 2 + MAX_ENTRY_OVERHEAD_BYTES,
      [2n],
    );
    if (!sameIdentity(stage.stat, opened.stat) || !stage.bytes.equals(opened.bytes)) conflict();
    publicationsBySequence.set(sequence, Object.freeze({ ...opened, decoded: stage.decoded }));
  }
  for (const publication of publicationNames.values()) {
    const claim = claims.get(publication.sequence);
    if (claim === undefined
      || claim.record.publicationName !== publication.name
      || claim.record.publicationDigest !== publication.digest) {
      conflict();
    }
  }
  if (genesisNames.size > 0 && claims.get(0)?.record.publicationName !== normalized.basename) conflict();

  const outcomeStages = new Map();
  for (const [operationId, descriptor] of outcomeStageNames) {
    const claim = candidates.get(operationId) === undefined
      ? undefined
      : claims.get(candidates.get(operationId).record.sequence);
    const publication = claim === undefined ? undefined : publicationsBySequence.get(claim.record.sequence);
    if (claim === undefined || claim.record.operationId !== operationId || publication === undefined) conflict();
    const opened = await readBoundedFile(path.join(parent.path, descriptor.name), MAX_EVIDENCE_BYTES, [1n, 2n]);
    if (digestRawBytes(opened.bytes) !== descriptor.digest) conflict();
    const outcome = parseOutcome(opened.bytes, normalized, parent, claim, publication);
    if (outcome.operationId !== operationId) conflict();
    outcomeStages.set(operationId, Object.freeze({ descriptor, ...opened, outcome }));
  }

  const outcomes = new Map();
  for (const [sequence, descriptor] of outcomeFinalNames) {
    const claim = claims.get(sequence);
    const stage = claim === undefined ? undefined : outcomeStages.get(claim.record.operationId);
    if (claim === undefined || stage === undefined || stage.descriptor.digest !== descriptor.digest) conflict();
    const expected = namesForOutcome(
      normalized,
      sequence,
      claim.record.operationId,
      descriptor.digest,
    );
    if (descriptor.name !== expected.outcomeName
      || stage.descriptor.name !== expected.outcomeStageName) {
      conflict();
    }
    const opened = await readBoundedFile(path.join(parent.path, descriptor.name), MAX_EVIDENCE_BYTES, [2n]);
    if (!sameIdentity(stage.stat, opened.stat)
      || stage.stat.nlink !== 2n
      || !stage.bytes.equals(opened.bytes)) {
      conflict();
    }
    outcomes.set(sequence, Object.freeze({ descriptor, ...opened, outcome: stage.outcome }));
  }
  for (const [operationId, stage] of outcomeStages) {
    const final = outcomes.get(stage.outcome.sequence);
    if (stage.stat.nlink === 2n
      && (final === undefined || final.outcome.operationId !== operationId)) {
      conflict();
    }
  }

  const records = [];
  let predecessorDigest = null;
  for (let sequence = 0; sequence < normalized.maxEntries; sequence += 1) {
    const claim = claims.get(sequence);
    const publication = publicationsBySequence.get(sequence);
    const outcome = outcomes.get(sequence);
    const outcomePending = outcome !== undefined
      && PENDING_OUTCOME_LINKS.has(path.join(parent.path, outcome.descriptor.name));
    if (outcome === undefined || outcomePending) break;
    if (claim === undefined
      || publication === undefined
      || claim.record.predecessorDigest !== predecessorDigest
      || outcome.outcome.predecessorDigest !== predecessorDigest) {
      conflict();
    }
    records.push(Object.freeze({
      sequence,
      predecessorDigest,
      digest: claim.record.valueDigest,
      publicationDigest: claim.record.publicationDigest,
      bytes: publication.decoded.valueBytes,
      stat: publication.stat,
    }));
    predecessorDigest = claim.record.valueDigest;
  }
  if (records.length > normalized.maxEntries) conflict();
  for (const sequence of claims.keys()) {
    if (sequence > records.length) conflict();
  }
  for (const sequence of outcomes.keys()) {
    if (sequence >= records.length
      && !PENDING_OUTCOME_LINKS.has(path.join(parent.path, outcomes.get(sequence).descriptor.name))) {
      conflict();
    }
  }
  for (const candidate of candidates.values()) {
    if (candidate.record.sequence > records.length) conflict();
    const expectedPredecessor = candidate.record.sequence === 0
      ? null
      : records[candidate.record.sequence - 1]?.digest;
    if (expectedPredecessor === undefined
      || candidate.record.predecessorDigest !== expectedPredecessor) {
      conflict();
    }
  }

  const admissions = records.map((record) => mintAdmission(record, parent));
  const preparedClaim = claims.get(records.length) ?? null;
  const recoveryRequired = preparedClaim !== null
    || [...candidates.values()].some((candidate) => candidate.record.sequence === records.length)
    || [...outcomes.values()].some((outcome) => PENDING_OUTCOME_LINKS.has(
      path.join(parent.path, outcome.descriptor.name),
    ));
  await assertParent(parent);
  return Object.freeze({
    entries: Object.freeze(admissions),
    head: admissions.at(-1) ?? null,
    recoveryRequired,
    preparedClaim,
  });
}

function selectDesiredAppend(normalized, loaded, parent) {
  if (!normalized.hasExpected) {
    if (loaded.entries.length === 0) {
      return Object.freeze({ sequence: 0, predecessorDigest: null });
    }
    conflict();
  }

  const supplied = normalized.expectedPredecessorAdmission;
  const details = ADMISSION_DETAILS.get(supplied);
  if (details?.journalKey !== parent.key) conflict();
  const predecessor = loaded.entries.find((entry) => sameAdmission(entry, supplied));
  if (predecessor === undefined) conflict();
  const sequence = predecessor.sequence + 1;
  const existing = loaded.entries[sequence];
  if (existing !== undefined) {
    conflict();
  }
  if (!sameAdmission(loaded.head, predecessor)) conflict();
  return Object.freeze({ sequence, predecessorDigest: predecessor.digest });
}

function buildSuccessorPublication(normalized, sequence, predecessorDigest, valueDigest) {
  const entry = {
    schemaVersion: IMMUTABLE_JOURNAL_ENTRY_SCHEMA_VERSION,
    sequence,
    predecessorDigest,
    valueDigest,
    valueBase64: normalized.canonicalBytes.toString("base64"),
  };
  const bytes = serializeEntry(entry);
  const digest = digestRawBytes(bytes);
  const name = `${normalized.publicationPrefix}${String(sequence).padStart(12, "0")}-${digest.slice("sha256:".length)}.json`;
  return Object.freeze({ bytes, digest, name, entryPath: path.join(normalized.parentPath, name) });
}

function operationIdFor(value) {
  return digestRawBytes(Buffer.from(`${JSON.stringify(value)}\n`, "utf8")).slice("sha256:".length);
}

function namesForPrepared(normalized, sequence, operationId) {
  return Object.freeze({
    preparedStageName: `${normalized.publicationPrefix}prepared-stage.${operationId}.json`,
    preparedName: `${normalized.publicationPrefix}prepared.${String(sequence).padStart(12, "0")}.json`,
    entryStageName: `${normalized.publicationPrefix}entry-stage.${operationId}.bin`,
  });
}

function namesForOutcome(normalized, sequence, operationId, outcomeDigest) {
  const digest = outcomeDigest.slice("sha256:".length);
  return Object.freeze({
    outcomeStageName: `${normalized.publicationPrefix}outcome-stage.${operationId}-${digest}.json`,
    outcomeName: `${normalized.publicationPrefix}outcome.${String(sequence).padStart(12, "0")}-${digest}.json`,
  });
}

function nameExpressions(normalized) {
  const prefix = escapeRegExp(normalized.publicationPrefix);
  return Object.freeze({
    publication: new RegExp(`^${prefix}([0-9]{12})-([a-f0-9]{64})\\.json$`, "u"),
    preparedStage: new RegExp(`^${prefix}prepared-stage\\.([a-f0-9]{64})\\.json$`, "u"),
    preparedFinal: new RegExp(`^${prefix}prepared\\.([0-9]{12})\\.json$`, "u"),
    entryStage: new RegExp(`^${prefix}entry-stage\\.([a-f0-9]{64})\\.bin$`, "u"),
    outcomeStage: new RegExp(`^${prefix}outcome-stage\\.([a-f0-9]{64})-([a-f0-9]{64})\\.json$`, "u"),
    outcomeFinal: new RegExp(`^${prefix}outcome\\.([0-9]{12})-([a-f0-9]{64})\\.json$`, "u"),
  });
}

async function publishImmutableFile(filePath, bytes, parent, normalized, kind) {
  await assertParent(parent);
  try {
    const published = await runBuilderPosixEffect({
      action: "write-file",
      name: path.basename(filePath),
      payload: bytes.toString("base64"),
    }, {
      directoryAuthority: effectDirectoryAuthority(parent),
    });
    if (!published.created) {
      await finishExistingImmutableFile(filePath, bytes, parent);
      return;
    }
  } catch (error) {
    if (error instanceof ImmutableJournalError) throw error;
    conflict();
  }
  await syncParent(parent);
  await readExactFile(filePath, bytes, [1n, 2n], Math.max(bytes.length, MAX_EVIDENCE_BYTES));
}

async function finishExistingImmutableFile(filePath, bytes, parent) {
  await syncParent(parent);
  await readExactFile(filePath, bytes, [1n, 2n], Math.max(bytes.length, MAX_EVIDENCE_BYTES));
}

async function publishAbsentLink(
  sourcePath,
  destinationPath,
  bytes,
  parent,
  normalized,
  kind,
) {
  await assertParent(parent);
  try {
    await runBuilderPosixEffect({
      action: "hardlink",
      name: path.basename(destinationPath),
      payload: bytes.toString("base64"),
      sourceName: path.basename(sourcePath),
    }, {
      directoryAuthority: effectDirectoryAuthority(parent),
    });
  } catch (error) {
    const exact = await inspectLinkedPair(sourcePath, destinationPath, bytes, Math.max(bytes.length, MAX_EVIDENCE_BYTES))
      .catch(() => null);
    if (exact === null) {
      if (kind === "prepared") throw new PreparedClaimLost();
      conflict();
    }
  }
  await syncParent(parent);
  await inspectLinkedPair(sourcePath, destinationPath, bytes, Math.max(bytes.length, MAX_EVIDENCE_BYTES));
}

async function syncParent(parent) {
  await assertParent(parent);
  try {
    await parent.handle.sync();
  } catch {
    conflict();
  }
  await assertParent(parent);
}

function parsePrepared(bytes, normalized, parent, expectedOperationId) {
  const value = parseJson(bytes);
  if (!hasExactKeys(value, PREPARED_KEYS)
    || value.schemaVersion !== IMMUTABLE_JOURNAL_RECOVERY_SCHEMA_VERSION
    || !OPERATION_PATTERN.test(value.operationId ?? "")
    || (expectedOperationId !== undefined && value.operationId !== expectedOperationId)
    || value.journalKey !== parent.key
    || !Number.isSafeInteger(value.sequence)
    || value.sequence < 0
    || value.sequence >= normalized.maxEntries
    || (value.predecessorDigest !== null && !DIGEST_PATTERN.test(value.predecessorDigest ?? ""))
    || !DIGEST_PATTERN.test(value.valueDigest ?? "")
    || !DIGEST_PATTERN.test(value.publicationDigest ?? "")
    || !sameParentIdentityModel(value.parentIdentity, parentIdentityModel(parent.stat))) {
    conflict();
  }
  const expectedNames = namesForPrepared(normalized, value.sequence, value.operationId);
  const expectedPublicationName = value.sequence === 0
    ? normalized.basename
    : `${normalized.publicationPrefix}${String(value.sequence).padStart(12, "0")}-${value.publicationDigest.slice("sha256:".length)}.json`;
  const expectedId = operationIdFor({
    journalKey: value.journalKey,
    sequence: value.sequence,
    predecessorDigest: value.predecessorDigest,
    valueDigest: value.valueDigest,
    publicationDigest: value.publicationDigest,
  });
  if (value.operationId !== expectedId
    || value.publicationName !== expectedPublicationName
    || value.entryStageName !== expectedNames.entryStageName
    || value.preparedName !== expectedNames.preparedName
    || !bytes.equals(serializePrepared(value))) {
    conflict();
  }
  return deepFreezeRecord(value);
}

function parseOutcome(bytes, normalized, parent, claim, publication) {
  const value = parseJson(bytes);
  const preparedNames = namesForPrepared(normalized, claim.record.sequence, claim.record.operationId);
  if (!hasExactKeys(value, OUTCOME_KEYS)
    || value.schemaVersion !== OUTCOME_SCHEMA_VERSION
    || value.operationId !== claim.record.operationId
    || value.journalKey !== parent.key
    || value.sequence !== claim.record.sequence
    || value.predecessorDigest !== claim.record.predecessorDigest
    || value.valueDigest !== claim.record.valueDigest
    || value.publicationDigest !== claim.record.publicationDigest
    || value.publicationName !== claim.record.publicationName
    || !sameParentIdentityModel(value.parentIdentity, parentIdentityModel(parent.stat))
    || !hasExactKeys(value.prepared, ["stageName", "finalName", "identity"])
    || !hasExactKeys(value.entry, ["stageName", "finalName", "identity"])
    || value.prepared.stageName !== preparedNames.preparedStageName
    || value.prepared.finalName !== preparedNames.preparedName
    || value.entry.stageName !== preparedNames.entryStageName
    || value.entry.finalName !== claim.record.publicationName
    || !sameInternalIdentityModel(value.prepared.identity, internalIdentityModel(claim.stat))
    || !sameInternalIdentityModel(value.entry.identity, internalIdentityModel(publication.stat))
    || !bytes.equals(serializeOutcome(value))) {
    conflict();
  }
  return deepFreezeRecord(value);
}

function decodePublication(normalized, prepared, bytes) {
  if (digestRawBytes(bytes) !== prepared.publicationDigest) conflict();
  if (prepared.sequence === 0) {
    if (prepared.publicationDigest !== prepared.valueDigest
      || bytes.length === 0
      || bytes.length > normalized.maxValueBytes) {
      conflict();
    }
    return Object.freeze({ valueBytes: bytes });
  }
  const entry = parseJson(bytes);
  if (!hasExactKeys(entry, ENTRY_KEYS)
    || entry.schemaVersion !== IMMUTABLE_JOURNAL_ENTRY_SCHEMA_VERSION
    || entry.sequence !== prepared.sequence
    || entry.predecessorDigest !== prepared.predecessorDigest
    || entry.valueDigest !== prepared.valueDigest
    || typeof entry.valueBase64 !== "string"
    || !bytes.equals(serializeEntry(entry))) {
    conflict();
  }
  let valueBytes;
  try {
    valueBytes = Buffer.from(entry.valueBase64, "base64");
  } catch {
    conflict();
  }
  if (valueBytes.length === 0
    || valueBytes.length > normalized.maxValueBytes
    || valueBytes.toString("base64") !== entry.valueBase64
    || digestRawBytes(valueBytes) !== prepared.valueDigest) {
    conflict();
  }
  return Object.freeze({ valueBytes });
}

function serializePrepared(value) {
  return Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
}

function serializeOutcome(value) {
  return Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
}

function serializeEntry(value) {
  return Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
}

async function inspectLinkedPair(stagePath, finalPath, bytes, maxBytes) {
  const stage = await readExactFile(stagePath, bytes, [2n], maxBytes);
  const final = await readExactFile(finalPath, bytes, [2n], maxBytes);
  if (!sameIdentity(stage, final)) conflict();
  return final;
}

async function readExactFile(filePath, expectedBytes, expectedLinks, maxBytes) {
  const opened = await readBoundedFile(filePath, maxBytes, expectedLinks);
  if (!opened.bytes.equals(expectedBytes)) conflict();
  return opened.stat;
}

async function readBoundedFile(filePath, maxBytes, expectedLinks) {
  let handle;
  try {
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await assertFileBinding(filePath, handle, undefined, expectedLinks);
    if (before.size > BigInt(maxBytes)) conflict();
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!Number.isInteger(result.bytesRead) || result.bytesRead <= 0) conflict();
      offset += result.bytesRead;
    }
    const after = await assertFileBinding(filePath, handle, before, expectedLinks, bytes.length);
    if (!sameStableFile(before, after)) conflict();
    return Object.freeze({ bytes, stat: after });
  } catch (error) {
    if (error instanceof ImmutableJournalError) throw error;
    conflict();
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function assertFileBinding(filePath, handle, expectedStat, expectedLinks, expectedSize) {
  try {
    const held = await handle.stat({ bigint: true });
    const current = await lstat(filePath, { bigint: true });
    assertSafeFileStat(held, expectedLinks, expectedSize);
    assertSafeFileStat(current, expectedLinks, expectedSize);
    if (!sameIdentity(held, current) || (expectedStat && !sameIdentity(expectedStat, held))) conflict();
    return held;
  } catch (error) {
    if (error instanceof ImmutableJournalError) throw error;
    conflict();
  }
}

async function assertParent(parent) {
  try {
    const held = await parent.handle.stat({ bigint: true });
    const current = await lstat(parent.path, { bigint: true });
    assertSafeParentStat(held);
    assertSafeParentStat(current);
    if (!sameDirectoryIdentity(parent.stat, held)
      || !sameDirectoryIdentity(held, current)
      || !sameParentIdentityModel(parentIdentityModel(parent.stat), parentIdentityModel(current))) {
      conflict();
    }
  } catch (error) {
    if (error instanceof ImmutableJournalError) throw error;
    conflict();
  }
}

function assertSafeParentStat(stat) {
  if (!stat?.isDirectory?.()
    || stat.isSymbolicLink?.()
    || stat.uid !== BigInt(process.getuid())
    || (stat.mode & 0o022n) !== 0n) {
    conflict();
  }
}

function assertSafeFileStat(stat, expectedLinks, expectedSize) {
  if (!stat?.isFile?.()
    || stat.isSymbolicLink?.()
    || stat.uid !== BigInt(process.getuid())
    || (stat.mode & 0o777n) !== BigInt(FILE_MODE)
    || !expectedLinks.includes(stat.nlink)
    || (expectedSize !== undefined && stat.size !== BigInt(expectedSize))) {
    conflict();
  }
}

function internalIdentityModel(stat) {
  return Object.freeze({
    dev: String(stat.dev),
    ino: String(stat.ino),
    size: String(stat.size),
    uid: String(stat.uid),
    gid: String(stat.gid),
    mode: Number(stat.mode & 0o777n),
    links: String(stat.nlink),
    mtimeNs: String(stat.mtimeNs),
    ctimeNs: String(stat.ctimeNs),
  });
}

function publicIdentityModel(stat) {
  const identity = internalIdentityModel(stat);
  return Object.freeze({
    dev: identity.dev,
    ino: identity.ino,
    size: identity.size,
    uid: identity.uid,
    mode: identity.mode,
  });
}

function parentIdentityModel(stat) {
  return Object.freeze({
    dev: String(stat.dev),
    ino: String(stat.ino),
    uid: String(stat.uid),
    gid: String(stat.gid),
    mode: Number(stat.mode & 0o777n),
  });
}

function effectDirectoryAuthority(parent) {
  return Object.freeze({
    path: parent.path,
    handle: parent.handle,
    identity: Object.freeze({
      device: String(parent.stat.dev),
      inode: String(parent.stat.ino),
      uid: String(parent.stat.uid),
      gid: String(parent.stat.gid),
      mode: Number(parent.stat.mode & 0o777n).toString(8),
    }),
  });
}

function sameInternalIdentityModel(left, right) {
  return hasExactKeys(left, INTERNAL_IDENTITY_KEYS)
    && INTERNAL_IDENTITY_KEYS.every((key) => left[key] === right[key]);
}

function sameParentIdentityModel(left, right) {
  return hasExactKeys(left, PARENT_IDENTITY_KEYS)
    && PARENT_IDENTITY_KEYS.every((key) => left[key] === right[key]);
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameDirectoryIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameStableFile(left, right) {
  return sameIdentity(left, right)
    && left.mode === right.mode
    && left.uid === right.uid
    && left.gid === right.gid
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function mintAdmission(record, parent) {
  const admission = Object.freeze({
    subject: "immutable-journal-entry",
    digest: record.digest,
    publicationDigest: record.publicationDigest,
    sequence: record.sequence,
    predecessorDigest: record.predecessorDigest,
    entryIdentity: publicIdentityModel(record.stat),
    valueByteLength: record.bytes.length,
  });
  ADMISSIONS.add(admission);
  ADMISSION_DETAILS.set(admission, Object.freeze({
    journalKey: parent.key,
    bytes: Buffer.from(record.bytes),
  }));
  return admission;
}

function sameAdmission(left, right) {
  return left !== null
    && right !== null
    && left.sequence === right.sequence
    && left.digest === right.digest
    && left.publicationDigest === right.publicationDigest
    && left.predecessorDigest === right.predecessorDigest
    && samePublicIdentityModel(left.entryIdentity, right.entryIdentity);
}

function samePublicIdentityModel(left, right) {
  return left?.dev === right?.dev
    && left?.ino === right?.ino
    && left?.size === right?.size
    && left?.uid === right?.uid
    && left?.mode === right?.mode;
}

function appendOutcome(status, head, recoveryRequired) {
  return Object.freeze({
    schemaVersion: IMMUTABLE_JOURNAL_APPEND_RESULT_SCHEMA_VERSION,
    status,
    committed: status !== "rejected-before-commit",
    recoveryRequired: recoveryRequired === true,
    head,
  });
}

function publicJournalView(loaded) {
  return Object.freeze({
    entries: loaded.entries,
    head: loaded.head,
    recoveryRequired: loaded.recoveryRequired,
  });
}

function insertUnique(map, key, value) {
  if (map.has(key)) conflict();
  map.set(key, value);
}

function parseJson(bytes) {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    conflict();
  }
}

function hasExactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key, index) => actual[index] === key);
}

function deepFreezeRecord(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreezeRecord(child);
  return value;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function conflict() {
  throw new ImmutableJournalError("AGENTMO_IMMUTABLE_JOURNAL_CONFLICT_REJECTED");
}

function invalid() {
  throw new ImmutableJournalError("AGENTMO_IMMUTABLE_JOURNAL_INVALID");
}

function authorityRejected() {
  throw new ImmutableJournalError("AGENTMO_IMMUTABLE_JOURNAL_AUTHORITY_REJECTED");
}

function platformUnsupported() {
  throw new ImmutableJournalError("AGENTMO_IMMUTABLE_JOURNAL_PLATFORM_UNSUPPORTED");
}

function assertImmutableJournalPlatform() {
  try {
    assertBuilderPlatform();
  } catch {
    platformUnsupported();
  }
}
