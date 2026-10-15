import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  AGENT_PACKAGE_SCHEMA_VERSION,
  validateAgentPackageManifest,
  validatePackageCapabilityLedger,
} from "../src/package-contract.js";
import { serializePersistableJson } from "../src/persistability.js";

const sha256 = (text) => (
  `sha256:${createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex")}`
);

function member(relativePath, content, mode = 0o644) {
  return {
    relativePath,
    type: "file",
    mode,
    byteLength: Buffer.byteLength(content, "utf8"),
    sha256: sha256(content),
  };
}

function inventoryDigest(members) {
  return sha256(serializePersistableJson(members, {
    subject: "package-member-inventory",
  }));
}

function packageFixture() {
  const members = [
    member("canonical/capabilities.json", "{\"capabilities\":[]}\n"),
    member("openclaw/plugin/index.js", "export default function register() {}\n", 0o755),
    member("openclaw/skills/support-triage/SKILL.md", "# Support triage\n"),
    member("openclaw/workspace/AGENTS.md", "# Agent instructions\n"),
  ];
  const capabilityLedger = [
    {
      capabilityId: "hook:after-tool",
      resourceId: "resource:agent-loop",
      carrier: "native-plugin",
      owner: "agentmo-openclaw-harness",
      necessity: "typed-hook-requires-in-process-owner",
      trust: "in-process-code",
      memberPaths: ["openclaw/plugin/index.js"],
      recipeDigest: sha256("approved-native-plugin-recipe"),
      targetMapping: {
        target: "openclaw",
        event: "after_tool_call",
        versionRange: "2026.6.11@29d018f0",
      },
      permission: "observe-bounded-tool-result-metadata",
      approvalRequirement: "phase-3-contract-and-phase-4-install-plan",
      timeoutMs: 5000,
      failureSemantics: "fail-closed",
      unsupportedBehavior: ["automatic-external-plugin-install"],
    },
    {
      capabilityId: "skill:support-triage",
      resourceId: "resource:skills",
      carrier: "skill",
      owner: "agent-package",
      necessity: "declarative-domain-instructions",
      trust: "workspace-instructions",
      memberPaths: ["openclaw/skills/support-triage/SKILL.md"],
      recipeDigest: null,
      targetMapping: {
        target: "openclaw",
        event: null,
        versionRange: "2026.6.11@29d018f0",
      },
      permission: "workspace-read",
      approvalRequirement: "phase-3-contract",
      timeoutMs: null,
      failureSemantics: "fail-closed",
      unsupportedBehavior: [],
    },
    {
      capabilityId: "workspace:instructions",
      resourceId: "resource:workspace-context",
      carrier: "workspace-content",
      owner: "agent-package",
      necessity: "portable-runtime-context",
      trust: "workspace-instructions",
      memberPaths: [
        "canonical/capabilities.json",
        "openclaw/workspace/AGENTS.md",
      ],
      recipeDigest: null,
      targetMapping: {
        target: "openclaw",
        event: null,
        versionRange: "2026.6.11@29d018f0",
      },
      permission: "workspace-read",
      approvalRequirement: "phase-3-contract",
      timeoutMs: null,
      failureSemantics: "fail-closed",
      unsupportedBehavior: [],
    },
  ];
  return {
    schemaVersion: AGENT_PACKAGE_SCHEMA_VERSION,
    packageId: "support-triage",
    packageVersion: "1.0.0",
    sourceBindings: {
      blueprintDigest: sha256("blueprint"),
      buildContractDigest: sha256("build-contract"),
      designPlanDigest: sha256("design-plan"),
      discoveryApprovalDigest: sha256("discovery-approval"),
      decisionLedgerDigest: sha256("decision-ledger"),
      planApprovalDigest: sha256("plan-approval"),
    },
    targetCompatibility: [
      {
        target: "openclaw",
        version: "2026.6.11",
        sourceRevision: "29d018f0",
        exactRevisionRequired: true,
      },
    ],
    capabilityIds: capabilityLedger.map(({ capabilityId }) => capabilityId),
    capabilityLedger,
    members,
    inventoryDigest: inventoryDigest(members),
    ownership: {
      packageOwner: "agentmo",
      managedMemberPaths: members.map(({ relativePath }) => relativePath),
      externalStateIncluded: false,
    },
    permissions: [
      "observe-bounded-tool-result-metadata",
      "workspace-read",
    ],
    evidenceRefs: [
      "evidence:agent-loop",
      "evidence:skills",
      "evidence:workspace-context",
    ],
    certificationBoundary: {
      deterministicPackageMechanism: true,
      installed: false,
      runtime: false,
      domain: false,
      production: false,
    },
    remainingRisks: [
      "Domain behavior remains unverified until Phase 5.",
      "Installation requires separate exact approval.",
    ],
  };
}

describe("canonical Agent Package contract", () => {
  it("requires a complete native profile and rejects elevated or mixed carriers", () => {
    const manifest = packageFixture();
    manifest.execution_profile = "native-chat";
    const kinds = ["prompt", "workspace-context", "skills", "tools", "tool-policy", "plugins",
      "memory", "rag", "storage", "schedules", "harness", "agent-loop", "runtime-binding",
      "permissions", "trust-boundaries", "secrets", "install-transition", "load-transition",
      "execute-transition", "recovery", "acceptance-cases", "evidence-obligations"].sort();
    const base = manifest.capabilityLedger[2];
    manifest.members = kinds.map((kind) => member(`resources/${kind}.json`, "{}\n"));
    manifest.capabilityLedger = kinds.map((kind, index) => {
      const runtime = ["harness", "agent-loop", "runtime-binding"].includes(kind);
      return {
        ...structuredClone(base), capabilityId: `resource:${kind}`, resourceId: `resource:${kind}`,
        carrier: runtime ? "native-runtime" : "workspace-content",
        owner: runtime ? "openclaw" : "agent-package", trust: runtime ? "runtime-owned" : "workspace-content",
        necessity: ["skills", "plugins", "memory", "rag", "schedules"].includes(kind) ? "disabled" : "portable-declarative-resource",
        memberPaths: [manifest.members[index].relativePath],
      };
    });
    manifest.capabilityIds = manifest.capabilityLedger.map((e) => e.capabilityId);
    manifest.inventoryDigest = inventoryDigest(manifest.members);
    manifest.ownership.managedMemberPaths = manifest.members.map((m) => m.relativePath);
    assert.deepEqual(validateAgentPackageManifest(manifest), { ok: true, errors: [] });
    for (const mutate of [
      (m) => { delete m.execution_profile; },
      (m) => { m.execution_profile = null; },
      (m) => { m.capabilityLedger[1].owner = "agentmo-openclaw-harness"; },
      (m) => { m.capabilityLedger[1].carrier = "workspace-content"; },
      (m) => { m.capabilityLedger[1].recipeDigest = sha256("recipe"); },
      (m) => { m.capabilityLedger[1].targetMapping.event = "agent_end"; },
      (m) => { m.capabilityLedger.find((e) => e.resourceId === "resource:skills").carrier = "skill"; },
      (m) => { m.capabilityLedger.find((e) => e.resourceId === "resource:plugins").necessity = "required"; },
      (m) => { m.capabilityIds.pop(); m.capabilityLedger.pop(); },
    ]) {
      const changed = structuredClone(manifest); mutate(changed);
      assert.equal(validateAgentPackageManifest(changed).ok, false);
    }
    const relabeled = packageFixture(); relabeled.execution_profile = "native-chat";
    assert.equal(validateAgentPackageManifest(relabeled).ok, false);
  });
  it("validates a target-neutral manifest, capability ledger, and D-42 member closure", () => {
    const manifest = packageFixture();
    assert.equal(AGENT_PACKAGE_SCHEMA_VERSION, "agentmo.package-manifest.v1");
    assert.deepEqual(validatePackageCapabilityLedger(
      manifest.capabilityLedger,
      {
        capabilityIds: manifest.capabilityIds,
        members: manifest.members,
        allowMcp: false,
      },
    ), { ok: true, errors: [] });
    assert.deepEqual(validateAgentPackageManifest(manifest, {
      observedMembers: structuredClone(manifest.members),
    }), { ok: true, errors: [] });
    assert.equal(Object.hasOwn(manifest, "manifestDigest"), false);
    assert.equal(Object.hasOwn(manifest, "targetOperations"), false);
  });

  it("rejects unknown fields, lifecycle promotion, and sensitive durable data", () => {
    const mutations = [
      (value) => { value.unknown = true; },
      (value) => { value.certificationBoundary.runtime = true; },
      (value) => { value.certificationBoundary.domain = true; },
      (value) => { value.certificationBoundary.production = true; },
      (value) => { value.externalAuthProfile = "runtime-auth-profile-value"; },
    ];
    for (const mutate of mutations) {
      const changed = packageFixture();
      mutate(changed);
      assert.equal(validateAgentPackageManifest(changed).ok, false);
    }
  });

  it("rejects declaration-only capabilities and speculative MCP", () => {
    const missingBytes = packageFixture();
    missingBytes.capabilityLedger[0].memberPaths = [];
    assert.equal(validateAgentPackageManifest(missingBytes).ok, false);

    const missingRecipe = packageFixture();
    missingRecipe.capabilityLedger[0].recipeDigest = null;
    assert.equal(validateAgentPackageManifest(missingRecipe).ok, false);

    const speculativeMcp = packageFixture();
    speculativeMcp.capabilityLedger[0].carrier = "mcp";
    assert.equal(validateAgentPackageManifest(speculativeMcp).ok, false);
  });

  it("rejects every D-42 member mutation and incomplete observed member sets", () => {
    const mutations = [
      (value) => { value.members[0].relativePath = "../escape"; },
      (value) => { value.members[0].type = "symlink"; },
      (value) => { value.members[0].mode = 0o777; },
      (value) => { value.members[0].byteLength += 1; },
      (value) => { value.members[0].sha256 = sha256("drift"); },
      (value) => { value.members.push(structuredClone(value.members[0])); },
      (value) => { value.members[1].relativePath = "OPENCLAW/WORKSPACE/agents.md"; },
    ];
    for (const mutate of mutations) {
      const changed = packageFixture();
      mutate(changed);
      assert.equal(validateAgentPackageManifest(changed).ok, false);
    }

    const manifest = packageFixture();
    assert.equal(validateAgentPackageManifest(manifest, {
      observedMembers: manifest.members.slice(1),
    }).ok, false);
    assert.equal(validateAgentPackageManifest(manifest, {
      observedMembers: [
        ...manifest.members,
        member("openclaw/workspace/EXTRA.md", "unindexed\n"),
      ],
    }).ok, false);
  });
});
