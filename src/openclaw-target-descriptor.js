import { constants as FS_CONSTANTS } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  open,
} from "node:fs/promises";
import path from "node:path";
import { publishOpenClawSafeFsObject } from "./openclaw-safe-fs.js";
import {
  PersistabilityError,
  assertPersistable,
  serializePersistableJson,
} from "./persistability.js";

export const OPENCLAW_TARGET_DESCRIPTOR_SCHEMA_VERSION =
  "agentmo.openclaw-target-descriptor.v1";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const REVISION_PATTERN = /^[a-f0-9]{40}$/u;
const SAFE_RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)(?!.*\0).+$/u;
const INPUT_KEYS = Object.freeze([
  "executablePath",
  "packageJsonPath",
  "buildInfoPath",
  "digests",
]);
const TOP_LEVEL_KEYS = Object.freeze([
  "schemaVersion",
  "target",
  "targetRoot",
  "members",
  "provenance",
  "certificationBoundary",
  "authorityDigest",
]);
const TARGET_KEYS = Object.freeze([
  "id",
  "version",
  "sourceRevision",
  "displayRevision",
  "nodeRange",
]);
const TARGET_ROOT_KEYS = Object.freeze([
  "identityScheme",
  "memberClosureDigest",
  "identityBasis",
]);
const MEMBER_KEYS = Object.freeze([
  "role",
  "relativePath",
  "byteLength",
  "sha256",
  "identityBasis",
]);
const IDENTITY_KEYS = Object.freeze([
  "device",
  "inode",
  "size",
  "mtimeNs",
  "ctimeNs",
]);
const PROVENANCE = Object.freeze({
  authority: "installed-first-party-package-observation",
  packageName: "openclaw",
  observation: "retained-no-follow-read-only",
  versionAuthority: "package-json-and-build-info-exact-match",
  revisionAuthority: "build-info-commit",
  nodeRangeAuthority: "package-json-engines-node",
});
const CERTIFICATION_BOUNDARY = Object.freeze({
  targetIdentityObservationOnly: true,
  sourceQuality: false,
  packageBuilt: false,
  installedByAgentMo: false,
  runtime: false,
  domain: false,
  production: false,
});
const ADMITTED_CANDIDATES = new WeakSet();

export class OpenClawTargetDescriptorError extends Error {
  constructor(code, errors = []) {
    super("OpenClaw target descriptor was rejected.");
    this.name = "OpenClawTargetDescriptorError";
    this.code = code;
    this.errors = Object.freeze([...errors]);
  }
}

export async function buildOpenClawTargetDescriptor(options = {}) {
  if (!plainObject(options)
    || !hasExactKeys(options, INPUT_KEYS)
    || !plainObject(options.digests)
    || !hasExactKeys(options.digests, [
      "target-executable",
      "target-package-json",
      "target-build-info",
    ])
    || Object.values(options.digests).some((digest) => !DIGEST_PATTERN.test(digest))) {
    throw new OpenClawTargetDescriptorError(
      "AGENTMO_OPENCLAW_TARGET_DESCRIPTOR_INPUT_INVALID",
    );
  }
  const rootPath = path.dirname(path.resolve(options.packageJsonPath));
  const rootBefore = await safeDirectoryIdentity(rootPath);
  const requested = [
    ["build-info", options.buildInfoPath, 64 * 1024, options.digests["target-build-info"]],
    ["executable", options.executablePath, 16 * 1024 * 1024, options.digests["target-executable"]],
    ["package-json", options.packageJsonPath, 2 * 1024 * 1024, options.digests["target-package-json"]],
  ];
  const observed = [];
  for (const [role, filePath, maxBytes, expectedDigest] of requested) {
    const absolutePath = path.resolve(filePath);
    const relativePath = path.relative(rootPath, absolutePath);
    if (!portableRelativePath(relativePath)) {
      throw new OpenClawTargetDescriptorError(
        "AGENTMO_OPENCLAW_TARGET_DESCRIPTOR_CROSS_ROOT",
      );
    }
    observed.push(await readRetainedMember({
      role,
      absolutePath,
      relativePath,
      maxBytes,
      expectedDigest,
    }));
  }
  observed.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const rootAfter = await safeDirectoryIdentity(rootPath);
  if (!sameIdentity(rootBefore, rootAfter)) {
    throw new OpenClawTargetDescriptorError(
      "AGENTMO_OPENCLAW_TARGET_DESCRIPTOR_IDENTITY_DRIFT",
    );
  }

  const packageMember = observed.find(({ role }) => role === "package-json");
  const buildInfoMember = observed.find(({ role }) => role === "build-info");
  const packageValue = parseExactJson(packageMember.bytes);
  const buildInfo = parseExactJson(buildInfoMember.bytes);
  const version = packageValue?.version;
  const nodeRange = packageValue?.engines?.node;
  const sourceRevision = buildInfo?.commit;
  if (packageValue?.name !== "openclaw"
    || typeof version !== "string"
    || version.length === 0
    || typeof nodeRange !== "string"
    || nodeRange.length === 0
    || buildInfo?.version !== version
    || !REVISION_PATTERN.test(sourceRevision ?? "")) {
    throw new OpenClawTargetDescriptorError(
      "AGENTMO_OPENCLAW_TARGET_DESCRIPTOR_FIRST_PARTY_INVALID",
    );
  }
  const members = observed.map(({ bytes: _bytes, ...member }) => member);
  const descriptorBasis = {
    schemaVersion: OPENCLAW_TARGET_DESCRIPTOR_SCHEMA_VERSION,
    target: {
      id: "openclaw",
      version,
      sourceRevision,
      displayRevision: sourceRevision.slice(0, 7),
      nodeRange,
    },
    targetRoot: {
      identityScheme: "retained-stat-and-canonical-member-closure-v1",
      memberClosureDigest: digestCanonical(members, "openclaw-target-member-closure"),
      identityBasis: rootAfter,
    },
    members,
    provenance: { ...PROVENANCE },
    certificationBoundary: { ...CERTIFICATION_BOUNDARY },
  };
  const descriptor = {
    ...descriptorBasis,
    authorityDigest: digestCanonical(
      descriptorBasis,
      "openclaw-target-descriptor-authority",
    ),
  };
  const validation = validateOpenClawTargetDescriptor(descriptor);
  if (!validation.ok) {
    throw new OpenClawTargetDescriptorError(
      "AGENTMO_OPENCLAW_TARGET_DESCRIPTOR_INVALID",
      validation.errors,
    );
  }
  assertPersistable(descriptor, { subject: "openclaw-target-descriptor" });
  ADMITTED_CANDIDATES.add(descriptor);
  return deepFreeze(descriptor);
}

export function validateOpenClawTargetDescriptor(value) {
  const errors = [];
  try {
    if (!plainObject(value) || !hasExactKeys(value, TOP_LEVEL_KEYS)) {
      return { ok: false, errors: ["descriptor must contain only canonical fields."] };
    }
    if (value.schemaVersion !== OPENCLAW_TARGET_DESCRIPTOR_SCHEMA_VERSION
      || !plainObject(value.target)
      || !hasExactKeys(value.target, TARGET_KEYS)
      || value.target.id !== "openclaw"
      || typeof value.target.version !== "string"
      || value.target.version.length === 0
      || !REVISION_PATTERN.test(value.target.sourceRevision ?? "")
      || value.target.displayRevision !== value.target.sourceRevision.slice(0, 7)
      || typeof value.target.nodeRange !== "string"
      || value.target.nodeRange.length === 0) {
      errors.push("invalid exact target identity.");
    }
    if (!Array.isArray(value.members)
      || value.members.length !== 3
      || !sameArray(
        value.members.map(({ role }) => role).sort(),
        ["build-info", "executable", "package-json"],
      )
      || !sameArray(
        value.members.map(({ relativePath }) => relativePath),
        value.members.map(({ relativePath }) => relativePath).sort(),
      )) {
      errors.push("invalid exact target member closure.");
    } else {
      for (const member of value.members) {
        if (!plainObject(member)
          || !hasExactKeys(member, MEMBER_KEYS)
          || !portableRelativePath(member.relativePath)
          || !Number.isSafeInteger(member.byteLength)
          || member.byteLength <= 0
          || !DIGEST_PATTERN.test(member.sha256 ?? "")
          || !validIdentity(member.identityBasis)
          || member.identityBasis.size !== String(member.byteLength)) {
          errors.push(`invalid target member ${String(member?.role)}.`);
        }
      }
    }
    if (!plainObject(value.targetRoot)
      || !hasExactKeys(value.targetRoot, TARGET_ROOT_KEYS)
      || value.targetRoot.identityScheme
        !== "retained-stat-and-canonical-member-closure-v1"
      || !validIdentity(value.targetRoot.identityBasis)
      || value.targetRoot.memberClosureDigest
        !== digestCanonical(value.members, "openclaw-target-member-closure")) {
      errors.push("invalid target-root identity.");
    }
    if (!plainObject(value.provenance)
      || !hasExactKeys(value.provenance, Object.keys(PROVENANCE))
      || Object.entries(PROVENANCE)
        .some(([key, expected]) => value.provenance[key] !== expected)) {
      errors.push("invalid target provenance authority.");
    }
    if (!plainObject(value.certificationBoundary)
      || !hasExactKeys(value.certificationBoundary, Object.keys(CERTIFICATION_BOUNDARY))
      || Object.entries(CERTIFICATION_BOUNDARY)
        .some(([key, expected]) => value.certificationBoundary[key] !== expected)) {
      errors.push("invalid target certification boundary.");
    }
    const { authorityDigest: _authorityDigest, ...authorityBasis } = value;
    if (value.authorityDigest
      !== digestCanonical(authorityBasis, "openclaw-target-descriptor-authority")) {
      errors.push("target descriptor authority digest is stale.");
    }
    assertPersistable(value, { subject: "openclaw-target-descriptor" });
  } catch {
    errors.push("unsafe target descriptor shape.");
  }
  return { ok: errors.length === 0, errors };
}

export async function writeOpenClawTargetDescriptor(
  filePath,
  descriptor,
  publicationAuthority,
  hooks = {},
) {
  if (!ADMITTED_CANDIDATES.has(descriptor)) {
    throw new PersistabilityError("AGENTMO_PERSISTABILITY_UNADMITTED_CANDIDATE");
  }
  if (!validateOpenClawTargetDescriptor(descriptor).ok) {
    throw new PersistabilityError("AGENTMO_PERSISTABILITY_INVALID_CANDIDATE");
  }
  if (typeof filePath !== "string" || filePath.length === 0 || filePath.includes("\0")) {
    throw new PersistabilityError("AGENTMO_PERSISTABILITY_INVALID_OUTPUT_PATH");
  }
  assertPublicationAuthority(publicationAuthority);
  assertPublicationHooks(hooks);
  const bytes = serializePersistableJson(descriptor, {
    subject: "openclaw-target-descriptor",
  });
  const expectedDigest = digestRawBytes(Buffer.from(bytes, "utf8"));
  const outputPath = path.resolve(filePath);
  const stagePath = `${outputPath}.agentmo-stage-${process.pid}-${randomUUID()}`;
  let handle;
  let stageIdentity;
  let sourceConsumed = false;
  let published;
  try {
    handle = await open(stagePath, "wx", 0o600);
    stageIdentity = identityBasis(await handle.stat({ bigint: true }));
    await handle.writeFile(bytes, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    stageIdentity = identityBasis(await lstat(stagePath, { bigint: true }));
    const publication = await publishOpenClawSafeFsObject({
      rootPath: path.dirname(outputPath),
      helperPath: publicationAuthority.helperPath,
      receiptPath: publicationAuthority.receiptPath,
      receiptDigest: publicationAuthority.receiptDigest,
      sourceRelativePath: path.basename(stagePath),
      destinationRelativePath: path.basename(outputPath),
      expectedIdentity: {
        device: stageIdentity.device,
        inode: stageIdentity.inode,
        type: "file",
      },
    });
    if (publication.sourceConsumed === true) {
      sourceConsumed = true;
      published = Object.freeze({
        digest: expectedDigest,
        identity: stageIdentity,
      });
    }
    if (publication.disposition !== "published"
      || publication.device !== stageIdentity.device
      || publication.inode !== stageIdentity.inode
      || publication.type !== "file") {
      throw new PersistabilityError(
        "AGENTMO_OPENCLAW_TARGET_DESCRIPTOR_PUBLICATION_REFUSED",
      );
    }
    sourceConsumed = true;
    published ??= Object.freeze({
      digest: expectedDigest,
      identity: stageIdentity,
    });
    await hooks.afterNameCreated?.(Object.freeze({
      kind: "openclaw-target-descriptor",
      expectedDigest,
      expectedIdentity: published.identity,
      sourceConsumed: true,
    }));
    published = await observePublishedFile(outputPath, expectedDigest);
    await hooks.afterPublication?.(Object.freeze({
      kind: "openclaw-target-descriptor",
      expectedDigest,
      expectedIdentity: published.identity,
      sourceConsumed: true,
    }));
    const observed = await observePublishedFile(outputPath, expectedDigest);
    if (!samePublicationIdentity(published.identity, observed.identity)) {
      throw new PersistabilityError(
        "AGENTMO_OPENCLAW_TARGET_DESCRIPTOR_PUBLICATION_IDENTITY_DRIFT",
      );
    }
  } catch (error) {
    if (published === undefined && stageIdentity !== undefined) {
      published = await recoverConsumedPublication(
        outputPath,
        stagePath,
        expectedDigest,
        stageIdentity,
      );
      if (published !== undefined) sourceConsumed = true;
    }
    if (published !== undefined) {
      throw await publicationFailure(
        error,
        "openclaw-target-descriptor",
        published,
        outputPath,
      );
    }
    if (!sourceConsumed && stageIdentity !== undefined) {
      throw await privateTempFailure(
        error,
        "openclaw-target-descriptor",
        stagePath,
        expectedDigest,
        stageIdentity,
      );
    }
    throw error;
  } finally {
    await handle?.close();
  }
  return filePath;
}

async function recoverConsumedPublication(
  outputPath,
  stagePath,
  expectedDigest,
  expectedIdentity,
) {
  try {
    await lstat(stagePath, { bigint: true });
    return undefined;
  } catch (error) {
    if (error?.code !== "ENOENT") return undefined;
  }
  try {
    const observed = await observePublishedFile(outputPath, expectedDigest);
    return samePublicationIdentity(expectedIdentity, observed.identity)
      ? observed
      : undefined;
  } catch {
    return undefined;
  }
}

function assertPublicationAuthority(value) {
  if (!plainObject(value)
    || !hasExactKeys(value, ["helperPath", "receiptPath", "receiptDigest"])
    || !path.isAbsolute(value.helperPath ?? "")
    || !path.isAbsolute(value.receiptPath ?? "")
    || !DIGEST_PATTERN.test(value.receiptDigest ?? "")) {
    throw new PersistabilityError("AGENTMO_PERSISTABILITY_PUBLICATION_AUTHORITY_REQUIRED");
  }
}

function assertPublicationHooks(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => ![
      "afterNameCreated",
      "afterPublication",
    ].includes(key))
    || Object.values(value).some((callback) => typeof callback !== "function")) {
    throw new PersistabilityError("AGENTMO_PERSISTABILITY_INVALID_OUTPUT_PATH");
  }
}

async function observePublishedFile(filePath, expectedDigest) {
  let handle;
  try {
    const before = await lstat(filePath, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) {
      throw new PersistabilityError(
        "AGENTMO_OPENCLAW_TARGET_DESCRIPTOR_PUBLICATION_IDENTITY_DRIFT",
      );
    }
    handle = await open(
      filePath,
      FS_CONSTANTS.O_RDONLY | (FS_CONSTANTS.O_NOFOLLOW ?? 0),
    );
    const opened = await handle.stat({ bigint: true });
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const current = await lstat(filePath, { bigint: true });
    const digest = digestRawBytes(bytes);
    if (!sameStat(before, opened)
      || !sameStat(opened, after)
      || !sameStat(after, current)
      || digest !== expectedDigest) {
      throw new PersistabilityError(
        "AGENTMO_OPENCLAW_TARGET_DESCRIPTOR_PUBLICATION_IDENTITY_DRIFT",
      );
    }
    return Object.freeze({ digest, identity: identityBasis(after) });
  } finally {
    await handle?.close();
  }
}

async function publicationFailure(error, kind, expected, filePath) {
  const failure = error instanceof Error
    ? error
    : new PersistabilityError(
      "AGENTMO_OPENCLAW_TARGET_DESCRIPTOR_PUBLICATION_INCOMPLETE",
    );
  let observedIdentity = null;
  let observedDigest = null;
  try {
    const observed = await observeCurrentFile(filePath);
    observedIdentity = observed.identity;
    observedDigest = observed.digest;
  } catch {
    // Absence or an unsafe current object is itself bounded recovery evidence.
  }
  if (failure.code === undefined) {
    failure.code = "AGENTMO_OPENCLAW_TARGET_DESCRIPTOR_PUBLICATION_INCOMPLETE";
  }
  failure.recoveryRequired = true;
  failure.preservedPublications = Object.freeze([Object.freeze({
    kind,
    disposition: "preserved",
    reason: observedIdentity === null
      ? "published-path-not-safely-observable"
      : "published-object-or-replacement-preserved",
    expectedDigest: expected.digest,
    observedDigest,
    expectedIdentity: expected.identity,
    observedIdentity,
  })]);
  return failure;
}

async function privateTempFailure(error, kind, stagePath, expectedDigest, expectedIdentity) {
  const failure = error instanceof Error
    ? error
    : new PersistabilityError(
      "AGENTMO_OPENCLAW_TARGET_DESCRIPTOR_PUBLICATION_INCOMPLETE",
    );
  let observedIdentity = null;
  let observedDigest = null;
  try {
    const observed = await observeCurrentFile(stagePath);
    observedIdentity = observed.identity;
    observedDigest = observed.digest;
  } catch {
    // Unknown private staging state is retained for explicit recovery.
  }
  if (failure.code === undefined) {
    failure.code = "AGENTMO_OPENCLAW_TARGET_DESCRIPTOR_PUBLICATION_INCOMPLETE";
  }
  failure.recoveryRequired = true;
  failure.preservedPrivateTemps = Object.freeze([Object.freeze({
    kind,
    path: stagePath,
    disposition: "preserved",
    reason: observedIdentity === null
      ? "private-temp-not-safely-observable"
      : "private-temp-preserved-for-recovery",
    expectedDigest,
    observedDigest,
    expectedIdentity,
    observedIdentity,
  })]);
  return failure;
}

async function observeCurrentFile(filePath) {
  let handle;
  try {
    const before = await lstat(filePath, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink()) throw new Error("unsafe publication");
    handle = await open(
      filePath,
      FS_CONSTANTS.O_RDONLY | (FS_CONSTANTS.O_NOFOLLOW ?? 0),
    );
    const opened = await handle.stat({ bigint: true });
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const current = await lstat(filePath, { bigint: true });
    if (!sameStat(before, opened)
      || !sameStat(opened, after)
      || !sameStat(after, current)) {
      throw new Error("publication changed during observation");
    }
    return {
      digest: digestRawBytes(bytes),
      identity: identityBasis(after),
    };
  } finally {
    await handle?.close();
  }
}

function samePublicationIdentity(left, right) {
  return left.device === right.device
    && left.inode === right.inode
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

async function safeDirectoryIdentity(rootPath) {
  try {
    const stat = await lstat(rootPath, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("unsafe directory");
    }
    return identityBasis(stat);
  } catch {
    throw new OpenClawTargetDescriptorError(
      "AGENTMO_OPENCLAW_TARGET_DESCRIPTOR_READ_FAILED",
    );
  }
}

async function readRetainedMember({
  role,
  absolutePath,
  relativePath,
  maxBytes,
  expectedDigest,
}) {
  let handle;
  try {
    const pathBefore = await lstat(absolutePath, { bigint: true });
    if (!pathBefore.isFile() || pathBefore.isSymbolicLink()
      || pathBefore.nlink !== 1n || pathBefore.size <= 0n
      || pathBefore.size > BigInt(maxBytes)) {
      throw new OpenClawTargetDescriptorError(
        "AGENTMO_OPENCLAW_TARGET_DESCRIPTOR_MEMBER_INVALID",
      );
    }
    handle = await open(
      absolutePath,
      FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW,
    );
    const before = await handle.stat({ bigint: true });
    if (!sameStat(pathBefore, before)) {
      throw new OpenClawTargetDescriptorError(
        "AGENTMO_OPENCLAW_TARGET_DESCRIPTOR_IDENTITY_DRIFT",
      );
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const pathAfter = await lstat(absolutePath, { bigint: true });
    if (!sameStat(before, after) || !sameStat(after, pathAfter)) {
      throw new OpenClawTargetDescriptorError(
        "AGENTMO_OPENCLAW_TARGET_DESCRIPTOR_IDENTITY_DRIFT",
      );
    }
    const sha256 = digestRawBytes(bytes);
    if (sha256 !== expectedDigest) {
      throw new OpenClawTargetDescriptorError(
        "AGENTMO_OPENCLAW_TARGET_DESCRIPTOR_DIGEST_MISMATCH",
      );
    }
    return {
      role,
      relativePath,
      byteLength: bytes.length,
      sha256,
      identityBasis: identityBasis(after),
      bytes,
    };
  } catch (error) {
    if (error instanceof OpenClawTargetDescriptorError) throw error;
    throw new OpenClawTargetDescriptorError(
      "AGENTMO_OPENCLAW_TARGET_DESCRIPTOR_READ_FAILED",
    );
  } finally {
    await handle?.close();
  }
}

function parseExactJson(bytes) {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new OpenClawTargetDescriptorError(
      "AGENTMO_OPENCLAW_TARGET_DESCRIPTOR_FIRST_PARTY_INVALID",
    );
  }
}

function identityBasis(stat) {
  return {
    device: String(stat.dev),
    inode: String(stat.ino),
    size: String(stat.size),
    mtimeNs: String(stat.mtimeNs),
    ctimeNs: String(stat.ctimeNs),
  };
}

function sameStat(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function sameIdentity(left, right) {
  return IDENTITY_KEYS.every((key) => left[key] === right[key]);
}

function validIdentity(value) {
  return plainObject(value)
    && hasExactKeys(value, IDENTITY_KEYS)
    && IDENTITY_KEYS.every((key) => /^(?:0|[1-9][0-9]*)$/u.test(value[key] ?? ""));
}

function portableRelativePath(value) {
  return typeof value === "string"
    && value === value.normalize("NFC")
    && SAFE_RELATIVE_PATH.test(value)
    && value.split("/").every((segment) => segment !== "." && segment !== "..");
}

function digestCanonical(value, subject) {
  return digestRawBytes(Buffer.from(serializePersistableJson(value, { subject }), "utf8"));
}

function digestRawBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function plainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype
      || Object.getPrototypeOf(value) === null);
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function sameArray(left, right) {
  return left.length === right.length
    && left.every((item, index) => item === right[index]);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
