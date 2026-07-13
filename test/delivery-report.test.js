import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { digestRawBytes, loadAdmittedArtifact } from "../src/artifact-admission.js";
import { buildDeliveryReport, validateDeliveryReportArtifact } from "../src/delivery-report.js";
import { validateDomainEvalArtifact } from "../src/domain-eval.js";
import { assertPersistable } from "../src/persistability.js";
import {
  admitJsonValue,
  buildAdmittedDelivery,
  buildAdmittedEvidence,
} from "./helpers/admitted-reports.js";

function checkById(report, id) {
  return report.checks.find((item) => item.id === id);
}

function deliveryOptions(evidence, overrides = {}) {
  const domainEval = Object.hasOwn(overrides, "domainEval") ? overrides.domainEval : evidence.domainEval;
  const admissions = {
    blueprint: evidence.blueprintAdmission,
    buildState: evidence.buildStateAdmission,
    runState: evidence.runStateAdmission,
    runEval: evidence.runEvalAdmission,
    birthReport: evidence.birthReportAdmission,
    domainEval: Object.hasOwn(overrides.admissions ?? {}, "domainEval")
      ? overrides.admissions.domainEval
      : evidence.domainEvalAdmission,
    ...(overrides.admissions ?? {}),
  };
  return {
    buildState: overrides.buildState ?? evidence.buildState,
    runState: overrides.runState ?? evidence.runState,
    runEval: overrides.runEval ?? evidence.runEval,
    birthReport: overrides.birthReport ?? evidence.birthReport,
    domainEval,
    admissions,
  };
}

async function admitEquivalentBlueprintWithDifferentBytes(evidence) {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-delivery-blueprint-variant-"));
  const file = path.join(root, "blueprint.json");
  const bytes = Buffer.from(JSON.stringify(evidence.blueprint), "utf8");
  await writeFile(file, bytes);
  const admission = await loadAdmittedArtifact({
    filePath: file,
    subject: "blueprint",
    expectedDigest: digestRawBytes(bytes),
  });
  assert.notEqual(admission.digest, evidence.blueprintAdmission.digest);
  return admission;
}

describe("delivery report", () => {
  it("aggregates exact declared and domain evidence without promoting runtime, delivery, or production", async () => {
    const { deliveryReport: report } = await buildAdmittedDelivery({ runId: "delivery-declared-domain" });

    assert.equal(report.schemaVersion, "agentmo.delivery.v1");
    assert.equal(report.ok, true);
    assert.equal(validateDeliveryReportArtifact(report).ok, true);
    assert.doesNotThrow(() => assertPersistable(report, { subject: "delivery-report" }));
    assert.equal(report.domainCertified, true);
    assert.equal(report.runtimePromotionEligible, false);
    assert.equal(report.deliveryReady, false);
    assert.equal(report.productionApproved, false);
    assert.deepEqual(report.evidenceLevels, {
      declaredReady: true,
      liveSuccess: false,
      domainCertified: true,
      deliveryReady: false,
      productionApproved: false,
    });
    assert.equal(report.certificationBoundary.runtimeCertifiedByDeliveryReport, false);
    assert.equal(report.certificationBoundary.domainCertifiedByDeliveryReport, false);
    assert.equal(report.certificationBoundary.deliveryReadyByDeliveryReport, false);
    assert.equal(report.certificationBoundary.productionApprovedByDeliveryReport, false);
    assert.equal(report.certificationBoundary.domainCertifiedByDomainEval, true);
    assert.equal(checkById(report, "domain_eval_non_transitive").pass, true);
  });

  it("treats domain-eval absence as exact optional evidence, never implicit certification", async () => {
    const evidence = await buildAdmittedEvidence({
      runId: "delivery-domain-absent",
      includeDomainEval: false,
    });
    const report = await buildDeliveryReport(evidence.blueprint, deliveryOptions(evidence));

    assert.equal(report.ok, true);
    assert.equal(report.sources.domainEval, null);
    assert.equal(report.target.domainEval, null);
    assert.equal(report.domainCertified, false);
    assert.equal(report.evidenceLevels.domainCertified, false);
    assert.equal(report.runtimePromotionEligible, false);
    assert.equal(report.deliveryReady, false);
    assert.equal(report.productionApproved, false);
    assert.equal(checkById(report, "domain_eval_optional").pass, true);
    assert.match(report.nextActions.join("\n"), /domain evaluation/u);

    const withDomain = await buildAdmittedEvidence({ runId: "delivery-domain-pairing" });
    await assert.rejects(
      () => buildDeliveryReport(withDomain.blueprint, deliveryOptions(withDomain, {
        domainEval: null,
        admissions: { domainEval: withDomain.domainEvalAdmission },
      })),
      (error) => error?.code === "AGENTMO_DELIVERY_OPTIONAL_INPUT_INVALID",
    );
    await assert.rejects(
      () => buildDeliveryReport(withDomain.blueprint, deliveryOptions(withDomain, {
        admissions: { domainEval: null },
      })),
      (error) => error?.code === "AGENTMO_DELIVERY_OPTIONAL_INPUT_INVALID",
    );
  });

  it("rejects forged admissions, family swaps, and byte swaps before aggregation", async () => {
    const evidence = await buildAdmittedEvidence({ runId: "delivery-admission-rejection" });
    const forgedRunStateAdmission = Object.freeze({ ...evidence.runStateAdmission });
    await assert.rejects(
      () => buildDeliveryReport(evidence.blueprint, deliveryOptions(evidence, {
        admissions: { runState: forgedRunStateAdmission },
      })),
      (error) => error?.code === "AGENTMO_ARTIFACT_ADMISSION_RESULT_INVALID",
    );
    await assert.rejects(
      () => buildDeliveryReport(evidence.blueprint, deliveryOptions(evidence, {
        admissions: { runState: evidence.runEvalAdmission },
      })),
      (error) => error?.code === "AGENTMO_ARTIFACT_ADMISSION_RESULT_INVALID",
    );

    const fixture = await admitJsonValue("run-state", evidence.runState, "delivery-byte-swap");
    await writeFile(fixture.file, Buffer.concat([fixture.bytes, Buffer.from(" ")]));
    await assert.rejects(
      () => loadAdmittedArtifact({
        filePath: fixture.file,
        subject: "run-state",
        expectedDigest: fixture.admission.digest,
      }),
      (error) => error?.code === "AGENTMO_ARTIFACT_DIGEST_MISMATCH",
    );
  });

  it("fails aggregation for an independently admitted run-eval from another run", async () => {
    const evidence = await buildAdmittedEvidence({ runId: "delivery-run-eval-base" });
    const otherRun = await buildAdmittedEvidence({
      blueprintAdmission: evidence.blueprintAdmission,
      runId: "delivery-run-eval-other",
      includeDomainEval: false,
    });
    const report = await buildDeliveryReport(evidence.blueprint, deliveryOptions(evidence, {
      runEval: otherRun.runEval,
      admissions: { runEval: otherRun.runEvalAdmission },
    }));

    assert.equal(validateDeliveryReportArtifact(report).ok, true);
    assert.equal(report.ok, false);
    assert.equal(checkById(report, "run_eval_run_state_provenance").pass, false);
    assert.equal(checkById(report, "run_eval_run_id").pass, false);
    assert.equal(checkById(report, "birth_run_eval_provenance").pass, false);
    assert.equal(report.runtimePromotionEligible, false);
    assert.equal(report.deliveryReady, false);
    assert.equal(report.productionApproved, false);
  });

  it("fails aggregation for an independently admitted birth-report from another run", async () => {
    const evidence = await buildAdmittedEvidence({ runId: "delivery-birth-base" });
    const otherRun = await buildAdmittedEvidence({
      blueprintAdmission: evidence.blueprintAdmission,
      runId: "delivery-birth-other",
      includeDomainEval: false,
    });
    const report = await buildDeliveryReport(evidence.blueprint, deliveryOptions(evidence, {
      birthReport: otherRun.birthReport,
      admissions: { birthReport: otherRun.birthReportAdmission },
    }));

    assert.equal(validateDeliveryReportArtifact(report).ok, true);
    assert.equal(report.ok, false);
    assert.equal(checkById(report, "birth_run_state_provenance").pass, false);
    assert.equal(checkById(report, "birth_run_eval_provenance").pass, false);
    assert.equal(checkById(report, "birth_run_id").pass, false);
    assert.equal(report.runtimePromotionEligible, false);
    assert.equal(report.deliveryReady, false);
    assert.equal(report.productionApproved, false);
  });

  it("fails aggregation for a valid domain-eval bound to independently admitted blueprint bytes", async () => {
    const evidence = await buildAdmittedEvidence({ runId: "delivery-domain-base" });
    const alternateBlueprint = await admitEquivalentBlueprintWithDifferentBytes(evidence);
    const alternate = await buildAdmittedEvidence({
      blueprintAdmission: alternateBlueprint,
      runId: "delivery-domain-alternate",
    });
    assert.equal(alternate.domainEval.ok, true);
    assert.equal(alternate.domainEval.sources.blueprint.digest, alternateBlueprint.digest);

    const report = await buildDeliveryReport(evidence.blueprint, deliveryOptions(evidence, {
      domainEval: alternate.domainEval,
      admissions: { domainEval: alternate.domainEvalAdmission },
    }));

    assert.equal(validateDeliveryReportArtifact(report).ok, true);
    assert.equal(report.ok, false);
    assert.equal(checkById(report, "domain_eval_valid").pass, true);
    assert.equal(checkById(report, "domain_eval_blueprint_provenance").pass, false);
    assert.equal(checkById(report, "domain_eval_non_transitive").pass, true);
    assert.equal(report.domainCertified, true);
    assert.equal(report.runtimePromotionEligible, false);
    assert.equal(report.deliveryReady, false);
    assert.equal(report.productionApproved, false);
  });

  it("rejects forged transitive promotion claims without mutating admitted evidence", async () => {
    const { deliveryReport } = await buildAdmittedDelivery({ runId: "delivery-boundary-forgery" });
    const runtimePromotion = { ...structuredClone(deliveryReport), runtimePromotionEligible: true };
    const deliveryReady = { ...structuredClone(deliveryReport), deliveryReady: true };
    const productionApproved = { ...structuredClone(deliveryReport), productionApproved: true };

    assert.equal(validateDeliveryReportArtifact(runtimePromotion).ok, false);
    assert.equal(validateDeliveryReportArtifact(deliveryReady).ok, false);
    assert.equal(validateDeliveryReportArtifact(productionApproved).ok, false);
    assert.equal(deliveryReport.runtimePromotionEligible, false);
    assert.equal(deliveryReport.deliveryReady, false);
    assert.equal(deliveryReport.productionApproved, false);
  });

  it("rejects non-canonical checks and never delivers contradictory domain coverage", async () => {
    const evidence = await buildAdmittedDelivery({ runId: "delivery-check-contract" });
    const baseline = evidence.deliveryReport;
    const mutations = [];

    const empty = structuredClone(baseline);
    empty.checks = [];
    mutations.push(empty);
    const missing = structuredClone(baseline);
    missing.checks.splice(4, 1);
    mutations.push(missing);
    const duplicate = structuredClone(baseline);
    duplicate.checks[4] = structuredClone(duplicate.checks[3]);
    mutations.push(duplicate);
    const extra = structuredClone(baseline);
    extra.checks.push({ id: "unexpected_check", pass: true, message: "unexpected" });
    mutations.push(extra);
    const renamed = structuredClone(baseline);
    renamed.checks[5].id = "scope_match";
    mutations.push(renamed);
    const reordered = structuredClone(baseline);
    [reordered.checks[0], reordered.checks[1]] = [reordered.checks[1], reordered.checks[0]];
    mutations.push(reordered);
    const outcomeForged = structuredClone(baseline);
    outcomeForged.checks[0].pass = false;
    outcomeForged.ok = false;
    outcomeForged.nextActions = ["Repair invalid or mismatched source evidence before rebuilding delivery-report."];
    mutations.push(outcomeForged);

    for (const candidate of mutations) {
      assert.equal(validateDeliveryReportArtifact(candidate).ok, false);
    }

    const contradictoryDomain = structuredClone(evidence.domainEval);
    assert.equal(contradictoryDomain.requiredCaseClasses.length, 3);
    contradictoryDomain.coveredCaseClasses = [];
    contradictoryDomain.missingCaseClasses = [];
    for (const result of contradictoryDomain.caseResults) result.required = false;
    contradictoryDomain.ok = true;
    contradictoryDomain.domainCertifiedByDomainEval = true;
    contradictoryDomain.certificationBoundary.domainCertifiedByDomainEval = true;
    for (const item of contradictoryDomain.checks) item.pass = true;

    assert.equal(validateDomainEvalArtifact(contradictoryDomain).ok, false);
    await assert.rejects(
      () => admitJsonValue("domain-eval", contradictoryDomain, "delivery-contradictory-domain"),
      (error) => error?.code === "AGENTMO_UNSUPPORTED_ARTIFACT",
    );
    assert.equal(validateDeliveryReportArtifact(baseline, {
      blueprint: evidence.blueprint,
      buildState: evidence.buildState,
      runState: evidence.runState,
      runEval: evidence.runEval,
      birthReport: evidence.birthReport,
      domainEval: contradictoryDomain,
      sources: baseline.sources,
    }).ok, false);
    assert.equal(baseline.deliveryReady, false);
    assert.equal(baseline.productionApproved, false);
  });
});
