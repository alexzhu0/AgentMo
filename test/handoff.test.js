import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { draftBlueprint } from "../src/blueprint-draft.js";
import { buildDiscoveryDb } from "../src/discovery-db.js";
import { buildHandoffPackage, writeHandoffPackage } from "../src/handoff.js";

const CLI = fileURLToPath(new URL("../bin/agentmo.js", import.meta.url));
const SECRET_LIKE_REVIEW_REF = "sk-reviewrefsecret1234567890";

async function supportBlueprint() {
  const manifest = JSON.parse(await readFile(new URL("../examples/support-triage.discovery.json", import.meta.url), "utf8"));
  const need = JSON.parse(await readFile(new URL("../examples/support-triage.need.json", import.meta.url), "utf8"));
  return draftBlueprint(buildDiscoveryDb(manifest), need, { target: "openclaw" });
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

async function listDirectoryIfPresent(directory) {
  try {
    return await readdir(directory);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

describe("handoff", () => {
  it("writes a bounded implementation handoff package", async () => {
    const blueprint = await supportBlueprint();
    const handoffPackage = buildHandoffPackage(blueprint, { target: "openclaw" });
    assert.equal(handoffPackage.ok, true);
    assert.equal(handoffPackage.handoff.certificationBoundary.handoffCertifiesRuntime, false);
    assert.equal(handoffPackage.handoff.commands.some((command) => command.includes("birth-report")), true);
    assert.deepEqual(handoffPackage.handoff.requiredInputs, handoffPackage.handoff.stage3RequiredArtifacts);
    assert.equal(handoffPackage.handoff.requiredInputs.includes("validated blueprint/design contract"), true);
    assert.equal(handoffPackage.handoff.requiredInputs.includes("discovery pack"), false);
    assert.equal(handoffPackage.handoff.requiredInputs.includes("user-need report"), false);
    assert.equal(
      handoffPackage.handoff.provenanceReferences.includes("discovery pack (AgentMo-generated design review reference)"),
      true,
    );
    assert.equal(
      handoffPackage.handoff.provenanceReferences.includes("user-need report (AgentMo-generated design review reference)"),
      true,
    );

    const out = await mkdtemp(path.join(tmpdir(), "agentmo-handoff-"));
    const paths = await writeHandoffPackage(out, handoffPackage);
    assert.deepEqual(
      paths.files.map((file) => path.basename(file)).sort(),
      [
        "ACCEPTANCE_CRITERIA.md",
        "BUILD_TASKS.md",
        "EVIDENCE_REQUIREMENTS.md",
        "README.md",
        "ROLLBACK_PLAN.md",
        "RUNTIME_PLAN.md",
        "TEST_PLAN.md",
        "VERIFY.md",
        "agentmo-handoff.json",
      ],
    );
    const readme = await readFile(path.join(out, "README.md"), "utf8");
    assert.match(readme, /Runtime certification: not claimed/u);
    assert.match(await readFile(path.join(out, "ROLLBACK_PLAN.md"), "utf8"), /Do not promote runtime birth/u);
    const evidenceRequirements = await readFile(path.join(out, "EVIDENCE_REQUIREMENTS.md"), "utf8");
    assert.match(evidenceRequirements, /No credential values/u);
    assert.match(evidenceRequirements, /Stage 3 required inputs/u);
    assert.match(evidenceRequirements, /Provenance\/review references/u);
    const handoff = JSON.parse(await readFile(path.join(out, "agentmo-handoff.json"), "utf8"));
    assert.equal(handoff.schemaVersion, "agentmo.handoff.v1");
  });

  it("does not hardcode OpenClaw run commands for the AgentMo target", async () => {
    const blueprint = await supportBlueprint();
    const handoffPackage = buildHandoffPackage(blueprint, { target: "agentmo" });
    assert.equal(handoffPackage.ok, true);
    assert.equal(handoffPackage.handoff.commands.some((command) => command.includes("--target openclaw")), false);
    assert.equal(handoffPackage.handoff.commands.some((command) => command.includes("target-specific run-state and run-eval evidence")), true);
  });

  it("does not make discovery pack or user need mandatory for external-reviewed blueprints", async () => {
    const blueprint = await supportBlueprint();
    blueprint.design_contract = {
      provenance: {
        source: "external-reviewed",
        reviewed: true,
        review_ref: "reviews/support-triage-stage3-admission",
        contract_version: "agentmo.design-contract.v1",
        notes: "Externally reviewed support-triage design admitted to Stage 3 without Stage 1 or Stage 2 command ancestry.",
      },
    };
    const handoffPackage = buildHandoffPackage(blueprint, { target: "openclaw" });
    assert.equal(handoffPackage.ok, true);
    assert.equal(handoffPackage.handoff.requiredInputs.includes("discovery pack"), false);
    assert.equal(handoffPackage.handoff.requiredInputs.includes("user-need report"), false);
    assert.deepEqual(handoffPackage.handoff.provenanceReferences, [
      "design contract provenance: external-reviewed",
      "review reference: reviews/support-triage-stage3-admission",
    ]);
    const evidenceRequirements = handoffPackage.files.find((file) => file.relativePath === "EVIDENCE_REQUIREMENTS.md").content;
    assert.doesNotMatch(evidenceRequirements, /discovery pack/u);
    assert.doesNotMatch(evidenceRequirements, /user-need report/u);
    assert.match(evidenceRequirements, /not mandatory Stage 3 command ancestry/u);
  });

  it("fails closed without rendering provenance when design-contract provenance is invalid", async () => {
    const blueprint = await supportBlueprint();
    blueprint.design_contract.provenance.review_ref = SECRET_LIKE_REVIEW_REF;

    const handoffPackage = buildHandoffPackage(blueprint, { target: "openclaw" });

    assert.equal(handoffPackage.ok, false);
    assert.equal(
      handoffPackage.handoff.validation.errors.some((error) => error.includes("design_contract.provenance.review_ref")),
      true,
    );
    assert.deepEqual(handoffPackage.handoff.provenanceReferences, []);
    assert.deepEqual(handoffPackage.files, []);
    assert.equal(JSON.stringify(handoffPackage).includes(SECRET_LIKE_REVIEW_REF), false);

    const out = await mkdtemp(path.join(tmpdir(), "agentmo-invalid-handoff-"));
    const paths = await writeHandoffPackage(out, handoffPackage);
    assert.deepEqual(paths.files, []);
    assert.deepEqual(await listDirectoryIfPresent(out), []);
  });

  it("CLI handoff failure does not write or print secret-like provenance", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-invalid-handoff-cli-"));
    const blueprint = await supportBlueprint();
    blueprint.design_contract.provenance.review_ref = SECRET_LIKE_REVIEW_REF;
    const blueprintPath = path.join(root, "support-triage.agentmo.json");
    const handoffOut = path.join(root, "handoff");
    await writeFile(blueprintPath, `${JSON.stringify(blueprint, null, 2)}\n`, "utf8");

    const result = await runCli(["handoff", blueprintPath, "--target", "openclaw", "--out", handoffOut, "--json"]);

    assert.equal(result.code, 1);
    assert.equal(result.stdout.includes(SECRET_LIKE_REVIEW_REF), false);
    assert.equal(result.stderr.includes(SECRET_LIKE_REVIEW_REF), false);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, false);
    assert.deepEqual(parsed.handoff.provenanceReferences, []);
    assert.deepEqual(parsed.files, []);
    assert.deepEqual(parsed.paths.files, []);
    assert.deepEqual(await listDirectoryIfPresent(handoffOut), []);
  });
});
