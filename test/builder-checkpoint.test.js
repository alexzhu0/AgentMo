import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { describe, it } from "node:test";
import {
  access,
  chmod,
  link,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { digestRawBytes } from "../src/artifact-admission.js";
import { buildBuilderEntry } from "../src/builder-entry.js";
import {
  admitBuilderCheckpointLifecycleAuthority,
  assertBuilderCheckpointAdmission,
  assertAuthenticBuilderCheckpoint,
  abortBuilderCheckpointUpgrade,
  buildBuilderCheckpoint,
  checkpointSummaryAdmission,
  fenceBuilderCheckpointDeactivation,
  finalizeBuilderHookCheckpoint,
  loadBuilderCheckpoint,
  prepareBuilderHookCheckpoint,
  releaseBuilderCheckpointDeactivationFence,
  reserveBuilderCheckpointUpgrade,
  upgradeBuilderCheckpointProtocol,
  writeBuilderCheckpoint,
} from "../src/builder-checkpoint.js";
import {
  appendImmutableJournalEntry,
  loadImmutableJournal,
} from "../src/builder-immutable-journal.js";
import {
  appendAppendOnlyRecord,
  readAppendOnlyAuthority,
} from "../src/builder-append-only-authority.js";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const BUILDER_LIFECYCLE_AUTHORITY_PATH = ".agentmo/builder/lifecycle-authority";
const BUILDER_LIFECYCLE_NAMESPACE = "builder-lifecycle";

function immutableEntryBytes(sequence, predecessorDigest, value) {
  const valueBytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  const entry = {
    schemaVersion: "agentmo.immutable-journal-entry.v1",
    sequence,
    predecessorDigest,
    valueDigest: digestRawBytes(valueBytes),
    valueBase64: valueBytes.toString("base64"),
  };
  return Buffer.from(`${JSON.stringify(entry)}\n`, "utf8");
}

function immutableEntryName(file, sequence, entryBytes) {
  return `.${path.basename(file)}.agentmo-journal.${String(sequence).padStart(12, "0")}-${digestRawBytes(entryBytes).slice(7)}.json`;
}

async function journalSnapshot(file) {
  const journal = await loadImmutableJournal({ journalPath: file });
  return {
    headDigest: journal.head?.digest ?? null,
    entryDigests: journal.entries.map((entry) => entry.digest),
    names: (await readdir(path.dirname(file))).toSorted(),
  };
}

async function readLifecycleAuthority(projectRoot) {
  return readAppendOnlyAuthority({
    projectRoot,
    relativeRoot: BUILDER_LIFECYCLE_AUTHORITY_PATH,
    namespace: BUILDER_LIFECYCLE_NAMESPACE,
  });
}

async function admitLifecycleAuthority(projectRoot, checkpointAdmission, expectedHeadDigest) {
  return admitBuilderCheckpointLifecycleAuthority({
    checkpointAdmission,
    projectRoot,
    expectedHeadDigest,
  });
}

function forgedLifecycleUpgradePayload({ operationId, successorReceiptDigest }) {
  return {
    schemaVersion: "agentmo.builder-lifecycle-event.v3",
    action: "activate",
    status: "active",
    invokedAs: "upgrade",
    scopeDigest: DIGEST_A,
    predecessorReceiptDigest: DIGEST_A,
    receipt: {
      path: ".agentmo/builder/releases/successor.json",
      digest: successorReceiptDigest,
    },
    files: [],
    physicalDeletion: false,
    hostMutation: false,
    coordination: {
      kind: "checkpoint-upgrade-reservation",
      operationId,
    },
    evidence: {
      level: "declared-ready",
      mechanismOnly: true,
      hostBehaviorVerified: false,
      domainQualityCertified: false,
    },
  };
}

function runProtocolChild(role, file, digest, gate, ready) {
  const moduleUrl = new URL("../src/builder-checkpoint.js", import.meta.url).href;
  const source = `
const fs = await import("node:fs/promises");
const checkpoint = await import(${JSON.stringify(moduleUrl)});
const [role, file, digest, gate, ready] = process.argv.slice(1);
const admission = await checkpoint.loadBuilderCheckpoint(file, { expectedDigest: digest });
await fs.writeFile(ready, "ready\\n", { flag: "wx", mode: 0o600 });
while (true) {
  try { await fs.access(gate); break; } catch { await new Promise((resolve) => setTimeout(resolve, 5)); }
}
try {
  const value = role === "hook"
    ? await checkpoint.prepareBuilderHookCheckpoint(file, {
        checkpointAdmission: admission,
        checkpoint: admission.value,
        lifecycleHeadDigest: ${JSON.stringify(DIGEST_B)},
        receiptDigest: ${JSON.stringify(DIGEST_A)},
        delivery: {
          identity: ${JSON.stringify(DIGEST_B)},
          type: "SessionStart",
          epoch: 0,
          sequence: 1,
          eventDigest: ${JSON.stringify(DIGEST_A)},
          applied: false,
          status: "duplicate",
          observationRequired: true,
        },
      })
    : await checkpoint.fenceBuilderCheckpointDeactivation(file, {
        checkpointAdmission: admission,
        lifecycleHeadDigest: ${JSON.stringify(DIGEST_B)},
        receiptDigest: ${JSON.stringify(DIGEST_A)},
      });
  process.stdout.write(JSON.stringify({ status: "fulfilled", state: value.value.hookDeactivationProtocol.state }));
} catch (error) {
  process.stdout.write(JSON.stringify({ status: "rejected", code: error?.code ?? null }));
}
`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      "--input-type=module",
      "-e",
      source,
      role,
      file,
      digest,
      gate,
      ready,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(Buffer.concat(stderr).toString("utf8")));
        return;
      }
      resolve(JSON.parse(Buffer.concat(stdout).toString("utf8")));
    });
  });
}

async function waitForFiles(paths) {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    if ((await Promise.all(paths.map((file) => access(file).then(
      () => true,
      () => false,
    )))).every(Boolean)) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("child protocol race did not become ready");
}

function baseCheckpoint(overrides = {}) {
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
      required: [
        { id: "codex-cli", status: "observed" },
        { id: "native-hooks", status: "observed" },
      ],
    },
    eventLedger: { cursor: 0, recentEvents: [] },
    pauseReason: null,
    ...overrides,
  });
}

describe("builder checkpoint", () => {
  it("writes and reloads canonical exact-digest checkpoint bytes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-checkpoint-"));
    const file = path.join(root, "checkpoint.json");
    const checkpoint = baseCheckpoint();
    const written = await writeBuilderCheckpoint(file, checkpoint);
    const bytes = await readFile(file);
    assert.equal(written.digest, digestRawBytes(bytes));
    const admission = await loadBuilderCheckpoint(file, { expectedDigest: written.digest });
    assert.deepEqual(admission.value, checkpoint);
    assert.equal(Object.isFrozen(admission.value), true);
    assertBuilderCheckpointAdmission(written);
  });

  it("binds Builder resume to an authentic checkpoint-derived summary", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-checkpoint-entry-"));
    const file = path.join(root, "checkpoint.json");
    const written = await writeBuilderCheckpoint(file, baseCheckpoint());
    const admission = await loadBuilderCheckpoint(file, { expectedDigest: written.digest });
    const probe = {
      schemaVersion: "agentmo.builder-probe.v1",
      adapter: { id: "codex" },
      mutatesHost: "unknown",
      externalCommandMutation: "unknown",
      required: { ok: true },
      observations: [{ id: "codex-cli", requirement: "required", status: "observed" }],
      support: { evidenceLevel: "observed", claim: false },
    };
    const entry = buildBuilderEntry({ probe, checkpoint: checkpointSummaryAdmission(admission) });
    assert.equal(entry.mode, "resume");
    assert.equal(entry.stage, "plan");
    assert.equal(entry.approval.required, true);
  });

  it("rejects digest tampering and non-canonical checkpoint bytes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-checkpoint-hostile-"));
    const file = path.join(root, "checkpoint.json");
    const written = await writeBuilderCheckpoint(file, baseCheckpoint());
    await assert.rejects(
      loadBuilderCheckpoint(file, { expectedDigest: DIGEST_A }),
      (error) => error?.code === "AGENTMO_BUILDER_CHECKPOINT_DIGEST_MISMATCH",
    );
    const value = JSON.parse(await readFile(file, "utf8"));
    await writeFile(file, JSON.stringify(value), "utf8");
    const bytes = await readFile(file);
    await assert.rejects(
      loadBuilderCheckpoint(file, { expectedDigest: digestRawBytes(bytes) }),
      (error) => error?.code === "AGENTMO_BUILDER_CHECKPOINT_CONFLICT_REJECTED",
    );
    assert.notEqual(written.digest, digestRawBytes(bytes));
  });

  it("rejects secrets, raw transcripts, host paths, and illegal transitions before writing", async () => {
    assert.throws(() => baseCheckpoint({
      artifactRefs: [{ subject: "discovery-db", path: "/private/tmp/raw.json", digest: DIGEST_A }],
    }), (error) => error?.code === "AGENTMO_BUILDER_CHECKPOINT_INVALID");
    assert.throws(() => buildBuilderCheckpoint({
      ...JSON.parse(JSON.stringify(baseCheckpoint())),
      rawTranscript: "private",
    }), (error) => error?.code === "AGENTMO_BUILDER_CHECKPOINT_INVALID");
    assert.throws(() => baseCheckpoint({
      nextAction: "produce",
    }), (error) => error?.code === "AGENTMO_BUILDER_CHECKPOINT_TRANSITION_REJECTED");
    assert.throws(() => baseCheckpoint({
      pendingDecision: { id: "approval-1", kind: "approval", summaryDigest: DIGEST_A },
      nextAction: "plan",
    }), (error) => error?.code === "AGENTMO_BUILDER_CHECKPOINT_TRANSITION_REJECTED");
  });

  it("uses digest CAS so concurrent writers cannot lose an event", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-checkpoint-cas-"));
    const file = path.join(root, "checkpoint.json");
    const initial = await writeBuilderCheckpoint(file, baseCheckpoint());
    const candidates = [
      baseCheckpoint({ boundary: "manual-pause", pauseReason: "user-request" }),
      baseCheckpoint({ boundary: "session-restart", pauseReason: "session-restart" }),
    ];
    const settled = await Promise.allSettled(candidates.map((candidate) =>
      writeBuilderCheckpoint(file, candidate, { expectedPreviousDigest: initial.digest })));
    assert.equal(settled.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(settled.filter((item) => item.status === "rejected").length, 1);
    const rejected = settled.find((item) => item.status === "rejected");
    assert.equal(rejected.reason?.code, "AGENTMO_BUILDER_CHECKPOINT_CONFLICT_REJECTED");
    const winner = settled.find((item) => item.status === "fulfilled");
    const loaded = await loadBuilderCheckpoint(file, { expectedDigest: winner.value.digest });
    assert.equal(["manual-pause", "session-restart"].includes(loaded.value.boundary), true);
  });

  it("requires an explicit persisted v2-to-v4 protocol transition", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-checkpoint-v2-upgrade-"));
    const file = path.join(root, "checkpoint.json");
    const current = baseCheckpoint();
    const {
      hookDeactivationProtocol: _protocol,
      schemaVersion: _schemaVersion,
      ...legacyFields
    } = current;
    const legacy = {
      schemaVersion: "agentmo.builder-checkpoint.v2",
      ...legacyFields,
    };
    const legacyBytes = Buffer.from(`${JSON.stringify(legacy, null, 2)}\n`, "utf8");
    const published = await appendImmutableJournalEntry({
      journalPath: file,
      canonicalBytes: legacyBytes,
    });
    const admission = await loadBuilderCheckpoint(file, {
      expectedDigest: published.head.digest,
    });
    assert.equal(admission.value.schemaVersion, "agentmo.builder-checkpoint.v2");
    assert.throws(
      () => assertAuthenticBuilderCheckpoint(admission.value),
      (error) => error?.code === "AGENTMO_BUILDER_CHECKPOINT_AUTHORITY_REJECTED",
    );
    const upgraded = await upgradeBuilderCheckpointProtocol(file, admission);
    assert.equal(upgraded.value.schemaVersion, "agentmo.builder-checkpoint.v4");
    assert.equal(upgraded.value.hookDeactivationProtocol.state, "open");
    assert.equal(upgraded.predecessorDigest, admission.digest);
  });

  it("migrates persisted v3 checkpoints without changing their protocol meaning", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-checkpoint-v3-upgrade-"));
    const file = path.join(root, "checkpoint.json");
    const current = baseCheckpoint({ installReceiptDigest: DIGEST_A });
    const { upgradeReservation: _reservation, ...legacyProtocol } = current.hookDeactivationProtocol;
    const legacy = {
      ...current,
      schemaVersion: "agentmo.builder-checkpoint.v3",
      hookDeactivationProtocol: legacyProtocol,
    };
    const published = await appendImmutableJournalEntry({
      journalPath: file,
      canonicalBytes: Buffer.from(`${JSON.stringify(legacy, null, 2)}\n`, "utf8"),
    });
    const admission = await loadBuilderCheckpoint(file, {
      expectedDigest: published.head.digest,
    });
    assert.equal(admission.value.schemaVersion, "agentmo.builder-checkpoint.v3");
    const upgraded = await upgradeBuilderCheckpointProtocol(file, admission);
    assert.equal(upgraded.value.schemaVersion, "agentmo.builder-checkpoint.v4");
    assert.deepEqual(upgraded.value.hookDeactivationProtocol.upgradeReservation, null);
    assert.equal(upgraded.value.hookDeactivationProtocol.state, "open");
  });

  it("rejects direct lifecycle authorization append and leaves a reservation guarded", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-checkpoint-raw-lifecycle-"));
    const file = path.join(root, ".agentmo", "checkpoints", "builder.json");
    const lifecycleBefore = await readLifecycleAuthority(root);
    const initial = await writeBuilderCheckpoint(file, baseCheckpoint({
      installReceiptDigest: DIGEST_A,
    }));
    const reserved = await reserveBuilderCheckpointUpgrade(file, {
      checkpointAdmission: initial,
      lifecycleHeadDigest: lifecycleBefore.headDigest,
      receiptDigest: DIGEST_A,
      planDigest: DIGEST_B,
      successorReceiptDigest: DIGEST_B,
    });
    const protocol = reserved.value.hookDeactivationProtocol;
    await assert.rejects(
      appendAppendOnlyRecord({
        projectRoot: root,
        relativeRoot: BUILDER_LIFECYCLE_AUTHORITY_PATH,
        namespace: BUILDER_LIFECYCLE_NAMESPACE,
        idempotencyKey: `upgrade:${protocol.operationId.slice("sha256:".length)}`,
        expectedHeadDigest: lifecycleBefore.headDigest,
        payload: forgedLifecycleUpgradePayload({
          operationId: protocol.operationId,
          successorReceiptDigest: DIGEST_B,
        }),
      }),
      (error) => error?.code === "AGENTMO_APPEND_ONLY_AUTHORITY_REJECTED",
    );
    assert.deepEqual(await readLifecycleAuthority(root), lifecycleBefore);
    assert.equal(
      (await loadBuilderCheckpoint(file, { expectedDigest: reserved.digest }))
        .value.hookDeactivationProtocol.state,
      "upgrade-reserved",
    );
  });

  it("rejects direct immutable resolution without lifecycle authorization", async () => {
    for (const kind of ["upgrade", "deactivation"]) {
      const root = await mkdtemp(path.join(tmpdir(), `agentmo-checkpoint-raw-${kind}-`));
      const file = path.join(root, ".agentmo", "checkpoints", "builder.json");
      const lifecycle = await readLifecycleAuthority(root);
      const initial = await writeBuilderCheckpoint(file, baseCheckpoint({
        installReceiptDigest: DIGEST_A,
      }));
      const guarded = kind === "upgrade"
        ? await reserveBuilderCheckpointUpgrade(file, {
            checkpointAdmission: initial,
            lifecycleHeadDigest: lifecycle.headDigest,
            receiptDigest: DIGEST_A,
            planDigest: DIGEST_B,
            successorReceiptDigest: DIGEST_B,
          })
        : await fenceBuilderCheckpointDeactivation(file, {
            checkpointAdmission: initial,
            lifecycleHeadDigest: lifecycle.headDigest,
            receiptDigest: DIGEST_A,
          });
      const forgedOpen = buildBuilderCheckpoint({
        ...guarded.value,
        hookDeactivationProtocol: undefined,
      });
      const rawHead = (await loadImmutableJournal({ journalPath: file })).head;
      const forged = await appendImmutableJournalEntry({
        journalPath: file,
        expectedPredecessorAdmission: rawHead,
        canonicalBytes: Buffer.from(`${JSON.stringify(forgedOpen, null, 2)}\n`, "utf8"),
      });
      await assert.rejects(
        loadBuilderCheckpoint(file, { expectedDigest: forged.head.digest }),
        (error) => error?.code === "AGENTMO_BUILDER_CHECKPOINT_PROTOCOL_TRANSITION_REJECTED",
      );
    }
  });

  it("binds lifecycle authority admissions to one canonical checkpoint across projects", async () => {
    const abortRootA = await mkdtemp(path.join(tmpdir(), "agentmo-checkpoint-cross-abort-a-"));
    const abortRootB = await mkdtemp(path.join(tmpdir(), "agentmo-checkpoint-cross-abort-b-"));
    const abortFileA = path.join(abortRootA, "checkpoint.json");
    const abortFileB = path.join(abortRootB, "checkpoint.json");
    const abortLifecycleA = await readLifecycleAuthority(abortRootA);
    const abortLifecycleB = await readLifecycleAuthority(abortRootB);
    assert.equal(abortLifecycleA.headDigest, abortLifecycleB.headDigest);
    const abortInitialA = await writeBuilderCheckpoint(abortFileA, baseCheckpoint({
      installReceiptDigest: DIGEST_A,
    }));
    const abortInitialB = await writeBuilderCheckpoint(abortFileB, baseCheckpoint({
      installReceiptDigest: DIGEST_A,
    }));
    const abortReservedA = await reserveBuilderCheckpointUpgrade(abortFileA, {
      checkpointAdmission: abortInitialA,
      lifecycleHeadDigest: abortLifecycleA.headDigest,
      receiptDigest: DIGEST_A,
      planDigest: DIGEST_B,
      successorReceiptDigest: DIGEST_B,
    });
    const abortReservedB = await reserveBuilderCheckpointUpgrade(abortFileB, {
      checkpointAdmission: abortInitialB,
      lifecycleHeadDigest: abortLifecycleB.headDigest,
      receiptDigest: DIGEST_A,
      planDigest: DIGEST_B,
      successorReceiptDigest: DIGEST_B,
    });
    const abortAuthorityForB = await admitLifecycleAuthority(
      abortRootB,
      abortReservedB,
      abortLifecycleB.headDigest,
    );
    await assert.rejects(
      abortBuilderCheckpointUpgrade(abortFileA, {
        checkpointAdmission: abortReservedA,
        lifecycleAuthorityAdmission: abortAuthorityForB,
        planDigest: DIGEST_B,
        successorReceiptDigest: DIGEST_B,
      }),
      (error) => error?.code === "AGENTMO_BUILDER_CHECKPOINT_AUTHORITY_REJECTED",
    );
    assert.equal(
      (await loadBuilderCheckpoint(abortFileA, { expectedDigest: abortReservedA.digest }))
        .value.hookDeactivationProtocol.state,
      "upgrade-reserved",
    );

  });

  it("requires a current authenticated reactivation record before releasing a fence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-checkpoint-reactivation-release-"));
    const file = path.join(root, "checkpoint.json");
    const lifecycleBefore = await readLifecycleAuthority(root);
    const initial = await writeBuilderCheckpoint(file, baseCheckpoint({
      installReceiptDigest: DIGEST_A,
    }));
    const fenced = await fenceBuilderCheckpointDeactivation(file, {
      checkpointAdmission: initial,
      lifecycleHeadDigest: lifecycleBefore.headDigest,
      receiptDigest: DIGEST_A,
    });
    await assert.rejects(
      releaseBuilderCheckpointDeactivationFence(file, {
        checkpointAdmission: fenced,
        lifecycleHeadDigest: lifecycleBefore.headDigest,
        receiptDigest: DIGEST_A,
      }),
      (error) => error?.code === "AGENTMO_BUILDER_CHECKPOINT_PROTOCOL_TRANSITION_REJECTED",
    );
    const beforeReactivation = await admitLifecycleAuthority(
      root,
      fenced,
      lifecycleBefore.headDigest,
    );
    await assert.rejects(
      releaseBuilderCheckpointDeactivationFence(file, {
        checkpointAdmission: fenced,
        lifecycleAuthorityAdmission: beforeReactivation,
        receiptDigest: DIGEST_A,
      }),
      (error) => error?.code === "AGENTMO_BUILDER_CHECKPOINT_PROTOCOL_TRANSITION_REJECTED",
    );
  });

  it("linearizes hook preparation and upgrade reservation on one CAS authority", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-checkpoint-hook-upgrade-race-"));
    const file = path.join(root, "checkpoint.json");
    const initial = await writeBuilderCheckpoint(file, baseCheckpoint({
      installReceiptDigest: DIGEST_A,
    }));
    const delivery = {
      identity: DIGEST_B,
      type: "SessionStart",
      epoch: 0,
      sequence: 1,
      eventDigest: DIGEST_A,
      applied: false,
      status: "duplicate",
      observationRequired: true,
    };
    const settled = await Promise.allSettled([
      prepareBuilderHookCheckpoint(file, {
        checkpointAdmission: initial,
        checkpoint: initial.value,
        lifecycleHeadDigest: DIGEST_A,
        receiptDigest: DIGEST_A,
        delivery,
      }),
      reserveBuilderCheckpointUpgrade(file, {
        checkpointAdmission: initial,
        lifecycleHeadDigest: DIGEST_A,
        receiptDigest: DIGEST_A,
        planDigest: DIGEST_B,
        successorReceiptDigest: DIGEST_B,
      }),
    ]);
    assert.equal(settled.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(settled.filter((item) => item.status === "rejected").length, 1);
    assert.equal(
      settled.find((item) => item.status === "rejected").reason.code,
      "AGENTMO_BUILDER_CHECKPOINT_CONFLICT_REJECTED",
    );
    assert.equal(
      ["hook-prepared", "upgrade-reserved"].includes(
        settled.find((item) => item.status === "fulfilled").value
          .value.hookDeactivationProtocol.state,
      ),
      true,
    );
  });

  it("linearizes hook preparation and deactivation fencing on one CAS authority", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-checkpoint-hook-fence-"));
    const file = path.join(root, "checkpoint.json");
    const initial = await writeBuilderCheckpoint(file, baseCheckpoint({
      installReceiptDigest: DIGEST_A,
    }));
    const delivery = {
      identity: DIGEST_B,
      type: "SessionStart",
      epoch: 0,
      sequence: 1,
      eventDigest: DIGEST_A,
      applied: false,
      status: "duplicate",
      observationRequired: true,
    };
    const settled = await Promise.allSettled([
      prepareBuilderHookCheckpoint(file, {
        checkpointAdmission: initial,
        checkpoint: initial.value,
        lifecycleHeadDigest: DIGEST_B,
        receiptDigest: DIGEST_A,
        delivery,
      }),
      fenceBuilderCheckpointDeactivation(file, {
        checkpointAdmission: initial,
        lifecycleHeadDigest: DIGEST_B,
        receiptDigest: DIGEST_A,
      }),
    ]);
    assert.equal(settled.filter((item) => item.status === "fulfilled").length, 1);
    const winner = settled.find((item) => item.status === "fulfilled").value;
    const loser = settled.find((item) => item.status === "rejected").reason;
    if (winner.value.hookDeactivationProtocol.state === "hook-prepared") {
      assert.equal(loser.code, "AGENTMO_BUILDER_CHECKPOINT_CONFLICT_REJECTED");
      await assert.rejects(
        fenceBuilderCheckpointDeactivation(file, {
          checkpointAdmission: winner,
          lifecycleHeadDigest: DIGEST_B,
          receiptDigest: DIGEST_A,
        }),
        (error) => error?.code === "AGENTMO_BUILDER_CHECKPOINT_HOOK_PREPARED",
      );
      const finalized = await finalizeBuilderHookCheckpoint(file, winner, DIGEST_B);
      assert.equal(finalized.value.hookDeactivationProtocol.state, "hook-finalized");
      assert.equal(finalized.value.hookDeactivationProtocol.observationDigest, DIGEST_B);
    } else {
      assert.equal(winner.value.hookDeactivationProtocol.state, "deactivation-fenced");
      assert.equal(loser.code, "AGENTMO_BUILDER_CHECKPOINT_CONFLICT_REJECTED");
      await assert.rejects(
        writeBuilderCheckpoint(file, baseCheckpoint({
          installReceiptDigest: DIGEST_A,
          boundary: "session-restart",
          pauseReason: "session-restart",
        }), { expectedPreviousAdmission: winner }),
        (error) => error?.code === "AGENTMO_BUILDER_CHECKPOINT_DEACTIVATION_FENCED",
      );
    }
  });

  it("uses external child processes to prove the final-admission CAS has one winner", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-checkpoint-child-race-"));
    const file = path.join(root, "checkpoint.json");
    const initial = await writeBuilderCheckpoint(file, baseCheckpoint({
      installReceiptDigest: DIGEST_A,
    }));
    const gate = path.join(root, "start");
    const ready = [path.join(root, "hook-ready"), path.join(root, "fence-ready")];
    const children = [
      runProtocolChild("hook", file, initial.digest, gate, ready[0]),
      runProtocolChild("fence", file, initial.digest, gate, ready[1]),
    ];
    await waitForFiles(ready);
    await writeFile(gate, "start\n", { flag: "wx", mode: 0o600 });
    const results = await Promise.all(children);
    assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(results.filter((item) => item.status === "rejected").length, 1);
    assert.equal(
      results.find((item) => item.status === "rejected").code,
      "AGENTMO_BUILDER_CHECKPOINT_CONFLICT_REJECTED",
    );
    const head = await loadBuilderCheckpoint(
      file,
      { expectedDigest: (await loadImmutableJournal({ journalPath: file })).head.digest },
    );
    assert.equal(
      head.value.hookDeactivationProtocol.state,
      results.find((item) => item.status === "fulfilled").state,
    );
  });

  it("reloads one committed successor without mutable recovery state", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-checkpoint-committed-reload-"));
    const file = path.join(root, "checkpoint.json");
    const genesis = await writeBuilderCheckpoint(file, baseCheckpoint());
    const successor = await writeBuilderCheckpoint(
      file,
      baseCheckpoint({ boundary: "manual-pause", pauseReason: "user-request" }),
      { expectedPreviousAdmission: genesis },
    );

    assert.equal(successor.appendStatus, "committed-clean");
    assert.equal(successor.recoveryRequired, false);
    assert.equal(successor.sequence, 1);
    const restarted = await loadBuilderCheckpoint(file, { expectedDigest: successor.digest });
    assert.equal(restarted.digest, successor.digest);
    const journal = await loadImmutableJournal({ journalPath: file });
    assert.equal(journal.entries.length, 2);
    assert.equal(journal.head.digest, successor.digest);
    assert.equal(journal.recoveryRequired, false);

    const resumed = await writeBuilderCheckpoint(
      file,
      baseCheckpoint({ boundary: "session-restart", pauseReason: "session-restart" }),
      { expectedPreviousAdmission: restarted },
    );
    assert.equal(resumed.appendStatus, "committed-clean");
    assert.equal(resumed.sequence, 2);
    const afterRecovery = await loadImmutableJournal({ journalPath: file });
    assert.equal(afterRecovery.entries.length, 3);
    assert.equal(afterRecovery.head.digest, resumed.digest);
    assert.equal(afterRecovery.recoveryRequired, false);
  });

  it("rejects caller journal callbacks before checkpoint publication", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-checkpoint-callback-rejected-"));
    const file = path.join(root, "checkpoint.json");
    const genesis = await writeBuilderCheckpoint(file, baseCheckpoint());
    const before = await journalSnapshot(file);
    await assert.rejects(
      writeBuilderCheckpoint(
        file,
        baseCheckpoint({ boundary: "manual-pause", pauseReason: "user-request" }),
        {
          expectedPreviousAdmission: genesis,
          onJournalCheckpoint: async () => {},
        },
      ),
      (error) => error?.code === "AGENTMO_BUILDER_CHECKPOINT_AUTHORITY_REJECTED",
    );
    assert.deepEqual(await journalSnapshot(file), before);
  });

  it("retains immutable prepared, entry, and outcome evidence without cleanup", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-checkpoint-no-cleanup-"));
    const file = path.join(root, "checkpoint.json");
    const genesis = await writeBuilderCheckpoint(file, baseCheckpoint());
    const successor = await writeBuilderCheckpoint(
      file,
      baseCheckpoint({ boundary: "manual-pause", pauseReason: "user-request" }),
      { expectedPreviousAdmission: genesis },
    );
    const before = (await readdir(root)).toSorted();

    assert.equal(before.some((name) => name.includes("prepared-stage.")), true);
    assert.equal(before.some((name) => name.includes("entry-stage.")), true);
    assert.equal(before.some((name) => name.includes("outcome-stage.")), true);
    assert.equal(before.some((name) => name.includes(".prepared.000000000001.json")), true);
    assert.equal(before.some((name) => name.includes(".outcome.000000000001-")), true);
    assert.equal(before.some((name) => name.endsWith("agentmo-journal.lock")), false);
    assert.equal(before.some((name) => name.endsWith("agentmo-journal-retained")), false);

    const restarted = await loadBuilderCheckpoint(file, { expectedDigest: successor.digest });
    assert.equal(restarted.digest, successor.digest);
    assert.deepEqual((await readdir(root)).toSorted(), before);
  });

  it("rejects an attacker recovery lock after restart without changing its bytes or inode", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-checkpoint-attacker-recovery-"));
    const file = path.join(root, "checkpoint.json");
    await writeBuilderCheckpoint(file, baseCheckpoint());
    const lockPath = path.join(root, `.${path.basename(file)}.agentmo-journal.lock`);
    const attackerBytes = Buffer.from("attacker-controlled recovery record\n", "utf8");
    await writeFile(lockPath, attackerBytes, { mode: 0o600, flag: "wx" });
    const before = await stat(lockPath, { bigint: true });

    await assert.rejects(
      loadImmutableJournal({ journalPath: file }),
      (error) => error?.code === "AGENTMO_IMMUTABLE_JOURNAL_CONFLICT_REJECTED",
    );

    const after = await stat(lockPath, { bigint: true });
    assert.equal(after.dev, before.dev);
    assert.equal(after.ino, before.ino);
    assert.deepEqual(await readFile(lockPath), attackerBytes);
  });

  it("publishes one immutable predecessor chain and derives the same unique head after restart", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-checkpoint-chain-"));
    const file = path.join(root, "checkpoint.json");
    const genesis = await writeBuilderCheckpoint(file, baseCheckpoint());
    const genesisBytes = await readFile(file);
    const successor = await writeBuilderCheckpoint(
      file,
      baseCheckpoint({ boundary: "manual-pause", pauseReason: "user-request" }),
      { expectedPreviousAdmission: genesis },
    );

    assert.equal(successor.sequence, 1);
    assert.equal(successor.predecessorDigest, genesis.digest);
    assert.deepEqual(await readFile(file), genesisBytes, "the immutable genesis is not a mutable head pointer");
    const firstRestart = await loadBuilderCheckpoint(file, { expectedDigest: successor.digest });
    const secondRestart = await loadBuilderCheckpoint(file, { expectedDigest: successor.digest });
    assert.equal(firstRestart.digest, successor.digest);
    assert.deepEqual(firstRestart.value, secondRestart.value);
    assert.deepEqual(firstRestart.entryIdentity, successor.entryIdentity);
  });

  it("rejects forged checkpoint admissions before summary or successor publication", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-checkpoint-admission-"));
    const file = path.join(root, "checkpoint.json");
    const admission = await writeBuilderCheckpoint(file, baseCheckpoint());
    const forged = Object.freeze({ ...admission, digest: DIGEST_A });

    assert.throws(
      () => checkpointSummaryAdmission(forged),
      (error) => error?.code === "AGENTMO_BUILDER_CHECKPOINT_AUTHORITY_REJECTED",
    );
    await assert.rejects(
      writeBuilderCheckpoint(file, baseCheckpoint({ boundary: "manual-pause", pauseReason: "user-request" }), {
        expectedPreviousAdmission: forged,
      }),
      (error) => error?.code === "AGENTMO_BUILDER_CHECKPOINT_AUTHORITY_REJECTED",
    );
    const reloaded = await loadBuilderCheckpoint(file, { expectedDigest: admission.digest });
    assert.equal(reloaded.digest, admission.digest);
  });

  it("fails closed on hardlinks, forks, gaps, duplicate sequences, malformed publications, and unfinished files", async () => {
    const cases = ["hardlink", "fork", "gap", "duplicate", "malformed", "unfinished"];
    for (const scenario of cases) {
      const root = await mkdtemp(path.join(tmpdir(), `agentmo-checkpoint-${scenario}-`));
      const file = path.join(root, "checkpoint.json");
      const genesis = await writeBuilderCheckpoint(file, baseCheckpoint());
      const successorValue = baseCheckpoint({ boundary: "manual-pause", pauseReason: "user-request" });
      const successor = await writeBuilderCheckpoint(file, successorValue, {
        expectedPreviousAdmission: genesis,
      });
      const names = await readdir(root);
      const successorName = names.find((name) => name.includes(".agentmo-journal.000000000001-"));
      assert.ok(successorName);
      const successorPath = path.join(root, successorName);

      if (scenario === "hardlink") {
        await link(successorPath, path.join(root, "preserved-hardlink"));
      } else if (scenario === "fork") {
        const bytes = immutableEntryBytes(1, genesis.digest, { competitor: "fork" });
        await writeFile(path.join(root, immutableEntryName(file, 1, bytes)), bytes, { mode: 0o600, flag: "wx" });
      } else if (scenario === "gap") {
        const bytes = immutableEntryBytes(3, DIGEST_A, { competitor: "gap" });
        await writeFile(path.join(root, immutableEntryName(file, 3, bytes)), bytes, { mode: 0o600, flag: "wx" });
      } else if (scenario === "duplicate") {
        const bytes = immutableEntryBytes(1, successor.digest, { competitor: "duplicate-sequence" });
        await writeFile(path.join(root, immutableEntryName(file, 1, bytes)), bytes, { mode: 0o600, flag: "wx" });
      } else if (scenario === "malformed") {
        await writeFile(
          path.join(root, `.${path.basename(file)}.agentmo-journal.000000000002-${"c".repeat(64)}.json`),
          "{broken\n",
          { mode: 0o600, flag: "wx" },
        );
      } else {
        await writeFile(
          path.join(root, `.${path.basename(file)}.agentmo-journal.stage.${"d".repeat(64)}`),
          "unfinished\n",
          { mode: 0o600, flag: "wx" },
        );
      }

      await assert.rejects(
        loadImmutableJournal({ journalPath: file }),
        (error) => error?.code === "AGENTMO_IMMUTABLE_JOURNAL_CONFLICT_REJECTED",
      );
      await assert.rejects(
        loadBuilderCheckpoint(file, { expectedDigest: successor.digest }),
        (error) => error?.code === "AGENTMO_BUILDER_CHECKPOINT_CONFLICT_REJECTED",
      );
    }
  });

  it("rejects extra same-inode aliases for prepared, entry, and outcome evidence", async () => {
    for (const role of ["prepared", "entry", "outcome"]) {
      const root = await mkdtemp(path.join(tmpdir(), `agentmo-checkpoint-alias-${role}-`));
      const file = path.join(root, "checkpoint.json");
      const genesis = await writeBuilderCheckpoint(file, baseCheckpoint());
      await writeBuilderCheckpoint(
        file,
        baseCheckpoint({ boundary: "manual-pause", pauseReason: "user-request" }),
        { expectedPreviousAdmission: genesis },
      );
      const names = await readdir(root);
      const targetName = role === "prepared"
        ? names.find((name) => name.includes(".prepared.000000000001.json"))
        : role === "entry"
          ? names.find((name) => name.includes(".agentmo-journal.000000000001-"))
          : names.find((name) => name.includes(".outcome.000000000001-"));
      assert.ok(targetName, role);
      const targetPath = path.join(root, targetName);
      const aliasPath = path.join(root, `foreign-copy-${role}`);
      const beforeBytes = await readFile(targetPath);
      const before = await stat(targetPath, { bigint: true });
      await link(targetPath, aliasPath);

      await assert.rejects(
        loadImmutableJournal({ journalPath: file }),
        (error) => error?.code === "AGENTMO_IMMUTABLE_JOURNAL_CONFLICT_REJECTED",
        role,
      );
      const targetAfter = await stat(targetPath, { bigint: true });
      const aliasAfter = await stat(aliasPath, { bigint: true });
      assert.equal(targetAfter.dev, before.dev, role);
      assert.equal(targetAfter.ino, before.ino, role);
      assert.equal(aliasAfter.dev, before.dev, role);
      assert.equal(aliasAfter.ino, before.ino, role);
      assert.deepEqual(await readFile(targetPath), beforeBytes, role);
      assert.deepEqual(await readFile(aliasPath), beforeBytes, role);
    }
  });

  it("rejects unsafe immutable entry mode without removing the published bytes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-checkpoint-mode-"));
    const file = path.join(root, "checkpoint.json");
    const genesis = await writeBuilderCheckpoint(file, baseCheckpoint());
    await chmod(file, 0o666);
    const preserved = await readFile(file);
    await assert.rejects(
      loadBuilderCheckpoint(file, { expectedDigest: genesis.digest }),
      (error) => error?.code === "AGENTMO_BUILDER_CHECKPOINT_CONFLICT_REJECTED",
    );
    assert.deepEqual(await readFile(file), preserved);
  });

  it("treats a schema-invalid successor payload as a bounded published conflict", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-checkpoint-invalid-successor-"));
    const file = path.join(root, "checkpoint.json");
    const genesis = await writeBuilderCheckpoint(file, baseCheckpoint());
    const loaded = await loadImmutableJournal({ journalPath: file });
    const invalidBytes = Buffer.from("{}\n", "utf8");
    const invalid = await appendImmutableJournalEntry({
      journalPath: file,
      canonicalBytes: invalidBytes,
      expectedPredecessorAdmission: loaded.head,
    });
    assert.equal(invalid.status, "committed-clean");
    assert.equal(invalid.head.predecessorDigest, genesis.digest);
    await assert.rejects(
      loadBuilderCheckpoint(file, { expectedDigest: invalid.head.digest }),
      (error) => error?.code === "AGENTMO_BUILDER_CHECKPOINT_CONFLICT_REJECTED",
    );
    assert.equal((await readdir(root)).some((name) => name.includes(invalid.head.publicationDigest.slice(7))), true);
  });

  it("bounds capability snapshots so every writable checkpoint is loadable", () => {
    const required = Array.from({ length: 65 }, (_, index) => ({
      id: `capability-${String(index).padStart(2, "0")}`,
      status: "observed",
    }));
    assert.throws(() => baseCheckpoint({
      capabilitySnapshot: {
        adapterId: "codex",
        evidenceLevel: "observed",
        digest: DIGEST_B,
        required,
      },
    }), (error) => error?.code === "AGENTMO_BUILDER_CHECKPOINT_INVALID");
  });
});
