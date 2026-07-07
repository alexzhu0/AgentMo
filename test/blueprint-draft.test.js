import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateBlueprint } from "../src/blueprint.js";
import { draftBlueprint, writeBlueprintDraft } from "../src/blueprint-draft.js";
import { buildDiscoveryDb } from "../src/discovery-db.js";

async function loadJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

describe("blueprint draft", () => {
  it("drafts a valid blueprint from discovery db plus user need", async () => {
    const manifest = await loadJson(new URL("../examples/support-triage.discovery.json", import.meta.url));
    const need = await loadJson(new URL("../examples/support-triage.need.json", import.meta.url));
    const discoveryDb = buildDiscoveryDb(manifest, { manifestPath: "examples/support-triage.discovery.json" });
    const blueprint = draftBlueprint(discoveryDb, need, { target: "openclaw" });
    const validation = validateBlueprint(blueprint);
    assert.equal(validation.ok, true, validation.errors.join("\n"));
    assert.equal(blueprint.agent_id, "support-triage");
    assert.equal(blueprint.runtime, "openclaw");
    assert.equal(blueprint.status, "draft");
    assert.equal(blueprint.tools.length, 3);
    assert.equal(blueprint.pipeline.discover.data_sources.length, 3);

    const dir = await mkdtemp(path.join(tmpdir(), "agentmo-blueprint-draft-"));
    const file = await writeBlueprintDraft(path.join(dir, "support-triage.agentmo.json"), blueprint);
    const saved = JSON.parse(await readFile(file, "utf8"));
    assert.equal(saved.agent_id, "support-triage");
  });

  it("rejects mismatched discovery and need agent ids", async () => {
    const manifest = await loadJson(new URL("../examples/support-triage.discovery.json", import.meta.url));
    const need = await loadJson(new URL("../examples/support-triage.need.json", import.meta.url));
    need.agent_id = "other-agent";
    const discoveryDb = buildDiscoveryDb(manifest);
    assert.throws(() => draftBlueprint(discoveryDb, need, { target: "openclaw" }), /does not match user-need/u);
  });
});
