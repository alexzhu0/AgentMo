import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";
import { executeCodexReadCommand, probeBuilderAdapter } from "../src/builder-probe.js";

const execFileAsync = promisify(execFile);

function fakeCodex(overrides = {}) {
  const results = {
    "--version": { ok: true, stdout: "codex-cli 0.144.2\n" },
    "features list": { ok: true, stdout: "plugins stable true\nhooks stable true\nplugin_hooks removed false\n" },
    "plugin --help": { ok: true, stdout: "Usage: codex plugin [COMMAND]\n" },
    "resume --help": { ok: true, stdout: "Usage: codex resume [OPTIONS]\n" },
    "doctor --help": { ok: true, stdout: "Usage: codex doctor\n" },
    ...overrides,
  };
  const calls = [];
  return {
    calls,
    execute: async (command, args) => {
      calls.push({ command, args: [...args] });
      return results[args.join(" ")] ?? { ok: false, failure: "command-failed" };
    },
  };
}

describe("Codex builder capability probe", () => {
  it("uses only fixed read-only argv and separates observation from support", async () => {
    const fake = fakeCodex();
    const probe = await probeBuilderAdapter({ execute: fake.execute });
    assert.equal(probe.schemaVersion, "agentmo.builder-probe.v1");
    assert.equal(probe.host.version, "0.144.2");
    assert.equal(probe.mutatesHost, "unknown");
    assert.equal(probe.externalCommandMutation, "unknown");
    assert.equal(probe.required.ok, true);
    assert.equal(probe.support.status, "observed-compatible");
    assert.equal(probe.support.evidenceLevel, "observed");
    assert.equal(probe.support.claim, false);
    assert.equal(probe.support.domainQualityCertified, false);
    assert.deepEqual(fake.calls, [
      { command: "codex", args: ["--version"] },
      { command: "codex", args: ["features", "list"] },
      { command: "codex", args: ["plugin", "--help"] },
      { command: "codex", args: ["resume", "--help"] },
      { command: "codex", args: ["doctor", "--help"] },
    ]);
  });

  it("contains PATH-shadow execution in a minimal environment without claiming non-mutation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-probe-path-shadow-"));
    const bin = path.join(root, "bin");
    const logPath = path.join(root, "shadow-log.jsonl");
    const codexPath = path.join(bin, "codex");
    await mkdir(bin);
    await writeFile(codexPath, `#!${process.execPath}
const fs = require("node:fs");
const key = process.argv.slice(2).join(" ");
fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({
  args: process.argv.slice(2),
  environmentNames: Object.keys(process.env).sort(),
  sentinelPresent: Object.hasOwn(process.env, "AGENTMO_PROBE_ENV_SENTINEL")
}) + "\\n");
const outputs = {
  "--version": "codex-cli 0.144.2\\n",
  "features list": "plugins stable true\\nhooks stable true\\n",
  "plugin --help": "Usage: codex plugin [COMMAND]\\n",
  "resume --help": "Usage: codex resume [OPTIONS]\\n",
  "doctor --help": "Usage: codex doctor\\n"
};
if (!Object.hasOwn(outputs, key)) process.exitCode = 2;
else process.stdout.write(outputs[key]);
`, "utf8");
    await chmod(codexPath, 0o755);
    const moduleUrl = new URL("../src/builder-probe.js", import.meta.url).href;
    const source = `
const { probeBuilderAdapter } = await import(${JSON.stringify(moduleUrl)});
process.stdout.write(JSON.stringify(await probeBuilderAdapter()));
`;
    const result = await execFileAsync(process.execPath, [
      "--input-type=module",
      "--eval",
      source,
    ], {
      encoding: "utf8",
      env: {
        PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}`,
        HOME: root,
        CODEX_HOME: path.join(root, ".codex"),
        LANG: "C",
        AGENTMO_PROBE_ENV_SENTINEL: "must-not-reach-shadow",
      },
    });
    const probe = JSON.parse(result.stdout);
    const records = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const allowedEnvironmentNames = new Set([
      "PATH", "HOME", "CODEX_HOME", "LANG", "LC_ALL", "TMPDIR", "TERM", "SystemRoot",
      // macOS injects this value-blind locale key when launching a process.
      "__CF_USER_TEXT_ENCODING",
    ]);
    assert.equal(records.length, 5);
    assert.equal(records.every((record) => record.sentinelPresent === false), true);
    assert.equal(records.every((record) => (
      record.environmentNames.every((name) => allowedEnvironmentNames.has(name))
    )), true, JSON.stringify(records));
    assert.equal(probe.required.ok, true);
    assert.equal(probe.mutatesHost, "unknown");
    assert.equal(probe.externalCommandMutation, "unknown");
  });

  it("force-kills a stubborn PATH-shadow command and waits for close", {
    skip: process.platform === "win32",
  }, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-probe-timeout-"));
    const bin = path.join(root, "bin");
    const codexPath = path.join(bin, "codex");
    const pidPath = path.join(root, "shadow-pid");
    const sigtermPath = path.join(root, "shadow-sigterm");
    const grandchildPidPath = path.join(root, "shadow-grandchild-pid");
    const grandchildSigtermPath = path.join(root, "shadow-grandchild-sigterm");
    const grandchildSource = `
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(grandchildPidPath)}, String(process.pid));
process.stdout.write("probe-daemon-value-canary");
process.on("SIGTERM", () => fs.writeFileSync(${JSON.stringify(grandchildSigtermPath)}, "observed"));
setInterval(() => {}, 1_000);
`;
    await mkdir(bin);
    await writeFile(codexPath, `#!${process.execPath}
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));
process.stdout.write("probe-timeout-value-canary");
require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(grandchildSource)}], {
  stdio: "inherit",
});
process.on("SIGTERM", () => fs.writeFileSync(${JSON.stringify(sigtermPath)}, "observed"));
setInterval(() => {}, 1_000);
`, "utf8");
    await chmod(codexPath, 0o755);
    const moduleUrl = new URL("../src/builder-probe.js", import.meta.url).href;
    const source = `
const { executeCodexReadCommand } = await import(${JSON.stringify(moduleUrl)});
const startedAt = Date.now();
const result = await executeCodexReadCommand("codex", ["--version"], { timeoutMs: 1_500 });
process.stdout.write(JSON.stringify({ result, elapsedMs: Date.now() - startedAt }));
`;
    const child = await execFileAsync(process.execPath, [
      "--input-type=module",
      "--eval",
      source,
    ], {
      encoding: "utf8",
      env: {
        PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}`,
        HOME: root,
        CODEX_HOME: path.join(root, ".codex"),
        LANG: "C",
      },
    });
    const outcome = JSON.parse(child.stdout);

    assert.equal(outcome.result.ok, false);
    assert.equal(outcome.result.failure, "timeout", JSON.stringify(outcome));
    assert.equal(outcome.elapsedMs >= 1_500, true);
    assert.equal(outcome.elapsedMs < 4_000, true, "probe timeout did not remain bounded");
    let pid;
    let grandchildPid;
    try {
      pid = Number(await readFile(pidPath, "utf8"));
      grandchildPid = Number(await readFile(grandchildPidPath, "utf8"));
    } catch {
      assert.fail(JSON.stringify(outcome));
    }
    assert.equal(await readFile(sigtermPath, "utf8"), "observed");
    assert.equal(await readFile(grandchildSigtermPath, "utf8"), "observed");
    assert.throws(
      () => process.kill(pid, 0),
      (error) => error?.code === "ESRCH",
      "probe returned before the PATH-shadow child closed",
    );
    assert.throws(
      () => process.kill(grandchildPid, 0),
      (error) => error?.code === "ESRCH",
      "probe returned before the PATH-shadow grandchild was reaped",
    );
    assert.equal(JSON.stringify(outcome).includes("probe-timeout-value-canary"), false);
    assert.equal(JSON.stringify(outcome).includes("probe-daemon-value-canary"), false);
  });

  it("bounds an escaped stdout-holding PATH-shadow command after direct exit", {
    skip: process.platform === "win32",
    timeout: 15_000,
  }, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-probe-escaped-"));
    const bin = path.join(root, "bin");
    const codexPath = path.join(bin, "codex");
    const escapedPidPath = path.join(root, "escaped-pid");
    const escapedSource = `
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(escapedPidPath)}, String(process.pid));
process.stdout.write("probe-escaped-stdout-canary");
setInterval(() => {}, 1_000);
`;
    await mkdir(bin);
    await writeFile(codexPath, `#!${process.execPath}
if (process.argv[2] !== "--version") process.exit(2);
process.stdout.write("codex-cli 0.144.2\\n");
const child = require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(escapedSource)}], {
  detached: true,
  stdio: "inherit",
});
child.unref();
process.exit(0);
`, "utf8");
    await chmod(codexPath, 0o755);
    const moduleUrl = new URL("../src/builder-probe.js", import.meta.url).href;
    const source = `
const { executeCodexReadCommand } = await import(${JSON.stringify(moduleUrl)});
const startedAt = Date.now();
const result = await executeCodexReadCommand("codex", ["--version"], { timeoutMs: 1_500 });
process.stdout.write(JSON.stringify({ result, elapsedMs: Date.now() - startedAt }));
`;
    let escapedPid = null;
    try {
      const child = await execFileAsync(process.execPath, [
        "--input-type=module",
        "--eval",
        source,
      ], {
        encoding: "utf8",
        env: {
          PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}`,
          HOME: root,
          CODEX_HOME: path.join(root, ".codex"),
          LANG: "C",
        },
      });
      const outcome = JSON.parse(child.stdout);
      escapedPid = Number(await readFile(escapedPidPath, "utf8"));

      assert.equal(outcome.result.ok, false);
      assert.equal(outcome.result.failure, "timeout", JSON.stringify(outcome));
      assert.equal(outcome.elapsedMs < 4_000, true, "escaped stdout holder was not bounded");
      assert.equal(JSON.stringify(outcome).includes("probe-escaped-stdout-canary"), false);
      assert.equal(JSON.stringify(outcome).includes("codex-cli 0.144.2"), false);
    } finally {
      if (Number.isSafeInteger(escapedPid) && escapedPid > 0) {
        try {
          process.kill(escapedPid, "SIGKILL");
        } catch (error) {
          if (error?.code !== "ESRCH") throw error;
        }
      }
    }
  });

  it("fails closed when close wins scheduling after the monotonic deadline", {
    skip: process.platform === "win32",
    timeout: 10_000,
  }, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-probe-deadline-race-"));
    const bin = path.join(root, "bin");
    const codexPath = path.join(bin, "codex");
    const holderSource = "setTimeout(() => process.exit(0), 1_510);";
    await mkdir(bin);
    await writeFile(codexPath, `#!${process.execPath}
if (process.argv[2] !== "--version") process.exit(2);
process.stdout.write("codex-cli 0.144.2\\n");
const holder = require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(holderSource)}], {
  detached: true,
  stdio: "inherit",
});
holder.unref();
process.exit(0);
`, "utf8");
    await chmod(codexPath, 0o755);
    const moduleUrl = new URL("../src/builder-probe.js", import.meta.url).href;
    const source = `
const nativeSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (callback, delay, ...argumentsList) => nativeSetTimeout(
  callback,
  delay === 1_500 ? delay + 250 : delay,
  ...argumentsList,
);
const { executeCodexReadCommand } = await import(${JSON.stringify(moduleUrl)});
const startedAt = Date.now();
const result = await executeCodexReadCommand("codex", ["--version"], { timeoutMs: 1_500 });
process.stdout.write(JSON.stringify({ result, elapsedMs: Date.now() - startedAt }));
`;
    const child = await execFileAsync(process.execPath, [
      "--input-type=module",
      "--eval",
      source,
    ], {
      encoding: "utf8",
      env: {
        PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}`,
        HOME: root,
        CODEX_HOME: path.join(root, ".codex"),
        LANG: "C",
      },
    });
    const outcome = JSON.parse(child.stdout);

    assert.equal(outcome.result.ok, false);
    assert.equal(outcome.result.failure, "timeout", JSON.stringify(outcome));
    assert.equal(outcome.elapsedMs < 4_000, true, "deadline race was not bounded");
    assert.equal(JSON.stringify(outcome).includes("codex-cli 0.144.2"), false);
  });

  it("returns after bounded grace when its process group cannot be reaped", {
    skip: process.platform === "win32",
    timeout: 10_000,
  }, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-probe-unreaped-"));
    const bin = path.join(root, "bin");
    const codexPath = path.join(bin, "codex");
    const pidPath = path.join(root, "unreaped-pid");
    await mkdir(bin);
    await writeFile(codexPath, `#!${process.execPath}
require("node:fs").writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));
process.stdout.write("probe-unreaped-stdout-canary");
setInterval(() => {}, 1_000);
`, "utf8");
    await chmod(codexPath, 0o755);
    const moduleUrl = new URL("../src/builder-probe.js", import.meta.url).href;
    const source = `
const nativeKill = process.kill;
process.kill = (target, signal) => {
  if (typeof target === "number" && target < 0) return true;
  return nativeKill(target, signal);
};
const { executeCodexReadCommand } = await import(${JSON.stringify(moduleUrl)});
const startedAt = Date.now();
const result = await executeCodexReadCommand("codex", ["--version"], { timeoutMs: 1_500 });
process.stdout.write(JSON.stringify({ result, elapsedMs: Date.now() - startedAt }));
`;
    let pid = null;
    try {
      const child = await execFileAsync(process.execPath, [
        "--input-type=module",
        "--eval",
        source,
      ], {
        encoding: "utf8",
        timeout: 5_000,
        env: {
          PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}`,
          HOME: root,
          CODEX_HOME: path.join(root, ".codex"),
          LANG: "C",
        },
      });
      const outcome = JSON.parse(child.stdout);
      pid = Number(await readFile(pidPath, "utf8"));

      assert.equal(outcome.result.ok, false);
      assert.equal(outcome.result.failure, "timeout", JSON.stringify(outcome));
      assert.equal(outcome.elapsedMs < 4_000, true, "unreaped group exceeded bounded grace");
      assert.equal(JSON.stringify(outcome).includes("probe-unreaped-stdout-canary"), false);
    } finally {
      if (Number.isSafeInteger(pid) && pid > 0) {
        try {
          process.kill(pid, "SIGKILL");
        } catch (error) {
          if (error?.code !== "ESRCH") throw error;
        }
      }
    }
  });

  it("fails closed when a required canonical feature is explicitly disabled", async () => {
    const fake = fakeCodex({
      "features list": { ok: true, stdout: "plugins stable true\nhooks stable false\nplugin_hooks removed false\n" },
    });
    const probe = await probeBuilderAdapter({ execute: fake.execute });
    assert.equal(probe.required.ok, false);
    assert.deepEqual(probe.required.incompatible, ["native-hooks"]);
    assert.equal(probe.support.status, "unsupported");
    assert.equal(probe.support.claim, false);
  });

  it("reports an optional missing command as an explicit tested degradation", async () => {
    const fake = fakeCodex({ "doctor --help": { ok: false, failure: "command-failed" } });
    const probe = await probeBuilderAdapter({ execute: fake.execute });
    assert.equal(probe.required.ok, true);
    assert.deepEqual(probe.optional.degraded, ["host-doctor"]);
    const doctor = probe.observations.find((item) => item.id === "host-doctor");
    assert.equal(doctor.status, "degraded");
    assert.equal(doctor.fallback.status, "disabled");
    assert.equal(doctor.fallback.tested, true);
  });

  it("does not expose unbounded raw host output", async () => {
    const marker = "PRIVATE_PAYLOAD_";
    const fake = fakeCodex({ "plugin --help": { ok: true, stdout: marker.repeat(10_000) } });
    const probe = await probeBuilderAdapter({ execute: fake.execute });
    assert.equal(JSON.stringify(probe).includes(marker), false);
  });

  it("rejects any command outside the fixed read-only allowlist", async () => {
    assert.deepEqual(
      await executeCodexReadCommand("codex", ["plugin", "remove", "anything"]),
      { ok: false, failure: "command-not-allowed" },
    );
  });
});
