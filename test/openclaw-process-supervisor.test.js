import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { access, chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { it } from "node:test";
import { promisify } from "node:util";
import {
  prepareOpenClawProcessSupervisor,
} from "../src/openclaw-process-supervisor.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const execFileAsync = promisify(execFile);
const SUPERVISOR_SOURCE = path.join(
  ROOT,
  "native/openclaw-process-supervisor.c",
);

async function compileSupervisor(root, definitions = []) {
  const binary = path.join(root, "supervisor");
  await execFileAsync("/usr/bin/cc", [
    SUPERVISOR_SOURCE,
    "-std=c11",
    "-O2",
    "-Wall",
    "-Wextra",
    "-Werror",
    ...definitions.map((definition) => `-D${definition}`),
    "-o",
    binary,
  ]);
  await chmod(binary, 0o700);
  return binary;
}

async function runSupervisorRaw(binary, script, marker) {
  const child = spawn(binary, [
    "--timeout-ms",
    "2000",
    "--",
    process.execPath,
    script,
    marker,
  ], {
    shell: false,
    stdio: ["ignore", "ignore", "ignore", "ignore", "pipe"],
  });
  const protocol = [];
  child.stdio[4].on("data", (chunk) => protocol.push(chunk));
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  return { code, protocol: Buffer.concat(protocol).toString("utf8") };
}

async function runSupervisor(binary, script, marker) {
  const result = await runSupervisorRaw(binary, script, marker);
  assert.equal(result.code, 0);
  return JSON.parse(result.protocol);
}

it("supervisor source inventory closes the Linux descendant-containment primitives", async () => {
  const [nativeSource, runnerSource] = await Promise.all([
    readFile(path.join(ROOT, "native/openclaw-process-supervisor.c"), "utf8"),
    readFile(path.join(ROOT, "src/openclaw-official-action-runner.js"), "utf8"),
  ]);
  for (const required of [
    "PR_SET_CHILD_SUBREAPER",
    "PR_SET_DUMPABLE",
    "PR_SET_NO_NEW_PRIVS",
    "PR_SET_SECCOMP",
    "SECCOMP_RET_ERRNO",
    "__NR_setsid",
    "__NR_setpgid",
    "__NR_kill",
    "__NR_tkill",
    "__NR_tgkill",
    "__NR_rt_sigqueueinfo",
    "__NR_rt_tgsigqueueinfo",
    "__NR_pidfd_send_signal",
    "__NR_ptrace",
    "__X32_SYSCALL_BIT",
    "AGENTMO_TEST_PIDFD_FAIL_AFTER",
    "AGENTMO_TEST_CLOCK_FAIL_AFTER",
    "AGENTMO_MAX_TRACKED",
    "SYS_pidfd_open",
    "SYS_pidfd_send_signal",
    "waitid(",
    "WNOWAIT",
    "/proc/%ld/task/%ld/children",
    "EMPTY_POLLS_REQUIRED",
    "compact_tracked",
    "bootstrap_ready",
    "bootstrap_go",
    "SIGKILL",
  ]) {
    assert.equal(nativeSource.includes(required), true, required);
  }
  assert.match(
    nativeSource,
    /if \(setpgid\(0, 0\) != 0 \|\| !install_process_group_lock\(\)\) _exit\(126\);[\s\S]+write_control_byte\(bootstrap_ready\[1\], 'R'\)[\s\S]+read_control_byte\(bootstrap_go\[0\], 'G'\)[\s\S]+execv/u,
  );
  assert.match(
    nativeSource,
    /refresh_pidfds\(tracked, tracked_count\);\s+compact_tracked\(tracked, &tracked_count\);\s+size_t visible_count/u,
  );
  assert.match(
    runnerSource,
    /prepareOpenClawProcessSupervisor/u,
  );
  assert.match(runnerSource, /AUTHENTIC_PROCESS_RESULTS = new WeakMap/u);
  assert.doesNotMatch(runnerSource, /unlink\(candidatePath/u);
  assert.doesNotMatch(runnerSource, /rm\(candidate/u);
});

it("supervisor preparation is fail-closed before build outside Linux", {
  skip: process.platform === "linux",
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-supervisor-unsupported-"));
  await chmod(root, 0o700);
  await assert.rejects(
    () => prepareOpenClawProcessSupervisor({ privateRoot: root }),
    (error) => (
      error?.code === "AGENTMO_OPENCLAW_PROCESS_SUPERVISOR_UNSUPPORTED"
    ),
  );
});

it("Linux supervisor build rejects deterministic compiler-output substitution", {
  skip: process.platform !== "linux",
  timeout: 20_000,
}, async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "agentmo-supervisor-output-substitution-"),
  );
  await chmod(root, 0o700);
  process.env.AGENTMO_TEST_NATIVE_BUILD_OUTPUT_SUBSTITUTION = "1";
  try {
    await assert.rejects(
      () => prepareOpenClawProcessSupervisor({ privateRoot: root }),
      (error) => (
        error?.code === "AGENTMO_OPENCLAW_PROCESS_SUPERVISOR_REJECTED"
      ),
    );
  } finally {
    delete process.env.AGENTMO_TEST_NATIVE_BUILD_OUTPUT_SUBSTITUTION;
  }
});

it("Linux supervisor recycles terminal pidfds before the bounded capacity is reused", {
  skip: process.platform !== "linux",
  timeout: 20_000,
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-supervisor-recycle-"));
  const binary = await compileSupervisor(root, ["AGENTMO_MAX_TRACKED=4"]);
  const script = path.join(root, "recycle.cjs");
  const marker = path.join(root, "late-marker.txt");
  await writeFile(script, [
    "const { spawn } = require('node:child_process');",
    "const marker = process.argv[2];",
    "const run = (source, args = []) => new Promise((resolve, reject) => {",
    "  const child = spawn(process.execPath, ['-e', source, ...args], { stdio: 'ignore' });",
    "  child.once('error', reject); child.once('close', resolve);",
    "});",
    "(async () => {",
    "  for (let index = 0; index < 12; index += 1) await run('setTimeout(() => {}, 40)');",
    "  const descendant = spawn(process.execPath, ['-e', \"setTimeout(() => require('node:fs').writeFileSync(process.argv[1], 'late'), 400); setInterval(() => {}, 1000)\", marker], { stdio: 'ignore' });",
    "  descendant.unref();",
    "})().catch(() => process.exit(91));",
  ].join("\n"));

  const result = await runSupervisor(binary, script, marker);
  await wait(500);
  assert.equal(result.failureCode, "descendant-outlived-parent");
  assert.equal(result.processGroupClosed, true);
  assert.equal(result.quiescenceVerified, true);
  await assert.rejects(() => access(marker));
});

it("Linux supervisor group lock contains simultaneous capacity overflow", {
  skip: process.platform !== "linux",
  timeout: 20_000,
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-supervisor-capacity-"));
  const binary = await compileSupervisor(root, ["AGENTMO_MAX_TRACKED=2"]);
  const script = path.join(root, "capacity.cjs");
  const marker = path.join(root, "late-marker.txt");
  await writeFile(script, [
    "const { spawn } = require('node:child_process');",
    "const payload = \"setTimeout(() => require('node:fs').appendFileSync(process.argv[1], 'late'), 400); setInterval(() => {}, 1000)\";",
    "spawn(process.execPath, ['-e', payload, process.argv[2]], { stdio: 'ignore' });",
    "spawn(process.execPath, ['-e', payload, process.argv[2]], { stdio: 'ignore' });",
    "setInterval(() => {}, 1000);",
  ].join("\n"));

  const result = await runSupervisor(binary, script, marker);
  await wait(500);
  assert.equal(result.failureCode, "containment-proof-failed");
  assert.equal(result.processGroupClosed, true);
  assert.equal(result.quiescenceVerified, true);
  await assert.rejects(() => access(marker));
});

it("Linux supervisor group lock contains descendants after forced pidfd admission failure", {
  skip: process.platform !== "linux",
  timeout: 20_000,
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-supervisor-pidfd-"));
  const binary = await compileSupervisor(root, [
    "AGENTMO_MAX_TRACKED=4",
    "AGENTMO_TEST_PIDFD_FAIL_AFTER=1",
  ]);
  const script = path.join(root, "pidfd.cjs");
  const marker = path.join(root, "late-marker.txt");
  await writeFile(script, [
    "const { spawn } = require('node:child_process');",
    "const payload = \"setTimeout(() => require('node:fs').writeFileSync(process.argv[1], 'late'), 400); setInterval(() => {}, 1000)\";",
    "spawn(process.execPath, ['-e', payload, process.argv[2]], { stdio: 'ignore' });",
    "setInterval(() => {}, 1000);",
  ].join("\n"));

  const result = await runSupervisor(binary, script, marker);
  await wait(500);
  assert.equal(result.failureCode, "containment-proof-failed");
  assert.equal(result.processGroupClosed, true);
  assert.equal(result.quiescenceVerified, true);
  await assert.rejects(() => access(marker));
});

it("Linux supervisor denies a supervised command authority to kill its parent", {
  skip: process.platform !== "linux",
  timeout: 20_000,
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-supervisor-signal-"));
  const binary = await compileSupervisor(root);
  const script = path.join(root, "signal.cjs");
  const marker = path.join(root, "late-marker.txt");
  const pidFile = path.join(root, "target.pid");
  await writeFile(script, [
    "const fs = require('node:fs');",
    `fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
    "try { process.kill(process.ppid, 'SIGKILL'); } catch (error) {",
    "  if (error?.code === 'EPERM') process.exit(0);",
    "  throw error;",
    "}",
    "setTimeout(() => fs.writeFileSync(process.argv[2], 'late'), 400);",
    "setInterval(() => {}, 1000);",
  ].join("\n"));

  let targetPid = null;
  try {
    const result = await runSupervisor(binary, script, marker);
    assert.equal(result.exitCode, 0);
    assert.equal(result.processGroupClosed, true);
    assert.equal(result.quiescenceVerified, true);
    await wait(500);
    await assert.rejects(() => access(marker));
  } finally {
    try {
      targetPid = Number(await readFile(pidFile, "utf8"));
    } catch {
      targetPid = null;
    }
    if (Number.isSafeInteger(targetPid) && targetPid > 0) {
      try {
        process.kill(targetPid, "SIGKILL");
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    }
  }
});

it("Linux supervisor never execs the target when direct pidfd admission fails", {
  skip: process.platform !== "linux",
  timeout: 20_000,
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-supervisor-direct-pidfd-"));
  const binary = await compileSupervisor(root, ["AGENTMO_TEST_PIDFD_FAIL_AFTER=0"]);
  const script = path.join(root, "must-not-exec.cjs");
  const marker = path.join(root, "executed.txt");
  await writeFile(script, "require('node:fs').writeFileSync(process.argv[2], 'executed');\n");

  const result = await runSupervisorRaw(binary, script, marker);
  assert.equal(result.code, 78);
  assert.equal(result.protocol, "");
  await assert.rejects(() => access(marker));
});

it("Linux supervisor never execs the target when bootstrap clock admission fails", {
  skip: process.platform !== "linux",
  timeout: 20_000,
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-supervisor-clock-"));
  const binary = await compileSupervisor(root, ["AGENTMO_TEST_CLOCK_FAIL_AFTER=0"]);
  const script = path.join(root, "must-not-exec.cjs");
  const marker = path.join(root, "executed.txt");
  await writeFile(script, "require('node:fs').writeFileSync(process.argv[2], 'executed');\n");

  const result = await runSupervisorRaw(binary, script, marker);
  assert.equal(result.code, 78);
  assert.equal(result.protocol, "");
  await assert.rejects(() => access(marker));
});
