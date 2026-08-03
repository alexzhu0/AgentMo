import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  readdir,
  rename,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { digestRawBytes } from "../src/artifact-admission.js";
import {
  abortAppendOnlyPrepared,
  appendAppendOnlyRecord,
  finalizeAppendOnlyStagedOutcome,
  readAppendOnlyAuthority,
} from "../src/builder-append-only-authority.js";
import { serializePersistableJson } from "../src/persistability.js";

const CHILD_ENTRY = path.resolve("test/helpers/append-only-child.js");
const PROCESS_TREE_INSPECTION_AVAILABLE = spawnSync(
  "/bin/ps",
  ["-axo", "pid=,ppid=,pgid="],
  { encoding: "utf8" },
).status === 0;

async function authorityFixture(
  prefix = "agentmo-append-authority-",
  relativeRoot = ".agentmo/append-only-test",
) {
  const projectRoot = await mkdtemp(path.join(tmpdir(), prefix));
  const storeRoot = path.join(projectRoot, ...relativeRoot.split("/"));
  return Object.freeze({
    namespace: "builder-test",
    projectRoot,
    relativeRoot,
    storeRoot,
  });
}

async function bootstrapSwapFixture() {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "agentmo-append-bootstrap-swap-"));
  const components = [
    ".agentmo",
    ...Array.from({ length: 12 }, (_, index) => `bootstrap-${String(index).padStart(2, "0")}`),
    "append-only-test",
  ];
  return Object.freeze({
    namespace: "builder-test",
    projectRoot,
    relativeRoot: components.join("/"),
    storeRoot: path.join(projectRoot, ...components),
    externalRoot: await mkdtemp(path.join(tmpdir(), "agentmo-append-external-")),
  });
}

function readRequest(fixture) {
  return {
    namespace: fixture.namespace,
    projectRoot: fixture.projectRoot,
    relativeRoot: fixture.relativeRoot,
  };
}

function appendRequest(fixture, idempotencyKey, payload, overrides = {}) {
  return {
    ...readRequest(fixture),
    idempotencyKey,
    payload,
    ...overrides,
  };
}

function longRelativeRoot(character, length) {
  const components = [];
  for (let remaining = length; remaining > 0; remaining -= 200) {
    components.push(character.repeat(Math.min(remaining, 200)));
  }
  return [".a", ...components].join("/");
}

function startChild(action, options, spawnOptions = {}) {
  return spawn(
    process.execPath,
    [CHILD_ENTRY, JSON.stringify({ action, options })],
    {
      ...spawnOptions,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
}

function startInputChild(action, options, spawnOptions = {}) {
  const child = spawn(
    process.execPath,
    [CHILD_ENTRY, "--stdin"],
    {
      ...spawnOptions,
      stdio: ["pipe", "ignore", "ignore", "ipc"],
    },
  );
  child.stdin.end(JSON.stringify({ action, options }));
  return child;
}

function startFileLimitedChild(action, options) {
  return spawn(
    "/bin/sh",
    [
      "-c",
      "ulimit -c 0; ulimit -f 1; exec \"$@\"",
      "agentmo-file-limited",
      process.execPath,
      CHILD_ENTRY,
      JSON.stringify({ action, options }),
    ],
    {
      cwd: options.projectRoot,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
}

async function stopChildAtCreatedDirectory(child, directory, name) {
  while (child.exitCode === null) {
    const stats = await lstat(path.join(directory, name), { bigint: true }).catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (stats?.isDirectory() && !stats.isSymbolicLink()) {
      if (!child.kill("SIGSTOP")) {
        throw new Error("append-only child completed before retained bootstrap boundary");
      }
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("append-only child closed before retained bootstrap boundary");
}

async function runChild(action, options) {
  const child = startChild(action, options);
  return collectChild(child);
}

async function collectChild(child, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    let terminal = null;
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("append-only child timed out"));
    }, timeoutMs);
    child.on("error", reject);
    child.on("message", (message) => {
      if (["result", "error"].includes(message?.type)) terminal = message;
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({ ...terminal, code, signal });
    });
  });
}

async function killChildOnEntry(action, options, directory, predicate) {
  const child = startChild(action, options);
  const terminalPromise = collectChild(child);
  const deadline = Date.now() + 15_000;
  let matched = false;
  while (Date.now() < deadline && child.exitCode === null) {
    const names = await readdir(directory).catch((error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    });
    let observedCompleteEntry = false;
    for (const name of names.filter((candidate) => predicate(candidate))) {
      const entryPath = path.join(directory, name);
      const stats = await lstat(entryPath);
      if (stats.isSymbolicLink()) {
        observedCompleteEntry = true;
        break;
      }
      if (!stats.isFile()) continue;
      try {
        const bytes = await readFile(entryPath);
        if (bytes.at(-1) === 0x0a) {
          JSON.parse(bytes.toString("utf8"));
          observedCompleteEntry = true;
          break;
        }
      } catch {
        // The retained writer still owns an incomplete JSON prefix.
      }
    }
    if (observedCompleteEntry) {
      matched = true;
      child.kill("SIGSTOP");
      await new Promise((resolve) => setTimeout(resolve, 10));
      child.kill("SIGKILL");
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  const terminal = await terminalPromise;
  assert.equal(matched, true, `append-only child completed before observed boundary: ${terminal.type ?? "none"}`);
  assert.equal(terminal.code, null);
  assert.equal(terminal.signal, "SIGKILL");
}

function processRows() {
  const result = spawnSync("/bin/ps", ["-axo", "pid=,ppid=,pgid="], {
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error("could not inspect append-only process tree");
  return result.stdout.trim().split("\n").map((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/u.exec(line);
    return match === null ? null : {
      pid: Number.parseInt(match[1], 10),
      ppid: Number.parseInt(match[2], 10),
      pgid: Number.parseInt(match[3], 10),
    };
  }).filter((row) => row !== null);
}

async function killSelectedRecordEffectWriter(fixture, request) {
  const child = startInputChild("append", request, { detached: true });
  const terminalPromise = collectChild(child, 30_000);
  const entries = path.join(fixture.storeRoot, "entries");
  const deadline = Date.now() + 30_000;
  let killed = null;
  while (Date.now() < deadline && child.exitCode === null) {
    const names = await readdir(entries).catch((error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    });
    const stageName = names.find((name) => name.endsWith(".record.stage.json"));
    if (stageName === undefined) {
      await new Promise((resolve) => setImmediate(resolve));
      continue;
    }
    const selectionName = `${stageName}.selection`;
    if (!names.includes(selectionName)) {
      await new Promise((resolve) => setImmediate(resolve));
      continue;
    }
    const target = await readlink(path.join(entries, selectionName));
    const selectedLength = Number.parseInt(target.split(".").at(-1), 10);
    const stagePath = path.join(entries, stageName);
    const stageStats = await lstat(stagePath, { bigint: true }).catch(() => null);
    if (stageStats === null
      || stageStats.size <= 0n
      || stageStats.size >= BigInt(selectedLength)) {
      await new Promise((resolve) => setImmediate(resolve));
      continue;
    }
    const candidates = processRows().filter(
      (row) => row.ppid === child.pid && row.pgid === child.pid,
    );
    if (candidates.length !== 1) {
      await new Promise((resolve) => setImmediate(resolve));
      continue;
    }
    const effectPid = candidates[0].pid;
    try {
      process.kill(effectPid, "SIGSTOP");
    } catch (error) {
      if (error?.code === "ESRCH") continue;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    const retained = processRows().some(
      (row) => row.pid === effectPid && row.ppid === child.pid && row.pgid === child.pid,
    );
    const stoppedStats = await lstat(stagePath, { bigint: true }).catch(() => null);
    if (!retained
      || stoppedStats === null
      || stoppedStats.size <= 0n
      || stoppedStats.size >= BigInt(selectedLength)) {
      try {
        process.kill(effectPid, "SIGCONT");
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
      continue;
    }
    process.kill(effectPid, "SIGKILL");
    killed = Object.freeze({
      effectPid,
      selectedLength,
      selectionName,
      stageName,
      stagePath,
      stoppedSize: Number(stoppedStats.size),
    });
    process.kill(child.pid, "SIGKILL");
    break;
  }
  const terminal = await terminalPromise;
  assert.notEqual(killed, null, `selected record writer escaped: ${terminal.type ?? "none"}`);
  assert.equal(terminal.code, null);
  assert.equal(terminal.signal, "SIGKILL");
  return killed;
}

async function crashAtClaim(fixture, request) {
  await killChildOnEntry(
    "append",
    request,
    path.join(fixture.storeRoot, "claims"),
    (name) => /^\d{16}\.json$/u.test(name),
  );
}

async function crashAtRecordStage(fixture, request) {
  await killChildOnEntry(
    "append",
    request,
    path.join(fixture.storeRoot, "entries"),
    (name) => name.endsWith(".record.stage.json"),
  );
}

async function crashAtPreparedFinal(fixture, request) {
  await killChildOnEntry(
    "append",
    request,
    path.join(fixture.storeRoot, "prepared"),
    (name) => /^\d{16}\.json$/u.test(name),
  );
}

async function crashAtPreparedStage(fixture, request) {
  await killChildOnEntry(
    "append",
    request,
    path.join(fixture.storeRoot, "prepared"),
    (name) => name.endsWith(".prepared.stage.json"),
  );
}

async function crashAtOutcomeStage(fixture, request) {
  await killChildOnEntry(
    "append",
    request,
    path.join(fixture.storeRoot, "outcomes"),
    (name) => name.endsWith(".outcome.stage.json"),
  );
}

async function prepare(fixture, idempotencyKey, payload) {
  const request = appendRequest(fixture, idempotencyKey, payload);
  await crashAtPreparedFinal(fixture, request);
  const state = await readAppendOnlyAuthority(readRequest(fixture));
  assert.ok(state.recoveryRequired);
  assert.notEqual(state.recoveryRequired.preparedBytes, null);
  return { request, state };
}

async function snapshotTree(root) {
  const rows = [];
  const visit = async (absolute, relative = "") => {
    const stats = await lstat(absolute, { bigint: true });
    rows.push({
      path: relative || ".",
      kind: stats.isDirectory() ? "directory" : stats.isFile() ? "file" : "other",
      device: stats.dev.toString(10),
      inode: stats.ino.toString(10),
      links: stats.nlink.toString(10),
      mode: (stats.mode & 0o777n).toString(8),
      size: stats.size.toString(10),
    });
    if (!stats.isDirectory()) return;
    for (const name of (await readdir(absolute)).sort()) {
      await visit(path.join(absolute, name), relative ? `${relative}/${name}` : name);
    }
  };
  await visit(root);
  return rows;
}

async function evidenceNameFor(directory, fixture) {
  const matches = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const name = entry.name;
    const value = JSON.parse(await readFile(path.join(directory, name), "utf8"));
    if (value.namespace === fixture.namespace
      && value.relativeRoot === fixture.relativeRoot) {
      matches.push(name);
    }
  }
  assert.equal(matches.length, 1);
  return matches[0];
}

async function selectedShortFile(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  for (const entry of entries) {
    if (!entry.isSymbolicLink() || !entry.name.endsWith(".selection")) continue;
    const target = await readlink(path.join(directory, entry.name));
    const match = /^am-selected-file-v1\.([a-f0-9]{64})\.([1-9]\d{0,6})$/u.exec(target);
    if (match === null) continue;
    const selectedLength = Number.parseInt(match[2], 10);
    const filePath = path.join(directory, entry.name.slice(0, -".selection".length));
    const stats = await lstat(filePath, { bigint: true }).catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (stats === null || !stats.isFile() || stats.size >= BigInt(selectedLength)) continue;
    return Object.freeze({
      bytes: await readFile(filePath),
      filePath,
      selectedDigest: `sha256:${match[1]}`,
      selectedLength,
      stats,
    });
  }
  return null;
}

async function assertSelectedShortWriteResumed(shortWrite) {
  const bytes = await readFile(shortWrite.filePath);
  const stats = await lstat(shortWrite.filePath, { bigint: true });
  assert.equal(bytes.length, shortWrite.selectedLength);
  assert.deepEqual(bytes.subarray(0, shortWrite.bytes.length), shortWrite.bytes);
  assert.equal(stats.dev, shortWrite.stats.dev);
  assert.equal(stats.ino, shortWrite.stats.ino);
  assert.equal(digestRawBytes(bytes), shortWrite.selectedDigest);
}

function assertChildResult(envelope) {
  assert.equal(envelope.type, "result", envelope.error?.code);
  assert.equal(envelope.code, 0);
  assert.equal(envelope.signal, null);
  return envelope.value;
}

describe("append-only authority without production fault controls", () => {
  it("commits, replays idempotently, and rejects stale heads and unknown keys", async () => {
    const fixture = await authorityFixture();
    const initial = await readAppendOnlyAuthority(readRequest(fixture));
    const request = appendRequest(
      fixture,
      "commit-1",
      { kind: "commit", ordinal: 1 },
      { expectedHeadDigest: initial.headDigest },
    );
    const first = await appendAppendOnlyRecord(request);
    const stable = await snapshotTree(fixture.storeRoot);
    const replay = await appendAppendOnlyRecord(request);
    assert.equal(first.status, "committed");
    assert.equal(first.changed, true);
    assert.equal(replay.changed, false);
    assert.equal(replay.digest, first.digest);
    assert.deepEqual(await snapshotTree(fixture.storeRoot), stable);

    await assert.rejects(
      appendAppendOnlyRecord(appendRequest(
        fixture,
        "commit-2",
        { kind: "commit", ordinal: 2 },
        { expectedHeadDigest: initial.headDigest },
      )),
      (error) => error?.code === "AGENTMO_APPEND_ONLY_HEAD_CHANGED",
    );
    for (const key of [
      "__testOnlyStopAfter",
      "__testOnlyDirectoryCheckpoint",
      "__testOnlyCrashCheckpoint",
    ]) {
      await assert.rejects(
        appendAppendOnlyRecord({ ...appendRequest(fixture, `unknown-${key}`, { key }), [key]: "claim" }),
        (error) => error?.code === "AGENTMO_APPEND_ONLY_REQUEST_REJECTED",
      );
    }
  });

  it("admits exactly one writer for a shared expected head without a callback barrier", async () => {
    const fixture = await authorityFixture("agentmo-append-concurrent-");
    const initial = await readAppendOnlyAuthority(readRequest(fixture));
    const settled = await Promise.all([
      runChild("append", appendRequest(
        fixture,
        "concurrent-a",
        { kind: "concurrent", writer: "a" },
        { expectedHeadDigest: initial.headDigest },
      )),
      runChild("append", appendRequest(
        fixture,
        "concurrent-b",
        { kind: "concurrent", writer: "b" },
        { expectedHeadDigest: initial.headDigest },
      )),
    ]);
    assert.equal(settled.filter((item) => item.type === "result").length, 1);
    assert.equal(settled.filter((item) => item.type === "error").length, 1);
    const state = await readAppendOnlyAuthority(readRequest(fixture));
    assert.equal(state.records.length, 1);
    assert.equal(state.recoveryRequired, null);
  });

  it("anchors the authority root outside the store and never recreates missing or replaced history", async () => {
    const fixture = await authorityFixture("agentmo-append-lineage-root-");
    const initial = await readAppendOnlyAuthority(readRequest(fixture));
    assert.equal(initial.status, "empty");
    assert.equal(
      await lstat(path.join(fixture.projectRoot, ".agentmo-append-only-lineage"))
        .catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error)),
      null,
    );

    await appendAppendOnlyRecord(appendRequest(fixture, "lineage-1", {
      kind: "lineage-root",
    }));
    const displaced = `${fixture.storeRoot}-displaced`;
    await rename(fixture.storeRoot, displaced);
    for (const operation of [
      () => readAppendOnlyAuthority(readRequest(fixture)),
      () => appendAppendOnlyRecord(appendRequest(fixture, "lineage-2", {
        kind: "must-not-recreate",
      })),
    ]) {
      await assert.rejects(
        operation(),
        (error) => error?.code === "AGENTMO_APPEND_ONLY_LINEAGE_ROOT_MISSING",
      );
    }
    assert.equal(
      await lstat(fixture.storeRoot)
        .catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error)),
      null,
    );

    await mkdir(fixture.storeRoot, { mode: 0o700 });
    for (const name of ["claims", "entries", "outcomes", "prepared", "stages"]) {
      await mkdir(path.join(fixture.storeRoot, name), { mode: 0o700 });
    }
    const replacement = await snapshotTree(fixture.storeRoot);
    for (const operation of [
      () => readAppendOnlyAuthority(readRequest(fixture)),
      () => appendAppendOnlyRecord(appendRequest(fixture, "lineage-3", {
        kind: "must-not-adopt",
      })),
    ]) {
      await assert.rejects(
        operation(),
        (error) => error?.code === "AGENTMO_APPEND_ONLY_LINEAGE_ROOT_CHANGED",
      );
    }
    assert.deepEqual(await snapshotTree(fixture.storeRoot), replacement);
  });

  it("does not reset one authority when its root, lineage anchor, and provision disappear", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "agentmo-append-shared-lineage-"));
    const first = Object.freeze({
      namespace: "builder-first",
      projectRoot,
      relativeRoot: ".agentmo/first-authority",
      storeRoot: path.join(projectRoot, ".agentmo", "first-authority"),
    });
    const second = Object.freeze({
      namespace: "builder-second",
      projectRoot,
      relativeRoot: ".agentmo/second-authority",
      storeRoot: path.join(projectRoot, ".agentmo", "second-authority"),
    });
    await appendAppendOnlyRecord(appendRequest(first, "first-1", { authority: "first" }));
    await appendAppendOnlyRecord(appendRequest(second, "second-1", { authority: "second" }));

    const lineageDirectory = path.join(projectRoot, ".agentmo-append-only-lineage");
    const provisionDirectory = path.join(projectRoot, ".agentmo-append-only-provisioning");
    const witnessDirectory = path.join(projectRoot, ".agentmo-root-witness");
    const firstAnchorName = await evidenceNameFor(lineageDirectory, first);
    const firstProvisionName = await evidenceNameFor(provisionDirectory, first);
    const firstWitnessName = await evidenceNameFor(witnessDirectory, first);
    const secondAnchorName = await evidenceNameFor(lineageDirectory, second);
    assert.equal(firstAnchorName, firstProvisionName);
    assert.notEqual(firstAnchorName, secondAnchorName);

    await rename(first.storeRoot, `${first.storeRoot}-displaced`);
    await rename(
      path.join(lineageDirectory, firstAnchorName),
      path.join(projectRoot, "first-lineage-anchor-displaced.json"),
    );
    await rename(
      path.join(lineageDirectory, `${firstAnchorName}.selection`),
      path.join(projectRoot, "first-lineage-anchor-selection-displaced"),
    );
    await rename(
      path.join(provisionDirectory, firstProvisionName),
      path.join(projectRoot, "first-lineage-provision-displaced.json"),
    );
    await rename(
      path.join(provisionDirectory, `${firstProvisionName}.selection`),
      path.join(projectRoot, "first-lineage-provision-selection-displaced"),
    );
    assert.ok(await lstat(path.join(witnessDirectory, firstWitnessName)));
    assert.ok(await lstat(path.join(lineageDirectory, secondAnchorName)));

    for (const operation of [
      () => readAppendOnlyAuthority(readRequest(first)),
      () => appendAppendOnlyRecord(appendRequest(first, "first-2", {
        authority: "must-not-reset",
      })),
    ]) {
      await assert.rejects(
        operation(),
        (error) => error?.code === "AGENTMO_APPEND_ONLY_LINEAGE_ANCHOR_MISSING",
      );
    }
    assert.equal(
      await lstat(first.storeRoot)
        .catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error)),
      null,
    );
    assert.equal(
      await lstat(path.join(lineageDirectory, firstAnchorName))
        .catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error)),
      null,
    );
    const unaffected = await readAppendOnlyAuthority(readRequest(second));
    assert.equal(unaffected.records.length, 1);
    assert.equal(unaffected.records[0].payload.authority, "second");
  });

  it("requires the independently admitted provisioning witness on normal reads", async () => {
    const fixture = await authorityFixture("agentmo-append-provision-witness-");
    await appendAppendOnlyRecord(appendRequest(fixture, "provision-1", {
      kind: "provision-witness",
    }));
    const provisionDirectory = path.join(
      fixture.projectRoot,
      ".agentmo-append-only-provisioning",
    );
    const provisionName = await evidenceNameFor(provisionDirectory, fixture);
    await rename(
      path.join(provisionDirectory, provisionName),
      path.join(fixture.projectRoot, "lineage-provision-displaced.json"),
    );
    await rename(
      path.join(provisionDirectory, `${provisionName}.selection`),
      path.join(fixture.projectRoot, "lineage-provision-selection-displaced"),
    );
    await assert.rejects(
      readAppendOnlyAuthority(readRequest(fixture)),
      (error) => error?.code === "AGENTMO_APPEND_ONLY_LINEAGE_PROVISION_MISSING",
    );
  });

  it("does not reconstruct a missing directory inside an anchored authority", async () => {
    const fixture = await authorityFixture("agentmo-append-lineage-layout-");
    await appendAppendOnlyRecord(appendRequest(fixture, "lineage-layout-1", {
      kind: "lineage-layout",
    }));
    const entries = path.join(fixture.storeRoot, "entries");
    await rename(entries, `${entries}-displaced`);
    for (const operation of [
      () => readAppendOnlyAuthority(readRequest(fixture)),
      () => appendAppendOnlyRecord(appendRequest(fixture, "lineage-layout-2", {
        kind: "must-not-reconstruct",
      })),
    ]) {
      await assert.rejects(
        operation(),
        (error) => error?.code === "AGENTMO_APPEND_ONLY_LAYOUT_INCOMPLETE",
      );
    }
    assert.equal(
      await lstat(entries)
        .catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error)),
      null,
    );
  });

  it("recovers a real SIGKILL claim-only prefix in a fresh process", async () => {
    const fixture = await authorityFixture("agentmo-append-claim-crash-");
    const request = appendRequest(fixture, "claim-crash", { kind: "claim-crash" });
    await crashAtClaim(fixture, request);
    const prefix = await readAppendOnlyAuthority(readRequest(fixture));
    assert.ok(prefix.recoveryRequired);
    assert.equal(prefix.recoveryRequired.recordStagePresent, false);

    const recovered = assertChildResult(await runChild("append", request));
    assert.equal(recovered.status, "committed");
    const stable = await snapshotTree(fixture.storeRoot);
    const replay = assertChildResult(await runChild("append", request));
    assert.equal(replay.changed, false);
    assert.deepEqual(await snapshotTree(fixture.storeRoot), stable);
  });

  it("aborts a real SIGKILL record-stage-only prefix without inventing a record final", async () => {
    const fixture = await authorityFixture("agentmo-append-record-stage-crash-");
    const request = appendRequest(fixture, "record-stage-crash", { kind: "record-stage-crash" });
    await crashAtRecordStage(fixture, request);
    const prefix = await readAppendOnlyAuthority(readRequest(fixture));
    assert.ok(prefix.recoveryRequired);
    assert.equal(prefix.recoveryRequired.recordStagePresent, true);
    assert.equal(prefix.recoveryRequired.preparedBytes, null);

    const aborted = await abortAppendOnlyPrepared({
      ...readRequest(fixture),
      expectedPreparedRecordDigest: prefix.recoveryRequired.recordDigest,
      reason: "OPERATOR_CANCELLED",
    });
    assert.equal(aborted.status, "aborted");
    const state = await readAppendOnlyAuthority(readRequest(fixture));
    assert.equal(state.records.length, 0);
    assert.equal(state.aborted.length, 1);
    assert.equal(state.recoveryRequired, null);
    assert.equal(
      (await readdir(path.join(fixture.storeRoot, "entries")))
        .some((name) => /^\d{16}\.[a-f0-9]{64}\.json$/u.test(name)),
      false,
    );
  });

  it("aborts a real SIGKILL prepared-stage-only prefix without linking either final", async () => {
    const fixture = await authorityFixture("agentmo-append-prepared-stage-crash-");
    const request = appendRequest(fixture, "prepared-stage-crash", { kind: "prepared-stage-crash" });
    await crashAtPreparedStage(fixture, request);
    const prefix = await readAppendOnlyAuthority(readRequest(fixture));
    assert.ok(prefix.recoveryRequired);
    assert.equal(prefix.recoveryRequired.recordStagePresent, true);
    assert.equal(prefix.recoveryRequired.recordLinked, false);
    assert.notEqual(prefix.recoveryRequired.preparedBytes, null);
    assert.equal(
      (await readdir(path.join(fixture.storeRoot, "prepared")))
        .some((name) => /^\d{16}\.json$/u.test(name)),
      false,
    );

    const aborted = await abortAppendOnlyPrepared({
      ...readRequest(fixture),
      expectedPreparedRecordDigest: prefix.recoveryRequired.recordDigest,
      reason: "OPERATOR_CANCELLED",
    });
    assert.equal(aborted.status, "aborted");
    const state = await readAppendOnlyAuthority(readRequest(fixture));
    assert.equal(state.records.length, 0);
    assert.equal(state.aborted.length, 1);
    assert.equal(state.recoveryRequired, null);
    assert.equal(
      (await readdir(path.join(fixture.storeRoot, "prepared")))
        .some((name) => /^\d{16}\.json$/u.test(name)),
      false,
    );
    assert.equal(
      (await readdir(path.join(fixture.storeRoot, "entries")))
        .some((name) => /^\d{16}\.[a-f0-9]{64}\.json$/u.test(name)),
      false,
    );
  });

  it("recovers a real prepared-prefix crash and rejects a same-byte source inode swap", async () => {
    const exactFixture = await authorityFixture("agentmo-append-prepared-crash-");
    const exact = await prepare(exactFixture, "prepared-exact", { kind: "prepared-exact" });
    const recovered = await appendAppendOnlyRecord(exact.request);
    assert.equal(recovered.status, "committed");
    assert.equal((await readAppendOnlyAuthority(readRequest(exactFixture))).records.length, 1);

    const swappedFixture = await authorityFixture("agentmo-append-source-swap-");
    const swapped = await prepare(swappedFixture, "prepared-swapped", { kind: "prepared-swapped" });
    const stagePath = path.join(
      swappedFixture.storeRoot,
      swapped.state.recoveryRequired.recordStagePath,
    );
    const displaced = `${stagePath}.displaced`;
    const bytes = await readFile(stagePath);
    await rename(stagePath, displaced);
    await writeFile(stagePath, bytes, { flag: "wx", mode: 0o600 });
    const before = await snapshotTree(swappedFixture.storeRoot);
    await assert.rejects(
      appendAppendOnlyRecord(swapped.request),
      (error) => /^AGENTMO_APPEND_ONLY_/u.test(error?.code ?? ""),
    );
    assert.deepEqual(await snapshotTree(swappedFixture.storeRoot), before);
  });

  it("recovers an abort publisher killed after its outcome final becomes visible", async () => {
    const fixture = await authorityFixture("agentmo-append-abort-crash-");
    const prepared = await prepare(fixture, "abort-crash", { kind: "abort-crash" });
    const request = {
      ...readRequest(fixture),
      expectedPreparedRecordDigest: prepared.state.recoveryRequired.recordDigest,
      reason: "OPERATOR_CANCELLED",
    };
    await killChildOnEntry(
      "abort",
      request,
      path.join(fixture.storeRoot, "outcomes"),
      (name) => /^\d{16}\.json$/u.test(name),
    );
    const recovered = assertChildResult(await runChild("abort", request));
    assert.equal(recovered.status, "aborted");
    const stable = await snapshotTree(fixture.storeRoot);
    const replay = assertChildResult(await runChild("abort", request));
    assert.equal(replay.changed, false);
    assert.deepEqual(await snapshotTree(fixture.storeRoot), stable);
  });

  it("links an exact staged abort outcome after real SIGKILL", async () => {
    const fixture = await authorityFixture("agentmo-append-abort-outcome-stage-crash-");
    const prepared = await prepare(fixture, "abort-outcome-stage-crash", {
      kind: "abort-outcome-stage-crash",
    });
    const request = {
      ...readRequest(fixture),
      expectedPreparedRecordDigest: prepared.state.recoveryRequired.recordDigest,
      reason: "OPERATOR_CANCELLED",
    };
    await killChildOnEntry(
      "abort",
      request,
      path.join(fixture.storeRoot, "outcomes"),
      (name) => name.endsWith(".outcome.stage.json"),
    );
    const prefix = await readAppendOnlyAuthority(readRequest(fixture));
    assert.ok(prefix.recoveryRequired?.stagedOutcome);

    const finalized = await finalizeAppendOnlyStagedOutcome({
      ...readRequest(fixture),
      expectedHeadDigest: prefix.headDigest,
      expectedPreparedRecordDigest: prefix.recoveryRequired.recordDigest,
      expectedStagedOutcomeDigest: digestRawBytes(prefix.recoveryRequired.stagedOutcome.bytes),
    });
    assert.equal(finalized.status, "aborted");
    const state = await readAppendOnlyAuthority(readRequest(fixture));
    assert.equal(state.recoveryRequired, null);
    assert.equal(state.records.length, 0);
    assert.equal(state.aborted.length, 1);
  });

  it("resumes the same selected record inode after SIGSTOP and SIGKILL crash its real writer and owner", {
    skip: !PROCESS_TREE_INSPECTION_AVAILABLE,
  }, async () => {
    const fixture = await authorityFixture("agentmo-append-partial-record-writer-");
    const request = appendRequest(fixture, "partial-record-writer", {
      kind: "partial-record-writer",
      filler: "r".repeat(768 * 1024),
    });
    const killed = await killSelectedRecordEffectWriter(fixture, request);
    const prefixBytes = await readFile(killed.stagePath);
    const prefixStats = await lstat(killed.stagePath, { bigint: true });
    assert.equal(prefixBytes.length, killed.stoppedSize);
    assert.ok(prefixBytes.length > 0);
    assert.ok(prefixBytes.length < killed.selectedLength);
    assert.equal(
      (await readdir(path.join(fixture.storeRoot, "entries")))
        .some((name) => /^\d{16}\.[a-f0-9]{64}\.json$/u.test(name)),
      false,
    );

    const interrupted = await readAppendOnlyAuthority(readRequest(fixture));
    assert.equal(interrupted.records.length, 0);
    assert.ok(interrupted.recoveryRequired);
    assert.equal(interrupted.recoveryRequired.stagedOutcome, null);
    assert.equal(
      interrupted.recoveryRequired.incompleteRecordStage.selectedLength,
      killed.selectedLength,
    );
    assert.deepEqual(
      interrupted.recoveryRequired.incompleteRecordStage.bytes,
      prefixBytes,
    );

    const recovered = await appendAppendOnlyRecord(request);
    assert.equal(recovered.status, "committed");
    const completedBytes = await readFile(killed.stagePath);
    const completedStats = await lstat(killed.stagePath, { bigint: true });
    assert.deepEqual(completedBytes.subarray(0, prefixBytes.length), prefixBytes);
    assert.equal(completedStats.dev, prefixStats.dev);
    assert.equal(completedStats.ino, prefixStats.ino);
    assert.equal(completedStats.nlink, 2n);
    assert.equal(completedBytes.length, killed.selectedLength);
    const stable = await snapshotTree(fixture.storeRoot);
    const replay = await appendAppendOnlyRecord(request);
    assert.equal(replay.changed, false);
    assert.deepEqual(await snapshotTree(fixture.storeRoot), stable);
  });

  it("resumes a durably selected short write without replacing or rewriting its prefix", async () => {
    const fixture = await authorityFixture("agentmo-append-short-outcome-write-");
    const prepared = await prepare(fixture, "short-outcome-write", {
      kind: "short-outcome-write",
    });
    const limited = await collectChild(startFileLimitedChild("append", prepared.request));
    assert.equal(limited.type, "error");
    assert.equal(limited.code, 1);

    const interrupted = await readAppendOnlyAuthority(readRequest(fixture));
    assert.ok(interrupted.recoveryRequired);
    assert.equal(interrupted.recoveryRequired.stagedOutcome, null);
    assert.ok(interrupted.recoveryRequired.incompleteStagedOutcome);
    assert.ok(interrupted.recoveryRequired.outcomeSelection);
    const operationId = interrupted.recoveryRequired.operationId;
    const stagePath = path.join(
      fixture.storeRoot,
      "outcomes",
      `${operationId}.outcome.stage.json`,
    );
    const prefixBytes = await readFile(stagePath);
    const prefixStats = await lstat(stagePath, { bigint: true });
    assert.ok(prefixBytes.length > 0);
    assert.ok(prefixBytes.length < interrupted.recoveryRequired.outcomeSelection.length);
    assert.deepEqual(
      interrupted.recoveryRequired.incompleteStagedOutcome.bytes,
      prefixBytes,
    );

    const recovered = await appendAppendOnlyRecord(prepared.request);
    assert.equal(recovered.status, "committed");
    const completedBytes = await readFile(stagePath);
    const completedStats = await lstat(stagePath, { bigint: true });
    assert.deepEqual(completedBytes.subarray(0, prefixBytes.length), prefixBytes);
    assert.equal(completedStats.dev, prefixStats.dev);
    assert.equal(completedStats.ino, prefixStats.ino);
    assert.equal(completedStats.nlink, 2n);
    assert.equal(
      completedBytes.length,
      interrupted.recoveryRequired.outcomeSelection.length,
    );
  });

  it("resumes selected lineage, provisioning, and root-witness prefixes in place", async () => {
    for (const scenario of [
      {
        label: "lineage",
        character: "a",
        relativeRootLengths: process.platform === "linux" ? [128, 640] : [640, 128],
        directory: ".agentmo-append-only-lineage",
        readError: "AGENTMO_APPEND_ONLY_LINEAGE_ANCHOR_INCOMPLETE",
      },
      {
        label: "provisioning",
        character: "p",
        relativeRootLengths: process.platform === "linux" ? [24, 535] : [535, 24],
        directory: ".agentmo-append-only-provisioning",
        readError: "AGENTMO_APPEND_ONLY_LINEAGE_PROVISION_INCOMPLETE",
      },
      {
        label: "root-witness",
        character: "w",
        relativeRootLengths: process.platform === "linux" ? [0, 440] : [440, 0],
        directory: ".agentmo-root-witness",
        readError: "AGENTMO_APPEND_ONLY_ROOT_WITNESS_INCOMPLETE",
      },
    ]) {
      const lengths = [];
      for (const center of scenario.relativeRootLengths) {
        lengths.push(center);
        for (let delta = 8; delta <= 128; delta += 8) {
          lengths.push(center - delta);
          lengths.push(center + delta);
        }
      }
      let selected = null;
      for (const length of [...new Set(lengths.filter((value) => value >= 0))]) {
        const fixture = await authorityFixture(
          `agentmo-append-short-${scenario.label}-`,
          longRelativeRoot(scenario.character, length),
        );
        const request = appendRequest(fixture, `short-${scenario.label}`, {
          kind: scenario.label,
        });
        const limited = await collectChild(startFileLimitedChild("append", request));
        assert.equal(limited.type, "error", scenario.label);
        assert.equal(limited.code, 1, scenario.label);
        const shortWrite = await selectedShortFile(
          path.join(fixture.projectRoot, scenario.directory),
        );
        if (shortWrite !== null) {
          selected = { fixture, request, shortWrite };
          break;
        }
      }
      assert.ok(selected, scenario.label);
      const { fixture, request, shortWrite } = selected;
      assert.ok(shortWrite.bytes.length > 0, scenario.label);
      assert.ok(shortWrite.bytes.length < shortWrite.selectedLength, scenario.label);
      await assert.rejects(
        readAppendOnlyAuthority(readRequest(fixture)),
        (error) => error?.code === scenario.readError,
        scenario.label,
      );

      const recovered = await appendAppendOnlyRecord(request);
      assert.equal(recovered.status, "committed", scenario.label);
      await assertSelectedShortWriteResumed(shortWrite);
      assert.equal(
        (await readAppendOnlyAuthority(readRequest(fixture))).records.length,
        1,
        scenario.label,
      );
    }
  });

  it("makes selected record and prepared prefixes exact-retry-only and resumes their inode", async () => {
    for (const scenario of [
      {
        label: "record",
        payload: { kind: "record-prefix", filler: "r".repeat(800) },
        directory: "entries",
        recoveryField: "incompleteRecordStage",
      },
      {
        label: "prepared",
        payload: { kind: "prepared-prefix" },
        directory: "prepared",
        recoveryField: "incompletePreparedStage",
      },
    ]) {
      const fixture = await authorityFixture(`agentmo-append-short-${scenario.label}-`);
      await appendAppendOnlyRecord(appendRequest(fixture, `${scenario.label}-seed`, {
        kind: "seed",
      }));
      const request = appendRequest(
        fixture,
        `${scenario.label}-short`,
        scenario.payload,
      );
      const limited = await collectChild(startFileLimitedChild("append", request));
      assert.equal(limited.type, "error", scenario.label);
      assert.equal(limited.code, 1, scenario.label);
      const shortWrite = await selectedShortFile(
        path.join(fixture.storeRoot, scenario.directory),
      );
      assert.ok(shortWrite, scenario.label);
      assert.ok(shortWrite.bytes.length > 0, scenario.label);

      const interrupted = await readAppendOnlyAuthority(readRequest(fixture));
      const incomplete = interrupted.recoveryRequired?.[scenario.recoveryField];
      assert.ok(incomplete, scenario.label);
      assert.equal(incomplete.selectedDigest, shortWrite.selectedDigest, scenario.label);
      assert.equal(incomplete.selectedLength, shortWrite.selectedLength, scenario.label);
      assert.deepEqual(incomplete.bytes, shortWrite.bytes, scenario.label);
      await assert.rejects(
        lstat(path.join(fixture.storeRoot, interrupted.recoveryRequired.recordPath)),
        (error) => error?.code === "ENOENT",
        scenario.label,
      );

      const beforeAbort = await snapshotTree(fixture.storeRoot);
      await assert.rejects(
        abortAppendOnlyPrepared({
          ...readRequest(fixture),
          expectedPreparedRecordDigest: interrupted.recoveryRequired.recordDigest,
          reason: "OPERATOR_CANCELLED",
        }),
        (error) => error?.code === "AGENTMO_APPEND_ONLY_SELECTED_WRITE_RECOVERY_REQUIRED",
        scenario.label,
      );
      assert.deepEqual(await snapshotTree(fixture.storeRoot), beforeAbort, scenario.label);

      const recovered = await appendAppendOnlyRecord(request);
      assert.equal(recovered.status, "committed", scenario.label);
      await assertSelectedShortWriteResumed(shortWrite);
      assert.equal(
        (await readAppendOnlyAuthority(readRequest(fixture))).records.length,
        2,
        scenario.label,
      );
    }
  });

  it("finalizes each semantically admitted partial abort stage", async () => {
    for (const [label, crash] of [
      ["claim", crashAtClaim],
      ["record-stage", crashAtRecordStage],
      ["prepared-stage", crashAtPreparedStage],
    ]) {
      const fixture = await authorityFixture(`agentmo-append-${label}-outcome-stage-`);
      const request = appendRequest(fixture, `${label}-outcome-stage`, { kind: label });
      await crash(fixture, request);
      const prepared = await readAppendOnlyAuthority(readRequest(fixture));
      const abortRequest = {
        ...readRequest(fixture),
        expectedPreparedRecordDigest: prepared.recoveryRequired.recordDigest,
        reason: "OPERATOR_CANCELLED",
      };
      await killChildOnEntry(
        "abort",
        abortRequest,
        path.join(fixture.storeRoot, "outcomes"),
        (name) => name.endsWith(".outcome.stage.json"),
      );
      const staged = await readAppendOnlyAuthority(readRequest(fixture));
      assert.ok(staged.recoveryRequired?.stagedOutcome, label);
      const finalized = await finalizeAppendOnlyStagedOutcome({
        ...readRequest(fixture),
        expectedHeadDigest: staged.headDigest,
        expectedPreparedRecordDigest: staged.recoveryRequired.recordDigest,
        expectedStagedOutcomeDigest: digestRawBytes(staged.recoveryRequired.stagedOutcome.bytes),
      });
      assert.equal(finalized.status, "aborted", label);
      const state = await readAppendOnlyAuthority(readRequest(fixture));
      assert.equal(state.recoveryRequired, null, label);
      assert.equal(state.aborted.length, 1, label);
    }
  });

  it("links only the exact admitted staged outcome after real SIGKILL", async () => {
    const fixture = await authorityFixture("agentmo-append-outcome-stage-crash-");
    const request = appendRequest(fixture, "outcome-stage-crash", { kind: "outcome-stage-crash" });
    await crashAtOutcomeStage(fixture, request);
    const prefix = await readAppendOnlyAuthority(readRequest(fixture));
    assert.ok(prefix.recoveryRequired?.stagedOutcome);
    const before = await snapshotTree(fixture.storeRoot);

    await assert.rejects(
      finalizeAppendOnlyStagedOutcome({
        ...readRequest(fixture),
        expectedHeadDigest: prefix.headDigest,
        expectedPreparedRecordDigest: prefix.recoveryRequired.recordDigest,
        expectedStagedOutcomeDigest: `sha256:${"0".repeat(64)}`,
      }),
      (error) => error?.code === "AGENTMO_APPEND_ONLY_OUTCOME_STAGE_CHANGED",
    );
    assert.deepEqual(await snapshotTree(fixture.storeRoot), before);

    const finalized = await finalizeAppendOnlyStagedOutcome({
      ...readRequest(fixture),
      expectedHeadDigest: prefix.headDigest,
      expectedPreparedRecordDigest: prefix.recoveryRequired.recordDigest,
      expectedStagedOutcomeDigest: digestRawBytes(prefix.recoveryRequired.stagedOutcome.bytes),
    });
    assert.equal(finalized.status, "committed");
    const state = await readAppendOnlyAuthority(readRequest(fixture));
    assert.equal(state.recoveryRequired, null);
    assert.equal(state.records.length, 1);
  });

  it("rejects a semantically invalid staged outcome before creating its final link", async () => {
    const fixture = await authorityFixture("agentmo-append-malformed-outcome-stage-");
    const request = appendRequest(fixture, "malformed-outcome-stage", { kind: "malformed-outcome-stage" });
    await crashAtOutcomeStage(fixture, request);
    const prefix = await readAppendOnlyAuthority(readRequest(fixture));
    assert.ok(prefix.recoveryRequired?.stagedOutcome);
    const stagePath = path.join(
      fixture.storeRoot,
      "outcomes",
      `${prefix.recoveryRequired.operationId}.outcome.stage.json`,
    );
    const displaced = path.join(fixture.projectRoot, "displaced-outcome-stage.json");
    const malformed = JSON.parse((await readFile(stagePath, "utf8")));
    malformed.recordIdentity = { ...malformed.recordIdentity, inode: "0" };
    const malformedBytes = Buffer.from(serializePersistableJson(malformed, {
      subject: "builder-append-only-malformed-outcome-stage",
    }), "utf8");
    await rename(stagePath, displaced);
    await writeFile(stagePath, malformedBytes, { flag: "wx", mode: 0o600 });
    const before = await snapshotTree(fixture.storeRoot);

    await assert.rejects(
      finalizeAppendOnlyStagedOutcome({
        ...readRequest(fixture),
        expectedHeadDigest: prefix.headDigest,
        expectedPreparedRecordDigest: prefix.recoveryRequired.recordDigest,
        expectedStagedOutcomeDigest: digestRawBytes(malformedBytes),
      }),
      (error) => /^AGENTMO_APPEND_ONLY_/u.test(error?.code ?? ""),
    );
    assert.deepEqual(await snapshotTree(fixture.storeRoot), before);
    assert.equal(
      (await readdir(path.join(fixture.storeRoot, "outcomes")))
        .some((name) => /^\d{16}\.json$/u.test(name)),
      false,
    );
  });

  it("fails closed when an external process replaces a retained child directory", async () => {
    const fixture = await authorityFixture("agentmo-append-directory-swap-");
    const entries = path.join(fixture.storeRoot, "entries");
    const retained = path.join(fixture.storeRoot, "entries-retained");
    const sentinel = Buffer.from("foreign replacement\n", "utf8");
    const child = startChild(
      "append",
      appendRequest(fixture, "directory-swap", { kind: "directory-swap" }),
    );
    const terminalPromise = collectChild(child);
    const deadline = Date.now() + 15_000;
    let swapped = false;
    while (Date.now() < deadline && child.exitCode === null) {
      const names = await readdir(path.join(fixture.storeRoot, "claims")).catch((error) => {
        if (error?.code === "ENOENT") return [];
        throw error;
      });
      if (names.some((name) => /^\d{16}\.json$/u.test(name))) {
        swapped = true;
        child.kill("SIGSTOP");
        await rename(entries, retained);
        await mkdir(entries, { mode: 0o700 });
        await writeFile(path.join(entries, "foreign.txt"), sentinel, { flag: "wx", mode: 0o600 });
        child.kill("SIGCONT");
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    const terminal = await terminalPromise;
    assert.equal(swapped, true);
    assert.equal(terminal.type, "error");
    assert.match(terminal.error?.code ?? "", /^AGENTMO_APPEND_ONLY_/u);
    assert.deepEqual(await readFile(path.join(entries, "foreign.txt")), sentinel);
    assert.equal((await readdir(path.join(fixture.storeRoot, "outcomes"))).length, 0);
  });

  it("rejects a real ancestor swap during retained bootstrap without an external write", async () => {
    const fixture = await bootstrapSwapFixture();
    const ancestor = path.join(fixture.projectRoot, ".agentmo");
    const retained = path.join(fixture.projectRoot, ".agentmo-retained");
    const child = startChild(
      "append",
      appendRequest(fixture, "bootstrap-ancestor-swap", { kind: "bootstrap-ancestor-swap" }),
    );
    const terminalPromise = collectChild(child);
    let terminal;
    try {
      // The observed directory is a durable child-process filesystem boundary;
      // SIGSTOP freezes the real producer before the hostile replacement, without a test seam.
      await stopChildAtCreatedDirectory(child, fixture.projectRoot, ".agentmo");
      const observed = await lstat(ancestor, { bigint: true });
      assert.equal(observed.isDirectory(), true);
      assert.equal(observed.isSymbolicLink(), false);
      await rename(ancestor, retained);
      await symlink(fixture.externalRoot, ancestor);
    } finally {
      if (child.exitCode === null) child.kill("SIGCONT");
      terminal = await terminalPromise;
    }
    assert.equal(terminal.type, "error");
    assert.match(terminal.error?.code ?? "", /^AGENTMO_APPEND_ONLY_/u);
    assert.deepEqual(await readdir(fixture.externalRoot), []);
  });

  it("rejects unsafe managed metadata without mutation", async () => {
    const fixture = await authorityFixture("agentmo-append-metadata-");
    await appendAppendOnlyRecord(appendRequest(fixture, "genesis", { kind: "metadata" }));
    await chmod(path.join(fixture.storeRoot, "prepared"), 0o750);
    const before = await snapshotTree(fixture.storeRoot);
    await assert.rejects(
      readAppendOnlyAuthority(readRequest(fixture)),
      (error) => /^AGENTMO_APPEND_ONLY_/u.test(error?.code ?? ""),
    );
    assert.deepEqual(await snapshotTree(fixture.storeRoot), before);
  });
});

describe("production test-control closure", () => {
  it("keeps caller-controlled test identifiers out of this shipped authority", async () => {
    const source = await readFile(path.resolve("src/builder-append-only-authority.js"), "utf8");
    for (const identifier of [
      "__testOnly",
      "NODE_TEST_CONTEXT",
      "AGENTMO_TEST_",
    ]) {
      assert.equal(source.includes(identifier), false, identifier);
    }
    assert.match(source, /sourceAuthority/u);
    assert.match(source, /sourceIdentity/u);
  });
});
