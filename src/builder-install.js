import { randomBytes } from "node:crypto";
import { constants as FS_CONSTANTS } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { digestRawBytes } from "./artifact-admission.js";
import {
  abortAppendOnlyPrepared,
  appendAppendOnlyRecord,
  finalizeAppendOnlyStagedOutcome,
  readAppendOnlyAuthority,
} from "./builder-append-only-authority.js";
import {
  acquireCodexSelectorStateReservation,
  assertCodexMarketplaceProjectionFinalAuthority,
  assertCodexSelectorStateReservation,
  buildCodexConsumerEntry,
  buildCodexConsumerLedger,
  buildCodexHostSelector,
  buildCodexSelectorOwnerRecord,
  digestCodexConsumerLedger,
  digestCodexSelectorOwnerRecord,
  mutateCodexHost,
  observeCodexHost,
  closeCodexMarketplaceProjectionFinalAuthority,
  inspectCodexMarketplaceProjectionTransaction,
  publishCodexMarketplaceProjectionTransaction,
  readCodexSelectorState,
  releaseCodexSelectorStateReservation,
  retainCodexMarketplaceProjectionFinalAuthority,
  resolveBuilderCodexMarketplaceRoot,
  writeCodexConsumerLedger,
  writeCodexSelectorOwnerRecord,
} from "./builder-codex-host.js";
import { loadBuilderPackage } from "./builder-package.js";
import { assertBuilderPlatform } from "./builder-platform.js";
import { runBuilderPosixEffect } from "./builder-posix-effect.js";
import { serializePersistableJson } from "./persistability.js";

export const BUILDER_INSTALL_RECEIPT_PATH = ".agentmo/builder/install-receipt.json";
export const BUILDER_INSTALL_RECOVERY_PATH = ".agentmo/builder/install-recovery.json";
export const BUILDER_INSTALL_ATTEMPT_AUTHORITY_PATH = ".agentmo-install-attempt-authority";
export const BUILDER_INSTALL_MARKER_PATH = ".agentmo/builder/install-marker.json";
export const BUILDER_CHECKPOINT_PATH = ".agentmo/checkpoints/builder.json";
export const BUILDER_MARKETPLACE_PATH = ".agents/plugins/marketplace.json";
export const BUILDER_PROJECT_AGENT_PATH = ".codex/agents/agentmo.toml";
export const BUILDER_PLUGIN_ROOT = "plugins/agentmo";
export const BUILDER_INSTALL_RECEIPT_SCHEMA_VERSION = "agentmo.builder-install-receipt.v2";
export const BUILDER_ACTIVATED_RECEIPT_SCHEMA_VERSION = "agentmo.builder-install-receipt.v4";
export const BUILDER_INSTALL_RECOVERY_SCHEMA_VERSION = "agentmo.builder-install-recovery.v1";
export const BUILDER_INSTALL_MARKER_SCHEMA_VERSION = "agentmo.builder-install-marker.v2";

const MAX_INSTALLED_FILE_BYTES = 256 * 1024;
const INSTALL_ATTEMPT_NAMESPACE = "builder-install";
const INSTALL_APPEND_ONLY_PREFIX_ABORT_REASON = "AGENTMO_BUILDER_INSTALL_APPEND_ONLY_PREFIX_ABORTED";
const INSTALL_APPEND_ONLY_SUFFIX_ABORT_REASON = "AGENTMO_BUILDER_INSTALL_APPEND_ONLY_SUFFIX_ABORTED";
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const MARKETPLACE = Object.freeze({
  name: "agentmo-local",
  interface: Object.freeze({ displayName: "AgentMo Local Plugins" }),
  plugins: Object.freeze([
    Object.freeze({
      name: "agentmo",
      source: Object.freeze({ source: "local", path: "./plugins/agentmo" }),
      policy: Object.freeze({ installation: "AVAILABLE", authentication: "ON_INSTALL" }),
      category: "Developer Tools",
    }),
  ]),
});

export class BuilderInstallError extends Error {
  constructor(code) {
    super("Builder setup was rejected.");
    this.name = "BuilderInstallError";
    this.code = code;
  }
}

export async function planBuilderInstall(options = {}) {
  assertBuilderPlatform();
  assertInstallOptionKeys(options, false);
  const prepared = await prepareInstall(options);
  return publicPlan(prepared);
}

export async function inspectBuilderInstallRecovery(options = {}) {
  assertBuilderPlatform();
  if (!exactObjectKeys(options, ["projectRoot"])) {
    fail("AGENTMO_BUILDER_INSTALL_RECOVERY_ARGUMENTS_REJECTED");
  }
  const projectRoot = await admitProjectRoot(options.projectRoot);
  const authority = await readInstallAttemptAuthority(projectRoot);
  const authorityPrefix = incompleteInstallAuthorityPrefix(authority);
  const authoritySuffix = incompleteInstallAuthoritySuffix(authority);
  if (authority.recoveryRequired !== null) {
    if (authority.records.length === 0
      && authorityPrefix !== null
      && authorityPrefix.pendingDisposition === "attempt") {
      const stagedOutcome = authorityPrefix.stagedOutcomeDigest !== null;
      const selectedWrite = authorityPrefix.selectedWriteRecovery !== null;
      return deepFreeze({
        schemaVersion: "agentmo.builder-install-recovery-inspection.v1",
        status: selectedWrite
          ? "selected-write-prefix"
          : stagedOutcome ? "staged-outcome-prefix" : "append-only-prefix",
        recoverySchemaVersion: BUILDER_INSTALL_RECOVERY_SCHEMA_VERSION,
        authorityDigest: authority.headDigest,
        transactionId: authorityPrefix.operationId,
        phase: selectedWrite ? "selected-write" : stagedOutcome
          ? "staged-outcome"
          : authorityPrefix.publication,
        applicable: !selectedWrite,
        blockers: selectedWrite
          ? Object.freeze(["resume-original-append-only-authority-write"])
          : Object.freeze([]),
        mutatesProject: false,
        mutatesHost: false,
        physicalDeletion: false,
        repair: selectedWrite
          ? "resume-exact-selected-append-only-authority-write"
          : stagedOutcome
          ? "finalize-exact-staged-authority-outcome"
          : "abort-append-only-authority-prefix",
        recoveryStateDigest: authorityPrefix.digest,
        retainedStageCount: 0,
        retainedPublishedCount: 0,
        attempt: null,
        authorityPrefix,
        repreviewRequired: stagedOutcome,
        domainQualityCertified: false,
      });
    }
    if (authoritySuffix !== null) {
      const stagedOutcome = authoritySuffix.stagedOutcomeDigest !== null;
      const selectedWrite = authoritySuffix.selectedWriteRecovery !== null;
      const attempt = authoritySuffix.survivingAttempt;
      return deepFreeze({
        schemaVersion: "agentmo.builder-install-recovery-inspection.v1",
        status: selectedWrite
          ? "selected-write-suffix"
          : stagedOutcome ? "staged-outcome-suffix" : "append-only-suffix",
        recoverySchemaVersion: BUILDER_INSTALL_RECOVERY_SCHEMA_VERSION,
        authorityDigest: authority.headDigest,
        transactionId: authoritySuffix.operationId,
        phase: selectedWrite ? "selected-write" : stagedOutcome
          ? "staged-outcome"
          : authoritySuffix.publication,
        applicable: !selectedWrite,
        blockers: selectedWrite
          ? Object.freeze(["resume-original-append-only-authority-write"])
          : Object.freeze([]),
        mutatesProject: false,
        mutatesHost: false,
        physicalDeletion: false,
        repair: selectedWrite
          ? "resume-exact-selected-append-only-authority-write-and-repreview"
          : stagedOutcome
          ? "finalize-exact-staged-authority-outcome-and-repreview"
          : "abort-append-only-authority-suffix-and-repreview",
        recoveryStateDigest: authoritySuffix.digest,
        retainedStageCount: 0,
        retainedPublishedCount: 0,
        attempt,
        authoritySuffix,
        repreviewRequired: true,
        domainQualityCertified: false,
      });
    }
    fail("AGENTMO_BUILDER_INSTALL_RECOVERY_AUTHORITY_INVALID");
  }
  if (authority.records.length === 0) {
    return deepFreeze({
      schemaVersion: "agentmo.builder-install-recovery-inspection.v1",
      status: "authority-missing",
      recoverySchemaVersion: BUILDER_INSTALL_RECOVERY_SCHEMA_VERSION,
      mutatesProject: false,
      mutatesHost: false,
      physicalDeletion: false,
      repair: "none",
      domainQualityCertified: false,
    });
  }
  const attempt = summarizeInstallAttempt(authority);
  const recoverableDisposition = [
    "attempt",
    "prepared",
    "activation-finalized",
    "aborted",
  ].includes(
    attempt.disposition,
  );
  let recoveryState = null;
  let blockers = [];
  if (recoverableDisposition) {
    try {
      recoveryState = await inspectRecoverableInstallState(projectRoot, authority);
    } catch (error) {
      if (!(error instanceof BuilderInstallError)
        || ![
          "AGENTMO_BUILDER_INSTALL_RECOVERY_AUTHORITY_INVALID",
          "AGENTMO_BUILDER_INSTALL_RECOVERY_STATE_CHANGED",
        ].includes(error.code)) throw error;
      blockers = [error.code];
    }
  }
  const applicable = recoverableDisposition && recoveryState !== null;
  return deepFreeze({
    schemaVersion: "agentmo.builder-install-recovery-inspection.v1",
    status: attempt.disposition,
    recoverySchemaVersion: BUILDER_INSTALL_RECOVERY_SCHEMA_VERSION,
    authorityDigest: authority.headDigest,
    transactionId: attempt.operationId,
    phase: attempt.disposition,
    applicable,
    blockers: Object.freeze(blockers),
    mutatesProject: false,
    mutatesHost: false,
    physicalDeletion: false,
    repair: applicable ? "supersede-and-reuse-exact-retained-state" : "none",
    recoveryStateDigest: recoveryState?.digest ?? null,
    retainedStageCount: recoveryState?.stages.length ?? 0,
    retainedPublishedCount: recoveryState?.publishedCount ?? 0,
    attempt,
    domainQualityCertified: false,
  });
}

export async function planBuilderInstallRecovery(options = {}) {
  assertBuilderPlatform();
  if (!exactObjectKeys(options, ["projectRoot"])) {
    fail("AGENTMO_BUILDER_INSTALL_RECOVERY_ARGUMENTS_REJECTED");
  }
  const inspection = await inspectBuilderInstallRecovery(options);
  if (inspection.status === "authority-missing") {
    fail("AGENTMO_BUILDER_INSTALL_RECOVERY_AUTHORITY_MISSING");
  }
  if (["selected-write-prefix", "selected-write-suffix"].includes(inspection.status)) {
    const authorityPrefix = inspection.status === "selected-write-suffix"
      ? inspection.authoritySuffix
      : inspection.authorityPrefix;
    const approval = {
      schemaVersion: "agentmo.builder-install-recovery-approval.v7",
      authorityDigest: inspection.authorityDigest,
      operationId: authorityPrefix.operationId,
      publication: authorityPrefix.publication,
      selectedWriteRecovery: authorityPrefix.selectedWriteRecovery,
      recoveryStateDigest: inspection.recoveryStateDigest,
      blockers: inspection.blockers,
      physicalDeletion: false,
      resolution: "resume-required",
    };
    return deepFreeze({
      schemaVersion: "agentmo.builder-install-recovery-plan.v7",
      status: "blocked",
      applicable: false,
      planDigest: digestJson(approval, "builder-install-recovery-approval"),
      recoveryStateDigest: inspection.recoveryStateDigest,
      transactionId: authorityPrefix.operationId,
      operations: Object.freeze([]),
      explicitApplyRequired: true,
      physicalDeletion: false,
      mutatesProject: false,
      mutatesHost: false,
      repreviewRequired: inspection.status === "selected-write-suffix",
      domainQualityCertified: false,
    });
  }
  const appendOnlyPrefix = ["append-only-prefix", "staged-outcome-prefix"].includes(inspection.status);
  const appendOnlySuffix = ["append-only-suffix", "staged-outcome-suffix"].includes(inspection.status);
  const appendOnlyRecovery = appendOnlyPrefix || appendOnlySuffix;
  const stagedOutcomeRecovery = ["staged-outcome-prefix", "staged-outcome-suffix"].includes(
    inspection.status,
  );
  const appendOnlyAuthority = appendOnlySuffix
    ? inspection.authoritySuffix
    : inspection.authorityPrefix;
  const approval = appendOnlySuffix
    ? {
        schemaVersion: "agentmo.builder-install-recovery-approval.v6",
        authorityDigest: inspection.authorityDigest,
        authorityHeadRecordDigest: appendOnlyAuthority.authorityHeadRecordDigest,
        authorityHeadOutcomeDigest: appendOnlyAuthority.authorityHeadOutcomeDigest,
        inheritedRecordDigest: appendOnlyAuthority.inheritedRecord.digest,
        inheritedRecordIdentity: appendOnlyAuthority.inheritedRecord.identity,
        operationId: appendOnlyAuthority.operationId,
        expectedPreparedRecordDigest: appendOnlyAuthority.recordDigest,
        expectedStagedOutcomeDigest: appendOnlyAuthority.stagedOutcomeDigest,
        publication: appendOnlyAuthority.publication,
        resolution: stagedOutcomeRecovery ? "finalize" : "abort",
        expectedPredecessorRecordDigest: appendOnlyAuthority.predecessorRecordDigest,
        expectedPredecessorOutcomeDigest: appendOnlyAuthority.predecessorOutcomeDigest,
        recoveryStateDigest: inspection.recoveryStateDigest,
        blockers: inspection.blockers,
        physicalDeletion: false,
        repreviewRequired: true,
      }
    : appendOnlyPrefix
    ? {
        schemaVersion: "agentmo.builder-install-recovery-approval.v5",
        authorityDigest: inspection.authorityDigest,
        operationId: appendOnlyAuthority.operationId,
        expectedPreparedRecordDigest: appendOnlyAuthority.recordDigest,
        expectedStagedOutcomeDigest: appendOnlyAuthority.stagedOutcomeDigest,
        publication: appendOnlyAuthority.publication,
        resolution: stagedOutcomeRecovery ? "finalize" : "abort",
        recoveryStateDigest: inspection.recoveryStateDigest,
        blockers: inspection.blockers,
        physicalDeletion: false,
      }
    : {
        schemaVersion: "agentmo.builder-install-recovery-approval.v2",
        authorityDigest: inspection.authorityDigest,
        operationId: inspection.attempt.operationId,
        disposition: inspection.attempt.disposition,
        recoveryStateDigest: inspection.recoveryStateDigest,
        blockers: inspection.blockers,
        physicalDeletion: false,
  };
  return deepFreeze({
    schemaVersion: appendOnlySuffix
      ? "agentmo.builder-install-recovery-plan.v6"
      : appendOnlyPrefix
        ? "agentmo.builder-install-recovery-plan.v5"
      : "agentmo.builder-install-recovery-plan.v2",
    status: inspection.applicable
      ? "ready"
      : inspection.blockers.length > 0
        ? "blocked"
        : "not-required",
    applicable: inspection.applicable,
    planDigest: digestJson(approval, "builder-install-recovery-approval"),
    recoveryStateDigest: inspection.recoveryStateDigest,
    transactionId: appendOnlyRecovery
      ? appendOnlyAuthority.operationId
      : inspection.attempt.operationId,
    operations: inspection.applicable
      ? appendOnlyRecovery
        ? Object.freeze([Object.freeze({
            operation: stagedOutcomeRecovery
              ? "finalize-exact-staged-authority-outcome"
              : appendOnlySuffix
                ? "abort-append-only-authority-suffix"
                : "abort-append-only-authority-prefix",
            expectedPreparedRecordDigest: appendOnlyAuthority.recordDigest,
            ...(stagedOutcomeRecovery
              ? { expectedStagedOutcomeDigest: appendOnlyAuthority.stagedOutcomeDigest }
              : { reason: appendOnlySuffix
                ? INSTALL_APPEND_ONLY_SUFFIX_ABORT_REASON
                : INSTALL_APPEND_ONLY_PREFIX_ABORT_REASON }),
            physicalDeletion: false,
          })])
        : Object.freeze([
            ...(inspection.attempt.hostReservation === null
              ? []
              : [Object.freeze({
                  operation: "close-exact-host-reservation",
                  outcome: "aborted",
                  physicalDeletion: false,
                })]),
            Object.freeze({
              operation: "append-superseded-outcome",
              retainedStageCount: inspection.retainedStageCount,
              retainedPublishedCount: inspection.retainedPublishedCount,
              physicalDeletion: false,
            }),
          ])
      : Object.freeze([]),
    explicitApplyRequired: true,
    physicalDeletion: false,
    mutatesProject: inspection.applicable,
    mutatesHost: !appendOnlyRecovery
      && inspection.applicable
      && inspection.attempt.hostReservation !== null,
    repreviewRequired: appendOnlySuffix || stagedOutcomeRecovery,
    domainQualityCertified: false,
  });
}

export async function applyBuilderInstallRecovery(options = {}) {
  assertBuilderPlatform();
  if (!exactObjectKeys(options, ["expectedPlanDigest", "projectRoot"])) {
    fail("AGENTMO_BUILDER_INSTALL_RECOVERY_ARGUMENTS_REJECTED");
  }
  if (!DIGEST_PATTERN.test(options.expectedPlanDigest ?? "")) {
    fail("AGENTMO_BUILDER_INSTALL_RECOVERY_PLAN_DIGEST_REQUIRED");
  }
  const preview = await planBuilderInstallRecovery({ projectRoot: options.projectRoot });
  if (preview.planDigest !== options.expectedPlanDigest) {
    fail("AGENTMO_BUILDER_INSTALL_RECOVERY_PLAN_CHANGED");
  }
  if (!preview.applicable) fail("AGENTMO_BUILDER_INSTALL_RECOVERY_NOT_APPLICABLE");
  const projectRoot = await admitProjectRoot(options.projectRoot);
  const authority = await readInstallAttemptAuthority(projectRoot);
  const inspection = await inspectBuilderInstallRecovery({ projectRoot });
  const appendOnlyPrefix = ["append-only-prefix", "staged-outcome-prefix"].includes(inspection.status);
  const appendOnlySuffix = ["append-only-suffix", "staged-outcome-suffix"].includes(inspection.status);
  if (appendOnlyPrefix || appendOnlySuffix) {
    const currentPrefix = appendOnlySuffix
      ? incompleteInstallAuthoritySuffix(authority)
      : incompleteInstallAuthorityPrefix(authority);
    const inspectedPrefix = appendOnlySuffix
      ? inspection.authoritySuffix
      : inspection.authorityPrefix;
    if (inspection.authorityDigest !== authority.headDigest
      || currentPrefix === null
      || currentPrefix.digest !== inspection.recoveryStateDigest
      || currentPrefix.recordDigest !== inspectedPrefix.recordDigest
      || currentPrefix.operationId !== preview.transactionId
      || inspection.recoveryStateDigest !== preview.recoveryStateDigest
      || (appendOnlySuffix && (
        currentPrefix.authorityHeadRecordDigest !== inspectedPrefix.authorityHeadRecordDigest
        || currentPrefix.authorityHeadOutcomeDigest !== inspectedPrefix.authorityHeadOutcomeDigest
        || currentPrefix.inheritedRecord.digest !== inspectedPrefix.inheritedRecord.digest
        || JSON.stringify(currentPrefix.inheritedRecord.identity)
          !== JSON.stringify(inspectedPrefix.inheritedRecord.identity)
      ))) {
      fail("AGENTMO_BUILDER_INSTALL_RECOVERY_PLAN_CHANGED");
    }
    const inheritedRecordsDigest = appendOnlySuffix
      ? digestJson(authority.records, "builder-install-append-only-suffix-record-prefix")
      : null;
    if (currentPrefix.stagedOutcomeDigest !== null) {
      let finalized;
      try {
        finalized = await finalizeAppendOnlyStagedOutcome({
          projectRoot,
          relativeRoot: BUILDER_INSTALL_ATTEMPT_AUTHORITY_PATH,
          namespace: INSTALL_ATTEMPT_NAMESPACE,
          expectedHeadDigest: authority.headDigest,
          expectedPreparedRecordDigest: currentPrefix.recordDigest,
          expectedStagedOutcomeDigest: currentPrefix.stagedOutcomeDigest,
        });
      } catch {
        fail("AGENTMO_BUILDER_INSTALL_RECOVERY_PLAN_CHANGED");
      }
      const repaired = await readInstallAttemptAuthority(projectRoot);
      const finalizedEntry = finalized.status === "committed"
        ? repaired.records.some((entry) => entry.digest === currentPrefix.recordDigest)
        : repaired.aborted.some((entry) => entry.recordDigest === currentPrefix.recordDigest);
      if (repaired.recoveryRequired !== null
        || repaired.headDigest !== finalized.headDigest
        || !finalizedEntry) {
        fail("AGENTMO_BUILDER_INSTALL_RECOVERY_PLAN_CHANGED");
      }
      let survivingAttempt = null;
      if (repaired.records.length > 0) {
        try {
          survivingAttempt = summarizeInstallAttempt(repaired);
        } catch {
          fail("AGENTMO_BUILDER_INSTALL_RECOVERY_PLAN_CHANGED");
        }
      }
      return deepFreeze({
        schemaVersion: "agentmo.builder-install-recovery-result.v6",
        status: "staged-outcome-finalized-repreview-required",
        applicable: true,
        planDigest: preview.planDigest,
        transactionId: currentPrefix.operationId,
        authorityDigest: repaired.headDigest,
        retainedStageCount: 0,
        retainedPublishedCount: 0,
        physicalDeletion: false,
        mutatesProject: true,
        mutatesHost: false,
        newSetupAllowed: false,
        repreviewRequired: true,
        finalizedOutcome: finalized.status,
        survivingTransactionId: survivingAttempt?.operationId ?? null,
        survivingDisposition: survivingAttempt?.disposition ?? null,
        domainQualityCertified: false,
      });
    }
    const reason = appendOnlySuffix
      ? INSTALL_APPEND_ONLY_SUFFIX_ABORT_REASON
      : INSTALL_APPEND_ONLY_PREFIX_ABORT_REASON;
    let aborted;
    try {
      aborted = await abortAppendOnlyPrepared({
        projectRoot,
        relativeRoot: BUILDER_INSTALL_ATTEMPT_AUTHORITY_PATH,
        namespace: INSTALL_ATTEMPT_NAMESPACE,
        expectedHeadDigest: authority.headDigest,
        expectedPreparedRecordDigest: currentPrefix.recordDigest,
        reason,
      });
    } catch {
      fail("AGENTMO_BUILDER_INSTALL_RECOVERY_PLAN_CHANGED");
    }
    const repaired = await readInstallAttemptAuthority(projectRoot);
    if (aborted.recordDigest !== currentPrefix.recordDigest
      || aborted.reason !== reason
      || repaired.recoveryRequired !== null
      || (appendOnlySuffix && (
        repaired.records.length !== authority.records.length
        || repaired.headRecordDigest !== authority.headRecordDigest
        || digestJson(
          repaired.records,
          "builder-install-append-only-suffix-record-prefix",
        ) !== inheritedRecordsDigest
      ))
      || !repaired.aborted.some((entry) => (
        entry.recordDigest === currentPrefix.recordDigest && entry.reason === reason
      ))) {
      fail("AGENTMO_BUILDER_INSTALL_RECOVERY_PLAN_CHANGED");
    }
    let survivingAttempt = null;
    if (appendOnlySuffix) {
      try {
        survivingAttempt = summarizeInstallAttempt(repaired);
      } catch {
        fail("AGENTMO_BUILDER_INSTALL_RECOVERY_PLAN_CHANGED");
      }
    }
    return deepFreeze({
      schemaVersion: appendOnlySuffix
        ? "agentmo.builder-install-recovery-result.v5"
        : "agentmo.builder-install-recovery-result.v4",
      status: appendOnlySuffix
        ? "append-only-suffix-aborted-repreview-required"
        : "append-only-prefix-aborted",
      applicable: true,
      planDigest: preview.planDigest,
      transactionId: currentPrefix.operationId,
      authorityDigest: repaired.headDigest,
      retainedStageCount: 0,
      retainedPublishedCount: 0,
      physicalDeletion: false,
      mutatesProject: true,
      mutatesHost: false,
      newSetupAllowed: !appendOnlySuffix,
      repreviewRequired: appendOnlySuffix,
      survivingTransactionId: survivingAttempt?.operationId ?? null,
      survivingDisposition: survivingAttempt?.disposition ?? null,
      domainQualityCertified: false,
    });
  }
  if (inspection.authorityDigest !== authority.headDigest
    || inspection.attempt.operationId !== preview.transactionId
    || inspection.recoveryStateDigest === null
    || inspection.recoveryStateDigest !== preview.recoveryStateDigest) {
    fail("AGENTMO_BUILDER_INSTALL_RECOVERY_PLAN_CHANGED");
  }
  await closeInterruptedHostReservation(
    inspection.attempt.hostReservation,
  );
  const latest = latestInstallAttemptPayload(authority);
  const payload = {
    ...latest,
    disposition: "superseded",
    errorCode: "AGENTMO_BUILDER_INSTALL_SUPERSEDED_BY_RECOVERY",
    recoveryStateDigest: inspection.recoveryStateDigest,
    physicalDeletion: false,
  };
  let appended;
  try {
    appended = await appendAppendOnlyRecord({
      projectRoot,
      relativeRoot: BUILDER_INSTALL_ATTEMPT_AUTHORITY_PATH,
      namespace: INSTALL_ATTEMPT_NAMESPACE,
      idempotencyKey: `superseded:${inspection.attempt.operationId}`,
      expectedHeadDigest: authority.headDigest,
      payload,
    });
  } catch {
    fail("AGENTMO_BUILDER_INSTALL_RECOVERY_PLAN_CHANGED");
  }
  return deepFreeze({
    schemaVersion: "agentmo.builder-install-recovery-result.v1",
    status: "superseded",
    applicable: true,
    planDigest: preview.planDigest,
    transactionId: inspection.attempt.operationId,
    authorityDigest: appended.headDigest,
    retainedStageCount: inspection.retainedStageCount,
    retainedPublishedCount: inspection.retainedPublishedCount,
    physicalDeletion: false,
    mutatesProject: true,
    mutatesHost: inspection.attempt.hostReservation !== null,
    newSetupAllowed: true,
    domainQualityCertified: false,
  });
}

async function readInstallAttemptAuthority(projectRoot) {
  return readAppendOnlyAuthority({
    projectRoot,
    relativeRoot: BUILDER_INSTALL_ATTEMPT_AUTHORITY_PATH,
    namespace: INSTALL_ATTEMPT_NAMESPACE,
  });
}

function incompleteInstallAuthorityPrefix(authority) {
  const recovery = authority?.recoveryRequired;
  if (!recovery
    || recovery.schemaVersion !== "agentmo.append-only-claim.v2"
    || typeof recovery.recordStagePresent !== "boolean"
    || typeof recovery.recordLinked !== "boolean"
    || !(recovery.preparedBytes === null || Buffer.isBuffer(recovery.preparedBytes))
    || (recovery.recordLinked && !recovery.recordStagePresent)
    || (recovery.preparedBytes !== null && !recovery.recordStagePresent)
    || !Number.isSafeInteger(authority.nextSequence)
    || !Number.isSafeInteger(recovery.sequence)
    || recovery.sequence < 0
    || recovery.sequence !== authority.nextSequence
    || !/^[a-f0-9]{64}$/u.test(recovery.operationId ?? "")
    || ![
      authority.headDigest,
      authority.headRecordDigest,
      authority.headOutcomeDigest,
      recovery.recordDigest,
      recovery.payloadDigest,
      recovery.predecessorRecordDigest,
      recovery.predecessorOutcomeDigest,
    ].every((value) => DIGEST_PATTERN.test(value ?? ""))
    || recovery.predecessorRecordDigest !== authority.headRecordDigest
    || recovery.predecessorOutcomeDigest !== authority.headOutcomeDigest
    || recovery.claimPath !== `claims/${String(recovery.sequence).padStart(16, "0")}.json`
    || recovery.recordStagePath !== `entries/${recovery.operationId}.record.stage.json`
    || recovery.preparedStagePath !== `prepared/${recovery.operationId}.prepared.stage.json`
    || recovery.preparedPath !== `prepared/${String(recovery.sequence).padStart(16, "0")}.json`
    || recovery.recordPath !== `entries/${String(recovery.sequence).padStart(16, "0")}.${recovery.recordDigest.slice("sha256:".length)}.json`
    || !validAuthorityClaimIdentity(recovery.claimIdentity)) {
    return null;
  }
  let stagedOutcomeDigest = null;
  if (recovery.stagedOutcome !== null) {
    if (!recovery.stagedOutcome
      || typeof recovery.stagedOutcome !== "object"
      || Array.isArray(recovery.stagedOutcome)
      || !Buffer.isBuffer(recovery.stagedOutcome.bytes)
      || recovery.stagedOutcome.bytes.length === 0
      || !recovery.stagedOutcome.value
      || typeof recovery.stagedOutcome.value !== "object"
      || Array.isArray(recovery.stagedOutcome.value)) {
      return null;
    }
    stagedOutcomeDigest = digestRawBytes(recovery.stagedOutcome.bytes);
  }
  const selectedWriteRecovery = selectedAuthorityWriteRecovery(recovery);
  if (selectedWriteRecovery === false) return null;
  const pending = parseInstallAttemptIdempotencyKey(recovery.idempotencyKey);
  if (pending === null) return null;
  const publication = selectedWriteRecovery !== null
    ? selectedWriteRecovery.publication
    : stagedOutcomeDigest !== null
    ? "outcome-stage"
    : recovery.recordLinked
      ? "record-linked"
      : recovery.preparedBytes !== null
        ? "prepared"
        : recovery.recordStagePresent
          ? "record-stage"
          : "claim";
  const basis = {
    schemaVersion: "agentmo.builder-install-incomplete-authority-prefix.v1",
    authorityHeadDigest: authority.headDigest,
    authorityHeadRecordDigest: authority.headRecordDigest,
    authorityHeadOutcomeDigest: authority.headOutcomeDigest,
    sequence: recovery.sequence,
    operationId: recovery.operationId,
    idempotencyKey: recovery.idempotencyKey,
    pendingDisposition: pending.disposition,
    pendingAttemptOperationId: pending.operationId,
    recordDigest: recovery.recordDigest,
    payloadDigest: recovery.payloadDigest,
    predecessorRecordDigest: recovery.predecessorRecordDigest,
    predecessorOutcomeDigest: recovery.predecessorOutcomeDigest,
    claimPath: recovery.claimPath,
    claimIdentity: recovery.claimIdentity,
    recordStagePath: recovery.recordStagePath,
    recordPath: recovery.recordPath,
    preparedStagePath: recovery.preparedStagePath,
    preparedPath: recovery.preparedPath,
    recordStagePresent: recovery.recordStagePresent,
    recordLinked: recovery.recordLinked,
    preparedDigest: recovery.preparedBytes === null ? null : digestRawBytes(recovery.preparedBytes),
    stagedOutcomeDigest,
    selectedWriteRecovery,
    publication,
  };
  return deepFreeze({
    ...basis,
    digest: digestJson(basis, "builder-install-incomplete-authority-prefix"),
  });
}

function selectedAuthorityWriteRecovery(recovery) {
  const candidates = [
    ["record-stage-prefix", recovery.incompleteRecordStage],
    ["prepared-stage-prefix", recovery.incompletePreparedStage],
    ["outcome-stage-prefix", recovery.incompleteStagedOutcome],
  ].filter(([, value]) => value !== null && value !== undefined);
  if (candidates.length === 0) return null;
  if (candidates.length !== 1) return false;
  const [publication, value] = candidates[0];
  if (!value
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.keys(value).toSorted().join("\0") !== [
      "bytes",
      "identity",
      "selectedDigest",
      "selectedLength",
    ].join("\0")
    || !(value.bytes === null || Buffer.isBuffer(value.bytes))
    || !(value.identity === null || validAuthorityClaimIdentity(value.identity))
    || (value.bytes === null) !== (value.identity === null)
    || !DIGEST_PATTERN.test(value.selectedDigest ?? "")
    || !Number.isSafeInteger(value.selectedLength)
    || value.selectedLength <= 0
    || value.selectedLength > 1_000_000
    || (value.bytes !== null
      && (value.bytes.length >= value.selectedLength
        || value.identity.size !== String(value.bytes.length)))) {
    return false;
  }
  return deepFreeze({
    publication,
    selectedDigest: value.selectedDigest,
    selectedLength: value.selectedLength,
    prefixDigest: value.bytes === null ? null : digestRawBytes(value.bytes),
    prefixLength: value.bytes === null ? 0 : value.bytes.length,
    prefixIdentity: value.identity,
  });
}

function incompleteInstallAuthoritySuffix(authority) {
  if (!Array.isArray(authority?.records) || authority.records.length === 0) return null;
  const prefix = incompleteInstallAuthorityPrefix(authority);
  const inheritedRecord = authority.records.at(-1);
  let survivingAttempt;
  try {
    survivingAttempt = summarizeInstallAttempt(authority);
  } catch {
    return null;
  }
  if (prefix === null
    || !inheritedRecord
    || !Number.isSafeInteger(inheritedRecord.sequence)
    || inheritedRecord.sequence < 0
    || inheritedRecord.sequence >= prefix.sequence
    || inheritedRecord.digest !== authority.headRecordDigest
    || inheritedRecord.digest !== prefix.predecessorRecordDigest
    || !DIGEST_PATTERN.test(inheritedRecord.payloadDigest ?? "")
    || typeof inheritedRecord.idempotencyKey !== "string"
    || inheritedRecord.idempotencyKey.length === 0
    || !validAuthorityRecordIdentity(inheritedRecord.identity)
    || !validIncompleteSuffixTransition(survivingAttempt, prefix)) {
    return null;
  }
  const inherited = {
    sequence: inheritedRecord.sequence,
    digest: inheritedRecord.digest,
    payloadDigest: inheritedRecord.payloadDigest,
    idempotencyKey: inheritedRecord.idempotencyKey,
    identity: inheritedRecord.identity,
  };
  const basis = {
    schemaVersion: "agentmo.builder-install-incomplete-authority-suffix.v1",
    incompletePrefixDigest: prefix.digest,
    authorityHeadDigest: authority.headDigest,
    authorityHeadRecordDigest: authority.headRecordDigest,
    authorityHeadOutcomeDigest: authority.headOutcomeDigest,
    sequence: prefix.sequence,
    operationId: prefix.operationId,
    pendingDisposition: prefix.pendingDisposition,
    pendingAttemptOperationId: prefix.pendingAttemptOperationId,
    recordDigest: prefix.recordDigest,
    predecessorRecordDigest: prefix.predecessorRecordDigest,
    predecessorOutcomeDigest: prefix.predecessorOutcomeDigest,
    claimIdentity: prefix.claimIdentity,
    publication: prefix.publication,
    stagedOutcomeDigest: prefix.stagedOutcomeDigest,
    selectedWriteRecovery: prefix.selectedWriteRecovery,
    inheritedRecord: inherited,
    survivingAttempt: {
      schemaVersion: survivingAttempt.schemaVersion,
      operationId: survivingAttempt.operationId,
      disposition: survivingAttempt.disposition,
    },
  };
  return deepFreeze({
    ...prefix,
    schemaVersion: basis.schemaVersion,
    inheritedRecord: deepFreeze(inherited),
    survivingAttempt: deepFreeze(basis.survivingAttempt),
    digest: digestJson(basis, "builder-install-incomplete-authority-suffix"),
  });
}

function parseInstallAttemptIdempotencyKey(value) {
  const match = /^(attempt|prepared|activation-finalized|committed|aborted|superseded):([a-f0-9]{64})$/u.exec(value ?? "");
  return match === null
    ? null
    : Object.freeze({ disposition: match[1], operationId: match[2] });
}

function validIncompleteSuffixTransition(survivingAttempt, pending) {
  if (!survivingAttempt || !pending) return false;
  if (pending.pendingDisposition === "attempt") {
    return ["committed", "aborted", "superseded"].includes(survivingAttempt.disposition)
      && pending.pendingAttemptOperationId !== survivingAttempt.operationId;
  }
  if (pending.pendingAttemptOperationId !== survivingAttempt.operationId) return false;
  if (pending.pendingDisposition === "prepared") {
    return survivingAttempt.disposition === "attempt";
  }
  if (pending.pendingDisposition === "activation-finalized") {
    return survivingAttempt.schemaVersion === "agentmo.builder-install-attempt.v2"
      && survivingAttempt.disposition === "prepared";
  }
  if (pending.pendingDisposition === "committed") {
    return (survivingAttempt.schemaVersion === "agentmo.builder-install-attempt.v1"
      && survivingAttempt.disposition === "prepared")
      || (survivingAttempt.schemaVersion === "agentmo.builder-install-attempt.v2"
        && survivingAttempt.disposition === "activation-finalized");
  }
  if (pending.pendingDisposition === "aborted") {
    return ["attempt", "prepared", "activation-finalized"].includes(
      survivingAttempt.disposition,
    );
  }
  return pending.pendingDisposition === "superseded"
    && ["attempt", "prepared", "activation-finalized", "aborted"].includes(
      survivingAttempt.disposition,
    );
}

function validAuthorityClaimIdentity(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).toSorted().join("\0") === [
      "device", "inode", "links", "size",
    ].join("\0")
    && ["device", "inode", "links", "size"].every((key) => /^\d+$/u.test(value[key] ?? ""))
    && value.links === "1");
}

function validAuthorityRecordIdentity(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).toSorted().join("\0") === [
      "device", "inode", "links", "size",
    ].join("\0")
    && ["device", "inode", "links", "size"].every((key) => /^\d+$/u.test(value[key] ?? ""))
    && value.links === "2");
}

function summarizeInstallAttempt(authority) {
  const entries = authority.records.map((record) => record.payload);
  const latest = entries.at(-1);
  if (!latest || ![
    "agentmo.builder-install-attempt.v1",
    "agentmo.builder-install-attempt.v2",
  ].includes(latest.schemaVersion)
    || !/^[a-f0-9]{64}$/u.test(latest.operationId ?? "")
    || ![
      "attempt", "prepared", "activation-finalized", "committed", "aborted", "superseded",
    ].includes(latest.disposition)
    || !DIGEST_PATTERN.test(latest.planDigest ?? "")
    || !DIGEST_PATTERN.test(latest.scopeDigest ?? "")
    || latest.physicalDeletion !== false
    || !Array.isArray(latest.files)
    || !Array.isArray(latest.stages)) {
    fail("AGENTMO_BUILDER_INSTALL_RECOVERY_AUTHORITY_INVALID");
  }
  for (const entry of entries) {
    if (!validInstallAttemptKeys(entry)) {
      fail("AGENTMO_BUILDER_INSTALL_RECOVERY_AUTHORITY_INVALID");
    }
  }
  const operationEntries = entries.filter((entry) => entry.operationId === latest.operationId);
  const dispositions = operationEntries.map((entry) => entry.disposition);
  const projectedSequence = JSON.stringify(dispositions) === JSON.stringify(["attempt"])
    || JSON.stringify(dispositions) === JSON.stringify(["attempt", "aborted"])
    || JSON.stringify(dispositions) === JSON.stringify(["attempt", "prepared"])
    || JSON.stringify(dispositions) === JSON.stringify(["attempt", "prepared", "committed"])
    || JSON.stringify(dispositions) === JSON.stringify(["attempt", "prepared", "aborted"])
    || JSON.stringify(dispositions) === JSON.stringify(["attempt", "superseded"])
    || JSON.stringify(dispositions) === JSON.stringify(["attempt", "aborted", "superseded"])
    || JSON.stringify(dispositions) === JSON.stringify(["attempt", "prepared", "superseded"])
    || JSON.stringify(dispositions) === JSON.stringify([
      "attempt", "prepared", "aborted", "superseded",
    ]);
  const activationSequence = [
    ["attempt"],
    ["attempt", "aborted"],
    ["attempt", "prepared"],
    ["attempt", "prepared", "aborted"],
    ["attempt", "prepared", "activation-finalized"],
    ["attempt", "prepared", "activation-finalized", "committed"],
    ["attempt", "prepared", "activation-finalized", "aborted"],
    ["attempt", "superseded"],
    ["attempt", "aborted", "superseded"],
    ["attempt", "prepared", "superseded"],
    ["attempt", "prepared", "aborted", "superseded"],
    ["attempt", "prepared", "activation-finalized", "superseded"],
    ["attempt", "prepared", "activation-finalized", "aborted", "superseded"],
  ].some((sequence) => JSON.stringify(dispositions) === JSON.stringify(sequence));
  const validSequence = latest.schemaVersion === "agentmo.builder-install-attempt.v1"
    ? projectedSequence
    : activationSequence;
  if (!validSequence) {
    fail("AGENTMO_BUILDER_INSTALL_RECOVERY_AUTHORITY_INVALID");
  }
  const hostReservation = validateInstallHostReservation(latest.hostReservation ?? null);
  if ((latest.schemaVersion === "agentmo.builder-install-attempt.v1"
      && hostReservation !== null)
    || (latest.schemaVersion === "agentmo.builder-install-attempt.v2"
      && hostReservation === null)) {
    fail("AGENTMO_BUILDER_INSTALL_RECOVERY_AUTHORITY_INVALID");
  }
  if (hostReservation !== null && hostReservation.bindingDigest !== latest.planDigest) {
    fail("AGENTMO_BUILDER_INSTALL_RECOVERY_AUTHORITY_INVALID");
  }
  const activationFinalized = operationEntries.some(
    (entry) => entry.disposition === "activation-finalized",
  );
  if (latest.schemaVersion === "agentmo.builder-install-attempt.v1") {
    if (!DIGEST_PATTERN.test(latest.receiptDigest ?? "")
      || Object.hasOwn(latest, "finalProjectionBinding")) {
      fail("AGENTMO_BUILDER_INSTALL_RECOVERY_AUTHORITY_INVALID");
    }
  } else if (activationFinalized) {
    if (!DIGEST_PATTERN.test(latest.receiptDigest ?? "")
      || !validFinalProjectionBinding(latest.finalProjectionBinding)) {
      fail("AGENTMO_BUILDER_INSTALL_RECOVERY_AUTHORITY_INVALID");
    }
  } else if (latest.receiptDigest !== null || latest.finalProjectionBinding !== null) {
    fail("AGENTMO_BUILDER_INSTALL_RECOVERY_AUTHORITY_INVALID");
  }
  return deepFreeze({
    schemaVersion: latest.schemaVersion,
    operationId: latest.operationId,
    disposition: latest.disposition,
    planDigest: latest.planDigest,
    receiptDigest: latest.receiptDigest ?? null,
    errorCode: latest.errorCode ?? null,
    stageCount: latest.stages?.length ?? operationEntries.at(-2)?.stages?.length ?? 0,
    hostReservation,
    finalProjectionBinding: latest.finalProjectionBinding ?? null,
    physicalDeletion: false,
  });
}

function validInstallAttemptKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const common = [
    "schemaVersion", "operationId", "disposition", "planDigest", "scopeDigest",
    "receiptDigest", "errorCode", "hostReservation", "physicalDeletion", "files", "stages",
  ];
  const allowed = value.schemaVersion === "agentmo.builder-install-attempt.v2"
    ? [...common, "finalProjectionBinding", "recoveryStateDigest"]
    : value.schemaVersion === "agentmo.builder-install-attempt.v1"
      ? [...common, "recoveryStateDigest"]
      : [];
  return allowed.length > 0 && Object.keys(value).every((key) => allowed.includes(key))
    && common.every((key) => Object.hasOwn(value, key));
}

function latestInstallAttemptPayload(authority) {
  const latest = authority.records.at(-1)?.payload;
  if (!latest) fail("AGENTMO_BUILDER_INSTALL_RECOVERY_AUTHORITY_INVALID");
  summarizeInstallAttempt(authority);
  return latest;
}

function validateInstallHostReservation(value) {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).toSorted().join("\0") !== [
      "bindingDigest",
      "expectedLedgerDigest",
      "expectedLedgerIdentityDigest",
      "expectedOwnerDigest",
      "expectedOwnerIdentityDigest",
      "purpose",
      "desiredLedgerDigest",
      "desiredOwnerDigest",
    ].toSorted().join("\0")
    || value.purpose !== "activation"
    || !DIGEST_PATTERN.test(value.bindingDigest ?? "")
    || !DIGEST_PATTERN.test(value.desiredLedgerDigest ?? "")
    || !DIGEST_PATTERN.test(value.desiredOwnerDigest ?? "")
    || ![value.expectedLedgerDigest, value.expectedOwnerDigest]
      .every((item) => item === null || DIGEST_PATTERN.test(item ?? ""))
    || ![value.expectedLedgerIdentityDigest, value.expectedOwnerIdentityDigest]
      .every((item) => item === null || DIGEST_PATTERN.test(item ?? ""))) {
    fail("AGENTMO_BUILDER_INSTALL_RECOVERY_AUTHORITY_INVALID");
  }
  return deepFreeze({ ...value });
}

function validFinalProjectionBinding(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).toSorted().join("\0") === [
      "contentDigest",
      "members",
      "releaseDigest",
      "rootIdentity",
      "rootIdentityDigest",
      "schemaVersion",
      "transactionDigest",
      "transactionId",
    ].toSorted().join("\0")
    && value.schemaVersion === "agentmo.codex-marketplace-projection-binding.v1"
    && /^[a-f0-9]{64}$/u.test(value.transactionId ?? "")
    && [
      value.contentDigest,
      value.releaseDigest,
      value.rootIdentityDigest,
      value.transactionDigest,
    ].every((digest) => DIGEST_PATTERN.test(digest ?? ""))
    && Array.isArray(value.members)
    && value.members.length > 0
    && value.members[0]?.kind === "root"
    && value.members[0]?.relativePath === ""
    && value.rootIdentity
    && JSON.stringify(value.rootIdentity) === JSON.stringify(value.members[0].identity));
}

function installHostReservation(prepared) {
  const activation = prepared.hostActivation;
  if (activation === null) return null;
  return {
    purpose: "activation",
    bindingDigest: prepared.planDigest,
    expectedOwnerDigest: activation.priorState.owner.digest,
    expectedOwnerIdentityDigest: activation.priorState.owner.identityDigest,
    expectedLedgerDigest: activation.priorState.ledger.digest,
    expectedLedgerIdentityDigest: activation.priorState.ledger.identityDigest,
    desiredOwnerDigest: activation.ownerDigest,
    desiredLedgerDigest: activation.ledgerDigest,
  };
}

async function inspectRecoverableInstallState(projectRoot, authority) {
  const summary = summarizeInstallAttempt(authority);
  if (![
    "attempt",
    "prepared",
    "activation-finalized",
    "aborted",
  ].includes(summary.disposition)) {
    fail("AGENTMO_BUILDER_INSTALL_RECOVERY_NOT_APPLICABLE");
  }
  const latest = latestInstallAttemptPayload(authority);
  if (!Array.isArray(latest.files) || !Array.isArray(latest.stages)) {
    fail("AGENTMO_BUILDER_INSTALL_RECOVERY_AUTHORITY_INVALID");
  }
  const files = new Map();
  for (const file of latest.files) {
    if (!file || typeof file !== "object" || Array.isArray(file)
      || !portableRelativePath(file.relativePath)
      || !["create", "unchanged"].includes(file.operation)
      || !(DIGEST_PATTERN.test(file.digest ?? "")
        || (summary.schemaVersion === "agentmo.builder-install-attempt.v2"
          && summary.finalProjectionBinding === null
          && file.relativePath === BUILDER_INSTALL_RECEIPT_PATH
          && file.digest === null))
      || files.has(file.relativePath)) {
      fail("AGENTMO_BUILDER_INSTALL_RECOVERY_AUTHORITY_INVALID");
    }
    files.set(file.relativePath, file);
  }
  const stages = [];
  const stageByDestination = new Map();
  for (const stage of latest.stages) {
    const destination = files.get(stage?.destinationPath);
    if (!destination || destination.operation !== "create"
      || !portableRelativePath(stage.relativePath)
      || stage.digest !== destination.digest
      || stageByDestination.has(stage.destinationPath)
      || path.posix.dirname(stage.relativePath) !== path.posix.dirname(stage.destinationPath)
      || !/^\.agentmo-stage-[a-f0-9]{32}$/u.test(path.posix.basename(stage.relativePath))
      || !validRecordedStageIdentity(stage.identity)) {
      fail("AGENTMO_BUILDER_INSTALL_RECOVERY_AUTHORITY_INVALID");
    }
    const inspected = await inspectRecoveryStage(projectRoot, stage);
    stages.push(inspected);
    stageByDestination.set(stage.destinationPath, inspected);
  }
  const operationEntries = authority.records
    .map((record) => record.payload)
    .filter((entry) => entry.operationId === summary.operationId);
  const firstOperationIndex = authority.records.findIndex(
    (record) => record.payload?.operationId === summary.operationId,
  );
  const predecessor = firstOperationIndex > 0
    ? authority.records[firstOperationIndex - 1].payload
    : null;
  const inheritedStageKeys = new Set(
    predecessor?.disposition === "superseded" && Array.isArray(predecessor.stages)
      ? predecessor.stages.map(installStageKey)
      : [],
  );
  const normalizedHostReservation = JSON.stringify(summary.hostReservation);
  for (const entry of operationEntries) {
    if (entry?.schemaVersion !== summary.schemaVersion
      || entry.operationId !== summary.operationId
      || entry.planDigest !== latest.planDigest
      || entry.scopeDigest !== latest.scopeDigest
      || entry.physicalDeletion !== false
      || !sameInstallAttemptFilesAcrossTransition(entry.files, latest.files, summary.schemaVersion)
      || JSON.stringify(validateInstallHostReservation(entry.hostReservation ?? null))
        !== normalizedHostReservation) {
      fail("AGENTMO_BUILDER_INSTALL_RECOVERY_AUTHORITY_INVALID");
    }
    if (summary.schemaVersion === "agentmo.builder-install-attempt.v1") {
      if (entry.receiptDigest !== latest.receiptDigest
        || Object.hasOwn(entry, "finalProjectionBinding")) {
        fail("AGENTMO_BUILDER_INSTALL_RECOVERY_AUTHORITY_INVALID");
      }
    } else {
      const finalizedEntry = ["activation-finalized", "committed"].includes(entry.disposition)
        || (entry.disposition === "aborted" && entry.finalProjectionBinding !== null)
        || (entry.disposition === "superseded" && entry.finalProjectionBinding !== null);
      if (finalizedEntry) {
        if (entry.receiptDigest !== latest.receiptDigest
          || JSON.stringify(entry.finalProjectionBinding)
            !== JSON.stringify(latest.finalProjectionBinding)) {
          fail("AGENTMO_BUILDER_INSTALL_RECOVERY_AUTHORITY_INVALID");
        }
      } else if (entry.receiptDigest !== null || entry.finalProjectionBinding !== null) {
        fail("AGENTMO_BUILDER_INSTALL_RECOVERY_AUTHORITY_INVALID");
      }
    }
  }
  const wasPrepared = operationEntries.some((entry) => entry.disposition === "prepared");
  if (wasPrepared
    && [...files.values()].filter(
      (file) => file.operation === "create" && file.digest !== null,
    ).length !== stages.length) {
    fail("AGENTMO_BUILDER_INSTALL_RECOVERY_AUTHORITY_INVALID");
  }
  const observations = [];
  let publishedCount = 0;
  let inertStageCount = 0;
  for (const file of files.values()) {
    const observed = await inspectProjectPath(projectRoot, file.relativePath);
    const stage = stageByDestination.get(file.relativePath);
    if (file.operation === "unchanged") {
      if (observed.status !== "file" || observed.digest !== file.digest) {
        fail("AGENTMO_BUILDER_INSTALL_RECOVERY_STATE_CHANGED");
      }
      observations.push({
        relativePath: file.relativePath,
        status: "unchanged",
        digest: observed.digest,
        identity: observed.identity,
      });
      continue;
    }
    if (observed.status === "absent") {
      if (stage?.links === "2"
        || (!wasPrepared && stage !== undefined
          && !inheritedStageKeys.has(installStageKey(stage)))) {
        fail("AGENTMO_BUILDER_INSTALL_RECOVERY_AUTHORITY_INVALID");
      }
      if (stage !== undefined) inertStageCount += 1;
      observations.push({
        relativePath: file.relativePath,
        status: "absent",
        digest: file.digest,
        identity: null,
      });
      continue;
    }
    if (stage === undefined || stage.links !== "2"
      || (!wasPrepared && !inheritedStageKeys.has(installStageKey(stage)))
      || observed.status !== "file" || observed.digest !== file.digest) {
      fail("AGENTMO_BUILDER_INSTALL_RECOVERY_STATE_CHANGED");
    }
    const destinationStats = await lstat(resolveProjectPath(projectRoot, file.relativePath), {
      bigint: true,
    }).catch(() => null);
    if (destinationStats === null
      || destinationStats.isSymbolicLink()
      || !destinationStats.isFile()
      || destinationStats.dev.toString(10) !== stage.identity.device
      || destinationStats.ino.toString(10) !== stage.identity.inode
      || destinationStats.size.toString(10) !== stage.identity.size) {
      fail("AGENTMO_BUILDER_INSTALL_RECOVERY_STATE_CHANGED");
    }
    publishedCount += 1;
    observations.push({
      relativePath: file.relativePath,
      status: "retained-published",
      digest: observed.digest,
      identity: observed.identity,
    });
  }
  if (!wasPrepared && publishedCount + inertStageCount !== stages.length) {
    fail("AGENTMO_BUILDER_INSTALL_RECOVERY_AUTHORITY_INVALID");
  }
  const basis = {
    schemaVersion: "agentmo.builder-install-recovery-state.v1",
    operationId: summary.operationId,
    disposition: summary.disposition,
    files: observations,
    stages: stages.map((stage) => ({
      relativePath: stage.relativePath,
      destinationPath: stage.destinationPath,
      digest: stage.digest,
      identity: stage.identity,
      links: stage.links,
    })),
  };
  return deepFreeze({
    digest: digestJson(basis, "builder-install-recovery-state"),
    stages,
    publishedCount,
  });
}

function sameInstallAttemptFilesAcrossTransition(left, right, schemaVersion) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const prior = left[index];
    const latest = right[index];
    if (prior?.relativePath !== latest?.relativePath
      || prior?.operation !== latest?.operation) return false;
    if (prior.digest === latest.digest) continue;
    if (schemaVersion !== "agentmo.builder-install-attempt.v2"
      || prior.relativePath !== BUILDER_INSTALL_RECEIPT_PATH
      || prior.digest !== null
      || !DIGEST_PATTERN.test(latest.digest ?? "")) return false;
  }
  return true;
}

function installStageKey(stage) {
  return JSON.stringify({
    relativePath: stage.relativePath,
    destinationPath: stage.destinationPath,
    digest: stage.digest,
    identity: stage.identity,
  });
}

function validRecordedStageIdentity(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).toSorted().join("\0")
      === ["device", "inode", "links", "size"].toSorted().join("\0")
    && [value.device, value.inode, value.size].every((item) => /^\d+$/u.test(item ?? ""))
    && value.links === "1");
}

async function inspectRecoveryStage(projectRoot, stage) {
  const stagePath = resolveProjectPath(projectRoot, stage.relativePath);
  let handle;
  try {
    const parent = await inspectParentChainState(projectRoot, path.dirname(stagePath));
    if (parent.status !== "present") fail("AGENTMO_BUILDER_INSTALL_RECOVERY_STATE_CHANGED");
    handle = await open(stagePath, FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    const current = await lstat(stagePath, { bigint: true });
    if (!before.isFile() || current.isSymbolicLink() || !current.isFile()
      || !sameIdentity(before, current)
      || ![1n, 2n].includes(before.nlink)
      || before.dev.toString(10) !== stage.identity.device
      || before.ino.toString(10) !== stage.identity.inode
      || before.size.toString(10) !== stage.identity.size
      || before.size < 0n || before.size > BigInt(MAX_INSTALLED_FILE_BYTES)) {
      fail("AGENTMO_BUILDER_INSTALL_RECOVERY_STATE_CHANGED");
    }
    const bytes = await readHandle(handle, before.size);
    const after = await handle.stat({ bigint: true });
    const final = await lstat(stagePath, { bigint: true });
    if (!sameIdentity(before, after) || !sameIdentity(after, final)
      || digestRawBytes(bytes) !== stage.digest) {
      fail("AGENTMO_BUILDER_INSTALL_RECOVERY_STATE_CHANGED");
    }
    return deepFreeze({
      relativePath: stage.relativePath,
      destinationPath: stage.destinationPath,
      digest: stage.digest,
      identity: { ...stage.identity },
      links: before.nlink.toString(10),
    });
  } catch (error) {
    if (error instanceof BuilderInstallError) throw error;
    fail("AGENTMO_BUILDER_INSTALL_RECOVERY_STATE_CHANGED");
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function closeInterruptedHostReservation(descriptor) {
  if (descriptor === null) return;
  let reservation;
  try {
    reservation = await acquireCodexSelectorStateReservation({
      purpose: descriptor.purpose,
      bindingDigest: descriptor.bindingDigest,
      expectedOwnerDigest: descriptor.expectedOwnerDigest,
      expectedOwnerIdentityDigest: descriptor.expectedOwnerIdentityDigest,
      expectedLedgerDigest: descriptor.expectedLedgerDigest,
      expectedLedgerIdentityDigest: descriptor.expectedLedgerIdentityDigest,
    });
  } catch (error) {
    if (error?.code !== "AGENTMO_CODEX_HOST_CAS_MISMATCH") {
      fail("AGENTMO_BUILDER_INSTALL_HOST_RECOVERY_REQUIRED");
    }
    const state = await readCodexSelectorState();
    if (state.owner.digest !== descriptor.desiredOwnerDigest
      || state.ledger.digest !== descriptor.desiredLedgerDigest) {
      fail("AGENTMO_BUILDER_INSTALL_HOST_RECOVERY_REQUIRED");
    }
    return;
  }
  try {
    await releaseCodexSelectorStateReservation(reservation, "aborted");
  } catch {
    fail("AGENTMO_BUILDER_INSTALL_HOST_RECOVERY_REQUIRED");
  }
}

async function beginInstallAttempt(prepared) {
  const authority = await readInstallAttemptAuthority(prepared.projectRoot);
  if (authority.recoveryRequired !== null) fail("AGENTMO_BUILDER_INSTALL_RECOVERY_REQUIRED");
  if (authority.records.length > 0) {
    const prior = summarizeInstallAttempt(authority);
    if (["attempt", "prepared", "activation-finalized"].includes(prior.disposition)) {
      fail("AGENTMO_BUILDER_INSTALL_RECOVERY_REQUIRED");
    }
  }
  const operationId = digestJson({
    schemaVersion: "agentmo.builder-install-operation-basis.v1",
    planDigest: prepared.planDigest,
    scopeDigest: prepared.scopeDigest,
    predecessorAuthorityDigest: authority.headDigest,
  }, "builder-install-operation-basis").slice("sha256:".length);
  const payload = {
    schemaVersion: installAttemptSchema(prepared),
    operationId,
    disposition: "attempt",
    planDigest: prepared.planDigest,
    scopeDigest: prepared.scopeDigest,
    receiptDigest: installAttemptReceiptDigest(prepared, "attempt"),
    ...(prepared.hostActivation === null
      ? {}
      : { finalProjectionBinding: null }),
    errorCode: null,
    hostReservation: installHostReservation(prepared),
    physicalDeletion: false,
    files: installAttemptFiles(prepared, false),
    stages: prepared.allFiles
      .filter((file) => file.recoveryStage !== null)
      .map((file) => file.recoveryStage),
  };
  const appended = await appendAppendOnlyRecord({
    projectRoot: prepared.projectRoot,
    relativeRoot: BUILDER_INSTALL_ATTEMPT_AUTHORITY_PATH,
    namespace: INSTALL_ATTEMPT_NAMESPACE,
    idempotencyKey: `attempt:${operationId}`,
    expectedHeadDigest: authority.headDigest,
    payload,
  });
  return Object.freeze({
    operationId,
    planDigest: prepared.planDigest,
    headDigest: appended.headDigest,
    stages: payload.stages,
  });
}

async function recordPreparedInstallAttempt(prepared, attempt, staged) {
  const payload = {
    schemaVersion: installAttemptSchema(prepared),
    operationId: attempt.operationId,
    disposition: "prepared",
    planDigest: prepared.planDigest,
    scopeDigest: prepared.scopeDigest,
    receiptDigest: installAttemptReceiptDigest(prepared, "prepared"),
    ...(prepared.hostActivation === null
      ? {}
      : { finalProjectionBinding: null }),
    errorCode: null,
    hostReservation: installHostReservation(prepared),
    physicalDeletion: false,
    files: installAttemptFiles(prepared, false),
    stages: [
      ...(attempt.stages ?? []),
      ...staged.filter((item) => item.inherited !== true).map((item) => ({
        relativePath: path.relative(prepared.projectRoot, item.stagePath).split(path.sep).join("/"),
        destinationPath: item.desired.relativePath,
        digest: item.desired.destinationDigest,
        identity: item.stageIdentity,
      })),
    ],
  };
  const appended = await appendAppendOnlyRecord({
    projectRoot: prepared.projectRoot,
    relativeRoot: BUILDER_INSTALL_ATTEMPT_AUTHORITY_PATH,
    namespace: INSTALL_ATTEMPT_NAMESPACE,
    idempotencyKey: `prepared:${attempt.operationId}`,
    expectedHeadDigest: attempt.headDigest,
    payload,
  });
  return Object.freeze({ ...attempt, headDigest: appended.headDigest, stages: payload.stages });
}

async function recordFinalizedActivationAttempt(prepared, attempt, staged) {
  if (prepared.hostActivation === null
    || prepared.hostActivation.receiptBinding?.finalProjectionBinding === undefined) {
    fail("AGENTMO_BUILDER_INSTALL_VERIFICATION_FAILED");
  }
  const payload = {
    schemaVersion: "agentmo.builder-install-attempt.v2",
    operationId: attempt.operationId,
    disposition: "activation-finalized",
    planDigest: prepared.planDigest,
    scopeDigest: prepared.scopeDigest,
    receiptDigest: prepared.receiptDigest,
    finalProjectionBinding: prepared.hostActivation.receiptBinding.finalProjectionBinding,
    errorCode: null,
    hostReservation: installHostReservation(prepared),
    physicalDeletion: false,
    files: installAttemptFiles(prepared, true),
    stages: [
      ...(attempt.stages ?? []),
      ...staged.filter((item) => item.inherited !== true
        && !(attempt.stages ?? []).some(
          (existing) => existing.relativePath
            === path.relative(prepared.projectRoot, item.stagePath).split(path.sep).join("/"),
        )).map((item) => ({
        relativePath: path.relative(prepared.projectRoot, item.stagePath).split(path.sep).join("/"),
        destinationPath: item.desired.relativePath,
        digest: item.desired.destinationDigest,
        identity: item.stageIdentity,
      })),
    ],
  };
  const appended = await appendAppendOnlyRecord({
    projectRoot: prepared.projectRoot,
    relativeRoot: BUILDER_INSTALL_ATTEMPT_AUTHORITY_PATH,
    namespace: INSTALL_ATTEMPT_NAMESPACE,
    idempotencyKey: `activation-finalized:${attempt.operationId}`,
    expectedHeadDigest: attempt.headDigest,
    payload,
  });
  return Object.freeze({ ...attempt, headDigest: appended.headDigest, stages: payload.stages });
}

async function recordTerminalInstallAttempt(prepared, attempt, disposition, errorCode = null) {
  const authority = await readInstallAttemptAuthority(prepared.projectRoot);
  const payload = {
    schemaVersion: installAttemptSchema(prepared),
    operationId: attempt.operationId,
    disposition,
    planDigest: prepared.planDigest,
    scopeDigest: prepared.scopeDigest,
    receiptDigest: installAttemptReceiptDigest(prepared, disposition),
    ...(prepared.hostActivation === null
      ? {}
      : {
          finalProjectionBinding:
            prepared.hostActivation.receiptBinding?.finalProjectionBinding ?? null,
        }),
    errorCode,
    hostReservation: installHostReservation(prepared),
    physicalDeletion: false,
    files: installAttemptFiles(
      prepared,
      prepared.hostActivation === null
        || prepared.hostActivation.receiptBinding?.finalProjectionBinding !== undefined,
    ),
    stages: attempt.stages ?? [],
  };
  return appendAppendOnlyRecord({
    projectRoot: prepared.projectRoot,
    relativeRoot: BUILDER_INSTALL_ATTEMPT_AUTHORITY_PATH,
    namespace: INSTALL_ATTEMPT_NAMESPACE,
    idempotencyKey: `${disposition}:${attempt.operationId}`,
    expectedHeadDigest: authority.headDigest,
    payload,
  });
}

function installAttemptSchema(prepared) {
  return prepared.hostActivation === null
    ? "agentmo.builder-install-attempt.v1"
    : "agentmo.builder-install-attempt.v2";
}

function installAttemptReceiptDigest(prepared, disposition) {
  if (prepared.hostActivation === null) return prepared.receiptDigest;
  return prepared.hostActivation.receiptBinding?.finalProjectionBinding !== undefined
    || ["activation-finalized", "committed"].includes(disposition)
    ? prepared.receiptDigest
    : null;
}

function installAttemptFiles(prepared, finalized) {
  return prepared.allFiles.map((file) => ({
    relativePath: file.relativePath,
    operation: installAttemptFileOperation(file),
    digest: prepared.hostActivation !== null
      && file.relativePath === BUILDER_INSTALL_RECEIPT_PATH
      && !finalized
      ? null
      : file.destinationDigest,
  }));
}

function installAttemptFileOperation(file) {
  return file.recoveryStage === null ? file.currentStatus : "create";
}

export async function applyBuilderInstall(options = {}) {
  assertBuilderPlatform();
  assertInstallOptionKeys(options, true);
  const hasExpectedPlanDigest = options.expectedPlanDigest !== undefined;
  let prepared;
  try {
    prepared = await prepareInstall(options);
  } catch (error) {
    if (
      hasExpectedPlanDigest
      && error instanceof BuilderInstallError
      && [
        "AGENTMO_BUILDER_INSTALL_CONFLICT",
        "AGENTMO_BUILDER_INSTALL_PATH_UNSAFE",
      ].includes(error.code)
    ) {
      fail("AGENTMO_BUILDER_INSTALL_PLAN_CHANGED");
    }
    throw error;
  }
  if (!hasExpectedPlanDigest) fail("AGENTMO_BUILDER_INSTALL_PLAN_DIGEST_REQUIRED");
  if (options.expectedPlanDigest !== prepared.planDigest) {
    fail("AGENTMO_BUILDER_INSTALL_PLAN_CHANGED");
  }
  const mutationLedger = createMutationLedger(prepared);
  await assertApprovedInitialState(prepared, mutationLedger);
  const staged = [];
  let installAttempt = await beginInstallAttempt(prepared);
  let publishedReceipt = null;
  let postHostObservation = null;
  let hostActivationTransaction = null;
  let hostStateReservation = null;
  let finalProjectionAuthority = null;
  try {
    for (const desired of prepared.allFiles) {
      if (desired.currentStatus !== "create") continue;
      if (prepared.hostActivation !== null
        && desired.relativePath === BUILDER_INSTALL_RECEIPT_PATH) continue;
      const item = desired.recoveryStage === null
        ? await stageDesiredFile(prepared.projectRoot, desired, mutationLedger)
        : await admitInheritedStageFile(prepared.projectRoot, desired, mutationLedger);
      staged.push(item);
    }
    installAttempt = await recordPreparedInstallAttempt(prepared, installAttempt, staged);

    for (const item of staged.filter((candidate) => candidate.desired.relativePath !== BUILDER_INSTALL_RECEIPT_PATH)) {
      await publishStagedFile(prepared.projectRoot, item, mutationLedger);
    }
    const terminalManagedStates = new Map();
    for (const desired of prepared.managedFiles) {
      terminalManagedStates.set(
        desired.relativePath,
        await assertInstalledDigest(
          prepared.projectRoot,
          desired.relativePath,
          desired.destinationDigest,
          mutationLedger,
          installedStateFromPrecondition(desired),
        ),
      );
    }

    if (prepared.hostActivation !== null) {
      hostStateReservation = await acquireCodexSelectorStateReservation({
        purpose: "activation",
        bindingDigest: prepared.planDigest,
        expectedOwnerDigest: prepared.hostActivation.priorState.owner.digest,
        expectedOwnerIdentityDigest: prepared.hostActivation.priorState.owner.identityDigest,
        expectedLedgerDigest: prepared.hostActivation.priorState.ledger.digest,
        expectedLedgerIdentityDigest: prepared.hostActivation.priorState.ledger.identityDigest,
      });
      hostActivationTransaction = await applyPreparedCodexActivation(
        prepared,
        terminalManagedStates,
        mutationLedger,
        hostStateReservation,
      );
      postHostObservation = hostActivationTransaction.postObservation;
    }

    try {
      if (hostStateReservation !== null) {
        finalProjectionAuthority = await retainCodexMarketplaceProjectionFinalAuthority({
          reservation: hostStateReservation,
          marketplaceRoot: prepared.hostActivation.marketplaceRoot,
          releaseDigest: prepared.hostActivation.release.releaseDigest,
          contentDigest: prepared.hostActivation.marketplaceProjection.contentDigest,
          files: prepared.hostActivation.marketplaceProjection.files,
        });
        await assertCodexMarketplaceProjectionFinalAuthority(
          finalProjectionAuthority,
          hostStateReservation,
        );
        finalizeActivatedInstallArtifacts(
          prepared,
          finalProjectionAuthority.binding,
        );
        if (prepared.receiptFile.currentStatus === "create") {
          const finalizedReceiptStage = prepared.receiptFile.recoveryStage === null
            ? await stageDesiredFile(
                prepared.projectRoot,
                prepared.receiptFile,
                mutationLedger,
              )
            : await admitInheritedStageFile(
                prepared.projectRoot,
                prepared.receiptFile,
                mutationLedger,
              );
          staged.push(finalizedReceiptStage);
        }
        installAttempt = await recordFinalizedActivationAttempt(
          prepared,
          installAttempt,
          staged,
        );
      }
      const finalizedReceiptStage = staged.find(
        (candidate) => candidate.desired.relativePath === BUILDER_INSTALL_RECEIPT_PATH,
      );
      if (finalizedReceiptStage) {
        publishedReceipt = await publishFinalizedReceipt(
          prepared.projectRoot,
          finalizedReceiptStage,
          mutationLedger,
        );
      }
      const terminalReceiptState = await assertInstalledDigest(
        prepared.projectRoot,
        BUILDER_INSTALL_RECEIPT_PATH,
        prepared.receiptDigest,
        mutationLedger,
        publishedReceipt ?? installedStateFromPrecondition(prepared.receiptFile),
      );
      for (const desired of prepared.managedFiles) {
        await assertInstalledDigest(
          prepared.projectRoot,
          desired.relativePath,
          desired.destinationDigest,
          mutationLedger,
          terminalManagedStates.get(desired.relativePath),
        );
      }
      await assertInstalledDigest(
        prepared.projectRoot,
        BUILDER_INSTALL_RECEIPT_PATH,
        prepared.receiptDigest,
        mutationLedger,
        terminalReceiptState,
      );
      if (hostStateReservation !== null) {
        await assertCodexMarketplaceProjectionFinalAuthority(
          finalProjectionAuthority,
          hostStateReservation,
        );
        await assertCodexHostState(
          prepared.hostActivation,
          prepared.hostActivation.ownerDigest,
          prepared.hostActivation.ledgerDigest,
          prepared.hostActivation.appliedOwnerIdentityDigest,
          prepared.hostActivation.appliedLedgerIdentityDigest,
        );
        await assertCodexSelectorStateReservation(hostStateReservation);
        await releaseCodexSelectorStateReservation(hostStateReservation, "committed");
        hostStateReservation = null;
        await assertCodexMarketplaceProjectionFinalAuthority(finalProjectionAuthority);
      }
      if (finalProjectionAuthority !== null) {
        await assertCodexMarketplaceProjectionFinalAuthority(finalProjectionAuthority);
      }
      await recordTerminalInstallAttempt(prepared, installAttempt, "committed");
      if (finalProjectionAuthority !== null) {
        await assertCodexMarketplaceProjectionFinalAuthority(finalProjectionAuthority);
        const committed = summarizeInstallAttempt(
          await readInstallAttemptAuthority(prepared.projectRoot),
        );
        if (committed.operationId !== installAttempt.operationId
          || committed.disposition !== "committed") {
          fail("AGENTMO_BUILDER_INSTALL_VERIFICATION_FAILED");
        }
      }
    } catch (error) {
      throw error;
    }
  } catch (error) {
    if (hostStateReservation !== null) {
      // v1 never issues compensating host removals. The retained reservation and
      // any additive host state remain evidence for explicit diagnosis.
      await recordTerminalInstallAttempt(
        prepared,
        installAttempt,
        "aborted",
        "AGENTMO_BUILDER_INSTALL_HOST_RECOVERY_REQUIRED",
      ).catch(() => {});
      fail("AGENTMO_BUILDER_INSTALL_HOST_ROLLBACK_FAILED");
    }
    await recordTerminalInstallAttempt(
      prepared,
      installAttempt,
      "aborted",
      error instanceof BuilderInstallError ? error.code : "AGENTMO_BUILDER_INSTALL_WRITE_FAILED",
    ).catch(() => {});
    fail("AGENTMO_BUILDER_INSTALL_RECOVERY_REQUIRED");
  } finally {
    await closeCodexMarketplaceProjectionFinalAuthority(finalProjectionAuthority);
    for (const item of staged) {
      await closeStagedFileHandle(item);
    }
  }

  return Object.freeze({
    schemaVersion: "agentmo.builder-install-result.v1",
    status: prepared.hostActivation === null ? "projected" : "activated",
    scope: "project",
    changed: prepared.allFiles.some((item) => item.currentStatus === "create"),
    planDigest: prepared.planDigest,
    receipt: Object.freeze({
      path: BUILDER_INSTALL_RECEIPT_PATH,
      digest: prepared.receiptDigest,
    }),
    release: Object.freeze({
      name: prepared.release.name,
      version: prepared.release.version,
      digest: prepared.release.releaseDigest,
    }),
    hostActivation: prepared.hostActivation === null
      ? Object.freeze({
          status: "explicit-user-host-scope-required",
          hostScope: null,
          mutatesHost: false,
        })
      : Object.freeze({
          status: "observed",
          hostScope: "user",
          operation: prepared.hostActivation.operation,
          selector: prepared.hostActivation.selector,
          trust: postHostObservation.trust,
          ownerDisposition: prepared.hostActivation.ownerRecord.disposition,
          consumerId: prepared.hostActivation.consumerEntry.consumerId,
          selectorDeletionAuthority: false,
        }),
    evidence: Object.freeze({
      level: prepared.hostActivation === null ? "declared-ready" : "host-observed",
      // External Codex observations only prove a bounded mechanism attempt;
      // their PATH-selected output is not an immutable trust anchor.
      codexActivationVerified: false,
      hostBehaviorVerified: false,
      domainQualityCertified: false,
    }),
  });
}

async function prepareInstall(options) {
  const hostScope = admitHostScope(options.hostScope);
  const projection = await prepareBuilderInstallArtifacts({
    ...(options.projectRoot === undefined ? {} : { projectRoot: options.projectRoot }),
    probe: options.probe,
    ...(options.packageOptions === undefined ? {} : { packageOptions: options.packageOptions }),
    ...(options.expectedPriorReceiptDigest === undefined
      ? {}
      : { expectedPriorReceiptDigest: options.expectedPriorReceiptDigest }),
    ...(options.expectedReceiptDigest === undefined
      ? {}
      : { expectedReceiptDigest: options.expectedReceiptDigest }),
  });
  if (hostScope === "user") {
    await refuseProjectedReceiptActivation(
      projection,
      options.expectedPriorReceiptDigest,
    );
  }
  const hostActivation = hostScope === "user"
    ? await prepareCodexActivation(projection, options)
    : null;
  const prepared = hostActivation === null
    ? projection
    : buildActivatedInstallArtifacts(projection, hostActivation);
  const allFiles = [...prepared.managedFiles, prepared.receiptFile];
  const projectRootIdentity = await inspectProjectRootIdentity(prepared.projectRoot);
  let attemptAuthority;
  try {
    attemptAuthority = await readInstallAttemptAuthority(prepared.projectRoot);
  } catch {
    fail("AGENTMO_BUILDER_INSTALL_RECOVERY_REQUIRED");
  }
  if (attemptAuthority.recoveryRequired !== null
    || (attemptAuthority.records.length > 0
      && ["attempt", "prepared", "activation-finalized", "aborted"].includes(
        summarizeInstallAttempt(attemptAuthority).disposition,
      ))) {
    fail("AGENTMO_BUILDER_INSTALL_RECOVERY_REQUIRED");
  }
  const priorReceipt = await inspectPriorProjectionReceipt(
    prepared,
    projection,
    hostActivation,
    options.expectedPriorReceiptDigest,
    attemptAuthority,
  );
  for (const desired of allFiles) {
    const current = await inspectDesiredState(
      prepared.projectRoot,
      desired,
      priorReceipt,
      attemptAuthority,
    );
    desired.currentStatus = current.currentStatus;
    desired.precondition = current.precondition;
    desired.recoveryStage = current.recoveryStage ?? null;
  }
  if (
    priorReceipt !== null
    && JSON.stringify(priorReceipt.fileIdentity) !== JSON.stringify(prepared.receiptFile.precondition.identity)
  ) {
    fail("AGENTMO_BUILDER_INSTALL_PLAN_CHANGED");
  }
  const projectionDigest = prepared.planDigest;
  const approvalBasis = buildBuilderInstallApprovalBasis({
    projectionDigest,
    scopeDigest: prepared.scopeDigest,
    projectRootIdentity,
    priorReceipt,
    allFiles,
    hostActivation,
  });
  return {
    ...prepared,
    allFiles,
    projectionDigest,
    approvalBasis,
    projectRootIdentity,
    priorReceipt,
    hostScope,
    hostActivation,
    planDigest: digestJson(approvalBasis, "builder-install-approval-basis"),
  };
}

async function refuseProjectedReceiptActivation(projection, expectedPriorReceiptDigest) {
  const observed = await inspectProjectPath(
    projection.projectRoot,
    BUILDER_INSTALL_RECEIPT_PATH,
  );
  if (observed.status !== "file"
    || observed.digest !== projection.receiptDigest
    || !observed.bytes.equals(projection.receiptBytes)) {
    return;
  }
  if (expectedPriorReceiptDigest !== undefined
    && observed.digest !== expectedPriorReceiptDigest) {
    fail("AGENTMO_BUILDER_INSTALL_CONFLICT");
  }
  fail("AGENTMO_BUILDER_INSTALL_IMMUTABLE_SUCCESSOR_REQUIRED");
}

export async function prepareBuilderInstallArtifacts(options = {}) {
  assertBuilderPlatform();
  const projectRoot = await admitProjectRoot(options.projectRoot ?? process.cwd());
  const scopeDigest = await computeBuilderProjectScopeDigest(projectRoot);
  if (
    options.expectedPriorReceiptDigest !== undefined
    && options.expectedReceiptDigest !== undefined
    && options.expectedPriorReceiptDigest !== options.expectedReceiptDigest
  ) {
    fail("AGENTMO_BUILDER_INSTALL_CONFLICT");
  }
  const packageReceiptAnchor = options.expectedPriorReceiptDigest ?? options.expectedReceiptDigest;
  if (
    packageReceiptAnchor !== undefined
    && !DIGEST_PATTERN.test(packageReceiptAnchor)
  ) {
    fail("AGENTMO_BUILDER_INSTALL_PRIOR_RECEIPT_DIGEST_INVALID");
  }
  const packageOptions = packageReceiptAnchor === undefined
    ? options.packageOptions
    : {
        ...(options.packageOptions ?? {}),
        expectedReceiptDigest: packageReceiptAnchor,
      };
  const release = await loadBuilderPackage(packageOptions);
  const capabilitySnapshot = buildCapabilitySnapshot(options.probe);
  const managedFiles = buildBuilderManagedFiles(release, capabilitySnapshot, scopeDigest);
  const planBasis = buildBuilderInstallPlanBasis({
    release,
    capabilitySnapshot,
    scopeDigest,
    managedFiles,
  });
  const planDigest = digestJson(planBasis, "builder-install-plan-basis");
  const receipt = {
    schemaVersion: BUILDER_INSTALL_RECEIPT_SCHEMA_VERSION,
    status: "projected",
    scope: "project",
    scopeDigest,
    identity: {
      name: release.name,
      version: release.version,
      adapterId: release.adapterId,
      releaseDigest: release.releaseDigest,
    },
    planDigest,
    capabilitySnapshot,
    markerPath: BUILDER_INSTALL_MARKER_PATH,
    receiptPath: BUILDER_INSTALL_RECEIPT_PATH,
    checkpoint: {
      path: BUILDER_CHECKPOINT_PATH,
      authority: "agentmo-checkpoint",
      initialized: false,
    },
    files: managedFiles.map(({ relativePath, sourceDigest, destinationDigest, ownership }) => ({
      relativePath,
      sourceDigest,
      destinationDigest,
      ownership,
    })),
    evidence: {
      level: "declared-ready",
      mechanismOnly: true,
      codexActivationVerified: false,
      hostBehaviorVerified: false,
      domainQualityCertified: false,
    },
  };
  const receiptBytes = jsonBytes(receipt, "builder-install-receipt");
  const receiptDigest = digestRawBytes(receiptBytes);
  const receiptFile = {
    relativePath: BUILDER_INSTALL_RECEIPT_PATH,
    sourceDigest: receiptDigest,
    destinationDigest: receiptDigest,
    ownership: "exclusive-receipt",
    bytes: receiptBytes,
  };
  return {
    projectRoot,
    scopeDigest,
    release,
    capabilitySnapshot,
    managedFiles,
    receipt,
    receiptBytes,
    receiptDigest,
    receiptFile,
    planDigest,
  };
}

async function prepareCodexActivation(projection, options) {
  void options;
  const release = {
    name: projection.release.name,
    version: projection.release.version,
    adapterId: projection.release.adapterId,
    releaseDigest: projection.release.releaseDigest,
  };
  const selector = buildCodexHostSelector(release);
  const marketplaceRoot = await resolveBuilderCodexMarketplaceRoot();
  const marketplaceFiles = codexMarketplaceProjectionFiles(projection.release);
  const marketplaceInspection = await inspectCodexMarketplaceProjectionTransaction({
    marketplaceRoot,
    releaseDigest: release.releaseDigest,
    contentDigest: buildBuilderCodexMarketplaceProjectionDigest(projection.release),
    files: marketplaceFiles,
  });
  const marketplaceProjection = {
    ...marketplaceInspection,
    files: marketplaceFiles,
  };
  const observation = await observeCodexHost({
    projectRoot: projection.projectRoot,
    release,
  });
  const installation = observation.plugin.installation;
  if (!["missing", "installed"].includes(installation)) {
    fail("AGENTMO_BUILDER_INSTALL_HOST_OBSERVATION_REQUIRED");
  }
  if (installation === "installed" && (
    observation.plugin.enabled !== true
    || observation.plugin.sourceMatch !== true
    || observation.plugin.releaseMatch !== true
  )) {
    fail("AGENTMO_BUILDER_INSTALL_HOST_CONFLICT");
  }
  if (observation.marketplace.registration === "ambiguous"
    || (observation.marketplace.registration === "registered"
      && observation.marketplace.sourceMatch !== true)
    || marketplaceProjection.status === "foreign") {
    fail("AGENTMO_BUILDER_INSTALL_HOST_CONFLICT");
  }
  const userState = await readCodexSelectorState();
  if (userState.owner.status === "inconsistent" || userState.ledger.status === "inconsistent") {
    fail("AGENTMO_BUILDER_INSTALL_HOST_EVIDENCE_INCONSISTENT");
  }
  const ownerRecord = desiredOwnerRecord({
    current: userState.owner,
    selector,
    release,
    preexisting: installation === "installed" || observation.marketplace.registration === "registered",
  });
  const consumerEntry = buildCodexConsumerEntry({
    selector,
    projectScopeDigest: projection.scopeDigest,
    releaseDigest: release.releaseDigest,
  });
  const consumerLedger = desiredConsumerLedger({
    current: userState.ledger,
    selector,
    consumerEntry,
    release,
  });
  const ownerDigest = digestCodexSelectorOwnerRecord(ownerRecord);
  const ledgerDigest = digestCodexConsumerLedger(consumerLedger);
  const consumerEntryDigest = digestJson(consumerEntry, "codex-consumer-entry");
  const expectedPostObservation = Object.freeze({
    installation: "installed",
    enabled: true,
    sourceMatch: true,
    releaseMatch: true,
    skillVisibility: "visible",
    hooksVisibility: "visible",
    trust: "trusted-or-pending-human",
    agentHostVisibility: "unobservable",
  });
  const owner = Object.freeze({
    disposition: ownerRecord.disposition,
    priorDigest: userState.owner.digest,
    desiredDigest: ownerDigest,
  });
  const consumerLedgerBinding = Object.freeze({
    consumerId: consumerEntry.consumerId,
    consumerEntryDigest,
    priorDigest: userState.ledger.digest,
    desiredDigest: ledgerDigest,
  });
  const marketplaceOperation = observation.marketplace.registration === "registered" ? "none" : "add";
  const pluginOperation = installation === "installed" ? "none" : "add";
  const operation = marketplaceOperation === "none" && pluginOperation === "none" ? "none" : "activate";
  const operationOrder = Object.freeze([
    "projection-publication",
    "projection-observation",
    "marketplace-add-if-absent",
    "marketplace-reobservation",
    "plugin-add-if-absent",
    "selector-visibility-observation",
    "owner-publication",
    "consumer-publication",
    "project-receipt-last",
  ]);
  const planBinding = deepFreeze({
    hostScope: "user",
    operation,
    marketplaceOperation,
    pluginOperation,
    operationOrder,
    selector,
    marketplaceProjection: {
      contentDigest: marketplaceProjection.contentDigest,
      transactionId: marketplaceProjection.transactionId,
      transactionDigest: marketplaceProjection.transactionDigest,
      priorStatus: marketplaceProjection.status,
      priorRootIdentityDigest: marketplaceProjection.rootIdentityDigest,
    },
    source: {
      kind: "agentmo-projected-release",
      releaseDigest: release.releaseDigest,
    },
    release,
    preObservationDigest: observation.observationDigest,
    owner,
    consumerLedger: consumerLedgerBinding,
    expectedPostObservation,
  });
  const publicBinding = deepFreeze({
    status: "ready-for-explicit-user-host-apply",
    mutatesHost: operation !== "none",
    ...planBinding,
  });
  const receiptBindingBasis = deepFreeze({
    hostScope: "user",
    selector,
    releaseDigest: release.releaseDigest,
    marketplaceProjectionDigest: marketplaceProjection.contentDigest,
    operationOrderDigest: digestJson(operationOrder, "builder-codex-activation-operation-order"),
    ownerDisposition: ownerRecord.disposition,
    ownerRecordDigest: ownerDigest,
    consumerId: consumerEntry.consumerId,
    consumerEntryDigest,
    consumerLedgerDigest: ledgerDigest,
    consumerEntryOwned: true,
    selectorDeletionAuthority: false,
    expectedPostObservation,
  });
  const receiptBinding = marketplaceProjection.binding === null
    ? null
    : buildFinalActivationReceiptBinding(receiptBindingBasis, marketplaceProjection.binding);
  return {
    operation,
    marketplaceOperation,
    pluginOperation,
    operationOrder,
    selector,
    release,
    preObservation: observation,
    priorState: userState,
    ownerRecord,
    consumerEntry,
    consumerLedger,
    ownerDigest,
    ledgerDigest,
    expectedPostObservation,
    planBinding,
    publicBinding,
    receiptBindingBasis,
    receiptBinding,
    marketplaceRoot,
    marketplaceRelease: projection.release,
    marketplaceProjection,
  };
}

function buildActivatedInstallArtifacts(projection, activation) {
  const placeholderBinding = activation.receiptBinding ?? {
    schemaVersion: "agentmo.builder-codex-activation-binding.v3",
    ...activation.receiptBindingBasis,
    finalProjectionBinding: null,
  };
  const receipt = {
    ...projection.receipt,
    schemaVersion: BUILDER_ACTIVATED_RECEIPT_SCHEMA_VERSION,
    status: "activated",
    hostActivation: placeholderBinding,
    evidence: {
      level: "host-observed",
      mechanismOnly: true,
      // A completed host operation remains non-certifying until an independent
      // immutable trust anchor exists.
      codexActivationVerified: false,
      hostBehaviorVerified: false,
      domainQualityCertified: false,
    },
  };
  const receiptBytes = jsonBytes(receipt, "builder-install-receipt");
  const receiptDigest = digestRawBytes(receiptBytes);
  return {
    ...projection,
    receipt,
    receiptBytes,
    receiptDigest,
    receiptFile: {
      relativePath: BUILDER_INSTALL_RECEIPT_PATH,
      sourceDigest: receiptDigest,
      destinationDigest: receiptDigest,
      ownership: "exclusive-receipt",
      bytes: receiptBytes,
    },
  };
}

function buildFinalActivationReceiptBinding(basis, finalProjectionBinding) {
  if (finalProjectionBinding?.schemaVersion
      !== "agentmo.codex-marketplace-projection-binding.v1"
    || finalProjectionBinding.contentDigest !== basis.marketplaceProjectionDigest
    || finalProjectionBinding.releaseDigest !== basis.releaseDigest) {
    fail("AGENTMO_BUILDER_INSTALL_VERIFICATION_FAILED");
  }
  return deepFreeze({
    schemaVersion: "agentmo.builder-codex-activation-binding.v3",
    ...basis,
    finalProjectionBinding,
  });
}

function finalizeActivatedInstallArtifacts(prepared, finalProjectionBinding) {
  const activation = prepared.hostActivation;
  const receiptBinding = buildFinalActivationReceiptBinding(
    activation.receiptBindingBasis,
    finalProjectionBinding,
  );
  const receipt = {
    ...prepared.receipt,
    schemaVersion: BUILDER_ACTIVATED_RECEIPT_SCHEMA_VERSION,
    status: "activated",
    hostActivation: receiptBinding,
  };
  const receiptBytes = jsonBytes(receipt, "builder-install-receipt");
  const receiptDigest = digestRawBytes(receiptBytes);
  activation.receiptBinding = receiptBinding;
  prepared.receipt = receipt;
  prepared.receiptBytes = receiptBytes;
  prepared.receiptDigest = receiptDigest;
  prepared.receiptFile.sourceDigest = receiptDigest;
  prepared.receiptFile.destinationDigest = receiptDigest;
  prepared.receiptFile.bytes = receiptBytes;
}

function desiredOwnerRecord({ current, selector, release, preexisting }) {
  if (current.status === "valid") {
    const value = current.value;
    if (
      JSON.stringify(value.selector) !== JSON.stringify(selector)
      || JSON.stringify(value.release) !== JSON.stringify(release)
      || value.sourceDigest !== release.releaseDigest
    ) {
      fail("AGENTMO_BUILDER_INSTALL_HOST_EVIDENCE_INCONSISTENT");
    }
    return value;
  }
  if (current.status !== "missing") fail("AGENTMO_BUILDER_INSTALL_HOST_EVIDENCE_INCONSISTENT");
  return buildCodexSelectorOwnerRecord({
    selector,
    disposition: preexisting ? "preexisting-unowned" : "created-by-agentmo",
    release,
    sourceDigest: release.releaseDigest,
  });
}

function desiredConsumerLedger({ current, selector, consumerEntry, release }) {
  const consumers = current.status === "missing" ? [] : current.value.consumers;
  if (current.status !== "missing" && current.status !== "valid") {
    fail("AGENTMO_BUILDER_INSTALL_HOST_EVIDENCE_INCONSISTENT");
  }
  if (consumers.some((entry) => entry.releaseDigest !== release.releaseDigest)) {
    fail("AGENTMO_BUILDER_INSTALL_HOST_EVIDENCE_INCONSISTENT");
  }
  const existing = consumers.find((entry) => entry.consumerId === consumerEntry.consumerId);
  if (existing && JSON.stringify(existing) !== JSON.stringify(consumerEntry)) {
    fail("AGENTMO_BUILDER_INSTALL_HOST_EVIDENCE_INCONSISTENT");
  }
  return buildCodexConsumerLedger({
    selector,
    consumers: existing ? consumers : [...consumers, consumerEntry],
  });
}

async function applyPreparedCodexActivation(
  prepared,
  terminalManagedStates,
  mutationLedger,
  reservation,
) {
  const activation = prepared.hostActivation;
  await assertCodexHostState(
    activation,
    activation.priorState.owner.digest,
    activation.priorState.ledger.digest,
  );
  for (const desired of prepared.managedFiles) {
    await assertInstalledDigest(
      prepared.projectRoot,
      desired.relativePath,
      desired.destinationDigest,
      mutationLedger,
      terminalManagedStates.get(desired.relativePath),
    );
  }
  const immediatePreObservation = await observeCodexHost({
    projectRoot: prepared.projectRoot,
    release: activation.release,
  });
  if (immediatePreObservation.observationDigest !== activation.preObservation.observationDigest) {
    fail("AGENTMO_BUILDER_INSTALL_HOST_STATE_CHANGED");
  }
  await assertApprovedPriorReceiptState(prepared, mutationLedger);
  await assertCodexSelectorStateReservation(reservation);
  activation.appliedProjection = await publishCodexMarketplaceProjection(
    activation,
    reservation,
  );
  const projectionObservation = await observeCodexHost({
    projectRoot: prepared.projectRoot,
    release: activation.release,
  });
  if (projectionObservation.marketplace.sourceAvailable !== true
    || (activation.marketplaceOperation === "none"
      && (projectionObservation.marketplace.registration !== "registered"
        || projectionObservation.marketplace.sourceMatch !== true))) {
    fail("AGENTMO_BUILDER_INSTALL_HOST_STATE_CHANGED");
  }
  if (activation.marketplaceOperation === "add") {
    try {
      await mutateCodexHost({
        operation: "marketplace-add",
        hostScope: "user",
        selector: activation.selector,
        projectRoot: prepared.projectRoot,
        release: activation.release,
      });
      activation.marketplaceCreated = true;
    } catch {
      fail("AGENTMO_BUILDER_INSTALL_HOST_MUTATION_FAILED");
    }
  }
  const marketplaceObservation = await observeCodexHost({
    projectRoot: prepared.projectRoot,
    release: activation.release,
  });
  if (marketplaceObservation.marketplace.registration !== "registered"
    || marketplaceObservation.marketplace.sourceMatch !== true
    || marketplaceObservation.marketplace.sourceAvailable !== true) {
    fail("AGENTMO_BUILDER_INSTALL_HOST_POSTCONDITION_FAILED");
  }
  if (activation.pluginOperation === "add") {
    try {
      await mutateCodexHost({
        operation: "plugin-add",
        hostScope: "user",
        selector: activation.selector,
        projectRoot: prepared.projectRoot,
        release: activation.release,
        marketplaceObservation: marketplaceObservation.marketplace,
      });
      activation.pluginCreated = true;
    } catch {
      fail("AGENTMO_BUILDER_INSTALL_HOST_MUTATION_FAILED");
    }
  }
  const postObservation = await observeCodexHost({
    projectRoot: prepared.projectRoot,
    release: activation.release,
  });
  assertExpectedCodexPostObservation(postObservation, activation.expectedPostObservation);
  await assertCodexHostState(
    activation,
    activation.priorState.owner.digest,
    activation.priorState.ledger.digest,
  );
  try {
    const ownerWrite = await writeCodexSelectorOwnerRecord(activation.ownerRecord, {
      expectedPriorDigest: activation.priorState.owner.digest,
      expectedPriorIdentityDigest: activation.priorState.owner.identityDigest,
      reservation,
    });
    activation.appliedOwnerIdentityDigest = ownerWrite.identityDigest;
    const ledgerWrite = await writeCodexConsumerLedger(activation.consumerLedger, {
      expectedPriorDigest: activation.priorState.ledger.digest,
      expectedPriorIdentityDigest: activation.priorState.ledger.identityDigest,
      reservation,
    });
    activation.appliedLedgerIdentityDigest = ledgerWrite.identityDigest;
    await assertCodexHostState(
      activation,
      activation.ownerDigest,
      activation.ledgerDigest,
      activation.appliedOwnerIdentityDigest,
      activation.appliedLedgerIdentityDigest,
    );
    for (const desired of prepared.managedFiles) {
      await assertInstalledDigest(
        prepared.projectRoot,
        desired.relativePath,
        desired.destinationDigest,
        mutationLedger,
        terminalManagedStates.get(desired.relativePath),
      );
    }
  } catch (error) {
    try {
      await rollbackCodexActivationState(activation, reservation);
    } catch {
      fail("AGENTMO_BUILDER_INSTALL_HOST_ROLLBACK_FAILED");
    }
    if (error instanceof BuilderInstallError) throw error;
    fail("AGENTMO_BUILDER_INSTALL_HOST_STATE_CHANGED");
  }
  return Object.freeze({ postObservation });
}

async function rollbackCodexActivationState(activation, reservation) {
  void activation;
  void reservation;
  // AgentMo v1 never compensates an uncertain host effect with physical
  // removal. The retained reservation and append-only attempt evidence are
  // the recovery boundary; a fresh exact recovery must inspect them.
  fail("AGENTMO_BUILDER_INSTALL_RECOVERY_REQUIRED");
}

async function observeActivationHost(activation) {
  return observeCodexHost({
    projectRoot: activation.marketplaceRoot,
    release: activation.release,
  });
}

async function canProveCodexActivationRollback(activation, reservation) {
  try {
    await assertCodexSelectorStateReservation(reservation);
    await assertCodexHostState(
      activation,
      activation.ownerDigest,
      activation.ledgerDigest,
      activation.appliedOwnerIdentityDigest,
      activation.appliedLedgerIdentityDigest,
    );
    await assertCodexSelectorStateReservation(reservation);
    return true;
  } catch {
    return false;
  }
}

async function assertCodexHostState(
  activation,
  ownerDigest,
  ledgerDigest,
  ownerIdentityDigest = undefined,
  ledgerIdentityDigest = undefined,
) {
  const state = await readCodexSelectorState();
  if (state.owner.status === "inconsistent" || state.ledger.status === "inconsistent"
    || state.owner.digest !== ownerDigest || state.ledger.digest !== ledgerDigest
    || (ownerIdentityDigest !== undefined && state.owner.identityDigest !== ownerIdentityDigest)
    || (ledgerIdentityDigest !== undefined && state.ledger.identityDigest !== ledgerIdentityDigest)) {
    fail("AGENTMO_BUILDER_INSTALL_HOST_STATE_CHANGED");
  }
}

function assertExpectedCodexPostObservation(observation, expected) {
  if (
    observation.plugin.installation !== expected.installation
    || observation.plugin.enabled !== expected.enabled
    || observation.plugin.sourceMatch !== expected.sourceMatch
    || observation.plugin.releaseMatch !== expected.releaseMatch
    || observation.skill.visibility !== expected.skillVisibility
    || observation.hooks.visibility !== expected.hooksVisibility
    // A PATH-selected external `codex` command cannot mint trusted state.
    // The activation binding's broad historical vocabulary is retained for
    // compatibility, but a fresh postcondition must remain pending-human.
    || observation.trust !== "pending-human"
    || observation.agent.hostVisibility !== expected.agentHostVisibility
  ) {
    fail("AGENTMO_BUILDER_INSTALL_HOST_POSTCONDITION_FAILED");
  }
}

export function buildBuilderInstallPlanBasis({ release, capabilitySnapshot, scopeDigest, managedFiles }) {
  return {
    schemaVersion: "agentmo.builder-install-plan-basis.v1",
    scope: "project",
    scopeDigest,
    release: { name: release.name, version: release.version, digest: release.releaseDigest },
    capabilityDigest: capabilitySnapshot.digest,
    receiptPath: BUILDER_INSTALL_RECEIPT_PATH,
    files: managedFiles.map(({ relativePath, sourceDigest, destinationDigest, ownership }) => ({
      relativePath,
      sourceDigest,
      destinationDigest,
      ownership,
    })),
  };
}

function codexMarketplaceProjectionFiles(release) {
  const marketplaceBytes = jsonBytes(MARKETPLACE, "builder-marketplace");
  return [
    {
      relativePath: path.join(".agents", "plugins", "marketplace.json"),
      bytes: marketplaceBytes,
      digest: digestRawBytes(marketplaceBytes),
    },
    ...release.assets.map((asset) => ({
      relativePath: asset.destinationPath,
      bytes: Buffer.from(asset.bytes),
      digest: asset.digest,
    })),
  ].toSorted((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export function buildBuilderCodexMarketplaceProjectionDigest(release) {
  const files = codexMarketplaceProjectionFiles(release);
  return digestJson({
    schemaVersion: "agentmo.codex-marketplace-projection.v1",
    releaseDigest: release.releaseDigest,
    files: files.map(({ relativePath, digest }) => ({ relativePath, digest })),
  }, "codex-marketplace-projection");
}

export async function prepareBuilderCodexMarketplaceProjection(options = {}) {
  assertBuilderPlatform();
  if (!exactObjectKeys(options, ["release"]) || options.release === undefined) {
    fail("AGENTMO_BUILDER_INSTALL_ARGUMENTS_REJECTED");
  }
  const marketplaceRoot = await resolveBuilderCodexMarketplaceRoot();
  const files = codexMarketplaceProjectionFiles(options.release);
  const inspected = await inspectCodexMarketplaceProjectionTransaction({
    marketplaceRoot,
    releaseDigest: options.release.releaseDigest,
    contentDigest: buildBuilderCodexMarketplaceProjectionDigest(options.release),
    files,
  });
  const marketplaceProjection = { ...inspected, files };
  return {
    marketplaceRoot,
    marketplaceRelease: options.release,
    marketplaceProjection,
    appliedProjection: null,
  };
}

export async function publishBuilderCodexMarketplaceProjection(prepared) {
  assertBuilderPlatform();
  if (prepared.reservation === undefined) {
    fail("AGENTMO_BUILDER_INSTALL_HOST_RESERVATION_REQUIRED");
  }
  prepared.appliedProjection = await publishCodexMarketplaceProjection(
    prepared,
    prepared.reservation,
  );
  return prepared.appliedProjection;
}

export async function retireCreatedBuilderCodexMarketplaceProjection(prepared) {
  assertBuilderPlatform();
  return retireCreatedCodexMarketplaceProjection(prepared);
}

async function inspectCodexMarketplaceProjection({ marketplaceRoot, release }) {
  const files = codexMarketplaceProjectionFiles(release);
  const inspected = await inspectCodexMarketplaceProjectionTransaction({
    marketplaceRoot,
    releaseDigest: release.releaseDigest,
    contentDigest: buildBuilderCodexMarketplaceProjectionDigest(release),
    files,
  });
  return { ...inspected, files };
}

async function publishCodexMarketplaceProjection(activation, reservation) {
  if (!["absent", "resumable", "exact"].includes(activation.marketplaceProjection.status)) {
    fail("AGENTMO_BUILDER_INSTALL_HOST_CONFLICT");
  }
  try {
    const published = await publishCodexMarketplaceProjectionTransaction({
      reservation,
      marketplaceRoot: activation.marketplaceRoot,
      releaseDigest: activation.release.releaseDigest,
      contentDigest: activation.marketplaceProjection.contentDigest,
      files: activation.marketplaceProjection.files,
    });
    if (published.status !== "exact"
      || published.contentDigest !== activation.marketplaceProjection.contentDigest
      || (activation.marketplaceProjection.status === "exact"
        && JSON.stringify(published.binding)
          !== JSON.stringify(activation.marketplaceProjection.binding))) {
      fail("AGENTMO_BUILDER_INSTALL_VERIFICATION_FAILED");
    }
    return published;
  } catch (error) {
    if (error instanceof BuilderInstallError) throw error;
    fail("AGENTMO_BUILDER_INSTALL_WRITE_FAILED");
  }
}

async function retireCreatedCodexMarketplaceProjection(activation) {
  if (activation.appliedProjection?.created !== true) {
    return deepFreeze({ retained: false, physicalDeletion: false });
  }
  const current = await inspectCodexMarketplaceProjection({
    marketplaceRoot: activation.marketplaceRoot,
    release: activation.marketplaceRelease,
  });
  if (current.status !== "exact"
    || current.contentDigest !== activation.appliedProjection.contentDigest
    || current.rootIdentityDigest !== activation.appliedProjection.rootIdentityDigest) {
    fail("AGENTMO_BUILDER_INSTALL_HOST_ROLLBACK_FAILED");
  }
  return deepFreeze({
    retained: true,
    physicalDeletion: false,
    contentDigest: current.contentDigest,
    rootIdentityDigest: current.rootIdentityDigest,
  });
}

function buildBuilderInstallApprovalBasis({
  projectionDigest,
  scopeDigest,
  projectRootIdentity,
  priorReceipt,
  allFiles,
  hostActivation,
}) {
  return {
    schemaVersion: hostActivation === null
      ? "agentmo.builder-install-approval-basis.v2"
      : "agentmo.builder-install-approval-basis.v3",
    scope: "project",
    scopeDigest,
    projectRootIdentity,
    projectionDigest,
    priorReceipt: priorReceipt === null
      ? null
      : {
          digest: priorReceipt.digest,
          fileIdentity: priorReceipt.fileIdentity,
          projectionIdentity: priorReceipt.projectionIdentity,
          transition: priorReceipt.transition,
          desiredDigest: priorReceipt.desiredDigest,
        },
    hostActivation: hostActivation === null ? null : hostActivation.planBinding,
    files: allFiles.map(({
      relativePath,
      sourceDigest,
      destinationDigest,
      ownership,
      precondition,
    }) => ({
      relativePath,
      sourceDigest,
      destinationDigest,
      ownership,
      precondition,
    })),
  };
}

export function buildBuilderManagedFiles(release, capabilitySnapshot, scopeDigest) {
  const files = [];
  const agentAsset = release.assets.find((asset) => asset.sourcePath === "plugin/agents/agentmo.toml");
  if (!agentAsset) fail("AGENTMO_BUILDER_PACKAGE_INVALID");
  files.push({
    relativePath: BUILDER_PROJECT_AGENT_PATH,
    sourceDigest: agentAsset.digest,
    destinationDigest: agentAsset.digest,
    ownership: "exclusive-project-agent",
    bytes: Buffer.from(agentAsset.bytes),
  });
  const marker = {
    schemaVersion: BUILDER_INSTALL_MARKER_SCHEMA_VERSION,
    identity: {
      name: release.name,
      version: release.version,
      adapterId: release.adapterId,
      releaseDigest: release.releaseDigest,
    },
    scope: "project",
    scopeDigest,
    receiptPath: BUILDER_INSTALL_RECEIPT_PATH,
    checkpointPath: BUILDER_CHECKPOINT_PATH,
    capabilityDigest: capabilitySnapshot.digest,
    projectionStatus: "receipt-required",
    selfCertifying: false,
  };
  const markerBytes = jsonBytes(marker, "builder-install-marker");
  const markerDigest = digestRawBytes(markerBytes);
  files.push({
    relativePath: BUILDER_INSTALL_MARKER_PATH,
    sourceDigest: markerDigest,
    destinationDigest: markerDigest,
    ownership: "exclusive-marker",
    bytes: markerBytes,
  });
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function buildCapabilitySnapshot(probe) {
  if (
    probe?.schemaVersion !== "agentmo.builder-probe.v1"
    || probe?.adapter?.id !== "codex"
    || probe?.mutatesHost !== "unknown"
    || probe?.externalCommandMutation !== "unknown"
    || probe?.required?.ok !== true
    || !Array.isArray(probe?.observations)
  ) {
    fail("AGENTMO_BUILDER_INSTALL_PROBE_REJECTED");
  }
  const required = probe.observations
    .filter((item) => item?.requirement === "required")
    .map((item) => ({ id: item.id, status: item.status }))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (
    required.length === 0
    || required.some((item) => !/^[a-z][a-z0-9-]{1,63}$/u.test(item.id ?? "") || item.status !== "observed")
  ) {
    fail("AGENTMO_BUILDER_INSTALL_PROBE_REJECTED");
  }
  const optional = probe.observations
    .filter((item) => item?.requirement === "optional")
    .map((item) => ({ id: item.id, status: item.status }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const basis = {
    schemaVersion: "agentmo.builder-capability-snapshot.v1",
    adapterId: "codex",
    hostVersion: typeof probe.host?.version === "string" ? probe.host.version : "unversioned",
    evidenceLevel: "observed",
    mutatesHost: probe.mutatesHost,
    externalCommandMutation: probe.externalCommandMutation,
    required,
    optional,
  };
  return { ...basis, digest: digestJson(basis, "builder-capability-snapshot") };
}

function publicPlan(prepared) {
  return Object.freeze({
    schemaVersion: "agentmo.builder-install-plan.v1",
    action: "setup",
    mode: "preview",
    scope: "project",
    scopeDigest: prepared.scopeDigest,
    applicable: true,
    requiresExplicitApply: true,
    planDigest: prepared.planDigest,
    release: Object.freeze({
      name: prepared.release.name,
      version: prepared.release.version,
      digest: prepared.release.releaseDigest,
    }),
    capabilityDigest: prepared.capabilitySnapshot.digest,
    priorReceipt: prepared.priorReceipt === null
      ? null
      : Object.freeze({ digest: prepared.priorReceipt.digest }),
    hostActivation: prepared.hostActivation === null
      ? Object.freeze({
          status: "explicit-user-host-scope-required",
          hostScope: null,
          mutatesHost: false,
        })
      : prepared.hostActivation.publicBinding,
    operations: Object.freeze(prepared.allFiles.map((item) => Object.freeze({
      operation: "ensure-exact-file",
      relativePath: item.relativePath,
      sourceDigest: item.sourceDigest,
      destinationDigest: item.destinationDigest,
      ownership: item.ownership,
      currentStatus: item.currentStatus,
    }))),
    evidence: Object.freeze({
      level: "proposal-only",
      codexActivationVerified: false,
      hostBehaviorVerified: false,
      domainQualityCertified: false,
    }),
  });
}

async function admitProjectRoot(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    fail("AGENTMO_BUILDER_INSTALL_SCOPE_REJECTED");
  }
  try {
    const canonical = await realpath(path.resolve(value));
    const stats = await lstat(canonical);
    if (stats.isSymbolicLink() || !stats.isDirectory()) fail("AGENTMO_BUILDER_INSTALL_SCOPE_REJECTED");
    return canonical;
  } catch (error) {
    if (error instanceof BuilderInstallError) throw error;
    fail("AGENTMO_BUILDER_INSTALL_SCOPE_REJECTED");
  }
}

export async function computeBuilderProjectScopeDigest(projectRoot) {
  assertBuilderPlatform();
  try {
    const canonical = await realpath(projectRoot);
    const stats = await lstat(projectRoot, { bigint: true });
    if (canonical !== projectRoot || stats.isSymbolicLink() || !stats.isDirectory()) {
      fail("AGENTMO_BUILDER_INSTALL_SCOPE_REJECTED");
    }
    return digestJson({
      schemaVersion: "agentmo.builder-project-scope.v1",
      canonicalRootDigest: digestRawBytes(Buffer.from(canonical, "utf8")),
      device: stats.dev.toString(10),
      inode: stats.ino.toString(10),
    }, "builder-project-scope");
  } catch (error) {
    if (error instanceof BuilderInstallError) throw error;
    fail("AGENTMO_BUILDER_INSTALL_SCOPE_REJECTED");
  }
}

async function inspectProjectRootIdentity(projectRoot) {
  try {
    const canonical = await realpath(projectRoot);
    const stats = await lstat(projectRoot, { bigint: true });
    if (canonical !== projectRoot || stats.isSymbolicLink() || !stats.isDirectory()) {
      fail("AGENTMO_BUILDER_INSTALL_SCOPE_REJECTED");
    }
    return {
      device: stats.dev.toString(10),
      inode: stats.ino.toString(10),
    };
  } catch (error) {
    if (error instanceof BuilderInstallError) throw error;
    fail("AGENTMO_BUILDER_INSTALL_SCOPE_REJECTED");
  }
}

async function inspectPriorProjectionReceipt(
  prepared,
  projection,
  hostActivation,
  expectedPriorReceiptDigest,
  attemptAuthority,
) {
  if (
    expectedPriorReceiptDigest !== undefined
    && !DIGEST_PATTERN.test(expectedPriorReceiptDigest)
  ) {
    fail("AGENTMO_BUILDER_INSTALL_PRIOR_RECEIPT_DIGEST_INVALID");
  }
  const observed = await inspectProjectPath(prepared.projectRoot, BUILDER_INSTALL_RECEIPT_PATH);
  if (observed.status === "absent") {
    if (expectedPriorReceiptDigest !== undefined) {
      fail("AGENTMO_BUILDER_INSTALL_CONFLICT");
    }
    return null;
  }
  if (observed.status !== "file") {
    fail("AGENTMO_BUILDER_INSTALL_CONFLICT");
  }
  const matchesDesired = observed.digest === prepared.receiptDigest
    && observed.bytes.equals(prepared.receiptBytes);
  const upgradesProjectedV2 = hostActivation !== null
    && observed.digest === projection.receiptDigest
    && observed.bytes.equals(projection.receiptBytes);
  const recoveryStage = expectedPriorReceiptDigest === undefined
    && matchesDesired
    ? await supersededRetainedInstallStage(
        prepared.projectRoot,
        BUILDER_INSTALL_RECEIPT_PATH,
        observed,
        attemptAuthority,
      )
    : null;
  const recoveryOwned = recoveryStage !== null;
  if (expectedPriorReceiptDigest === undefined && recoveryStage === null) {
    fail("AGENTMO_BUILDER_INSTALL_CONFLICT");
  }
  if (expectedPriorReceiptDigest !== undefined
    && observed.digest !== expectedPriorReceiptDigest) {
    fail("AGENTMO_BUILDER_INSTALL_CONFLICT");
  }
  if (!matchesDesired && !upgradesProjectedV2) fail("AGENTMO_BUILDER_INSTALL_CONFLICT");
  if (upgradesProjectedV2) fail("AGENTMO_BUILDER_INSTALL_IMMUTABLE_SUCCESSOR_REQUIRED");
  return {
    digest: observed.digest,
    bytes: observed.bytes,
    fileIdentity: observed.identity,
    recoveryStage,
    transition: recoveryOwned ? "superseded-retained" : "none",
    desiredDigest: prepared.receiptDigest,
    projectionIdentity: {
      name: projection.receipt.identity.name,
      version: projection.receipt.identity.version,
      adapterId: projection.receipt.identity.adapterId,
      releaseDigest: projection.receipt.identity.releaseDigest,
    },
  };
}

async function assertApprovedPriorReceiptState(prepared, ledger) {
  const relativePath = BUILDER_INSTALL_RECEIPT_PATH;
  let observed;
  try {
    await assertProjectRootLedger(prepared.projectRoot, ledger);
    observed = await inspectProjectPath(prepared.projectRoot, relativePath);
  } catch {
    fail("AGENTMO_BUILDER_INSTALL_PLAN_CHANGED");
  }
  if (prepared.priorReceipt === null) {
    if (
      observed.status !== "absent"
      || !observedParentsMatchLedger(observed.parents ?? [], relativePath, ledger)
    ) {
      fail("AGENTMO_BUILDER_INSTALL_PLAN_CHANGED");
    }
    await assertAuthorizedParentChain(prepared.projectRoot, relativePath, ledger);
    return;
  }
  const expectedState = installedStateFromPrecondition(prepared.receiptFile);
  const observedState = observed.status === "file"
    ? {
        relativePath,
        digest: observed.digest,
        identity: observed.identity,
        parents: observed.parents,
      }
    : null;
  if (
    observedState === null
    || expectedState === null
    || observed.digest !== prepared.priorReceipt.digest
    || !observed.bytes.equals(prepared.priorReceipt.bytes)
    || !sameInstalledState(observedState, expectedState)
    || !observedParentsMatchLedger(observed.parents, relativePath, ledger)
  ) {
    fail("AGENTMO_BUILDER_INSTALL_PLAN_CHANGED");
  }
  await assertAuthorizedParentChain(prepared.projectRoot, relativePath, ledger);
}

async function inspectDesiredState(projectRoot, desired, priorReceipt, attemptAuthority) {
  const observed = await inspectProjectPath(projectRoot, desired.relativePath);
  if (observed.status === "absent") {
    if (priorReceipt !== null) fail("AGENTMO_BUILDER_INSTALL_CONFLICT");
    const recoveryStage = await supersededInertInstallStage(
      projectRoot,
      desired.relativePath,
      desired.destinationDigest,
      attemptAuthority,
    );
    return {
      currentStatus: "create",
      precondition: {
        state: "absent",
        parents: observed.parents,
        missingFrom: observed.missingFrom,
      },
      recoveryStage,
    };
  }
  if (observed.status !== "file") fail("AGENTMO_BUILDER_INSTALL_PATH_UNSAFE");
  if (observed.digest !== desired.destinationDigest) {
    fail("AGENTMO_BUILDER_INSTALL_CONFLICT");
  }
  const receiptOwned = priorReceipt !== null;
  const recoveryStage = await supersededRetainedInstallStage(
    projectRoot,
    desired.relativePath,
    observed,
    attemptAuthority,
  );
  const recoveryOwned = recoveryStage !== null;
  if (desired.ownership !== "shared-marketplace-file" && !receiptOwned && !recoveryOwned) {
    fail("AGENTMO_BUILDER_INSTALL_CONFLICT");
  }
  return {
    currentStatus: "unchanged",
    precondition: {
      state: receiptOwned
        ? "receipt-owned-pristine"
        : recoveryOwned
          ? "superseded-retained-pristine"
          : "shared-pristine",
      digest: observed.digest,
      identity: observed.identity,
      parents: observed.parents,
    },
    recoveryStage,
  };
}

async function supersededRetainedInstallStage(
  projectRoot,
  relativePath,
  observed,
  authority,
) {
  const stage = await supersededInstallStage(
    projectRoot,
    relativePath,
    observed.digest,
    authority,
  );
  if (stage === null || stage.links !== "2") return null;
  let stageStats;
  let destinationStats;
  try {
    [stageStats, destinationStats] = await Promise.all([
      lstat(resolveProjectPath(projectRoot, stage.relativePath), { bigint: true }),
      lstat(resolveProjectPath(projectRoot, relativePath), { bigint: true }),
    ]);
  } catch {
    return null;
  }
  const exact = stageStats.isFile() && !stageStats.isSymbolicLink()
    && destinationStats.isFile() && !destinationStats.isSymbolicLink()
    && sameIdentity(stageStats, destinationStats)
    && stageStats.dev.toString(10) === stage.identity.device
    && stageStats.ino.toString(10) === stage.identity.inode
    && stageStats.size.toString(10) === stage.identity.size;
  return exact ? deepFreeze({
    relativePath: stage.relativePath,
    destinationPath: stage.destinationPath,
    digest: stage.digest,
    identity: { ...stage.identity },
  }) : null;
}

async function supersededInertInstallStage(
  projectRoot,
  relativePath,
  expectedDigest,
  authority,
) {
  const stage = await supersededInstallStage(
    projectRoot,
    relativePath,
    expectedDigest,
    authority,
  );
  if (stage === null || stage.links !== "1") return null;
  return deepFreeze({
    relativePath: stage.relativePath,
    destinationPath: stage.destinationPath,
    digest: stage.digest,
    identity: { ...stage.identity },
  });
}

async function supersededInstallStage(projectRoot, relativePath, expectedDigest, authority) {
  if (authority.records.length === 0) return null;
  const summary = summarizeInstallAttempt(authority);
  if (summary.disposition !== "superseded") return null;
  const latest = latestInstallAttemptPayload(authority);
  const file = latest.files?.find((item) => item?.relativePath === relativePath);
  const stage = latest.stages?.find((item) => item?.destinationPath === relativePath);
  if (!file || file.operation !== "create" || file.digest !== expectedDigest
    || !stage || stage.digest !== expectedDigest || !validRecordedStageIdentity(stage.identity)
    || !portableRelativePath(stage.relativePath)
    || path.posix.dirname(stage.relativePath) !== path.posix.dirname(relativePath)) {
    return null;
  }
  const inspected = await inspectRecoveryStage(projectRoot, stage);
  return deepFreeze({
    relativePath: stage.relativePath,
    destinationPath: stage.destinationPath,
    digest: stage.digest,
    identity: { ...stage.identity },
    links: inspected.links,
  });
}

async function inspectProjectPath(projectRoot, relativePath) {
  const destination = resolveProjectPath(projectRoot, relativePath);
  const parentState = await inspectParentChainState(projectRoot, path.dirname(destination));
  if (parentState.status === "absent") return parentState;
  let handle;
  try {
    handle = await open(destination, FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW);
    const retained = await handle.stat({ bigint: true });
    const current = await lstat(destination, { bigint: true });
    const siblingLinks = await countProjectSiblingLinks(
      projectRoot,
      relativePath,
      destination,
      retained,
    );
    if (
      !retained.isFile()
      || current.isSymbolicLink()
      || !current.isFile()
      || retained.nlink !== 1n + siblingLinks
      || current.nlink !== 1n + siblingLinks
      || !sameIdentity(retained, current)
      || retained.size < 0n
      || retained.size > BigInt(MAX_INSTALLED_FILE_BYTES)
    ) {
      fail("AGENTMO_BUILDER_INSTALL_PATH_UNSAFE");
    }
    const bytes = await readHandle(handle, retained.size);
    const after = await lstat(destination, { bigint: true });
    const parentAfter = await inspectParentChainState(projectRoot, path.dirname(destination));
    if (
      parentAfter.status !== "present"
      || !sameParentState(parentState.parents, parentAfter.parents)
      || !sameIdentity(retained, after)
      || after.isSymbolicLink()
      || !after.isFile()
      || after.nlink !== 1n + siblingLinks
    ) {
      fail("AGENTMO_BUILDER_INSTALL_PATH_UNSAFE");
    }
    return {
      status: "file",
      bytes,
      digest: digestRawBytes(bytes),
      identity: fileIdentity(retained, 1n),
      parents: parentState.parents,
    };
  } catch (error) {
    if (error instanceof BuilderInstallError) throw error;
    if (error?.code === "ENOENT") {
      return {
        status: "absent",
        parents: parentState.parents,
        missingFrom: relativePath,
      };
    }
    fail("AGENTMO_BUILDER_INSTALL_PATH_UNSAFE");
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function countProjectSiblingLinks(projectRoot, relativePath, filePath, admittedStats) {
  const directory = path.dirname(filePath);
  const basename = path.basename(filePath);
  const registered = await registeredInstallStageLinks(projectRoot, relativePath, admittedStats);
  let count = 0n;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name === basename) continue;
    const sibling = path.join(directory, entry.name);
    const stats = await lstat(sibling, { bigint: true });
    if (!sameIdentity(stats, admittedStats)) continue;
    if (!registered.has(sibling)) fail("AGENTMO_BUILDER_INSTALL_PATH_UNSAFE");
    count += 1n;
  }
  if (count !== BigInt(registered.size)) fail("AGENTMO_BUILDER_INSTALL_PATH_UNSAFE");
  return count;
}

async function registeredInstallStageLinks(projectRoot, relativePath, admittedStats) {
  let authority;
  try {
    authority = await readInstallAttemptAuthority(projectRoot);
  } catch {
    fail("AGENTMO_BUILDER_INSTALL_PATH_UNSAFE");
  }
  const registered = new Set();
  for (const record of authority.records) {
    const stages = record.payload?.stages;
    if (!Array.isArray(stages)) continue;
    for (const stage of stages) {
      if (stage?.destinationPath !== relativePath
        || !portableRelativePath(stage.relativePath)
        || stage.identity?.device !== admittedStats.dev.toString(10)
        || stage.identity?.inode !== admittedStats.ino.toString(10)
        || stage.identity?.size !== admittedStats.size.toString(10)) continue;
      registered.add(resolveProjectPath(projectRoot, stage.relativePath));
    }
  }
  for (const registeredPath of registered) {
    let stats;
    try {
      stats = await lstat(registeredPath, { bigint: true });
    } catch {
      fail("AGENTMO_BUILDER_INSTALL_PATH_UNSAFE");
    }
    if (!stats.isFile() || stats.isSymbolicLink() || !sameIdentity(stats, admittedStats)) {
      fail("AGENTMO_BUILDER_INSTALL_PATH_UNSAFE");
    }
  }
  return registered;
}

async function inspectParentChainState(projectRoot, parentPath) {
  const relative = path.relative(projectRoot, parentPath);
  const parents = [];
  if (relative === "") return { status: "present", parents };
  let current = projectRoot;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      const stats = await lstat(current, { bigint: true });
      if (
        stats.isSymbolicLink()
        || !stats.isDirectory()
        || await realpath(current) !== current
      ) {
        fail("AGENTMO_BUILDER_INSTALL_PATH_UNSAFE");
      }
      parents.push({
        relativePath: path.relative(projectRoot, current).split(path.sep).join("/"),
        device: stats.dev.toString(10),
        inode: stats.ino.toString(10),
      });
    } catch (error) {
      if (error?.code === "ENOENT") {
        return {
          status: "absent",
          parents,
          missingFrom: path.relative(projectRoot, current).split(path.sep).join("/"),
        };
      }
      if (error instanceof BuilderInstallError) throw error;
      fail("AGENTMO_BUILDER_INSTALL_PATH_UNSAFE");
    }
  }
  return { status: "present", parents };
}

function createMutationLedger(prepared) {
  const parents = new Map();
  for (const desired of prepared.allFiles) {
    for (const parent of desired.precondition.parents) {
      const existing = parents.get(parent.relativePath);
      if (existing !== undefined && !sameDirectoryRecord(existing, parent)) {
        fail("AGENTMO_BUILDER_INSTALL_PLAN_CHANGED");
      }
      parents.set(parent.relativePath, { ...parent, origin: "approved" });
    }
  }
  return {
    rootIdentity: prepared.projectRootIdentity,
    parents,
  };
}

async function assertApprovedInitialState(prepared, ledger) {
  await assertProjectRootLedger(prepared.projectRoot, ledger);
  for (const desired of prepared.allFiles) {
    let observed;
    try {
      observed = await inspectProjectPath(prepared.projectRoot, desired.relativePath);
    } catch {
      fail("AGENTMO_BUILDER_INSTALL_PLAN_CHANGED");
    }
    if (desired.precondition.state === "absent") {
      if (
        observed.status !== "absent"
        || observed.missingFrom !== desired.precondition.missingFrom
        || !sameParentState(observed.parents, desired.precondition.parents)
      ) {
        fail("AGENTMO_BUILDER_INSTALL_PLAN_CHANGED");
      }
      continue;
    }
    const expected = installedStateFromPrecondition(desired);
    const current = observed.status === "file"
      ? {
          relativePath: desired.relativePath,
          digest: observed.digest,
          identity: observed.identity,
          parents: observed.parents,
        }
      : null;
    if (current === null || expected === null || !sameInstalledState(current, expected)) {
      fail("AGENTMO_BUILDER_INSTALL_PLAN_CHANGED");
    }
  }
}

function installedStateFromPrecondition(desired) {
  if (desired.precondition.state === "absent") return null;
  return {
    relativePath: desired.relativePath,
    digest: desired.precondition.digest,
    identity: desired.precondition.identity,
    parents: desired.precondition.parents,
  };
}

async function assertProjectRootLedger(projectRoot, ledger) {
  try {
    const canonical = await realpath(projectRoot);
    const stats = await lstat(projectRoot, { bigint: true });
    if (
      canonical !== projectRoot
      || stats.isSymbolicLink()
      || !stats.isDirectory()
      || stats.dev.toString(10) !== ledger.rootIdentity.device
      || stats.ino.toString(10) !== ledger.rootIdentity.inode
    ) {
      fail("AGENTMO_BUILDER_INSTALL_PLAN_CHANGED");
    }
  } catch (error) {
    if (error instanceof BuilderInstallError) throw error;
    fail("AGENTMO_BUILDER_INSTALL_PLAN_CHANGED");
  }
}

async function assertAuthorizedParentChain(projectRoot, relativePath, ledger) {
  await assertProjectRootLedger(projectRoot, ledger);
  const destination = resolveProjectPath(projectRoot, relativePath);
  const relativeParent = path.relative(projectRoot, path.dirname(destination));
  let current = projectRoot;
  for (const segment of relativeParent.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const relative = path.relative(projectRoot, current).split(path.sep).join("/");
    const approved = ledger.parents.get(relative);
    if (approved === undefined) fail("AGENTMO_BUILDER_INSTALL_PLAN_CHANGED");
    try {
      const stats = await lstat(current, { bigint: true });
      if (
        stats.isSymbolicLink()
        || !stats.isDirectory()
        || await realpath(current) !== current
        || stats.dev.toString(10) !== approved.device
        || stats.ino.toString(10) !== approved.inode
      ) {
        fail("AGENTMO_BUILDER_INSTALL_PLAN_CHANGED");
      }
    } catch (error) {
      if (error instanceof BuilderInstallError) throw error;
      fail("AGENTMO_BUILDER_INSTALL_PLAN_CHANGED");
    }
  }
  return destination;
}

async function ensureApprovedParentChain(projectRoot, desired, ledger) {
  await assertProjectRootLedger(projectRoot, ledger);
  const destination = resolveProjectPath(projectRoot, desired.relativePath);
  const relativeParent = path.relative(projectRoot, path.dirname(destination));
  let current = projectRoot;
  for (const segment of relativeParent.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const relative = path.relative(projectRoot, current).split(path.sep).join("/");
    const authorized = ledger.parents.get(relative);
    if (authorized !== undefined) {
      await assertAuthorizedDirectory(current, authorized);
      continue;
    }
    if (!creationAllowedByPrecondition(desired.precondition, relative)) {
      fail("AGENTMO_BUILDER_INSTALL_PLAN_CHANGED");
    }
    let parentAuthority;
    try {
      parentAuthority = await retainEffectDirectory(path.dirname(current));
      const created = await runBuilderPosixEffect({
        action: "mkdir",
        name: path.basename(current),
        payload: "",
      }, {
        directoryAuthority: parentAuthority,
      });
      if (created.created !== true) fail("AGENTMO_BUILDER_INSTALL_PLAN_CHANGED");
      ledger.parents.set(relative, {
        relativePath: relative,
        device: created.identity.device,
        inode: created.identity.inode,
        origin: "created",
      });
    } catch (error) {
      if (error instanceof BuilderInstallError) throw error;
      fail("AGENTMO_BUILDER_INSTALL_WRITE_FAILED");
    } finally {
      await parentAuthority?.handle.close().catch(() => {});
    }
    const stats = await lstat(current, { bigint: true });
    const recorded = ledger.parents.get(relative);
    if (stats.isSymbolicLink() || !stats.isDirectory() || await realpath(current) !== current
      || stats.dev.toString(10) !== recorded.device
      || stats.ino.toString(10) !== recorded.inode) {
      fail("AGENTMO_BUILDER_INSTALL_WRITE_FAILED");
    }
  }
  return destination;
}

async function assertAuthorizedDirectory(directory, authorized) {
  try {
    const stats = await lstat(directory, { bigint: true });
    if (
      stats.isSymbolicLink()
      || !stats.isDirectory()
      || await realpath(directory) !== directory
      || stats.dev.toString(10) !== authorized.device
      || stats.ino.toString(10) !== authorized.inode
    ) {
      fail("AGENTMO_BUILDER_INSTALL_PLAN_CHANGED");
    }
  } catch (error) {
    if (error instanceof BuilderInstallError) throw error;
    fail("AGENTMO_BUILDER_INSTALL_PLAN_CHANGED");
  }
}

function creationAllowedByPrecondition(precondition, relativeParent) {
  if (precondition.state !== "absent") return false;
  return relativeParent === precondition.missingFrom
    || relativeParent.startsWith(`${precondition.missingFrom}/`);
}

async function admitInheritedStageFile(projectRoot, desired, ledger) {
  const destination = await ensureApprovedParentChain(projectRoot, desired, ledger);
  const stagePath = resolveProjectPath(projectRoot, desired.recoveryStage.relativePath);
  if (path.dirname(stagePath) !== path.dirname(destination)
    || desired.recoveryStage.destinationPath !== desired.relativePath
    || desired.recoveryStage.digest !== desired.destinationDigest) {
    fail("AGENTMO_BUILDER_INSTALL_RECOVERY_STATE_CHANGED");
  }
  let handle;
  try {
    handle = await open(stagePath, FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW);
    const staged = {
      desired,
      destination,
      stagePath,
      stageIdentity: desired.recoveryStage.identity,
      handle,
      inherited: true,
      published: false,
      publishedState: null,
    };
    await assertStagedFileExact(staged);
    return staged;
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error instanceof BuilderInstallError) throw error;
    fail("AGENTMO_BUILDER_INSTALL_RECOVERY_STATE_CHANGED");
  }
}

async function stageDesiredFile(projectRoot, desired, ledger) {
  const destination = await ensureApprovedParentChain(projectRoot, desired, ledger);
  const stagePath = path.join(
    path.dirname(destination),
    `.agentmo-stage-${randomBytes(16).toString("hex")}`,
  );
  let handle;
  let parentAuthority;
  let stageIdentity = null;
  try {
    parentAuthority = await retainEffectDirectory(path.dirname(destination));
    const effect = await runBuilderPosixEffect({
      action: "write-file",
      name: path.basename(stagePath),
      payload: desired.bytes.toString("base64"),
    }, {
      directoryAuthority: parentAuthority,
    });
    if (effect.created !== true) fail("AGENTMO_BUILDER_INSTALL_WRITE_FAILED");
    stageIdentity = effect.identity;
    handle = await open(
      stagePath,
      FS_CONSTANTS.O_RDWR | FS_CONSTANTS.O_NOFOLLOW,
    );
    const written = await handle.stat({ bigint: true });
    if (!written.isFile() || written.nlink !== 1n
      || written.size !== BigInt(desired.bytes.byteLength)
      || JSON.stringify(fileIdentity(written)) !== JSON.stringify(stageIdentity)) {
      fail("AGENTMO_BUILDER_INSTALL_WRITE_FAILED");
    }
    await assertAuthorizedParentChain(projectRoot, desired.relativePath, ledger);
    const staged = {
      desired,
      destination,
      stagePath,
      stageIdentity,
      handle,
      published: false,
      publishedState: null,
    };
    await assertStagedFileExact(staged);
    return staged;
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error instanceof BuilderInstallError) throw error;
    fail("AGENTMO_BUILDER_INSTALL_WRITE_FAILED");
  } finally {
    await parentAuthority?.handle.close().catch(() => {});
  }
}

async function publishStagedFile(projectRoot, staged, ledger) {
  const destination = resolveProjectPath(projectRoot, staged.desired.relativePath);
  if (destination !== staged.destination) fail("AGENTMO_BUILDER_INSTALL_PATH_UNSAFE");
  await assertAuthorizedParentChain(projectRoot, staged.desired.relativePath, ledger);
  await assertStagedFileExact(staged);
  await assertAuthorizedParentChain(projectRoot, staged.desired.relativePath, ledger);
  await assertStagedFileExact(staged);
  let parentAuthority;
  try {
    parentAuthority = await retainEffectDirectory(path.dirname(destination));
    const effect = await runBuilderPosixEffect({
      action: "hardlink",
      name: path.basename(destination),
      payload: staged.desired.bytes.toString("base64"),
      sourceName: path.basename(staged.stagePath),
      sourceIdentity: staged.stageIdentity,
    }, {
      directoryAuthority: parentAuthority,
      sourceAuthority: Object.freeze({ handle: staged.handle }),
    });
    if (effect.created !== true) fail("AGENTMO_BUILDER_INSTALL_PLAN_CHANGED");
  } catch (error) {
    if (error instanceof BuilderInstallError) throw error;
    fail("AGENTMO_BUILDER_INSTALL_WRITE_FAILED");
  } finally {
    await parentAuthority?.handle.close().catch(() => {});
  }
  const publishedIdentity = await lstat(destination, { bigint: true });
  if (!sameIdentity(publishedIdentity, await staged.handle.stat({ bigint: true }))) {
    fail("AGENTMO_BUILDER_INSTALL_VERIFICATION_FAILED");
  }
  staged.published = true;
  const published = await assertInstalledDigest(
    projectRoot,
    staged.desired.relativePath,
    staged.desired.destinationDigest,
    ledger,
  );
  if (JSON.stringify(published.identity) !== JSON.stringify(staged.stageIdentity)) {
    fail("AGENTMO_BUILDER_INSTALL_VERIFICATION_FAILED");
  }
  staged.publishedState = published;
  return published;
}

// The finalized receipt is subsequently consumed as independent authority.
// Publish a byte-identical copy instead of a second hard link to the recovery
// stage so no retained staging name can mutate the admitted receipt inode.
async function publishFinalizedReceipt(projectRoot, staged, ledger) {
  const destination = resolveProjectPath(projectRoot, staged.desired.relativePath);
  if (destination !== staged.destination) fail("AGENTMO_BUILDER_INSTALL_PATH_UNSAFE");
  await assertAuthorizedParentChain(projectRoot, staged.desired.relativePath, ledger);
  await assertStagedFileExact(staged);
  let parentAuthority;
  let effect;
  try {
    parentAuthority = await retainEffectDirectory(path.dirname(destination));
    effect = await runBuilderPosixEffect({
      action: "write-file",
      name: path.basename(destination),
      payload: staged.desired.bytes.toString("base64"),
    }, {
      directoryAuthority: parentAuthority,
    });
    if (effect.created !== true) fail("AGENTMO_BUILDER_INSTALL_PLAN_CHANGED");
  } catch (error) {
    if (error instanceof BuilderInstallError) throw error;
    fail("AGENTMO_BUILDER_INSTALL_WRITE_FAILED");
  } finally {
    await parentAuthority?.handle.close().catch(() => {});
  }
  await assertStagedFileExact(staged);
  const publishedIdentity = await lstat(destination, { bigint: true });
  if (!publishedIdentity.isFile() || publishedIdentity.isSymbolicLink()
    || publishedIdentity.nlink !== 1n
    || JSON.stringify(fileIdentity(publishedIdentity)) !== JSON.stringify(effect.identity)) {
    fail("AGENTMO_BUILDER_INSTALL_VERIFICATION_FAILED");
  }
  staged.published = true;
  const published = await assertInstalledDigest(
    projectRoot,
    staged.desired.relativePath,
    staged.desired.destinationDigest,
    ledger,
  );
  if (JSON.stringify(published.identity) !== JSON.stringify(effect.identity)) {
    fail("AGENTMO_BUILDER_INSTALL_VERIFICATION_FAILED");
  }
  staged.publishedState = published;
  return published;
}

async function retainEffectDirectory(directory) {
  let handle;
  try {
    handle = await open(
      directory,
      FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_DIRECTORY | FS_CONSTANTS.O_NOFOLLOW,
    );
    const retained = await handle.stat({ bigint: true });
    const current = await lstat(directory, { bigint: true });
    if (!retained.isDirectory() || retained.isSymbolicLink()
      || current.isSymbolicLink() || !current.isDirectory()
      || retained.dev !== current.dev || retained.ino !== current.ino
      || retained.uid !== current.uid || retained.gid !== current.gid
      || retained.mode !== current.mode
      || (retained.mode & 0o022n) !== 0n
      || retained.uid !== BigInt(process.getuid())) {
      fail("AGENTMO_BUILDER_INSTALL_PLAN_CHANGED");
    }
    return Object.freeze({
      path: directory,
      handle,
      identity: Object.freeze({
        device: retained.dev.toString(10),
        inode: retained.ino.toString(10),
        uid: retained.uid.toString(10),
        gid: retained.gid.toString(10),
        mode: (retained.mode & 0o777n).toString(8),
      }),
    });
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error instanceof BuilderInstallError) throw error;
    fail("AGENTMO_BUILDER_INSTALL_PLAN_CHANGED");
  }
}

async function assertStagedFileExact(staged) {
  try {
    const [retained, before] = await Promise.all([
      staged.handle.stat({ bigint: true }),
      lstat(staged.stagePath, { bigint: true }),
    ]);
    if (!retained.isFile() || !before.isFile() || before.isSymbolicLink()
      || retained.nlink !== 1n || before.nlink !== 1n
      || !sameIdentity(retained, before)
      || JSON.stringify(fileIdentity(retained)) !== JSON.stringify(staged.stageIdentity)) {
      fail("AGENTMO_BUILDER_INSTALL_PLAN_CHANGED");
    }
    const bytes = await readHandle(staged.handle, retained.size);
    const [retainedAfter, after] = await Promise.all([
      staged.handle.stat({ bigint: true }),
      lstat(staged.stagePath, { bigint: true }),
    ]);
    if (!sameIdentity(retained, retainedAfter) || !sameIdentity(retainedAfter, after)
      || JSON.stringify(fileIdentity(retainedAfter)) !== JSON.stringify(staged.stageIdentity)
      || digestRawBytes(bytes) !== staged.desired.destinationDigest) {
      fail("AGENTMO_BUILDER_INSTALL_PLAN_CHANGED");
    }
    return retainedAfter;
  } catch (error) {
    if (error instanceof BuilderInstallError) throw error;
    fail("AGENTMO_BUILDER_INSTALL_PLAN_CHANGED");
  }
}

async function assertLinkedStageIdentity(staged, destination) {
  try {
    const [retained, source, published] = await Promise.all([
      staged.handle.stat({ bigint: true }),
      lstat(staged.stagePath, { bigint: true }),
      lstat(destination, { bigint: true }),
    ]);
    const expected = staged.stageIdentity;
    if (!retained.isFile() || !source.isFile() || source.isSymbolicLink() || !published.isFile()
      || published.isSymbolicLink() || retained.nlink !== 2n
      || source.nlink !== 2n || published.nlink !== 2n
      || source.dev.toString(10) !== expected.device
      || source.ino.toString(10) !== expected.inode
      || source.size.toString(10) !== expected.size
      || !sameIdentity(retained, source)
      || source.dev !== published.dev || source.ino !== published.ino
      || source.size !== published.size) {
      fail("AGENTMO_BUILDER_INSTALL_VERIFICATION_FAILED");
    }
  } catch (error) {
    if (error instanceof BuilderInstallError) throw error;
    fail("AGENTMO_BUILDER_INSTALL_VERIFICATION_FAILED");
  }
}

async function closeStagedFileHandle(staged) {
  if (staged?.handle === null || staged?.handle === undefined) return;
  const handle = staged.handle;
  staged.handle = null;
  await handle.close().catch(() => {});
}

async function assertInstalledDigest(
  projectRoot,
  relativePath,
  expectedDigest,
  ledger,
  expectedState = null,
) {
  await assertAuthorizedParentChain(projectRoot, relativePath, ledger);
  let observed;
  try {
    observed = await inspectProjectPath(projectRoot, relativePath);
  } catch {
    await assertAuthorizedParentChain(projectRoot, relativePath, ledger);
    fail("AGENTMO_BUILDER_INSTALL_VERIFICATION_FAILED");
  }
  if (!observedParentsMatchLedger(observed.parents ?? [], relativePath, ledger)) {
    fail("AGENTMO_BUILDER_INSTALL_PLAN_CHANGED");
  }
  await assertAuthorizedParentChain(projectRoot, relativePath, ledger);
  if (observed.status !== "file" || observed.digest !== expectedDigest) {
    fail("AGENTMO_BUILDER_INSTALL_VERIFICATION_FAILED");
  }
  const state = {
    relativePath,
    digest: observed.digest,
    identity: observed.identity,
    parents: observed.parents,
  };
  if (expectedState !== null && !sameInstalledState(state, expectedState)) {
    fail("AGENTMO_BUILDER_INSTALL_VERIFICATION_FAILED");
  }
  return state;
}

function observedParentsMatchLedger(observedParents, relativePath, ledger) {
  const expected = [];
  const parent = path.posix.dirname(relativePath);
  if (parent !== ".") {
    const segments = parent.split("/");
    for (let index = 1; index <= segments.length; index += 1) {
      const relative = segments.slice(0, index).join("/");
      const authorized = ledger.parents.get(relative);
      if (authorized === undefined) return false;
      expected.push({
        relativePath: relative,
        device: authorized.device,
        inode: authorized.inode,
      });
    }
  }
  return sameParentState(observedParents, expected);
}

function admitHostScope(value) {
  if (value === undefined || value === null) return null;
  if (value !== "user") fail("AGENTMO_BUILDER_INSTALL_HOST_SCOPE_REJECTED");
  return value;
}

function assertInstallOptionKeys(options, apply) {
  const allowed = [
    "expectedPriorReceiptDigest",
    "expectedReceiptDigest",
    "hostScope",
    "packageOptions",
    "probe",
    "projectRoot",
    ...(apply ? ["expectedPlanDigest"] : []),
  ];
  if (!exactObjectKeys(options, allowed)) {
    fail("AGENTMO_BUILDER_INSTALL_ARGUMENTS_REJECTED");
  }
}

function exactObjectKeys(value, allowedKeys) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).every((key) => allowedKeys.includes(key));
}

async function readHandle(handle, size) {
  const bytes = Buffer.alloc(Number(size));
  let offset = 0;
  while (offset < bytes.length) {
    const result = await handle.read(bytes, offset, bytes.length - offset, offset);
    if (!Number.isInteger(result?.bytesRead) || result.bytesRead <= 0) {
      fail("AGENTMO_BUILDER_INSTALL_PATH_UNSAFE");
    }
    offset += result.bytesRead;
  }
  return bytes;
}

function fileIdentity(stats, effectiveLinks = stats.nlink) {
  return {
    device: stats.dev.toString(10),
    inode: stats.ino.toString(10),
    links: effectiveLinks.toString(10),
    size: stats.size.toString(10),
  };
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameParentState(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameDirectoryRecord(left, right) {
  return left.relativePath === right.relativePath
    && left.device === right.device
    && left.inode === right.inode;
}

function sameInstalledState(left, right) {
  return left.relativePath === right.relativePath
    && left.digest === right.digest
    && JSON.stringify(left.identity) === JSON.stringify(right.identity)
    && sameParentState(left.parents, right.parents);
}

function resolveProjectPath(projectRoot, relativePath) {
  if (!portableRelativePath(relativePath)) fail("AGENTMO_BUILDER_INSTALL_PATH_UNSAFE");
  const destination = path.resolve(projectRoot, ...relativePath.split("/"));
  if (!isInside(projectRoot, destination)) fail("AGENTMO_BUILDER_INSTALL_PATH_UNSAFE");
  return destination;
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

function isInside(root, candidate) {
  return candidate !== root && candidate.startsWith(`${root}${path.sep}`);
}

function digestJson(value, subject) {
  return digestRawBytes(Buffer.from(serializePersistableJson(value, { subject }), "utf8"));
}

function jsonBytes(value, subject) {
  const bytes = Buffer.from(serializePersistableJson(value, { subject }), "utf8");
  if (bytes.byteLength > MAX_INSTALLED_FILE_BYTES) fail("AGENTMO_BUILDER_INSTALL_RESOURCE_BUDGET");
  return bytes;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function fail(code) {
  throw new BuilderInstallError(code);
}
