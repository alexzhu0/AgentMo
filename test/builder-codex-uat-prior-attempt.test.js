import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promises as fsPromises } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  symlink,
  writeFile,
} from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, it } from "node:test";

import { digestRawBytes } from "../src/artifact-admission.js";
import { readAppendOnlyAuthority } from "../src/builder-append-only-authority.js";
import {
  startCodexUatAttempt,
  terminateCodexUatAttempt,
} from "../src/builder-codex-uat.js";
import {
  CODEX_UAT_CONTINUATION_SCHEMA_VERSION,
  CODEX_UAT_PRIOR_PREFLIGHT_SCHEMA_VERSION,
  PRIVATE_AUTHORITY_RELATIVE_ROOT,
  admitPriorPreflightReceipt,
  bootstrapPrivateAuthorityRoot,
  loadCodexUatContinuation,
  loadPriorPreflightReceipt,
  preflightCodexUatPriorAttempt,
  publishCodexUatContinuation,
  publishPriorPreflightReceipt,
  transitionCodexUatContinuation,
} from "../src/builder-codex-uat-private-authority.js";

const digest = (character) => `sha256:${character.repeat(64)}`;
const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILD_UAT_RELEASES_SCRIPT = path.join(REPO_ROOT, "scripts", "build-builder-uat-releases.js");
const PRIVATE_TRANSITION_CHILD = path.resolve(
  "test/helpers/private-authority-transition-child.js",
);
const PRIOR_PREFLIGHT_SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../scripts/preflight-codex-uat-prior-attempt.js",
);
const CONTINUATION_ENTRY_PATTERN = /^\d{16}\.[a-f0-9]{64}\.json$/u;
const CONTINUATION_SEQUENCE_PATTERN = /^\d{16}\.json$/u;
const CONTINUATION_STAGE_PATTERN = /^([a-f0-9]{64})\.(record|prepared|outcome)\.stage\.json$/u;
const PRIVATE_TRANSITION_BOUNDARY_TIMEOUT_MS = 15_000;
const PRIVATE_TRANSITION_CHILD_TIMEOUT_MS = 30_000;
let releaseFixturePromise;
describe("repository-private prior-attempt authority", () => {
  it("keeps the private child watchdog outside the complete boundary observation window", () => {
    assert.equal(
      PRIVATE_TRANSITION_CHILD_TIMEOUT_MS
        >= PRIVATE_TRANSITION_BOUNDARY_TIMEOUT_MS + 15_000,
      true,
    );
  });

  it("exports the closed prior receipt and continuation contracts", () => {
    assert.equal(CODEX_UAT_PRIOR_PREFLIGHT_SCHEMA_VERSION, "agentmo.codex-uat-prior-preflight.v1");
    assert.equal(CODEX_UAT_CONTINUATION_SCHEMA_VERSION, "agentmo.codex-uat-continuation.v1");
    assert.equal(PRIVATE_AUTHORITY_RELATIVE_ROOT, ".omx/codex-uat/phase-02-final-retry");
    for (const operation of [
      preflightCodexUatPriorAttempt,
      bootstrapPrivateAuthorityRoot,
      publishPriorPreflightReceipt,
      loadPriorPreflightReceipt,
      admitPriorPreflightReceipt,
      publishCodexUatContinuation,
      loadCodexUatContinuation,
      transitionCodexUatContinuation,
    ]) assert.equal(typeof operation, "function");
  });

  it("preflights an exact synthetic two-entry terminal and publishes closed private authority", async () => {
    const fixture = await buildFixture();
    assert.equal(await exists(path.join(fixture.root, PRIVATE_AUTHORITY_RELATIVE_ROOT)), false);
    const preflight = await preflightCodexUatPriorAttempt(fixture.locator, {
      expectedHeadDigest: fixture.headDigest,
    });
    assert.equal(preflight.status, "pass");
    assert.equal(preflight.receipt.entryCount, 2);
    assert.equal(preflight.receipt.appended, false);
    assert.deepEqual(preflight.receipt.before, preflight.receipt.after);
    assert.equal(JSON.stringify(preflight.receipt).includes(fixture.root), false);

    const authority = await bootstrapPrivateAuthorityRoot({ repositoryRoot: fixture.root, preflight });
    const admission = await publishPriorPreflightReceipt({ authority, preflight });
    await authority.handle.close();
    assert.equal(admission.value.schemaVersion, CODEX_UAT_PRIOR_PREFLIGHT_SCHEMA_VERSION);
    assert.equal((await lstatMode(path.join(fixture.root, PRIVATE_AUTHORITY_RELATIVE_ROOT))), 0o700);
    const receiptAuthority = path.join(
      fixture.root,
      PRIVATE_AUTHORITY_RELATIVE_ROOT,
      "prior-preflight-authority",
    );
    for (const directory of [receiptAuthority, "entries", "outcomes", "prepared", "stages"]
      .map((name, index) => index === 0 ? name : path.join(receiptAuthority, name))) {
      assert.equal(await lstatMode(directory), 0o700);
    }
    const [receiptEntry] = await readdir(path.join(receiptAuthority, "entries"));
    assert.equal(await lstatMode(path.join(receiptAuthority, "entries", receiptEntry)), 0o600);

    const initial = await publishCodexUatContinuation({
      repositoryRoot: fixture.root,
      priorReceiptAdmission: admission,
      value: { status: "awaiting-local-invocation", candidateDigest: null, outcomeCode: null },
    });
    const candidate = await transitionCodexUatContinuation({
      repositoryRoot: fixture.root,
      expectedAdmission: initial,
      next: { status: "candidate-ready", candidateDigest: digest("c"), outcomeCode: null },
    });
    assert.equal(candidate.value.status, "candidate-ready");
    assert.equal((await loadCodexUatContinuation({ repositoryRoot: fixture.root })).digest, candidate.digest);
  });

  it("rejects an ancestor swap after retained-root validation without an external mkdir", async () => {
    const fixture = await buildFixture();
    const preflight = await preflightCodexUatPriorAttempt(fixture.locator, {
      expectedHeadDigest: fixture.headDigest,
    });
    const retainedRoot = `${fixture.root}-retained`;
    const externalRoot = await mkdtemp(path.join(os.tmpdir(), "agentmo-prior-private-external-"));
    const originalLstat = fsPromises.lstat;
    let rootLstatCalls = 0;
    let swapped = false;
    fsPromises.lstat = async (target, options) => {
      const stats = await originalLstat(target, options);
      if (target === fixture.root) {
        rootLstatCalls += 1;
        if (rootLstatCalls === 4) {
          await rename(fixture.root, retainedRoot);
          await symlink(externalRoot, fixture.root);
          swapped = true;
        }
      }
      return stats;
    };
    syncBuiltinESMExports();
    try {
      await assert.rejects(
        bootstrapPrivateAuthorityRoot({ repositoryRoot: fixture.root, preflight }),
        boundedRejection,
      );
    } finally {
      fsPromises.lstat = originalLstat;
      syncBuiltinESMExports();
    }
    assert.equal(swapped, true);
    assert.equal(rootLstatCalls >= 4, true);
    assert.deepEqual(await readdir(externalRoot), []);
  });

  it("rejects direct programmatic terminal human claims without moving candidate-ready", async () => {
    const { fixture, initial } = await buildContinuationFixture();
    const candidate = await transitionCodexUatContinuation({
      repositoryRoot: fixture.root,
      expectedAdmission: initial,
      next: { status: "candidate-ready", candidateDigest: digest("b"), outcomeCode: null },
    });
    const authorityRoot = continuationAuthorityRoot(fixture.root);
    const before = await snapshotTree(authorityRoot);

    for (const status of ["human-approved", "human-rejected"]) {
      await assert.rejects(
        transitionCodexUatContinuation({
          repositoryRoot: fixture.root,
          expectedAdmission: candidate,
          next: { status, candidateDigest: null, outcomeCode: null },
        }),
        (error) => {
          assert.equal(
            error?.code,
            "AGENTMO_CODEX_UAT_HUMAN_DECISION_AUTHORITY_REQUIRED",
          );
          return boundedRejection(error);
        },
      );
      assert.deepEqual(await snapshotTree(authorityRoot), before);
    }

    const reloaded = await loadCodexUatContinuation({ repositoryRoot: fixture.root });
    assert.equal(reloaded.digest, candidate.digest);
    assert.equal(reloaded.value.status, "candidate-ready");
  });

  it("rejects malformed locators, unsafe metadata, and conflicting continuation replay without disclosure", async () => {
    const fixture = await buildFixture();
    for (const locator of [
      Buffer.alloc(0),
      Buffer.from("{}"),
      { ...fixture.locator, extra: true },
      { ...fixture.locator, successorEntry: fixture.locator.baseJournal },
    ]) {
      await assert.rejects(preflightCodexUatPriorAttempt(locator, {
        expectedHeadDigest: fixture.headDigest,
      }), boundedRejection);
      assert.equal(await exists(path.join(fixture.root, PRIVATE_AUTHORITY_RELATIVE_ROOT)), false);
    }

    await chmod(path.dirname(fixture.locator.baseJournal), 0o777);
    await assert.rejects(preflightCodexUatPriorAttempt(fixture.locator, {
      expectedHeadDigest: fixture.headDigest,
    }), boundedRejection);
    await chmod(path.dirname(fixture.locator.baseJournal), 0o700);

    const preflight = await preflightCodexUatPriorAttempt(fixture.locator, {
      expectedHeadDigest: fixture.headDigest,
    });
    const authority = await bootstrapPrivateAuthorityRoot({ repositoryRoot: fixture.root, preflight });
    const receipt = await publishPriorPreflightReceipt({ authority, preflight });
    const replayedReceipt = await publishPriorPreflightReceipt({ authority, preflight });
    assert.equal(replayedReceipt.digest, receipt.digest);
    await authority.handle.close();
    const initial = await publishCodexUatContinuation({
      repositoryRoot: fixture.root,
      priorReceiptAdmission: receipt,
      value: { status: "awaiting-local-invocation", candidateDigest: null, outcomeCode: null },
    });
    const advanced = await transitionCodexUatContinuation({
      repositoryRoot: fixture.root,
      expectedAdmission: initial,
      next: { status: "failure", candidateDigest: null, outcomeCode: "AGENTMO_SYNTHETIC_FAILURE" },
    });
    const replayedInitial = await publishCodexUatContinuation({
      repositoryRoot: fixture.root,
      priorReceiptAdmission: receipt,
      value: { status: "awaiting-local-invocation", candidateDigest: null, outcomeCode: null },
    });
    assert.equal(replayedInitial.digest, initial.digest);
    const replayedAdvanced = await transitionCodexUatContinuation({
      repositoryRoot: fixture.root,
      expectedAdmission: initial,
      next: { status: "failure", candidateDigest: null, outcomeCode: "AGENTMO_SYNTHETIC_FAILURE" },
    });
    assert.equal(replayedAdvanced.digest, advanced.digest);
    await assert.rejects(transitionCodexUatContinuation({
      repositoryRoot: fixture.root,
      expectedAdmission: initial,
      next: { status: "interruption", candidateDigest: null, outcomeCode: "AGENTMO_DIFFERENT_FAILURE" },
    }), boundedRejection);
    await assert.rejects(transitionCodexUatContinuation({
      repositoryRoot: fixture.root,
      expectedAdmission: advanced,
      next: { status: "candidate-ready", candidateDigest: digest("d"), outcomeCode: null },
    }), boundedRejection);
    await assertCommittedContinuationLayout(continuationAuthorityRoot(fixture.root), 2);
  });

  it("admits exactly one concurrent successor for one continuation head", async () => {
    const { fixture, initial } = await buildContinuationFixture();
    const requests = ["c", "d"].map((character) => transitionCodexUatContinuation({
      repositoryRoot: fixture.root,
      expectedAdmission: initial,
      next: { status: "candidate-ready", candidateDigest: digest(character), outcomeCode: null },
    }));

    const settled = await Promise.allSettled(requests);
    const winners = settled.filter((item) => item.status === "fulfilled");
    const losers = settled.filter((item) => item.status === "rejected");
    assert.equal(winners.length, 1);
    assert.equal(losers.length, 1);
    assert.equal(boundedRejection(losers[0].reason), true);

    const admitted = await loadCodexUatContinuation({ repositoryRoot: fixture.root });
    assert.equal(admitted.digest, winners[0].value.digest);
    assert.equal(admitted.value.sequence, 1);
    await assertCommittedContinuationLayout(continuationAuthorityRoot(fixture.root), 2);

    assert.equal(
      (await loadCodexUatContinuation({ repositoryRoot: fixture.root })).digest,
      admitted.digest,
    );
  });

  it("does not expose a linked continuation until its publisher commits", async () => {
    const { fixture, initial } = await buildContinuationFixture();
    const next = { status: "candidate-ready", candidateDigest: digest("e"), outcomeCode: null };
    const stopped = await stopPrivateTransitionAt(
      fixture.root,
      next,
      "entries",
      (name) => /^0000000000000001\.[a-f0-9]{64}\.json$/u.test(name),
    );
    const concurrentLoad = await loadCodexUatContinuation({ repositoryRoot: fixture.root })
      .then((value) => ({ status: "fulfilled", value }))
      .catch((reason) => ({ status: "rejected", reason }));
    stopped.child.kill("SIGKILL");
    const killed = await stopped.terminalPromise;
    assert.equal(killed.exitCode, null);
    assert.equal(killed.signal, "SIGKILL");
    assert.equal(concurrentLoad.status, "fulfilled");
    assert.equal(concurrentLoad.value.digest, initial.digest);
    assert.equal(concurrentLoad.value.value.sequence, 0);
    const reloaded = await loadCodexUatContinuation({ repositoryRoot: fixture.root });
    assert.equal(reloaded.digest, initial.digest);
    assert.equal(reloaded.value.sequence, 0);
  });

  it("keeps a prepared append-only continuation non-authoritative and resumes it exactly", async () => {
    const { fixture, initial } = await buildContinuationFixture();
    const next = { status: "candidate-ready", candidateDigest: digest("9"), outcomeCode: null };

    const stopped = await stopPrivateTransitionAt(
      fixture.root,
      next,
      "prepared",
      (name) => name === "0000000000000001.json",
    );
    stopped.child.kill("SIGKILL");
    const killed = await stopped.terminalPromise;
    assert.equal(killed.exitCode, null);
    assert.equal(killed.signal, "SIGKILL");

    const beforeRetry = await loadCodexUatContinuation({ repositoryRoot: fixture.root });
    assert.equal(beforeRetry.digest, initial.digest);
    assert.equal(beforeRetry.value.sequence, 0);

    const resumed = await transitionCodexUatContinuation({
      repositoryRoot: fixture.root,
      expectedAdmission: beforeRetry,
      next,
    });
    assert.equal(resumed.value.sequence, 1);
    assert.equal(resumed.value.candidateDigest, next.candidateDigest);

    const continuationAuthority = path.join(
      fixture.root,
      PRIVATE_AUTHORITY_RELATIVE_ROOT,
      "continuation-authority",
    );
    await assertCommittedContinuationLayout(continuationAuthority, 2);
  });

  it("converges from a real fresh-process SIGKILL to one continuation", async () => {
    const { fixture } = await buildContinuationFixture();
    const next = { status: "candidate-ready", candidateDigest: digest("7"), outcomeCode: null };
    const stopped = await stopPrivateTransitionAt(
      fixture.root,
      next,
      "prepared",
      (name) => name === "0000000000000001.json",
    );
    stopped.child.kill("SIGKILL");
    await stopped.terminalPromise;

    const first = await runPrivateTransitionChild(fixture.root, next);
    assert.equal(first.type, "result", first.error?.code);
    assert.equal(first.result.value.sequence, 1);
    const stable = await snapshotTree(continuationAuthorityRoot(fixture.root));
    const second = await runPrivateTransitionChild(fixture.root, next);
    assert.equal(second.type, "result", second.error?.code);
    assert.equal(second.result.digest, first.result.digest);
    assert.deepEqual(second.result.value, first.result.value);
    assert.deepEqual(await snapshotTree(continuationAuthorityRoot(fixture.root)), stable);
  });

  it("unconditionally rejects an unknown continuation option", async () => {
    const { fixture, initial } = await buildContinuationFixture();
    await assert.rejects(
      transitionCodexUatContinuation({
        repositoryRoot: fixture.root,
        expectedAdmission: initial,
        next: { status: "candidate-ready", candidateDigest: digest("6"), outcomeCode: null },
        unexpectedContinuationOption: true,
      }),
      boundedRejection,
    );
  });

  it("returns the exact committed successor even when another writer advances it", async () => {
    const { fixture, initial } = await buildContinuationFixture();
    const firstCommitted = await transitionCodexUatContinuation({
      repositoryRoot: fixture.root,
      expectedAdmission: initial,
      next: { status: "candidate-ready", candidateDigest: digest("f"), outcomeCode: null },
    });
    assert.equal(firstCommitted.value.sequence, 1);
    const secondCommitted = await transitionCodexUatContinuation({
      repositoryRoot: fixture.root,
      expectedAdmission: firstCommitted,
      next: {
        status: "failure",
        candidateDigest: null,
        outcomeCode: "AGENTMO_SYNTHETIC_POST_CANDIDATE_FAILURE",
      },
    });
    const firstResult = await transitionCodexUatContinuation({
      repositoryRoot: fixture.root,
      expectedAdmission: initial,
      next: { status: "candidate-ready", candidateDigest: digest("f"), outcomeCode: null },
    });

    assert.equal(firstResult.value.sequence, 1);
    assert.equal(firstResult.digest, firstCommitted.digest);
    assert.equal(secondCommitted.value.sequence, 2);
    assert.equal(
      (await loadCodexUatContinuation({ repositoryRoot: fixture.root })).digest,
      secondCommitted.digest,
    );
  });

  it("rejects same-byte inode swaps, extra hardlinks, and occupied recovery paths without mutation", async () => {
    {
      const { fixture } = await buildContinuationFixture();
      const authorityRoot = continuationAuthorityRoot(fixture.root);
      const [entryName] = await continuationFinalEntries(authorityRoot);
      const entryPath = path.join(authorityRoot, "entries", entryName);
      const originalBytes = await readFile(entryPath);
      const displacedPath = path.join(fixture.root, PRIVATE_AUTHORITY_RELATIVE_ROOT, ".displaced-entry");
      await rename(entryPath, displacedPath);
      await writeFile(entryPath, originalBytes, { flag: "wx", mode: 0o600 });
      const replacement = await lstat(entryPath, { bigint: true });
      const displaced = await lstat(displacedPath, { bigint: true });
      assert.notEqual(replacement.ino, displaced.ino);
      const before = await snapshotTree(authorityRoot);
      await assert.rejects(
        loadCodexUatContinuation({ repositoryRoot: fixture.root }),
        boundedRejection,
      );
      assert.deepEqual(await snapshotTree(authorityRoot), before);
    }

    {
      const { fixture } = await buildContinuationFixture();
      const authorityRoot = continuationAuthorityRoot(fixture.root);
      const [entryName] = await continuationFinalEntries(authorityRoot);
      const entryPath = path.join(authorityRoot, "entries", entryName);
      const foreignLink = path.join(fixture.root, PRIVATE_AUTHORITY_RELATIVE_ROOT, ".foreign-link");
      await link(entryPath, foreignLink);
      const before = await snapshotTree(authorityRoot);
      await assert.rejects(
        loadCodexUatContinuation({ repositoryRoot: fixture.root }),
        boundedRejection,
      );
      assert.deepEqual(await snapshotTree(authorityRoot), before);
      assert.deepEqual(await readFile(foreignLink), await readFile(entryPath));
    }

    {
      const { fixture, initial } = await buildContinuationFixture();
      const next = { status: "candidate-ready", candidateDigest: digest("8"), outcomeCode: null };
      const stopped = await stopPrivateTransitionAt(
        fixture.root,
        next,
        "prepared",
        (name) => name === "0000000000000001.json",
      );
      stopped.child.kill("SIGKILL");
      await stopped.terminalPromise;
      const authorityRoot = continuationAuthorityRoot(fixture.root);
      const state = await readAppendOnlyAuthority({
        projectRoot: fixture.root,
        relativeRoot: path.relative(fixture.root, authorityRoot).split(path.sep).join("/"),
        namespace: "codex-uat-continuation",
      });
      assert.ok(state.recoveryRequired);
      const stagePath = path.join(authorityRoot, state.recoveryRequired.recordStagePath);
      const occupiedPath = path.join(authorityRoot, state.recoveryRequired.recordPath);
      const occupiedBytes = await readFile(stagePath);
      await writeFile(occupiedPath, occupiedBytes, { flag: "wx", mode: 0o600 });
      const occupiedIdentity = await lstat(occupiedPath, { bigint: true });
      const before = await snapshotTree(authorityRoot);
      await assert.rejects(transitionCodexUatContinuation({
        repositoryRoot: fixture.root,
        expectedAdmission: initial,
        next,
      }), boundedRejection);
      const afterIdentity = await lstat(occupiedPath, { bigint: true });
      assert.equal(afterIdentity.dev, occupiedIdentity.dev);
      assert.equal(afterIdentity.ino, occupiedIdentity.ino);
      assert.deepEqual(await snapshotTree(authorityRoot), before);
    }
  });
});

describe("prior-attempt preflight direct entry", () => {
  it("runs directly through a symlink path containing URL metacharacters", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agentmo-prior-entry-"));
    const entry = path.join(directory, "entry #?%.js");
    await symlink(PRIOR_PREFLIGHT_SCRIPT, entry);
    const result = await new Promise((resolve, rejectPromise) => {
      const child = spawn(process.execPath, [entry], { stdio: ["ignore", "ignore", "pipe"] });
      const chunks = [];
      child.stderr.on("data", (chunk) => chunks.push(chunk));
      child.on("error", rejectPromise);
      child.on("close", (code, signal) => resolve({
        code,
        signal,
        stderr: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    assert.equal(result.signal, null);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /AGENTMO_CODEX_UAT_PRIOR_COMMAND_REJECTED/u);
  });
});

async function buildAuthorityFixture() {
  const fixture = await buildFixture();
  const preflight = await preflightCodexUatPriorAttempt(fixture.locator, {
    expectedHeadDigest: fixture.headDigest,
  });
  const authority = await bootstrapPrivateAuthorityRoot({ repositoryRoot: fixture.root, preflight });
  return { fixture, preflight, authority };
}

async function buildContinuationFixture() {
  const { fixture, preflight, authority } = await buildAuthorityFixture();
  const receipt = await publishPriorPreflightReceipt({ authority, preflight });
  await authority.handle.close();
  const initial = await publishCodexUatContinuation({
    repositoryRoot: fixture.root,
    priorReceiptAdmission: receipt,
    value: { status: "awaiting-local-invocation", candidateDigest: null, outcomeCode: null },
  });
  return { fixture, initial };
}

function startPrivateTransitionChild(repositoryRoot, next) {
  const configuration = JSON.stringify({
    repositoryRoot,
    next,
  });
  return spawn(
    process.execPath,
    [PRIVATE_TRANSITION_CHILD, configuration],
    { stdio: ["ignore", "ignore", "ignore", "ipc"] },
  );
}

async function stopPrivateTransitionAt(repositoryRoot, next, directoryName, predicate) {
  const child = startPrivateTransitionChild(repositoryRoot, next);
  const terminalPromise = collectPrivateTransitionChild(child);
  terminalPromise.catch(() => undefined);
  const directory = path.join(continuationAuthorityRoot(repositoryRoot), directoryName);
  const deadline = Date.now() + PRIVATE_TRANSITION_BOUNDARY_TIMEOUT_MS;
  let matched = false;
  while (Date.now() < deadline && child.exitCode === null) {
    const names = await readdir(directory);
    if (names.some(predicate)) {
      matched = true;
      child.kill("SIGSTOP");
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.equal(matched, true, `private continuation completed before ${directoryName} boundary`);
  return { child, terminalPromise };
}

async function runPrivateTransitionChild(repositoryRoot, next) {
  return collectPrivateTransitionChild(startPrivateTransitionChild(repositoryRoot, next));
}

async function collectPrivateTransitionChild(child) {
  return new Promise((resolve, rejectPromise) => {
    let terminal = null;
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      rejectPromise(new Error("private continuation child timed out"));
    }, PRIVATE_TRANSITION_CHILD_TIMEOUT_MS);
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      rejectPromise(error);
    });
    child.on("message", (message) => {
      if (["result", "error"].includes(message?.type)) terminal = message;
    });
    child.on("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ ...terminal, exitCode, signal });
    });
  });
}

function continuationAuthorityRoot(repositoryRoot) {
  return path.join(
    repositoryRoot,
    PRIVATE_AUTHORITY_RELATIVE_ROOT,
    "continuation-authority",
  );
}

async function continuationFinalEntries(authorityRoot) {
  const entries = await readdir(path.join(authorityRoot, "entries"), { withFileTypes: true });
  const finals = entries
    .filter((entry) => entry.isFile() && CONTINUATION_ENTRY_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  assert.equal(finals.length, 1);
  return finals;
}

async function assertCommittedContinuationLayout(authorityRoot, recordCount) {
  const sequences = Array.from({ length: recordCount }, (_, sequence) => (
    `${String(sequence).padStart(16, "0")}.json`
  ));
  const claims = await readTypedAuthorityDirectory(authorityRoot, "claims");
  assert.deepEqual(claims.map((entry) => entry.name), sequences);
  assert.equal(claims.every((entry) => entry.kind === "symlink"), true);

  await assertSelectedAuthorityDirectory({
    authorityRoot,
    directory: "entries",
    kind: "record",
    recordCount,
    finalNames: null,
    sequencePrefixes: sequences.map((name) => name.slice(0, 16)),
  });
  await assertSelectedAuthorityDirectory({
    authorityRoot,
    directory: "prepared",
    kind: "prepared",
    recordCount,
    finalNames: sequences,
    sequencePrefixes: null,
  });
  await assertSelectedAuthorityDirectory({
    authorityRoot,
    directory: "outcomes",
    kind: "outcome",
    recordCount,
    finalNames: sequences,
    sequencePrefixes: null,
  });
  assert.deepEqual(await readTypedAuthorityDirectory(authorityRoot, "stages"), []);
}

async function assertSelectedAuthorityDirectory({
  authorityRoot,
  directory,
  kind,
  recordCount,
  finalNames,
  sequencePrefixes,
}) {
  const entries = await readTypedAuthorityDirectory(authorityRoot, directory);
  const finals = entries.filter((entry) => entry.kind === "file" && (
    kind === "record"
      ? CONTINUATION_ENTRY_PATTERN.test(entry.name)
      : CONTINUATION_SEQUENCE_PATTERN.test(entry.name)
  ));
  const stages = entries.filter((entry) => (
    entry.kind === "file" && CONTINUATION_STAGE_PATTERN.test(entry.name)
  ));
  const selections = entries.filter((entry) => entry.kind === "symlink");
  assert.equal(finals.length, recordCount, `${directory} final count`);
  assert.equal(stages.length, recordCount, `${directory} stage count`);
  assert.equal(selections.length, recordCount, `${directory} selection count`);
  assert.equal(entries.length, recordCount * 3, `${directory} exact entry count`);

  if (finalNames !== null) {
    assert.deepEqual(finals.map((entry) => entry.name), finalNames);
  } else {
    assert.deepEqual(finals.map((entry) => entry.name.slice(0, 16)), sequencePrefixes);
  }

  const operationIds = stages.map((entry) => {
    const match = CONTINUATION_STAGE_PATTERN.exec(entry.name);
    assert.equal(match?.[2], kind, `${directory} stage kind`);
    return match[1];
  }).sort();
  assert.equal(new Set(operationIds).size, recordCount, `${directory} distinct stage operations`);
  const expectedSelections = operationIds.map((operationId) => (
    kind === "outcome"
      ? `${operationId}.outcome.selection`
      : `${operationId}.${kind}.stage.json.selection`
  ));
  assert.deepEqual(selections.map((entry) => entry.name), expectedSelections);
}

async function readTypedAuthorityDirectory(authorityRoot, directory) {
  const entries = await readdir(path.join(authorityRoot, directory), { withFileTypes: true });
  return entries.map((entry) => ({
    name: entry.name,
    kind: entry.isFile() ? "file" : entry.isSymbolicLink() ? "symlink" : "other",
  })).sort((left, right) => left.name.localeCompare(right.name));
}

async function snapshotTree(root) {
  const snapshot = [];
  const visit = async (absolutePath, relativePath) => {
    const stats = await lstat(absolutePath, { bigint: true });
    snapshot.push({
      path: relativePath || ".",
      kind: stats.isDirectory() ? "directory" : stats.isFile() ? "file" : "other",
      device: stats.dev.toString(10),
      inode: stats.ino.toString(10),
      links: stats.nlink.toString(10),
      mode: (stats.mode & 0o7777n).toString(8),
      size: stats.size.toString(10),
      digest: stats.isFile() ? digestRawBytes(await readFile(absolutePath)) : null,
    });
    if (!stats.isDirectory()) return;
    for (const name of (await readdir(absolutePath)).sort()) {
      await visit(
        path.join(absolutePath, name),
        relativePath === "" ? name : `${relativePath}/${name}`,
      );
    }
  };
  await visit(root, "");
  return snapshot;
}

async function buildFixture() {
  const releases = await loadReleaseFixture();
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "agentmo-prior-preflight-")));
  await chmod(root, 0o700);
  const journalDirectory = path.join(root, "private-journal");
  await mkdir(journalDirectory, { mode: 0o700 });
  const journalPath = path.join(journalDirectory, "attempt.json");
  const started = await startCodexUatAttempt({
    journalPath,
    attemptId: "synthetic-prior-attempt",
    baseline: {
      packageRoot: releases.baselinePackage,
      tarballPath: releases.baselineTarball,
    },
    successor: {
      packageRoot: releases.successorPackage,
      tarballPath: releases.successorTarball,
    },
  });
  const failureEvidence = Buffer.from("bounded prior-attempt failure evidence\n", "utf8");
  const failureEvidencePath = path.join(root, "failure-evidence.txt");
  await writeFile(failureEvidencePath, failureEvidence, { flag: "wx", mode: 0o600 });
  const view = await terminateCodexUatAttempt({
    journalPath,
    expectedHeadAdmission: started.head,
    kind: "failure",
    code: "AGENTMO_BUILDER_INSTALL_HOST_ROLLBACK_FAILED",
    evidencePath: failureEvidencePath,
    expectedEvidenceDigest: digestRawBytes(failureEvidence),
  });
  const names = await readdir(journalDirectory);
  const successorName = names.find(
    (name) => /^\.attempt\.json\.agentmo-journal\.\d{12}-[a-f0-9]{64}\.json$/u.test(name),
  );
  assert.ok(successorName);
  await writeFile(path.join(root, "package.json"), `${JSON.stringify({ name: "fixture", version: "0.0.0" })}\n`, { mode: 0o600 });
  return {
    root,
    headDigest: view.head.digest,
    locator: {
      projectRoot: root,
      baseJournal: journalPath,
      successorEntry: path.join(journalDirectory, successorName),
    },
  };
}

async function loadReleaseFixture() {
  releaseFixturePromise ??= buildReleaseFixture();
  return releaseFixturePromise;
}

async function buildReleaseFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentmo-prior-preflight-releases-"));
  const out = path.join(root, "releases");
  const baselineVersion = "0.1.0-uat.prior.1";
  const successorVersion = "0.1.0-uat.prior.2";
  await execFileAsync(process.execPath, [
    BUILD_UAT_RELEASES_SCRIPT,
    "--out", out,
    "--baseline-version", baselineVersion,
    "--successor-version", successorVersion,
    "--json",
  ], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  const baselineTarball = path.join(out, `agentmo-${baselineVersion}.tgz`);
  const successorTarball = path.join(out, `agentmo-${successorVersion}.tgz`);
  const baselineExtract = path.join(root, "baseline");
  const successorExtract = path.join(root, "successor");
  await Promise.all([mkdir(baselineExtract), mkdir(successorExtract)]);
  await Promise.all([
    execFileAsync("tar", ["-xzf", baselineTarball, "-C", baselineExtract]),
    execFileAsync("tar", ["-xzf", successorTarball, "-C", successorExtract]),
  ]);
  return Object.freeze({
    baselineTarball,
    successorTarball,
    baselinePackage: path.join(baselineExtract, "package"),
    successorPackage: path.join(successorExtract, "package"),
  });
}

async function exists(filePath) {
  try { await lstat(filePath); return true; } catch { return false; }
}

async function lstatMode(filePath) {
  return (await lstat(filePath)).mode & 0o777;
}

function boundedRejection(error) {
  assert.match(error?.code ?? "", /^AGENTMO_[A-Z0-9_]{1,120}$/u);
  assert.equal(error.message.includes("/"), false);
  return true;
}
