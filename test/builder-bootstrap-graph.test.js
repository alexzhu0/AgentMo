import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const VERIFIER_URL = pathToFileURL(path.resolve(
  "src",
  "builder-bootstrap-snapshot.js",
)).href;

test("bootstrap graph admission rejects an oversized inherited descriptor", async () => {
  const digest = `sha256:${"a".repeat(64)}`;
  const source = `
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
process.stdout.write(JSON.stringify({ rejected }));
`;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", source], {
    env: {
      AGENTMO_BUILDER_HOOK_BOOTSTRAP_MODE: "authenticated-graph-v1",
      AGENTMO_BUILDER_HOOK_GRAPH_DIGEST: digest,
      AGENTMO_BUILDER_HOOK_RUNNER_DIGEST: digest,
      LANG: "C",
      LC_ALL: "C",
    },
    stdio: ["ignore", "pipe", "pipe", "ignore", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdio[4].on("error", () => {});
  child.stdio[4].end(Buffer.alloc(24 * 1024 * 1024 + 1));
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  assert.deepEqual(result, { code: 0, signal: null });
  assert.equal(stderr, "");
  assert.deepEqual(JSON.parse(stdout), { rejected: true });
});
