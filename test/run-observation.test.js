import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { digestRawBytes } from "../src/artifact-admission.js";
import {
  buildObservationReport,
  loadObservationRecord,
  validateObservationRecord,
} from "../src/observation.js";
import { buildRunObservation, writeRunObservation } from "../src/run-observation.js";
import { RUN_STATE_FILENAME } from "../src/run-state.js";
import {
  admitRunStateValue,
  executeAdmittedRuntimeRun,
  loadAdmittedRunStateFile,
} from "./helpers/admitted-runtime.js";

const PRIVATE_MESSAGE = "fixture-private-observation-message";
const PRIVATE_OUTPUT = "fixture-private-observation-output";
const PRIVATE_PATH = "/Users/synthetic-agentmo/private-observation.txt";
const PRIVATE_SECRET = "sk-syntheticobservationcanary123456789";

async function loadExample() {
  return JSON.parse(await readFile(new URL("../examples/win9.agentmo.json", import.meta.url), "utf8"));
}

async function failedAdmittedRun() {
  const blueprint = await loadExample();
  const { runState } = await executeAdmittedRuntimeRun(
    blueprint,
    {
      target: "openclaw",
      workspace: "/tmp/workspace",
      openClawStateDir: "/tmp/openclaw-state",
      message: PRIVATE_MESSAGE,
      live: true,
      runId: "failed-run",
      now: "2026-07-03T00:00:00.000Z",
    },
    async () => ({ exitCode: 2, stdout: "", stderr: PRIVATE_OUTPUT, timedOut: false, durationMs: 4 }),
  );
  return admitRunStateValue(runState);
}

describe("run observation proposals", () => {
  it("derives proposal-only evidence from an authentic admitted run-state", async () => {
    const admission = await failedAdmittedRun();
    const observation = buildRunObservation(admission.value, { admission });
    const validation = validateObservationRecord(observation);
    const report = buildObservationReport(observation);
    const serialized = JSON.stringify(observation);

    assert.equal(validation.ok, true, validation.errors.join("\n"));
    assert.equal(observation.schemaVersion, "agentmo.observation.v1");
    assert.deepEqual(observation.source, {
      identity: "agentmo.run.v1",
      subject: "run-state",
      digest: admission.digest,
    });
    assert.equal(observation.failureMode, "openclaw runtime execution failed with exit code 2");
    assert.equal(observation.runEvidence.executionStatus, "failure");
    assert.equal(observation.runEvidence.certificationBoundary.runtimeCertifiedByRun, false);
    assert.equal(observation.mutation.autoApplied, false);
    assert.equal(report.recommendedBlueprintChange.proposalOnly, true);
    assert.equal(report.mutation.autoApplied, false);
    for (const forbidden of [PRIVATE_MESSAGE, PRIVATE_OUTPUT, "/tmp/workspace", "/tmp/openclaw-state"]) {
      assert.equal(serialized.includes(forbidden), false);
    }
    assert.throws(
      () => buildRunObservation(admission.value),
      (error) => error.code === "AGENTMO_ARTIFACT_ADMISSION_RESULT_INVALID",
    );
  });

  it("writes deterministic admitted observation bytes without mutating governed artifacts", async () => {
    const blueprint = await loadExample();
    const out = await mkdtemp(path.join(tmpdir(), "agentmo-observe-run-"));
    await executeAdmittedRuntimeRun(blueprint, {
      target: "openclaw",
      workspace: "/tmp/workspace",
      message: PRIVATE_MESSAGE,
      out,
      runId: "declared-run",
      now: "2026-07-03T00:00:00.000Z",
    });
    const stateFile = path.join(out, "runs", "declared-run", RUN_STATE_FILENAME);
    const runStateAdmission = await loadAdmittedRunStateFile(stateFile);
    const before = JSON.stringify(runStateAdmission.value);
    const observation = buildRunObservation(runStateAdmission.value, { admission: runStateAdmission });

    const governedDir = path.join(out, "governed");
    await mkdir(governedDir, { recursive: true });
    const governed = new Map();
    for (const name of ["blueprint.json", "scaffold.txt", "runtime.json", "evals.json"]) {
      const file = path.join(governedDir, name);
      await writeFile(file, `unchanged:${name}`, "utf8");
      governed.set(file, await readFile(file, "utf8"));
    }

    const firstFile = path.join(out, "observations", "declared-run.observation.json");
    const secondFile = path.join(out, "observations", "declared-run-copy.observation.json");
    await writeRunObservation(firstFile, observation);
    await writeRunObservation(secondFile, observation);
    const firstBytes = await readFile(firstFile);
    const secondBytes = await readFile(secondFile);
    const admitted = await loadObservationRecord(firstFile, {
      subject: "observation",
      expectedDigest: digestRawBytes(firstBytes),
      returnAdmission: true,
    });
    const after = JSON.stringify((await loadAdmittedRunStateFile(stateFile)).value);

    assert.deepEqual(firstBytes, secondBytes);
    assert.equal(admitted.value.source.digest, runStateAdmission.digest);
    assert.equal(before, after);
    assert.equal(firstBytes.toString("utf8").includes(stateFile), false);
    for (const [file, contents] of governed) assert.equal(await readFile(file, "utf8"), contents);
  });

  it("rejects hostile complete proposals before creating a root, temp file, or output", async () => {
    const admission = await failedAdmittedRun();
    const valid = buildRunObservation(admission.value, { admission });
    const parent = await mkdtemp(path.join(tmpdir(), "agentmo-observation-hostile-parent-"));
    const root = path.join(parent, "must-not-exist");
    const cases = [
      { ...structuredClone(valid), rawPrompt: PRIVATE_MESSAGE },
      { ...structuredClone(valid), proposedRegression: { ...valid.proposedRegression, description: PRIVATE_SECRET } },
      { ...structuredClone(valid), recommendedBlueprintChange: { ...valid.recommendedBlueprintChange, proposal: PRIVATE_PATH } },
      { ...structuredClone(valid), runEvidence: { ...valid.runEvidence, transcript: PRIVATE_OUTPUT } },
      { ...structuredClone(valid), rawToolBody: PRIVATE_OUTPUT },
      { ...structuredClone(valid), stdout: PRIVATE_OUTPUT },
      { ...structuredClone(valid), stderr: PRIVATE_OUTPUT },
      { ...structuredClone(valid), source: { ...valid.source, digest: "sha256:invalid" } },
    ];

    for (const [index, candidate] of cases.entries()) {
      const output = path.join(root, String(index), "observation.json");
      await assert.rejects(writeRunObservation(output, candidate), (error) => {
        const serialized = JSON.stringify(error);
        for (const forbidden of [PRIVATE_MESSAGE, PRIVATE_OUTPUT, PRIVATE_PATH, PRIVATE_SECRET, output]) {
          assert.equal(error.message.includes(forbidden), false);
          assert.equal(serialized.includes(forbidden), false);
        }
        return error.code === "AGENTMO_OBSERVATION_INVALID";
      });
    }
    await assert.rejects(() => access(root), (error) => error?.code === "ENOENT");
  });
});
