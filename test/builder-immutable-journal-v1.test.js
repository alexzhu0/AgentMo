import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { digestRawBytes } from "../src/artifact-admission.js";
import {
  appendImmutableJournalEntry,
  loadImmutableJournal,
} from "../src/builder-immutable-journal.js";

const JOURNAL_MODULE_URL = new URL("../src/builder-immutable-journal.js", import.meta.url).href;
const BOUNDARIES = Object.freeze([
  ["prepared-stage", /\.agentmo-journal\.prepared-stage\.[a-f0-9]{64}\.json$/u],
  ["prepared-link", /\.agentmo-journal\.prepared\.[0-9]{12}\.json$/u],
  ["entry-stage", /\.agentmo-journal\.entry-stage\.[a-f0-9]{64}\.bin$/u],
  ["entry-link", /\.agentmo-journal\.[0-9]{12}-[a-f0-9]{64}\.json$/u],
  ["outcome-stage", /\.agentmo-journal\.outcome-stage\.[a-f0-9]{64}-[a-f0-9]{64}\.json$/u],
  ["outcome-link", /\.agentmo-journal\.outcome\.[0-9]{12}-[a-f0-9]{64}\.json$/u],
]);

function startWriter(journalPath, canonicalBytes) {
  const script = `
import { appendImmutableJournalEntry, loadImmutableJournal } from ${JSON.stringify(JOURNAL_MODULE_URL)};
const [journalPath, encoded] = process.argv.slice(1);
const current = await loadImmutableJournal({ journalPath });
await appendImmutableJournalEntry({
  journalPath,
  canonicalBytes: Buffer.from(encoded, "base64"),
  expectedPredecessorAdmission: current.head,
});
`;
  return spawn(process.execPath, [
    "--input-type=module",
    "--eval",
    script,
    journalPath,
    canonicalBytes.toString("base64"),
  ], { stdio: ["ignore", "ignore", "pipe"] });
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    const stderr = [];
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({
      code,
      signal,
      stderr: Buffer.concat(stderr).toString("utf8"),
    }));
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function pollForBoundary(directory, boundary, exited) {
  for (let poll = 0; poll < 800; poll += 1) {
    const entries = await readdir(directory).catch(() => []);
    if (entries.some((entry) => boundary[1].test(entry))) return true;
    if (exited.value) return false;
    await delay(1);
  }
  return false;
}

async function killFreshWriterAtBoundary(boundary) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const root = await mkdtemp(path.join(tmpdir(), `agentmo-journal-sigkill-${boundary[0]}-`));
    const journalPath = path.join(root, "journal.json");
    const genesisBytes = Buffer.from("genesis\n", "utf8");
    const successorBytes = Buffer.concat([
      Buffer.from(`successor-${boundary[0]}-${attempt}\n`, "utf8"),
      Buffer.alloc(96 * 1024, "x"),
    ]);
    await appendImmutableJournalEntry({ journalPath, canonicalBytes: genesisBytes });
    const child = startWriter(journalPath, successorBytes);
    const exited = { value: false };
    child.once("exit", () => { exited.value = true; });
    const outcomePromise = waitForExit(child);
    const observed = await pollForBoundary(root, boundary, exited);
    const killed = observed && child.kill("SIGKILL");
    const outcome = await outcomePromise;
    if (killed && outcome.signal === "SIGKILL") {
      return { genesisBytes, journalPath, outcome, successorBytes };
    }
  }
  throw new Error(`external watcher did not interrupt ${boundary[0]}`);
}

async function replaceParentAtBoundary(boundary) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const root = await mkdtemp(path.join(tmpdir(), `agentmo-journal-retained-${boundary[0]}-`));
    const parent = path.join(root, "journal-parent");
    const retained = path.join(root, "retained-parent");
    const journalPath = path.join(parent, "journal.json");
    await mkdir(parent, { mode: 0o700 });
    await appendImmutableJournalEntry({
      journalPath,
      canonicalBytes: Buffer.from("genesis\n", "utf8"),
    });
    const child = startWriter(journalPath, Buffer.concat([
      Buffer.from(`retained-${boundary[0]}-${attempt}\n`, "utf8"),
      Buffer.alloc(96 * 1024, "y"),
    ]));
    const exited = { value: false };
    child.once("exit", () => { exited.value = true; });
    const outcomePromise = waitForExit(child);
    const observed = await pollForBoundary(parent, boundary, exited);
    let swap = null;
    if (observed) {
      swap = (async () => {
        await rename(parent, retained);
        await mkdir(parent, { mode: 0o700 });
      })();
    }
    const outcome = await outcomePromise;
    if (swap !== null) {
      await swap;
      return { outcome, parent, retained };
    }
  }
  throw new Error(`external watcher did not replace parent at ${boundary[0]}`);
}

describe("immutable journal v1 durability", () => {
  it("converges to one exact head after external fresh-process SIGKILL at each durable publication", async () => {
    for (const boundary of BOUNDARIES) {
      const { journalPath, outcome, successorBytes } = await killFreshWriterAtBoundary(boundary);
      assert.equal(outcome.signal, "SIGKILL", `${boundary[0]}: ${outcome.stderr}`);
      const restarted = await loadImmutableJournal({ journalPath });
      assert.equal([1, 2].includes(restarted.entries.length), true, boundary[0]);

      let expectedHeadDigest;
      if (restarted.entries.length === 1) {
        const recovered = await appendImmutableJournalEntry({
          journalPath,
          canonicalBytes: successorBytes,
          expectedPredecessorAdmission: restarted.head,
        });
        assert.equal(recovered.committed, true, boundary[0]);
        expectedHeadDigest = recovered.head.digest;
      } else {
        expectedHeadDigest = digestRawBytes(successorBytes);
        assert.equal(restarted.head.digest, expectedHeadDigest, boundary[0]);
      }

      const final = await loadImmutableJournal({ journalPath });
      assert.equal(final.entries.length, 2, boundary[0]);
      assert.equal(final.head.digest, expectedHeadDigest, boundary[0]);
      assert.equal(final.recoveryRequired, false, boundary[0]);
    }
  });

  it("keeps a live write in the retained parent when an external watcher replaces its pathname", async () => {
    for (const boundary of BOUNDARIES.slice(0, 2)) {
      const { parent, retained } = await replaceParentAtBoundary(boundary);
      assert.deepEqual(await readdir(parent), [], `${boundary[0]}: replacement must stay empty`);
      assert.ok((await readdir(retained)).length > 0, `${boundary[0]}: retained parent must hold effects`);
    }
  });

  it("rejects a UAT append capability on a non-UAT generic entry", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-journal-capability-scope-"));
    await assert.rejects(
      appendImmutableJournalEntry({
        journalPath: path.join(root, "journal.json"),
        canonicalBytes: Buffer.from("ordinary generic entry\n", "utf8"),
        authorityCapability: Object.freeze({}),
      }),
      (error) => error?.code === "AGENTMO_IMMUTABLE_JOURNAL_AUTHORITY_REJECTED",
    );
    assert.deepEqual(await readdir(root), []);
  });

  it("rejects callback injection instead of treating it as a test control", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-journal-no-callback-"));
    await assert.rejects(
      appendImmutableJournalEntry({
        journalPath: path.join(root, "journal.json"),
        canonicalBytes: Buffer.from("callback\n", "utf8"),
        onCheckpoint() {},
      }),
      (error) => error?.code === "AGENTMO_IMMUTABLE_JOURNAL_INVALID",
    );
    assert.deepEqual(await readdir(root), []);
  });
});
