#!/usr/bin/env node
import { createHash } from "node:crypto";
import { open, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SCENARIOS = [
  "skill-discovery",
  "session-start",
  "user-prompt-non-trigger",
  "manual-pause",
  "pre-compact",
  "post-compact",
  "restart-resume",
  "duplicate-replay",
  "second-compaction",
  "upgrade-visibility",
  "uninstall-visibility",
];

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function bytes(value) {
  return Buffer.from(`${JSON.stringify(canonical(value))}\n`, "utf8");
}

function digest(value) {
  const input = Buffer.isBuffer(value) ? value : bytes(value);
  return `sha256:${createHash("sha256").update(input).digest("hex")}`;
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function parseArgs(argv) {
  const command = argv[0];
  const values = {};
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) fail("ARGUMENTS_INVALID");
    values[key.slice(2)] = value;
  }
  const expected = command === "preview"
    ? ["journal", "tarball", "expected-head", "expected-candidate"]
    : ["journal", "tarball", "expected-head", "expected-candidate", "decision"];
  if (!["preview", "decide"].includes(command)
    || Object.keys(values).sort().join("\0") !== expected.sort().join("\0")) fail("ARGUMENTS_INVALID");
  if (command === "decide" && !["approve", "reject"].includes(values.decision)) fail("DECISION_INVALID");
  return { command, values };
}

async function ownReleaseIdentity() {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const [packageBytes, releaseBytes, verifierBytes] = await Promise.all([
    readFile(path.join(packageRoot, "package.json")),
    readFile(path.join(packageRoot, "release.json")),
    readFile(fileURLToPath(import.meta.url)),
  ]);
  const packageJson = JSON.parse(packageBytes);
  const release = JSON.parse(releaseBytes);
  const verifierDigest = digest(verifierBytes);
  if (release.name !== packageJson.name
    || release.version !== packageJson.version
    || release.verifierDigest !== verifierDigest
    || release.releaseDigest !== digest({ name: release.name, version: release.version, verifierDigest })) {
    fail("VERIFIER_SELF_IDENTITY_INVALID");
  }
  return release;
}

async function loadJournal(root) {
  const entriesRoot = path.join(root, "entries");
  const names = (await readdir(entriesRoot)).filter((name) => /^\d{4}-[0-9a-f]{64}\.json$/.test(name));
  const records = [];
  for (const name of names) {
    const content = await readFile(path.join(entriesRoot, name));
    let entry;
    try { entry = JSON.parse(content); } catch { fail("JOURNAL_INVALID"); }
    const entryDigest = digest(content);
    if (name !== `${String(entry.sequence).padStart(4, "0")}-${entryDigest.slice(7)}.json`) fail("JOURNAL_INVALID");
    records.push({ entry, entryDigest });
  }
  const genesis = records.filter(({ entry }) => entry.sequence === 0 && entry.previousEntryDigest === null);
  if (genesis.length !== 1 || genesis[0].entry.kind !== "attempt-started") fail("JOURNAL_INVALID");
  const ordered = [];
  const used = new Set();
  let current = genesis[0];
  while (current) {
    used.add(current.entryDigest);
    ordered.push(current);
    const children = records.filter(({ entry }) => entry.previousEntryDigest === current.entryDigest);
    if (children.length > 1) fail("JOURNAL_FORK_REJECTED");
    current = children[0] ?? null;
  }
  if (used.size !== records.length) fail("JOURNAL_GAP_REJECTED");
  ordered.forEach(({ entry }, index) => {
    if (entry.sequence !== index) fail("JOURNAL_SEQUENCE_INVALID");
  });
  return { ordered, head: ordered.at(-1) };
}

function verifyFixedLifecycle(ordered) {
  const entries = ordered.map(({ entry }) => entry);
  if (entries[0]?.kind !== "attempt-started"
    || entries[1]?.kind !== "setup-applied"
    || entries[2]?.kind !== "activation-applied"
    || entries[3]?.kind !== "trust-auth-observed") fail("JOURNAL_LIFECYCLE_INVALID");
  const scenarios = entries.slice(4, 4 + SCENARIOS.length);
  if (scenarios.length !== SCENARIOS.length
    || scenarios.some((entry, index) => entry.kind !== "scenario-observed" || entry.payload.scenario !== SCENARIOS[index])) {
    fail("JOURNAL_SCENARIOS_INVALID");
  }
  const ready = entries[4 + SCENARIOS.length];
  if (ready?.kind !== "candidate-ready" || entries.length !== 5 + SCENARIOS.length) fail("JOURNAL_NOT_DECISION_READY");
  return { basisEntries: entries.slice(0, -1), ready };
}

async function inspect(values) {
  if (!DIGEST.test(values["expected-head"] ?? "") || !DIGEST.test(values["expected-candidate"] ?? "")) {
    fail("EXPECTED_DIGEST_INVALID");
  }
  const [release, tarballBytes, journal] = await Promise.all([
    ownReleaseIdentity(),
    readFile(values.tarball),
    loadJournal(values.journal),
  ]);
  if (journal.head.entryDigest !== values["expected-head"]) fail("EXPECTED_HEAD_MISMATCH");
  const { basisEntries, ready } = verifyFixedLifecycle(journal.ordered);
  const candidateDigest = ready.payload.candidateDigest;
  if (candidateDigest !== values["expected-candidate"]) fail("EXPECTED_CANDIDATE_MISMATCH");
  const candidateBytes = await readFile(path.join(values.journal, "candidates", `${candidateDigest.slice(7)}.json`));
  if (digest(candidateBytes) !== candidateDigest) fail("CANDIDATE_DIGEST_MISMATCH");
  const candidate = JSON.parse(candidateBytes);
  const evidence = basisEntries.map((entry) => ({
    sequence: entry.sequence,
    kind: entry.kind,
    scenario: entry.payload.scenario ?? null,
    evidenceDigest: entry.payload.evidenceDigest,
  }));
  if (candidate.attemptId !== basisEntries[0].attemptId
    || candidate.status !== "candidate"
    || candidate.orderedEvidenceDigest !== digest(evidence)
    || candidate.scenarioCount !== SCENARIOS.length
    || candidate.releaseVersion !== release.version
    || candidate.releaseDigest !== release.releaseDigest
    || candidate.tarballDigest !== digest(tarballBytes)
    || candidate.humanAdmissionRequired !== true
    || candidate.hostOriginCryptographicallyVerified !== false
    || candidate.domainQualityCertified !== false
    || candidate.productionReady !== false
    || Object.hasOwn(candidate, "journalHeadDigest")) fail("VERIFIER_RELEASE_OR_CANDIDATE_MISMATCH");
  return {
    release,
    journal,
    candidateDigest,
    tarballDigest: digest(tarballBytes),
  };
}

async function appendDecision(values, inspected) {
  const previous = inspected.journal.head;
  const kind = values.decision === "approve" ? "human-admission" : "human-rejection";
  const entry = {
    schemaVersion: "agentmo.codex-uat-attempt-journal-entry.v1",
    attemptId: previous.entry.attemptId,
    sequence: previous.entry.sequence + 1,
    kind,
    previousEntryDigest: previous.entryDigest,
    payload: {
      candidateDigest: inspected.candidateDigest,
      decisionDigest: digest({ decision: values.decision, candidateDigest: inspected.candidateDigest }),
    },
  };
  const content = bytes(entry);
  const entryDigest = digest(content);
  const filePath = path.join(values.journal, "entries", `${String(entry.sequence).padStart(4, "0")}-${entryDigest.slice(7)}.json`);
  const handle = await open(filePath, "wx", 0o600).catch((error) => {
    if (error?.code === "EEXIST") fail("DECISION_ALREADY_EXISTS");
    throw error;
  });
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
  const after = await loadJournal(values.journal);
  if (after.head.entryDigest !== entryDigest) fail("DECISION_POSTCONDITION_FAILED");
  return entryDigest;
}

try {
  const { command, values } = parseArgs(process.argv.slice(2));
  const inspected = await inspect(values);
  const result = {
    schemaVersion: "agentmo.spike.post-uninstall-verifier-result.v1",
    status: command === "preview" ? "candidate-preview" : values.decision === "approve" ? "human-admission" : "human-rejection",
    journalHeadDigest: inspected.journal.head.entryDigest,
    candidateDigest: inspected.candidateDigest,
    releaseVersion: inspected.release.version,
    releaseDigest: inspected.release.releaseDigest,
    tarballDigest: inspected.tarballDigest,
    decisionEntryDigest: null,
  };
  if (command === "decide") result.decisionEntryDigest = await appendDecision(values, inspected);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ status: "rejected", code: error?.code ?? "VERIFIER_FAILED" })}\n`);
  process.exitCode = 1;
}
