import { constants as FS_CONSTANTS } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { digestRawBytes } from "./artifact-admission.js";
import {
  appendAppendOnlyRecord,
  readAppendOnlyAuthority,
} from "./builder-append-only-authority.js";
import {
  buildBuilderCheckpoint,
  fenceBuilderCheckpointDeactivation,
  loadBuilderCheckpoint,
  upgradeBuilderCheckpointProtocol,
} from "./builder-checkpoint.js";
import {
  appendCodexUatCandidateReady,
  armCodexUatScenario,
  loadCodexUatAttemptJournal,
  loadCodexUatCandidate,
  loadExistingCodexUatCandidate,
  loadCodexUatObservationLeaf,
  publishCodexUatCandidate,
  publishCodexUatObservationLeaf,
  releaseCodexUatLeafDirectoryAuthority,
  recordCodexUatScenarioObservation,
  retainCodexUatLeafDirectoryAuthority,
} from "./builder-codex-uat.js";
import { buildBuilderEvent, reduceBuilderHookEvent } from "./builder-events.js";
import {
  loadImmutableJournal,
  readImmutableJournalAdmissionBytes,
} from "./builder-immutable-journal.js";
import {
  applyBuilderDeactivate,
  planBuilderDeactivate,
  readBuilderLifecycleState,
} from "./builder-lifecycle.js";
import {
  admitBuilderUatReleaseMember,
} from "./builder-package.js";
import { assertBuilderPlatform } from "./builder-platform.js";
import { serializePersistableJson } from "./persistability.js";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const MAX_CONTINUATION_FILE_BYTES = 32 * 1024 * 1024;
const CONTINUATION_SOURCE_PATH = "src/builder-codex-uat-continuation.js";
const VERIFIER_SOURCE_PATH = "scripts/verify-codex-uat-candidate.js";
const RELEASE_MANIFEST_PATH = "src/builder-codex-uat-release-manifest.json";
const PROJECT_RECEIPT_PATH = ".agentmo/builder/install-receipt.json";
const PROJECT_LAUNCHER_PATH = ".codex/agents/agentmo.toml";
const SHARED_RUNTIME_LAUNCHER_PATH = [
  ".agentmo", "builder", "codex-host", "marketplace", "agentmo-local",
  "plugins", "agentmo", "runtime", "agentmo", "bin", "agentmo.js",
];
const JOURNAL_BASENAME = "attempt.journal";
const CHECKPOINT_BASENAME = "continuation-checkpoint.json";
const CANDIDATE_DIRECTORY_BASENAME = "candidates";
const OBSERVATION_DIRECTORY_BASENAME = "observations";
const DEACTIVATION_ARM_BASENAME = "deactivation-arm-authority";
const DEACTIVATION_ARM_SCHEMA_VERSION = "agentmo.codex-uat-deactivation-armed.v2";
const LEGACY_CHECKPOINT_SCHEMA_VERSION = "agentmo.builder-checkpoint.v3";
const CHECKPOINT_SCHEMA_VERSION = "agentmo.builder-checkpoint.v4";

export class BuilderCodexUatContinuationError extends Error {
  constructor() {
    super("Codex UAT continuation was rejected.");
    this.name = "BuilderCodexUatContinuationError";
    this.code = "AGENTMO_CODEX_UAT_CONTINUATION_REJECTED";
  }
}

export async function continueCodexUatAfterDeactivation(options) {
  assertBuilderPlatform();
  try {
    return await continueBoundCodexUat(options);
  } catch (error) {
    if (error instanceof BuilderCodexUatContinuationError) throw error;
    fail();
  }
}

export async function continueCodexUatAfterUninstall(options) {
  assertBuilderPlatform();
  if (!options || typeof options !== "object" || Array.isArray(options)) fail();
  const { approvedUninstallPlanDigest, ...rest } = options;
  return continueCodexUatAfterDeactivation({
    ...rest,
    approvedDeactivationPlanDigest: options.approvedDeactivationPlanDigest
      ?? approvedUninstallPlanDigest,
  });
}

async function continueBoundCodexUat(options) {
  if (!exactKeys(options, [
    "attemptDir",
    "expectedHeadDigest",
    "approvedDeactivationPlanDigest",
    "successorTarball",
    "expectedSuccessorVersion",
    "expectedReleaseDigest",
    "expectedTarballDigest",
    "expectedVerifierDigest",
  ])
    || typeof options.attemptDir !== "string"
    || options.attemptDir.length === 0
    || typeof options.successorTarball !== "string"
    || options.successorTarball.length === 0
    || !VERSION_PATTERN.test(options.expectedSuccessorVersion ?? "")
    || [
      options.expectedHeadDigest,
      options.approvedDeactivationPlanDigest,
      options.expectedReleaseDigest,
      options.expectedTarballDigest,
      options.expectedVerifierDigest,
    ].some((value) => !DIGEST_PATTERN.test(value ?? ""))) {
    fail();
  }

  const layout = await admitAttemptLayout(options.attemptDir);
  const preflightView = await loadCodexUatAttemptJournal(layout.journalPath);
  await inspectContinuationAuthority(options, layout, preflightView);
  const leafAuthorities = await retainLayoutLeafAuthorities(layout);
  try {
    const view = await loadCodexUatAttemptJournal(layout.journalPath);
    const {
      observing,
      scenariosComplete,
      candidateReady,
      deactivationArm,
      release,
    } = await inspectContinuationAuthority(options, layout, view);
    if (candidateReady) return await recoverCompletedCandidateReady(
      layout,
      view,
      release,
      options.approvedDeactivationPlanDigest,
      leafAuthorities,
      deactivationArm.value,
    );
    if (scenariosComplete) return await recoverCandidateReady(
      layout,
      view,
      release,
      options.approvedDeactivationPlanDigest,
      leafAuthorities,
      deactivationArm.value,
    );
    if (deactivationArm !== null) {
      const lifecycle = await readBuilderLifecycleState({ projectRoot: layout.projectRoot });
      if (lifecycle.status === "deactivated") {
        return await completeArmedDeactivation(
          layout,
          view,
          release,
          options.approvedDeactivationPlanDigest,
          leafAuthorities,
          deactivationArm.value,
        );
      }
    }
    return await crossDeactivationBoundary(
      layout,
      view,
      release,
      options.approvedDeactivationPlanDigest,
      leafAuthorities,
      deactivationArm?.value ?? null,
    );
  } finally {
    await Promise.allSettled([
      releaseCodexUatLeafDirectoryAuthority(leafAuthorities.candidate),
      releaseCodexUatLeafDirectoryAuthority(leafAuthorities.observation),
    ]);
  }
}

async function inspectContinuationAuthority(options, layout, view) {
  if (view.head === null) fail();
  const observing = view.state.phase === "observing"
    && view.state.nextScenario === "deactivation-tombstone-visibility"
    && view.state.scenarioCount === 10;
  const scenariosComplete = view.state.phase === "scenarios-complete"
    && view.state.nextScenario === null
    && view.state.scenarioCount === 11;
  const candidateReady = view.state.phase === "candidate-ready"
    && view.state.nextScenario === null
    && view.state.scenarioCount === 11
    && view.state.terminal === false;
  if (!observing && !scenariosComplete && !candidateReady) fail();

  const deactivationArm = await loadDeactivationArm(layout);
  const initialHeadDigest = observing
    ? view.head.digest
    : initialContinuationHeadDigest(view);
  if (observing) {
    if (options.expectedHeadDigest !== view.head.digest) fail();
  } else if (deactivationArm === null
    || !continuationInputHeadDigests(view, deactivationArm.value)
      .includes(options.expectedHeadDigest)) {
    fail();
  }

  const release = await admitSuccessorRelease(options, view);
  if (deactivationArm !== null) {
    validateDeactivationArm(
      deactivationArm.value,
      initialHeadDigest,
      release,
      options.approvedDeactivationPlanDigest,
    );
  }
  return Object.freeze({
    observing,
    scenariosComplete,
    candidateReady,
    deactivationArm,
    release,
  });
}

async function retainLayoutLeafAuthorities(layout) {
  const candidate = await retainCodexUatLeafDirectoryAuthority(layout.candidateDirectory);
  try {
    return Object.freeze({
      candidate,
      observation: await retainCodexUatLeafDirectoryAuthority(layout.observationDirectory),
    });
  } catch (error) {
    await releaseCodexUatLeafDirectoryAuthority(candidate).catch(() => {});
    throw error;
  }
}

async function admitSuccessorRelease(options, view) {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const packageRootReal = await realpath(packageRoot);
  if (packageRootReal !== packageRoot) fail();
  const manifestCapture = await captureStableFile(
    path.join(packageRoot, RELEASE_MANIFEST_PATH),
    256 * 1024,
  );
  const admission = await admitBuilderUatReleaseMember({
    packageRoot,
    tarballPath: path.resolve(options.successorTarball),
    expectedRole: "successor",
    maxBytes: MAX_CONTINUATION_FILE_BYTES,
  });
  try {
    const manifest = parseReleaseManifest(manifestCapture.bytes);
    const pair = normalizeAdmittedReleasePair(admission.releaseSet);
    if (options.expectedVerifierDigest !== manifest.verifier.sha256) fail();
    if (admission.tarballDigest !== options.expectedTarballDigest
      || admission.manifestDigest !== digestRawBytes(manifestCapture.bytes)
      || admission.verifierDigest !== manifest.verifier.sha256
      || admission.continuationDigest !== manifest.continuation.sha256) fail();

    const loaded = admission.release;
    const continuationAsset = loaded.assets.find(
      (asset) => asset.sourcePath === CONTINUATION_SOURCE_PATH,
    );
    if (loaded.name !== view.state.successor.packageName
      || loaded.name !== manifest.packageName
      || loaded.version !== options.expectedSuccessorVersion
      || loaded.version !== view.state.successor.version
      || loaded.version !== manifest.version
      || loaded.releaseDigest !== options.expectedReleaseDigest
      || loaded.releaseDigest !== view.state.successor.releaseDigest
      || options.expectedTarballDigest !== view.state.successor.tarballDigest
      || !sameReleaseMember(view.state.baseline, pair.baseline)
      || !sameReleaseMember(view.state.successor, pair.successor)
      || admission.operationId !== view.state.releaseSet?.operationId
      || admission.releaseSetDigest !== view.state.releaseSet?.releaseSetDigest
      || continuationAsset?.digest !== manifest.continuation.sha256
      || manifest.continuation.sourcePath !== CONTINUATION_SOURCE_PATH) {
      fail();
    }
    const verifierCapture = await captureStableFile(
      path.join(packageRoot, manifest.verifier.sourcePath),
      256 * 1024,
    );
    try {
      if (digestRawBytes(verifierCapture.bytes) !== manifest.verifier.sha256) fail();
    } finally {
      await verifierCapture.handle.close().catch(() => {});
    }
    return Object.freeze({
      packageName: loaded.name,
      version: loaded.version,
      releaseDigest: loaded.releaseDigest,
      tarballDigest: options.expectedTarballDigest,
      baseline: pair.baseline,
      successor: pair.successor,
      operationId: admission.operationId,
      releaseSetDigest: admission.releaseSetDigest,
      continuationDigest: continuationAsset.digest,
      manifestDigest: digestRawBytes(manifestCapture.bytes),
      verifierDigest: manifest.verifier.sha256,
      projectLauncherDigest: loaded.assets.find(
        (asset) => asset.sourcePath === "plugin/agents/agentmo.toml",
      )?.digest,
      sharedRuntimeLauncherDigest: loaded.assets.find(
        (asset) => asset.sourcePath === "bin/agentmo.js",
      )?.digest,
    });
  } finally {
    await manifestCapture.handle.close().catch(() => {});
  }
}

function normalizeAdmittedReleasePair(value) {
  if (!exactKeys(value, ["baseline", "successor"])) fail();
  return Object.freeze({
    baseline: normalizeAdmittedReleaseMember(value.baseline),
    successor: normalizeAdmittedReleaseMember(value.successor),
  });
}

function normalizeAdmittedReleaseMember(value) {
  const keys = [
    "continuationDigest", "manifestDigest", "packageName", "releaseDigest",
    "tarballDigest", "verifierDigest", "version",
  ];
  if (!exactKeys(value, keys)
    || typeof value.packageName !== "string"
    || !VERSION_PATTERN.test(value.version ?? "")
    || [
      value.releaseDigest,
      value.tarballDigest,
      value.manifestDigest,
      value.verifierDigest,
      value.continuationDigest,
    ].some((digest) => !DIGEST_PATTERN.test(digest ?? ""))) {
    fail();
  }
  return Object.freeze({
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

async function crossDeactivationBoundary(
  layout,
  view,
  release,
  approvedDeactivationPlanDigest,
  leafAuthorities,
  existingArm,
) {
  const upgradeEntry = view.entries.at(-1);
  if (upgradeEntry?.kind !== "scenario-observed"
    || upgradeEntry.details.scenario !== "upgrade-visibility"
    || upgradeEntry.details.evidence.successorVersion !== release.version
    || upgradeEntry.details.evidence.releaseDigest !== release.releaseDigest
    || upgradeEntry.details.evidence.tarballDigest !== release.tarballDigest) {
    fail();
  }

  const lifecycleBefore = await readBuilderLifecycleState({ projectRoot: layout.projectRoot });
  if (lifecycleBefore.status !== "active") fail();
  const receiptRelativePath = lifecycleBefore.activeReceiptPath;
  const receiptPath = path.join(layout.projectRoot, ...receiptRelativePath.split("/"));
  const receiptCapture = await captureStableFile(receiptPath, 256 * 1024, {
    allowedLinks: [1n, 2n],
  });
  let launcherCapture = null;
  let sharedLauncherCapture = null;
  const retainedDirectories = [];
  const preservedFiles = [];
  try {
    const receiptDigest = digestRawBytes(receiptCapture.bytes);
    if (receiptDigest !== upgradeEntry.details.evidence.installReceiptDigest) fail();
    const receipt = parseInstalledReceipt(receiptCapture.bytes);
    const launcher = receipt.files.find((entry) => (
      entry.relativePath === PROJECT_LAUNCHER_PATH
      || entry.relativePath.endsWith("/project-agent.toml")
    ));
    const launcherDigest = launcher?.destinationDigest ?? launcher?.digest;
    const launcherRelativePath = launcher?.relativePath;
    if (!safeProjectRelativePath(launcherRelativePath)) fail();
    launcherCapture = await captureStableFile(
      path.join(layout.projectRoot, ...launcherRelativePath.split("/")),
      256 * 1024,
      { allowedLinks: [1n, 2n] },
    );
    if (receipt.identity.name !== release.packageName
      || receipt.identity.version !== release.version
      || receipt.identity.releaseDigest !== release.releaseDigest
      || launcherDigest !== release.projectLauncherDigest
      || launcherDigest !== digestRawBytes(launcherCapture.bytes)) {
      fail();
    }
    if (receipt.status === "activated") {
      sharedLauncherCapture = await captureStableFile(
        path.join(path.resolve(homedir()), ...SHARED_RUNTIME_LAUNCHER_PATH),
        256 * 1024,
        { allowExecutable: true },
      );
      if (digestRawBytes(sharedLauncherCapture.bytes) !== release.sharedRuntimeLauncherDigest) fail();
    }
    const deactivationPlan = await planBuilderDeactivate({
      projectRoot: layout.projectRoot,
      expectedReceiptDigest: receiptDigest,
    });
    if (!deactivationPlan.applicable
      || deactivationPlan.planDigest !== approvedDeactivationPlanDigest) fail();

    for (const operation of deactivationPlan.operations.filter(
      (item) => ["preserve", "preserve-shared", "unchanged"].includes(item.operation),
    )) {
      preservedFiles.push(Object.freeze({
        relativePath: operation.relativePath,
        digest: operation.currentDigest,
        capture: await captureStableFile(
          path.join(layout.projectRoot, ...operation.relativePath.split("/")),
          256 * 1024,
        ),
      }));
    }

    const lifecycleRevalidated = await readBuilderLifecycleState({
      projectRoot: layout.projectRoot,
    });
    if (lifecycleRevalidated.status !== lifecycleBefore.status
      || lifecycleRevalidated.activeReceiptDigest !== lifecycleBefore.activeReceiptDigest
      || lifecycleRevalidated.activeReceiptPath !== lifecycleBefore.activeReceiptPath
      || lifecycleRevalidated.authorityHeadDigest !== lifecycleBefore.authorityHeadDigest) fail();
    await assertRetainedCapture(receiptCapture, { pathMustExist: true });
    await assertRetainedCapture(launcherCapture, { pathMustExist: true });

    const checkpointState = await admitCheckpointBaseBeforeArm(
      layout,
      upgradeEntry.details.evidence.checkpointDigest,
      lifecycleBefore.receiptLineageDigests,
      existingArm,
    );

    const armValue = Object.freeze({
      schemaVersion: DEACTIVATION_ARM_SCHEMA_VERSION,
      expectedHeadDigest: view.head.digest,
      deactivationPlanDigest: approvedDeactivationPlanDigest,
      checkpointDigest: checkpointState.armDigest,
      releaseDigest: release.releaseDigest,
      continuationDigest: release.continuationDigest,
      releaseSet: {
        operationId: release.operationId,
        releaseSetDigest: release.releaseSetDigest,
      },
      successorRole: "successor",
      lifecycleHeadBeforeDigest: lifecycleBefore.authorityHeadDigest,
      receiptPath: receiptRelativePath,
      receiptDigest,
      receiptIdentity: persistedIdentity(receiptCapture.before),
      launcherPath: launcherRelativePath,
      launcherDigest: digestRawBytes(launcherCapture.bytes),
      launcherIdentity: persistedIdentity(launcherCapture.before),
      sharedRuntimeDigest: sharedLauncherCapture === null
        ? null
        : digestRawBytes(sharedLauncherCapture.bytes),
      preserved: preservedFiles.map(({ relativePath, digest }) => ({ relativePath, digest })),
    });
    if (existingArm === null) await publishDeactivationArm(layout, armValue);
    else if (serializePersistableJson(existingArm, { subject: "codex-uat-deactivation-armed" })
      !== serializePersistableJson(armValue, { subject: "codex-uat-deactivation-armed" })) fail();

    let checkpointAdmission = checkpointState.admission;
    checkpointAdmission = await upgradeBuilderCheckpointProtocol(
      layout.checkpointPath,
      checkpointAdmission,
    );
    await fenceBuilderCheckpointDeactivation(layout.checkpointPath, {
      checkpointAdmission,
      lifecycleHeadDigest: lifecycleBefore.authorityHeadDigest,
      receiptDigest,
    });
    retainedDirectories.push(await captureStableDirectory(layout.attemptDir));
    await applyBuilderDeactivate({
      projectRoot: layout.projectRoot,
      expectedReceiptDigest: receiptDigest,
      expectedPlanDigest: approvedDeactivationPlanDigest,
    });
    await assertRetainedCapture(launcherCapture, { pathMustExist: true });
    await assertRetainedCapture(receiptCapture, { pathMustExist: true });
    if (sharedLauncherCapture !== null) {
      await assertRetainedCapture(sharedLauncherCapture, { pathMustExist: true });
    }
    for (const directory of retainedDirectories) await assertRetainedDirectory(directory);
    for (const preserved of preservedFiles) {
      await assertRetainedCapture(preserved.capture, { pathMustExist: true });
      if (digestRawBytes(preserved.capture.bytes) !== preserved.digest) fail();
    }

    return await completeArmedDeactivation(
      layout,
      view,
      release,
      approvedDeactivationPlanDigest,
      leafAuthorities,
      armValue,
    );
  } finally {
    await Promise.allSettled([
      receiptCapture.handle.close(),
      ...(launcherCapture === null ? [] : [launcherCapture.handle.close()]),
      ...(sharedLauncherCapture === null ? [] : [sharedLauncherCapture.handle.close()]),
      ...retainedDirectories.map((item) => item.handle.close()),
      ...preservedFiles.map((item) => item.capture.handle.close()),
    ]);
  }
}

async function recoverCandidateReady(
  layout,
  view,
  release,
  approvedDeactivationPlanDigest,
  leafAuthorities,
  armValue,
) {
  await admitCompletedScenarioPrefix(
    layout,
    view,
    release,
    approvedDeactivationPlanDigest,
    leafAuthorities,
    armValue,
  );
  const candidate = await ensureCandidatePublished(layout, view, leafAuthorities.candidate);
  const ready = await appendCodexUatCandidateReady({
    journalPath: layout.journalPath,
    expectedHeadAdmission: view.head,
    candidatePath: candidate.filePath,
    expectedCandidateDigest: candidate.digest,
  });
  return continuationResult("continued", ready, candidate, release);
}

async function recoverCompletedCandidateReady(
  layout,
  view,
  release,
  approvedDeactivationPlanDigest,
  leafAuthorities,
  armValue,
) {
  await admitCompletedScenarioPrefix(
    layout,
    view,
    release,
    approvedDeactivationPlanDigest,
    leafAuthorities,
    armValue,
  );
  const candidateReady = view.entries.at(-1);
  if (candidateReady?.kind !== "candidate-ready"
    || candidateReady.details.candidateDigest !== view.state.candidateDigest) fail();
  const candidatePath = contentAddressedLeafPath(
    layout.candidateDirectory,
    candidateReady.details.candidateDigest,
  );
  await assertRetainedLeafAuthority(leafAuthorities.candidate);
  const candidate = await loadCodexUatCandidate(candidatePath, {
    expectedDigest: candidateReady.details.candidateDigest,
  });
  await assertRetainedLeafAuthority(leafAuthorities.candidate);
  assertExactCandidate(candidate, view, view.entries.slice(0, -1));
  return continuationResult("continued", view, candidate, release);
}

async function completeArmedDeactivation(
  layout,
  view,
  release,
  approvedDeactivationPlanDigest,
  leafAuthorities,
  armValue,
  checkpointAdmission = null,
) {
  validateDeactivationArm(
    armValue,
    view.head.digest,
    release,
    approvedDeactivationPlanDigest,
  );
  const admitted = await admitArmedDeactivationState(layout, armValue);
  const checkpointState = await admitCheckpointRecoveryState(
    layout,
    view,
    armValue,
    checkpointAdmission,
  );
  let armed;
  if (checkpointState.advanced) {
    armed = Object.freeze({
      correlation: checkpointState.admission.value.codexUatChallenge.correlation,
      checkpointAdmission: checkpointState.admission,
    });
  } else {
    armed = await armCodexUatScenario({
      journalPath: layout.journalPath,
      expectedHeadAdmission: view.head,
      checkpointPath: layout.checkpointPath,
      checkpointAdmission: checkpointState.admission,
    });
  }
  const observation = await ensureObservationPublished({
    layout,
    view,
    release,
    armValue,
    leafAuthority: leafAuthorities.observation,
    correlation: armed.correlation,
    visibilityDigest: admitted.visibilityDigest,
  });
  const scenariosComplete = await recordCodexUatScenarioObservation({
    journalPath: layout.journalPath,
    expectedHeadAdmission: view.head,
    checkpointAdmission: armed.checkpointAdmission,
    observationAdmission: observation,
    evidence: {
      deactivationPlanDigest: approvedDeactivationPlanDigest,
      visibilityDigest: admitted.visibilityDigest,
      lifecycleHeadDigest: admitted.lifecycle.authorityHeadDigest,
      tombstoneDigest: admitted.tombstone.digest,
      activeReceiptDigest: armValue.receiptDigest,
      launcherPreserved: true,
      currentReceiptPreserved: true,
    },
  });
  return recoverCandidateReady(
    layout,
    scenariosComplete,
    release,
    approvedDeactivationPlanDigest,
    leafAuthorities,
    armValue,
  );
}

async function admitArmedDeactivationState(layout, armValue) {
  const receiptCapture = await captureStableFile(
    path.join(layout.projectRoot, ...armValue.receiptPath.split("/")),
    256 * 1024,
    { allowedLinks: [BigInt(armValue.receiptIdentity.links)] },
  );
  const launcherCapture = await captureStableFile(
    path.join(layout.projectRoot, ...armValue.launcherPath.split("/")),
    256 * 1024,
    { allowedLinks: [BigInt(armValue.launcherIdentity.links)] },
  );
  try {
    assertPersistedIdentity(receiptCapture.before, armValue.receiptIdentity);
    assertPersistedIdentity(launcherCapture.before, armValue.launcherIdentity);
    if (digestRawBytes(receiptCapture.bytes) !== armValue.receiptDigest
      || digestRawBytes(launcherCapture.bytes) !== armValue.launcherDigest) fail();
  } finally {
    await Promise.allSettled([receiptCapture.handle.close(), launcherCapture.handle.close()]);
  }
  for (const preserved of armValue.preserved) {
    const capture = await captureStableFile(
      path.join(layout.projectRoot, ...preserved.relativePath.split("/")),
      256 * 1024,
    );
    try {
      if (digestRawBytes(capture.bytes) !== preserved.digest) fail();
    } finally {
      await capture.handle.close().catch(() => {});
    }
  }
  if (armValue.sharedRuntimeDigest !== null) {
    const shared = await captureStableFile(
      path.join(path.resolve(homedir()), ...SHARED_RUNTIME_LAUNCHER_PATH),
      256 * 1024,
      { allowExecutable: true },
    );
    try {
      if (digestRawBytes(shared.bytes) !== armValue.sharedRuntimeDigest) fail();
    } finally {
      await shared.handle.close().catch(() => {});
    }
  }
  const lifecycle = await readBuilderLifecycleState({ projectRoot: layout.projectRoot });
  const tombstone = lifecycle.tombstones.at(-1);
  if (lifecycle.status !== "deactivated"
    || lifecycle.activeReceiptDigest !== armValue.receiptDigest
    || tombstone === undefined) fail();
  const visibilityDigest = digestValue({
    schemaVersion: "agentmo.codex-uat-deactivation-visibility.v1",
    launcherPreserved: true,
    currentReceiptPreserved: true,
    launcherDigest: armValue.launcherDigest,
    activeReceiptDigest: armValue.receiptDigest,
    lifecycleHeadDigest: lifecycle.authorityHeadDigest,
    tombstoneDigest: tombstone.digest,
    sharedRuntimeDigest: armValue.sharedRuntimeDigest,
    preserved: armValue.preserved,
    broaderCertification: false,
  }, "builder-codex-uat-deactivation-visibility");
  return Object.freeze({ lifecycle, tombstone, visibilityDigest });
}

async function admitCheckpointBaseBeforeArm(
  layout,
  requiredAncestorDigest,
  acceptedReceiptDigests,
  existingArm,
) {
  const journal = await loadImmutableJournal({
    journalPath: layout.checkpointPath,
    maxValueBytes: 256 * 1024,
  });
  if (journal.head === null) fail();
  const ancestorIndex = journal.entries.findIndex(
    (entry) => entry.digest === requiredAncestorDigest,
  );
  if (ancestorIndex === -1) fail();
  for (const entry of journal.entries.slice(ancestorIndex)) {
    const value = parseCanonicalValue(
      readImmutableJournalAdmissionBytes(entry),
      "builder-checkpoint",
    );
    if (value.adapterId !== "codex"
      || !acceptedReceiptDigests.includes(value.installReceiptDigest)) fail();
  }
  const current = await loadBuilderCheckpoint(layout.checkpointPath, {
    expectedDigest: journal.head.digest,
  });
  if (!isContinuationCheckpointSchema(current.value.schemaVersion)
    || ["hook-prepared", "upgrade-reserved"].includes(
      current.value.hookDeactivationProtocol.state,
    )) fail();
  if (existingArm === null
    && current.value.codexUatChallenge?.scenario === "deactivation-tombstone-visibility") fail();
  return Object.freeze({
    armDigest: existingArm?.checkpointDigest ?? current.digest,
    admission: current,
  });
}

async function admitCheckpointRecoveryState(layout, view, armValue, suppliedAdmission = null) {
  const journal = await loadImmutableJournal({
    journalPath: layout.checkpointPath,
    maxValueBytes: 256 * 1024,
  });
  if (journal.head === null) fail();
  const baseIndex = journal.entries.findIndex(
    (entry) => entry.digest === armValue.checkpointDigest,
  );
  if (baseIndex === -1) fail();
  const suffix = journal.entries.slice(baseIndex);
  if (suffix.length < 1) fail();
  const values = suffix.map((entry) => parseCanonicalValue(
    readImmutableJournalAdmissionBytes(entry),
    "builder-checkpoint",
  ));
  const current = await loadBuilderCheckpoint(layout.checkpointPath, {
    expectedDigest: journal.head.digest,
  });
  if (!isContinuationCheckpointSchema(current.value.schemaVersion)
    || current.value.hookDeactivationProtocol.state === "upgrade-reserved") fail();
  if (suppliedAdmission !== null && suppliedAdmission.digest !== current.digest) fail();
  if (suffix.length === 1) {
    return Object.freeze({ admission: current, advanced: false });
  }
  let fenceSeen = values[0].hookDeactivationProtocol?.state === "deactivation-fenced";
  for (let index = 1; index < suffix.length; index += 1) {
    const last = index === suffix.length - 1;
    if (last && isExactDeactivationChallengeSuccessor(
      suffix[index - 1],
      values[index - 1],
      suffix[index],
      values[index],
      view.state.attemptId,
    )) return Object.freeze({ admission: current, advanced: true });
    if (isExactCheckpointProtocolMigration(
      suffix[index - 1],
      values[index - 1],
      suffix[index],
      values[index],
    )) continue;
    const protocolState = values[index].hookDeactivationProtocol?.state;
    if (protocolState === "upgrade-reserved") fail();
    if (protocolState === "deactivation-fenced") {
      if (fenceSeen
        || values[index].installReceiptDigest !== armValue.receiptDigest) fail();
      fenceSeen = true;
      continue;
    }
    if (fenceSeen) fail();
    if (isExactHookProtocolSuccessor(
      suffix[index - 1],
      values[index - 1],
      suffix[index],
      values[index],
      armValue.receiptDigest,
    )) continue;
    if (!isExactHookCheckpointSuccessor(
      values[index - 1],
      values[index],
      armValue.receiptDigest,
    )) fail();
  }
  return Object.freeze({ admission: current, advanced: false });
}

function isExactHookProtocolSuccessor(
  baseEntry,
  baseValue,
  successorEntry,
  successorValue,
  selectedReceiptDigest,
) {
  const before = baseValue.hookDeactivationProtocol;
  const after = successorValue.hookDeactivationProtocol;
  if (!isContinuationCheckpointSchema(baseValue.schemaVersion)
    || successorValue.schemaVersion !== baseValue.schemaVersion
    || successorEntry.sequence !== baseEntry.sequence + 1
    || successorEntry.predecessorDigest !== baseEntry.digest
    || successorValue.installReceiptDigest !== selectedReceiptDigest) return false;
  if (after?.state === "hook-prepared") {
    return ["open", "hook-finalized"].includes(before?.state)
      && after.predecessorCheckpointDigest === baseEntry.digest
      && after.receiptDigest === selectedReceiptDigest;
  }
  return before?.state === "hook-prepared"
    && after?.state === "hook-finalized"
    && after.operationId === before.operationId
    && after.predecessorCheckpointDigest === before.predecessorCheckpointDigest
    && after.lifecycleHeadDigest === before.lifecycleHeadDigest
    && after.receiptDigest === before.receiptDigest;
}

function isExactCheckpointProtocolMigration(
  baseEntry,
  baseValue,
  successorEntry,
  successorValue,
) {
  if (baseValue.schemaVersion !== LEGACY_CHECKPOINT_SCHEMA_VERSION
    || successorValue.schemaVersion !== CHECKPOINT_SCHEMA_VERSION
    || successorEntry.sequence !== baseEntry.sequence + 1
    || successorEntry.predecessorDigest !== baseEntry.digest) return false;
  const expectedSuccessor = {
    ...baseValue,
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    hookDeactivationProtocol: {
      ...baseValue.hookDeactivationProtocol,
      upgradeReservation: null,
    },
  };
  return serializePersistableJson(successorValue, { subject: "builder-checkpoint" })
    === serializePersistableJson(expectedSuccessor, { subject: "builder-checkpoint" });
}

function isContinuationCheckpointSchema(schemaVersion) {
  return schemaVersion === LEGACY_CHECKPOINT_SCHEMA_VERSION
    || schemaVersion === CHECKPOINT_SCHEMA_VERSION;
}

function isExactDeactivationChallengeSuccessor(
  baseEntry,
  baseValue,
  successorEntry,
  successorValue,
  attemptId,
) {
  const challenge = successorValue.codexUatChallenge;
  if (successorEntry.sequence !== baseEntry.sequence + 1
    || successorEntry.predecessorDigest !== baseEntry.digest
    || baseValue.hookDeactivationProtocol?.state !== "deactivation-fenced"
    || successorValue.hookDeactivationProtocol?.state !== "deactivation-fenced"
    || challenge?.attemptId !== attemptId
    || challenge?.scenario !== "deactivation-tombstone-visibility"
    || !/^opaque:[a-f0-9]{64}$/u.test(challenge.correlation ?? "")) return false;
  const expectedSuccessor = {
    ...baseValue,
    codexUatChallenge: {
      attemptId,
      scenario: "deactivation-tombstone-visibility",
      correlation: challenge.correlation,
    },
  };
  return serializePersistableJson(successorValue, { subject: "builder-checkpoint" })
    === serializePersistableJson(expectedSuccessor, { subject: "builder-checkpoint" });
}

function isExactHookCheckpointSuccessor(baseValue, successorValue, selectedReceiptDigest) {
  try {
    const sequence = baseValue.eventLedger.cursor + 1;
    if (successorValue.eventLedger.cursor !== sequence) return false;
    const record = successorValue.eventLedger.recentEvents.find(
      (item) => item.sequence === sequence,
    );
    if (!record || record.eventId !== `codex-${record.eventId.slice("codex-".length)}`) {
      return false;
    }
    const identity = `sha256:${record.eventId.slice("codex-".length)}`;
    if (!/^sha256:[a-f0-9]{64}$/u.test(identity)) return false;
    const cursor = exactHookCursorSuccessor(
      baseValue.codexDeliveryCursor,
      successorValue.codexDeliveryCursor,
      identity,
      sequence,
      record.digest,
    );
    if (cursor === null) return false;
    const event = buildBuilderEvent({
      workflowId: baseValue.workflowId,
      adapterId: baseValue.adapterId,
      eventId: record.eventId,
      sequence,
      origin: "hook",
      type: cursor.type,
      data: {},
    });
    if (digestRawBytes(Buffer.from(serializePersistableJson(event, {
      subject: "builder-event",
    }), "utf8")) !== record.digest) return false;
    const reduced = reduceBuilderHookEvent(buildBuilderCheckpoint(baseValue), event);
    if (!reduced.applied) return false;
    const expected = buildBuilderCheckpoint({
      ...reduced.checkpoint,
      installReceiptDigest: selectedReceiptDigest,
      codexDeliveryCursor: cursor.value,
      codexUatChallenge: baseValue.codexUatChallenge,
    });
    return serializePersistableJson(successorValue, { subject: "builder-checkpoint" })
      === serializePersistableJson(expected, { subject: "builder-checkpoint" });
  } catch {
    return false;
  }
}

function exactHookCursorSuccessor(base, successor, identity, sequence, eventDigest) {
  const record = { identity, sequence, eventDigest };
  const same = (left, right) => serializePersistableJson(left, {
    subject: "builder-codex-delivery-cursor",
  }) === serializePersistableJson(right, { subject: "builder-codex-delivery-cursor" });
  if (successor.sessionStart?.identity === identity) {
    if (successor.sessionDigest === null
      || base.sessionDigest !== null && successor.sessionDigest !== base.sessionDigest) return null;
    const expected = { ...base, sessionDigest: successor.sessionDigest, sessionStart: record };
    return same(successor, expected) ? { type: "SessionStart", value: expected } : null;
  }
  if (successor.preCompact?.identity === identity) {
    if (base.sessionStart === null || !["idle", "post-applied"].includes(base.compactState)) {
      return null;
    }
    const expected = {
      ...base,
      compactionEpoch: base.compactionEpoch + 1,
      compactState: "pre-applied",
      preCompact: record,
      postCompact: null,
    };
    return same(successor, expected) ? { type: "PreCompact", value: expected } : null;
  }
  if (successor.postCompact?.identity === identity) {
    if (base.compactState !== "pre-applied" || base.preCompact === null) return null;
    const expected = { ...base, compactState: "post-applied", postCompact: record };
    return same(successor, expected) ? { type: "PostCompact", value: expected } : null;
  }
  return null;
}

async function ensureObservationPublished({
  layout,
  view,
  release,
  armValue,
  leafAuthority,
  correlation,
  visibilityDigest,
}) {
  const value = deactivationObservationValue({
    attemptId: view.state.attemptId,
    correlation,
    visibilityDigest,
    continuationDigest: release.continuationDigest,
    releaseDigest: release.releaseDigest,
    receiptDigest: armValue.receiptDigest,
  });
  const expected = contentAddressedLeaf(value, "builder-codex-uat-observation", layout.observationDirectory);
  await assertRetainedLeafAuthority(leafAuthority);
  let observation;
  if (await pathExists(expected.filePath)) {
    observation = await loadCodexUatObservationLeaf(expected.filePath, {
      expectedDigest: expected.digest,
    });
  } else {
    observation = await publishCodexUatObservationLeaf({
      outDirectory: layout.observationDirectory,
      attemptId: value.attemptId,
      scenario: value.scenario,
      correlation: value.correlation,
      source: value.source,
      eventDigest: value.eventDigest,
      runnerDigest: value.runnerDigest,
      releaseDigest: value.releaseDigest,
      installReceiptDigest: value.installReceiptDigest,
      parentAuthority: leafAuthority,
    });
  }
  await assertRetainedLeafAuthority(leafAuthority);
  assertExactLeafValue(observation, expected);
  return observation;
}

async function admitCompletedScenarioPrefix(
  layout,
  view,
  release,
  approvedDeactivationPlanDigest,
  leafAuthorities,
  armValue,
) {
  const finalScenario = view.state.phase === "candidate-ready"
    ? view.entries.at(-2)
    : view.entries.at(-1);
  if (finalScenario?.kind !== "scenario-observed"
    || finalScenario.details.scenario !== "deactivation-tombstone-visibility"
    || finalScenario.predecessorDigest !== armValue.expectedHeadDigest) fail();
  const admitted = await admitArmedDeactivationState(layout, armValue);
  const evidence = finalScenario.details.evidence;
  if (evidence.deactivationPlanDigest !== approvedDeactivationPlanDigest
    || evidence.visibilityDigest !== admitted.visibilityDigest
    || evidence.lifecycleHeadDigest !== admitted.lifecycle.authorityHeadDigest
    || evidence.tombstoneDigest !== admitted.tombstone.digest
    || evidence.activeReceiptDigest !== armValue.receiptDigest
    || evidence.launcherPreserved !== true
    || evidence.currentReceiptPreserved !== true) fail();
  const checkpoint = await admitCheckpointRecoveryState(layout, view, armValue);
  if (!checkpoint.advanced
    || finalScenario.details.checkpointLeafDigest !== checkpoint.admission.digest) fail();
  const value = deactivationObservationValue({
    attemptId: view.state.attemptId,
    correlation: checkpoint.admission.value.codexUatChallenge.correlation,
    visibilityDigest: admitted.visibilityDigest,
    continuationDigest: release.continuationDigest,
    releaseDigest: release.releaseDigest,
    receiptDigest: armValue.receiptDigest,
  });
  const expected = contentAddressedLeaf(value, "builder-codex-uat-observation", layout.observationDirectory);
  if (finalScenario.details.observationLeafDigest !== expected.digest) fail();
  await assertRetainedLeafAuthority(leafAuthorities.observation);
  const observation = await loadCodexUatObservationLeaf(expected.filePath, {
    expectedDigest: expected.digest,
  });
  await assertRetainedLeafAuthority(leafAuthorities.observation);
  assertExactLeafValue(observation, expected);
  return Object.freeze({ ...admitted, checkpoint: checkpoint.admission, observation });
}

async function ensureCandidatePublished(layout, view, leafAuthority) {
  const expected = contentAddressedLeaf(
    candidateValue(view, view.entries),
    "builder-codex-uat-candidate",
    layout.candidateDirectory,
  );
  await assertRetainedLeafAuthority(leafAuthority);
  let candidate;
  if (await pathExists(expected.filePath)) {
    candidate = await loadExistingCodexUatCandidate({
      journalPath: layout.journalPath,
      expectedHeadAdmission: view.head,
      candidateDirectory: layout.candidateDirectory,
      parentAuthority: leafAuthority,
    });
  } else {
    candidate = await publishCodexUatCandidate({
      journalPath: layout.journalPath,
      expectedHeadAdmission: view.head,
      candidateDirectory: layout.candidateDirectory,
      parentAuthority: leafAuthority,
    });
  }
  await assertRetainedLeafAuthority(leafAuthority);
  assertExactLeafValue(candidate, expected);
  return Object.freeze({ ...candidate, filePath: expected.filePath });
}

function assertExactCandidate(candidate, view, basisEntries) {
  const value = candidateValue(view, basisEntries);
  const bytes = Buffer.from(serializePersistableJson(value, {
    subject: "builder-codex-uat-candidate",
  }), "utf8");
  if (candidate.digest !== digestRawBytes(bytes)
    || serializePersistableJson(candidate.value, { subject: "builder-codex-uat-candidate" })
      !== serializePersistableJson(value, { subject: "builder-codex-uat-candidate" })) fail();
}

function candidateValue(view, basisEntries) {
  return Object.freeze({
    schemaVersion: "agentmo.codex-uat.v2",
    attemptId: view.state.attemptId,
    status: "candidate",
    releaseSet: view.state.releaseSet,
    successorRole: "successor",
    successorPackageName: view.state.successor.packageName,
    successorVersion: view.state.successor.version,
    releaseDigest: view.state.successor.releaseDigest,
    tarballDigest: view.state.successor.tarballDigest,
    orderedEvidenceDigest: orderedEvidenceDigest(basisEntries),
    scenarioCount: 11,
    humanAdmissionRequired: true,
    hostOriginCryptographicallyVerified: false,
    realCodexSessionVerified: false,
    agentPackageQualityCertified: false,
    domainQualityCertified: false,
    productionReady: false,
    widerCompatibilityCertified: false,
  });
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

function deactivationObservationValue({
  attemptId,
  correlation,
  visibilityDigest,
  continuationDigest,
  releaseDigest,
  receiptDigest,
}) {
  return Object.freeze({
    schemaVersion: "agentmo.codex-uat-observation.v1",
    attemptId,
    scenario: "deactivation-tombstone-visibility",
    correlation,
    source: "operator-observation",
    eventDigest: visibilityDigest,
    runnerDigest: continuationDigest,
    releaseDigest,
    installReceiptDigest: receiptDigest,
    claimsHostOrigin: false,
    claimsScenarioSuccess: false,
    realCodexSessionVerified: false,
    agentPackageQualityCertified: false,
    domainQualityCertified: false,
    productionReady: false,
    widerCompatibilityCertified: false,
  });
}

function contentAddressedLeaf(value, subject, directory) {
  const bytes = Buffer.from(serializePersistableJson(value, { subject }), "utf8");
  const digest = digestRawBytes(bytes);
  return Object.freeze({
    value,
    bytes,
    digest,
    filePath: contentAddressedLeafPath(directory, digest),
  });
}

function contentAddressedLeafPath(directory, digest) {
  if (!DIGEST_PATTERN.test(digest ?? "")) fail();
  return path.join(path.resolve(directory), `${digest.slice("sha256:".length)}.json`);
}

function assertExactLeafValue(admission, expected) {
  if (admission.digest !== expected.digest
    || serializePersistableJson(admission.value, { subject: "codex-uat-recovery-leaf" })
      !== serializePersistableJson(expected.value, { subject: "codex-uat-recovery-leaf" })) fail();
}

async function assertRetainedLeafAuthority(authority) {
  try {
    const retained = await authority.handle.stat({ bigint: true });
    const current = await lstat(authority.directory, { bigint: true });
    if (!retained.isDirectory()
      || !current.isDirectory()
      || retained.dev !== authority.identity.dev
      || retained.ino !== authority.identity.ino
      || retained.uid !== authority.identity.uid
      || retained.mode !== authority.identity.mode
      || retained.dev !== current.dev
      || retained.ino !== current.ino
      || retained.uid !== current.uid
      || retained.mode !== current.mode) fail();
  } catch (error) {
    if (error instanceof BuilderCodexUatContinuationError) throw error;
    fail();
  }
}

async function pathExists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    fail();
  }
}

function parseCanonicalValue(bytes, subject) {
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail();
  }
  if (!Buffer.from(serializePersistableJson(value, { subject }), "utf8").equals(bytes)) fail();
  return value;
}

function initialContinuationHeadDigest(view) {
  const finalScenario = view.state.phase === "candidate-ready"
    ? view.entries.at(-2)
    : view.entries.at(-1);
  if (finalScenario?.kind !== "scenario-observed"
    || finalScenario.details.scenario !== "deactivation-tombstone-visibility"
    || !DIGEST_PATTERN.test(finalScenario.predecessorDigest ?? "")) fail();
  return finalScenario.predecessorDigest;
}

function continuationInputHeadDigests(view, armValue) {
  const finalScenario = view.state.phase === "candidate-ready"
    ? view.entries.at(-2)
    : view.entries.at(-1);
  const finalScenarioDigest = finalScenario === undefined
    ? null
    : digestValue(finalScenario, "builder-codex-uat-attempt-entry");
  if (finalScenario?.kind !== "scenario-observed"
    || finalScenario.details.scenario !== "deactivation-tombstone-visibility"
    || !DIGEST_PATTERN.test(finalScenarioDigest ?? "")
    || finalScenario.predecessorDigest !== armValue.expectedHeadDigest) fail();
  return [...new Set([
    armValue.expectedHeadDigest,
    finalScenarioDigest,
    view.head.digest,
  ])];
}

function validateDeactivationArm(value, expectedInitialHeadDigest, release, approvedDeactivationPlanDigest) {
  if (!exactKeys(value, [
    "schemaVersion", "expectedHeadDigest", "deactivationPlanDigest", "checkpointDigest",
    "releaseDigest", "continuationDigest", "lifecycleHeadBeforeDigest", "receiptPath",
    "receiptDigest", "receiptIdentity", "launcherPath", "launcherDigest", "launcherIdentity",
    "sharedRuntimeDigest", "preserved", "releaseSet", "successorRole",
  ]) || value.schemaVersion !== DEACTIVATION_ARM_SCHEMA_VERSION
    || value.expectedHeadDigest !== expectedInitialHeadDigest
    || value.deactivationPlanDigest !== approvedDeactivationPlanDigest
    || value.releaseDigest !== release.releaseDigest
    || value.continuationDigest !== release.continuationDigest
    || value.releaseSet?.operationId !== release.operationId
    || value.releaseSet?.releaseSetDigest !== release.releaseSetDigest
    || value.successorRole !== "successor"
    || !exactKeys(value.releaseSet, ["operationId", "releaseSetDigest"])
    || !DIGEST_PATTERN.test(value.releaseSet.operationId ?? "")
    || !DIGEST_PATTERN.test(value.releaseSet.releaseSetDigest ?? "")
    || [value.checkpointDigest, value.lifecycleHeadBeforeDigest, value.receiptDigest, value.launcherDigest]
      .some((digest) => !DIGEST_PATTERN.test(digest ?? ""))
    || !safeProjectRelativePath(value.receiptPath)
    || !safeProjectRelativePath(value.launcherPath)
    || !validPersistedIdentity(value.receiptIdentity)
    || !validPersistedIdentity(value.launcherIdentity)
    || (value.sharedRuntimeDigest !== null && !DIGEST_PATTERN.test(value.sharedRuntimeDigest ?? ""))
    || !Array.isArray(value.preserved)
    || value.preserved.some((item) => !exactKeys(item, ["relativePath", "digest"])
      || typeof item.relativePath !== "string" || item.relativePath.includes("..")
      || !DIGEST_PATTERN.test(item.digest ?? ""))) fail();
}

async function publishDeactivationArm(layout, value) {
  const idempotencyKey = `deactivation:${value.expectedHeadDigest.slice("sha256:".length)}`;
  const existing = await readAppendOnlyAuthority({
    projectRoot: layout.projectRoot,
    relativeRoot: layout.deactivationArmRoot,
    namespace: "codex-uat-arm",
  });
  if (existing.records.length !== 0) {
    const record = existing.records[0];
    if (existing.records.length !== 1
      || existing.aborted.length !== 0
      || existing.recoveryRequired !== null
      || record.idempotencyKey !== idempotencyKey
      || serializePersistableJson(record.payload, { subject: "codex-uat-deactivation-armed" })
        !== serializePersistableJson(value, { subject: "codex-uat-deactivation-armed" })) fail();
    return record;
  }
  if (existing.aborted.length !== 0) fail();
  const result = await appendAppendOnlyRecord({
    projectRoot: layout.projectRoot,
    relativeRoot: layout.deactivationArmRoot,
    namespace: "codex-uat-arm",
    idempotencyKey,
    expectedHeadDigest: existing.headDigest,
    payload: value,
  });
  if (result.status !== "committed"
    || serializePersistableJson(result.payload, { subject: "codex-uat-deactivation-armed" })
      !== serializePersistableJson(value, { subject: "codex-uat-deactivation-armed" })) fail();
  return result;
}

async function loadDeactivationArm(layout) {
  const authority = await readAppendOnlyAuthority({
    projectRoot: layout.projectRoot,
    relativeRoot: layout.deactivationArmRoot,
    namespace: "codex-uat-arm",
  });
  if (authority.records.length === 0) {
    if (authority.aborted.length !== 0) fail();
    return null;
  }
  const record = authority.records[0];
  const expectedIdempotencyKey = `deactivation:${record.payload.expectedHeadDigest?.slice("sha256:".length)}`;
  if (authority.records.length !== 1
    || authority.aborted.length !== 0
    || authority.recoveryRequired !== null
    || record.idempotencyKey !== expectedIdempotencyKey) fail();
  return { value: record.payload };
}

function continuationResult(status, view, candidate, release) {
  return Object.freeze({
    schemaVersion: "agentmo.codex-uat-continuation-result.v2",
    action: "continue",
    status,
    phase: view.state.phase,
    headDigest: view.head.digest,
    candidateDigest: candidate.digest,
    packageName: release.packageName,
    version: release.version,
    releaseDigest: release.releaseDigest,
    tarballDigest: release.tarballDigest,
    releaseSetOperationId: release.operationId,
    releaseSetDigest: release.releaseSetDigest,
    continuationDigest: release.continuationDigest,
    manifestDigest: release.manifestDigest,
    verifierDigest: release.verifierDigest,
    humanAdmissionRequired: true,
    realCodexSessionVerified: false,
    agentPackageQualityCertified: false,
    domainQualityCertified: false,
    productionReady: false,
    widerCompatibilityCertified: false,
  });
}

async function admitAttemptLayout(input) {
  const attemptDir = await admitCanonicalExistingPath(path.resolve(input));
  const uatDirectory = path.dirname(attemptDir);
  const agentmoDirectory = path.dirname(uatDirectory);
  const projectRoot = path.dirname(agentmoDirectory);
  if (path.basename(uatDirectory) !== "codex-uat"
    || path.basename(agentmoDirectory) !== ".agentmo"
    || path.basename(attemptDir).length === 0
    || await admitCanonicalExistingPath(projectRoot) !== projectRoot) {
    fail();
  }
  return Object.freeze({
    attemptDir,
    projectRoot,
    journalPath: path.join(attemptDir, JOURNAL_BASENAME),
    checkpointPath: path.join(attemptDir, CHECKPOINT_BASENAME),
    candidateDirectory: path.join(attemptDir, CANDIDATE_DIRECTORY_BASENAME),
    observationDirectory: path.join(attemptDir, OBSERVATION_DIRECTORY_BASENAME),
    deactivationArmRoot: path.relative(
      projectRoot,
      path.join(attemptDir, DEACTIVATION_ARM_BASENAME),
    ).split(path.sep).join("/"),
    receiptPath: path.join(projectRoot, ...PROJECT_RECEIPT_PATH.split("/")),
    launcherPath: path.join(projectRoot, ...PROJECT_LAUNCHER_PATH.split("/")),
  });
}

async function admitCanonicalExistingPath(input) {
  const resolved = await realpath(input);
  const darwinSystemAlias = process.platform === "darwin"
    && ["/var", "/tmp", "/etc"].some((prefix) => (
      (input === prefix || input.startsWith(`${prefix}${path.sep}`))
      && resolved === `/private${input}`
    ));
  if (resolved !== input && !darwinSystemAlias) fail();
  return resolved;
}

function parseReleaseManifest(bytes) {
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail();
  }
  if (!exactKeys(value, ["schemaVersion", "packageName", "version", "continuation", "verifier"])
    || value.schemaVersion !== "agentmo.codex-uat-release-manifest.v1"
    || value.packageName !== "agentmo"
    || !VERSION_PATTERN.test(value.version ?? "")
    || !exactIdentity(value.continuation, CONTINUATION_SOURCE_PATH)
    || !exactIdentity(value.verifier, VERIFIER_SOURCE_PATH)
    || value.continuation.sha256 === value.verifier.sha256) {
    fail();
  }
  const canonical = Buffer.from(serializePersistableJson(value, {
    subject: "builder-codex-uat-release-manifest",
  }), "utf8");
  if (!canonical.equals(bytes)) fail();
  return Object.freeze(value);
}

function parseInstalledReceipt(bytes) {
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail();
  }
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !exactKeys(value.identity, ["name", "version", "adapterId", "releaseDigest"])
    || value.identity.adapterId !== "codex"
    || !Array.isArray(value.files)) {
    fail();
  }
  return value;
}

function exactIdentity(value, expectedSourcePath) {
  return exactKeys(value, ["sourcePath", "sha256"])
    && value.sourcePath === expectedSourcePath
    && DIGEST_PATTERN.test(value.sha256 ?? "");
}

async function captureStableFile(filePath, maxBytes, options = {}) {
  let handle;
  try {
    handle = await open(filePath, FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    const current = await lstat(filePath, { bigint: true });
    if (!safeFile(
      before,
      options.allowExecutable === true,
      options.allowedLinks ?? [1n],
    ) || !sameIdentity(before, current)
      || before.size > BigInt(maxBytes)) fail();
    const bytes = await readExact(handle, Number(before.size));
    const after = await handle.stat({ bigint: true });
    const pathAfter = await lstat(filePath, { bigint: true });
    if (!sameIdentity(before, after) || !sameIdentity(after, pathAfter)) fail();
    return { handle, filePath, before, bytes };
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error instanceof BuilderCodexUatContinuationError) throw error;
    fail();
  }
}

async function captureStableDirectory(directoryPath) {
  let handle;
  try {
    handle = await open(
      directoryPath,
      FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_DIRECTORY | FS_CONSTANTS.O_NOFOLLOW,
    );
    const before = await handle.stat({ bigint: true });
    const current = await lstat(directoryPath, { bigint: true });
    if (!before.isDirectory() || !sameIdentity(before, current)) fail();
    return { handle, directoryPath, before };
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error instanceof BuilderCodexUatContinuationError) throw error;
    fail();
  }
}

async function assertRetainedCapture(capture, options = {}) {
  const after = await capture.handle.stat({ bigint: true });
  if (options.pathMustExist === true) {
    const current = await lstat(capture.filePath, { bigint: true });
    if (!sameIdentity(capture.before, after) || !sameIdentity(after, current)) fail();
    return;
  }
  if (!sameRetainedDeletedIdentity(capture.before, after)) fail();
  const retainedBytes = await readExact(capture.handle, Number(after.size));
  if (!retainedBytes.equals(capture.bytes)) fail();
}

async function assertRetainedDirectory(capture) {
  const after = await capture.handle.stat({ bigint: true });
  const current = await lstat(capture.directoryPath, { bigint: true });
  if (!sameIdentity(capture.before, after) || !sameIdentity(after, current)) fail();
}

async function assertAbsent(filePath) {
  try {
    await lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
  }
  fail();
}

function safeFile(stats, allowExecutable, allowedLinks) {
  return stats.isFile()
    && !stats.isSymbolicLink?.()
    && allowedLinks.includes(stats.nlink)
    && stats.size > 0n
    && (stats.mode & 0o022n) === 0n
    && (allowExecutable || (stats.mode & 0o111n) === 0n);
}

function persistedIdentity(stats) {
  return Object.freeze({
    device: stats.dev.toString(10),
    inode: stats.ino.toString(10),
    links: stats.nlink.toString(10),
    size: stats.size.toString(10),
    owner: stats.uid.toString(10),
    mode: stats.mode.toString(10),
    modifiedNs: stats.mtimeNs.toString(10),
    changedNs: stats.ctimeNs.toString(10),
  });
}

function validPersistedIdentity(value) {
  return exactKeys(value, [
    "device", "inode", "links", "size", "owner", "mode", "modifiedNs", "changedNs",
  ]) && Object.values(value).every((item) => typeof item === "string" && /^\d+$/u.test(item));
}

function assertPersistedIdentity(stats, expected) {
  if (!validPersistedIdentity(expected)
    || JSON.stringify(persistedIdentity(stats)) !== JSON.stringify(expected)) fail();
}

function safeProjectRelativePath(value) {
  return typeof value === "string"
    && value.length > 0
    && !value.includes("\\")
    && !path.posix.isAbsolute(value)
    && value.split("/").every((segment) => segment && segment !== "." && segment !== "..");
}

function sameIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.nlink === right.nlink
    && left.size === right.size
    && left.uid === right.uid
    && left.mode === right.mode
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function sameRetainedDeletedIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.nlink === 1n
    && right.nlink >= 0n
    && right.nlink <= 2n
    && left.size === right.size
    && left.uid === right.uid
    && left.mode === right.mode
    && left.mtimeNs === right.mtimeNs;
}

async function readExact(handle, size) {
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await handle.read(bytes, offset, size - offset, offset);
    if (!Number.isInteger(bytesRead) || bytesRead <= 0) fail();
    offset += bytesRead;
  }
  return bytes;
}

function digestValue(value, subject) {
  return digestRawBytes(Buffer.from(serializePersistableJson(value, { subject }), "utf8"));
}

function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function fail() {
  throw new BuilderCodexUatContinuationError();
}
