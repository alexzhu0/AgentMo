import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { writePocWorkspace } from "../src/poc-agent.js";

const researchWorkspace = await import("../src/poc-research-workspace.js").catch(() => ({}));

function seed() {
  return {
    schemaVersion: "agentmo.poc-seed.v1", agentId: "white-collar-research-poc",
    records: [{
      id: "seed-record", title: "Seed", url: "https://example.com/seed",
      publishedAt: "2026-08-05T00:00:00.000Z", collectedAt: "2026-08-05T00:00:00.000Z",
      category: "seed", sourceType: "paper", trustTier: "primary", summary: "Seed summary.",
    }],
  };
}

function record() {
  return {
    schemaVersion: "agentmo.poc-research-record.v1", id: "aihot-record-1", sourceId: "aihot-selected",
    title: "AI HOT record", url: "https://aihot.virxact.com/news/one",
    publishedAt: "2026-08-05T00:00:00.000Z", collectedAt: "2026-08-05T02:00:00.000Z",
    sourceRole: "curated", trustTier: "community", domains: ["ai-capability"],
    scenarios: ["knowledge-documents"], factClass: "community_signal", summary: "Bounded summary.",
    contentDigest: `sha256:${"a".repeat(64)}`, evidenceIds: [],
  };
}

describe("POC Research DB workspace persistence", () => {
  it("persists merged DB before ETag state so collection remains idempotent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-poc-research-workspace-"));
    const workspace = path.join(root, "workspace");
    await writePocWorkspace(seed(), workspace);

    const result = await researchWorkspace.persistResearchCollection(workspace, {
      records: [record()],
      state: { schemaVersion: "agentmo.poc-research-collection-state.v1", agentId: "white-collar-research-poc", sources: { "aihot-selected": { etag: '"v1"' } } },
    });

    assert.equal(result.recordCount, 1);
    assert.equal(JSON.parse(await readFile(path.join(workspace, "research/research-db.json"), "utf8")).records.length, 1);
    assert.equal(JSON.parse(await readFile(path.join(workspace, "research/collection-state.json"), "utf8")).sources["aihot-selected"].etag, '"v1"');
  });
});
