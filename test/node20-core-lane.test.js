import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { executeRuntimeRun, replayRunState } from "../src/run-state.js";
import { runRuntimeCommand } from "../src/runtime-execution.js";
import { scaffoldAgent } from "../src/scaffold.js";
import { admitBlueprint } from "./helpers/admitted-blueprint.js";
import {
  admitRunStateValue,
  buildAndAdmitRuntimePlan,
} from "./helpers/admitted-runtime.js";

const LANE_MARKER = "agentmo-node20-core-v2";
const LANE_ACTIVE = process.env.AGENTMO_NODE20_CORE_LANE === LANE_MARKER;

describe("actual Node 20 core lane", { skip: !LANE_ACTIVE }, () => {
  it("is activated only by the fixed marker under an actual Node 20 executable", () => {
    assert.equal(process.env.AGENTMO_NODE20_CORE_LANE, LANE_MARKER);
    assert.match(process.versions.node, /^20\.[0-9]+\.[0-9]+$/u);
    assert.equal(Number(process.versions.node.split(".")[0]), 20);
    assert.equal(process.version, `v${process.versions.node}`);
    assert.equal(process.env.AGENTMO_NODE20_EXPECTED_VERSION, process.versions.node);
    assert.equal(process.env.AGENTMO_NODE20_EXPECTED_ARCH, process.arch);
    assert.match(process.env.AGENTMO_NODE20_EXECUTABLE_SHA256 ?? "", /^[a-f0-9]{64}$/u);
    assert.match(process.env.AGENTMO_NODE20_COMMAND_SET_DIGEST ?? "", /^[a-f0-9]{64}$/u);
    assert.equal(process.env.AGENTMO_NODE20_PROCESS_EXECUTABLE_MATCH, "true");
  });

  it("rejects every OpenClaw mutation seam before outputs, recorders, or child effects", async () => {
    const admission = await admitBlueprint(new URL("../examples/win9.agentmo.json", import.meta.url));
    const prepared = await buildAndAdmitRuntimePlan(admission.value, {
      target: "openclaw",
      workspace: "/tmp/agentmo-node20-lane-workspace",
      openClawStateDir: "/tmp/agentmo-node20-lane-state",
      message: "Say exactly: ok",
    });
    const parentRun = await executeRuntimeRun(prepared.runtimePlan, {
      admission: prepared.runtimePlanAdmission,
      workspace: "/tmp/agentmo-node20-lane-workspace",
      openClawStateDir: "/tmp/agentmo-node20-lane-state",
      message: "Say exactly: ok",
      runId: "node20-lane-parent",
      now: "2026-07-13T00:00:00.000Z",
    });
    const parentAdmission = await admitRunStateValue(parentRun.runState);
    const parent = await mkdtemp(path.join(tmpdir(), "agentmo-node20-core-lane-"));
    const scaffoldRoot = path.join(parent, "scaffold-must-remain-absent");
    const runRoot = path.join(parent, "run-must-remain-absent");
    const replayRoot = path.join(parent, "replay-must-remain-absent");
    const childMarker = path.join(parent, "child-must-remain-absent.txt");
    const effects = [];

    await assertUnsupported(() => scaffoldAgent(admission.value, scaffoldRoot, {
      admission,
      target: "openclaw",
    }));
    await assertUnsupported(() => executeRuntimeRun(
      prepared.runtimePlan,
      {
        admission: prepared.runtimePlanAdmission,
        live: true,
        workspace: "/tmp/agentmo-node20-lane-workspace",
        openClawStateDir: "/tmp/agentmo-node20-lane-state",
        message: "Say exactly: ok",
        out: runRoot,
        runId: "node20-lane-live-run",
        now: "2026-07-13T00:01:00.000Z",
      },
      async () => {
        effects.push("live-runner");
        return { exitCode: 0, stdout: "", stderr: "", timedOut: false, durationMs: 1 };
      },
    ));
    await assertUnsupported(() => replayRunState(
      parentAdmission.value,
      {
        admission: parentAdmission,
        live: true,
        workspace: "/tmp/agentmo-node20-lane-workspace",
        openClawStateDir: "/tmp/agentmo-node20-lane-state",
        message: "Say exactly: ok",
        out: replayRoot,
        runId: "node20-lane-live-replay",
        now: "2026-07-13T00:02:00.000Z",
      },
      async () => {
        effects.push("replay-runner");
        return { exitCode: 0, stdout: "", stderr: "", timedOut: false, durationMs: 1 };
      },
    ));
    await assertUnsupported(() => runRuntimeCommand(
      {
        executable: process.execPath,
        args: ["-e", "require('node:fs').writeFileSync(process.argv[1], 'spawned')", childMarker],
        timeoutMs: 5000,
      },
      { sandboxScope: { usesProductionState: false } },
    ));

    assert.deepEqual(effects, []);
    await Promise.all([
      assertPathAbsent(scaffoldRoot),
      assertPathAbsent(runRoot),
      assertPathAbsent(replayRoot),
      assertPathAbsent(childMarker),
    ]);
  });
});

async function assertUnsupported(operation) {
  await assert.rejects(operation, (error) => {
    assert.equal(error?.code, "AGENTMO_OPENCLAW_RUNTIME_UNSUPPORTED");
    assert.equal(error?.message, "Current process does not satisfy the OpenClaw target runtime range.");
    return true;
  });
}

async function assertPathAbsent(candidate) {
  await assert.rejects(() => stat(candidate), (error) => error?.code === "ENOENT");
}
