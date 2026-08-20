#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  readFile,
  realpath,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";
import {
  assertPersistable,
  writePersistableJsonAtomic,
} from "../src/persistability.js";

export const NODE20_LANE_MARKER = "agentmo-node20-core-v2";
export const NODE20_RECEIPT_SCHEMA_VERSION = "agentmo.node20-core-lane-receipt.v1";
export const NODE20_DISTRIBUTION_TRUST_SCHEMA_VERSION = "agentmo.node20-distribution-trust.v1";

const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const VERSION_PATTERN = /^20\.[0-9]+\.[0-9]+$/u;
const ARCHITECTURE_PATTERN = /^[A-Za-z0-9_-]{1,32}$/u;
const PLATFORM_PATTERN = /^[a-z0-9_-]{1,32}$/u;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAX_CHECKSUM_BYTES = 1_048_576;
const MAX_CHILD_OUTPUT_BYTES = 1_048_576;
const CHILD_TIMEOUT_MS = 300_000;
const MODULE_PATH = fileURLToPath(import.meta.url);
const DISTRIBUTION_TRUST_URL = new URL("./node20-distribution-trust.json", import.meta.url);

const SYNTAX_FILES = [
  "bin/agentmo.js",
  "scripts/node20-core-receipt.js",
  "src/agent-idea-candidate-cli.js",
  "src/agent-idea-candidate.js",
  "src/artifact-admission.js",
  "src/artifact-migration.js",
  "src/artifact-registry.js",
  "src/artifact-subjects.js",
  "src/birth-report.js",
  "src/blueprint-draft.js",
  "src/blueprint.js",
  "src/build-plan.js",
  "src/build-state.js",
  "src/cli.js",
  "src/control-snapshot.js",
  "src/decision-entry-canonicalizer.js",
  "src/delivery-report.js",
  "src/design-plan.js",
  "src/discovery-db.js",
  "src/discovery-source-workspace.js",
  "src/discovery.js",
  "src/domain-eval.js",
  "src/evidence-audit.js",
  "src/handoff.js",
  "src/migration-filesystem.js",
  "src/observation.js",
  "src/persistability.js",
  "src/report.js",
  "src/run-observation.js",
  "src/run-state.js",
  "src/runtime-compatibility.js",
  "src/runtime-env.js",
  "src/runtime-execution.js",
  "src/runtime-plan.js",
  "src/scaffold-files.js",
  "src/scaffold.js",
  "src/secret-redaction.js",
  "src/source-refs.js",
  "src/targets/agentmo.js",
  "src/targets/openclaw.js",
  "src/targets/operations.js",
  "src/targets/registry.js",
  "src/user-need.js",
];

const CORE_TEST_FILES = [
  "test/artifact-admission.test.js",
  "test/persistability.test.js",
  "test/runtime-compatibility.test.js",
  "test/runtime-compatibility-seams.test.js",
  "test/node20-core-lane.test.js",
];

export const OWNED_COMMAND_MANIFEST = deepFreeze([
  {
    id: "syntax",
    kind: "syntax",
    files: SYNTAX_FILES,
    expected: { pass: 43, skip: 0, fail: 0, total: 43 },
  },
  {
    id: "core-contracts",
    kind: "test",
    files: CORE_TEST_FILES,
    expected: { pass: 62, skip: 1, fail: 0, total: 63 },
  },
  {
    id: "stage-contracts",
    kind: "test",
    files: ["test/stage-contracts.test.js"],
    testNamePattern: "Stage 1|Stage 2|Stage 3 handoff",
    expected: { pass: 3, skip: 2, fail: 0, total: 5 },
  },
]);

export const COMMAND_SET_DIGEST = sha256(JSON.stringify(OWNED_COMMAND_MANIFEST));

export class Node20LaneError extends Error {
  constructor(code) {
    super("Node 20 core lane rejected untrusted or incomplete evidence.");
    this.name = "Node20LaneError";
    this.code = code;
  }
}

export async function assertSelectedProcessIdentity(nodeBin) {
  if (typeof nodeBin !== "string" || !path.isAbsolute(nodeBin) || nodeBin.includes("\0")) {
    laneFail("AGENTMO_NODE20_LANE_NODE_BIN_INVALID");
  }
  let selectedRealPath;
  let processRealPath;
  try {
    selectedRealPath = await realpath(nodeBin);
    processRealPath = await realpath(process.execPath);
    if (!(await stat(nodeBin)).isFile()) laneFail("AGENTMO_NODE20_LANE_NODE_BIN_INVALID");
  } catch {
    laneFail("AGENTMO_NODE20_LANE_NODE_BIN_INVALID");
  }
  if (selectedRealPath !== nodeBin) {
    laneFail("AGENTMO_NODE20_LANE_NODE_BIN_NOT_CANONICAL");
  }
  if (processRealPath !== selectedRealPath) {
    laneFail("AGENTMO_NODE20_LANE_PROCESS_EXECUTABLE_MISMATCH");
  }
  return true;
}

export async function selectApprovedDistribution({ version, platform, architecture }) {
  if (!VERSION_PATTERN.test(version ?? "")
    || !PLATFORM_PATTERN.test(platform ?? "")
    || !ARCHITECTURE_PATTERN.test(architecture ?? "")) {
    laneFail("AGENTMO_NODE20_LANE_TRUST_SELECTOR_INVALID");
  }
  let trust;
  try {
    trust = JSON.parse(await readFile(DISTRIBUTION_TRUST_URL, "utf8"));
  } catch {
    laneFail("AGENTMO_NODE20_LANE_TRUST_ANCHOR_INVALID");
  }
  assertDistributionTrust(trust);
  const matches = trust.distributions.filter((candidate) => candidate.version === version
    && candidate.platform === platform
    && candidate.architecture === architecture);
  if (matches.length === 0) laneFail("AGENTMO_NODE20_LANE_TRUST_ANCHOR_NOT_FOUND");
  if (matches.length !== 1) laneFail("AGENTMO_NODE20_LANE_TRUST_ANCHOR_AMBIGUOUS");
  return deepFreeze({ ...matches[0] });
}

export async function verifyDistributionProvenance({
  nodeBin,
  archive,
  checksums,
  expectedVersion,
  expectedPlatform = process.platform,
  expectedArch,
}) {
  const anchor = await selectApprovedDistribution({
    version: expectedVersion,
    platform: expectedPlatform,
    architecture: expectedArch,
  });
  await Promise.all([
    assertRegularFile(nodeBin, "AGENTMO_NODE20_LANE_NODE_BIN_INVALID"),
    assertRegularFile(archive, "AGENTMO_NODE20_LANE_ARCHIVE_INVALID"),
    assertRegularFile(checksums, "AGENTMO_NODE20_LANE_CHECKSUMS_INVALID", MAX_CHECKSUM_BYTES),
  ]);
  const archiveName = path.basename(archive);
  if (archiveName !== anchor.archiveName) trustAnchorMismatch();
  const checksumBytes = await readFile(checksums);
  const checksumManifestSha256 = sha256(checksumBytes);
  if (checksumManifestSha256 !== anchor.checksumManifestSha256) trustAnchorMismatch();
  const checksumEntrySha256 = exactChecksumEntry(checksumBytes.toString("utf8"), archiveName);
  const archiveSha256 = await hashFile(archive);
  if (archiveSha256 !== anchor.archiveSha256
    || checksumEntrySha256 !== anchor.archiveSha256
    || archiveSha256 !== checksumEntrySha256) trustAnchorMismatch();
  const archiveMember = anchor.archiveMember;
  const archiveMemberSha256 = await hashTarGzipMember(archive, archiveMember);
  const executableSha256 = await hashFile(nodeBin);
  if (archiveMemberSha256 !== anchor.archiveMemberSha256
    || executableSha256 !== anchor.executableSha256
    || archiveMemberSha256 !== executableSha256) trustAnchorMismatch();
  return {
    archiveName,
    archiveSha256,
    checksumManifestSha256,
    checksumEntrySha256,
    archiveMember,
    archiveMemberSha256,
    executableSha256,
    executableMatchesArchiveMember: true,
  };
}

export function validateTapBatch(tap, expected) {
  assertExactCounts(expected, "AGENTMO_NODE20_LANE_TAP_EXPECTATION_INVALID");
  if (typeof tap !== "string" || Buffer.byteLength(tap) > MAX_CHILD_OUTPUT_BYTES) {
    laneFail("AGENTMO_NODE20_LANE_TAP_SUMMARY_MISSING");
  }
  const total = parseSingleTapMetric(tap, "tests");
  const pass = parseSingleTapMetric(tap, "pass");
  const fail = parseSingleTapMetric(tap, "fail");
  const cancelled = parseSingleTapMetric(tap, "cancelled");
  const skip = parseSingleTapMetric(tap, "skipped");
  const todo = parseSingleTapMetric(tap, "todo");
  if ([total, pass, fail, cancelled, skip, todo].some((value) => value === null)) {
    laneFail("AGENTMO_NODE20_LANE_TAP_SUMMARY_MISSING");
  }
  if (total === 0 || pass === 0) {
    laneFail("AGENTMO_NODE20_LANE_TAP_ZERO_MATCH");
  }
  if (fail !== 0 || cancelled !== 0 || todo !== 0) {
    laneFail("AGENTMO_NODE20_LANE_TAP_FAILURE");
  }
  if (total !== pass + fail + cancelled + skip + todo) {
    laneFail("AGENTMO_NODE20_LANE_TAP_COUNT_MISMATCH");
  }
  const actual = { pass, skip, fail, total };
  if (!sameCounts(actual, expected)) {
    laneFail("AGENTMO_NODE20_LANE_TAP_COUNT_MISMATCH");
  }
  return actual;
}

export function buildNode20Receipt({
  observedAt,
  runtime,
  provenance,
  commandSetDigest,
  batches,
}) {
  const receipt = {
    schemaVersion: NODE20_RECEIPT_SCHEMA_VERSION,
    status: "tested",
    observedAt,
    runtime,
    provenance,
    commandSetDigest,
    batches,
    certificationBoundary: {
      runtimeEvidenceCertifiesDomainQuality: false,
      runtimeEvidenceApprovesProduction: false,
      runtimeEvidenceCertifiesWiderOpenClaw: false,
    },
  };
  assertNode20Receipt(receipt);
  return receipt;
}

export function assertNode20Receipt(receipt) {
  assertPublishedNode20Receipt(receipt);
  if (receipt.commandSetDigest !== COMMAND_SET_DIGEST) receiptInvalid();
  if (receipt.batches.length !== OWNED_COMMAND_MANIFEST.length
    || receipt.batches.some((batch, index) => !isReceiptBatch(batch, OWNED_COMMAND_MANIFEST[index]))) receiptInvalid();
  return receipt;
}

export async function readNode20Receipt(receiptPath) {
  await assertRegularFile(receiptPath, "AGENTMO_NODE20_LANE_RECEIPT_INVALID", MAX_CHECKSUM_BYTES);
  let receipt;
  try {
    receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  } catch (error) {
    if (error instanceof Node20LaneError) throw error;
    receiptInvalid();
  }
  return assertNode20Receipt(receipt);
}

function assertPublishedNode20Receipt(receipt) {
  if (!isPlainObject(receipt) || !hasExactKeys(receipt, [
    "schemaVersion",
    "status",
    "observedAt",
    "runtime",
    "provenance",
    "commandSetDigest",
    "batches",
    "certificationBoundary",
  ])) receiptInvalid();
  if (receipt.schemaVersion !== NODE20_RECEIPT_SCHEMA_VERSION || receipt.status !== "tested") receiptInvalid();
  if (typeof receipt.observedAt !== "string"
    || !ISO_TIMESTAMP_PATTERN.test(receipt.observedAt)
    || new Date(receipt.observedAt).toISOString() !== receipt.observedAt) receiptInvalid();
  if (!isPlainObject(receipt.runtime) || !hasExactKeys(receipt.runtime, [
    "version",
    "architecture",
    "processExecPathMatchesSelectedExecutable",
  ])) receiptInvalid();
  if (!VERSION_PATTERN.test(receipt.runtime.version)
    || !ARCHITECTURE_PATTERN.test(receipt.runtime.architecture)
    || receipt.runtime.processExecPathMatchesSelectedExecutable !== true) receiptInvalid();
  assertProvenanceShape(receipt.provenance);
  if (!DIGEST_PATTERN.test(receipt.commandSetDigest)) receiptInvalid();
  if (!Array.isArray(receipt.batches)
    || receipt.batches.length !== 3
    || receipt.batches.some((batch, index) => !isPublishedReceiptBatch(batch, index))) receiptInvalid();
  if (!isPlainObject(receipt.certificationBoundary)
    || !hasExactKeys(receipt.certificationBoundary, [
      "runtimeEvidenceCertifiesDomainQuality",
      "runtimeEvidenceApprovesProduction",
      "runtimeEvidenceCertifiesWiderOpenClaw",
    ])
    || Object.values(receipt.certificationBoundary).some((value) => value !== false)) receiptInvalid();
  try {
    assertPersistable(receipt, { subject: "node20-core-lane-receipt" });
  } catch {
    receiptInvalid();
  }
  return receipt;
}

async function runLane(options) {
  await assertReceiptAbsent(options.receipt);
  assertExpectedRuntime(options.expectedVersion, options.expectedArch);
  await assertSelectedProcessIdentity(options.nodeBin);
  if (process.versions.node !== options.expectedVersion || process.arch !== options.expectedArch) {
    laneFail("AGENTMO_NODE20_LANE_RUNTIME_IDENTITY_MISMATCH");
  }
  const provenance = await verifyDistributionProvenance({
    ...options,
    expectedPlatform: process.platform,
  });
  const batches = await runOwnedCommandSet(options.repositoryRoot, {
    expectedVersion: options.expectedVersion,
    expectedArch: options.expectedArch,
    executableSha256: provenance.executableSha256,
  });
  const receipt = buildNode20Receipt({
    observedAt: new Date().toISOString(),
    runtime: {
      version: process.versions.node,
      architecture: process.arch,
      processExecPathMatchesSelectedExecutable: true,
    },
    provenance,
    commandSetDigest: COMMAND_SET_DIGEST,
    batches,
  });
  await writePersistableJsonAtomic(options.receipt, receipt, {
    subject: "node20-core-lane-receipt",
  });
  process.stdout.write(`${JSON.stringify({
    schemaVersion: receipt.schemaVersion,
    status: receipt.status,
    runtime: receipt.runtime,
    commandSetDigest: receipt.commandSetDigest,
    batches: receipt.batches,
  })}\n`);
}

async function runOwnedCommandSet(repositoryRoot, identity) {
  const environment = childEnvironment(identity);
  const batches = [];
  for (const batch of OWNED_COMMAND_MANIFEST) {
    if (batch.kind === "syntax") {
      let passed = 0;
      for (const file of batch.files) {
        await runChild(["--check", file], repositoryRoot, environment);
        passed += 1;
      }
      const counts = { pass: passed, skip: 0, fail: 0, total: passed };
      if (!sameCounts(counts, batch.expected)) {
        laneFail("AGENTMO_NODE20_LANE_SYNTAX_COUNT_MISMATCH");
      }
      batches.push({ id: batch.id, ...counts });
      continue;
    }
    const argumentsList = ["--test", "--test-reporter=tap"];
    if (batch.testNamePattern) argumentsList.push(`--test-name-pattern=${batch.testNamePattern}`);
    argumentsList.push(...batch.files);
    const result = await runChild(argumentsList, repositoryRoot, environment);
    batches.push({ id: batch.id, ...validateTapBatch(result.stdout, batch.expected) });
  }
  return batches;
}

function childEnvironment(identity) {
  const environment = {};
  for (const key of ["HOME", "LANG", "LC_ALL", "PATH", "TEMP", "TMP", "TMPDIR", "TZ"]) {
    if (typeof process.env[key] === "string") environment[key] = process.env[key];
  }
  return {
    ...environment,
    AGENTMO_NODE20_CORE_LANE: NODE20_LANE_MARKER,
    AGENTMO_NODE20_EXPECTED_VERSION: identity.expectedVersion,
    AGENTMO_NODE20_EXPECTED_ARCH: identity.expectedArch,
    AGENTMO_NODE20_EXECUTABLE_SHA256: identity.executableSha256,
    AGENTMO_NODE20_COMMAND_SET_DIGEST: COMMAND_SET_DIGEST,
    AGENTMO_NODE20_PROCESS_EXECUTABLE_MATCH: "true",
  };
}

function runChild(argumentsList, cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, argumentsList, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let outputExceeded = false;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, CHILD_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_CHILD_OUTPUT_BYTES) {
        outputExceeded = true;
        child.kill("SIGKILL");
      } else stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_CHILD_OUTPUT_BYTES) {
        outputExceeded = true;
        child.kill("SIGKILL");
      } else stderr.push(chunk);
    });
    child.once("error", () => {
      clearTimeout(timeout);
      reject(new Node20LaneError("AGENTMO_NODE20_LANE_CHILD_START_FAILED"));
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      if (timedOut) return reject(new Node20LaneError("AGENTMO_NODE20_LANE_CHILD_TIMEOUT"));
      if (outputExceeded) return reject(new Node20LaneError("AGENTMO_NODE20_LANE_CHILD_OUTPUT_LIMIT"));
      if (code !== 0 || signal !== null) return reject(new Node20LaneError("AGENTMO_NODE20_LANE_CHILD_FAILED"));
      return resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

async function hashTarGzipMember(archive, expectedMember) {
  let pending = Buffer.alloc(0);
  let remaining = 0;
  let padding = 0;
  let targetHasher = null;
  let targetDigest = null;
  let targetMatches = 0;
  let endSeen = false;
  try {
    const stream = createReadStream(archive).pipe(createGunzip());
    for await (const chunk of stream) {
      if (endSeen) continue;
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      while (pending.length > 0 && !endSeen) {
        if (remaining > 0) {
          const length = Math.min(remaining, pending.length);
          if (targetHasher) targetHasher.update(pending.subarray(0, length));
          pending = pending.subarray(length);
          remaining -= length;
          if (remaining === 0 && targetHasher) {
            targetDigest = targetHasher.digest("hex");
            targetHasher = null;
          }
          continue;
        }
        if (padding > 0) {
          const length = Math.min(padding, pending.length);
          pending = pending.subarray(length);
          padding -= length;
          continue;
        }
        if (pending.length < 512) break;
        const header = pending.subarray(0, 512);
        pending = pending.subarray(512);
        if (header.every((byte) => byte === 0)) {
          endSeen = true;
          break;
        }
        assertTarHeaderChecksum(header);
        const name = tarMemberName(header);
        const size = parseTarOctal(header.subarray(124, 136));
        const type = header[156];
        remaining = size;
        padding = (512 - (size % 512)) % 512;
        if (name === expectedMember) {
          if (type !== 0 && type !== 0x30) laneFail("AGENTMO_NODE20_LANE_ARCHIVE_MEMBER_INVALID");
          targetMatches += 1;
          if (targetMatches !== 1) laneFail("AGENTMO_NODE20_LANE_ARCHIVE_MEMBER_DUPLICATE");
          targetHasher = createHash("sha256");
          if (size === 0) {
            targetDigest = targetHasher.digest("hex");
            targetHasher = null;
          }
        }
      }
    }
  } catch (error) {
    if (error instanceof Node20LaneError) throw error;
    laneFail("AGENTMO_NODE20_LANE_ARCHIVE_INVALID");
  }
  if (!endSeen || remaining !== 0 || padding !== 0) laneFail("AGENTMO_NODE20_LANE_ARCHIVE_INVALID");
  if (targetMatches !== 1 || !DIGEST_PATTERN.test(targetDigest ?? "")) {
    laneFail("AGENTMO_NODE20_LANE_ARCHIVE_MEMBER_MISSING");
  }
  return targetDigest;
}

function assertTarHeaderChecksum(header) {
  const stored = parseTarOctal(header.subarray(148, 156));
  const copy = Buffer.from(header);
  copy.fill(0x20, 148, 156);
  const actual = copy.reduce((sum, byte) => sum + byte, 0);
  if (stored !== actual) laneFail("AGENTMO_NODE20_LANE_ARCHIVE_INVALID");
}

function tarMemberName(header) {
  const name = nullTerminatedAscii(header.subarray(0, 100));
  const prefix = nullTerminatedAscii(header.subarray(345, 500));
  return prefix ? `${prefix}/${name}` : name;
}

function nullTerminatedAscii(buffer) {
  const end = buffer.indexOf(0);
  const value = buffer.subarray(0, end === -1 ? buffer.length : end).toString("utf8");
  if (value.includes("\0")) laneFail("AGENTMO_NODE20_LANE_ARCHIVE_INVALID");
  return value;
}

function parseTarOctal(buffer) {
  const text = buffer.toString("ascii").replace(/\0.*$/su, "").trim();
  if (!/^[0-7]+$/u.test(text)) laneFail("AGENTMO_NODE20_LANE_ARCHIVE_INVALID");
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) laneFail("AGENTMO_NODE20_LANE_ARCHIVE_INVALID");
  return value;
}

function exactChecksumEntry(source, archiveName) {
  const matches = [];
  for (const line of source.split(/\r?\n/u)) {
    const match = /^([a-f0-9]{64})\s+\*?([^\r\n]+)$/u.exec(line);
    if (match && match[2] === archiveName) matches.push(match[1]);
  }
  if (matches.length !== 1) laneFail("AGENTMO_NODE20_LANE_CHECKSUM_ENTRY_INVALID");
  return matches[0];
}

async function assertRegularFile(candidate, code, maximumBytes = Number.MAX_SAFE_INTEGER) {
  if (typeof candidate !== "string" || candidate.length === 0 || candidate.includes("\0")) laneFail(code);
  let metadata;
  try {
    metadata = await stat(candidate);
  } catch {
    laneFail(code);
  }
  if (!metadata.isFile() || metadata.size > maximumBytes) laneFail(code);
}

async function hashFile(candidate) {
  const hash = createHash("sha256");
  try {
    for await (const chunk of createReadStream(candidate)) hash.update(chunk);
  } catch {
    laneFail("AGENTMO_NODE20_LANE_FILE_READ_FAILED");
  }
  return hash.digest("hex");
}

async function assertReceiptAbsent(receipt) {
  if (typeof receipt !== "string" || receipt.length === 0 || receipt.includes("\0")) {
    laneFail("AGENTMO_NODE20_LANE_RECEIPT_PATH_INVALID");
  }
  try {
    await lstat(receipt);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    laneFail("AGENTMO_NODE20_LANE_RECEIPT_PATH_INVALID");
  }
  laneFail("AGENTMO_NODE20_LANE_RECEIPT_EXISTS");
}

function assertExpectedRuntime(version, architecture) {
  if (typeof version !== "string" || !VERSION_PATTERN.test(version)) {
    laneFail("AGENTMO_NODE20_LANE_EXPECTED_VERSION_INVALID");
  }
  if (typeof architecture !== "string" || !ARCHITECTURE_PATTERN.test(architecture)) {
    laneFail("AGENTMO_NODE20_LANE_EXPECTED_ARCH_INVALID");
  }
}

function assertDistributionTrust(trust) {
  const entryKeys = [
    "version",
    "platform",
    "architecture",
    "archiveName",
    "archiveSha256",
    "checksumManifestSha256",
    "archiveMember",
    "archiveMemberSha256",
    "executableSha256",
  ];
  if (!isPlainObject(trust)
    || !hasExactKeys(trust, ["schemaVersion", "distributions"])
    || trust.schemaVersion !== NODE20_DISTRIBUTION_TRUST_SCHEMA_VERSION
    || !Array.isArray(trust.distributions)
    || trust.distributions.length === 0) trustAnchorInvalid();
  const selectors = new Set();
  for (const entry of trust.distributions) {
    if (!isPlainObject(entry)
      || !hasExactKeys(entry, entryKeys)
      || !VERSION_PATTERN.test(entry.version)
      || !PLATFORM_PATTERN.test(entry.platform)
      || !ARCHITECTURE_PATTERN.test(entry.architecture)) trustAnchorInvalid();
    const archiveStem = `node-v${entry.version}-${entry.platform}-${entry.architecture}`;
    if (entry.archiveName !== `${archiveStem}.tar.gz`
      || entry.archiveMember !== `${archiveStem}/bin/node`
      || !DIGEST_PATTERN.test(entry.archiveSha256)
      || !DIGEST_PATTERN.test(entry.checksumManifestSha256)
      || !DIGEST_PATTERN.test(entry.archiveMemberSha256)
      || !DIGEST_PATTERN.test(entry.executableSha256)
      || entry.archiveMemberSha256 !== entry.executableSha256) trustAnchorInvalid();
    const selector = `${entry.version}\0${entry.platform}\0${entry.architecture}`;
    if (selectors.has(selector)) laneFail("AGENTMO_NODE20_LANE_TRUST_ANCHOR_AMBIGUOUS");
    selectors.add(selector);
  }
}

function assertProvenanceShape(provenance) {
  if (!isPlainObject(provenance) || !hasExactKeys(provenance, [
    "archiveName",
    "archiveSha256",
    "checksumManifestSha256",
    "checksumEntrySha256",
    "archiveMember",
    "archiveMemberSha256",
    "executableSha256",
    "executableMatchesArchiveMember",
  ])) receiptInvalid();
  if (typeof provenance.archiveName !== "string"
    || !/^[A-Za-z0-9._-]+\.tar\.gz$/u.test(provenance.archiveName)
    || provenance.archiveMember !== `${provenance.archiveName.slice(0, -".tar.gz".length)}/bin/node`
    || !DIGEST_PATTERN.test(provenance.archiveSha256)
    || !DIGEST_PATTERN.test(provenance.checksumManifestSha256)
    || !DIGEST_PATTERN.test(provenance.checksumEntrySha256)
    || !DIGEST_PATTERN.test(provenance.archiveMemberSha256)
    || !DIGEST_PATTERN.test(provenance.executableSha256)
    || provenance.archiveSha256 !== provenance.checksumEntrySha256
    || provenance.archiveMemberSha256 !== provenance.executableSha256
    || provenance.executableMatchesArchiveMember !== true) receiptInvalid();
}

function isReceiptBatch(batch, manifestBatch) {
  if (!isPlainObject(batch) || !hasExactKeys(batch, ["id", "pass", "skip", "fail", "total"])) return false;
  const counts = {
    pass: batch.pass,
    skip: batch.skip,
    fail: batch.fail,
    total: batch.total,
  };
  return batch.id === manifestBatch.id
    && [counts.pass, counts.skip, counts.fail, counts.total]
      .every((item) => Number.isSafeInteger(item) && item >= 0)
    && counts.total === counts.pass + counts.skip + counts.fail
    && sameCounts(counts, manifestBatch.expected);
}

function isPublishedReceiptBatch(batch, index) {
  const expectedIds = ["syntax", "core-contracts", "stage-contracts"];
  if (!isPlainObject(batch) || !hasExactKeys(batch, ["id", "pass", "skip", "fail", "total"])) return false;
  const counts = [batch.pass, batch.skip, batch.fail, batch.total];
  return batch.id === expectedIds[index]
    && counts.every((item) => Number.isSafeInteger(item) && item >= 0)
    && batch.pass > 0
    && batch.fail === 0
    && batch.total === batch.pass + batch.skip + batch.fail;
}

function assertExactCounts(value, code) {
  if (!isPlainObject(value)
    || !hasExactKeys(value, ["pass", "skip", "fail", "total"])
    || [value.pass, value.skip, value.fail, value.total].some((item) => !Number.isSafeInteger(item) || item < 0)
    || value.total !== value.pass + value.skip + value.fail) laneFail(code);
}

function sameCounts(left, right) {
  return left.pass === right.pass
    && left.skip === right.skip
    && left.fail === right.fail
    && left.total === right.total;
}

function parseSingleTapMetric(source, label) {
  const pattern = new RegExp(`^# ${label} ([0-9]+)$`, "gmu");
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) return null;
  const value = Number(matches[0][1]);
  return Number.isSafeInteger(value) ? value : null;
}

function hasExactKeys(value, keys) {
  return Object.keys(value).length === keys.length && keys.every((key, index) => Object.keys(value)[index] === key);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function receiptInvalid() {
  laneFail("AGENTMO_NODE20_LANE_RECEIPT_INVALID");
}

function trustAnchorInvalid() {
  laneFail("AGENTMO_NODE20_LANE_TRUST_ANCHOR_INVALID");
}

function trustAnchorMismatch() {
  laneFail("AGENTMO_NODE20_LANE_TRUST_ANCHOR_MISMATCH");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function laneFail(code) {
  throw new Node20LaneError(code);
}

function parseCliArguments(argumentsList) {
  const expectedFlags = new Set([
    "--repository-root",
    "--node-bin",
    "--archive",
    "--checksums",
    "--expected-version",
    "--expected-arch",
    "--receipt",
  ]);
  const parsed = {};
  if (argumentsList.length !== expectedFlags.size * 2) laneFail("AGENTMO_NODE20_LANE_ARGUMENTS_INVALID");
  for (let index = 0; index < argumentsList.length; index += 2) {
    const flag = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!expectedFlags.has(flag) || Object.hasOwn(parsed, flag) || typeof value !== "string" || value.length === 0) {
      laneFail("AGENTMO_NODE20_LANE_ARGUMENTS_INVALID");
    }
    parsed[flag] = value;
  }
  return {
    repositoryRoot: parsed["--repository-root"],
    nodeBin: parsed["--node-bin"],
    archive: parsed["--archive"],
    checksums: parsed["--checksums"],
    expectedVersion: parsed["--expected-version"],
    expectedArch: parsed["--expected-arch"],
    receipt: parsed["--receipt"],
  };
}

async function assertRepositoryRoot(repositoryRoot) {
  if (typeof repositoryRoot !== "string" || !path.isAbsolute(repositoryRoot)) {
    laneFail("AGENTMO_NODE20_LANE_REPOSITORY_ROOT_INVALID");
  }
  let supplied;
  let owned;
  try {
    supplied = await realpath(repositoryRoot);
    owned = await realpath(fileURLToPath(new URL("../", import.meta.url)));
  } catch {
    laneFail("AGENTMO_NODE20_LANE_REPOSITORY_ROOT_INVALID");
  }
  if (repositoryRoot !== supplied || supplied !== owned) {
    laneFail("AGENTMO_NODE20_LANE_REPOSITORY_ROOT_INVALID");
  }
}

async function main() {
  const options = parseCliArguments(process.argv.slice(2));
  await assertRepositoryRoot(options.repositoryRoot);
  await runLane(options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(MODULE_PATH)) {
  main().catch((error) => {
    const code = error instanceof Node20LaneError
      ? error.code
      : "AGENTMO_NODE20_LANE_INTERNAL_ERROR";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
