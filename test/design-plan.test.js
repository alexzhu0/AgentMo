import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { access, mkdtemp, open, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadAdmittedArtifact } from "../src/artifact-admission.js";
import { subjectsForCommand } from "../src/artifact-subjects.js";
import { buildDesignPlan, loadDesignPlan, validateDesignPlan, writeDesignPlan } from "../src/design-plan.js";
import { buildDiscoveryApproval, buildDiscoveryApprovalPreview } from "../src/discovery-approval.js";
import { loadDiscoveryDb } from "../src/discovery-db.js";
import { appendDecisionEntry, loadDecisionLedger } from "../src/decision-ledger.js";
import { loadUserNeed } from "../src/user-need.js";

const CLI = fileURLToPath(new URL("../bin/agentmo.js", import.meta.url));
const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DISCOVERY_DB_FILE = fileURLToPath(new URL("../examples/fixtures/support-triage/prebuilt-discovery-db.json", import.meta.url));
const DISCOVERY_MANIFEST_FILE = fileURLToPath(new URL("../examples/support-triage.discovery.json", import.meta.url));
const USER_NEED_FILE = fileURLToPath(new URL("../examples/support-triage.need.json", import.meta.url));

async function loadJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

async function supportInputs() {
  const discoveryManifestAdmission = await admitFile(DISCOVERY_MANIFEST_FILE, "discovery-manifest");
  const discoveryDbAdmission = await admitFile(DISCOVERY_DB_FILE, "discovery-db");
  const userNeedAdmission = await admitFile(USER_NEED_FILE, "user-need");
  return approveInputs({
    manifest: discoveryManifestAdmission.value,
    discoveryDb: discoveryDbAdmission.value,
    need: userNeedAdmission.value,
    admissions: {
      discoveryManifest: discoveryManifestAdmission,
      discoveryDb: discoveryDbAdmission,
      userNeed: userNeedAdmission,
    },
  });
}

async function admitFile(file, subject) {
  const bytes = await readFile(file);
  return loadAdmittedArtifact({ filePath: file, subject, expectedDigest: digest(bytes) });
}

async function admitValue(value, subject, companions) {
  const root = await mkdtemp(path.join(tmpdir(), `agentmo-${subject}-admit-`));
  const file = path.join(root, `${subject}.json`);
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  await writeFile(file, bytes);
  return loadAdmittedArtifact({
    filePath: file,
    subject,
    expectedDigest: digest(bytes),
    ...(companions ? { companions } : {}),
  });
}

async function approveInputs(inputs) {
  const approvalOptions = {
    admissions: {
      discoveryManifest: inputs.admissions.discoveryManifest,
      discoveryDb: inputs.admissions.discoveryDb,
    },
  };
  const preview = buildDiscoveryApprovalPreview(inputs.manifest, inputs.discoveryDb, approvalOptions);
  const approval = buildDiscoveryApproval(inputs.manifest, inputs.discoveryDb, {
    ...approvalOptions,
    approve: true,
    previewDigest: preview.previewDigest,
  });
  const discoveryApprovalAdmission = await admitValue(
    approval,
    "discovery-approval",
    {
      "discovery-manifest": inputs.admissions.discoveryManifest,
      "discovery-db": inputs.admissions.discoveryDb,
    },
  );
  const decisionLedger = inputs.decisionLedger ?? await buildDecisionLedger(inputs.need);
  return {
    ...inputs,
    discoveryApproval: discoveryApprovalAdmission.value,
    decisionLedger,
    admissions: {
      ...inputs.admissions,
      discoveryApproval: discoveryApprovalAdmission,
      decisionLedger,
    },
  };
}

function planOptions(inputs, extra = {}) {
  return {
    target: "openclaw",
    manifest: inputs.manifest ?? inputs.admissions.discoveryManifest.value,
    discoveryApproval: inputs.discoveryApproval ?? inputs.admissions.discoveryApproval.value,
    decisionLedger: inputs.decisionLedger ?? inputs.admissions.decisionLedger,
    admissions: inputs.admissions,
    ...extra,
  };
}

async function buildDecisionLedger(need) {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-design-decision-ledger-"));
  const journalPath = path.join(root, "decision-ledger.json");
  return buildDecisionLedgerAt(need, journalPath);
}

async function buildDecisionLedgerAt(need, journalPath) {
  const requirementRefs = [
    ...need.primary_tasks.map((_, index) => `primary-task-${String(index + 1).padStart(2, "0")}`),
    ...need.success_criteria.map((_, index) => `success-criterion-${String(index + 1).padStart(2, "0")}`),
    ...need.hard_failures.map((_, index) => `hard-failure-${String(index + 1).padStart(2, "0")}`),
  ].sort();
  const appended = await appendDecisionEntry({
    journalPath,
    entry: {
      entryId: "human-decision-01",
      entryKind: "human-decision",
      subject: "Bounded Stage 2 planning scope",
      reason: "Proceed with governed gaps and preserve draft status.",
      sourceRefs: [],
      decisionRefs: [],
      requirementRefs,
    },
  });
  return loadDecisionLedger({
    journalPath,
    expectedHeadDigest: appended.head.digest,
  });
}

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

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

function assertNoSensitiveOutput(value, label, tempRoot = null, pointer = "$") {
  if (typeof value === "string") {
    assert.equal(value.includes(REPO_ROOT), false, `${label} ${pointer} leaked repo root`);
    assert.equal(value.includes("/home/"), false, `${label} ${pointer} leaked home path`);
    if (tempRoot) assert.equal(value.includes(tempRoot), false, `${label} ${pointer} leaked temp root`);
    assert.equal(value.includes(".env"), false, `${label} ${pointer} leaked denied env ref`);
    assert.equal(/\bsk-[A-Za-z0-9_-]{12,}\b|api[_-]?key\s*=|Bearer\s+[A-Za-z0-9._~+/-]+/u.test(value), false, `${label} ${pointer} leaked concrete secret marker: ${value}`);
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) assertNoSensitiveOutput(item, label, tempRoot, `${pointer}[${index}]`);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) assertNoSensitiveOutput(item, label, tempRoot, `${pointer}.${key}`);
  }
}

async function stage2CandidateCliFixture(label) {
  const inputs = await supportInputs();
  const root = await mkdtemp(path.join(tmpdir(), `agentmo-candidate-stage2-${label}-`));
  const approvalPath = path.join(root, "authentic-discovery-approval.json");
  const approvalBytes = Buffer.from(`${JSON.stringify(inputs.discoveryApproval, null, 2)}\n`, "utf8");
  await writeFile(approvalPath, approvalBytes);
  const decisionLedgerPath = path.join(root, "authentic-decision-ledger.json");
  const decisionLedger = await buildDecisionLedgerAt(inputs.need, decisionLedgerPath);
  const candidate = {
    schemaVersion: "agentmo.agent-idea-candidate.v1",
    ideaId: "candidate-stage-2-loader-boundary",
    title: "A bounded proposal for human review",
    targetUsers: ["A prospective user group"],
    candidateTasks: ["Review one bounded workflow opportunity"],
    valueHypothesis: "The proposed workflow may reduce one measurable coordination burden.",
    source: {
      discoveryDb: {
        identity: "agentmo.discovery-db.v1",
        subject: "discovery-db",
        digest: inputs.admissions.discoveryDb.digest,
      },
    },
    evidenceIds: [inputs.discoveryDb.facts[0].id],
    evidenceGaps: ["Human confirmation of the target user's actual need remains missing."],
    judgmentBoundaries: ["This proposal does not prove value or authorize planning."],
    certificationBoundary: {
      proposalOnly: true,
      userNeedProven: false,
      valueProven: false,
      agentCapabilityProven: false,
      domainQualityProven: false,
      planReady: false,
      productionReady: false,
      enterPlanAuthorized: false,
      buildAuthorized: false,
      runtimeAuthorized: false,
    },
  };
  const candidatePath = path.join(root, "candidate.json");
  const candidateBytes = Buffer.from(`${JSON.stringify(candidate, null, 2)}\n`, "utf8");
  await writeFile(candidatePath, candidateBytes);
  return {
    root,
    candidatePath,
    candidateDigest: digest(candidateBytes),
    approvalPath,
    approvalDigest: digest(approvalBytes),
    decisionLedgerPath,
    decisionLedgerDigest: decisionLedger.head.digest,
    admissions: inputs.admissions,
  };
}

function stage2DesignPlanArgs(fixture, outPath) {
  return [
    "design-plan", DISCOVERY_DB_FILE,
    "--manifest", DISCOVERY_MANIFEST_FILE,
    "--discovery-approval", fixture.approvalPath,
    "--need", USER_NEED_FILE,
    "--decision-ledger", fixture.decisionLedgerPath,
    "--out", outPath,
    "--target", "openclaw",
    "--digest", `discovery-manifest=${fixture.admissions.discoveryManifest.digest}`,
    "--digest", `discovery-db=${fixture.admissions.discoveryDb.digest}`,
    "--digest", `discovery-approval=${fixture.approvalDigest}`,
    "--digest", `user-need=${fixture.admissions.userNeed.digest}`,
    "--digest", `decision-ledger=${fixture.decisionLedgerDigest}`,
  ];
}

describe("design plan", () => {
  it("does not accept an Agent Idea Candidate through direct Stage 2 authority APIs", async () => {
    const inputs = await supportInputs();
    const factId = inputs.discoveryDb.facts[0].id;
    const candidate = {
      schemaVersion: "agentmo.agent-idea-candidate.v1",
      ideaId: "candidate-stage-2-boundary",
      title: "A bounded proposal for human review",
      targetUsers: ["A prospective user group"],
      candidateTasks: ["Review one bounded workflow opportunity"],
      valueHypothesis: "The proposed workflow may reduce one measurable coordination burden.",
      source: {
        discoveryDb: {
          identity: "agentmo.discovery-db.v1",
          subject: "discovery-db",
          digest: inputs.admissions.discoveryDb.digest,
        },
      },
      evidenceIds: [factId],
      evidenceGaps: ["Human confirmation of the target user's actual need remains missing."],
      judgmentBoundaries: ["This proposal does not prove value or authorize planning."],
      certificationBoundary: {
        proposalOnly: true,
        userNeedProven: false,
        valueProven: false,
        agentCapabilityProven: false,
        domainQualityProven: false,
        planReady: false,
        productionReady: false,
        enterPlanAuthorized: false,
        buildAuthorized: false,
        runtimeAuthorized: false,
      },
    };
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-candidate-stage2-boundary-"));
    const candidatePath = path.join(root, "candidate.json");
    const candidateBytes = Buffer.from(`${JSON.stringify(candidate, null, 2)}\n`, "utf8");
    await writeFile(candidatePath, candidateBytes);
    const candidateDigest = digest(candidateBytes);

    await assert.rejects(
      loadUserNeed(candidatePath, { subject: "user-need", expectedDigest: candidateDigest }),
      (error) => error?.code === "AGENTMO_UNSUPPORTED_ARTIFACT",
    );
    await assert.rejects(
      loadAdmittedArtifact({
        filePath: candidatePath,
        subject: "discovery-approval",
        expectedDigest: candidateDigest,
        companions: {
          "discovery-manifest": inputs.admissions.discoveryManifest,
          "discovery-db": inputs.admissions.discoveryDb,
        },
      }),
      (error) => error?.code === "AGENTMO_UNSUPPORTED_ARTIFACT",
    );
    assert.throws(
      () => buildDesignPlan(inputs.discoveryDb, candidate, planOptions(inputs)),
      /user-need/i,
    );
    assert.equal(subjectsForCommand("design-plan").includes("agent-idea-candidate"), false);
  });

  it("keeps an independent unknown-subject rejection for an extra Candidate digest", async () => {
    const fixture = await stage2CandidateCliFixture("extra-digest");
    const outPath = path.join(fixture.root, "must-remain-absent.json");
    const cli = await runCli([
      ...stage2DesignPlanArgs(fixture, outPath),
      "--digest", `agent-idea-candidate=${fixture.candidateDigest}`,
      "--json",
    ]);
    assert.equal(cli.code, 1);
    assert.equal(JSON.parse(cli.stdout).code, "AGENTMO_ARTIFACT_DIGEST_UNKNOWN_SUBJECT");
    await assert.rejects(() => access(outPath));
  });

  it("reaches each real Stage 2 loader before rejecting Candidate substitution", async () => {
    const fixture = await stage2CandidateCliFixture("loader-substitution");
    const cases = [
      {
        label: "user-need",
        option: "--need",
        digestSubject: "user-need",
        code: "AGENTMO_UNSUPPORTED_ARTIFACT",
      },
      {
        label: "discovery-approval",
        option: "--discovery-approval",
        digestSubject: "discovery-approval",
        code: "AGENTMO_UNSUPPORTED_ARTIFACT",
      },
      {
        label: "decision-ledger-current-head",
        option: "--decision-ledger",
        digestSubject: "decision-ledger",
        code: "AGENTMO_DECISION_LEDGER_LINEAGE_INVALID",
      },
    ];
    for (const testCase of cases) {
      const outPath = path.join(fixture.root, `${testCase.label}-must-remain-absent.json`);
      const args = stage2DesignPlanArgs(fixture, outPath);
      const optionIndex = args.indexOf(testCase.option);
      assert.notEqual(optionIndex, -1, testCase.label);
      args[optionIndex + 1] = fixture.candidatePath;
      const subjectBindingIndex = args.findIndex(
        (value) => value.startsWith(`${testCase.digestSubject}=`),
      );
      assert.notEqual(subjectBindingIndex, -1, testCase.label);
      args[subjectBindingIndex] = `${testCase.digestSubject}=${fixture.candidateDigest}`;

      const cli = await runCli([...args, "--json"]);
      assert.equal(cli.code, 1, testCase.label);
      assert.equal(JSON.parse(cli.stdout).code, testCase.code, testCase.label);
      await assert.rejects(() => access(outPath), undefined, testCase.label);
    }
  });

  it("builds and validates a first-class Stage 2 design plan from DB plus need", async () => {
    const { discoveryDb, need, admissions } = await supportInputs();
    const plan = buildDesignPlan(discoveryDb, need, planOptions({ admissions }));

    assert.equal(plan.schemaVersion, "agentmo.design-plan.v1");
    assert.equal(plan.ok, true);
    assert.equal(plan.agentId, "support-triage");
    assert.equal(plan.domain, "customer_support_ticket_triage");
    assert.equal(plan.targetRuntime, "openclaw");

    const expectedTraceCount = need.primary_tasks.length + need.success_criteria.length + need.hard_failures.length;
    assert.equal(plan.requirementsTrace.length, expectedTraceCount);
    assert.equal(plan.evidenceMap.length, expectedTraceCount);
    assert.equal(plan.requirementsTrace.every((entry) => ["supported", "partial", "missing"].includes(entry.coverage)), true);
    assert.equal(
      plan.requirementsTrace.some((entry) => entry.coverage === "supported"),
      false,
      "manifest extraction-field declarations must not certify collected evidence",
    );
    assert.equal(plan.gaps.length, expectedTraceCount);
    assert.equal(plan.source.decisionLedger.digest, admissions.decisionLedger.head.digest);
    assert.equal(plan.traceGraph.forwardTraceEdges.length > 0, true);
    assert.deepEqual(
      plan.traceGraph.reverseTraceEdges,
      plan.traceGraph.forwardTraceEdges.map((edge) => ({
        from: edge.to,
        to: edge.from,
        relation: edge.relation,
      })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    );
    for (const trace of plan.requirementsTrace) {
      assert.equal(
        plan.traceGraph.forwardTraceEdges.some(
          (edge) => edge.to === trace.requirementId
            && ["source-supports-requirement", "decision-governs-requirement"].includes(edge.relation),
        ),
        true,
        `${trace.requirementId} must have a source or decision edge`,
      );
    }

    const validation = validateDesignPlan(plan);
    assert.equal(validation.ok, true, validation.errors.join("\n"));

    const oneWay = structuredClone(plan);
    oneWay.traceGraph.reverseTraceEdges.pop();
    const oneWayValidation = validateDesignPlan(oneWay);
    assert.equal(oneWayValidation.ok, false);
    assert.match(oneWayValidation.errors.join("\n"), /reverse edges/i);
  });

  it("requires the exact current decision-ledger head as Plan authority", async () => {
    const inputs = await supportInputs();
    assert.throws(
      () => buildDesignPlan(inputs.discoveryDb, inputs.need, {
        ...planOptions(inputs),
        decisionLedger: undefined,
      }),
      /decision ledger/i,
    );
    const forged = structuredClone(inputs.decisionLedger);
    assert.throws(
      () => buildDesignPlan(inputs.discoveryDb, inputs.need, {
        ...planOptions(inputs),
        decisionLedger: forged,
        admissions: { ...inputs.admissions, decisionLedger: forged },
      }),
      /decision ledger/i,
    );
  });

  it("only marks requirements supported from multiple trusted source chunks", async () => {
    const { discoveryDb, need, admissions } = await supportInputs();
    const evidencedDb = structuredClone(discoveryDb);
    evidencedDb.facts.push(
      {
        id: "ticket-taxonomy:chunk:01",
        sourceId: "ticket-taxonomy",
        kind: "source_chunk",
        text: "Support operations classify every ticket category before choosing its priority.",
        trustLevel: "trusted",
        refs: ["examples/fixtures/support-triage/ticket-taxonomy.json"],
        tags: ["database", "json"],
      },
      {
        id: "support-policy-handbook:chunk:01",
        sourceId: "support-policy-handbook",
        kind: "source_chunk",
        text: "Ticket category and priority determine the required escalation path.",
        trustLevel: "verified",
        refs: ["examples/fixtures/support-triage/policy-handbook.md"],
        tags: ["document", "md"],
      },
    );
    const evidencedAdmission = await admitValue(evidencedDb, "discovery-db");
    const evidencedInputs = await approveInputs({
      manifest: admissions.discoveryManifest.value,
      discoveryDb: evidencedAdmission.value,
      need,
      admissions: { ...admissions, discoveryDb: evidencedAdmission },
    });

    const plan = buildDesignPlan(
      evidencedInputs.discoveryDb,
      need,
      planOptions(evidencedInputs),
    );
    const classification = plan.requirementsTrace.find(
      (entry) => entry.requirementId === "primary-task-01",
    );

    assert.equal(classification.coverage, "supported");
    assert.deepEqual(classification.matchedSourceIds, [
      "support-policy-handbook",
      "ticket-taxonomy",
    ]);
  });

  it("caps unverified source chunks at partial coverage", async () => {
    const { discoveryDb, need, admissions } = await supportInputs();
    const unverifiedDb = structuredClone(discoveryDb);
    unverifiedDb.facts.push(
      {
        id: "ticket-taxonomy:chunk:01",
        sourceId: "ticket-taxonomy",
        kind: "source_chunk",
        text: "Support operations classify every ticket category before choosing its priority.",
        trustLevel: "unverified",
        refs: ["examples/fixtures/support-triage/ticket-taxonomy.json"],
        tags: ["database", "json"],
      },
      {
        id: "support-policy-handbook:chunk:01",
        sourceId: "support-policy-handbook",
        kind: "source_chunk",
        text: "Ticket category and priority determine the required escalation path.",
        trustLevel: "unverified",
        refs: ["examples/fixtures/support-triage/policy-handbook.md"],
        tags: ["document", "md"],
      },
    );
    const unverifiedAdmission = await admitValue(unverifiedDb, "discovery-db");
    const unverifiedInputs = await approveInputs({
      manifest: admissions.discoveryManifest.value,
      discoveryDb: unverifiedAdmission.value,
      need,
      admissions: { ...admissions, discoveryDb: unverifiedAdmission },
    });

    const plan = buildDesignPlan(
      unverifiedInputs.discoveryDb,
      need,
      planOptions(unverifiedInputs),
    );
    const classification = plan.requirementsTrace.find(
      (entry) => entry.requirementId === "primary-task-01",
    );

    assert.equal(classification.coverage, "partial");
    assert.equal(plan.gaps.some((gap) => gap.requirementId === classification.requirementId), true);
  });

  it("maps hard failures into eval and governance gates", async () => {
    const { discoveryDb, need, admissions } = await supportInputs();
    const plan = buildDesignPlan(discoveryDb, need, planOptions({ admissions }));

    const hardFailureTrace = plan.requirementsTrace.filter((entry) => entry.requirementType === "hard_failure");
    assert.equal(hardFailureTrace.length, need.hard_failures.length);
    assert.deepEqual(plan.evalPlan.hardFailures.map((item) => item.requirementText), need.hard_failures);
    assert.equal(plan.governanceGates.some((gate) => gate.id === "fail-closed-hard-failures" && gate.status === "pass"), true);
    assert.equal(plan.governanceGates.some((gate) => gate.id === "missing-evidence-governed"), true);
  });

  it("discloses missing evidence and only stays ok when gaps are governed", async () => {
    const { discoveryDb, need, admissions } = await supportInputs();
    const sparseDb = { ...discoveryDb, facts: discoveryDb.facts.slice(0, 1) };
    const sparseAdmission = await admitValue(sparseDb, "discovery-db");
    const sparseInputs = await approveInputs({
      manifest: admissions.discoveryManifest.value,
      discoveryDb: sparseAdmission.value,
      need,
      admissions: { ...admissions, discoveryDb: sparseAdmission },
    });
    const governed = buildDesignPlan(sparseInputs.discoveryDb, need, planOptions(sparseInputs));

    assert.equal(governed.requirementsTrace.some((entry) => entry.coverage !== "supported"), true);
    assert.equal(governed.gaps.length > 0, true);
    assert.equal(governed.evalPlan.missingEvidenceChecks.length, governed.gaps.length);
    assert.equal(governed.governanceGates.some((gate) => gate.id === "missing-evidence-governed" && gate.status === "pass"), true);
    assert.equal(governed.ok, true);

    const ungoverned = buildDesignPlan(
      sparseInputs.discoveryDb,
      need,
      planOptions(sparseInputs, { governMissingEvidence: false }),
    );
    assert.equal(ungoverned.ok, false);
    assert.equal(ungoverned.validation.ok, false);
    assert.match(ungoverned.validation.errors.join("\n"), /missing evidence/i);
  });

  it("fails closed for invalid need, mismatched agent id, and unsafe DB state", async () => {
    const { discoveryDb, need, admissions } = await supportInputs();

    const invalidNeed = structuredClone(need);
    delete invalidNeed.output_preferences;
    assert.throws(() => buildDesignPlan(discoveryDb, invalidNeed, planOptions({ admissions })), /invalid user need/i);

    const mismatchedNeed = structuredClone(need);
    mismatchedNeed.agent_id = "other-agent";
    assert.throws(() => buildDesignPlan(discoveryDb, mismatchedNeed, planOptions({ admissions })), /does not match user-need/i);

    const unsafeDb = structuredClone(discoveryDb);
    unsafeDb.safety.workspaceOk = false;
    unsafeDb.workspace = { ok: false };
    assert.throws(() => buildDesignPlan(unsafeDb, need, planOptions({ admissions })), /unsafe workspace/i);
  });

  it("does not require Stage 1 sidecars", async () => {
    const { discoveryDb, need, admissions } = await supportInputs();
    const plan = buildDesignPlan(discoveryDb, need, planOptions({ admissions }));
    assert.equal(plan.ok, true);
    assert.equal(plan.discoverySummary.factCount, discoveryDb.facts.length);
  });

  it("validates bounded source refs and rejects unsafe refs", async () => {
    const { discoveryDb, need, admissions } = await supportInputs();

    const allowed = structuredClone(need);
    allowed.source_refs = [
      "support-policy-handbook",
      "support-policy-handbook:field:01",
      "docs/AGENT_BIRTH_GATE.md",
      "https://example.com/support/policy",
    ];
    const allowedAdmission = await admitValue(allowed, "user-need");
    const allowedPlan = buildDesignPlan(discoveryDb, allowedAdmission.value, planOptions({
      admissions: { ...admissions, userNeed: allowedAdmission },
    }));
    assert.deepEqual(allowedPlan.userNeedSummary.sourceRefs, allowed.source_refs);

    const deniedRefs = [
      "/tmp/host-secret.txt",
      "C:\\Users\\alex\\secret.txt",
      "\\\\server\\share\\credential.txt",
      "~/agentmo/notes.md",
      "${HOME}/notes.md",
      "../AgentHarness/README.md",
      ".env",
      "keys/private.pem",
      "https://user:pass@example.com/private",
      "file:///tmp/private.txt",
      "api_key=secret-value-123456",
    ];
    for (const ref of deniedRefs) {
      const denied = structuredClone(need);
      denied.source_refs = [ref];
      assert.throws(
        () => buildDesignPlan(discoveryDb, denied, planOptions({ admissions })),
        /source_refs/i,
        `ref should fail: ${ref}`,
      );
    }
  });

  it("writes bounded reports without host paths or secret-like values", async () => {
    const { discoveryDb, need, admissions } = await supportInputs();
    const tempRoot = await mkdtemp(path.join(tmpdir(), "agentmo-design-plan-"));
    const out = path.join(tempRoot, "agentmo-design-plan.json");
    const plan = buildDesignPlan(discoveryDb, need, planOptions({ admissions }));
    const written = await writeDesignPlan(out, plan);
    assert.equal(written, out);
    const firstBytes = await readFile(out, "utf8");
    const secondOut = path.join(tempRoot, "agentmo-design-plan-copy.json");
    await writeDesignPlan(secondOut, plan);
    assert.equal(await readFile(secondOut, "utf8"), firstBytes);
    const saved = JSON.parse(firstBytes);
    assertNoSensitiveOutput(saved, "design plan", tempRoot);
    assert.deepEqual(Object.keys(saved.source.discoveryDb), ["identity", "subject", "digest"]);
    assert.deepEqual(Object.keys(saved.source.userNeed), ["identity", "subject", "digest"]);
  });

  it("loads design plans once and closes every DB/need/plan loader pairing", async () => {
    const inputs = await supportInputs();
    const plan = buildDesignPlan(inputs.discoveryDb, inputs.need, planOptions(inputs));
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-plan-loader-matrix-"));
    const planPath = path.join(root, "agentmo-design-plan.json");
    await writeDesignPlan(planPath, plan);
    const planBytes = await readFile(planPath);
    let openCount = 0;
    const loaded = await loadDesignPlan(planPath, {
      subject: "design-plan",
      expectedDigest: digest(planBytes),
      openInput: async (...args) => {
        openCount += 1;
        return open(...args);
      },
    });
    assert.equal(loaded.schemaVersion, "agentmo.design-plan.v1");
    assert.equal(openCount, 1);

    const artifacts = [
      { family: "discovery-db", file: DISCOVERY_DB_FILE, digest: digest(await readFile(DISCOVERY_DB_FILE)) },
      { family: "user-need", file: USER_NEED_FILE, digest: digest(await readFile(USER_NEED_FILE)) },
      { family: "design-plan", file: planPath, digest: digest(planBytes) },
    ];
    const loaders = [
      {
        family: "discovery-db",
        load: (file, expectedDigest) => loadDiscoveryDb(file, {
          subject: "discovery-db",
          expectedDigest,
        }),
      },
      {
        family: "user-need",
        load: (file, expectedDigest) => loadUserNeed(file, {
          subject: "user-need",
          expectedDigest,
        }),
      },
      {
        family: "design-plan",
        load: (file, expectedDigest) => loadDesignPlan(file, {
          subject: "design-plan",
          expectedDigest,
        }),
      },
    ];
    for (const loader of loaders) {
      for (const artifact of artifacts) {
        if (loader.family === artifact.family) continue;
        await assert.rejects(
          () => loader.load(artifact.file, artifact.digest),
          (error) => error.code === "AGENTMO_UNSUPPORTED_ARTIFACT",
          `${loader.family} loader must reject ${artifact.family}`,
        );
      }
    }

    const changedPath = path.join(root, "changed-design-plan.json");
    await writeFile(changedPath, `${planBytes.toString("utf8")} `, "utf8");
    await assert.rejects(
      () => loadDesignPlan(changedPath, {
        subject: "design-plan",
        expectedDigest: digest(planBytes),
      }),
      (error) => error.code === "AGENTMO_ARTIFACT_DIGEST_MISMATCH",
    );

    const unknownPath = path.join(root, "unknown.json");
    const unknownBytes = Buffer.from('{"schemaVersion":"agentmo.unknown.v1"}\n', "utf8");
    await writeFile(unknownPath, unknownBytes);
    const legacyPath = fileURLToPath(new URL("./fixtures/migration/legacy-blueprint.json", import.meta.url));
    const legacyDigest = digest(await readFile(legacyPath));
    for (const loader of loaders) {
      await assert.rejects(
        () => loader.load(unknownPath, digest(unknownBytes)),
        (error) => error.code === "AGENTMO_UNSUPPORTED_ARTIFACT",
      );
      await assert.rejects(
        () => loader.load(legacyPath, legacyDigest),
        (error) => error.code === "AGENTMO_MIGRATION_REQUIRED",
      );
    }
  });

  it("preflights admitted design-plan candidates before creating any output root", async () => {
    const mutations = [
      (plan) => { plan.rawTranscript = "conversation-canary-123456"; },
      (plan) => { plan.nested = { toolOutput: "tool-output-canary-123456" }; },
      (plan) => { plan.nested = { stdout: "stdout-canary-123456" }; },
      (plan) => { plan.nested = { note: "api_key=secret-canary-123456" }; },
      (plan) => { plan.nested = { hostPath: "/Users/synthetic-agentmo/private.txt" }; },
    ];
    for (const [index, mutate] of mutations.entries()) {
      const inputs = await supportInputs();
      const plan = buildDesignPlan(inputs.discoveryDb, inputs.need, planOptions(inputs));
      mutate(plan);
      const parent = await mkdtemp(path.join(tmpdir(), `agentmo-design-preflight-${index}-`));
      const root = path.join(parent, "must-not-exist");
      await assert.rejects(
        () => writeDesignPlan(path.join(root, "agentmo-design-plan.json"), plan),
        (error) => {
          assert.equal(typeof error.code, "string");
          assert.equal(error.code.startsWith("AGENTMO_PERSISTABILITY_"), true);
          assert.equal(JSON.stringify(error).includes("canary-123456"), false);
          return true;
        },
      );
      await assert.rejects(() => access(root));
    }

    const inputs = await supportInputs();
    const admitted = buildDesignPlan(inputs.discoveryDb, inputs.need, planOptions(inputs));
    const forged = structuredClone(admitted);
    const parent = await mkdtemp(path.join(tmpdir(), "agentmo-design-unadmitted-"));
    const root = path.join(parent, "must-not-exist");
    await assert.rejects(
      () => writeDesignPlan(path.join(root, "agentmo-design-plan.json"), forged),
      (error) => error.code === "AGENTMO_PERSISTABILITY_UNADMITTED_CANDIDATE",
    );
    await assert.rejects(() => access(root));
  });

  it("CLI design-plan rejects the old unapproved DB route and writes nothing", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "agentmo-design-plan-cli-"));
    const dbPath = path.join(tempRoot, "agentmo-discovery-db.json");
    const outPath = path.join(tempRoot, "agentmo-design-plan.json");
    const { discoveryDb } = await supportInputs();
    await writeFile(dbPath, `${JSON.stringify(discoveryDb, null, 2)}\n`, "utf8");
    const needPath = fileURLToPath(new URL("../examples/support-triage.need.json", import.meta.url));

    const result = await runCli([
      "design-plan",
      dbPath,
      "--need",
      needPath,
      "--digest",
      `discovery-db=${await digestFile(dbPath)}`,
      "--digest",
      `user-need=${await digestFile(needPath)}`,
      "--out",
      outPath,
      "--target",
      "openclaw",
      "--json",
    ]);

    assert.equal(result.code, 1);
    await assert.rejects(() => access(outPath));
  });

  it("CLI design-plan fails closed on unsafe DB and writes no success artifact", async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), "agentmo-design-plan-bad-db-"));
    const dbPath = path.join(tempRoot, "agentmo-discovery-db.json");
    const outPath = path.join(tempRoot, "agentmo-design-plan.json");
    const { discoveryDb } = await supportInputs();
    const unsafe = structuredClone(discoveryDb);
    unsafe.safety.workspaceOk = false;
    await writeFile(dbPath, `${JSON.stringify(unsafe, null, 2)}\n`, "utf8");
    const needPath = fileURLToPath(new URL("../examples/support-triage.need.json", import.meta.url));

    const result = await runCli([
      "design-plan",
      dbPath,
      "--need",
      needPath,
      "--digest",
      `discovery-db=${await digestFile(dbPath)}`,
      "--digest",
      `user-need=${await digestFile(needPath)}`,
      "--out",
      outPath,
      "--target",
      "openclaw",
      "--json",
    ]);

    assert.notEqual(result.code, 0);
    await assert.rejects(readFile(outPath, "utf8"));
  });

  it("uses evidence class only as a deterministic preference and labels matching non-semantic", async () => {
    const { discoveryDb, need, admissions } = await supportInputs();
    const rankedDb = structuredClone(discoveryDb);
    rankedDb.sources = [
      { id: "community", type: "retrieval_corpus", description: "memory community" },
      { id: "primary", type: "retrieval_corpus", description: "memory paper" },
      { id: "official-host", type: "retrieval_corpus", description: "memory official domain" },
    ];
    rankedDb.facts = [
      {
        id: "community:chunk:01",
        sourceId: "community",
        kind: "source_chunk",
        text: "Support ticket category priority memory",
        trustLevel: "unverified",
        evidenceClass: "community",
        refs: ["https://community.example/post"],
        tags: [],
      },
      {
        id: "primary:chunk:01",
        sourceId: "primary",
        kind: "source_chunk",
        text: "Support ticket category priority memory",
        trustLevel: "unverified",
        evidenceClass: "primary",
        refs: ["https://papers.example/abs/1"],
        tags: [],
      },
      {
        id: "official-host:chunk:01",
        sourceId: "official-host",
        kind: "source_chunk",
        text: "Support ticket category priority memory",
        trustLevel: "verified",
        declaredTrustLevel: "verified",
        evidenceClass: "context",
        refs: ["https://official.example/research"],
        tags: [],
      },
    ];
    const rankedAdmission = await admitValue(rankedDb, "discovery-db");
    const rankedInputs = await approveInputs({
      manifest: admissions.discoveryManifest.value,
      discoveryDb: rankedAdmission.value,
      need,
      admissions: { ...admissions, discoveryDb: rankedAdmission },
    });
    const plan = buildDesignPlan(rankedAdmission.value, need, planOptions(rankedInputs));
    const trace = plan.requirementsTrace.find((entry) => entry.requirementId === "primary-task-01");

    assert.equal(trace.coverage, "partial");
    assert.equal(trace.matchBasis, "mechanical-token-overlap-non-semantic");
    assert.deepEqual(trace.matchedFactRefs.slice(0, 2), [
      "primary:chunk:01",
      "official-host:chunk:01",
    ]);
    assert.equal(plan.evidencePolicy.semanticMatchingCertified, false);
  });
});
