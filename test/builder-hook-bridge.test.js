import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import {
  chmod,
  cp,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { before, describe, it } from "node:test";

import { digestRawBytes } from "../src/artifact-admission.js";
import {
  abortAppendOnlyPrepared,
  appendAppendOnlyRecord,
  readAppendOnlyAuthority,
} from "../src/builder-append-only-authority.js";
import {
  buildBuilderCheckpoint,
  loadBuilderCheckpoint,
  writeBuilderCheckpoint,
} from "../src/builder-checkpoint.js";
import * as bridgeNamespace from "../src/builder-hook-bridge.js";
import {
  CODEX_UAT_SCENARIO_IDS,
  armCodexUatScenario,
  loadCodexUatAttemptJournal,
  loadCodexUatObservationLeaf,
  publishCodexUatObservationLeaf,
  releaseCodexUatLeafDirectoryAuthority,
  recordCodexUatActivationApplied,
  recordCodexUatScenarioObservation,
  recordCodexUatSetupApplied,
  recordCodexUatTrustAuthObservation,
  startCodexUatAttempt,
  retainCodexUatLeafDirectoryAuthority,
} from "../src/builder-codex-uat.js";
import { serializePersistableJson } from "../src/persistability.js";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const DIGEST_C = `sha256:${"c".repeat(64)}`;
const DIGEST_D = `sha256:${"d".repeat(64)}`;
const DIGEST_E = `sha256:${"e".repeat(64)}`;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);
const BUILDER_INSTALL_MODULE_URL = pathToFileURL(
  path.join(REPO_ROOT, "src", "builder-install.js"),
).href;
const APPEND_ONLY_CHILD = path.join(REPO_ROOT, "test", "helpers", "append-only-child.js");
const INSTALL_ATTEMPT_AUTHORITY_PATH = ".agentmo-install-attempt-authority";
const INSTALL_ATTEMPT_NAMESPACE = "builder-install";
let uatReleaseFixture;

const digest = (label) => digestRawBytes(Buffer.from(`${label}\n`, "utf8"));

function checkpoint(overrides = {}) {
  return buildBuilderCheckpoint({
    workflowId: "workflow-bridge-1",
    adapterId: "codex",
    stage: "plan",
    boundary: "approval-required",
    artifactRefs: [{ subject: "design-plan", path: ".agentmo/design-plan.json", digest: DIGEST_A }],
    pendingDecision: { id: "decision-1", kind: "approval", summaryDigest: DIGEST_B },
    nextAction: "await-approval",
    installReceiptDigest: DIGEST_C,
    capabilitySnapshot: {
      adapterId: "codex",
      evidenceLevel: "observed",
      digest: DIGEST_D,
      required: [{ id: "native-hooks", status: "observed" }],
    },
    eventLedger: { cursor: 0, recentEvents: [] },
    pauseReason: "approval-required",
    ...overrides,
  });
}

async function observingAttempt(root) {
  const journalPath = path.join(root, "attempt.json");
  let view = await startCodexUatAttempt({
    journalPath,
    attemptId: "attempt-bridge-001",
    baseline: {
      packageRoot: uatReleaseFixture.baselinePackage,
      tarballPath: uatReleaseFixture.baselineTarball,
    },
    successor: {
      packageRoot: uatReleaseFixture.successorPackage,
      tarballPath: uatReleaseFixture.successorTarball,
    },
  });
  const marketplaceProjectionDigest = digest("marketplace");
  const projectionRootIdentity = {
    device: "1",
    group: "1",
    inode: "1",
    links: "1",
    mode: "700",
    owner: "1",
    size: "0",
  };
  const projectionTransactionDigest = digest("projection-transaction");
  const receiptBytes = Buffer.from(serializePersistableJson({
    schemaVersion: "agentmo.builder-install-receipt.v4",
    status: "activated",
    identity: {
      name: view.state.baseline.packageName,
      version: view.state.baseline.version,
      adapterId: "codex",
      releaseDigest: view.state.baseline.releaseDigest,
    },
    planDigest: digest("setup-plan"),
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
      releaseDigest: view.state.baseline.releaseDigest,
      marketplaceProjectionDigest,
      operationOrderDigest: digest("operation-order"),
      ownerDisposition: "created-by-agentmo",
      ownerRecordDigest: digest("owner"),
      consumerId: digest("consumer-id"),
      consumerEntryDigest: digest("consumer"),
      consumerLedgerDigest: digest("ledger"),
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
        releaseDigest: view.state.baseline.releaseDigest,
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
  }, { subject: "builder-install-receipt" }), "utf8");
  const receiptPath = path.join(root, "install-receipt.json");
  await writeFile(receiptPath, receiptBytes, { flag: "wx", mode: 0o600 });
  const receiptDigest = digestRawBytes(receiptBytes);
  const transitionCheckpointPath = path.join(root, "transition-checkpoint.json");
  const transitionCheckpoint = await writeBuilderCheckpoint(
    transitionCheckpointPath,
    checkpoint({
      stage: "discover",
      boundary: "artifact-created",
      installReceiptDigest: receiptDigest,
      pendingDecision: null,
      nextAction: "plan",
      pauseReason: null,
    }),
  );
  view = await recordCodexUatSetupApplied({
    journalPath,
    expectedHeadAdmission: view.head,
    installReceiptPath: receiptPath,
    expectedInstallReceiptDigest: receiptDigest,
    checkpointAdmission: transitionCheckpoint,
  });
  const hostPath = path.join(root, "host-observation.json");
  const hostBytes = Buffer.from("bounded host observation\n");
  await writeFile(hostPath, hostBytes, { flag: "wx", mode: 0o600 });
  view = await recordCodexUatActivationApplied({
    journalPath,
    expectedHeadAdmission: view.head,
    installReceiptPath: receiptPath,
    expectedInstallReceiptDigest: receiptDigest,
    checkpointAdmission: transitionCheckpoint,
    hostObservationPath: hostPath,
    expectedHostObservationDigest: digestRawBytes(hostBytes),
  });
  const evidence = [];
  for (const name of ["fresh-process", "trust", "auth"]) {
    const filePath = path.join(root, `${name}.evidence`);
    const bytes = Buffer.from(`${name}\n`);
    await writeFile(filePath, bytes, { flag: "wx", mode: 0o600 });
    evidence.push({ filePath, digest: digestRawBytes(bytes) });
  }
  view = await recordCodexUatTrustAuthObservation({
    journalPath,
    expectedHeadAdmission: view.head,
    freshProcessEvidencePath: evidence[0].filePath,
    expectedFreshProcessDigest: evidence[0].digest,
    trustObservationPath: evidence[1].filePath,
    expectedTrustObservationDigest: evidence[1].digest,
    authObservationPath: evidence[2].filePath,
    expectedAuthObservationDigest: evidence[2].digest,
  });
  return { journalPath, view };
}

async function buildUatReleaseFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-hook-uat-releases-"));
  const out = path.join(root, "releases");
  const baselineVersion = "0.1.0-uat.18.5";
  const successorVersion = "0.1.0-uat.18.6";
  await execFileAsync(process.execPath, [
    path.join(REPO_ROOT, "scripts", "build-builder-uat-releases.js"),
    "--out", out,
    "--baseline-version", baselineVersion,
    "--successor-version", successorVersion,
    "--json",
  ], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  const baselineTarball = path.join(out, `agentmo-${baselineVersion}.tgz`);
  const successorTarball = path.join(out, `agentmo-${successorVersion}.tgz`);
  const baselineRoot = path.join(root, "baseline");
  const successorRoot = path.join(root, "successor");
  await Promise.all([mkdir(baselineRoot), mkdir(successorRoot)]);
  await Promise.all([
    execFileAsync("tar", ["-xzf", baselineTarball, "-C", baselineRoot]),
    execFileAsync("tar", ["-xzf", successorTarball, "-C", successorRoot]),
  ]);
  return {
    baselineTarball,
    successorTarball,
    baselinePackage: path.join(baselineRoot, "package"),
    successorPackage: path.join(successorRoot, "package"),
  };
}

before(async () => {
  uatReleaseFixture = await buildUatReleaseFixture();
});

async function checkpointFile(root) {
  const filePath = path.join(root, "checkpoint.json");
  const written = await writeBuilderCheckpoint(filePath, checkpoint());
  return { filePath, admission: written };
}

function sessionStartEvidence() {
  return { hookEventDigest: digest("session-start-hook-event") };
}

function runHookRunner(filePath, input, env = process.env, cwd) {
  return new Promise((resolveResult) => {
    const startedAt = Date.now();
    const child = execFile(process.execPath, [filePath], {
      encoding: "utf8",
      env,
      cwd,
      maxBuffer: 256 * 1024,
    }, (error, stdout, stderr) => {
      resolveResult({
        code: error?.code ?? 0,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
      });
    });
    child.stdin.end(input);
  });
}

function installAttemptAuthority(projectRoot) {
  return {
    projectRoot,
    relativeRoot: INSTALL_ATTEMPT_AUTHORITY_PATH,
    namespace: INSTALL_ATTEMPT_NAMESPACE,
  };
}

async function stopAppendAtAuthorityBoundary(options, sequence, boundary) {
  const child = spawn(
    process.execPath,
    [APPEND_ONLY_CHILD, JSON.stringify({ action: "append", options })],
    { stdio: ["ignore", "ignore", "ignore", "ipc"] },
  );
  const closed = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
  const root = path.join(options.projectRoot, ...options.relativeRoot.split("/"));
  const directory = path.join(root, boundary === "claim" ? "claims" : (
    boundary === "record-stage" ? "entries" : "prepared"
  ));
  const expectedClaim = `${String(sequence).padStart(16, "0")}.json`;
  const expectedSuffix = boundary === "record-stage"
    ? ".record.stage.json"
    : ".prepared.stage.json";
  const deadline = Date.now() + 15_000;
  let stopped = false;
  while (Date.now() < deadline && child.exitCode === null) {
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    });
    if (boundary === "claim") {
      stopped = entries.some((entry) => entry.isSymbolicLink() && entry.name === expectedClaim);
    } else {
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(expectedSuffix)) continue;
        try {
          const value = JSON.parse(await readFile(path.join(directory, entry.name), "utf8"));
          if (value?.sequence === sequence) {
            stopped = true;
            break;
          }
        } catch {
          // The selected append writer still owns an incomplete JSON prefix.
        }
      }
    }
    if (stopped) {
      stopped = child.kill("SIGSTOP");
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.equal(stopped, true, `append completed before ${boundary} was observed`);
  child.kill("SIGKILL");
  assert.deepEqual(await closed, { code: null, signal: "SIGKILL" });
}

async function appendCanonicalAbortPrefix(projectRoot, boundary, idempotencyKey) {
  const authority = installAttemptAuthority(projectRoot);
  const before = await readAppendOnlyAuthority(authority);
  const request = {
    ...authority,
    expectedHeadDigest: before.headDigest,
    idempotencyKey,
    payload: {
      schemaVersion: "agentmo.builder-hook-abort-prefix-test.v1",
      boundary,
    },
  };
  await stopAppendAtAuthorityBoundary(request, before.nextSequence, boundary);
  const interrupted = await readAppendOnlyAuthority(authority);
  assert.equal(interrupted.nextSequence, before.nextSequence);
  assert.ok(interrupted.recoveryRequired);
  const aborted = await abortAppendOnlyPrepared({
    ...authority,
    expectedHeadDigest: interrupted.headDigest,
    expectedPreparedRecordDigest: interrupted.recoveryRequired.recordDigest,
    reason: "HOOK_ABORT_RECOVERY_TEST",
  });
  assert.equal(aborted.status, "aborted");
  const state = await readAppendOnlyAuthority(authority);
  assert.equal(state.recoveryRequired, null);
  return { before, state, aborted };
}

async function appendRetryTerminal(projectRoot, idempotencyKey, terminalPayload) {
  const authority = installAttemptAuthority(projectRoot);
  const state = await readAppendOnlyAuthority(authority);
  return appendAppendOnlyRecord({
    ...authority,
    expectedHeadDigest: state.headDigest,
    idempotencyKey,
    payload: terminalPayload,
  });
}

async function replaceOutcomeWithHostileAbort(projectRoot, sequence) {
  const authorityRoot = path.join(
    projectRoot,
    ...INSTALL_ATTEMPT_AUTHORITY_PATH.split("/"),
  );
  const outcomePath = path.join(authorityRoot, "outcomes", `${String(sequence).padStart(16, "0")}.json`);
  const outcome = JSON.parse(await readFile(outcomePath, "utf8"));
  outcome.preparedPath = "claims/0000000000009999.json";
  const bytes = Buffer.from(`${JSON.stringify(outcome, null, 2)}\n`, "utf8");
  const stagePath = path.join(
    authorityRoot,
    "outcomes",
    `${outcome.operationId}.outcome.stage.json`,
  );
  const selectionPath = path.join(
    authorityRoot,
    "outcomes",
    `${outcome.operationId}.outcome.selection`,
  );
  await unlink(stagePath);
  await unlink(outcomePath);
  await unlink(selectionPath);
  await writeFile(stagePath, bytes, { flag: "wx", mode: 0o600 });
  await link(stagePath, outcomePath);
  await symlink(
    `am-selected-file-v1.${digestRawBytes(bytes).slice("sha256:".length)}.${bytes.byteLength}`,
    selectionPath,
  );
}

async function fakeInstalledRunner(launcherSource) {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-installed-runner-"));
  const projectRoot = path.join(root, "project");
  const pluginRoot = path.join(root, "state", "marketplace", "agentmo-local", "plugins", "agentmo");
  const hookPath = path.join(pluginRoot, "hooks", "agentmo-hook.js");
  const launcherPath = path.join(pluginRoot, "runtime", "agentmo", "bin", "agentmo.js");
  const platformPath = path.join(pluginRoot, "runtime", "agentmo", "src", "builder-platform.js");
  await mkdir(projectRoot);
  await mkdir(path.dirname(hookPath), { recursive: true });
  await mkdir(path.dirname(launcherPath), { recursive: true });
  await mkdir(path.dirname(platformPath), { recursive: true });
  await cp(path.join(REPO_ROOT, "plugin", "hooks", "agentmo-hook.js"), hookPath);
  await cp(path.join(REPO_ROOT, "src", "builder-platform.js"), platformPath);
  await writeFile(launcherPath, launcherSource, "utf8");
  return { projectRoot, hookPath };
}

function compatibleHookProbe() {
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

const AUTHENTIC_CODEX_SOURCE = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const statePath = path.join(process.env.HOME, ".agentmo-hook-bridge-codex.json");
function load() {
  try { return JSON.parse(fs.readFileSync(statePath, "utf8")); }
  catch { return { marketplaceRoot: null, installed: false }; }
}
function save(state) { fs.writeFileSync(statePath, JSON.stringify(state)); }
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

const AUTHENTIC_INSTALL_SOURCE = String.raw`
import { readFile } from "node:fs/promises";
import path from "node:path";
import { applyBuilderInstall, planBuilderInstall } from ${JSON.stringify(BUILDER_INSTALL_MODULE_URL)};

const projectRoot = process.argv[1];
const probe = ${JSON.stringify(compatibleHookProbe())};
try {
  const preview = await planBuilderInstall({ projectRoot, probe, hostScope: "user" });
  const applied = await applyBuilderInstall({
    projectRoot,
    probe,
    hostScope: "user",
    expectedPlanDigest: preview.planDigest,
  });
  const receipt = JSON.parse(await readFile(
    path.join(projectRoot, ".agentmo", "builder", "install-receipt.json"),
    "utf8",
  ));
  process.stdout.write(JSON.stringify({ ok: true, applied, receipt }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, code: error?.code ?? "UNEXPECTED" }));
  process.exitCode = 1;
}
`;

async function installAuthenticHookRunner() {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-hook-anchored-"));
  const home = path.join(root, "home");
  const projectRoot = path.join(root, "project");
  const codexHome = path.join(home, ".codex");
  const bin = path.join(home, "bin");
  await Promise.all([
    mkdir(projectRoot, { mode: 0o700 }),
    mkdir(codexHome, { recursive: true, mode: 0o700 }),
    mkdir(bin, { recursive: true, mode: 0o700 }),
  ]);
  await chmod(home, 0o700);
  await chmod(projectRoot, 0o700);
  const codexPath = path.join(bin, "codex");
  await writeFile(codexPath, AUTHENTIC_CODEX_SOURCE, { flag: "wx", mode: 0o700 });
  await chmod(codexPath, 0o700);
  const environment = {
    HOME: home,
    CODEX_HOME: codexHome,
    LANG: "C",
    LC_ALL: "C",
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
  };
  let completed;
  try {
    completed = await execFileAsync(process.execPath, [
      "--input-type=module",
      "--eval",
      AUTHENTIC_INSTALL_SOURCE,
      projectRoot,
    ], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: environment,
      maxBuffer: 2 * 1024 * 1024,
    });
  } catch (error) {
    assert.fail(`anchored hook install failed: ${error?.stdout ?? error?.code ?? "unknown"}`);
  }
  const installed = JSON.parse(completed.stdout);
  assert.equal(installed.ok, true, installed.code);
  assert.equal(installed.applied.status, "activated");
  const checkpointPath = path.join(projectRoot, ".agentmo", "checkpoints", "builder.json");
  await writeBuilderCheckpoint(checkpointPath, checkpoint({
    installReceiptDigest: installed.applied.receipt.digest,
  }));
  const stateRoot = path.join(home, ".agentmo", "builder", "codex-host");
  return Object.freeze({
    projectRoot,
    stateRoot,
    runnerPath: path.join(
      stateRoot,
      "marketplace",
      "agentmo-local",
      "plugins",
      "agentmo",
      "hooks",
      "agentmo-hook.js",
    ),
    environment,
    root,
  });
}

function fakeBridgeResult(event = "SessionStart") {
  return JSON.stringify({
    schemaVersion: "agentmo.builder-hook-bridge-result.v1",
    status: "applied",
    applied: true,
    event: {
      type: event,
      identity: DIGEST_A,
      epoch: event === "SessionStart" ? 0 : 1,
      sequence: 1,
      digest: DIGEST_B,
    },
    checkpointDigest: DIGEST_C,
    reducedCheckpointDigest: DIGEST_D,
    observationDigest: null,
    announcement: event === "PreCompact"
      ? "AgentMo verified checkpoint flushed before compaction."
      : "bounded",
    proposal: event === "PreCompact" ? null : {
      kind: "resume",
      stage: "plan",
      requiresApproval: true,
      automaticStageAdvance: false,
    },
  });
}

describe("Builder installed hook observation boundary", () => {
  it("exposes no caller context factory, direct semantic delivery helper, or raw challenge mint", async () => {
    assert.equal(typeof bridgeNamespace.deliverInstalledBuilderHook, "function");
    for (const name of [
      "buildInstalledBuilderHookContext",
      "deliverBuilderHook",
      "mintVerifiedCodexHostObservation",
      "buildVerifiedHostContext",
    ]) assert.equal(Object.hasOwn(bridgeNamespace, name), false, name);
    assert.equal(Object.hasOwn(
      await import("../src/builder-checkpoint.js"),
      "armBuilderHookChallenge",
    ), false);
  });

  it("arms from the exact current journal head without persisting or deriving that head", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-uat-arm-"));
    const attempt = await observingAttempt(root);
    const current = await checkpointFile(root);
    const beforeJournal = await loadCodexUatAttemptJournal(attempt.journalPath);
    const armed = await armCodexUatScenario({
      journalPath: attempt.journalPath,
      expectedHeadAdmission: attempt.view.head,
      checkpointPath: current.filePath,
      checkpointAdmission: current.admission,
    });
    assert.equal(armed.scenario, "session-start");
    assert.match(armed.correlation, /^opaque:[a-f0-9]{64}$/u);
    assert.equal(armed.correlation.includes(attempt.view.head.digest.slice("sha256:".length)), false);
    assert.equal((await loadCodexUatAttemptJournal(attempt.journalPath)).head.digest, beforeJournal.head.digest);

    const loaded = await loadBuilderCheckpoint(current.filePath, {
      expectedDigest: armed.checkpointAdmission.digest,
    });
    assert.deepEqual(loaded.value.codexUatChallenge, {
      attemptId: "attempt-bridge-001",
      scenario: "session-start",
      correlation: armed.correlation,
    });
    const serialized = JSON.stringify(loaded.value.codexUatChallenge);
    for (const forbidden of ["journalHead", "headDigest", "predecessor", "previousEntry"]) {
      assert.equal(serialized.includes(forbidden), false);
    }
  });

  it("keeps direct or installed inputs as false-claim leaves and admits them only through later head CAS", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-uat-observation-leaf-"));
    const attempt = await observingAttempt(root);
    const current = await checkpointFile(root);
    const armed = await armCodexUatScenario({
      journalPath: attempt.journalPath,
      expectedHeadAdmission: attempt.view.head,
      checkpointPath: current.filePath,
      checkpointAdmission: current.admission,
    });
    const observationDirectory = path.join(root, "observations");
    await mkdir(observationDirectory, { mode: 0o700 });
    const observationAuthority = await retainCodexUatLeafDirectoryAuthority(
      observationDirectory,
    );
    let observation;
    try {
      observation = await publishCodexUatObservationLeaf({
        outDirectory: observationDirectory,
        attemptId: "attempt-bridge-001",
        scenario: "session-start",
        correlation: armed.correlation,
        source: "installed-hook-untrusted",
        eventDigest: digest("event"),
        runnerDigest: DIGEST_A,
        releaseDigest: DIGEST_B,
        installReceiptDigest: DIGEST_C,
        parentAuthority: observationAuthority,
      });
    } finally {
      await releaseCodexUatLeafDirectoryAuthority(observationAuthority);
    }
    assert.equal((await stat(observation.filePath)).nlink, 2);
    assert.equal(observation.value.claimsHostOrigin, false);
    assert.equal(observation.value.claimsScenarioSuccess, false);
    for (const key of [
      "realCodexSessionVerified",
      "agentPackageQualityCertified",
      "domainQualityCertified",
      "productionReady",
      "widerCompatibilityCertified",
    ]) assert.equal(observation.value[key], false, key);
    assert.equal(JSON.stringify(observation.value).includes(attempt.view.head.digest), false);

    const recorded = await recordCodexUatScenarioObservation({
      journalPath: attempt.journalPath,
      expectedHeadAdmission: attempt.view.head,
      checkpointAdmission: armed.checkpointAdmission,
      observationAdmission: observation,
      evidence: sessionStartEvidence(),
    });
    assert.equal(recorded.state.nextScenario, "skill-discovery");
    assert.equal(recorded.entries.at(-1).details.checkpointLeafDigest, armed.checkpointAdmission.digest);
    assert.equal(recorded.entries.at(-1).details.observationLeafDigest, observation.digest);

    const before = await readFile(current.filePath);
    await assert.rejects(
      recordCodexUatScenarioObservation({
        journalPath: attempt.journalPath,
        expectedHeadAdmission: recorded.head,
        checkpointAdmission: armed.checkpointAdmission,
        observationAdmission: observation,
        evidence: sessionStartEvidence(),
      }),
      (error) => [
        "AGENTMO_CODEX_UAT_SCENARIO_ORDER_REJECTED",
        "AGENTMO_CODEX_UAT_OBSERVATION_REJECTED",
      ].includes(error?.code),
    );
    assert.deepEqual(await readFile(current.filePath), before);
  });

  it("rejects caller-built observation state, caller-chosen challenge fields, and journal-derived leaf fields", async () => {
    const base = checkpoint();
    for (const codexUatChallenge of [
      { challengeDigest: DIGEST_E, scenario: "SessionStart", observation: null },
      {
        attemptId: "attempt-bridge-001",
        scenario: "session-start",
        correlation: `opaque:${"1".repeat(64)}`,
        observation: { count: 1 },
      },
      {
        attemptId: "attempt-bridge-001",
        scenario: "session-start",
        correlation: `opaque:${"1".repeat(64)}`,
        journalHeadDigest: DIGEST_A,
      },
    ]) {
      assert.throws(
        () => buildBuilderCheckpoint({ ...base, codexUatChallenge }),
        (error) => error?.code === "AGENTMO_BUILDER_CHECKPOINT_INVALID",
      );
    }

    const root = await mkdtemp(path.join(tmpdir(), "agentmo-uat-forged-leaf-"));
    const forged = {
      schemaVersion: "agentmo.codex-uat-observation.v1",
      attemptId: "attempt-bridge-001",
      scenario: CODEX_UAT_SCENARIO_IDS[0],
      correlation: `opaque:${"2".repeat(64)}`,
      source: "installed-hook-untrusted",
      eventDigest: DIGEST_A,
      runnerDigest: DIGEST_B,
      releaseDigest: DIGEST_C,
      installReceiptDigest: DIGEST_D,
      claimsHostOrigin: false,
      claimsScenarioSuccess: false,
      realCodexSessionVerified: false,
      agentPackageQualityCertified: false,
      domainQualityCertified: false,
      productionReady: false,
      widerCompatibilityCertified: false,
      journalHeadDigest: DIGEST_E,
    };
    const bytes = Buffer.from(`${JSON.stringify(forged)}\n`, "utf8");
    const expectedDigest = digestRawBytes(bytes);
    const filePath = path.join(root, `${expectedDigest.slice("sha256:".length)}.json`);
    await writeFile(filePath, bytes, { flag: "wx", mode: 0o600 });
    await assert.rejects(
      loadCodexUatObservationLeaf(filePath, { expectedDigest }),
      (error) => error?.code === "AGENTMO_CODEX_UAT_OBSERVATION_REJECTED",
    );
  });

  it("treats canonical aborted setup prefixes as recoverable history and delivers after retry commits", async () => {
    const installed = await installAuthenticHookRunner();
    const authority = installAttemptAuthority(installed.projectRoot);
    const initial = await readAppendOnlyAuthority(authority);
    const terminalPayload = structuredClone(initial.records.at(-1).payload);
    for (const boundary of ["claim", "record-stage", "prepared-stage"]) {
      const { aborted } = await appendCanonicalAbortPrefix(
        installed.projectRoot,
        boundary,
        `hook-abort-${boundary}`,
      );
      assert.equal(aborted.sequence >= initial.nextSequence, true);
      const retried = await appendRetryTerminal(
        installed.projectRoot,
        `hook-retry-${boundary}`,
        terminalPayload,
      );
      assert.equal(retried.status, "committed");
    }

    const result = await runHookRunner(installed.runnerPath, JSON.stringify({
      hook_event_name: "SessionStart",
      session_id: "canonical-abort-retry-session",
      source: "startup",
    }), installed.environment, installed.projectRoot);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(JSON.parse(result.stdout).hookSpecificOutput.hookEventName, "SessionStart");
  });

  it("fails closed when an abort outcome is hostile despite matching its local selection", async () => {
    const installed = await installAuthenticHookRunner();
    const { aborted } = await appendCanonicalAbortPrefix(
      installed.projectRoot,
      "claim",
      "hostile-abort-prefix",
    );
    await replaceOutcomeWithHostileAbort(installed.projectRoot, aborted.sequence);

    const result = await runHookRunner(installed.runnerPath, JSON.stringify({
      hook_event_name: "SessionStart",
      session_id: "hostile-abort-session",
      source: "startup",
    }), installed.environment, installed.projectRoot);
    assert.notEqual(result.code, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  });

  it("runs the anchored runtime graph after the trusted hook seed without inheriting parent Node options", async () => {
    const installed = await installAuthenticHookRunner();
    const preloadMarker = path.join(installed.root, "node-options-probe.log");
    const preloadPath = path.join(installed.root, "node-options-probe.mjs");
    await writeFile(preloadPath, `
import { appendFile } from "node:fs/promises";
await appendFile(
  ${JSON.stringify(preloadMarker)},
  process.argv.includes("__builder-hook") ? "child\\n" : "parent\\n",
);
`, { flag: "wx", mode: 0o600 });
    const payload = JSON.stringify({
      hook_event_name: "SessionStart",
      session_id: "anchored-runner-session",
      source: "startup",
    });
    const result = await runHookRunner(installed.runnerPath, payload, {
      ...installed.environment,
      AGENTMO_PARENT_CANARY: "MUST_NOT_REACH_CHILD",
      NODE_OPTIONS: `--import=${pathToFileURL(preloadPath).href}`,
    }, installed.projectRoot);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, "");
    const output = JSON.parse(result.stdout);
    assert.equal(output.hookSpecificOutput.hookEventName, "SessionStart");
    assert.match(output.hookSpecificOutput.additionalContext, /resumable at plan/u);
    assert.equal(await readFile(preloadMarker, "utf8"), "parent\n");
    const snapshots = (await readdir(installed.stateRoot))
      .filter((name) => name.startsWith("agentmo-hook-bootstrap-"));
    assert.deepEqual(snapshots, []);
  });

  it("rejects an unanchored launcher before it can inherit parent context", async () => {
    const marker = path.join(await mkdtemp(path.join(tmpdir(), "agentmo-hook-child-marker-")), "marker.json");
    const installed = await fakeInstalledRunner(`
import { writeFile } from "node:fs/promises";
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
await writeFile(${JSON.stringify(marker)}, JSON.stringify({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  execPath: process.execPath,
  env: process.env,
  input: Buffer.concat(chunks).toString("utf8")
}));
process.stdout.write(${JSON.stringify(fakeBridgeResult())});
`, "utf8");
    const payload = JSON.stringify({
      hook_event_name: "SessionStart",
      session_id: "installed-runner-session",
      source: "startup",
      transcript_path: "/private/tmp/runner-transcript",
    });
    const result = await runHookRunner(installed.hookPath, payload, {
      ...process.env,
      AGENTMO_PARENT_CANARY: "MUST_NOT_REACH_CHILD",
      NODE_OPTIONS: "--trace-warnings",
    }, installed.projectRoot);
    assert.notEqual(result.code, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "");
    await assert.rejects(readFile(marker), (error) => error?.code === "ENOENT");
  });

  it("keeps aliases, unknown events, oversized input, and unanchored delivery value-blind", async () => {
    const marker = path.join(await mkdtemp(path.join(tmpdir(), "agentmo-hook-no-spawn-")), "marker");
    const noSpawn = await fakeInstalledRunner(`
import { writeFile } from "node:fs/promises";
await writeFile(${JSON.stringify(marker)}, "spawned");
process.stdout.write(${JSON.stringify(fakeBridgeResult())});
`);
    for (const input of [
      JSON.stringify({ hookEventName: "SessionStart", session_id: "alias" }),
      JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "unknown" }),
      JSON.stringify({ hook_event_name: "SessionStart", session_id: "large", padding: "x".repeat(65 * 1024) }),
    ]) {
      const result = await runHookRunner(noSpawn.hookPath, input, process.env, noSpawn.projectRoot);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
    }
    await assert.rejects(readFile(marker), (error) => error?.code === "ENOENT");

    const unanchoredMarker = path.join(
      await mkdtemp(path.join(tmpdir(), "agentmo-hook-unanchored-no-spawn-")),
      "marker",
    );
    const unanchored = await fakeInstalledRunner(`
import { writeFile } from "node:fs/promises";
await writeFile(${JSON.stringify(unanchoredMarker)}, "spawned");
process.stdout.write(${JSON.stringify(fakeBridgeResult("PreCompact"))});
`);
    const unanchoredResult = await runHookRunner(unanchored.hookPath, JSON.stringify({
      hook_event_name: "PreCompact",
      session_id: "unanchored-session",
      transcript_path: "/private/tmp/private-transcript",
    }), process.env, unanchored.projectRoot);
    assert.notEqual(unanchoredResult.code, 0);
    assert.equal(unanchoredResult.stdout, "");
    assert.equal(unanchoredResult.stderr, "");
    await assert.rejects(readFile(unanchoredMarker), (error) => error?.code === "ENOENT");
  });
});
