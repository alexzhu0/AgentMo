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

const SOURCE_PATH = fileURLToPath(
  new URL("../native/openclaw-process-supervisor.c", import.meta.url),
);
const COMPILER_PATH = "/usr/bin/cc";
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
  if (process.platform !== "linux"
    || !["arm64", "x64"].includes(process.arch)) {
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
  try {
    const [source, compiler] = await Promise.all([
      inspectStableFile(SOURCE_PATH),
      inspectCompiler(environment),
    ]);
    const argv = [
      SOURCE_PATH,
      "-std=c11",
      "-O2",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-o",
      binaryPath,
    ];
    const compilation = await runBounded(
      COMPILER_PATH,
      argv,
      environment,
      BUILD_TIMEOUT_MS,
    );
    if (compilation.code !== 0 || compilation.signal !== null) fail();
    await chmod(binaryPath, 0o700);
    await syncFile(binaryPath);
    const binary = await inspectStableFile(binaryPath);
    const receipt = {
      schemaVersion: "agentmo.openclaw-process-supervisor-receipt.v1",
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
    return admitOpenClawProcessSupervisor({
      binaryPath,
      receiptPath,
      receiptDigest,
    });
  } catch (error) {
    if (error instanceof OpenClawProcessSupervisorError) throw error;
    fail();
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
      "binary",
    ])
      || receipt.schemaVersion
        !== "agentmo.openclaw-process-supervisor-receipt.v1"
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
      SOURCE_PATH,
      "-std=c11",
      "-O2",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-o",
      path.resolve(options.binaryPath),
    ];
    if (!sameJson(receipt.argv, expectedArgv)
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
    const [source, compiler, binary] = await Promise.all([
      inspectStableFile(SOURCE_PATH),
      inspectCompiler(freshEnvironment),
      inspectStableFile(options.binaryPath),
    ]);
    if (!sameFileAuthority(receipt.source, source)
      || receipt.compiler.realPath !== compiler.realPath
      || receipt.compiler.digest !== compiler.digest
      || receipt.compiler.versionDigest !== compiler.versionDigest
      || !sameJson(receipt.compiler.identity, compiler.identity)
      || !sameFileAuthority(receipt.binary, binary)) {
      fail();
    }
    return deepFreeze({
      kind: receipt.kind,
      binaryPath: path.resolve(options.binaryPath),
      binaryDigest: binary.digest,
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

async function syncFile(filePath) {
  const handle = await open(filePath, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function runBounded(executable, argv, environment, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, argv, {
      env: environment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
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

function validFileAuthority(value) {
  return sameKeys(value, ["path", "digest", "identity"])
    && path.isAbsolute(value.path ?? "")
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
