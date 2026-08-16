import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { before, describe, it } from "node:test";
import {
  admitOpenClawInstallReceiptWithCompanions,
  applyOpenClawInstallPlan,
  buildOpenClawJournalDurabilityRecovery,
  classifyOpenClawCreateOnlyPublication,
  recoverOpenClawInstallAttempt,
} from "../src/openclaw-install-transaction.js";
import { buildOpenClawFsKernel } from "../src/openclaw-safe-fs.js";
import {
  formatOpenClawInstallReceipt,
  OPENCLAW_INSTALL_RECEIPT_SCHEMA_VERSION,
  validateOpenClawInstallReceipt,
  writeOpenClawInstallReceipt,
} from "../src/openclaw-install-receipt.js";
import {
  buildOpenClawCredentialSetupProposal,
  runApprovedOpenClawCredentialHandoff,
} from "../src/openclaw-credential-handoff.js";
import {
  buildOpenClawAbsentGenesisAuthority,
  buildOpenClawInstallPlan,
  writeOpenClawAbsentGenesisAuthority,
  writeOpenClawInstallPlan,
} from "../src/openclaw-install-plan.js";
import {
  buildOpenClawConflictApproval,
  buildOpenClawInstallApproval,
  buildOpenClawSensitiveActionDecision,
  writeOpenClawConflictApproval,
  writeOpenClawInstallApproval,
  writeOpenClawSensitiveActionDecision,
} from "../src/openclaw-install-approval.js";
import { readPackageArchiveInventory } from "../src/package-archive.js";
import { produceAgentPackage } from "../src/package-produce.js";
import { serializePersistableJson } from "../src/persistability.js";
import { probeOpenClawTarget } from "../src/openclaw-probe.js";
import {
  buildOpenClawAuthorityRootBinding,
  createOpenClawAuthorityRootBinding,
  writeOpenClawAuthorityRootBinding,
} from "../src/openclaw-authority-root-binding.js";
import {
  openOpenClawCanonicalAuthorityLedger,
} from "../src/openclaw-authority-consumption.js";
import {
  buildApprovedPackageFixture,
  packageProduceOptions,
} from "./helpers/package-produce-fixture.js";
import { NATIVE_OPENCLAW_FS } from "./helpers/native-openclaw-fs.js";

const sha256 = (bytes) => (
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`
);
const digestJson = (value, subject) => sha256(Buffer.from(
  serializePersistableJson(value, { subject }),
  "utf8",
));
const canonicalAuthorityStateRoot = async (openClawTargetRoot, probe) => (
  path.join(
    path.dirname(await realpath(openClawTargetRoot)),
    `.agentmo-openclaw-authority-${probe.target.descriptorDigest.slice(
      "sha256:".length,
    )}`,
  )
);
const fixtureAuthorityRootBinding = () => buildOpenClawAuthorityRootBinding({
  targetDescriptorDigest: sha256(Buffer.from("fixture:target-descriptor")),
  targetRootIdentity: { device: "1", inode: "29" },
  rootIdentity: { device: "1", inode: "30" },
});
const CLI = fileURLToPath(new URL("../bin/agentmo.js", import.meta.url));
let fsHelperPath;
let fsHelperReceiptPath;
let fsHelperReceiptDigest;

before(async () => {
  if (!NATIVE_OPENCLAW_FS) return;
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-transaction-fs-helper-"));
  fsHelperPath = path.join(root, "openclaw-fs-kernel");
  fsHelperReceiptPath = path.join(root, "openclaw-fs-kernel.receipt.json");
  const built = await buildOpenClawFsKernel({
    binaryOut: fsHelperPath,
    receiptOut: fsHelperReceiptPath,
  });
  fsHelperReceiptDigest = built.receiptDigest;
});

function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function archiveBinding(label = "transaction") {
  const members = [{
    relativePath: "openclaw/workspace/AGENTS.md",
    type: "file",
    mode: 0o644,
    byteLength: Buffer.byteLength(label),
    sha256: sha256(Buffer.from(label)),
  }];
  return {
    archiveSha256: sha256(Buffer.from(`${label}:archive`)),
    manifestDigest: sha256(Buffer.from(`${label}:manifest`)),
    inventoryDigest: sha256(Buffer.from(`${JSON.stringify(members, null, 2)}\n`)),
    members,
  };
}

function recoveryOptions(root, assets) {
  return {
    rootPath: root,
    helperPath: fsHelperPath,
    receiptPath: fsHelperReceiptPath,
    receiptDigest: fsHelperReceiptDigest,
    assets,
  };
}

function receipt(overrides = {}) {
  const binding = archiveBinding();
  const target = {
    targetId: "openclaw",
    targetVersion: "2026.7.1-2",
    targetRevision: "0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c",
    probeFingerprintDigest: sha256(Buffer.from("probe")),
    scope: "project",
    projectId: "fixture-project",
  };
  const ordinary = {
    family: "ordinary",
    artifact: {
      identity: "agentmo.openclaw-install-approval.v1",
      subject: "openclaw-install-approval",
      digest: sha256(Buffer.from("ordinary-artifact")),
    },
    decisionDigest: sha256(Buffer.from("ordinary-decision")),
    nonceDigest: sha256(Buffer.from("ordinary-nonce")),
    actionId: null,
    actionDigest: null,
    conflictSetDigest: null,
  };
  const conflict = {
    family: "conflict",
    artifact: {
      identity: "agentmo.openclaw-conflict-approval.v1",
      subject: "openclaw-conflict-approval",
      digest: sha256(Buffer.from("conflict-artifact")),
    },
    decisionDigest: sha256(Buffer.from("conflict-decision")),
    nonceDigest: sha256(Buffer.from("conflict-nonce")),
    actionId: null,
    actionDigest: null,
    conflictSetDigest: sha256(Buffer.from("conflict-set")),
  };
  const markerFor = (approval, index) => ({
    family: approval.family,
    path: `${approval.family}/${approval.nonceDigest.slice(7)}.json`,
    digest: sha256(Buffer.from(`${approval.family}-marker`)),
    nonceDigest: approval.nonceDigest,
    decisionDigest: approval.decisionDigest,
    actionDigest: approval.actionDigest,
    conflictSetDigest: approval.conflictSetDigest,
    device: "1",
    inode: String(40 + index),
    status: "created",
    consumed: true,
  });
  const markers = [markerFor(ordinary, 0), markerFor(conflict, 1)];
  const markerBasis = markers.map(({ consumed, status, ...marker }) => {
    void consumed;
    void status;
    return marker;
  });
  const attemptDigest = sha256(Buffer.from("fixture-attempt"));
  const canonicalEvidence = (identity, subject, label) => ({
    identity,
    subject,
    digest: sha256(Buffer.from(`${label}:evidence`)),
    authorityId: sha256(Buffer.from("fixture:authority-ledger")),
    rootIdentity: { device: "1", inode: "30" },
    relativeRef: `${label}/${attemptDigest.slice("sha256:".length)}.json`,
    fileIdentity: { device: "1", inode: label === "post-state" ? "31" : "32" },
    attemptDigest,
  });
  const managedOperation = {
    path: "openclaw/workspace/AGENTS.md",
    operation: "write",
    operationDigest: sha256(Buffer.from("managed-operation")),
    ownerMarker: "agentmo:fixture-project",
    beforeDigest: null,
    beforeFileIdentity: null,
    beforeParentIdentity: { device: "1", inode: "2" },
    afterDigest: binding.members[0].sha256,
    afterFileIdentity: { device: "1", inode: "3" },
    afterParentIdentity: { device: "1", inode: "2" },
    disposition: "succeeded",
    postStateMatches: true,
    rollbackDisposition: "not-required",
    reasonCode: null,
  };
  return {
    schemaVersion: OPENCLAW_INSTALL_RECEIPT_SCHEMA_VERSION,
    status: "complete",
    lifecycle: "install",
    authorityLedger: {
      installPlan: {
        artifact: {
          identity: "agentmo.openclaw-install-plan.v1",
          subject: "openclaw-install-plan",
          digest: sha256(Buffer.from("plan-artifact")),
        },
        installPlanDigest: sha256(Buffer.from("plan")),
      },
      archive: binding,
      target,
      targetDescriptor: {
        identity: "agentmo.openclaw-target-descriptor.v1",
        subject: "openclaw-target-descriptor",
        digest: sha256(Buffer.from("target-descriptor")),
      },
      probe: {
        artifact: {
          identity: "agentmo.openclaw-probe.v1",
          subject: "openclaw-probe",
          digest: sha256(Buffer.from("probe-artifact")),
        },
        fingerprintDigest: target.probeFingerprintDigest,
        executableDigest: sha256(Buffer.from("executable")),
      },
      journal: {
        identity: "agentmo.openclaw-install-private-journal.v1",
        subject: "openclaw-install-private-journal",
        digest: sha256(Buffer.from("journal")),
      },
      attempt: {
        attemptId: "fixture-attempt",
        attemptDigest,
      },
    },
    approvals: {
      ordinary,
      sensitive: [],
      conflict,
    },
    nonceConsumption: {
      markerSetDigest: digestJson(markerBasis, "openclaw-authority-digest"),
      markers,
    },
    predecessor: {
      kind: "absent-genesis",
      absentGenesisDigest: sha256(Buffer.from("genesis")),
    },
    lineage: {
      sequence: 0,
      predecessorReceiptDigest: null,
      selectedPredecessorReceiptDigest: null,
    },
    managedResults: [managedOperation],
    externalResults: [],
    postEffectEvidence: {
      finalization: canonicalEvidence(
        "agentmo.openclaw-install-finalization.v1",
        "openclaw-install-finalization",
        "finalization",
      ),
      postState: canonicalEvidence(
        "agentmo.openclaw-install-post-state.v1",
        "openclaw-install-post-state",
        "post-state",
      ),
      officialActionResults: [],
    },
    preservedAssets: [],
    recovery: {
      required: false,
      disposition: "not-required",
      removedAssets: [],
      preservedAssets: [],
      reasons: [],
    },
    incompleteReasons: [],
    certificationBoundary: {
      lifecycleEvidenceOnly: true,
      runtime: false,
      domain: false,
      birth: false,
      delivery: false,
      production: false,
      widerOpenClawCompatibility: false,
    },
    ...overrides,
  };
}

function genesisAuthority(target, checkedPaths) {
  const observations = checkedPaths.map((relativePath) => ({
    path: relativePath,
    parentIdentity: { device: "1", inode: "2" },
  }));
  const observedAt = "2026-07-30T00:00:00.000Z";
  const basis = {
    target,
    checkedPaths,
    observations,
    observedAt,
  };
  return {
    schemaVersion: "agentmo.openclaw-absent-genesis.v1",
    ...basis,
    absenceObservationDigest: sha256(Buffer.from(
      serializePersistableJson(basis, {
        subject: "openclaw-absent-genesis-observation",
      }),
      "utf8",
    )),
    verifiedAbsent: true,
    certificationBoundary: {
      observedAbsenceOnly: true,
      installed: false,
      runtime: false,
      domain: false,
      production: false,
    },
  };
}

function receiptAuthority(value, digest) {
  return {
    schemaVersion: "agentmo.openclaw-install-receipt-authority.v1",
    receiptDigest: digest,
    lifecycle: value.lifecycle,
    targetId: value.authorityLedger.target.targetId,
    scope: value.authorityLedger.target.scope,
    archiveBinding: value.authorityLedger.archive,
    operationSetDigest: digestJson(
      value.managedResults,
      "openclaw-receipt-operation-set",
    ),
    ownershipDigest: digestJson(
      value.managedResults.map((operation) => ({
        path: operation.path,
        ownerMarker: operation.ownerMarker,
        beforeFileIdentity: operation.beforeFileIdentity,
        beforeParentIdentity: operation.beforeParentIdentity,
      })),
      "openclaw-receipt-ownership",
    ),
    authorityId: value.postEffectEvidence.postState.authorityId,
    rootIdentity: value.postEffectEvidence.postState.rootIdentity,
  };
}

function authorityFixture({
  ordinaryNonce = "authority:ordinary",
  sensitiveNonce = "authority:sensitive",
  conflictNonce = "authority:conflict",
  credentialArgv = [
    "models",
    "auth",
    "login",
    "--provider",
    "fixture-provider",
  ],
} = {}) {
  const binding = archiveBinding("authority");
  const target = {
    targetId: "openclaw",
    targetVersion: "2026.7.1-2",
    targetRevision: "0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c",
    probeFingerprintDigest: sha256(Buffer.from("authority:probe")),
    scope: "project",
    projectId: "fixture-project",
  };
  const conflictDigest = sha256(Buffer.from("authority:current"));
  const desiredDigest = binding.members[0].sha256;
  const plan = buildOpenClawInstallPlan({
    lifecycle: "install",
    archiveBinding: binding,
    authorityRootBinding: fixtureAuthorityRootBinding(),
    target,
    operations: [{
      path: binding.members[0].relativePath,
      operation: "write",
      configPatch: null,
      baseDigest: conflictDigest,
      currentDigest: conflictDigest,
      desiredDigest,
      ownerMarker: "agentmo:fixture-project",
      retainedFileIdentity: { device: "1", inode: "3" },
      retainedParentIdentity: { device: "1", inode: "2" },
      conflict: "external",
      rollbackRule: "remove-if-created-and-pristine",
    }],
    sensitiveActions: [{
      actionId: "setup:openclaw-profile:fixture",
      kind: "credential",
      executable: "openclaw",
      argv: credentialArgv,
      cwd: ".",
      scope: "project",
      target: "openclaw-profile:fixture",
      timeoutMs: 30_000,
      environmentNames: [],
    }],
    conflicts: [{
      path: binding.members[0].relativePath,
      currentDigest: conflictDigest,
      desiredDigest,
      action: "preserve",
    }],
    officialConfigDryRun: {
      commandDigest: sha256(Buffer.from("authority:config-command")),
      resultDigest: sha256(Buffer.from("authority:config-result")),
      accepted: true,
    },
    absentGenesis: genesisAuthority(
      target,
      [binding.members[0].relativePath],
    ),
  });
  const common = {
    plan,
    decision: "approve",
    issuedAt: "2026-07-30T00:00:00.000Z",
    expiresAt: "2099-07-30T00:00:00.000Z",
  };
  const ordinaryApproval = buildOpenClawInstallApproval({
    ...common,
    useNonce: ordinaryNonce,
  });
  const sensitiveDecisions = [buildOpenClawSensitiveActionDecision({
    ...common,
    action: plan.sensitiveActions[0],
    useNonce: sensitiveNonce,
  })];
  const conflictApproval = buildOpenClawConflictApproval({
    ...common,
    conflicts: plan.conflicts,
    useNonce: conflictNonce,
  });
  return {
    plan,
    probe: {
      fingerprintDigest: target.probeFingerprintDigest,
      cli: { executableDigest: sha256(Buffer.from("authority:executable")) },
    },
    ordinaryApproval,
    sensitiveDecisions,
    conflictApproval,
  };
}

describe("OpenClaw install receipt-last transaction", () => {
  it("retains exact ownership when create-only publication durability is unknown", () => {
    const digest = sha256(Buffer.from("created-but-uncertain"));
    const created = {
      disposition: "created-uncertain",
      linked: true,
      digest,
      device: "17",
      inode: "29",
      reason: "post-publication-unknown",
    };
    const operation = {
      path: "workspace/AGENTS.md",
      operation: "create",
      desiredDigest: digest,
    };
    assert.deepEqual(
      classifyOpenClawCreateOnlyPublication(created, operation),
      {
        path: operation.path,
        operation: operation.operation,
        createdByAttempt: true,
        outcome: "preserved",
        observedDigest: digest,
        observedFileIdentity: { device: "17", inode: "29" },
        desiredDigest: digest,
        reason: "post-publication-unknown",
      },
    );
    assert.equal(
      classifyOpenClawCreateOnlyPublication(
        { ...created, linked: false },
        operation,
      ),
      null,
    );
  });

  it("itemizes an uncertain journal as AgentMo-owned recovery evidence", () => {
    const digest = sha256(Buffer.from("journal"));
    assert.deepEqual(
      buildOpenClawJournalDurabilityRecovery({
        disposition: "created-uncertain",
        linked: true,
        digest,
        device: "31",
        inode: "41",
      }, ".agentmo-install.journal.json"),
      {
        path: ".agentmo-install.journal.json",
        createdByAttempt: true,
        disposition: "created-uncertain",
        reason: "post-publication-unknown",
        observedDigest: digest,
        observedFileIdentity: { device: "31", inode: "41" },
      },
    );
  });
  it("rejects false complete receipts with preserved assets", () => {
    const falseComplete = receipt({
      preservedAssets: [{
        path: "openclaw/workspace/AGENTS.md",
        observedDigest: archiveBinding().members[0].sha256,
        reasonCode: "published-asset-preserved",
      }],
      recovery: {
        required: true,
        disposition: "preserved",
        removedAssets: [],
        preservedAssets: [{
          path: "openclaw/workspace/AGENTS.md",
          digest: archiveBinding().members[0].sha256,
        }],
        reasons: ["published-asset-preserved"],
      },
    });

    assert.equal(validateOpenClawInstallReceipt(falseComplete).ok, false);
  });

  it("keeps human and JSON receipt output at the same bounded ledger counts", () => {
    const value = receipt();
    const bytes = Buffer.from(serializePersistableJson(value, {
      subject: "openclaw-install-receipt",
    }), "utf8");
    const digest = sha256(bytes);
    const human = formatOpenClawInstallReceipt(value, digest);
    const json = JSON.stringify({ receipt: value, digest });
    for (const expected of [
      digest,
      value.status,
      `Managed results: ${value.managedResults.length}`,
      `External results: ${value.externalResults.length}`,
      `Preserved: ${value.preservedAssets.length}`,
      `Recovery: ${value.recovery.disposition}`,
      `Post-state evidence: ${value.postEffectEvidence.postState.digest}`,
      `Finalization evidence: ${value.postEffectEvidence.finalization.digest}`,
    ]) {
      assert.equal(human.includes(expected), true, expected);
    }
    assert.equal(human.includes("Official action evidence: none"), true);
    assert.equal(JSON.parse(json).digest, digest);
    assert.equal(
      JSON.parse(json).receipt.managedResults.length,
      value.managedResults.length,
    );
    for (const forbidden of [
      "rawStdout",
      "rawStderr",
      "credentialValue",
      "password",
      "accessToken",
    ]) {
      assert.equal(human.includes(forbidden), false, forbidden);
      assert.equal(json.includes(forbidden), false, forbidden);
    }
  });

  it("durable nonce replay rejects a fresh attempt for ordinary, sensitive and conflict markers", {
    skip: !NATIVE_OPENCLAW_FS,
  }, async () => {
    const {
      prepareOpenClawAuthorityStateRoot,
      reserveOpenClawAuthoritySet,
    } = await import("../src/openclaw-authority-consumption.js");
    const authorityStateRoot = await mkdtemp(
      path.join(tmpdir(), "agentmo-authority-replay-"),
    );
    await chmod(authorityStateRoot, 0o700);
    await prepareOpenClawAuthorityStateRoot(authorityStateRoot);
    const fixture = authorityFixture();
    const firstSession = await (await import("../src/openclaw-safe-fs.js"))
      .openOpenClawSafeFsSession({
        rootPath: authorityStateRoot,
        helperPath: fsHelperPath,
        receiptPath: fsHelperReceiptPath,
        receiptDigest: fsHelperReceiptDigest,
      });
    const first = await reserveOpenClawAuthoritySet({
      session: firstSession,
      attemptId: "attempt:first",
      now: "2026-07-30T00:30:00.000Z",
      ...fixture,
    });
    assert.equal(first.status, "created");
    assert.deepEqual(
      first.markers.map(({ family }) => family),
      ["ordinary", "sensitive", "conflict"],
    );
    await firstSession.close();

    const replaySession = await (await import("../src/openclaw-safe-fs.js"))
      .openOpenClawSafeFsSession({
        rootPath: authorityStateRoot,
        helperPath: fsHelperPath,
        receiptPath: fsHelperReceiptPath,
        receiptDigest: fsHelperReceiptDigest,
      });
    await assert.rejects(
      () => reserveOpenClawAuthoritySet({
        session: replaySession,
        attemptId: "attempt:fresh-process",
        now: "2026-07-30T00:30:00.000Z",
        ...fixture,
      }),
      (error) => [
        "AGENTMO_OPENCLAW_AUTHORITY_REPLAY_REJECTED",
        "AGENTMO_OPENCLAW_AUTHORITY_RECOVERY_REQUIRED",
      ].includes(error?.code),
    );
    await replaySession.close();
    for (const family of ["ordinary", "sensitive", "conflict"]) {
      assert.equal((await readdir(path.join(authorityStateRoot, family))).length, 1);
    }
  });

  it("rejects fresh and replay-shaped cross-family nonce collisions before marker effects", async () => {
    const {
      reserveOpenClawAuthoritySet,
    } = await import("../src/openclaw-authority-consumption.js");
    const fixture = authorityFixture({
      ordinaryNonce: "authority:shared",
      sensitiveNonce: "authority:shared",
      conflictNonce: "authority:shared",
    });
    let reserveCalls = 0;
    let observeCalls = 0;
    const session = {
      async reserveMarker() {
        reserveCalls += 1;
        throw new Error("reservation must not be reached");
      },
      async observe() {
        observeCalls += 1;
        throw new Error("observation must not be reached");
      },
    };

    for (const attemptId of [
      "attempt:cross-family-collision:fresh",
      "attempt:cross-family-collision:replay",
    ]) {
      await assert.rejects(
        () => reserveOpenClawAuthoritySet({
          session,
          attemptId,
          now: "2026-07-30T00:30:00.000Z",
          ...fixture,
        }),
        (error) => error?.code === "AGENTMO_OPENCLAW_AUTHORITY_NONCE_REUSED",
      );
    }
    assert.equal(reserveCalls, 0);
    assert.equal(observeCalls, 0);
  });

  it("concurrent reservation permits at most one exact attempt without a global lock", {
    skip: !NATIVE_OPENCLAW_FS,
  }, async () => {
    const {
      prepareOpenClawAuthorityStateRoot,
      reserveOpenClawAuthoritySet,
    } = await import("../src/openclaw-authority-consumption.js");
    const { openOpenClawSafeFsSession } = await import("../src/openclaw-safe-fs.js");
    const authorityStateRoot = await mkdtemp(
      path.join(tmpdir(), "agentmo-authority-concurrent-"),
    );
    await chmod(authorityStateRoot, 0o700);
    await prepareOpenClawAuthorityStateRoot(authorityStateRoot);
    const fixture = authorityFixture();
    const sessions = await Promise.all([0, 1].map(() => (
      openOpenClawSafeFsSession({
        rootPath: authorityStateRoot,
        helperPath: fsHelperPath,
        receiptPath: fsHelperReceiptPath,
        receiptDigest: fsHelperReceiptDigest,
      })
    )));
    const outcomes = await Promise.allSettled(sessions.map((session, index) => (
      reserveOpenClawAuthoritySet({
        session,
        attemptId: `attempt:concurrent:${index}`,
        now: "2026-07-30T00:30:00.000Z",
        ...fixture,
      })
    )));
    assert.equal(
      outcomes.filter(({ status }) => status === "fulfilled").length <= 1,
      true,
    );
    await Promise.all(sessions.map((session) => session.close()));
  });

  it("rejects a fresh reprobe bypass or old approved-probe fallback in public apply", async () => {
    const source = await readFile(
      fileURLToPath(new URL("../src/openclaw-install-transaction.js", import.meta.url)),
      "utf8",
    );
    assert.equal(/\badapters\b/u.test(source), false);
    assert.equal(/return basis\.probe/u.test(source), false);
  });

  it("publishes complete and incomplete receipts create-only from validated values", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-transaction-receipt-"));
    const output = path.join(root, "receipt.json");
    const candidate = receipt();
    assert.equal(validateOpenClawInstallReceipt(candidate).ok, true);

    const published = await writeOpenClawInstallReceipt(output, candidate);
    const bytes = await readFile(output);
    assert.equal(published.digest, sha256(bytes));
    assert.equal(published.filePath, output);
    await assert.rejects(
      () => writeOpenClawInstallReceipt(output, candidate),
      (error) => error?.code === "EEXIST",
    );

    const incomplete = receipt({
      status: "incomplete",
      managedResults: [{
        ...receipt().managedResults[0],
        afterDigest: null,
        afterFileIdentity: null,
        disposition: "failed",
        postStateMatches: false,
        rollbackDisposition: "recovery-required",
        reasonCode: "identity-mismatch",
      }],
      preservedAssets: [{
        path: "openclaw/workspace/AGENTS.md",
        observedDigest: null,
        reasonCode: "identity-mismatch",
      }],
      recovery: {
        required: true,
        disposition: "preserved",
        removedAssets: [],
        preservedAssets: [{
          path: "openclaw/workspace/AGENTS.md",
          digest: null,
        }],
        reasons: ["identity-mismatch"],
      },
      incompleteReasons: ["identity-mismatch"],
    });
    const incompletePath = path.join(root, "incomplete.json");
    await writeOpenClawInstallReceipt(incompletePath, incomplete);
    assert.equal(JSON.parse(await readFile(incompletePath, "utf8")).status, "incomplete");
  });

  it("preserves a failed receipt output instead of pathname cleanup", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-transaction-receipt-failure-"));
    const output = path.join(root, "receipt.json");
    const candidate = receipt();
    const driftingOpen = async (filePath, flags, mode) => {
      const handle = await open(filePath, flags, mode);
      return {
        stat: (options) => handle.stat(options),
        async writeFile() {
          await handle.writeFile("{}\n", "utf8");
        },
        sync: () => handle.sync(),
        close: () => handle.close(),
      };
    };

    await assert.rejects(
      () => writeOpenClawInstallReceipt(
        output,
        candidate,
        { openOutput: driftingOpen },
      ),
      (error) => error?.code === "AGENTMO_PERSISTABILITY_OUTPUT_MISMATCH",
    );
    assert.equal(await readFile(output, "utf8"), "{}\n");
  });

  it("rejects cached recovery booleans and preserves every named object", {
    skip: !NATIVE_OPENCLAW_FS,
  }, async () => {
    const variants = [
      { cachedAuthentic: true },
      { ownerMarkerDigestMatches: false },
      { retainedIdentityMatches: false },
      { currentDigestMatchesDesired: false },
    ];
    for (const [index, mismatch] of variants.entries()) {
      const root = await mkdtemp(path.join(tmpdir(), `agentmo-recovery-${index}-`));
      const target = path.join(root, "managed.txt");
      await writeFile(target, "fixture");
      const before = await lstat(target);
      await assert.rejects(() => recoverOpenClawInstallAttempt(recoveryOptions(root, [{
        path: "managed.txt",
        ownerMarkerPath: "owner.marker",
        expectedOwnerMarkerDigest: sha256(Buffer.from("agentmo-owner")),
        retainedIdentity: {
          device: before.dev.toString(),
          inode: before.ino.toString(),
        },
        desiredDigest: sha256(Buffer.from("fixture")),
        createdByAttempt: true,
        ...mismatch,
      }])), (error) => (
        error?.code === "AGENTMO_OPENCLAW_INSTALL_RECOVERY_ARGUMENTS_REJECTED"
      ));
      const after = await lstat(target);
      assert.equal(after.ino, before.ino);
      assert.equal(await readFile(target, "utf8"), "fixture");
    }
  });

  it("preserves an exact reopened published object because deletion is not session-bound", {
    skip: !NATIVE_OPENCLAW_FS,
  }, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-recovery-exact-preserve-"));
    const target = path.join(root, "managed.txt");
    const marker = path.join(root, "owner.marker");
    await writeFile(target, "fixture", { mode: 0o600 });
    await writeFile(marker, "agentmo-owner", { mode: 0o600 });
    const retained = await lstat(target);
    const result = await recoverOpenClawInstallAttempt(recoveryOptions(root, [{
      path: "managed.txt",
      createdByAttempt: true,
      ownerMarkerPath: "owner.marker",
      expectedOwnerMarkerDigest: sha256(Buffer.from("agentmo-owner")),
      retainedIdentity: {
        device: retained.dev.toString(),
        inode: retained.ino.toString(),
      },
      desiredDigest: sha256(Buffer.from("fixture")),
    }]));
    assert.equal(result.status, "incomplete");
    assert.deepEqual(result.removed, []);
    assert.equal(result.preserved.length, 1);
    assert.equal(
      result.preserved[0].reason,
      "reopened-published-object-not-deletable",
    );
    const after = await lstat(target);
    assert.equal(after.ino, retained.ino);
    assert.equal(await readFile(target, "utf8"), "fixture");
  });

  it("recovery replacement stays preserved and incomplete after a new process revalidates it", {
    skip: !NATIVE_OPENCLAW_FS,
  }, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-recovery-replacement-"));
    const target = path.join(root, "managed.txt");
    const displaced = path.join(root, "managed.displaced");
    const marker = path.join(root, "owner.marker");
    await writeFile(target, "approved", { mode: 0o600 });
    await writeFile(marker, "agentmo-owner", { mode: 0o600 });
    const retained = await lstat(target);
    await rename(target, displaced);
    await writeFile(target, "user-replacement", {
      flag: "wx",
      mode: 0o600,
    });
    const replacementBefore = await lstat(target);

    const result = await recoverOpenClawInstallAttempt(recoveryOptions(root, [{
      path: "managed.txt",
      createdByAttempt: true,
      ownerMarkerPath: "owner.marker",
      expectedOwnerMarkerDigest: sha256(Buffer.from("agentmo-owner")),
      retainedIdentity: {
        device: retained.dev.toString(),
        inode: retained.ino.toString(),
      },
      desiredDigest: sha256(Buffer.from("approved")),
    }]));
    assert.equal(result.status, "incomplete");
    assert.deepEqual(result.removed, []);
    assert.equal(result.preserved.length, 1);
    assert.equal(
      result.preserved[0].reason,
      "recovery-revalidation-mismatch",
    );
    assert.equal(await readFile(target, "utf8"), "user-replacement");
    const replacementAfter = await lstat(target);
    assert.equal(replacementAfter.ino, replacementBefore.ino);
    assert.equal(await readFile(displaced, "utf8"), "approved");
  });

  it("keeps both credential grammars proposal-only", () => {
    const routes = [
      ["models-auth", [
        "models",
        "auth",
        "login",
        "--provider",
        "fixture-provider",
      ]],
      ["secrets-apply", [
        "secrets",
        "apply",
        "--from",
        "plan.json",
      ]],
    ];
    for (const [, argv] of routes) {
      const proposal = buildOpenClawCredentialSetupProposal({
        profileReference: "openclaw-profile:fixture",
        missingEnvironmentNames: ["OPENCLAW_API_TOKEN"],
        officialRoute: {
          executable: "openclaw",
          argv,
          timeoutMs: 30_000,
        },
      });
      assert.equal(Object.hasOwn(proposal, "credentialValue"), false);
      assert.equal(proposal.certificationBoundary.proposalOnly, true);
      assert.equal(proposal.certificationBoundary.installed, false);
    }
  });

  it("returns honest unsupported after native credential authority reservation", {
    skip: !NATIVE_OPENCLAW_FS,
  }, async () => {
    const {
      prepareOpenClawAuthorityStateRoot,
      reserveOpenClawAuthoritySet,
    } = await import("../src/openclaw-authority-consumption.js");
    const { openOpenClawSafeFsSession } = await import("../src/openclaw-safe-fs.js");
    const argv = [
      "models",
      "auth",
      "login",
      "--provider",
      "fixture-provider",
    ];
    const proposal = buildOpenClawCredentialSetupProposal({
      profileReference: "openclaw-profile:fixture",
      missingEnvironmentNames: ["OPENCLAW_API_TOKEN"],
      officialRoute: {
        executable: "openclaw",
        argv,
        timeoutMs: 30_000,
      },
    });
    const fixture = authorityFixture({
      ordinaryNonce: "authority:route:ordinary",
      sensitiveNonce: "authority:route:sensitive",
      conflictNonce: "authority:route:conflict",
      credentialArgv: argv,
    });
    const authorityStateRoot = await mkdtemp(
      path.join(tmpdir(), "agentmo-credential-models-auth-authority-"),
    );
    await chmod(authorityStateRoot, 0o700);
    await prepareOpenClawAuthorityStateRoot(authorityStateRoot);
    const session = await openOpenClawSafeFsSession({
      rootPath: authorityStateRoot,
      helperPath: fsHelperPath,
      receiptPath: fsHelperReceiptPath,
      receiptDigest: fsHelperReceiptDigest,
    });
    try {
        const authorityReservation = await reserveOpenClawAuthoritySet({
          session,
          attemptId: "attempt:route",
          now: "2026-07-30T00:30:00.000Z",
          ...fixture,
        });

        const handoffOptions = {
          proposal,
          decision: fixture.sensitiveDecisions[0],
          validation: {
            plan: fixture.plan,
            now: "2026-07-30T00:30:00.000Z",
            authorityReservation,
            probe: fixture.probe,
          },
          verifiedExecutable: {
            path: path.join(authorityStateRoot, "must-not-be-created"),
            digest: fixture.probe.cli.executableDigest,
          },
        };
        let processStarts = 0;
        await assert.rejects(
          () => runApprovedOpenClawCredentialHandoff({
            ...handoffOptions,
            runOfficialRoute: async () => {
              processStarts += 1;
              throw new Error("credential process must not start");
            },
          }),
          (error) => (
            error?.code === "AGENTMO_OPENCLAW_CREDENTIAL_APPROVAL_INVALID"
          ),
        );

        assert.equal(processStarts, 0, "models-auth");
        const result = await runApprovedOpenClawCredentialHandoff(
          handoffOptions,
        );
        assert.deepEqual(Object.keys(result).sort(), [
          "actionDigest",
          "credentialPresent",
          "decisionDigest",
          "disposition",
          "processStarted",
          "rawOutputPersisted",
          "route",
          "unsupportedReason",
        ]);
        assert.equal(result.route, "official-openclaw-auth");
        assert.equal(result.disposition, "unsupported");
        assert.equal(
          result.unsupportedReason,
          "phase4-credential-state-proof-unavailable",
        );
        assert.equal(result.credentialPresent, false);
        assert.equal(result.processStarted, false);
        assert.equal(result.rawOutputPersisted, false);
        assert.match(result.actionDigest, /^sha256:[a-f0-9]{64}$/u);
        assert.match(result.decisionDigest, /^sha256:[a-f0-9]{64}$/u);
        await assert.rejects(() => access(
          path.join(authorityStateRoot, "must-not-be-created"),
        ));
    } finally {
      await session.close();
    }
  });

  it("credential argv rejects plugin, MCP, config, agent, schedule, restart and token confusion", () => {
    const invalidRoutes = [
      ["plugins", "install", "fixture-plugin"],
      ["mcp", "connect", "fixture-server"],
      ["config", "patch", "--file", "fixture.json"],
      ["agent", "invoke", "fixture-agent"],
      ["schedule", "add", "fixture-schedule"],
      ["restart"],
      ["models", "auth", "login", "--provider", "fixture", "--force"],
      ["models", "auth", "login", "--provider", "fixture", "--provider", "other"],
      ["models", "login", "auth", "--provider", "fixture"],
      ["secrets", "apply", "--dry-run", "--from", "fixture-plan.json"],
    ];
    for (const argv of invalidRoutes) {
      assert.throws(
        () => buildOpenClawCredentialSetupProposal({
          profileReference: "openclaw-profile:fixture",
          missingEnvironmentNames: ["OPENCLAW_API_TOKEN"],
          officialRoute: {
            executable: "openclaw",
            argv,
            timeoutMs: 30_000,
          },
        }),
        (error) => error?.code
          === "AGENTMO_OPENCLAW_CREDENTIAL_PROPOSAL_INVALID",
        argv.join(" "),
      );
    }
  });

  it("rejects parsed authorities and package-root shortcuts before creating a journal", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-transaction-pre-effect-"));
    const journal = path.join(root, "journal.json");
    const target = path.join(root, "target");
    await mkdir(target);
    await assert.rejects(
      () => applyOpenClawInstallPlan({
        packageRoot: root,
        installPlan: {},
        outputPath: path.join(root, "receipt.json"),
        effects: { journalPath: journal },
      }),
      (error) => error?.code === "AGENTMO_OPENCLAW_INSTALL_ARGUMENTS_REJECTED",
    );
    await assert.rejects(() => access(journal));
    assert.deepEqual(await readFile(path.join(root, "..", path.basename(root)), "utf8").catch(() => null), null);
  });

  it("requires the explicit admitted safe fs helper tuple before any journal or target effect", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-transaction-safe-fs-tuple-"));
    const target = path.join(root, "target");
    await mkdir(target);
    const output = path.join(root, "receipt.json");
    await assert.rejects(
      () => applyOpenClawInstallPlan({
        targetRoot: target,
        openClawTargetRoot: target,
        outputPath: output,
        sensitiveDecisions: [],
      }),
      (error) => error?.code === "AGENTMO_OPENCLAW_INSTALL_ARGUMENTS_REJECTED",
    );
    assert.deepEqual(await readdir(target), []);
    await assert.rejects(() => access(output));
  });

  it("executes an isolated install, upgrade, rollback, and uninstall receipt chain through official config", {
    skip: !NATIVE_OPENCLAW_FS,
  }, async () => {
    const targetExecutableSource = [
      "import { fsyncSync, ftruncateSync, readFileSync, writeSync } from 'node:fs';",
      "const argv = process.argv.slice(2);",
      "if (argv[0] !== 'config' || argv[1] !== 'patch') process.exit(0);",
      "if (argv[2] !== '--file') process.exit(64);",
      "const patch = JSON.parse(readFileSync(new URL(argv[3], `file://${process.cwd()}/`), 'utf8'));",
      "const configFd = Number(process.env.OPENCLAW_CONFIG_PATH.split('/').at(-1));",
      "const current = JSON.parse(readFileSync(configFd, 'utf8'));",
      "const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);",
      "const merge = (left, right) => { const next = { ...left }; for (const [key, value] of Object.entries(right)) { if (value === null) delete next[key]; else next[key] = plain(value) && plain(next[key]) ? merge(next[key], value) : value; } return next; };",
      "if (!argv.includes('--dry-run')) { const bytes = Buffer.from(`${JSON.stringify(merge(current, patch), null, 2)}\\n`); ftruncateSync(configFd, 0); writeSync(configFd, bytes, 0, bytes.length, 0); fsyncSync(configFd); }",
      "",
    ].join("\n");
    const fixture = await buildApprovedPackageFixture({ targetExecutableSource });
    const root = fixture.root;
    const archivePath = path.join(root, "lifecycle-package.d42");
    const produced = await produceAgentPackage(
      packageProduceOptions(fixture, path.join(root, "lifecycle-package"), archivePath),
    );
    const archiveInventory = await readPackageArchiveInventory({
      archivePath,
      expectedArchiveDigest: produced.archiveDigest,
    });
    const archiveBindingValue = {
      archiveSha256: produced.archiveDigest,
      ...archiveInventory,
    };
    const agentMember = archiveInventory.members.find(
      ({ relativePath }) => relativePath === "projections/openclaw/workspace/AGENTS.md",
    );
    const soulMember = archiveInventory.members.find(
      ({ relativePath }) => relativePath === "projections/openclaw/workspace/SOUL.md",
    );
    assert.ok(agentMember);
    assert.ok(soulMember);

    const targetRoot = path.join(root, "isolated-lifecycle-target");
    const generationA = ".agentmo/generations/generation-a/AGENTS.md";
    const generationB = ".agentmo/generations/generation-b/SOUL.md";
    const configRelativePath = "openclaw.json";
    await mkdir(path.join(targetRoot, path.dirname(generationA)), { recursive: true });
    await mkdir(path.join(targetRoot, path.dirname(generationB)), { recursive: true });
    const initialConfig = { unknown: { preserved: "exact-value" } };
    await writeFile(
      path.join(targetRoot, configRelativePath),
      `${JSON.stringify(initialConfig, null, 2)}\n`,
      { mode: 0o600 },
    );

    const openClawTargetRoot = path.dirname(
      fixture.inputs.targetFiles.packageJsonPath,
    );
    const probe = await probeOpenClawTarget({
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
      targetRoot: openClawTargetRoot,
    });
    assert.equal(probe.status, "compatible");
    const probePath = path.join(root, "lifecycle-probe.json");
    await writeFile(
      probePath,
      serializePersistableJson(probe, { subject: "openclaw-probe" }),
    );
    const probeDigest = sha256(await readFile(probePath));
    const target = {
      targetId: probe.target.id,
      targetVersion: probe.target.version,
      targetRevision: probe.target.sourceRevision,
      probeFingerprintDigest: probe.fingerprintDigest,
      scope: "project",
      projectId: "fixture-project",
    };

    const genesisSession = await (await import("../src/openclaw-safe-fs.js"))
      .openOpenClawSafeFsSession({
        rootPath: targetRoot,
        helperPath: fsHelperPath,
        receiptPath: fsHelperReceiptPath,
        receiptDigest: fsHelperReceiptDigest,
      });
    let genesis;
    try {
      genesis = await buildOpenClawAbsentGenesisAuthority({
        target,
        operations: [{
          path: generationA,
          operation: "write",
          currentDigest: null,
        }],
        observedAt: "2026-07-30T00:00:00.000Z",
        session: genesisSession,
      });
    } finally {
      await genesisSession.close();
    }
    const genesisPath = path.join(root, "lifecycle-genesis.json");
    const genesisWritten = await writeOpenClawAbsentGenesisAuthority(
      genesisPath,
      genesis,
    );
    const authorityStateRoot = await canonicalAuthorityStateRoot(
      openClawTargetRoot,
      probe,
    );
    await mkdir(authorityStateRoot, { mode: 0o700 });
    const authorityRootBinding = await createOpenClawAuthorityRootBinding({
      openClawTargetRoot,
      targetDescriptor: fixture.inputs.targetDescriptor.value,
    });
    const authorityRootBindingPath = path.join(
      root,
      "authority-root-binding.json",
    );
    const authorityRootBindingWritten = await writeOpenClawAuthorityRootBinding(
      authorityRootBindingPath,
      authorityRootBinding,
    );
    const receipts = new Map();
    const configFor = (generation) => generation === null
      ? initialConfig
      : {
        ...initialConfig,
        agents: {
          "support-triage": {
            workspace: generation,
          },
        },
      };
    const configBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
    const retainedOperation = async ({
      relativePath,
      operation,
      sourcePath = null,
      currentDigest,
      desiredDigest,
      configPatch = null,
    }) => {
      const absolute = path.join(targetRoot, relativePath);
      const parent = await lstat(path.dirname(absolute));
      const file = await lstat(absolute).catch((error) => {
        if (error?.code === "ENOENT") return null;
        throw error;
      });
      return {
        path: relativePath,
        operation,
        sourcePath,
        configPatch,
        baseDigest: currentDigest,
        currentDigest,
        desiredDigest,
        ownerMarker: "agentmo:fixture-project",
        retainedFileIdentity: file === null ? null : {
          device: file.dev.toString(),
          inode: file.ino.toString(),
        },
        retainedParentIdentity: {
          device: parent.dev.toString(),
          inode: parent.ino.toString(),
        },
        conflict: "none",
        rollbackRule: operation === "write"
          ? "remove-if-created-and-pristine"
          : "restore-if-owned-and-current-digest-matches",
      };
    };

    const runLifecycle = async ({
      lifecycle,
      fromConfig,
      toConfig,
      writeMember = null,
      writePath = null,
      current = null,
      selected = null,
      credentialAction = null,
      includeConfigAction = true,
      expectedStatus = "complete",
      recordKey = lifecycle,
      expectPredecessorRejection = false,
    }) => {
      const patch = toConfig === initialConfig
        ? { agents: null }
        : { agents: toConfig.agents };
      const patchDigest = digestJson(patch, "openclaw-official-config-patch");
      const operations = [];
      if (writeMember !== null) {
        operations.push(await retainedOperation({
          relativePath: writePath,
          operation: "write",
          sourcePath: writeMember.relativePath,
          currentDigest: null,
          desiredDigest: writeMember.sha256,
        }));
      }
      if (includeConfigAction) {
        operations.push(await retainedOperation({
          relativePath: configRelativePath,
          operation: lifecycle === "uninstall" ? "remove" : "patch",
          currentDigest: sha256(configBytes(fromConfig)),
          desiredDigest: sha256(configBytes(toConfig)),
          configPatch: { patch, patchDigest },
        }));
      }
      operations.sort((left, right) => (
        Buffer.from(left.path).compare(Buffer.from(right.path))
      ));
      const configAction = {
        actionId: `config:${lifecycle}:openclaw.json`,
        kind: "external-command",
        executable: "openclaw",
        argv: [
          "config",
          "patch",
          "--file",
          `agentmo-config-patch-${patchDigest.slice("sha256:".length)}.json`,
        ],
        cwd: ".",
        scope: "project",
        target: configRelativePath,
        timeoutMs: 10_000,
        environmentNames: [],
      };
      const actions = [
        ...(includeConfigAction ? [configAction] : []),
        ...(credentialAction === null ? [] : [credentialAction]),
      ];
      const predecessorOptions = lifecycle === "install"
        ? { absentGenesis: genesis }
        : lifecycle === "rollback"
          ? {
            currentReceipt: receiptAuthority(current.receipt, current.digest),
            selectedPredecessorReceipt: receiptAuthority(
              selected.receipt,
              selected.digest,
            ),
            selectedPredecessorArchiveBinding: archiveBindingValue,
          }
          : {
            currentReceipt: receiptAuthority(current.receipt, current.digest),
          };
      const plan = buildOpenClawInstallPlan({
        lifecycle,
        archiveBinding: archiveBindingValue,
        authorityRootBinding,
        target,
        operations,
        sensitiveActions: actions,
        conflicts: [],
        officialConfigDryRun: {
          commandDigest: sha256(Buffer.from(`${lifecycle}:config-command`)),
          resultDigest: sha256(Buffer.from(`${lifecycle}:config-result`)),
          accepted: true,
        },
        ...predecessorOptions,
      });
      const planPath = path.join(root, `${recordKey}-plan.json`);
      const planWritten = await writeOpenClawInstallPlan(planPath, plan);
      const common = {
        plan,
        decision: "approve",
        issuedAt: "2026-07-30T00:00:00.000Z",
        expiresAt: "2099-07-30T00:00:00.000Z",
      };
      const ordinary = buildOpenClawInstallApproval({
        ...common,
        useNonce: `${recordKey}:ordinary`,
      });
      const ordinaryPath = path.join(root, `${recordKey}-ordinary.json`);
      const ordinaryWritten = await writeOpenClawInstallApproval(
        ordinaryPath,
        ordinary,
        { plan, now: common.issuedAt },
      );
      const sensitiveRecords = [];
      for (const [index, action] of actions.entries()) {
        const sensitive = buildOpenClawSensitiveActionDecision({
          ...common,
          action,
          useNonce: `${recordKey}:sensitive:${index}`,
        });
        const sensitivePath = path.join(
          root,
          `${recordKey}-sensitive-${index}.json`,
        );
        const sensitiveWritten = await writeOpenClawSensitiveActionDecision(
          sensitivePath,
          sensitive,
          { plan, action, now: common.issuedAt },
        );
        sensitiveRecords.push({
          filePath: sensitivePath,
          digest: sensitiveWritten.digest,
        });
      }
      const conflict = buildOpenClawConflictApproval({
        ...common,
        conflicts: [],
        useNonce: `${recordKey}:conflict`,
      });
      const conflictPath = path.join(root, `${recordKey}-conflict.json`);
      const conflictWritten = await writeOpenClawConflictApproval(
        conflictPath,
        conflict,
        { plan, now: common.issuedAt },
      );
      const outputPath = path.join(root, `${recordKey}-receipt.json`);
      const applyOptions = {
        blueprintPath: fixture.paths.blueprint,
        blueprintDigest: fixture.digests.blueprint,
        buildContractPath: fixture.paths["build-contract"],
        buildContractDigest: fixture.digests["build-contract"],
        planApprovalPath: fixture.paths["plan-approval"],
        planApprovalDigest: fixture.digests["plan-approval"],
        targetDescriptorPath: fixture.paths["openclaw-target-descriptor"],
        targetDescriptorDigest: fixture.digests["openclaw-target-descriptor"],
        targetCarrierAdmissionPath:
          fixture.paths["openclaw-target-carrier-admission"],
        targetCarrierAdmissionDigest:
          fixture.digests["openclaw-target-carrier-admission"],
        archivePath,
        archiveDigest: produced.archiveDigest,
        probePath,
        probeDigest,
        installPlanPath: planPath,
        installPlanDigest: planWritten.digest,
        installApprovalPath: ordinaryPath,
        installApprovalDigest: ordinaryWritten.digest,
        sensitiveDecisions: sensitiveRecords,
        conflictApprovalPath: conflictPath,
        conflictApprovalDigest: conflictWritten.digest,
        absentGenesisPath: lifecycle === "install" ? genesisPath : null,
        absentGenesisDigest:
          lifecycle === "install" ? genesisWritten.digest : null,
        currentReceiptPath: current?.path ?? null,
        currentReceiptDigest: current?.digest ?? null,
        currentReceiptCompanions: current?.companions ?? null,
        selectedPredecessorReceiptPath: selected?.path ?? null,
        selectedPredecessorReceiptDigest: selected?.digest ?? null,
        selectedPredecessorReceiptCompanions:
          lifecycle === "rollback" ? selected.companions : null,
        selectedPredecessorArchivePath:
          lifecycle === "rollback" ? archivePath : null,
        selectedPredecessorArchiveDigest:
          lifecycle === "rollback" ? produced.archiveDigest : null,
        openClawTargetRoot,
        targetRoot,
        outputPath,
        helperPath: fsHelperPath,
        receiptPath: fsHelperReceiptPath,
        receiptDigest: fsHelperReceiptDigest,
        attemptId: `lifecycle:${recordKey}`,
        authorityStateRoot,
        authorityRootBindingPath,
        authorityRootBindingDigest: authorityRootBindingWritten.digest,
      };
      if (expectPredecessorRejection) {
        await assert.rejects(
          () => applyOpenClawInstallPlan(applyOptions),
          (error) => error?.code
            === "AGENTMO_OPENCLAW_INSTALL_RECEIPT_EVIDENCE_REJECTED",
        );
        await assert.rejects(() => access(outputPath));
        return null;
      }
      const result = await applyOpenClawInstallPlan(applyOptions);
      const recorded = {
        ...result,
        path: outputPath,
        companions: {
          installPlan: { filePath: planPath, digest: planWritten.digest },
          ordinaryApproval: {
            filePath: ordinaryPath,
            digest: ordinaryWritten.digest,
          },
          sensitiveDecisions: sensitiveRecords,
          conflictApproval: {
            filePath: conflictPath,
            digest: conflictWritten.digest,
          },
          journal: {
            filePath: result.journalPath,
            digest: result.receipt.authorityLedger.journal.digest,
          },
          probe: { filePath: probePath, digest: probeDigest },
          targetDescriptor: {
            filePath: fixture.paths["openclaw-target-descriptor"],
            digest: fixture.digests["openclaw-target-descriptor"],
          },
          packageManifest: {
            filePath: path.join(produced.outputRoot, "agentmo.package.json"),
            digest: produced.manifestDigest,
          },
          targetCarrierAdmission: {
            filePath: fixture.paths["openclaw-target-carrier-admission"],
            digest: fixture.digests["openclaw-target-carrier-admission"],
          },
          blueprint: {
            filePath: fixture.paths.blueprint,
            digest: fixture.digests.blueprint,
          },
          buildContract: {
            filePath: fixture.paths["build-contract"],
            digest: fixture.digests["build-contract"],
          },
          planApproval: {
            filePath: fixture.paths["plan-approval"],
            digest: fixture.digests["plan-approval"],
          },
          predecessor: current === null
            ? null
            : {
              filePath: current.path,
              digest: current.digest,
              companions: current.companions,
            },
        },
        authorityOptions: {
          openClawTargetRoot,
          helperPath: fsHelperPath,
          receiptPath: fsHelperReceiptPath,
          receiptDigest: fsHelperReceiptDigest,
          authorityRootBinding,
        },
      };
      receipts.set(recordKey, recorded);
      const configUnsupported = process.platform !== "linux"
        && actions.some((action) => action.kind === "external-command");
      assert.equal(
        result.receipt.status,
        configUnsupported ? "incomplete" : expectedStatus,
      );
      assert.equal(result.externalResults.length, actions.length);
      assert.equal(result.receipt.approvals.sensitive.length, actions.length);
      assert.equal(
        result.receipt.nonceConsumption.markers.length,
        actions.length + 2,
      );
      assert.equal(
        result.receipt.managedResults.length,
        plan.operations.length,
      );
      assert.equal(
        result.receipt.externalResults.length,
        plan.sensitiveActions.length,
      );
      assert.equal(
        result.receipt.postEffectEvidence.officialActionResults.length,
        plan.sensitiveActions.length,
      );
      assert.equal(
        result.receipt.lineage.predecessorReceiptDigest,
        current?.digest ?? null,
      );
      assert.deepEqual(
        JSON.parse(await readFile(path.join(targetRoot, configRelativePath), "utf8")),
        configUnsupported ? fromConfig : toConfig,
      );
      return recorded;
    };

    const blockedCredentialAction = {
      actionId: "setup:openclaw-profile:blocked-fixture-provider",
      kind: "credential",
      executable: "openclaw",
      argv: [
        "models",
        "auth",
        "login",
        "--provider",
        "fixture-provider",
      ],
      cwd: ".",
      scope: "project",
      target: "openclaw-profile:blocked-fixture-provider",
      timeoutMs: 10_000,
      environmentNames: [],
    };
    const install = await runLifecycle({
      lifecycle: "install",
      fromConfig: initialConfig,
      toConfig: configFor(path.dirname(generationA)),
      writeMember: agentMember,
      writePath: generationA,
      credentialAction: process.platform === "linux"
        ? null
        : blockedCredentialAction,
    });
    const forgedSuccess = structuredClone(install.receipt);
    forgedSuccess.status = "complete";
    forgedSuccess.managedResults = forgedSuccess.managedResults.map(
      (managed, index) => ({
        ...managed,
        afterDigest: sha256(Buffer.from(`forged-managed-after:${index}`)),
        afterFileIdentity: {
          device: "9001",
          inode: String(9100 + index),
        },
        afterParentIdentity: {
          device: "9001",
          inode: String(9200 + index),
        },
        disposition: "succeeded",
        postStateMatches: true,
        rollbackDisposition: "not-required",
        reasonCode: null,
      }),
    );
    forgedSuccess.externalResults = forgedSuccess.externalResults.map(
      (external, index) => ({
        ...external,
        disposition: "succeeded",
        resultDigest: sha256(Buffer.from(`forged-external-result:${index}`)),
        failureCode: null,
        unsupportedReason: null,
      }),
    );
    forgedSuccess.nonceConsumption.markers =
      forgedSuccess.nonceConsumption.markers.map((marker) => ({
        ...marker,
        status: "created",
        consumed: true,
      }));
    forgedSuccess.nonceConsumption.markerSetDigest = digestJson(
      forgedSuccess.nonceConsumption.markers.map(
        ({ consumed, status, ...marker }) => {
          void consumed;
          void status;
          return marker;
        },
      ),
      "openclaw-authority-digest",
    );
    forgedSuccess.preservedAssets = [];
    forgedSuccess.recovery = {
      required: false,
      disposition: "not-required",
      removedAssets: [],
      preservedAssets: [],
      reasons: [],
    };
    forgedSuccess.incompleteReasons = [];
    const forgedSuccessBytes = Buffer.from(serializePersistableJson(
      forgedSuccess,
      { subject: "openclaw-install-receipt" },
    ), "utf8");
    const forgedSuccessPath = path.join(root, "forged-all-success.json");
    await writeFile(forgedSuccessPath, forgedSuccessBytes);
    await assert.rejects(
      () => admitOpenClawInstallReceiptWithCompanions(
        forgedSuccessPath,
        sha256(forgedSuccessBytes),
        install.companions,
        install.authorityOptions,
      ),
      (error) => error?.code
        === "AGENTMO_OPENCLAW_INSTALL_RECEIPT_EVIDENCE_REJECTED",
    );
    for (const [label, provenance, subject] of [
      [
        "post-state",
        install.receipt.postEffectEvidence.postState,
        "openclaw-install-post-state",
      ],
      [
        "official-action",
        install.receipt.postEffectEvidence.officialActionResults[0],
        "openclaw-official-action-result-evidence",
      ],
      [
        "finalization",
        install.receipt.postEffectEvidence.finalization,
        "openclaw-install-finalization",
      ],
    ]) {
      const canonicalValue = JSON.parse(await readFile(path.join(
        authorityStateRoot,
        ...provenance.relativeRef.split("/"),
      ), "utf8"));
      canonicalValue.plan.artifact.digest = sha256(
        Buffer.from(`forged-${label}-plan-binding`),
      );
      const forgedCanonicalBytes = Buffer.from(serializePersistableJson(
        canonicalValue,
        { subject },
      ), "utf8");
      await writeFile(
        path.join(root, `forged-${label}-outside-ledger.json`),
        forgedCanonicalBytes,
      );
      const forgedEvidenceReceipt = structuredClone(install.receipt);
      if (label === "post-state") {
        forgedEvidenceReceipt.postEffectEvidence.postState.digest =
          sha256(forgedCanonicalBytes);
      } else if (label === "official-action") {
        forgedEvidenceReceipt.postEffectEvidence
          .officialActionResults[0].digest = sha256(forgedCanonicalBytes);
      } else {
        forgedEvidenceReceipt.postEffectEvidence.finalization.digest =
          sha256(forgedCanonicalBytes);
      }
      const forgedEvidenceBytes = Buffer.from(serializePersistableJson(
        forgedEvidenceReceipt,
        { subject: "openclaw-install-receipt" },
      ), "utf8");
      const forgedEvidencePath = path.join(
        root,
        `forged-${label}-provenance.json`,
      );
      await writeFile(forgedEvidencePath, forgedEvidenceBytes);
      await assert.rejects(
        () => admitOpenClawInstallReceiptWithCompanions(
          forgedEvidencePath,
          sha256(forgedEvidenceBytes),
          install.companions,
          install.authorityOptions,
        ),
        (error) => error?.code
          === "AGENTMO_OPENCLAW_INSTALL_RECEIPT_EVIDENCE_REJECTED",
        label,
      );
    }
    const forgedInstall = {
      ...install,
      receipt: forgedSuccess,
      path: forgedSuccessPath,
      digest: sha256(forgedSuccessBytes),
    };
    const installedConfig = process.platform === "linux"
      ? configFor(path.dirname(generationA))
      : initialConfig;
    for (const lifecycle of ["upgrade", "rollback", "uninstall"]) {
      await runLifecycle({
        lifecycle,
        fromConfig: installedConfig,
        toConfig: configFor(path.dirname(generationB)),
        writeMember: soulMember,
        writePath: generationB,
        current: forgedInstall,
        selected: lifecycle === "rollback" ? install : null,
        recordKey: `forged-predecessor-${lifecycle}`,
        expectPredecessorRejection: true,
      });
    }
    assert.deepEqual(
      JSON.parse(await readFile(
        path.join(targetRoot, configRelativePath),
        "utf8",
      )),
      installedConfig,
    );
    await assert.rejects(() => access(path.join(targetRoot, generationB)));

    if (process.platform !== "linux") {
      assert.equal(install.receipt.status, "incomplete");
      assert.equal(install.externalResults[0].disposition, "unsupported");
      assert.equal(
        install.externalResults[0].unsupportedReason,
        "platform-fd-config-transport-unavailable",
      );
      assert.equal(
        install.externalResults[0].publicationDisposition,
        "not-attempted",
      );
      assert.equal(
        install.receipt.externalResults[0].disposition,
        "unsupported",
      );
      assert.equal(
        install.receipt.externalResults[1].disposition,
        "not-attempted",
      );
      assert.equal(
        install.receipt.postEffectEvidence.officialActionResults.length,
        2,
      );
      const reorderedActionEvidence = structuredClone(install.receipt);
      reorderedActionEvidence.postEffectEvidence
        .officialActionResults.reverse();
      const reorderedActionBytes = Buffer.from(serializePersistableJson(
        reorderedActionEvidence,
        { subject: "openclaw-install-receipt" },
      ), "utf8");
      const reorderedActionPath = path.join(
        root,
        "reordered-official-action-evidence.json",
      );
      await writeFile(reorderedActionPath, reorderedActionBytes);
      await assert.rejects(
        () => admitOpenClawInstallReceiptWithCompanions(
          reorderedActionPath,
          sha256(reorderedActionBytes),
          install.companions,
          install.authorityOptions,
        ),
        (error) => error?.code
          === "AGENTMO_OPENCLAW_INSTALL_RECEIPT_EVIDENCE_REJECTED",
      );
      assert.equal(
        install.receipt.incompleteReasons.includes(
          "platform-fd-config-transport-unavailable",
        ),
        true,
      );
      const credentialAction = {
        actionId: "setup:openclaw-profile:darwin-fixture-provider",
        kind: "credential",
        executable: "openclaw",
        argv: [
          "models",
          "auth",
          "login",
          "--provider",
          "fixture-provider",
        ],
        cwd: ".",
        scope: "project",
        target: "openclaw-profile:darwin-fixture-provider",
        timeoutMs: 10_000,
        environmentNames: [],
      };
      const credentialUnsupported = await runLifecycle({
        lifecycle: "upgrade",
        fromConfig: initialConfig,
        toConfig: initialConfig,
        writeMember: soulMember,
        writePath: generationB,
        current: install,
        credentialAction,
        includeConfigAction: false,
        expectedStatus: "incomplete",
        recordKey: "darwin-auth-unsupported",
      });
      assert.equal(
        credentialUnsupported.receipt.externalResults[0].disposition,
        "unsupported",
        credentialUnsupported.receipt.externalResults[0].failureCode,
      );
      assert.equal(
        credentialUnsupported.receipt.externalResults[0].unsupportedReason,
        "phase4-credential-state-proof-unavailable",
      );
      assert.equal(
        credentialUnsupported.receipt.postEffectEvidence
          .officialActionResults.length,
        1,
      );
      const wrongAttemptReceipt = structuredClone(install.receipt);
      wrongAttemptReceipt.postEffectEvidence.postState =
        structuredClone(
          credentialUnsupported.receipt.postEffectEvidence.postState,
        );
      const wrongAttemptBytes = Buffer.from(serializePersistableJson(
        wrongAttemptReceipt,
        { subject: "openclaw-install-receipt" },
      ), "utf8");
      const wrongAttemptPath = path.join(
        root,
        "wrong-attempt-authentic-evidence.json",
      );
      await writeFile(wrongAttemptPath, wrongAttemptBytes);
      await assert.rejects(
        () => admitOpenClawInstallReceiptWithCompanions(
          wrongAttemptPath,
          sha256(wrongAttemptBytes),
          install.companions,
          install.authorityOptions,
        ),
        (error) => error?.code
          === "AGENTMO_OPENCLAW_INSTALL_RECEIPT_EVIDENCE_REJECTED",
      );
      for (const [label, mutate] of [
        ["missing", (value) => {
          value.postEffectEvidence.officialActionResults = [];
        }],
        ["duplicate", (value) => {
          value.postEffectEvidence.officialActionResults.push(
            structuredClone(
              value.postEffectEvidence.officialActionResults[0],
            ),
          );
        }],
      ]) {
        const forgedOrder = structuredClone(credentialUnsupported.receipt);
        mutate(forgedOrder);
        const forgedOrderBytes = Buffer.from(serializePersistableJson(
          forgedOrder,
          { subject: "openclaw-install-receipt" },
        ), "utf8");
        const forgedOrderPath = path.join(
          root,
          `${label}-official-action-evidence.json`,
        );
        await writeFile(forgedOrderPath, forgedOrderBytes);
        await assert.rejects(
          () => admitOpenClawInstallReceiptWithCompanions(
            forgedOrderPath,
            sha256(forgedOrderBytes),
            credentialUnsupported.companions,
            credentialUnsupported.authorityOptions,
          ),
          (error) => error?.code
            === "AGENTMO_OPENCLAW_INSTALL_RECEIPT_EVIDENCE_REJECTED",
        );
      }
      return;
    }

    const receiptAttacks = [
      ["preserved-complete", (value) => {
        value.preservedAssets = [{
          path: value.managedResults[0].path,
          observedDigest: value.managedResults[0].afterDigest,
          reasonCode: "asset-preserved",
        }];
        value.recovery = {
          required: true,
          disposition: "preserved",
          removedAssets: [],
          preservedAssets: [{
            path: value.managedResults[0].path,
            digest: value.managedResults[0].afterDigest,
          }],
          reasons: ["asset-preserved"],
        };
      }],
      ["managed-failed-complete", (value) => {
        value.managedResults[0].disposition = "failed";
        value.managedResults[0].postStateMatches = false;
        value.managedResults[0].rollbackDisposition = "recovery-required";
        value.managedResults[0].reasonCode = "managed-effect-failed";
      }],
      ["external-unsupported-complete", (value) => {
        value.externalResults[0].disposition = "unsupported";
        value.externalResults[0].resultDigest = null;
        value.externalResults[0].unsupportedReason = "unsupported-action";
      }],
      ["missing-external-result", (value) => {
        value.externalResults = [];
      }],
      ["wrong-ordinary-approval", (value) => {
        value.approvals.ordinary.artifact.digest =
          sha256(Buffer.from("forged-ordinary"));
      }],
      ["wrong-sensitive-action", (value) => {
        value.approvals.sensitive[0].actionDigest =
          sha256(Buffer.from("forged-action"));
        value.nonceConsumption.markers[1].actionDigest =
          value.approvals.sensitive[0].actionDigest;
      }],
      ["swapped-nonce-marker", (value) => {
        const ordinaryNonce = value.nonceConsumption.markers[0].nonceDigest;
        value.nonceConsumption.markers[0].nonceDigest =
          value.nonceConsumption.markers[1].nonceDigest;
        value.nonceConsumption.markers[1].nonceDigest = ordinaryNonce;
      }],
      ["wrong-plan", (value) => {
        value.authorityLedger.installPlan.artifact.digest =
          sha256(Buffer.from("forged-plan"));
      }],
      ["wrong-probe", (value) => {
        value.authorityLedger.probe.fingerprintDigest =
          sha256(Buffer.from("forged-probe"));
      }],
      ["wrong-journal", (value) => {
        value.authorityLedger.journal.digest =
          sha256(Buffer.from("forged-journal"));
      }],
      ["forged-post-state-evidence", (value) => {
        value.postEffectEvidence.postState.digest =
          sha256(Buffer.from("forged-post-state-evidence"));
      }],
      ["forged-action-result-evidence", (value) => {
        value.postEffectEvidence.officialActionResults[0].digest =
          sha256(Buffer.from("forged-action-result-evidence"));
      }],
      ["forged-finalization-evidence", (value) => {
        value.postEffectEvidence.finalization.digest =
          sha256(Buffer.from("forged-finalization-evidence"));
      }],
      ["missing-action-result-evidence", (value) => {
        value.postEffectEvidence.officialActionResults = [];
      }],
      ["duplicate-action-result-evidence", (value) => {
        value.postEffectEvidence.officialActionResults.push(
          structuredClone(value.postEffectEvidence.officialActionResults[0]),
        );
      }],
      ["wrong-external-action", (value) => {
        value.externalResults[0].actionId = "config:forged:openclaw.json";
      }],
      ["duplicate-managed-result", (value) => {
        value.managedResults.push(structuredClone(value.managedResults[0]));
      }],
    ];
    for (const [label, mutate] of receiptAttacks) {
      const candidate = structuredClone(install.receipt);
      mutate(candidate);
      const candidatePath = path.join(root, `forged-${label}.json`);
      const candidateBytes = Buffer.from(serializePersistableJson(candidate, {
        subject: "openclaw-install-receipt",
      }), "utf8");
      await writeFile(candidatePath, candidateBytes);
      await assert.rejects(
        () => admitOpenClawInstallReceiptWithCompanions(
          candidatePath,
          sha256(candidateBytes),
          install.companions,
          install.authorityOptions,
        ),
        (error) => error?.code
          === "AGENTMO_OPENCLAW_INSTALL_RECEIPT_EVIDENCE_REJECTED",
        label,
      );
    }
    const forgedJournal = JSON.parse(await readFile(
      install.companions.journal.filePath,
      "utf8",
    ));
    forgedJournal.archiveBinding.archiveSha256 =
      sha256(Buffer.from("forged-journal-archive"));
    const forgedJournalBytes = Buffer.from(serializePersistableJson(
      forgedJournal,
      { subject: "openclaw-install-private-journal" },
    ), "utf8");
    const forgedJournalPath = path.join(root, "forged-journal-companion.json");
    await writeFile(forgedJournalPath, forgedJournalBytes);
    await assert.rejects(
      () => admitOpenClawInstallReceiptWithCompanions(
        install.path,
        install.digest,
        {
          ...install.companions,
          journal: {
            filePath: forgedJournalPath,
            digest: sha256(forgedJournalBytes),
          },
        },
        install.authorityOptions,
      ),
      (error) => [
        "AGENTMO_OPENCLAW_INSTALL_AUTHORITY_REJECTED",
        "AGENTMO_OPENCLAW_INSTALL_RECEIPT_EVIDENCE_REJECTED",
      ].includes(error?.code),
    );
    for (const companions of [
      null,
      {},
      {
        ...install.companions,
        sensitiveDecisions: [
          ...install.companions.sensitiveDecisions,
          install.companions.sensitiveDecisions[0],
        ],
      },
    ]) {
      await assert.rejects(
        () => admitOpenClawInstallReceiptWithCompanions(
          install.path,
          install.digest,
          companions,
          install.authorityOptions,
        ),
        (error) => (
          error?.code === "AGENTMO_OPENCLAW_INSTALL_ARGUMENTS_REJECTED"
        ),
      );
    }
    const unknownAsset = ".agentmo/generations/operator-owned-note.txt";
    const unknownAssetBytes = Buffer.from("operator-owned bytes stay untouched\n");
    await writeFile(path.join(targetRoot, unknownAsset), unknownAssetBytes, {
      mode: 0o600,
    });
    const upgrade = await runLifecycle({
      lifecycle: "upgrade",
      fromConfig: configFor(path.dirname(generationA)),
      toConfig: configFor(path.dirname(generationB)),
      writeMember: soulMember,
      writePath: generationB,
      current: install,
    });
    assert.deepEqual(
      await readFile(path.join(targetRoot, unknownAsset)),
      unknownAssetBytes,
    );
    const rollback = await runLifecycle({
      lifecycle: "rollback",
      fromConfig: configFor(path.dirname(generationB)),
      toConfig: configFor(path.dirname(generationA)),
      current: upgrade,
      selected: install,
    });
    const modifiedInactiveGeneration = Buffer.from(
      "operator modified this inactive generation\n",
    );
    await writeFile(
      path.join(targetRoot, generationB),
      modifiedInactiveGeneration,
    );
    const uninstall = await runLifecycle({
      lifecycle: "uninstall",
      fromConfig: configFor(path.dirname(generationA)),
      toConfig: initialConfig,
      current: rollback,
    });

    assert.deepEqual([...receipts.keys()], [
      "install",
      "upgrade",
      "rollback",
      "uninstall",
    ]);
    assert.equal(
      rollback.receipt.lineage.selectedPredecessorReceiptDigest,
      install.digest,
    );
    assert.equal(uninstall.receipt.lineage.sequence, 3);
    assert.equal(sha256(await readFile(path.join(targetRoot, generationA))), agentMember.sha256);
    assert.deepEqual(
      await readFile(path.join(targetRoot, generationB)),
      modifiedInactiveGeneration,
    );
    assert.deepEqual(
      await readFile(path.join(targetRoot, unknownAsset)),
      unknownAssetBytes,
    );

    const credentialGeneration =
      ".agentmo/generations/proposal-only/AGENTS.md";
    await mkdir(path.dirname(path.join(targetRoot, credentialGeneration)), {
      recursive: true,
    });
    const privateRootsBefore = new Set(
      (await readdir(tmpdir())).filter((name) => (
        name.startsWith("agentmo-openclaw-official-action-")
      )),
    );
    const credentialUnsupported = await runLifecycle({
      lifecycle: "upgrade",
      recordKey: "proposal-unsupported",
      fromConfig: initialConfig,
      toConfig: initialConfig,
      writeMember: agentMember,
      writePath: credentialGeneration,
      current: uninstall,
      includeConfigAction: false,
      credentialAction: {
        actionId: "setup:openclaw-profile:unsupported",
        kind: "credential",
        executable: "openclaw",
        argv: [
          "models",
          "auth",
          "login",
          "--provider",
          "fixture-provider",
        ],
        cwd: ".",
        scope: "project",
        target: "openclaw-profile:unsupported",
        timeoutMs: 10_000,
        environmentNames: [],
      },
      expectedStatus: "incomplete",
    });
    const newPrivateRoots = (await readdir(tmpdir())).filter((name) => (
      name.startsWith("agentmo-openclaw-official-action-")
      && !privateRootsBefore.has(name)
    ));
    assert.deepEqual(newPrivateRoots, []);
    assert.equal(credentialUnsupported.receipt.status, "incomplete");
    assert.equal(
      credentialUnsupported.receipt.managedResults[0].disposition,
      "succeeded",
    );
    assert.deepEqual(
      credentialUnsupported.receipt.externalResults.map((result) => ({
        disposition: result.disposition,
        failureCode: result.failureCode,
        unsupportedReason: result.unsupportedReason,
      })),
      [{
        disposition: "unsupported",
        failureCode: null,
        unsupportedReason: "phase4-credential-state-proof-unavailable",
      }],
    );
    assert.equal(
      credentialUnsupported.receipt.incompleteReasons.includes(
        "phase4-credential-state-proof-unavailable",
      ),
      true,
    );
    assert.equal(
      credentialUnsupported.externalResults[0].credentialPresent,
      false,
    );
    assert.equal(
      credentialUnsupported.externalResults[0].processStarted,
      false,
    );
  });

  it("rejects authority-root replay before effects, then applies inside the canonical disposable root", {
    skip: !NATIVE_OPENCLAW_FS,
  }, async () => {
    const fixture = await buildApprovedPackageFixture();
    const root = fixture.root;
    const targetRoot = path.join(root, "isolated-target");
    const archivePath = path.join(root, "package.d42");
    const carrierPath = fixture.paths["openclaw-target-carrier-admission"];
    const openClawTargetRoot = path.dirname(
      fixture.inputs.targetFiles.packageJsonPath,
    );
    await mkdir(targetRoot);
    const produced = await produceAgentPackage(
      packageProduceOptions(
        fixture,
        path.join(root, "package"),
        archivePath,
      ),
    );
    const archiveDigest = produced.archiveDigest;
    const archiveInventory = await readPackageArchiveInventory({
      archivePath,
      expectedArchiveDigest: archiveDigest,
    });
    const member = archiveInventory.members[0];
    await mkdir(path.dirname(path.join(targetRoot, member.relativePath)), {
      recursive: true,
    });
    const parent = await lstat(
      path.dirname(path.join(targetRoot, member.relativePath)),
    );
    const probe = await probeOpenClawTarget({
      archivePath,
      expectedArchiveDigest: archiveDigest,
      blueprintPath: fixture.paths.blueprint,
      expectedBlueprintDigest: fixture.digests.blueprint,
      buildContractPath: fixture.paths["build-contract"],
      expectedBuildContractDigest: fixture.digests["build-contract"],
      planApprovalPath: fixture.paths["plan-approval"],
      expectedPlanApprovalDigest: fixture.digests["plan-approval"],
      targetCarrierAdmissionPath: carrierPath,
      expectedTargetCarrierAdmissionDigest:
        fixture.digests["openclaw-target-carrier-admission"],
      targetDescriptorPath: fixture.paths["openclaw-target-descriptor"],
      expectedTargetDescriptorDigest:
        fixture.digests["openclaw-target-descriptor"],
      targetRoot: openClawTargetRoot,
    });
    const probePath = path.join(root, "probe.json");
    await writeFile(
      probePath,
      serializePersistableJson(probe, { subject: "openclaw-probe" }),
    );
    const target = {
      targetId: probe.target.id,
      targetVersion: probe.target.version,
      targetRevision: probe.target.sourceRevision,
      probeFingerprintDigest: probe.fingerprintDigest,
      scope: "project",
      projectId: "fixture-project",
    };
    const genesisSession = await (await import("../src/openclaw-safe-fs.js"))
      .openOpenClawSafeFsSession({
        rootPath: targetRoot,
        helperPath: fsHelperPath,
        receiptPath: fsHelperReceiptPath,
        receiptDigest: fsHelperReceiptDigest,
      });
    const genesis = await buildOpenClawAbsentGenesisAuthority({
      target,
      operations: [{
        path: member.relativePath,
        operation: "write",
        currentDigest: null,
      }],
      observedAt: "2026-07-30T00:00:00.000Z",
      session: genesisSession,
    });
    await genesisSession.close();
    const genesisPath = path.join(root, "genesis.json");
    const genesisWritten = await writeOpenClawAbsentGenesisAuthority(
      genesisPath,
      genesis,
    );
    const authorityStateRoot = await canonicalAuthorityStateRoot(
      openClawTargetRoot,
      probe,
    );
    await mkdir(authorityStateRoot, { mode: 0o700 });
    const authorityRootBinding = await createOpenClawAuthorityRootBinding({
      openClawTargetRoot,
      targetDescriptor: fixture.inputs.targetDescriptor.value,
    });
    const authorityRootBindingPath = path.join(
      root,
      "authority-root-binding.json",
    );
    const authorityRootBindingWritten = await writeOpenClawAuthorityRootBinding(
      authorityRootBindingPath,
      authorityRootBinding,
    );
    const plan = buildOpenClawInstallPlan({
      lifecycle: "install",
      archiveBinding: {
        archiveSha256: archiveDigest,
        ...archiveInventory,
      },
      authorityRootBinding,
      target,
      operations: [{
        path: member.relativePath,
        operation: "write",
        configPatch: null,
        baseDigest: null,
        currentDigest: null,
        desiredDigest: member.sha256,
        ownerMarker: "agentmo:fixture-project",
        retainedFileIdentity: null,
        retainedParentIdentity: {
          device: parent.dev.toString(),
          inode: parent.ino.toString(),
        },
        conflict: "none",
        rollbackRule: "remove-if-created-and-pristine",
      }],
      sensitiveActions: [],
      conflicts: [],
      officialConfigDryRun: {
        commandDigest: sha256(Buffer.from("config-command")),
        resultDigest: sha256(Buffer.from("config-result")),
        accepted: true,
      },
      absentGenesis: genesis,
    });
    const planPath = path.join(root, "plan.json");
    const planWritten = await writeOpenClawInstallPlan(planPath, plan);
    const approval = buildOpenClawInstallApproval({
      plan,
      decision: "approve",
      issuedAt: "2026-07-30T00:00:00.000Z",
      expiresAt: "2099-07-30T00:00:00.000Z",
      useNonce: "fixture:ordinary",
    });
    const approvalPath = path.join(root, "approval.json");
    const approvalWritten = await writeOpenClawInstallApproval(
      approvalPath,
      approval,
      {
        plan,
        now: "2026-07-30T00:00:00.000Z",
      },
    );
    const conflictApproval = buildOpenClawConflictApproval({
      plan,
      conflicts: plan.conflicts,
      decision: "approve",
      issuedAt: "2026-07-30T00:00:00.000Z",
      expiresAt: "2099-07-30T00:00:00.000Z",
      useNonce: "fixture:conflict",
    });
    const conflictApprovalPath = path.join(root, "conflict-approval.json");
    const conflictApprovalWritten = await writeOpenClawConflictApproval(
      conflictApprovalPath,
      conflictApproval,
      {
        plan,
        now: "2026-07-30T00:00:00.000Z",
      },
    );
    const probeDigest = sha256(await readFile(probePath));
    const applyArgs = (
      selectedArchive,
      selectedDigest,
      selectedOut,
      selectedHelperReceiptDigest = fsHelperReceiptDigest,
      selectedAttemptId = "fixture-attempt",
    ) => [
      "openclaw-install-apply",
      "--lifecycle", "install",
      "--blueprint", fixture.paths.blueprint,
      "--blueprint-sha256", fixture.digests.blueprint,
      "--build-contract", fixture.paths["build-contract"],
      "--build-contract-sha256", fixture.digests["build-contract"],
      "--plan-approval", fixture.paths["plan-approval"],
      "--plan-approval-sha256", fixture.digests["plan-approval"],
      "--target-descriptor", fixture.paths["openclaw-target-descriptor"],
      "--target-descriptor-sha256",
      fixture.digests["openclaw-target-descriptor"],
      "--target-carrier-admission", carrierPath,
      "--target-carrier-admission-sha256",
      fixture.digests["openclaw-target-carrier-admission"],
      "--archive", selectedArchive,
      "--archive-sha256", selectedDigest,
      "--probe", probePath,
      "--probe-sha256", probeDigest,
      "--install-plan", planPath,
      "--install-plan-sha256", planWritten.digest,
      "--ordinary-approval", approvalPath,
      "--ordinary-approval-sha256", approvalWritten.digest,
      "--conflict-approval", conflictApprovalPath,
      "--conflict-approval-sha256", conflictApprovalWritten.digest,
      "--absent-genesis", genesisPath,
      "--absent-genesis-sha256", genesisWritten.digest,
      "--fs-helper", fsHelperPath,
      "--fs-helper-receipt", fsHelperReceiptPath,
      "--fs-helper-receipt-digest", selectedHelperReceiptDigest,
      "--authority-root-binding", authorityRootBindingPath,
      "--authority-root-binding-sha256", authorityRootBindingWritten.digest,
      "--openclaw-target-root", openClawTargetRoot,
      "--target-root", targetRoot,
      "--attempt-id", selectedAttemptId,
      "--out", selectedOut,
      "--json",
    ];
    const helperDriftOut = path.join(root, "helper-drift-receipt.json");
    const helperDrift = await runCli(applyArgs(
      archivePath,
      archiveDigest,
      helperDriftOut,
      `sha256:${"0".repeat(64)}`,
    ));
    assert.equal(helperDrift.code, 1);
    await assert.rejects(() => access(helperDriftOut));
    await assert.rejects(
      () => access(path.join(targetRoot, member.relativePath)),
    );
    assert.equal(
      (await readdir(targetRoot)).some((name) => name.endsWith(".journal.json")),
      false,
    );

    const callerSelectedRoot = path.join(root, "caller-selected-authority-state");
    await mkdir(callerSelectedRoot, { mode: 0o700 });
    const authorityReplayOut = path.join(root, "authority-replay-receipt.json");
    const authorityReplay = await runCli([
      ...applyArgs(
        archivePath,
        archiveDigest,
        authorityReplayOut,
        fsHelperReceiptDigest,
        "fixture-authority-root-replay",
      ),
      "--authority-state-root",
      callerSelectedRoot,
    ]);
    assert.equal(authorityReplay.code, 1);
    await assert.rejects(() => access(authorityReplayOut));
    await assert.rejects(
      () => access(path.join(targetRoot, member.relativePath)),
    );
    assert.deepEqual(await readdir(callerSelectedRoot), []);
    assert.equal(
      (await readdir(targetRoot)).some((name) => name.endsWith(".journal.json")),
      false,
    );

    const out = path.join(root, "receipt.json");
    const apply = await runCli(applyArgs(archivePath, archiveDigest, out));
    assert.equal(apply.code, 0, apply.stderr || apply.stdout);
    const result = JSON.parse(apply.stdout);
    assert.equal(result.receipt.status, "complete");
    assert.deepEqual(
      result.postEffectProvenance,
      result.receipt.postEffectEvidence,
    );
    assert.equal(
      sha256(await readFile(path.join(targetRoot, member.relativePath))),
      member.sha256,
    );
    assert.equal(result.digest, sha256(await readFile(out)));
    assert.equal(
      (await readdir(root)).includes(path.basename(out)),
      true,
    );

    const originalRootIdentity = await lstat(authorityStateRoot);
    const displacedRoot = `${authorityStateRoot}.displaced`;
    await rename(authorityStateRoot, displacedRoot);
    await cp(displacedRoot, authorityStateRoot, {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
    const replacementIdentity = await lstat(authorityStateRoot);
    assert.notEqual(replacementIdentity.ino, originalRootIdentity.ino);
    const replacedRootOut = path.join(root, "replaced-root-receipt.json");
    const replacedRootReplay = await runCli(applyArgs(
      archivePath,
      archiveDigest,
      replacedRootOut,
    ));
    assert.equal(replacedRootReplay.code, 1);
    await assert.rejects(() => access(replacedRootOut));
    assert.equal(
      (await readdir(targetRoot)).some((name) => (
        name === path.basename(replacedRootOut)
      )),
      false,
    );
    const replacementQuarantine = `${authorityStateRoot}.replacement`;
    await rename(authorityStateRoot, replacementQuarantine);
    await rename(displacedRoot, authorityStateRoot);
    const recoveredLedger = await openOpenClawCanonicalAuthorityLedger({
      openClawTargetRoot,
      targetDescriptor: fixture.inputs.targetDescriptor.value,
      helperPath: fsHelperPath,
      receiptPath: fsHelperReceiptPath,
      receiptDigest: fsHelperReceiptDigest,
      authorityRootBinding,
    });
    assert.equal(recoveredLedger.authorityId, authorityRootBinding.authorityId);
    await recoveredLedger.close();

    const approvedTargetBytes = await readFile(
      path.join(targetRoot, member.relativePath),
    );
    const byteDriftPath = path.join(root, "byte-drift.d42");
    const byteDrift = Buffer.from(await readFile(archivePath));
    byteDrift[byteDrift.length - 2] ^= 1;
    await writeFile(byteDriftPath, byteDrift);
    const byteDriftOut = path.join(root, "byte-drift-receipt.json");
    const rejectedByteDrift = await runCli(
      applyArgs(byteDriftPath, archiveDigest, byteDriftOut),
    );
    assert.equal(rejectedByteDrift.code, 1);
    await assert.rejects(() => access(byteDriftOut));

    const memberDriftPath = path.join(root, "member-drift.d42");
    const memberDrift = JSON.parse(await readFile(archivePath, "utf8"));
    const memberBytes = Buffer.from(memberDrift.members[0].contentBase64, "base64");
    memberBytes[0] ^= 1;
    memberDrift.members[0].contentBase64 = memberBytes.toString("base64");
    await writeFile(memberDriftPath, `${JSON.stringify(memberDrift, null, 2)}\n`);
    const memberDriftOut = path.join(root, "member-drift-receipt.json");
    const rejectedMemberDrift = await runCli(applyArgs(
      memberDriftPath,
      sha256(await readFile(memberDriftPath)),
      memberDriftOut,
    ));
    assert.equal(rejectedMemberDrift.code, 1);
    await assert.rejects(() => access(memberDriftOut));

    const symlinkPath = path.join(root, "archive-link.d42");
    await symlink(archivePath, symlinkPath);
    const symlinkOut = path.join(root, "symlink-receipt.json");
    const rejectedSymlink = await runCli(
      applyArgs(symlinkPath, archiveDigest, symlinkOut),
    );
    assert.equal(rejectedSymlink.code, 1);
    await assert.rejects(() => access(symlinkOut));
    assert.deepEqual(
      await readFile(path.join(targetRoot, member.relativePath)),
      approvedTargetBytes,
    );
  });

  it("publishes an explicit archive-only CLI contract and rejects a missing digest mate pre-effect", async () => {
    const help = await runCli(["openclaw-install-apply", "--help"]);
    assert.equal(help.code, 0, help.stderr);
    for (const flag of [
      "--archive-sha256",
      "--target-carrier-admission-sha256",
      "--probe-sha256",
      "--install-plan-sha256",
      "--ordinary-approval-sha256",
      "--sensitive-decision-sha256",
      "--absent-genesis-sha256",
      "--attempt-id",
      "--current-receipt-companion-install-plan",
      "--current-receipt-companion-sensitive-decision",
      "--predecessor-receipt-companion-journal",
      "--predecessor-receipt-companion-plan-approval",
      "--out",
    ]) {
      assert.equal(help.stdout.includes(flag), true, flag);
    }
    for (const forbidden of [
      "--package-root",
      "--force",
      "--purge",
      "--mcp",
      "--authority-state-root",
      "--evidence-root",
    ]) {
      assert.equal(help.stdout.includes(forbidden), false, forbidden);
    }

    const root = await mkdtemp(path.join(tmpdir(), "agentmo-apply-cli-negative-"));
    const out = path.join(root, "receipt.json");
    const result = await runCli([
      "openclaw-install-apply",
      "--lifecycle", "install",
      "--target-carrier-admission", path.join(root, "carrier.json"),
      "--target-carrier-admission-sha256", `sha256:${"a".repeat(64)}`,
      "--archive", path.join(root, "package.d42"),
      "--archive-sha256", `sha256:${"b".repeat(64)}`,
      "--probe", path.join(root, "probe.json"),
      "--probe-sha256", `sha256:${"c".repeat(64)}`,
      "--install-plan", path.join(root, "plan.json"),
      "--install-plan-sha256", `sha256:${"d".repeat(64)}`,
      "--ordinary-approval", path.join(root, "approval.json"),
      "--ordinary-approval-sha256", `sha256:${"e".repeat(64)}`,
      "--sensitive-decision", path.join(root, "decision.json"),
      "--absent-genesis", path.join(root, "genesis.json"),
      "--absent-genesis-sha256", `sha256:${"f".repeat(64)}`,
      "--target-root", root,
      "--out", out,
      "--json",
    ]);
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stdout).code, "AGENTMO_CLI_REQUEST_REJECTED");
    await assert.rejects(() => access(out));
    assert.deepEqual(
      (await (await import("node:fs/promises")).readdir(root)).sort(),
      [],
    );
  });
});
