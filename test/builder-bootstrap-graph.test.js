import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

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

async function rejectsOversizedOpenDescriptor({ descriptor, source }) {
  const child = spawn(process.execPath, ["--input-type=module", "--eval", source], {
    env: {
      AGENTMO_BUILDER_HOOK_BOOTSTRAP_MODE: "authenticated-graph-v1",
      AGENTMO_BUILDER_HOOK_GRAPH_DIGEST: `sha256:${"a".repeat(64)}`,
      AGENTMO_BUILDER_HOOK_RUNNER_DIGEST: `sha256:${"a".repeat(64)}`,
      LANG: "C",
      LC_ALL: "C",
    },
    stdio: ["ignore", "pipe", "pipe", descriptor === 3 ? "pipe" : "ignore", descriptor === 4 ? "pipe" : "ignore"],
  });
  let stdout = "";
  let stderr = "";
  let cleanupSignal = null;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const writer = child.stdio[descriptor];
  writer.on("error", () => {});
  const closePromise = new Promise((resolve) => {
    child.once("error", (error) => resolve({ error, result: null }));
    child.once("close", (code, signal) => resolve({ error: null, result: { code, signal } }));
  });
  let writerEndedWhenSubmitted;
  const writePromise = new Promise((resolve) => {
    writer.write(Buffer.alloc(MAX_BOOTSTRAP_GRAPH_BYTES + 1), (error) => {
      resolve({ error: error ?? null, completed: error === undefined || error === null });
    });
    writerEndedWhenSubmitted = writer.writableEnded;
  });
  let deadlineTimer;
  const deadlinePromise = new Promise((resolve) => {
    deadlineTimer = setTimeout(() => resolve(null), 3_000);
  });
  const completionPromise = Promise.all([writePromise, closePromise]);
  let completion;
  try {
    completion = await Promise.race([completionPromise, deadlinePromise]);
  } finally {
    clearTimeout(deadlineTimer);
    if (completion === null) {
      writer.destroy();
      let closed = await settlesWithin(closePromise, 250);
      if (!closed) {
        cleanupSignal = "SIGKILL";
        child.kill(cleanupSignal);
        closed = await settlesWithin(closePromise, 500);
      }
      assert.equal(closed, true, `fd ${descriptor} child did not settle after bounded cleanup`);
    } else {
      writer.destroy();
    }
  }
  assert.notEqual(completion, null, `fd ${descriptor} rejection exceeded the shared deadline`);
  const [write, close] = completion;
  assert.equal(write.error, null);
  assert.equal(write.completed, true);
  assert.equal(writerEndedWhenSubmitted, false);
  assert.equal(cleanupSignal, null, `fd ${descriptor} rejection waited for peer EOF`);
  assert.equal(close.error, null);
  assert.deepEqual(close.result, { code: 0, signal: null });
  assert.equal(stderr, "");
  assert.deepEqual(JSON.parse(stdout), { rejected: true, descriptorRetained: true });
}

async function settlesWithin(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test("bootstrap graph admission rejects an oversized inherited descriptor", async () => {
  const digest = `sha256:${"a".repeat(64)}`;
  const verifierSource = `
import { fstatSync } from "node:fs";
const verifier = await import(${JSON.stringify(VERIFIER_URL)});
const binding = {
  releaseDigest: ${JSON.stringify(digest)},
  members: [
    { kind: "root", relativePath: "" },
    { kind: "file", relativePath: "placeholder" },
  ],
};
let rejected = false;
try {
  await verifier.verifyInstalledBootstrapSnapshot({
    activationReceipt: {
      identity: { releaseDigest: ${JSON.stringify(digest)} },
      hostActivation: { finalProjectionBinding: binding },
    },
    receiptDigest: ${JSON.stringify(digest)},
    runnerDigest: ${JSON.stringify(digest)},
  });
} catch {
  rejected = true;
}
let descriptorRetained = false;
try {
  fstatSync(4);
  descriptorRetained = true;
} catch {}
process.stdout.write(JSON.stringify({ rejected, descriptorRetained }));
`;
  const hookSource = await readFile(HOOK_URL, "utf8");
  const loaderUrl = `data:text/javascript,${encodeURIComponent(extractHookLoaderSource(hookSource))}`;
  const loaderSource = `
import { fstatSync } from "node:fs";
let rejected = false;
try {
  await import(${JSON.stringify(loaderUrl)});
} catch {
  rejected = true;
}
let descriptorRetained = false;
try {
  fstatSync(3);
  descriptorRetained = true;
} catch {}
process.stdout.write(JSON.stringify({ rejected, descriptorRetained }));
`;

  await rejectsOversizedOpenDescriptor({ descriptor: 4, source: verifierSource });
  await rejectsOversizedOpenDescriptor({ descriptor: 3, source: loaderSource });
});
