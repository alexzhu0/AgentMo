import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  buildDiscoveryPack,
  DISCOVERY_COVERAGE_FILENAME,
  DISCOVERY_DB_FILENAME,
  DISCOVERY_FACTS_FILENAME,
  formatDiscoveryPack,
  writeDiscoveryPack,
} from "../src/discovery-db.js";
import { containsHostAbsolutePath, redactManagedText, REDACTED_PATH } from "../src/secret-redaction.js";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

async function loadSupportDiscovery() {
  return JSON.parse(await readFile(new URL("../examples/support-triage.discovery.json", import.meta.url), "utf8"));
}

function assertNoHostPaths(text, label, extraPath = null) {
  assert.equal(text.includes(REPO_ROOT), false, `${label} must not contain repo root ${REPO_ROOT}`);
  assert.equal(text.includes("/home/alex"), false, `${label} must not contain host-specific /home/alex paths`);
  if (extraPath) assert.equal(text.includes(extraPath), false, `${label} must not contain absolute path ${extraPath}`);
}

describe("discovery db", () => {
  it("redacts generic POSIX host absolute paths without treating ordinary URLs as host paths", () => {
    for (const hostPath of [
      "/etc/agentmo-secret-path",
      "/root/agentmo-secret-path",
      "/usr/local/agentmo-secret-path",
      "/home/alex/agentmo-secret-path",
      "/tmp/agentmo-secret-path",
    ]) {
      assert.equal(containsHostAbsolutePath(hostPath), true, `${hostPath} must be detected`);
      assert.equal(redactManagedText(hostPath), REDACTED_PATH, `${hostPath} must be redacted`);
    }

    const ordinaryUrl = "https://example.com/path";
    assert.equal(containsHostAbsolutePath(ordinaryUrl), false);
    assert.equal(redactManagedText(ordinaryUrl), ordinaryUrl);
  });

  it("materializes a sanitized discovery pack", async () => {
    const manifest = await loadSupportDiscovery();
    const pack = buildDiscoveryPack(manifest, { manifestPath: "examples/support-triage.discovery.json" });
    assert.equal(pack.ok, true);
    assert.equal(pack.discoveryDb.schemaVersion, "agentmo.discovery-db.v1");
    assert.equal(pack.discoveryDb.agentId, "support-triage");
    assert.equal(pack.discoveryDb.sourceManifest.path, "examples/support-triage.discovery.json");
    assert.equal(pack.discoveryDb.coverage.sourceCount, 3);
    assert.equal(pack.discoveryDb.coverage.factCount, 9);
    assert.match(pack.factsJsonl, /support-policy-handbook:field:01/u);

    const out = await mkdtemp(path.join(tmpdir(), "agentmo-discovery-pack-"));
    const paths = await writeDiscoveryPack(out, pack);
    assert.deepEqual(paths, {
      outDir: ".",
      discoveryDbPath: DISCOVERY_DB_FILENAME,
      factsPath: DISCOVERY_FACTS_FILENAME,
      coveragePath: DISCOVERY_COVERAGE_FILENAME,
    });
    const discoveryDbText = await readFile(path.join(out, paths.discoveryDbPath), "utf8");
    const factsText = await readFile(path.join(out, paths.factsPath), "utf8");
    const coverageText = await readFile(path.join(out, paths.coveragePath), "utf8");
    assertNoHostPaths(discoveryDbText, "discovery DB", out);
    assertNoHostPaths(factsText, "facts JSONL", out);
    assertNoHostPaths(coverageText, "coverage JSON", out);
    const saved = JSON.parse(discoveryDbText);
    const coverage = JSON.parse(coverageText);
    assert.equal(saved.safety.rawSecretsStored, false);
    assert.equal(coverage.trustLevels.verified, 1);
  });

  it("uses null manifest provenance for external manifest paths", async () => {
    const manifest = await loadSupportDiscovery();
    const externalManifestPath = path.join(tmpdir(), "external-support-triage.discovery.json");
    const pack = buildDiscoveryPack(manifest, { manifestPath: externalManifestPath });
    assert.equal(pack.discoveryDb.sourceManifest.path, null);
    assertNoHostPaths(JSON.stringify(pack.discoveryDb), "external manifest discovery DB", externalManifestPath);
  });

  it("normalizes absolute source inventory locations before writing DB refs", async () => {
    const repoRelativeSource = "examples/fixtures/support-triage/policy-handbook.md";
    const repoAbsoluteSource = path.join(REPO_ROOT, repoRelativeSource);
    const repoManifest = await loadSupportDiscovery();
    repoManifest.source_inventory = [
      {
        ...repoManifest.source_inventory[0],
        id: "repo-absolute-source",
        location: repoAbsoluteSource,
        extraction_fields: ["repo-local field"],
      },
    ];

    const repoPack = buildDiscoveryPack(repoManifest, { manifestPath: "examples/support-triage.discovery.json" });
    assert.equal(repoPack.ok, true);
    assert.equal(repoPack.discoveryDb.sources[0].location, repoRelativeSource);
    assert.deepEqual(repoPack.discoveryDb.facts[0].refs, [repoRelativeSource]);
    assertNoHostPaths(JSON.stringify(repoPack.discoveryDb), "repo-local absolute source discovery DB", repoAbsoluteSource);

    const externalRoot = await mkdtemp(path.join(tmpdir(), "agentmo-discovery-db-external-source-"));
    const externalSource = path.join(externalRoot, "source.md");
    const externalManifest = await loadSupportDiscovery();
    externalManifest.source_inventory = [
      {
        ...externalManifest.source_inventory[0],
        id: "external-absolute-source",
        location: externalSource,
        extraction_fields: ["external field"],
      },
    ];

    const externalPack = buildDiscoveryPack(externalManifest, { manifestPath: "examples/support-triage.discovery.json" });
    assert.equal(externalPack.ok, true);
    assert.equal(externalPack.discoveryDb.sources[0].location, null);
    assert.deepEqual(externalPack.discoveryDb.facts[0].refs, []);
    const serialized = JSON.stringify(externalPack);
    assertNoHostPaths(serialized, "external absolute source discovery pack", externalSource);
    assert.equal(serialized.includes(externalRoot), false, "external absolute source discovery pack must not contain external source root");
  });

  it("scrubs denied durable source inventory locations while preserving ordinary document paths and URLs", async () => {
    const manifest = await loadSupportDiscovery();
    const deniedLocations = [".env", ".env.local", "private.key", "credentials.json"];
    manifest.source_inventory = [
      ...deniedLocations.map((location, index) => ({
        id: `denied-location-${index + 1}`,
        type: "document",
        trust_level: "verified",
        description: `Denied location fixture ${index + 1}`,
        location,
        extraction_fields: [`Denied location field ${index + 1}`],
      })),
      {
        id: "ordinary-relative-doc",
        type: "document",
        trust_level: "verified",
        description: "Ordinary relative documentation path",
        location: "docs/policy.md",
        extraction_fields: ["Ordinary relative field"],
      },
      {
        id: "ordinary-url-doc",
        type: "document",
        trust_level: "verified",
        description: "Ordinary URL documentation path",
        location: "https://example.com/docs/policy",
        extraction_fields: ["Ordinary URL field"],
      },
    ];

    const pack = buildDiscoveryPack(manifest, { manifestPath: "examples/support-triage.discovery.json" });

    assert.equal(pack.ok, false);
    assert.equal(pack.checks.find((check) => check.id === "durable_source_location_policy")?.pass, false);
    assert.equal(pack.discoveryDb.safety.deniedSourceLocationCount, deniedLocations.length);
    for (const sourceId of ["denied-location-1", "denied-location-2", "denied-location-3", "denied-location-4"]) {
      const source = pack.discoveryDb.sources.find((item) => item.id === sourceId);
      assert.equal(source.location, null, `${sourceId} location must be scrubbed`);
      const facts = pack.discoveryDb.facts.filter((fact) => fact.sourceId === sourceId);
      assert.equal(facts.length, 1, `${sourceId} must keep its extraction fact`);
      assert.deepEqual(facts[0].refs, [], `${sourceId} fact refs must be empty`);
    }
    assert.equal(pack.discoveryDb.sources.find((source) => source.id === "ordinary-relative-doc").location, "docs/policy.md");
    assert.deepEqual(pack.discoveryDb.facts.find((fact) => fact.sourceId === "ordinary-relative-doc").refs, ["docs/policy.md"]);
    assert.equal(pack.discoveryDb.sources.find((source) => source.id === "ordinary-url-doc").location, "https://example.com/docs/policy");
    assert.deepEqual(pack.discoveryDb.facts.find((fact) => fact.sourceId === "ordinary-url-doc").refs, [
      "https://example.com/docs/policy",
    ]);

    const out = await mkdtemp(path.join(tmpdir(), "agentmo-discovery-denied-location-pack-"));
    const paths = await writeDiscoveryPack(out, pack);
    const stdoutText = `${JSON.stringify({ ...pack, paths }, null, 2)}\n${formatDiscoveryPack(pack, paths)}`;
    const discoveryDbText = await readFile(path.join(out, DISCOVERY_DB_FILENAME), "utf8");
    const factsText = await readFile(path.join(out, DISCOVERY_FACTS_FILENAME), "utf8");
    const coverageText = await readFile(path.join(out, DISCOVERY_COVERAGE_FILENAME), "utf8");
    for (const [label, text] of [
      ["discover-pack stdout", stdoutText],
      ["discovery DB", discoveryDbText],
      ["facts JSONL", factsText],
      ["coverage JSON", coverageText],
    ]) {
      for (const deniedLocation of deniedLocations) {
        assert.equal(text.includes(deniedLocation), false, `${label} must not contain denied location ${deniedLocation}`);
      }
    }
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
