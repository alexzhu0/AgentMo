import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BUILDER_ADAPTER_CONTRACT_VERSION,
  BUILDER_REQUIRED_LIFECYCLE_EVENTS,
  defineBuilderAdapter,
  validateBuilderAdapter,
} from "../src/builders/contract.js";
import { codexBuilderAdapter } from "../src/builders/codex.js";
import { getBuilderAdapter, listBuilderAdapters } from "../src/builders/registry.js";

describe("builder adapter contract", () => {
  it("defines a frozen host-neutral Codex candidate without self-asserted support", () => {
    assert.equal(codexBuilderAdapter.contractVersion, BUILDER_ADAPTER_CONTRACT_VERSION);
    assert.deepEqual(codexBuilderAdapter.lifecycleEvents, [...BUILDER_REQUIRED_LIFECYCLE_EVENTS]);
    assert.equal(codexBuilderAdapter.supportDeclaration, "candidate");
    assert.equal(codexBuilderAdapter.supportClaim, false);
    assert.equal(codexBuilderAdapter.recovery.authority, "agentmo-checkpoint");
    assert.equal(codexBuilderAdapter.deduplication.strategy, "event-id-ledger");
    assert.equal(Object.isFrozen(codexBuilderAdapter), true);
    assert.equal(Object.isFrozen(codexBuilderAdapter.capabilities), true);
    assert.equal(getBuilderAdapter("codex"), codexBuilderAdapter);
    assert.deepEqual(listBuilderAdapters(), [{
      id: "codex",
      label: "OpenAI Codex",
      contractVersion: BUILDER_ADAPTER_CONTRACT_VERSION,
      supportDeclaration: "candidate",
      supportClaim: false,
    }]);
  });

  it("rejects missing lifecycle events and optional capabilities without an explicit tested fallback", () => {
    const candidate = JSON.parse(JSON.stringify(codexBuilderAdapter));
    candidate.lifecycleEvents = candidate.lifecycleEvents.filter((event) => event !== "pre-compact");
    candidate.capabilities.find((item) => item.requirement === "optional").fallback = null;
    const result = validateBuilderAdapter(candidate);
    assert.equal(result.ok, false);
    assert.equal(result.errors.some((error) => error.includes("pre-compact")), true);
    assert.equal(result.errors.some((error) => error.includes("fallback")), true);
  });

  it("rejects descriptors that try to turn registration into a support claim", () => {
    const candidate = JSON.parse(JSON.stringify(codexBuilderAdapter));
    candidate.supportClaim = true;
    candidate.evidence.supportClaim = true;
    assert.throws(() => defineBuilderAdapter(candidate), /cannot self-assert support|supportClaim/u);
  });

  it("rejects unknown or incomplete capability probe mappings", () => {
    const unknown = JSON.parse(JSON.stringify(codexBuilderAdapter));
    unknown.capabilities[0].probe = { kind: "trust-me" };
    assert.equal(validateBuilderAdapter(unknown).ok, false);

    const incomplete = JSON.parse(JSON.stringify(codexBuilderAdapter));
    incomplete.capabilities[1].probe = { kind: "feature-and-help", feature: "plugins" };
    assert.equal(validateBuilderAdapter(incomplete).ok, false);
  });
});
