import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  lstat,
  open,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  digestRawBytes,
  loadAdmittedArtifact,
} from "./artifact-admission.js";
import {
  validateOpenClawInstallDecision,
  validateOpenClawConflictApproval,
  validateOpenClawInstallApproval,
  validateOpenClawSensitiveActionDecision,
} from "./openclaw-install-approval.js";
import {
  openOpenClawCanonicalAuthorityLedger,
  reserveOpenClawCanonicalAuthoritySet,
} from "./openclaw-authority-consumption.js";
import {
  loadOpenClawAuthorityRootBinding,
  validateOpenClawAuthorityRootBinding,
} from "./openclaw-authority-root-binding.js";
import {
  publishOpenClawInstallFinalizationEvidence,
  publishOpenClawInstallPostStateEvidence,
  publishOpenClawOfficialActionResultEvidence,
  reopenOpenClawInstallFinalizationEvidence,
  reopenOpenClawInstallPostStateEvidence,
  reopenOpenClawOfficialActionResultEvidence,
} from "./openclaw-install-evidence.js";
import {
  validateOpenClawAbsentGenesisAuthority,
  validateOpenClawInstallPlan,
} from "./openclaw-install-plan.js";
import {
  deriveOpenClawInstallReceiptEvidence,
  digestOpenClawReceiptValue,
  OPENCLAW_INSTALL_RECEIPT_SCHEMA_VERSION,
  validateOpenClawInstallReceipt,
  writeOpenClawInstallReceipt,
} from "./openclaw-install-receipt.js";
import {
  validateOpenClawProbe,
} from "./openclaw-probe-contract.js";
import { probeOpenClawTarget } from "./openclaw-probe.js";
import {
  prepareOpenClawOfficialActionExecutable,
  runOpenClawOfficialAction,
} from "./openclaw-official-action-runner.js";
import {
  buildOpenClawCredentialSetupProposal,
} from "./openclaw-credential-handoff.js";
import { openOpenClawSafeFsSession } from "./openclaw-safe-fs.js";
import {
  assertPersistable,
  serializePersistableJson,
} from "./persistability.js";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const LIFECYCLES = new Set(["install", "upgrade", "rollback", "uninstall"]);
const PREDECESSOR_SEQUENCES = new WeakMap();
const PREDECESSOR_FINALIZATIONS = new WeakMap();
const PUBLIC_KEYS = [
  "blueprintPath",
  "blueprintDigest",
  "buildContractPath",
  "buildContractDigest",
  "planApprovalPath",
  "planApprovalDigest",
  "targetDescriptorPath",
  "targetDescriptorDigest",
  "targetCarrierAdmissionPath",
  "targetCarrierAdmissionDigest",
  "archivePath",
  "archiveDigest",
  "probePath",
  "probeDigest",
  "installPlanPath",
  "installPlanDigest",
  "installApprovalPath",
  "installApprovalDigest",
  "sensitiveDecisions",
  "conflictApprovalPath",
  "conflictApprovalDigest",
  "absentGenesisPath",
  "absentGenesisDigest",
  "currentReceiptPath",
  "currentReceiptDigest",
  "currentReceiptCompanions",
  "selectedPredecessorReceiptPath",
  "selectedPredecessorReceiptDigest",
  "selectedPredecessorReceiptCompanions",
  "selectedPredecessorArchivePath",
  "selectedPredecessorArchiveDigest",
  "openClawTargetRoot",
  "targetRoot",
  "outputPath",
  "helperPath",
  "receiptPath",
  "receiptDigest",
  "attemptId",
  "authorityStateRoot",
  "authorityRootBindingPath",
  "authorityRootBindingDigest",
];

export class OpenClawInstallTransactionError extends Error {
  constructor(code) {
    super("OpenClaw lifecycle transaction was rejected.");
    this.name = "OpenClawInstallTransactionError";
    this.code = code;
  }
}

export async function applyOpenClawInstallTransaction(options = {}) {
  assertApplyOptions(options);
  await assertAbsent(options.outputPath, "AGENTMO_OPENCLAW_INSTALL_OUTPUT_EXISTS");

  const blueprint = await admit(
    options.blueprintPath,
    options.blueprintDigest,
    "blueprint",
  );
  const buildContract = await admit(
    options.buildContractPath,
    options.buildContractDigest,
    "build-contract",
  );
  const planApproval = await admit(
    options.planApprovalPath,
    options.planApprovalDigest,
    "plan-approval",
  );
  const targetDescriptorAdmission = await admit(
    options.targetDescriptorPath,
    options.targetDescriptorDigest,
    "openclaw-target-descriptor",
  );
  const targetDescriptor = targetDescriptorAdmission.value;
  let authorityRootBindingAdmission;
  try {
    authorityRootBindingAdmission = await loadOpenClawAuthorityRootBinding(
      options.authorityRootBindingPath,
      options.authorityRootBindingDigest,
    );
  } catch {
    fail("AGENTMO_OPENCLAW_AUTHORITY_ROOT_BINDING_REJECTED");
  }
  const authorityRootBinding = authorityRootBindingAdmission.value;
  const carrier = await loadAdmittedArtifact({
    filePath: options.targetCarrierAdmissionPath,
    expectedDigest: options.targetCarrierAdmissionDigest,
    subject: "openclaw-target-carrier-admission",
    companions: {
      blueprint,
      "build-contract": buildContract,
      "plan-approval": planApproval,
      "openclaw-target-descriptor": targetDescriptorAdmission,
    },
  });
  const archive = await retainAndValidateArchive(
    options.archivePath,
    options.archiveDigest,
  );
  const planAdmission = await admit(
    options.installPlanPath,
    options.installPlanDigest,
    "openclaw-install-plan",
  );
  const plan = planAdmission.value;
  if (!validateOpenClawInstallPlan(plan).ok
    || !LIFECYCLES.has(plan.lifecycle)
    || !same(plan.archiveBinding, archive.binding)
    || !same(plan.authorityRootBinding, authorityRootBinding)
    || plan.archiveBinding.archiveSha256 !== options.archiveDigest) {
    fail("AGENTMO_OPENCLAW_INSTALL_ARCHIVE_CLOSURE_MISMATCH");
  }
  assertCarrierAndProbeBindings(carrier.value, null, plan);

  const approvalAdmission = await admit(
    options.installApprovalPath,
    options.installApprovalDigest,
    "openclaw-install-approval",
  );
  const approval = approvalAdmission.value;
  const decisionContext = { plan, now: new Date().toISOString() };
  if (!validateOpenClawInstallApproval(approval, decisionContext).ok) {
    fail("AGENTMO_OPENCLAW_INSTALL_APPROVAL_REJECTED");
  }

  const decisions = [];
  const decisionAdmissions = [];
  for (const input of options.sensitiveDecisions) {
    const admission = await admit(
      input.filePath,
      input.digest,
      "openclaw-sensitive-action-decision",
    );
    decisionAdmissions.push(admission);
    decisions.push(admission.value);
  }
  assertSensitiveDecisions(plan, decisions, decisionContext);
  const conflictApprovalAdmission = await admitConflictApproval(
    options,
    plan,
    decisionContext,
  );
  const conflictApproval = conflictApprovalAdmission.value;
  assertAllRepeatArchiveClosure(
    plan.archiveBinding,
    [approval, ...decisions, ...(conflictApproval ? [conflictApproval] : [])],
  );
  if ([approval, ...decisions, conflictApproval].some((authority) => (
    !same(authority.authorityRootBinding, plan.authorityRootBinding)
  ))) {
    fail("AGENTMO_OPENCLAW_AUTHORITY_ROOT_BINDING_REJECTED");
  }
  const predecessor = await admitPredecessor(options, plan);

  const currentProbe = await probeOpenClawTarget({
    archivePath: options.archivePath,
    expectedArchiveDigest: options.archiveDigest,
    blueprintPath: options.blueprintPath,
    expectedBlueprintDigest: options.blueprintDigest,
    buildContractPath: options.buildContractPath,
    expectedBuildContractDigest: options.buildContractDigest,
    planApprovalPath: options.planApprovalPath,
    expectedPlanApprovalDigest: options.planApprovalDigest,
    targetCarrierAdmissionPath: options.targetCarrierAdmissionPath,
    expectedTargetCarrierAdmissionDigest: options.targetCarrierAdmissionDigest,
    targetDescriptorPath: options.targetDescriptorPath,
    expectedTargetDescriptorDigest: options.targetDescriptorDigest,
    targetRoot: options.openClawTargetRoot,
  });
  const approvedProbeAdmission = await loadExactJson({
    filePath: options.probePath,
    digest: options.probeDigest,
    identity: "agentmo.openclaw-probe.v1",
    validate: (value) => validateOpenClawProbe(
      value,
      { sources: currentProbe.sourceBindings },
    ),
  });
  const probe = approvedProbeAdmission.value;
  assertCarrierAndProbeBindings(carrier.value, probe, plan);
  if (!sameProbeBasis(currentProbe, probe, plan)) {
    fail("AGENTMO_OPENCLAW_INSTALL_STALE_PROBE");
  }
  let canonicalAuthorityStateRoot;
  try {
    canonicalAuthorityStateRoot = await deriveOpenClawAuthorityStateRoot({
      openClawTargetRoot: options.openClawTargetRoot,
      targetDescriptorDigest: probe.target.descriptorDigest,
    });
  } catch {
    fail("AGENTMO_OPENCLAW_AUTHORITY_STATE_ROOT_BINDING_REJECTED");
  }
  if (path.resolve(options.authorityStateRoot) !== canonicalAuthorityStateRoot) {
    fail("AGENTMO_OPENCLAW_AUTHORITY_STATE_ROOT_BINDING_REJECTED");
  }
  let safeFs;
  let authorityLedger;
  try {
    safeFs = await openOpenClawSafeFsSession({
      rootPath: options.targetRoot,
      helperPath: options.helperPath,
      receiptPath: options.receiptPath,
      receiptDigest: options.receiptDigest,
    });
  } catch {
    fail("AGENTMO_OPENCLAW_INSTALL_FS_HELPER_REJECTED");
  }
  try {
    const observations = await observeOperations(safeFs, plan.operations);
    assertConflictSet(plan, conflictApproval, observations);
    try {
      authorityLedger = await openOpenClawCanonicalAuthorityLedger({
        openClawTargetRoot: options.openClawTargetRoot,
        targetDescriptor,
        helperPath: options.helperPath,
        receiptPath: options.receiptPath,
        receiptDigest: options.receiptDigest,
        authorityRootBinding,
      });
    } catch {
      fail("AGENTMO_OPENCLAW_AUTHORITY_STATE_ROOT_REJECTED");
    }
    const authorityReservation = await reserveOpenClawCanonicalAuthoritySet({
      ledger: authorityLedger,
      attemptId: options.attemptId,
      plan,
      probe,
      ordinaryApproval: approval,
      sensitiveDecisions: decisions,
      conflictApproval,
      now: decisionContext.now,
    });
    assertCanonicalDecisions({
      plan,
      approval,
      decisions,
      conflictApproval,
      now: decisionContext.now,
      authorityReservation,
    });

  const journalRelativePath =
    `.agentmo-openclaw-install-${plan.installPlanDigest.slice("sha256:".length)}-${digestRawBytes(Buffer.from(options.attemptId)).slice("sha256:".length)}.journal.json`;
  const journalPath = path.join(path.resolve(options.targetRoot), journalRelativePath);
  const journal = buildJournal(
    plan,
    predecessor,
    observations,
    options.attemptId,
    authorityReservation,
  );
  const journalDigest = await writePrivateJournal(
    safeFs,
    journalRelativePath,
    journal,
    authorityReservation.status,
  );

  const applied = [];
  const preserved = [];
  const externalResults = [];
  try {
    let blocked = false;
    for (const operation of plan.operations) {
      const before = observations.find(({ path: candidate }) => candidate === operation.path);
      const result = blocked
        ? {
          path: operation.path,
          operation: operation.operation,
          createdByAttempt: false,
          outcome: "preserved",
          observedDigest: before.digest,
          observedFileIdentity: before.fileIdentity,
          reason: "prior-effect-incomplete",
        }
        : await applyOperation({
          safeFs,
          operation,
          before,
          archive,
        });
      applied.push(result);
      if (!["applied", "pending-official"].includes(result.outcome)) {
        blocked = true;
        preserved.push({
          path: operation.path,
          observedDigest: result.observedDigest,
          reason: result.reason,
        });
      }
    }
    let officialExecutable;
    for (const [index, action] of plan.sensitiveActions.entries()) {
      if (blocked) {
        externalResults.push(notAttemptedOfficialResult(
          action,
          decisions[index],
          "prior-effect-incomplete",
        ));
        continue;
      }
      const operation = plan.operations.find(({ path: candidate }) => (
        candidate === action.target
      ));
      let result;
      try {
        if (operation
          && ["patch", "remove"].includes(operation.operation)
          && plainObject(operation.configPatch)) {
          officialExecutable ??= await prepareOpenClawOfficialActionExecutable({
            targetRoot: options.openClawTargetRoot,
            probe,
          });
          const baseObservation = await safeFs.observe(operation.path);
          result = await runOpenClawOfficialAction({
            route: "config-patch",
            action,
            decision: decisions[index],
            validation: {
              plan,
              now: decisionContext.now,
              authorityReservation,
              probe,
            },
            verifiedExecutable: officialExecutable.verifiedExecutable,
            safeFsSession: safeFs,
            configRelativePath: operation.path,
            configPath: path.join(path.resolve(options.targetRoot), operation.path),
            baseObservation,
            patch: operation.configPatch.patch,
            expectedBaseDigest: operation.baseDigest,
            expectedResultDigest: operation.desiredDigest,
            runProcess: null,
          });
          const appliedIndex = applied.findIndex(({ path: candidate }) => (
            candidate === operation.path
          ));
          const after = await safeFs.observe(operation.path);
          applied[appliedIndex] = officialResultUnsupported(result)
            ? {
              path: operation.path,
              operation: operation.operation,
              createdByAttempt: false,
              outcome: "preserved",
              observedDigest: after.digest ?? null,
              observedFileIdentity: safeFsIdentity(after),
              reason: result.unsupportedReason,
            }
            : {
              path: operation.path,
              operation: operation.operation,
              createdByAttempt: false,
              outcome: "applied",
              observedDigest: after.digest ?? null,
              observedFileIdentity: safeFsIdentity(after),
              desiredDigest: operation.desiredDigest,
            };
        } else if (action.kind === "credential") {
          const proposal = buildOpenClawCredentialSetupProposal({
            profileReference: action.target,
            missingEnvironmentNames: [],
            officialRoute: {
              executable: action.executable,
              argv: action.argv,
              timeoutMs: action.timeoutMs,
            },
          });
          result = await runOpenClawOfficialAction({
            route: "credential",
            proposal,
            decision: decisions[index],
            validation: {
              plan,
              now: decisionContext.now,
              authorityReservation,
              probe,
            },
            verifiedExecutable: officialExecutable?.verifiedExecutable
              ?? proposalOnlyExecutableBinding(options.openClawTargetRoot, probe),
            runProcess: null,
          });
        } else {
          fail("AGENTMO_OPENCLAW_INSTALL_OFFICIAL_ACTION_REQUIRED");
        }
      } catch (error) {
        result = failedOfficialResult(
          action,
          decisions[index],
          error?.code,
        );
      }
      externalResults.push(result);
      if (!officialResultSucceeded(result)) blocked = true;
    }
    const evidence = await publishExecutionEvidence({
      ledger: authorityLedger,
      targetSession: safeFs,
      attemptId: options.attemptId,
      plan,
      planAdmission,
      journal,
      journalDigest,
      targetDescriptorAdmission,
      probe,
      authorityReservation,
      decisions,
      decisionAdmissions,
      externalResults,
      predecessor,
    });
    const receipt = buildReceipt({
      plan,
      predecessor,
      planAdmission,
      targetDescriptorAdmission,
      probeAdmission: {
        identity: "agentmo.openclaw-probe.v1",
        subject: "openclaw-probe",
        digest: options.probeDigest,
      },
      probe,
      approvalAdmission,
      decisionAdmissions,
      conflictApprovalAdmission,
      authorityReservation,
      journal,
      journalDigest,
      evidence,
    });
    const validationContext = receiptValidationContext({
      planAdmission,
      targetDescriptorAdmission,
      probeAdmission: {
        identity: "agentmo.openclaw-probe.v1",
        subject: "openclaw-probe",
        digest: options.probeDigest,
      },
      probe,
      approvalAdmission,
      decisionAdmissions,
      conflictApprovalAdmission,
      journal,
      journalDigest,
      evidence,
    });
    const companionValidation = validateOpenClawInstallReceipt(
      receipt,
      validationContext,
    );
    if (!companionValidation.ok) {
      fail("AGENTMO_OPENCLAW_INSTALL_RECEIPT_INVALID");
    }
    const published = await writeOpenClawInstallReceipt(
      options.outputPath,
      receipt,
      { validationContext },
    );
    return Object.freeze({
      receipt,
      digest: published.digest,
      journalPath,
      externalResults: freeze(externalResults),
    });
  } catch (error) {
    if (await exists(options.outputPath)) throw error;
    await recoverAppliedOperations(safeFs, applied);
    const evidence = await publishExecutionEvidence({
      ledger: authorityLedger,
      targetSession: safeFs,
      attemptId: options.attemptId,
      plan,
      planAdmission,
      journal,
      journalDigest,
      targetDescriptorAdmission,
      probe,
      authorityReservation,
      decisions,
      decisionAdmissions,
      externalResults,
      predecessor,
    });
    const incomplete = buildReceipt({
      plan,
      predecessor,
      planAdmission,
      targetDescriptorAdmission,
      probeAdmission: {
        identity: "agentmo.openclaw-probe.v1",
        subject: "openclaw-probe",
        digest: options.probeDigest,
      },
      probe,
      approvalAdmission,
      decisionAdmissions,
      conflictApprovalAdmission,
      authorityReservation,
      journal,
      journalDigest,
      evidence,
    });
    try {
      await writeOpenClawInstallReceipt(options.outputPath, incomplete, {
        validationContext: receiptValidationContext({
          planAdmission,
          targetDescriptorAdmission,
          probeAdmission: {
            identity: "agentmo.openclaw-probe.v1",
            subject: "openclaw-probe",
            digest: options.probeDigest,
          },
          probe,
          approvalAdmission,
          decisionAdmissions,
          conflictApprovalAdmission,
          journal,
          journalDigest,
          evidence,
        }),
      });
    } catch {
      throw error;
    }
    throw error;
    }
  } finally {
    await authorityLedger?.close().catch(() => {});
    await safeFs.close().catch(() => {});
  }
}

export const applyOpenClawInstallPlan = applyOpenClawInstallTransaction;

export async function recoverOpenClawInstallAttempt(options = {}) {
  if (!plainObject(options)
    || !sameKeys(options, [
      "rootPath",
      "helperPath",
      "receiptPath",
      "receiptDigest",
      "assets",
    ])
    || !path.isAbsolute(options.rootPath ?? "")
    || !Array.isArray(options.assets)) {
    fail("AGENTMO_OPENCLAW_INSTALL_RECOVERY_ARGUMENTS_REJECTED");
  }
  let safeFs;
  try {
    safeFs = await openOpenClawSafeFsSession({
      rootPath: options.rootPath,
      helperPath: options.helperPath,
      receiptPath: options.receiptPath,
      receiptDigest: options.receiptDigest,
    });
  } catch {
    fail("AGENTMO_OPENCLAW_INSTALL_FS_HELPER_REJECTED");
  }
  try {
    const preserved = [];
    for (const asset of options.assets) {
      if (!plainObject(asset)
        || !sameKeys(asset, [
          "path",
          "createdByAttempt",
          "ownerMarkerPath",
          "expectedOwnerMarkerDigest",
          "retainedIdentity",
          "desiredDigest",
        ])
        || !portableRelativePath(asset.path)
        || !portableRelativePath(asset.ownerMarkerPath)
        || typeof asset.createdByAttempt !== "boolean"
        || !DIGEST_PATTERN.test(asset.expectedOwnerMarkerDigest ?? "")
        || !DIGEST_PATTERN.test(asset.desiredDigest ?? "")
        || !validIdentity(asset.retainedIdentity)) {
        fail("AGENTMO_OPENCLAW_INSTALL_RECOVERY_ARGUMENTS_REJECTED");
      }
      const [observed, marker] = await Promise.all([
        safeFs.observe(asset.path),
        safeFs.observe(asset.ownerMarkerPath),
      ]);
      const observedIdentity = safeFsIdentity(observed);
      const exact = asset.createdByAttempt === true
        && observed.disposition === "observed"
        && marker.disposition === "observed"
        && same(observedIdentity, asset.retainedIdentity)
        && observed.digest === asset.desiredDigest
        && marker.digest === asset.expectedOwnerMarkerDigest;
      preserved.push(Object.freeze({
        path: asset.path,
        reason: exact
          ? "reopened-published-object-not-deletable"
          : "recovery-revalidation-mismatch",
        observedIdentity,
        expectedIdentity: asset.retainedIdentity,
        observedDigest: observed.digest ?? null,
        expectedDigest: asset.desiredDigest,
      }));
    }
    return Object.freeze({
      status: "incomplete",
      removed: Object.freeze([]),
      preserved: Object.freeze(preserved),
    });
  } finally {
    await safeFs.close().catch(() => {});
  }
}

async function admit(filePath, digest, subject) {
  try {
    return await loadAdmittedArtifact({
      filePath,
      subject,
      expectedDigest: digest,
    });
  } catch {
    fail("AGENTMO_OPENCLAW_INSTALL_AUTHORITY_REJECTED");
  }
}

async function loadExactJson({ filePath, digest, identity, validate }) {
  const retained = await readRetainedFile(filePath, digest);
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(retained.bytes));
  } catch {
    fail("AGENTMO_OPENCLAW_INSTALL_AUTHORITY_REJECTED");
  }
  if (!plainObject(value)
    || value.schemaVersion !== identity
    || (validate && !validate(value).ok)) {
    fail("AGENTMO_OPENCLAW_INSTALL_AUTHORITY_REJECTED");
  }
  return Object.freeze({ value: freeze(value), identity: retained.identity });
}

async function retainAndValidateArchive(filePath, digest) {
  const retained = await readRetainedFile(filePath, digest);
  let envelope;
  try {
    envelope = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(retained.bytes));
  } catch {
    fail("AGENTMO_OPENCLAW_INSTALL_ARCHIVE_REJECTED");
  }
  const canonical = Buffer.from(`${JSON.stringify(envelope, null, 2)}\n`, "utf8");
  if (!canonical.equals(retained.bytes)
    || envelope?.schemaVersion !== "agentmo.package-archive.v1"
    || envelope?.transportRole !== "sole-preview-approval-apply-transport"
    || !DIGEST_PATTERN.test(envelope?.manifestDigest ?? "")
    || !DIGEST_PATTERN.test(envelope?.inventoryDigest ?? "")
    || typeof envelope?.manifestContentBase64 !== "string"
    || !Array.isArray(envelope?.members)) {
    fail("AGENTMO_OPENCLAW_INSTALL_ARCHIVE_REJECTED");
  }
  const manifestBytes = strictBase64(envelope.manifestContentBase64);
  if (digestRawBytes(manifestBytes) !== envelope.manifestDigest) {
    fail("AGENTMO_OPENCLAW_INSTALL_ARCHIVE_MANIFEST_DRIFT");
  }
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes));
  } catch {
    fail("AGENTMO_OPENCLAW_INSTALL_ARCHIVE_MANIFEST_DRIFT");
  }
  if (manifest.inventoryDigest !== envelope.inventoryDigest
    || !Array.isArray(manifest.members)
    || manifest.members.length !== envelope.members.length) {
    fail("AGENTMO_OPENCLAW_INSTALL_ARCHIVE_INVENTORY_DRIFT");
  }
  const contents = new Map();
  const members = envelope.members.map((member, index) => {
    if (!plainObject(member)
      || !sameKeys(member, [
        "relativePath",
        "type",
        "mode",
        "byteLength",
        "sha256",
        "contentBase64",
      ])
      || member.type !== "file"
      || ![0o644, 0o755].includes(member.mode)) {
      fail("AGENTMO_OPENCLAW_INSTALL_ARCHIVE_MEMBER_DRIFT");
    }
    const bytes = strictBase64(member.contentBase64);
    const descriptor = {
      relativePath: member.relativePath,
      type: "file",
      mode: member.mode,
      byteLength: bytes.length,
      sha256: digestRawBytes(bytes),
    };
    if (!isDeepStrictEqual(descriptor, manifest.members[index])) {
      fail("AGENTMO_OPENCLAW_INSTALL_ARCHIVE_MEMBER_DRIFT");
    }
    contents.set(member.relativePath, bytes);
    return descriptor;
  });
  const inventoryDigest = digestRawBytes(Buffer.from(
    serializePersistableJson(members, { subject: "package-member-inventory" }),
    "utf8",
  ));
  if (inventoryDigest !== envelope.inventoryDigest) {
    fail("AGENTMO_OPENCLAW_INSTALL_ARCHIVE_INVENTORY_DRIFT");
  }
  return Object.freeze({
    binding: freeze({
      archiveSha256: digest,
      manifestDigest: envelope.manifestDigest,
      inventoryDigest,
      members,
    }),
    contents,
    identity: retained.identity,
  });
}

async function readRetainedFile(filePath, digest) {
  if (typeof filePath !== "string"
    || filePath.length === 0
    || filePath.includes("\0")
    || !DIGEST_PATTERN.test(digest ?? "")) {
    fail("AGENTMO_OPENCLAW_INSTALL_AUTHORITY_REJECTED");
  }
  let handle;
  try {
    handle = await open(
      path.resolve(filePath),
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n) {
      fail("AGENTMO_OPENCLAW_INSTALL_AUTHORITY_REJECTED");
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const current = await lstat(path.resolve(filePath), { bigint: true });
    if (!sameIdentity(before, after)
      || !sameIdentity(after, current)
      || before.size !== after.size
      || before.mtimeNs !== after.mtimeNs
      || before.ctimeNs !== after.ctimeNs
      || digestRawBytes(bytes) !== digest) {
      fail("AGENTMO_OPENCLAW_INSTALL_AUTHORITY_REJECTED");
    }
    return Object.freeze({
      bytes,
      identity: Object.freeze({
        device: before.dev.toString(),
        inode: before.ino.toString(),
      }),
    });
  } catch (error) {
    if (error instanceof OpenClawInstallTransactionError) throw error;
    fail("AGENTMO_OPENCLAW_INSTALL_AUTHORITY_REJECTED");
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function admitConflictApproval(options, plan, context) {
  const hasPair = options.conflictApprovalPath !== null
    || options.conflictApprovalDigest !== null;
  if (!hasPair
    || (
      typeof options.conflictApprovalPath !== "string"
      || !DIGEST_PATTERN.test(options.conflictApprovalDigest ?? "")
    )) {
    fail("AGENTMO_OPENCLAW_INSTALL_CONFLICT_AUTHORITY_REJECTED");
  }
  const admission = await admit(
    options.conflictApprovalPath,
    options.conflictApprovalDigest,
    "openclaw-conflict-approval",
  );
  const value = admission.value;
  if (!validateOpenClawConflictApproval(value, context).ok) {
    fail("AGENTMO_OPENCLAW_INSTALL_CONFLICT_AUTHORITY_REJECTED");
  }
  return admission;
}

async function admitPredecessor(options, plan) {
  if (plan.lifecycle === "install") {
    const admission = await admit(
      options.absentGenesisPath,
      options.absentGenesisDigest,
      "openclaw-absent-genesis",
    );
    if (!validateOpenClawAbsentGenesisAuthority(admission.value).ok
      || !same(admission.value, plan.predecessor.absentGenesis)) {
      fail("AGENTMO_OPENCLAW_INSTALL_PREDECESSOR_REJECTED");
    }
    const predecessor = {
      kind: "absent-genesis",
      absentGenesisDigest: admission.digest,
    };
    PREDECESSOR_SEQUENCES.set(predecessor, -1);
    return predecessor;
  }
  const current = await admitOpenClawInstallReceiptWithCompanions(
    options.currentReceiptPath,
    options.currentReceiptDigest,
    options.currentReceiptCompanions,
    receiptEvidenceAuthorityOptions(options, plan.authorityRootBinding),
  );
  if (!validateOpenClawInstallReceipt(current.value).ok
    || current.digest !== plan.predecessor.currentReceipt.receiptDigest) {
    fail("AGENTMO_OPENCLAW_INSTALL_PREDECESSOR_REJECTED");
  }
  if (plan.lifecycle !== "rollback") {
    const predecessor = {
      kind: "current-receipt",
      currentReceipt: provenance(current),
    };
    PREDECESSOR_SEQUENCES.set(predecessor, current.value.lineage.sequence);
    PREDECESSOR_FINALIZATIONS.set(predecessor, current.finalization);
    return predecessor;
  }
  const selected = await admitOpenClawInstallReceiptWithCompanions(
    options.selectedPredecessorReceiptPath,
    options.selectedPredecessorReceiptDigest,
    options.selectedPredecessorReceiptCompanions,
    receiptEvidenceAuthorityOptions(options, plan.authorityRootBinding),
  );
  const selectedArchive = await retainAndValidateArchive(
    options.selectedPredecessorArchivePath,
    options.selectedPredecessorArchiveDigest,
  );
  if (selected.digest
      !== plan.predecessor.selectedPredecessorReceipt.receiptDigest
    || !same(
      selectedArchive.binding,
      plan.predecessor.selectedPredecessorArchiveBinding,
    )) {
    fail("AGENTMO_OPENCLAW_INSTALL_PREDECESSOR_REJECTED");
  }
  const predecessor = {
    kind: "rollback-receipts",
    currentReceipt: provenance(current),
    selectedPredecessorReceipt: provenance(selected),
    selectedPredecessorArchiveBinding: selectedArchive.binding,
  };
  PREDECESSOR_SEQUENCES.set(predecessor, current.value.lineage.sequence);
  PREDECESSOR_FINALIZATIONS.set(predecessor, current.finalization);
  return predecessor;
}

export async function admitOpenClawInstallReceiptWithCompanions(
  filePath,
  digest,
  bindings,
  authorityOptions,
) {
  return admitOpenClawInstallReceiptClosure(
    filePath,
    digest,
    bindings,
    authorityOptions,
    new Set(),
  );
}

async function admitOpenClawInstallReceiptClosure(
  filePath,
  digest,
  bindings,
  authorityOptions,
  seen,
) {
  if (!validReceiptCompanionBindings(bindings)) {
    fail("AGENTMO_OPENCLAW_INSTALL_ARGUMENTS_REJECTED");
  }
  assertReceiptEvidenceAuthorityOptions(authorityOptions);
  const closureKey = `${path.resolve(filePath)}\0${digest}`;
  if (seen.has(closureKey)) {
    fail("AGENTMO_OPENCLAW_INSTALL_RECEIPT_EVIDENCE_REJECTED");
  }
  seen.add(closureKey);
  const [
    blueprint,
    buildContract,
    planApproval,
    targetDescriptor,
    packageManifest,
  ] = await Promise.all([
    admitBinding(bindings.blueprint, "blueprint"),
    admitBinding(bindings.buildContract, "build-contract"),
    admitBinding(bindings.planApproval, "plan-approval"),
    admitBinding(bindings.targetDescriptor, "openclaw-target-descriptor"),
    admitBinding(bindings.packageManifest, "package-manifest"),
  ]);
  const targetCarrierAdmission = await loadAdmittedArtifact({
    filePath: bindings.targetCarrierAdmission.filePath,
    expectedDigest: bindings.targetCarrierAdmission.digest,
    subject: "openclaw-target-carrier-admission",
    companions: {
      blueprint,
      "build-contract": buildContract,
      "plan-approval": planApproval,
      "openclaw-target-descriptor": targetDescriptor,
    },
  });
  const probe = await loadAdmittedArtifact({
    filePath: bindings.probe.filePath,
    expectedDigest: bindings.probe.digest,
    subject: "openclaw-probe",
    companions: {
      "package-manifest": packageManifest,
      "openclaw-target-carrier-admission": targetCarrierAdmission,
      "openclaw-target-descriptor": targetDescriptor,
    },
  });
  const [
    installPlan,
    ordinaryApproval,
    conflictApproval,
    journal,
  ] = await Promise.all([
    admitBinding(bindings.installPlan, "openclaw-install-plan"),
    admitBinding(bindings.ordinaryApproval, "openclaw-install-approval"),
    admitBinding(bindings.conflictApproval, "openclaw-conflict-approval"),
    admitBinding(bindings.journal, "openclaw-install-private-journal"),
  ]);
  const sensitiveDecisions = [];
  for (const binding of bindings.sensitiveDecisions) {
    sensitiveDecisions.push(await admitBinding(
      binding,
      "openclaw-sensitive-action-decision",
    ));
  }
  let loaded;
  try {
    loaded = await loadExactJson({
      filePath,
      digest,
      identity: OPENCLAW_INSTALL_RECEIPT_SCHEMA_VERSION,
      validate: validateOpenClawInstallReceipt,
    });
  } catch {
    fail("AGENTMO_OPENCLAW_INSTALL_RECEIPT_EVIDENCE_REJECTED");
  }
  if ((loaded.value.lifecycle === "install") !== (bindings.predecessor === null)) {
    fail("AGENTMO_OPENCLAW_INSTALL_RECEIPT_EVIDENCE_REJECTED");
  }
  let ledger;
  try {
    ledger = await openOpenClawCanonicalAuthorityLedger({
      openClawTargetRoot: authorityOptions.openClawTargetRoot,
      targetDescriptor: targetDescriptor.value,
      helperPath: authorityOptions.helperPath,
      receiptPath: authorityOptions.receiptPath,
      receiptDigest: authorityOptions.receiptDigest,
      authorityRootBinding: authorityOptions.authorityRootBinding,
    });
    const receipt = loaded.value;
    const attemptId = receipt.authorityLedger.attempt.attemptId;
    const markerAuthority = {
      ordinaryApproval: ordinaryApproval.value,
      sensitiveDecisions: sensitiveDecisions.map(({ value }) => value),
      conflictApproval: conflictApproval.value,
    };
    const postState = await reopenOpenClawInstallPostStateEvidence({
      ledger,
      provenance: receipt.postEffectEvidence.postState,
      attemptId,
      plan: installPlan.value,
      planSource: provenance(installPlan),
      journalSource: provenance(journal),
      targetDescriptorSource: provenance(targetDescriptor),
    });
    const actionResults = [];
    for (const [index, action] of installPlan.value.sensitiveActions.entries()) {
      actionResults.push(await reopenOpenClawOfficialActionResultEvidence({
        ledger,
        provenance: receipt.postEffectEvidence.officialActionResults[index],
        attemptId,
        plan: installPlan.value,
        planSource: provenance(installPlan),
        action,
        decision: sensitiveDecisions[index].value,
        decisionSource: provenance(sensitiveDecisions[index]),
        probe: probe.value,
        markerAuthority,
      }));
    }
    let predecessorFinalization = null;
    if (receipt.lifecycle !== "install") {
      const predecessorBinding = bindings.predecessor;
      const predecessorAdmission = await admitOpenClawInstallReceiptClosure(
        predecessorBinding.filePath,
        predecessorBinding.digest,
        predecessorBinding.companions,
        authorityOptions,
        seen,
      );
      if (predecessorAdmission.digest
        !== receipt.lineage.predecessorReceiptDigest) {
        fail("AGENTMO_OPENCLAW_INSTALL_RECEIPT_EVIDENCE_REJECTED");
      }
      predecessorFinalization = predecessorAdmission.finalization;
    }
    const finalization = await reopenOpenClawInstallFinalizationEvidence({
      ledger,
      provenance: receipt.postEffectEvidence.finalization,
      attemptId,
      plan: installPlan.value,
      planSource: provenance(installPlan),
      postState,
      actionResults,
      predecessor: predecessorFinalization,
      probe: probe.value,
      markerAuthority,
    });
    const validationContext = receiptValidationContext({
      planAdmission: installPlan,
      targetDescriptorAdmission: targetDescriptor,
      probeAdmission: provenance(probe),
      probe: probe.value,
      approvalAdmission: ordinaryApproval,
      decisionAdmissions: sensitiveDecisions,
      conflictApprovalAdmission: conflictApproval,
      journal: journal.value,
      journalDigest: journal.digest,
      evidence: { postState, actionResults, finalization },
    });
    if (!validateOpenClawInstallReceipt(receipt, validationContext).ok) {
      fail("AGENTMO_OPENCLAW_INSTALL_RECEIPT_EVIDENCE_REJECTED");
    }
    return Object.freeze({
      value: receipt,
      identity: OPENCLAW_INSTALL_RECEIPT_SCHEMA_VERSION,
      subject: "openclaw-install-receipt",
      digest,
      postState,
      actionResults,
      finalization,
    });
  } catch (error) {
    if (error?.code === "AGENTMO_OPENCLAW_INSTALL_RECEIPT_EVIDENCE_REJECTED") {
      throw error;
    }
    fail("AGENTMO_OPENCLAW_INSTALL_RECEIPT_EVIDENCE_REJECTED");
  } finally {
    seen.delete(closureKey);
    await ledger?.close().catch(() => {});
  }
}

function admitBinding(binding, subject) {
  return admit(binding.filePath, binding.digest, subject);
}

function assertSensitiveDecisions(plan, decisions, context) {
  if (decisions.length !== plan.sensitiveActions.length) {
    fail("AGENTMO_OPENCLAW_INSTALL_SENSITIVE_AUTHORITY_REJECTED");
  }
  const ids = new Set();
  for (const [index, decision] of decisions.entries()) {
    const action = plan.sensitiveActions[index];
    if (ids.has(decision.action?.actionId)
      || !validateOpenClawSensitiveActionDecision(
        decision,
        { ...context, action },
      ).ok) {
      fail("AGENTMO_OPENCLAW_INSTALL_SENSITIVE_AUTHORITY_REJECTED");
    }
    ids.add(decision.action.actionId);
  }
}

function assertCanonicalDecisions({
  plan,
  approval,
  decisions,
  conflictApproval,
  now,
  authorityReservation,
}) {
  if (!validateOpenClawInstallDecision(approval, {
    plan,
    now,
    authorityReservation,
  }).ok
    || !validateOpenClawInstallDecision(conflictApproval, {
      plan,
      now,
      authorityReservation,
    }).ok
    || decisions.some((decision, index) => (
      !validateOpenClawInstallDecision(decision, {
        plan,
        action: plan.sensitiveActions[index],
        now,
        authorityReservation,
      }).ok
    ))) {
    fail("AGENTMO_OPENCLAW_INSTALL_AUTHORITY_RESERVATION_REJECTED");
  }
}

function assertAllRepeatArchiveClosure(binding, authorities) {
  if (authorities.some((authority) => !same(authority.archiveBinding, binding))) {
    fail("AGENTMO_OPENCLAW_INSTALL_ARCHIVE_CLOSURE_MISMATCH");
  }
}

function assertCarrierAndProbeBindings(carrier, probe, plan) {
  if (probe?.archiveBinding
    && !same(probe.archiveBinding, plan.archiveBinding)) {
    fail("AGENTMO_OPENCLAW_INSTALL_ARCHIVE_CLOSURE_MISMATCH");
  }
  if (carrier.target?.id
    && carrier.target.id !== plan.target.targetId) {
    fail("AGENTMO_OPENCLAW_INSTALL_TARGET_MISMATCH");
  }
}

async function observeOperations(safeFs, operations) {
  return Promise.all(operations.map(async (operation) => {
    const observed = await safeFs.observe(operation.path);
    const safeFile = ["absent", "observed"].includes(observed.disposition);
    return Object.freeze({
      path: operation.path,
      digest: observed.digest ?? null,
      fileIdentity: safeFsIdentity(observed),
      parentIdentity: safeFsParentIdentity(observed),
      safeFile,
      disposition: observed.disposition,
    });
  }));
}

function assertConflictSet(plan, approval, observations) {
  const current = plan.conflicts.map((conflict) => {
    const observed = observations.find(({ path: candidate }) => candidate === conflict.path);
    return {
      path: conflict.path,
      currentDigest: observed?.digest,
      desiredDigest: conflict.desiredDigest,
      action: conflict.action,
    };
  });
  if (!same(current, plan.conflicts)
    || (plan.conflicts.length > 0 && !same(approval?.conflicts, current))) {
    fail("AGENTMO_OPENCLAW_INSTALL_CONFLICT_SET_CHANGED");
  }
}

async function applyOperation({ safeFs, operation, before, archive }) {
  const desired = operation.sourcePath === null
    ? null
    : archive.contents.get(operation.sourcePath);
  const basisMatches = before.safeFile
    && same(before.parentIdentity, operation.retainedParentIdentity)
    && same(before.fileIdentity, operation.retainedFileIdentity)
    && before.digest === operation.currentDigest;
  if (!basisMatches || operation.conflict !== "none") {
    return {
      path: operation.path,
      operation: operation.operation,
      createdByAttempt: false,
      outcome: "preserved",
      observedDigest: before.digest,
      observedFileIdentity: before.fileIdentity,
      reason: "ownership-or-identity-mismatch",
    };
  }
  if (["patch", "remove"].includes(operation.operation)
    && plainObject(operation.configPatch)
    && before.fileIdentity !== null) {
    return {
      path: operation.path,
      operation: operation.operation,
      createdByAttempt: false,
      outcome: "pending-official",
      observedDigest: before.digest,
      observedFileIdentity: before.fileIdentity,
      reason: null,
    };
  }
  if (operation.operation !== "write"
    || !Buffer.isBuffer(desired)
    || digestRawBytes(desired) !== operation.desiredDigest
    || before.fileIdentity !== null) {
    return {
      path: operation.path,
      operation: operation.operation,
      createdByAttempt: false,
      outcome: "preserved",
      observedDigest: before.digest,
      observedFileIdentity: before.fileIdentity,
      reason: "unsupported-or-non-create-operation",
    };
  }
  const created = await safeFs.createOnly(
    operation.path,
    desired,
    archive.binding.members.find(
      ({ relativePath }) => relativePath === operation.sourcePath,
    ).mode,
  );
  if (created.disposition !== "created") {
    return {
      path: operation.path,
      operation: operation.operation,
      createdByAttempt: false,
      outcome: "preserved",
      observedDigest: before.digest,
      observedFileIdentity: before.fileIdentity,
      reason: created.reason ?? "create-only-publication-refused",
    };
  }
  const after = await safeFs.observe(operation.path);
  const afterIdentity = safeFsIdentity(after);
  if (after.disposition !== "observed"
    || after.digest !== operation.desiredDigest
    || !same(afterIdentity, {
      device: created.device,
      inode: created.inode,
    })) {
    fail("AGENTMO_OPENCLAW_INSTALL_POST_OBSERVATION_FAILED");
  }
  return {
    path: operation.path,
    operation: operation.operation,
    createdByAttempt: true,
    outcome: "applied",
    observedDigest: after.digest,
    observedFileIdentity: afterIdentity,
    desiredDigest: operation.desiredDigest,
  };
}

async function recoverAppliedOperations(safeFs, applied) {
  const preserved = [];
  for (const entry of applied.filter(({ createdByAttempt }) => createdByAttempt)) {
    const observed = await safeFs.observe(entry.path);
    preserved.push({
      path: entry.path,
      observedDigest: observed.digest ?? null,
      reason: observed.disposition === "observed"
        && observed.digest === entry.desiredDigest
        && same(safeFsIdentity(observed), entry.observedFileIdentity)
        ? "published-asset-preserved"
        : "automatic-recovery-revalidation-mismatch",
    });
  }
  return {
    removed: [],
    preserved,
  };
}

function buildJournal(
  plan,
  predecessor,
  observations,
  attemptId,
  authorityReservation,
) {
  const value = {
    schemaVersion: "agentmo.openclaw-install-private-journal.v1",
    attemptId,
    lifecycle: plan.lifecycle,
    installPlanDigest: plan.installPlanDigest,
    archiveBinding: plan.archiveBinding,
    authorityReservation: {
      markerSetDigest: authorityReservation.markerSetDigest,
      markers: authorityReservation.markers.map((marker) => ({
        family: marker.family,
        path: marker.path,
        digest: marker.digest,
        nonceDigest: marker.nonceDigest,
        decisionDigest: marker.decisionDigest,
        actionDigest: marker.actionDigest,
        conflictSetDigest: marker.conflictSetDigest,
        device: marker.device,
        inode: marker.inode,
        status: marker.status,
      })),
    },
    predecessor,
    observations,
    valuesPersisted: false,
    rawOutputPersisted: false,
  };
  assertPersistable(value, { subject: "openclaw-install-private-journal" });
  return value;
}

async function writePrivateJournal(safeFs, relativePath, journal, status) {
  const bytes = Buffer.from(serializePersistableJson(journal, {
    subject: "openclaw-install-private-journal",
  }), "utf8");
  const digest = digestRawBytes(bytes);
  if (status === "exact-resume") {
    const observed = await safeFs.observe(relativePath);
    if (observed.disposition !== "observed"
      || observed.digest !== digest
      || observed.mode !== "600"
      || observed.uid !== String(process.getuid?.() ?? -1)
      || observed.size !== String(bytes.length)) {
      fail("AGENTMO_OPENCLAW_AUTHORITY_RECOVERY_REQUIRED");
    }
    return digest;
  }
  const result = await safeFs.createOnly(relativePath, bytes, 0o600);
  if (result.disposition !== "created") {
    fail("AGENTMO_OPENCLAW_INSTALL_JOURNAL_EXISTS");
  }
  if (result.digest !== digest) {
    fail("AGENTMO_OPENCLAW_INSTALL_JOURNAL_EXISTS");
  }
  return digest;
}

async function publishExecutionEvidence({
  ledger,
  targetSession,
  attemptId,
  plan,
  planAdmission,
  journal,
  journalDigest,
  targetDescriptorAdmission,
  probe,
  authorityReservation,
  decisions,
  decisionAdmissions,
  externalResults,
  predecessor,
}) {
  const planSource = provenance(planAdmission);
  const journalSource = {
    identity: journal.schemaVersion,
    subject: "openclaw-install-private-journal",
    digest: journalDigest,
  };
  const actionResults = [];
  for (const [index, action] of plan.sensitiveActions.entries()) {
    const decision = decisions[index];
    const raw = externalResults[index] ?? notAttemptedOfficialResult(
      action,
      decision,
      "prior-effect-incomplete",
    );
    actionResults.push(await publishOpenClawOfficialActionResultEvidence({
      ledger,
      attemptId,
      plan,
      planSource,
      probe,
      action,
      decision,
      decisionSource: provenance(decisionAdmissions[index]),
      authorityReservation,
      result: raw,
    }));
  }
  const postState = await publishOpenClawInstallPostStateEvidence({
    ledger,
    targetSession,
    attemptId,
    plan,
    planSource,
    journalSource,
    targetDescriptorSource: provenance(targetDescriptorAdmission),
  });
  const finalization = await publishOpenClawInstallFinalizationEvidence({
    ledger,
    attemptId,
    plan,
    planSource,
    probe,
    authorityReservation,
    postState,
    actionResults,
    predecessor: PREDECESSOR_FINALIZATIONS.get(predecessor) ?? null,
  });
  return freeze({ postState, actionResults, finalization });
}

function buildReceipt({
  plan,
  predecessor,
  planAdmission,
  targetDescriptorAdmission,
  probeAdmission,
  probe,
  approvalAdmission,
  decisionAdmissions,
  conflictApprovalAdmission,
  authorityReservation,
  journal,
  journalDigest,
  evidence,
}) {
  const approvals = {
    ordinary: receiptDecisionBinding("ordinary", approvalAdmission),
    sensitive: decisionAdmissions.map((admission) => (
      receiptDecisionBinding("sensitive", admission)
    )),
    conflict: receiptDecisionBinding(
      "conflict",
      conflictApprovalAdmission,
    ),
  };
  const derived = deriveOpenClawInstallReceiptEvidence({
    plan,
    journal,
    postState: evidence.postState,
    actionResults: evidence.actionResults,
    finalization: evidence.finalization,
    approvals,
    probe,
  });
  const receipt = {
    schemaVersion: OPENCLAW_INSTALL_RECEIPT_SCHEMA_VERSION,
    status: derived.status,
    lifecycle: plan.lifecycle,
    authorityLedger: {
      installPlan: {
        artifact: provenance(planAdmission),
        installPlanDigest: plan.installPlanDigest,
      },
      archive: structuredClone(plan.archiveBinding),
      target: structuredClone(plan.target),
      targetDescriptor: provenance(targetDescriptorAdmission),
      probe: {
        artifact: structuredClone(probeAdmission),
        fingerprintDigest: probe.fingerprintDigest,
        executableDigest: probe.cli.executableDigest,
      },
      journal: {
        identity: journal.schemaVersion,
        subject: "openclaw-install-private-journal",
        digest: journalDigest,
      },
      attempt: {
        attemptId: authorityReservation.attemptId,
        attemptDigest: digestRawBytes(Buffer.from(
          authorityReservation.attemptId,
          "utf8",
        )),
      },
    },
    approvals,
    nonceConsumption: derived.nonceConsumption,
    predecessor,
    lineage: lineage(plan.lifecycle, predecessor),
    managedResults: derived.managedResults,
    externalResults: derived.externalResults,
    postEffectEvidence: derived.postEffectEvidence,
    preservedAssets: derived.preservedAssets,
    recovery: derived.recovery,
    incompleteReasons: derived.incompleteReasons,
    certificationBoundary: {
      lifecycleEvidenceOnly: true,
      runtime: false,
      domain: false,
      birth: false,
      delivery: false,
      production: false,
      widerOpenClawCompatibility: false,
    },
  };
  const receiptValidation = validateOpenClawInstallReceipt(receipt);
  if (!receiptValidation.ok) {
    fail("AGENTMO_OPENCLAW_INSTALL_RECEIPT_INVALID");
  }
  return freeze(receipt);
}

function receiptDecisionBinding(family, admission) {
  const decision = admission.value;
  const action = family === "sensitive" ? decision.action : null;
  return {
    family,
    artifact: provenance(admission),
    decisionDigest: digestOpenClawReceiptValue(
      decision,
      "openclaw-install-decision",
    ),
    nonceDigest: digestRawBytes(Buffer.from(decision.useNonce, "utf8")),
    actionId: action?.actionId ?? null,
    actionDigest: action === null
      ? null
      : digestOpenClawReceiptValue(action, "openclaw-install-decision"),
    conflictSetDigest: family === "conflict"
      ? digestOpenClawReceiptValue(decision.conflicts)
      : null,
  };
}

function receiptValidationContext({
  planAdmission,
  targetDescriptorAdmission,
  probeAdmission,
  probe,
  approvalAdmission,
  decisionAdmissions,
  conflictApprovalAdmission,
  journal,
  journalDigest,
  evidence,
}) {
  return {
    installPlan: planAdmission.value,
    installPlanSource: provenance(planAdmission),
    ordinaryApproval: approvalAdmission.value,
    ordinaryApprovalSource: provenance(approvalAdmission),
    sensitiveDecisions: decisionAdmissions.map(({ value }) => value),
    sensitiveDecisionSources: decisionAdmissions.map(provenance),
    conflictApproval: conflictApprovalAdmission.value,
    conflictApprovalSource: provenance(conflictApprovalAdmission),
    journal,
    journalSource: {
      identity: journal.schemaVersion,
      subject: "openclaw-install-private-journal",
      digest: journalDigest,
    },
    probe,
    probeSource: structuredClone(probeAdmission),
    targetDescriptor: targetDescriptorAdmission.value,
    targetDescriptorSource: provenance(targetDescriptorAdmission),
    postState: evidence.postState,
    actionResults: evidence.actionResults,
    finalization: evidence.finalization,
  };
}

function officialResultSucceeded(value) {
  if (!plainObject(value)) return false;
  if (value.route === "official-openclaw-auth") return false;
  return value.route === "official-openclaw-config-patch"
    && value.publicationDisposition === "replaced"
    && value.publication?.disposition === "replaced"
    && value.publication?.guarantee === "identity-bound-durable-write"
    && value.publication?.digest === value.resultDigest
    && value.base?.digest === value.baseDigest
    && value.result?.digest === value.resultDigest
    && same(value.base?.fileIdentity, value.result?.fileIdentity)
    && value.dryRun?.exitCode === 0
    && value.dryRun?.timedOut === false
    && value.dryRun?.outputLimitExceeded === false
    && value.dryRun?.processStarted === true
    && value.dryRun?.processGroupClosed === true
    && value.dryRun?.quiescenceVerified === true
    && value.dryRun?.failureCode === null
    && value.actual?.exitCode === 0
    && value.actual?.timedOut === false
    && value.actual?.outputLimitExceeded === false
    && value.actual?.processStarted === true
    && value.actual?.processGroupClosed === true
    && value.actual?.quiescenceVerified === true
    && value.actual?.failureCode === null
    && value.processGroupFacts?.dryRun?.processGroupClosed === true
    && value.processGroupFacts?.dryRun?.quiescenceVerified === true
    && value.processGroupFacts?.actual?.processGroupClosed === true
    && value.processGroupFacts?.actual?.quiescenceVerified === true
    && DIGEST_PATTERN.test(value.resultDigest ?? "");
}

function officialResultUnsupported(value) {
  if (!plainObject(value) || value.disposition !== "unsupported") return false;
  if (value.route === "official-openclaw-auth") {
    return value.unsupportedReason
      === "phase4-credential-state-proof-unavailable"
      && value.credentialPresent === false
      && value.processStarted === false;
  }
  return value.route === "official-openclaw-config-patch"
    && value.unsupportedReason
      === "platform-fd-config-transport-unavailable"
    && value.publicationDisposition === "not-attempted"
    && value.processGroupFacts?.dryRun?.processStarted === false
    && value.processGroupFacts?.actual?.processStarted === false;
}

function notAttemptedOfficialResult(action, decision, reason) {
  return freeze({
    route: action.kind === "credential"
      ? "official-openclaw-auth"
      : "official-openclaw-config-patch",
    disposition: "not-attempted",
    failureCode: boundedReasonCode(reason, "prior-effect-incomplete"),
    actionDigest: digestOpenClawReceiptValue(
      action,
      "openclaw-install-decision",
    ),
    decisionDigest: digestOpenClawReceiptValue(
      decision,
      "openclaw-install-decision",
    ),
    processStarted: false,
    processGroupClosed: true,
    quiescenceVerified: true,
    rawOutputPersisted: false,
  });
}

function failedOfficialResult(action, decision, reason) {
  return freeze({
    route: action.kind === "credential"
      ? "official-openclaw-auth"
      : "official-openclaw-config-patch",
    disposition: "failed",
    failureCode: boundedReasonCode(reason, "official-action-failed"),
    actionDigest: digestOpenClawReceiptValue(
      action,
      "openclaw-install-decision",
    ),
    decisionDigest: digestOpenClawReceiptValue(
      decision,
      "openclaw-install-decision",
    ),
    processStarted: true,
    processGroupClosed: false,
    quiescenceVerified: false,
    rawOutputPersisted: false,
  });
}

function proposalOnlyExecutableBinding(openClawTargetRoot, probe) {
  const executable = probe.target?.memberDigests?.find(
    ({ role }) => role === "executable",
  );
  if (!plainObject(executable)
    || !portableRelativePath(executable.relativePath)
    || executable.sha256 !== probe.cli?.executableDigest) {
    fail("AGENTMO_OPENCLAW_INSTALL_OFFICIAL_ACTION_REQUIRED");
  }
  return {
    path: path.resolve(openClawTargetRoot, executable.relativePath),
    digest: executable.sha256,
  };
}

function boundedReasonCode(value, fallback) {
  const candidate = typeof value === "string"
    ? value.toLowerCase().replace(/[^a-z0-9-]+/gu, "-").replace(/^-+|-+$/gu, "")
    : "";
  return /^[a-z][a-z0-9-]{0,127}$/u.test(candidate)
    ? candidate
    : fallback;
}

function lineage(lifecycle, predecessor) {
  if (lifecycle === "install") {
    return {
      sequence: 0,
      predecessorReceiptDigest: null,
      selectedPredecessorReceiptDigest: null,
    };
  }
  const currentSequence = PREDECESSOR_SEQUENCES.get(predecessor);
  if (!Number.isSafeInteger(currentSequence) || currentSequence < 0) {
    fail("AGENTMO_OPENCLAW_INSTALL_PREDECESSOR_REJECTED");
  }
  return {
    sequence: currentSequence + 1,
    predecessorReceiptDigest: predecessor.currentReceipt.digest,
    selectedPredecessorReceiptDigest: lifecycle === "rollback"
      ? predecessor.selectedPredecessorReceipt.digest
      : null,
  };
}

function provenance(admission) {
  return {
    identity: admission.identity,
    subject: admission.subject,
    digest: admission.digest,
  };
}

function boundedExternalResult(action, value) {
  if (!plainObject(value)
    || !Number.isSafeInteger(value.exitCode)
    || typeof value.timedOut !== "boolean"
    || value.exitCode !== 0
    || value.timedOut) {
    fail("AGENTMO_OPENCLAW_INSTALL_EXTERNAL_RESULT_REJECTED");
  }
  return Object.freeze({
    actionId: action.actionId,
    exitCode: value.exitCode,
    timedOut: value.timedOut,
    rawOutputPersisted: false,
  });
}

function dedupePreserved(values) {
  const byPath = new Map();
  for (const value of values) {
    if (!byPath.has(value.path)) byPath.set(value.path, value);
  }
  return [...byPath.values()].sort((left, right) => (
    Buffer.from(left.path).compare(Buffer.from(right.path))
  ));
}

function receiptEvidenceAuthorityOptions(options, authorityRootBinding) {
  return {
    openClawTargetRoot: options.openClawTargetRoot,
    helperPath: options.helperPath,
    receiptPath: options.receiptPath,
    receiptDigest: options.receiptDigest,
    authorityRootBinding,
  };
}

async function deriveOpenClawAuthorityStateRoot(options = {}) {
  if (!plainObject(options)
    || !sameKeys(options, [
      "openClawTargetRoot",
      "targetDescriptorDigest",
    ])
    || !path.isAbsolute(options.openClawTargetRoot ?? "")
    || !DIGEST_PATTERN.test(options.targetDescriptorDigest ?? "")) {
    fail("AGENTMO_OPENCLAW_AUTHORITY_STATE_ROOT_BINDING_REJECTED");
  }
  let canonicalTargetRoot;
  let targetStats;
  try {
    canonicalTargetRoot = await realpath(options.openClawTargetRoot);
    targetStats = await lstat(canonicalTargetRoot, { bigint: true });
  } catch {
    fail("AGENTMO_OPENCLAW_AUTHORITY_STATE_ROOT_BINDING_REJECTED");
  }
  if (!targetStats.isDirectory() || targetStats.isSymbolicLink()) {
    fail("AGENTMO_OPENCLAW_AUTHORITY_STATE_ROOT_BINDING_REJECTED");
  }
  return path.join(
    path.dirname(canonicalTargetRoot),
    `.agentmo-openclaw-authority-${options.targetDescriptorDigest.slice(
      "sha256:".length,
    )}`,
  );
}

function assertApplyOptions(options) {
  if (!plainObject(options)
    || Object.keys(options).some((key) => !PUBLIC_KEYS.includes(key))
    || PUBLIC_KEYS.filter((key) => ![
      "conflictApprovalPath",
      "conflictApprovalDigest",
      "absentGenesisPath",
      "absentGenesisDigest",
      "currentReceiptPath",
      "currentReceiptDigest",
      "currentReceiptCompanions",
      "selectedPredecessorReceiptPath",
      "selectedPredecessorReceiptDigest",
      "selectedPredecessorReceiptCompanions",
      "selectedPredecessorArchivePath",
      "selectedPredecessorArchiveDigest",
    ].includes(key)).some((key) => !Object.hasOwn(options, key))
    || !Array.isArray(options.sensitiveDecisions)
    || options.sensitiveDecisions.some((item) => (
      !plainObject(item)
      || !sameKeys(item, ["filePath", "digest"])
      || typeof item.filePath !== "string"
      || !DIGEST_PATTERN.test(item.digest ?? "")
    ))
    || typeof options.conflictApprovalPath !== "string"
    || !DIGEST_PATTERN.test(options.conflictApprovalDigest ?? "")
    || !path.isAbsolute(options.targetRoot ?? "")
    || !path.isAbsolute(options.openClawTargetRoot ?? "")
    || !path.isAbsolute(options.authorityStateRoot ?? "")
    || !path.isAbsolute(options.authorityRootBindingPath ?? "")
    || !DIGEST_PATTERN.test(options.authorityRootBindingDigest ?? "")
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(
      options.attemptId ?? "",
    )
    || typeof options.outputPath !== "string"
    || options.outputPath.length === 0) {
    fail("AGENTMO_OPENCLAW_INSTALL_ARGUMENTS_REJECTED");
  }
  for (const key of [
    "targetCarrierAdmissionDigest",
    "archiveDigest",
    "blueprintDigest",
    "buildContractDigest",
    "planApprovalDigest",
    "targetDescriptorDigest",
    "probeDigest",
    "installPlanDigest",
    "installApprovalDigest",
    "receiptDigest",
  ]) {
    if (!DIGEST_PATTERN.test(options[key] ?? "")) {
      fail("AGENTMO_OPENCLAW_INSTALL_ARGUMENTS_REJECTED");
    }
  }
  for (const key of [
    "conflictApprovalPath",
    "conflictApprovalDigest",
    "absentGenesisPath",
    "absentGenesisDigest",
    "currentReceiptPath",
    "currentReceiptDigest",
    "currentReceiptCompanions",
    "selectedPredecessorReceiptPath",
    "selectedPredecessorReceiptDigest",
    "selectedPredecessorReceiptCompanions",
    "selectedPredecessorArchivePath",
    "selectedPredecessorArchiveDigest",
  ]) {
    if (!Object.hasOwn(options, key)) options[key] = null;
  }
  const currentRequired = options.currentReceiptPath !== null
    || options.currentReceiptDigest !== null;
  const selectedRequired = options.selectedPredecessorReceiptPath !== null
    || options.selectedPredecessorReceiptDigest !== null;
  if ((currentRequired
    ? !validReceiptCompanionBindings(options.currentReceiptCompanions)
    : options.currentReceiptCompanions !== null)
    || (selectedRequired
      ? !validReceiptCompanionBindings(
        options.selectedPredecessorReceiptCompanions,
      )
      : options.selectedPredecessorReceiptCompanions !== null)) {
    fail("AGENTMO_OPENCLAW_INSTALL_ARGUMENTS_REJECTED");
  }
}

function validReceiptCompanionBindings(value) {
  if (!plainObject(value)
    || !sameKeys(value, [
      "installPlan",
      "ordinaryApproval",
      "sensitiveDecisions",
      "conflictApproval",
      "journal",
      "probe",
      "targetDescriptor",
      "packageManifest",
      "targetCarrierAdmission",
      "blueprint",
      "buildContract",
      "planApproval",
      "predecessor",
    ])
    || !Array.isArray(value.sensitiveDecisions)) {
    return false;
  }
  const bindings = [
    value.installPlan,
    value.ordinaryApproval,
    ...value.sensitiveDecisions,
    value.conflictApproval,
    value.journal,
    value.probe,
    value.targetDescriptor,
    value.packageManifest,
    value.targetCarrierAdmission,
    value.blueprint,
    value.buildContract,
    value.planApproval,
  ];
  const predecessorValid = value.predecessor === null
    || (plainObject(value.predecessor)
      && sameKeys(value.predecessor, ["filePath", "digest", "companions"])
      && typeof value.predecessor.filePath === "string"
      && value.predecessor.filePath.length > 0
      && DIGEST_PATTERN.test(value.predecessor.digest ?? "")
      && plainObject(value.predecessor.companions));
  return predecessorValid && bindings.every((binding) => (
    plainObject(binding)
    && sameKeys(binding, ["filePath", "digest"])
    && typeof binding.filePath === "string"
    && binding.filePath.length > 0
    && DIGEST_PATTERN.test(binding.digest ?? "")
  ))
    && new Set(value.sensitiveDecisions.map(({ filePath }) => filePath)).size
      === value.sensitiveDecisions.length
    && new Set(value.sensitiveDecisions.map(({ digest }) => digest)).size
      === value.sensitiveDecisions.length;
}

export function validateOpenClawInstallReceiptCompanionBindings(value) {
  return Object.freeze({ ok: validReceiptCompanionBindings(value) });
}

function assertReceiptEvidenceAuthorityOptions(value) {
  if (!plainObject(value)
    || !sameKeys(value, [
      "openClawTargetRoot",
      "helperPath",
      "receiptPath",
      "receiptDigest",
      "authorityRootBinding",
    ])
    || !path.isAbsolute(value.openClawTargetRoot ?? "")
    || !path.isAbsolute(value.helperPath ?? "")
    || !path.isAbsolute(value.receiptPath ?? "")
    || !DIGEST_PATTERN.test(value.receiptDigest ?? "")
    || !validateOpenClawAuthorityRootBinding(value.authorityRootBinding).ok) {
    fail("AGENTMO_OPENCLAW_INSTALL_ARGUMENTS_REJECTED");
  }
}

async function assertAbsent(filePath, code) {
  try {
    await access(filePath);
    fail(code);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function strictBase64(value) {
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) {
    fail("AGENTMO_OPENCLAW_INSTALL_ARCHIVE_MEMBER_DRIFT");
  }
  return bytes;
}

function sameProbeBasisValue(value) {
  return value?.fingerprintDigest ?? value?.probeFingerprintDigest ?? null;
}

function sameProbeBasis(current, approved, plan) {
  const currentDigest = sameProbeBasisValue(current);
  const approvedDigest = sameProbeBasisValue(approved);
  return currentDigest !== null
    && currentDigest === approvedDigest
    && currentDigest === plan.target.probeFingerprintDigest
    && current?.status === "compatible"
    && approved?.status === "compatible"
    && isDeepStrictEqual(current, approved);
}

function validIdentity(value) {
  return plainObject(value)
    && sameKeys(value, ["device", "inode"])
    && /^\d+$/u.test(value.device ?? "")
    && /^\d+$/u.test(value.inode ?? "");
}

function safeFsIdentity(observed) {
  if (observed?.disposition !== "observed"
    || !/^\d+$/u.test(observed.device ?? "")
    || !/^\d+$/u.test(observed.inode ?? "")) {
    return null;
  }
  return {
    device: observed.device,
    inode: observed.inode,
  };
}

function safeFsParentIdentity(observed) {
  if (!["absent", "observed"].includes(observed?.disposition)
    || !/^\d+$/u.test(observed.parentDevice ?? "")
    || !/^\d+$/u.test(observed.parentInode ?? "")) {
    return null;
  }
  return {
    device: observed.parentDevice,
    inode: observed.parentInode,
  };
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function portableRelativePath(value) {
  return typeof value === "string"
    && value.length > 0
    && !value.includes("\0")
    && !value.includes("\\")
    && !path.posix.isAbsolute(value)
    && value.split("/").every((part) => (
      part.length > 0 && part !== "." && part !== ".."
    ));
}

function same(left, right) {
  try {
    return serializePersistableJson(left, { subject: "openclaw-install-compare" })
      === serializePersistableJson(right, { subject: "openclaw-install-compare" });
  } catch {
    return false;
  }
}

function plainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype
      || Object.getPrototypeOf(value) === null);
}

function sameKeys(value, keys) {
  return plainObject(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function fail(code) {
  throw new OpenClawInstallTransactionError(code);
}
