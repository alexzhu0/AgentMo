import path from "node:path";
import { fileURLToPath } from "node:url";
import { digestRawBytes } from "./artifact-admission.js";
import { verifyInstalledBootstrapSnapshot } from "./builder-bootstrap-snapshot.js";
import {
  DEFAULT_MAX_BUILDER_CHECKPOINT_BYTES,
  buildBuilderCheckpoint,
  finalizeBuilderHookCheckpoint,
  loadBuilderCheckpoint,
  prepareBuilderHookCheckpoint,
  upgradeBuilderCheckpointProtocol,
} from "./builder-checkpoint.js";
import { loadImmutableJournal } from "./builder-immutable-journal.js";
import {
  publishCodexUatObservationLeaf,
  releaseCodexUatLeafDirectoryAuthority,
  retainCodexUatLeafDirectoryAuthority,
} from "./builder-codex-uat.js";
import { buildBuilderEvent, reduceBuilderHookEvent } from "./builder-events.js";
import {
  admitBuilderLifecycleReceipt,
  admitVerifiedBootstrapLifecycleReceipt,
  readBuilderLifecycleState,
} from "./builder-lifecycle.js";
import { readBoundedNoFollowFile } from "./builder-package.js";
import { assertBuilderPlatform } from "./builder-platform.js";
import { serializePersistableJson } from "./persistability.js";

export const DEFAULT_MAX_BUILDER_HOOK_INPUT_BYTES = 64 * 1024;

const INSTALLED_CONTEXTS = new WeakSet();
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const HOOK_TYPES = new Set(["SessionStart", "PreCompact", "PostCompact"]);
const SESSION_START_SOURCES = new Set(["unspecified", "startup", "resume", "clear", "compact"]);
const MODULE_PACKAGE_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const PROJECTED_CHECKPOINT_PATH = path.join(".agentmo", "checkpoints", "builder.json");
const STABLE_RUNNER_PATH = path.resolve(
  MODULE_PACKAGE_ROOT,
  "..",
  "..",
  "hooks",
  "agentmo-hook.js",
);

export class BuilderHookBridgeError extends Error {
  constructor(code) {
    super("Builder hook delivery was rejected.");
    this.name = "BuilderHookBridgeError";
    this.code = code;
  }
}

function buildInstalledBuilderHookContext(input) {
  if (!hasExactKeySet(input, [
    "runnerDigest",
    "releaseDigest",
    "installReceiptDigest",
    "correlation",
  ])) {
    fail("AGENTMO_BUILDER_HOOK_BRIDGE_CONTEXT_REJECTED");
  }
  for (const digest of [input.runnerDigest, input.releaseDigest, input.installReceiptDigest]) {
    if (!DIGEST_PATTERN.test(digest ?? "")) fail("AGENTMO_BUILDER_HOOK_BRIDGE_CONTEXT_REJECTED");
  }
  if (input.correlation !== null && !/^opaque:[a-f0-9]{64}$/u.test(input.correlation ?? "")) {
    fail("AGENTMO_BUILDER_HOOK_BRIDGE_CONTEXT_REJECTED");
  }
  const context = Object.freeze({
    runnerDigest: input.runnerDigest,
    releaseDigest: input.releaseDigest,
    installReceiptDigest: input.installReceiptDigest,
    correlation: input.correlation,
  });
  INSTALLED_CONTEXTS.add(context);
  return context;
}

export async function deliverInstalledBuilderHook(input) {
  assertBuilderPlatform();
  if (!hasExactKeySet(input, ["hookInput", "runnerDigest"])
    || !DIGEST_PATTERN.test(input.runnerDigest ?? "")) {
    fail("AGENTMO_BUILDER_HOOK_BRIDGE_INVALID");
  }
  const bootstrapMode = process.env.AGENTMO_BUILDER_HOOK_BOOTSTRAP_MODE;
  if (bootstrapMode !== undefined && bootstrapMode !== "authenticated-graph-v1") {
    fail("AGENTMO_BUILDER_HOOK_BRIDGE_CONTEXT_REJECTED");
  }
  const authenticatedBootstrapGraph = bootstrapMode === "authenticated-graph-v1";
  const projectRoot = path.resolve(process.cwd());
  const lifecycle = await readBuilderLifecycleState({ projectRoot });
  if (lifecycle.recoveryRequired !== null) {
    fail("AGENTMO_BUILDER_HOOK_BRIDGE_LIFECYCLE_RECOVERY_REQUIRED");
  }
  if (lifecycle.status === "deactivated") {
    return Object.freeze({
      schemaVersion: "agentmo.builder-hook-bridge-result.v1",
      status: "deactivated",
      applied: false,
      event: null,
      checkpointDigest: lifecycle.authorityHeadDigest,
      reducedCheckpointDigest: lifecycle.authorityHeadDigest,
      observationDigest: null,
      announcement: null,
      proposal: null,
    });
  }
  const checkpointPath = path.join(projectRoot, PROJECTED_CHECKPOINT_PATH);
  const receiptDigest = lifecycle.activeReceiptDigest;
  let bootstrapCapability = null;
  if (authenticatedBootstrapGraph) {
    try {
      bootstrapCapability = await verifyInstalledBootstrapSnapshot({
        // The host-installed runner and its authenticated module graph remain
        // anchored to the original activation projection.  An immutable
        // successor is selected only after that graph has authenticated the
        // lifecycle chain; it is never a replacement graph trust anchor.
        activationReceipt: lifecycle.genesisReceipt,
        receiptDigest: lifecycle.genesisReceiptDigest,
        runnerDigest: input.runnerDigest,
      });
    } catch {
      fail("AGENTMO_BUILDER_HOOK_BRIDGE_CONTEXT_REJECTED");
    }
  }
  const admitted = authenticatedBootstrapGraph
    ? await admitVerifiedBootstrapLifecycleReceipt({
        bootstrapCapability,
        projectRoot,
        expectedReceiptDigest: receiptDigest,
        runnerDigest: input.runnerDigest,
      })
    : await admitBuilderLifecycleReceipt({ projectRoot, expectedReceiptDigest: receiptDigest });
  const release = admitted.package;
  const runnerAsset = release.assets.find((asset) => asset.sourcePath === "plugin/hooks/agentmo-hook.js");
  if (!runnerAsset
    || runnerAsset.destinationPath !== "plugins/agentmo/hooks/agentmo-hook.js"
    || runnerAsset.digest !== input.runnerDigest) {
    fail("AGENTMO_BUILDER_HOOK_BRIDGE_CONTEXT_REJECTED");
  }
  if (!authenticatedBootstrapGraph) {
    const runnerBytes = await readBoundedNoFollowFile(
      STABLE_RUNNER_PATH,
      DEFAULT_MAX_BUILDER_HOOK_INPUT_BYTES,
    );
    if (runnerAsset.digest !== digestRawBytes(runnerBytes)) {
      fail("AGENTMO_BUILDER_HOOK_BRIDGE_CONTEXT_REJECTED");
    }
  }
  const checkpointJournal = await loadImmutableJournal({
    journalPath: checkpointPath,
    maxValueBytes: DEFAULT_MAX_BUILDER_CHECKPOINT_BYTES,
  });
  if (checkpointJournal.head === null) fail("AGENTMO_BUILDER_HOOK_BRIDGE_INVALID");
  let checkpointAdmission = await loadBuilderCheckpoint(checkpointPath, {
    expectedDigest: checkpointJournal.head.digest,
  });
  checkpointAdmission = await upgradeBuilderCheckpointProtocol(
    checkpointPath,
    checkpointAdmission,
  );
  if (!admitted.receiptLineageDigests.includes(
    checkpointAdmission.value.installReceiptDigest,
  )) {
    fail("AGENTMO_BUILDER_HOOK_BRIDGE_RECEIPT_MISMATCH");
  }
  const installedContext = buildInstalledBuilderHookContext({
    runnerDigest: input.runnerDigest,
    releaseDigest: release.releaseDigest,
    installReceiptDigest: receiptDigest,
    correlation: checkpointAdmission.value.codexUatChallenge?.correlation ?? null,
  });
  return deliverBuilderHook({
    checkpointPath,
    expectedCheckpointDigest: checkpointAdmission.digest,
    expectedLifecycleHeadDigest: lifecycle.authorityHeadDigest,
    acceptedReceiptDigests: admitted.receiptLineageDigests,
    hookInput: input.hookInput,
    installedContext,
    projectRoot,
  });
}

async function deliverBuilderHook(input) {
  if (!hasExactKeySet(input, [
    "checkpointPath",
    "expectedCheckpointDigest",
    "expectedLifecycleHeadDigest",
    "acceptedReceiptDigests",
    "hookInput",
    "installedContext",
    "projectRoot",
  ])) {
    fail("AGENTMO_BUILDER_HOOK_BRIDGE_INVALID");
  }
  if (!INSTALLED_CONTEXTS.has(input.installedContext)) {
    fail("AGENTMO_BUILDER_HOOK_BRIDGE_CONTEXT_REJECTED");
  }
  const delivery = normalizeHostDelivery(input.hookInput);
  const admission = await loadBuilderCheckpoint(input.checkpointPath, {
    expectedDigest: input.expectedCheckpointDigest,
  });
  if (admission.value.adapterId !== "codex") fail("AGENTMO_BUILDER_HOOK_BRIDGE_SCOPE_REJECTED");
  if (!input.acceptedReceiptDigests.includes(admission.value.installReceiptDigest)) {
    fail("AGENTMO_BUILDER_HOOK_BRIDGE_RECEIPT_MISMATCH");
  }
  if (admission.value.codexUatChallenge?.scenario === "deactivation-tombstone-visibility") {
    fail("AGENTMO_BUILDER_HOOK_BRIDGE_STATE_REJECTED");
  }
  const protocol = admission.value.hookDeactivationProtocol;
  if (["deactivation-fenced", "upgrade-reserved"].includes(protocol.state)) {
    fail("AGENTMO_BUILDER_HOOK_BRIDGE_STATE_REJECTED");
  }

  const derived = deriveDelivery(admission.value, delivery);
  if (protocol.state === "hook-prepared") {
    if (protocol.delivery.identity !== derived.identity
      || protocol.delivery.eventDigest !== derived.record.eventDigest) {
      fail("AGENTMO_BUILDER_HOOK_BRIDGE_STATE_REJECTED");
    }
    return completePreparedHook(input, admission, protocol);
  }
  if (protocol.state === "hook-finalized"
    && protocol.delivery.identity === derived.identity
    && protocol.delivery.eventDigest === derived.record.eventDigest) {
    await assertHookLifecycleAdmission(input);
    return finalizedProtocolResult(admission, protocol, { replay: true });
  }
  const event = buildBuilderEvent({
    workflowId: admission.value.workflowId,
    adapterId: admission.value.adapterId,
    eventId: eventIdForIdentity(derived.identity),
    sequence: derived.record.sequence,
    origin: "hook",
    type: delivery.type,
    data: {},
  });
  const eventDigest = digestJson(event, "builder-event");
  if (derived.replay && eventDigest !== derived.record.eventDigest) {
    fail("AGENTMO_BUILDER_HOOK_BRIDGE_DIGEST_COLLISION");
  }
  const record = Object.freeze({
    identity: derived.identity,
    sequence: derived.record.sequence,
    eventDigest,
  });
  const result = reduceBuilderHookEvent(admission.value, event);
  const eventOutput = Object.freeze({
    type: delivery.type,
    identity: derived.identity,
    epoch: derived.epoch,
    sequence: record.sequence,
    digest: eventDigest,
  });
  const observationStatus = !result.applied && derived.replay && result.status === "stale"
    ? "duplicate"
    : result.status;
  const observationRequired = installedObservationApplies({
    checkpoint: admission.value,
    context: input.installedContext,
    eventType: delivery.type,
    applied: result.applied,
    status: observationStatus,
  });
  const observationDirectory = path.join(
    path.dirname(path.resolve(input.checkpointPath)),
    "uat-observations",
  );
  const observationAuthority = observationRequired
    ? await retainCodexUatLeafDirectoryAuthority(observationDirectory)
    : null;

  try {
    if (!result.applied) {
      if (!derived.replay || !["duplicate", "stale"].includes(result.status)) {
        fail("AGENTMO_BUILDER_HOOK_BRIDGE_STATE_REJECTED");
      }
      const replayResult = result.status === "stale"
        ? Object.freeze({
            ...result,
            status: "duplicate",
          })
        : result;
      await assertHookLifecycleAdmission(input);
      if (!observationRequired) {
        return freezeResult({
          result: replayResult,
          event: eventOutput,
          checkpointDigest: admission.digest,
          reducedCheckpointDigest: admission.digest,
          observationDigest: null,
        });
      }
      const prepared = await prepareBuilderHookCheckpoint(input.checkpointPath, {
        checkpointAdmission: admission,
        checkpoint: admission.value,
        lifecycleHeadDigest: input.expectedLifecycleHeadDigest,
        receiptDigest: input.installedContext.installReceiptDigest,
        delivery: hookProtocolDelivery({
          derived,
          delivery,
          eventDigest,
          applied: false,
          status: replayResult.status,
          observationRequired,
        }),
      });
      const observationDigest = await publishInstalledObservation({
        checkpoint: prepared.value,
        context: input.installedContext,
        eventType: delivery.type,
        eventDigest,
        applied: false,
        status: replayResult.status,
        checkpointPath: input.checkpointPath,
        parentAuthority: observationAuthority,
      });
      const finalized = await finalizeBuilderHookCheckpoint(
        input.checkpointPath,
        prepared,
        observationDigest,
      );
      return freezeResult({
        result: replayResult,
        event: eventOutput,
        checkpointDigest: finalized.digest,
        reducedCheckpointDigest: admission.digest,
        observationDigest,
      });
    }

    const codexDeliveryCursor = applyDeliveryCursor(
      admission.value.codexDeliveryCursor,
      delivery,
      derived.epoch,
      record,
    );
    const reducedCheckpoint = buildBuilderCheckpoint({
      ...result.checkpoint,
      installReceiptDigest: input.installedContext.installReceiptDigest,
      codexDeliveryCursor,
      codexUatChallenge: admission.value.codexUatChallenge,
      hookDeactivationProtocol: admission.value.hookDeactivationProtocol,
    });
    const reducedCheckpointDigest = digestJson(reducedCheckpoint, "builder-checkpoint");
    await assertHookLifecycleAdmission(input);
    const prepared = await prepareBuilderHookCheckpoint(input.checkpointPath, {
      checkpointAdmission: admission,
      checkpoint: reducedCheckpoint,
      lifecycleHeadDigest: input.expectedLifecycleHeadDigest,
      receiptDigest: input.installedContext.installReceiptDigest,
      delivery: hookProtocolDelivery({
        derived,
        delivery,
        eventDigest,
        applied: true,
        status: result.status,
        observationRequired,
      }),
    });
    const observationDigest = await publishInstalledObservation({
      checkpoint: prepared.value,
      context: input.installedContext,
      eventType: delivery.type,
      eventDigest,
      applied: true,
      status: result.status,
      checkpointPath: input.checkpointPath,
      parentAuthority: observationAuthority,
    });
    const finalized = await finalizeBuilderHookCheckpoint(
      input.checkpointPath,
      prepared,
      observationDigest,
    );
    return freezeResult({
      result,
      event: eventOutput,
      checkpointDigest: finalized.digest,
      reducedCheckpointDigest,
      observationDigest,
    });
  } finally {
    if (observationAuthority !== null) {
      await releaseCodexUatLeafDirectoryAuthority(observationAuthority);
    }
  }
}

async function assertHookLifecycleAdmission(input) {
  const lifecycle = await readBuilderLifecycleState({ projectRoot: input.projectRoot });
  if (lifecycle.status !== "active"
    || lifecycle.authorityHeadDigest !== input.expectedLifecycleHeadDigest
    || lifecycle.activeReceiptDigest !== input.installedContext.installReceiptDigest) {
    fail("AGENTMO_BUILDER_HOOK_BRIDGE_STATE_REJECTED");
  }
}

async function completePreparedHook(input, admission, protocol) {
  if (protocol.lifecycleHeadDigest !== input.expectedLifecycleHeadDigest
    || protocol.receiptDigest !== input.installedContext.installReceiptDigest) {
    fail("AGENTMO_BUILDER_HOOK_BRIDGE_STATE_REJECTED");
  }
  await assertHookLifecycleAdmission(input);
  const observationDirectory = path.join(
    path.dirname(path.resolve(input.checkpointPath)),
    "uat-observations",
  );
  const observationAuthority = protocol.delivery.observationRequired
    ? await retainCodexUatLeafDirectoryAuthority(observationDirectory)
    : null;
  try {
    const observationDigest = await publishInstalledObservation({
      checkpoint: admission.value,
      context: input.installedContext,
      eventType: protocol.delivery.type,
      eventDigest: protocol.delivery.eventDigest,
      applied: protocol.delivery.applied,
      status: protocol.delivery.status,
      checkpointPath: input.checkpointPath,
      parentAuthority: observationAuthority,
    });
    const finalized = await finalizeBuilderHookCheckpoint(
      input.checkpointPath,
      admission,
      observationDigest,
    );
    return finalizedProtocolResult(finalized, finalized.value.hookDeactivationProtocol);
  } finally {
    if (observationAuthority !== null) {
      await releaseCodexUatLeafDirectoryAuthority(observationAuthority);
    }
  }
}

function hookProtocolDelivery({
  derived,
  delivery,
  eventDigest,
  applied,
  status,
  observationRequired,
}) {
  return {
    identity: derived.identity,
    type: delivery.type,
    epoch: derived.epoch,
    sequence: derived.record.sequence,
    eventDigest,
    applied,
    status,
    observationRequired,
  };
}

function finalizedProtocolResult(admission, protocol, { replay = false } = {}) {
  const result = {
    status: replay ? "duplicate" : protocol.delivery.status,
    applied: replay ? false : protocol.delivery.applied,
    announcement: replay
      ? null
      : announcementForProtocol(protocol.delivery.type, admission.value),
    proposal: replay
      ? null
      : proposalForProtocol(protocol.delivery.type, admission.value),
  };
  return freezeResult({
    result,
    event: {
      type: protocol.delivery.type,
      identity: protocol.delivery.identity,
      epoch: protocol.delivery.epoch,
      sequence: protocol.delivery.sequence,
      digest: protocol.delivery.eventDigest,
    },
    checkpointDigest: admission.digest,
    reducedCheckpointDigest: admission.digest,
    observationDigest: protocol.observationDigest,
  });
}

function announcementForProtocol(type, checkpoint) {
  if (type === "SessionStart") return `AgentMo checkpoint detected at ${checkpoint.stage}.`;
  if (type === "PostCompact") return `AgentMo checkpoint remains resumable at ${checkpoint.stage}.`;
  if (type === "PreCompact") return "AgentMo verified checkpoint flushed before compaction.";
  return null;
}

function proposalForProtocol(type, checkpoint) {
  if (!["SessionStart", "PostCompact"].includes(type)) return null;
  return Object.freeze({
    kind: "resume",
    stage: checkpoint.nextAction === "await-approval"
      ? checkpoint.stage
      : checkpoint.nextAction,
    requiresApproval: true,
    automaticStageAdvance: false,
  });
}

function normalizeHostDelivery(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("AGENTMO_BUILDER_HOOK_BRIDGE_IDENTITY_REJECTED");
  }
  let encoded;
  try {
    encoded = Buffer.from(JSON.stringify(value), "utf8");
  } catch {
    fail("AGENTMO_BUILDER_HOOK_BRIDGE_IDENTITY_REJECTED");
  }
  if (encoded.byteLength > DEFAULT_MAX_BUILDER_HOOK_INPUT_BYTES) {
    fail("AGENTMO_BUILDER_HOOK_BRIDGE_SIZE_REJECTED");
  }
  const type = value.hook_event_name;
  if (!HOOK_TYPES.has(type)) fail("AGENTMO_BUILDER_HOOK_BRIDGE_EVENT_REJECTED");
  const sessionId = value.session_id;
  if (typeof sessionId !== "string"
    || sessionId.length === 0
    || sessionId.length > 256
    || /[\u0000-\u001f\u007f]/u.test(sessionId)) {
    fail("AGENTMO_BUILDER_HOOK_BRIDGE_IDENTITY_REJECTED");
  }
  const source = type === "SessionStart" ? value.source ?? "unspecified" : "unspecified";
  if (!SESSION_START_SOURCES.has(source)) fail("AGENTMO_BUILDER_HOOK_BRIDGE_SOURCE_REJECTED");
  return Object.freeze({
    type,
    sessionDigest: digestJson({
      schemaVersion: "agentmo.codex-session-identity.v1",
      sessionId,
    }, "builder-hook-session-identity"),
    source,
  });
}

function deriveDelivery(checkpoint, delivery) {
  const cursor = checkpoint.codexDeliveryCursor;
  if (cursor.sessionDigest !== null && cursor.sessionDigest !== delivery.sessionDigest) {
    fail("AGENTMO_BUILDER_HOOK_BRIDGE_SESSION_MISMATCH");
  }
  if (delivery.type !== "SessionStart" && cursor.sessionStart === null) {
    fail("AGENTMO_BUILDER_HOOK_BRIDGE_ORDER_REJECTED");
  }
  if (delivery.type === "SessionStart") {
    const identity = deliveryIdentity({
      type: delivery.type,
      sessionDigest: delivery.sessionDigest,
      source: delivery.source,
    });
    if (cursor.sessionStart?.identity === identity) {
      return replayDelivery(identity, 0, cursor.sessionStart);
    }
    return newDelivery(identity, 0, checkpoint.eventLedger.cursor + 1);
  }
  if (delivery.type === "PreCompact") {
    if (cursor.compactState === "pre-applied") {
      const identity = deliveryIdentity({
        type: delivery.type,
        sessionDigest: delivery.sessionDigest,
        epoch: cursor.compactionEpoch,
      });
      if (cursor.preCompact?.identity !== identity) {
        fail("AGENTMO_BUILDER_HOOK_BRIDGE_DIGEST_COLLISION");
      }
      return replayDelivery(identity, cursor.compactionEpoch, cursor.preCompact);
    }
    if (!new Set(["idle", "post-applied"]).has(cursor.compactState)) {
      fail("AGENTMO_BUILDER_HOOK_BRIDGE_ORDER_REJECTED");
    }
    const epoch = cursor.compactionEpoch + 1;
    const identity = deliveryIdentity({
      type: delivery.type,
      sessionDigest: delivery.sessionDigest,
      epoch,
    });
    return newDelivery(identity, epoch, checkpoint.eventLedger.cursor + 1);
  }
  if (cursor.compactState === "post-applied") {
    const identity = deliveryIdentity({
      type: delivery.type,
      sessionDigest: delivery.sessionDigest,
      epoch: cursor.compactionEpoch,
      preIdentity: cursor.preCompact?.identity,
    });
    if (cursor.postCompact?.identity !== identity) {
      fail("AGENTMO_BUILDER_HOOK_BRIDGE_DIGEST_COLLISION");
    }
    return replayDelivery(identity, cursor.compactionEpoch, cursor.postCompact);
  }
  if (cursor.compactState !== "pre-applied" || cursor.preCompact === null) {
    fail("AGENTMO_BUILDER_HOOK_BRIDGE_ORDER_REJECTED");
  }
  const identity = deliveryIdentity({
    type: delivery.type,
    sessionDigest: delivery.sessionDigest,
    epoch: cursor.compactionEpoch,
    preIdentity: cursor.preCompact.identity,
  });
  return newDelivery(identity, cursor.compactionEpoch, checkpoint.eventLedger.cursor + 1);
}

function newDelivery(identity, epoch, sequence) {
  return Object.freeze({
    identity,
    epoch,
    replay: false,
    record: Object.freeze({ sequence, eventDigest: null }),
  });
}

function replayDelivery(identity, epoch, record) {
  if (!record) fail("AGENTMO_BUILDER_HOOK_BRIDGE_ORDER_REJECTED");
  return Object.freeze({ identity, epoch, replay: true, record });
}

function applyDeliveryCursor(cursor, delivery, epoch, record) {
  if (delivery.type === "SessionStart") {
    return {
      ...cursor,
      sessionDigest: delivery.sessionDigest,
      sessionStart: record,
    };
  }
  if (delivery.type === "PreCompact") {
    return {
      ...cursor,
      compactionEpoch: epoch,
      compactState: "pre-applied",
      preCompact: record,
      postCompact: null,
    };
  }
  return {
    ...cursor,
    compactState: "post-applied",
    postCompact: record,
  };
}

async function publishInstalledObservation({
  checkpoint,
  context,
  eventType,
  eventDigest,
  applied,
  status,
  checkpointPath,
  parentAuthority,
}) {
  const challenge = checkpoint.codexUatChallenge;
  if (!installedObservationApplies({
    checkpoint,
    context,
    eventType,
    applied,
    status,
  })) return null;
  if (parentAuthority === null) fail("AGENTMO_BUILDER_HOOK_BRIDGE_STATE_REJECTED");
  const observationDirectory = path.join(
    path.dirname(path.resolve(checkpointPath)),
    "uat-observations",
  );
  const observation = await publishCodexUatObservationLeaf({
    outDirectory: observationDirectory,
    attemptId: challenge.attemptId,
    scenario: challenge.scenario,
    correlation: challenge.correlation,
    source: "installed-hook-untrusted",
    eventDigest,
    runnerDigest: context.runnerDigest,
    releaseDigest: context.releaseDigest,
    installReceiptDigest: context.installReceiptDigest,
    parentAuthority,
  });
  return observation.digest;
}

function installedObservationApplies({ checkpoint, context, eventType, applied, status }) {
  const challenge = checkpoint.codexUatChallenge;
  if (challenge === null || context.correlation !== challenge.correlation) return false;
  const expectedHook = new Map([
    ["session-start", "SessionStart"],
    ["pre-compact", "PreCompact"],
    ["post-compact", "PostCompact"],
    ["restart-resume", "SessionStart"],
    ["second-compaction", "PreCompact"],
  ]).get(challenge.scenario);
  const observesDuplicate = challenge.scenario === "duplicate-replay"
    && applied === false
    && status === "duplicate";
  return observesDuplicate || (expectedHook !== undefined && expectedHook === eventType);
}

function freezeResult({
  result,
  event,
  checkpointDigest,
  reducedCheckpointDigest,
  observationDigest,
}) {
  return Object.freeze({
    schemaVersion: "agentmo.builder-hook-bridge-result.v1",
    status: result.status,
    applied: result.applied,
    event,
    checkpointDigest,
    reducedCheckpointDigest,
    observationDigest,
    announcement: result.announcement,
    proposal: result.proposal,
  });
}

function deliveryIdentity(value) {
  return digestJson({
    schemaVersion: "agentmo.codex-delivery-identity.v1",
    ...value,
  }, "builder-hook-delivery-identity");
}

function eventIdForIdentity(identity) {
  return `codex-${identity.slice("sha256:".length)}`;
}

function digestJson(value, subject) {
  return digestRawBytes(Buffer.from(serializePersistableJson(value, { subject }), "utf8"));
}

function hasExactKeySet(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function fail(code) {
  throw new BuilderHookBridgeError(code);
}
