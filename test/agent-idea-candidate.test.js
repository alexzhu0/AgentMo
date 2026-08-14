import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  digestRawBytes,
  loadAdmittedArtifact,
} from "../src/artifact-admission.js";
import {
  AGENT_IDEA_CANDIDATE_CERTIFICATION_BOUNDARY,
  AGENT_IDEA_CANDIDATE_SCHEMA_VERSION,
  AGENT_IDEA_CANDIDATE_SUBJECT,
  buildAgentIdeaCandidateReport,
  formatAgentIdeaCandidateReport,
  summarizeAgentIdeaCandidate,
  validateAgentIdeaCandidate,
} from "../src/agent-idea-candidate.js";

const DISCOVERY_DB_DIGEST = `sha256:${"a".repeat(64)}`;
const PREBUILT_DISCOVERY_DB = new URL(
  "../examples/fixtures/support-triage/prebuilt-discovery-db.json",
  import.meta.url,
);
const CLI = fileURLToPath(new URL("../bin/agentmo.js", import.meta.url));

function validDiscoveryDb() {
  return {
    schemaVersion: "agentmo.discovery-db.v1",
    facts: [
      {
        id: "fact:verified",
        kind: "source_chunk",
        trustLevel: "verified",
      },
      {
        id: "lead:declared",
        kind: "extraction_field",
        trustLevel: "derived",
      },
    ],
  };
}

function discoveryContext(discoveryDb = validDiscoveryDb()) {
  return {
    discoveryDb,
    source: {
      identity: "agentmo.discovery-db.v1",
      subject: "discovery-db",
      digest: DISCOVERY_DB_DIGEST,
    },
  };
}

function validCandidate() {
  return {
    schemaVersion: "agentmo.agent-idea-candidate.v1",
    ideaId: "idea-001",
    title: "Bounded candidate for a repeated workflow",
    targetUsers: ["Operators reviewing repeated work"],
    candidateTasks: ["Summarize one bounded evidence-backed workflow"],
    valueHypothesis: "The candidate may reduce repeated review effort if the cited evidence is sufficient.",
    source: {
      discoveryDb: {
        identity: "agentmo.discovery-db.v1",
        subject: "discovery-db",
        digest: DISCOVERY_DB_DIGEST,
      },
    },
    evidenceIds: ["fact:verified", "lead:declared"],
    evidenceGaps: ["No reviewed user-value measurement is available."],
    judgmentBoundaries: ["The cited facts do not prove user need or Plan readiness."],
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
}

describe("Agent Idea Candidate", () => {
  it("validates one closed proposal and reports bounded evidence composition", () => {
    const candidate = validCandidate();
    const context = discoveryContext();

    assert.equal(AGENT_IDEA_CANDIDATE_SCHEMA_VERSION, "agentmo.agent-idea-candidate.v1");
    assert.equal(AGENT_IDEA_CANDIDATE_SUBJECT, "agent-idea-candidate");
    assert.deepEqual(AGENT_IDEA_CANDIDATE_CERTIFICATION_BOUNDARY, candidate.certificationBoundary);

    const validation = validateAgentIdeaCandidate(candidate, context);
    assert.deepEqual(validation.errors, []);
    assert.equal(validation.ok, true);
    assert.deepEqual(validation.warnings, [
      "evidenceIds cite extraction_field planning leads; they do not prove user need, value, capability, domain quality, or Plan readiness.",
    ]);

    assert.deepEqual(summarizeAgentIdeaCandidate(candidate, context), {
      schemaVersion: "agentmo.agent-idea-candidate.v1",
      ideaId: "idea-001",
      targetUserCount: 1,
      candidateTaskCount: 1,
      evidenceCount: 2,
      evidenceGapCount: 1,
      judgmentBoundaryCount: 1,
      evidenceKinds: {
        extraction_field: 1,
        source_chunk: 1,
      },
      trustLevels: {
        derived: 1,
        verified: 1,
      },
      certificationBoundary: candidate.certificationBoundary,
    });

    const report = buildAgentIdeaCandidateReport(candidate, context);
    assert.equal(report.kind, "agentmo_agent_idea_candidate_report");
    assert.equal(report.version, "0.1");
    assert.equal(report.ok, true);
    assert.equal(report.warnings.length, 1);
    const human = formatAgentIdeaCandidateReport(report);
    assert.match(human, /AgentMo Agent Idea Candidate: idea-001/u);
    assert.match(human, /Plan authority: none/u);
    assert.equal(human.includes(candidate.title), false);
    assert.equal(JSON.stringify(report).includes(candidate.valueHypothesis), false);
  });

  it("rejects unknown fields, unbounded content, unsorted IDs, and mutable authority boundaries", () => {
    const cases = [
      ["unknown field", (value) => { value.unknown = true; }, /canonical Candidate fields/u],
      ["empty title", (value) => { value.title = " "; }, /title must be a non-empty string/u],
      ["long title", (value) => { value.title = "x".repeat(513); }, /title must be at most 512/u],
      ["empty target users", (value) => { value.targetUsers = []; }, /targetUsers must contain at least 1/u],
      ["too many tasks", (value) => { value.candidateTasks = Array.from({ length: 65 }, (_, index) => `task-${index}`); }, /candidateTasks must contain at most 64/u],
      ["unsorted IDs", (value) => { value.evidenceIds = ["lead:declared", "fact:verified"]; }, /evidenceIds must be sorted and unique/u],
      ["duplicate IDs", (value) => { value.evidenceIds = ["fact:verified", "fact:verified"]; }, /evidenceIds must be sorted and unique/u],
      ["no judgment boundary", (value) => { value.judgmentBoundaries = []; }, /judgmentBoundaries must contain at least 1/u],
      ["authority escalation", (value) => { value.certificationBoundary.enterPlanAuthorized = true; }, /certificationBoundary.enterPlanAuthorized must be false/u],
    ];

    for (const [label, mutate, pattern] of cases) {
      const candidate = validCandidate();
      mutate(candidate);
      const validation = validateAgentIdeaCandidate(candidate, discoveryContext());
      assert.equal(validation.ok, false, label);
      assert.match(validation.errors.join("\n"), pattern, label);
    }
  });

  it("fails closed when evidence provenance or fact resolution is missing or ambiguous", () => {
    const stale = validCandidate();
    stale.source.discoveryDb.digest = `sha256:${"b".repeat(64)}`;
    assert.match(
      validateAgentIdeaCandidate(stale, discoveryContext()).errors.join("\n"),
      /source.discoveryDb does not match the exact admitted Discovery DB/u,
    );

    const missing = validCandidate();
    missing.evidenceIds = ["fact:missing"];
    assert.match(
      validateAgentIdeaCandidate(missing, discoveryContext()).errors.join("\n"),
      /evidenceIds\[0\] must resolve to exactly one Discovery DB fact/u,
    );

    const ambiguousDb = validDiscoveryDb();
    ambiguousDb.facts.push({
      id: "fact:verified",
      kind: "source_chunk",
      trustLevel: "trusted",
    });
    assert.match(
      validateAgentIdeaCandidate(validCandidate(), discoveryContext(ambiguousDb)).errors.join("\n"),
      /evidenceIds\[0\] must resolve to exactly one Discovery DB fact/u,
    );
  });

  it("validates shape without context but never invents evidence composition", () => {
    const candidate = validCandidate();
    const validation = validateAgentIdeaCandidate(candidate);
    assert.equal(validation.ok, true);
    assert.deepEqual(validation.warnings, []);
    assert.deepEqual(summarizeAgentIdeaCandidate(candidate).evidenceKinds, {});
    assert.deepEqual(summarizeAgentIdeaCandidate(candidate).trustLevels, {});
  });

  it("exact-admits Candidate bytes only with the authentic Discovery DB companion", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-idea-candidate-admission-"));
    const dbBytes = await readFile(PREBUILT_DISCOVERY_DB);
    const dbAdmission = await loadAdmittedArtifact({
      filePath: PREBUILT_DISCOVERY_DB,
      subject: "discovery-db",
      expectedDigest: digestRawBytes(dbBytes),
    });
    const candidate = candidateForAdmission(dbAdmission);
    const candidateBytes = Buffer.from(`${JSON.stringify(candidate, null, 2)}\n`, "utf8");
    const candidateFile = path.join(root, "candidate.json");
    await writeFile(candidateFile, candidateBytes);

    await assert.rejects(
      () => loadAdmittedArtifact({
        filePath: candidateFile,
        subject: "agent-idea-candidate",
        expectedDigest: digestRawBytes(candidateBytes),
      }),
      (error) => error.code === "AGENTMO_ARTIFACT_COMPANION_SET_REQUIRED",
    );

    const admission = await loadAdmittedArtifact({
      filePath: candidateFile,
      subject: "agent-idea-candidate",
      expectedDigest: digestRawBytes(candidateBytes),
      companions: { "discovery-db": dbAdmission },
    });
    assert.equal(admission.identity, "agentmo.agent-idea-candidate.v1");
    assert.equal(admission.subject, "agent-idea-candidate");
    assert.equal(admission.value.ideaId, "idea-001");

    await assert.rejects(
      () => loadAdmittedArtifact({
        filePath: candidateFile,
        subject: "agent-idea-candidate",
        expectedDigest: digestRawBytes(candidateBytes),
        companions: { "discovery-db": Object.freeze({ ...dbAdmission }) },
      }),
      (error) => error.code === "AGENTMO_ARTIFACT_ADMISSION_RESULT_INVALID",
    );
  });

  it("rejects stale evidence binding, secret-like values, and host paths before reporting", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-idea-candidate-safety-"));
    const dbBytes = await readFile(PREBUILT_DISCOVERY_DB);
    const dbAdmission = await loadAdmittedArtifact({
      filePath: PREBUILT_DISCOVERY_DB,
      subject: "discovery-db",
      expectedDigest: digestRawBytes(dbBytes),
    });
    const cases = [
      {
        label: "stale",
        mutate: (value) => { value.source.discoveryDb.digest = `sha256:${"b".repeat(64)}`; },
        code: "AGENTMO_UNSUPPORTED_ARTIFACT",
      },
      {
        label: "secret",
        mutate: (value) => { value.title = "Candidate api_key=secret-value-123456"; },
        code: "AGENTMO_ARTIFACT_UNSAFE_CONTENT",
      },
      {
        label: "host-path",
        mutate: (value) => { value.judgmentBoundaries = ["Do not read /Users/private-agentmo/private.txt"]; },
        code: "AGENTMO_ARTIFACT_UNSAFE_CONTENT",
      },
    ];

    for (const testCase of cases) {
      const candidate = candidateForAdmission(dbAdmission);
      testCase.mutate(candidate);
      const bytes = Buffer.from(`${JSON.stringify(candidate, null, 2)}\n`, "utf8");
      const file = path.join(root, `${testCase.label}.json`);
      await writeFile(file, bytes);
      await assert.rejects(
        () => loadAdmittedArtifact({
          filePath: file,
          subject: "agent-idea-candidate",
          expectedDigest: digestRawBytes(bytes),
          companions: { "discovery-db": dbAdmission },
        }),
        (error) => error.code === testCase.code,
        testCase.label,
      );
    }
  });

  it("publicly exports the Candidate contract and bounded command help", async () => {
    const contractResult = await runCli([
      "artifact-contract",
      "agent-idea-candidate",
      "--json",
    ]);
    assert.equal(contractResult.code, 0, contractResult.stderr);
    assert.equal(contractResult.stderr, "");
    const contract = JSON.parse(contractResult.stdout);
    assert.equal(contract.subject, "agent-idea-candidate");
    assert.equal(contract.identity, "agentmo.agent-idea-candidate.v1");
    assert.equal(validateAgentIdeaCandidate(contract.minimalTemplate).ok, true);
    assert.equal(contract.jsonSchema.additionalProperties, false);
    assert.deepEqual(
      contract.minimalTemplate.certificationBoundary,
      AGENT_IDEA_CANDIDATE_CERTIFICATION_BOUNDARY,
    );

    const help = await runCli(["agent-idea-candidate-report", "--help"]);
    assert.equal(help.code, 0, help.stderr);
    assert.match(help.stdout, /artifact-contract agent-idea-candidate --json/u);
    assert.match(help.stdout, /proposal-only/u);
    assert.match(help.stdout, /does not authorize Plan/u);
  });

  it("reports an exact Candidate/DB pair in JSON and human modes without writing", async () => {
    const fixture = await cliFixture("report");
    const args = candidateReportArgs(fixture);
    const before = await readFile(fixture.candidateFile);
    const beforeEntries = await readdir(fixture.root);

    const json = await runCli([...args, "--json"]);
    assert.equal(json.code, 0, json.stderr);
    assert.equal(json.stderr, "");
    const report = JSON.parse(json.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.summary.ideaId, "idea-001");
    assert.deepEqual(report.summary.evidenceKinds, { extraction_field: 1 });
    assert.deepEqual(report.summary.trustLevels, { derived: 1 });
    assert.deepEqual(report.summary.certificationBoundary, AGENT_IDEA_CANDIDATE_CERTIFICATION_BOUNDARY);
    assert.equal(report.warnings.length, 1);

    const human = await runCli(args);
    assert.equal(human.code, 0, human.stderr);
    assert.match(human.stdout, /AgentMo Agent Idea Candidate: idea-001/u);
    assert.match(human.stdout, /Plan authority: none/u);
    assert.deepEqual(await readFile(fixture.candidateFile), before);
    assert.deepEqual(await readdir(fixture.root), beforeEntries);
  });

  it("fails closed for missing, duplicate, extra, swapped, and malformed CLI inputs", async () => {
    const fixture = await cliFixture("bindings");
    const base = [
      "agent-idea-candidate-report",
      fixture.candidateFile,
      "--discovery-db",
      fixture.dbFile,
    ];
    const cases = [
      {
        label: "missing",
        args: [...base, "--digest", `agent-idea-candidate=${fixture.candidateDigest}`, "--json"],
        code: "AGENTMO_ARTIFACT_DIGEST_REQUIRED",
      },
      {
        label: "duplicate",
        args: [
          ...base,
          "--digest", `agent-idea-candidate=${fixture.candidateDigest}`,
          "--digest", `agent-idea-candidate=${fixture.candidateDigest}`,
          "--digest", `discovery-db=${fixture.dbDigest}`,
          "--json",
        ],
        code: "AGENTMO_ARTIFACT_DIGEST_DUPLICATE",
      },
      {
        label: "extra",
        args: [
          ...candidateReportArgs(fixture),
          "--digest", `user-need=${fixture.candidateDigest}`,
          "--json",
        ],
        code: "AGENTMO_ARTIFACT_DIGEST_UNKNOWN_SUBJECT",
      },
      {
        label: "swapped",
        args: [
          ...base,
          "--digest", `agent-idea-candidate=${fixture.dbDigest}`,
          "--digest", `discovery-db=${fixture.candidateDigest}`,
          "--json",
        ],
        code: "AGENTMO_ARTIFACT_DIGEST_MISMATCH",
      },
    ];
    for (const testCase of cases) {
      const result = await runCli(testCase.args);
      assert.equal(result.code, 1, testCase.label);
      assert.equal(result.stderr, "", testCase.label);
      assert.equal(JSON.parse(result.stdout).code, testCase.code, testCase.label);
    }

    const malformed = candidateForAdmission(fixture.dbAdmission);
    const privateCanary = "private-candidate-title-canary";
    malformed.unknown = privateCanary;
    const malformedBytes = Buffer.from(`${JSON.stringify(malformed, null, 2)}\n`, "utf8");
    const malformedFile = path.join(fixture.root, "malformed.json");
    await writeFile(malformedFile, malformedBytes);
    const result = await runCli([
      "agent-idea-candidate-report",
      malformedFile,
      "--discovery-db", fixture.dbFile,
      "--digest", `agent-idea-candidate=${digestRawBytes(malformedBytes)}`,
      "--digest", `discovery-db=${fixture.dbDigest}`,
      "--json",
    ]);
    assert.equal(result.code, 1);
    const error = JSON.parse(result.stdout);
    assert.equal(error.code, "AGENTMO_UNSUPPORTED_ARTIFACT");
    assert.equal(error.subject, "agent-idea-candidate");
    assert.match(error.guidance, /artifact-contract agent-idea-candidate --json/u);
    assert.equal(result.stdout.includes(privateCanary), false);
    assert.equal(result.stdout.includes(fixture.root), false);
  });
});

function candidateForAdmission(dbAdmission) {
  const candidate = validCandidate();
  candidate.source.discoveryDb.digest = dbAdmission.digest;
  candidate.evidenceIds = [dbAdmission.value.facts[0].id];
  return candidate;
}

async function cliFixture(label) {
  const root = await mkdtemp(path.join(tmpdir(), `agentmo-idea-candidate-${label}-`));
  const dbFile = fileURLToPath(PREBUILT_DISCOVERY_DB);
  const dbBytes = await readFile(dbFile);
  const dbDigest = digestRawBytes(dbBytes);
  const dbAdmission = await loadAdmittedArtifact({
    filePath: dbFile,
    subject: "discovery-db",
    expectedDigest: dbDigest,
  });
  const candidate = candidateForAdmission(dbAdmission);
  const candidateBytes = Buffer.from(`${JSON.stringify(candidate, null, 2)}\n`, "utf8");
  const candidateFile = path.join(root, "candidate.json");
  await writeFile(candidateFile, candidateBytes);
  return {
    root,
    dbFile,
    dbDigest,
    dbAdmission,
    candidateFile,
    candidateDigest: digestRawBytes(candidateBytes),
  };
}

function candidateReportArgs(fixture) {
  return [
    "agent-idea-candidate-report",
    fixture.candidateFile,
    "--discovery-db", fixture.dbFile,
    "--digest", `agent-idea-candidate=${fixture.candidateDigest}`,
    "--digest", `discovery-db=${fixture.dbDigest}`,
  ];
}

function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
