import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildPlan } from "../src/build-plan.js";
import { BUILD_STATE_FILENAME, createBuildState, validateBuildStateArtifact } from "../src/build-state.js";
import { scaffoldAgent } from "../src/scaffold.js";
import { admitBlueprint } from "./helpers/admitted-blueprint.js";

async function loadExample() {
  return admitBlueprint(new URL("../examples/win9.agentmo.json", import.meta.url));
}

describe("build state", () => {
  it("serializes required state fields without counting the sidecar as a domain operation", async () => {
    const admission = await loadExample();
    const blueprint = admission.value;
    const outputDir = await mkdtemp(path.join(tmpdir(), "agentmo-state-model-"));
    const plan = buildPlan(blueprint, { target: "openclaw", outputDir });
    const state = await createBuildState(blueprint, plan, {
      admission,
      generatedAt: "2026-01-01T00:00:00.000Z",
      target: "openclaw",
    });

    assert.equal(state.schemaVersion, "agentmo.build-state.v1");
    assert.equal(state.generatedAt, "2026-01-01T00:00:00.000Z");
    assert.equal(state.agentId, "win9");
    assert.equal(state.request.target, "openclaw");
    assert.deepEqual(state.request.outputRoot, { kind: "ManagedRelativeRef", relativePath: "." });
    assert.equal(state.resolution.selectedTargetId, "openclaw");
    assert.equal(state.resolution.domainOperationCount, plan.operations.length);
    assert.equal(state.operations.length, plan.operations.length);
    assert.deepEqual(state.source, {
      identity: "0.1",
      subject: "blueprint",
      digest: admission.digest,
    });
    assert.equal(JSON.stringify(state).includes(outputDir), false);
    assert.equal(state.operations.every((operation) => /^sha256:[a-f0-9]{64}$/u.test(operation.contentDigest)), true);
    assert.equal(state.operations.every((operation) => Object.hasOwn(operation, "destinationPath") === false), true);
    assert.equal(
      state.operations.some((operation) => operation.relativePath === BUILD_STATE_FILENAME),
      false,
    );
    assert.equal(
      state.operations.every((operation) => Object.hasOwn(operation, "content") === false),
      true,
    );
    assert.deepEqual(validateBuildStateArtifact(state), { ok: true, errors: [] });

  });

  it("writes the managed sidecar after scaffold apply for each target", async () => {
    const admission = await loadExample();
    const blueprint = admission.value;
    const agentMoDir = await mkdtemp(path.join(tmpdir(), "agentmo-state-agentmo-"));
    const openClawDir = await mkdtemp(path.join(tmpdir(), "agentmo-state-openclaw-"));

    const agentMoResult = await scaffoldAgent(blueprint, agentMoDir, { admission });
    const openClawResult = await scaffoldAgent(blueprint, openClawDir, {
      admission,
      target: "openclaw",
    });

    await stat(path.join(agentMoDir, BUILD_STATE_FILENAME));
    await stat(path.join(openClawDir, BUILD_STATE_FILENAME));
    assert.equal(agentMoResult.files.includes(BUILD_STATE_FILENAME), false);
    assert.equal(openClawResult.files.includes(BUILD_STATE_FILENAME), false);

    const openClawState = JSON.parse(await readFile(path.join(openClawDir, BUILD_STATE_FILENAME), "utf8"));
    assert.equal(openClawState.target.id, "openclaw");
    assert.equal(openClawState.resolution.domainOperationCount, openClawResult.files.length);
    assert.equal(JSON.stringify(openClawState).includes(openClawDir), false);

    assert.deepEqual(await listDomainFiles(agentMoDir), agentMoResult.files);
    assert.deepEqual(await listDomainFiles(openClawDir), openClawResult.files);
  });

  it("keeps build-state bytes deterministic across different scaffold roots", async () => {
    const admission = await loadExample();
    const first = await mkdtemp(path.join(tmpdir(), "agentmo-state-deterministic-a-"));
    const second = await mkdtemp(path.join(tmpdir(), "agentmo-state-deterministic-b-"));

    const firstResult = await scaffoldAgent(admission.value, first, { admission, target: "openclaw" });
    const secondResult = await scaffoldAgent(admission.value, second, { admission, target: "openclaw" });

    assert.deepEqual(
      await readFile(path.join(first, BUILD_STATE_FILENAME)),
      await readFile(path.join(second, BUILD_STATE_FILENAME)),
    );
    assert.deepEqual(firstResult.files, secondResult.files);
    for (const relativePath of firstResult.files) {
      assert.deepEqual(await readFile(path.join(first, relativePath)), await readFile(path.join(second, relativePath)));
    }
    assert.equal(JSON.parse(await readFile(path.join(first, BUILD_STATE_FILENAME), "utf8")).generatedAt, null);
  });

  it("keeps dry-run build plans side-effect free", async () => {
    const blueprint = (await loadExample()).value;
    const outputDir = await mkdtemp(path.join(tmpdir(), "agentmo-state-dry-run-"));
    const plan = buildPlan(blueprint, { target: "agentmo", outputDir });

    assert.equal(plan.operations.some((operation) => operation.relativePath === BUILD_STATE_FILENAME), false);
    await assert.rejects(stat(path.join(outputDir, BUILD_STATE_FILENAME)), /ENOENT/u);
  });
});

async function listDomainFiles(root, dir = root) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listDomainFiles(root, absolute)));
    } else {
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (relative !== BUILD_STATE_FILENAME) files.push(relative);
    }
  }
  return files.sort();
}
