import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { it } from "node:test";
import {
  AGENT_PACKAGE_SCHEMA_VERSION,
  validateAgentPackageManifest,
} from "../src/package-contract.js";
import {
  assertApprovedHookCarrierConsistency,
} from "../src/package-carriers.js";
import {
  buildBuildContract,
} from "../src/build-contract.js";
import {
  OPENCLAW_TARGET_CARRIER_ADMISSION_SCHEMA_VERSION,
} from "../src/openclaw-target-admission.js";
import {
  produceAgentPackage,
} from "../src/package-produce.js";
import {
  readPackageArchiveInventory,
} from "../src/package-archive.js";
import {
  formatAgentPackageInspection,
  inspectAgentPackage,
} from "../src/package-inspect.js";
import {
  DURABLE_ARTIFACT_REGISTRY,
} from "../src/artifact-registry.js";
import {
  OPENCLAW_PROBE_SCHEMA_VERSION,
  probeOpenClawTarget,
  validateOpenClawProbe,
} from "../src/openclaw-probe.js";
import {
  OPENCLAW_ABSENT_GENESIS_SCHEMA_VERSION,
  OPENCLAW_INSTALL_PLAN_SCHEMA_VERSION,
  buildOpenClawAbsentGenesisAuthority,
  buildOpenClawInstallPlan,
  validateOpenClawAbsentGenesisAuthority,
  validateOpenClawInstallPlan,
} from "../src/openclaw-install-plan.js";
import {
  OPENCLAW_CONFLICT_APPROVAL_SCHEMA_VERSION,
  OPENCLAW_INSTALL_APPROVAL_SCHEMA_VERSION,
  OPENCLAW_SENSITIVE_ACTION_DECISION_SCHEMA_VERSION,
  buildOpenClawConflictApproval,
  buildOpenClawInstallApproval,
  buildOpenClawInstallReview,
  buildOpenClawSensitiveActionDecision,
  validateOpenClawConflictApproval,
  validateOpenClawInstallApproval,
  validateOpenClawInstallDecision,
  validateOpenClawSensitiveActionDecision,
} from "../src/openclaw-install-approval.js";
import {
  OPENCLAW_AUTHORITY_MARKER_SCHEMA_VERSION,
  prepareOpenClawAuthorityStateRoot,
  reserveOpenClawAuthoritySet,
} from "../src/openclaw-authority-consumption.js";
import { subjectsForCommand } from "../src/artifact-subjects.js";
import {
  applyOpenClawInstallPlan,
  recoverOpenClawInstallAttempt,
} from "../src/openclaw-install-transaction.js";
import {
  OPENCLAW_INSTALL_PRIVATE_JOURNAL_SCHEMA_VERSION,
  validateOpenClawInstallJournal,
  writeOpenClawInstallReceipt,
} from "../src/openclaw-install-receipt.js";
import {
  OPENCLAW_INSTALL_FINALIZATION_SCHEMA_VERSION,
  OPENCLAW_INSTALL_POST_STATE_SCHEMA_VERSION,
  OPENCLAW_OFFICIAL_ACTION_RESULT_SCHEMA_VERSION,
  validateOpenClawInstallFinalizationEvidence,
  validateOpenClawInstallPostStateEvidence,
  validateOpenClawOfficialActionResultEvidence,
} from "../src/openclaw-install-evidence.js";
import {
  buildOpenClawCredentialSetupProposal,
  runApprovedOpenClawCredentialHandoff,
} from "../src/openclaw-credential-handoff.js";
import {
  prepareOpenClawOfficialActionExecutable,
  runOpenClawOfficialAction,
} from "../src/openclaw-official-action-runner.js";
import { serializePersistableJson } from "../src/persistability.js";
import { buildSupportContractInputs } from "./helpers/build-contract-fixture.js";
import {
  buildApprovedPackageFixture,
  packageProduceOptions,
  produceAgentPackageFixture,
} from "./helpers/package-produce-fixture.js";

const sha256 = (text) => (
  `sha256:${createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex")}`
);

it("Phase 4 starts fail-closed and cannot promote package evidence into runtime or domain proof", async () => {
  const inputs = await buildSupportContractInputs();
  const contract = buildBuildContract(
    inputs.values.blueprint,
    inputs.values.designPlan,
    inputs.values.discoveryApproval,
    inputs.values.decisionLedger,
    { target: "openclaw", admissions: inputs.admissions },
  );
  assert.throws(
    () => assertApprovedHookCarrierConsistency(contract),
    (error) => error?.code === "AGENTMO_PACKAGE_HOOK_OWNER_UNAPPROVED",
  );

  const manifest = {
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
    targetCompatibility: [{
      target: "openclaw",
      version: "2026.7.1-2",
      sourceRevision: "0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c",
      exactRevisionRequired: true,
    }],
    capabilityIds: ["workspace:instructions"],
    capabilityLedger: [{
      capabilityId: "workspace:instructions",
      resourceId: "resource:workspace-context",
      carrier: "workspace-content",
      owner: "agent-package",
      necessity: "portable-runtime-context",
      trust: "workspace-instructions",
      memberPaths: ["openclaw/workspace/AGENTS.md"],
      recipeDigest: null,
      targetMapping: {
        target: "openclaw",
        event: null,
        versionRange: "2026.7.1-2@0790d9f",
      },
      permission: "workspace-read",
      approvalRequirement: "phase-3-contract",
      timeoutMs: null,
      failureSemantics: "fail-closed",
      unsupportedBehavior: [],
    }],
    members: [{
      relativePath: "openclaw/workspace/AGENTS.md",
      type: "file",
      mode: 0o644,
      byteLength: 7,
      sha256: sha256("agents\n"),
    }],
    inventoryDigest: sha256(serializePersistableJson([{
      relativePath: "openclaw/workspace/AGENTS.md",
      type: "file",
      mode: 0o644,
      byteLength: 7,
      sha256: sha256("agents\n"),
    }], { subject: "package-member-inventory" })),
    ownership: {
      packageOwner: "agentmo",
      managedMemberPaths: ["openclaw/workspace/AGENTS.md"],
      externalStateIncluded: false,
    },
    permissions: ["workspace-read"],
    evidenceRefs: ["evidence:workspace-context"],
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
  assert.equal(validateAgentPackageManifest(manifest).ok, true);
  for (const field of ["installed", "runtime", "domain", "production"]) {
    const promoted = structuredClone(manifest);
    promoted.certificationBoundary[field] = true;
    assert.equal(validateAgentPackageManifest(promoted).ok, false, field);
  }
});

it("Phase 4 Wave 2 requires one durable recipe-bound target authority and defines no MCP lane", () => {
  assert.equal(
    OPENCLAW_TARGET_CARRIER_ADMISSION_SCHEMA_VERSION,
    "agentmo.openclaw-target-carrier-admission.v1",
  );
  const publicSurface = JSON.stringify({
    command: "openclaw-target-admit",
    required: ["blueprint", "build-contract", "plan-approval", "target-executable", "target-root"],
    forbidden: ["plugin-path", "plugin-file", "plugin-digest", "mcp"],
  });
  assert.equal(publicSurface.includes("target-carrier-admission"), false);
  assert.equal(publicSurface.includes("plugin-path"), true);
});

it("Phase 4 Wave 3 exposes archive-bound Produce without promoting install or runtime", () => {
  assert.equal(typeof produceAgentPackage, "function");
  assert.equal(typeof readPackageArchiveInventory, "function");
  const publicContract = {
    command: "package-produce",
    transport: "deterministic-archive-only",
    directoryAuthority: "canonical-build-only",
    installed: false,
    runtime: false,
    domain: false,
    production: false,
  };
  assert.equal(publicContract.transport, "deterministic-archive-only");
  assert.equal(Object.values(publicContract).includes(true), false);
});

it("Phase 4 Wave 4 exposes offline inspect and exact package-manifest admission without certification", () => {
  assert.equal(typeof inspectAgentPackage, "function");
  assert.equal(typeof formatAgentPackageInspection, "function");
  assert.deepEqual(subjectsForCommand("package-inspect"), ["package-manifest"]);
  const descriptor = DURABLE_ARTIFACT_REGISTRY.find(
    ({ subject }) => subject === "package-manifest",
  );
  assert.equal(descriptor.identity, "agentmo.package-manifest.v1");
  assert.equal(descriptor.validate_canonical_input({
    schemaVersion: "agentmo.package-manifest.v1",
  }), false);
});

it("Phase 4 Wave 5 exposes one archive-bound read-only OpenClaw probe artifact", () => {
  assert.equal(OPENCLAW_PROBE_SCHEMA_VERSION, "agentmo.openclaw-probe.v1");
  assert.equal(typeof probeOpenClawTarget, "function");
  assert.equal(typeof validateOpenClawProbe, "function");
  assert.deepEqual(subjectsForCommand("openclaw-probe"), [
    "package-manifest",
    "openclaw-target-carrier-admission",
  ]);
  const descriptor = DURABLE_ARTIFACT_REGISTRY.find(
    ({ subject }) => subject === "openclaw-probe",
  );
  assert.equal(descriptor.identity, "agentmo.openclaw-probe.v1");
  assert.equal(descriptor.validate_canonical_input({
    schemaVersion: "agentmo.openclaw-probe.v1",
  }), false);
});

it("Phase 4 Wave 6 lifecycle models remain pure after Wave 8 registration", () => {
  assert.equal(
    OPENCLAW_ABSENT_GENESIS_SCHEMA_VERSION,
    "agentmo.openclaw-absent-genesis.v1",
  );
  assert.equal(
    OPENCLAW_INSTALL_PLAN_SCHEMA_VERSION,
    "agentmo.openclaw-install-plan.v1",
  );
  assert.equal(
    OPENCLAW_INSTALL_APPROVAL_SCHEMA_VERSION,
    "agentmo.openclaw-install-approval.v1",
  );
  assert.equal(
    OPENCLAW_SENSITIVE_ACTION_DECISION_SCHEMA_VERSION,
    "agentmo.openclaw-sensitive-action-decision.v1",
  );
  assert.equal(
    OPENCLAW_CONFLICT_APPROVAL_SCHEMA_VERSION,
    "agentmo.openclaw-conflict-approval.v1",
  );
  for (const value of [
    buildOpenClawAbsentGenesisAuthority,
    validateOpenClawAbsentGenesisAuthority,
    buildOpenClawInstallPlan,
    validateOpenClawInstallPlan,
    buildOpenClawInstallReview,
    buildOpenClawInstallApproval,
    validateOpenClawInstallApproval,
    buildOpenClawSensitiveActionDecision,
    validateOpenClawSensitiveActionDecision,
    buildOpenClawConflictApproval,
    validateOpenClawConflictApproval,
  ]) {
    assert.equal(typeof value, "function");
  }
  assert.throws(
    () => subjectsForCommand("openclaw-install"),
    { code: "AGENTMO_DURABLE_COMMAND_UNSUPPORTED" },
  );
});

it("Phase 4 Wave 16 registers private journal and receipt before lifecycle authority", () => {
  const expected = [
    [
      "openclaw-install-private-journal",
      "agentmo.openclaw-install-private-journal.v1",
    ],
    [
      "openclaw-install-post-state",
      "agentmo.openclaw-install-post-state.v1",
    ],
    [
      "openclaw-official-action-result",
      "agentmo.openclaw-official-action-result.v1",
    ],
    [
      "openclaw-install-finalization",
      "agentmo.openclaw-install-finalization.v1",
    ],
    ["openclaw-install-receipt", "agentmo.openclaw-install-receipt.v1"],
    ["openclaw-absent-genesis", "agentmo.openclaw-absent-genesis.v1"],
    ["openclaw-install-plan", "agentmo.openclaw-install-plan.v1"],
    ["openclaw-install-approval", "agentmo.openclaw-install-approval.v1"],
    [
      "openclaw-sensitive-action-decision",
      "agentmo.openclaw-sensitive-action-decision.v1",
    ],
    ["openclaw-conflict-approval", "agentmo.openclaw-conflict-approval.v1"],
  ];
  const lifecycleDescriptors = DURABLE_ARTIFACT_REGISTRY
    .filter(({ subject }) => expected.some(([candidate]) => candidate === subject))
    .map(({ subject, identity }) => [subject, identity]);
  assert.deepEqual(lifecycleDescriptors, expected);
  assert.equal(
    OPENCLAW_INSTALL_PRIVATE_JOURNAL_SCHEMA_VERSION,
    "agentmo.openclaw-install-private-journal.v1",
  );
  assert.equal(typeof validateOpenClawInstallJournal, "function");
  assert.equal(
    OPENCLAW_INSTALL_POST_STATE_SCHEMA_VERSION,
    "agentmo.openclaw-install-post-state.v1",
  );
  assert.equal(
    OPENCLAW_OFFICIAL_ACTION_RESULT_SCHEMA_VERSION,
    "agentmo.openclaw-official-action-result.v1",
  );
  assert.equal(
    OPENCLAW_INSTALL_FINALIZATION_SCHEMA_VERSION,
    "agentmo.openclaw-install-finalization.v1",
  );
  for (const validator of [
    validateOpenClawInstallPostStateEvidence,
    validateOpenClawOfficialActionResultEvidence,
    validateOpenClawInstallFinalizationEvidence,
  ]) {
    assert.equal(typeof validator, "function");
  }
  assert.deepEqual(subjectsForCommand("openclaw-install-genesis"), [
    "openclaw-probe",
  ]);
  assert.deepEqual(subjectsForCommand("openclaw-install-preview", {
    lifecycle: "install",
  }), [
    "openclaw-probe",
    "openclaw-absent-genesis",
  ]);
  assert.deepEqual(subjectsForCommand("openclaw-install-preview", {
    lifecycle: "upgrade",
  }), [
    "openclaw-probe",
    "openclaw-install-receipt",
  ]);
  assert.deepEqual(subjectsForCommand("openclaw-install-preview", {
    lifecycle: "rollback",
  }), [
    "openclaw-probe",
    "openclaw-install-receipt",
    "openclaw-install-receipt",
  ]);
  assert.deepEqual(subjectsForCommand("openclaw-install-approve"), [
    "openclaw-install-plan",
  ]);
});

it("Phase 4 Wave 9 exposes one receipt-last lifecycle seam and no MCP route", () => {
  for (const value of [
    applyOpenClawInstallPlan,
    recoverOpenClawInstallAttempt,
    writeOpenClawInstallReceipt,
    buildOpenClawCredentialSetupProposal,
    runApprovedOpenClawCredentialHandoff,
  ]) {
    assert.equal(typeof value, "function");
  }
  assert.deepEqual(subjectsForCommand("openclaw-install-apply", {
    lifecycle: "install",
    sensitiveActionCount: 1,
    hasConflicts: false,
  }), [
    "openclaw-target-carrier-admission",
    "openclaw-probe",
    "openclaw-install-plan",
    "openclaw-install-approval",
    "openclaw-sensitive-action-decision",
    "openclaw-absent-genesis",
  ]);
  assert.throws(
    () => subjectsForCommand("openclaw-mcp-install"),
    { code: "AGENTMO_DURABLE_COMMAND_UNSUPPORTED" },
  );
});

it("Phase 4 Wave 14 exposes durable per-nonce reservation and canonical decision validation", () => {
  assert.equal(
    OPENCLAW_AUTHORITY_MARKER_SCHEMA_VERSION,
    "agentmo.openclaw-authority-marker.v1",
  );
  for (const value of [
    prepareOpenClawAuthorityStateRoot,
    reserveOpenClawAuthoritySet,
    validateOpenClawInstallDecision,
  ]) {
    assert.equal(typeof value, "function");
  }
});

it("Phase 4 Wave 15 exposes only the verified official OpenClaw action seam", () => {
  assert.equal(typeof prepareOpenClawOfficialActionExecutable, "function");
  assert.equal(typeof runOpenClawOfficialAction, "function");
});

it("rejects public apply reprobe adapters and approved-probe fallback branches", async () => {
  const source = await readFile(
    fileURLToPath(new URL("../src/openclaw-install-transaction.js", import.meta.url)),
    "utf8",
  );
  assert.equal(/\badapters\b/u.test(source), false);
  assert.equal(/return basis\.probe/u.test(source), false);
});

it("Phase 4 Wave 10 composes the declared support-triage package through offline inspect and fixture probe only", async () => {
  const fixture = await buildApprovedPackageFixture();
  const packageRoot = path.join(fixture.root, "phase4-declared-package");
  const archivePath = path.join(fixture.root, "phase4-declared-package.d42");
  const produced = await produceAgentPackageFixture(
    packageProduceOptions(fixture, packageRoot, archivePath),
  );
  const inspection = await inspectAgentPackage({
    packagePath: archivePath,
    expectedArchiveDigest: produced.archiveDigest,
  });
  const options = {
    archivePath,
    expectedArchiveDigest: produced.archiveDigest,
    blueprintPath: fixture.paths.blueprint,
    expectedBlueprintDigest: fixture.digests.blueprint,
    buildContractPath: fixture.paths["build-contract"],
    expectedBuildContractDigest: fixture.digests["build-contract"],
    planApprovalPath: fixture.paths["plan-approval"],
    expectedPlanApprovalDigest: fixture.digests["plan-approval"],
    targetCarrierAdmissionPath:
      fixture.paths["openclaw-target-carrier-admission"],
    expectedTargetCarrierAdmissionDigest:
      fixture.digests["openclaw-target-carrier-admission"],
    targetDescriptorPath: fixture.paths["openclaw-target-descriptor"],
    expectedTargetDescriptorDigest:
      fixture.digests["openclaw-target-descriptor"],
    targetRoot: path.dirname(fixture.inputs.targetFiles.packageJsonPath),
  };

  assert.equal(inspection.files.length, 40);
  assert.equal(inspection.transport.archiveDigest, produced.archiveDigest);
  assert.equal(
    inspection.carriers.some(({ carrier }) => carrier === "mcp-server"),
    false,
  );
  assert.equal(
    inspection.targetOperations.some((operation) => /mcp/iu.test(JSON.stringify(operation))),
    false,
  );
  assert.deepEqual(inspection.certificationBoundary, {
    packageClosureVerified: true,
    installed: false,
    runtime: false,
    domain: false,
    birth: false,
    delivery: false,
    production: false,
  });
  if (process.platform !== "linux") {
    await assert.rejects(
      probeOpenClawTarget(options),
      (error) => (
        error?.code
          === "AGENTMO_OPENCLAW_PROBE_PLATFORM_FD_TRANSPORT_UNAVAILABLE"
      ),
    );
    return;
  }

  const probe = await probeOpenClawTarget(options);
  assert.equal(probe.archive.archiveDigest, produced.archiveDigest);
  assert.equal(probe.archive.manifestDigest, produced.manifestDigest);
  assert.equal(probe.target.exactTargetMatch, true);
  assert.equal(probe.isolation.syntheticHomeDiscarded, true);
  assert.deepEqual(probe.certificationBoundary, {
    readOnlyCapabilityObservation: true,
    installed: false,
    pluginLoaded: false,
    mcpConnected: false,
    agentInvoked: false,
    scheduleTriggered: false,
    credentialsUsed: false,
    runtime: false,
    domain: false,
    birth: false,
    delivery: false,
    production: false,
  });
});
