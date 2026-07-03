import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import { buildDiscoveryReport, validateDiscoveryManifest } from "../src/discovery.js";

async function loadExample() {
  return JSON.parse(await readFile(new URL("../examples/win9.discovery.json", import.meta.url), "utf8"));
}

describe("discovery manifest", () => {
  it("accepts and summarizes the Win9 discovery manifest", async () => {
    const manifest = await loadExample();
    const validation = validateDiscoveryManifest(manifest);
    assert.equal(validation.ok, true, validation.errors.join("\n"));

    const report = buildDiscoveryReport(manifest);
    assert.equal(report.kind, "agentmo_discovery_report");
    assert.equal(report.ok, true);
    assert.equal(report.summary.agent_id, "win9");
    assert.equal(report.summary.source_count, 3);
    assert.deepEqual(report.summary.source_types, ["database", "document", "manual_inventory"]);
    assert.deepEqual(report.summary.trust_levels, ["derived", "trusted", "verified"]);
  });

  it("rejects missing source id, source type, and trust level clearly", async () => {
    const manifest = await loadExample();
    delete manifest.source_inventory[0].id;
    delete manifest.source_inventory[0].type;
    delete manifest.source_inventory[0].trust_level;

    const result = validateDiscoveryManifest(manifest);
    assert.equal(result.ok, false);
    assert.equal(result.errors.some((error) => error.includes("source_inventory[0].id")), true);
    assert.equal(result.errors.some((error) => error.includes("source_inventory[0].type")), true);
    assert.equal(result.errors.some((error) => error.includes("source_inventory[0].trust_level")), true);
  });

  it("rejects unknown source types and malformed extraction fields", async () => {
    const manifest = await loadExample();
    manifest.source_inventory[0].type = "spreadsheet";
    manifest.source_inventory[0].extraction_fields = ["agent purpose", ""];

    const result = validateDiscoveryManifest(manifest);
    assert.equal(result.ok, false);
    assert.equal(result.errors.some((error) => error.includes("source_inventory[0].type must be one of")), true);
    assert.equal(result.errors.some((error) => error.includes("source_inventory[0].extraction_fields[1]")), true);
  });
});
