import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdtemp,
  open,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  NATIVE_BUILD_CAPTURE_PRELOAD_DIGEST,
  NATIVE_BUILD_CAPTURE_TRANSPORT,
  captureIndependentNativeBuilds,
} from "./native-build-capture.js";

const SOURCE_PATH = fileURLToPath(
  new URL("../native/openclaw-process-supervisor.c", import.meta.url),
);
const COMPILER_PATH = "/usr/bin/cc";
const COMPILER_SOURCE_DESCRIPTOR = 0;
const COMPILER_OUTPUT_DESCRIPTOR = 4;
const COMPILER_SOURCE_PATH = "-";
const COMPILER_OUTPUT_PATH = `/proc/self/fd/${COMPILER_OUTPUT_DESCRIPTOR}`;
const RECEIPT_SCHEMA_VERSION =
  "agentmo.openclaw-process-supervisor-receipt.v3";
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOOL_OUTPUT_BYTES = 64 * 1024;
const BUILD_TIMEOUT_MS = 30_000;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;

export class OpenClawProcessSupervisorError extends Error {
  constructor(code = "AGENTMO_OPENCLAW_PROCESS_SUPERVISOR_REJECTED") {
    super("OpenClaw process supervisor was rejected.");
    this.name = "OpenClawProcessSupervisorError";
    this.code = code;
  }
}

export async function prepareOpenClawProcessSupervisor(options = {}) {
  if (!sameKeys(options, ["privateRoot"])
    || !path.isAbsolute(options.privateRoot ?? "")) {
    fail();
  }
  if (process.platform !== "linux" || process.arch !== "x64") {
    fail("AGENTMO_OPENCLAW_PROCESS_SUPERVISOR_UNSUPPORTED");
  }
  await inspectPrivateRoot(options.privateRoot);
  const buildRoot = await mkdtemp(
    path.join(options.privateRoot, "agentmo-process-supervisor-"),
  );
  await chmod(buildRoot, 0o700);
  const binaryPath = path.join(buildRoot, "supervisor");
  const receiptPath = path.join(buildRoot, "supervisor.receipt.json");
  const environment = Object.freeze({
    HOME: buildRoot,
    LANG: "C",
    LC_ALL: "C",
    PATH: "/usr/bin:/bin",
    TMPDIR: buildRoot,
  });
  let retainedSourceHandle;
  try {
    const source = await retainStableFile(SOURCE_PATH);
    retainedSourceHandle = source.handle;
    const compiler = await inspectCompiler(environment);
    const argv = [
      "-x",
      "c",
      COMPILER_SOURCE_PATH,
      "-std=c11",
      "-O2",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-o",
      COMPILER_OUTPUT_PATH,
    ];
    const verificationArgv = [...argv];
    const capturedBuild = await captureIndependentNativeBuilds({
      buildRoot,
      compilerArgs: argv,
      compilerPath: COMPILER_PATH,
      environment,
      maxOutputBytes: MAX_TOOL_OUTPUT_BYTES,
      sourceBytes: source.bytes,
      timeoutMs: BUILD_TIMEOUT_MS,
    });
    const primaryOutput = capturedBuild.primary;
    const verificationOutput = capturedBuild.verification;
    const retainedSource = await inspectRetainedFile(
      retainedSourceHandle,
      source.identity,
    );
    if (!primaryOutput.bytes.equals(verificationOutput.bytes)
      || retainedSource.digest !== source.digest
      || !sameJson(retainedSource.identity, source.identity)
      || sameUnderlyingFile(
        primaryOutput.identity,
        verificationOutput.identity,
      )) fail();
    const binary = await writeExclusiveFile(
      binaryPath,
      primaryOutput.bytes,
      0o700,
    );
    if (binary.digest !== primaryOutput.digest) fail();
    const receipt = {
      schemaVersion: RECEIPT_SCHEMA_VERSION,
      kind: "linux-subreaper-pidfd-proc-children",
      platform: process.platform,
      arch: process.arch,
      source: boundedFileAuthority(SOURCE_PATH, source),
      compiler: {
        path: COMPILER_PATH,
        realPath: compiler.realPath,
        digest: compiler.digest,
        identity: compiler.identity,
        versionDigest: compiler.versionDigest,
      },
      argv: [COMPILER_PATH, ...argv],
      environment: {
        HOME: "<agentmo-private-home>",
        LANG: "C",
        LC_ALL: "C",
        PATH: "/usr/bin:/bin",
        TMPDIR: "<agentmo-private-tmp>",
      },
      reproducibility: {
        strategy:
          "preloaded-nondumpable-double-build-to-sealed-memfd",
        isolation: {
          transport: capturedBuild.transport,
          preloadDigest: capturedBuild.preload.digest,
          preloadIdentity: capturedBuild.preload.identity,
        },
        source: retainedFdAuthority(
          COMPILER_SOURCE_DESCRIPTOR,
          COMPILER_SOURCE_PATH,
          retainedSource,
        ),
        primaryArgv: [COMPILER_PATH, ...argv],
        primaryOutput: retainedFdAuthority(
          COMPILER_OUTPUT_DESCRIPTOR,
          COMPILER_OUTPUT_PATH,
          primaryOutput,
        ),
        verificationArgv: [COMPILER_PATH, ...verificationArgv],
        verificationOutput: retainedFdAuthority(
          COMPILER_OUTPUT_DESCRIPTOR,
          COMPILER_OUTPUT_PATH,
          verificationOutput,
        ),
      },
      binary: boundedFileAuthority(binaryPath, binary),
    };
    const receiptBytes = canonicalBytes(receipt);
    const receiptHandle = await open(
      receiptPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
        | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    try {
      await receiptHandle.writeFile(receiptBytes);
      await receiptHandle.sync();
    } finally {
      await receiptHandle.close();
    }
    const receiptDigest = digestBytes(receiptBytes);
    const admitted = await admitOpenClawProcessSupervisor({
      binaryPath,
      receiptPath,
      receiptDigest,
    });
    const retainedBinary = await retainVerifiedExecutable(
      admitted.binaryPath,
      admitted.binaryDigest,
      admitted.binaryIdentity,
    );
    return Object.freeze({
      ...admitted,
      retainedBinary,
    });
  } catch (error) {
    if (error instanceof OpenClawProcessSupervisorError) throw error;
    fail();
  } finally {
    await Promise.all([
      retainedSourceHandle?.close().catch(() => {}),
    ]);
  }
}

export async function admitOpenClawProcessSupervisor(options = {}) {
  try {
    if (!sameKeys(options, ["binaryPath", "receiptPath", "receiptDigest"])
      || !path.isAbsolute(options.binaryPath ?? "")
      || !path.isAbsolute(options.receiptPath ?? "")
      || !DIGEST_PATTERN.test(options.receiptDigest ?? "")) {
      fail();
    }
    const receiptFile = await inspectStableFile(options.receiptPath);
    if (receiptFile.digest !== options.receiptDigest) fail();
    let receipt;
    try {
      receipt = JSON.parse(receiptFile.bytes.toString("utf8"));
    } catch {
      fail();
    }
    if (!sameKeys(receipt, [
      "schemaVersion",
      "kind",
      "platform",
      "arch",
      "source",
      "compiler",
      "argv",
      "environment",
      "reproducibility",
      "binary",
    ])
      || receipt.schemaVersion
        !== RECEIPT_SCHEMA_VERSION
      || receipt.kind !== "linux-subreaper-pidfd-proc-children"
      || receipt.platform !== "linux"
      || receipt.platform !== process.platform
      || receipt.arch !== process.arch
      || !canonicalBytes(receipt).equals(receiptFile.bytes)
      || !validFileAuthority(receipt.source)
      || !sameKeys(receipt.compiler, [
        "path",
        "realPath",
        "digest",
        "identity",
        "versionDigest",
      ])
      || !validIdentity(receipt.compiler.identity)
      || !DIGEST_PATTERN.test(receipt.compiler.digest ?? "")
      || !DIGEST_PATTERN.test(receipt.compiler.versionDigest ?? "")
      || !validFileAuthority(receipt.binary)
      || !sameKeys(receipt.reproducibility, [
        "strategy",
        "isolation",
        "source",
        "primaryArgv",
        "primaryOutput",
        "verificationArgv",
        "verificationOutput",
      ])
      || receipt.reproducibility.strategy
        !== "preloaded-nondumpable-double-build-to-sealed-memfd"
      || !sameKeys(receipt.reproducibility.isolation, [
        "transport",
        "preloadDigest",
        "preloadIdentity",
      ])
      || receipt.reproducibility.isolation.transport
        !== NATIVE_BUILD_CAPTURE_TRANSPORT
      || receipt.reproducibility.isolation.preloadDigest
        !== NATIVE_BUILD_CAPTURE_PRELOAD_DIGEST
      || !validIdentity(receipt.reproducibility.isolation.preloadIdentity)
      || !validCompilerSourceAuthority(receipt.reproducibility.source)
      || !Array.isArray(receipt.reproducibility.primaryArgv)
      || !receipt.reproducibility.primaryArgv.every(
        (value) => typeof value === "string",
      )
      || !validRetainedFdAuthority(receipt.reproducibility.primaryOutput)
      || !Array.isArray(receipt.reproducibility.verificationArgv)
      || !receipt.reproducibility.verificationArgv.every(
        (value) => typeof value === "string",
      )
      || !validRetainedFdAuthority(receipt.reproducibility.verificationOutput)
      || receipt.source.path !== SOURCE_PATH
      || receipt.compiler.path !== COMPILER_PATH
      || receipt.binary.path !== path.resolve(options.binaryPath)
      || !sameJson(receipt.environment, {
        HOME: "<agentmo-private-home>",
        LANG: "C",
        LC_ALL: "C",
        PATH: "/usr/bin:/bin",
        TMPDIR: "<agentmo-private-tmp>",
      })) {
      fail();
    }
    const buildRoot = path.dirname(options.binaryPath);
    const expectedArgv = [
      COMPILER_PATH,
      "-x",
      "c",
      COMPILER_SOURCE_PATH,
      "-std=c11",
      "-O2",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-o",
      COMPILER_OUTPUT_PATH,
    ];
    if (!sameJson(receipt.argv, expectedArgv)
      || !sameJson(receipt.reproducibility.primaryArgv, expectedArgv)
      || !sameJson(
        receipt.reproducibility.verificationArgv,
        expectedArgv,
      )
      || receipt.reproducibility.source.descriptor
        !== COMPILER_SOURCE_DESCRIPTOR
      || receipt.reproducibility.source.path !== COMPILER_SOURCE_PATH
      || receipt.reproducibility.primaryOutput.descriptor
        !== COMPILER_OUTPUT_DESCRIPTOR
      || receipt.reproducibility.primaryOutput.path !== COMPILER_OUTPUT_PATH
      || receipt.reproducibility.verificationOutput.descriptor
        !== COMPILER_OUTPUT_DESCRIPTOR
      || receipt.reproducibility.verificationOutput.path
        !== COMPILER_OUTPUT_PATH
      || sameUnderlyingFile(
        receipt.reproducibility.primaryOutput.identity,
        receipt.reproducibility.verificationOutput.identity,
      )
      || path.dirname(options.receiptPath) !== buildRoot
      || !path.basename(buildRoot).startsWith("agentmo-process-supervisor-")) {
      fail();
    }
    const freshEnvironment = {
      HOME: buildRoot,
      LANG: "C",
      LC_ALL: "C",
      PATH: "/usr/bin:/bin",
      TMPDIR: buildRoot,
    };
    const [source, compiler, binary]
      = await Promise.all([
      inspectStableFile(SOURCE_PATH),
      inspectCompiler(freshEnvironment),
      inspectStableFile(options.binaryPath),
    ]);
    if (!sameFileAuthority(receipt.source, source)
      || receipt.compiler.realPath !== compiler.realPath
      || receipt.compiler.digest !== compiler.digest
      || receipt.compiler.versionDigest !== compiler.versionDigest
      || !sameJson(receipt.compiler.identity, compiler.identity)
      || !sameFileAuthority(receipt.binary, binary)
      || receipt.reproducibility.source.digest !== source.digest
      || !sameJson(
        receipt.reproducibility.source.identity,
        source.identity,
      )
      || receipt.reproducibility.primaryOutput.digest !== binary.digest
      || receipt.reproducibility.verificationOutput.digest !== binary.digest) {
      fail();
    }
    return deepFreeze({
      kind: receipt.kind,
      binaryPath: path.resolve(options.binaryPath),
      binaryDigest: binary.digest,
      binaryIdentity: binary.identity,
      receiptPath: path.resolve(options.receiptPath),
      receiptDigest: options.receiptDigest,
      privateBuildCleanup: {
        disposition: "preserved",
        cleanupAttempted: false,
      },
    });
  } catch (error) {
    if (error instanceof OpenClawProcessSupervisorError) throw error;
    fail();
  }
}

async function retainVerifiedExecutable(filePath, digest, expectedIdentity) {
  let handle;
  try {
    handle = await open(
      path.resolve(filePath),
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const before = await handle.stat({ bigint: true });
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const current = await lstat(path.resolve(filePath), { bigint: true });
    if (!before.isFile()
      || before.nlink !== 1n
      || !sameStableStats(before, after)
      || !sameStableStats(after, current)
      || bytes.length !== Number(before.size)
      || digestBytes(bytes) !== digest
      || !sameJson(identity(after), expectedIdentity)) {
      fail();
    }
    return handle;
  } catch (error) {
    await handle?.close().catch(() => {});
    throw error;
  }
}

async function writeExclusiveFile(filePath, bytes, mode) {
  let handle;
  try {
    handle = await open(
      filePath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
        | (constants.O_NOFOLLOW ?? 0),
      mode,
    );
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle?.close().catch(() => {});
  }
  return inspectStableFile(filePath);
}

async function retainStableFile(filePath) {
  let handle;
  try {
    handle = await open(
      path.resolve(filePath),
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const retained = await inspectRetainedFile(handle);
    const current = await lstat(path.resolve(filePath), { bigint: true });
    if (!sameJson(retained.identity, identity(current))) fail();
    return {
      ...retained,
      handle,
    };
  } catch (error) {
    await handle?.close().catch(() => {});
    throw error;
  }
}

async function inspectRetainedFile(handle, expectedIdentity = null) {
  const before = await handle.stat({ bigint: true });
  if (!before.isFile()
    || before.nlink !== 1n
    || before.size < 0n
    || before.size > BigInt(MAX_FILE_BYTES)) fail();
  const bytes = await readRetainedBytes(handle, Number(before.size));
  const after = await handle.stat({ bigint: true });
  const observedIdentity = identity(after);
  if (!sameStableStats(before, after)
    || bytes.length !== Number(after.size)
    || (expectedIdentity !== null
      && !sameJson(observedIdentity, expectedIdentity))) fail();
  return {
    bytes,
    digest: digestBytes(bytes),
    identity: observedIdentity,
  };
}

async function readRetainedBytes(handle, size) {
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const result = await handle.read(bytes, offset, size - offset, offset);
    if (result.bytesRead === 0) fail();
    offset += result.bytesRead;
  }
  return bytes;
}

async function inspectCompiler(environment) {
  const compilerRealPath = await realpath(COMPILER_PATH);
  const file = await inspectStableFile(compilerRealPath, {
    allowMultipleLinks: true,
  });
  const version = await runBounded(
    COMPILER_PATH,
    ["--version"],
    environment,
    BUILD_TIMEOUT_MS,
  );
  if (version.code !== 0 || version.signal !== null) fail();
  return {
    realPath: compilerRealPath,
    digest: file.digest,
    identity: file.identity,
    versionDigest: digestBytes(Buffer.concat([
      version.stdout,
      Buffer.from([0]),
      version.stderr,
    ])),
  };
}

async function inspectPrivateRoot(rootPath) {
  const stats = await lstat(rootPath, { bigint: true });
  if (!stats.isDirectory()
    || stats.isSymbolicLink()
    || stats.uid !== BigInt(process.getuid?.() ?? -1)
    || (stats.mode & 0o077n) !== 0n) {
    fail();
  }
}

async function inspectStableFile(filePath, options = {}) {
  let handle;
  try {
    handle = await open(
      path.resolve(filePath),
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const before = await handle.stat({ bigint: true });
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const current = await lstat(path.resolve(filePath), { bigint: true });
    if (!before.isFile()
      || (!options.allowMultipleLinks && before.nlink !== 1n)
      || (options.allowMultipleLinks && before.nlink < 1n)
      || before.size < 0n
      || before.size > BigInt(MAX_FILE_BYTES)
      || !sameStableStats(before, after)
      || !sameStableStats(after, current)
      || bytes.length !== Number(before.size)) {
      fail();
    }
    return {
      bytes,
      digest: digestBytes(bytes),
      identity: identity(before),
    };
  } finally {
    await handle?.close().catch(() => {});
  }
}

function runBounded(
  executable,
  argv,
  environment,
  timeoutMs,
  retainedFds = null,
) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, argv, {
      env: environment,
      shell: false,
      stdio: retainedFds === null
        ? ["ignore", "pipe", "pipe"]
        : [
            "ignore",
            "pipe",
            "pipe",
            retainedFds.source.fd,
            retainedFds.output.fd,
          ],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
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
    child.once("error", reject);
    child.once("close", (code, signal) => {
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

function boundedFileAuthority(filePath, observed) {
  return {
    path: path.resolve(filePath),
    digest: observed.digest,
    identity: observed.identity,
  };
}

function retainedFdAuthority(descriptor, procPath, observed) {
  return {
    descriptor,
    path: procPath,
    digest: observed.digest,
    identity: observed.identity,
  };
}

function validFileAuthority(value) {
  return sameKeys(value, ["path", "digest", "identity"])
    && path.isAbsolute(value.path ?? "")
    && DIGEST_PATTERN.test(value.digest ?? "")
    && validIdentity(value.identity);
}

function validRetainedFdAuthority(value) {
  return sameKeys(value, ["descriptor", "path", "digest", "identity"])
    && Number.isInteger(value.descriptor)
    && value.descriptor >= COMPILER_SOURCE_DESCRIPTOR
    && value.path === `/proc/self/fd/${value.descriptor}`
    && DIGEST_PATTERN.test(value.digest ?? "")
    && validIdentity(value.identity);
}

function validCompilerSourceAuthority(value) {
  return sameKeys(value, ["descriptor", "path", "digest", "identity"])
    && value.descriptor === COMPILER_SOURCE_DESCRIPTOR
    && value.path === COMPILER_SOURCE_PATH
    && DIGEST_PATTERN.test(value.digest ?? "")
    && validIdentity(value.identity);
}

function validIdentity(value) {
  return sameKeys(value, [
    "device",
    "inode",
    "links",
    "mode",
    "owner",
    "size",
    "modifiedNs",
    "changedNs",
  ]) && Object.values(value).every((entry) => /^\d+$/u.test(entry));
}

function sameFileAuthority(authority, observed) {
  return authority.digest === observed.digest
    && sameJson(authority.identity, observed.identity);
}

function sameUnderlyingFile(left, right) {
  return left.device === right.device && left.inode === right.inode;
}

function identity(stats) {
  return {
    device: stats.dev.toString(),
    inode: stats.ino.toString(),
    links: stats.nlink.toString(),
    mode: (stats.mode & 0o777n).toString(),
    owner: stats.uid.toString(),
    size: stats.size.toString(),
    modifiedNs: stats.mtimeNs.toString(),
    changedNs: stats.ctimeNs.toString(),
  };
}

function sameStableStats(left, right) {
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

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
}

function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sameJson(left, right) {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function sameKeys(value, keys) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function fail(code = "AGENTMO_OPENCLAW_PROCESS_SUPERVISOR_REJECTED") {
  throw new OpenClawProcessSupervisorError(code);
}
