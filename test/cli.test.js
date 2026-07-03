import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, readdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
const CLI = fileURLToPath(new URL("../bin/agentmo.js", import.meta.url));
const BLUEPRINT = fileURLToPath(new URL("../examples/win9.agentmo.json", import.meta.url));
const DISCOVERY = fileURLToPath(new URL("../examples/win9.discovery.json", import.meta.url));

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

const OPENCLAW_BASELINE_FILES = [
  ...AGENTMO_BASELINE_FILES,
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
].sort();
const BUILD_STATE_FILENAME = "agentmo-build-state.json";

function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
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

describe("cli", () => {
  it("validates and reports the reference blueprint", async () => {
    const validate = await runCli(["validate", BLUEPRINT]);
    assert.equal(validate.code, 0, validate.stderr);
    assert.match(validate.stdout, /PASS blueprint validation/u);

    const report = await runCli(["report", BLUEPRINT, "--json"]);
    assert.equal(report.code, 0, report.stderr);
    const json = JSON.parse(report.stdout);
    assert.equal(json.kind, "agentmother_report");
    assert.equal(json.ok, true);
    assert.equal(json.discovery.loaded, true);
    assert.equal(json.discovery.summary.source_count, 3);
    assert.equal(json.runtime_certification.find((profile) => profile.id === "openclaw").certification_status, "evidence_disclosed");
  });

  it("prints discovery report JSON for the reference manifest", async () => {
    const result = await runCli(["discover-report", DISCOVERY, "--json"]);
    assert.equal(result.code, 0, result.stderr);
    const json = JSON.parse(result.stdout);
    assert.equal(json.kind, "agentmo_discovery_report");
    assert.equal(json.ok, true);
    assert.equal(json.summary.agent_id, "win9");
    assert.equal(json.summary.source_count, 3);
  });

  it("prints deterministic plan JSON and writes no files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agentmo-cli-plan-"));
    const result = await runCli(["plan", BLUEPRINT, "--target", "openclaw", "--json"]);
    assert.equal(result.code, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.selectedTargetId, "openclaw");
    assert.equal(plan.selectedProfileId, "openclaw");
    assert.deepEqual(plan.selectedModuleIds, ["default"]);
    assert.deepEqual(
      plan.operations.map((operation) => operation.relativePath),
      OPENCLAW_BASELINE_FILES,
    );
    assert.deepEqual(await readdir(dir), []);
  });

  it("scaffolds both supported targets with expected file lists", async () => {
    const agentmoDir = await mkdtemp(path.join(tmpdir(), "agentmo-cli-agentmo-"));
    const agentmo = await runCli(["scaffold", BLUEPRINT, "--out", agentmoDir]);
    assert.equal(agentmo.code, 0, agentmo.stderr);
    assert.match(agentmo.stdout, /Scaffolded 17 files/u);
    assert.deepEqual(await listFiles(agentmoDir, { exclude: new Set([BUILD_STATE_FILENAME]) }), AGENTMO_BASELINE_FILES);
    assert.deepEqual(await listFiles(agentmoDir), [...AGENTMO_BASELINE_FILES, BUILD_STATE_FILENAME].sort());

    const openclawDir = await mkdtemp(path.join(tmpdir(), "agentmo-cli-openclaw-"));
    const openclaw = await runCli(["scaffold", BLUEPRINT, "--target", "openclaw", "--out", openclawDir]);
    assert.equal(openclaw.code, 0, openclaw.stderr);
    assert.match(openclaw.stdout, /Scaffolded 29 files/u);
    assert.deepEqual(await listFiles(openclawDir, { exclude: new Set([BUILD_STATE_FILENAME]) }), OPENCLAW_BASELINE_FILES);
    assert.deepEqual(await listFiles(openclawDir), [...OPENCLAW_BASELINE_FILES, BUILD_STATE_FILENAME].sort());
  });

  it("prints a control status snapshot with optional build-state", async () => {
    const status = await runCli(["status", BLUEPRINT, "--json"]);
    assert.equal(status.code, 0, status.stderr);
    const snapshot = JSON.parse(status.stdout);
    assert.equal(snapshot.schemaVersion, "agentmo.control.v1");
    assert.equal(snapshot.agentId, "win9");
    assert.equal(snapshot.latestBuildState.available, false);

    const dir = await mkdtemp(path.join(tmpdir(), "agentmo-cli-status-openclaw-"));
    const scaffold = await runCli(["scaffold", BLUEPRINT, "--target", "openclaw", "--out", dir]);
    assert.equal(scaffold.code, 0, scaffold.stderr);

    const withState = await runCli(["status", BLUEPRINT, "--build-state", path.join(dir, BUILD_STATE_FILENAME), "--json"]);
    assert.equal(withState.code, 0, withState.stderr);
    const stateSnapshot = JSON.parse(withState.stdout);
    assert.equal(stateSnapshot.latestBuildState.available, true);
    assert.equal(stateSnapshot.latestBuildState.target.id, "openclaw");
    assert.equal(stateSnapshot.latestBuildState.operations.domainOperationCount, OPENCLAW_BASELINE_FILES.length);
  });

  it("validates observation records without applying blueprint changes", async () => {
    const result = await runCli(["observe", fileURLToPath(new URL("../examples/win9.observation.json", import.meta.url)), "--json"]);
    assert.equal(result.code, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.schemaVersion, "agentmo.observation-report.v1");
    assert.equal(report.ok, true);
    assert.equal(report.recommendedBlueprintChange.proposalOnly, true);
    assert.equal(report.mutation.autoApplied, false);
  });

  it("rejects invalid targets consistently", async () => {
    const plan = await runCli(["plan", BLUEPRINT, "--target", "missing", "--json"]);
    assert.equal(plan.code, 1);
    assert.match(plan.stderr, /Unknown plan target: missing. Expected one of: agentmo, openclaw/u);

    const dir = await mkdtemp(path.join(tmpdir(), "agentmo-cli-missing-"));
    const scaffold = await runCli(["scaffold", BLUEPRINT, "--target", "missing", "--out", dir]);
    assert.equal(scaffold.code, 1);
    assert.match(scaffold.stderr, /Unknown scaffold target: missing. Expected one of: agentmo, openclaw/u);
  });
});
