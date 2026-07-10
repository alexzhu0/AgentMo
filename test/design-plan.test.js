import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildDesignPlan, validateDesignPlan, writeDesignPlan } from "../src/design-plan.js";
import { buildDiscoveryDb } from "../src/discovery-db.js";

const CLI = fileURLToPath(new URL("../bin/agentmo.js", import.meta.url));
const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

async function loadJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

async function supportInputs() {
  const manifest = await loadJson(new URL("../examples/support-triage.discovery.json", import.meta.url));
  const need = await loadJson(new URL("../examples/support-triage.need.json", import.meta.url));
  const discoveryDb = buildDiscoveryDb(manifest, { manifestPath: "examples/support-triage.discovery.json" });
  return { discoveryDb, need };
}

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

function assertNoSensitiveOutput(value, label, tempRoot = null, pointer = "$") {
  if (typeof value === "string") {
    assert.equal(value.includes(REPO_ROOT), false, `${label} ${pointer} leaked repo root`);
    assert.equal(value.includes("/home/"), false, `${label} ${pointer} leaked home path`);
    if (tempRoot) assert.equal(value.includes(tempRoot), false, `${label} ${pointer} leaked temp root`);
    assert.equal(value.includes(".env"), false, `${label} ${pointer} leaked denied env ref`);
    assert.equal(/\bsk-[A-Za-z0-9_-]{12,}\b|api[_-]?key\s*=|Bearer\s+[A-Za-z0-9._~+/-]+/u.test(value), false, `${label} ${pointer} leaked concrete secret marker: ${value}`);
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) assertNoSensitiveOutput(item, label, tempRoot, `${pointer}[${index}]`);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) assertNoSensitiveOutput(item, label, tempRoot, `${pointer}.${key}`);
  }
}

describe("design plan", () => {
  it("builds and validates a first-class Stage 2 design plan from DB plus need", async () => {
    const { discoveryDb, need } = await supportInputs();
    const plan = buildDesignPlan(discoveryDb, need, { target: "openclaw" });

    assert.equal(plan.schemaVersion, "agentmo.design-plan.v1");
    assert.equal(plan.ok, true);
    assert.equal(plan.agentId, "support-triage");
    assert.equal(plan.domain, "customer_support_ticket_triage");
    assert.equal(plan.targetRuntime, "openclaw");

    const expectedTraceCount = need.primary_tasks.length + need.success_criteria.length + need.hard_failures.length;
    assert.equal(plan.requirementsTrace.length, expectedTraceCount);
    assert.equal(plan.evidenceMap.length, expectedTraceCount);
    assert.equal(plan.requirementsTrace.every((entry) => ["supported", "partial", "missing"].includes(entry.coverage)), true);
    assert.equal(plan.requirementsTrace.some((entry) => entry.coverage === "supported"), true);

    const validation = validateDesignPlan(plan);
    assert.equal(validation.ok, true, validation.errors.join("\n"));
  });

  it("maps hard failures into eval and governance gates", async () => {
    const { discoveryDb, need } = await supportInputs();
    const plan = buildDesignPlan(discoveryDb, need, { target: "openclaw" });

    const hardFailureTrace = plan.requirementsTrace.filter((entry) => entry.requirementType === "hard_failure");
    assert.equal(hardFailureTrace.length, need.hard_failures.length);
    assert.deepEqual(plan.evalPlan.hardFailures.map((item) => item.requirementText), need.hard_failures);
    assert.equal(plan.governanceGates.some((gate) => gate.id === "fail-closed-hard-failures" && gate.status === "pass"), true);
    assert.equal(plan.governanceGates.some((gate) => gate.id === "missing-evidence-governed"), true);
  });

  it("discloses missing evidence and only stays ok when gaps are governed", async () => {
    const { discoveryDb, need } = await supportInputs();
    const sparseDb = { ...discoveryDb, facts: discoveryDb.facts.slice(0, 1) };
    const governed = buildDesignPlan(sparseDb, need, { target: "openclaw" });

    assert.equal(governed.requirementsTrace.some((entry) => entry.coverage !== "supported"), true);
    assert.equal(governed.gaps.length > 0, true);
    assert.equal(governed.evalPlan.missingEvidenceChecks.length, governed.gaps.length);
    assert.equal(governed.governanceGates.some((gate) => gate.id === "missing-evidence-governed" && gate.status === "pass"), true);
    assert.equal(governed.ok, true);

    const ungoverned = buildDesignPlan(sparseDb, need, { target: "openclaw", governMissingEvidence: false });
    assert.equal(ungoverned.ok, false);
    assert.equal(ungoverned.validation.ok, false);
    assert.match(ungoverned.validation.errors.join("\n"), /missing evidence/i);
  });

  it("fails closed for invalid need, mismatched agent id, and unsafe DB state", async () => {
    const { discoveryDb, need } = await supportInputs();

    const invalidNeed = structuredClone(need);
    delete invalidNeed.output_preferences;
    assert.throws(() => buildDesignPlan(discoveryDb, invalidNeed, { target: "openclaw" }), /invalid user need/i);

    const mismatchedNeed = structuredClone(need);
    mismatchedNeed.agent_id = "other-agent";
    assert.throws(() => buildDesignPlan(discoveryDb, mismatchedNeed, { target: "openclaw" }), /does not match user-need/i);

    const unsafeDb = structuredClone(discoveryDb);
    unsafeDb.safety.workspaceOk = false;
    unsafeDb.workspace = { ok: false };
    assert.throws(() => buildDesignPlan(unsafeDb, need, { target: "openclaw" }), /unsafe workspace/i);
  });

  it("does not require Stage 1 sidecars", async () => {
    const discoveryDb = await loadJson(new URL("../examples/fixtures/support-triage/prebuilt-discovery-db.json", import.meta.url));
    const need = await loadJson(new URL("../examples/support-triage.need.json", import.meta.url));
    const plan = buildDesignPlan(discoveryDb, need, { target: "openclaw" });
    assert.equal(plan.ok, true);
    assert.equal(plan.discoverySummary.factCount, discoveryDb.facts.length);
  });

  it("validates bounded source refs and rejects unsafe refs", async () => {
    const { discoveryDb, need } = await supportInputs();

    const allowed = structuredClone(need);
    allowed.source_refs = [
      "support-policy-handbook",
      "support-policy-handbook:field:01",
      "docs/AGENT_BIRTH_GATE.md",
      "https://example.com/support/policy",
    ];
    const allowedPlan = buildDesignPlan(discoveryDb, allowed, { target: "openclaw" });
    assert.deepEqual(allowedPlan.userNeedSummary.sourceRefs, allowed.source_refs);

    const deniedRefs = [
      "/tmp/host-secret.txt",
      "C:\\Users\\alex\\secret.txt",
      "\\\\server\\share\\credential.txt",
      "~/agentmo/notes.md",
      "${HOME}/notes.md",
      "../AgentHarness/README.md",
      ".env",
      "keys/private.pem",
      "https://user:pass@example.com/private",
      "file:///tmp/private.txt",
      "api_key=secret-value-123456",
    ];
    for (const ref of deniedRefs) {
      const denied = structuredClone(need);
      denied.source_refs = [ref];
      assert.throws(() => buildDesignPlan(discoveryDb, denied, { target: "openclaw" }), /source_refs/i, `ref should fail: ${ref}`);
    }
  });

  it("writes bounded reports without host paths or secret-like values", async () => {
    const { discoveryDb, need } = await supportInputs();
    const tempRoot = await mkdtemp(path.join(tmpdir(), "agentmo-design-plan-"));
    const out = path.join(tempRoot, "agentmo-design-plan.json");
    const plan = buildDesignPlan(discoveryDb, need, { target: "openclaw" });
    const written = await writeDesignPlan(out, plan);
    assert.equal(written, out);
    const saved = JSON.parse(await readFile(out, "utf8"));
    assertNoSensitiveOutput(saved, "design plan", tempRoot);
  });

  it("CLI design-plan writes an artifact and bounded JSON report", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "agentmo-design-plan-cli-"));
    const dbPath = path.join(tempRoot, "agentmo-discovery-db.json");
    const outPath = path.join(tempRoot, "agentmo-design-plan.json");
    const { discoveryDb } = await supportInputs();
    await writeDesignPlan(dbPath, discoveryDb);

    const result = await runCli([
      "design-plan",
      dbPath,
      "--need",
      fileURLToPath(new URL("../examples/support-triage.need.json", import.meta.url)),
      "--out",
      outPath,
      "--target",
      "openclaw",
      "--json",
    ]);

    assert.equal(result.code, 0, result.stderr);
    const json = JSON.parse(result.stdout);
    assert.equal(json.report.ok, true);
    assert.equal(json.report.agentId, "support-triage");
    assert.equal(json.report.designPlanPath, "agentmo-design-plan.json");
    assertNoSensitiveOutput(json, "design-plan stdout", tempRoot);
    const saved = JSON.parse(await readFile(outPath, "utf8"));
    assert.equal(saved.schemaVersion, "agentmo.design-plan.v1");
  });

  it("CLI design-plan fails closed on unsafe DB and writes no success artifact", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "agentmo-design-plan-bad-db-"));
    const dbPath = path.join(tempRoot, "agentmo-discovery-db.json");
    const outPath = path.join(tempRoot, "agentmo-design-plan.json");
    const { discoveryDb } = await supportInputs();
    const unsafe = structuredClone(discoveryDb);
    unsafe.safety.workspaceOk = false;
    await writeDesignPlan(dbPath, unsafe);

    const result = await runCli([
      "design-plan",
      dbPath,
      "--need",
      fileURLToPath(new URL("../examples/support-triage.need.json", import.meta.url)),
      "--out",
      outPath,
      "--target",
      "openclaw",
      "--json",
    ]);

    assert.notEqual(result.code, 0);
    await assert.rejects(readFile(outPath, "utf8"));
  });
});
