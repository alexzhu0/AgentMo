import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "bin/agentmo.js");
const { summarizePocResearchCollection } = await import("../src/poc-cli.js");

function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function seed() {
  return {
    schemaVersion: "agentmo.poc-seed.v1",
    agentId: "ai-frontier-poc",
    records: [{
      id: "paper-agent-memory",
      title: "Agent Memory Paper",
      url: "https://example.com/papers/agent-memory",
      publishedAt: "2026-05-06T00:00:00.000Z",
      collectedAt: "2026-08-05T00:00:00.000Z",
      category: "agent-memory",
      sourceType: "paper",
      trustTier: "primary",
      summary: "A bounded paper summary.",
    }],
  };
}

describe("poc CLI", () => {
  it("builds and checks a POC workspace through public commands", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-poc-cli-"));
    const seedPath = path.join(root, "seed.json");
    const output = path.join(root, "workspace");
    await writeFile(seedPath, `${JSON.stringify(seed())}\n`, "utf8");

    const build = await runCli(["poc", "build", "--seed", seedPath, "--out", output, "--json"]);
    assert.equal(build.code, 0, build.stderr);
    assert.equal(JSON.parse(build.stdout).manifest.schemaVersion, "agentmo.poc-workspace.v3");

    const check = await runCli(["poc", "check", output, "--json"]);
    assert.equal(check.code, 0, check.stderr);
    assert.deepEqual(JSON.parse(check.stdout), { ok: true, recordCount: 1, researchRecordCount: 0, agentId: "ai-frontier-poc" });
  });

  it("renders a local evidence-gap brief and previews an inert Shanghai schedule", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-poc-cli-brief-"));
    const seedPath = path.join(root, "seed.json");
    const workspace = path.join(root, "workspace");
    await writeFile(seedPath, `${JSON.stringify(seed())}\n`, "utf8");
    assert.equal((await runCli(["poc", "build", "--seed", seedPath, "--out", workspace, "--json"])).code, 0);

    const brief = await runCli(["poc", "brief", workspace, "--date", "2026-08-05", "--json"]);
    assert.equal(brief.code, 0, brief.stderr);
    assert.deepEqual(JSON.parse(brief.stdout), { date: "2026-08-05", newEvidenceCount: 0, gapCount: 3, deliveryExecuted: false });

    const schedule = await runCli(["poc", "schedule-preview", workspace, "--json"]);
    assert.equal(schedule.code, 0, schedule.stderr);
    assert.deepEqual(JSON.parse(schedule.stdout), {
      agentId: "ai-frontier-poc", id: "daily-collect", expression: "0 8 * * *", timezone: "Asia/Shanghai",
      mode: "proposal-only", executionAuthority: "none", activation: "not-authorized", delivery: "none",
    });
  });

  it("rejects occupied output and unknown POC actions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-poc-cli-reject-"));
    const seedPath = path.join(root, "seed.json");
    const occupied = path.join(root, "occupied");
    await writeFile(seedPath, `${JSON.stringify(seed())}\n`, "utf8");
    await mkdir(occupied);

    const occupiedResult = await runCli(["poc", "build", "--seed", seedPath, "--out", occupied, "--json"]);
    assert.equal(occupiedResult.code, 1);
    assert.equal(JSON.parse(occupiedResult.stdout).code, "AGENTMO_POC_OUTPUT_EXISTS");

    const unknown = await runCli(["poc", "unknown", "--json"]);
    assert.equal(unknown.code, 1);
    assert.equal(JSON.parse(unknown.stdout).code, "AGENTMO_CLI_REQUEST_REJECTED");
  });

  it("validates the runtime env file before it can invoke OpenClaw", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-poc-cli-run-"));
    const seedPath = path.join(root, "seed.json");
    const workspace = path.join(root, "workspace");
    await writeFile(seedPath, `${JSON.stringify(seed())}\n`, "utf8");
    assert.equal((await runCli(["poc", "build", "--seed", seedPath, "--out", workspace, "--json"])).code, 0);

    const run = await runCli([
      "poc", "run", workspace,
      "--profile", "agentmo-poc-ai-frontier",
      "--model", "deepseek/deepseek-chat",
      "--runtime-env-file", path.join(root, "missing.env"),
      "--message", "请列出证据。",
      "--json",
    ]);
    assert.equal(run.code, 1);
    assert.equal(JSON.parse(run.stdout).code, "AGENTMO_POC_RUNTIME_ENV_UNAVAILABLE");
  });

  it("diagnoses a research source registry bound to a different agent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-poc-cli-collect-identity-"));
    const seedPath = path.join(root, "seed.json");
    const sourcesPath = path.join(root, "sources.json");
    const workspace = path.join(root, "workspace");
    await writeFile(seedPath, `${JSON.stringify(seed())}\n`, "utf8");
    await writeFile(sourcesPath, `${JSON.stringify({
      schemaVersion: "agentmo.poc-research-sources.v1",
      agentId: "different-agent",
      sources: [],
      skillCandidates: [],
    })}\n`, "utf8");
    assert.equal((await runCli(["poc", "build", "--seed", seedPath, "--out", workspace, "--json"])).code, 0);

    const collect = await runCli(["poc", "collect", workspace, "--sources", sourcesPath, "--json"]);
    assert.equal(collect.code, 1);
    assert.deepEqual(JSON.parse(collect.stdout), {
      schemaVersion: "agentmo.cli-error.v1",
      ok: false,
      code: "AGENTMO_POC_RESEARCH_INPUT_INVALID",
      category: "operation",
      guidance: "Review the operation prerequisites and retry without exposing local details.",
      pocDiagnostic: {
        operation: "collect",
        exitCode: 1,
        summary: "sources.agentId must match workspace.agentId.",
      },
    });
  });

  it("documents the explicit synthetic DNS proxy collection mode", async () => {
    const help = await runCli(["poc", "--help"]);
    assert.equal(help.code, 0, help.stderr);
    assert.match(help.stdout, /poc collect .*--network-mode public-only\|synthetic-dns-proxy/u);
  });

  it("reports bounded success and failure counts for a partial collection", () => {
    assert.deepEqual(summarizePocResearchCollection({
      agentId: "white-collar-research-poc",
      networkMode: "synthetic-dns-proxy",
      retrievals: [{ status: "retrieved" }, { status: "not-modified" }, { status: "failed" }],
      newlyAdmitted: 10,
      recordCount: 10,
    }), {
      agentId: "white-collar-research-poc",
      networkMode: "synthetic-dns-proxy",
      successfulSources: 2,
      retrievedSources: 1,
      failedSources: 1,
      newlyAdmitted: 10,
      recordCount: 10,
      scheduleExecuted: false,
      deliveryExecuted: false,
    });
  });
});
