import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it } from "node:test";

import {
  DECISION_ENTRY_KINDS,
  DECISION_LEDGER_SCHEMA_VERSION,
  appendDecisionEntry,
  canonicalizeDecisionEntryDraft,
  loadDecisionLedger,
  validateDecisionEntry,
  validateDecisionLedger,
} from "../src/decision-ledger.js";
import {
  canonicalizeDecisionEntryFile,
} from "../src/decision-entry-canonicalizer.js";

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

function readCliError(result) {
  assert.equal(result.code, 1, result.stderr);
  return JSON.parse(result.stdout);
}

async function decisionEntryStageDirectories(root) {
  return (await readdir(root)).filter((name) => (
    name.startsWith(".agentmo-decision-entry-stage-")
  ));
}

describe("decision ledger", () => {
  it("canonicalizes every reference field before digest authority exists", () => {
    const draft = {
      schemaVersion: "agentmo.decision-entry.v1",
      ...entry("decision-reference-order", "inference", {
        sourceRefs: ["source-z", "source-a"],
        decisionRefs: ["decision-z", "decision-a"],
        requirementRefs: ["requirement-z", "requirement-a"],
      }),
    };

    assert.equal(validateDecisionEntry(draft).ok, false);
    const canonical = canonicalizeDecisionEntryDraft(draft);
    assert.deepEqual(canonical.sourceRefs, ["source-a", "source-z"]);
    assert.deepEqual(canonical.decisionRefs, ["decision-a", "decision-z"]);
    assert.deepEqual(canonical.requirementRefs, ["requirement-a", "requirement-z"]);
    assert.deepEqual(draft.decisionRefs, ["decision-z", "decision-a"]);
    assert.equal(validateDecisionEntry(canonical).ok, true);
  });

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

  it("canonicalizes an unapproved entry before its digest and never rewrites it during append", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-decision-ledger-canonicalize-"));
    const journalPath = path.join(root, "ledger.json");
    const draftPath = path.join(root, "draft.json");
    const canonicalPath = path.join(root, "canonical.json");
    const draftBytes = Buffer.from(`${JSON.stringify({
      schemaVersion: "agentmo.decision-entry.v1",
      ...entry("decision-1", "human-decision", {
        sourceRefs: ["source-z", "source-a"],
        requirementRefs: ["requirement-z", "requirement-a"],
      }),
    }, null, 2)}\n`);
    await writeFile(draftPath, draftBytes);

    const directAppend = await runCli([
      "decision-ledger",
      "append",
      "--journal",
      journalPath,
      "--entry",
      draftPath,
      "--digest",
      `decision-entry=${digest(draftBytes)}`,
      "--json",
    ]);
    const directError = readCliError(directAppend);
    assert.equal(directError.code, "AGENTMO_UNSUPPORTED_ARTIFACT");
    assert.equal(directError.subject, "decision-entry");
    assert.equal(
      directError.issues.includes(
        "requirementRefs must be a strictly ascending unique array of safe identifiers.",
      ),
      true,
    );
    assert.equal(directAppend.stdout.includes(root), false);
    assert.equal(directAppend.stdout.includes("requirement-z"), false);
    await assert.rejects(access(journalPath));

    const canonicalized = await runCli([
      "decision-ledger",
      "canonicalize-entry",
      "--entry",
      draftPath,
      "--out",
      canonicalPath,
      "--json",
    ]);
    assert.equal(canonicalized.code, 0, canonicalized.stderr);
    const canonicalizedSummary = JSON.parse(canonicalized.stdout);
    const canonicalBytes = await readFile(canonicalPath);
    assert.deepEqual(canonicalizedSummary, {
      schemaVersion: "agentmo.decision-entry-canonicalization.v1",
      identity: "agentmo.decision-entry.v1",
      subject: "decision-entry",
      digest: digest(canonicalBytes),
    });
    assert.equal(canonicalized.stdout.includes(root), false);
    assert.equal((await lstat(canonicalPath, { bigint: true })).nlink, 1n);
    assert.deepEqual(await decisionEntryStageDirectories(root), []);
    assert.deepEqual(await readFile(draftPath), draftBytes);
    assert.deepEqual(JSON.parse(canonicalBytes).sourceRefs, ["source-a", "source-z"]);
    assert.deepEqual(JSON.parse(canonicalBytes).requirementRefs, ["requirement-a", "requirement-z"]);

    const first = await runCli([
      "decision-ledger",
      "append",
      "--journal",
      journalPath,
      "--entry",
      canonicalPath,
      "--digest",
      `decision-entry=${canonicalizedSummary.digest}`,
      "--json",
    ]);
    assert.equal(first.code, 0, first.stderr);
    const firstSummary = JSON.parse(first.stdout);
    assert.deepEqual(firstSummary.entries[0].sourceRefs, ["source-a", "source-z"]);
    assert.deepEqual(firstSummary.entries[0].requirementRefs, ["requirement-a", "requirement-z"]);

    const successorDraftPath = path.join(root, "successor-draft.json");
    const successorCanonicalPath = path.join(root, "successor-canonical.json");
    await writeFile(successorDraftPath, `${JSON.stringify({
      schemaVersion: "agentmo.decision-entry.v1",
      ...entry("decision-2", "inference", {
        decisionRefs: ["decision-1"],
        requirementRefs: ["requirement-a"],
      }),
    }, null, 2)}\n`);
    const successorCanonicalized = await runCli([
      "decision-ledger",
      "canonicalize-entry",
      "--entry",
      successorDraftPath,
      "--out",
      successorCanonicalPath,
      "--json",
    ]);
    assert.equal(successorCanonicalized.code, 0, successorCanonicalized.stderr);
    const successorDigest = JSON.parse(successorCanonicalized.stdout).digest;

    const wrongDigest = readCliError(await runCli([
      "decision-ledger",
      "append",
      "--journal",
      journalPath,
      "--entry",
      successorCanonicalPath,
      "--digest",
      `decision-entry=sha256:${"0".repeat(64)}`,
      "--expected-head-digest",
      firstSummary.head.digest,
      "--json",
    ]));
    assert.equal(wrongDigest.code, "AGENTMO_ARTIFACT_DIGEST_MISMATCH");

    const wrongFlag = readCliError(await runCli([
      "decision-ledger",
      "append",
      "--journal",
      journalPath,
      "--entry",
      successorCanonicalPath,
      "--digest",
      `decision-entry=${successorDigest}`,
      "--expected-head-sha256",
      firstSummary.head.digest,
      "--json",
    ]));
    assert.equal(wrongFlag.code, "AGENTMO_CLI_REQUEST_REJECTED");
    assert.equal(JSON.stringify(wrongFlag).includes(root), false);

    const second = await runCli([
      "decision-ledger",
      "append",
      "--journal",
      journalPath,
      "--entry",
      successorCanonicalPath,
      "--digest",
      `decision-entry=${successorDigest}`,
      "--expected-head-digest",
      firstSummary.head.digest,
      "--json",
    ]);
    assert.equal(second.code, 0, second.stderr);

    const stale = readCliError(await runCli([
      "decision-ledger",
      "append",
      "--journal",
      journalPath,
      "--entry",
      successorCanonicalPath,
      "--digest",
      `decision-entry=${successorDigest}`,
      "--expected-head-digest",
      firstSummary.head.digest,
      "--json",
    ]));
    assert.equal(stale.code, "AGENTMO_DECISION_LEDGER_STALE_HEAD");
    const unchanged = await runCli([
      "decision-ledger",
      "inspect",
      "--journal",
      journalPath,
      "--digest",
      `decision-ledger=${JSON.parse(second.stdout).head.digest}`,
      "--json",
    ]);
    assert.equal(unchanged.code, 0, unchanged.stderr);
    assert.equal(JSON.parse(unchanged.stdout).entryCount, 2);
  });

  it("admits canonical entries at the documented Unicode code-point bounds", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-decision-ledger-unicode-bounds-"));
    const journalPath = path.join(root, "ledger.json");
    const draftPath = path.join(root, "draft.json");
    const canonicalPath = path.join(root, "canonical.json");
    await writeFile(draftPath, `${JSON.stringify({
      schemaVersion: "agentmo.decision-entry.v1",
      ...entry("decision-unicode-bounds", "fact", {
        subject: "😀".repeat(257),
        reason: "😀".repeat(2049),
      }),
    }, null, 2)}\n`);

    const canonicalized = await runCli([
      "decision-ledger",
      "canonicalize-entry",
      "--entry",
      draftPath,
      "--out",
      canonicalPath,
      "--json",
    ]);
    assert.equal(canonicalized.code, 0, canonicalized.stderr);
    const canonicalizedSummary = JSON.parse(canonicalized.stdout);

    const appended = await runCli([
      "decision-ledger",
      "append",
      "--journal",
      journalPath,
      "--entry",
      canonicalPath,
      "--digest",
      `decision-entry=${canonicalizedSummary.digest}`,
      "--json",
    ]);
    assert.equal(appended.code, 0, appended.stderr);
    assert.equal(JSON.parse(appended.stdout).entryCount, 1);
  });

  it("rejects duplicate draft references without publishing a canonical entry", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-decision-ledger-duplicate-draft-"));
    const draftPath = path.join(root, "draft.json");
    const canonicalPath = path.join(root, "canonical.json");
    await writeFile(draftPath, `${JSON.stringify({
      schemaVersion: "agentmo.decision-entry.v1",
      ...entry("decision-duplicate", "unknown", {
        requirementRefs: ["requirement-a", "requirement-a"],
      }),
    }, null, 2)}\n`);

    const rejected = readCliError(await runCli([
      "decision-ledger",
      "canonicalize-entry",
      "--entry",
      draftPath,
      "--out",
      canonicalPath,
      "--json",
    ]));
    assert.equal(rejected.code, "AGENTMO_DECISION_ENTRY_CANONICALIZE_REJECTED");
    assert.equal(rejected.subject, "decision-entry");
    assert.equal(
      rejected.issues.includes(
        "requirementRefs must be a unique array of safe identifiers.",
      ),
      true,
    );
    assert.equal(JSON.stringify(rejected).includes(root), false);
    assert.equal(JSON.stringify(rejected).includes("requirement-a"), false);
    await assert.rejects(access(canonicalPath));
  });

  it("rejects duplicate JSON members before draft canonicalization", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-decision-ledger-duplicate-json-"));
    const draftPath = path.join(root, "draft.json");
    const canonicalPath = path.join(root, "canonical.json");
    await writeFile(draftPath, [
      "{",
      '  "schemaVersion": "agentmo.decision-entry.v1",',
      '  "entryId": "decision-duplicate-json",',
      '  "entryId": "decision-conflicting-json",',
      '  "entryKind": "unknown",',
      '  "subject": "Bounded planning question.",',
      '  "reason": "Bounded planning evidence.",',
      '  "sourceRefs": [],',
      '  "decisionRefs": [],',
      '  "requirementRefs": []',
      "}",
      "",
    ].join("\n"));

    const rejected = readCliError(await runCli([
      "decision-ledger",
      "canonicalize-entry",
      "--entry",
      draftPath,
      "--out",
      canonicalPath,
      "--json",
    ]));
    assert.equal(rejected.code, "AGENTMO_DECISION_ENTRY_CANONICALIZE_REJECTED");
    assert.equal(rejected.subject, "decision-entry");
    assert.equal(
      rejected.issues.includes("draft entry must be valid bounded UTF-8 JSON."),
      true,
    );
    assert.equal(JSON.stringify(rejected).includes(root), false);
    assert.equal(JSON.stringify(rejected).includes("decision-conflicting-json"), false);
    await assert.rejects(access(canonicalPath));
  });

  it("never overwrites an existing canonical-entry output", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-decision-ledger-output-collision-"));
    const draftPath = path.join(root, "draft.json");
    const canonicalPath = path.join(root, "canonical.json");
    const existingBytes = Buffer.from("preserve-existing-bytes\n");
    await writeFile(draftPath, `${JSON.stringify({
      schemaVersion: "agentmo.decision-entry.v1",
      ...entry("decision-output-collision", "unknown"),
    }, null, 2)}\n`);
    await writeFile(canonicalPath, existingBytes);

    const rejected = readCliError(await runCli([
      "decision-ledger",
      "canonicalize-entry",
      "--entry",
      draftPath,
      "--out",
      canonicalPath,
      "--json",
    ]));
    assert.equal(rejected.code, "AGENTMO_DECISION_ENTRY_CANONICALIZE_REJECTED");
    assert.equal(
      rejected.issues.includes("canonical output must be absent."),
      true,
    );
    assert.deepEqual(await readFile(canonicalPath), existingBytes);
  });

  it("rejects symlinked inputs, symlinked outputs, and unsafe output parents without publishing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-decision-ledger-canonicalize-paths-"));
    const draftPath = path.join(root, "draft.json");
    const symlinkTarget = path.join(root, "symlink-target.json");
    const symlinkOutput = path.join(root, "symlink-output.json");
    const symlinkDraft = path.join(root, "symlink-draft.json");
    const inputSymlinkOutput = path.join(root, "input-symlink-output.json");
    const unsafeParent = path.join(root, "unsafe-parent");
    const unsafeOutput = path.join(unsafeParent, "canonical.json");
    const targetBytes = Buffer.from("symlink-target-bytes\n");
    await writeFile(draftPath, `${JSON.stringify({
      schemaVersion: "agentmo.decision-entry.v1",
      ...entry("decision-canonicalize-paths", "human-decision"),
    }, null, 2)}\n`);

    await writeFile(symlinkTarget, targetBytes);
    await symlink(symlinkTarget, symlinkOutput);
    await assert.rejects(
      canonicalizeDecisionEntryFile({ entryPath: draftPath, outPath: symlinkOutput }),
      (error) => error?.code === "AGENTMO_DECISION_ENTRY_CANONICALIZE_REJECTED",
    );
    assert.equal((await lstat(symlinkOutput)).isSymbolicLink(), true);
    assert.deepEqual(await readFile(symlinkTarget), targetBytes);
    assert.deepEqual(await decisionEntryStageDirectories(root), []);

    await symlink(draftPath, symlinkDraft);
    await assert.rejects(
      canonicalizeDecisionEntryFile({ entryPath: symlinkDraft, outPath: inputSymlinkOutput }),
      (error) => error?.code === "AGENTMO_DECISION_ENTRY_CANONICALIZE_REJECTED",
    );
    await assert.rejects(access(inputSymlinkOutput));
    assert.deepEqual(await decisionEntryStageDirectories(root), []);

    await mkdir(unsafeParent, { mode: 0o700 });
    await chmod(unsafeParent, 0o775);
    await assert.rejects(
      canonicalizeDecisionEntryFile({ entryPath: draftPath, outPath: unsafeOutput }),
      (error) => error?.code === "AGENTMO_DECISION_ENTRY_CANONICALIZE_REJECTED",
    );
    await assert.rejects(access(unsafeOutput));
  });
});
