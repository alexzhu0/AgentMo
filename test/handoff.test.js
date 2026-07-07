import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { draftBlueprint } from "../src/blueprint-draft.js";
import { buildDiscoveryDb } from "../src/discovery-db.js";
import { buildHandoffPackage, writeHandoffPackage } from "../src/handoff.js";

async function supportBlueprint() {
  const manifest = JSON.parse(await readFile(new URL("../examples/support-triage.discovery.json", import.meta.url), "utf8"));
  const need = JSON.parse(await readFile(new URL("../examples/support-triage.need.json", import.meta.url), "utf8"));
  return draftBlueprint(buildDiscoveryDb(manifest), need, { target: "openclaw" });
}

describe("handoff", () => {
  it("writes a bounded implementation handoff package", async () => {
    const blueprint = await supportBlueprint();
    const handoffPackage = buildHandoffPackage(blueprint, { target: "openclaw" });
    assert.equal(handoffPackage.ok, true);
    assert.equal(handoffPackage.handoff.certificationBoundary.handoffCertifiesRuntime, false);
    assert.equal(handoffPackage.handoff.commands.some((command) => command.includes("birth-report")), true);

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
    assert.match(await readFile(path.join(out, "EVIDENCE_REQUIREMENTS.md"), "utf8"), /No credential values/u);
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
});
