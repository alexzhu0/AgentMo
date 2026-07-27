import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { digestRawBytes } from "../src/artifact-admission.js";
import {
  abortAppendOnlyPrepared,
  appendAppendOnlyRecord,
  readAppendOnlyAuthority,
} from "../src/builder-append-only-authority.js";
import { readBuilderLifecycleState } from "../src/builder-lifecycle.js";
import {
  applyBuilderInstall,
  applyBuilderInstallRecovery,
  BUILDER_INSTALL_ATTEMPT_AUTHORITY_PATH,
  BUILDER_INSTALL_RECEIPT_PATH,
  inspectBuilderInstallRecovery,
  planBuilderInstall,
  planBuilderInstallRecovery,
  prepareBuilderInstallArtifacts,
} from "../src/builder-install.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installModuleUrl = new URL("../src/builder-install.js", import.meta.url).href;
const appendOnlyChild = path.join(repoRoot, "test/helpers/append-only-child.js");
const installAuthorityOptions = Object.freeze({
  relativeRoot: BUILDER_INSTALL_ATTEMPT_AUTHORITY_PATH,
  namespace: "builder-install",
});
const codexStateAuthorityOptions = Object.freeze({
  relativeRoot: ".codex-selector-state-authority",
  namespace: "codex-selector-state",
});
const OUTCOME_STAGE_NAME = /^[a-f0-9]{64}\.outcome\.stage\.json$/u;

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

const freshInstallProcessSource = String.raw`
const request = JSON.parse(process.argv[1]);
if (request.stopAtAuthorityBoundary !== null) {
  const childProcess = await import("node:child_process");
  const { syncBuiltinESMExports } = await import("node:module");
  const originalSpawn = childProcess.default.spawn;
  const sequenceName = String(request.stopAtAuthoritySequence).padStart(16, "0") + ".json";
  const effectPayloadSequence = (effect) => {
    try {
      return JSON.parse(Buffer.from(effect.payload, "base64").toString("utf8")).sequence;
    } catch {
      return null;
    }
  };
  const shouldStopAtEffect = (effect) => {
    if (request.stopAtAuthorityBoundary === "claim") {
      return effect.action === "claim-symlink" && effect.name === sequenceName;
    }
    if (request.stopAtAuthorityBoundary === "record-stage") {
      return effect.action === "write-selected-file"
        && typeof effect.name === "string"
        && effect.name.endsWith(".record.stage.json")
        && effectPayloadSequence(effect) === request.stopAtAuthoritySequence;
    }
    if (request.stopAtAuthorityBoundary === "prepared") {
      return effect.action === "hardlink"
        && effect.name === sequenceName
        && typeof effect.sourceName === "string"
        && effect.sourceName.endsWith(".prepared.stage.json");
    }
    if (request.stopAtAuthorityBoundary === "record-linked") {
      return effect.action === "hardlink"
        && /^[0-9]{16}\.[a-f0-9]{64}\.json$/u.test(effect.name ?? "")
        && effect.name.startsWith(sequenceName.slice(0, -5) + ".")
        && typeof effect.sourceName === "string"
        && effect.sourceName.endsWith(".record.stage.json");
    }
    if (request.stopAtAuthorityBoundary === "outcome-linked") {
      return effect.action === "hardlink"
        && effect.name === sequenceName
        && typeof effect.sourceName === "string"
        && effect.sourceName.endsWith(".outcome.stage.json");
    }
    return request.stopAtAuthorityBoundary === "outcome-stage"
      && effect.action === "write-selected-file"
      && /^[a-f0-9]{64}\.outcome\.stage\.json$/u.test(effect.name ?? "")
      && effectPayloadSequence(effect) === request.stopAtAuthoritySequence;
  };
  childProcess.default.spawn = function interceptedSpawn(...argumentsList) {
    const child = originalSpawn.call(this, ...argumentsList);
    const originalEnd = child.stdin?.end;
    if (typeof originalEnd !== "function") return child;
    child.stdin.end = function interceptedEnd(payload, ...endArguments) {
      try {
        const effect = JSON.parse(String(payload));
        if (shouldStopAtEffect(effect)) {
          child.prependOnceListener("message", (message) => {
            if (message?.type === "result") process.kill(process.pid, "SIGSTOP");
          });
        }
      } catch {
        // Only the closed JSON POSIX-effect request is relevant to this harness.
      }
      return originalEnd.call(this, payload, ...endArguments);
    };
    return child;
  };
  syncBuiltinESMExports();
}
const {
  applyBuilderInstall,
  applyBuilderInstallRecovery,
  inspectBuilderInstallRecovery,
  planBuilderInstall,
  planBuilderInstallRecovery,
  prepareBuilderCodexMarketplaceProjection,
  prepareBuilderInstallArtifacts,
  publishBuilderCodexMarketplaceProjection,
} = await import(${JSON.stringify(installModuleUrl)});

const probe = ${JSON.stringify(compatibleProbe())};
const installOptions = {
  projectRoot: request.projectRoot,
  probe,
  ...(request.hostScope ? { hostScope: "user" } : {}),
  ...(request.expectedPriorReceiptDigest === null
    ? {}
    : { expectedPriorReceiptDigest: request.expectedPriorReceiptDigest }),
};

try {
  let value;
  if (request.action === "plan") {
    value = await planBuilderInstall(installOptions);
  } else if (request.action === "apply") {
    value = await applyBuilderInstall({
      ...installOptions,
      expectedPlanDigest: request.planDigest,
    });
  } else if (request.action === "inspect-recovery") {
    value = await inspectBuilderInstallRecovery({ projectRoot: request.projectRoot });
  } else if (request.action === "plan-recovery") {
    value = await planBuilderInstallRecovery({ projectRoot: request.projectRoot });
  } else if (request.action === "apply-recovery") {
    value = await applyBuilderInstallRecovery({
      projectRoot: request.projectRoot,
      expectedPlanDigest: request.planDigest,
    });
  } else if (request.action === "unreserved-marketplace-publication") {
    const artifacts = await prepareBuilderInstallArtifacts({
      projectRoot: request.projectRoot,
      probe,
    });
    const prepared = await prepareBuilderCodexMarketplaceProjection({
      release: artifacts.release,
    });
    value = await publishBuilderCodexMarketplaceProjection(prepared);
  } else {
    throw new Error("unknown child action");
  }
  process.stdout.write(JSON.stringify({ ok: true, value }));
} catch (error) {
  process.stdout.write(JSON.stringify({
    ok: false,
    errorCode: typeof error?.code === "string" ? error.code : "UNEXPECTED_CHILD_FAILURE",
  }));
  process.exitCode = 1;
}
`;

const fakeCodexSource = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const home = process.env.HOME;
const statePath = path.join(home, ".fake-codex-state.json");
const controlPath = path.join(home, ".fake-codex-control.json");
const logPath = path.join(home, ".fake-codex-log.jsonl");
const args = process.argv.slice(2);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { return fallback; }
}
function loadState() {
  return readJson(statePath, { marketplaceRoot: null, installed: false });
}
function loadControl() {
  return readJson(controlPath, {
    marketplaceAdd: "success",
    pluginAdd: "success",
    marketplaceAddDelayMs: 0,
  });
}
function saveState(state) {
  fs.writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });
}
function record(kind, detail = {}) {
  fs.appendFileSync(logPath, JSON.stringify({ kind, args, ...detail }) + "\\n", {
    mode: 0o600,
  });
}
function pluginRecord(state) {
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
// The host supervisor accepts only bytes observed before the direct command
// exits. Keep fixture command output observable before its intentional exit.
function emit(value) {
  process.stdout.write(value);
  setTimeout(() => process.exit(process.exitCode ?? 0), 50);
}
function completeMutation(delayMs) {
  const complete = () => {
    record("complete");
    emit("{}");
  };
  if (delayMs > 0) setTimeout(complete, delayMs);
  else complete();
}

record("invoke");
const state = loadState();
const control = loadControl();
if (args[0] === "plugin" && args[1] === "marketplace" && args[2] === "list") {
  emit(JSON.stringify({
    marketplaces: state.marketplaceRoot === null
      ? []
      : [{ name: "agentmo-local", source: state.marketplaceRoot }],
  }));
} else if (args[0] === "plugin" && args[1] === "list") {
  emit(JSON.stringify({
    installed: state.installed ? [pluginRecord(state)] : [],
    available: [],
  }));
} else if (args[0] === "plugin" && args[1] === "marketplace" && args[2] === "add") {
  if (control.marketplaceAdd === "fail") {
    record("complete", { failed: true });
    process.exitCode = 2;
  } else {
    state.marketplaceRoot = path.resolve(args[3]);
    saveState(state);
    completeMutation(control.marketplaceAddDelayMs);
  }
} else if (args[0] === "plugin" && args[1] === "add") {
  if (control.pluginAdd === "fail") {
    record("complete", { failed: true });
    process.exitCode = 2;
  } else {
    state.installed = true;
    saveState(state);
    completeMutation(0);
  }
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
        const current = loadState();
        let result;
        if (request.id === 1) {
          result = {};
        } else if (request.id === 2) {
          result = { data: current.installed ? [pluginRecord(current)] : [] };
        } else if (request.id === 3) {
          result = {
            data: [{
              cwd: process.cwd(),
              skills: current.installed ? [{ name: "agentmo" }] : [],
              errors: [],
            }],
          };
        } else if (request.id === 4) {
          result = {
            data: [{
              cwd: process.cwd(),
              hooks: current.installed ? [{
                pluginId: "agentmo@agentmo-local",
                enabled: true,
                trustStatus: "untrusted",
              }] : [],
              warnings: [],
              errors: [],
            }],
          };
        } else {
          result = {};
        }
        process.stdout.write(JSON.stringify({ id: request.id, result }) + "\\n");
      }
      newline = buffered.indexOf("\\n");
    }
  });
} else {
  record("complete", { failed: true });
  process.exitCode = 2;
}
`;

function childEnvironment(runtime) {
  const executablePath = [
    runtime.bin,
    path.dirname(process.execPath),
    "/usr/bin",
    "/bin",
  ].join(path.delimiter);
  return {
    HOME: runtime.home,
    CODEX_HOME: runtime.codexHome,
    PATH: executablePath,
    TMPDIR: tmpdir(),
    LANG: "C",
    LC_ALL: "C",
  };
}

async function createRuntime(prefix, options = {}) {
  const home = await mkdtemp(path.join(tmpdir(), prefix));
  const bin = path.join(home, "bin");
  const codexHome = path.join(home, ".codex");
  await Promise.all([
    mkdir(bin, { mode: 0o700 }),
    mkdir(codexHome, { mode: 0o700 }),
  ]);
  if (options.fakeCodex === true) {
    const codex = path.join(bin, "codex");
    await writeFile(codex, fakeCodexSource, { mode: 0o700 });
    await chmod(codex, 0o700);
  }
  return {
    home,
    bin,
    codexHome,
    stateRoot: path.join(home, ".agentmo", "builder", "codex-host"),
    controlPath: path.join(home, ".fake-codex-control.json"),
    logPath: path.join(home, ".fake-codex-log.jsonl"),
    statePath: path.join(home, ".fake-codex-state.json"),
  };
}

function startFreshInstallProcess(runtime, request, options = {}) {
  const stopAtAuthorityBoundary = options.stopAtAuthorityBoundary
    ?? (options.stopAtOutcomeStage === true ? "outcome-stage" : null);
  const normalized = {
    action: request.action,
    projectRoot: request.projectRoot,
    planDigest: request.planDigest ?? null,
    expectedPriorReceiptDigest: request.expectedPriorReceiptDigest ?? null,
    hostScope: request.hostScope === true,
    stopAtAuthorityBoundary,
    stopAtAuthoritySequence: options.stopAtAuthoritySequence ?? 0,
  };
  const child = spawn(process.execPath, [
    "--input-type=module",
    "--eval",
    freshInstallProcessSource,
    JSON.stringify(normalized),
  ], {
    cwd: repoRoot,
    // Interruption tests must stop the complete fresh-process tree. The
    // install process can be awaiting a POSIX effect child (and, on Darwin,
    // that child's Python FD bridge), so signalling only the Node parent lets
    // a child append or publish after the observation point.
    detached: options.interruptible === true,
    env: childEnvironment(runtime),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      let output = null;
      let parseError = null;
      if (stdout !== "") {
        try {
          output = JSON.parse(stdout);
        } catch (error) {
          parseError = error instanceof Error ? error.message : String(error);
        }
      }
      resolve({
        code,
        signal,
        stderr,
        stdout,
        output,
        parseError,
      });
    });
  });
  return {
    child,
    exited,
    processGroupId: options.interruptible === true ? child.pid : null,
  };
}

function signalFreshInstallProcessGroup(running, signal) {
  const processId = running.processGroupId;
  assert.ok(Number.isSafeInteger(processId) && processId > 0,
    "fresh install process must have a process-group leader");
  try {
    process.kill(-processId, signal);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function runFreshInstallProcess(runtime, request) {
  return (await startFreshInstallProcess(runtime, request).exited);
}

async function runFileLimitedAppend(options) {
  const child = spawn(
    "/bin/sh",
    [
      "-c",
      "ulimit -c 0; ulimit -f 1; exec \"$@\"",
      "agentmo-install-file-limited",
      process.execPath,
      appendOnlyChild,
      JSON.stringify({ action: "append", options }),
    ],
    {
      cwd: options.projectRoot,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  return new Promise((resolve, reject) => {
    let terminal = null;
    child.on("error", reject);
    child.on("message", (message) => {
      if (["result", "error"].includes(message?.type)) terminal = message;
    });
    child.on("close", (code, signal) => resolve({ ...terminal, code, signal }));
  });
}

function assertFreshSuccess(result) {
  const diagnostic = [
    result.stderr,
    result.stdout,
    result.parseError,
    JSON.stringify(result.output),
  ].filter(Boolean).join("\n");
  assert.equal(result.signal, null, diagnostic);
  assert.equal(result.code, 0, diagnostic);
  assert.equal(result.output?.ok, true, diagnostic);
  return result.output.value;
}

async function absent(filePath) {
  await assert.rejects(() => stat(filePath), (error) => error?.code === "ENOENT");
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function findPathsMatching(root, predicate) {
  const matches = [];
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (predicate(entry.name, absolutePath)) matches.push(absolutePath);
      if (entry.isDirectory()) await visit(absolutePath);
    }
  };
  await visit(root);
  return matches.sort();
}

function absolute(project, relativePath) {
  return path.join(project, ...relativePath.split("/"));
}

async function freshInstallFixture(prefix) {
  const project = await mkdtemp(path.join(tmpdir(), prefix));
  const runtime = await createRuntime(`${prefix}home-`);
  const probe = compatibleProbe();
  const preview = await planBuilderInstall({ projectRoot: project, probe });
  const artifacts = await prepareBuilderInstallArtifacts({ projectRoot: project, probe });
  return { project, runtime, probe, preview, artifacts };
}

async function installAuthority(projectRoot) {
  return readAppendOnlyAuthority({
    projectRoot,
    ...installAuthorityOptions,
  });
}

async function codexStateAuthority(runtime) {
  return readAppendOnlyAuthority({
    projectRoot: runtime.stateRoot,
    ...codexStateAuthorityOptions,
  });
}

function latestAttempt(authority) {
  return authority.records.at(-1)?.payload ?? null;
}

function stageProvenance(attempt) {
  return attempt.stages.map((stage) => ({
    relativePath: stage.relativePath,
    destinationPath: stage.destinationPath,
    digest: stage.digest,
    identity: stage.identity,
  })).toSorted((left, right) => left.destinationPath.localeCompare(right.destinationPath));
}

async function waitForObservation(running, label, observe, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const observed = await observe();
      if (observed !== null && observed !== false && observed !== undefined) return observed;
    } catch {
      // The child may be between an append-only claim and its durable record.
    }
    if (running !== null
      && (running.child.exitCode !== null || running.child.signalCode !== null)) {
      const exited = await running.exited;
      throw new Error(`${label}: child exited early (${exited.code}/${exited.signal}): ${exited.stderr}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`${label}: observation timed out`);
}

async function killAfterObservation(running, label, observe, timeoutMs = 20_000) {
  let observed;
  try {
    observed = await waitForObservation(running, label, observe, timeoutMs);
  } catch (error) {
    if (running.child.exitCode === null && running.child.signalCode === null) {
      signalFreshInstallProcessGroup(running, "SIGKILL");
      await running.exited;
    }
    throw error;
  }
  assert.equal(signalFreshInstallProcessGroup(running, "SIGKILL"), true, label);
  const exited = await running.exited;
  assert.equal(exited.signal, "SIGKILL", exited.stderr);
  return observed;
}

async function killAfterStoppedObservation(
  running,
  label,
  observe,
  verifyStopped,
  timeoutMs = 20_000,
) {
  let observed;
  try {
    observed = await waitForObservation(running, label, observe, timeoutMs);
    assert.equal(signalFreshInstallProcessGroup(running, "SIGSTOP"), true, label);
    await verifyStopped(observed);
  } catch (error) {
    if (running.child.exitCode === null && running.child.signalCode === null) {
      signalFreshInstallProcessGroup(running, "SIGKILL");
      await running.exited;
    }
    throw error;
  }
  assert.equal(signalFreshInstallProcessGroup(running, "SIGKILL"), true, label);
  const exited = await running.exited;
  assert.equal(exited.signal, "SIGKILL", exited.stderr);
  return observed;
}

async function killAtClaimOnlyInstallPrefix(
  running,
  projectRoot,
  options = {},
) {
  return killAtInstallAuthorityBoundary(running, projectRoot, {
    ...options,
    boundary: "claim",
  });
}

function matchesIncompleteAuthorityBoundary(recovery, boundary) {
  if (recovery === null || recovery === undefined) return false;
  const selectedWriteIncomplete = (recovery.incompleteRecordStage ?? null) !== null
    || (recovery.incompletePreparedStage ?? null) !== null
    || (recovery.incompleteStagedOutcome ?? null) !== null;
  if (boundary === "claim") {
    return !selectedWriteIncomplete
      && recovery.preparedBytes === null
      && recovery.recordStagePresent === false
      && recovery.recordLinked === false
      && recovery.stagedOutcome === null;
  }
  if (boundary === "record-stage") {
    return !selectedWriteIncomplete
      && recovery.preparedBytes === null
      && recovery.recordStagePresent === true
      && recovery.recordLinked === false
      && recovery.stagedOutcome === null;
  }
  if (boundary === "prepared") {
    return !selectedWriteIncomplete
      && recovery.preparedBytes !== null
      && recovery.recordLinked === false
      && recovery.stagedOutcome === null;
  }
  if (boundary === "record-linked") {
    return !selectedWriteIncomplete
      && recovery.preparedBytes !== null
      && recovery.recordLinked === true
      && recovery.stagedOutcome === null;
  }
  if (boundary === "outcome-stage") {
    return !selectedWriteIncomplete && recovery.stagedOutcome !== null;
  }
  throw new Error(`unknown append-only interruption boundary: ${boundary}`);
}

async function completeJsonEntry(
  directory,
  predicate,
  expectedLinks,
  valuePredicate = () => true,
) {
  const names = await readdir(directory).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  for (const name of names.filter(predicate)) {
    const filePath = path.join(directory, name);
    const stats = await lstat(filePath, { bigint: true }).catch(() => null);
    if (!stats?.isFile() || stats.nlink !== expectedLinks) continue;
    try {
      const bytes = await readFile(filePath);
      if (bytes.at(-1) !== 0x0a) continue;
      const value = JSON.parse(bytes.toString("utf8"));
      if (!valuePredicate(value)) continue;
      return true;
    } catch {
      // The selected writer still owns an incomplete prefix.
    }
  }
  return false;
}

async function installBoundaryEntryVisible(projectRoot, boundary, expectedSequence) {
  const authorityRoot = path.join(
    projectRoot,
    ...BUILDER_INSTALL_ATTEMPT_AUTHORITY_PATH.split("/"),
  );
  if (boundary === "claim") {
    const claims = await readdir(path.join(authorityRoot, "claims"), {
      withFileTypes: true,
    }).catch((error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    });
    return claims.some((entry) => (
      entry.isSymbolicLink()
      && entry.name === `${String(expectedSequence).padStart(16, "0")}.json`
    ));
  }
  if (boundary === "record-stage") {
    return completeJsonEntry(
      path.join(authorityRoot, "entries"),
      (name) => name.endsWith(".record.stage.json"),
      1n,
      (value) => value?.sequence === expectedSequence,
    );
  }
  if (boundary === "prepared") {
    return completeJsonEntry(
      path.join(authorityRoot, "prepared"),
      (name) => name === `${String(expectedSequence).padStart(16, "0")}.json`,
      2n,
    );
  }
  if (boundary === "record-linked") {
    return completeJsonEntry(
      path.join(authorityRoot, "entries"),
      (name) => name.startsWith(
        `${String(expectedSequence).padStart(16, "0")}.`,
      ) && /^\d{16}\.[a-f0-9]{64}\.json$/u.test(name),
      2n,
    );
  }
  return false;
}

async function killAtInstallAuthorityBoundary(
  running,
  projectRoot,
  options = {},
) {
  const expectedSequence = options.expectedSequence ?? 0;
  const expectedRecordCount = options.expectedRecordCount ?? 0;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const boundary = options.boundary;
  if (boundary === "outcome-stage") {
    return killAtDurableInstallOutcomeStage(
      running,
      projectRoot,
      { expectedSequence, expectedRecordCount, timeoutMs },
    );
  }
  const deadline = Date.now() + timeoutMs;
  let lastObservedState = null;
  while (Date.now() < deadline) {
    if (running.child.exitCode !== null || running.child.signalCode !== null) {
      const exited = await running.exited;
      throw new Error(`install append-only ${boundary} boundary: child exited early (${exited.code}/${exited.signal})`);
    }
    try {
      if (!await installBoundaryEntryVisible(projectRoot, boundary, expectedSequence)) {
        await new Promise((resolve) => setImmediate(resolve));
        continue;
      }
      assert.equal(signalFreshInstallProcessGroup(running, "SIGSTOP"), true);
      const authority = await installAuthority(projectRoot);
      const recovery = authority.recoveryRequired;
      lastObservedState = {
        records: authority.records.length,
        nextSequence: authority.nextSequence,
        recovery: recovery === null ? null : {
          sequence: recovery.sequence,
          preparedBytes: recovery.preparedBytes !== null,
          recordStagePresent: recovery.recordStagePresent,
          recordLinked: recovery.recordLinked,
          stagedOutcome: recovery.stagedOutcome !== null,
          incompleteRecordStage: recovery.incompleteRecordStage !== null,
          incompletePreparedStage: recovery.incompletePreparedStage !== null,
          incompleteStagedOutcome: recovery.incompleteStagedOutcome !== null,
        },
      };
      if (authority.records.length === expectedRecordCount
        && authority.nextSequence === expectedSequence
        && recovery?.sequence === expectedSequence
        && matchesIncompleteAuthorityBoundary(recovery, boundary)) {
        assert.equal(signalFreshInstallProcessGroup(running, "SIGKILL"), true);
        const exited = await running.exited;
        assert.equal(exited.signal, "SIGKILL", exited.stderr);
        return authority;
      }
      assert.equal(signalFreshInstallProcessGroup(running, "SIGCONT"), true);
    } catch (error) {
      if (running.child.exitCode !== null || running.child.signalCode !== null) throw error;
      signalFreshInstallProcessGroup(running, "SIGCONT");
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  if (running.child.exitCode === null && running.child.signalCode === null) {
    signalFreshInstallProcessGroup(running, "SIGKILL");
    await running.exited;
  }
  throw new Error(
    `install append-only ${boundary} boundary was not observed before timeout`
      + (lastObservedState === null ? "" : `; last state ${JSON.stringify(lastObservedState)}`),
  );
}

async function killAtDurableInstallOutcomeStage(
  running,
  projectRoot,
  { expectedSequence, expectedRecordCount, timeoutMs },
) {
  const outcomes = path.join(
    projectRoot,
    ...BUILDER_INSTALL_ATTEMPT_AUTHORITY_PATH.split("/"),
    "outcomes",
  );
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (running.child.exitCode !== null || running.child.signalCode !== null) {
      const exited = await running.exited;
      throw new Error(`install append-only outcome-stage boundary: child exited early (${exited.code}/${exited.signal})`);
    }
    let frozen = false;
    try {
      const names = await readdir(outcomes);
      let stageName = null;
      for (const name of names) {
        if (!OUTCOME_STAGE_NAME.test(name)) continue;
        const stats = await lstat(path.join(outcomes, name), { bigint: true }).catch((error) => {
          if (error?.code === "ENOENT") return null;
          throw error;
        });
        if (stats?.isFile() && stats.nlink === 1n) {
          try {
            const bytes = await readFile(path.join(outcomes, name));
            if (bytes.at(-1) === 0x0a) {
              const value = JSON.parse(bytes.toString("utf8"));
              if (value?.sequence === expectedSequence) {
                stageName = name;
                break;
              }
            }
          } catch {
            // The selected writer still owns an incomplete outcome prefix.
          }
        }
      }
      if (stageName !== null) {
        // The stage has a durable directory entry before the next POSIX effect
        // can add its final hardlink. Freeze the entire process group first;
        // only then read the authority to avoid racing its finalization.
        assert.equal(signalFreshInstallProcessGroup(running, "SIGSTOP"), true);
        frozen = true;
        const stopped = await installAuthority(projectRoot);
        assert.equal(stopped.records.length, expectedRecordCount);
        assert.equal(stopped.nextSequence, expectedSequence);
        assert.equal(stopped.recoveryRequired?.sequence, expectedSequence);
        assert.equal(
          matchesIncompleteAuthorityBoundary(stopped.recoveryRequired, "outcome-stage"),
          true,
          JSON.stringify({
            stagedOutcome: stopped.recoveryRequired?.stagedOutcome !== null,
            incompleteRecordStage:
              (stopped.recoveryRequired?.incompleteRecordStage ?? null) !== null,
            incompletePreparedStage:
              (stopped.recoveryRequired?.incompletePreparedStage ?? null) !== null,
            incompleteStagedOutcome:
              (stopped.recoveryRequired?.incompleteStagedOutcome ?? null) !== null,
          }),
        );
        assert.equal(signalFreshInstallProcessGroup(running, "SIGKILL"), true);
        const exited = await running.exited;
        assert.equal(exited.signal, "SIGKILL", exited.stderr);
        return stopped;
      }
    } catch (error) {
      if (frozen || running.child.exitCode !== null || running.child.signalCode !== null) {
        if (frozen && running.child.exitCode === null && running.child.signalCode === null) {
          signalFreshInstallProcessGroup(running, "SIGKILL");
          await running.exited;
        }
        throw error;
      }
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  if (running.child.exitCode === null && running.child.signalCode === null) {
    signalFreshInstallProcessGroup(running, "SIGKILL");
    await running.exited;
  }
  throw new Error("install append-only outcome-stage boundary was not observed before timeout");
}

async function readJsonLines(filePath) {
  try {
    const text = await readFile(filePath, "utf8");
    return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function writeHostControl(runtime, overrides = {}) {
  await writeFile(runtime.controlPath, JSON.stringify({
    marketplaceAdd: "success",
    pluginAdd: "success",
    marketplaceAddDelayMs: 0,
    ...overrides,
  }), { mode: 0o600 });
}

function isCommand(entry, ...prefix) {
  return entry.kind === "invoke"
    && prefix.every((value, index) => entry.args[index] === value);
}

async function managedProjectionSnapshot(project, artifacts) {
  const snapshot = {};
  for (const desired of [...artifacts.managedFiles, artifacts.receiptFile]) {
    const target = absolute(project, desired.relativePath);
    try {
      const info = await lstat(target, { bigint: true });
      snapshot[desired.relativePath] = {
        kind: info.isSymbolicLink() ? "symlink" : info.isFile() ? "file" : "other",
        device: info.dev.toString(10),
        inode: info.ino.toString(10),
        links: info.nlink.toString(10),
        bytes: info.isFile() ? await readFile(target) : null,
      };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      snapshot[desired.relativePath] = { kind: "absent" };
    }
  }
  return snapshot;
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

async function recoverInFreshProcess(runtime, projectRoot) {
  const plan = assertFreshSuccess(await runFreshInstallProcess(runtime, {
    action: "plan-recovery",
    projectRoot,
  }));
  assert.equal(plan.status, "ready");
  const result = assertFreshSuccess(await runFreshInstallProcess(runtime, {
    action: "apply-recovery",
    projectRoot,
    planDigest: plan.planDigest,
  }));
  assert.equal(result.status, "superseded");
  return { plan, result };
}

async function recoverIncompleteAuthorityBoundaryInFreshProcess(
  runtime,
  projectRoot,
  { status, operation, resultStatus },
) {
  const inspection = assertFreshSuccess(await runFreshInstallProcess(runtime, {
    action: "inspect-recovery",
    projectRoot,
  }));
  assert.equal(inspection.status, status);
  assert.equal(inspection.applicable, true);
  const plan = assertFreshSuccess(await runFreshInstallProcess(runtime, {
    action: "plan-recovery",
    projectRoot,
  }));
  assert.equal(plan.status, "ready");
  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].operation, operation);
  const result = assertFreshSuccess(await runFreshInstallProcess(runtime, {
    action: "apply-recovery",
    projectRoot,
    planDigest: plan.planDigest,
  }));
  assert.equal(result.status, resultStatus);
  return { inspection, plan, result };
}

function recoveryAttemptProvenance(attempt) {
  return {
    ...attempt,
    stages: stageProvenance(attempt),
  };
}

async function recoverSecondInterruptedAttemptInFreshProcesses(
  runtime,
  projectRoot,
  interruptedAttempt,
) {
  const expectedProvenance = recoveryAttemptProvenance(interruptedAttempt);
  const authorityBefore = await installAuthority(projectRoot);
  const expectedAuthorityDigest = authorityBefore.headDigest;
  const planChanges = [];
  for (let attemptNumber = 0; attemptNumber < 2; attemptNumber += 1) {
    const authority = await installAuthority(projectRoot);
    const before = latestAttempt(authority);
    assert.equal(authority.headDigest, expectedAuthorityDigest);
    assert.deepEqual(recoveryAttemptProvenance(before), expectedProvenance);
    const plan = assertFreshSuccess(await runFreshInstallProcess(runtime, {
      action: "plan-recovery",
      projectRoot,
    }));
    assert.equal(plan.status, "ready");
    const applied = await runFreshInstallProcess(runtime, {
      action: "apply-recovery",
      projectRoot,
      planDigest: plan.planDigest,
    });
    if (applied.signal === null
      && applied.code === 1
      && applied.output?.ok === false
      && applied.output.errorCode === "AGENTMO_BUILDER_INSTALL_RECOVERY_PLAN_CHANGED") {
      assert.equal(attemptNumber, 0, "only one fresh re-plan is permitted");
      const afterAuthority = await installAuthority(projectRoot);
      assert.equal(afterAuthority.headDigest, expectedAuthorityDigest);
      assert.deepEqual(
        recoveryAttemptProvenance(latestAttempt(afterAuthority)),
        expectedProvenance,
      );
      planChanges.push(plan.planDigest);
      continue;
    }
    const result = assertFreshSuccess(applied);
    assert.equal(result.status, "superseded");
    return { plan, result, planChanges };
  }
  assert.fail("second interrupted attempt did not converge after one fresh re-plan");
}

describe("Builder v1 append-only install attempts", () => {
  it("rejects a probe that falsely attests host non-mutation before writing", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agentmo-install-probe-mutation-"));
    const probe = compatibleProbe();
    await assert.rejects(
      prepareBuilderInstallArtifacts({
        projectRoot: project,
        probe: { ...probe, mutatesHost: false },
      }),
      (error) => error?.code === "AGENTMO_BUILDER_INSTALL_PROBE_REJECTED",
    );
    const prepared = await prepareBuilderInstallArtifacts({
      projectRoot: project,
      probe,
    });
    const receipt = JSON.parse(prepared.receiptFile.bytes);
    assert.equal(receipt.capabilitySnapshot.mutatesHost, "unknown");
    assert.equal(receipt.capabilitySnapshot.externalCommandMutation, "unknown");
    assert.deepEqual(await readdir(project), []);
  });

  it("repairs a real SIGKILL append-only claim prefix before allowing a safe retry", async () => {
    const fixture = await freshInstallFixture("agentmo-install-claim-prefix-kill-");
    const running = startFreshInstallProcess(fixture.runtime, {
      action: "apply",
      projectRoot: fixture.project,
      planDigest: fixture.preview.planDigest,
    }, { interruptible: true });
    const prefixAuthority = await killAtClaimOnlyInstallPrefix(running, fixture.project);
    const prefix = prefixAuthority.recoveryRequired;
    assert.ok(prefix);

    const inspection = await inspectBuilderInstallRecovery({ projectRoot: fixture.project });
    assert.equal(inspection.status, "append-only-prefix");
    assert.equal(inspection.applicable, true);
    assert.equal(inspection.authorityPrefix.recordDigest, prefix.recordDigest);
    assert.equal(inspection.repair, "abort-append-only-authority-prefix");

    const recoveryPlan = await planBuilderInstallRecovery({ projectRoot: fixture.project });
    assert.equal(recoveryPlan.status, "ready");
    assert.equal(recoveryPlan.operations[0].operation, "abort-append-only-authority-prefix");
    assert.equal(
      recoveryPlan.operations[0].expectedPreparedRecordDigest,
      prefix.recordDigest,
    );
    const repaired = await applyBuilderInstallRecovery({
      projectRoot: fixture.project,
      expectedPlanDigest: recoveryPlan.planDigest,
    });
    assert.equal(repaired.status, "append-only-prefix-aborted");
    const repairedAuthority = await installAuthority(fixture.project);
    assert.equal(repairedAuthority.recoveryRequired, null);
    assert.equal(repairedAuthority.records.length, 0);
    assert.equal(
      repairedAuthority.aborted.some((entry) => entry.recordDigest === prefix.recordDigest),
      true,
    );

    const retryPlan = await planBuilderInstall({
      projectRoot: fixture.project,
      probe: fixture.probe,
    });
    const retry = await applyBuilderInstall({
      projectRoot: fixture.project,
      probe: fixture.probe,
      expectedPlanDigest: retryPlan.planDigest,
    });
    assert.equal(retry.status, "projected");
  });

  it("classifies a selected install-authority prefix as exact-resume-required, never abortable", async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), "agentmo-install-selected-prefix-"));
    const operationId = "a".repeat(64);
    const request = {
      projectRoot,
      relativeRoot: BUILDER_INSTALL_ATTEMPT_AUTHORITY_PATH,
      namespace: "builder-install",
      idempotencyKey: `attempt:${operationId}`,
      payload: {
        schemaVersion: "agentmo.builder-install-attempt.v2",
        filler: "x".repeat(2_000),
      },
    };
    const limited = await runFileLimitedAppend(request);
    assert.equal(limited.type, "error");
    assert.equal(limited.code, 1);

    const authority = await installAuthority(projectRoot);
    const incomplete = authority.recoveryRequired?.incompleteRecordStage;
    assert.ok(incomplete);
    assert.ok(incomplete.bytes.length > 0);
    assert.ok(incomplete.bytes.length < incomplete.selectedLength);
    const inspection = await inspectBuilderInstallRecovery({ projectRoot });
    assert.equal(inspection.status, "selected-write-prefix");
    assert.equal(inspection.applicable, false);
    assert.equal(inspection.repair, "resume-exact-selected-append-only-authority-write");
    assert.deepEqual(
      inspection.blockers,
      ["resume-original-append-only-authority-write"],
    );
    assert.deepEqual(
      inspection.authorityPrefix.selectedWriteRecovery,
      {
        publication: "record-stage-prefix",
        selectedDigest: incomplete.selectedDigest,
        selectedLength: incomplete.selectedLength,
        prefixDigest: digestRawBytes(incomplete.bytes),
        prefixLength: incomplete.bytes.length,
        prefixIdentity: incomplete.identity,
      },
    );

    const plan = await planBuilderInstallRecovery({ projectRoot });
    assert.equal(plan.status, "blocked");
    assert.equal(plan.applicable, false);
    assert.deepEqual(plan.operations, []);
    await assert.rejects(
      applyBuilderInstallRecovery({
        projectRoot,
        expectedPlanDigest: plan.planDigest,
      }),
      (error) => error?.code === "AGENTMO_BUILDER_INSTALL_RECOVERY_NOT_APPLICABLE",
    );
    await assert.rejects(
      abortAppendOnlyPrepared({
        projectRoot,
        relativeRoot: BUILDER_INSTALL_ATTEMPT_AUTHORITY_PATH,
        namespace: "builder-install",
        expectedPreparedRecordDigest: authority.recoveryRequired.recordDigest,
        reason: "OPERATOR_CANCELLED",
      }),
      (error) => error?.code === "AGENTMO_APPEND_ONLY_SELECTED_WRITE_RECOVERY_REQUIRED",
    );
    const unchanged = await installAuthority(projectRoot);
    assert.deepEqual(
      unchanged.recoveryRequired.incompleteRecordStage,
      incomplete,
    );

    const resumed = await appendAppendOnlyRecord(request);
    assert.equal(resumed.status, "committed");
    assert.equal(resumed.identity.device, incomplete.identity.device);
    assert.equal(resumed.identity.inode, incomplete.identity.inode);
  });

  it("aborts only a real SIGKILL append-only claim suffix after an attempt record and requires a fresh recovery preview", async () => {
    const fixture = await freshInstallFixture("agentmo-install-claim-suffix-kill-");
    const running = startFreshInstallProcess(fixture.runtime, {
      action: "apply",
      projectRoot: fixture.project,
      planDigest: fixture.preview.planDigest,
    }, { interruptible: true });
    const suffixAuthority = await killAtClaimOnlyInstallPrefix(running, fixture.project, {
      expectedSequence: 1,
      expectedRecordCount: 1,
    });
    const suffix = suffixAuthority.recoveryRequired;
    const inheritedAttempt = latestAttempt(suffixAuthority);
    assert.ok(suffix);
    assert.equal(inheritedAttempt?.disposition, "attempt");
    assert.equal(suffix.idempotencyKey, `prepared:${inheritedAttempt.operationId}`);
    assert.equal(suffix.predecessorRecordDigest, suffixAuthority.headRecordDigest);
    assert.equal(suffix.predecessorOutcomeDigest, suffixAuthority.headOutcomeDigest);
    assert.equal(suffix.sequence, suffixAuthority.nextSequence);
    const projectionBefore = await managedProjectionSnapshot(fixture.project, fixture.artifacts);
    const stagesBefore = await findPathsMatching(
      fixture.project,
      (name) => name.startsWith(".agentmo-stage-"),
    );

    const inspection = await inspectBuilderInstallRecovery({ projectRoot: fixture.project });
    assert.equal(inspection.status, "append-only-suffix");
    assert.equal(inspection.applicable, true);
    assert.equal(inspection.repreviewRequired, true);
    assert.equal(inspection.attempt.operationId, inheritedAttempt.operationId);
    assert.equal(inspection.authoritySuffix.inheritedRecord.digest, suffixAuthority.headRecordDigest);
    assert.equal(inspection.authoritySuffix.recordDigest, suffix.recordDigest);

    const recoveryPlan = assertFreshSuccess(await runFreshInstallProcess(fixture.runtime, {
      action: "plan-recovery",
      projectRoot: fixture.project,
    }));
    assert.equal(recoveryPlan.schemaVersion, "agentmo.builder-install-recovery-plan.v6");
    assert.equal(recoveryPlan.status, "ready");
    assert.equal(recoveryPlan.repreviewRequired, true);
    assert.equal(recoveryPlan.operations.length, 1);
    assert.equal(recoveryPlan.operations[0].operation, "abort-append-only-authority-suffix");
    assert.equal(recoveryPlan.operations[0].expectedPreparedRecordDigest, suffix.recordDigest);
    const repaired = assertFreshSuccess(await runFreshInstallProcess(fixture.runtime, {
      action: "apply-recovery",
      projectRoot: fixture.project,
      planDigest: recoveryPlan.planDigest,
    }));
    assert.equal(repaired.status, "append-only-suffix-aborted-repreview-required");
    assert.equal(repaired.newSetupAllowed, false);
    assert.equal(repaired.repreviewRequired, true);
    assert.equal(repaired.survivingTransactionId, inheritedAttempt.operationId);
    assert.equal(repaired.survivingDisposition, "attempt");

    const authorityAfter = await installAuthority(fixture.project);
    assert.equal(authorityAfter.recoveryRequired, null);
    assert.equal(authorityAfter.headRecordDigest, suffixAuthority.headRecordDigest);
    assert.deepEqual(authorityAfter.records, suffixAuthority.records);
    const suffixAbort = authorityAfter.aborted.find(
      (entry) => entry.recordDigest === suffix.recordDigest,
    );
    assert.equal(suffixAbort?.sequence, suffix.sequence);
    assert.equal(suffixAbort?.idempotencyKey, suffix.idempotencyKey);
    assert.deepEqual(await managedProjectionSnapshot(fixture.project, fixture.artifacts), projectionBefore);
    assert.deepEqual(
      await findPathsMatching(fixture.project, (name) => name.startsWith(".agentmo-stage-")),
      stagesBefore,
    );

    const reinspection = assertFreshSuccess(await runFreshInstallProcess(fixture.runtime, {
      action: "inspect-recovery",
      projectRoot: fixture.project,
    }));
    assert.equal(reinspection.status, "attempt");
    assert.equal(reinspection.applicable, true);
    const repreview = assertFreshSuccess(await runFreshInstallProcess(fixture.runtime, {
      action: "plan-recovery",
      projectRoot: fixture.project,
    }));
    assert.equal(repreview.status, "ready");
    const recovered = assertFreshSuccess(await runFreshInstallProcess(fixture.runtime, {
      action: "apply-recovery",
      projectRoot: fixture.project,
      planDigest: repreview.planDigest,
    }));
    assert.equal(recovered.status, "superseded");
    assert.deepEqual(await managedProjectionSnapshot(fixture.project, fixture.artifacts), projectionBefore);
    assert.deepEqual(
      await findPathsMatching(fixture.project, (name) => name.startsWith(".agentmo-stage-")),
      stagesBefore,
    );
    const retryPlan = assertFreshSuccess(await runFreshInstallProcess(fixture.runtime, {
      action: "plan",
      projectRoot: fixture.project,
    }));
    const retry = assertFreshSuccess(await runFreshInstallProcess(fixture.runtime, {
      action: "apply",
      projectRoot: fixture.project,
      planDigest: retryPlan.planDigest,
    }));
    assert.equal(retry.status, "projected");
  });

  it("aborts every real first-record pre-outcome append-only prefix and reopens setup", async () => {
    for (const boundary of ["record-stage", "prepared", "record-linked"]) {
      const fixture = await freshInstallFixture(`agentmo-install-first-${boundary}-kill-`);
      const running = startFreshInstallProcess(fixture.runtime, {
        action: "apply",
        projectRoot: fixture.project,
        planDigest: fixture.preview.planDigest,
      }, {
        interruptible: true,
        stopAtAuthorityBoundary: boundary,
        stopAtAuthoritySequence: 0,
      });
      const interrupted = await killAtInstallAuthorityBoundary(running, fixture.project, { boundary });
      assert.equal(interrupted.records.length, 0, boundary);
      assert.equal(interrupted.recoveryRequired?.recordStagePresent, true, boundary);
      assert.equal(interrupted.recoveryRequired?.stagedOutcome, null, boundary);

      const recovered = await recoverIncompleteAuthorityBoundaryInFreshProcess(
        fixture.runtime,
        fixture.project,
        {
          status: "append-only-prefix",
          operation: "abort-append-only-authority-prefix",
          resultStatus: "append-only-prefix-aborted",
        },
      );
      assert.equal(recovered.result.newSetupAllowed, true, boundary);
      const authority = await installAuthority(fixture.project);
      assert.equal(authority.recoveryRequired, null, boundary);
      assert.equal(authority.records.length, 0, boundary);
      assert.equal(authority.aborted.length, 1, boundary);
      assert.equal(
        assertFreshSuccess(await runFreshInstallProcess(fixture.runtime, {
          action: "plan",
          projectRoot: fixture.project,
        })).schemaVersion,
        "agentmo.builder-install-plan.v1",
        boundary,
      );
    }
  });

  it("aborts every real suffix pre-outcome append-only prefix before superseding the retained attempt", async () => {
    for (const boundary of ["record-stage", "prepared", "record-linked"]) {
      const fixture = await freshInstallFixture(`agentmo-install-suffix-${boundary}-kill-`);
      const running = startFreshInstallProcess(fixture.runtime, {
        action: "apply",
        projectRoot: fixture.project,
        planDigest: fixture.preview.planDigest,
      }, {
        interruptible: true,
        stopAtAuthorityBoundary: boundary,
        stopAtAuthoritySequence: 1,
      });
      const interrupted = await killAtInstallAuthorityBoundary(running, fixture.project, {
        boundary,
        expectedSequence: 1,
        expectedRecordCount: 1,
      });
      assert.equal(interrupted.records.length, 1, boundary);
      assert.equal(interrupted.recoveryRequired?.recordStagePresent, true, boundary);
      assert.equal(interrupted.recoveryRequired?.stagedOutcome, null, boundary);

      const recovered = await recoverIncompleteAuthorityBoundaryInFreshProcess(
        fixture.runtime,
        fixture.project,
        {
          status: "append-only-suffix",
          operation: "abort-append-only-authority-suffix",
          resultStatus: "append-only-suffix-aborted-repreview-required",
        },
      );
      assert.equal(recovered.result.newSetupAllowed, false, boundary);
      assert.equal(recovered.result.repreviewRequired, true, boundary);
      const authority = await installAuthority(fixture.project);
      assert.equal(authority.recoveryRequired, null, boundary);
      assert.equal(authority.records.length, 1, boundary);
      await recoverInFreshProcess(fixture.runtime, fixture.project);
      assert.equal(
        assertFreshSuccess(await runFreshInstallProcess(fixture.runtime, {
          action: "plan",
          projectRoot: fixture.project,
        })).schemaVersion,
        "agentmo.builder-install-plan.v1",
        boundary,
      );
    }
  });

  it("finalizes exact real staged outcomes before the normal non-deleting recovery path", async () => {
    for (const shape of [
      { name: "first", expectedSequence: 0, expectedRecordCount: 0, status: "staged-outcome-prefix" },
      { name: "suffix", expectedSequence: 1, expectedRecordCount: 1, status: "staged-outcome-suffix" },
    ]) {
      const fixture = await freshInstallFixture(`agentmo-install-${shape.name}-outcome-stage-kill-`);
      const running = startFreshInstallProcess(fixture.runtime, {
        action: "apply",
        projectRoot: fixture.project,
        planDigest: fixture.preview.planDigest,
      }, {
        interruptible: true,
        stopAtOutcomeStage: true,
        stopAtAuthoritySequence: shape.expectedSequence,
      });
      const interrupted = await killAtInstallAuthorityBoundary(running, fixture.project, {
        boundary: "outcome-stage",
        expectedSequence: shape.expectedSequence,
        expectedRecordCount: shape.expectedRecordCount,
      });
      assert.ok(interrupted.recoveryRequired?.stagedOutcome, shape.name);

      const recovered = await recoverIncompleteAuthorityBoundaryInFreshProcess(
        fixture.runtime,
        fixture.project,
        {
          status: shape.status,
          operation: "finalize-exact-staged-authority-outcome",
          resultStatus: "staged-outcome-finalized-repreview-required",
        },
      );
      assert.equal(recovered.result.repreviewRequired, true, shape.name);
      const authority = await installAuthority(fixture.project);
      assert.equal(authority.recoveryRequired, null, shape.name);
      assert.equal(authority.records.length, shape.expectedRecordCount + 1, shape.name);
      await recoverInFreshProcess(fixture.runtime, fixture.project);
      assert.equal(
        assertFreshSuccess(await runFreshInstallProcess(fixture.runtime, {
          action: "plan",
          projectRoot: fixture.project,
        })).schemaVersion,
        "agentmo.builder-install-plan.v1",
        shape.name,
      );
    }
  });

  it("finalizes real staged abort outcomes without deleting incomplete authority evidence", async () => {
    for (const shape of [
      { name: "first", expectedSequence: 0, expectedRecordCount: 0, status: "staged-outcome-prefix" },
      { name: "suffix", expectedSequence: 1, expectedRecordCount: 1, status: "staged-outcome-suffix" },
    ]) {
      const fixture = await freshInstallFixture(`agentmo-install-${shape.name}-abort-outcome-stage-kill-`);
      const initial = startFreshInstallProcess(fixture.runtime, {
        action: "apply",
        projectRoot: fixture.project,
        planDigest: fixture.preview.planDigest,
      }, {
        interruptible: true,
        stopAtAuthorityBoundary: "prepared",
        stopAtAuthoritySequence: shape.expectedSequence,
      });
      await killAtInstallAuthorityBoundary(initial, fixture.project, {
        boundary: "prepared",
        expectedSequence: shape.expectedSequence,
        expectedRecordCount: shape.expectedRecordCount,
      });
      const abortPlan = assertFreshSuccess(await runFreshInstallProcess(fixture.runtime, {
        action: "plan-recovery",
        projectRoot: fixture.project,
      }));
      const abort = startFreshInstallProcess(fixture.runtime, {
        action: "apply-recovery",
        projectRoot: fixture.project,
        planDigest: abortPlan.planDigest,
      }, {
        interruptible: true,
        stopAtOutcomeStage: true,
        stopAtAuthoritySequence: shape.expectedSequence,
      });
      const interruptedAbort = await killAtInstallAuthorityBoundary(abort, fixture.project, {
        boundary: "outcome-stage",
        expectedSequence: shape.expectedSequence,
        expectedRecordCount: shape.expectedRecordCount,
      });
      assert.equal(interruptedAbort.recoveryRequired?.stagedOutcome?.value.outcome, "aborted");

      const recovered = await recoverIncompleteAuthorityBoundaryInFreshProcess(
        fixture.runtime,
        fixture.project,
        {
          status: shape.status,
          operation: "finalize-exact-staged-authority-outcome",
          resultStatus: "staged-outcome-finalized-repreview-required",
        },
      );
      assert.equal(recovered.result.finalizedOutcome, "aborted", shape.name);
      const authority = await installAuthority(fixture.project);
      assert.equal(authority.recoveryRequired, null, shape.name);
      assert.equal(authority.records.length, shape.expectedRecordCount, shape.name);
      assert.equal(authority.aborted.length, 1, shape.name);
      if (shape.expectedRecordCount === 0) {
        assert.equal(
          assertFreshSuccess(await runFreshInstallProcess(fixture.runtime, {
            action: "plan",
            projectRoot: fixture.project,
          })).schemaVersion,
          "agentmo.builder-install-plan.v1",
          shape.name,
        );
      } else {
        await recoverInFreshProcess(fixture.runtime, fixture.project);
      }
    }
  });

  it("recovers a durable attempt after real process death and converges in fresh processes", async () => {
    const fixture = await freshInstallFixture("agentmo-install-attempt-kill-");
    const running = startFreshInstallProcess(fixture.runtime, {
      action: "apply",
      projectRoot: fixture.project,
      planDigest: fixture.preview.planDigest,
    }, { interruptible: true });
    const interrupted = await killAfterObservation(
      running,
      "durable install attempt",
      async () => {
        const authority = await installAuthority(fixture.project);
        const latest = latestAttempt(authority);
        return latest?.disposition === "attempt" ? latest : null;
      },
    );

    const inspection = assertFreshSuccess(await runFreshInstallProcess(fixture.runtime, {
      action: "inspect-recovery",
      projectRoot: fixture.project,
    }));
    assert.equal(inspection.applicable, true);
    assert.equal(inspection.attempt.operationId, interrupted.operationId);
    assert.equal(inspection.physicalDeletion, false);
    const before = await managedProjectionSnapshot(fixture.project, fixture.artifacts);
    const beforeStages = await findPathsMatching(
      fixture.project,
      (name) => name.startsWith(".agentmo-stage-"),
    );
    await recoverInFreshProcess(fixture.runtime, fixture.project);
    assert.deepEqual(await managedProjectionSnapshot(fixture.project, fixture.artifacts), before);
    assert.deepEqual(
      await findPathsMatching(fixture.project, (name) => name.startsWith(".agentmo-stage-")),
      beforeStages,
    );

    const retryPlan = assertFreshSuccess(await runFreshInstallProcess(fixture.runtime, {
      action: "plan",
      projectRoot: fixture.project,
    }));
    const retry = assertFreshSuccess(await runFreshInstallProcess(fixture.runtime, {
      action: "apply",
      projectRoot: fixture.project,
      planDigest: retryPlan.planDigest,
    }));
    assert.equal(retry.status, "projected");
    assert.equal(
      assertFreshSuccess(await runFreshInstallProcess(fixture.runtime, {
        action: "inspect-recovery",
        projectRoot: fixture.project,
      })).status,
      "committed",
    );
  });

  it("retains exact published inodes after SIGKILL during project linking", async () => {
    const fixture = await freshInstallFixture("agentmo-install-partial-kill-");
    const first = fixture.artifacts.managedFiles[0];
    const firstPath = absolute(fixture.project, first.relativePath);
    const running = startFreshInstallProcess(fixture.runtime, {
      action: "apply",
      projectRoot: fixture.project,
      planDigest: fixture.preview.planDigest,
    }, { interruptible: true });
    await killAfterObservation(
      running,
      "first managed projection link",
      async () => await pathExists(firstPath),
    );
    const before = await lstat(firstPath, { bigint: true });
    assert.deepEqual(await readFile(firstPath), first.bytes);
    const inspection = await inspectBuilderInstallRecovery({ projectRoot: fixture.project });
    assert.equal(inspection.status, "prepared");
    assert.ok(inspection.retainedPublishedCount >= 1);
    assert.equal(inspection.retainedStageCount, fixture.artifacts.managedFiles.length + 1);
    await recoverInFreshProcess(fixture.runtime, fixture.project);
    const afterRecovery = await lstat(firstPath, { bigint: true });
    assert.equal(afterRecovery.dev, before.dev);
    assert.equal(afterRecovery.ino, before.ino);

    const retryPlan = assertFreshSuccess(await runFreshInstallProcess(fixture.runtime, {
      action: "plan",
      projectRoot: fixture.project,
    }));
    const retry = assertFreshSuccess(await runFreshInstallProcess(fixture.runtime, {
      action: "apply",
      projectRoot: fixture.project,
      planDigest: retryPlan.planDigest,
    }));
    assert.equal(retry.status, "projected");
    const afterRetry = await lstat(firstPath, { bigint: true });
    assert.equal(afterRetry.dev, before.dev);
    assert.equal(afterRetry.ino, before.ino);
    assert.deepEqual(await readFile(firstPath), first.bytes);
    assert.equal((await readBuilderLifecycleState({ projectRoot: fixture.project })).status, "active");
  });

  it("carries inherited stage provenance across a second real interruption", async () => {
    const fixture = await freshInstallFixture("agentmo-install-double-kill-");
    const firstPath = absolute(fixture.project, fixture.artifacts.managedFiles[0].relativePath);
    const first = startFreshInstallProcess(fixture.runtime, {
      action: "apply",
      projectRoot: fixture.project,
      planDigest: fixture.preview.planDigest,
    }, { interruptible: true });
    const firstAttempt = await killAfterObservation(
      first,
      "first interrupted projection",
      async () => await pathExists(firstPath)
        ? latestAttempt(await installAuthority(fixture.project))
        : null,
    );
    await recoverInFreshProcess(fixture.runtime, fixture.project);
    const inheritedAttempt = latestAttempt(await installAuthority(fixture.project));
    assert.equal(inheritedAttempt.disposition, "superseded");
    const inheritedStages = stageProvenance(inheritedAttempt);
    assert.ok(inheritedStages.length > 0);
    const retryPlan = assertFreshSuccess(await runFreshInstallProcess(fixture.runtime, {
      action: "plan",
      projectRoot: fixture.project,
    }));
    const secondAttemptSequence = (await installAuthority(fixture.project)).nextSequence;
    const second = startFreshInstallProcess(fixture.runtime, {
      action: "apply",
      projectRoot: fixture.project,
      planDigest: retryPlan.planDigest,
    }, {
      interruptible: true,
      stopAtAuthorityBoundary: "outcome-linked",
      stopAtAuthoritySequence: secondAttemptSequence,
    });
    const secondAttempt = await killAfterStoppedObservation(
      second,
      "second durable attempt",
      async () => {
        const latest = latestAttempt(await installAuthority(fixture.project));
        return latest?.operationId !== firstAttempt.operationId
          && ["attempt", "prepared"].includes(latest?.disposition)
          ? latest
          : null;
      },
      async (observed) => {
        const stoppedAuthority = await installAuthority(fixture.project);
        const stoppedAttempt = latestAttempt(stoppedAuthority);
        assert.equal(stoppedAuthority.recoveryRequired, null);
        assert.equal(stoppedAttempt?.operationId, observed.operationId);
        assert.equal(stoppedAttempt?.disposition, observed.disposition);
        assert.deepEqual(stageProvenance(stoppedAttempt), inheritedStages);
      },
    );
    assert.deepEqual(stageProvenance(secondAttempt), inheritedStages);
    const inspection = await inspectBuilderInstallRecovery({ projectRoot: fixture.project });
    assert.ok(
      ["attempt", "prepared"].includes(inspection.status),
      `second SIGKILL must interrupt a recoverable pre-publication state, got ${inspection.status}`,
    );
    assert.equal(inspection.attempt.operationId, secondAttempt.operationId);
    const interruptedAttempt = latestAttempt(await installAuthority(fixture.project));
    assert.equal(interruptedAttempt.operationId, secondAttempt.operationId);
    assert.equal(interruptedAttempt.disposition, inspection.status);
    assert.deepEqual(stageProvenance(interruptedAttempt), inheritedStages);
    assert.ok(inspection.retainedStageCount > 0);
    assert.ok(inspection.retainedPublishedCount > 0);
    const recovered = await recoverSecondInterruptedAttemptInFreshProcesses(
      fixture.runtime,
      fixture.project,
      interruptedAttempt,
    );
    assert.ok(recovered.planChanges.length <= 1);

    const finalPlan = await planBuilderInstall({
      projectRoot: fixture.project,
      probe: fixture.probe,
    });
    const final = await applyBuilderInstall({
      projectRoot: fixture.project,
      probe: fixture.probe,
      expectedPlanDigest: finalPlan.planDigest,
    });
    assert.equal(final.status, "projected");
    assert.equal((await inspectBuilderInstallRecovery({ projectRoot: fixture.project })).status, "committed");
  });

  it("records a committed v1 project attempt while retaining inert stages", async () => {
    const fixture = await freshInstallFixture("agentmo-install-committed-");
    const result = await applyBuilderInstall({
      projectRoot: fixture.project,
      probe: fixture.probe,
      expectedPlanDigest: fixture.preview.planDigest,
    });
    const inspection = await inspectBuilderInstallRecovery({ projectRoot: fixture.project });
    assert.equal(result.status, "projected");
    assert.equal(inspection.status, "committed");
    assert.equal(inspection.attempt.schemaVersion, "agentmo.builder-install-attempt.v1");
    assert.equal(inspection.attempt.receiptDigest, result.receipt.digest);
    assert.equal(inspection.physicalDeletion, false);
    assert.equal(
      (await findPathsMatching(
        fixture.project,
        (name) => name.startsWith(".agentmo-stage-"),
      )).length,
      fixture.artifacts.managedFiles.length + 1,
    );
  });

  it("blocks a substituted retained receipt stage without deleting either inode", async () => {
    const fixture = await freshInstallFixture("agentmo-install-stage-substitution-");
    const running = startFreshInstallProcess(fixture.runtime, {
      action: "apply",
      projectRoot: fixture.project,
      planDigest: fixture.preview.planDigest,
    }, { interruptible: true });
    const prepared = await killAfterObservation(
      running,
      "prepared install authority",
      async () => {
        const latest = latestAttempt(await installAuthority(fixture.project));
        return latest?.disposition === "prepared" ? latest : null;
      },
    );
    const receiptStage = prepared.stages.find(
      (stage) => stage.destinationPath === BUILDER_INSTALL_RECEIPT_PATH,
    );
    assert.ok(receiptStage);
    const stagePath = absolute(fixture.project, receiptStage.relativePath);
    const displaced = `${stagePath}.foreign-retained`;
    await rename(stagePath, displaced);
    await writeFile(stagePath, fixture.artifacts.receiptFile.bytes, {
      flag: "wx",
      mode: 0o600,
    });
    const displacedIdentity = await lstat(displaced, { bigint: true });
    const replacementIdentity = await lstat(stagePath, { bigint: true });
    assert.notEqual(displacedIdentity.ino, replacementIdentity.ino);

    const inspection = await inspectBuilderInstallRecovery({ projectRoot: fixture.project });
    assert.equal(inspection.status, "prepared");
    assert.equal(inspection.applicable, false);
    assert.deepEqual(inspection.blockers, ["AGENTMO_BUILDER_INSTALL_RECOVERY_STATE_CHANGED"]);
    assert.deepEqual(await readFile(displaced), fixture.artifacts.receiptFile.bytes);
    assert.deepEqual(await readFile(stagePath), fixture.artifacts.receiptFile.bytes);
    await absent(absolute(fixture.project, BUILDER_INSTALL_RECEIPT_PATH));
  });
});

describe("Builder v1 hostile non-destructive boundaries", () => {
  it("keeps an isolated empty HOME free of host paths during user-host preview", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agentmo-install-preview-project-"));
    const runtime = await createRuntime("agentmo-install-preview-home-", { fakeCodex: true });
    const before = await snapshotHomeTree(runtime.home);
    const preview = assertFreshSuccess(await runFreshInstallProcess(runtime, {
      action: "plan",
      projectRoot: project,
      hostScope: true,
    }));
    const after = await snapshotHomeTree(runtime.home);
    assert.equal(preview.hostActivation.marketplaceProjection.priorStatus, "absent");
    assert.deepEqual(agentmoPaths(before), []);
    assert.deepEqual(agentmoPaths(after), []);
  });

  it("preserves a late destination inode when the approved absent precondition changes", async () => {
    const fixture = await freshInstallFixture("agentmo-install-late-destination-");
    const target = fixture.artifacts.managedFiles[0];
    const destination = absolute(fixture.project, target.relativePath);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, target.bytes, { flag: "wx", mode: 0o600 });
    const before = await lstat(destination, { bigint: true });

    await assert.rejects(
      applyBuilderInstall({
        projectRoot: fixture.project,
        probe: fixture.probe,
        expectedPlanDigest: fixture.preview.planDigest,
      }),
      (error) => error?.code === "AGENTMO_BUILDER_INSTALL_PLAN_CHANGED",
    );

    const after = await lstat(destination, { bigint: true });
    assert.equal(after.dev, before.dev);
    assert.equal(after.ino, before.ino);
    assert.equal(after.nlink, before.nlink);
    assert.deepEqual(await readFile(destination), target.bytes);
    assert.equal((await inspectBuilderInstallRecovery({ projectRoot: fixture.project })).status, "authority-missing");
  });

  it("rejects every unregistered same-inode sibling without changing any link", async () => {
    const fixture = await freshInstallFixture("agentmo-install-unregistered-link-");
    const installed = await applyBuilderInstall({
      projectRoot: fixture.project,
      probe: fixture.probe,
      expectedPlanDigest: fixture.preview.planDigest,
    });
    const relativePath = ".codex/agents/agentmo.toml";
    const destination = absolute(fixture.project, relativePath);
    const foreign = path.join(path.dirname(destination), ".agentmo-stage-foreign-copy");
    await link(destination, foreign);
    const beforeDestination = await lstat(destination, { bigint: true });
    const beforeForeign = await lstat(foreign, { bigint: true });

    await assert.rejects(
      planBuilderInstall({
        projectRoot: fixture.project,
        probe: fixture.probe,
        expectedPriorReceiptDigest: installed.receipt.digest,
      }),
      (error) => [
        "AGENTMO_BUILDER_INSTALL_PATH_UNSAFE",
        "AGENTMO_BUILDER_INSTALL_CONFLICT",
      ].includes(error?.code),
    );

    const afterDestination = await lstat(destination, { bigint: true });
    const afterForeign = await lstat(foreign, { bigint: true });
    assert.equal(afterDestination.dev, beforeDestination.dev);
    assert.equal(afterDestination.ino, beforeDestination.ino);
    assert.equal(afterForeign.dev, beforeForeign.dev);
    assert.equal(afterForeign.ino, beforeForeign.ino);
    assert.equal(afterDestination.nlink, beforeDestination.nlink);
    assert.equal(afterForeign.nlink, beforeForeign.nlink);
  });

  it("refuses projected-receipt activation and sends no host mutation", async () => {
    const fixture = await freshInstallFixture("agentmo-install-immutable-receipt-");
    const projected = await applyBuilderInstall({
      projectRoot: fixture.project,
      probe: fixture.probe,
      expectedPlanDigest: fixture.preview.planDigest,
    });
    const receiptPath = absolute(fixture.project, BUILDER_INSTALL_RECEIPT_PATH);
    const beforeStats = await lstat(receiptPath, { bigint: true });
    const beforeBytes = await readFile(receiptPath);
    const hostRuntime = await createRuntime("agentmo-install-immutable-host-", {
      fakeCodex: true,
    });
    await writeHostControl(hostRuntime);

    const rejected = await runFreshInstallProcess(hostRuntime, {
      action: "plan",
      projectRoot: fixture.project,
      hostScope: true,
      expectedPriorReceiptDigest: projected.receipt.digest,
    });
    assert.equal(rejected.signal, null, rejected.stderr);
    assert.equal(rejected.code, 1, rejected.stderr);
    assert.equal(rejected.output?.errorCode, "AGENTMO_BUILDER_INSTALL_IMMUTABLE_SUCCESSOR_REQUIRED");
    const mutations = (await readJsonLines(hostRuntime.logPath)).filter(
      (entry) => entry.args.includes("add") || entry.args.includes("remove"),
    );
    assert.deepEqual(mutations, []);

    const afterStats = await lstat(receiptPath, { bigint: true });
    assert.equal(afterStats.dev, beforeStats.dev);
    assert.equal(afterStats.ino, beforeStats.ino);
    assert.equal(afterStats.nlink, beforeStats.nlink);
    assert.deepEqual(await readFile(receiptPath), beforeBytes);
  });

  it("rejects marketplace publication without durable reservation authority", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agentmo-install-unreserved-project-"));
    const runtime = await createRuntime("agentmo-install-unreserved-home-");
    const result = await runFreshInstallProcess(runtime, {
      action: "unreserved-marketplace-publication",
      projectRoot: project,
    });
    assert.equal(result.signal, null, result.stderr);
    assert.equal(result.code, 1, result.stderr);
    assert.equal(result.output?.errorCode, "AGENTMO_BUILDER_INSTALL_HOST_RESERVATION_REQUIRED");
    await absent(path.join(
      runtime.home,
      ".agentmo",
      "builder",
      "codex-host",
      "marketplace",
      "agentmo-local",
    ));
  });

  it("closes a killed host reservation, never removes state, and publishes finalized v4", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agentmo-install-host-kill-project-"));
    const runtime = await createRuntime("agentmo-install-host-kill-home-", {
      fakeCodex: true,
    });
    await writeHostControl(runtime);
    const preview = assertFreshSuccess(await runFreshInstallProcess(runtime, {
      action: "plan",
      projectRoot: project,
      hostScope: true,
    }));
    const running = startFreshInstallProcess(runtime, {
      action: "apply",
      projectRoot: project,
      hostScope: true,
      planDigest: preview.planDigest,
    }, { interruptible: true });
    const reservation = await killAfterObservation(
      running,
      "durable external host reservation",
      async () => (await codexStateAuthority(runtime)).records.find(
        (record) => record.payload?.kind === "reservation-acquired"
          && record.payload.purpose === "activation"
          && record.payload.bindingDigest === preview.planDigest,
      )?.payload ?? null,
    );
    assert.equal(reservation.bindingDigest, preview.planDigest);
    assert.equal(
      (await readJsonLines(runtime.logPath)).some(
        (entry) => isCommand(entry, "plugin", "marketplace", "add"),
      ),
      false,
    );
    await absent(runtime.statePath);

    const inspection = assertFreshSuccess(await runFreshInstallProcess(runtime, {
      action: "inspect-recovery",
      projectRoot: project,
    }));
    assert.equal(inspection.status, "prepared");
    assert.equal(inspection.attempt.schemaVersion, "agentmo.builder-install-attempt.v2");
    assert.equal(inspection.attempt.hostReservation.bindingDigest, preview.planDigest);
    const recovered = await recoverInFreshProcess(runtime, project);
    assert.equal(recovered.plan.operations[0].operation, "close-exact-host-reservation");

    await writeHostControl(runtime);
    const retryPlan = assertFreshSuccess(await runFreshInstallProcess(runtime, {
      action: "plan",
      projectRoot: project,
      hostScope: true,
    }));
    assert.equal(retryPlan.hostActivation.marketplaceOperation, "add");
    assert.equal(retryPlan.hostActivation.pluginOperation, "add");
    const retry = assertFreshSuccess(await runFreshInstallProcess(runtime, {
      action: "apply",
      projectRoot: project,
      hostScope: true,
      planDigest: retryPlan.planDigest,
    }));
    assert.equal(retry.status, "activated");
    const receiptBytes = await readFile(absolute(project, BUILDER_INSTALL_RECEIPT_PATH));
    const receipt = JSON.parse(receiptBytes);
    assert.equal(retry.receipt.digest, digestRawBytes(receiptBytes));
    assert.equal(receipt.schemaVersion, "agentmo.builder-install-receipt.v4");
    assert.equal(
      receipt.hostActivation.schemaVersion,
      "agentmo.builder-codex-activation-binding.v3",
    );
    assert.equal(
      receipt.hostActivation.finalProjectionBinding.schemaVersion,
      "agentmo.codex-marketplace-projection-binding.v1",
    );
    assert.match(
      receipt.hostActivation.finalProjectionBinding.rootIdentityDigest,
      /^sha256:[a-f0-9]{64}$/u,
    );
    assert.equal(
      (await readJsonLines(runtime.logPath)).some(
        (entry) => entry.args.some((argument) => argument === "remove"),
      ),
      false,
    );
    const terminal = latestAttempt(await installAuthority(project));
    assert.equal(terminal.schemaVersion, "agentmo.builder-install-attempt.v2");
    assert.equal(terminal.disposition, "committed");
    assert.equal(terminal.receiptDigest, retry.receipt.digest);
    assert.deepEqual(
      terminal.finalProjectionBinding,
      receipt.hostActivation.finalProjectionBinding,
    );
    assert.equal(
      assertFreshSuccess(await runFreshInstallProcess(runtime, {
        action: "inspect-recovery",
        projectRoot: project,
      })).status,
      "committed",
    );
  });

  it("replays an exact installed projection by appending a new committed attempt only", async () => {
    const fixture = await freshInstallFixture("agentmo-install-exact-replay-");
    const first = await applyBuilderInstall({
      projectRoot: fixture.project,
      probe: fixture.probe,
      expectedPlanDigest: fixture.preview.planDigest,
    });
    const before = await managedProjectionSnapshot(fixture.project, fixture.artifacts);
    const replayPlan = await planBuilderInstall({
      projectRoot: fixture.project,
      probe: fixture.probe,
      expectedPriorReceiptDigest: first.receipt.digest,
    });
    const replay = await applyBuilderInstall({
      projectRoot: fixture.project,
      probe: fixture.probe,
      expectedPriorReceiptDigest: first.receipt.digest,
      expectedPlanDigest: replayPlan.planDigest,
    });

    assert.equal(replay.changed, false);
    assert.equal(replay.receipt.digest, first.receipt.digest);
    assert.deepEqual(await managedProjectionSnapshot(fixture.project, fixture.artifacts), before);
    const inspection = await inspectBuilderInstallRecovery({ projectRoot: fixture.project });
    assert.equal(inspection.status, "committed");
    assert.notEqual(inspection.attempt.operationId, null);
    assert.equal(inspection.physicalDeletion, false);
  });
});
