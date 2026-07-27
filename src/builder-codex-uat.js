import { randomBytes } from "node:crypto";
import { constants as FS_CONSTANTS } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";

import { digestRawBytes } from "./artifact-admission.js";
import {
  ImmutableJournalError,
  appendImmutableJournalEntry,
  assertImmutableJournalAdmission,
  loadImmutableJournal,
  readImmutableJournalAdmissionBytes,
} from "./builder-immutable-journal.js";
import {
  assertBuilderCheckpointAdmission,
  buildBuilderCheckpoint,
  writeBuilderCheckpoint,
} from "./builder-checkpoint.js";
import {
  admitBuilderUatReleaseMember,
  readBoundedNoFollowFile,
} from "./builder-package.js";
import { BUILDER_INSTALL_RECEIPT_PATH } from "./builder-install.js";
import { admitBuilderLifecycleReceipt } from "./builder-lifecycle.js";
import { assertBuilderPlatform } from "./builder-platform.js";
import { runBuilderPosixEffect } from "./builder-posix-effect.js";
import {
  assertPersistable,
  serializePersistableJson,
} from "./persistability.js";

export const CODEX_UAT_ATTEMPT_JOURNAL_SCHEMA_VERSION = "agentmo.codex-uat-attempt-journal.v2";
export const CODEX_UAT_CANDIDATE_SCHEMA_VERSION = "agentmo.codex-uat.v2";
export const CODEX_UAT_OBSERVATION_SCHEMA_VERSION = "agentmo.codex-uat-observation.v1";
export const CODEX_UAT_SCENARIO_IDS = Object.freeze([
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

const MAX_UAT_ENTRY_BYTES = 256 * 1024;
const MAX_UAT_LEAF_BYTES = 256 * 1024;
const MAX_UAT_TARBALL_BYTES = 64 * 1024 * 1024;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const ATTEMPT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/u;
const PACKAGE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{1,127}$/u;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;
const OUTCOME_CODE_PATTERN = /^[A-Z0-9_]{3,96}$/u;
const CORRELATION_PATTERN = /^opaque:[a-f0-9]{64}$/u;
const HEAD_ADMISSIONS = new WeakSet();
const HEAD_DETAILS = new WeakMap();
const CANDIDATE_ADMISSIONS = new WeakSet();
const OBSERVATION_ADMISSIONS = new WeakSet();
const LEAF_DIRECTORY_AUTHORITIES = new WeakSet();
const VERIFIER_SOURCE_PATH = "scripts/verify-codex-uat-candidate.js";
const CONTINUATION_SOURCE_PATH = "src/builder-codex-uat-continuation.js";
const RELEASE_MANIFEST_PATH = "src/builder-codex-uat-release-manifest.json";
const CANONICAL_CODEX_UAT_MODULE_URL = new URL("./builder-codex-uat.js", import.meta.url).href;
// This lexical identity token must never cross a caller-patchable global
// constructor or utility. Its privacy comes from module scope, not freezing.
const UAT_JOURNAL_APPEND_CAPABILITY = {};
const ENTRY_KEYS = Object.freeze([
  "schemaVersion",
  "attemptId",
  "sequence",
  "kind",
  "predecessorDigest",
  "evidenceDigests",
  "details",
]);
const ENTRY_KINDS = new Set([
  "attempt-started",
  "setup-applied",
  "activation-applied",
  "trust-auth-observed",
  "scenario-observed",
  "failure",
  "interruption",
]);
const TERMINAL_PHASES = new Set(["failed", "interrupted"]);
const SCENARIO_EVIDENCE_KEYS = Object.freeze({
  "session-start": ["hookEventDigest"],
  "skill-discovery": ["visibilityDigest"],
  "user-prompt-non-trigger": ["nonTriggerDigest"],
  "manual-pause": ["checkpointSuccessorDigest"],
  "pre-compact": ["checkpointSuccessorDigest"],
  "post-compact": ["workflowIdentityDigest"],
  "restart-resume": ["freshProcessDigest"],
  "duplicate-replay": ["beforeCheckpointDigest", "afterCheckpointDigest"],
  "second-compaction": ["compactionEpochDigest", "checkpointSuccessorDigest"],
  "upgrade-visibility": [
    "successorVersion",
    "releaseDigest",
    "tarballDigest",
    "upgradePlanDigest",
    "installReceiptDigest",
    "checkpointDigest",
    "visibilityDigest",
  ],
  "deactivation-tombstone-visibility": [
    "deactivationPlanDigest",
    "visibilityDigest",
    "lifecycleHeadDigest",
    "tombstoneDigest",
    "activeReceiptDigest",
    "launcherPreserved",
    "currentReceiptPreserved",
  ],
});
const CANDIDATE_KEYS = Object.freeze([
  "schemaVersion",
  "attemptId",
  "status",
  "releaseSet",
  "successorRole",
  "successorPackageName",
  "successorVersion",
  "releaseDigest",
  "tarballDigest",
  "orderedEvidenceDigest",
  "scenarioCount",
  "humanAdmissionRequired",
  "hostOriginCryptographicallyVerified",
  "realCodexSessionVerified",
  "agentPackageQualityCertified",
  "domainQualityCertified",
  "productionReady",
  "widerCompatibilityCertified",
]);
const OBSERVATION_KEYS = Object.freeze([
  "schemaVersion",
  "attemptId",
  "scenario",
  "correlation",
  "source",
  "eventDigest",
  "runnerDigest",
  "releaseDigest",
  "installReceiptDigest",
  "claimsHostOrigin",
  "claimsScenarioSuccess",
  "realCodexSessionVerified",
  "agentPackageQualityCertified",
  "domainQualityCertified",
  "productionReady",
  "widerCompatibilityCertified",
]);

export class BuilderCodexUatError extends Error {
  constructor(code) {
    super("Codex UAT operation was rejected.");
    this.name = "BuilderCodexUatError";
    this.code = code;
  }
}

// Deliberately reveal membership only. The immutable journal calls this
// predicate for canonical UAT bytes so raw packed-module imports cannot mint
// a UAT transition from caller-controlled details.
export function isCodexUatJournalAppendCapability(value) {
  return import.meta.url === CANONICAL_CODEX_UAT_MODULE_URL
    && value === UAT_JOURNAL_APPEND_CAPABILITY;
}

// A query-suffixed file URL must act as a facade over the one canonical module
// instance; otherwise it would hold a sibling private capability that the
// generic journal correctly refuses.
async function canonicalCodexUatMutationModule() {
  if (import.meta.url === CANONICAL_CODEX_UAT_MODULE_URL) return null;
  return import("./builder-codex-uat.js");
}

export async function startCodexUatAttempt(options) {
  const canonical = await canonicalCodexUatMutationModule();
  if (canonical !== null) return canonical.startCodexUatAttempt(options);
  assertBuilderPlatform();
  if (!exactKeys(options, ["journalPath", "attemptId", "baseline", "successor"])
    || typeof options.journalPath !== "string"
    || options.journalPath.length === 0
    || !ATTEMPT_ID_PATTERN.test(options.attemptId ?? "")) {
    fail("AGENTMO_CODEX_UAT_REQUEST_REJECTED");
  }
  const [baselineAdmission, successorAdmission] = await Promise.all([
    loadReleaseEvidence(options.baseline, "baseline"),
    loadReleaseEvidence(options.successor, "successor"),
  ]);
  if (baselineAdmission.operationId !== successorAdmission.operationId
    || baselineAdmission.releaseSetDigest !== successorAdmission.releaseSetDigest
    || !sameReleasePair(baselineAdmission.pair, successorAdmission.pair)
    || !sameReleaseMember(baselineAdmission.identity, baselineAdmission.pair.baseline)
    || !sameReleaseMember(successorAdmission.identity, successorAdmission.pair.successor)) {
    fail("AGENTMO_CODEX_UAT_RELEASE_EVIDENCE_REJECTED");
  }
  const releaseSet = normalizeReleaseSetBinding({
    operationId: baselineAdmission.operationId,
    releaseSetDigest: baselineAdmission.releaseSetDigest,
  });
  const baseline = normalizeReleaseMember({ role: "baseline", ...baselineAdmission.identity }, "baseline");
  const successor = normalizeReleaseMember({ role: "successor", ...successorAdmission.identity }, "successor");
  return appendClosedEntry({
    journalPath: options.journalPath,
    expectedHeadAdmission: null,
    attemptId: options.attemptId,
    kind: "attempt-started",
    details: { releaseSet, baseline, successor },
  });
}

export async function recordCodexUatSetupApplied(options) {
  const canonical = await canonicalCodexUatMutationModule();
  if (canonical !== null) return canonical.recordCodexUatSetupApplied(options);
  assertBuilderPlatform();
  if (!exactKeys(options, [
    "journalPath", "expectedHeadAdmission", "installReceiptPath",
    "expectedInstallReceiptDigest", "checkpointAdmission",
  ])) fail("AGENTMO_CODEX_UAT_REQUEST_REJECTED");
  const view = await exactCurrentView(options.journalPath, options.expectedHeadAdmission);
  assertBuilderCheckpointAdmission(options.checkpointAdmission);
  const receipt = await loadActivatedReceipt(
    options.installReceiptPath,
    options.expectedInstallReceiptDigest,
    view.state.baseline,
  );
  return appendClosedEntry({
    journalPath: options.journalPath,
    expectedHeadAdmission: options.expectedHeadAdmission,
    attemptId: view.state.attemptId,
    kind: "setup-applied",
    details: {
      baselineVersion: receipt.value.identity.version,
      releaseDigest: receipt.value.identity.releaseDigest,
      tarballDigest: view.state.baseline.tarballDigest,
      setupPlanDigest: receipt.value.planDigest,
      installReceiptDigest: receipt.digest,
      checkpointDigest: options.checkpointAdmission.digest,
      marketplaceOwnerDigest: receipt.value.hostActivation.ownerRecordDigest,
      marketplaceConsumerDigest: receipt.value.hostActivation.consumerEntryDigest,
    },
  });
}

export async function recordCodexUatActivationApplied(options) {
  const canonical = await canonicalCodexUatMutationModule();
  if (canonical !== null) return canonical.recordCodexUatActivationApplied(options);
  assertBuilderPlatform();
  if (!exactKeys(options, [
    "journalPath", "expectedHeadAdmission", "installReceiptPath",
    "expectedInstallReceiptDigest", "checkpointAdmission", "hostObservationPath",
    "expectedHostObservationDigest",
  ])) fail("AGENTMO_CODEX_UAT_REQUEST_REJECTED");
  const view = await exactCurrentView(options.journalPath, options.expectedHeadAdmission);
  assertBuilderCheckpointAdmission(options.checkpointAdmission);
  const receipt = await loadActivatedReceipt(
    options.installReceiptPath,
    options.expectedInstallReceiptDigest,
    view.state.baseline,
  );
  const hostObservationDigest = await loadExactEvidenceDigest(
    options.hostObservationPath,
    options.expectedHostObservationDigest,
  );
  const activation = receipt.value.hostActivation;
  return appendClosedEntry({
    journalPath: options.journalPath,
    expectedHeadAdmission: options.expectedHeadAdmission,
    attemptId: view.state.attemptId,
    kind: "activation-applied",
    details: {
      activationPlanDigest: digestValue(activation, "builder-codex-activation-binding"),
      marketplaceDigest: activation.marketplaceProjectionDigest,
      selectorDigest: digestValue(activation.selector, "builder-codex-host-selector"),
      ownerDigest: activation.ownerRecordDigest,
      consumerLedgerDigest: activation.consumerLedgerDigest,
      hostObservationDigest,
      releaseDigest: receipt.value.identity.releaseDigest,
      installReceiptDigest: receipt.digest,
      checkpointDigest: options.checkpointAdmission.digest,
    },
  });
}

export async function recordCodexUatTrustAuthObservation(options) {
  const canonical = await canonicalCodexUatMutationModule();
  if (canonical !== null) return canonical.recordCodexUatTrustAuthObservation(options);
  assertBuilderPlatform();
  if (!exactKeys(options, [
    "journalPath", "expectedHeadAdmission", "freshProcessEvidencePath",
    "expectedFreshProcessDigest", "trustObservationPath", "expectedTrustObservationDigest",
    "authObservationPath", "expectedAuthObservationDigest",
  ])) fail("AGENTMO_CODEX_UAT_REQUEST_REJECTED");
  const view = await exactCurrentView(options.journalPath, options.expectedHeadAdmission);
  const [freshProcessDigest, trustObservationDigest, authObservationDigest] = await Promise.all([
    loadExactEvidenceDigest(options.freshProcessEvidencePath, options.expectedFreshProcessDigest),
    loadExactEvidenceDigest(options.trustObservationPath, options.expectedTrustObservationDigest),
    loadExactEvidenceDigest(options.authObservationPath, options.expectedAuthObservationDigest),
  ]);
  return appendClosedEntry({
    journalPath: options.journalPath,
    expectedHeadAdmission: options.expectedHeadAdmission,
    attemptId: view.state.attemptId,
    kind: "trust-auth-observed",
    details: {
      freshProcessDigest,
      trustObservationDigest,
      authObservationDigest,
      observationBasis: "human-observed-no-cryptographic-origin",
    },
  });
}

export async function terminateCodexUatAttempt(options) {
  const canonical = await canonicalCodexUatMutationModule();
  if (canonical !== null) return canonical.terminateCodexUatAttempt(options);
  assertBuilderPlatform();
  if (!exactKeys(options, [
    "journalPath", "expectedHeadAdmission", "kind", "code", "evidencePath",
    "expectedEvidenceDigest",
  ])
    || !["failure", "interruption"].includes(options.kind)
    || !OUTCOME_CODE_PATTERN.test(options.code ?? "")) {
    fail("AGENTMO_CODEX_UAT_REQUEST_REJECTED");
  }
  const view = await exactCurrentView(options.journalPath, options.expectedHeadAdmission);
  const evidenceDigest = await loadExactEvidenceDigest(
    options.evidencePath,
    options.expectedEvidenceDigest,
  );
  return appendClosedEntry({
    journalPath: options.journalPath,
    expectedHeadAdmission: options.expectedHeadAdmission,
    attemptId: view.state.attemptId,
    kind: options.kind,
    details: { code: options.code, evidenceDigest },
  });
}

export async function loadCodexUatAttemptJournal(journalPath, options = {}) {
  const canonical = await canonicalCodexUatMutationModule();
  if (canonical !== null) return canonical.loadCodexUatAttemptJournal(journalPath, options);
  assertBuilderPlatform();
  if (typeof journalPath !== "string" || journalPath.length === 0
    || !exactKeys(options, [])) {
    fail("AGENTMO_CODEX_UAT_REQUEST_REJECTED");
  }
  let loaded;
  try {
    loaded = await loadImmutableJournal({
      journalPath,
      maxValueBytes: MAX_UAT_ENTRY_BYTES,
    });
  } catch (error) {
    mapJournalError(error);
  }
  if (loaded.head === null) {
    return emptyView(path.resolve(journalPath), loaded.recoveryRequired);
  }

  const entries = [];
  let internalState = initialState();
  let head = null;
  for (const journalAdmission of loaded.entries) {
    const entry = entryFromJournalAdmission(journalAdmission);
    internalState = applyTransition(internalState, entry);
    entries.push(entry);
    head = mintHeadAdmission(journalAdmission, path.resolve(journalPath), entry, internalState);
  }
  const state = projectState(internalState, entries);
  const finalHead = Object.freeze({
    ...head,
    state,
  });
  HEAD_ADMISSIONS.add(finalHead);
  HEAD_DETAILS.set(finalHead, HEAD_DETAILS.get(head));
  return Object.freeze({
    schemaVersion: CODEX_UAT_ATTEMPT_JOURNAL_SCHEMA_VERSION,
    entries: Object.freeze(entries),
    head: finalHead,
    state,
    recoveryRequired: loaded.recoveryRequired,
  });
}

export async function resumeCodexUatAttempt(journalPath, options = {}) {
  const canonical = await canonicalCodexUatMutationModule();
  if (canonical !== null) return canonical.resumeCodexUatAttempt(journalPath, options);
  assertBuilderPlatform();
  if (!exactKeys(options, ["expectedHeadDigest"]) || !isDigest(options.expectedHeadDigest)) {
    fail("AGENTMO_CODEX_UAT_REQUEST_REJECTED");
  }
  const view = await loadCodexUatAttemptJournal(journalPath);
  if (view.head === null || view.head.digest !== options.expectedHeadDigest) {
    fail("AGENTMO_CODEX_UAT_HEAD_MISMATCH");
  }
  return Object.freeze({
    schemaVersion: "agentmo.codex-uat-resume.v1",
    attemptId: view.state.attemptId,
    currentHeadDigest: view.head.digest,
    phase: view.state.phase,
    nextAction: view.state.nextAction,
    nextScenario: view.state.nextScenario,
    terminal: view.state.terminal,
    recoveryRequired: view.recoveryRequired,
  });
}

export async function armCodexUatScenario(options) {
  const canonical = await canonicalCodexUatMutationModule();
  if (canonical !== null) return canonical.armCodexUatScenario(options);
  assertBuilderPlatform();
  if (!exactKeys(options, [
    "journalPath",
    "expectedHeadAdmission",
    "checkpointPath",
    "checkpointAdmission",
  ])
    || typeof options.checkpointPath !== "string"
    || options.checkpointPath.length === 0) {
    fail("AGENTMO_CODEX_UAT_REQUEST_REJECTED");
  }
  const view = await exactCurrentView(options.journalPath, options.expectedHeadAdmission);
  if (view.state.terminal
    || view.state.nextAction !== "scenario-arm"
    || view.state.nextScenario === null) {
    fail("AGENTMO_CODEX_UAT_TRANSITION_REJECTED");
  }
  assertBuilderCheckpointAdmission(options.checkpointAdmission);
  const correlation = `opaque:${randomBytes(32).toString("hex")}`;
  const checkpoint = buildBuilderCheckpoint({
    ...options.checkpointAdmission.value,
    codexUatChallenge: {
      attemptId: view.state.attemptId,
      scenario: view.state.nextScenario,
      correlation,
    },
  });
  const written = await writeBuilderCheckpoint(options.checkpointPath, checkpoint, {
    expectedPreviousAdmission: options.checkpointAdmission,
  });
  return Object.freeze({
    schemaVersion: "agentmo.codex-uat-scenario-arm.v1",
    attemptId: view.state.attemptId,
    scenario: view.state.nextScenario,
    correlation,
    checkpointAdmission: written,
    journalHeadDigest: view.head.digest,
  });
}

export async function publishCodexUatObservationLeaf(options) {
  const canonical = await canonicalCodexUatMutationModule();
  if (canonical !== null) return canonical.publishCodexUatObservationLeaf(options);
  assertBuilderPlatform();
  const observationKeysValid = exactKeysWithOptional(options, [
    "outDirectory",
    "attemptId",
    "scenario",
    "correlation",
    "source",
    "eventDigest",
    "runnerDigest",
    "releaseDigest",
    "installReceiptDigest",
  ], ["parentAuthority"]);
  if (!observationKeysValid
    || typeof options.outDirectory !== "string"
    || options.outDirectory.length === 0
    || !ATTEMPT_ID_PATTERN.test(options.attemptId ?? "")
    || !CODEX_UAT_SCENARIO_IDS.includes(options.scenario)
    || !CORRELATION_PATTERN.test(options.correlation ?? "")
    || !["installed-hook-untrusted", "operator-observation"].includes(options.source)
    || [
      options.eventDigest,
      options.runnerDigest,
      options.releaseDigest,
      options.installReceiptDigest,
    ].some((value) => !isDigest(value))) {
    fail("AGENTMO_CODEX_UAT_OBSERVATION_REJECTED");
  }
  const value = {
    schemaVersion: CODEX_UAT_OBSERVATION_SCHEMA_VERSION,
    attemptId: options.attemptId,
    scenario: options.scenario,
    correlation: options.correlation,
    source: options.source,
    eventDigest: options.eventDigest,
    runnerDigest: options.runnerDigest,
    releaseDigest: options.releaseDigest,
    installReceiptDigest: options.installReceiptDigest,
    claimsHostOrigin: false,
    claimsScenarioSuccess: false,
    realCodexSessionVerified: false,
    agentPackageQualityCertified: false,
    domainQualityCertified: false,
    productionReady: false,
    widerCompatibilityCertified: false,
  };
  validateCodexUatObservation(value);
  const published = await publishContentAddressedLeaf(
    options.outDirectory,
    value,
    "builder-codex-uat-observation",
    {
      parentAuthority: options.parentAuthority,
    },
  );
  const admission = Object.freeze({
    subject: "builder-codex-uat-observation",
    ...published,
  });
  OBSERVATION_ADMISSIONS.add(admission);
  return admission;
}

export async function loadCodexUatObservationLeaf(filePath, options = {}) {
  const canonical = await canonicalCodexUatMutationModule();
  if (canonical !== null) return canonical.loadCodexUatObservationLeaf(filePath, options);
  assertBuilderPlatform();
  if (!exactKeys(options, ["expectedDigest"]) || !isDigest(options.expectedDigest)) {
    fail("AGENTMO_CODEX_UAT_REQUEST_REJECTED");
  }
  const loaded = await loadCanonicalLeaf(
    filePath,
    options.expectedDigest,
    validateCodexUatObservation,
    "builder-codex-uat-observation",
  );
  const admission = Object.freeze({
    subject: "builder-codex-uat-observation",
    ...loaded,
    filePath: path.resolve(filePath),
  });
  OBSERVATION_ADMISSIONS.add(admission);
  return admission;
}

export async function recordCodexUatScenarioObservation(options) {
  const canonical = await canonicalCodexUatMutationModule();
  if (canonical !== null) return canonical.recordCodexUatScenarioObservation(options);
  assertBuilderPlatform();
  if (!exactKeys(options, [
    "journalPath",
    "expectedHeadAdmission",
    "checkpointAdmission",
    "observationAdmission",
    "evidence",
  ])) {
    fail("AGENTMO_CODEX_UAT_REQUEST_REJECTED");
  }
  const view = await exactCurrentView(options.journalPath, options.expectedHeadAdmission);
  if (view.state.terminal
    || view.state.nextAction !== "scenario-arm"
    || view.state.nextScenario === null) {
    fail("AGENTMO_CODEX_UAT_SCENARIO_ORDER_REJECTED");
  }
  try {
    assertBuilderCheckpointAdmission(options.checkpointAdmission);
  } catch {
    fail("AGENTMO_CODEX_UAT_OBSERVATION_REJECTED");
  }
  await assertObservationAdmission(options.observationAdmission);
  const challenge = options.checkpointAdmission.value.codexUatChallenge;
  const observation = options.observationAdmission.value;
  if (challenge === null
    || challenge.attemptId !== view.state.attemptId
    || challenge.scenario !== view.state.nextScenario
    || observation.attemptId !== challenge.attemptId
    || observation.scenario !== challenge.scenario
    || observation.correlation !== challenge.correlation) {
    fail("AGENTMO_CODEX_UAT_OBSERVATION_REJECTED");
  }
  return appendClosedEntry({
    journalPath: options.journalPath,
    expectedHeadAdmission: options.expectedHeadAdmission,
    attemptId: view.state.attemptId,
    kind: "scenario-observed",
    details: {
      scenario: view.state.nextScenario,
      checkpointLeafDigest: options.checkpointAdmission.digest,
      observationLeafDigest: options.observationAdmission.digest,
      evidence: options.evidence,
    },
  });
}

export async function publishCodexUatCandidate(options) {
  const canonical = await canonicalCodexUatMutationModule();
  if (canonical !== null) return canonical.publishCodexUatCandidate(options);
  assertBuilderPlatform();
  if (!exactKeysWithOptional(
    options,
    ["journalPath", "expectedHeadAdmission", "candidateDirectory"],
    ["parentAuthority"],
  )
    || typeof options.candidateDirectory !== "string"
    || options.candidateDirectory.length === 0) {
    fail("AGENTMO_CODEX_UAT_REQUEST_REJECTED");
  }
  const view = await exactCurrentView(options.journalPath, options.expectedHeadAdmission);
  if (view.state.phase !== "scenarios-complete") {
    fail("AGENTMO_CODEX_UAT_CANDIDATE_PRECONDITION_REJECTED");
  }
  const candidate = buildCandidate(view);
  const published = await publishContentAddressedLeaf(
    options.candidateDirectory,
    candidate,
    "builder-codex-uat-candidate",
    {
      parentAuthority: options.parentAuthority,
    },
  );
  const admission = Object.freeze({
    subject: "builder-codex-uat-candidate",
    ...published,
  });
  CANDIDATE_ADMISSIONS.add(admission);
  return admission;
}

export async function loadCodexUatCandidate(filePath, options = {}) {
  const canonical = await canonicalCodexUatMutationModule();
  if (canonical !== null) return canonical.loadCodexUatCandidate(filePath, options);
  assertBuilderPlatform();
  if (!exactKeys(options, ["expectedDigest"]) || !isDigest(options.expectedDigest)) {
    fail("AGENTMO_CODEX_UAT_REQUEST_REJECTED");
  }
  const loaded = await loadCanonicalLeaf(
    filePath,
    options.expectedDigest,
    validateCodexUatCandidate,
    "builder-codex-uat-candidate",
  );
  const admission = Object.freeze({
    subject: "builder-codex-uat-candidate",
    ...loaded,
  });
  CANDIDATE_ADMISSIONS.add(admission);
  return admission;
}

export async function loadExistingCodexUatCandidate(options) {
  const canonical = await canonicalCodexUatMutationModule();
  if (canonical !== null) return canonical.loadExistingCodexUatCandidate(options);
  assertBuilderPlatform();
  if (!exactKeysWithOptional(
    options,
    ["journalPath", "expectedHeadAdmission", "candidateDirectory"],
    ["parentAuthority"],
  )
    || typeof options.candidateDirectory !== "string"
    || options.candidateDirectory.length === 0) {
    fail("AGENTMO_CODEX_UAT_REQUEST_REJECTED");
  }
  const view = await exactCurrentView(options.journalPath, options.expectedHeadAdmission);
  if (view.state.phase !== "scenarios-complete") {
    fail("AGENTMO_CODEX_UAT_CANDIDATE_PRECONDITION_REJECTED");
  }
  const expected = buildCandidate(view);
  const bytes = canonicalBytes(expected, "builder-codex-uat-candidate");
  const digest = digestRawBytes(bytes);
  let loaded;
  const retained = await useLeafDirectoryAuthority(
    options.candidateDirectory,
    options.parentAuthority,
  );
  const filePath = path.join(
    retained.authority.directory,
    `${digest.slice("sha256:".length)}.json`,
  );
  try {
    await assertLeafDirectoryAuthority(retained.authority);
    loaded = await loadCanonicalLeaf(
      filePath,
      digest,
      validateCodexUatCandidate,
      "builder-codex-uat-candidate",
    );
    await assertLeafDirectoryAuthority(retained.authority);
  } catch {
    fail("AGENTMO_CODEX_UAT_CANDIDATE_REJECTED");
  } finally {
    if (retained.owned) await releaseCodexUatLeafDirectoryAuthority(retained.authority);
  }
  if (!bytes.equals(loaded.bytes)) fail("AGENTMO_CODEX_UAT_CANDIDATE_REJECTED");
  const admission = Object.freeze({
    subject: "builder-codex-uat-candidate",
    ...loaded,
    filePath,
    created: false,
  });
  CANDIDATE_ADMISSIONS.add(admission);
  return admission;
}

export async function appendCodexUatCandidateReady(options) {
  const canonical = await canonicalCodexUatMutationModule();
  if (canonical !== null) return canonical.appendCodexUatCandidateReady(options);
  assertBuilderPlatform();
  if (!exactKeys(options, [
    "journalPath",
    "expectedHeadAdmission",
    "candidatePath",
    "expectedCandidateDigest",
  ])
    || typeof options.candidatePath !== "string"
    || options.candidatePath.length === 0
    || !isDigest(options.expectedCandidateDigest)) {
    fail("AGENTMO_CODEX_UAT_REQUEST_REJECTED");
  }
  const view = await exactCurrentView(options.journalPath, options.expectedHeadAdmission);
  if (view.state.phase !== "scenarios-complete") {
    fail("AGENTMO_CODEX_UAT_TRANSITION_REJECTED");
  }
  let loaded;
  try {
    loaded = await loadCanonicalLeaf(
      options.candidatePath,
      options.expectedCandidateDigest,
      validateCodexUatCandidate,
      "builder-codex-uat-candidate",
    );
  } catch (error) {
    if (error instanceof BuilderCodexUatError) {
      fail("AGENTMO_CODEX_UAT_CANDIDATE_REJECTED");
    }
    throw error;
  }
  const expected = buildCandidate(view);
  if (!canonicalBytes(expected, "builder-codex-uat-candidate").equals(loaded.bytes)) {
    fail("AGENTMO_CODEX_UAT_CANDIDATE_REJECTED");
  }
  return appendClosedEntry({
    journalPath: options.journalPath,
    expectedHeadAdmission: options.expectedHeadAdmission,
    attemptId: view.state.attemptId,
    kind: "candidate-ready",
    details: { candidateDigest: options.expectedCandidateDigest },
  });
}

export async function verifyCodexUatCandidateDecision(options) {
  const canonical = await canonicalCodexUatMutationModule();
  if (canonical !== null) return canonical.verifyCodexUatCandidateDecision(options);
  assertBuilderPlatform();
  const keys = [
    "packageRoot", "successorTarballPath", "journalPath", "candidatePath",
    "expectedHeadDigest", "expectedCandidateDigest", "expectedSuccessorVersion",
    "expectedReleaseDigest", "expectedTarballDigest", "decision",
  ];
  if (!exactKeys(options, keys)
    || typeof options.packageRoot !== "string"
    || options.packageRoot.length === 0
    || typeof options.successorTarballPath !== "string"
    || options.successorTarballPath.length === 0
    || typeof options.journalPath !== "string"
    || options.journalPath.length === 0
    || typeof options.candidatePath !== "string"
    || options.candidatePath.length === 0
    || !VERSION_PATTERN.test(options.expectedSuccessorVersion ?? "")
    || ![null, "approve", "reject"].includes(options.decision)
    || [
      options.expectedHeadDigest,
      options.expectedCandidateDigest,
      options.expectedReleaseDigest,
      options.expectedTarballDigest,
    ].some((value) => !isDigest(value))) {
    fail("AGENTMO_CODEX_UAT_REQUEST_REJECTED");
  }
  const release = await inspectVerifierRelease(options);
  const journalPath = path.resolve(options.journalPath);
  const view = await loadCodexUatAttemptJournal(journalPath);
  if (view.head === null || view.head.digest !== options.expectedHeadDigest) {
    fail("AGENTMO_CODEX_UAT_HEAD_MISMATCH");
  }
  if (view.recoveryRequired) {
    fail("AGENTMO_CODEX_UAT_CANDIDATE_REJECTED");
  }
  const ready = view.entries.at(-1);
  if (view.state.phase !== "candidate-ready"
    || view.state.terminal
    || view.state.scenarioCount !== CODEX_UAT_SCENARIO_IDS.length
    || ready?.kind !== "candidate-ready"
    || ready.details.candidateDigest !== options.expectedCandidateDigest
    || view.state.candidateDigest !== options.expectedCandidateDigest
    || view.state.successor?.packageName !== release.packageName
    || view.state.successor?.version !== release.version
    || view.state.successor?.releaseDigest !== release.releaseDigest
    || view.state.successor?.tarballDigest !== release.tarballDigest
    || !sameReleaseMember(view.state.baseline, release.baseline)
    || !sameReleaseMember(view.state.successor, release.successor)
    || view.state.releaseSet?.operationId !== release.operationId
    || view.state.releaseSet?.releaseSetDigest !== release.releaseSetDigest) {
    fail("AGENTMO_CODEX_UAT_CANDIDATE_REJECTED");
  }
  const candidate = await loadCodexUatCandidate(options.candidatePath, {
    expectedDigest: options.expectedCandidateDigest,
  });
  const basisEntries = view.entries.slice(0, -1);
  if (basisEntries.length !== 4 + CODEX_UAT_SCENARIO_IDS.length
    || candidate.value.attemptId !== view.state.attemptId
    || candidate.value.successorPackageName !== release.packageName
    || candidate.value.successorVersion !== release.version
    || candidate.value.releaseDigest !== release.releaseDigest
    || candidate.value.tarballDigest !== release.tarballDigest
    || !sameReleaseSetBinding(candidate.value.releaseSet, view.state.releaseSet)
    || candidate.value.successorRole !== "successor"
    || candidate.value.scenarioCount !== CODEX_UAT_SCENARIO_IDS.length
    || candidate.value.orderedEvidenceDigest !== orderedEvidenceDigest(basisEntries)) {
    fail("AGENTMO_CODEX_UAT_CANDIDATE_REJECTED");
  }
  const preview = Object.freeze({
    schemaVersion: "agentmo.codex-uat-candidate-preview.v2",
    status: "eligible",
    headDigest: view.head.digest,
    candidateDigest: candidate.digest,
    packageName: release.packageName,
    version: release.version,
    releaseDigest: release.releaseDigest,
    tarballDigest: release.tarballDigest,
    verifierDigest: release.verifierDigest,
    releaseSetOperationId: release.operationId,
    releaseSetDigest: release.releaseSetDigest,
  });
  if (options.decision === null) return preview;
  return Object.freeze({
    preview,
    reportedDecision: Object.freeze({
      schemaVersion: "agentmo.codex-uat-caller-reported-decision.v2",
      status: options.decision === "approve"
        ? "caller-reported-approval"
        : "caller-reported-rejection",
      decision: options.decision,
      headDigest: preview.headDigest,
      candidateDigest: preview.candidateDigest,
      verifierDigest: preview.verifierDigest,
      releaseSetOperationId: preview.releaseSetOperationId,
      releaseSetDigest: preview.releaseSetDigest,
      terminal: false,
      journalMutated: false,
      humanAuthorityVerified: false,
      externalDecisionAuthorityRequired: true,
    }),
  });
}

export function validateCodexUatCandidate(value) {
  if (!exactKeys(value, CANDIDATE_KEYS)
    || value.schemaVersion !== CODEX_UAT_CANDIDATE_SCHEMA_VERSION
    || value.status !== "candidate"
    || !ATTEMPT_ID_PATTERN.test(value.attemptId ?? "")
    || !PACKAGE_NAME_PATTERN.test(value.successorPackageName ?? "")
    || !VERSION_PATTERN.test(value.successorVersion ?? "")
    || !isDigest(value.releaseDigest)
    || !isDigest(value.tarballDigest)
    || !isDigest(value.orderedEvidenceDigest)
    || value.scenarioCount !== CODEX_UAT_SCENARIO_IDS.length
    || value.humanAdmissionRequired !== true
    || [
      value.hostOriginCryptographicallyVerified,
      value.realCodexSessionVerified,
      value.agentPackageQualityCertified,
      value.domainQualityCertified,
      value.productionReady,
      value.widerCompatibilityCertified,
    ].some((flag) => flag !== false)) {
    fail("AGENTMO_CODEX_UAT_CANDIDATE_REJECTED");
  }
  if (value.successorRole !== "successor") {
    fail("AGENTMO_CODEX_UAT_CANDIDATE_REJECTED");
  }
  normalizeReleaseSetBinding(value.releaseSet, "AGENTMO_CODEX_UAT_CANDIDATE_REJECTED");
  assertNoJournalAuthorityFields(value, "AGENTMO_CODEX_UAT_CANDIDATE_REJECTED");
  assertPersistable(value, { subject: "builder-codex-uat-candidate" });
  deepFreeze(value);
  return { ok: true };
}

export function validateCodexUatObservation(value) {
  if (!exactKeys(value, OBSERVATION_KEYS)
    || value.schemaVersion !== CODEX_UAT_OBSERVATION_SCHEMA_VERSION
    || !ATTEMPT_ID_PATTERN.test(value.attemptId ?? "")
    || !CODEX_UAT_SCENARIO_IDS.includes(value.scenario)
    || !CORRELATION_PATTERN.test(value.correlation ?? "")
    || !["installed-hook-untrusted", "operator-observation"].includes(value.source)
    || [
      value.eventDigest,
      value.runnerDigest,
      value.releaseDigest,
      value.installReceiptDigest,
    ].some((item) => !isDigest(item))
    || [
      value.claimsHostOrigin,
      value.claimsScenarioSuccess,
      value.realCodexSessionVerified,
      value.agentPackageQualityCertified,
      value.domainQualityCertified,
      value.productionReady,
      value.widerCompatibilityCertified,
    ].some((flag) => flag !== false)) {
    fail("AGENTMO_CODEX_UAT_OBSERVATION_REJECTED");
  }
  assertNoJournalAuthorityFields(value, "AGENTMO_CODEX_UAT_OBSERVATION_REJECTED");
  assertPersistable(value, { subject: "builder-codex-uat-observation" });
  deepFreeze(value);
  return { ok: true };
}

async function loadReleaseEvidence(value, expectedRole) {
  if (!exactKeys(value, ["packageRoot", "tarballPath"])
    || typeof value.packageRoot !== "string"
    || value.packageRoot.length === 0
    || typeof value.tarballPath !== "string"
    || value.tarballPath.length === 0) {
    fail("AGENTMO_CODEX_UAT_REQUEST_REJECTED");
  }
  let admission;
  try {
    admission = await admitBuilderUatReleaseMember({
      packageRoot: value.packageRoot,
      tarballPath: value.tarballPath,
      expectedRole,
      maxBytes: MAX_UAT_TARBALL_BYTES,
    });
  } catch {
    fail("AGENTMO_CODEX_UAT_RELEASE_EVIDENCE_REJECTED");
  }
  return Object.freeze({
    identity: Object.freeze({
      packageName: admission.packageName,
      version: admission.version,
      releaseDigest: admission.releaseDigest,
      tarballDigest: admission.tarballDigest,
    }),
    pair: normalizeAdmittedReleasePair(admission.releaseSet, "AGENTMO_CODEX_UAT_RELEASE_EVIDENCE_REJECTED"),
    operationId: admission.operationId,
    releaseSetDigest: admission.releaseSetDigest,
  });
}

async function loadActivatedReceipt(filePath, expectedDigest, baseline) {
  if (typeof filePath !== "string" || filePath.length === 0 || !isDigest(expectedDigest)) {
    fail("AGENTMO_CODEX_UAT_REQUEST_REJECTED");
  }
  let bytes;
  let value;
  try {
    try {
      bytes = await readBoundedNoFollowFile(filePath);
    } catch {
      const resolvedReceiptPath = path.resolve(filePath);
      const projectRoot = path.dirname(path.dirname(path.dirname(resolvedReceiptPath)));
      const canonicalReceiptPath = path.join(
        projectRoot,
        ...BUILDER_INSTALL_RECEIPT_PATH.split("/"),
      );
      if (resolvedReceiptPath !== canonicalReceiptPath) throw new Error("receipt-path");
      const admission = await admitBuilderLifecycleReceipt({
        projectRoot,
        expectedReceiptDigest: expectedDigest,
      });
      bytes = canonicalBytes(admission.receipt, "builder-install-receipt");
    }
    if (digestRawBytes(bytes) !== expectedDigest) throw new Error("digest");
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!canonicalBytes(value, "builder-install-receipt").equals(bytes)) {
      throw new Error("canonical");
    }
  } catch {
    fail("AGENTMO_CODEX_UAT_SETUP_EVIDENCE_REJECTED");
  }
  const activationKeys = [
    "schemaVersion", "hostScope", "selector", "releaseDigest",
    "marketplaceProjectionDigest", "operationOrderDigest", "ownerDisposition",
    "ownerRecordDigest", "consumerId", "consumerEntryDigest",
    "consumerLedgerDigest", "consumerEntryOwned", "selectorDeletionAuthority",
    "expectedPostObservation", "finalProjectionBinding",
  ];
  if (!value
    || value.schemaVersion !== "agentmo.builder-install-receipt.v4"
    || value.status !== "activated"
    || !isDigest(value.planDigest)
    || !exactKeys(value.identity, ["name", "version", "adapterId", "releaseDigest"])
    || value.identity.name !== baseline.packageName
    || value.identity.version !== baseline.version
    || value.identity.adapterId !== "codex"
    || value.identity.releaseDigest !== baseline.releaseDigest
    || !exactKeys(value.evidence, [
      "level", "mechanismOnly", "codexActivationVerified",
      "hostBehaviorVerified", "domainQualityCertified",
    ])
    || value.evidence.level !== "host-observed"
    || value.evidence.mechanismOnly !== true
    || value.evidence.codexActivationVerified !== false
    || value.evidence.hostBehaviorVerified !== false
    || value.evidence.domainQualityCertified !== false
    || !exactKeys(value.hostActivation, activationKeys)
    || value.hostActivation.schemaVersion !== "agentmo.builder-codex-activation-binding.v3"
    || value.hostActivation.hostScope !== "user"
    || value.hostActivation.releaseDigest !== value.identity.releaseDigest
    || !isDigest(value.hostActivation.consumerId)
    || value.hostActivation.consumerEntryOwned !== true
    || value.hostActivation.selectorDeletionAuthority !== false
    || !["created-by-agentmo", "preexisting-unowned"].includes(
      value.hostActivation.ownerDisposition,
    )
    || [
      value.hostActivation.marketplaceProjectionDigest,
      value.hostActivation.operationOrderDigest,
      value.hostActivation.ownerRecordDigest,
      value.hostActivation.consumerEntryDigest,
      value.hostActivation.consumerLedgerDigest,
    ].some((item) => !isDigest(item))
    || !value.hostActivation.selector
    || !exactKeys(value.hostActivation.selector, [
      "pluginId", "pluginName", "marketplaceName",
    ])
    || value.hostActivation.selector.pluginId !== "agentmo@agentmo-local"
    || value.hostActivation.selector.pluginName !== "agentmo"
    || value.hostActivation.selector.marketplaceName !== "agentmo-local"
    || !validActivationExpectedPostObservation(
      value.hostActivation.expectedPostObservation,
    )
    || !validActivatedReceiptProjectionBinding(
      value.hostActivation.finalProjectionBinding,
      value.hostActivation,
    )) {
    fail("AGENTMO_CODEX_UAT_SETUP_EVIDENCE_REJECTED");
  }
  assertPersistable(value, { subject: "builder-install-receipt" });
  return Object.freeze({ digest: expectedDigest, value: deepFreeze(value), bytes });
}

function validActivationExpectedPostObservation(value) {
  return exactKeys(value, [
    "installation", "enabled", "sourceMatch", "releaseMatch", "skillVisibility",
    "hooksVisibility", "trust", "agentHostVisibility",
  ])
    && value.installation === "installed"
    && value.enabled === true
    && value.sourceMatch === true
    && value.releaseMatch === true
    && value.skillVisibility === "visible"
    && value.hooksVisibility === "visible"
    && value.trust === "trusted-or-pending-human"
    && value.agentHostVisibility === "unobservable";
}

function validActivatedReceiptProjectionBinding(value, activation) {
  if (!exactKeys(value, [
    "schemaVersion", "transactionId", "transactionDigest", "releaseDigest",
    "contentDigest", "rootIdentity", "rootIdentityDigest", "members",
  ])
    || value.schemaVersion !== "agentmo.codex-marketplace-projection-binding.v1"
    || !/^[a-f0-9]{64}$/u.test(value.transactionId ?? "")
    || value.transactionId !== value.transactionDigest?.slice("sha256:".length)
    || !isDigest(value.transactionDigest)
    || value.releaseDigest !== activation.releaseDigest
    || value.contentDigest !== activation.marketplaceProjectionDigest
    || !validProjectionIdentity(value.rootIdentity)
    || value.rootIdentityDigest !== digestValue({
      schemaVersion: "agentmo.codex-marketplace-root-identity.v1",
      ...value.rootIdentity,
    }, "codex-marketplace-root-identity")
    || !Array.isArray(value.members)
    || value.members.length === 0) {
    return false;
  }
  for (const [index, member] of value.members.entries()) {
    if (!exactKeys(member, ["kind", "relativePath", "digest", "identity"])
      || !["root", "directory", "file"].includes(member.kind)
      || (index === 0
        ? member.kind !== "root" || member.relativePath !== ""
        : member.kind === "root" || !portableRelativePath(member.relativePath))
      || (member.kind === "file" ? !isDigest(member.digest) : member.digest !== null)
      || !validProjectionIdentity(member.identity)) {
      return false;
    }
  }
  return JSON.stringify(value.members[0].identity) === JSON.stringify(value.rootIdentity);
}

function validProjectionIdentity(value) {
  return exactKeys(value, [
    "device", "group", "inode", "links", "mode", "owner", "size",
  ])
    && ["device", "group", "inode", "links", "owner", "size"]
      .every((key) => /^\d+$/u.test(value[key] ?? ""))
    && /^[0-7]{3,4}$/u.test(value.mode ?? "");
}

function portableRelativePath(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 240
    && !value.includes("\\")
    && !value.includes("\0")
    && !path.posix.isAbsolute(value)
    && value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

async function loadExactEvidenceDigest(filePath, expectedDigest) {
  if (typeof filePath !== "string" || filePath.length === 0 || !isDigest(expectedDigest)) {
    fail("AGENTMO_CODEX_UAT_REQUEST_REJECTED");
  }
  let bytes;
  try {
    bytes = await readBoundedNoFollowFile(filePath);
  } catch {
    fail("AGENTMO_CODEX_UAT_EVIDENCE_REJECTED");
  }
  const digest = digestRawBytes(bytes);
  if (digest !== expectedDigest) fail("AGENTMO_CODEX_UAT_EVIDENCE_REJECTED");
  return digest;
}

async function inspectVerifierRelease(options) {
  const packageRoot = path.resolve(options.packageRoot);
  const verifierPath = path.join(packageRoot, VERIFIER_SOURCE_PATH);
  let admission;
  let manifestBytes;
  let verifierBytes;
  try {
    [admission, manifestBytes, verifierBytes] = await Promise.all([
      admitBuilderUatReleaseMember({
        packageRoot,
        tarballPath: options.successorTarballPath,
        expectedRole: "successor",
        maxBytes: MAX_UAT_TARBALL_BYTES,
      }),
      readBoundedNoFollowFile(path.join(packageRoot, RELEASE_MANIFEST_PATH)),
      readBoundedNoFollowFile(verifierPath),
    ]);
  } catch {
    fail("AGENTMO_CODEX_UAT_VERIFIER_SELF_REJECTED");
  }
  const release = admission.release;
  const pair = normalizeAdmittedReleasePair(
    admission.releaseSet,
    "AGENTMO_CODEX_UAT_VERIFIER_SELF_REJECTED",
  );
  const manifest = parseVerifierReleaseManifest(manifestBytes);
  const verifierDigest = digestRawBytes(verifierBytes);
  const tarballDigest = admission.tarballDigest;
  const verifierAsset = release.assets.find((asset) => asset.sourcePath === VERIFIER_SOURCE_PATH);
  const continuationAsset = release.assets.find(
    (asset) => asset.sourcePath === CONTINUATION_SOURCE_PATH,
  );
  if (release.name !== "agentmo"
    || release.version !== options.expectedSuccessorVersion
    || release.releaseDigest !== options.expectedReleaseDigest
    || tarballDigest !== options.expectedTarballDigest
    || admission.manifestDigest !== digestRawBytes(manifestBytes)
    || admission.verifierDigest !== verifierDigest
    || admission.continuationDigest !== continuationAsset?.digest
    || !sameReleaseMember({
      packageName: admission.packageName,
      version: admission.version,
      releaseDigest: admission.releaseDigest,
      tarballDigest: admission.tarballDigest,
    }, pair.successor)
    || manifest.packageName !== release.name
    || manifest.version !== release.version
    || manifest.verifier.sha256 !== verifierDigest
    || verifierAsset?.digest !== verifierDigest
    || manifest.continuation.sha256 !== continuationAsset?.digest) {
    fail("AGENTMO_CODEX_UAT_VERIFIER_SELF_REJECTED");
  }
  return Object.freeze({
    packageName: release.name,
    version: release.version,
    releaseDigest: release.releaseDigest,
    tarballDigest,
    verifierDigest,
    baseline: pair.baseline,
    successor: pair.successor,
    operationId: admission.operationId,
    releaseSetDigest: admission.releaseSetDigest,
  });
}

function parseVerifierReleaseManifest(bytes) {
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail("AGENTMO_CODEX_UAT_VERIFIER_SELF_REJECTED");
  }
  if (!exactKeys(value, ["schemaVersion", "packageName", "version", "continuation", "verifier"])
    || value.schemaVersion !== "agentmo.codex-uat-release-manifest.v1"
    || value.packageName !== "agentmo"
    || !VERSION_PATTERN.test(value.version ?? "")
    || !exactVerifierIdentity(value.continuation, CONTINUATION_SOURCE_PATH)
    || !exactVerifierIdentity(value.verifier, VERIFIER_SOURCE_PATH)
    || value.continuation.sha256 === value.verifier.sha256
    || !canonicalBytes(value, "builder-codex-uat-release-manifest").equals(bytes)) {
    fail("AGENTMO_CODEX_UAT_VERIFIER_SELF_REJECTED");
  }
  return Object.freeze(value);
}

function exactVerifierIdentity(value, sourcePath) {
  return exactKeys(value, ["sourcePath", "sha256"])
    && value.sourcePath === sourcePath
    && isDigest(value.sha256);
}

async function appendClosedEntry(options) {
  const journalPath = path.resolve(options.journalPath);
  let current;
  if (options.expectedHeadAdmission === null) {
    current = await loadCodexUatAttemptJournal(journalPath);
    if (current.head !== null || options.kind !== "attempt-started") {
      fail("AGENTMO_CODEX_UAT_TRANSITION_REJECTED");
    }
  } else {
    current = await exactCurrentView(journalPath, options.expectedHeadAdmission);
  }
  const sequence = current.entries.length;
  const predecessorDigest = current.head?.digest ?? null;
  const details = normalizeDetails(options.kind, options.details, current.state);
  const evidenceDigests = Object.freeze(collectDigestValues(details));
  const entry = {
    schemaVersion: CODEX_UAT_ATTEMPT_JOURNAL_SCHEMA_VERSION,
    attemptId: options.attemptId,
    sequence,
    kind: options.kind,
    predecessorDigest,
    evidenceDigests,
    details,
  };
  validateEntry(entry);
  const nextInternal = applyTransition(internalStateFromView(current), entry);
  const bytes = canonicalBytes(entry, "builder-codex-uat-attempt-entry");
  let appendResult;
  try {
    appendResult = await appendImmutableJournalEntry({
      journalPath,
      canonicalBytes: bytes,
      maxValueBytes: MAX_UAT_ENTRY_BYTES,
      authorityCapability: UAT_JOURNAL_APPEND_CAPABILITY,
      ...(current.head === null
        ? {}
        : { expectedPredecessorAdmission: HEAD_DETAILS.get(options.expectedHeadAdmission).journalAdmission }),
    });
  } catch (error) {
    mapJournalError(error);
  }
  if (!appendResult.committed || appendResult.head === null) {
    fail("AGENTMO_CODEX_UAT_JOURNAL_CONFLICT_REJECTED");
  }
  const reloaded = await loadCodexUatAttemptJournal(journalPath);
  if (reloaded.head === null
    || reloaded.head.digest !== appendResult.head.digest
    || reloaded.entries.length !== sequence + 1
    || reloaded.state.phase !== projectState(nextInternal, [...current.entries, entry]).phase) {
    fail("AGENTMO_CODEX_UAT_JOURNAL_CONFLICT_REJECTED");
  }
  return Object.freeze({
    ...reloaded,
    appendStatus: appendResult.status,
    recoveryRequired: appendResult.recoveryRequired,
  });
}

async function exactCurrentView(journalPath, expectedHeadAdmission) {
  assertHeadAdmission(expectedHeadAdmission, journalPath);
  const loaded = await loadCodexUatAttemptJournal(journalPath);
  if (loaded.head === null
    || loaded.head.digest !== expectedHeadAdmission.digest
    || loaded.head.sequence !== expectedHeadAdmission.sequence
    || loaded.head.publicationDigest !== expectedHeadAdmission.publicationDigest) {
    fail("AGENTMO_CODEX_UAT_HEAD_MISMATCH");
  }
  return loaded;
}

function entryFromJournalAdmission(journalAdmission) {
  try {
    assertImmutableJournalAdmission(journalAdmission);
  } catch (error) {
    mapJournalError(error);
  }
  const bytes = readImmutableJournalAdmissionBytes(journalAdmission);
  let entry;
  try {
    entry = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail("AGENTMO_CODEX_UAT_JOURNAL_CONFLICT_REJECTED");
  }
  try {
    validateEntry(entry);
  } catch {
    fail("AGENTMO_CODEX_UAT_JOURNAL_CONFLICT_REJECTED");
  }
  const canonical = canonicalBytes(entry, "builder-codex-uat-attempt-entry");
  if (!canonical.equals(bytes)
    || journalAdmission.sequence !== entry.sequence
    || journalAdmission.predecessorDigest !== entry.predecessorDigest
    || journalAdmission.digest !== digestRawBytes(bytes)) {
    fail("AGENTMO_CODEX_UAT_JOURNAL_CONFLICT_REJECTED");
  }
  deepFreeze(entry);
  return entry;
}

function validateEntry(entry) {
  if (!exactKeys(entry, ENTRY_KEYS)
    || entry.schemaVersion !== CODEX_UAT_ATTEMPT_JOURNAL_SCHEMA_VERSION
    || !ATTEMPT_ID_PATTERN.test(entry.attemptId ?? "")
    || !Number.isSafeInteger(entry.sequence)
    || entry.sequence < 0
    || (entry.sequence === 0
      ? entry.predecessorDigest !== null
      : !isDigest(entry.predecessorDigest))
    || !Array.isArray(entry.evidenceDigests)
    || entry.evidenceDigests.length === 0
    || entry.evidenceDigests.some((item) => !isDigest(item))
    || new Set(entry.evidenceDigests).size !== entry.evidenceDigests.length
    || !entry.details
    || typeof entry.details !== "object"
    || Array.isArray(entry.details)
    || ![
      ...ENTRY_KINDS,
      "candidate-ready",
    ].includes(entry.kind)) {
    fail("AGENTMO_CODEX_UAT_ENTRY_REJECTED");
  }
  const normalized = normalizeDetails(entry.kind, entry.details, null);
  if (!canonicalBytes(normalized, "builder-codex-uat-entry-details")
    .equals(canonicalBytes(entry.details, "builder-codex-uat-entry-details"))) {
    fail("AGENTMO_CODEX_UAT_ENTRY_REJECTED");
  }
  if (!arrayEqual(entry.evidenceDigests, collectDigestValues(entry.details))) {
    fail("AGENTMO_CODEX_UAT_ENTRY_REJECTED");
  }
  assertNoJournalAuthorityFields(entry.details, "AGENTMO_CODEX_UAT_ENTRY_REJECTED");
  assertPersistable(entry, { subject: "builder-codex-uat-attempt-entry" });
  return { ok: true };
}

function normalizeDetails(kind, details, state) {
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    fail("AGENTMO_CODEX_UAT_ENTRY_REJECTED");
  }
  if (kind === "attempt-started") {
    if (!exactKeys(details, ["releaseSet", "baseline", "successor"])) entryRejected();
    const releaseSet = normalizeReleaseSetBinding(details.releaseSet);
    const baseline = normalizeReleaseMember(details.baseline, "baseline");
    const successor = normalizeReleaseMember(details.successor, "successor");
    if (baseline.version === successor.version
      || baseline.releaseDigest === successor.releaseDigest
      || baseline.tarballDigest === successor.tarballDigest) entryRejected();
    return deepFreeze({ releaseSet, baseline, successor });
  }
  if (kind === "setup-applied") {
    const keys = [
      "baselineVersion", "releaseDigest", "tarballDigest", "setupPlanDigest",
      "installReceiptDigest", "checkpointDigest", "marketplaceOwnerDigest",
      "marketplaceConsumerDigest",
    ];
    if (!exactKeys(details, keys)
      || !VERSION_PATTERN.test(details.baselineVersion ?? "")
      || keys.filter((key) => key !== "baselineVersion").some((key) => !isDigest(details[key]))) {
      entryRejected();
    }
    if (state?.baseline && (
      details.baselineVersion !== state.baseline.version
      || details.releaseDigest !== state.baseline.releaseDigest
      || details.tarballDigest !== state.baseline.tarballDigest
    )) entryRejected();
    return deepFreeze({ ...details });
  }
  if (kind === "activation-applied") {
    const keys = [
      "activationPlanDigest", "marketplaceDigest", "selectorDigest", "ownerDigest",
      "consumerLedgerDigest", "hostObservationDigest", "releaseDigest",
      "installReceiptDigest", "checkpointDigest",
    ];
    if (!exactKeys(details, keys) || keys.some((key) => !isDigest(details[key]))) entryRejected();
    if (state?.setup && (
      details.releaseDigest !== state.setup.releaseDigest
      || details.installReceiptDigest !== state.setup.installReceiptDigest
    )) entryRejected();
    return deepFreeze({ ...details });
  }
  if (kind === "trust-auth-observed") {
    const keys = [
      "freshProcessDigest", "trustObservationDigest", "authObservationDigest", "observationBasis",
    ];
    if (!exactKeys(details, keys)
      || keys.filter((key) => key !== "observationBasis").some((key) => !isDigest(details[key]))
      || details.observationBasis !== "human-observed-no-cryptographic-origin") {
      entryRejected();
    }
    return deepFreeze({ ...details });
  }
  if (kind === "scenario-observed") {
    if (!exactKeys(details, ["scenario", "checkpointLeafDigest", "observationLeafDigest", "evidence"])
      || !CODEX_UAT_SCENARIO_IDS.includes(details.scenario)
      || !isDigest(details.checkpointLeafDigest)
      || !isDigest(details.observationLeafDigest)) {
      entryRejected();
    }
    const evidenceKeys = SCENARIO_EVIDENCE_KEYS[details.scenario];
    if (!exactKeys(details.evidence, evidenceKeys)) entryRejected();
    if (details.scenario === "upgrade-visibility") {
      if (!VERSION_PATTERN.test(details.evidence.successorVersion ?? "")
        || evidenceKeys.filter((key) => key !== "successorVersion")
          .some((key) => !isDigest(details.evidence[key]))) entryRejected();
      if (state?.successor && (
        details.evidence.successorVersion !== state.successor.version
        || details.evidence.releaseDigest !== state.successor.releaseDigest
        || details.evidence.tarballDigest !== state.successor.tarballDigest
      )) entryRejected();
    } else if (details.scenario === "deactivation-tombstone-visibility") {
      if ([
        details.evidence.deactivationPlanDigest,
        details.evidence.visibilityDigest,
        details.evidence.lifecycleHeadDigest,
        details.evidence.tombstoneDigest,
        details.evidence.activeReceiptDigest,
      ].some((digest) => !isDigest(digest))
        || details.evidence.launcherPreserved !== true
        || details.evidence.currentReceiptPreserved !== true) entryRejected();
    } else if (details.scenario === "duplicate-replay") {
      if (!isDigest(details.evidence.beforeCheckpointDigest)
        || details.evidence.beforeCheckpointDigest !== details.evidence.afterCheckpointDigest) {
        entryRejected();
      }
    } else if (evidenceKeys.some((key) => !isDigest(details.evidence[key]))) {
      entryRejected();
    }
    return deepFreeze({
      scenario: details.scenario,
      checkpointLeafDigest: details.checkpointLeafDigest,
      observationLeafDigest: details.observationLeafDigest,
      evidence: { ...details.evidence },
    });
  }
  if (["failure", "interruption"].includes(kind)) {
    if (!exactKeys(details, ["code", "evidenceDigest"])
      || !OUTCOME_CODE_PATTERN.test(details.code ?? "")
      || !isDigest(details.evidenceDigest)) entryRejected();
    return deepFreeze({ ...details });
  }
  if (kind === "candidate-ready") {
    if (!exactKeys(details, ["candidateDigest"]) || !isDigest(details.candidateDigest)) entryRejected();
    return deepFreeze({ ...details });
  }
  entryRejected();
}

function normalizeReleaseMember(value, expectedRole, code = "AGENTMO_CODEX_UAT_ENTRY_REJECTED") {
  const keys = ["role", "packageName", "version", "releaseDigest", "tarballDigest"];
  if (!exactKeys(value, keys)
    || value.role !== expectedRole
    || !PACKAGE_NAME_PATTERN.test(value.packageName ?? "")
    || !VERSION_PATTERN.test(value.version ?? "")
    || !isDigest(value.releaseDigest)
    || !isDigest(value.tarballDigest)) fail(code);
  return deepFreeze({ ...value });
}

function normalizeAdmittedReleasePair(value, code) {
  if (!exactKeys(value, ["baseline", "successor"])) fail(code);
  return deepFreeze({
    baseline: normalizeAdmittedReleaseMember(value.baseline, code),
    successor: normalizeAdmittedReleaseMember(value.successor, code),
  });
}

function normalizeAdmittedReleaseMember(value, code) {
  const keys = [
    "continuationDigest", "manifestDigest", "packageName", "releaseDigest",
    "tarballDigest", "verifierDigest", "version",
  ];
  if (!exactKeys(value, keys)
    || !PACKAGE_NAME_PATTERN.test(value.packageName ?? "")
    || !VERSION_PATTERN.test(value.version ?? "")
    || [
      value.releaseDigest,
      value.tarballDigest,
      value.manifestDigest,
      value.verifierDigest,
      value.continuationDigest,
    ].some((digest) => !isDigest(digest))) {
    fail(code);
  }
  return deepFreeze({
    packageName: value.packageName,
    version: value.version,
    releaseDigest: value.releaseDigest,
    tarballDigest: value.tarballDigest,
  });
}

function sameReleaseMember(left, right) {
  return left?.packageName === right?.packageName
    && left?.version === right?.version
    && left?.releaseDigest === right?.releaseDigest
    && left?.tarballDigest === right?.tarballDigest;
}

function sameReleasePair(left, right) {
  return sameReleaseMember(left?.baseline, right?.baseline)
    && sameReleaseMember(left?.successor, right?.successor);
}

function normalizeReleaseSetBinding(value, code = "AGENTMO_CODEX_UAT_ENTRY_REJECTED") {
  if (!exactKeys(value, ["operationId", "releaseSetDigest"])
    || !isDigest(value.operationId)
    || !isDigest(value.releaseSetDigest)) {
    fail(code);
  }
  return deepFreeze({
    operationId: value.operationId,
    releaseSetDigest: value.releaseSetDigest,
  });
}

function sameReleaseSetBinding(left, right) {
  return left?.operationId === right?.operationId
    && left?.releaseSetDigest === right?.releaseSetDigest;
}

function applyTransition(state, entry) {
  if (state.terminal
    || (state.attemptId !== null && entry.attemptId !== state.attemptId)) {
    transitionRejected();
  }
  if (entry.kind === "attempt-started") {
    if (state.phase !== "empty" || entry.sequence !== 0 || entry.predecessorDigest !== null) {
      transitionRejected();
    }
    return Object.freeze({
      ...state,
      attemptId: entry.attemptId,
      releaseSet: entry.details.releaseSet,
      baseline: entry.details.baseline,
      successor: entry.details.successor,
      phase: "started",
    });
  }
  if (state.phase === "empty") transitionRejected();
  if (["failure", "interruption"].includes(entry.kind)) {
    return Object.freeze({
      ...state,
      phase: entry.kind === "failure" ? "failed" : "interrupted",
      terminal: true,
      terminalCode: entry.details.code,
    });
  }
  if (state.phase === "started" && entry.kind === "setup-applied") {
    normalizeDetails(entry.kind, entry.details, state);
    return Object.freeze({ ...state, phase: "setup-applied", setup: entry.details });
  }
  if (state.phase === "setup-applied" && entry.kind === "activation-applied") {
    normalizeDetails(entry.kind, entry.details, state);
    return Object.freeze({ ...state, phase: "activation-applied", activation: entry.details });
  }
  if (state.phase === "activation-applied" && entry.kind === "trust-auth-observed") {
    return Object.freeze({ ...state, phase: "trust-auth-observed" });
  }
  if (["trust-auth-observed", "observing"].includes(state.phase)
    && entry.kind === "scenario-observed") {
    const expected = CODEX_UAT_SCENARIO_IDS[state.scenarioCount];
    if (entry.details.scenario !== expected) {
      fail("AGENTMO_CODEX_UAT_SCENARIO_ORDER_REJECTED");
    }
    normalizeDetails(entry.kind, entry.details, state);
    const scenarioCount = state.scenarioCount + 1;
    return Object.freeze({
      ...state,
      phase: scenarioCount === CODEX_UAT_SCENARIO_IDS.length
        ? "scenarios-complete"
        : "observing",
      scenarioCount,
    });
  }
  if (state.phase === "scenarios-complete" && entry.kind === "candidate-ready") {
    return Object.freeze({
      ...state,
      phase: "candidate-ready",
      candidateDigest: entry.details.candidateDigest,
    });
  }
  transitionRejected();
}

function initialState() {
  return Object.freeze({
    attemptId: null,
    releaseSet: null,
    baseline: null,
    successor: null,
    setup: null,
    activation: null,
    phase: "empty",
    scenarioCount: 0,
    candidateDigest: null,
    terminal: false,
    terminalCode: null,
  });
}

function projectState(state, entries) {
  const nextScenario = ["trust-auth-observed", "observing"].includes(state.phase)
    ? CODEX_UAT_SCENARIO_IDS[state.scenarioCount] ?? null
    : null;
  const actions = {
    empty: "start",
    started: "apply-setup",
    "setup-applied": "apply-activation",
    "activation-applied": "start-fresh-codex",
    "trust-auth-observed": "scenario-arm",
    observing: "scenario-arm",
    "scenarios-complete": "publish-candidate",
    "candidate-ready": "external-decision-authority",
    failed: null,
    interrupted: null,
  };
  return deepFreeze({
    attemptId: state.attemptId,
    phase: state.phase,
    terminal: state.terminal,
    terminalCode: state.terminalCode,
    nextAction: actions[state.phase],
    nextScenario,
    scenarioCount: state.scenarioCount,
    candidateDigest: state.candidateDigest,
    orderedEvidenceDigest: orderedEvidenceDigest(entries),
    releaseSet: state.releaseSet,
    baseline: state.baseline,
    successor: state.successor,
  });
}

function internalStateFromView(view) {
  if (view.head === null) return initialState();
  let state = initialState();
  for (const entry of view.entries) state = applyTransition(state, entry);
  return state;
}

function emptyView(journalPath, recoveryRequired = false) {
  return Object.freeze({
    schemaVersion: CODEX_UAT_ATTEMPT_JOURNAL_SCHEMA_VERSION,
    entries: Object.freeze([]),
    head: null,
    state: projectState(initialState(), []),
    journalPath,
    recoveryRequired,
  });
}

function mintHeadAdmission(journalAdmission, journalPath, entry, state) {
  const admission = Object.freeze({
    subject: "builder-codex-uat-attempt-head",
    digest: journalAdmission.digest,
    publicationDigest: journalAdmission.publicationDigest,
    sequence: journalAdmission.sequence,
    predecessorDigest: journalAdmission.predecessorDigest,
    attemptId: entry.attemptId,
    kind: entry.kind,
    state: projectState(state, []),
  });
  HEAD_ADMISSIONS.add(admission);
  HEAD_DETAILS.set(admission, Object.freeze({ journalAdmission, journalPath }));
  return admission;
}

function assertHeadAdmission(admission, journalPath) {
  if (!admission || !HEAD_ADMISSIONS.has(admission)) {
    fail("AGENTMO_CODEX_UAT_HEAD_ADMISSION_REQUIRED");
  }
  const details = HEAD_DETAILS.get(admission);
  if (!details || details.journalPath !== path.resolve(journalPath)) {
    fail("AGENTMO_CODEX_UAT_HEAD_ADMISSION_REQUIRED");
  }
  try {
    assertImmutableJournalAdmission(details.journalAdmission);
  } catch {
    fail("AGENTMO_CODEX_UAT_HEAD_ADMISSION_REQUIRED");
  }
  return admission;
}

async function assertObservationAdmission(admission) {
  if (!admission
    || !OBSERVATION_ADMISSIONS.has(admission)
    || admission.subject !== "builder-codex-uat-observation"
    || !isDigest(admission.digest)
    || !admission.value
    || typeof admission.filePath !== "string"
    || admission.filePath.length === 0) {
    fail("AGENTMO_CODEX_UAT_OBSERVATION_REJECTED");
  }
  validateCodexUatObservation(admission.value);
  if (digestRawBytes(canonicalBytes(
    admission.value,
    "builder-codex-uat-observation",
  )) !== admission.digest) {
    fail("AGENTMO_CODEX_UAT_OBSERVATION_REJECTED");
  }
  const loaded = await loadCanonicalLeaf(
    admission.filePath,
    admission.digest,
    validateCodexUatObservation,
    "builder-codex-uat-observation",
  );
  if (!canonicalBytes(
    admission.value,
    "builder-codex-uat-observation",
  ).equals(loaded.bytes)) {
    fail("AGENTMO_CODEX_UAT_OBSERVATION_REJECTED");
  }
  return admission;
}

function buildCandidate(view) {
  const successor = view.state.successor;
  const value = {
    schemaVersion: CODEX_UAT_CANDIDATE_SCHEMA_VERSION,
    attemptId: view.state.attemptId,
    status: "candidate",
    releaseSet: view.state.releaseSet,
    successorRole: "successor",
    successorPackageName: successor.packageName,
    successorVersion: successor.version,
    releaseDigest: successor.releaseDigest,
    tarballDigest: successor.tarballDigest,
    orderedEvidenceDigest: view.state.orderedEvidenceDigest,
    scenarioCount: CODEX_UAT_SCENARIO_IDS.length,
    humanAdmissionRequired: true,
    hostOriginCryptographicallyVerified: false,
    realCodexSessionVerified: false,
    agentPackageQualityCertified: false,
    domainQualityCertified: false,
    productionReady: false,
    widerCompatibilityCertified: false,
  };
  validateCodexUatCandidate(value);
  return value;
}

export async function retainCodexUatLeafDirectoryAuthority(directory) {
  const canonical = await canonicalCodexUatMutationModule();
  if (canonical !== null) return canonical.retainCodexUatLeafDirectoryAuthority(directory);
  assertBuilderPlatform();
  if (typeof directory !== "string" || directory.length === 0) {
    fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
  }
  let authority;
  try {
    const bootstrap = await resolveLeafDirectoryBootstrap(directory);
    authority = await acquireLeafDirectoryAuthority(bootstrap.anchor);
    for (const name of bootstrap.children) {
      let expectedIdentity = await inspectRetainedLeafDirectoryChild(authority, name);
      if (expectedIdentity === null) {
        let created;
        try {
          created = await runBuilderPosixEffect({
            action: "mkdir",
            name,
            payload: "",
          }, {
            directoryAuthority: leafEffectDirectoryAuthority(authority),
          });
        } catch (error) {
          if (/^AGENTMO_BUILDER_POSIX_EFFECT_/u.test(error?.code ?? "")) {
            fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
          }
          throw error;
        }
        if (created.kind !== "directory") fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
        expectedIdentity = created.identity;
      }
      authority = await acquireLeafDirectoryAuthority(
        path.join(authority.directory, name),
        {
          parentAuthority: authority,
          name,
          expectedIdentity,
        },
      );
    }
    return authority;
  } catch (error) {
    if (authority !== undefined) {
      await discardLeafDirectoryAuthorityChain(authority).catch(() => {});
    }
    if (error instanceof BuilderCodexUatError) throw error;
    fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
  }
}

export async function releaseCodexUatLeafDirectoryAuthority(authority) {
  const canonical = await canonicalCodexUatMutationModule();
  if (canonical !== null) return canonical.releaseCodexUatLeafDirectoryAuthority(authority);
  assertBuilderPlatform();
  if (!isLeafDirectoryAuthority(authority)) {
    fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
  }
  await discardLeafDirectoryAuthorityChain(authority);
}

async function resolveLeafDirectoryBootstrap(directory) {
  const requested = path.resolve(directory);
  const missing = [];
  let cursor = requested;
  let anchor;
  try {
    while (true) {
      const current = await lstat(cursor, { bigint: true }).catch((error) => {
        if (error?.code === "ENOENT") return null;
        throw error;
      });
      if (current !== null) {
        assertSafeLeafDirectory(current);
        anchor = await realpath(cursor);
        const canonical = await lstat(anchor, { bigint: true });
        assertSafeLeafDirectory(canonical);
        if (!sameLeafDirectoryIdentity(current, canonical)) {
          fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
        }
        break;
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
      missing.unshift(path.basename(cursor));
      cursor = parent;
    }
    const target = path.join(anchor, ...missing);
    if (!isCanonicalLeafBootstrapPath(requested, target)) {
      fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
    }
    return Object.freeze({ anchor, children: Object.freeze(missing), target });
  } catch (error) {
    if (error instanceof BuilderCodexUatError) throw error;
    fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
  }
}

function isCanonicalLeafBootstrapPath(requested, canonical) {
  if (requested === canonical) return true;
  if (process.platform !== "darwin") return false;
  for (const [alias, resolved] of [
    ["/tmp", "/private/tmp"],
    ["/var", "/private/var"],
    ["/etc", "/private/etc"],
  ]) {
    if ((requested === alias || requested.startsWith(`${alias}${path.sep}`))
      && canonical === `${resolved}${requested.slice(alias.length)}`) {
      return true;
    }
  }
  return false;
}

async function acquireLeafDirectoryAuthority(directory, {
  parentAuthority = null,
  name = null,
  expectedIdentity = null,
} = {}) {
  let handle;
  try {
    const resolved = path.resolve(directory);
    if (parentAuthority !== null) {
      if (!isLeafDirectoryName(name)
        || path.resolve(parentAuthority.directory, name) !== resolved) {
        fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
      }
      await assertLeafDirectoryAuthority(parentAuthority);
    }
    const before = await lstat(resolved, { bigint: true });
    await assertCanonicalLeafDirectoryPath(resolved);
    assertSafeLeafDirectory(before);
    if (expectedIdentity !== null
      && !sameLeafDirectoryEffectIdentity(expectedIdentity, leafDirectoryIdentity(before))) {
      fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
    }
    handle = await open(
      resolved,
      FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_DIRECTORY | FS_CONSTANTS.O_NOFOLLOW,
    );
    const retained = await handle.stat({ bigint: true });
    const current = await lstat(resolved, { bigint: true });
    await assertCanonicalLeafDirectoryPath(resolved);
    assertSafeLeafDirectory(retained);
    assertSafeLeafDirectory(current);
    if (!sameLeafDirectoryIdentity(before, retained)
      || !sameLeafDirectoryIdentity(retained, current)
      || (expectedIdentity !== null
        && !sameLeafDirectoryEffectIdentity(expectedIdentity, leafDirectoryIdentity(retained)))) {
      fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
    }
    if (parentAuthority !== null) {
      await assertLeafDirectoryAuthority(parentAuthority);
      const attachedPath = path.join(parentAuthority.directory, name);
      const attached = await lstat(attachedPath, { bigint: true });
      await assertCanonicalLeafDirectoryPath(attachedPath);
      assertSafeLeafDirectory(attached);
      if (!sameLeafDirectoryIdentity(retained, attached)) {
        fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
      }
      await assertLeafDirectoryAuthority(parentAuthority);
    }
    const authority = Object.freeze({
      directory: resolved,
      handle,
      identity: retained,
      parentAuthority,
      name,
    });
    LEAF_DIRECTORY_AUTHORITIES.add(authority);
    return authority;
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error instanceof BuilderCodexUatError) throw error;
    fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
  }
}

async function inspectRetainedLeafDirectoryChild(parentAuthority, name) {
  try {
    if (!isLeafDirectoryName(name)) fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
    await assertLeafDirectoryAuthority(parentAuthority);
    const childPath = path.join(parentAuthority.directory, name);
    const current = await lstat(childPath, { bigint: true }).catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    await assertLeafDirectoryAuthority(parentAuthority);
    if (current === null) return null;
    assertSafeLeafDirectory(current);
    return leafDirectoryIdentity(current);
  } catch (error) {
    if (error instanceof BuilderCodexUatError) throw error;
    fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
  }
}

function isLeafDirectoryName(name) {
  return typeof name === "string"
    && name.length > 0
    && name !== "."
    && name !== ".."
    && path.basename(name) === name;
}

async function assertCanonicalLeafDirectoryPath(directory) {
  if (await realpath(directory) !== directory) {
    fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
  }
}

async function discardLeafDirectoryAuthorityChain(authority) {
  const authorities = [];
  const visited = new Set();
  let current = authority;
  while (current !== null && !visited.has(current)) {
    visited.add(current);
    authorities.push(current);
    LEAF_DIRECTORY_AUTHORITIES.delete(current);
    current = current.parentAuthority;
  }
  await Promise.all(authorities.map((item) => item.handle.close().catch(() => {})));
}

async function publishContentAddressedLeaf(directory, value, subject, options = {}) {
  const bytes = canonicalBytes(value, subject);
  if (bytes.length === 0 || bytes.length > MAX_UAT_LEAF_BYTES) {
    fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
  }
  const digest = digestRawBytes(bytes);
  const retained = await useLeafDirectoryAuthority(directory, options.parentAuthority);
  const filePath = path.join(
    retained.authority.directory,
    `${digest.slice("sha256:".length)}.json`,
  );
  let loaded;
  let created = false;
  try {
    await assertLeafDirectoryAuthority(retained.authority);
    const existing = await loadOptionalCanonicalLeaf(filePath, digest, subject);
    if (existing !== null) {
      if (!existing.bytes.equals(bytes)) fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
      loaded = existing;
    } else {
      const stageName = `.agentmo-uat-leaf-${digest.slice("sha256:".length)}-${randomBytes(24).toString("hex")}.stage`;
      await assertLeafDirectoryAuthority(retained.authority);
      let staged;
      try {
        staged = await runBuilderPosixEffect({
          action: "write-file",
          name: stageName,
          payload: bytes.toString("base64"),
        }, {
          directoryAuthority: leafEffectDirectoryAuthority(retained.authority),
        });
      } catch (error) {
        if (!/^AGENTMO_BUILDER_POSIX_EFFECT_/u.test(error?.code ?? "")) throw error;
        fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
      }
      if (!staged.created || staged.kind !== "file") fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
      let linked;
      try {
        linked = await runBuilderPosixEffect({
          action: "hardlink",
          name: path.basename(filePath),
          payload: bytes.toString("base64"),
          sourceIdentity: staged.identity,
          sourceName: stageName,
        }, {
          directoryAuthority: leafEffectDirectoryAuthority(retained.authority),
        });
      } catch (error) {
        if (!/^AGENTMO_BUILDER_POSIX_EFFECT_/u.test(error?.code ?? "")) throw error;
        fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
      }
      if (linked.kind !== "link" || !isLinkedLeafIdentity(staged.identity, linked.identity)) {
        fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
      }
      created = linked.created;
      if (!created) {
        await retained.authority.handle.sync();
        await assertLeafDirectoryAuthority(retained.authority);
        loaded = await loadCanonicalLeaf(filePath, digest, () => ({ ok: true }), subject);
        if (!loaded.bytes.equals(bytes)) fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
      } else {
        await retained.authority.handle.sync();
        await assertLeafDirectoryAuthority(retained.authority);
        loaded = await loadCanonicalLeaf(filePath, digest, () => ({ ok: true }), subject);
      }
    }
    await assertLeafDirectoryAuthority(retained.authority);
    if (!loaded.bytes.equals(bytes)) fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
  } catch (error) {
    if (error instanceof BuilderCodexUatError) throw error;
    fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
  } finally {
    if (retained.owned) await releaseCodexUatLeafDirectoryAuthority(retained.authority);
  }
  return Object.freeze({
    digest,
    value: deepFreeze(value),
    filePath,
    created,
  });
}

async function loadOptionalCanonicalLeaf(filePath, expectedDigest, subject) {
  const current = await lstat(filePath, { bigint: true }).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (current === null) return null;
  return loadCanonicalLeaf(filePath, expectedDigest, () => ({ ok: true }), subject);
}

async function useLeafDirectoryAuthority(directory, provided) {
  const resolved = (await resolveLeafDirectoryBootstrap(directory)).target;
  if (provided !== undefined) {
    if (!isLeafDirectoryAuthority(provided) || provided.directory !== resolved) {
      fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
    }
    await assertLeafDirectoryAuthority(provided);
    return { authority: provided, owned: false };
  }
  return {
    authority: await retainCodexUatLeafDirectoryAuthority(resolved),
    owned: true,
  };
}

async function assertLeafDirectoryAuthority(authority) {
  try {
    if (!isLeafDirectoryAuthority(authority)) {
      fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
    }
    if (authority.parentAuthority !== null) {
      await assertLeafDirectoryAuthority(authority.parentAuthority);
    }
    const retained = await authority.handle.stat({ bigint: true });
    const current = await lstat(authority.directory, { bigint: true });
    await assertCanonicalLeafDirectoryPath(authority.directory);
    assertSafeLeafDirectory(retained);
    assertSafeLeafDirectory(current);
    if (!sameLeafDirectoryIdentity(authority.identity, retained)
      || !sameLeafDirectoryIdentity(retained, current)) {
      fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
    }
    if (authority.parentAuthority !== null) {
      const attachedPath = path.join(authority.parentAuthority.directory, authority.name);
      const attached = await lstat(attachedPath, { bigint: true });
      await assertCanonicalLeafDirectoryPath(attachedPath);
      assertSafeLeafDirectory(attached);
      if (!sameLeafDirectoryIdentity(retained, attached)) {
        fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
      }
      await assertLeafDirectoryAuthority(authority.parentAuthority);
    }
  } catch (error) {
    if (error instanceof BuilderCodexUatError) throw error;
    fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
  }
}

function isLeafDirectoryAuthority(authority) {
  return authority !== null
    && typeof authority === "object"
    && LEAF_DIRECTORY_AUTHORITIES.has(authority);
}

function assertSafeLeafDirectory(stats) {
  if (!stats?.isDirectory?.()
    || stats.isSymbolicLink?.()
    || (typeof process.getuid === "function" && stats.uid !== BigInt(process.getuid()))
    || (stats.mode & 0o022n) !== 0n) {
    fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
  }
}

function sameLeafDirectoryIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.uid === right.uid
    && left.gid === right.gid
    && left.mode === right.mode;
}

function sameLeafInode(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function loadCanonicalLeaf(filePath, expectedDigest, validator, subject) {
  if (typeof filePath !== "string" || filePath.length === 0 || !isDigest(expectedDigest)) {
    fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
  }
  let handle;
  let retainedStageHandle;
  let parentAuthority;
  let stageAuthority;
  try {
    parentAuthority = await retainExistingLeafDirectoryAuthority(path.dirname(filePath));
    await assertLeafDirectoryAuthority(parentAuthority);
    handle = await open(filePath, FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    const current = await lstat(filePath, { bigint: true });
    assertSafeLeaf(before);
    assertSafeLeaf(current);
    if (!sameStableLeaf(before, current) || before.size > BigInt(MAX_UAT_LEAF_BYTES)) {
      fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
    }
    if (before.nlink === 2n) {
      const retained = await openRegisteredRetainedLeaf({
        filePath,
        expectedDigest,
        finalStats: before,
      });
      stageAuthority = retained.authority;
      retainedStageHandle = retained.handle;
    } else {
      await assertNoRegisteredRetainedLeaf(filePath, expectedDigest);
    }
    const bytes = await readExact(handle, Number(before.size));
    const after = await handle.stat({ bigint: true });
    const pathAfter = await lstat(filePath, { bigint: true });
    if (!sameStableLeaf(before, after) || !sameStableLeaf(after, pathAfter)
      || digestRawBytes(bytes) !== expectedDigest) {
      fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
    }
    let value;
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
    }
    validator(value);
    if (!canonicalBytes(value, subject).equals(bytes)) fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
    await assertLeafDirectoryAuthority(parentAuthority);
    if (retainedStageHandle !== undefined) {
      const retainedAfter = await retainedStageHandle.stat({ bigint: true });
      if (!sameStableLeaf(after, retainedAfter)) fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
      await assertLeafDirectoryAuthority(stageAuthority);
    }
    return Object.freeze({ digest: expectedDigest, value, bytes });
  } catch (error) {
    if (error instanceof BuilderCodexUatError) throw error;
    fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
  } finally {
    await handle?.close().catch(() => {});
    await retainedStageHandle?.close().catch(() => {});
    if (stageAuthority !== undefined) {
      await releaseCodexUatLeafDirectoryAuthority(stageAuthority).catch(() => {});
    }
    if (parentAuthority !== undefined) {
      await releaseCodexUatLeafDirectoryAuthority(parentAuthority).catch(() => {});
    }
  }
}

async function retainExistingLeafDirectoryAuthority(directory) {
  const current = await lstat(path.resolve(directory), { bigint: true });
  assertSafeLeafDirectory(current);
  return retainCodexUatLeafDirectoryAuthority(directory);
}

async function openRegisteredRetainedLeaf({ filePath, expectedDigest, finalStats }) {
  const stageDirectory = path.dirname(path.resolve(filePath));
  const stageDirectoryStats = await lstat(stageDirectory, { bigint: true });
  assertSafeLeafDirectory(stageDirectoryStats);
  const authority = await retainCodexUatLeafDirectoryAuthority(stageDirectory);
  let retainedHandle;
  try {
    await assertLeafDirectoryAuthority(authority);
    const entries = await readdir(stageDirectory, { withFileTypes: true });
    const stagePattern = /^\.agentmo-uat-leaf-([a-f0-9]{64})-([a-f0-9]{48})\.stage$/u;
    const matches = [];
    for (const entry of entries) {
      const match = entry.name.match(stagePattern);
      if (entry.isFile() && /^[a-f0-9]{64}\.json$/u.test(entry.name)) continue;
      if (!entry.isFile() || match === null) fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
      const entryPath = path.join(stageDirectory, entry.name);
      const stats = await lstat(entryPath, { bigint: true });
      if (sameLeafInode(stats, finalStats)) matches.push({ entryPath, digestHex: match[1] });
    }
    if (matches.length !== 1
      || matches[0].digestHex !== expectedDigest.slice("sha256:".length)) {
      fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
    }
    retainedHandle = await open(
      matches[0].entryPath,
      FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW,
    );
    const retainedBefore = await retainedHandle.stat({ bigint: true });
    const retainedPath = await lstat(matches[0].entryPath, { bigint: true });
    assertSafeLeaf(retainedBefore);
    assertSafeLeaf(retainedPath);
    if (!sameStableLeaf(finalStats, retainedBefore)
      || !sameStableLeaf(retainedBefore, retainedPath)) {
      fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
    }
    await assertLeafDirectoryAuthority(authority);
    return { authority, handle: retainedHandle };
  } catch (error) {
    await retainedHandle?.close().catch(() => {});
    await releaseCodexUatLeafDirectoryAuthority(authority).catch(() => {});
    throw error;
  }
}

async function assertNoRegisteredRetainedLeaf(filePath, expectedDigest) {
  const stageDirectory = path.dirname(path.resolve(filePath));
  const current = await lstat(stageDirectory, { bigint: true }).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (current === null) return;
  assertSafeLeafDirectory(current);
  const authority = await retainCodexUatLeafDirectoryAuthority(stageDirectory);
  try {
    await assertLeafDirectoryAuthority(authority);
    const digestHex = expectedDigest.slice("sha256:".length);
    const entries = await readdir(stageDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && /^[a-f0-9]{64}\.json$/u.test(entry.name)) continue;
      const match = entry.name.match(
        /^\.agentmo-uat-leaf-([a-f0-9]{64})-([a-f0-9]{48})\.stage$/u,
      );
      if (!entry.isFile() || match === null || match[1] === digestHex) {
        fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
      }
    }
    await assertLeafDirectoryAuthority(authority);
  } finally {
    await releaseCodexUatLeafDirectoryAuthority(authority).catch(() => {});
  }
}

function leafEffectDirectoryAuthority(authority) {
  return Object.freeze({
    path: authority.directory,
    handle: authority.handle,
    identity: leafDirectoryIdentity(authority.identity),
  });
}

function leafDirectoryIdentity(stats) {
  return Object.freeze({
    device: stats.dev.toString(10),
    inode: stats.ino.toString(10),
    uid: stats.uid.toString(10),
    gid: stats.gid.toString(10),
    mode: (stats.mode & 0o777n).toString(8),
  });
}

function sameLeafDirectoryEffectIdentity(left, right) {
  return left?.device === right?.device
    && left?.inode === right?.inode
    && left?.uid === right?.uid
    && left?.gid === right?.gid
    && left?.mode === right?.mode;
}

function isLinkedLeafIdentity(staged, linked) {
  return staged?.device === linked?.device
    && staged?.inode === linked?.inode
    && staged?.size === linked?.size
    && staged?.links === "1"
    && linked?.links === "2";
}

function assertSafeLeaf(stats) {
  if (!stats?.isFile?.()
    || stats.isSymbolicLink?.()
    || ![1n, 2n].includes(stats.nlink)
    || (typeof process.getuid === "function" && stats.uid !== BigInt(process.getuid()))
    || (stats.mode & 0o022n) !== 0n
    || (stats.mode & 0o111n) !== 0n
    || stats.size <= 0n) {
    fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
  }
}

function sameStableLeaf(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.nlink === right.nlink
    && left.size === right.size
    && left.uid === right.uid
    && left.mode === right.mode
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function orderedEvidenceDigest(entries) {
  return digestValue({
    schemaVersion: "agentmo.codex-uat-ordered-evidence.v1",
    entries: entries.map((entry) => ({
      sequence: entry.sequence,
      kind: entry.kind,
      scenario: entry.kind === "scenario-observed" ? entry.details.scenario : null,
      evidenceDigests: entry.evidenceDigests,
    })),
  }, "builder-codex-uat-ordered-evidence");
}

function collectDigestValues(value, output = []) {
  if (typeof value === "string" && isDigest(value)) {
    if (!output.includes(value)) output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectDigestValues(item, output);
    return output;
  }
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) collectDigestValues(child, output);
  }
  return output;
}

function assertNoJournalAuthorityFields(value, code) {
  const forbidden = /(journal.*head|head.*journal|predecessor|previousentry|journalheaddigest)/iu;
  const visit = (current) => {
    if (!current || typeof current !== "object") return;
    for (const [key, child] of Object.entries(current)) {
      if (forbidden.test(key)) fail(code);
      visit(child);
    }
  };
  visit(value);
}

function canonicalBytes(value, subject) {
  return Buffer.from(serializePersistableJson(value, {
    subject,
    maxBytes: MAX_UAT_ENTRY_BYTES,
  }), "utf8");
}

function digestValue(value, subject) {
  return digestRawBytes(canonicalBytes(value, subject));
}

async function readExact(handle, size) {
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await handle.read(bytes, offset, size - offset, offset);
    if (!Number.isInteger(bytesRead) || bytesRead <= 0) fail("AGENTMO_CODEX_UAT_LEAF_REJECTED");
    offset += bytesRead;
  }
  return bytes;
}

function mapJournalError(error) {
  if (error instanceof ImmutableJournalError) {
    fail(error.code === "AGENTMO_IMMUTABLE_JOURNAL_AUTHORITY_REJECTED"
      ? "AGENTMO_CODEX_UAT_HEAD_ADMISSION_REQUIRED"
      : "AGENTMO_CODEX_UAT_JOURNAL_CONFLICT_REJECTED");
  }
  throw error;
}

function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function exactKeysWithOptional(value, required, optional) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const allowed = new Set([...required, ...optional]);
  const actual = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key))
    && actual.every((key) => allowed.has(key));
}

function arrayEqual(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function isDigest(value) {
  return DIGEST_PATTERN.test(value ?? "");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function entryRejected() {
  fail("AGENTMO_CODEX_UAT_ENTRY_REJECTED");
}

function transitionRejected() {
  fail("AGENTMO_CODEX_UAT_TRANSITION_REJECTED");
}

function fail(code) {
  throw new BuilderCodexUatError(code);
}
