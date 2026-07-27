import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  symlink,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";
import { digestRawBytes } from "../src/artifact-admission.js";
import { buildBuilderCheckpoint, writeBuilderCheckpoint } from "../src/builder-checkpoint.js";
import {
  BUILDER_SUPPORTED_PLATFORMS,
  diagnoseBuilderInstall,
  inspectBuilderPlatform,
} from "../src/builder-doctor.js";
import {
  appendImmutableJournalEntry,
  loadImmutableJournal,
} from "../src/builder-immutable-journal.js";
import {
  applyBuilderInstall,
  buildBuilderInstallPlanBasis,
  BUILDER_INSTALL_RECEIPT_PATH,
  planBuilderInstall,
} from "../src/builder-install.js";
import { assertPersistable, serializePersistableJson } from "../src/persistability.js";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const REPO_ROOT = path.resolve(".");
const AGENT_FILE = ".codex/agents/agentmo.toml";
const MARKER_FILE = ".agentmo/builder/install-marker.json";
const CHECKPOINT_FILE = ".agentmo/checkpoints/builder.json";
const execFileAsync = promisify(execFile);

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

async function installedProject() {
  const project = await mkdtemp(path.join(tmpdir(), "agentmo-doctor-project-"));
  const probe = compatibleProbe();
  const preview = await planBuilderInstall({ projectRoot: project, probe });
  const result = await applyBuilderInstall({
    projectRoot: project,
    probe,
    expectedPlanDigest: preview.planDigest,
  });
  return { project, result };
}

function nextCheckpoint(checkpoint, overrides = {}) {
  return buildBuilderCheckpoint({
    ...checkpoint,
    ...overrides,
  });
}

async function writeJournalSuccessor(checkpointPath, sequence, predecessorDigest, checkpoint) {
  const valueBytes = Buffer.from(
    serializePersistableJson(checkpoint, { subject: "builder-checkpoint" }),
    "utf8",
  );
  const entry = {
    schemaVersion: "agentmo.immutable-journal-entry.v1",
    sequence,
    predecessorDigest,
    valueDigest: digestRawBytes(valueBytes),
    valueBase64: valueBytes.toString("base64"),
  };
  const entryBytes = Buffer.from(`${JSON.stringify(entry)}\n`, "utf8");
  const publicationDigest = digestRawBytes(entryBytes).slice("sha256:".length);
  const entryPath = path.join(
    path.dirname(checkpointPath),
    `.${path.basename(checkpointPath)}.agentmo-journal.${String(sequence).padStart(12, "0")}-${publicationDigest}.json`,
  );
  await writeFile(entryPath, entryBytes, { mode: 0o600 });
  return entryPath;
}

async function stopCheckpointAppendAtPrepared(checkpointPath, canonicalBytes, sequence) {
  const journalModuleUrl = new URL("../src/builder-immutable-journal.js", import.meta.url).href;
  const script = `
import { appendImmutableJournalEntry, loadImmutableJournal } from ${JSON.stringify(journalModuleUrl)};
const [journalPath, encoded] = process.argv.slice(1);
const current = await loadImmutableJournal({ journalPath });
await appendImmutableJournalEntry({
  journalPath,
  canonicalBytes: Buffer.from(encoded, "base64"),
  expectedPredecessorAdmission: current.head,
});
`;
  const child = spawn(process.execPath, [
    "--input-type=module",
    "--eval",
    script,
    checkpointPath,
    canonicalBytes.toString("base64"),
  ], { stdio: ["ignore", "ignore", "pipe"] });
  const closed = new Promise((resolve, reject) => {
    const stderr = [];
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({
      code,
      signal,
      stderr: Buffer.concat(stderr).toString("utf8"),
    }));
  });
  const preparedName = `.${path.basename(checkpointPath)}.agentmo-journal.prepared.${String(
    sequence,
  ).padStart(12, "0")}.json`;
  const deadline = Date.now() + 15_000;
  let stopped = false;
  while (Date.now() < deadline && child.exitCode === null) {
    if ((await readdir(path.dirname(checkpointPath))).includes(preparedName)) {
      stopped = child.kill("SIGSTOP");
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.equal(stopped, true, "checkpoint append completed before its prepared claim was observed");
  child.kill("SIGKILL");
  const result = await closed;
  assert.equal(result.code, null, result.stderr);
  assert.equal(result.signal, "SIGKILL", result.stderr);
}

async function treeSnapshot(root) {
  const records = [];
  async function visit(directory, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      const stats = await lstat(absolute);
      if (entry.isDirectory()) {
        records.push(`d:${relative}:${stats.mode & 0o777}`);
        await visit(absolute, relative);
      } else if (entry.isFile()) {
        const bytes = await readFile(absolute);
        const digest = createHash("sha256").update(bytes).digest("hex");
        records.push(`f:${relative}:${stats.mode & 0o777}:${digest}`);
      } else {
        records.push(`x:${relative}:${stats.mode & 0o777}`);
      }
    }
  }
  await visit(root);
  return records.sort();
}

async function fakeCodexBin(root) {
  const bin = path.join(root, "fake-bin");
  const executable = path.join(bin, "codex");
  await mkdir(bin);
  await writeFile(executable, `#!/usr/bin/env node
const key = process.argv.slice(2).join(" ");
const outputs = {
  "--version": "codex-cli 0.144.2\\n",
  "features list": "plugins stable true\\nhooks stable true\\n",
  "plugin --help": "Usage: codex plugin [COMMAND]\\n",
  "resume --help": "Usage: codex resume [OPTIONS]\\n",
  "doctor --help": "Usage: codex doctor\\n"
};
if (!Object.hasOwn(outputs, key)) process.exitCode = 2;
else process.stdout.write(outputs[key]);
`, "utf8");
  await chmod(executable, 0o755);
  return bin;
}

async function runInstalledDoctor(project) {
  const home = await mkdtemp(path.join(tmpdir(), "agentmo-installed-doctor-home-"));
  const bin = await fakeCodexBin(home);
  await mkdir(path.join(home, ".codex"), { mode: 0o700 });
  try {
    const result = await execFileAsync(
      process.execPath,
      [path.join(REPO_ROOT, "bin/agentmo.js"), "builder", "doctor", "--project", project, "--json"],
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

describe("read-only Builder doctor", () => {
  it("declares and diagnoses the exact POSIX Builder platform contract", async () => {
    const manifest = JSON.parse(await readFile(path.join(REPO_ROOT, "package.json"), "utf8"));
    assert.equal(Object.hasOwn(manifest, "os"), false);
    assert.deepEqual(manifest.agentmo?.builder, {
      supportedPlatforms: ["darwin", "linux"],
      filesystemContract: "posix-no-follow-private-owner",
    });
    assert.deepEqual(BUILDER_SUPPORTED_PLATFORMS, ["darwin", "linux"]);
    assert.equal(inspectBuilderPlatform("darwin").supported, true);
    assert.equal(inspectBuilderPlatform("linux").supported, true);
    assert.deepEqual(inspectBuilderPlatform("win32"), {
      current: "win32",
      supported: false,
      supportedPlatforms: ["darwin", "linux"],
      filesystemContract: "posix-no-follow-private-owner",
    });
  });

  it("reports an empty project as not projected without creating state", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agentmo-doctor-empty-"));
    const before = await treeSnapshot(project);
    const report = await diagnoseBuilderInstall({ projectRoot: project });
    assert.deepEqual(await treeSnapshot(project), before);
    assert.equal(report.status, "not-projected");
    assert.equal(report.mutatesHost, false);
    assert.equal(report.receipt.status, "missing");
    assert.equal(report.agent.status, "missing-projection");
    assert.deepEqual(report.remediation, [
      "restore-required-host-capabilities",
      "run-setup-preview",
    ]);
  });

  it("rejects an unknown doctor option with an unrelated environment sentinel", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agentmo-doctor-unknown-control-"));
    let failure;
    try {
      await execFileAsync(
        process.execPath,
        [path.join(REPO_ROOT, "test/helpers/doctor-unknown-option-child.js"), project],
        {
          encoding: "utf8",
          env: { ...process.env, AGENTMO_UNRELATED_SENTINEL: "present" },
        },
      );
    } catch (error) {
      failure = error;
    }
    assert.equal(failure?.code, 1);
    assert.deepEqual(JSON.parse(failure.stdout), {
      type: "error",
      error: {
        name: "Error",
        code: "AGENTMO_BUILDER_DOCTOR_REQUEST_REJECTED",
      },
    });
    assert.deepEqual(await treeSnapshot(project), []);
  });

  it("reports declared projection, observed capabilities, and unverified activation without mutating bytes", async () => {
    const { project } = await installedProject();
    const before = await treeSnapshot(project);
    const report = await diagnoseBuilderInstall({ projectRoot: project, probe: compatibleProbe() });
    const after = await treeSnapshot(project);
    assert.deepEqual(after, before);
    assert.equal(report.status, "declared");
    assert.equal(report.mutatesHost, "unknown");
    assert.equal(report.repairsApplied, false);
    assert.equal(report.receipt.status, "valid");
    assert.equal(report.marker.status, "matching");
    assert.equal(report.release.match, true);
    assert.equal(report.capabilities.requiredOk, true);
    assert.equal(report.visibility.marketplace, "user-host-unverified");
    assert.equal(report.visibility.plugin, "user-host-unverified");
    assert.equal(report.visibility.skill, "user-host-unverified");
    assert.equal(report.visibility.hook, "user-host-unverified");
    assert.equal(report.visibility.agent, "declared");
    assert.equal(report.visibility.activation, "unverified");
    assert.equal(report.projection.status, "pristine");
    assert.equal(report.agent.status, "pristine-projection");
    assert.equal(report.checkpoint.status, "idle");
    assert.equal(report.evidence.behavior, "unverified");
    assert.equal(report.evidence.codexActivationVerified, false);
    assert.equal(report.evidence.hostBehaviorVerified, false);
    assert.equal(report.evidence.domainQualityCertified, false);
    assert.doesNotThrow(() => assertPersistable(report, { subject: "builder-doctor" }));
    assert.equal(JSON.stringify(report).includes(project), false);
  });

  it("reports external host observation mutation as unknown", async () => {
    const { project } = await installedProject();
    const result = await runInstalledDoctor(project);
    assert.equal(result.code, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, "declared");
    assert.equal(report.mutatesHost, "unknown");
    assert.equal(report.repairsApplied, false);
  });

  it("reports changed and missing receipt-owned assets without repairing either", async () => {
    const { project } = await installedProject();
    const agentPath = path.join(project, AGENT_FILE);
    const markerPath = path.join(project, MARKER_FILE);
    await writeFile(agentPath, "user edit\n", "utf8");
    await unlink(markerPath);
    const before = await treeSnapshot(project);
    const report = await diagnoseBuilderInstall({ projectRoot: project, probe: compatibleProbe() });
    assert.deepEqual(await treeSnapshot(project), before);
    assert.equal(report.status, "inconsistent");
    assert.equal(report.files.find((item) => item.relativePath === AGENT_FILE).status, "unsafe");
    assert.equal(report.files.find((item) => item.relativePath === MARKER_FILE).status, "missing");
    assert.equal(report.visibility.agent, "inconsistent");
    assert.equal(report.remediation.includes("review-receipt-owned-paths"), true);
    assert.equal((await readFile(agentPath, "utf8")), "user edit\n");
  });

  it("does not echo secret-like material from a corrupt receipt", async () => {
    const { project } = await installedProject();
    const receiptPath = path.join(project, BUILDER_INSTALL_RECEIPT_PATH);
    const canary = "sk-doctor-private-canary-123456789";
    await writeFile(receiptPath, `${JSON.stringify({ api_key: canary })}\n`, "utf8");
    const before = await treeSnapshot(project);
    const report = await diagnoseBuilderInstall({ projectRoot: project, probe: compatibleProbe() });
    assert.deepEqual(await treeSnapshot(project), before);
    assert.equal(report.status, "inconsistent");
    assert.equal(report.receipt.status, "corrupt");
    assert.equal(JSON.stringify(report).includes(canary), false);
    assert.equal(JSON.stringify(report).includes("api_key"), false);
  });

  it("rejects legacy installed receipt semantics instead of treating them as projection evidence", async () => {
    const { project } = await installedProject();
    const receiptPath = path.join(project, BUILDER_INSTALL_RECEIPT_PATH);
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    receipt.schemaVersion = "agentmo.builder-install-receipt.v1";
    receipt.status = "installed";
    receipt.evidence = {
      level: "declared-ready",
      mechanismOnly: true,
      domainQualityCertified: false,
    };
    await writeFile(
      receiptPath,
      serializePersistableJson(receipt, { subject: "builder-install-receipt" }),
      "utf8",
    );

    const report = await diagnoseBuilderInstall({ projectRoot: project, probe: compatibleProbe() });
    assert.equal(report.status, "inconsistent");
    assert.equal(report.receipt.status, "corrupt");
    assert.equal(JSON.stringify(report).includes('"installed"'), false);
  });

  it("rejects a receipt that rewrites its own project-agent digest instead of trusting the current release", async () => {
    const { project } = await installedProject();
    const hookPath = path.join(project, AGENT_FILE);
    const receiptPath = path.join(project, BUILDER_INSTALL_RECEIPT_PATH);
    const hostileHook = Buffer.from("process.stdout.write(JSON.stringify(process.env));\n", "utf8");
    await writeFile(hookPath, hostileHook);
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    const hookEntry = receipt.files.find((entry) => entry.relativePath === AGENT_FILE);
    const hostileDigest = digestRawBytes(hostileHook);
    hookEntry.sourceDigest = hostileDigest;
    hookEntry.destinationDigest = hostileDigest;
    const planBasis = buildBuilderInstallPlanBasis({
      release: {
        name: receipt.identity.name,
        version: receipt.identity.version,
        releaseDigest: receipt.identity.releaseDigest,
      },
      capabilitySnapshot: receipt.capabilitySnapshot,
      scopeDigest: receipt.scopeDigest,
      managedFiles: receipt.files,
    });
    receipt.planDigest = digestRawBytes(Buffer.from(
      serializePersistableJson(planBasis, { subject: "builder-install-plan-basis" }),
      "utf8",
    ));
    await writeFile(
      receiptPath,
      serializePersistableJson(receipt, { subject: "builder-install-receipt" }),
      "utf8",
    );

    const before = await treeSnapshot(project);
    const report = await diagnoseBuilderInstall({ projectRoot: project, probe: compatibleProbe() });
    assert.deepEqual(await treeSnapshot(project), before);
    assert.equal(report.status, "inconsistent");
    assert.equal(report.receipt.status, "corrupt");
    assert.equal(report.receipt.manifestMatch, false);
    assert.equal(report.visibility.agent, "inconsistent");
    assert.equal(report.files.find((item) => item.relativePath === AGENT_FILE).status, "unsafe");
    assert.equal(report.remediation.includes("review-receipt-owned-paths"), false);
  });

  it("reports receipt-last interruption as a partial install without repairing it", async () => {
    const { project } = await installedProject();
    await unlink(path.join(project, BUILDER_INSTALL_RECEIPT_PATH));
    const before = await treeSnapshot(project);
    const report = await diagnoseBuilderInstall({ projectRoot: project, probe: compatibleProbe() });
    assert.deepEqual(await treeSnapshot(project), before);
    assert.equal(report.status, "inconsistent");
    assert.equal(report.receipt.status, "missing");
    assert.equal(report.remediation.includes("review-partial-install"), true);
    assert.equal(report.remediation.includes("run-setup-preview"), false);
  });

  it("fails closed under an external same-byte inode swap race", async () => {
    const { project } = await installedProject();
    const target = path.join(project, AGENT_FILE);
    const alternate = `${target}.alternate`;
    const swap = `${target}.swap`;
    await copyFile(target, alternate);
    const [originalIdentity, alternateIdentity, originalBytes, alternateBytes] = await Promise.all([
      lstat(target, { bigint: true }),
      lstat(alternate, { bigint: true }),
      readFile(target),
      readFile(alternate),
    ]);
    assert.notEqual(originalIdentity.ino, alternateIdentity.ino);
    assert.deepEqual(alternateBytes, originalBytes);
    const targetStats = await lstat(target);
    await utimes(target, new Date(0), targetStats.mtime);
    const primedTarget = await lstat(target, { bigint: true });
    const child = spawn(
      process.execPath,
      [
        path.join(REPO_ROOT, "test/helpers/doctor-diagnose-child.js"),
        JSON.stringify({ projectRoot: project, probe: compatibleProbe() }),
      ],
      { stdio: ["ignore", "ignore", "ignore", "ipc"] },
    );
    let readyResolve;
    let terminalResolve;
    const ready = new Promise((resolve) => { readyResolve = resolve; });
    const terminalPromise = new Promise((resolve) => { terminalResolve = resolve; });
    const closed = new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("message", (message) => {
        if (message?.type === "ready") readyResolve(message);
        else terminalResolve(message);
      });
      child.on("close", resolve);
    });
    await ready;
    child.send({ type: "diagnose" });
    let lifecycleReadObserved = false;
    const observationDeadline = Date.now() + 10_000;
    while (Date.now() < observationDeadline) {
      const observed = await lstat(target, { bigint: true });
      if (observed.atimeNs !== primedTarget.atimeNs) {
        lifecycleReadObserved = true;
        break;
      }
      if (child.exitCode !== null || child.signalCode !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    assert.equal(lifecycleReadObserved, true, "lifecycle admission must read the original inode");
    await rename(target, swap);
    await rename(alternate, target);
    const [swappedTarget, retainedOriginal] = await Promise.all([
      lstat(target, { bigint: true }),
      lstat(swap, { bigint: true }),
    ]);
    assert.equal(swappedTarget.ino, alternateIdentity.ino);
    assert.equal(retainedOriginal.ino, originalIdentity.ino);
    assert.deepEqual(await readFile(target), originalBytes);
    const terminal = await terminalPromise;
    await closed;
    const [terminalTarget, terminalOriginal] = await Promise.all([
      lstat(target, { bigint: true }),
      lstat(swap, { bigint: true }),
    ]);
    assert.equal(terminalTarget.ino, alternateIdentity.ino);
    assert.equal(terminalOriginal.ino, originalIdentity.ino);
    assert.equal(terminal?.type, "result", terminal?.error?.code);
    const report = terminal.report;
    assert.equal(report.status, "inconsistent");
    assert.equal(report.files.find((item) => item.relativePath === AGENT_FILE).status, "unsafe");
    await rename(target, alternate);
    await rename(swap, target);
  });

  it("fails closed when an admitted parent becomes a symlink", async () => {
    const { project } = await installedProject();
    const codexDirectory = path.join(project, ".codex");
    const retainedDirectory = path.join(project, ".codex-retained");
    const externalRoot = await mkdtemp(path.join(tmpdir(), "agentmo-doctor-external-"));
    const externalCodex = path.join(externalRoot, ".codex");
    await mkdir(path.join(externalCodex, "agents"), { recursive: true });
    await copyFile(path.join(project, AGENT_FILE), path.join(externalCodex, "agents/agentmo.toml"));
    await rename(codexDirectory, retainedDirectory);
    await symlink(externalCodex, codexDirectory, "dir");
    const report = await diagnoseBuilderInstall({ projectRoot: project, probe: compatibleProbe() });
    assert.equal(report.status, "inconsistent");
    assert.equal(report.files.find((item) => item.relativePath === AGENT_FILE).status, "unsafe");
  });

  it("rejects unsafe nlink and directory/file modes without changing them", async () => {
    for (const kind of ["nlink", "file-mode", "parent-mode"]) {
      const { project } = await installedProject();
      const target = path.join(project, AGENT_FILE);
      if (kind === "nlink") await link(target, `${target}.hardlink`);
      if (kind === "file-mode") await chmod(target, 0o664);
      if (kind === "parent-mode") await chmod(path.dirname(target), 0o775);
      const before = await treeSnapshot(project);
      const report = await diagnoseBuilderInstall({
        projectRoot: project,
        probe: compatibleProbe(),
      });
      assert.deepEqual(await treeSnapshot(project), before, kind);
      assert.equal(report.status, "inconsistent", kind);
      assert.equal(report.files.find((item) => item.relativePath === AGENT_FILE).status, "unsafe", kind);
    }
  });

  it("validates a checkpoint only when it binds the exact receipt digest", async () => {
    const { project, result } = await installedProject();
    const receipt = JSON.parse(await readFile(path.join(project, BUILDER_INSTALL_RECEIPT_PATH), "utf8"));
    const checkpoint = buildBuilderCheckpoint({
      workflowId: "doctor-workflow-1",
      adapterId: "codex",
      stage: "discover",
      boundary: "artifact-created",
      artifactRefs: [{ subject: "discovery-db", path: ".agentmo/discovery.json", digest: DIGEST_A }],
      pendingDecision: null,
      nextAction: "plan",
      installReceiptDigest: result.receipt.digest,
      capabilitySnapshot: {
        adapterId: "codex",
        evidenceLevel: "observed",
        digest: receipt.capabilitySnapshot.digest,
        required: receipt.capabilitySnapshot.required,
      },
      eventLedger: { cursor: 0, recentEvents: [] },
      pauseReason: null,
    });
    const checkpointPath = path.join(project, CHECKPOINT_FILE);
    const firstAdmission = await writeBuilderCheckpoint(checkpointPath, checkpoint);
    const before = await treeSnapshot(project);
    const report = await diagnoseBuilderInstall({ projectRoot: project, probe: compatibleProbe() });
    assert.deepEqual(await treeSnapshot(project), before);
    assert.equal(report.status, "declared");
    assert.equal(report.checkpoint.status, "valid");
    assert.equal(report.checkpoint.receiptBinding, "matching");
    assert.equal(report.checkpoint.headDigest, firstAdmission.digest);
    assert.equal(report.checkpoint.sequence, 0);

    const changed = nextCheckpoint(checkpoint, {
      installReceiptDigest: `sha256:${"b".repeat(64)}`,
    });
    const changedAdmission = await writeBuilderCheckpoint(checkpointPath, changed, {
      expectedPreviousAdmission: firstAdmission,
    });
    const mismatch = await diagnoseBuilderInstall({ projectRoot: project, probe: compatibleProbe() });
    assert.equal(mismatch.status, "inconsistent");
    assert.equal(mismatch.checkpoint.status, "receipt-mismatch");
    assert.equal(mismatch.checkpoint.headDigest, changedAdmission.digest);
    assert.equal(mismatch.checkpoint.sequence, 1);
  });

  it("fails closed while an exact checkpoint successor remains prepared but uncommitted", async () => {
    const { project, result } = await installedProject();
    const receipt = JSON.parse(await readFile(
      path.join(project, BUILDER_INSTALL_RECEIPT_PATH),
      "utf8",
    ));
    const checkpointPath = path.join(project, CHECKPOINT_FILE);
    const checkpoint = buildBuilderCheckpoint({
      workflowId: "doctor-checkpoint-recovery",
      adapterId: "codex",
      stage: "discover",
      boundary: "artifact-created",
      artifactRefs: [],
      pendingDecision: null,
      nextAction: "plan",
      installReceiptDigest: result.receipt.digest,
      capabilitySnapshot: {
        adapterId: "codex",
        evidenceLevel: "observed",
        digest: receipt.capabilitySnapshot.digest,
        required: receipt.capabilitySnapshot.required,
      },
      eventLedger: { cursor: 0, recentEvents: [] },
      pauseReason: null,
    });
    await writeBuilderCheckpoint(checkpointPath, checkpoint);
    const successor = nextCheckpoint(checkpoint, {
      boundary: "manual-pause",
      pauseReason: "user-request",
    });
    const successorBytes = Buffer.from(
      serializePersistableJson(successor, { subject: "builder-checkpoint" }),
      "utf8",
    );
    await stopCheckpointAppendAtPrepared(checkpointPath, successorBytes, 1);

    const interrupted = await loadImmutableJournal({ journalPath: checkpointPath });
    assert.equal(interrupted.recoveryRequired, true);
    assert.equal(interrupted.entries.length, 1);
    const report = await diagnoseBuilderInstall({ projectRoot: project, probe: compatibleProbe() });
    assert.equal(report.status, "inconsistent");
    assert.equal(report.projection.status, "inconsistent");
    assert.equal(report.checkpoint.status, "recovery-required");
    assert.equal(report.checkpoint.receiptBinding, "unverified");
    assert.equal(report.checkpoint.headDigest, interrupted.head.digest);
    assert.equal(report.checkpoint.sequence, interrupted.head.sequence);
    assert.equal(report.remediation.includes("review-checkpoint-binding"), true);

    const recovered = await appendImmutableJournalEntry({
      journalPath: checkpointPath,
      canonicalBytes: successorBytes,
      expectedPredecessorAdmission: interrupted.head,
    });
    assert.equal(recovered.committed, true);
    assert.equal((await loadImmutableJournal({ journalPath: checkpointPath })).recoveryRequired, false);
    const healthy = await diagnoseBuilderInstall({ projectRoot: project, probe: compatibleProbe() });
    assert.equal(healthy.status, "declared");
    assert.equal(healthy.checkpoint.status, "valid");
    assert.equal(healthy.checkpoint.sequence, 1);
  });

  it("never selects a head from a fork, gap, orphan, malformed, or unsafe checkpoint journal", async () => {
    for (const kind of ["fork", "gap", "orphan", "malformed", "unsafe-metadata"]) {
      const { project, result } = await installedProject();
      const receipt = JSON.parse(await readFile(path.join(project, BUILDER_INSTALL_RECEIPT_PATH), "utf8"));
      const checkpointPath = path.join(project, CHECKPOINT_FILE);
      const checkpoint = buildBuilderCheckpoint({
        workflowId: `doctor-hostile-${kind}`,
        adapterId: "codex",
        stage: "discover",
        boundary: "artifact-created",
        artifactRefs: [],
        pendingDecision: null,
        nextAction: "plan",
        installReceiptDigest: result.receipt.digest,
        capabilitySnapshot: {
          adapterId: "codex",
          evidenceLevel: "observed",
          digest: receipt.capabilitySnapshot.digest,
          required: receipt.capabilitySnapshot.required,
        },
        eventLedger: { cursor: 0, recentEvents: [] },
        pauseReason: null,
      });
      const genesis = await writeBuilderCheckpoint(checkpointPath, checkpoint);
      if (kind === "unsafe-metadata") {
        await chmod(checkpointPath, 0o660);
      } else if (kind === "malformed") {
        const malformed = Buffer.from("{}\n", "utf8");
        const name = `.${path.basename(checkpointPath)}.agentmo-journal.000000000001-${digestRawBytes(malformed).slice("sha256:".length)}.json`;
        await writeFile(path.join(path.dirname(checkpointPath), name), malformed, { mode: 0o600 });
      } else {
        const first = nextCheckpoint(checkpoint, { workflowId: `doctor-hostile-${kind}-a` });
        const second = nextCheckpoint(checkpoint, { workflowId: `doctor-hostile-${kind}-b` });
        if (kind === "fork") {
          await writeJournalSuccessor(checkpointPath, 1, genesis.digest, first);
          await writeJournalSuccessor(checkpointPath, 1, genesis.digest, second);
        } else if (kind === "gap") {
          await writeJournalSuccessor(checkpointPath, 2, genesis.digest, first);
        } else {
          await writeJournalSuccessor(checkpointPath, 1, DIGEST_A, first);
        }
      }
      const before = await treeSnapshot(project);
      const report = await diagnoseBuilderInstall({ projectRoot: project, probe: compatibleProbe() });
      assert.deepEqual(await treeSnapshot(project), before, kind);
      assert.equal(report.status, "inconsistent", kind);
      assert.equal(["corrupt", "unsafe"].includes(report.checkpoint.status), true, kind);
      assert.equal(Object.hasOwn(report.checkpoint, "headDigest"), false, kind);
      assert.equal(Object.hasOwn(report.checkpoint, "sequence"), false, kind);
      assert.equal(JSON.stringify(report.checkpoint).includes(project), false, kind);
    }
  });

  it("returns bounded diagnostics from the installed launcher for missing and corrupt receipts", async () => {
    for (const receiptState of ["missing", "corrupt"]) {
      const { project } = await installedProject();
      const receiptPath = path.join(project, BUILDER_INSTALL_RECEIPT_PATH);
      if (receiptState === "missing") await unlink(receiptPath);
      else await writeFile(receiptPath, "{}", "utf8");
      const before = await treeSnapshot(project);
      const result = await runInstalledDoctor(project);
      assert.equal(result.code, 1, result.stderr);
      const report = JSON.parse(result.stdout);
      assert.deepEqual(await treeSnapshot(project), before);
      assert.equal(report.status, "inconsistent", JSON.stringify({
        report,
        stderr: result.stderr,
      }));
      assert.equal(report.receipt.status, receiptState);
      assert.equal(report.repairsApplied, false);
      assert.equal(report.release.inspection.source, "source-tree");
      assert.equal(report.release.inspection.diagnosticOnly, true);
      assert.equal(report.release.inspection.trustAnchorVerified, false);
      assert.equal(report.release.inspection.supportCertified, false);
      assert.equal(report.evidence.packageTrustVerified, false);
      assert.equal(report.evidence.codexActivationVerified, false);
      assert.equal(report.evidence.hostBehaviorVerified, false);
      assert.equal(report.evidence.domainQualityCertified, false);
    }
  });

  it("reports changed project-owned bytes through the launcher without repairing them", async () => {
    const { project } = await installedProject();
    const agentPath = path.join(project, AGENT_FILE);
    const markerPath = path.join(project, MARKER_FILE);
    await writeFile(agentPath, "user agent edit\n", "utf8");
    await writeFile(markerPath, `${await readFile(markerPath, "utf8")}\n`, "utf8");
    const before = await treeSnapshot(project);
    const result = await runInstalledDoctor(project);
    assert.equal(result.code, 1, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(await treeSnapshot(project), before);
    assert.equal(report.status, "inconsistent", JSON.stringify({
      report,
      stderr: result.stderr,
    }));
    assert.equal(report.repairsApplied, false);
    assert.equal(report.files.find((item) => item.relativePath === AGENT_FILE).status, "unsafe");
    assert.equal(report.files.find((item) => item.relativePath === MARKER_FILE).status, "unsafe");
    assert.equal(report.visibility.agent, "inconsistent");
    assert.equal(report.release.inspection.diagnosticOnly, true);
    assert.equal(report.release.inspection.trustAnchorVerified, false);
    assert.equal(report.evidence.packageTrustVerified, false);
    assert.equal(report.evidence.codexActivationVerified, false);
    assert.equal(report.evidence.hostBehaviorVerified, false);
    assert.equal(report.evidence.domainQualityCertified, false);
  });
});
