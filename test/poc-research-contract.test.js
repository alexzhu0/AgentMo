import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const contract = await import("../src/poc-research-contract.js").catch(() => ({}));

function sourceRegistry() {
  return {
    schemaVersion: "agentmo.poc-research-sources.v1",
    agentId: "white-collar-research-poc",
    sources: [{
      id: "aihot-selected",
      adapter: "aihot-v1",
      origin: "https://aihot.virxact.com",
      pathPrefix: "/api/v1/items",
      requestPath: "/api/v1/items?mode=selected&window=24h&limit=10",
      sourceRole: "curated",
      trustTier: "community",
      domains: ["ai-capability", "white-collar-needs"],
      scenarios: ["knowledge-documents", "meetings-collaboration"],
    }],
    skillCandidates: [{
      id: "last30days-skill",
      origin: "https://github.com/mvanhorn/last30days-skill",
      admission: "review-required",
    }],
  };
}

function researchRecord() {
  return {
    schemaVersion: "agentmo.poc-research-record.v1",
    id: "aihot-memory-20260805",
    sourceId: "aihot-selected",
    title: "Agent memory update",
    url: "https://aihot.virxact.com/news/agent-memory",
    publishedAt: "2026-08-05T00:00:00.000Z",
    collectedAt: "2026-08-05T00:00:00.000Z",
    sourceRole: "curated",
    trustTier: "community",
    domains: ["ai-capability"],
    scenarios: ["knowledge-documents"],
    factClass: "community_signal",
    summary: "A bounded summary.",
    contentDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    evidenceIds: [],
  };
}

describe("white-collar Research DB contracts", () => {
  it("admits a closed AI HOT source registry and a labelled community signal", () => {
    assert.equal(contract.validateResearchSourceRegistry(sourceRegistry()).ok, true);
    assert.equal(contract.validateResearchRecord(researchRecord()).ok, true);
  });

  it("rejects origins outside the source adapter allowlist", () => {
    const registry = sourceRegistry();
    registry.sources[0].origin = "https://evil.example";
    assert.equal(contract.validateResearchSourceRegistry(registry).ok, false);
  });

  it("requires hypotheses to cite retained evidence", () => {
    const hypothesis = { ...researchRecord(), factClass: "agent_hypothesis" };
    assert.equal(contract.validateResearchRecord(hypothesis).ok, false);
    assert.equal(contract.validateResearchRecord({ ...hypothesis, evidenceIds: ["aihot-memory-20260805"] }).ok, true);
  });

  it("rejects a credential-bearing research URL before canonicalization", () => {
    assert.throws(
      () => contract.canonicalResearchUrl("https://user:pass@aihot.virxact.com/api/v1/items"),
      { code: "AGENTMO_POC_RESEARCH_INPUT_INVALID" },
    );
  });

  it("ships a bounded white-collar source registry with an inert skill candidate", async () => {
    const registry = JSON.parse(await readFile(
      fileURLToPath(new URL("../examples/white-collar-research.sources.json", import.meta.url)),
      "utf8",
    ));
    assert.equal(contract.validateResearchSourceRegistry(registry).ok, true);
    assert.equal(registry.skillCandidates[0].admission, "review-required");
  });

  it("ships public POC seed and research sources for the same agent", async () => {
    const [seed, registry] = await Promise.all([
      readFile(fileURLToPath(new URL("../examples/ai-frontier-poc.seed.json", import.meta.url)), "utf8").then(JSON.parse),
      readFile(fileURLToPath(new URL("../examples/white-collar-research.sources.json", import.meta.url)), "utf8").then(JSON.parse),
    ]);
    assert.equal(registry.agentId, seed.agentId);
  });
});
