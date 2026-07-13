import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { digestRawBytes } from "../src/artifact-admission.js";
import {
  buildObservationReport,
  loadObservationRecord,
  validateObservationRecord,
} from "../src/observation.js";

function safeSummary(text = "") {
  return {
    kind: "RedactedSummary",
    summaryKind: text.length === 0 ? "empty" : "structured-json-summary",
    sha256: createHash("sha256").update(text).digest("hex"),
    length: Buffer.byteLength(text),
    redactedLength: Buffer.byteLength(text),
    text,
    redacted: true,
  };
}

function observationFixture() {
  return {
    schemaVersion: "agentmo.observation.v1",
    agentId: "win9",
    source: {
      identity: "agentmo.run.v1",
      subject: "run-state",
      digest: `sha256:${"a".repeat(64)}`,
    },
    failureMode: "openclaw runtime execution is declared but not live-verified",
    proposedRegression: {
      id: "win9-declared-runtime-evidence",
      description: "Preserve declared runtime evidence coverage.",
      expectedEvidence: "A bounded reviewed runtime evidence result.",
    },
    recommendedBlueprintChange: {
      section: "runtime_profiles",
      proposal: "Review the admitted evidence before proposing any governed change.",
    },
    status: "proposed",
    runEvidence: {
      runId: "declared-run",
      parentRunId: null,
      targetId: "openclaw",
      runtime: "openclaw",
      provider: null,
      model: null,
      channel: "local-cli",
      transport: "local",
      fallbackFrom: null,
      executionStatus: "declared",
      exitCode: null,
      timedOut: false,
      replayFidelity: "unavailable",
      stdoutSummary: safeSummary(),
      stderrSummary: safeSummary(),
      certificationBoundary: {
        runtimeCertifiedByRun: false,
        domainCertifiedByRun: false,
      },
    },
    mutation: {
      autoApplied: false,
      blueprintMutated: false,
      scaffoldMutated: false,
      runtimeMutated: false,
      evalsMutated: false,
      reason: "Observation evidence is proposal-only.",
    },
  };
}

describe("observation records", () => {
  it("accepts only the exact safe proposal shape", () => {
    const observation = observationFixture();
    const result = validateObservationRecord(observation);
    assert.equal(result.ok, true, result.errors.join("\n"));

    const report = buildObservationReport(observation);
    assert.equal(report.schemaVersion, "agentmo.observation-report.v1");
    assert.equal(report.ok, true);
    assert.equal(report.summary.agentId, "win9");
    assert.equal(report.summary.evidenceRefCount, 1);
    assert.equal(report.summary.source.subject, "run-state");
    assert.equal(report.recommendedBlueprintChange.proposalOnly, true);
    assert.equal(report.mutation.autoApplied, false);
  });

  it("rejects incomplete, path-bearing, and self-mutating proposals", () => {
    const base = observationFixture();
    const cases = [
      { ...base, source: undefined },
      { ...base, failureMode: undefined },
      { ...base, extra: true },
      { ...base, recommendedBlueprintChange: { section: "runtime_profiles", proposal: "/Users/private/change.json" } },
      { ...base, mutation: { ...base.mutation, blueprintMutated: true } },
    ];
    for (const observation of cases) {
      const result = validateObservationRecord(observation);
      assert.equal(result.ok, false);
    }
  });

  it("loads only exact admitted observation bytes and rejects legacy or unknown shapes", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "agentmo-observation-loader-"));
    const file = path.join(directory, "observation.json");
    const bytes = Buffer.from(`${JSON.stringify(observationFixture(), null, 2)}\n`, "utf8");
    await writeFile(file, bytes);
    const admission = await loadObservationRecord(file, {
      subject: "observation",
      expectedDigest: digestRawBytes(bytes),
      returnAdmission: true,
    });
    assert.equal(admission.identity, "agentmo.observation.v1");
    assert.equal(admission.value.source.subject, "run-state");

    await writeFile(file, Buffer.concat([bytes, Buffer.from(" ")]));
    await assert.rejects(
      loadObservationRecord(file, { subject: "observation", expectedDigest: admission.digest }),
      (error) => error.code === "AGENTMO_ARTIFACT_DIGEST_MISMATCH",
    );
    const legacyBytes = await readFile(new URL("../examples/win9.observation.json", import.meta.url));
    await writeFile(file, legacyBytes);
    await assert.rejects(
      loadObservationRecord(file, { subject: "observation", expectedDigest: digestRawBytes(legacyBytes) }),
      (error) => error.code === "AGENTMO_UNSUPPORTED_ARTIFACT",
    );
    const unknown = Buffer.from(`${JSON.stringify({ ...observationFixture(), schemaVersion: "agentmo.observation.unknown" })}\n`);
    await writeFile(file, unknown);
    await assert.rejects(
      loadObservationRecord(file, { subject: "observation", expectedDigest: digestRawBytes(unknown) }),
      (error) => error.code === "AGENTMO_UNSUPPORTED_ARTIFACT",
    );
  });

  it("builds a proposal-only report without mutating the admitted record", () => {
    const observation = observationFixture();
    const before = JSON.stringify(observation);
    const report = buildObservationReport(observation);

    assert.equal(JSON.stringify(observation), before);
    assert.equal(report.recommendedBlueprintChange.proposalOnly, true);
    assert.equal(report.mutation.autoApplied, false);
    assert.equal(report.mutation.blueprintMutated, false);
    assert.equal(report.mutation.scaffoldMutated, false);
    assert.equal(report.mutation.runtimeMutated, false);
    assert.equal(report.mutation.evalsMutated, false);
  });
});
