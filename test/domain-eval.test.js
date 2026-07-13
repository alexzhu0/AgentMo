import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { digestRawBytes, loadAdmittedArtifact } from "../src/artifact-admission.js";
import {
  buildDomainEval,
  DOMAIN_CASES_SCHEMA_VERSION,
  DOMAIN_EVAL_SCHEMA_VERSION,
  loadDomainCases,
  validateDomainCasesArtifact,
  validateDomainEvalArtifact,
} from "../src/domain-eval.js";
import { assertPersistable } from "../src/persistability.js";
import { admitBlueprint } from "./helpers/admitted-blueprint.js";

const BLUEPRINT = new URL("../examples/support-triage.agentmo.json", import.meta.url);
const DOMAIN_CASES = new URL("../examples/support-triage.domain-cases.json", import.meta.url);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function checkById(report, id) {
  return report.checks.find((item) => item.id === id);
}

async function admitFixtureCases() {
  const bytes = await readFile(DOMAIN_CASES);
  return loadDomainCases(DOMAIN_CASES, {
    subject: "domain-cases",
    expectedDigest: digestRawBytes(bytes),
    returnAdmission: true,
  });
}

async function admitCasesValue(value, label = "domain-cases") {
  const root = await mkdtemp(path.join(tmpdir(), `agentmo-${label}-`));
  const file = path.join(root, "domain-cases.json");
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  await writeFile(file, bytes);
  const admission = await loadDomainCases(file, {
    subject: "domain-cases",
    expectedDigest: digestRawBytes(bytes),
    returnAdmission: true,
  });
  return { admission, bytes, file };
}

async function buildFixtureReport(options = {}) {
  const blueprint = await admitBlueprint(BLUEPRINT);
  const domainCases = options.domainCasesAdmission ?? await admitFixtureCases();
  const report = await buildDomainEval(blueprint.value, domainCases.value, {
    target: options.target ?? "openclaw",
    admissions: {
      blueprint,
      domainCases,
    },
  });
  return { blueprint, domainCases, report };
}

describe("domain eval", () => {
  it("builds a persistable exact report with independent evidence levels", async () => {
    const { blueprint, domainCases, report } = await buildFixtureReport();

    assert.equal(report.schemaVersion, DOMAIN_EVAL_SCHEMA_VERSION);
    assert.equal(report.ok, true);
    assert.equal(validateDomainEvalArtifact(report).ok, true);
    assert.doesNotThrow(() => assertPersistable(report, { subject: "domain-eval" }));
    assert.deepEqual(report.sources, {
      blueprint: {
        identity: blueprint.identity,
        subject: blueprint.subject,
        digest: blueprint.digest,
      },
      domainCases: {
        identity: domainCases.identity,
        subject: domainCases.subject,
        digest: domainCases.digest,
      },
    });
    assert.equal(report.domainCertifiedByDomainEval, true);
    assert.equal(report.runtimeCertifiedByDomainEval, false);
    assert.equal(report.deliveryReadyByDomainEval, false);
    assert.equal(report.productionApprovedByDomainEval, false);
    assert.deepEqual(report.missingCaseClasses, []);
    assert.equal(report.caseResults.every((result) => result.evidenceRefCount === result.evidenceRefs.length), true);
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
    for (const forbiddenKey of ["blueprintPath", "casesPath", "prompt", "transcript", "toolOutput", "inputSummary", "outputSummary"]) {
      assert.equal(hasKey(report, forbiddenKey), false, forbiddenKey);
    }
  });

  it("loads only exact domain-cases bytes and rejects mutation, family swap, or unknown identity", async () => {
    const originalBytes = await readFile(DOMAIN_CASES);
    const original = JSON.parse(originalBytes.toString("utf8"));
    assert.equal(validateDomainCasesArtifact(original).ok, true);
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-domain-cases-admission-"));
    const file = path.join(root, "domain-cases.json");
    await writeFile(file, originalBytes);

    const admission = await loadDomainCases(file, {
      subject: "domain-cases",
      expectedDigest: digestRawBytes(originalBytes),
      returnAdmission: true,
    });
    assert.equal(admission.identity, DOMAIN_CASES_SCHEMA_VERSION);
    assert.equal(admission.subject, "domain-cases");

    await writeFile(file, Buffer.concat([originalBytes, Buffer.from(" ")]));
    await assert.rejects(
      () => loadDomainCases(file, {
        subject: "domain-cases",
        expectedDigest: admission.digest,
      }),
      (error) => error?.code === "AGENTMO_ARTIFACT_DIGEST_MISMATCH",
    );

    await writeFile(file, originalBytes);
    await assert.rejects(
      () => loadAdmittedArtifact({
        filePath: file,
        subject: "runtime-plan",
        expectedDigest: admission.digest,
      }),
      (error) => error?.code === "AGENTMO_UNSUPPORTED_ARTIFACT",
    );

    const unknownBytes = Buffer.from(`${JSON.stringify({ ...original, schemaVersion: "agentmo.domain-cases.unknown" }, null, 2)}\n`);
    await writeFile(file, unknownBytes);
    await assert.rejects(
      () => loadDomainCases(file, {
        subject: "domain-cases",
        expectedDigest: digestRawBytes(unknownBytes),
      }),
      (error) => error?.code === "AGENTMO_UNSUPPORTED_ARTIFACT",
    );
  });

  it("fails closed when a required case class is missing", async () => {
    const source = clone((await admitFixtureCases()).value);
    source.cases = source.cases.filter((domainCase) => domainCase.caseClass !== "draft-evidence-backed-customer-reply");
    const { admission } = await admitCasesValue(source, "domain-cases-missing-class");
    const { report } = await buildFixtureReport({ domainCasesAdmission: admission });

    assert.equal(report.ok, false);
    assert.deepEqual(report.missingCaseClasses, ["draft-evidence-backed-customer-reply"]);
    assert.equal(checkById(report, "required_case_classes_covered").pass, false);
    assert.equal(checkById(report, "case_thresholds_pass").pass, false);
    assert.equal(report.domainCertifiedByDomainEval, false);
    assert.equal(report.runtimeCertifiedByDomainEval, false);
    assert.equal(report.deliveryReadyByDomainEval, false);
    assert.equal(report.productionApprovedByDomainEval, false);
  });

  it("fails closed when a case records a hard-failure id", async () => {
    const source = clone((await admitFixtureCases()).value);
    source.cases[0].hardFailureIds = ["invent-customer-account-facts"];
    const { admission } = await admitCasesValue(source, "domain-cases-hard-failure");
    const { report } = await buildFixtureReport({ domainCasesAdmission: admission });

    assert.equal(report.ok, false);
    assert.equal(checkById(report, "hard_failures_absent").pass, false);
    assert.equal(checkById(report, "no_hard_failures").pass, false);
    assert.deepEqual(report.caseResults[0].hardFailureIds, ["invent-customer-account-facts"]);
  });

  it("keeps agent and target scope independent and fail-closed", async () => {
    const source = clone((await admitFixtureCases()).value);
    source.agentId = "other-agent";
    source.targetId = "pi";
    const { admission } = await admitCasesValue(source, "domain-cases-scope-mismatch");
    const { report } = await buildFixtureReport({ domainCasesAdmission: admission });

    assert.equal(report.ok, false);
    assert.equal(checkById(report, "agent_id_match").pass, false);
    assert.equal(checkById(report, "target_match").pass, false);
    assert.equal(report.domainCertifiedByDomainEval, false);
    assert.equal(report.runtimeCertifiedByDomainEval, false);
  });

  it("rejects raw or secret-bearing domain-case material before evaluation", async () => {
    const baseline = clone((await admitFixtureCases()).value);
    const unsafeCases = [
      { ...baseline, prompt: "private prompt material" },
      {
        ...baseline,
        cases: baseline.cases.map((domainCase, index) => index === 0
          ? { ...domainCase, evidenceRefs: ["fact:api_key=domain-secret-123456"] }
          : domainCase),
      },
    ];

    for (const [index, candidate] of unsafeCases.entries()) {
      const root = await mkdtemp(path.join(tmpdir(), `agentmo-domain-cases-unsafe-${index}-`));
      const file = path.join(root, "domain-cases.json");
      const bytes = Buffer.from(`${JSON.stringify(candidate, null, 2)}\n`);
      await writeFile(file, bytes);
      await assert.rejects(
        () => loadDomainCases(file, {
          subject: "domain-cases",
          expectedDigest: digestRawBytes(bytes),
        }),
        (error) => error?.code === "AGENTMO_ARTIFACT_UNSAFE_CONTENT" || error?.code === "AGENTMO_UNSUPPORTED_ARTIFACT",
      );
    }
  });

  it("requires authentic admission objects and rejects unsafe report extensions", async () => {
    const blueprint = await admitBlueprint(BLUEPRINT);
    const domainCases = await admitFixtureCases();
    await assert.rejects(
      () => buildDomainEval(blueprint.value, domainCases.value, {
        target: "openclaw",
        admissions: { blueprint, domainCases: Object.freeze({ ...domainCases }) },
      }),
      (error) => error?.code === "AGENTMO_ARTIFACT_ADMISSION_RESULT_INVALID",
    );

    const { report } = await buildFixtureReport();
    const extended = { ...clone(report), hostPath: "/private/domain-eval-canary" };
    assert.equal(validateDomainEvalArtifact(extended).ok, false);
    const forgedBoundary = clone(report);
    forgedBoundary.runtimeCertifiedByDomainEval = true;
    assert.equal(validateDomainEvalArtifact(forgedBoundary).ok, false);
  });

  it("rejects non-canonical checks and contradictory derived coverage", async () => {
    const { report } = await buildFixtureReport();
    const checkMutations = [];

    const empty = clone(report);
    empty.checks = [];
    checkMutations.push(empty);
    const missing = clone(report);
    missing.checks.splice(2, 1);
    checkMutations.push(missing);
    const duplicate = clone(report);
    duplicate.checks[2] = clone(duplicate.checks[1]);
    checkMutations.push(duplicate);
    const extra = clone(report);
    extra.checks.push({ id: "unexpected_check", pass: true });
    checkMutations.push(extra);
    const renamed = clone(report);
    renamed.checks[3].id = "agent_scope_match";
    checkMutations.push(renamed);
    const reordered = clone(report);
    [reordered.checks[0], reordered.checks[1]] = [reordered.checks[1], reordered.checks[0]];
    checkMutations.push(reordered);
    const outcomeForged = clone(report);
    outcomeForged.checks.find((item) => item.id === "case_thresholds_pass").pass = false;
    outcomeForged.ok = false;
    outcomeForged.domainCertifiedByDomainEval = false;
    outcomeForged.certificationBoundary.domainCertifiedByDomainEval = false;
    checkMutations.push(outcomeForged);

    for (const candidate of checkMutations) {
      assert.equal(validateDomainEvalArtifact(candidate).ok, false);
    }

    const contradictory = clone(report);
    assert.equal(contradictory.requiredCaseClasses.length, 3);
    contradictory.coveredCaseClasses = [];
    contradictory.missingCaseClasses = [];
    for (const result of contradictory.caseResults) result.required = false;
    contradictory.ok = true;
    contradictory.domainCertifiedByDomainEval = true;
    contradictory.certificationBoundary.domainCertifiedByDomainEval = true;
    for (const item of contradictory.checks) item.pass = true;

    const validation = validateDomainEvalArtifact(contradictory);
    assert.equal(validation.ok, false);
    assert.equal(validation.errors.includes("domain_eval_coverage_invalid"), true);
    assert.equal(validation.errors.includes("domain_eval_required_flags_invalid"), true);
  });
});

function hasKey(value, key) {
  if (!value || typeof value !== "object") return false;
  if (Object.hasOwn(value, key)) return true;
  return Object.values(value).some((child) => hasKey(child, key));
}
