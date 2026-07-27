import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { digestRawBytes } from "../src/artifact-admission.js";
import { admitBuilderCheckpointSummary, buildBuilderEntry } from "../src/builder-entry.js";
import { probeBuilderAdapter } from "../src/builder-probe.js";

async function compatibleProbe() {
  const output = {
    "--version": "codex-cli 0.144.2\n",
    "features list": "plugins stable true\nhooks stable true\n",
    "plugin --help": "Usage: codex plugin\n",
    "resume --help": "Usage: codex resume\n",
    "doctor --help": "Usage: codex doctor\n",
  };
  return probeBuilderAdapter({
    execute: async (_command, args) => ({ ok: true, stdout: output[args.join(" ")] }),
  });
}

describe("builder lifecycle entry", () => {
  it("starts Discover through one proposal-only lifecycle contract", async () => {
    const entry = buildBuilderEntry({ probe: await compatibleProbe() });
    assert.equal(entry.mode, "start");
    assert.equal(entry.stage, "discover");
    assert.equal(entry.proposalOnly, true);
    assert.equal(entry.approval.required, true);
    assert.deepEqual(entry.lifecycle.stages, ["discover", "plan", "produce"]);
    assert.equal(entry.lifecycle.directEntriesShareContract, true);
    assert.equal(entry.capabilitySnapshot.supportClaim, false);
    assert.equal(entry.capabilitySnapshot.mutatesHost, "unknown");
    assert.equal(entry.capabilitySnapshot.externalCommandMutation, "unknown");
  });

  it("uses the same contract for a direct Discover entry", async () => {
    const entry = buildBuilderEntry({ probe: await compatibleProbe(), requestedStage: "discover" });
    assert.equal(entry.mode, "direct");
    assert.equal(entry.stage, "discover");
    assert.equal(entry.lifecycle.invariant, "Discover -> Plan -> Produce");
  });

  it("proposes resume only from an admitted exact-digest checkpoint summary", async () => {
    const checkpointValue = {
      schemaVersion: "agentmo.builder-checkpoint-summary.v1",
      adapterId: "codex",
      workflowId: "workflow-1",
      checkpointDigest: `sha256:${"b".repeat(64)}`,
      stage: "discover",
      nextAction: "plan",
    };
    const checkpointBytes = Buffer.from(`${JSON.stringify(checkpointValue, null, 2)}\n`);
    const checkpoint = admitBuilderCheckpointSummary(checkpointBytes, digestRawBytes(checkpointBytes));
    const entry = buildBuilderEntry({ probe: await compatibleProbe(), checkpoint });
    assert.equal(entry.mode, "resume");
    assert.equal(entry.stage, "plan");
    assert.deepEqual(entry.checkpoint, {
      present: true,
      workflowId: "workflow-1",
      digest: `sha256:${"b".repeat(64)}`,
      summaryDigest: digestRawBytes(checkpointBytes),
      stage: "discover",
    });
    assert.equal(entry.approval.required, true);
  });

  it("rejects stage skipping, tampered checkpoint summaries, and missing required capability", async () => {
    const probe = await compatibleProbe();
    assert.throws(() => buildBuilderEntry({ probe, requestedStage: "plan" }), {
      code: "AGENTMO_BUILDER_ENTRY_REJECTED",
    });
    assert.throws(() => buildBuilderEntry({
      probe,
      checkpoint: Object.freeze({
        subject: "builder-checkpoint-summary",
        digest: `sha256:${"a".repeat(64)}`,
        value: {
          schemaVersion: "agentmo.builder-checkpoint-summary.v1",
          adapterId: "codex",
          workflowId: "workflow-1",
          checkpointDigest: `sha256:${"b".repeat(64)}`,
          stage: "discover",
          nextAction: "plan",
        },
      }),
    }), { code: "AGENTMO_BUILDER_ENTRY_REJECTED" });
    const nonCanonical = Buffer.from(JSON.stringify({
      schemaVersion: "agentmo.builder-checkpoint-summary.v1",
      adapterId: "codex",
      workflowId: "workflow-1",
      checkpointDigest: `sha256:${"b".repeat(64)}`,
      stage: "discover",
      nextAction: "plan",
    }));
    assert.throws(
      () => admitBuilderCheckpointSummary(nonCanonical, digestRawBytes(nonCanonical)),
      { code: "AGENTMO_BUILDER_ENTRY_REJECTED" },
    );
    assert.throws(() => buildBuilderEntry({
      probe: { ...probe, required: { ...probe.required, ok: false } },
    }), { code: "AGENTMO_BUILDER_ENTRY_REJECTED" });
    assert.throws(() => buildBuilderEntry({
      probe: { ...probe, mutatesHost: false },
    }), { code: "AGENTMO_BUILDER_ENTRY_REJECTED" });
  });

  it("resumes an approval boundary at its current lifecycle stage", async () => {
    const value = {
      schemaVersion: "agentmo.builder-checkpoint-summary.v1",
      adapterId: "codex",
      workflowId: "workflow-approval",
      checkpointDigest: `sha256:${"b".repeat(64)}`,
      stage: "plan",
      nextAction: "await-approval",
    };
    const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    const checkpoint = admitBuilderCheckpointSummary(bytes, digestRawBytes(bytes));
    const entry = buildBuilderEntry({ probe: await compatibleProbe(), checkpoint });
    assert.equal(entry.mode, "resume");
    assert.equal(entry.stage, "plan");
    assert.equal(entry.nextAction, "await-approval");
    assert.equal(entry.approval.required, true);
  });
});
