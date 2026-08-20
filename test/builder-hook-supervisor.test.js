import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const HOOK_PATH = new URL("../plugin/hooks/agentmo-hook.js", import.meta.url);
const BEHAVIOR_EVAL_PATH = new URL("../src/builder-behavior-eval.js", import.meta.url);
const PACKED_INSTALL_TEST_PATH = new URL("./builder-packed-install.test.js", import.meta.url);
const SIGNAL_CHILD_PATH = new URL("./helpers/hook-supervisor-signal-child.js", import.meta.url);
const SIGNAL_CHILD_SENTINEL = "--agentmo-hook-supervisor-signal-child";
const FUNCTION_SIGNATURE = "async function runAdjacentLauncher(inputBytes, paths) {";
const FUNCTION_END_MARKER = "\n}\n\nfunction admitBridgeResult";

function extractSupervisor(source) {
  const start = source.indexOf(FUNCTION_SIGNATURE);
  const end = source.indexOf(FUNCTION_END_MARKER, start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return source.slice(start, end + 2);
}

function declaredMilliseconds(source, constant) {
  const match = new RegExp(`const ${constant} = ([\\d_]+);`, "u").exec(source);
  assert.notEqual(match, null);
  return Number.parseInt(match[1].replaceAll("_", ""), 10);
}

function compileSupervisor(source, launcherUrl, launcherSource, options = {}) {
  const loaderSource = [
    `const launcherUrl = ${JSON.stringify(launcherUrl)};`,
    `const launcherSource = ${JSON.stringify(launcherSource)};`,
    "export async function resolve(specifier, context, nextResolve) {",
    "  if (specifier === launcherUrl) return { url: launcherUrl, shortCircuit: true };",
    "  return nextResolve(specifier, context);",
    "}",
    "export async function load(url, context, nextLoad) {",
    "  if (url === launcherUrl) {",
    '    return { format: "module", source: launcherSource, shortCircuit: true };',
    "  }",
    "  return nextLoad(url, context);",
    "}",
  ].join("\n");
  return Function(
    "spawn",
    "AUTHENTICATED_BOOTSTRAP_LOADER_SOURCE",
    "CHILD_TIMEOUT_MS",
    "CHILD_TIMEOUT_SETTLEMENT_GRACE_MS",
    "MAX_CHILD_OUTPUT_BYTES",
    "process",
    `return (${extractSupervisor(source)});`,
  )(
    options.spawn ?? spawn,
    loaderSource,
    options.childTimeoutMs ?? 200,
    options.timeoutSettlementGraceMs ?? 100,
    16 * 1024,
    options.process ?? process,
  );
}

function supervisorPaths(root, launcherUrl) {
  return {
    projectRoot: root,
    launcherPath: path.join(root, "virtual-launcher.js"),
    runnerDigest: `sha256:${"a".repeat(64)}`,
    graph: {
      bytes: Buffer.from("{}\n", "utf8"),
      digest: `sha256:${"b".repeat(64)}`,
      launcherUrl,
    },
  };
}

function fakeSupervisorChild(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdio = [child.stdin, child.stdout, child.stderr, new PassThrough(), new PassThrough()];
  child.unref = () => {};
  return child;
}

function controlledSupervisorProcess(child, onTerminate = () => {}) {
  const controlledProcess = new EventEmitter();
  controlledProcess.execPath = process.execPath;
  controlledProcess.pid = 9191;
  let groupPresent = true;
  const reraisedSignals = [];
  controlledProcess.kill = (target, signal) => {
    if (target === controlledProcess.pid) {
      reraisedSignals.push(signal);
      return true;
    }
    assert.equal(target, -child.pid);
    if (signal === 0) {
      if (groupPresent) return true;
      const error = new Error("group absent");
      error.code = "ESRCH";
      throw error;
    }
    assert.equal(signal, "SIGKILL");
    groupPresent = false;
    onTerminate();
    return true;
  };
  return {
    process: controlledProcess,
    reraisedSignals,
    markGroupExited() {
      groupPresent = false;
    },
  };
}

async function absent(file) {
  await assert.rejects(access(file), (error) => error?.code === "ENOENT");
}

function settleWithin(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out.`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function waitForPath(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(file);
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Expected marker did not appear.");
}

async function waitForGroupExit(groupId, timeoutMs, killProcess = process.kill, options = {}) {
  assert.ok(Number.isSafeInteger(groupId) && groupId < 0);
  const now = options.now ?? Date.now;
  const wait = options.wait ?? (() => new Promise((resolve) => setTimeout(resolve, 20)));
  const deadline = now() + timeoutMs;
  while (true) {
    try {
      killProcess(groupId, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return;
      if (error?.code !== "EPERM") throw error;
    }
    if (now() >= deadline) break;
    await wait();
  }
  throw new Error("Detached group remained alive.");
}

async function cleanupRealSignalFixture({
  wrapper,
  closed,
  ownership,
  killProcess,
  readGroupId = async () => null,
  wrapperGraceMs = 1_000,
  groupGraceMs = 3_000,
  closeGraceMs = 2_000,
}) {
  let wrapperClosed = wrapper.exitCode !== null || wrapper.signalCode !== null;
  if (!wrapperClosed) {
    wrapper.kill("SIGTERM");
    try {
      await settleWithin(closed, wrapperGraceMs, "wrapper graceful cleanup");
      wrapperClosed = true;
    } catch (error) {
      if (!/timed out/u.test(error.message)) throw error;
    }
  }

  if (!ownership.resolved && ownership.groupId === null) {
    ownership.groupId = await readGroupId();
  }
  if (ownership.groupId !== null) {
    try {
      await waitForGroupExit(ownership.groupId, groupGraceMs, killProcess);
    } catch (error) {
      if (!/remained alive/u.test(error.message)) throw error;
      killProcess(ownership.groupId, "SIGKILL");
      await waitForGroupExit(ownership.groupId, groupGraceMs, killProcess);
    }
    ownership.groupId = null;
    ownership.resolved = true;
  } else {
    ownership.resolved = true;
  }

  if (!wrapperClosed) {
    try {
      await settleWithin(closed, closeGraceMs, "wrapper cleanup");
    } catch (error) {
      if (!/timed out/u.test(error.message)) throw error;
      if (wrapper.exitCode === null && wrapper.signalCode === null) wrapper.kill("SIGKILL");
      await settleWithin(closed, closeGraceMs, "wrapper forced cleanup");
    }
  }
}

async function assertRealParentSignalCancellation(signal, options = {}) {
  const killProcess = options.killProcess ?? process.kill;
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-hook-parent-signal-"));
  const readyPath = path.join(root, "launcher-ready");
  const pidPath = path.join(root, "launcher-pid");
  const committedPath = path.join(root, "commit-before-cancel");
  const latePath = path.join(root, "late-effect");
  const wrapper = spawn(process.execPath, [
    fileURLToPath(SIGNAL_CHILD_PATH),
    SIGNAL_CHILD_SENTINEL,
    root,
  ], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  let wrapperError = null;
  const closed = new Promise((resolve) => {
    wrapper.once("error", (error) => {
      wrapperError = error;
    });
    wrapper.once("close", (code, observedSignal) => resolve({ code, signal: observedSignal }));
  });
  const ownership = { groupId: null, resolved: false };
  try {
    await settleWithin(waitForPath(readyPath, 5_000), 5_500, "launcher ready");
    const launcherPid = Number.parseInt(await readFile(pidPath, "utf8"), 10);
    assert.ok(Number.isSafeInteger(launcherPid) && launcherPid > 0);
    ownership.groupId = -launcherPid;
    options.onLauncherReady?.(launcherPid);
    assert.equal(await readFile(committedPath, "utf8"), "committed");
    assert.doesNotThrow(() => killProcess(-launcherPid, 0));
    killProcess(wrapper.pid, signal);
    const result = await settleWithin(closed, 5_000, "wrapper signal settlement");
    assert.deepEqual(result, { code: null, signal });
    await waitForGroupExit(ownership.groupId, 3_000, killProcess);
    const exitedGroupId = ownership.groupId;
    ownership.groupId = null;
    ownership.resolved = true;
    options.afterGroupExit?.(exitedGroupId);
    await new Promise((resolve) => setTimeout(resolve, 850));
    await absent(latePath);
    assert.equal(await readFile(committedPath, "utf8"), "committed");
  } finally {
    await cleanupRealSignalFixture({
      wrapper,
      closed,
      ownership,
      killProcess,
      async readGroupId() {
        try {
          const launcherPid = Number.parseInt(await readFile(pidPath, "utf8"), 10);
          return Number.isSafeInteger(launcherPid) && launcherPid > 0 ? -launcherPid : null;
        } catch (error) {
          if (error?.code === "ENOENT") return null;
          throw error;
        }
      },
    });
    await rm(root, { recursive: true, force: true });
  }
  if (wrapperError !== null) throw wrapperError;
}

describe("installed hook child supervisor", () => {
  it("requires ESRCH after transient detached-group EPERM observations", async () => {
    let now = 0;
    const wait = async () => { now += 1; };
    const transientCodes = ["EPERM", "EPERM", "ESRCH"];
    await waitForGroupExit(-4242, 3, () => {
      const error = new Error("synthetic group probe");
      error.code = transientCodes.shift();
      throw error;
    }, { now: () => now, wait });
    assert.deepEqual(transientCodes, []);

    now = 0;
    let probes = 0;
    await assert.rejects(
      waitForGroupExit(-4243, 2, () => {
        probes += 1;
        const error = new Error("synthetic group probe");
        error.code = "EPERM";
        throw error;
      }, { now: () => now, wait }),
      /Detached group remained alive/u,
    );
    assert.equal(probes, 3);
  });

  it("cleans a timed-out real-signal fixture by negative PGID without retired PID signals", async () => {
    const launcherPid = 4242;
    const ownership = { groupId: -launcherPid, resolved: false };
    const signalCalls = [];
    let groupPresent = true;
    const wrapper = new EventEmitter();
    wrapper.pid = 9191;
    wrapper.exitCode = null;
    wrapper.signalCode = null;
    const closed = new Promise((resolve) => wrapper.once("close", resolve));
    wrapper.kill = (signal) => {
      signalCalls.push(["wrapper", signal]);
      return true;
    };
    const killProcess = (target, signal) => {
      signalCalls.push([target, signal]);
      if (target === -launcherPid && signal === "SIGKILL") {
        groupPresent = false;
        wrapper.signalCode = "SIGTERM";
        queueMicrotask(() => wrapper.emit("close", null, "SIGTERM"));
        return true;
      }
      if (target === -launcherPid && signal === 0) {
        if (groupPresent) return true;
        const error = new Error("group absent");
        error.code = "ESRCH";
        throw error;
      }
      return true;
    };

    await cleanupRealSignalFixture({
      wrapper,
      closed,
      ownership,
      killProcess,
      wrapperGraceMs: 1,
      groupGraceMs: 0,
      closeGraceMs: 50,
    });
    assert.equal(groupPresent, false);
    assert.equal(ownership.groupId, null);
    assert.equal(ownership.resolved, true);
    assert.deepEqual(signalCalls, [
      ["wrapper", "SIGTERM"],
      [-launcherPid, 0],
      [-launcherPid, "SIGKILL"],
      [-launcherPid, 0],
    ]);
    assert.equal(signalCalls.some(([target]) => target === launcherPid), false);
  });

  it("keeps the signal helper inert without its test-only sentinel", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-hook-signal-helper-inert-"));
    const child = spawn(process.execPath, [fileURLToPath(SIGNAL_CHILD_PATH)], {
      cwd: root,
      stdio: ["ignore", "ignore", "ignore"],
    });
    const closed = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    try {
      assert.deepEqual(
        await settleWithin(closed, 2_000, "standalone signal helper settlement"),
        { code: 0, signal: null },
      );
      assert.deepEqual(await readdir(root), []);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await settleWithin(closed.catch(() => {}), 2_000, "standalone signal helper cleanup");
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps bounded outer margins and splits authenticated success from fast rejection", async () => {
    const [hookSource, behaviorSource, packedInstallTestSource] = await Promise.all([
      readFile(HOOK_PATH, "utf8"),
      readFile(BEHAVIOR_EVAL_PATH, "utf8"),
      readFile(PACKED_INSTALL_TEST_PATH, "utf8"),
    ]);
    const childTimeoutMs = declaredMilliseconds(hookSource, "CHILD_TIMEOUT_MS");
    const settlementGraceMs = declaredMilliseconds(
      hookSource,
      "CHILD_TIMEOUT_SETTLEMENT_GRACE_MS",
    );
    const outerTimeoutMs = declaredMilliseconds(behaviorSource, "AUTHENTIC_HOOK_TIMEOUT_MS");
    const packedOuterTimeoutMs = declaredMilliseconds(
      packedInstallTestSource,
      "PACKED_AUTHENTIC_HOOK_TIMEOUT_MS",
    );

    assert.equal(childTimeoutMs, 60_000);
    assert.equal(settlementGraceMs, 1_000);
    assert.equal(outerTimeoutMs - childTimeoutMs - settlementGraceMs, 29_000);
    assert.equal(packedOuterTimeoutMs - childTimeoutMs - settlementGraceMs, 29_000);
    assert.match(packedInstallTestSource, /const authenticatedSuccessChildOptions =/u);
    assert.match(packedInstallTestSource, /const fastRejectionChildOptions =/u);
  });

  it("cancels the detached launcher group on parent termination without leaking listeners", {
    timeout: 5_000,
  }, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-hook-supervisor-cancel-"));
    const marker = path.join(root, "late-marker");
    const launcherPath = path.join(root, "virtual-launcher.js");
    await writeFile(launcherPath, "", { flag: "wx", mode: 0o600 });
    const launcherUrl = pathToFileURL(launcherPath).href;
    const source = await readFile(HOOK_PATH, "utf8");
    let groupTerminated = false;
    const markerTimer = setTimeout(() => {
      void writeFile(marker, "late", { flag: "wx", mode: 0o600 });
    }, 150);
    const child = fakeSupervisorChild(4242);
    const controlled = controlledSupervisorProcess(child, () => {
      groupTerminated = true;
      clearTimeout(markerTimer);
    });
    const controlledProcess = controlled.process;
    const run = compileSupervisor(source, launcherUrl, "", {
      childTimeoutMs: 1_000,
      timeoutSettlementGraceMs: 50,
      process: controlledProcess,
      spawn: () => child,
    });
    const outcome = run(Buffer.alloc(0), supervisorPaths(root, launcherUrl)).then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error }),
    );

    assert.equal(controlledProcess.listenerCount("SIGTERM"), 1);
    assert.equal(controlledProcess.listenerCount("SIGINT"), 1);
    controlledProcess.emit("SIGTERM");
    const cancelled = await outcome;
    assert.equal(cancelled.ok, false);
    assert.match(cancelled.error.message, /Installed hook launcher rejected/u);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await absent(marker);
    assert.equal(groupTerminated, true);
    assert.equal(child.stdin.destroyed, true);
    assert.equal(child.stdout.destroyed, true);
    assert.equal(child.stderr.destroyed, true);
    assert.equal(controlledProcess.listenerCount("SIGTERM"), 0);
    assert.equal(controlledProcess.listenerCount("SIGINT"), 0);
    assert.deepEqual(controlled.reraisedSignals, ["SIGTERM"]);

    const preSpawnChild = fakeSupervisorChild(4250);
    const preSpawnControlled = controlledSupervisorProcess(preSpawnChild);
    const preSpawnRun = compileSupervisor(source, launcherUrl, "", {
      childTimeoutMs: 100,
      timeoutSettlementGraceMs: 25,
      process: preSpawnControlled.process,
      spawn: () => {
        preSpawnControlled.process.emit("SIGINT");
        return preSpawnChild;
      },
    });
    const preSpawnOutcome = preSpawnRun(
      Buffer.alloc(0),
      supervisorPaths(root, launcherUrl),
    ).then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error }),
    );
    const preSpawnCancelled = await settleWithin(preSpawnOutcome, 500, "pre-spawn cancellation");
    assert.equal(preSpawnCancelled.ok, false);
    assert.deepEqual(preSpawnControlled.reraisedSignals, ["SIGINT"]);
    assert.equal(preSpawnControlled.process.listenerCount("SIGTERM"), 0);
    assert.equal(preSpawnControlled.process.listenerCount("SIGINT"), 0);

    for (const settlement of ["success", "nonzero-exit", "timeout"]) {
      const settlementChild = fakeSupervisorChild(4300 + settlement.length);
      const settlementProcess = controlledSupervisorProcess(settlementChild);
      const settleRun = compileSupervisor(source, launcherUrl, "", {
        childTimeoutMs: 20,
        timeoutSettlementGraceMs: 10,
        process: settlementProcess.process,
        spawn: () => settlementChild,
      });
      const settlementOutcome = settleRun(
        Buffer.alloc(0),
        supervisorPaths(root, launcherUrl),
      ).then(
        (value) => ({ ok: true, value }),
        (error) => ({ ok: false, error }),
      );
      assert.equal(settlementProcess.process.listenerCount("SIGTERM"), 1);
      assert.equal(settlementProcess.process.listenerCount("SIGINT"), 1);
      if (settlement === "success") {
        settlementProcess.markGroupExited();
        settlementChild.emit("exit", 0, null);
        settlementChild.emit("close", 0, null);
      } else if (settlement === "nonzero-exit") {
        settlementChild.emit("exit", 1, null);
        settlementChild.emit("close", 1, null);
      }
      const settled = await settlementOutcome;
      assert.equal(settled.ok, settlement === "success");
      assert.equal(settlementProcess.process.listenerCount("SIGTERM"), 0);
      assert.equal(settlementProcess.process.listenerCount("SIGINT"), 0);
    }
  });

  for (const signal of ["SIGTERM", "SIGINT"]) {
    it(`preserves ${signal} while killing the real detached launcher group before a late effect`, {
      timeout: 15_000,
    }, async () => {
      if (signal === "SIGTERM") {
        let launcherPid = null;
        let exitedGroupId = null;
        const killProcess = (target, observedSignal) => {
          if (target === launcherPid) {
            throw new Error("Launcher PID was used instead of its detached process group.");
          }
          if (target === exitedGroupId) {
            throw new Error("Retired launcher process group was reused during cleanup.");
          }
          return process.kill(target, observedSignal);
        };
        await assertRealParentSignalCancellation(signal, {
          killProcess,
          onLauncherReady(pid) {
            launcherPid = pid;
          },
          afterGroupExit(groupId) {
            exitedGroupId = groupId;
          },
        });
        return;
      }
      await assertRealParentSignalCancellation(signal);
    });
  }

  it("rejects and kills a same-group ignored-stdio descendant before a late marker", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-hook-supervisor-group-"));
    const marker = path.join(root, "late-marker");
    const launcherPath = path.join(root, "virtual-launcher.js");
    await writeFile(launcherPath, "", { flag: "wx", mode: 0o600 });
    const launcherUrl = pathToFileURL(launcherPath).href;
    const descendantSource = [
      'const fs = require("node:fs");',
      `setTimeout(() => fs.writeFileSync(${JSON.stringify(marker)}, "late"), 700);`,
    ].join("\n");
    const launcherSource = [
      'import { spawn } from "node:child_process";',
      `const descendant = spawn(process.execPath, ["--eval", ${JSON.stringify(descendantSource)}], {`,
      '  detached: false, stdio: "ignore",',
      "});",
      "descendant.unref();",
      "process.exit(0);",
    ].join("\n");
    const source = await readFile(HOOK_PATH, "utf8");
    const run = compileSupervisor(source, launcherUrl, launcherSource);

    await assert.rejects(
      run(Buffer.alloc(0), supervisorPaths(root, launcherUrl)),
      /Installed hook launcher rejected/u,
    );
    await new Promise((resolve) => setTimeout(resolve, 850));
    await absent(marker);
  });

  it("settles at the timeout when an escaped descendant holds stdout open", {
    timeout: 5_000,
  }, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-hook-supervisor-escape-"));
    const pidPath = path.join(root, "escaped-pid");
    const pendingPidPath = path.join(root, "pending-escaped-pid");
    const ownerPidPath = path.join(root, "escaped-owner-pid");
    const releasePath = path.join(root, "release-escaped-pid");
    const launcherPath = path.join(root, "virtual-launcher.js");
    await writeFile(launcherPath, "", { flag: "wx", mode: 0o600 });
    const launcherUrl = pathToFileURL(launcherPath).href;
    const descendantSource = [
      'const fs = require("node:fs");',
      `const releasePath = ${JSON.stringify(releasePath)};`,
      `const pendingPidPath = ${JSON.stringify(pendingPidPath)};`,
      `const pidPath = ${JSON.stringify(pidPath)};`,
      "const publish = () => {",
      "  if (!fs.existsSync(releasePath)) return;",
      "  fs.writeFileSync(pendingPidPath, String(process.pid));",
      "  fs.renameSync(pendingPidPath, pidPath);",
      "  clearInterval(waitForRelease);",
      "};",
      "const waitForRelease = setInterval(publish, 10);",
      "setTimeout(() => {}, 10_000);",
    ].join("\n");
    const launcherSource = [
      'import { spawn } from "node:child_process";',
      'import { writeFileSync } from "node:fs";',
      `const descendant = spawn(process.execPath, ["--eval", ${JSON.stringify(descendantSource)}], {`,
      '  detached: true, stdio: ["ignore", "inherit", "inherit"],',
      "});",
      "await new Promise((resolve, reject) => {",
      '  descendant.once("spawn", resolve);',
      '  descendant.once("error", reject);',
      "});",
      `writeFileSync(${JSON.stringify(ownerPidPath)}, String(descendant.pid));`,
      "descendant.unref();",
      "await new Promise((resolve) => setTimeout(resolve, 100));",
      "process.exit(0);",
    ].join("\n");
    const source = await readFile(HOOK_PATH, "utf8");
    const run = compileSupervisor(source, launcherUrl, launcherSource);
    const started = Date.now();
    let escapedPid = null;
    try {
      await assert.rejects(
        run(Buffer.alloc(0), supervisorPaths(root, launcherUrl)),
        /Installed hook launcher rejected/u,
      );
      assert.ok(Date.now() - started < 2_000);

      await writeFile(releasePath, "release", { flag: "wx", mode: 0o600 });
      await settleWithin(waitForPath(pidPath, 1_000), 1_500, "escaped descendant pid marker");
      escapedPid = Number.parseInt(await readFile(pidPath, "utf8"), 10);
      assert.ok(Number.isSafeInteger(escapedPid) && escapedPid > 0);
    } finally {
      try {
        let cleanupPid = escapedPid;
        if (!Number.isSafeInteger(cleanupPid) || cleanupPid <= 0) {
          await settleWithin(waitForPath(ownerPidPath, 1_000), 1_500, "escaped descendant owner pid marker");
          cleanupPid = Number.parseInt(await readFile(ownerPidPath, "utf8"), 10);
        }
        assert.ok(Number.isSafeInteger(cleanupPid) && cleanupPid > 0, "escaped descendant owner pid unavailable for cleanup");
        try {
          process.kill(-cleanupPid, "SIGKILL");
        } catch (error) {
          if (error?.code !== "ESRCH") throw error;
        }
        await waitForGroupExit(-cleanupPid, 2_000);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  it("settles fail-closed after deadline grace when the direct child remains alive", {
    timeout: 5_000,
  }, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-hook-supervisor-stuck-"));
    const launcherPath = path.join(root, "virtual-launcher.js");
    await writeFile(launcherPath, "", { flag: "wx", mode: 0o600 });
    const launcherUrl = pathToFileURL(launcherPath).href;
    const launcherSource = [
      "setInterval(() => {}, 1_000);",
    ].join("\n");
    const source = await readFile(HOOK_PATH, "utf8");
    let directPid = null;
    const run = compileSupervisor(source, launcherUrl, launcherSource, {
      childTimeoutMs: 100,
      timeoutSettlementGraceMs: 100,
      spawn(...args) {
        const child = spawn(...args);
        directPid = child.pid;
        return child;
      },
    });
    const nativeKill = process.kill;
    process.kill = (target, signal) => {
      if (typeof target === "number" && target < 0) {
        const error = new Error("test blocks process-group termination");
        error.code = "EPERM";
        throw error;
      }
      return nativeKill(target, signal);
    };
    const started = Date.now();
    try {
      await assert.rejects(
        run(Buffer.alloc(0), supervisorPaths(root, launcherUrl)),
        /Installed hook launcher rejected/u,
      );
      const elapsedMs = Date.now() - started;
      assert.ok(elapsedMs >= 150, "settled before its post-deadline grace");
      assert.ok(elapsedMs < 2_000, "stuck direct child exceeded bounded grace");
      assert.ok(Number.isSafeInteger(directPid) && directPid > 0);
      assert.doesNotThrow(() => nativeKill(directPid, 0));
    } finally {
      process.kill = nativeKill;
      if (Number.isSafeInteger(directPid) && directPid > 0) {
        try {
          nativeKill(-directPid, "SIGKILL");
        } catch (error) {
          if (error?.code !== "ESRCH") throw error;
        }
      }
    }
  });
});
