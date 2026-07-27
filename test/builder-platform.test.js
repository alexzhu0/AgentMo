import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { constants as FS_CONSTANTS } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, it } from "node:test";

import { assertBuilderPlatform } from "../src/builder-platform.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI_URL = pathToFileURL(path.join(REPO_ROOT, "src", "cli.js")).href;
const JOURNAL_URL = pathToFileURL(path.join(REPO_ROOT, "src", "builder-immutable-journal.js")).href;
const POSIX_EFFECT_URL = pathToFileURL(path.join(REPO_ROOT, "src", "builder-posix-effect.js")).href;
const RELEASE_BUILDER_URL = pathToFileURL(
  path.join(REPO_ROOT, "scripts", "build-builder-uat-releases.js"),
).href;
const PRIOR_PREFLIGHT_URL = pathToFileURL(
  path.join(REPO_ROOT, "scripts", "preflight-codex-uat-prior-attempt.js"),
).href;
const VERIFIER_URL = pathToFileURL(
  path.join(REPO_ROOT, "scripts", "verify-codex-uat-candidate.js"),
).href;

function runEval(source, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", source], {
      cwd: options.cwd ?? REPO_ROOT,
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("close", (code, signal) => resolve({
      code,
      signal,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    }));
    child.stdin.on("error", () => {});
    child.stdin.end(options.input ?? "");
  });
}

function runIpcNode(argumentsList, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, argumentsList, {
      cwd: options.cwd ?? REPO_ROOT,
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    });
    const stdout = [];
    const stderr = [];
    const messages = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("message", (message) => {
      messages.push(message);
      if (message?.type === "checkpoint") {
        child.send({
          type: "continue",
          point: message.point,
          correlation: message.correlation,
        });
      }
    });
    child.on("close", (code, signal) => resolve({
      code,
      signal,
      messages,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    }));
    child.stdin.on("error", () => {});
    child.stdin.end(options.input ?? "");
  });
}

function directoryIdentity(stats) {
  return {
    device: stats.dev.toString(10),
    inode: stats.ino.toString(10),
    uid: stats.uid.toString(10),
    gid: stats.gid.toString(10),
    mode: (stats.mode & 0o777n).toString(8),
  };
}

function overridePlatformSource() {
  return 'Object.defineProperty(process, "platform", { value: "win32" });';
}

describe("shared Builder platform gate", () => {
  it("requires a supported OS, owner identity, O_DIRECTORY, and O_NOFOLLOW", () => {
    const supported = {
      platform: "linux",
      getuid: () => 1000,
      constants: FS_CONSTANTS,
    };
    assert.equal(assertBuilderPlatform(supported).supported, true);
    for (const options of [
      { ...supported, platform: "win32" },
      { ...supported, getuid: undefined },
      { ...supported, constants: { ...FS_CONSTANTS, O_DIRECTORY: 0 } },
      { ...supported, constants: { ...FS_CONSTANTS, O_NOFOLLOW: 0 } },
    ]) {
      assert.throws(
        () => assertBuilderPlatform(options),
        (error) => error?.code === "AGENTMO_BUILDER_PLATFORM_UNSUPPORTED",
      );
    }
  });

  it("rejects the internal CLI hook before consuming stdin or creating project state", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "agentmo-platform-cli-hook-"));
    const source = [
      overridePlatformSource(),
      `const { main } = await import(${JSON.stringify(CLI_URL)});`,
      'await main(["__builder-hook"]);',
    ].join("\n");
    const result = await runEval(source, {
      cwd: project,
      input: JSON.stringify({ hook_event_name: "SessionStart" }),
    });
    assert.equal(result.code, 1);
    assert.equal(result.signal, null);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.deepEqual(await readdir(project), []);
  });

  it("rejects the POSIX effect parent before spawning a child when owner identity is unavailable", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-platform-posix-child-"));
    const source = [
      'Object.defineProperty(process, "getuid", { value: undefined });',
      `const { runBuilderPosixEffect } = await import(${JSON.stringify(POSIX_EFFECT_URL)});`,
      "try {",
      "  await runBuilderPosixEffect({});",
      '} catch (error) { process.stdout.write(JSON.stringify({ code: error?.code })); }',
    ].join("\n");
    const result = await runEval(source, {
      cwd: root,
      input: "x".repeat(128 * 1024),
    });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      code: "AGENTMO_BUILDER_PLATFORM_UNSUPPORTED",
    });
    assert.deepEqual(await readdir(root), []);
  });

  it("does not expose the POSIX child as a package subpath", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-platform-package-"));
    const result = await runEval([
      'try {',
      '  await import("agentmo/src/builder-posix-effect.js");',
      '  process.stdout.write("unexpected");',
      '} catch (error) {',
      '  process.stdout.write(JSON.stringify({ code: error?.code }));',
      '}',
    ].join("\n"), { cwd: REPO_ROOT });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
    });
    assert.deepEqual(await readdir(root), []);
  });

  it("binds POSIX effects to an inherited directory FD and rejects direct IPC child invocation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-platform-posix-retained-"));
    const effects = path.join(root, "effects");
    await mkdir(effects, { mode: 0o700 });
    const handle = await open(
      effects,
      FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_DIRECTORY | FS_CONSTANTS.O_NOFOLLOW,
    );
    const stats = await handle.stat({ bigint: true });
    const authority = Object.freeze({
      path: effects,
      handle,
      identity: Object.freeze(directoryIdentity(stats)),
    });
    const payload = Buffer.from("retained-child-cwd\n", "utf8").toString("base64");
    const previousCwd = process.cwd();
    try {
      const { runBuilderPosixEffect } = await import(POSIX_EFFECT_URL);
      const result = await runBuilderPosixEffect({
        action: "write-file",
        name: "bound.txt",
        payload,
      }, { directoryAuthority: authority });
      assert.equal(result.created, true);
      assert.equal(process.cwd(), previousCwd);
      assert.deepEqual(await readFile(path.join(effects, "bound.txt")), Buffer.from("retained-child-cwd\n"));

      const source = await readFile(fileURLToPath(POSIX_EFFECT_URL), "utf8");
      assert.match(source, /const DIRECTORY_DESCRIPTOR = 4;/u);
      assert.match(source, /const SOURCE_DESCRIPTOR = 5;/u);
      assert.match(source, /os\.fchdir\(4\)/u);
      assert.match(
        source,
        /DARWIN_DIRECTORY_FD_BRIDGE_COMMAND = "\/usr\/bin\/python3"/u,
      );
      assert.match(source, /lstat\(DARWIN_DIRECTORY_FD_BRIDGE_COMMAND/u);
      assert.match(source, /\["-I", "-c", DARWIN_DIRECTORY_FD_BRIDGE/u);
      assert.match(source, /cwd: "\/"/u);
      assert.match(source, /normalized\.directoryAuthority\.handle\.fd/u);
      assert.match(source, /process\.chdir\(`\/proc\/self\/fd\/\$\{DIRECTORY_DESCRIPTOR\}`\)/u);
      assert.equal(source.includes("cwd: normalized.directoryAuthority.path"), false);

      const rawRequest = {
        schemaVersion: "agentmo.builder-posix-effect.v2",
        action: "write-file",
        correlation: "0".repeat(64),
        directoryIdentity: directoryIdentity(stats),
        name: "must-not-exist.txt",
        payload,
        sourceName: null,
      };
      const raw = await runIpcNode([
        fileURLToPath(POSIX_EFFECT_URL),
        "__builder-posix-effect-child",
      ], {
        cwd: effects,
        input: JSON.stringify(rawRequest),
      });
      assert.equal(raw.code, 1, raw.stderr);
      assert.equal(raw.signal, null);
      assert.deepEqual(raw.messages, []);
      assert.deepEqual(await readdir(effects), ["bound.txt"]);
    } finally {
      await handle.close();
    }
  });

  it("fails closed before mutation when the fixed Darwin descriptor bridge is absent", {
    skip: process.platform !== "darwin",
  }, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-platform-missing-bridge-"));
    const moduleDirectory = path.join(root, "module");
    const effects = path.join(root, "effects");
    const missingBridge = path.join(root, "absent-python3");
    const sourcePath = path.join(moduleDirectory, "builder-posix-effect.js");
    const bridgeDeclaration = 'const DARWIN_DIRECTORY_FD_BRIDGE_COMMAND = "/usr/bin/python3";';
    await Promise.all([
      mkdir(moduleDirectory, { mode: 0o700 }),
      mkdir(effects, { mode: 0o700 }),
    ]);
    await cp(path.join(REPO_ROOT, "src", "builder-platform.js"), path.join(
      moduleDirectory,
      "builder-platform.js",
    ));
    const source = await readFile(path.join(REPO_ROOT, "src", "builder-posix-effect.js"), "utf8");
    const altered = source.replace(
      bridgeDeclaration,
      `const DARWIN_DIRECTORY_FD_BRIDGE_COMMAND = ${JSON.stringify(missingBridge)};`,
    );
    assert.notEqual(altered, source);
    await writeFile(sourcePath, altered, { flag: "wx", mode: 0o600 });

    const handle = await open(
      effects,
      FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_DIRECTORY | FS_CONSTANTS.O_NOFOLLOW,
    );
    try {
      const stats = await handle.stat({ bigint: true });
      const authority = Object.freeze({
        path: effects,
        handle,
        identity: Object.freeze(directoryIdentity(stats)),
      });
      const { runBuilderPosixEffect } = await import(
        `${pathToFileURL(sourcePath).href}?missing-bridge=${process.pid}`,
      );
      await assert.rejects(
        runBuilderPosixEffect({
          action: "mkdir",
          name: "must-not-exist",
          payload: "",
        }, { directoryAuthority: authority }),
        (error) => error?.code === "AGENTMO_BUILDER_POSIX_EFFECT_BRIDGE_REJECTED",
      );
      assert.deepEqual(await readdir(effects), []);
    } finally {
      await handle.close();
    }
  });

  it("rejects immutable journal mutation before creating its parent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-platform-journal-"));
    const journalPath = path.join(root, "absent", "attempt.journal");
    const source = [
      overridePlatformSource(),
      `const { appendImmutableJournalEntry } = await import(${JSON.stringify(JOURNAL_URL)});`,
      "try {",
      "  await appendImmutableJournalEntry({",
      `    journalPath: ${JSON.stringify(journalPath)},`,
      '    canonicalBytes: Buffer.from("{}\\n", "utf8"),',
      "  });",
      '} catch (error) { process.stdout.write(JSON.stringify({ code: error?.code })); }',
    ].join("\n");
    const result = await runEval(source);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      code: "AGENTMO_IMMUTABLE_JOURNAL_PLATFORM_UNSUPPORTED",
    });
    assert.deepEqual(await readdir(root), []);
  });

  it("gates exported Builder mutation families before request parsing or I/O", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-platform-exports-"));
    const moduleUrls = Object.fromEntries(Object.entries({
      checkpoint: "src/builder-checkpoint.js",
      behavior: "src/builder-behavior-eval.js",
      host: "src/builder-codex-host.js",
      continuation: "src/builder-codex-uat-continuation.js",
      uat: "src/builder-codex-uat.js",
      hook: "src/builder-hook-bridge.js",
      install: "src/builder-install.js",
      lifecycle: "src/builder-lifecycle.js",
      probe: "src/builder-probe.js",
    }).map(([name, relativePath]) => [
      name,
      pathToFileURL(path.join(REPO_ROOT, relativePath)).href,
    ]));
    const source = [
      overridePlatformSource(),
      `const urls = ${JSON.stringify(moduleUrls)};`,
      "const modules = {};",
      "for (const [name, url] of Object.entries(urls)) modules[name] = await import(url);",
      "const calls = [",
      "  () => modules.checkpoint.writeBuilderCheckpoint('absent', null),",
      "  () => modules.behavior.runBuilderBehaviorEvaluation({}),",
      "  () => modules.host.mutateCodexHost({}),",
      "  () => modules.continuation.continueCodexUatAfterDeactivation({}),",
      "  () => modules.uat.startCodexUatAttempt({}),",
      "  () => modules.hook.deliverInstalledBuilderHook({}),",
      "  () => modules.install.applyBuilderInstall({}),",
      "  () => modules.lifecycle.applyBuilderDeactivate({}),",
      "  () => modules.probe.probeBuilderAdapter({}),",
      "];",
      "const codes = [];",
      "for (const call of calls) {",
      "  try { await call(); codes.push(null); } catch (error) { codes.push(error?.code ?? null); }",
      "}",
      "process.stdout.write(JSON.stringify(codes));",
    ].join("\n");
    const result = await runEval(source, { cwd: root });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), Array(9).fill("AGENTMO_BUILDER_PLATFORM_UNSUPPORTED"));
    assert.deepEqual(await readdir(root), []);
  });

  it("rejects the release producer before scratch creation or npm execution", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-platform-release-"));
    const outDirectory = path.join(root, "releases");
    const source = [
      overridePlatformSource(),
      `process.argv = [process.execPath, ${JSON.stringify(fileURLToPath(RELEASE_BUILDER_URL))},`,
      `  "--out", ${JSON.stringify(outDirectory)}, "--baseline-version", "0.1.0-a.1",`,
      '  "--successor-version", "0.1.0-a.2", "--json"];',
      `await import(${JSON.stringify(RELEASE_BUILDER_URL)});`,
    ].join("\n");
    const result = await runEval(source);
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr).code, "AGENTMO_BUILDER_UAT_RELEASE_PLATFORM_UNSUPPORTED");
    assert.equal(result.stdout, "");
    assert.deepEqual(await readdir(root), []);
  });

  it("rejects the standalone verifier before admitting paths or evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-platform-verifier-"));
    const source = [
      overridePlatformSource(),
      `process.argv = [process.execPath, ${JSON.stringify(fileURLToPath(VERIFIER_URL))}, "preview"];`,
      `await import(${JSON.stringify(VERIFIER_URL)});`,
    ].join("\n");
    const result = await runEval(source, { cwd: root });
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr).code, "AGENTMO_CODEX_UAT_VERIFIER_PLATFORM_UNSUPPORTED");
    assert.equal(result.stdout, "");
    assert.deepEqual(await readdir(root), []);
  });

  it("rejects the prior-attempt preflight before reading its private locator", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-platform-preflight-"));
    const source = [
      overridePlatformSource(),
      `process.argv = [process.execPath, ${JSON.stringify(fileURLToPath(PRIOR_PREFLIGHT_URL))},`,
      '  "run-prior-preflight"];',
      `await import(${JSON.stringify(PRIOR_PREFLIGHT_URL)});`,
    ].join("\n");
    const result = await runEval(source, {
      cwd: root,
      input: "private-locator-that-must-not-be-read",
    });
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr).code, "AGENTMO_CODEX_UAT_PRIOR_PLATFORM_UNSUPPORTED");
    assert.equal(result.stdout, "");
    assert.deepEqual(await readdir(root), []);
  });

  it("rejects the installed hook runner before reading stdin or resolving its launcher", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-platform-runner-"));
    const project = path.join(root, "project");
    const pluginRoot = path.join(root, "plugins", "agentmo");
    const hookPath = path.join(pluginRoot, "hooks", "agentmo-hook.js");
    const platformPath = path.join(pluginRoot, "runtime", "agentmo", "src", "builder-platform.js");
    await mkdir(project);
    await mkdir(path.dirname(hookPath), { recursive: true });
    await mkdir(path.dirname(platformPath), { recursive: true });
    await cp(path.join(REPO_ROOT, "plugin", "hooks", "agentmo-hook.js"), hookPath);
    await cp(path.join(REPO_ROOT, "src", "builder-platform.js"), platformPath);
    const source = [
      overridePlatformSource(),
      `process.argv[1] = ${JSON.stringify(hookPath)};`,
      `await import(${JSON.stringify(pathToFileURL(hookPath).href)});`,
    ].join("\n");
    const result = await runEval(source, {
      cwd: project,
      input: "x".repeat(128 * 1024),
    });
    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.deepEqual(await readdir(project), []);
  });
});
