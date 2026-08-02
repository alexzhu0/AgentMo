import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdtemp,
  open,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  validateOpenClawInstallDecision,
} from "./openclaw-install-approval.js";
import {
  runApprovedOpenClawCredentialHandoff,
} from "./openclaw-credential-handoff.js";
import {
  assertPersistable,
  serializePersistableJson,
} from "./persistability.js";
import {
  prepareOpenClawProcessSupervisor,
} from "./openclaw-process-supervisor.js";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_CONFIG_BYTES = 40 * 1024;
const AUTHENTIC_PROCESS_RESULTS = new WeakMap();

export class OpenClawOfficialActionError extends Error {
  constructor(
    code = "AGENTMO_OPENCLAW_OFFICIAL_ACTION_REJECTED",
    recovery = null,
  ) {
    super("OpenClaw official action was rejected.");
    this.name = "OpenClawOfficialActionError";
    this.code = code;
    if (recovery !== null) this.recovery = deepFreeze(recovery);
  }
}

export async function runOpenClawOfficialAction(options = {}) {
  if (!plainObject(options)
    || !["config-patch", "credential"].includes(options.route)) {
    fail();
  }
  if (options.route === "credential") {
    return runCredential(options);
  }
  return runConfigPatch(options);
}

export async function prepareOpenClawOfficialActionExecutable(options = {}) {
  if (!sameKeys(options, ["targetRoot", "probe"])
    || !path.isAbsolute(options.targetRoot ?? "")
    || !plainObject(options.probe)
    || !DIGEST_PATTERN.test(options.probe.cli?.executableDigest ?? "")
    || !Array.isArray(options.probe.target?.memberDigests)) {
    fail();
  }
  const executable = options.probe.target.memberDigests.find(
    ({ role }) => role === "executable",
  );
  if (!plainObject(executable)
    || typeof executable.relativePath !== "string"
    || executable.relativePath.includes("\\")
    || path.posix.isAbsolute(executable.relativePath)
    || executable.relativePath.split("/").some((part) => (
      part.length === 0 || part === "." || part === ".."
    ))
    || executable.sha256 !== options.probe.cli.executableDigest) {
    fail();
  }
  const sourcePath = path.resolve(options.targetRoot, executable.relativePath);
  const source = await readVerifiedBytes(sourcePath, executable.sha256);
  const privateRoot = await mkdtemp(
    path.join(tmpdir(), "agentmo-openclaw-official-action-"),
  );
  await chmod(privateRoot, 0o700);
  const privatePath = path.join(privateRoot, "openclaw.mjs");
  const handle = await open(
    privatePath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
      | (constants.O_NOFOLLOW ?? 0),
    0o700,
  );
  try {
    await handle.writeFile(source);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await assertVerifiedFile(privatePath, executable.sha256, 0o700);
  return deepFreeze({
    privateRoot,
    verifiedExecutable: {
      path: privatePath,
      digest: executable.sha256,
    },
  });
}

async function runCredential(options) {
  if (!sameKeys(options, [
    "route",
    "proposal",
    "decision",
    "validation",
    "verifiedExecutable",
    "runProcess",
  ])) {
    fail();
  }
  return runApprovedOpenClawCredentialHandoff({
    proposal: options.proposal,
    decision: options.decision,
    validation: options.validation,
    verifiedExecutable: options.verifiedExecutable,
    runOfficialRoute: options.runProcess ?? spawnVerifiedOpenClaw,
  });
}

async function runConfigPatch(options) {
  if (!sameKeys(options, [
    "route",
    "action",
    "decision",
    "validation",
    "verifiedExecutable",
    "safeFsSession",
    "configRelativePath",
    "configPath",
    "baseObservation",
    "patch",
    "expectedBaseDigest",
    "expectedResultDigest",
    "runProcess",
  ])
    || !validValidation(options.validation)
    || !validVerifiedExecutable(options.verifiedExecutable)
    || !validSafeFsSession(options.safeFsSession)
    || !portableRelativePath(options.configRelativePath)
    || !path.isAbsolute(options.configPath ?? "")
    || !validBaseObservation(options.baseObservation)
    || !plainObject(options.patch)
    || !DIGEST_PATTERN.test(options.expectedBaseDigest ?? "")
    || !DIGEST_PATTERN.test(options.expectedResultDigest ?? "")
    || !validConfigAction(options.action, options.validation.plan)
    || !sameJson(options.decision?.action, options.action)
    || !validateOpenClawInstallDecision(options.decision, {
      plan: options.validation.plan,
      action: options.action,
      now: options.validation.now,
      authorityReservation: options.validation.authorityReservation,
    }).ok
    || !(options.runProcess === null
      || options.runProcess === undefined
      || typeof options.runProcess === "function")) {
    fail();
  }
  const patchBytes = Buffer.from(serializePersistableJson(options.patch, {
    subject: "openclaw-official-config-patch",
  }), "utf8");
  const patchDigest = digestBytes(patchBytes);
  const patchName = `agentmo-config-patch-${patchDigest.slice(7)}.json`;
  const expectedArgv = ["config", "patch", "--file", patchName];
  if (!sameJson(options.action.argv, expectedArgv)) fail();
  const fdTransport = childFdTransport();
  if (fdTransport === null) {
    return unsupportedConfigResult(options, patchDigest);
  }
  await assertVerifiedFile(
    options.verifiedExecutable.path,
    options.verifiedExecutable.digest,
    0o700,
  );
  if (options.baseObservation.digest !== options.expectedBaseDigest) {
    fail("AGENTMO_OPENCLAW_CONFIG_BASE_DRIFT");
  }
  const before = await assertApprovedBaseCurrent(options);

  const privateRoot = path.dirname(options.verifiedExecutable.path);
  const patchPath = path.join(privateRoot, patchName);
  const patchHandle = await open(
    patchPath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
      | (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    await patchHandle.writeFile(patchBytes);
    await patchHandle.sync();
  } finally {
    await patchHandle.close();
  }
  await assertVerifiedFile(patchPath, patchDigest, 0o600);

  const candidate = await createRetainedCandidate(privateRoot, before.bytes);
  try {
    const invocation = Object.freeze({
      executable: options.verifiedExecutable.path,
      executableDigest: options.verifiedExecutable.digest,
      argv: Object.freeze([...expectedArgv]),
      timeoutMs: options.action.timeoutMs,
      shell: false,
      cwd: privateRoot,
      environment: Object.freeze({
        HOME: privateRoot,
        LANG: "C",
        LC_ALL: "C",
        OPENCLAW_CONFIG_PATH: fdTransport.path,
        OPENCLAW_STATE_DIR: privateRoot,
        PATH: "/usr/bin:/bin",
      }),
    });
    const runner = options.runProcess ?? spawnVerifiedOpenClaw;
    await assertApprovedBaseCurrent(options);
    await assertCandidateNameCurrent(candidate);
    const dryRunInvocation = Object.freeze({
      ...invocation,
      argv: Object.freeze([...expectedArgv, "--dry-run"]),
      retainedConfigFd: candidate.dryRunHandle.fd,
    });
    const dryRun = boundedResult(
      await runner(dryRunInvocation),
      dryRunInvocation,
    );
    if (!successful(dryRun)) {
      fail("AGENTMO_OPENCLAW_CONFIG_DRY_RUN_REJECTED");
    }
    await assertCandidateNameCurrent(candidate);
    const afterDryRunCandidate = await inspectCandidate(candidate.handle);
    if (!sameCandidateSnapshot(
      candidate.baseSnapshot,
      afterDryRunCandidate,
    )) {
      fail("AGENTMO_OPENCLAW_CONFIG_DRY_RUN_MUTATED_CANDIDATE");
    }
    await assertApprovedBaseCurrent(options);
    await assertCandidateNameCurrent(candidate);
    const actualInvocation = Object.freeze({
      ...invocation,
      retainedConfigFd: candidate.actualHandle.fd,
    });
    const actual = boundedResult(
      await runner(actualInvocation),
      actualInvocation,
    );
    if (!successful(actual)) {
      fail("AGENTMO_OPENCLAW_CONFIG_ACTUAL_REJECTED");
    }
    await assertCandidateNameCurrent(candidate);
    const resultCandidate = await inspectCandidate(candidate.handle);
    if (!sameCandidateObject(
      candidate.baseSnapshot.identity,
      resultCandidate.identity,
    )
      || resultCandidate.digest !== options.expectedResultDigest) {
      fail("AGENTMO_OPENCLAW_CONFIG_CANDIDATE_RESULT_REJECTED");
    }
    await assertApprovedBaseCurrent(options);
    await assertCandidateNameCurrent(candidate);
    const publication = await options.safeFsSession.replaceExact(
      options.configRelativePath,
      resultCandidate.bytes,
      {
        parentIdentity: baseParentIdentity(options.baseObservation),
        fileIdentity: replacementFileIdentity(options.baseObservation),
        expectedBaseDigest: options.expectedBaseDigest,
        desiredDigest: options.expectedResultDigest,
      },
    );
    if (publication.disposition !== "replaced"
      || publication.digest !== options.expectedResultDigest
      || publication.device !== options.baseObservation.device
      || publication.inode !== options.baseObservation.inode) {
      fail("AGENTMO_OPENCLAW_CONFIG_PUBLICATION_PRESERVED");
    }
    const after = await options.safeFsSession.observe(
      options.configRelativePath,
    );
    if (!samePublishedObservation(
      after,
      options.baseObservation,
      options.expectedResultDigest,
    )) {
      fail("AGENTMO_OPENCLAW_CONFIG_POST_OBSERVATION_FAILED");
    }
    const result = {
      route: "official-openclaw-config-patch",
      actionDigest: digestJson(options.action, "openclaw-official-action"),
      decisionDigest: digestJson(options.decision, "openclaw-install-decision"),
      reservationDigest:
        options.validation.authorityReservation.markerSetDigest,
      nonceDigest: digestBytes(Buffer.from(options.decision.useNonce, "utf8")),
      executableDigest: options.verifiedExecutable.digest,
      patchDigest,
      baseDigest: options.expectedBaseDigest,
      resultDigest: after.digest,
      base: {
        digest: options.expectedBaseDigest,
        parentIdentity: baseParentIdentity(options.baseObservation),
        fileIdentity: replacementFileIdentity(options.baseObservation),
      },
      candidate: {
        transport: fdTransport.kind,
        baseDigest: candidate.baseSnapshot.digest,
        baseIdentity: candidate.baseSnapshot.identity,
        resultDigest: resultCandidate.digest,
        resultIdentity: resultCandidate.identity,
        preservation: {
          pathnameDisposition: "bound",
          retainedNamedObject: true,
          cleanupAttempted: false,
        },
      },
      result: {
        digest: after.digest,
        parentIdentity: baseParentIdentity(after),
        fileIdentity: replacementFileIdentity(after),
      },
      publication: boundedPublication(publication),
      publicationDisposition: publication.disposition,
      invocationDigest: digestJson({
        executableDigest: invocation.executableDigest,
        argv: invocation.argv,
        executionPolicy: "private-root-retained-config-fd",
        configTransport: fdTransport.kind,
        patchDigest,
        target: options.action.target,
      }, "openclaw-official-config-invocation"),
      dryRun,
      actual,
      processGroupFacts: {
        dryRun: processGroupFacts(dryRun),
        actual: processGroupFacts(actual),
      },
      rawOutputPersisted: false,
    };
    assertPersistable(result, { subject: "openclaw-official-action-result" });
    return deepFreeze(result);
  } catch (error) {
    if (error instanceof OpenClawOfficialActionError
      && error.recovery === undefined) {
      error.recovery = deepFreeze(await candidateRecoveryEvidence(candidate));
    }
    throw error;
  } finally {
    await Promise.all([
      candidate.handle.close().catch(() => {}),
      candidate.dryRunHandle.close().catch(() => {}),
      candidate.actualHandle.close().catch(() => {}),
    ]);
  }
}

function validConfigAction(action, plan) {
  return plainObject(action)
    && action.kind === "external-command"
    && action.executable === "openclaw"
    && action.scope === plan?.target?.scope
    && Array.isArray(action.argv)
    && action.argv.length === 4
    && action.argv[0] === "config"
    && action.argv[1] === "patch"
    && action.argv[2] === "--file"
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/u.test(action.argv[3] ?? "")
    && action.environmentNames?.length === 0;
}

function validValidation(value) {
  return plainObject(value)
    && sameKeys(value, ["plan", "now", "authorityReservation", "probe"])
    && typeof value.now === "string"
    && plainObject(value.plan)
    && plainObject(value.authorityReservation)
    && DIGEST_PATTERN.test(value.authorityReservation.markerSetDigest ?? "")
    && plainObject(value.probe);
}

function validVerifiedExecutable(value) {
  return plainObject(value)
    && sameKeys(value, ["path", "digest"])
    && path.isAbsolute(value.path ?? "")
    && DIGEST_PATTERN.test(value.digest ?? "");
}

function validSafeFsSession(value) {
  return value !== null
    && typeof value === "object"
    && typeof value.observe === "function"
    && typeof value.replaceExact === "function";
}

function validBaseObservation(value) {
  return plainObject(value)
    && value.disposition === "observed"
    && DIGEST_PATTERN.test(value.digest ?? "")
    && [
      value.device,
      value.inode,
      value.uid,
      value.parentDevice,
      value.parentInode,
    ].every((entry) => /^\d+$/u.test(entry ?? ""))
    && /^[0-7]{3,4}$/u.test(value.mode ?? "");
}

function portableRelativePath(value) {
  return typeof value === "string"
    && value.length > 0
    && !value.includes("\0")
    && !value.includes("\\")
    && !path.posix.isAbsolute(value)
    && value.split("/").every((part) => (
      part.length > 0 && part !== "." && part !== ".."
    ));
}

async function assertApprovedBaseCurrent(options) {
  const observed = await options.safeFsSession.observe(
    options.configRelativePath,
  );
  if (!samePublishedObservation(
    observed,
    options.baseObservation,
    options.expectedBaseDigest,
  )) {
    fail("AGENTMO_OPENCLAW_CONFIG_BASE_DRIFT");
  }
  return inspectConfig(options.configPath, options.baseObservation);
}

function baseParentIdentity(observation) {
  return {
    device: observation.parentDevice,
    inode: observation.parentInode,
  };
}

function replacementFileIdentity(observation) {
  return {
    device: observation.device,
    inode: observation.inode,
    mode: observation.mode,
    owner: observation.uid,
  };
}

function samePublishedObservation(observed, base, digest) {
  return validBaseObservation(observed)
    && observed.digest === digest
    && observed.device === base.device
    && observed.inode === base.inode
    && observed.mode === base.mode
    && observed.uid === base.uid
    && observed.parentDevice === base.parentDevice
    && observed.parentInode === base.parentInode;
}

function sameStatsWithObservation(stats, observation) {
  return stats.dev.toString() === observation.device
    && stats.ino.toString() === observation.inode
    && (stats.mode & 0o777n).toString(8) === observation.mode
    && stats.uid.toString() === observation.uid;
}

async function createRetainedCandidate(privateRoot, bytes) {
  const candidateRoot = await mkdtemp(
    path.join(privateRoot, "agentmo-config-candidate-"),
  );
  await chmod(candidateRoot, 0o700);
  const candidatePath = path.join(candidateRoot, "candidate.json");
  let writeHandle;
  let handle;
  let dryRunHandle;
  let actualHandle;
  try {
    writeHandle = await open(
      candidatePath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
        | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    await writeHandle.writeFile(bytes);
    await writeHandle.sync();
    await writeHandle.close();
    writeHandle = null;
    [handle, dryRunHandle, actualHandle] = await Promise.all([
      open(candidatePath, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0)),
      open(candidatePath, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0)),
      open(candidatePath, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0)),
    ]);
    const baseSnapshot = await inspectCandidate(handle);
    const [dryRunStats, actualStats] = await Promise.all([
      dryRunHandle.stat({ bigint: true }),
      actualHandle.stat({ bigint: true }),
    ]);
    if (baseSnapshot.digest !== digestBytes(bytes)) {
      fail("AGENTMO_OPENCLAW_CONFIG_CANDIDATE_REJECTED");
    }
    if (!sameCandidateObject(
      baseSnapshot.identity,
      candidateIdentity(dryRunStats),
    ) || !sameCandidateObject(
      baseSnapshot.identity,
      candidateIdentity(actualStats),
    )) {
      fail("AGENTMO_OPENCLAW_CONFIG_CANDIDATE_REJECTED");
    }
    return {
      path: candidatePath,
      handle,
      dryRunHandle,
      actualHandle,
      baseSnapshot,
    };
  } catch (error) {
    await writeHandle?.close().catch(() => {});
    await handle?.close().catch(() => {});
    await dryRunHandle?.close().catch(() => {});
    await actualHandle?.close().catch(() => {});
    if (error instanceof OpenClawOfficialActionError) throw error;
    fail("AGENTMO_OPENCLAW_CONFIG_CANDIDATE_REJECTED");
  }
}

async function assertCandidateNameCurrent(candidate) {
  let current;
  try {
    current = await lstat(candidate.path, { bigint: true });
  } catch {
    fail(
      "AGENTMO_OPENCLAW_CONFIG_CANDIDATE_NAME_DRIFT",
      await candidateRecoveryEvidence(candidate),
    );
  }
  if (!sameCandidateObject(
    candidate.baseSnapshot.identity,
    candidateIdentity(current),
  ) || !current.isFile() || current.nlink !== 1n) {
    fail(
      "AGENTMO_OPENCLAW_CONFIG_CANDIDATE_NAME_DRIFT",
      await candidateRecoveryEvidence(candidate),
    );
  }
}

async function candidateRecoveryEvidence(candidate) {
  let pathnameDisposition = "unknown";
  let pathnameIdentity = null;
  try {
    const current = await lstat(candidate.path, { bigint: true });
    pathnameIdentity = current.isFile() ? candidateIdentity(current) : null;
    pathnameDisposition = pathnameIdentity !== null
      && sameCandidateObject(candidate.baseSnapshot.identity, pathnameIdentity)
      ? "bound"
      : "replaced";
  } catch (error) {
    pathnameDisposition = error?.code === "ENOENT" ? "absent" : "unknown";
  }
  let retainedDisposition = "unknown";
  let retainedIdentity = null;
  let retainedDigest = null;
  try {
    const retained = await inspectCandidate(candidate.handle);
    retainedIdentity = retained.identity;
    retainedDigest = retained.digest;
    retainedDisposition = "preserved";
  } catch {
    // Recovery evidence must remain bounded even when retained inspection fails.
  }
  return {
    disposition: "recovery-required",
    candidate: {
      pathnameDisposition,
      pathnameIdentity,
      retainedDisposition,
      retainedIdentity,
      retainedDigest,
      cleanupAttempted: false,
    },
  };
}

async function inspectCandidate(handle) {
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()
      || before.uid !== BigInt(process.getuid?.() ?? -1)
      || before.nlink !== 1n
      || (before.mode & 0o777n) !== 0o600n
      || before.size <= 0n
      || before.size > BigInt(MAX_CONFIG_BYTES)) {
      fail("AGENTMO_OPENCLAW_CONFIG_CANDIDATE_REJECTED");
    }
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (bytesRead <= 0) {
        fail("AGENTMO_OPENCLAW_CONFIG_CANDIDATE_REJECTED");
      }
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (!sameStableCandidateStats(before, after)) {
      fail("AGENTMO_OPENCLAW_CONFIG_CANDIDATE_REJECTED");
    }
    return {
      bytes,
      digest: digestBytes(bytes),
      identity: candidateIdentity(after),
    };
  } catch (error) {
    if (error instanceof OpenClawOfficialActionError) throw error;
    fail("AGENTMO_OPENCLAW_CONFIG_CANDIDATE_REJECTED");
  }
}

function sameStableCandidateStats(left, right) {
  return left.isFile()
    && right.isFile()
    && left.dev === right.dev
    && left.ino === right.ino
    && left.nlink === right.nlink
    && left.mode === right.mode
    && left.uid === right.uid
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function candidateIdentity(stats) {
  return {
    device: stats.dev.toString(),
    inode: stats.ino.toString(),
    links: stats.nlink.toString(),
    mode: (stats.mode & 0o777n).toString(8),
    owner: stats.uid.toString(),
    size: stats.size.toString(),
    modifiedNs: stats.mtimeNs.toString(),
    changedNs: stats.ctimeNs.toString(),
  };
}

function sameCandidateObject(left, right) {
  return left.device === right.device
    && left.inode === right.inode
    && left.links === right.links
    && left.mode === right.mode
    && left.owner === right.owner;
}

function sameCandidateSnapshot(left, right) {
  return left.digest === right.digest
    && sameCandidateObject(left.identity, right.identity)
    && left.identity.size === right.identity.size
    && left.identity.modifiedNs === right.identity.modifiedNs
    && left.identity.changedNs === right.identity.changedNs;
}

function childFdTransport() {
  if (process.platform === "linux") {
    return { kind: "linux-proc-self-fd", path: "/proc/self/fd/3" };
  }
  return null;
}

function unsupportedConfigResult(options, patchDigest) {
  const result = {
    route: "official-openclaw-config-patch",
    disposition: "unsupported",
    unsupportedReason: "platform-fd-config-transport-unavailable",
    platform: process.platform,
    actionDigest: digestJson(options.action, "openclaw-official-action"),
    decisionDigest: digestJson(
      options.decision,
      "openclaw-install-decision",
    ),
    reservationDigest: options.validation.authorityReservation.markerSetDigest,
    nonceDigest: digestBytes(Buffer.from(options.decision.useNonce, "utf8")),
    executableDigest: options.verifiedExecutable.digest,
    patchDigest,
    baseDigest: options.expectedBaseDigest,
    resultDigest: null,
    base: {
      digest: options.expectedBaseDigest,
      parentIdentity: baseParentIdentity(options.baseObservation),
      fileIdentity: replacementFileIdentity(options.baseObservation),
    },
    result: null,
    publication: {
      disposition: "not-attempted",
      guarantee: null,
      digest: null,
      device: null,
      inode: null,
    },
    publicationDisposition: "not-attempted",
    invocationDigest: null,
    dryRun: null,
    actual: null,
    processGroupFacts: {
      dryRun: {
        processStarted: false,
        processGroupClosed: true,
        quiescenceVerified: true,
      },
      actual: {
        processStarted: false,
        processGroupClosed: true,
        quiescenceVerified: true,
      },
    },
    rawOutputPersisted: false,
  };
  assertPersistable(result, { subject: "openclaw-official-action-result" });
  return deepFreeze(result);
}

function boundedPublication(value) {
  if (!plainObject(value)
    || value.disposition !== "replaced"
    || value.guarantee !== "identity-bound-durable-write"
    || !DIGEST_PATTERN.test(value.digest ?? "")
    || !/^\d+$/u.test(value.device ?? "")
    || !/^\d+$/u.test(value.inode ?? "")) {
    fail("AGENTMO_OPENCLAW_CONFIG_PUBLICATION_PRESERVED");
  }
  return {
    disposition: value.disposition,
    guarantee: value.guarantee,
    digest: value.digest,
    device: value.device,
    inode: value.inode,
  };
}

function processGroupFacts(value) {
  return {
    processStarted: value.processStarted,
    processGroupClosed: value.processGroupClosed,
    quiescenceVerified: value.quiescenceVerified,
    containment: value.containment,
  };
}

async function inspectConfig(filePath, expected) {
  let handle;
  try {
    handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = await handle.stat({ bigint: true });
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const current = await lstat(filePath, { bigint: true });
    if (!before.isFile()
      || before.nlink !== 1n
      || before.uid !== BigInt(process.getuid?.() ?? -1)
      || !sameIdentity(before, after)
      || !sameIdentity(after, current)
      || before.size !== after.size
      || before.mtimeNs !== after.mtimeNs
      || before.ctimeNs !== after.ctimeNs
      || !sameStatsWithObservation(before, expected)) {
      fail("AGENTMO_OPENCLAW_CONFIG_OBSERVATION_REJECTED");
    }
    const digest = digestBytes(bytes);
    if (digest !== expected.digest) {
      fail("AGENTMO_OPENCLAW_CONFIG_BASE_DRIFT");
    }
    return { bytes, digest };
  } catch (error) {
    if (error instanceof OpenClawOfficialActionError) throw error;
    fail("AGENTMO_OPENCLAW_CONFIG_OBSERVATION_REJECTED");
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function readVerifiedBytes(filePath, digest) {
  let handle;
  try {
    handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = await handle.stat({ bigint: true });
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const current = await lstat(filePath, { bigint: true });
    if (!before.isFile()
      || before.nlink !== 1n
      || !sameIdentity(before, after)
      || !sameIdentity(after, current)
      || before.size !== after.size
      || before.mtimeNs !== after.mtimeNs
      || before.ctimeNs !== after.ctimeNs
      || digestBytes(bytes) !== digest) {
      fail("AGENTMO_OPENCLAW_OFFICIAL_EXECUTABLE_REJECTED");
    }
    return bytes;
  } catch (error) {
    if (error instanceof OpenClawOfficialActionError) throw error;
    fail("AGENTMO_OPENCLAW_OFFICIAL_EXECUTABLE_REJECTED");
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function assertVerifiedFile(filePath, digest, mode) {
  let handle;
  try {
    handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = await handle.stat({ bigint: true });
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const current = await lstat(filePath, { bigint: true });
    if (!before.isFile()
      || before.nlink !== 1n
      || (before.mode & 0o777n) !== BigInt(mode)
      || !sameIdentity(before, after)
      || !sameIdentity(after, current)
      || before.size !== after.size
      || before.mtimeNs !== after.mtimeNs
      || before.ctimeNs !== after.ctimeNs
      || digestBytes(bytes) !== digest) {
      fail("AGENTMO_OPENCLAW_OFFICIAL_EXECUTABLE_REJECTED");
    }
  } catch (error) {
    if (error instanceof OpenClawOfficialActionError) throw error;
    fail("AGENTMO_OPENCLAW_OFFICIAL_EXECUTABLE_REJECTED");
  } finally {
    await handle?.close().catch(() => {});
  }
}

export function runOpenClawOfficialProcess(invocation, options = {}) {
  return runSupervisedProcess(invocation, options);
}

async function runSupervisedProcess(invocation, options) {
  if (!validProcessInvocation(invocation)
    || !plainObject(options)
    || !Object.keys(options).every((key) => key === "spawnProcess")
    || !(options.spawnProcess === undefined
      || typeof options.spawnProcess === "function")) {
    return authenticProcessResult(
      supervisorUnavailableResult("invalid-supervisor-invocation"),
      validProcessInvocation(invocation) ? invocation : null,
    );
  }
  let supervisor;
  try {
    supervisor = await prepareOpenClawProcessSupervisor({
      privateRoot: invocation.cwd,
    });
  } catch (error) {
    return authenticProcessResult(
      supervisorUnavailableResult(
        error?.code === "AGENTMO_OPENCLAW_PROCESS_SUPERVISOR_UNSUPPORTED"
          ? "platform-descendant-containment-unavailable"
          : "supervisor-admission-failed",
      ),
      invocation,
    );
  }
  const spawnProcess = options.spawnProcess ?? spawn;
  return new Promise((resolve) => {
    let child;
    try {
      const retainedConfig = Number.isSafeInteger(invocation.retainedConfigFd)
        && invocation.retainedConfigFd >= 0
        ? invocation.retainedConfigFd
        : "ignore";
      child = spawnProcess(
        supervisor.binaryPath,
        [
          "--timeout-ms",
          String(invocation.timeoutMs),
          "--",
          process.execPath,
          invocation.executable,
          ...invocation.argv,
        ],
        {
          cwd: invocation.cwd,
          env: invocation.environment,
          shell: false,
          stdio: ["ignore", "pipe", "pipe", retainedConfig, "pipe"],
          detached: false,
          windowsHide: true,
        },
      );
    } catch {
      resolve(authenticProcessResult(spawnFailureResult(), invocation));
      return;
    }
    let outputBytes = 0;
    let protocolBytes = 0;
    const protocol = [];
    let outputLimitSignaled = false;
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(authenticProcessResult(value, invocation));
    };
    const consumeOutput = (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES && !outputLimitSignaled) {
        outputLimitSignaled = true;
        child.kill("SIGUSR1");
      }
    };
    child.stdout?.on("data", consumeOutput);
    child.stderr?.on("data", consumeOutput);
    child.stdio?.[4]?.on("data", (chunk) => {
      protocolBytes += chunk.length;
      if (protocolBytes > MAX_OUTPUT_BYTES) {
        child.kill("SIGTERM");
        return;
      }
      protocol.push(chunk);
    });
    child.once("error", () => settle(spawnFailureResult()));
    child.once("close", () => {
      if (settled) return;
      let parsed;
      try {
        const bytes = Buffer.concat(protocol);
        const text = new TextDecoder("utf-8", { fatal: true })
          .decode(bytes);
        if (!text.endsWith("\n") || text.trim().includes("\n")) throw new Error();
        parsed = JSON.parse(text);
      } catch {
        settle(supervisorProtocolFailureResult());
        return;
      }
      if (!validSupervisorProtocolResult(parsed)
        || (outputLimitSignaled && !parsed.outputLimitExceeded)) {
        settle(supervisorProtocolFailureResult());
        return;
      }
      settle(Object.freeze(parsed));
    });
  });
}

function validProcessInvocation(value) {
  if (!plainObject(value)) return false;
  const keys = Object.keys(value);
  const expected = [
    "executable",
    "executableDigest",
    "argv",
    "timeoutMs",
    "shell",
    "cwd",
    "environment",
  ];
  if (Object.hasOwn(value, "retainedConfigFd")) expected.push("retainedConfigFd");
  return keys.length === expected.length
    && expected.every((key) => Object.hasOwn(value, key))
    && path.isAbsolute(value.executable ?? "")
    && DIGEST_PATTERN.test(value.executableDigest ?? "")
    && Array.isArray(value.argv)
    && value.argv.every((entry) => typeof entry === "string")
    && Number.isSafeInteger(value.timeoutMs)
    && value.timeoutMs > 0
    && value.timeoutMs <= 3_600_000
    && value.shell === false
    && path.isAbsolute(value.cwd ?? "")
    && plainObject(value.environment)
    && Object.values(value.environment).every(
      (entry) => typeof entry === "string",
    )
    && (!Object.hasOwn(value, "retainedConfigFd")
      || (Number.isSafeInteger(value.retainedConfigFd)
        && value.retainedConfigFd >= 0));
}

function validSupervisorProtocolResult(value) {
  return sameKeys(value, [
    "exitCode",
    "timedOut",
    "outputLimitExceeded",
    "processStarted",
    "processGroupClosed",
    "quiescenceVerified",
    "containment",
    "failureCode",
  ])
    && Number.isSafeInteger(value.exitCode)
    && typeof value.timedOut === "boolean"
    && typeof value.outputLimitExceeded === "boolean"
    && value.processStarted === true
    && typeof value.processGroupClosed === "boolean"
    && typeof value.quiescenceVerified === "boolean"
    && value.containment === "linux-subreaper-pidfd-proc-children"
    && (value.failureCode === null
      || /^[a-z][a-z0-9-]{0,127}$/u.test(value.failureCode));
}

const spawnVerifiedOpenClaw = runOpenClawOfficialProcess;

function boundedResult(value, invocation) {
  if (AUTHENTIC_PROCESS_RESULTS.get(value) !== processInvocationDigest(invocation)
    || !plainObject(value)
    || !Number.isSafeInteger(value.exitCode)
    || typeof value.timedOut !== "boolean"
    || typeof value.outputLimitExceeded !== "boolean"
    || typeof value.processStarted !== "boolean"
    || typeof value.processGroupClosed !== "boolean"
    || typeof value.quiescenceVerified !== "boolean"
    || !(value.containment === "linux-subreaper-pidfd-proc-children"
      || value.containment === null)
    || !(value.failureCode === null
      || /^[a-z][a-z0-9-]{0,127}$/u.test(value.failureCode))) {
    fail("AGENTMO_OPENCLAW_OFFICIAL_RESULT_REJECTED");
  }
  return Object.freeze({
    exitCode: value.exitCode,
    timedOut: value.timedOut,
    outputLimitExceeded: value.outputLimitExceeded,
    processStarted: value.processStarted,
    processGroupClosed: value.processGroupClosed,
    quiescenceVerified: value.quiescenceVerified,
    containment: value.containment,
    failureCode: value.failureCode,
  });
}

function successful(value) {
  return value.exitCode === 0
    && value.timedOut === false
    && value.outputLimitExceeded === false
    && value.processStarted === true
    && value.processGroupClosed === true
    && value.quiescenceVerified === true
    && value.failureCode === null;
}

function spawnFailureResult() {
  return Object.freeze({
    exitCode: 1,
    timedOut: false,
    outputLimitExceeded: false,
    processStarted: false,
    processGroupClosed: true,
    quiescenceVerified: true,
    containment: null,
    failureCode: "spawn-failed",
  });
}

function supervisorUnavailableResult(failureCode) {
  return Object.freeze({
    exitCode: 1,
    timedOut: false,
    outputLimitExceeded: false,
    processStarted: false,
    processGroupClosed: true,
    quiescenceVerified: true,
    containment: null,
    failureCode,
  });
}

function supervisorProtocolFailureResult() {
  return Object.freeze({
    exitCode: 1,
    timedOut: false,
    outputLimitExceeded: false,
    processStarted: true,
    processGroupClosed: false,
    quiescenceVerified: false,
    containment: "linux-subreaper-pidfd-proc-children",
    failureCode: "supervisor-protocol-failed",
  });
}

function authenticProcessResult(value, invocation = null) {
  const result = Object.freeze(value);
  AUTHENTIC_PROCESS_RESULTS.set(
    result,
    invocation === null ? null : processInvocationDigest(invocation),
  );
  return result;
}

function processInvocationDigest(invocation) {
  return digestBytes(Buffer.from(JSON.stringify({
    executable: invocation.executable,
    executableDigest: invocation.executableDigest,
    argv: invocation.argv,
    timeoutMs: invocation.timeoutMs,
    shell: invocation.shell,
    cwd: invocation.cwd,
    environment: invocation.environment,
    retainedConfigFd: invocation.retainedConfigFd ?? null,
  }), "utf8"));
}

function digestJson(value, subject) {
  return digestBytes(Buffer.from(
    serializePersistableJson(value, { subject }),
    "utf8",
  ));
}

function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameJson(left, right) {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
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

function fail(
  code = "AGENTMO_OPENCLAW_OFFICIAL_ACTION_REJECTED",
  recovery = null,
) {
  throw new OpenClawOfficialActionError(code, recovery);
}
