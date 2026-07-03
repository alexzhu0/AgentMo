import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { scaffoldAgent } from "../src/scaffold.js";

async function loadExample() {
  return JSON.parse(await readFile(new URL("../examples/win9.agentmo.json", import.meta.url), "utf8"));
}

describe("scaffold", () => {
  it("generates a domain-agent harness from a valid blueprint", async () => {
    const blueprint = await loadExample();
    const dir = await mkdtemp(path.join(tmpdir(), "agentmo-scaffold-"));
    const result = await scaffoldAgent(blueprint, dir);
    assert.equal(result.files.includes("README.md"), true);
    assert.equal(result.files.includes("agent_policy.json"), true);
    assert.equal(result.files.includes("agents/win9-main.md"), true);
    assert.equal(result.files.includes("agents/win9-step9.md"), true);
    assert.equal(result.files.includes("evals/RUBRIC.md"), true);

    const policy = JSON.parse(await readFile(path.join(dir, "agent_policy.json"), "utf8"));
    assert.equal(policy.agent_id, "win9");
    assert.equal(policy.tools.length, 6);
    assert.deepEqual(
      policy.runtime_profiles.map((profile) => profile.id),
      ["pi", "openclaw"],
    );
    const readme = await readFile(path.join(dir, "README.md"), "utf8");
    assert.match(readme, /### 1\. Discover: find what to build/u);
    assert.match(readme, /Source refs: .*openclaw@5bcd25f0fb/u);
  });


  it("generates an OpenClaw workspace target", async () => {
    const blueprint = await loadExample();
    const dir = await mkdtemp(path.join(tmpdir(), "agentmo-openclaw-"));
    const result = await scaffoldAgent(blueprint, dir, { target: "openclaw" });
    assert.equal(result.target, "openclaw");
    assert.equal(result.files.includes("openclaw/workspace/AGENTS.md"), true);
    assert.equal(result.files.includes("openclaw/workspace/SOUL.md"), true);
    assert.equal(result.files.includes("openclaw/workspace/TOOLS.md"), true);
    assert.equal(result.files.includes("openclaw/workspace/skills/win9/SKILL.md"), true);
    assert.equal(result.files.includes("openclaw/config/openclaw.agent.patch.json"), true);
    assert.equal(result.files.includes("openclaw/runtime_contract.md"), true);

    const config = JSON.parse(await readFile(path.join(dir, "openclaw/config/openclaw.agent.patch.json"), "utf8"));
    assert.equal(config.agents.list[0].id, "win9");
    assert.match(config.agents.list[0].workspace, /openclaw\/workspace$/u);
    assert.equal(config.agents.list[0].skills[0], "win9");

    const agents = await readFile(path.join(dir, "openclaw/workspace/AGENTS.md"), "utf8");
    assert.match(agents, /### 1\. Discover: find what to build/u);
    assert.match(agents, /### 3\. Produce: program the agent/u);
    assert.match(agents, /provider, model, runtime, and channel/u);
    assert.match(agents, /Do not claim parity with the Pi runtime/u);

    const runbook = await readFile(path.join(dir, "openclaw/RUNBOOK.md"), "utf8");
    assert.match(runbook, /openclaw agents add win9/u);

    const contract = await readFile(path.join(dir, "openclaw/runtime_contract.md"), "utf8");
    assert.match(contract, /Model loop/u);
    assert.match(contract, /openclaw@5bcd25f0fb/u);
  });

  it("refuses non-empty target directories without force", async () => {
    const blueprint = await loadExample();
    const dir = await mkdtemp(path.join(tmpdir(), "agentmo-non-empty-"));
    await writeFile(path.join(dir, "existing.txt"), "keep", "utf8");
    await assert.rejects(scaffoldAgent(blueprint, dir), /Refusing to scaffold into non-empty directory/u);
  });
});
