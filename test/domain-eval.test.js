import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { buildDomainEval, loadDomainCases } from "../src/domain-eval.js";

async function loadSupportTriageBlueprint() {
  return JSON.parse(await readFile(new URL("../examples/support-triage.agentmo.json", import.meta.url), "utf8"));
}

async function loadSupportTriageCases() {
  return loadDomainCases(new URL("../examples/support-triage.domain-cases.json", import.meta.url));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function checkById(report, id) {
  return report.checks.find((check) => check.id === id);
}

function failedCheckIds(report) {
  return report.checks.filter((check) => !check.pass).map((check) => check.id).join(", ");
}

describe("domain eval", () => {
  it("passes the support-triage fixture with stable gate check ids", async () => {
    const blueprint = await loadSupportTriageBlueprint();
    const domainCases = await loadSupportTriageCases();
    const report = buildDomainEval(blueprint, domainCases, { target: "openclaw" });

    assert.equal(report.schemaVersion, "agentmo.domain-eval.v1");
    assert.equal(report.ok, true, failedCheckIds(report));
    assert.equal(report.domainCertifiedByDomainEval, true);
    assert.equal(report.productionApprovedByDomainEval, false);
    assert.equal(report.certificationBoundary.runtimeCertifiedByDomainEval, false);
    assert.equal(report.certificationBoundary.domainCertifiedByDomainEval, true);
    assert.deepEqual(report.missingCaseClasses, []);

    for (const id of [
      "required_case_classes_covered",
      "case_thresholds_pass",
      "hard_failures_absent",
      "evaluator_provenance_present",
      "rubric_provenance_present",
      "bounded_evidence_refs",
      "no_raw_or_secret_evidence",
    ]) {
      assert.equal(checkById(report, id)?.pass, true, id);
    }
  });

  it("fails closed when a required case class is missing", async () => {
    const blueprint = await loadSupportTriageBlueprint();
    const domainCases = clone(await loadSupportTriageCases());
    domainCases.cases = domainCases.cases.filter((domainCase) => domainCase.caseClass !== "draft-evidence-backed-customer-reply");

    const report = buildDomainEval(blueprint, domainCases, { target: "openclaw" });

    assert.equal(report.ok, false);
    assert.deepEqual(report.missingCaseClasses, ["draft-evidence-backed-customer-reply"]);
    assert.equal(checkById(report, "required_case_classes_covered").pass, false);
    assert.equal(checkById(report, "case_thresholds_pass").pass, false);
  });

  it("fails closed when a case records a hard failure", async () => {
    const blueprint = await loadSupportTriageBlueprint();
    const domainCases = clone(await loadSupportTriageCases());
    domainCases.cases[0].hardFailures.push("invent-customer-account-facts");

    const report = buildDomainEval(blueprint, domainCases, { target: "openclaw" });

    assert.equal(report.ok, false);
    assert.equal(checkById(report, "hard_failures_absent").pass, false);
    assert.equal(checkById(report, "no_hard_failures").pass, false);
    assert.deepEqual(report.caseResults[0].hardFailures, ["invent-customer-account-facts"]);
  });

  it("fails closed when case evidence stores raw markers", async () => {
    const blueprint = await loadSupportTriageBlueprint();
    const domainCases = clone(await loadSupportTriageCases());
    domainCases.cases[0].evidence[0].type = "raw-transcript";

    const report = buildDomainEval(blueprint, domainCases, { target: "openclaw" });

    assert.equal(report.ok, false);
    assert.equal(checkById(report, "bounded_evidence_refs").pass, false);
    assert.equal(checkById(report, "no_raw_or_secret_evidence").pass, false);
    assert.equal(report.audit.rawFindingCount > 0, true);
  });

  it("fails closed when case evidence contains secret-like values", async () => {
    const blueprint = await loadSupportTriageBlueprint();
    const domainCases = clone(await loadSupportTriageCases());
    domainCases.cases[0].evidence[0].summary = "api_key=domain-secret-123456";

    const report = buildDomainEval(blueprint, domainCases, { target: "openclaw" });

    assert.equal(report.ok, false);
    assert.equal(checkById(report, "bounded_evidence_refs").pass, false);
    assert.equal(checkById(report, "no_raw_or_secret_evidence").pass, false);
    assert.equal(report.audit.secretFindingCount > 0, true);
  });
});
