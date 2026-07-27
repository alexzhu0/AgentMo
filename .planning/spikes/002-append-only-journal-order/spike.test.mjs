import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  SCENARIOS,
  appendCandidateReady,
  appendEntry,
  appendHumanDecision,
  digest,
  loadJournal,
  publishCandidate,
  testPublishRawEntry,
} from "./journal.mjs";

const D = (label) => digest({ label });
const RELEASE = (label, version = "1.1.0") => ({
  version,
  releaseDigest: D(`${label}-release`),
  tarballDigest: D(`${label}-tarball`),
});

async function root() {
  return mkdtemp(path.join(tmpdir(), "agentmo-journal-spike-"));
}

async function throughScenarios(journalRoot, attemptId = "attempt-001") {
  await appendEntry(journalRoot, attemptId, "attempt-started", { evidenceDigest: D("start") });
  await appendEntry(journalRoot, attemptId, "setup-applied", { evidenceDigest: D("setup") });
  await appendEntry(journalRoot, attemptId, "activation-applied", { evidenceDigest: D("activation") });
  await appendEntry(journalRoot, attemptId, "trust-auth-observed", { evidenceDigest: D("trust") });
  for (const scenario of SCENARIOS) {
    await appendEntry(journalRoot, attemptId, "scenario-observed", {
      scenario,
      evidenceDigest: D(scenario),
    });
  }
  return attemptId;
}

test("candidate is an immutable leaf referenced by candidate-ready, never a journal-head back-reference", async () => {
  const journalRoot = await root();
  const attemptId = await throughScenarios(journalRoot);
  const beforeCandidate = await loadJournal(journalRoot);
  const published = await publishCandidate(journalRoot, RELEASE("successor"));
  assert.equal(Object.hasOwn(published.candidate, "journalHeadDigest"), false);
  assert.equal((await loadJournal(journalRoot)).headDigest, beforeCandidate.headDigest, "orphan leaf cannot mutate journal authority");

  const ready = await appendCandidateReady(journalRoot, attemptId, published.candidateDigest);
  assert.equal(ready.entry.payload.candidateDigest, published.candidateDigest);
  const admitted = await appendHumanDecision(journalRoot, attemptId, "approve", published.candidateDigest);
  assert.equal(admitted.state.phase, "human-admission");
  assert.equal(admitted.state.terminal, true);
  await assert.rejects(
    appendHumanDecision(journalRoot, attemptId, "reject", published.candidateDigest),
    { code: "JOURNAL_TRANSITION_INVALID" },
  );
});

test("candidate-ready is impossible before all eleven ordered scenarios", async () => {
  const journalRoot = await root();
  const attemptId = "attempt-early";
  await appendEntry(journalRoot, attemptId, "attempt-started", { evidenceDigest: D("start") });
  await appendEntry(journalRoot, attemptId, "setup-applied", { evidenceDigest: D("setup") });
  await appendEntry(journalRoot, attemptId, "activation-applied", { evidenceDigest: D("activation") });
  await appendEntry(journalRoot, attemptId, "trust-auth-observed", { evidenceDigest: D("trust") });
  await assert.rejects(publishCandidate(journalRoot, RELEASE("early")), { code: "CANDIDATE_PRECONDITION_FAILED" });
  await assert.rejects(
    appendEntry(journalRoot, attemptId, "scenario-observed", { scenario: "session-start", evidenceDigest: D("wrong-order") }),
    { code: "JOURNAL_SCENARIO_ORDER_INVALID" },
  );
});

test("forks and orphan/gap entries fail closed without choosing a mutable head", async () => {
  const forkRoot = await root();
  const attemptId = "attempt-fork";
  const genesis = await appendEntry(forkRoot, attemptId, "attempt-started", { evidenceDigest: D("start") });
  const base = {
    schemaVersion: "agentmo.codex-uat-attempt-journal-entry.v1",
    attemptId,
    sequence: 1,
    kind: "setup-applied",
    previousEntryDigest: genesis.entryDigest,
  };
  await testPublishRawEntry(forkRoot, { ...base, payload: { evidenceDigest: D("left") } });
  await testPublishRawEntry(forkRoot, { ...base, payload: { evidenceDigest: D("right") } });
  await assert.rejects(loadJournal(forkRoot), { code: "JOURNAL_FORK_REJECTED" });

  const gapRoot = await root();
  await appendEntry(gapRoot, "attempt-gap", "attempt-started", { evidenceDigest: D("start") });
  await testPublishRawEntry(gapRoot, {
    schemaVersion: "agentmo.codex-uat-attempt-journal-entry.v1",
    attemptId: "attempt-gap",
    sequence: 2,
    kind: "activation-applied",
    previousEntryDigest: D("missing-predecessor"),
    payload: { evidenceDigest: D("activation") },
  });
  await assert.rejects(loadJournal(gapRoot), { code: "JOURNAL_ORPHAN_OR_GAP_REJECTED" });
});

test("a staged partial file has no authority while a malformed published entry fails closed", async () => {
  const journalRoot = await root();
  await appendEntry(journalRoot, "attempt-stage", "attempt-started", { evidenceDigest: D("start") });
  await writeFile(path.join(journalRoot, "entries", ".stage-partial"), "partial");
  assert.equal((await loadJournal(journalRoot)).entries.length, 1);
  await writeFile(path.join(journalRoot, "entries", `${"0001"}-${"a".repeat(64)}.json`), "{broken");
  await assert.rejects(loadJournal(journalRoot), { code: "JOURNAL_ENTRY_INVALID" });
});

test("failure and interruption are terminal, mutually exclusive outcomes", async () => {
  for (const kind of ["failure", "interruption"]) {
    const journalRoot = await root();
    const attemptId = `attempt-${kind}`;
    await appendEntry(journalRoot, attemptId, "attempt-started", { evidenceDigest: D("start") });
    const outcome = await appendEntry(journalRoot, attemptId, kind, {
      evidenceDigest: D(kind),
      code: kind === "failure" ? "TRUST_AUTH_FAILED" : "PROCESS_INTERRUPTED",
    });
    assert.equal(outcome.state.phase, kind);
    await assert.rejects(
      appendEntry(journalRoot, attemptId, "setup-applied", { evidenceDigest: D("late") }),
      { code: "JOURNAL_TRANSITION_INVALID" },
    );
  }
});
