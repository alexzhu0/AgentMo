import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  chmod,
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { before, describe, it } from "node:test";
import {
  OPENCLAW_FS_BUILD_RECEIPT_SCHEMA_VERSION,
  admitOpenClawFsKernel,
  buildOpenClawFsKernel,
  openOpenClawSafeFsSession,
} from "../src/openclaw-safe-fs.js";
import {
  startNativeBuildOutputAttacker,
} from "./helpers/native-build-output-attacker.js";

const sha256 = (bytes) => (
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`
);
const SOURCE_PATH = fileURLToPath(
  new URL("../native/openclaw-fs-kernel.c", import.meta.url),
);
const OPENCLAW_FS_BUILD_PAIR_SCHEMA_VERSION =
  "agentmo.openclaw-fs-build-pair.v1";
const OPENCLAW_FS_BUILD_RECOVERY_SCHEMA_VERSION =
  "agentmo.openclaw-fs-build-recovery.v1";
const TEST_PROTOCOL_RESPONSE_TIMEOUT_MS = 30_000;

let buildRoot;
let helperPath;
let receiptPath;
let receiptDigest;
let buildResult;

before(async () => {
  if (process.platform !== "linux") return;
  buildRoot = await mkdtemp(path.join(tmpdir(), "agentmo-safe-fs-build-"));
  await chmod(buildRoot, 0o700);
  helperPath = path.join(buildRoot, "openclaw-fs-kernel");
  receiptPath = path.join(buildRoot, "openclaw-fs-kernel.receipt.json");
  const built = await buildOpenClawFsKernel({
    binaryOut: helperPath,
    receiptOut: receiptPath,
  });
  buildResult = built;
  receiptDigest = built.receiptDigest;
});

function runProtocol(lines) {
  return new Promise((resolve) => {
    const child = spawn(helperPath, [], {
      env: {
        PATH: "/usr/bin:/bin",
        LC_ALL: "C",
        LANG: "C",
      },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(`${lines.join("\n")}\n`);
  });
}

function exactReplacementBasis(observation) {
  return {
    parentIdentity: {
      device: observation.parentDevice,
      inode: observation.parentInode,
    },
    fileIdentity: {
      device: observation.device,
      inode: observation.inode,
      mode: observation.mode,
      owner: observation.uid,
    },
    expectedBaseDigest: observation.digest,
  };
}

function runProcess(executable, argv, privateRoot) {
  return new Promise((resolve) => {
    const child = spawn(executable, argv, {
      env: {
        HOME: privateRoot,
        PATH: "/usr/bin:/bin",
        LC_ALL: "C",
        LANG: "C",
        TMPDIR: privateRoot,
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function trackProtocolResponses(child) {
  let stdout = "";
  let failure = null;
  const responses = [];
  const waiters = [];
  const rejectWaiters = (error) => {
    failure = error;
    while (waiters.length > 0) {
      const waiter = waiters.shift();
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  };
  const resolveWaiters = () => {
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      if (responses.length < waiter.count) continue;
      waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
  };
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    while (stdout.includes("\n")) {
      const index = stdout.indexOf("\n");
      try {
        responses.push(JSON.parse(stdout.slice(0, index)));
      } catch {
        rejectWaiters(new Error("test helper emitted invalid protocol JSON"));
        return;
      }
      stdout = stdout.slice(index + 1);
      resolveWaiters();
    }
  });
  child.once("error", (error) => rejectWaiters(error));
  child.once("close", (code, signal) => {
    if (waiters.length > 0) {
      rejectWaiters(new Error(
        `test helper closed before protocol condition: code=${code}; signal=${signal}`,
      ));
    }
  });
  return {
    responses,
    waitForCount(count, description) {
      if (responses.length >= count) return Promise.resolve();
      if (failure) return Promise.reject(failure);
      return new Promise((resolve, reject) => {
        const waiter = { count, resolve, reject, timer: null };
        waiter.timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error(
            `timed out waiting for ${description}; received ${responses.length}/${count} protocol responses`,
          ));
        }, TEST_PROTOCOL_RESPONSE_TIMEOUT_MS);
        waiters.push(waiter);
      });
    },
  };
}

function captureBuildFailure(operation) {
  let failure;
  return assert.rejects(operation, (error) => {
    failure = error;
    return error?.code === "AGENTMO_OPENCLAW_FS_BUILD_REJECTED";
  }).then(() => failure);
}

function assertClosedRecoveryEvidence(recovery, forbidden = []) {
  assert.equal(
    recovery.schemaVersion,
    OPENCLAW_FS_BUILD_RECOVERY_SCHEMA_VERSION,
  );
  assert.equal(recovery.disposition, "recovery-required");
  assert.equal(recovery.retry, "exact-pair-admission-required");
  assert.deepEqual(
    recovery.parents.map((entry) => entry.role),
    ["binary-output-parent", "receipt-output-parent"],
  );
  assert.deepEqual(
    recovery.members.map((entry) => entry.role),
    ["helper-binary", "build-receipt"],
  );
  for (const member of recovery.members) {
    assert.equal(
      ["created", "preserved", "unknown"].includes(member.state),
      true,
    );
    assert.equal(
      ["preserved", "absent", "unknown"].includes(member.disposition),
      true,
    );
    assert.equal(
      member.digest === null || /^sha256:[a-f0-9]{64}$/u.test(member.digest),
      true,
    );
    assert.equal(
      member.identity === null || typeof member.identity.inode === "string",
      true,
    );
  }
  const durable = JSON.stringify(recovery);
  assert.equal(/"(?:path|bytes|content|stdout|stderr)"/iu.test(durable), false);
  for (const value of forbidden) assert.equal(durable.includes(value), false);
}

it("fails closed before native build or admission outside Linux", {
  skip: process.platform === "linux",
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-safe-fs-unsupported-"));
  await chmod(root, 0o700);
  await assert.rejects(
    () => buildOpenClawFsKernel({
      binaryOut: path.join(root, "openclaw-fs-kernel"),
      receiptOut: path.join(root, "openclaw-fs-kernel.receipt.json"),
    }),
    (error) => error?.code === "AGENTMO_OPENCLAW_FS_PLATFORM_UNSUPPORTED",
  );
  await assert.rejects(
    () => admitOpenClawFsKernel({
      helperPath: path.join(root, "openclaw-fs-kernel"),
      receiptPath: path.join(root, "openclaw-fs-kernel.receipt.json"),
      receiptDigest: `sha256:${"0".repeat(64)}`,
    }),
    (error) => error?.code === "AGENTMO_OPENCLAW_FS_PLATFORM_UNSUPPORTED",
  );
});

it("executes the safe-fs helper only through one retained inherited descriptor", async () => {
  const source = await readFile(
    fileURLToPath(new URL("../src/openclaw-safe-fs.js", import.meta.url)),
    "utf8",
  );
  assert.match(source, /const EXECUTION_HELPER_DESCRIPTOR = 3;/u);
  assert.match(
    source,
    /const EXECUTION_HELPER_PATH = `\/proc\/self\/fd\/\$\{EXECUTION_HELPER_DESCRIPTOR\}`;/u,
  );
  assert.match(source, /spawn\(EXECUTION_HELPER_PATH, \[\], \{/u);
  assert.doesNotMatch(source, /spawn\(executionPath, \[\], \{/u);
});

describe("OpenClaw safe fs retained-dirfd kernel", {
  skip: process.platform !== "linux",
}, () => {
  it("builds a durable closed receipt with fixed compiler, argv and environment", async () => {
    const receiptBytes = await readFile(receiptPath);
    assert.equal(receiptDigest, sha256(receiptBytes));
    const receipt = JSON.parse(receiptBytes);
    assert.equal(
      receipt.schemaVersion,
      OPENCLAW_FS_BUILD_RECEIPT_SCHEMA_VERSION,
    );
    assert.equal(receipt.kind, "agentmo-openclaw-fs-kernel");
    assert.equal(receipt.source.path, SOURCE_PATH);
    assert.equal(receipt.compiler.path, "/usr/bin/cc");
    assert.deepEqual(receipt.environment, {
      HOME: receipt.environment.HOME,
      LANG: "C",
      LC_ALL: "C",
      PATH: "/usr/bin:/bin",
      TMPDIR: receipt.environment.TMPDIR,
    });
    assert.equal(receipt.argv[0], "/usr/bin/cc");
    assert.deepEqual(receipt.argv.slice(1, 4), ["-x", "c", "/proc/self/fd/3"]);
    assert.equal(receipt.argv.at(-1), "/proc/self/fd/4");
    assert.equal(
      receipt.reproducibility.strategy,
      "independent-double-build-from-retained-fd-source-and-outputs",
    );
    assert.equal(receipt.reproducibility.source.descriptor, 3);
    assert.equal(receipt.reproducibility.source.path, "/proc/self/fd/3");
    assert.equal(
      receipt.reproducibility.source.digest,
      receipt.source.digest,
    );
    assert.equal(receipt.reproducibility.primaryOutput.descriptor, 4);
    assert.equal(receipt.reproducibility.primaryOutput.path, "/proc/self/fd/4");
    assert.equal(receipt.reproducibility.verificationOutput.descriptor, 4);
    assert.equal(
      receipt.reproducibility.verificationOutput.path,
      "/proc/self/fd/4",
    );
    assert.equal(
      receipt.reproducibility.primaryOutput.digest,
      receipt.binary.digest,
    );
    assert.equal(
      receipt.reproducibility.verificationOutput.digest,
      receipt.binary.digest,
    );
    assert.notEqual(
      receipt.reproducibility.primaryOutput.identity.inode,
      receipt.reproducibility.verificationOutput.identity.inode,
    );
    assert.deepEqual(receipt.reproducibility.primaryArgv, receipt.argv);
    assert.deepEqual(
      receipt.reproducibility.verificationArgv,
      receipt.argv,
    );
    assert.equal(receipt.argv.includes("-o"), true);
    assert.notEqual(receipt.argv.at(-1), helperPath);
    assert.equal(receipt.binary.path, helperPath);
    assert.equal(
      receipt.publication.schemaVersion,
      OPENCLAW_FS_BUILD_PAIR_SCHEMA_VERSION,
    );
    assert.equal(receipt.publication.sameParent, true);
    assert.deepEqual(
      receipt.publication.binaryParentIdentity,
      receipt.publication.receiptParentIdentity,
    );
    assert.equal(Object.hasOwn(receipt, "stdout"), false);
    assert.equal(Object.hasOwn(receipt, "stderr"), false);
    assert.equal(
      buildResult.pair.schemaVersion,
      OPENCLAW_FS_BUILD_PAIR_SCHEMA_VERSION,
    );
    assert.equal(buildResult.pair.disposition, "published-and-admitted");
    assert.equal(
      JSON.stringify(buildResult.pair).includes(path.dirname(helperPath)),
      false,
    );
    assert.deepEqual(buildResult.privateBuildCleanup, {
      disposition: "preserved",
      reason: "private-build-objects-not-unlinked-by-pathname",
    });
    assert.equal(Object.isFrozen(await admitOpenClawFsKernel({
      helperPath,
      receiptPath,
      receiptDigest,
    })), true);
  });

  it("publishes only retained compiler bytes during repeated output-path replacement", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "agentmo-safe-fs-output-substitution-"),
    );
    await chmod(root, 0o700);
    const attacker = startNativeBuildOutputAttacker({
      root,
      buildDirectoryPrefix: ".agentmo-openclaw-fs-build-",
      outputNames: [
        "openclaw-fs-kernel.primary",
        "openclaw-fs-kernel.stage",
      ],
      replacementCount: 4,
    });
    try {
      const built = await buildOpenClawFsKernel({
        binaryOut: path.join(root, "openclaw-fs-kernel"),
        receiptOut: path.join(root, "openclaw-fs-kernel.receipt.json"),
      });
      assert.equal(await attacker.exited, 0);
      const receipt = JSON.parse(await readFile(built.receiptPath, "utf8"));
      assert.equal(
        sha256(await readFile(built.binaryPath)),
        receipt.reproducibility.primaryOutput.digest,
      );
      assert.equal(
        receipt.reproducibility.primaryOutput.digest,
        receipt.reproducibility.verificationOutput.digest,
      );
    } finally {
      attacker.stop();
    }
  });

  it("keeps the retained compiler input when the source pathname changes", async () => {
    const isolatedRoot = await mkdtemp(
      path.join(tmpdir(), "agentmo-safe-fs-source-replacement-"),
    );
    const isolatedSourceRoot = path.join(isolatedRoot, "src");
    const isolatedNativeRoot = path.join(isolatedRoot, "native");
    const isolatedBuildRoot = path.join(isolatedRoot, "build");
    await Promise.all([
      mkdir(isolatedSourceRoot),
      mkdir(isolatedNativeRoot),
      mkdir(isolatedBuildRoot),
    ]);
    await chmod(isolatedBuildRoot, 0o700);
    const isolatedModulePath = path.join(
      isolatedSourceRoot,
      "openclaw-safe-fs.mjs",
    );
    const isolatedSourcePath = path.join(
      isolatedNativeRoot,
      "openclaw-fs-kernel.c",
    );
    await Promise.all([
      copyFile(
        fileURLToPath(new URL("../src/openclaw-safe-fs.js", import.meta.url)),
        isolatedModulePath,
      ),
      copyFile(SOURCE_PATH, isolatedSourcePath),
    ]);
    const isolated = await import(pathToFileURL(isolatedModulePath).href);
    const binaryOut = path.join(isolatedBuildRoot, "openclaw-fs-kernel");
    const receiptOut = path.join(
      isolatedBuildRoot,
      "openclaw-fs-kernel.receipt.json",
    );
    const buildPromise = isolated.buildOpenClawFsKernel({
      binaryOut,
      receiptOut,
    });
    let privateRoot;
    const started = Date.now();
    while (Date.now() - started < 5_000) {
      const names = await readdir(isolatedBuildRoot);
      const name = names.find((entry) => (
        entry.startsWith(".agentmo-openclaw-fs-build-")
      ));
      if (name) {
        const primaryPath = path.join(
          isolatedBuildRoot,
          name,
          "openclaw-fs-kernel.primary",
        );
        try {
          await lstat(primaryPath);
          privateRoot = path.join(isolatedBuildRoot, name);
          break;
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(typeof privateRoot, "string");
    const retainedSourcePath = `${isolatedSourcePath}.retained`;
    const replacementSourcePath = `${isolatedSourcePath}.replacement`;
    await rename(isolatedSourcePath, retainedSourcePath);
    await writeFile(
      isolatedSourcePath,
      "int main(void) { return 86; }\n",
      { flag: "wx", mode: 0o600 },
    );
    try {
      const primaryPath = path.join(
        privateRoot,
        "openclaw-fs-kernel.primary",
      );
      const compiledStarted = Date.now();
      while (Date.now() - compiledStarted < 5_000) {
        if ((await lstat(primaryPath)).size > 0) break;
        await new Promise((resolve) => setImmediate(resolve));
      }
    } finally {
      await rename(isolatedSourcePath, replacementSourcePath);
      await rename(retainedSourcePath, isolatedSourcePath);
    }
    const built = await buildPromise;
    assert.equal(
      sha256(await readFile(built.binaryPath)),
      sha256(await readFile(helperPath)),
    );
  });

  it("reports private build and execution objects preserved instead of pathname cleanup", async () => {
    const source = await readFile(
      fileURLToPath(new URL("../src/openclaw-safe-fs.js", import.meta.url)),
      "utf8",
    );
    assert.equal(/\b(?:unlink|rmdir)\s*\(/u.test(source), false);
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-safe-fs-preserve-private-"));
    await chmod(root, 0o700);
    const session = await openOpenClawSafeFsSession({
      rootPath: root,
      helperPath,
      receiptPath,
      receiptDigest,
    });
    assert.deepEqual(await session.close(), {
      disposition: "preserved",
      reason: "private-execution-copy-not-unlinked-by-pathname",
    });
  });

  it("executes retained helper bytes after the execution-copy pathname changes", async () => {
    const isolatedRoot = await mkdtemp(
      path.join(tmpdir(), "agentmo-safe-fs-retained-exec-"),
    );
    const isolatedSourceRoot = path.join(isolatedRoot, "src");
    const isolatedNativeRoot = path.join(isolatedRoot, "native");
    const isolatedBuildRoot = path.join(isolatedRoot, "build");
    const targetRoot = path.join(isolatedRoot, "target");
    await Promise.all([
      mkdir(isolatedSourceRoot),
      mkdir(isolatedNativeRoot),
      mkdir(isolatedBuildRoot),
      mkdir(targetRoot),
    ]);
    await Promise.all([
      chmod(isolatedBuildRoot, 0o700),
      chmod(targetRoot, 0o700),
    ]);
    const readyPath = path.join(isolatedRoot, "retained-ready");
    const releasePath = path.join(isolatedRoot, "retained-release");
    const replacementMarker = path.join(isolatedRoot, "replacement-executed");
    const modulePath = path.join(isolatedSourceRoot, "openclaw-safe-fs.mjs");
    const productionSource = await readFile(
      fileURLToPath(new URL("../src/openclaw-safe-fs.js", import.meta.url)),
      "utf8",
    );
    const spawnNeedle = "    child = spawn(EXECUTION_HELPER_PATH, [], {";
    assert.equal(productionSource.split(spawnNeedle).length, 2);
    const isolatedSource = productionSource.replace(spawnNeedle, [
      "    {",
      "      const barrierFs = await import(\"node:fs/promises\");",
      `      await barrierFs.writeFile(${JSON.stringify(readyPath)}, executionPath);`,
      "      for (;;) {",
      "        try {",
      `          await barrierFs.access(${JSON.stringify(releasePath)});`,
      "          break;",
      "        } catch (error) {",
      "          if (error?.code !== \"ENOENT\") throw error;",
      "          await new Promise((resolve) => setTimeout(resolve, 5));",
      "        }",
      "      }",
      "    }",
      spawnNeedle,
    ].join("\n"));
    await Promise.all([
      writeFile(modulePath, isolatedSource),
      copyFile(SOURCE_PATH, path.join(isolatedNativeRoot, "openclaw-fs-kernel.c")),
    ]);
    const isolated = await import(pathToFileURL(modulePath).href);
    const isolatedHelperPath = path.join(
      isolatedBuildRoot,
      "openclaw-fs-kernel",
    );
    const isolatedReceiptPath = path.join(
      isolatedBuildRoot,
      "openclaw-fs-kernel.receipt.json",
    );
    const built = await isolated.buildOpenClawFsKernel({
      binaryOut: isolatedHelperPath,
      receiptOut: isolatedReceiptPath,
    });
    const sessionPromise = isolated.openOpenClawSafeFsSession({
      rootPath: targetRoot,
      helperPath: isolatedHelperPath,
      receiptPath: isolatedReceiptPath,
      receiptDigest: built.receiptDigest,
    });
    let executionPath;
    const started = Date.now();
    while (Date.now() - started < 10_000) {
      try {
        executionPath = await readFile(readyPath, "utf8");
        break;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
    if (typeof executionPath !== "string") {
      await writeFile(releasePath, "release\n", { mode: 0o600, flag: "wx" });
      await sessionPromise.catch(() => {});
      assert.fail("retained execution barrier was not reached");
    }
    const retainedExecutionPath = `${executionPath}.retained`;
    try {
      await rename(executionPath, retainedExecutionPath);
      await writeFile(executionPath, [
        "#!/bin/sh",
        `printf replacement > ${JSON.stringify(replacementMarker)}`,
        "exit 86",
        "",
      ].join("\n"), { mode: 0o700, flag: "wx" });
    } finally {
      await writeFile(releasePath, "release\n", { mode: 0o600, flag: "wx" });
    }
    const session = await sessionPromise;
    await session.close();
    await assert.rejects(
      () => access(replacementMarker),
      (error) => error?.code === "ENOENT",
    );
    assert.equal((await lstat(retainedExecutionPath)).isFile(), true);
  });

  it("preserves an existing build destination byte-for-byte with the same identity", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-safe-fs-build-existing-"));
    await chmod(root, 0o700);
    const binaryOut = path.join(root, "openclaw-fs-kernel");
    const receiptOut = path.join(root, "openclaw-fs-kernel.receipt.json");
    await writeFile(binaryOut, "user-owned-occupant", {
      flag: "wx",
      mode: 0o700,
    });
    const before = await lstat(binaryOut, { bigint: true });
    await assert.rejects(
      () => buildOpenClawFsKernel({ binaryOut, receiptOut }),
      (error) => error?.code === "AGENTMO_OPENCLAW_FS_BUILD_REJECTED",
    );
    const after = await lstat(binaryOut, { bigint: true });
    assert.equal(after.dev, before.dev);
    assert.equal(after.ino, before.ino);
    assert.equal(await readFile(binaryOut, "utf8"), "user-owned-occupant");
    await assert.rejects(() => access(receiptOut));
  });

  it("reports a binary-only crash state as one recoverable pair without paths or bytes", async () => {
    const binaryParent = await mkdtemp(
      path.join(tmpdir(), "agentmo-safe-fs-binary-parent-"),
    );
    const receiptParent = await mkdtemp(
      path.join(tmpdir(), "agentmo-safe-fs-receipt-parent-"),
    );
    await chmod(binaryParent, 0o700);
    await chmod(receiptParent, 0o700);
    const binaryOut = path.join(binaryParent, "openclaw-fs-kernel");
    const receiptOut = path.join(
      receiptParent,
      "openclaw-fs-kernel.receipt.json",
    );
    const binaryBytes = await readFile(helperPath);
    await writeFile(binaryOut, binaryBytes, { flag: "wx", mode: 0o700 });

    const failure = await captureBuildFailure(
      () => buildOpenClawFsKernel({ binaryOut, receiptOut }),
    );
    assert.equal(failure.recovery.failurePoint, "preflight-binary-only");
    assert.equal(failure.recovery.sameParent, false);
    assertClosedRecoveryEvidence(failure.recovery, [
      binaryParent,
      receiptParent,
    ]);
    assert.deepEqual(failure.recovery.members[0], {
      role: "helper-binary",
      state: "preserved",
      digest: sha256(binaryBytes),
      identity: failure.recovery.members[0].identity,
      disposition: "preserved",
    });
    assert.deepEqual(failure.recovery.members[1], {
      role: "build-receipt",
      state: "unknown",
      digest: null,
      identity: null,
      disposition: "absent",
    });
    await assert.rejects(
      () => admitOpenClawFsKernel({
        helperPath: binaryOut,
        receiptPath: receiptOut,
        receiptDigest,
      }),
      (error) => error?.code === "AGENTMO_OPENCLAW_FS_ADMISSION_REJECTED",
    );
  });

  it("marks the helper created when receipt publication loses a post-compile race", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "agentmo-safe-fs-receipt-race-"),
    );
    await chmod(root, 0o700);
    const binaryOut = path.join(root, "openclaw-fs-kernel");
    const receiptOut = path.join(root, "openclaw-fs-kernel.receipt.json");
    const receiptOccupant = "caller-owned-receipt-occupant";
    const failurePromise = buildOpenClawFsKernel({
      binaryOut,
      receiptOut,
    }).then(
      () => null,
      (error) => error,
    );
    const started = Date.now();
    while (Date.now() - started < 5_000) {
      const names = await readdir(root);
      if (names.some((name) => (
        name.startsWith(".agentmo-openclaw-fs-build-")
      ))) break;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    await writeFile(receiptOut, receiptOccupant, {
      flag: "wx",
      mode: 0o600,
    });
    const failure = await failurePromise;
    assert.equal(failure?.code, "AGENTMO_OPENCLAW_FS_BUILD_REJECTED");
    assert.equal(failure.recovery.failurePoint, "after-binary-publication");
    assertClosedRecoveryEvidence(failure.recovery, [root, receiptOccupant]);
    assert.equal(failure.recovery.members[0].state, "created");
    assert.equal(failure.recovery.members[0].disposition, "preserved");
    assert.equal(failure.recovery.members[1].state, "preserved");
    assert.equal(await readFile(receiptOut, "utf8"), receiptOccupant);
  });

  it("itemizes a partial receipt crash and preserves a late binary replacement", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "agentmo-safe-fs-partial-receipt-"),
    );
    await chmod(root, 0o700);
    const binaryOut = path.join(root, "openclaw-fs-kernel");
    const receiptOut = path.join(root, "openclaw-fs-kernel.receipt.json");
    const binaryBytes = await readFile(helperPath);
    const partialSecret = "partial-receipt-secret-must-not-leak";
    await writeFile(binaryOut, binaryBytes, { flag: "wx", mode: 0o700 });
    await writeFile(receiptOut, partialSecret, { flag: "wx", mode: 0o600 });

    const firstFailure = await captureBuildFailure(
      () => buildOpenClawFsKernel({ binaryOut, receiptOut }),
    );
    assert.equal(
      firstFailure.recovery.failurePoint,
      "preflight-receipt-incomplete",
    );
    assertClosedRecoveryEvidence(firstFailure.recovery, [root, partialSecret]);
    assert.equal(firstFailure.recovery.members[1].state, "preserved");
    assert.equal(
      firstFailure.recovery.members[1].digest,
      sha256(Buffer.from(partialSecret)),
    );
    const firstBinaryIdentity = firstFailure.recovery.members[0].identity;

    const retainedOut = path.join(root, "retained-original-helper");
    await rename(binaryOut, retainedOut);
    await writeFile(binaryOut, binaryBytes, { flag: "wx", mode: 0o700 });
    const secondFailure = await captureBuildFailure(
      () => buildOpenClawFsKernel({ binaryOut, receiptOut }),
    );
    assertClosedRecoveryEvidence(secondFailure.recovery, [root, partialSecret]);
    assert.notEqual(
      secondFailure.recovery.members[0].identity.inode,
      firstBinaryIdentity.inode,
    );
    assert.equal(secondFailure.recovery.members[0].digest, sha256(binaryBytes));
    assert.deepEqual(await readFile(retainedOut), binaryBytes);
    assert.deepEqual(await readFile(binaryOut), binaryBytes);
    assert.equal(await readFile(receiptOut, "utf8"), partialSecret);
  });

  it("binds different output parents and exact-pair retry re-admits synced bytes", async () => {
    const binaryParent = await mkdtemp(
      path.join(tmpdir(), "agentmo-safe-fs-pair-binary-"),
    );
    const receiptParent = await mkdtemp(
      path.join(tmpdir(), "agentmo-safe-fs-pair-receipt-"),
    );
    await chmod(binaryParent, 0o700);
    await chmod(receiptParent, 0o700);
    const binaryOut = path.join(binaryParent, "openclaw-fs-kernel");
    const receiptOut = path.join(
      receiptParent,
      "openclaw-fs-kernel.receipt.json",
    );
    const first = await buildOpenClawFsKernel({ binaryOut, receiptOut });
    const receipt = JSON.parse(await readFile(receiptOut, "utf8"));
    assert.equal(receipt.publication.sameParent, false);
    assert.notEqual(
      receipt.publication.binaryParentIdentity.inode,
      receipt.publication.receiptParentIdentity.inode,
    );

    const retry = await buildOpenClawFsKernel({ binaryOut, receiptOut });
    assert.equal(retry.receiptDigest, first.receiptDigest);
    assert.equal(retry.pair.disposition, "recovered-and-admitted");
    assert.equal(retry.pair.sameParent, false);
    assert.equal(
      JSON.stringify(retry.pair).includes(binaryParent),
      false,
    );
    assert.equal(
      JSON.stringify(retry.pair).includes(receiptParent),
      false,
    );
    assert.equal(Object.isFrozen(await admitOpenClawFsKernel({
      helperPath: binaryOut,
      receiptPath: receiptOut,
      receiptDigest: retry.receiptDigest,
    })), true);
  });

  it("rejects external digest, unknown receipt keys, source and binary drift", async () => {
    await assert.rejects(
      () => admitOpenClawFsKernel({
        helperPath,
        receiptPath,
        receiptDigest: `sha256:${"0".repeat(64)}`,
      }),
      (error) => error?.code === "AGENTMO_OPENCLAW_FS_ADMISSION_REJECTED",
    );

    const original = JSON.parse(await readFile(receiptPath, "utf8"));
    for (const [name, mutate] of [
      ["unknown-key", (value) => { value.untrusted = true; }],
      ["source-drift", (value) => { value.source.digest = `sha256:${"1".repeat(64)}`; }],
      ["compiler-drift", (value) => { value.compiler.fingerprint = `sha256:${"2".repeat(64)}`; }],
      ["argv-drift", (value) => { value.argv = [...value.argv, "-DUNTRUSTED=1"]; }],
    ]) {
      const candidate = structuredClone(original);
      mutate(candidate);
      const candidatePath = path.join(buildRoot, `${name}.receipt.json`);
      const bytes = Buffer.from(`${JSON.stringify(candidate, null, 2)}\n`);
      await writeFile(candidatePath, bytes, { flag: "wx", mode: 0o600 });
      await assert.rejects(
        () => admitOpenClawFsKernel({
          helperPath,
          receiptPath: candidatePath,
          receiptDigest: sha256(bytes),
        }),
        (error) => error?.code === "AGENTMO_OPENCLAW_FS_ADMISSION_REJECTED",
      );
    }

    const replacedHelper = path.join(buildRoot, "replaced-helper");
    await writeFile(replacedHelper, await readFile(helperPath), {
      flag: "wx",
      mode: 0o700,
    });
    await writeFile(replacedHelper, Buffer.from("#!/bin/sh\nexit 0\n"));
    await assert.rejects(
      () => admitOpenClawFsKernel({
        helperPath: replacedHelper,
        receiptPath,
        receiptDigest,
      }),
      (error) => error?.code === "AGENTMO_OPENCLAW_FS_ADMISSION_REJECTED",
    );
  });

  it("rejects PATH-only helpers, missing binaries and unsupported receipt platforms", async () => {
    await assert.rejects(
      () => admitOpenClawFsKernel({
        helperPath: path.basename(helperPath),
        receiptPath,
        receiptDigest,
      }),
      (error) => error?.code === "AGENTMO_OPENCLAW_FS_ADMISSION_REJECTED",
    );
    await assert.rejects(
      () => admitOpenClawFsKernel({
        helperPath: path.join(buildRoot, "missing-helper"),
        receiptPath,
        receiptDigest,
      }),
      (error) => error?.code === "AGENTMO_OPENCLAW_FS_ADMISSION_REJECTED",
    );
    const unsupported = JSON.parse(await readFile(receiptPath, "utf8"));
    unsupported.platform = "win32";
    const bytes = Buffer.from(`${JSON.stringify(unsupported, null, 2)}\n`);
    const candidatePath = path.join(buildRoot, "unsupported.receipt.json");
    await writeFile(candidatePath, bytes, { flag: "wx", mode: 0o600 });
    await assert.rejects(
      () => admitOpenClawFsKernel({
        helperPath,
        receiptPath: candidatePath,
        receiptDigest: sha256(bytes),
      }),
      (error) => error?.code === "AGENTMO_OPENCLAW_FS_ADMISSION_REJECTED",
    );
  });

  it("uses platform-exclusive rename primitives and never plain renameat publication", async () => {
    const source = await readFile(SOURCE_PATH, "utf8");
    assert.match(source, /renameat2[\s\S]*RENAME_NOREPLACE/u);
    assert.match(source, /renameatx_np[\s\S]*RENAME_EXCL/u);
    assert.equal(
      /(?<![a-zA-Z0-9_])renameat\s*\(/u.test(source),
      false,
    );
    assert.equal(/\b(?:system|popen)\s*\(/u.test(source), false);
  });

  it("rejects ancestor swap and preserves the external sentinel bytes and identity", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-safe-fs-ancestor-"));
    await chmod(root, 0o700);
    const managed = path.join(root, "managed");
    const retained = path.join(root, "managed-retained");
    const outside = await mkdtemp(path.join(tmpdir(), "agentmo-safe-fs-outside-"));
    await chmod(outside, 0o700);
    const sentinel = path.join(outside, "payload");
    await mkdir(managed, { mode: 0o700 });
    await writeFile(sentinel, "outside-sentinel", { mode: 0o600 });
    const before = await lstat(sentinel, { bigint: true });
    const session = await openOpenClawSafeFsSession({
      rootPath: root,
      helperPath,
      receiptPath,
      receiptDigest,
    });
    await rename(managed, retained);
    await symlink(outside, managed);
    const result = await session.createOnly(
      "managed/payload",
      Buffer.from("attacker-overwrite"),
      0o600,
    );
    assert.equal(result.disposition, "preserved");
    assert.equal(await readFile(sentinel, "utf8"), "outside-sentinel");
    const after = await lstat(sentinel, { bigint: true });
    assert.equal(after.dev, before.dev);
    assert.equal(after.ino, before.ino);
    await session.close();
  });

  it("rejects final symlink and same-path replacement without overwriting", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-safe-fs-final-"));
    await chmod(root, 0o700);
    const outside = await mkdtemp(path.join(tmpdir(), "agentmo-safe-fs-final-outside-"));
    await chmod(outside, 0o700);
    const sentinel = path.join(outside, "sentinel");
    await writeFile(sentinel, "sentinel", { mode: 0o600 });
    await symlink(sentinel, path.join(root, "managed"));
    const before = await lstat(sentinel, { bigint: true });
    const session = await openOpenClawSafeFsSession({
      rootPath: root,
      helperPath,
      receiptPath,
      receiptDigest,
    });
    const symlinkResult = await session.createOnly(
      "managed",
      Buffer.from("replacement"),
      0o600,
    );
    assert.equal(symlinkResult.disposition, "preserved");
    assert.equal(await readFile(sentinel, "utf8"), "sentinel");
    const after = await lstat(sentinel, { bigint: true });
    assert.equal(after.dev, before.dev);
    assert.equal(after.ino, before.ino);

    const observation = await session.observe("same-path");
    assert.equal(observation.disposition, "absent");
    await writeFile(path.join(root, "same-path"), "user-won", {
      flag: "wx",
      mode: 0o600,
    });
    const replacement = await session.createOnly(
      "same-path",
      Buffer.from("agentmo"),
      0o600,
    );
    assert.equal(replacement.disposition, "preserved");
    assert.equal(await readFile(path.join(root, "same-path"), "utf8"), "user-won");
    await session.close();
  });

  it("rejects oversized, extra-key and unknown-operation protocol messages", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-safe-fs-protocol-"));
    await chmod(root, 0o700);
    const unknown = await runProtocol([
      JSON.stringify({ operation: "open", rootPath: root }),
      JSON.stringify({ operation: "execute-shell", path: "x" }),
    ]);
    assert.notEqual(unknown.code, 0);
    assert.equal(unknown.stdout.includes("execute-shell"), false);

    const extra = await runProtocol([
      JSON.stringify({ operation: "open", rootPath: root, extra: "forbidden" }),
    ]);
    assert.notEqual(extra.code, 0);

    const oversized = await runProtocol([
      JSON.stringify({
        operation: "open",
        rootPath: root,
        padding: "x".repeat(70 * 1024),
      }),
    ]);
    assert.notEqual(oversized.code, 0);
    assert.equal(oversized.stdout.length < 64 * 1024, true);
    assert.equal(oversized.stderr.length < 64 * 1024, true);
  });

  it("publishes create-only bytes durably and preserves an existing destination", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-safe-fs-create-"));
    await chmod(root, 0o700);
    const session = await openOpenClawSafeFsSession({
      rootPath: root,
      helperPath,
      receiptPath,
      receiptDigest,
    });
    const first = await session.createOnly(
      "published",
      Buffer.from("first"),
      0o600,
    );
    assert.equal(first.disposition, "created");
    assert.equal(first.digest, sha256(Buffer.from("first")));
    const identity = await lstat(path.join(root, "published"), { bigint: true });

    const second = await session.createOnly(
      "published",
      Buffer.from("second"),
      0o600,
    );
    assert.equal(second.disposition, "preserved");
    assert.equal(await readFile(path.join(root, "published"), "utf8"), "first");
    const after = await lstat(path.join(root, "published"), { bigint: true });
    assert.equal(after.dev, identity.dev);
    assert.equal(after.ino, identity.ino);
    await session.close();
    await access(path.join(root, "published"));
  });

  it("atomically consumes a complete private file through retained source and destination dirfds", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-safe-fs-publish-file-"));
    await chmod(root, 0o700);
    await mkdir(path.join(root, "private"), { mode: 0o700 });
    await mkdir(path.join(root, "public"), { mode: 0o700 });
    const sourcePath = path.join(root, "private", "complete.stage");
    const destinationPath = path.join(root, "public", "complete.json");
    await writeFile(sourcePath, "complete-private-file", {
      flag: "wx",
      mode: 0o600,
    });
    const source = await lstat(sourcePath, { bigint: true });
    const session = await openOpenClawSafeFsSession({
      rootPath: root,
      helperPath,
      receiptPath,
      receiptDigest,
    });

    const published = await session.publishNoReplace(
      "private/complete.stage",
      "public/complete.json",
      {
        device: source.dev.toString(),
        inode: source.ino.toString(),
        type: "file",
      },
    );

    assert.deepEqual(published, {
      ok: true,
      disposition: "published",
      device: source.dev.toString(),
      inode: source.ino.toString(),
      type: "file",
    });
    await assert.rejects(() => access(sourcePath));
    assert.equal(await readFile(destinationPath, "utf8"), "complete-private-file");
    const destination = await lstat(destinationPath, { bigint: true });
    assert.equal(destination.dev, source.dev);
    assert.equal(destination.ino, source.ino);
    await session.close();
  });

  it("atomically consumes a complete private directory tree in one final rename", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-safe-fs-publish-directory-"));
    await chmod(root, 0o700);
    const sourcePath = path.join(root, "package.stage");
    const destinationPath = path.join(root, "package");
    await mkdir(path.join(sourcePath, "nested"), {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(path.join(sourcePath, "manifest.json"), "manifest", {
      flag: "wx",
      mode: 0o600,
    });
    await writeFile(path.join(sourcePath, "nested", "payload"), "payload", {
      flag: "wx",
      mode: 0o600,
    });
    const source = await lstat(sourcePath, { bigint: true });
    const session = await openOpenClawSafeFsSession({
      rootPath: root,
      helperPath,
      receiptPath,
      receiptDigest,
    });

    const published = await session.publishNoReplace(
      "package.stage",
      "package",
      {
        device: source.dev.toString(),
        inode: source.ino.toString(),
        type: "directory",
      },
    );

    assert.equal(published.disposition, "published");
    assert.equal(published.device, source.dev.toString());
    assert.equal(published.inode, source.ino.toString());
    assert.equal(published.type, "directory");
    await assert.rejects(() => access(sourcePath));
    assert.equal(await readFile(path.join(destinationPath, "manifest.json"), "utf8"), "manifest");
    assert.equal(await readFile(path.join(destinationPath, "nested", "payload"), "utf8"), "payload");
    const destination = await lstat(destinationPath, { bigint: true });
    assert.equal(destination.dev, source.dev);
    assert.equal(destination.ino, source.ino);
    await session.close();
  });

  it("leaves one exact final identity when the helper is killed after rename visibility", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-safe-fs-publish-crash-"));
    await chmod(root, 0o700);
    const sourcePath = path.join(root, "crash.stage");
    const destinationPath = path.join(root, "crash.json");
    await writeFile(sourcePath, "complete-before-crash", {
      flag: "wx",
      mode: 0o600,
    });
    const rootIdentity = await lstat(root, { bigint: true });
    const source = await lstat(sourcePath, { bigint: true });
    const child = spawn(helperPath, [], {
      env: {
        PATH: "/usr/bin:/bin",
        LC_ALL: "C",
        LANG: "C",
      },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    const responses = [];
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      while (stdout.includes("\n")) {
        const index = stdout.indexOf("\n");
        responses.push(JSON.parse(stdout.slice(0, index)));
        stdout = stdout.slice(index + 1);
      }
    });
    child.stdin.write(`${JSON.stringify({
      operation: "open",
      rootPath: root,
      device: rootIdentity.dev.toString(),
      inode: rootIdentity.ino.toString(),
    })}\n`);
    const started = Date.now();
    while (responses.length < 1 && Date.now() - started < 5_000) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(responses[0]?.disposition, "opened");
    child.stdin.write(`${JSON.stringify({
      operation: "publish-no-replace",
      sourcePath: "crash.stage",
      destinationPath: "crash.json",
      sourceDevice: source.dev.toString(),
      sourceInode: source.ino.toString(),
      sourceType: "file",
    })}\n`);
    const publicationStarted = Date.now();
    while (Date.now() - publicationStarted < 5_000) {
      try {
        await access(destinationPath);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
    await access(destinationPath);
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("close", resolve));

    await assert.rejects(() => access(sourcePath));
    const destination = await lstat(destinationPath, { bigint: true });
    assert.equal(destination.dev, source.dev);
    assert.equal(destination.ino, source.ino);
    assert.equal(await readFile(destinationPath, "utf8"), "complete-before-crash");
  });

  it("preserves both identities when no-replace publication loses the destination race", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-safe-fs-publish-collision-"));
    await chmod(root, 0o700);
    const sourcePath = path.join(root, "candidate.stage");
    const destinationPath = path.join(root, "candidate.json");
    await writeFile(sourcePath, "private-candidate", {
      flag: "wx",
      mode: 0o600,
    });
    await writeFile(destinationPath, "public-winner", {
      flag: "wx",
      mode: 0o600,
    });
    const sourceBefore = await lstat(sourcePath, { bigint: true });
    const destinationBefore = await lstat(destinationPath, { bigint: true });
    const session = await openOpenClawSafeFsSession({
      rootPath: root,
      helperPath,
      receiptPath,
      receiptDigest,
    });

    const result = await session.publishNoReplace(
      "candidate.stage",
      "candidate.json",
      {
        device: sourceBefore.dev.toString(),
        inode: sourceBefore.ino.toString(),
        type: "file",
      },
    );

    assert.equal(result.disposition, "preserved");
    assert.equal(result.reason, "destination-exists");
    const sourceAfter = await lstat(sourcePath, { bigint: true });
    const destinationAfter = await lstat(destinationPath, { bigint: true });
    assert.equal(sourceAfter.dev, sourceBefore.dev);
    assert.equal(sourceAfter.ino, sourceBefore.ino);
    assert.equal(destinationAfter.dev, destinationBefore.dev);
    assert.equal(destinationAfter.ino, destinationBefore.ino);
    assert.equal(await readFile(sourcePath, "utf8"), "private-candidate");
    assert.equal(await readFile(destinationPath, "utf8"), "public-winner");
    await session.close();
  });

  it("reserves the final nonce marker atomically and keeps an exact durable winner", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-safe-fs-reservation-"));
    await chmod(root, 0o700);
    await mkdir(path.join(root, "ordinary"), { mode: 0o700 });
    const firstSession = await openOpenClawSafeFsSession({
      rootPath: root,
      helperPath,
      receiptPath,
      receiptDigest,
    });
    const secondSession = await openOpenClawSafeFsSession({
      rootPath: root,
      helperPath,
      receiptPath,
      receiptDigest,
    });
    const markerBytes = Buffer.from("{\"closed\":true}\n");
    const results = await Promise.all([
      firstSession.reserveMarker(
        "ordinary/nonce.json",
        markerBytes,
      ),
      secondSession.reserveMarker(
        "ordinary/nonce.json",
        markerBytes,
      ),
    ]);
    assert.deepEqual(
      results.map(({ disposition }) => disposition).sort(),
      ["created", "preserved"],
    );
    assert.equal(await readFile(
      path.join(root, "ordinary", "nonce.json"),
      "utf8",
    ), markerBytes.toString("utf8"));
    const observed = await firstSession.observe("ordinary/nonce.json");
    assert.equal(observed.mode, "600");
    assert.equal(observed.uid, String(process.getuid()));
    assert.equal(observed.digest, sha256(markerBytes));
    await Promise.all([firstSession.close(), secondSession.close()]);
  });

  it("keeps a zero-byte final nonce marker after crash-before-write and rejects reuse", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-safe-fs-reservation-crash-"));
    await chmod(root, 0o700);
    await mkdir(path.join(root, "sensitive"), { mode: 0o700 });
    const child = spawn(helperPath, [], {
      env: {
        PATH: "/usr/bin:/bin",
        LC_ALL: "C",
        LANG: "C",
      },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    const responses = [];
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      while (stdout.includes("\n")) {
        const index = stdout.indexOf("\n");
        responses.push(JSON.parse(stdout.slice(0, index)));
        stdout = stdout.slice(index + 1);
      }
    });
    const waitForResponses = async (count) => {
      const started = Date.now();
      while (responses.length < count && Date.now() - started < 5_000) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      assert.equal(responses.length >= count, true);
    };
    child.stdin.write(`${JSON.stringify({
      operation: "open",
      rootPath: root,
      device: (await lstat(root, { bigint: true })).dev.toString(),
      inode: (await lstat(root, { bigint: true })).ino.toString(),
    })}\n`);
    await waitForResponses(1);
    child.stdin.write(`${JSON.stringify({
      operation: "reserve-marker",
      path: "sensitive/crashed.json",
    })}\n`);
    await waitForResponses(2);
    assert.equal(responses[1].disposition, "reserved");
    const markerPath = path.join(root, "sensitive", "crashed.json");
    assert.equal((await lstat(markerPath)).size, 0);
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("close", resolve));

    const session = await openOpenClawSafeFsSession({
      rootPath: root,
      helperPath,
      receiptPath,
      receiptDigest,
    });
    const replay = await session.reserveMarker(
      "sensitive/crashed.json",
      Buffer.from("{\"closed\":true}\n"),
    );
    assert.equal(replay.disposition, "preserved");
    const observed = await session.observe("sensitive/crashed.json");
    assert.equal(observed.size, "0");
    assert.equal(observed.mode, "600");
    await session.close();
  });

  it("rejects an exact replacement when the final pathname was replaced before the call", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-safe-fs-replace-final-"));
    await chmod(root, 0o700);
    const targetPath = path.join(root, "config.json");
    const retainedPath = path.join(root, "approved-config.json");
    await writeFile(targetPath, "{\"base\":true}\n", {
      flag: "wx",
      mode: 0o600,
    });
    const session = await openOpenClawSafeFsSession({
      rootPath: root,
      helperPath,
      receiptPath,
      receiptDigest,
    });
    const observation = await session.observe("config.json");
    await rename(targetPath, retainedPath);
    await writeFile(targetPath, "replacement-sentinel", {
      flag: "wx",
      mode: 0o600,
    });
    const replacement = await lstat(targetPath, { bigint: true });
    const desired = Buffer.from("{\"base\":false}\n");

    const result = await session.replaceExact(
      "config.json",
      desired,
      {
        ...exactReplacementBasis(observation),
        desiredDigest: sha256(desired),
      },
    );

    assert.equal(result.disposition, "preserved");
    assert.equal(result.reason, "file-identity-mismatch");
    assert.equal(await readFile(targetPath, "utf8"), "replacement-sentinel");
    assert.equal(await readFile(retainedPath, "utf8"), "{\"base\":true}\n");
    const after = await lstat(targetPath, { bigint: true });
    assert.equal(after.dev, replacement.dev);
    assert.equal(after.ino, replacement.ino);
    await session.close();
  });

  it("rejects an exact replacement when an ancestor name changed after session open", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-safe-fs-replace-ancestor-"));
    await chmod(root, 0o700);
    const managed = path.join(root, "managed");
    const retained = path.join(root, "managed-retained");
    await mkdir(managed, { mode: 0o700 });
    await writeFile(path.join(managed, "config.json"), "approved-base", {
      flag: "wx",
      mode: 0o600,
    });
    const session = await openOpenClawSafeFsSession({
      rootPath: root,
      helperPath,
      receiptPath,
      receiptDigest,
    });
    const observation = await session.observe("managed/config.json");
    await rename(managed, retained);
    await mkdir(managed, { mode: 0o700 });
    const sentinelPath = path.join(managed, "config.json");
    await writeFile(sentinelPath, "ancestor-replacement-sentinel", {
      flag: "wx",
      mode: 0o600,
    });
    const sentinel = await lstat(sentinelPath, { bigint: true });
    const desired = Buffer.from("desired-config");

    const result = await session.replaceExact(
      "managed/config.json",
      desired,
      {
        ...exactReplacementBasis(observation),
        desiredDigest: sha256(desired),
      },
    );

    assert.equal(result.disposition, "preserved");
    assert.equal(result.reason, "parent-identity-mismatch");
    assert.equal(await readFile(sentinelPath, "utf8"), "ancestor-replacement-sentinel");
    assert.equal(
      await readFile(path.join(retained, "config.json"), "utf8"),
      "approved-base",
    );
    const after = await lstat(sentinelPath, { bigint: true });
    assert.equal(after.dev, sentinel.dev);
    assert.equal(after.ino, sentinel.ino);
    await session.close();
  });

  it("rejects an exact replacement of a multiply-linked file before mutation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-safe-fs-replace-hardlink-"));
    await chmod(root, 0o700);
    const targetPath = path.join(root, "config.json");
    const sentinelPath = path.join(root, "sentinel.json");
    await writeFile(targetPath, "approved-base", {
      flag: "wx",
      mode: 0o600,
    });
    const session = await openOpenClawSafeFsSession({
      rootPath: root,
      helperPath,
      receiptPath,
      receiptDigest,
    });
    const observation = await session.observe("config.json");
    await link(targetPath, sentinelPath);
    const sentinel = await lstat(sentinelPath, { bigint: true });
    const desired = Buffer.from("desired-config");

    const result = await session.replaceExact(
      "config.json",
      desired,
      {
        ...exactReplacementBasis(observation),
        desiredDigest: sha256(desired),
      },
    );

    assert.equal(result.disposition, "preserved");
    assert.equal(result.reason, "unsafe-file-links");
    assert.equal(await readFile(targetPath, "utf8"), "approved-base");
    assert.equal(await readFile(sentinelPath, "utf8"), "approved-base");
    const after = await lstat(sentinelPath, { bigint: true });
    assert.equal(after.dev, sentinel.dev);
    assert.equal(after.ino, sentinel.ino);
    await session.close();
  });

  it("rejects a wrong expected base digest on the same inode with zero mutation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-safe-fs-replace-base-digest-"));
    await chmod(root, 0o700);
    const targetPath = path.join(root, "config.json");
    await writeFile(targetPath, "approved-base", {
      flag: "wx",
      mode: 0o600,
    });
    const session = await openOpenClawSafeFsSession({
      rootPath: root,
      helperPath,
      receiptPath,
      receiptDigest,
    });
    const observation = await session.observe("config.json");
    const before = await lstat(targetPath, { bigint: true });
    const desired = Buffer.from("desired-config");

    const result = await session.replaceExact(
      "config.json",
      desired,
      {
        ...exactReplacementBasis(observation),
        expectedBaseDigest: `sha256:${"0".repeat(64)}`,
        desiredDigest: sha256(desired),
      },
    );

    assert.equal(result.disposition, "preserved");
    assert.equal(result.reason, "base-digest-mismatch");
    assert.equal(await readFile(targetPath, "utf8"), "approved-base");
    const after = await lstat(targetPath, { bigint: true });
    assert.equal(after.dev, before.dev);
    assert.equal(after.ino, before.ino);
    await session.close();
  });

  it("rejects a desired digest mismatch before opening the approved file for write", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-safe-fs-replace-desired-digest-"));
    await chmod(root, 0o700);
    const targetPath = path.join(root, "config.json");
    await writeFile(targetPath, "approved-base", {
      flag: "wx",
      mode: 0o600,
    });
    const session = await openOpenClawSafeFsSession({
      rootPath: root,
      helperPath,
      receiptPath,
      receiptDigest,
    });
    const observation = await session.observe("config.json");
    const before = await lstat(targetPath, { bigint: true });
    const desired = Buffer.from("desired-config");

    const result = await session.replaceExact(
      "config.json",
      desired,
      {
        ...exactReplacementBasis(observation),
        desiredDigest: `sha256:${"f".repeat(64)}`,
      },
    );

    assert.equal(result.disposition, "preserved");
    assert.equal(result.reason, "desired-digest-mismatch");
    assert.equal(await readFile(targetPath, "utf8"), "approved-base");
    const after = await lstat(targetPath, { bigint: true });
    assert.equal(after.dev, before.dev);
    assert.equal(after.ino, before.ino);
    await session.close();
  });

  it("durably writes desired bytes through the exact retained inode", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-safe-fs-replace-success-"));
    await chmod(root, 0o700);
    const targetPath = path.join(root, "config.json");
    await writeFile(targetPath, "approved-base", {
      flag: "wx",
      mode: 0o600,
    });
    const session = await openOpenClawSafeFsSession({
      rootPath: root,
      helperPath,
      receiptPath,
      receiptDigest,
    });
    const observation = await session.observe("config.json");
    const before = await lstat(targetPath, { bigint: true });
    const desired = Buffer.from("{\"desired\":true}\n");

    const result = await session.replaceExact(
      "config.json",
      desired,
      {
        ...exactReplacementBasis(observation),
        desiredDigest: sha256(desired),
      },
    );

    assert.equal(result.disposition, "replaced");
    assert.equal(result.guarantee, "identity-bound-durable-write");
    assert.equal(result.digest, sha256(desired));
    assert.equal(await readFile(targetPath, "utf8"), desired.toString("utf8"));
    const after = await lstat(targetPath, { bigint: true });
    assert.equal(after.dev, before.dev);
    assert.equal(after.ino, before.ino);
    await session.close();
  });

  it("preserves a post-write name swap and never reopens the external sentinel", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-safe-fs-replace-post-swap-"));
    await chmod(root, 0o700);
    const targetPath = path.join(root, "config.json");
    const retainedPath = path.join(root, "written-approved-inode.json");
    const outside = await mkdtemp(path.join(tmpdir(), "agentmo-safe-fs-replace-post-outside-"));
    await chmod(outside, 0o700);
    const sentinelPath = path.join(outside, "sentinel.json");
    await writeFile(targetPath, "approved-base", {
      flag: "wx",
      mode: 0o600,
    });
    await writeFile(sentinelPath, "external-sentinel", {
      flag: "wx",
      mode: 0o600,
    });
    const target = await lstat(targetPath, { bigint: true });
    const parent = await lstat(root, { bigint: true });
    const sentinel = await lstat(sentinelPath, { bigint: true });
    const desired = Buffer.from("{\"desired\":true}\n");
    const instrumentedHelper = path.join(root, "openclaw-fs-kernel-test-hook");
    const compilation = await runProcess("/usr/bin/cc", [
      SOURCE_PATH,
      "-std=c11",
      "-O0",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-DAGENTMO_FS_TEST_POST_WRITE_STOP=1",
      "-o",
      instrumentedHelper,
    ], root);
    assert.equal(compilation.code, 0, compilation.stderr);
    let child;
    let childClosed;
    try {
      child = spawn(instrumentedHelper, [], {
        env: {
          PATH: "/usr/bin:/bin",
          LC_ALL: "C",
          LANG: "C",
        },
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      childClosed = new Promise((resolve) => child.once("close", resolve));
      const protocol = trackProtocolResponses(child);
      child.stdin.write(`${JSON.stringify({
        operation: "open",
        rootPath: root,
        device: parent.dev.toString(),
        inode: parent.ino.toString(),
      })}\n`);
      await protocol.waitForCount(1, "retained-root open response");
      assert.equal(protocol.responses[0].disposition, "opened");
      child.stdin.write(`${JSON.stringify({
        operation: "replace-exact",
        path: "config.json",
        contentBase64: desired.toString("base64"),
        parentDevice: parent.dev.toString(),
        parentInode: parent.ino.toString(),
        fileDevice: target.dev.toString(),
        fileInode: target.ino.toString(),
        fileMode: "600",
        fileOwner: String(process.getuid()),
        expectedBaseDigest: sha256(Buffer.from("approved-base")),
        desiredDigest: sha256(desired),
      })}\n`);
      await protocol.waitForCount(2, "durable retained-inode write hook");
      assert.equal(
        protocol.responses[1].disposition,
        "test-post-write-ready",
      );
      assert.equal(
        protocol.responses[1].writeState,
        "desired-bytes-durable-on-retained-inode",
      );
      assert.equal(await readFile(targetPath, "utf8"), desired.toString("utf8"));
      await rename(targetPath, retainedPath);
      await symlink(sentinelPath, targetPath);
      child.kill("SIGCONT");
      await protocol.waitForCount(3, "post-name-swap result");
      assert.equal(protocol.responses[2].disposition, "preserved");
      assert.equal(protocol.responses[2].reason, "post-write-name-ambiguous");
      assert.equal(protocol.responses[2].complete, false);
      assert.equal(
        protocol.responses[2].writeState,
        "desired-bytes-durable-on-retained-inode",
      );
      assert.equal(await readFile(retainedPath, "utf8"), desired.toString("utf8"));
      assert.equal(await readFile(sentinelPath, "utf8"), "external-sentinel");
      const sentinelAfter = await lstat(sentinelPath, { bigint: true });
      assert.equal(sentinelAfter.dev, sentinel.dev);
      assert.equal(sentinelAfter.ino, sentinel.ino);
      child.stdin.write(`${JSON.stringify({ operation: "close" })}\n`);
      await protocol.waitForCount(4, "protocol close response");
      await childClosed;
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await childClosed;
      }
    }
  });
});
