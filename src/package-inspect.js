import { createHash } from "node:crypto";
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { assertNoDuplicateIdentityMembers } from "./artifact-registry.js";
import { readBoundedNoFollowFile } from "./builder-package.js";
import { validateAgentPackageManifest } from "./package-contract.js";
import {
  assertPersistable,
  preparePersistableProductText,
  serializePersistableJson,
} from "./persistability.js";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const ARCHIVE_SCHEMA_VERSION = "agentmo.package-archive.v1";
const MANIFEST_NAME = "agentmo.package.json";
const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_MEMBER_BYTES = 1024 * 1024;
const ARCHIVE_KEYS = Object.freeze([
  "schemaVersion",
  "transportRole",
  "manifestDigest",
  "inventoryDigest",
  "manifestContentBase64",
  "members",
  "certificationBoundary",
]);
const ARCHIVE_MEMBER_KEYS = Object.freeze([
  "relativePath",
  "type",
  "mode",
  "byteLength",
  "sha256",
  "contentBase64",
]);
const INSPECTION_KEYS = Object.freeze([
  "schemaVersion",
  "status",
  "offline",
  "transport",
  "manifest",
  "files",
  "carriers",
  "permissions",
  "sensitiveActions",
  "targetOperations",
  "conflicts",
  "evidenceBoundary",
  "certificationBoundary",
  "remainingRisks",
]);
const FORBIDDEN_MEMBER_PATH = /(?:^|\/)(?:\.env(?:\.|$)|auth(?:[._/-]|$)|sessions?(?:[._/-]|$)|(?:raw[-_.]?)?transcripts?(?:[._/-]|$)|provider[-_.]?payloads?(?:[._/-]|$)|(?:raw[-_.]?)?std(?:out|err)(?:[._/-]|$)|[^/]*\.(?:db|sqlite|sqlite3)(?:$|\.))/iu;

export class PackageInspectError extends Error {
  constructor(code) {
    super("Agent Package inspection was rejected.");
    this.name = "PackageInspectError";
    this.code = code;
  }
}

export async function inspectAgentPackage(options = {}) {
  try {
    assertExactOptions(options);
    const packagePath = resolveInputPath(options.packagePath);
    const input = await lstat(packagePath, { bigint: true });
    if (input.isSymbolicLink()) fail("AGENTMO_PACKAGE_INSPECT_UNSAFE_INPUT");

    let snapshot;
    if (input.isDirectory()) {
      if (!DIGEST_PATTERN.test(options.expectedManifestDigest ?? "")
        || options.expectedArchiveDigest !== undefined) {
        fail("AGENTMO_PACKAGE_INSPECT_MANIFEST_DIGEST_REQUIRED");
      }
      snapshot = await inspectDirectorySnapshot(
        packagePath,
        options.expectedManifestDigest,
      );
    } else if (input.isFile()) {
      if (!DIGEST_PATTERN.test(options.expectedArchiveDigest ?? "")
        || options.expectedManifestDigest !== undefined) {
        fail("AGENTMO_PACKAGE_INSPECT_ARCHIVE_DIGEST_REQUIRED");
      }
      snapshot = await inspectArchiveSnapshot(
        packagePath,
        options.expectedArchiveDigest,
      );
    } else {
      fail("AGENTMO_PACKAGE_INSPECT_UNSAFE_INPUT");
    }
    const candidate = buildInspectionCandidate(snapshot);
    assertPersistable(candidate, { subject: "package-inspection" });
    return deepFreeze(candidate);
  } catch (error) {
    if (error instanceof PackageInspectError) throw error;
    fail("AGENTMO_PACKAGE_INSPECT_REJECTED");
  }
}

export function formatAgentPackageInspection(candidate) {
  try {
    if (!plainObject(candidate)
      || !sameArray(Object.keys(candidate), INSPECTION_KEYS)
      || candidate.schemaVersion !== "agentmo.package-inspection.v1") {
      fail("AGENTMO_PACKAGE_INSPECT_CANDIDATE_INVALID");
    }
    assertPersistable(candidate, { subject: "package-inspection" });
    return [
      "AgentMo Package Inspection",
      ...INSPECTION_KEYS.map((key) => `${key}: ${JSON.stringify(candidate[key])}`),
      "",
    ].join("\n");
  } catch (error) {
    if (error instanceof PackageInspectError) throw error;
    fail("AGENTMO_PACKAGE_INSPECT_CANDIDATE_INVALID");
  }
}

async function inspectDirectorySnapshot(root, expectedManifestDigest) {
  const rootBefore = await stableDirectoryStat(root);
  const observedPaths = await walkDirectory(root);
  const manifestBytes = await readBoundedNoFollowFile(
    path.join(root, MANIFEST_NAME),
    MAX_MANIFEST_BYTES,
  );
  if (hash(manifestBytes) !== expectedManifestDigest) {
    fail("AGENTMO_PACKAGE_INSPECT_MANIFEST_DIGEST_MISMATCH");
  }
  const manifest = parseCanonicalManifest(manifestBytes);
  const expectedPaths = [
    MANIFEST_NAME,
    ...manifest.members.map(({ relativePath }) => relativePath),
  ].sort(comparePaths);
  if (!isDeepStrictEqual(observedPaths, expectedPaths)) {
    fail("AGENTMO_PACKAGE_INSPECT_MEMBER_SET_MISMATCH");
  }

  const members = [];
  for (const expected of manifest.members) {
    const memberPath = path.join(root, ...expected.relativePath.split("/"));
    const bytes = await readBoundedNoFollowFile(memberPath, MAX_MEMBER_BYTES);
    const observedStat = await lstat(memberPath, { bigint: true });
    if (!observedStat.isFile() || observedStat.isSymbolicLink() || observedStat.nlink !== 1n) {
      fail("AGENTMO_PACKAGE_INSPECT_MEMBER_IDENTITY_DRIFT");
    }
    const observed = descriptor(
      expected.relativePath,
      Number(observedStat.mode & 0o777n),
      bytes,
    );
    if (!isDeepStrictEqual(observed, expected)) {
      fail("AGENTMO_PACKAGE_INSPECT_MEMBER_DRIFT");
    }
    auditMember(expected.relativePath, bytes);
    members.push({ descriptor: observed, bytes });
  }
  if (!sameDirectoryStat(rootBefore, await stableDirectoryStat(root))) {
    fail("AGENTMO_PACKAGE_INSPECT_MEMBER_IDENTITY_DRIFT");
  }
  const archiveBytes = buildArchiveBytes(manifestBytes, manifest, members);
  return {
    manifest,
    manifestBytes,
    members,
    archiveDigest: hash(archiveBytes),
  };
}

async function inspectArchiveSnapshot(archivePath, expectedArchiveDigest) {
  const archiveBytes = await readBoundedNoFollowFile(archivePath, MAX_ARCHIVE_BYTES);
  if (hash(archiveBytes) !== expectedArchiveDigest) {
    fail("AGENTMO_PACKAGE_INSPECT_ARCHIVE_DIGEST_MISMATCH");
  }
  const envelope = parseCanonicalJson(
    archiveBytes,
    "AGENTMO_PACKAGE_INSPECT_ARCHIVE_INVALID",
  );
  if (!plainObject(envelope)
    || !sameArray(Object.keys(envelope), ARCHIVE_KEYS)
    || envelope.schemaVersion !== ARCHIVE_SCHEMA_VERSION
    || envelope.transportRole !== "sole-preview-approval-apply-transport"
    || !DIGEST_PATTERN.test(envelope.manifestDigest ?? "")
    || !DIGEST_PATTERN.test(envelope.inventoryDigest ?? "")
    || typeof envelope.manifestContentBase64 !== "string"
    || !Array.isArray(envelope.members)
    || !exactArchiveBoundary(envelope.certificationBoundary)) {
    fail("AGENTMO_PACKAGE_INSPECT_ARCHIVE_INVALID");
  }
  const manifestBytes = strictBase64(envelope.manifestContentBase64);
  if (hash(manifestBytes) !== envelope.manifestDigest) {
    fail("AGENTMO_PACKAGE_INSPECT_MANIFEST_DIGEST_MISMATCH");
  }
  const manifest = parseCanonicalManifest(manifestBytes);
  if (manifest.inventoryDigest !== envelope.inventoryDigest
    || envelope.members.length !== manifest.members.length) {
    fail("AGENTMO_PACKAGE_INSPECT_INVENTORY_DIGEST_MISMATCH");
  }
  const members = envelope.members.map((member, index) => {
    if (!plainObject(member)
      || !sameArray(Object.keys(member), ARCHIVE_MEMBER_KEYS)
      || typeof member.contentBase64 !== "string") {
      fail("AGENTMO_PACKAGE_INSPECT_MEMBER_INVALID");
    }
    const bytes = strictBase64(member.contentBase64);
    const observed = descriptor(member.relativePath, member.mode, bytes);
    if (member.type !== "file"
      || !isDeepStrictEqual(observed, manifest.members[index])
      || !isDeepStrictEqual(
        {
          relativePath: member.relativePath,
          type: member.type,
          mode: member.mode,
          byteLength: member.byteLength,
          sha256: member.sha256,
        },
        manifest.members[index],
      )) {
      fail("AGENTMO_PACKAGE_INSPECT_MEMBER_DRIFT");
    }
    auditMember(observed.relativePath, bytes);
    return { descriptor: observed, bytes };
  });
  const rebuilt = buildArchiveBytes(manifestBytes, manifest, members);
  if (!rebuilt.equals(archiveBytes)) {
    fail("AGENTMO_PACKAGE_INSPECT_ARCHIVE_CLOSURE_MISMATCH");
  }
  return {
    manifest,
    manifestBytes,
    members,
    archiveDigest: expectedArchiveDigest,
  };
}

function buildInspectionCandidate(snapshot) {
  const { manifest } = snapshot;
  const carriers = structuredClone(manifest.capabilityLedger);
  const sensitiveActions = carriers
    .filter(({ approvalRequirement }) => approvalRequirement === "explicit-human-approval")
    .map((entry) => ({
      capabilityId: entry.capabilityId,
      carrier: entry.carrier,
      owner: entry.owner,
      permission: entry.permission,
      approvalRequirement: entry.approvalRequirement,
      failureSemantics: entry.failureSemantics,
    }));
  const targetOperations = carriers.map((entry) => ({
    capabilityId: entry.capabilityId,
    target: entry.targetMapping.target,
    event: entry.targetMapping.event,
    versionRange: entry.targetMapping.versionRange,
    permission: entry.permission,
    approvalRequirement: entry.approvalRequirement,
    failureSemantics: entry.failureSemantics,
  }));
  return {
    schemaVersion: "agentmo.package-inspection.v1",
    status: "observed",
    offline: {
      filesystemReadOnly: true,
      openClawInvoked: false,
      processSpawned: false,
      targetStateMutated: false,
    },
    transport: {
      directoryBuildAuthority: true,
      archiveOnlyDownstream: true,
      archiveDigest: snapshot.archiveDigest,
      manifestDigest: hash(snapshot.manifestBytes),
      inventoryDigest: manifest.inventoryDigest,
      memberCount: snapshot.members.length,
    },
    manifest: {
      schemaVersion: manifest.schemaVersion,
      packageId: manifest.packageId,
      packageVersion: manifest.packageVersion,
      manifestDigest: hash(snapshot.manifestBytes),
      inventoryDigest: manifest.inventoryDigest,
      sourceBindings: structuredClone(manifest.sourceBindings),
      targetCompatibility: structuredClone(manifest.targetCompatibility),
      ownership: structuredClone(manifest.ownership),
    },
    files: structuredClone(manifest.members),
    carriers,
    permissions: structuredClone(manifest.permissions),
    sensitiveActions,
    targetOperations,
    conflicts: {
      evaluated: false,
      items: [],
      reason: "offline-inspection-does-not-observe-target-state",
    },
    evidenceBoundary: {
      mechanism: "offline-exact-package-closure",
      evidenceRefs: structuredClone(manifest.evidenceRefs),
      installEvidence: false,
      runtimeEvidence: false,
      domainEvidence: false,
      productionEvidence: false,
    },
    certificationBoundary: {
      packageClosureVerified: true,
      installed: false,
      runtime: false,
      domain: false,
      birth: false,
      delivery: false,
      production: false,
    },
    remainingRisks: structuredClone(manifest.remainingRisks),
  };
}

function parseCanonicalManifest(bytes) {
  try {
    assertNoDuplicateIdentityMembers(bytes.toString("utf8"));
  } catch {
    fail("AGENTMO_PACKAGE_INSPECT_MANIFEST_INVALID");
  }
  const manifest = parseCanonicalJson(
    bytes,
    "AGENTMO_PACKAGE_INSPECT_MANIFEST_INVALID",
  );
  const validation = validateAgentPackageManifest(manifest);
  if (!validation.ok) fail("AGENTMO_PACKAGE_INSPECT_MANIFEST_INVALID");
  return manifest;
}

function parseCanonicalJson(bytes, code) {
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail(code);
  }
  let canonical;
  try {
    canonical = canonicalJsonBytes(value);
  } catch {
    fail(code);
  }
  if (!canonical.equals(bytes)) fail(code);
  return value;
}

function auditMember(relativePath, bytes) {
  try {
    if (FORBIDDEN_MEMBER_PATH.test(relativePath)) {
      fail("AGENTMO_PACKAGE_INSPECT_SENSITIVE_MATERIAL");
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (relativePath.endsWith(".json")) {
      const value = JSON.parse(text);
      if (containsForbiddenMemberMaterial(value)) {
        fail("AGENTMO_PACKAGE_INSPECT_SENSITIVE_MATERIAL");
      }
      assertPersistable(value, { subject: "package-member" });
      if (!canonicalJsonBytes(value).equals(bytes)) {
        fail("AGENTMO_PACKAGE_INSPECT_MEMBER_NON_CANONICAL");
      }
    } else {
      preparePersistableProductText(text, { subject: "package-member" });
    }
  } catch (error) {
    if (error instanceof PackageInspectError) throw error;
    fail("AGENTMO_PACKAGE_INSPECT_SENSITIVE_MATERIAL");
  }
}

function containsForbiddenMemberMaterial(value) {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsForbiddenMemberMaterial);
  for (const [key, item] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/gu, "");
    if (/^(?:authsession|authstate|sessionstate|runtimedatabase|providerpayload|providerrawpayload|rawtranscript|rawstdout|rawstderr)s?$/u.test(normalized)) {
      return true;
    }
    if (containsForbiddenMemberMaterial(item)) return true;
  }
  return false;
}

function buildArchiveBytes(manifestBytes, manifest, members) {
  return canonicalJsonBytes({
    schemaVersion: ARCHIVE_SCHEMA_VERSION,
    transportRole: "sole-preview-approval-apply-transport",
    manifestDigest: hash(manifestBytes),
    inventoryDigest: manifest.inventoryDigest,
    manifestContentBase64: manifestBytes.toString("base64"),
    members: members.map(({ descriptor: member, bytes }) => ({
      ...member,
      contentBase64: bytes.toString("base64"),
    })),
    certificationBoundary: {
      directoryBuildAuthority: true,
      installed: false,
      runtime: false,
      domain: false,
      production: false,
    },
  });
}

async function walkDirectory(root, relative = "") {
  const directory = relative
    ? path.join(root, ...relative.split("/"))
    : root;
  const before = await stableDirectoryStat(directory);
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    const childPath = path.join(root, ...child.split("/"));
    const observed = await lstat(childPath, { bigint: true });
    if (entry.isSymbolicLink() || observed.isSymbolicLink()) {
      fail("AGENTMO_PACKAGE_INSPECT_UNSAFE_MEMBER");
    }
    if (entry.isDirectory() && observed.isDirectory()) {
      paths.push(...await walkDirectory(root, child));
    } else if (entry.isFile() && observed.isFile()) {
      paths.push(child);
    } else {
      fail("AGENTMO_PACKAGE_INSPECT_UNSAFE_MEMBER");
    }
  }
  if (!sameDirectoryStat(before, await stableDirectoryStat(directory))) {
    fail("AGENTMO_PACKAGE_INSPECT_MEMBER_IDENTITY_DRIFT");
  }
  return paths.sort(comparePaths);
}

async function stableDirectoryStat(directory) {
  const observed = await lstat(directory, { bigint: true });
  if (!observed.isDirectory() || observed.isSymbolicLink()) {
    fail("AGENTMO_PACKAGE_INSPECT_UNSAFE_MEMBER");
  }
  return observed;
}

function sameDirectoryStat(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function exactArchiveBoundary(value) {
  return plainObject(value)
    && sameArray(Object.keys(value), [
      "directoryBuildAuthority",
      "installed",
      "runtime",
      "domain",
      "production",
    ])
    && value.directoryBuildAuthority === true
    && value.installed === false
    && value.runtime === false
    && value.domain === false
    && value.production === false;
}

function strictBase64(value) {
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) {
    fail("AGENTMO_PACKAGE_INSPECT_ARCHIVE_INVALID");
  }
  return bytes;
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

function canonicalJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function hash(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function resolveInputPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    fail("AGENTMO_PACKAGE_INSPECT_PATH_INVALID");
  }
  return path.resolve(value);
}

function assertExactOptions(value) {
  if (!plainObject(value)
    || Object.keys(value).some((key) => ![
      "packagePath",
      "expectedArchiveDigest",
      "expectedManifestDigest",
    ].includes(key))
    || !Object.hasOwn(value, "packagePath")) {
    fail("AGENTMO_PACKAGE_INSPECT_OPTIONS_INVALID");
  }
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function plainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sameArray(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function comparePaths(left, right) {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

function fail(code) {
  throw new PackageInspectError(code);
}
