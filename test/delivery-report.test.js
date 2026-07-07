import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildBirthReport } from "../src/birth-report.js";
import { BUILD_STATE_FILENAME } from "../src/build-state.js";
import { buildDeliveryReport } from "../src/delivery-report.js";
import { buildDomainEval, loadDomainCases } from "../src/domain-eval.js";
import { buildRunEval, executeRuntimeRun } from "../src/run-state.js";
import { scaffoldAgent } from "../src/scaffold.js";

async function loadSupportTriageBlueprint() {
  return JSON.parse(await readFile(new URL("../examples/support-triage.agentmo.json", import.meta.url), "utf8"));
}

async function loadSupportTriageCases() {
  return loadDomainCases(new URL("../examples/support-triage.domain-cases.json", import.meta.url));
}

async function buildDeclaredEvidence(runId) {
  const blueprint = await loadSupportTriageBlueprint();
  const domainCases = await loadSupportTriageCases();
  const scaffoldDir = await mkdtemp(path.join(tmpdir(), "agentmo-delivery-scaffold-"));
  await scaffoldAgent(blueprint, scaffoldDir, { target: "openclaw" });
  const buildState = JSON.parse(await readFile(path.join(scaffoldDir, BUILD_STATE_FILENAME), "utf8"));
  const { runState } = await executeRuntimeRun(blueprint, {
    target: "openclaw",
    workspace: path.join(scaffoldDir, "workspace"),
    message: "Say exactly: ok",
    runId,
    now: "2026-07-07T00:00:00.000Z",
  });
  const runEval = buildRunEval(runState, { expectStatus: "declared" });
  const birthReport = buildBirthReport(blueprint, { buildState, runState, runEval, expectStatus: "declared" });
  const domainEval = buildDomainEval(blueprint, domainCases, { target: "openclaw" });

  return { blueprint, buildState, runState, runEval, birthReport, domainEval };
}

function buildReport(artifacts, overrides = {}) {
  return buildDeliveryReport(artifacts.blueprint, {
    buildState: artifacts.buildState,
    runState: artifacts.runState,
    runEval: artifacts.runEval,
    birthReport: artifacts.birthReport,
    domainEval: artifacts.domainEval,
    ...overrides,
  });
}

function checkById(report, id) {
  return report.checks.find((check) => check.id === id);
}

function failedCheckIds(report) {
  return report.checks.filter((check) => !check.pass).map((check) => check.id).join(", ");
}

describe("delivery report", () => {
  it("passes declared evidence with domain certification but no runtime promotion or delivery readiness", async () => {
    const artifacts = await buildDeclaredEvidence("delivery-declared-ok");

    assert.equal(artifacts.runEval.ok, true);
    assert.equal(artifacts.birthReport.ok, true);
    assert.equal(artifacts.domainEval.ok, true);

    const report = buildReport(artifacts);

    assert.equal(report.schemaVersion, "agentmo.delivery.v1");
    assert.equal(report.ok, true, failedCheckIds(report));
    assert.equal(report.domainCertified, true);
    assert.equal(report.runtimePromotionEligible, false);
    assert.equal(report.deliveryReady, false);
    assert.equal(report.certificationBoundary.runtimeCertifiedByDeliveryReport, false);
    assert.equal(report.certificationBoundary.domainCertifiedByDeliveryReport, false);
    assert.equal(report.certificationBoundary.productionApprovedByDeliveryReport, false);
    assert.equal(report.certificationBoundary.domainCertifiedByDomainEval, true);
  });

  it("passes without domain-eval while leaving domain certification false", async () => {
    const artifacts = await buildDeclaredEvidence("delivery-no-domain-eval");
    const report = buildReport(artifacts, { domainEval: null });

    assert.equal(report.ok, true, failedCheckIds(report));
    assert.equal(report.domainCertified, false);
    assert.equal(report.artifacts.domainEval.available, false);
    assert.equal(checkById(report, "domain_eval_optional").pass, true);
    assert.match(report.nextActions.join("\n"), /domain-eval/u);
  });

  it("fails closed when domain-eval claims runtime certification", async () => {
    const artifacts = await buildDeclaredEvidence("delivery-domain-eval-runtime-cert");
    assert.equal(artifacts.domainEval.ok, true);
    assert.equal(artifacts.domainEval.certificationBoundary.runtimeCertifiedByDomainEval, false);

    const domainEval = {
      ...artifacts.domainEval,
      certificationBoundary: {
        ...artifacts.domainEval.certificationBoundary,
        runtimeCertifiedByDomainEval: true,
      },
    };
    const report = buildReport(artifacts, { domainEval });

    assert.equal(report.ok, false);
    assert.equal(checkById(report, "domain_eval_optional_or_valid").pass, false);
    assert.equal(report.domainCertified, false);
  });

  it("fails closed when domain-eval claims production approval", async () => {
    const artifacts = await buildDeclaredEvidence("delivery-domain-eval-production-approval");
    assert.equal(artifacts.domainEval.ok, true);
    assert.equal(artifacts.domainEval.certificationBoundary.productionApprovedByDomainEval, false);

    const domainEval = {
      ...artifacts.domainEval,
      certificationBoundary: {
        ...artifacts.domainEval.certificationBoundary,
        productionApprovedByDomainEval: true,
      },
    };
    const report = buildReport(artifacts, { domainEval });

    assert.equal(report.ok, false);
    assert.equal(checkById(report, "domain_eval_optional_or_valid").pass, false);
    assert.equal(report.domainCertified, false);
  });

  it("fails closed when run-eval does not match the run-state", async () => {
    const artifacts = await buildDeclaredEvidence("delivery-run-eval-mismatch");
    const report = buildReport(artifacts, { runEval: { ...artifacts.runEval, runId: "different-run" } });

    assert.equal(report.ok, false);
    assert.equal(checkById(report, "run_eval_run_id_match").pass, false);
    assert.equal(checkById(report, "run_eval_run_id").pass, false);
  });

  it("fails closed when the birth-report expectation does not match run evidence", async () => {
    const artifacts = await buildDeclaredEvidence("delivery-birth-expectation-mismatch");
    const birthReport = buildBirthReport(artifacts.blueprint, {
      buildState: artifacts.buildState,
      runState: artifacts.runState,
      runEval: artifacts.runEval,
      expectStatus: "success",
    });
    const report = buildReport(artifacts, { birthReport });

    assert.equal(birthReport.ok, false);
    assert.equal(report.ok, false);
    assert.equal(checkById(report, "birth_report_expectation_match").pass, false);
    assert.equal(checkById(report, "birth_expectation_matches").pass, false);
    assert.equal(checkById(report, "birth_report_ok").pass, false);
  });

  it("fails closed when managed evidence contains raw markers", async () => {
    const artifacts = await buildDeclaredEvidence("delivery-raw-evidence");
    artifacts.runState.evidence.rawTranscriptStored = true;
    const report = buildReport(artifacts);

    assert.equal(report.ok, false);
    assert.equal(checkById(report, "evidence_no_raw_or_secret").pass, false);
    assert.equal(checkById(report, "no_raw_transcripts").pass, false);
    assert.equal(report.evidence.audit.rawFindingCount > 0, true);
  });

  it("fails closed when managed evidence contains secret-like values", async () => {
    const artifacts = await buildDeclaredEvidence("delivery-secret-evidence");
    artifacts.runState.evidence.sanitizedNote = "api_key=delivery-secret-123456";
    const report = buildReport(artifacts);

    assert.equal(report.ok, false);
    assert.equal(checkById(report, "evidence_no_raw_or_secret").pass, false);
    assert.equal(checkById(report, "managed_evidence_sanitized").pass, false);
    assert.equal(report.evidence.audit.secretFindingCount > 0, true);
  });
});
