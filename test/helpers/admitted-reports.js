import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { digestRawBytes, loadAdmittedArtifact } from "../../src/artifact-admission.js";
import { buildBirthReport } from "../../src/birth-report.js";
import { BUILD_STATE_FILENAME } from "../../src/build-state.js";
import { buildDeliveryReport } from "../../src/delivery-report.js";
import { buildDomainEval, loadDomainCases } from "../../src/domain-eval.js";
import { buildRuntimePlan } from "../../src/runtime-plan.js";
import { buildRunEvalVerified, executeRuntimeRun } from "../../src/run-state.js";
import { scaffoldAgent } from "../../src/scaffold.js";
import { admitBlueprint } from "./admitted-blueprint.js";

const SUPPORT_BLUEPRINT = new URL("../../examples/support-triage.agentmo.json", import.meta.url);
const DOMAIN_CASES = new URL("../../examples/support-triage.domain-cases.json", import.meta.url);

export async function admitJsonValue(subject, value, prefix = subject, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), `agentmo-${prefix}-`));
  const file = path.join(root, `${subject}.json`);
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  await writeFile(file, bytes);
  const admission = await loadAdmittedArtifact({
    filePath: file,
    subject,
    expectedDigest: digestRawBytes(bytes),
    ...(options.companions ? { companions: options.companions } : {}),
  });
  return { admission, bytes, file };
}

export async function loadAdmittedJsonFile(subject, file) {
  const bytes = await readFile(file);
  const admission = await loadAdmittedArtifact({
    filePath: file,
    subject,
    expectedDigest: digestRawBytes(bytes),
  });
  return { admission, bytes, file };
}

export async function buildAdmittedEvidence(options = {}) {
  const blueprintAdmission = options.blueprintAdmission ?? await admitBlueprint(options.blueprintUrl ?? SUPPORT_BLUEPRINT);
  const blueprint = blueprintAdmission.value;
  const target = options.target ?? "openclaw";
  const runId = options.runId ?? "report-evidence-run";
  const expectStatus = options.expectStatus ?? (options.live ? "success" : "declared");
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-report-evidence-"));
  const scaffoldRoot = path.join(root, "scaffold");
  const workspace = path.join(root, "workspace");
  const stateDir = path.join(root, "state");

  await scaffoldAgent(blueprint, scaffoldRoot, {
    admission: blueprintAdmission,
    target,
  });
  const buildStateFixture = await loadAdmittedJsonFile(
    "build-state",
    path.join(scaffoldRoot, BUILD_STATE_FILENAME),
  );

  const runtimePlan = await buildRuntimePlan(blueprint, {
    admission: blueprintAdmission,
    target,
    workspace,
    openClawStateDir: stateDir,
    message: options.message ?? "bounded report evidence message",
  });
  const runtimePlanFixture = await admitJsonValue("runtime-plan", runtimePlan, "report-runtime-plan");
  const run = await executeRuntimeRun(
    runtimePlanFixture.admission.value,
    {
      admission: runtimePlanFixture.admission,
      target,
      workspace,
      openClawStateDir: stateDir,
      message: options.message ?? "bounded report evidence message",
      live: options.live === true,
      runId,
      now: options.now ?? "2026-07-12T00:00:00.000Z",
    },
    options.runner ?? null,
  );
  const runStateFixture = await admitJsonValue("run-state", run.runState, "report-run-state");
  const runEval = await buildRunEvalVerified(runStateFixture.admission.value, {
    admission: runStateFixture.admission,
    expectStatus,
  });
  const runEvalFixture = await admitJsonValue("run-eval", runEval, "report-run-eval", {
    companions: { "run-state": runStateFixture.admission },
  });
  const birthReport = await buildBirthReport(blueprint, {
    buildState: buildStateFixture.admission.value,
    runState: runStateFixture.admission.value,
    runEval: runEvalFixture.admission.value,
    expectStatus,
    admissions: {
      blueprint: blueprintAdmission,
      buildState: buildStateFixture.admission,
      runState: runStateFixture.admission,
      runEval: runEvalFixture.admission,
    },
  });
  const birthReportFixture = await admitJsonValue("birth-report", birthReport, "report-birth", {
    companions: {
      blueprint: blueprintAdmission,
      "build-state": buildStateFixture.admission,
      "run-state": runStateFixture.admission,
      "run-eval": runEvalFixture.admission,
    },
  });

  let domainCasesAdmission = null;
  let domainEval = null;
  let domainEvalFixture = null;
  if (options.includeDomainEval !== false) {
    const domainCaseBytes = await readFile(options.domainCasesUrl ?? DOMAIN_CASES);
    domainCasesAdmission = await loadDomainCases(options.domainCasesUrl ?? DOMAIN_CASES, {
      subject: "domain-cases",
      expectedDigest: digestRawBytes(domainCaseBytes),
      returnAdmission: true,
    });
    domainEval = await buildDomainEval(blueprint, domainCasesAdmission.value, {
      target,
      admissions: {
        blueprint: blueprintAdmission,
        domainCases: domainCasesAdmission,
      },
    });
    domainEvalFixture = await admitJsonValue("domain-eval", domainEval, "report-domain-eval");
  }

  return {
    root,
    blueprint,
    blueprintAdmission,
    buildState: buildStateFixture.admission.value,
    buildStateAdmission: buildStateFixture.admission,
    runState: runStateFixture.admission.value,
    runStateAdmission: runStateFixture.admission,
    runEval: runEvalFixture.admission.value,
    runEvalAdmission: runEvalFixture.admission,
    birthReport: birthReportFixture.admission.value,
    birthReportAdmission: birthReportFixture.admission,
    domainCases: domainCasesAdmission?.value ?? null,
    domainCasesAdmission,
    domainEval: domainEvalFixture?.admission.value ?? null,
    domainEvalAdmission: domainEvalFixture?.admission ?? null,
  };
}

export async function buildAdmittedDelivery(options = {}) {
  const evidence = options.evidence ?? await buildAdmittedEvidence(options);
  const includeDomainEval = options.includeDomainEval !== false && evidence.domainEval !== null;
  const deliveryReport = await buildDeliveryReport(evidence.blueprint, {
    buildState: evidence.buildState,
    runState: evidence.runState,
    runEval: evidence.runEval,
    birthReport: evidence.birthReport,
    domainEval: includeDomainEval ? evidence.domainEval : null,
    admissions: {
      blueprint: evidence.blueprintAdmission,
      buildState: evidence.buildStateAdmission,
      runState: evidence.runStateAdmission,
      runEval: evidence.runEvalAdmission,
      birthReport: evidence.birthReportAdmission,
      domainEval: includeDomainEval ? evidence.domainEvalAdmission : null,
    },
  });
  const companions = {
    blueprint: evidence.blueprintAdmission,
    "build-state": evidence.buildStateAdmission,
    "run-state": evidence.runStateAdmission,
    "run-eval": evidence.runEvalAdmission,
    "birth-report": evidence.birthReportAdmission,
    ...(includeDomainEval ? { "domain-eval": evidence.domainEvalAdmission } : {}),
  };
  const deliveryReportFixture = await admitJsonValue(
    "delivery-report",
    deliveryReport,
    "report-delivery",
    { companions },
  );
  return {
    ...evidence,
    deliveryReport: deliveryReportFixture.admission.value,
    deliveryReportAdmission: deliveryReportFixture.admission,
  };
}
