import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";
import {
  openOpenClawCanonicalAuthorityLedger,
  reserveOpenClawCanonicalAuthoritySet,
} from "../src/openclaw-authority-consumption.js";
import {
  isAdmittedOpenClawInstallFinalizationEvidence,
  isAdmittedOpenClawInstallPostStateEvidence,
  isAdmittedOpenClawOfficialActionResultEvidence,
  publishOpenClawInstallFinalizationEvidence,
  publishOpenClawInstallPostStateEvidence,
  publishOpenClawOfficialActionResultEvidence,
  reopenOpenClawInstallFinalizationEvidence,
  reopenOpenClawInstallPostStateEvidence,
  reopenOpenClawOfficialActionResultEvidence,
  validateOpenClawInstallFinalizationEvidence,
  validateOpenClawInstallPostStateEvidence,
  validateOpenClawOfficialActionResultEvidence,
} from "../src/openclaw-install-evidence.js";
import {
  buildOpenClawConflictApproval,
  buildOpenClawInstallApproval,
  buildOpenClawSensitiveActionDecision,
} from "../src/openclaw-install-approval.js";
import {
  buildOpenClawInstallPlan,
} from "../src/openclaw-install-plan.js";
import {
  buildOpenClawFsKernel,
  openOpenClawSafeFsSession,
} from "../src/openclaw-safe-fs.js";
import {
  buildOpenClawTargetDescriptor,
} from "../src/openclaw-target-descriptor.js";
import { serializePersistableJson } from "../src/persistability.js";
import {
  createOpenClawAuthorityRootBinding,
} from "../src/openclaw-authority-root-binding.js";

const sha256 = (bytes) => (
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`
);
const digestJson = (value, subject) => sha256(Buffer.from(
  serializePersistableJson(value, { subject }),
  "utf8",
));
const source = (identity, subject, value) => ({
  identity,
  subject,
  digest: digestJson(value, subject),
});

let helperPath;
let helperReceiptPath;
let helperReceiptDigest;

before(async () => {
  const root = await mkdtemp(path.join(
    tmpdir(),
    "agentmo-install-evidence-helper-",
  ));
  await chmod(root, 0o700);
  helperPath = path.join(root, "openclaw-fs-kernel");
  helperReceiptPath = path.join(root, "openclaw-fs-kernel.receipt.json");
  const built = await buildOpenClawFsKernel({
    binaryOut: helperPath,
    receiptOut: helperReceiptPath,
  });
  helperReceiptDigest = built.receiptDigest;
});

function archiveBinding(label = "post-effect") {
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
    inventoryDigest: sha256(Buffer.from(
      `${JSON.stringify(members, null, 2)}\n`,
    )),
    members,
  };
}

function absentGenesis(target, checkedPaths) {
  const observations = checkedPaths.map((relativePath) => ({
    path: relativePath,
    parentIdentity: { device: "1", inode: "2" },
  }));
  const observedAt = "2026-07-31T00:00:00.000Z";
  const basis = { target, checkedPaths, observations, observedAt };
  return {
    schemaVersion: "agentmo.openclaw-absent-genesis.v1",
    ...basis,
    absenceObservationDigest: digestJson(
      basis,
      "openclaw-absent-genesis-observation",
    ),
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

async function makeTarget(label) {
  const parent = await mkdtemp(path.join(
    tmpdir(),
    `agentmo-install-evidence-${label}-`,
  ));
  await chmod(parent, 0o700);
  const root = path.join(parent, "openclaw");
  await mkdir(root, { mode: 0o700 });
  const executablePath = path.join(root, "openclaw.mjs");
  const packageJsonPath = path.join(root, "package.json");
  const buildInfoPath = path.join(root, "build-info.json");
  const version = "2026.7.1-2";
  const commit = "0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c";
  await writeFile(executablePath, "export default true;\n", {
    flag: "wx",
    mode: 0o700,
  });
  await writeFile(packageJsonPath, `${JSON.stringify({
    name: "openclaw",
    version,
    engines: { node: ">=22.19.0 <23 || >=23.11.0" },
  }, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  await writeFile(buildInfoPath, `${JSON.stringify({
    version,
    commit,
  }, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  const digests = {
    "target-executable": sha256(await readFile(executablePath)),
    "target-package-json": sha256(await readFile(packageJsonPath)),
    "target-build-info": sha256(await readFile(buildInfoPath)),
  };
  const descriptor = await buildOpenClawTargetDescriptor({
    executablePath,
    packageJsonPath,
    buildInfoPath,
    digests,
  });
  const descriptorSource = source(
    "agentmo.openclaw-target-descriptor.v1",
    "openclaw-target-descriptor",
    descriptor,
  );
  return { parent, root, descriptor, descriptorSource };
}

async function makeFixture(label = "primary") {
  const target = await makeTarget(label);
  const managedRoot = await mkdtemp(path.join(
    tmpdir(),
    `agentmo-install-evidence-managed-${label}-`,
  ));
  await chmod(managedRoot, 0o700);
  await mkdir(path.join(managedRoot, "openclaw"), { mode: 0o700 });
  await mkdir(path.join(managedRoot, "openclaw", "workspace"), {
    mode: 0o700,
  });
  const binding = archiveBinding("post-effect");
  const managedPath = path.join(
    managedRoot,
    binding.members[0].relativePath,
  );
  await writeFile(managedPath, "post-effect", {
    flag: "wx",
    mode: 0o600,
  });
  const managed = await lstat(managedPath, { bigint: true });
  const managedParent = await lstat(path.dirname(managedPath), {
    bigint: true,
  });
  const planTarget = {
    targetId: "openclaw",
    targetVersion: target.descriptor.target.version,
    targetRevision: target.descriptor.target.sourceRevision,
    probeFingerprintDigest: sha256(Buffer.from(`${label}:probe`)),
    scope: "project",
    projectId: "fixture-project",
  };
  const actions = ["alpha", "beta"].map((name) => ({
    actionId: `setup:openclaw-profile:${name}`,
    kind: "credential",
    executable: "openclaw",
    argv: [
      "models",
      "auth",
      "login",
      "--provider",
      `fixture-${name}`,
    ],
    cwd: ".",
    scope: "project",
    target: `openclaw-profile:${name}`,
    timeoutMs: 30_000,
    environmentNames: [],
  }));
  const authorityRootBinding = await createOpenClawAuthorityRootBinding({
    openClawTargetRoot: target.root,
    targetDescriptor: target.descriptor,
  });
  const plan = buildOpenClawInstallPlan({
    lifecycle: "install",
    archiveBinding: binding,
    authorityRootBinding,
    target: planTarget,
    operations: [{
      path: binding.members[0].relativePath,
      operation: "write",
      configPatch: null,
      baseDigest: binding.members[0].sha256,
      currentDigest: binding.members[0].sha256,
      desiredDigest: binding.members[0].sha256,
      ownerMarker: "agentmo:fixture-project",
      retainedFileIdentity: {
        device: managed.dev.toString(),
        inode: managed.ino.toString(),
      },
      retainedParentIdentity: {
        device: managedParent.dev.toString(),
        inode: managedParent.ino.toString(),
      },
      conflict: "none",
      rollbackRule: "remove-if-created-and-pristine",
    }],
    sensitiveActions: actions,
    conflicts: [],
    officialConfigDryRun: {
      commandDigest: sha256(Buffer.from(`${label}:config-command`)),
      resultDigest: sha256(Buffer.from(`${label}:config-result`)),
      accepted: true,
    },
    absentGenesis: absentGenesis(
      planTarget,
      [binding.members[0].relativePath],
    ),
  });
  const planSource = source(
    "agentmo.openclaw-install-plan.v1",
    "openclaw-install-plan",
    plan,
  );
  const probe = {
    fingerprintDigest: planTarget.probeFingerprintDigest,
    cli: {
      executableDigest: target.descriptor.members.find(
        ({ role }) => role === "executable",
      ).sha256,
    },
  };
  const ledger = await openOpenClawCanonicalAuthorityLedger({
    openClawTargetRoot: target.root,
    targetDescriptor: target.descriptor,
    helperPath,
    receiptPath: helperReceiptPath,
    receiptDigest: helperReceiptDigest,
    authorityRootBinding,
  });
  const targetSession = await openOpenClawSafeFsSession({
    rootPath: managedRoot,
    helperPath,
    receiptPath: helperReceiptPath,
    receiptDigest: helperReceiptDigest,
  });
  return {
    ...target,
    managedRoot,
    plan,
    planSource,
    probe,
    ledger,
    targetSession,
  };
}

function decisions(fixture, suffix) {
  const common = {
    plan: fixture.plan,
    decision: "approve",
    issuedAt: "2026-07-31T00:00:00.000Z",
    expiresAt: "2099-07-31T00:00:00.000Z",
  };
  const ordinaryApproval = buildOpenClawInstallApproval({
    ...common,
    useNonce: `ordinary:${suffix}`,
  });
  const sensitiveDecisions = fixture.plan.sensitiveActions.map(
    (action, index) => buildOpenClawSensitiveActionDecision({
      ...common,
      action,
      useNonce: `sensitive:${suffix}:${index}`,
    }),
  );
  const conflictApproval = buildOpenClawConflictApproval({
    ...common,
    conflicts: fixture.plan.conflicts,
    useNonce: `conflict:${suffix}`,
  });
  return { ordinaryApproval, sensitiveDecisions, conflictApproval };
}

function decisionSource(decision) {
  return source(
    "agentmo.openclaw-sensitive-action-decision.v1",
    "openclaw-sensitive-action-decision",
    decision,
  );
}

function unsupportedCredentialResult(action, decision) {
  return {
    route: "official-openclaw-auth",
    disposition: "unsupported",
    unsupportedReason: "phase4-credential-state-proof-unavailable",
    actionDigest: digestJson(action, "openclaw-install-decision"),
    decisionDigest: digestJson(decision, "openclaw-install-decision"),
    credentialPresent: false,
    processStarted: false,
    rawOutputPersisted: false,
  };
}

async function produceAttempt(fixture, attemptId, suffix) {
  const authority = decisions(fixture, suffix);
  const authorityReservation = await reserveOpenClawCanonicalAuthoritySet({
    ledger: fixture.ledger,
    attemptId,
    now: "2026-07-31T00:30:00.000Z",
    plan: fixture.plan,
    probe: fixture.probe,
    ...authority,
  });
  const journalSource = {
    identity: "agentmo.openclaw-install-private-journal.v1",
    subject: "openclaw-install-private-journal",
    digest: sha256(Buffer.from(`${attemptId}:journal`)),
  };
  const postState = await publishOpenClawInstallPostStateEvidence({
    ledger: fixture.ledger,
    targetSession: fixture.targetSession,
    attemptId,
    plan: fixture.plan,
    planSource: fixture.planSource,
    journalSource,
    targetDescriptorSource: fixture.descriptorSource,
  });
  const actionResults = [];
  for (const [index, action] of fixture.plan.sensitiveActions.entries()) {
    const decision = authority.sensitiveDecisions[index];
    actionResults.push(await publishOpenClawOfficialActionResultEvidence({
      ledger: fixture.ledger,
      attemptId,
      plan: fixture.plan,
      planSource: fixture.planSource,
      probe: fixture.probe,
      action,
      decision,
      decisionSource: decisionSource(decision),
      authorityReservation,
      result: unsupportedCredentialResult(action, decision),
    }));
  }
  return { authority, authorityReservation, postState, actionResults };
}

describe("canonical OpenClaw post-effect evidence", () => {
  it("creates closed post-state and per-action artifacts and admits a fresh reopen", async () => {
    const fixture = await makeFixture("positive");
    const attempt = await produceAttempt(
      fixture,
      "attempt:post-effect:positive",
      "positive",
    );

    assert.equal(
      attempt.postState.value.schemaVersion,
      "agentmo.openclaw-install-post-state.v1",
    );
    assert.equal(attempt.postState.value.rawOutputPersisted, false);
    assert.equal(attempt.postState.value.observations.length, 1);
    assert.equal(
      attempt.postState.value.observationSetDigest,
      digestJson(
        attempt.postState.value.observations,
        "openclaw-install-post-state-observations",
      ),
    );
    assert.equal(
      JSON.stringify(attempt.postState.value).includes("receipt"),
      false,
    );
    assert.deepEqual(
      attempt.actionResults.map(({ value }) => value.action.actionId),
      fixture.plan.sensitiveActions.map(({ actionId }) => actionId),
    );
    assert.equal(
      attempt.actionResults.every(({ value }) => (
        value.resultObservation.disposition === "unsupported"
        && value.rawOutputPersisted === false
        && !Object.hasOwn(value, "receipt")
      )),
      true,
    );

    const reopenedPostState = await reopenOpenClawInstallPostStateEvidence({
      ledger: fixture.ledger,
      provenance: attempt.postState.provenance,
      attemptId: "attempt:post-effect:positive",
      plan: fixture.plan,
      planSource: fixture.planSource,
      journalSource: attempt.postState.value.journal,
      targetDescriptorSource: fixture.descriptorSource,
    });
    const reopenedAction = await reopenOpenClawOfficialActionResultEvidence({
      ledger: fixture.ledger,
      provenance: attempt.actionResults[0].provenance,
      attemptId: "attempt:post-effect:positive",
      plan: fixture.plan,
      planSource: fixture.planSource,
      action: fixture.plan.sensitiveActions[0],
      decision: attempt.authority.sensitiveDecisions[0],
      decisionSource: decisionSource(attempt.authority.sensitiveDecisions[0]),
      probe: fixture.probe,
      authorityReservation: attempt.authorityReservation,
    });
    assert.equal(
      isAdmittedOpenClawInstallPostStateEvidence(reopenedPostState.value),
      true,
    );
    assert.equal(
      isAdmittedOpenClawOfficialActionResultEvidence(reopenedAction.value),
      true,
    );
    await fixture.targetSession.close();
    await fixture.ledger.close();
  });

  it("does not let valid copied JSON plus a recomputed digest mint any producer brand", async () => {
    const fixture = await makeFixture("forgery");
    const attempt = await produceAttempt(
      fixture,
      "attempt:post-effect:forgery",
      "forgery",
    );
    const finalization = await publishOpenClawInstallFinalizationEvidence({
      ledger: fixture.ledger,
      attemptId: "attempt:post-effect:forgery",
      plan: fixture.plan,
      planSource: fixture.planSource,
      probe: fixture.probe,
      authorityReservation: attempt.authorityReservation,
      postState: attempt.postState,
      actionResults: attempt.actionResults,
      predecessor: null,
    });
    const cases = [
      [
        structuredClone(attempt.postState.value),
        "openclaw-install-post-state",
        validateOpenClawInstallPostStateEvidence,
        isAdmittedOpenClawInstallPostStateEvidence,
      ],
      [
        structuredClone(attempt.actionResults[0].value),
        "openclaw-official-action-result-evidence",
        validateOpenClawOfficialActionResultEvidence,
        isAdmittedOpenClawOfficialActionResultEvidence,
      ],
      [
        structuredClone(finalization.value),
        "openclaw-install-finalization",
        validateOpenClawInstallFinalizationEvidence,
        isAdmittedOpenClawInstallFinalizationEvidence,
      ],
    ];
    for (const [forged, subject, validate, isAdmitted] of cases) {
      const recomputedDigest = digestJson(forged, subject);
      assert.match(recomputedDigest, /^sha256:[a-f0-9]{64}$/u);
      assert.equal(validate(forged).ok, true);
      assert.equal(isAdmitted(forged), false);
    }
    await fixture.targetSession.close();
    await fixture.ledger.close();
  });

  it("rejects wrong attempt, plan, root and action bindings on specialized reopen", async () => {
    const fixture = await makeFixture("binding");
    const attempt = await produceAttempt(
      fixture,
      "attempt:post-effect:binding",
      "binding",
    );
    await assert.rejects(
      () => reopenOpenClawInstallPostStateEvidence({
        ledger: fixture.ledger,
        provenance: attempt.postState.provenance,
        attemptId: "attempt:post-effect:wrong",
        plan: fixture.plan,
        planSource: fixture.planSource,
        journalSource: attempt.postState.value.journal,
        targetDescriptorSource: fixture.descriptorSource,
      }),
      (error) => [
        "AGENTMO_OPENCLAW_EVIDENCE_BINDING_REJECTED",
        "AGENTMO_OPENCLAW_EVIDENCE_REPLACED_REJECTED",
      ].includes(error?.code),
    );
    const wrongPlanSource = {
      ...fixture.planSource,
      digest: sha256(Buffer.from("wrong-plan")),
    };
    await assert.rejects(
      () => reopenOpenClawInstallPostStateEvidence({
        ledger: fixture.ledger,
        provenance: attempt.postState.provenance,
        attemptId: "attempt:post-effect:binding",
        plan: fixture.plan,
        planSource: wrongPlanSource,
        journalSource: attempt.postState.value.journal,
        targetDescriptorSource: fixture.descriptorSource,
      }),
      (error) => [
        "AGENTMO_OPENCLAW_EVIDENCE_BINDING_REJECTED",
        "AGENTMO_OPENCLAW_EVIDENCE_REPLACED_REJECTED",
      ].includes(error?.code),
    );
    await assert.rejects(
      () => reopenOpenClawOfficialActionResultEvidence({
        ledger: fixture.ledger,
        provenance: attempt.actionResults[0].provenance,
        attemptId: "attempt:post-effect:binding",
        plan: fixture.plan,
        planSource: fixture.planSource,
        action: fixture.plan.sensitiveActions[1],
        decision: attempt.authority.sensitiveDecisions[1],
        decisionSource: decisionSource(attempt.authority.sensitiveDecisions[1]),
        probe: fixture.probe,
        authorityReservation: attempt.authorityReservation,
      }),
      (error) => [
        "AGENTMO_OPENCLAW_EVIDENCE_BINDING_REJECTED",
        "AGENTMO_OPENCLAW_EVIDENCE_REPLACED_REJECTED",
      ].includes(error?.code),
    );

    const other = await makeFixture("binding-copy");
    const originalAuthorityRoot = path.join(
      fixture.parent,
      `.agentmo-openclaw-authority-${
        fixture.descriptorSource.digest.slice("sha256:".length)
      }`,
    );
    const copiedAuthorityRoot = path.join(
      other.parent,
      `.agentmo-openclaw-authority-${
        other.descriptorSource.digest.slice("sha256:".length)
      }`,
    );
    await writeFile(
      path.join(
        copiedAuthorityRoot,
        ...attempt.postState.provenance.relativeRef.split("/"),
      ),
      await readFile(path.join(
        originalAuthorityRoot,
        ...attempt.postState.provenance.relativeRef.split("/"),
      )),
      { flag: "wx", mode: 0o600 },
    );
    await assert.rejects(
      () => reopenOpenClawInstallPostStateEvidence({
        ledger: other.ledger,
        provenance: attempt.postState.provenance,
        attemptId: "attempt:post-effect:binding",
        plan: fixture.plan,
        planSource: fixture.planSource,
        journalSource: attempt.postState.value.journal,
        targetDescriptorSource: fixture.descriptorSource,
      }),
      (error) => [
        "AGENTMO_OPENCLAW_EVIDENCE_BINDING_REJECTED",
        "AGENTMO_OPENCLAW_EVIDENCE_REPLACED_REJECTED",
      ].includes(error?.code),
    );
    await fixture.targetSession.close();
    await fixture.ledger.close();
    await other.targetSession.close();
    await other.ledger.close();
  });

  it("rejects marker/result omission, duplication, reorder and a forked finalization", async () => {
    const fixture = await makeFixture("finalization");
    const first = await produceAttempt(
      fixture,
      "attempt:post-effect:first",
      "first",
    );
    const finalization = await publishOpenClawInstallFinalizationEvidence({
      ledger: fixture.ledger,
      attemptId: "attempt:post-effect:first",
      plan: fixture.plan,
      planSource: fixture.planSource,
      probe: fixture.probe,
      authorityReservation: first.authorityReservation,
      postState: first.postState,
      actionResults: first.actionResults,
      predecessor: null,
      probe: fixture.probe,
      authorityReservation: first.authorityReservation,
    });
    assert.equal(
      isAdmittedOpenClawInstallFinalizationEvidence(finalization.value),
      true,
    );
    const reopened = await reopenOpenClawInstallFinalizationEvidence({
      ledger: fixture.ledger,
      provenance: finalization.provenance,
      attemptId: "attempt:post-effect:first",
      plan: fixture.plan,
      planSource: fixture.planSource,
      postState: first.postState,
      actionResults: first.actionResults,
      predecessor: null,
      probe: fixture.probe,
      authorityReservation: first.authorityReservation,
    });
    assert.equal(
      isAdmittedOpenClawInstallFinalizationEvidence(reopened.value),
      true,
    );

    const mutations = [
      (value) => value.markers.pop(),
      (value) => value.markers.push(structuredClone(value.markers[0])),
      (value) => value.markers.reverse(),
      (value) => value.officialActionResults.pop(),
      (value) => value.officialActionResults.push(
        structuredClone(value.officialActionResults[0]),
      ),
      (value) => value.officialActionResults.reverse(),
    ];
    for (const mutate of mutations) {
      const forged = structuredClone(finalization.value);
      mutate(forged);
      assert.match(
        digestJson(forged, "openclaw-install-finalization"),
        /^sha256:[a-f0-9]{64}$/u,
      );
      assert.equal(
        validateOpenClawInstallFinalizationEvidence(forged).ok,
        false,
      );
      assert.equal(
        isAdmittedOpenClawInstallFinalizationEvidence(forged),
        false,
      );
    }

    const second = await produceAttempt(
      fixture,
      "attempt:post-effect:fork",
      "fork",
    );
    await assert.rejects(
      () => publishOpenClawInstallFinalizationEvidence({
        ledger: fixture.ledger,
        attemptId: "attempt:post-effect:fork",
        plan: fixture.plan,
        planSource: fixture.planSource,
        probe: fixture.probe,
        authorityReservation: second.authorityReservation,
        postState: second.postState,
        actionResults: second.actionResults,
        predecessor: null,
      }),
      (error) => error?.code === "AGENTMO_OPENCLAW_FINALIZATION_FORK_REJECTED",
    );
    await fixture.targetSession.close();
    await fixture.ledger.close();
  });

  it("preserves unknown and replaced evidence names while failing closed", async () => {
    const unknownFixture = await makeFixture("unknown-name");
    const unknownAttempt = "attempt:post-effect:unknown-name";
    const unknownDigest = sha256(Buffer.from(unknownAttempt));
    const unknownRoot = path.join(
      unknownFixture.parent,
      `.agentmo-openclaw-authority-${
        unknownFixture.descriptorSource.digest.slice("sha256:".length)
      }`,
    );
    const unknownPath = path.join(
      unknownRoot,
      "post-state",
      `${unknownDigest.slice("sha256:".length)}.json`,
    );
    await writeFile(unknownPath, "unknown-winner\n", {
      flag: "wx",
      mode: 0o600,
    });
    await assert.rejects(
      () => publishOpenClawInstallPostStateEvidence({
        ledger: unknownFixture.ledger,
        targetSession: unknownFixture.targetSession,
        attemptId: unknownAttempt,
        plan: unknownFixture.plan,
        planSource: unknownFixture.planSource,
        journalSource: {
          identity: "agentmo.openclaw-install-private-journal.v1",
          subject: "openclaw-install-private-journal",
          digest: sha256(Buffer.from("unknown:journal")),
        },
        targetDescriptorSource: unknownFixture.descriptorSource,
      }),
      (error) => error?.code
        === "AGENTMO_OPENCLAW_EVIDENCE_REPLACED_REJECTED",
    );
    assert.equal(await readFile(unknownPath, "utf8"), "unknown-winner\n");

    const replacedFixture = await makeFixture("replaced-name");
    const produced = await produceAttempt(
      replacedFixture,
      "attempt:post-effect:replaced-name",
      "replaced-name",
    );
    const replacedRoot = path.join(
      replacedFixture.parent,
      `.agentmo-openclaw-authority-${
        replacedFixture.descriptorSource.digest.slice("sha256:".length)
      }`,
    );
    const evidencePath = path.join(
      replacedRoot,
      ...produced.postState.provenance.relativeRef.split("/"),
    );
    const retainedPath = `${evidencePath}.retained`;
    const originalBytes = await readFile(evidencePath);
    await rename(evidencePath, retainedPath);
    await writeFile(evidencePath, "replacement-winner\n", {
      flag: "wx",
      mode: 0o600,
    });
    await assert.rejects(
      () => reopenOpenClawInstallPostStateEvidence({
        ledger: replacedFixture.ledger,
        provenance: produced.postState.provenance,
        attemptId: "attempt:post-effect:replaced-name",
        plan: replacedFixture.plan,
        planSource: replacedFixture.planSource,
        journalSource: produced.postState.value.journal,
        targetDescriptorSource: replacedFixture.descriptorSource,
      }),
      (error) => error?.code
        === "AGENTMO_OPENCLAW_EVIDENCE_REPLACED_REJECTED",
    );
    assert.deepEqual(await readFile(retainedPath), originalBytes);
    assert.equal(await readFile(evidencePath, "utf8"), "replacement-winner\n");
    await unknownFixture.targetSession.close();
    await unknownFixture.ledger.close();
    await replacedFixture.targetSession.close();
    await replacedFixture.ledger.close();
  });
});
