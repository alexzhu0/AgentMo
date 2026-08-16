import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  buildCodexConsumerEntry,
  buildCodexConsumerLedger,
  buildCodexHostSelector,
  buildCodexSelectorOwnerRecord,
  acquireCodexSelectorStateReservation,
  digestCodexConsumerLedger,
  digestCodexSelectorOwnerRecord,
  inspectCodexMarketplaceProjectionAuthority,
  mutateCodexHost,
  observeCodexHost,
  readCodexSelectorState,
  releaseCodexSelectorStateReservation,
  retireCodexMarketplaceProjectionAuthority,
  restoreCodexSelectorOwnerState,
  retractCodexSelectorState,
  writeCodexSelectorOwnerRecord,
} from "../src/builder-codex-host.js";
import { serializePersistableJson } from "../src/persistability.js";
import { applyBuilderInstall, planBuilderInstall } from "../src/builder-install.js";
import {
  applyBuilderDeactivate,
  applyBuilderHostProjectionMigration,
  applyBuilderHostProjectionTransfer,
  applyBuilderHostSelectorRemoval,
  planBuilderDeactivate,
  planBuilderHostProjectionMigration,
  planBuilderHostProjectionTransfer,
  planBuilderHostSelectorRemoval,
} from "../src/builder-lifecycle.js";

const RELEASE_DIGEST = `sha256:${"a".repeat(64)}`;
const SOURCE_DIGEST = `sha256:${"b".repeat(64)}`;
const SCOPE = `sha256:${"c".repeat(64)}`;
const HOST_MODULE_URL = new URL("../src/builder-codex-host.js", import.meta.url).href;
const HOST_CLAIM_CHILD_SOURCE = String.raw`
const configuration = JSON.parse(process.argv.at(-1));
const host = await import(configuration.moduleUrl);
await host.acquireCodexSelectorStateReservation(configuration.request);
`;
const SHORT_LIVED_REAP_LEAF_TIMEOUT_MS = 10_000;
const SHORT_LIVED_REAP_MARKER_TIMEOUT_MS = 15_000;
const SHORT_LIVED_OBSERVATION_TIMEOUT_MS = 4_000;
const SHORT_LIVED_FIXTURE_TIMEOUT_MS = 30_000;

const FAKE_CODEX_SOURCE = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const statePath = path.join(process.env.HOME, ".fake-codex-state.json");
const logPath = path.join(process.env.HOME, ".fake-codex-log.jsonl");
const appServerModePath = path.join(process.env.HOME, ".fake-codex-app-server-mode");
const commandModePath = path.join(process.env.HOME, ".fake-codex-command-mode");
const commandTimeoutSeenPath = path.join(process.env.HOME, ".fake-codex-command-timeout-seen");
const hookTrustPath = path.join(process.env.HOME, ".fake-codex-hook-trust");
const args = process.argv.slice(2);
function load() {
  try { return JSON.parse(fs.readFileSync(statePath, "utf8")); }
  catch { return { marketplaceRoot: null, installed: false }; }
}
function save(state) {
  fs.writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });
}
function record() {
  fs.appendFileSync(logPath, JSON.stringify(args) + "\\n", { mode: 0o600 });
}
function hookTrust() {
  try { return fs.readFileSync(hookTrustPath, "utf8").trim(); }
  catch { return "untrusted"; }
}
function spawnStubbornGrandchild(kind) {
  const pidPath = path.join(process.env.HOME, ".fake-codex-" + kind + "-grandchild-pid");
  const sigtermPath = path.join(process.env.HOME, ".fake-codex-" + kind + "-grandchild-sigterm");
  const readyPath = path.join(process.env.HOME, ".fake-codex-" + kind + "-grandchild-ready");
  const source = [
    'const fs = require("node:fs");',
    "fs.writeFileSync(" + JSON.stringify(pidPath) + ", String(process.pid));",
    'process.stdout.write("host-daemon-value-canary");',
    'process.on("SIGTERM", () => fs.writeFileSync(' + JSON.stringify(sigtermPath) + ', "observed"));',
    'fs.writeFileSync(' + JSON.stringify(readyPath) + ', "ready");',
    "setInterval(() => {}, 1_000);",
  ].join("\\n");
  spawn(process.execPath, ["-e", source], { stdio: "inherit" });
  return readyPath;
}
function spawnEscapedStdoutGrandchild(kind) {
  const pidPath = path.join(process.env.HOME, ".fake-codex-" + kind + "-grandchild-pid");
  const readyPath = path.join(process.env.HOME, ".fake-codex-" + kind + "-grandchild-ready");
  const source = [
    'const fs = require("node:fs");',
    "fs.writeFileSync(" + JSON.stringify(pidPath) + ", String(process.pid));",
    'process.stdout.write("host-escaped-stdout-value-canary");',
    "fs.writeFileSync(" + JSON.stringify(readyPath) + ", " + JSON.stringify("ready") + ");",
    "setInterval(() => {}, 1_000);",
  ].join("\\n");
  const child = spawn(process.execPath, ["-e", source], {
    detached: true,
    stdio: "inherit",
  });
  child.unref();
  return readyPath;
}
function spawnEscapedMarketplaceJsonGrandchild() {
  const emittedPath = path.join(process.env.HOME, ".fake-codex-command-post-exit-json-emitted");
  const reapedPath = path.join(process.env.HOME, ".fake-codex-command-post-exit-parent-reaped");
  const source = [
    'const fs = require("node:fs");',
    'const path = require("node:path");',
    "const parentPid = " + String(process.pid) + ";",
    "const reapedDeadline = Date.now() + ${SHORT_LIVED_REAP_LEAF_TIMEOUT_MS};",
    'process.stdout.on("error", () => process.exit(0));',
    "function waitForParentReap() {",
    "  try {",
    "    process.kill(parentPid, 0);",
    "  } catch (error) {",
    '    if (error?.code !== "ESRCH") process.exit(1);',
    "    fs.writeFileSync(" + JSON.stringify(reapedPath) + ", \\\"reaped\\\");",
    "    setTimeout(() => {",
    "      fs.writeFileSync(" + JSON.stringify(emittedPath) + ", \\\"emitted\\\");",
    '      process.stdout.write(JSON.stringify({ marketplaces: [{ name: "agentmo-local", source: path.join(process.env.HOME, ".agentmo", "builder", "codex-host", "marketplace", "agentmo-local") }] }));',
    "      setTimeout(() => process.exit(0), 1);",
    "    }, 10);",
    "    return;",
    "  }",
    "  if (Date.now() >= reapedDeadline) process.exit(1);",
    "  setTimeout(waitForParentReap, 5);",
    "}",
    "waitForParentReap();",
  ].join("\\n");
  const child = spawn(process.execPath, ["-e", source], {
    detached: true,
    stdio: "inherit",
  });
  child.unref();
}
function plugin(state) {
  return {
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
  };
}
record();
const state = load();
// The host supervisor accepts only bytes observed before the direct command
// exits. Keep fixture command output observable before its intentional exit.
function emit(value) {
  process.stdout.write(value);
  setTimeout(() => process.exit(process.exitCode ?? 0), 50);
}
let commandMode = null;
try { commandMode = fs.readFileSync(commandModePath, "utf8").trim(); }
catch {}
if (commandMode === "escaped-post-exit-json"
    && args[0] === "plugin" && args[1] === "marketplace" && args[2] === "list") {
  spawnEscapedMarketplaceJsonGrandchild();
  process.exit(0);
} else if ((commandMode === "timeout" || commandMode === "daemon" || commandMode === "escaped-daemon") && !fs.existsSync(commandTimeoutSeenPath)
    && args[0] === "plugin" && args[1] === "marketplace" && args[2] === "list") {
  fs.writeFileSync(commandTimeoutSeenPath, "seen");
  fs.writeFileSync(path.join(process.env.HOME, ".fake-codex-command-pid"), String(process.pid));
  if (commandMode === "daemon" || commandMode === "escaped-daemon") {
    if (commandMode === "escaped-daemon") {
      process.on("exit", () => {
        fs.writeFileSync(
          path.join(process.env.HOME, ".fake-codex-command-escaped-parent-exit"),
          "observed",
        );
      });
    }
    const readyPath = commandMode === "escaped-daemon"
      ? spawnEscapedStdoutGrandchild("command-escaped")
      : spawnStubbornGrandchild("command");
    const exitWhenReady = setInterval(() => {
      if (!fs.existsSync(readyPath)) return;
      clearInterval(exitWhenReady);
      process.stdout.write(commandMode === "escaped-daemon"
        ? "host-command-escaped-parent-canary"
        : "host-command-daemon-value-canary");
      process.exit(0);
    }, 1);
  }
  process.on("SIGTERM", () => {
    fs.writeFileSync(path.join(process.env.HOME, ".fake-codex-command-sigterm"), "observed");
  });
  setInterval(() => {}, 1_000);
} else if (args[0] === "plugin" && args[1] === "marketplace" && args[2] === "list") {
  emit(JSON.stringify({
    marketplaces: state.marketplaceRoot === null
      ? []
      : [{ name: "agentmo-local", source: state.marketplaceRoot }],
  }));
} else if (args[0] === "plugin" && args[1] === "list") {
  emit(JSON.stringify({
    installed: state.installed ? [plugin(state)] : [],
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
  let appServerMode = null;
  try { appServerMode = fs.readFileSync(appServerModePath, "utf8").trim(); }
  catch {}
  if (["timeout", "malformed", "malformed-daemon", "escaped-daemon"].includes(appServerMode)) {
    fs.writeFileSync(path.join(process.env.HOME, ".fake-codex-app-server-pid"), String(process.pid));
    process.on("SIGTERM", () => {
      fs.writeFileSync(path.join(process.env.HOME, ".fake-codex-app-server-sigterm"), "observed");
    });
    process.stdin.resume();
    process.stdin.on("end", () => {
      fs.writeFileSync(path.join(process.env.HOME, ".fake-codex-app-server-stdin-closed"), "observed");
    });
    if (appServerMode === "malformed-daemon" || appServerMode === "escaped-daemon") {
      if (appServerMode === "escaped-daemon") {
        process.on("exit", () => {
          fs.writeFileSync(
            path.join(process.env.HOME, ".fake-codex-app-server-escaped-parent-exit"),
            "observed",
          );
        });
      }
      const readyPath = appServerMode === "escaped-daemon"
        ? spawnEscapedStdoutGrandchild("app-server-escaped")
        : spawnStubbornGrandchild("app-server");
      const emitMalformedWhenReady = setInterval(() => {
        if (!fs.existsSync(readyPath)) return;
        clearInterval(emitMalformedWhenReady);
        if (appServerMode === "escaped-daemon") {
          process.stdout.write("host-app-server-escaped-parent-canary");
          process.exit(0);
        } else {
          process.stdout.write("host-app-server-daemon-value-canary");
          process.stdout.write("{malformed\\n");
        }
      }, 1);
    } else if (appServerMode === "malformed") {
      process.stdout.write("{malformed\\n");
    }
    setInterval(() => {}, 1_000);
  } else {
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
                trustStatus: hookTrust(),
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
  }
} else {
  process.exitCode = 2;
}
`;

async function createRuntime(prefix, {
  fakeCodex = false,
  stubbornAppServer = null,
  stubbornCommand = null,
  fakeHookTrust = "untrusted",
} = {}) {
  const home = await mkdtemp(path.join(tmpdir(), prefix));
  const bin = path.join(home, "bin");
  const codexHome = path.join(home, ".codex");
  await Promise.all([
    mkdir(bin, { mode: 0o700 }),
    mkdir(codexHome, { mode: 0o700 }),
  ]);
  if (fakeCodex) {
    const executable = path.join(bin, "codex");
    await writeFile(executable, FAKE_CODEX_SOURCE, { mode: 0o700 });
    await chmod(executable, 0o700);
  }
  if (["timeout", "malformed", "malformed-daemon", "escaped-daemon"].includes(stubbornAppServer)) {
    await writeFile(
      path.join(home, ".fake-codex-app-server-mode"),
      `${stubbornAppServer}\n`,
      { mode: 0o600 },
    );
  }
  if (["timeout", "daemon", "escaped-daemon", "escaped-post-exit-json"].includes(stubbornCommand)) {
    await writeFile(
      path.join(home, ".fake-codex-command-mode"),
      `${stubbornCommand}\n`,
      { mode: 0o600 },
    );
  }
  if (fakeCodex) {
    await writeFile(
      path.join(home, ".fake-codex-hook-trust"),
      `${fakeHookTrust}\n`,
      { mode: 0o600 },
    );
  }
  return {
    home,
    bin,
    codexHome,
    stateRoot: path.join(home, ".agentmo", "builder", "codex-host"),
    marketplaceRoot: path.join(home, ".agentmo", "builder", "codex-host", "marketplace", "agentmo-local"),
    fakeStatePath: path.join(home, ".fake-codex-state.json"),
    fakeLogPath: path.join(home, ".fake-codex-log.jsonl"),
  };
}

async function withRuntime(runtime, operation) {
  const prior = {
    HOME: process.env.HOME,
    CODEX_HOME: process.env.CODEX_HOME,
    PATH: process.env.PATH,
  };
  process.env.HOME = runtime.home;
  process.env.CODEX_HOME = runtime.codexHome;
  process.env.PATH = [
    runtime.bin,
    path.dirname(process.execPath),
    "/usr/bin",
    "/bin",
  ].join(path.delimiter);
  try {
    return await operation();
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function waitForNewEntry(directory, before, child) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error("host claim child exited before durable claim observation");
    }
    try {
      const current = await readdir(directory);
      if (current.some((name) => !before.has(name))) return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("host claim child did not publish a durable claim in time");
}

async function killReservationAtClaim(runtime, request) {
  const claimRoot = path.join(runtime.stateRoot, ".codex-selector-state-claims");
  const before = new Set(await readdir(claimRoot).catch(() => []));
  const child = spawn(process.execPath, [
    "--input-type=module",
    "--eval",
    HOST_CLAIM_CHILD_SOURCE,
    JSON.stringify({ moduleUrl: HOST_MODULE_URL, request }),
  ], {
    env: { ...process.env, HOME: runtime.home, CODEX_HOME: runtime.codexHome },
    stdio: ["ignore", "ignore", "ignore"],
  });
  const terminal = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  await waitForNewEntry(claimRoot, before, child);
  child.kill("SIGSTOP");
  child.kill("SIGKILL");
  assert.deepEqual(await terminal, { code: null, signal: "SIGKILL" });
}

function release() {
  return {
    name: "agentmo",
    version: "0.1.0",
    adapterId: "codex",
    releaseDigest: RELEASE_DIGEST,
  };
}

function compatibleProbe() {
  return {
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
}

function identity(stats) {
  return [stats.dev, stats.ino, stats.nlink, stats.size];
}

function rejected(code) {
  return (error) => error?.code === code;
}

async function snapshotHomeTree(root) {
  const rows = [];
  const visit = async (directory, relative = "") => {
    for (const entry of (await readdir(directory, { withFileTypes: true }))
      .toSorted((left, right) => left.name.localeCompare(right.name))) {
      const childRelative = relative === "" ? entry.name : `${relative}/${entry.name}`;
      rows.push(Object.freeze({
        path: childRelative,
        kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
      }));
      if (entry.isDirectory()) await visit(path.join(directory, entry.name), childRelative);
    }
  };
  await visit(root);
  return Object.freeze(rows);
}

function agentmoPaths(snapshot) {
  return snapshot.filter((entry) => entry.path === ".agentmo" || entry.path.startsWith(".agentmo/"));
}

async function settleWithin(promise, timeoutMs, message) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

async function waitForFile(filePath, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await readFile(filePath);
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

function assertShortLivedEscapedDeadlineHierarchy() {
  assert.ok(SHORT_LIVED_REAP_LEAF_TIMEOUT_MS < SHORT_LIVED_REAP_MARKER_TIMEOUT_MS);
  assert.ok(
    SHORT_LIVED_REAP_MARKER_TIMEOUT_MS + SHORT_LIVED_OBSERVATION_TIMEOUT_MS
      < SHORT_LIVED_FIXTURE_TIMEOUT_MS,
  );
  assert.match(
    FAKE_CODEX_SOURCE,
    /"const reapedDeadline = Date\.now\(\) \+ 10000;",/u,
  );
  assert.doesNotMatch(FAKE_CODEX_SOURCE, /SHORT_LIVED_REAP_LEAF_TIMEOUT_MS/u);
}

async function drainShortLivedObservation(observationPromise) {
  if (observationPromise === null) return null;
  try {
    await settleWithin(
      observationPromise,
      SHORT_LIVED_OBSERVATION_TIMEOUT_MS,
      "short-lived host observation drain",
    );
    return null;
  } catch (error) {
    return error;
  }
}

async function readEscapedGrandchildPid(runtime, kind) {
  const processId = Number(await readFile(
    path.join(runtime.home, `.fake-codex-${kind}-grandchild-pid`),
    "utf8",
  ));
  assert.equal(Number.isSafeInteger(processId) && processId > 0, true, `${kind} escaped pid`);
  return processId;
}

async function terminateEscapedProcess(processId, description) {
  if (!Number.isSafeInteger(processId) || processId <= 0) return;
  try {
    process.kill(processId, "SIGKILL");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      process.kill(processId, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`${description} escaped process survived cleanup`);
}

describe("Codex host additive-only contract", () => {
  it("keeps the escaped parent-reap deadlines strictly nested", () => {
    assertShortLivedEscapedDeadlineHierarchy();
  });

  it("drains a started short-lived observation before fixture restoration", async () => {
    let settled = false;
    const observation = new Promise((resolve) => {
      setImmediate(() => {
        settled = true;
        resolve("settled");
      });
    });
    assert.equal(await drainShortLivedObservation(observation), null);
    assert.equal(settled, true);
  });

  it("keeps selector, owner, and consumer evidence deterministic", () => {
    const selector = buildCodexHostSelector(release());
    assert.deepEqual(selector, {
      marketplaceName: "agentmo-local",
      pluginName: "agentmo",
      pluginId: "agentmo@agentmo-local",
    });
    const owner = buildCodexSelectorOwnerRecord({
      selector,
      disposition: "created-by-agentmo",
      release: release(),
      sourceDigest: SOURCE_DIGEST,
    });
    const consumer = buildCodexConsumerEntry({
      selector,
      projectScopeDigest: SCOPE,
      releaseDigest: RELEASE_DIGEST,
    });
    const ledger = buildCodexConsumerLedger({ selector, consumers: [consumer] });
    assert.match(digestCodexSelectorOwnerRecord(owner), /^sha256:[a-f0-9]{64}$/u);
    assert.match(digestCodexConsumerLedger(ledger), /^sha256:[a-f0-9]{64}$/u);
  });

  it("submits only fixed add commands and rejects both former remove operations before transport", async () => {
    const runtime = await createRuntime("agentmo-host-additive-");
    await withRuntime(runtime, async () => {
      const projectRoot = await mkdtemp(path.join(tmpdir(), "agentmo-host-project-"));
      const selector = buildCodexHostSelector(release());
      for (const operation of ["plugin-remove", "marketplace-remove"]) {
        await assert.rejects(
          mutateCodexHost({
            operation,
            hostScope: "user",
            selector,
            projectRoot,
            release: release(),
          }),
          rejected("AGENTMO_CODEX_HOST_OPERATION_REJECTED"),
        );
      }
      for (const retired of [
        { __testOnlyExecute: async () => ({ ok: true }) },
        { __testOnlyStateRoot: runtime.stateRoot },
        { __testOnlyCodexHost: {} },
      ]) {
        await assert.rejects(
          mutateCodexHost({
            operation: "marketplace-add",
            hostScope: "user",
            selector,
            projectRoot,
            release: release(),
            ...retired,
          }),
          rejected("AGENTMO_CODEX_HOST_OPERATION_REJECTED"),
        );
      }
    });
  });

  it("does not create AgentMo host paths and reports external command mutation as unknown", async () => {
    const runtime = await createRuntime("agentmo-host-observe-read-only-", { fakeCodex: true });
    await withRuntime(runtime, async () => {
      const projectRoot = await mkdtemp(path.join(tmpdir(), "agentmo-host-observe-project-"));
      const before = await snapshotHomeTree(runtime.home);
      const observation = await observeCodexHost({ projectRoot, release: release() });
      const after = await snapshotHomeTree(runtime.home);
      assert.equal(observation.marketplace.registration, "missing");
      assert.equal(observation.mutatesHost, "unknown");
      assert.equal(observation.externalCommandMutation, "unknown");
      assert.deepEqual(agentmoPaths(before), []);
      assert.deepEqual(agentmoPaths(after), []);
      assert.ok(after.some((entry) => entry.path === ".fake-codex-log.jsonl"));
    });
  });

  it("closes stdin and force-kills stubborn app servers before returning unavailable", {
    skip: process.platform === "win32",
  }, async () => {
    for (const mode of ["timeout", "malformed"]) {
      const runtime = await createRuntime(`agentmo-host-app-server-${mode}-`, {
        fakeCodex: true,
        stubbornAppServer: mode,
      });
      await withRuntime(runtime, async () => {
        const projectRoot = await mkdtemp(path.join(tmpdir(), `agentmo-host-app-server-${mode}-project-`));
        const startedAt = Date.now();
        const observation = await observeCodexHost({ projectRoot, release: release() });
        const elapsedMs = Date.now() - startedAt;
        const pid = Number(await readFile(
          path.join(runtime.home, ".fake-codex-app-server-pid"),
          "utf8",
        ));

        assert.equal(observation.availability, "unavailable");
        assert.equal(observation.mutatesHost, "unknown");
        assert.equal(observation.externalCommandMutation, "unknown");
        assert.equal(
          await readFile(path.join(runtime.home, ".fake-codex-app-server-stdin-closed"), "utf8"),
          "observed",
        );
        assert.equal(
          await readFile(path.join(runtime.home, ".fake-codex-app-server-sigterm"), "utf8"),
          "observed",
        );
        assert.throws(
          () => process.kill(pid, 0),
          (error) => error?.code === "ESRCH",
          `${mode} observation returned before the app-server child closed`,
        );
        assert.equal(elapsedMs < 10_000, true, `${mode} shutdown was not bounded`);
        if (mode === "timeout") assert.equal(elapsedMs >= 4_900, true);
        else assert.equal(elapsedMs < 4_900, true);
      });
    }
  });

  it("reaps a malformed app-server daemon and its inherited stdout before returning", {
    skip: process.platform === "win32",
  }, async () => {
    const runtime = await createRuntime("agentmo-host-app-server-daemon-", {
      fakeCodex: true,
      stubbornAppServer: "malformed-daemon",
    });
    await withRuntime(runtime, async () => {
      const projectRoot = await mkdtemp(path.join(tmpdir(), "agentmo-host-app-server-daemon-project-"));
      const startedAt = Date.now();
      const observation = await observeCodexHost({ projectRoot, release: release() });
      const elapsedMs = Date.now() - startedAt;
      const pid = Number(await readFile(
        path.join(runtime.home, ".fake-codex-app-server-pid"),
        "utf8",
      ));
      const grandchildPid = Number(await readFile(
        path.join(runtime.home, ".fake-codex-app-server-grandchild-pid"),
        "utf8",
      ));

      assert.equal(observation.availability, "unavailable");
      assert.equal(observation.mutatesHost, "unknown");
      assert.equal(observation.externalCommandMutation, "unknown");
      assert.equal(
        await readFile(path.join(runtime.home, ".fake-codex-app-server-stdin-closed"), "utf8"),
        "observed",
      );
      assert.equal(
        await readFile(path.join(runtime.home, ".fake-codex-app-server-sigterm"), "utf8"),
        "observed",
      );
      assert.equal(
        await readFile(path.join(runtime.home, ".fake-codex-app-server-grandchild-sigterm"), "utf8"),
        "observed",
      );
      for (const [subject, processId] of [["app-server", pid], ["app-server grandchild", grandchildPid]]) {
        assert.throws(
          () => process.kill(processId, 0),
          (error) => error?.code === "ESRCH",
          `observation returned before the ${subject} was reaped`,
        );
      }
      assert.equal(elapsedMs < 4_900, true, "malformed daemon did not shut down promptly");
      const serialized = JSON.stringify(observation);
      assert.equal(serialized.includes("host-app-server-daemon-value-canary"), false);
      assert.equal(serialized.includes("host-daemon-value-canary"), false);
    });
  });

  it("force-kills a stubborn PATH-shadow command before returning unavailable", {
    skip: process.platform === "win32",
  }, async () => {
    const runtime = await createRuntime("agentmo-host-command-timeout-", {
      fakeCodex: true,
      stubbornCommand: "timeout",
    });
    await withRuntime(runtime, async () => {
      const projectRoot = await mkdtemp(path.join(tmpdir(), "agentmo-host-command-timeout-project-"));
      const startedAt = Date.now();
      const observation = await observeCodexHost({ projectRoot, release: release() });
      const elapsedMs = Date.now() - startedAt;
      const pid = Number(await readFile(
        path.join(runtime.home, ".fake-codex-command-pid"),
        "utf8",
      ));

      assert.equal(observation.availability, "unavailable");
      assert.equal(observation.mutatesHost, "unknown");
      assert.equal(observation.externalCommandMutation, "unknown");
      assert.equal(
        await readFile(path.join(runtime.home, ".fake-codex-command-sigterm"), "utf8"),
        "observed",
      );
      assert.throws(
        () => process.kill(pid, 0),
        (error) => error?.code === "ESRCH",
        "command observation returned before the PATH-shadow child closed",
      );
      assert.equal(elapsedMs >= 4_900, true);
      assert.equal(elapsedMs < 10_000, true, "command shutdown was not bounded");
    });
  });

  it("reaps a PATH-shadow command daemon after its direct parent exits", {
    skip: process.platform === "win32",
  }, async () => {
    const runtime = await createRuntime("agentmo-host-command-daemon-", {
      fakeCodex: true,
      stubbornCommand: "daemon",
    });
    await withRuntime(runtime, async () => {
      const projectRoot = await mkdtemp(path.join(tmpdir(), "agentmo-host-command-daemon-project-"));
      const startedAt = Date.now();
      const observation = await observeCodexHost({ projectRoot, release: release() });
      const elapsedMs = Date.now() - startedAt;
      const pid = Number(await readFile(
        path.join(runtime.home, ".fake-codex-command-pid"),
        "utf8",
      ));
      const grandchildPid = Number(await readFile(
        path.join(runtime.home, ".fake-codex-command-grandchild-pid"),
        "utf8",
      ));

      assert.equal(observation.availability, "unavailable");
      assert.equal(observation.mutatesHost, "unknown");
      assert.equal(observation.externalCommandMutation, "unknown");
      assert.equal(
        await readFile(path.join(runtime.home, ".fake-codex-command-grandchild-sigterm"), "utf8"),
        "observed",
      );
      for (const [subject, processId] of [["command", pid], ["command grandchild", grandchildPid]]) {
        assert.throws(
          () => process.kill(processId, 0),
          (error) => error?.code === "ESRCH",
          `observation returned before the ${subject} was reaped`,
        );
      }
      assert.equal(elapsedMs < 4_900, true, "daemonized command did not shut down promptly");
      const serialized = JSON.stringify(observation);
      assert.equal(serialized.includes("host-command-daemon-value-canary"), false);
      assert.equal(serialized.includes("host-daemon-value-canary"), false);
    });
  });

  it("bounds an escaped stdout-holding PATH-shadow command after its direct parent exits", {
    skip: process.platform === "win32",
    timeout: 20_000,
  }, async () => {
    const runtime = await createRuntime("agentmo-host-command-escaped-daemon-", {
      fakeCodex: true,
      stubbornCommand: "escaped-daemon",
    });
    await withRuntime(runtime, async () => {
      const projectRoot = await mkdtemp(path.join(tmpdir(), "agentmo-host-command-escaped-project-"));
      let escapedPid = null;
      let observationPromise = null;
      try {
        observationPromise = observeCodexHost({ projectRoot, release: release() });
        await waitForFile(
          path.join(runtime.home, ".fake-codex-command-escaped-parent-exit"),
          10_000,
          "escaped PATH-shadow command parent did not reach exit lifecycle",
        );
        const startedAt = Date.now();
        const observation = await settleWithin(
          observationPromise,
          4_000,
          "escaped PATH-shadow command left host observation unbounded",
        );
        const elapsedMs = Date.now() - startedAt;
        escapedPid = await readEscapedGrandchildPid(runtime, "command-escaped");

        assert.equal(observation.availability, "unavailable");
        assert.equal(elapsedMs < 2_500, true, "escaped command did not settle promptly");
        const serialized = JSON.stringify(observation);
        for (const value of [
          "host-command-escaped-parent-canary",
          "host-escaped-stdout-value-canary",
        ]) {
          assert.equal(serialized.includes(value), false, value);
        }
        assert.doesNotThrow(
          () => process.kill(escapedPid, 0),
          "test fixture did not retain an escaped stdout holder",
        );
      } finally {
        if (escapedPid === null) {
          try {
            escapedPid = await readEscapedGrandchildPid(runtime, "command-escaped");
          } catch (error) {
            if (error?.code !== "ENOENT") throw error;
          }
        }
        await terminateEscapedProcess(escapedPid, "command");
        if (observationPromise !== null) {
          await settleWithin(
            observationPromise,
            2_000,
            "host observation did not settle after command fixture cleanup",
          );
        }
      }
    });
  });

  it("rejects marketplace JSON emitted by a short-lived escaped command child after parent exit", {
    skip: process.platform === "win32",
    timeout: SHORT_LIVED_FIXTURE_TIMEOUT_MS,
  }, async () => {
    const runtime = await createRuntime("agentmo-host-command-post-exit-json-", {
      fakeCodex: true,
      stubbornCommand: "escaped-post-exit-json",
    });
    await withRuntime(runtime, async () => {
      const projectRoot = await mkdtemp(path.join(tmpdir(), "agentmo-host-command-post-exit-json-project-"));
      let observationPromise = null;
      let bodyError = null;
      let drainError = null;
      try {
        observationPromise = observeCodexHost({ projectRoot, release: release() });
        await waitForFile(
          path.join(runtime.home, ".fake-codex-command-post-exit-parent-reaped"),
          SHORT_LIVED_REAP_MARKER_TIMEOUT_MS,
          "escaped command fixture did not observe its direct parent as reaped",
        );
        const startedAt = Date.now();
        const observation = await settleWithin(
          observationPromise,
          SHORT_LIVED_OBSERVATION_TIMEOUT_MS,
          "post-exit marketplace JSON left host observation unbounded",
        );
        const elapsedMs = Date.now() - startedAt;

        await waitForFile(
          path.join(runtime.home, ".fake-codex-command-post-exit-json-emitted"),
          SHORT_LIVED_REAP_MARKER_TIMEOUT_MS,
          "escaped command fixture did not attempt its post-exit JSON write",
        );
        assert.equal(observation.availability, "unavailable");
        assert.equal(observation.marketplace.registration, "ambiguous");
        assert.equal(observation.marketplace.sourceMatch, false);
        assert.equal(observation.plugin.sourceMatch, false);
        assert.equal(elapsedMs < 2_500, true, "post-exit command did not settle promptly");
      } catch (error) {
        bodyError = error;
      } finally {
        drainError = await drainShortLivedObservation(observationPromise);
      }
      if (bodyError !== null && drainError !== null) {
        throw new AggregateError([bodyError, drainError], "Short-lived fixture and drain failed.");
      }
      if (bodyError !== null) throw bodyError;
      if (drainError !== null) throw drainError;
    });
  });

  it("bounds an escaped stdout-holding app-server after its direct parent exits", {
    skip: process.platform === "win32",
    timeout: 20_000,
  }, async () => {
    const runtime = await createRuntime("agentmo-host-app-server-escaped-daemon-", {
      fakeCodex: true,
      stubbornAppServer: "escaped-daemon",
    });
    await withRuntime(runtime, async () => {
      const projectRoot = await mkdtemp(path.join(tmpdir(), "agentmo-host-app-server-escaped-project-"));
      let escapedPid = null;
      let observationPromise = null;
      try {
        observationPromise = observeCodexHost({ projectRoot, release: release() });
        await waitForFile(
          path.join(runtime.home, ".fake-codex-app-server-escaped-parent-exit"),
          10_000,
          "escaped app-server parent did not reach exit lifecycle",
        );
        const startedAt = Date.now();
        const observation = await settleWithin(
          observationPromise,
          4_000,
          "escaped app-server left host observation unbounded",
        );
        const elapsedMs = Date.now() - startedAt;
        escapedPid = await readEscapedGrandchildPid(runtime, "app-server-escaped");

        assert.equal(observation.availability, "unavailable");
        assert.equal(elapsedMs < 2_500, true, "escaped app-server did not settle promptly");
        const serialized = JSON.stringify(observation);
        for (const value of [
          "host-app-server-escaped-parent-canary",
          "host-escaped-stdout-value-canary",
        ]) {
          assert.equal(serialized.includes(value), false, value);
        }
        assert.doesNotThrow(
          () => process.kill(escapedPid, 0),
          "test fixture did not retain an escaped stdout holder",
        );
      } finally {
        if (escapedPid === null) {
          try {
            escapedPid = await readEscapedGrandchildPid(runtime, "app-server-escaped");
          } catch (error) {
            if (error?.code !== "ENOENT") throw error;
          }
        }
        await terminateEscapedProcess(escapedPid, "app-server");
        if (observationPromise !== null) {
          await settleWithin(
            observationPromise,
            2_000,
            "host observation did not settle after app-server fixture cleanup",
          );
        }
      }
    });
  });

  it("downgrades PATH-shadow trusted hook output to pending human confirmation", async () => {
    const runtime = await createRuntime("agentmo-host-forged-trust-", {
      fakeCodex: true,
      fakeHookTrust: "trusted",
    });
    await withRuntime(runtime, async () => {
      const projectRoot = await mkdtemp(path.join(tmpdir(), "agentmo-host-forged-trust-project-"));
      await mkdir(path.join(runtime.marketplaceRoot, "plugins", "agentmo"), {
        recursive: true,
        mode: 0o700,
      });
      await writeFile(runtime.fakeStatePath, JSON.stringify({
        marketplaceRoot: runtime.marketplaceRoot,
        installed: true,
      }), { mode: 0o600 });
      const observation = await observeCodexHost({ projectRoot, release: release() });

      assert.equal(observation.availability, "observed");
      assert.equal(observation.plugin.installation, "installed");
      assert.equal(observation.plugin.enabled, true);
      assert.equal(observation.plugin.sourceMatch, true);
      assert.equal(observation.plugin.releaseMatch, true);
      assert.equal(observation.skill.visibility, "visible");
      assert.equal(observation.hooks.visibility, "visible");
      assert.equal(observation.hooks.trust, "pending-human");
      assert.equal(observation.trust, "pending-human");
    });
  });

  it("deactivation preserves project bytes, host registrations, owner evidence, and consumer evidence", async () => {
    const runtime = await createRuntime("agentmo-host-deactivate-", { fakeCodex: true });
    await withRuntime(runtime, async () => {
      const projectRoot = await mkdtemp(path.join(tmpdir(), "agentmo-host-deactivate-project-"));
      const probe = compatibleProbe();
      const preview = await planBuilderInstall({
        projectRoot,
        probe,
        hostScope: "user",
      });
      const installed = await applyBuilderInstall({
        projectRoot,
        probe,
        hostScope: "user",
        expectedPlanDigest: preview.planDigest,
      });
      const receiptPath = path.join(projectRoot, ...installed.receipt.path.split("/"));
      const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
      assert.equal(receipt.schemaVersion, "agentmo.builder-install-receipt.v4");
      assert.equal(
        receipt.hostActivation.schemaVersion,
        "agentmo.builder-codex-activation-binding.v3",
      );
      assert.equal(
        receipt.hostActivation.finalProjectionBinding.schemaVersion,
        "agentmo.codex-marketplace-projection-binding.v1",
      );
      const stateBefore = await readCodexSelectorState();
      assert.equal(stateBefore.owner.status, "valid");
      assert.equal(stateBefore.ledger.status, "valid");
      const launcherPath = path.join(projectRoot, ".codex", "agents", "agentmo.toml");
      const before = {
        receiptBytes: await readFile(receiptPath),
        launcherBytes: await readFile(launcherPath),
        receiptIdentity: identity(await stat(receiptPath, { bigint: true })),
        launcherIdentity: identity(await stat(launcherPath, { bigint: true })),
        ownerDigest: stateBefore.owner.digest,
        ledgerDigest: stateBefore.ledger.digest,
        codexLog: await readFile(runtime.fakeLogPath),
      };

      const deactivation = await planBuilderDeactivate({
        projectRoot,
        expectedReceiptDigest: installed.receipt.digest,
      });
      const result = await applyBuilderDeactivate({
        projectRoot,
        expectedReceiptDigest: installed.receipt.digest,
        expectedPlanDigest: deactivation.planDigest,
      });
      assert.equal(result.status, "deactivated");
      assert.equal(result.hostMutation, false);
      assert.deepEqual(await readFile(runtime.fakeLogPath), before.codexLog);
      assert.deepEqual(await readFile(receiptPath), before.receiptBytes);
      assert.deepEqual(await readFile(launcherPath), before.launcherBytes);
      assert.deepEqual(identity(await stat(receiptPath, { bigint: true })), before.receiptIdentity);
      assert.deepEqual(identity(await stat(launcherPath, { bigint: true })), before.launcherIdentity);
      const stateAfter = await readCodexSelectorState();
      assert.equal(stateAfter.owner.digest, before.ownerDigest);
      assert.equal(stateAfter.ledger.digest, before.ledgerDigest);
      const fakeState = JSON.parse(await readFile(runtime.fakeStatePath, "utf8"));
      assert.equal(fakeState.installed, true);
      assert.equal(fakeState.marketplaceRoot, runtime.marketplaceRoot);
    });
  });

  it("keeps selector removal, host migration, and host transfer fail-closed", async () => {
    for (const operation of [
      planBuilderHostSelectorRemoval,
      applyBuilderHostSelectorRemoval,
      planBuilderHostProjectionMigration,
      applyBuilderHostProjectionMigration,
      planBuilderHostProjectionTransfer,
      applyBuilderHostProjectionTransfer,
    ]) {
      await assert.rejects(operation({}), rejected("AGENTMO_BUILDER_V1_PHYSICAL_REMOVAL_UNSUPPORTED"));
    }
  });

  it("binds owner successors to an immutable predecessor and makes exact retries idempotent", async () => {
    const runtime = await createRuntime("agentmo-host-authority-owner-");
    await withRuntime(runtime, async () => {
      const selector = buildCodexHostSelector(release());
      const owner = buildCodexSelectorOwnerRecord({
        selector,
        disposition: "created-by-agentmo",
        release: release(),
        sourceDigest: SOURCE_DIGEST,
      });
      const reservation = await acquireCodexSelectorStateReservation({
        purpose: "activation",
        bindingDigest: RELEASE_DIGEST,
        expectedOwnerDigest: null,
        expectedOwnerIdentityDigest: null,
        expectedLedgerDigest: null,
        expectedLedgerIdentityDigest: null,
      });
      const first = await writeCodexSelectorOwnerRecord(owner, {
        expectedPriorDigest: null,
        expectedPriorIdentityDigest: null,
        reservation,
      });
      const authorityEntries = path.join(
        runtime.stateRoot,
        ".codex-selector-state-authority",
        "entries",
      );
      const entriesAfterFirst = await readdir(authorityEntries);
      const retry = await writeCodexSelectorOwnerRecord(owner, {
        expectedPriorDigest: null,
        expectedPriorIdentityDigest: null,
        reservation,
      });
      assert.equal(retry.digest, first.digest);
      assert.equal(retry.identityDigest, first.identityDigest);
      assert.deepEqual(await readdir(authorityEntries), entriesAfterFirst);

      await assert.rejects(
        writeCodexSelectorOwnerRecord({ ...owner, sourceDigest: `sha256:${"d".repeat(64)}` }, {
          expectedPriorDigest: null,
          expectedPriorIdentityDigest: null,
          reservation,
        }),
        rejected("AGENTMO_CODEX_HOST_CAS_MISMATCH"),
      );
      const after = await readCodexSelectorState();
      assert.equal(after.owner.digest, first.digest);

      await assert.rejects(
        restoreCodexSelectorOwnerState(
          { status: "missing", digest: null, identityDigest: null, value: null },
          first.digest,
          { reservation },
        ),
        rejected("AGENTMO_CODEX_HOST_IMMUTABLE_STATE"),
      );
      await releaseCodexSelectorStateReservation(reservation, "committed");
    });
  });

  it("fails closed on an unregistered hardlink without changing authority bytes", async () => {
    const runtime = await createRuntime("agentmo-host-authority-link-");
    await withRuntime(runtime, async () => {
      const selector = buildCodexHostSelector(release());
      const owner = buildCodexSelectorOwnerRecord({
        selector,
        disposition: "created-by-agentmo",
        release: release(),
        sourceDigest: SOURCE_DIGEST,
      });
      await writeCodexSelectorOwnerRecord(owner, {
        expectedPriorDigest: null,
        expectedPriorIdentityDigest: null,
      });
      const entriesRoot = path.join(
        runtime.stateRoot,
        ".codex-selector-state-authority",
        "entries",
      );
      const [entryName] = await readdir(entriesRoot);
      const entryPath = path.join(entriesRoot, entryName);
      const before = await readFile(entryPath);
      const foreignLink = path.join(runtime.stateRoot, "foreign-owner-link.json");
      await link(entryPath, foreignLink);

      const observed = await readCodexSelectorState();
      assert.equal(observed.owner.status, "inconsistent");
      assert.equal(observed.ledger.status, "inconsistent");
      assert.deepEqual(await readFile(entryPath), before);
      assert.deepEqual(await readFile(foreignLink), before);
    });
  });

  it("fails closed on a symlinked legacy owner without changing target bytes", async () => {
    const runtime = await createRuntime("agentmo-host-authority-symlink-");
    await withRuntime(runtime, async () => {
      await mkdir(runtime.stateRoot, { recursive: true, mode: 0o700 });
      const selector = buildCodexHostSelector(release());
      const owner = buildCodexSelectorOwnerRecord({
        selector,
        disposition: "created-by-agentmo",
        release: release(),
        sourceDigest: SOURCE_DIGEST,
      });
      const target = path.join(runtime.stateRoot, "foreign-owner.json");
      const targetBytes = Buffer.from(serializePersistableJson(owner, {
        subject: "codex-selector-owner.json",
      }), "utf8");
      await writeFile(target, targetBytes, { mode: 0o600 });
      await symlink(target, path.join(runtime.stateRoot, "codex-selector-owner.json"));

      const observed = await readCodexSelectorState();
      assert.equal(observed.owner.status, "inconsistent");
      assert.equal(observed.ledger.status, "inconsistent");
      assert.deepEqual(await readFile(target), targetBytes);
    });
  });

  it("rejects a late foreign canonical occupant and leaves its bytes untouched", async () => {
    const runtime = await createRuntime("agentmo-host-authority-occupant-");
    await withRuntime(runtime, async () => {
      const selector = buildCodexHostSelector(release());
      const owner = buildCodexSelectorOwnerRecord({
        selector,
        disposition: "created-by-agentmo",
        release: release(),
        sourceDigest: SOURCE_DIGEST,
      });
      const reservation = await acquireCodexSelectorStateReservation({
        purpose: "activation",
        bindingDigest: RELEASE_DIGEST,
        expectedOwnerDigest: null,
        expectedOwnerIdentityDigest: null,
        expectedLedgerDigest: null,
        expectedLedgerIdentityDigest: null,
      });
      const occupantPath = path.join(runtime.stateRoot, "codex-selector-owner.json");
      const occupant = Buffer.from("foreign-owner\n", "utf8");
      await writeFile(occupantPath, occupant, { mode: 0o600 });

      await assert.rejects(
        writeCodexSelectorOwnerRecord(owner, {
          expectedPriorDigest: null,
          expectedPriorIdentityDigest: null,
          reservation,
        }),
        rejected("AGENTMO_CODEX_HOST_RESERVATION_CHANGED"),
      );
      assert.deepEqual(await readFile(occupantPath), occupant);
    });
  });

  it("keeps released reservation history and makes physical retraction unsupported", async () => {
    const runtime = await createRuntime("agentmo-host-authority-release-");
    await withRuntime(runtime, async () => {
      const reservation = await acquireCodexSelectorStateReservation({
        purpose: "activation",
        bindingDigest: RELEASE_DIGEST,
        expectedOwnerDigest: null,
        expectedOwnerIdentityDigest: null,
        expectedLedgerDigest: null,
        expectedLedgerIdentityDigest: null,
      });
      await releaseCodexSelectorStateReservation(reservation, "aborted");
      const authorityRoot = path.join(runtime.stateRoot, ".codex-selector-state-authority");
      assert.ok((await readdir(path.join(authorityRoot, "entries"))).length >= 2);
      await assert.rejects(
        retractCodexSelectorState({}),
        rejected("AGENTMO_CODEX_HOST_IMMUTABLE_STATE"),
      );
    });
  });

  it("recovers an exact reservation after real process death at a durable claim", async () => {
    const runtime = await createRuntime("agentmo-host-claim-recovery-");
    await withRuntime(runtime, async () => {
      const warmup = await acquireCodexSelectorStateReservation({
        purpose: "activation",
        bindingDigest: `sha256:${"d".repeat(64)}`,
        expectedOwnerDigest: null,
        expectedOwnerIdentityDigest: null,
        expectedLedgerDigest: null,
        expectedLedgerIdentityDigest: null,
      });
      await releaseCodexSelectorStateReservation(warmup, "aborted");
      const request = {
        purpose: "activation",
        bindingDigest: RELEASE_DIGEST,
        expectedOwnerDigest: null,
        expectedOwnerIdentityDigest: null,
        expectedLedgerDigest: null,
        expectedLedgerIdentityDigest: null,
      };
      await killReservationAtClaim(runtime, request);

      const readable = await readCodexSelectorState();
      assert.equal(readable.owner.status, "missing");
      assert.equal(readable.ledger.status, "missing");
      await assert.rejects(
        acquireCodexSelectorStateReservation({
          ...request,
          bindingDigest: `sha256:${"e".repeat(64)}`,
        }),
        (error) => [
          "AGENTMO_CODEX_HOST_STATE_RESERVED",
          "AGENTMO_CODEX_HOST_RESERVATION_CHANGED",
        ].includes(error?.code),
      );

      const recovered = await acquireCodexSelectorStateReservation(request);
      await releaseCodexSelectorStateReservation(recovered, "committed");
      const stable = await readCodexSelectorState();
      assert.equal(stable.owner.status, "missing");
      assert.equal(stable.ledger.status, "missing");
    });
  });

  it("CAS-binds concurrent reservation claims and never retires marketplace bytes", async () => {
    const runtime = await createRuntime("agentmo-host-authority-cas-");
    await withRuntime(runtime, async () => {
      const request = {
        purpose: "activation",
        bindingDigest: RELEASE_DIGEST,
        expectedOwnerDigest: null,
        expectedOwnerIdentityDigest: null,
        expectedLedgerDigest: null,
        expectedLedgerIdentityDigest: null,
      };
      const claims = await Promise.allSettled([
        acquireCodexSelectorStateReservation(request),
        acquireCodexSelectorStateReservation({
          ...request,
          bindingDigest: `sha256:${"e".repeat(64)}`,
        }),
      ]);
      assert.equal(claims.filter((claim) => claim.status === "fulfilled").length, 1);
      assert.equal(claims.filter((claim) => claim.status === "rejected").length, 1);
      assert.ok([
        "AGENTMO_CODEX_HOST_STATE_RESERVED",
        "AGENTMO_CODEX_HOST_RESERVATION_CHANGED",
      ].includes(claims.find((claim) => claim.status === "rejected").reason?.code));
      const first = claims.find((claim) => claim.status === "fulfilled").value;
      const exactRetry = await acquireCodexSelectorStateReservation(
        claims[0].status === "fulfilled"
          ? request
          : { ...request, bindingDigest: `sha256:${"e".repeat(64)}` },
      );
      await releaseCodexSelectorStateReservation(exactRetry, "committed");
      await assert.rejects(
        releaseCodexSelectorStateReservation(first, "committed"),
        rejected("AGENTMO_CODEX_HOST_RESERVATION_CHANGED"),
      );

      await mkdir(path.join(runtime.marketplaceRoot, "plugins", "agentmo"), {
        recursive: true,
        mode: 0o700,
      });
      const authority = await inspectCodexMarketplaceProjectionAuthority();
      const before = await stat(runtime.marketplaceRoot, { bigint: true });
      await assert.rejects(
        retireCodexMarketplaceProjectionAuthority({
          expectedContentDigest: authority.contentDigest,
          expectedRootIdentityDigest: authority.rootIdentityDigest,
        }),
        rejected("AGENTMO_CODEX_HOST_PHYSICAL_RETIREMENT_UNSUPPORTED"),
      );
      const after = await stat(runtime.marketplaceRoot, { bigint: true });
      assert.deepEqual(identity(after), identity(before));
    });
  });

  it("admits a canonical v1 owner only as immutable genesis for an append-only successor", async () => {
    const runtime = await createRuntime("agentmo-host-authority-legacy-");
    await withRuntime(runtime, async () => {
      await mkdir(runtime.stateRoot, { recursive: true, mode: 0o700 });
      const selector = buildCodexHostSelector(release());
      const genesis = buildCodexSelectorOwnerRecord({
        selector,
        disposition: "created-by-agentmo",
        release: release(),
        sourceDigest: SOURCE_DIGEST,
      });
      const genesisPath = path.join(runtime.stateRoot, "codex-selector-owner.json");
      const genesisBytes = Buffer.from(serializePersistableJson(genesis, {
        subject: "codex-selector-owner.json",
      }), "utf8");
      await writeFile(genesisPath, genesisBytes, { mode: 0o600 });
      const genesisStats = await stat(genesisPath, { bigint: true });
      const before = await readCodexSelectorState();
      assert.equal(before.owner.digest, digestCodexSelectorOwnerRecord(genesis));

      const successor = buildCodexSelectorOwnerRecord({
        ...genesis,
        sourceDigest: `sha256:${"f".repeat(64)}`,
      });
      const written = await writeCodexSelectorOwnerRecord(successor, {
        expectedPriorDigest: before.owner.digest,
        expectedPriorIdentityDigest: before.owner.identityDigest,
      });
      assert.equal(written.status, "published");
      const after = await readCodexSelectorState();
      assert.equal(after.owner.digest, digestCodexSelectorOwnerRecord(successor));
      assert.deepEqual(await readFile(genesisPath), genesisBytes);
      assert.deepEqual(identity(await stat(genesisPath, { bigint: true })), identity(genesisStats));
    });
  });
});
