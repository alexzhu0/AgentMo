import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

const HOOK_PATH = new URL("../plugin/hooks/agentmo-hook.js", import.meta.url);
const BEHAVIOR_EVAL_PATH = new URL("../src/builder-behavior-eval.js", import.meta.url);
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
    `return (${extractSupervisor(source)});`,
  )(
    options.spawn ?? spawn,
    loaderSource,
    options.childTimeoutMs ?? 200,
    options.timeoutSettlementGraceMs ?? 100,
    16 * 1024,
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

async function absent(file) {
  await assert.rejects(access(file), (error) => error?.code === "ENOENT");
}

describe("installed hook child supervisor", () => {
  it("keeps a bounded outer behavior-evaluation settlement margin", async () => {
    const [hookSource, behaviorSource] = await Promise.all([
      readFile(HOOK_PATH, "utf8"),
      readFile(BEHAVIOR_EVAL_PATH, "utf8"),
    ]);
    const childTimeoutMs = declaredMilliseconds(hookSource, "CHILD_TIMEOUT_MS");
    const outerTimeoutMs = declaredMilliseconds(behaviorSource, "AUTHENTIC_HOOK_TIMEOUT_MS");

    assert.ok(childTimeoutMs >= 60_000);
    assert.ok(outerTimeoutMs >= childTimeoutMs + 30_000);
  });

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

  it("settles at the timeout when an escaped descendant holds stdout open", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-hook-supervisor-escape-"));
    const pidPath = path.join(root, "escaped-pid");
    const launcherPath = path.join(root, "virtual-launcher.js");
    await writeFile(launcherPath, "", { flag: "wx", mode: 0o600 });
    const launcherUrl = pathToFileURL(launcherPath).href;
    const descendantSource = [
      'const fs = require("node:fs");',
      `fs.writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));`,
      "setTimeout(() => {}, 10_000);",
    ].join("\n");
    const launcherSource = [
      'import { spawn } from "node:child_process";',
      `const descendant = spawn(process.execPath, ["--eval", ${JSON.stringify(descendantSource)}], {`,
      '  detached: true, stdio: ["ignore", "inherit", "inherit"],',
      "});",
      "await new Promise((resolve, reject) => {",
      '  descendant.once("spawn", resolve);',
      '  descendant.once("error", reject);',
      "});",
      "descendant.unref();",
      "await new Promise((resolve) => setTimeout(resolve, 100));",
      "process.exit(0);",
    ].join("\n");
    const source = await readFile(HOOK_PATH, "utf8");
    const run = compileSupervisor(source, launcherUrl, launcherSource);
    const started = Date.now();

    await assert.rejects(
      run(Buffer.alloc(0), supervisorPaths(root, launcherUrl)),
      /Installed hook launcher rejected/u,
    );
    assert.ok(Date.now() - started < 2_000);

    const escapedPid = Number.parseInt(await readFile(pidPath, "utf8"), 10);
    assert.ok(Number.isSafeInteger(escapedPid) && escapedPid > 0);
    try {
      process.kill(escapedPid, "SIGKILL");
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
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
