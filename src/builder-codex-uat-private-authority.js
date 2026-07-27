import { constants } from "node:fs";
import {
  lstat,
  open,
  readdir,
  realpath,
} from "node:fs/promises";
import path from "node:path";

import { digestRawBytes } from "./artifact-admission.js";
import {
  appendAppendOnlyRecord,
  readAppendOnlyAuthority,
} from "./builder-append-only-authority.js";
import { loadCodexUatAttemptJournal } from "./builder-codex-uat.js";
import { diagnoseBuilderInstall } from "./builder-doctor.js";
import { assertBuilderPlatform } from "./builder-platform.js";
import { runBuilderPosixEffect } from "./builder-posix-effect.js";
import { assertPersistable, serializePersistableJson } from "./persistability.js";

export const CODEX_UAT_PRIOR_PREFLIGHT_SCHEMA_VERSION = "agentmo.codex-uat-prior-preflight.v1";
export const CODEX_UAT_CONTINUATION_SCHEMA_VERSION = "agentmo.codex-uat-continuation.v1";
export const PRIVATE_AUTHORITY_RELATIVE_ROOT = ".omx/codex-uat/phase-02-final-retry";
export const PRIOR_PREFLIGHT_RECEIPT_NAME = "prior-preflight.receipt.json";
export const CODEX_UAT_CONTINUATION_NAME = "continuation.json";
export const KNOWN_PRIOR_TERMINAL_HEAD = "sha256:5a82e22d54bb8a52f1515d54e03d0e0668efdc083637b426d5280b38ebeb8d5f";
export const KNOWN_PRIOR_TERMINAL_CODE = "AGENTMO_BUILDER_INSTALL_HOST_ROLLBACK_FAILED";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const MAX_LOCATOR_BYTES = 64 * 1024;
const MAX_AUTHORITY_BYTES = 256 * 1024;
const PRIOR_PREFLIGHT_AUTHORITY_RELATIVE_ROOT = `${PRIVATE_AUTHORITY_RELATIVE_ROOT}/prior-preflight-authority`;
const CONTINUATION_AUTHORITY_RELATIVE_ROOT = `${PRIVATE_AUTHORITY_RELATIVE_ROOT}/continuation-authority`;
const PRIOR_PREFLIGHT_AUTHORITY_NAMESPACE = "codex-uat-prior";
const CONTINUATION_AUTHORITY_NAMESPACE = "codex-uat-continuation";
const PREFLIGHTS = new WeakSet();
const ROOT_AUTHORITIES = new WeakSet();
const RECEIPT_ADMISSIONS = new WeakSet();
const CONTINUATION_ADMISSIONS = new WeakSet();
const PRIVATE_PUBLICATION_QUEUES = new Map();
const HUMAN_DECISION_CONTINUATION_STATES = new Set(["human-approved", "human-rejected"]);
const TERMINAL_CONTINUATION_STATES = new Set(["failure", "interruption"]);
function assertNoUnadmittedHumanDecision(status) {
  if (HUMAN_DECISION_CONTINUATION_STATES.has(status)) reject("AGENTMO_CODEX_UAT_HUMAN_DECISION_AUTHORITY_REQUIRED");
  return status;
}
const LEGAL_CONTINUATION_TRANSITIONS = new Map([
  ["awaiting-local-invocation", new Set(["candidate-ready", "failure", "interruption"])],
  ["candidate-ready", new Set(["failure", "interruption"])],
]);
const RECEIPT_KEYS = Object.freeze([
  "schemaVersion",
  "toolDigest",
  "schemaDigest",
  "entryCount",
  "terminal",
  "before",
  "after",
  "appended",
]);
const CAPTURE_KEYS = Object.freeze([
  "base",
  "successor",
  "entrySetDigest",
  "loaderDigest",
  "diagnosisDigest",
]);
const CONTINUATION_KEYS = Object.freeze([
  "schemaVersion",
  "sequence",
  "predecessorDigest",
  "headDigest",
  "status",
  "priorReceiptDigest",
  "candidateDigest",
  "outcomeCode",
]);

export const PRIOR_PREFLIGHT_SCHEMA_DIGEST = digestValue({
  schemaVersion: CODEX_UAT_PRIOR_PREFLIGHT_SCHEMA_VERSION,
  keys: RECEIPT_KEYS,
  captureKeys: CAPTURE_KEYS,
  terminal: {
    kind: "failure",
    code: KNOWN_PRIOR_TERMINAL_CODE,
    headDigest: KNOWN_PRIOR_TERMINAL_HEAD,
  },
}, "builder-codex-uat-prior-preflight-schema");

export const PRIVATE_AUTHORITY_TOOL_DIGEST = digestValue({
  schemaVersion: "agentmo.codex-uat-private-authority-tool.v1",
  authorityRoot: PRIVATE_AUTHORITY_RELATIVE_ROOT,
  receiptSchema: CODEX_UAT_PRIOR_PREFLIGHT_SCHEMA_VERSION,
  continuationSchema: CODEX_UAT_CONTINUATION_SCHEMA_VERSION,
}, "builder-codex-uat-private-authority-tool");

export class BuilderCodexUatPrivateAuthorityError extends Error {
  constructor(code) {
    super("Codex UAT private authority operation was rejected.");
    this.name = "BuilderCodexUatPrivateAuthorityError";
    this.code = code;
  }
}

export function assertPrivateAuthorityMetadata(metadata, kind = "file") {
  if (!metadata || typeof metadata !== "object" || typeof process.getuid !== "function") reject();
  const actualMode = Number(metadata.mode) & 0o777;
  const directory = kind === "directory" || kind === "safe-directory";
  const expectedType = directory ? metadata.isDirectory?.() : metadata.isFile?.();
  if (!expectedType
    || Number(metadata.uid) !== process.getuid()
    || (directory ? (actualMode & 0o022) !== 0 : actualMode !== 0o600)
    || (kind === "directory" && actualMode !== 0o700)
    || BigInt(metadata.nlink) < 1n) reject();
  return true;
}

export async function preflightCodexUatPriorAttempt(locatorInput, options = {}) {
  assertBuilderPlatform();
  const locator = parseLocator(locatorInput);
  const expectedHeadDigest = options.expectedHeadDigest ?? KNOWN_PRIOR_TERMINAL_HEAD;
  if (!exactKeys(options, options.expectedHeadDigest === undefined ? [] : ["expectedHeadDigest"])
    || !DIGEST_PATTERN.test(expectedHeadDigest)) reject();

  let projectAuthority;
  let journalAuthority;
  let base;
  let successor;
  try {
    projectAuthority = await retainDirectory(locator.projectRoot);
    const basePath = admitDirectFile(locator.projectRoot, locator.baseJournal);
    const successorPath = admitDirectFile(locator.projectRoot, locator.successorEntry);
    if (path.dirname(basePath) !== path.dirname(successorPath) || basePath === successorPath) reject();
    await assertSafeRelativeDirectoryChain(locator.projectRoot, path.dirname(basePath));
    journalAuthority = await retainDirectory(path.dirname(basePath));
    await assertDirectoryAuthority(projectAuthority);
    await assertDirectoryAuthority(journalAuthority);
    [base, successor] = await Promise.all([
      retainFile(basePath),
      retainFile(successorPath),
    ]);
    await assertExactJournalEntrySet(basePath, successorPath);

    const before = await capturePreflightState({
      base,
      successor,
      journalPath: basePath,
      projectRoot: locator.projectRoot,
    });
    const firstView = await loadCodexUatAttemptJournal(basePath);
    assertKnownTerminal(firstView, expectedHeadDigest);
    const diagnosis = await diagnoseBuilderInstall({ projectRoot: locator.projectRoot });
    const secondView = await loadCodexUatAttemptJournal(basePath);
    assertKnownTerminal(secondView, expectedHeadDigest);
    await assertExactJournalEntrySet(basePath, successorPath);
    const after = await capturePreflightState({
      base,
      successor,
      journalPath: basePath,
      projectRoot: locator.projectRoot,
      view: secondView,
      diagnosis,
    });
    const firstLoaderDigest = digestJournalView(firstView);
    const diagnosisDigest = digestValue(diagnosis, "builder-codex-uat-prior-diagnosis");
    before.loaderDigest = firstLoaderDigest;
    before.diagnosisDigest = diagnosisDigest;
    if (!sameCapture(before, after)) reject("AGENTMO_CODEX_UAT_PRIOR_DRIFT_REJECTED");
    await Promise.all([
      assertDirectoryAuthority(projectAuthority),
      assertDirectoryAuthority(journalAuthority),
      assertFileAuthority(base),
      assertFileAuthority(successor),
    ]);
    const receipt = freeze({
      schemaVersion: CODEX_UAT_PRIOR_PREFLIGHT_SCHEMA_VERSION,
      toolDigest: PRIVATE_AUTHORITY_TOOL_DIGEST,
      schemaDigest: PRIOR_PREFLIGHT_SCHEMA_DIGEST,
      entryCount: 2,
      terminal: {
        kind: "failure",
        code: KNOWN_PRIOR_TERMINAL_CODE,
        headDigest: expectedHeadDigest,
      },
      before: publicCapture(before),
      after: publicCapture(after),
      appended: false,
    });
    validatePriorReceipt(receipt, { expectedHeadDigest });
    const result = Object.freeze({
      status: "pass",
      receipt,
      receiptDigest: digestValue(receipt, "builder-codex-uat-prior-preflight"),
    });
    PREFLIGHTS.add(result);
    return result;
  } catch (error) {
    if (error instanceof BuilderCodexUatPrivateAuthorityError) throw error;
    reject();
  } finally {
    await Promise.allSettled([
      base?.handle.close(),
      successor?.handle.close(),
      journalAuthority?.handle.close(),
      projectAuthority?.handle.close(),
    ].filter(Boolean));
  }
}

export async function bootstrapPrivateAuthorityRoot(options) {
  assertBuilderPlatform();
  if (!exactKeys(options, ["repositoryRoot", "preflight"])
    || !PREFLIGHTS.has(options.preflight)
    || options.preflight.status !== "pass") reject();
  const repositoryRoot = await admitRepositoryRoot(options.repositoryRoot);
  const segments = PRIVATE_AUTHORITY_RELATIVE_ROOT.split("/");
  let current = repositoryRoot;
  let parent = await retainDirectory(current);
  try {
    for (const segment of segments) {
      const next = path.join(current, segment);
      let child;
      try {
        await assertDirectoryAuthority(parent);
        const effect = await runBuilderPosixEffect({
          action: "mkdir",
          name: segment,
          payload: "",
        }, {
          directoryAuthority: privateDirectoryEffectAuthority(parent),
        });
        if (effect.kind !== "directory") reject();
        await assertDirectoryAuthority(parent);
        child = await retainDirectory(next, { privateMode: segments.at(-1) === segment });
        if (!sameEffectDirectoryIdentity(effect.identity, child.stat)) reject();
        await assertDirectoryAuthority(parent);
        const attached = await lstat(next, { bigint: true });
        if (!sameDirectoryIdentity(child.stat, attached)) reject();
        await parent.handle.sync();
        await assertDirectoryAuthority(parent);
      } catch (error) {
        await child?.handle.close().catch(() => {});
        if (error instanceof BuilderCodexUatPrivateAuthorityError) throw error;
        reject();
      }
      await parent.handle.close();
      parent = child;
      current = next;
    }
    const authority = Object.freeze({ path: current, rootPath: current, repositoryRoot, handle: parent.handle, stat: parent.stat });
    ROOT_AUTHORITIES.add(authority);
    parent = null;
    return authority;
  } finally {
    await parent?.handle.close().catch(() => {});
  }
}

export async function publishPriorPreflightReceipt(options) {
  assertBuilderPlatform();
  if (!exactKeys(options, ["authority", "preflight"])
    || !ROOT_AUTHORITIES.has(options.authority)
    || !PREFLIGHTS.has(options.preflight)) reject();
  await assertRootAuthority(options.authority);
  validatePriorReceipt(options.preflight.receipt, {
    expectedHeadDigest: options.preflight.receipt.terminal.headDigest,
  });
  const receiptDigest = digestValue(
    options.preflight.receipt,
    "builder-codex-uat-prior-preflight",
  );
  await withPrivatePublicationQueue(
    `${options.authority.repositoryRoot}\0${PRIOR_PREFLIGHT_AUTHORITY_RELATIVE_ROOT}`,
    async () => {
      const existing = await readPrivateAuthority(
        options.authority.repositoryRoot,
        PRIOR_PREFLIGHT_AUTHORITY_RELATIVE_ROOT,
        PRIOR_PREFLIGHT_AUTHORITY_NAMESPACE,
      );
      if (existing.records.length !== 0) {
        const record = existing.records[0];
        if (existing.records.length !== 1
          || existing.aborted.length !== 0
          || existing.recoveryRequired !== null
          || record.idempotencyKey !== `prior:${receiptDigest.slice("sha256:".length)}`
          || record.payloadDigest !== receiptDigest) reject();
        return;
      }
      if (existing.aborted.length !== 0) reject();
      const result = await appendPrivateAuthorityRecord({
        repositoryRoot: options.authority.repositoryRoot,
        relativeRoot: PRIOR_PREFLIGHT_AUTHORITY_RELATIVE_ROOT,
        namespace: PRIOR_PREFLIGHT_AUTHORITY_NAMESPACE,
        idempotencyKey: `prior:${receiptDigest.slice("sha256:".length)}`,
        expectedHeadDigest: existing.headDigest,
        payload: options.preflight.receipt,
        retainedRoot: options.authority,
      });
      if (result.status !== "committed"
        || digestValue(result.payload, "builder-codex-uat-prior-preflight") !== receiptDigest) {
        reject();
      }
    },
  );
  await assertRootAuthority(options.authority);
  return admitPriorPreflightReceipt({
    repositoryRoot: options.authority.repositoryRoot,
    expectedHeadDigest: options.preflight.receipt.terminal.headDigest,
  });
}

export async function loadPriorPreflightReceipt(options) {
  assertBuilderPlatform();
  const expectedHeadDigest = options?.expectedHeadDigest ?? KNOWN_PRIOR_TERMINAL_HEAD;
  if (!exactKeys(options, options?.expectedHeadDigest === undefined
    ? ["repositoryRoot"]
    : ["repositoryRoot", "expectedHeadDigest"])
    || !DIGEST_PATTERN.test(expectedHeadDigest)) reject();
  const authority = await readPrivateAuthority(
    options.repositoryRoot,
    PRIOR_PREFLIGHT_AUTHORITY_RELATIVE_ROOT,
    PRIOR_PREFLIGHT_AUTHORITY_NAMESPACE,
  );
  if (authority.records.length !== 1
    || authority.aborted.length !== 0
    || authority.recoveryRequired !== null) reject();
  const record = authority.records[0];
  const value = record.payload;
  validatePriorReceipt(value, { expectedHeadDigest });
  const bytes = canonicalBytes(value, "builder-codex-uat-prior-preflight");
  const admission = Object.freeze({
    schemaVersion: CODEX_UAT_PRIOR_PREFLIGHT_SCHEMA_VERSION,
    digest: digestRawBytes(bytes),
    value: freeze(value),
    identity: await loadAuthorityRecordIdentity(
      options.repositoryRoot,
      PRIOR_PREFLIGHT_AUTHORITY_RELATIVE_ROOT,
      record.path,
      record.identity,
      record.digest,
    ),
  });
  RECEIPT_ADMISSIONS.add(admission);
  return admission;
}

export async function admitPriorPreflightReceipt(options) {
  assertBuilderPlatform();
  const admission = await loadPriorPreflightReceipt(options);
  if (!RECEIPT_ADMISSIONS.has(admission)) reject();
  return admission;
}

export async function publishCodexUatContinuation(options) {
  assertBuilderPlatform();
  if (!exactKeys(options, ["repositoryRoot", "priorReceiptAdmission", "value"])
    || !RECEIPT_ADMISSIONS.has(options.priorReceiptAdmission)) reject();
  return withPrivatePublicationQueue(
    `${path.resolve(options.repositoryRoot)}\0${CONTINUATION_AUTHORITY_RELATIVE_ROOT}`,
    async () => {
      const prior = await loadPriorPreflightReceipt({
        repositoryRoot: options.repositoryRoot,
        expectedHeadDigest: options.priorReceiptAdmission.value.terminal.headDigest,
      });
      if (prior.digest !== options.priorReceiptAdmission.digest) reject();
      const value = normalizeInitialContinuation(options.value, prior.digest);
      const bytes = canonicalBytes(value, "builder-codex-uat-continuation");
      const expectedDigest = digestRawBytes(bytes);
      const existing = await readPrivateAuthority(
        options.repositoryRoot,
        CONTINUATION_AUTHORITY_RELATIVE_ROOT,
        CONTINUATION_AUTHORITY_NAMESPACE,
      );
      if (existing.records.length !== 0) {
        const loaded = await loadContinuationAuthority(options.repositoryRoot);
        if (loaded.chain[0]?.digest !== expectedDigest) reject();
        return createContinuationAdmission(options.repositoryRoot, loaded.chain[0]);
      }
      if (existing.aborted.length !== 0) reject();
      const result = await appendPrivateAuthorityRecord({
        repositoryRoot: options.repositoryRoot,
        relativeRoot: CONTINUATION_AUTHORITY_RELATIVE_ROOT,
        namespace: CONTINUATION_AUTHORITY_NAMESPACE,
        idempotencyKey: continuationIdempotencyKey(value, expectedDigest),
        expectedHeadDigest: existing.headDigest,
        payload: value,
      });
      if (result.status !== "committed") reject();
      return loadExactContinuationAdmission({
        repositoryRoot: options.repositoryRoot,
        expectedSequence: 0,
        expectedDigest,
      });
    },
  );
}

export async function loadCodexUatContinuation(options) {
  assertBuilderPlatform();
  if (!exactKeys(options, ["repositoryRoot"])) reject();
  const loaded = await loadContinuationAuthority(options.repositoryRoot);
  const previous = loaded.chain.at(-1);
  if (!previous) reject();
  return createContinuationAdmission(options.repositoryRoot, previous);
}

export async function transitionCodexUatContinuation(options) {
  assertBuilderPlatform();
  if (!exactKeys(options, ["repositoryRoot", "expectedAdmission", "next"])
    || !CONTINUATION_ADMISSIONS.has(options.expectedAdmission)) reject();
  const nextStatus = assertNoUnadmittedHumanDecision(options.next?.status);
  if (!exactKeys(options.next, ["status", "candidateDigest", "outcomeCode"])
    || !LEGAL_CONTINUATION_TRANSITIONS.get(options.expectedAdmission.value.status)?.has(nextStatus)) reject();
  const sequence = options.expectedAdmission.value.sequence + 1;
  const basis = {
    schemaVersion: CODEX_UAT_CONTINUATION_SCHEMA_VERSION,
    sequence,
    predecessorDigest: options.expectedAdmission.digest,
    status: nextStatus,
    priorReceiptDigest: options.expectedAdmission.value.priorReceiptDigest,
    candidateDigest: options.next.candidateDigest,
    outcomeCode: options.next.outcomeCode,
  };
  const value = freeze({
    ...basis,
    headDigest: digestValue(basis, "builder-codex-uat-continuation-head"),
  });
  validateContinuation(value);
  const bytes = canonicalBytes(value, "builder-codex-uat-continuation");
  const expectedDigest = digestRawBytes(bytes);
  return withPrivatePublicationQueue(
    `${path.resolve(options.repositoryRoot)}\0${CONTINUATION_AUTHORITY_RELATIVE_ROOT}`,
    async () => {
      const loaded = await loadContinuationAuthority(options.repositoryRoot);
      const alreadyCommitted = loaded.chain[sequence];
      if (alreadyCommitted !== undefined) {
        if (alreadyCommitted.digest !== expectedDigest
          || alreadyCommitted.value.predecessorDigest !== options.expectedAdmission.digest) {
          reject("AGENTMO_CODEX_UAT_CONTINUATION_STALE");
        }
        return createContinuationAdmission(options.repositoryRoot, alreadyCommitted);
      }
      const current = loaded.chain.at(-1);
      if (current?.digest !== options.expectedAdmission.digest
        || current.value.headDigest !== options.expectedAdmission.value.headDigest
        || current.value.sequence + 1 !== sequence) {
        reject("AGENTMO_CODEX_UAT_CONTINUATION_STALE");
      }
      const result = await appendPrivateAuthorityRecord({
        repositoryRoot: options.repositoryRoot,
        relativeRoot: CONTINUATION_AUTHORITY_RELATIVE_ROOT,
        namespace: CONTINUATION_AUTHORITY_NAMESPACE,
        idempotencyKey: continuationIdempotencyKey(value, expectedDigest),
        expectedHeadDigest: loaded.authority.headDigest,
        payload: value,
      });
      if (result.status !== "committed") reject();
      return loadExactContinuationAdmission({
        repositoryRoot: options.repositoryRoot,
        expectedSequence: sequence,
        expectedDigest,
      });
    },
  );
}

async function loadExactContinuationAdmission({ repositoryRoot, expectedSequence, expectedDigest }) {
  const loaded = await loadContinuationAuthority(repositoryRoot);
  const entry = loaded.chain[expectedSequence];
  if (entry === undefined || entry.digest !== expectedDigest) reject();
  return createContinuationAdmission(repositoryRoot, entry);
}

async function capturePreflightState({ base, successor, journalPath, projectRoot, view, diagnosis }) {
  const [baseCapture, successorCapture] = await Promise.all([
    captureFile(base),
    captureFile(successor),
  ]);
  const loadedView = view ?? await loadCodexUatAttemptJournal(journalPath);
  const loadedDiagnosis = diagnosis ?? await diagnoseBuilderInstall({ projectRoot });
  return {
    base: baseCapture,
    successor: successorCapture,
    entrySetDigest: digestValue([
      { identity: baseCapture.identity, rawDigest: baseCapture.rawDigest },
      { identity: successorCapture.identity, rawDigest: successorCapture.rawDigest },
    ], "builder-codex-uat-prior-entry-set"),
    loaderDigest: digestJournalView(loadedView),
    diagnosisDigest: digestValue(loadedDiagnosis, "builder-codex-uat-prior-diagnosis"),
  };
}

function publicCapture(capture) {
  return freeze({
    base: capture.base,
    successor: capture.successor,
    entrySetDigest: capture.entrySetDigest,
    loaderDigest: capture.loaderDigest,
    diagnosisDigest: capture.diagnosisDigest,
  });
}

function validatePriorReceipt(value, { expectedHeadDigest }) {
  if (!exactKeys(value, RECEIPT_KEYS)
    || value.schemaVersion !== CODEX_UAT_PRIOR_PREFLIGHT_SCHEMA_VERSION
    || value.toolDigest !== PRIVATE_AUTHORITY_TOOL_DIGEST
    || value.schemaDigest !== PRIOR_PREFLIGHT_SCHEMA_DIGEST
    || value.entryCount !== 2
    || !exactKeys(value.terminal, ["kind", "code", "headDigest"])
    || value.terminal.kind !== "failure"
    || value.terminal.code !== KNOWN_PRIOR_TERMINAL_CODE
    || value.terminal.headDigest !== expectedHeadDigest
    || value.appended !== false
    || !validCapture(value.before)
    || !validCapture(value.after)
    || !sameCapture(value.before, value.after)) reject("AGENTMO_CODEX_UAT_PRIOR_RECEIPT_REJECTED");
  assertPersistable(value, { subject: "builder-codex-uat-prior-preflight" });
}

function validCapture(value) {
  return exactKeys(value, CAPTURE_KEYS)
    && validEntryCapture(value.base)
    && validEntryCapture(value.successor)
    && DIGEST_PATTERN.test(value.entrySetDigest ?? "")
    && DIGEST_PATTERN.test(value.loaderDigest ?? "")
    && DIGEST_PATTERN.test(value.diagnosisDigest ?? "");
}

function validEntryCapture(value) {
  return exactKeys(value, ["identity", "rawDigest"])
    && validIdentity(value.identity)
    && DIGEST_PATTERN.test(value.rawDigest ?? "");
}

function normalizeInitialContinuation(value, priorReceiptDigest) {
  if (!exactKeys(value, ["status", "candidateDigest", "outcomeCode"])
    || value.status !== "awaiting-local-invocation"
    || value.candidateDigest !== null
    || value.outcomeCode !== null) reject();
  const basis = {
    schemaVersion: CODEX_UAT_CONTINUATION_SCHEMA_VERSION,
    sequence: 0,
    predecessorDigest: null,
    status: value.status,
    priorReceiptDigest,
    candidateDigest: null,
    outcomeCode: null,
  };
  return freeze({ ...basis, headDigest: digestValue(basis, "builder-codex-uat-continuation-head") });
}

function validateContinuation(value) {
  if (!exactKeys(value, CONTINUATION_KEYS)
    || value.schemaVersion !== CODEX_UAT_CONTINUATION_SCHEMA_VERSION
    || !Number.isSafeInteger(value.sequence)
    || value.sequence < 0
    || (value.sequence === 0 ? value.predecessorDigest !== null : !DIGEST_PATTERN.test(value.predecessorDigest ?? ""))
    || !DIGEST_PATTERN.test(value.headDigest ?? "")
    || !DIGEST_PATTERN.test(value.priorReceiptDigest ?? "")
    || ![...LEGAL_CONTINUATION_TRANSITIONS.keys(), ...TERMINAL_CONTINUATION_STATES].includes(value.status)
    || (value.status === "candidate-ready" ? !DIGEST_PATTERN.test(value.candidateDigest ?? "") : value.candidateDigest !== null)
    || (["failure", "interruption"].includes(value.status)
      ? !/^AGENTMO_[A-Z0-9_]{1,96}$/u.test(value.outcomeCode ?? "")
      : value.outcomeCode !== null)) reject("AGENTMO_CODEX_UAT_CONTINUATION_REJECTED");
  assertPersistable(value, { subject: "builder-codex-uat-continuation" });
}

function continuationHeadBasis(value) {
  const { headDigest: _headDigest, ...basis } = value;
  return basis;
}

async function retainExistingRoot(repositoryRootInput) {
  const repositoryRoot = await admitRepositoryRoot(repositoryRootInput);
  const rootPath = path.join(repositoryRoot, ...PRIVATE_AUTHORITY_RELATIVE_ROOT.split("/"));
  await assertSafeRelativeDirectoryChain(repositoryRoot, rootPath, { exactFinalMode: true });
  const retained = await retainDirectory(rootPath, { privateMode: true });
  return Object.freeze({ ...retained, rootPath, repositoryRoot });
}

async function admitRepositoryRoot(input) {
  if (typeof input !== "string" || input.length === 0 || input.includes("\0")) reject();
  const resolved = path.resolve(input);
  const canonical = await realpath(resolved).catch(() => reject());
  if (canonical !== resolved) reject();
  const stat = await lstat(resolved, { bigint: true }).catch(() => reject());
  assertPrivateAuthorityMetadata(stat, "safe-directory");
  return resolved;
}

async function assertSafeRelativeDirectoryChain(root, target, options = {}) {
  const relative = path.relative(root, target);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) reject();
  let current = root;
  const segments = relative.split(path.sep);
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const canonical = await realpath(current).catch(() => reject());
    const stat = await lstat(current, { bigint: true }).catch(() => reject());
    if (canonical !== current) reject();
    assertPrivateAuthorityMetadata(
      stat,
      options.exactFinalMode === true && index === segments.length - 1
        ? "directory"
        : "safe-directory",
    );
  }
}

async function retainDirectory(directoryPath, options = {}) {
  let handle;
  try {
    const before = await lstat(directoryPath, { bigint: true });
    const kind = options.privateMode === true ? "directory" : "safe-directory";
    const canonical = await realpath(directoryPath);
    if (canonical !== directoryPath) reject();
    assertPrivateAuthorityMetadata(before, kind);
    handle = await open(directoryPath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const held = await handle.stat({ bigint: true });
    const after = await lstat(directoryPath, { bigint: true });
    assertPrivateAuthorityMetadata(held, kind);
    if (!sameDirectoryIdentity(before, held) || !sameDirectoryIdentity(held, after)) reject();
    return { path: directoryPath, handle, stat: held };
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error instanceof BuilderCodexUatPrivateAuthorityError) throw error;
    reject();
  }
}

async function retainFile(filePath) {
  let handle;
  try {
    const before = await lstat(filePath, { bigint: true });
    assertPrivateAuthorityMetadata(before, "file");
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const held = await handle.stat({ bigint: true });
    const after = await lstat(filePath, { bigint: true });
    assertPrivateAuthorityMetadata(held, "file");
    if (!sameIdentity(before, held) || !sameIdentity(held, after)) reject();
    return { path: filePath, handle, stat: held };
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error instanceof BuilderCodexUatPrivateAuthorityError) throw error;
    reject();
  }
}

async function assertDirectoryAuthority(authority) {
  const held = await authority.handle.stat({ bigint: true });
  const current = await lstat(authority.path, { bigint: true });
  assertPrivateAuthorityMetadata(held, "safe-directory");
  if (!sameDirectoryIdentity(authority.stat, held) || !sameDirectoryIdentity(held, current)) reject();
}

function privateDirectoryEffectAuthority(authority) {
  return Object.freeze({
    path: authority.path,
    handle: authority.handle,
    identity: Object.freeze({
      device: authority.stat.dev.toString(10),
      inode: authority.stat.ino.toString(10),
      uid: authority.stat.uid.toString(10),
      gid: authority.stat.gid.toString(10),
      mode: (authority.stat.mode & 0o777n).toString(8),
    }),
  });
}

function sameEffectDirectoryIdentity(identity, stats) {
  return identity.device === stats.dev.toString(10)
    && identity.inode === stats.ino.toString(10)
    && identity.uid === stats.uid.toString(10)
    && identity.gid === stats.gid.toString(10)
    && identity.mode === (stats.mode & 0o777n).toString(8);
}

async function assertRootAuthority(authority) {
  if (!ROOT_AUTHORITIES.has(authority)) reject();
  await assertDirectoryAuthority({ path: authority.rootPath, handle: authority.handle, stat: authority.stat });
  assertPrivateAuthorityMetadata(authority.stat, "directory");
}

async function assertFileAuthority(authority) {
  const held = await authority.handle.stat({ bigint: true });
  const current = await lstat(authority.path, { bigint: true });
  assertPrivateAuthorityMetadata(held, "file");
  if (!sameIdentity(authority.stat, held) || !sameIdentity(held, current)) reject();
}

async function captureFile(authority) {
  await assertFileAuthority(authority);
  const bytes = await readExactHandle(authority.handle, Number(authority.stat.size));
  await assertFileAuthority(authority);
  return freeze({ identity: identityModel(authority.stat), rawDigest: digestRawBytes(bytes) });
}

async function readPrivateAuthority(repositoryRoot, relativeRoot, namespace) {
  const root = await retainExistingRoot(repositoryRoot);
  try {
    const authority = await readAppendOnlyAuthority({
      projectRoot: root.repositoryRoot,
      relativeRoot,
      namespace,
    });
    await assertDirectoryAuthority(root);
    return authority;
  } catch (error) {
    if (error instanceof BuilderCodexUatPrivateAuthorityError) throw error;
    reject();
  } finally {
    await root.handle.close().catch(() => {});
  }
}

async function appendPrivateAuthorityRecord({
  repositoryRoot,
  relativeRoot,
  namespace,
  idempotencyKey,
  expectedHeadDigest,
  payload,
  retainedRoot = null,
}) {
  const root = retainedRoot ?? await retainExistingRoot(repositoryRoot);
  const closeRoot = retainedRoot === null;
  try {
    if (retainedRoot === null) await assertDirectoryAuthority(root);
    else await assertRootAuthority(root);
    const result = await appendAppendOnlyRecord({
      projectRoot: root.repositoryRoot,
      relativeRoot,
      namespace,
      idempotencyKey,
      ...(expectedHeadDigest === undefined ? {} : { expectedHeadDigest }),
      payload,
    });
    if (retainedRoot === null) await assertDirectoryAuthority(root);
    else await assertRootAuthority(root);
    return result;
  } catch (error) {
    if (error instanceof BuilderCodexUatPrivateAuthorityError) throw error;
    reject();
  } finally {
    if (closeRoot) await root.handle.close().catch(() => {});
  }
}

async function loadContinuationAuthority(repositoryRoot) {
  const authority = await readPrivateAuthority(
    repositoryRoot,
    CONTINUATION_AUTHORITY_RELATIVE_ROOT,
    CONTINUATION_AUTHORITY_NAMESPACE,
  );
  if (authority.records.length === 0
    || authority.records.length > 33
    || authority.aborted.length !== 0) reject();
  const chain = [];
  for (const record of authority.records) {
    const value = record.payload;
    validateContinuation(value);
    const bytes = canonicalBytes(value, "builder-codex-uat-continuation");
    const digest = digestRawBytes(bytes);
    const previous = chain.at(-1);
    if (value.headDigest !== digestValue(
      continuationHeadBasis(value),
      "builder-codex-uat-continuation-head",
    )) reject();
    if (previous === undefined) {
      if (record.sequence !== 0 || value.sequence !== 0 || value.predecessorDigest !== null) reject();
    } else if (record.sequence !== previous.value.sequence + 1
      || value.sequence !== previous.value.sequence + 1
      || value.predecessorDigest !== previous.digest
      || !LEGAL_CONTINUATION_TRANSITIONS.get(previous.value.status)?.has(value.status)) reject();
    chain.push(Object.freeze({ record, value, digest }));
  }
  return Object.freeze({ authority, chain: Object.freeze(chain) });
}

async function createContinuationAdmission(repositoryRoot, entry) {
  const admission = Object.freeze({
    schemaVersion: CODEX_UAT_CONTINUATION_SCHEMA_VERSION,
    digest: entry.digest,
    value: freeze(entry.value),
    identity: await loadAuthorityRecordIdentity(
      repositoryRoot,
      CONTINUATION_AUTHORITY_RELATIVE_ROOT,
      entry.record.path,
      entry.record.identity,
      entry.record.digest,
    ),
  });
  CONTINUATION_ADMISSIONS.add(admission);
  return admission;
}

async function loadAuthorityRecordIdentity(
  repositoryRoot,
  relativeRoot,
  recordPath,
  expectedIdentity,
  expectedDigest,
) {
  if (!safeAuthorityRecordPath(recordPath)) reject();
  const file = await retainFile(path.join(
    repositoryRoot,
    ...relativeRoot.split("/"),
    ...recordPath.split("/"),
  ));
  try {
    if (file.stat.size <= 0n
      || file.stat.size > BigInt(MAX_AUTHORITY_BYTES)
      || file.stat.dev.toString(10) !== expectedIdentity?.device
      || file.stat.ino.toString(10) !== expectedIdentity?.inode
      || file.stat.nlink.toString(10) !== expectedIdentity?.links
      || file.stat.size.toString(10) !== expectedIdentity?.size) reject();
    const bytes = await readExactHandle(file.handle, Number(file.stat.size));
    if (digestRawBytes(bytes) !== expectedDigest) reject();
    await assertFileAuthority(file);
    return identityModel(file.stat);
  } finally {
    await file.handle.close().catch(() => {});
  }
}

function safeAuthorityRecordPath(value) {
  return typeof value === "string"
    && /^entries\/\d{16}\.[a-f0-9]{64}\.json$/u.test(value);
}

function continuationIdempotencyKey(value, digest) {
  return `continuation:${String(value.sequence).padStart(6, "0")}:${digest.slice("sha256:".length)}`;
}

async function withPrivatePublicationQueue(key, action) {
  const previous = PRIVATE_PUBLICATION_QUEUES.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(action);
  PRIVATE_PUBLICATION_QUEUES.set(key, current);
  try {
    return await current;
  } finally {
    if (PRIVATE_PUBLICATION_QUEUES.get(key) === current) {
      PRIVATE_PUBLICATION_QUEUES.delete(key);
    }
  }
}

async function assertExactJournalEntrySet(basePath, successorPath) {
  const names = await readdir(path.dirname(basePath));
  const base = path.basename(basePath);
  const prefix = `.${base}.agentmo-journal.`;
  const successorPattern = new RegExp(
    `^${prefix.replaceAll(".", "\\.")}\\d{12}-[a-f0-9]{64}\\.json$`,
    "u",
  );
  const entries = names.filter((name) => name === base || successorPattern.test(name));
  if (entries.length !== 2 || !entries.includes(base) || !entries.includes(path.basename(successorPath))) reject();
}

function assertKnownTerminal(view, expectedHeadDigest) {
  if (view.entries.length !== 2
    || view.head?.digest !== expectedHeadDigest
    || view.entries.at(-1)?.kind !== "failure"
    || view.state?.terminal !== true
    || view.state?.terminalCode !== KNOWN_PRIOR_TERMINAL_CODE) reject("AGENTMO_CODEX_UAT_PRIOR_TERMINAL_REJECTED");
}

function admitDirectFile(projectRoot, supplied) {
  if (typeof supplied !== "string" || !path.isAbsolute(supplied) || supplied.includes("\0")) reject();
  const resolved = path.resolve(supplied);
  if (resolved !== supplied || (resolved !== projectRoot && !resolved.startsWith(`${projectRoot}${path.sep}`))) reject();
  return resolved;
}

function parseLocator(input) {
  let value = input;
  if (Buffer.isBuffer(input)) {
    if (input.length === 0 || input.length > MAX_LOCATOR_BYTES) reject();
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input)); } catch { reject(); }
  }
  if (!exactKeys(value, ["projectRoot", "baseJournal", "successorEntry"])) reject();
  for (const item of Object.values(value)) {
    if (typeof item !== "string" || item.length === 0 || item.length > 4096) reject();
  }
  return Object.freeze({ ...value });
}

function identityModel(stat) {
  return freeze({
    dev: stat.dev.toString(),
    ino: stat.ino.toString(),
    uid: Number(stat.uid),
    mode: Number(stat.mode) & 0o777,
    nlink: stat.nlink.toString(),
    size: stat.size.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    ctimeNs: stat.ctimeNs.toString(),
  });
}

function validIdentity(value) {
  return exactKeys(value, ["dev", "ino", "uid", "mode", "nlink", "size", "mtimeNs", "ctimeNs"])
    && [value.dev, value.ino, value.nlink, value.size, value.mtimeNs, value.ctimeNs].every((item) => /^(?:0|[1-9][0-9]*)$/u.test(item ?? ""))
    && Number.isInteger(value.uid)
    && value.uid >= 0
    && value.mode === 0o600;
}

function sameIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.uid === right.uid
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function sameDirectoryIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.uid === right.uid
    && left.mode === right.mode;
}

function sameCapture(left, right) {
  return JSON.stringify(publicCapture(left)) === JSON.stringify(publicCapture(right));
}

function digestJournalView(view) {
  return digestValue({
    schemaVersion: view.schemaVersion,
    entries: view.entries,
    headDigest: view.head?.digest ?? null,
    state: view.state,
  }, "builder-codex-uat-prior-journal-view");
}

async function readExactHandle(handle, size) {
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_AUTHORITY_BYTES) reject();
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await handle.read(bytes, offset, size - offset, offset);
    if (!Number.isInteger(bytesRead) || bytesRead <= 0) reject();
    offset += bytesRead;
  }
  return bytes;
}

function canonicalBytes(value, subject) {
  return Buffer.from(serializePersistableJson(value, { subject, maxBytes: MAX_AUTHORITY_BYTES }), "utf8");
}

function digestValue(value, subject) {
  return digestRawBytes(canonicalBytes(value, subject));
}

function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function reject(code = "AGENTMO_CODEX_UAT_PRIVATE_AUTHORITY_REJECTED") {
  throw new BuilderCodexUatPrivateAuthorityError(code);
}
