import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { mkdtemp, open, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildDiscoveryReport,
  loadDiscoveryManifest,
  validateDiscoveryManifest,
} from "../src/discovery.js";
import { loadDiscoveryDb } from "../src/discovery-db.js";

const MANIFEST_URL = new URL("../examples/win9.discovery.json", import.meta.url);
const DISCOVERY_DB_URL = new URL("../examples/fixtures/support-triage/prebuilt-discovery-db.json", import.meta.url);

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function loadExample() {
  return JSON.parse(await readFile(MANIFEST_URL, "utf8"));
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

  it("accepts closed evidence classes and rejects unknown classifications", async () => {
    const manifest = await loadExample();
    manifest.source_inventory[0].evidence_class = "community";
    assert.equal(validateDiscoveryManifest(manifest).ok, true);

    manifest.source_inventory[0].evidence_class = "influencer";
    const result = validateDiscoveryManifest(manifest);
    assert.equal(result.ok, false);
    assert.equal(
      result.errors.some((error) => error.includes("source_inventory[0].evidence_class must be one of")),
      true,
    );
  });

  it("loads a discovery manifest once from exact subject-bound bytes", async () => {
    const bytes = await readFile(MANIFEST_URL);
    let openCount = 0;
    const manifest = await loadDiscoveryManifest(MANIFEST_URL, {
      subject: "discovery-manifest",
      expectedDigest: digest(bytes),
      openInput: async (...args) => {
        openCount += 1;
        return open(...args);
      },
    });
    assert.equal(manifest.schemaVersion, "agentmo.discovery.v1");
    assert.equal(openCount, 1);
  });

  it("keeps manifest and database loaders closed across family, digest, legacy, and unknown cases", async () => {
    const manifestBytes = await readFile(MANIFEST_URL);
    const dbBytes = await readFile(DISCOVERY_DB_URL);
    const cases = [
      {
        operation: () => loadDiscoveryManifest(DISCOVERY_DB_URL, {
          subject: "discovery-manifest",
          expectedDigest: digest(dbBytes),
        }),
        code: "AGENTMO_UNSUPPORTED_ARTIFACT",
      },
      {
        operation: () => loadDiscoveryDb(MANIFEST_URL, {
          subject: "discovery-db",
          expectedDigest: digest(manifestBytes),
        }),
        code: "AGENTMO_UNSUPPORTED_ARTIFACT",
      },
      {
        operation: () => loadDiscoveryManifest(MANIFEST_URL, {
          subject: "discovery-db",
          expectedDigest: digest(manifestBytes),
        }),
        code: "AGENTMO_UNSUPPORTED_ARTIFACT",
      },
      {
        operation: () => loadDiscoveryManifest(MANIFEST_URL, {
          subject: "discovery-manifest",
          expectedDigest: `sha256:${"0".repeat(64)}`,
        }),
        code: "AGENTMO_ARTIFACT_DIGEST_MISMATCH",
      },
    ];
    for (const testCase of cases) {
      await assert.rejects(testCase.operation, (error) => error.code === testCase.code);
    }

    const root = await mkdtemp(path.join(tmpdir(), "agentmo-discovery-loader-"));
    const unknownPath = path.join(root, "unknown.json");
    const unknownBytes = Buffer.from('{"schemaVersion":"agentmo.unknown.v1"}\n', "utf8");
    await writeFile(unknownPath, unknownBytes);
    await assert.rejects(
      () => loadDiscoveryManifest(unknownPath, {
        subject: "discovery-manifest",
        expectedDigest: digest(unknownBytes),
      }),
      (error) => error.code === "AGENTMO_UNSUPPORTED_ARTIFACT",
    );

    const legacyUrl = new URL("./fixtures/migration/legacy-blueprint.json", import.meta.url);
    const legacyBytes = await readFile(legacyUrl);
    await assert.rejects(
      () => loadDiscoveryManifest(legacyUrl, {
        subject: "discovery-manifest",
        expectedDigest: digest(legacyBytes),
      }),
      (error) => error.code === "AGENTMO_MIGRATION_REQUIRED",
    );
  });

  it("does not accept whitespace or key-order changes under an earlier digest", async () => {
    const canonicalBytes = await readFile(MANIFEST_URL);
    const canonical = JSON.parse(canonicalBytes.toString("utf8"));
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-discovery-bytes-"));
    const variants = [
      `${JSON.stringify(canonical)}\n`,
      `${JSON.stringify(canonical, null, 4)}\n`,
      `${canonicalBytes.toString("utf8")} `,
    ];
    for (const [index, text] of variants.entries()) {
      const file = path.join(root, `variant-${index}.json`);
      await writeFile(file, text, "utf8");
      await assert.rejects(
        () => loadDiscoveryManifest(file, {
          subject: "discovery-manifest",
          expectedDigest: digest(canonicalBytes),
        }),
        (error) => error.code === "AGENTMO_ARTIFACT_DIGEST_MISMATCH",
      );
    }
  });
});
