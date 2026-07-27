import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { lstat, mkdtemp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promisify } from "node:util";
import { before, describe, it } from "node:test";
import { digestRawBytes } from "../src/artifact-admission.js";
import {
  buildBuilderCheckpoint,
  loadBuilderCheckpoint,
  writeBuilderCheckpoint,
} from "../src/builder-checkpoint.js";
import { buildBuilderEvent } from "../src/builder-events.js";
import {
  publishCodexUatObservationLeaf,
} from "../src/builder-codex-uat.js";
import { serializePersistableJson } from "../src/persistability.js";

const CLI = fileURLToPath(new URL("../bin/agentmo.js", import.meta.url));
const CLI_MODULE_URL = new URL("../src/cli.js", import.meta.url).href;
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const execFileAsync = promisify(execFile);
const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;

function checkpoint() {
  return buildBuilderCheckpoint({
    workflowId: "workflow-cli-1",
    adapterId: "codex",
    stage: "discover",
    boundary: "artifact-created",
    artifactRefs: [{ subject: "discovery-db", path: ".agentmo/discovery.json", digest: DIGEST_A }],
    pendingDecision: null,
    nextAction: "plan",
    installReceiptDigest: null,
    capabilitySnapshot: {
      adapterId: "codex",
      evidenceLevel: "observed",
      digest: DIGEST_B,
      required: [{ id: "codex-cli", status: "observed" }],
    },
    eventLedger: { cursor: 0, recentEvents: [] },
    pauseReason: null,
  });
}

function startCli(args, options = {}) {
  const child = spawn(process.execPath, [CLI, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    env: options.env ?? process.env,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({
      code,
      signal,
      stdout,
      stderr,
    }));
  });
  return { child, exited };
}

function runCli(args, options = {}) {
  return startCli(args, options).exited;
}

async function createCliRuntime(prefix) {
  const home = await mkdtemp(path.join(tmpdir(), prefix));
  const codexHome = path.join(home, ".codex");
  const bin = path.join(home, "bin");
  await Promise.all([
    mkdir(codexHome, { mode: 0o700 }),
    mkdir(bin, { mode: 0o700 }),
  ]);
  await writeFile(path.join(bin, "codex"), `#!/usr/bin/env node
const outputs = {
  "--version": "codex-cli 0.144.2\\n",
  "features list": "plugins stable true\\nhooks stable true\\n",
  "plugin --help": "Usage: codex plugin [COMMAND]\\n",
  "resume --help": "Usage: codex resume [OPTIONS]\\n",
  "doctor --help": "Usage: codex doctor\\n"
};
const key = process.argv.slice(2).join(" ");
if (Object.hasOwn(outputs, key)) process.stdout.write(outputs[key]);
else process.exitCode = 2;
`, { mode: 0o700 });
  return {
    home,
    codexHome,
    bin,
    env: {
      HOME: home,
      CODEX_HOME: codexHome,
      LANG: "C",
      LC_ALL: "C",
      PATH: [
        bin,
        path.dirname(process.execPath),
        "/usr/bin",
        "/bin",
      ].join(path.delimiter),
    },
  };
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

async function writeUatRequest(root, name, transition, details) {
  const filePath = path.join(root, `${name}.json`);
  const bytes = Buffer.from(serializePersistableJson({
    schemaVersion: "agentmo.codex-uat-record-request.v1",
    transition,
    details,
  }, { subject: "builder-codex-uat-record-request" }), "utf8");
  await writeFile(filePath, bytes, { flag: "wx", mode: 0o600 });
  return { filePath, digest: digestRawBytes(bytes) };
}

function uatDigest(label) {
  return digestRawBytes(Buffer.from(`${label}\n`, "utf8"));
}

let uatReleaseFixture;

function uatStartDetails() {
  return {
    baseline: {
      packageRoot: "baseline/package",
      tarballPath: `releases/agentmo-${uatReleaseFixture.baselineVersion}.tgz`,
    },
    successor: {
      packageRoot: "successor/package",
      tarballPath: `releases/agentmo-${uatReleaseFixture.successorVersion}.tgz`,
    },
  };
}

async function buildUatReleaseFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-cli-uat-releases-"));
  const out = path.join(root, "releases");
  const baselineVersion = "0.1.0-uat.18.3";
  const successorVersion = "0.1.0-uat.18.4";
  const built = await execFileAsync(process.execPath, [
    path.join(REPO_ROOT, "scripts", "build-builder-uat-releases.js"),
    "--out", out,
    "--baseline-version", baselineVersion,
    "--successor-version", successorVersion,
    "--json",
  ], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  const identity = JSON.parse(built.stdout);
  const baselineTarball = path.join(out, `agentmo-${baselineVersion}.tgz`);
  const successorTarball = path.join(out, `agentmo-${successorVersion}.tgz`);
  const baselineExtract = path.join(root, "baseline");
  const successorExtract = path.join(root, "successor");
  await Promise.all([mkdir(baselineExtract), mkdir(successorExtract)]);
  await Promise.all([
    execFileAsync("tar", ["-xzf", baselineTarball, "-C", baselineExtract]),
    execFileAsync("tar", ["-xzf", successorTarball, "-C", successorExtract]),
  ]);
  return {
    root,
    identity,
    baselineVersion,
    successorVersion,
    baselineTarball,
    successorTarball,
    baselinePackage: path.join(baselineExtract, "package"),
    successorPackage: path.join(successorExtract, "package"),
  };
}

async function writeStartUatRequest(testRoot, name = "start") {
  return writeUatRequest(
    uatReleaseFixture.root,
    `${path.basename(testRoot)}-${name}`,
    "attempt-started",
    uatStartDetails(),
  );
}

async function writeCliEvidence(root, name, value, subject = "codex-uat-cli-evidence") {
  const filePath = path.join(root, name);
  const bytes = Buffer.isBuffer(value)
    ? value
    : Buffer.from(serializePersistableJson(value, { subject }), "utf8");
  await writeFile(filePath, bytes, { flag: "wx", mode: 0o600 });
  return { filePath, digest: digestRawBytes(bytes) };
}

async function snapshotDirectory(root) {
  return Promise.all((await readdir(root)).toSorted().map(async (name) => {
    const filePath = path.join(root, name);
    const info = await stat(filePath);
    return [name, info.isFile() ? await readFile(filePath) : null];
  }));
}

async function snapshotTree(root, relativeRoot = "") {
  const directory = relativeRoot === "" ? root : path.join(root, relativeRoot);
  const entries = await readdir(directory, { withFileTypes: true });
  const snapshot = [];
  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = relativeRoot === "" ? entry.name : path.join(relativeRoot, entry.name);
    const filePath = path.join(root, relativePath);
    const info = await lstat(filePath, { bigint: true });
    snapshot.push({
      path: relativePath.split(path.sep).join("/"),
      kind: entry.isDirectory() ? "directory" : entry.isSymbolicLink() ? "symlink" : "file",
      device: info.dev.toString(10),
      inode: info.ino.toString(10),
      links: info.nlink.toString(10),
      bytes: entry.isFile() ? await readFile(filePath) : null,
    });
    if (entry.isDirectory()) snapshot.push(...await snapshotTree(root, relativePath));
  }
  return snapshot;
}

async function runUatMutation(action, root, request, expectedHeadDigest = null, extra = []) {
  return runCli([
    "builder", "codex-uat", action,
    "--journal", path.join(root, "attempt.journal"),
    ...(expectedHeadDigest === null ? [] : ["--expected-head-sha256", expectedHeadDigest]),
    "--request", request.filePath,
    "--digest", `builder-codex-uat-record-request=${request.digest}`,
    ...extra,
    "--json",
  ]);
}

describe("builder CLI platform boundary", () => {
  it("advertises POSIX-only support, gates Builder dispatch, and leaves other commands available", async () => {
    const help = await runCli(["--help"]);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /Builder platform: POSIX only \(darwin, linux\)\. Windows is unsupported\./u);
    assert.match(help.stdout, /--uat-journal <journal-file>/u);
    assert.match(help.stdout, /codex-uat inspect --journal <journal-file>/u);
    assert.doesNotMatch(help.stdout, /--(?:uat-)?journal <attempt-dir>/u);

    const source = [
      'Object.defineProperty(process, "platform", { value: "win32" });',
      `const { main } = await import(${JSON.stringify(CLI_MODULE_URL)});`,
      'await main(["builder", "probe", "--json"]);',
    ].join("\n");
    const result = await new Promise((resolveResult) => {
      const child = spawn(process.execPath, ["--input-type=module", "--eval", source], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("close", (code) => resolveResult({ code, stdout, stderr }));
    });
    assert.equal(result.code, 1);
    assert.equal(result.stderr, "");
    assert.equal(JSON.parse(result.stdout).code, "AGENTMO_CLI_BUILDER_PLATFORM_UNSUPPORTED");

    const nonBuilderSource = [
      'Object.defineProperty(process, "platform", { value: "win32" });',
      `const { main } = await import(${JSON.stringify(CLI_MODULE_URL)});`,
      'await main(["runtime-check", "--target", "openclaw", "--json"]);',
    ].join("\n");
    const nonBuilderResult = await new Promise((resolveResult) => {
      const child = spawn(process.execPath, ["--input-type=module", "--eval", nonBuilderSource], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("close", (code) => resolveResult({ code, stdout, stderr }));
    });
    assert.equal(nonBuilderResult.code, 0);
    assert.equal(nonBuilderResult.stderr, "");
    assert.notEqual(
      JSON.parse(nonBuilderResult.stdout).code,
      "AGENTMO_CLI_BUILDER_PLATFORM_UNSUPPORTED",
    );
  });
});

describe("builder CLI checkpoint lifecycle", () => {
  it("persists a proposal-only manual pause with a new exact digest", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-builder-cli-pause-"));
    const input = path.join(root, "input.json");
    const output = path.join(root, "output.json");
    const written = await writeBuilderCheckpoint(input, checkpoint());
    const result = await runCli([
      "builder", "pause",
      "--checkpoint", input,
      "--digest", `builder-checkpoint=${written.digest}`,
      "--event-id", "pause-cli-1",
      "--out", output,
      "--json",
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, "");
    const report = JSON.parse(result.stdout);
    assert.equal(report.action, "pause");
    assert.equal(report.applied, true);
    assert.equal(report.automaticApproval, false);
    assert.equal(report.automaticStageAdvance, false);
    const loaded = await loadBuilderCheckpoint(output, { expectedDigest: report.checkpoint.digest });
    assert.equal(loaded.value.boundary, "manual-pause");
    assert.equal(loaded.value.eventLedger.cursor, 1);
    assert.equal(loaded.value.stage, "discover");
    assert.equal(result.stdout.includes(root), false);
  });

  it("applies a hook once and no-ops the duplicate after disk reload", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-builder-cli-hook-"));
    const input = path.join(root, "input.json");
    const firstOutput = path.join(root, "first.json");
    const duplicateOutput = path.join(root, "duplicate.json");
    const eventFile = path.join(root, "event.json");
    const checkpointWrite = await writeBuilderCheckpoint(input, checkpoint());
    const event = buildBuilderEvent({
      workflowId: "workflow-cli-1",
      adapterId: "codex",
      eventId: "session-cli-1",
      sequence: 1,
      origin: "hook",
      type: "SessionStart",
      data: {},
    });
    const eventBytes = Buffer.from(serializePersistableJson(event, { subject: "builder-event" }), "utf8");
    await writeFile(eventFile, eventBytes);
    const eventDigest = digestRawBytes(eventBytes);

    const first = await runCli([
      "builder", "hook",
      "--checkpoint", input,
      "--digest", `builder-checkpoint=${checkpointWrite.digest}`,
      "--event", eventFile,
      "--digest", `builder-event=${eventDigest}`,
      "--out", firstOutput,
      "--json",
    ]);
    assert.equal(first.code, 0, first.stderr);
    const firstReport = JSON.parse(first.stdout);
    assert.equal(firstReport.status, "applied");
    assert.equal(firstReport.proposal.requiresApproval, true);
    assert.equal(firstReport.checkpoint.eventCursor, 1);

    const duplicate = await runCli([
      "builder", "hook",
      "--checkpoint", firstOutput,
      "--digest", `builder-checkpoint=${firstReport.checkpoint.digest}`,
      "--event", eventFile,
      "--digest", `builder-event=${eventDigest}`,
      "--out", duplicateOutput,
      "--json",
    ]);
    assert.equal(duplicate.code, 0, duplicate.stderr);
    const duplicateReport = JSON.parse(duplicate.stdout);
    assert.equal(duplicateReport.status, "duplicate");
    assert.equal(duplicateReport.applied, false);
    assert.equal(duplicateReport.checkpoint.digest, firstReport.checkpoint.digest);
    assert.equal(duplicateReport.checkpoint.eventCursor, 1);
  });

  it("rejects a core-labelled transition at the hook boundary before writing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-builder-cli-origin-"));
    const input = path.join(root, "input.json");
    const output = path.join(root, "output.json");
    const eventFile = path.join(root, "event.json");
    const checkpointWrite = await writeBuilderCheckpoint(input, checkpoint());
    const event = buildBuilderEvent({
      workflowId: "workflow-cli-1",
      adapterId: "codex",
      eventId: "core-transition-cli-1",
      sequence: 1,
      origin: "core",
      type: "StageTransition",
      data: { toStage: "plan" },
    });
    const eventBytes = Buffer.from(serializePersistableJson(event, { subject: "builder-event" }), "utf8");
    await writeFile(eventFile, eventBytes);
    const result = await runCli([
      "builder", "hook",
      "--checkpoint", input,
      "--digest", `builder-checkpoint=${checkpointWrite.digest}`,
      "--event", eventFile,
      "--digest", `builder-event=${digestRawBytes(eventBytes)}`,
      "--out", output,
      "--json",
    ]);
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stdout).code, "AGENTMO_BUILDER_EVENT_ORIGIN_REJECTED");
    await assert.rejects(() => stat(output), (error) => error?.code === "ENOENT");
    assert.equal(result.stdout.includes(root), false);
  });
});

describe("builder CLI explicit install recovery", () => {
  it("keeps inspect and preview read-only, then supersedes without physical deletion", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agentmo-builder-cli-recovery-"));
    const runtime = await createCliRuntime("agentmo-builder-cli-recovery-home-");
    const setupPreview = await runCli([
      "builder", "setup", "--project", project, "--json",
    ], { env: runtime.env });
    assert.equal(setupPreview.code, 0, `${setupPreview.stderr}${setupPreview.stdout}`);
    const setup = JSON.parse(setupPreview.stdout);
    const running = startCli([
      "builder", "setup", "--project", project,
      "--apply", "--plan-digest", setup.planDigest, "--json",
    ], { env: runtime.env });
    try {
      await waitForObservation(
        running,
        "durable prepared CLI install",
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
    await assert.rejects(
      () => stat(path.join(project, ".agentmo/builder/install-receipt.json")),
      (error) => error?.code === "ENOENT",
    );
    const before = await snapshotTree(project);

    const inspected = await runCli([
      "builder", "recover", "inspect", "--project", project, "--json",
    ], { env: runtime.env });
    assert.equal(inspected.code, 0, inspected.stderr);
    const inspection = JSON.parse(inspected.stdout);
    assert.equal(inspection.status, "prepared");
    assert.equal(inspection.attempt.schemaVersion, "agentmo.builder-install-attempt.v1");
    assert.match(inspection.authorityDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.deepEqual(await snapshotTree(project), before);

    const previewed = await runCli([
      "builder", "recover", "preview", "--project", project, "--json",
    ], { env: runtime.env });
    assert.equal(previewed.code, 0, previewed.stderr);
    const preview = JSON.parse(previewed.stdout);
    assert.equal(preview.status, "ready");
    assert.equal(preview.applicable, true);
    assert.equal(preview.operations.at(-1).operation, "append-superseded-outcome");
    assert.match(preview.planDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.deepEqual(await snapshotTree(project), before);

    const stale = await runCli([
      "builder", "recover", "apply", "--project", project,
      "--plan-digest", DIGEST_A, "--json",
    ], { env: runtime.env });
    assert.equal(stale.code, 1);
    assert.equal(JSON.parse(stale.stdout).code, "AGENTMO_BUILDER_INSTALL_RECOVERY_PLAN_CHANGED");
    assert.deepEqual(await snapshotTree(project), before);

    const applied = await runCli([
      "builder", "recover", "apply", "--project", project,
      "--plan-digest", preview.planDigest, "--json",
    ], { env: runtime.env });
    assert.equal(applied.code, 0, applied.stderr);
    const result = JSON.parse(applied.stdout);
    assert.equal(result.status, "superseded");
    assert.equal(result.physicalDeletion, false);
    assert.equal(result.newSetupAllowed, true);
    const retryPreview = await runCli([
      "builder", "setup", "--project", project, "--json",
    ], { env: runtime.env });
    assert.equal(retryPreview.code, 0, `${retryPreview.stderr}${retryPreview.stdout}`);
    const retryPlan = JSON.parse(retryPreview.stdout);
    const retryApplied = await runCli([
      "builder", "setup", "--project", project,
      "--apply", "--plan-digest", retryPlan.planDigest, "--json",
    ], { env: runtime.env });
    assert.equal(retryApplied.code, 0, `${retryApplied.stderr}${retryApplied.stdout}`);
    const retry = JSON.parse(retryApplied.stdout);
    assert.equal(retry.status, "projected");
    assert.equal(`${inspected.stdout}${previewed.stdout}${applied.stdout}`.includes(project), false);
  });

  it("rejects aliases, implicit apply, digests on inspect, and extra authority fields", async () => {
    for (const args of [
      ["builder", "recover", "repair", "--json"],
      ["builder", "recover", "apply", "--json"],
      ["builder", "recover", "inspect", "--plan-digest", DIGEST_A, "--json"],
      ["builder", "recover", "preview", "--apply", "--json"],
      ["builder", "recover", "apply", "--plan-digest", DIGEST_A, "--force", "--json"],
    ]) {
      const result = await runCli(args);
      assert.equal(result.code, 1);
      assert.equal(JSON.parse(result.stdout).code, "AGENTMO_CLI_BUILDER_REJECTED");
    }
  });
});

describe("builder CLI selector owner authority", () => {
  const OWNER_DIGEST = `sha256:${"c".repeat(64)}`;
  const LEDGER_DIGEST = `sha256:${"d".repeat(64)}`;

  it("rejects the former explicit removal syntax before reading host evidence", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "agentmo-builder-cli-owner-home-"));
    const result = await runCli([
      "builder", "uninstall",
      "--project", home,
      "--host-scope", "user",
      "--remove-host-selector",
      "--digest", `codex-selector-owner=${OWNER_DIGEST}`,
      "--digest", `codex-consumer-ledger=${LEDGER_DIGEST}`,
      "--json",
    ], {
      env: {
        ...process.env,
        HOME: home,
        CODEX_HOME: path.join(home, ".codex"),
      },
    });
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stdout).code, "AGENTMO_BUILDER_V1_PHYSICAL_REMOVAL_UNSUPPORTED");
    assert.equal(result.stdout.includes(home), false);
  });

  it("rejects every selector removal spelling without executing a host command", async () => {
    const base = [
      "builder", "uninstall",
      "--host-scope", "user",
      "--remove-host-selector",
    ];
    const invalid = [
      [...base, "--digest", `codex-selector-owner=${OWNER_DIGEST}`],
      [
        ...base,
        "--digest", `codex-selector-owner=${OWNER_DIGEST}`,
        "--digest", `codex-selector-owner=${OWNER_DIGEST}`,
        "--digest", `codex-consumer-ledger=${LEDGER_DIGEST}`,
      ],
      [
        ...base,
        "--digest", `builder-install-receipt=${DIGEST_A}`,
        "--digest", `codex-selector-owner=${OWNER_DIGEST}`,
        "--digest", `codex-consumer-ledger=${LEDGER_DIGEST}`,
      ],
      [...base, "--selector", "other@marketplace"],
      [...base, "--argv", "plugin remove other"],
      [...base, "--path", "/host/cache"],
    ];
    for (const args of invalid) {
      const result = await runCli([...args, "--json"]);
      assert.equal(result.code, 1);
      assert.equal(
        [
          "AGENTMO_BUILDER_V1_PHYSICAL_REMOVAL_UNSUPPORTED",
          "AGENTMO_CLI_BUILDER_REJECTED",
        ].includes(JSON.parse(result.stdout).code),
        true,
      );
    }
  });
});

describe("builder CLI host projection authority", () => {
  const OWNER_DIGEST = `sha256:${"c".repeat(64)}`;
  const LEDGER_DIGEST = `sha256:${"d".repeat(64)}`;

  it("keeps host transfer and migration unavailable in v1 even with former exact authority", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "agentmo-builder-cli-projection-home-"));
    const common = [
      "--host-scope", "user",
      "--digest", `codex-selector-owner=${OWNER_DIGEST}`,
      "--digest", `codex-consumer-ledger=${LEDGER_DIGEST}`,
      "--consumer", home,
      "--receipt-digest", DIGEST_A,
      "--json",
    ];
    for (const command of [
      ["builder", "host-transfer", "--target", "stable-agentmo-local", ...common],
      ["builder", "host-migrate", ...common],
    ]) {
      const result = await runCli(command, {
        env: { ...process.env, HOME: home, CODEX_HOME: path.join(home, ".codex") },
      });
      assert.equal(result.code, 1);
      assert.equal(JSON.parse(result.stdout).code, "AGENTMO_CLI_UNKNOWN_BUILDER_ACTION");
      assert.equal(result.stdout.includes(home), false);
    }
  });

  it("rejects implicit and caller-selected host mutation surfaces as unknown actions", async () => {
    const base = [
      "builder", "host-transfer",
      "--host-scope", "user",
      "--target", "stable-agentmo-local",
      "--digest", `codex-selector-owner=${OWNER_DIGEST}`,
      "--digest", `codex-consumer-ledger=${LEDGER_DIGEST}`,
      "--consumer", ".",
      "--receipt-digest", DIGEST_A,
    ];
    const invalid = [
      base.filter((value, index) => !(value === "--target" || base[index - 1] === "--target")),
      [...base, "--consumer", "."],
      [...base.slice(0, 4), "caller-root", ...base.slice(5)],
      [...base, "--argv", "plugin marketplace add foreign"],
      [...base, "--cwd", "/tmp"],
      [...base, "--env", "HOME=/tmp"],
      [...base, "--executable", "other-codex"],
    ];
    for (const args of invalid) {
      const result = await runCli([...args, "--json"]);
      assert.equal(result.code, 1);
      assert.equal(JSON.parse(result.stdout).code, "AGENTMO_CLI_UNKNOWN_BUILDER_ACTION");
    }
  });
});

describe("builder CLI closed Codex UAT journal", () => {
  before(async () => {
    uatReleaseFixture = await buildUatReleaseFixture();
  });
  it("rejects drive-qualified, UNC, absolute, and mixed-separator evidence references", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-cli-uat-path-boundary-"));
    const valid = uatStartDetails();
    const hostileRefs = [
      "C:\\outside\\package",
      "C:outside\\package",
      "\\\\server\\share\\package",
      "/outside/package",
      "nested\\..\\outside",
      "nested//outside",
    ];
    let persistabilityRejections = 0;
    let resolverRejections = 0;
    for (const [index, hostileRef] of hostileRefs.entries()) {
      let request;
      try {
        request = await writeUatRequest(root, `hostile-path-${index}`, "attempt-started", {
          baseline: { ...valid.baseline, packageRoot: hostileRef },
          successor: valid.successor,
        });
      } catch (error) {
        assert.equal(error?.code, "AGENTMO_PERSISTABILITY_SENSITIVE_MATERIAL", hostileRef);
        persistabilityRejections += 1;
        continue;
      }
      const journalPath = path.join(root, `attempt-${index}.journal`);
      const result = await runCli([
        "builder", "codex-uat", "start",
        "--journal", journalPath,
        "--attempt-id", `attempt-path-${index}`,
        "--request", request.filePath,
        "--digest", `builder-codex-uat-record-request=${request.digest}`,
        "--json",
      ]);
      assert.equal(result.code, 1, hostileRef);
      assert.equal(JSON.parse(result.stdout).code, "AGENTMO_CLI_BUILDER_REJECTED");
      await assert.rejects(() => stat(journalPath), (error) => error?.code === "ENOENT");
      resolverRejections += 1;
    }
    assert.ok(persistabilityRejections > 0);
    assert.ok(resolverRejections > 0);
  });

  it("exposes only the exact packed continuation argument surface with bounded failures", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-cli-uat-continuation-"));
    const exact = [
      "builder", "codex-uat", "continue",
      "--attempt-dir", path.join(root, "attempt"),
      "--expected-head-sha256", DIGEST_A,
      "--approved-deactivation-plan-sha256", DIGEST_B,
      "--successor-tarball", path.join(root, "successor.tgz"),
      "--expected-successor-version", "1.1.0",
      "--expected-release-sha256", uatDigest("release"),
      "--expected-tarball-sha256", uatDigest("tarball"),
      "--expected-verifier-sha256", uatDigest("verifier"),
    ];
    const result = await runCli(exact);
    assert.equal(result.code, 1);
    assert.match(`${result.stdout}${result.stderr}`, /Code: AGENTMO_CODEX_UAT_CONTINUATION_REJECTED/u);
    assert.equal(`${result.stdout}${result.stderr}`.includes(root), false);

    for (const hostile of [
      exact.slice(0, -2),
      [...exact, "--candidate", path.join(root, "caller-candidate.json")],
      [...exact, "--json"],
      [...exact, "--expected-verifier-sha256", uatDigest("duplicate")],
    ]) {
      const rejected = await runCli(hostile);
      assert.equal(rejected.code, 1);
      assert.match(`${rejected.stdout}${rejected.stderr}`, /(?:Code: |"code":\s*")AGENTMO_CLI_BUILDER_REJECTED/u);
      assert.equal(`${rejected.stdout}${rejected.stderr}`.includes(root), false);
    }
  });

  it("exposes start, inspect and derived resume without mutable-run aliases or byte changes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-cli-uat-readonly-"));
    const startRequest = await writeStartUatRequest(root);
    const started = await runCli([
      "builder", "codex-uat", "start",
      "--journal", path.join(root, "attempt.journal"),
      "--attempt-id", "attempt-cli-001",
      "--request", startRequest.filePath,
      "--digest", `builder-codex-uat-record-request=${startRequest.digest}`,
      "--json",
    ]);
    assert.equal(started.code, 0, `${started.stderr}${started.stdout}`);
    const startedOutput = JSON.parse(started.stdout);
    assert.equal(startedOutput.action, "start");
    assert.equal(startedOutput.phase, "started");
    assert.equal(startedOutput.nextAction, "apply-setup");
    assert.equal(started.stdout.includes(root), false);

    const before = await snapshotDirectory(root);
    const directoryInput = await runCli([
      "builder", "codex-uat", "inspect",
      "--journal", root,
      "--json",
    ]);
    assert.equal(directoryInput.code, 1);
    assert.equal(
      JSON.parse(directoryInput.stdout).code,
      "AGENTMO_CODEX_UAT_JOURNAL_CONFLICT_REJECTED",
    );
    for (const action of ["inspect", "resume"]) {
      const result = await runCli([
        "builder", "codex-uat", action,
        "--journal", path.join(root, "attempt.journal"),
        ...(action === "resume"
          ? ["--expected-head-sha256", startedOutput.headDigest]
          : []),
        "--json",
      ]);
      assert.equal(result.code, 0, `${result.stderr}${result.stdout}`);
      const output = JSON.parse(result.stdout);
      assert.equal(output.action, action);
      assert.equal(output.headDigest, startedOutput.headDigest);
      assert.equal(output.nextAction, "apply-setup");
      assert.equal(result.stdout.includes(root), false);
    }
    const after = await snapshotDirectory(root);
    assert.deepEqual(after, before);

    const namespace = await import("../src/builder-codex-uat.js");
    for (const obsolete of [
      "beginCodexUatRun",
      "finalizeCodexUatRun",
      "buildCodexUatRunBasis",
      "recordCodexUatScenario",
    ]) assert.equal(Object.hasOwn(namespace, obsolete), false, obsolete);
  });

  it("enforces activation before trust/auth and scenario arm, then records only matching leaves", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-cli-uat-order-"));
    const journalPath = path.join(root, "attempt.journal");
    const startRequest = await writeStartUatRequest(root);
    const started = JSON.parse((await runCli([
      "builder", "codex-uat", "start",
      "--journal", journalPath,
      "--attempt-id", "attempt-cli-002",
      "--request", startRequest.filePath,
      "--digest", `builder-codex-uat-record-request=${startRequest.digest}`,
      "--json",
    ])).stdout);

    const processEvidence = await writeCliEvidence(root, "fresh-process.evidence", Buffer.from("fresh process\n"));
    const trustEvidence = await writeCliEvidence(root, "trust.evidence", Buffer.from("human trust\n"));
    const authEvidence = await writeCliEvidence(root, "auth.evidence", Buffer.from("human auth\n"));
    const earlyTrust = await writeUatRequest(root, "early-trust", "trust-auth-observed", {
      freshProcessEvidencePath: path.basename(processEvidence.filePath),
      expectedFreshProcessDigest: processEvidence.digest,
      trustObservationPath: path.basename(trustEvidence.filePath),
      expectedTrustObservationDigest: trustEvidence.digest,
      authObservationPath: path.basename(authEvidence.filePath),
      expectedAuthObservationDigest: authEvidence.digest,
    });
    const beforeEarly = await snapshotDirectory(root);
    const rejected = await runUatMutation("record", root, earlyTrust, started.headDigest);
    assert.equal(rejected.code, 1);
    assert.deepEqual(await snapshotDirectory(root), beforeEarly);

    const baseline = uatReleaseFixture.identity.baseline;
    const marketplaceProjectionDigest = uatDigest("marketplace");
    const projectionTransactionDigest = uatDigest("projection-transaction");
    const projectionRootIdentity = {
      device: "1",
      group: "1",
      inode: "1",
      links: "1",
      mode: "700",
      owner: "1",
      size: "0",
    };
    const activationBinding = {
      schemaVersion: "agentmo.builder-codex-activation-binding.v3",
      hostScope: "user",
      selector: {
        pluginId: "agentmo@agentmo-local",
        pluginName: "agentmo",
        marketplaceName: "agentmo-local",
      },
      releaseDigest: baseline.releaseDigest,
      marketplaceProjectionDigest,
      operationOrderDigest: uatDigest("operation-order"),
      ownerDisposition: "created-by-agentmo",
      ownerRecordDigest: uatDigest("owner"),
      consumerId: uatDigest("consumer-id"),
      consumerEntryDigest: uatDigest("consumer"),
      consumerLedgerDigest: uatDigest("ledger"),
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
        members: [{
          kind: "root",
          relativePath: "",
          digest: null,
          identity: projectionRootIdentity,
        }],
      },
    };
    const receipt = await writeCliEvidence(root, "install-receipt.json", {
      schemaVersion: "agentmo.builder-install-receipt.v4",
      status: "activated",
      identity: {
        name: "agentmo",
        version: baseline.version,
        adapterId: "codex",
        releaseDigest: baseline.releaseDigest,
      },
      planDigest: uatDigest("setup-plan"),
      evidence: {
        level: "host-observed",
        mechanismOnly: true,
        codexActivationVerified: false,
        hostBehaviorVerified: false,
        domainQualityCertified: false,
      },
      hostActivation: activationBinding,
    }, "builder-install-receipt");
    const checkpointPath = path.join(root, "builder.checkpoint");
    const checkpointAdmission = await writeBuilderCheckpoint(checkpointPath, checkpoint());
    const setup = await writeUatRequest(root, "setup", "setup-applied", {
      installReceiptPath: path.basename(receipt.filePath),
      expectedInstallReceiptDigest: receipt.digest,
    });
    let recorded = JSON.parse((await runUatMutation("record", root, setup, started.headDigest, [
      "--checkpoint", checkpointPath,
      "--digest", `builder-checkpoint=${checkpointAdmission.digest}`,
    ])).stdout);
    const hostObservation = await writeCliEvidence(root, "host-observation.json", {
      schemaVersion: "agentmo.builder-codex-host-observation.v1",
      status: "bounded",
    });
    const activation = await writeUatRequest(root, "activation", "activation-applied", {
      installReceiptPath: path.basename(receipt.filePath),
      expectedInstallReceiptDigest: receipt.digest,
      hostObservationPath: path.basename(hostObservation.filePath),
      expectedHostObservationDigest: hostObservation.digest,
    });
    recorded = JSON.parse((await runUatMutation("record", root, activation, recorded.headDigest, [
      "--checkpoint", checkpointPath,
      "--digest", `builder-checkpoint=${checkpointAdmission.digest}`,
    ])).stdout);
    assert.equal(recorded.nextAction, "start-fresh-codex");
    recorded = JSON.parse((await runUatMutation("record", root, earlyTrust, recorded.headDigest)).stdout);
    assert.equal(recorded.nextScenario, "session-start");

    const armedResult = await runCli([
      "builder", "codex-uat", "scenario-arm",
      "--journal", journalPath,
      "--expected-head-sha256", recorded.headDigest,
      "--checkpoint", checkpointPath,
      "--digest", `builder-checkpoint=${checkpointAdmission.digest}`,
      "--json",
    ]);
    assert.equal(armedResult.code, 0, `${armedResult.stderr}${armedResult.stdout}`);
    const armed = JSON.parse(armedResult.stdout);
    assert.equal(armed.nextScenario, "session-start");
    assert.match(armed.correlation, /^opaque:[a-f0-9]{64}$/u);
    assert.equal(armed.correlation.includes(recorded.headDigest.slice("sha256:".length)), false);
    const armedCheckpoint = await loadBuilderCheckpoint(checkpointPath, {
      expectedDigest: armed.checkpointDigest,
    });
    assert.deepEqual(armedCheckpoint.value.codexUatChallenge, {
      attemptId: "attempt-cli-002",
      scenario: "session-start",
      correlation: armed.correlation,
    });
    assert.doesNotMatch(
      JSON.stringify(armedCheckpoint.value),
      /journal.*head|predecessorDigest/iu,
    );

    const observation = await publishCodexUatObservationLeaf({
      outDirectory: path.join(root, "observations"),
      attemptId: "attempt-cli-002",
      scenario: "session-start",
      correlation: armed.correlation,
      source: "operator-observation",
      eventDigest: uatDigest("session-event"),
      runnerDigest: uatDigest("runner"),
      releaseDigest: baseline.releaseDigest,
      installReceiptDigest: receipt.digest,
    });
    const scenario = await writeUatRequest(root, "scenario", "scenario-observed", {
      hookEventDigest: uatDigest("session-event"),
    });
    const stale = await runUatMutation("record", root, scenario, started.headDigest, [
      "--checkpoint", checkpointPath,
      "--digest", `builder-checkpoint=${armed.checkpointDigest}`,
      "--observation", observation.filePath,
      "--digest", `builder-codex-uat-observation=${observation.digest}`,
    ]);
    assert.equal(stale.code, 1);
    const accepted = await runUatMutation("record", root, scenario, recorded.headDigest, [
      "--checkpoint", checkpointPath,
      "--digest", `builder-checkpoint=${armed.checkpointDigest}`,
      "--observation", observation.filePath,
      "--digest", `builder-codex-uat-observation=${observation.digest}`,
    ]);
    assert.equal(accepted.code, 0, `${accepted.stderr}${accepted.stdout}`);
    assert.equal(JSON.parse(accepted.stdout).nextScenario, "skill-discovery");
  });

  it("allows only a bounded failure/interruption terminal and redacts local state", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-cli-uat-terminal-"));
    const startRequest = await writeStartUatRequest(root);
    const started = JSON.parse((await runCli([
      "builder", "codex-uat", "start",
      "--journal", path.join(root, "attempt.journal"),
      "--attempt-id", "attempt-cli-003",
      "--request", startRequest.filePath,
      "--digest", `builder-codex-uat-record-request=${startRequest.digest}`,
      "--json",
    ], { env: { ...process.env, AGENTMO_UAT_CANARY: "secret-terminal-canary" } })).stdout);
    const failureEvidence = await writeCliEvidence(
      root,
      "failure.evidence",
      Buffer.from("failure evidence\n"),
    );
    const terminal = await runCli([
      "builder", "codex-uat", "terminal", "failure",
      "--journal", path.join(root, "attempt.journal"),
      "--expected-head-sha256", started.headDigest,
      "--code", "SYNTHETIC_FAILURE",
      "--evidence", failureEvidence.filePath,
      "--evidence-sha256", failureEvidence.digest,
      "--json",
    ], { env: { ...process.env, AGENTMO_UAT_CANARY: "secret-terminal-canary" } });
    assert.equal(terminal.code, 0, `${terminal.stderr}${terminal.stdout}`);
    const output = JSON.parse(terminal.stdout);
    assert.equal(output.phase, "failed");
    assert.equal(output.terminal, true);
    assert.equal(terminal.stdout.includes(root), false);
    assert.equal(terminal.stdout.includes("secret-terminal-canary"), false);
    const secondEvidence = await writeCliEvidence(root, "second.evidence", Buffer.from("second\n"));
    const duplicate = await runCli([
      "builder", "codex-uat", "terminal", "interruption",
      "--journal", path.join(root, "attempt.journal"),
      "--expected-head-sha256", output.headDigest,
      "--code", "SECOND_TERMINAL",
      "--evidence", secondEvidence.filePath,
      "--evidence-sha256", secondEvidence.digest,
      "--json",
    ]);
    assert.equal(duplicate.code, 1);
  });
});
