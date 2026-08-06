import assert from "node:assert/strict";
import { describe, it } from "node:test";

const collector = await import("../src/poc-research-collector.js").catch(() => ({}));

function registry() {
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
    skillCandidates: [],
  };
}

function registryWithUnavailableSource() {
  const value = registry();
  value.sources.push({
    id: "github-openclaw-releases",
    adapter: "github-release",
    origin: "https://api.github.com",
    pathPrefix: "/repos/openclaw/openclaw/releases",
    requestPath: "/repos/openclaw/openclaw/releases?per_page=10",
    sourceRole: "first-party",
    trustTier: "first-party",
    domains: ["ai-capability", "device-software"],
    scenarios: ["knowledge-documents"],
  });
  return value;
}

const itemBody = JSON.stringify({
  items: [{
    title: "Agent memory update",
    summary: "A bounded AI HOT summary.",
    publishedAt: "2026-08-05T00:00:00.000Z",
    discoveredAt: "2026-08-05T01:00:00.000Z",
    source: { name: "AI HOT" },
    links: {
      aihot: "https://aihot.virxact.com/news/agent-memory",
      original: "https://example.com/agent-memory",
    },
  }],
});

describe("white-collar Research DB collector", () => {
  it("turns a bounded AI HOT response into a labelled community record", async () => {
    const result = await collector.collectResearchSources({
      registry: registry(),
      previousState: collector.createEmptyResearchCollectionState("white-collar-research-poc"),
      now: "2026-08-05T02:00:00.000Z",
      transport: {
        request: async () => ({
          status: 200,
          url: "https://aihot.virxact.com/api/v1/items?mode=selected&window=24h&limit=10",
          remoteAddress: "8.8.8.8",
          resolvedAddresses: ["8.8.8.8"],
          headers: { etag: '"aihot-v1"', "content-type": "application/json" },
          body: itemBody,
        }),
      },
    });

    assert.equal(result.records.length, 1);
    assert.match(result.records[0].id, /^aihot-selected-[a-f0-9]{16}$/u);
    assert.match(result.records[0].contentDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.deepEqual(result.records[0], {
      schemaVersion: "agentmo.poc-research-record.v1",
      id: result.records[0].id,
      sourceId: "aihot-selected",
      title: "Agent memory update",
      url: "https://aihot.virxact.com/news/agent-memory",
      publishedAt: "2026-08-05T00:00:00.000Z",
      collectedAt: "2026-08-05T02:00:00.000Z",
      sourceRole: "curated",
      trustTier: "community",
      domains: ["ai-capability", "white-collar-needs"],
      scenarios: ["knowledge-documents", "meetings-collaboration"],
      factClass: "community_signal",
      summary: "A bounded AI HOT summary.",
      contentDigest: result.records[0].contentDigest,
      evidenceIds: [],
    });
    assert.equal(result.retrievals[0].status, "retrieved");
    assert.equal(result.state.sources["aihot-selected"].etag, '"aihot-v1"');
  });

  it("reuses an unchanged AI HOT retrieval instead of creating a second record", async () => {
    const previousState = {
      schemaVersion: "agentmo.poc-research-collection-state.v1",
      agentId: "white-collar-research-poc",
      sources: { "aihot-selected": { etag: '"aihot-v1"' } },
    };
    let ifNoneMatch;
    const result = await collector.collectResearchSources({
      registry: registry(),
      previousState,
      now: "2026-08-05T03:00:00.000Z",
      transport: {
        request: async (request) => {
          ifNoneMatch = request.headers["if-none-match"];
          return {
            status: 304,
            url: request.url,
            remoteAddress: "8.8.8.8",
            resolvedAddresses: ["8.8.8.8"],
            headers: { etag: '"aihot-v1"' },
            body: "",
          };
        },
      },
    });

    assert.equal(ifNoneMatch, '"aihot-v1"');
    assert.deepEqual(result.records, []);
    assert.equal(result.retrievals[0].status, "not-modified");
  });

  it("rejects a response whose final URL escapes the registered source", async () => {
    await assert.rejects(
      () => collector.collectResearchSources({
        registry: registry(),
        previousState: collector.createEmptyResearchCollectionState("white-collar-research-poc"),
        now: "2026-08-05T02:00:00.000Z",
        transport: { request: async () => ({ status: 200, url: "https://evil.example/", headers: {}, body: itemBody }) },
      }),
      { code: "AGENTMO_POC_RESEARCH_RETRIEVAL_REJECTED" },
    );
  });

  it("accepts a TLS transport response through an explicit synthetic DNS proxy mode", async () => {
    const result = await collector.collectResearchSources({
      registry: registry(),
      previousState: collector.createEmptyResearchCollectionState("white-collar-research-poc"),
      now: "2026-08-05T02:00:00.000Z",
      networkMode: "synthetic-dns-proxy",
      transport: {
        request: async () => ({
          status: 200,
          url: "https://aihot.virxact.com/api/v1/items?mode=selected&window=24h&limit=10",
          remoteAddress: "198.18.1.171",
          resolvedAddresses: ["198.18.1.171"],
          tlsAuthorized: true,
          headers: { etag: '"aihot-v1"', "content-type": "application/json" },
          body: itemBody,
        }),
      },
    });

    assert.equal(result.records.length, 1);
  });

  it("retains successful source records while reporting a bounded source failure", async () => {
    const result = await collector.collectResearchSources({
      registry: registryWithUnavailableSource(),
      previousState: collector.createEmptyResearchCollectionState("white-collar-research-poc"),
      now: "2026-08-05T02:00:00.000Z",
      transport: {
        request: async ({ profile, url }) => profile === "web" ? ({
          status: 200,
          url,
          remoteAddress: "8.8.8.8",
          resolvedAddresses: ["8.8.8.8"],
          headers: { etag: '"aihot-v1"' },
          body: itemBody,
        }) : ({ status: 429, url, remoteAddress: "8.8.8.8", resolvedAddresses: ["8.8.8.8"], headers: {}, body: "" }),
      },
    });

    assert.equal(result.records.length, 1);
    assert.deepEqual(result.retrievals.map(({ sourceId, status, code }) => ({ sourceId, status, code })), [
      { sourceId: "aihot-selected", status: "retrieved", code: undefined },
      { sourceId: "github-openclaw-releases", status: "failed", code: "AGENTMO_POC_RESEARCH_RETRIEVAL_REJECTED" },
    ]);
  });

  it("fails closed when every registered source fails", async () => {
    await assert.rejects(
      () => collector.collectResearchSources({
        registry: registry(),
        previousState: collector.createEmptyResearchCollectionState("white-collar-research-poc"),
        now: "2026-08-05T02:00:00.000Z",
        transport: { request: async ({ url }) => ({ status: 429, url, remoteAddress: "8.8.8.8", resolvedAddresses: ["8.8.8.8"], headers: {}, body: "" }) },
      }),
      { code: "AGENTMO_POC_RESEARCH_RETRIEVAL_REJECTED" },
    );
  });
});
