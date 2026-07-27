import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { assertBuilderPlatform } from "./builder-platform.js";

const PROTOCOL_VERSION = "agentmo.builder-posix-effect.v2";
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_EFFECT_BYTES = 1024 * 1024;
const MAX_CLAIM_TARGET_BYTES = 1024;
const EFFECT_TIMEOUT_MS = 15_000;
const RETIRED_CHILD_ENTRY_ARGUMENT = "__builder-posix-effect-child";
const CORRELATION_PATTERN = /^[a-f0-9]{64}$/u;
const DARWIN_DIRECTORY_FD_BRIDGE_COMMAND = "/usr/bin/python3";
const DARWIN_DIRECTORY_FD_BRIDGE = [
  "import os, sys",
  "for descriptor in (0, 3, 4):",
  "  os.set_inheritable(descriptor, True)",
  "try:",
  "  os.set_inheritable(5, True)",
  "except OSError:",
  "  pass",
  "os.fchdir(4)",
  "os.execve(sys.argv[1], sys.argv[1:], os.environ)",
].join("\n");

/*
 * Closed effect contract:
 * - directoryAuthority.path is a preflight revalidation locator only; the child
 *   launches from neutral cwd and receives the retained directory FD on a fixed
 *   descriptor, never as a mutation pathname;
 * - the child fstats that inherited FD, enters it only through its platform FD
 *   bridge, then reopens and retains "." with O_DIRECTORY|O_NOFOLLOW before
 *   admitting the requested directory identity and mutating anything;
 * - every syscall operand that names an entry is one validated POSIX basename;
 * - mkdir is mode-0700 absent-or-exact, write-file is mode-0600
 *   absent-or-exact, write-selected-file may append only the missing suffix
 *   authorized by an exact retained selection symlink, claim-symlink writes
 *   only an opaque claim token, and hardlink links two basenames in the same
 *   retained cwd;
 * - every successful operation fsyncs the retained child directory before its
 *   result is admitted;
 * - unlink, rename, recursive paths, and caller-selected absolute effect paths
 *   are outside this API and are rejected.
 *
 * A hardlink request may carry sourceIdentity for the source reopened inside
 * the retained directory FD. When options.sourceAuthority is also supplied,
 * the child additionally cross-checks that inherited descriptor.
 */
async function builderPosixEffectChildMain() {
  let childCorrelation = null;
  const PROTOCOL_VERSION = "agentmo.builder-posix-effect.v2";
  const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
  const MAX_EFFECT_BYTES = 1024 * 1024;
  const MAX_CLAIM_TARGET_BYTES = 1024;
  const APPEND_SYNC_CHUNK_BYTES = 64 * 1024;
  const DIRECTORY_DESCRIPTOR = 4;
  const SOURCE_DESCRIPTOR = 5;
  const CORRELATION_PATTERN = /^[a-f0-9]{64}$/u;
  const fail = (code) => {
    const error = new Error("Builder POSIX effect rejected.");
    error.code = code;
    throw error;
  };
  const reportFailure = async (error) => {
    const code = typeof error?.code === "string"
      && /^AGENTMO_BUILDER_(?:PLATFORM|POSIX_EFFECT)_[A-Z0-9_]+$/u.test(error.code)
      ? error.code
      : "AGENTMO_BUILDER_POSIX_EFFECT_CHILD_FAILED";
    process.exitCode = 1;
    if (typeof process.send === "function" && process.connected) {
      await new Promise((resolve) => process.send({
        type: "error",
        code,
        correlation: childCorrelation,
      }, () => resolve()));
      process.disconnect();
    }
  };
  try {
    if (!["darwin", "linux"].includes(process.platform)
      || typeof process.getuid !== "function"
      || !Number.isSafeInteger(process.getuid())
      || process.getuid() < 0) {
      fail("AGENTMO_BUILDER_PLATFORM_UNSUPPORTED");
    }
    const { constants, fstatSync, readSync } = await import("node:fs");
    const { createHash } = await import("node:crypto");
    const {
      link,
      lstat,
      mkdir,
      open,
      readlink,
      symlink,
    } = await import("node:fs/promises");
    const selectedFileAuthorizationTarget = (bytes) => [
      "am-selected-file-v1",
      createHash("sha256").update(bytes).digest("hex"),
      String(bytes.length),
    ].join(".");

  const exactKeys = (value, keys) => (
    value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key))
  );
  const validName = (value) => typeof value === "string"
    && /^(?!\.{1,2}$)[a-zA-Z0-9.][a-zA-Z0-9._-]{0,254}$/u.test(value);
  const validClaimTarget = (value) => typeof value === "string"
    && Buffer.byteLength(value, "utf8") <= MAX_CLAIM_TARGET_BYTES
    && /^(?!\.{1,2}$)[a-zA-Z0-9._-]+$/u.test(value);
  const validIdentity = (value) => exactKeys(
    value,
    ["device", "gid", "inode", "mode", "uid"],
  ) && ["device", "gid", "inode", "uid"].every((key) => /^\d+$/u.test(value[key] ?? ""))
    && /^[0-7]{3,4}$/u.test(value.mode ?? "");
  const sameDirectoryIdentity = (left, right) => (
    left.device === right.device
    && left.inode === right.inode
    && left.uid === right.uid
    && left.gid === right.gid
    && left.mode === right.mode
  );
  const validFileIdentity = (value) => exactKeys(
    value,
    ["device", "inode", "links", "size"],
  ) && ["device", "inode", "links", "size"].every(
    (key) => /^\d+$/u.test(value[key] ?? ""),
  ) && ["1", "2"].includes(value.links);
  const sameFileIdentity = (left, right) => (
    left.device === right.device
    && left.inode === right.inode
    && left.links === right.links
    && left.size === right.size
  );
  const sameFileObject = (left, right) => (
    left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
  );
  const directoryIdentity = (stats) => ({
    device: stats.dev.toString(10),
    inode: stats.ino.toString(10),
    uid: stats.uid.toString(10),
    gid: stats.gid.toString(10),
    mode: (stats.mode & 0o777n).toString(8),
  });
  const fileIdentity = (stats) => ({
    device: stats.dev.toString(10),
    inode: stats.ino.toString(10),
    links: stats.nlink.toString(10),
    size: stats.size.toString(10),
  });
  const sameIdentity = (left, right) => (
    left.dev === right.dev
    && left.ino === right.ino
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs
  );
  const safeDirectory = (stats) => (
    stats.isDirectory()
    && !stats.isSymbolicLink()
    && stats.uid === BigInt(process.getuid())
    && (stats.mode & 0o022n) === 0n
  );
  const safeRegular = (stats, expectedLinks = [1n, 2n]) => (
    stats.isFile()
    && !stats.isSymbolicLink()
    && expectedLinks.includes(stats.nlink)
    && stats.uid === BigInt(process.getuid())
    && (stats.mode & 0o077n) === 0n
    && stats.size <= BigInt(MAX_EFFECT_BYTES)
  );
  const send = (message) => new Promise((resolve, reject) => {
    if (typeof process.send !== "function") {
      reject(Object.assign(new Error("missing IPC"), {
        code: "AGENTMO_BUILDER_POSIX_EFFECT_PROTOCOL_REJECTED",
      }));
      return;
    }
    process.send(message, (error) => error ? reject(error) : resolve());
  });
  process.once("disconnect", () => {
    if (process.exitCode === undefined) process.exit(1);
  });
  const inspectRegular = async (name, expectedBytes, expectedLinks = [1n]) => {
    let handle;
    try {
      handle = await open(name, constants.O_RDONLY | constants.O_NOFOLLOW);
      const before = await handle.stat({ bigint: true });
      const bytes = await handle.readFile();
      const after = await handle.stat({ bigint: true });
      if (!safeRegular(before, expectedLinks)
        || !sameIdentity(before, after)
        || !bytes.equals(expectedBytes)) {
        fail("AGENTMO_BUILDER_POSIX_EFFECT_FILE_CHANGED");
      }
      return fileIdentity(after);
    } finally {
      await handle?.close().catch(() => {});
    }
  };
  const appendSelectedFileSuffix = async (handle, expectedBytes, initialOffset) => {
    let offset = initialOffset;
    const initial = await handle.stat({ bigint: true });
    if (!safeRegular(initial, [1n]) || initial.size !== BigInt(initialOffset)) {
      fail("AGENTMO_BUILDER_POSIX_EFFECT_FILE_CHANGED");
    }
    while (offset < expectedBytes.length) {
      if (!process.connected) process.exit(1);
      const before = await handle.stat({ bigint: true });
      if (!safeRegular(before, [1n])
        || before.dev !== initial.dev
        || before.ino !== initial.ino
        || before.size !== BigInt(offset)) {
        fail("AGENTMO_BUILDER_POSIX_EFFECT_FILE_CHANGED");
      }
      const length = Math.min(APPEND_SYNC_CHUNK_BYTES, expectedBytes.length - offset);
      const { bytesWritten } = await handle.write(
        expectedBytes,
        offset,
        length,
        offset,
      );
      if (bytesWritten <= 0) fail("AGENTMO_BUILDER_POSIX_EFFECT_FILE_CHANGED");
      offset += bytesWritten;
      await handle.sync();
      const after = await handle.stat({ bigint: true });
      if (!safeRegular(after, [1n])
        || after.dev !== initial.dev
        || after.ino !== initial.ino
        || after.size !== BigInt(offset)) {
        fail("AGENTMO_BUILDER_POSIX_EFFECT_FILE_CHANGED");
      }
      if (offset < expectedBytes.length) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
  };
  const inspectClaim = async (name, expectedTarget) => {
    const before = await lstat(name, { bigint: true });
    const target = await readlink(name, "utf8");
    const after = await lstat(name, { bigint: true });
    if (!before.isSymbolicLink()
      || before.nlink !== 1n
      || before.uid !== BigInt(process.getuid())
      || !sameIdentity(before, after)
      || target !== expectedTarget) {
      fail("AGENTMO_BUILDER_POSIX_EFFECT_CLAIM_CHANGED");
    }
    return fileIdentity(after);
  };
  const inspectDirectory = async (name) => {
    const before = await lstat(name, { bigint: true });
    const after = await lstat(name, { bigint: true });
    if (!before.isDirectory()
      || before.isSymbolicLink()
      || before.uid !== BigInt(process.getuid())
      || (before.mode & 0o077n) !== 0n
      || !sameIdentity(before, after)) {
      fail("AGENTMO_BUILDER_POSIX_EFFECT_DIRECTORY_CHANGED");
    }
    return directoryIdentity(after);
  };

  const enterInheritedDirectory = () => {
    if (process.platform === "darwin") return;
    if (process.platform === "linux") {
      process.chdir(`/proc/self/fd/${DIRECTORY_DESCRIPTOR}`);
      return;
    }
    fail("AGENTMO_BUILDER_POSIX_EFFECT_DIRECTORY_CHANGED");
  };

  let directoryHandle;
  let inheritedDirectory;
  let openedCwd;
  try {
    inheritedDirectory = fstatSync(DIRECTORY_DESCRIPTOR, { bigint: true });
    if (!safeDirectory(inheritedDirectory)) {
      fail("AGENTMO_BUILDER_POSIX_EFFECT_DIRECTORY_CHANGED");
    }
    enterInheritedDirectory();
    directoryHandle = await open(
      ".",
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    openedCwd = await directoryHandle.stat({ bigint: true });
    if (!safeDirectory(openedCwd)
      || !sameDirectoryIdentity(directoryIdentity(inheritedDirectory), directoryIdentity(openedCwd))) {
      fail("AGENTMO_BUILDER_POSIX_EFFECT_DIRECTORY_CHANGED");
    }
  } catch {
    await directoryHandle?.close().catch(() => {});
    fail("AGENTMO_BUILDER_POSIX_EFFECT_DIRECTORY_CHANGED");
  }
  try {
    let requestBytes = 0;
    const chunks = [];
    for await (const chunk of process.stdin) {
      requestBytes += chunk.length;
      if (requestBytes > MAX_REQUEST_BYTES) {
        fail("AGENTMO_BUILDER_POSIX_EFFECT_REQUEST_REJECTED");
      }
      chunks.push(chunk);
    }
    let request;
    try {
      request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      fail("AGENTMO_BUILDER_POSIX_EFFECT_REQUEST_REJECTED");
    }
    if (!exactKeys(request, [
      "action",
      "authorizationName",
      "correlation",
      "directoryIdentity",
      "existingIdentity",
      "hasSourceDescriptor",
      "name",
      "payload",
      "schemaVersion",
      "sourceIdentity",
      "sourceName",
    ])
      || request.schemaVersion !== PROTOCOL_VERSION
      || !["claim-symlink", "hardlink", "mkdir", "write-file", "write-selected-file"]
        .includes(request.action)
      || !CORRELATION_PATTERN.test(request.correlation ?? "")
      || !validIdentity(request.directoryIdentity)
      || typeof request.hasSourceDescriptor !== "boolean"
      || !(request.authorizationName === null
        || (typeof request.authorizationName === "string"
          && validName(request.authorizationName)))
      || !validName(request.name)
      || typeof request.payload !== "string"
      || !(request.sourceName === null
        || (typeof request.sourceName === "string" && validName(request.sourceName)))
      || !(request.sourceIdentity === null || validFileIdentity(request.sourceIdentity))
      || !(request.existingIdentity === null || validFileIdentity(request.existingIdentity))
      || (request.action === "hardlink") !== (request.sourceName !== null)
      || (request.action === "write-selected-file") !== (request.authorizationName !== null)
      || (request.action !== "write-selected-file" && request.authorizationName !== null)
      || (request.action !== "write-selected-file" && request.existingIdentity !== null)
      || (request.existingIdentity !== null && request.existingIdentity.links !== "1")
      || (request.action !== "hardlink" && request.sourceIdentity !== null)
      || (request.hasSourceDescriptor && request.sourceIdentity === null)
      || (request.action === "hardlink" && request.sourceName === request.name)
      || (request.action === "mkdir" && request.payload !== "")
      || (request.action === "claim-symlink" && !validClaimTarget(request.payload))) {
      fail("AGENTMO_BUILDER_POSIX_EFFECT_REQUEST_REJECTED");
    }
    let effectBytes = null;
    if (["hardlink", "write-file", "write-selected-file"].includes(request.action)) {
      effectBytes = Buffer.from(request.payload, "base64");
      if (effectBytes.length > MAX_EFFECT_BYTES
        || effectBytes.toString("base64") !== request.payload) {
        fail("AGENTMO_BUILDER_POSIX_EFFECT_REQUEST_REJECTED");
      }
    }
    childCorrelation = request.correlation;
    const inherited = fstatSync(DIRECTORY_DESCRIPTOR, { bigint: true });
    const held = await directoryHandle.stat({ bigint: true });
    if (!safeDirectory(inherited)
      || !safeDirectory(held)
      || !sameDirectoryIdentity(directoryIdentity(openedCwd), directoryIdentity(held))
      || !sameDirectoryIdentity(directoryIdentity(inheritedDirectory), directoryIdentity(inherited))
      || !sameDirectoryIdentity(directoryIdentity(inherited), directoryIdentity(held))
      || !sameDirectoryIdentity(directoryIdentity(held), request.directoryIdentity)) {
      fail("AGENTMO_BUILDER_POSIX_EFFECT_DIRECTORY_CHANGED");
    }

    let retainedSourceBefore = null;
    if (request.hasSourceDescriptor) {
      let sourceDescriptorStats;
      let descriptorBytes;
      try {
        sourceDescriptorStats = fstatSync(SOURCE_DESCRIPTOR, { bigint: true });
        if (!safeRegular(sourceDescriptorStats)) {
          fail("AGENTMO_BUILDER_POSIX_EFFECT_SOURCE_CHANGED");
        }
        descriptorBytes = Buffer.alloc(Number(sourceDescriptorStats.size));
        let offset = 0;
        while (offset < descriptorBytes.length) {
          const read = readSync(
            SOURCE_DESCRIPTOR,
            descriptorBytes,
            offset,
            descriptorBytes.length - offset,
            offset,
          );
          if (read === 0) fail("AGENTMO_BUILDER_POSIX_EFFECT_SOURCE_CHANGED");
          offset += read;
        }
      } catch (error) {
        if (error?.code === "AGENTMO_BUILDER_POSIX_EFFECT_SOURCE_CHANGED") throw error;
        fail("AGENTMO_BUILDER_POSIX_EFFECT_SOURCE_CHANGED");
      }
      retainedSourceBefore = fileIdentity(sourceDescriptorStats);
      if (!sameFileIdentity(retainedSourceBefore, request.sourceIdentity)
        || !descriptorBytes.equals(effectBytes)) {
        fail("AGENTMO_BUILDER_POSIX_EFFECT_SOURCE_CHANGED");
      }
    }
    let result;
    if (request.action === "claim-symlink") {
      let created = true;
      try {
        await symlink(request.payload, request.name);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        created = false;
      }
      const identity = await inspectClaim(request.name, request.payload);
      await directoryHandle.sync();
      result = { created, identity, kind: "claim" };
    } else if (request.action === "mkdir") {
      let created = true;
      try {
        await mkdir(request.name, { mode: 0o700 });
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        created = false;
      }
      const identity = await inspectDirectory(request.name);
      await directoryHandle.sync();
      result = { created, identity, kind: "directory" };
    } else if (["write-file", "write-selected-file"].includes(request.action)) {
      let created = true;
      let fileHandle;
      try {
        if (request.action === "write-selected-file") {
          await inspectClaim(
            request.authorizationName,
            selectedFileAuthorizationTarget(effectBytes),
          );
        }
        if (request.existingIdentity !== null) {
          created = false;
          try {
            fileHandle = await open(
              request.name,
              constants.O_RDWR | constants.O_NOFOLLOW,
            );
          } catch {
            fail("AGENTMO_BUILDER_POSIX_EFFECT_FILE_CHANGED");
          }
        } else {
          try {
            fileHandle = await open(
              request.name,
              constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
              0o600,
            );
          } catch (error) {
            if (error?.code !== "EEXIST") throw error;
            created = false;
          }
        }
        if (created) {
          if (request.action === "write-file") {
            await fileHandle.writeFile(effectBytes);
            await fileHandle.sync();
          } else {
            await appendSelectedFileSuffix(fileHandle, effectBytes, 0);
          }
        } else if (request.action === "write-selected-file") {
          if (fileHandle === undefined) {
            fileHandle = await open(
              request.name,
              constants.O_RDWR | constants.O_NOFOLLOW,
            );
          }
          const before = await fileHandle.stat({ bigint: true });
          if (!safeRegular(before, [1n, 2n])
            || before.size > BigInt(effectBytes.length)
            || (before.size < BigInt(effectBytes.length)
              && (before.nlink !== 1n || request.existingIdentity === null))
            || (request.existingIdentity !== null
              && !sameFileIdentity(fileIdentity(before), request.existingIdentity))) {
            fail("AGENTMO_BUILDER_POSIX_EFFECT_FILE_CHANGED");
          }
          const prefix = Buffer.alloc(Number(before.size));
          let offset = 0;
          while (offset < prefix.length) {
            const { bytesRead } = await fileHandle.read(
              prefix,
              offset,
              prefix.length - offset,
              offset,
            );
            if (bytesRead === 0) fail("AGENTMO_BUILDER_POSIX_EFFECT_FILE_CHANGED");
            offset += bytesRead;
          }
          const after = await fileHandle.stat({ bigint: true });
          if (!sameIdentity(before, after)
            || !prefix.equals(effectBytes.subarray(0, prefix.length))) {
            fail("AGENTMO_BUILDER_POSIX_EFFECT_FILE_CHANGED");
          }
          await fileHandle.sync();
          if (prefix.length < effectBytes.length) {
            await appendSelectedFileSuffix(fileHandle, effectBytes, prefix.length);
          }
        }
      } finally {
        await fileHandle?.close().catch(() => {});
      }
      if (request.action === "write-selected-file") {
        await inspectClaim(
          request.authorizationName,
          selectedFileAuthorizationTarget(effectBytes),
        );
      }
      const identity = await inspectRegular(request.name, effectBytes, [1n, 2n]);
      if (request.existingIdentity !== null
        && (identity.device !== request.existingIdentity.device
          || identity.inode !== request.existingIdentity.inode
          || identity.links !== request.existingIdentity.links)) {
        fail("AGENTMO_BUILDER_POSIX_EFFECT_FILE_CHANGED");
      }
      await directoryHandle.sync();
      result = { created, identity, kind: "file" };
    } else {
      let sourceHandle;
      let sourceBefore;
      try {
        sourceHandle = await open(
          request.sourceName,
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        const before = await sourceHandle.stat({ bigint: true });
        const sourceBytes = await sourceHandle.readFile();
        const after = await sourceHandle.stat({ bigint: true });
        if (!safeRegular(before)
          || !sameIdentity(before, after)
          || !sourceBytes.equals(effectBytes)) {
          fail("AGENTMO_BUILDER_POSIX_EFFECT_SOURCE_CHANGED");
        }
        sourceBefore = fileIdentity(after);
        if (request.sourceIdentity !== null
          && !sameFileIdentity(sourceBefore, request.sourceIdentity)) {
          fail("AGENTMO_BUILDER_POSIX_EFFECT_SOURCE_CHANGED");
        }
        if (retainedSourceBefore !== null
          && (!sameFileIdentity(sourceBefore, retainedSourceBefore)
            || !sameFileObject(after, fstatSync(SOURCE_DESCRIPTOR, { bigint: true })))) {
          fail("AGENTMO_BUILDER_POSIX_EFFECT_SOURCE_CHANGED");
        }
      } catch (error) {
        await sourceHandle?.close().catch(() => {});
        if (error?.code === "AGENTMO_BUILDER_POSIX_EFFECT_SOURCE_CHANGED") throw error;
        fail("AGENTMO_BUILDER_POSIX_EFFECT_SOURCE_CHANGED");
      }
      let created = true;
      try {
        if (sourceBefore.links === "2") {
          created = false;
          try {
            await lstat(request.name, { bigint: true });
          } catch {
            fail("AGENTMO_BUILDER_POSIX_EFFECT_LINK_CHANGED");
          }
        } else {
          try {
            await link(request.sourceName, request.name);
          } catch (error) {
            if (error?.code !== "EEXIST") throw error;
            created = false;
          }
        }
        const heldSourceStats = await sourceHandle.stat({ bigint: true });
        const sourceStats = await lstat(request.sourceName, { bigint: true });
        const destinationStats = await lstat(request.name, { bigint: true });
        if (!safeRegular(heldSourceStats, [2n])
          || !safeRegular(sourceStats, [2n])
          || !safeRegular(destinationStats, [2n])
          || !sameFileObject(heldSourceStats, sourceStats)
          || !sameFileObject(sourceStats, destinationStats)
          || sourceBefore.device !== sourceStats.dev.toString(10)
          || sourceBefore.inode !== sourceStats.ino.toString(10)
          || (retainedSourceBefore !== null
            && (retainedSourceBefore.device !== sourceStats.dev.toString(10)
              || retainedSourceBefore.inode !== sourceStats.ino.toString(10)
              || retainedSourceBefore.size !== sourceStats.size.toString(10)))) {
          fail("AGENTMO_BUILDER_POSIX_EFFECT_LINK_CHANGED");
        }
        let destinationHandle;
        try {
          destinationHandle = await open(request.name, constants.O_RDONLY | constants.O_NOFOLLOW);
          const actualBytes = await destinationHandle.readFile();
          const destinationAfter = await destinationHandle.stat({ bigint: true });
          if (!actualBytes.equals(effectBytes)
            || !sameFileObject(destinationStats, destinationAfter)
            || destinationAfter.nlink !== 2n) {
            fail("AGENTMO_BUILDER_POSIX_EFFECT_LINK_CHANGED");
          }
        } finally {
          await destinationHandle?.close().catch(() => {});
        }
        if (retainedSourceBefore !== null) {
          const retainedAfter = fstatSync(SOURCE_DESCRIPTOR, { bigint: true });
          if (!safeRegular(retainedAfter, [2n])
            || !sameFileObject(heldSourceStats, retainedAfter)) {
            fail("AGENTMO_BUILDER_POSIX_EFFECT_SOURCE_CHANGED");
          }
        }
        await directoryHandle.sync();
        result = { created, identity: fileIdentity(destinationStats), kind: "link" };
      } finally {
        await sourceHandle?.close().catch(() => {});
      }
    }
    const inheritedAfter = fstatSync(DIRECTORY_DESCRIPTOR, { bigint: true });
    const heldAfter = await directoryHandle.stat({ bigint: true });
    if (!safeDirectory(inheritedAfter)
      || !safeDirectory(heldAfter)
      || !sameDirectoryIdentity(directoryIdentity(openedCwd), directoryIdentity(heldAfter))
      || !sameDirectoryIdentity(directoryIdentity(inheritedDirectory), directoryIdentity(inheritedAfter))
      || !sameDirectoryIdentity(directoryIdentity(inheritedAfter), directoryIdentity(heldAfter))
      || !sameDirectoryIdentity(directoryIdentity(heldAfter), request.directoryIdentity)) {
      fail("AGENTMO_BUILDER_POSIX_EFFECT_DIRECTORY_CHANGED");
    }
    await send({
      type: "result",
      correlation: childCorrelation,
      value: {
        schemaVersion: PROTOCOL_VERSION,
        ...result,
      },
    });
    process.exitCode = 0;
    process.disconnect();
    } finally {
      await directoryHandle?.close().catch(() => {});
    }
  } catch (error) {
    await reportFailure(error);
  }
}

export async function runBuilderPosixEffect(request, options = {}) {
  assertBuilderPlatform();
  const normalized = normalizeEffectRequest(request, options);
  await assertRetainedDirectoryAuthority(normalized.directoryAuthority);
  if (process.platform === "darwin") await assertDarwinDirectoryBridgeExecutable();
  if (normalized.sourceAuthority !== null) {
    await assertRetainedSourceAuthority(
      normalized.sourceAuthority,
      normalized.sourceIdentity,
    );
  }
  const correlation = randomBytes(32).toString("hex");
  const childBootstrap = [
    `const childMain = ${builderPosixEffectChildMain.toString()};`,
    "await childMain();",
  ].join("\n");
  const nodeArguments = ["--input-type=module", "--eval", childBootstrap];
  const childCommand = process.platform === "darwin"
    ? DARWIN_DIRECTORY_FD_BRIDGE_COMMAND
    : process.execPath;
  const childArguments = process.platform === "darwin"
    ? ["-I", "-c", DARWIN_DIRECTORY_FD_BRIDGE, process.execPath, ...nodeArguments]
    : nodeArguments;
  const payload = JSON.stringify({
    schemaVersion: PROTOCOL_VERSION,
    action: normalized.action,
    authorizationName: normalized.authorizationName,
    correlation,
    directoryIdentity: normalized.directoryAuthority.identity,
    existingIdentity: normalized.existingIdentity,
    hasSourceDescriptor: normalized.sourceAuthority !== null,
    name: normalized.name,
    payload: normalized.payload,
    sourceIdentity: normalized.sourceIdentity,
    sourceName: normalized.sourceName,
  });
  return new Promise((resolve, reject) => {
    const child = spawn(
      childCommand,
      childArguments,
      {
        cwd: "/",
        env: {
          LANG: "C",
          LC_ALL: "C",
          TZ: "UTC",
        },
        stdio: normalized.sourceAuthority === null
          ? [
              "pipe",
              "ignore",
              "ignore",
              "ipc",
              normalized.directoryAuthority.handle.fd,
            ]
          : [
              "pipe",
              "ignore",
              "ignore",
              "ipc",
              normalized.directoryAuthority.handle.fd,
              normalized.sourceAuthority.handle.fd,
            ],
        windowsHide: true,
      },
    );
    let settled = false;
    let childClosed = false;
    let terminal = null;
    let responseBytes = 0;
    const timeout = setTimeout(() => {
      if (settled) return;
      terminal = Object.freeze({
        type: "error",
        error: effectError("AGENTMO_BUILDER_POSIX_EFFECT_TIMEOUT"),
      });
      child.kill("SIGKILL");
    }, EFFECT_TIMEOUT_MS);
    const finish = (callback) => {
      if (settled) return false;
      settled = true;
      clearTimeout(timeout);
      callback();
      return true;
    };
    const rejectProtocolAfterClose = (code) => {
      terminal = Object.freeze({ type: "error", error: effectError(code) });
      child.kill("SIGKILL");
    };
    child.on("error", () => {
      if (settled) return;
      terminal = Object.freeze({
        type: "error",
        error: effectError("AGENTMO_BUILDER_POSIX_EFFECT_CHILD_FAILED"),
      });
    });
    child.on("message", (message) => {
      if (settled || childClosed) return;
      responseBytes += Buffer.byteLength(JSON.stringify(message ?? null), "utf8");
      if (responseBytes > MAX_RESPONSE_BYTES) {
        rejectProtocolAfterClose("AGENTMO_BUILDER_POSIX_EFFECT_PROTOCOL_REJECTED");
        return;
      }
      if (terminal !== null || message?.correlation !== correlation) {
        rejectProtocolAfterClose("AGENTMO_BUILDER_POSIX_EFFECT_PROTOCOL_REJECTED");
        return;
      }
      if (message?.type === "result"
        && exactKeys(message, ["correlation", "type", "value"])) {
        let admitted;
        try {
          admitted = admitEffectResult(message.value, normalized);
        } catch {
          rejectProtocolAfterClose("AGENTMO_BUILDER_POSIX_EFFECT_PROTOCOL_REJECTED");
          return;
        }
        terminal = Object.freeze({ type: "result", value: admitted });
        return;
      }
      if (message?.type === "error"
        && exactKeys(message, ["code", "correlation", "type"])
        && typeof message.code === "string") {
        terminal = Object.freeze({ type: "error", error: effectError(message.code) });
        return;
      }
      rejectProtocolAfterClose("AGENTMO_BUILDER_POSIX_EFFECT_PROTOCOL_REJECTED");
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      childClosed = true;
      clearTimeout(timeout);
      if (terminal?.type !== "result" || code !== 0 || signal !== null) {
        finish(() => reject(
          terminal?.type === "error"
            ? terminal.error
            : effectError("AGENTMO_BUILDER_POSIX_EFFECT_CHILD_FAILED"),
        ));
        return;
      }
      Promise.resolve().then(async () => {
        await assertRetainedDirectoryAuthority(normalized.directoryAuthority);
        if (normalized.sourceAuthority !== null) {
          await assertRetainedLinkedSourceAuthority(
            normalized.sourceAuthority,
            normalized.sourceIdentity,
          );
        }
      }).then(() => finish(() => resolve(terminal.value)), (error) => finish(() => {
        const errorCode = error?.code === "AGENTMO_BUILDER_POSIX_EFFECT_SOURCE_CHANGED"
          ? error.code
          : "AGENTMO_BUILDER_POSIX_EFFECT_DIRECTORY_CHANGED";
        reject(effectError(errorCode));
      }));
    });
    child.stdin.on("error", () => {
      if (settled || childClosed || terminal?.type === "result") return;
      terminal = Object.freeze({
        type: "error",
        error: effectError("AGENTMO_BUILDER_POSIX_EFFECT_CHILD_FAILED"),
      });
      child.kill("SIGKILL");
    });
    child.stdin.end(payload);
  });
}

function normalizeEffectRequest(request, options) {
  if (!request || typeof request !== "object" || Array.isArray(request)
    || !options || typeof options !== "object" || Array.isArray(options)) {
    throw effectError("AGENTMO_BUILDER_POSIX_EFFECT_REQUEST_REJECTED");
  }
  const requestKeys = Object.keys(request).sort();
  const hasAuthorizationName = Object.hasOwn(request, "authorizationName");
  const hasExistingIdentity = Object.hasOwn(request, "existingIdentity");
  const hasSourceName = Object.hasOwn(request, "sourceName");
  const hasSourceIdentity = Object.hasOwn(request, "sourceIdentity");
  const expectedKeys = hasAuthorizationName
    ? (hasExistingIdentity
        ? ["action", "authorizationName", "existingIdentity", "name", "payload"]
        : ["action", "authorizationName", "name", "payload"])
    : hasSourceName
    ? (hasSourceIdentity
        ? ["action", "name", "payload", "sourceIdentity", "sourceName"]
        : ["action", "name", "payload", "sourceName"])
    : ["action", "name", "payload"];
  if (JSON.stringify(requestKeys) !== JSON.stringify(expectedKeys)
    || Object.keys(options).some(
      (key) => !["directoryAuthority", "sourceAuthority"].includes(key),
    )
    || !Object.hasOwn(options, "directoryAuthority")) {
    throw effectError("AGENTMO_BUILDER_POSIX_EFFECT_REQUEST_REJECTED");
  }
  const sourceName = request.sourceName ?? null;
  const sourceIdentity = request.sourceIdentity ?? null;
  const authorizationName = request.authorizationName ?? null;
  const existingIdentity = request.existingIdentity ?? null;
  if (!["claim-symlink", "hardlink", "mkdir", "write-file", "write-selected-file"]
    .includes(request.action)) {
    throw effectError("AGENTMO_BUILDER_POSIX_EFFECT_REQUEST_REJECTED");
  }
  if (!validEffectName(request.name)) throw effectError("AGENTMO_BUILDER_POSIX_EFFECT_REQUEST_REJECTED");
  if (typeof request.payload !== "string") throw effectError("AGENTMO_BUILDER_POSIX_EFFECT_REQUEST_REJECTED");
  if (!(sourceName === null || validEffectName(sourceName))) {
    throw effectError("AGENTMO_BUILDER_POSIX_EFFECT_REQUEST_REJECTED");
  }
  if (!(authorizationName === null || validEffectName(authorizationName))
    || (request.action === "write-selected-file") !== (authorizationName !== null)
    || (request.action !== "write-selected-file" && authorizationName !== null)) {
    throw effectError("AGENTMO_BUILDER_POSIX_EFFECT_REQUEST_REJECTED");
  }
  if (!(existingIdentity === null || validFileIdentity(existingIdentity))
    || (request.action !== "write-selected-file" && existingIdentity !== null)
    || (existingIdentity !== null && existingIdentity.links !== "1")) {
    throw effectError("AGENTMO_BUILDER_POSIX_EFFECT_REQUEST_REJECTED");
  }
  if ((request.action === "hardlink") !== (sourceName !== null)) {
    throw effectError("AGENTMO_BUILDER_POSIX_EFFECT_REQUEST_REJECTED");
  }
  if (request.action === "hardlink" && sourceName === request.name) {
    throw effectError("AGENTMO_BUILDER_POSIX_EFFECT_REQUEST_REJECTED");
  }
  if (!(sourceIdentity === null || validFileIdentity(sourceIdentity))
    || (request.action !== "hardlink" && sourceIdentity !== null)) {
    throw effectError("AGENTMO_BUILDER_POSIX_EFFECT_REQUEST_REJECTED");
  }
  if (request.action === "mkdir" && request.payload !== "") {
    throw effectError("AGENTMO_BUILDER_POSIX_EFFECT_REQUEST_REJECTED");
  }
  if (request.action === "claim-symlink" && !validClaimTarget(request.payload)) {
    throw effectError("AGENTMO_BUILDER_POSIX_EFFECT_REQUEST_REJECTED");
  }
  if (["hardlink", "write-file", "write-selected-file"].includes(request.action)) {
    const bytes = Buffer.from(request.payload, "base64");
    if (bytes.length > MAX_EFFECT_BYTES || bytes.toString("base64") !== request.payload) {
      throw effectError("AGENTMO_BUILDER_POSIX_EFFECT_REQUEST_REJECTED");
    }
  }
  const directoryAuthority = options.directoryAuthority;
  if (!directoryAuthority
    || typeof directoryAuthority !== "object"
    || Array.isArray(directoryAuthority)
    || !["path", "handle", "identity"].every((key) => Object.hasOwn(directoryAuthority, key))
    || typeof directoryAuthority.path !== "string"
    || !path.isAbsolute(directoryAuthority.path)
    || directoryAuthority.path.includes("\0")
    || !validDirectoryIdentity(directoryAuthority.identity)
    || !directoryAuthority.handle
    || typeof directoryAuthority.handle.stat !== "function"
    || !Number.isInteger(directoryAuthority.handle.fd)
    || directoryAuthority.handle.fd < 0) {
    throw effectError("AGENTMO_BUILDER_POSIX_EFFECT_REQUEST_REJECTED");
  }
  const sourceAuthority = options.sourceAuthority ?? null;
  if ((sourceAuthority !== null && sourceIdentity === null)
    || (sourceAuthority !== null
      && (!sourceAuthority
        || typeof sourceAuthority !== "object"
        || Array.isArray(sourceAuthority)
        || !sourceAuthority.handle
        || typeof sourceAuthority.handle.stat !== "function"
        || !Number.isInteger(sourceAuthority.handle.fd)
        || sourceAuthority.handle.fd < 0))) {
    throw effectError("AGENTMO_BUILDER_POSIX_EFFECT_REQUEST_REJECTED");
  }
  return Object.freeze({
    action: request.action,
    authorizationName,
    existingIdentity,
    name: request.name,
    payload: request.payload,
    sourceName,
    sourceIdentity,
    sourceAuthority,
    directoryAuthority,
  });
}

async function assertRetainedDirectoryAuthority(authority) {
  try {
    const [held, current] = await Promise.all([
      authority.handle.stat({ bigint: true }),
      lstat(authority.path, { bigint: true }),
    ]);
    if (!safeDirectoryStats(held)
      || !safeDirectoryStats(current)
      || !sameDirectoryIdentity(directoryIdentityFor(held), authority.identity)
      || !sameDirectoryIdentity(directoryIdentityFor(current), authority.identity)) {
      throw effectError("AGENTMO_BUILDER_POSIX_EFFECT_DIRECTORY_CHANGED");
    }
  } catch (error) {
    if (error?.code === "AGENTMO_BUILDER_POSIX_EFFECT_DIRECTORY_CHANGED") throw error;
    throw effectError("AGENTMO_BUILDER_POSIX_EFFECT_DIRECTORY_CHANGED");
  }
}

async function assertDarwinDirectoryBridgeExecutable() {
  try {
    const stats = await lstat(DARWIN_DIRECTORY_FD_BRIDGE_COMMAND, { bigint: true });
    if (!stats.isFile()
      || stats.isSymbolicLink()
      || stats.uid !== 0n
      || (stats.mode & 0o111n) === 0n
      || (stats.mode & 0o022n) !== 0n) {
      throw effectError("AGENTMO_BUILDER_POSIX_EFFECT_BRIDGE_REJECTED");
    }
  } catch (error) {
    if (error?.code === "AGENTMO_BUILDER_POSIX_EFFECT_BRIDGE_REJECTED") throw error;
    throw effectError("AGENTMO_BUILDER_POSIX_EFFECT_BRIDGE_REJECTED");
  }
}

async function assertRetainedSourceAuthority(authority, identity) {
  try {
    const held = await authority.handle.stat({ bigint: true });
    if (!safeFileStats(held, [1n, 2n])
      || !sameFileIdentity(fileIdentityFor(held), identity)) {
      throw effectError("AGENTMO_BUILDER_POSIX_EFFECT_SOURCE_CHANGED");
    }
  } catch (error) {
    if (error?.code === "AGENTMO_BUILDER_POSIX_EFFECT_SOURCE_CHANGED") throw error;
    throw effectError("AGENTMO_BUILDER_POSIX_EFFECT_SOURCE_CHANGED");
  }
}

async function assertRetainedLinkedSourceAuthority(authority, identity) {
  try {
    const held = await authority.handle.stat({ bigint: true });
    if (!safeFileStats(held, [2n])
      || held.dev.toString(10) !== identity.device
      || held.ino.toString(10) !== identity.inode
      || held.size.toString(10) !== identity.size) {
      throw effectError("AGENTMO_BUILDER_POSIX_EFFECT_SOURCE_CHANGED");
    }
  } catch (error) {
    if (error?.code === "AGENTMO_BUILDER_POSIX_EFFECT_SOURCE_CHANGED") throw error;
    throw effectError("AGENTMO_BUILDER_POSIX_EFFECT_SOURCE_CHANGED");
  }
}

function safeDirectoryStats(stats) {
  return stats?.isDirectory?.()
    && !stats.isSymbolicLink?.()
    && stats.uid === BigInt(process.getuid())
    && (stats.mode & 0o022n) === 0n;
}

function safeFileStats(stats, expectedLinks) {
  return stats?.isFile?.()
    && !stats.isSymbolicLink?.()
    && expectedLinks.includes(stats.nlink)
    && stats.uid === BigInt(process.getuid())
    && (stats.mode & 0o077n) === 0n
    && stats.size <= BigInt(MAX_EFFECT_BYTES);
}

function validEffectName(value) {
  return typeof value === "string"
    && /^(?!\.{1,2}$)[a-zA-Z0-9.][a-zA-Z0-9._-]{0,254}$/u.test(value);
}

function validClaimTarget(value) {
  return typeof value === "string"
    && Buffer.byteLength(value, "utf8") <= MAX_CLAIM_TARGET_BYTES
    && /^(?!\.{1,2}$)[a-zA-Z0-9._-]+$/u.test(value);
}

function selectedFileAuthorizationTarget(bytes) {
  return [
    "am-selected-file-v1",
    createHash("sha256").update(bytes).digest("hex"),
    String(bytes.length),
  ].join(".");
}

function validDirectoryIdentity(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === "device,gid,inode,mode,uid"
    && ["device", "gid", "inode", "uid"].every((key) => /^\d+$/u.test(value[key] ?? ""))
    && /^[0-7]{3,4}$/u.test(value.mode ?? "");
}

function directoryIdentityFor(stats) {
  return Object.freeze({
    device: stats.dev.toString(10),
    inode: stats.ino.toString(10),
    uid: stats.uid.toString(10),
    gid: stats.gid.toString(10),
    mode: (stats.mode & 0o777n).toString(8),
  });
}

function validFileIdentity(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === "device,inode,links,size"
    && ["device", "inode", "links", "size"].every(
      (key) => /^\d+$/u.test(value[key] ?? ""),
    )
    && ["1", "2"].includes(value.links);
}

function fileIdentityFor(stats) {
  return Object.freeze({
    device: stats.dev.toString(10),
    inode: stats.ino.toString(10),
    links: stats.nlink.toString(10),
    size: stats.size.toString(10),
  });
}

function sameFileIdentity(left, right) {
  return left.device === right.device
    && left.inode === right.inode
    && left.links === right.links
    && left.size === right.size;
}

function sameDirectoryIdentity(left, right) {
  return left.device === right.device
    && left.inode === right.inode
    && left.uid === right.uid
    && left.gid === right.gid
    && left.mode === right.mode;
}

function exactKeys(value, keys) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every((key) => keys.includes(key));
}

function admitEffectResult(value, normalized) {
  const kindForAction = {
    "claim-symlink": "claim",
    hardlink: "link",
    mkdir: "directory",
    "write-file": "file",
    "write-selected-file": "file",
  };
  if (!exactKeys(value, ["created", "identity", "kind", "schemaVersion"])
    || value.schemaVersion !== PROTOCOL_VERSION
    || typeof value.created !== "boolean"
    || value.kind !== kindForAction[normalized.action]) {
    throw effectError("AGENTMO_BUILDER_POSIX_EFFECT_PROTOCOL_REJECTED");
  }
  const identity = normalized.action === "mkdir"
    ? (validDirectoryIdentity(value.identity) ? value.identity : null)
    : (validFileIdentity(value.identity) ? value.identity : null);
  if (identity === null) {
    throw effectError("AGENTMO_BUILDER_POSIX_EFFECT_PROTOCOL_REJECTED");
  }
  return Object.freeze({
    schemaVersion: PROTOCOL_VERSION,
    created: value.created,
    identity: Object.freeze({ ...identity }),
    kind: value.kind,
  });
}

if (process.argv[2] === RETIRED_CHILD_ENTRY_ARGUMENT) {
  process.exitCode = 1;
}

function effectError(code) {
  const error = new Error("Builder POSIX effect rejected.");
  error.name = "BuilderPosixEffectError";
  error.code = code;
  return error;
}
