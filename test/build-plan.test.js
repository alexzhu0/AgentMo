import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildPlan } from "../src/build-plan.js";
import { BUILD_STATE_FILENAME } from "../src/build-state.js";
import { scaffoldAgent } from "../src/scaffold.js";
import { admitBlueprint } from "./helpers/admitted-blueprint.js";

async function loadExample() {
  return JSON.parse(await readFile(new URL("../examples/win9.agentmo.json", import.meta.url), "utf8"));
}

async function listFiles(root, options = {}) {
  const results = [];
  async function visit(dir, prefix = "") {
    for (const entry of await readdir(dir)) {
      const absolute = path.join(dir, entry);
      const relative = prefix ? `${prefix}/${entry}` : entry;
      if ((await stat(absolute)).isDirectory()) await visit(absolute, relative);
      else if (!options.exclude?.has(relative)) results.push(relative);
    }
  }
  await visit(root);
  return results.sort();
}

const AGENTMO_BASELINE_FILES = [
  "README.md",
  "agent_policy.json",
  "agents/win9-main.md",
  "agents/win9-step1.md",
  "agents/win9-step2.md",
  "agents/win9-step3.md",
  "agents/win9-step4.md",
  "agents/win9-step5.md",
  "agents/win9-step6.md",
  "agents/win9-step7.md",
  "agents/win9-step8.md",
  "agents/win9-step9.md",
  "evals/CASES.md",
  "evals/RUBRIC.md",
  "governance/QUALITY_GATES.md",
  "history/EVIDENCE_INDEX.md",
  "history/VERSION_LEDGER.md",
];

const OPENCLAW_EXTRA_FILES = [
  "openclaw/README.md",
  "openclaw/RUNBOOK.md",
  "openclaw/config/channel-bindings.examples.md",
  "openclaw/config/openclaw.agent.patch.json",
  "openclaw/runtime_contract.md",
  "openclaw/workspace/AGENTS.md",
  "openclaw/workspace/IDENTITY.md",
  "openclaw/workspace/SOUL.md",
  "openclaw/workspace/TOOLS.md",
  "openclaw/workspace/USER.md",
  "openclaw/workspace/memory/README.md",
  "openclaw/workspace/skills/win9/SKILL.md",
];

const OPENCLAW_BASELINE_FILES = [...AGENTMO_BASELINE_FILES, ...OPENCLAW_EXTRA_FILES].sort();

describe("build plan", () => {
  it("returns deterministic AgentMo operations matching the baseline file list", async () => {
    const blueprint = await loadExample();
    const first = buildPlan(blueprint, { target: "agentmo" });
    const second = buildPlan(blueprint, { target: "agentmo" });
    assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)));
    assert.equal(first.schemaVersion, "agentmo.build-plan.v1");
    assert.equal(first.selectedTargetId, "agentmo");
    assert.equal(first.selectedProfileId, "pi");
    assert.deepEqual(first.selectedModuleIds, ["default"]);
    assert.equal(first.domainOperationCount, AGENTMO_BASELINE_FILES.length);
    assert.deepEqual(
      first.operations.map((operation) => operation.relativePath),
      AGENTMO_BASELINE_FILES,
    );
    assert.equal(first.operations.every((operation) => operation.kind === "write-file"), true);
    assert.equal(first.operations.every((operation) => operation.ownership === "managed"), true);
    assert.equal(first.operations.every((operation) => operation.scaffoldOnly === true), true);
    assert.equal(first.operations.every((operation) => !("destinationPath" in operation)), true);
    assert.equal(JSON.stringify(first).includes("content"), false);
  });

  it("returns deterministic OpenClaw operations matching the baseline file list", async () => {
    const blueprint = await loadExample();
    const plan = buildPlan(blueprint, { target: "openclaw" });
    assert.equal(plan.selectedTargetId, "openclaw");
    assert.equal(plan.selectedProfileId, "openclaw");
    assert.deepEqual(plan.selectedModuleIds, ["default"]);
    assert.equal(plan.domainOperationCount, OPENCLAW_BASELINE_FILES.length);
    assert.deepEqual(
      plan.operations.map((operation) => operation.relativePath),
      OPENCLAW_BASELINE_FILES,
    );
  });

  it("matches scaffold-applied domain output paths for each target", async () => {
    const admission = await admitBlueprint(new URL("../examples/win9.agentmo.json", import.meta.url));
    const blueprint = admission.value;
    for (const target of ["agentmo", "openclaw"]) {
      const dir = await mkdtemp(path.join(tmpdir(), `agentmo-parity-${target}-`));
      const result = await scaffoldAgent(blueprint, dir, { admission, target });
      const plan = buildPlan(blueprint, { target, outputDir: dir });
      const plannedPaths = plan.operations.map((operation) => operation.relativePath).sort();
      assert.deepEqual(result.files, plannedPaths);
      assert.deepEqual(await listFiles(dir, { exclude: new Set([BUILD_STATE_FILENAME]) }), plannedPaths);
      assert.deepEqual(await listFiles(dir), [...plannedPaths, BUILD_STATE_FILENAME].sort());
      assert.equal(plan.operations.every((operation) => operation.destinationPath.startsWith(dir)), true);
    }
  });

  it("does not write files during dry-run planning", async () => {
    const blueprint = await loadExample();
    const dir = await mkdtemp(path.join(tmpdir(), "agentmo-plan-no-write-"));
    const plan = buildPlan(blueprint, { target: "openclaw" });
    assert.equal(plan.domainOperationCount, OPENCLAW_BASELINE_FILES.length);
    assert.deepEqual(await readdir(dir), []);
  });

  it("fails invalid blueprints before planning", async () => {
    const blueprint = await loadExample();
    delete blueprint.tools;
    assert.throws(() => buildPlan(blueprint), /Cannot build plan for invalid blueprint/u);
  });

  it("emits stable profile fallback warnings", async () => {
    const blueprint = await loadExample();
    blueprint.runtime_profiles = blueprint.runtime_profiles.filter((profile) => profile.id !== "openclaw");
    const plan = buildPlan(blueprint, { target: "openclaw" });
    assert.equal(plan.selectedProfileId, "pi");
    assert.deepEqual(plan.warnings, ["No runtime profile matched target openclaw runtime openclaw; using primary runtime profile pi."]);
  });
});

export { AGENTMO_BASELINE_FILES, OPENCLAW_BASELINE_FILES };
