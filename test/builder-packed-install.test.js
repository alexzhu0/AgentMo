import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import {
  access,
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { before, describe, it } from "node:test";
import { promisify } from "node:util";
import { digestRawBytes } from "../src/artifact-admission.js";
import { serializePersistableJson } from "../src/persistability.js";
import {
  buildApprovedPackageFixture,
  packageProduceOptions,
} from "./helpers/package-produce-fixture.js";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RECEIPT_PATH = ".agentmo/builder/install-receipt.json";
const PACKED_INSTALL_TIMEOUT_MS = 360_000;
const PHASE_4_PACKED_RUNTIME_MODULES = Object.freeze([
  "src/openclaw-authority-consumption.js",
  "src/openclaw-authority-root-binding.js",
  "src/openclaw-credential-handoff.js",
  "src/openclaw-install-approval.js",
  "src/openclaw-install-evidence.js",
  "src/openclaw-install-plan.js",
  "src/openclaw-install-receipt.js",
  "src/openclaw-install-transaction.js",
  "src/openclaw-official-action-runner.js",
  "src/openclaw-probe-contract.js",
  "src/openclaw-probe.js",
  "src/openclaw-process-supervisor.js",
  "src/openclaw-safe-fs.js",
  "src/openclaw-target-admission.js",
  "src/openclaw-target-descriptor.js",
  "src/package-archive.js",
  "src/package-carriers.js",
  "src/package-contract.js",
  "src/package-inspect.js",
  "src/package-produce.js",
  "src/targets/openclaw-package.js",
]);

let packedInstall;
let packedPackage;
let packedCodexHost;
let packedCodexUat;
let packedBridge;
let packedCheckpoint;
let packedJournal;
let packedAppendOnly;
let packedPhase4;
let packedPackageRoot;
let cachedHookBootstrapFixture = null;

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

async function missingProbe() {
  const probe = compatibleProbe();
  probe.observations[1] = { id: "native-hooks", requirement: "required", status: "missing" };
  probe.required = { ok: false, missing: ["native-hooks"], incompatible: [] };
  return probe;
}

async function absent(filePath) {
  await assert.rejects(() => stat(filePath), (error) => error?.code === "ENOENT");
}

async function checkpointJournalSnapshot(filePath) {
  const directory = path.dirname(filePath);
  const basename = path.basename(filePath);
  const names = (await readdir(directory))
    .filter((name) => name === basename || name.startsWith(`.${basename}.agentmo-journal.`))
    .toSorted();
  return Promise.all(names.map(async (name) => [
    name,
    digestRawBytes(await readFile(path.join(directory, name))),
  ]));
}

function runNode(filePath, input, options = {}) {
  return new Promise((resolve) => {
    const child = execFile(process.execPath, [filePath], {
      encoding: "utf8",
      cwd: options.cwd,
      env: options.env === undefined ? process.env : { ...process.env, ...options.env },
      timeout: options.timeoutMs ?? 15_000,
    }, (error, stdout, stderr) => {
      resolve({
        code: Number.isInteger(error?.code) ? error.code : (error === null ? 0 : 1),
        signal: error?.signal ?? null,
        stdout,
        stderr,
      });
    });
    child.stdin.end(input);
  });
}

function runNodeModuleSource(source, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", source], {
      cwd: options.cwd,
      env: options.env === undefined ? process.env : { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, options.timeoutMs ?? 15_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", () => settle({ code: 1, stdout, stderr }));
    child.once("close", (code) => settle({
      code: Number.isInteger(code) ? code : 1,
      stdout,
      stderr,
    }));
    child.stdio[3].on("error", () => {});
    child.stdio[4].on("error", () => {});
    // The direct-bootstrap rejection probe intentionally has no authenticated
    // descriptor graph.  Closing fd 4 proves that it rejects an empty stream
    // rather than inheriting an unrelated open pipe from the test runner.
    child.stdio[3].end();
    if (options.keepGraphDescriptorOpen !== true) child.stdio[4].end();
  });
}

function startNode(filePath, input, options = {}) {
  const child = spawn(process.execPath, [filePath], {
    cwd: options.cwd,
    env: options.env === undefined ? process.env : { ...process.env, ...options.env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  child.stdin.end(input);
  return { child, exited };
}

async function waitForDirectChild(parent) {
  if (process.platform !== "linux") {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    if (parent.exitCode !== null) {
      throw new Error("authenticated launcher parent exited before pathname swap");
    }
    return;
  }
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && parent.exitCode === null) {
    const { stdout } = await execFileAsync(
      "/bin/ps",
      ["-axo", "pid=,ppid="],
      { encoding: "utf8" },
    );
    const found = stdout.split("\n").some((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s*$/u.exec(line);
      return match !== null && Number.parseInt(match[2], 10) === parent.pid;
    });
    if (found) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("authenticated launcher child was not observed");
}

async function fakeCodexBin(root) {
  const bin = path.join(root, "fake-bin");
  const executable = path.join(bin, "codex");
  await mkdir(bin);
  await writeFile(executable, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const argv = process.argv.slice(2);
const key = argv.join(" ");
const stateFile = path.join(process.env.HOME, ".fake-codex-installed.json");
const installed = () => {
  try { return JSON.parse(fs.readFileSync(stateFile, "utf8")); }
  catch { return {}; }
};
const installedVersion = (state) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(
      state.marketplaceRoot,
      "plugins",
      "agentmo",
      ".codex-plugin",
      "plugin.json"
    ), "utf8")).version;
  } catch {
    return "0.1.0";
  }
};
const outputs = {
  "--version": "codex-cli 0.144.2\\n",
  "features list": "plugins stable true\\nhooks stable true\\n",
  "plugin --help": "Usage: codex plugin [COMMAND]\\n",
  "resume --help": "Usage: codex resume [OPTIONS]\\n",
  "doctor --help": "Usage: codex doctor\\n"
};
// The host supervisor accepts only bytes observed before the direct command
// exits. Keep fixture command output observable before its intentional exit.
const emit = (value) => {
  process.stdout.write(value);
  setTimeout(() => process.exit(process.exitCode ?? 0), 50);
};
if (key === "plugin list --available --json") {
  const state = installed();
  emit(JSON.stringify({
    installed: state.pluginInstalled ? [{
      pluginId: "agentmo@agentmo-local",
      name: "agentmo",
      marketplaceName: "agentmo-local",
      version: installedVersion(state),
      installed: true,
      enabled: true,
      source: { source: "local", path: path.join(state.marketplaceRoot, "plugins", "agentmo") }
    }] : [],
    available: []
  }));
} else if (key === "plugin marketplace list --json") {
  const state = installed();
  emit(JSON.stringify({
    marketplaces: state.marketplaceRoot
      ? [{ name: "agentmo-local", source: state.marketplaceRoot }]
      : []
  }));
} else if (argv[0] === "plugin" && argv[1] === "marketplace" && argv[2] === "add"
  && argv[4] === "--json") {
  const state = installed();
  state.marketplaceRoot = argv[3];
  fs.writeFileSync(stateFile, JSON.stringify(state));
  emit("{}");
} else if (key === "plugin marketplace remove agentmo-local --json") {
  const state = installed();
  delete state.marketplaceRoot;
  fs.writeFileSync(stateFile, JSON.stringify(state));
  emit("{}");
} else if (key === "plugin add agentmo@agentmo-local --json") {
  const state = installed();
  if (!state.marketplaceRoot) process.exitCode = 2;
  else {
    state.pluginInstalled = true;
    fs.writeFileSync(stateFile, JSON.stringify(state));
  }
  emit("{}");
} else if (key === "plugin remove agentmo@agentmo-local --json") {
  const state = installed();
  delete state.pluginInstalled;
  fs.writeFileSync(stateFile, JSON.stringify(state));
  emit("{}");
} else if (key === "app-server --stdio") {
  const input = readline.createInterface({ input: process.stdin });
  input.on("line", (line) => {
    const request = JSON.parse(line);
    const state = installed();
    let result = {};
    if (request.method === "plugin/installed") result = { marketplaces: [], marketplaceLoadErrors: [] };
    if (request.method === "skills/list") result = { data: [{ cwd: process.cwd(), skills: state.pluginInstalled ? [{ name: "agentmo" }] : [], errors: [] }] };
    if (request.method === "hooks/list") result = { data: [{ cwd: process.cwd(), hooks: state.pluginInstalled ? [{ pluginId: "agentmo@agentmo-local", enabled: true, trustStatus: "untrusted" }] : [], warnings: [], errors: [] }] };
    process.stdout.write(JSON.stringify({ id: request.id, result }) + "\\n");
  });
} else if (Object.hasOwn(outputs, key)) {
  emit(outputs[key]);
} else {
  process.exitCode = 2;
}
`, "utf8");
  await chmod(executable, 0o755);
  return bin;
}

async function writeHostileHookCheckpoint(project, receiptDigest) {
  const checkpointPath = path.join(project, ".agentmo", "checkpoints", "builder.json");
  const checkpoint = packedCheckpoint.buildBuilderCheckpoint({
    workflowId: "bootstrap-hostile-fixture",
    adapterId: "codex",
    stage: "plan",
    boundary: "approval-required",
    artifactRefs: [{
      subject: "design-plan",
      path: ".agentmo/design-plan.json",
      digest: `sha256:${"1".repeat(64)}`,
    }],
    pendingDecision: {
      id: "bootstrap-hostile-decision",
      kind: "approval",
      summaryDigest: `sha256:${"2".repeat(64)}`,
    },
    nextAction: "await-approval",
    installReceiptDigest: receiptDigest,
    capabilitySnapshot: {
      adapterId: "codex",
      evidenceLevel: "observed",
      digest: `sha256:${"3".repeat(64)}`,
      required: [{ id: "native-hooks", status: "observed" }],
    },
    eventLedger: { cursor: 0, recentEvents: [] },
    pauseReason: "approval-required",
  });
  await mkdir(path.dirname(checkpointPath), { recursive: true });
  return packedCheckpoint.writeBuilderCheckpoint(checkpointPath, checkpoint);
}

async function installHookBootstrapFixture(prefix) {
  if (cachedHookBootstrapFixture !== null) return cachedHookBootstrapFixture;
  const root = await mkdtemp(path.join(tmpdir(), `${prefix}-`));
  const project = path.join(root, "project");
  const home = path.join(root, "home");
  const stateRoot = path.join(home, ".agentmo", "builder", "codex-host");
  await Promise.all([mkdir(project), mkdir(home, { mode: 0o700 })]);
  const bin = await fakeCodexBin(root);
  const installed = await runPackedInstallChild({ project, home, bin });
  assert.equal(installed.code, 0, `${installed.stdout}${installed.stderr}`);
  assert.equal(installed.value?.ok, true);
  await writeHostileHookCheckpoint(project, installed.value.applied.receipt.digest);
  const pluginRoot = path.join(stateRoot, "marketplace", "agentmo-local", "plugins", "agentmo");
  cachedHookBootstrapFixture = Object.freeze({
    root,
    project,
    home,
    stateRoot,
    pluginRoot,
    runnerPath: path.join(pluginRoot, "hooks", "agentmo-hook.js"),
    launcherPath: path.join(pluginRoot, "runtime", "agentmo", "bin", "agentmo.js"),
    childOptions: {
      cwd: project,
      env: { HOME: home, CODEX_HOME: path.join(home, ".codex") },
    },
  });
  return cachedHookBootstrapFixture;
}

async function waitForObservation(running, label, observe, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await observe();
      if (value !== null && value !== false && value !== undefined) return value;
    } catch {
      // The child may be between an append-only claim and its durable record.
    }
    if (running.child.exitCode !== null || running.child.signalCode !== null) {
      const exited = await running.exited;
      throw new Error(
        `${label}: child exited early (${exited.code}/${exited.signal}): ${exited.stderr}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`${label}: observation timed out`);
}

async function runPackedCli(args, bin, sharedHome = null) {
  const home = sharedHome ?? await mkdtemp(path.join(tmpdir(), "agentmo-packed-cli-home-"));
  const cwd = await mkdtemp(path.join(tmpdir(), "agentmo-packed-cli-cwd-"));
  try {
    const result = await execFileAsync(
      process.execPath,
      [path.join(packedPackageRoot, "bin", "agentmo.js"), ...args],
      {
        cwd,
        encoding: "utf8",
        env: {
          CODEX_HOME: path.join(home, ".codex"),
          HOME: home,
          LANG: "C",
          PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}`,
        },
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

async function runPackageCli(packageRoot, args, options) {
  const baseEnv = options.closedEnv === true ? {} : process.env;
  try {
    const result = await execFileAsync(
      process.execPath,
      [path.join(packageRoot, "bin", "agentmo.js"), ...args],
      {
        cwd: options.cwd,
        encoding: "utf8",
        env: {
          ...baseEnv,
          CODEX_HOME: path.join(options.home, ".codex"),
          HOME: options.home,
          LANG: "C",
          PATH: `${options.bin}${path.delimiter}${path.dirname(process.execPath)}`,
          ...(options.env ?? {}),
        },
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

function startPackedInstallChild({
  project,
  home,
  bin,
  packageRoot = packedPackageRoot,
  installPackageRoot = null,
  expectedPriorReceiptDigest = null,
  expectedPlanDigest = null,
  action = "plan-apply",
}) {
  const request = {
    action,
    modulePath: path.join(packageRoot, "src", "builder-install.js"),
    projectRoot: project,
    probe: compatibleProbe(),
    hostScope: "user",
    installPackageRoot,
    expectedPriorReceiptDigest,
    expectedPlanDigest,
  };
  const childSource = `
import { pathToFileURL } from "node:url";
const request = ${JSON.stringify(request)};
try {
  const install = await import(pathToFileURL(request.modulePath).href);
  const planOptions = {
    projectRoot: request.projectRoot,
    probe: request.probe,
    hostScope: request.hostScope,
    ...(request.installPackageRoot === null
      ? {}
      : { packageOptions: { packageRoot: request.installPackageRoot } }),
    ...(request.expectedPriorReceiptDigest === null
      ? {}
      : { expectedPriorReceiptDigest: request.expectedPriorReceiptDigest }),
  };
  const preview = request.action === "apply"
    ? null
    : await install.planBuilderInstall(planOptions);
  if (request.action === "plan") {
    process.stdout.write(JSON.stringify({ ok: true, preview }));
  } else {
    const applied = await install.applyBuilderInstall({
      ...planOptions,
      expectedPlanDigest: request.action === "apply"
        ? request.expectedPlanDigest
        : preview.planDigest,
    });
    process.stdout.write(JSON.stringify({ ok: true, preview, applied }));
  }
} catch (error) {
  process.stdout.write(JSON.stringify({
    ok: false,
    code: typeof error?.code === "string" ? error.code : "UNEXPECTED",
  }));
  process.exitCode = 1;
}
`;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", childSource],
    {
      cwd: project,
      env: {
        HOME: home,
        CODEX_HOME: path.join(home, ".codex"),
        LANG: "C",
        LC_ALL: "C",
        PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  let killGrace = null;
  const timeout = setTimeout(() => {
    timedOut = true;
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    killGrace = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }, 250);
  }, PACKED_INSTALL_TIMEOUT_MS);
  const exited = new Promise((resolve, reject) => {
    child.once("error", (error) => {
      clearTimeout(timeout);
      if (killGrace !== null) clearTimeout(killGrace);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      if (killGrace !== null) clearTimeout(killGrace);
      let value = null;
      let parseError = false;
      if (stdout.length > 0) {
        try {
          value = JSON.parse(stdout);
        } catch {
          // Keep malformed child output out of the test report. The child
          // protocol permits exactly one JSON object, so callers can fail on
          // the explicit marker without reflecting arbitrary output.
          parseError = true;
        }
      }
      resolve({
        code,
        signal,
        stdout,
        stderr,
        timedOut,
        parseError,
        value,
      });
    });
  });
  return { child, exited };
}

async function runPackedInstallChild(options) {
  return startPackedInstallChild(options).exited;
}

async function runInstalledCli(project, args, bin) {
  const home = await mkdtemp(path.join(tmpdir(), "agentmo-installed-cli-home-"));
  try {
    const result = await execFileAsync(
      process.execPath,
      ["./plugins/agentmo/runtime/agentmo/bin/agentmo.js", ...args],
      {
        cwd: project,
        encoding: "utf8",
        env: {
          CODEX_HOME: path.join(home, ".codex"),
          HOME: home,
          LANG: "C",
          PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}`,
        },
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

const syntheticDigest = (label) => digestRawBytes(Buffer.from(`${label}\n`, "utf8"));

function assertActivatedReceiptBinding(receipt) {
  assert.equal(receipt.schemaVersion, "agentmo.builder-install-receipt.v4");
  assert.equal(receipt.status, "activated");
  assert.deepEqual(receipt.evidence, {
    level: "host-observed",
    mechanismOnly: true,
    codexActivationVerified: false,
    hostBehaviorVerified: false,
    domainQualityCertified: false,
  });
  assert.deepEqual(
    Object.keys(receipt.hostActivation).toSorted(),
    [
      "schemaVersion", "hostScope", "selector", "releaseDigest",
      "marketplaceProjectionDigest", "operationOrderDigest", "ownerDisposition",
      "ownerRecordDigest", "consumerId", "consumerEntryDigest",
      "consumerLedgerDigest", "consumerEntryOwned", "selectorDeletionAuthority",
      "expectedPostObservation", "finalProjectionBinding",
    ].toSorted(),
  );
  assert.equal(
    receipt.hostActivation.schemaVersion,
    "agentmo.builder-codex-activation-binding.v3",
  );
  assert.equal(receipt.hostActivation.hostScope, "user");
  assert.equal(receipt.hostActivation.releaseDigest, receipt.identity.releaseDigest);
  const binding = receipt.hostActivation.finalProjectionBinding;
  assert.deepEqual(
    Object.keys(binding).toSorted(),
    [
      "schemaVersion", "transactionId", "transactionDigest", "releaseDigest",
      "contentDigest", "rootIdentity", "rootIdentityDigest", "members",
    ].toSorted(),
  );
  assert.equal(
    binding.schemaVersion,
    "agentmo.codex-marketplace-projection-binding.v1",
  );
  assert.equal(binding.transactionId, binding.transactionDigest.slice("sha256:".length));
  assert.equal(binding.releaseDigest, receipt.hostActivation.releaseDigest);
  assert.equal(binding.contentDigest, receipt.hostActivation.marketplaceProjectionDigest);
  assert.equal(
    binding.rootIdentityDigest,
    digestRawBytes(Buffer.from(serializePersistableJson({
      schemaVersion: "agentmo.codex-marketplace-root-identity.v1",
      ...binding.rootIdentity,
    }, { subject: "codex-marketplace-root-identity" }), "utf8")),
  );
  assert.deepEqual(binding.members[0], {
    kind: "root",
    relativePath: "",
    digest: null,
    identity: binding.rootIdentity,
  });
}

async function createSyntheticContinuationFixture({
  baselineVersion = "0.1.0",
  successorVersion = "0.2.0",
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-synthetic-continuation-"));
  const releaseDirectory = path.join(root, "releases");
  const built = await runUatReleaseBuilder(
    releaseDirectory,
    baselineVersion,
    successorVersion,
  );
  assert.equal(built.code, 0, built.stderr);
  const identity = JSON.parse(built.stdout);
  const baselineTarball = path.join(releaseDirectory, `agentmo-${baselineVersion}.tgz`);
  const tarballPath = path.join(releaseDirectory, `agentmo-${successorVersion}.tgz`);
  const baselinePackage = await extractExactTarball(
    baselineTarball,
    path.join(root, "baseline-extract"),
  );
  const packageRoot = await extractExactTarball(
    tarballPath,
    path.join(root, "successor-extract"),
  );
  const tarballDigest = identity.successor.tarballDigest;
  const continuationDigest = identity.successor.continuationDigest;
  const verifierDigest = identity.successor.verifierDigest;
  const packageModule = await import(`${pathToFileURL(path.join(packageRoot, "src", "builder-package.js")).href}?synthetic=${Date.now()}`);
  const uatModule = await import(`${pathToFileURL(path.join(packageRoot, "src", "builder-codex-uat.js")).href}?synthetic=${Date.now()}`);
  const checkpointModule = await import(pathToFileURL(path.join(packageRoot, "src", "builder-checkpoint.js")).href);
  const immutableJournalModule = await import(
    pathToFileURL(path.join(packageRoot, "src", "builder-immutable-journal.js")).href
  );
  const appendOnlyModule = await import(
    pathToFileURL(path.join(packageRoot, "src", "builder-append-only-authority.js")).href
  );
  const release = await packageModule.loadBuilderPackage({ packageRoot });
  const admittedSuccessor = await packageModule.admitBuilderUatReleaseMember({
    packageRoot,
    tarballPath,
    expectedRole: "successor",
    maxBytes: 32 * 1024 * 1024,
  });
  assert.equal(release.name, "agentmo");
  assert.equal(release.version, successorVersion);
  assert.deepEqual({
    role: admittedSuccessor.role,
    releaseDigest: admittedSuccessor.releaseDigest,
    tarballDigest: admittedSuccessor.tarballDigest,
    manifestDigest: admittedSuccessor.manifestDigest,
    verifierDigest: admittedSuccessor.verifierDigest,
    continuationDigest: admittedSuccessor.continuationDigest,
  }, {
    role: "successor",
    releaseDigest: identity.successor.releaseDigest,
    tarballDigest: identity.successor.tarballDigest,
    manifestDigest: identity.successor.manifestDigest,
    verifierDigest: identity.successor.verifierDigest,
    continuationDigest: identity.successor.continuationDigest,
  });
  assert.equal(
    release.assets.find((asset) => asset.sourcePath === "src/builder-codex-uat-continuation.js")?.digest,
    continuationDigest,
  );
  assert.equal(
    digestRawBytes(await readFile(path.join(packageRoot, "src", "builder-codex-uat-release-manifest.json"))),
    identity.successor.manifestDigest,
  );
  assert.equal(
    digestRawBytes(await readFile(path.join(packageRoot, "scripts", "verify-codex-uat-candidate.js"))),
    verifierDigest,
  );
  return {
    root,
    baselinePackage,
    baselineTarball,
    packageRoot,
    tarballPath,
    tarballDigest,
    release,
    releaseManifestDigest: identity.successor.manifestDigest,
    continuationDigest,
    verifierDigest,
    uatModule,
    checkpointModule,
    immutableJournalModule,
    appendOnlyModule,
  };
}

function syntheticCheckpoint(checkpointModule, receiptDigest) {
  return checkpointModule.buildBuilderCheckpoint({
    workflowId: "workflow-synthetic-packed-continuation",
    adapterId: "codex",
    stage: "produce",
    boundary: "artifact-created",
    artifactRefs: [{
      subject: "design-plan",
      path: ".agentmo/design-plan.json",
      digest: syntheticDigest("synthetic-design-plan"),
    }],
    pendingDecision: null,
    nextAction: "complete",
    installReceiptDigest: receiptDigest,
    capabilitySnapshot: {
      adapterId: "codex",
      evidenceLevel: "observed",
      digest: syntheticDigest("synthetic-capabilities"),
      required: [{ id: "native-hooks", status: "observed" }],
    },
    eventLedger: { cursor: 0, recentEvents: [] },
    pauseReason: null,
  });
}

function syntheticScenarioEvidence(scenario, index, fixture, receiptDigest, checkpointDigest) {
  const d = (suffix) => syntheticDigest(`${scenario}-${suffix}-${index}`);
  switch (scenario) {
    case "session-start": return { hookEventDigest: d("hook") };
    case "skill-discovery": return { visibilityDigest: d("visibility") };
    case "user-prompt-non-trigger": return { nonTriggerDigest: d("non-trigger") };
    case "manual-pause": return { checkpointSuccessorDigest: d("checkpoint") };
    case "pre-compact": return { checkpointSuccessorDigest: d("checkpoint") };
    case "post-compact": return { workflowIdentityDigest: d("workflow") };
    case "restart-resume": return { freshProcessDigest: d("process") };
    case "duplicate-replay": {
      const unchanged = d("unchanged");
      return { beforeCheckpointDigest: unchanged, afterCheckpointDigest: unchanged };
    }
    case "second-compaction": return {
      compactionEpochDigest: d("epoch"),
      checkpointSuccessorDigest: d("checkpoint"),
    };
    case "upgrade-visibility": return {
      successorVersion: fixture.release.version,
      releaseDigest: fixture.release.releaseDigest,
      tarballDigest: fixture.tarballDigest,
      upgradePlanDigest: d("upgrade-plan"),
      installReceiptDigest: receiptDigest,
      checkpointDigest,
      visibilityDigest: d("visibility"),
    };
    default: throw new Error(`unsupported synthetic scenario: ${scenario}`);
  }
}

async function createSyntheticContinuationCase(fixture, bin, name) {
  const caseRoot = path.join(fixture.root, name);
  const project = path.join(caseRoot, "project");
  const home = path.join(caseRoot, "home");
  await Promise.all([
    mkdir(project, { recursive: true }),
    mkdir(home, { recursive: true, mode: 0o700 }),
  ]);
  const cli = (args, env = {}) => runPackageCli(fixture.packageRoot, args, {
    cwd: project,
    home,
    bin,
    env,
  });
  const previewRun = await cli([
    "builder", "setup", "--project", project, "--host-scope", "user", "--json",
  ]);
  assert.equal(previewRun.code, 0, `${previewRun.stdout}${previewRun.stderr}`);
  const preview = JSON.parse(previewRun.stdout);
  const applyRun = await cli([
    "builder", "setup", "--project", project, "--host-scope", "user",
    "--apply", "--plan-digest", preview.planDigest, "--json",
  ]);
  assert.equal(applyRun.code, 0, `${applyRun.stdout}${applyRun.stderr}`);
  const receiptPath = path.join(project, RECEIPT_PATH);
  const receiptBytes = await readFile(receiptPath);
  const receiptDigest = digestRawBytes(receiptBytes);

  const attemptDir = path.join(project, ".agentmo", "codex-uat", `attempt-${name}`);
  const candidateDirectory = path.join(attemptDir, "candidates");
  const observationDirectory = path.join(attemptDir, "observations");
  await Promise.all([
    mkdir(candidateDirectory, { recursive: true }),
    mkdir(observationDirectory, { recursive: true }),
  ]);
  const checkpointPath = path.join(attemptDir, "continuation-checkpoint.json");
  let checkpointAdmission = await fixture.checkpointModule.writeBuilderCheckpoint(
    checkpointPath,
    syntheticCheckpoint(fixture.checkpointModule, receiptDigest),
  );
  const journalPath = path.join(attemptDir, "attempt.journal");
  const attemptId = path.basename(attemptDir);
  let view = await fixture.uatModule.startCodexUatAttempt({
    journalPath,
    attemptId,
    baseline: {
      packageRoot: fixture.baselinePackage,
      tarballPath: fixture.baselineTarball,
    },
    successor: {
      packageRoot: fixture.packageRoot,
      tarballPath: fixture.tarballPath,
    },
  });
  const baseline = view.state.baseline;
  const marketplaceProjectionDigest = syntheticDigest(`${name}-marketplace`);
  const projectionRootIdentity = {
    device: "1",
    group: "1",
    inode: "1",
    links: "1",
    mode: "700",
    owner: "1",
    size: "0",
  };
  const projectionMembers = [
    {
      kind: "root",
      relativePath: "",
      digest: null,
      identity: projectionRootIdentity,
    },
    {
      kind: "file",
      relativePath: "plugin.json",
      digest: syntheticDigest(`${name}-projection-file`),
      identity: {
        device: "1",
        group: "1",
        inode: "2",
        links: "1",
        mode: "600",
        owner: "1",
        size: "1",
      },
    },
  ];
  const projectionManifest = {
    schemaVersion: "agentmo.codex-marketplace-projection-manifest.v1",
    selector: {
      pluginId: "agentmo@agentmo-local",
      pluginName: "agentmo",
      marketplaceName: "agentmo-local",
    },
    releaseDigest: baseline.releaseDigest,
    contentDigest: marketplaceProjectionDigest,
    members: projectionMembers.map(({ identity: _identity, ...member }) => member),
  };
  const projectionTransactionDigest = digestRawBytes(Buffer.from(serializePersistableJson(
    projectionManifest,
    { subject: "codex-marketplace-projection-manifest" },
  ), "utf8"));
  const transitionReceiptValue = {
    schemaVersion: "agentmo.builder-install-receipt.v4",
    status: "activated",
    identity: {
      name: baseline.packageName,
      version: baseline.version,
      adapterId: "codex",
      releaseDigest: baseline.releaseDigest,
    },
    planDigest: syntheticDigest(`${name}-setup-plan`),
    evidence: {
      level: "host-observed",
      mechanismOnly: true,
      codexActivationVerified: false,
      hostBehaviorVerified: false,
      domainQualityCertified: false,
    },
    hostActivation: {
      schemaVersion: "agentmo.builder-codex-activation-binding.v3",
      hostScope: "user",
      selector: projectionManifest.selector,
      releaseDigest: baseline.releaseDigest,
      marketplaceProjectionDigest,
      operationOrderDigest: syntheticDigest(`${name}-operation-order`),
      ownerDisposition: "created-by-agentmo",
      ownerRecordDigest: syntheticDigest(`${name}-owner`),
      consumerId: syntheticDigest(`${name}-consumer-id`),
      consumerEntryDigest: syntheticDigest(`${name}-consumer`),
      consumerLedgerDigest: syntheticDigest(`${name}-ledger`),
      consumerEntryOwned: true,
      selectorDeletionAuthority: false,
      expectedPostObservation: {
        installation: "installed",
        enabled: true,
        sourceMatch: true,
        releaseMatch: true,
        skillVisibility: "visible",
        hooksVisibility: "visible",
        trust: "trusted-or-pending-human",
        agentHostVisibility: "unobservable",
      },
      finalProjectionBinding: {
        schemaVersion: "agentmo.codex-marketplace-projection-binding.v1",
        transactionId: projectionTransactionDigest.slice("sha256:".length),
        transactionDigest: projectionTransactionDigest,
        releaseDigest: baseline.releaseDigest,
        contentDigest: marketplaceProjectionDigest,
        rootIdentity: projectionRootIdentity,
        rootIdentityDigest: digestRawBytes(Buffer.from(serializePersistableJson({
          schemaVersion: "agentmo.codex-marketplace-root-identity.v1",
          ...projectionRootIdentity,
        }, { subject: "codex-marketplace-root-identity" }), "utf8")),
        members: projectionMembers,
      },
    },
  };
  const transitionReceiptBytes = Buffer.from(serializePersistableJson(transitionReceiptValue, {
    subject: "builder-install-receipt",
  }), "utf8");
  const transitionReceiptPath = path.join(attemptDir, "baseline-receipt.json");
  await writeFile(transitionReceiptPath, transitionReceiptBytes, { flag: "wx", mode: 0o600 });
  const transitionReceiptDigest = digestRawBytes(transitionReceiptBytes);
  view = await fixture.uatModule.recordCodexUatSetupApplied({
    journalPath,
    expectedHeadAdmission: view.head,
    installReceiptPath: transitionReceiptPath,
    expectedInstallReceiptDigest: transitionReceiptDigest,
    checkpointAdmission,
  });
  const hostPath = path.join(attemptDir, "host-observation.json");
  const hostBytes = Buffer.from("bounded host observation\n");
  await writeFile(hostPath, hostBytes, { flag: "wx", mode: 0o600 });
  view = await fixture.uatModule.recordCodexUatActivationApplied({
    journalPath,
    expectedHeadAdmission: view.head,
    installReceiptPath: transitionReceiptPath,
    expectedInstallReceiptDigest: transitionReceiptDigest,
    checkpointAdmission,
    hostObservationPath: hostPath,
    expectedHostObservationDigest: digestRawBytes(hostBytes),
  });
  const trustFiles = [];
  for (const label of ["process", "trust", "auth"]) {
    const filePath = path.join(attemptDir, `${label}.evidence`);
    const bytes = Buffer.from(`${label}\n`);
    await writeFile(filePath, bytes, { flag: "wx", mode: 0o600 });
    trustFiles.push({ filePath, digest: digestRawBytes(bytes) });
  }
  view = await fixture.uatModule.recordCodexUatTrustAuthObservation({
    journalPath,
    expectedHeadAdmission: view.head,
    freshProcessEvidencePath: trustFiles[0].filePath,
    expectedFreshProcessDigest: trustFiles[0].digest,
    trustObservationPath: trustFiles[1].filePath,
    expectedTrustObservationDigest: trustFiles[1].digest,
    authObservationPath: trustFiles[2].filePath,
    expectedAuthObservationDigest: trustFiles[2].digest,
  });
  for (const [index, scenario] of fixture.uatModule.CODEX_UAT_SCENARIO_IDS.slice(0, 10).entries()) {
    const armed = await fixture.uatModule.armCodexUatScenario({
      journalPath,
      expectedHeadAdmission: view.head,
      checkpointPath,
      checkpointAdmission,
    });
    checkpointAdmission = armed.checkpointAdmission;
    const observation = await fixture.uatModule.publishCodexUatObservationLeaf({
      outDirectory: observationDirectory,
      attemptId,
      scenario,
      correlation: armed.correlation,
      source: "operator-observation",
      eventDigest: syntheticDigest(`${name}-${scenario}-event`),
      runnerDigest: syntheticDigest(`${name}-${scenario}-runner`),
      releaseDigest: baseline.releaseDigest,
      installReceiptDigest: transitionReceiptDigest,
    });
    view = await fixture.uatModule.recordCodexUatScenarioObservation({
      journalPath,
      expectedHeadAdmission: view.head,
      checkpointAdmission,
      observationAdmission: observation,
      evidence: syntheticScenarioEvidence(
        scenario,
        index,
        fixture,
        receiptDigest,
        checkpointAdmission.digest,
      ),
    });
  }
  assert.equal(view.state.nextScenario, "deactivation-tombstone-visibility");
  const uninstallPreviewRun = await cli([
    "builder", "deactivate", "--project", project,
    "--digest", `builder-install-receipt=${receiptDigest}`, "--json",
  ]);
  assert.equal(uninstallPreviewRun.code, 0, `${uninstallPreviewRun.stdout}${uninstallPreviewRun.stderr}`);
  const uninstallPlan = JSON.parse(uninstallPreviewRun.stdout);
  assert.equal(uninstallPlan.applicable, true);
  const continuationArgs = (overrides = {}) => [
    "builder", "codex-uat", "continue",
    "--attempt-dir", attemptDir,
    "--expected-head-sha256", overrides.expectedHeadDigest ?? view.head.digest,
    "--approved-deactivation-plan-sha256", overrides.approvedDeactivationPlanDigest ?? uninstallPlan.planDigest,
    "--successor-tarball", overrides.successorTarball ?? fixture.tarballPath,
    "--expected-successor-version", overrides.expectedSuccessorVersion ?? fixture.release.version,
    "--expected-release-sha256", overrides.expectedReleaseDigest ?? fixture.release.releaseDigest,
    "--expected-tarball-sha256", overrides.expectedTarballDigest ?? fixture.tarballDigest,
    "--expected-verifier-sha256", overrides.expectedVerifierDigest ?? fixture.verifierDigest,
  ];
  return {
    project,
    home,
    cli,
    view,
    journalPath,
    attemptDir,
    candidateDirectory,
    observationDirectory,
    checkpointPath,
    checkpointDigest: checkpointAdmission.digest,
    checkpointSequence: checkpointAdmission.sequence,
    receiptPath,
    receiptBytes,
    receiptDigest,
    uninstallPlan,
    continuationArgs,
  };
}

async function snapshotSyntheticAttempt(attemptDir) {
  const rows = [];
  async function visit(directory, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(filePath, relative);
      else if (entry.isSymbolicLink()) {
        rows.push([relative, digestRawBytes(Buffer.from(await readlink(filePath), "utf8"))]);
      } else rows.push([relative, digestRawBytes(await readFile(filePath))]);
    }
  }
  await visit(attemptDir);
  return rows.toSorted(([left], [right]) => left.localeCompare(right));
}

async function publishedContentLeaves(directory) {
  return (await readdir(directory))
    .filter((name) => /^[a-f0-9]{64}\.json$/u.test(name))
    .toSorted();
}

async function runUatReleaseBuilder(outDirectory, baselineVersion, successorVersion) {
  try {
    const result = await execFileAsync(process.execPath, [
      path.join(REPO_ROOT, "scripts", "build-builder-uat-releases.js"),
      "--out", outDirectory,
      "--baseline-version", baselineVersion,
      "--successor-version", successorVersion,
      "--json",
    ], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

async function runPackedVerifier(verifierPath, command, values) {
  const args = [verifierPath, ...command];
  for (const [name, value] of Object.entries(values)) args.push(`--${name}`, value);
  try {
    const result = await execFileAsync(process.execPath, args, {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

async function extractExactTarball(tarballPath, extractionRoot) {
  await mkdir(extractionRoot, { mode: 0o700 });
  await execFileAsync("tar", ["-xzf", tarballPath, "-C", extractionRoot], {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  return path.join(extractionRoot, "package");
}

async function createVerifierReleaseFixture({
  baselineVersion = "0.1.0-uat.1",
  successorVersion = "0.1.0-uat.2",
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-uat-release-fixture-"));
  const outDirectory = path.join(root, "releases");
  const built = await runUatReleaseBuilder(outDirectory, baselineVersion, successorVersion);
  assert.equal(built.code, 0, "bounded release builder must succeed");
  assert.equal(built.stderr, "");
  assert.equal(built.stdout.includes(root), false, "release output must omit private paths");
  const identity = JSON.parse(built.stdout);
  const releaseSetDigest = digestRawBytes(await readFile(
    path.join(outDirectory, "agentmo-builder-uat-release-set.json"),
  ));
  assert.equal(identity.schemaVersion, "agentmo.builder-uat-release-set.v3");
  assert.match(identity.operationId, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(identity.predecessor, null);
  assert.equal(identity.status, "built");
  assert.equal(identity.baseline.packageName, "agentmo");
  assert.equal(identity.baseline.version, baselineVersion);
  assert.equal(identity.successor.packageName, "agentmo");
  assert.equal(identity.successor.version, successorVersion);
  assert.notEqual(identity.baseline.releaseDigest, identity.successor.releaseDigest);
  assert.notEqual(identity.baseline.tarballDigest, identity.successor.tarballDigest);
  const baselineTarball = path.join(outDirectory, `agentmo-${baselineVersion}.tgz`);
  const successorTarball = path.join(outDirectory, `agentmo-${successorVersion}.tgz`);
  assert.equal(digestRawBytes(await readFile(baselineTarball)), identity.baseline.tarballDigest);
  assert.equal(digestRawBytes(await readFile(successorTarball)), identity.successor.tarballDigest);
  const baselinePackage = await extractExactTarball(
    baselineTarball,
    path.join(root, "baseline-extract"),
  );
  const successorPackage = await extractExactTarball(
    successorTarball,
    path.join(root, "successor-extract"),
  );
  for (const [packageRoot, expected] of [
    [baselinePackage, identity.baseline],
    [successorPackage, identity.successor],
  ]) {
    const verifierPath = path.join(packageRoot, "scripts", "verify-codex-uat-candidate.js");
    const manifestPath = path.join(packageRoot, "src", "builder-codex-uat-release-manifest.json");
    assert.equal(digestRawBytes(await readFile(verifierPath)), expected.verifierDigest);
    assert.equal(digestRawBytes(await readFile(manifestPath)), expected.manifestDigest);
    await execFileAsync(process.execPath, ["--check", verifierPath]);
  }
  const uatModule = await import(`${pathToFileURL(
    path.join(successorPackage, "src", "builder-codex-uat.js"),
  ).href}?verifier=${Date.now()}`);
  const checkpointModule = await import(`${pathToFileURL(
    path.join(successorPackage, "src", "builder-checkpoint.js"),
  ).href}`);
  return {
    root,
    outDirectory,
    baselineVersion,
    successorVersion,
    baselineTarball,
    successorTarball,
    baselinePackage,
    successorPackage,
    identity,
    releaseSetDigest,
    uatModule,
    checkpointModule,
  };
}

function verifierScenarioEvidence(scenario, index, fixture) {
  const d = (suffix) => syntheticDigest(`verifier-${scenario}-${suffix}-${index}`);
  switch (scenario) {
    case "session-start": return { hookEventDigest: d("hook") };
    case "skill-discovery": return { visibilityDigest: d("visibility") };
    case "user-prompt-non-trigger": return { nonTriggerDigest: d("non-trigger") };
    case "manual-pause": return { checkpointSuccessorDigest: d("checkpoint") };
    case "pre-compact": return { checkpointSuccessorDigest: d("checkpoint") };
    case "post-compact": return { workflowIdentityDigest: d("workflow") };
    case "restart-resume": return { freshProcessDigest: d("process") };
    case "duplicate-replay": {
      const unchanged = d("unchanged");
      return { beforeCheckpointDigest: unchanged, afterCheckpointDigest: unchanged };
    }
    case "second-compaction": return {
      compactionEpochDigest: d("epoch"),
      checkpointSuccessorDigest: d("checkpoint"),
    };
    case "upgrade-visibility": return {
      successorVersion: fixture.successorVersion,
      releaseDigest: fixture.identity.successor.releaseDigest,
      tarballDigest: fixture.identity.successor.tarballDigest,
      upgradePlanDigest: d("upgrade-plan"),
      installReceiptDigest: d("receipt"),
      checkpointDigest: d("checkpoint"),
      visibilityDigest: d("visibility"),
    };
    case "deactivation-tombstone-visibility": return {
      deactivationPlanDigest: d("deactivation-plan"),
      visibilityDigest: d("visibility"),
      lifecycleHeadDigest: d("lifecycle-head"),
      tombstoneDigest: d("tombstone"),
      activeReceiptDigest: d("active-receipt"),
      launcherPreserved: true,
      currentReceiptPreserved: true,
    };
    default: throw new Error("unsupported verifier scenario");
  }
}

async function createVerifierCandidateReadyCase(fixture, name) {
  const attemptDir = path.join(fixture.root, ".agentmo", "codex-uat", `attempt-${name}`);
  const candidateDirectory = path.join(attemptDir, "candidates");
  await mkdir(candidateDirectory, { recursive: true, mode: 0o700 });
  const journalPath = path.join(attemptDir, "attempt.journal");
  const attemptId = `attempt-${name}`;
  let view = await fixture.uatModule.startCodexUatAttempt({
    journalPath,
    attemptId,
    baseline: {
      packageRoot: fixture.baselinePackage,
      tarballPath: fixture.baselineTarball,
    },
    successor: {
      packageRoot: fixture.successorPackage,
      tarballPath: fixture.successorTarball,
    },
  });
  const marketplaceProjectionDigest = syntheticDigest(`${name}-marketplace`);
  const projectionTransactionDigest = syntheticDigest(`${name}-projection-transaction`);
  const projectionRootIdentity = {
    device: "1",
    group: "1",
    inode: "1",
    links: "1",
    mode: "700",
    owner: "1",
    size: "0",
  };
  const receiptValue = {
    schemaVersion: "agentmo.builder-install-receipt.v4",
    status: "activated",
    identity: {
      name: "agentmo",
      version: fixture.baselineVersion,
      adapterId: "codex",
      releaseDigest: fixture.identity.baseline.releaseDigest,
    },
    planDigest: syntheticDigest(`${name}-setup-plan`),
    evidence: {
      level: "host-observed",
      mechanismOnly: true,
      codexActivationVerified: false,
      hostBehaviorVerified: false,
      domainQualityCertified: false,
    },
    hostActivation: {
      schemaVersion: "agentmo.builder-codex-activation-binding.v3",
      hostScope: "user",
      selector: {
        pluginId: "agentmo@agentmo-local",
        pluginName: "agentmo",
        marketplaceName: "agentmo-local",
      },
      releaseDigest: fixture.identity.baseline.releaseDigest,
      marketplaceProjectionDigest,
      operationOrderDigest: syntheticDigest(`${name}-operation-order`),
      ownerDisposition: "created-by-agentmo",
      ownerRecordDigest: syntheticDigest(`${name}-owner`),
      consumerId: syntheticDigest(`${name}-consumer-id`),
      consumerEntryDigest: syntheticDigest(`${name}-consumer`),
      consumerLedgerDigest: syntheticDigest(`${name}-ledger`),
      consumerEntryOwned: true,
      selectorDeletionAuthority: false,
      expectedPostObservation: {
        installation: "installed",
        enabled: true,
        sourceMatch: true,
        releaseMatch: true,
        skillVisibility: "visible",
        hooksVisibility: "visible",
        trust: "trusted-or-pending-human",
        agentHostVisibility: "unobservable",
      },
      finalProjectionBinding: {
        schemaVersion: "agentmo.codex-marketplace-projection-binding.v1",
        transactionId: projectionTransactionDigest.slice("sha256:".length),
        transactionDigest: projectionTransactionDigest,
        releaseDigest: fixture.identity.baseline.releaseDigest,
        contentDigest: marketplaceProjectionDigest,
        rootIdentity: projectionRootIdentity,
        rootIdentityDigest: digestRawBytes(Buffer.from(serializePersistableJson({
          schemaVersion: "agentmo.codex-marketplace-root-identity.v1",
          ...projectionRootIdentity,
        }, { subject: "codex-marketplace-root-identity" }), "utf8")),
        members: [{
          kind: "root",
          relativePath: "",
          digest: null,
          identity: projectionRootIdentity,
        }],
      },
    },
  };
  const receiptBytes = Buffer.from(serializePersistableJson(receiptValue, {
    subject: "builder-install-receipt",
  }), "utf8");
  const receiptPath = path.join(attemptDir, "baseline-receipt.json");
  await writeFile(receiptPath, receiptBytes, { flag: "wx", mode: 0o600 });
  const receiptDigest = digestRawBytes(receiptBytes);
  const checkpointPath = path.join(attemptDir, "scenario-checkpoint.json");
  let checkpointAdmission = await fixture.checkpointModule.writeBuilderCheckpoint(
    checkpointPath,
    syntheticCheckpoint(fixture.checkpointModule, receiptDigest),
  );
  view = await fixture.uatModule.recordCodexUatSetupApplied({
    journalPath,
    expectedHeadAdmission: view.head,
    installReceiptPath: receiptPath,
    expectedInstallReceiptDigest: receiptDigest,
    checkpointAdmission,
  });
  const hostPath = path.join(attemptDir, "host-observation.json");
  const hostBytes = Buffer.from("bounded host observation\n");
  await writeFile(hostPath, hostBytes, { flag: "wx", mode: 0o600 });
  view = await fixture.uatModule.recordCodexUatActivationApplied({
    journalPath,
    expectedHeadAdmission: view.head,
    installReceiptPath: receiptPath,
    expectedInstallReceiptDigest: receiptDigest,
    checkpointAdmission,
    hostObservationPath: hostPath,
    expectedHostObservationDigest: digestRawBytes(hostBytes),
  });
  const trustFiles = [];
  for (const label of ["process", "trust", "auth"]) {
    const filePath = path.join(attemptDir, `${label}.evidence`);
    const bytes = Buffer.from(`${label}\n`);
    await writeFile(filePath, bytes, { flag: "wx", mode: 0o600 });
    trustFiles.push({ filePath, digest: digestRawBytes(bytes) });
  }
  view = await fixture.uatModule.recordCodexUatTrustAuthObservation({
    journalPath,
    expectedHeadAdmission: view.head,
    freshProcessEvidencePath: trustFiles[0].filePath,
    expectedFreshProcessDigest: trustFiles[0].digest,
    trustObservationPath: trustFiles[1].filePath,
    expectedTrustObservationDigest: trustFiles[1].digest,
    authObservationPath: trustFiles[2].filePath,
    expectedAuthObservationDigest: trustFiles[2].digest,
  });
  const observationDirectory = path.join(attemptDir, "observations");
  for (const [index, scenario] of fixture.uatModule.CODEX_UAT_SCENARIO_IDS.entries()) {
    const armed = await fixture.uatModule.armCodexUatScenario({
      journalPath,
      expectedHeadAdmission: view.head,
      checkpointPath,
      checkpointAdmission,
    });
    checkpointAdmission = armed.checkpointAdmission;
    const observation = await fixture.uatModule.publishCodexUatObservationLeaf({
      outDirectory: observationDirectory,
      attemptId,
      scenario,
      correlation: armed.correlation,
      source: "operator-observation",
      eventDigest: syntheticDigest(`${name}-${scenario}-event`),
      runnerDigest: syntheticDigest(`${name}-${scenario}-runner`),
      releaseDigest: fixture.identity.baseline.releaseDigest,
      installReceiptDigest: receiptDigest,
    });
    view = await fixture.uatModule.recordCodexUatScenarioObservation({
      journalPath,
      expectedHeadAdmission: view.head,
      checkpointAdmission,
      observationAdmission: observation,
      evidence: verifierScenarioEvidence(scenario, index, fixture),
    });
  }
  const candidate = await fixture.uatModule.publishCodexUatCandidate({
    journalPath,
    expectedHeadAdmission: view.head,
    candidateDirectory,
  });
  view = await fixture.uatModule.appendCodexUatCandidateReady({
    journalPath,
    expectedHeadAdmission: view.head,
    candidatePath: candidate.filePath,
    expectedCandidateDigest: candidate.digest,
  });
  return { attemptDir, journalPath, candidateDirectory, candidate, view };
}

function exactVerifierArgs(fixture, attempt, overrides = {}) {
  return {
    "attempt-dir": attempt.attemptDir,
    "successor-tarball": overrides.tarball ?? fixture.successorTarball,
    "expected-head-sha256": overrides.head ?? attempt.view.head.digest,
    "expected-candidate-sha256": overrides.candidate ?? attempt.candidate.digest,
    "expected-successor-version": overrides.version ?? fixture.successorVersion,
    "expected-release-sha256": overrides.release ?? fixture.identity.successor.releaseDigest,
    "expected-tarball-sha256": overrides.tarballDigest ?? fixture.identity.successor.tarballDigest,
  };
}

before(async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-packed-release-"));
  const packDir = path.join(root, "pack");
  const host = path.join(root, "host");
  const npmCache = path.join(root, "npm-cache");
  await mkdir(packDir);
  await mkdir(host);
  const packed = await execFileAsync("npm", ["pack", "--cache", npmCache, "--pack-destination", packDir], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  const archiveName = packed.stdout.trim().split(/\r?\n/u).at(-1);
  assert.match(archiveName, /^agentmo-\d+\.\d+\.\d+\.tgz$/u);
  const archive = path.join(packDir, archiveName);
  await execFileAsync("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--no-package-lock",
    "--no-save",
    "--cache",
    npmCache,
    archive,
  ], { cwd: host, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  packedPackageRoot = path.join(host, "node_modules", "agentmo");
  const moduleUrl = pathToFileURL(path.join(packedPackageRoot, "src", "builder-install.js"));
  packedInstall = await import(`${moduleUrl.href}?packed=${Date.now()}`);
  const packageModuleUrl = pathToFileURL(path.join(packedPackageRoot, "src", "builder-package.js"));
  packedPackage = await import(`${packageModuleUrl.href}?packed=${Date.now()}`);
  const codexHostModuleUrl = pathToFileURL(path.join(packedPackageRoot, "src", "builder-codex-host.js"));
  packedCodexHost = await import(`${codexHostModuleUrl.href}?packed=${Date.now()}`);
  const codexUatModuleUrl = pathToFileURL(path.join(packedPackageRoot, "src", "builder-codex-uat.js"));
  packedCodexUat = await import(`${codexUatModuleUrl.href}?packed=${Date.now()}`);
  const bridgeModuleUrl = pathToFileURL(path.join(packedPackageRoot, "src", "builder-hook-bridge.js"));
  packedBridge = await import(`${bridgeModuleUrl.href}?packed=${Date.now()}`);
  const checkpointModuleUrl = pathToFileURL(path.join(packedPackageRoot, "src", "builder-checkpoint.js"));
  packedCheckpoint = await import(`${checkpointModuleUrl.href}?packed=${Date.now()}`);
  const journalModuleUrl = pathToFileURL(path.join(packedPackageRoot, "src", "builder-immutable-journal.js"));
  packedJournal = await import(`${journalModuleUrl.href}?packed=${Date.now()}`);
  const appendOnlyModuleUrl = pathToFileURL(
    path.join(packedPackageRoot, "src", "builder-append-only-authority.js"),
  );
  packedAppendOnly = await import(`${appendOnlyModuleUrl.href}?packed=${Date.now()}`);
  const packedImport = async (relativePath) => import(
    `${pathToFileURL(path.join(packedPackageRoot, relativePath)).href}?packed=${Date.now()}`
  );
  const [
    buildContract,
    authorityConsumption,
    authorityRootBinding,
    safeFs,
    packageProduce,
    packageArchive,
    packageCarriers,
    openClawProbe,
    installPlan,
    installTransaction,
    installReceipt,
    credentialHandoff,
    openClawProjection,
  ] = await Promise.all([
    packedImport("src/build-contract.js"),
    packedImport("src/openclaw-authority-consumption.js"),
    packedImport("src/openclaw-authority-root-binding.js"),
    packedImport("src/openclaw-safe-fs.js"),
    packedImport("src/package-produce.js"),
    packedImport("src/package-archive.js"),
    packedImport("src/package-carriers.js"),
    packedImport("src/openclaw-probe.js"),
    packedImport("src/openclaw-install-plan.js"),
    packedImport("src/openclaw-install-transaction.js"),
    packedImport("src/openclaw-install-receipt.js"),
    packedImport("src/openclaw-credential-handoff.js"),
    packedImport("src/targets/openclaw-package.js"),
  ]);
  packedPhase4 = Object.freeze({
    authorityConsumption,
    authorityRootBinding,
    buildContract,
    credentialHandoff,
    installPlan,
    installReceipt,
    installTransaction,
    openClawProbe,
    openClawProjection,
    packageArchive,
    packageCarriers,
    packageProduce,
    safeFs,
  });
});

function phase4DigestJson(value, subject) {
  return digestRawBytes(Buffer.from(
    serializePersistableJson(value, { subject }),
    "utf8",
  ));
}

async function runPackedPhase4Cli(args, fixtureRoot) {
  const home = path.join(fixtureRoot, "home");
  const cwd = path.join(fixtureRoot, "cwd");
  await mkdir(home, { recursive: true, mode: 0o700 });
  await mkdir(cwd, { recursive: true, mode: 0o700 });
  return runPackageCli(packedPackageRoot, args, {
    bin: path.dirname(process.execPath),
    closedEnv: true,
    cwd,
    home,
    env: {
      PATH: `${path.dirname(process.execPath)}${path.delimiter}/usr/bin${path.delimiter}/bin`,
      TMPDIR: fixtureRoot,
    },
  });
}

async function packedReceiptCompanionBundleArgs(
  prefix,
  companions,
  directory,
  label,
) {
  const bundlePath = path.join(directory, `${label}-${prefix}-companions.json`);
  const relativeBinding = (binding) => ({
    ...binding,
    filePath: path.relative(directory, binding.filePath).split(path.sep).join("/"),
  });
  const relativeCompanions = (value) => ({
    installPlan: relativeBinding(value.installPlan),
    ordinaryApproval: relativeBinding(value.ordinaryApproval),
    sensitiveDecisions: value.sensitiveDecisions.map(relativeBinding),
    conflictApproval: relativeBinding(value.conflictApproval),
    journal: relativeBinding(value.journal),
    probe: relativeBinding(value.probe),
    targetDescriptor: relativeBinding(value.targetDescriptor),
    packageManifest: relativeBinding(value.packageManifest),
    targetCarrierAdmission: relativeBinding(value.targetCarrierAdmission),
    blueprint: relativeBinding(value.blueprint),
    buildContract: relativeBinding(value.buildContract),
    planApproval: relativeBinding(value.planApproval),
    predecessor: value.predecessor === null
      ? null
      : {
          ...value.predecessor,
          filePath: path.relative(directory, value.predecessor.filePath).split(path.sep).join("/"),
          companions: relativeCompanions(value.predecessor.companions),
        },
  });
  const bytes = Buffer.from(serializePersistableJson(
    relativeCompanions(companions),
    { subject: "openclaw-receipt-companion-request" },
  ));
  await writeFile(bundlePath, bytes);
  return [
    `--${prefix}-receipt-companion-bundle`, bundlePath,
    `--${prefix}-receipt-companion-bundle-sha256`, digestRawBytes(bytes),
  ];
}

function packedJournalPath(targetRoot, installPlanDigest, attemptId) {
  return path.join(
    targetRoot,
    `.agentmo-openclaw-install-${installPlanDigest.slice("sha256:".length)}-${digestRawBytes(Buffer.from(attemptId)).slice("sha256:".length)}.journal.json`,
  );
}

function packedOpenClawAuthorityArgs(fixture) {
  return [
    "--blueprint", fixture.paths.blueprint,
    "--blueprint-sha256", fixture.digests.blueprint,
    "--build-contract", fixture.paths["build-contract"],
    "--build-contract-sha256", fixture.digests["build-contract"],
    "--plan-approval", fixture.paths["plan-approval"],
    "--plan-approval-sha256", fixture.digests["plan-approval"],
    "--target-carrier-admission",
    fixture.paths["openclaw-target-carrier-admission"],
    "--target-carrier-admission-sha256",
    fixture.digests["openclaw-target-carrier-admission"],
    "--target-descriptor", fixture.paths["openclaw-target-descriptor"],
    "--target-descriptor-sha256",
    fixture.digests["openclaw-target-descriptor"],
  ];
}

function packedLifecycleAuthorityArgs({
  archiveDigest,
  archivePath,
  fixture,
  probeDigest,
  probePath,
}) {
  return [
    ...packedOpenClawAuthorityArgs(fixture),
    "--archive", archivePath,
    "--archive-sha256", archiveDigest,
    "--probe", probePath,
    "--probe-sha256", probeDigest,
  ];
}

describe("packed Codex Builder setup", { concurrency: false }, () => {
  it("packs the exact Phase 4 runtime closure and imports it without checkout fallback", async () => {
    const release = await packedPackage.loadBuilderPackage();
    const phase4Assets = release.assets
      .map((asset) => asset.sourcePath)
      .filter((sourcePath) => PHASE_4_PACKED_RUNTIME_MODULES.includes(sourcePath))
      .toSorted();
    assert.deepEqual(phase4Assets, PHASE_4_PACKED_RUNTIME_MODULES);

    const manifest = JSON.parse(await readFile(
      path.join(packedPackageRoot, "package.json"),
      "utf8",
    ));
    assert.deepEqual(
      manifest.files.filter((sourcePath) => PHASE_4_PACKED_RUNTIME_MODULES.includes(sourcePath)),
      PHASE_4_PACKED_RUNTIME_MODULES,
    );
    assert.equal(new Set(manifest.files).size, manifest.files.length);

    for (const relativePath of PHASE_4_PACKED_RUNTIME_MODULES) {
      const packedPath = path.join(packedPackageRoot, relativePath);
      assert.equal(
        path.relative(packedPackageRoot, packedPath).startsWith(`..${path.sep}`),
        false,
      );
      const loaded = await import(`${pathToFileURL(packedPath).href}?phase4=${Date.now()}`);
      assert.equal(Object.keys(loaded).length > 0, true, relativePath);
    }
  });

  it("Phase 4 extracted tarball full journey closes six root gaps", {
    timeout: PACKED_INSTALL_TIMEOUT_MS,
  }, async () => {
    const targetExecutableSource = [
      "import { readFileSync, writeFileSync } from 'node:fs';",
      "const argv = process.argv.slice(2);",
      "if (argv[0] !== 'config' || argv[1] !== 'patch') process.exit(0);",
      "if (argv[2] !== '--file') process.exit(64);",
      "const patch = JSON.parse(readFileSync(new URL(argv[3], `file://${process.cwd()}/`), 'utf8'));",
      "const current = JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH, 'utf8'));",
      "const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);",
      "const merge = (left, right) => { const next = { ...left }; for (const [key, value] of Object.entries(right)) { if (value === null) delete next[key]; else next[key] = plain(value) && plain(next[key]) ? merge(next[key], value) : value; } return next; };",
      "if (!argv.includes('--dry-run')) writeFileSync(process.env.OPENCLAW_CONFIG_PATH, `${JSON.stringify(merge(current, patch), null, 2)}\\n`);",
      "",
    ].join("\n");
    const fixture = await buildApprovedPackageFixture({ targetExecutableSource });
    const journeyRoot = path.join(fixture.root, "packed-phase4-journey");
    const helperRoot = path.join(journeyRoot, "helper");
    const helperPath = path.join(helperRoot, "openclaw-fs-kernel");
    const helperReceiptPath = path.join(
      helperRoot,
      "openclaw-fs-kernel.receipt.json",
    );
    await mkdir(helperRoot, { recursive: true, mode: 0o700 });
    const helperBuild = await runPackedPhase4Cli([
      "openclaw-fs-kernel-build",
      "--binary-out", helperPath,
      "--receipt-out", helperReceiptPath,
      "--json",
    ], journeyRoot);
    assert.equal(
      helperBuild.code,
      0,
      `${helperBuild.stdout}${helperBuild.stderr}`,
    );
    const helperBuildResult = JSON.parse(helperBuild.stdout);
    const helperReceiptDigest = helperBuildResult.receiptDigest;
    assert.match(helperReceiptDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.equal((await stat(helperPath)).isFile(), true);
    assert.equal((await stat(helperReceiptPath)).isFile(), true);

    const outputRoot = path.join(journeyRoot, "agent-package");
    const archivePath = path.join(journeyRoot, "agent-package.d42");
    const produceCli = await runPackedPhase4Cli([
      "package-produce",
      fixture.paths.blueprint,
      "--design-plan", fixture.paths["design-plan"],
      "--discovery-approval", fixture.paths["discovery-approval"],
      "--decision-ledger", fixture.paths["decision-ledger"],
      "--build-contract", fixture.paths["build-contract"],
      "--plan-approval", fixture.paths["plan-approval"],
      "--target-descriptor", fixture.paths["openclaw-target-descriptor"],
      "--target-carrier-admission",
      fixture.paths["openclaw-target-carrier-admission"],
      "--digest", `blueprint=${fixture.digests.blueprint}`,
      "--digest", `design-plan=${fixture.digests["design-plan"]}`,
      "--digest",
      `discovery-approval=${fixture.digests["discovery-approval"]}`,
      "--digest", `decision-ledger=${fixture.digests["decision-ledger"]}`,
      "--digest", `build-contract=${fixture.digests["build-contract"]}`,
      "--digest", `plan-approval=${fixture.digests["plan-approval"]}`,
      "--digest",
      `openclaw-target-descriptor=${fixture.digests["openclaw-target-descriptor"]}`,
      "--digest",
      `openclaw-target-carrier-admission=${fixture.digests["openclaw-target-carrier-admission"]}`,
      "--fs-helper", helperPath,
      "--fs-helper-receipt", helperReceiptPath,
      "--fs-helper-receipt-digest", helperReceiptDigest,
      "--out", outputRoot,
      "--archive", archivePath,
      "--json",
    ], journeyRoot);
    assert.equal(
      produceCli.code,
      0,
      `${produceCli.stdout}${produceCli.stderr}`,
    );
    const produced = {
      ...JSON.parse(produceCli.stdout),
      outputRoot,
    };
    const inspectCli = await runPackedPhase4Cli([
      "package-inspect",
      archivePath,
      "--archive-sha256", produced.archiveDigest,
      "--json",
    ], journeyRoot);
    assert.equal(
      inspectCli.code,
      0,
      `${inspectCli.stdout}${inspectCli.stderr}`,
    );
    const inspected = JSON.parse(inspectCli.stdout);
    assert.equal(inspected.offline.filesystemReadOnly, true);
    assert.equal(inspected.offline.openClawInvoked, false);
    assert.equal(inspected.transport.archiveOnlyDownstream, true);
    assert.equal(inspected.transport.archiveDigest, produced.archiveDigest);
    assert.equal(inspected.certificationBoundary.installed, false);
    assert.equal(inspected.certificationBoundary.runtime, false);
    assert.equal(JSON.stringify(inspected).includes(fixture.root), false);

    const archiveInventory = await packedPhase4.packageArchive
      .readPackageArchiveInventory({
        archivePath,
        expectedArchiveDigest: produced.archiveDigest,
      });
    const agentMember = archiveInventory.members.find(
      ({ relativePath }) => (
        relativePath === "projections/openclaw/workspace/AGENTS.md"
      ),
    );
    const soulMember = archiveInventory.members.find(
      ({ relativePath }) => (
        relativePath === "projections/openclaw/workspace/SOUL.md"
      ),
    );
    assert.ok(agentMember);
    assert.ok(soulMember);

    const openClawTargetRoot = path.dirname(
      fixture.inputs.targetFiles.packageJsonPath,
    );
    const probePath = path.join(journeyRoot, "openclaw-probe.json");
    const probeCli = await runPackedPhase4Cli([
      "openclaw-probe",
      "--archive", archivePath,
      "--archive-sha256", produced.archiveDigest,
      ...packedOpenClawAuthorityArgs(fixture),
      "--target-root", openClawTargetRoot,
      "--out", probePath,
      "--json",
    ], journeyRoot);
    assert.equal(
      probeCli.code,
      0,
      `${probeCli.stdout}${probeCli.stderr}`,
    );
    const probe = JSON.parse(await readFile(probePath, "utf8"));
    assert.equal(probe.status, "compatible");
    const probeDigest = digestRawBytes(await readFile(probePath));

    const targetRoot = path.join(journeyRoot, "isolated-target");
    const generationA = ".agentmo/generations/generation-a/AGENTS.md";
    const generationB = ".agentmo/generations/generation-b/SOUL.md";
    const configRelativePath = "openclaw.json";
    await mkdir(path.join(targetRoot, path.dirname(generationA)), {
      recursive: true,
    });
    await mkdir(path.join(targetRoot, path.dirname(generationB)), {
      recursive: true,
    });
    const authorityRootBinding = await packedPhase4.authorityRootBinding
      .createOpenClawAuthorityRootBinding({
        openClawTargetRoot,
        targetDescriptor: fixture.inputs.targetDescriptor.value,
      });
    const authorityRootBindingPath = path.join(
      journeyRoot,
      "authority-root-binding.json",
    );
    const authorityRootBindingWritten = await packedPhase4.authorityRootBinding
      .writeOpenClawAuthorityRootBinding(
        authorityRootBindingPath,
        authorityRootBinding,
      );
    const authorityStateRoot = path.join(
      path.dirname(openClawTargetRoot),
      `.agentmo-openclaw-authority-${authorityRootBinding.targetDescriptorDigest.slice(
        "sha256:".length,
      )}`,
    );
    const initialConfig = { unknown: { preserved: "exact-value" } };
    await writeFile(
      path.join(targetRoot, configRelativePath),
      `${JSON.stringify(initialConfig, null, 2)}\n`,
      { mode: 0o600 },
    );
    const target = {
      targetId: probe.target.id,
      targetVersion: probe.target.version,
      targetRevision: probe.target.sourceRevision,
      probeFingerprintDigest: probe.fingerprintDigest,
      scope: "project",
      projectId: "packed-fixture-project",
    };

    const genesisRequest = {
      target,
      operations: [{
        path: generationA,
        operation: "write",
        currentDigest: null,
      }],
      observedAt: "2026-07-30T00:00:00.000Z",
    };
    const genesisRequestPath = path.join(
      journeyRoot,
      "install-genesis-request.json",
    );
    const genesisRequestBytes = Buffer.from(serializePersistableJson(
      genesisRequest,
      { subject: "genesis-request" },
    ));
    await writeFile(genesisRequestPath, genesisRequestBytes);
    const genesisPath = path.join(journeyRoot, "install-genesis.json");
    const genesisCli = await runPackedPhase4Cli([
      "openclaw-install-genesis",
      ...packedLifecycleAuthorityArgs({
        archiveDigest: produced.archiveDigest,
        archivePath,
        fixture,
        probeDigest,
        probePath,
      }),
      "--request", genesisRequestPath,
      "--request-sha256", digestRawBytes(genesisRequestBytes),
      "--target-root", targetRoot,
      "--fs-helper", helperPath,
      "--fs-helper-receipt", helperReceiptPath,
      "--fs-helper-receipt-digest", helperReceiptDigest,
      "--out", genesisPath,
      "--json",
    ], journeyRoot);
    assert.equal(
      genesisCli.code,
      0,
      `${genesisCli.stdout}${genesisCli.stderr}`,
    );
    const genesis = JSON.parse(await readFile(genesisPath, "utf8"));
    const genesisWritten = {
      digest: digestRawBytes(await readFile(genesisPath)),
    };

    const configFor = (generation) => generation === null
      ? initialConfig
      : {
        ...initialConfig,
        agents: {
          "support-triage": {
            workspace: generation,
          },
        },
      };
    const configBytes = (value) => Buffer.from(
      `${JSON.stringify(value, null, 2)}\n`,
    );
    const retainedOperation = async ({
      relativePath,
      operation,
      sourcePath = null,
      currentDigest,
      desiredDigest,
      configPatch = null,
    }) => {
      const absolute = path.join(targetRoot, relativePath);
      const parent = await lstat(path.dirname(absolute));
      const file = await lstat(absolute).catch((error) => {
        if (error?.code === "ENOENT") return null;
        throw error;
      });
      return {
        path: relativePath,
        operation,
        sourcePath,
        configPatch,
        baseDigest: currentDigest,
        currentDigest,
        desiredDigest,
        ownerMarker: "agentmo:packed-fixture-project",
        retainedFileIdentity: file === null ? null : {
          device: file.dev.toString(),
          inode: file.ino.toString(),
        },
        retainedParentIdentity: {
          device: parent.dev.toString(),
          inode: parent.ino.toString(),
        },
        conflict: "none",
        rollbackRule: operation === "write"
          ? "remove-if-created-and-pristine"
          : "restore-if-owned-and-current-digest-matches",
      };
    };
    const receipts = new Map();
    const runLifecycle = async ({
      lifecycle,
      fromConfig,
      toConfig,
      writeMember = null,
      writePath = null,
      current = null,
      selected = null,
    }) => {
      const patch = toConfig === initialConfig
        ? { agents: null }
        : { agents: toConfig.agents };
      const patchDigest = phase4DigestJson(
        patch,
        "openclaw-official-config-patch",
      );
      const operations = [];
      if (writeMember !== null) {
        operations.push(await retainedOperation({
          relativePath: writePath,
          operation: "write",
          sourcePath: writeMember.relativePath,
          currentDigest: null,
          desiredDigest: writeMember.sha256,
        }));
      }
      operations.push(await retainedOperation({
        relativePath: configRelativePath,
        operation: lifecycle === "uninstall" ? "remove" : "patch",
        currentDigest: digestRawBytes(configBytes(fromConfig)),
        desiredDigest: digestRawBytes(configBytes(toConfig)),
        configPatch: { patch, patchDigest },
      }));
      operations.sort((left, right) => (
        Buffer.from(left.path).compare(Buffer.from(right.path))
      ));
      const action = {
        actionId: `config:${lifecycle}:openclaw.json`,
        kind: "external-command",
        executable: "openclaw",
        argv: [
          "config",
          "patch",
          "--file",
          `agentmo-config-patch-${patchDigest.slice("sha256:".length)}.json`,
        ],
        cwd: ".",
        scope: "project",
        target: configRelativePath,
        timeoutMs: 10_000,
        environmentNames: [],
      };
      const previewRequest = {
        target,
        operations,
        sensitiveActions: [action],
        conflicts: [],
        officialConfigDryRun: {
          commandDigest: digestRawBytes(
            Buffer.from(`${lifecycle}:config-command`),
          ),
          resultDigest: digestRawBytes(
            Buffer.from(`${lifecycle}:config-result`),
          ),
          accepted: true,
        },
      };
      const previewRequestPath = path.join(
        journeyRoot,
        `${lifecycle}-preview-request.json`,
      );
      const previewRequestBytes = Buffer.from(serializePersistableJson(
        previewRequest,
        { subject: "preview-request" },
      ));
      await writeFile(previewRequestPath, previewRequestBytes);
      const planPath = path.join(journeyRoot, `${lifecycle}-plan.json`);
      const currentCompanionArgs = current === null
        ? []
        : await packedReceiptCompanionBundleArgs(
          "current",
          current.companions,
          path.dirname(fixture.root),
          `${path.basename(fixture.root)}-${lifecycle}`,
        );
      const predecessorCompanionArgs = selected === null
        ? []
        : await packedReceiptCompanionBundleArgs(
          "predecessor",
          selected.companions,
          path.dirname(fixture.root),
          `${path.basename(fixture.root)}-${lifecycle}`,
        );
      const previewBasisArgs = lifecycle === "install"
        ? [
          "--absent-genesis", genesisPath,
          "--absent-genesis-sha256", genesisWritten.digest,
        ]
        : lifecycle === "rollback"
          ? [
            "--current-receipt", current.path,
            "--current-receipt-sha256", current.digest,
            ...currentCompanionArgs,
            "--predecessor-receipt", selected.path,
            "--predecessor-receipt-sha256", selected.digest,
            ...predecessorCompanionArgs,
            "--predecessor-archive", archivePath,
            "--predecessor-archive-sha256", produced.archiveDigest,
          ]
          : [
            "--current-receipt", current.path,
            "--current-receipt-sha256", current.digest,
            ...currentCompanionArgs,
          ];
      const previewCli = await runPackedPhase4Cli([
        "openclaw-install-preview",
        "--lifecycle", lifecycle,
        ...packedLifecycleAuthorityArgs({
          archiveDigest: produced.archiveDigest,
          archivePath,
          fixture,
          probeDigest,
          probePath,
        }),
        "--request", previewRequestPath,
        "--request-sha256", digestRawBytes(previewRequestBytes),
        "--target-root", targetRoot,
        "--openclaw-target-root", openClawTargetRoot,
        "--fs-helper", helperPath,
        "--fs-helper-receipt", helperReceiptPath,
        "--fs-helper-receipt-digest", helperReceiptDigest,
        "--authority-root-binding", authorityRootBindingPath,
        "--authority-root-binding-sha256", authorityRootBindingWritten.digest,
        ...previewBasisArgs,
        "--out", planPath,
        "--json",
      ], journeyRoot);
      assert.equal(
        previewCli.code,
        0,
        `${previewCli.stdout}${previewCli.stderr}`,
      );
      const plan = JSON.parse(await readFile(planPath, "utf8"));
      const planWritten = {
        digest: digestRawBytes(await readFile(planPath)),
      };
      const common = {
        plan,
        decision: "approve",
        issuedAt: "2026-07-30T00:00:00.000Z",
        expiresAt: "2099-07-30T00:00:00.000Z",
      };
      const ordinaryPath = path.join(
        journeyRoot,
        `${lifecycle}-ordinary.json`,
      );
      const sensitivePath = path.join(
        journeyRoot,
        `${lifecycle}-sensitive.json`,
      );
      const conflictPath = path.join(
        journeyRoot,
        `${lifecycle}-conflict.json`,
      );
      const approvalRequest = {
        issuedAt: common.issuedAt,
        expiresAt: common.expiresAt,
        validationNow: common.issuedAt,
        noncePrefix: `packed:${lifecycle}`,
      };
      const approvalRequestPath = path.join(
        journeyRoot,
        `${lifecycle}-approval-request.json`,
      );
      const approvalRequestBytes = Buffer.from(serializePersistableJson(
        approvalRequest,
        { subject: "approval-request" },
      ));
      await writeFile(approvalRequestPath, approvalRequestBytes);
      const approveCli = await runPackedPhase4Cli([
        "openclaw-install-approve",
        "--plan", planPath,
        "--plan-sha256", planWritten.digest,
        "--request", approvalRequestPath,
        "--request-sha256", digestRawBytes(approvalRequestBytes),
        "--ordinary-out", ordinaryPath,
        "--sensitive-out", sensitivePath,
        "--conflict-out", conflictPath,
        "--json",
      ], journeyRoot);
      assert.equal(
        approveCli.code,
        0,
        `${approveCli.stdout}${approveCli.stderr}`,
      );
      const ordinaryWritten = {
        digest: digestRawBytes(await readFile(ordinaryPath)),
      };
      const sensitiveWritten = {
        digest: digestRawBytes(await readFile(sensitivePath)),
      };
      const conflictWritten = {
        digest: digestRawBytes(await readFile(conflictPath)),
      };
      const outputPath = path.join(journeyRoot, `${lifecycle}-receipt.json`);
      const attemptId = `packed:${lifecycle}`;
      const applyCli = await runPackedPhase4Cli([
        "openclaw-install-apply",
        "--lifecycle", lifecycle,
        ...packedLifecycleAuthorityArgs({
          archiveDigest: produced.archiveDigest,
          archivePath,
          fixture,
          probeDigest,
          probePath,
        }),
        "--install-plan", planPath,
        "--install-plan-sha256", planWritten.digest,
        "--ordinary-approval", ordinaryPath,
        "--ordinary-approval-sha256", ordinaryWritten.digest,
        "--sensitive-decision", sensitivePath,
        "--sensitive-decision-sha256", sensitiveWritten.digest,
        "--conflict-approval", conflictPath,
        "--conflict-approval-sha256", conflictWritten.digest,
        ...previewBasisArgs,
        "--fs-helper", helperPath,
        "--fs-helper-receipt", helperReceiptPath,
        "--fs-helper-receipt-digest", helperReceiptDigest,
        "--authority-root-binding", authorityRootBindingPath,
        "--authority-root-binding-sha256", authorityRootBindingWritten.digest,
        "--openclaw-target-root", openClawTargetRoot,
        "--target-root", targetRoot,
        "--attempt-id", attemptId,
        "--out", outputPath,
        "--json",
      ], journeyRoot);
      assert.equal(
        applyCli.code,
        0,
        `${applyCli.stdout}${applyCli.stderr}`,
      );
      const applyOutput = JSON.parse(applyCli.stdout);
      const result = {
        receipt: applyOutput.receipt,
        digest: applyOutput.digest,
        journalPath: packedJournalPath(
          targetRoot,
          plan.installPlanDigest,
          attemptId,
        ),
      };
      const companions = {
        installPlan: { filePath: planPath, digest: planWritten.digest },
        ordinaryApproval: {
          filePath: ordinaryPath,
          digest: ordinaryWritten.digest,
        },
        sensitiveDecisions: [{
          filePath: sensitivePath,
          digest: sensitiveWritten.digest,
        }],
        conflictApproval: {
          filePath: conflictPath,
          digest: conflictWritten.digest,
        },
        journal: {
          filePath: result.journalPath,
          digest: result.receipt.authorityLedger.journal.digest,
        },
        probe: { filePath: probePath, digest: probeDigest },
        targetDescriptor: {
          filePath: fixture.paths["openclaw-target-descriptor"],
          digest: fixture.digests["openclaw-target-descriptor"],
        },
        packageManifest: {
          filePath: path.join(produced.outputRoot, "agentmo.package.json"),
          digest: produced.manifestDigest,
        },
        targetCarrierAdmission: {
          filePath: fixture.paths["openclaw-target-carrier-admission"],
          digest: fixture.digests["openclaw-target-carrier-admission"],
        },
        blueprint: {
          filePath: fixture.paths.blueprint,
          digest: fixture.digests.blueprint,
        },
        buildContract: {
          filePath: fixture.paths["build-contract"],
          digest: fixture.digests["build-contract"],
        },
        planApproval: {
          filePath: fixture.paths["plan-approval"],
          digest: fixture.digests["plan-approval"],
        },
        predecessor: current === null
          ? null
          : {
            filePath: current.path,
            digest: current.digest,
            companions: current.companions,
          },
      };
      const authorityOptions = {
        openClawTargetRoot,
        helperPath,
        receiptPath: helperReceiptPath,
        receiptDigest: helperReceiptDigest,
        authorityRootBinding,
      };
      const recorded = {
        ...result,
        path: outputPath,
        companions,
        authorityOptions,
        plan,
      };
      const strictAdmission = await packedPhase4.installTransaction
        .admitOpenClawInstallReceiptWithCompanions(
          outputPath,
          result.digest,
          companions,
          authorityOptions,
        );
      assert.equal(strictAdmission.digest, result.digest);
      assert.equal(
        strictAdmission.postState.provenance.digest,
        result.receipt.postEffectEvidence.postState.digest,
      );
      assert.deepEqual(
        strictAdmission.actionResults.map(({ provenance }) => provenance.digest),
        result.receipt.postEffectEvidence.officialActionResults.map(
          ({ digest }) => digest,
        ),
      );
      assert.equal(
        strictAdmission.finalization.provenance.digest,
        result.receipt.postEffectEvidence.finalization.digest,
      );
      const officialActionUnsupported = process.platform !== "linux";
      assert.equal(
        result.receipt.status,
        officialActionUnsupported ? "incomplete" : "complete",
      );
      assert.equal(result.receipt.nonceConsumption.markers.length, 3);
      assert.equal(result.receipt.externalResults.length, 1);
      if (officialActionUnsupported) {
        assert.equal(
          result.receipt.externalResults[0].disposition,
          "unsupported",
        );
        assert.equal(
          result.receipt.externalResults[0].unsupportedReason,
          "platform-fd-config-transport-unavailable",
        );
      }
      assert.equal(
        result.receipt.lineage.predecessorReceiptDigest,
        current?.digest ?? null,
      );
      assert.deepEqual(
        JSON.parse(
          await readFile(
            path.join(targetRoot, configRelativePath),
            "utf8",
          ),
        ),
        officialActionUnsupported ? initialConfig : toConfig,
      );
      receipts.set(lifecycle, recorded);
      return recorded;
    };

    const install = await runLifecycle({
      lifecycle: "install",
      fromConfig: initialConfig,
      toConfig: configFor(path.dirname(generationA)),
      writeMember: agentMember,
      writePath: generationA,
    });
    if (process.platform !== "linux") {
      assert.deepEqual([...receipts.keys()], ["install"]);
      return;
    }
    const upgrade = await runLifecycle({
      lifecycle: "upgrade",
      fromConfig: configFor(path.dirname(generationA)),
      toConfig: configFor(path.dirname(generationB)),
      writeMember: soulMember,
      writePath: generationB,
      current: install,
    });
    const rollback = await runLifecycle({
      lifecycle: "rollback",
      fromConfig: configFor(path.dirname(generationB)),
      toConfig: configFor(path.dirname(generationA)),
      current: upgrade,
      selected: install,
    });
    const uninstall = await runLifecycle({
      lifecycle: "uninstall",
      fromConfig: configFor(path.dirname(generationA)),
      toConfig: initialConfig,
      current: rollback,
    });
    assert.deepEqual(
      [...receipts.keys()],
      ["install", "upgrade", "rollback", "uninstall"],
    );
    assert.equal(uninstall.receipt.lineage.sequence, 3);
    assert.equal(
      uninstall.receipt.certificationBoundary.runtime,
      false,
    );
    assert.equal(
      uninstall.receipt.certificationBoundary.production,
      false,
    );
    // Root gap 5 (WR-01/02): lifecycle execution is real, while a caller
    // cannot self-certify the absent genesis observation used by install.
    await assert.rejects(
      () => packedPhase4.installPlan.buildOpenClawAbsentGenesisAuthority({
        target,
        checkedPaths: [generationA],
        verifiedAbsent: true,
        absenceObservationDigest: genesis.absenceObservationDigest,
        observedAt: genesis.observedAt,
      }),
      (error) => error?.code
        === "AGENTMO_OPENCLAW_INSTALL_PLAN_INVALID",
    );

    // Root gap 2 (CR-05/06): the already consumed install nonce set cannot be
    // replayed in a fresh attempt, and credential argv confusion is rejected.
    const replaySession = await packedPhase4.safeFs
      .openOpenClawSafeFsSession({
        rootPath: authorityStateRoot,
        helperPath,
        receiptPath: helperReceiptPath,
        receiptDigest: helperReceiptDigest,
      });
    const replayOrdinaryApproval = JSON.parse(await readFile(
      install.companions.ordinaryApproval.filePath,
      "utf8",
    ));
    const replaySensitiveDecisions = await Promise.all(
      install.companions.sensitiveDecisions.map(
        async ({ filePath }) => JSON.parse(await readFile(filePath, "utf8")),
      ),
    );
    const replayConflictApproval = JSON.parse(await readFile(
      install.companions.conflictApproval.filePath,
      "utf8",
    ));
    try {
      await assert.rejects(
        () => packedPhase4.authorityConsumption
          .reserveOpenClawAuthoritySet({
            session: replaySession,
            attemptId: "packed:install-replay",
            plan: install.plan,
            probe,
            ordinaryApproval: replayOrdinaryApproval,
            sensitiveDecisions: replaySensitiveDecisions,
            conflictApproval: replayConflictApproval,
            now: "2026-07-30T00:00:00.000Z",
          }),
        (error) => error?.code
          === "AGENTMO_OPENCLAW_AUTHORITY_RECOVERY_REQUIRED",
      );
    } finally {
      await replaySession.close();
    }
    assert.throws(
      () => packedPhase4.credentialHandoff
        .buildOpenClawCredentialSetupProposal({
          profileReference: "openclaw-profile:fixture",
          missingEnvironmentNames: ["OPENCLAW_API_TOKEN"],
          officialRoute: {
            executable: "openclaw",
            argv: ["plugins", "install", "evil"],
            timeoutMs: 30_000,
          },
        }),
      (error) => error?.code
        === "AGENTMO_OPENCLAW_CREDENTIAL_PROPOSAL_INVALID",
    );

    // Root gap 1 (CR-01/02/09): target replacement invalidates a fresh packed
    // probe rather than reusing prior self-authenticating observations.
    const targetExecutable = fixture.inputs.targetFiles.executablePath;
    await writeFile(targetExecutable, "process.exit(0);\n");
    await assert.rejects(
      () => packedPhase4.openClawProbe.probeOpenClawTarget({
        archivePath,
        expectedArchiveDigest: produced.archiveDigest,
        blueprintPath: fixture.paths.blueprint,
        expectedBlueprintDigest: fixture.digests.blueprint,
        buildContractPath: fixture.paths["build-contract"],
        expectedBuildContractDigest: fixture.digests["build-contract"],
        planApprovalPath: fixture.paths["plan-approval"],
        expectedPlanApprovalDigest: fixture.digests["plan-approval"],
        targetCarrierAdmissionPath:
          fixture.paths["openclaw-target-carrier-admission"],
        expectedTargetCarrierAdmissionDigest:
          fixture.digests["openclaw-target-carrier-admission"],
        targetDescriptorPath: fixture.paths["openclaw-target-descriptor"],
        expectedTargetDescriptorDigest:
          fixture.digests["openclaw-target-descriptor"],
        targetRoot: openClawTargetRoot,
      }),
      (error) => error?.code === "AGENTMO_OPENCLAW_PROBE_TARGET_DRIFT",
    );

    // Root gap 3 (CR-03/04): explicit helper admission rejects receipt drift,
    // and a symlinked managed ancestor cannot be traversed by the native seam.
    await assert.rejects(
      () => packedPhase4.safeFs.openOpenClawSafeFsSession({
        rootPath: targetRoot,
        helperPath,
        receiptPath: helperReceiptPath,
        receiptDigest: `sha256:${"0".repeat(64)}`,
      }),
      (error) => error?.code === "AGENTMO_OPENCLAW_FS_ADMISSION_REJECTED",
    );
    const symlinkRoot = path.join(journeyRoot, "safe-fs-symlink-root");
    const outsideRoot = path.join(journeyRoot, "safe-fs-outside");
    await mkdir(symlinkRoot);
    await mkdir(outsideRoot);
    await symlink(outsideRoot, path.join(symlinkRoot, "managed"), "dir");
    const symlinkSession = await packedPhase4.safeFs
      .openOpenClawSafeFsSession({
        rootPath: symlinkRoot,
        helperPath,
        receiptPath: helperReceiptPath,
        receiptDigest: helperReceiptDigest,
    });
    try {
      const refused = await symlinkSession.createOnly(
        "managed/escape.txt",
        Buffer.from("blocked\n"),
        0o600,
      );
      assert.notEqual(refused.disposition, "created");
    } finally {
      await symlinkSession.close();
    }
    assert.deepEqual(await readdir(outsideRoot), []);

    // Root gap 4 (CR-07/08): false-complete bytes are rejected both by the
    // packed validator and by strict companion-backed re-admission.
    const falseComplete = structuredClone(install.receipt);
    falseComplete.preservedAssets = [{
      path: falseComplete.managedResults[0].path,
      observedDigest: falseComplete.managedResults[0].afterDigest,
      reasonCode: "packed-preserved-asset",
    }];
    falseComplete.recovery = {
      required: true,
      disposition: "preserved",
      removedAssets: [],
      preservedAssets: [{
        path: falseComplete.managedResults[0].path,
        digest: falseComplete.managedResults[0].afterDigest,
      }],
      reasons: ["packed-preserved-asset"],
    };
    assert.equal(
      packedPhase4.installReceipt
        .validateOpenClawInstallReceipt(falseComplete).ok,
      false,
    );
    const falseCompletePath = path.join(
      journeyRoot,
      "false-complete-receipt.json",
    );
    const falseCompleteBytes = Buffer.from(serializePersistableJson(
      falseComplete,
      { subject: "openclaw-install-receipt" },
    ));
    await writeFile(falseCompletePath, falseCompleteBytes);
    await assert.rejects(
      () => packedPhase4.installTransaction
        .admitOpenClawInstallReceiptWithCompanions(
          falseCompletePath,
          digestRawBytes(falseCompleteBytes),
          install.companions,
          install.authorityOptions,
        ),
      (error) => error?.code
        === "AGENTMO_OPENCLAW_INSTALL_RECEIPT_EVIDENCE_REJECTED",
    );

    // Root gap 6 (CR-10): a post-publication replacement is preserved. The
    // nested recipe projection also keeps the approved suffix (WR-03).
    const replacementOutput = path.join(journeyRoot, "replacement-package");
    const replacementArchive = path.join(
      journeyRoot,
      "replacement-package.d42",
    );
    const ownedArchive = path.join(journeyRoot, "owned-package.d42");
    const replacementBytes = Buffer.from("unknown replacement\n");
    await assert.rejects(
      () => packedPhase4.packageProduce.produceAgentPackage({
        ...packageProduceOptions(
          fixture,
          replacementOutput,
          replacementArchive,
        ),
        helperPath,
        receiptPath: helperReceiptPath,
        receiptDigest: helperReceiptDigest,
      }, {
        afterArchivePublication: async () => {
          await rename(replacementArchive, ownedArchive);
          await writeFile(replacementArchive, replacementBytes, {
            flag: "wx",
            mode: 0o600,
          });
          throw new Error("packed replacement attack");
        },
      }),
      (error) => error?.recoveryRequired === true,
    );
    assert.deepEqual(await readFile(replacementArchive), replacementBytes);
    const nestedContract = structuredClone(fixture.contract);
    nestedContract.nativePluginRecipe.files[0].relativePath =
      "openclaw/plugin/nested/a/index.js";
    nestedContract.nativePluginRecipe.files[1].relativePath =
      "openclaw/plugin/nested/b/openclaw.plugin.json";
    nestedContract.nativePluginRecipe.recipeDigest =
      packedPhase4.buildContract.computeNativePluginRecipeDigest(
        nestedContract.nativePluginRecipe,
      );
    const nestedAdmission = structuredClone(fixture.targetAdmission);
    nestedAdmission.authorities.nativePluginRecipeDigest =
      nestedContract.nativePluginRecipe.recipeDigest;
    const nestedCarrierSelection = packedPhase4.packageCarriers
      .selectPackageCarriers(nestedContract);
    const nestedEntries = packedPhase4.openClawProjection
      .buildOpenClawPackageProjection({
        buildContract: nestedContract,
        carrierSelection: nestedCarrierSelection,
        targetAdmission: nestedAdmission,
      });
    assert.equal(
      nestedEntries.some(({ relativePath }) => (
        relativePath.endsWith(
          "/nested/a/index.js",
        )
      )),
      true,
    );
    assert.equal(
      nestedEntries.some(({ relativePath }) => (
        relativePath.endsWith(
          "/nested/b/openclaw.plugin.json",
        )
      )),
      true,
    );

    for (const forbidden of [
      ".env",
      "credentialValue",
      "rawStdout",
      "rawStderr",
      "runtimeCertified",
      "domainCertified",
      "productionApproved",
    ]) {
      assert.equal(
        JSON.stringify({
          inspected,
          receipts: [...receipts.values()].map(({ receipt }) => receipt),
        }).includes(forbidden),
        false,
        forbidden,
      );
    }
  });

  it("exposes archive-only preview/apply grammar for all four lifecycle routes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-packed-phase4-help-"));
    const bin = await fakeCodexBin(root);
    for (const command of ["openclaw-install-preview", "openclaw-install-apply"]) {
      const result = await runPackedCli([command, "--help"], bin);
      assert.equal(result.code, 0, `${result.stdout}${result.stderr}`);
      assert.match(result.stdout, /--archive <archive\.d42>/u);
      assert.match(result.stdout, /--archive-sha256 sha256:<64hex>/u);
      assert.match(result.stdout, /--lifecycle install\|upgrade\|rollback\|uninstall/u);
      assert.doesNotMatch(result.stdout, /--package-root|--manifest-sha256/u);
    }
  });

  it("admits one deterministic fixed runtime inventory and its complete packed import closure", async () => {
    const first = await packedPackage.loadBuilderPackage();
    const second = await packedPackage.loadBuilderPackage();
    assert.equal(first.releaseDigest, second.releaseDigest);
    assert.deepEqual(
      first.assets.map(({ kind, sourcePath, relativePath, destinationPath, digest, byteLength }) => ({
        kind, sourcePath, relativePath, destinationPath, digest, byteLength,
      })),
      second.assets.map(({ kind, sourcePath, relativePath, destinationPath, digest, byteLength }) => ({
        kind, sourcePath, relativePath, destinationPath, digest, byteLength,
      })),
    );
    assert.equal(first.assets.length, 106);
    assert.equal(first.assets.filter((asset) => asset.kind === "runtime").length, 101);
    assert.deepEqual(
      first.assets.map((asset) => asset.destinationPath),
      first.assets.map((asset) => asset.destinationPath).toSorted(),
    );
    assert.equal(new Set(first.assets.map((asset) => asset.sourcePath)).size, first.assets.length);
    assert.equal(new Set(first.assets.map((asset) => asset.destinationPath)).size, first.assets.length);
    assert.equal(first.assets.some((asset) => asset.sourcePath === "bin/agentmo.js"), true);
    assert.equal(first.assets.some((asset) => asset.sourcePath === "src/cli.js"), true);
    assert.equal(first.assets.some((asset) => asset.sourcePath === "src/artifact-contract.js"), true);
    assert.equal(first.assets.some((asset) => asset.sourcePath === "src/discovery-live.js"), true);
    assert.equal(first.assets.some((asset) => asset.sourcePath === "src/discovery-live-transport.js"), true);
    assert.equal(first.assets.some((asset) => asset.sourcePath === "src/discovery-approval.js"), true);
    assert.equal(first.assets.some((asset) => asset.sourcePath === "src/decision-ledger.js"), true);
    assert.equal(first.assets.some((asset) => asset.sourcePath === "src/build-contract.js"), true);
    assert.equal(
      first.assets.some(
        (asset) => asset.sourcePath === "src/openclaw-install-evidence.js",
      ),
      true,
    );
    assert.equal(first.assets.some((asset) => (
      asset.sourcePath === "src/openclaw-authority-root-binding.js"
    )), true);
    assert.equal(first.assets.some((asset) => asset.sourcePath === "src/openclaw-target-admission.js"), true);
    assert.equal(first.assets.some((asset) => asset.sourcePath === "src/openclaw-target-descriptor.js"), true);
    assert.equal(first.assets.some((asset) => asset.sourcePath === "native/openclaw-fs-kernel.c"), true);
    assert.equal(first.assets.some((asset) => asset.sourcePath === "native/agentmo-nondumpable-preload.c"), true);
    assert.equal(first.assets.some((asset) => asset.sourcePath === "native/openclaw-process-supervisor.c"), true);
    assert.equal(first.assets.some((asset) => (
      asset.sourcePath === "native/prebuilt/linux-x64/agentmo-nondumpable-preload.so"
    )), true);
    assert.equal(first.assets.some((asset) => (
      asset.sourcePath === "native/prebuilt/linux-x64/README.md"
    )), true);
    assert.equal(first.assets.some((asset) => asset.sourcePath === "src/openclaw-process-supervisor.js"), true);
    assert.equal(first.assets.some((asset) => asset.sourcePath === "src/openclaw-safe-fs.js"), true);
    assert.equal(first.assets.some((asset) => asset.sourcePath === "src/package-carriers.js"), true);
    assert.equal(first.assets.some((asset) => asset.sourcePath === "src/plan-approval.js"), true);
    assert.equal(first.assets.some((asset) => asset.sourcePath === "src/discovery-provenance.js"), true);
    assert.equal(first.assets.some((asset) => asset.sourcePath === "src/collectors/arxiv.js"), true);
    assert.equal(first.assets.some((asset) => asset.sourcePath === "src/collectors/github.js"), true);
    assert.equal(first.assets.some((asset) => asset.sourcePath === "src/collectors/web.js"), true);
    assert.equal(first.assets.some((asset) => asset.sourcePath === "src/builder-codex-host.js"), true);
    assert.equal(first.assets.some((asset) => asset.sourcePath === "src/builder-bootstrap-snapshot.js"), true);
    assert.equal(first.assets.some((asset) => asset.sourcePath === "src/builder-immutable-journal.js"), true);
    const analyzerAsset = first.assets.find((asset) => asset.sourcePath === "src/javascript-static-analysis.js");
    assert.deepEqual({
      kind: analyzerAsset?.kind,
      sourcePath: analyzerAsset?.sourcePath,
      relativePath: analyzerAsset?.relativePath,
      destinationPath: analyzerAsset?.destinationPath,
      digest: analyzerAsset?.digest,
    }, {
      kind: "runtime",
      sourcePath: "src/javascript-static-analysis.js",
      relativePath: "runtime/agentmo/src/javascript-static-analysis.js",
      destinationPath: "plugins/agentmo/runtime/agentmo/src/javascript-static-analysis.js",
      digest: digestRawBytes(await readFile(path.join(packedPackageRoot, "src", "javascript-static-analysis.js"))),
    });
    const uatAsset = first.assets.find((asset) => asset.sourcePath === "src/builder-codex-uat.js");
    assert.deepEqual({
      kind: uatAsset?.kind,
      sourcePath: uatAsset?.sourcePath,
      relativePath: uatAsset?.relativePath,
      destinationPath: uatAsset?.destinationPath,
      digest: uatAsset?.digest,
    }, {
      kind: "runtime",
      sourcePath: "src/builder-codex-uat.js",
      relativePath: "runtime/agentmo/src/builder-codex-uat.js",
      destinationPath: "plugins/agentmo/runtime/agentmo/src/builder-codex-uat.js",
      digest: digestRawBytes(await readFile(path.join(packedPackageRoot, "src", "builder-codex-uat.js"))),
    });
    const continuationAsset = first.assets.find(
      (asset) => asset.sourcePath === "src/builder-codex-uat-continuation.js",
    );
    assert.deepEqual({
      kind: continuationAsset?.kind,
      sourcePath: continuationAsset?.sourcePath,
      relativePath: continuationAsset?.relativePath,
      destinationPath: continuationAsset?.destinationPath,
      digest: continuationAsset?.digest,
    }, {
      kind: "runtime",
      sourcePath: "src/builder-codex-uat-continuation.js",
      relativePath: "runtime/agentmo/src/builder-codex-uat-continuation.js",
      destinationPath: "plugins/agentmo/runtime/agentmo/src/builder-codex-uat-continuation.js",
      digest: digestRawBytes(await readFile(path.join(packedPackageRoot, "src", "builder-codex-uat-continuation.js"))),
    });
    const verifierAsset = first.assets.find(
      (asset) => asset.sourcePath === "scripts/verify-codex-uat-candidate.js",
    );
    assert.deepEqual({
      kind: verifierAsset?.kind,
      sourcePath: verifierAsset?.sourcePath,
      relativePath: verifierAsset?.relativePath,
      destinationPath: verifierAsset?.destinationPath,
      digest: verifierAsset?.digest,
    }, {
      kind: "runtime",
      sourcePath: "scripts/verify-codex-uat-candidate.js",
      relativePath: "runtime/agentmo/scripts/verify-codex-uat-candidate.js",
      destinationPath: "plugins/agentmo/runtime/agentmo/scripts/verify-codex-uat-candidate.js",
      digest: digestRawBytes(await readFile(
        path.join(packedPackageRoot, "scripts", "verify-codex-uat-candidate.js"),
      )),
    });
    const bridgeAsset = first.assets.find((asset) => asset.sourcePath === "src/builder-hook-bridge.js");
    assert.deepEqual({
      kind: bridgeAsset?.kind,
      sourcePath: bridgeAsset?.sourcePath,
      relativePath: bridgeAsset?.relativePath,
      destinationPath: bridgeAsset?.destinationPath,
      digest: bridgeAsset?.digest,
    }, {
      kind: "runtime",
      sourcePath: "src/builder-hook-bridge.js",
      relativePath: "runtime/agentmo/src/builder-hook-bridge.js",
      destinationPath: "plugins/agentmo/runtime/agentmo/src/builder-hook-bridge.js",
      digest: digestRawBytes(await readFile(path.join(packedPackageRoot, "src", "builder-hook-bridge.js"))),
    });
    assert.equal(first.assets.some((asset) => asset.sourcePath === "package.json"), true);

    const packedManifest = JSON.parse(await readFile(path.join(packedPackageRoot, "package.json"), "utf8"));
    assert.match(packedManifest.scripts.check, /node --check src\/builder-codex-host\.js/u);
    assert.match(packedManifest.scripts.check, /node --check src\/builder-codex-uat\.js/u);
    assert.match(packedManifest.scripts.check, /node --check src\/builder-hook-bridge\.js/u);
    assert.match(packedManifest.scripts.check, /node --check scripts\/verify-codex-uat-candidate\.js/u);
    assert.equal(typeof packedBridge.deliverInstalledBuilderHook, "function");
    assert.equal(Object.hasOwn(packedBridge, "deliverBuilderHook"), false);
    assert.equal(packedCodexUat.CODEX_UAT_CANDIDATE_SCHEMA_VERSION, "agentmo.codex-uat.v2");
    await execFileAsync(process.execPath, [
      "--check",
      path.join(packedPackageRoot, "src", "builder-codex-uat-continuation.js"),
    ]);
    assert.deepEqual(
      packedCodexHost.buildCodexHostSelector({
        name: "agentmo",
        version: "0.1.0",
        adapterId: "codex",
        releaseDigest: `sha256:${"a".repeat(64)}`,
      }),
      {
        pluginId: "agentmo@agentmo-local",
        pluginName: "agentmo",
        marketplaceName: "agentmo-local",
      },
    );

    const emptyCwd = await mkdtemp(path.join(tmpdir(), "agentmo-packed-empty-cwd-"));
    const home = await mkdtemp(path.join(tmpdir(), "agentmo-packed-empty-home-"));
    const result = await execFileAsync(process.execPath, [path.join(packedPackageRoot, "bin", "agentmo.js"), "--help"], {
      cwd: emptyCwd,
      encoding: "utf8",
      env: { HOME: home, LANG: "C", PATH: path.dirname(process.execPath) },
      maxBuffer: 2 * 1024 * 1024,
    });
    assert.match(result.stdout, /AgentMo CLI/u);
    assert.match(result.stdout, /builder codex-uat scenario-arm/u);
    assert.match(result.stdout, /builder behavior .*--uat/u);
    assert.equal(result.stderr, "");
    const cliUrl = pathToFileURL(path.join(packedPackageRoot, "src", "cli.js")).href;
    const bridgeUrl = pathToFileURL(path.join(packedPackageRoot, "src", "builder-hook-bridge.js")).href;
    const uatUrl = pathToFileURL(path.join(packedPackageRoot, "src", "builder-codex-uat.js")).href;
    const importClosure = await execFileAsync(process.execPath, [
      "--input-type=module",
      "--eval",
      `const [cli, bridge, uat] = await Promise.all([import(${JSON.stringify(cliUrl)}), import(${JSON.stringify(bridgeUrl)}), import(${JSON.stringify(uatUrl)})]); if (typeof cli.main !== "function" || typeof bridge.deliverInstalledBuilderHook !== "function" || Object.hasOwn(bridge, "deliverBuilderHook") || uat.CODEX_UAT_CANDIDATE_SCHEMA_VERSION !== "agentmo.codex-uat.v2") process.exit(2);`,
    ], {
      cwd: emptyCwd,
      encoding: "utf8",
      env: { HOME: home, LANG: "C", PATH: path.dirname(process.execPath) },
      maxBuffer: 2 * 1024 * 1024,
    });
    assert.equal(importClosure.stdout, "");
    assert.equal(importClosure.stderr, "");
  });

  it("fails closed for missing, unlisted, symlinked, duplicate, and remapped runtime inventory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-hostile-runtime-"));
    const missingRoot = path.join(root, "missing");
    await cp(packedPackageRoot, missingRoot, { recursive: true });
    await unlink(path.join(missingRoot, "src", "builder-hook-bridge.js"));
    await assert.rejects(
      packedPackage.loadBuilderPackage({ packageRoot: missingRoot }),
      (error) => error?.code === "AGENTMO_BUILDER_PACKAGE_MEMBER_UNLISTED",
    );

    const expandedRoot = path.join(root, "expanded");
    await cp(packedPackageRoot, expandedRoot, { recursive: true });
    await writeFile(path.join(expandedRoot, "src", "unlisted-runtime.js"), "export const unlisted = true;\n", "utf8");
    await writeFile(
      path.join(expandedRoot, "src", "cli.js"),
      `${await readFile(path.join(expandedRoot, "src", "cli.js"), "utf8")}\nimport "./unlisted-runtime.js";\n`,
      "utf8",
    );
    await assert.rejects(
      packedPackage.loadBuilderPackage({ packageRoot: expandedRoot }),
      (error) => error?.code === "AGENTMO_BUILDER_PACKAGE_MEMBER_UNLISTED",
    );

    const symlinkRoot = path.join(root, "symlink");
    await cp(packedPackageRoot, symlinkRoot, { recursive: true });
    await unlink(path.join(symlinkRoot, "src", "cli.js"));
    await symlink("secret-redaction.js", path.join(symlinkRoot, "src", "cli.js"));
    await assert.rejects(
      packedPackage.loadBuilderPackage({ packageRoot: symlinkRoot }),
      (error) => error?.code === "AGENTMO_BUILDER_PACKAGE_READ_FAILED",
    );

    const canonical = packedPackage.BUILDER_RELEASE_ASSET_INVENTORY.map((asset) => ({ ...asset }));
    const duplicate = canonical.map((asset) => ({ ...asset }));
    duplicate[1].destinationPath = duplicate[0].destinationPath;
    assert.throws(
      () => packedPackage.validateBuilderReleaseAssetInventory(duplicate),
      (error) => error?.code === "AGENTMO_BUILDER_PACKAGE_INVENTORY_INVALID",
    );
    const traversing = canonical.map((asset) => ({ ...asset }));
    traversing[0].destinationPath = "plugins/agentmo/../outside.js";
    assert.throws(
      () => packedPackage.validateBuilderReleaseAssetInventory(traversing),
      (error) => error?.code === "AGENTMO_BUILDER_PACKAGE_INVENTORY_INVALID",
    );
    const remapped = canonical.map((asset) => ({ ...asset }));
    remapped.at(-1).sourcePath = "src/not-the-canonical-source.js";
    assert.throws(
      () => packedPackage.validateBuilderReleaseAssetInventory(remapped),
      (error) => error?.code === "AGENTMO_BUILDER_PACKAGE_INVENTORY_INVALID",
    );
  });

  it("builds verifier-inclusive releases and keeps caller decisions nonterminal", async () => {
    const noOpRoot = await mkdtemp(path.join(tmpdir(), "agentmo-uat-no-op-builder-"));
    const noOpOut = path.join(noOpRoot, "releases");
    const noOp = await runUatReleaseBuilder(noOpOut, "0.1.0-uat.1", "0.1.0-uat.1");
    assert.equal(noOp.code, 1);
    await absent(noOpOut);
    await rm(noOpRoot, { recursive: true, force: true });

    const fixture = await createVerifierReleaseFixture();
    const alternate = await createVerifierReleaseFixture({
      baselineVersion: "0.1.0-uat.3",
      successorVersion: fixture.successorVersion,
    });
    try {
      const primary = await createVerifierCandidateReadyCase(fixture, "verifier-primary");
      const successorVerifier = path.join(
        fixture.successorPackage,
        "scripts",
        "verify-codex-uat-candidate.js",
      );
      const baselineVerifier = path.join(
        fixture.baselinePackage,
        "scripts",
        "verify-codex-uat-candidate.js",
      );
      const primaryArgs = exactVerifierArgs(fixture, primary);
      const beforePreview = await snapshotSyntheticAttempt(primary.attemptDir);
      const previewRun = await runPackedVerifier(successorVerifier, ["preview"], primaryArgs);
      assert.equal(previewRun.code, 0, "fresh successor preview must succeed");
      assert.equal(previewRun.stderr, "");
      assert.equal(previewRun.stdout.includes(fixture.root), false);
      const preview = JSON.parse(previewRun.stdout);
      assert.deepEqual(preview, {
        schemaVersion: "agentmo.codex-uat-candidate-preview.v2",
        status: "eligible",
        headDigest: primary.view.head.digest,
        candidateDigest: primary.candidate.digest,
        packageName: "agentmo",
        version: fixture.successorVersion,
        releaseDigest: fixture.identity.successor.releaseDigest,
        tarballDigest: fixture.identity.successor.tarballDigest,
        verifierDigest: fixture.identity.successor.verifierDigest,
        releaseSetOperationId: fixture.identity.operationId,
        releaseSetDigest: fixture.releaseSetDigest,
      });
      assert.deepEqual(await snapshotSyntheticAttempt(primary.attemptDir), beforePreview);

      assert.deepEqual(alternate.identity.successor, fixture.identity.successor);
      assert.notEqual(alternate.identity.operationId, fixture.identity.operationId);
      assert.notEqual(alternate.releaseSetDigest, fixture.releaseSetDigest);
      const crossPair = await runPackedVerifier(
        path.join(alternate.successorPackage, "scripts", "verify-codex-uat-candidate.js"),
        ["preview"],
        exactVerifierArgs(fixture, primary, {
          tarball: alternate.successorTarball,
          tarballDigest: alternate.identity.successor.tarballDigest,
        }),
      );
      assert.equal(crossPair.code, 1);
      assert.deepEqual(await snapshotSyntheticAttempt(primary.attemptDir), beforePreview);

      const hostileRuns = [
        await runPackedVerifier(baselineVerifier, ["preview"], {
          ...primaryArgs,
          "successor-tarball": fixture.baselineTarball,
          "expected-tarball-sha256": fixture.identity.baseline.tarballDigest,
        }),
        await runPackedVerifier(baselineVerifier, ["preview"], primaryArgs),
        await runPackedVerifier(successorVerifier, ["preview"], {
          ...primaryArgs,
          "successor-tarball": fixture.baselineTarball,
        }),
        await runPackedVerifier(successorVerifier, ["preview"], {
          ...primaryArgs,
          "expected-head-sha256": syntheticDigest("stale-verifier-head"),
        }),
        await runPackedVerifier(successorVerifier, ["preview"], {
          ...primaryArgs,
          "expected-candidate-sha256": syntheticDigest("stale-verifier-candidate"),
        }),
      ];
      for (const rejected of hostileRuns) {
        assert.equal(rejected.code, 1);
        assert.equal(rejected.stdout, "");
        const failure = JSON.parse(rejected.stderr);
        assert.equal(failure.status, "rejected");
        assert.match(failure.code, /^AGENTMO_CODEX_UAT_VERIFIER_/u);
        assert.deepEqual(await snapshotSyntheticAttempt(primary.attemptDir), beforePreview);
      }

      const tamperedRoot = path.join(fixture.root, "tampered-verifier-extract");
      await cp(fixture.successorPackage, tamperedRoot, { recursive: true });
      const tamperedVerifier = path.join(tamperedRoot, "scripts", "verify-codex-uat-candidate.js");
      await writeFile(
        tamperedVerifier,
        `${await readFile(tamperedVerifier, "utf8")}\n// tampered fixture byte\n`,
        "utf8",
      );
      const tampered = await runPackedVerifier(tamperedVerifier, ["preview"], primaryArgs);
      assert.equal(tampered.code, 1);
      assert.deepEqual(await snapshotSyntheticAttempt(primary.attemptDir), beforePreview);

      for (const [name, mutation] of [
        ["basis", { orderedEvidenceDigest: syntheticDigest("wrong-ordered-evidence") }],
        ["flag", { productionReady: true }],
      ]) {
        const hostile = await createVerifierCandidateReadyCase(fixture, `verifier-${name}`);
        const changed = { ...hostile.candidate.value, ...mutation };
        await writeFile(
          hostile.candidate.filePath,
          Buffer.from(serializePersistableJson(changed, {
            subject: "builder-codex-uat-candidate",
          }), "utf8"),
        );
        const before = await snapshotSyntheticAttempt(hostile.attemptDir);
        const rejected = await runPackedVerifier(
          successorVerifier,
          ["preview"],
          exactVerifierArgs(fixture, hostile),
        );
        assert.equal(rejected.code, 1, name);
        assert.deepEqual(await snapshotSyntheticAttempt(hostile.attemptDir), before, name);
      }

      const decisionRun = await runPackedVerifier(
        successorVerifier,
        ["decide", "approve"],
        primaryArgs,
      );
      assert.equal(decisionRun.code, 0, "exact approve may be reported without journal authority");
      assert.equal(decisionRun.stderr, "");
      const decision = JSON.parse(decisionRun.stdout);
      assert.equal(decision.status, "caller-reported-approval");
      assert.equal(decision.candidateDigest, primary.candidate.digest);
      assert.equal(decision.headDigest, primary.view.head.digest);
      assert.equal(decision.terminal, false);
      assert.equal(decision.journalMutated, false);
      assert.equal(decision.humanAuthorityVerified, false);
      assert.equal(decision.externalDecisionAuthorityRequired, true);
      const stillReady = await fixture.uatModule.loadCodexUatAttemptJournal(primary.journalPath);
      assert.equal(stillReady.state.phase, "candidate-ready");
      assert.equal(stillReady.state.terminal, false);
      assert.deepEqual(await snapshotSyntheticAttempt(primary.attemptDir), beforePreview);
      const afterDecision = await snapshotSyntheticAttempt(primary.attemptDir);
      const doubleDecision = await runPackedVerifier(
        successorVerifier,
        ["decide", "reject"],
        primaryArgs,
      );
      assert.equal(doubleDecision.code, 0);
      assert.equal(JSON.parse(doubleDecision.stdout).status, "caller-reported-rejection");
      assert.deepEqual(await snapshotSyntheticAttempt(primary.attemptDir), afterDecision);

      const rejectedCase = await createVerifierCandidateReadyCase(fixture, "verifier-reject");
      const rejectedDecision = await runPackedVerifier(
        successorVerifier,
        ["decide", "reject"],
        exactVerifierArgs(fixture, rejectedCase),
      );
      assert.equal(rejectedDecision.code, 0);
      const reportedRejection = JSON.parse(rejectedDecision.stdout);
      assert.equal(reportedRejection.status, "caller-reported-rejection");
      assert.equal(reportedRejection.terminal, false);
      assert.equal(reportedRejection.journalMutated, false);
      const rejectedView = await fixture.uatModule.loadCodexUatAttemptJournal(
        rejectedCase.journalPath,
      );
      assert.equal(rejectedView.state.phase, "candidate-ready");
      assert.equal(rejectedView.state.terminal, false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
      await absent(fixture.root);
      await rm(alternate.root, { recursive: true, force: true });
      await absent(alternate.root);
    }
  });

  it("crosses final deactivation only through a tombstone-bound packed continuation", async () => {
    const fixture = await createSyntheticContinuationFixture();
    try {
      const bin = await fakeCodexBin(fixture.root);
      const primary = await createSyntheticContinuationCase(fixture, bin, "primary");
      const before = await snapshotSyntheticAttempt(primary.attemptDir);
      const launcherPath = path.join(
        primary.project,
        ".codex", "agents", "agentmo.toml",
      );
      const launcherBefore = await readFile(launcherPath);
      const receiptIdentityBefore = await stat(primary.receiptPath, { bigint: true });
      const launcherIdentityBefore = await stat(launcherPath, { bigint: true });
      const alternatePair = await createSyntheticContinuationFixture({
        baselineVersion: "0.1.1",
        successorVersion: fixture.release.version,
      });
      try {
        assert.deepEqual({
          version: alternatePair.release.version,
          releaseDigest: alternatePair.release.releaseDigest,
          tarballDigest: alternatePair.tarballDigest,
          verifierDigest: alternatePair.verifierDigest,
          continuationDigest: alternatePair.continuationDigest,
        }, {
          version: fixture.release.version,
          releaseDigest: fixture.release.releaseDigest,
          tarballDigest: fixture.tarballDigest,
          verifierDigest: fixture.verifierDigest,
          continuationDigest: fixture.continuationDigest,
        });
        const beforeCrossPair = await snapshotSyntheticAttempt(primary.attemptDir);
        const crossPair = await runPackageCli(
          alternatePair.packageRoot,
          primary.continuationArgs({
            successorTarball: alternatePair.tarballPath,
            expectedSuccessorVersion: alternatePair.release.version,
            expectedReleaseDigest: alternatePair.release.releaseDigest,
            expectedTarballDigest: alternatePair.tarballDigest,
            expectedVerifierDigest: alternatePair.verifierDigest,
          }),
          { cwd: primary.project, home: primary.home, bin },
        );
        assert.equal(crossPair.code, 1);
        assert.match(
          `${crossPair.stdout}${crossPair.stderr}`,
          /AGENTMO_CODEX_UAT_CONTINUATION_REJECTED/u,
        );
        assert.deepEqual(await snapshotSyntheticAttempt(primary.attemptDir), beforeCrossPair);
        assert.deepEqual(await readFile(primary.receiptPath), primary.receiptBytes);
        assert.deepEqual(await readFile(launcherPath), launcherBefore);

        const preflightProbe = await createSyntheticContinuationCase(
          fixture,
          bin,
          "pair-preflight-no-leaf-effects",
        );
        const retainedCandidates = `${preflightProbe.candidateDirectory}.preflight-retained`;
        const retainedObservations = `${preflightProbe.observationDirectory}.preflight-retained`;
        await rename(preflightProbe.candidateDirectory, retainedCandidates);
        await rename(preflightProbe.observationDirectory, retainedObservations);
        const beforePreflight = await snapshotSyntheticAttempt(preflightProbe.attemptDir);
        const preflightRejected = await runPackageCli(
          alternatePair.packageRoot,
          preflightProbe.continuationArgs({
            successorTarball: alternatePair.tarballPath,
            expectedSuccessorVersion: alternatePair.release.version,
            expectedReleaseDigest: alternatePair.release.releaseDigest,
            expectedTarballDigest: alternatePair.tarballDigest,
            expectedVerifierDigest: alternatePair.verifierDigest,
          }),
          { cwd: preflightProbe.project, home: preflightProbe.home, bin },
        );
        assert.equal(preflightRejected.code, 1);
        await absent(preflightProbe.candidateDirectory);
        await absent(preflightProbe.observationDirectory);
        assert.deepEqual(await snapshotSyntheticAttempt(preflightProbe.attemptDir), beforePreflight);

        const armPreflightProbe = await createSyntheticContinuationCase(
          fixture,
          bin,
          "arm-preflight-no-leaf-effects",
        );
        const armRoot = path.relative(
          armPreflightProbe.project,
          path.join(armPreflightProbe.attemptDir, "deactivation-arm-authority"),
        ).split(path.sep).join("/");
        await fixture.appendOnlyModule.appendAppendOnlyRecord({
          projectRoot: armPreflightProbe.project,
          relativeRoot: armRoot,
          namespace: "codex-uat-arm",
          idempotencyKey: `deactivation:${armPreflightProbe.view.head.digest.slice("sha256:".length)}`,
          payload: {
            schemaVersion: "agentmo.codex-uat-deactivation-armed.v1",
            expectedHeadDigest: armPreflightProbe.view.head.digest,
          },
        });
        await rename(
          armPreflightProbe.candidateDirectory,
          `${armPreflightProbe.candidateDirectory}.preflight-retained`,
        );
        await rename(
          armPreflightProbe.observationDirectory,
          `${armPreflightProbe.observationDirectory}.preflight-retained`,
        );
        const beforeArmPreflight = await snapshotSyntheticAttempt(armPreflightProbe.attemptDir);
        const armPreflightRejected = await armPreflightProbe.cli(
          armPreflightProbe.continuationArgs(),
        );
        assert.equal(armPreflightRejected.code, 1);
        await absent(armPreflightProbe.candidateDirectory);
        await absent(armPreflightProbe.observationDirectory);
        assert.deepEqual(
          await snapshotSyntheticAttempt(armPreflightProbe.attemptDir),
          beforeArmPreflight,
        );
      } finally {
        await rm(alternatePair.root, { recursive: true, force: true });
        await absent(alternatePair.root);
      }
      const negativeCases = [
        { expectedHeadDigest: syntheticDigest("stale-head") },
        { approvedDeactivationPlanDigest: syntheticDigest("wrong-deactivation-plan") },
        { expectedSuccessorVersion: "0.3.0" },
        { expectedReleaseDigest: syntheticDigest("wrong-release") },
        { expectedTarballDigest: syntheticDigest("wrong-tarball") },
        { expectedVerifierDigest: syntheticDigest("wrong-verifier") },
      ];
      for (const overrides of negativeCases) {
        const rejected = await primary.cli(primary.continuationArgs(overrides));
        assert.equal(rejected.code, 1);
        assert.match(
          `${rejected.stdout}${rejected.stderr}`,
          /AGENTMO_CODEX_UAT_CONTINUATION_REJECTED/u,
        );
        assert.equal(`${rejected.stdout}${rejected.stderr}`.includes(fixture.root), false);
        assert.deepEqual(await snapshotSyntheticAttempt(primary.attemptDir), before);
        assert.deepEqual(await readFile(primary.receiptPath), primary.receiptBytes);
        assert.deepEqual(await readFile(launcherPath), launcherBefore);
      }

      for (const [name, verifierSourcePath] of [
        ["legacy", "src/builder-codex-uat-verifier.js"],
        ["other", "scripts/other-verifier.js"],
        ["nested", "scripts/nested/verify-codex-uat-candidate.js"],
        ["prefix", "scripts/verify-codex-uat-candidate.js.extra"],
      ]) {
        const hostileRoot = path.join(fixture.root, `hostile-verifier-path-${name}`);
        await cp(fixture.packageRoot, hostileRoot, { recursive: true });
        const manifestPath = path.join(
          hostileRoot,
          "src",
          "builder-codex-uat-release-manifest.json",
        );
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        manifest.verifier.sourcePath = verifierSourcePath;
        await writeFile(manifestPath, serializePersistableJson(manifest, {
          subject: "builder-codex-uat-release-manifest",
        }), "utf8");
        const rejected = await runPackageCli(hostileRoot, primary.continuationArgs(), {
          cwd: primary.project,
          home: primary.home,
          bin,
        });
        assert.equal(rejected.code, 1, name);
        assert.match(
          `${rejected.stdout}${rejected.stderr}`,
          /AGENTMO_CODEX_UAT_CONTINUATION_REJECTED/u,
          name,
        );
        assert.deepEqual(await snapshotSyntheticAttempt(primary.attemptDir), before, name);
        assert.deepEqual(await readFile(primary.receiptPath), primary.receiptBytes, name);
        assert.deepEqual(await readFile(launcherPath), launcherBefore, name);
      }

      const decoyTarball = path.join(fixture.root, "decoy-successor.tgz");
      await writeFile(decoyTarball, "not the admitted synthetic tarball\n", "utf8");
      const wrongTarball = await primary.cli(primary.continuationArgs({
        successorTarball: decoyTarball,
      }));
      assert.equal(wrongTarball.code, 1);
      assert.deepEqual(await snapshotSyntheticAttempt(primary.attemptDir), before);
      assert.deepEqual(await readFile(primary.receiptPath), primary.receiptBytes);

      const wrongRoleTarball = await primary.cli(primary.continuationArgs({
        successorTarball: fixture.baselineTarball,
      }));
      assert.equal(wrongRoleTarball.code, 1);
      assert.match(
        `${wrongRoleTarball.stdout}${wrongRoleTarball.stderr}`,
        /AGENTMO_CODEX_UAT_CONTINUATION_REJECTED/u,
      );
      assert.deepEqual(await snapshotSyntheticAttempt(primary.attemptDir), before);
      assert.deepEqual(await readFile(primary.receiptPath), primary.receiptBytes);

      const tamperedRoot = path.join(fixture.root, "tampered-extract");
      await cp(fixture.packageRoot, tamperedRoot, { recursive: true });
      const tamperedContinuation = path.join(tamperedRoot, "src", "builder-codex-uat-continuation.js");
      await writeFile(
        tamperedContinuation,
        `${await readFile(tamperedContinuation, "utf8")}\n// synthetic digest mismatch\n`,
        "utf8",
      );
      const tamperedRun = await runPackageCli(tamperedRoot, primary.continuationArgs(), {
        cwd: primary.project,
        home: primary.home,
        bin,
      });
      assert.equal(tamperedRun.code, 1);
      assert.match(`${tamperedRun.stdout}${tamperedRun.stderr}`, /AGENTMO_CODEX_UAT_CONTINUATION_REJECTED/u);
      assert.deepEqual(await snapshotSyntheticAttempt(primary.attemptDir), before);
      assert.deepEqual(await readFile(primary.receiptPath), primary.receiptBytes);

      const continued = await primary.cli(primary.continuationArgs());
      assert.equal(continued.code, 0, `${continued.stdout}${continued.stderr}`);
      assert.equal(continued.stderr, "");
      const output = JSON.parse(continued.stdout);
      assert.deepEqual({
        action: output.action,
        status: output.status,
        phase: output.phase,
        packageName: output.packageName,
        version: output.version,
        releaseDigest: output.releaseDigest,
        tarballDigest: output.tarballDigest,
        continuationDigest: output.continuationDigest,
        manifestDigest: output.manifestDigest,
        verifierDigest: output.verifierDigest,
      }, {
        action: "continue",
        status: "continued",
        phase: "candidate-ready",
        packageName: "agentmo",
        version: "0.2.0",
        releaseDigest: fixture.release.releaseDigest,
        tarballDigest: fixture.tarballDigest,
        continuationDigest: fixture.continuationDigest,
        manifestDigest: fixture.releaseManifestDigest,
        verifierDigest: fixture.verifierDigest,
      });
      for (const key of [
        "realCodexSessionVerified",
        "agentPackageQualityCertified",
        "domainQualityCertified",
        "productionReady",
        "widerCompatibilityCertified",
      ]) assert.equal(output[key], false, key);
      assert.equal(continued.stdout.includes(fixture.root), false);
      assert.deepEqual(await readFile(primary.receiptPath), primary.receiptBytes);
      assert.deepEqual(await readFile(launcherPath), launcherBefore);
      const receiptIdentityAfter = await stat(primary.receiptPath, { bigint: true });
      const launcherIdentityAfter = await stat(launcherPath, { bigint: true });
      assert.deepEqual(
        [receiptIdentityAfter.dev, receiptIdentityAfter.ino, receiptIdentityAfter.nlink],
        [receiptIdentityBefore.dev, receiptIdentityBefore.ino, receiptIdentityBefore.nlink],
      );
      assert.deepEqual(
        [launcherIdentityAfter.dev, launcherIdentityAfter.ino, launcherIdentityAfter.nlink],
        [launcherIdentityBefore.dev, launcherIdentityBefore.ino, launcherIdentityBefore.nlink],
      );
      const completed = await fixture.uatModule.loadCodexUatAttemptJournal(primary.journalPath);
      assert.equal(completed.state.phase, "candidate-ready");
      assert.equal(completed.entries.at(-2).details.scenario, "deactivation-tombstone-visibility");
      assert.equal(completed.entries.at(-1).kind, "candidate-ready");
      assert.equal(completed.entries.at(-1).details.candidateDigest, output.candidateDigest);
      assert.equal((await publishedContentLeaves(primary.candidateDirectory)).length, 1);
      assert.equal((await publishedContentLeaves(primary.observationDirectory)).length, 11);
      const candidate = JSON.parse(await readFile(
        path.join(primary.candidateDirectory, (await publishedContentLeaves(primary.candidateDirectory))[0]),
        "utf8",
      ));
      const candidateBasisDigest = digestRawBytes(Buffer.from(serializePersistableJson({
        schemaVersion: "agentmo.codex-uat-ordered-evidence.v1",
        entries: completed.entries.slice(0, -1).map((entry) => ({
          sequence: entry.sequence,
          kind: entry.kind,
          scenario: entry.kind === "scenario-observed" ? entry.details.scenario : null,
          evidenceDigests: entry.evidenceDigests,
        })),
      }, { subject: "builder-codex-uat-ordered-evidence" }), "utf8"));
      assert.equal(candidate.orderedEvidenceDigest, candidateBasisDigest);
      assert.notEqual(candidate.orderedEvidenceDigest, completed.state.orderedEvidenceDigest);
      assert.equal(candidate.scenarioCount, 11);
      assert.equal(candidate.humanAdmissionRequired, true);
      assert.doesNotMatch(JSON.stringify(candidate), /journal.*head|predecessor/iu);

      const afterComplete = await snapshotSyntheticAttempt(primary.attemptDir);
      const duplicate = await primary.cli(primary.continuationArgs({
        expectedHeadDigest: completed.head.digest,
      }));
      assert.equal(duplicate.code, 0, `${duplicate.stdout}${duplicate.stderr}`);
      assert.equal(duplicate.stdout, continued.stdout);
      assert.deepEqual(await snapshotSyntheticAttempt(primary.attemptDir), afterComplete);

      const notPrestarted = await createSyntheticContinuationCase(fixture, bin, "not-prestarted");
      const uninstallApply = await notPrestarted.cli([
        "builder", "uninstall", "--project", notPrestarted.project,
        "--digest", `builder-install-receipt=${notPrestarted.receiptDigest}`,
        "--apply", "--plan-digest", notPrestarted.uninstallPlan.planDigest,
        "--json",
      ]);
      assert.equal(uninstallApply.code, 0, `${uninstallApply.stdout}${uninstallApply.stderr}`);
      const beforeLateStart = await snapshotSyntheticAttempt(notPrestarted.attemptDir);
      const lateStart = await notPrestarted.cli(notPrestarted.continuationArgs());
      assert.equal(lateStart.code, 1);
      assert.deepEqual(await snapshotSyntheticAttempt(notPrestarted.attemptDir), beforeLateStart);
      assert.equal((await publishedContentLeaves(notPrestarted.candidateDirectory)).length, 0);
      assert.equal((await publishedContentLeaves(notPrestarted.observationDirectory)).length, 10);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
      await absent(fixture.root);
    }
  });

  it("persists the packed continuation fence before tombstone evidence and converges exactly", async () => {
    const fixture = await createSyntheticContinuationFixture();
    try {
      const bin = await fakeCodexBin(fixture.root);
      const recovery = await createSyntheticContinuationCase(
        fixture,
        bin,
        "protocol-fence-recovery",
      );
      const continued = await recovery.cli(recovery.continuationArgs());
      assert.equal(continued.code, 0, `${continued.stdout}${continued.stderr}`);
      const output = JSON.parse(continued.stdout);
      assert.equal(output.status, "continued");
      assert.equal(output.phase, "candidate-ready");

      const lifecycle = await import(
        `${pathToFileURL(path.join(fixture.packageRoot, "src", "builder-lifecycle.js")).href}?fenced=${Date.now()}`
      );
      const lifecycleState = await lifecycle.readBuilderLifecycleState({
        projectRoot: recovery.project,
      });
      assert.equal(lifecycleState.status, "deactivated");
      assert.equal(lifecycleState.tombstones.length, 1);

      const checkpointJournal = await fixture.immutableJournalModule.loadImmutableJournal({
        journalPath: recovery.checkpointPath,
      });
      assert.equal(checkpointJournal.head.sequence, recovery.checkpointSequence + 2);
      const protocolStates = checkpointJournal.entries.slice(-2).map((entry) => JSON.parse(
        new TextDecoder("utf8", { fatal: true }).decode(
          fixture.immutableJournalModule.readImmutableJournalAdmissionBytes(entry),
        ),
      ).hookDeactivationProtocol.state);
      assert.deepEqual(protocolStates, [
        "deactivation-fenced",
        "deactivation-fenced",
      ]);
      const finalCheckpoint = await fixture.checkpointModule.loadBuilderCheckpoint(
        recovery.checkpointPath,
        { expectedDigest: checkpointJournal.head.digest },
      );
      assert.equal(
        finalCheckpoint.value.codexUatChallenge.scenario,
        "deactivation-tombstone-visibility",
      );
      assert.equal((await publishedContentLeaves(recovery.observationDirectory)).length, 11);
      assert.equal((await publishedContentLeaves(recovery.candidateDirectory)).length, 1);

      const stable = await snapshotSyntheticAttempt(recovery.attemptDir);
      const duplicate = await recovery.cli(recovery.continuationArgs());
      assert.equal(duplicate.code, 0, `${duplicate.stdout}${duplicate.stderr}`);
      assert.equal(duplicate.stdout, continued.stdout);
      assert.deepEqual(await snapshotSyntheticAttempt(recovery.attemptDir), stable);
      const convergedView = await fixture.uatModule.loadCodexUatAttemptJournal(
        recovery.journalPath,
      );
      assert.equal(convergedView.entries.filter((entry) => (
        entry.kind === "scenario-observed"
        && entry.details.scenario === "deactivation-tombstone-visibility"
      )).length, 1);
      assert.equal(
        convergedView.entries.filter((entry) => entry.kind === "candidate-ready").length,
        1,
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
      await absent(fixture.root);
    }
  });

  it("installs exact plugin, skill, hook, agent, marketplace, marker, and receipt bytes without a checkout", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-clean-project-"));
    const project = path.join(root, "project");
    const home = path.join(root, "home");
    const stateRoot = path.join(home, ".agentmo", "builder", "codex-host");
    await Promise.all([mkdir(project), mkdir(home, { mode: 0o700 })]);
    const bin = await fakeCodexBin(root);
    const installed = await runPackedInstallChild({ project, home, bin });
    assert.equal(installed.code, 0, `${installed.stdout}${installed.stderr}`);
    assert.equal(installed.value.ok, true);
    const { preview, applied } = installed.value;
    assert.equal(preview.schemaVersion, "agentmo.builder-install-plan.v1");
    assert.equal(preview.scope, "project");
    assert.equal(preview.requiresExplicitApply, true);
    assert.equal(preview.applicable, true);
    assert.equal(preview.operations.at(-1).relativePath, RECEIPT_PATH);
    assert.equal(preview.operations.every((operation) => operation.currentStatus === "create"), true);
    const operationPaths = preview.operations.map((operation) => operation.relativePath);
    assert.equal(operationPaths.at(-1), RECEIPT_PATH);
    assert.deepEqual(operationPaths.slice(0, -1), operationPaths.slice(0, -1).toSorted());
    assert.equal(operationPaths.length, 3);
    assert.deepEqual(operationPaths, [
      ".agentmo/builder/install-marker.json",
      ".codex/agents/agentmo.toml",
      RECEIPT_PATH,
    ]);

    assert.equal(applied.status, "activated");
    assert.equal(applied.changed, true);
    assert.equal(applied.planDigest, preview.planDigest);
    assert.equal(applied.evidence.level, "host-observed");
    assert.equal(applied.evidence.codexActivationVerified, false);
    assert.equal(applied.evidence.hostBehaviorVerified, false);
    assert.equal(applied.evidence.domainQualityCertified, false);

    const receiptBytes = await readFile(path.join(project, RECEIPT_PATH));
    const receipt = JSON.parse(receiptBytes);
    assertActivatedReceiptBinding(receipt);
    assert.equal(receipt.evidence.codexActivationVerified, false);
    assert.equal(receipt.evidence.hostBehaviorVerified, false);
    assert.equal(receipt.identity.releaseDigest, preview.release.digest);
    assert.equal(receipt.capabilitySnapshot.digest, preview.capabilityDigest);
    assert.equal(receipt.files.length, 2);
    assert.equal(JSON.stringify(receipt).includes(REPO_ROOT), false);
    assert.equal(JSON.stringify(receipt).includes(packedPackageRoot), false);
    for (const entry of receipt.files) {
      assert.match(entry.relativePath, /^(?!\/)(?!.*\.\.)(?:[^\\]+)$/u);
      assert.match(entry.sourceDigest, /^sha256:[a-f0-9]{64}$/u);
      assert.match(entry.destinationDigest, /^sha256:[a-f0-9]{64}$/u);
      await stat(path.join(project, ...entry.relativePath.split("/")));
    }
    const marketplaceRoot = path.join(stateRoot, "marketplace", "agentmo-local");
    assert.deepEqual(
      await readFile(path.join(marketplaceRoot, "plugins/agentmo/.codex-plugin/plugin.json")),
      await readFile(path.join(packedPackageRoot, "plugin/.codex-plugin/plugin.json")),
    );
    assert.deepEqual(
      await readFile(path.join(project, ".codex/agents/agentmo.toml")),
      await readFile(path.join(packedPackageRoot, "plugin/agents/agentmo.toml")),
    );
    for (const asset of (await packedPackage.loadBuilderPackage()).assets.filter((item) => item.kind === "runtime")) {
      assert.deepEqual(
        await readFile(path.join(marketplaceRoot, ...asset.destinationPath.split("/"))),
        await readFile(path.join(packedPackageRoot, ...asset.sourcePath.split("/"))),
      );
    }
    const installedSkill = await readFile(path.join(marketplaceRoot, "plugins/agentmo/skills/agentmo/SKILL.md"), "utf8");
    assert.match(installedSkill, /node \.\/plugins\/agentmo\/runtime\/agentmo\/bin\/agentmo\.js builder probe --json/u);
    assert.equal(/(^|\s)agentmo builder/u.test(installedSkill), false);

    const repeatedRun = await runPackedInstallChild({
      project,
      home,
      bin,
      expectedPriorReceiptDigest: applied.receipt.digest,
    });
    assert.equal(repeatedRun.code, 0, `${repeatedRun.stdout}${repeatedRun.stderr}`);
    const { preview: repeatedPreview, applied: repeated } = repeatedRun.value;
    assert.notEqual(repeatedPreview.planDigest, preview.planDigest);
    assert.equal(repeatedPreview.operations.every((operation) => operation.currentStatus === "unchanged"), true);
    assert.equal(repeated.changed, false);
    assert.equal(repeated.receipt.digest, applied.receipt.digest);
    assert.deepEqual(await readFile(path.join(project, RECEIPT_PATH)), receiptBytes);

  });

  it("supersedes a receiptless packed projection and converges without physical deletion", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-packed-install-recovery-"));
    const project = path.join(root, "project");
    const home = path.join(root, "home");
    await Promise.all([mkdir(project), mkdir(home, { mode: 0o700 })]);
    await mkdir(path.join(home, ".codex"), { mode: 0o700 });
    const bin = await fakeCodexBin(root);
    const previewRun = await runPackedInstallChild({
      project,
      home,
      bin,
      action: "plan",
    });
    assert.equal(previewRun.code, 0, `${previewRun.stdout}${previewRun.stderr}`);
    assert.equal(previewRun.value.ok, true);
    const running = startPackedInstallChild({
      project,
      home,
      bin,
      action: "apply",
      expectedPlanDigest: previewRun.value.preview.planDigest,
    });
    try {
      await waitForObservation(
        running,
        "durable prepared packed install",
        async () => {
          const entriesDirectory = path.join(
            project,
            ".agentmo-install-attempt-authority",
            "entries",
          );
          let names;
          try {
            names = (await readdir(entriesDirectory))
              .filter((name) => /^\d{16}\.[a-f0-9]{64}\.json$/u.test(name))
              .toSorted();
          } catch (error) {
            if (error?.code === "ENOENT") return null;
            throw error;
          }
          const latestName = names.at(-1);
          if (latestName === undefined) return null;
          const latest = JSON.parse(await readFile(
            path.join(entriesDirectory, latestName),
            "utf8",
          ));
          try {
            await stat(path.join(project, ".agentmo/builder/install-marker.json"));
          } catch (error) {
            if (error?.code === "ENOENT") return null;
            throw error;
          }
          return latest.payload?.disposition === "prepared" ? latest.payload : null;
        },
        60_000,
      );
    } catch (error) {
      if (running.child.exitCode === null && running.child.signalCode === null) {
        running.child.kill("SIGKILL");
        await running.exited;
      }
      throw error;
    }
    assert.equal(running.child.kill("SIGKILL"), true);
    const interrupted = await running.exited;
    assert.equal(interrupted.signal, "SIGKILL", interrupted.stderr);
    await absent(path.join(project, RECEIPT_PATH));
    const recoveryBefore = await snapshotSyntheticAttempt(project);

    const inspected = await runPackedCli([
      "builder", "recover", "inspect", "--project", project, "--json",
    ], bin, home);
    assert.equal(inspected.code, 0, `${inspected.stdout}${inspected.stderr}`);
    const inspection = JSON.parse(inspected.stdout);
    assert.equal(inspection.status, "prepared");
    assert.equal(inspection.attempt.schemaVersion, "agentmo.builder-install-attempt.v2");
    assert.equal(
      inspection.attempt.hostReservation.bindingDigest,
      previewRun.value.preview.planDigest,
    );
    assert.match(inspection.authorityDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.deepEqual(await snapshotSyntheticAttempt(project), recoveryBefore);

    const planned = await runPackedCli([
      "builder", "recover", "preview", "--project", project, "--json",
    ], bin, home);
    assert.equal(planned.code, 0, `${planned.stdout}${planned.stderr}`);
    const recoveryPlan = JSON.parse(planned.stdout);
    assert.equal(recoveryPlan.status, "ready");
    assert.equal(recoveryPlan.applicable, true);
    assert.equal(recoveryPlan.operations[0].operation, "close-exact-host-reservation");
    assert.equal(recoveryPlan.operations.at(-1).operation, "append-superseded-outcome");
    assert.match(recoveryPlan.planDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.deepEqual(await snapshotSyntheticAttempt(project), recoveryBefore);

    const applied = await runPackedCli([
      "builder", "recover", "apply", "--project", project,
      "--plan-digest", recoveryPlan.planDigest, "--json",
    ], bin, home);
    assert.equal(applied.code, 0, `${applied.stdout}${applied.stderr}`);
    const recoveryResult = JSON.parse(applied.stdout);
    assert.equal(recoveryResult.status, "superseded");
    assert.equal(recoveryResult.physicalDeletion, false);
    assert.equal(recoveryResult.newSetupAllowed, true);
    const afterRecovery = await snapshotSyntheticAttempt(project);
    assert.equal(
      recoveryBefore.every(([relativePath, digest]) => afterRecovery.some(
        ([afterPath, afterDigest]) => afterPath === relativePath && afterDigest === digest,
      )),
      true,
    );
    const probe = compatibleProbe();
    const retryPlan = await packedInstall.planBuilderInstall({ projectRoot: project, probe });
    const retry = await packedInstall.applyBuilderInstall({
      projectRoot: project,
      probe,
      expectedPlanDigest: retryPlan.planDigest,
    });
    assert.equal(retry.status, "projected");
    assert.equal(
      (await packedInstall.inspectBuilderInstallRecovery({ projectRoot: project })).status,
      "committed",
    );
    assert.equal(
      digestRawBytes(await readFile(path.join(project, RECEIPT_PATH))),
      retry.receipt.digest,
    );
    const afterRetry = await snapshotSyntheticAttempt(project);
    assert.equal(
      recoveryBefore.every(([relativePath, digest]) => afterRetry.some(
        ([afterPath, afterDigest]) => afterPath === relativePath && afterDigest === digest,
      )),
      true,
    );
    assert.equal(
      `${inspected.stdout}${planned.stdout}${applied.stdout}`.includes(REPO_ROOT),
      false,
    );
    assert.equal(
      `${inspected.stdout}${planned.stdout}${applied.stdout}`.includes(packedPackageRoot),
      false,
    );
  });

  it("refuses packed projected-receipt replacement without changing receipt or host state", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-packed-receipt-recovery-"));
    const project = path.join(root, "project");
    const home = path.join(root, "home");
    const stateRoot = path.join(home, ".agentmo", "builder", "codex-host");
    await Promise.all([mkdir(project), mkdir(home, { mode: 0o700 })]);
    await mkdir(stateRoot, { recursive: true, mode: 0o700 });
    const bin = await fakeCodexBin(root);
    const probe = compatibleProbe();
    const projectedPreview = await packedInstall.planBuilderInstall({ projectRoot: project, probe });
    const projected = await packedInstall.applyBuilderInstall({
      projectRoot: project,
      probe,
      expectedPlanDigest: projectedPreview.planDigest,
    });
    const receiptPath = path.join(project, RECEIPT_PATH);
    const priorBytes = await readFile(receiptPath);
    const priorIdentity = await stat(receiptPath, { bigint: true });
    const rejected = await runPackedInstallChild({
      project,
      home,
      bin,
      expectedPriorReceiptDigest: projected.receipt.digest,
      action: "plan",
    });
    assert.notEqual(rejected.code, 0);
    assert.equal(rejected.value?.ok, false);
    assert.equal(
      rejected.value?.code,
      "AGENTMO_BUILDER_INSTALL_IMMUTABLE_SUCCESSOR_REQUIRED",
    );
    const afterIdentity = await stat(receiptPath, { bigint: true });
    assert.equal(afterIdentity.dev, priorIdentity.dev);
    assert.equal(afterIdentity.ino, priorIdentity.ino);
    assert.equal(afterIdentity.nlink, priorIdentity.nlink);
    assert.deepEqual(await readFile(receiptPath), priorBytes);
    assert.deepEqual(await readdir(stateRoot), []);
    await absent(path.join(home, ".fake-codex-installed.json"));
  });

  it("traverses registered packed hooks through the adjacent launcher, bridge, reducer, and checkpoint CAS", {
    skip: process.env.AGENTMO_TEST_LANE === "main"
      ? "runs in the isolated packed-hook-chain lane"
      : false,
  }, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-packed-hook-chain-"));
    const project = path.join(root, "project");
    const home = path.join(root, "home");
    const stateRoot = path.join(home, ".agentmo", "builder", "codex-host");
    await Promise.all([mkdir(project), mkdir(home, { mode: 0o700 })]);
    const bin = await fakeCodexBin(root);
    const evidenceRoot = path.join(root, "uat-evidence");
    const releaseDirectory = path.join(evidenceRoot, "releases");
    await mkdir(evidenceRoot, { mode: 0o700 });
    const baselineVersion = "0.1.0";
    const successorVersion = "0.1.1-uat.18";
    const builtRelease = await runUatReleaseBuilder(
      releaseDirectory,
      baselineVersion,
      successorVersion,
    );
    assert.equal(builtRelease.code, 0, builtRelease.stderr);
    const releaseIdentity = JSON.parse(builtRelease.stdout);
    const baselineTarball = path.join(releaseDirectory, `agentmo-${baselineVersion}.tgz`);
    const successorTarball = path.join(releaseDirectory, `agentmo-${successorVersion}.tgz`);
    const baselinePackage = await extractExactTarball(
      baselineTarball,
      path.join(evidenceRoot, "baseline-package"),
    );
    const successorPackage = await extractExactTarball(
      successorTarball,
      path.join(evidenceRoot, "successor-package"),
    );
    assert.equal(
      digestRawBytes(await readFile(baselineTarball)),
      releaseIdentity.baseline.tarballDigest,
    );
    assert.equal(
      digestRawBytes(await readFile(successorTarball)),
      releaseIdentity.successor.tarballDigest,
    );
    const installed = await runPackedInstallChild({
      project,
      home,
      bin,
      installPackageRoot: baselinePackage,
    });
    assert.equal(installed.code, 0, `${installed.stdout}${installed.stderr}`);
    const { applied } = installed.value;
    const checkpointPath = path.join(project, ".agentmo", "checkpoints", "builder.json");
    const initial = packedCheckpoint.buildBuilderCheckpoint({
      workflowId: "workflow-packed-hook-1",
      adapterId: "codex",
      stage: "plan",
      boundary: "approval-required",
      artifactRefs: [{
        subject: "design-plan",
        path: ".agentmo/design-plan.json",
        digest: `sha256:${"1".repeat(64)}`,
      }],
      pendingDecision: {
        id: "decision-packed-hook-1",
        kind: "approval",
        summaryDigest: `sha256:${"2".repeat(64)}`,
      },
      nextAction: "await-approval",
      installReceiptDigest: applied.receipt.digest,
      capabilitySnapshot: {
        adapterId: "codex",
        evidenceLevel: "observed",
        digest: `sha256:${"3".repeat(64)}`,
        required: [{ id: "native-hooks", status: "observed" }],
      },
      eventLedger: { cursor: 0, recentEvents: [] },
      pauseReason: "approval-required",
    });
    await mkdir(path.dirname(checkpointPath), { recursive: true });
    const initialWrite = await packedCheckpoint.writeBuilderCheckpoint(checkpointPath, initial);
    const initialAdmission = await packedCheckpoint.loadBuilderCheckpoint(checkpointPath, {
      expectedDigest: initialWrite.digest,
    });
    const installedReceipt = JSON.parse(await readFile(path.join(project, RECEIPT_PATH), "utf8"));
    const pluginRoot = path.join(stateRoot, "marketplace", "agentmo-local", "plugins", "agentmo");
    const launcherPath = path.join(pluginRoot, "runtime", "agentmo", "bin", "agentmo.js");
    const attemptJournalPath = path.join(root, "packed-uat-attempt.journal");
    const exactDigest = (label) => digestRawBytes(Buffer.from(`${label}\n`, "utf8"));
    const request = async (name, transition, details) => {
      const filePath = path.join(root, `${name}.request.json`);
      const bytes = Buffer.from(serializePersistableJson({
        schemaVersion: "agentmo.codex-uat-record-request.v1",
        transition,
        details,
      }, { subject: "builder-codex-uat-record-request" }), "utf8");
      await writeFile(filePath, bytes, { flag: "wx", mode: 0o600 });
      return { filePath, digest: digestRawBytes(bytes) };
    };
    const invokeUat = async (args) => {
      const execution = await execFileAsync(process.execPath, [launcherPath, ...args], {
        cwd: project,
        encoding: "utf8",
        env: {
          HOME: home,
          CODEX_HOME: path.join(home, ".codex"),
          LANG: "C",
          PATH: path.dirname(process.execPath),
        },
      });
      assert.equal(execution.stderr, "");
      return JSON.parse(execution.stdout);
    };
    const startRequest = await request("start", "attempt-started", {
      baseline: {
        packageRoot: path.relative(root, baselinePackage),
        tarballPath: path.relative(root, baselineTarball),
      },
      successor: {
        packageRoot: path.relative(root, successorPackage),
        tarballPath: path.relative(root, successorTarball),
      },
    });
    let uat = await invokeUat([
      "builder", "codex-uat", "start",
      "--journal", attemptJournalPath,
      "--attempt-id", "attempt-packed-hook-001",
      "--request", startRequest.filePath,
      "--digest", `builder-codex-uat-record-request=${startRequest.digest}`,
      "--json",
    ]);
    const record = async (recordRequest, extra = []) => invokeUat([
      "builder", "codex-uat", "record",
      "--journal", attemptJournalPath,
      "--expected-head-sha256", uat.headDigest,
      "--request", recordRequest.filePath,
      "--digest", `builder-codex-uat-record-request=${recordRequest.digest}`,
      ...extra,
      "--json",
    ]);
    uat = await record(await request("setup", "setup-applied", {
      installReceiptPath: "project/.agentmo/builder/install-receipt.json",
      expectedInstallReceiptDigest: applied.receipt.digest,
    }), [
      "--checkpoint", checkpointPath,
      "--digest", `builder-checkpoint=${initialAdmission.digest}`,
    ]);
    const hostObservationPath = path.join(root, "host-observation.evidence");
    const hostObservationBytes = Buffer.from("bounded host observation\n");
    await writeFile(hostObservationPath, hostObservationBytes, { flag: "wx", mode: 0o600 });
    uat = await record(await request("activation", "activation-applied", {
      installReceiptPath: "project/.agentmo/builder/install-receipt.json",
      expectedInstallReceiptDigest: applied.receipt.digest,
      hostObservationPath: "host-observation.evidence",
      expectedHostObservationDigest: digestRawBytes(hostObservationBytes),
    }), [
      "--checkpoint", checkpointPath,
      "--digest", `builder-checkpoint=${initialAdmission.digest}`,
    ]);
    assert.equal(uat.nextAction, "start-fresh-codex");
    const trustRefs = {};
    for (const label of ["fresh-process", "trust", "auth"]) {
      const fileName = `${label}.evidence`;
      const bytes = Buffer.from(`${label}\n`);
      await writeFile(path.join(root, fileName), bytes, { flag: "wx", mode: 0o600 });
      trustRefs[label] = { fileName, digest: digestRawBytes(bytes) };
    }
    uat = await record(await request("trust", "trust-auth-observed", {
      freshProcessEvidencePath: trustRefs["fresh-process"].fileName,
      expectedFreshProcessDigest: trustRefs["fresh-process"].digest,
      trustObservationPath: trustRefs.trust.fileName,
      expectedTrustObservationDigest: trustRefs.trust.digest,
      authObservationPath: trustRefs.auth.fileName,
      expectedAuthObservationDigest: trustRefs.auth.digest,
    }));
    assert.equal(uat.nextScenario, "session-start");
    const armed = await invokeUat([
      "builder", "codex-uat", "scenario-arm",
      "--journal", attemptJournalPath,
      "--expected-head-sha256", uat.headDigest,
      "--checkpoint", checkpointPath,
      "--digest", `builder-checkpoint=${initialAdmission.digest}`,
      "--json",
    ]);
    assert.match(armed.correlation, /^opaque:[a-f0-9]{64}$/u);
    assert.equal(armed.correlation.includes(uat.headDigest.slice("sha256:".length)), false);
    const armedAdmission = await packedCheckpoint.loadBuilderCheckpoint(checkpointPath, {
      expectedDigest: armed.checkpointDigest,
    });
    const authorityBefore = {
      workflowId: armedAdmission.value.workflowId,
      adapterId: armedAdmission.value.adapterId,
      stage: armedAdmission.value.stage,
      artifactRefs: armedAdmission.value.artifactRefs,
      pendingDecision: armedAdmission.value.pendingDecision,
      nextAction: armedAdmission.value.nextAction,
      installReceiptDigest: armedAdmission.value.installReceiptDigest,
      capabilitySnapshot: armedAdmission.value.capabilitySnapshot,
    };
    const runnerPath = path.join(pluginRoot, "hooks", "agentmo-hook.js");
    const hooks = JSON.parse(await readFile(path.join(pluginRoot, "hooks", "hooks.json"), "utf8"));
    for (const eventName of ["SessionStart", "PreCompact", "PostCompact"]) {
      assert.equal(
        hooks.hooks[eventName][0].hooks[0].command,
        "node \"${PLUGIN_ROOT}/hooks/agentmo-hook.js\"",
      );
    }

    const sessionInput = {
      hook_event_name: "SessionStart",
      session_id: "packed-chain-session",
      source: "resume",
      project: "/private/tmp/attacker-project",
      workflowId: "attacker-workflow",
      stage: "produce",
      nextAction: "complete",
      approval: true,
      transcript_path: "/private/tmp/SECRET_TRANSCRIPT",
      output: "SECRET_OUTPUT_CANARY",
    };
    const childOptions = {
      cwd: project,
      env: { HOME: home, CODEX_HOME: path.join(home, ".codex") },
      timeoutMs: 35_000,
    };
    const session = await runNode(runnerPath, JSON.stringify(sessionInput), childOptions);
    assert.equal(session.code, 0, session.stderr);
    assert.equal(session.stderr, "");
    const sessionOutput = JSON.parse(session.stdout);
    assert.equal(sessionOutput.hookSpecificOutput.hookEventName, "SessionStart");
    assert.match(sessionOutput.hookSpecificOutput.additionalContext, /resumable at plan/u);
    assert.equal(session.stdout.includes(project), false);
    assert.equal(session.stdout.includes("SECRET"), false);

    const sessionHead = (await packedJournal.loadImmutableJournal({
      journalPath: checkpointPath,
      maxValueBytes: packedCheckpoint.DEFAULT_MAX_BUILDER_CHECKPOINT_BYTES,
    })).head;
    assert.notEqual(sessionHead, null);
    const sessionAdmission = await packedCheckpoint.loadBuilderCheckpoint(checkpointPath, {
      expectedDigest: sessionHead.digest,
    });
    assert.deepEqual({
      workflowId: sessionAdmission.value.workflowId,
      adapterId: sessionAdmission.value.adapterId,
      stage: sessionAdmission.value.stage,
      artifactRefs: sessionAdmission.value.artifactRefs,
      pendingDecision: sessionAdmission.value.pendingDecision,
      nextAction: sessionAdmission.value.nextAction,
      installReceiptDigest: sessionAdmission.value.installReceiptDigest,
      capabilitySnapshot: sessionAdmission.value.capabilitySnapshot,
    }, authorityBefore);
    assert.equal(sessionAdmission.value.boundary, "session-restart");
    assert.deepEqual(sessionAdmission.value.codexUatChallenge, {
      attemptId: "attempt-packed-hook-001",
      scenario: "session-start",
      correlation: armed.correlation,
    });
    assert.doesNotMatch(
      JSON.stringify(sessionAdmission.value.codexUatChallenge),
      /journal.*head|predecessor|observation/iu,
    );
    const observationDirectory = path.join(path.dirname(checkpointPath), "uat-observations");
    const observationNames = await publishedContentLeaves(observationDirectory);
    assert.equal(observationNames.length, 1);
    const observationPath = path.join(observationDirectory, observationNames[0]);
    const observationBytes = await readFile(observationPath);
    const observationDigest = digestRawBytes(observationBytes);
    const retainedObservationNames = (await readdir(observationDirectory))
      .filter((name) => name.startsWith(
        `.agentmo-uat-leaf-${observationDigest.slice("sha256:".length)}-`,
      ) && name.endsWith(".stage"));
    assert.equal(retainedObservationNames.length, 1);
    const retainedObservationPath = path.join(
      observationDirectory,
      retainedObservationNames[0],
    );
    const [observationIdentity, retainedObservationIdentity] = await Promise.all([
      stat(observationPath, { bigint: true }),
      stat(retainedObservationPath, { bigint: true }),
    ]);
    assert.equal(observationIdentity.dev, retainedObservationIdentity.dev);
    assert.equal(observationIdentity.ino, retainedObservationIdentity.ino);
    assert.equal(observationIdentity.nlink, 2n);
    assert.equal(retainedObservationIdentity.nlink, 2n);
    const observationAdmission = await packedCodexUat.loadCodexUatObservationLeaf(
      observationPath,
      { expectedDigest: observationDigest },
    );
    assert.equal(observationAdmission.value.correlation, armed.correlation);
    assert.equal(observationAdmission.value.source, "installed-hook-untrusted");
    for (const key of [
      "claimsHostOrigin",
      "claimsScenarioSuccess",
      "realCodexSessionVerified",
      "agentPackageQualityCertified",
      "domainQualityCertified",
      "productionReady",
      "widerCompatibilityCertified",
    ]) assert.equal(observationAdmission.value[key], false, key);
    assert.doesNotMatch(JSON.stringify(observationAdmission.value), /journal.*head|predecessor/iu);

    const checkpointBeforeActiveReplay = await checkpointJournalSnapshot(checkpointPath);
    const observationNamesBeforeReplay = await readdir(observationDirectory);
    const observationBytesBeforeReplay = await readFile(observationPath);
    const activeReplay = await runNode(
      runnerPath,
      JSON.stringify(sessionInput),
      childOptions,
    );
    assert.equal(activeReplay.code, 0, activeReplay.stderr);
    assert.equal(activeReplay.stdout, "{}\n");
    assert.equal(activeReplay.stderr, "");
    assert.deepEqual(
      await checkpointJournalSnapshot(checkpointPath),
      checkpointBeforeActiveReplay,
    );
    assert.deepEqual(await readdir(observationDirectory), observationNamesBeforeReplay);
    assert.deepEqual(await readFile(observationPath), observationBytesBeforeReplay);
    assert.equal((await stat(observationPath, { bigint: true })).nlink, 2n);

    const scenarioRequest = await request("session-start", "scenario-observed", {
      hookEventDigest: observationAdmission.value.eventDigest,
    });
    uat = await record(scenarioRequest, [
      "--checkpoint", checkpointPath,
      "--digest", `builder-checkpoint=${sessionAdmission.digest}`,
      "--observation", observationPath,
      "--digest", `builder-codex-uat-observation=${observationDigest}`,
    ]);
    assert.equal(uat.nextScenario, "skill-discovery");
    const recordedAttempt = await packedCodexUat.loadCodexUatAttemptJournal(attemptJournalPath);
    assert.equal(recordedAttempt.entries.at(-1).details.checkpointLeafDigest, sessionAdmission.digest);
    assert.equal(recordedAttempt.entries.at(-1).details.observationLeafDigest, observationDigest);
    assert.equal(JSON.stringify(sessionAdmission.value).includes("packed-chain-session"), false);
    assert.equal(JSON.stringify(sessionAdmission.value).includes("SECRET"), false);
    assert.equal(JSON.stringify(sessionAdmission.value).includes("/private/tmp"), false);

    const beforeUnknown = await checkpointJournalSnapshot(checkpointPath);
    const unknown = await runNode(runnerPath, JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      session_id: "packed-chain-session",
    }), childOptions);
    assert.equal(unknown.code, 0);
    assert.equal(unknown.stdout, "");
    assert.equal(unknown.stderr, "");
    assert.deepEqual(await checkpointJournalSnapshot(checkpointPath), beforeUnknown);

    for (const hostileCwd of [
      path.join(project, "nested-consumer"),
      path.join(root, "project-prefix"),
      path.join(root, "cross-project"),
    ]) {
      await mkdir(hostileCwd);
      const rejected = await runNode(runnerPath, JSON.stringify({
        hook_event_name: "SessionStart",
        session_id: "hostile-delivery-cwd",
        project: project,
      }), { ...childOptions, cwd: hostileCwd });
      assert.notEqual(rejected.code, 0);
      assert.equal(rejected.stdout, "");
      assert.equal(rejected.stderr, "");
      assert.deepEqual(await checkpointJournalSnapshot(checkpointPath), beforeUnknown);
    }

    const receiptPath = path.join(project, RECEIPT_PATH);
    const retainedReceiptPath = `${receiptPath}.retained-for-hostile-test`;
    await rename(receiptPath, retainedReceiptPath);
    const missingReceipt = await runNode(runnerPath, JSON.stringify({
      hook_event_name: "SessionStart",
      session_id: "missing-receipt",
    }), childOptions);
    assert.notEqual(missingReceipt.code, 0);
    assert.equal(missingReceipt.stdout, "");
    assert.equal(missingReceipt.stderr, "");
    assert.deepEqual(await checkpointJournalSnapshot(checkpointPath), beforeUnknown);
    await rename(retainedReceiptPath, receiptPath);

    const pre = await runNode(runnerPath, JSON.stringify({
      hook_event_name: "PreCompact",
      session_id: "packed-chain-session",
    }), childOptions);
    assert.equal(pre.code, 0, pre.stderr);
    assert.equal(pre.stdout, "{}\n");
    assert.equal(pre.stderr, "");

    const post = await runNode(runnerPath, JSON.stringify({
      hook_event_name: "PostCompact",
      session_id: "packed-chain-session",
    }), childOptions);
    assert.equal(post.code, 0, post.stderr);
    const postOutput = JSON.parse(post.stdout);
    assert.equal(postOutput.hookSpecificOutput.hookEventName, "PostCompact");
    assert.match(postOutput.hookSpecificOutput.additionalContext, /resumable at plan/u);
    assert.equal(post.stderr, "");

    const beforeReplay = await checkpointJournalSnapshot(checkpointPath);
    const replay = await runNode(runnerPath, JSON.stringify({
      hook_event_name: "PostCompact",
      session_id: "packed-chain-session",
    }), childOptions);
    assert.equal(replay.code, 0, replay.stderr);
    assert.equal(replay.stdout, "{}\n");
    assert.equal(replay.stderr, "");
    assert.deepEqual(await checkpointJournalSnapshot(checkpointPath), beforeReplay);

    const beforeAuthenticatedSwap = await checkpointJournalSnapshot(checkpointPath);
    const swapped = startNode(runnerPath, JSON.stringify({
      hook_event_name: "PreCompact",
      session_id: "packed-chain-session",
    }), childOptions);
    // The adjacent launcher child is spawned only after admission has captured
    // and digested the complete release. Observe that natural process boundary
    // before replacing pathnames; a fixed delay races slower Linux runners.
    await waitForDirectChild(swapped.child);
    assert.equal(swapped.child.exitCode, null);
    const swappedRunner = `${runnerPath}.retained-after-bootstrap`;
    const swappedLauncher = `${launcherPath}.retained-after-bootstrap`;
    const effectPath = path.join(
      pluginRoot,
      "runtime",
      "agentmo",
      "src",
      "builder-posix-effect.js",
    );
    const swappedEffect = `${effectPath}.retained-after-bootstrap`;
    const launcherSentinel = path.join(root, "original-launcher-executed");
    const effectSentinel = path.join(root, "swapped-effect-module-executed");
    await rename(runnerPath, swappedRunner);
    await writeFile(runnerPath, "process.exitCode = 99;\n", "utf8");
    await rename(launcherPath, swappedLauncher);
    await writeFile(
      launcherPath,
      `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(launcherSentinel)}, "executed");\n`,
      "utf8",
    );
    await rename(effectPath, swappedEffect);
    await writeFile(
      effectPath,
      `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(effectSentinel)}, "executed");\n`,
      "utf8",
    );
    const swapResult = await swapped.exited;
    assert.equal(swapResult.code, 0, swapResult.stderr);
    assert.equal(swapResult.signal, null);
    assert.equal(swapResult.stdout, "{}\n");
    assert.equal(swapResult.stderr, "");
    assert.notDeepEqual(
      await checkpointJournalSnapshot(checkpointPath),
      beforeAuthenticatedSwap,
    );
    await absent(launcherSentinel);
    await absent(effectSentinel);
  });

  it("rejects a forged canonical receipt and marker against the append-only install anchor", async () => {
    const fixture = await installHookBootstrapFixture("agentmo-hook-forged-receipt");
    const receiptPath = path.join(fixture.project, RECEIPT_PATH);
    const markerPath = path.join(fixture.project, ".agentmo", "builder", "install-marker.json");
    const originalReceipt = await readFile(receiptPath);
    const originalMarker = await readFile(markerPath);
    try {
      const receipt = JSON.parse(originalReceipt.toString("utf8"));
      const { digest: _priorCapabilityDigest, ...capabilityBasis } = receipt.capabilitySnapshot;
      capabilityBasis.optional = [{ id: "host-doctor", status: "observed" }];
      receipt.capabilitySnapshot = {
        ...capabilityBasis,
        digest: digestRawBytes(Buffer.from(serializePersistableJson(capabilityBasis, {
          subject: "builder-capability-snapshot",
        }), "utf8")),
      };
      receipt.planDigest = digestRawBytes(Buffer.from(serializePersistableJson(
        packedInstall.buildBuilderInstallPlanBasis({
          release: receipt.identity,
          capabilitySnapshot: receipt.capabilitySnapshot,
          scopeDigest: receipt.scopeDigest,
          managedFiles: receipt.files,
        }),
        { subject: "builder-install-plan-basis" },
      ), "utf8"));
      const forgedReceipt = Buffer.from(serializePersistableJson(receipt, {
        subject: "builder-install-receipt",
      }), "utf8");
      const marker = {
        schemaVersion: "agentmo.builder-install-marker.v2",
        identity: receipt.identity,
        scope: "project",
        scopeDigest: receipt.scopeDigest,
        receiptPath: RECEIPT_PATH,
        checkpointPath: ".agentmo/checkpoints/builder.json",
        capabilityDigest: receipt.capabilitySnapshot.digest,
        projectionStatus: "receipt-required",
        selfCertifying: false,
      };
      await Promise.all([
        writeFile(receiptPath, forgedReceipt),
        writeFile(markerPath, Buffer.from(serializePersistableJson(marker, {
          subject: "builder-install-marker",
        }), "utf8")),
      ]);

      const rejected = await runNode(fixture.runnerPath, JSON.stringify({
        hook_event_name: "SessionStart",
        session_id: "forged-install-anchor",
      }), fixture.childOptions);
      assert.notEqual(rejected.code, 0);
      assert.equal(rejected.stdout, "");
      assert.equal(rejected.stderr, "");
      assert.equal(
        (await readdir(fixture.stateRoot)).some((name) => name.startsWith("agentmo-hook-bootstrap-")),
        false,
      );
    } finally {
      await Promise.all([
        writeFile(receiptPath, originalReceipt),
        writeFile(markerPath, originalMarker),
      ]);
    }
  });

  it("rejects a tampered bound runtime module before it can be imported", async () => {
    const fixture = await installHookBootstrapFixture("agentmo-hook-import-tamper");
    const sentinel = path.join(fixture.root, "unexpected-runtime-import");
    const target = path.join(fixture.pluginRoot, "runtime", "agentmo", "src", "builder-platform.js");
    const original = await readFile(target);
    try {
      await writeFile(
        target,
        `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(sentinel)}, "executed");\n`,
        "utf8",
      );
      const rejected = await runNode(fixture.runnerPath, JSON.stringify({
        hook_event_name: "SessionStart",
        session_id: "tampered-runtime-module",
      }), fixture.childOptions);
      assert.notEqual(rejected.code, 0);
      assert.equal(rejected.stdout, "");
      assert.equal(rejected.stderr, "");
      await absent(sentinel);
    } finally {
      await writeFile(target, original);
    }
  });

  it("keeps repeated authenticated graph deliveries free of snapshot growth", async () => {
    const fixture = await installHookBootstrapFixture("agentmo-hook-tmpdir");
    const hostileTmp = path.join(fixture.root, "hostile-tmp");
    await mkdir(hostileTmp, { mode: 0o700 });
    const before = new Set(await readdir(fixture.stateRoot));
    for (const _sequence of [1, 2, 3]) {
      const delivered = await runNode(fixture.runnerPath, JSON.stringify({
        hook_event_name: "SessionStart",
        session_id: "bounded-graph",
      }), {
        ...fixture.childOptions,
        env: { ...fixture.childOptions.env, TMPDIR: hostileTmp },
        timeoutMs: 35_000,
      });
      assert.equal(delivered.code, 0, delivered.stderr);
      assert.equal(delivered.stderr, "");
    }
    assert.deepEqual(await readdir(hostileTmp), []);
    assert.deepEqual(new Set(await readdir(fixture.stateRoot)), before);
  });

  it("rejects direct bootstrap admission without parent-authenticated graph descriptors", async () => {
    const fixture = await installHookBootstrapFixture("agentmo-hook-bootstrap-capability");
    const receiptPath = path.join(fixture.project, RECEIPT_PATH);
    const verifierUrl = pathToFileURL(path.join(
      fixture.pluginRoot,
      "runtime", "agentmo",
      "src",
      "builder-bootstrap-snapshot.js",
    )).href;
    const packageUrl = pathToFileURL(path.join(
      fixture.pluginRoot,
      "runtime", "agentmo",
      "src",
      "builder-package.js",
    )).href;
    const capabilityProbe = `
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
const receiptBytes = await readFile(${JSON.stringify(receiptPath)});
const receipt = JSON.parse(receiptBytes);
const receiptDigest = "sha256:" + createHash("sha256").update(receiptBytes).digest("hex");
const binding = receipt.hostActivation.finalProjectionBinding;
const runnerDigest = binding.members.find((member) => (
  member.kind === "file" && member.relativePath === "plugins/agentmo/hooks/agentmo-hook.js"
)).digest;
const verifier = await import(${JSON.stringify(verifierUrl)});
const packageApi = await import(${JSON.stringify(packageUrl)});
const common = { expectedReceiptDigest: receiptDigest, projectionBinding: binding, runnerDigest };
const rejected = async (action) => {
  try {
    await action();
    return false;
  } catch {
    return true;
  }
};
const outcomes = {};
outcomes.publicFlag = await rejected(() => packageApi.loadBuilderPackage({ bootstrapSnapshot: true }));
outcomes.forged = await rejected(() => packageApi.loadVerifiedBootstrapSnapshotPackage({
  ...common,
  bootstrapCapability: {},
}));
outcomes.missingDescriptors = await rejected(() => verifier.verifyInstalledBootstrapSnapshot({
  activationReceipt: receipt,
  receiptDigest,
  runnerDigest,
}));
process.stdout.write(JSON.stringify(outcomes));
`;
    const baseOptions = {
      ...fixture.childOptions,
      env: {
        ...fixture.childOptions.env,
        AGENTMO_BUILDER_HOOK_BOOTSTRAP_MODE: "authenticated-graph-v1",
        AGENTMO_BUILDER_HOOK_GRAPH_DIGEST: `sha256:${"0".repeat(64)}`,
      },
    };
    const expected = {
      publicFlag: true,
      forged: true,
      missingDescriptors: true,
    };
    // Missing launcher continuity must reject before trying to read an open,
    // unrelated fd 4.  The bounded helper makes a regression fail quickly.
    const missingRunner = await runNodeModuleSource(capabilityProbe, {
      ...baseOptions,
      keepGraphDescriptorOpen: true,
      timeoutMs: 2_000,
    });
    assert.equal(missingRunner.code, 0, missingRunner.stderr);
    assert.equal(missingRunner.stderr, "");
    assert.deepEqual(JSON.parse(missingRunner.stdout), expected);

    const runnerDigest = digestRawBytes(await readFile(fixture.runnerPath));
    const emptyDescriptor = await runNodeModuleSource(capabilityProbe, {
      ...baseOptions,
      env: {
        ...baseOptions.env,
        AGENTMO_BUILDER_HOOK_RUNNER_DIGEST: runnerDigest,
      },
    });
    assert.equal(emptyDescriptor.code, 0, emptyDescriptor.stderr);
    assert.equal(emptyDescriptor.stderr, "");
    assert.deepEqual(JSON.parse(emptyDescriptor.stdout), expected);
  });

  it("rejects a cryptographically valid terminal attempt whose reservation no longer binds its plan", async () => {
    const fixture = await installHookBootstrapFixture("agentmo-hook-terminal-plan-mismatch");
    const authority = await packedAppendOnly.readAppendOnlyAuthority({
      projectRoot: fixture.project,
      relativeRoot: ".agentmo-install-attempt-authority",
      namespace: "builder-install",
    });
    const forgedTerminal = structuredClone(authority.records.at(-1).payload);
    forgedTerminal.operationId = "f".repeat(64);
    forgedTerminal.planDigest = `sha256:${"e".repeat(64)}`;
    assert.notEqual(
      forgedTerminal.hostReservation.bindingDigest,
      forgedTerminal.planDigest,
    );
    await packedAppendOnly.appendAppendOnlyRecord({
      projectRoot: fixture.project,
      relativeRoot: ".agentmo-install-attempt-authority",
      namespace: "builder-install",
      idempotencyKey: "terminal-plan-reservation-mismatch",
      expectedHeadDigest: authority.headDigest,
      payload: forgedTerminal,
    });
    const snapshotsBefore = new Set(await readdir(fixture.stateRoot));
    const rejected = await runNode(fixture.runnerPath, JSON.stringify({
      hook_event_name: "SessionStart",
      session_id: "terminal-plan-reservation-mismatch",
    }), fixture.childOptions);
    assert.notEqual(rejected.code, 0);
    assert.equal(rejected.stdout, "");
    assert.equal(rejected.stderr, "");
    assert.deepEqual(new Set(await readdir(fixture.stateRoot)), snapshotsBefore);
  });

  it("rejects a decoy runtime-local plugin and tampered receipt without changing the checkpoint", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-packed-hook-receipt-bypass-"));
    const project = path.join(root, "project");
    const home = path.join(root, "home");
    const stateRoot = path.join(home, ".agentmo", "builder", "codex-host");
    await Promise.all([mkdir(project), mkdir(home, { mode: 0o700 })]);
    const bin = await fakeCodexBin(root);
    const installed = await runPackedInstallChild({
      project,
      home,
      bin,
    });
    assert.equal(installed.code, 0, `${installed.stdout}${installed.stderr}`);
    assert.equal(installed.value?.ok, true);

    const pluginRoot = path.join(stateRoot, "marketplace", "agentmo-local", "plugins", "agentmo");
    await cp(
      path.join(packedPackageRoot, "plugin"),
      path.join(pluginRoot, "runtime", "agentmo", "plugin"),
      { recursive: true },
    );
    const tamperedReceiptBytes = Buffer.from('{"schemaVersion":"attacker-controlled"}\n', "utf8");
    const tamperedReceiptDigest = digestRawBytes(tamperedReceiptBytes);
    await writeFile(path.join(project, RECEIPT_PATH), tamperedReceiptBytes);

    const checkpointPath = path.join(project, ".agentmo", "checkpoints", "builder.json");
    const checkpoint = packedCheckpoint.buildBuilderCheckpoint({
      workflowId: "workflow-packed-hook-receipt-bypass",
      adapterId: "codex",
      stage: "plan",
      boundary: "approval-required",
      artifactRefs: [{
        subject: "design-plan",
        path: ".agentmo/design-plan.json",
        digest: `sha256:${"1".repeat(64)}`,
      }],
      pendingDecision: {
        id: "decision-packed-hook-receipt-bypass",
        kind: "approval",
        summaryDigest: `sha256:${"2".repeat(64)}`,
      },
      nextAction: "await-approval",
      installReceiptDigest: tamperedReceiptDigest,
      capabilitySnapshot: {
        adapterId: "codex",
        evidenceLevel: "observed",
        digest: `sha256:${"3".repeat(64)}`,
        required: [{ id: "native-hooks", status: "observed" }],
      },
      eventLedger: { cursor: 0, recentEvents: [] },
      pauseReason: "approval-required",
    });
    await mkdir(path.dirname(checkpointPath), { recursive: true });
    await packedCheckpoint.writeBuilderCheckpoint(checkpointPath, checkpoint);
    const checkpointBefore = await checkpointJournalSnapshot(checkpointPath);

    const result = await runNode(
      path.join(pluginRoot, "hooks", "agentmo-hook.js"),
      JSON.stringify({
        hook_event_name: "SessionStart",
        session_id: "packed-chain-receipt-bypass-session",
        source: "resume",
      }),
      {
        cwd: project,
        env: { HOME: home, CODEX_HOME: path.join(home, ".codex") },
      },
    );
    assert.notEqual(result.code, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.deepEqual(await checkpointJournalSnapshot(checkpointPath), checkpointBefore);
  });

  it("fails closed on a conflicting owned path without publishing a receipt", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agentmo-conflict-project-"));
    await mkdir(path.join(project, ".codex", "agents"), { recursive: true });
    await writeFile(path.join(project, ".codex", "agents", "agentmo.toml"), "user-owned\n", "utf8");
    await assert.rejects(
      packedInstall.planBuilderInstall({ projectRoot: project, probe: compatibleProbe() }),
      (error) => error?.code === "AGENTMO_BUILDER_INSTALL_CONFLICT",
    );
    await absent(path.join(project, RECEIPT_PATH));
  });

  it("rejects a missing required capability before any write", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agentmo-probe-project-"));
    await assert.rejects(
      packedInstall.applyBuilderInstall({ projectRoot: project, probe: await missingProbe() }),
      (error) => error?.code === "AGENTMO_BUILDER_INSTALL_PROBE_REJECTED",
    );
    assert.deepEqual(await readdir(project), []);
    await absent(path.join(project, RECEIPT_PATH));
  });

  it("rejects a stale preview digest before any write", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agentmo-stale-plan-project-"));
    await packedInstall.planBuilderInstall({ projectRoot: project, probe: compatibleProbe() });
    await assert.rejects(
      packedInstall.applyBuilderInstall({
        projectRoot: project,
        probe: compatibleProbe(),
        expectedPlanDigest: `sha256:${"0".repeat(64)}`,
      }),
      (error) => error?.code === "AGENTMO_BUILDER_INSTALL_PLAN_CHANGED",
    );
    assert.deepEqual(await readdir(project), []);
    await absent(path.join(project, RECEIPT_PATH));
  });

  it("binds a preview digest to one exact project scope", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-cross-project-plan-"));
    const projectA = path.join(root, "project-a");
    const projectB = path.join(root, "project-b");
    await mkdir(projectA);
    await mkdir(projectB);
    const probe = compatibleProbe();
    const previewA = await packedInstall.planBuilderInstall({ projectRoot: projectA, probe });
    const previewB = await packedInstall.planBuilderInstall({ projectRoot: projectB, probe });
    assert.notEqual(previewA.scopeDigest, previewB.scopeDigest);
    assert.notEqual(previewA.planDigest, previewB.planDigest);
    await assert.rejects(
      packedInstall.applyBuilderInstall({
        projectRoot: projectB,
        probe,
        expectedPlanDigest: previewA.planDigest,
      }),
      (error) => error?.code === "AGENTMO_BUILDER_INSTALL_PLAN_CHANGED",
    );
    assert.deepEqual(await readdir(projectB), []);
    await absent(path.join(projectB, RECEIPT_PATH));
  });

  it("requires an explicit preview digest before any write", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agentmo-unbound-api-project-"));
    await assert.rejects(
      packedInstall.applyBuilderInstall({ projectRoot: project, probe: compatibleProbe() }),
      (error) => error?.code === "AGENTMO_BUILDER_INSTALL_PLAN_DIGEST_REQUIRED",
    );
    assert.deepEqual(await readdir(project), []);
    await absent(path.join(project, RECEIPT_PATH));
  });

  it("rejects a symlink escape before writing outside the approved project", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-symlink-project-"));
    const project = path.join(root, "project");
    const outside = path.join(root, "outside");
    await mkdir(project);
    await mkdir(outside);
    await symlink(outside, path.join(project, ".agentmo"), "dir");
    await assert.rejects(
      packedInstall.applyBuilderInstall({ projectRoot: project, probe: compatibleProbe() }),
      (error) => error?.code === "AGENTMO_BUILDER_INSTALL_PATH_UNSAFE",
    );
    assert.deepEqual(await readdir(outside), []);
    await absent(path.join(project, RECEIPT_PATH));
  });

  it("exposes preview-bound setup and read-only doctor through the packed CLI", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-packed-cli-"));
    const project = path.join(root, "project");
    await mkdir(project);
    const bin = await fakeCodexBin(root);
    const previewRun = await runPackedCli([
      "builder", "setup", "--project", project, "--json",
    ], bin);
    assert.equal(previewRun.code, 0, `${previewRun.stderr}${previewRun.stdout}`);
    assert.equal(previewRun.stderr, "");
    const preview = JSON.parse(previewRun.stdout);
    assert.equal(preview.mode, "preview");
    assert.equal(preview.requiresExplicitApply, true);
    await absent(path.join(project, RECEIPT_PATH));

    const unboundApply = await runPackedCli([
      "builder", "setup", "--project", project, "--apply", "--json",
    ], bin);
    assert.equal(unboundApply.code, 1);
    assert.equal(JSON.parse(unboundApply.stdout).code, "AGENTMO_CLI_BUILDER_REJECTED");
    await absent(path.join(project, RECEIPT_PATH));

    const applyRun = await runPackedCli([
      "builder", "setup", "--project", project,
      "--apply", "--plan-digest", preview.planDigest, "--json",
    ], bin);
    assert.equal(applyRun.code, 0, applyRun.stderr);
    const applied = JSON.parse(applyRun.stdout);
    assert.equal(applied.status, "projected");
    await stat(path.join(project, RECEIPT_PATH));

    const before = await readFile(path.join(project, RECEIPT_PATH));
    const unanchoredRepeat = await runPackedCli([
      "builder", "setup", "--project", project, "--json",
    ], bin);
    assert.equal(unanchoredRepeat.code, 1);
    assert.deepEqual(await readFile(path.join(project, RECEIPT_PATH)), before);

    const repeatedPreviewRun = await runPackedCli([
      "builder", "setup", "--project", project,
      "--digest", `builder-install-receipt=${applied.receipt.digest}`, "--json",
    ], bin);
    assert.equal(repeatedPreviewRun.code, 0, repeatedPreviewRun.stderr);
    const repeatedPreview = JSON.parse(repeatedPreviewRun.stdout);
    assert.equal(repeatedPreview.priorReceipt.digest, applied.receipt.digest);
    const repeatedApply = await runPackedCli([
      "builder", "setup", "--project", project,
      "--digest", `builder-install-receipt=${applied.receipt.digest}`,
      "--apply", "--plan-digest", repeatedPreview.planDigest, "--json",
    ], bin);
    assert.equal(repeatedApply.code, 0, repeatedApply.stderr);
    assert.equal(JSON.parse(repeatedApply.stdout).changed, false);
    assert.deepEqual(await readFile(path.join(project, RECEIPT_PATH)), before);

    const doctorRun = await runPackedCli([
      "builder", "doctor", "--project", project, "--json",
    ], bin);
    assert.equal(doctorRun.code, 0, doctorRun.stderr);
    const doctor = JSON.parse(doctorRun.stdout);
    assert.equal(doctor.status, "declared");
    assert.equal(doctor.visibility.activation, "unverified");
    assert.equal(doctor.repairsApplied, false);
    assert.deepEqual(await readFile(path.join(project, RECEIPT_PATH)), before);
    assert.equal(doctorRun.stdout.includes(project), false);

    const upgradeHome = path.join(root, "v2-v3-activation-home");
    await mkdir(upgradeHome, { mode: 0o700 });
    const upgradePreviewRun = await runPackedCli([
      "builder", "setup", "--project", project,
      "--host-scope", "user",
      "--digest", `builder-install-receipt=${applied.receipt.digest}`, "--json",
    ], bin, upgradeHome);
    assert.equal(upgradePreviewRun.code, 1, upgradePreviewRun.stderr);
    assert.equal(
      JSON.parse(upgradePreviewRun.stdout).code,
      "AGENTMO_BUILDER_INSTALL_IMMUTABLE_SUCCESSOR_REQUIRED",
    );
    assert.deepEqual(await readFile(path.join(project, RECEIPT_PATH)), before);
    await absent(path.join(upgradeHome, ".fake-codex-installed.json"));

    const activationProject = path.join(root, "activation-project");
    const activationHome = path.join(root, "activation-home");
    await mkdir(activationProject);
    await mkdir(activationHome, { mode: 0o700 });
    const rejectedScope = await runPackedCli([
      "builder", "setup", "--project", activationProject,
      "--host-scope", "project", "--json",
    ], bin, activationHome);
    assert.equal(rejectedScope.code, 1);
    assert.equal(JSON.parse(rejectedScope.stdout).code, "AGENTMO_CLI_BUILDER_REJECTED");

    const activationPreviewRun = await runPackedCli([
      "builder", "setup", "--project", activationProject,
      "--host-scope", "user", "--json",
    ], bin, activationHome);
    assert.equal(activationPreviewRun.code, 0, activationPreviewRun.stderr);
    const activationPreview = JSON.parse(activationPreviewRun.stdout);
    assert.equal(activationPreview.hostActivation.operation, "activate");
    assert.equal(activationPreview.hostActivation.owner.disposition, "created-by-agentmo");
    await absent(path.join(activationProject, RECEIPT_PATH));

    const activationApplyRun = await runPackedCli([
      "builder", "setup", "--project", activationProject,
      "--host-scope", "user", "--apply",
      "--plan-digest", activationPreview.planDigest, "--json",
    ], bin, activationHome);
    assert.equal(activationApplyRun.code, 0, activationApplyRun.stderr);
    const activated = JSON.parse(activationApplyRun.stdout);
    assert.equal(activated.status, "activated");
    assert.equal(activated.hostActivation.trust, "pending-human");
    assert.equal(activated.evidence.codexActivationVerified, false);
    assert.equal(activated.evidence.hostBehaviorVerified, false);
    assert.equal(activated.evidence.domainQualityCertified, false);
    const activatedReceipt = JSON.parse(await readFile(path.join(activationProject, RECEIPT_PATH), "utf8"));
    assertActivatedReceiptBinding(activatedReceipt);
    assert.equal(activatedReceipt.hostActivation.selectorDeletionAuthority, false);
  });
});
