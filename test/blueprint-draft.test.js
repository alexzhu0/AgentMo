import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { describe, it } from "node:test";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadAdmittedArtifact } from "../src/artifact-admission.js";
import { BLUEPRINT_SCHEMA_VERSION, DESIGN_CONTRACT_VERSION, validateBlueprint } from "../src/blueprint.js";
import { buildBlueprintDraftReport, draftBlueprint, writeBlueprintDraft } from "../src/blueprint-draft.js";
import { buildDesignPlan, writeDesignPlan } from "../src/design-plan.js";
import { buildDiscoveryApproval, buildDiscoveryApprovalPreview } from "../src/discovery-approval.js";
import { buildDiscoveryDb } from "../src/discovery-db.js";
import { appendDecisionEntry, loadDecisionLedger } from "../src/decision-ledger.js";

const CLI = fileURLToPath(new URL("../bin/agentmo.js", import.meta.url));
const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DISCOVERY_DB_FILE = fileURLToPath(new URL("../examples/fixtures/support-triage/prebuilt-discovery-db.json", import.meta.url));
const DISCOVERY_MANIFEST_FILE = fileURLToPath(new URL("../examples/support-triage.discovery.json", import.meta.url));
const USER_NEED_FILE = fileURLToPath(new URL("../examples/support-triage.need.json", import.meta.url));

async function loadJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function admitFile(file, subject) {
  const bytes = await readFile(file);
  return loadAdmittedArtifact({ filePath: file, subject, expectedDigest: digest(bytes) });
}

async function admitValue(value, subject, companions) {
  const root = await mkdtemp(path.join(tmpdir(), `agentmo-blueprint-${subject}-`));
  const file = path.join(root, `${subject}.json`);
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  await writeFile(file, bytes);
  return loadAdmittedArtifact({
    filePath: file,
    subject,
    expectedDigest: digest(bytes),
    ...(companions ? { companions } : {}),
  });
}

async function supportAdmissions() {
  const discoveryDb = await admitFile(DISCOVERY_DB_FILE, "discovery-db");
  const userNeed = await admitFile(USER_NEED_FILE, "user-need");
  return { discoveryDb, userNeed };
}

async function supportApprovedPlanInputs() {
  const base = await supportAdmissions();
  const discoveryManifest = await admitFile(DISCOVERY_MANIFEST_FILE, "discovery-manifest");
  const approvalAdmissions = {
    discoveryManifest,
    discoveryDb: base.discoveryDb,
  };
  const preview = buildDiscoveryApprovalPreview(
    discoveryManifest.value,
    base.discoveryDb.value,
    { admissions: approvalAdmissions },
  );
  const approval = buildDiscoveryApproval(
    discoveryManifest.value,
    base.discoveryDb.value,
    {
      admissions: approvalAdmissions,
      approve: true,
      previewDigest: preview.previewDigest,
    },
  );
  const discoveryApproval = await admitValue(approval, "discovery-approval", {
    "discovery-manifest": discoveryManifest,
    "discovery-db": base.discoveryDb,
  });
  const decisionLedger = await buildDecisionLedger(base.userNeed.value);
  return {
    ...base,
    discoveryManifest,
    discoveryApproval,
    decisionLedger,
  };
}

async function buildDecisionLedger(need) {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-blueprint-decision-ledger-"));
  const journalPath = path.join(root, "decision-ledger.json");
  const requirementRefs = [
    ...need.primary_tasks.map((_, index) => `primary-task-${String(index + 1).padStart(2, "0")}`),
    ...need.success_criteria.map((_, index) => `success-criterion-${String(index + 1).padStart(2, "0")}`),
    ...need.hard_failures.map((_, index) => `hard-failure-${String(index + 1).padStart(2, "0")}`),
  ].sort();
  const appended = await appendDecisionEntry({
    journalPath,
    entry: {
      entryId: "human-decision-01",
      entryKind: "human-decision",
      subject: "Bounded Stage 2 planning scope",
      reason: "Proceed with governed gaps and preserve draft status.",
      sourceRefs: [],
      decisionRefs: [],
      requirementRefs,
    },
  });
  return loadDecisionLedger({ journalPath, expectedHeadDigest: appended.head.digest });
}

function buildApprovedDesignPlan(inputs) {
  return buildDesignPlan(inputs.discoveryDb.value, inputs.userNeed.value, {
    target: "openclaw",
    manifest: inputs.discoveryManifest.value,
    discoveryApproval: inputs.discoveryApproval.value,
    decisionLedger: inputs.decisionLedger,
    admissions: {
      discoveryManifest: inputs.discoveryManifest,
      discoveryDb: inputs.discoveryDb,
      discoveryApproval: inputs.discoveryApproval,
      userNeed: inputs.userNeed,
      decisionLedger: inputs.decisionLedger,
    },
  });
}

function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("blueprint draft", () => {
  it("drafts a valid blueprint from discovery db plus user need", async () => {
    const admissions = await supportAdmissions();
    const discoveryDb = admissions.discoveryDb.value;
    const need = admissions.userNeed.value;
    const blueprint = draftBlueprint(discoveryDb, need, { target: "openclaw", admissions });
    const validation = validateBlueprint(blueprint);
    assert.equal(validation.ok, true, validation.errors.join("\n"));
    assert.equal(blueprint.agent_id, "support-triage");
    assert.equal(blueprint.agentmo_version, BLUEPRINT_SCHEMA_VERSION);
    assert.equal("agentmother_version" in blueprint, false);
    assert.equal(blueprint.runtime, "openclaw");
    assert.equal(blueprint.status, "draft");
    assert.equal(blueprint.design_contract.provenance.source, "agentmo-stage2");
    assert.equal(blueprint.design_contract.provenance.reviewed, false);
    assert.equal(blueprint.design_contract.provenance.contract_version, DESIGN_CONTRACT_VERSION);
    assert.equal("review_ref" in blueprint.design_contract.provenance, false);
    assert.deepEqual(
      blueprint.design_contract.provenance.admitted_artifacts.map((item) => Object.keys(item)),
      [["identity", "subject", "digest"], ["identity", "subject", "digest"]],
    );
    assert.equal(blueprint.tools.length, 3);
    assert.equal(blueprint.pipeline.discover.data_sources.length, 3);
    assert.equal(
      blueprint.governance.policies.includes(
        "AgentMo-generated blueprints preserve exact discovery/user-need provenance but remain draft and non-authoritative until explicit plan approval.",
      ),
      true,
    );
    assert.equal(blueprint.governance.policies.includes("discover-plan-produce order is mandatory"), false);

    const dir = await mkdtemp(path.join(tmpdir(), "agentmo-blueprint-draft-"));
    const file = await writeBlueprintDraft(path.join(dir, "support-triage.agentmo.json"), blueprint);
    const firstBytes = await readFile(file, "utf8");
    const second = path.join(dir, "support-triage-copy.agentmo.json");
    await writeBlueprintDraft(second, blueprint);
    assert.equal(await readFile(second, "utf8"), firstBytes);
    const saved = JSON.parse(firstBytes);
    assert.equal(saved.agent_id, "support-triage");
  });

  it("rejects mismatched discovery and need agent ids", async () => {
    const manifest = await loadJson(new URL("../examples/support-triage.discovery.json", import.meta.url));
    const need = await loadJson(new URL("../examples/support-triage.need.json", import.meta.url));
    need.agent_id = "other-agent";
    const discoveryDb = buildDiscoveryDb(manifest);
    assert.throws(() => draftBlueprint(discoveryDb, need, { target: "openclaw" }), /does not match user-need/u);
  });

  it("drafts from a validated design-plan without embedding the full evidence map", async () => {
    const planInputs = await supportApprovedPlanInputs();
    const baseAdmissions = {
      discoveryDb: planInputs.discoveryDb,
      userNeed: planInputs.userNeed,
    };
    const designPlanCandidate = buildApprovedDesignPlan(planInputs);
    const designPlanAdmission = await admitValue(designPlanCandidate, "design-plan");
    const admissions = { ...baseAdmissions, designPlan: designPlanAdmission };

    const blueprint = draftBlueprint(
      baseAdmissions.discoveryDb.value,
      baseAdmissions.userNeed.value,
      { target: "openclaw", designPlan: designPlanAdmission.value, admissions },
    );
    const validation = validateBlueprint(blueprint);
    assert.equal(validation.ok, true, validation.errors.join("\n"));
    assert.equal(blueprint.design_contract.provenance.admitted_artifacts.at(-1).subject, "design-plan");
    assert.equal(blueprint.pipeline.plan.planning_inputs.includes("agentmo.design-plan.v1"), true);
    assert.equal(blueprint.pipeline.plan.planning_inputs.includes("agentmo-design-plan.json"), false);
    assert.deepEqual(blueprint.stage2_planning.admission, blueprint.design_contract.provenance.admitted_artifacts.at(-1));
    assert.equal(blueprint.stage2_planning.authority, "draft-non-authoritative");
    assert.deepEqual(
      blueprint.stage2_planning.trace.forward_edges,
      designPlanCandidate.traceGraph.forwardTraceEdges,
    );
    assert.equal("evidenceMap" in blueprint, false);
    assert.equal(JSON.stringify(blueprint).includes("requirementsTrace"), false);
  });

  it("rejects invalid or mismatched design-plan input", async () => {
    const admissions = await supportApprovedPlanInputs();
    const discoveryDb = admissions.discoveryDb.value;
    const need = admissions.userNeed.value;
    const designPlan = buildApprovedDesignPlan(admissions);

    assert.throws(() => draftBlueprint(discoveryDb, need, { target: "agentmo", designPlan }), /target runtime/i);

    const notOk = structuredClone(designPlan);
    notOk.ok = false;
    assert.throws(() => draftBlueprint(discoveryDb, need, { target: "openclaw", designPlan: notOk }), /design-plan ok must be true/i);

    const invalidValidation = structuredClone(designPlan);
    invalidValidation.validation.ok = false;
    assert.throws(() => draftBlueprint(discoveryDb, need, { target: "openclaw", designPlan: invalidValidation }), /design-plan validation.ok must be true/i);

    const wrongAgent = structuredClone(designPlan);
    wrongAgent.agentId = "other-agent";
    assert.throws(() => draftBlueprint(discoveryDb, need, { target: "openclaw", designPlan: wrongAgent }), /agent id/i);
  });

  it("runs base and design-plan blueprint drafts in fresh processes with exact optional bindings", async () => {
    const planInputs = await supportApprovedPlanInputs();
    const baseAdmissions = {
      discoveryDb: planInputs.discoveryDb,
      userNeed: planInputs.userNeed,
    };
    const designPlan = buildApprovedDesignPlan(planInputs);
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-blueprint-cli-contract-"));
    const planPath = path.join(root, "agentmo-design-plan.json");
    await writeDesignPlan(planPath, designPlan);
    const dbBinding = `discovery-db=${baseAdmissions.discoveryDb.digest}`;
    const needBinding = `user-need=${baseAdmissions.userNeed.digest}`;
    const planBinding = `design-plan=${digest(await readFile(planPath))}`;

    const baseOut = path.join(root, "base.agentmo.json");
    const base = await runCli([
      "blueprint-draft",
      DISCOVERY_DB_FILE,
      "--need",
      USER_NEED_FILE,
      "--digest",
      dbBinding,
      "--digest",
      needBinding,
      "--out",
      baseOut,
      "--target",
      "openclaw",
      "--json",
    ]);
    assert.equal(base.code, 0, base.stderr);
    const baseBlueprint = JSON.parse(await readFile(baseOut, "utf8"));
    assert.deepEqual(
      baseBlueprint.design_contract.provenance.admitted_artifacts.map((item) => item.subject),
      ["discovery-db", "user-need"],
    );

    const withPlanOut = path.join(root, "with-plan.agentmo.json");
    const withPlan = await runCli([
      "blueprint-draft",
      DISCOVERY_DB_FILE,
      "--need",
      USER_NEED_FILE,
      "--design-plan",
      planPath,
      "--digest",
      dbBinding,
      "--digest",
      needBinding,
      "--digest",
      planBinding,
      "--out",
      withPlanOut,
      "--target",
      "openclaw",
      "--json",
    ]);
    assert.equal(withPlan.code, 0, withPlan.stderr);
    const withPlanBlueprint = JSON.parse(await readFile(withPlanOut, "utf8"));
    assert.deepEqual(
      withPlanBlueprint.design_contract.provenance.admitted_artifacts.map((item) => item.subject),
      ["discovery-db", "user-need", "design-plan"],
    );
    assert.equal(JSON.stringify(withPlanBlueprint).includes(planPath), false);

    const missingRoot = path.join(root, "missing-binding-root");
    const missing = await runCli([
      "blueprint-draft",
      DISCOVERY_DB_FILE,
      "--need",
      USER_NEED_FILE,
      "--design-plan",
      planPath,
      "--digest",
      dbBinding,
      "--digest",
      needBinding,
      "--out",
      path.join(missingRoot, "draft.json"),
      "--json",
    ]);
    assert.equal(missing.code, 1);
    assert.equal(JSON.parse(missing.stdout).code, "AGENTMO_ARTIFACT_DIGEST_REQUIRED");
    await assert.rejects(() => access(missingRoot));

    const ignoredRoot = path.join(root, "ignored-binding-root");
    const ignored = await runCli([
      "blueprint-draft",
      DISCOVERY_DB_FILE,
      "--need",
      USER_NEED_FILE,
      "--digest",
      dbBinding,
      "--digest",
      needBinding,
      "--digest",
      planBinding,
      "--out",
      path.join(ignoredRoot, "draft.json"),
      "--json",
    ]);
    assert.equal(ignored.code, 1);
    assert.equal(JSON.parse(ignored.stdout).code, "AGENTMO_ARTIFACT_DIGEST_UNKNOWN_SUBJECT");
    await assert.rejects(() => access(ignoredRoot));
  });

  it("preflights admitted blueprint candidates before creating any output root", async () => {
    const mutations = [
      (blueprint) => { blueprint.rawTranscript = "conversation-canary-123456"; },
      (blueprint) => { blueprint.nested = { toolOutput: "tool-output-canary-123456" }; },
      (blueprint) => { blueprint.nested = { stderr: "stderr-canary-123456" }; },
      (blueprint) => { blueprint.nested = { note: "api_key=secret-canary-123456" }; },
      (blueprint) => { blueprint.nested = { hostPath: "/Users/synthetic-agentmo/private.txt" }; },
    ];
    for (const [index, mutate] of mutations.entries()) {
      const admissions = await supportAdmissions();
      const blueprint = draftBlueprint(admissions.discoveryDb.value, admissions.userNeed.value, {
        target: "openclaw",
        admissions,
      });
      mutate(blueprint);
      const parent = await mkdtemp(path.join(tmpdir(), `agentmo-blueprint-preflight-${index}-`));
      const root = path.join(parent, "must-not-exist");
      await assert.rejects(
        () => writeBlueprintDraft(path.join(root, "draft.json"), blueprint),
        (error) => {
          assert.equal(typeof error.code, "string");
          assert.equal(error.code.startsWith("AGENTMO_PERSISTABILITY_"), true);
          assert.equal(JSON.stringify(error).includes("canary-123456"), false);
          return true;
        },
      );
      await assert.rejects(() => access(root));
    }

    const admissions = await supportAdmissions();
    const admitted = draftBlueprint(admissions.discoveryDb.value, admissions.userNeed.value, {
      target: "openclaw",
      admissions,
    });
    const forged = structuredClone(admitted);
    const parent = await mkdtemp(path.join(tmpdir(), "agentmo-blueprint-unadmitted-"));
    const root = path.join(parent, "must-not-exist");
    await assert.rejects(
      () => writeBlueprintDraft(path.join(root, "draft.json"), forged),
      (error) => error.code === "AGENTMO_PERSISTABILITY_UNADMITTED_CANDIDATE",
    );
    await assert.rejects(() => access(root));
  });

  it("reports blueprint output paths without leaking host absolute paths", async () => {
    const manifest = await loadJson(new URL("../examples/support-triage.discovery.json", import.meta.url));
    const need = await loadJson(new URL("../examples/support-triage.need.json", import.meta.url));
    const discoveryDb = buildDiscoveryDb(manifest, { manifestPath: "examples/support-triage.discovery.json" });
    const blueprint = draftBlueprint(discoveryDb, need, { target: "openclaw" });
    const dir = await mkdtemp(path.join(tmpdir(), "agentmo-blueprint-report-"));
    const report = buildBlueprintDraftReport(blueprint, { blueprintPath: path.join(dir, "support-triage.agentmo.json") });
    assert.equal(report.blueprintPath, "support-triage.agentmo.json");
  });

});
