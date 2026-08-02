import { createHash } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import path from "node:path";
import {
  isAdmittedOpenClawInstallFinalizationEvidence,
  isAdmittedOpenClawInstallPostStateEvidence,
  isAdmittedOpenClawOfficialActionResultEvidence,
} from "./openclaw-install-evidence.js";
import {
  assertPersistable,
  PersistabilityError,
  serializePersistableJson,
} from "./persistability.js";

export const OPENCLAW_INSTALL_RECEIPT_SCHEMA_VERSION =
  "agentmo.openclaw-install-receipt.v1";
export const OPENCLAW_INSTALL_PRIVATE_JOURNAL_SCHEMA_VERSION =
  "agentmo.openclaw-install-private-journal.v1";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const ATTEMPT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const REASON_PATTERN = /^[a-z][a-z0-9-]{0,127}$/u;
const LIFECYCLES = new Set(["install", "upgrade", "rollback", "uninstall"]);
const OPERATION_KINDS = new Set(["write", "patch", "remove"]);
const RESULT_DISPOSITIONS = new Set([
  "succeeded",
  "failed",
  "unsupported",
  "preserved",
  "not-attempted",
]);
const ROLLBACK_DISPOSITIONS = new Set([
  "not-required",
  "rolled-back",
  "preserved",
  "recovery-required",
]);
const MARKER_STATUSES = new Set(["created", "exact-resume"]);
const RECEIPT_KEYS = [
  "schemaVersion",
  "status",
  "lifecycle",
  "authorityLedger",
  "approvals",
  "nonceConsumption",
  "predecessor",
  "lineage",
  "managedResults",
  "externalResults",
  "postEffectEvidence",
  "preservedAssets",
  "recovery",
  "incompleteReasons",
  "certificationBoundary",
];
const PROVENANCE_KEYS = ["identity", "subject", "digest"];
const AUTHORITY_LEDGER_KEYS = [
  "installPlan",
  "archive",
  "target",
  "targetDescriptor",
  "probe",
  "journal",
  "attempt",
];
const DECISION_BINDING_KEYS = [
  "family",
  "artifact",
  "decisionDigest",
  "nonceDigest",
  "actionId",
  "actionDigest",
  "conflictSetDigest",
];
const MARKER_KEYS = [
  "family",
  "path",
  "digest",
  "nonceDigest",
  "decisionDigest",
  "actionDigest",
  "conflictSetDigest",
  "device",
  "inode",
  "status",
  "consumed",
];
const MANAGED_RESULT_KEYS = [
  "path",
  "operation",
  "operationDigest",
  "ownerMarker",
  "beforeDigest",
  "beforeFileIdentity",
  "beforeParentIdentity",
  "afterDigest",
  "afterFileIdentity",
  "afterParentIdentity",
  "disposition",
  "postStateMatches",
  "rollbackDisposition",
  "reasonCode",
];
const EXTERNAL_RESULT_KEYS = [
  "actionId",
  "actionDigest",
  "owner",
  "version",
  "executableDigest",
  "permission",
  "approval",
  "disposition",
  "resultDigest",
  "failureCode",
  "unsupportedReason",
  "rawOutputPersisted",
];
const POST_EFFECT_EVIDENCE_KEYS = [
  "finalization",
  "postState",
  "officialActionResults",
];

export function validateOpenClawInstallReceipt(value, context = undefined) {
  const errors = [];
  if (!plainObject(value) || !sameKeys(value, RECEIPT_KEYS)) {
    return result(["shape"]);
  }
  if (value.schemaVersion !== OPENCLAW_INSTALL_RECEIPT_SCHEMA_VERSION
    || !["complete", "incomplete"].includes(value.status)
    || !LIFECYCLES.has(value.lifecycle)) {
    errors.push("identity");
  }
  if (!validAuthorityLedger(value.authorityLedger)) errors.push("authorityLedger");
  if (!validApprovals(value.approvals)) errors.push("approvals");
  if (!validNonceConsumption(value.nonceConsumption, value.approvals)) {
    errors.push("nonceConsumption");
  }
  if (!validPredecessor(
    value.predecessor,
    value.lineage,
    value.lifecycle,
    value.authorityLedger?.archive,
  )) {
    errors.push("predecessor");
  }
  if (!validManagedResults(value.managedResults)) errors.push("managedResults");
  if (!validExternalResults(value.externalResults)) errors.push("externalResults");
  if (!validPostEffectEvidence(value.postEffectEvidence)) {
    errors.push("postEffectEvidence");
  }
  if (!validPreservedAssets(value.preservedAssets)) errors.push("preservedAssets");
  if (!validRecovery(value.recovery, value.preservedAssets)) errors.push("recovery");
  if (!sortedUniqueReasons(value.incompleteReasons)) errors.push("incompleteReasons");
  if (!exactBoundary(value.certificationBoundary)) {
    errors.push("certificationBoundary");
  }
  if (errors.length === 0 && context !== undefined
    && !validCompanionClosure(value, context)) {
    errors.push("companionClosure");
  }
  if (errors.length === 0 && !completionTheorem(value)) {
    errors.push("completionTheorem");
  }
  if (errors.length === 0) {
    try {
      assertPersistable(value, { subject: "openclaw-install-receipt" });
    } catch {
      errors.push("persistability");
    }
  }
  return result(errors);
}

export function validateOpenClawInstallJournal(value) {
  const errors = [];
  if (!plainObject(value)
    || !sameKeys(value, [
      "schemaVersion",
      "attemptId",
      "lifecycle",
      "installPlanDigest",
      "archiveBinding",
      "authorityReservation",
      "predecessor",
      "observations",
      "valuesPersisted",
      "rawOutputPersisted",
    ])) {
    return result(["shape"]);
  }
  if (value.schemaVersion !== OPENCLAW_INSTALL_PRIVATE_JOURNAL_SCHEMA_VERSION
    || !ATTEMPT_PATTERN.test(value.attemptId ?? "")
    || !LIFECYCLES.has(value.lifecycle)
    || !DIGEST_PATTERN.test(value.installPlanDigest ?? "")
    || !validArchiveBinding(value.archiveBinding)
    || value.valuesPersisted !== false
    || value.rawOutputPersisted !== false) {
    errors.push("identity");
  }
  if (!plainObject(value.authorityReservation)
    || !sameKeys(value.authorityReservation, ["markerSetDigest", "markers"])
    || !DIGEST_PATTERN.test(value.authorityReservation.markerSetDigest ?? "")
    || !validJournalMarkerList(value.authorityReservation.markers)
    || value.authorityReservation.markerSetDigest
      !== digestJson(value.authorityReservation.markers.map(markerDigestBasis))) {
    errors.push("authorityReservation");
  }
  if (!plainObject(value.predecessor)
    || !Array.isArray(value.observations)
    || value.observations.some((observation) => (
      !plainObject(observation)
      || !sameKeys(observation, [
        "path",
        "digest",
        "fileIdentity",
        "parentIdentity",
        "safeFile",
        "disposition",
      ])
      || !portableRelativePath(observation.path)
      || !nullableDigest(observation.digest)
      || !nullableIdentity(observation.fileIdentity)
      || !validIdentity(observation.parentIdentity)
      || typeof observation.safeFile !== "boolean"
      || !nonEmptyString(observation.disposition)
    ))) {
    errors.push("executionBasis");
  }
  if (errors.length === 0) {
    try {
      assertPersistable(value, { subject: "openclaw-install-private-journal" });
    } catch {
      errors.push("persistability");
    }
  }
  return result(errors);
}

export async function writeOpenClawInstallReceipt(
  filePath,
  receipt,
  options = {},
) {
  if (!validateOpenClawInstallReceipt(receipt, options.validationContext).ok) {
    throw new PersistabilityError("AGENTMO_PERSISTABILITY_INVALID_CANDIDATE");
  }
  if (typeof filePath !== "string"
    || filePath.length === 0
    || filePath.includes("\0")) {
    throw new PersistabilityError("AGENTMO_PERSISTABILITY_INVALID_OUTPUT_PATH");
  }
  const expectedBytes = Buffer.from(
    serializePersistableJson(receipt, { subject: "openclaw-install-receipt" }),
    "utf8",
  );
  const target = path.resolve(filePath);
  const openOutput = options?.openOutput ?? open;
  if (typeof openOutput !== "function") {
    throw new PersistabilityError(
      "AGENTMO_PERSISTABILITY_INVALID_OUTPUT_ADAPTER",
    );
  }
  let handle;
  try {
    handle = await openOutput(target, "wx", 0o600);
    await handle.stat({ bigint: true });
    await handle.writeFile(expectedBytes);
    await handle.sync();
    await handle.close();
    handle = null;
    const finalBytes = await readFile(target);
    if (!finalBytes.equals(expectedBytes)) {
      throw new PersistabilityError("AGENTMO_PERSISTABILITY_OUTPUT_MISMATCH");
    }
    return Object.freeze({
      filePath,
      digest: digestBytes(finalBytes),
    });
  } catch (error) {
    await handle?.close().catch(() => {});
    handle = null;
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

export function formatOpenClawInstallReceipt(receipt, digest) {
  if (!validateOpenClawInstallReceipt(receipt).ok
    || !DIGEST_PATTERN.test(digest ?? "")) {
    throw new PersistabilityError("AGENTMO_PERSISTABILITY_INVALID_CANDIDATE");
  }
  const lines = [
    "AgentMo OpenClaw install receipt",
    `Digest: ${digest}`,
    `Status: ${receipt.status}`,
    `Lifecycle: ${receipt.lifecycle}`,
    `Target: ${receipt.authorityLedger.target.targetId}/${receipt.authorityLedger.target.scope}`,
    `Plan: ${receipt.authorityLedger.installPlan.artifact.digest}`,
    `Archive: ${receipt.authorityLedger.archive.archiveSha256}`,
    `Probe: ${receipt.authorityLedger.probe.artifact.digest}`,
    `Journal: ${receipt.authorityLedger.journal.digest}`,
    `Approvals: ordinary=1 sensitive=${receipt.approvals.sensitive.length} conflict=1`,
    `Nonces: ${receipt.nonceConsumption.markers.length}`,
    `Managed results: ${receipt.managedResults.length}`,
    `External results: ${receipt.externalResults.length}`,
    `Post-state evidence: ${receipt.postEffectEvidence.postState.digest}`
      + ` ref=${receipt.postEffectEvidence.postState.relativeRef}`,
    `Preserved: ${receipt.preservedAssets.length}`,
    `Recovery: ${receipt.recovery.disposition}`,
  ];
  for (const item of receipt.managedResults) {
    lines.push(
      `Managed: ${item.path} ${item.operation} ${item.disposition}`
      + ` before=${item.beforeDigest ?? "absent"} after=${item.afterDigest ?? "absent"}`,
    );
  }
  for (const item of receipt.externalResults) {
    lines.push(`External: ${item.actionId} ${item.disposition}`);
  }
  if (receipt.postEffectEvidence.officialActionResults.length === 0) {
    lines.push("Official action evidence: none");
  } else {
    receipt.postEffectEvidence.officialActionResults.forEach(
      (item, index) => lines.push(
        `Official action evidence ${index + 1}: ${item.actionId}`
        + ` ${item.digest} ref=${item.relativeRef}`,
      ),
    );
  }
  lines.push(
    `Finalization evidence: ${receipt.postEffectEvidence.finalization.digest}`
    + ` ref=${receipt.postEffectEvidence.finalization.relativeRef}`,
  );
  return `${lines.join("\n")}\n`;
}

export function digestOpenClawReceiptValue(value, subject) {
  return digestJson(value, subject);
}

function validAuthorityLedger(value) {
  return plainObject(value)
    && sameKeys(value, AUTHORITY_LEDGER_KEYS)
    && validPlanBinding(value.installPlan)
    && validArchiveBinding(value.archive)
    && validTarget(value.target)
    && validProvenance(value.targetDescriptor, {
      identity: "agentmo.openclaw-target-descriptor.v1",
      subject: "openclaw-target-descriptor",
    })
    && plainObject(value.probe)
    && sameKeys(value.probe, ["artifact", "fingerprintDigest", "executableDigest"])
    && validProvenance(value.probe.artifact, {
      identity: "agentmo.openclaw-probe.v1",
      subject: "openclaw-probe",
    })
    && DIGEST_PATTERN.test(value.probe.fingerprintDigest ?? "")
    && DIGEST_PATTERN.test(value.probe.executableDigest ?? "")
    && validProvenance(value.journal, {
      identity: OPENCLAW_INSTALL_PRIVATE_JOURNAL_SCHEMA_VERSION,
      subject: "openclaw-install-private-journal",
    })
    && plainObject(value.attempt)
    && sameKeys(value.attempt, ["attemptId", "attemptDigest"])
    && ATTEMPT_PATTERN.test(value.attempt.attemptId ?? "")
    && value.attempt.attemptDigest
      === digestBytes(Buffer.from(value.attempt.attemptId ?? "", "utf8"));
}

function validPlanBinding(value) {
  return plainObject(value)
    && sameKeys(value, ["artifact", "installPlanDigest"])
    && validProvenance(value.artifact, {
      identity: "agentmo.openclaw-install-plan.v1",
      subject: "openclaw-install-plan",
    })
    && DIGEST_PATTERN.test(value.installPlanDigest ?? "");
}

function validApprovals(value) {
  return plainObject(value)
    && sameKeys(value, ["ordinary", "sensitive", "conflict"])
    && validDecisionBinding(value.ordinary, "ordinary")
    && Array.isArray(value.sensitive)
    && value.sensitive.every((item) => validDecisionBinding(item, "sensitive"))
    && sortedUniqueBy(value.sensitive, (item) => item.actionId)
    && validDecisionBinding(value.conflict, "conflict");
}

function validDecisionBinding(value, family) {
  const subject = family === "ordinary"
    ? "openclaw-install-approval"
    : family === "sensitive"
      ? "openclaw-sensitive-action-decision"
      : "openclaw-conflict-approval";
  const identity = family === "ordinary"
    ? "agentmo.openclaw-install-approval.v1"
    : family === "sensitive"
      ? "agentmo.openclaw-sensitive-action-decision.v1"
      : "agentmo.openclaw-conflict-approval.v1";
  return plainObject(value)
    && sameKeys(value, DECISION_BINDING_KEYS)
    && value.family === family
    && validProvenance(value.artifact, { identity, subject })
    && DIGEST_PATTERN.test(value.decisionDigest ?? "")
    && DIGEST_PATTERN.test(value.nonceDigest ?? "")
    && (family === "sensitive"
      ? nonEmptyString(value.actionId)
        && DIGEST_PATTERN.test(value.actionDigest ?? "")
        && value.conflictSetDigest === null
      : value.actionId === null
        && value.actionDigest === null
        && (family === "conflict"
          ? DIGEST_PATTERN.test(value.conflictSetDigest ?? "")
          : value.conflictSetDigest === null));
}

function validNonceConsumption(value, approvals) {
  if (!plainObject(value)
    || !sameKeys(value, ["markerSetDigest", "markers"])
    || !DIGEST_PATTERN.test(value.markerSetDigest ?? "")
    || !validMarkerList(value.markers, approvals)) {
    return false;
  }
  return value.markerSetDigest === digestJson(
    value.markers.map(markerDigestBasis),
  );
}

function validMarkerList(markers, approvals) {
  if (!Array.isArray(markers) || markers.length < 2) return false;
  if (!markers.every((marker) => (
    plainObject(marker)
    && sameKeys(marker, MARKER_KEYS)
    && ["ordinary", "sensitive", "conflict"].includes(marker.family)
    && portableRelativePath(marker.path)
    && DIGEST_PATTERN.test(marker.digest ?? "")
    && DIGEST_PATTERN.test(marker.nonceDigest ?? "")
    && DIGEST_PATTERN.test(marker.decisionDigest ?? "")
    && nullableDigest(marker.actionDigest)
    && nullableDigest(marker.conflictSetDigest)
    && /^\d+$/u.test(marker.device ?? "")
    && /^\d+$/u.test(marker.inode ?? "")
    && MARKER_STATUSES.has(marker.status)
    && marker.consumed === true
  ))) {
    return false;
  }
  if (new Set(markers.map(({ digest }) => digest)).size !== markers.length
    || new Set(markers.map(({ nonceDigest }) => nonceDigest)).size !== markers.length
    || new Set(markers.map(({ path: markerPath }) => markerPath)).size !== markers.length) {
    return false;
  }
  if (approvals === undefined) return true;
  if (!validApprovals(approvals)) return false;
  const expected = [
    approvals.ordinary,
    ...approvals.sensitive,
    approvals.conflict,
  ];
  return markers.length === expected.length
    && markers.every((marker, index) => (
      marker.family === expected[index].family
      && marker.nonceDigest === expected[index].nonceDigest
      && marker.decisionDigest === expected[index].decisionDigest
      && marker.actionDigest === expected[index].actionDigest
      && marker.conflictSetDigest === expected[index].conflictSetDigest
    ));
}

function validJournalMarkerList(markers) {
  return Array.isArray(markers)
    && markers.length >= 2
    && markers.every((marker) => (
      plainObject(marker)
      && sameKeys(marker, MARKER_KEYS.filter((key) => key !== "consumed"))
      && ["ordinary", "sensitive", "conflict"].includes(marker.family)
      && portableRelativePath(marker.path)
      && DIGEST_PATTERN.test(marker.digest ?? "")
      && DIGEST_PATTERN.test(marker.nonceDigest ?? "")
      && DIGEST_PATTERN.test(marker.decisionDigest ?? "")
      && nullableDigest(marker.actionDigest)
      && nullableDigest(marker.conflictSetDigest)
      && /^\d+$/u.test(marker.device ?? "")
      && /^\d+$/u.test(marker.inode ?? "")
      && MARKER_STATUSES.has(marker.status)
    ))
    && new Set(markers.map(({ digest }) => digest)).size === markers.length
    && new Set(markers.map(({ nonceDigest }) => nonceDigest)).size
      === markers.length;
}

function validManagedResults(value) {
  return Array.isArray(value)
    && value.length > 0
    && value.every((item) => (
      plainObject(item)
      && sameKeys(item, MANAGED_RESULT_KEYS)
      && portableRelativePath(item.path)
      && OPERATION_KINDS.has(item.operation)
      && DIGEST_PATTERN.test(item.operationDigest ?? "")
      && nonEmptyString(item.ownerMarker)
      && nullableDigest(item.beforeDigest)
      && nullableIdentity(item.beforeFileIdentity)
      && validIdentity(item.beforeParentIdentity)
      && nullableDigest(item.afterDigest)
      && nullableIdentity(item.afterFileIdentity)
      && validIdentity(item.afterParentIdentity)
      && RESULT_DISPOSITIONS.has(item.disposition)
      && typeof item.postStateMatches === "boolean"
      && ROLLBACK_DISPOSITIONS.has(item.rollbackDisposition)
      && nullableReason(item.reasonCode)
      && (item.disposition === "succeeded"
        ? item.postStateMatches === true
          && (item.afterDigest === null
            ? item.afterFileIdentity === null
            : item.afterFileIdentity !== null)
          && item.rollbackDisposition === "not-required"
          && item.reasonCode === null
        : item.reasonCode !== null)
    ))
    && sortedUniqueBy(value, (item) => item.path);
}

function validExternalResults(value) {
  return Array.isArray(value)
    && value.every((item) => (
      plainObject(item)
      && sameKeys(item, EXTERNAL_RESULT_KEYS)
      && nonEmptyString(item.actionId)
      && DIGEST_PATTERN.test(item.actionDigest ?? "")
      && item.owner === "openclaw"
      && nonEmptyString(item.version)
      && DIGEST_PATTERN.test(item.executableDigest ?? "")
      && plainObject(item.permission)
      && sameKeys(item.permission, ["kind", "scope", "targetDigest"])
      && nonEmptyString(item.permission.kind)
      && ["project", "user"].includes(item.permission.scope)
      && DIGEST_PATTERN.test(item.permission.targetDigest ?? "")
      && plainObject(item.approval)
      && sameKeys(item.approval, [
        "artifactDigest",
        "decisionDigest",
        "nonceDigest",
      ])
      && DIGEST_PATTERN.test(item.approval.artifactDigest ?? "")
      && DIGEST_PATTERN.test(item.approval.decisionDigest ?? "")
      && DIGEST_PATTERN.test(item.approval.nonceDigest ?? "")
      && RESULT_DISPOSITIONS.has(item.disposition)
      && nullableDigest(item.resultDigest)
      && nullableReason(item.failureCode)
      && nullableReason(item.unsupportedReason)
      && item.rawOutputPersisted === false
      && (item.disposition === "succeeded"
        ? item.resultDigest !== null
          && item.failureCode === null
          && item.unsupportedReason === null
        : item.failureCode !== null || item.unsupportedReason !== null)
    ))
    && sortedUniqueBy(value, (item) => item.actionId);
}

function validPostEffectEvidence(value) {
  return plainObject(value)
    && sameKeys(value, POST_EFFECT_EVIDENCE_KEYS)
    && validCanonicalEvidenceProvenance(
      value.finalization,
      "agentmo.openclaw-install-finalization.v1",
      "openclaw-install-finalization",
      false,
    )
    && validCanonicalEvidenceProvenance(
      value.postState,
      "agentmo.openclaw-install-post-state.v1",
      "openclaw-install-post-state",
      false,
    )
    && Array.isArray(value.officialActionResults)
    && value.officialActionResults.every((item) => (
      validCanonicalEvidenceProvenance(
        item,
        "agentmo.openclaw-official-action-result.v1",
        "openclaw-official-action-result-evidence",
        true,
      )
    ))
    && sortedUniqueBy(value.officialActionResults, ({ actionId }) => actionId);
}

function validPreservedAssets(value) {
  return Array.isArray(value)
    && value.every((asset) => (
      plainObject(asset)
      && sameKeys(asset, ["path", "observedDigest", "reasonCode"])
      && portableRelativePath(asset.path)
      && nullableDigest(asset.observedDigest)
      && REASON_PATTERN.test(asset.reasonCode ?? "")
    ))
    && sortedUniqueBy(value, (item) => item.path);
}

function validRecovery(value, preservedAssets) {
  if (!plainObject(value)
    || !sameKeys(value, [
      "required",
      "disposition",
      "removedAssets",
      "preservedAssets",
      "reasons",
    ])
    || typeof value.required !== "boolean"
    || !["not-required", "recovery-required", "preserved"].includes(
      value.disposition,
    )
    || !Array.isArray(value.removedAssets)
    || !Array.isArray(value.preservedAssets)
    || !sortedUniqueReasons(value.reasons)
    || !sortedUniqueBy(value.removedAssets, (item) => item.path)
    || !sortedUniqueBy(value.preservedAssets, (item) => item.path)) {
    return false;
  }
  const validAsset = (asset) => plainObject(asset)
    && sameKeys(asset, ["path", "digest"])
    && portableRelativePath(asset.path)
    && nullableDigest(asset.digest);
  return value.removedAssets.every(validAsset)
    && value.preservedAssets.every(validAsset)
    && sameJson(
      value.preservedAssets.map(({ path: assetPath, digest }) => ({
        path: assetPath,
        observedDigest: digest,
      })),
      preservedAssets.map(({ path: assetPath, observedDigest }) => ({
        path: assetPath,
        observedDigest,
      })),
    )
    && (value.required
      ? value.disposition !== "not-required" && value.reasons.length > 0
      : value.disposition === "not-required"
        && value.removedAssets.length === 0
        && value.preservedAssets.length === 0
        && value.reasons.length === 0);
}

export function deriveOpenClawInstallReceiptEvidence(context) {
  if (!plainObject(context)
    || !sameKeys(context, [
      "plan",
      "journal",
      "postState",
      "actionResults",
      "finalization",
      "approvals",
      "probe",
    ])
    || !validateOpenClawInstallJournal(context.journal).ok
    || !validApprovals(context.approvals)
    || !Array.isArray(context.actionResults)
    || !isAdmittedOpenClawInstallPostStateEvidence(
      context.postState?.value,
    )
    || context.actionResults.some((item) => (
      !isAdmittedOpenClawOfficialActionResultEvidence(item?.value)
    ))
    || !isAdmittedOpenClawInstallFinalizationEvidence(
      context.finalization?.value,
    )) {
    throw new PersistabilityError(
      "AGENTMO_OPENCLAW_INSTALL_RECEIPT_EVIDENCE_REJECTED",
    );
  }
  const { plan, journal, postState, actionResults, finalization } = context;
  if (postState.value.observations.length !== plan.operations.length
    || actionResults.length !== plan.sensitiveActions.length
    || finalization.value.officialActionResults.length
      !== actionResults.length
    || !sameJson(
      finalization.value.postState,
      postState.provenance,
    )
    || !sameJson(
      finalization.value.officialActionResults,
      actionResults.map(({ provenance }) => provenance),
    )
    || finalization.value.markers.length
      !== journal.authorityReservation.markers.length) {
    throw new PersistabilityError(
      "AGENTMO_OPENCLAW_INSTALL_RECEIPT_EVIDENCE_REJECTED",
    );
  }
  const markers = journal.authorityReservation.markers.map((marker, index) => {
    const finalized = finalization.value.markers[index];
    if (finalized.relativeRef !== marker.path
      || finalized.digest !== marker.digest
      || finalized.family !== marker.family
      || finalized.nonceDigest !== marker.nonceDigest
      || finalized.decisionDigest !== marker.decisionDigest
      || finalized.actionDigest !== marker.actionDigest
      || finalized.conflictSetDigest !== marker.conflictSetDigest
      || finalized.fileIdentity.device !== marker.device
      || finalized.fileIdentity.inode !== marker.inode) {
      throw new PersistabilityError(
        "AGENTMO_OPENCLAW_INSTALL_RECEIPT_EVIDENCE_REJECTED",
      );
    }
    return {
      ...structuredClone(marker),
      consumed: true,
    };
  });
  const managedResults = plan.operations.map((operation, index) => {
    const before = journal.observations[index];
    const observed = postState.value.observations[index];
    if (before.path !== operation.path
      || observed.path !== operation.path
      || observed.operationDigest !== digestJson(
        operation,
        "openclaw-managed-operation",
      )) {
      throw new PersistabilityError(
        "AGENTMO_OPENCLAW_INSTALL_RECEIPT_EVIDENCE_REJECTED",
      );
    }
    const postStateMatches = operation.desiredDigest === null
      ? observed.disposition === "absent"
      : observed.disposition === "observed"
        && observed.digest === operation.desiredDigest;
    const reasonCode = postStateMatches
      ? null
      : observed.reasonCode ?? "managed-post-state-mismatch";
    return {
      path: operation.path,
      operation: operation.operation,
      operationDigest: observed.operationDigest,
      ownerMarker: operation.ownerMarker,
      beforeDigest: before.digest,
      beforeFileIdentity: before.fileIdentity,
      beforeParentIdentity: before.parentIdentity,
      afterDigest: observed.digest,
      afterFileIdentity: receiptObservedIdentity(observed.fileIdentity),
      afterParentIdentity: observed.parentIdentity
        ?? operation.retainedParentIdentity,
      disposition: postStateMatches ? "succeeded" : "preserved",
      postStateMatches,
      rollbackDisposition: postStateMatches ? "not-required" : "preserved",
      reasonCode,
    };
  });
  const externalResults = plan.sensitiveActions.map((action, index) => {
    const evidence = actionResults[index].value;
    const observed = evidence.resultObservation;
    if (evidence.action.actionId !== action.actionId
      || evidence.action.actionDigest !== digestJson(
        action,
        "openclaw-install-decision",
      )) {
      throw new PersistabilityError(
        "AGENTMO_OPENCLAW_INSTALL_RECEIPT_EVIDENCE_REJECTED",
      );
    }
    const approval = context.approvals.sensitive[index];
    const disposition = observed.disposition === "published"
      ? "succeeded"
      : observed.disposition;
    return {
      actionId: action.actionId,
      actionDigest: evidence.action.actionDigest,
      owner: "openclaw",
      version: plan.target.targetVersion,
      executableDigest: evidence.executable.digest,
      permission: {
        kind: action.kind,
        scope: action.scope,
        targetDigest: evidence.action.targetDigest,
      },
      approval: {
        artifactDigest: approval.artifact.digest,
        decisionDigest: approval.decisionDigest,
        nonceDigest: approval.nonceDigest,
      },
      disposition,
      resultDigest: observed.resultDigest,
      failureCode: observed.failureCode,
      unsupportedReason: observed.unsupportedReason,
      rawOutputPersisted: false,
    };
  });
  const preservedAssets = managedResults
    .filter(({ disposition }) => disposition !== "succeeded")
    .map((managed) => ({
      path: managed.path,
      observedDigest: managed.afterDigest,
      reasonCode: managed.reasonCode,
    }));
  const incompleteReasons = [...new Set([
    ...preservedAssets.map(({ reasonCode }) => reasonCode),
    ...externalResults.flatMap(({ failureCode, unsupportedReason }) => (
      [failureCode, unsupportedReason].filter(Boolean)
    )),
  ])].sort();
  const complete = managedResults.every(
    ({ disposition }) => disposition === "succeeded",
  )
    && externalResults.every(
      ({ disposition }) => disposition === "succeeded",
    )
    && incompleteReasons.length === 0;
  if (!complete && incompleteReasons.length === 0) {
    incompleteReasons.push("receipt-incomplete");
  }
  return Object.freeze({
    status: complete ? "complete" : "incomplete",
    nonceConsumption: {
      markerSetDigest: journal.authorityReservation.markerSetDigest,
      markers,
    },
    managedResults,
    externalResults,
    postEffectEvidence: {
      finalization: structuredClone(finalization.provenance),
      postState: structuredClone(postState.provenance),
      officialActionResults: actionResults.map(({ provenance }) => (
        structuredClone(provenance)
      )),
    },
    preservedAssets,
    recovery: {
      required: !complete,
      disposition: complete
        ? "not-required"
        : preservedAssets.length > 0 ? "preserved" : "recovery-required",
      removedAssets: [],
      preservedAssets: preservedAssets.map((asset) => ({
        path: asset.path,
        digest: asset.observedDigest,
      })),
      reasons: [...incompleteReasons],
    },
    incompleteReasons,
  });
}

function completionTheorem(value) {
  const exactResultCardinality = value.managedResults.length > 0
    && value.externalResults.length === value.approvals.sensitive.length;
  const complete = exactResultCardinality
    && value.managedResults.every((item) => (
      item.disposition === "succeeded"
      && item.postStateMatches === true
      && item.rollbackDisposition === "not-required"
    ))
    && value.externalResults.every(({ disposition }) => disposition === "succeeded")
    && value.nonceConsumption.markers.every(({ consumed }) => consumed === true)
    && value.preservedAssets.length === 0
    && value.recovery.required === false
    && value.recovery.disposition === "not-required"
    && value.incompleteReasons.length === 0;
  return value.status === (complete ? "complete" : "incomplete")
    && (complete || value.incompleteReasons.length > 0);
}

function validCompanionClosure(receipt, context) {
  if (!plainObject(context)
    || !sameKeys(context, [
      "installPlan",
      "installPlanSource",
      "ordinaryApproval",
      "ordinaryApprovalSource",
      "sensitiveDecisions",
      "sensitiveDecisionSources",
      "conflictApproval",
      "conflictApprovalSource",
      "journal",
      "journalSource",
      "probe",
      "probeSource",
      "targetDescriptor",
      "targetDescriptorSource",
      "postState",
      "actionResults",
      "finalization",
    ])
    || !Array.isArray(context.sensitiveDecisions)
    || !Array.isArray(context.sensitiveDecisionSources)
    || context.sensitiveDecisions.length !== context.sensitiveDecisionSources.length
    || !validateOpenClawInstallJournal(context.journal).ok) {
    return false;
  }
  const plan = context.installPlan;
  if (!plainObject(plan)
    || plan.schemaVersion !== "agentmo.openclaw-install-plan.v1"
    || receipt.lifecycle !== plan.lifecycle
    || receipt.authorityLedger.installPlan.installPlanDigest
      !== plan.installPlanDigest
    || !sameJson(receipt.authorityLedger.archive, plan.archiveBinding)
    || !sameJson(receipt.authorityLedger.target, plan.target)
    || receipt.authorityLedger.probe.fingerprintDigest
      !== context.probe?.fingerprintDigest
    || receipt.authorityLedger.probe.executableDigest
      !== context.probe?.cli?.executableDigest
    || receipt.authorityLedger.target.probeFingerprintDigest
      !== context.probe?.fingerprintDigest
    || receipt.authorityLedger.target.targetId !== context.probe?.target?.id
    || receipt.authorityLedger.target.targetVersion
      !== context.probe?.target?.version
    || receipt.authorityLedger.target.targetRevision
      !== context.probe?.target?.sourceRevision
    || context.journal.installPlanDigest !== plan.installPlanDigest
    || context.journal.lifecycle !== plan.lifecycle
    || !sameJson(context.journal.archiveBinding, plan.archiveBinding)
    || context.journal.attemptId !== receipt.authorityLedger.attempt.attemptId
    || context.journal.authorityReservation.markerSetDigest
      !== receipt.nonceConsumption.markerSetDigest
    || !sameJson(
      context.journal.authorityReservation.markers,
      receipt.nonceConsumption.markers.map(({ consumed, ...marker }) => marker),
    )
    || !sameJson(receipt.predecessor, context.journal.predecessor)
    || context.journal.observations.length !== receipt.managedResults.length
    || context.journal.observations.some((observation, index) => (
      observation.path !== receipt.managedResults[index].path
      || observation.digest !== receipt.managedResults[index].beforeDigest
      || !sameJson(
        observation.fileIdentity,
        receipt.managedResults[index].beforeFileIdentity,
      )
      || !sameJson(
        observation.parentIdentity,
        receipt.managedResults[index].beforeParentIdentity,
      )
    ))
    || !sourceMatches(
      receipt.authorityLedger.installPlan.artifact,
      context.installPlanSource,
    )
    || !sourceMatches(
      receipt.authorityLedger.targetDescriptor,
      context.targetDescriptorSource,
    )
    || !sourceMatches(
      receipt.authorityLedger.probe.artifact,
      context.probeSource,
    )
    || !sourceMatches(receipt.authorityLedger.journal, context.journalSource)) {
    return false;
  }
  const expectedApprovals = [
    decisionBinding("ordinary", context.ordinaryApproval, context.ordinaryApprovalSource),
    ...context.sensitiveDecisions.map((decision, index) => decisionBinding(
      "sensitive",
      decision,
      context.sensitiveDecisionSources[index],
    )),
    decisionBinding("conflict", context.conflictApproval, context.conflictApprovalSource),
  ];
  if (!sameJson(receipt.approvals.ordinary, expectedApprovals[0])
    || !sameJson(
      receipt.approvals.sensitive,
      expectedApprovals.slice(1, -1),
    )
    || !sameJson(receipt.approvals.conflict, expectedApprovals.at(-1))
    || context.sensitiveDecisions.length !== plan.sensitiveActions.length
    || context.sensitiveDecisions.some((decision, index) => (
      !sameJson(decision.action, plan.sensitiveActions[index])
    ))) {
    return false;
  }
  const expectedManaged = plan.operations.map((operation) => ({
    path: operation.path,
    operation: operation.operation,
    operationDigest: digestJson(operation, "openclaw-managed-operation"),
    ownerMarker: operation.ownerMarker,
  }));
  if (receipt.managedResults.length !== expectedManaged.length
    || receipt.managedResults.some((managed, index) => (
      !Object.entries(expectedManaged[index]).every(
        ([key, expected]) => managed[key] === expected,
      )
    ))) {
    return false;
  }
  const exactExternalIdentity =
    receipt.externalResults.length === plan.sensitiveActions.length
    && receipt.externalResults.every((external, index) => (
      external.actionId === plan.sensitiveActions[index].actionId
      && external.actionDigest === digestJson(
        plan.sensitiveActions[index],
        "openclaw-install-decision",
      )
      && external.approval.artifactDigest
        === context.sensitiveDecisionSources[index].digest
    ));
  if (!exactExternalIdentity) return false;
  try {
    const derived = deriveOpenClawInstallReceiptEvidence({
      plan,
      journal: context.journal,
      postState: context.postState,
      actionResults: context.actionResults,
      finalization: context.finalization,
      approvals: receipt.approvals,
      probe: context.probe,
    });
    return receipt.status === derived.status
      && sameJson(receipt.nonceConsumption, derived.nonceConsumption)
      && sameJson(receipt.managedResults, derived.managedResults)
      && sameJson(receipt.externalResults, derived.externalResults)
      && sameJson(receipt.postEffectEvidence, derived.postEffectEvidence)
      && sameJson(receipt.preservedAssets, derived.preservedAssets)
      && sameJson(receipt.recovery, derived.recovery)
      && sameJson(receipt.incompleteReasons, derived.incompleteReasons);
  } catch {
    return false;
  }
}

function decisionBinding(family, decision, source) {
  const action = family === "sensitive" ? decision.action : null;
  return {
    family,
    artifact: structuredClone(source),
    decisionDigest: digestJson(decision, "openclaw-install-decision"),
    nonceDigest: digestBytes(Buffer.from(decision.useNonce, "utf8")),
    actionId: action?.actionId ?? null,
    actionDigest: action === null
      ? null
      : digestJson(action, "openclaw-install-decision"),
    conflictSetDigest: family === "conflict"
      ? digestJson(decision.conflicts)
      : null,
  };
}

function validPredecessor(value, lineage, lifecycle, archiveBinding) {
  if (!plainObject(value)
    || !plainObject(lineage)
    || !sameKeys(lineage, [
      "sequence",
      "predecessorReceiptDigest",
      "selectedPredecessorReceiptDigest",
    ])
    || !Number.isSafeInteger(lineage.sequence)
    || lineage.sequence < 0) {
    return false;
  }
  if (lifecycle === "install") {
    return sameKeys(value, ["kind", "absentGenesisDigest"])
      && value.kind === "absent-genesis"
      && DIGEST_PATTERN.test(value.absentGenesisDigest ?? "")
      && lineage.sequence === 0
      && lineage.predecessorReceiptDigest === null
      && lineage.selectedPredecessorReceiptDigest === null;
  }
  if (lifecycle === "upgrade" || lifecycle === "uninstall") {
    return sameKeys(value, ["kind", "currentReceipt"])
      && value.kind === "current-receipt"
      && validReceiptProvenance(value.currentReceipt)
      && lineage.sequence > 0
      && lineage.predecessorReceiptDigest === value.currentReceipt.digest
      && lineage.selectedPredecessorReceiptDigest === null;
  }
  return sameKeys(value, [
    "kind",
    "currentReceipt",
    "selectedPredecessorReceipt",
    "selectedPredecessorArchiveBinding",
  ])
    && value.kind === "rollback-receipts"
    && validReceiptProvenance(value.currentReceipt)
    && validReceiptProvenance(value.selectedPredecessorReceipt)
    && value.currentReceipt.digest !== value.selectedPredecessorReceipt.digest
    && validArchiveBinding(value.selectedPredecessorArchiveBinding)
    && sameJson(value.selectedPredecessorArchiveBinding, archiveBinding)
    && lineage.sequence > 0
    && lineage.predecessorReceiptDigest === value.currentReceipt.digest
    && lineage.selectedPredecessorReceiptDigest
      === value.selectedPredecessorReceipt.digest;
}

function validReceiptProvenance(value) {
  return validProvenance(value, {
    identity: OPENCLAW_INSTALL_RECEIPT_SCHEMA_VERSION,
    subject: "openclaw-install-receipt",
  });
}

function validTarget(value) {
  return plainObject(value)
    && sameKeys(value, [
      "targetId",
      "targetVersion",
      "targetRevision",
      "probeFingerprintDigest",
      "scope",
      "projectId",
    ])
    && value.targetId === "openclaw"
    && nonEmptyString(value.targetVersion)
    && /^[a-f0-9]{40}$/u.test(value.targetRevision ?? "")
    && DIGEST_PATTERN.test(value.probeFingerprintDigest ?? "")
    && ["project", "user"].includes(value.scope)
    && nonEmptyString(value.projectId);
}

function validArchiveBinding(value) {
  if (!plainObject(value)
    || !sameKeys(value, [
      "archiveSha256",
      "manifestDigest",
      "inventoryDigest",
      "members",
    ])
    || !DIGEST_PATTERN.test(value.archiveSha256 ?? "")
    || !DIGEST_PATTERN.test(value.manifestDigest ?? "")
    || !DIGEST_PATTERN.test(value.inventoryDigest ?? "")
    || !Array.isArray(value.members)
    || value.members.length === 0) {
    return false;
  }
  const paths = [];
  for (const member of value.members) {
    if (!plainObject(member)
      || !sameKeys(member, [
        "relativePath",
        "type",
        "mode",
        "byteLength",
        "sha256",
      ])
      || !portableRelativePath(member.relativePath)
      || member.type !== "file"
      || ![0o644, 0o755].includes(member.mode)
      || !Number.isSafeInteger(member.byteLength)
      || member.byteLength < 0
      || !DIGEST_PATTERN.test(member.sha256 ?? "")) {
      return false;
    }
    paths.push(member.relativePath);
  }
  return sortedUniqueStrings(paths)
    && value.inventoryDigest === digestJson(value.members);
}

function exactBoundary(value) {
  const expected = {
    lifecycleEvidenceOnly: true,
    runtime: false,
    domain: false,
    birth: false,
    delivery: false,
    production: false,
    widerOpenClawCompatibility: false,
  };
  return plainObject(value)
    && sameKeys(value, Object.keys(expected))
    && Object.entries(expected).every(([key, item]) => value[key] === item);
}

function validProvenance(value, expected) {
  return plainObject(value)
    && sameKeys(value, PROVENANCE_KEYS)
    && value.identity === expected.identity
    && value.subject === expected.subject
    && DIGEST_PATTERN.test(value.digest ?? "");
}

function validCanonicalEvidenceProvenance(value, identity, subject, action) {
  const keys = [
    "identity",
    "subject",
    "digest",
    "authorityId",
    "rootIdentity",
    "relativeRef",
    "fileIdentity",
    "attemptDigest",
    ...(action ? ["actionId", "actionDigest"] : []),
  ];
  return plainObject(value)
    && sameKeys(value, keys)
    && value.identity === identity
    && value.subject === subject
    && DIGEST_PATTERN.test(value.digest ?? "")
    && DIGEST_PATTERN.test(value.authorityId ?? "")
    && validIdentity(value.rootIdentity)
    && portableRelativePath(value.relativeRef)
    && validIdentity(value.fileIdentity)
    && DIGEST_PATTERN.test(value.attemptDigest ?? "")
    && (!action
      || (nonEmptyString(value.actionId)
        && DIGEST_PATTERN.test(value.actionDigest ?? "")));
}

function sourceMatches(value, source) {
  return plainObject(source)
    && sameJson(value, source);
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

function validIdentity(value) {
  return plainObject(value)
    && sameKeys(value, ["device", "inode"])
    && /^\d+$/u.test(value.device ?? "")
    && /^\d+$/u.test(value.inode ?? "");
}

function receiptObservedIdentity(value) {
  return value === null
    ? null
    : {
      device: value.device,
      inode: value.inode,
    };
}

function nullableIdentity(value) {
  return value === null || validIdentity(value);
}

function nullableDigest(value) {
  return value === null || DIGEST_PATTERN.test(value ?? "");
}

function nullableReason(value) {
  return value === null || REASON_PATTERN.test(value ?? "");
}

function portableRelativePath(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 1024
    && !value.includes("\0")
    && !value.includes("\\")
    && !value.startsWith("/")
    && !/^[A-Za-z]:/u.test(value)
    && !value.split("/").some((segment) => (
      segment === "" || segment === "." || segment === ".."
    ));
}

function sortedUniqueStrings(value) {
  return Array.isArray(value)
    && value.every(nonEmptyString)
    && value.every((item, index) => (
      index === 0 || Buffer.from(item).compare(Buffer.from(value[index - 1])) > 0
    ));
}

function sortedUniqueReasons(value) {
  return Array.isArray(value)
    && value.every((item) => REASON_PATTERN.test(item ?? ""))
    && sortedUniqueStrings(value);
}

function sortedUniqueBy(value, select) {
  return Array.isArray(value)
    && value.every((item, index) => (
      index === 0
      || Buffer.from(select(item)).compare(Buffer.from(select(value[index - 1]))) > 0
    ));
}

function digestJson(value, subject = "openclaw-authority-digest") {
  return digestBytes(Buffer.from(
    serializePersistableJson(value, { subject }),
    "utf8",
  ));
}

function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sameJson(left, right) {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
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

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function result(errors) {
  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze([...new Set(errors)].sort()),
  });
}
