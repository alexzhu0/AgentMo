import { constants as FS_CONSTANTS } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdtemp,
  open,
  rmdir,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { digestRawBytes } from "./artifact-admission.js";
import { assertNoDuplicateJsonMembers } from "./artifact-registry.js";
import { readBoundedNoFollowFile } from "./builder-package.js";
import { assertBuilderPlatform } from "./builder-platform.js";
import {
  canonicalizeDecisionEntryDraft,
  DECISION_ENTRY_MAX_BYTES,
  DECISION_ENTRY_SCHEMA_VERSION,
  diagnoseDecisionEntry,
} from "./decision-ledger.js";
import { auditEvidence } from "./evidence-audit.js";
import { serializePersistableJson } from "./persistability.js";
import { isDeniedDurableLocation } from "./secret-redaction.js";

const RESULT_SCHEMA_VERSION = "agentmo.decision-entry-canonicalization.v1";
const PRIVATE_STAGE_PREFIX = ".agentmo-decision-entry-stage-";
const PRIVATE_STAGE_ENTRY_BASENAME = "entry.json";
const DIRECTORY_FLAGS = FS_CONSTANTS.O_RDONLY
  | FS_CONSTANTS.O_DIRECTORY
  | FS_CONSTANTS.O_NOFOLLOW;
const CREATE_FLAGS = FS_CONSTANTS.O_RDWR
  | FS_CONSTANTS.O_CREAT
  | FS_CONSTANTS.O_EXCL
  | FS_CONSTANTS.O_NOFOLLOW;

export class DecisionEntryCanonicalizationError extends Error {
  constructor(issues) {
    super("Decision entry canonicalization was rejected.");
    this.name = "DecisionEntryCanonicalizationError";
    this.code = "AGENTMO_DECISION_ENTRY_CANONICALIZE_REJECTED";
    this.subject = "decision-entry";
    this.issues = Object.freeze([...new Set(
      Array.isArray(issues)
        ? issues.filter((issue) => typeof issue === "string" && issue.length > 0 && issue.length <= 240)
        : [],
    )].slice(0, 32));
  }
}

export async function canonicalizeDecisionEntryFile(options) {
  if (!isExactOptions(options)) reject(["canonicalization requires one draft entry and one absent output."]);
  const entryPath = path.resolve(options.entryPath);
  const outPath = path.resolve(options.outPath);
  if (isDeniedDurableLocation(entryPath)) {
    reject(["draft entry path is not permitted."]);
  }
  if (isDeniedDurableLocation(outPath)) {
    reject(["canonical output path is not permitted."]);
  }

  const bytes = await readBoundedDraft(entryPath);
  let value;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    assertNoDuplicateJsonMembers(text);
    value = JSON.parse(text);
  } catch {
    reject(["draft entry must be valid bounded UTF-8 JSON."]);
  }
  if (!auditEvidence(value).ok) {
    reject(["draft entry contains prohibited material."]);
  }
  const issues = diagnoseDecisionEntry(value, { requireCanonicalRefs: false });
  if (issues.length > 0) reject(issues);

  let canonical;
  let canonicalBytes;
  try {
    canonical = canonicalizeDecisionEntryDraft(value);
    canonicalBytes = Buffer.from(serializePersistableJson(canonical, {
      subject: "decision-entry",
      maxBytes: DECISION_ENTRY_MAX_BYTES,
    }), "utf8");
  } catch {
    reject(["draft entry contains invalid or prohibited material."]);
  }
  await writeAbsentCanonicalEntry(outPath, canonicalBytes);
  return Object.freeze({
    schemaVersion: RESULT_SCHEMA_VERSION,
    identity: DECISION_ENTRY_SCHEMA_VERSION,
    subject: "decision-entry",
    digest: digestRawBytes(canonicalBytes),
  });
}

function isExactOptions(options) {
  return options !== null
    && typeof options === "object"
    && !Array.isArray(options)
    && Reflect.ownKeys(options).length === 2
    && Object.hasOwn(options, "entryPath")
    && Object.hasOwn(options, "outPath")
    && typeof options.entryPath === "string"
    && options.entryPath.length > 0
    && !options.entryPath.includes("\0")
    && typeof options.outPath === "string"
    && options.outPath.length > 0
    && !options.outPath.includes("\0");
}

async function readBoundedDraft(filePath) {
  try {
    // Reuse the established no-follow, retained-FD reader. It checks the
    // pathname and handle identities before and after its bounded read.
    return await readBoundedNoFollowFile(filePath, DECISION_ENTRY_MAX_BYTES);
  } catch (error) {
    if (error instanceof DecisionEntryCanonicalizationError) throw error;
    reject(["draft entry could not be read safely."]);
  }
}

async function writeAbsentCanonicalEntry(filePath, bytes) {
  let parent;
  let stage;
  try {
    parent = await retainSafeOutputParent(filePath);
    stage = await createPrivateStage(parent);
    await writeCanonicalStage(stage, bytes);
    await assertRetainedOutputParent(parent);
    // Under the documented single-writer precondition, this is the final
    // public-output action. It creates only an absent final component; all
    // subsequent work is private-stage cleanup and never uses filePath.
    await link(stage.entryPath, filePath);
  } catch (error) {
    if (error?.code === "EEXIST") reject(["canonical output must be absent."]);
    if (error instanceof DecisionEntryCanonicalizationError) throw error;
    reject(["canonical output could not be written."]);
  } finally {
    await cleanupPrivateStage(stage);
    await parent?.handle.close().catch(() => {});
  }
}

async function retainSafeOutputParent(filePath) {
  let handle;
  try {
    assertBuilderPlatform();
    const parentPath = path.dirname(filePath);
    const before = await lstat(parentPath, { bigint: true });
    if (!isSafeOutputDirectory(before)) reject(["canonical output parent is not permitted."]);
    handle = await open(parentPath, DIRECTORY_FLAGS);
    const retained = await handle.stat({ bigint: true });
    const current = await lstat(parentPath, { bigint: true });
    if (!sameDirectoryIdentity(before, retained)
      || !sameDirectoryIdentity(retained, current)
      || !isSafeOutputDirectory(retained)
      || !isSafeOutputDirectory(current)) {
      reject(["canonical output parent is not permitted."]);
    }
    await handle.sync();
    return { path: parentPath, handle, stats: retained };
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error instanceof DecisionEntryCanonicalizationError) throw error;
    reject(["canonical output parent is not permitted."]);
  }
}

async function assertRetainedOutputParent(parent) {
  try {
    const retained = await parent.handle.stat({ bigint: true });
    const current = await lstat(parent.path, { bigint: true });
    if (!sameDirectoryIdentity(parent.stats, retained)
      || !sameDirectoryIdentity(retained, current)
      || !isSafeOutputDirectory(retained)
      || !isSafeOutputDirectory(current)) {
      reject(["canonical output parent is not permitted."]);
    }
  } catch (error) {
    if (error instanceof DecisionEntryCanonicalizationError) throw error;
    reject(["canonical output parent is not permitted."]);
  }
}

async function createPrivateStage(parent) {
  let stage;
  let handle;
  try {
    await assertRetainedOutputParent(parent);
    const stagePath = await mkdtemp(path.join(parent.path, PRIVATE_STAGE_PREFIX));
    await chmod(stagePath, 0o700);
    const before = await lstat(stagePath, { bigint: true });
    handle = await open(stagePath, DIRECTORY_FLAGS);
    const retained = await handle.stat({ bigint: true });
    const current = await lstat(stagePath, { bigint: true });
    if (!samePrivateStageDirectory(before, retained)
      || !samePrivateStageDirectory(retained, current)) {
      reject(["canonical output could not be written."]);
    }
    stage = {
      path: stagePath,
      handle,
      stats: retained,
      entryPath: path.join(stagePath, PRIVATE_STAGE_ENTRY_BASENAME),
      entryHandle: null,
      entryStats: null,
    };
    await assertRetainedOutputParent(parent);
    return stage;
  } catch (error) {
    if (stage !== undefined) await cleanupPrivateStage(stage);
    else await handle?.close().catch(() => {});
    // Without a retained stage descriptor, a construction error leaves any
    // private 0700 directory in place rather than deleting by pathname.
    if (error instanceof DecisionEntryCanonicalizationError) throw error;
    reject(["canonical output could not be written."]);
  }
}

async function writeCanonicalStage(stage, bytes) {
  try {
    stage.entryHandle = await open(stage.entryPath, CREATE_FLAGS, 0o600);
    await stage.entryHandle.writeFile(bytes);
    await stage.entryHandle.sync();
    const retained = await stage.entryHandle.stat({ bigint: true });
    const current = await lstat(stage.entryPath, { bigint: true });
    if (!samePrivateStageFile(retained, current, 1n, bytes.byteLength)) {
      reject(["canonical output could not be written."]);
    }
    await assertRetainedCanonicalBytes(stage.entryHandle, bytes, 1n);
    stage.entryStats = retained;
  } catch (error) {
    if (error instanceof DecisionEntryCanonicalizationError) throw error;
    reject(["canonical output could not be written."]);
  }
}

async function assertRetainedCanonicalBytes(handle, expectedBytes, expectedLinks) {
  if (!await hasExactRetainedCanonicalBytes(handle, expectedBytes, expectedLinks)) {
    reject(["canonical output could not be written."]);
  }
}

async function hasExactRetainedCanonicalBytes(handle, expectedBytes, expectedLinks) {
  try {
    const before = await handle.stat({ bigint: true });
    if (!isPrivateStageFile(before, expectedLinks, expectedBytes.byteLength)) return false;
    const captured = Buffer.alloc(expectedBytes.byteLength);
    let position = 0;
    while (position < captured.byteLength) {
      const result = await handle.read(
        captured,
        position,
        captured.byteLength - position,
        position,
      );
      if (!Number.isInteger(result?.bytesRead)
        || result.bytesRead <= 0
        || result.bytesRead > captured.byteLength - position) return false;
      position += result.bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    return samePrivateStageFile(before, after, expectedLinks, expectedBytes.byteLength)
      && captured.equals(expectedBytes);
  } catch {
    return false;
  }
}

async function cleanupPrivateStage(stage) {
  if (!stage) return;
  try {
    const retainedDirectory = await stage.handle?.stat({ bigint: true });
    const directory = await lstat(stage.path, { bigint: true });
    if (!samePrivateStageDirectory(stage.stats, retainedDirectory)
      || !samePrivateStageDirectory(retainedDirectory, directory)) return;
    if (stage.entryStats !== null) {
      const retainedEntry = await stage.entryHandle?.stat({ bigint: true });
      const entry = await lstat(stage.entryPath, { bigint: true });
      // Publishing a hard link necessarily changes ctime and nlink.  Cleanup
      // therefore compares only the stable private-file identity properties;
      // it never uses the public output pathname as rollback authority.
      if (!samePrivateStageFileIdentity(stage.entryStats, retainedEntry)
        || !samePrivateStageFileIdentity(retainedEntry, entry)) return;
      await unlink(stage.entryPath);
    }
    await rmdir(stage.path);
  } catch {
    // A private 0700 staging directory is preserved rather than deleting an
    // unverified replacement. The requested public output is never unlinked.
  } finally {
    await stage.entryHandle?.close().catch(() => {});
    await stage.handle?.close().catch(() => {});
  }
}

function isSafeOutputDirectory(stats) {
  return Boolean(
    stats
    && stats.isDirectory()
    && !stats.isSymbolicLink?.()
    && stats.uid === BigInt(process.getuid())
    && (stats.mode & 0o022n) === 0n,
  );
}

function isPrivateStageDirectory(stats) {
  return Boolean(
    isSafeOutputDirectory(stats)
    && (stats.mode & 0o777n) === 0o700n,
  );
}

function samePrivateStageDirectory(left, right) {
  return Boolean(
    isPrivateStageDirectory(left)
    && isPrivateStageDirectory(right)
    && sameDirectoryIdentity(left, right),
  );
}

function sameDirectoryIdentity(left, right) {
  return Boolean(
    left
    && right
    && left.dev === right.dev
    && left.ino === right.ino
    && left.uid === right.uid
    && left.gid === right.gid
    && (left.mode & 0o777n) === (right.mode & 0o777n),
  );
}

function samePrivateStageFile(left, right, expectedLinks, expectedBytes) {
  return Boolean(
    isPrivateStageFile(left, expectedLinks, expectedBytes)
    && isPrivateStageFile(right, expectedLinks, expectedBytes)
    && samePrivateStageFileObject(left, right),
  );
}

function samePrivateStageFileObject(left, right) {
  return Boolean(
    left
    && right
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs,
  );
}

function samePrivateStageFileIdentity(left, right) {
  return Boolean(
    left
    && right
    && isPrivateStageFileIdentity(left)
    && isPrivateStageFileIdentity(right)
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size,
  );
}

function isPrivateStageFileIdentity(stats) {
  return Boolean(
    stats
    && stats.isFile()
    && !stats.isSymbolicLink?.()
    && stats.uid === BigInt(process.getuid())
    && (stats.mode & 0o077n) === 0n,
  );
}

function isPrivateStageFile(stats, expectedLinks, expectedBytes) {
  return Boolean(
    stats
    && stats.isFile()
    && !stats.isSymbolicLink?.()
    && stats.uid === BigInt(process.getuid())
    && (stats.mode & 0o077n) === 0n
    && stats.nlink === expectedLinks
    && stats.size === BigInt(expectedBytes),
  );
}

function reject(issues) {
  throw new DecisionEntryCanonicalizationError(issues);
}
