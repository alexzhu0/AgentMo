import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  buildDiscoveryLive,
  DISCOVERY_COLLECTOR_ADAPTERS,
  DISCOVERY_LIVE_SCHEMA_VERSION,
  prepareDiscoveryLive,
  writeDiscoveryLive,
} from "../src/discovery-live.js";
import { GITHUB_API_VERSION } from "../src/collectors/github.js";

const RETRIEVED_AT = "2026-07-28T01:02:03.000Z";

function liveManifest(overrides = {}) {
  const manifest = {
    schemaVersion: "agentmo.discovery.v1",
    agent_id: "ai-frontier-wiki",
    source_inventory: [
      {
        id: "openai-research",
        type: "retrieval_corpus",
        trust_level: "trusted",
        description: "Approved public research source.",
        location: "https://example.com/research",
        extraction_fields: ["title", "published_at", "summary"],
      },
    ],
    database_outputs: ["evidence wiki"],
    retrieval_outputs: ["cited answer"],
    user_need_inputs: ["AI research question"],
    refresh_policy: {
      cadence: "daily",
      owner: "human editor",
      stale_after: "P2D",
    },
    forbidden_data_handling: [
      "Do not persist credentials, full response bodies, or private payloads.",
    ],
    collector: {
      schemaVersion: "agentmo.discovery-live-policy.v1",
      adapter: "web",
      allowlist: ["https://example.com/research"],
      maxSources: 2,
      maxBytesPerSource: 4096,
      perSourceTimeoutMs: 1000,
      aggregateTimeoutMs: 3000,
      maxRedirects: 1,
      allowedContentTypes: ["text/plain", "text/html", "application/json"],
    },
    ...overrides,
  };
  manifest.collector = {
    schemaVersion: "agentmo.discovery-live-policy.v1",
    adapter: "web",
    allowlist: ["https://example.com/research"],
    maxSources: 2,
    maxBytesPerSource: 4096,
    perSourceTimeoutMs: 1000,
    aggregateTimeoutMs: 3000,
    maxRedirects: 1,
    allowedContentTypes: ["text/plain", "text/html", "application/json"],
    ...overrides.collector,
  };
  return manifest;
}

function fakeTransport(responses, calls = []) {
  let index = 0;
  return {
    async request(request) {
      calls.push({
        url: request.url,
        redirectMode: request.redirectMode,
        signal: request.signal,
        profile: request.profile,
      });
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      return typeof response === "function" ? response(request) : response;
    },
  };
}

function response(body, overrides = {}) {
  const chunks = Array.isArray(body) ? body : [body];
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  return {
    status: 200,
    url: "https://example.com/research",
    remoteAddress: "93.184.216.34",
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-length": String(bytes.length),
    },
    body: (async function* stream() {
      for (const chunk of chunks) yield Buffer.from(chunk);
    })(),
    ...overrides,
  };
}

describe("bounded live discovery", () => {
  it("derives canonical Stage 1 evidence from exact retained response bytes", async () => {
    const bodyChunks = [
      Buffer.from("Agent memory systems gained "),
      Buffer.from("bounded provenance and restart recovery."),
    ];
    const exactBytes = Buffer.concat(bodyChunks);
    const calls = [];
    const live = await buildDiscoveryLive(liveManifest(), {
      transport: fakeTransport([response(bodyChunks)], calls),
      now: () => new Date(RETRIEVED_AT),
    });

    assert.equal(live.schemaVersion, DISCOVERY_LIVE_SCHEMA_VERSION);
    assert.equal(live.ok, true);
    assert.equal(live.evidenceLevel, "bounded-mechanism-only");
    assert.equal(live.retrievals.length, 1);
    assert.deepEqual(calls.map(({ url, redirectMode }) => ({ url, redirectMode })), [
      { url: "https://example.com/research", redirectMode: "manual" },
    ]);

    const [retrieval] = live.retrievals;
    assert.equal(
      retrieval.contentDigest,
      `sha256:${createHash("sha256").update(exactBytes).digest("hex")}`,
    );
    assert.equal(retrieval.requestedUrl, "https://example.com/research");
    assert.equal(retrieval.finalUrl, "https://example.com/research");
    assert.equal(retrieval.retrievedAt, RETRIEVED_AT);
    assert.equal(retrieval.declaredTrustLevel, "trusted");
    assert.equal(retrieval.evidenceClass, "context");
    assert.equal(retrieval.confidence, "unverified");
    assert.match(retrieval.confidenceRationale, /does not establish semantic correctness/u);
    assert.equal(Object.hasOwn(retrieval, "body"), false);
    assert.equal(Object.hasOwn(retrieval, "responseBody"), false);

    const sourceFacts = live.discoveryDb.facts.filter((fact) => fact.kind === "source_chunk");
    assert.equal(sourceFacts.length, 1);
    assert.equal(sourceFacts[0].trustLevel, "unverified");
    assert.equal(sourceFacts[0].evidenceClass, "context");
    assert.equal(
      live.discoveryDb.facts.some(
        (fact) => fact.kind === "extraction_field" && fact.evidenceClass === "context",
      ),
      false,
    );
    assert.equal(live.certification.domainQuality, false);
    assert.equal(live.certification.runtimeReady, false);
    assert.equal(live.certification.productionReady, false);

    const durableText = JSON.stringify(live);
    assert.equal(durableText.includes(exactBytes.toString("utf8")), false);
    assert.equal(durableText.includes("bounded provenance"), true);
  });

  it("preserves explicit first-party and community roles independently from trust", async () => {
    const manifest = liveManifest({
      source_inventory: [
        {
          id: "official-web",
          type: "retrieval_corpus",
          trust_level: "unverified",
          evidence_class: "first-party",
          description: "Official project announcement.",
          location: "https://example.com/official",
          extraction_fields: ["announcement"],
        },
        {
          id: "community-web",
          type: "retrieval_corpus",
          trust_level: "verified",
          evidence_class: "community",
          description: "Community discussion.",
          location: "https://example.com/community",
          extraction_fields: ["opinion"],
        },
      ],
      collector: {
        allowlist: [
          "https://example.com/official",
          "https://example.com/community",
        ],
      },
    });
    const live = await buildDiscoveryLive(manifest, {
      transport: fakeTransport([
        response("official statement"),
        response("community opinion"),
      ]),
      now: () => new Date(RETRIEVED_AT),
    });

    assert.deepEqual(
      live.retrievals.map(({ sourceId, evidenceClass, declaredTrustLevel, confidence }) => ({
        sourceId,
        evidenceClass,
        declaredTrustLevel,
        confidence,
      })),
      [
        {
          sourceId: "official-web",
          evidenceClass: "first-party",
          declaredTrustLevel: "unverified",
          confidence: "unverified",
        },
        {
          sourceId: "community-web",
          evidenceClass: "community",
          declaredTrustLevel: "verified",
          confidence: "unverified",
        },
      ],
    );
  });

  it("is deterministic for the same admitted manifest, bytes, and clock", async () => {
    const manifest = liveManifest();
    const build = () => buildDiscoveryLive(manifest, {
      transport: fakeTransport([response(["alpha ", "beta"])]),
      now: () => new Date(RETRIEVED_AT),
    });
    const left = await build();
    const right = await build();

    assert.deepEqual(right, left);
    assert.deepEqual(prepareDiscoveryLive(right), prepareDiscoveryLive(left));
  });

  it("publishes the fully preflighted set through one absent-root transaction", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-discovery-live-"));
    const out = path.join(root, "published");
    const live = await buildDiscoveryLive(liveManifest(), {
      transport: fakeTransport([response("bounded public research")]),
      now: () => new Date(RETRIEVED_AT),
    });

    const paths = await writeDiscoveryLive(out, live);
    assert.deepEqual(paths, {
      outDir: ".",
      discoveryDbPath: "agentmo-discovery-db.json",
      factsPath: "facts.jsonl",
      coveragePath: "coverage.json",
      sourceCardsPath: "source-cards.json",
      sourceChunksPath: "source-chunks.jsonl",
      retrievalsPath: "retrievals.jsonl",
    });
    const discoveryDb = JSON.parse(await readFile(path.join(out, paths.discoveryDbPath), "utf8"));
    assert.equal(discoveryDb.schemaVersion, "agentmo.discovery-db.v1");
    assert.equal(discoveryDb.validation.ok, true);
    assert.equal(discoveryDb.facts.some((fact) => fact.kind === "source_chunk"), true);
    await access(path.join(out, paths.retrievalsPath));
  });

  it("uses a closed provider registry and normalizes bounded GitHub pagination", async () => {
    assert.deepEqual(Object.keys(DISCOVERY_COLLECTOR_ADAPTERS).sort(), ["arxiv", "github", "web"]);
    const calls = [];
    const manifest = liveManifest({
      source_inventory: [{
        id: "agentmo-repository",
        type: "retrieval_corpus",
        trust_level: "trusted",
        evidence_class: "community",
        description: "Approved GitHub repository metadata.",
        location: "https://api.github.com/repos/example-org/fixture-repository/issues?per_page=2",
        extraction_fields: ["title", "updated_at"],
      }],
      collector: {
        adapter: "github",
        allowlist: [
          "https://api.github.com/repos/example-org/fixture-repository/issues?per_page=2",
          "https://api.github.com/repos/example-org/fixture-repository/issues?page=2&per_page=2",
        ],
        allowedContentTypes: ["application/json"],
      },
    });
    const pageOne = response('[{"title":"bounded one"}]', {
      headers: {
        "content-type": "application/json",
        link: '<https://api.github.com/repos/example-org/fixture-repository/issues?page=2&per_page=2>; rel="next"',
        "x-ratelimit-remaining": "42",
        etag: "\"page-one\"",
      },
    });
    const pageTwo = response('[{"title":"bounded two"}]', {
      headers: {
        "content-type": "application/json",
        "x-ratelimit-remaining": "41",
        "last-modified": "Tue, 28 Jul 2026 01:00:00 GMT",
      },
    });
    const live = await buildDiscoveryLive(manifest, {
      transport: fakeTransport([pageOne, pageTwo], calls),
      now: () => new Date(RETRIEVED_AT),
    });

    assert.equal(GITHUB_API_VERSION, "2022-11-28");
    assert.deepEqual(calls.map((call) => call.profile), ["github", "github"]);
    assert.equal(live.retrievals[0].providerKind, "github");
    assert.equal(live.retrievals[0].providerPolicy.apiVersion, GITHUB_API_VERSION);
    assert.equal(live.retrievals[0].providerPolicy.pageCount, 2);
    assert.equal(live.retrievals[0].providerPolicy.rateRemaining, 41);
    assert.equal(live.retrievals[0].evidenceClass, "community");
    assert.equal(live.retrievals[0].confidence, "unverified");
    assert.equal(JSON.stringify(live).includes("authorization"), false);
    assert.equal(JSON.stringify(live).includes("bounded two"), true);
  });

  it("stops GitHub collection on rate responses without retry or response persistence", async () => {
    const calls = [];
    const manifest = liveManifest({
      source_inventory: [{
        id: "github-rate",
        type: "retrieval_corpus",
        trust_level: "trusted",
        description: "Approved GitHub rate probe.",
        location: "https://api.github.com/rate_limit",
        extraction_fields: ["rate"],
      }],
      collector: {
        adapter: "github",
        allowlist: ["https://api.github.com/rate_limit"],
        allowedContentTypes: ["application/json"],
      },
    });
    for (const status of [403, 429]) {
      calls.length = 0;
      await assert.rejects(
        () => buildDiscoveryLive(manifest, {
          transport: fakeTransport([response("rate body must not persist", {
            status,
            headers: { "content-type": "application/json", "retry-after": "60" },
          })], calls),
          now: () => new Date(RETRIEVED_AT),
        }),
        (error) => error.code === "AGENTMO_DISCOVERY_LIVE_RATE_LIMITED",
      );
      assert.equal(calls.length, 1);
    }
  });

  it("normalizes arXiv Atom metadata while refusing full-paper endpoints", async () => {
    const atom = [
      "<?xml version=\"1.0\"?>",
      "<feed><entry><id>https://arxiv.org/abs/2607.12345</id>",
      "<updated>2026-07-27T00:00:00Z</updated><published>2026-07-26T00:00:00Z</published>",
      "<title>Agent Memory Systems</title><summary>Bounded metadata abstract.</summary>",
      "<author><name>Ada Example</name></author></entry></feed>",
    ].join("");
    const manifest = liveManifest({
      source_inventory: [{
        id: "arxiv-memory",
        type: "retrieval_corpus",
        trust_level: "verified",
        description: "Approved arXiv metadata query.",
        location: "https://export.arxiv.org/api/query?id_list=2607.12345",
        extraction_fields: ["title", "published", "abstract"],
      }],
      collector: {
        adapter: "arxiv",
        allowlist: ["https://export.arxiv.org/api/query?id_list=2607.12345"],
        allowedContentTypes: ["application/atom+xml"],
      },
    });
    const calls = [];
    const live = await buildDiscoveryLive(manifest, {
      transport: fakeTransport([response(atom, {
        headers: { "content-type": "application/atom+xml" },
      })], calls),
      now: () => new Date(RETRIEVED_AT),
    });

    assert.deepEqual(calls.map((call) => call.profile), ["arxiv"]);
    assert.equal(live.retrievals[0].providerKind, "arxiv");
    assert.equal(live.retrievals[0].evidenceClass, "primary");
    assert.equal(live.retrievals[0].providerPolicy.fullTextStored, false);
    assert.match(live.retrievals[0].summary, /Agent Memory Systems/u);

    const fullPaper = structuredClone(manifest);
    fullPaper.source_inventory[0].location = "https://arxiv.org/pdf/2607.12345";
    fullPaper.collector.allowlist = [fullPaper.source_inventory[0].location];
    await assert.rejects(
      () => buildDiscoveryLive(fullPaper, {
        transport: fakeTransport([response("pdf")]),
        now: () => new Date(RETRIEVED_AT),
      }),
      (error) => error.code === "AGENTMO_DISCOVERY_LIVE_ARXIV_FULL_TEXT_DENIED",
    );

    const misclassified = structuredClone(manifest);
    misclassified.source_inventory[0].evidence_class = "community";
    const deniedCalls = [];
    await assert.rejects(
      () => buildDiscoveryLive(misclassified, {
        transport: fakeTransport([response(atom)], deniedCalls),
        now: () => new Date(RETRIEVED_AT),
      }),
      (error) => error.code === "AGENTMO_DISCOVERY_LIVE_EVIDENCE_CLASS_INVALID",
    );
    assert.equal(deniedCalls.length, 0);
  });

  it("enforces the declared arXiv minimum interval between source requests", async () => {
    const atom = [
      "<?xml version=\"1.0\"?>",
      "<feed><entry><updated>2026-07-27T00:00:00Z</updated>",
      "<published>2026-07-26T00:00:00Z</published>",
      "<title>Bounded Paper</title><summary>Bounded metadata abstract.</summary>",
      "</entry></feed>",
    ].join("");
    const locations = [
      "https://export.arxiv.org/api/query?id_list=2607.00001",
      "https://export.arxiv.org/api/query?id_list=2607.00002",
    ];
    const manifest = liveManifest({
      source_inventory: locations.map((location, index) => ({
        id: `arxiv-${index + 1}`,
        type: "retrieval_corpus",
        trust_level: "verified",
        evidence_class: "primary",
        description: "Approved arXiv metadata query.",
        location,
        extraction_fields: ["title", "published", "abstract"],
      })),
      collector: {
        adapter: "arxiv",
        allowlist: locations,
        allowedContentTypes: ["application/atom+xml"],
        aggregateTimeoutMs: 10_000,
      },
    });
    let monotonicMs = 0;
    const sleeps = [];
    const calls = [];
    const live = await buildDiscoveryLive(manifest, {
      transport: fakeTransport([
        response(atom, { headers: { "content-type": "application/atom+xml" } }),
        response(atom, { headers: { "content-type": "application/atom+xml" } }),
      ], calls),
      now: () => new Date(RETRIEVED_AT),
      monotonicNow: () => monotonicMs,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        monotonicMs += milliseconds;
      },
    });

    assert.equal(live.retrievals.length, 2);
    assert.equal(calls.length, 2);
    assert.deepEqual(sleeps, [3000]);
    assert.equal(
      live.retrievals.every((item) => item.providerPolicy.minimumRequestIntervalMs === 3000),
      true,
    );
  });

  it("emits deterministic non-semantic dedup, freshness, conflict, and gap observations", async () => {
    const manifest = liveManifest({
      source_inventory: [
        {
          id: "source-a",
          type: "retrieval_corpus",
          trust_level: "trusted",
          description: "Approved context A.",
          location: "https://example.com/a",
          extraction_fields: ["title", "published_at"],
        },
        {
          id: "source-b",
          type: "retrieval_corpus",
          trust_level: "verified",
          description: "Approved context B.",
          location: "https://example.com/b",
          extraction_fields: ["title", "published_at"],
        },
      ],
      collector: {
        allowlist: ["https://example.com/a", "https://example.com/b"],
      },
    });
    const build = () => buildDiscoveryLive(manifest, {
      transport: fakeTransport([response("same title"), response("same title")]),
      now: () => new Date(RETRIEVED_AT),
    });
    const left = await build();
    const right = await build();

    assert.deepEqual(right.observations, left.observations);
    assert.equal(left.observations.basis, "mechanical-non-semantic");
    assert.equal(left.observations.dedup[1].duplicateOf, "source-a");
    assert.equal(left.observations.freshness.every((item) => item.basis === "retrieval-age"), true);
    assert.equal(left.observations.conflictCandidates[0].adjudicated, false);
    assert.equal(left.observations.coverageGaps.every((item) => item.semanticConclusion === false), true);
    assert.equal(left.certification.semanticQuality, false);
  });
});
