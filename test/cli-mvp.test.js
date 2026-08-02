import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const CLI = fileURLToPath(new URL("../bin/agentmo.js", import.meta.url));
const DISCOVERY = fileURLToPath(new URL("../examples/support-triage.discovery.json", import.meta.url));
const NEED = fileURLToPath(new URL("../examples/support-triage.need.json", import.meta.url));
const DECISION_ENTRY = fileURLToPath(new URL("../examples/support-triage.decision-entry.json", import.meta.url));
const DOMAIN_CASES = fileURLToPath(new URL("../examples/support-triage.domain-cases.json", import.meta.url));

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

async function createDiscoveryApproval(root, manifest, discoveryDb) {
  const out = path.join(root, "agentmo-discovery-approval.json");
  const manifestDigest = await digestFile(manifest);
  const dbDigest = await digestFile(discoveryDb);
  const preview = await runCli([
    "discovery-approve", manifest,
    "--discovery-db", discoveryDb,
    "--digest", `discovery-manifest=${manifestDigest}`,
    "--digest", `discovery-db=${dbDigest}`,
    "--json",
  ]);
  assert.equal(preview.code, 0, preview.stderr);
  const apply = await runCli([
    "discovery-approve", manifest,
    "--discovery-db", discoveryDb,
    "--digest", `discovery-manifest=${manifestDigest}`,
    "--digest", `discovery-db=${dbDigest}`,
    "--approve",
    "--preview-digest", JSON.parse(preview.stdout).previewDigest,
    "--out", out,
    "--json",
  ]);
  assert.equal(apply.code, 0, apply.stderr);
  return out;
}

async function createDecisionLedger(root) {
  const journal = path.join(root, "decision-ledger.json");
  const result = await runCli([
    "decision-ledger", "append",
    "--journal", journal,
    "--entry", DECISION_ENTRY,
    "--digest", `decision-entry=${await digestFile(DECISION_ENTRY)}`,
    "--json",
  ]);
  assert.equal(result.code, 0, result.stderr);
  return { journal, headDigest: JSON.parse(result.stdout).head.digest };
}

describe("cli mvp birth loop", () => {
  it("runs support-triage through discover, need, design-plan, draft, handoff, run-eval, birth-report, domain-eval, and delivery-report", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-cli-mvp-"));
    const discoveryOut = path.join(root, "discovery-pack");
    const discover = await runCli([
      "discover-pack",
      DISCOVERY,
      "--digest",
      `discovery-manifest=${await digestFile(DISCOVERY)}`,
      "--out",
      discoveryOut,
      "--json",
    ]);
    assert.equal(discover.code, 0, discover.stderr);
    const discoverJson = JSON.parse(discover.stdout);
    assert.equal(discoverJson.discoveryDb.agentId, "support-triage");

    const need = await runCli([
      "need-report",
      NEED,
      "--digest",
      `user-need=${await digestFile(NEED)}`,
      "--json",
    ]);
    assert.equal(need.code, 0, need.stderr);
    assert.equal(JSON.parse(need.stdout).ok, true);

    const designPlanPath = path.join(root, "agentmo-design-plan.json");
    const discoveryDbPath = path.join(discoveryOut, "agentmo-discovery-db.json");
    const approvalPath = await createDiscoveryApproval(root, DISCOVERY, discoveryDbPath);
    const decisionLedger = await createDecisionLedger(root);
    const designPlan = await runCli([
      "design-plan",
      discoveryDbPath,
      "--manifest",
      DISCOVERY,
      "--discovery-approval",
      approvalPath,
      "--need",
      NEED,
      "--decision-ledger",
      decisionLedger.journal,
      "--digest",
      `discovery-manifest=${await digestFile(DISCOVERY)}`,
      "--digest",
      `discovery-db=${await digestFile(discoveryDbPath)}`,
      "--digest",
      `discovery-approval=${await digestFile(approvalPath)}`,
      "--digest",
      `user-need=${await digestFile(NEED)}`,
      "--digest",
      `decision-ledger=${decisionLedger.headDigest}`,
      "--out",
      designPlanPath,
      "--target",
      "openclaw",
      "--json",
    ]);
    assert.equal(designPlan.code, 0, designPlan.stderr);
    const designPlanJson = JSON.parse(designPlan.stdout);
    assert.equal(designPlanJson.report.ok, true);
    assert.equal(designPlanJson.designPlan.schemaVersion, "agentmo.design-plan.v1");

    const blueprintPath = path.join(root, "support-triage.agentmo.json");
    const draft = await runCli([
      "blueprint-draft",
      path.join(discoveryOut, "agentmo-discovery-db.json"),
      "--need",
      NEED,
      "--design-plan",
      designPlanPath,
      "--digest",
      `discovery-db=${await digestFile(discoveryDbPath)}`,
      "--digest",
      `user-need=${await digestFile(NEED)}`,
      "--digest",
      `design-plan=${await digestFile(designPlanPath)}`,
      "--out",
      blueprintPath,
      "--target",
      "openclaw",
      "--json",
    ]);
    assert.equal(draft.code, 0, draft.stderr);
    assert.equal(JSON.parse(draft.stdout).report.ok, true);

    const blueprintDigest = await digestFile(blueprintPath);
    const validate = await runCli([
      "validate",
      blueprintPath,
      "--digest",
      `blueprint=${blueprintDigest}`,
    ]);
    assert.equal(validate.code, 0, validate.stderr);

    const handoffOut = path.join(root, "handoff");
    const handoff = await runCli([
      "handoff",
      blueprintPath,
      "--digest",
      `blueprint=${blueprintDigest}`,
      "--target",
      "openclaw",
      "--out",
      handoffOut,
      "--json",
    ]);
    assert.equal(handoff.code, 0, handoff.stderr);
    assert.equal(JSON.parse(handoff.stdout).handoff.certificationBoundary.handoffCertifiesRuntime, false);

    const scaffoldOut = path.join(root, "scaffold");
    const scaffold = await runCli([
      "scaffold",
      blueprintPath,
      "--digest",
      `blueprint=${blueprintDigest}`,
      "--target",
      "openclaw",
      "--out",
      scaffoldOut,
    ]);
    assert.equal(scaffold.code, 0, scaffold.stderr);
    const buildStatePath = path.join(scaffoldOut, "agentmo-build-state.json");
    const buildStateDigest = await digestFile(buildStatePath);

    const workspace = path.join(root, "workspace");
    const runtimeMessage = "Say exactly: ok";
    const runtimePlanPath = path.join(root, "agentmo-runtime-plan.json");
    const runtimePlan = await runCli([
      "run-plan",
      blueprintPath,
      "--digest",
      `blueprint=${blueprintDigest}`,
      "--target",
      "openclaw",
      "--workspace",
      workspace,
      "--message",
      runtimeMessage,
      "--json",
    ]);
    assert.equal(runtimePlan.code, 0, runtimePlan.stderr);
    assert.equal(JSON.parse(runtimePlan.stdout).schemaVersion, "agentmo.runtime-plan.v1");
    await writeFile(runtimePlanPath, runtimePlan.stdout, "utf8");

    const runOut = path.join(root, "run");
    const run = await runCli([
      "run",
      runtimePlanPath,
      "--digest",
      `runtime-plan=${await digestFile(runtimePlanPath)}`,
      "--workspace",
      workspace,
      "--message",
      runtimeMessage,
      "--out",
      runOut,
      "--json",
    ]);
    assert.equal(run.code, 0, run.stderr);
    const runState = JSON.parse(run.stdout);
    const runStatePath = path.join(runOut, "runs", runState.runId, "agentmo-run-state.json");
    const runStateDigest = await digestFile(runStatePath);

    const evaluation = await runCli([
      "run-eval",
      runStatePath,
      "--digest",
      `run-state=${runStateDigest}`,
      "--expect-status",
      "declared",
      "--json",
    ]);
    assert.equal(evaluation.code, 0, evaluation.stderr);
    const runEvalJson = JSON.parse(evaluation.stdout);
    assert.equal(runEvalJson.schemaVersion, "agentmo.run-eval.v1");
    assert.equal(runEvalJson.ok, true);
    const runEvalPath = path.join(root, "run-eval.json");
    await writeFile(runEvalPath, evaluation.stdout, "utf8");
    const runEvalDigest = await digestFile(runEvalPath);

    const birth = await runCli([
      "birth-report",
      blueprintPath,
      "--build-state",
      buildStatePath,
      "--run-state",
      runStatePath,
      "--run-eval",
      runEvalPath,
      "--digest",
      `blueprint=${blueprintDigest}`,
      "--digest",
      `build-state=${buildStateDigest}`,
      "--digest",
      `run-state=${runStateDigest}`,
      "--digest",
      `run-eval=${runEvalDigest}`,
      "--expect-status",
      "declared",
      "--json",
    ]);
    assert.equal(birth.code, 0, birth.stderr);
    const birthJson = JSON.parse(birth.stdout);
    assert.equal(birthJson.ok, true);
    assert.equal(birthJson.birthStatus, "declared-ready");
    assert.equal(birthJson.certificationBoundary.runtimeCertifiedByBirthReport, false);
    const birthReportPath = path.join(root, "birth-report.json");
    await writeFile(birthReportPath, birth.stdout, "utf8");
    const birthReportDigest = await digestFile(birthReportPath);

    const domainEval = await runCli([
      "domain-eval",
      blueprintPath,
      "--cases",
      DOMAIN_CASES,
      "--digest",
      `blueprint=${blueprintDigest}`,
      "--digest",
      `domain-cases=${await digestFile(DOMAIN_CASES)}`,
      "--target",
      "openclaw",
      "--json",
    ]);
    assert.equal(domainEval.code, 0, domainEval.stderr);
    const domainEvalJson = JSON.parse(domainEval.stdout);
    assert.equal(domainEvalJson.schemaVersion, "agentmo.domain-eval.v1");
    assert.equal(domainEvalJson.ok, true);
    assert.equal(domainEvalJson.domainCertifiedByDomainEval, true);
    const domainEvalPath = path.join(root, "domain-eval.json");
    await writeFile(domainEvalPath, domainEval.stdout, "utf8");
    const domainEvalDigest = await digestFile(domainEvalPath);

    const delivery = await runCli([
      "delivery-report",
      blueprintPath,
      "--build-state",
      buildStatePath,
      "--run-state",
      runStatePath,
      "--run-eval",
      runEvalPath,
      "--birth-report",
      birthReportPath,
      "--domain-eval",
      domainEvalPath,
      "--digest",
      `blueprint=${blueprintDigest}`,
      "--digest",
      `build-state=${buildStateDigest}`,
      "--digest",
      `run-state=${runStateDigest}`,
      "--digest",
      `run-eval=${runEvalDigest}`,
      "--digest",
      `birth-report=${birthReportDigest}`,
      "--digest",
      `domain-eval=${domainEvalDigest}`,
      "--json",
    ]);
    assert.equal(delivery.code, 0, delivery.stderr);
    const deliveryJson = JSON.parse(delivery.stdout);
    assert.equal(deliveryJson.schemaVersion, "agentmo.delivery.v1");
    assert.equal(deliveryJson.ok, true);
    assert.equal(deliveryJson.domainCertified, true);
    assert.equal(deliveryJson.runtimePromotionEligible, false);
    assert.equal(deliveryJson.deliveryReady, false);
    assert.equal(deliveryJson.certificationBoundary.runtimeCertifiedByDeliveryReport, false);
    assert.equal(deliveryJson.certificationBoundary.domainCertifiedByDeliveryReport, false);
    assert.equal((await readFile(path.join(handoffOut, "VERIFY.md"), "utf8")).includes("Birth-report must fail closed"), true);
  });
});
