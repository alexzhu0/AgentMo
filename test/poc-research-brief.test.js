import assert from "node:assert/strict";
import { describe, it } from "node:test";

const briefModule = await import("../src/poc-research-brief.js").catch(() => ({}));

function record(overrides = {}) {
  return {
    schemaVersion: "agentmo.poc-research-record.v1",
    id: "official-record-1",
    sourceId: "openclaw-releases",
    title: "OpenClaw release note",
    url: "https://github.com/openclaw/openclaw/releases/tag/v1",
    publishedAt: "2026-08-05T00:00:00.000Z",
    collectedAt: "2026-08-05T02:00:00.000Z",
    sourceRole: "first-party",
    trustTier: "first-party",
    domains: ["ai-capability"],
    scenarios: ["knowledge-documents"],
    factClass: "fact",
    summary: "A bounded release note.",
    contentDigest: `sha256:${"a".repeat(64)}`,
    evidenceIds: [],
    ...overrides,
  };
}

function db(records) {
  return {
    schemaVersion: "agentmo.poc-research-db.v1",
    agentId: "white-collar-research-poc",
    records,
    sourceIndex: [],
    entityIndex: [],
    scenarioIndex: [],
  };
}

describe("white-collar Research DB daily brief", () => {
  it("projects collected evidence into a scenario signal and a cited hypothesis", () => {
    const brief = briefModule.buildResearchDailyBrief({
      db: db([record()]),
      date: "2026-08-05",
      timezone: "Asia/Shanghai",
    });

    assert.equal(brief.scenarioSignals[0].scenario, "knowledge-documents");
    assert.deepEqual(brief.scenarioSignals[0].evidenceIds, ["official-record-1"]);
    assert.equal(brief.hypotheses[0].factClass, "agent_hypothesis");
    assert.deepEqual(brief.hypotheses[0].evidenceIds, ["official-record-1"]);
    assert.equal(brief.hypotheses[0].confidence, "medium");
  });

  it("keeps community-only evidence labelled and records empty scenarios as gaps", () => {
    const brief = briefModule.buildResearchDailyBrief({
      db: db([record({
        id: "community-record-1",
        sourceId: "aihot-selected",
        sourceRole: "curated",
        trustTier: "community",
        factClass: "community_signal",
        scenarios: ["meetings-collaboration"],
        contentDigest: `sha256:${"b".repeat(64)}`,
      })]),
      date: "2026-08-05",
      timezone: "Asia/Shanghai",
    });

    assert.equal(brief.newEvidence[0].factClass, "community_signal");
    assert.equal(brief.hypotheses[0].confidence, "low");
    assert.match(briefModule.renderResearchDailyBriefMarkdown(brief), /Evidence gap/u);
    assert.match(briefModule.renderResearchDailyBriefMarkdown(brief), /data-analysis-decision/u);
  });

  it("does not turn a record collected on a different Shanghai day into evidence", () => {
    const brief = briefModule.buildResearchDailyBrief({
      db: db([record({ collectedAt: "2026-08-04T15:59:59.000Z" })]),
      date: "2026-08-05",
      timezone: "Asia/Shanghai",
    });

    assert.deepEqual(brief.newEvidence, []);
    assert.deepEqual(brief.hypotheses, []);
    assert.equal(brief.gaps.length, 3);
  });
});
