import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { buildPlan } from "../src/build-plan.js";
import { buildRunEval, executeRuntimeRun, replayRunState } from "../src/run-state.js";
import { buildRuntimePlan } from "../src/runtime-plan.js";
import { runRuntimeCommand } from "../src/runtime-execution.js";
import { scaffoldAgent } from "../src/scaffold.js";
import {
  NODE20_LANE_MARKER,
} from "../scripts/node20-core-receipt.js";
import { admitBlueprint } from "./helpers/admitted-blueprint.js";
import {
  admitRunStateValue,
  buildAndAdmitRuntimePlan,
} from "./helpers/admitted-runtime.js";

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE_ROOT = new URL("../src/", import.meta.url);
const NODE20_RUNNER = path.join(REPOSITORY_ROOT, "scripts/node20-core-lane.sh");
const NODE20_HELPER = path.join(REPOSITORY_ROOT, "scripts/node20-core-receipt.js");
const INCOMPATIBLE_CONTRACT_VERSION = "20.19.0";
const SIMULATION_NOTICE = "Current-process version simulation is contract evidence only; the real Node 20 execution row remains untested.";
const ANTI_BYPASS_OPTIONS = Object.freeze({
  runtimeVersion: "24.0.0",
  nodeVersion: "24.0.0",
  versionProvider: () => "24.0.0",
  runtimeCompatibilityProvider: () => true,
  skipRuntimeCheck: true,
  bypassRuntimeCheck: true,
  runtimeOverride: "supported",
});

const JAVASCRIPT_MUTATION_INVENTORY = Object.freeze([
  Object.freeze({
    id: "openclaw-scaffold",
    kind: "mutation-journey",
    file: "src/scaffold.js",
    start: "export async function scaffoldAgent",
    end: "function preflightScaffoldOperations",
  }),
  Object.freeze({
    id: "openclaw-live-run",
    kind: "mutation-journey",
    file: "src/run-state.js",
    start: "export async function executeRuntimeRun",
    end: "export async function writeRunState",
  }),
  Object.freeze({
    id: "openclaw-live-replay",
    kind: "mutation-journey",
    file: "src/run-state.js",
    start: "export async function replayRunState",
    end: "function buildRunState",
  }),
  Object.freeze({
    id: "final-javascript-spawn",
    kind: "spawn-barrier",
    file: "src/runtime-execution.js",
    start: "export async function runRuntimeCommand",
    end: "function terminateRuntimeChild",
  }),
]);

describe("OpenClaw runtime compatibility seams", () => {
  it("binds the Node 20 core lane to one strict actual-runtime runner", async () => {
    const packageJson = JSON.parse(await readFile(path.join(REPOSITORY_ROOT, "package.json"), "utf8"));
    assert.equal(packageJson.scripts["check:core:node20"], "bash scripts/node20-core-lane.sh");

    const runnerSource = await readFile(NODE20_RUNNER, "utf8");
    const helperSource = await readFile(NODE20_HELPER, "utf8");
    assert.equal(NODE20_LANE_MARKER, "agentmo-node20-core-v2");
    assert.match(runnerSource, /"\$NODE_BIN" "\$HELPER"/u);
    for (const flag of [
      "--node-bin",
      "--archive",
      "--checksums",
      "--expected-version",
      "--expected-arch",
      "--receipt",
    ]) assert.match(runnerSource, new RegExp(flag, "u"));
    assert.doesNotMatch(runnerSource, /\b(?:command -v|NODE20_BIN|curl|wget|npx|brew|apt|mock|Object\.defineProperty)\b/iu);
    assert.doesNotMatch(runnerSource, /npm\s+(?:install|add|exec)\b/iu);

    for (const token of [
      "assertSelectedProcessIdentity",
      "verifyDistributionProvenance",
      "validateTapBatch",
      "COMMAND_SET_DIGEST",
      "writePersistableJsonAtomic",
    ]) assert.match(helperSource, new RegExp(token, "u"));
    assert.match(helperSource, /realpath\(process\.execPath\)/u);
    assert.match(helperSource, /process\.versions\.node/u);
    assert.match(helperSource, /process\.arch/u);
  });

  it("labels incompatible current-process simulation as contract-only evidence", () => {
    assert.match(SIMULATION_NOTICE, /contract evidence only/u);
    assert.match(SIMULATION_NOTICE, /real Node 20 execution row remains untested/u);
    assert.equal(INCOMPATIBLE_CONTRACT_VERSION.startsWith("20."), true);
  });

  it("closes exactly three OpenClaw mutation journeys and inventories every production spawn", async () => {
    assert.deepEqual(
      JAVASCRIPT_MUTATION_INVENTORY.map(({ id, kind }) => ({ id, kind })),
      [
        { id: "openclaw-scaffold", kind: "mutation-journey" },
        { id: "openclaw-live-run", kind: "mutation-journey" },
        { id: "openclaw-live-replay", kind: "mutation-journey" },
        { id: "final-javascript-spawn", kind: "spawn-barrier" },
      ],
    );

    const bodies = new Map();
    for (const seam of JAVASCRIPT_MUTATION_INVENTORY) {
      const source = await readFile(path.join(REPOSITORY_ROOT, seam.file), "utf8");
      const body = sourceSlice(source, seam.start, seam.end);
      bodies.set(seam.id, body);
      assert.equal(countOccurrences(body, "assertCurrentOpenClawTargetRuntime();"), 1, seam.id);
      assert.doesNotMatch(body, /(?:runtimeVersion|nodeVersion|versionProvider|runtimeCompatibilityProvider|skipRuntimeCheck|bypassRuntimeCheck|runtimeOverride)/u);
    }

    const scaffold = bodies.get("openclaw-scaffold");
    assert.match(scaffold, /if \(plan\.selectedTargetId === "openclaw"\)[\s\S]*?assertCurrentOpenClawTargetRuntime\(\);/u);
    assertOrdered(scaffold, [
      "const plan = buildPlan",
      "assertCurrentOpenClawTargetRuntime();",
      "createBuildState",
      "preflightScaffoldOperations",
      "assertTargetWritable",
      "writePersistableProductTextAtomic",
    ]);

    const liveRun = bodies.get("openclaw-live-run");
    assert.match(liveRun, /if \(options\.live\)[\s\S]*?assertCurrentOpenClawTargetRuntime\(\);/u);
    assertOrdered(liveRun, [
      "assertCurrentOpenClawTargetRuntime();",
      "resolveRuntimeEnv",
      "preflightRunIndexForWrite",
      "runner(",
      "writeRunState",
    ]);

    const liveReplay = bodies.get("openclaw-live-replay");
    assert.match(liveReplay, /if \(options\.live\)[\s\S]*?assertCurrentOpenClawTargetRuntime\(\);/u);
    assertOrdered(liveReplay, [
      "assertCurrentOpenClawTargetRuntime();",
      "preflightRunIndexForWrite",
      "resolveRuntimeEnv",
      "runner(",
      "writeRunState",
    ]);

    const finalSpawn = bodies.get("final-javascript-spawn");
    assert.match(finalSpawn, /assertCurrentOpenClawTargetRuntime\(\);\s*const child = spawn\(/u);
    assertOrdered(finalSpawn, ["assertCurrentOpenClawTargetRuntime();", "spawn("]);

    const builderPosixEffect = await readFile(
      path.join(REPOSITORY_ROOT, "src", "builder-posix-effect.js"),
      "utf8",
    );
    const builderSpawn = sourceSlice(
      builderPosixEffect,
      "export async function runBuilderPosixEffect",
      "function normalizeEffectRequest",
    );
    assertOrdered(builderSpawn, ["assertBuilderPlatform();", "spawn("]);

    const spawnSites = [];
    for (const fileUrl of await listJavaScriptFiles(SOURCE_ROOT)) {
      const source = await readFile(fileUrl, "utf8");
      // Package admission validates the hook separately. Here inventory only
      // real source-level named child_process imports, not quoted fixture text.
      const importsSpawn = /import\s*\{[^}]*\bspawn\b[^}]*\}\s*from\s*["']node:child_process["']/u.test(source);
      const count = importsSpawn ? [...source.matchAll(/\bspawn\s*\(/gu)].length : 0;
      if (count > 0) {
        spawnSites.push({
          file: path.relative(REPOSITORY_ROOT, fileURLToPath(fileUrl)),
          count,
        });
      }
    }
    assert.deepEqual(spawnSites, [
      { file: "src/builder-behavior-eval.js", count: 1 },
      { file: "src/builder-codex-host.js", count: 2 },
      { file: "src/builder-posix-effect.js", count: 1 },
      { file: "src/builder-probe.js", count: 1 },
      { file: "src/runtime-execution.js", count: 1 },
    ]);
  });

  it("keeps OpenClaw scaffold rejection ahead of build-state and filesystem publication", async () => {
    const admission = await admitBlueprint(new URL("../examples/win9.agentmo.json", import.meta.url));
    const parent = await mkdtemp(path.join(tmpdir(), "agentmo-runtime-scaffold-seam-"));
    const outputRoot = path.join(parent, "must-remain-absent");

    await withSimulatedCurrentNodeVersion(INCOMPATIBLE_CONTRACT_VERSION, async () => {
      await assertUnsupportedCurrentRuntime(() => scaffoldAgent(admission.value, outputRoot, {
        admission,
        target: "openclaw",
        ...ANTI_BYPASS_OPTIONS,
      }));
    });

    await assertPathAbsent(outputRoot);
  });

  it("keeps live run rejection ahead of runtime-env, index, runner, and output effects", async () => {
    const admission = await admitBlueprint(new URL("../examples/win9.agentmo.json", import.meta.url));
    const prepared = await buildAndAdmitRuntimePlan(admission.value, {
      target: "openclaw",
      workspace: "/tmp/agentmo-runtime-seam-workspace",
      openClawStateDir: "/tmp/agentmo-runtime-seam-state",
      message: "Say exactly: ok",
    });
    const parent = await mkdtemp(path.join(tmpdir(), "agentmo-runtime-run-seam-"));
    const outputRoot = path.join(parent, "must-remain-absent");
    const effects = [];

    await withSimulatedCurrentNodeVersion(INCOMPATIBLE_CONTRACT_VERSION, async () => {
      await assertUnsupportedCurrentRuntime(() => executeRuntimeRun(
        prepared.runtimePlan,
        {
          admission: prepared.runtimePlanAdmission,
          live: true,
          workspace: "/tmp/agentmo-runtime-seam-workspace",
          openClawStateDir: "/tmp/agentmo-runtime-seam-state",
          message: "Say exactly: ok",
          out: outputRoot,
          runId: "incompatible-live-run",
          now: "2026-07-13T00:00:00.000Z",
          ...ANTI_BYPASS_OPTIONS,
        },
        async () => {
          effects.push("runner");
          return { exitCode: 0, stdout: "", stderr: "", timedOut: false, durationMs: 1 };
        },
      ));
    });

    assert.deepEqual(effects, []);
    await assertPathAbsent(outputRoot);
  });

  it("keeps live replay rejection ahead of index, runtime-env, runner, and output effects", async () => {
    const admission = await admitBlueprint(new URL("../examples/win9.agentmo.json", import.meta.url));
    const prepared = await buildAndAdmitRuntimePlan(admission.value, {
      target: "openclaw",
      workspace: "/tmp/agentmo-replay-seam-workspace",
      openClawStateDir: "/tmp/agentmo-replay-seam-state",
      message: "Say exactly: ok",
    });
    const parentRun = await executeRuntimeRun(prepared.runtimePlan, {
      admission: prepared.runtimePlanAdmission,
      workspace: "/tmp/agentmo-replay-seam-workspace",
      openClawStateDir: "/tmp/agentmo-replay-seam-state",
      message: "Say exactly: ok",
      runId: "replay-seam-parent",
      now: "2026-07-13T00:00:00.000Z",
    });
    const parentAdmission = await admitRunStateValue(parentRun.runState);
    const parent = await mkdtemp(path.join(tmpdir(), "agentmo-runtime-replay-seam-"));
    const outputRoot = path.join(parent, "must-remain-absent");
    const effects = [];

    await withSimulatedCurrentNodeVersion(INCOMPATIBLE_CONTRACT_VERSION, async () => {
      await assertUnsupportedCurrentRuntime(() => replayRunState(
        parentAdmission.value,
        {
          admission: parentAdmission,
          live: true,
          workspace: "/tmp/agentmo-replay-seam-workspace",
          openClawStateDir: "/tmp/agentmo-replay-seam-state",
          message: "Say exactly: ok",
          out: outputRoot,
          runId: "incompatible-live-replay",
          now: "2026-07-13T00:01:00.000Z",
          ...ANTI_BYPASS_OPTIONS,
        },
        async () => {
          effects.push("runner");
          return { exitCode: 0, stdout: "", stderr: "", timedOut: false, durationMs: 1 };
        },
      ));
    });

    assert.deepEqual(effects, []);
    await assertPathAbsent(outputRoot);
  });

  it("keeps the final runtime adapter from spawning a marker child on rejection", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "agentmo-runtime-spawn-seam-"));
    const marker = path.join(directory, "must-remain-absent.txt");

    await withSimulatedCurrentNodeVersion(INCOMPATIBLE_CONTRACT_VERSION, async () => {
      await assertUnsupportedCurrentRuntime(() => runRuntimeCommand(
        {
          executable: process.execPath,
          args: ["-e", "require('node:fs').writeFileSync(process.argv[1], 'spawned')", marker],
          timeoutMs: 5000,
        },
        { sandboxScope: { usesProductionState: false } },
        ANTI_BYPASS_OPTIONS,
      ));
    });

    await assertPathAbsent(marker);
  });

  it("keeps AgentMo scaffold and non-live/non-mutating core work callable under the core floor", async () => {
    const admission = await admitBlueprint(new URL("../examples/win9.agentmo.json", import.meta.url));
    const prepared = await buildAndAdmitRuntimePlan(admission.value, {
      target: "openclaw",
      workspace: "/tmp/agentmo-core-floor-workspace",
      openClawStateDir: "/tmp/agentmo-core-floor-state",
      message: "Say exactly: ok",
    });
    const parentRun = await executeRuntimeRun(prepared.runtimePlan, {
      admission: prepared.runtimePlanAdmission,
      workspace: "/tmp/agentmo-core-floor-workspace",
      openClawStateDir: "/tmp/agentmo-core-floor-state",
      message: "Say exactly: ok",
      runId: "core-floor-parent",
      now: "2026-07-13T00:00:00.000Z",
    });
    const parentAdmission = await admitRunStateValue(parentRun.runState);
    const parent = await mkdtemp(path.join(tmpdir(), "agentmo-core-floor-"));
    const agentMoRoot = path.join(parent, "agentmo-target");

    await withSimulatedCurrentNodeVersion(INCOMPATIBLE_CONTRACT_VERSION, async () => {
      const dryPlan = buildPlan(admission.value, { target: "openclaw" });
      assert.equal(dryPlan.selectedTargetId, "openclaw");

      const runtimePlan = await buildRuntimePlan(admission.value, {
        admission,
        target: "openclaw",
        workspace: "/tmp/agentmo-core-floor-workspace",
        message: "Say exactly: ok",
      });
      assert.equal(runtimePlan.schemaVersion, "agentmo.runtime-plan.v1");

      const scaffold = await scaffoldAgent(admission.value, agentMoRoot, { admission, target: "agentmo" });
      assert.equal(scaffold.target, "agentmo");

      const declared = await executeRuntimeRun(prepared.runtimePlan, {
        admission: prepared.runtimePlanAdmission,
        workspace: "/tmp/agentmo-core-floor-workspace",
        openClawStateDir: "/tmp/agentmo-core-floor-state",
        message: "Say exactly: ok",
        runId: "core-floor-declared",
        now: "2026-07-13T00:01:00.000Z",
      });
      assert.equal(declared.runState.execution.status, "declared");
      assert.equal(buildRunEval(declared.runState, { expectStatus: "declared" }).ok, true);

      const replay = await replayRunState(parentAdmission.value, {
        admission: parentAdmission,
        message: "Say exactly: ok",
        runId: "core-floor-replay",
        now: "2026-07-13T00:02:00.000Z",
      });
      assert.equal(replay.runState.execution.status, "declared");
    });

    assert.equal((await stat(agentMoRoot)).isDirectory(), true);

    for (const relativePath of [
      "src/build-plan.js",
      "src/runtime-plan.js",
      "src/report.js",
      "src/domain-eval.js",
      "src/observation.js",
      "src/run-observation.js",
    ]) {
      const source = await readFile(path.join(REPOSITORY_ROOT, relativePath), "utf8");
      assert.doesNotMatch(source, /assertCurrentOpenClawTargetRuntime/u, relativePath);
    }
  });

});

async function withSimulatedCurrentNodeVersion(version, operation) {
  const original = Object.getOwnPropertyDescriptor(process.versions, "node");
  assert.equal(original?.configurable, true, SIMULATION_NOTICE);
  Object.defineProperty(process.versions, "node", { ...original, value: version });
  try {
    return await operation();
  } finally {
    Object.defineProperty(process.versions, "node", original);
  }
}

async function assertUnsupportedCurrentRuntime(operation) {
  await assert.rejects(
    operation,
    (error) => {
      assert.equal(error?.code, "AGENTMO_OPENCLAW_RUNTIME_UNSUPPORTED");
      assert.equal(error?.message, "Current process does not satisfy the OpenClaw target runtime range.");
      assert.equal(JSON.stringify(error).includes(INCOMPATIBLE_CONTRACT_VERSION), false);
      return true;
    },
  );
}

async function assertPathAbsent(candidate) {
  await assert.rejects(() => stat(candidate), (error) => error?.code === "ENOENT");
}

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, startMarker);
  assert.notEqual(end, -1, endMarker);
  return source.slice(start, end);
}

function countOccurrences(source, needle) {
  return source.split(needle).length - 1;
}

function assertOrdered(source, markers) {
  let previous = -1;
  for (const marker of markers) {
    const current = source.indexOf(marker, previous + 1);
    assert.notEqual(current, -1, `missing ordering marker: ${marker}`);
    assert.equal(current > previous, true, `out-of-order marker: ${marker}`);
    previous = current;
  }
}

async function listJavaScriptFiles(directoryUrl) {
  const files = [];
  for (const entry of await readdir(directoryUrl, { withFileTypes: true })) {
    const child = new URL(entry.name, directoryUrl);
    if (entry.isDirectory()) files.push(...await listJavaScriptFiles(new URL(`${entry.name}/`, directoryUrl)));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(child);
  }
  return files.sort((left, right) => fileURLToPath(left).localeCompare(fileURLToPath(right)));
}
