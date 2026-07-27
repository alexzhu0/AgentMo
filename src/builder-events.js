import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { digestRawBytes } from "./artifact-admission.js";
import {
  assertAuthenticBuilderCheckpoint,
  buildBuilderCheckpoint,
} from "./builder-checkpoint.js";
import { assertBuilderPlatform } from "./builder-platform.js";
import { assertPersistable, serializePersistableJson } from "./persistability.js";

export const BUILDER_EVENT_SCHEMA_VERSION = "agentmo.builder-event.v1";
export const DEFAULT_MAX_BUILDER_EVENT_BYTES = 64 * 1024;

const EVENTS = new WeakSet();
const EVENT_ADMISSIONS = new WeakSet();
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const TYPES = new Set([
  "SessionStart",
  "PreCompact",
  "PostCompact",
  "ManualPause",
  "ArtifactCreated",
  "ApprovalRequired",
  "ApprovalResolved",
  "StageTransition",
]);
const ORIGINS = new Set(["hook", "user", "core"]);
const HOOK_TYPES = new Set(["SessionStart", "PreCompact", "PostCompact"]);
const EVENT_KEYS = Object.freeze([
  "schemaVersion",
  "workflowId",
  "adapterId",
  "eventId",
  "sequence",
  "origin",
  "type",
  "data",
]);

export class BuilderEventError extends Error {
  constructor(code) {
    super("Builder event operation was rejected.");
    this.name = "BuilderEventError";
    this.code = code;
  }
}

export function buildBuilderEvent(input) {
  assertEventInputShape(input);
  const event = {
    schemaVersion: BUILDER_EVENT_SCHEMA_VERSION,
    workflowId: input?.workflowId,
    adapterId: input?.adapterId,
    eventId: input?.eventId,
    sequence: input?.sequence,
    origin: input?.origin,
    type: input?.type,
    data: normalizeEventData(input?.type, input?.data),
  };
  validateBuilderEvent(event);
  assertPersistable(event, { subject: "builder-event" });
  deepFreeze(event);
  EVENTS.add(event);
  return event;
}

export function admitBuilderEvent(bytes, expectedDigest) {
  if (!Buffer.isBuffer(bytes) || !DIGEST_PATTERN.test(expectedDigest ?? "")) fail("AGENTMO_BUILDER_EVENT_INVALID");
  if (digestRawBytes(bytes) !== expectedDigest) fail("AGENTMO_BUILDER_EVENT_DIGEST_MISMATCH");
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail("AGENTMO_BUILDER_EVENT_INVALID");
  }
  validateBuilderEvent(value);
  const canonical = serializePersistableJson(value, { subject: "builder-event" });
  if (!bytes.equals(Buffer.from(canonical, "utf8"))) fail("AGENTMO_BUILDER_EVENT_INVALID");
  deepFreeze(value);
  EVENTS.add(value);
  return mintEventAdmission(value, expectedDigest);
}

export async function loadBuilderEvent(filePath, options = {}) {
  assertBuilderPlatform();
  const expectedDigest = options.expectedDigest;
  if (!DIGEST_PATTERN.test(expectedDigest ?? "")) fail("AGENTMO_BUILDER_EVENT_INVALID");
  const bytes = await readEventBytes(
    filePath,
    options.maxBytes ?? DEFAULT_MAX_BUILDER_EVENT_BYTES,
    options.openInput ?? open,
  );
  return admitBuilderEvent(bytes, expectedDigest);
}

export function validateBuilderEvent(event) {
  if (!hasExactKeys(event, EVENT_KEYS)) fail("AGENTMO_BUILDER_EVENT_INVALID");
  if (
    event.schemaVersion !== BUILDER_EVENT_SCHEMA_VERSION ||
    !ID_PATTERN.test(event.workflowId ?? "") ||
    !/^[a-z][a-z0-9-]{1,63}$/u.test(event.adapterId ?? "") ||
    !ID_PATTERN.test(event.eventId ?? "") ||
    !Number.isSafeInteger(event.sequence) ||
    event.sequence <= 0 ||
    !ORIGINS.has(event.origin) ||
    !TYPES.has(event.type)
  ) {
    fail("AGENTMO_BUILDER_EVENT_INVALID");
  }
  if (event.origin === "hook" && !HOOK_TYPES.has(event.type)) fail("AGENTMO_BUILDER_EVENT_ORIGIN_REJECTED");
  if (event.origin === "user" && event.type !== "ManualPause") fail("AGENTMO_BUILDER_EVENT_ORIGIN_REJECTED");
  if (event.origin === "core" && ["SessionStart", "PreCompact", "PostCompact", "ManualPause"].includes(event.type)) {
    fail("AGENTMO_BUILDER_EVENT_ORIGIN_REJECTED");
  }
  validateEventData(event.type, event.data);
  assertPersistable(event, { subject: "builder-event" });
  return { ok: true };
}

export function reduceBuilderEvent(checkpoint, eventOrAdmission) {
  assertAuthenticBuilderCheckpoint(checkpoint);
  const admittedEvent = authenticEvent(eventOrAdmission);
  const event = admittedEvent.value;
  if (event.workflowId !== checkpoint.workflowId || event.adapterId !== checkpoint.adapterId) {
    fail("AGENTMO_BUILDER_EVENT_SCOPE_REJECTED");
  }
  const previous = checkpoint.eventLedger.recentEvents.find((item) => item.eventId === event.eventId);
  if (previous) {
    if (previous.sequence !== event.sequence || previous.digest !== admittedEvent.digest) {
      fail("AGENTMO_BUILDER_EVENT_CONFLICT_REJECTED");
    }
    return Object.freeze({
      schemaVersion: "agentmo.builder-event-result.v1",
      status: "duplicate",
      applied: false,
      eventId: event.eventId,
      checkpoint,
      announcement: null,
      proposal: null,
    });
  }
  if (event.sequence <= checkpoint.eventLedger.cursor) {
    return Object.freeze({
      schemaVersion: "agentmo.builder-event-result.v1",
      status: "stale",
      applied: false,
      eventId: event.eventId,
      checkpoint,
      announcement: null,
      proposal: null,
    });
  }
  if (event.sequence !== checkpoint.eventLedger.cursor + 1) fail("AGENTMO_BUILDER_EVENT_CURSOR_REJECTED");

  const next = applyEvent(checkpoint, event);
  const updated = buildBuilderCheckpoint({
    ...next,
    eventLedger: {
      cursor: event.sequence,
      recentEvents: [
        ...checkpoint.eventLedger.recentEvents,
        { eventId: event.eventId, sequence: event.sequence, digest: admittedEvent.digest },
      ].slice(-64),
    },
  });
  return Object.freeze({
    schemaVersion: "agentmo.builder-event-result.v1",
    status: "applied",
    applied: true,
    eventId: event.eventId,
    checkpoint: updated,
    announcement: announcementFor(event, updated),
    proposal: proposalFor(event, updated),
  });
}

export function reduceBuilderHookEvent(checkpoint, eventOrAdmission) {
  const event = authenticEvent(eventOrAdmission).value;
  if (event.origin !== "hook" || !HOOK_TYPES.has(event.type)) {
    fail("AGENTMO_BUILDER_EVENT_ORIGIN_REJECTED");
  }
  return reduceBuilderEvent(checkpoint, eventOrAdmission);
}

function applyEvent(checkpoint, event) {
  const next = {
    workflowId: checkpoint.workflowId,
    adapterId: checkpoint.adapterId,
    stage: checkpoint.stage,
    boundary: checkpoint.boundary,
    artifactRefs: checkpoint.artifactRefs,
    pendingDecision: checkpoint.pendingDecision,
    nextAction: checkpoint.nextAction,
    installReceiptDigest: checkpoint.installReceiptDigest,
    capabilitySnapshot: checkpoint.capabilitySnapshot,
    eventLedger: checkpoint.eventLedger,
    pauseReason: checkpoint.pauseReason,
    codexDeliveryCursor: checkpoint.codexDeliveryCursor,
    codexUatChallenge: checkpoint.codexUatChallenge,
  };
  if (event.type === "SessionStart") {
    next.boundary = "session-restart";
    next.pauseReason = "session-restart";
  } else if (event.type === "PreCompact") {
    next.boundary = "pre-compact";
    next.pauseReason = "context-compaction";
  } else if (event.type === "PostCompact") {
    next.boundary = "post-compact";
    next.pauseReason = "context-compaction";
  } else if (event.type === "ManualPause") {
    next.boundary = "manual-pause";
    next.pauseReason = "user-request";
  } else if (event.type === "ArtifactCreated") {
    next.boundary = "artifact-created";
    next.artifactRefs = [...checkpoint.artifactRefs, event.data.artifactRef];
    next.nextAction = event.data.nextAction;
    next.pauseReason = null;
  } else if (event.type === "ApprovalRequired") {
    if (checkpoint.pendingDecision !== null || checkpoint.nextAction === "await-approval") {
      fail("AGENTMO_BUILDER_EVENT_TRANSITION_REJECTED");
    }
    next.boundary = "approval-required";
    next.pendingDecision = event.data.decision;
    next.nextAction = "await-approval";
    next.pauseReason = "approval-required";
  } else if (event.type === "ApprovalResolved") {
    if (
      checkpoint.pendingDecision?.id !== event.data.decisionId
      || checkpoint.pendingDecision?.summaryDigest !== event.data.summaryDigest
      || checkpoint.nextAction !== "await-approval"
    ) {
      fail("AGENTMO_BUILDER_EVENT_TRANSITION_REJECTED");
    }
    const approvedNext = checkpoint.stage === "discover"
      ? "plan"
      : checkpoint.stage === "plan" ? "produce" : "complete";
    const expectedNext = event.data.outcome === "approved" ? approvedNext : checkpoint.stage;
    if (event.data.nextAction !== expectedNext) fail("AGENTMO_BUILDER_EVENT_TRANSITION_REJECTED");
    next.boundary = "approval-resolved";
    next.pendingDecision = null;
    next.nextAction = event.data.nextAction;
    next.pauseReason = null;
  } else if (event.type === "StageTransition") {
    if (checkpoint.pendingDecision !== null || checkpoint.nextAction !== event.data.toStage) {
      fail("AGENTMO_BUILDER_EVENT_TRANSITION_REJECTED");
    }
    const expected = checkpoint.stage === "discover" ? "plan" : checkpoint.stage === "plan" ? "produce" : null;
    if (event.data.toStage !== expected) fail("AGENTMO_BUILDER_EVENT_TRANSITION_REJECTED");
    next.stage = event.data.toStage;
    next.boundary = "stage-transition";
    next.nextAction = event.data.toStage;
    next.pauseReason = null;
  }
  return next;
}

function normalizeEventData(type, data) {
  if (["SessionStart", "PreCompact", "PostCompact"].includes(type)) return {};
  if (type === "ManualPause") return { reason: data?.reason };
  if (type === "ArtifactCreated") {
    return {
      artifactRef: {
        subject: data?.artifactRef?.subject,
        path: data?.artifactRef?.path,
        digest: data?.artifactRef?.digest,
      },
      nextAction: data?.nextAction,
    };
  }
  if (type === "ApprovalRequired") {
    return {
      decision: {
        id: data?.decision?.id,
        kind: data?.decision?.kind,
        summaryDigest: data?.decision?.summaryDigest,
      },
    };
  }
  if (type === "ApprovalResolved") {
    return {
      decisionId: data?.decisionId,
      summaryDigest: data?.summaryDigest,
      outcome: data?.outcome,
      nextAction: data?.nextAction,
    };
  }
  if (type === "StageTransition") return { toStage: data?.toStage };
  return data;
}

function assertEventInputShape(input) {
  if (!hasKeySet(input, EVENT_KEYS.filter((key) => key !== "schemaVersion"))
    && !hasKeySet(input, EVENT_KEYS)) {
    fail("AGENTMO_BUILDER_EVENT_INVALID");
  }
  if (Object.hasOwn(input, "schemaVersion") && input.schemaVersion !== BUILDER_EVENT_SCHEMA_VERSION) {
    fail("AGENTMO_BUILDER_EVENT_INVALID");
  }
  const data = input.data;
  if (["SessionStart", "PreCompact", "PostCompact"].includes(input.type)) {
    if (!hasKeySet(data, [])) fail("AGENTMO_BUILDER_EVENT_INVALID");
  } else if (input.type === "ManualPause") {
    if (!hasKeySet(data, ["reason"])) fail("AGENTMO_BUILDER_EVENT_INVALID");
  } else if (input.type === "ArtifactCreated") {
    if (!hasKeySet(data, ["artifactRef", "nextAction"])
      || !hasKeySet(data.artifactRef, ["subject", "path", "digest"])) {
      fail("AGENTMO_BUILDER_EVENT_INVALID");
    }
  } else if (input.type === "ApprovalRequired") {
    if (!hasKeySet(data, ["decision"])
      || !hasKeySet(data.decision, ["id", "kind", "summaryDigest"])) {
      fail("AGENTMO_BUILDER_EVENT_INVALID");
    }
  } else if (input.type === "ApprovalResolved") {
    if (!hasKeySet(data, ["decisionId", "summaryDigest", "outcome", "nextAction"])) {
      fail("AGENTMO_BUILDER_EVENT_INVALID");
    }
  } else if (input.type === "StageTransition") {
    if (!hasKeySet(data, ["toStage"])) fail("AGENTMO_BUILDER_EVENT_INVALID");
  }
}

function validateEventData(type, data) {
  if (["SessionStart", "PreCompact", "PostCompact"].includes(type)) {
    if (!hasExactKeys(data, [])) fail("AGENTMO_BUILDER_EVENT_INVALID");
  } else if (type === "ManualPause") {
    if (!hasExactKeys(data, ["reason"]) || data.reason !== "user-request") fail("AGENTMO_BUILDER_EVENT_INVALID");
  } else if (type === "ArtifactCreated") {
    if (!hasExactKeys(data, ["artifactRef", "nextAction"])) fail("AGENTMO_BUILDER_EVENT_INVALID");
    validateArtifactEventData(data);
  } else if (type === "ApprovalRequired") {
    if (!hasExactKeys(data, ["decision"]) || !hasExactKeys(data.decision, ["id", "kind", "summaryDigest"])) {
      fail("AGENTMO_BUILDER_EVENT_INVALID");
    }
    if (!ID_PATTERN.test(data.decision.id ?? "") || !["approval", "decision"].includes(data.decision.kind)) {
      fail("AGENTMO_BUILDER_EVENT_INVALID");
    }
    if (!DIGEST_PATTERN.test(data.decision.summaryDigest ?? "")) fail("AGENTMO_BUILDER_EVENT_INVALID");
  } else if (type === "ApprovalResolved") {
    if (!hasExactKeys(data, ["decisionId", "summaryDigest", "outcome", "nextAction"])
      || !ID_PATTERN.test(data.decisionId ?? "")
      || !DIGEST_PATTERN.test(data.summaryDigest ?? "")
      || !["approved", "rejected"].includes(data.outcome)
      || !["discover", "plan", "produce", "complete"].includes(data.nextAction)) {
      fail("AGENTMO_BUILDER_EVENT_INVALID");
    }
  } else if (type === "StageTransition") {
    if (!hasExactKeys(data, ["toStage"]) || !["plan", "produce"].includes(data.toStage)) {
      fail("AGENTMO_BUILDER_EVENT_INVALID");
    }
  }
}

function validateArtifactEventData(data) {
  const ref = data.artifactRef;
  if (!hasExactKeys(ref, ["subject", "path", "digest"])) fail("AGENTMO_BUILDER_EVENT_INVALID");
  if (!/^[a-z][a-z0-9-]{1,63}$/u.test(ref.subject ?? "") || !DIGEST_PATTERN.test(ref.digest ?? "")) {
    fail("AGENTMO_BUILDER_EVENT_INVALID");
  }
  if (!portableRelativePath(ref.path)) {
    fail("AGENTMO_BUILDER_EVENT_INVALID");
  }
  if (!["discover", "plan", "produce", "complete"].includes(data.nextAction)) fail("AGENTMO_BUILDER_EVENT_INVALID");
}

function authenticEvent(value) {
  if (EVENTS.has(value)) {
    return Object.freeze({ value, digest: canonicalEventDigest(value) });
  }
  if (value?.subject === "builder-event" && DIGEST_PATTERN.test(value.digest ?? "") && EVENTS.has(value.value)) {
    const digest = canonicalEventDigest(value.value);
    if (value.digest !== digest) fail("AGENTMO_BUILDER_EVENT_AUTHORITY_REJECTED");
    if (EVENT_ADMISSIONS.has(value)) return value;
    return Object.freeze({ value: value.value, digest: value.digest });
  }
  fail("AGENTMO_BUILDER_EVENT_AUTHORITY_REJECTED");
}

function mintEventAdmission(value, digest) {
  const admission = Object.freeze({ subject: "builder-event", digest, value });
  EVENT_ADMISSIONS.add(admission);
  return admission;
}

function canonicalEventDigest(event) {
  validateBuilderEvent(event);
  return digestRawBytes(Buffer.from(serializePersistableJson(event, {
    subject: "builder-event",
  }), "utf8"));
}

function portableRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 512 || value.includes("\\")) return false;
  if (value.startsWith("/") || value.startsWith("~") || /^[A-Za-z]:/u.test(value)) return false;
  const normalized = path.posix.normalize(value);
  return normalized === value && normalized !== "." && !normalized.startsWith("../") && !normalized.includes("/../");
}

async function readEventBytes(filePath, maxBytes, openInput) {
  if (typeof filePath !== "string" || !Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    fail("AGENTMO_BUILDER_EVENT_READ_FAILED");
  }
  let handle;
  try {
    const noFollow = constants.O_NOFOLLOW;
    handle = await openInput(filePath, constants.O_RDONLY | noFollow);
    const before = await handle.stat();
    if (!before.isFile() || before.size > maxBytes) fail("AGENTMO_BUILDER_EVENT_READ_FAILED");
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    const after = await handle.stat();
    if (
      offset !== before.size
      || after.size !== before.size
      || after.ino !== before.ino
      || after.dev !== before.dev
      || after.mtimeMs !== before.mtimeMs
    ) {
      fail("AGENTMO_BUILDER_EVENT_READ_FAILED");
    }
    return bytes;
  } catch (error) {
    if (error instanceof BuilderEventError) throw error;
    fail("AGENTMO_BUILDER_EVENT_READ_FAILED");
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

function announcementFor(event, checkpoint) {
  if (event.type === "SessionStart") return `AgentMo checkpoint detected at ${checkpoint.stage}.`;
  if (event.type === "PostCompact") return `AgentMo checkpoint remains resumable at ${checkpoint.stage}.`;
  if (event.type === "PreCompact") return "AgentMo verified checkpoint flushed before compaction.";
  if (event.type === "ManualPause") return `AgentMo paused at ${checkpoint.stage}.`;
  return null;
}

function proposalFor(event, checkpoint) {
  if (!["SessionStart", "PostCompact", "ManualPause"].includes(event.type)) return null;
  return Object.freeze({
    kind: "resume",
    stage: checkpoint.nextAction === "await-approval" ? checkpoint.stage : checkpoint.nextAction,
    requiresApproval: true,
    automaticStageAdvance: false,
  });
}

function hasExactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key, index) => actual[index] === key);
}

function hasKeySet(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function fail(code) {
  throw new BuilderEventError(code);
}
