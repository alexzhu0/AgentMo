import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  boundedDiscoveryLiveRequestHeaders,
  createPinnedDiscoveryLookup,
  isDiscoveryNetworkAddressAllowed,
} from "../src/discovery-live-transport.js";

describe("discovery live transport request headers", () => {
  it("allows only a bounded ETag conditional header alongside a fixed profile", () => {
    assert.deepEqual(boundedDiscoveryLiveRequestHeaders("web", { "if-none-match": '"v1"' }), {
      accept: "text/plain, text/html, application/json",
      "user-agent": "AgentMo/0.1 bounded-discovery",
      "if-none-match": '"v1"',
    });
  });

  it("rejects an invalid conditional request header", () => {
    assert.throws(
      () => boundedDiscoveryLiveRequestHeaders("web", { "if-none-match": "" }),
      { code: "AGENTMO_DISCOVERY_LIVE_TRANSPORT_CONTRACT" },
    );
  });

  it("admits only synthetic DNS proxy addresses for an explicit hostname-bound mode", () => {
    assert.equal(isDiscoveryNetworkAddressAllowed("198.18.1.171", "public-only", "api.github.com"), false);
    assert.equal(isDiscoveryNetworkAddressAllowed("198.18.1.171", "synthetic-dns-proxy", "api.github.com"), true);
    assert.equal(isDiscoveryNetworkAddressAllowed("198.18.1.171", "synthetic-dns-proxy", "198.18.1.171"), false);
    assert.equal(isDiscoveryNetworkAddressAllowed("198.18.1.171", "synthetic-dns-proxy", "internal.example"), false);
    assert.equal(isDiscoveryNetworkAddressAllowed("10.0.0.1", "synthetic-dns-proxy", "api.github.com"), false);
  });

  it("returns the pinned address shape requested by Node lookup callers", () => {
    const lookup = createPinnedDiscoveryLookup({ address: "198.18.1.171", family: 4 });
    let single;
    let all;
    lookup("api.github.com", {}, (...args) => { single = args; });
    lookup("api.github.com", { all: true }, (...args) => { all = args; });
    assert.deepEqual(single, [null, "198.18.1.171", 4]);
    assert.deepEqual(all, [null, [{ address: "198.18.1.171", family: 4 }]]);
  });
});
