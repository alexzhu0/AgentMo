import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { digestRawBytes, loadAdmittedArtifact } from "../src/artifact-admission.js";
import {
  buildAgentMoReport,
  formatAgentMoReport,
  validateAgentMoReport,
  validateReportArtifact,
} from "../src/report.js";
import { admitBlueprint } from "./helpers/admitted-blueprint.js";

const WIN9_BLUEPRINT = new URL("../examples/win9.agentmo.json", import.meta.url);
const WIN9_DISCOVERY = new URL("../examples/win9.discovery.json", import.meta.url);
const SUPPORT_DISCOVERY = new URL("../examples/support-triage.discovery.json", import.meta.url);

async function admitDiscoveryManifest(file = WIN9_DISCOVERY) {
  const bytes = await readFile(file);
  return loadAdmittedArtifact({
    filePath: file,
    subject: "discovery-manifest",
    expectedDigest: digestRawBytes(bytes),
  });
}

async function buildWin9Report(options = {}) {
  const blueprintAdmission = await admitBlueprint(WIN9_BLUEPRINT);
  const admissions = { blueprint: blueprintAdmission };
  const reportOptions = { admissions };
  let discoveryAdmission = null;
  if (options.discoveryManifest !== undefined) {
    discoveryAdmission = await admitDiscoveryManifest(options.discoveryManifest);
    admissions.discoveryManifest = discoveryAdmission;
    reportOptions.discoveryManifest = discoveryAdmission.value;
  }
  const report = await buildAgentMoReport(blueprintAdmission.value, reportOptions);
  return { blueprintAdmission, discoveryAdmission, report };
}

function assertNoAbsoluteLocalPaths(value, pointer = "$") {
  if (typeof value === "string") {
    assert.equal(path.posix.isAbsolute(value), false, `${pointer} must not contain a POSIX host path`);
    assert.equal(path.win32.isAbsolute(value), false, `${pointer} must not contain a Windows host path`);
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) assertNoAbsoluteLocalPaths(item, `${pointer}[${index}]`);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) assertNoAbsoluteLocalPaths(item, `${pointer}.${key}`);
  }
}

function syntheticLegacyReport() {
  return {
    kind: "agentmother_report",
    version: "0.1",
    ok: true,
    summary: { ok: true },
    lifecycle: { stage: "certify", reason: "synthetic migration fixture" },
    gates: {
      passed: 1,
      failed: 0,
      items: [{ id: "legacy_gate", label: "Legacy gate", status: "pass" }],
    },
    release_readiness: { status: "not_ready", reason: "synthetic migration fixture" },
    runtime_certification: [],
    discovery: { loaded: false },
    warnings: [],
    errors: [],
  };
}

describe("AgentMo report", () => {
  it("builds a persistable report from authentic blueprint admission without promoting readiness", async () => {
    const { blueprintAdmission, report } = await buildWin9Report();

    assert.equal(report.kind, "agentmo_report");
    assert.equal(report.ok, true);
    assert.deepEqual(report.sources.blueprint, {
      identity: "0.1",
      subject: "blueprint",
      digest: blueprintAdmission.digest,
    });
    assert.equal(report.sources.discoveryManifest, null);
    assert.equal(report.produceMaturity.stage, "certify");
    assert.equal("lifecycle" in report, false);
    assert.deepEqual(report.releaseReadiness, {
      status: "not_evaluated",
      reason: "Blueprint validation does not establish delivery or production approval.",
      productionApproved: false,
    });
    assert.deepEqual(report.evidenceLevels, {
      declaredReady: false,
      liveSuccess: false,
      domainCertified: false,
      deliveryReady: false,
      productionApproved: false,
    });
    assert.deepEqual(report.certificationBoundary, {
      runtimeCertifiedByReport: false,
      domainCertifiedByReport: false,
      deliveryReadyByReport: false,
      productionApprovedByReport: false,
    });
    assert.equal(report.runtimeCertification.every((profile) => profile.certifiesRuntime === false), true);
    assert.deepEqual(report.discovery, {
      declared: true,
      supplied: false,
      ok: null,
      sourceCount: 0,
      sourceTypes: [],
      agentIdMatch: null,
    });
    assert.deepEqual(validateReportArtifact(report), { ok: true, errors: [] });
    assertNoAbsoluteLocalPaths(report);
  });

  it("summarizes an optional discovery manifest only through its exact admission", async () => {
    const { discoveryAdmission, report } = await buildWin9Report({ discoveryManifest: WIN9_DISCOVERY });

    assert.deepEqual(report.sources.discoveryManifest, {
      identity: "agentmo.discovery.v1",
      subject: "discovery-manifest",
      digest: discoveryAdmission.digest,
    });
    assert.deepEqual(report.discovery, {
      declared: true,
      supplied: true,
      ok: true,
      sourceCount: 3,
      sourceTypes: ["database", "document", "manual_inventory"],
      agentIdMatch: true,
    });
    assert.equal(report.ok, true);
    assert.deepEqual(validateReportArtifact(report), { ok: true, errors: [] });
    assertNoAbsoluteLocalPaths(report);
  });

  it("revalidates optional discovery scope instead of trusting admitted shape alone", async () => {
    const { report } = await buildWin9Report({ discoveryManifest: SUPPORT_DISCOVERY });

    assert.equal(report.ok, false);
    assert.equal(report.discovery.ok, false);
    assert.equal(report.discovery.agentIdMatch, false);
    assert.equal(report.errors.includes("Discovery manifest agent id does not match the blueprint."), true);
    assert.deepEqual(validateReportArtifact(report), { ok: true, errors: [] });
    assertNoAbsoluteLocalPaths(report);
  });

  it("validates a separate synthetic legacy writer shape and rejects missing maturity", () => {
    const legacy = syntheticLegacyReport();
    assert.deepEqual(validateAgentMoReport(legacy, { legacy: true }), { ok: true, errors: [] });

    const missingMaturity = structuredClone(legacy);
    delete missingMaturity.lifecycle;
    assert.equal(validateAgentMoReport(missingMaturity, { legacy: true }).ok, false);
  });

  it("formats a readable bounded report", async () => {
    const { report } = await buildWin9Report({ discoveryManifest: WIN9_DISCOVERY });
    const text = formatAgentMoReport(report);

    assert.match(text, /AgentMo report: win9/u);
    assert.match(text, /Produce maturity: certify/u);
    assert.doesNotMatch(text, /AgentMother|agentmother|Lifecycle:/u);
    assert.match(text, /Runtime profiles: pi, openclaw/u);
    assert.match(text, /Runtime evidence disclosure:/u);
    assert.match(text, /openclaw: evidence_disclosed; certifies runtime: no/u);
    assert.match(text, /Discovery:/u);
    assert.match(text, /supplied: yes; sources: 3/u);
    assert.match(text, /Pipeline: discover -> plan -> produce/u);
    assert.match(text, /Quality gates: 8 passed, 0 failed/u);
    assert.match(text, /Release readiness: not_evaluated/u);
  });

  it("reports disclosure gaps without claiming runtime certification", async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-report-test-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const variant = JSON.parse(await readFile(WIN9_BLUEPRINT, "utf8"));
    delete variant.runtime_profiles[1].verification_commands;
    const variantPath = path.join(root, "win9.agentmo.json");
    await writeFile(variantPath, `${JSON.stringify(variant, null, 2)}\n`, "utf8");
    const blueprintAdmission = await admitBlueprint(variantPath);

    const report = await buildAgentMoReport(blueprintAdmission.value, {
      admissions: { blueprint: blueprintAdmission },
    });
    const openclaw = report.runtimeCertification.find((profile) => profile.id === "openclaw");
    assert.equal(openclaw.evidenceDisclosure, "needs_disclosure");
    assert.equal(openclaw.certifiesRuntime, false);
    assert.equal(
      report.warnings.some((warning) => warning.includes("(openclaw) is active but lacks verification_commands")),
      true,
    );
    assert.equal(report.summary.runtime, "pi");
    assert.equal(report.releaseReadiness.productionApproved, false);
    assert.equal(report.evidenceLevels.productionApproved, false);
    assert.deepEqual(validateReportArtifact(report), { ok: true, errors: [] });
    assertNoAbsoluteLocalPaths(report);
  });
});
