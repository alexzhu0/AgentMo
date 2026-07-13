import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const CLI = fileURLToPath(new URL("../bin/agentmo.js", import.meta.url));
const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DISCOVERY = fileURLToPath(new URL("../examples/support-triage.discovery.json", import.meta.url));
const NEED = fileURLToPath(new URL("../examples/support-triage.need.json", import.meta.url));
const PREBUILT_DISCOVERY_DB = fileURLToPath(new URL("../examples/fixtures/support-triage/prebuilt-discovery-db.json", import.meta.url));
const SUPPORT_BLUEPRINT = fileURLToPath(new URL("../examples/support-triage.agentmo.json", import.meta.url));

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

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function digestFile(file) {
  return `sha256:${createHash("sha256").update(await readFile(file)).digest("hex")}`;
}

async function listRelativeFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listRelativeFiles(root, absolute));
    } else if (entry.isFile()) {
      files.push(path.relative(root, absolute).split(path.sep).join("/"));
    }
  }
  return files.sort();
}

function assertNoStage2OrStage3Artifacts(files) {
  const forbiddenNames = new Set([
    "support-triage.agentmo.json",
    "agentmo-handoff.json",
    "agentmo-build-state.json",
    "agentmo-run-state.json",
    "agentmo-run-index.json",
    "agentmo-run-eval.json",
    "agentmo-birth-report.json",
    "birth-report.json",
    "delivery-report.json",
  ]);
  assert.deepEqual(
    files.filter((file) => forbiddenNames.has(path.basename(file))),
    [],
    `unexpected downstream artifacts: ${files.join(", ")}`,
  );
}

function assertNoDiscoveryOrNeedArtifacts(files) {
  const forbiddenNames = new Set([
    "agentmo-discovery-db.json",
    "facts.jsonl",
    "coverage.json",
    "agentmo-discovery-pack.json",
    "agentmo-user-need.json",
    "user-need-report.json",
    "agentmo-design-plan.json",
  ]);
  assert.deepEqual(
    files.filter((file) => forbiddenNames.has(path.basename(file))),
    [],
    `unexpected Stage 1/2 ancestry artifacts: ${files.join(", ")}`,
  );
}

function assertNoAbsoluteLocalPaths(value, pointer = "$") {
  if (typeof value === "string") {
    assert.equal(path.isAbsolute(value), false, `${pointer} must not be absolute: ${value}`);
    assert.equal(value.includes("/home/"), false, `${pointer} must not include a local home path`);
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) assertNoAbsoluteLocalPaths(item, `${pointer}[${index}]`);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) assertNoAbsoluteLocalPaths(item, `${pointer}.${key}`);
  }
}

function assertNoHostPathText(text, label, extraPath = null) {
  assert.equal(text.includes(REPO_ROOT), false, `${label} must not contain repo root ${REPO_ROOT}`);
  assert.equal(text.includes("/home/alex"), false, `${label} must not contain host-specific /home/alex paths`);
  if (extraPath) assert.equal(text.includes(extraPath), false, `${label} must not contain absolute path ${extraPath}`);
}

function assertNoCertifyingTrueClaims(value, label, pointer = "$", findings = []) {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) assertNoCertifyingTrueClaims(item, label, `${pointer}[${index}]`, findings);
    if (pointer === "$") assert.deepEqual(findings, [], `${label} contains certifying true claims: ${findings.join(", ")}`);
    return findings;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      const childPointer = `${pointer}.${key}`;
      if (item === true && /certif|certifies|promotionEligible|domainCertified|runtimeCertified|productionApproved/u.test(key)) {
        findings.push(childPointer);
      }
      assertNoCertifyingTrueClaims(item, label, childPointer, findings);
    }
  }
  if (pointer === "$") assert.deepEqual(findings, [], `${label} contains certifying true claims: ${findings.join(", ")}`);
  return findings;
}

describe("stage contract independence", () => {
  it("Stage 1 discover-pack writes only discovery contract artifacts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-stage1-contract-"));
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
    assertNoHostPathText(discover.stdout, "discover-pack stdout", discoveryOut);
    const result = JSON.parse(discover.stdout);
    assert.equal(result.schemaVersion, "agentmo.discovery-pack.v1");
    assert.equal(result.ok, true);
    assert.equal(result.discoveryDb.agentId, "support-triage");
    assert.deepEqual(result.paths, {
      outDir: ".",
      discoveryDbPath: "agentmo-discovery-db.json",
      factsPath: "facts.jsonl",
      coveragePath: "coverage.json",
    });
    assertNoAbsoluteLocalPaths(result);

    const files = await listRelativeFiles(discoveryOut);
    assert.deepEqual(files, ["agentmo-discovery-db.json", "coverage.json", "facts.jsonl"]);
    assertNoStage2OrStage3Artifacts(files);

    const discoveryDbText = await readFile(path.join(discoveryOut, "agentmo-discovery-db.json"), "utf8");
    const factsText = await readFile(path.join(discoveryOut, "facts.jsonl"), "utf8");
    const coverageText = await readFile(path.join(discoveryOut, "coverage.json"), "utf8");
    assertNoHostPathText(discoveryDbText, "discover-pack discovery DB", discoveryOut);
    assertNoHostPathText(factsText, "discover-pack facts JSONL", discoveryOut);
    assertNoHostPathText(coverageText, "discover-pack coverage JSON", discoveryOut);
    const discoveryDb = JSON.parse(discoveryDbText);
    const coverage = JSON.parse(coverageText);
    assert.equal(discoveryDb.schemaVersion, "agentmo.discovery-db.v1");
    assert.equal(discoveryDb.sourceManifest.path, "examples/support-triage.discovery.json");
    assert.equal(discoveryDb.validation.ok, true);
    assert.equal(coverage.sourceCount, 3);
    assertNoAbsoluteLocalPaths(discoveryDb);
    assertNoAbsoluteLocalPaths(coverage);
  });

  it("Stage 2 plans from a prebuilt DB plus need before drafting a valid blueprint", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-stage2-contract-"));
    const planPath = path.join(root, "agentmo-design-plan.json");
    const blueprintPath = path.join(root, "support-triage.agentmo.json");
    const fixture = await readJson(PREBUILT_DISCOVERY_DB);
    assert.equal(fixture.schemaVersion, "agentmo.discovery-db.v1");
    assert.equal(fixture.validation.ok, true);
    assertNoAbsoluteLocalPaths(fixture);

    const design = await runCli([
      "design-plan",
      PREBUILT_DISCOVERY_DB,
      "--need",
      NEED,
      "--digest",
      `discovery-db=${await digestFile(PREBUILT_DISCOVERY_DB)}`,
      "--digest",
      `user-need=${await digestFile(NEED)}`,
      "--out",
      planPath,
      "--target",
      "openclaw",
      "--json",
    ]);
    assert.equal(design.code, 0, design.stderr);
    assertNoHostPathText(design.stdout, "design-plan stdout", root);
    const designJson = JSON.parse(design.stdout);
    assert.equal(designJson.report.ok, true);
    assert.equal(designJson.report.designPlanPath, "agentmo-design-plan.json");
    assertNoAbsoluteLocalPaths(designJson);

    const draft = await runCli([
      "blueprint-draft",
      PREBUILT_DISCOVERY_DB,
      "--need",
      NEED,
      "--design-plan",
      planPath,
      "--digest",
      `discovery-db=${await digestFile(PREBUILT_DISCOVERY_DB)}`,
      "--digest",
      `user-need=${await digestFile(NEED)}`,
      "--digest",
      `design-plan=${await digestFile(planPath)}`,
      "--out",
      blueprintPath,
      "--target",
      "openclaw",
      "--json",
    ]);
    assert.equal(draft.code, 0, draft.stderr);
    assertNoHostPathText(draft.stdout, "blueprint-draft stdout", root);
    const draftJson = JSON.parse(draft.stdout);
    assert.equal(draftJson.report.ok, true);
    assert.equal(draftJson.report.agentId, "support-triage");
    assert.equal(draftJson.report.blueprintPath, "support-triage.agentmo.json");

    const validate = await runCli([
      "validate",
      blueprintPath,
      "--digest",
      `blueprint=${await digestFile(blueprintPath)}`,
    ]);
    assert.equal(validate.code, 0, validate.stderr);

    const blueprint = await readJson(blueprintPath);
    assert.equal(blueprint.agentmo_version, "0.1");
    assert.equal("agentmother_version" in blueprint, false);
    assert.deepEqual(Object.keys(blueprint.pipeline), ["discover", "plan", "produce"]);
    assert.equal(blueprint.agent_id, "support-triage");
    assert.equal(blueprint.runtime, "openclaw");
    assert.equal(blueprint.status, "draft");
    assert.equal(blueprint.design_contract.provenance.source, "agentmo-stage2");
    assert.equal(blueprint.design_contract.provenance.reviewed, true);
    assert.equal(blueprint.design_contract.provenance.contract_version, "agentmo.design-contract.v1");
    assert.match(blueprint.design_contract.provenance.review_ref, /^admitted-inputs:sha256:[a-f0-9]{64}$/u);
    assert.deepEqual(
      blueprint.design_contract.provenance.admitted_artifacts.map((item) => ({
        identity: item.identity,
        subject: item.subject,
      })),
      [
        { identity: "agentmo.discovery-db.v1", subject: "discovery-db" },
        { identity: "agentmo.user-need.v1", subject: "user-need" },
        { identity: "agentmo.design-plan.v1", subject: "design-plan" },
      ],
    );
    assert.equal(JSON.stringify(blueprint.design_contract.provenance).includes(planPath), false);
    assert.equal(blueprint.pipeline.discover.data_sources.length, fixture.sources.length);
    assert.equal(JSON.stringify(blueprint).includes("evidenceMap"), false);
    assert.deepEqual(await listRelativeFiles(root), ["agentmo-design-plan.json", "support-triage.agentmo.json"]);
  });

  it("Stage 3 handoff admits an existing design contract without discovery or draft ancestry", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-stage3-handoff-"));

    const blueprintDigest = await digestFile(SUPPORT_BLUEPRINT);
    const validate = await runCli([
      "validate",
      SUPPORT_BLUEPRINT,
      "--digest",
      `blueprint=${blueprintDigest}`,
    ]);
    assert.equal(validate.code, 0, validate.stderr);

    const handoffOut = path.join(root, "handoff");
    const handoff = await runCli([
      "handoff",
      SUPPORT_BLUEPRINT,
      "--digest",
      `blueprint=${blueprintDigest}`,
      "--target",
      "openclaw",
      "--out",
      handoffOut,
      "--json",
    ]);
    assert.equal(handoff.code, 0, handoff.stderr);
    const handoffJson = JSON.parse(handoff.stdout);
    assert.equal(handoffJson.ok, true);
    assert.equal(handoffJson.handoff.certificationBoundary.handoffCertifiesRuntime, false);
    assert.equal(handoffJson.handoff.certificationBoundary.handoffCertifiesDomain, false);
    assert.deepEqual(handoffJson.handoff.requiredInputs, handoffJson.handoff.stage3RequiredArtifacts);
    assert.equal(handoffJson.handoff.requiredInputs.includes("validated blueprint/design contract"), true);
    assert.equal(handoffJson.handoff.requiredInputs.includes("discovery pack"), false);
    assert.equal(handoffJson.handoff.requiredInputs.includes("user-need report"), false);
    assert.deepEqual(handoffJson.handoff.provenance, {
      identity: "0.1",
      subject: "blueprint",
      digest: blueprintDigest,
    });
    assertNoCertifyingTrueClaims(handoffJson.handoff, "handoff");

    const generatedFiles = await listRelativeFiles(root);
    assertNoDiscoveryOrNeedArtifacts(generatedFiles);
    assert.equal(generatedFiles.some((file) => file.endsWith("support-triage.agentmo.json")), false);
  });

  it("Stage 3 declared evidence remains non-certifying without live or domain eval evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-stage3-evidence-"));
    const blueprintDigest = await digestFile(SUPPORT_BLUEPRINT);

    const scaffoldOut = path.join(root, "scaffold");
    const scaffold = await runCli([
      "scaffold",
      SUPPORT_BLUEPRINT,
      "--digest",
      `blueprint=${blueprintDigest}`,
      "--target",
      "openclaw",
      "--out",
      scaffoldOut,
    ]);
    assert.equal(scaffold.code, 0, scaffold.stderr);
    const buildStatePath = path.join(scaffoldOut, "agentmo-build-state.json");
    const buildState = await readJson(buildStatePath);
    assert.equal(buildState.schemaVersion, "agentmo.build-state.v1");
    assert.equal(buildState.agentId, "support-triage");
    assertNoCertifyingTrueClaims(buildState, "scaffold build-state");

    const workspace = path.join(root, "workspace");
    const runtimeMessage = "Classify a refund ticket with missing order context.";
    const runtimePlanPath = path.join(root, "agentmo-runtime-plan.json");
    const runtimePlan = await runCli([
      "run-plan",
      SUPPORT_BLUEPRINT,
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
    assert.equal(runState.schemaVersion, "agentmo.run.v1");
    assert.equal(runState.execution.status, "declared");
    assert.equal(runState.execution.executed, false);
    assert.equal(runState.certificationBoundary.runEvidenceCertifiesRuntime, false);
    assertNoCertifyingTrueClaims(runState, "run-state");
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
    assert.equal(runEvalJson.ok, true);
    assert.equal(runEvalJson.certificationBoundary.runtimeCertifiedByRun, false);
    assert.equal(runEvalJson.certificationBoundary.domainCertifiedByRun, false);
    assertNoCertifyingTrueClaims(runEvalJson, "run-eval");
    const runEvalPath = path.join(root, "run-eval.json");
    await writeFile(runEvalPath, evaluation.stdout, "utf8");
    const buildStateDigest = await digestFile(buildStatePath);
    const runEvalDigest = await digestFile(runEvalPath);

    const birth = await runCli([
      "birth-report",
      SUPPORT_BLUEPRINT,
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
    assert.equal(birthJson.promotionEligible, false);
    assert.equal(birthJson.certificationBoundary.runtimeCertifiedByBirthReport, false);
    assert.equal(birthJson.certificationBoundary.domainCertifiedByBirthReport, false);
    assertNoCertifyingTrueClaims(birthJson, "birth-report");
    const birthReportPath = path.join(root, "birth-report.json");
    await writeFile(birthReportPath, birth.stdout, "utf8");
    const birthReportDigest = await digestFile(birthReportPath);

    const delivery = await runCli([
      "delivery-report",
      SUPPORT_BLUEPRINT,
      "--build-state",
      buildStatePath,
      "--run-state",
      runStatePath,
      "--run-eval",
      runEvalPath,
      "--birth-report",
      birthReportPath,
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
      "--json",
    ]);
    assert.equal(delivery.code, 0, delivery.stderr);
    const deliveryJson = JSON.parse(delivery.stdout);
    assert.equal(deliveryJson.ok, true);
    assert.equal(deliveryJson.runtimePromotionEligible, false);
    assert.equal(deliveryJson.domainCertified, false);
    assert.equal(deliveryJson.deliveryReady, false);
    assert.equal(deliveryJson.certificationBoundary.runtimeCertifiedByDeliveryReport, false);
    assert.equal(deliveryJson.certificationBoundary.domainCertifiedByDeliveryReport, false);
    assert.equal(deliveryJson.certificationBoundary.productionApprovedByDeliveryReport, false);
    assertNoCertifyingTrueClaims(deliveryJson, "delivery-report");

    assertNoDiscoveryOrNeedArtifacts(await listRelativeFiles(root));
  });
});
