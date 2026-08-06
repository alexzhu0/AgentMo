import assert from "node:assert/strict";
import { describe, it } from "node:test";

const store = await import("../src/poc-research-store.js").catch(() => ({}));

function record(overrides = {}) {
  return {
    schemaVersion: "agentmo.poc-research-record.v1",
    id: "aihot-memory-20260805",
    sourceId: "aihot-selected",
    title: "Agent memory update",
    url: "https://aihot.virxact.com/news/agent-memory",
    publishedAt: "2026-08-05T00:00:00.000Z",
    collectedAt: "2026-08-05T02:00:00.000Z",
    sourceRole: "curated",
    trustTier: "community",
    domains: ["ai-capability"],
    scenarios: ["knowledge-documents"],
    factClass: "community_signal",
    summary: "A bounded summary.",
    contentDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    evidenceIds: [],
    ...overrides,
  };
}

describe("white-collar Research DB store", () => {
  it("keeps one record when a later collection repeats its canonical URL", () => {
    const first = store.mergeResearchDb({
      previousDb: store.createEmptyResearchDb("white-collar-research-poc"),
      collection: { records: [record()] },
    });
    const repeated = store.mergeResearchDb({
      previousDb: first,
      collection: { records: [record({ id: "aihot-memory-repeat", collectedAt: "2026-08-06T02:00:00.000Z" })] },
    });

    assert.equal(repeated.records.length, 1);
    assert.deepEqual(repeated.scenarioIndex, [{ scenario: "knowledge-documents", recordIds: ["aihot-memory-20260805"] }]);
  });

  it("keeps one record when two registered sources emit the same content digest", () => {
    const db = store.mergeResearchDb({
      previousDb: store.createEmptyResearchDb("white-collar-research-poc"),
      collection: { records: [record(), record({ id: "github-memory-20260805", sourceId: "github-openclaw-releases", url: "https://github.com/openclaw/openclaw/releases/tag/v1" })] },
    });

    assert.equal(db.records.length, 1);
    assert.deepEqual(db.sourceIndex, [{ sourceId: "aihot-selected", recordIds: ["aihot-memory-20260805"] }]);
  });

  it("rejects a DB whose secondary index no longer matches the retained records", () => {
    const db = store.mergeResearchDb({
      previousDb: store.createEmptyResearchDb("white-collar-research-poc"),
      collection: { records: [record()] },
    });
    assert.equal(store.validateResearchDb({ ...db, sourceIndex: [] }).ok, false);
  });
});
