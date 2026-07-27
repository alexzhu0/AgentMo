import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { access, mkdtemp, open, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadAdmittedArtifact } from "../src/artifact-admission.js";
import { buildDesignPlan, loadDesignPlan, validateDesignPlan, writeDesignPlan } from "../src/design-plan.js";
import { loadDiscoveryDb } from "../src/discovery-db.js";
import { loadUserNeed } from "../src/user-need.js";

const CLI = fileURLToPath(new URL("../bin/agentmo.js", import.meta.url));
const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DISCOVERY_DB_FILE = fileURLToPath(new URL("../examples/fixtures/support-triage/prebuilt-discovery-db.json", import.meta.url));
const USER_NEED_FILE = fileURLToPath(new URL("../examples/support-triage.need.json", import.meta.url));

async function loadJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

async function supportInputs() {
  const discoveryDbAdmission = await admitFile(DISCOVERY_DB_FILE, "discovery-db");
  const userNeedAdmission = await admitFile(USER_NEED_FILE, "user-need");
  return {
    discoveryDb: discoveryDbAdmission.value,
    need: userNeedAdmission.value,
    admissions: {
      discoveryDb: discoveryDbAdmission,
      userNeed: userNeedAdmission,
    },
  };
}

async function admitFile(file, subject) {
  const bytes = await readFile(file);
  return loadAdmittedArtifact({ filePath: file, subject, expectedDigest: digest(bytes) });
}

async function admitValue(value, subject) {
  const root = await mkdtemp(path.join(tmpdir(), `agentmo-${subject}-admit-`));
  const file = path.join(root, `${subject}.json`);
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  await writeFile(file, bytes);
  return loadAdmittedArtifact({ filePath: file, subject, expectedDigest: digest(bytes) });
}

function planOptions(inputs, extra = {}) {
  return { target: "openclaw", admissions: inputs.admissions, ...extra };
}

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
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

async function digestFile(file) {
  return `sha256:${createHash("sha256").update(await readFile(file)).digest("hex")}`;
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
    const { discoveryDb, need, admissions } = await supportInputs();
    const plan = buildDesignPlan(discoveryDb, need, planOptions({ admissions }));

    assert.equal(plan.schemaVersion, "agentmo.design-plan.v1");
    assert.equal(plan.ok, true);
    assert.equal(plan.agentId, "support-triage");
    assert.equal(plan.domain, "customer_support_ticket_triage");
    assert.equal(plan.targetRuntime, "openclaw");

    const expectedTraceCount = need.primary_tasks.length + need.success_criteria.length + need.hard_failures.length;
    assert.equal(plan.requirementsTrace.length, expectedTraceCount);
    assert.equal(plan.evidenceMap.length, expectedTraceCount);
    assert.equal(plan.requirementsTrace.every((entry) => ["supported", "partial", "missing"].includes(entry.coverage)), true);
    assert.equal(
      plan.requirementsTrace.some((entry) => entry.coverage === "supported"),
      false,
      "manifest extraction-field declarations must not certify collected evidence",
    );
    assert.equal(plan.gaps.length, expectedTraceCount);

    const validation = validateDesignPlan(plan);
    assert.equal(validation.ok, true, validation.errors.join("\n"));
  });

  it("only marks requirements supported from multiple trusted source chunks", async () => {
    const { discoveryDb, need, admissions } = await supportInputs();
    const evidencedDb = structuredClone(discoveryDb);
    evidencedDb.facts.push(
      {
        id: "ticket-taxonomy:chunk:01",
        sourceId: "ticket-taxonomy",
        kind: "source_chunk",
        text: "Support operations classify every ticket category before choosing its priority.",
        trustLevel: "trusted",
        refs: ["examples/fixtures/support-triage/ticket-taxonomy.json"],
        tags: ["database", "json"],
      },
      {
        id: "support-policy-handbook:chunk:01",
        sourceId: "support-policy-handbook",
        kind: "source_chunk",
        text: "Ticket category and priority determine the required escalation path.",
        trustLevel: "verified",
        refs: ["examples/fixtures/support-triage/policy-handbook.md"],
        tags: ["document", "md"],
      },
    );
    const evidencedAdmission = await admitValue(evidencedDb, "discovery-db");
    const evidencedInputs = {
      discoveryDb: evidencedAdmission.value,
      need,
      admissions: { ...admissions, discoveryDb: evidencedAdmission },
    };

    const plan = buildDesignPlan(
      evidencedInputs.discoveryDb,
      need,
      planOptions(evidencedInputs),
    );
    const classification = plan.requirementsTrace.find(
      (entry) => entry.requirementId === "primary-task-01",
    );

    assert.equal(classification.coverage, "supported");
    assert.deepEqual(classification.matchedSourceIds, [
      "support-policy-handbook",
      "ticket-taxonomy",
    ]);
  });

  it("caps unverified source chunks at partial coverage", async () => {
    const { discoveryDb, need, admissions } = await supportInputs();
    const unverifiedDb = structuredClone(discoveryDb);
    unverifiedDb.facts.push(
      {
        id: "ticket-taxonomy:chunk:01",
        sourceId: "ticket-taxonomy",
        kind: "source_chunk",
        text: "Support operations classify every ticket category before choosing its priority.",
        trustLevel: "unverified",
        refs: ["examples/fixtures/support-triage/ticket-taxonomy.json"],
        tags: ["database", "json"],
      },
      {
        id: "support-policy-handbook:chunk:01",
        sourceId: "support-policy-handbook",
        kind: "source_chunk",
        text: "Ticket category and priority determine the required escalation path.",
        trustLevel: "unverified",
        refs: ["examples/fixtures/support-triage/policy-handbook.md"],
        tags: ["document", "md"],
      },
    );
    const unverifiedAdmission = await admitValue(unverifiedDb, "discovery-db");
    const unverifiedInputs = {
      discoveryDb: unverifiedAdmission.value,
      need,
      admissions: { ...admissions, discoveryDb: unverifiedAdmission },
    };

    const plan = buildDesignPlan(
      unverifiedInputs.discoveryDb,
      need,
      planOptions(unverifiedInputs),
    );
    const classification = plan.requirementsTrace.find(
      (entry) => entry.requirementId === "primary-task-01",
    );

    assert.equal(classification.coverage, "partial");
    assert.equal(plan.gaps.some((gap) => gap.requirementId === classification.requirementId), true);
  });

  it("maps hard failures into eval and governance gates", async () => {
    const { discoveryDb, need, admissions } = await supportInputs();
    const plan = buildDesignPlan(discoveryDb, need, planOptions({ admissions }));

    const hardFailureTrace = plan.requirementsTrace.filter((entry) => entry.requirementType === "hard_failure");
    assert.equal(hardFailureTrace.length, need.hard_failures.length);
    assert.deepEqual(plan.evalPlan.hardFailures.map((item) => item.requirementText), need.hard_failures);
    assert.equal(plan.governanceGates.some((gate) => gate.id === "fail-closed-hard-failures" && gate.status === "pass"), true);
    assert.equal(plan.governanceGates.some((gate) => gate.id === "missing-evidence-governed"), true);
  });

  it("discloses missing evidence and only stays ok when gaps are governed", async () => {
    const { discoveryDb, need, admissions } = await supportInputs();
    const sparseDb = { ...discoveryDb, facts: discoveryDb.facts.slice(0, 1) };
    const sparseAdmission = await admitValue(sparseDb, "discovery-db");
    const sparseInputs = {
      discoveryDb: sparseAdmission.value,
      need,
      admissions: { ...admissions, discoveryDb: sparseAdmission },
    };
    const governed = buildDesignPlan(sparseInputs.discoveryDb, need, planOptions(sparseInputs));

    assert.equal(governed.requirementsTrace.some((entry) => entry.coverage !== "supported"), true);
    assert.equal(governed.gaps.length > 0, true);
    assert.equal(governed.evalPlan.missingEvidenceChecks.length, governed.gaps.length);
    assert.equal(governed.governanceGates.some((gate) => gate.id === "missing-evidence-governed" && gate.status === "pass"), true);
    assert.equal(governed.ok, true);

    const ungoverned = buildDesignPlan(
      sparseInputs.discoveryDb,
      need,
      planOptions(sparseInputs, { governMissingEvidence: false }),
    );
    assert.equal(ungoverned.ok, false);
    assert.equal(ungoverned.validation.ok, false);
    assert.match(ungoverned.validation.errors.join("\n"), /missing evidence/i);
  });

  it("fails closed for invalid need, mismatched agent id, and unsafe DB state", async () => {
    const { discoveryDb, need, admissions } = await supportInputs();

    const invalidNeed = structuredClone(need);
    delete invalidNeed.output_preferences;
    assert.throws(() => buildDesignPlan(discoveryDb, invalidNeed, planOptions({ admissions })), /invalid user need/i);

    const mismatchedNeed = structuredClone(need);
    mismatchedNeed.agent_id = "other-agent";
    assert.throws(() => buildDesignPlan(discoveryDb, mismatchedNeed, planOptions({ admissions })), /does not match user-need/i);

    const unsafeDb = structuredClone(discoveryDb);
    unsafeDb.safety.workspaceOk = false;
    unsafeDb.workspace = { ok: false };
    assert.throws(() => buildDesignPlan(unsafeDb, need, planOptions({ admissions })), /unsafe workspace/i);
  });

  it("does not require Stage 1 sidecars", async () => {
    const { discoveryDb, need, admissions } = await supportInputs();
    const plan = buildDesignPlan(discoveryDb, need, planOptions({ admissions }));
    assert.equal(plan.ok, true);
    assert.equal(plan.discoverySummary.factCount, discoveryDb.facts.length);
  });

  it("validates bounded source refs and rejects unsafe refs", async () => {
    const { discoveryDb, need, admissions } = await supportInputs();

    const allowed = structuredClone(need);
    allowed.source_refs = [
      "support-policy-handbook",
      "support-policy-handbook:field:01",
      "docs/AGENT_BIRTH_GATE.md",
      "https://example.com/support/policy",
    ];
    const allowedAdmission = await admitValue(allowed, "user-need");
    const allowedPlan = buildDesignPlan(discoveryDb, allowedAdmission.value, {
      target: "openclaw",
      admissions: { ...admissions, userNeed: allowedAdmission },
    });
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
      assert.throws(
        () => buildDesignPlan(discoveryDb, denied, planOptions({ admissions })),
        /source_refs/i,
        `ref should fail: ${ref}`,
      );
    }
  });

  it("writes bounded reports without host paths or secret-like values", async () => {
    const { discoveryDb, need, admissions } = await supportInputs();
    const tempRoot = await mkdtemp(path.join(tmpdir(), "agentmo-design-plan-"));
    const out = path.join(tempRoot, "agentmo-design-plan.json");
    const plan = buildDesignPlan(discoveryDb, need, planOptions({ admissions }));
    const written = await writeDesignPlan(out, plan);
    assert.equal(written, out);
    const firstBytes = await readFile(out, "utf8");
    const secondOut = path.join(tempRoot, "agentmo-design-plan-copy.json");
    await writeDesignPlan(secondOut, plan);
    assert.equal(await readFile(secondOut, "utf8"), firstBytes);
    const saved = JSON.parse(firstBytes);
    assertNoSensitiveOutput(saved, "design plan", tempRoot);
    assert.deepEqual(Object.keys(saved.source.discoveryDb), ["identity", "subject", "digest"]);
    assert.deepEqual(Object.keys(saved.source.userNeed), ["identity", "subject", "digest"]);
  });

  it("loads design plans once and closes every DB/need/plan loader pairing", async () => {
    const inputs = await supportInputs();
    const plan = buildDesignPlan(inputs.discoveryDb, inputs.need, planOptions(inputs));
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-plan-loader-matrix-"));
    const planPath = path.join(root, "agentmo-design-plan.json");
    await writeDesignPlan(planPath, plan);
    const planBytes = await readFile(planPath);
    let openCount = 0;
    const loaded = await loadDesignPlan(planPath, {
      subject: "design-plan",
      expectedDigest: digest(planBytes),
      openInput: async (...args) => {
        openCount += 1;
        return open(...args);
      },
    });
    assert.equal(loaded.schemaVersion, "agentmo.design-plan.v1");
    assert.equal(openCount, 1);

    const artifacts = [
      { family: "discovery-db", file: DISCOVERY_DB_FILE, digest: digest(await readFile(DISCOVERY_DB_FILE)) },
      { family: "user-need", file: USER_NEED_FILE, digest: digest(await readFile(USER_NEED_FILE)) },
      { family: "design-plan", file: planPath, digest: digest(planBytes) },
    ];
    const loaders = [
      {
        family: "discovery-db",
        load: (file, expectedDigest) => loadDiscoveryDb(file, {
          subject: "discovery-db",
          expectedDigest,
        }),
      },
      {
        family: "user-need",
        load: (file, expectedDigest) => loadUserNeed(file, {
          subject: "user-need",
          expectedDigest,
        }),
      },
      {
        family: "design-plan",
        load: (file, expectedDigest) => loadDesignPlan(file, {
          subject: "design-plan",
          expectedDigest,
        }),
      },
    ];
    for (const loader of loaders) {
      for (const artifact of artifacts) {
        if (loader.family === artifact.family) continue;
        await assert.rejects(
          () => loader.load(artifact.file, artifact.digest),
          (error) => error.code === "AGENTMO_UNSUPPORTED_ARTIFACT",
          `${loader.family} loader must reject ${artifact.family}`,
        );
      }
    }

    const changedPath = path.join(root, "changed-design-plan.json");
    await writeFile(changedPath, `${planBytes.toString("utf8")} `, "utf8");
    await assert.rejects(
      () => loadDesignPlan(changedPath, {
        subject: "design-plan",
        expectedDigest: digest(planBytes),
      }),
      (error) => error.code === "AGENTMO_ARTIFACT_DIGEST_MISMATCH",
    );

    const unknownPath = path.join(root, "unknown.json");
    const unknownBytes = Buffer.from('{"schemaVersion":"agentmo.unknown.v1"}\n', "utf8");
    await writeFile(unknownPath, unknownBytes);
    const legacyPath = fileURLToPath(new URL("./fixtures/migration/legacy-blueprint.json", import.meta.url));
    const legacyDigest = digest(await readFile(legacyPath));
    for (const loader of loaders) {
      await assert.rejects(
        () => loader.load(unknownPath, digest(unknownBytes)),
        (error) => error.code === "AGENTMO_UNSUPPORTED_ARTIFACT",
      );
      await assert.rejects(
        () => loader.load(legacyPath, legacyDigest),
        (error) => error.code === "AGENTMO_MIGRATION_REQUIRED",
      );
    }
  });

  it("preflights admitted design-plan candidates before creating any output root", async () => {
    const mutations = [
      (plan) => { plan.rawTranscript = "conversation-canary-123456"; },
      (plan) => { plan.nested = { toolOutput: "tool-output-canary-123456" }; },
      (plan) => { plan.nested = { stdout: "stdout-canary-123456" }; },
      (plan) => { plan.nested = { note: "api_key=secret-canary-123456" }; },
      (plan) => { plan.nested = { hostPath: "/Users/synthetic-agentmo/private.txt" }; },
    ];
    for (const [index, mutate] of mutations.entries()) {
      const inputs = await supportInputs();
      const plan = buildDesignPlan(inputs.discoveryDb, inputs.need, planOptions(inputs));
      mutate(plan);
      const parent = await mkdtemp(path.join(tmpdir(), `agentmo-design-preflight-${index}-`));
      const root = path.join(parent, "must-not-exist");
      await assert.rejects(
        () => writeDesignPlan(path.join(root, "agentmo-design-plan.json"), plan),
        (error) => {
          assert.equal(typeof error.code, "string");
          assert.equal(error.code.startsWith("AGENTMO_PERSISTABILITY_"), true);
          assert.equal(JSON.stringify(error).includes("canary-123456"), false);
          return true;
        },
      );
      await assert.rejects(() => access(root));
    }

    const inputs = await supportInputs();
    const admitted = buildDesignPlan(inputs.discoveryDb, inputs.need, planOptions(inputs));
    const forged = structuredClone(admitted);
    const parent = await mkdtemp(path.join(tmpdir(), "agentmo-design-unadmitted-"));
    const root = path.join(parent, "must-not-exist");
    await assert.rejects(
      () => writeDesignPlan(path.join(root, "agentmo-design-plan.json"), forged),
      (error) => error.code === "AGENTMO_PERSISTABILITY_UNADMITTED_CANDIDATE",
    );
    await assert.rejects(() => access(root));
  });

  it("CLI design-plan writes an artifact and bounded JSON report", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "agentmo-design-plan-cli-"));
    const dbPath = path.join(tempRoot, "agentmo-discovery-db.json");
    const outPath = path.join(tempRoot, "agentmo-design-plan.json");
    const { discoveryDb } = await supportInputs();
    await writeFile(dbPath, `${JSON.stringify(discoveryDb, null, 2)}\n`, "utf8");
    const needPath = fileURLToPath(new URL("../examples/support-triage.need.json", import.meta.url));

    const result = await runCli([
      "design-plan",
      dbPath,
      "--need",
      needPath,
      "--digest",
      `discovery-db=${await digestFile(dbPath)}`,
      "--digest",
      `user-need=${await digestFile(needPath)}`,
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
    await writeFile(dbPath, `${JSON.stringify(unsafe, null, 2)}\n`, "utf8");
    const needPath = fileURLToPath(new URL("../examples/support-triage.need.json", import.meta.url));

    const result = await runCli([
      "design-plan",
      dbPath,
      "--need",
      needPath,
      "--digest",
      `discovery-db=${await digestFile(dbPath)}`,
      "--digest",
      `user-need=${await digestFile(needPath)}`,
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
