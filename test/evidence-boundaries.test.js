import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateBirthReportArtifact } from "../src/birth-report.js";
import { validateDeliveryReportArtifact } from "../src/delivery-report.js";
import { validateDomainEvalArtifact } from "../src/domain-eval.js";
import { assertPersistable } from "../src/persistability.js";
import { buildAgentMoReport, validateReportArtifact } from "../src/report.js";
import { validateRunEvalArtifact } from "../src/run-state.js";
import { buildAdmittedDelivery } from "./helpers/admitted-reports.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

describe("evidence boundaries", () => {
  it("keeps declared and bounded domain evidence independent from delivery and production", async () => {
    const evidence = await buildAdmittedDelivery({ runId: "boundary-declared-domain" });
    const report = await buildAgentMoReport(evidence.blueprint, {
      admission: evidence.blueprintAdmission,
    });

    assert.deepEqual(report.evidenceLevels, {
      declaredReady: false,
      liveSuccess: false,
      domainCertified: false,
      deliveryReady: false,
      productionApproved: false,
    });
    assert.deepEqual(evidence.runEval.evidenceLevels, report.evidenceLevels);
    assert.deepEqual(evidence.birthReport.evidenceLevels, {
      declaredReady: true,
      liveSuccess: false,
      domainCertified: false,
      deliveryReady: false,
      productionApproved: false,
    });
    assert.equal(evidence.domainEval.domainCertifiedByDomainEval, true);
    assert.equal(evidence.domainEval.runtimeCertifiedByDomainEval, false);
    assert.equal(evidence.domainEval.deliveryReadyByDomainEval, false);
    assert.equal(evidence.domainEval.productionApprovedByDomainEval, false);
    assert.deepEqual(evidence.deliveryReport.evidenceLevels, {
      declaredReady: true,
      liveSuccess: false,
      domainCertified: true,
      deliveryReady: false,
      productionApproved: false,
    });
    assert.equal(evidence.deliveryReport.runtimePromotionEligible, false);
    assert.equal(evidence.deliveryReport.deliveryReady, false);
    assert.equal(evidence.deliveryReport.productionApproved, false);

    const candidates = [
      ["report", report],
      ["run-eval", evidence.runEval],
      ["birth-report", evidence.birthReport],
      ["domain-eval", evidence.domainEval],
      ["delivery-report", evidence.deliveryReport],
    ];
    for (const [subject, candidate] of candidates) {
      assert.doesNotThrow(() => assertPersistable(candidate, { subject }));
      assert.equal(JSON.stringify(candidate).includes(evidence.root), false, subject);
    }

    const forgedReport = clone(report);
    forgedReport.evidenceLevels.productionApproved = true;
    assert.equal(validateReportArtifact(forgedReport).ok, false);
    const forgedRunEval = clone(evidence.runEval);
    forgedRunEval.evidenceLevels.liveSuccess = true;
    assert.equal(validateRunEvalArtifact(forgedRunEval).ok, false);
    const forgedBirth = clone(evidence.birthReport);
    forgedBirth.evidenceLevels.domainCertified = true;
    assert.equal(validateBirthReportArtifact(forgedBirth).ok, false);
    const forgedDomain = clone(evidence.domainEval);
    forgedDomain.deliveryReadyByDomainEval = true;
    assert.equal(validateDomainEvalArtifact(forgedDomain).ok, false);
    const forgedDelivery = clone(evidence.deliveryReport);
    forgedDelivery.deliveryReady = true;
    assert.equal(validateDeliveryReportArtifact(forgedDelivery).ok, false);
  });

  it("keeps isolated live success independent when domain evidence is absent", async () => {
    const privateCanary = "api_key=synthetic-boundary-canary-123456";
    const evidence = await buildAdmittedDelivery({
      includeDomainEval: false,
      live: true,
      expectStatus: "success",
      runId: "boundary-live-only",
      runner: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({ status: "ok", payloads: [{ text: privateCanary }] }),
        stderr: "",
        timedOut: false,
        durationMs: 1,
      }),
    });

    assert.deepEqual(evidence.birthReport.evidenceLevels, {
      declaredReady: false,
      liveSuccess: true,
      domainCertified: false,
      deliveryReady: false,
      productionApproved: false,
    });
    assert.deepEqual(evidence.deliveryReport.evidenceLevels, evidence.birthReport.evidenceLevels);
    assert.equal(evidence.deliveryReport.domainCertified, false);
    assert.equal(evidence.deliveryReport.runtimePromotionEligible, false);
    assert.equal(evidence.deliveryReport.deliveryReady, false);
    assert.equal(evidence.deliveryReport.productionApproved, false);
    assert.equal(JSON.stringify(evidence.birthReport).includes(privateCanary), false);
    assert.equal(JSON.stringify(evidence.deliveryReport).includes(privateCanary), false);
  });
});
