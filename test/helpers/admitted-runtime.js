import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { digestRawBytes, loadAdmittedArtifact } from "../../src/artifact-admission.js";
import { loadAdmittedBlueprint } from "../../src/blueprint.js";
import { buildRuntimePlan } from "../../src/runtime-plan.js";
import { executeRuntimeRun, replayRunState } from "../../src/run-state.js";

const BLUEPRINT_ADMISSIONS = new WeakMap();

export async function admitRuntimeBlueprint(blueprint) {
  const existing = BLUEPRINT_ADMISSIONS.get(blueprint);
  if (existing) return existing;

  const fixture = await writeJsonFixture("agentmo-runtime-blueprint-", "blueprint.agentmo.json", blueprint);
  const admission = await loadAdmittedBlueprint(fixture.file, {
    subject: "blueprint",
    expectedDigest: digestRawBytes(fixture.bytes),
  });
  BLUEPRINT_ADMISSIONS.set(blueprint, admission);
  return admission;
}

export async function buildAndAdmitRuntimePlan(blueprint, options = {}) {
  const blueprintAdmission = await admitRuntimeBlueprint(blueprint);
  const plan = await buildRuntimePlan(blueprintAdmission.value, {
    ...options,
    admission: blueprintAdmission,
  });
  const fixture = await writeJsonFixture("agentmo-runtime-plan-", "agentmo-runtime-plan.json", plan);
  const runtimePlanAdmission = await loadAdmittedArtifact({
    filePath: fixture.file,
    subject: "runtime-plan",
    expectedDigest: digestRawBytes(fixture.bytes),
  });
  return {
    blueprintAdmission,
    runtimePlan: runtimePlanAdmission.value,
    runtimePlanAdmission,
    runtimePlanFile: fixture.file,
    runtimePlanBytes: fixture.bytes,
  };
}

export async function executeAdmittedRuntimeRun(blueprint, options = {}, runner = null) {
  const { blueprintAdmission, runtimePlan, runtimePlanAdmission } = await buildAndAdmitRuntimePlan(blueprint, options);
  const result = await executeRuntimeRun(
    runtimePlan,
    {
      ...options,
      admission: runtimePlanAdmission,
    },
    runner,
  );
  return { ...result, blueprintAdmission };
}

export async function admitRunStateValue(runState) {
  const fixture = await writeJsonFixture("agentmo-run-state-", "agentmo-run-state.json", runState);
  return loadAdmittedArtifact({
    filePath: fixture.file,
    subject: "run-state",
    expectedDigest: digestRawBytes(fixture.bytes),
  });
}

export async function loadAdmittedRunStateFile(file) {
  const bytes = await readFile(file);
  return loadAdmittedArtifact({
    filePath: file,
    subject: "run-state",
    expectedDigest: digestRawBytes(bytes),
  });
}

export async function loadAdmittedRunIndexFile(file) {
  const bytes = await readFile(file);
  return loadAdmittedArtifact({
    filePath: file,
    subject: "run-index",
    expectedDigest: digestRawBytes(bytes),
  });
}

export async function replayAdmittedRunState(runState, options = {}, runner = null) {
  const admission = await admitRunStateValue(runState);
  return replayRunState(
    admission.value,
    { ...options, admission },
    runner,
  );
}

async function writeJsonFixture(prefix, basename, value) {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  const file = path.join(directory, basename);
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  await writeFile(file, bytes);
  return { bytes, file };
}
