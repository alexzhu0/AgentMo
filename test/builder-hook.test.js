import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cp,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { digestRawBytes } from "../src/artifact-admission.js";
import { appendAppendOnlyRecord } from "../src/builder-append-only-authority.js";
import {
  buildBuilderCheckpoint,
  loadBuilderCheckpoint,
  writeBuilderCheckpoint,
} from "../src/builder-checkpoint.js";
import { buildBuilderEvent, reduceBuilderEvent, reduceBuilderHookEvent } from "../src/builder-events.js";
import { serializePersistableJson } from "../src/persistability.js";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;

function checkpoint() {
  return buildBuilderCheckpoint({
    workflowId: "workflow-1",
    adapterId: "codex",
    stage: "discover",
    boundary: "artifact-created",
    artifactRefs: [{ subject: "discovery-db", path: ".agentmo/discovery.json", digest: DIGEST_A }],
    pendingDecision: null,
    nextAction: "plan",
    installReceiptDigest: null,
    capabilitySnapshot: {
      adapterId: "codex",
      evidenceLevel: "observed",
      digest: DIGEST_B,
      required: [{ id: "codex-cli", status: "observed" }],
    },
    eventLedger: { cursor: 0, recentEvents: [] },
    pauseReason: null,
  });
}

function event(type, sequence, eventId, origin = "hook", data = {}) {
  return buildBuilderEvent({
    workflowId: "workflow-1",
    adapterId: "codex",
    eventId,
    sequence,
    origin,
    type,
    data,
  });
}

describe("builder hook event reducer", () => {
  it("applies SessionStart, PreCompact, and PostCompact without auto-approval or stage advance", () => {
    const started = reduceBuilderEvent(checkpoint(), event("SessionStart", 1, "event-1"));
    assert.equal(started.applied, true);
    assert.equal(started.checkpoint.stage, "discover");
    assert.equal(started.proposal.kind, "resume");
    assert.equal(started.proposal.requiresApproval, true);
    assert.equal(started.proposal.automaticStageAdvance, false);

    const beforeCompact = reduceBuilderEvent(started.checkpoint, event("PreCompact", 2, "event-2"));
    assert.equal(beforeCompact.checkpoint.boundary, "pre-compact");
    assert.equal(beforeCompact.checkpoint.pauseReason, "context-compaction");
    assert.equal(beforeCompact.proposal, null);

    const afterCompact = reduceBuilderEvent(beforeCompact.checkpoint, event("PostCompact", 3, "event-3"));
    assert.equal(afterCompact.checkpoint.boundary, "post-compact");
    assert.equal(afterCompact.proposal.requiresApproval, true);
    assert.equal(afterCompact.checkpoint.stage, "discover");
  });

  it("makes duplicate delivery a durable no-op after reload", async () => {
    const firstEvent = event("SessionStart", 1, "event-1");
    const first = reduceBuilderEvent(checkpoint(), firstEvent);
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-hook-restart-"));
    const file = path.join(root, "checkpoint.json");
    const written = await writeBuilderCheckpoint(file, first.checkpoint);
    const reloaded = await loadBuilderCheckpoint(file, { expectedDigest: written.digest });
    const duplicate = reduceBuilderEvent(reloaded.value, firstEvent);
    assert.equal(duplicate.status, "duplicate");
    assert.equal(duplicate.applied, false);
    assert.equal(duplicate.checkpoint, reloaded.value);
    assert.equal(duplicate.proposal, null);
  });

  it("does not retry a hook event after a committed checkpoint reload", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-hook-committed-reload-"));
    const file = path.join(root, "checkpoint.json");
    const initial = await writeBuilderCheckpoint(file, checkpoint());
    const delivered = event("SessionStart", 1, "event-committed-recovery");
    const reduced = reduceBuilderEvent(initial.value, delivered);
    const written = await writeBuilderCheckpoint(file, reduced.checkpoint, {
      expectedPreviousAdmission: initial,
    });
    assert.equal(written.appendStatus, "committed-clean");
    assert.equal(written.recoveryRequired, false);

    const restarted = await loadBuilderCheckpoint(file, { expectedDigest: written.digest });
    const replay = reduceBuilderEvent(restarted.value, delivered);
    assert.equal(replay.status, "duplicate");
    assert.equal(replay.applied, false);
    assert.equal(replay.checkpoint, restarted.value);
    const publications = (await readdir(root)).filter((name) => name.includes("agentmo-journal.000000000001-"));
    assert.equal(publications.length, 1);
  });

  it("rejects cursor gaps, cross-workflow events, and hook attempts to transition stages", () => {
    assert.throws(
      () => reduceBuilderEvent(checkpoint(), event("SessionStart", 2, "event-gap")),
      (error) => error?.code === "AGENTMO_BUILDER_EVENT_CURSOR_REJECTED",
    );
    assert.throws(() => reduceBuilderEvent(checkpoint(), buildBuilderEvent({
      workflowId: "other-workflow",
      adapterId: "codex",
      eventId: "event-other",
      sequence: 1,
      origin: "hook",
      type: "SessionStart",
      data: {},
    })), (error) => error?.code === "AGENTMO_BUILDER_EVENT_SCOPE_REJECTED");
    assert.throws(() => event("StageTransition", 1, "event-transition", "hook", { toStage: "plan" }),
      (error) => error?.code === "AGENTMO_BUILDER_EVENT_ORIGIN_REJECTED");
  });

  it("handles manual pause as proposal-only durable state", () => {
    const paused = reduceBuilderEvent(
      checkpoint(),
      event("ManualPause", 1, "pause-1", "user", { reason: "user-request" }),
    );
    assert.equal(paused.checkpoint.boundary, "manual-pause");
    assert.equal(paused.checkpoint.pauseReason, "user-request");
    assert.equal(paused.proposal.kind, "resume");
    assert.equal(paused.proposal.requiresApproval, true);
  });

  it("binds duplicate IDs to sequence and exact event bytes", () => {
    const first = reduceBuilderEvent(checkpoint(), event("SessionStart", 1, "event-collision"));
    assert.throws(
      () => reduceBuilderEvent(first.checkpoint, event("PreCompact", 2, "event-collision")),
      (error) => error?.code === "AGENTMO_BUILDER_EVENT_CONFLICT_REJECTED",
    );
  });

  it("rejects a forged wrapper digest before ledger mutation and keeps canonical replay a no-op", () => {
    const initial = checkpoint();
    const canonicalEvent = event("SessionStart", 1, "event-forged-wrapper");
    const canonicalBytes = Buffer.from(serializePersistableJson(canonicalEvent, {
      subject: "builder-event",
    }), "utf8");
    const canonicalDigest = digestRawBytes(canonicalBytes);
    assert.notEqual(canonicalDigest, DIGEST_A);

    const forged = Object.freeze({
      subject: "builder-event",
      digest: DIGEST_A,
      value: canonicalEvent,
    });
    assert.throws(
      () => reduceBuilderEvent(initial, forged),
      (error) => error?.code === "AGENTMO_BUILDER_EVENT_AUTHORITY_REJECTED",
    );
    assert.deepEqual(initial.eventLedger, { cursor: 0, recentEvents: [] });

    const admitted = reduceBuilderEvent(initial, Object.freeze({
      subject: "builder-event",
      digest: canonicalDigest,
      value: canonicalEvent,
    }));
    assert.deepEqual(admitted.checkpoint.eventLedger.recentEvents, [{
      eventId: "event-forged-wrapper",
      sequence: 1,
      digest: canonicalDigest,
    }]);
    const replay = reduceBuilderEvent(admitted.checkpoint, canonicalEvent);
    assert.equal(replay.status, "duplicate");
    assert.equal(replay.applied, false);
    assert.equal(replay.checkpoint, admitted.checkpoint);
  });

  it("resolves approval explicitly before a core stage transition", () => {
    const required = reduceBuilderEvent(checkpoint(), buildBuilderEvent({
      workflowId: "workflow-1",
      adapterId: "codex",
      eventId: "approval-required-1",
      sequence: 1,
      origin: "core",
      type: "ApprovalRequired",
      data: {
        decision: { id: "decision-1", kind: "approval", summaryDigest: DIGEST_A },
      },
    }));
    assert.equal(required.checkpoint.nextAction, "await-approval");
    const resolved = reduceBuilderEvent(required.checkpoint, buildBuilderEvent({
      workflowId: "workflow-1",
      adapterId: "codex",
      eventId: "approval-resolved-1",
      sequence: 2,
      origin: "core",
      type: "ApprovalResolved",
      data: {
        decisionId: "decision-1",
        summaryDigest: DIGEST_A,
        outcome: "approved",
        nextAction: "plan",
      },
    }));
    assert.equal(resolved.checkpoint.pendingDecision, null);
    assert.equal(resolved.checkpoint.boundary, "approval-resolved");
    const transitioned = reduceBuilderEvent(resolved.checkpoint, buildBuilderEvent({
      workflowId: "workflow-1",
      adapterId: "codex",
      eventId: "transition-1",
      sequence: 3,
      origin: "core",
      type: "StageTransition",
      data: { toStage: "plan" },
    }));
    assert.equal(transitioned.checkpoint.stage, "plan");
    assert.equal(transitioned.checkpoint.nextAction, "plan");
  });

  it("keeps rejected approval in-stage and rejects wrong resolution evidence", () => {
    const required = reduceBuilderEvent(checkpoint(), buildBuilderEvent({
      workflowId: "workflow-1",
      adapterId: "codex",
      eventId: "approval-required-reject",
      sequence: 1,
      origin: "core",
      type: "ApprovalRequired",
      data: {
        decision: { id: "decision-reject", kind: "approval", summaryDigest: DIGEST_A },
      },
    }));
    assert.throws(() => reduceBuilderEvent(required.checkpoint, buildBuilderEvent({
      workflowId: "workflow-1",
      adapterId: "codex",
      eventId: "approval-wrong-evidence",
      sequence: 2,
      origin: "core",
      type: "ApprovalResolved",
      data: {
        decisionId: "decision-reject",
        summaryDigest: DIGEST_B,
        outcome: "approved",
        nextAction: "plan",
      },
    })), (error) => error?.code === "AGENTMO_BUILDER_EVENT_TRANSITION_REJECTED");
    const rejected = reduceBuilderEvent(required.checkpoint, buildBuilderEvent({
      workflowId: "workflow-1",
      adapterId: "codex",
      eventId: "approval-rejected",
      sequence: 2,
      origin: "core",
      type: "ApprovalResolved",
      data: {
        decisionId: "decision-reject",
        summaryDigest: DIGEST_A,
        outcome: "rejected",
        nextAction: "discover",
      },
    }));
    assert.equal(rejected.checkpoint.stage, "discover");
    assert.equal(rejected.checkpoint.nextAction, "discover");
  });

  it("rejects core-labelled events on the hook route", () => {
    const coreTransition = buildBuilderEvent({
      workflowId: "workflow-1",
      adapterId: "codex",
      eventId: "core-transition-1",
      sequence: 1,
      origin: "core",
      type: "StageTransition",
      data: { toStage: "plan" },
    });
    assert.throws(
      () => reduceBuilderHookEvent(checkpoint(), coreTransition),
      (error) => error?.code === "AGENTMO_BUILDER_EVENT_ORIGIN_REJECTED",
    );
  });

  it("never reapplies an event after it ages out of the bounded ledger", () => {
    let current = checkpoint();
    const first = event("SessionStart", 1, "aged-event-1");
    current = reduceBuilderEvent(current, first).checkpoint;
    for (let sequence = 2; sequence <= 65; sequence += 1) {
      const type = sequence % 2 === 0 ? "PreCompact" : "PostCompact";
      current = reduceBuilderEvent(current, event(type, sequence, `aged-event-${sequence}`)).checkpoint;
    }
    assert.equal(current.eventLedger.recentEvents.length, 64);
    assert.equal(current.eventLedger.recentEvents.some((item) => item.eventId === "aged-event-1"), false);
    const stale = reduceBuilderEvent(current, first);
    assert.equal(stale.status, "stale");
    assert.equal(stale.applied, false);
    assert.equal(stale.checkpoint, current);
  });

  it("rejects a relinked bootstrap authority root through its retained lineage", async () => {
    const projectRoot = await realpath(
      await mkdtemp(path.join(tmpdir(), "agentmo-hook-authority-relink-")),
    );
    const relativeRoot = ".bootstrap-authority";
    await appendAppendOnlyRecord({
      projectRoot,
      relativeRoot,
      namespace: "builder-install",
      idempotencyKey: "bootstrap-authority-seed",
      payload: { kind: "bootstrap-authority-seed" },
    });

    const source = await readFile(
      new URL("../plugin/hooks/agentmo-hook.js", import.meta.url),
      "utf8",
    );
    const readerInstrumented = source.replace(
      "  const bytes = await readBoundedFile(parentAuthority.path, filePath, maxBytes);\n",
      [
        "  await globalThis.__agentmoHookAuthoritySwap?.(filePath);",
        "  const bytes = await readBoundedFile(parentAuthority.path, filePath, maxBytes);",
        "",
      ].join("\n"),
    );
    assert.notEqual(readerInstrumented, source);
    const instrumented = readerInstrumented.replace(
      /main\(\)\.catch\(\(\) => \{\n  process\.exitCode = 1;\n\}\);\n$/u,
      "export { readCommittedAuthority };\n",
    );
    assert.notEqual(instrumented, readerInstrumented);
    const moduleRoot = await mkdtemp(path.join(tmpdir(), "agentmo-hook-reader-module-"));
    const modulePath = path.join(moduleRoot, "hook-reader.mjs");
    await writeFile(modulePath, instrumented, { flag: "wx", mode: 0o600 });
    const { readCommittedAuthority } = await import(pathToFileURL(modulePath).href);
    const admitted = await readCommittedAuthority(
      projectRoot,
      relativeRoot,
      "builder-install",
      false,
    );
    assert.equal(admitted.records.length, 1);

    const authorityRoot = path.join(projectRoot, relativeRoot);
    const retainedRoot = path.join(projectRoot, ".retained-bootstrap-authority");
    const replacementRoot = path.join(projectRoot, ".replacement-bootstrap-authority");
    await cp(authorityRoot, replacementRoot, {
      recursive: true,
      preserveTimestamps: true,
    });
    let swapped = false;
    globalThis.__agentmoHookAuthoritySwap = async () => {
      if (swapped) return;
      swapped = true;
      await rename(authorityRoot, retainedRoot);
      await rename(replacementRoot, authorityRoot);
    };
    try {
      await assert.rejects(
        readCommittedAuthority(projectRoot, relativeRoot, "builder-install", false),
        /Installed hook delivery rejected/u,
      );
    } finally {
      delete globalThis.__agentmoHookAuthoritySwap;
    }
    assert.equal(swapped, true);
  });
});
