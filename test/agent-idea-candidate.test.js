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
import { getArtifactContract } from "../src/artifact-contract.js";
import {
  AGENT_IDEA_CANDIDATE_CERTIFICATION_BOUNDARY,
  AGENT_IDEA_CANDIDATE_MAX_ERRORS,
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
    const report = buildAgentIdeaCandidateReport(candidate);
    assert.equal(report.ok, false);
    assert.match(report.errors.join("\n"), /exact admitted Discovery DB context/u);
  });

  it("normalizes untrusted fact classification metadata into bounded value-blind counts", () => {
    const candidate = validCandidate();
    const discoveryDb = validDiscoveryDb();
    discoveryDb.facts[0].kind = "__proto__";
    discoveryDb.facts[0].trustLevel = "constructor";
    discoveryDb.facts[1].kind = "kind-canary-".repeat(1000);
    discoveryDb.facts[1].trustLevel = "trust-canary-".repeat(1000);

    const report = buildAgentIdeaCandidateReport(candidate, discoveryContext(discoveryDb));
    assert.equal(report.ok, true);
    assert.deepEqual(report.summary.evidenceKinds, { other: 2 });
    assert.deepEqual(report.summary.trustLevels, { unknown: 2 });
    assert.equal(JSON.stringify(report).includes("kind-canary"), false);
    assert.equal(JSON.stringify(report).includes("trust-canary"), false);
    assert.equal(JSON.stringify(report).includes("function Object"), false);
  });

  it("bounds invalid public reports and never summarizes unvalidated identity or evidence", () => {
    const privateCanary = "sk-private-candidate-canary";
    const hostPath = "/Users/private-candidate/report.txt";
    const invalid = validCandidate();
    invalid.schemaVersion = `${privateCanary}-schema`;
    invalid.ideaId = privateCanary.repeat(1001);
    invalid.title = hostPath;
    invalid.targetUsers = Array.from({ length: 20_000 }, () => privateCanary);

    const report = buildAgentIdeaCandidateReport(invalid, discoveryContext());
    assert.equal(report.ok, false);
    assert.equal(report.errors.length <= AGENT_IDEA_CANDIDATE_MAX_ERRORS, true);
    assert.deepEqual(report.warnings, []);
    assert.equal(report.summary.schemaVersion, null);
    assert.equal(report.summary.ideaId, null);
    assert.equal(report.summary.targetUserCount, 0);
    assert.deepEqual(report.summary.evidenceKinds, {});
    assert.deepEqual(report.summary.trustLevels, {});
    assert.equal(report.errors.some((error) => error.includes("targetUsers[")), false);
    for (const output of [JSON.stringify(report), formatAgentIdeaCandidateReport(report)]) {
      assert.equal(output.includes(privateCanary), false);
      assert.equal(output.includes(hostPath), false);
      assert.equal(output.length < 10_000, true);
    }

    const capped = validCandidate();
    capped.targetUsers = Array.from({ length: 64 }, () => "");
    capped.candidateTasks = Array.from({ length: 64 }, () => "");
    const validation = validateAgentIdeaCandidate(capped, discoveryContext());
    assert.equal(validation.ok, false);
    assert.equal(validation.errors.length, AGENT_IDEA_CANDIDATE_MAX_ERRORS);
    assert.equal(JSON.stringify(validation).includes(privateCanary), false);
  });

  it("snapshots hostile public inputs without invoking getters, proxies, or array overrides", () => {
    const privateCanary = "sk-hostile-candidate-canary /Users/private/candidate.txt";
    let getterCalls = 0;
    const getterCandidate = validCandidate();
    Object.defineProperty(getterCandidate, "title", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return privateCanary;
      },
    });

    for (const invoke of [
      () => validateAgentIdeaCandidate(getterCandidate, discoveryContext()),
      () => summarizeAgentIdeaCandidate(getterCandidate, discoveryContext()),
      () => buildAgentIdeaCandidateReport(getterCandidate, discoveryContext()),
    ]) {
      let result;
      assert.doesNotThrow(() => { result = invoke(); });
      assert.equal(JSON.stringify(result).includes(privateCanary), false);
    }
    assert.equal(getterCalls, 0);

    let proxyCalls = 0;
    const proxyCandidate = new Proxy(validCandidate(), {
      get() {
        proxyCalls += 1;
        throw new Error(privateCanary);
      },
    });
    let proxyValidation;
    assert.doesNotThrow(() => {
      proxyValidation = validateAgentIdeaCandidate(proxyCandidate, discoveryContext());
    });
    assert.equal(proxyValidation.ok, false);
    assert.equal(proxyCalls, 0);
    assert.equal(JSON.stringify(proxyValidation).includes(privateCanary), false);

    let overrideCalls = 0;
    const overriddenArrays = validCandidate();
    for (const method of ["entries", "some", "every"]) {
      Object.defineProperty(overriddenArrays.evidenceIds, method, {
        enumerable: true,
        value() {
          overrideCalls += 1;
          throw new Error(privateCanary);
        },
      });
    }
    let overriddenValidation;
    assert.doesNotThrow(() => {
      overriddenValidation = validateAgentIdeaCandidate(overriddenArrays, discoveryContext());
    });
    assert.equal(overriddenValidation.ok, false);
    assert.equal(overrideCalls, 0);
    assert.equal(JSON.stringify(overriddenValidation).includes(privateCanary), false);

    const hostileContext = discoveryContext();
    Object.defineProperty(hostileContext.discoveryDb.facts[0], "id", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return privateCanary;
      },
    });
    let contextValidation;
    assert.doesNotThrow(() => {
      contextValidation = validateAgentIdeaCandidate(validCandidate(), hostileContext);
    });
    assert.equal(contextValidation.ok, false);
    assert.equal(getterCalls, 0);
  });

  it("normalizes direct formatter input to one bounded value-blind report", () => {
    const privateCanary = "sk-direct-report-canary /Users/private/report.txt";
    const hostile = {
      kind: "agentmo_agent_idea_candidate_report",
      version: "0.1",
      ok: true,
      summary: {
        schemaVersion: privateCanary.repeat(100),
        ideaId: privateCanary.repeat(100),
        targetUserCount: 999_999,
        candidateTaskCount: 999_999,
        evidenceCount: 999_999,
        evidenceGapCount: 999_999,
        judgmentBoundaryCount: 999_999,
        evidenceKinds: { [privateCanary]: 999_999 },
        trustLevels: { [privateCanary]: 999_999 },
        certificationBoundary: { enterPlanAuthorized: true },
      },
      warnings: Array.from({ length: 100 }, () => privateCanary),
      errors: Array.from({ length: 100 }, () => privateCanary),
    };
    const output = formatAgentIdeaCandidateReport(hostile);
    assert.equal(output.includes(privateCanary), false);
    assert.match(output, /AgentMo Agent Idea Candidate: unknown/u);
    assert.match(output, /Status: fail/u);
    assert.equal(output.length < 8_000, true);
    assert.equal(output.split("\n").filter((line) => line.startsWith("- ")).length <= 32, true);

    const malformedCases = [
      JSON.parse('{"summary":null,"warnings":"ordinary","errors":[{"bad":true}]}'),
      { summary: { ideaId: 7 }, warnings: [null], errors: [{ bad: true }] },
    ];
    for (const malformed of malformedCases) {
      let formatted;
      assert.doesNotThrow(() => { formatted = formatAgentIdeaCandidateReport(malformed); });
      assert.match(formatted, /Status: fail/u);
      assert.equal(formatted.length < 8_000, true);
    }

    let getterCalls = 0;
    const accessorReport = {};
    Object.defineProperty(accessorReport, "summary", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error(privateCanary);
      },
    });
    let accessorOutput;
    assert.doesNotThrow(() => { accessorOutput = formatAgentIdeaCandidateReport(accessorReport); });
    assert.equal(getterCalls, 0);
    assert.equal(accessorOutput.includes(privateCanary), false);

    let proxyCalls = 0;
    const proxyReport = new Proxy({}, {
      get() {
        proxyCalls += 1;
        throw new Error(privateCanary);
      },
    });
    let proxyOutput;
    assert.doesNotThrow(() => { proxyOutput = formatAgentIdeaCandidateReport(proxyReport); });
    assert.equal(proxyCalls, 0);
    assert.equal(proxyOutput.includes(privateCanary), false);
  });

  it("keeps public Schema and production string boundaries aligned by Unicode code point", () => {
    const schema = getArtifactContract("agent-idea-candidate").jsonSchema;
    const cases = [
      ["title", 512, schema.properties.title],
      ["targetUsers", 1024, schema.properties.targetUsers.items],
      ["candidateTasks", 2048, schema.properties.candidateTasks.items],
      ["valueHypothesis", 4096, schema.properties.valueHypothesis],
      ["evidenceIds", 256, schema.properties.evidenceIds.items],
      ["evidenceGaps", 2048, schema.properties.evidenceGaps.items],
      ["judgmentBoundaries", 2048, schema.properties.judgmentBoundaries.items],
    ];
    for (const [field, maximum, stringSchema] of cases) {
      for (const [label, value, expected] of [
        ["whitespace", " \t\n", false],
        ["NUL", "valid\0invalid", false],
        ["emoji maximum", "😀".repeat(maximum), true],
        ["emoji overflow", "😀".repeat(maximum + 1), false],
      ]) {
        const candidate = validCandidate();
        if (["targetUsers", "candidateTasks", "evidenceIds", "evidenceGaps", "judgmentBoundaries"].includes(field)) {
          candidate[field] = [value];
        } else {
          candidate[field] = value;
        }
        const productionAccepts = validateAgentIdeaCandidate(candidate).ok;
        assert.equal(productionAccepts, expected, `${field} ${label} production`);
        assert.equal(schemaAcceptsString(stringSchema, value), expected, `${field} ${label} schema`);
      }
    }

    const ideaIdSchema = schema.properties.ideaId;
    for (const [label, value, expected] of [
      ["whitespace", " ", false],
      ["NUL", "idea\0id", false],
      ["maximum", "a".repeat(128), true],
      ["overflow", "a".repeat(129), false],
    ]) {
      const candidate = validCandidate();
      candidate.ideaId = value;
      assert.equal(validateAgentIdeaCandidate(candidate).ok, expected, `ideaId ${label} production`);
      assert.equal(schemaAcceptsString(ideaIdSchema, value), expected, `ideaId ${label} schema`);
    }
    assert.equal(validateAgentIdeaCandidate(getArtifactContract("agent-idea-candidate").minimalTemplate).ok, true);
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

  it("rejects duplicate Candidate members before last-wins parsing or content audit", async () => {
    const fixture = await cliFixture("duplicate-members");
    const canonical = candidateForAdmission(fixture.dbAdmission);
    const canonicalBoundary = JSON.stringify(canonical.certificationBoundary);
    const authorityBoundary = JSON.stringify({
      ...canonical.certificationBoundary,
      enterPlanAuthorized: true,
    });
    const secretPathCanary = "api_key=private-duplicate-secret /Users/private-duplicate/path";
    const rawCases = [
      {
        label: "boundary",
        raw: `${JSON.stringify(canonical).replace(
          `\"certificationBoundary\":${canonicalBoundary}`,
          `\"certificationBoundary\":${authorityBoundary},\"certificationBoundary\":${canonicalBoundary}`,
        )}\n`,
      },
      {
        label: "free-text",
        raw: `${JSON.stringify(canonical).replace(
          `\"title\":${JSON.stringify(canonical.title)}`,
          `\"title\":${JSON.stringify(secretPathCanary)},\"title\":${JSON.stringify(canonical.title)}`,
        )}\n`,
      },
      {
        label: "escaped-key",
        raw: `${JSON.stringify(canonical).replace(
          `\"title\":${JSON.stringify(canonical.title)}`,
          `\"ti\\u0074le\":${JSON.stringify(secretPathCanary)},\"title\":${JSON.stringify(canonical.title)}`,
        )}\n`,
      },
    ];

    for (const testCase of rawCases) {
      const bytes = Buffer.from(testCase.raw, "utf8");
      const file = path.join(fixture.root, `${testCase.label}.json`);
      await writeFile(file, bytes);
      await assert.rejects(
        () => loadAdmittedArtifact({
          filePath: file,
          subject: "agent-idea-candidate",
          expectedDigest: digestRawBytes(bytes),
          companions: { "discovery-db": fixture.dbAdmission },
        }),
        (error) => {
          assert.equal(error.code, "AGENTMO_UNSUPPORTED_ARTIFACT");
          const serialized = JSON.stringify(error);
          assert.equal(serialized.includes(secretPathCanary), false);
          assert.equal(serialized.includes(fixture.root), false);
          return true;
        },
        testCase.label,
      );
    }
  });

  it("rejects distinct unpaired surrogate values before UTF-8 evidence ordering", async () => {
    const validationCandidate = validCandidate();
    validationCandidate.evidenceIds = ["\ud800", "\ud801"];
    const validation = validateAgentIdeaCandidate(validationCandidate, discoveryContext());
    assert.equal(validation.ok, false);
    assert.equal(
      validation.errors.filter((error) => error.includes("invalid Unicode scalar value")).length,
      2,
    );

    const fixture = await cliFixture("surrogate-values");
    for (const [index, surrogate] of ["\ud800", "\ud801"].entries()) {
      const candidate = candidateForAdmission(fixture.dbAdmission);
      candidate.title = `bounded-${surrogate}-candidate`;
      const bytes = Buffer.from(`${JSON.stringify(candidate)}\n`, "utf8");
      const file = path.join(fixture.root, `surrogate-${index}.json`);
      await writeFile(file, bytes);
      await assert.rejects(
        () => loadAdmittedArtifact({
          filePath: file,
          subject: "agent-idea-candidate",
          expectedDigest: digestRawBytes(bytes),
          companions: { "discovery-db": fixture.dbAdmission },
        }),
        (error) => error.code === "AGENTMO_UNSUPPORTED_ARTIFACT"
          && error.reason === "invalid_unicode_scalar",
      );
    }
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

  it("fails closed on repeated Candidate single-value options before reading either path", async () => {
    const fixture = await cliFixture("duplicate-discovery-db-option");
    const missingPath = path.join(fixture.root, "private-missing-db-canary.json");
    const cases = [
      {
        label: "same path",
        args: [
          "agent-idea-candidate-report", fixture.candidateFile,
          "--discovery-db", fixture.dbFile,
          "--discovery-db", fixture.dbFile,
          "--digest", `agent-idea-candidate=${fixture.candidateDigest}`,
          "--digest", `discovery-db=${fixture.dbDigest}`,
          "--json",
        ],
      },
      {
        label: "different path",
        args: [
          "agent-idea-candidate-report", fixture.candidateFile,
          "--discovery-db", missingPath,
          "--discovery-db", fixture.dbFile,
          "--digest", `agent-idea-candidate=${fixture.candidateDigest}`,
          "--digest", `discovery-db=${fixture.dbDigest}`,
          "--json",
        ],
      },
    ];
    const beforeEntries = await readdir(fixture.root);
    for (const testCase of cases) {
      const result = await runCli(testCase.args);
      assert.equal(result.code, 1, testCase.label);
      assert.equal(result.stderr, "", testCase.label);
      const error = JSON.parse(result.stdout);
      assert.equal(error.code, "AGENTMO_CLI_REQUEST_REJECTED", testCase.label);
      assert.equal(result.stdout.includes(fixture.root), false, testCase.label);
      assert.equal(result.stdout.includes("private-missing-db-canary"), false, testCase.label);
      assert.deepEqual(await readdir(fixture.root), beforeEntries, testCase.label);
    }
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

function schemaAcceptsString(schema, value) {
  if (typeof value !== "string") return false;
  const length = [...value].length;
  if (schema.minLength !== undefined && length < schema.minLength) return false;
  if (schema.maxLength !== undefined && length > schema.maxLength) return false;
  return schema.pattern === undefined || new RegExp(schema.pattern, "u").test(value);
}
