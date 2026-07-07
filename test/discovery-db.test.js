import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildDiscoveryPack, DISCOVERY_COVERAGE_FILENAME, DISCOVERY_DB_FILENAME, DISCOVERY_FACTS_FILENAME, writeDiscoveryPack } from "../src/discovery-db.js";

async function loadSupportDiscovery() {
  return JSON.parse(await readFile(new URL("../examples/support-triage.discovery.json", import.meta.url), "utf8"));
}

describe("discovery db", () => {
  it("materializes a sanitized discovery pack", async () => {
    const manifest = await loadSupportDiscovery();
    const pack = buildDiscoveryPack(manifest, { manifestPath: "examples/support-triage.discovery.json" });
    assert.equal(pack.ok, true);
    assert.equal(pack.discoveryDb.schemaVersion, "agentmo.discovery-db.v1");
    assert.equal(pack.discoveryDb.agentId, "support-triage");
    assert.equal(pack.discoveryDb.coverage.sourceCount, 3);
    assert.equal(pack.discoveryDb.coverage.factCount, 9);
    assert.match(pack.factsJsonl, /support-policy-handbook:field:01/u);

    const out = await mkdtemp(path.join(tmpdir(), "agentmo-discovery-pack-"));
    const paths = await writeDiscoveryPack(out, pack);
    assert.equal(paths.discoveryDbPath, path.join(out, DISCOVERY_DB_FILENAME));
    assert.equal(paths.factsPath, path.join(out, DISCOVERY_FACTS_FILENAME));
    assert.equal(paths.coveragePath, path.join(out, DISCOVERY_COVERAGE_FILENAME));
    const saved = JSON.parse(await readFile(paths.discoveryDbPath, "utf8"));
    const coverage = JSON.parse(await readFile(paths.coveragePath, "utf8"));
    assert.equal(saved.safety.rawSecretsStored, false);
    assert.equal(coverage.trustLevels.verified, 1);
  });

  it("redacts secret-like source strings but fails closed on secret-like input", async () => {
    const manifest = await loadSupportDiscovery();
    manifest.source_inventory[0].description = "api_key=secret-value-123456 should not persist";
    const pack = buildDiscoveryPack(manifest);
    assert.equal(pack.ok, false);
    assert.equal(pack.checks.find((check) => check.id === "input_redaction").pass, false);
    assert.equal(pack.discoveryDb.safety.redactedInputStringCount > 0, true);
    assert.equal(JSON.stringify(pack.discoveryDb).includes("secret-value-123456"), false);
    assert.equal(JSON.stringify(pack.discoveryDb).includes("[REDACTED_SECRET]"), true);
  });
});
