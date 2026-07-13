import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { describe, it } from "node:test";
import { open, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildUserNeedReport, loadUserNeed, validateUserNeed } from "../src/user-need.js";

const SUPPORT_NEED = new URL("../examples/support-triage.need.json", import.meta.url);
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

async function loadSupportNeed() {
  return JSON.parse(await readFile(SUPPORT_NEED, "utf8"));
}

describe("user need", () => {
  it("loads exact user-need bytes once under the canonical subject", async () => {
    const bytes = await readFile(SUPPORT_NEED);
    let openCount = 0;
    const need = await loadUserNeed(SUPPORT_NEED, {
      subject: "user-need",
      expectedDigest: digest(bytes),
      openInput: async (...args) => {
        openCount += 1;
        return open(...args);
      },
    });
    assert.equal(need.schemaVersion, "agentmo.user-need.v1");
    assert.equal(openCount, 1);
    await assert.rejects(
      () => loadUserNeed(SUPPORT_NEED, {
        subject: "design-plan",
        expectedDigest: digest(bytes),
      }),
      (error) => error.code === "AGENTMO_UNSUPPORTED_ARTIFACT",
    );
  });

  it("runs need-report in a fresh process only with its exact binding", async () => {
    const bytes = await readFile(SUPPORT_NEED);
    const success = await runCli([
      "need-report",
      fileURLToPath(SUPPORT_NEED),
      "--digest",
      `user-need=${digest(bytes)}`,
      "--json",
    ]);
    assert.equal(success.code, 0, success.stderr);
    assert.equal(JSON.parse(success.stdout).ok, true);

    const missing = await runCli(["need-report", fileURLToPath(SUPPORT_NEED), "--json"]);
    assert.equal(missing.code, 1);
    assert.equal(JSON.parse(missing.stdout).code, "AGENTMO_ARTIFACT_DIGEST_REQUIRED");
  });
  it("validates and summarizes a concrete user-need brief", async () => {
    const need = await loadSupportNeed();
    const report = buildUserNeedReport(need);
    assert.equal(report.kind, "agentmo_user_need_report");
    assert.equal(report.ok, true);
    assert.equal(report.summary.agent_id, "support-triage");
    assert.equal(report.summary.primary_task_count, 3);
    assert.equal(report.summary.hard_failure_count, 4);
  });

  it("fails closed when required need fields are missing", async () => {
    const need = await loadSupportNeed();
    delete need.output_preferences;
    const validation = validateUserNeed(need);
    assert.equal(validation.ok, false);
    assert.match(validation.errors.join("\n"), /output_preferences must be an object/u);
  });

  it("fails closed when user-need input contains secret-like values", async () => {
    const need = await loadSupportNeed();
    need.problem = "Support flow api_key=secret-value-123456 should not be accepted.";
    const validation = validateUserNeed(need);
    assert.equal(validation.ok, false);
    assert.match(validation.errors.join("\n"), /secret-like string values are not allowed/u);
  });

  it("fails closed when source refs are not bounded review refs", async () => {
    const need = await loadSupportNeed();
    need.source_refs = ["../AgentHarness/README.md"];
    const validation = validateUserNeed(need);
    assert.equal(validation.ok, false);
    assert.match(validation.errors.join("\n"), /source_refs/);
  });

});
