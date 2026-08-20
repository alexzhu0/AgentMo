import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const VERIFIER_URL = pathToFileURL(path.resolve(
  "src",
  "builder-bootstrap-snapshot.js",
)).href;
const HOOK_URL = new URL("../plugin/hooks/agentmo-hook.js", import.meta.url);
const MAX_BOOTSTRAP_GRAPH_BYTES = 24 * 1024 * 1024;

function extractHookLoaderSource(source) {
  const prefix = "const AUTHENTICATED_BOOTSTRAP_LOADER_SOURCE = String.raw`";
  const suffix = "\n`;\nconst MANAGED_PROJECT_FILES";
  const start = source.indexOf(prefix);
  const end = source.indexOf(suffix, start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return source.slice(start + prefix.length, end);
}

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function exactDescriptorResult({ descriptor, source, bytes, env, endAfterWrite = false }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", source], {
      env,
      stdio: ["ignore", "pipe", "pipe", descriptor === 3 ? "pipe" : "ignore", descriptor === 4 ? "pipe" : "ignore"],
    });
    const writer = child.stdio[descriptor];
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    writer.on("error", () => {});
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 1_000);
    child.once("error", () => {
      clearTimeout(timeout);
      writer.destroy();
      resolve({ code: 1, stdout, stderr, timedOut });
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      writer.destroy();
      resolve({
        code: Number.isInteger(code) ? code : 1,
        signal: signal ?? null,
        stdout,
        stderr,
        timedOut,
      });
    });
    if (endAfterWrite) writer.end(bytes);
    else writer.write(bytes);
  });
}

function exactBootstrapGraphFixture() {
  const receiptDigest = `sha256:${"c".repeat(64)}`;
  const modulePackageRoot = path.resolve(fileURLToPath(new URL("..", VERIFIER_URL)));
  const marketplaceRoot = path.resolve(modulePackageRoot, "..", "..", "..", "..");
  const entries = [
    ["plugins/agentmo/hooks/agentmo-hook.js", "module", Buffer.from("export {};\n", "utf8")],
    [".agents/plugins/marketplace.json", "json", Buffer.from("{}\n", "utf8")],
  ].map(([relativePath, format, source]) => Object.freeze({
    relativePath,
    url: pathToFileURL(path.join(marketplaceRoot, ...relativePath.split("/"))).href,
    digest: digest(source),
    byteLength: source.byteLength,
    format,
    source: source.toString("base64"),
  }));
  const runnerDigest = entries[0].digest;
  const graph = Object.freeze({
    schemaVersion: "agentmo.builder-bootstrap-graph.v1",
    receiptDigest,
    runnerDigest,
    marketplaceRoot,
    entries,
  });
  const bytes = Buffer.from(JSON.stringify(graph), "utf8");
  const binding = Object.freeze({
    releaseDigest: receiptDigest,
    members: Object.freeze([
      Object.freeze({ kind: "root", relativePath: "" }),
      ...entries.map((entry) => Object.freeze({
        kind: "file",
        relativePath: entry.relativePath,
        digest: entry.digest,
        identity: Object.freeze({ size: String(entry.byteLength) }),
      })),
    ]),
  });
  return Object.freeze({ bytes, graphDigest: digest(bytes), receiptDigest, runnerDigest, binding });
}

test("bootstrap graph readers finish after the declared exact frame without peer EOF", async () => {
  const fixture = exactBootstrapGraphFixture();
  const env = {
    AGENTMO_BUILDER_HOOK_BOOTSTRAP_MODE: "authenticated-graph-v1",
    AGENTMO_BUILDER_HOOK_GRAPH_DIGEST: fixture.graphDigest,
    AGENTMO_BUILDER_HOOK_GRAPH_BYTE_LENGTH: String(fixture.bytes.byteLength),
    AGENTMO_BUILDER_HOOK_RUNNER_DIGEST: fixture.runnerDigest,
    LANG: "C",
    LC_ALL: "C",
  };
  const verifier = `
const verifier = await import(${JSON.stringify(VERIFIER_URL)});
const capability = await verifier.verifyInstalledBootstrapSnapshot({
  activationReceipt: {
    identity: { releaseDigest: ${JSON.stringify(fixture.receiptDigest)} },
    hostActivation: { finalProjectionBinding: ${JSON.stringify(fixture.binding)} },
  },
  receiptDigest: ${JSON.stringify(fixture.receiptDigest)},
  runnerDigest: ${JSON.stringify(fixture.runnerDigest)},
});
process.stdout.write(JSON.stringify({ verified: capability !== null }));
`;
  const hookSource = await readFile(HOOK_URL, "utf8");
  const loaderUrl = `data:text/javascript,${encodeURIComponent(extractHookLoaderSource(hookSource))}`;
  const loader = `
await import(${JSON.stringify(loaderUrl)});
process.stdout.write(JSON.stringify({ loaded: true }));
`;

  const verifierResult = await exactDescriptorResult({
    descriptor: 4,
    source: verifier,
    bytes: fixture.bytes,
    env,
  });
  assert.deepEqual(verifierResult, {
    code: 0,
    signal: null,
    stdout: JSON.stringify({ verified: true }),
    stderr: "",
    timedOut: false,
  });

  const loaderResult = await exactDescriptorResult({
    descriptor: 3,
    source: loader,
    bytes: fixture.bytes,
    env,
  });
  assert.deepEqual(loaderResult, {
    code: 0,
    signal: null,
    stdout: JSON.stringify({ loaded: true }),
    stderr: "",
    timedOut: false,
  });
});

test("bootstrap graph readers reject malformed declared lengths before peer EOF", async () => {
  const fixture = exactBootstrapGraphFixture();
  const verifier = `
const verifier = await import(${JSON.stringify(VERIFIER_URL)});
let rejected = false;
try {
  await verifier.verifyInstalledBootstrapSnapshot({
    activationReceipt: {
      identity: { releaseDigest: ${JSON.stringify(fixture.receiptDigest)} },
      hostActivation: { finalProjectionBinding: ${JSON.stringify(fixture.binding)} },
    },
    receiptDigest: ${JSON.stringify(fixture.receiptDigest)},
    runnerDigest: ${JSON.stringify(fixture.runnerDigest)},
  });
} catch {
  rejected = true;
}
process.stdout.write(JSON.stringify({ rejected }));
`;
  const hookSource = await readFile(HOOK_URL, "utf8");
  const loaderUrl = `data:text/javascript,${encodeURIComponent(extractHookLoaderSource(hookSource))}`;
  const loader = `
let rejected = false;
try {
  await import(${JSON.stringify(loaderUrl)});
} catch {
  rejected = true;
}
process.stdout.write(JSON.stringify({ rejected }));
`;
  for (const declaredByteLength of ["0", "01", String(MAX_BOOTSTRAP_GRAPH_BYTES + 1)]) {
    const env = {
      AGENTMO_BUILDER_HOOK_BOOTSTRAP_MODE: "authenticated-graph-v1",
      AGENTMO_BUILDER_HOOK_GRAPH_DIGEST: fixture.graphDigest,
      AGENTMO_BUILDER_HOOK_GRAPH_BYTE_LENGTH: declaredByteLength,
      AGENTMO_BUILDER_HOOK_RUNNER_DIGEST: fixture.runnerDigest,
      LANG: "C",
      LC_ALL: "C",
    };
    for (const [descriptor, source] of [[4, verifier], [3, loader]]) {
      const result = await exactDescriptorResult({
        descriptor,
        source,
        bytes: Buffer.alloc(0),
        env,
      });
      assert.deepEqual(result, {
        code: 0,
        signal: null,
        stdout: JSON.stringify({ rejected: true }),
        stderr: "",
        timedOut: false,
      });
    }
  }
});

test("bootstrap graph readers reject an EOF-short declared frame", async () => {
  const fixture = exactBootstrapGraphFixture();
  const env = {
    AGENTMO_BUILDER_HOOK_BOOTSTRAP_MODE: "authenticated-graph-v1",
    AGENTMO_BUILDER_HOOK_GRAPH_DIGEST: fixture.graphDigest,
    AGENTMO_BUILDER_HOOK_GRAPH_BYTE_LENGTH: String(fixture.bytes.byteLength),
    AGENTMO_BUILDER_HOOK_RUNNER_DIGEST: fixture.runnerDigest,
    LANG: "C",
    LC_ALL: "C",
  };
  const verifier = `
const verifier = await import(${JSON.stringify(VERIFIER_URL)});
let rejected = false;
try {
  await verifier.verifyInstalledBootstrapSnapshot({
    activationReceipt: {
      identity: { releaseDigest: ${JSON.stringify(fixture.receiptDigest)} },
      hostActivation: { finalProjectionBinding: ${JSON.stringify(fixture.binding)} },
    },
    receiptDigest: ${JSON.stringify(fixture.receiptDigest)},
    runnerDigest: ${JSON.stringify(fixture.runnerDigest)},
  });
} catch {
  rejected = true;
}
process.stdout.write(JSON.stringify({ rejected }));
`;
  const hookSource = await readFile(HOOK_URL, "utf8");
  const loaderUrl = `data:text/javascript,${encodeURIComponent(extractHookLoaderSource(hookSource))}`;
  const loader = `
let rejected = false;
try {
  await import(${JSON.stringify(loaderUrl)});
} catch {
  rejected = true;
}
process.stdout.write(JSON.stringify({ rejected }));
`;
  for (const [descriptor, source] of [[4, verifier], [3, loader]]) {
    const result = await exactDescriptorResult({
      descriptor,
      source,
      bytes: fixture.bytes.subarray(0, -1),
      env,
      endAfterWrite: true,
    });
    assert.deepEqual(result, {
      code: 0,
      signal: null,
      stdout: JSON.stringify({ rejected: true }),
      stderr: "",
      timedOut: false,
    });
  }
});
