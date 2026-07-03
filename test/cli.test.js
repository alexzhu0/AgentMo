import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, readdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { AGENTMO_BASELINE_FILES, OPENCLAW_BASELINE_FILES } from "./build-plan.test.js";

const CLI = new URL("../bin/agentmo.js", import.meta.url);
const BLUEPRINT = new URL("../examples/win9.agentmo.json", import.meta.url);

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

async function listFiles(root) {
  const results = [];
  async function visit(dir, prefix = "") {
    for (const entry of await readdir(dir)) {
      const absolute = path.join(dir, entry);
      const relative = prefix ? `${prefix}/${entry}` : entry;
      if ((await stat(absolute)).isDirectory()) await visit(absolute, relative);
      else results.push(relative);
    }
  }
  await visit(root);
  return results.sort();
}

describe("cli", () => {
  it("validates and reports the reference blueprint", async () => {
    const validate = await runCli(["validate", BLUEPRINT.pathname]);
    assert.equal(validate.code, 0, validate.stderr);
    assert.match(validate.stdout, /PASS blueprint validation/u);

    const report = await runCli(["report", BLUEPRINT.pathname, "--json"]);
    assert.equal(report.code, 0, report.stderr);
    const json = JSON.parse(report.stdout);
    assert.equal(json.kind, "agentmother_report");
    assert.equal(json.ok, true);
  });

  it("prints deterministic plan JSON and writes no files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agentmo-cli-plan-"));
    const result = await runCli(["plan", BLUEPRINT.pathname, "--target", "openclaw", "--json"]);
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
    const agentmo = await runCli(["scaffold", BLUEPRINT.pathname, "--out", agentmoDir]);
    assert.equal(agentmo.code, 0, agentmo.stderr);
    assert.match(agentmo.stdout, /Scaffolded 17 files/u);
    assert.deepEqual(await listFiles(agentmoDir), AGENTMO_BASELINE_FILES);

    const openclawDir = await mkdtemp(path.join(tmpdir(), "agentmo-cli-openclaw-"));
    const openclaw = await runCli(["scaffold", BLUEPRINT.pathname, "--target", "openclaw", "--out", openclawDir]);
    assert.equal(openclaw.code, 0, openclaw.stderr);
    assert.match(openclaw.stdout, /Scaffolded 29 files/u);
    assert.deepEqual(await listFiles(openclawDir), OPENCLAW_BASELINE_FILES);
  });

  it("rejects invalid targets consistently", async () => {
    const plan = await runCli(["plan", BLUEPRINT.pathname, "--target", "missing", "--json"]);
    assert.equal(plan.code, 1);
    assert.match(plan.stderr, /Unknown plan target: missing. Expected one of: agentmo, openclaw/u);

    const dir = await mkdtemp(path.join(tmpdir(), "agentmo-cli-missing-"));
    const scaffold = await runCli(["scaffold", BLUEPRINT.pathname, "--target", "missing", "--out", dir]);
    assert.equal(scaffold.code, 1);
    assert.match(scaffold.stderr, /Unknown scaffold target: missing. Expected one of: agentmo, openclaw/u);
  });
});
