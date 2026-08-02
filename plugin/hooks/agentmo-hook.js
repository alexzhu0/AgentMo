#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as FS_CONSTANTS } from "node:fs";
import {
  lstat,
  open,
  readlink,
  readdir,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MAX_INPUT_BYTES = 64 * 1024;
const MAX_CHILD_OUTPUT_BYTES = 16 * 1024;
const MAX_RECEIPT_BYTES = 256 * 1024;
const MAX_BOUND_MEMBER_BYTES = 256 * 1024;
const MAX_BOUND_MEMBERS = 512;
const MAX_CAPTURED_RELEASE_BYTES = 16 * 1024 * 1024;
const MAX_BOOTSTRAP_GRAPH_BYTES = 24 * 1024 * 1024;
const MAX_AUTHORITY_BYTES = 1024 * 1024;
const MAX_AUTHORITY_RECORDS = 256;
const CHILD_TIMEOUT_MS = 60_000;
const CHILD_TIMEOUT_SETTLEMENT_GRACE_MS = 1_000;
const EVENTS = new Set(["SessionStart", "PreCompact", "PostCompact"]);
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const PROPOSAL_STAGES = new Set(["discover", "plan", "produce", "complete"]);
const MARKETPLACE_SELECTOR = Object.freeze({
  pluginId: "agentmo@agentmo-local",
  pluginName: "agentmo",
  marketplaceName: "agentmo-local",
});
const PROJECT_RECEIPT_PATH = ".agentmo/builder/install-receipt.json";
const PROJECT_MARKER_PATH = ".agentmo/builder/install-marker.json";
const LIFECYCLE_AUTHORITY_PATH = ".agentmo/builder/lifecycle-authority";
const LIFECYCLE_NAMESPACE = "builder-lifecycle";
const INSTALL_ATTEMPT_AUTHORITY_PATH = ".agentmo-install-attempt-authority";
const INSTALL_ATTEMPT_NAMESPACE = "builder-install";
const HOST_AUTHORITY_PATH = ".codex-selector-state-authority";
const HOST_AUTHORITY_NAMESPACE = "codex-selector-state";
const LINEAGE_ANCHOR_DIRECTORY = ".agentmo-append-only-lineage";
const LINEAGE_PROVISION_DIRECTORY = ".agentmo-append-only-provisioning";
const ROOT_WITNESS_DIRECTORY = ".agentmo-root-witness";
const RUNNER_RELATIVE_PATH = "plugins/agentmo/hooks/agentmo-hook.js";
const LAUNCHER_RELATIVE_PATH = "plugins/agentmo/runtime/agentmo/bin/agentmo.js";
const AUTHENTICATED_BOOTSTRAP_LOADER_SOURCE = String.raw`
import { createHash } from "node:crypto";
import { createReadStream, fstatSync } from "node:fs";

const reject = () => {
  throw new Error("Authenticated bootstrap graph rejected.");
};
const exactKeys = (value, keys) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
};
const descriptorStats = fstatSync(3);
if (!descriptorStats.isFIFO() && !descriptorStats.isSocket()) reject();
const chunks = [];
let total = 0;
for await (const chunk of createReadStream(null, { fd: 3, autoClose: false })) {
  total += chunk.byteLength;
  if (total > 24 * 1024 * 1024) reject();
  chunks.push(chunk);
}
const raw = Buffer.concat(chunks, total);
const expected = process.env.AGENTMO_BUILDER_HOOK_GRAPH_DIGEST;
const observed = "sha256:" + createHash("sha256").update(raw).digest("hex");
if (!/^sha256:[a-f0-9]{64}$/u.test(expected ?? "") || observed !== expected) reject();
let graph;
try {
  graph = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
} catch {
  reject();
}
if (!exactKeys(graph, [
  "schemaVersion", "receiptDigest", "runnerDigest", "marketplaceRoot", "entries",
])
  || graph.schemaVersion !== "agentmo.builder-bootstrap-graph.v1"
  || !Array.isArray(graph.entries)
  || graph.entries.length < 2
  || graph.entries.length > 512) {
  reject();
}
const modules = new Map();
for (const entry of graph.entries) {
  if (!exactKeys(entry, [
    "relativePath", "url", "digest", "byteLength", "format", "source",
  ])
    || typeof entry.url !== "string"
    || !entry.url.startsWith("file:")
    || !["module", "json", "asset"].includes(entry.format)
    || !Number.isSafeInteger(entry.byteLength)
    || entry.byteLength < 0
    || typeof entry.source !== "string") {
    reject();
  }
  const source = Buffer.from(entry.source, "base64");
  if (source.byteLength !== entry.byteLength
    || source.toString("base64") !== entry.source
    || "sha256:" + createHash("sha256").update(source).digest("hex") !== entry.digest
    || modules.has(entry.url)) {
    reject();
  }
  modules.set(entry.url, Object.freeze({ format: entry.format, source }));
}
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("node:")) return nextResolve(specifier, context);
  let url;
  try {
    url = context.parentURL === undefined
      ? new URL(specifier).href
      : new URL(specifier, context.parentURL).href;
  } catch {
    reject();
  }
  if (!modules.has(url)) reject();
  return { url, shortCircuit: true };
}
export async function load(url, context, nextLoad) {
  if (url.startsWith("node:")) return nextLoad(url, context);
  const entry = modules.get(url);
  if (!entry || entry.format === "asset") reject();
  return {
    format: entry.format,
    source: entry.source,
    shortCircuit: true,
  };
}
`;
const MANAGED_PROJECT_FILES = Object.freeze([
  Object.freeze({ relativePath: ".agentmo/builder/install-marker.json", ownership: "exclusive-marker" }),
  Object.freeze({ relativePath: ".codex/agents/agentmo.toml", ownership: "exclusive-project-agent" }),
]);
const ACTIVATION_OPERATION_ORDER = Object.freeze([
  "projection-publication",
  "projection-observation",
  "marketplace-add-if-absent",
  "marketplace-reobservation",
  "plugin-add-if-absent",
  "selector-visibility-observation",
  "owner-publication",
  "consumer-publication",
  "project-receipt-last",
]);
const ACTIVATION_POST_OBSERVATION = Object.freeze({
  installation: "installed",
  enabled: true,
  sourceMatch: true,
  releaseMatch: true,
  skillVisibility: "visible",
  hooksVisibility: "visible",
  trust: "trusted-or-pending-human",
  agentHostVisibility: "unobservable",
});

async function readInput() {
  const chunks = [];
  let total = 0;
  for await (const rawChunk of process.stdin) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    total += chunk.byteLength;
    if (total > MAX_INPUT_BYTES) fail();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

function exactEventName(payload) {
  const value = payload?.hook_event_name;
  return EVENTS.has(value) ? value : null;
}

function assertBootstrapPlatform() {
  if (![
    "darwin",
    "linux",
  ].includes(process.platform)
    || typeof process.getuid !== "function"
    || !Number.isSafeInteger(process.getuid())
    || process.getuid() < 0
    || !Number.isInteger(FS_CONSTANTS.O_NOFOLLOW)
    || FS_CONSTANTS.O_NOFOLLOW === 0
    || !Number.isInteger(FS_CONSTANTS.O_DIRECTORY)
    || FS_CONSTANTS.O_DIRECTORY === 0) {
    fail();
  }
}

async function installedPaths() {
  assertBootstrapPlatform();
  const requestedRunnerPath = path.resolve(process.argv[1]);
  const requestedRunnerStats = await lstat(requestedRunnerPath, { bigint: true });
  if (requestedRunnerStats.isSymbolicLink() || !requestedRunnerStats.isFile()) fail();
  const runnerPath = await realpath(requestedRunnerPath);
  if (path.basename(runnerPath) !== "agentmo-hook.js" || path.basename(path.dirname(runnerPath)) !== "hooks") {
    fail();
  }
  const pluginRoot = path.resolve(path.dirname(runnerPath), "..");
  const stateRoot = path.resolve(pluginRoot, "..", "..", "..", "..");
  if (pluginRoot !== path.join(
    stateRoot,
    "marketplace",
    "agentmo-local",
    "plugins",
    "agentmo",
  )) fail();
  const projectRoot = await realpath(path.resolve(process.cwd()));
  const [runnerStats, projectStats, canonicalRunner] = await Promise.all([
    lstat(runnerPath, { bigint: true }),
    lstat(projectRoot, { bigint: true }),
    realpath(runnerPath),
  ]);
  if (runnerStats.isSymbolicLink() || !runnerStats.isFile() || canonicalRunner !== runnerPath
    || projectStats.isSymbolicLink() || !projectStats.isDirectory()) {
    fail();
  }
  return { projectRoot, projectStats, runnerPath, stateRoot };
}

async function admitBootstrapRelease(paths) {
  // The host-installed hook file is the bootstrap trust seed and must already
  // be protected by host installation integrity. This admission prevents
  // pathname replacement of every downstream runtime module after that seed
  // has begun executing; it cannot retroactively authenticate its own load.
  const receiptPath = path.join(paths.projectRoot, ...PROJECT_RECEIPT_PATH.split("/"));
  const receiptBytes = await readBoundedFile(paths.projectRoot, receiptPath, MAX_RECEIPT_BYTES);
  const receiptDigest = digest(receiptBytes);
  const receipt = parseReceipt(receiptBytes, paths.projectRoot, paths.projectStats);
  await assertReceiptAnchors({
    paths,
    receipt,
    receiptDigest,
  });
  const binding = receipt.hostActivation.finalProjectionBinding;
  const marketplaceRoot = path.join(paths.stateRoot, "marketplace", "agentmo-local");
  const files = await captureBoundProjectionFiles(marketplaceRoot, binding);
  const runner = files.get(RUNNER_RELATIVE_PATH);
  const launcher = files.get(LAUNCHER_RELATIVE_PATH);
  if (runner === undefined || launcher === undefined) fail();
  const runnerPath = path.join(marketplaceRoot, ...RUNNER_RELATIVE_PATH.split("/"));
  if (runnerPath !== paths.runnerPath) fail();
  const graph = buildAuthenticatedBootstrapGraph({
    files,
    marketplaceRoot,
    receiptDigest,
    runnerDigest: runner.digest,
  });
  return {
    graph,
    launcherPath: path.join(marketplaceRoot, ...LAUNCHER_RELATIVE_PATH.split("/")),
    projectRoot: paths.projectRoot,
    runnerDigest: runner.digest,
  };
}

async function captureBoundProjectionFiles(marketplaceRoot, binding) {
  const members = binding.members;
  if (!Array.isArray(members) || members.length < 2 || members.length > MAX_BOUND_MEMBERS) fail();
  const memberByPath = new Map();
  let filesStart = -1;
  let totalBytes = 0;
  for (const [index, member] of members.entries()) {
    validateBoundMember(member, index);
    if (memberByPath.has(member.relativePath)) fail();
    memberByPath.set(member.relativePath, member);
    if (member.kind === "file" && filesStart === -1) filesStart = index;
    if (member.kind === "file") {
      const size = BigInt(member.identity.size);
      if (size > BigInt(MAX_BOUND_MEMBER_BYTES)) fail();
      totalBytes += Number(size);
      if (totalBytes > MAX_CAPTURED_RELEASE_BYTES) fail();
    }
  }
  if (filesStart < 1
    || members.slice(1, filesStart).some((member) => member.kind !== "directory")
    || members.slice(filesStart).some((member) => member.kind !== "file")) fail();
  const root = members[0];
  if (root.kind !== "root" || root.relativePath !== "" || JSON.stringify(root.identity) !== JSON.stringify(binding.rootIdentity)) {
    fail();
  }
  for (const member of members.slice(1)) {
    const parent = path.posix.dirname(member.relativePath);
    if (parent !== "." && memberByPath.get(parent)?.kind !== "directory") fail();
  }
  await assertBoundDirectory(marketplaceRoot, "", memberByPath);
  for (const directory of members.slice(1, filesStart)) {
    await assertBoundDirectory(marketplaceRoot, directory.relativePath, memberByPath);
  }
  const files = new Map();
  for (const member of members.slice(filesStart)) {
    const bytes = await readBoundProjectionFile(marketplaceRoot, member, memberByPath);
    files.set(member.relativePath, Object.freeze({
      bytes,
      digest: member.digest,
      relativePath: member.relativePath,
    }));
  }
  return files;
}

async function assertBoundDirectory(root, relativePath, memberByPath) {
  const expected = memberByPath.get(relativePath);
  if (expected?.kind !== (relativePath === "" ? "root" : "directory")) fail();
  const directory = relativePath === ""
    ? root
    : path.join(root, ...relativePath.split("/"));
  const stats = await lstat(directory, { bigint: true });
  if (stats.isSymbolicLink() || !stats.isDirectory() || await realpath(directory) !== directory
    || !sameBoundIdentity(stats, expected.identity, false)) {
    fail();
  }
}

async function readBoundProjectionFile(root, member, memberByPath) {
  await assertBoundParentChain(root, member.relativePath, memberByPath);
  const filePath = path.join(root, ...member.relativePath.split("/"));
  let handle;
  try {
    const before = await lstat(filePath, { bigint: true });
    if (before.isSymbolicLink() || !before.isFile() || await realpath(filePath) !== filePath
      || !sameBoundIdentity(before, member.identity, true)) {
      fail();
    }
    handle = await open(filePath, FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW);
    const retainedBefore = await handle.stat({ bigint: true });
    if (!sameBoundIdentity(retainedBefore, member.identity, true)) fail();
    const bytes = await readBoundedHandle(handle, MAX_BOUND_MEMBER_BYTES);
    const retainedAfter = await handle.stat({ bigint: true });
    const after = await lstat(filePath, { bigint: true });
    await assertBoundParentChain(root, member.relativePath, memberByPath);
    if (!sameBoundIdentity(retainedAfter, member.identity, true)
      || !sameBoundIdentity(after, member.identity, true)
      || bytes.byteLength !== Number(retainedAfter.size)
      || digest(bytes) !== member.digest) {
      fail();
    }
    return bytes;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function assertBoundParentChain(root, relativePath, memberByPath) {
  let current = "";
  await assertBoundDirectory(root, current, memberByPath);
  for (const segment of path.posix.dirname(relativePath).split("/")) {
    if (segment === ".") continue;
    current = current === "" ? segment : `${current}/${segment}`;
    await assertBoundDirectory(root, current, memberByPath);
  }
}

function buildAuthenticatedBootstrapGraph(options) {
  const entries = [];
  for (const file of [...options.files.values()].sort((left, right) => (
    left.relativePath.localeCompare(right.relativePath)
  ))) {
    const extension = path.posix.extname(file.relativePath);
    entries.push({
      relativePath: file.relativePath,
      url: pathToFileURL(path.join(
        options.marketplaceRoot,
        ...file.relativePath.split("/"),
      )).href,
      digest: file.digest,
      byteLength: file.bytes.byteLength,
      format: extension === ".js" || extension === ".mjs"
        ? "module"
        : extension === ".json"
          ? "json"
          : "asset",
      source: file.bytes.toString("base64"),
    });
  }
  const bytes = Buffer.from(JSON.stringify({
    schemaVersion: "agentmo.builder-bootstrap-graph.v1",
    receiptDigest: options.receiptDigest,
    runnerDigest: options.runnerDigest,
    marketplaceRoot: options.marketplaceRoot,
    entries,
  }), "utf8");
  if (bytes.byteLength > MAX_BOOTSTRAP_GRAPH_BYTES) fail();
  const launcherUrl = pathToFileURL(path.join(
    options.marketplaceRoot,
    ...LAUNCHER_RELATIVE_PATH.split("/"),
  )).href;
  if (!entries.some((entry) => entry.url === launcherUrl && entry.format === "module")) fail();
  return Object.freeze({
    bytes,
    digest: digest(bytes),
    launcherUrl,
  });
}

async function readBoundedFile(root, filePath, maxBytes) {
  const relative = path.relative(root, filePath);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail();
  let handle;
  try {
    const before = await lstat(filePath, { bigint: true });
    if (before.isSymbolicLink() || !before.isFile() || before.size > BigInt(maxBytes)
      || await realpath(filePath) !== filePath) {
      fail();
    }
    handle = await open(filePath, FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW);
    const retained = await handle.stat({ bigint: true });
    if (!sameOpenFile(before, retained)) fail();
    const bytes = await readBoundedHandle(handle, maxBytes);
    const after = await lstat(filePath, { bigint: true });
    if (!sameOpenFile(retained, after) || bytes.byteLength !== Number(retained.size)) fail();
    return bytes;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function readBoundedHandle(handle, maxBytes) {
  const stats = await handle.stat({ bigint: true });
  if (!stats.isFile() || stats.size > BigInt(maxBytes)) fail();
  const bytes = await handle.readFile();
  if (bytes.byteLength > maxBytes) fail();
  return bytes;
}

function parseReceipt(bytes, projectRoot, projectStats) {
  let receipt;
  try {
    receipt = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail();
  }
  if (!exactKeys(receipt, [
    "schemaVersion", "status", "scope", "scopeDigest", "identity", "planDigest",
    "capabilitySnapshot", "markerPath", "receiptPath", "checkpoint", "files", "evidence",
    "hostActivation",
  ])
    || receipt.schemaVersion !== "agentmo.builder-install-receipt.v4"
    || receipt.status !== "activated"
    || receipt.scope !== "project"
    || receipt.markerPath !== ".agentmo/builder/install-marker.json"
    || receipt.receiptPath !== PROJECT_RECEIPT_PATH
    || receipt.scopeDigest !== projectScopeDigest(projectRoot, projectStats)
    || !DIGEST_PATTERN.test(receipt.planDigest ?? "")
    || !exactKeys(receipt.identity, ["name", "version", "adapterId", "releaseDigest"])
    || receipt.identity.name !== "agentmo"
    || !VERSION_PATTERN.test(receipt.identity.version ?? "")
    || receipt.identity.adapterId !== "codex"
    || !DIGEST_PATTERN.test(receipt.identity.releaseDigest ?? "")
    || !validCapabilitySnapshot(receipt.capabilitySnapshot)
    || !validReceiptCheckpoint(receipt.checkpoint)
    || !validManagedReceiptFiles(receipt.files)
    || receipt.planDigest !== receiptPlanDigest(receipt)
    || !exactKeys(receipt.evidence, [
      "level", "mechanismOnly", "codexActivationVerified", "hostBehaviorVerified",
      "domainQualityCertified",
    ])
    || receipt.evidence.level !== "host-observed"
    || receipt.evidence.mechanismOnly !== true
    || receipt.evidence.codexActivationVerified !== false
    || receipt.evidence.hostBehaviorVerified !== false
    || receipt.evidence.domainQualityCertified !== false
    || !exactKeys(receipt.hostActivation, [
      "schemaVersion", "hostScope", "selector", "releaseDigest", "marketplaceProjectionDigest",
      "operationOrderDigest", "ownerDisposition", "ownerRecordDigest", "consumerId",
      "consumerEntryDigest", "consumerLedgerDigest", "consumerEntryOwned",
      "selectorDeletionAuthority", "expectedPostObservation", "finalProjectionBinding",
    ])
    || receipt.hostActivation.schemaVersion !== "agentmo.builder-codex-activation-binding.v3"
    || receipt.hostActivation.hostScope !== "user"
    || JSON.stringify(receipt.hostActivation.selector) !== JSON.stringify(MARKETPLACE_SELECTOR)
    || receipt.hostActivation.releaseDigest !== receipt.identity.releaseDigest
    || receipt.hostActivation.consumerId !== receipt.scopeDigest
    || !DIGEST_PATTERN.test(receipt.hostActivation.marketplaceProjectionDigest ?? "")
    || !DIGEST_PATTERN.test(receipt.hostActivation.operationOrderDigest ?? "")
    || !DIGEST_PATTERN.test(receipt.hostActivation.ownerRecordDigest ?? "")
    || !DIGEST_PATTERN.test(receipt.hostActivation.consumerEntryDigest ?? "")
    || !DIGEST_PATTERN.test(receipt.hostActivation.consumerLedgerDigest ?? "")
    || receipt.hostActivation.consumerEntryOwned !== true
    || receipt.hostActivation.selectorDeletionAuthority !== false
    || !["created-by-agentmo", "preexisting-unowned"].includes(receipt.hostActivation.ownerDisposition)
    || receipt.hostActivation.operationOrderDigest
      !== digest(canonicalJson(ACTIVATION_OPERATION_ORDER))
    || receipt.hostActivation.consumerEntryDigest !== consumerEntryDigest(
      receipt.scopeDigest,
      receipt.identity.releaseDigest,
    )
    || !sameCanonicalValue(
      receipt.hostActivation.expectedPostObservation,
      ACTIVATION_POST_OBSERVATION,
    )
    || Buffer.compare(bytes, Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8")) !== 0) {
    fail();
  }
  validateProjectionBinding(receipt.hostActivation.finalProjectionBinding, receipt);
  return receipt;
}

function validCapabilitySnapshot(value) {
  if (!exactKeys(value, [
    "schemaVersion", "adapterId", "hostVersion", "evidenceLevel", "mutatesHost",
    "externalCommandMutation", "required", "optional", "digest",
  ])
    || value.schemaVersion !== "agentmo.builder-capability-snapshot.v1"
    || value.adapterId !== "codex"
    || typeof value.hostVersion !== "string" || value.hostVersion.length > 64
    || value.evidenceLevel !== "observed"
    || value.mutatesHost !== "unknown"
    || value.externalCommandMutation !== "unknown"
    || !DIGEST_PATTERN.test(value.digest ?? "")
    || !validCapabilityItems(value.required, new Set(["observed"]), true)
    || !validCapabilityItems(value.optional, new Set(["observed", "degraded"]), false)) {
    return false;
  }
  const { digest: capabilityDigest, ...basis } = value;
  return capabilityDigest === digest(canonicalJson(basis));
}

function validCapabilityItems(items, statuses, required) {
  if (!Array.isArray(items) || items.length > 64 || (required && items.length === 0)) return false;
  let previous = null;
  for (const item of items) {
    if (!exactKeys(item, ["id", "status"])
      || !/^[a-z][a-z0-9-]{1,63}$/u.test(item.id ?? "")
      || !statuses.has(item.status)
      || (previous !== null && previous >= item.id)) {
      return false;
    }
    previous = item.id;
  }
  return true;
}

function validReceiptCheckpoint(value) {
  return exactKeys(value, ["path", "authority", "initialized"])
    && value.path === ".agentmo/checkpoints/builder.json"
    && value.authority === "agentmo-checkpoint"
    && value.initialized === false;
}

function validManagedReceiptFiles(files) {
  return Array.isArray(files)
    && files.length === MANAGED_PROJECT_FILES.length
    && files.every((file, index) => (
      exactKeys(file, ["relativePath", "sourceDigest", "destinationDigest", "ownership"])
      && file.relativePath === MANAGED_PROJECT_FILES[index].relativePath
      && file.ownership === MANAGED_PROJECT_FILES[index].ownership
      && DIGEST_PATTERN.test(file.sourceDigest ?? "")
      && file.destinationDigest === file.sourceDigest
    ));
}

function receiptPlanDigest(receipt) {
  return digest(canonicalJson({
    schemaVersion: "agentmo.builder-install-plan-basis.v1",
    scope: "project",
    scopeDigest: receipt.scopeDigest,
    release: {
      name: receipt.identity.name,
      version: receipt.identity.version,
      digest: receipt.identity.releaseDigest,
    },
    capabilityDigest: receipt.capabilitySnapshot.digest,
    receiptPath: PROJECT_RECEIPT_PATH,
    files: receipt.files.map(({
      relativePath,
      sourceDigest,
      destinationDigest,
      ownership,
    }) => ({ relativePath, sourceDigest, destinationDigest, ownership })),
  }));
}

function consumerEntryDigest(scopeDigest, releaseDigest) {
  return digest(canonicalJson({
    consumerId: scopeDigest,
    projectScopeDigest: scopeDigest,
    releaseDigest,
    selector: MARKETPLACE_SELECTOR,
  }));
}

function projectScopeDigest(projectRoot, projectStats) {
  if (!projectStats?.isDirectory() || projectStats.isSymbolicLink()) fail();
  return digest(Buffer.from(`${JSON.stringify({
    schemaVersion: "agentmo.builder-project-scope.v1",
    canonicalRootDigest: digest(Buffer.from(projectRoot, "utf8")),
    device: projectStats.dev.toString(10),
    inode: projectStats.ino.toString(10),
  }, null, 2)}\n`, "utf8"));
}

async function assertReceiptAnchors({ paths, receipt, receiptDigest }) {
  const markerPath = path.join(paths.projectRoot, ...PROJECT_MARKER_PATH.split("/"));
  const markerBytes = await readBoundedFile(paths.projectRoot, markerPath, MAX_RECEIPT_BYTES);
  const marker = {
    schemaVersion: "agentmo.builder-install-marker.v2",
    identity: receipt.identity,
    scope: "project",
    scopeDigest: receipt.scopeDigest,
    receiptPath: PROJECT_RECEIPT_PATH,
    checkpointPath: ".agentmo/checkpoints/builder.json",
    capabilityDigest: receipt.capabilitySnapshot?.digest,
    projectionStatus: "receipt-required",
    selfCertifying: false,
  };
  if (!DIGEST_PATTERN.test(marker.capabilityDigest ?? "")
    || !markerBytes.equals(canonicalJson(marker))) {
    fail();
  }
  const lifecycle = await readCommittedAuthority(
    paths.projectRoot,
    LIFECYCLE_AUTHORITY_PATH,
    LIFECYCLE_NAMESPACE,
    true,
  );
  assertLifecycleReceiptAnchor(lifecycle.records, receipt, receiptDigest);
  const installAttempt = await readCommittedAuthority(
    paths.projectRoot,
    INSTALL_ATTEMPT_AUTHORITY_PATH,
    INSTALL_ATTEMPT_NAMESPACE,
    false,
  );
  assertInstallReceiptAnchor(installAttempt.records, receipt, receiptDigest);
  const host = await readCommittedAuthority(
    paths.stateRoot,
    HOST_AUTHORITY_PATH,
    HOST_AUTHORITY_NAMESPACE,
    false,
  );
  assertHostReceiptAnchor(host.records, receipt);
}

async function retainBootstrapDirectory(directoryPath, managed, parentAuthority = null, name = null) {
  let handle;
  try {
    const resolvedPath = path.resolve(directoryPath);
    if (parentAuthority !== null) {
      if (path.resolve(parentAuthority.path, name) !== resolvedPath) fail();
      await assertBootstrapDirectory(parentAuthority);
    }
    const before = await lstat(resolvedPath, { bigint: true });
    assertSafeBootstrapDirectory(before, managed);
    handle = await open(
      resolvedPath,
      FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_DIRECTORY | FS_CONSTANTS.O_NOFOLLOW,
    );
    const retained = await handle.stat({ bigint: true });
    const after = await lstat(resolvedPath, { bigint: true });
    assertSafeBootstrapDirectory(retained, managed);
    assertSafeBootstrapDirectory(after, managed);
    if (!sameBootstrapDirectory(before, retained)
      || !sameBootstrapDirectory(retained, after)) {
      fail();
    }
    return Object.freeze({
      handle,
      managed,
      name,
      parentAuthority,
      path: resolvedPath,
      stats: retained,
    });
  } catch (error) {
    await handle?.close().catch(() => {});
    throw error;
  }
}

async function retainBootstrapDirectoryChild(parentAuthority, name, optional) {
  await assertBootstrapDirectory(parentAuthority);
  const childPath = path.join(parentAuthority.path, name);
  let stats;
  try {
    stats = await lstat(childPath, { bigint: true });
  } catch (error) {
    if (!optional || error?.code !== "ENOENT") throw error;
    await assertBootstrapDirectory(parentAuthority);
    return null;
  }
  assertSafeBootstrapDirectory(stats, true);
  const child = await retainBootstrapDirectory(childPath, true, parentAuthority, name);
  await assertBootstrapDirectory(parentAuthority);
  return child;
}

async function assertBootstrapDirectory(authority) {
  if (authority.parentAuthority !== null) {
    await assertBootstrapDirectory(authority.parentAuthority);
  }
  const retained = await authority.handle.stat({ bigint: true });
  const current = await lstat(authority.path, { bigint: true });
  assertSafeBootstrapDirectory(retained, authority.managed);
  assertSafeBootstrapDirectory(current, authority.managed);
  if (!sameBootstrapDirectory(authority.stats, retained)
    || !sameBootstrapDirectory(retained, current)) {
    fail();
  }
  if (authority.parentAuthority !== null) {
    const attached = await lstat(
      path.join(authority.parentAuthority.path, authority.name),
      { bigint: true },
    );
    assertSafeBootstrapDirectory(attached, authority.managed);
    if (!sameBootstrapDirectory(retained, attached)) fail();
    await assertBootstrapDirectory(authority.parentAuthority);
  }
}

async function assertBootstrapDirectoryTree(location) {
  for (const authority of location.retainedDirectories) {
    await assertBootstrapDirectory(authority);
  }
}

function assertSafeBootstrapDirectory(stats, managed) {
  const mode = stats?.mode & 0o777n;
  if (!stats?.isDirectory?.()
    || stats.isSymbolicLink?.()
    || stats.uid !== BigInt(process.getuid())
    || (managed ? mode !== 0o700n : (mode & 0o022n) !== 0n)) {
    fail();
  }
}

function sameBootstrapDirectory(left, right) {
  return left.isDirectory() && right.isDirectory()
    && !left.isSymbolicLink() && !right.isSymbolicLink()
    && left.dev === right.dev && left.ino === right.ino
    && left.uid === right.uid && left.gid === right.gid
    && (left.mode & 0o777n) === (right.mode & 0o777n);
}

function bootstrapDirectoryIdentity(stats) {
  return Object.freeze({
    device: stats.dev.toString(10),
    inode: stats.ino.toString(10),
    uid: stats.uid.toString(10),
    gid: stats.gid.toString(10),
    mode: (stats.mode & 0o777n).toString(8),
  });
}

function validBootstrapDirectoryIdentity(value) {
  return exactKeys(value, ["device", "gid", "inode", "mode", "uid"])
    && ["device", "gid", "inode", "uid"].every((key) => /^\d+$/u.test(value[key] ?? ""))
    && /^[0-7]{3,4}$/u.test(value.mode ?? "");
}

function sameBootstrapDirectoryIdentity(left, right) {
  return validBootstrapDirectoryIdentity(left)
    && validBootstrapDirectoryIdentity(right)
    && left.device === right.device
    && left.inode === right.inode
    && left.uid === right.uid
    && left.gid === right.gid
    && left.mode === right.mode;
}

async function readBootstrapDirectoryEntries(location, directoryPath) {
  const authority = location.authorityByPath.get(path.resolve(directoryPath));
  if (authority === undefined) fail();
  await assertBootstrapDirectory(authority);
  const entries = await readdir(authority.path, { withFileTypes: true });
  await assertBootstrapDirectory(authority);
  return entries;
}

function bootstrapParentAuthority(location, filePath) {
  const authority = location.authorityByPath.get(path.resolve(path.dirname(filePath)));
  if (authority === undefined) fail();
  return authority;
}

async function readBootstrapAuthorityFile(location, filePath, maxBytes) {
  const parentAuthority = bootstrapParentAuthority(location, filePath);
  await assertBootstrapDirectory(parentAuthority);
  const bytes = await readBoundedFile(parentAuthority.path, filePath, maxBytes);
  await assertBootstrapDirectory(parentAuthority);
  return bytes;
}

async function lstatBootstrapAuthorityNode(location, filePath, optional = false) {
  const parentAuthority = bootstrapParentAuthority(location, filePath);
  await assertBootstrapDirectory(parentAuthority);
  let stats;
  try {
    stats = await lstat(filePath, { bigint: true });
  } catch (error) {
    if (!optional || error?.code !== "ENOENT") throw error;
    stats = null;
  }
  await assertBootstrapDirectory(parentAuthority);
  return stats;
}

async function readBootstrapAuthorityLink(location, linkPath) {
  const parentAuthority = bootstrapParentAuthority(location, linkPath);
  await assertBootstrapDirectory(parentAuthority);
  const before = await lstat(linkPath, { bigint: true });
  const target = await readlink(linkPath, "utf8");
  const after = await lstat(linkPath, { bigint: true });
  await assertBootstrapDirectory(parentAuthority);
  return { after, before, target };
}

function bootstrapLineageName(namespace, relativeRoot) {
  const key = canonicalJson({
    schemaVersion: "agentmo.append-only-lineage-key.v1",
    namespace,
    relativeRoot,
  });
  return `${digest(key).slice("sha256:".length)}.json`;
}

async function readBootstrapLineageCandidate(location, authority) {
  if (authority === null) return null;
  const name = bootstrapLineageName(location.namespace, location.relativeRoot);
  const filePath = path.join(authority.path, name);
  const selectionPath = `${filePath}.selection`;
  const [fileStats, selectionStats] = await Promise.all([
    lstatBootstrapAuthorityNode(location, filePath, true),
    lstatBootstrapAuthorityNode(location, selectionPath, true),
  ]);
  if (fileStats === null || selectionStats === null) {
    if (fileStats !== null || selectionStats !== null) fail();
    return null;
  }
  if (!fileStats.isFile() || fileStats.isSymbolicLink() || fileStats.nlink !== 1n
    || fileStats.uid !== BigInt(process.getuid()) || (fileStats.mode & 0o777n) !== 0o600n) {
    fail();
  }
  const bytes = await readBootstrapAuthorityFile(location, filePath, MAX_AUTHORITY_BYTES);
  await assertAuthoritySelection(location, selectionPath, bytes);
  const after = await lstatBootstrapAuthorityNode(location, filePath);
  if (!sameOpenFile(fileStats, after)) fail();
  return Object.freeze({ bytes, value: parseCanonicalJson(bytes) });
}

async function readBootstrapAuthorityLineage(location) {
  const [lineage, provision, witness] = await Promise.all([
    readBootstrapLineageCandidate(location, location.lineageAuthority),
    readBootstrapLineageCandidate(location, location.provisionAuthority),
    readBootstrapLineageCandidate(location, location.witnessAuthority),
  ]);
  if (lineage === null || provision === null || witness === null) {
    if (lineage !== null || provision !== null || witness !== null) fail();
    return null;
  }
  const projectIdentity = bootstrapDirectoryIdentity(location.projectAuthority.stats);
  const rootIdentity = location.storeAuthority === null
    ? null
    : bootstrapDirectoryIdentity(location.storeAuthority.stats);
  if (rootIdentity === null
    || !exactKeys(lineage.value, [
      "schemaVersion", "namespace", "relativeRoot", "projectIdentity", "authorityRootIdentity",
    ])
    || lineage.value.schemaVersion !== "agentmo.append-only-lineage-anchor.v1"
    || !exactKeys(provision.value, [
      "schemaVersion", "namespace", "relativeRoot", "projectIdentity", "authorityRootIdentity",
      "lineageAnchorDigest",
    ])
    || provision.value.schemaVersion !== "agentmo.append-only-lineage-provision.v1"
    || !exactKeys(witness.value, [
      "schemaVersion", "namespace", "relativeRoot", "projectIdentity", "authorityRootIdentity",
      "lineageAnchorDigest", "lineageProvisionDigest",
    ])
    || witness.value.schemaVersion !== "agentmo.append-only-root-witness.v1") {
    fail();
  }
  for (const candidate of [lineage.value, provision.value, witness.value]) {
    if (candidate.namespace !== location.namespace
      || candidate.relativeRoot !== location.relativeRoot
      || !sameBootstrapDirectoryIdentity(candidate.projectIdentity, projectIdentity)
      || !sameBootstrapDirectoryIdentity(candidate.authorityRootIdentity, rootIdentity)) {
      fail();
    }
  }
  if (provision.value.lineageAnchorDigest !== digest(lineage.bytes)
    || witness.value.lineageAnchorDigest !== digest(lineage.bytes)
    || witness.value.lineageProvisionDigest !== digest(provision.bytes)) {
    fail();
  }
  return Object.freeze({ lineage, provision, witness });
}

async function assertBootstrapAuthorityLineage(location) {
  await assertBootstrapDirectoryTree(location);
  if (await readBootstrapAuthorityLineage(location) === null) fail();
  await assertBootstrapDirectoryTree(location);
}

async function readCommittedAuthority(projectRoot, relativeRoot, namespace, absentAllowed) {
  const retainedDirectories = [];
  try {
    const projectAuthority = await retainBootstrapDirectory(projectRoot, false);
    retainedDirectories.push(projectAuthority);
    const authorityByPath = new Map([[projectAuthority.path, projectAuthority]]);
    const retainChild = async (parent, name, optional = false) => {
      const child = await retainBootstrapDirectoryChild(parent, name, optional);
      if (child !== null) {
        retainedDirectories.push(child);
        authorityByPath.set(child.path, child);
      }
      return child;
    };
    const lineageAuthority = await retainChild(
      projectAuthority,
      LINEAGE_ANCHOR_DIRECTORY,
      true,
    );
    const provisionAuthority = await retainChild(
      projectAuthority,
      LINEAGE_PROVISION_DIRECTORY,
      true,
    );
    const witnessAuthority = await retainChild(
      projectAuthority,
      ROOT_WITNESS_DIRECTORY,
      true,
    );
    let storeAuthority = projectAuthority;
    for (const component of relativeRoot.split("/")) {
      storeAuthority = await retainChild(storeAuthority, component, true);
      if (storeAuthority === null) break;
    }
    const location = {
      authorityByPath,
      lineageAuthority,
      namespace,
      projectAuthority,
      provisionAuthority,
      relativeRoot,
      retainedDirectories,
      storeAuthority,
      witnessAuthority,
    };
    const initialLineage = await readBootstrapAuthorityLineage(location);
    if (storeAuthority === null) {
      if (initialLineage !== null || !absentAllowed) fail();
      await assertBootstrapDirectoryTree(location);
      return Object.freeze({ records: [] });
    }
    if (initialLineage === null) fail();
    for (const name of ["outcomes", "entries", "claims", "prepared"]) {
      const child = await retainChild(storeAuthority, name);
      if (child === null) fail();
    }
    location.outcomes = path.join(storeAuthority.path, "outcomes");
    location.entries = path.join(storeAuthority.path, "entries");
    location.claims = path.join(storeAuthority.path, "claims");
    location.prepared = path.join(storeAuthority.path, "prepared");
    await assertBootstrapAuthorityLineage(location);
    const records = await readCommittedAuthorityRecords(location);
    await assertBootstrapAuthorityLineage(location);
    await assertBootstrapDirectoryTree(location);
    return Object.freeze({ records: Object.freeze(records) });
  } finally {
    await Promise.all(
      retainedDirectories.reverse().map((authority) => authority.handle.close().catch(() => {})),
    );
  }
}

async function readCommittedAuthorityRecords(location) {
  const root = location.storeAuthority.path;
  const outcomes = location.outcomes;
  const entries = location.entries;
  const claims = location.claims;
  const preparedDirectory = location.prepared;
  const namespace = location.namespace;
  const outcomeEntries = await readBootstrapDirectoryEntries(location, outcomes);
  const finalNames = outcomeEntries.filter((entry) => /^\d{16}\.json$/u.test(entry.name));
  if (outcomeEntries.some((entry) => !(
    (entry.isFile() && (/^\d{16}\.json$/u.test(entry.name)
      || /^[a-f0-9]{64}\.outcome\.stage\.json$/u.test(entry.name)))
    || (entry.isSymbolicLink()
      && /^[a-f0-9]{64}\.outcome\.selection$/u.test(entry.name))
  )) || finalNames.length > MAX_AUTHORITY_RECORDS) {
    fail();
  }
  const recordEntries = await readBootstrapDirectoryEntries(location, entries);
  if (recordEntries.some((entry) => !(
    (entry.isFile()
      && (/^\d{16}\.[a-f0-9]{64}\.json$/u.test(entry.name)
        || /^[a-f0-9]{64}\.record\.stage\.json$/u.test(entry.name)))
    || (entry.isSymbolicLink()
      && /^[a-f0-9]{64}\.record\.stage\.json\.selection$/u.test(entry.name))
  ))) {
    fail();
  }
  const preparedEntries = await readBootstrapDirectoryEntries(location, preparedDirectory);
  if (preparedEntries.some((entry) => !(
    (entry.isFile()
      && (/^\d{16}\.json$/u.test(entry.name)
        || /^[a-f0-9]{64}\.prepared\.stage\.json$/u.test(entry.name)))
    || (entry.isSymbolicLink()
      && /^[a-f0-9]{64}\.prepared\.stage\.json\.selection$/u.test(entry.name))
  ))) {
    fail();
  }
  const names = finalNames.map((entry) => entry.name).toSorted();
  const expectedOutcomeNames = new Set();
  const expectedRecordNames = new Set();
  const expectedPreparedNames = new Set();
  const expectedClaimNames = new Set();
  const idempotencyKeys = new Set();
  let headRecordDigest = `sha256:${"0".repeat(64)}`;
  let headOutcomeDigest = `sha256:${"0".repeat(64)}`;
  const records = [];
  for (const [sequence, name] of names.entries()) {
    if (name !== authoritySequenceName(sequence)) fail();
    const outcomePath = path.join(outcomes, name);
    const outcomeBytes = await readBootstrapAuthorityFile(
      location,
      outcomePath,
      MAX_AUTHORITY_BYTES,
    );
    const outcome = parseCanonicalJson(outcomeBytes);
    const kind = validateCommittedAuthorityOutcome(outcome, {
      namespace,
      sequence,
      name,
      headRecordDigest,
      headOutcomeDigest,
    });
    if (idempotencyKeys.has(outcome.idempotencyKey)) fail();
    idempotencyKeys.add(outcome.idempotencyKey);

    const outcomeStageName = `${outcome.operationId}.outcome.stage.json`;
    const outcomeSelectionName = `${outcome.operationId}.outcome.selection`;
    expectedOutcomeNames.add(name);
    expectedOutcomeNames.add(outcomeStageName);
    expectedOutcomeNames.add(outcomeSelectionName);
    await assertLinkedAuthorityPair(
      location,
      outcomePath,
      path.join(outcomes, outcomeStageName),
      path.join(outcomes, outcomeSelectionName),
      outcomeBytes,
    );

    const claim = await readAuthorityClaim(location, path.join(claims, name), {
      namespace,
      sequence,
      headRecordDigest,
      headOutcomeDigest,
    });
    expectedClaimNames.add(name);
    assertAuthorityClaimMatchesOutcome(claim, outcome);

    if (kind === "claim-abort") {
      if (!sameAuthorityNodeIdentity(claim.stats, outcome.preparedIdentity)) fail();
    } else if (kind === "record-stage-abort") {
      if (!sameAuthorityNodeIdentity(claim.stats, outcome.preparedIdentity)) fail();
      const recordBytes = await readBootstrapAuthorityFile(
        location,
        path.join(root, ...outcome.recordStagePath.split("/")),
        MAX_AUTHORITY_BYTES,
      );
      if (digest(recordBytes) !== outcome.recordDigest) fail();
      const recordStageName = `${outcome.operationId}.record.stage.json`;
      const recordStats = await assertSelectedAuthorityFile(
        location,
        path.join(entries, recordStageName),
        path.join(entries, `${recordStageName}.selection`),
        recordBytes,
        1n,
      );
      expectedRecordNames.add(recordStageName);
      expectedRecordNames.add(`${recordStageName}.selection`);
      if (!sameAuthorityIdentity(recordStats, outcome.recordIdentity)) fail();
    } else if (kind === "prepared-stage-abort") {
      const recordBytes = await readBootstrapAuthorityFile(
        location,
        path.join(root, ...outcome.recordStagePath.split("/")),
        MAX_AUTHORITY_BYTES,
      );
      if (digest(recordBytes) !== outcome.recordDigest) fail();
      const recordStageName = `${outcome.operationId}.record.stage.json`;
      const recordStats = await assertSelectedAuthorityFile(
        location,
        path.join(entries, recordStageName),
        path.join(entries, `${recordStageName}.selection`),
        recordBytes,
        1n,
      );
      expectedRecordNames.add(recordStageName);
      expectedRecordNames.add(`${recordStageName}.selection`);

      const preparedStageName = `${outcome.operationId}.prepared.stage.json`;
      const preparedBytes = await readBootstrapAuthorityFile(
        location,
        path.join(root, ...outcome.preparedPath.split("/")),
        MAX_AUTHORITY_BYTES,
      );
      const prepared = parseCanonicalJson(preparedBytes);
      validateCommittedAuthorityPrepared(prepared, outcome, {
        namespace,
        sequence,
        name,
        headRecordDigest,
        headOutcomeDigest,
        claim,
      });
      const preparedStats = await assertSelectedAuthorityFile(
        location,
        path.join(root, ...outcome.preparedPath.split("/")),
        path.join(preparedDirectory, `${preparedStageName}.selection`),
        preparedBytes,
        1n,
      );
      expectedPreparedNames.add(preparedStageName);
      expectedPreparedNames.add(`${preparedStageName}.selection`);
      if (!sameAuthorityIdentity(preparedStats, outcome.preparedIdentity)
        || !sameAuthorityPreparedRecordStageIdentity(recordStats, prepared.recordStageIdentity)) {
        fail();
      }
    } else {
      const recordStageName = `${outcome.operationId}.record.stage.json`;
      const recordSelectionName = `${recordStageName}.selection`;
      const preparedStageName = `${outcome.operationId}.prepared.stage.json`;
      const preparedSelectionName = `${preparedStageName}.selection`;
      const recordStagePath = path.join(entries, recordStageName);
      const recordBytes = await readBootstrapAuthorityFile(
        location,
        recordStagePath,
        MAX_AUTHORITY_BYTES,
      );
      if (digest(recordBytes) !== outcome.recordDigest) fail();
      const preparedPath = path.join(root, ...outcome.preparedPath.split("/"));
      const preparedBytes = await readBootstrapAuthorityFile(
        location,
        preparedPath,
        MAX_AUTHORITY_BYTES,
      );
      const prepared = parseCanonicalJson(preparedBytes);
      validateCommittedAuthorityPrepared(prepared, outcome, {
        namespace,
        sequence,
        name,
        headRecordDigest,
        headOutcomeDigest,
        claim,
      });
      expectedRecordNames.add(recordStageName);
      expectedRecordNames.add(recordSelectionName);
      expectedPreparedNames.add(name);
      expectedPreparedNames.add(preparedStageName);
      expectedPreparedNames.add(preparedSelectionName);
      const preparedStats = await assertLinkedAuthorityPair(
        location,
        preparedPath,
        path.join(root, ...outcome.preparedStagePath.split("/")),
        path.join(preparedDirectory, preparedSelectionName),
        preparedBytes,
      );
      if (!sameAuthorityIdentity(preparedStats, outcome.preparedIdentity)) fail();

      if (kind === "committed" || outcome.recordIdentity !== null) {
        const recordPath = path.join(root, ...outcome.recordPath.split("/"));
        const recordStats = await assertLinkedAuthorityPair(
          location,
          recordPath,
          recordStagePath,
          path.join(entries, recordSelectionName),
          recordBytes,
        );
        expectedRecordNames.add(path.basename(outcome.recordPath));
        if (!sameAuthorityIdentity(recordStats, outcome.recordIdentity)
          || !sameAuthorityPreparedRecordStageIdentity(recordStats, prepared.recordStageIdentity)) {
          fail();
        }
        if (kind === "committed") {
          const envelope = parseCanonicalJson(recordBytes);
          validateCommittedAuthorityEnvelope(envelope, outcome, {
            namespace,
            sequence,
            headRecordDigest,
            headOutcomeDigest,
          });
          records.push(Object.freeze({ digest: outcome.recordDigest, payload: envelope.payload }));
          headRecordDigest = outcome.recordDigest;
        }
      } else {
        const recordStats = await assertSelectedAuthorityFile(
          location,
          recordStagePath,
          path.join(entries, recordSelectionName),
          recordBytes,
          1n,
        );
        if (!sameAuthorityPreparedRecordStageIdentity(recordStats, prepared.recordStageIdentity)) {
          fail();
        }
      }
    }
    headOutcomeDigest = digest(outcomeBytes);
  }
  const claimEntries = await readBootstrapDirectoryEntries(location, claims);
  if (!sameNameSet(outcomeEntries, expectedOutcomeNames)
    || !sameNameSet(recordEntries, expectedRecordNames)
    || !sameNameSet(preparedEntries, expectedPreparedNames)
    || !sameNameSet(claimEntries, expectedClaimNames)
    || claimEntries.some((entry) => !entry.isSymbolicLink()
      || !/^\d{16}\.json$/u.test(entry.name))) {
    fail();
  }
  return records;
}

function authoritySequenceName(sequence) {
  return `${String(sequence).padStart(16, "0")}.json`;
}

function authorityRecordPath(sequence, recordDigest) {
  return `entries/${String(sequence).padStart(16, "0")}.${recordDigest.slice("sha256:".length)}.json`;
}

function validateCommittedAuthorityOutcome(outcome, expected) {
  const claimAbort = outcome?.schemaVersion === "agentmo.append-only-claim-abort-outcome.v2";
  const recordStageAbort = outcome?.schemaVersion === "agentmo.append-only-record-stage-abort-outcome.v2";
  const preparedStageAbort = outcome?.schemaVersion
    === "agentmo.append-only-prepared-stage-abort-outcome.v2";
  const standard = outcome?.schemaVersion === "agentmo.append-only-outcome.v2";
  const aborted = outcome?.outcome === "aborted";
  const commonKeys = [
    "schemaVersion", "namespace", "sequence", "operationId", "outcome", "idempotencyKey",
    "predecessorRecordDigest", "predecessorOutcomeDigest", "recordDigest", "payloadDigest",
    "preparedPath", "preparedStagePath", "preparedIdentity", "recordPath", "recordStagePath",
    "recordIdentity",
  ];
  if (!exactKeys(outcome, aborted ? [...commonKeys, "reason"] : commonKeys)
    || (!standard && !claimAbort && !recordStageAbort && !preparedStageAbort)
    || outcome.namespace !== expected.namespace
    || outcome.sequence !== expected.sequence
    || !["committed", "aborted"].includes(outcome.outcome)
    || !/^[a-f0-9]{64}$/u.test(outcome.operationId ?? "")
    || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/u.test(outcome.idempotencyKey ?? "")
    || outcome.predecessorRecordDigest !== expected.headRecordDigest
    || outcome.predecessorOutcomeDigest !== expected.headOutcomeDigest
    || !DIGEST_PATTERN.test(outcome.recordDigest ?? "")
    || !DIGEST_PATTERN.test(outcome.payloadDigest ?? "")
    || outcome.recordPath !== authorityRecordPath(expected.sequence, outcome.recordDigest)
    || !validAuthorityIdentity(outcome.preparedIdentity)
    || (outcome.outcome === "committed" && !validAuthorityIdentity(outcome.recordIdentity))
    || (outcome.outcome === "aborted" && (typeof outcome.reason !== "string"
      || !/^[A-Z][A-Z0-9_]{0,127}$/u.test(outcome.reason)
      || (outcome.recordIdentity !== null && !validAuthorityIdentity(outcome.recordIdentity))))) {
    fail();
  }
  const recordStagePath = `entries/${outcome.operationId}.record.stage.json`;
  if (claimAbort) {
    if (outcome.outcome !== "aborted"
      || outcome.preparedPath !== `claims/${expected.name}`
      || outcome.preparedStagePath !== null
      || outcome.recordStagePath !== recordStagePath
      || outcome.recordIdentity !== null) fail();
    return "claim-abort";
  }
  if (recordStageAbort) {
    if (outcome.outcome !== "aborted"
      || outcome.preparedPath !== `claims/${expected.name}`
      || outcome.preparedStagePath !== null
      || outcome.recordStagePath !== recordStagePath
      || !validAuthorityIdentity(outcome.recordIdentity)) fail();
    return "record-stage-abort";
  }
  if (preparedStageAbort) {
    if (outcome.outcome !== "aborted"
      || outcome.preparedPath !== `prepared/${outcome.operationId}.prepared.stage.json`
      || outcome.preparedStagePath !== null
      || outcome.recordStagePath !== recordStagePath
      || outcome.recordIdentity !== null) fail();
    return "prepared-stage-abort";
  }
  if (outcome.preparedPath !== `prepared/${expected.name}`
    || outcome.preparedStagePath !== `prepared/${outcome.operationId}.prepared.stage.json`
    || outcome.recordStagePath !== recordStagePath) {
    fail();
  }
  return outcome.outcome === "committed" ? "committed" : "prepared-abort";
}

function validateCommittedAuthorityPrepared(prepared, outcome, expected) {
  if (!exactKeys(prepared, [
    "schemaVersion", "namespace", "sequence", "operationId", "idempotencyKey",
    "predecessorRecordDigest", "predecessorOutcomeDigest", "recordDigest", "payloadDigest",
    "claimPath", "claimIdentity", "recordStagePath", "recordStageIdentity", "recordPath",
  ])
    || prepared.schemaVersion !== "agentmo.append-only-prepared.v2"
    || prepared.namespace !== expected.namespace
    || prepared.sequence !== expected.sequence
    || prepared.operationId !== outcome.operationId
    || prepared.idempotencyKey !== outcome.idempotencyKey
    || prepared.predecessorRecordDigest !== expected.headRecordDigest
    || prepared.predecessorOutcomeDigest !== expected.headOutcomeDigest
    || prepared.recordDigest !== outcome.recordDigest
    || prepared.payloadDigest !== outcome.payloadDigest
    || prepared.claimPath !== `claims/${expected.name}`
    || !validAuthorityIdentity(prepared.claimIdentity)
    || prepared.recordStagePath !== outcome.recordStagePath
    || !validAuthorityIdentity(prepared.recordStageIdentity)
    || prepared.recordPath !== outcome.recordPath
    || !sameAuthorityNodeIdentity(expected.claim.stats, prepared.claimIdentity)) {
    fail();
  }
  assertAuthorityClaimMatchesPrepared(expected.claim, prepared);
}

function validateCommittedAuthorityEnvelope(envelope, outcome, expected) {
  if (!exactKeys(envelope, [
    "schemaVersion", "namespace", "sequence", "idempotencyKey", "predecessorRecordDigest",
    "predecessorOutcomeDigest", "payloadDigest", "payload",
  ])
    || envelope.schemaVersion !== "agentmo.append-only-authority.v1"
    || envelope.namespace !== expected.namespace
    || envelope.sequence !== expected.sequence
    || envelope.idempotencyKey !== outcome.idempotencyKey
    || envelope.predecessorRecordDigest !== expected.headRecordDigest
    || envelope.predecessorOutcomeDigest !== expected.headOutcomeDigest
    || envelope.payloadDigest !== outcome.payloadDigest
    || digest(canonicalJson(envelope.payload)) !== outcome.payloadDigest) {
    fail();
  }
}

async function readAuthorityClaim(location, claimPath, expected) {
  const { before, target, after } = await readBootstrapAuthorityLink(location, claimPath);
  if (!before.isSymbolicLink() || !after.isSymbolicLink()
    || before.nlink !== 1n || after.nlink !== 1n
    || before.uid !== BigInt(process.getuid()) || after.uid !== BigInt(process.getuid())
    || before.size > 1024n || target.length > 1024
    || !sameAuthorityNodeIdentity(before, authorityIdentity(after))
    || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
    fail();
  }
  const parts = target.split(".");
  if (parts.length !== 5
    || parts[0] !== "am-claim-v2"
    || !/^[a-f0-9]{64}$/u.test(parts[1] ?? "")
    || !/^[a-f0-9]{64}$/u.test(parts[2] ?? "")
    || !/^[a-f0-9]{64}$/u.test(parts[3] ?? "")
    || !/^[a-zA-Z0-9_-]+$/u.test(parts[4] ?? "")) {
    fail();
  }
  let idempotencyKey;
  try {
    const keyBytes = Buffer.from(parts[4], "base64url");
    if (keyBytes.toString("base64url") !== parts[4]) fail();
    idempotencyKey = new TextDecoder("utf-8", { fatal: true }).decode(keyBytes);
  } catch {
    fail();
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,255}$/u.test(idempotencyKey)) fail();
  const recordDigest = `sha256:${parts[2]}`;
  const payloadDigest = `sha256:${parts[3]}`;
  const operationId = digest(Buffer.from([
    expected.namespace,
    String(expected.sequence),
    expected.headRecordDigest,
    expected.headOutcomeDigest,
    idempotencyKey,
    recordDigest,
  ].join("\n"), "utf8")).slice("sha256:".length);
  if (operationId !== parts[1]) fail();
  return Object.freeze({
    stats: after,
    value: Object.freeze({
      namespace: expected.namespace,
      sequence: expected.sequence,
      operationId,
      idempotencyKey,
      predecessorRecordDigest: expected.headRecordDigest,
      predecessorOutcomeDigest: expected.headOutcomeDigest,
      recordDigest,
      payloadDigest,
    }),
  });
}

function assertAuthorityClaimMatchesOutcome(claim, outcome) {
  if (claim.value.operationId !== outcome.operationId
    || claim.value.idempotencyKey !== outcome.idempotencyKey
    || claim.value.predecessorRecordDigest !== outcome.predecessorRecordDigest
    || claim.value.predecessorOutcomeDigest !== outcome.predecessorOutcomeDigest
    || claim.value.recordDigest !== outcome.recordDigest
    || claim.value.payloadDigest !== outcome.payloadDigest) {
    fail();
  }
}

function assertAuthorityClaimMatchesPrepared(claim, prepared) {
  if (claim.value.namespace !== prepared.namespace
    || claim.value.sequence !== prepared.sequence
    || claim.value.operationId !== prepared.operationId
    || claim.value.idempotencyKey !== prepared.idempotencyKey
    || claim.value.predecessorRecordDigest !== prepared.predecessorRecordDigest
    || claim.value.predecessorOutcomeDigest !== prepared.predecessorOutcomeDigest
    || claim.value.recordDigest !== prepared.recordDigest
    || claim.value.payloadDigest !== prepared.payloadDigest) {
    fail();
  }
}

async function assertSelectedAuthorityFile(
  location,
  filePath,
  selectionPath,
  expectedBytes,
  links,
) {
  await assertAuthoritySelection(location, selectionPath, expectedBytes);
  const before = await lstatBootstrapAuthorityNode(location, filePath);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== links) fail();
  const bytes = await readBootstrapAuthorityFile(location, filePath, MAX_AUTHORITY_BYTES);
  const after = await lstatBootstrapAuthorityNode(location, filePath);
  if (!sameAuthorityIdentity(before, authorityIdentity(after)) || !bytes.equals(expectedBytes)) fail();
  await assertAuthoritySelection(location, selectionPath, expectedBytes);
  return after;
}

async function assertLinkedAuthorityPair(
  location,
  finalPath,
  stagePath,
  selectionPath,
  expectedBytes,
) {
  await assertAuthoritySelection(location, selectionPath, expectedBytes);
  const [finalStats, stageStats] = await Promise.all([
    lstatBootstrapAuthorityNode(location, finalPath),
    lstatBootstrapAuthorityNode(location, stagePath),
  ]);
  if (!finalStats.isFile() || !stageStats.isFile() || finalStats.isSymbolicLink()
    || stageStats.isSymbolicLink() || finalStats.nlink !== 2n || stageStats.nlink !== 2n
    || finalStats.dev !== stageStats.dev || finalStats.ino !== stageStats.ino
    || finalStats.size !== stageStats.size || !sameAuthorityIdentity(finalStats, authorityIdentity(stageStats))) {
    fail();
  }
  const stageBytes = await readBootstrapAuthorityFile(location, stagePath, MAX_AUTHORITY_BYTES);
  if (!stageBytes.equals(expectedBytes)) fail();
  await assertAuthoritySelection(location, selectionPath, expectedBytes);
  return finalStats;
}

async function assertAuthoritySelection(location, selectionPath, expectedBytes) {
  const expectedTarget = [
    "am-selected-file-v1",
    digest(expectedBytes).slice("sha256:".length),
    String(expectedBytes.byteLength),
  ].join(".");
  const { before, target, after } = await readBootstrapAuthorityLink(location, selectionPath);
  if (!before.isSymbolicLink() || !after.isSymbolicLink()
    || before.nlink !== 1n || after.nlink !== 1n
    || before.uid !== BigInt(process.getuid()) || after.uid !== BigInt(process.getuid())
    || before.size > 1024n || target !== expectedTarget
    || before.dev !== after.dev || before.ino !== after.ino
    || before.size !== after.size || before.mtimeNs !== after.mtimeNs
    || before.ctimeNs !== after.ctimeNs) {
    fail();
  }
}

function sameNameSet(entries, expected) {
  return entries.length === expected.size
    && entries.every((entry) => expected.has(entry.name));
}

function authorityIdentity(stats) {
  return {
    device: stats.dev.toString(10),
    inode: stats.ino.toString(10),
    links: stats.nlink.toString(10),
    size: stats.size.toString(10),
  };
}

function validAuthorityIdentity(value) {
  return exactKeys(value, ["device", "inode", "links", "size"])
    && Object.values(value).every((item) => /^\d+$/u.test(item ?? ""));
}

function sameAuthorityIdentity(stats, identity) {
  return stats.isFile() && !stats.isSymbolicLink()
    && stats.dev.toString(10) === identity.device
    && stats.ino.toString(10) === identity.inode
    && stats.nlink.toString(10) === identity.links
    && stats.size.toString(10) === identity.size;
}

function sameAuthorityNodeIdentity(stats, identity) {
  return validAuthorityIdentity(identity)
    && stats.dev.toString(10) === identity.device
    && stats.ino.toString(10) === identity.inode
    && stats.nlink.toString(10) === identity.links
    && stats.size.toString(10) === identity.size;
}

function sameAuthorityPreparedRecordStageIdentity(stats, identity) {
  return stats.isFile() && !stats.isSymbolicLink()
    && validAuthorityIdentity(identity)
    && identity.links === "1"
    && stats.dev.toString(10) === identity.device
    && stats.ino.toString(10) === identity.inode
    && stats.size.toString(10) === identity.size;
}

function assertLifecycleReceiptAnchor(records, receipt, receiptDigest) {
  let activeReceiptDigest = receiptDigest;
  for (const record of records) {
    const event = record.payload;
    const legacyV2 = event?.schemaVersion === "agentmo.builder-lifecycle-event.v2";
    const currentV3 = event?.schemaVersion === "agentmo.builder-lifecycle-event.v3";
    const commonKeys = [
      "schemaVersion", "action", "status", "invokedAs", "scopeDigest", "predecessorReceiptDigest",
      "receipt", "files", "physicalDeletion", "hostMutation",
    ];
    if (!exactKeys(event, currentV3
      ? [...commonKeys, "coordination", "evidence"]
      : [...commonKeys, "evidence"])
      || (!legacyV2 && !currentV3)
      || !["activate", "deactivate"].includes(event.action)
      || event.status !== (event.action === "activate" ? "active" : "deactivated")
      || !["upgrade", "reactivate", "deactivate", "uninstall"].includes(event.invokedAs)
      || event.scopeDigest !== receipt.scopeDigest
      || event.predecessorReceiptDigest !== activeReceiptDigest
      || !exactKeys(event.receipt, ["path", "digest", "value", "release"])
      || typeof event.receipt.path !== "string"
      || !DIGEST_PATTERN.test(event.receipt?.digest ?? "")
      || event.physicalDeletion !== false
      || event.hostMutation !== false
      || event.evidence?.level !== "declared-ready"
      || event.evidence?.mechanismOnly !== true
      || event.evidence?.hostBehaviorVerified !== false
      || event.evidence?.domainQualityCertified !== false) {
      fail();
    }
    if (currentV3 && event.coordination !== null
      && (!exactKeys(event.coordination, ["kind", "operationId"])
        || event.coordination.kind !== "checkpoint-upgrade-reservation"
        || !DIGEST_PATTERN.test(event.coordination.operationId ?? "")
        || event.action !== "activate"
        || event.invokedAs !== "upgrade")) {
      fail();
    }
    if (event.action === "activate") {
      activeReceiptDigest = event.receipt.digest;
    } else if (event.receipt.digest !== activeReceiptDigest) {
      fail();
    }
  }
}

function assertInstallReceiptAnchor(records, receipt, receiptDigest) {
  const terminal = records.at(-1)?.payload;
  if (!exactKeys(terminal, [
    "schemaVersion", "operationId", "disposition", "planDigest", "scopeDigest", "receiptDigest",
    "finalProjectionBinding", "errorCode", "hostReservation", "physicalDeletion", "files", "stages",
  ])
    || terminal.schemaVersion !== "agentmo.builder-install-attempt.v2"
    || !/^[a-f0-9]{64}$/u.test(terminal.operationId ?? "")
    || terminal.disposition !== "committed"
    || !DIGEST_PATTERN.test(terminal.planDigest ?? "")
    || terminal.scopeDigest !== receipt.scopeDigest
    || terminal.receiptDigest !== receiptDigest
    || !sameCanonicalValue(
      terminal.finalProjectionBinding,
      receipt.hostActivation.finalProjectionBinding,
    )
    || terminal.errorCode !== null
    || terminal.physicalDeletion !== false
    || !Array.isArray(terminal.stages)
    || !validInstallTerminalFiles(terminal.files, receipt, receiptDigest)
    || !validInstallHostReservation(terminal.hostReservation, receipt, terminal.planDigest)) {
    fail();
  }
}

function validInstallTerminalFiles(files, receipt, receiptDigest) {
  const expected = [
    ...receipt.files.map((file) => ({
      relativePath: file.relativePath,
      digest: file.destinationDigest,
    })),
    { relativePath: PROJECT_RECEIPT_PATH, digest: receiptDigest },
  ];
  return Array.isArray(files) && files.length === expected.length
    && files.every((file, index) => (
      exactKeys(file, ["relativePath", "operation", "digest"])
      && file.relativePath === expected[index].relativePath
      && file.operation === "create"
      && file.digest === expected[index].digest
    ));
}

function validInstallHostReservation(value, receipt, attemptPlanDigest) {
  const activation = receipt.hostActivation;
  return exactKeys(value, [
    "purpose", "bindingDigest", "expectedOwnerDigest", "expectedOwnerIdentityDigest",
    "expectedLedgerDigest", "expectedLedgerIdentityDigest", "desiredOwnerDigest",
    "desiredLedgerDigest",
  ])
    && value.purpose === "activation"
    && value.bindingDigest === attemptPlanDigest
    && value.desiredOwnerDigest === activation.ownerRecordDigest
    && value.desiredLedgerDigest === activation.consumerLedgerDigest
    && [value.expectedOwnerDigest, value.expectedLedgerDigest,
      value.expectedOwnerIdentityDigest, value.expectedLedgerIdentityDigest].every(
      (item) => item === null || DIGEST_PATTERN.test(item ?? ""),
    );
}

function assertHostReceiptAnchor(records, receipt) {
  let owner = null;
  let ledger = null;
  let projectionBinding = null;
  for (const record of records) {
    const payload = record.payload;
    if (payload?.kind === "owner-written" || payload?.kind === "ledger-written") {
      if (!DIGEST_PATTERN.test(payload.artifactDigest ?? "")
        || digest(canonicalJson(payload.value)) !== payload.artifactDigest) {
        fail();
      }
      if (payload.kind === "owner-written") owner = payload;
      else ledger = payload;
    }
    if (payload?.kind === "projection-complete") {
      if (!DIGEST_PATTERN.test(payload.bindingDigest ?? "")
        || digest(canonicalJson(payload.binding)) !== payload.bindingDigest) {
        fail();
      }
      projectionBinding = payload.binding;
    }
  }
  const activation = receipt.hostActivation;
  if (owner === null || ledger === null || projectionBinding === null
    || owner.artifactDigest !== activation.ownerRecordDigest
    || ledger?.artifactDigest !== activation.consumerLedgerDigest
    || !sameCanonicalValue(projectionBinding, activation.finalProjectionBinding)
    || !validOwnerForReceipt(owner.value, receipt.identity)
    || !validLedgerForReceipt(ledger.value, receipt.scopeDigest, receipt.identity.releaseDigest)) {
    fail();
  }
  const consumer = ledger.value.consumers.find((entry) => entry?.consumerId === receipt.scopeDigest);
  if (consumer === undefined || digest(canonicalJson(consumer)) !== activation.consumerEntryDigest) fail();
}

function validOwnerForReceipt(owner, identity) {
  return exactKeys(owner, ["schemaVersion", "selector", "disposition", "release", "sourceDigest"])
    && owner.schemaVersion === "agentmo.codex-selector-owner.v1"
    && JSON.stringify(owner.selector) === JSON.stringify(MARKETPLACE_SELECTOR)
    && ["created-by-agentmo", "preexisting-unowned"].includes(owner.disposition)
    && JSON.stringify(owner.release) === JSON.stringify(identity)
    && DIGEST_PATTERN.test(owner.sourceDigest ?? "");
}

function validLedgerForReceipt(ledger, scopeDigest, releaseDigest) {
  if (!exactKeys(ledger, ["schemaVersion", "selector", "consumers"])
    || ledger.schemaVersion !== "agentmo.codex-consumer-ledger.v1"
    || JSON.stringify(ledger.selector) !== JSON.stringify(MARKETPLACE_SELECTOR)
    || !Array.isArray(ledger.consumers)) return false;
  return ledger.consumers.some((entry) => exactKeys(entry, [
    "consumerId", "projectScopeDigest", "releaseDigest", "selector",
  ])
    && entry.consumerId === scopeDigest && entry.projectScopeDigest === scopeDigest
    && entry.releaseDigest === releaseDigest
    && JSON.stringify(entry.selector) === JSON.stringify(MARKETPLACE_SELECTOR));
}

function canonicalJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sameCanonicalValue(left, right) {
  return canonicalJson(left).equals(canonicalJson(right));
}

function parseCanonicalJson(bytes) {
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail();
  }
  if (!Buffer.from(bytes).equals(canonicalJson(value))) fail();
  return value;
}

function validateProjectionBinding(binding, receipt) {
  if (!exactKeys(binding, [
    "schemaVersion", "transactionId", "transactionDigest", "releaseDigest", "contentDigest",
    "rootIdentity", "rootIdentityDigest", "members",
  ])
    || binding.schemaVersion !== "agentmo.codex-marketplace-projection-binding.v1"
    || binding.releaseDigest !== receipt.identity.releaseDigest
    || binding.contentDigest !== receipt.hostActivation.marketplaceProjectionDigest
    || !DIGEST_PATTERN.test(binding.transactionDigest ?? "")
    || binding.transactionId !== binding.transactionDigest.slice("sha256:".length)
    || !DIGEST_PATTERN.test(binding.rootIdentityDigest ?? "")
    || !Array.isArray(binding.members)
    || binding.members.length < 2
    || binding.members.length > MAX_BOUND_MEMBERS) {
    fail();
  }
  const root = binding.members[0];
  validateBoundMember(root, 0);
  if (root.kind !== "root" || JSON.stringify(root.identity) !== JSON.stringify(binding.rootIdentity)) fail();
  const rootIdentityDigest = digest(Buffer.from(`${JSON.stringify({
    schemaVersion: "agentmo.codex-marketplace-root-identity.v1",
    ...binding.rootIdentity,
  }, null, 2)}\n`, "utf8"));
  if (rootIdentityDigest !== binding.rootIdentityDigest) fail();
  const manifest = {
    schemaVersion: "agentmo.codex-marketplace-projection-manifest.v1",
    selector: MARKETPLACE_SELECTOR,
    releaseDigest: binding.releaseDigest,
    contentDigest: binding.contentDigest,
    members: binding.members.map(({ identity: _identity, ...member }) => member),
  };
  if (digest(Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8")) !== binding.transactionDigest) {
    fail();
  }
}

function validateBoundMember(member, index) {
  if (!exactKeys(member, ["digest", "identity", "kind", "relativePath"])
    || !["root", "directory", "file"].includes(member.kind)
    || (index === 0) !== (member.kind === "root")
    || (member.kind === "root" && member.relativePath !== "")
    || (member.kind !== "root" && !portableRelativePath(member.relativePath))
    || (member.kind === "file" ? !DIGEST_PATTERN.test(member.digest ?? "") : member.digest !== null)
    || !validBoundIdentity(member.identity, member.kind === "file")) {
    fail();
  }
}

function validBoundIdentity(identity, file) {
  return exactKeys(identity, ["device", "group", "inode", "links", "mode", "owner", "size"])
    && ["device", "group", "inode", "links", "owner", "size"].every(
      (key) => /^\d+$/u.test(identity[key] ?? ""),
    )
    && /^[0-7]{3,4}$/u.test(identity.mode ?? "")
    && (file ? identity.links === "1" : BigInt(identity.links) >= 1n);
}

function sameBoundIdentity(stats, identity, file) {
  return (file ? stats.isFile() : stats.isDirectory())
    && !stats.isSymbolicLink()
    && stats.dev.toString(10) === identity.device
    && stats.ino.toString(10) === identity.inode
    && stats.nlink.toString(10) === identity.links
    && stats.size.toString(10) === identity.size
    && stats.uid.toString(10) === identity.owner
    && stats.gid.toString(10) === identity.group
    && (stats.mode & 0o777n).toString(8) === identity.mode
    && stats.uid === BigInt(process.getuid())
    && (stats.mode & 0o022n) === 0n;
}

function sameOpenFile(left, right) {
  return left.isFile() && right.isFile()
    && !left.isSymbolicLink() && !right.isSymbolicLink()
    && left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

function portableRelativePath(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 240
    && !value.includes("\\")
    && !value.includes("\0")
    && !path.posix.isAbsolute(value)
    && value.split("/").every((segment) => segment.length > 0
      && segment !== "." && segment !== ".." && segment.length <= 255);
}

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function runAdjacentLauncher(inputBytes, paths) {
  return new Promise((resolve, reject) => {
    const stdout = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let overflow = false;
    let timedOut = false;
    let spawnError = false;
    let closed = false;
    let settled = false;
    let settlingFailure = false;
    let directExit = null;
    let timer = null;
    let deadlineSettlementGrace = null;
    const loaderUrl = `data:text/javascript,${encodeURIComponent(AUTHENTICATED_BOOTSTRAP_LOADER_SOURCE)}`;
    const entrySource = [
      `process.argv = [process.execPath, ${JSON.stringify(paths.launcherPath)}, "__builder-hook"];`,
      `await import(${JSON.stringify(paths.graph.launcherUrl)});`,
    ].join("\n");
    const child = spawn(process.execPath, [
      "--no-warnings",
      "--experimental-loader",
      loaderUrl,
      "--input-type=module",
      "--eval",
      entrySource,
    ], {
        cwd: paths.projectRoot,
        detached: true,
        env: {
          AGENTMO_BUILDER_HOOK_BOOTSTRAP_MODE: "authenticated-graph-v1",
          AGENTMO_BUILDER_HOOK_GRAPH_DIGEST: paths.graph.digest,
          AGENTMO_BUILDER_HOOK_RUNNER_DIGEST: paths.runnerDigest,
          LANG: "C",
          LC_ALL: "C",
        },
        shell: false,
        stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"],
    });
    const terminateGroup = () => {
      if (!Number.isSafeInteger(child.pid) || child.pid <= 0) return;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (error?.code !== "ESRCH") spawnError = true;
      }
    };
    const groupExists = () => {
      if (!Number.isSafeInteger(child.pid) || child.pid <= 0) return false;
      try {
        process.kill(-child.pid, 0);
        return true;
      } catch (error) {
        if (error?.code === "ESRCH") return false;
        spawnError = true;
        return true;
      }
    };
    const destroyChildPipes = () => {
      for (const stream of [
        child.stdin,
        child.stdout,
        child.stderr,
        child.stdio[3],
        child.stdio[4],
      ]) {
        try {
          stream?.destroy();
        } catch {
          spawnError = true;
        }
      }
    };
    const detachChild = () => {
      try {
        child.unref();
      } catch {
        spawnError = true;
      }
    };
    const clearTimers = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (deadlineSettlementGrace !== null) {
        clearTimeout(deadlineSettlementGrace);
        deadlineSettlementGrace = null;
      }
    };
    const settleRejected = () => {
      if (settled || settlingFailure) return;
      settlingFailure = true;
      clearTimers();
      terminateGroup();
      destroyChildPipes();
      detachChild();
      // Process-group termination and pipe destruction are best effort. A
      // hostile or uninterruptible child may remain alive, but it must not
      // prolong this hook's fail-closed settlement or contribute output.
      settled = true;
      reject(new Error("Installed hook launcher rejected."));
    };
    timer = setTimeout(() => {
      if (settled || closed) return;
      timedOut = true;
      terminateGroup();
      destroyChildPipes();
      detachChild();
      deadlineSettlementGrace = setTimeout(() => {
        deadlineSettlementGrace = null;
        settleRejected();
      }, CHILD_TIMEOUT_SETTLEMENT_GRACE_MS);
      if (directExit !== null) settleRejected();
    }, CHILD_TIMEOUT_MS);
    child.on("error", () => {
      spawnError = true;
    });
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes + stderrBytes > MAX_CHILD_OUTPUT_BYTES) {
        overflow = true;
        terminateGroup();
        destroyChildPipes();
        if (directExit !== null) void settleRejected();
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.byteLength;
      if (stdoutBytes + stderrBytes > MAX_CHILD_OUTPUT_BYTES) {
        overflow = true;
        terminateGroup();
        destroyChildPipes();
        if (directExit !== null) void settleRejected();
      }
    });
    child.on("exit", (code, signal) => {
      directExit = Object.freeze({ code, signal });
      if (code !== 0 || signal !== null) {
        spawnError = true;
        terminateGroup();
        destroyChildPipes();
      }
      if (overflow || timedOut || spawnError || stderrBytes !== 0) {
        settleRejected();
      }
    });
    child.on("close", (code, signal) => {
      if (settled || closed) return;
      closed = true;
      clearTimeout(timer);
      if (code !== 0 || signal !== null || overflow || timedOut || spawnError || stderrBytes !== 0) {
        settleRejected();
        return;
      }
      if (groupExists()) {
        terminateGroup();
        settleRejected();
        return;
      }
      settled = true;
      resolve(Buffer.concat(stdout, stdoutBytes));
    });
    for (const stream of [child.stdin, child.stdio[3], child.stdio[4]]) {
      stream.on("error", () => {});
    }
    child.stdin.end(inputBytes);
    child.stdio[3].end(paths.graph.bytes);
    child.stdio[4].end(paths.graph.bytes);
  });
}

function admitBridgeResult(bytes, eventName) {
  let result;
  try {
    result = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail();
  }
  if (!exactKeys(result, [
    "schemaVersion",
    "status",
    "applied",
    "event",
    "checkpointDigest",
    "reducedCheckpointDigest",
    "observationDigest",
    "announcement",
    "proposal",
  ])
    || result.schemaVersion !== "agentmo.builder-hook-bridge-result.v1"
    || !["applied", "duplicate", "deactivated"].includes(result.status)
    || result.applied !== (result.status === "applied")
    || !DIGEST_PATTERN.test(result.checkpointDigest ?? "")
    || !DIGEST_PATTERN.test(result.reducedCheckpointDigest ?? "")
    || (result.observationDigest !== null
      && !DIGEST_PATTERN.test(result.observationDigest ?? ""))
    || (result.announcement !== null
      && (typeof result.announcement !== "string" || result.announcement.length > 512))) {
    fail();
  }
  if (result.status === "deactivated") {
    if (result.event !== null || result.announcement !== null || result.proposal !== null
      || result.observationDigest !== null) fail();
    return result;
  }
  const event = result.event;
  if (!exactKeys(event, ["type", "identity", "epoch", "sequence", "digest"])
    || event.type !== eventName
    || !DIGEST_PATTERN.test(event.identity ?? "")
    || !Number.isSafeInteger(event.epoch)
    || event.epoch < 0
    || !Number.isSafeInteger(event.sequence)
    || event.sequence <= 0
    || !DIGEST_PATTERN.test(event.digest ?? "")) {
    fail();
  }
  if (result.status === "duplicate") {
    if (result.announcement !== null || result.proposal !== null) fail();
    return result;
  }
  if (eventName === "PreCompact") {
    if (result.proposal !== null) fail();
    return result;
  }
  const proposal = result.proposal;
  if (!exactKeys(proposal, ["kind", "stage", "requiresApproval", "automaticStageAdvance"])
    || proposal.kind !== "resume"
    || !PROPOSAL_STAGES.has(proposal.stage)
    || proposal.requiresApproval !== true
    || proposal.automaticStageAdvance !== false) {
    fail();
  }
  return result;
}

function outputFor(result) {
  if (!result.applied || result.event.type === "PreCompact") return {};
  return {
    hookSpecificOutput: {
      hookEventName: result.event.type,
      additionalContext: `AgentMo checkpoint is resumable at ${result.proposal.stage}. Use $agentmo to review and explicitly resume; no approval or stage transition was applied.`,
    },
  };
}

function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function fail() {
  throw new Error("Installed hook delivery rejected.");
}

async function main() {
  const inputBytes = await readInput();
  let payload;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(inputBytes));
  } catch {
    fail();
  }
  const eventName = exactEventName(payload);
  if (eventName === null) return;
  const paths = await installedPaths();
  const bootstrap = await admitBootstrapRelease(paths);
  const bridgeBytes = await runAdjacentLauncher(inputBytes, bootstrap);
  const result = admitBridgeResult(bridgeBytes, eventName);
  process.stdout.write(`${JSON.stringify(outputFor(result))}\n`);
}

main().catch(() => {
  process.exitCode = 1;
});
