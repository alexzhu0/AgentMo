import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  getArtifactContract,
  listArtifactContractSubjects,
} from "../src/artifact-contract.js";
import { validateDiscoveryManifest } from "../src/discovery.js";
import { validateUserNeed } from "../src/user-need.js";

const CLI = fileURLToPath(new URL("../bin/agentmo.js", import.meta.url));

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("operator-authored artifact contracts", () => {
  it("exports closed subjects whose minimal templates pass production validators", () => {
    assert.deepEqual(listArtifactContractSubjects(), ["discovery-manifest", "user-need"]);

    const discovery = getArtifactContract("discovery-manifest");
    const need = getArtifactContract("user-need");
    assert.equal(discovery.schemaVersion, "agentmo.artifact-contract.v1");
    assert.equal(need.schemaVersion, "agentmo.artifact-contract.v1");
    assert.equal(validateDiscoveryManifest(discovery.minimalTemplate).ok, true);
    assert.equal(validateUserNeed(need.minimalTemplate).ok, true);
    assert.deepEqual(discovery.jsonSchema.required, [
      "schemaVersion",
      "agent_id",
      "source_inventory",
      "database_outputs",
      "retrieval_outputs",
      "user_need_inputs",
      "refresh_policy",
      "forbidden_data_handling",
    ]);
    assert.equal(getArtifactContract("unknown"), null);
  });

  it("exposes contracts and bounded per-command help through the public CLI", async () => {
    const contractResult = await runCli(["artifact-contract", "discovery-manifest", "--json"]);
    assert.equal(contractResult.code, 0, contractResult.stderr);
    assert.equal(contractResult.stderr, "");
    const contract = JSON.parse(contractResult.stdout);
    assert.equal(contract.subject, "discovery-manifest");
    assert.equal(contract.minimalTemplate.schemaVersion, "agentmo.discovery.v1");

    const discoverHelp = await runCli(["discover-report", "--help"]);
    assert.equal(discoverHelp.code, 0, discoverHelp.stderr);
    assert.match(discoverHelp.stdout, /artifact-contract discovery-manifest --json/u);

    const needHelp = await runCli(["help", "need-report"]);
    assert.equal(needHelp.code, 0, needHelp.stderr);
    assert.match(needHelp.stdout, /artifact-contract user-need --json/u);
  });

  it("returns secret-safe field issues for a digest-bound malformed discovery manifest", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-artifact-contract-"));
    const file = path.join(root, "invalid.discovery.json");
    const privateCanary = "operator-private-description-canary";
    const bytes = Buffer.from(`${JSON.stringify({
      schemaVersion: "agentmo.discovery.v1",
      goal: privateCanary,
      sources: [],
    }, null, 2)}\n`, "utf8");
    await writeFile(file, bytes);

    const result = await runCli([
      "discover-report",
      file,
      "--digest",
      `discovery-manifest=${digest(bytes)}`,
      "--json",
    ]);
    assert.equal(result.code, 1);
    assert.equal(result.stderr, "");
    const error = JSON.parse(result.stdout);
    assert.equal(error.code, "AGENTMO_UNSUPPORTED_ARTIFACT");
    assert.equal(error.subject, "discovery-manifest");
    assert.equal(error.issues.includes("agent_id must be a non-empty string."), true);
    assert.equal(error.issues.includes("source_inventory must be an array."), true);
    assert.match(error.guidance, /artifact-contract discovery-manifest --json/u);
    assert.equal(result.stdout.includes(privateCanary), false);
    assert.equal(result.stdout.includes(root), false);
  });
});
