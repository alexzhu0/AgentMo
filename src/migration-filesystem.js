import { constants as FS_CONSTANTS } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, open, readdir } from "node:fs/promises";
import path from "node:path";

import {
  buildMigrationReceipt,
  DEFAULT_MAX_MIGRATION_INPUT_BYTES,
  migrationReadFailure,
  planArtifactMigrationBytes,
  serializeMigratedArtifact,
} from "./artifact-migration.js";
import {
  ArtifactAdmissionError,
  digestRawBytes,
  parseDigestBindings,
} from "./artifact-admission.js";
import { transformLegacyArtifact } from "./artifact-registry.js";
import { subjectsForCommand } from "./artifact-subjects.js";
import { stableStringify } from "./evidence-audit.js";
import { assertPersistable } from "./persistability.js";

export const MIGRATION_INSTANCE_MARKER_BASENAME = ".agentmo-migration-instance.json";
export const MIGRATION_RECEIPT_BASENAME = "agentmo-migration-receipt.json";
export const MIGRATION_INSTANCE_MARKER_SCHEMA_VERSION = "agentmo.migration-instance.v1";

const REQUIRED_OPEN_FLAGS = [
  "O_RDONLY",
  "O_WRONLY",
  "O_CREAT",
  "O_EXCL",
  "O_NOFOLLOW",
  "O_DIRECTORY",
];
const DIRECTORY_FLAGS = () => (
  FS_CONSTANTS.O_RDONLY |
  FS_CONSTANTS.O_DIRECTORY |
  FS_CONSTANTS.O_NOFOLLOW
);
const READ_FLAGS = () => FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW;
const CREATE_FLAGS = () => (
  FS_CONSTANTS.O_WRONLY |
  FS_CONSTANTS.O_CREAT |
  FS_CONSTANTS.O_EXCL |
  FS_CONSTANTS.O_NOFOLLOW
);
const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const OPAQUE_TOKEN_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_MARKER_BYTES = 16 * 1024;
const MAX_CANONICAL_OUTPUT_BYTES = DEFAULT_MAX_MIGRATION_INPUT_BYTES * 4;
const MARKER_FIELDS = new Set([
  "schemaVersion",
  "state",
  "instance_id",
  "requested_path_digest",
  "plan_digest",
  "parent_identity",
  "directory_identity",
]);
const IDENTITY_FIELDS = new Set(["dev", "ino"]);
const PLAN_OPTION_FIELDS = new Set(["digests", "maxInputBytes"]);
const APPLY_CONFIGURATION_FIELDS = new Set(["digests", "inputs", "out", "plan"]);
const VERIFY_CONFIGURATION_FIELDS = new Set(["out", "plan"]);

class MigrationInputTooLargeError extends Error {
  constructor() {
    super("Migration input exceeds the bounded read limit.");
    this.code = "AGENTMO_MIGRATION_INPUT_TOO_LARGE";
  }
}

class DestinationIdentityLostError extends Error {
  constructor() {
    super("Migration destination identity is no longer path-bound.");
    this.code = "AGENTMO_MIGRATION_DESTINATION_IDENTITY_LOST";
  }
}

export class MigrationFilesystemError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "MigrationFilesystemError";
    this.code = code;
    if (typeof details.orphan_token === "string") {
      this.orphan_token = details.orphan_token;
    }
  }
}

export async function probeMigrationApplyCapabilities(out) {
  const outPath = normalizeOutPath(out);
  let capability;
  try {
    capability = await acquireParentCapability(outPath);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error?.code === "AGENTMO_MIGRATION_UNSAFE_PARENT"
        ? "unsafe_parent"
        : "platform_unsupported",
    };
  } finally {
    await capability?.parentHandle.close().catch(() => {});
  }
}

export async function planArtifactMigration(suppliedInputs, options = {}) {
  const normalizedOptions = normalizeExactOptions(
    options,
    PLAN_OPTION_FIELDS,
    "Migration plan options",
  );
  const inputs = normalizeMigrationInputs(suppliedInputs);
  const maxInputBytes = normalizeMaxInputBytes(normalizedOptions.maxInputBytes);
  const digests = normalizeMigrationDigests(normalizedOptions.digests, inputs.length);
  const captures = [];

  for (const [index, input] of inputs.entries()) {
    const subject = `migration-input-${index}`;
    try {
      const bytes = await readNoFollowSource(
        input,
        maxInputBytes,
        digests[subject],
      );
      captures.push(bytes);
    } catch (error) {
      if (error instanceof ArtifactAdmissionError) throw error;
      captures.push(migrationReadFailure(
        error?.code === "AGENTMO_MIGRATION_INPUT_TOO_LARGE"
          ? "input_too_large"
          : "read_failed",
      ));
    }
  }

  return planArtifactMigrationBytes(captures, { maxInputBytes });
}

export async function applyArtifactMigration(
  configuration,
  options = {},
) {
  const normalizedConfiguration = normalizeExactOptions(
    configuration,
    APPLY_CONFIGURATION_FIELDS,
    "Migration apply configuration",
    { requireAll: true },
  );
  normalizeExactOptions(options, new Set(), "Migration apply options");
  const {
    inputs: suppliedInputs,
    out,
    plan: suppliedPlan,
    digests: suppliedDigests,
  } = normalizedConfiguration;
  if (!suppliedPlan || typeof suppliedPlan !== "object") {
    throw new TypeError("A migration plan and its input set are required.");
  }
  const inputs = normalizeMigrationInputs(suppliedInputs);
  const digests = normalizeMigrationDigests(suppliedDigests, inputs.length);
  const plan = structuredClone(suppliedPlan);
  let receiptBytes;
  try {
    const receipt = buildMigrationReceipt(plan);
    if (!plan.applicable) throw batchRejectedError();
    receiptBytes = serializePersistableStable(receipt, "migration-receipt");
  } catch (error) {
    if (error instanceof MigrationFilesystemError) throw error;
    throw batchRejectedError();
  }

  const outPath = normalizeOutPath(out);
  await assertOutputAbsent(outPath);

  const orphanToken = randomBytes(32).toString("hex");
  let capability;
  let destination;
  let destinationCreated = false;
  let destinationOwnershipConfirmed = false;
  let stagingMarkerBytes;
  const outputHandles = new Map();

  try {
    capability = await acquireParentCapability(outPath);
    await assertOutputAbsent(outPath);
    await assertParentIdentity(capability);
    await assertOutputParentDistinctFromSources(inputs, capability);
    await probeSourceFileSyncCapability(inputs[0]);
    const payloads = await materializeMigrationOutputs(
      inputs,
      plan,
      digests,
      capability.parentStat,
    );
    const markerTemplateBase = {
      schemaVersion: MIGRATION_INSTANCE_MARKER_SCHEMA_VERSION,
      instance_id: orphanToken,
      requested_path_digest: digestText(outPath),
      plan_digest: plan.plan_digest,
      parent_identity: identityModel(capability.parentStat),
      directory_identity: { dev: "0", ino: "0" },
    };
    serializePersistableStable(
      { ...markerTemplateBase, state: "staging" },
      "migration-instance-marker",
    );
    serializePersistableStable(
      { ...markerTemplateBase, state: "committed" },
      "migration-instance-marker",
    );
    await assertParentIdentity(capability);
    await assertOutputAbsent(outPath);

    try {
      await mkdir(outPath, { mode: 0o700 });
      destinationCreated = true;
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw outputExistsError();
      }
      throw error;
    }

    await assertParentIdentity(capability);
    const createdDirectoryStat = await lstat(outPath, { bigint: true });
    assertOwnedDirectoryStat(createdDirectoryStat);
    await assertParentIdentity(capability);
    const directoryHandle = await open(outPath, DIRECTORY_FLAGS());
    destination = {
      ...capability,
      directoryHandle,
      directoryIdentity: identityModel(createdDirectoryStat),
      directoryStat: createdDirectoryStat,
      orphanToken,
    };
    await assertDestinationIdentity(destination);
    destinationOwnershipConfirmed = true;
    await capability.parentHandle.sync();
    await assertDestinationIdentity(destination);

    const markerBase = {
      schemaVersion: MIGRATION_INSTANCE_MARKER_SCHEMA_VERSION,
      instance_id: orphanToken,
      requested_path_digest: digestText(outPath),
      plan_digest: plan.plan_digest,
      parent_identity: identityModel(capability.parentStat),
      directory_identity: identityModel(createdDirectoryStat),
    };
    stagingMarkerBytes = serializePersistableStable(
      { ...markerBase, state: "staging" },
      "migration-instance-marker",
    );
    const committedMarkerBytes = serializePersistableStable(
      { ...markerBase, state: "committed" },
      "migration-instance-marker",
    );

    await openExclusiveOutputSet(
      destination,
      payloads,
      outputHandles,
    );
    await destination.directoryHandle.sync();
    await assertDestinationIdentity(destination);

    const markerHandle = outputHandles.get(MIGRATION_INSTANCE_MARKER_BASENAME);
    await writeAndSyncRetainedHandle(
      destination,
      markerHandle,
      stagingMarkerBytes,
    );
    for (const payload of payloads) {
      await writeAndSyncRetainedHandle(
        destination,
        outputHandles.get(payload.basename),
        payload.bytes,
      );
    }

    await assertDestinationIdentity(destination);
    await writeAndSyncRetainedHandle(
      destination,
      outputHandles.get(MIGRATION_RECEIPT_BASENAME),
      receiptBytes,
    );
    await assertDestinationIdentity(destination);
    await commitPublicationMarker(
      destination,
      markerHandle,
      committedMarkerBytes,
    );
    await assertDestinationIdentity(destination);
    const verification = await verifyMigrationOutput({ out: outPath, plan });
    if (!verification.ok) {
      throw new Error("Committed migration output did not verify.");
    }
  } catch (error) {
    if (destinationCreated) {
      const markerHandle = outputHandles.get(MIGRATION_INSTANCE_MARKER_BASENAME);
      if (markerHandle && stagingMarkerBytes) {
        await bestEffortRestoreStagingMarker(markerHandle, stagingMarkerBytes);
      }
      if (destinationOwnershipConfirmed) {
        await destination.directoryHandle.chmod(0o700).catch(() => {});
      }
      const identityRetained = destination
        ? await hasDestinationIdentity(destination)
        : false;
      if (!identityRetained) {
        throw new MigrationFilesystemError(
          "AGENTMO_MIGRATION_ORPHANED_STAGING",
          "Migration staging identity was lost and the owned orphan was preserved.",
          { orphan_token: orphanToken },
        );
      }
      if (error instanceof MigrationFilesystemError) throw error;
      throw new MigrationFilesystemError(
        "AGENTMO_MIGRATION_APPLY_FAILED",
        "Migration publication failed before committed verification.",
      );
    }
    if (error instanceof MigrationFilesystemError) throw error;
    throw new MigrationFilesystemError(
      "AGENTMO_MIGRATION_BATCH_REJECTED",
      "Migration apply rejected the in-memory batch before staging.",
    );
  } finally {
    await closeHandles(outputHandles.values());
    await destination?.directoryHandle.close().catch(() => {});
    await capability?.parentHandle.close().catch(() => {});
  }

  return {
    ok: true,
    plan_digest: plan.plan_digest,
  };
}

export async function verifyMigrationOutput(configuration) {
  const { out, plan } = normalizeExactOptions(
    configuration,
    VERIFY_CONFIGURATION_FIELDS,
    "Migration verification configuration",
    { requireAll: true },
  );
  let parentCapability;
  let directoryHandle;
  const openedFiles = [];
  const verifiedFiles = [];
  try {
    const verifiedPlan = structuredClone(plan);
    buildMigrationReceipt(verifiedPlan);
    if (!verifiedPlan.applicable) throw new Error("Non-applicable plan.");
    const outPath = normalizeOutPath(out);
    parentCapability = await acquireParentCapability(outPath);
    directoryHandle = await open(outPath, DIRECTORY_FLAGS());
    const directoryStat = await directoryHandle.stat({ bigint: true });
    const destination = {
      ...parentCapability,
      directoryHandle,
      directoryIdentity: identityModel(directoryStat),
      directoryStat,
    };
    await assertDestinationIdentity(destination);

    const { value: marker, bytes: markerBytes } = await readVerifiedJsonFile(
      destination,
      MIGRATION_INSTANCE_MARKER_BASENAME,
      MAX_MARKER_BYTES,
      openedFiles,
      verifiedFiles,
    );
    validateCommittedMarker(marker, destination, outPath, verifiedPlan);
    if (!markerBytes.equals(serializeStable(marker))) {
      throw new Error("Committed marker bytes are not canonical.");
    }

    const expectedReceiptBytes = serializeStable(buildMigrationReceipt(verifiedPlan));
    const receiptBytes = await readVerifiedFile(
      destination,
      MIGRATION_RECEIPT_BASENAME,
      expectedReceiptBytes.length,
      openedFiles,
      verifiedFiles,
    );
    if (!receiptBytes.equals(expectedReceiptBytes)) throw new Error("Receipt mismatch.");

    const readyItems = verifiedPlan.items.filter((item) => item.result === "ready");
    for (const item of readyItems) {
      const payload = await readVerifiedFile(
        destination,
        item.output_basename,
        MAX_CANONICAL_OUTPUT_BYTES,
        openedFiles,
        verifiedFiles,
      );
      if (digestBytes(payload) !== item.output_digest) {
        throw new Error("Payload digest mismatch.");
      }
    }

    const expectedNames = [
      MIGRATION_INSTANCE_MARKER_BASENAME,
      MIGRATION_RECEIPT_BASENAME,
      ...readyItems.map((item) => item.output_basename),
    ].sort();
    const actualNames = (await readdir(outPath)).sort();
    if (!sameArray(actualNames, expectedNames)) throw new Error("Unexpected output file set.");
    for (const binding of verifiedFiles) {
      await assertOutputHandleBinding(
        destination,
        binding.basename,
        binding.handle,
        binding.stat,
      );
    }
    await assertDestinationIdentity(destination);
    return { ok: true };
  } catch {
    return { ok: false, reason: "verification_failed" };
  } finally {
    await closeHandles(openedFiles);
    await directoryHandle?.close().catch(() => {});
    await parentCapability?.parentHandle.close().catch(() => {});
  }
}

async function acquireParentCapability(outPath) {
  if (
    typeof process.getuid !== "function" ||
    !hasRequiredOpenFlags()
  ) {
    throw platformUnsupportedError();
  }

  const parentPath = path.dirname(outPath);
  let before;
  try {
    before = await lstat(parentPath, { bigint: true });
  } catch {
    throw unsafeParentError();
  }
  assertSafeParentStat(before);

  let parentHandle;
  try {
    parentHandle = await open(parentPath, DIRECTORY_FLAGS());
    const retained = await parentHandle.stat({ bigint: true });
    const after = await lstat(parentPath, { bigint: true });
    assertSafeParentStat(retained);
    assertSafeParentStat(after);
    if (
      !sameIdentity(before, retained) ||
      !sameIdentity(retained, after) ||
      typeof parentHandle.sync !== "function"
    ) {
      throw unsafeParentError();
    }
    try {
      await parentHandle.sync();
    } catch {
      throw platformUnsupportedError();
    }
    const stable = await lstat(parentPath, { bigint: true });
    if (!sameIdentity(retained, stable)) throw unsafeParentError();
    return {
      outPath,
      parentPath,
      parentHandle,
      parentStat: retained,
      parentIdentity: identityModel(retained),
    };
  } catch (error) {
    await parentHandle?.close().catch(() => {});
    if (error instanceof MigrationFilesystemError) throw error;
    if (error?.code === "ELOOP" || error?.code === "ENOTDIR") {
      throw unsafeParentError();
    }
    throw platformUnsupportedError();
  }
}

function hasRequiredOpenFlags() {
  return REQUIRED_OPEN_FLAGS.every((name) => (
    Number.isInteger(FS_CONSTANTS[name]) &&
    (name === "O_RDONLY" || FS_CONSTANTS[name] !== 0)
  ));
}

function assertSafeParentStat(stats) {
  if (
    !stats ||
    typeof stats.isDirectory !== "function" ||
    stats.isSymbolicLink?.() ||
    !stats.isDirectory() ||
    stats.uid !== processUid() ||
    (stats.mode & 0o022n) !== 0n
  ) {
    throw unsafeParentError();
  }
}

function assertOwnedDirectoryStat(stats) {
  if (
    !stats ||
    stats.isSymbolicLink?.() ||
    !stats.isDirectory() ||
    stats.uid !== processUid() ||
    (stats.mode & 0o777n) !== 0o700n
  ) {
    throw new DestinationIdentityLostError();
  }
}

async function assertParentIdentity(capability) {
  try {
    const retained = await capability.parentHandle.stat({ bigint: true });
    const current = await lstat(capability.parentPath, { bigint: true });
    assertSafeParentStat(retained);
    assertSafeParentStat(current);
    if (
      !sameIdentity(retained, capability.parentStat) ||
      !sameIdentity(current, capability.parentStat)
    ) {
      throw new DestinationIdentityLostError();
    }
  } catch (error) {
    if (error instanceof DestinationIdentityLostError) throw error;
    throw new DestinationIdentityLostError();
  }
}

export async function verifyDestinationIdentity(destination) {
  await assertDestinationIdentity(destination);
  return { ok: true };
}

async function assertDestinationIdentity(destination) {
  await assertParentIdentity(destination);
  try {
    const retained = await destination.directoryHandle.stat({ bigint: true });
    const current = await lstat(destination.outPath, { bigint: true });
    if (
      current.isSymbolicLink() ||
      !current.isDirectory() ||
      !retained.isDirectory() ||
      !sameIdentity(retained, destination.directoryStat) ||
      !sameIdentity(current, destination.directoryStat) ||
      retained.uid !== processUid() ||
      current.uid !== processUid() ||
      (retained.mode & 0o777n) !== 0o700n ||
      (current.mode & 0o777n) !== 0o700n
    ) {
      throw new DestinationIdentityLostError();
    }
  } catch (error) {
    if (error instanceof DestinationIdentityLostError) throw error;
    throw new DestinationIdentityLostError();
  }
}

async function hasDestinationIdentity(destination) {
  try {
    await assertDestinationIdentity(destination);
    return true;
  } catch {
    return false;
  }
}

async function assertOutputParentDistinctFromSources(inputs, capability) {
  for (const input of inputs) {
    let sourceParentHandle;
    try {
      const sourceParentPath = path.dirname(path.resolve(input));
      const before = await lstat(sourceParentPath, { bigint: true });
      if (before.isSymbolicLink() || !before.isDirectory()) {
        throw batchRejectedError();
      }
      sourceParentHandle = await open(sourceParentPath, DIRECTORY_FLAGS());
      const retained = await sourceParentHandle.stat({ bigint: true });
      const after = await lstat(sourceParentPath, { bigint: true });
      if (
        !sameIdentity(before, retained) ||
        !sameIdentity(retained, after)
      ) {
        throw batchRejectedError();
      }
      if (sameIdentity(retained, capability.parentStat)) {
        throw batchRejectedError();
      }
    } catch (error) {
      if (error instanceof MigrationFilesystemError) throw error;
      throw batchRejectedError();
    } finally {
      await sourceParentHandle?.close().catch(() => {});
    }
  }
}

async function probeSourceFileSyncCapability(input) {
  let handle;
  try {
    const before = await lstat(input, { bigint: true });
    if (before.isSymbolicLink() || !before.isFile()) throw batchRejectedError();
    handle = await open(input, READ_FLAGS());
    const retained = await handle.stat({ bigint: true });
    if (!retained.isFile() || !sameIdentity(before, retained)) {
      throw batchRejectedError();
    }
    if (typeof handle.sync !== "function") throw platformUnsupportedError();
    try {
      await handle.sync();
    } catch {
      throw platformUnsupportedError();
    }
    const after = await lstat(input, { bigint: true });
    if (!sameStableSourceStat(retained, after)) throw batchRejectedError();
  } catch (error) {
    if (error instanceof MigrationFilesystemError) throw error;
    throw batchRejectedError();
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function materializeMigrationOutputs(inputs, plan, digests, outputParentStat) {
  if (inputs.length !== plan.items.length) {
    throw batchRejectedError();
  }
  const captured = [];
  try {
    for (const [index, input] of inputs.entries()) {
      const subject = `migration-input-${index}`;
      const bytes = await readNoFollowSource(
        input,
        DEFAULT_MAX_MIGRATION_INPUT_BYTES,
        digests[subject],
        outputParentStat,
      );
      captured.push(bytes);
    }
  } catch {
    throw batchRejectedError();
  }
  const recomputed = planArtifactMigrationBytes(captured);
  if (
    !recomputed.applicable ||
    recomputed.plan_digest !== plan.plan_digest ||
    stableStringify(recomputed) !== stableStringify(plan) ||
    captured.length !== inputs.length
  ) {
    throw batchRejectedError();
  }

  const payloads = [];
  for (const [index, item] of plan.items.entries()) {
    if (item.result !== "ready") continue;
    let parsed;
    try {
      parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(captured[index]));
    } catch {
      throw batchRejectedError();
    }
    const bytes = serializeMigratedArtifact(transformLegacyArtifact(parsed));
    if (digestBytes(bytes) !== item.output_digest) throw batchRejectedError();
    payloads.push({
      ordinal: item.ordinal,
      basename: item.output_basename,
      bytes,
    });
  }
  return payloads.sort((left, right) => left.ordinal - right.ordinal);
}

async function readNoFollowSource(
  input,
  maxInputBytes,
  expectedDigest,
  outputParentStat,
) {
  const sourcePath = path.resolve(input);
  const parentPath = path.dirname(sourcePath);
  let parentHandle;
  let before;
  let handle;
  try {
    const parentBefore = await lstat(parentPath, { bigint: true });
    if (parentBefore.isSymbolicLink() || !parentBefore.isDirectory()) {
      throw new Error("Unsafe source parent.");
    }
    parentHandle = await open(parentPath, DIRECTORY_FLAGS());
    const parentRetainedBefore = await parentHandle.stat({ bigint: true });
    const parentAfterOpen = await lstat(parentPath, { bigint: true });
    if (
      !parentRetainedBefore.isDirectory()
      || !sameIdentity(parentBefore, parentRetainedBefore)
      || !sameIdentity(parentRetainedBefore, parentAfterOpen)
      || (outputParentStat && sameIdentity(parentRetainedBefore, outputParentStat))
    ) {
      throw new Error("Unstable source parent.");
    }

    before = await lstat(sourcePath, { bigint: true });
    if (before.isSymbolicLink() || !before.isFile()) throw new Error("Unsafe source.");
    if (before.size > BigInt(maxInputBytes)) throw new MigrationInputTooLargeError();
    handle = await open(sourcePath, READ_FLAGS());
    const retainedBefore = await handle.stat({ bigint: true });
    if (!retainedBefore.isFile() || !sameIdentity(before, retainedBefore)) {
      throw new Error("Unstable source.");
    }
    const bytes = await readHandleBounded(handle, maxInputBytes);
    const retainedAfter = await handle.stat({ bigint: true });
    const current = await lstat(sourcePath, { bigint: true });
    const parentRetainedAfter = await parentHandle.stat({ bigint: true });
    const parentCurrent = await lstat(parentPath, { bigint: true });
    if (
      !sameStableSourceStat(retainedBefore, retainedAfter) ||
      !sameStableSourceStat(retainedAfter, current) ||
      !sameStableSourceStat(parentRetainedBefore, parentRetainedAfter) ||
      !sameStableSourceStat(parentRetainedAfter, parentCurrent)
    ) {
      throw new Error("Unstable source.");
    }
    if (digestRawBytes(bytes) !== expectedDigest) {
      throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_DIGEST_MISMATCH");
    }
    return bytes;
  } finally {
    await handle?.close().catch(() => {});
    await parentHandle?.close().catch(() => {});
  }
}

async function openExclusiveOutputSet(
  destination,
  payloads,
  handles = new Map(),
) {
  const names = [
    MIGRATION_INSTANCE_MARKER_BASENAME,
    ...payloads.map((payload) => payload.basename),
    MIGRATION_RECEIPT_BASENAME,
  ];
  for (const basename of names) {
    await assertDestinationIdentity(destination);
    let handle;
    try {
      handle = await open(
        path.join(destination.outPath, basename),
        CREATE_FLAGS(),
        0o600,
      );
      const stats = await assertOutputHandleBinding(
        destination,
        basename,
        handle,
      );
      handles.set(basename, handle);
      handle = null;
      await assertOutputHandleBinding(
        destination,
        basename,
        handles.get(basename),
        stats,
      );
    } finally {
      await handle?.close().catch(() => {});
    }
  }
  return handles;
}

async function writeAndSyncRetainedHandle(destination, handle, bytes) {
  await assertDestinationIdentity(destination);
  await rawWriteExact(handle, bytes);
  await assertDestinationIdentity(destination);
  await handle.sync();
  await assertDestinationIdentity(destination);
}

async function commitPublicationMarker(
  destination,
  markerHandle,
  committedBytes,
) {
  await writeAndSyncRetainedHandle(
    destination,
    markerHandle,
    committedBytes,
  );
}

async function rawWriteExact(handle, bytes) {
  await handle.truncate(0);
  let position = 0;
  while (position < bytes.length) {
    const result = await handle.write(
      bytes,
      position,
      bytes.length - position,
      position,
    );
    if (!Number.isInteger(result?.bytesWritten) || result.bytesWritten <= 0) {
      throw new Error("Short migration write.");
    }
    position += result.bytesWritten;
  }
  await handle.truncate(bytes.length);
}

async function bestEffortRestoreStagingMarker(markerHandle, stagingBytes) {
  try {
    await rawWriteExact(markerHandle, stagingBytes);
    await markerHandle.sync();
  } catch {
    try {
      await markerHandle.truncate(0);
    } catch {
      // A retained handle is the only cleanup authority; pathname cleanup is forbidden.
    }
  }
}

async function assertOutputHandleBinding(
  destination,
  basename,
  handle,
  expectedStat,
) {
  await assertDestinationIdentity(destination);
  const retained = await handle.stat({ bigint: true });
  const current = await lstat(
    path.join(destination.outPath, basename),
    { bigint: true },
  );
  if (
    current.isSymbolicLink() ||
    !current.isFile() ||
    !retained.isFile() ||
    !sameIdentity(current, retained) ||
    (expectedStat && !sameIdentity(retained, expectedStat)) ||
    retained.uid !== processUid() ||
    current.uid !== processUid() ||
    (retained.mode & 0o777n) !== 0o600n ||
    (current.mode & 0o777n) !== 0o600n
  ) {
    throw new DestinationIdentityLostError();
  }
  return retained;
}

async function readVerifiedJsonFile(
  destination,
  basename,
  maxBytes,
  openedFiles,
  verifiedFiles,
) {
  const bytes = await readVerifiedFile(
    destination,
    basename,
    maxBytes,
    openedFiles,
    verifiedFiles,
  );
  return {
    bytes,
    value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  };
}

async function readVerifiedFile(
  destination,
  basename,
  maxBytes,
  openedFiles,
  verifiedFiles,
) {
  await assertDestinationIdentity(destination);
  const handle = await open(path.join(destination.outPath, basename), READ_FLAGS());
  openedFiles.push(handle);
  const stats = await assertOutputHandleBinding(destination, basename, handle);
  const bytes = await readHandleBounded(handle, maxBytes);
  await assertOutputHandleBinding(destination, basename, handle, stats);
  verifiedFiles.push({ basename, handle, stat: stats });
  return bytes;
}

async function readHandleBounded(handle, maxBytes) {
  const chunks = [];
  let position = 0;
  while (position <= maxBytes) {
    const remaining = maxBytes + 1 - position;
    const chunk = Buffer.alloc(Math.min(64 * 1024, remaining));
    const result = await handle.read(chunk, 0, chunk.length, position);
    if (
      !Number.isInteger(result?.bytesRead) ||
      result.bytesRead < 0 ||
      result.bytesRead > chunk.length
    ) {
      throw new Error("Invalid bounded read.");
    }
    if (result.bytesRead === 0) return Buffer.concat(chunks, position);
    position += result.bytesRead;
    if (position > maxBytes) throw new MigrationInputTooLargeError();
    chunks.push(chunk.subarray(0, result.bytesRead));
  }
  throw new MigrationInputTooLargeError();
}

function validateCommittedMarker(marker, destination, outPath, plan) {
  assertExactObjectFields(marker, MARKER_FIELDS);
  assertExactObjectFields(marker.parent_identity, IDENTITY_FIELDS);
  assertExactObjectFields(marker.directory_identity, IDENTITY_FIELDS);
  if (
    marker.schemaVersion !== MIGRATION_INSTANCE_MARKER_SCHEMA_VERSION ||
    marker.state !== "committed" ||
    !OPAQUE_TOKEN_PATTERN.test(marker.instance_id) ||
    marker.requested_path_digest !== digestText(outPath) ||
    marker.plan_digest !== plan.plan_digest ||
    !SHA256_DIGEST_PATTERN.test(marker.plan_digest) ||
    !sameIdentityModel(marker.parent_identity, destination.parentIdentity) ||
    !sameIdentityModel(marker.directory_identity, destination.directoryIdentity)
  ) {
    throw new Error("Invalid committed marker.");
  }
}

function assertExactObjectFields(value, fields) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== fields.size ||
    Object.keys(value).some((key) => !fields.has(key))
  ) {
    throw new Error("Unexpected marker fields.");
  }
}

function identityModel(stats) {
  return {
    dev: String(stats.dev),
    ino: String(stats.ino),
  };
}

function sameIdentityModel(left, right) {
  return left?.dev === right?.dev && left?.ino === right?.ino;
}

function sameStableSourceStat(left, right) {
  return (
    sameIdentity(left, right) &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function processUid() {
  return BigInt(process.getuid());
}

function serializeStable(value) {
  return Buffer.from(stableStringify(value) + "\n", "utf8");
}

function serializePersistableStable(value, subject) {
  assertPersistable(value, { subject });
  const bytes = serializeStable(value);
  const reparsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  assertPersistable(reparsed, { subject });
  if (!bytes.equals(serializeStable(reparsed))) {
    throw new TypeError("Migration publication bytes are not deterministic.");
  }
  return bytes;
}

function digestText(value) {
  return digestBytes(Buffer.from(value, "utf8"));
}

function digestBytes(bytes) {
  return "sha256:" + createHash("sha256").update(bytes).digest("hex");
}

async function closeHandles(handles) {
  for (const handle of Array.from(handles)) {
    await handle?.close().catch(() => {});
  }
}

function sameArray(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function platformUnsupportedError() {
  return new MigrationFilesystemError(
    "AGENTMO_MIGRATION_PLATFORM_UNSUPPORTED",
    "Migration apply filesystem guarantees are unavailable.",
  );
}

function unsafeParentError() {
  return new MigrationFilesystemError(
    "AGENTMO_MIGRATION_UNSAFE_PARENT",
    "Migration output parent does not meet ownership and mode requirements.",
  );
}

function outputExistsError() {
  return new MigrationFilesystemError(
    "AGENTMO_MIGRATION_OUTPUT_EXISTS",
    "Migration output must not already exist.",
  );
}

function batchRejectedError() {
  return new MigrationFilesystemError(
    "AGENTMO_MIGRATION_BATCH_REJECTED",
    "Migration apply rejected the in-memory batch before staging.",
  );
}

function normalizeMigrationInputs(suppliedInputs) {
  if (
    !Array.isArray(suppliedInputs)
    || suppliedInputs.length === 0
    || suppliedInputs.some(
      (input) => typeof input !== "string" || input.length === 0 || input.includes("\0"),
    )
  ) {
    throw new TypeError("At least one migration input is required.");
  }
  return suppliedInputs.map((input) => path.resolve(input));
}

function normalizeMaxInputBytes(value) {
  const maxInputBytes = value ?? DEFAULT_MAX_MIGRATION_INPUT_BYTES;
  if (!Number.isInteger(maxInputBytes) || maxInputBytes <= 0) {
    throw new TypeError("maxInputBytes must be a positive integer.");
  }
  return maxInputBytes;
}

function normalizeMigrationDigests(value, inputCount) {
  const subjects = subjectsForCommand("migrate", { inputCount });
  if (value === undefined || value === null) {
    return parseDigestBindings([], subjects);
  }
  if (typeof value !== "object" || Array.isArray(value) || Object.getOwnPropertySymbols(value).length > 0) {
    throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_DIGEST_INVALID");
  }
  const bindings = [];
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value") || typeof descriptor.value !== "string") {
      throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_DIGEST_INVALID");
    }
    bindings.push(`${key}=${descriptor.value}`);
  }
  return parseDigestBindings(bindings, subjects);
}

function normalizeExactOptions(value, allowedFields, label, { requireAll = false } = {}) {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.getOwnPropertySymbols(value).length > 0
  ) {
    throw new TypeError(`${label} must be an object with exact fields.`);
  }
  const keys = Object.getOwnPropertyNames(value);
  if (
    keys.some((key) => !allowedFields.has(key))
    || (requireAll && (
      keys.length !== allowedFields.size
      || Array.from(allowedFields).some((key) => !keys.includes(key))
    ))
  ) {
    throw new TypeError(`${label} contain unexpected or missing fields.`);
  }
  const normalized = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor
      || !descriptor.enumerable
      || !Object.hasOwn(descriptor, "value")
    ) {
      throw new TypeError(`${label} must use enumerable data fields.`);
    }
    normalized[key] = descriptor.value;
  }
  return normalized;
}

async function assertOutputAbsent(outPath) {
  try {
    await lstat(outPath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw platformUnsupportedError();
  }
  throw outputExistsError();
}

function normalizeOutPath(out) {
  if (typeof out !== "string" || out.length === 0 || out.includes("\0")) {
    throw new TypeError("A non-empty migration output path is required.");
  }
  return path.resolve(out);
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}
