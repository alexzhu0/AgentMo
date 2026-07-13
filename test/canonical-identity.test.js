import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  AGENTMO_PRODUCT_NAME,
  BLUEPRINT_IDENTITY_FIELD,
  BLUEPRINT_SCHEMA_VERSION,
  CANONICAL_PIPELINE_PHASES,
  loadAdmittedBlueprint,
  validateBlueprint,
} from "../src/blueprint.js";
import { draftBlueprint } from "../src/blueprint-draft.js";
import { buildDiscoveryDb } from "../src/discovery-db.js";
import { buildPlan } from "../src/build-plan.js";
import { createBuildState } from "../src/build-state.js";
import { buildControlSnapshot } from "../src/control-snapshot.js";
import { buildHandoffPackage } from "../src/handoff.js";
import { buildAgentMoReport, formatAgentMoReport } from "../src/report.js";
import { buildTargetFiles } from "../src/scaffold-files.js";

const ACTIVE_BLUEPRINTS = [
  new URL("../examples/win9.agentmo.json", import.meta.url),
  new URL("../examples/support-triage.agentmo.json", import.meta.url),
];

const CANONICAL_DOC_PATHS = [
  "AGENTS.md",
  "README.md",
  "CONTRIBUTING.md",
  "docs/BLUEPRINT_SCHEMA.md",
  "docs/STAGE_CONTRACTS.md",
  "docs/LIFECYCLE.md",
  "docs/CONCEPT.md",
  "docs/QUALITY_GATES.md",
  "docs/DISCOVERY_MANIFEST.md",
  "docs/MVP_RUNBOOK.md",
  "docs/OMX_SESSION_MIGRATION.md",
  "docs/OPENCLAW_RUNTIME_NOTES.md",
  "docs/OBSERVE_EVOLVE.md",
  "docs/RUNTIME_EXECUTION.md",
  "docs/AGENT_BIRTH_GATE.md",
];

const LEGACY_SECTION_ALLOWLIST = new Map([
  ["docs/BLUEPRINT_SCHEMA.md", new Set(["Legacy migration context"])],
]);

const EVIDENCE_DOC_PATHS = [
  "docs/MVP_RUNBOOK.md",
  "docs/OPENCLAW_RUNTIME_NOTES.md",
  "docs/OBSERVE_EVOLVE.md",
  "docs/RUNTIME_EXECUTION.md",
  "docs/AGENT_BIRTH_GATE.md",
];

async function loadJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

async function loadProjectText(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

function splitMarkdownSections(text) {
  const sections = [];
  let current = { heading: null, content: "" };
  for (const line of text.split("\n")) {
    const heading = /^##\s+(.+?)\s*$/u.exec(line);
    if (heading) {
      sections.push(current);
      current = { heading: heading[1], content: `${line}\n` };
    } else {
      current.content += `${line}\n`;
    }
  }
  sections.push(current);
  return sections;
}

describe("canonical AgentMo identity", () => {
  it("defines one blueprint identity and exactly three top-level phases", () => {
    assert.equal(AGENTMO_PRODUCT_NAME, "AgentMo");
    assert.equal(BLUEPRINT_IDENTITY_FIELD, "agentmo_version");
    assert.equal(BLUEPRINT_SCHEMA_VERSION, "0.1");
    assert.deepEqual(CANONICAL_PIPELINE_PHASES, ["discover", "plan", "produce"]);
  });

  it("keeps active examples canonical without legacy identity or prose", async () => {
    for (const blueprintUrl of ACTIVE_BLUEPRINTS) {
      const text = await readFile(blueprintUrl, "utf8");
      const blueprint = JSON.parse(text);

      assert.equal(blueprint[BLUEPRINT_IDENTITY_FIELD], BLUEPRINT_SCHEMA_VERSION);
      assert.equal("agentmother_version" in blueprint, false);
      assert.deepEqual(Object.keys(blueprint.pipeline), CANONICAL_PIPELINE_PHASES);
      assert.doesNotMatch(text, /AgentMother|agentmother/u);

      const validation = validateBlueprint(blueprint);
      assert.equal(validation.ok, true, validation.errors.join("\n"));
    }
  });

  it("rejects a legacy identity at the canonical validator boundary", async () => {
    const canonical = await loadJson(ACTIVE_BLUEPRINTS[0]);
    const legacy = structuredClone(canonical);
    delete legacy.agentmo_version;
    legacy.agentmother_version = BLUEPRINT_SCHEMA_VERSION;

    const validation = validateBlueprint(legacy);
    assert.equal(validation.ok, false);
    assert.equal(validation.errors.includes("Missing required field: agentmo_version"), true);
    assert.equal(validation.errors.includes(`agentmo_version must be ${BLUEPRINT_SCHEMA_VERSION}`), true);
  });

  it("emits the canonical identity from blueprint drafting", async () => {
    const manifest = await loadJson(new URL("../examples/support-triage.discovery.json", import.meta.url));
    const need = await loadJson(new URL("../examples/support-triage.need.json", import.meta.url));
    const discoveryDb = buildDiscoveryDb(manifest, { manifestPath: "examples/support-triage.discovery.json" });
    const blueprint = draftBlueprint(discoveryDb, need, { target: "openclaw" });

    assert.equal(blueprint.agentmo_version, BLUEPRINT_SCHEMA_VERSION);
    assert.equal("agentmother_version" in blueprint, false);
    assert.deepEqual(Object.keys(blueprint.pipeline), CANONICAL_PIPELINE_PHASES);
  });

  it("uses AgentMo in the package identity", async () => {
    const packageJson = await loadJson(new URL("../package.json", import.meta.url));
    assert.match(packageJson.description, /AgentMo/u);
    assert.doesNotMatch(packageJson.description, /AgentMother|agentmother/u);
  });

  it("keeps current scaffold and handoff emitters canonical and Produce-scoped", async () => {
    const blueprintBytes = await readFile(ACTIVE_BLUEPRINTS[0]);
    const admission = await loadAdmittedBlueprint(ACTIVE_BLUEPRINTS[0], {
      subject: "blueprint",
      expectedDigest: `sha256:${createHash("sha256").update(blueprintBytes).digest("hex")}`,
    });
    const blueprint = admission.value;
    const scaffoldFiles = buildTargetFiles(blueprint, "openclaw");
    for (const [relativePath, content] of scaffoldFiles) {
      assert.doesNotMatch(content, /AgentMother|agentmother/u, relativePath);
    }
    const runbook = scaffoldFiles.get("openclaw/RUNBOOK.md");
    assert.match(runbook, /--digest "blueprint=\$\(node -e/u);
    assert.match(runbook, /--digest "runtime-plan=\$\(node -e/u);
    assert.doesNotMatch(runbook, /--digest blueprint=sha256:/u);

    const handoff = await buildHandoffPackage(blueprint, { target: "openclaw", admission });
    assert.equal(handoff.ok, true);
    assert.equal(handoff.handoff.pipelineStage, "produce");
    assert.equal(handoff.files.some((file) => file.content.includes("Produce-internal")), true);
    assert.equal(handoff.handoff.commands.every((command) => (
      !command.startsWith("agentmo ") || command.includes('--digest "')
    )), true);
    assert.equal(handoff.handoff.commands.some((command) => command.includes(admission.digest)), false);
    for (const file of handoff.files) assert.doesNotMatch(file.content, /AgentMother|agentmother/u, file.relativePath);
  });

  it("keeps report, control, and build-state machine outputs canonical", async () => {
    const blueprintBytes = await readFile(ACTIVE_BLUEPRINTS[0]);
    const admission = await loadAdmittedBlueprint(ACTIVE_BLUEPRINTS[0], {
      subject: "blueprint",
      expectedDigest: `sha256:${createHash("sha256").update(blueprintBytes).digest("hex")}`,
    });
    const blueprint = admission.value;
    const report = await buildAgentMoReport(blueprint, { admissions: { blueprint: admission } });
    const control = buildControlSnapshot(blueprint);
    const plan = buildPlan(blueprint, { target: "agentmo" });
    const buildState = await createBuildState(blueprint, plan, {
      admission,
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    assert.equal(report.kind, "agentmo_report");
    assert.deepEqual(report.summary.pipelinePhases, CANONICAL_PIPELINE_PHASES);
    assert.equal(report.produceMaturity.stage, "certify");
    assert.equal("lifecycle" in report, false);
    assert.match(formatAgentMoReport(report), /^AgentMo report:/u);

    assert.deepEqual(control.pipeline.phases.map((phase) => phase.id), CANONICAL_PIPELINE_PHASES);
    assert.equal(control.produce_maturity.stage, "certify");
    assert.equal("lifecycle" in control, false);

    assert.deepEqual(buildState.source, {
      identity: BLUEPRINT_SCHEMA_VERSION,
      subject: "blueprint",
      digest: admission.digest,
    });
    assert.doesNotMatch(JSON.stringify({ report, control, buildState }), /AgentMother|agentmother/u);
  });

  it("keeps maintained documentation canonical with section-bounded legacy context", async () => {
    for (const path of CANONICAL_DOC_PATHS) {
      const text = await loadProjectText(path);
      assert.match(text, /AgentMo/u, `${path} must name the canonical product`);

      const allowedHeadings = LEGACY_SECTION_ALLOWLIST.get(path) ?? new Set();
      for (const section of splitMarkdownSections(text)) {
        if (section.heading !== null && allowedHeadings.has(section.heading)) continue;
        assert.doesNotMatch(section.content, /AgentMother|agentmother/u, `${path}#${section.heading ?? "preamble"}`);
      }
    }
  });

  it("documents the canonical blueprint identity and sole three-stage lifecycle", async () => {
    const blueprintSchema = await loadProjectText("docs/BLUEPRINT_SCHEMA.md");
    const stageContracts = await loadProjectText("docs/STAGE_CONTRACTS.md");
    const lifecycle = await loadProjectText("docs/LIFECYCLE.md");

    assert.match(blueprintSchema, /`agentmo_version`: must be `0\.1`/u);
    assert.match(stageContracts, /`agentmo_version: "0\.1"`/u);
    assert.match(lifecycle, /Discover -> Plan -> Produce/u);
    assert.deepEqual(
      [...lifecycle.matchAll(/^## (Discover|Plan|Produce)$/gmu)].map((match) => match[1]),
      ["Discover", "Plan", "Produce"],
    );
    assert.match(lifecycle, /`produce_maturity`/u);
    assert.doesNotMatch(lifecycle, /Discover -> Conceive|-> Reproduce/u);
  });

  it("documents Produce-internal gates and non-transitive evidence by exact path", async () => {
    for (const path of EVIDENCE_DOC_PATHS) {
      const text = await loadProjectText(path);
      assert.match(text, /Produce-internal/u, `${path} must scope evidence work inside Produce`);
      assert.match(text, /does not certify|do not certify|does not self-certify|non-self-certifying/iu, `${path} must reject self-certification`);
    }

    const observe = await loadProjectText("docs/OBSERVE_EVOLVE.md");
    assert.match(observe, /proposal-only/u);
    assert.match(observe, /must not mutate/u);

    const birth = await loadProjectText("docs/AGENT_BIRTH_GATE.md");
    assert.match(birth, /fail-closed/u);
    assert.match(birth, /declared-ready[^\n]+does not certify/iu);
    assert.match(birth, /live-success[^\n]+does not certify/iu);
  });
});
