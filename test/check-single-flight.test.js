import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

test("admits one main check and rejects a concurrent duplicate until the first exits", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentmo-check-single-flight-test-"));
  const lockPath = path.join(root, "main-check.lock");
  let runExclusiveCheck = null;
  try {
    ({ runExclusiveCheck } = await import("../scripts/check-single-flight.js"));
  } catch {
    // RED: the production single-flight boundary does not exist yet.
  }
  assert.equal(typeof runExclusiveCheck, "function");

  let releaseFirst;
  const firstSettled = new Promise((resolve) => { releaseFirst = resolve; });
  let firstStarted;
  const firstReady = new Promise((resolve) => { firstStarted = resolve; });
  const first = runExclusiveCheck(async () => {
    firstStarted();
    await firstSettled;
    return 17;
  }, { lockPath });
  await firstReady;

  await assert.rejects(
    runExclusiveCheck(async () => 99, { lockPath }),
    (error) => error?.code === "AGENTMO_CHECK_ALREADY_RUNNING",
  );

  releaseFirst();
  assert.equal(await first, 17);
  assert.equal(await runExclusiveCheck(async () => 23, { lockPath }), 23);
});
