import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import {
  assertPersistable,
  serializePersistableJson,
} from "./persistability.js";
import {
  validateOpenClawTargetDescriptor,
} from "./openclaw-target-descriptor.js";

export const OPENCLAW_AUTHORITY_ROOT_BINDING_SCHEMA_VERSION =
  "agentmo.openclaw-authority-root-binding.v1";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const BINDING_KEYS = Object.freeze([
  "schemaVersion",
  "authorityId",
  "targetDescriptorDigest",
  "targetRootIdentity",
  "rootIdentity",
  "certificationBoundary",
]);
const ROOT_FAMILIES = Object.freeze([
  "ordinary",
  "sensitive",
  "conflict",
  "post-state",
  "official-action-results",
  "finalizations",
  "finalization-links",
]);

export class OpenClawAuthorityRootBindingError extends Error {
  constructor(code = "AGENTMO_OPENCLAW_AUTHORITY_ROOT_BINDING_REJECTED") {
    super("OpenClaw authority root binding was rejected.");
    this.name = "OpenClawAuthorityRootBindingError";
    this.code = code;
  }
}

export async function createOpenClawAuthorityRootBinding(options = {}) {
  if (!plainObject(options)
    || !sameKeys(options, ["openClawTargetRoot", "targetDescriptor"])
    || !path.isAbsolute(options.openClawTargetRoot ?? "")
    || !validateOpenClawTargetDescriptor(options.targetDescriptor).ok) {
    fail();
  }
  const target = await exactTarget(options);
  const targetDescriptorDigest = digestCanonical(
    options.targetDescriptor,
    "openclaw-target-descriptor",
  );
  const rootPath = authorityRootPath(target.path, targetDescriptorDigest);
  try {
    await mkdir(rootPath, { mode: 0o700 });
  } catch (error) {
    if (error?.code !== "EEXIST") fail();
  }
  const root = await secureDirectory(rootPath);
  for (const family of ROOT_FAMILIES) {
    const familyPath = path.join(rootPath, family);
    try {
      await mkdir(familyPath, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== "EEXIST") fail();
    }
    const familyStats = await secureDirectory(familyPath);
    if (familyStats.dev !== root.dev) fail();
  }
  const current = await secureDirectory(rootPath);
  if (!sameIdentity(root, current)) fail();
  return buildOpenClawAuthorityRootBinding({
    targetDescriptorDigest,
    targetRootIdentity: identity(target.stats),
    rootIdentity: identity(root),
  });
}

export function buildOpenClawAuthorityRootBinding(options = {}) {
  if (!plainObject(options)
    || !sameKeys(options, [
      "targetDescriptorDigest",
      "targetRootIdentity",
      "rootIdentity",
    ])
    || !DIGEST_PATTERN.test(options.targetDescriptorDigest ?? "")
    || !validIdentity(options.targetRootIdentity)
    || !validIdentity(options.rootIdentity)) fail();
  const basis = {
    schemaVersion: OPENCLAW_AUTHORITY_ROOT_BINDING_SCHEMA_VERSION,
    targetDescriptorDigest: options.targetDescriptorDigest,
    targetRootIdentity: structuredClone(options.targetRootIdentity),
    rootIdentity: structuredClone(options.rootIdentity),
  };
  const candidate = {
    schemaVersion: basis.schemaVersion,
    authorityId: digestCanonical(basis, "openclaw-canonical-authority-ledger"),
    targetDescriptorDigest: basis.targetDescriptorDigest,
    targetRootIdentity: basis.targetRootIdentity,
    rootIdentity: basis.rootIdentity,
    certificationBoundary: {
      authorityAnchorOnly: true,
      approvalsGranted: false,
      installed: false,
      runtime: false,
      domain: false,
      production: false,
    },
  };
  if (!validateOpenClawAuthorityRootBinding(candidate).ok) fail();
  return deepFreeze(candidate);
}

export function validateOpenClawAuthorityRootBinding(value) {
  const errors = [];
  if (!plainObject(value) || !sameKeys(value, BINDING_KEYS)) {
    return result(["shape"]);
  }
  if (value.schemaVersion !== OPENCLAW_AUTHORITY_ROOT_BINDING_SCHEMA_VERSION
    || !DIGEST_PATTERN.test(value.authorityId ?? "")
    || !DIGEST_PATTERN.test(value.targetDescriptorDigest ?? "")
    || !validIdentity(value.targetRootIdentity)
    || !validIdentity(value.rootIdentity)) {
    errors.push("identity");
  }
  if (!exactBoundary(value.certificationBoundary)) errors.push("boundary");
  if (errors.length === 0) {
    const basis = {
      schemaVersion: value.schemaVersion,
      targetDescriptorDigest: value.targetDescriptorDigest,
      targetRootIdentity: value.targetRootIdentity,
      rootIdentity: value.rootIdentity,
    };
    if (value.authorityId
      !== digestCanonical(basis, "openclaw-canonical-authority-ledger")) {
      errors.push("authorityId");
    }
  }
  if (errors.length === 0) {
    try {
      assertPersistable(value, { subject: "openclaw-authority-root-binding" });
    } catch {
      errors.push("persistability");
    }
  }
  return result(errors);
}

export async function writeOpenClawAuthorityRootBinding(filePath, binding) {
  if (!path.isAbsolute(filePath ?? "")
    || !validateOpenClawAuthorityRootBinding(binding).ok) fail();
  const bytes = canonicalBytes(binding);
  let handle;
  try {
    handle = await open(
      filePath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
        | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    await handle.writeFile(bytes);
    await handle.sync();
  } catch {
    fail("AGENTMO_OPENCLAW_AUTHORITY_ROOT_BINDING_OUTPUT_EXISTS");
  } finally {
    await handle?.close().catch(() => {});
  }
  return deepFreeze({ digest: digestBytes(bytes) });
}

export async function loadOpenClawAuthorityRootBinding(
  filePath,
  expectedDigest,
) {
  if (!path.isAbsolute(filePath ?? "")
    || !DIGEST_PATTERN.test(expectedDigest ?? "")) fail();
  let handle;
  try {
    const beforePath = await lstat(filePath, { bigint: true });
    handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = await handle.stat({ bigint: true });
    if (!sameStableFile(beforePath, before)) fail();
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const afterPath = await lstat(filePath, { bigint: true });
    if (!sameStableFile(before, after)
      || !sameStableFile(after, afterPath)
      || digestBytes(bytes) !== expectedDigest) fail();
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!validateOpenClawAuthorityRootBinding(value).ok
      || !canonicalBytes(value).equals(bytes)) fail();
    return deepFreeze({
      value,
      identity: OPENCLAW_AUTHORITY_ROOT_BINDING_SCHEMA_VERSION,
      subject: "openclaw-authority-root-binding",
      digest: expectedDigest,
    });
  } catch (error) {
    if (error instanceof OpenClawAuthorityRootBindingError) throw error;
    fail();
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function verifyOpenClawAuthorityRootBinding(options = {}) {
  if (!plainObject(options)
    || !sameKeys(options, [
      "openClawTargetRoot",
      "targetDescriptor",
      "binding",
    ])
    || !validateOpenClawAuthorityRootBinding(options.binding).ok
    || !validateOpenClawTargetDescriptor(options.targetDescriptor).ok) fail();
  const target = await exactTarget(options);
  const descriptorDigest = digestCanonical(
    options.targetDescriptor,
    "openclaw-target-descriptor",
  );
  const rootPath = authorityRootPath(target.path, descriptorDigest);
  const root = await secureDirectory(rootPath);
  if (descriptorDigest !== options.binding.targetDescriptorDigest
    || !sameIdentityValue(identity(target.stats), options.binding.targetRootIdentity)
    || !sameIdentityValue(identity(root), options.binding.rootIdentity)) fail();
  for (const family of ROOT_FAMILIES) {
    const familyStats = await secureDirectory(path.join(rootPath, family));
    if (familyStats.dev !== root.dev) fail();
  }
  const current = await secureDirectory(rootPath);
  if (!sameIdentity(root, current)) fail();
  return deepFreeze({ rootPath, rootIdentity: identity(root) });
}

async function exactTarget(options) {
  let targetPath;
  let stats;
  try {
    targetPath = await realpath(options.openClawTargetRoot);
    stats = await lstat(targetPath, { bigint: true });
  } catch {
    fail();
  }
  const expected = options.targetDescriptor.targetRoot?.identityBasis;
  if (!stats.isDirectory()
    || stats.isSymbolicLink()
    || stats.dev.toString() !== expected?.device
    || stats.ino.toString() !== expected?.inode) fail();
  return { path: targetPath, stats };
}

function authorityRootPath(targetPath, descriptorDigest) {
  return path.join(
    path.dirname(targetPath),
    `.agentmo-openclaw-authority-${descriptorDigest.slice("sha256:".length)}`,
  );
}

async function secureDirectory(directoryPath) {
  let stats;
  try {
    stats = await lstat(directoryPath, { bigint: true });
  } catch {
    fail();
  }
  if (!stats.isDirectory()
    || stats.isSymbolicLink()
    || stats.uid !== BigInt(process.getuid?.() ?? -1)
    || (stats.mode & 0o777n) !== 0o700n) fail();
  return stats;
}

function exactBoundary(value) {
  const expected = {
    authorityAnchorOnly: true,
    approvalsGranted: false,
    installed: false,
    runtime: false,
    domain: false,
    production: false,
  };
  return plainObject(value)
    && sameKeys(value, Object.keys(expected))
    && Object.entries(expected).every(([key, item]) => value[key] === item);
}

function validIdentity(value) {
  return plainObject(value)
    && sameKeys(value, ["device", "inode"])
    && /^\d+$/u.test(value.device ?? "")
    && /^\d+$/u.test(value.inode ?? "");
}

function identity(stats) {
  return { device: stats.dev.toString(), inode: stats.ino.toString() };
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameIdentityValue(left, right) {
  return left.device === right.device && left.inode === right.inode;
}

function sameStableFile(left, right) {
  return left.isFile()
    && right.isFile()
    && left.dev === right.dev
    && left.ino === right.ino
    && left.nlink === 1n
    && right.nlink === 1n
    && left.mode === right.mode
    && left.uid === right.uid
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function canonicalBytes(value) {
  return Buffer.from(serializePersistableJson(value, {
    subject: "openclaw-authority-root-binding",
  }), "utf8");
}

function digestCanonical(value, subject) {
  return digestBytes(Buffer.from(serializePersistableJson(value, { subject }), "utf8"));
}

function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sameKeys(value, keys) {
  return plainObject(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function plainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype
      || Object.getPrototypeOf(value) === null);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function result(errors) {
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

function fail(code = "AGENTMO_OPENCLAW_AUTHORITY_ROOT_BINDING_REJECTED") {
  throw new OpenClawAuthorityRootBindingError(code);
}
