import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdtemp,
  open,
  readFile,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const OPENCLAW_FS_BUILD_RECEIPT_SCHEMA_VERSION =
  "agentmo.openclaw-fs-build-receipt.v1";
export const OPENCLAW_FS_BUILD_PAIR_SCHEMA_VERSION =
  "agentmo.openclaw-fs-build-pair.v1";
export const OPENCLAW_FS_BUILD_RECOVERY_SCHEMA_VERSION =
  "agentmo.openclaw-fs-build-recovery.v1";

const SOURCE_PATH = fileURLToPath(
  new URL("../native/openclaw-fs-kernel.c", import.meta.url),
);
const COMPILER_PATH = "/usr/bin/cc";
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const SUPPORTED_PLATFORMS = new Set(["darwin", "linux"]);
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOOL_OUTPUT_BYTES = 64 * 1024;
const MAX_PROTOCOL_LINE_BYTES = 64 * 1024;
const BUILD_TIMEOUT_MS = 30_000;
const PROTOCOL_TIMEOUT_MS = 15_000;
const RECEIPT_KEYS = [
  "schemaVersion",
  "kind",
  "platform",
  "arch",
  "source",
  "compiler",
  "argv",
  "environment",
  "environmentDigest",
  "reproducibility",
  "binary",
  "publication",
  "receipt",
];
const SOURCE_KEYS = ["path", "digest", "identity"];
const COMPILER_KEYS = [
  "path",
  "digest",
  "identity",
  "versionDigest",
  "fingerprint",
];
const BINARY_KEYS = ["path", "digest", "identity"];
const REPRODUCIBILITY_KEYS = [
  "strategy",
  "retainedSource",
  "verificationArgv",
  "verificationBinary",
];
const PUBLICATION_KEYS = [
  "schemaVersion",
  "sameParent",
  "binaryParentIdentity",
  "receiptParentIdentity",
];
const RECEIPT_SELF_KEYS = ["path", "identity", "parentIdentity"];
const IDENTITY_KEYS = [
  "device",
  "inode",
  "links",
  "mode",
  "owner",
  "size",
  "modifiedNs",
  "changedNs",
];
const ENVIRONMENT_KEYS = ["HOME", "LANG", "LC_ALL", "PATH", "TMPDIR"];
const CLOSED_ENVIRONMENT_DESCRIPTOR = Object.freeze({
  HOME: "<agentmo-private-home>",
  LANG: "C",
  LC_ALL: "C",
  PATH: "/usr/bin:/bin",
  TMPDIR: "<agentmo-private-tmp>",
});

export class OpenClawSafeFsError extends Error {
  constructor(code, recovery = null) {
    super("OpenClaw safe filesystem operation was rejected.");
    this.name = "OpenClawSafeFsError";
    this.code = code;
    if (recovery !== null) this.recovery = deepFreeze(recovery);
  }
}

export async function buildOpenClawFsKernel(options = {}) {
  assertExactOptions(options, ["binaryOut", "receiptOut"]);
  assertAbsoluteAbsentOutput(options.binaryOut);
  assertAbsoluteAbsentOutput(options.receiptOut);
  if (!SUPPORTED_PLATFORMS.has(process.platform)
    || !["arm64", "x64"].includes(process.arch)) {
    fail("AGENTMO_OPENCLAW_FS_PLATFORM_UNSUPPORTED");
  }
  const binaryOut = path.resolve(options.binaryOut);
  const receiptOut = path.resolve(options.receiptOut);
  if (binaryOut === receiptOut) {
    fail("AGENTMO_OPENCLAW_FS_BUILD_REJECTED");
  }
  const outputParent = path.dirname(binaryOut);
  const receiptParent = path.dirname(receiptOut);
  const parentBinding = await inspectBuildOutputParents(
    outputParent,
    receiptParent,
  );
  const existing = await observeBuildPair({
    binaryOut,
    receiptOut,
    parentBinding,
    created: { binary: false, receipt: false },
    failurePoint: "preflight",
  });
  if (existing.members.some((member) => member.disposition !== "absent")) {
    if (existing.members.every((member) => member.disposition === "preserved")) {
      try {
        const receiptFile = await inspectStableFile(receiptOut);
        const admitted = await admitOpenClawFsKernel({
          helperPath: binaryOut,
          receiptPath: receiptOut,
          receiptDigest: receiptFile.digest,
        });
        return buildKernelResult(
          admitted,
          receiptFile.digest,
          "recovered-and-admitted",
        );
      } catch {
        // The two names exist but do not form the one exact admitted pair.
      }
    }
    const [binaryMember, receiptMember] = existing.members;
    const failurePoint = binaryMember.disposition === "preserved"
      && receiptMember.disposition === "absent"
      ? "preflight-binary-only"
      : "preflight-receipt-incomplete";
    throw new OpenClawSafeFsError(
      "AGENTMO_OPENCLAW_FS_BUILD_REJECTED",
      { ...existing, failurePoint },
    );
  }
  const created = { binary: false, receipt: false };
  let failurePoint = "private-build-root";
  try {
    const buildPrivateRoot = await mkdtemp(
      path.join(outputParent, ".agentmo-openclaw-fs-build-"),
    );
    await chmod(buildPrivateRoot, 0o700);
    const environment = materializeClosedEnvironment(buildPrivateRoot);
    const stagingPath = path.join(
      buildPrivateRoot,
      "openclaw-fs-kernel.stage",
    );
    const verificationPath = stagingPath;
    const retainedSourcePath = path.join(buildPrivateRoot, "kernel-source.c");
    const [source, compiler] = await Promise.all([
      inspectStableFile(SOURCE_PATH),
      inspectCompiler(environment),
    ]);
    const retainedSource = await publishExclusiveFile(
      retainedSourcePath,
      source.bytes,
      0o400,
      () => {},
    );
    const argv = Object.freeze([
      COMPILER_PATH,
      retainedSourcePath,
      "-std=c11",
      "-O2",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-o",
      stagingPath,
    ]);
    failurePoint = "compilation";
    const compilation = await runBoundedProcess(
      COMPILER_PATH,
      argv.slice(1),
      environment,
      BUILD_TIMEOUT_MS,
    );
    if (compilation.code !== 0 || compilation.signal !== null) {
      fail("AGENTMO_OPENCLAW_FS_BUILD_REJECTED");
    }
    await chmod(stagingPath, 0o700);
    const staged = await inspectStableFile(stagingPath);
    const verificationArgv = Object.freeze([
      ...argv.slice(0, -1),
      verificationPath,
    ]);
    const verificationCompilation = await runBoundedProcess(
      COMPILER_PATH,
      verificationArgv.slice(1),
      environment,
      BUILD_TIMEOUT_MS,
    );
    if (verificationCompilation.code !== 0
      || verificationCompilation.signal !== null) {
      fail("AGENTMO_OPENCLAW_FS_BUILD_REJECTED");
    }
    await chmod(verificationPath, 0o700);
    const verificationBinary = await inspectStableFile(verificationPath);
    if (!staged.bytes.equals(verificationBinary.bytes)
      || retainedSource.digest !== source.digest) {
      fail("AGENTMO_OPENCLAW_FS_BUILD_REJECTED");
    }
    const executable = await publishExclusiveFile(
      binaryOut,
      staged.bytes,
      0o700,
      () => {
        created.binary = true;
        failurePoint = "during-binary-publication";
      },
    );
    failurePoint = "after-binary-publication";
    if (executable.digest !== staged.digest) {
      fail("AGENTMO_OPENCLAW_FS_BUILD_REJECTED");
    }
    const receiptHandle = await open(
      receiptOut,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
        | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    created.receipt = true;
    failurePoint = "during-receipt-write";
    let receipt;
    let receiptBytes;
    try {
      const receiptStats = await receiptHandle.stat({ bigint: true });
      const parentStats = await lstat(receiptParent, { bigint: true });
      receipt = {
        schemaVersion: OPENCLAW_FS_BUILD_RECEIPT_SCHEMA_VERSION,
        kind: "agentmo-openclaw-fs-kernel",
        platform: process.platform,
        arch: process.arch,
        source: {
          path: SOURCE_PATH,
          digest: source.digest,
          identity: source.identity,
        },
        compiler,
        argv: [...argv],
        environment: { ...CLOSED_ENVIRONMENT_DESCRIPTOR },
        environmentDigest: digestCanonical(CLOSED_ENVIRONMENT_DESCRIPTOR),
        reproducibility: {
          strategy: "independent-double-build-from-retained-source",
          retainedSource: {
            path: retainedSourcePath,
            digest: retainedSource.digest,
            identity: retainedSource.identity,
          },
          verificationArgv: [...verificationArgv],
          verificationBinary: {
            path: verificationPath,
            digest: verificationBinary.digest,
            identity: verificationBinary.identity,
          },
        },
        binary: {
          path: binaryOut,
          digest: executable.digest,
          identity: executable.identity,
        },
        publication: {
          schemaVersion: OPENCLAW_FS_BUILD_PAIR_SCHEMA_VERSION,
          sameParent: parentBinding.sameParent,
          binaryParentIdentity: parentBinding.binary.identity,
          receiptParentIdentity: parentBinding.receipt.identity,
        },
        receipt: {
          path: receiptOut,
          identity: objectIdentity(receiptStats),
          parentIdentity: directoryIdentity(parentStats),
        },
      };
      receiptBytes = canonicalJsonBytes(receipt);
      await receiptHandle.writeFile(receiptBytes);
      failurePoint = "during-receipt-sync";
      await receiptHandle.sync();
      failurePoint = "after-receipt-sync";
    } finally {
      await receiptHandle.close();
    }
    await syncDirectory(receiptParent);
    await revalidateBuildOutputParents(parentBinding);
    failurePoint = "pair-admission";
    const admitted = await admitOpenClawFsKernel({
      helperPath: binaryOut,
      receiptPath: receiptOut,
      receiptDigest: digestBytes(receiptBytes),
    });
    return buildKernelResult(
      admitted,
      digestBytes(receiptBytes),
      "published-and-admitted",
    );
  } catch (error) {
    if (error instanceof OpenClawSafeFsError && error.recovery !== undefined) {
      throw error;
    }
    const recovery = await observeBuildPair({
      binaryOut,
      receiptOut,
      parentBinding,
      created,
      failurePoint,
    });
    throw new OpenClawSafeFsError(
      "AGENTMO_OPENCLAW_FS_BUILD_REJECTED",
      recovery,
    );
  }
}

export async function admitOpenClawFsKernel(options = {}) {
  try {
    assertExactOptions(options, [
      "helperPath",
      "receiptPath",
      "receiptDigest",
    ]);
    if (!path.isAbsolute(options.helperPath ?? "")
      || !path.isAbsolute(options.receiptPath ?? "")
      || !DIGEST_PATTERN.test(options.receiptDigest ?? "")) {
      fail("AGENTMO_OPENCLAW_FS_ADMISSION_REJECTED");
    }
    const receiptFile = await inspectStableFile(options.receiptPath);
    if (receiptFile.digest !== options.receiptDigest) {
      fail("AGENTMO_OPENCLAW_FS_ADMISSION_REJECTED");
    }
    const receipt = parseClosedReceipt(receiptFile.bytes);
    if (receipt.receipt.path !== path.resolve(options.receiptPath)
      || !sameObjectIdentity(receipt.receipt.identity, receiptFile.identity)
      || !SUPPORTED_PLATFORMS.has(receipt.platform)
      || receipt.platform !== process.platform
      || receipt.arch !== process.arch
      || receipt.source.path !== SOURCE_PATH
      || receipt.compiler.path !== COMPILER_PATH
      || receipt.binary.path !== path.resolve(options.helperPath)
      || receipt.environmentDigest !== digestCanonical(receipt.environment)
      || !same(receipt.environment, CLOSED_ENVIRONMENT_DESCRIPTOR)) {
      fail("AGENTMO_OPENCLAW_FS_ADMISSION_REJECTED");
    }
    const stagingPath = receipt.argv.at(-1);
    const stagingRoot = typeof stagingPath === "string"
      ? path.dirname(stagingPath)
      : "";
    const retainedSourcePath = path.join(stagingRoot, "kernel-source.c");
    const verificationPath = stagingPath;
    if (!path.isAbsolute(stagingPath ?? "")
      || path.basename(stagingPath) !== "openclaw-fs-kernel.stage"
      || path.dirname(stagingRoot) !== path.dirname(options.helperPath)
      || !path.basename(stagingRoot).startsWith(".agentmo-openclaw-fs-build-")) {
      fail("AGENTMO_OPENCLAW_FS_ADMISSION_REJECTED");
    }
    const expectedArgv = [
      COMPILER_PATH,
      retainedSourcePath,
      "-std=c11",
      "-O2",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-o",
      stagingPath,
    ];
    const expectedVerificationArgv = [
      ...expectedArgv.slice(0, -1),
      verificationPath,
    ];
    if (!same(receipt.argv, expectedArgv)
      || receipt.reproducibility.strategy
        !== "independent-double-build-from-retained-source"
      || receipt.reproducibility.retainedSource.path !== retainedSourcePath
      || receipt.reproducibility.verificationBinary.path !== verificationPath
      || !same(
        receipt.reproducibility.verificationArgv,
        expectedVerificationArgv,
      )) {
      fail("AGENTMO_OPENCLAW_FS_ADMISSION_REJECTED");
    }
    const [
      source,
      compiler,
      binary,
      retainedSource,
      verificationBinary,
      binaryParent,
      receiptParent,
    ] = await Promise.all([
      inspectStableFile(SOURCE_PATH),
      inspectCompilerWithFreshClosedEnvironment(),
      inspectStableFile(options.helperPath),
      inspectStableFile(retainedSourcePath),
      inspectStableFile(verificationPath),
      inspectStableDirectory(path.dirname(options.helperPath)),
      inspectStableDirectory(path.dirname(options.receiptPath)),
    ]);
    if (source.digest !== receipt.source.digest
      || !sameFileObject(source.identity, receipt.source.identity)
      || compiler.digest !== receipt.compiler.digest
      || !sameFileObject(compiler.identity, receipt.compiler.identity)
      || compiler.versionDigest !== receipt.compiler.versionDigest
      || compiler.fingerprint !== receipt.compiler.fingerprint
      || binary.digest !== receipt.binary.digest
      || !sameFileObject(binary.identity, receipt.binary.identity)
      || retainedSource.digest !== receipt.source.digest
      || retainedSource.digest
        !== receipt.reproducibility.retainedSource.digest
      || !sameFileObject(
        retainedSource.identity,
        receipt.reproducibility.retainedSource.identity,
      )
      || verificationBinary.digest !== binary.digest
      || verificationBinary.digest
        !== receipt.reproducibility.verificationBinary.digest
      || !sameFileObject(
        verificationBinary.identity,
        receipt.reproducibility.verificationBinary.identity,
      )
      || !sameDirectoryObject(
        binaryParent.identity,
        receipt.publication.binaryParentIdentity,
      )
      || !sameDirectoryObject(
        receiptParent.identity,
        receipt.publication.receiptParentIdentity,
      )
      || receipt.publication.sameParent !== sameDirectoryObject(
        binaryParent.identity,
        receiptParent.identity,
      )
      || !sameDirectoryObject(
        receipt.receipt.parentIdentity,
        receipt.publication.receiptParentIdentity,
      )) {
      fail("AGENTMO_OPENCLAW_FS_ADMISSION_REJECTED");
    }
    return deepFreeze({
      receipt,
      helper: {
        path: path.resolve(options.helperPath),
        digest: binary.digest,
        identity: binary.identity,
        bytes: binary.bytes,
      },
    });
  } catch (error) {
    if (error instanceof OpenClawSafeFsError
      && error.code === "AGENTMO_OPENCLAW_FS_ADMISSION_REJECTED") {
      throw error;
    }
    fail("AGENTMO_OPENCLAW_FS_ADMISSION_REJECTED");
  }
}

export async function openOpenClawSafeFsSession(options = {}) {
  assertExactOptions(options, [
    "rootPath",
    "helperPath",
    "receiptPath",
    "receiptDigest",
  ]);
  if (!path.isAbsolute(options.rootPath ?? "")) {
    fail("AGENTMO_OPENCLAW_FS_SESSION_REJECTED");
  }
  const admitted = await admitOpenClawFsKernel({
    helperPath: options.helperPath,
    receiptPath: options.receiptPath,
    receiptDigest: options.receiptDigest,
  });
  const rootStats = await lstat(options.rootPath, { bigint: true });
  if (!rootStats.isDirectory()
    || rootStats.isSymbolicLink()
    || rootStats.uid !== BigInt(process.getuid?.() ?? -1)
    || (rootStats.mode & 0o022n) !== 0n) {
    fail("AGENTMO_OPENCLAW_FS_SESSION_REJECTED");
  }
  const executionRoot = await mkdtemp(
    path.join(tmpdir(), "agentmo-openclaw-fs-exec-"),
  );
  await chmod(executionRoot, 0o700);
  const executionPath = path.join(executionRoot, "openclaw-fs-kernel");
  const executionHandle = await open(
    executionPath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
      | (constants.O_NOFOLLOW ?? 0),
    0o700,
  );
  try {
    await executionHandle.writeFile(admitted.helper.bytes);
    await executionHandle.sync();
  } finally {
    await executionHandle.close();
  }
  await syncDirectory(executionRoot);
  const executionBefore = await inspectStableFile(executionPath);
  if (executionBefore.digest !== admitted.helper.digest) {
    fail("AGENTMO_OPENCLAW_FS_SESSION_REJECTED");
  }
  const child = spawn(executionPath, [], {
    cwd: executionRoot,
    env: {
      LANG: "C",
      LC_ALL: "C",
      PATH: "/usr/bin:/bin",
    },
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const protocol = createProtocol(child);
  let executionAfter;
  try {
    executionAfter = await inspectStableFile(executionPath);
  } catch {
    await protocol.abort();
    fail("AGENTMO_OPENCLAW_FS_SESSION_REJECTED");
  }
  if (executionAfter.digest !== admitted.helper.digest
    || !sameFileObject(executionBefore.identity, executionAfter.identity)) {
    await protocol.abort();
    fail("AGENTMO_OPENCLAW_FS_SESSION_REJECTED");
  }
  const opened = await protocol.request({
    operation: "open",
    rootPath: path.resolve(options.rootPath),
    device: rootStats.dev.toString(),
    inode: rootStats.ino.toString(),
  });
  if (opened.disposition !== "opened") {
    await protocol.abort();
    fail("AGENTMO_OPENCLAW_FS_SESSION_REJECTED");
  }
  let closed = false;
  return Object.freeze({
    rootIdentity: Object.freeze({
      device: opened.device,
      inode: opened.inode,
    }),
    async observe(relativePath) {
      if (closed) fail("AGENTMO_OPENCLAW_FS_SESSION_CLOSED");
      assertRelativePath(relativePath);
      return protocol.request({ operation: "observe", path: relativePath });
    },
    async createOnly(relativePath, bytes, mode) {
      if (closed) fail("AGENTMO_OPENCLAW_FS_SESSION_CLOSED");
      assertRelativePath(relativePath);
      if (!Buffer.isBuffer(bytes)
        || bytes.length === 0
        || bytes.length > 40 * 1024
        || ![0o600, 0o644, 0o700, 0o755].includes(mode)) {
        fail("AGENTMO_OPENCLAW_FS_REQUEST_REJECTED");
      }
      return protocol.request({
        operation: "create-only",
        path: relativePath,
        contentBase64: bytes.toString("base64"),
        mode: mode.toString(8),
      });
    },
    // This is an identity-bound durable write to one retained inode. It is not
    // a crash-atomic compare-and-swap and never reopens a replacement pathname.
    async replaceExact(relativePath, bytes, expected) {
      if (closed) fail("AGENTMO_OPENCLAW_FS_SESSION_CLOSED");
      assertRelativePath(relativePath);
      assertExactReplacement(expected);
      if (!Buffer.isBuffer(bytes)
        || bytes.length === 0
        || bytes.length > 40 * 1024) {
        fail("AGENTMO_OPENCLAW_FS_REQUEST_REJECTED");
      }
      return protocol.request({
        operation: "replace-exact",
        path: relativePath,
        contentBase64: bytes.toString("base64"),
        parentDevice: expected.parentIdentity.device,
        parentInode: expected.parentIdentity.inode,
        fileDevice: expected.fileIdentity.device,
        fileInode: expected.fileIdentity.inode,
        fileMode: expected.fileIdentity.mode,
        fileOwner: expected.fileIdentity.owner,
        expectedBaseDigest: expected.expectedBaseDigest,
        desiredDigest: expected.desiredDigest,
      });
    },
    async publishNoReplace(
      sourceRelativePath,
      destinationRelativePath,
      expectedIdentity,
    ) {
      if (closed) fail("AGENTMO_OPENCLAW_FS_SESSION_CLOSED");
      assertRelativePath(sourceRelativePath);
      assertRelativePath(destinationRelativePath);
      assertPublicationIdentity(expectedIdentity);
      return protocol.request({
        operation: "publish-no-replace",
        sourcePath: sourceRelativePath,
        destinationPath: destinationRelativePath,
        sourceDevice: expectedIdentity.device,
        sourceInode: expectedIdentity.inode,
        sourceType: expectedIdentity.type,
      });
    },
    async reserveMarker(relativePath, bytes) {
      if (closed) fail("AGENTMO_OPENCLAW_FS_SESSION_CLOSED");
      assertRelativePath(relativePath);
      if (!Buffer.isBuffer(bytes)
        || bytes.length === 0
        || bytes.length > 40 * 1024) {
        fail("AGENTMO_OPENCLAW_FS_REQUEST_REJECTED");
      }
      const reserved = await protocol.request({
        operation: "reserve-marker",
        path: relativePath,
      });
      if (reserved.disposition !== "reserved") return reserved;
      return protocol.request({
        operation: "finalize-marker",
        path: relativePath,
        contentBase64: bytes.toString("base64"),
      });
    },
    async close() {
      if (closed) {
        return Object.freeze({
          disposition: "preserved",
          reason: "private-execution-copy-not-unlinked-by-pathname",
        });
      }
      closed = true;
      await protocol.request({ operation: "close" });
      await protocol.done();
      return Object.freeze({
        disposition: "preserved",
        reason: "private-execution-copy-not-unlinked-by-pathname",
      });
    },
  });
}

export async function publishOpenClawSafeFsObject(options = {}) {
  assertExactOptions(options, [
    "rootPath",
    "helperPath",
    "receiptPath",
    "receiptDigest",
    "sourceRelativePath",
    "destinationRelativePath",
    "expectedIdentity",
  ]);
  const session = await openOpenClawSafeFsSession({
    rootPath: options.rootPath,
    helperPath: options.helperPath,
    receiptPath: options.receiptPath,
    receiptDigest: options.receiptDigest,
  });
  try {
    return await session.publishNoReplace(
      options.sourceRelativePath,
      options.destinationRelativePath,
      options.expectedIdentity,
    );
  } finally {
    await session.close();
  }
}

function createProtocol(child) {
  let stdout = "";
  let stderrBytes = 0;
  let exited = false;
  let exitCode = null;
  let active = null;
  const queued = [];
  const finishActive = (error, value) => {
    const current = active;
    active = null;
    if (!current) return;
    clearTimeout(current.timer);
    if (error) current.reject(error);
    else current.resolve(value);
    pump();
  };
  const rejectAll = () => {
    const error = new OpenClawSafeFsError(
      "AGENTMO_OPENCLAW_FS_PROTOCOL_REJECTED",
    );
    finishActive(error);
    while (queued.length > 0) queued.shift().reject(error);
  };
  const pump = () => {
    if (active || queued.length === 0) return;
    if (exited) {
      rejectAll();
      return;
    }
    active = queued.shift();
    active.timer = setTimeout(() => {
      child.kill("SIGKILL");
      rejectAll();
    }, PROTOCOL_TIMEOUT_MS);
    child.stdin.write(active.line);
  };
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    if (Buffer.byteLength(stdout) > MAX_PROTOCOL_LINE_BYTES) {
      child.kill("SIGKILL");
      rejectAll();
      return;
    }
    const newline = stdout.indexOf("\n");
    if (newline === -1) return;
    const line = stdout.slice(0, newline);
    stdout = stdout.slice(newline + 1);
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      child.kill("SIGKILL");
      rejectAll();
      return;
    }
    if (!plainObject(value) || value.ok !== true) {
      child.kill("SIGKILL");
      rejectAll();
      return;
    }
    finishActive(null, deepFreeze(value));
  });
  child.stderr.on("data", (chunk) => {
    stderrBytes += chunk.length;
    if (stderrBytes > MAX_TOOL_OUTPUT_BYTES) child.kill("SIGKILL");
  });
  const exitPromise = new Promise((resolve) => {
    child.on("close", async (code) => {
      exited = true;
      exitCode = code;
      if (active || queued.length > 0) rejectAll();
      resolve();
    });
  });
  return Object.freeze({
    request(value) {
      const line = `${JSON.stringify(value)}\n`;
      if (Buffer.byteLength(line) > MAX_PROTOCOL_LINE_BYTES) {
        fail("AGENTMO_OPENCLAW_FS_REQUEST_REJECTED");
      }
      return new Promise((resolve, reject) => {
        queued.push({ line, resolve, reject, timer: null });
        pump();
      });
    },
    async abort() {
      child.kill("SIGKILL");
      await exitPromise;
    },
    async done() {
      child.stdin.end();
      await exitPromise;
      if (exitCode !== 0) fail("AGENTMO_OPENCLAW_FS_PROTOCOL_REJECTED");
    },
  });
}

async function inspectCompiler(environment) {
  const compilerRealPath = await realpath(COMPILER_PATH);
  const file = await inspectStableFile(compilerRealPath, {
    allowMultipleLinks: true,
  });
  const version = await runBoundedProcess(
    COMPILER_PATH,
    ["--version"],
    environment,
    BUILD_TIMEOUT_MS,
  );
  if (version.code !== 0 || version.signal !== null) {
    fail("AGENTMO_OPENCLAW_FS_ADMISSION_REJECTED");
  }
  const versionDigest = digestBytes(Buffer.concat([
    version.stdout,
    Buffer.from([0]),
    version.stderr,
  ]));
  const fingerprint = digestCanonical({
    path: COMPILER_PATH,
    digest: file.digest,
    identity: file.identity,
    versionDigest,
  });
  return deepFreeze({
    path: COMPILER_PATH,
    digest: file.digest,
    identity: file.identity,
    versionDigest,
    fingerprint,
  });
}

async function inspectCompilerWithFreshClosedEnvironment() {
  const root = await mkdtemp(
    path.join(tmpdir(), "agentmo-openclaw-fs-toolchain-"),
  );
  await chmod(root, 0o700);
  return inspectCompiler(materializeClosedEnvironment(root));
}

function materializeClosedEnvironment(privateRoot) {
  return Object.freeze({
    HOME: privateRoot,
    LANG: CLOSED_ENVIRONMENT_DESCRIPTOR.LANG,
    LC_ALL: CLOSED_ENVIRONMENT_DESCRIPTOR.LC_ALL,
    PATH: CLOSED_ENVIRONMENT_DESCRIPTOR.PATH,
    TMPDIR: privateRoot,
  });
}

async function runBoundedProcess(executable, argv, environment, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, argv, {
      env: environment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);
    const collect = (target, chunk, stream) => {
      if (settled) return;
      if (stream === "stdout") stdoutBytes += chunk.length;
      else stderrBytes += chunk.length;
      if (stdoutBytes > MAX_TOOL_OUTPUT_BYTES
        || stderrBytes > MAX_TOOL_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", (chunk) => collect(stdout, chunk, "stdout"));
    child.stderr.on("data", (chunk) => collect(stderr, chunk, "stderr"));
    child.on("error", (error) => {
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (stdoutBytes > MAX_TOOL_OUTPUT_BYTES
        || stderrBytes > MAX_TOOL_OUTPUT_BYTES) {
        reject(new Error("bounded output exceeded"));
        return;
      }
      resolve({
        code,
        signal,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      });
    });
  });
}

async function inspectStableFile(filePath, options = {}) {
  let handle;
  try {
    handle = await open(
      path.resolve(filePath),
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()
      || before.isSymbolicLink()
      || (!options.allowMultipleLinks && before.nlink !== 1n)
      || (options.allowMultipleLinks && before.nlink < 1n)
      || before.size < 0n
      || before.size > BigInt(MAX_FILE_BYTES)) {
      fail("AGENTMO_OPENCLAW_FS_ADMISSION_REJECTED");
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const current = await lstat(path.resolve(filePath), { bigint: true });
    if (!sameStableStats(before, after)
      || !sameStableStats(after, current)
      || BigInt(bytes.length) !== after.size) {
      fail("AGENTMO_OPENCLAW_FS_ADMISSION_REJECTED");
    }
    return deepFreeze({
      bytes,
      digest: digestBytes(bytes),
      identity: fileIdentity(after),
    });
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function inspectStableDirectory(directoryPath) {
  let handle;
  try {
    handle = await open(
      path.resolve(directoryPath),
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0)
        | (constants.O_NOFOLLOW ?? 0),
    );
    const before = await handle.stat({ bigint: true });
    const current = await lstat(path.resolve(directoryPath), { bigint: true });
    if (!before.isDirectory()
      || before.isSymbolicLink()
      || !current.isDirectory()
      || current.isSymbolicLink()
      || before.dev !== current.dev
      || before.ino !== current.ino
      || before.uid !== current.uid
      || before.mode !== current.mode
      || before.uid !== BigInt(process.getuid?.() ?? -1)
      || (before.mode & 0o022n) !== 0n) {
      fail("AGENTMO_OPENCLAW_FS_ADMISSION_REJECTED");
    }
    return deepFreeze({
      identity: directoryIdentity(before),
    });
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function inspectBuildOutputParents(binaryParent, receiptParent) {
  let binary;
  let receipt;
  try {
    [binary, receipt] = await Promise.all([
      inspectStableDirectory(binaryParent),
      inspectStableDirectory(receiptParent),
    ]);
  } catch {
    fail("AGENTMO_OPENCLAW_FS_BUILD_REJECTED");
  }
  return deepFreeze({
    sameParent: sameDirectoryObject(binary.identity, receipt.identity),
    binary: {
      path: binaryParent,
      identity: binary.identity,
    },
    receipt: {
      path: receiptParent,
      identity: receipt.identity,
    },
  });
}

async function revalidateBuildOutputParents(parentBinding) {
  const [binary, receipt] = await Promise.all([
    inspectStableDirectory(parentBinding.binary.path),
    inspectStableDirectory(parentBinding.receipt.path),
  ]);
  if (!sameDirectoryObject(binary.identity, parentBinding.binary.identity)
    || !sameDirectoryObject(receipt.identity, parentBinding.receipt.identity)
    || sameDirectoryObject(binary.identity, receipt.identity)
      !== parentBinding.sameParent) {
    fail("AGENTMO_OPENCLAW_FS_BUILD_REJECTED");
  }
}

async function observeBuildPair(options) {
  const [binary, receipt, binaryParent, receiptParent] = await Promise.all([
    observeBuildMember(
      options.binaryOut,
      "helper-binary",
      options.created.binary,
    ),
    observeBuildMember(
      options.receiptOut,
      "build-receipt",
      options.created.receipt,
    ),
    observeBuildParent(options.parentBinding.binary),
    observeBuildParent(options.parentBinding.receipt),
  ]);
  return deepFreeze({
    schemaVersion: OPENCLAW_FS_BUILD_RECOVERY_SCHEMA_VERSION,
    failurePoint: options.failurePoint,
    disposition: "recovery-required",
    retry: "exact-pair-admission-required",
    sameParent: options.parentBinding.sameParent,
    parents: [
      { role: "binary-output-parent", ...binaryParent },
      { role: "receipt-output-parent", ...receiptParent },
    ],
    members: [binary, receipt],
  });
}

async function observeBuildParent(binding) {
  try {
    const observed = await inspectStableDirectory(binding.path);
    return {
      expectedIdentity: binding.identity,
      observedIdentity: observed.identity,
      disposition: sameDirectoryObject(binding.identity, observed.identity)
        ? "bound"
        : "replaced",
    };
  } catch {
    return {
      expectedIdentity: binding.identity,
      observedIdentity: null,
      disposition: "unknown",
    };
  }
}

async function observeBuildMember(filePath, role, created) {
  try {
    const observed = await inspectStableFile(filePath);
    return {
      role,
      state: created ? "created" : "preserved",
      digest: observed.digest,
      identity: observed.identity,
      disposition: "preserved",
    };
  } catch {
    try {
      await lstat(filePath, { bigint: true });
      return {
        role,
        state: "unknown",
        digest: null,
        identity: null,
        disposition: "unknown",
      };
    } catch (error) {
      if (error?.code !== "ENOENT") {
        return {
          role,
          state: "unknown",
          digest: null,
          identity: null,
          disposition: "unknown",
        };
      }
      return {
        role,
        state: "unknown",
        digest: null,
        identity: null,
        disposition: "absent",
      };
    }
  }
}

function buildKernelResult(admitted, receiptDigest, disposition) {
  const pair = {
    schemaVersion: OPENCLAW_FS_BUILD_PAIR_SCHEMA_VERSION,
    disposition,
    sameParent: admitted.receipt.publication.sameParent,
    parents: [
      {
        role: "binary-output-parent",
        identity: admitted.receipt.publication.binaryParentIdentity,
        disposition: "bound",
      },
      {
        role: "receipt-output-parent",
        identity: admitted.receipt.publication.receiptParentIdentity,
        disposition: "bound",
      },
    ],
    members: [
      {
        role: "helper-binary",
        digest: admitted.receipt.binary.digest,
        identity: admitted.receipt.binary.identity,
        disposition: "admitted",
      },
      {
        role: "build-receipt",
        digest: receiptDigest,
        identity: admitted.receipt.receipt.identity,
        disposition: "admitted",
      },
    ],
  };
  return deepFreeze({
    binaryPath: admitted.receipt.binary.path,
    receiptPath: admitted.receipt.receipt.path,
    receipt: admitted.receipt,
    receiptDigest,
    pair,
    privateBuildCleanup: {
      disposition: "preserved",
      reason: "private-build-objects-not-unlinked-by-pathname",
    },
  });
}

function parseClosedReceipt(bytes) {
  let receipt;
  try {
    receipt = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail("AGENTMO_OPENCLAW_FS_ADMISSION_REJECTED");
  }
  if (!sameKeys(receipt, RECEIPT_KEYS)
    || receipt.schemaVersion !== OPENCLAW_FS_BUILD_RECEIPT_SCHEMA_VERSION
    || receipt.kind !== "agentmo-openclaw-fs-kernel"
    || !sameKeys(receipt.source, SOURCE_KEYS)
    || !sameKeys(receipt.compiler, COMPILER_KEYS)
    || !sameKeys(receipt.reproducibility, REPRODUCIBILITY_KEYS)
    || !sameKeys(receipt.reproducibility.retainedSource, BINARY_KEYS)
    || !sameKeys(receipt.reproducibility.verificationBinary, BINARY_KEYS)
    || !sameKeys(receipt.binary, BINARY_KEYS)
    || !sameKeys(receipt.publication, PUBLICATION_KEYS)
    || !sameKeys(receipt.receipt, RECEIPT_SELF_KEYS)
    || !validIdentity(receipt.source.identity)
    || !validIdentity(receipt.compiler.identity)
    || !validIdentity(receipt.reproducibility.retainedSource.identity)
    || !validIdentity(receipt.reproducibility.verificationBinary.identity)
    || !validIdentity(receipt.binary.identity)
    || receipt.publication.schemaVersion
      !== OPENCLAW_FS_BUILD_PAIR_SCHEMA_VERSION
    || typeof receipt.publication.sameParent !== "boolean"
    || !validDirectoryIdentity(receipt.publication.binaryParentIdentity)
    || !validDirectoryIdentity(receipt.publication.receiptParentIdentity)
    || !validDirectoryIdentity(receipt.receipt.identity)
    || !validDirectoryIdentity(receipt.receipt.parentIdentity)
    || !sameKeys(receipt.environment, ENVIRONMENT_KEYS)
    || !Array.isArray(receipt.argv)
    || !receipt.argv.every((value) => typeof value === "string")
    || !Array.isArray(receipt.reproducibility.verificationArgv)
    || !receipt.reproducibility.verificationArgv.every(
      (value) => typeof value === "string",
    )
    || ![
      receipt.source.digest,
      receipt.compiler.digest,
      receipt.compiler.versionDigest,
      receipt.compiler.fingerprint,
      receipt.environmentDigest,
      receipt.reproducibility.retainedSource.digest,
      receipt.reproducibility.verificationBinary.digest,
      receipt.binary.digest,
    ].every((value) => DIGEST_PATTERN.test(value ?? ""))) {
    fail("AGENTMO_OPENCLAW_FS_ADMISSION_REJECTED");
  }
  if (!canonicalJsonBytes(receipt).equals(bytes)) {
    fail("AGENTMO_OPENCLAW_FS_ADMISSION_REJECTED");
  }
  return deepFreeze(receipt);
}

async function syncDirectory(directoryPath) {
  const handle = await open(
    directoryPath,
    constants.O_RDONLY | (constants.O_DIRECTORY ?? 0)
      | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function publishExclusiveFile(filePath, bytes, mode, onCreated) {
  let handle;
  let publishedIdentity;
  try {
    handle = await open(
      filePath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
        | (constants.O_NOFOLLOW ?? 0),
      mode,
    );
    onCreated();
    await handle.writeFile(bytes);
    await handle.sync();
    const stats = await handle.stat({ bigint: true });
    publishedIdentity = fileIdentity(stats);
  } catch {
    fail("AGENTMO_OPENCLAW_FS_BUILD_REJECTED");
  } finally {
    await handle?.close().catch(() => {});
  }
  await syncDirectory(path.dirname(filePath));
  const published = await inspectStableFile(filePath);
  if (published.digest !== digestBytes(bytes)
    || !sameFileObject(published.identity, publishedIdentity)) {
    fail("AGENTMO_OPENCLAW_FS_BUILD_REJECTED");
  }
  return published;
}

function assertAbsoluteAbsentOutput(value) {
  if (typeof value !== "string"
    || !path.isAbsolute(value)
    || value.includes("\0")) {
    fail("AGENTMO_OPENCLAW_FS_BUILD_REJECTED");
  }
}

function assertRelativePath(value) {
  if (typeof value !== "string"
    || value.length === 0
    || value.includes("\0")
    || value.includes("\\")
    || path.posix.isAbsolute(value)
    || value.split("/").some((part) => (
      part.length === 0 || part === "." || part === ".."
    ))) {
    fail("AGENTMO_OPENCLAW_FS_REQUEST_REJECTED");
  }
}

function assertExactOptions(value, keys) {
  if (!sameKeys(value, keys)) fail("AGENTMO_OPENCLAW_FS_ARGUMENTS_REJECTED");
}

function assertPublicationIdentity(value) {
  if (!plainObject(value)
    || !sameKeys(value, ["device", "inode", "type"])
    || !/^\d+$/u.test(value.device ?? "")
    || !/^\d+$/u.test(value.inode ?? "")
    || !["file", "directory"].includes(value.type)) {
    fail("AGENTMO_OPENCLAW_FS_REQUEST_REJECTED");
  }
}

function assertExactReplacement(value) {
  if (!plainObject(value)
    || !sameKeys(value, [
      "parentIdentity",
      "fileIdentity",
      "expectedBaseDigest",
      "desiredDigest",
    ])
    || !plainObject(value.parentIdentity)
    || !sameKeys(value.parentIdentity, ["device", "inode"])
    || !plainObject(value.fileIdentity)
    || !sameKeys(value.fileIdentity, [
      "device",
      "inode",
      "mode",
      "owner",
    ])
    || ![
      value.parentIdentity.device,
      value.parentIdentity.inode,
      value.fileIdentity.device,
      value.fileIdentity.inode,
      value.fileIdentity.owner,
    ].every((entry) => /^\d+$/u.test(entry ?? ""))
    || !/^[0-7]{3,4}$/u.test(value.fileIdentity.mode ?? "")
    || !DIGEST_PATTERN.test(value.expectedBaseDigest ?? "")
    || !DIGEST_PATTERN.test(value.desiredDigest ?? "")) {
    fail("AGENTMO_OPENCLAW_FS_REQUEST_REJECTED");
  }
}

function validIdentity(value) {
  return sameKeys(value, IDENTITY_KEYS)
    && ["device", "inode", "links", "owner", "size", "modifiedNs", "changedNs"]
      .every((key) => /^\d+$/u.test(value[key] ?? ""))
    && /^[0-7]{3,4}$/u.test(value.mode ?? "");
}

function validDirectoryIdentity(value) {
  return plainObject(value)
    && sameKeys(value, ["device", "inode", "mode", "owner"])
    && ["device", "inode", "owner"].every(
      (key) => /^\d+$/u.test(value[key] ?? ""),
    )
    && /^[0-7]{3,4}$/u.test(value.mode ?? "");
}

function fileIdentity(stats) {
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

function directoryIdentity(stats) {
  return {
    device: stats.dev.toString(),
    inode: stats.ino.toString(),
    mode: (stats.mode & 0o777n).toString(8),
    owner: stats.uid.toString(),
  };
}

function objectIdentity(stats) {
  return {
    device: stats.dev.toString(),
    inode: stats.ino.toString(),
    mode: (stats.mode & 0o777n).toString(8),
    owner: stats.uid.toString(),
  };
}

function sameStableStats(left, right) {
  return left.isFile()
    && right.isFile()
    && left.dev === right.dev
    && left.ino === right.ino
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mode === right.mode
    && left.uid === right.uid
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function sameFileObject(left, right) {
  return left.device === right.device
    && left.inode === right.inode
    && left.links === right.links
    && left.size === right.size
    && left.mode === right.mode
    && left.owner === right.owner
    && left.modifiedNs === right.modifiedNs
    && left.changedNs === right.changedNs;
}

function sameObjectIdentity(left, right) {
  return left.device === right.device
    && left.inode === right.inode
    && left.mode === right.mode
    && left.owner === right.owner;
}

function sameDirectoryObject(left, right) {
  return sameObjectIdentity(left, right);
}

function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function digestCanonical(value) {
  return digestBytes(canonicalJsonBytes(value));
}

function canonicalJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
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
  if (ArrayBuffer.isView(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function fail(code) {
  throw new OpenClawSafeFsError(code);
}
