import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it } from "node:test";

import {
  DECISION_ENTRY_KINDS,
  DECISION_LEDGER_SCHEMA_VERSION,
  appendDecisionEntry,
  loadDecisionLedger,
  validateDecisionLedger,
} from "../src/decision-ledger.js";

const CLI = fileURLToPath(new URL("../bin/agentmo.js", import.meta.url));

async function newLedgerPath(label) {
  const root = await mkdtemp(path.join(tmpdir(), `agentmo-decision-ledger-${label}-`));
  return path.join(root, "ledger.json");
}

function entry(entryId, kind, overrides = {}) {
  return {
    entryId,
    entryKind: kind,
    subject: `${kind} planning record`,
    reason: "Bounded planning evidence.",
    sourceRefs: [],
    decisionRefs: [],
    requirementRefs: [],
    ...overrides,
  };
}

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("decision ledger", () => {
  it("persists all five closed entry kinds with contiguous predecessor-bound lineage", async () => {
    const ledgerPath = await newLedgerPath("kinds");
    let headDigest;

    for (const [index, kind] of DECISION_ENTRY_KINDS.entries()) {
      const result = await appendDecisionEntry({
        journalPath: ledgerPath,
        expectedHeadDigest: headDigest,
        entry: entry(`decision-${index + 1}`, kind, {
          decisionRefs: index === 0 ? [] : [`decision-${index}`],
        }),
      });
      assert.equal(result.committed, true);
      assert.equal(result.head.sequence, index);
      headDigest = result.head.digest;
    }

    const restarted = await loadDecisionLedger({
      journalPath: ledgerPath,
      expectedHeadDigest: headDigest,
    });
    assert.equal(restarted.schemaVersion, DECISION_LEDGER_SCHEMA_VERSION);
    assert.equal(restarted.entries.length, 5);
    assert.deepEqual(restarted.entries.map((item) => item.entryKind), DECISION_ENTRY_KINDS);
    assert.deepEqual(restarted.entries.map((item) => item.sequence), [0, 1, 2, 3, 4]);
    assert.equal(restarted.entries[0].predecessorDigest, null);
    for (let index = 1; index < restarted.entries.length; index += 1) {
      assert.equal(restarted.entries[index].predecessorDigest, restarted.entries[index - 1].valueDigest);
    }
    assert.deepEqual(validateDecisionLedger(restarted), { ok: true, errors: [] });
  });

  it("rejects stale heads, duplicate IDs, dangling decision refs, and unknown kinds without advancing", async () => {
    const ledgerPath = await newLedgerPath("reject");
    const genesis = await appendDecisionEntry({
      journalPath: ledgerPath,
      entry: entry("decision-1", "fact"),
    });

    for (const candidate of [
      entry("decision-2", "unsupported-kind"),
      entry("decision-1", "inference"),
      entry("decision-2", "inference", { decisionRefs: ["missing-decision"] }),
    ]) {
      await assert.rejects(
        appendDecisionEntry({
          journalPath: ledgerPath,
          expectedHeadDigest: genesis.head.digest,
          entry: candidate,
        }),
        (error) => error?.code?.startsWith("AGENTMO_DECISION_LEDGER_"),
      );
    }

    await assert.rejects(
      appendDecisionEntry({
        journalPath: ledgerPath,
        expectedHeadDigest: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        entry: entry("decision-2", "inference", { decisionRefs: ["decision-1"] }),
      }),
      (error) => error?.code === "AGENTMO_DECISION_LEDGER_STALE_HEAD",
    );

    const unchanged = await loadDecisionLedger({ journalPath: ledgerPath });
    assert.equal(unchanged.entries.length, 1);
    assert.equal(unchanged.head.digest, genesis.head.digest);
  });

  it("rejects transcript, tool-output, credential, and unrestricted-field material before publication", async () => {
    for (const [label, candidate] of [
      ["transcript", entry("decision-1", "fact", { reason: "Preserve the raw transcript here." })],
      ["tool-output", entry("decision-1", "fact", { toolOutput: "captured body" })],
      ["credential", entry("decision-1", "fact", { reason: "api_key=sk-secret-value" })],
      ["notes", entry("decision-1", "fact", { notes: "unrestricted notes" })],
    ]) {
      const ledgerPath = await newLedgerPath(label);
      await assert.rejects(
        appendDecisionEntry({ journalPath: ledgerPath, entry: candidate }),
        (error) => error?.code?.startsWith("AGENTMO_DECISION_LEDGER_"),
      );
      const loaded = await loadDecisionLedger({ journalPath: ledgerPath });
      assert.equal(loaded.entries.length, 0);
      assert.equal(loaded.head, null);
    }
  });

  it("allows only one concurrent successor for the same exact predecessor", async () => {
    const ledgerPath = await newLedgerPath("concurrent");
    const genesis = await appendDecisionEntry({
      journalPath: ledgerPath,
      entry: entry("decision-1", "fact"),
    });

    const outcomes = await Promise.allSettled([
      appendDecisionEntry({
        journalPath: ledgerPath,
        expectedHeadDigest: genesis.head.digest,
        entry: entry("decision-2a", "inference", { decisionRefs: ["decision-1"] }),
      }),
      appendDecisionEntry({
        journalPath: ledgerPath,
        expectedHeadDigest: genesis.head.digest,
        entry: entry("decision-2b", "unknown", { decisionRefs: ["decision-1"] }),
      }),
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled"
      && outcome.value.committed === true).length, 1);

    const restarted = await loadDecisionLedger({ journalPath: ledgerPath });
    assert.equal(restarted.entries.length, 2);
    assert.equal(restarted.head.sequence, 1);
  });

  it("appends and inspects typed entries in fresh CLI processes with exact bindings", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-decision-ledger-cli-"));
    const journalPath = path.join(root, "ledger.json");
    const firstPath = path.join(root, "first.json");
    const firstBytes = Buffer.from(`${JSON.stringify({
      schemaVersion: "agentmo.decision-entry.v1",
      ...entry("decision-1", "human-decision", {
        requirementRefs: ["primary-task-01"],
      }),
    }, null, 2)}\n`);
    await writeFile(firstPath, firstBytes);

    const first = await runCli([
      "decision-ledger",
      "append",
      "--journal",
      journalPath,
      "--entry",
      firstPath,
      "--digest",
      `decision-entry=${digest(firstBytes)}`,
      "--json",
    ]);
    assert.equal(first.code, 0, first.stderr);
    const firstSummary = JSON.parse(first.stdout);
    assert.equal(firstSummary.entryCount, 1);
    assert.equal(first.stdout.includes(root), false);

    const inspected = await runCli([
      "decision-ledger",
      "inspect",
      "--journal",
      journalPath,
      "--digest",
      `decision-ledger=${firstSummary.head.digest}`,
      "--json",
    ]);
    assert.equal(inspected.code, 0, inspected.stderr);
    assert.deepEqual(JSON.parse(inspected.stdout), firstSummary);

    const secondPath = path.join(root, "second.json");
    const secondBytes = Buffer.from(`${JSON.stringify({
      schemaVersion: "agentmo.decision-entry.v1",
      ...entry("decision-2", "inference", {
        decisionRefs: ["decision-1"],
        requirementRefs: ["primary-task-01"],
      }),
    }, null, 2)}\n`);
    await writeFile(secondPath, secondBytes);
    const second = await runCli([
      "decision-ledger",
      "append",
      "--journal",
      journalPath,
      "--entry",
      secondPath,
      "--digest",
      `decision-entry=${digest(secondBytes)}`,
      "--expected-head-digest",
      firstSummary.head.digest,
      "--json",
    ]);
    assert.equal(second.code, 0, second.stderr);
    assert.equal(JSON.parse(second.stdout).entryCount, 2);

    const stale = await runCli([
      "decision-ledger",
      "append",
      "--journal",
      journalPath,
      "--entry",
      secondPath,
      "--digest",
      `decision-entry=${digest(secondBytes)}`,
      "--expected-head-digest",
      firstSummary.head.digest,
      "--json",
    ]);
    assert.equal(stale.code, 1);
    assert.equal(stale.stderr.includes(root), false);
    assert.equal((await readFile(journalPath, "utf8")).includes("decision-1"), true);
  });
});
