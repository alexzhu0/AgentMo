import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { buildPlan } from "../src/build-plan.js";
import { inventoryChildProcessCallSites } from "../src/javascript-static-analysis.js";
import { writePocWorkspace } from "../src/poc-agent.js";
import {
  runPocOpenClaw,
  runPocOpenClawDashboard,
} from "../src/poc-openclaw-runtime.js";
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

const POC_CHILD_PROCESS_SITE_INVENTORY = Object.freeze([
  Object.freeze({
    id: "poc-dashboard-browser-child",
    kind: "local-ui-child",
    implementation: "openPocDashboardUrl",
    owners: Object.freeze(["openPocDashboardUrl"]),
  }),
  Object.freeze({
    id: "poc-openclaw-command-child",
    kind: "openclaw-runtime-child",
    implementation: "executePocOpenClawCommand",
    owners: Object.freeze(["runPocOpenClaw", "runPocOpenClawDashboard"]),
  }),
  Object.freeze({
    id: "poc-openclaw-gateway-child",
    kind: "openclaw-runtime-child",
    implementation: "executePocGateway",
    owners: Object.freeze(["runPocOpenClawDashboard"]),
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

  it("classifies every production spawn and binds OpenClaw children to guarded owners", async () => {
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

    assert.deepEqual(POC_CHILD_PROCESS_SITE_INVENTORY, [
      {
        id: "poc-dashboard-browser-child",
        kind: "local-ui-child",
        implementation: "openPocDashboardUrl",
        owners: ["openPocDashboardUrl"],
      },
      {
        id: "poc-openclaw-command-child",
        kind: "openclaw-runtime-child",
        implementation: "executePocOpenClawCommand",
        owners: ["runPocOpenClaw", "runPocOpenClawDashboard"],
      },
      {
        id: "poc-openclaw-gateway-child",
        kind: "openclaw-runtime-child",
        implementation: "executePocGateway",
        owners: ["runPocOpenClawDashboard"],
      },
    ]);

    const pocSource = await readFile(path.join(REPOSITORY_ROOT, "src/poc-openclaw-runtime.js"), "utf8");
    const pocBodies = new Map([
      ["openPocDashboardUrl", sourceSlice(
        pocSource,
        "export function openPocDashboardUrl",
        "export function buildPocOpenClawCommands",
      )],
      ["runPocOpenClaw", sourceSlice(
        pocSource,
        "export async function runPocOpenClaw",
        "export async function runPocOpenClawDashboard",
      )],
      ["runPocOpenClawDashboard", sourceSlice(
        pocSource,
        "export async function runPocOpenClawDashboard",
        "function assertPocRuntimeOptions",
      )],
      ["executePocOpenClawCommand", sourceSlice(
        pocSource,
        "function executePocOpenClawCommand",
        "async function runDashboardSetupCommand",
      )],
      ["executePocGateway", sourceSlice(
        pocSource,
        "function executePocGateway",
        "async function waitForLoopbackPort",
      )],
    ]);

    const browserChild = pocBodies.get("openPocDashboardUrl");
    assert.equal(countOccurrences(browserChild, "spawn(command, args, launchOptions)"), 1);
    assert.equal(countOccurrences(browserChild, "assertCurrentOpenClawTargetRuntime"), 0);
    assertOrdered(browserChild, [
      "new URL(url)",
      "parsed.protocol !== \"http:\"",
      "const injectedSpawn = options.spawnProcess",
      "injectedSpawn == null",
      "spawn(command, args, launchOptions)",
    ]);

    const commandOwner = pocBodies.get("runPocOpenClaw");
    assert.match(commandOwner, /^export async function runPocOpenClaw\(options\) \{\n  assertCurrentOpenClawTargetRuntime\(\);/u);
    assertOrdered(commandOwner, [
      "assertCurrentOpenClawTargetRuntime();",
      "path.resolve(options.workspace)",
      "checkPocWorkspace",
      "readRuntimeEnvFile",
      "mkdir(",
      "buildPocOpenClawCommands",
      "options.runCommand",
    ]);

    const dashboardOwner = pocBodies.get("runPocOpenClawDashboard");
    assert.match(dashboardOwner, /^export async function runPocOpenClawDashboard\(options\) \{\n  assertCurrentOpenClawTargetRuntime\(\);/u);
    assertOrdered(dashboardOwner, [
      "assertCurrentOpenClawTargetRuntime();",
      "path.resolve(options.workspace)",
      "checkPocWorkspace",
      "readRuntimeEnvFile",
      "options.checkPort",
      "mkdir(",
      "options.gatewayTokenFactory",
      "buildPocDashboardCommands",
      "options.runCommand",
      "options.runGateway",
    ]);

    const commandChild = pocBodies.get("executePocOpenClawCommand");
    assert.equal(countOccurrences(commandChild, "const child = spawn("), 1);
    assert.match(commandChild, /assertCurrentOpenClawTargetRuntime\(\);\s*const child = spawn\(/u);

    const gatewayChild = pocBodies.get("executePocGateway");
    assert.equal(countOccurrences(gatewayChild, "const child = spawn("), 1);
    assert.match(gatewayChild, /assertCurrentOpenClawTargetRuntime\(\);\s*const child = spawn\(/u);

    const spawnSites = await inventoryProductionSpawnSites();
    assert.deepEqual(spawnSites, [
      { file: "src/builder-behavior-eval.js", count: 1 },
      { file: "src/builder-codex-host.js", count: 2 },
      { file: "src/builder-posix-effect.js", count: 1 },
      { file: "src/builder-probe.js", count: 1 },
      { file: "src/native-build-capture.js", count: 1 },
      { file: "src/openclaw-official-action-runner.js", count: 1 },
      { file: "src/openclaw-probe.js", count: 1 },
      { file: "src/openclaw-process-supervisor.js", count: 1 },
      { file: "src/openclaw-safe-fs.js", count: 2 },
      { file: "src/poc-openclaw-runtime.js", count: 3 },
      { file: "src/runtime-execution.js", count: 1 },
    ]);
  });

  it("fails closed when a production child-process binding hides a fourth unclassified spawn site", async () => {
    const pocSource = await readFile(path.join(REPOSITORY_ROOT, "src/poc-openclaw-runtime.js"), "utf8");
    const fourthSite = `${pocSource}\nconst spawnAgain = spawn;\nspawnAgain(process.execPath, ["--version"]);\n`;

    assert.throws(
      () => assertExactPocSpawnInventory(fourthSite),
      (error) => error?.code === "AGENTMO_CHILD_PROCESS_INVENTORY_REJECTED",
    );
  });

  it("recognizes renamed and namespace child-process imports and rejects re-aliasing", () => {
    assert.equal(countClassifiedSpawnSites(
      'import { spawn as launchChild } from "node:child_process";\nlaunchChild("node", []);\n',
    ), 1);
    assert.equal(countClassifiedSpawnSites(
      'import * as childProcess from "node:child_process";\nchildProcess.spawn("node", []);\n',
    ), 1);
    assert.equal(countClassifiedSpawnSites(
      'import { spawn as launchChild } from "child_process";\nlaunchChild("node", []);\n',
    ), 1);
    assert.throws(
      () => countClassifiedSpawnSites(
        'import { spawn } from "node:child_process";\nconst spawnAgain = spawn;\nspawnAgain("node", []);\n',
      ),
      (error) => error?.code === "AGENTMO_CHILD_PROCESS_INVENTORY_REJECTED",
    );
    for (const source of [
      'import * as childProcess from "node:child_process";\nchildProcess["spawn"]("node", []);\n',
      'const childProcess = await import("node:child_process");\nchildProcess.spawn("node", []);\n',
      'const childProcess = require("node:child_process");\nchildProcess.spawn("node", []);\n',
      'const childProcess = process.getBuiltinModule("node:child_process");\nchildProcess.spawn("node", []);\n',
      'const childProcess = await import("child_process");\nchildProcess.spawn("node", []);\n',
      'const childProcess = require("node:" + "child_process");\nchildProcess.spawn("node", []);\n',
      'const childProcess = process.getBuiltinModule(`node:${"child_process"}`);\nchildProcess.spawn("node", []);\n',
      'import { createRequire } from "node:module";\nconst load = createRequire(import.meta.url);\nconst childProcess = load("node:child_process");\nchildProcess.spawn("node", []);\n',
      'import { createRequire } from "module";\nconst load = createRequire(import.meta.url);\nconst childProcess = load("child_process");\nchildProcess.spawn("node", []);\n',
      'import moduleBuiltin from "node:module";\nconst load = moduleBuiltin.createRequire(import.meta.url);\nconst childProcess = load("node:child_process");\nchildProcess.spawn("node", []);\n',
      'const moduleBuiltin = await import("node:module");\nconst load = moduleBuiltin.createRequire(import.meta.url);\nconst childProcess = load("node:child_process");\nchildProcess.spawn("node", []);\n',
      'const moduleBuiltin = require("module");\nconst load = moduleBuiltin.createRequire(import.meta.url);\nconst childProcess = load("child_process");\nchildProcess.spawn("node", []);\n',
      'const gbm = process.getBuiltinModule;\nconst childProcess = gbm("node:child_process");\nchildProcess.spawn("node", []);\n',
      'const gbm = process.getBuiltinModule.bind(process);\nconst childProcess = gbm("node:child_process");\nchildProcess.spawn("node", []);\n',
      'import { getBuiltinModule as gbm } from "node:process";\nconst childProcess = gbm("node:child_process");\nchildProcess.spawn("node", []);\n',
      'const req = require;\nconst childProcess = req("node:child_process");\nchildProcess.spawn("node", []);\n',
      'const req = require.bind(globalThis);\nconst childProcess = req("node:child_process");\nchildProcess.spawn("node", []);\n',
      'export { createRequire } from "node:module";\n',
      'export { createRequire as loader } from "module";\n',
      'process["getBuiltinModule"]("node:child_process").spawn("node", []);\n',
      'const gbm = process["getBuiltinModule"];\nconst childProcess = gbm("node:child_process");\nchildProcess.spawn("node", []);\n',
      'process["getBuiltinModule"]("node:module")["createRequire"](import.meta.url)("node:child_process").spawn("node", []);\n',
      'process["get\\u0042uiltinModule"]("node:child_process").spawn("node", []);\n',
      'process[`getBuiltinModule`]("node:child_process").spawn("node", []);\n',
      'const capturedProcess = process;\n',
      'acceptAuthority(process);\n',
      'function exposeAuthority() { return process; }\n',
      'Reflect.get(process, "getBuiltinModule")("node:child_process").spawn("node", []);\n',
      'import * as processBuiltin from "node:process";\nprocessBuiltin.getBuiltinModule("node:child_process");\n',
      'import processBuiltin from "process";\nprocessBuiltin.getBuiltinModule("node:child_process");\n',
    ]) {
      assert.throws(
        () => countClassifiedSpawnSites(source),
        (error) => error?.code === "AGENTMO_CHILD_PROCESS_INVENTORY_REJECTED",
      );
    }
    assert.equal(countClassifiedSpawnSites([
      '// require("node:child_process")',
      'const stringDecoy = "process.getBuiltinModule";',
      'const templateDecoy = `createRequire("node:module")`;',
      'const regexDecoy = /require\\("child_process"\\)/u;',
      'const environment = process.env;',
      'const platform = process.platform;',
      '',
    ].join("\n")), 0);
  });

  it("rejects POC OpenClaw command entry before reading any hostile options property", async () => {
    const { options, trapCounts } = hostilePocOptions();
    const error = await withSimulatedCurrentNodeVersion(
      INCOMPATIBLE_CONTRACT_VERSION,
      () => captureRejectedError(() => runPocOpenClaw(options)),
    );

    assert.deepEqual(trapCounts, {
      get: 0,
      has: 0,
      ownKeys: 0,
      getOwnPropertyDescriptor: 0,
    });
    assertFixedUnsupportedRuntimeError(error, [
      "options-canary",
      "/private/options-canary",
      "sk-options-canary",
    ]);
  });

  it("rejects POC OpenClaw Dashboard entry before reading any hostile options property", async () => {
    const { options, trapCounts } = hostilePocOptions();
    const error = await withSimulatedCurrentNodeVersion(
      INCOMPATIBLE_CONTRACT_VERSION,
      () => captureRejectedError(() => runPocOpenClawDashboard(options)),
    );

    assert.deepEqual(trapCounts, {
      get: 0,
      has: 0,
      ownKeys: 0,
      getOwnPropertyDescriptor: 0,
    });
    assertFixedUnsupportedRuntimeError(error, [
      "options-canary",
      "/private/options-canary",
      "sk-options-canary",
    ]);
  });

  it("rejects POC OpenClaw commands before workspace, runtime-env, profile, credential, or runner effects", async () => {
    const { root, workspace, envFile, profileHome } = await createPocRuntimeSeamFixture(
      "agentmo-poc-command-runtime-seam-",
    );
    const effects = [];

    const error = await withSimulatedCurrentNodeVersion(
      INCOMPATIBLE_CONTRACT_VERSION,
      () => captureRejectedError(() => runPocOpenClaw({
        workspace,
        profile: "agentmo-poc-runtime-seam",
        model: "deepseek/test-model",
        message: "Return bounded test output.",
        runtimeEnvFile: envFile,
        runCommand: async () => {
          effects.push("runCommand");
          return { exitCode: 0, stdout: "{}", stderr: "" };
        },
        ...ANTI_BYPASS_OPTIONS,
      })),
    );

    assertFixedUnsupportedRuntimeError(error, [root, "test-only-provider-secret"]);
    assert.equal(Object.hasOwn(error, "pocDiagnostic"), false);
    assert.deepEqual(effects, []);
    await assertPathAbsent(profileHome);
  });

  it("rejects POC OpenClaw gateway before port, profile, token, setup, gateway, readiness, or browser effects", async () => {
    const { root, workspace, envFile, profileHome } = await createPocRuntimeSeamFixture(
      "agentmo-poc-gateway-runtime-seam-",
    );
    const effects = [];

    const error = await withSimulatedCurrentNodeVersion(
      INCOMPATIBLE_CONTRACT_VERSION,
      () => captureRejectedError(() => runPocOpenClawDashboard({
        workspace,
        profile: "agentmo-poc-dashboard-seam",
        model: "deepseek/test-model",
        runtimeEnvFile: envFile,
        port: 18889,
        checkPort: async () => { effects.push("checkPort"); return true; },
        gatewayTokenFactory: () => {
          effects.push("gatewayTokenFactory");
          return "test-only-gateway-token";
        },
        runCommand: async () => {
          effects.push("runCommand");
          return { exitCode: 0, stdout: "{}", stderr: "" };
        },
        runGateway: async () => { effects.push("runGateway"); return 0; },
        onReady: async () => { effects.push("onReady"); },
        openDashboard: async () => { effects.push("openDashboard"); },
        ...ANTI_BYPASS_OPTIONS,
      })),
    );

    assertFixedUnsupportedRuntimeError(error, [
      root,
      "test-only-provider-secret",
      "test-only-gateway-token",
    ]);
    assert.equal(Object.hasOwn(error, "pocDiagnostic"), false);
    assert.deepEqual(effects, []);
    await assertPathAbsent(profileHome);
  });

  it("keeps the ordinary POC OpenClaw final child barrier from spawning after runtime authority changes", async () => {
    const { root, workspace, envFile } = await createPocRuntimeSeamFixture(
      "agentmo-poc-command-final-barrier-",
    );
    const marker = path.join(root, "must-remain-absent.txt");
    const markerExecutable = await createMarkerExecutable(root, marker);
    const options = {
      workspace,
      profile: "agentmo-poc-command-barrier",
      model: "deepseek/test-model",
      message: "Return bounded test output.",
      runtimeEnvFile: envFile,
      executable: markerExecutable,
    };
    const restoreRuntime = switchRuntimeAtDefaultHelper(options, "runCommand");
    let error;
    try {
      error = await captureRejectedError(() => runPocOpenClaw(options));
    } finally {
      restoreRuntime();
    }

    assertFixedUnsupportedRuntimeError(error, [root, "test-only-provider-secret"]);
    await assertPathAbsent(marker);
  });

  it("keeps the POC gateway final child barrier from spawning after runtime authority changes", async () => {
    const { root, workspace, envFile } = await createPocRuntimeSeamFixture(
      "agentmo-poc-gateway-final-barrier-",
    );
    const marker = path.join(root, "must-remain-absent.txt");
    const markerExecutable = await createMarkerExecutable(root, marker);
    const effects = [];
    const options = {
      workspace,
      profile: "agentmo-poc-gateway-barrier",
      model: "deepseek/test-model",
      runtimeEnvFile: envFile,
      executable: markerExecutable,
      port: 18889,
      checkPort: async () => { effects.push("checkPort"); return true; },
      gatewayTokenFactory: () => {
        effects.push("gatewayTokenFactory");
        return "test-only-gateway-token";
      },
      runCommand: async () => {
        effects.push("runCommand");
        return { exitCode: 0, stdout: "{}", stderr: "" };
      },
      onReady: async () => { effects.push("onReady"); },
      openDashboard: async () => { effects.push("openDashboard"); },
    };
    const restoreRuntime = switchRuntimeAtDefaultHelper(options, "runGateway");
    let error;
    try {
      error = await captureRejectedError(() => runPocOpenClawDashboard(options));
    } finally {
      restoreRuntime();
    }

    assertFixedUnsupportedRuntimeError(error, [
      root,
      "test-only-provider-secret",
      "test-only-gateway-token",
    ]);
    assert.equal(effects.includes("onReady"), false);
    assert.equal(effects.includes("openDashboard"), false);
    await assertPathAbsent(marker);
  });

  it("restores the simulated runtime when final-barrier helper setup rejects hostile options", () => {
    const original = Object.getOwnPropertyDescriptor(process.versions, "node");
    const options = new Proxy(Object.create(null), {
      defineProperty() {
        throw new TypeError("hostile setup rejection");
      },
    });
    try {
      assert.throws(
        () => switchRuntimeAtDefaultHelper(options, "runCommand"),
        /hostile setup rejection/u,
      );
      assert.deepEqual(Object.getOwnPropertyDescriptor(process.versions, "node"), original);
    } finally {
      Object.defineProperty(process.versions, "node", original);
    }
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

function pocRuntimeSeed() {
  return {
    schemaVersion: "agentmo.poc-seed.v1",
    agentId: "runtime-seam-poc",
    records: [{
      id: "runtime-seam-record",
      title: "Runtime seam record",
      url: "https://example.com/runtime-seam",
      publishedAt: "2026-05-06T00:00:00.000Z",
      collectedAt: "2026-08-15T00:00:00.000Z",
      category: "runtime-seam",
      sourceType: "paper",
      trustTier: "primary",
      summary: "A bounded synthetic runtime seam record.",
    }],
  };
}

async function createPocRuntimeSeamFixture(prefix) {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  const workspace = path.join(root, "workspace");
  const envFile = path.join(root, "runtime.env");
  await writePocWorkspace(pocRuntimeSeed(), workspace);
  await writeFile(envFile, "DEEPSEEK_API_KEY=test-only-provider-secret\n", "utf8");
  return Object.freeze({
    root,
    workspace,
    envFile,
    profileHome: path.join(workspace, ".agentmo-poc-home"),
  });
}

function hostilePocOptions() {
  const trapCounts = {
    get: 0,
    has: 0,
    ownKeys: 0,
    getOwnPropertyDescriptor: 0,
  };
  const fail = (trap) => {
    trapCounts[trap] += 1;
    throw new Error("options-canary /private/options-canary sk-options-canary123456");
  };
  const options = new Proxy(Object.create(null), {
    get: () => fail("get"),
    has: () => fail("has"),
    ownKeys: () => fail("ownKeys"),
    getOwnPropertyDescriptor: () => fail("getOwnPropertyDescriptor"),
  });
  return Object.freeze({ options, trapCounts });
}

async function captureRejectedError(operation) {
  let caught;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  assert.notEqual(caught, undefined, "operation must reject");
  return caught;
}

function assertFixedUnsupportedRuntimeError(error, forbidden = []) {
  assert.equal(error?.code, "AGENTMO_OPENCLAW_RUNTIME_UNSUPPORTED");
  assert.equal(error?.message, "Current process does not satisfy the OpenClaw target runtime range.");
  const rendered = `${error?.name}:${error?.message}:${error?.code}:${JSON.stringify(error)}`;
  assert.equal(rendered.includes(INCOMPATIBLE_CONTRACT_VERSION), false);
  for (const canary of forbidden) assert.equal(rendered.includes(canary), false, canary);
}

async function createMarkerExecutable(root, marker) {
  const markerExecutable = path.join(root, "marker-child");
  await writeFile(
    markerExecutable,
    `#!/bin/sh\nprintf '%s' spawned > ${JSON.stringify(marker)}\n`,
    { encoding: "utf8", mode: 0o700 },
  );
  await chmod(markerExecutable, 0o700);
  return markerExecutable;
}

function switchRuntimeAtDefaultHelper(options, property) {
  const original = Object.getOwnPropertyDescriptor(process.versions, "node");
  assert.equal(original?.configurable, true, SIMULATION_NOTICE);
  try {
    Object.defineProperty(process.versions, "node", { ...original, value: "24.0.0" });
    Object.defineProperty(options, property, {
      configurable: true,
      enumerable: false,
      get() {
        Object.defineProperty(process.versions, "node", {
          ...original,
          value: INCOMPATIBLE_CONTRACT_VERSION,
        });
        return undefined;
      },
    });
  } catch (error) {
    Object.defineProperty(process.versions, "node", original);
    throw error;
  }
  return () => Object.defineProperty(process.versions, "node", original);
}

async function inventoryProductionSpawnSites() {
  const spawnSites = [];
  for (const fileUrl of await listJavaScriptFiles(SOURCE_ROOT)) {
    const source = await readFile(fileUrl, "utf8");
    const count = countClassifiedSpawnSites(source);
    if (count > 0) {
      spawnSites.push({
        file: path.relative(REPOSITORY_ROOT, fileURLToPath(fileUrl)),
        count,
      });
    }
  }
  return spawnSites;
}

function assertExactPocSpawnInventory(source) {
  const count = countClassifiedSpawnSites(source);
  if (count !== POC_CHILD_PROCESS_SITE_INVENTORY.length) rejectChildProcessInventory();
}

function countClassifiedSpawnSites(source) {
  try {
    return inventoryChildProcessCallSites(source, {
      file: "production-child-process-inventory.js",
    }).filter(({ method }) => method === "spawn").length;
  } catch {
    rejectChildProcessInventory();
  }
}

function rejectChildProcessInventory() {
  const error = new Error("Production child-process inventory is incomplete.");
  error.code = "AGENTMO_CHILD_PROCESS_INVENTORY_REJECTED";
  throw error;
}

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
