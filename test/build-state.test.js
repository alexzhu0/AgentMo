import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildPlan } from "../src/build-plan.js";
import { BUILD_STATE_FILENAME, createBuildState } from "../src/build-state.js";
import { scaffoldAgent } from "../src/scaffold.js";

async function loadExample() {
  return JSON.parse(await readFile(new URL("../examples/win9.agentmo.json", import.meta.url), "utf8"));
}

describe("build state", () => {
  it("serializes required state fields without counting the sidecar as a domain operation", async () => {
    const blueprint = await loadExample();
    const outputDir = await mkdtemp(path.join(tmpdir(), "agentmo-state-model-"));
    const plan = buildPlan(blueprint, { target: "openclaw", outputDir });
    const state = createBuildState(blueprint, plan, {
      blueprintPath: "examples/win9.agentmo.json",
      generatedAt: "2026-01-01T00:00:00.000Z",
      outputDir,
      target: "openclaw",
      force: true,
    });

    assert.equal(state.schemaVersion, "agentmo.build.v1");
    assert.equal(state.generatedAt, "2026-01-01T00:00:00.000Z");
    assert.equal(state.agentId, "win9");
    assert.equal(state.request.target, "openclaw");
    assert.equal(state.request.force, true);
    assert.equal(state.resolution.selectedTargetId, "openclaw");
    assert.equal(state.resolution.domainOperationCount, plan.operations.length);
    assert.equal(state.operations.length, plan.operations.length);
    assert.match(state.source.blueprintHash, /^[a-f0-9]{64}$/u);
    assert.equal(
      state.operations.some((operation) => operation.relativePath === BUILD_STATE_FILENAME),
      false,
    );
    assert.equal(
      state.operations.every((operation) => Object.hasOwn(operation, "content") === false),
      true,
    );
  });

  it("writes the managed sidecar after scaffold apply for each target", async () => {
    const blueprint = await loadExample();
    const agentMoDir = await mkdtemp(path.join(tmpdir(), "agentmo-state-agentmo-"));
    const openClawDir = await mkdtemp(path.join(tmpdir(), "agentmo-state-openclaw-"));

    const agentMoResult = await scaffoldAgent(blueprint, agentMoDir, { blueprintPath: "examples/win9.agentmo.json" });
    const openClawResult = await scaffoldAgent(blueprint, openClawDir, {
      blueprintPath: "examples/win9.agentmo.json",
      target: "openclaw",
    });

    await stat(path.join(agentMoDir, BUILD_STATE_FILENAME));
    await stat(path.join(openClawDir, BUILD_STATE_FILENAME));
    assert.equal(agentMoResult.files.includes(BUILD_STATE_FILENAME), false);
    assert.equal(openClawResult.files.includes(BUILD_STATE_FILENAME), false);

    const openClawState = JSON.parse(await readFile(path.join(openClawDir, BUILD_STATE_FILENAME), "utf8"));
    assert.equal(openClawState.target.id, "openclaw");
    assert.equal(openClawState.resolution.domainOperationCount, openClawResult.files.length);

    assert.deepEqual(await listDomainFiles(agentMoDir), agentMoResult.files);
    assert.deepEqual(await listDomainFiles(openClawDir), openClawResult.files);
  });

  it("keeps dry-run build plans side-effect free", async () => {
    const blueprint = await loadExample();
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
