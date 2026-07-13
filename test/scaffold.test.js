import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { BUILD_STATE_FILENAME } from "../src/build-state.js";
import { scaffoldAgent } from "../src/scaffold.js";
import { admitBlueprint } from "./helpers/admitted-blueprint.js";

async function loadExample() {
  return admitBlueprint(new URL("../examples/win9.agentmo.json", import.meta.url));
}

describe("scaffold", () => {
  it("generates a domain-agent harness from a valid blueprint", async () => {
    const admission = await loadExample();
    const blueprint = admission.value;
    const dir = await mkdtemp(path.join(tmpdir(), "agentmo-scaffold-"));
    const result = await scaffoldAgent(blueprint, dir, { admission });
    assert.equal(result.files.includes("README.md"), true);
    assert.equal(result.files.includes("agent_policy.json"), true);
    assert.equal(result.files.includes("agents/win9-main.md"), true);
    assert.equal(result.files.includes("agents/win9-step9.md"), true);
    assert.equal(result.files.includes("evals/RUBRIC.md"), true);
    assert.equal(result.files.includes(BUILD_STATE_FILENAME), false);
    assert.equal(result.stateFile, path.join(dir, BUILD_STATE_FILENAME));

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
    assert.match(readme, /Produce-internal gates/u);

    await assertGeneratedFilesUseCanonicalIdentity(dir, result.files);

    const buildState = JSON.parse(await readFile(path.join(dir, BUILD_STATE_FILENAME), "utf8"));
    assert.equal(buildState.schemaVersion, "agentmo.build-state.v1");
    assert.equal(buildState.agentId, "win9");
    assert.equal(buildState.target.id, "agentmo");
    assert.equal(buildState.resolution.domainOperationCount, result.files.length);
    assert.equal(
      buildState.operations.some((operation) => operation.relativePath === BUILD_STATE_FILENAME),
      false,
    );
  });


  it("generates an OpenClaw workspace target", async () => {
    const admission = await loadExample();
    const blueprint = admission.value;
    const dir = await mkdtemp(path.join(tmpdir(), "agentmo-openclaw-"));
    const result = await scaffoldAgent(blueprint, dir, { admission, target: "openclaw" });
    assert.equal(result.target, "openclaw");
    assert.equal(result.files.includes("openclaw/workspace/AGENTS.md"), true);
    assert.equal(result.files.includes("openclaw/workspace/SOUL.md"), true);
    assert.equal(result.files.includes("openclaw/workspace/TOOLS.md"), true);
    assert.equal(result.files.includes("openclaw/workspace/skills/win9/SKILL.md"), true);
    assert.equal(result.files.includes("openclaw/config/openclaw.agent.patch.json"), true);
    assert.equal(result.files.includes("openclaw/runtime_contract.md"), true);
    assert.equal(result.files.includes(BUILD_STATE_FILENAME), false);

    const config = JSON.parse(await readFile(path.join(dir, "openclaw/config/openclaw.agent.patch.json"), "utf8"));
    assert.equal(config.agents.list[0].id, "win9");
    assert.equal(config.agents.list[0].workspace, "openclaw/workspace");
    assert.equal(config.agents.list[0].skills[0], "win9");

    const agents = await readFile(path.join(dir, "openclaw/workspace/AGENTS.md"), "utf8");
    assert.match(agents, /### 1\. Discover: find what to build/u);
    assert.match(agents, /### 3\. Produce: program the agent/u);
    assert.match(agents, /provider, model, runtime, and channel/u);
    assert.match(agents, /Do not claim parity with the Pi runtime/u);

    const runbook = await readFile(path.join(dir, "openclaw/RUNBOOK.md"), "utf8");
    assert.equal(runbook.includes(dir), false);
    assert.match(runbook, /openclaw agents add win9/u);
    assert.match(runbook, /agentmo\.js run-plan "\$BLUEPRINT"[^\n]+--digest "blueprint=/u);
    assert.match(runbook, /agentmo\.js run "\$RUNTIME_PLAN"[^\n]+--digest "runtime-plan=/u);
    assert.doesNotMatch(runbook, /agentmo\.js run examples\/win9\.agentmo\.json/u);
    assert.match(runbook, /readFileSync\(process\.argv\[1\]\)/u);
    assert.match(runbook, /agentmo\.js replay-run/u);
    assert.match(runbook, /agentmo\.js run-eval/u);
    assert.match(runbook, /fresh run-scoped execution/u);
    assert.match(runbook, /same-session replay requires explicit `--resume-session`/u);
    assert.match(runbook, /`--message-file`/u);
    assert.match(runbook, /model, thinking, runtime/u);
    assert.match(runbook, /transport, fallbackFrom, fallbackEvidence, sandboxScope/u);
    assert.match(runbook, /OPENCLAW_STATE_DIR/u);
    assert.match(runbook, /--openclaw-source-root/u);
    assert.match(runbook, /does not certify OpenClaw domain parity/u);
    assert.match(runbook, /domain-eval fixtures certify only their bounded case suite/u);
    assert.match(runbook, /Produce-internal gate/u);

    const contract = await readFile(path.join(dir, "openclaw/runtime_contract.md"), "utf8");
    assert.match(contract, /Model loop/u);
    assert.match(contract, /openclaw@5bcd25f0fb/u);

    await assertGeneratedFilesUseCanonicalIdentity(dir, result.files);

    const buildState = JSON.parse(await readFile(path.join(dir, BUILD_STATE_FILENAME), "utf8"));
    assert.equal(buildState.target.id, "openclaw");
    assert.equal(buildState.resolution.selectedTargetId, "openclaw");
    assert.equal(buildState.resolution.domainOperationCount, result.files.length);
  });

  it("refuses non-empty target directories without force", async () => {
    const admission = await loadExample();
    const blueprint = admission.value;
    const dir = await mkdtemp(path.join(tmpdir(), "agentmo-non-empty-"));
    await writeFile(path.join(dir, "existing.txt"), "keep", "utf8");
    await assert.rejects(scaffoldAgent(blueprint, dir, { admission }), /Refusing to scaffold into non-empty directory/u);
  });

  it("fails hostile blueprint admission before creating the scaffold root", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "agentmo-scaffold-zero-root-"));
    const base = JSON.parse(await readFile(new URL("../examples/win9.agentmo.json", import.meta.url), "utf8"));

    const hostPathValue = "/Users/private/scaffold-canary.txt";
    const hostPathBlueprint = structuredClone(base);
    hostPathBlueprint.domain_genome.task_classes.push(`inspect ${hostPathValue}`);
    const hostPathFile = path.join(parent, "host-path.agentmo.json");
    const out = path.join(parent, "must-not-exist");
    await writeFile(hostPathFile, `${JSON.stringify(hostPathBlueprint, null, 2)}\n`, "utf8");
    await assert.rejects(
      admitBlueprint(hostPathFile),
      (error) => error?.code === "AGENTMO_ARTIFACT_UNSAFE_CONTENT"
        && !JSON.stringify(error).includes(hostPathValue),
    );
    await assert.rejects(() => stat(out), { code: "ENOENT" });
  });

  it("requires authentic blueprint admission before any scaffold side effect", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "agentmo-scaffold-admission-"));
    const blueprint = JSON.parse(await readFile(new URL("../examples/win9.agentmo.json", import.meta.url), "utf8"));
    const out = path.join(parent, "must-not-exist");

    await assert.rejects(
      scaffoldAgent(blueprint, out, { admission: Object.freeze({ value: blueprint }) }),
      (error) => error?.code === "AGENTMO_ARTIFACT_ADMISSION_RESULT_INVALID",
    );
    await assert.rejects(() => stat(out), { code: "ENOENT" });
  });

  it("keeps the root absent when admission finds embedded raw runtime or secret material", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "agentmo-scaffold-admission-hostile-"));
    const base = JSON.parse(await readFile(new URL("../examples/win9.agentmo.json", import.meta.url), "utf8"));
    const cases = [
      ["raw", (blueprint) => { blueprint.rawTranscript = "private runtime canary"; }],
      ["secret", (blueprint) => { blueprint.domain_genome.task_classes.push("sk-syntheticcanary1234567890"); }],
    ];

    for (const [name, mutate] of cases) {
      const blueprint = structuredClone(base);
      mutate(blueprint);
      const file = path.join(parent, `${name}.agentmo.json`);
      const out = path.join(parent, `${name}-must-not-exist`);
      await writeFile(file, `${JSON.stringify(blueprint, null, 2)}\n`, "utf8");
      await assert.rejects(
        async () => {
          const admission = await admitBlueprint(file);
          return scaffoldAgent(admission.value, out, { admission, target: "openclaw" });
        },
        (error) => error?.code === "AGENTMO_ARTIFACT_UNSAFE_CONTENT",
      );
      await assert.rejects(() => stat(out), { code: "ENOENT" });
    }
  });
});

async function assertGeneratedFilesUseCanonicalIdentity(root, files) {
  for (const relativePath of files) {
    const content = await readFile(path.join(root, relativePath), "utf8");
    assert.doesNotMatch(content, /AgentMother|agentmother/u, `${relativePath} must use canonical AgentMo identity`);
  }
}
