import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { constants as FS_CONSTANTS } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { digestRawBytes } from "../src/artifact-admission.js";
import { readAppendOnlyAuthority } from "../src/builder-append-only-authority.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hostModuleUrl = pathToFileURL(path.join(repoRoot, "src", "builder-codex-host.js")).href;
const artifactModuleUrl = pathToFileURL(path.join(repoRoot, "src", "artifact-admission.js")).href;
const authorityOptions = Object.freeze({
  relativeRoot: ".codex-selector-state-authority",
  namespace: "codex-selector-state",
});
const childSource = String.raw`
import { digestRawBytes } from ${JSON.stringify(artifactModuleUrl)};
import {
  acquireCodexSelectorStateReservation,
  assertCodexMarketplaceProjectionFinalBinding,
  closeCodexMarketplaceProjectionFinalAuthority,
  inspectCodexMarketplaceProjectionTransaction,
  publishCodexMarketplaceProjectionTransaction,
  releaseCodexSelectorStateReservation,
  resolveBuilderCodexMarketplaceRoot,
  retainCodexMarketplaceProjectionFinalAuthority,
  assertCodexMarketplaceProjectionFinalAuthority,
} from ${JSON.stringify(hostModuleUrl)};

const input = JSON.parse(process.argv[1]);
if (typeof input.stopAtEffectName === "string") {
  const childProcess = await import("node:child_process");
  const { syncBuiltinESMExports } = await import("node:module");
  const originalSpawn = childProcess.default.spawn;
  childProcess.default.spawn = function interceptedSpawn(...argumentsList) {
    const child = originalSpawn.call(this, ...argumentsList);
    const originalEnd = child.stdin?.end;
    if (typeof originalEnd !== "function") return child;
    child.stdin.end = function interceptedEnd(payload, ...endArguments) {
      try {
        const effect = JSON.parse(String(payload));
        if (["mkdir", "write-file"].includes(effect.action)
          && effect.name === input.stopAtEffectName) {
          child.once("message", (message) => {
            if (message?.type === "result") process.kill(process.pid, "SIGSTOP");
          });
        }
      } catch {
        // Only a closed POSIX-effect request can identify a member boundary.
      }
      return originalEnd.call(this, payload, ...endArguments);
    };
    return child;
  };
  syncBuiltinESMExports();
}
const files = input.files.map((file) => ({
  relativePath: file.relativePath,
  digest: file.digest,
  bytes: Buffer.from(file.bytes, "base64"),
}));
const marketplaceRoot = await resolveBuilderCodexMarketplaceRoot();
const reservation = await acquireCodexSelectorStateReservation({
  purpose: "activation",
  bindingDigest: input.contentDigest,
  expectedOwnerDigest: null,
  expectedOwnerIdentityDigest: null,
  expectedLedgerDigest: null,
  expectedLedgerIdentityDigest: null,
});
const published = await publishCodexMarketplaceProjectionTransaction({
  reservation,
  marketplaceRoot,
  releaseDigest: input.releaseDigest,
  contentDigest: input.contentDigest,
  files,
});
const strongBinding = await assertCodexMarketplaceProjectionFinalBinding({
  marketplaceRoot,
  expectedBinding: published.binding,
});
const authority = await retainCodexMarketplaceProjectionFinalAuthority({
  reservation,
  marketplaceRoot,
  releaseDigest: input.releaseDigest,
  contentDigest: input.contentDigest,
  files,
});
await assertCodexMarketplaceProjectionFinalAuthority(authority, reservation);
await releaseCodexSelectorStateReservation(reservation, "committed");
await assertCodexMarketplaceProjectionFinalAuthority(authority);
const releasedBinding = await assertCodexMarketplaceProjectionFinalBinding({
  marketplaceRoot,
  expectedBinding: published.binding,
});
await closeCodexMarketplaceProjectionFinalAuthority(authority);
const inspected = await inspectCodexMarketplaceProjectionTransaction({
  marketplaceRoot,
  releaseDigest: input.releaseDigest,
  contentDigest: input.contentDigest,
  files,
});
process.stdout.write(JSON.stringify({
  published: published.status,
  inspected: inspected.status,
  binding: inspected.binding?.schemaVersion ?? null,
  strongBinding: strongBinding.schemaVersion,
  releasedBinding: releasedBinding.schemaVersion,
}));
`;
const installModuleUrl = pathToFileURL(path.join(repoRoot, "src", "builder-install.js")).href;
const retainedAuthorityChildSource = String.raw`
import { digestRawBytes } from ${JSON.stringify(artifactModuleUrl)};
import {
  acquireCodexSelectorStateReservation,
  assertCodexMarketplaceProjectionFinalBinding,
  closeCodexMarketplaceProjectionFinalAuthority,
  publishCodexMarketplaceProjectionTransaction,
  resolveBuilderCodexMarketplaceRoot,
  retainCodexMarketplaceProjectionFinalAuthority,
} from ${JSON.stringify(hostModuleUrl)};
const bytes = Buffer.from("retained");
const releaseDigest = digestRawBytes(Buffer.from("release"));
const contentDigest = digestRawBytes(Buffer.from("content"));
const files = [{
  relativePath: "plugins/agentmo/file.txt",
  bytes,
  digest: digestRawBytes(bytes),
}];
const marketplaceRoot = await resolveBuilderCodexMarketplaceRoot();
const reservation = await acquireCodexSelectorStateReservation({
  purpose: "activation",
  bindingDigest: contentDigest,
  expectedOwnerDigest: null,
  expectedOwnerIdentityDigest: null,
  expectedLedgerDigest: null,
  expectedLedgerIdentityDigest: null,
});
const published = await publishCodexMarketplaceProjectionTransaction({
  reservation,
  marketplaceRoot,
  releaseDigest,
  contentDigest,
  files,
});
const exact = await assertCodexMarketplaceProjectionFinalBinding({
  marketplaceRoot,
  expectedBinding: published.binding,
});
let forgedRejection = null;
try {
  await assertCodexMarketplaceProjectionFinalBinding({
    marketplaceRoot,
    expectedBinding: {
      ...published.binding,
      contentDigest: digestRawBytes(Buffer.from("forged")),
    },
  });
} catch (error) {
  forgedRejection = error?.code ?? null;
}
const authority = await retainCodexMarketplaceProjectionFinalAuthority({
  reservation,
  marketplaceRoot,
  releaseDigest,
  contentDigest,
  files,
});
process.send({
  status: "retained",
  file: marketplaceRoot + "/plugins/agentmo/file.txt",
  exactSchemaVersion: exact.schemaVersion,
  forgedRejection,
});
await new Promise((resolve) => process.once("message", resolve));
let rejection = null;
try {
  await assertCodexMarketplaceProjectionFinalBinding({
    marketplaceRoot,
    expectedBinding: published.binding,
  });
} catch (error) {
  rejection = error?.code ?? null;
}
await closeCodexMarketplaceProjectionFinalAuthority(authority);
process.send({ status: "asserted", rejection });
`;
const installChildSource = String.raw`
import { readFile } from "node:fs/promises";
import path from "node:path";
import { applyBuilderInstall, planBuilderInstall } from ${JSON.stringify(installModuleUrl)};
const projectRoot = process.argv[1];
const probe = {
  schemaVersion: "agentmo.builder-probe.v1",
  adapter: { id: "codex" },
  host: { version: "0.144.2" },
  mutatesHost: "unknown",
  externalCommandMutation: "unknown",
  observations: [
    { id: "codex-cli", requirement: "required", status: "observed" },
    { id: "native-hooks", requirement: "required", status: "observed" },
    { id: "plugin-distribution", requirement: "required", status: "observed" },
    { id: "session-resume", requirement: "required", status: "observed" },
  ],
  required: { ok: true, missing: [], incompatible: [] },
};
const preview = await planBuilderInstall({ projectRoot, probe, hostScope: "user" });
const result = await applyBuilderInstall({
  projectRoot,
  probe,
  hostScope: "user",
  expectedPlanDigest: preview.planDigest,
});
const receiptPath = path.join(projectRoot, ".agentmo", "builder", "install-receipt.json");
const receiptBytes = await readFile(receiptPath);
process.stdout.write(JSON.stringify({
  result,
  receipt: JSON.parse(receiptBytes),
  receiptBytes: receiptBytes.toString("base64"),
}));
`;
const fakeCodexSource = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const statePath = path.join(process.env.HOME, ".fake-codex-state.json");
function load() {
  try { return JSON.parse(fs.readFileSync(statePath, "utf8")); }
  catch { return { marketplaceRoot: null, installed: false }; }
}
function save(state) {
  fs.writeFileSync(statePath, JSON.stringify(state));
}
const args = process.argv.slice(2);
const state = load();
// The host supervisor accepts only bytes observed before the direct command
// exits. Keep fixture command output observable before its intentional exit.
function emit(value) {
  process.stdout.write(value);
  setTimeout(() => process.exit(process.exitCode ?? 0), 50);
}
if (args[0] === "plugin" && args[1] === "marketplace" && args[2] === "list") {
  emit(JSON.stringify({
    marketplaces: state.marketplaceRoot === null
      ? []
      : [{ name: "agentmo-local", source: state.marketplaceRoot }],
  }));
} else if (args[0] === "plugin" && args[1] === "list") {
  emit(JSON.stringify({
    installed: state.installed ? [{
      pluginId: "agentmo@agentmo-local",
      name: "agentmo",
      marketplaceName: "agentmo-local",
      version: "0.1.0",
      installed: true,
      enabled: true,
      source: {
        source: "local",
        path: path.join(state.marketplaceRoot, "plugins", "agentmo"),
      },
    }] : [],
    available: [],
  }));
} else if (args[0] === "plugin" && args[1] === "marketplace" && args[2] === "add") {
  state.marketplaceRoot = path.resolve(args[3]);
  save(state);
  emit("{}");
} else if (args[0] === "plugin" && args[1] === "add") {
  state.installed = true;
  save(state);
  emit("{}");
} else if (args[0] === "app-server" && args[1] === "--stdio") {
  let buffered = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffered += chunk;
    let newline = buffered.indexOf("\\n");
    while (newline >= 0) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (line !== "") {
        const request = JSON.parse(line);
        const current = load();
        let result = {};
        if (request.id === 3) {
          result = { data: [{
            cwd: process.cwd(),
            skills: current.installed ? [{ name: "agentmo" }] : [],
            errors: [],
          }] };
        } else if (request.id === 4) {
          result = { data: [{
            cwd: process.cwd(),
            hooks: current.installed ? [{
              pluginId: "agentmo@agentmo-local",
              enabled: true,
              trustStatus: "untrusted",
            }] : [],
            warnings: [],
            errors: [],
          }] };
        }
        process.stdout.write(JSON.stringify({ id: request.id, result }) + "\\n");
      }
      newline = buffered.indexOf("\\n");
    }
  });
} else {
  process.exitCode = 2;
}
`;

function fixtureInput() {
  const rawFiles = [
    ["plugins/agentmo/a.txt", Buffer.from("alpha")],
    ["root.txt", Buffer.from("root")],
  ];
  return {
    releaseDigest: digestRawBytes(Buffer.from("release")),
    contentDigest: digestRawBytes(Buffer.from("content")),
    files: rawFiles.map(([relativePath, bytes]) => ({
      relativePath,
      digest: digestRawBytes(bytes),
      bytes: bytes.toString("base64"),
    })),
  };
}

function largeFixtureInput() {
  const rawFiles = Array.from({ length: 83 }, (_, index) => [
    `plugins/agentmo/member-${String(index).padStart(3, "0")}.txt`,
    Buffer.from(`member-${index}`),
  ]);
  return {
    releaseDigest: digestRawBytes(Buffer.from("large-release")),
    contentDigest: digestRawBytes(Buffer.from("large-content")),
    files: rawFiles.map(([relativePath, bytes]) => ({
      relativePath,
      digest: digestRawBytes(bytes),
      bytes: bytes.toString("base64"),
    })),
  };
}

function customFixtureInput(label, rawFiles) {
  return {
    releaseDigest: digestRawBytes(Buffer.from(`${label}-release`)),
    contentDigest: digestRawBytes(Buffer.from(`${label}-content`)),
    files: rawFiles.map(([relativePath, bytes]) => ({
      relativePath,
      digest: digestRawBytes(bytes),
      bytes: bytes.toString("base64"),
    })),
  };
}

function startPublisher(home, input, options = {}) {
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      childSource,
      JSON.stringify({
        ...input,
        stopAtEffectName: options.stopAtEffectName ?? null,
      }),
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, HOME: home },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return { child, exited };
}

async function waitForPendingPhysicalMember(stateRoot, marketplaceRoot, member, memberIndex, child) {
  const absolute = member.relativePath === ""
    ? marketplaceRoot
    : path.join(marketplaceRoot, ...member.relativePath.split("/"));
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`publisher exited before member ${memberIndex} could be interrupted`);
    }
    try {
      const authority = await readAppendOnlyAuthority({
        projectRoot: stateRoot,
        ...authorityOptions,
      });
      const transactionEvents = authority.records
        .map((record) => record.payload)
        .filter((payload) => payload?.kind?.startsWith("projection-"));
      const intent = transactionEvents.some(
        (payload) => payload.kind === "projection-intent"
          && payload.memberIndex === memberIndex,
      );
      const observed = transactionEvents.some(
        (payload) => payload.kind === "projection-observed"
          && payload.memberIndex === memberIndex,
      );
      const batchIntent = transactionEvents.findLast(
        (payload) => payload.kind === "projection-batch-intent"
          && payload.startMemberIndex <= memberIndex
          && memberIndex < payload.endMemberIndex,
      );
      const batchObserved = batchIntent === undefined
        ? false
        : transactionEvents.some(
            (payload) => payload.kind === "projection-batch-observed"
              && payload.startMemberIndex === batchIntent.startMemberIndex
              && payload.endMemberIndex === batchIntent.endMemberIndex,
          );
      if ((intent && !observed) || (batchIntent !== undefined && !batchObserved)) {
        await access(absolute, FS_CONSTANTS.F_OK);
        return;
      }
    } catch {
      // The authority and member are created independently; retry until both
      // observations identify the same pending transaction prefix.
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`timed out waiting for projection member ${memberIndex}`);
}

async function waitForHostStateClaim(stateRoot, idempotencyPrefix, child) {
  const claimRoot = path.join(stateRoot, ".codex-selector-state-claims");
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`publisher exited before ${idempotencyPrefix} claim`);
    }
    const names = await readdir(claimRoot).catch((error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    });
    for (const name of names) {
      try {
        const claim = JSON.parse(await readFile(path.join(claimRoot, name), "utf8"));
        if (claim.idempotencyKey?.startsWith(idempotencyPrefix)) return claim;
      } catch {
        // A host-state claim is admitted only after its exact bytes are stable.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`timed out waiting for ${idempotencyPrefix} claim`);
}

async function publishToCompletion(home, input) {
  const running = startPublisher(home, input);
  const result = await running.exited;
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

async function installWithExternalCodex(home, projectRoot) {
  const bin = path.join(home, "bin");
  await mkdir(bin, { mode: 0o700 });
  const codex = path.join(bin, "codex");
  await writeFile(codex, fakeCodexSource, { mode: 0o700 });
  await chmod(codex, 0o700);
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", installChildSource, projectRoot],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: home,
        PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const result = await new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  assert.equal(result.signal, null, stderr);
  assert.equal(result.code, 0, stderr);
  return JSON.parse(stdout);
}

describe("Codex marketplace projection transaction", () => {
  const members = [
    { kind: "root", relativePath: "" },
    { kind: "directory", relativePath: "plugins" },
    { kind: "directory", relativePath: "plugins/agentmo" },
    { kind: "file", relativePath: "plugins/agentmo/a.txt" },
    { kind: "file", relativePath: "root.txt" },
  ];

  for (const [memberIndex, member] of members.entries()) {
    test(`resumes after external process death at member ${memberIndex} ${member.kind}`, async () => {
      const home = await mkdtemp(path.join(os.tmpdir(), "agentmo-projection-transaction-"));
      const input = fixtureInput();
      const stateRoot = path.join(home, ".agentmo", "builder", "codex-host");
      const marketplaceRoot = path.join(stateRoot, "marketplace", "agentmo-local");
      const interrupted = startPublisher(home, input, {
        stopAtEffectName: path.basename(
          member.relativePath === "" ? "agentmo-local" : member.relativePath,
        ),
      });
      await waitForPendingPhysicalMember(
        stateRoot,
        marketplaceRoot,
        member,
        memberIndex,
        interrupted.child,
      );
      assert.equal(interrupted.child.kill("SIGKILL"), true);
      const killed = await interrupted.exited;
      assert.equal(killed.signal, "SIGKILL");

      const recovered = await publishToCompletion(home, input);
      assert.deepEqual(recovered, {
        published: "exact",
        inspected: "exact",
        binding: "agentmo.codex-marketplace-projection-binding.v1",
        strongBinding: "agentmo.codex-marketplace-projection-binding.v1",
        releasedBinding: "agentmo.codex-marketplace-projection-binding.v1",
      });
    });
  }

  for (const injection of ["non-prefix", "extra"]) {
    test(`rejects ${injection === "extra" ? "an" : "a"} ${injection} member injected inside an interrupted batch`, async () => {
      const home = await mkdtemp(path.join(os.tmpdir(), `agentmo-projection-${injection}-`));
      const input = fixtureInput();
      const stateRoot = path.join(home, ".agentmo", "builder", "codex-host");
      const marketplaceRoot = path.join(stateRoot, "marketplace", "agentmo-local");
      const interrupted = startPublisher(home, input, {
        stopAtEffectName: "agentmo-local",
      });
      await waitForPendingPhysicalMember(
        stateRoot,
        marketplaceRoot,
        members[0],
        0,
        interrupted.child,
      );
      assert.equal(interrupted.child.kill("SIGKILL"), true);
      assert.equal((await interrupted.exited).signal, "SIGKILL");

      if (injection === "non-prefix") {
        const rootFile = input.files.find((file) => file.relativePath === "root.txt");
        await writeFile(
          path.join(marketplaceRoot, "root.txt"),
          Buffer.from(rootFile.bytes, "base64"),
          { mode: 0o600 },
        );
      } else {
        await writeFile(
          path.join(marketplaceRoot, "foreign.txt"),
          "foreign",
          { mode: 0o600 },
        );
      }

      const rejected = await startPublisher(home, input).exited;
      assert.equal(rejected.signal, null, rejected.stderr);
      assert.notEqual(rejected.code, 0, rejected.stderr);
      await assert.rejects(
        access(path.join(marketplaceRoot, "plugins"), FS_CONSTANTS.F_OK),
        (error) => error?.code === "ENOENT",
      );
    });
  }

  test("publishes an 86-member projection in bounded batches within 90 seconds", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "agentmo-projection-batch-86-"));
    const input = largeFixtureInput();
    const started = Date.now();
    const published = await publishToCompletion(home, input);
    const elapsedMs = Date.now() - started;
    assert.equal(published.published, "exact");
    assert.ok(elapsedMs < 90_000, `86-member projection took ${elapsedMs}ms`);

    const authority = await readAppendOnlyAuthority({
      projectRoot: path.join(home, ".agentmo", "builder", "codex-host"),
      ...authorityOptions,
    });
    const projectionEvents = authority.records
      .map((record) => record.payload)
      .filter((payload) => payload?.kind?.startsWith("projection-"));
    const intents = projectionEvents.filter(
      (payload) => payload.kind === "projection-batch-intent",
    );
    const observed = projectionEvents.filter(
      (payload) => payload.kind === "projection-batch-observed",
    );
    assert.equal(
      projectionEvents.some((payload) => (
        payload.kind === "projection-intent" || payload.kind === "projection-observed"
      )),
      false,
    );
    assert.equal(intents.length, 6);
    assert.equal(observed.length, 6);
    assert.deepEqual(
      intents.map((event) => [event.startMemberIndex, event.endMemberIndex]),
      [[0, 16], [16, 32], [32, 48], [48, 64], [64, 80], [80, 86]],
    );
    assert.deepEqual(
      observed.map((event) => [event.startMemberIndex, event.endMemberIndex]),
      intents.map((event) => [event.startMemberIndex, event.endMemberIndex]),
    );
    assert.equal(
      projectionEvents.filter((payload) => payload.kind === "projection-manifest").length,
      1,
    );
    assert.equal(
      projectionEvents.filter((payload) => payload.kind === "projection-complete").length,
      1,
    );
  });

  test("rejects an oversized expected file before reading or advancing the prefix", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "agentmo-projection-oversized-"));
    const input = fixtureInput();
    const stateRoot = path.join(home, ".agentmo", "builder", "codex-host");
    const marketplaceRoot = path.join(stateRoot, "marketplace", "agentmo-local");
    const interrupted = startPublisher(home, input, {
      stopAtEffectName: "agentmo",
    });
    await waitForPendingPhysicalMember(
      stateRoot,
      marketplaceRoot,
      members[2],
      2,
      interrupted.child,
    );
    assert.equal(interrupted.child.kill("SIGKILL"), true);
    assert.equal((await interrupted.exited).signal, "SIGKILL");

    await writeFile(
      path.join(marketplaceRoot, "plugins", "agentmo", "a.txt"),
      Buffer.alloc(256 * 1024 + 1, 0x61),
      { mode: 0o600 },
    );
    const rejected = await startPublisher(home, input).exited;
    assert.equal(rejected.signal, null, rejected.stderr);
    assert.notEqual(rejected.code, 0, rejected.stderr);
    await assert.rejects(
      access(path.join(marketplaceRoot, "root.txt"), FS_CONSTANTS.F_OK),
      (error) => error?.code === "ENOENT",
    );
  });

  test("rejects an unexpected deeply nested tree without traversing it", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "agentmo-projection-deep-extra-"));
    const input = fixtureInput();
    const stateRoot = path.join(home, ".agentmo", "builder", "codex-host");
    const marketplaceRoot = path.join(stateRoot, "marketplace", "agentmo-local");
    const interrupted = startPublisher(home, input, {
      stopAtEffectName: "agentmo-local",
    });
    await waitForPendingPhysicalMember(
      stateRoot,
      marketplaceRoot,
      members[0],
      0,
      interrupted.child,
    );
    assert.equal(interrupted.child.kill("SIGKILL"), true);
    assert.equal((await interrupted.exited).signal, "SIGKILL");

    const unexpectedSegments = Array.from(
      { length: 48 },
      (_, index) => `x${String(index).padStart(2, "0")}`,
    );
    await mkdir(
      path.join(marketplaceRoot, ...unexpectedSegments),
      { recursive: true, mode: 0o700 },
    );
    const rejected = await startPublisher(home, input).exited;
    assert.equal(rejected.signal, null, rejected.stderr);
    assert.notEqual(rejected.code, 0, rejected.stderr);
    await assert.rejects(
      access(path.join(marketplaceRoot, "plugins"), FS_CONSTANTS.F_OK),
      (error) => error?.code === "ENOENT",
    );
  });

  for (const limitCase of [
    {
      name: "file-byte",
      input: () => customFixtureInput(
        "oversized-manifest-file",
        [["oversized.bin", Buffer.alloc(256 * 1024 + 1)]],
      ),
    },
    {
      name: "path-depth",
      input: () => customFixtureInput(
        "deep-manifest-path",
        [[`${Array.from({ length: 32 }, () => "d").join("/")}/f`, Buffer.from("x")]],
      ),
    },
    {
      name: "member-count",
      input: () => customFixtureInput(
        "large-manifest-member-count",
        Array.from({ length: 128 }, (_, index) => [
          [
            index.toString(36).padStart(2, "0"),
            ...Array.from({ length: 30 }, () => "d"),
            "f",
          ].join("/"),
          Buffer.from("x"),
        ]),
      ),
    },
  ]) {
    test(`rejects a projection manifest exceeding the ${limitCase.name} limit`, async () => {
      const home = await mkdtemp(
        path.join(os.tmpdir(), `agentmo-projection-limit-${limitCase.name}-`),
      );
      const rejected = await startPublisher(home, limitCase.input()).exited;
      assert.equal(rejected.signal, null, rejected.stderr);
      assert.notEqual(rejected.code, 0, rejected.stderr);
    });
  }

  test("rejects a same-byte inode substitution during batch observation and on retry", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "agentmo-projection-batch-race-"));
    const input = fixtureInput();
    const stateRoot = path.join(home, ".agentmo", "builder", "codex-host");
    const target = path.join(
      stateRoot,
      "marketplace",
      "agentmo-local",
      "plugins",
      "agentmo",
      "a.txt",
    );
    const original = path.join(home, "retained-a.txt");
    const replacement = path.join(home, "replacement-a.txt");
    await writeFile(replacement, "alpha", { mode: 0o600 });

    const running = startPublisher(home, input);
    await waitForHostStateClaim(
      stateRoot,
      "projection-batch-observed:",
      running.child,
    );
    await rename(target, original);
    await rename(replacement, target);
    const rejected = await running.exited;
    assert.equal(rejected.signal, null, rejected.stderr);
    assert.notEqual(rejected.code, 0, rejected.stderr);

    const authority = await readAppendOnlyAuthority({
      projectRoot: stateRoot,
      ...authorityOptions,
    });
    const projectionEvents = authority.records
      .map((record) => record.payload)
      .filter((payload) => payload?.kind?.startsWith("projection-"));
    assert.equal(
      projectionEvents.some((payload) => payload.kind === "projection-batch-observed"),
      true,
    );
    assert.equal(
      projectionEvents.some((payload) => payload.kind === "projection-complete"),
      false,
    );

    const retried = await startPublisher(home, input).exited;
    assert.equal(retried.signal, null, retried.stderr);
    assert.notEqual(retried.code, 0, retried.stderr);
  });

  test("retained final authority rejects a pathname substitution", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "agentmo-projection-authority-home-"));
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", retainedAuthorityChildSource],
      {
        cwd: repoRoot,
        env: { ...process.env, HOME: home },
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const childExited = new Promise((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    const retained = await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("retained projection authority timed out")),
        20_000,
      );
      child.once("error", reject);
      child.once("message", (message) => {
        clearTimeout(timeout);
        resolve(message);
      });
    });
    assert.equal(retained.status, "retained");
    assert.equal(
      retained.exactSchemaVersion,
      "agentmo.codex-marketplace-projection-binding.v1",
    );
    assert.equal(
      retained.forgedRejection,
      "AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED",
    );
    await rename(retained.file, `${retained.file}.retained`);
    await writeFile(retained.file, "foreign", { mode: 0o600 });
    child.send({ proceed: true });
    const asserted = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("message", resolve);
    });
    assert.deepEqual(asserted, {
      status: "asserted",
      rejection: "AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED",
    });
    const exited = await childExited;
    assert.deepEqual(exited, { code: 0, signal: null }, stderr);
  });

  test("publishes only a finalized activated receipt bound to retained projection identities", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "agentmo-activated-receipt-home-"));
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "agentmo-activated-receipt-project-"));
    const installed = await installWithExternalCodex(home, projectRoot);
    const receiptBytes = Buffer.from(installed.receiptBytes, "base64");
    assert.equal(installed.result.status, "activated");
    assert.equal(installed.result.receipt.digest, digestRawBytes(receiptBytes));
    assert.equal(installed.receipt.schemaVersion, "agentmo.builder-install-receipt.v4");
    assert.equal(
      installed.receipt.hostActivation.schemaVersion,
      "agentmo.builder-codex-activation-binding.v3",
    );
    const finalBinding = installed.receipt.hostActivation.finalProjectionBinding;
    assert.equal(
      finalBinding.schemaVersion,
      "agentmo.codex-marketplace-projection-binding.v1",
    );
    assert.match(finalBinding.rootIdentityDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.ok(finalBinding.members.length > 1);

    const onDisk = await readFile(
      path.join(projectRoot, ".agentmo", "builder", "install-receipt.json"),
    );
    assert.deepEqual(onDisk, receiptBytes);
    const authority = await readAppendOnlyAuthority({
      projectRoot,
      relativeRoot: ".agentmo-install-attempt-authority",
      namespace: "builder-install",
    });
    const terminal = authority.records.at(-1)?.payload;
    assert.equal(terminal.schemaVersion, "agentmo.builder-install-attempt.v2");
    assert.equal(terminal.disposition, "committed");
    assert.equal(terminal.receiptDigest, digestRawBytes(receiptBytes));
    assert.deepEqual(terminal.finalProjectionBinding, finalBinding);
  });
});
