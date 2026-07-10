import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
const CLI = fileURLToPath(new URL("../bin/agentmo.js", import.meta.url));
const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
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
  it("prints help that exposes design-plan, domain, and delivery report commands", async () => {
    const help = await runCli(["help"]);
    assert.equal(help.code, 0, help.stderr);
    assert.match(help.stdout, /agentmo design-plan <agentmo-discovery-db\.json> --need <need\.json>/u);
    assert.match(help.stdout, /agentmo blueprint-draft <agentmo-discovery-db\.json> --need <need\.json> \[--design-plan/u);
    assert.match(help.stdout, /agentmo domain-eval <blueprint\.json> --cases <cases\.json>/u);
    assert.match(help.stdout, /agentmo delivery-report <blueprint\.json> --build-state <agentmo-build-state\.json>/u);
    assert.match(help.stdout, /design-plan\s+Produce a Stage 2 planning contract/u);
    assert.match(help.stdout, /domain-eval\s+Evaluate deterministic domain cases/u);
    assert.match(help.stdout, /delivery-report\s+Re-validate and aggregate delivery closure evidence/u);
  });

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

  it("scrubs denied discover-pack source locations from stdout and artifacts while preserving ordinary URLs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-cli-denied-discovery-location-"));
    const manifestPath = path.join(root, "denied-location.discovery.json");
    const out = path.join(root, "out");
    const deniedLocations = [".env", ".env.local", "private.key", "credentials.json"];
    const manifest = {
      schemaVersion: "agentmo.discovery.v1",
      agent_id: "support-triage",
      source_inventory: [
        ...deniedLocations.map((location, index) => ({
          id: `denied-location-${index + 1}`,
          type: "document",
          trust_level: "verified",
          description: `Denied location CLI fixture ${index + 1}`,
          location,
          extraction_fields: [`Denied location CLI field ${index + 1}`],
        })),
        {
          id: "ordinary-url-doc",
          type: "document",
          trust_level: "verified",
          description: "Ordinary URL documentation path",
          location: "https://example.com/docs/policy",
          extraction_fields: ["Ordinary URL field"],
        },
      ],
      database_outputs: ["safe discovery database"],
      retrieval_outputs: ["safe retrieval facts"],
      user_need_inputs: ["triage incoming support tickets by category and priority"],
      refresh_policy: {
        cadence: "before every fixture update",
        owner: "test engineer",
        stale_after: "30 days",
      },
      forbidden_data_handling: ["Do not store credentials, raw transcripts, or raw tool bodies in managed evidence."],
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const result = await runCli(["discover-pack", manifestPath, "--out", out, "--json"]);

    assert.equal(result.code, 1, result.stderr);
    const json = JSON.parse(result.stdout);
    assert.equal(json.ok, false);
    assert.equal(json.checks.find((check) => check.id === "durable_source_location_policy")?.pass, false);
    assert.equal(json.discoveryDb.safety.deniedSourceLocationCount, deniedLocations.length);
    assert.equal(json.discoveryDb.sources.find((source) => source.id === "ordinary-url-doc").location, "https://example.com/docs/policy");
    assert.deepEqual(json.discoveryDb.facts.find((fact) => fact.sourceId === "ordinary-url-doc").refs, [
      "https://example.com/docs/policy",
    ]);
    for (const sourceId of ["denied-location-1", "denied-location-2", "denied-location-3", "denied-location-4"]) {
      assert.equal(json.discoveryDb.sources.find((source) => source.id === sourceId).location, null);
      assert.deepEqual(json.discoveryDb.facts.find((fact) => fact.sourceId === sourceId).refs, []);
    }
    assert.deepEqual(await listFiles(out), ["agentmo-discovery-db.json", "coverage.json", "facts.jsonl"]);

    const discoveryDbText = await readFile(path.join(out, "agentmo-discovery-db.json"), "utf8");
    const factsText = await readFile(path.join(out, "facts.jsonl"), "utf8");
    const coverageText = await readFile(path.join(out, "coverage.json"), "utf8");
    for (const [label, text] of [
      ["discover-pack stdout", result.stdout],
      ["discover-pack stderr", result.stderr],
      ["discover-pack discovery DB", discoveryDbText],
      ["discover-pack facts JSONL", factsText],
      ["discover-pack coverage JSON", coverageText],
    ]) {
      for (const deniedLocation of deniedLocations) {
        assert.equal(text.includes(deniedLocation), false, `${label} must not contain denied location ${deniedLocation}`);
      }
    }
  });

  it("scrubs absolute paths from fatal missing and invalid discovery manifest errors", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-cli-fatal-manifest-"));
    const missingManifest = path.join(root, "missing.discovery.json");
    const invalidManifest = path.join(root, "invalid.discovery.json");
    const out = path.join(root, "out");
    await writeFile(invalidManifest, "{ not valid json", "utf8");

    const missing = await runCli(["discover-workspace", missingManifest, "--source-root", ".", "--out", out, "--json"]);
    assert.equal(missing.code, 1);
    assert.equal(missing.stdout, "");
    assert.equal(missing.stderr.includes(missingManifest), false);
    assert.equal(missing.stderr.includes(root), false);
    assert.equal(missing.stderr.includes(REPO_ROOT), false);

    const invalid = await runCli(["discover-workspace", invalidManifest, "--source-root", ".", "--out", out, "--json"]);
    assert.equal(invalid.code, 1);
    assert.equal(invalid.stdout, "");
    assert.equal(invalid.stderr.includes(invalidManifest), false);
    assert.equal(invalid.stderr.includes(root), false);
    assert.equal(invalid.stderr.includes(REPO_ROOT), false);

    const etcManifest = "/etc/agentmo-missing-manifest-should-redact.discovery.json";
    const etcMissing = await runCli(["discover-pack", etcManifest, "--out", out, "--json"]);
    assert.equal(etcMissing.code, 1);
    assert.equal(etcMissing.stdout, "");
    assert.equal(etcMissing.stderr.includes(etcManifest), false);
    assert.match(etcMissing.stderr, /\[REDACTED_PATH\]/u);
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

  it("prints OpenClaw runtime plan JSON and writes no files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agentmo-cli-runtime-plan-"));
    const result = await runCli([
      "run-plan",
      BLUEPRINT,
      "--target",
      "openclaw",
      "--workspace",
      dir,
      "--agent",
      "win9",
      "--message",
      "Say exactly: ok",
      "--provider",
      "openai",
      "--model",
      "gpt-5.5",
      "--thinking",
      "off",
      "--channel",
      "local-cli",
      "--transport",
      "local",
      "--fallback-from",
      "pi",
      "--json",
    ]);
    assert.equal(result.code, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.schemaVersion, "agentmo.runtime-plan.v1");
    assert.equal(plan.target.id, "openclaw");
    assert.equal(plan.executionSessionPolicy, "fresh-per-run");
    assert.equal(plan.runtimeIdentity.selector.executionSelector.sessionKey, "<fresh-run-session-key>");
    assert.equal(plan.runtimeIdentity.sandboxScope.usesProductionState, false);
    assert.equal(plan.runtimeIdentity.provider, "openai");
    assert.equal(plan.runtimeIdentity.model, "gpt-5.5");
    assert.equal(plan.runtimeIdentity.thinking, "off");
    assert.equal(plan.runtimeIdentity.channel, "local-cli");
    assert.equal(plan.runtimeIdentity.transport, "local");
    assert.equal(plan.runtimeIdentity.fallbackFrom, "pi");
    assert.deepEqual(plan.command.args, [
      "agent",
      "--local",
      "--json",
      "--model",
      "gpt-5.5",
      "--thinking",
      "off",
      "--agent",
      "win9",
      "--session-key",
      "<fresh-run-session-key>",
      "--message",
      "Say exactly: ok",
    ]);
    assert.deepEqual(await readdir(dir), []);
  });

  it("prints env-file metadata without leaking env values", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agentmo-cli-runtime-env-"));
    const envFile = path.join(dir, ".env");
    await writeFile(envFile, "DEEPSEEK_API_KEY=cli-secret-value\nDEEPSEEK_BASE_URL=https://api.deepseek.com\n", "utf8");
    const result = await runCli([
      "run-plan",
      BLUEPRINT,
      "--target",
      "openclaw",
      "--workspace",
      dir,
      "--agent",
      "win9",
      "--message",
      "Secret is cli-secret-value",
      "--provider",
      "deepseek",
      "--model",
      "deepseek/deepseek-v4-flash",
      "--channel",
      "local-cli",
      "--transport",
      "local",
      "--env-file",
      envFile,
      "--json",
    ]);
    assert.equal(result.code, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.runtimeIdentity.runtimeEnv.envFile.basename, ".env");
    assert.equal(plan.runtimeIdentity.runtimeEnv.envFile.fullPathPersisted, false);
    assert.deepEqual(plan.runtimeIdentity.runtimeEnv.presentKeys, ["DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL"]);
    assert.equal(result.stdout.includes("cli-secret-value"), false);
    assert.equal(result.stdout.includes(envFile), false);
    assert.equal(plan.message.messagePreview.includes("[REDACTED_SECRET]"), true);
  });

  it("writes non-live OpenClaw run-state JSON and index", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "agentmo-cli-run-workspace-"));
    const out = await mkdtemp(path.join(tmpdir(), "agentmo-cli-run-out-"));
    const result = await runCli([
      "run",
      BLUEPRINT,
      "--target",
      "openclaw",
      "--workspace",
      workspace,
      "--agent",
      "win9",
      "--message",
      "Say exactly: ok",
      "--provider",
      "openai",
      "--model",
      "gpt-5.5",
      "--channel",
      "local-cli",
      "--transport",
      "local",
      "--out",
      out,
      "--json",
    ]);
    assert.equal(result.code, 0, result.stderr);
    const state = JSON.parse(result.stdout);
    assert.equal(state.schemaVersion, "agentmo.run.v1");
    assert.equal(state.execution.executed, false);
    assert.equal(state.execution.status, "declared");
    assert.equal(state.runtimeIdentity.selector.executionSelector.sessionKey.startsWith("agentmo-win9-"), true);
    assert.equal(state.runtimeIdentity.sandboxScope.usesProductionState, false);
    assert.equal(state.runtimeIdentity.provider, "openai");
    assert.equal(state.runtimeIdentity.model, "gpt-5.5");
    assert.equal(state.runtimeIdentity.channel, "local-cli");
    assert.equal(state.runtimeIdentity.transport, "local");
    assert.equal(state.certificationBoundary.runEvidenceCertifiesRuntime, false);
    const stateFile = path.join(out, "runs", state.runId, "agentmo-run-state.json");
    const indexFile = path.join(out, "agentmo-run-index.json");
    const savedState = JSON.parse(await readFile(stateFile, "utf8"));
    const index = JSON.parse(await readFile(indexFile, "utf8"));
    assert.equal(savedState.runId, state.runId);
    assert.equal(index.latestRunId, state.runId);

    const report = await runCli(["run-report", stateFile, "--json"]);
    assert.equal(report.code, 0, report.stderr);
    const reportJson = JSON.parse(report.stdout);
    assert.equal(reportJson.schemaVersion, "agentmo.run-report.v1");
    assert.equal(reportJson.observationRef, `agentmo-run:${state.runId}`);

    const evaluation = await runCli(["run-eval", stateFile, "--expect-status", "declared", "--json"]);
    assert.equal(evaluation.code, 0, evaluation.stderr);
    const evalJson = JSON.parse(evaluation.stdout);
    assert.equal(evalJson.schemaVersion, "agentmo.run-eval.v1");
    assert.equal(evalJson.ok, true);
    assert.equal(evalJson.certificationBoundary.runtimeCertifiedByRun, false);

    const statusByState = await runCli(["status", BLUEPRINT, "--run-state", stateFile, "--json"]);
    assert.equal(statusByState.code, 0, statusByState.stderr);
    const stateSnapshot = JSON.parse(statusByState.stdout);
    assert.equal(stateSnapshot.latestRunState.available, true);
    assert.equal(stateSnapshot.latestRunState.runId, state.runId);
    assert.equal(stateSnapshot.latestRunState.runtimeIdentity.transport, "local");

    const observationFile = path.join(out, "declared-run.observation.json");
    const observation = await runCli(["observe-run", stateFile, "--out", observationFile, "--json"]);
    assert.equal(observation.code, 0, observation.stderr);
    const observationJson = JSON.parse(observation.stdout);
    assert.equal(observationJson.observationFile, observationFile);
    assert.equal(observationJson.observation.schemaVersion, "agentmo.observation.v1");
    assert.equal(observationJson.observation.source, `agentmo-run:${state.runId}`);
    assert.equal(observationJson.observation.failureMode.includes("declared"), true);
    assert.equal(observationJson.report.ok, true);
    const observed = await runCli(["observe", observationFile, "--json"]);
    assert.equal(observed.code, 0, observed.stderr);
    assert.equal(JSON.parse(observed.stdout).ok, true);

    const second = await runCli([
      "run",
      BLUEPRINT,
      "--target",
      "openclaw",
      "--workspace",
      workspace,
      "--agent",
      "win9",
      "--message",
      "Second run",
      "--out",
      out,
      "--json",
    ]);
    assert.equal(second.code, 0, second.stderr);
    const secondState = JSON.parse(second.stdout);

    const statusByDir = await runCli(["status", BLUEPRINT, "--run-dir", out, "--json"]);
    assert.equal(statusByDir.code, 0, statusByDir.stderr);
    const dirSnapshot = JSON.parse(statusByDir.stdout);
    assert.equal(dirSnapshot.latestRunState.runId, secondState.runId);

    const explicitWins = await runCli(["status", BLUEPRINT, "--run-state", stateFile, "--run-dir", out, "--json"]);
    assert.equal(explicitWins.code, 0, explicitWins.stderr);
    const explicitSnapshot = JSON.parse(explicitWins.stdout);
    assert.equal(explicitSnapshot.latestRunState.runId, state.runId);

    const replayOut = await mkdtemp(path.join(tmpdir(), "agentmo-cli-replay-out-"));
    const replay = await runCli(["replay-run", stateFile, "--out", replayOut, "--json"]);
    assert.equal(replay.code, 0, replay.stderr);
    const replayState = JSON.parse(replay.stdout);
    assert.equal(replayState.parentRunId, state.runId);
    assert.equal(replayState.replay.policy, "fresh-child-session");
    assert.notEqual(
      replayState.runtimeIdentity.selector.executionSelector.sessionKey,
      state.runtimeIdentity.selector.executionSelector.sessionKey,
    );
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

    const runPlan = await runCli(["run-plan", BLUEPRINT, "--target", "missing", "--workspace", "/tmp/x", "--message", "ping", "--json"]);
    assert.equal(runPlan.code, 1);
    assert.match(runPlan.stderr, /Unknown run-plan target: missing. Expected one of: agentmo, openclaw/u);

    const run = await runCli(["run", BLUEPRINT, "--target", "missing", "--workspace", "/tmp/x", "--message", "ping", "--out", "/tmp/y", "--json"]);
    assert.equal(run.code, 1);
    assert.match(run.stderr, /Unknown run-plan target: missing. Expected one of: agentmo, openclaw/u);

    const dir = await mkdtemp(path.join(tmpdir(), "agentmo-cli-missing-"));
    const scaffold = await runCli(["scaffold", BLUEPRINT, "--target", "missing", "--out", dir]);
    assert.equal(scaffold.code, 1);
    assert.match(scaffold.stderr, /Unknown scaffold target: missing. Expected one of: agentmo, openclaw/u);
  });
});
