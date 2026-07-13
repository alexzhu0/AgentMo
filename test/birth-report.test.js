import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildBirthReport,
  validateBirthReportArtifact,
} from "../src/birth-report.js";
import { assertPersistable } from "../src/persistability.js";
import {
  admitJsonValue,
  buildAdmittedEvidence,
} from "./helpers/admitted-reports.js";

function checkById(report, id) {
  return report.checks.find((item) => item.id === id);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

describe("birth report", () => {
  it("accepts exact declared evidence without promoting another evidence level", async () => {
    const evidence = await buildAdmittedEvidence({
      includeDomainEval: false,
      runId: "birth-declared-exact",
    });
    const report = evidence.birthReport;

    assert.equal(report.schemaVersion, "agentmo.birth-report.v1");
    assert.equal(report.ok, true, report.checks.filter((item) => !item.pass).map((item) => item.id).join(", "));
    assert.equal(validateBirthReportArtifact(report).ok, true);
    assert.doesNotThrow(() => assertPersistable(report, { subject: "birth-report" }));
    assert.equal(report.birthReady, true);
    assert.equal(report.birthStatus, "declared-ready");
    assert.equal(report.promotionEligible, false);
    assert.deepEqual(report.evidenceLevels, {
      declaredReady: true,
      liveSuccess: false,
      domainCertified: false,
      deliveryReady: false,
      productionApproved: false,
    });
    assert.equal(report.sources.blueprint.digest, evidence.blueprintAdmission.digest);
    assert.equal(report.sources.buildState.digest, evidence.buildStateAdmission.digest);
    assert.equal(report.sources.runState.digest, evidence.runStateAdmission.digest);
    assert.equal(report.sources.runEval.digest, evidence.runEvalAdmission.digest);
    assert.equal(JSON.stringify(report).includes(evidence.root), false);
  });

  it("records isolated live success without runtime promotion, domain, delivery, or production elevation", async () => {
    const privateOutput = "api_key=synthetic-live-report-canary-123456";
    const evidence = await buildAdmittedEvidence({
      includeDomainEval: false,
      live: true,
      expectStatus: "success",
      runId: "birth-live-exact",
      runner: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({ status: "ok", payloads: [{ text: privateOutput }], meta: { transport: "local" } }),
        stderr: "",
        timedOut: false,
        durationMs: 1,
      }),
    });
    const report = evidence.birthReport;

    assert.equal(report.ok, true);
    assert.equal(report.evidenceLevel, "live-success");
    assert.equal(report.evidenceLevels.liveSuccess, true);
    assert.equal(report.evidenceLevels.declaredReady, false);
    assert.equal(report.promotionEligible, false);
    assert.equal(report.evidenceLevels.domainCertified, false);
    assert.equal(report.evidenceLevels.deliveryReady, false);
    assert.equal(report.evidenceLevels.productionApproved, false);
    assert.equal(report.certificationBoundary.runtimeCertifiedByBirthReport, false);
    assert.equal(JSON.stringify(report).includes(privateOutput), false);
  });

  it("keeps explicit failure evidence valid but not birth-ready", async () => {
    const evidence = await buildAdmittedEvidence({
      includeDomainEval: false,
      live: true,
      expectStatus: "failure",
      runId: "birth-failure-exact",
      runner: async () => ({ exitCode: 2, stdout: "", stderr: "", timedOut: false, durationMs: 1 }),
    });
    const report = evidence.birthReport;

    assert.equal(report.ok, true);
    assert.equal(report.artifactValid, true);
    assert.equal(report.evidenceLevel, "failure");
    assert.equal(report.birthStatus, "failure-evidence");
    assert.equal(report.birthReady, false);
    assert.equal(Object.values(report.evidenceLevels).some(Boolean), false);
  });

  it("revalidates freshness when a separately admitted run-eval belongs to another run", async () => {
    const first = await buildAdmittedEvidence({ includeDomainEval: false, runId: "birth-first-exact" });
    const second = await buildAdmittedEvidence({ includeDomainEval: false, runId: "birth-second-exact" });
    const report = await buildBirthReport(first.blueprint, {
      buildState: first.buildState,
      runState: first.runState,
      runEval: second.runEval,
      expectStatus: "declared",
      admissions: {
        blueprint: first.blueprintAdmission,
        buildState: first.buildStateAdmission,
        runState: first.runStateAdmission,
        runEval: second.runEvalAdmission,
      },
    });

    assert.equal(report.ok, false);
    assert.equal(report.birthReady, false);
    assert.equal(checkById(report, "run_eval_run_state_provenance").pass, false);
    assert.equal(checkById(report, "run_eval_run_id").pass, false);
    assert.equal(report.evidenceLevels.domainCertified, false);
  });

  it("rejects a valid artifact token in the wrong slot before report construction", async () => {
    const evidence = await buildAdmittedEvidence({ includeDomainEval: false, runId: "birth-slot-swap" });
    await assert.rejects(
      () => buildBirthReport(evidence.blueprint, {
        buildState: evidence.buildState,
        runState: evidence.runState,
        runEval: evidence.runEval,
        expectStatus: "declared",
        admissions: {
          blueprint: evidence.blueprintAdmission,
          buildState: evidence.buildStateAdmission,
          runState: evidence.runStateAdmission,
          runEval: evidence.runStateAdmission,
        },
      }),
      (error) => error?.code === "AGENTMO_ARTIFACT_ADMISSION_RESULT_INVALID",
    );
  });

  it("rejects unsafe source bytes and forged report boundaries value-blind", async () => {
    const evidence = await buildAdmittedEvidence({ includeDomainEval: false, runId: "birth-hostile" });
    const privateCanary = "api_key=synthetic-birth-canary-123456";
    const unsafeRunState = { ...clone(evidence.runState), transcript: privateCanary };
    await assert.rejects(
      () => admitJsonValue("run-state", unsafeRunState, "birth-hostile-run-state"),
      (error) => {
        assert.equal(error.message.includes(privateCanary), false);
        assert.equal(JSON.stringify(error).includes(privateCanary), false);
        return ["AGENTMO_ARTIFACT_UNSAFE_CONTENT", "AGENTMO_UNSUPPORTED_ARTIFACT"].includes(error.code);
      },
    );

    const forged = clone(evidence.birthReport);
    forged.certificationBoundary.runtimeCertifiedByBirthReport = true;
    assert.equal(validateBirthReportArtifact(forged).ok, false);
    const pathBearing = { ...clone(evidence.birthReport), hostPath: "/private/birth-report-canary" };
    assert.equal(validateBirthReportArtifact(pathBearing).ok, false);
  });

  it("rejects non-canonical check sets and source-outcome forgery", async () => {
    const evidence = await buildAdmittedEvidence({ includeDomainEval: false, runId: "birth-check-contract" });
    const baseline = evidence.birthReport;
    const mutations = [];

    const empty = clone(baseline);
    empty.checks = [];
    mutations.push(empty);
    const missing = clone(baseline);
    missing.checks.splice(3, 1);
    mutations.push(missing);
    const duplicate = clone(baseline);
    duplicate.checks[3] = clone(duplicate.checks[2]);
    mutations.push(duplicate);
    const extra = clone(baseline);
    extra.checks.push({ id: "unexpected_check", pass: true, message: "unexpected" });
    mutations.push(extra);
    const renamed = clone(baseline);
    renamed.checks[4].id = "run_eval_shape";
    mutations.push(renamed);
    const reordered = clone(baseline);
    [reordered.checks[0], reordered.checks[1]] = [reordered.checks[1], reordered.checks[0]];
    mutations.push(reordered);
    const outcomeForged = clone(baseline);
    outcomeForged.checks[1].pass = false;
    outcomeForged.ok = false;
    outcomeForged.artifactValid = false;
    outcomeForged.birthReady = false;
    outcomeForged.birthStatus = "blocked";
    outcomeForged.evidenceLevels.declaredReady = false;
    outcomeForged.nextActions = ["Repair the independently failed evidence checks before rebuilding birth-report."];
    mutations.push(outcomeForged);

    for (const candidate of mutations) {
      assert.equal(validateBirthReportArtifact(candidate).ok, false);
    }

    const other = await buildAdmittedEvidence({ includeDomainEval: false, runId: "birth-check-other" });
    const mismatched = await buildBirthReport(evidence.blueprint, {
      buildState: evidence.buildState,
      runState: evidence.runState,
      runEval: other.runEval,
      expectStatus: "declared",
      admissions: {
        blueprint: evidence.blueprintAdmission,
        buildState: evidence.buildStateAdmission,
        runState: evidence.runStateAdmission,
        runEval: other.runEvalAdmission,
      },
    });
    assert.equal(mismatched.ok, false);
    const forgedPass = clone(mismatched);
    forgedPass.checks = baseline.checks.map(clone);
    forgedPass.ok = true;
    forgedPass.artifactValid = true;
    forgedPass.birthReady = true;
    forgedPass.birthStatus = "declared-ready";
    forgedPass.evidenceLevels.declaredReady = true;
    assert.equal(validateBirthReportArtifact(forgedPass, {
      blueprint: evidence.blueprint,
      buildState: evidence.buildState,
      runState: evidence.runState,
      runEval: other.runEval,
      expectStatus: "declared",
      sources: mismatched.sources,
    }).ok, false);
  });
});
