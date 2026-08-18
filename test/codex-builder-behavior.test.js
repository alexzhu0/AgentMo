import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, readlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { before, describe, it } from "node:test";
import { promisify } from "node:util";
import {
  CODEX_UAT_ATTEMPT_JOURNAL_SCHEMA_VERSION,
  CODEX_UAT_SCENARIO_IDS,
  appendCodexUatCandidateReady,
  armCodexUatScenario,
  loadCodexUatAttemptJournal,
  publishCodexUatCandidate,
  publishCodexUatObservationLeaf,
  recordCodexUatActivationApplied,
  recordCodexUatScenarioObservation,
  recordCodexUatSetupApplied,
  recordCodexUatTrustAuthObservation,
  startCodexUatAttempt,
} from "../src/builder-codex-uat.js";
import {
  appendImmutableJournalEntry,
  loadImmutableJournal,
} from "../src/builder-immutable-journal.js";
import {
  buildBuilderCheckpoint,
  writeBuilderCheckpoint,
} from "../src/builder-checkpoint.js";
import {
  CODEX_CONSUMER_LEDGER_FILE,
  buildCodexConsumerEntry,
  buildCodexConsumerLedger,
} from "../src/builder-codex-host.js";
import { serializePersistableJson } from "../src/persistability.js";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RECEIPT = ".agentmo/builder/install-receipt.json";
const SELECTOR = Object.freeze({
  pluginId: "agentmo@agentmo-local",
  pluginName: "agentmo",
  marketplaceName: "agentmo-local",
});
let packedPackageRoot;
let packedTarballPath;
let uatBaselinePackage;
let uatBaselineTarball;
let uatSuccessorPackage;
let uatSuccessorTarball;
let uatAlternateBaselinePackage;
let uatAlternateBaselineTarball;
let uatAlternatePackage;
let uatAlternateTarball;
let uatPrimaryReleaseSet;
let uatAlternateReleaseSet;
let uatPrimaryPair;
let uatAlternatePair;
let packedExecutionCwd;
let fakeBin;
let probeMarker;
let behaviorModule;
const CHILD_PRELOAD_SOURCE = `
if (process.argv[1]?.endsWith("agentmo-hook.js")
  || (process.argv[2] === "builder" && ["hook", "pause", "resume"].includes(process.argv[3]))) {
  process.stdout.write("node-options-child-canary");
}
`;
const CHILD_NODE_OPTIONS = `--import=data:text/javascript,${encodeURIComponent(CHILD_PRELOAD_SOURCE)}`;
const packedBehaviorIt = process.env.AGENTMO_TEST_LANE === "immutable-successor"
  ? it.skip
  : it;

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function uatReleaseEvidenceArgs(overrides = {}) {
  return [
    "--uat-baseline-package", overrides.baselinePackage ?? uatBaselinePackage,
    "--uat-baseline-tarball", overrides.baselineTarball ?? uatBaselineTarball,
    "--uat-successor-package", overrides.successorPackage ?? uatSuccessorPackage,
    "--uat-successor-tarball", overrides.successorTarball ?? uatSuccessorTarball,
  ];
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

async function makeFakeCodex(root) {
  const bin = path.join(root, "fake-bin");
  probeMarker = path.join(root, "probe-called");
  await mkdir(bin);
  const executable = path.join(bin, "codex");
  await writeFile(executable, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
fs.writeFileSync(${JSON.stringify(probeMarker)}, "called");
const argv = process.argv.slice(2);
const key = argv.join(" ");
const stateFile = process.env.HOME ? path.join(process.env.HOME, ".fake-codex-installed.json") : null;
const installed = () => {
  if (stateFile === null) return null;
  try { return JSON.parse(fs.readFileSync(stateFile, "utf8")); }
  catch { return {}; }
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
  const pluginVersion = state.marketplaceRoot
    ? JSON.parse(fs.readFileSync(path.join(
        state.marketplaceRoot, "plugins", "agentmo", ".codex-plugin", "plugin.json"
      ), "utf8")).version
    : null;
  emit(JSON.stringify({
    installed: state.pluginInstalled ? [{
      pluginId: "agentmo@agentmo-local",
      name: "agentmo",
      marketplaceName: "agentmo-local",
      version: pluginVersion,
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
    if (request.method === "hooks/list") result = { data: [{ cwd: process.cwd(), hooks: state.pluginInstalled ? [{ pluginId: "agentmo@agentmo-local", enabled: true, trustStatus: "trusted" }] : [], warnings: [], errors: [] }] };
    process.stdout.write(JSON.stringify({ id: request.id, result }) + "\\n");
  });
} else if (!Object.hasOwn(outputs, key)) process.exitCode = 2;
else emit(outputs[key]);
`, "utf8");
  await chmod(executable, 0o755);
  return bin;
}

async function makeStubbornProbeCodex(root) {
  const bin = path.join(root, "stubborn-probe-bin");
  const pidPath = path.join(root, "stubborn-probe-pid");
  const startedAtPath = path.join(root, "stubborn-probe-started-at");
  const sigtermPath = path.join(root, "stubborn-probe-sigterm");
  const grandchildPidPath = path.join(root, "stubborn-probe-grandchild-pid");
  const grandchildSigtermPath = path.join(root, "stubborn-probe-grandchild-sigterm");
  const environmentPath = path.join(root, "stubborn-probe-environment.json");
  const grandchildSource = `
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(grandchildPidPath)}, String(process.pid));
process.stdout.write("behavior-daemon-value-canary");
process.on("SIGTERM", () => fs.writeFileSync(${JSON.stringify(grandchildSigtermPath)}, "observed"));
setInterval(() => {}, 1_000);
`;
  await mkdir(bin);
  const executable = path.join(bin, "codex");
  await writeFile(executable, `#!${process.execPath}
const fs = require("node:fs");
if (process.argv[2] === "--version") {
  fs.writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));
  fs.writeFileSync(${JSON.stringify(startedAtPath)}, String(Date.now()));
  fs.writeFileSync(${JSON.stringify(environmentPath)}, JSON.stringify({
    names: Object.keys(process.env).sort(),
    canary: process.env.AGENTMO_BEHAVIOR_CANARY ?? null,
    nodeOptions: process.env.NODE_OPTIONS ?? null,
    nodePath: process.env.NODE_PATH ?? null,
    home: process.env.HOME ?? null,
    codexHome: process.env.CODEX_HOME ?? null
  }));
  process.stdout.write("behavior-timeout-value-canary");
  require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(grandchildSource)}], {
    stdio: "inherit",
  });
  process.on("SIGTERM", () => fs.writeFileSync(${JSON.stringify(sigtermPath)}, "observed"));
  setInterval(() => {}, 1_000);
} else {
  process.exitCode = 2;
}
`, "utf8");
  await chmod(executable, 0o755);
  return {
    bin,
    pidPath,
    startedAtPath,
    sigtermPath,
    grandchildPidPath,
    grandchildSigtermPath,
    environmentPath,
  };
}

async function makeEscapedStdoutProbeCodex(root) {
  const bin = path.join(root, "escaped-probe-bin");
  const escapedPidPath = path.join(root, "escaped-probe-pid");
  const startedAtPath = path.join(root, "escaped-probe-started-at");
  const escapedSource = `
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(escapedPidPath)}, String(process.pid));
process.stdout.write("behavior-escaped-stdout-canary");
setInterval(() => {}, 1_000);
`;
  await mkdir(bin);
  const executable = path.join(bin, "codex");
  await writeFile(executable, `#!${process.execPath}
const fs = require("node:fs");
if (process.argv[2] !== "--version") process.exit(2);
fs.writeFileSync(${JSON.stringify(startedAtPath)}, String(Date.now()));
process.stdout.write("codex-cli 0.144.2\\n");
const child = require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(escapedSource)}], {
  detached: true,
  stdio: "inherit",
});
child.unref();
process.exit(0);
`, "utf8");
  await chmod(executable, 0o755);
  return { bin, escapedPidPath, startedAtPath };
}

async function runPackageCli(packageRoot, args, sharedHome = null) {
  try {
    const result = await execFileAsync(
      process.execPath,
      [path.join(packageRoot, "bin/agentmo.js"), ...args],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          ...(sharedHome === null ? {} : {
            HOME: sharedHome,
            CODEX_HOME: path.join(sharedHome, ".codex"),
          }),
          PATH: [fakeBin, path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter),
          AGENTMO_BEHAVIOR_CANARY: "sk-synthetic-behavior-canary",
          NODE_OPTIONS: CHILD_NODE_OPTIONS,
          NODE_PATH: path.join(packedExecutionCwd, "synthetic-node-path-canary"),
        },
        cwd: packedExecutionCwd,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

async function runPackedCli(args, sharedHome = null) {
  return runPackageCli(packedPackageRoot, args, sharedHome);
}

async function runStableCli(args, project, home, options = {}) {
  const launcher = path.join(
    home,
    ".agentmo/builder/codex-host/marketplace/agentmo-local/plugins/agentmo/runtime/agentmo/bin/agentmo.js",
  );
  try {
    const result = await execFileAsync(process.execPath, [launcher, ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        CODEX_HOME: path.join(home, ".codex"),
        PATH: [
          ...(options.pathPrefix ?? []),
          fakeBin,
          path.dirname(process.execPath),
          "/usr/bin",
          "/bin",
        ].join(path.delimiter),
        AGENTMO_BEHAVIOR_CANARY: "sk-synthetic-behavior-canary",
        NODE_OPTIONS: CHILD_NODE_OPTIONS,
        NODE_PATH: path.join(packedExecutionCwd, "synthetic-node-path-canary"),
      },
      cwd: project,
      maxBuffer: 2 * 1024 * 1024,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

function runInstalledHook(filePath, input, project, home) {
  return new Promise((resolveResult) => {
    const child = execFile(process.execPath, [filePath], {
      encoding: "utf8",
      cwd: project,
      env: {
        HOME: home,
        CODEX_HOME: path.join(home, ".codex"),
        LANG: "C",
        LC_ALL: "C",
        PATH: [path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter),
      },
      maxBuffer: 256 * 1024,
    }, (error, stdout, stderr) => {
      resolveResult({
        code: error === null ? 0 : Number.isInteger(error?.code) ? error.code : 1,
        stdout: stdout ?? "",
        stderr: stderr ?? "",
      });
    });
    child.stdin.end(input);
  });
}

async function installProject(project) {
  const home = await mkdtemp(path.join(tmpdir(), "agentmo-behavior-home-"));
  return { ...(await installActivatedProject(project, home)), home };
}

async function installActivatedProject(project, home, packageRoot = packedPackageRoot) {
  const previewResult = await runPackageCli(packageRoot, [
    "builder", "setup", "--project", project, "--host-scope", "user", "--json",
  ], home);
  assert.equal(previewResult.code, 0, `${previewResult.stderr}${previewResult.stdout}`);
  const preview = JSON.parse(previewResult.stdout);
  const apply = await runPackageCli(packageRoot, [
    "builder", "setup", "--project", project, "--host-scope", "user",
    "--apply", "--plan-digest", preview.planDigest, "--json",
  ], home);
  assert.equal(apply.code, 0, apply.stderr);
  const receiptBytes = await readFile(path.join(project, RECEIPT));
  return {
    home,
    receiptBytes,
    receiptDigest: digest(receiptBytes),
    receipt: JSON.parse(receiptBytes.toString("utf8")),
  };
}

async function installUatLifecycleProject(project, home) {
  const genesis = await installActivatedProject(project, home, uatBaselinePackage);
  const stableRoot = path.join(
    home,
    ".agentmo/builder/codex-host/marketplace/agentmo-local/plugins/agentmo/runtime/agentmo",
  );
  const lifecycle = await import(
    `${pathToFileURL(path.join(stableRoot, "src/builder-lifecycle.js")).href}?uat-upgrade=${Date.now()}-${Math.random()}`
  );
  const preview = await lifecycle.planBuilderUpgrade({
    projectRoot: project,
    probe: compatibleProbe(),
    packageOptions: { packageRoot: uatSuccessorPackage },
    expectedReceiptDigest: genesis.receiptDigest,
  });
  const upgraded = await lifecycle.applyBuilderUpgrade({
    projectRoot: project,
    probe: compatibleProbe(),
    packageOptions: { packageRoot: uatSuccessorPackage },
    expectedReceiptDigest: genesis.receiptDigest,
    expectedPlanDigest: preview.planDigest,
  });
  const admitted = await lifecycle.admitBuilderLifecycleReceipt({
    projectRoot: project,
    expectedReceiptDigest: upgraded.receipt.digest,
  });
  return {
    home,
    receiptDigest: admitted.receiptDigest,
    receipt: admitted.receipt,
    selectedRelease: admitted.release,
    scopeDigest: admitted.scopeDigest,
    genesisReceiptDigest: admitted.genesisReceiptDigest,
    genesisReceipt: admitted.genesisReceipt,
  };
}

async function replaceActivatedConsumerLedger(home, _project, installation, consumers) {
  const ledger = buildCodexConsumerLedger({ selector: SELECTOR, consumers });
  const ledgerBytes = Buffer.from(serializePersistableJson(ledger, {
    subject: CODEX_CONSUMER_LEDGER_FILE,
  }), "utf8");
  await writeFile(path.join(
    home,
    ".agentmo/builder/codex-host",
    CODEX_CONSUMER_LEDGER_FILE,
  ), ledgerBytes);
  return {
    ...installation,
    home,
  };
}

function scenarioEvidence(id, index, successor, activeReceiptDigest) {
  const evidence = (label) => digest(Buffer.from(`${id}:${index}:${label}\n`, "utf8"));
  const checkpointDigest = evidence("checkpoint");
  if (id === "session-start") return { hookEventDigest: evidence("hook-event") };
  if (id === "skill-discovery") return { visibilityDigest: evidence("visibility") };
  if (id === "user-prompt-non-trigger") return { nonTriggerDigest: evidence("non-trigger") };
  if (["manual-pause", "pre-compact"].includes(id)) return { checkpointSuccessorDigest: checkpointDigest };
  if (id === "post-compact") return { workflowIdentityDigest: evidence("workflow") };
  if (id === "restart-resume") return { freshProcessDigest: evidence("fresh-process") };
  if (id === "duplicate-replay") {
    const unchanged = evidence("unchanged-checkpoint");
    return { beforeCheckpointDigest: unchanged, afterCheckpointDigest: unchanged };
  }
  if (id === "second-compaction") {
    return {
      compactionEpochDigest: evidence("compaction-epoch"),
      checkpointSuccessorDigest: checkpointDigest,
    };
  }
  if (id === "upgrade-visibility") {
    return {
      successorVersion: successor.version,
      releaseDigest: successor.releaseDigest,
      tarballDigest: successor.tarballDigest,
      upgradePlanDigest: evidence("upgrade-plan"),
      installReceiptDigest: activeReceiptDigest,
      checkpointDigest,
      visibilityDigest: evidence("visibility"),
    };
  }
  return {
    deactivationPlanDigest: evidence("deactivation-plan"),
    lifecycleHeadDigest: evidence("lifecycle-head"),
    tombstoneDigest: evidence("tombstone"),
    activeReceiptDigest,
    visibilityDigest: evidence("visibility"),
    launcherPreserved: true,
    currentReceiptPreserved: true,
  };
}

async function createUatCandidate(root, _project, installation, overrides = {}) {
  const hookRunnerDigest = digest(await readFile(path.join(
    installation.home,
    ".agentmo/builder/codex-host/marketplace/agentmo-local/plugins/agentmo/hooks/agentmo-hook.js",
  )));
  const attemptId = `attempt-${Math.random().toString(16).slice(2)}`;
  const journalPath = path.join(root, `${attemptId}.journal`);
  const releasePair = overrides.releasePair ?? "primary";
  if (!["primary", "alternate"].includes(releasePair)
    || (overrides.candidateOverrides !== undefined
      && (!overrides.candidateOverrides
        || typeof overrides.candidateOverrides !== "object"
        || Array.isArray(overrides.candidateOverrides)))) {
    throw new Error("invalid UAT test fixture override");
  }
  const useAlternate = releasePair === "alternate";
  let view = await startCodexUatAttempt({
    journalPath,
    attemptId,
    baseline: useAlternate
      ? { packageRoot: uatAlternateBaselinePackage, tarballPath: uatAlternateBaselineTarball }
      : { packageRoot: uatBaselinePackage, tarballPath: uatBaselineTarball },
    successor: useAlternate
      ? { packageRoot: uatAlternatePackage, tarballPath: uatAlternateTarball }
      : { packageRoot: uatSuccessorPackage, tarballPath: uatSuccessorTarball },
  });
  const baseline = view.state.baseline;
  const successor = view.state.successor;
  const receiptPath = path.join(root, `${attemptId}.genesis-receipt.json`);
  const receiptDigest = installation.genesisReceiptDigest;
  const receiptBytes = Buffer.from(serializePersistableJson(
    installation.genesisReceipt,
    { subject: "builder-install-receipt" },
  ), "utf8");
  assert.equal(digest(receiptBytes), receiptDigest);
  await writeFile(receiptPath, receiptBytes, { flag: "wx", mode: 0o600 });
  const checkpointPath = path.join(root, `${attemptId}.checkpoint`);
  let checkpointAdmission = await writeBuilderCheckpoint(checkpointPath, buildBuilderCheckpoint({
    workflowId: `behavior-${attemptId}`,
    adapterId: "codex",
    stage: "discover",
    boundary: "session-restart",
    artifactRefs: [],
    pendingDecision: null,
    nextAction: "discover",
    installReceiptDigest: receiptDigest,
    capabilitySnapshot: {
      adapterId: "codex",
      evidenceLevel: "observed",
      digest: hookRunnerDigest,
      required: [{ id: "codex-cli", status: "observed" }],
    },
    eventLedger: { cursor: 0, recentEvents: [] },
    pauseReason: null,
  }));
  view = await recordCodexUatSetupApplied({
    journalPath,
    expectedHeadAdmission: view.head,
    installReceiptPath: receiptPath,
    expectedInstallReceiptDigest: receiptDigest,
    checkpointAdmission,
  });
  const hostPath = path.join(root, `${attemptId}.host-observation`);
  const hostBytes = Buffer.from("bounded host observation\n");
  await writeFile(hostPath, hostBytes, { flag: "wx", mode: 0o600 });
  view = await recordCodexUatActivationApplied({
    journalPath,
    expectedHeadAdmission: view.head,
    installReceiptPath: receiptPath,
    expectedInstallReceiptDigest: receiptDigest,
    checkpointAdmission,
    hostObservationPath: hostPath,
    expectedHostObservationDigest: digest(hostBytes),
  });
  const trust = [];
  for (const label of ["process", "trust", "auth"]) {
    const filePath = path.join(root, `${attemptId}.${label}`);
    const bytes = Buffer.from(`${label}\n`);
    await writeFile(filePath, bytes, { flag: "wx", mode: 0o600 });
    trust.push({ filePath, digest: digest(bytes) });
  }
  view = await recordCodexUatTrustAuthObservation({
    journalPath,
    expectedHeadAdmission: view.head,
    freshProcessEvidencePath: trust[0].filePath,
    expectedFreshProcessDigest: trust[0].digest,
    trustObservationPath: trust[1].filePath,
    expectedTrustObservationDigest: trust[1].digest,
    authObservationPath: trust[2].filePath,
    expectedAuthObservationDigest: trust[2].digest,
  });
  for (const [index, id] of CODEX_UAT_SCENARIO_IDS.entries()) {
    const armed = await armCodexUatScenario({
      journalPath,
      expectedHeadAdmission: view.head,
      checkpointPath,
      checkpointAdmission,
    });
    checkpointAdmission = armed.checkpointAdmission;
    const observationAdmission = await publishCodexUatObservationLeaf({
      outDirectory: path.join(root, "observations"),
      attemptId,
      scenario: id,
      correlation: armed.correlation,
      source: "operator-observation",
      eventDigest: digest(Buffer.from(`${id}:event\n`, "utf8")),
      runnerDigest: overrides.hookRunnerDigest ?? hookRunnerDigest,
      releaseDigest: baseline.releaseDigest,
      installReceiptDigest: receiptDigest,
    });
    view = await recordCodexUatScenarioObservation({
      journalPath,
      expectedHeadAdmission: view.head,
      checkpointAdmission,
      observationAdmission,
      evidence: scenarioEvidence(id, index, successor, installation.receiptDigest),
    });
  }
  const candidate = await publishCodexUatCandidate({
    journalPath,
    expectedHeadAdmission: view.head,
    candidateDirectory: path.join(root, "candidates"),
  });
  const admittedCandidate = overrides.candidateTarballDigest === undefined
    ? candidate
    : await writeAlteredCandidate({
        root,
        attemptId,
        candidate,
        mutation: { tarballDigest: overrides.candidateTarballDigest },
      });
  const overriddenCandidate = overrides.candidateOverrides === undefined
    ? null
    : await writeAlteredCandidate({
        root,
        attemptId,
        candidate,
        mutation: overrides.candidateOverrides,
      });
  const ready = overriddenCandidate === null
    ? await appendCodexUatCandidateReady({
        journalPath,
        expectedHeadAdmission: view.head,
        candidatePath: admittedCandidate.filePath,
        expectedCandidateDigest: admittedCandidate.digest,
      })
    : await appendRawCandidateReady({
        journalPath,
        attemptId,
        view,
        candidate: overriddenCandidate,
      });
  const finalizedCandidate = overriddenCandidate ?? admittedCandidate;
  return {
    journalPath,
    headDigest: ready.head.digest,
    path: finalizedCandidate.filePath,
    digest: finalizedCandidate.digest,
    value: finalizedCandidate.value,
  };
}

async function appendRawCandidateReady({ journalPath, attemptId, view, candidate }) {
  const journal = await loadImmutableJournal({ journalPath, maxValueBytes: 256 * 1024 });
  const entry = {
    schemaVersion: CODEX_UAT_ATTEMPT_JOURNAL_SCHEMA_VERSION,
    attemptId,
    sequence: view.entries.length,
    kind: "candidate-ready",
    predecessorDigest: view.head.digest,
    evidenceDigests: [candidate.digest],
    details: { candidateDigest: candidate.digest },
  };
  await appendImmutableJournalEntry({
    journalPath,
    canonicalBytes: Buffer.from(serializePersistableJson(entry, {
      subject: "builder-codex-uat-attempt-entry",
    }), "utf8"),
    maxValueBytes: 256 * 1024,
    expectedPredecessorAdmission: journal.head,
  });
  return loadCodexUatAttemptJournal(journalPath);
}

async function writeAlteredCandidate({ root, attemptId, candidate, mutation }) {
  const value = { ...candidate.value, ...mutation };
  const bytes = Buffer.from(serializePersistableJson(value, {
    subject: "builder-codex-uat-candidate",
  }), "utf8");
  const candidateDigest = digest(bytes);
  const directory = path.join(root, "altered-candidates", attemptId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filePath = path.join(
    directory,
    `${candidateDigest.slice("sha256:".length)}.json`,
  );
  await writeFile(filePath, bytes, { flag: "wx", mode: 0o600 });
  return {
    filePath,
    digest: candidateDigest,
    value,
  };
}

async function forgeUatJournalAndCandidate(root, candidate, overrides = {}) {
  const source = await loadCodexUatAttemptJournal(candidate.journalPath);
  const releaseSet = overrides.releaseSet ?? uatPrimaryReleaseSet;
  const baseline = overrides.baseline ?? uatPrimaryPair.baseline;
  const entries = source.entries.slice(0, -1).map((entry) => structuredClone(entry));
  entries[0].details.releaseSet = releaseSet;
  entries[0].details.baseline = { role: "baseline", ...baseline };
  entries[1].details = {
    ...entries[1].details,
    baselineVersion: baseline.version,
    releaseDigest: baseline.releaseDigest,
    tarballDigest: baseline.tarballDigest,
    ...(overrides.setup ?? {}),
  };
  entries[2].details = {
    ...entries[2].details,
    releaseDigest: baseline.releaseDigest,
    installReceiptDigest: entries[1].details.installReceiptDigest,
  };
  for (const entry of entries) {
    entry.evidenceDigests = collectFixtureDigests(entry.details);
  }
  const forgedCandidateValue = {
    ...candidate.value,
    releaseSet,
    orderedEvidenceDigest: digest(Buffer.from(serializePersistableJson({
      schemaVersion: "agentmo.codex-uat-ordered-evidence.v1",
      entries: entries.map((entry) => ({
        sequence: entry.sequence,
        kind: entry.kind,
        scenario: entry.kind === "scenario-observed" ? entry.details.scenario : null,
        evidenceDigests: entry.evidenceDigests,
      })),
    }, { subject: "builder-codex-uat-ordered-evidence" }), "utf8")),
  };
  const candidateBytes = Buffer.from(serializePersistableJson(
    forgedCandidateValue,
    { subject: "builder-codex-uat-candidate" },
  ), "utf8");
  const candidateDigest = digest(candidateBytes);
  const candidateDirectory = path.join(
    root,
    "forged-candidates",
    `${candidate.value.attemptId}-${Math.random().toString(16).slice(2)}`,
  );
  await mkdir(candidateDirectory, { recursive: true, mode: 0o700 });
  const candidatePath = path.join(
    candidateDirectory,
    `${candidateDigest.slice("sha256:".length)}.json`,
  );
  await writeFile(candidatePath, candidateBytes, { flag: "wx", mode: 0o600 });
  entries.push({
    schemaVersion: CODEX_UAT_ATTEMPT_JOURNAL_SCHEMA_VERSION,
    attemptId: candidate.value.attemptId,
    sequence: entries.length,
    kind: "candidate-ready",
    predecessorDigest: null,
    evidenceDigests: [candidateDigest],
    details: { candidateDigest },
  });

  const journalPath = path.join(
    root,
    `${candidate.value.attemptId}-forged-${Math.random().toString(16).slice(2)}.journal`,
  );
  let head = null;
  for (const entry of entries) {
    entry.predecessorDigest = head?.digest ?? null;
    const append = await appendImmutableJournalEntry({
      journalPath,
      canonicalBytes: Buffer.from(serializePersistableJson(entry, {
        subject: "builder-codex-uat-attempt-entry",
      }), "utf8"),
      maxValueBytes: 256 * 1024,
      ...(head === null ? {} : { expectedPredecessorAdmission: head }),
    });
    assert.equal(append.committed, true);
    head = append.head;
  }
  const view = await loadCodexUatAttemptJournal(journalPath);
  return {
    journalPath,
    headDigest: view.head.digest,
    path: candidatePath,
    digest: candidateDigest,
    value: forgedCandidateValue,
  };
}

function collectFixtureDigests(value, output = []) {
  if (typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value)) {
    if (!output.includes(value)) output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectFixtureDigests(item, output);
    return output;
  }
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) collectFixtureDigests(child, output);
  }
  return output;
}

async function projectSnapshot(project) {
  const paths = [];
  async function visit(directory, relative = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(child, childRelative);
      else if (entry.isSymbolicLink()) {
        paths.push([childRelative, `symlink:${await readlink(child)}`]);
      } else paths.push([childRelative, digest(await readFile(child))]);
    }
  }
  await visit(project);
  return paths.sort((left, right) => left[0].localeCompare(right[0]));
}

before(async () => {
  if (process.env.AGENTMO_TEST_LANE === "main") return;
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-packed-behavior-"));
  const host = path.join(root, "host");
  packedExecutionCwd = path.join(root, "isolated-execution-cwd");
  const cache = path.join(root, "npm-cache");
  await mkdir(host);
  await mkdir(packedExecutionCwd);
  fakeBin = await makeFakeCodex(root);
  const uatOut = path.join(root, "uat-releases");
  const packedVersion = JSON.parse(await readFile(
    path.join(REPO_ROOT, "package.json"),
    "utf8",
  )).version;
  const builtUat = await execFileAsync(process.execPath, [
    path.join(REPO_ROOT, "scripts", "build-builder-uat-releases.js"),
    "--out", uatOut,
    "--baseline-version", "0.1.0-uat.18.7",
    "--successor-version", packedVersion,
    "--json",
  ], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  const uatIdentity = JSON.parse(builtUat.stdout);
  uatPrimaryReleaseSet = {
    operationId: uatIdentity.operationId,
    releaseSetDigest: digest(await readFile(
      path.join(uatOut, "agentmo-builder-uat-release-set.json"),
    )),
  };
  uatPrimaryPair = {
    baseline: {
      packageName: uatIdentity.baseline.packageName,
      version: uatIdentity.baseline.version,
      releaseDigest: uatIdentity.baseline.releaseDigest,
      tarballDigest: uatIdentity.baseline.tarballDigest,
    },
    successor: {
      packageName: uatIdentity.successor.packageName,
      version: uatIdentity.successor.version,
      releaseDigest: uatIdentity.successor.releaseDigest,
      tarballDigest: uatIdentity.successor.tarballDigest,
    },
  };
  uatBaselineTarball = path.join(uatOut, `agentmo-${uatIdentity.baseline.version}.tgz`);
  uatSuccessorTarball = path.join(uatOut, `agentmo-${uatIdentity.successor.version}.tgz`);
  packedTarballPath = uatSuccessorTarball;
  await execFileAsync("npm", [
    "install", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock", "--no-save",
    "--cache", cache, uatSuccessorTarball,
  ], { cwd: host, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  packedPackageRoot = path.join(host, "node_modules/agentmo");
  const baselineExtract = path.join(root, "uat-baseline");
  await mkdir(baselineExtract);
  await execFileAsync("tar", ["-xzf", uatBaselineTarball, "-C", baselineExtract]);
  uatBaselinePackage = path.join(baselineExtract, "package");
  uatSuccessorPackage = packedPackageRoot;

  const alternateOut = path.join(root, "uat-alternate-releases");
  const builtAlternate = await execFileAsync(process.execPath, [
    path.join(REPO_ROOT, "scripts", "build-builder-uat-releases.js"),
    "--out", alternateOut,
    "--baseline-version", "0.1.0-uat.18.9",
    "--successor-version", packedVersion,
    "--json",
  ], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  const alternateIdentity = JSON.parse(builtAlternate.stdout);
  uatAlternateReleaseSet = {
    operationId: alternateIdentity.operationId,
    releaseSetDigest: digest(await readFile(
      path.join(alternateOut, "agentmo-builder-uat-release-set.json"),
    )),
  };
  uatAlternatePair = {
    baseline: {
      packageName: alternateIdentity.baseline.packageName,
      version: alternateIdentity.baseline.version,
      releaseDigest: alternateIdentity.baseline.releaseDigest,
      tarballDigest: alternateIdentity.baseline.tarballDigest,
    },
    successor: {
      packageName: alternateIdentity.successor.packageName,
      version: alternateIdentity.successor.version,
      releaseDigest: alternateIdentity.successor.releaseDigest,
      tarballDigest: alternateIdentity.successor.tarballDigest,
    },
  };
  assert.deepEqual(alternateIdentity.successor, uatIdentity.successor);
  assert.notEqual(uatAlternateReleaseSet.operationId, uatPrimaryReleaseSet.operationId);
  assert.notEqual(uatAlternateReleaseSet.releaseSetDigest, uatPrimaryReleaseSet.releaseSetDigest);
  uatAlternateBaselineTarball = path.join(
    alternateOut,
    `agentmo-${alternateIdentity.baseline.version}.tgz`,
  );
  uatAlternateTarball = path.join(
    alternateOut,
    `agentmo-${alternateIdentity.successor.version}.tgz`,
  );
  const alternateBaselineExtract = path.join(root, "uat-alternate-baseline");
  const alternateExtract = path.join(root, "uat-alternate");
  await Promise.all([mkdir(alternateBaselineExtract), mkdir(alternateExtract)]);
  await Promise.all([
    execFileAsync("tar", ["-xzf", uatAlternateBaselineTarball, "-C", alternateBaselineExtract]),
    execFileAsync("tar", ["-xzf", uatAlternateTarball, "-C", alternateExtract]),
  ]);
  uatAlternateBaselinePackage = path.join(alternateBaselineExtract, "package");
  uatAlternatePackage = path.join(alternateExtract, "package");
  behaviorModule = await import(`${pathToFileURL(path.join(packedPackageRoot, "src/builder-behavior-eval.js")).href}?packed=${Date.now()}`);
});

describe("packed fresh-process Builder behavior evaluation", {
  concurrency: false,
  skip: process.env.AGENTMO_TEST_LANE === "main"
    ? "runs in the isolated packed-behavior lane"
    : false,
}, () => {
  packedBehaviorIt("observes every fixed scenario without claiming real Codex activation or domain quality", {
    timeout: 360_000,
  }, async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agentmo-behavior-project-"));
    const { receiptDigest, home } = await installProject(project);
    const before = await projectSnapshot(project);
    const execution = await runStableCli([
      "builder", "behavior-eval", "--project", project,
      "--digest", `builder-install-receipt=${receiptDigest}`, "--json",
    ], project, home);
    assert.equal(execution.code, 0, `${execution.stderr}${execution.stdout}`);
    const report = JSON.parse(execution.stdout);
    assert.doesNotMatch(
      execution.stdout,
      /real-codex-session-candidate|"realCodexSessionVerified"\s*:\s*true/u,
    );
    assert.equal(report.status, "observed");
    assert.equal(report.scenarios.results.length, 9);
    assert.equal(report.scenarios.results.every((item) => item.passed), true);
    assert.deepEqual(report.scenarios.results.map((item) => item.id), [
      "trigger-session-start",
      "non-trigger-user-prompt",
      "stable-checkpoint",
      "session-start-recovery",
      "duplicate-event-no-op",
      "manual-pause",
      "pre-compact",
      "post-compact",
      "restart-resume",
    ]);
    assert.equal(report.evidence.level, "observed");
    assert.equal(report.evidence.basis, "isolated-authenticated-runtime-fixture");
    assert.equal(report.evidence.fixtureExternalCommandMutation, "unknown");
    assert.equal(report.evidence.codexActivationVerified, false);
    assert.equal(report.evidence.hostBehaviorVerified, false);
    assert.equal(report.evidence.agentPackageQualityCertified, false);
    assert.equal(report.evidence.domainQualityCertified, false);
    assert.equal(report.evidence.productionApproved, false);
    assert.match(report.evidenceDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.deepEqual(Object.keys(report.fixture).sort(), [
      "cliDigest",
      "externalCommandMutation",
      "finalCheckpointDigest",
      "initialCheckpointDigest",
      "receiptDigest",
      "releaseDigest",
      "runnerDigest",
      "schemaVersion",
    ]);
    for (const key of [
      "cliDigest",
      "releaseDigest",
      "receiptDigest",
      "runnerDigest",
      "initialCheckpointDigest",
      "finalCheckpointDigest",
    ]) assert.match(report.fixture[key], /^sha256:[a-f0-9]{64}$/u);
    assert.equal(report.fixture.externalCommandMutation, "unknown");
    assert.equal(report.fixture.releaseDigest, report.release.digest);
    assert.equal(
      report.scenarios.results.find((item) => item.id === "pre-compact")?.process,
      "fresh-authenticated-hook",
    );
    assert.equal(
      report.scenarios.results.find((item) => item.id === "post-compact")?.process,
      "fresh-authenticated-hook",
    );
    assert.equal(execution.stdout.includes(REPO_ROOT), false);
    assert.equal(execution.stdout.includes(packedPackageRoot), false);
    assert.equal(execution.stdout.includes("sk-synthetic-behavior-canary"), false);
    assert.equal(execution.stdout.includes("node-options-child-canary"), false);
    assert.deepEqual(await projectSnapshot(project), before);
    assert.deepEqual(await readdir(packedExecutionCwd), []);
  });

  packedBehaviorIt("reaps a SIGTERM-ignoring PATH-shadow probe without leaking inherited values", {
    skip: process.platform === "win32",
    timeout: 180_000,
  }, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-behavior-probe-timeout-"));
    const project = path.join(root, "project");
    await mkdir(project);
    const { receiptDigest, home } = await installProject(project);
    const shadow = await makeStubbornProbeCodex(root);
    const execution = await runStableCli([
      "builder", "behavior-eval", "--project", project,
      "--digest", `builder-install-receipt=${receiptDigest}`, "--json",
    ], project, home, { pathPrefix: [shadow.bin] });
    const probeStartedAt = Number(await readFile(shadow.startedAtPath, "utf8"));
    const elapsedMs = Date.now() - probeStartedAt;
    const pid = Number(await readFile(shadow.pidPath, "utf8"));
    const grandchildPid = Number(await readFile(shadow.grandchildPidPath, "utf8"));
    const environment = JSON.parse(await readFile(shadow.environmentPath, "utf8"));

    assert.notEqual(execution.code, 0);
    assert.match(execution.stdout, /AGENTMO_BUILDER_BEHAVIOR_HOST_REJECTED/u);
    assert.equal(elapsedMs < 8_000, true, "PATH-shadow shutdown was not bounded");
    assert.equal(await readFile(shadow.sigtermPath, "utf8"), "observed");
    assert.equal(await readFile(shadow.grandchildSigtermPath, "utf8"), "observed");
    assert.throws(
      () => process.kill(pid, 0),
      (error) => error?.code === "ESRCH",
      "behavior evaluation returned before the PATH-shadow child closed",
    );
    assert.throws(
      () => process.kill(grandchildPid, 0),
      (error) => error?.code === "ESRCH",
      "behavior evaluation returned before the PATH-shadow grandchild was reaped",
    );
    assert.equal(environment.canary, null);
    assert.equal(environment.nodeOptions, null);
    assert.equal(environment.nodePath, null);
    assert.equal(environment.home, null);
    assert.equal(environment.codexHome, null);
    for (const name of ["AGENTMO_BEHAVIOR_CANARY", "NODE_OPTIONS", "NODE_PATH", "HOME", "CODEX_HOME"]) {
      assert.equal(environment.names.includes(name), false, name);
    }
    for (const value of [
      "behavior-timeout-value-canary",
      "behavior-daemon-value-canary",
      "sk-synthetic-behavior-canary",
      "node-options-child-canary",
    ]) {
      assert.equal(execution.stdout.includes(value), false, value);
      assert.equal(execution.stderr.includes(value), false, value);
    }
  });

  packedBehaviorIt("bounds an escaped stdout-holding PATH-shadow probe", {
    skip: process.platform === "win32",
    timeout: 180_000,
  }, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-behavior-escaped-probe-"));
    const project = path.join(root, "project");
    await mkdir(project);
    const { receiptDigest, home } = await installProject(project);
    const shadow = await makeEscapedStdoutProbeCodex(root);
    let escapedPid = null;
    try {
      const execution = await runStableCli([
        "builder", "behavior-eval", "--project", project,
        "--digest", `builder-install-receipt=${receiptDigest}`, "--json",
      ], project, home, { pathPrefix: [shadow.bin] });
      const probeStartedAt = Number(await readFile(shadow.startedAtPath, "utf8"));
      const elapsedMs = Date.now() - probeStartedAt;
      escapedPid = Number(await readFile(shadow.escapedPidPath, "utf8"));

      assert.notEqual(execution.code, 0);
      assert.match(execution.stdout, /AGENTMO_BUILDER_BEHAVIOR_HOST_REJECTED/u);
      assert.equal(elapsedMs < 8_000, true, "escaped PATH-shadow was not bounded");
      for (const value of ["behavior-escaped-stdout-canary", "codex-cli 0.144.2"]) {
        assert.equal(execution.stdout.includes(value), false, value);
        assert.equal(execution.stderr.includes(value), false, value);
      }
    } finally {
      if (Number.isSafeInteger(escapedPid) && escapedPid > 0) {
        try {
          process.kill(escapedPid, "SIGKILL");
        } catch (error) {
          if (error?.code !== "ESRCH") throw error;
        }
      }
    }
  });

  it("uses one immutable successor selection for receipt, hook, doctor, and behavior", {
    skip: ["main", "packed-behavior"].includes(process.env.AGENTMO_TEST_LANE)
      ? "runs in the isolated immutable-successor lane"
      : false,
  }, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-behavior-successor-"));
    const project = path.join(root, "project");
    const successorPackage = path.join(root, "successor-package");
    await mkdir(project);
    const installation = await installProject(project);
    await mkdir(successorPackage);
    const packedPackageModule = await import(
      `${pathToFileURL(path.join(packedPackageRoot, "src/builder-package.js")).href}?cr03-copy=${Date.now()}`
    );
    for (const relativePath of [
      ...packedPackageModule.BUILDER_RELEASE_ASSET_INVENTORY.map((asset) => asset.sourcePath),
      ...packedPackageModule.BUILDER_NPM_METADATA_FILES,
    ]) {
      const destination = path.join(successorPackage, ...relativePath.split("/"));
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(path.join(packedPackageRoot, ...relativePath.split("/")), destination);
    }
    const packageJsonPath = path.join(successorPackage, "package.json");
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    packageJson.version = "0.1.1-cr03";
    await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
    const pluginJsonPath = path.join(successorPackage, "plugin/.codex-plugin/plugin.json");
    const pluginJson = JSON.parse(await readFile(pluginJsonPath, "utf8"));
    pluginJson.version = packageJson.version;
    await writeFile(pluginJsonPath, `${JSON.stringify(pluginJson, null, 2)}\n`, "utf8");
    const [continuationBytes, verifierBytes] = await Promise.all([
      readFile(path.join(successorPackage, "src/builder-codex-uat-continuation.js")),
      readFile(path.join(successorPackage, "scripts/verify-codex-uat-candidate.js")),
    ]);
    await writeFile(
      path.join(successorPackage, "src/builder-codex-uat-release-manifest.json"),
      serializePersistableJson({
        schemaVersion: "agentmo.codex-uat-release-manifest.v1",
        packageName: packageJson.name,
        version: packageJson.version,
        continuation: {
          sourcePath: "src/builder-codex-uat-continuation.js",
          sha256: digest(continuationBytes),
        },
        verifier: {
          sourcePath: "scripts/verify-codex-uat-candidate.js",
          sha256: digest(verifierBytes),
        },
      }, { subject: "builder-codex-uat-release-manifest" }),
      "utf8",
    );

    const stableRoot = path.join(
      installation.home,
      ".agentmo/builder/codex-host/marketplace/agentmo-local/plugins/agentmo/runtime/agentmo",
    );
    const [lifecycle, checkpointModule] = await Promise.all([
      import(`${pathToFileURL(path.join(stableRoot, "src/builder-lifecycle.js")).href}?cr03=${Date.now()}`),
      import(`${pathToFileURL(path.join(stableRoot, "src/builder-checkpoint.js")).href}?cr03=${Date.now()}`),
    ]);
    const preview = await lifecycle.planBuilderUpgrade({
      projectRoot: project,
      probe: compatibleProbe(),
      packageOptions: { packageRoot: successorPackage },
      expectedReceiptDigest: installation.receiptDigest,
    });
    const upgraded = await lifecycle.applyBuilderUpgrade({
      projectRoot: project,
      probe: compatibleProbe(),
      packageOptions: { packageRoot: successorPackage },
      expectedReceiptDigest: installation.receiptDigest,
      expectedPlanDigest: preview.planDigest,
    });
    const admitted = await lifecycle.admitBuilderLifecycleReceipt({
      projectRoot: project,
      expectedReceiptDigest: upgraded.receipt.digest,
    });
    assert.equal(admitted.receiptPath, upgraded.receipt.path);
    assert.equal(admitted.receiptDigest, upgraded.receipt.digest);
    assert.equal(admitted.release.version, packageJson.version);
    assert.equal(admitted.package.version, packageJson.version);
    assert.equal(admitted.package.releaseDigest, admitted.release.releaseDigest);
    assert.equal(admitted.legacyGenesis, false);

    const checkpointPath = path.join(project, ".agentmo/checkpoints/builder.json");
    await checkpointModule.writeBuilderCheckpoint(
      checkpointPath,
      checkpointModule.buildBuilderCheckpoint({
        workflowId: "cr03-successor",
        adapterId: "codex",
        stage: "discover",
        boundary: "artifact-created",
        artifactRefs: [],
        pendingDecision: null,
        nextAction: "plan",
        installReceiptDigest: installation.receiptDigest,
        capabilitySnapshot: {
          adapterId: "codex",
          evidenceLevel: "observed",
          digest: admitted.capabilitySnapshot.digest,
          required: admitted.capabilitySnapshot.required,
        },
        eventLedger: { cursor: 0, recentEvents: [] },
        pauseReason: null,
      }),
    );
    const runnerPath = path.join(
      installation.home,
      ".agentmo/builder/codex-host/marketplace/agentmo-local/plugins/agentmo/hooks/agentmo-hook.js",
    );
    const hookInput = JSON.stringify({
      hook_event_name: "SessionStart",
      session_id: "cr03-successor-session",
      source: "resume",
    });
    const hook = await runInstalledHook(runnerPath, hookInput, project, installation.home);
    assert.equal(hook.code, 0, hook.stderr);
    assert.equal(hook.stderr, "");
    assert.deepEqual(JSON.parse(hook.stdout), {
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: "AgentMo checkpoint is resumable at plan. Use $agentmo to review and explicitly resume; no approval or stage transition was applied.",
      },
    });
    const journalModule = await import(
      `${pathToFileURL(path.join(stableRoot, "src/builder-immutable-journal.js")).href}?cr03=${Date.now()}`
    );
    const journal = await journalModule.loadImmutableJournal({ journalPath: checkpointPath });
    const checkpointJournal = await checkpointModule.loadBuilderCheckpoint(checkpointPath, {
      expectedDigest: journal.head.digest,
    });
    assert.equal(checkpointJournal.value.installReceiptDigest, admitted.receiptDigest);

    const replay = await runInstalledHook(runnerPath, hookInput, project, installation.home);
    assert.equal(replay.code, 0, replay.stderr);
    assert.equal(replay.stderr, "");
    assert.deepEqual(JSON.parse(replay.stdout), {});
    const replayJournal = await journalModule.loadImmutableJournal({ journalPath: checkpointPath });
    assert.deepEqual(replayJournal.head, journal.head);

    const doctor = await runStableCli([
      "builder", "doctor", "--project", project, "--json",
    ], project, installation.home);
    assert.equal(doctor.code, 0, `${doctor.stderr}${doctor.stdout}`);
    const doctorReport = JSON.parse(doctor.stdout);
    assert.equal(doctorReport.release.current.version, packageJson.version);
    assert.equal(doctorReport.release.current.digest, admitted.release.releaseDigest);
    assert.equal(doctorReport.receipt.path, admitted.receiptPath);
    assert.equal(doctorReport.receipt.digest, admitted.receiptDigest);

    const behavior = await runStableCli([
      "builder", "behavior-eval", "--project", project,
      "--digest", `builder-install-receipt=${admitted.receiptDigest}`, "--json",
    ], project, installation.home);
    assert.equal(behavior.code, 0, `${behavior.stderr}${behavior.stdout}`);
    const behaviorReport = JSON.parse(behavior.stdout);
    assert.equal(behaviorReport.release.version, packageJson.version);
    assert.equal(behaviorReport.release.digest, admitted.release.releaseDigest);
    assert.equal(behaviorReport.receipt.path, admitted.receiptPath);
    assert.equal(behaviorReport.receipt.digest, admitted.receiptDigest);

    await writeFile(path.join(admitted.packageRoot, "src", "builder-hook-bridge.js"), "tampered\n", "utf8");
    const tampered = await runInstalledHook(runnerPath, hookInput, project, installation.home);
    assert.notEqual(tampered.code, 0);
    assert.equal(tampered.stdout, "");
    assert.equal(tampered.stderr, "");
    const tamperedJournal = await journalModule.loadImmutableJournal({ journalPath: checkpointPath });
    assert.deepEqual(tamperedJournal.head, journal.head);
  });

  packedBehaviorIt("rejects a wrong receipt digest and modified hook before launching any host probe", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agentmo-behavior-reject-"));
    const { receiptDigest, home } = await installProject(project);
    await writeFile(probeMarker, "", "utf8");
    const wrong = await runPackedCli([
      "builder", "behavior-eval", "--project", project,
      "--digest", `builder-install-receipt=sha256:${"f".repeat(64)}`, "--json",
    ], home);
    assert.notEqual(wrong.code, 0);
    assert.equal((await readFile(probeMarker, "utf8")), "");

    await writeFile(path.join(
      home,
      ".agentmo/builder/codex-host/marketplace/agentmo-local/plugins/agentmo/hooks/agentmo-hook.js",
    ), "modified hook\n", "utf8");
    const modified = await runPackedCli([
      "builder", "behavior-eval", "--project", project,
      "--digest", `builder-install-receipt=${receiptDigest}`, "--json",
    ], home);
    assert.notEqual(modified.code, 0);
    assert.equal((await readFile(probeMarker, "utf8")), "");
  });

  packedBehaviorIt("rejects caller-supplied doctor, scenario, result, or observation claims", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agentmo-behavior-forgery-"));
    const { receiptDigest } = await installProject(project);
    for (const injected of [
      { doctorReport: { status: "declared" } },
      { scenarios: [{ id: "forged" }] },
      { results: [{ id: "forged", passed: true }] },
      { hostObservation: { activation: "verified" } },
    ]) {
      await assert.rejects(
        () => behaviorModule.runBuilderBehaviorEvaluation({
          projectRoot: project,
          expectedReceiptDigest: receiptDigest,
          ...injected,
        }),
        (error) => error?.code === "AGENTMO_BUILDER_BEHAVIOR_OPTIONS_REJECTED",
      );
    }
  });

  packedBehaviorIt("exact-admits one connected UAT candidate without merging it into mechanism evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-behavior-uat-"));
    const project = path.join(root, "project");
    const home = path.join(root, "home");
    await mkdir(project);
    await mkdir(home);
    const installation = await installUatLifecycleProject(project, home);
    const candidate = await createUatCandidate(root, project, installation);
    const execution = await runStableCli([
      "builder", "behavior", "--project", project,
      "--digest", `builder-install-receipt=${installation.receiptDigest}`,
      "--uat-journal", candidate.journalPath,
      "--uat-candidate", candidate.path,
      ...uatReleaseEvidenceArgs(),
      "--digest", `builder-codex-uat-head=${candidate.headDigest}`,
      "--digest", `builder-codex-uat-candidate=${candidate.digest}`,
      "--json",
    ], project, home);
    assert.equal(execution.code, 0, `${execution.stderr}${execution.stdout}`);
    const report = JSON.parse(execution.stdout);
    assert.equal(report.schemaVersion, "agentmo.builder-behavior-uat-chain.v3");
    assert.equal(report.status, "candidate-ready");
    assert.equal(report.lane, "committed-pair+genesis-bound-journal-candidate-chain");
    assert.equal(
      report.evidence.basis,
      "committed-pair+genesis-bound-journal-candidate-chain",
    );
    assert.equal(report.evidence.realCodexSessionVerified, false);
    assert.equal(report.uat.digest, candidate.digest);
    assert.equal(report.uat.headDigest, candidate.headDigest);
    assert.deepEqual(report.bindings.baseline, uatPrimaryPair.baseline);
    assert.deepEqual(report.bindings.successor, {
      packageName: candidate.value.successorPackageName,
      version: candidate.value.successorVersion,
      releaseDigest: candidate.value.releaseDigest,
      tarballDigest: candidate.value.tarballDigest,
    });
    assert.equal(report.bindings.installReceiptDigest, installation.receiptDigest);
    assert.equal(
      report.bindings.lifecycleGenesisReceiptDigest,
      installation.genesisReceiptDigest,
    );
    assert.equal(
      report.bindings.ownerRecordDigest,
      installation.genesisReceipt.hostActivation.ownerRecordDigest,
    );
    assert.equal(
      report.bindings.consumerLedgerDigest,
      installation.genesisReceipt.hostActivation.consumerLedgerDigest,
    );
    assert.equal(report.bindings.projectScopeDigest, installation.scopeDigest);
    assert.equal(report.bindings.releaseSetOperationId, candidate.value.releaseSet.operationId);
    assert.equal(report.bindings.releaseSetDigest, candidate.value.releaseSet.releaseSetDigest);
    assert.equal(report.uat.releaseSetOperationId, candidate.value.releaseSet.operationId);
    assert.equal(report.uat.releaseSetDigest, candidate.value.releaseSet.releaseSetDigest);
    assert.equal(report.bindings.orderedEvidenceDigest, candidate.value.orderedEvidenceDigest);
    assert.equal(report.evidence.humanAdmissionRequired, true);
    assert.equal(report.evidence.committedReleasePairVerified, true);
    assert.equal(report.evidence.lifecycleGenesisBindingVerified, true);
    assert.deepEqual(report.receipt, {
      digest: installation.receiptDigest,
      genesisDigest: installation.genesisReceiptDigest,
    });
    assert.equal(execution.stdout.includes(project), false);
    assert.equal(execution.stdout.includes(candidate.journalPath), false);
    assert.equal(execution.stdout.includes(uatBaselinePackage), false);
    assert.equal(execution.stdout.includes(uatSuccessorPackage), false);
    for (const key of [
      "realCodexSessionVerified",
      "codexActivationVerified",
      "hostBehaviorVerified",
      "agentPackageQualityCertified",
      "domainQualityCertified",
      "productionApproved",
    ]) assert.equal(report.evidence[key], false, key);
    assert.equal(Object.hasOwn(report, "scenarios"), false);

    const human = await runStableCli([
      "builder", "behavior", "--project", project,
      "--digest", `builder-install-receipt=${installation.receiptDigest}`,
      "--uat-journal", candidate.journalPath,
      "--uat-candidate", candidate.path,
      ...uatReleaseEvidenceArgs(),
      "--digest", `builder-codex-uat-head=${candidate.headDigest}`,
      "--digest", `builder-codex-uat-candidate=${candidate.digest}`,
    ], project, home);
    assert.equal(human.code, 0, `${human.stderr}${human.stdout}`);
    assert.match(human.stdout, /Codex UAT candidate-ready chain/u);
    assert.match(human.stdout, /Scenarios: 11\/11/u);
    assert.match(human.stdout, /External decision authority required: true/u);

    const legacy = await runStableCli([
      "builder", "behavior", "--project", project,
      "--digest", `builder-install-receipt=${installation.receiptDigest}`,
      "--uat", candidate.path,
      "--digest", `builder-codex-uat=${candidate.digest}`,
      "--json",
    ], project, home);
    assert.notEqual(legacy.code, 0);
    assert.equal(
      JSON.parse(legacy.stdout).code,
      "AGENTMO_CLI_BUILDER_UAT_MIGRATION_REQUIRED",
    );
    assert.match(JSON.parse(legacy.stdout).guidance, /--uat-journal/u);

    const wrongDigest = await runStableCli([
      "builder", "behavior", "--project", project,
      "--digest", `builder-install-receipt=${installation.receiptDigest}`,
      "--uat-journal", candidate.journalPath,
      "--uat-candidate", candidate.path,
      ...uatReleaseEvidenceArgs(),
      "--digest", `builder-codex-uat-head=${candidate.headDigest}`,
      "--digest", `builder-codex-uat-candidate=sha256:${"f".repeat(64)}`,
      "--json",
    ], project, home);
    assert.notEqual(wrongDigest.code, 0);

    for (const [binding, value] of [
      ["releaseDigest", `sha256:${"a".repeat(64)}`],
      ["successorVersion", "9.9.9"],
      ["successorPackageName", "different-successor-package"],
    ]) {
      await assert.rejects(
        () => createUatCandidate(root, project, installation, {
          candidateOverrides: { [binding]: value },
        }),
        (error) => error?.code === "AGENTMO_IMMUTABLE_JOURNAL_AUTHORITY_REJECTED",
        binding,
      );
    }

    await assert.rejects(
      () => createUatCandidate(root, project, installation, {
        candidateOverrides: { releaseSet: uatAlternateReleaseSet },
      }),
      (error) => error?.code === "AGENTMO_IMMUTABLE_JOURNAL_AUTHORITY_REJECTED",
    );

    await assert.rejects(
      () => forgeUatJournalAndCandidate(root, candidate, {
        releaseSet: uatAlternateReleaseSet,
        baseline: uatAlternatePair.baseline,
      }),
      (error) => error?.code === "AGENTMO_IMMUTABLE_JOURNAL_AUTHORITY_REJECTED",
    );

    await writeFile(probeMarker, "", "utf8");
    const differentBaselineRejected = await runStableCli([
      "builder", "behavior", "--project", project,
      "--digest", `builder-install-receipt=${installation.receiptDigest}`,
      "--uat-journal", candidate.journalPath,
      "--uat-candidate", candidate.path,
      ...uatReleaseEvidenceArgs({
        baselinePackage: uatAlternateBaselinePackage,
        baselineTarball: uatAlternateBaselineTarball,
        successorPackage: uatAlternatePackage,
        successorTarball: uatAlternateTarball,
      }),
      "--digest", `builder-codex-uat-head=${candidate.headDigest}`,
      "--digest", `builder-codex-uat-candidate=${candidate.digest}`,
      "--json",
    ], project, home);
    assert.notEqual(differentBaselineRejected.code, 0);
    assert.equal(await readFile(probeMarker, "utf8"), "");

    await writeFile(probeMarker, "", "utf8");
    const crossPairTarballRejected = await runStableCli([
      "builder", "behavior", "--project", project,
      "--digest", `builder-install-receipt=${installation.receiptDigest}`,
      "--uat-journal", candidate.journalPath,
      "--uat-candidate", candidate.path,
      ...uatReleaseEvidenceArgs({ successorTarball: uatAlternateTarball }),
      "--digest", `builder-codex-uat-head=${candidate.headDigest}`,
      "--digest", `builder-codex-uat-candidate=${candidate.digest}`,
      "--json",
    ], project, home);
    assert.notEqual(crossPairTarballRejected.code, 0);
    assert.equal(
      JSON.parse(crossPairTarballRejected.stdout).code,
      "AGENTMO_BUILDER_BEHAVIOR_UAT_PAIR_REJECTED",
    );
    assert.equal(await readFile(probeMarker, "utf8"), "");

    await assert.rejects(
      () => forgeUatJournalAndCandidate(root, candidate, {
        setup: { installReceiptDigest: `sha256:${"c".repeat(64)}` },
      }),
      (error) => error?.code === "AGENTMO_IMMUTABLE_JOURNAL_AUTHORITY_REJECTED",
    );

    const completeEvidenceArgs = uatReleaseEvidenceArgs();
    for (let omitted = 0; omitted < completeEvidenceArgs.length; omitted += 2) {
      const incompleteEvidenceArgs = completeEvidenceArgs.filter(
        (_value, index) => index !== omitted && index !== omitted + 1,
      );
      await writeFile(probeMarker, "", "utf8");
      const missingEvidence = await runStableCli([
        "builder", "behavior", "--project", project,
        "--digest", `builder-install-receipt=${installation.receiptDigest}`,
        "--uat-journal", candidate.journalPath,
        "--uat-candidate", candidate.path,
        ...incompleteEvidenceArgs,
        "--digest", `builder-codex-uat-head=${candidate.headDigest}`,
        "--digest", `builder-codex-uat-candidate=${candidate.digest}`,
        "--json",
      ], project, home);
      assert.notEqual(missingEvidence.code, 0, completeEvidenceArgs[omitted]);
      assert.equal(
        JSON.parse(missingEvidence.stdout).code,
        "AGENTMO_CLI_BUILDER_REJECTED",
        completeEvidenceArgs[omitted],
      );
      assert.equal(await readFile(probeMarker, "utf8"), "", completeEvidenceArgs[omitted]);
    }

    await assert.rejects(
      () => createUatCandidate(root, project, installation, {
        candidateTarballDigest: `sha256:${"b".repeat(64)}`,
      }),
      (error) => error?.code === "AGENTMO_CODEX_UAT_CANDIDATE_REJECTED",
      "a candidate whose tarball digest differs from its signed successor cannot become ready",
    );

    await assert.rejects(
      () => behaviorModule.runBuilderBehaviorEvaluation({
        projectRoot: project,
        expectedReceiptDigest: installation.receiptDigest,
        uatJournalPath: candidate.journalPath,
        expectedUatHeadDigest: candidate.headDigest,
        uatCandidatePath: candidate.path,
        expectedUatCandidateDigest: candidate.digest,
        uatBaselinePackageRoot: uatBaselinePackage,
        uatBaselineTarballPath: uatBaselineTarball,
        uatSuccessorPackageRoot: uatSuccessorPackage,
        uatSuccessorTarballPath: uatSuccessorTarball,
        hostBehaviorVerified: true,
      }),
      (error) => error?.code === "AGENTMO_BUILDER_BEHAVIOR_OPTIONS_REJECTED",
    );
  });

  packedBehaviorIt("rejects a digest-consistent ledger without the exact current project consumer", async () => {
    for (const mode of ["missing", "scope-mismatch", "release-mismatch"]) {
      const root = await mkdtemp(path.join(tmpdir(), `agentmo-behavior-consumer-${mode}-`));
      const project = path.join(root, "project");
      const home = path.join(root, "home");
      await mkdir(project);
      await mkdir(home);
      const original = await installUatLifecycleProject(project, home);
      const expected = buildCodexConsumerEntry({
        selector: SELECTOR,
        projectScopeDigest: original.scopeDigest,
        releaseDigest: original.genesisReceipt.identity.releaseDigest,
      });
      const consumers = mode === "missing"
        ? []
        : [buildCodexConsumerEntry({
            selector: SELECTOR,
            projectScopeDigest: mode === "scope-mismatch"
              ? `sha256:${"a".repeat(64)}`
              : expected.projectScopeDigest,
            releaseDigest: mode === "release-mismatch"
              ? `sha256:${"b".repeat(64)}`
              : expected.releaseDigest,
          })];
      const installation = await replaceActivatedConsumerLedger(
        home,
        project,
        original,
        consumers,
      );
      const candidate = await createUatCandidate(root, project, installation);
      const execution = await runStableCli([
        "builder", "behavior", "--project", project,
        "--digest", `builder-install-receipt=${installation.receiptDigest}`,
        "--uat-journal", candidate.journalPath,
        "--uat-candidate", candidate.path,
        ...uatReleaseEvidenceArgs(),
        "--digest", `builder-codex-uat-head=${candidate.headDigest}`,
        "--digest", `builder-codex-uat-candidate=${candidate.digest}`,
        "--json",
      ], project, home);
      assert.notEqual(execution.code, 0, mode);
      assert.match(execution.stdout, /AGENTMO_BUILDER_BEHAVIOR_UAT_HOST_REJECTED/u, mode);
    }
  });
});
