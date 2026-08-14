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

  it("formats pass only for the exact report object built from a validated Candidate and DB", () => {
    const privateCanary = "sk-forged-report-canary /Users/private/forged-report.txt";
    const expectedFailure = [
      "AgentMo Agent Idea Candidate: unknown",
      "Status: fail",
      "Target users: 0",
      "Candidate tasks: 0",
      "Evidence IDs: 0",
      "Evidence gaps: 0",
      "Judgment boundaries: 0",
      "Evidence kinds: none",
      "Trust levels: none",
      "Plan authority: none",
      "",
      "Errors:",
      "- Candidate report contained an unrecognized diagnostic.",
      "",
    ].join("\n");
    const genuine = buildAgentIdeaCandidateReport(validCandidate(), discoveryContext());
    assert.match(formatAgentIdeaCandidateReport(genuine), /Status: pass/u);

    const zeroCountForgery = {
      kind: "agentmo_agent_idea_candidate_report",
      version: "0.1",
      ok: true,
      summary: {
        schemaVersion: null,
        ideaId: null,
        targetUserCount: 0,
        candidateTaskCount: 0,
        evidenceCount: 0,
        evidenceGapCount: 0,
        judgmentBoundaryCount: 0,
        evidenceKinds: {},
        trustLevels: {},
        certificationBoundary: AGENT_IDEA_CANDIDATE_CERTIFICATION_BOUNDARY,
      },
      warnings: [],
      errors: [],
    };
    const synthetic = JSON.parse(JSON.stringify(genuine));
    synthetic.summary.ideaId = "synthetic-idea";
    const wrongComposition = JSON.parse(JSON.stringify(genuine));
    wrongComposition.summary.evidenceKinds = { source_chunk: 2 };
    const reparsed = JSON.parse(JSON.stringify(genuine));
    const clone = { ...genuine };
    const revocable = Proxy.revocable(genuine, {});
    revocable.revoke();

    for (const forged of [
      zeroCountForgery,
      synthetic,
      wrongComposition,
      reparsed,
      clone,
      revocable.proxy,
    ]) {
      let output;
      assert.doesNotThrow(() => { output = formatAgentIdeaCandidateReport(forged); });
      assert.equal(output, expectedFailure);
      assert.equal(output.includes(privateCanary), false);
      assert.doesNotMatch(output, /Status: pass/u);
    }

    const originalHuman = formatAgentIdeaCandidateReport(genuine);
    genuine.ok = false;
    genuine.summary.ideaId = privateCanary;
    genuine.summary.evidenceKinds = { [privateCanary]: 999 };
    genuine.warnings.push(privateCanary);
    genuine.errors.push(privateCanary);
    const mutatedHuman = formatAgentIdeaCandidateReport(genuine);
    assert.equal(mutatedHuman, originalHuman);
    assert.equal(mutatedHuman.includes(privateCanary), false);
    assert.match(mutatedHuman, /Status: pass/u);
  });

  it("uses module-captured WeakMap intrinsics for private report state", () => {
    const privateCanary = "sk-weakmap-intrinsic-canary /Users/private/weakmap.txt";
    const getDescriptor = Object.getOwnPropertyDescriptor(WeakMap.prototype, "get");
    const setDescriptor = Object.getOwnPropertyDescriptor(WeakMap.prototype, "set");
    const fakeState = {
      ok: true,
      summary: {
        schemaVersion: "agentmo.agent-idea-candidate.v1",
        ideaId: privateCanary,
        targetUserCount: 1,
        candidateTaskCount: 1,
        evidenceCount: 1,
        evidenceGapCount: 0,
        judgmentBoundaryCount: 1,
        evidenceKinds: { source_chunk: 1 },
        trustLevels: { verified: 1 },
        certificationBoundary: AGENT_IDEA_CANDIDATE_CERTIFICATION_BOUNDARY,
      },
      warnings: [],
      errors: [],
    };

    let forgedOutput;
    let forgedThrow;
    try {
      Object.defineProperty(WeakMap.prototype, "get", {
        ...getDescriptor,
        value() { return fakeState; },
      });
      forgedOutput = formatAgentIdeaCandidateReport({});
    } catch (error) {
      forgedThrow = error;
    } finally {
      Object.defineProperty(WeakMap.prototype, "get", getDescriptor);
    }

    let throwingGetOutput;
    let throwingGetError;
    try {
      Object.defineProperty(WeakMap.prototype, "get", {
        ...getDescriptor,
        value() { throw new Error(privateCanary); },
      });
      throwingGetOutput = formatAgentIdeaCandidateReport({});
    } catch (error) {
      throwingGetError = error;
    } finally {
      Object.defineProperty(WeakMap.prototype, "get", getDescriptor);
    }

    let observedMap;
    let observedSetCalls = 0;
    let observedSetReport;
    let observedSetError;
    try {
      Object.defineProperty(WeakMap.prototype, "set", {
        ...setDescriptor,
        value(key, value) {
          observedSetCalls += 1;
          observedMap = this;
          return Reflect.apply(setDescriptor.value, this, [key, value]);
        },
      });
      observedSetReport = buildAgentIdeaCandidateReport(validCandidate(), discoveryContext());
    } catch (error) {
      observedSetError = error;
    } finally {
      Object.defineProperty(WeakMap.prototype, "set", setDescriptor);
    }

    let throwingSetReport;
    let throwingSetError;
    try {
      Object.defineProperty(WeakMap.prototype, "set", {
        ...setDescriptor,
        value() { throw new Error(privateCanary); },
      });
      throwingSetReport = buildAgentIdeaCandidateReport(validCandidate(), discoveryContext());
    } catch (error) {
      throwingSetError = error;
    } finally {
      Object.defineProperty(WeakMap.prototype, "set", setDescriptor);
    }

    assert.equal(forgedThrow, undefined);
    assert.doesNotMatch(forgedOutput, /Status: pass/u);
    assert.equal(forgedOutput.includes(privateCanary), false);
    assert.equal(forgedOutput.length < 8_000, true);
    assert.equal(throwingGetError, undefined);
    assert.doesNotMatch(throwingGetOutput, /Status: pass/u);
    assert.equal(throwingGetOutput.includes(privateCanary), false);
    assert.equal(observedSetError, undefined);
    assert.equal(observedSetCalls, 0);
    assert.equal(observedMap, undefined);
    assert.equal(observedSetReport.ok, true);
    assert.match(formatAgentIdeaCandidateReport(observedSetReport), /Status: pass/u);
    assert.equal(throwingSetError, undefined);
    assert.equal(throwingSetReport.ok, true);
    assert.match(formatAgentIdeaCandidateReport(throwingSetReport), /Status: pass/u);
  });

  it("keeps internal composition and formatting independent of Array prototype mutation", () => {
    const privateCanary = "sk-array-intrinsic-canary /Users/private/array.txt";
    const indexDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "0");
    const pushDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "push");
    const joinDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "join");
    const candidate = validCandidate();
    const context = discoveryContext();
    let setterCalls = 0;
    let compositionReport;
    let compositionError;
    try {
      Object.defineProperty(Array.prototype, "0", {
        configurable: true,
        set() { setterCalls += 1; },
      });
      compositionReport = buildAgentIdeaCandidateReport(candidate, context);
    } catch (error) {
      compositionError = error;
    } finally {
      if (indexDescriptor === undefined) delete Array.prototype[0];
      else Object.defineProperty(Array.prototype, "0", indexDescriptor);
    }

    const report = buildAgentIdeaCandidateReport(validCandidate(), discoveryContext());
    let pushOutput;
    let pushError;
    try {
      Object.defineProperty(Array.prototype, "push", {
        ...pushDescriptor,
        value() { throw new Error(privateCanary); },
      });
      pushOutput = formatAgentIdeaCandidateReport(report);
    } catch (error) {
      pushError = error;
    } finally {
      Object.defineProperty(Array.prototype, "push", pushDescriptor);
    }

    let joinOutput;
    let joinError;
    try {
      Object.defineProperty(Array.prototype, "join", {
        ...joinDescriptor,
        value() { return privateCanary.repeat(10_000); },
      });
      joinOutput = formatAgentIdeaCandidateReport(report);
    } catch (error) {
      joinError = error;
    } finally {
      Object.defineProperty(Array.prototype, "join", joinDescriptor);
    }

    assert.equal(compositionError, undefined);
    assert.equal(setterCalls, 0);
    assert.equal(compositionReport.ok, true);
    assert.deepEqual(compositionReport.summary.evidenceKinds, {
      extraction_field: 1,
      source_chunk: 1,
    });
    assert.deepEqual(compositionReport.summary.trustLevels, {
      derived: 1,
      verified: 1,
    });
    assert.equal(pushError, undefined);
    assert.match(pushOutput, /Status: pass/u);
    assert.equal(pushOutput.includes(privateCanary), false);
    assert.equal(joinError, undefined);
    assert.match(joinOutput, /Status: pass/u);
    assert.equal(joinOutput.includes(privateCanary), false);
    assert.equal(joinOutput.length < 8_000, true);
  });

  it("rejects unreasonable string resources before unbounded code-point expansion", () => {
    const iteratorDescriptor = Object.getOwnPropertyDescriptor(String.prototype, Symbol.iterator);
    let largeIteratorCalls = 0;
    Object.defineProperty(String.prototype, Symbol.iterator, {
      ...iteratorDescriptor,
      value() {
        if (this.length > 1024) {
          largeIteratorCalls += 1;
          throw new Error("large-string-iterator-must-not-run");
        }
        return iteratorDescriptor.value.call(this);
      },
    });

    let codeUnitOverflow;
    let unreasonableTitle;
    let aggregateOverflow;
    let thrown;
    try {
      const codeUnitCandidate = validCandidate();
      codeUnitCandidate.title = "x".repeat(1025);
      codeUnitOverflow = validateAgentIdeaCandidate(codeUnitCandidate);

      const unreasonableCandidate = validCandidate();
      unreasonableCandidate.title = "x".repeat(2_000_000);
      unreasonableTitle = validateAgentIdeaCandidate(unreasonableCandidate);

      const aggregateCandidate = validCandidate();
      aggregateCandidate.title = "x".repeat(400_000);
      aggregateCandidate.valueHypothesis = "y".repeat(400_000);
      aggregateCandidate.targetUsers = ["z".repeat(400_000)];
      aggregateCandidate.candidateTasks = ["w".repeat(400_000)];
      aggregateOverflow = validateAgentIdeaCandidate(aggregateCandidate);
    } catch (error) {
      thrown = error;
    } finally {
      Object.defineProperty(String.prototype, Symbol.iterator, iteratorDescriptor);
    }

    assert.equal(thrown, undefined);
    assert.equal(largeIteratorCalls, 0);
    assert.equal(codeUnitOverflow.ok, false);
    assert.match(codeUnitOverflow.errors.join("\n"), /title must be at most 512 characters/u);
    for (const validation of [unreasonableTitle, aggregateOverflow]) {
      assert.deepEqual(validation, {
        ok: false,
        errors: ["Agent Idea Candidate exceeds the bounded public string budget."],
        warnings: [],
      });
    }

    const originalBufferFrom = Buffer.from;
    let oversizedEncodingCalls = 0;
    let evidenceValidation;
    let encodingThrow;
    try {
      Buffer.from = function boundedCandidateBufferFrom(value, ...args) {
        if (typeof value === "string" && value.length > 512) {
          oversizedEncodingCalls += 1;
          throw new Error("oversized-evidence-id-must-not-be-encoded");
        }
        return Reflect.apply(originalBufferFrom, this, [value, ...args]);
      };
      const oversizedEvidence = validCandidate();
      oversizedEvidence.evidenceIds = ["a".repeat(1000), "b".repeat(1000)];
      evidenceValidation = validateAgentIdeaCandidate(oversizedEvidence);
    } catch (error) {
      encodingThrow = error;
    } finally {
      Buffer.from = originalBufferFrom;
    }
    assert.equal(encodingThrow, undefined);
    assert.equal(oversizedEncodingCalls, 0);
    assert.match(evidenceValidation.errors.join("\n"), /evidenceIds\[0\] must be at most 256/u);

    const maximum = validCandidate();
    maximum.title = "😀".repeat(512);
    maximum.targetUsers = Array.from({ length: 64 }, () => "😀".repeat(1024));
    maximum.candidateTasks = Array.from({ length: 64 }, () => "😀".repeat(2048));
    maximum.valueHypothesis = "😀".repeat(4096);
    maximum.evidenceIds = Array.from(
      { length: 256 },
      (_, index) => `id-${String(index).padStart(3, "0")}-${"😀".repeat(249)}`,
    );
    maximum.evidenceGaps = Array.from({ length: 64 }, () => "😀".repeat(2048));
    maximum.judgmentBoundaries = Array.from({ length: 64 }, () => "😀".repeat(2048));
    assert.equal(validateAgentIdeaCandidate(maximum).ok, true);
  });

  it("uses only dense own array data when inherited methods or indices are hostile", () => {
    const methodNames = ["entries", "some", "every"];
    const methodDescriptors = new Map(methodNames.map((name) => [
      name,
      Object.getOwnPropertyDescriptor(Array.prototype, name),
    ]));
    const polluted = validCandidate();
    polluted.evidenceIds = ["\ud800"];
    let pollutedValidation;
    try {
      Object.defineProperty(Array.prototype, "entries", {
        ...methodDescriptors.get("entries"),
        value() {
          return {
            next() { return { done: true }; },
            [Symbol.iterator]() { return this; },
          };
        },
      });
      Object.defineProperty(Array.prototype, "some", {
        ...methodDescriptors.get("some"),
        value() { return false; },
      });
      Object.defineProperty(Array.prototype, "every", {
        ...methodDescriptors.get("every"),
        value() { return true; },
      });
      pollutedValidation = validateAgentIdeaCandidate(polluted, discoveryContext());
    } finally {
      for (const name of methodNames) {
        Object.defineProperty(Array.prototype, name, methodDescriptors.get(name));
      }
    }
    assert.equal(pollutedValidation.ok, false);
    assert.match(pollutedValidation.errors.join("\n"), /invalid Unicode scalar value/u);

    const sparse = validCandidate();
    sparse.evidenceIds = Array.from({ length: 256 }, (_, index) => `fact:${index}`);
    delete sparse.evidenceIds[255];
    const inheritedDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "255");
    let inheritedGetterCalls = 0;
    let sparseValidation;
    try {
      Object.defineProperty(Array.prototype, "255", {
        configurable: true,
        get() {
          inheritedGetterCalls += 1;
          return "fact:inherited-canary";
        },
      });
      sparseValidation = validateAgentIdeaCandidate(sparse, discoveryContext());
    } finally {
      if (inheritedDescriptor === undefined) delete Array.prototype[255];
      else Object.defineProperty(Array.prototype, "255", inheritedDescriptor);
    }
    assert.equal(sparseValidation.ok, false);
    assert.equal(inheritedGetterCalls, 0);
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
