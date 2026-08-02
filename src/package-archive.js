import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { admitCapturedArtifactBytes } from "./artifact-admission.js";
import { validateAgentPackageManifest } from "./package-contract.js";

const ARCHIVE_SCHEMA_VERSION = "agentmo.package-archive.v1";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

export class PackageArchiveError extends Error {
  constructor(code) {
    super("Agent Package archive rejected.");
    this.name = "PackageArchiveError";
    this.code = code;
  }
}

export async function buildPackageArchive({ packageRoot } = {}) {
  const root = path.resolve(assertPath(packageRoot));
  const manifestBytes = await readRegularFile(path.join(root, "agentmo.package.json"));
  const manifest = parseCanonicalJson(manifestBytes, "package-manifest");
  const validation = validateAgentPackageManifest(manifest);
  if (!validation.ok) throw archiveError("AGENTMO_PACKAGE_ARCHIVE_MANIFEST_INVALID");
  const observedPaths = await walkFiles(root);
  const expectedPaths = ["agentmo.package.json", ...manifest.members.map(({ relativePath }) => relativePath)]
    .sort(comparePaths);
  if (!isDeepStrictEqual(observedPaths, expectedPaths)) {
    throw archiveError("AGENTMO_PACKAGE_ARCHIVE_MEMBER_CLOSURE_INVALID");
  }
  const contentMembers = await Promise.all(manifest.members.map(async (member) => {
    const bytes = await readRegularFile(path.join(root, ...member.relativePath.split("/")));
    const stat = await lstat(path.join(root, ...member.relativePath.split("/")));
    const observed = descriptor(member.relativePath, stat.mode & 0o777, bytes);
    if (!isDeepStrictEqual(observed, member)) {
      throw archiveError("AGENTMO_PACKAGE_ARCHIVE_MEMBER_DRIFT");
    }
    return { ...member, contentBase64: bytes.toString("base64") };
  }));
  const manifestDigest = hash(manifestBytes);
  const envelope = {
    schemaVersion: ARCHIVE_SCHEMA_VERSION,
    transportRole: "sole-preview-approval-apply-transport",
    manifestDigest,
    inventoryDigest: manifest.inventoryDigest,
    manifestContentBase64: manifestBytes.toString("base64"),
    members: contentMembers,
    certificationBoundary: {
      directoryBuildAuthority: true,
      installed: false,
      runtime: false,
      domain: false,
      production: false,
    },
  };
  const bytes = canonicalJsonBytes(envelope);
  return Object.freeze({
    bytes,
    archiveDigest: hash(bytes),
    manifestDigest,
    inventoryDigest: manifest.inventoryDigest,
    members: Object.freeze(structuredClone(manifest.members)),
  });
}

export async function readPackageArchiveInventory({
  archivePath,
  expectedArchiveDigest,
} = {}) {
  const snapshot = await readPackageArchiveSnapshot({
    archivePath,
    expectedArchiveDigest,
  });
  return Object.freeze({
    manifestDigest: snapshot.manifestDigest,
    inventoryDigest: snapshot.inventoryDigest,
    members: snapshot.members,
  });
}

export async function admitPackageArchiveManifest({
  archivePath,
  expectedArchiveDigest,
} = {}) {
  const snapshot = await readPackageArchiveSnapshot({
    archivePath,
    expectedArchiveDigest,
  });
  return Object.freeze({
    manifest: admitCapturedArtifactBytes({
      bytes: snapshot.manifestBytes,
      subject: "package-manifest",
      expectedDigest: snapshot.manifestDigest,
    }),
    manifestDigest: snapshot.manifestDigest,
    inventoryDigest: snapshot.inventoryDigest,
    members: snapshot.members,
  });
}

async function readPackageArchiveSnapshot({
  archivePath,
  expectedArchiveDigest,
} = {}) {
  if (!DIGEST.test(expectedArchiveDigest ?? "")) {
    throw archiveError("AGENTMO_PACKAGE_ARCHIVE_DIGEST_REQUIRED");
  }
  const bytes = await readRegularFile(path.resolve(assertPath(archivePath)));
  if (hash(bytes) !== expectedArchiveDigest) {
    throw archiveError("AGENTMO_PACKAGE_ARCHIVE_DIGEST_MISMATCH");
  }
  const envelope = parseCanonicalJson(bytes, "package-transport-archive");
  if (envelope.schemaVersion !== ARCHIVE_SCHEMA_VERSION
    || envelope.transportRole !== "sole-preview-approval-apply-transport"
    || !DIGEST.test(envelope.manifestDigest ?? "")
    || !DIGEST.test(envelope.inventoryDigest ?? "")
    || typeof envelope.manifestContentBase64 !== "string"
    || !Array.isArray(envelope.members)
    || !exactBoundary(envelope.certificationBoundary)) {
    throw archiveError("AGENTMO_PACKAGE_ARCHIVE_INVALID");
  }
  const manifestBytes = strictBase64(envelope.manifestContentBase64);
  if (hash(manifestBytes) !== envelope.manifestDigest) {
    throw archiveError("AGENTMO_PACKAGE_ARCHIVE_MANIFEST_DRIFT");
  }
  const manifest = parseCanonicalJson(manifestBytes, "package-manifest");
  if (manifest.inventoryDigest !== envelope.inventoryDigest
    || !validateAgentPackageManifest(manifest).ok
    || envelope.members.length !== manifest.members.length) {
    throw archiveError("AGENTMO_PACKAGE_ARCHIVE_INVENTORY_DRIFT");
  }
  const observed = envelope.members.map((member, index) => {
    if (!member || typeof member !== "object"
      || Object.keys(member).join(",") !== "relativePath,type,mode,byteLength,sha256,contentBase64"
      || typeof member.contentBase64 !== "string") {
      throw archiveError("AGENTMO_PACKAGE_ARCHIVE_MEMBER_INVALID");
    }
    const bytesForMember = strictBase64(member.contentBase64);
    const value = descriptor(member.relativePath, member.mode, bytesForMember);
    if (member.type !== "file"
      || !isDeepStrictEqual(value, manifest.members[index])) {
      throw archiveError("AGENTMO_PACKAGE_ARCHIVE_MEMBER_DRIFT");
    }
    return value;
  });
  return Object.freeze({
    manifestBytes,
    manifestDigest: envelope.manifestDigest,
    inventoryDigest: envelope.inventoryDigest,
    members: Object.freeze(observed),
  });
}

function exactBoundary(value) {
  return value?.directoryBuildAuthority === true
    && value?.installed === false
    && value?.runtime === false
    && value?.domain === false
    && value?.production === false
    && Object.keys(value).join(",") === "directoryBuildAuthority,installed,runtime,domain,production";
}

function descriptor(relativePath, mode, bytes) {
  return {
    relativePath,
    type: "file",
    mode,
    byteLength: bytes.length,
    sha256: hash(bytes),
  };
}

async function readRegularFile(filePath) {
  let handle;
  try {
    handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1) throw archiveError("AGENTMO_PACKAGE_ARCHIVE_UNSAFE_MEMBER");
    return await handle.readFile();
  } finally {
    await handle?.close();
  }
}

async function walkFiles(root, relative = "") {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) {
      throw archiveError("AGENTMO_PACKAGE_ARCHIVE_UNSAFE_MEMBER");
    }
    return entry.isDirectory() ? walkFiles(root, child) : [child];
  }));
  return nested.flat().sort(comparePaths);
}

function parseCanonicalJson(bytes, subject) {
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw archiveError("AGENTMO_PACKAGE_ARCHIVE_INVALID_JSON");
  }
  const canonical = canonicalJsonBytes(value);
  if (!canonical.equals(bytes)) throw archiveError("AGENTMO_PACKAGE_ARCHIVE_NON_CANONICAL");
  return value;
}

function canonicalJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function strictBase64(value) {
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) throw archiveError("AGENTMO_PACKAGE_ARCHIVE_INVALID_BASE64");
  return bytes;
}

function hash(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function assertPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw archiveError("AGENTMO_PACKAGE_ARCHIVE_PATH_INVALID");
  }
  return value;
}

function comparePaths(left, right) {
  return Buffer.from(left).compare(Buffer.from(right));
}

function archiveError(code) {
  return new PackageArchiveError(code);
}
