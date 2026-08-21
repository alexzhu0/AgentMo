import { fstatSync, read } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { digestRawBytes } from "./artifact-admission.js";
import { serializePersistableJson } from "./persistability.js";

const VERIFIED_BOOTSTRAP_CAPABILITIES = new WeakMap();
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const MAX_BOOTSTRAP_GRAPH_BYTES = 24 * 1024 * 1024;
const RAW_DESCRIPTOR_READ_BYTES = 64 * 1024;
const MARKETPLACE_DESCRIPTOR_RELATIVE_PATH = ".agents/plugins/marketplace.json";
const MODULE_PACKAGE_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const MARKETPLACE_ROOT = path.resolve(MODULE_PACKAGE_ROOT, "..", "..", "..", "..");
const STABLE_RUNNER_RELATIVE_PATH = "plugins/agentmo/hooks/agentmo-hook.js";
let retainedGraphBytes = null;

export async function verifyInstalledBootstrapSnapshot(options = {}) {
  const graphDigest = process.env.AGENTMO_BUILDER_HOOK_GRAPH_DIGEST;
  const declaredRunnerDigest = process.env.AGENTMO_BUILDER_HOOK_RUNNER_DIGEST;
  if (!exactKeys(options, ["activationReceipt", "receiptDigest", "runnerDigest"])
    || !DIGEST_PATTERN.test(options.receiptDigest ?? "")
    || !DIGEST_PATTERN.test(options.runnerDigest ?? "")
    || process.env.AGENTMO_BUILDER_HOOK_BOOTSTRAP_MODE !== "authenticated-graph-v1"
    || !DIGEST_PATTERN.test(graphDigest ?? "")
    || declaredRunnerDigest !== options.runnerDigest) {
    reject();
  }
  const binding = options.activationReceipt?.hostActivation?.finalProjectionBinding;
  if (!binding || !Array.isArray(binding.members)
    || binding.releaseDigest !== options.activationReceipt?.identity?.releaseDigest
    || binding.members.length < 2 || binding.members.length > 512) {
    reject();
  }
  const graph = await readAuthenticatedBootstrapGraph();
  if (!exactKeys(graph, [
    "schemaVersion", "receiptDigest", "runnerDigest", "marketplaceRoot", "entries",
  ])
    || graph.schemaVersion !== "agentmo.builder-bootstrap-graph.v1"
    || graph.receiptDigest !== options.receiptDigest
    || graph.runnerDigest !== options.runnerDigest
    || graph.marketplaceRoot !== MARKETPLACE_ROOT
    || !Array.isArray(graph.entries)) {
    reject();
  }
  const expectedFiles = new Map(binding.members
    .filter((member) => member?.kind === "file")
    .map((member) => [member.relativePath, member]));
  if (expectedFiles.size !== graph.entries.length) reject();
  const graphFiles = new Map();
  for (const entry of graph.entries) {
    if (!exactKeys(entry, [
      "relativePath", "url", "digest", "byteLength", "format", "source",
    ])
      || !portableBootstrapMemberPath(entry.relativePath)
      || graphFiles.has(entry.relativePath)
      || !DIGEST_PATTERN.test(entry.digest ?? "")
      || !Number.isSafeInteger(entry.byteLength)
      || entry.byteLength < 0
      || !["module", "json", "asset"].includes(entry.format)
      || typeof entry.source !== "string") {
      reject();
    }
    const member = expectedFiles.get(entry.relativePath);
    const expectedUrl = pathToFileURL(path.join(
      MARKETPLACE_ROOT,
      ...entry.relativePath.split("/"),
    )).href;
    const bytes = decodeCanonicalBase64(entry.source);
    if (!member
      || entry.url !== expectedUrl
      || entry.digest !== member.digest
      || entry.byteLength !== Number(member.identity?.size)
      || bytes.byteLength !== entry.byteLength
      || digestRawBytes(bytes) !== entry.digest
      || entry.format !== bootstrapEntryFormat(entry.relativePath)) {
      reject();
    }
    graphFiles.set(entry.relativePath, bytes);
  }
  const runner = expectedFiles.get(STABLE_RUNNER_RELATIVE_PATH);
  if (!runner || runner.digest !== options.runnerDigest
    || !graphFiles.has(STABLE_RUNNER_RELATIVE_PATH)
    || !graphFiles.has(MARKETPLACE_DESCRIPTOR_RELATIVE_PATH)) {
    reject();
  }
  const bindingDigest = digestProjectionBinding(binding);
  if (!DIGEST_PATTERN.test(bindingDigest ?? "")) reject();
  const capability = Object.freeze({});
  VERIFIED_BOOTSTRAP_CAPABILITIES.set(capability, Object.freeze({
    bindingDigest,
    files: graphFiles,
    receiptDigest: options.receiptDigest,
    runnerDigest: options.runnerDigest,
  }));
  return capability;
}

export function consumeVerifiedBootstrapSnapshotCapability(options = {}) {
  if (!exactKeys(options, [
    "bootstrapCapability", "projectionBinding", "receiptDigest", "runnerDigest",
  ])
    || !DIGEST_PATTERN.test(options.receiptDigest ?? "")
    || !DIGEST_PATTERN.test(options.runnerDigest ?? "")) {
    return null;
  }
  const record = VERIFIED_BOOTSTRAP_CAPABILITIES.get(options.bootstrapCapability);
  if (!record) return null;
  VERIFIED_BOOTSTRAP_CAPABILITIES.delete(options.bootstrapCapability);
  if (record.receiptDigest !== options.receiptDigest
    || record.runnerDigest !== options.runnerDigest
    || record.bindingDigest !== digestProjectionBinding(options.projectionBinding)) {
    return null;
  }
  return record;
}

async function readAuthenticatedBootstrapGraph() {
  const exactByteLength = parseDeclaredBootstrapGraphByteLength(
    process.env.AGENTMO_BUILDER_HOOK_GRAPH_BYTE_LENGTH,
  );
  if (retainedGraphBytes === null) {
    const descriptorStats = fstatSync(4);
    if (!descriptorStats.isFIFO() && !descriptorStats.isSocket()) reject();
    retainedGraphBytes = await readExactRawDescriptor(4, exactByteLength); // Exact parent-owned frame only.
  } else if (retainedGraphBytes.byteLength !== exactByteLength) {
    reject();
  }
  const expectedDigest = process.env.AGENTMO_BUILDER_HOOK_GRAPH_DIGEST;
  if (!DIGEST_PATTERN.test(expectedDigest ?? "")
    || digestRawBytes(retainedGraphBytes) !== expectedDigest) {
    reject();
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(retainedGraphBytes));
  } catch {
    reject();
  }
}

function parseDeclaredBootstrapGraphByteLength(value) {
  if (typeof value !== "string" || !/^[1-9]\d*$/u.test(value)) reject();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > MAX_BOOTSTRAP_GRAPH_BYTES) reject();
  return parsed;
}

async function readExactRawDescriptor(descriptor, exactByteLength) {
  const chunks = [];
  let total = 0;
  while (total < exactByteLength) {
    const length = Math.min(RAW_DESCRIPTOR_READ_BYTES, exactByteLength - total);
    const buffer = Buffer.allocUnsafe(length);
    const bytesRead = await readRawDescriptor(descriptor, buffer, length);
    if (!Number.isSafeInteger(bytesRead) || bytesRead <= 0 || bytesRead > length) reject();
    total += bytesRead;
    chunks.push(bytesRead === length ? buffer : buffer.subarray(0, bytesRead));
  }
  return Buffer.concat(chunks, exactByteLength);
}

function readRawDescriptor(descriptor, buffer, length) {
  return new Promise((resolve, rejectRead) => {
    read(descriptor, buffer, 0, length, null, (error, bytesRead) => {
      if (error) rejectRead(error);
      else resolve(bytesRead);
    });
  });
}

function decodeCanonicalBase64(value) {
  let bytes;
  try {
    bytes = Buffer.from(value, "base64");
  } catch {
    reject();
  }
  if (bytes.toString("base64") !== value) reject();
  return bytes;
}

function bootstrapEntryFormat(relativePath) {
  const extension = path.posix.extname(relativePath);
  if (extension === ".js" || extension === ".mjs") return "module";
  if (extension === ".json") return "json";
  return "asset";
}

function digestProjectionBinding(binding) {
  try {
    return digestRawBytes(Buffer.from(serializePersistableJson(binding, {
      subject: "builder-bootstrap-snapshot-binding",
    }), "utf8"));
  } catch {
    return null;
  }
}

function portableBootstrapMemberPath(value) {
  return typeof value === "string"
    && value.length > 0 && value.length <= 240
    && !value.includes("\\") && !value.includes("\0")
    && !path.posix.isAbsolute(value)
    && value.split("/").every((segment) => segment.length > 0
      && segment !== "." && segment !== "..");
}

function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function reject() {
  throw new Error("Installed authenticated bootstrap graph was rejected.");
}
