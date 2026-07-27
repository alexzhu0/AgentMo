import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import {
  link,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { before, describe, it } from "node:test";

import { digestRawBytes } from "../src/artifact-admission.js";
import * as codexUatModule from "../src/builder-codex-uat.js";
import {
  CODEX_UAT_ATTEMPT_JOURNAL_SCHEMA_VERSION,
  CODEX_UAT_CANDIDATE_SCHEMA_VERSION,
  CODEX_UAT_SCENARIO_IDS,
  appendCodexUatCandidateReady,
  armCodexUatScenario,
  loadCodexUatAttemptJournal,
  loadExistingCodexUatCandidate,
  publishCodexUatObservationLeaf,
  publishCodexUatCandidate,
  releaseCodexUatLeafDirectoryAuthority,
  recordCodexUatActivationApplied,
  recordCodexUatScenarioObservation,
  recordCodexUatSetupApplied,
  recordCodexUatTrustAuthObservation,
  resumeCodexUatAttempt,
  startCodexUatAttempt,
  terminateCodexUatAttempt,
  retainCodexUatLeafDirectoryAuthority,
  verifyCodexUatCandidateDecision,
} from "../src/builder-codex-uat.js";
import {
  buildBuilderCheckpoint,
  writeBuilderCheckpoint,
} from "../src/builder-checkpoint.js";
import {
  appendImmutableJournalEntry,
} from "../src/builder-immutable-journal.js";
import { serializePersistableJson } from "../src/persistability.js";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const LEAF_CHILD = path.join(REPO_ROOT, "test/helpers/codex-uat-leaf-child.js");
const TERMINATE_CHILD = path.join(REPO_ROOT, "test/helpers/codex-uat-terminate-child.js");

const digest = (label) => digestRawBytes(Buffer.from(`${label}\n`, "utf8"));
const D = Object.freeze(Object.fromEntries([
  "baseline-release", "baseline-tarball", "successor-release", "successor-tarball",
  "setup-plan", "receipt", "checkpoint", "owner", "consumer", "activation-plan",
  "marketplace", "selector", "ledger", "host", "process", "trust", "auth", "verifier",
  "failure", "interruption",
].map((label) => [label, digest(label)])));

let releaseFixture;

function setupDetails(baseline) {
  return {
    baselineVersion: baseline.version,
    releaseDigest: baseline.releaseDigest,
    tarballDigest: baseline.tarballDigest,
    setupPlanDigest: D["setup-plan"],
    installReceiptDigest: D.receipt,
    checkpointDigest: D.checkpoint,
    marketplaceOwnerDigest: D.owner,
    marketplaceConsumerDigest: D.consumer,
  };
}

function activationDetails(setup) {
  return {
    activationPlanDigest: D["activation-plan"],
    marketplaceDigest: D.marketplace,
    selectorDigest: D.selector,
    ownerDigest: D.owner,
    consumerLedgerDigest: D.ledger,
    hostObservationDigest: D.host,
    releaseDigest: setup.releaseDigest,
    installReceiptDigest: setup.installReceiptDigest,
    checkpointDigest: D.checkpoint,
  };
}

function trustAuthDetails() {
  return {
    freshProcessDigest: D.process,
    trustObservationDigest: D.trust,
    authObservationDigest: D.auth,
    observationBasis: "human-observed-no-cryptographic-origin",
  };
}

function scenarioEvidence(scenario, index) {
  const d = (suffix) => digest(`${scenario}-${suffix}-${index}`);
  switch (scenario) {
    case "session-start": return { hookEventDigest: d("hook") };
    case "skill-discovery": return { visibilityDigest: d("visibility") };
    case "user-prompt-non-trigger": return { nonTriggerDigest: d("non-trigger") };
    case "manual-pause": return { checkpointSuccessorDigest: d("successor") };
    case "pre-compact": return { checkpointSuccessorDigest: d("successor") };
    case "post-compact": return { workflowIdentityDigest: d("workflow") };
    case "restart-resume": return { freshProcessDigest: d("process") };
    case "duplicate-replay": {
      const unchanged = d("unchanged");
      return { beforeCheckpointDigest: unchanged, afterCheckpointDigest: unchanged };
    }
    case "second-compaction": return {
      compactionEpochDigest: d("epoch"),
      checkpointSuccessorDigest: d("successor"),
    };
    case "upgrade-visibility": return {
      successorVersion: releaseFixture.successorVersion,
      releaseDigest: releaseFixture.identity.successor.releaseDigest,
      tarballDigest: releaseFixture.identity.successor.tarballDigest,
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
    default: throw new Error(`unknown scenario ${scenario}`);
  }
}

function scenarioDetails(scenario, index) {
  return {
    scenario,
    checkpointLeafDigest: digest(`${scenario}-checkpoint-leaf-${index}`),
    observationLeafDigest: digest(`${scenario}-observation-leaf-${index}`),
    evidence: scenarioEvidence(scenario, index),
  };
}

async function newAttempt(prefix = "agentmo-codex-uat-journal-", journalName = "attempt.json") {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  const journalPath = path.join(root, journalName);
  const view = await startCodexUatAttempt({
    journalPath,
    attemptId: "attempt-001",
    baseline: {
      packageRoot: releaseFixture.baselinePackage,
      tarballPath: releaseFixture.baselineTarball,
    },
    successor: {
      packageRoot: releaseFixture.successorPackage,
      tarballPath: releaseFixture.successorTarball,
    },
  });
  return { root, journalPath, view };
}

async function buildReleaseFixture({
  baselineVersion = "0.1.0-uat.18.1",
  successorVersion = "0.1.0-uat.18.2",
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-plan-18-uat-releases-"));
  const out = path.join(root, "releases");
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

function canonicalBytes(value, subject) {
  return Buffer.from(serializePersistableJson(value, { subject }), "utf8");
}

function collectDigests(value, output = []) {
  if (typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value)) {
    if (!output.includes(value)) output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectDigests(item, output);
    return output;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectDigests(item, output);
  }
  return output;
}

function syntheticRawUatHistory(view, candidateDigest) {
  const setup = setupDetails(view.state.baseline);
  const entries = [
    ["setup-applied", setup],
    ["activation-applied", activationDetails(setup)],
    ["trust-auth-observed", trustAuthDetails()],
    ...CODEX_UAT_SCENARIO_IDS.map((scenario, index) => [
      "scenario-observed",
      scenarioDetails(scenario, index),
    ]),
    ["candidate-ready", { candidateDigest }],
  ];
  return entries.map(([kind, details]) => ({
    schemaVersion: CODEX_UAT_ATTEMPT_JOURNAL_SCHEMA_VERSION,
    attemptId: view.state.attemptId,
    kind,
    details,
    evidenceDigests: collectDigests(details),
  }));
}

async function attemptPackedRawUatHistory(journalPath, entries) {
  const genericJournalUrl = pathToFileURL(path.join(
    releaseFixture.successorPackage,
    "src",
    "builder-immutable-journal.js",
  )).href;
  const persistabilityUrl = pathToFileURL(path.join(
    releaseFixture.successorPackage,
    "src",
    "persistability.js",
  )).href;
  const script = `
const journal = await import(${JSON.stringify(genericJournalUrl)});
const { serializePersistableJson } = await import(${JSON.stringify(persistabilityUrl)});
const [journalPath, encodedEntries] = process.argv.slice(1);
const templates = JSON.parse(Buffer.from(encodedEntries, "base64url").toString("utf8"));
let current = await journal.loadImmutableJournal({ journalPath, maxValueBytes: 256 * 1024 });
const result = { planned: templates.length, attempted: 0, appended: 0, rejectedCodes: [] };
for (const template of templates) {
  const entry = {
    ...template,
    sequence: current.entries.length,
    predecessorDigest: current.head?.digest ?? null,
  };
  const canonicalBytes = Buffer.from(serializePersistableJson(entry, {
    subject: "builder-codex-uat-attempt-entry",
  }), "utf8");
  result.attempted += 1;
  try {
    const appended = await journal.appendImmutableJournalEntry({
      journalPath,
      canonicalBytes,
      maxValueBytes: 256 * 1024,
      ...(current.head === null ? {} : { expectedPredecessorAdmission: current.head }),
    });
    if (appended.committed) {
      result.appended += 1;
      current = await journal.loadImmutableJournal({ journalPath, maxValueBytes: 256 * 1024 });
    }
  } catch (error) {
    result.rejectedCodes.push(error?.code ?? null);
  }
}
process.stdout.write(JSON.stringify(result));
`;
  const { stdout } = await execFileAsync(process.execPath, [
    "--input-type=module",
    "--eval",
    script,
    journalPath,
    Buffer.from(JSON.stringify(entries), "utf8").toString("base64url"),
  ], { cwd: REPO_ROOT, encoding: "utf8" });
  return JSON.parse(stdout);
}

async function attemptPackedGenericSuccessor(journalPath) {
  const genericJournalUrl = pathToFileURL(path.join(
    releaseFixture.successorPackage,
    "src",
    "builder-immutable-journal.js",
  )).href;
  const script = `
const journal = await import(${JSON.stringify(genericJournalUrl)});
const [journalPath] = process.argv.slice(1);
const current = await journal.loadImmutableJournal({ journalPath, maxValueBytes: 256 * 1024 });
let rejectionCode = null;
try {
  await journal.appendImmutableJournalEntry({
    journalPath,
    canonicalBytes: Buffer.from("generic"),
    expectedPredecessorAdmission: current.head,
    maxValueBytes: 256 * 1024,
  });
} catch (error) {
  rejectionCode = error?.code ?? null;
}
process.stdout.write(JSON.stringify({
  entries: current.entries.length,
  headDigest: current.head?.digest ?? null,
  rejectionCode,
}));
`;
  const { stdout } = await execFileAsync(process.execPath, [
    "--input-type=module",
    "--eval",
    script,
    journalPath,
  ], { cwd: REPO_ROOT, encoding: "utf8" });
  return JSON.parse(stdout);
}

async function attemptFreezeHookedPackedGenericUatMutation({
  journalPath,
  rawJournalPath,
}) {
  const genericJournalUrl = pathToFileURL(path.join(
    releaseFixture.successorPackage,
    "src",
    "builder-immutable-journal.js",
  )).href;
  const uatUrl = pathToFileURL(path.join(
    releaseFixture.successorPackage,
    "src",
    "builder-codex-uat.js",
  )).href;
  const script = `
const [journalPath, rawJournalPath, encodedFixture] = process.argv.slice(1);
const fixture = JSON.parse(Buffer.from(encodedFixture, "base64url").toString("utf8"));
const frozen = [];
const originalFreeze = Object.freeze;
Object.freeze = (value) => {
  frozen.push(value);
  return originalFreeze(value);
};
const journal = await import(${JSON.stringify(genericJournalUrl)});
const uat = await import(${JSON.stringify(uatUrl)});
function capturedCapabilities() {
  const visited = new Set();
  const captured = [];
  const visit = (value) => {
    if (value === null || (typeof value !== "object" && typeof value !== "function")
      || visited.has(value)) return;
    visited.add(value);
    if (uat.isCodexUatJournalAppendCapability(value)) {
      captured.push(value);
      return;
    }
    for (const key of Reflect.ownKeys(value)) {
      try {
        visit(value[key]);
      } catch {
        // A hostile capture graph is only a candidate source, never authority.
      }
    }
  };
  for (const value of frozen) visit(value);
  return captured;
}
const initializationCaptured = capturedCapabilities();
const started = await uat.startCodexUatAttempt({
  journalPath,
  attemptId: "attempt-freeze-hook",
  baseline: fixture.baseline,
  successor: fixture.successor,
});
const captured = capturedCapabilities();
Object.freeze = originalFreeze;
const candidates = [Object.create(null), ...captured];
const rawGenesis = Buffer.from(JSON.stringify({
  schemaVersion: "agentmo.codex-uat-attempt-journal.v2",
  attemptId: "raw-freeze-hook",
  sequence: 0,
  kind: "attempt-started",
  predecessorDigest: null,
  evidenceDigests: [],
  details: {},
}));
async function attempt(options) {
  const rejectionCodes = [];
  for (const authorityCapability of candidates) {
    try {
      const result = await journal.appendImmutableJournalEntry({
        ...options,
        authorityCapability,
      });
      if (result.committed) return { committed: true, rejectionCodes: [] };
    } catch (error) {
      rejectionCodes.push(error?.code ?? null);
    }
  }
  return {
    committed: false,
    rejectionCodes: [...new Set(rejectionCodes)].toSorted(),
  };
}
const rawGenesisResult = await attempt({
  journalPath: rawJournalPath,
  canonicalBytes: rawGenesis,
  maxValueBytes: 256 * 1024,
});
const current = await journal.loadImmutableJournal({
  journalPath,
  maxValueBytes: 256 * 1024,
});
const rawSuccessorResult = await attempt({
  journalPath,
  canonicalBytes: Buffer.from("raw-generic-successor"),
  expectedPredecessorAdmission: current.head,
  maxValueBytes: 256 * 1024,
});
const final = await uat.loadCodexUatAttemptJournal(journalPath);
process.stdout.write(JSON.stringify({
  initializationCapturedCapabilityCount: initializationCaptured.length,
  runtimeCapturedCapabilityCount: captured.length,
  rawGenesis: rawGenesisResult,
  rawSuccessor: rawSuccessorResult,
  finalEntries: final.entries.length,
  finalPhase: final.state.phase,
  startedHeadDigest: started.head?.digest ?? null,
  finalHeadDigest: final.head?.digest ?? null,
}));
`;
  const fixture = Buffer.from(JSON.stringify({
    baseline: {
      packageRoot: releaseFixture.baselinePackage,
      tarballPath: releaseFixture.baselineTarball,
    },
    successor: {
      packageRoot: releaseFixture.successorPackage,
      tarballPath: releaseFixture.successorTarball,
    },
  }), "utf8").toString("base64url");
  const { stdout } = await execFileAsync(process.execPath, [
    "--input-type=module",
    "--eval",
    script,
    journalPath,
    rawJournalPath,
    fixture,
  ], { cwd: REPO_ROOT, encoding: "utf8" });
  return JSON.parse(stdout);
}

async function writeEvidence(filePath, value, subject = "codex-uat-test-evidence") {
  const bytes = Buffer.isBuffer(value) ? value : canonicalBytes(value, subject);
  await writeFile(filePath, bytes, { flag: "wx", mode: 0o600 });
  return { filePath, digest: digestRawBytes(bytes), bytes };
}

function checkpointValue(receiptDigest) {
  return buildBuilderCheckpoint({
    workflowId: "uat-workflow",
    adapterId: "codex",
    stage: "produce",
    boundary: "manual-pause",
    artifactRefs: [],
    pendingDecision: null,
    nextAction: "complete",
    installReceiptDigest: receiptDigest,
    capabilitySnapshot: {
      adapterId: "codex",
      evidenceLevel: "observed",
      digest: digest("capability"),
      required: [{ id: "hooks", status: "observed" }],
    },
    eventLedger: { cursor: 0, recentEvents: [] },
    pauseReason: "user-request",
    codexUatChallenge: null,
  });
}

function activatedReceiptValue(baseline) {
  const marketplaceProjectionDigest = digest("marketplace");
  const transactionDigest = digest("marketplace-transaction");
  const rootIdentity = {
    device: "1",
    group: "1",
    inode: "1",
    links: "1",
    mode: "700",
    owner: "1",
    size: "1",
  };
  const finalProjectionBinding = {
    schemaVersion: "agentmo.codex-marketplace-projection-binding.v1",
    transactionId: transactionDigest.slice("sha256:".length),
    transactionDigest,
    releaseDigest: baseline.releaseDigest,
    contentDigest: marketplaceProjectionDigest,
    rootIdentity,
    rootIdentityDigest: digestRawBytes(canonicalBytes({
      schemaVersion: "agentmo.codex-marketplace-root-identity.v1",
      ...rootIdentity,
    }, "codex-marketplace-root-identity")),
    members: [{
      kind: "root",
      relativePath: "",
      digest: null,
      identity: { ...rootIdentity },
    }],
  };
  return {
    schemaVersion: "agentmo.builder-install-receipt.v4",
    status: "activated",
    identity: {
      name: baseline.packageName,
      version: baseline.version,
      adapterId: "codex",
      releaseDigest: baseline.releaseDigest,
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
      releaseDigest: baseline.releaseDigest,
      marketplaceProjectionDigest,
      operationOrderDigest: digest("activation-operation-order"),
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
      finalProjectionBinding,
    },
  };
}

async function advanceToActivation(attempt) {
  const baseline = attempt.view.state.baseline;
  const receipt = await writeEvidence(
    path.join(attempt.root, "install-receipt.json"),
    activatedReceiptValue(baseline),
    "builder-install-receipt",
  );
  const checkpointPath = path.join(attempt.root, "checkpoint.json");
  let checkpointAdmission = await writeBuilderCheckpoint(
    checkpointPath,
    checkpointValue(receipt.digest),
  );
  let view = await recordCodexUatSetupApplied({
    journalPath: attempt.journalPath,
    expectedHeadAdmission: attempt.view.head,
    installReceiptPath: receipt.filePath,
    expectedInstallReceiptDigest: receipt.digest,
    checkpointAdmission,
  });
  const host = await writeEvidence(path.join(attempt.root, "host-observation.json"), {
    schemaVersion: "agentmo.builder-codex-host-observation.v1",
    status: "human-bounded-observation",
  });
  view = await recordCodexUatActivationApplied({
    journalPath: attempt.journalPath,
    expectedHeadAdmission: view.head,
    installReceiptPath: receipt.filePath,
    expectedInstallReceiptDigest: receipt.digest,
    checkpointAdmission,
    hostObservationPath: host.filePath,
    expectedHostObservationDigest: host.digest,
  });
  return { ...attempt, view, receipt, checkpointPath, checkpointAdmission };
}

async function advanceToTrustAuth(attempt) {
  const activated = await advanceToActivation(attempt);
  let { view } = activated;
  const processEvidence = await writeEvidence(path.join(attempt.root, "fresh-process.json"), Buffer.from("fresh process\n"));
  const trustEvidence = await writeEvidence(path.join(attempt.root, "trust.json"), Buffer.from("human trust observed\n"));
  const authEvidence = await writeEvidence(path.join(attempt.root, "auth.json"), Buffer.from("human auth observed\n"));
  view = await recordCodexUatTrustAuthObservation({
    journalPath: activated.journalPath,
    expectedHeadAdmission: view.head,
    freshProcessEvidencePath: processEvidence.filePath,
    expectedFreshProcessDigest: processEvidence.digest,
    trustObservationPath: trustEvidence.filePath,
    expectedTrustObservationDigest: trustEvidence.digest,
    authObservationPath: authEvidence.filePath,
    expectedAuthObservationDigest: authEvidence.digest,
  });
  return { ...activated, view };
}

async function throughScenarios() {
  const attempt = await advanceToTrustAuth(await newAttempt());
  let { view, checkpointAdmission } = attempt;
  const observationDirectory = path.join(attempt.root, "observations");
  for (const [index, scenario] of CODEX_UAT_SCENARIO_IDS.entries()) {
    const armed = await armCodexUatScenario({
      journalPath: attempt.journalPath,
      expectedHeadAdmission: view.head,
      checkpointPath: attempt.checkpointPath,
      checkpointAdmission,
    });
    checkpointAdmission = armed.checkpointAdmission;
    const observation = await publishCodexUatObservationLeaf({
      outDirectory: observationDirectory,
      attemptId: view.state.attemptId,
      scenario,
      correlation: armed.correlation,
      source: "operator-observation",
      eventDigest: digest(`${scenario}-event-${index}`),
      runnerDigest: digest(`${scenario}-runner-${index}`),
      releaseDigest: view.state.baseline.releaseDigest,
      installReceiptDigest: attempt.receipt.digest,
    });
    view = await recordCodexUatScenarioObservation({
      journalPath: attempt.journalPath,
      expectedHeadAdmission: view.head,
      checkpointAdmission,
      observationAdmission: observation,
      evidence: scenarioEvidence(scenario, index),
    });
  }
  return { ...attempt, view, checkpointAdmission };
}

async function snapshotJournal(root) {
  const names = (await readdir(root)).toSorted();
  const entries = [];
  for (const name of names) {
    const filePath = path.join(root, name);
    const metadata = await stat(filePath);
    if (!metadata.isFile()) continue;
    entries.push([name, await readFile(filePath)]);
  }
  return entries;
}

function startLeafChild(options) {
  return spawn(
    process.execPath,
    [LEAF_CHILD, JSON.stringify({ options })],
    { stdio: ["ignore", "ignore", "ignore", "ipc"] },
  );
}

function collectLeafChild(child) {
  return new Promise((resolve, reject) => {
    let terminal = null;
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Codex UAT leaf child timed out"));
    }, 15_000);
    child.on("error", reject);
    child.on("message", (message) => {
      if (["result", "error"].includes(message?.type)) terminal = message;
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timeout);
      resolve({ ...terminal, exitCode, signal });
    });
  });
}

async function stopLeafChildAt(options, directory, predicate) {
  const child = startLeafChild(options);
  const terminalPromise = collectLeafChild(child);
  const deadline = Date.now() + 15_000;
  let matched = false;
  while (Date.now() < deadline && child.exitCode === null) {
    const names = await readdir(directory);
    if (names.some(predicate)) {
      matched = true;
      child.kill("SIGSTOP");
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.equal(matched, true, "leaf child completed before the filesystem boundary was observed");
  return { child, terminalPromise };
}

async function stopLeafChildAtCreatedDirectory(options, directory, name) {
  const child = startLeafChild(options);
  const terminalPromise = collectLeafChild(child);
  const deadline = Date.now() + 15_000;
  let matched = false;
  while (Date.now() < deadline && child.exitCode === null) {
    const current = await lstat(path.join(directory, name), { bigint: true }).catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (current?.isDirectory() && !current.isSymbolicLink()) {
      matched = true;
      child.kill("SIGSTOP");
      break;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(matched, true, "leaf child completed before retained bootstrap was observed");
  return { child, terminalPromise };
}

async function stopTerminationAtPrepared(options, directory, sequence) {
  const child = spawn(
    process.execPath,
    [TERMINATE_CHILD, JSON.stringify(options)],
    { stdio: ["ignore", "ignore", "ignore", "ipc"] },
  );
  const closed = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (exitCode, signal) => resolve({ exitCode, signal }));
  });
  const preparedName = `.attempt.json.agentmo-journal.prepared.${String(sequence).padStart(12, "0")}.json`;
  const deadline = Date.now() + 15_000;
  let stopped = false;
  while (Date.now() < deadline && child.exitCode === null) {
    if ((await readdir(directory)).includes(preparedName)) {
      stopped = child.kill("SIGSTOP");
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.equal(stopped, true, "termination child completed before its prepared claim was observed");
  child.kill("SIGKILL");
  assert.deepEqual(await closed, { exitCode: null, signal: "SIGKILL" });
}

describe("sole immutable Codex UAT journal authority", () => {
  before(async () => {
    releaseFixture = await buildReleaseFixture();
  });
  it("does not export raw transition or caller-minted human-decision authority", () => {
    for (const name of [
      "appendCodexUatAttemptEntry",
      "inspectCodexUatCandidateForHumanDecision",
      "decideCodexUatCandidate",
    ]) {
      assert.equal(Object.hasOwn(codexUatModule, name), false, `${name} must remain module-private`);
    }
  });

  it("keeps raw append authority unavailable to a direct-import child process", async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      path.join(REPO_ROOT, "test/helpers/codex-uat-exports-child.js"),
    ]);
    assert.deepEqual(JSON.parse(stdout), {
      forbidden: [],
      atomicVerifier: "function",
    });
  });

  it("delegates query-suffixed UAT mutations to the canonical capability owner", async () => {
    const queryModule = await import(`${pathToFileURL(path.join(
      REPO_ROOT,
      "src",
      "builder-codex-uat.js",
    )).href}?authority-isolation=${Date.now()}`);
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-codex-uat-query-authority-"));
    const journalPath = path.join(root, "attempt.journal");
    const started = await queryModule.startCodexUatAttempt({
      journalPath,
      attemptId: "attempt-query-authority",
      baseline: {
        packageRoot: releaseFixture.baselinePackage,
        tarballPath: releaseFixture.baselineTarball,
      },
      successor: {
        packageRoot: releaseFixture.successorPackage,
        tarballPath: releaseFixture.successorTarball,
      },
    });
    const canonical = await loadCodexUatAttemptJournal(journalPath);
    assert.equal(canonical.head.digest, started.head.digest);
    assert.equal(canonical.state.phase, "started");
  });

  it("keeps the packed UAT append token private from a freeze-hooked generic importer", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-codex-uat-freeze-hook-"));
    const rawRoot = path.join(root, "raw");
    await mkdir(rawRoot);
    const attempted = await attemptFreezeHookedPackedGenericUatMutation({
      journalPath: path.join(root, "attempt.journal"),
      rawJournalPath: path.join(rawRoot, "attempt.journal"),
    });
    assert.deepEqual(attempted, {
      initializationCapturedCapabilityCount: 0,
      runtimeCapturedCapabilityCount: 0,
      rawGenesis: {
        committed: false,
        rejectionCodes: ["AGENTMO_IMMUTABLE_JOURNAL_AUTHORITY_REJECTED"],
      },
      rawSuccessor: {
        committed: false,
        rejectionCodes: ["AGENTMO_IMMUTABLE_JOURNAL_AUTHORITY_REJECTED"],
      },
      finalEntries: 1,
      finalPhase: "started",
      startedHeadDigest: attempted.finalHeadDigest,
      finalHeadDigest: attempted.finalHeadDigest,
    });
    assert.deepEqual(await readdir(rawRoot), []);
  });

  it("rejects a packed file-URL generic successor of a canonical UAT head before publication", async () => {
    const { root, journalPath, view: started } = await newAttempt(
      "agentmo-codex-uat-packed-generic-successor-",
      "attempt.journal",
    );
    const before = await snapshotJournal(root);

    const attempted = await attemptPackedGenericSuccessor(journalPath);
    assert.deepEqual(attempted, {
      entries: started.entries.length,
      headDigest: started.head.digest,
      rejectionCode: "AGENTMO_IMMUTABLE_JOURNAL_AUTHORITY_REJECTED",
    });
    assert.deepEqual(await snapshotJournal(root), before);

    const after = await loadCodexUatAttemptJournal(journalPath);
    assert.equal(after.entries.length, started.entries.length);
    assert.equal(after.head.digest, started.head.digest);
    assert.equal(after.state.phase, "started");
    assert.equal(after.state.terminal, false);
    assert.equal(after.recoveryRequired, false);

    const resumed = await resumeCodexUatAttempt(journalPath, {
      expectedHeadDigest: started.head.digest,
    });
    assert.equal(resumed.terminal, false);
    assert.equal(resumed.recoveryRequired, false);
  });

  it("admits one package across distinct baseline/successor versions and rejects a no-op release", async () => {
    const { view: started } = await newAttempt("agentmo-codex-uat-release-order-");
    assert.equal(started.state.baseline.packageName, "agentmo");
    assert.equal(started.state.successor.packageName, "agentmo");
    assert.equal(started.state.baseline.role, "baseline");
    assert.equal(started.state.successor.role, "successor");
    assert.notEqual(started.state.baseline.version, started.state.successor.version);
    assert.match(started.state.releaseSet.operationId, /^sha256:[a-f0-9]{64}$/u);
    assert.match(started.state.releaseSet.releaseSetDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.deepEqual(started.entries[0].details.releaseSet, started.state.releaseSet);

    const noOpRoot = await mkdtemp(path.join(tmpdir(), "agentmo-codex-uat-no-op-release-"));
    const before = await readdir(noOpRoot);
    await assert.rejects(
      startCodexUatAttempt({
        journalPath: path.join(noOpRoot, "attempt.json"),
        attemptId: "attempt-no-op-release",
        baseline: {
          packageRoot: releaseFixture.baselinePackage,
          tarballPath: releaseFixture.baselineTarball,
        },
        successor: {
          packageRoot: releaseFixture.baselinePackage,
          tarballPath: releaseFixture.baselineTarball,
        },
      }),
      (error) => error?.code === "AGENTMO_CODEX_UAT_RELEASE_EVIDENCE_REJECTED",
    );
    assert.deepEqual(await readdir(noOpRoot), before);
  });

  it("rejects cross-paired, wrong-role, and uncommitted release evidence before journal mutation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-codex-uat-release-pairing-"));
    const journalPath = path.join(root, "attempt.journal");
    const validSuccessor = {
      packageRoot: releaseFixture.successorPackage,
      tarballPath: releaseFixture.successorTarball,
    };
    const beforeCrossPair = await readdir(root);
    await assert.rejects(
      startCodexUatAttempt({
        journalPath,
        attemptId: "attempt-cross-pair",
        baseline: {
          packageRoot: releaseFixture.successorPackage,
          tarballPath: releaseFixture.baselineTarball,
        },
        successor: validSuccessor,
      }),
      (error) => error?.code === "AGENTMO_CODEX_UAT_RELEASE_EVIDENCE_REJECTED",
    );
    assert.deepEqual(await readdir(root), beforeCrossPair);

    await assert.rejects(
      startCodexUatAttempt({
        journalPath,
        attemptId: "attempt-wrong-role",
        baseline: {
          packageRoot: releaseFixture.baselinePackage,
          tarballPath: releaseFixture.successorTarball,
        },
        successor: validSuccessor,
      }),
      (error) => error?.code === "AGENTMO_CODEX_UAT_RELEASE_EVIDENCE_REJECTED",
    );
    assert.deepEqual(await readdir(root), beforeCrossPair);

    const nonArchivePath = path.join(root, "not-a-release.tgz");
    await writeFile(nonArchivePath, Buffer.from("bounded but uncommitted\n"), {
      flag: "wx",
      mode: 0o600,
    });
    const beforeNonArchive = await readdir(root);
    await assert.rejects(
      startCodexUatAttempt({
        journalPath,
        attemptId: "attempt-non-archive",
        baseline: {
          packageRoot: releaseFixture.baselinePackage,
          tarballPath: nonArchivePath,
        },
        successor: validSuccessor,
      }),
      (error) => error?.code === "AGENTMO_CODEX_UAT_RELEASE_EVIDENCE_REJECTED",
    );
    assert.deepEqual(await readdir(root), beforeNonArchive);
  });

  it("rejects raw current UAT entries while retaining legacy loader rejection", async () => {
    const oldDetails = {
      baseline: {
        packageName: releaseFixture.identity.baseline.packageName,
        version: releaseFixture.identity.baseline.version,
        releaseDigest: releaseFixture.identity.baseline.releaseDigest,
        tarballDigest: releaseFixture.identity.baseline.tarballDigest,
      },
      successor: {
        packageName: releaseFixture.identity.successor.packageName,
        version: releaseFixture.identity.successor.version,
        releaseDigest: releaseFixture.identity.successor.releaseDigest,
        tarballDigest: releaseFixture.identity.successor.tarballDigest,
      },
    };
    for (const [name, schemaVersion, details] of [
      ["legacy-v1", "agentmo.codex-uat-attempt-journal.v1", oldDetails],
      ["pairless-v2", CODEX_UAT_ATTEMPT_JOURNAL_SCHEMA_VERSION, oldDetails],
    ]) {
      const root = await mkdtemp(path.join(tmpdir(), `agentmo-codex-uat-${name}-`));
      const journalPath = path.join(root, "attempt.journal");
      const entry = {
        schemaVersion,
        attemptId: "attempt-legacy",
        sequence: 0,
        kind: "attempt-started",
        predecessorDigest: null,
        evidenceDigests: [
          oldDetails.baseline.releaseDigest,
          oldDetails.baseline.tarballDigest,
          oldDetails.successor.releaseDigest,
          oldDetails.successor.tarballDigest,
        ],
        details,
      };
      const rawAppend = appendImmutableJournalEntry({
        journalPath,
        canonicalBytes: canonicalBytes(entry, "builder-codex-uat-attempt-entry"),
        maxValueBytes: 256 * 1024,
      });
      if (schemaVersion === CODEX_UAT_ATTEMPT_JOURNAL_SCHEMA_VERSION) {
        await assert.rejects(
          rawAppend,
          (error) => error?.code === "AGENTMO_IMMUTABLE_JOURNAL_AUTHORITY_REJECTED",
        );
        assert.deepEqual(await readdir(root), []);
      } else {
        await rawAppend;
        await assert.rejects(
          loadCodexUatAttemptJournal(journalPath),
          (error) => error?.code === "AGENTMO_CODEX_UAT_JOURNAL_CONFLICT_REJECTED",
        );
      }
    }
  });

  it("enforces the complete activation-first, session-start-first transition matrix", async () => {
    const { journalPath, view } = await throughScenarios();
    assert.deepEqual(CODEX_UAT_SCENARIO_IDS, [
      "session-start",
      "skill-discovery",
      "user-prompt-non-trigger",
      "manual-pause",
      "pre-compact",
      "post-compact",
      "restart-resume",
      "duplicate-replay",
      "second-compaction",
      "upgrade-visibility",
      "deactivation-tombstone-visibility",
    ]);
    assert.equal(view.entries.length, 15);
    assert.equal(view.state.phase, "scenarios-complete");
    assert.equal(view.state.nextAction, "publish-candidate");
    assert.equal(view.state.nextScenario, null);
    assert.equal(view.state.scenarioCount, 11);
    assert.match(view.state.orderedEvidenceDigest, /^sha256:[a-f0-9]{64}$/u);

    const reloaded = await loadCodexUatAttemptJournal(journalPath);
    assert.equal(reloaded.head.digest, view.head.digest);
    assert.deepEqual(reloaded.state, view.state);
    assert.deepEqual(reloaded.entries.map((entry) => entry.sequence), [...Array(15).keys()]);
    assert.equal(reloaded.entries[2].kind, "activation-applied");
    assert.equal(reloaded.entries[3].kind, "trust-auth-observed");
    assert.equal(reloaded.entries[4].details.scenario, "session-start");
  });

  it("requires activation before fresh-process trust/auth and exact scenario order with zero append", async () => {
    const attempt = await newAttempt();
    const { root, journalPath, view: started } = attempt;
    const processEvidence = await writeEvidence(path.join(root, "early-process"), Buffer.from("process\n"));
    const trustEvidence = await writeEvidence(path.join(root, "early-trust"), Buffer.from("trust\n"));
    const authEvidence = await writeEvidence(path.join(root, "early-auth"), Buffer.from("auth\n"));
    const before = await snapshotJournal(root);
    await assert.rejects(
      recordCodexUatTrustAuthObservation({
        journalPath,
        expectedHeadAdmission: started.head,
        freshProcessEvidencePath: processEvidence.filePath,
        expectedFreshProcessDigest: processEvidence.digest,
        trustObservationPath: trustEvidence.filePath,
        expectedTrustObservationDigest: trustEvidence.digest,
        authObservationPath: authEvidence.filePath,
        expectedAuthObservationDigest: authEvidence.digest,
      }),
      (error) => error?.code === "AGENTMO_CODEX_UAT_TRANSITION_REJECTED",
    );
    assert.deepEqual(await snapshotJournal(root), before);

    const trusted = await advanceToTrustAuth(attempt);
    const armed = await armCodexUatScenario({
      journalPath,
      expectedHeadAdmission: trusted.view.head,
      checkpointPath: trusted.checkpointPath,
      checkpointAdmission: trusted.checkpointAdmission,
    });
    const wrong = await publishCodexUatObservationLeaf({
      outDirectory: path.join(root, "wrong-observations"),
      attemptId: trusted.view.state.attemptId,
      scenario: "skill-discovery",
      correlation: armed.correlation,
      source: "operator-observation",
      eventDigest: digest("wrong-event"),
      runnerDigest: digest("wrong-runner"),
      releaseDigest: trusted.view.state.baseline.releaseDigest,
      installReceiptDigest: trusted.receipt.digest,
    });
    const activatedBytes = await snapshotJournal(root);
    await assert.rejects(
      recordCodexUatScenarioObservation({
        journalPath,
        expectedHeadAdmission: trusted.view.head,
        checkpointAdmission: armed.checkpointAdmission,
        observationAdmission: wrong,
        evidence: scenarioEvidence("skill-discovery", 1),
      }),
      (error) => error?.code === "AGENTMO_CODEX_UAT_OBSERVATION_REJECTED",
    );
    assert.deepEqual(await snapshotJournal(root), activatedBytes);
  });

  it("rejects stale or caller-built head authority, unknown kinds and fields without append", async () => {
    const { root, journalPath, view } = await newAttempt();
    const before = await snapshotJournal(root);
    for (const request of [
      () => recordCodexUatSetupApplied({
        journalPath,
        expectedHeadAdmission: { ...view.head },
        installReceiptPath: path.join(root, "missing-receipt"),
        expectedInstallReceiptDigest: D.receipt,
        checkpointAdmission: {},
      }),
      () => recordCodexUatTrustAuthObservation({
        journalPath,
        expectedHeadAdmission: view.head,
        freshProcessEvidencePath: "x",
        expectedFreshProcessDigest: D.process,
        trustObservationPath: "x",
        expectedTrustObservationDigest: D.trust,
        authObservationPath: "x",
        expectedAuthObservationDigest: D.auth,
        extraAuthority: D.host,
      }),
    ]) {
      await assert.rejects(
        request(),
        (error) => error?.code?.startsWith("AGENTMO_CODEX_UAT_") === true,
      );
      assert.deepEqual(await snapshotJournal(root), before);
    }
  });

  it("rejects pre-v4 activated receipts and incomplete or stale activation bindings", async () => {
    for (const variant of [
      "receipt-v3",
      "binding-v2",
      "missing-final-projection",
      "mismatched-final-projection",
      "forged-verified-evidence",
    ]) {
      const attempt = await newAttempt(`agentmo-codex-uat-${variant}-`);
      const value = activatedReceiptValue(attempt.view.state.baseline);
      if (variant === "receipt-v3") value.schemaVersion = "agentmo.builder-install-receipt.v3";
      if (variant === "binding-v2") {
        value.hostActivation.schemaVersion = "agentmo.builder-codex-activation-binding.v2";
      }
      if (variant === "missing-final-projection") {
        delete value.hostActivation.finalProjectionBinding;
      }
      if (variant === "mismatched-final-projection") {
        value.hostActivation.finalProjectionBinding.contentDigest = digest("foreign-marketplace");
      }
      if (variant === "forged-verified-evidence") {
        value.evidence.codexActivationVerified = true;
      }
      const receipt = await writeEvidence(
        path.join(attempt.root, `${variant}-receipt.json`),
        value,
        "builder-install-receipt",
      );
      const checkpointPath = path.join(attempt.root, `${variant}-checkpoint.json`);
      const checkpointAdmission = await writeBuilderCheckpoint(
        checkpointPath,
        checkpointValue(receipt.digest),
      );
      const before = await snapshotJournal(attempt.root);
      await assert.rejects(
        recordCodexUatSetupApplied({
          journalPath: attempt.journalPath,
          expectedHeadAdmission: attempt.view.head,
          installReceiptPath: receipt.filePath,
          expectedInstallReceiptDigest: receipt.digest,
          checkpointAdmission,
        }),
        (error) => error?.code === "AGENTMO_CODEX_UAT_SETUP_EVIDENCE_REJECTED",
        variant,
      );
      assert.deepEqual(await snapshotJournal(attempt.root), before, variant);
    }
  });

  it("derives resume without appending or changing any bytes", async () => {
    const { root, journalPath, view: activated } = await advanceToActivation(await newAttempt());
    const before = await snapshotJournal(root);
    const resumed = await resumeCodexUatAttempt(journalPath, {
      expectedHeadDigest: activated.head.digest,
    });
    assert.deepEqual(resumed, {
      schemaVersion: "agentmo.codex-uat-resume.v1",
      attemptId: "attempt-001",
      currentHeadDigest: activated.head.digest,
      phase: "activation-applied",
      nextAction: "start-fresh-codex",
      nextScenario: null,
      terminal: false,
      recoveryRequired: false,
    });
    assert.deepEqual(await snapshotJournal(root), before);
  });

  it("rejects a candidate-ready head while its terminal append requires recovery, then admits the exact retry", async () => {
    const complete = await throughScenarios();
    const candidate = await publishCodexUatCandidate({
      journalPath: complete.journalPath,
      expectedHeadAdmission: complete.view.head,
      candidateDirectory: path.join(complete.root, "candidates"),
    });
    const ready = await appendCodexUatCandidateReady({
      journalPath: complete.journalPath,
      expectedHeadAdmission: complete.view.head,
      candidatePath: candidate.filePath,
      expectedCandidateDigest: candidate.digest,
    });
    const evidence = await writeEvidence(
      path.join(complete.root, "candidate-ready-recovery-evidence.json"),
      Buffer.from("candidate-ready terminal recovery evidence\n"),
    );
    const termination = {
      journalPath: complete.journalPath,
      kind: "failure",
      code: "TERMINAL_APPEND_INTERRUPTED",
      evidencePath: evidence.filePath,
      expectedEvidenceDigest: evidence.digest,
    };
    await stopTerminationAtPrepared(termination, complete.root, ready.entries.length);

    const interrupted = await loadCodexUatAttemptJournal(complete.journalPath);
    assert.equal(interrupted.state.phase, "candidate-ready");
    assert.equal(interrupted.state.terminal, false);
    assert.equal(interrupted.recoveryRequired, true);
    const resumed = await resumeCodexUatAttempt(complete.journalPath, {
      expectedHeadDigest: interrupted.head.digest,
    });
    assert.equal(resumed.phase, "candidate-ready");
    assert.equal(resumed.recoveryRequired, true);

    const decisionRequest = {
      packageRoot: releaseFixture.successorPackage,
      successorTarballPath: releaseFixture.successorTarball,
      journalPath: complete.journalPath,
      candidatePath: candidate.filePath,
      expectedHeadDigest: interrupted.head.digest,
      expectedCandidateDigest: candidate.digest,
      expectedSuccessorVersion: releaseFixture.successorVersion,
      expectedReleaseDigest: releaseFixture.identity.successor.releaseDigest,
      expectedTarballDigest: releaseFixture.identity.successor.tarballDigest,
      decision: null,
    };
    const beforeVerification = await snapshotJournal(complete.root);
    await assert.rejects(
      verifyCodexUatCandidateDecision(decisionRequest),
      (error) => error?.code === "AGENTMO_CODEX_UAT_CANDIDATE_REJECTED",
    );
    assert.deepEqual(await snapshotJournal(complete.root), beforeVerification);

    const recovered = await terminateCodexUatAttempt({
      ...termination,
      expectedHeadAdmission: interrupted.head,
    });
    assert.equal(recovered.state.phase, "failed");
    assert.equal(recovered.state.terminal, true);
    assert.equal(recovered.recoveryRequired, false);
    const final = await loadCodexUatAttemptJournal(complete.journalPath);
    assert.equal(final.recoveryRequired, false);
    assert.equal(final.entries.length, ready.entries.length + 1);
  });

  it("resumes the exact committed UAT head after a real cleanup interruption and rejects stale retry", async () => {
    const { root, journalPath, view: started } = await newAttempt("agentmo-codex-uat-cleanup-recovery-");
    const evidence = await writeEvidence(
      path.join(root, "cleanup-failure-evidence.json"),
      Buffer.from("bounded cleanup failure evidence\n"),
    );
    const child = spawn(
      process.execPath,
      [TERMINATE_CHILD, JSON.stringify({
        journalPath,
        kind: "failure",
        code: "POST_COMMIT_CLEANUP_FAILED",
        evidencePath: evidence.filePath,
        expectedEvidenceDigest: evidence.digest,
      })],
      { stdio: ["ignore", "ignore", "ignore", "ipc"] },
    );
    const closed = new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (exitCode, signal) => resolve({ exitCode, signal }));
    });
    const outcomePattern = /^\.attempt\.json\.agentmo-journal\.outcome\.000000000001-[a-f0-9]{64}\.json$/u;
    const deadline = Date.now() + 15_000;
    let observedCommit = false;
    while (Date.now() < deadline && child.exitCode === null) {
      if ((await readdir(root)).some((name) => outcomePattern.test(name))) {
        observedCommit = true;
        child.kill("SIGSTOP");
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    assert.equal(observedCommit, true, "termination child completed before its commit was observed");
    child.kill("SIGKILL");
    assert.deepEqual(await closed, { exitCode: null, signal: "SIGKILL" });

    const restarted = await loadCodexUatAttemptJournal(journalPath);
    assert.equal(restarted.entries.length, 2);
    assert.equal(restarted.state.phase, "failed");
    assert.equal(restarted.entries.at(-1).details.code, "POST_COMMIT_CLEANUP_FAILED");

    const beforeRetry = await snapshotJournal(root);
    await assert.rejects(
      terminateCodexUatAttempt({
        journalPath,
        expectedHeadAdmission: started.head,
        kind: "failure",
        code: "POST_COMMIT_CLEANUP_FAILED",
        evidencePath: evidence.filePath,
        expectedEvidenceDigest: evidence.digest,
      }),
      (error) => error?.code === "AGENTMO_CODEX_UAT_HEAD_MISMATCH",
    );
    assert.deepEqual(await snapshotJournal(root), beforeRetry);
  });

  it("keeps caller-reported decisions nonterminal without external human authority", async () => {
    const { root, journalPath, view } = await throughScenarios();
    const candidateDirectory = path.join(root, "candidates");
    const before = await snapshotJournal(root);
    const candidate = await publishCodexUatCandidate({
      journalPath,
      expectedHeadAdmission: view.head,
      candidateDirectory,
    });
    const afterLeafView = await loadCodexUatAttemptJournal(journalPath);
    assert.equal(afterLeafView.head.digest, view.head.digest, "leaf publication is non-authoritative");
    assert.deepEqual(await snapshotJournal(root), before, "candidate leaf cannot mutate journal bytes");
    assert.equal((await stat(candidate.filePath)).isFile(), true);
    assert.equal(candidate.value.schemaVersion, CODEX_UAT_CANDIDATE_SCHEMA_VERSION);
    assert.equal(candidate.value.status, "candidate");
    assert.equal(candidate.value.scenarioCount, 11);
    assert.equal(candidate.value.humanAdmissionRequired, true);
    assert.equal(candidate.value.hostOriginCryptographicallyVerified, false);
    assert.equal(candidate.value.realCodexSessionVerified, false);
    assert.equal(candidate.value.agentPackageQualityCertified, false);
    assert.equal(candidate.value.domainQualityCertified, false);
    assert.equal(candidate.value.productionReady, false);
    assert.equal(candidate.value.widerCompatibilityCertified, false);
    for (const malformed of [
      { ...candidate.value, schemaVersion: "agentmo.codex-uat.v1" },
      (() => {
        const value = { ...candidate.value };
        delete value.releaseSet;
        return value;
      })(),
      { ...candidate.value, successorRole: "baseline" },
    ]) {
      assert.throws(
        () => codexUatModule.validateCodexUatCandidate(malformed),
        (error) => error?.code === "AGENTMO_CODEX_UAT_CANDIDATE_REJECTED",
      );
    }
    for (const forbidden of ["journalHeadDigest", "headDigest", "predecessorDigest", "previousEntryDigest"]) {
      assert.equal(Object.hasOwn(candidate.value, forbidden), false);
      assert.equal(JSON.stringify(candidate.value).includes(forbidden), false);
    }

    const ready = await appendCodexUatCandidateReady({
      journalPath,
      expectedHeadAdmission: view.head,
      candidatePath: candidate.filePath,
      expectedCandidateDigest: candidate.digest,
    });
    assert.equal(ready.state.phase, "candidate-ready");
    assert.equal(ready.state.nextAction, "external-decision-authority");
    const beforePreview = await snapshotJournal(root);
    const decisionRequest = {
      packageRoot: releaseFixture.successorPackage,
      successorTarballPath: releaseFixture.successorTarball,
      journalPath,
      candidatePath: candidate.filePath,
      expectedHeadDigest: ready.head.digest,
      expectedCandidateDigest: candidate.digest,
      expectedSuccessorVersion: releaseFixture.successorVersion,
      expectedReleaseDigest: releaseFixture.identity.successor.releaseDigest,
      expectedTarballDigest: releaseFixture.identity.successor.tarballDigest,
    };
    const preview = await verifyCodexUatCandidateDecision({
      ...decisionRequest,
      decision: null,
    });
    assert.deepEqual({
      status: preview.status,
      headDigest: preview.headDigest,
      candidateDigest: preview.candidateDigest,
      packageName: preview.packageName,
      version: preview.version,
      releaseDigest: preview.releaseDigest,
      tarballDigest: preview.tarballDigest,
      verifierDigest: preview.verifierDigest,
    }, {
      status: "eligible",
      headDigest: ready.head.digest,
      candidateDigest: candidate.digest,
      packageName: "agentmo",
      version: releaseFixture.successorVersion,
      releaseDigest: releaseFixture.identity.successor.releaseDigest,
      tarballDigest: releaseFixture.identity.successor.tarballDigest,
      verifierDigest: releaseFixture.identity.successor.verifierDigest,
    });
    assert.deepEqual(await snapshotJournal(root), beforePreview, "inspection is read-only");
    await assert.rejects(
      verifyCodexUatCandidateDecision({
        ...decisionRequest,
        decision: "approve",
        verifierDigest: releaseFixture.identity.successor.verifierDigest,
      }),
      (error) => error?.code === "AGENTMO_CODEX_UAT_REQUEST_REJECTED",
    );
    assert.deepEqual(
      await snapshotJournal(root),
      beforePreview,
      "caller-selected verifier identity cannot mutate the journal",
    );
    const reportedApproval = await verifyCodexUatCandidateDecision({
      ...decisionRequest,
      decision: "approve",
    });
    assert.equal(reportedApproval.reportedDecision.status, "caller-reported-approval");
    assert.equal(reportedApproval.reportedDecision.terminal, false);
    assert.equal(reportedApproval.reportedDecision.journalMutated, false);
    assert.equal(reportedApproval.reportedDecision.humanAuthorityVerified, false);
    assert.equal(reportedApproval.reportedDecision.candidateDigest, candidate.digest);
    assert.deepEqual(await snapshotJournal(root), beforePreview);

    const reportedRejection = await verifyCodexUatCandidateDecision({
      ...decisionRequest,
      decision: "reject",
    });
    assert.equal(reportedRejection.reportedDecision.status, "caller-reported-rejection");
    assert.equal(reportedRejection.reportedDecision.terminal, false);
    assert.equal(reportedRejection.reportedDecision.journalMutated, false);
    assert.equal(reportedRejection.reportedDecision.humanAuthorityVerified, false);
    assert.deepEqual(await snapshotJournal(root), beforePreview);
  });

  it("rejects a different release pair even when its successor tuple is identical", async () => {
    const alternate = await buildReleaseFixture({
      baselineVersion: "0.1.0-uat.18.3",
      successorVersion: releaseFixture.successorVersion,
    });
    assert.deepEqual({
      packageName: alternate.identity.successor.packageName,
      version: alternate.identity.successor.version,
      releaseDigest: alternate.identity.successor.releaseDigest,
      tarballDigest: alternate.identity.successor.tarballDigest,
      manifestDigest: alternate.identity.successor.manifestDigest,
      verifierDigest: alternate.identity.successor.verifierDigest,
      continuationDigest: alternate.identity.successor.continuationDigest,
    }, {
      packageName: releaseFixture.identity.successor.packageName,
      version: releaseFixture.identity.successor.version,
      releaseDigest: releaseFixture.identity.successor.releaseDigest,
      tarballDigest: releaseFixture.identity.successor.tarballDigest,
      manifestDigest: releaseFixture.identity.successor.manifestDigest,
      verifierDigest: releaseFixture.identity.successor.verifierDigest,
      continuationDigest: releaseFixture.identity.successor.continuationDigest,
    });
    assert.notEqual(alternate.identity.operationId, releaseFixture.identity.operationId);

    const { root, journalPath, view } = await throughScenarios();
    const candidate = await publishCodexUatCandidate({
      journalPath,
      expectedHeadAdmission: view.head,
      candidateDirectory: path.join(root, "candidates"),
    });
    const ready = await appendCodexUatCandidateReady({
      journalPath,
      expectedHeadAdmission: view.head,
      candidatePath: candidate.filePath,
      expectedCandidateDigest: candidate.digest,
    });
    const before = await snapshotJournal(root);
    await assert.rejects(
      verifyCodexUatCandidateDecision({
        packageRoot: alternate.successorPackage,
        successorTarballPath: alternate.successorTarball,
        journalPath,
        candidatePath: candidate.filePath,
        expectedHeadDigest: ready.head.digest,
        expectedCandidateDigest: candidate.digest,
        expectedSuccessorVersion: releaseFixture.successorVersion,
        expectedReleaseDigest: releaseFixture.identity.successor.releaseDigest,
        expectedTarballDigest: releaseFixture.identity.successor.tarballDigest,
        decision: null,
      }),
      (error) => error?.code === "AGENTMO_CODEX_UAT_CANDIDATE_REJECTED",
    );
    assert.deepEqual(await snapshotJournal(root), before);
  });

  it("rejects a full synthetic real-pair history from a packed file-URL generic import", async () => {
    const candidateDigest = digest("forged-candidate");
    const { root, journalPath, view: started } = await newAttempt(
      "agentmo-codex-uat-packed-raw-history-",
      "attempt.journal",
    );
    const rawEntries = syntheticRawUatHistory(started, candidateDigest);
    assert.equal(rawEntries.length, 4 + CODEX_UAT_SCENARIO_IDS.length);

    const attempted = await attemptPackedRawUatHistory(journalPath, rawEntries);
    assert.deepEqual(attempted, {
      planned: rawEntries.length,
      attempted: rawEntries.length,
      appended: 0,
      rejectedCodes: Array(rawEntries.length).fill(
        "AGENTMO_IMMUTABLE_JOURNAL_AUTHORITY_REJECTED",
      ),
    });

    const after = await loadCodexUatAttemptJournal(journalPath);
    assert.equal(after.entries.length, 1);
    assert.equal(after.state.phase, "started");
    assert.equal(after.entries.some((entry) => entry.kind === "candidate-ready"), false);

    await assert.rejects(
      execFileAsync(process.execPath, [
        path.join(releaseFixture.successorPackage, "scripts", "verify-codex-uat-candidate.js"),
        "preview",
        "--attempt-dir", root,
        "--successor-tarball", releaseFixture.successorTarball,
        "--expected-head-sha256", after.head.digest,
        "--expected-candidate-sha256", candidateDigest,
        "--expected-successor-version", releaseFixture.successorVersion,
        "--expected-release-sha256", releaseFixture.identity.successor.releaseDigest,
        "--expected-tarball-sha256", releaseFixture.identity.successor.tarballDigest,
      ], { cwd: REPO_ROOT, encoding: "utf8" }),
      (error) => {
        assert.equal(error?.code, 1);
        assert.deepEqual(JSON.parse(error.stderr), {
          status: "rejected",
          code: "AGENTMO_CODEX_UAT_VERIFIER_EVIDENCE_REJECTED",
        });
        return true;
      },
    );
  });

  it("retains partial stages, recovers an exact committed final, and preserves a competitor", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-codex-uat-leaf-fault-"));
    const requestFor = (outDirectory, suffix) => ({
      outDirectory,
      attemptId: "attempt-leaf-001",
      scenario: "session-start",
      correlation: `opaque:${"1".repeat(64)}`,
      source: "installed-hook-untrusted",
      eventDigest: digest(`leaf-event-${suffix}`),
      runnerDigest: digest("leaf-runner"),
      releaseDigest: digest("leaf-release"),
      installReceiptDigest: digest("leaf-receipt"),
    });

    const partialDirectory = path.join(root, "partial-observations");
    const partialRequest = requestFor(partialDirectory, "partial");
    await mkdir(partialDirectory, { mode: 0o700 });
    const partial = await stopLeafChildAt(
      partialRequest,
      partialDirectory,
      (name) => /^\.agentmo-uat-leaf-[a-f0-9]{64}-[a-f0-9]{48}\.stage$/u.test(name),
    );
    partial.child.kill("SIGKILL");
    const partialKilled = await partial.terminalPromise;
    assert.equal(partialKilled.signal, "SIGKILL");
    const partialNames = await readdir(partialDirectory);
    assert.equal(partialNames.some((name) => /^[a-f0-9]{64}\.json$/u.test(name)), false);
    assert.equal(partialNames.some((name) => name.endsWith(".stage")), true);
    const partialRecovered = await publishCodexUatObservationLeaf(partialRequest);
    assert.equal(partialRecovered.created, true);

    const recoveryDirectory = path.join(root, "recovery-observations");
    const recoveryRequest = requestFor(recoveryDirectory, "recovery");
    await mkdir(recoveryDirectory, { mode: 0o700 });
    const recovery = await stopLeafChildAt(
      recoveryRequest,
      recoveryDirectory,
      (name) => /^[a-f0-9]{64}\.json$/u.test(name),
    );
    recovery.child.kill("SIGKILL");
    const recoveryKilled = await recovery.terminalPromise;
    assert.equal(recoveryKilled.signal, "SIGKILL");
    const recoveryNames = await readdir(recoveryDirectory);
    const recoveryFinal = recoveryNames.find((name) => /^[a-f0-9]{64}\.json$/u.test(name));
    const recoveryStage = recoveryNames.find((name) => name.endsWith(".stage"));
    assert.ok(recoveryFinal);
    assert.ok(recoveryStage);
    const recoveryPath = path.join(recoveryDirectory, recoveryFinal);
    const recoveryBytes = await readFile(recoveryPath);
    const recovered = await publishCodexUatObservationLeaf(recoveryRequest);
    assert.equal(recovered.created, false);
    assert.deepEqual(await readFile(recoveryPath), recoveryBytes);
    assert.deepEqual((await readdir(recoveryDirectory)).sort(), recoveryNames.sort());

    const competitorDirectory = path.join(root, "competitor-observations");
    const competitorRequest = requestFor(competitorDirectory, "competitor");
    const competitor = Buffer.from("foreign complete bytes\n", "utf8");
    await mkdir(competitorDirectory, { mode: 0o700 });
    const competitorStopped = await stopLeafChildAt(
      competitorRequest,
      competitorDirectory,
      (name) => /^\.agentmo-uat-leaf-[a-f0-9]{64}-[a-f0-9]{48}\.stage$/u.test(name),
    );
    const stageName = (await readdir(competitorDirectory)).find((name) => name.endsWith(".stage"));
    assert.ok(stageName);
    const finalPath = path.join(
      competitorDirectory,
      `${stageName.split("-")[3]}.json`,
    );
    await writeFile(finalPath, competitor, { flag: "wx", mode: 0o600 });
    competitorStopped.child.kill("SIGCONT");
    const competitorResult = await competitorStopped.terminalPromise;
    assert.equal(competitorResult.type, "error");
    assert.equal(competitorResult.error?.code, "AGENTMO_CODEX_UAT_LEAF_REJECTED");
    assert.deepEqual(await readFile(finalPath), competitor);
    assert.equal((await readdir(competitorDirectory)).includes(stageName), true);

    await assert.rejects(
      publishCodexUatObservationLeaf({
        ...requestFor(path.join(root, "unknown-control"), "unknown"),
        unexpectedObservationOption: true,
      }),
      (error) => error?.code === "AGENTMO_CODEX_UAT_OBSERVATION_REJECTED",
    );
  });

  it("fails closed for ancestor symlinks and hostile retained bootstrap or stage swaps", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-codex-uat-leaf-boundary-"));
    const requestFor = (outDirectory, suffix) => ({
      outDirectory,
      attemptId: `attempt-leaf-boundary-${suffix}`,
      scenario: "session-start",
      correlation: `opaque:${suffix.repeat(64)}`,
      source: "installed-hook-untrusted",
      eventDigest: digest(`leaf-boundary-event-${suffix}`),
      runnerDigest: digest("leaf-boundary-runner"),
      releaseDigest: digest("leaf-boundary-release"),
      installReceiptDigest: digest("leaf-boundary-receipt"),
    });

    const safeParent = path.join(root, "safe-parent");
    const redirectedParent = path.join(safeParent, "redirected");
    const ancestorExternal = await mkdtemp(path.join(tmpdir(), "agentmo-codex-uat-leaf-external-"));
    await mkdir(safeParent, { mode: 0o700 });
    await symlink(ancestorExternal, redirectedParent);
    await assert.rejects(
      publishCodexUatObservationLeaf(requestFor(
        path.join(redirectedParent, "observations"),
        "6",
      )),
      (error) => error?.code === "AGENTMO_CODEX_UAT_LEAF_REJECTED",
    );
    assert.deepEqual(await readdir(ancestorExternal), []);

    const bootstrapExternal = await mkdtemp(path.join(tmpdir(), "agentmo-codex-uat-leaf-bootstrap-external-"));
    const bootstrapAncestor = path.join(root, ".agentmo");
    const bootstrapRetained = path.join(root, ".agentmo-retained");
    const bootstrapSegments = Array.from(
      { length: 8 },
      (_, index) => `bootstrap-${String(index).padStart(2, "0")}`,
    );
    const bootstrapDirectory = path.join(
      bootstrapAncestor,
      ...bootstrapSegments,
      "observations",
    );
    const bootstrapExternalDirectory = path.join(
      bootstrapExternal,
      ...bootstrapSegments,
      "observations",
    );
    const bootstrapStopped = await stopLeafChildAtCreatedDirectory(
      requestFor(bootstrapDirectory, "7"),
      root,
      ".agentmo",
    );
    let bootstrapResult;
    try {
      const observed = await lstat(bootstrapAncestor, { bigint: true });
      assert.equal(observed.isDirectory(), true);
      assert.equal(observed.isSymbolicLink(), false);
      await rename(bootstrapAncestor, bootstrapRetained);
      await symlink(bootstrapExternal, bootstrapAncestor);
      await mkdir(bootstrapExternalDirectory, { recursive: true, mode: 0o700 });
      assert.deepEqual(await readdir(bootstrapExternalDirectory), []);
    } finally {
      if (bootstrapStopped.child.exitCode === null) bootstrapStopped.child.kill("SIGCONT");
      bootstrapResult = await bootstrapStopped.terminalPromise;
    }
    assert.equal(bootstrapResult.type, "error");
    assert.equal(bootstrapResult.error?.code, "AGENTMO_CODEX_UAT_LEAF_REJECTED");
    assert.deepEqual(await readdir(bootstrapExternalDirectory), []);

    const stageDirectory = path.join(root, "stage-observations");
    const stageRetained = path.join(root, "stage-observations-retained");
    const stageExternal = await mkdtemp(path.join(tmpdir(), "agentmo-codex-uat-leaf-stage-external-"));
    await mkdir(stageDirectory, { mode: 0o700 });
    const stageStopped = await stopLeafChildAt(
      requestFor(stageDirectory, "8"),
      stageDirectory,
      (name) => /^\.agentmo-uat-leaf-[a-f0-9]{64}-[a-f0-9]{48}\.stage$/u.test(name),
    );
    const stageName = (await readdir(stageDirectory)).find((name) => name.endsWith(".stage"));
    assert.ok(stageName);
    let stageResult;
    try {
      await rename(stageDirectory, stageRetained);
      await symlink(stageExternal, stageDirectory);
    } finally {
      if (stageStopped.child.exitCode === null) stageStopped.child.kill("SIGCONT");
      stageResult = await stageStopped.terminalPromise;
    }
    assert.equal(stageResult.type, "error");
    assert.equal(stageResult.error?.code, "AGENTMO_CODEX_UAT_LEAF_REJECTED");
    assert.deepEqual(await readdir(stageExternal), []);
    assert.equal((await readdir(stageRetained)).includes(stageName), true);
  });

  it("exact-replays a committed observation leaf without mutating its retained evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-codex-uat-leaf-replay-"));
    const outDirectory = path.join(root, "observations");
    const request = {
      outDirectory,
      attemptId: "attempt-leaf-replay-001",
      scenario: "session-start",
      correlation: `opaque:${"3".repeat(64)}`,
      source: "installed-hook-untrusted",
      eventDigest: digest("leaf-replay-event"),
      runnerDigest: digest("leaf-replay-runner"),
      releaseDigest: digest("leaf-replay-release"),
      installReceiptDigest: digest("leaf-replay-receipt"),
    };

    const first = await publishCodexUatObservationLeaf(request);
    const before = await snapshotJournal(root);
    const replay = await publishCodexUatObservationLeaf(request);
    assert.equal(first.created, true);
    assert.equal(replay.created, false);
    assert.equal(replay.digest, first.digest);
    assert.equal(replay.filePath, first.filePath);
    assert.deepEqual(replay.value, first.value);
    assert.deepEqual(await snapshotJournal(root), before);
  });

  it("rejects an extra hardlink or same-byte final swap without changing either occupant", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-codex-uat-leaf-binding-"));
    const requestFor = (outDirectory, suffix) => ({
      outDirectory,
      attemptId: `attempt-leaf-binding-${suffix}`,
      scenario: "session-start",
      correlation: `opaque:${suffix.repeat(64)}`,
      source: "installed-hook-untrusted",
      eventDigest: digest(`leaf-binding-event-${suffix}`),
      runnerDigest: digest("leaf-binding-runner"),
      releaseDigest: digest("leaf-binding-release"),
      installReceiptDigest: digest("leaf-binding-receipt"),
    });

    const linkedDirectory = path.join(root, "linked-observations");
    const linkedRequest = requestFor(linkedDirectory, "4");
    const linked = await publishCodexUatObservationLeaf(linkedRequest);
    const foreignLink = path.join(root, "foreign-link.json");
    await link(linked.filePath, foreignLink);
    const linkedBytes = await readFile(linked.filePath);
    await assert.rejects(
      publishCodexUatObservationLeaf(linkedRequest),
      (error) => error?.code === "AGENTMO_CODEX_UAT_LEAF_REJECTED",
    );
    assert.deepEqual(await readFile(linked.filePath), linkedBytes);
    assert.deepEqual(await readFile(foreignLink), linkedBytes);
    assert.equal((await stat(linked.filePath, { bigint: true })).nlink, 3n);

    const swappedDirectory = path.join(root, "swapped-observations");
    const swappedRequest = requestFor(swappedDirectory, "5");
    const original = await publishCodexUatObservationLeaf(swappedRequest);
    const originalStats = await stat(original.filePath, { bigint: true });
    const originalBytes = await readFile(original.filePath);
    const replacement = path.join(root, "same-bytes-replacement.json");
    await writeFile(replacement, originalBytes, { flag: "wx", mode: 0o600 });
    await rename(replacement, original.filePath);
    const replacedStats = await stat(original.filePath, { bigint: true });
    assert.notEqual(replacedStats.ino, originalStats.ino);
    await assert.rejects(
      publishCodexUatObservationLeaf(swappedRequest),
      (error) => error?.code === "AGENTMO_CODEX_UAT_LEAF_REJECTED",
    );
    assert.deepEqual(await readFile(original.filePath), originalBytes);
    const retainedName = (await readdir(swappedDirectory)).find((name) => name.endsWith(".stage"));
    assert.ok(retainedName);
    assert.deepEqual(
      await readFile(path.join(swappedDirectory, retainedName)),
      originalBytes,
    );
  });

  it("rejects replaced retained parents and retries an operation-owned candidate stage cleanly", async () => {
    const complete = await throughScenarios();
    const candidateDirectory = path.join(complete.root, "candidates");
    await mkdir(candidateDirectory, { mode: 0o700 });
    const authority = await retainCodexUatLeafDirectoryAuthority(candidateDirectory);
    const request = {
      journalPath: complete.journalPath,
      expectedHeadAdmission: complete.view.head,
      candidateDirectory,
      parentAuthority: authority,
    };
    try {
      await assert.rejects(
        publishCodexUatCandidate({
          ...request,
          unexpectedCandidateOption: true,
        }),
        (error) => error?.code === "AGENTMO_CODEX_UAT_REQUEST_REJECTED",
      );
      assert.deepEqual(await readdir(candidateDirectory), []);
      const candidate = await publishCodexUatCandidate(request);
      assert.equal((await readdir(candidateDirectory)).length, 2);
      const ready = await appendCodexUatCandidateReady({
        journalPath: complete.journalPath,
        expectedHeadAdmission: complete.view.head,
        candidatePath: candidate.filePath,
        expectedCandidateDigest: candidate.digest,
      });
      assert.equal(ready.entries.at(-1).kind, "candidate-ready");
    } finally {
      await releaseCodexUatLeafDirectoryAuthority(authority);
    }

    const staleDirectory = path.join(complete.root, "stale-observations");
    await mkdir(staleDirectory, { mode: 0o700 });
    const staleAuthority = await retainCodexUatLeafDirectoryAuthority(staleDirectory);
    const retainedDirectory = `${staleDirectory}.retained`;
    await rename(staleDirectory, retainedDirectory);
    await mkdir(staleDirectory, { mode: 0o700 });
    const competitorPath = path.join(staleDirectory, "competitor");
    const competitor = Buffer.from("preserve me\n", "utf8");
    await writeFile(competitorPath, competitor, { flag: "wx", mode: 0o600 });
    try {
      await assert.rejects(
        publishCodexUatObservationLeaf({
          outDirectory: staleDirectory,
          attemptId: "attempt-leaf-002",
          scenario: "session-start",
          correlation: `opaque:${"2".repeat(64)}`,
          source: "installed-hook-untrusted",
          eventDigest: digest("stale-event"),
          runnerDigest: digest("stale-runner"),
          releaseDigest: digest("stale-release"),
          installReceiptDigest: digest("stale-receipt"),
          parentAuthority: staleAuthority,
        }),
        (error) => error?.code === "AGENTMO_CODEX_UAT_LEAF_REJECTED",
      );
      assert.deepEqual(await readFile(competitorPath), competitor);
      assert.deepEqual(await readdir(retainedDirectory), []);
    } finally {
      await releaseCodexUatLeafDirectoryAuthority(staleAuthority);
    }
  });

  it("re-admits only the exact durable orphan candidate without publishing a replacement", async () => {
    const { root, journalPath, view } = await throughScenarios();
    const candidateDirectory = path.join(root, "candidates");
    const candidate = await publishCodexUatCandidate({
      journalPath,
      expectedHeadAdmission: view.head,
      candidateDirectory,
    });
    const before = await snapshotJournal(root);
    const recovered = await loadExistingCodexUatCandidate({
      journalPath,
      expectedHeadAdmission: view.head,
      candidateDirectory,
    });
    assert.equal(recovered.digest, candidate.digest);
    assert.equal(recovered.filePath, candidate.filePath);
    assert.equal(recovered.created, false);
    assert.deepEqual(await snapshotJournal(root), before);

    await writeFile(candidate.filePath, `${JSON.stringify({ ...candidate.value, scenarioCount: 10 })}\n`);
    await assert.rejects(
      loadExistingCodexUatCandidate({
        journalPath,
        expectedHeadAdmission: view.head,
        candidateDirectory,
      }),
      (error) => error?.code === "AGENTMO_CODEX_UAT_CANDIDATE_REJECTED",
    );
  });

  it("rejects early/mismatched candidate-ready and every candidate reverse edge", async () => {
    const { root, journalPath, view: started } = await newAttempt();
    await assert.rejects(
      publishCodexUatCandidate({
        journalPath,
        expectedHeadAdmission: started.head,
        candidateDirectory: path.join(root, "candidates"),
      }),
      (error) => error?.code === "AGENTMO_CODEX_UAT_CANDIDATE_PRECONDITION_REJECTED",
    );

    const complete = await throughScenarios();
    const candidateDirectory = path.join(complete.root, "candidates");
    const candidate = await publishCodexUatCandidate({
      journalPath: complete.journalPath,
      expectedHeadAdmission: complete.view.head,
      candidateDirectory,
    });
    const forgedPath = path.join(candidateDirectory, "forged.json");
    const forged = { ...candidate.value, journalHeadDigest: complete.view.head.digest };
    await writeFile(forgedPath, `${JSON.stringify(forged)}\n`, { flag: "wx", mode: 0o600 });
    const before = await snapshotJournal(complete.root);
    await assert.rejects(
      appendCodexUatCandidateReady({
        journalPath: complete.journalPath,
        expectedHeadAdmission: complete.view.head,
        candidatePath: forgedPath,
        expectedCandidateDigest: digestRawBytes(await readFile(forgedPath)),
      }),
      (error) => error?.code === "AGENTMO_CODEX_UAT_CANDIDATE_REJECTED",
    );
    assert.deepEqual(await snapshotJournal(complete.root), before);
  });

  it("makes failure and interruption mutually exclusive terminals from every nonterminal phase", async () => {
    for (const kind of ["failure", "interruption"]) {
      const { root, journalPath, view } = await newAttempt(`agentmo-codex-uat-${kind}-`);
      const evidence = await writeEvidence(
        path.join(root, `${kind}-evidence.json`),
        Buffer.from(`${kind}\n`),
      );
      const terminal = await terminateCodexUatAttempt({
        journalPath,
        expectedHeadAdmission: view.head,
        kind,
        code: kind === "failure" ? "TRUST_AUTH_FAILED" : "PROCESS_INTERRUPTED",
        evidencePath: evidence.filePath,
        expectedEvidenceDigest: evidence.digest,
      });
      assert.equal(terminal.state.phase, kind === "failure" ? "failed" : "interrupted");
      assert.equal(terminal.state.terminal, true);
      const before = await snapshotJournal(root);
      await assert.rejects(
        terminateCodexUatAttempt({
          journalPath,
          expectedHeadAdmission: terminal.head,
          kind,
          code: "LATE_OUTCOME",
          evidencePath: evidence.filePath,
          expectedEvidenceDigest: evidence.digest,
        }),
        (error) => error?.code === "AGENTMO_CODEX_UAT_TRANSITION_REJECTED",
      );
      assert.deepEqual(await snapshotJournal(root), before);
    }

    for (const kind of ["failure", "interruption"]) {
      const complete = await throughScenarios();
      const candidate = await publishCodexUatCandidate({
        journalPath: complete.journalPath,
        expectedHeadAdmission: complete.view.head,
        candidateDirectory: path.join(complete.root, "candidates"),
      });
      const ready = await appendCodexUatCandidateReady({
        journalPath: complete.journalPath,
        expectedHeadAdmission: complete.view.head,
        candidatePath: candidate.filePath,
        expectedCandidateDigest: candidate.digest,
      });
      const evidence = await writeEvidence(
        path.join(complete.root, `${kind}-candidate-ready-outcome.json`),
        Buffer.from(`${kind} after candidate-ready\n`),
      );
      const terminal = await terminateCodexUatAttempt({
        journalPath: complete.journalPath,
        expectedHeadAdmission: ready.head,
        kind,
        code: kind === "failure" ? "VERIFIER_FAILED" : "OPERATOR_INTERRUPTED",
        evidencePath: evidence.filePath,
        expectedEvidenceDigest: evidence.digest,
      });
      assert.equal(terminal.state.phase, kind === "failure" ? "failed" : "interrupted");
      assert.equal(terminal.state.terminal, true);
      const before = await snapshotJournal(complete.root);
      await assert.rejects(
        terminateCodexUatAttempt({
          journalPath: complete.journalPath,
          expectedHeadAdmission: terminal.head,
          kind: kind === "failure" ? "interruption" : "failure",
          code: "COMPETING_TERMINAL",
          evidencePath: evidence.filePath,
          expectedEvidenceDigest: evidence.digest,
        }),
        (error) => error?.code === "AGENTMO_CODEX_UAT_TRANSITION_REJECTED",
      );
      assert.deepEqual(await snapshotJournal(complete.root), before);
    }
  });

  it("fails closed on malformed published bytes and competing immutable successors", async () => {
    const malformedRoot = await mkdtemp(path.join(tmpdir(), "agentmo-codex-uat-malformed-"));
    const malformedPath = path.join(malformedRoot, "attempt.json");
    await writeFile(malformedPath, "{broken\n", { flag: "wx", mode: 0o600 });
    await assert.rejects(
      loadCodexUatAttemptJournal(malformedPath),
      (error) => error?.code === "AGENTMO_CODEX_UAT_JOURNAL_CONFLICT_REJECTED",
    );

    const attempt = await advanceToActivation(await newAttempt("agentmo-codex-uat-fork-"));
    const { root, journalPath, view } = attempt;
    const processEvidence = await writeEvidence(path.join(root, "race-process"), Buffer.from("process\n"));
    const trustEvidence = await writeEvidence(path.join(root, "race-trust"), Buffer.from("trust\n"));
    const authEvidence = await writeEvidence(path.join(root, "race-auth"), Buffer.from("auth\n"));
    const requests = [0, 1].map(() => recordCodexUatTrustAuthObservation({
      journalPath,
      expectedHeadAdmission: view.head,
      freshProcessEvidencePath: processEvidence.filePath,
      expectedFreshProcessDigest: processEvidence.digest,
      trustObservationPath: trustEvidence.filePath,
      expectedTrustObservationDigest: trustEvidence.digest,
      authObservationPath: authEvidence.filePath,
      expectedAuthObservationDigest: authEvidence.digest,
    }));
    const settled = await Promise.allSettled(requests);
    assert.equal(settled.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(settled.filter((item) => item.status === "rejected").length, 1);
    const loaded = await loadCodexUatAttemptJournal(journalPath);
    assert.equal(loaded.entries.length, 4);
    assert.equal((await readdir(root)).some((name) => name.endsWith(".lock")), false);
  });
});
