import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  chmod,
  cp,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, it } from "node:test";
import { promisify } from "node:util";
import { digestRawBytes } from "../src/artifact-admission.js";
import {
  BUILDER_NPM_METADATA_FILES,
  BUILDER_PLUGIN_HOOK_IO_SURFACE_INVENTORY,
  BUILDER_RELEASE_ASSET_INVENTORY,
  admitBuilderUatReleasePair,
  loadBuilderPackage,
  readBoundedBuilderUatReleaseFile,
  validateBuilderNpmTarballInventory,
} from "../src/builder-package.js";
import { serializePersistableJson } from "../src/persistability.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);
const RELEASE_BUILDER_PATH = path.join(REPO_ROOT, "scripts", "build-builder-uat-releases.js");
const MAIN_TEST_LANE = process.env.AGENTMO_TEST_LANE === "main";
const RELEASE_PHASE_READY_DEADLINE_MS = 30_000;

function releaseBuilderArguments(
  outDirectory,
  baselineVersion,
  successorVersion,
  releaseBuilderPath = RELEASE_BUILDER_PATH,
) {
  return [
    releaseBuilderPath,
    "--out", outDirectory,
    "--baseline-version", baselineVersion,
    "--successor-version", successorVersion,
    "--json",
  ];
}

async function runReleaseBuilder(outDirectory, baselineVersion, successorVersion, options = {}) {
  const releaseBuilderPath = options.releaseBuilderPath ?? RELEASE_BUILDER_PATH;
  try {
    const result = await execFileAsync(process.execPath, releaseBuilderArguments(
      outDirectory,
      baselineVersion,
      successorVersion,
      releaseBuilderPath,
    ), {
      cwd: options.cwd ?? REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      env: process.env,
    });
    return { code: 0, signal: null, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      code: error.code,
      signal: error.signal ?? null,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

function startReleaseBuilder(outDirectory, baselineVersion, successorVersion) {
  const child = spawn(
    process.execPath,
    releaseBuilderArguments(outDirectory, baselineVersion, successorVersion),
    {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const lifecycle = trackReleaseBuilderChild(child);
  return { child, ...lifecycle };
}

function trackReleaseBuilderChild(child) {
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  let errorRecord = null;
  let exitRecord = null;
  let closeRecord = null;
  let killRecord = null;
  let spawned = false;
  let resolveCompleted;
  let resolveClosed;
  let completedSettled = false;
  const completed = new Promise((resolve) => { resolveCompleted = resolve; });
  const closed = new Promise((resolve) => { resolveClosed = resolve; });
  child.once("spawn", () => {
    spawned = true;
  });
  child.once("error", (error) => {
    errorRecord = Object.freeze({
      termination: spawned ? "lifecycle-failed" : "launch-failed",
      code: null,
      signal: null,
      errorCode: typeof error?.code === "string" ? error.code : "unknown",
    });
    if (!completedSettled) {
      completedSettled = true;
      resolveCompleted(errorRecord);
    }
  });
  child.once("exit", (code, signal) => {
    exitRecord = Object.freeze({ code, signal });
  });
  child.once("close", (code, signal) => {
    closeRecord = Object.freeze({
      termination: "closed",
      code,
      signal,
      stdout,
      stderr,
    });
    resolveClosed(closeRecord);
    if (!completedSettled) {
      completedSettled = true;
      resolveCompleted(closeRecord);
    }
  });
  return {
    completed,
    closed,
    lifecycleStatus() {
      return Object.freeze({
        error: errorRecord,
        exit: exitRecord,
        close: closeRecord,
        kill: killRecord,
      });
    },
    sendKill(signal, purpose) {
      if (errorRecord !== null || exitRecord !== null || closeRecord !== null
          || child.exitCode !== null || child.signalCode !== null) return false;
      if (killRecord !== null) return false;
      killRecord = Object.freeze({ signal, purpose, result: "attempting" });
      let accepted;
      try {
        accepted = child.kill(signal);
      } catch (error) {
        killRecord = Object.freeze({ signal, purpose, result: "threw" });
        throw error;
      }
      if (accepted !== true) {
        killRecord = Object.freeze({ signal, purpose, result: "rejected" });
        throw new Error("Release producer termination was not accepted.");
      }
      killRecord = Object.freeze({ signal, purpose, result: "accepted" });
      return true;
    },
  };
}

function fakeReleaseBuilderChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.signalCode = null;
  child.killCalls = [];
  child.kill = (signal) => {
    child.killCalls.push(signal);
    return true;
  };
  return child;
}

function settleWithin(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function waitForRetainedBaselinePhase(
  root,
  baselineName,
  successorName,
  execution,
  timeoutMs,
) {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  while (Date.now() < deadline) {
    assertReleaseBuilderActive(execution);
    const scratchName = (await readdir(root))
      .find((name) => name.startsWith(".agentmo-builder-uat-build-"));
    if (scratchName !== undefined) {
      const scratchRoot = path.join(root, scratchName);
      const baselineIsRegularFile = await lstat(
        path.join(scratchRoot, "publish", baselineName),
      ).then((stats) => stats.isFile(), (error) => {
        if (error?.code === "ENOENT") return false;
        throw error;
      });
      const successorAbsent = await lstat(
        path.join(scratchRoot, "publish", successorName),
      ).then(() => false, (error) => {
        if (error?.code === "ENOENT") return true;
        throw error;
      });
      if (baselineIsRegularFile && successorAbsent) {
        assertReleaseBuilderActive(execution);
        return { scratchRoot, elapsedMs: Date.now() - startedAt };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("Retained baseline phase did not become ready within its safety deadline.");
}

function assertReleaseBuilderActive(execution) {
  const status = execution.lifecycleStatus();
  if (status.error !== null || status.exit !== null || status.close !== null
      || execution.child.exitCode !== null || execution.child.signalCode !== null) {
    throw new Error("Release producer terminated before the retained baseline phase.");
  }
}

async function cleanupReleaseExecution(execution) {
  try {
    const initialStatus = execution.lifecycleStatus();
    if (initialStatus.error !== null && initialStatus.exit === null && initialStatus.close === null) {
      await settleWithin(execution.closed, 5_000, "release producer error close");
      return null;
    }
    if (initialStatus.close === null && initialStatus.kill === null) {
      execution.sendKill("SIGKILL", "cleanup");
    }
    if (execution.lifecycleStatus().close === null) {
      await settleWithin(execution.closed, 5_000, "release producer cleanup close");
    }
    return null;
  } catch (error) {
    return error;
  }
}

function fileIdentity(stats) {
  return Object.freeze({
    device: stats.dev.toString(10),
    inode: stats.ino.toString(10),
    links: stats.nlink.toString(10),
    mode: stats.mode.toString(8),
    size: stats.size.toString(10),
  });
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
      { id: "host-doctor", requirement: "optional", status: "degraded" },
    ],
    required: { ok: true, missing: [], incompatible: [] },
  };
}

const BUILDER_INSTALL_MODULE_URL = pathToFileURL(
  path.join(REPO_ROOT, "src", "builder-install.js"),
).href;
const EXTERNAL_INSTALL_SOURCE = String.raw`
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  applyBuilderInstall,
  planBuilderInstall,
} from ${JSON.stringify(BUILDER_INSTALL_MODULE_URL)};

const projectRoot = process.argv[1];
const probe = ${JSON.stringify(compatibleProbe())};
const preview = await planBuilderInstall({ projectRoot, probe, hostScope: "user" });
const result = await applyBuilderInstall({
  projectRoot,
  probe,
  hostScope: "user",
  expectedPlanDigest: preview.planDigest,
});
const receiptBytes = await readFile(
  path.join(projectRoot, ".agentmo", "builder", "install-receipt.json"),
);
process.stdout.write(JSON.stringify({
  result,
  receipt: JSON.parse(receiptBytes),
  receiptDigest: result.receipt.digest,
}));
`;
const EXTERNAL_PACKAGE_LOAD_SOURCE = String.raw`
const moduleUrl = process.argv[1];
const request = JSON.parse(process.argv[2]);
const loaded = await import(moduleUrl + "?external=" + process.pid + "-" + Date.now());
try {
  const result = request.action === "diagnose"
    ? await loaded.inspectBuilderPackageForDiagnostics(request.options)
    : await loaded.loadBuilderPackage(request.options);
  process.stdout.write(JSON.stringify({
    ok: true,
    result: request.action === "diagnose"
      ? result
      : {
          name: result.name,
          version: result.version,
          adapterId: result.adapterId,
          releaseDigest: result.releaseDigest,
        },
  }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, code: error?.code ?? null }));
}
`;
const EXTERNAL_CODEX_SOURCE = `#!/usr/bin/env node
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

function runExternalNode(source, args, environment) {
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", source, ...args],
    {
      cwd: REPO_ROOT,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

async function copyPackage(destination) {
  await mkdir(destination, { recursive: true });
  const sourcePaths = [
    ...BUILDER_RELEASE_ASSET_INVENTORY.map((asset) => asset.sourcePath),
    ...BUILDER_NPM_METADATA_FILES,
  ];
  for (const relativePath of sourcePaths) {
    const target = path.join(destination, ...relativePath.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(REPO_ROOT, ...relativePath.split("/")), target);
  }
  return realpath(destination);
}

async function appendCli(packageRoot, source) {
  const cliPath = path.join(packageRoot, "src", "cli.js");
  await writeFile(cliPath, `${await readFile(cliPath, "utf8")}\n${source}\n`, "utf8");
}

async function hostilePackage(prefix, source) {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  const packageRoot = await copyPackage(path.join(root, "package"));
  await appendCli(packageRoot, source);
  return packageRoot;
}

async function expectPackageRejection(packageRoot, code = "AGENTMO_BUILDER_PACKAGE_IMPORT_UNLISTED") {
  await assert.rejects(
    loadBuilderPackage({ packageRoot }),
    (error) => error?.code === code,
  );
}

async function installStableActivatedPackage() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "agentmo-stable-security-")));
  const home = path.join(root, "home");
  const project = path.join(root, "project");
  const codexHome = path.join(home, ".codex");
  const bin = path.join(home, "bin");
  await Promise.all([
    mkdir(project, { mode: 0o700 }),
    mkdir(codexHome, { recursive: true, mode: 0o700 }),
    mkdir(bin, { recursive: true, mode: 0o700 }),
  ]);
  await chmod(home, 0o700);
  await chmod(project, 0o700);
  const codexPath = path.join(bin, "codex");
  await writeFile(codexPath, EXTERNAL_CODEX_SOURCE, { flag: "wx", mode: 0o700 });
  await chmod(codexPath, 0o700);
  const environment = {
    ...process.env,
    HOME: home,
    CODEX_HOME: codexHome,
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
  };
  const installed = await runExternalNode(
    EXTERNAL_INSTALL_SOURCE,
    [project],
    environment,
  );
  assert.equal(installed.signal, null, installed.stderr);
  assert.equal(installed.code, 0, installed.stderr);
  const result = JSON.parse(installed.stdout);
  assert.equal(result.result.status, "activated");
  assert.equal(result.receipt.schemaVersion, "agentmo.builder-install-receipt.v4");
  assert.equal(result.receipt.status, "activated");
  assert.equal(
    result.receipt.hostActivation.schemaVersion,
    "agentmo.builder-codex-activation-binding.v3",
  );
  assert.equal(
    result.receipt.hostActivation.finalProjectionBinding.schemaVersion,
    "agentmo.codex-marketplace-projection-binding.v1",
  );
  const stateRoot = path.join(home, ".agentmo", "builder", "codex-host");
  const modulePath = path.join(
    stateRoot,
    "marketplace/agentmo-local/plugins/agentmo/runtime/agentmo/src/builder-package.js",
  );
  const projectedModulePath = path.join(
    project,
    "plugins/agentmo/runtime/agentmo/src/builder-package.js",
  );
  const stablePackageRoot = path.resolve(modulePath, "..", "..");
  const projectedPackageRoot = path.resolve(projectedModulePath, "..", "..");
  const authority = {
    projectRoot: project,
    expectedReceiptDigest: result.receiptDigest,
  };
  return {
    authority,
    environment,
    home,
    modulePath,
    moduleUrl: pathToFileURL(modulePath).href,
    project,
    projectedPackageRoot,
    projectedModuleUrl: pathToFileURL(projectedModulePath).href,
    receipt: result.receipt,
    receiptDigest: result.receiptDigest,
    stablePackageRoot,
    stateRoot,
  };
}

async function callStablePackage(
  installed,
  action = "load",
  options = installed.authority,
  moduleUrl = installed.moduleUrl,
) {
  const execution = await runExternalNode(
    EXTERNAL_PACKAGE_LOAD_SOURCE,
    [moduleUrl, JSON.stringify({ action, options })],
    installed.environment,
  );
  assert.equal(execution.signal, null, execution.stderr);
  assert.equal(execution.code, 0, execution.stderr);
  return JSON.parse(execution.stdout);
}

describe("Builder package trust boundaries", () => {
  it("fails closed across release producer error, exit, close, and single-kill cleanup", async () => {
    const spawnFailure = fakeReleaseBuilderChild();
    const spawnFailureLifecycle = trackReleaseBuilderChild(spawnFailure);
    const spawnError = new Error("synthetic spawn failure");
    spawnError.code = "ENOENT";
    spawnFailure.emit("error", spawnError);
    assert.deepEqual(
      await settleWithin(spawnFailureLifecycle.completed, 100, "spawn failure lifecycle"),
      { termination: "launch-failed", code: null, signal: null, errorCode: "ENOENT" },
    );
    assert.throws(
      () => assertReleaseBuilderActive({ child: spawnFailure, ...spawnFailureLifecycle }),
      /terminated before the retained baseline phase/u,
    );
    const spawnFailureCleanup = cleanupReleaseExecution({
      child: spawnFailure,
      ...spawnFailureLifecycle,
    });
    queueMicrotask(() => spawnFailure.emit("close", null, null));
    assert.equal(await spawnFailureCleanup, null);
    assert.deepEqual(spawnFailure.killCalls, []);

    for (const terminal of [
      { code: 7, signal: null },
      { code: null, signal: "SIGTERM" },
    ]) {
      const child = fakeReleaseBuilderChild();
      const lifecycle = trackReleaseBuilderChild(child);
      child.exitCode = terminal.code;
      child.signalCode = terminal.signal;
      child.emit("exit", terminal.code, terminal.signal);
      child.emit("close", terminal.code, terminal.signal);
      assert.deepEqual(await lifecycle.completed, {
        termination: "closed",
        ...terminal,
        stdout: "",
        stderr: "",
      });
      const execution = { child, ...lifecycle };
      assert.throws(
        () => assertReleaseBuilderActive(execution),
        /terminated before the retained baseline phase/u,
      );
      assert.equal(await cleanupReleaseExecution(execution), null);
      assert.deepEqual(child.killCalls, []);
    }

    const running = fakeReleaseBuilderChild();
    running.kill = (signal) => {
      running.killCalls.push(signal);
      queueMicrotask(() => {
        running.signalCode = signal;
        running.emit("exit", null, signal);
        running.emit("close", null, signal);
      });
      return true;
    };
    const runningLifecycle = trackReleaseBuilderChild(running);
    assert.equal(
      await cleanupReleaseExecution({ child: running, ...runningLifecycle }),
      null,
    );
    assert.deepEqual(running.killCalls, ["SIGKILL"]);

    const injected = fakeReleaseBuilderChild();
    const injectedLifecycle = trackReleaseBuilderChild(injected);
    assert.equal(injectedLifecycle.sendKill("SIGKILL", "crash-injection"), true);
    const injectedCleanup = cleanupReleaseExecution({ child: injected, ...injectedLifecycle });
    queueMicrotask(() => {
      injected.signalCode = "SIGKILL";
      injected.emit("exit", null, "SIGKILL");
      injected.emit("close", null, "SIGKILL");
    });
    assert.equal(await injectedCleanup, null);
    assert.deepEqual(injected.killCalls, ["SIGKILL"]);

    for (const terminal of [
      { code: 9, signal: null },
      { code: null, signal: "SIGTERM" },
    ]) {
      const child = fakeReleaseBuilderChild();
      const lifecycle = trackReleaseBuilderChild(child);
      child.exitCode = terminal.code;
      child.signalCode = terminal.signal;
      child.emit("exit", terminal.code, terminal.signal);
      assert.equal(lifecycle.sendKill("SIGKILL", "must-not-run"), false);
      assert.deepEqual(child.killCalls, []);
      child.emit("close", terminal.code, terminal.signal);
      await lifecycle.closed;
    }

    for (const behavior of ["returns-false", "throws"]) {
      const child = fakeReleaseBuilderChild();
      child.kill = (signal) => {
        child.killCalls.push(signal);
        if (behavior === "throws") throw new Error("synthetic kill failure");
        return false;
      };
      const lifecycle = trackReleaseBuilderChild(child);
      assert.throws(
        () => lifecycle.sendKill("SIGKILL", "single-use-canary"),
        /termination was not accepted|synthetic kill failure/u,
      );
      assert.equal(lifecycle.sendKill("SIGKILL", "single-use-canary"), false);
      assert.deepEqual(child.killCalls, ["SIGKILL"]);
      child.emit("close", null, null);
      await lifecycle.closed;
    }

    const postSpawnError = fakeReleaseBuilderChild();
    const postSpawnLifecycle = trackReleaseBuilderChild(postSpawnError);
    postSpawnError.emit("spawn");
    const lifecycleError = new Error("synthetic post-spawn failure");
    lifecycleError.code = "EIO";
    postSpawnError.emit("error", lifecycleError);
    queueMicrotask(() => postSpawnError.emit("close", null, null));
    assert.deepEqual(await postSpawnLifecycle.completed, {
      termination: "lifecycle-failed",
      code: null,
      signal: null,
      errorCode: "EIO",
    });
    assert.equal(
      await cleanupReleaseExecution({ child: postSpawnError, ...postSpawnLifecycle }),
      null,
    );
    assert.deepEqual(postSpawnError.killCalls, []);
  });

  it("matches every npm-packed member to one explicit release or metadata inventory entry", async () => {
    const cache = await mkdtemp(path.join(tmpdir(), "agentmo-package-inventory-cache-"));
    const packed = await execFileAsync("npm", [
      "pack",
      "--dry-run",
      "--json",
      "--ignore-scripts",
      "--cache", cache,
    ], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
    const report = JSON.parse(packed.stdout);
    assert.equal(report.length, 1);
    assert.equal(validateBuilderNpmTarballInventory(report[0].files), true);
    assert.equal(
      report[0].files.some((entry) => entry.path === "src/builder-codex-uat-private-authority.js"),
      false,
    );
    assert.throws(
      () => validateBuilderNpmTarballInventory([
        ...report[0].files,
        { path: "src/unlisted.js", size: 1, mode: 0o644 },
      ]),
      (error) => error?.code === "AGENTMO_BUILDER_PACKAGE_TARBALL_INVENTORY_INVALID",
    );
  });

  it("ships the fixed Darwin descriptor bridge in the Builder runtime closure", async () => {
    const descriptor = BUILDER_RELEASE_ASSET_INVENTORY.find(
      (asset) => asset.sourcePath === "src/builder-posix-effect.js",
    );
    assert.deepEqual(descriptor, {
      kind: "runtime",
      sourcePath: "src/builder-posix-effect.js",
      relativePath: "runtime/agentmo/src/builder-posix-effect.js",
      destinationPath: "plugins/agentmo/runtime/agentmo/src/builder-posix-effect.js",
    });

    const packageRoot = await copyPackage(path.join(
      await mkdtemp(path.join(tmpdir(), "agentmo-package-darwin-bridge-")),
      "package",
    ));
    const release = await loadBuilderPackage({ packageRoot });
    const shipped = release.assets.find((asset) => asset.sourcePath === "src/builder-posix-effect.js");
    assert.ok(shipped);
    const source = shipped.bytes.toString("utf8");
    assert.match(source, /DARWIN_DIRECTORY_FD_BRIDGE_COMMAND = "\/usr\/bin\/python3"/u);
    assert.match(source, /\["-I", "-c", DARWIN_DIRECTORY_FD_BRIDGE/u);
    assert.match(source, /os\.fchdir\(4\)/u);
    assert.match(source, /lstat\(DARWIN_DIRECTORY_FD_BRIDGE_COMMAND/u);
    assert.equal(source.includes("cwd: normalized.directoryAuthority.path"), false);
  });

  it("publishes a release set through retained absent-only links and rejects exact replay without mutation", async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "agentmo-release-publish-")));
    const outDirectory = path.join(root, "releases");
    const baselineVersion = "0.1.0-cr16.1";
    const successorVersion = "0.1.0-cr16.2";
    const built = await runReleaseBuilder(outDirectory, baselineVersion, successorVersion);
    assert.equal(built.code, 0, built.stderr);
    assert.equal(built.stderr, "");
    const identity = JSON.parse(built.stdout);
    assert.equal(identity.schemaVersion, "agentmo.builder-uat-release-set.v3");
    assert.match(identity.operationId, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(identity.predecessor, null);
    const baselineName = `agentmo-${baselineVersion}.tgz`;
    const successorName = `agentmo-${successorVersion}.tgz`;
    const commitName = "agentmo-builder-uat-release-set.json";
    const commitRetainedName = ".agentmo-builder-uat-release-set.stage.json";
    const retainedByRole = {
      baseline: ".agentmo-builder-uat-baseline.retained.tgz",
      successor: ".agentmo-builder-uat-successor.retained.tgz",
    };
    assert.deepEqual(
      (await readdir(outDirectory)).toSorted(),
      [
        baselineName,
        successorName,
        commitName,
        commitRetainedName,
        ...Object.values(retainedByRole),
      ].toSorted(),
    );
    assert.equal(await readFile(path.join(outDirectory, commitName), "utf8"), built.stdout);

    assert.deepEqual(Object.keys(identity.publication).toSorted(), [
      "commitRetainedRelativePath",
      "members",
      "outputBasename",
      "outputDirectoryIdentity",
      "outputParentIdentity",
      "schemaVersion",
    ]);
    assert.equal(identity.publication.schemaVersion, "agentmo.builder-uat-release-publication.v2");
    assert.equal(identity.publication.commitRetainedRelativePath, commitRetainedName);
    for (const [role, name, digest] of [
      ["baseline", baselineName, identity.baseline.tarballDigest],
      ["successor", successorName, identity.successor.tarballDigest],
    ]) {
      const retainedPath = path.join(outDirectory, retainedByRole[role]);
      const publishedPath = path.join(outDirectory, name);
      const [retainedStats, publishedStats, bytes] = await Promise.all([
        lstat(retainedPath, { bigint: true }),
        lstat(publishedPath, { bigint: true }),
        readFile(publishedPath),
      ]);
      assert.deepEqual(fileIdentity(retainedStats), fileIdentity(publishedStats));
      assert.equal(retainedStats.nlink, 2n);
      assert.equal(digestRawBytes(bytes), digest);
      assert.deepEqual(await readBoundedBuilderUatReleaseFile(publishedPath, 64 * 1024 * 1024), bytes);
      assert.deepEqual(
        identity.publication.members.find((member) => member.role === role),
        {
          role,
          publicRelativePath: name,
          retainedRelativePath: retainedByRole[role],
          digest,
          identity: {
            device: retainedStats.dev.toString(10),
            inode: retainedStats.ino.toString(10),
            links: "2",
            size: retainedStats.size.toString(10),
            owner: retainedStats.uid.toString(10),
            mode: retainedStats.mode.toString(10),
            modifiedNs: retainedStats.mtimeNs.toString(10),
            changedNs: retainedStats.ctimeNs.toString(10),
          },
        },
      );
    }
    const commitStagePath = path.join(outDirectory, commitRetainedName);
    const [commitStageStats, commitStats] = await Promise.all([
      lstat(commitStagePath, { bigint: true }),
      lstat(path.join(outDirectory, commitName), { bigint: true }),
    ]);
    assert.deepEqual(fileIdentity(commitStageStats), fileIdentity(commitStats));
    assert.equal(commitStageStats.nlink, 2n);
    assert.equal(commitStats.nlink, 2n);
    assert.deepEqual(await readFile(commitStagePath), await readFile(path.join(outDirectory, commitName)));

    const outputBefore = await Promise.all(
      [
        baselineName,
        successorName,
        commitName,
        commitRetainedName,
        ...Object.values(retainedByRole),
      ].map(async (name) => ({
        name,
        identity: fileIdentity(await lstat(path.join(outDirectory, name), { bigint: true })),
        digest: digestRawBytes(await readFile(path.join(outDirectory, name))),
      })),
    );
    const replay = await runReleaseBuilder(outDirectory, baselineVersion, successorVersion);
    assert.notEqual(replay.code, 0);
    assert.equal(replay.stdout, "");
    assert.equal(
      JSON.parse(replay.stderr).code,
      "AGENTMO_BUILDER_UAT_RELEASE_OUTPUT_REJECTED",
    );
    const outputAfter = await Promise.all(
      [
        baselineName,
        successorName,
        commitName,
        commitRetainedName,
        ...Object.values(retainedByRole),
      ].map(async (name) => ({
        name,
        identity: fileIdentity(await lstat(path.join(outDirectory, name), { bigint: true })),
        digest: digestRawBytes(await readFile(path.join(outDirectory, name))),
      })),
    );
    assert.deepEqual(outputAfter, outputBefore);
  });

  it("preserves the retained baseline when the external producer is killed during successor build", {
    skip: MAIN_TEST_LANE ? "covered by the isolated durable-fs lane" : false,
  }, async (context) => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "agentmo-release-sigkill-")));
    const outDirectory = path.join(root, "releases");
    const baselineVersion = "0.1.0-cr08.1";
    const successorVersion = "0.1.0-cr08.2";
    const baselineName = `agentmo-${baselineVersion}.tgz`;
    const successorName = `agentmo-${successorVersion}.tgz`;
    const execution = startReleaseBuilder(outDirectory, baselineVersion, successorVersion);

    let testError = null;
    let cleanupError = null;
    let directoryCleanupError = null;
    let completedSuccessfully = false;
    try {
      try {
        const phase = await waitForRetainedBaselinePhase(
          root,
          baselineName,
          successorName,
          execution,
          RELEASE_PHASE_READY_DEADLINE_MS,
        );
        context.diagnostic(`retained-baseline-ready elapsedMs=${phase.elapsedMs}`);
        assertReleaseBuilderActive(execution);
        assert.equal(execution.sendKill("SIGKILL", "crash-injection"), true);

        const killed = await settleWithin(
          execution.closed,
          5_000,
          "release producer SIGKILL settlement",
        );
        assert.equal(killed.signal, "SIGKILL", killed.stderr);
        assert.equal(killed.stdout, "");
        assert.deepEqual(await readdir(path.join(phase.scratchRoot, "publish")), [baselineName]);
        await assert.rejects(
          lstat(outDirectory),
          (error) => error?.code === "ENOENT",
        );
        completedSuccessfully = true;
      } catch (error) {
        testError = error;
      }
    } finally {
      cleanupError = await cleanupReleaseExecution(execution);
      if (completedSuccessfully) {
        try {
          await rm(root, { recursive: true, force: true });
        } catch (error) {
          directoryCleanupError = error;
        }
      }
    }
    const errors = [testError, cleanupError, directoryCleanupError].filter(Boolean);
    if (errors.length > 1) throw new AggregateError(errors, testError?.message ?? "Cleanup failed.");
    if (errors.length === 1) throw errors[0];
  });

  it("rejects an unregistered two-link tarball without widening the generic reader", async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "agentmo-release-unregistered-")));
    const retainedPath = path.join(root, "retained.tgz");
    const publicRoot = path.join(root, "releases");
    const publicPath = path.join(publicRoot, "agentmo-0.1.0-unregistered.tgz");
    await mkdir(publicRoot, { mode: 0o700 });
    await writeFile(retainedPath, Buffer.from("not a registered release\n"), {
      flag: "wx",
      mode: 0o600,
    });
    await link(retainedPath, publicPath);
    await assert.rejects(
      readBoundedBuilderUatReleaseFile(publicPath),
      (error) => error?.code === "AGENTMO_BUILDER_PACKAGE_READ_FAILED",
    );
    assert.equal((await lstat(retainedPath, { bigint: true })).nlink, 2n);
    assert.equal((await lstat(publicPath, { bigint: true })).nlink, 2n);
  });

  it("admits both committed release members as one pair and rejects a cross-pair tarball", async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "agentmo-release-pair-admit-")));
    const primaryOut = path.join(root, "primary");
    const alternateOut = path.join(root, "alternate");
    const successorVersion = "0.1.0-cr16.14";
    const [primaryBuilt, alternateBuilt] = await Promise.all([
      runReleaseBuilder(primaryOut, "0.1.0-cr16.12", successorVersion),
      runReleaseBuilder(alternateOut, "0.1.0-cr16.13", successorVersion),
    ]);
    assert.equal(primaryBuilt.code, 0, primaryBuilt.stderr);
    assert.equal(alternateBuilt.code, 0, alternateBuilt.stderr);
    const primary = JSON.parse(primaryBuilt.stdout);
    const alternate = JSON.parse(alternateBuilt.stdout);
    assert.deepEqual(primary.successor, alternate.successor);
    assert.notEqual(primary.operationId, alternate.operationId);

    const baselineExtract = path.join(root, "baseline-package");
    const successorExtract = path.join(root, "successor-package");
    await Promise.all([mkdir(baselineExtract), mkdir(successorExtract)]);
    const baselineTarball = path.join(
      primaryOut,
      `agentmo-${primary.baseline.version}.tgz`,
    );
    const successorTarball = path.join(
      primaryOut,
      `agentmo-${primary.successor.version}.tgz`,
    );
    await Promise.all([
      execFileAsync("tar", ["-xzf", baselineTarball, "-C", baselineExtract]),
      execFileAsync("tar", ["-xzf", successorTarball, "-C", successorExtract]),
    ]);
    const request = {
      baseline: {
        packageRoot: path.join(baselineExtract, "package"),
        tarballPath: baselineTarball,
      },
      successor: {
        packageRoot: path.join(successorExtract, "package"),
        tarballPath: successorTarball,
      },
      maxBytes: 64 * 1024 * 1024,
    };
    const admitted = await admitBuilderUatReleasePair(request);
    assert.equal(admitted.operationId, primary.operationId);
    assert.equal(admitted.releaseSetDigest, digestRawBytes(await readFile(
      path.join(primaryOut, "agentmo-builder-uat-release-set.json"),
    )));
    assert.deepEqual(admitted.baseline, {
      packageName: primary.baseline.packageName,
      version: primary.baseline.version,
      releaseDigest: primary.baseline.releaseDigest,
      tarballDigest: primary.baseline.tarballDigest,
    });
    assert.deepEqual(admitted.successor, {
      packageName: primary.successor.packageName,
      version: primary.successor.version,
      releaseDigest: primary.successor.releaseDigest,
      tarballDigest: primary.successor.tarballDigest,
    });

    await assert.rejects(
      admitBuilderUatReleasePair({
        ...request,
        successor: {
          ...request.successor,
          tarballPath: path.join(
            alternateOut,
            `agentmo-${alternate.successor.version}.tgz`,
          ),
        },
      }),
      (error) => error?.code === "AGENTMO_BUILDER_PACKAGE_READ_FAILED",
    );
  });

  it("rejects an extra hardlink against an otherwise registered release without mutation", async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "agentmo-release-extra-link-")));
    const outDirectory = path.join(root, "releases");
    const baselineVersion = "0.1.0-cr16.5";
    const successorVersion = "0.1.0-cr16.6";
    const built = await runReleaseBuilder(outDirectory, baselineVersion, successorVersion);
    assert.equal(built.code, 0, built.stderr);
    const identity = JSON.parse(built.stdout);
    const member = identity.publication.members.find((entry) => entry.role === "baseline");
    const publicPath = path.join(outDirectory, member.publicRelativePath);
    const retainedPath = path.join(outDirectory, member.retainedRelativePath);
    const extraPath = path.join(root, "foreign-extra-link.tgz");
    await link(publicPath, extraPath);
    const before = await Promise.all([publicPath, retainedPath, extraPath].map(async (filePath) => ({
      filePath,
      identity: fileIdentity(await lstat(filePath, { bigint: true })),
      digest: digestRawBytes(await readFile(filePath)),
    })));
    await assert.rejects(
      readBoundedBuilderUatReleaseFile(publicPath, 64 * 1024 * 1024),
      (error) => error?.code === "AGENTMO_BUILDER_PACKAGE_READ_FAILED",
    );
    const after = await Promise.all([publicPath, retainedPath, extraPath].map(async (filePath) => ({
      filePath,
      identity: fileIdentity(await lstat(filePath, { bigint: true })),
      digest: digestRawBytes(await readFile(filePath)),
    })));
    assert.deepEqual(after, before);
    assert.equal((await lstat(publicPath, { bigint: true })).nlink, 3n);
  });

  it("rejects any third reader argument without touching committed files", async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "agentmo-release-commit-swap-")));
    const outDirectory = path.join(root, "releases");
    const built = await runReleaseBuilder(outDirectory, "0.1.0-cr16.7", "0.1.0-cr16.8");
    assert.equal(built.code, 0, built.stderr);
    const authority = JSON.parse(built.stdout);
    const member = authority.publication.members.find((entry) => entry.role === "baseline");
    const publicPath = path.join(outDirectory, member.publicRelativePath);
    const commitPath = path.join(outDirectory, "agentmo-builder-uat-release-set.json");
    const before = await Promise.all([publicPath, commitPath].map(async (filePath) => ({
      filePath,
      identity: fileIdentity(await lstat(filePath, { bigint: true })),
      bytes: await readFile(filePath),
    })));
    await assert.rejects(
      readBoundedBuilderUatReleaseFile(publicPath, 64 * 1024 * 1024, {
        authority: "caller-supplied",
      }),
      (error) => error?.code === "AGENTMO_BUILDER_PACKAGE_READ_FAILED",
    );
    const after = await Promise.all([publicPath, commitPath].map(async (filePath) => ({
      filePath,
      identity: fileIdentity(await lstat(filePath, { bigint: true })),
      bytes: await readFile(filePath),
    })));
    assert.deepEqual(after, before);
  });

  it("preserves a late foreign output occupant and the complete retained release scratch", async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "agentmo-release-foreign-")));
    const outDirectory = path.join(root, "releases");
    const baselineVersion = "0.1.0-cr16.3";
    const successorVersion = "0.1.0-cr16.4";
    const baselineName = `agentmo-${baselineVersion}.tgz`;
    const successorName = `agentmo-${successorVersion}.tgz`;
    const execution = startReleaseBuilder(outDirectory, baselineVersion, successorVersion);

    let scratchRoot;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const scratchName = (await readdir(root))
        .find((name) => name.startsWith(".agentmo-builder-uat-build-"));
      if (scratchName !== undefined) {
        scratchRoot = path.join(root, scratchName);
        const successorExists = await lstat(
          path.join(scratchRoot, "publish", successorName),
          { bigint: true },
        ).then((stats) => stats.isFile(), (error) => {
          if (error?.code === "ENOENT") return false;
          throw error;
        });
        if (successorExists) break;
      }
      if (execution.child.exitCode !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.notEqual(scratchRoot, undefined, "release scratch must become observable");
    assert.equal(execution.child.exitCode, null, "builder must still be pre-publication");

    await mkdir(outDirectory, { mode: 0o700 });
    const sentinelPath = path.join(outDirectory, "foreign-sentinel.txt");
    await writeFile(sentinelPath, "foreign output bytes\n", { flag: "wx", mode: 0o600 });
    const [directoryBefore, sentinelBefore, sentinelBytes] = await Promise.all([
      lstat(outDirectory, { bigint: true }),
      lstat(sentinelPath, { bigint: true }),
      readFile(sentinelPath),
    ]);

    const rejected = await execution.completed;
    assert.notEqual(rejected.code, 0);
    assert.equal(rejected.stdout, "");
    assert.equal(
      JSON.parse(rejected.stderr).code,
      "AGENTMO_BUILDER_UAT_RELEASE_OUTPUT_REJECTED",
    );
    const [directoryAfter, sentinelAfter] = await Promise.all([
      lstat(outDirectory, { bigint: true }),
      lstat(sentinelPath, { bigint: true }),
    ]);
    assert.deepEqual(fileIdentity(directoryAfter), fileIdentity(directoryBefore));
    assert.deepEqual(fileIdentity(sentinelAfter), fileIdentity(sentinelBefore));
    assert.deepEqual(await readFile(sentinelPath), sentinelBytes);
    assert.deepEqual(await readdir(outDirectory), ["foreign-sentinel.txt"]);

    for (const name of [baselineName, successorName]) {
      const retained = await lstat(path.join(scratchRoot, "publish", name), { bigint: true });
      assert.equal(retained.isFile(), true);
      assert.equal(retained.nlink, 1n);
    }
    await assert.rejects(
      lstat(path.join(scratchRoot, ".agentmo-builder-uat-release-set.stage.json"), {
        bigint: true,
      }),
      (error) => error?.code === "ENOENT",
    );
  });

  it("rejects extra source, plugin, and root-data members and a broadened npm files directive", async () => {
    for (const relativePath of [
      "src/unlisted-runtime.js",
      "plugin/hooks/unlisted-hook.js",
      "unlisted-data.json",
    ]) {
      const packageRoot = await copyPackage(path.join(
        await mkdtemp(path.join(tmpdir(), "agentmo-extra-package-member-")),
        "package",
      ));
      const extraPath = path.join(packageRoot, ...relativePath.split("/"));
      await mkdir(path.dirname(extraPath), { recursive: true });
      await writeFile(extraPath, "{}\n", "utf8");
      await expectPackageRejection(packageRoot, "AGENTMO_BUILDER_PACKAGE_MEMBER_UNLISTED");
    }

    const broadened = await copyPackage(path.join(
      await mkdtemp(path.join(tmpdir(), "agentmo-broadened-files-")),
      "package",
    ));
    const manifestPath = path.join(broadened, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.files.push("src/");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await expectPackageRejection(broadened, "AGENTMO_BUILDER_PACKAGE_FILES_INVALID");
  });

  it("walks the hook import, I/O, and adjacent-launcher closure from the plugin entrypoint", async () => {
    const admitted = await copyPackage(path.join(
      await mkdtemp(path.join(tmpdir(), "agentmo-hook-closure-admitted-")),
      "package",
    ));
    const release = await loadBuilderPackage({ packageRoot: admitted });
    assert.equal(release.assets.some((asset) => asset.relativePath === "hooks/agentmo-hook.js"), true);
    assert.equal(
      release.assets.some((asset) => asset.relativePath === "runtime/agentmo/bin/agentmo.js"),
      true,
    );
    assert.equal(BUILDER_PLUGIN_HOOK_IO_SURFACE_INVENTORY.length, 39);
    assert.deepEqual(
      BUILDER_PLUGIN_HOOK_IO_SURFACE_INVENTORY.slice(31, 34),
      [
        "plugin/hooks/agentmo-hook.js:813:filesystem-read:fs.lstat",
        "plugin/hooks/agentmo-hook.js:814:filesystem-read:fs.readlink",
        "plugin/hooks/agentmo-hook.js:815:filesystem-read:fs.lstat",
      ],
    );

    const unlistedImport = await copyPackage(path.join(
      await mkdtemp(path.join(tmpdir(), "agentmo-hook-unlisted-import-")),
      "package",
    ));
    const unlistedImportPath = path.join(unlistedImport, "plugin/hooks/agentmo-hook.js");
    await writeFile(
      unlistedImportPath,
      `${await readFile(unlistedImportPath, "utf8")}\nimport "./unlisted-hook.js";\n`,
      "utf8",
    );
    await expectPackageRejection(unlistedImport, "AGENTMO_BUILDER_PACKAGE_IMPORT_UNLISTED");

    const unlistedWrite = await copyPackage(path.join(
      await mkdtemp(path.join(tmpdir(), "agentmo-hook-unlisted-write-")),
      "package",
    ));
    const unlistedWritePath = path.join(unlistedWrite, "plugin/hooks/agentmo-hook.js");
    await writeFile(
      unlistedWritePath,
      `${await readFile(unlistedWritePath, "utf8")}\nprocess.stderr.write("unlisted");\n`,
      "utf8",
    );
    await expectPackageRejection(
      unlistedWrite,
      "AGENTMO_BUILDER_PACKAGE_EXECUTABLE_EFFECT_UNLISTED",
    );

    const unlistedSpawn = await copyPackage(path.join(
      await mkdtemp(path.join(tmpdir(), "agentmo-hook-unlisted-spawn-")),
      "package",
    ));
    const unlistedSpawnPath = path.join(unlistedSpawn, "plugin/hooks/agentmo-hook.js");
    await writeFile(
      unlistedSpawnPath,
      `${await readFile(unlistedSpawnPath, "utf8")}\nspawn(process.execPath, ["--version"]);\n`,
      "utf8",
    );
    await expectPackageRejection(
      unlistedSpawn,
      "AGENTMO_BUILDER_PACKAGE_EXECUTABLE_EFFECT_UNLISTED",
    );

    const dynamicSpawn = await copyPackage(path.join(
      await mkdtemp(path.join(tmpdir(), "agentmo-hook-dynamic-spawn-")),
      "package",
    ));
    const dynamicSpawnPath = path.join(dynamicSpawn, "plugin/hooks/agentmo-hook.js");
    await writeFile(
      dynamicSpawnPath,
      `${await readFile(dynamicSpawnPath, "utf8")}\nconst { spawn: hiddenSpawn } = await import("node:child_process");\nhiddenSpawn(process.execPath, ["--version"]);\n`,
      "utf8",
    );
    await expectPackageRejection(dynamicSpawn, "AGENTMO_BUILDER_PACKAGE_IMPORT_UNLISTED");

    const escapedSpawn = await copyPackage(path.join(
      await mkdtemp(path.join(tmpdir(), "agentmo-hook-escaped-spawn-")),
      "package",
    ));
    const escapedSpawnPath = path.join(escapedSpawn, "plugin/hooks/agentmo-hook.js");
    await writeFile(
      escapedSpawnPath,
      `${await readFile(escapedSpawnPath, "utf8")}\nconst escapedSpawnEffect = spawn;\nescapedSpawnEffect(process.execPath, ["--version"]);\n`,
      "utf8",
    );
    await expectPackageRejection(escapedSpawn, "AGENTMO_BUILDER_PACKAGE_IMPORT_UNLISTED");

    for (const decoy of [
      "// spawn(process.execPath, [\"--no-warnings\"])",
      "const launcherDecoy = 'spawn(process.execPath, [\"--no-warnings\"])';",
      "const templateDecoy = `spawn(process.execPath, [\"--no-warnings\"])`;",
      "const regexDecoy = /spawn\\(process\\.execPath/u;",
    ]) {
      const substituted = await copyPackage(path.join(
        await mkdtemp(path.join(tmpdir(), "agentmo-hook-spawn-argument-substitution-")),
        "package",
      ));
      const substitutedPath = path.join(substituted, "plugin/hooks/agentmo-hook.js");
      const original = await readFile(substitutedPath, "utf8");
      await writeFile(
        substitutedPath,
        `${original.replace(
          '      "--no-warnings",',
          '      "--version",',
        )}\n${decoy}\n`,
        "utf8",
      );
      await expectPackageRejection(
        substituted,
        "AGENTMO_BUILDER_PACKAGE_EXECUTABLE_EFFECT_UNLISTED",
      );
    }

    const substitutedTarget = await copyPackage(path.join(
      await mkdtemp(path.join(tmpdir(), "agentmo-hook-launcher-target-substitution-")),
      "package",
    ));
    const substitutedTargetPath = path.join(substitutedTarget, "plugin/hooks/agentmo-hook.js");
    await writeFile(
      substitutedTargetPath,
      `${await readFile(substitutedTargetPath, "utf8")}`.replace(
        'const LAUNCHER_RELATIVE_PATH = "plugins/agentmo/runtime/agentmo/bin/agentmo.js";',
        'const LAUNCHER_RELATIVE_PATH = "plugins/agentmo/runtime/agentmo/bin/untrusted.js";',
      ),
      "utf8",
    );
    await expectPackageRejection(
      substitutedTarget,
      "AGENTMO_BUILDER_PACKAGE_EXECUTABLE_EFFECT_UNLISTED",
    );

    const bootstrapBodyMutation = await copyPackage(path.join(
      await mkdtemp(path.join(tmpdir(), "agentmo-hook-bootstrap-body-mutation-")),
      "package",
    ));
    const bootstrapBodyMutationPath = path.join(
      bootstrapBodyMutation,
      "plugin/hooks/agentmo-hook.js",
    );
    await writeFile(
      bootstrapBodyMutationPath,
      `${await readFile(bootstrapBodyMutationPath, "utf8")}`.replace(
        "const graph = buildAuthenticatedBootstrapGraph({",
        "const graph = buildAuthenticatedBootstrapGraph({/* bootstrap-order-anchor */",
      ),
      "utf8",
    );
    await expectPackageRejection(
      bootstrapBodyMutation,
      "AGENTMO_BUILDER_PACKAGE_EXECUTABLE_EFFECT_UNLISTED",
    );

    const shadowedProcess = await copyPackage(path.join(
      await mkdtemp(path.join(tmpdir(), "agentmo-hook-shadowed-process-")),
      "package",
    ));
    const shadowedProcessPath = path.join(shadowedProcess, "plugin/hooks/agentmo-hook.js");
    await writeFile(
      shadowedProcessPath,
      `${await readFile(shadowedProcessPath, "utf8")}`.replace(
        "async function runAdjacentLauncher(inputBytes, paths) {",
        "async function runAdjacentLauncher(inputBytes, paths, process) {",
      ),
      "utf8",
    );
    await expectPackageRejection(shadowedProcess, "AGENTMO_BUILDER_PACKAGE_IMPORT_UNLISTED");

    const methodShadowedProcess = await copyPackage(path.join(
      await mkdtemp(path.join(tmpdir(), "agentmo-hook-method-shadowed-process-")),
      "package",
    ));
    const methodShadowedProcessPath = path.join(methodShadowedProcess, "plugin/hooks/agentmo-hook.js");
    let methodShadowedSource = `${await readFile(methodShadowedProcessPath, "utf8")}`;
    methodShadowedSource = methodShadowedSource.replace(
      "async function runAdjacentLauncher(inputBytes, paths) {",
      "const runner = { async runAdjacentLauncher(inputBytes, paths, process) {",
    ).replace(
      "\n}\n\nfunction admitBridgeResult",
      "\n}};\n\nfunction admitBridgeResult",
    ).replace(
      "runAdjacentLauncher(inputBytes, paths)",
      'runner.runAdjacentLauncher(inputBytes, paths, { execPath: "/usr/bin/tee" })',
    );
    await writeFile(methodShadowedProcessPath, methodShadowedSource, "utf8");
    await expectPackageRejection(methodShadowedProcess, "AGENTMO_BUILDER_PACKAGE_IMPORT_UNLISTED");
  });

  it("admits only the exact derived UAT manifest and includes those shipped bytes in release identity", async () => {
    const packageRoot = await copyPackage(path.join(
      await mkdtemp(path.join(tmpdir(), "agentmo-derived-uat-manifest-")),
      "package",
    ));
    const base = await loadBuilderPackage({ packageRoot });
    const continuation = base.assets.find(
      (asset) => asset.sourcePath === "src/builder-codex-uat-continuation.js",
    );
    const verifier = base.assets.find(
      (asset) => asset.sourcePath === "scripts/verify-codex-uat-candidate.js",
    );
    const manifest = {
      schemaVersion: "agentmo.codex-uat-release-manifest.v1",
      packageName: base.name,
      version: base.version,
      continuation: { sourcePath: continuation.sourcePath, sha256: continuation.digest },
      verifier: { sourcePath: verifier.sourcePath, sha256: verifier.digest },
    };
    const bytes = Buffer.from(serializePersistableJson(manifest, {
      subject: "builder-codex-uat-release-manifest",
    }), "utf8");
    const manifestPath = path.join(packageRoot, "src/builder-codex-uat-release-manifest.json");
    await writeFile(manifestPath, bytes, { flag: "wx", mode: 0o600 });
    const uat = await loadBuilderPackage({ packageRoot });
    assert.notEqual(uat.releaseDigest, base.releaseDigest);
    assert.equal(
      uat.assets.find((asset) => asset.sourcePath === "src/builder-codex-uat-release-manifest.json")?.digest,
      digestRawBytes(bytes),
    );

    const invalid = await copyPackage(path.join(
      await mkdtemp(path.join(tmpdir(), "agentmo-invalid-uat-manifest-")),
      "package",
    ));
    await writeFile(
      path.join(invalid, "src/builder-codex-uat-release-manifest.json"),
      "{}\n",
      { flag: "wx", mode: 0o600 },
    );
    await expectPackageRejection(invalid, "AGENTMO_BUILDER_PACKAGE_UAT_MANIFEST_INVALID");
  });

  it("closes createRequire JSON/CJS dependencies or rejects them before packing", async () => {
    const admittedJson = await hostilePackage(
      "agentmo-create-require-json-admitted-",
      [
        'import { createRequire as makeLocalRequire } from "node:module";',
        "const loadLocal = makeLocalRequire(import.meta.url);",
        'loadLocal("../package.json");',
      ].join("\n"),
    );
    const release = await loadBuilderPackage({ packageRoot: admittedJson });
    assert.equal(release.assets.some((asset) => asset.sourcePath === "package.json"), true);
    for (const required of [
      "src/javascript-static-analysis.js",
      "src/builder-immutable-journal.js",
      "src/builder-checkpoint.js",
      "src/builder-events.js",
      "src/builder-doctor.js",
    ]) {
      assert.equal(release.assets.some((asset) => asset.sourcePath === required), true, required);
    }

    for (const [name, extension, contents] of [
      ["cjs", "cjs", "module.exports = Object.freeze({ bounded: true });\n"],
      ["json", "json", '{"bounded":true}\n'],
    ]) {
      const packageRoot = await hostilePackage(
        `agentmo-create-require-${name}-unlisted-`,
        [
          'import { createRequire as makeLocalRequire } from "node:module";',
          "const loadLocal = makeLocalRequire(import.meta.url);",
          `loadLocal("./secondary.${extension}");`,
        ].join("\n"),
      );
      await writeFile(path.join(packageRoot, "src", `secondary.${extension}`), contents, "utf8");
      await expectPackageRejection(packageRoot, "AGENTMO_BUILDER_PACKAGE_MEMBER_UNLISTED");
    }
  });

  it("rejects dynamic, constructed, escaped, and unknown secondary loader authority", async () => {
    const fixtures = [
      [
        "dynamic-require",
        'import { createRequire } from "node:module"; const req = createRequire(import.meta.url); const target = "../package.json"; req(target);',
      ],
      [
        "dynamic-create-require",
        'import { createRequire } from "node:module"; const base = import.meta.url; createRequire(base);',
      ],
      [
        "escaped-loader",
        'import { createRequire } from "node:module"; const req = createRequire(import.meta.url); const escaped = req; escaped("../package.json");',
      ],
      ["eval-loader", 'eval("import(\\"./artifact-admission.js\\")");'],
      ["function-loader", 'Function("return import(\\"./artifact-admission.js\\")")();'],
      [
        "unknown-module-loader",
        'import * as moduleApi from "node:module"; moduleApi.register("./artifact-admission.js");',
      ],
    ];
    for (const [name, source] of fixtures) {
      await expectPackageRejection(await hostilePackage(`agentmo-${name}-`, source));
    }
  });

  it("closes worker and fork entry points and rejects dynamic targets", async () => {
    for (const [name, source] of [
      [
        "worker-literal",
        'import { Worker } from "node:worker_threads"; new Worker("./not-in-release.js");',
      ],
      [
        "worker-dynamic",
        'import { Worker } from "node:worker_threads"; const entry = "./not-in-release.js"; new Worker(entry);',
      ],
      [
        "fork-literal",
        'import { fork } from "node:child_process"; fork("./not-in-release.js");',
      ],
      [
        "fork-dynamic",
        'import { fork } from "node:child_process"; const entry = "./not-in-release.js"; fork(entry);',
      ],
    ]) {
      await expectPackageRejection(await hostilePackage(`agentmo-${name}-`, source));
    }
  });

  it("finds same-line static imports and comment-separated dynamic imports", async () => {
    const sameLine = await hostilePackage(
      "agentmo-import-same-line-",
      "; import \"./not-in-release.js\";",
    );
    await expectPackageRejection(sameLine);

    const commentedDynamic = await hostilePackage(
      "agentmo-import-commented-dynamic-",
      "await import/* first *//* second */(\"./not-in-release.js\");",
    );
    await expectPackageRejection(commentedDynamic);

    const contextualDivision = await hostilePackage(
      "agentmo-import-contextual-division-",
      String.raw`const of = 8; void (of / import(".\/not-in-release.js") / 2);`,
    );
    await expectPackageRejection(contextualDivision);
  });

  it("ignores import-shaped text in comments, strings, regexes, and template text", async () => {
    const packageRoot = await hostilePackage(
      "agentmo-import-fakes-",
      [
        "// import \"./not-in-release.js\";",
        "/* export * from \"./not-in-release.js\"; */",
        "const fakeImportText = \"import('./not-in-release.js')\";",
        "const fakeExportText = 'export * from \"./not-in-release.js\"';",
        "const fakeImportRegex = /import\\s*\\(\\\"\\.\\/not-in-release\\.js\\\"\\)/u;",
        "const fakeTemplateText = `import('./not-in-release.js')`;",
      ].join("\n"),
    );
    const admitted = await loadBuilderPackage({ packageRoot });
    assert.equal(admitted.assets.some((asset) => asset.sourcePath === "src/not-in-release.js"), false);
  });

  it("rejects non-literal or otherwise non-exact dynamic import arguments", async () => {
    const nonLiteral = await hostilePackage(
      "agentmo-import-non-literal-",
      "const modulePath = './artifact-admission.js'; await import(modulePath);",
    );
    await expectPackageRejection(nonLiteral);

    const concatenated = await hostilePackage(
      "agentmo-import-concatenated-",
      "await import('./artifact-' + 'admission.js');",
    );
    await expectPackageRejection(concatenated);
  });

  it("rejects symlinked src and plugin ancestor directories", async () => {
    for (const directory of ["src", "plugin"]) {
      const root = await mkdtemp(path.join(tmpdir(), `agentmo-${directory}-parent-symlink-`));
      const packageRoot = await copyPackage(path.join(root, "package"));
      const outside = path.join(root, `${directory}-outside`);
      await rename(path.join(packageRoot, directory), outside);
      await symlink(outside, path.join(packageRoot, directory), "dir");
      await expectPackageRejection(packageRoot, "AGENTMO_BUILDER_PACKAGE_READ_FAILED");
    }
  });

  it("keeps a coincidental projected suffix self-contained without a receipt", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-coincidental-layout-"));
    const packageRoot = await copyPackage(path.join(
      root,
      "plugins/agentmo/runtime/agentmo",
    ));
    await mkdir(path.join(root, "plugins/agentmo/.codex-plugin"), { recursive: true });
    await writeFile(
      path.join(root, "plugins/agentmo/.codex-plugin/plugin.json"),
      '{"name":"wrong-sibling","version":"9.9.9","skills":"./skills/"}\n',
      "utf8",
    );
    const admitted = await import(
      `${pathToFileURL(path.join(packageRoot, "src/builder-package.js")).href}?coincidental=${Date.now()}`
    );
    assert.equal((await admitted.loadBuilderPackage()).name, "agentmo");
    assert.equal((await admitted.loadBuilderPackage({
      packageRoot,
      expectedReceiptDigest: `sha256:${"f".repeat(64)}`,
    })).name, "agentmo");
  });

  it("admits only the stable activated layout and rejects symlinked stable parents", async () => {
    const pristine = await installStableActivatedPackage();
    const missingReceipt = await callStablePackage(
      pristine,
      "load",
      { projectRoot: pristine.project },
    );
    assert.deepEqual(missingReceipt, {
      ok: false,
      code: "AGENTMO_BUILDER_PACKAGE_RECEIPT_DIGEST_REQUIRED",
    });
    const admitted = await callStablePackage(pristine);
    assert.equal(admitted.ok, true);
    assert.equal(admitted.result.name, "agentmo");
    assert.equal(admitted.result.releaseDigest, pristine.receipt.identity.releaseDigest);
    assert.equal(
      pristine.receipt.hostActivation.finalProjectionBinding.schemaVersion,
      "agentmo.codex-marketplace-projection-binding.v1",
    );
    assert.equal(
      pristine.receipt.hostActivation.finalProjectionBinding.members.some(
        (member) => member.kind === "directory",
      ),
      true,
    );

    await mkdir(path.dirname(pristine.projectedPackageRoot), { recursive: true });
    await cp(
      pristine.stablePackageRoot,
      pristine.projectedPackageRoot,
      { recursive: true },
    );
    const projectedActivated = await callStablePackage(
      pristine,
      "load",
      pristine.authority,
      pristine.projectedModuleUrl,
    );
    assert.deepEqual(projectedActivated, {
      ok: false,
      code: "AGENTMO_BUILDER_PACKAGE_LAYOUT_INVALID",
    });
    const unknownOption = await callStablePackage(pristine, "load", {
      ...pristine.authority,
      unsupportedStateRoot: pristine.stateRoot,
    });
    assert.deepEqual(unknownOption, {
      ok: false,
      code: "AGENTMO_BUILDER_PACKAGE_LAYOUT_INVALID",
    });

    const diagnosed = await callStablePackage(pristine, "diagnose");
    assert.equal(diagnosed.ok, true);
    const diagnostic = diagnosed.result;
    assert.equal(diagnostic.diagnosticOnly, true);
    assert.equal(diagnostic.trustAnchorVerified, false);
    assert.equal(diagnostic.supportCertified, false);
    assert.equal(diagnostic.source, "stable-projection");
    assert.equal(diagnostic.status, "observed");
    assert.equal(Object.hasOwn(diagnostic.candidate, "releaseDigest"), false);
    assert.equal(Object.hasOwn(diagnostic.candidate, "assets"), false);
    assert.equal(Array.isArray(diagnostic.candidate.assetObservations), true);
    assert.equal(diagnostic.candidate.assetObservations.some((asset) => Object.hasOwn(asset, "bytes")), false);

    const mismatchedReceiptDigest = `sha256:${"f".repeat(64)}`;
    assert.notEqual(mismatchedReceiptDigest, pristine.receiptDigest);
    const receiptRejected = await callStablePackage(pristine, "load", {
      ...pristine.authority,
      expectedReceiptDigest: mismatchedReceiptDigest,
    });
    assert.deepEqual(receiptRejected, {
      ok: false,
      code: "AGENTMO_BUILDER_PACKAGE_RECEIPT_DIGEST_MISMATCH",
    });

    const skillsPath = path.join(pristine.stateRoot, "marketplace/agentmo-local/plugins/agentmo/skills");
    const outsideSkills = path.join(pristine.stateRoot, "outside-skills");
    await rename(skillsPath, outsideSkills);
    await symlink(outsideSkills, skillsPath, "dir");
    const pluginParentRejected = await callStablePackage(pristine);
    assert.equal(
      [
        "AGENTMO_BUILDER_PACKAGE_LAYOUT_INVALID",
        "AGENTMO_BUILDER_PACKAGE_READ_FAILED",
        "AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED",
      ].includes(pluginParentRejected.code),
      true,
    );
    await unlink(skillsPath);
    await rename(outsideSkills, skillsPath);
    assert.equal((await callStablePackage(pristine)).ok, true);

    const runtimePath = path.join(pristine.stateRoot, "marketplace/agentmo-local/plugins/agentmo/runtime");
    const outsideRuntime = path.join(pristine.stateRoot, "outside-runtime");
    await rename(runtimePath, outsideRuntime);
    await symlink(outsideRuntime, runtimePath, "dir");
    const runtimeParentRejected = await callStablePackage(pristine);
    assert.equal(
      [
        "AGENTMO_BUILDER_PACKAGE_LAYOUT_INVALID",
        "AGENTMO_BUILDER_PACKAGE_READ_FAILED",
        "AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED",
      ].includes(runtimeParentRejected.code),
      true,
    );
    await unlink(runtimePath);
    await rename(outsideRuntime, runtimePath);
    assert.equal((await callStablePackage(pristine)).ok, true);

    const receiptPath = path.join(
      pristine.project,
      ".agentmo/builder/install-receipt.json",
    );
    const receiptBytes = await readFile(receiptPath);
    const hookPath = path.join(
      pristine.stateRoot,
      "marketplace/agentmo-local/plugins/agentmo/hooks/agentmo-hook.js",
    );
    await writeFile(
      hookPath,
      `${await readFile(hookPath, "utf8")}\n// changed after final binding\n`,
      "utf8",
    );

    const rejected = await callStablePackage(pristine);
    assert.deepEqual(rejected, {
      ok: false,
      code: "AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED",
    });
    assert.deepEqual(await readFile(receiptPath), receiptBytes);
  });
});
