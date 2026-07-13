import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";
import { digestRawBytes, loadAdmittedArtifact } from "../src/artifact-admission.js";
import { buildBirthReport, validateBirthReportArtifact } from "../src/birth-report.js";
import { buildDeliveryReport, validateDeliveryReportArtifact } from "../src/delivery-report.js";
import { buildRunEvalVerified, validateRunEvalArtifact } from "../src/run-state.js";
import {
  admitJsonValue,
  buildAdmittedDelivery,
  buildAdmittedEvidence,
} from "./helpers/admitted-reports.js";

const SUBSTITUTE_DIGEST = `sha256:${"f".repeat(64)}`;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

describe("source-authentic derived report admission", () => {
  let root;
  let sequence = 0;
  let withDomain;
  let withoutDomain;
  let failing;

  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), "agentmo-derived-admission-"));
    withDomain = await buildAdmittedDelivery({ runId: "derived-admission-ready" });
    withoutDomain = await buildAdmittedDelivery({
      includeDomainEval: false,
      runId: "derived-admission-no-domain",
    });
    failing = await buildFailingEvidenceChain();
  });

  async function loadCandidate(subject, value, companions) {
    sequence += 1;
    const file = path.join(root, `${String(sequence).padStart(3, "0")}-${subject}.json`);
    const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await writeFile(file, bytes);
    return loadAdmittedArtifact({
      filePath: file,
      subject,
      expectedDigest: digestRawBytes(bytes),
      ...(companions === undefined ? {} : { companions }),
    });
  }

  it("requires the exact branded companion set and admits every legal chain", async () => {
    const families = [
      ["run-eval", withDomain.runEval, runEvalCompanions(withDomain)],
      ["birth-report", withDomain.birthReport, birthCompanions(withDomain)],
      ["delivery-report", withDomain.deliveryReport, deliveryCompanions(withDomain)],
    ];

    for (const [subject, value, companions] of families) {
      const admitted = await loadCandidate(subject, value, companions);
      assert.equal(admitted.subject, subject);
      await assert.rejects(
        () => loadCandidate(subject, value),
        (error) => error?.code === "AGENTMO_ARTIFACT_COMPANION_SET_REQUIRED",
      );
      const keys = Object.keys(companions);
      for (const key of keys) {
        const forged = { ...companions, [key]: Object.freeze({ ...companions[key] }) };
        await assert.rejects(
          () => loadCandidate(subject, value, forged),
          (error) => error?.code === "AGENTMO_ARTIFACT_ADMISSION_RESULT_INVALID",
        );
      }
      const missing = { ...companions };
      delete missing[keys[0]];
      await assert.rejects(
        () => loadCandidate(subject, value, missing),
        (error) => error?.code === "AGENTMO_ARTIFACT_COMPANION_SET_REQUIRED",
      );
      await assert.rejects(
        () => loadCandidate(subject, value, { ...companions, blueprintCanary: companions[keys[0]] }),
        (error) => error?.code === "AGENTMO_ARTIFACT_COMPANION_SET_REQUIRED",
      );
    }

    await assert.rejects(
      () => loadCandidate("delivery-report", withoutDomain.deliveryReport, {
        ...deliveryCompanions(withoutDomain),
        "domain-eval": withDomain.domainEvalAdmission,
      }),
      (error) => error?.code === "AGENTMO_ARTIFACT_COMPANION_SET_REQUIRED",
    );
  });

  it("rejects every required source digest substitution", async () => {
    const runEval = clone(withDomain.runEval);
    runEval.source.digest = SUBSTITUTE_DIGEST;
    assert.equal(validateRunEvalArtifact(runEval).ok, true);
    await rejectsSourceForgery(() => loadCandidate("run-eval", runEval, runEvalCompanions(withDomain)));

    for (const source of ["blueprint", "buildState", "runState", "runEval"]) {
      const report = clone(withDomain.birthReport);
      report.sources[source].digest = SUBSTITUTE_DIGEST;
      assert.equal(validateBirthReportArtifact(report).ok, true);
      await rejectsSourceForgery(() => loadCandidate("birth-report", report, birthCompanions(withDomain)));
    }

    for (const source of ["blueprint", "buildState", "runState", "runEval", "birthReport", "domainEval"]) {
      const report = clone(withDomain.deliveryReport);
      report.sources[source].digest = SUBSTITUTE_DIGEST;
      assert.equal(validateDeliveryReportArtifact(report).ok, true);
      await rejectsSourceForgery(() => loadCandidate("delivery-report", report, deliveryCompanions(withDomain)));
    }
  });

  it("recomputes every required check and rejects both outcome directions", async () => {
    await rejectEveryFalseCheck(
      "run-eval",
      withDomain.runEval,
      runEvalCompanions(withDomain),
      (report) => { report.ok = false; },
    );
    await rejectEveryFalseCheck(
      "birth-report",
      withDomain.birthReport,
      birthCompanions(withDomain),
      makeBirthReportFailClosed,
    );
    await rejectEveryFalseCheck(
      "delivery-report",
      withDomain.deliveryReport,
      deliveryCompanions(withDomain),
      makeDeliveryReportFailClosed,
    );
    await rejectEveryFalseCheck(
      "delivery-report",
      withoutDomain.deliveryReport,
      deliveryCompanions(withoutDomain),
      makeDeliveryReportFailClosed,
    );

    const falseRunEval = clone(withDomain.runEval);
    falseRunEval.checks.find((item) => item.id === "schema").pass = false;
    falseRunEval.ok = false;
    assert.equal(validateRunEvalArtifact(falseRunEval).ok, true);
    await rejectsSourceForgery(() => loadCandidate(
      "run-eval",
      falseRunEval,
      runEvalCompanions(withDomain),
    ));

    const trueRunEval = clone(failing.runEval);
    for (const item of trueRunEval.checks) item.pass = true;
    trueRunEval.ok = true;
    assert.equal(validateRunEvalArtifact(trueRunEval).ok, true);
    await rejectsSourceForgery(() => loadCandidate(
      "run-eval",
      trueRunEval,
      runEvalCompanions(failing),
    ));

    const falseBirth = clone(withDomain.birthReport);
    falseBirth.checks.find((item) => item.id === "build_state_schema").pass = false;
    makeBirthReportFailClosed(falseBirth);
    assert.equal(validateBirthReportArtifact(falseBirth).ok, true);
    await rejectsSourceForgery(() => loadCandidate(
      "birth-report",
      falseBirth,
      birthCompanions(withDomain),
    ));

    const trueBirth = clone(failing.birthReport);
    for (const item of trueBirth.checks) item.pass = true;
    makeBirthReportReady(trueBirth);
    assert.equal(validateBirthReportArtifact(trueBirth).ok, true);
    await rejectsSourceForgery(() => loadCandidate(
      "birth-report",
      trueBirth,
      birthCompanions(failing),
    ));

    const falseDelivery = clone(withDomain.deliveryReport);
    falseDelivery.checks.find((item) => item.id === "build_state_valid").pass = false;
    makeDeliveryReportFailClosed(falseDelivery);
    assert.equal(validateDeliveryReportArtifact(falseDelivery).ok, true);
    await rejectsSourceForgery(() => loadCandidate(
      "delivery-report",
      falseDelivery,
      deliveryCompanions(withDomain),
    ));

    const trueDelivery = clone(failing.deliveryReport);
    for (const item of trueDelivery.checks) item.pass = true;
    trueDelivery.ok = true;
    trueDelivery.nextActions = ["Collect isolated live evidence independently; bounded domain evidence does not imply live success."];
    assert.equal(validateDeliveryReportArtifact(trueDelivery).ok, true);
    await rejectsSourceForgery(() => loadCandidate(
      "delivery-report",
      trueDelivery,
      deliveryCompanions(failing),
    ));
  });

  async function rejectEveryFalseCheck(subject, baseline, companions, finalize) {
    for (let index = 0; index < baseline.checks.length; index += 1) {
      const report = clone(baseline);
      report.checks[index].pass = false;
      finalize(report);
      await rejectsSourceForgery(() => loadCandidate(subject, report, companions));
    }
  }
});

async function buildFailingEvidenceChain() {
  const baseline = await buildAdmittedEvidence({
    runId: "derived-admission-failing-base",
  });
  const runState = clone(baseline.runState);
  runState.runtimeIdentity.sandboxScope.usesProductionState = true;
  const runStateFixture = await admitJsonValue(
    "run-state",
    runState,
    "derived-admission-production-state",
  );
  const runEval = await buildRunEvalVerified(runStateFixture.admission.value, {
    admission: runStateFixture.admission,
    expectStatus: "declared",
  });
  assert.equal(runEval.ok, false);
  const runEvalFixture = await admitJsonValue(
    "run-eval",
    runEval,
    "derived-admission-failing-run-eval",
    { companions: { "run-state": runStateFixture.admission } },
  );
  const birthReport = await buildBirthReport(baseline.blueprint, {
    buildState: baseline.buildState,
    runState: runStateFixture.admission.value,
    runEval: runEvalFixture.admission.value,
    expectStatus: "declared",
    admissions: {
      blueprint: baseline.blueprintAdmission,
      buildState: baseline.buildStateAdmission,
      runState: runStateFixture.admission,
      runEval: runEvalFixture.admission,
    },
  });
  assert.equal(birthReport.ok, false);
  const birthReportFixture = await admitJsonValue(
    "birth-report",
    birthReport,
    "derived-admission-failing-birth",
    { companions: {
      blueprint: baseline.blueprintAdmission,
      "build-state": baseline.buildStateAdmission,
      "run-state": runStateFixture.admission,
      "run-eval": runEvalFixture.admission,
    } },
  );
  const deliveryReport = await buildDeliveryReport(baseline.blueprint, {
    buildState: baseline.buildState,
    runState: runStateFixture.admission.value,
    runEval: runEvalFixture.admission.value,
    birthReport: birthReportFixture.admission.value,
    domainEval: baseline.domainEval,
    admissions: {
      blueprint: baseline.blueprintAdmission,
      buildState: baseline.buildStateAdmission,
      runState: runStateFixture.admission,
      runEval: runEvalFixture.admission,
      birthReport: birthReportFixture.admission,
      domainEval: baseline.domainEvalAdmission,
    },
  });
  assert.equal(deliveryReport.ok, false);
  const deliveryReportFixture = await admitJsonValue(
    "delivery-report",
    deliveryReport,
    "derived-admission-failing-delivery",
    { companions: {
      blueprint: baseline.blueprintAdmission,
      "build-state": baseline.buildStateAdmission,
      "run-state": runStateFixture.admission,
      "run-eval": runEvalFixture.admission,
      "birth-report": birthReportFixture.admission,
      "domain-eval": baseline.domainEvalAdmission,
    } },
  );
  return {
    ...baseline,
    runState: runStateFixture.admission.value,
    runStateAdmission: runStateFixture.admission,
    runEval: runEvalFixture.admission.value,
    runEvalAdmission: runEvalFixture.admission,
    birthReport: birthReportFixture.admission.value,
    birthReportAdmission: birthReportFixture.admission,
    deliveryReport: deliveryReportFixture.admission.value,
    deliveryReportAdmission: deliveryReportFixture.admission,
  };
}

function runEvalCompanions(evidence) {
  return { "run-state": evidence.runStateAdmission };
}

function birthCompanions(evidence) {
  return {
    blueprint: evidence.blueprintAdmission,
    "build-state": evidence.buildStateAdmission,
    "run-state": evidence.runStateAdmission,
    "run-eval": evidence.runEvalAdmission,
  };
}

function deliveryCompanions(evidence) {
  return {
    ...birthCompanions(evidence),
    "birth-report": evidence.birthReportAdmission,
    ...(evidence.domainEvalAdmission ? { "domain-eval": evidence.domainEvalAdmission } : {}),
  };
}

function makeBirthReportFailClosed(report) {
  report.ok = false;
  report.artifactValid = false;
  report.birthReady = false;
  report.birthStatus = "blocked";
  report.evidenceLevels.declaredReady = false;
  report.evidenceLevels.liveSuccess = false;
  report.nextActions = ["Repair the independently failed evidence checks before rebuilding birth-report."];
}

function makeBirthReportReady(report) {
  report.ok = true;
  report.artifactValid = true;
  report.birthReady = true;
  report.birthStatus = report.evidenceLevel === "live-success" ? "born" : "declared-ready";
  report.evidenceLevels.declaredReady = report.evidenceLevel === "declared";
  report.evidenceLevels.liveSuccess = report.evidenceLevel === "live-success";
  report.nextActions = report.evidenceLevel === "declared"
    ? ["Collect isolated live evidence separately; declared readiness does not imply live success."]
    : ["Evaluate bounded domain quality separately; live success does not imply domain, delivery, or production approval."];
}

function makeDeliveryReportFailClosed(report) {
  report.ok = false;
  report.nextActions = ["Repair invalid or mismatched source evidence before rebuilding delivery-report."];
}

async function rejectsSourceForgery(operation) {
  await assert.rejects(
    operation,
    (error) => error?.code === "AGENTMO_UNSUPPORTED_ARTIFACT",
  );
}
