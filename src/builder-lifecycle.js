import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { digestRawBytes } from "./artifact-admission.js";
import {
  appendAppendOnlyRecord,
  readAppendOnlyAuthority,
} from "./builder-append-only-authority.js";
import {
  abortBuilderCheckpointUpgrade,
  admitBuilderCheckpointLifecycleAuthority,
  completeBuilderCheckpointUpgrade,
  BuilderCheckpointError,
  fenceBuilderCheckpointDeactivation,
  loadBuilderCheckpointHead,
  reserveBuilderCheckpointUpgrade,
  releaseBuilderCheckpointDeactivationFence,
  upgradeBuilderCheckpointProtocol,
} from "./builder-checkpoint.js";
import {
  BUILDER_ACTIVATED_RECEIPT_SCHEMA_VERSION,
  BUILDER_CHECKPOINT_PATH,
  BUILDER_INSTALL_ATTEMPT_AUTHORITY_PATH,
  BUILDER_INSTALL_MARKER_PATH,
  BUILDER_INSTALL_MARKER_SCHEMA_VERSION,
  BUILDER_INSTALL_RECEIPT_PATH,
  BUILDER_INSTALL_RECEIPT_SCHEMA_VERSION,
  BUILDER_PLUGIN_ROOT,
  BUILDER_PROJECT_AGENT_PATH,
  buildBuilderInstallPlanBasis,
  computeBuilderProjectScopeDigest,
  prepareBuilderInstallArtifacts,
} from "./builder-install.js";
import {
  buildCodexConsumerEntry,
  buildCodexHostSelector,
  digestCodexConsumerEntry,
} from "./builder-codex-host.js";
import {
  BUILDER_PLUGIN_FILES,
  loadBuilderPackage,
  loadVerifiedBootstrapSnapshotPackage,
  readBoundedNoFollowFile,
} from "./builder-package.js";
import { assertBuilderPlatform } from "./builder-platform.js";
import { runBuilderPosixEffect } from "./builder-posix-effect.js";
import { serializePersistableJson } from "./persistability.js";

const MAX_FILE_BYTES = 256 * 1024;
const LIFECYCLE_QUARANTINE_PATH = ".agentmo/builder/lifecycle-quarantine";
const ACTIVE_QUARANTINE_PATTERN = /^\.active-[a-f0-9]{32}$/u;
const RETAINED_QUARANTINE_PATTERN = /^\.retained-[a-f0-9]{32}$/u;
const RETAINED_EVIDENCE_PATTERN = /^\.agentmo-lifecycle-retained-[a-f0-9]{32}$/u;
const QUARANTINE_ENTRY_PATTERN = /^[a-f0-9]{32}\.(?:anchor|entry)$/u;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const EXCLUSIVE_OWNERSHIP = new Set([
  "exclusive-marker",
  "exclusive-plugin-file",
  "exclusive-project-agent",
]);
const EXPECTED_FILES = Object.freeze([
  BUILDER_INSTALL_MARKER_PATH,
  BUILDER_PROJECT_AGENT_PATH,
].sort());
const LIFECYCLE_AUTHORITY_PATH = ".agentmo/builder/lifecycle-authority";
const IMMUTABLE_RELEASES_PATH = ".agentmo/builder/releases";
const LIFECYCLE_NAMESPACE = "builder-lifecycle";
const LIFECYCLE_EVENT_SCHEMA_VERSION = "agentmo.builder-lifecycle-event.v3";
const LEGACY_V2_LIFECYCLE_EVENT_SCHEMA_VERSION = "agentmo.builder-lifecycle-event.v2";
const RELEASE_RECEIPT_SCHEMA_VERSION = "agentmo.builder-release-receipt.v1";
const DEPRECATED_UNINSTALL_NOTICE = "`builder uninstall` is deprecated; AgentMo v1 performed non-delete `builder deactivate`.";
const CANONICAL_LIFECYCLE_MODULE_URL = new URL("./builder-lifecycle.js", import.meta.url).href;
const LIFECYCLE_APPEND_CAPABILITY = Object.freeze({});

// This predicate deliberately reveals only membership, never the opaque
// capability itself. The generic append-only writer uses it to keep the
// lifecycle namespace behind this module's planned transition APIs.
export function isBuilderLifecycleAuthorityAppendCapability(value) {
  return value === LIFECYCLE_APPEND_CAPABILITY;
}

// A query-suffixed module is useful for isolated reads and plans, but it must
// never become a second issuer for the shared lifecycle authority.  Mutations
// therefore run through the one literal, canonical module instance.
async function canonicalLifecycleMutationModule() {
  if (import.meta.url === CANONICAL_LIFECYCLE_MODULE_URL) return null;
  return import("./builder-lifecycle.js");
}

export class BuilderLifecycleError extends Error {
  constructor(code) {
    super("Builder lifecycle operation was rejected.");
    this.name = "BuilderLifecycleError";
    this.code = code;
  }
}

export async function planBuilderUpgrade(options = {}) {
  assertBuilderPlatform();
  return (await prepareV1Upgrade(options)).plan;
}

export async function applyBuilderUpgrade(options = {}) {
  const canonical = await canonicalLifecycleMutationModule();
  if (canonical !== null) return canonical.applyBuilderUpgrade(options);
  assertBuilderPlatform();
  return applyV1Upgrade(options);
}

// A reservation may outlive the process that created it.  This is deliberately
// an explicit operator action: callers must bind the predecessor receipt and
// the exact reserved plan, and the checkpoint layer independently re-admits
// the lifecycle authority before it will clear the reservation.
export async function abortBuilderUpgradeReservation(options = {}) {
  const canonical = await canonicalLifecycleMutationModule();
  if (canonical !== null) return canonical.abortBuilderUpgradeReservation(options);
  assertBuilderPlatform();
  if (!options || typeof options !== "object" || Array.isArray(options)
    || Object.keys(options).some((key) => ![
      "projectRoot",
      "expectedPlanDigest",
      "expectedReceiptDigest",
    ].includes(key))) {
    fail("AGENTMO_BUILDER_LIFECYCLE_UPGRADE_RECOVERY_REQUIRED");
  }
  const expectedReceiptDigest = requireExpectedReceiptDigest(options);
  if (!DIGEST_PATTERN.test(options.expectedPlanDigest ?? "")) {
    fail("AGENTMO_BUILDER_LIFECYCLE_PLAN_DIGEST_REQUIRED");
  }
  const projectRoot = await admitProjectRoot(options.projectRoot ?? process.cwd());
  const lifecycle = await readBuilderLifecycleState({ projectRoot });
  if (lifecycle.recoveryRequired !== null
    || lifecycle.status !== "active"
    || lifecycle.activeReceiptDigest !== expectedReceiptDigest) {
    fail("AGENTMO_BUILDER_LIFECYCLE_UPGRADE_RECOVERY_REQUIRED");
  }
  const aborted = await abortUncommittedCheckpointUpgradeReservation(
    projectRoot,
    lifecycle,
    options.expectedPlanDigest,
  );
  return deepFreeze({
    schemaVersion: "agentmo.builder-lifecycle-upgrade-recovery.v1",
    action: "upgrade",
    status: "aborted-reservation",
    changed: true,
    scope: "project",
    physicalDeletion: false,
    hostMutation: false,
    planDigest: options.expectedPlanDigest,
    receipt: {
      path: lifecycle.activeReceiptPath,
      digest: lifecycle.activeReceiptDigest,
    },
    lifecycle: {
      status: lifecycle.status,
      authorityHeadDigest: lifecycle.authorityHeadDigest,
    },
    checkpointDigest: aborted.digest,
    evidence: {
      level: "declared-ready",
      mechanismOnly: true,
      hostBehaviorVerified: false,
      domainQualityCertified: false,
    },
  });
}

export async function planBuilderUninstall(options = {}) {
  assertBuilderPlatform();
  const plan = await planBuilderDeactivate(options);
  return deepFreeze({
    ...plan,
    deprecatedAlias: "uninstall",
    migrationNotice: DEPRECATED_UNINSTALL_NOTICE,
  });
}

export async function applyBuilderUninstall(options = {}) {
  const canonical = await canonicalLifecycleMutationModule();
  if (canonical !== null) return canonical.applyBuilderUninstall(options);
  assertBuilderPlatform();
  const result = await applyBuilderDeactivate(options);
  return deepFreeze({
    ...result,
    deprecatedAlias: "uninstall",
    migrationNotice: DEPRECATED_UNINSTALL_NOTICE,
  });
}

export async function planBuilderDeactivate(options = {}) {
  assertBuilderPlatform();
  return (await prepareV1Deactivation(options)).plan;
}

export async function applyBuilderDeactivate(options = {}) {
  const canonical = await canonicalLifecycleMutationModule();
  if (canonical !== null) return canonical.applyBuilderDeactivate(options);
  assertBuilderPlatform();
  return applyV1Deactivation(options);
}

export async function planBuilderReactivate(options = {}) {
  assertBuilderPlatform();
  return (await prepareV1Reactivation(options)).plan;
}

export async function applyBuilderReactivate(options = {}) {
  const canonical = await canonicalLifecycleMutationModule();
  if (canonical !== null) return canonical.applyBuilderReactivate(options);
  assertBuilderPlatform();
  return applyV1Reactivation(options);
}

export async function planBuilderHostSelectorRemoval(options = {}) {
  assertBuilderPlatform();
  void options;
  fail("AGENTMO_BUILDER_V1_PHYSICAL_REMOVAL_UNSUPPORTED");
}

export async function applyBuilderHostSelectorRemoval(options = {}) {
  assertBuilderPlatform();
  void options;
  fail("AGENTMO_BUILDER_V1_PHYSICAL_REMOVAL_UNSUPPORTED");
}

export async function planBuilderHostProjectionMigration(options = {}) {
  assertBuilderPlatform();
  void options;
  fail("AGENTMO_BUILDER_V1_PHYSICAL_REMOVAL_UNSUPPORTED");
}

export async function applyBuilderHostProjectionMigration(options = {}) {
  assertBuilderPlatform();
  void options;
  fail("AGENTMO_BUILDER_V1_PHYSICAL_REMOVAL_UNSUPPORTED");
}

export async function planBuilderHostProjectionTransfer(options = {}) {
  assertBuilderPlatform();
  void options;
  fail("AGENTMO_BUILDER_V1_PHYSICAL_REMOVAL_UNSUPPORTED");
}

export async function applyBuilderHostProjectionTransfer(options = {}) {
  assertBuilderPlatform();
  void options;
  fail("AGENTMO_BUILDER_V1_PHYSICAL_REMOVAL_UNSUPPORTED");
}

export async function readBuilderLifecycleState(options = {}) {
  assertBuilderPlatform();
  const projectRoot = await admitProjectRoot(options.projectRoot ?? process.cwd());
  const immutableReleaseParentChain = await inspectV1ExistingCanonicalParentChain(
    projectRoot,
    resolveProjectPath(projectRoot, IMMUTABLE_RELEASES_PATH),
  );
  const scopeDigest = await computeBuilderProjectScopeDigest(projectRoot);
  const authority = await readAppendOnlyAuthority({
    projectRoot,
    relativeRoot: LIFECYCLE_AUTHORITY_PATH,
    namespace: LIFECYCLE_NAMESPACE,
  });
  const initial = await loadV1Genesis(projectRoot, scopeDigest);
  if (initial === null && authority.records.length === 0) {
    fail("AGENTMO_BUILDER_LIFECYCLE_RECEIPT_MISSING");
  }
  if (initial === null) fail("AGENTMO_BUILDER_LIFECYCLE_GENESIS_MISSING");

  let status = "active";
  let selected = initial;
  const receiptLineageDigests = [initial.digest];
  const tombstones = [];
  const transitions = [];
  for (const record of authority.records) {
    const event = admitV1LifecycleEvent(record.payload, scopeDigest);
    if (event.predecessorReceiptDigest !== selected.digest) {
      fail("AGENTMO_BUILDER_LIFECYCLE_CHAIN_INVALID");
    }
    if (event.action === "activate") {
      selected = await admitV1ActivatedSelection(projectRoot, event, initial);
      if (receiptLineageDigests.at(-1) !== selected.digest) {
        receiptLineageDigests.push(selected.digest);
      }
      status = "active";
    } else {
      if (event.receipt.digest !== selected.digest || event.receipt.path !== selected.path) {
        fail("AGENTMO_BUILDER_LIFECYCLE_CHAIN_INVALID");
      }
      status = "deactivated";
      tombstones.push(Object.freeze({
        sequence: record.sequence,
        digest: record.digest,
        receiptDigest: event.receipt.digest,
      }));
    }
    transitions.push(Object.freeze({
      sequence: record.sequence,
      digest: record.digest,
      action: event.action,
      invokedAs: event.invokedAs,
      receiptDigest: event.receipt.digest,
      checkpointCoordinationKind: event.coordination?.kind ?? null,
      checkpointUpgradeOperationId: event.coordination?.operationId ?? null,
    }));
  }
  return deepFreeze({
    schemaVersion: "agentmo.builder-lifecycle-state.v1",
    status,
    scopeDigest,
    activeReceiptDigest: selected.digest,
    activeReceiptPath: selected.path,
    activeReceipt: selected,
    genesisReceiptDigest: initial.digest,
    genesisReceiptPath: initial.path,
    genesisReceipt: initial.value,
    genesisReceiptIdentity: initial.receiptIdentity,
    genesisFiles: initial.admissionFiles,
    projectRootIdentity: immutableReleaseParentChain[0],
    immutableReleaseParentChain,
    receiptLineageDigests,
    authorityHeadDigest: authority.headDigest,
    headRecordDigest: authority.headRecordDigest,
    headOutcomeDigest: authority.headOutcomeDigest,
    transitions,
    tombstones,
    recoveryRequired: authority.recoveryRequired === null
      ? null
      : {
          sequence: authority.recoveryRequired.sequence,
          recordDigest: authority.recoveryRequired.recordDigest,
          operationId: authority.recoveryRequired.operationId,
        },
  });
}

async function prepareV1Deactivation(options) {
  const expectedReceiptDigest = requireExpectedReceiptDigest(options);
  const state = await readBuilderLifecycleState(options);
  if (state.activeReceiptDigest !== expectedReceiptDigest) {
    fail("AGENTMO_BUILDER_LIFECYCLE_RECEIPT_DIGEST_MISMATCH");
  }
  const alreadyDeactivated = state.status === "deactivated";
  const event = buildV1LifecycleEvent({
    action: "deactivate",
    invokedAs: "deactivate",
    state,
    selection: state.activeReceipt,
  });
  const basis = {
    schemaVersion: "agentmo.builder-lifecycle-plan-basis.v2",
    action: "deactivate",
    scope: "project",
    scopeDigest: state.scopeDigest,
    physicalDeletion: false,
    expectedReceiptDigest,
    authorityHeadDigest: state.authorityHeadDigest,
    event,
    alreadyDeactivated,
  };
  const plan = deepFreeze({
    schemaVersion: "agentmo.builder-lifecycle-plan.v2",
    action: "deactivate",
    mode: "preview",
    scope: "project",
    scopeDigest: state.scopeDigest,
    applicable: true,
    requiresExplicitApply: true,
    physicalDeletion: false,
    planDigest: digestJson(basis, "builder-lifecycle-plan-basis-v2"),
    current: {
      status: state.status,
      receiptDigest: state.activeReceiptDigest,
      receiptPath: state.activeReceiptPath,
      authorityHeadDigest: state.authorityHeadDigest,
    },
    operations: alreadyDeactivated ? [] : [
      {
        operation: "fence-checkpoint-authority",
        receiptDigest: state.activeReceiptDigest,
        physicalDeletion: false,
      },
      {
        operation: "append-tombstone",
        receiptDigest: state.activeReceiptDigest,
        physicalDeletion: false,
      },
    ],
    evidence: lifecycleProposalEvidence(),
  });
  return { state, event, plan };
}

async function applyV1Deactivation(options) {
  const prepared = await prepareV1Deactivation(options);
  assertV1PlanApproval(options, prepared.plan);
  if (prepared.state.status === "deactivated") {
    return lifecycleResult({
      action: "deactivate",
      status: "deactivated",
      changed: false,
      plan: prepared.plan,
      state: prepared.state,
    });
  }
  await fenceCheckpointBeforeDeactivation(
    options.projectRoot ?? process.cwd(),
    prepared.state,
  );
  const appended = await appendLifecycleAuthorityRecord({
    projectRoot: options.projectRoot ?? process.cwd(),
    relativeRoot: LIFECYCLE_AUTHORITY_PATH,
    namespace: LIFECYCLE_NAMESPACE,
    idempotencyKey: `deactivate:${prepared.state.headOutcomeDigest.slice("sha256:".length)}`,
    expectedHeadDigest: prepared.state.authorityHeadDigest,
    payload: prepared.event,
  });
  const state = await readBuilderLifecycleState(options);
  if (state.status !== "deactivated"
    || state.activeReceiptDigest !== prepared.state.activeReceiptDigest) {
    fail("AGENTMO_BUILDER_LIFECYCLE_POSTCONDITION_FAILED");
  }
  return lifecycleResult({
    action: "deactivate",
    status: "deactivated",
    changed: appended.changed,
    plan: prepared.plan,
    state,
  });
}

async function prepareV1Reactivation(options) {
  const expectedReceiptDigest = requireExpectedReceiptDigest(options);
  const state = await readBuilderLifecycleState(options);
  if (state.activeReceiptDigest !== expectedReceiptDigest) {
    fail("AGENTMO_BUILDER_LIFECYCLE_RECEIPT_DIGEST_MISMATCH");
  }
  const alreadyActive = state.status === "active";
  const event = buildV1LifecycleEvent({
    action: "activate",
    invokedAs: "reactivate",
    state,
    selection: state.activeReceipt,
  });
  const basis = {
    schemaVersion: "agentmo.builder-lifecycle-plan-basis.v2",
    action: "reactivate",
    scope: "project",
    scopeDigest: state.scopeDigest,
    physicalDeletion: false,
    expectedReceiptDigest,
    authorityHeadDigest: state.authorityHeadDigest,
    event,
    alreadyActive,
  };
  const plan = deepFreeze({
    schemaVersion: "agentmo.builder-lifecycle-plan.v2",
    action: "reactivate",
    mode: "preview",
    scope: "project",
    scopeDigest: state.scopeDigest,
    applicable: true,
    requiresExplicitApply: true,
    physicalDeletion: false,
    planDigest: digestJson(basis, "builder-lifecycle-plan-basis-v2"),
    current: {
      status: state.status,
      receiptDigest: state.activeReceiptDigest,
      receiptPath: state.activeReceiptPath,
      authorityHeadDigest: state.authorityHeadDigest,
    },
    operations: alreadyActive ? [] : [{
      operation: "append-activation",
      receiptDigest: state.activeReceiptDigest,
      physicalDeletion: false,
    }],
    evidence: lifecycleProposalEvidence(),
  });
  return { state, event, plan };
}

async function applyV1Reactivation(options) {
  const prepared = await prepareV1Reactivation(options);
  assertV1PlanApproval(options, prepared.plan);
  if (prepared.state.status === "active") {
    await releaseCheckpointFenceAfterReactivation(
      options.projectRoot ?? process.cwd(),
      prepared.state,
    );
    return lifecycleResult({
      action: "reactivate",
      status: "active",
      changed: false,
      plan: prepared.plan,
      state: prepared.state,
    });
  }
  const appended = await appendLifecycleAuthorityRecord({
    projectRoot: options.projectRoot ?? process.cwd(),
    relativeRoot: LIFECYCLE_AUTHORITY_PATH,
    namespace: LIFECYCLE_NAMESPACE,
    idempotencyKey: `reactivate:${prepared.state.headOutcomeDigest.slice("sha256:".length)}`,
    expectedHeadDigest: prepared.state.authorityHeadDigest,
    payload: prepared.event,
  });
  const state = await readBuilderLifecycleState(options);
  if (state.status !== "active"
    || state.activeReceiptDigest !== prepared.state.activeReceiptDigest) {
    fail("AGENTMO_BUILDER_LIFECYCLE_POSTCONDITION_FAILED");
  }
  await releaseCheckpointFenceAfterReactivation(
    options.projectRoot ?? process.cwd(),
    state,
  );
  return lifecycleResult({
    action: "reactivate",
    status: "active",
    changed: appended.changed,
    plan: prepared.plan,
    state,
  });
}

async function prepareV1Upgrade(options) {
  const expectedReceiptDigest = requireExpectedReceiptDigest(options);
  const state = await readBuilderLifecycleState(options);
  if (state.activeReceiptDigest !== expectedReceiptDigest) {
    fail("AGENTMO_BUILDER_LIFECYCLE_RECEIPT_DIGEST_MISMATCH");
  }
  if (state.status !== "active") fail("AGENTMO_BUILDER_REACTIVATION_REQUIRED");
  const currentPackage = await loadV1SelectedPackage(
    options.projectRoot ?? process.cwd(),
    state.activeReceipt,
  );
  const projection = await prepareBuilderInstallArtifacts(options);
  assertV1RuntimeCompatible(currentPackage, projection.release);
  const candidate = buildV1ImmutableReleaseCandidate(projection, state);
  const sameRelease = candidate.release.releaseDigest === state.activeReceipt.release.releaseDigest;
  const event = buildV1LifecycleEvent({
    action: "activate",
    invokedAs: "upgrade",
    state,
    selection: candidate.selection,
  });
  const operations = sameRelease
    ? []
    : [
        {
          operation: "reserve-checkpoint-upgrade",
          receiptDigest: state.activeReceiptDigest,
          successorReceiptDigest: candidate.selection.digest,
          physicalDeletion: false,
        },
        ...candidate.files.map((file) => ({
          operation: "publish-immutable",
          relativePath: file.relativePath,
          digest: file.digest,
        })),
        {
          operation: "append-activation",
          receiptDigest: candidate.selection.digest,
          physicalDeletion: false,
        },
      ];
  const basis = {
    schemaVersion: "agentmo.builder-lifecycle-plan-basis.v2",
    action: "upgrade",
    scope: "project",
    scopeDigest: state.scopeDigest,
    physicalDeletion: false,
    expectedReceiptDigest,
    authorityHeadDigest: state.authorityHeadDigest,
    desiredReceiptDigest: candidate.selection.digest,
    desiredReleaseDigest: candidate.release.releaseDigest,
    event,
    sameRelease,
  };
  const plan = deepFreeze({
    schemaVersion: "agentmo.builder-lifecycle-plan.v2",
    action: "upgrade",
    mode: "preview",
    scope: "project",
    scopeDigest: state.scopeDigest,
    applicable: true,
    requiresExplicitApply: true,
    physicalDeletion: false,
    planDigest: digestJson(basis, "builder-lifecycle-plan-basis-v2"),
    current: {
      status: state.status,
      receiptDigest: state.activeReceiptDigest,
      receiptPath: state.activeReceiptPath,
      authorityHeadDigest: state.authorityHeadDigest,
    },
    desired: {
      receiptDigest: sameRelease ? state.activeReceiptDigest : candidate.selection.digest,
      receiptPath: sameRelease ? state.activeReceiptPath : candidate.selection.path,
      release: candidate.release,
    },
    operations,
    evidence: lifecycleProposalEvidence(),
  });
  return { state, projection, candidate, event, sameRelease, plan };
}

async function applyV1Upgrade(options) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const recovered = await completeCommittedCheckpointUpgradeReservation(projectRoot);
  if (recovered !== null) {
    if (options.expectedReceiptDigest !== recovered.predecessorReceiptDigest
      || options.expectedPlanDigest !== recovered.planDigest) {
      fail("AGENTMO_BUILDER_LIFECYCLE_PLAN_CHANGED");
    }
    return lifecycleResult({
      action: "upgrade",
      status: "activated-successor",
      changed: false,
      plan: { planDigest: recovered.planDigest },
      state: recovered.state,
    });
  }
  const prepared = await prepareV1Upgrade(options);
  assertV1PlanApproval(options, prepared.plan);
  if (prepared.sameRelease) {
    await assertV1KnownParentChain(
      prepared.projection.projectRoot,
      prepared.state.immutableReleaseParentChain,
      "AGENTMO_BUILDER_LIFECYCLE_PLAN_CHANGED",
    );
    await assertCheckpointAllowsUpgrade(prepared.projection.projectRoot);
    return lifecycleResult({
      action: "upgrade",
      status: "active",
      changed: false,
      plan: prepared.plan,
      state: prepared.state,
    });
  }
  await assertV1UpgradePredecessor(prepared.projection.projectRoot, prepared.state);
  const reservation = await reserveCheckpointForUpgrade(
    prepared.projection.projectRoot,
    prepared.state,
    prepared.candidate.selection.digest,
    prepared.plan.planDigest,
  );
  await assertV1UpgradePredecessor(prepared.projection.projectRoot, prepared.state);
  const immutableParentLedger = createV1ImmutableParentLedger(
    prepared.state.immutableReleaseParentChain,
  );
  const publishedFiles = [];
  for (const file of prepared.candidate.files) {
    publishedFiles.push(await publishV1ImmutableFile(
      prepared.projection.projectRoot,
      file,
      immutableParentLedger,
    ));
  }
  const selection = deepFreeze({
    ...prepared.candidate.selection,
    files: publishedFiles,
  });
  const event = buildV1LifecycleEvent({
    action: "activate",
    invokedAs: "upgrade",
    state: prepared.state,
    selection,
    checkpointUpgradeOperationId: reservation?.value.hookDeactivationProtocol.operationId ?? null,
  });
  await assertV1UpgradePredecessor(prepared.projection.projectRoot, prepared.state);
  const appended = await appendLifecycleAuthorityRecord({
    projectRoot: prepared.projection.projectRoot,
    relativeRoot: LIFECYCLE_AUTHORITY_PATH,
    namespace: LIFECYCLE_NAMESPACE,
    idempotencyKey: reservation === null
      ? `activate:${selection.digest.slice("sha256:".length)}`
      : `upgrade:${reservation.value.hookDeactivationProtocol.operationId.slice("sha256:".length)}`,
    expectedHeadDigest: prepared.state.authorityHeadDigest,
    payload: event,
  });
  const state = await readBuilderLifecycleState(options);
  assertV1UpgradeSuccessor(state, prepared.state, selection.digest, reservation);
  await completeCheckpointUpgradeReservation(
    prepared.projection.projectRoot,
    state,
    reservation,
    prepared.plan.planDigest,
  );
  return lifecycleResult({
    action: "upgrade",
    status: "activated-successor",
    changed: appended.changed,
    plan: prepared.plan,
    state,
  });
}

function buildV1ImmutableReleaseCandidate(projection, state) {
  const release = Object.freeze({
    name: projection.release.name,
    version: projection.release.version,
    adapterId: projection.release.adapterId,
    releaseDigest: projection.release.releaseDigest,
  });
  const bundleDigest = digestJson({
    schemaVersion: "agentmo.builder-immutable-release-basis.v1",
    scopeDigest: projection.scopeDigest,
    predecessorReceiptDigest: state.activeReceiptDigest,
    release,
    assets: projection.release.assets.map((asset) => ({
      sourcePath: asset.sourcePath,
      digest: asset.digest,
      byteLength: asset.byteLength,
    })),
  }, "builder-immutable-release-basis");
  const bundleId = bundleDigest.slice("sha256:".length);
  const releaseRoot = `${IMMUTABLE_RELEASES_PATH}/${bundleId}`;
  const files = projection.release.assets.map((asset) => ({
    relativePath: `${releaseRoot}/package/${admitV1AssetPath(asset.sourcePath)}`,
    bytes: Buffer.from(asset.bytes),
    digest: asset.digest,
  }));
  const markerSource = projection.managedFiles.find(
    (entry) => entry.relativePath === BUILDER_INSTALL_MARKER_PATH,
  );
  const agentSource = projection.managedFiles.find(
    (entry) => entry.relativePath === BUILDER_PROJECT_AGENT_PATH,
  );
  if (!markerSource || !agentSource) fail("AGENTMO_BUILDER_PACKAGE_INVALID");
  const receiptPath = `${releaseRoot}/install-receipt.json`;
  const marker = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(markerSource.bytes));
  marker.receiptPath = receiptPath;
  const markerBytes = Buffer.from(serializePersistableJson(marker, {
    subject: "builder-versioned-install-marker",
  }), "utf8");
  files.push({
    relativePath: `${releaseRoot}/install-marker.json`,
    bytes: markerBytes,
    digest: digestRawBytes(markerBytes),
  });
  files.push({
    relativePath: `${releaseRoot}/project-agent.toml`,
    bytes: Buffer.from(agentSource.bytes),
    digest: digestRawBytes(agentSource.bytes),
  });
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const receipt = {
    schemaVersion: RELEASE_RECEIPT_SCHEMA_VERSION,
    status: "immutable-successor",
    scope: "project",
    scopeDigest: projection.scopeDigest,
    predecessorReceiptDigest: state.activeReceiptDigest,
    bundleDigest,
    releaseRoot,
    receiptPath,
    identity: release,
    files: files.map((file) => ({
      relativePath: file.relativePath,
      digest: file.digest,
      byteLength: file.bytes.byteLength,
    })),
    evidence: {
      level: "declared-ready",
      mechanismOnly: true,
      hostBehaviorVerified: false,
      domainQualityCertified: false,
    },
  };
  const receiptBytes = Buffer.from(serializePersistableJson(receipt, {
    subject: "builder-immutable-release-receipt",
  }), "utf8");
  const receiptDigest = digestRawBytes(receiptBytes);
  files.push({ relativePath: receiptPath, bytes: receiptBytes, digest: receiptDigest });
  return {
    release,
    files,
    selection: deepFreeze({
      path: receiptPath,
      digest: receiptDigest,
      value: receipt,
      release,
      files: [],
      legacyGenesis: false,
    }),
  };
}

async function publishV1ImmutableFile(projectRoot, file, parentLedger) {
  const stagePath = deriveV1ImmutableStagePath(file.relativePath, file.digest);
  const stageAbsolute = resolveProjectPath(projectRoot, stagePath);
  const finalAbsolute = resolveProjectPath(projectRoot, file.relativePath);
  const publicationDirectory = path.dirname(finalAbsolute);
  if (path.dirname(stageAbsolute) !== publicationDirectory) {
    fail("AGENTMO_BUILDER_LIFECYCLE_PATH_ESCAPE");
  }
  await assertV1KnownParentChain(
    projectRoot,
    [...parentLedger.values()],
    "AGENTMO_BUILDER_LIFECYCLE_PLAN_CHANGED",
  );
  await ensureV1PrivateDirectory(projectRoot, publicationDirectory);
  const parentChainBefore = await inspectV1CanonicalParentChain(
    projectRoot,
    publicationDirectory,
    "AGENTMO_BUILDER_LIFECYCLE_PLAN_CHANGED",
  );
  assertV1ParentChainMatchesLedger(parentChainBefore, parentLedger,
    "AGENTMO_BUILDER_LIFECYCLE_PLAN_CHANGED");
  let directoryAuthority;
  let sourceHandle;
  try {
    directoryAuthority = await retainV1EffectDirectory(publicationDirectory);
    const staged = await runBuilderPosixEffect({
      action: "write-file",
      name: path.basename(stageAbsolute),
      payload: file.bytes.toString("base64"),
    }, {
      directoryAuthority,
    });
    sourceHandle = await open(
      stageAbsolute,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    await assertV1RetainedStage(
      stageAbsolute,
      sourceHandle,
      staged.identity,
      file.bytes,
    );
    await runBuilderPosixEffect({
      action: "hardlink",
      name: path.basename(finalAbsolute),
      payload: file.bytes.toString("base64"),
      sourceName: path.basename(stageAbsolute),
      sourceIdentity: staged.identity,
    }, {
      directoryAuthority,
      sourceAuthority: Object.freeze({ handle: sourceHandle }),
    });
  } catch (error) {
    if (error instanceof BuilderLifecycleError) throw error;
    fail("AGENTMO_BUILDER_IMMUTABLE_RELEASE_WRITE_FAILED");
  } finally {
    await sourceHandle?.close().catch(() => {});
    await directoryAuthority?.handle.close().catch(() => {});
  }
  const parentChainAfter = await inspectV1CanonicalParentChain(
    projectRoot,
    publicationDirectory,
    "AGENTMO_BUILDER_IMMUTABLE_RELEASE_CHANGED",
  );
  if (!sameV1ParentChain(parentChainBefore, parentChainAfter)) {
    fail("AGENTMO_BUILDER_IMMUTABLE_RELEASE_CHANGED");
  }
  recordV1ParentChain(parentLedger, parentChainAfter,
    "AGENTMO_BUILDER_IMMUTABLE_RELEASE_CHANGED");
  const stageStats = await assertV1FileBytes(
    projectRoot,
    stageAbsolute,
    file.bytes,
    [2n],
    parentChainAfter,
  );
  const finalStats = await assertV1FileBytes(
    projectRoot,
    finalAbsolute,
    file.bytes,
    [2n],
    parentChainAfter,
  );
  if (!sameIdentity(stageStats, finalStats)) fail("AGENTMO_BUILDER_IMMUTABLE_RELEASE_CONFLICT");
  return deepFreeze({
    relativePath: file.relativePath,
    stagePath,
    digest: file.digest,
    identity: fileIdentity(finalStats),
    parentChain: parentChainAfter,
  });
}

function deriveV1ImmutableStagePath(relativePath, fileDigest) {
  const pathKey = digestJson({
    path: relativePath,
    digest: fileDigest,
  }, "builder-release-stage-key").slice("sha256:".length);
  return `${path.posix.dirname(relativePath)}/.${path.posix.basename(relativePath)}.${pathKey}.stage`;
}

async function admitV1ActivatedSelection(projectRoot, event, genesis) {
  if (event.files === null) {
    if (event.receipt.path !== genesis.path
      || event.receipt.digest !== genesis.digest
      || event.receipt.release.releaseDigest !== genesis.release.releaseDigest) {
      fail("AGENTMO_BUILDER_LIFECYCLE_EVENT_INVALID");
    }
    return genesis;
  }
  if (!Array.isArray(event.files) || event.files.length === 0 || event.files.length > 512) {
    fail("AGENTMO_BUILDER_LIFECYCLE_EVENT_INVALID");
  }
  const observedFiles = [];
  for (const file of event.files) {
    if (!file || typeof file !== "object"
      || Object.keys(file).toSorted().join("\0") !== [
        "digest", "identity", "parentChain", "relativePath", "stagePath",
      ].join("\0")
      || !file.relativePath.startsWith(`${IMMUTABLE_RELEASES_PATH}/`)
      || !DIGEST_PATTERN.test(file.digest ?? "")
      || file.stagePath !== deriveV1ImmutableStagePath(file.relativePath, file.digest)
      || path.posix.dirname(file.stagePath) !== path.posix.dirname(file.relativePath)
      || !validV1FileIdentity(file.identity)
      || !validV1RecordedParentChain(file.parentChain, file.relativePath)) {
      fail("AGENTMO_BUILDER_LIFECYCLE_EVENT_INVALID");
    }
    const finalAbsolute = resolveProjectPath(projectRoot, file.relativePath);
    const stageAbsolute = resolveProjectPath(projectRoot, file.stagePath);
    const parentChain = await assertV1ImmutableParentChain(
      projectRoot,
      path.dirname(finalAbsolute),
      file.parentChain,
    );
    const bytes = await readV1LinkedBytes(projectRoot, finalAbsolute, parentChain);
    if (digestRawBytes(bytes) !== file.digest) fail("AGENTMO_BUILDER_IMMUTABLE_RELEASE_CHANGED");
    const finalStats = await assertV1FileBytes(
      projectRoot,
      finalAbsolute,
      bytes,
      [2n],
      parentChain,
    );
    const stageStats = await assertV1FileBytes(
      projectRoot,
      stageAbsolute,
      bytes,
      [2n],
      parentChain,
    );
    if (!sameIdentity(finalStats, stageStats)
      || !sameFileIdentity(fileIdentity(finalStats), file.identity)) {
      fail("AGENTMO_BUILDER_IMMUTABLE_RELEASE_CHANGED");
    }
    observedFiles.push({ file, bytes, stats: finalStats });
  }
  const receiptFile = event.files.find((file) => file.relativePath === event.receipt.path);
  if (!receiptFile || receiptFile.digest !== event.receipt.digest) {
    fail("AGENTMO_BUILDER_LIFECYCLE_EVENT_INVALID");
  }
  const receiptObservation = observedFiles.find(({ file }) => file === receiptFile);
  const receipt = admitV1ReleaseReceipt(
    receiptObservation.bytes,
    event,
    observedFiles,
  );
  return deepFreeze({
    path: event.receipt.path,
    digest: event.receipt.digest,
    value: receipt,
    release: event.receipt.release,
    files: event.files,
    receiptIdentity: fileIdentity(receiptObservation.stats),
    legacyGenesis: false,
  });
}

function admitV1ReleaseReceipt(bytes, event, observedFiles) {
  let receipt;
  try {
    receipt = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    requireKeySet(receipt, [
      "schemaVersion", "status", "scope", "scopeDigest", "predecessorReceiptDigest",
      "bundleDigest", "releaseRoot", "receiptPath", "identity", "files", "evidence",
    ]);
    requireKeySet(receipt.identity, ["name", "version", "adapterId", "releaseDigest"]);
    requireKeySet(receipt.evidence, [
      "level", "mechanismOnly", "hostBehaviorVerified", "domainQualityCertified",
    ]);
    const bundleId = receipt.bundleDigest?.slice("sha256:".length);
    if (receipt.schemaVersion !== RELEASE_RECEIPT_SCHEMA_VERSION
      || receipt.status !== "immutable-successor"
      || receipt.scope !== "project"
      || receipt.scopeDigest !== event.scopeDigest
      || receipt.predecessorReceiptDigest !== event.predecessorReceiptDigest
      || !DIGEST_PATTERN.test(receipt.bundleDigest ?? "")
      || receipt.releaseRoot !== `${IMMUTABLE_RELEASES_PATH}/${bundleId}`
      || receipt.receiptPath !== `${receipt.releaseRoot}/install-receipt.json`
      || receipt.receiptPath !== event.receipt.path
      || receipt.identity.name !== "agentmo"
      || receipt.identity.adapterId !== "codex"
      || !VERSION_PATTERN.test(receipt.identity.version ?? "")
      || !DIGEST_PATTERN.test(receipt.identity.releaseDigest ?? "")
      || JSON.stringify(receipt.identity) !== JSON.stringify(event.receipt.release)
      || JSON.stringify(receipt) !== JSON.stringify(event.receipt.value)
      || receipt.evidence.level !== "declared-ready"
      || receipt.evidence.mechanismOnly !== true
      || receipt.evidence.hostBehaviorVerified !== false
      || receipt.evidence.domainQualityCertified !== false
      || !Array.isArray(receipt.files)
      || receipt.files.length === 0
      || receipt.files.length + 1 !== observedFiles.length) {
      throw new Error("release receipt");
    }
    let previous = null;
    for (const file of receipt.files) {
      requireKeySet(file, ["relativePath", "digest", "byteLength"]);
      if (!file.relativePath.startsWith(`${receipt.releaseRoot}/`)
        || !DIGEST_PATTERN.test(file.digest ?? "")
        || !Number.isSafeInteger(file.byteLength)
        || file.byteLength < 0
        || (previous !== null && previous >= file.relativePath)) {
        throw new Error("release file");
      }
      const observed = observedFiles.find(({ file: candidate }) => (
        candidate.relativePath === file.relativePath
      ));
      if (observed === undefined
        || observed.file.digest !== file.digest
        || observed.bytes.byteLength !== file.byteLength) {
        throw new Error("release file");
      }
      previous = file.relativePath;
    }
    const canonical = Buffer.from(serializePersistableJson(receipt, {
      subject: "builder-immutable-release-receipt",
    }), "utf8");
    if (!canonical.equals(bytes)) throw new Error("canonical");
  } catch {
    fail("AGENTMO_BUILDER_LIFECYCLE_EVENT_INVALID");
  }
  return receipt;
}

async function readV1LinkedBytes(projectRoot, filePath, expectedParentChain) {
  let handle;
  try {
    await assertV1ImmutableParentChain(
      projectRoot,
      path.dirname(filePath),
      expectedParentChain,
    );
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 2n
      || (before.mode & 0o077n) !== 0n || before.size > BigInt(MAX_FILE_BYTES)) {
      fail("AGENTMO_BUILDER_IMMUTABLE_RELEASE_CHANGED");
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (!sameIdentity(before, after)
      || before.size !== after.size
      || before.mtimeNs !== after.mtimeNs
      || before.ctimeNs !== after.ctimeNs) {
      fail("AGENTMO_BUILDER_IMMUTABLE_RELEASE_CHANGED");
    }
    await assertV1ImmutableParentChain(
      projectRoot,
      path.dirname(filePath),
      expectedParentChain,
    );
    return bytes;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function loadV1Genesis(projectRoot, scopeDigest) {
  const observation = await inspectFile(projectRoot, BUILDER_INSTALL_RECEIPT_PATH);
  if (observation.status === "missing") return null;
  if (observation.status !== "file") fail("AGENTMO_BUILDER_LIFECYCLE_RECEIPT_CORRUPT");
  const receipt = admitReceipt(observation.bytes, scopeDigest);
  const current = await loadCurrentInstall(projectRoot, scopeDigest, observation.digest);
  if (current.files.some((file) => file.currentStatus !== "pristine")) {
    fail("AGENTMO_BUILDER_LIFECYCLE_INSTALLED_BYTES_CHANGED");
  }
  return deepFreeze({
    path: BUILDER_INSTALL_RECEIPT_PATH,
    digest: observation.digest,
    value: receipt,
    release: receipt.identity,
    receiptIdentity: observation.identity,
    files: current.files.map((file) => ({
      relativePath: file.relativePath,
      digest: file.currentDigest,
      identity: file.currentIdentity,
    })),
    admissionFiles: current.files,
    legacyGenesis: true,
  });
}

function buildV1LifecycleEvent({
  action,
  invokedAs,
  state,
  selection,
  checkpointUpgradeOperationId = null,
  checkpointUpgradeAbortOperationId = null,
}) {
  if ((checkpointUpgradeOperationId !== null && checkpointUpgradeAbortOperationId !== null)
    || (checkpointUpgradeOperationId !== null
      && (!DIGEST_PATTERN.test(checkpointUpgradeOperationId)
        || action !== "activate"
        || invokedAs !== "upgrade"))
    || (checkpointUpgradeAbortOperationId !== null
      && (!DIGEST_PATTERN.test(checkpointUpgradeAbortOperationId)
        || action !== "activate"
        || invokedAs !== "upgrade-abort"))) {
    fail("AGENTMO_BUILDER_LIFECYCLE_EVENT_INVALID");
  }
  return deepFreeze({
    schemaVersion: LIFECYCLE_EVENT_SCHEMA_VERSION,
    action,
    status: action === "activate" ? "active" : "deactivated",
    invokedAs,
    scopeDigest: state.scopeDigest,
    predecessorReceiptDigest: state.activeReceiptDigest,
    receipt: {
      path: selection.path,
      digest: selection.digest,
      value: selection.value,
      release: selection.release,
    },
    files: selection.legacyGenesis ? null : selection.files,
    physicalDeletion: false,
    hostMutation: false,
    coordination: checkpointUpgradeOperationId !== null
      ? {
          kind: "checkpoint-upgrade-reservation",
          operationId: checkpointUpgradeOperationId,
        }
      : checkpointUpgradeAbortOperationId !== null
        ? {
            kind: "checkpoint-upgrade-abort",
            operationId: checkpointUpgradeAbortOperationId,
          }
        : null,
    evidence: {
      level: "declared-ready",
      mechanismOnly: true,
      hostBehaviorVerified: false,
      domainQualityCertified: false,
    },
  });
}

async function appendLifecycleAuthorityRecord(options) {
  return appendAppendOnlyRecord({
    ...options,
    authorityCapability: LIFECYCLE_APPEND_CAPABILITY,
  });
}

function admitV1LifecycleEvent(value, scopeDigest) {
  const isLegacyV2 = value?.schemaVersion === LEGACY_V2_LIFECYCLE_EVENT_SCHEMA_VERSION;
  const isCurrent = value?.schemaVersion === LIFECYCLE_EVENT_SCHEMA_VERSION;
  if (!value || typeof value !== "object"
    || (!isLegacyV2 && !isCurrent)
    || !["activate", "deactivate"].includes(value.action)
    || value.status !== (value.action === "activate" ? "active" : "deactivated")
    || !["upgrade", "upgrade-abort", "reactivate", "deactivate", "uninstall"].includes(value.invokedAs)
    || value.scopeDigest !== scopeDigest
    || !DIGEST_PATTERN.test(value.predecessorReceiptDigest ?? "")
    || !value.receipt
    || typeof value.receipt.path !== "string"
    || !DIGEST_PATTERN.test(value.receipt.digest ?? "")
    || value.physicalDeletion !== false
    || value.hostMutation !== false) {
    fail("AGENTMO_BUILDER_LIFECYCLE_EVENT_INVALID");
  }
  if (isLegacyV2) {
    if (Object.hasOwn(value, "coordination")) {
      fail("AGENTMO_BUILDER_LIFECYCLE_EVENT_INVALID");
    }
    return value;
  }
  if (value.coordination !== null
    && (!value.coordination
      || typeof value.coordination !== "object"
      || Array.isArray(value.coordination)
      || Object.keys(value.coordination).length !== 2
      || !["checkpoint-upgrade-reservation", "checkpoint-upgrade-abort"].includes(
        value.coordination.kind,
      )
      || !DIGEST_PATTERN.test(value.coordination.operationId ?? "")
      || value.action !== "activate"
      || (value.coordination.kind === "checkpoint-upgrade-reservation"
        ? value.invokedAs !== "upgrade"
        : value.invokedAs !== "upgrade-abort"))) {
    fail("AGENTMO_BUILDER_LIFECYCLE_EVENT_INVALID");
  }
  return value;
}

async function ensureV1PrivateDirectory(projectRoot, directory) {
  const relative = path.relative(projectRoot, directory);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    fail("AGENTMO_BUILDER_LIFECYCLE_PATH_ESCAPE");
  }
  let cursor = projectRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    const child = path.join(cursor, segment);
    let stats = await lstat(child, { bigint: true }).catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (stats === null) {
      let parentAuthority;
      try {
        parentAuthority = await retainV1EffectDirectory(cursor);
        await runBuilderPosixEffect({
          action: "mkdir",
          name: segment,
          payload: "",
        }, {
          directoryAuthority: parentAuthority,
        });
      } catch (error) {
        if (error instanceof BuilderLifecycleError) throw error;
        fail("AGENTMO_BUILDER_IMMUTABLE_RELEASE_WRITE_FAILED");
      } finally {
        await parentAuthority?.handle.close().catch(() => {});
      }
      stats = await lstat(child, { bigint: true }).catch(() => null);
    }
    if (!stats?.isDirectory() || stats.isSymbolicLink()
      || stats.uid !== BigInt(process.getuid())
      || (stats.mode & 0o022n) !== 0n) {
      fail("AGENTMO_BUILDER_LIFECYCLE_PATH_ESCAPE");
    }
    cursor = child;
  }
}

async function assertV1FileBytes(
  projectRoot,
  filePath,
  expectedBytes,
  links,
  expectedParentChain,
) {
  let handle;
  try {
    await assertV1ImmutableParentChain(
      projectRoot,
      path.dirname(filePath),
      expectedParentChain,
    );
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || !links.includes(before.nlink)
      || (before.mode & 0o077n) !== 0n || before.size > BigInt(MAX_FILE_BYTES)) {
      fail("AGENTMO_BUILDER_IMMUTABLE_RELEASE_CHANGED");
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (!sameIdentity(before, after)
      || before.size !== after.size
      || before.mtimeNs !== after.mtimeNs
      || before.ctimeNs !== after.ctimeNs
      || !bytes.equals(expectedBytes)) {
      fail("AGENTMO_BUILDER_IMMUTABLE_RELEASE_CHANGED");
    }
    await assertV1ImmutableParentChain(
      projectRoot,
      path.dirname(filePath),
      expectedParentChain,
    );
    return after;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function assertV1RetainedStage(filePath, handle, expectedIdentity, expectedBytes) {
  const before = await handle.stat({ bigint: true });
  const currentBefore = await lstat(filePath, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink()
    || ![1n, 2n].includes(before.nlink)
    || (before.mode & 0o077n) !== 0n
    || before.uid !== BigInt(process.getuid())
    || before.size > BigInt(MAX_FILE_BYTES)
    || !sameIdentity(before, currentBefore)
    || !sameFileIdentity(fileIdentity(before), expectedIdentity)) {
    fail("AGENTMO_BUILDER_IMMUTABLE_RELEASE_CHANGED");
  }
  const bytes = await handle.readFile();
  const after = await handle.stat({ bigint: true });
  const currentAfter = await lstat(filePath, { bigint: true });
  if (!bytes.equals(expectedBytes)
    || !sameIdentity(before, after)
    || !sameIdentity(after, currentAfter)
    || !sameFileIdentity(fileIdentity(after), expectedIdentity)) {
    fail("AGENTMO_BUILDER_IMMUTABLE_RELEASE_CHANGED");
  }
}

async function retainV1EffectDirectory(directory) {
  let handle;
  try {
    const before = await lstat(directory, { bigint: true });
    handle = await open(
      directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const retained = await handle.stat({ bigint: true });
    const after = await lstat(directory, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink()
      || !retained.isDirectory() || retained.isSymbolicLink()
      || !after.isDirectory() || after.isSymbolicLink()
      || !sameIdentity(before, retained)
      || !sameIdentity(retained, after)
      || retained.uid !== BigInt(process.getuid())
      || (retained.mode & 0o022n) !== 0n) {
      fail("AGENTMO_BUILDER_LIFECYCLE_PATH_ESCAPE");
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
    if (error instanceof BuilderLifecycleError) throw error;
    fail("AGENTMO_BUILDER_LIFECYCLE_PATH_ESCAPE");
  }
}

function admitV1AssetPath(value) {
  if (typeof value !== "string" || value.includes("\\") || path.posix.isAbsolute(value)
    || value.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    fail("AGENTMO_BUILDER_PACKAGE_INVALID");
  }
  return value;
}

function assertV1PlanApproval(options, plan) {
  if (!DIGEST_PATTERN.test(options.expectedPlanDigest ?? "")) {
    fail("AGENTMO_BUILDER_LIFECYCLE_PLAN_DIGEST_REQUIRED");
  }
  if (options.expectedPlanDigest !== plan.planDigest) {
    fail("AGENTMO_BUILDER_LIFECYCLE_PLAN_CHANGED");
  }
}

function lifecycleProposalEvidence() {
  return {
    level: "proposal-only",
    mechanismOnly: true,
    hostBehaviorVerified: false,
    domainQualityCertified: false,
  };
}

function lifecycleResult({ action, status, changed, plan, state }) {
  return deepFreeze({
    schemaVersion: "agentmo.builder-lifecycle-result.v2",
    action,
    status,
    scope: "project",
    changed,
    physicalDeletion: false,
    hostMutation: false,
    planDigest: plan.planDigest,
    receipt: {
      path: state.activeReceiptPath,
      digest: state.activeReceiptDigest,
    },
    lifecycle: {
      status: state.status,
      authorityHeadDigest: state.authorityHeadDigest,
      tombstoneCount: state.tombstones.length,
    },
    evidence: {
      level: "declared-ready",
      mechanismOnly: true,
      hostBehaviorVerified: false,
      domainQualityCertified: false,
    },
  });
}

export async function admitBuilderLifecycleReceipt(options = {}) {
  assertBuilderPlatform();
  if (!options || typeof options !== "object" || Array.isArray(options)
    || Object.keys(options).some((key) => !["projectRoot", "expectedReceiptDigest"].includes(key))
    || !DIGEST_PATTERN.test(options.expectedReceiptDigest ?? "")) {
    fail("AGENTMO_BUILDER_LIFECYCLE_RECEIPT_DIGEST_REQUIRED");
  }
  return admitBuilderLifecycleSelection(options);
}

export async function admitVerifiedBootstrapLifecycleReceipt(options = {}) {
  assertBuilderPlatform();
  if (!options || typeof options !== "object" || Array.isArray(options)
    || Object.keys(options).length !== 4
    || !["bootstrapCapability", "projectRoot", "expectedReceiptDigest", "runnerDigest"].every(
      (key) => Object.hasOwn(options, key),
    )
    || !DIGEST_PATTERN.test(options.expectedReceiptDigest ?? "")
    || !DIGEST_PATTERN.test(options.runnerDigest ?? "")) {
    fail("AGENTMO_BUILDER_LIFECYCLE_RECEIPT_DIGEST_REQUIRED");
  }
  return admitBuilderLifecycleSelectionInternal({
    projectRoot: options.projectRoot,
    expectedReceiptDigest: options.expectedReceiptDigest,
  }, Object.freeze({
    bootstrapCapability: options.bootstrapCapability,
    runnerDigest: options.runnerDigest,
  }));
}

export async function admitBuilderLifecycleSelection(options = {}) {
  assertBuilderPlatform();
  if (!options || typeof options !== "object" || Array.isArray(options)
    || Object.keys(options).some((key) => !["projectRoot", "expectedReceiptDigest"].includes(key))
    || (options.expectedReceiptDigest !== undefined
      && !DIGEST_PATTERN.test(options.expectedReceiptDigest ?? ""))) {
    fail("AGENTMO_BUILDER_LIFECYCLE_RECEIPT_DIGEST_REQUIRED");
  }
  return admitBuilderLifecycleSelectionInternal(options, null);
}

async function admitBuilderLifecycleSelectionInternal(options, bootstrap) {
  const projectRoot = await admitProjectRoot(options.projectRoot ?? process.cwd());
  const lifecycle = await readBuilderLifecycleState({ projectRoot });
  if (lifecycle.recoveryRequired !== null) {
    fail("AGENTMO_BUILDER_LIFECYCLE_RECOVERY_REQUIRED");
  }
  if (options.expectedReceiptDigest !== undefined
    && lifecycle.activeReceiptDigest !== options.expectedReceiptDigest) {
    fail("AGENTMO_BUILDER_LIFECYCLE_RECEIPT_DIGEST_MISMATCH");
  }
  const selected = lifecycle.activeReceipt;
  const packageRoot = selected.legacyGenesis
    ? null
    : resolveProjectPath(projectRoot, `${selected.value.releaseRoot}/package`);
  const releasePackage = await loadV1SelectedPackage(
    projectRoot,
    selected,
    bootstrap,
    Object.freeze({
      digest: lifecycle.genesisReceiptDigest,
      value: lifecycle.genesisReceipt,
      release: lifecycle.genesisReceipt.identity,
    }),
  );
  const files = selected.legacyGenesis
    ? selected.admissionFiles
    : selected.files.map((file) => ({
        relativePath: file.relativePath,
        ownership: "immutable-successor",
        projectedDigest: file.digest,
        currentDigest: file.digest,
        currentIdentity: file.identity,
        currentStatus: "pristine",
      }));
  return deepFreeze({
    schemaVersion: "agentmo.builder-lifecycle-selection-admission.v1",
    projectRoot,
    scopeDigest: lifecycle.scopeDigest,
    lifecycleStatus: lifecycle.status,
    lifecycleHeadDigest: lifecycle.authorityHeadDigest,
    receiptPath: selected.path,
    receiptDigest: selected.digest,
    receiptIdentity: selected.receiptIdentity,
    expectedReceiptDigest: options.expectedReceiptDigest ?? selected.digest,
    receipt: selected.value,
    release: selected.release,
    packageRoot,
    package: releasePackage,
    legacyGenesis: selected.legacyGenesis,
    genesisReceiptPath: lifecycle.genesisReceiptPath,
    genesisReceiptDigest: lifecycle.genesisReceiptDigest,
    genesisReceipt: lifecycle.genesisReceipt,
    genesisReceiptIdentity: lifecycle.genesisReceiptIdentity,
    genesisFiles: lifecycle.genesisFiles,
    activationReceipt: lifecycle.genesisReceipt.schemaVersion === BUILDER_ACTIVATED_RECEIPT_SCHEMA_VERSION
      ? lifecycle.genesisReceipt
      : null,
    capabilitySnapshot: lifecycle.genesisReceipt.capabilitySnapshot,
    receiptLineageDigests: lifecycle.receiptLineageDigests,
    files,
  });
}

async function loadV1SelectedPackage(projectRoot, selected, bootstrap = null, genesis = null) {
  let bootstrapPackage = null;
  if (bootstrap !== null) {
    if (!genesis
      || !DIGEST_PATTERN.test(genesis.digest ?? "")
      || !genesis.value?.hostActivation?.finalProjectionBinding
      || !genesis.release) {
      fail("AGENTMO_BUILDER_LIFECYCLE_RECEIPT_DIGEST_REQUIRED");
    }
    bootstrapPackage = await loadVerifiedBootstrapSnapshotPackage({
      bootstrapCapability: bootstrap.bootstrapCapability,
      expectedReceiptDigest: genesis.digest,
      projectionBinding: genesis.value.hostActivation.finalProjectionBinding,
      runnerDigest: bootstrap.runnerDigest,
    });
    assertV1SelectedPackageIdentity(bootstrapPackage, genesis.release);
  }
  const releasePackage = selected.legacyGenesis
    ? (bootstrapPackage ?? await loadBuilderPackage({
        expectedReceiptDigest: selected.digest,
        projectRoot,
      }))
    : await loadBuilderPackage({
        packageRoot: resolveProjectPath(projectRoot, `${selected.value.releaseRoot}/package`),
        projectRoot,
        expectedReceiptDigest: selected.digest,
        immutableLifecycleSelection: true,
      });
  if (bootstrapPackage !== null && !selected.legacyGenesis) {
    assertV1RuntimeCompatible(bootstrapPackage, releasePackage);
  }
  assertV1SelectedPackageIdentity(releasePackage, selected.release);
  return releasePackage;
}

function assertV1SelectedPackageIdentity(releasePackage, selectionRelease) {
  if (releasePackage.name !== selectionRelease.name
    || releasePackage.version !== selectionRelease.version
    || releasePackage.adapterId !== selectionRelease.adapterId
    || releasePackage.releaseDigest !== selectionRelease.releaseDigest) {
    fail("AGENTMO_BUILDER_LIFECYCLE_RELEASE_MISMATCH");
  }
}

function assertV1RuntimeCompatible(currentRelease, desiredRelease) {
  if (JSON.stringify(buildV1RuntimeCompatibilityBasis(currentRelease))
    !== JSON.stringify(buildV1RuntimeCompatibilityBasis(desiredRelease))) {
    fail("AGENTMO_BUILDER_LIFECYCLE_SUCCESSOR_RUNTIME_INCOMPATIBLE");
  }
}

export function buildV1RuntimeCompatibilityBasis(release) {
  if (!release || typeof release !== "object" || !Array.isArray(release.assets)) {
    fail("AGENTMO_BUILDER_LIFECYCLE_SUCCESSOR_RUNTIME_INCOMPATIBLE");
  }
  return release.assets
    .map((asset) => ({
      kind: asset.kind,
      sourcePath: asset.sourcePath,
      relativePath: asset.relativePath,
      destinationPath: asset.destinationPath,
      ...runtimeCompatibleAssetBasis(asset),
    }));
}

function runtimeCompatibleAssetBasis(asset) {
  if (![
    "package.json",
    "plugin/.codex-plugin/plugin.json",
    "src/builder-codex-uat-release-manifest.json",
  ].includes(asset.sourcePath)) {
    return { digest: asset.digest, byteLength: asset.byteLength };
  }
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(asset.bytes));
  } catch {
    fail("AGENTMO_BUILDER_LIFECYCLE_SUCCESSOR_RUNTIME_INCOMPATIBLE");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)
    || typeof value.version !== "string") {
    fail("AGENTMO_BUILDER_LIFECYCLE_SUCCESSOR_RUNTIME_INCOMPATIBLE");
  }
  const { version, ...basis } = value;
  const bytes = Buffer.from(`${JSON.stringify(normalizeRuntimeManifestJson(basis))}\n`, "utf8");
  return { digest: digestRawBytes(bytes), byteLength: bytes.byteLength };
}

function normalizeRuntimeManifestJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(normalizeRuntimeManifestJson);
  if (!value || typeof value !== "object") {
    fail("AGENTMO_BUILDER_LIFECYCLE_SUCCESSOR_RUNTIME_INCOMPATIBLE");
  }
  const normalized = {};
  for (const key of Object.keys(value).sort()) {
    normalized[key] = normalizeRuntimeManifestJson(value[key]);
  }
  return normalized;
}

async function loadCurrentInstall(projectRoot, scopeDigest, expectedReceiptDigest) {
  const receiptObservation = await inspectFile(projectRoot, BUILDER_INSTALL_RECEIPT_PATH);
  if (receiptObservation.status === "missing") fail("AGENTMO_BUILDER_LIFECYCLE_RECEIPT_MISSING");
  if (receiptObservation.status !== "file") fail("AGENTMO_BUILDER_LIFECYCLE_RECEIPT_CORRUPT");
  const receiptDigest = digestRawBytes(receiptObservation.bytes);
  if (receiptDigest !== expectedReceiptDigest) {
    fail("AGENTMO_BUILDER_LIFECYCLE_RECEIPT_DIGEST_MISMATCH");
  }
  const receipt = admitReceipt(receiptObservation.bytes, scopeDigest);
  const files = [];
  for (const entry of receipt.files) {
    const observed = await inspectFile(projectRoot, entry.relativePath);
    files.push({
      relativePath: entry.relativePath,
      ownership: entry.ownership,
      projectedDigest: entry.destinationDigest,
      currentDigest: observed.status === "file" ? observed.digest : null,
      currentIdentity: observed.status === "file" ? observed.identity : null,
      currentStatus: observed.status === "file"
        ? observed.digest === entry.destinationDigest ? "pristine" : "modified"
        : observed.status,
    });
  }
  const marker = files.find((item) => item.relativePath === BUILDER_INSTALL_MARKER_PATH);
  if (marker?.currentStatus === "pristine") {
    const markerObservation = await inspectFile(projectRoot, BUILDER_INSTALL_MARKER_PATH);
    if (markerObservation.status !== "file") fail("AGENTMO_BUILDER_LIFECYCLE_PLAN_CHANGED");
    admitMarker(markerObservation.bytes, receipt);
  }
  return {
    receipt,
    receiptBytes: Buffer.from(receiptObservation.bytes),
    receiptDigest,
    receiptIdentity: receiptObservation.identity,
    expectedReceiptDigest,
    files,
  };
}

function admitMarker(bytes, receipt) {
  const expected = {
    schemaVersion: BUILDER_INSTALL_MARKER_SCHEMA_VERSION,
    identity: receipt.identity,
    scope: "project",
    scopeDigest: receipt.scopeDigest,
    receiptPath: BUILDER_INSTALL_RECEIPT_PATH,
    checkpointPath: BUILDER_CHECKPOINT_PATH,
    capabilityDigest: receipt.capabilitySnapshot.digest,
    projectionStatus: "receipt-required",
    selfCertifying: false,
  };
  const canonical = Buffer.from(
    serializePersistableJson(expected, { subject: "builder-install-marker" }),
    "utf8",
  );
  if (!canonical.equals(bytes)) fail("AGENTMO_BUILDER_LIFECYCLE_MARKER_MISMATCH");
}

function admitReceipt(bytes, scopeDigest) {
  let receipt;
  try {
    receipt = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    const projected = receipt?.schemaVersion === BUILDER_INSTALL_RECEIPT_SCHEMA_VERSION
      && receipt?.status === "projected";
    const activated = receipt?.schemaVersion === BUILDER_ACTIVATED_RECEIPT_SCHEMA_VERSION
      && receipt?.status === "activated";
    const baseKeys = [
      "schemaVersion", "status", "scope", "scopeDigest", "identity", "planDigest",
      "capabilitySnapshot", "markerPath", "receiptPath", "checkpoint", "files", "evidence",
    ];
    requireKeySet(receipt, activated ? [...baseKeys, "hostActivation"] : baseKeys);
    if ((!projected && !activated)
      || receipt.scope !== "project"
      || receipt.scopeDigest !== scopeDigest
      || receipt.markerPath !== BUILDER_INSTALL_MARKER_PATH
      || receipt.receiptPath !== BUILDER_INSTALL_RECEIPT_PATH
      || !DIGEST_PATTERN.test(receipt.planDigest ?? "")) throw new Error("receipt");
    requireKeys(receipt.identity, ["name", "version", "adapterId", "releaseDigest"]);
    if (receipt.identity.name !== "agentmo" || receipt.identity.adapterId !== "codex"
      || !VERSION_PATTERN.test(receipt.identity.version ?? "")
      || !DIGEST_PATTERN.test(receipt.identity.releaseDigest ?? "")) throw new Error("identity");
    validateCapabilitySnapshot(receipt.capabilitySnapshot);
    requireKeys(receipt.checkpoint, ["path", "authority", "initialized"]);
    if (receipt.checkpoint.path !== BUILDER_CHECKPOINT_PATH
      || receipt.checkpoint.authority !== "agentmo-checkpoint"
      || receipt.checkpoint.initialized !== false) throw new Error("checkpoint");
    requireKeys(receipt.evidence, [
      "level",
      "mechanismOnly",
      "codexActivationVerified",
      "hostBehaviorVerified",
      "domainQualityCertified",
    ]);
    if (receipt.evidence.level !== (activated ? "host-observed" : "declared-ready")
      || receipt.evidence.mechanismOnly !== true
      || receipt.evidence.codexActivationVerified !== false
      || receipt.evidence.hostBehaviorVerified !== false
      || receipt.evidence.domainQualityCertified !== false) throw new Error("evidence");
    if (activated) validateLifecycleHostActivation(receipt.hostActivation, receipt.identity, scopeDigest);
    validateReceiptFiles(receipt.files);
    const basis = buildBuilderInstallPlanBasis({
      release: {
        name: receipt.identity.name,
        version: receipt.identity.version,
        releaseDigest: receipt.identity.releaseDigest,
      },
      capabilitySnapshot: receipt.capabilitySnapshot,
      scopeDigest: receipt.scopeDigest,
      managedFiles: receipt.files,
    });
    if (digestJson(basis, "builder-install-plan-basis") !== receipt.planDigest) throw new Error("plan");
    const canonical = Buffer.from(serializePersistableJson(receipt, { subject: "builder-install-receipt" }), "utf8");
    if (!canonical.equals(bytes)) throw new Error("canonical");
  } catch {
    fail("AGENTMO_BUILDER_LIFECYCLE_RECEIPT_CORRUPT");
  }
  return receipt;
}

function validateLifecycleHostActivation(binding, identity, scopeDigest) {
  requireKeySet(binding, [
    "schemaVersion",
    "hostScope",
    "selector",
    "releaseDigest",
    "marketplaceProjectionDigest",
    "operationOrderDigest",
    "ownerDisposition",
    "ownerRecordDigest",
    "consumerId",
    "consumerEntryDigest",
    "consumerLedgerDigest",
    "consumerEntryOwned",
    "selectorDeletionAuthority",
    "expectedPostObservation",
    "finalProjectionBinding",
  ]);
  const release = {
    name: identity.name,
    version: identity.version,
    adapterId: identity.adapterId,
    releaseDigest: identity.releaseDigest,
  };
  const selector = buildCodexHostSelector(release);
  const consumer = buildCodexConsumerEntry({
    selector,
    projectScopeDigest: scopeDigest,
    releaseDigest: identity.releaseDigest,
  });
  if (binding.schemaVersion !== "agentmo.builder-codex-activation-binding.v3"
    || binding.hostScope !== "user"
    || JSON.stringify(binding.selector) !== JSON.stringify(selector)
    || binding.releaseDigest !== identity.releaseDigest
    || !DIGEST_PATTERN.test(binding.marketplaceProjectionDigest ?? "")
    || !DIGEST_PATTERN.test(binding.operationOrderDigest ?? "")
    || !["created-by-agentmo", "preexisting-unowned"].includes(binding.ownerDisposition)
    || !DIGEST_PATTERN.test(binding.ownerRecordDigest ?? "")
    || binding.consumerId !== scopeDigest
    || binding.consumerEntryDigest !== digestCodexConsumerEntry(consumer)
    || !DIGEST_PATTERN.test(binding.consumerLedgerDigest ?? "")
    || binding.consumerEntryOwned !== true
    || binding.selectorDeletionAuthority !== false) throw new Error("host activation");
  validateLifecycleFinalProjectionBinding(binding.finalProjectionBinding, {
    selector,
    releaseDigest: identity.releaseDigest,
    contentDigest: binding.marketplaceProjectionDigest,
  });
  requireKeySet(binding.expectedPostObservation, [
    "installation",
    "enabled",
    "sourceMatch",
    "releaseMatch",
    "skillVisibility",
    "hooksVisibility",
    "trust",
    "agentHostVisibility",
  ]);
  const expected = binding.expectedPostObservation;
  if (expected.installation !== "installed"
    || expected.enabled !== true
    || expected.sourceMatch !== true
    || expected.releaseMatch !== true
    || expected.skillVisibility !== "visible"
    || expected.hooksVisibility !== "visible"
    || expected.trust !== "trusted-or-pending-human"
    || expected.agentHostVisibility !== "unobservable") throw new Error("host observation");
}

function validateLifecycleFinalProjectionBinding(value, expected) {
  requireKeySet(value, [
    "schemaVersion",
    "transactionId",
    "transactionDigest",
    "releaseDigest",
    "contentDigest",
    "rootIdentity",
    "rootIdentityDigest",
    "members",
  ]);
  if (value.schemaVersion !== "agentmo.codex-marketplace-projection-binding.v1"
    || value.releaseDigest !== expected.releaseDigest
    || value.contentDigest !== expected.contentDigest
    || !DIGEST_PATTERN.test(value.transactionDigest ?? "")
    || value.transactionId !== value.transactionDigest.slice("sha256:".length)
    || !DIGEST_PATTERN.test(value.rootIdentityDigest ?? "")
    || !Array.isArray(value.members)
    || value.members.length < 2) {
    throw new Error("projection binding");
  }
  const members = value.members.map((member, index) => {
    requireKeySet(member, ["digest", "identity", "kind", "relativePath"]);
    if (!["root", "directory", "file"].includes(member.kind)
      || (index === 0) !== (member.kind === "root")
      || (member.kind === "root" && member.relativePath !== "")
      || (member.kind !== "root" && !portableRelativePath(member.relativePath))
      || (member.kind === "file"
        ? !DIGEST_PATTERN.test(member.digest ?? "")
        : member.digest !== null)) {
      throw new Error("projection member");
    }
    validateLifecycleProjectionIdentity(member.identity, member.kind === "file");
    return member;
  });
  if (new Set(members.map((member) => member.relativePath)).size !== members.length) {
    throw new Error("projection member");
  }
  const fileIndex = members.findIndex((member) => member.kind === "file");
  if (fileIndex < 1
    || members.slice(1, fileIndex).some((member) => member.kind !== "directory")
    || members.slice(fileIndex).some((member) => member.kind !== "file")) {
    throw new Error("projection order");
  }
  const directories = members.slice(1, fileIndex);
  const expectedDirectories = [...directories].toSorted((left, right) => {
    const depth = left.relativePath.split("/").length - right.relativePath.split("/").length;
    return depth === 0
      ? left.relativePath.localeCompare(right.relativePath)
      : depth;
  });
  const files = members.slice(fileIndex);
  if (directories.some((member, index) => member !== expectedDirectories[index])
    || files.some((member, index) => (
      index > 0 && files[index - 1].relativePath >= member.relativePath
    ))) {
    throw new Error("projection order");
  }
  for (const member of members.slice(1)) {
    const parent = path.posix.dirname(member.relativePath);
    if (parent !== "."
      && !members.some((candidate) => (
        candidate.kind === "directory" && candidate.relativePath === parent
      ))) {
      throw new Error("projection parent");
    }
  }
  if (JSON.stringify(value.rootIdentity) !== JSON.stringify(members[0].identity)
    || value.rootIdentityDigest !== digestJson({
      schemaVersion: "agentmo.codex-marketplace-root-identity.v1",
      ...value.rootIdentity,
    }, "codex-marketplace-root-identity")) {
    throw new Error("projection root");
  }
  const manifest = {
    schemaVersion: "agentmo.codex-marketplace-projection-manifest.v1",
    selector: expected.selector,
    releaseDigest: value.releaseDigest,
    contentDigest: value.contentDigest,
    members: members.map(({ identity: _identity, ...member }) => member),
  };
  if (value.transactionDigest !== digestJson(
    manifest,
    "codex-marketplace-projection-manifest",
  )) {
    throw new Error("projection transaction");
  }
}

function validateLifecycleProjectionIdentity(value, file) {
  requireKeySet(value, [
    "device",
    "group",
    "inode",
    "links",
    "mode",
    "owner",
    "size",
  ]);
  if (!["device", "group", "inode", "links", "owner", "size"].every(
    (key) => /^\d+$/u.test(value[key] ?? ""),
  )
    || !/^[0-7]{3,4}$/u.test(value.mode ?? "")
    || (file ? value.links !== "1" : BigInt(value.links) < 1n)) {
    throw new Error("projection identity");
  }
}

function validateCapabilitySnapshot(value) {
  requireKeys(value, ["schemaVersion", "adapterId", "hostVersion", "evidenceLevel", "mutatesHost", "externalCommandMutation", "required", "optional", "digest"]);
  if (value.schemaVersion !== "agentmo.builder-capability-snapshot.v1"
    || value.adapterId !== "codex"
    || typeof value.hostVersion !== "string"
    || value.hostVersion.length > 64
    || value.evidenceLevel !== "observed"
    || value.mutatesHost !== "unknown"
    || value.externalCommandMutation !== "unknown"
    || !DIGEST_PATTERN.test(value.digest ?? "")) throw new Error("capability");
  validateCapabilityItems(value.required, new Set(["observed"]), true);
  validateCapabilityItems(value.optional, new Set(["observed", "degraded"]), false);
  const { digest, ...basis } = value;
  if (digestJson(basis, "builder-capability-snapshot") !== digest) throw new Error("capability digest");
}

function validateCapabilityItems(items, statuses, required) {
  if (!Array.isArray(items) || items.length > 64 || (required && items.length === 0)) throw new Error("capabilities");
  let previous = null;
  for (const item of items) {
    requireKeys(item, ["id", "status"]);
    if (!/^[a-z][a-z0-9-]{1,63}$/u.test(item.id ?? "") || !statuses.has(item.status)
      || (previous !== null && previous >= item.id)) throw new Error("capability item");
    previous = item.id;
  }
}

function validateReceiptFiles(files) {
  if (!Array.isArray(files) || files.length !== EXPECTED_FILES.length) throw new Error("files");
  const paths = [];
  for (const entry of files) {
    requireKeys(entry, ["relativePath", "sourceDigest", "destinationDigest", "ownership"]);
    const expectedOwnership = entry.relativePath === BUILDER_INSTALL_MARKER_PATH
        ? "exclusive-marker"
        : entry.relativePath === BUILDER_PROJECT_AGENT_PATH
          ? "exclusive-project-agent"
          : null;
    if (!portableRelativePath(entry.relativePath)
      || !DIGEST_PATTERN.test(entry.sourceDigest ?? "")
      || !DIGEST_PATTERN.test(entry.destinationDigest ?? "")
      || expectedOwnership === null
      || entry.ownership !== expectedOwnership) throw new Error("file entry");
    paths.push(entry.relativePath);
  }
  if (paths.some((item, index) => item !== EXPECTED_FILES[index])) throw new Error("file paths");
}

async function fenceCheckpointBeforeDeactivation(projectRoot, lifecycle) {
  const checkpointPath = resolveProjectPath(projectRoot, BUILDER_CHECKPOINT_PATH);
  try {
    if (!await checkpointAuthorityExists(checkpointPath)) return null;
    let admission = await loadBuilderCheckpointHead(checkpointPath);
    if (admission === null) return null;
    admission = await upgradeBuilderCheckpointProtocol(checkpointPath, admission);
    return await fenceBuilderCheckpointDeactivation(checkpointPath, {
      checkpointAdmission: admission,
      lifecycleHeadDigest: lifecycle.authorityHeadDigest,
      receiptDigest: lifecycle.activeReceiptDigest,
    });
  } catch (error) {
    if (error instanceof BuilderCheckpointError) {
      if (error.code === "AGENTMO_BUILDER_CHECKPOINT_HOOK_PREPARED") {
        fail("AGENTMO_BUILDER_LIFECYCLE_HOOK_IN_FLIGHT");
      }
      if (error.code === "AGENTMO_BUILDER_CHECKPOINT_UPGRADE_RESERVED") {
        fail("AGENTMO_BUILDER_LIFECYCLE_UPGRADE_RECOVERY_REQUIRED");
      }
      fail("AGENTMO_BUILDER_LIFECYCLE_CHECKPOINT_FENCE_REJECTED");
    }
    throw error;
  }
}

async function releaseCheckpointFenceAfterReactivation(projectRoot, lifecycle) {
  const canonicalProjectRoot = await admitProjectRoot(projectRoot);
  const checkpointPath = resolveProjectPath(canonicalProjectRoot, BUILDER_CHECKPOINT_PATH);
  try {
    if (!await checkpointAuthorityExists(checkpointPath)) return null;
    let admission = await loadBuilderCheckpointHead(checkpointPath);
    if (admission === null) return null;
    admission = await upgradeBuilderCheckpointProtocol(checkpointPath, admission);
    const protocol = admission.value.hookDeactivationProtocol;
    if (protocol.state === "hook-prepared") {
      fail("AGENTMO_BUILDER_LIFECYCLE_HOOK_IN_FLIGHT");
    }
    if (protocol.state === "upgrade-reserved") {
      fail("AGENTMO_BUILDER_LIFECYCLE_UPGRADE_RECOVERY_REQUIRED");
    }
    if (protocol.state !== "deactivation-fenced") return admission;
    if (lifecycle.status !== "active"
      || lifecycle.authorityHeadDigest === protocol.lifecycleHeadDigest) {
      fail("AGENTMO_BUILDER_LIFECYCLE_CHECKPOINT_FENCE_REJECTED");
    }
    const lifecycleAuthorityAdmission = await admitBuilderCheckpointLifecycleAuthority({
      checkpointAdmission: admission,
      projectRoot: canonicalProjectRoot,
      expectedHeadDigest: lifecycle.authorityHeadDigest,
    });
    return await releaseBuilderCheckpointDeactivationFence(checkpointPath, {
      checkpointAdmission: admission,
      lifecycleAuthorityAdmission,
      receiptDigest: protocol.receiptDigest,
    });
  } catch (error) {
    if (error instanceof BuilderLifecycleError) throw error;
    if (error instanceof BuilderCheckpointError) {
      fail("AGENTMO_BUILDER_LIFECYCLE_CHECKPOINT_FENCE_REJECTED");
    }
    throw error;
  }
}

async function assertCheckpointAllowsUpgrade(projectRoot) {
  const checkpointPath = resolveProjectPath(projectRoot, BUILDER_CHECKPOINT_PATH);
  try {
    if (!await checkpointAuthorityExists(checkpointPath)) return;
    let admission = await loadBuilderCheckpointHead(checkpointPath);
    if (admission === null) return;
    admission = await upgradeBuilderCheckpointProtocol(checkpointPath, admission);
    const state = admission.value.hookDeactivationProtocol.state;
    if (state === "deactivation-fenced") {
      fail("AGENTMO_BUILDER_REACTIVATION_REQUIRED");
    }
    if (state === "upgrade-reserved") {
      fail("AGENTMO_BUILDER_LIFECYCLE_UPGRADE_RECOVERY_REQUIRED");
    }
    if (state === "hook-prepared") {
      fail("AGENTMO_BUILDER_LIFECYCLE_HOOK_IN_FLIGHT");
    }
  } catch (error) {
    if (error instanceof BuilderLifecycleError) throw error;
    if (error instanceof BuilderCheckpointError) {
      fail("AGENTMO_BUILDER_LIFECYCLE_CHECKPOINT_FENCE_REJECTED");
    }
    throw error;
  }
}

async function reserveCheckpointForUpgrade(
  projectRoot,
  lifecycle,
  successorReceiptDigest,
  planDigest,
) {
  const checkpointPath = resolveProjectPath(projectRoot, BUILDER_CHECKPOINT_PATH);
  try {
    if (!await checkpointAuthorityExists(checkpointPath)) return null;
    let admission = await loadBuilderCheckpointHead(checkpointPath);
    if (admission === null) return null;
    admission = await upgradeBuilderCheckpointProtocol(checkpointPath, admission);
    return await reserveBuilderCheckpointUpgrade(checkpointPath, {
      checkpointAdmission: admission,
      lifecycleHeadDigest: lifecycle.authorityHeadDigest,
      receiptDigest: lifecycle.activeReceiptDigest,
      planDigest,
      successorReceiptDigest,
    });
  } catch (error) {
    if (error instanceof BuilderCheckpointError) {
      if (error.code === "AGENTMO_BUILDER_CHECKPOINT_HOOK_PREPARED") {
        fail("AGENTMO_BUILDER_LIFECYCLE_HOOK_IN_FLIGHT");
      }
      if (error.code === "AGENTMO_BUILDER_CHECKPOINT_DEACTIVATION_FENCED") {
        fail("AGENTMO_BUILDER_REACTIVATION_REQUIRED");
      }
      if (error.code === "AGENTMO_BUILDER_CHECKPOINT_UPGRADE_RESERVED") {
        fail("AGENTMO_BUILDER_LIFECYCLE_UPGRADE_RECOVERY_REQUIRED");
      }
      fail("AGENTMO_BUILDER_LIFECYCLE_CHECKPOINT_RESERVATION_REJECTED");
    }
    throw error;
  }
}

async function completeCheckpointUpgradeReservation(
  projectRoot,
  lifecycle,
  reservation,
  planDigest,
) {
  if (reservation === null) return null;
  const canonicalProjectRoot = await admitProjectRoot(projectRoot);
  const checkpointPath = resolveProjectPath(canonicalProjectRoot, BUILDER_CHECKPOINT_PATH);
  try {
    let admission = await loadBuilderCheckpointHead(checkpointPath);
    if (admission === null) fail("AGENTMO_BUILDER_LIFECYCLE_UPGRADE_RECOVERY_REQUIRED");
    admission = await upgradeBuilderCheckpointProtocol(checkpointPath, admission);
    const protocol = admission.value.hookDeactivationProtocol;
    const expectedOperationId = reservation.value.hookDeactivationProtocol.operationId;
    if (protocol.state === "open"
      && admission.value.installReceiptDigest === lifecycle.activeReceiptDigest) {
      return admission;
    }
    if (protocol.state !== "upgrade-reserved"
      || protocol.operationId !== expectedOperationId
      || protocol.upgradeReservation.planDigest !== planDigest
      || protocol.upgradeReservation.successorReceiptDigest !== lifecycle.activeReceiptDigest
      || lifecycle.transitions.at(-1)?.checkpointUpgradeOperationId !== expectedOperationId) {
      fail("AGENTMO_BUILDER_LIFECYCLE_UPGRADE_RECOVERY_REQUIRED");
    }
    const lifecycleAuthorityAdmission = await admitBuilderCheckpointLifecycleAuthority({
      checkpointAdmission: admission,
      projectRoot: canonicalProjectRoot,
      expectedHeadDigest: lifecycle.authorityHeadDigest,
    });
    return await completeBuilderCheckpointUpgrade(checkpointPath, {
      checkpointAdmission: admission,
      lifecycleAuthorityAdmission,
      planDigest,
      successorReceiptDigest: lifecycle.activeReceiptDigest,
    });
  } catch (error) {
    if (error instanceof BuilderLifecycleError) throw error;
    if (error instanceof BuilderCheckpointError) {
      fail("AGENTMO_BUILDER_LIFECYCLE_UPGRADE_RECOVERY_REQUIRED");
    }
    throw error;
  }
}

async function completeCommittedCheckpointUpgradeReservation(projectRoot) {
  const canonicalProjectRoot = await admitProjectRoot(projectRoot);
  const checkpointPath = resolveProjectPath(canonicalProjectRoot, BUILDER_CHECKPOINT_PATH);
  if (!await checkpointAuthorityExists(checkpointPath)) return null;
  let admission;
  try {
    admission = await loadBuilderCheckpointHead(checkpointPath);
    if (admission === null) return null;
    admission = await upgradeBuilderCheckpointProtocol(checkpointPath, admission);
  } catch (error) {
    if (error instanceof BuilderCheckpointError) {
      fail("AGENTMO_BUILDER_LIFECYCLE_UPGRADE_RECOVERY_REQUIRED");
    }
    throw error;
  }
  const protocol = admission.value.hookDeactivationProtocol;
  if (protocol.state !== "upgrade-reserved") return null;
  const lifecycle = await readBuilderLifecycleState({ projectRoot: canonicalProjectRoot });
  if (lifecycle.recoveryRequired !== null) {
    fail("AGENTMO_BUILDER_LIFECYCLE_UPGRADE_RECOVERY_REQUIRED");
  }
  if (lifecycle.status === "active"
    && lifecycle.activeReceiptDigest === protocol.receiptDigest
    && lifecycle.authorityHeadDigest === protocol.lifecycleHeadDigest) {
    return null;
  }
  if (isCommittedUpgradeAbort(lifecycle, protocol)) {
    const lifecycleAuthorityAdmission = await admitBuilderCheckpointLifecycleAuthority({
      checkpointAdmission: admission,
      projectRoot: canonicalProjectRoot,
      expectedHeadDigest: lifecycle.authorityHeadDigest,
    });
    await abortBuilderCheckpointUpgrade(checkpointPath, {
      checkpointAdmission: admission,
      lifecycleAuthorityAdmission,
      planDigest: protocol.upgradeReservation.planDigest,
      successorReceiptDigest: protocol.upgradeReservation.successorReceiptDigest,
    });
    return null;
  }
  if (lifecycle.status !== "active"
    || lifecycle.activeReceiptDigest !== protocol.upgradeReservation.successorReceiptDigest
    || lifecycle.transitions.at(-1)?.checkpointUpgradeOperationId !== protocol.operationId) {
    fail("AGENTMO_BUILDER_LIFECYCLE_UPGRADE_RECOVERY_REQUIRED");
  }
  await completeCheckpointUpgradeReservation(
    canonicalProjectRoot,
    lifecycle,
    admission,
    protocol.upgradeReservation.planDigest,
  );
  return {
    state: lifecycle,
    planDigest: protocol.upgradeReservation.planDigest,
    predecessorReceiptDigest: protocol.receiptDigest,
  };
}

async function abortUncommittedCheckpointUpgradeReservation(
  projectRoot,
  lifecycle,
  expectedPlanDigest,
) {
  const canonicalProjectRoot = await admitProjectRoot(projectRoot);
  const checkpointPath = resolveProjectPath(canonicalProjectRoot, BUILDER_CHECKPOINT_PATH);
  if (!await checkpointAuthorityExists(checkpointPath)) {
    fail("AGENTMO_BUILDER_LIFECYCLE_UPGRADE_RECOVERY_REQUIRED");
  }
  try {
    let admission = await loadBuilderCheckpointHead(checkpointPath);
    if (admission === null) fail("AGENTMO_BUILDER_LIFECYCLE_UPGRADE_RECOVERY_REQUIRED");
    admission = await upgradeBuilderCheckpointProtocol(checkpointPath, admission);
    const protocol = admission.value.hookDeactivationProtocol;
    if (protocol.state !== "upgrade-reserved"
      || lifecycle.recoveryRequired !== null
      || lifecycle.status !== "active"
      || lifecycle.activeReceiptDigest !== protocol.receiptDigest
      || admission.value.installReceiptDigest !== lifecycle.activeReceiptDigest) {
      fail("AGENTMO_BUILDER_LIFECYCLE_UPGRADE_RECOVERY_REQUIRED");
    }
    if (protocol.upgradeReservation.planDigest !== expectedPlanDigest) {
      fail("AGENTMO_BUILDER_LIFECYCLE_PLAN_CHANGED");
    }
    let resolvedLifecycle = lifecycle;
    if (!isCommittedUpgradeAbort(lifecycle, protocol)) {
      if (lifecycle.authorityHeadDigest !== protocol.lifecycleHeadDigest) {
        fail("AGENTMO_BUILDER_LIFECYCLE_UPGRADE_RECOVERY_REQUIRED");
      }
      const event = buildV1LifecycleEvent({
        action: "activate",
        invokedAs: "upgrade-abort",
        state: lifecycle,
        selection: lifecycle.activeReceipt,
        checkpointUpgradeAbortOperationId: protocol.operationId,
      });
      await appendLifecycleAuthorityRecord({
        projectRoot: canonicalProjectRoot,
        relativeRoot: LIFECYCLE_AUTHORITY_PATH,
        namespace: LIFECYCLE_NAMESPACE,
        idempotencyKey: `upgrade-abort:${protocol.operationId.slice("sha256:".length)}`,
        expectedHeadDigest: lifecycle.authorityHeadDigest,
        payload: event,
      });
      resolvedLifecycle = await readBuilderLifecycleState({ projectRoot: canonicalProjectRoot });
    }
    const lifecycleAuthorityAdmission = await admitBuilderCheckpointLifecycleAuthority({
      checkpointAdmission: admission,
      projectRoot: canonicalProjectRoot,
      expectedHeadDigest: resolvedLifecycle.authorityHeadDigest,
    });
    return await abortBuilderCheckpointUpgrade(checkpointPath, {
      checkpointAdmission: admission,
      lifecycleAuthorityAdmission,
      planDigest: protocol.upgradeReservation.planDigest,
      successorReceiptDigest: protocol.upgradeReservation.successorReceiptDigest,
    });
  } catch (error) {
    if (error instanceof BuilderLifecycleError) throw error;
    if (error instanceof BuilderCheckpointError) {
      fail("AGENTMO_BUILDER_LIFECYCLE_UPGRADE_RECOVERY_REQUIRED");
    }
    throw error;
  }
}

function isCommittedUpgradeAbort(lifecycle, protocol) {
  const transition = lifecycle.transitions.at(-1);
  return lifecycle.recoveryRequired === null
    && lifecycle.status === "active"
    && lifecycle.activeReceiptDigest === protocol.receiptDigest
    && lifecycle.authorityHeadDigest !== protocol.lifecycleHeadDigest
    && transition?.action === "activate"
    && transition.invokedAs === "upgrade-abort"
    && transition.checkpointCoordinationKind === "checkpoint-upgrade-abort"
    && transition.checkpointUpgradeOperationId === protocol.operationId;
}

async function assertV1UpgradePredecessor(projectRoot, expected) {
  const current = await readBuilderLifecycleState({ projectRoot });
  if (current.recoveryRequired !== null
    || current.status !== "active"
    || current.authorityHeadDigest !== expected.authorityHeadDigest
    || current.activeReceiptDigest !== expected.activeReceiptDigest) {
    fail("AGENTMO_BUILDER_LIFECYCLE_PLAN_CHANGED");
  }
  return current;
}

function assertV1UpgradeSuccessor(state, predecessor, successorReceiptDigest, reservation) {
  if (state.recoveryRequired !== null
    || state.status !== "active"
    || state.activeReceiptDigest !== successorReceiptDigest
    || state.authorityHeadDigest === predecessor.authorityHeadDigest) {
    fail("AGENTMO_BUILDER_LIFECYCLE_POSTCONDITION_FAILED");
  }
  if (reservation !== null
    && state.transitions.at(-1)?.checkpointUpgradeOperationId
      !== reservation.value.hookDeactivationProtocol.operationId) {
    fail("AGENTMO_BUILDER_LIFECYCLE_UPGRADE_RECOVERY_REQUIRED");
  }
}

async function checkpointAuthorityExists(checkpointPath) {
  try {
    const stats = await lstat(checkpointPath);
    return stats.isFile() && !stats.isSymbolicLink();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function checkpointState(projectRoot) {
  const observed = await inspectFile(projectRoot, BUILDER_CHECKPOINT_PATH);
  return observed.status === "missing"
    ? { path: BUILDER_CHECKPOINT_PATH, status: "absent", preserved: true }
    : observed.status === "file"
      ? { path: BUILDER_CHECKPOINT_PATH, status: "present", digest: observed.digest, preserved: true }
      : { path: BUILDER_CHECKPOINT_PATH, status: "unsafe", preserved: true };
}

async function lifecycleQuarantineState(projectRoot) {
  const root = resolveProjectPath(projectRoot, LIFECYCLE_QUARANTINE_PATH);
  if (await inspectParentChain(projectRoot, path.dirname(root)) !== "present") {
    return { path: LIFECYCLE_QUARANTINE_PATH, status: "unsafe" };
  }
  try {
    const stats = await lstat(root, { bigint: true });
    if (!privateDirectoryExact(stats) || await realpath(root) !== root) {
      return { path: LIFECYCLE_QUARANTINE_PATH, status: "present" };
    }
    const entries = await readdir(root, { withFileTypes: true });
    if (entries.length === 0) return { path: LIFECYCLE_QUARANTINE_PATH, status: "present" };
    let retained = 0;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()
        || !RETAINED_QUARANTINE_PATTERN.test(entry.name)
        || !await inspectRetainedLifecycleDirectory(path.join(root, entry.name))) {
        return { path: LIFECYCLE_QUARANTINE_PATH, status: "present" };
      }
      retained += 1;
    }
    return { path: LIFECYCLE_QUARANTINE_PATH, status: "retained", count: retained };
  } catch (error) {
    if (error?.code === "ENOENT") return { path: LIFECYCLE_QUARANTINE_PATH, status: "absent" };
    return { path: LIFECYCLE_QUARANTINE_PATH, status: "unsafe" };
  }
}

async function inspectRetainedLifecycleDirectory(directory) {
  try {
    const stats = await lstat(directory, { bigint: true });
    if (!privateDirectoryExact(stats) || await realpath(directory) !== directory) return false;
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.length === 0 || entries.length > 2 * EXPECTED_FILES.length + 2) return false;
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !QUARANTINE_ENTRY_PATTERN.test(entry.name)) {
        return false;
      }
      const fileStats = await lstat(path.join(directory, entry.name), { bigint: true });
      if (!fileStats.isFile() || fileStats.isSymbolicLink() || fileStats.nlink < 1n) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function countUnknownPluginEntries(projectRoot, ignoredAbsolutePaths = []) {
  const root = resolveProjectPath(projectRoot, BUILDER_PLUGIN_ROOT);
  try {
    const rootStats = await lstat(root);
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory() || await realpath(root) !== root) {
      return { count: 0, status: "unsafe" };
    }
  } catch (error) {
    if (error?.code === "ENOENT") return { count: 0, status: "absent" };
    return { count: 0, status: "unsafe" };
  }
  const knownFiles = new Set(BUILDER_PLUGIN_FILES);
  const ignored = new Set(ignoredAbsolutePaths.map((entry) => path.resolve(entry)));
  const knownDirs = new Set();
  for (const file of knownFiles) {
    const parts = file.split("/");
    for (let index = 1; index < parts.length; index += 1) knownDirs.add(parts.slice(0, index).join("/"));
  }
  let count = 0;
  const stack = [{ absolute: root, relative: "" }];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = await readdir(current.absolute, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return { count, status: "absent" };
      return { count, status: "unsafe" };
    }
    if (count + entries.length > 1024) return { count: 1024, status: "unsafe" };
    for (const entry of entries) {
      const absolute = path.join(current.absolute, entry.name);
      if (ignored.has(absolute)) continue;
      const relative = current.relative ? `${current.relative}/${entry.name}` : entry.name;
      if (knownFiles.has(relative)) continue;
      if (knownDirs.has(relative) && entry.isDirectory() && !entry.isSymbolicLink()) {
        stack.push({ absolute, relative });
      } else {
        count += 1;
      }
    }
  }
  return { count, status: count === 0 ? "none" : "present" };
}

async function inspectFile(projectRoot, relativePath) {
  const destination = resolveProjectPath(projectRoot, relativePath);
  const parent = await inspectParentChain(projectRoot, path.dirname(destination));
  if (parent !== "present") return { status: parent };
  try {
    const stats = await lstat(destination, { bigint: true });
    if (stats.isSymbolicLink() || !stats.isFile()) return { status: "unsafe" };
    const registeredStages = await inspectRegisteredInstallStageLinks(projectRoot, relativePath, stats);
    const effectiveLinks = 1n + BigInt(registeredStages.length);
    if (stats.nlink !== effectiveLinks) return { status: "unsafe" };
    const retained = await readRegisteredInstallFile(destination, stats, effectiveLinks);
    const { bytes, after } = retained;
    const registeredStagesAfter = await inspectRegisteredInstallStageLinks(
      projectRoot,
      relativePath,
      after,
    );
    if (!sameStableObservedFileWithLinks(stats, after, effectiveLinks)
      || registeredStagesAfter.join("\0") !== registeredStages.join("\0")) {
      return { status: "unsafe" };
    }
    return {
      status: "file",
      bytes,
      digest: digestRawBytes(bytes),
      nlink: "1",
      identity: fileIdentity(stats, 1n),
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { status: "missing" };
    return { status: "unsafe" };
  }
}

async function readRegisteredInstallFile(destination, before, expectedLinks) {
  let handle;
  try {
    handle = await open(destination, constants.O_RDONLY | constants.O_NOFOLLOW);
    const retainedBefore = await handle.stat({ bigint: true });
    if (!sameStableObservedFileWithLinks(before, retainedBefore, expectedLinks)
      || retainedBefore.size < 0n
      || retainedBefore.size > BigInt(MAX_FILE_BYTES)) {
      throw new Error("install-file-changed");
    }
    const bytes = await readHandle(handle, retainedBefore.size);
    const retainedAfter = await handle.stat({ bigint: true });
    const after = await lstat(destination, { bigint: true });
    if (!sameStableObservedFileWithLinks(retainedBefore, retainedAfter, expectedLinks)
      || !sameStableObservedFileWithLinks(retainedAfter, after, expectedLinks)) {
      throw new Error("install-file-changed");
    }
    return { bytes, after };
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function inspectRegisteredInstallStageLinks(projectRoot, relativePath, destinationStats) {
  const authority = await readAppendOnlyAuthority({
    projectRoot,
    relativeRoot: BUILDER_INSTALL_ATTEMPT_AUTHORITY_PATH,
    namespace: "builder-install",
  });
  const registered = new Set();
  for (const record of authority.records) {
    const payload = record.payload;
    if (!validLifecycleInstallAttempt(payload)) {
      throw new Error("install-attempt-authority");
    }
    for (const stage of payload.stages) {
      if (stage?.destinationPath !== relativePath) continue;
      if (!portableRelativePath(stage.relativePath)
        || stage.relativePath === relativePath
        || stage.identity?.device !== destinationStats.dev.toString(10)
        || stage.identity?.inode !== destinationStats.ino.toString(10)
        || stage.identity?.links !== "1"
        || stage.identity?.size !== destinationStats.size.toString(10)) {
        throw new Error("install-stage-authority");
      }
      const stagePath = resolveProjectPath(projectRoot, stage.relativePath);
      const stageParent = await inspectParentChain(projectRoot, path.dirname(stagePath));
      if (stageParent !== "present") throw new Error("install-stage-parent");
      const stageStats = await lstat(stagePath, { bigint: true });
      if (stageStats.isSymbolicLink()
        || !stageStats.isFile()
        || !sameIdentity(destinationStats, stageStats)
        || stageStats.size !== destinationStats.size) {
        throw new Error("install-stage-changed");
      }
      registered.add(stagePath);
    }
  }
  return [...registered].toSorted();
}

function validLifecycleInstallAttempt(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const commonKeys = [
    "schemaVersion",
    "operationId",
    "disposition",
    "planDigest",
    "scopeDigest",
    "receiptDigest",
    "errorCode",
    "hostReservation",
    "physicalDeletion",
    "files",
    "stages",
  ];
  const allowedKeys = value.schemaVersion === "agentmo.builder-install-attempt.v1"
    ? [...commonKeys, "recoveryStateDigest"]
    : value.schemaVersion === "agentmo.builder-install-attempt.v2"
      ? [...commonKeys, "finalProjectionBinding", "recoveryStateDigest"]
      : [];
  if (allowedKeys.length === 0
    || commonKeys.some((key) => !Object.hasOwn(value, key))
    || Object.keys(value).some((key) => !allowedKeys.includes(key))
    || !/^[a-f0-9]{64}$/u.test(value.operationId ?? "")
    || ![
      "attempt",
      "prepared",
      "activation-finalized",
      "committed",
      "aborted",
      "superseded",
    ].includes(value.disposition)
    || (value.schemaVersion === "agentmo.builder-install-attempt.v1"
      && value.disposition === "activation-finalized")
    || !DIGEST_PATTERN.test(value.planDigest ?? "")
    || !DIGEST_PATTERN.test(value.scopeDigest ?? "")
    || !(value.receiptDigest === null || DIGEST_PATTERN.test(value.receiptDigest ?? ""))
    || !(value.errorCode === null
      || /^AGENTMO_BUILDER_[A-Z0-9_]+$/u.test(value.errorCode ?? ""))
    || value.physicalDeletion !== false
    || !Array.isArray(value.files)
    || !Array.isArray(value.stages)
    || (Object.hasOwn(value, "recoveryStateDigest")
      && !(value.recoveryStateDigest === null
        || DIGEST_PATTERN.test(value.recoveryStateDigest ?? "")))
    || (value.schemaVersion === "agentmo.builder-install-attempt.v1"
      ? value.hostReservation !== null || Object.hasOwn(value, "finalProjectionBinding")
      : value.hostReservation === null || !Object.hasOwn(value, "finalProjectionBinding"))) {
    return false;
  }
  if (value.schemaVersion === "agentmo.builder-install-attempt.v2"
    && value.finalProjectionBinding !== null) {
    try {
      validateLifecycleFinalProjectionBinding(value.finalProjectionBinding, {
        selector: {
          pluginId: "agentmo@agentmo-local",
          pluginName: "agentmo",
          marketplaceName: "agentmo-local",
        },
        releaseDigest: value.finalProjectionBinding.releaseDigest,
        contentDigest: value.finalProjectionBinding.contentDigest,
      });
    } catch {
      return false;
    }
  }
  return value.stages.every((stage) => (
    stage
    && typeof stage === "object"
    && !Array.isArray(stage)
    && Object.keys(stage).toSorted().join("\0") === [
      "destinationPath",
      "digest",
      "identity",
      "relativePath",
    ].toSorted().join("\0")
    && portableRelativePath(stage.relativePath)
    && portableRelativePath(stage.destinationPath)
    && stage.relativePath !== stage.destinationPath
    && DIGEST_PATTERN.test(stage.digest ?? "")
    && stage.identity
    && Object.keys(stage.identity).toSorted().join("\0") === [
      "device",
      "inode",
      "links",
      "size",
    ].toSorted().join("\0")
    && ["device", "inode", "size"].every(
      (key) => /^\d+$/u.test(stage.identity[key] ?? ""),
    )
    && stage.identity.links === "1"
  ));
}

async function inspectParentChain(projectRoot, parentPath) {
  let current = projectRoot;
  for (const segment of path.relative(projectRoot, parentPath).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink() || !stats.isDirectory()) return "unsafe";
      if (await realpath(current) !== current) return "unsafe";
    } catch (error) {
      if (error?.code === "ENOENT") return "missing";
      return "unsafe";
    }
  }
  return "present";
}

// Immutable successors are admitted from a path, rather than a retained file
// descriptor.  Bind the complete path prefix as well as each final/stage
// inode, so an attacker cannot replay valid leaves through a replaced parent.
async function inspectV1ExistingCanonicalParentChain(
  projectRoot,
  parentPath,
  code = "AGENTMO_BUILDER_LIFECYCLE_PATH_ESCAPE",
) {
  const relative = path.relative(projectRoot, parentPath);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    fail(code);
  }
  const chain = [];
  let current = projectRoot;
  const segments = relative.split(path.sep).filter(Boolean);
  for (let index = -1; index < segments.length; index += 1) {
    if (index >= 0) current = path.join(current, segments[index]);
    let stats;
    try {
      stats = await lstat(current, { bigint: true });
    } catch (error) {
      if (error?.code === "ENOENT") return deepFreeze(chain);
      fail(code);
    }
    try {
      if (stats.isSymbolicLink() || !stats.isDirectory() || await realpath(current) !== current) {
        fail(code);
      }
    } catch (error) {
      if (error instanceof BuilderLifecycleError) throw error;
      fail(code);
    }
    chain.push(Object.freeze({
      relativePath: index < 0
        ? ""
        : path.relative(projectRoot, current).split(path.sep).join("/"),
      device: stats.dev.toString(10),
      inode: stats.ino.toString(10),
    }));
  }
  return deepFreeze(chain);
}

async function inspectV1CanonicalParentChain(projectRoot, parentPath, code) {
  const chain = await inspectV1ExistingCanonicalParentChain(projectRoot, parentPath, code);
  const expectedPaths = v1ParentChainPaths(projectRoot, parentPath);
  if (chain.length !== expectedPaths.length
    || chain.some((entry, index) => entry.relativePath !== expectedPaths[index])) {
    fail(code);
  }
  return chain;
}

function v1ParentChainPaths(projectRoot, parentPath) {
  const relative = path.relative(projectRoot, parentPath);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    fail("AGENTMO_BUILDER_LIFECYCLE_PATH_ESCAPE");
  }
  const paths = [""];
  const segments = relative.split(path.sep).filter(Boolean);
  for (let index = 0; index < segments.length; index += 1) {
    paths.push(segments.slice(0, index + 1).join("/"));
  }
  return paths;
}

function validV1RecordedParentChain(value, relativePath) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) return false;
  const expectedPaths = v1ParentChainPathsForRelativeFile(relativePath);
  return value.length === expectedPaths.length && value.every((entry, index) => (
    entry
    && typeof entry === "object"
    && !Array.isArray(entry)
    && Object.keys(entry).toSorted().join("\0") === ["device", "inode", "relativePath"].join("\0")
    && entry.relativePath === expectedPaths[index]
    && /^\d+$/u.test(entry.device ?? "")
    && /^\d+$/u.test(entry.inode ?? "")
  ));
}

function v1ParentChainPathsForRelativeFile(relativePath) {
  const parent = path.posix.dirname(relativePath);
  const paths = [""];
  if (parent === ".") return paths;
  const segments = parent.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    paths.push(segments.slice(0, index + 1).join("/"));
  }
  return paths;
}

function validV1FileIdentity(value) {
  return Boolean(value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).toSorted().join("\0") === [
      "device", "inode", "links", "size",
    ].join("\0")
    && ["device", "inode", "links", "size"].every(
      (key) => /^\d+$/u.test(value[key] ?? ""),
    )
    && value.links === "2");
}

async function assertV1ImmutableParentChain(projectRoot, parentPath, expectedParentChain) {
  const actual = await inspectV1CanonicalParentChain(
    projectRoot,
    parentPath,
    "AGENTMO_BUILDER_IMMUTABLE_RELEASE_CHANGED",
  );
  if (!sameV1ParentChain(actual, expectedParentChain)) {
    fail("AGENTMO_BUILDER_IMMUTABLE_RELEASE_CHANGED");
  }
  return actual;
}

function sameV1ParentChain(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((entry, index) => (
      entry?.relativePath === right[index]?.relativePath
      && entry.device === right[index]?.device
      && entry.inode === right[index]?.inode
    ));
}

function createV1ImmutableParentLedger(parentChain) {
  if (!Array.isArray(parentChain) || parentChain.length === 0) {
    fail("AGENTMO_BUILDER_LIFECYCLE_PLAN_CHANGED");
  }
  const ledger = new Map();
  recordV1ParentChain(ledger, parentChain, "AGENTMO_BUILDER_LIFECYCLE_PLAN_CHANGED");
  return ledger;
}

function recordV1ParentChain(ledger, parentChain, code) {
  for (const entry of parentChain) {
    const prior = ledger.get(entry.relativePath);
    if (prior !== undefined && (prior.device !== entry.device || prior.inode !== entry.inode)) {
      fail(code);
    }
    ledger.set(entry.relativePath, entry);
  }
}

async function assertV1KnownParentChain(projectRoot, expectedParentChain, code) {
  for (const expected of expectedParentChain) {
    const absolute = expected.relativePath === ""
      ? projectRoot
      : resolveProjectPath(projectRoot, expected.relativePath);
    const actual = await inspectV1CanonicalParentChain(projectRoot, absolute, code);
    const observed = actual.at(-1);
    if (observed.device !== expected.device || observed.inode !== expected.inode) fail(code);
  }
}

function assertV1ParentChainMatchesLedger(parentChain, ledger, code) {
  for (const entry of parentChain) {
    const expected = ledger.get(entry.relativePath);
    if (expected !== undefined
      && (expected.device !== entry.device || expected.inode !== entry.inode)) {
      fail(code);
    }
  }
}

async function assertExactFile(projectRoot, relativePath, expectedDigest, expectedIdentity = undefined) {
  const observed = await inspectFile(projectRoot, relativePath);
  if (observed.status !== "file" || observed.digest !== expectedDigest
    || (expectedIdentity !== undefined && !sameFileIdentity(observed.identity, expectedIdentity))) {
    fail("AGENTMO_BUILDER_LIFECYCLE_PLAN_CHANGED");
  }
  return observed;
}

async function readHandle(handle, size) {
  if (size < 0n || size > BigInt(MAX_FILE_BYTES)) fail("AGENTMO_BUILDER_LIFECYCLE_PLAN_CHANGED");
  const bytes = Buffer.alloc(Number(size));
  let offset = 0;
  while (offset < bytes.length) {
    const result = await handle.read(bytes, offset, bytes.length - offset, offset);
    if (!Number.isInteger(result.bytesRead) || result.bytesRead <= 0) fail("AGENTMO_BUILDER_LIFECYCLE_PLAN_CHANGED");
    offset += result.bytesRead;
  }
  return bytes;
}

function requireExpectedReceiptDigest(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)
    || !DIGEST_PATTERN.test(options.expectedReceiptDigest ?? "")) {
    fail("AGENTMO_BUILDER_LIFECYCLE_RECEIPT_DIGEST_REQUIRED");
  }
  return options.expectedReceiptDigest;
}

async function admitProjectRoot(value) {
  try {
    if (typeof value !== "string" || value.length === 0 || value.includes("\0")) throw new Error("root");
    const root = await realpath(path.resolve(value));
    const stats = await lstat(root);
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error("root");
    return root;
  } catch {
    fail("AGENTMO_BUILDER_LIFECYCLE_SCOPE_REJECTED");
  }
}

function resolveProjectPath(projectRoot, relativePath) {
  if (!portableRelativePath(relativePath)) fail("AGENTMO_BUILDER_LIFECYCLE_PATH_UNSAFE");
  const destination = path.resolve(projectRoot, ...relativePath.split("/"));
  if (destination === projectRoot || !destination.startsWith(`${projectRoot}${path.sep}`)) {
    fail("AGENTMO_BUILDER_LIFECYCLE_PATH_UNSAFE");
  }
  return destination;
}

function portableRelativePath(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 240
    && !value.includes("\\") && !value.includes("\0") && !path.posix.isAbsolute(value)
    && value.split("/").every((item) => item.length > 0 && item !== "." && item !== "..");
}

function requireKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("shape");
  const actual = Object.keys(value);
  if (actual.length !== keys.length || keys.some((key, index) => actual[index] !== key)) throw new Error("shape");
}

function requireKeySet(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).toSorted().join("\0") !== [...keys].toSorted().join("\0")) {
    throw new Error("shape");
  }
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameRetainedFile(left, right, expectedLinks) {
  return sameIdentity(left, right)
    && left.isFile()
    && right.isFile()
    && !left.isSymbolicLink()
    && !right.isSymbolicLink()
    && left.nlink === expectedLinks
    && right.nlink === expectedLinks
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function privateDirectoryExact(stats) {
  return stats.isDirectory()
    && !stats.isSymbolicLink()
    && (stats.mode & 0o077n) === 0n
    && (typeof process.getuid !== "function" || stats.uid === BigInt(process.getuid()));
}

function sameStableObservedFile(left, right) {
  return sameStableObservedFileWithLinks(left, right, 1n);
}

function sameStableObservedFileWithLinks(left, right, expectedLinks) {
  return sameIdentity(left, right)
    && left.isFile()
    && right.isFile()
    && !left.isSymbolicLink()
    && !right.isSymbolicLink()
    && left.nlink === expectedLinks
    && right.nlink === expectedLinks
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function fileIdentity(stats, effectiveLinks = stats.nlink) {
  return {
    device: stats.dev.toString(10),
    inode: stats.ino.toString(10),
    links: effectiveLinks.toString(10),
    size: stats.size.toString(10),
  };
}

function sameFileIdentity(left, right) {
  return Boolean(left && right
    && left.device === right.device
    && left.inode === right.inode
    && left.links === right.links
    && left.size === right.size);
}

function digestJson(value, subject) {
  return digestRawBytes(Buffer.from(serializePersistableJson(value, { subject }), "utf8"));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function fail(code) {
  throw new BuilderLifecycleError(code);
}
