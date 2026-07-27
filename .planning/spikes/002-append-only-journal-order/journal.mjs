import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const SCENARIOS = Object.freeze([
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
]);

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ENTRY_KEYS = ["schemaVersion", "attemptId", "sequence", "kind", "previousEntryDigest", "payload"];

export class JournalError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new JournalError(code);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function bytes(value) {
  return Buffer.from(`${JSON.stringify(canonical(value))}\n`, "utf8");
}

export function digest(value) {
  const input = Buffer.isBuffer(value) ? value : bytes(value);
  return `sha256:${createHash("sha256").update(input).digest("hex")}`;
}

function exactKeys(value, keys) {
  return value && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function entryName(entry, entryDigest) {
  return `${String(entry.sequence).padStart(4, "0")}-${entryDigest.slice(7)}.json`;
}

function validateEntry(entry) {
  if (!exactKeys(entry, ENTRY_KEYS)
    || entry.schemaVersion !== "agentmo.codex-uat-attempt-journal-entry.v1"
    || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(entry.attemptId ?? "")
    || !Number.isSafeInteger(entry.sequence)
    || entry.sequence < 0
    || (entry.sequence === 0 ? entry.previousEntryDigest !== null : !DIGEST.test(entry.previousEntryDigest ?? ""))
    || !entry.payload
    || typeof entry.payload !== "object"
    || Array.isArray(entry.payload)) fail("JOURNAL_ENTRY_INVALID");
}

function initialState(attemptId) {
  return { attemptId, phase: "empty", nextScenario: 0, candidateDigest: null, terminal: false };
}

function applyTransition(state, entry) {
  if (entry.attemptId !== state.attemptId || state.terminal) fail("JOURNAL_TRANSITION_INVALID");
  const evidenceDigest = entry.payload.evidenceDigest;
  if (entry.kind !== "human-admission" && entry.kind !== "human-rejection" && !DIGEST.test(evidenceDigest ?? "")) {
    fail("JOURNAL_EVIDENCE_INVALID");
  }

  if (state.phase === "empty" && entry.kind === "attempt-started") {
    if (entry.sequence !== 0 || entry.previousEntryDigest !== null) fail("JOURNAL_GENESIS_INVALID");
    return { ...state, phase: "started" };
  }
  if (state.phase === "started" && entry.kind === "setup-applied") return { ...state, phase: "setup" };
  if (state.phase === "setup" && entry.kind === "activation-applied") return { ...state, phase: "activated" };
  if (state.phase === "activated" && entry.kind === "trust-auth-observed") return { ...state, phase: "observing" };
  if (state.phase === "observing" && entry.kind === "scenario-observed") {
    if (entry.payload.scenario !== SCENARIOS[state.nextScenario]) fail("JOURNAL_SCENARIO_ORDER_INVALID");
    const nextScenario = state.nextScenario + 1;
    return { ...state, nextScenario, phase: nextScenario === SCENARIOS.length ? "scenarios-complete" : "observing" };
  }
  if (state.phase === "scenarios-complete" && entry.kind === "candidate-ready") {
    if (!DIGEST.test(entry.payload.candidateDigest ?? "")) fail("JOURNAL_CANDIDATE_INVALID");
    return { ...state, phase: "candidate-ready", candidateDigest: entry.payload.candidateDigest };
  }
  if (state.phase === "candidate-ready" && ["human-admission", "human-rejection"].includes(entry.kind)) {
    if (!exactKeys(entry.payload, ["candidateDigest", "decisionDigest"])
      || entry.payload.candidateDigest !== state.candidateDigest
      || !DIGEST.test(entry.payload.decisionDigest ?? "")) fail("JOURNAL_DECISION_INVALID");
    return { ...state, phase: entry.kind, terminal: true };
  }
  if (!["candidate-ready", "human-admission", "human-rejection"].includes(entry.kind)
    && ["failure", "interruption"].includes(entry.kind)) {
    if (!/^[A-Z0-9_]{3,96}$/.test(entry.payload.code ?? "")) fail("JOURNAL_OUTCOME_INVALID");
    return { ...state, phase: entry.kind, terminal: true };
  }
  fail("JOURNAL_TRANSITION_INVALID");
}

function deriveState(entries) {
  if (entries.length === 0) return initialState("unknown");
  let state = initialState(entries[0].attemptId);
  for (const entry of entries) state = applyTransition(state, entry);
  return state;
}

async function publishExclusive(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    const handle = await open(filePath, "wx", 0o600);
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    return "published";
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await readFile(filePath);
    if (!existing.equals(content)) fail("JOURNAL_EXISTING_BYTES_CONFLICT");
    return "replay";
  }
}

export async function loadJournal(root) {
  const entriesRoot = path.join(root, "entries");
  const names = (await readdir(entriesRoot).catch((error) => error?.code === "ENOENT" ? [] : Promise.reject(error)))
    .filter((name) => /^\d{4}-[0-9a-f]{64}\.json$/.test(name));
  if (names.length === 0) return { entries: [], headDigest: null, state: initialState("unknown") };

  const records = [];
  for (const name of names) {
    const content = await readFile(path.join(entriesRoot, name));
    let entry;
    try { entry = JSON.parse(content); } catch { fail("JOURNAL_ENTRY_INVALID"); }
    validateEntry(entry);
    const entryDigest = digest(content);
    if (name !== entryName(entry, entryDigest)) fail("JOURNAL_FILENAME_INVALID");
    records.push({ entry, entryDigest });
  }

  const genesis = records.filter(({ entry }) => entry.sequence === 0 && entry.previousEntryDigest === null);
  if (genesis.length !== 1 || genesis[0].entry.kind !== "attempt-started") fail("JOURNAL_GENESIS_INVALID");
  const ordered = [];
  const used = new Set();
  let current = genesis[0];
  while (current) {
    if (used.has(current.entryDigest)) fail("JOURNAL_CYCLE_INVALID");
    used.add(current.entryDigest);
    ordered.push(current.entry);
    const children = records.filter(({ entry }) => entry.previousEntryDigest === current.entryDigest);
    if (children.length > 1) fail("JOURNAL_FORK_REJECTED");
    current = children[0] ?? null;
  }
  if (used.size !== records.length) fail("JOURNAL_ORPHAN_OR_GAP_REJECTED");
  for (let index = 0; index < ordered.length; index += 1) {
    if (ordered[index].sequence !== index) fail("JOURNAL_SEQUENCE_INVALID");
  }
  return {
    entries: ordered,
    headDigest: records.find(({ entry }) => entry === ordered.at(-1)).entryDigest,
    state: deriveState(ordered),
  };
}

export async function appendEntry(root, attemptId, kind, payload) {
  const loaded = await loadJournal(root);
  const sequence = loaded.entries.length;
  const entry = {
    schemaVersion: "agentmo.codex-uat-attempt-journal-entry.v1",
    attemptId,
    sequence,
    kind,
    previousEntryDigest: loaded.headDigest,
    payload,
  };
  validateEntry(entry);
  const nextState = applyTransition(
    sequence === 0 ? initialState(attemptId) : loaded.state,
    entry,
  );
  const content = bytes(entry);
  const entryDigest = digest(content);
  await publishExclusive(path.join(root, "entries", entryName(entry, entryDigest)), content);
  const admitted = await loadJournal(root);
  if (admitted.headDigest !== entryDigest || admitted.state.phase !== nextState.phase) fail("JOURNAL_POSTCONDITION_FAILED");
  return { entry, entryDigest, state: admitted.state };
}

function candidateBasis(entries, releaseIdentity) {
  const state = deriveState(entries);
  if (state.phase !== "scenarios-complete"
    || !exactKeys(releaseIdentity, ["version", "releaseDigest", "tarballDigest"])
    || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(releaseIdentity.version ?? "")
    || !DIGEST.test(releaseIdentity.releaseDigest ?? "")
    || !DIGEST.test(releaseIdentity.tarballDigest ?? "")) fail("CANDIDATE_PRECONDITION_FAILED");
  const evidence = entries.map((entry) => ({
    sequence: entry.sequence,
    kind: entry.kind,
    scenario: entry.payload.scenario ?? null,
    evidenceDigest: entry.payload.evidenceDigest,
  }));
  return {
    schemaVersion: "agentmo.codex-uat.v1",
    attemptId: state.attemptId,
    status: "candidate",
    releaseVersion: releaseIdentity.version,
    releaseDigest: releaseIdentity.releaseDigest,
    tarballDigest: releaseIdentity.tarballDigest,
    orderedEvidenceDigest: digest(evidence),
    scenarioCount: SCENARIOS.length,
    humanAdmissionRequired: true,
    hostOriginCryptographicallyVerified: false,
    domainQualityCertified: false,
    productionReady: false,
  };
}

export async function publishCandidate(root, releaseIdentity) {
  const loaded = await loadJournal(root);
  const candidate = candidateBasis(loaded.entries, releaseIdentity);
  const content = bytes(candidate);
  const candidateDigest = digest(content);
  const filePath = path.join(root, "candidates", `${candidateDigest.slice(7)}.json`);
  await publishExclusive(filePath, content);
  return { candidate, candidateDigest, filePath };
}

export async function appendCandidateReady(root, attemptId, candidateDigest) {
  const loaded = await loadJournal(root);
  const filePath = path.join(root, "candidates", `${candidateDigest.slice(7)}.json`);
  const content = await readFile(filePath).catch(() => fail("CANDIDATE_NOT_FOUND"));
  if (digest(content) !== candidateDigest) fail("CANDIDATE_DIGEST_MISMATCH");
  let candidate;
  try { candidate = JSON.parse(content); } catch { fail("CANDIDATE_INVALID"); }
  const expected = candidateBasis(loaded.entries, {
    version: candidate.releaseVersion,
    releaseDigest: candidate.releaseDigest,
    tarballDigest: candidate.tarballDigest,
  });
  if (!bytes(expected).equals(bytes(candidate))) fail("CANDIDATE_BASIS_MISMATCH");
  return appendEntry(root, attemptId, "candidate-ready", {
    evidenceDigest: digest({ subject: "candidate-ready", candidateDigest }),
    candidateDigest,
  });
}

export async function appendHumanDecision(root, attemptId, decision, candidateDigest) {
  return appendEntry(root, attemptId, decision === "approve" ? "human-admission" : "human-rejection", {
    candidateDigest,
    decisionDigest: digest({ decision, candidateDigest }),
  });
}

export async function testPublishRawEntry(root, entry) {
  const content = bytes(entry);
  const entryDigest = digest(content);
  await publishExclusive(path.join(root, "entries", entryName(entry, entryDigest)), content);
  return entryDigest;
}
