import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import {
  validateOpenClawConflictApproval,
  validateOpenClawInstallApproval,
  validateOpenClawSensitiveActionDecision,
} from "./openclaw-install-approval.js";
import { validateOpenClawInstallPlan } from "./openclaw-install-plan.js";
import { openOpenClawSafeFsSession } from "./openclaw-safe-fs.js";
import {
  validateOpenClawTargetDescriptor,
} from "./openclaw-target-descriptor.js";
import {
  validateOpenClawAuthorityRootBinding,
  verifyOpenClawAuthorityRootBinding,
} from "./openclaw-authority-root-binding.js";
import {
  assertPersistable,
  serializePersistableJson,
} from "./persistability.js";

export const OPENCLAW_AUTHORITY_MARKER_SCHEMA_VERSION =
  "agentmo.openclaw-authority-marker.v1";

const AUTHORITY_FAMILIES = Object.freeze([
  "ordinary",
  "sensitive",
  "conflict",
]);
const EVIDENCE_DIRECTORIES = Object.freeze([
  "post-state",
  "official-action-results",
  "finalizations",
  "finalization-links",
]);
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const ATTEMPT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const ADMITTED_RESERVATION_SETS = new WeakSet();
const CANONICAL_LEDGERS = new WeakMap();

export class OpenClawAuthorityConsumptionError extends Error {
  constructor(code) {
    super("OpenClaw authority reservation was rejected.");
    this.name = "OpenClawAuthorityConsumptionError";
    this.code = code;
  }
}

export async function prepareOpenClawAuthorityStateRoot(rootPath) {
  if (!path.isAbsolute(rootPath ?? "")) {
    fail("AGENTMO_OPENCLAW_AUTHORITY_STATE_ROOT_REJECTED");
  }
  const root = path.resolve(rootPath);
  const before = await secureDirectory(root);
  for (const family of [...AUTHORITY_FAMILIES, ...EVIDENCE_DIRECTORIES]) {
    const familyPath = path.join(root, family);
    try {
      await mkdir(familyPath, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== "EEXIST") {
        fail("AGENTMO_OPENCLAW_AUTHORITY_STATE_ROOT_REJECTED");
      }
    }
    const familyStats = await secureDirectory(familyPath);
    if (familyStats.dev !== before.dev) {
      fail("AGENTMO_OPENCLAW_AUTHORITY_STATE_ROOT_REJECTED");
    }
  }
  const rootHandle = await open(
    root,
    constants.O_RDONLY | (constants.O_DIRECTORY ?? 0)
      | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    await rootHandle.sync();
    const retained = await rootHandle.stat({ bigint: true });
    const after = await lstat(root, { bigint: true });
    if (!sameIdentity(before, retained) || !sameIdentity(retained, after)) {
      fail("AGENTMO_OPENCLAW_AUTHORITY_STATE_ROOT_REJECTED");
    }
  } finally {
    await rootHandle.close();
  }
  return Object.freeze({
    rootPath: root,
    families: AUTHORITY_FAMILIES,
  });
}

export async function openOpenClawCanonicalAuthorityLedger(options = {}) {
  if (!plainObject(options)
    || !sameKeys(options, [
      "openClawTargetRoot",
      "targetDescriptor",
      "helperPath",
      "receiptPath",
      "receiptDigest",
      "authorityRootBinding",
    ])
    || !path.isAbsolute(options.openClawTargetRoot ?? "")
    || !path.isAbsolute(options.helperPath ?? "")
    || !path.isAbsolute(options.receiptPath ?? "")
    || !DIGEST_PATTERN.test(options.receiptDigest ?? "")
    || !validateOpenClawAuthorityRootBinding(
      options.authorityRootBinding,
    ).ok
    || !validateOpenClawTargetDescriptor(options.targetDescriptor).ok) {
    fail("AGENTMO_OPENCLAW_CANONICAL_LEDGER_REJECTED");
  }
  let canonicalTargetRoot;
  let targetStats;
  try {
    canonicalTargetRoot = await realpath(options.openClawTargetRoot);
    targetStats = await lstat(canonicalTargetRoot, { bigint: true });
  } catch {
    fail("AGENTMO_OPENCLAW_CANONICAL_LEDGER_REJECTED");
  }
  const descriptorTargetIdentity = options.targetDescriptor.targetRoot
    ?.identityBasis;
  if (!targetStats.isDirectory()
    || targetStats.isSymbolicLink()
    || targetStats.dev.toString() !== descriptorTargetIdentity?.device
    || targetStats.ino.toString() !== descriptorTargetIdentity?.inode) {
    fail("AGENTMO_OPENCLAW_CANONICAL_LEDGER_REJECTED");
  }
  const targetDescriptorDigest = digestCanonical(
    options.targetDescriptor,
    "openclaw-target-descriptor",
  );
  let verifiedBinding;
  try {
    verifiedBinding = await verifyOpenClawAuthorityRootBinding({
      openClawTargetRoot: canonicalTargetRoot,
      targetDescriptor: options.targetDescriptor,
      binding: options.authorityRootBinding,
    });
  } catch {
    fail("AGENTMO_OPENCLAW_CANONICAL_LEDGER_REJECTED");
  }
  const rootPath = verifiedBinding.rootPath;
  let session;
  try {
    session = await openOpenClawSafeFsSession({
      rootPath,
      helperPath: options.helperPath,
      receiptPath: options.receiptPath,
      receiptDigest: options.receiptDigest,
    });
  } catch {
    fail("AGENTMO_OPENCLAW_CANONICAL_LEDGER_REJECTED");
  }
  const rootIdentity = Object.freeze({
    device: session.rootIdentity.device,
    inode: session.rootIdentity.inode,
  });
  if (rootIdentity.device !== options.authorityRootBinding.rootIdentity.device
    || rootIdentity.inode !== options.authorityRootBinding.rootIdentity.inode) {
    await session.close().catch(() => {});
    fail("AGENTMO_OPENCLAW_CANONICAL_LEDGER_REJECTED");
  }
  const authorityId = options.authorityRootBinding.authorityId;
  const ledger = Object.freeze({
    authorityId,
    rootIdentity,
    targetDescriptorDigest,
    async close() {
      const metadata = CANONICAL_LEDGERS.get(ledger);
      if (metadata === undefined || metadata.closed) {
        return Object.freeze({ disposition: "preserved" });
      }
      metadata.closed = true;
      return metadata.session.close();
    },
  });
  CANONICAL_LEDGERS.set(ledger, {
    rootPath,
    session,
    closed: false,
  });
  return ledger;
}

export function isOpenClawCanonicalAuthorityLedger(value) {
  const metadata = CANONICAL_LEDGERS.get(value);
  return metadata !== undefined && metadata.closed === false;
}

export function describeOpenClawCanonicalAuthorityLedger(ledger) {
  requireCanonicalLedger(ledger);
  return deepFreeze({
    authorityId: ledger.authorityId,
    rootIdentity: structuredClone(ledger.rootIdentity),
    targetDescriptorDigest: ledger.targetDescriptorDigest,
  });
}

export async function reserveOpenClawCanonicalAuthoritySet(options = {}) {
  if (!plainObject(options)
    || !sameKeys(options, [
      "ledger",
      "attemptId",
      "plan",
      "probe",
      "ordinaryApproval",
      "sensitiveDecisions",
      "conflictApproval",
      "now",
    ])) {
    fail("AGENTMO_OPENCLAW_AUTHORITY_ARGUMENTS_REJECTED");
  }
  const metadata = requireCanonicalLedger(options.ledger);
  return reserveOpenClawAuthoritySet({
    session: metadata.session,
    attemptId: options.attemptId,
    plan: options.plan,
    probe: options.probe,
    ordinaryApproval: options.ordinaryApproval,
    sensitiveDecisions: options.sensitiveDecisions,
    conflictApproval: options.conflictApproval,
    now: options.now,
  });
}

export async function reopenOpenClawCanonicalAuthorityMarkers(options = {}) {
  if (!plainObject(options)
    || !sameKeys(options, [
      "ledger",
      "attemptId",
      "plan",
      "probe",
      "ordinaryApproval",
      "sensitiveDecisions",
      "conflictApproval",
    ])) {
    fail("AGENTMO_OPENCLAW_AUTHORITY_ARGUMENTS_REJECTED");
  }
  const metadata = requireCanonicalLedger(options.ledger);
  assertReservationOptions({
    session: metadata.session,
    attemptId: options.attemptId,
    plan: options.plan,
    probe: options.probe,
    ordinaryApproval: options.ordinaryApproval,
    sensitiveDecisions: options.sensitiveDecisions,
    conflictApproval: options.conflictApproval,
    now: options.ordinaryApproval?.issuedAt,
  });
  const expected = buildExpectedMarkers(options);
  const reopened = [];
  for (const marker of expected) {
    const bytes = canonicalBytes(marker.record);
    const observed = await metadata.session.observe(marker.path);
    if (!exactObservedMarker(observed, marker, bytes.length)) {
      fail("AGENTMO_OPENCLAW_AUTHORITY_RECOVERY_REQUIRED");
    }
    const read = await readCanonicalRecord(
      options.ledger,
      marker.path,
      marker.digest,
    );
    if (!read.bytes.equals(bytes)) {
      fail("AGENTMO_OPENCLAW_AUTHORITY_RECOVERY_REQUIRED");
    }
    reopened.push(deepFreeze({
      family: marker.family,
      relativeRef: marker.path,
      digest: marker.digest,
      nonceDigest: marker.nonceDigest,
      decisionDigest: marker.decisionDigest,
      actionDigest: marker.actionDigest,
      conflictSetDigest: marker.conflictSetDigest,
      fileIdentity: read.fileIdentity,
    }));
  }
  return deepFreeze(reopened);
}

export async function reopenOpenClawCanonicalReservedAuthorityMarkers(
  options = {},
) {
  if (!plainObject(options)
    || !sameKeys(options, [
      "ledger",
      "authorityReservation",
      "plan",
      "probe",
    ])
    || !ADMITTED_RESERVATION_SETS.has(options.authorityReservation)
    || !validateOpenClawInstallPlan(options.plan).ok
    || options.authorityReservation.attemptId === undefined
    || options.authorityReservation.installPlanDigest
      !== options.plan.installPlanDigest
    || options.probe?.fingerprintDigest
      !== options.plan.target.probeFingerprintDigest
    || !DIGEST_PATTERN.test(options.probe?.cli?.executableDigest ?? "")) {
    fail("AGENTMO_OPENCLAW_AUTHORITY_ARGUMENTS_REJECTED");
  }
  const metadata = requireCanonicalLedger(options.ledger);
  const reopened = [];
  for (const marker of options.authorityReservation.markers) {
    const observed = await metadata.session.observe(marker.path);
    if (observed.disposition !== "observed"
      || observed.digest !== marker.digest
      || observed.mode !== "600"
      || observed.uid !== String(process.getuid?.() ?? -1)) {
      fail("AGENTMO_OPENCLAW_AUTHORITY_RECOVERY_REQUIRED");
    }
    const read = await readCanonicalRecord(
      options.ledger,
      marker.path,
      marker.digest,
    );
    let record;
    try {
      record = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
        read.bytes,
      ));
    } catch {
      fail("AGENTMO_OPENCLAW_AUTHORITY_RECOVERY_REQUIRED");
    }
    if (!sameKeys(record, [
      "schemaVersion",
      "authorityFamily",
      "useNonce",
      "nonceDigest",
      "attemptId",
      "installPlanDigest",
      "targetDigest",
      "archiveBindingDigest",
      "authorityId",
      "rootIdentity",
      "lifecycle",
      "probeFingerprintDigest",
      "probeExecutableDigest",
      "decisionDigest",
      "actionDigest",
      "conflictSetDigest",
      "issuedAt",
      "expiresAt",
    ])
      || record.schemaVersion !== OPENCLAW_AUTHORITY_MARKER_SCHEMA_VERSION
      || record.authorityFamily !== marker.family
      || record.nonceDigest !== marker.nonceDigest
      || record.attemptId !== options.authorityReservation.attemptId
      || record.installPlanDigest !== options.plan.installPlanDigest
      || record.targetDigest !== digestCanonical(options.plan.target)
      || record.archiveBindingDigest
        !== digestCanonical(options.plan.archiveBinding)
      || record.authorityId !== options.plan.authorityRootBinding.authorityId
      || !plainObject(record.rootIdentity)
      || record.rootIdentity.device
        !== options.plan.authorityRootBinding.rootIdentity.device
      || record.rootIdentity.inode
        !== options.plan.authorityRootBinding.rootIdentity.inode
      || record.lifecycle !== options.plan.lifecycle
      || record.probeFingerprintDigest !== options.probe.fingerprintDigest
      || record.probeExecutableDigest
        !== options.probe.cli.executableDigest
      || record.decisionDigest !== marker.decisionDigest
      || record.actionDigest !== marker.actionDigest
      || record.conflictSetDigest !== marker.conflictSetDigest
      || digestCanonical(record) !== marker.digest
      || !canonicalBytes(record).equals(read.bytes)) {
      fail("AGENTMO_OPENCLAW_AUTHORITY_RECOVERY_REQUIRED");
    }
    reopened.push(deepFreeze({
      family: marker.family,
      relativeRef: marker.path,
      digest: marker.digest,
      nonceDigest: marker.nonceDigest,
      decisionDigest: marker.decisionDigest,
      actionDigest: marker.actionDigest,
      conflictSetDigest: marker.conflictSetDigest,
      fileIdentity: read.fileIdentity,
    }));
  }
  return deepFreeze(reopened);
}

export async function createOpenClawCanonicalEvidenceRecord(options = {}) {
  assertCanonicalRecordOptions(options);
  const metadata = requireCanonicalLedger(options.ledger);
  const relativeRef = canonicalEvidenceRef(options);
  const digest = digestBytes(options.bytes);
  const created = await metadata.session.createOnly(
    relativeRef,
    options.bytes,
    0o600,
  );
  if (created.disposition === "created" && created.digest !== digest) {
    fail("AGENTMO_OPENCLAW_EVIDENCE_RECOVERY_REQUIRED");
  }
  if (!["created", "preserved"].includes(created.disposition)) {
    fail("AGENTMO_OPENCLAW_EVIDENCE_RECOVERY_REQUIRED");
  }
  const reopened = await readCanonicalRecord(
    options.ledger,
    relativeRef,
    digest,
  );
  if (!reopened.bytes.equals(options.bytes)) {
    fail("AGENTMO_OPENCLAW_EVIDENCE_REPLACED_REJECTED");
  }
  return evidenceProvenance(
    options.ledger,
    relativeRef,
    digest,
    reopened.fileIdentity,
  );
}

export async function reopenOpenClawCanonicalEvidenceRecord(options = {}) {
  if (!plainObject(options)
    || !sameKeys(options, [
      "ledger",
      "recordKind",
      "attemptDigest",
      "actionDigest",
      "expectedDigest",
    ])
    || !DIGEST_PATTERN.test(options.expectedDigest ?? "")) {
    fail("AGENTMO_OPENCLAW_EVIDENCE_ARGUMENTS_REJECTED");
  }
  assertCanonicalRecordOptions({
    ledger: options.ledger,
    recordKind: options.recordKind,
    attemptDigest: options.attemptDigest,
    actionDigest: options.actionDigest,
    bytes: Buffer.from("x"),
  });
  const relativeRef = canonicalEvidenceRef(options);
  const reopened = await readCanonicalRecord(
    options.ledger,
    relativeRef,
    options.expectedDigest,
  );
  return deepFreeze({
    bytes: reopened.bytes,
    provenance: evidenceProvenance(
      options.ledger,
      relativeRef,
      options.expectedDigest,
      reopened.fileIdentity,
    ),
  });
}

export async function appendOpenClawCanonicalFinalization(options = {}) {
  if (!plainObject(options)
    || !sameKeys(options, [
      "ledger",
      "chainDigest",
      "predecessorDigest",
      "attemptDigest",
      "bytes",
    ])
    || !DIGEST_PATTERN.test(options.chainDigest ?? "")
    || !(options.predecessorDigest === null
      || DIGEST_PATTERN.test(options.predecessorDigest ?? ""))
    || !DIGEST_PATTERN.test(options.attemptDigest ?? "")
    || !Buffer.isBuffer(options.bytes)
    || options.bytes.length === 0
    || options.bytes.length > 40 * 1024) {
    fail("AGENTMO_OPENCLAW_EVIDENCE_ARGUMENTS_REJECTED");
  }
  const metadata = requireCanonicalLedger(options.ledger);
  const finalizationDigest = digestBytes(options.bytes);
  const { linkRef, linkRecord } = finalizationLink({
    ledger: options.ledger,
    chainDigest: options.chainDigest,
    predecessorDigest: options.predecessorDigest,
    attemptDigest: options.attemptDigest,
    finalizationDigest,
  });
  const linkBytes = Buffer.from(serializePersistableJson(linkRecord, {
    subject: "openclaw-install-finalization-link",
  }), "utf8");
  const linkDigest = digestBytes(linkBytes);
  const reserved = await metadata.session.reserveMarker(linkRef, linkBytes);
  if (!["created", "preserved"].includes(reserved.disposition)) {
    fail("AGENTMO_OPENCLAW_EVIDENCE_RECOVERY_REQUIRED");
  }
  try {
    const reopenedLink = await readCanonicalRecord(
      options.ledger,
      linkRef,
      linkDigest,
    );
    if (!reopenedLink.bytes.equals(linkBytes)) {
      fail("AGENTMO_OPENCLAW_FINALIZATION_FORK_REJECTED");
    }
  } catch (error) {
    if (error instanceof OpenClawAuthorityConsumptionError) {
      fail("AGENTMO_OPENCLAW_FINALIZATION_FORK_REJECTED");
    }
    throw error;
  }
  const provenance = await createOpenClawCanonicalEvidenceRecord({
    ledger: options.ledger,
    recordKind: "finalization",
    attemptDigest: options.attemptDigest,
    actionDigest: null,
    bytes: options.bytes,
  });
  return deepFreeze({
    provenance,
    link: evidenceProvenance(
      options.ledger,
      linkRef,
      linkDigest,
      (await readCanonicalRecord(
        options.ledger,
        linkRef,
        linkDigest,
      )).fileIdentity,
    ),
  });
}

export async function reopenOpenClawCanonicalFinalization(options = {}) {
  if (!plainObject(options)
    || !sameKeys(options, [
      "ledger",
      "chainDigest",
      "predecessorDigest",
      "attemptDigest",
      "expectedDigest",
    ])
    || !DIGEST_PATTERN.test(options.chainDigest ?? "")
    || !(options.predecessorDigest === null
      || DIGEST_PATTERN.test(options.predecessorDigest ?? ""))
    || !DIGEST_PATTERN.test(options.attemptDigest ?? "")
    || !DIGEST_PATTERN.test(options.expectedDigest ?? "")) {
    fail("AGENTMO_OPENCLAW_EVIDENCE_ARGUMENTS_REJECTED");
  }
  const { linkRef, linkRecord } = finalizationLink({
    ledger: options.ledger,
    chainDigest: options.chainDigest,
    predecessorDigest: options.predecessorDigest,
    attemptDigest: options.attemptDigest,
    finalizationDigest: options.expectedDigest,
  });
  const linkBytes = Buffer.from(serializePersistableJson(linkRecord, {
    subject: "openclaw-install-finalization-link",
  }), "utf8");
  const link = await readCanonicalRecord(
    options.ledger,
    linkRef,
    digestBytes(linkBytes),
  );
  if (!link.bytes.equals(linkBytes)) {
    fail("AGENTMO_OPENCLAW_FINALIZATION_FORK_REJECTED");
  }
  return reopenOpenClawCanonicalEvidenceRecord({
    ledger: options.ledger,
    recordKind: "finalization",
    attemptDigest: options.attemptDigest,
    actionDigest: null,
    expectedDigest: options.expectedDigest,
  });
}

export async function reserveOpenClawAuthoritySet(options = {}) {
  assertReservationOptions(options);
  const expected = buildExpectedMarkers(options);
  const outcomes = [];
  for (const marker of expected) {
    const bytes = canonicalBytes(marker.record);
    const created = await options.session.reserveMarker(marker.path, bytes);
    if (created.disposition === "created") {
      if (created.digest !== marker.digest) {
        fail("AGENTMO_OPENCLAW_AUTHORITY_RECOVERY_REQUIRED");
      }
      outcomes.push(markerOutcome(marker, created, "created"));
      continue;
    }
    const observed = await options.session.observe(marker.path);
    if (!exactObservedMarker(observed, marker, bytes.length)) {
      fail("AGENTMO_OPENCLAW_AUTHORITY_RECOVERY_REQUIRED");
    }
    if (marker.record.attemptId !== options.attemptId) {
      fail("AGENTMO_OPENCLAW_AUTHORITY_REPLAY_REJECTED");
    }
    outcomes.push(markerOutcome(marker, observed, "exact-resume"));
  }
  const statuses = new Set(outcomes.map(({ status }) => status));
  if (statuses.size !== 1) {
    fail("AGENTMO_OPENCLAW_AUTHORITY_RECOVERY_REQUIRED");
  }
  const reservation = deepFreeze({
    schemaVersion: "agentmo.openclaw-authority-reservation-set.v1",
    status: outcomes[0].status,
    attemptId: options.attemptId,
    installPlanDigest: options.plan.installPlanDigest,
    markerSetDigest: digestCanonical(outcomes.map(markerDigestBasis)),
    markers: outcomes,
  });
  ADMITTED_RESERVATION_SETS.add(reservation);
  return reservation;
}

export function isAdmittedOpenClawAuthorityReservationSet(value) {
  return ADMITTED_RESERVATION_SETS.has(value);
}

function buildExpectedMarkers(options) {
  const descriptors = [
    {
      family: "ordinary",
      decision: options.ordinaryApproval,
      action: null,
      conflicts: null,
    },
    ...options.sensitiveDecisions.map((decision, index) => ({
      family: "sensitive",
      decision,
      action: options.plan.sensitiveActions[index],
      conflicts: null,
    })),
    {
      family: "conflict",
      decision: options.conflictApproval,
      action: null,
      conflicts: options.plan.conflicts,
    },
  ];
  return descriptors.map((descriptor) => {
    const nonceDigest = digestBytes(Buffer.from(
      descriptor.decision.useNonce,
      "utf8",
    ));
    const decisionDigest = digestCanonical(
      descriptor.decision,
      "openclaw-install-decision",
    );
    const actionDigest = descriptor.action === null
      ? null
      : digestCanonical(descriptor.action, "openclaw-install-decision");
    const conflictSetDigest = descriptor.conflicts === null
      ? null
      : digestCanonical(descriptor.conflicts);
    const record = {
      schemaVersion: OPENCLAW_AUTHORITY_MARKER_SCHEMA_VERSION,
      authorityFamily: descriptor.family,
      useNonce: descriptor.decision.useNonce,
      nonceDigest,
      attemptId: options.attemptId,
      installPlanDigest: options.plan.installPlanDigest,
      targetDigest: digestCanonical(options.plan.target),
      archiveBindingDigest: digestCanonical(options.plan.archiveBinding),
      authorityId: options.plan.authorityRootBinding.authorityId,
      rootIdentity: structuredClone(
        options.plan.authorityRootBinding.rootIdentity,
      ),
      lifecycle: options.plan.lifecycle,
      probeFingerprintDigest: options.probe.fingerprintDigest,
      probeExecutableDigest: options.probe.cli.executableDigest,
      decisionDigest,
      actionDigest,
      conflictSetDigest,
      issuedAt: descriptor.decision.issuedAt,
      expiresAt: descriptor.decision.expiresAt,
    };
    assertPersistable(record, { subject: "openclaw-authority-marker" });
    return Object.freeze({
      family: descriptor.family,
      path: `${descriptor.family}/${nonceDigest.slice("sha256:".length)}.json`,
      digest: digestCanonical(record),
      nonceDigest,
      decisionDigest,
      actionDigest,
      conflictSetDigest,
      record: deepFreeze(record),
    });
  });
}

function assertReservationOptions(options) {
  if (!plainObject(options)
    || !sameKeys(options, [
      "session",
      "attemptId",
      "plan",
      "probe",
      "ordinaryApproval",
      "sensitiveDecisions",
      "conflictApproval",
      "now",
    ])
    || typeof options.session?.reserveMarker !== "function"
    || typeof options.session?.observe !== "function"
    || !ATTEMPT_PATTERN.test(options.attemptId ?? "")
    || !DATE_PATTERN.test(options.now ?? "")
    || !validateOpenClawInstallPlan(options.plan).ok
    || options.probe?.fingerprintDigest
      !== options.plan.target.probeFingerprintDigest
    || !DIGEST_PATTERN.test(options.probe?.cli?.executableDigest ?? "")
    || !Array.isArray(options.sensitiveDecisions)
    || options.sensitiveDecisions.length
      !== options.plan.sensitiveActions.length
    || !plainObject(options.conflictApproval)) {
    fail("AGENTMO_OPENCLAW_AUTHORITY_ARGUMENTS_REJECTED");
  }
  const context = {
    plan: options.plan,
    now: options.now,
  };
  if (!validateOpenClawInstallApproval(
    options.ordinaryApproval,
    context,
  ).ok
    || !validateOpenClawConflictApproval(
      options.conflictApproval,
      context,
    ).ok
    || options.sensitiveDecisions.some((decision, index) => (
      !validateOpenClawSensitiveActionDecision(decision, {
        ...context,
        action: options.plan.sensitiveActions[index],
      }).ok
  ))) {
    fail("AGENTMO_OPENCLAW_AUTHORITY_DECISION_REJECTED");
  }
  const nonceDigests = [
    options.ordinaryApproval,
    ...options.sensitiveDecisions,
    options.conflictApproval,
  ].map(({ useNonce }) => digestBytes(Buffer.from(useNonce, "utf8")));
  if (new Set(nonceDigests).size !== nonceDigests.length) {
    fail("AGENTMO_OPENCLAW_AUTHORITY_NONCE_REUSED");
  }
}

async function secureDirectory(directoryPath) {
  let stats;
  try {
    stats = await lstat(directoryPath, { bigint: true });
  } catch {
    fail("AGENTMO_OPENCLAW_AUTHORITY_STATE_ROOT_REJECTED");
  }
  if (!stats.isDirectory()
    || stats.isSymbolicLink()
    || stats.uid !== BigInt(process.getuid?.() ?? -1)
    || (stats.mode & 0o777n) !== 0o700n) {
    fail("AGENTMO_OPENCLAW_AUTHORITY_STATE_ROOT_REJECTED");
  }
  return stats;
}

function exactObservedMarker(observed, marker, byteLength) {
  return observed?.disposition === "observed"
    && observed.digest === marker.digest
    && observed.mode === "600"
    && observed.uid === String(process.getuid?.() ?? -1)
    && observed.size === String(byteLength)
    && /^\d+$/u.test(observed.device ?? "")
    && /^\d+$/u.test(observed.inode ?? "");
}

function markerOutcome(marker, observed, status) {
  return Object.freeze({
    family: marker.family,
    path: marker.path,
    digest: marker.digest,
    nonceDigest: marker.nonceDigest,
    decisionDigest: marker.decisionDigest,
    actionDigest: marker.actionDigest,
    conflictSetDigest: marker.conflictSetDigest,
    device: observed.device,
    inode: observed.inode,
    status,
  });
}

function markerDigestBasis(marker) {
  return {
    family: marker.family,
    path: marker.path,
    digest: marker.digest,
    nonceDigest: marker.nonceDigest,
    decisionDigest: marker.decisionDigest,
    actionDigest: marker.actionDigest,
    conflictSetDigest: marker.conflictSetDigest,
    device: marker.device,
    inode: marker.inode,
  };
}

function requireCanonicalLedger(ledger) {
  const metadata = CANONICAL_LEDGERS.get(ledger);
  if (metadata === undefined || metadata.closed) {
    fail("AGENTMO_OPENCLAW_CANONICAL_LEDGER_REJECTED");
  }
  return metadata;
}

function assertCanonicalRecordOptions(options) {
  if (!plainObject(options)
    || !sameKeys(options, [
      "ledger",
      "recordKind",
      "attemptDigest",
      "actionDigest",
      "bytes",
    ])
    || !["post-state", "official-action-result", "finalization"].includes(
      options.recordKind,
    )
    || !DIGEST_PATTERN.test(options.attemptDigest ?? "")
    || !Buffer.isBuffer(options.bytes)
    || options.bytes.length === 0
    || options.bytes.length > 40 * 1024
    || (options.recordKind === "official-action-result"
      ? !DIGEST_PATTERN.test(options.actionDigest ?? "")
      : options.actionDigest !== null)) {
    fail("AGENTMO_OPENCLAW_EVIDENCE_ARGUMENTS_REJECTED");
  }
  requireCanonicalLedger(options.ledger);
}

function canonicalEvidenceRef(options) {
  const attempt = options.attemptDigest.slice("sha256:".length);
  if (options.recordKind === "post-state") {
    return `post-state/${attempt}.json`;
  }
  if (options.recordKind === "finalization") {
    return `finalizations/${attempt}.json`;
  }
  return `official-action-results/${attempt}-${
    options.actionDigest.slice("sha256:".length)
  }.json`;
}

function finalizationLink(options) {
  requireCanonicalLedger(options.ledger);
  const predecessorToken = options.predecessorDigest === null
    ? "genesis"
    : options.predecessorDigest.slice("sha256:".length);
  return {
    linkRef: `finalization-links/${
      options.chainDigest.slice("sha256:".length)
    }-${predecessorToken}.json`,
    linkRecord: {
      schemaVersion: "agentmo.openclaw-install-finalization-link.v1",
      authorityId: options.ledger.authorityId,
      rootIdentity: structuredClone(options.ledger.rootIdentity),
      chainDigest: options.chainDigest,
      predecessorDigest: options.predecessorDigest,
      successorAttemptDigest: options.attemptDigest,
      successorFinalizationDigest: options.finalizationDigest,
    },
  };
}

async function readCanonicalRecord(ledger, relativeRef, expectedDigest) {
  const metadata = requireCanonicalLedger(ledger);
  if (!portableRelativeRef(relativeRef)
    || !DIGEST_PATTERN.test(expectedDigest ?? "")) {
    fail("AGENTMO_OPENCLAW_EVIDENCE_ARGUMENTS_REJECTED");
  }
  const observed = await metadata.session.observe(relativeRef);
  if (observed.disposition !== "observed"
    || observed.digest !== expectedDigest
    || observed.mode !== "600"
    || observed.uid !== String(process.getuid?.() ?? -1)
    || !/^\d+$/u.test(observed.device ?? "")
    || !/^\d+$/u.test(observed.inode ?? "")
    || !/^\d+$/u.test(observed.size ?? "")) {
    fail("AGENTMO_OPENCLAW_EVIDENCE_REPLACED_REJECTED");
  }
  let handle;
  try {
    const currentRoot = await lstat(metadata.rootPath, { bigint: true });
    if (!currentRoot.isDirectory()
      || currentRoot.isSymbolicLink()
      || currentRoot.dev.toString() !== ledger.rootIdentity.device
      || currentRoot.ino.toString() !== ledger.rootIdentity.inode) {
      fail("AGENTMO_OPENCLAW_EVIDENCE_REPLACED_REJECTED");
    }
    const filePath = path.join(metadata.rootPath, ...relativeRef.split("/"));
    handle = await open(
      filePath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()
      || before.isSymbolicLink()
      || before.nlink !== 1n
      || before.uid !== BigInt(process.getuid?.() ?? -1)
      || (before.mode & 0o777n) !== 0o600n
      || before.dev.toString() !== observed.device
      || before.ino.toString() !== observed.inode
      || before.size.toString() !== observed.size
      || before.size <= 0n
      || before.size > 40n * 1024n) {
      fail("AGENTMO_OPENCLAW_EVIDENCE_REPLACED_REJECTED");
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const current = await lstat(filePath, { bigint: true });
    const rootAfter = await lstat(metadata.rootPath, { bigint: true });
    if (!sameStableFile(before, after)
      || !sameStableFile(after, current)
      || rootAfter.dev.toString() !== ledger.rootIdentity.device
      || rootAfter.ino.toString() !== ledger.rootIdentity.inode
      || bytes.length !== Number(after.size)
      || digestBytes(bytes) !== expectedDigest) {
      fail("AGENTMO_OPENCLAW_EVIDENCE_REPLACED_REJECTED");
    }
    return deepFreeze({
      bytes,
      fileIdentity: {
        device: after.dev.toString(),
        inode: after.ino.toString(),
      },
    });
  } catch (error) {
    if (error instanceof OpenClawAuthorityConsumptionError) throw error;
    fail("AGENTMO_OPENCLAW_EVIDENCE_REPLACED_REJECTED");
  } finally {
    await handle?.close().catch(() => {});
  }
}

function evidenceProvenance(
  ledger,
  relativeRef,
  digest,
  fileIdentity,
) {
  return deepFreeze({
    authorityId: ledger.authorityId,
    rootIdentity: structuredClone(ledger.rootIdentity),
    relativeRef,
    digest,
    fileIdentity: structuredClone(fileIdentity),
  });
}

function portableRelativeRef(value) {
  return typeof value === "string"
    && value.length > 0
    && !value.includes("\0")
    && !value.includes("\\")
    && !path.posix.isAbsolute(value)
    && value.split("/").every((part) => (
      part.length > 0 && part !== "." && part !== ".."
    ));
}

function sameStableFile(left, right) {
  return left.isFile()
    && right.isFile()
    && left.dev === right.dev
    && left.ino === right.ino
    && left.nlink === right.nlink
    && left.mode === right.mode
    && left.uid === right.uid
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function canonicalBytes(value) {
  return Buffer.from(
    serializePersistableJson(value, { subject: "openclaw-authority-marker" }),
    "utf8",
  );
}

function digestCanonical(value, subject = "openclaw-authority-digest") {
  return digestBytes(Buffer.from(
    serializePersistableJson(value, { subject }),
    "utf8",
  ));
}

function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameKeys(value, keys) {
  return plainObject(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function plainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype
      || Object.getPrototypeOf(value) === null);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  if (ArrayBuffer.isView(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function fail(code) {
  throw new OpenClawAuthorityConsumptionError(code);
}
