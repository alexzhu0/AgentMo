import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const PRELOAD_PATH = fileURLToPath(new URL(
  "../native/prebuilt/linux-x64/agentmo-nondumpable-preload.so",
  import.meta.url,
));
const PRELOAD_DIGEST =
  "sha256:e15ec88738f5127c2c80d5ed7ba74f29397fff81b7f1f675ed9096dad89a8d77";
const PERL_PATH = "/usr/bin/perl";
const MAX_BINARY_BYTES = 2 * 1024 * 1024;
const MAX_PROTOCOL_BYTES = (MAX_BINARY_BYTES * 3) + (64 * 1024);
const PROTOCOL = "agentmo.native-build-capture.v1";

export const NATIVE_BUILD_CAPTURE_TRANSPORT =
  "preloaded-nondumpable-sealed-memfd";
export const NATIVE_BUILD_CAPTURE_PRELOAD_DIGEST = PRELOAD_DIGEST;

const PERL_LAUNCHER = [
  "use strict; use warnings; use POSIX qw(dup2 close);",
  "my $preload_bytes = pack('H*', shift @ARGV);",
  "my $primary_name = 'agentmo-primary'; my $verification_name = 'agentmo-verification'; my $preload_name = 'agentmo-preload';",
  "my $primary = syscall(319, $primary_name, 2); my $verification = syscall(319, $verification_name, 2); my $preload = syscall(319, $preload_name, 2);",
  "$primary > 3 && $verification > 3 && $preload > 3 or exit 126;",
  "my $offset = 0; while ($offset < length($preload_bytes)) { my $part = substr($preload_bytes, $offset); my $written = syscall(1, $preload, $part, length($part)); $written > 0 or exit 126; $offset += $written; }",
  "syscall(91, $preload, 0500) == 0 or exit 126; syscall(72, $preload, 1033, 15) == 0 or exit 126; syscall(72, $preload, 1034, 0) == 15 or exit 126;",
  "dup2($primary, 64) == 64 or exit 126; dup2($verification, 65) == 65 or exit 126; dup2($preload, 66) == 66 or exit 126;",
  "close($primary); close($verification); close($preload);",
  "dup2(64, 4) == 4 or exit 126; dup2(65, 5) == 5 or exit 126; dup2(66, 6) == 6 or exit 126; close(64); close(65); close(66);",
  "$ENV{LD_PRELOAD} = '/proc/self/fd/6'; $ENV{AGENTMO_NATIVE_BUILD_PRELOAD} = '1';",
  "exec { $ARGV[0] } @ARGV; exit 126;",
].join(" ");

const WORKER = String.raw`
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";

const config = JSON.parse(Buffer.from(process.argv[2], "base64url").toString("utf8"));
if (process.env.AGENTMO_NATIVE_BUILD_PRELOAD !== "1") process.exit(126);
const source = fs.readFileSync(3);

function digest(bytes) {
  return "sha256:" + createHash("sha256").update(bytes).digest("hex");
}
function identity(stats) {
  return {
    device: String(stats.dev), inode: String(stats.ino), links: String(stats.nlink),
    mode: (Number(stats.mode) & 0o777).toString(8), owner: String(stats.uid),
    size: String(stats.size), modifiedNs: String(stats.mtimeNs), changedNs: String(stats.ctimeNs),
  };
}
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function snapshot(fd) {
  const before = fs.fstatSync(fd, { bigint: true });
  if (!before.isFile() || before.nlink !== 0n || before.size < 1n
    || before.size > BigInt(config.maxBinaryBytes) || before.uid !== BigInt(process.getuid())) throw new Error("snapshot");
  const bytes = Buffer.alloc(Number(before.size));
  let offset = 0;
  while (offset < bytes.length) {
    const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
    if (count < 1) throw new Error("snapshot");
    offset += count;
  }
  const after = fs.fstatSync(fd, { bigint: true });
  if (!same(identity(before), identity(after))) throw new Error("snapshot");
  return { bytes, digest: digest(bytes), identity: identity(after) };
}
function seal(fd) {
  const stdio = ["ignore", "ignore", "ignore", fd, "ignore", "ignore", 6];
  const result = spawnSync(config.perlPath, ["-f", "-e", config.sealer], {
    env: { ...config.environment, LD_PRELOAD: process.env.LD_PRELOAD, AGENTMO_NATIVE_BUILD_PRELOAD: "1" },
    shell: false,
    stdio,
  });
  if (result.error || result.status !== 0 || result.signal !== null) throw new Error("seal");
}
function compile(fd) {
  fs.fchmodSync(fd, 0o700);
  const args = [...config.compilerArgs];
  args[args.length - 1] = "/proc/self/fd/4";
  const stdio = ["pipe", "pipe", "pipe", "ignore", fd, "ignore", 6];
  const result = spawnSync(config.compilerPath, args, {
    cwd: config.buildRoot,
    env: { ...config.environment, LD_PRELOAD: process.env.LD_PRELOAD, AGENTMO_NATIVE_BUILD_PRELOAD: "1" },
    input: source,
    maxBuffer: config.maxOutputBytes,
    timeout: config.timeoutMs,
    shell: false,
    stdio,
  });
  if (result.error || result.status !== 0 || result.signal !== null) throw new Error("compiler");
  fs.fchmodSync(fd, 0o500); fs.fsyncSync(fd); seal(fd);
  const first = snapshot(fd); const second = snapshot(fd);
  if (!first.bytes.equals(second.bytes) || first.digest !== second.digest
    || !same(first.identity, second.identity) || first.identity.mode !== "500") throw new Error("unstable");
  return first;
}
try {
  const primary = compile(4); const verification = compile(5);
  process.stdout.write(JSON.stringify({
    schemaVersion: ${JSON.stringify(PROTOCOL)},
    transport: "preloaded-nondumpable-sealed-memfd",
    primary: { bytesBase64: primary.bytes.toString("base64"), digest: primary.digest, identity: primary.identity },
    verification: { bytesBase64: verification.bytes.toString("base64"), digest: verification.digest, identity: verification.identity },
  }) + "\n");
} catch { process.exitCode = 125; }
`;

export async function captureIndependentNativeBuilds(options) {
  assertOptions(options);
  if (process.platform !== "linux" || process.arch !== "x64") throw new Error("native build capture unsupported");
  const preload = await inspectPreload();
  const config = Buffer.from(JSON.stringify({
    ...options,
    sourceBytes: undefined,
    maxBinaryBytes: MAX_BINARY_BYTES,
    perlPath: PERL_PATH,
    sealer: "use strict; use warnings; syscall(72, 3, 1033, 15) == 0 or exit 126; syscall(72, 3, 1034, 0) == 15 or exit 126; exit 0;",
  }), "utf8").toString("base64url");
  const output = await runWorker(options, preload.bytes, config);
  const parsed = JSON.parse(output.toString("utf8"));
  if (parsed?.schemaVersion !== PROTOCOL
    || parsed?.transport !== NATIVE_BUILD_CAPTURE_TRANSPORT) throw new Error("native build capture rejected");
  const primary = member(parsed.primary);
  const verification = member(parsed.verification);
  if (primary.identity.inode === verification.identity.inode) throw new Error("native build capture rejected");
  return Object.freeze({
    transport: parsed.transport,
    primary,
    verification,
    preload: Object.freeze({ path: PRELOAD_PATH, digest: preload.digest, identity: preload.identity }),
  });
}

function runWorker(options, preloadBytes, config) {
  return new Promise((resolve, reject) => {
    const child = spawn(PERL_PATH, [
      "-f", "-e", PERL_LAUNCHER, preloadBytes.toString("hex"),
      process.execPath, "--input-type=module", "-", config,
    ], {
      cwd: options.buildRoot,
      env: options.environment,
      shell: false,
      stdio: ["pipe", "pipe", "pipe", "pipe"],
    });
    const chunks = [];
    let length = 0;
    let settled = false;
    let inputError = null;
    const timer = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs);
    const inputFailure = (error) => { inputError = error; child.kill("SIGKILL"); };
    child.stdin.on("error", inputFailure);
    child.stdio[3].on("error", inputFailure);
    child.stdout.on("data", (chunk) => {
      length += chunk.length;
      if (length > MAX_PROTOCOL_BYTES) child.kill("SIGKILL");
      else chunks.push(chunk);
    });
    child.stderr.resume();
    child.once("error", (error) => {
      settled = true; clearTimeout(timer); reject(error);
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (inputError || code !== 0 || signal !== null || length > MAX_PROTOCOL_BYTES) {
        reject(inputError ?? new Error("native build capture rejected"));
      } else resolve(Buffer.concat(chunks));
    });
    child.stdin.end(Buffer.from(WORKER, "utf8"));
    child.stdio[3].end(options.sourceBytes);
  });
}

async function inspectPreload() {
  let handle;
  try {
    handle = await open(PRELOAD_PATH, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size < 1n || before.size > 64n * 1024n) throw new Error("preload rejected");
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const current = await lstat(PRELOAD_PATH, { bigint: true });
    if (!stable(before, after) || !stable(after, current) || digest(bytes) !== PRELOAD_DIGEST) throw new Error("preload rejected");
    return { bytes, digest: PRELOAD_DIGEST, identity: identity(after) };
  } finally { await handle?.close().catch(() => {}); }
}

function member(value) {
  const bytes = Buffer.from(value?.bytesBase64 ?? "", "base64");
  if (bytes.length < 1 || bytes.length > MAX_BINARY_BYTES || digest(bytes) !== value?.digest
    || value?.identity?.links !== "0" || value?.identity?.mode !== "500"
    || value?.identity?.size !== String(bytes.length)) throw new Error("native build capture rejected");
  return Object.freeze({ bytes, digest: value.digest, identity: Object.freeze({ ...value.identity }) });
}

function assertOptions(value) {
  const keys = ["buildRoot", "compilerArgs", "compilerPath", "environment", "maxOutputBytes", "sourceBytes", "timeoutMs"];
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(keys)
    || !Buffer.isBuffer(value.sourceBytes) || value.sourceBytes.length < 1
    || !Array.isArray(value.compilerArgs) || value.compilerArgs.at(-2) !== "-o"
    || value.compilerArgs.at(-1) !== "/proc/self/fd/4") throw new Error("native build capture rejected");
}
function digest(bytes) { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
function identity(stats) {
  return { device: String(stats.dev), inode: String(stats.ino), links: String(stats.nlink), mode: (Number(stats.mode) & 0o777).toString(8), owner: String(stats.uid), size: String(stats.size), modifiedNs: String(stats.mtimeNs), changedNs: String(stats.ctimeNs) };
}
function stable(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mode === right.mode && left.uid === right.uid && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}
