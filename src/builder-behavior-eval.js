import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { digestRawBytes } from "./artifact-admission.js";
import {
  buildBuilderCheckpoint,
  loadBuilderCheckpointHead,
  writeBuilderCheckpoint,
} from "./builder-checkpoint.js";
import {
  assertCodexMarketplaceProjectionFinalBinding,
  buildCodexConsumerEntry,
  digestCodexConsumerEntry,
  inspectCodexMarketplaceProjectionBinding,
  observeCodexHost,
  readCodexSelectorState,
  resolveBuilderCodexMarketplaceRoot,
} from "./builder-codex-host.js";
import {
  loadCodexUatAttemptJournal,
  loadCodexUatCandidate,
} from "./builder-codex-uat.js";
import { BUILDER_PLUGIN_ROOT } from "./builder-install.js";
import {
  admitBuilderLifecycleReceipt,
  buildV1RuntimeCompatibilityBasis,
  planBuilderUpgrade,
} from "./builder-lifecycle.js";
import {
  BUILDER_NPM_METADATA_FILES,
  admitBuilderUatReleasePair,
  loadBuilderPackage,
  readBoundedNoFollowFile,
} from "./builder-package.js";
import { assertBuilderPlatform } from "./builder-platform.js";
import { probeBuilderAdapter } from "./builder-probe.js";
import { assertPersistable, serializePersistableJson } from "./persistability.js";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const MAX_CAPTURE_BYTES = 64 * 1024;
const FRESH_COMMAND_TERMINATION_GRACE_MS = 250;
// The hook owns a separately bounded authenticated child. Leave enough
// bounded settlement time for that child to close under parallel fresh-process
// evaluation instead of turning a committed hook delivery into a false result.
const AUTHENTIC_HOOK_TIMEOUT_MS = 90_000;
const AUTHENTIC_HOOK_PREVIEW_TIMEOUT_MS = 20_000;
const AUTHENTIC_HOOK_SETUP_TIMEOUT_MS = 120_000;
// README is required only by the self-contained NPM closure. Runtime bytes
// remain admitted separately and the installed hook digest is rechecked below.
const AUTHENTIC_HOOK_FIXTURE_METADATA = "AgentMo authenticated behavior fixture.\n";
const MAX_UAT_TARBALL_BYTES = 64 * 1024 * 1024;
const CLI_PATH = fileURLToPath(new URL("../bin/agentmo.js", import.meta.url));
const HOOK_CONTEXT = "AgentMo checkpoint is resumable at discover. Use $agentmo to review and explicitly resume; no approval or stage transition was applied.";
const HOOK_REGISTRATION = Object.freeze({
  hooks: {
    SessionStart: [{
      matcher: "startup|resume|clear",
      hooks: [{
        type: "command",
        command: "node \"${PLUGIN_ROOT}/hooks/agentmo-hook.js\"",
        async: false,
      }],
    }],
    PreCompact: [{
      hooks: [{
        type: "command",
        command: "node \"${PLUGIN_ROOT}/hooks/agentmo-hook.js\"",
        async: false,
      }],
    }],
    PostCompact: [{
      hooks: [{
        type: "command",
        command: "node \"${PLUGIN_ROOT}/hooks/agentmo-hook.js\"",
        async: false,
      }],
    }],
  },
});
const SCENARIOS = Object.freeze([
  Object.freeze({ id: "trigger-session-start", process: "fresh-authenticated-hook" }),
  Object.freeze({ id: "non-trigger-user-prompt", process: "fresh-authenticated-hook" }),
  Object.freeze({ id: "stable-checkpoint", process: "fresh-authenticated-fixture" }),
  Object.freeze({ id: "session-start-recovery", process: "fresh-authenticated-hook" }),
  Object.freeze({ id: "duplicate-event-no-op", process: "fresh-authenticated-hook" }),
  Object.freeze({ id: "manual-pause", process: "fresh-authenticated-cli" }),
  Object.freeze({ id: "pre-compact", process: "fresh-authenticated-hook" }),
  Object.freeze({ id: "post-compact", process: "fresh-authenticated-hook" }),
  Object.freeze({ id: "restart-resume", process: "fresh-authenticated-hook+fresh-authenticated-cli" }),
]);

export class BuilderBehaviorEvalError extends Error {
  constructor(code) {
    super("Builder behavior evaluation was rejected.");
    this.name = "BuilderBehaviorEvalError";
    this.code = code;
  }
}

export async function runBuilderBehaviorEvaluation(options = {}) {
  assertBuilderPlatform();
  assertOptions(options);
  const uatRequested = Object.hasOwn(options, "uatJournalPath");
  let admitted;
  try {
    admitted = await admitBuilderLifecycleReceipt({
      projectRoot: options.projectRoot,
      expectedReceiptDigest: options.expectedReceiptDigest,
    });
  } catch {
    fail(uatRequested
      ? "AGENTMO_BUILDER_BEHAVIOR_UAT_HOST_REJECTED"
      : "AGENTMO_BUILDER_BEHAVIOR_INSTALL_REJECTED");
  }
  if (admitted.files.some((item) => item.currentStatus !== "pristine")) {
    fail("AGENTMO_BUILDER_BEHAVIOR_INSTALL_REJECTED");
  }
  let installed;
  try {
    installed = await admitBehaviorProjection(admitted);
  } catch {
    fail(uatRequested
      ? "AGENTMO_BUILDER_BEHAVIOR_UAT_HOST_REJECTED"
      : "AGENTMO_BUILDER_BEHAVIOR_INSTALL_REJECTED");
  }
  if (uatRequested) {
    return admitConnectedCodexUat({
      admitted,
      journalPath: options.uatJournalPath,
      expectedHeadDigest: options.expectedUatHeadDigest,
      candidatePath: options.uatCandidatePath,
      expectedCandidateDigest: options.expectedUatCandidateDigest,
      baselinePackageRoot: options.uatBaselinePackageRoot,
      baselineTarballPath: options.uatBaselineTarballPath,
      successorPackageRoot: options.uatSuccessorPackageRoot,
      successorTarballPath: options.uatSuccessorTarballPath,
    });
  }
  if (admitted.lifecycleStatus !== "active") {
    fail("AGENTMO_BUILDER_BEHAVIOR_INSTALL_REJECTED");
  }

  const work = await mkdtemp(path.join(tmpdir(), "agentmo-builder-behavior-"));
  try {
    const childCwd = path.join(work, "isolated-child-cwd");
    await mkdir(childCwd, { mode: 0o700 });
    const probe = await probeBuilderAdapter({
      adapterId: "codex",
      execute: (command, args, probeOptions) => runFreshHostProbe(
        command,
        args,
        probeOptions,
        childCwd,
      ),
    });
    if (probe.required.ok !== true) fail("AGENTMO_BUILDER_BEHAVIOR_HOST_REJECTED");
    const releasePlan = await planBuilderUpgrade({
      projectRoot: admitted.projectRoot,
      expectedReceiptDigest: admitted.receiptDigest,
      probe,
      ...(admitted.packageRoot === null
        ? {}
        : {
            packageOptions: {
              packageRoot: admitted.packageRoot,
              projectRoot: admitted.projectRoot,
              expectedReceiptDigest: admitted.receiptDigest,
              immutableLifecycleSelection: true,
            },
          }),
    });
    const releaseCurrent = installed.release;
    const releaseDesired = releasePlan.desired?.release;
    if (releaseCurrent.releaseDigest !== releaseDesired?.releaseDigest
      || releaseCurrent.version !== releaseDesired?.version
      || releasePlan.applicable !== true
      || releasePlan.operations.some((item) => !["unchanged", "preserve-shared"].includes(item.operation))) {
      fail("AGENTMO_BUILDER_BEHAVIOR_RELEASE_REJECTED");
    }

    const hostObservation = {
      schemaVersion: "agentmo.builder-host-observation.v1",
      adapterId: "codex",
      basis: "isolated-probe+authenticated-hook-fixture",
      version: probe.host.version,
      required: probe.observations
        .filter((item) => item.requirement === "required")
        .map((item) => ({ id: item.id, status: item.status }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      activation: "unverified",
      hookTrust: "unverified",
      claimsSupport: false,
    };
    const hostObservationDigest = digestJson(hostObservation, "builder-host-observation");
    const scenarioManifest = {
      schemaVersion: "agentmo.builder-behavior-scenarios.v1",
      scenarios: SCENARIOS,
    };
    const scenarioDigest = digestJson(scenarioManifest, "builder-behavior-scenarios");
    const scenarioExecution = await executeScenarios({ admitted, installed, work });
    const { fixture, results } = scenarioExecution;
    if (results.length !== SCENARIOS.length
      || results.some((result, index) => result.id !== SCENARIOS[index].id || result.passed !== true)) {
      fail("AGENTMO_BUILDER_BEHAVIOR_SCENARIO_FAILED");
    }
    const resultModel = {
      schemaVersion: "agentmo.builder-behavior-results.v1",
      fixture,
      results,
    };
    const resultDigest = digestJson(resultModel, "builder-behavior-results");
    const binding = {
      schemaVersion: "agentmo.builder-behavior-binding.v1",
      releaseDigest: releaseCurrent.releaseDigest,
      receiptDigest: admitted.receiptDigest,
      fixtureFinalCheckpointDigest: fixture.finalCheckpointDigest,
      fixtureInitialCheckpointDigest: fixture.initialCheckpointDigest,
      fixtureCliDigest: fixture.cliDigest,
      fixtureReceiptDigest: fixture.receiptDigest,
      fixtureReleaseDigest: fixture.releaseDigest,
      fixtureRunnerDigest: fixture.runnerDigest,
      hostObservationDigest,
      scenarioDigest,
      resultDigest,
    };
    const report = {
      schemaVersion: "agentmo.builder-behavior-eval.v1",
      status: "observed",
      adapterId: "codex",
      scope: "project",
      release: {
        name: releaseCurrent.name,
        version: releaseCurrent.version,
        digest: releaseCurrent.releaseDigest,
      },
      receipt: { path: admitted.receiptPath, digest: admitted.receiptDigest },
      fixture,
      hostObservation: {
        basis: hostObservation.basis,
        digest: hostObservationDigest,
        activation: hostObservation.activation,
        hookTrust: hostObservation.hookTrust,
      },
      scenarios: { digest: scenarioDigest, results },
      resultDigest,
      evidenceDigest: digestJson(binding, "builder-behavior-binding"),
      evidence: {
        level: "observed",
        basis: "isolated-authenticated-runtime-fixture",
        fixtureExternalCommandMutation: fixture.externalCommandMutation,
        codexActivationVerified: false,
        hostBehaviorVerified: false,
        agentPackageQualityCertified: false,
        domainQualityCertified: false,
        productionApproved: false,
      },
    };
    assertPersistable(report, { subject: "builder-behavior-eval" });
    return deepFreeze(report);
  } finally {
    // v1 retains bounded scratch evidence in its isolated temporary root.
    // Physical garbage collection requires a future, separately authorized protocol.
  }
}

async function admitBehaviorProjection(admitted) {
  const receipt = admitted.activationReceipt;
  if (!validActivatedReceipt(receipt)
    || receipt.status !== "activated"
    || receipt.hostActivation?.hostScope !== "user") {
    fail("AGENTMO_BUILDER_BEHAVIOR_INSTALL_REJECTED");
  }
  const release = admitted.package;
  const runtimeRelease = await loadBuilderPackage({
    expectedReceiptDigest: admitted.genesisReceiptDigest,
    projectRoot: admitted.projectRoot,
  });
  if (runtimeRelease.releaseDigest !== receipt.identity.releaseDigest
    || release.releaseDigest !== admitted.release.releaseDigest) {
    fail("AGENTMO_BUILDER_BEHAVIOR_INSTALL_REJECTED");
  }
  const marketplaceRoot = await resolveBuilderCodexMarketplaceRoot();
  const binding = await inspectCodexMarketplaceProjectionBinding({ marketplaceRoot });
  const finalProjectionBinding = await assertCodexMarketplaceProjectionFinalBinding({
    marketplaceRoot,
    expectedBinding: receipt.hostActivation.finalProjectionBinding,
  });
  const consumer = binding.ledger.status === "valid"
    ? binding.ledger.value.consumers.find((entry) => entry.consumerId === admitted.scopeDigest)
    : null;
  if (binding.owner.status !== "valid"
    || binding.ledger.status !== "valid"
    || binding.projection.status !== "valid"
    || finalProjectionBinding.releaseDigest !== receipt.identity.releaseDigest
    || finalProjectionBinding.contentDigest !== receipt.hostActivation.marketplaceProjectionDigest
    || finalProjectionBinding.rootIdentityDigest !== binding.projection.rootIdentityDigest
    || binding.owner.digest !== receipt.hostActivation.ownerRecordDigest
    || binding.ledger.digest !== receipt.hostActivation.consumerLedgerDigest
    || binding.owner.value.release.releaseDigest !== runtimeRelease.releaseDigest
    || consumer === null
    || digestCodexConsumerEntry(consumer) !== receipt.hostActivation.consumerEntryDigest) {
    fail("AGENTMO_BUILDER_BEHAVIOR_INSTALL_REJECTED");
  }
  const runtimeAssets = new Map();
  for (const asset of runtimeRelease.assets) {
    const installedPath = path.join(marketplaceRoot, ...asset.destinationPath.split("/"));
    const bytes = await readBoundedNoFollowFile(installedPath);
    if (digestRawBytes(bytes) !== asset.digest) {
      fail("AGENTMO_BUILDER_BEHAVIOR_INSTALL_REJECTED");
    }
    runtimeAssets.set(asset.destinationPath, { path: installedPath, digest: asset.digest, bytes });
  }
  if (JSON.stringify(buildV1RuntimeCompatibilityBasis(runtimeRelease))
    !== JSON.stringify(buildV1RuntimeCompatibilityBasis(release))) {
    fail("AGENTMO_BUILDER_BEHAVIOR_INSTALL_REJECTED");
  }
  const assets = new Map();
  for (const asset of release.assets) {
    const runtimeAsset = runtimeAssets.get(asset.destinationPath);
    if (runtimeAsset === undefined) {
      fail("AGENTMO_BUILDER_BEHAVIOR_INSTALL_REJECTED");
    }
    assets.set(asset.destinationPath, {
      path: admitted.packageRoot === null
        ? runtimeAsset.path
        : path.join(admitted.packageRoot, ...asset.sourcePath.split("/")),
      digest: asset.digest,
      bytes: asset.bytes,
    });
  }
  return deepFreeze({ marketplaceRoot, release, assets });
}

async function admitConnectedCodexUat({
  admitted,
  journalPath,
  expectedHeadDigest,
  candidatePath,
  expectedCandidateDigest,
  baselinePackageRoot,
  baselineTarballPath,
  successorPackageRoot,
  successorTarballPath,
}) {
  let admittedPair;
  try {
    admittedPair = await admitBuilderUatReleasePair({
      baseline: {
        packageRoot: baselinePackageRoot,
        tarballPath: baselineTarballPath,
      },
      successor: {
        packageRoot: successorPackageRoot,
        tarballPath: successorTarballPath,
      },
      maxBytes: MAX_UAT_TARBALL_BYTES,
    });
  } catch {
    fail("AGENTMO_BUILDER_BEHAVIOR_UAT_PAIR_REJECTED");
  }
  const [view, candidate] = await Promise.all([
    loadCodexUatAttemptJournal(journalPath),
    loadCodexUatCandidate(candidatePath, { expectedDigest: expectedCandidateDigest }),
  ]);
  const receipt = admitted.activationReceipt;
  if (!validActivatedReceipt(receipt)
    || receipt.status !== "activated"
    || receipt.hostActivation?.hostScope !== "user") {
    fail("AGENTMO_BUILDER_BEHAVIOR_UAT_BINDING_REJECTED");
  }
  const binding = receipt.hostActivation;
  const release = admitted.release;
  const runtimeRelease = {
    name: receipt.identity.name,
    version: receipt.identity.version,
    adapterId: receipt.identity.adapterId,
    releaseDigest: receipt.identity.releaseDigest,
  };
  const value = candidate.value;
  const ready = view.entries.at(-1);
  const setupEntries = view.entries.filter((entry) => entry.kind === "setup-applied");
  const setup = setupEntries[0];
  const upgrade = view.entries.find(
    (entry) => entry.kind === "scenario-observed" && entry.details.scenario === "upgrade-visibility",
  );
  const deactivation = view.entries.find(
    (entry) => entry.kind === "scenario-observed"
      && entry.details.scenario === "deactivation-tombstone-visibility",
  );
  const basisEntries = view.entries.slice(0, -1);
  if (view.head?.digest !== expectedHeadDigest
    || view.state.phase !== "candidate-ready"
    || view.state.terminal
    || view.state.scenarioCount !== 11
    || ready?.kind !== "candidate-ready"
    || ready.details.candidateDigest !== candidate.digest
    || view.state.candidateDigest !== candidate.digest
    || value.attemptId !== view.state.attemptId
    || value.orderedEvidenceDigest !== orderedCodexUatEvidenceDigest(basisEntries)
    || setupEntries.length !== 1
    || !sameCodexUatReleaseSetBinding(value.releaseSet, view.state.releaseSet)
    || !sameCodexUatReleaseSetBinding(value.releaseSet, admittedPair)
    || !sameCodexUatReleaseTuple(view.state.baseline, admittedPair.baseline)
    || !sameCodexUatReleaseTuple(view.state.successor, admittedPair.successor)
    || !sameCodexUatSuccessorCandidate(value, admittedPair.successor)
    || !sameSelectedCodexUatSuccessor(release, admitted.package, admittedPair.successor)
    || setup?.details.installReceiptDigest !== admitted.genesisReceiptDigest
    || !sameCodexUatGenesisReceipt(admitted.genesisReceipt, admittedPair.baseline)
    || !sameCodexUatSetup(setup?.details, admittedPair.baseline)
    || setup.details.marketplaceOwnerDigest
      !== admitted.genesisReceipt.hostActivation.ownerRecordDigest
    || setup.details.marketplaceConsumerDigest
      !== admitted.genesisReceipt.hostActivation.consumerEntryDigest
    || value.successorRole !== "successor"
    || value.humanAdmissionRequired !== true
    || value.scenarioCount !== 11
    || upgrade?.details.evidence.installReceiptDigest !== admitted.receiptDigest
    || deactivation?.details.evidence.activeReceiptDigest !== admitted.receiptDigest) {
    fail("AGENTMO_BUILDER_BEHAVIOR_UAT_BINDING_REJECTED");
  }

  let state;
  let hostObservation;
  try {
    [state, hostObservation] = await Promise.all([
      readCodexSelectorState(),
      observeCodexHost({ projectRoot: admitted.projectRoot, release: runtimeRelease }),
    ]);
  } catch {
    fail("AGENTMO_BUILDER_BEHAVIOR_UAT_HOST_REJECTED");
  }
  if (state.owner.status !== "valid"
    || state.ledger.status !== "valid"
    || state.owner.digest !== binding.ownerRecordDigest
    || state.ledger.digest !== binding.consumerLedgerDigest
    || !exactConnectedHostObservation(hostObservation, binding.selector)) {
    fail("AGENTMO_BUILDER_BEHAVIOR_UAT_HOST_REJECTED");
  }
  let expectedConsumerDigest;
  let matchingConsumers;
  try {
    const expectedConsumer = buildCodexConsumerEntry({
      selector: binding.selector,
      projectScopeDigest: admitted.scopeDigest,
      releaseDigest: runtimeRelease.releaseDigest,
    });
    expectedConsumerDigest = digestCodexConsumerEntry(expectedConsumer);
    matchingConsumers = state.ledger.value.consumers.filter((entry) => (
      digestCodexConsumerEntry(entry) === expectedConsumerDigest
    ));
  } catch {
    fail("AGENTMO_BUILDER_BEHAVIOR_UAT_HOST_REJECTED");
  }
  if (expectedConsumerDigest !== binding.consumerEntryDigest
    || matchingConsumers.length !== 1) {
    fail("AGENTMO_BUILDER_BEHAVIOR_UAT_HOST_REJECTED");
  }

  const bindings = {
    baseline: admittedPair.baseline,
    successor: admittedPair.successor,
    releaseSetOperationId: admittedPair.operationId,
    releaseSetDigest: admittedPair.releaseSetDigest,
    lifecycleGenesisReceiptDigest: admitted.genesisReceiptDigest,
    installReceiptDigest: admitted.receiptDigest,
    ownerRecordDigest: binding.ownerRecordDigest,
    consumerLedgerDigest: binding.consumerLedgerDigest,
    projectScopeDigest: admitted.scopeDigest,
    hostObservationDigest: hostObservation.observationDigest,
    orderedEvidenceDigest: value.orderedEvidenceDigest,
    uatDigest: candidate.digest,
    uatHeadDigest: view.head.digest,
  };
  const evidenceDigest = digestJson({
    schemaVersion: "agentmo.builder-behavior-uat-binding.v3",
    ...bindings,
  }, "builder-behavior-uat-binding");
  const report = {
    schemaVersion: "agentmo.builder-behavior-uat-chain.v3",
    status: "candidate-ready",
    lane: "committed-pair+genesis-bound-journal-candidate-chain",
    adapterId: "codex",
    scope: "project",
    release: {
      name: release.name,
      version: release.version,
      digest: release.releaseDigest,
    },
    receipt: {
      digest: admitted.receiptDigest,
      genesisDigest: admitted.genesisReceiptDigest,
    },
    uat: {
      identity: value.schemaVersion,
      digest: candidate.digest,
      headDigest: view.head.digest,
      attemptId: view.state.attemptId,
      scenarioCount: value.scenarioCount,
      releaseSetOperationId: value.releaseSet.operationId,
      releaseSetDigest: value.releaseSet.releaseSetDigest,
    },
    bindings,
    evidenceDigest,
    evidence: {
      level: "candidate",
      basis: "committed-pair+genesis-bound-journal-candidate-chain",
      humanAdmissionRequired: true,
      externalDecisionAuthorityRequired: true,
      committedReleasePairVerified: true,
      lifecycleGenesisBindingVerified: true,
      journalChainVerified: true,
      candidateReadyVerified: true,
      leafFilesRevalidated: false,
      realCodexSessionVerified: false,
      codexActivationVerified: false,
      hostBehaviorVerified: false,
      agentPackageQualityCertified: false,
      domainQualityCertified: false,
      productionApproved: false,
    },
  };
  assertPersistable(report, { subject: "builder-behavior-uat-admission" });
  return deepFreeze(report);
}

function sameCodexUatReleaseSetBinding(left, right) {
  return left?.operationId === right?.operationId
    && left?.releaseSetDigest === right?.releaseSetDigest;
}

function sameCodexUatReleaseTuple(left, right) {
  return left?.packageName === right?.packageName
    && left?.version === right?.version
    && left?.releaseDigest === right?.releaseDigest
    && left?.tarballDigest === right?.tarballDigest;
}

function sameCodexUatSuccessorCandidate(value, successor) {
  return value?.successorPackageName === successor?.packageName
    && value?.successorVersion === successor?.version
    && value?.releaseDigest === successor?.releaseDigest
    && value?.tarballDigest === successor?.tarballDigest;
}

function sameSelectedCodexUatSuccessor(release, selectedPackage, successor) {
  return release?.name === successor?.packageName
    && release?.version === successor?.version
    && release?.releaseDigest === successor?.releaseDigest
    && selectedPackage?.name === successor?.packageName
    && selectedPackage?.version === successor?.version
    && selectedPackage?.releaseDigest === successor?.releaseDigest;
}

function sameCodexUatGenesisReceipt(receipt, baseline) {
  return validActivatedReceipt(receipt)
    && receipt?.status === "activated"
    && receipt?.identity?.name === baseline?.packageName
    && receipt?.identity?.version === baseline?.version
    && receipt?.identity?.adapterId === "codex"
    && receipt?.identity?.releaseDigest === baseline?.releaseDigest;
}

function validActivatedReceipt(receipt) {
  const activation = receipt?.hostActivation;
  const finalBinding = activation?.finalProjectionBinding;
  return receipt?.schemaVersion === "agentmo.builder-install-receipt.v4"
    && receipt?.status === "activated"
    && receipt?.evidence?.level === "host-observed"
    && receipt?.evidence?.mechanismOnly === true
    && receipt?.evidence?.codexActivationVerified === false
    && receipt?.evidence?.hostBehaviorVerified === false
    && receipt?.evidence?.domainQualityCertified === false
    && activation?.schemaVersion === "agentmo.builder-codex-activation-binding.v3"
    && activation.hostScope === "user"
    && finalBinding?.schemaVersion === "agentmo.codex-marketplace-projection-binding.v1"
    && finalBinding.releaseDigest === receipt.identity?.releaseDigest
    && DIGEST_PATTERN.test(finalBinding.contentDigest ?? "")
    && DIGEST_PATTERN.test(finalBinding.transactionDigest ?? "")
    && DIGEST_PATTERN.test(finalBinding.rootIdentityDigest ?? "")
    && Array.isArray(finalBinding.members)
    && finalBinding.members.length >= 2;
}

function sameCodexUatSetup(setup, baseline) {
  return setup?.baselineVersion === baseline?.version
    && setup?.releaseDigest === baseline?.releaseDigest
    && setup?.tarballDigest === baseline?.tarballDigest;
}

function orderedCodexUatEvidenceDigest(entries) {
  return digestJson({
    schemaVersion: "agentmo.codex-uat-ordered-evidence.v1",
    entries: entries.map((entry) => ({
      sequence: entry.sequence,
      kind: entry.kind,
      scenario: entry.kind === "scenario-observed" ? entry.details.scenario : null,
      evidenceDigests: entry.evidenceDigests,
    })),
  }, "builder-codex-uat-ordered-evidence");
}

function exactConnectedHostObservation(value, selector) {
  return value?.availability === "observed"
    && value.hostScope === "user"
    && JSON.stringify(value.selector) === JSON.stringify(selector)
    && value.marketplace?.registration === "registered"
    && value.marketplace.sourceMatch === true
    && value.marketplace.sourceAvailable === true
    && value.plugin?.installation === "installed"
    && value.plugin.enabled === true
    && value.plugin.sourceMatch === true
    && value.plugin.releaseMatch === true
    && value.skill?.visibility === "visible"
    && value.hooks?.visibility === "visible"
    && value.hooks.trust === "pending-human"
    && value.trust === "pending-human"
    // Host observations are non-certifying: their external `codex` command
    // may have changed host state outside AgentMo's authority.
    && value.mutatesHost === "unknown"
    && value.externalCommandMutation === "unknown";
}

async function executeScenarios({ admitted, installed, work }) {
  const hookHarness = await prepareAuthenticatedHookHarness({ admitted, installed, work });
  const hookRegistrationMatches = await installedHookRegistrationMatches(installed);
  const runHook = (payload) => runFresh(
    hookHarness.hookPath,
    [],
    `${JSON.stringify(payload)}\n`,
    hookHarness.projectRoot,
    { timeoutMs: AUTHENTIC_HOOK_TIMEOUT_MS },
  );
  const stable = await loadAuthenticatedHookCheckpoint(hookHarness);
  const nonTrigger = await runHook({ hook_event_name: "UserPromptSubmit" });
  const afterNonTrigger = await loadAuthenticatedHookCheckpoint(hookHarness);

  // The authenticated bridge owns one immutable checkpoint journal. These
  // calls deliberately use its real order and verify that same journal.
  const trigger = await runHook({
    hook_event_name: "SessionStart", session_id: "behavior-session", source: "startup",
  });
  const sessionStart = await loadAuthenticatedHookCheckpoint(hookHarness);

  const duplicate = await runHook({
    hook_event_name: "SessionStart", session_id: "behavior-session", source: "startup",
  });
  const afterDuplicate = await loadAuthenticatedHookCheckpoint(hookHarness);

  const paused = await runBuilderCli(
    hookHarness.cliPath,
    [
      "builder", "pause",
      "--checkpoint", hookHarness.checkpointPath,
      "--event-id", "manual-pause-2",
      "--out", hookHarness.checkpointPath,
      "--digest", `builder-checkpoint=${afterDuplicate.digest}`,
      "--json",
    ],
    hookHarness.projectRoot,
    { env: hookHarness.environment, timeoutMs: AUTHENTIC_HOOK_TIMEOUT_MS },
  );
  const manualPause = await loadAuthenticatedHookCheckpoint(hookHarness);

  const preCompactHook = await runHook({
    hook_event_name: "PreCompact", session_id: "behavior-session",
  });
  const preCompact = await loadAuthenticatedHookCheckpoint(hookHarness);

  const postCompactHook = await runHook({
    hook_event_name: "PostCompact", session_id: "behavior-session",
  });
  const postCompact = await loadAuthenticatedHookCheckpoint(hookHarness);

  const restart = await runHook({
    hook_event_name: "SessionStart", session_id: "behavior-session", source: "resume",
  });
  const beforeResume = await loadAuthenticatedHookCheckpoint(hookHarness);
  const resume = await runBuilderCli(
    hookHarness.cliPath,
    [
      "builder", "resume",
      "--checkpoint", hookHarness.checkpointPath,
      "--digest", `builder-checkpoint=${beforeResume.digest}`,
      "--json",
    ],
    hookHarness.projectRoot,
    { env: hookHarness.environment, timeoutMs: AUTHENTIC_HOOK_TIMEOUT_MS },
  );
  const afterResume = await loadAuthenticatedHookCheckpoint(hookHarness);

  return {
    fixture: Object.freeze({
      schemaVersion: "agentmo.builder-behavior-fixture.v1",
      externalCommandMutation: "unknown",
      releaseDigest: hookHarness.releaseDigest,
      receiptDigest: hookHarness.receiptDigest,
      cliDigest: hookHarness.cliDigest,
      runnerDigest: hookHarness.runnerDigest,
      initialCheckpointDigest: hookHarness.initialCheckpointDigest,
      finalCheckpointDigest: afterResume.digest,
    }),
    results: [
    result("trigger-session-start",
      hookRegistrationMatches && exactHookOutput(trigger, "SessionStart")),
    result("non-trigger-user-prompt",
      hookRegistrationMatches
        && noHookOutput(nonTrigger)
        && sameCheckpointHead(afterNonTrigger, stable)),
    result("stable-checkpoint",
      stable.digest === hookHarness.initialCheckpointDigest
        && stable.value.installReceiptDigest === hookHarness.receiptDigest),
    result("session-start-recovery",
      sessionStart.digest !== stable.digest
        && sessionStart.value.boundary === "session-restart"
        && sessionStart.value.pauseReason === "session-restart"
        && sessionStart.value.hookDeactivationProtocol?.state === "hook-finalized"),
    result("duplicate-event-no-op",
      exactEmptyHookOutput(duplicate)
        && sameCheckpointHead(afterDuplicate, sessionStart)),
    result("manual-pause",
      paused.output.status === "applied"
        && manualPause.digest === paused.output.checkpoint.digest
        && manualPause.value.boundary === "manual-pause"
        && manualPause.value.pauseReason === "user-request"
        && paused.output.proposal?.requiresApproval === true),
    result("pre-compact",
      hookRegistrationMatches
        && exactHookOutput(preCompactHook, "PreCompact")
        && preCompact.digest !== manualPause.digest
        && preCompact.value.boundary === "pre-compact"
        && preCompact.value.pauseReason === "context-compaction"
        && preCompact.value.hookDeactivationProtocol?.state === "hook-finalized"),
    result("post-compact",
      hookRegistrationMatches
        && exactHookOutput(postCompactHook, "PostCompact")
        && postCompact.digest !== preCompact.digest
        && postCompact.value.boundary === "post-compact"
        && postCompact.value.pauseReason === "context-compaction"
        && postCompact.value.hookDeactivationProtocol?.state === "hook-finalized"),
    result("restart-resume",
      exactHookOutput(restart, "SessionStart")
        && beforeResume.digest !== postCompact.digest
        && beforeResume.value.boundary === "session-restart"
        && resume.output.mode === "resume"
        && resume.output.approval?.required === true
        && resume.output.certificationBoundary?.hostBehaviorVerified === false
        && sameCheckpointHead(afterResume, beforeResume)),
    ],
  };
}

async function prepareAuthenticatedHookHarness({ admitted, installed, work }) {
  const packageRoot = path.join(work, "authenticated-hook-package");
  const projectRoot = path.join(work, "authenticated-hook-project");
  const home = path.join(work, "authenticated-hook-home");
  await Promise.all([
    mkdir(packageRoot, { mode: 0o700 }),
    mkdir(projectRoot, { mode: 0o700 }),
    mkdir(home, { mode: 0o700 }),
  ]);
  for (const asset of installed.release.assets) {
    const admittedAsset = installed.assets.get(asset.destinationPath);
    if (admittedAsset === undefined
      || admittedAsset.digest !== asset.digest
      || digestRawBytes(admittedAsset.bytes) !== asset.digest) {
      fail("AGENTMO_BUILDER_BEHAVIOR_INSTALL_REJECTED");
    }
    const destination = path.resolve(packageRoot, ...asset.sourcePath.split("/"));
    if (!destination.startsWith(`${packageRoot}${path.sep}`)) {
      fail("AGENTMO_BUILDER_BEHAVIOR_INSTALL_REJECTED");
    }
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, admittedAsset.bytes, { flag: "wx", mode: 0o600 });
  }
  for (const relativePath of BUILDER_NPM_METADATA_FILES) {
    const destination = path.resolve(packageRoot, ...relativePath.split("/"));
    if (!destination.startsWith(`${packageRoot}${path.sep}`)) {
      fail("AGENTMO_BUILDER_BEHAVIOR_INSTALL_REJECTED");
    }
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, AUTHENTIC_HOOK_FIXTURE_METADATA, {
      flag: "wx",
      mode: 0o600,
    });
  }

  const fixtureEnvironment = freshAuthenticatedFixtureEnvironment(home);
  const fixtureCliPath = path.join(packageRoot, "bin", "agentmo.js");
  const fixtureRelease = Object.freeze({
    name: installed.release.name,
    version: installed.release.version,
    digest: installed.release.releaseDigest,
  });
  const preview = await runFresh(
    fixtureCliPath,
    ["builder", "setup", "--project", projectRoot, "--host-scope", "user", "--json"],
    "",
    projectRoot,
    { env: fixtureEnvironment, timeoutMs: AUTHENTIC_HOOK_PREVIEW_TIMEOUT_MS },
  );
  const plan = parseFreshJson(preview);
  if (plan?.schemaVersion !== "agentmo.builder-install-plan.v1"
    || !DIGEST_PATTERN.test(plan?.planDigest ?? "")
    || plan?.capabilityDigest !== admitted.capabilitySnapshot.digest
    || !sameReleaseIdentity(plan?.release, fixtureRelease)
    || plan?.hostActivation?.hostScope !== "user") {
    fail("AGENTMO_BUILDER_BEHAVIOR_INSTALL_REJECTED");
  }
  const applied = await runFresh(
    fixtureCliPath,
    [
      "builder", "setup", "--project", projectRoot, "--host-scope", "user",
      "--apply", "--plan-digest", plan.planDigest, "--json",
    ],
    "",
    projectRoot,
    { env: fixtureEnvironment, timeoutMs: AUTHENTIC_HOOK_SETUP_TIMEOUT_MS },
  );
  const appliedResult = parseFreshJson(applied);
  const receiptDigest = appliedResult?.receipt?.digest;
  if (appliedResult?.schemaVersion !== "agentmo.builder-install-result.v1"
    || appliedResult?.status !== "activated"
    || appliedResult?.planDigest !== plan.planDigest
    || !sameReleaseIdentity(appliedResult?.release, fixtureRelease)
    || appliedResult?.hostActivation?.hostScope !== "user"
    || !DIGEST_PATTERN.test(receiptDigest ?? "")) {
    fail("AGENTMO_BUILDER_BEHAVIOR_INSTALL_REJECTED");
  }

  const checkpointPath = path.join(projectRoot, ".agentmo", "checkpoints", "builder.json");
  const initialCheckpoint = await writeBuilderCheckpoint(checkpointPath, buildBuilderCheckpoint({
    workflowId: "authenticated-hook-behavior-eval",
    adapterId: "codex",
    stage: "discover",
    boundary: "artifact-created",
    artifactRefs: [],
    pendingDecision: null,
    nextAction: "discover",
    installReceiptDigest: receiptDigest,
    capabilitySnapshot: {
      adapterId: "codex",
      evidenceLevel: "observed",
      digest: admitted.capabilitySnapshot.digest,
      required: admitted.capabilitySnapshot.required,
    },
    eventLedger: { cursor: 0, recentEvents: [] },
    pauseReason: null,
  }), { expectedPreviousDigest: null });

  const fixtureMarketplaceRoot = path.join(
    home,
    ".agentmo", "builder", "codex-host", "marketplace", "agentmo-local",
  );
  for (const asset of installed.release.assets) {
    const admittedAsset = installed.assets.get(asset.destinationPath);
    const fixtureAssetPath = path.resolve(
      fixtureMarketplaceRoot,
      ...asset.destinationPath.split("/"),
    );
    if (admittedAsset === undefined
      || admittedAsset.digest !== asset.digest
      || !fixtureAssetPath.startsWith(`${fixtureMarketplaceRoot}${path.sep}`)
      || digestRawBytes(await readBoundedNoFollowFile(fixtureAssetPath)) !== admittedAsset.digest) {
      fail("AGENTMO_BUILDER_BEHAVIOR_INSTALL_REJECTED");
    }
  }
  const runner = installed.assets.get(`${BUILDER_PLUGIN_ROOT}/hooks/agentmo-hook.js`);
  const cli = installed.assets.get(`${BUILDER_PLUGIN_ROOT}/runtime/agentmo/bin/agentmo.js`);
  const hookPath = path.join(
    fixtureMarketplaceRoot,
    ...BUILDER_PLUGIN_ROOT.split("/"), "hooks", "agentmo-hook.js",
  );
  const cliPath = path.join(
    fixtureMarketplaceRoot,
    ...BUILDER_PLUGIN_ROOT.split("/"), "runtime", "agentmo", "bin", "agentmo.js",
  );
  if (runner === undefined
    || cli === undefined
    || digestRawBytes(await readBoundedNoFollowFile(hookPath)) !== runner.digest) {
    fail("AGENTMO_BUILDER_BEHAVIOR_INSTALL_REJECTED");
  }
  return {
    hookPath,
    projectRoot,
    checkpointPath,
    receiptDigest,
    releaseDigest: fixtureRelease.digest,
    cliDigest: cli.digest,
    runnerDigest: runner.digest,
    initialCheckpointDigest: initialCheckpoint.digest,
    cliPath,
    environment: fixtureEnvironment,
  };
}

async function loadAuthenticatedHookCheckpoint(harness) {
  const admission = await loadBuilderCheckpointHead(harness.checkpointPath);
  if (admission === null || admission.value.installReceiptDigest !== harness.receiptDigest) {
    fail("AGENTMO_BUILDER_BEHAVIOR_INSTALL_REJECTED");
  }
  return admission;
}

async function runBuilderCli(filePath, args, childCwd, options) {
  const execution = await runFresh(filePath, args, "", childCwd, options);
  if (execution.code !== 0 || execution.stderr !== "") fail("AGENTMO_BUILDER_BEHAVIOR_CHILD_FAILED");
  let output;
  try {
    output = JSON.parse(execution.stdout);
  } catch {
    fail("AGENTMO_BUILDER_BEHAVIOR_CHILD_FAILED");
  }
  return { output };
}

async function runFresh(filePath, args, input, childCwd, options = {}) {
  const result = await runBoundedFreshCommand({
    command: process.execPath,
    args: [filePath, ...args],
    input,
    cwd: childCwd,
    env: options.env ?? freshChildEnvironment(),
    timeoutMs: options.timeoutMs ?? 10_000,
    maxBytes: MAX_CAPTURE_BYTES,
    captureStderr: true,
  });
  return {
    code: result.ok ? 0 : Number.isInteger(result.code) ? result.code : 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function parseFreshJson(execution) {
  if (execution.code !== 0 || execution.stderr !== "") {
    fail("AGENTMO_BUILDER_BEHAVIOR_INSTALL_REJECTED");
  }
  try {
    return JSON.parse(execution.stdout);
  } catch {
    fail("AGENTMO_BUILDER_BEHAVIOR_INSTALL_REJECTED");
  }
}

async function runFreshHostProbe(command, args, options, childCwd) {
  if (command !== "codex") return { ok: false, failure: "command-not-allowed" };
  const result = await runBoundedFreshCommand({
    command,
    args,
    input: null,
    cwd: childCwd,
    env: freshHostEnvironment(),
    timeoutMs: options.timeoutMs,
    maxBytes: options.maxBytes,
    captureStderr: false,
  });
  return result.ok
    ? { ok: true, code: 0, stdout: result.stdout }
    : {
        ok: false,
        code: result.code,
        stdout: result.stdout,
        failure: result.failure,
      };
}

function runBoundedFreshCommand(request) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(request.command, request.args, {
        cwd: request.cwd,
        env: request.env,
        shell: false,
        stdio: [
          request.input === null ? "ignore" : "pipe",
          "pipe",
          request.captureStderr ? "pipe" : "ignore",
        ],
        windowsHide: true,
        // Builder is POSIX-only. The direct child leads an isolated group so
        // a PATH-shadowed probe cannot leave a daemon retaining our stdio.
        detached: true,
      });
    } catch (error) {
      resolve({
        ok: false,
        code: Number.isInteger(error?.code) ? error.code : null,
        stdout: "",
        stderr: "",
        failure: classifyFreshExecutionFailure(error),
      });
      return;
    }

    const stdoutChunks = [];
    const stderrChunks = [];
    let capturedBytes = 0;
    let terminal = null;
    let directClosed = false;
    let settled = false;
    let deadline = null;
    let deadlineSettlementGrace = null;
    const deadlineAt = performance.now() + request.timeoutMs;
    const capturedText = (chunks) => Buffer.concat(chunks).toString("utf8");
    const closeInput = () => {
      if (request.input === null || child.stdin === null || child.stdin === undefined
        || child.stdin.destroyed || child.stdin.writableEnded) return;
      try {
        child.stdin.end();
      } catch {
        // The close handler remains responsible for reaping the child.
      }
    };
    const destroyChildStreams = () => {
      closeInput();
      if (child.stdin !== null && child.stdin !== undefined) child.stdin.destroy();
      child.stdout.destroy();
      if (request.captureStderr) child.stderr.destroy();
    };
    const lifecycle = createIsolatedProcessGroup(child, FRESH_COMMAND_TERMINATION_GRACE_MS, () => {
      destroyChildStreams();
    });
    const requestTermination = (outcome) => {
      if (terminal !== null || settled) return;
      terminal = outcome;
      closeInput();
      lifecycle.requestShutdown();
    };
    const settleAfterReap = (code) => {
      if (settled) return;
      if (terminal === null && performance.now() >= deadlineAt) {
        terminal = { ok: false, code: null, failure: "timeout" };
      }
      settled = true;
      if (deadline !== null) clearTimeout(deadline);
      if (deadlineSettlementGrace !== null) clearTimeout(deadlineSettlementGrace);
      lifecycle.dispose();
      const stdout = terminal === null ? capturedText(stdoutChunks) : "";
      const stderr = terminal === null && request.captureStderr ? capturedText(stderrChunks) : "";
      if (terminal !== null) {
        resolve({ ...terminal, stdout, stderr });
      } else if (code === 0) {
        resolve({ ok: true, code: 0, stdout, stderr, failure: null });
      } else {
        resolve({
          ok: false,
          code: Number.isInteger(code) ? code : null,
          stdout,
          stderr,
          failure: "command-failed",
        });
      }
    };
    const waitForDirectCloseAndGroupReap = (code) => {
      lifecycle.waitForDeath().then(() => settleAfterReap(code));
    };
    const capture = (chunks) => (chunk) => {
      if (terminal !== null) return;
      const bytes = Buffer.from(chunk);
      capturedBytes += bytes.byteLength;
      if (capturedBytes > request.maxBytes) {
        requestTermination({ ok: false, code: null, failure: "output-too-large" });
        return;
      }
      chunks.push(bytes);
    };

    child.once("error", (error) => requestTermination({
      ok: false,
      code: Number.isInteger(error?.code) ? error.code : null,
      failure: classifyFreshExecutionFailure(error),
    }));
    child.once("error", () => {
      if (child.pid === undefined) waitForDirectCloseAndGroupReap(null);
    });
    child.once("exit", () => {
      if (terminal === null && lifecycle.requestShutdown()) {
        terminal = { ok: false, code: null, failure: "command-failed" };
      }
    });
    child.once("close", (code) => {
      if (directClosed) return;
      directClosed = true;
      lifecycle.requestShutdown();
      waitForDirectCloseAndGroupReap(code);
    });
    child.stdout.once("error", () => requestTermination({
      ok: false,
      code: null,
      failure: "command-failed",
    }));
    if (request.captureStderr) {
      child.stderr.once("error", () => requestTermination({
        ok: false,
        code: null,
        failure: "command-failed",
      }));
    }
    child.stdout.on("data", capture(stdoutChunks));
    if (request.captureStderr) child.stderr.on("data", capture(stderrChunks));
    deadline = setTimeout(() => {
      if (settled) return;
      if (terminal === null) {
        terminal = { ok: false, code: null, failure: "timeout" };
      }
      closeInput();
      lifecycle.requestShutdown();
      // A detached descendant can outlive the process group and retain our
      // pipes.  Close the parent ends at the absolute deadline so the CLI can
      // fail closed instead of waiting forever for a close event.
      destroyChildStreams();
      child.unref();
      // Reaping an external command is best-effort: it may escape the group
      // or become uninterruptible.  Preserve a bounded CLI result either way.
      deadlineSettlementGrace = setTimeout(
        () => settleAfterReap(null),
        FRESH_COMMAND_TERMINATION_GRACE_MS * 2,
      );
      lifecycle.waitForDeath().then(() => settleAfterReap(null));
    }, request.timeoutMs);
    if (request.input !== null && child.stdin !== null && child.stdin !== undefined) {
      child.stdin.once("error", () => requestTermination({
        ok: false,
        code: null,
        failure: "command-failed",
      }));
      try {
        child.stdin.end(request.input);
      } catch {
        requestTermination({ ok: false, code: null, failure: "command-failed" });
      }
    }
  });
}

function createIsolatedProcessGroup(child, graceMs, destroyStreams) {
  const processGroupId = Number.isSafeInteger(child.pid) && child.pid > 0 ? child.pid : null;
  let shutdownRequested = false;
  let confirmedDead = processGroupId === null;
  let forceKillTimer = null;
  let pollTimer = null;
  const waiters = [];
  const groupIsDead = () => {
    if (confirmedDead) return true;
    try {
      process.kill(-processGroupId, 0);
      return false;
    } catch (error) {
      if (error?.code === "ESRCH") {
        confirmedDead = true;
        return true;
      }
      return false;
    }
  };
  const signalGroup = (signal) => {
    if (processGroupId === null || groupIsDead()) return;
    try {
      process.kill(-processGroupId, signal);
    } catch {
      // Liveness is proved separately before evaluation can return.
    }
  };
  const resolveWhenDead = () => {
    if (!groupIsDead()) return false;
    if (forceKillTimer !== null) clearTimeout(forceKillTimer);
    if (pollTimer !== null) clearTimeout(pollTimer);
    forceKillTimer = null;
    pollTimer = null;
    for (const resolve of waiters.splice(0)) resolve();
    return true;
  };
  const pollForDeath = () => {
    if (resolveWhenDead() || pollTimer !== null) return;
    pollTimer = setTimeout(() => {
      pollTimer = null;
      pollForDeath();
    }, 10);
  };
  return {
    requestShutdown() {
      if (shutdownRequested) return !confirmedDead;
      shutdownRequested = true;
      if (resolveWhenDead()) return false;
      signalGroup("SIGTERM");
      forceKillTimer = setTimeout(() => {
        if (!groupIsDead()) {
          signalGroup("SIGKILL");
          try {
            destroyStreams();
          } catch {
            // Group liveness remains the final proof of cleanup.
          }
        }
        pollForDeath();
      }, graceMs);
      pollForDeath();
      return true;
    },
    waitForDeath() {
      if (resolveWhenDead()) return Promise.resolve();
      return new Promise((resolve) => {
        waiters.push(resolve);
        pollForDeath();
      });
    },
    dispose() {
      if (forceKillTimer !== null) clearTimeout(forceKillTimer);
      if (pollTimer !== null) clearTimeout(pollTimer);
      forceKillTimer = null;
      pollTimer = null;
    },
  };
}

function freshChildEnvironment() {
  const env = { LANG: "C", LC_ALL: "C", TZ: "UTC" };
  if (typeof process.env.PATH === "string") env.PATH = process.env.PATH;
  if (process.platform === "win32") {
    for (const key of ["SystemRoot", "WINDIR"]) {
      if (typeof process.env[key] === "string") env[key] = process.env[key];
    }
  }
  return env;
}

function freshAuthenticatedFixtureEnvironment(home) {
  const env = freshChildEnvironment();
  env.HOME = home;
  env.CODEX_HOME = path.join(home, ".codex");
  return env;
}

function freshHostEnvironment() {
  const env = freshChildEnvironment();
  if (process.platform === "win32" && typeof process.env.PATHEXT === "string") {
    env.PATHEXT = process.env.PATHEXT;
  }
  return env;
}

function classifyFreshExecutionFailure(error) {
  if (error?.code === "ENOENT") return "not-found";
  return "command-failed";
}

async function installedHookRegistrationMatches(installed) {
  try {
    const registration = installed.assets.get(`${BUILDER_PLUGIN_ROOT}/hooks/hooks.json`);
    if (registration === undefined) return false;
    const bytes = registration.bytes;
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const decoded = JSON.parse(text);
    return text === `${JSON.stringify(HOOK_REGISTRATION, null, 2)}\n`
      && exactJsonShape(decoded, HOOK_REGISTRATION);
  } catch {
    return false;
  }
}

function exactHookOutput(execution, eventName) {
  if (execution.code !== 0 || execution.stderr !== "") return false;
  let decoded;
  try {
    decoded = JSON.parse(execution.stdout);
  } catch {
    return false;
  }
  const expected = eventName === "PreCompact"
    ? {}
    : {
        hookSpecificOutput: {
          hookEventName: eventName,
          additionalContext: HOOK_CONTEXT,
        },
      };
  return execution.stdout === `${JSON.stringify(expected)}\n`
    && exactJsonShape(decoded, expected);
}

function exactEmptyHookOutput(execution) {
  if (execution.code !== 0 || execution.stderr !== "" || execution.stdout !== "{}\n") return false;
  try {
    return exactJsonShape(JSON.parse(execution.stdout), {});
  } catch {
    return false;
  }
}

function noHookOutput(execution) {
  return execution.code === 0 && execution.stdout === "" && execution.stderr === "";
}

function sameCheckpointHead(left, right) {
  return left !== null
    && right !== null
    && left.digest === right.digest
    && left.sequence === right.sequence
    && left.predecessorDigest === right.predecessorDigest
    && left.publicationDigest === right.publicationDigest
    && exactJsonShape(left.entryIdentity, right.entryIdentity);
}

function sameReleaseIdentity(actual, expected) {
  return actual?.name === expected.name
    && actual?.version === expected.version
    && actual?.digest === expected.digest;
}

function exactJsonShape(actual, expected) {
  if (actual === expected) return true;
  if (!actual || !expected || typeof actual !== "object" || typeof expected !== "object") return false;
  if (Array.isArray(actual) !== Array.isArray(expected)) return false;
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => key === expectedKeys[index]
      && exactJsonShape(actual[key], expected[key]));
}

function boundText(value) {
  const text = typeof value === "string" ? value : "";
  const bytes = Buffer.from(text, "utf8");
  return bytes.length <= MAX_CAPTURE_BYTES
    ? text
    : bytes.subarray(0, MAX_CAPTURE_BYTES).toString("utf8");
}

function result(id, passed) {
  return Object.freeze({ id, passed: passed === true, process: SCENARIOS.find((item) => item.id === id).process });
}

function assertOptions(options) {
  const keys = Object.keys(options ?? {});
  const mechanismKeys = ["projectRoot", "expectedReceiptDigest"];
  const uatKeys = [
    ...mechanismKeys,
    "uatJournalPath",
    "expectedUatHeadDigest",
    "uatCandidatePath",
    "expectedUatCandidateDigest",
    "uatBaselinePackageRoot",
    "uatBaselineTarballPath",
    "uatSuccessorPackageRoot",
    "uatSuccessorTarballPath",
  ];
  const expectedKeys = Object.hasOwn(options ?? {}, "uatJournalPath") ? uatKeys : mechanismKeys;
  if (!options || typeof options !== "object" || Array.isArray(options)
    || keys.length !== expectedKeys.length
    || !keys.every((key) => expectedKeys.includes(key))
    || !Object.hasOwn(options, "projectRoot")
    || !Object.hasOwn(options, "expectedReceiptDigest")
    || typeof options.projectRoot !== "string" || options.projectRoot.length === 0
    || !DIGEST_PATTERN.test(options.expectedReceiptDigest ?? "")
    || (expectedKeys === uatKeys && (
      typeof options.uatJournalPath !== "string"
      || options.uatJournalPath.length === 0
      || typeof options.uatCandidatePath !== "string"
      || options.uatCandidatePath.length === 0
      || typeof options.uatBaselinePackageRoot !== "string"
      || options.uatBaselinePackageRoot.length === 0
      || typeof options.uatBaselineTarballPath !== "string"
      || options.uatBaselineTarballPath.length === 0
      || typeof options.uatSuccessorPackageRoot !== "string"
      || options.uatSuccessorPackageRoot.length === 0
      || typeof options.uatSuccessorTarballPath !== "string"
      || options.uatSuccessorTarballPath.length === 0
      || !DIGEST_PATTERN.test(options.expectedUatHeadDigest ?? "")
      || !DIGEST_PATTERN.test(options.expectedUatCandidateDigest ?? "")
    ))) {
    fail("AGENTMO_BUILDER_BEHAVIOR_OPTIONS_REJECTED");
  }
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
  throw new BuilderBehaviorEvalError(code);
}
