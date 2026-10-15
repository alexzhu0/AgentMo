import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  readdir,
  rename,
  rm,
  link,
  appendFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";
import { NATIVE_OPENCLAW_FS } from "./helpers/native-openclaw-fs.js";
import { getArtifactContract } from "../src/artifact-contract.js";
import { loadAdmittedArtifact } from "../src/artifact-admission.js";
import { produceAgentPackage } from "../src/package-produce.js";
import { serializePersistableJson } from "../src/persistability.js";
import { probeOpenClawTarget } from "../src/openclaw-probe.js";
import {
  OPENCLAW_ABSENT_GENESIS_SCHEMA_VERSION,
  OPENCLAW_INSTALL_PLAN_SCHEMA_VERSION,
  buildOpenClawAbsentGenesisAuthority,
  buildOpenClawInstallPlan,
  validateOpenClawAbsentGenesisAuthority,
  validateOpenClawInstallPlan,
  writeOpenClawAbsentGenesisAuthority,
  writeOpenClawInstallPlan,
} from "../src/openclaw-install-plan.js";
import { openOpenClawSafeFsSession } from "../src/openclaw-safe-fs.js";
import {
  buildOpenClawInstallApproval,
  buildOpenClawInstallReview,
  buildOpenClawConflictApproval,
  buildOpenClawSensitiveActionDecision,
  validateOpenClawInstallApproval,
} from "../src/openclaw-install-approval.js";
import { reserveOpenClawAuthoritySet } from "../src/openclaw-authority-consumption.js";
import * as installPlans from "../src/openclaw-install-plan.js";
import * as nativeAuthority from "../src/native-chat-authority.js";
import {
  buildOpenClawAuthorityRootBinding,
  createOpenClawAuthorityRootBinding,
  writeOpenClawAuthorityRootBinding,
} from "../src/openclaw-authority-root-binding.js";
import {
  buildApprovedPackageFixture,
  packageProduceOptions,
} from "./helpers/package-produce-fixture.js";

const CLI = fileURLToPath(new URL("../bin/agentmo.js", import.meta.url));
const digest = (value, subject = "install-plan-test") => (
  `sha256:${createHash("sha256")
    .update(Buffer.from(serializePersistableJson(value, { subject }), "utf8"))
    .digest("hex")}`
);

it("loads lifecycle entry modules independently without registry initialization cycles", async () => {
  for (const name of ["openclaw-install-plan", "openclaw-install-approval", "openclaw-install-evidence"]) {
    const url = new URL(`../src/${name}.js`, import.meta.url).href;
    const result = await new Promise((resolve) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(url)})`],
        { env: {}, stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.once("close", (code) => resolve({ code, stderr }));
    });
    assert.equal(result.code, 0, `${name}: ${result.stderr}`);
  }
});

function runCli(args) {
  return new Promise((resolveResult) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolveResult({ code, stdout, stderr }));
  });
}

async function lifecycleProbeFixture() {
  const fixture = await buildApprovedPackageFixture();
  const archivePath = path.join(fixture.root, "lifecycle-package.d42");
  const produced = await produceAgentPackage(packageProduceOptions(
    fixture,
    path.join(fixture.root, "lifecycle-package"),
    archivePath,
  ));
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
    targetRoot: path.dirname(fixture.inputs.targetFiles.packageJsonPath),
  });
  const probeFile = path.join(fixture.root, "probe.json");
  const probeDigest = await writeCanonical(probeFile, probe, "probe-fixture");
  return {
    archiveDigest: produced.archiveDigest,
    archivePath,
    fixture,
    probe,
    probeDigest,
    probeFile,
  };
}

function probeAuthorityArgs(value) {
  const { fixture } = value;
  return [
    "--blueprint", fixture.paths.blueprint,
    "--blueprint-sha256", fixture.digests.blueprint,
    "--build-contract", fixture.paths["build-contract"],
    "--build-contract-sha256", fixture.digests["build-contract"],
    "--plan-approval", fixture.paths["plan-approval"],
    "--plan-approval-sha256", fixture.digests["plan-approval"],
    "--target-carrier-admission",
    fixture.paths["openclaw-target-carrier-admission"],
    "--target-carrier-admission-sha256",
    fixture.digests["openclaw-target-carrier-admission"],
    "--target-descriptor", fixture.paths["openclaw-target-descriptor"],
    "--target-descriptor-sha256",
    fixture.digests["openclaw-target-descriptor"],
  ];
}

async function writeCanonical(filePath, value, subject) {
  const bytes = Buffer.from(
    serializePersistableJson(value, { subject }),
    "utf8",
  );
  await writeFile(filePath, bytes);
  return digestBytes(bytes);
}
const digestBytes = (bytes) => (
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`
);

function archiveBinding(label = "current") {
  const members = [
    {
      relativePath: "agentmo.package.json",
      type: "file",
      mode: 0o644,
      byteLength: 17,
      sha256: digest(`${label}:manifest`),
    },
    {
      relativePath: "projections/openclaw/workspace/AGENTS.md",
      type: "file",
      mode: 0o644,
      byteLength: 23,
      sha256: digest(`${label}:workspace`),
    },
  ];
  return {
    archiveSha256: digest(`${label}:archive`),
    manifestDigest: members[0].sha256,
    inventoryDigest: digest(members, "package-member-inventory"),
    members,
  };
}

function receipt(label, lifecycle = "upgrade") {
  const archive = archiveBinding(label);
  return {
    schemaVersion: "agentmo.openclaw-install-receipt-authority.v1",
    receiptDigest: digest(`${label}:receipt`),
    lifecycle,
    targetId: "openclaw",
    scope: "project",
    archiveBinding: archive,
    operationSetDigest: digest(`${label}:operations`),
    ownershipDigest: digest(`${label}:ownership`),
    authorityId: authorityRootBinding().authorityId,
    rootIdentity: authorityRootBinding().rootIdentity,
  };
}

function authorityRootBinding() {
  return buildOpenClawAuthorityRootBinding({
    targetDescriptorDigest: digest("target-descriptor"),
    targetRootIdentity: { device: "11", inode: "20" },
    rootIdentity: { device: "11", inode: "21" },
  });
}

function target(scope = "project") {
  return {
    targetId: "openclaw",
    targetVersion: "2026.7.1-2",
    targetRevision: "0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c",
    probeFingerprintDigest: digest("probe"),
    scope,
    projectId: "support-triage",
  };
}

function operations() {
  return [
    {
      path: ".openclaw/projects/support-triage/AGENTS.md",
      sourcePath: "projections/openclaw/workspace/AGENTS.md",
      operation: "write",
      configPatch: null,
      baseDigest: null,
      currentDigest: null,
      desiredDigest: digest("desired:agents"),
      ownerMarker: "agentmo:package:support-triage",
      retainedFileIdentity: null,
      retainedParentIdentity: { device: "11", inode: "22" },
      conflict: "none",
      rollbackRule: "remove-if-created-and-pristine",
    },
    {
      path: ".openclaw/projects/support-triage/openclaw.json",
      operation: "patch",
      configPatch: {
        patch: { agents: { "support-triage": { enabled: true } } },
        patchDigest: digest(
          { agents: { "support-triage": { enabled: true } } },
          "openclaw-official-config-patch",
        ),
      },
      baseDigest: digest("base:config"),
      currentDigest: digest("base:config"),
      desiredDigest: digest("desired:config"),
      ownerMarker: "agentmo:package:support-triage",
      retainedFileIdentity: { device: "11", inode: "33" },
      retainedParentIdentity: { device: "11", inode: "22" },
      conflict: "none",
      rollbackRule: "restore-if-owned-and-current-digest-matches",
    },
  ];
}

function sensitiveActions(scope = "project") {
  const actions = [{
    actionId: "process:openclaw-config-validate",
    kind: "process",
    executable: "node",
    argv: ["openclaw.mjs", "config", "validate", "--json"],
    cwd: ".openclaw/projects/support-triage",
    scope,
    target: "openclaw:config",
    timeoutMs: 10_000,
    environmentNames: ["HOME", "OPENCLAW_CONFIG_PATH", "OPENCLAW_STATE_DIR"],
  }];
  if (scope === "user") {
    actions.push({
      actionId: "scope:user",
      kind: "user-scope",
      executable: "node",
      argv: ["openclaw.mjs", "config", "set", "--scope", "user"],
      cwd: ".",
      scope: "user",
      target: "openclaw:user-state",
      timeoutMs: 10_000,
      environmentNames: ["HOME", "OPENCLAW_CONFIG_PATH", "OPENCLAW_STATE_DIR"],
    });
  }
  return actions;
}

function conflicts() {
  return [{
    path: ".openclaw/projects/support-triage/openclaw.json",
    currentDigest: digest("current:conflict"),
    desiredDigest: digest("desired:config"),
    action: "preserve",
  }];
}

function genesis(scope = "project") {
  const exactTarget = target(scope);
  const checkedPaths = operations()
    .filter(({ operation }) => operation === "write")
    .map(({ path: relativePath }) => relativePath);
  const observations = checkedPaths.map((relativePath) => ({
    path: relativePath,
    parentIdentity: { device: "11", inode: "22" },
  }));
  const observedAt = "2026-07-29T00:00:00.000Z";
  return Object.freeze({
    schemaVersion: OPENCLAW_ABSENT_GENESIS_SCHEMA_VERSION,
    target: exactTarget,
    checkedPaths,
    observations,
    observedAt,
    absenceObservationDigest: digest({
      target: exactTarget,
      checkedPaths,
      observations,
      observedAt,
    }, "openclaw-absent-genesis-observation"),
    verifiedAbsent: true,
    certificationBoundary: {
      observedAbsenceOnly: true,
      installed: false,
      runtime: false,
      domain: false,
      production: false,
    },
  });
}

function planOptions(lifecycle = "install", scope = "project") {
  const options = {
    lifecycle,
    archiveBinding: archiveBinding(lifecycle),
    authorityRootBinding: authorityRootBinding(),
    target: target(scope),
    operations: operations(),
    sensitiveActions: sensitiveActions(scope),
    conflicts: conflicts(),
    officialConfigDryRun: {
      commandDigest: digest("config-dry-run-command"),
      resultDigest: digest("config-dry-run-result"),
      accepted: true,
    },
  };
  if (lifecycle === "install") options.absentGenesis = genesis(scope);
  if (lifecycle === "upgrade" || lifecycle === "uninstall") {
    options.currentReceipt = receipt("current", lifecycle);
  }
  if (lifecycle === "rollback") {
    options.currentReceipt = receipt("current", "upgrade");
    options.selectedPredecessorReceipt = receipt("predecessor", "install");
    options.selectedPredecessorArchiveBinding = archiveBinding("predecessor");
  }
  return options;
}

function nativeOptions() {
  const archive = archiveBinding();
  for (const name of ["IDENTITY.md", "SOUL.md", "USER.md"]) {
    archive.members.push({ relativePath: `projections/openclaw/workspace/${name}`,
      type: "file", mode: 0o644, byteLength: 23, sha256: digest(name) });
  }
  archive.members.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  archive.inventoryDigest = digest(archive.members);
  return {
    execution_profile: "native-chat",
    lifecycle: "install",
    archiveBinding: archive,
    authorityRootBinding: {
      schemaVersion: "agentmo.native-authority-binding.v1",
      rootDigest: digest("separate-authority-root"),
      anchorDigest: digest("authority-anchor"),
      rootIdentity: { device: "1", inode: "2", birthtimeNs: "3" },
      anchorIdentity: { device: "1", inode: "7", birthtimeNs: "8" },
      journalIdentity: { device: "1", inode: "4", birthtimeNs: "5" },
    },
    target: target(),
    nativeBinding: {
      agentId: "meeting-notes",
      stateRootDigest: digest("new-private-root"),
      workspace: "workspace",
      agentDir: "agents/meeting-notes/agent",
      gatewayPort: 17893,
      proxyPort: 17894,
      budgetReference: {
        version: 1,
        rootDigest: digest("existing-project-budget"),
        policyDigest: digest("budget-policy"),
        inventoryDigest: digest("budget-inventory"),
      },
      targetDescriptorDigest: digest("native-target-descriptor"),
    },
    officialConfigDryRun: {
      commandDigest: digest("native-config-command"),
      resultDigest: digest("native-config-result"),
      accepted: true,
    },
  };
}

async function nativeAuthorityFixture(t) {
  const parent = await realpath(await mkdtemp(path.join(tmpdir(), "native-authority-")));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const authorityRoot = path.join(parent, "authority");
  const stateRoot = path.join(parent, "agent");
  const binding = await nativeAuthority.createNativeAuthorityStore({ authorityRoot, stateRoot });
  const options = nativeOptions();
  options.authorityRootBinding = binding;
  options.nativeBinding.stateRootDigest = digestBytes(Buffer.from(stateRoot));
  const plan = buildOpenClawInstallPlan(options);
  return { parent, authorityRoot, stateRoot, plan, ...nativeDecisions(plan) };
}

function nativeDecisions(plan, suffix = "first", expired = false) {
  const common = { plan, decision: "approve", issuedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + (expired ? -30_000 : 600_000)).toISOString() };
  return {
    ordinaryApproval: buildOpenClawInstallApproval({ ...common, useNonce: `ordinary-${suffix}` }),
    sensitiveDecisions: plan.sensitiveActions.map((action, i) => buildOpenClawSensitiveActionDecision({
      ...common, action, useNonce: `sensitive-${i}-${suffix}` })),
    conflictApproval: buildOpenClawConflictApproval({ ...common, conflicts: [], useNonce: `conflict-${suffix}` }),
  };
}

function consumptionOptions(fixture) {
  const { authorityRoot, stateRoot, plan, ordinaryApproval, sensitiveDecisions, conflictApproval } = fixture;
  return { authorityRoot, stateRoot, plan, ordinaryApproval, sensitiveDecisions, conflictApproval };
}

it("keeps native one-use authority outside deleted Agent state and across process restart", async (t) => {
  const f = await nativeAuthorityFixture(t);
  const options = consumptionOptions(f);
  const result = await nativeAuthority.consumeNativeAuthoritySet(options);
  assert.equal(result.decisionCount, 5);
  assert.equal(result.installPlanDigest, f.plan.installPlanDigest);
  await mkdir(f.stateRoot);
  await rm(f.stateRoot, { recursive: true });
  const input = path.join(f.parent, "request.json");
  await writeFile(input, JSON.stringify(options));
  const moduleUrl = new URL("../src/native-chat-authority.js", import.meta.url).href;
  const exitCode = await new Promise((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", `
      import { readFile } from 'node:fs/promises';
      import { consumeNativeAuthoritySet } from ${JSON.stringify(moduleUrl)};
      try { await consumeNativeAuthoritySet(JSON.parse(await readFile(process.argv[1], 'utf8'))); process.exitCode = 2; }
      catch (e) { process.exitCode = e.code === 'AGENTMO_NATIVE_AUTHORITY_REJECTED' ? 0 : 3; }
    `, input], { env: {}, stdio: "ignore" });
    child.on("close", resolve);
  });
  assert.equal(exitCode, 0, "a new process must reject already consumed authority");
  const bytes = await readFile(path.join(f.authorityRoot, "consumption.jsonl"), "utf8");
  assert.equal(bytes.includes(f.parent), false);
  assert.equal(bytes.includes("ordinary-first"), false);
  assert.equal(bytes.split("\n").filter(Boolean).length, 2);
});

it("rejects missing, replaced, partial or aliased native authority state without resetting it", async (t) => {
  for (const mutation of ["root-missing", "root-replaced", "journal-missing", "journal-replaced",
    "journal-partial", "journal-empty", "journal-oversized", "anchor-missing", "anchor-replaced", "lock", "symlink", "hardlink", "mode", "root-mode"]) {
    const f = await nativeAuthorityFixture(t);
    const journal = path.join(f.authorityRoot, "consumption.jsonl");
    if (mutation === "root-missing") await rm(f.authorityRoot, { recursive: true });
    if (mutation === "root-replaced") {
      await rename(f.authorityRoot, `${f.authorityRoot}-old`);
      await nativeAuthority.createNativeAuthorityStore({ authorityRoot: f.authorityRoot, stateRoot: f.stateRoot });
    }
    if (mutation === "journal-missing") await rm(journal);
    if (mutation === "journal-replaced") {
      const bytes = await readFile(journal);
      await rename(journal, `${journal}.old`);
      await writeFile(journal, bytes, { mode: 0o600 });
    }
    if (mutation === "journal-partial") await appendFile(journal, '{"partial":');
    if (mutation === "journal-empty") await writeFile(journal, "");
    if (mutation === "journal-oversized") await appendFile(journal, "x".repeat(1024 * 1024 + 1));
    if (mutation === "anchor-missing") await rm(path.join(f.authorityRoot, "identity.json"));
    if (mutation === "anchor-replaced") {
      const anchor = path.join(f.authorityRoot, "identity.json");
      const bytes = await readFile(anchor);
      await rename(anchor, `${anchor}.old`);
      await writeFile(anchor, bytes, { mode: 0o600 });
    }
    if (mutation === "lock") await writeFile(path.join(f.authorityRoot, "consume.lock"), "", { mode: 0o600 });
    if (mutation === "symlink") { await rename(journal, `${journal}.old`); await symlink(`${journal}.old`, journal); }
    if (mutation === "hardlink") await link(journal, `${journal}.link`);
    if (mutation === "mode") await chmod(journal, 0o644);
    if (mutation === "root-mode") await chmod(f.authorityRoot, 0o755);
    await assert.rejects(nativeAuthority.consumeNativeAuthoritySet(consumptionOptions(f)),
      { code: "AGENTMO_NATIVE_AUTHORITY_REJECTED" }, mutation);
    if (mutation === "root-missing") await assert.rejects(access(f.authorityRoot));
    if (mutation === "journal-missing") await assert.rejects(access(journal));
  }
});

it("validates all native approvals before writes and shares nonce uniqueness across decision families", async (t) => {
  for (const mutation of ["expired", "duplicate", "stale", "missing-action", "changed-root", "extra-option"]) {
    const f = await nativeAuthorityFixture(t);
    const options = consumptionOptions(f);
    const journal = path.join(f.authorityRoot, "consumption.jsonl");
    const before = await readFile(journal);
    if (mutation === "expired") Object.assign(options, nativeDecisions(f.plan, "expired", true));
    if (mutation === "duplicate") options.conflictApproval = buildOpenClawConflictApproval({ plan: f.plan,
      conflicts: [], decision: "approve", issuedAt: f.ordinaryApproval.issuedAt,
      expiresAt: f.ordinaryApproval.expiresAt, useNonce: f.ordinaryApproval.useNonce });
    if (mutation === "stale") options.ordinaryApproval = { ...f.ordinaryApproval, installPlanDigest: digest("stale") };
    if (mutation === "missing-action") options.sensitiveDecisions = f.sensitiveDecisions.slice(1);
    if (mutation === "changed-root") options.stateRoot = path.join(f.parent, "other-agent");
    if (mutation === "extra-option") options.now = f.ordinaryApproval.issuedAt;
    await assert.rejects(nativeAuthority.consumeNativeAuthoritySet(options), { code: "AGENTMO_NATIVE_AUTHORITY_REJECTED" }, mutation);
    assert.deepEqual(await readFile(journal), before, mutation);
    assert.deepEqual((await readdir(f.authorityRoot)).sort(), ["consumption.jsonl", "identity.json"]);
  }
});

it("allows only one concurrent native consumption and never reuses a nonce for another decision family", async (t) => {
  const f = await nativeAuthorityFixture(t);
  const results = await Promise.allSettled([1, 2].map(() => nativeAuthority.consumeNativeAuthoritySet(consumptionOptions(f))));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  const next = nativeDecisions(f.plan, "second");
  next.conflictApproval = buildOpenClawConflictApproval({ plan: f.plan, conflicts: [], decision: "approve",
    issuedAt: next.ordinaryApproval.issuedAt, expiresAt: next.ordinaryApproval.expiresAt,
    useNonce: f.ordinaryApproval.useNonce });
  await assert.rejects(nativeAuthority.consumeNativeAuthoritySet({ ...consumptionOptions(f), ...next }),
    { code: "AGENTMO_NATIVE_AUTHORITY_REJECTED" });
  const success = await nativeAuthority.consumeNativeAuthoritySet({ ...consumptionOptions(f), ...nativeDecisions(f.plan, "third") });
  assert.equal(success.decisionCount, 5);
});

it("only explicitly provisions absent disjoint native authority roots", async (t) => {
  const f = await nativeAuthorityFixture(t);
  await assert.rejects(nativeAuthority.createNativeAuthorityStore({ authorityRoot: f.authorityRoot, stateRoot: f.stateRoot }),
    { code: "AGENTMO_NATIVE_AUTHORITY_REJECTED" });
  for (const [authorityRoot, stateRoot] of [[f.stateRoot, f.stateRoot],
    [`${path.join(f.parent, "trailing-store")}/`, f.stateRoot],
    [path.join(f.stateRoot, "authority"), f.stateRoot], [path.join(f.parent, "new-store"), path.join(f.parent, "new-store", "agent")]]) {
    await assert.rejects(nativeAuthority.createNativeAuthorityStore({ authorityRoot, stateRoot }),
      { code: "AGENTMO_NATIVE_AUTHORITY_REJECTED" });
    await assert.rejects(access(authorityRoot));
  }
});

it("rejects non-canonical parent spellings before native authority consumption", async (t) => {
  const f = await nativeAuthorityFixture(t);
  const aliasRoot = path.join(f.parent, "AUTHORITY");
  try { await access(aliasRoot); } catch { t.skip("case-sensitive filesystem"); return; }
  const options = nativeOptions();
  const stateRoot = path.join(aliasRoot, "agent");
  options.authorityRootBinding = f.plan.authorityRootBinding;
  options.nativeBinding.stateRootDigest = digestBytes(Buffer.from(stateRoot));
  const plan = buildOpenClawInstallPlan(options);
  await assert.rejects(nativeAuthority.consumeNativeAuthoritySet({ authorityRoot: f.authorityRoot, stateRoot,
    plan, ...nativeDecisions(plan) }), { code: "AGENTMO_NATIVE_AUTHORITY_REJECTED" });
});

it("does not let a trailing slash bypass replaced native authority directory identity", async (t) => {
  const f = await nativeAuthorityFixture(t);
  const authorityRoot = `${f.authorityRoot}/`;
  const options = nativeOptions();
  options.nativeBinding.stateRootDigest = f.plan.nativeBinding.stateRootDigest;
  options.authorityRootBinding = { ...f.plan.authorityRootBinding, rootDigest: digestBytes(Buffer.from(authorityRoot)) };
  const plan = buildOpenClawInstallPlan(options);
  await rename(f.authorityRoot, `${f.authorityRoot}-old`);
  await mkdir(f.authorityRoot, { mode: 0o700 });
  for (const name of ["identity.json", "consumption.jsonl"]) {
    await rename(path.join(`${f.authorityRoot}-old`, name), path.join(f.authorityRoot, name));
  }
  await assert.rejects(nativeAuthority.consumeNativeAuthoritySet({ authorityRoot, stateRoot: f.stateRoot,
    plan, ...nativeDecisions(plan) }), { code: "AGENTMO_NATIVE_AUTHORITY_REJECTED" });
});

it("rejects an authority-root case alias that hides a contained Agent root", async (t) => {
  const f = await nativeAuthorityFixture(t);
  const authorityRoot = path.join(f.parent, "AUTHORITY");
  try { await access(authorityRoot); } catch { t.skip("case-sensitive filesystem"); return; }
  const stateRoot = path.join(f.authorityRoot, "agent");
  const options = nativeOptions();
  options.nativeBinding.stateRootDigest = digestBytes(Buffer.from(stateRoot));
  options.authorityRootBinding = { ...f.plan.authorityRootBinding, rootDigest: digestBytes(Buffer.from(authorityRoot)) };
  const plan = buildOpenClawInstallPlan(options);
  await assert.rejects(nativeAuthority.consumeNativeAuthoritySet({ authorityRoot, stateRoot,
    plan, ...nativeDecisions(plan) }), { code: "AGENTMO_NATIVE_AUTHORITY_REJECTED" });
});

it("binds native install review and approval to root digest, relative directories, ports and budget", () => {
  const options = nativeOptions();
  const plan = buildOpenClawInstallPlan(options);
  assert.equal(validateOpenClawInstallPlan(plan).ok, true);
  assert.deepEqual(plan.authorityRootBinding, options.authorityRootBinding);
  assert.equal(plan.certificationBoundary.runtime, false);
  const review = buildOpenClawInstallReview(plan);
  assert.equal(review.jsonModel.execution_profile, "native-chat");
  assert.deepEqual(review.humanModel.nativeBinding, options.nativeBinding);
  const now = "2026-10-09T00:00:00.000Z";
  const approval = buildOpenClawInstallApproval({ plan, decision: "approve",
    issuedAt: now, expiresAt: "2026-10-10T00:00:00.000Z", useNonce: "native-install-test" });
  assert.equal(validateOpenClawInstallApproval(approval, { plan, now }).ok, true);
  for (const mutate of [
    (p) => { p.nativeBinding.stateRootDigest = digest("another-root"); },
    (p) => { p.nativeBinding.gatewayPort += 2; },
    (p) => { p.nativeBinding.proxyPort += 2; },
    (p) => { p.nativeBinding.targetDescriptorDigest = digest("new-target"); },
    (p) => { p.nativeBinding.budgetReference.rootDigest = digest("new-budget"); },
    (p) => { p.archiveBinding.archiveSha256 = digest("changed-archive"); },
    (p) => { p.authorityRootBinding.anchorDigest = digest("replaced-authority"); },
    (p) => { p.authorityRootBinding.journalIdentity.inode = "6"; },
  ]) {
    const changed = structuredClone(options);
    mutate(changed);
    const changedPlan = buildOpenClawInstallPlan(changed);
    assert.notEqual(changedPlan.installPlanDigest, plan.installPlanDigest);
    assert.equal(validateOpenClawInstallApproval(approval, { plan: changedPlan, now }).ok, false);
  }
  const oldPlan = buildOpenClawInstallPlan(planOptions());
  assert.equal(validateOpenClawInstallApproval(approval, { plan: oldPlan, now }).ok, false);
});

it("binds native activation to the installed receipt and refuses reused install authority", async () => {
  const options = nativeOptions(), installed = buildOpenClawInstallPlan(options);
  const predecessor = { kind: "installed-native-root", installPlanDigest: installed.installPlanDigest,
    installReceiptDigest: digest("exact-install-receipt"), rootIdentity: { device: "1", inode: "20", birthtimeNs: "30" } };
  const activated = buildOpenClawInstallPlan({ ...options, lifecycle: "activate", predecessor });
  assert.equal(validateOpenClawInstallPlan(activated).ok, true);
  assert.equal(activated.lifecycle, "activate");
  assert.deepEqual(activated.predecessor, predecessor);
  assert.deepEqual(activated.sensitiveActions.map(a => a.actionId), ["network:native-budget-proxy", "process:native-gateway", "process:native-health"]);
  assert.deepEqual(activated.sensitiveActions[1].argv, ["gateway", "run", "--port", "17893", "--bind", "loopback", "--auth", "token"]);
  const old = nativeDecisions(installed);
  assert.equal(validateOpenClawInstallApproval(old.ordinaryApproval, { plan: activated, now: new Date().toISOString() }).ok, false);
  for (const field of ["installReceiptDigest", "installPlanDigest"]) {
    const changed = buildOpenClawInstallPlan({ ...options, lifecycle: "activate", predecessor: { ...predecessor, [field]: digest("changed") } });
    assert.notEqual(changed.installPlanDigest, activated.installPlanDigest);
  }
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "native-activate-plan-")));
  const filePath = path.join(root, "plan.json"), written = await writeOpenClawInstallPlan(filePath, activated);
  assert.deepEqual((await loadAdmittedArtifact({ filePath, expectedDigest: written.digest, subject: "openclaw-install-plan" })).value, activated);
  const altered = structuredClone(activated); altered.sensitiveActions[1].argv.push("--force");
  assert.equal(validateOpenClawInstallPlan(altered).ok, false);
  assert.equal(getArtifactContract("openclaw-install-plan").jsonSchema.then.properties.lifecycle.enum.includes("activate"), true);
});

it("does not route native approvals into the legacy authority reservation writer", async () => {
  const plan = buildOpenClawInstallPlan(nativeOptions());
  const common = { plan, decision: "approve", issuedAt: "2026-10-09T00:00:00.000Z",
    expiresAt: "2026-10-10T00:00:00.000Z" };
  let writes = 0;
  await assert.rejects(reserveOpenClawAuthoritySet({
    session: { reserveMarker: async () => { writes++; throw new Error("unexpected legacy write"); },
      observe: async () => { throw new Error("unexpected legacy observation"); } },
    attemptId: "native-plan-test", plan,
    probe: { fingerprintDigest: plan.target.probeFingerprintDigest, cli: { executableDigest: digest("executable") } },
    ordinaryApproval: buildOpenClawInstallApproval({ ...common, useNonce: "ordinary" }),
    sensitiveDecisions: plan.sensitiveActions.map((action, i) => buildOpenClawSensitiveActionDecision({
      ...common, action, useNonce: `sensitive-${i}` })),
    conflictApproval: buildOpenClawConflictApproval({ ...common, conflicts: [], useNonce: "conflict" }),
    now: common.issuedAt,
  }), { code: "AGENTMO_OPENCLAW_AUTHORITY_ARGUMENTS_REJECTED" });
  assert.equal(writes, 0);
});

it("verifies the exact native root and refuses existing or aliased namespaces without writes", async () => {
  const parent = await realpath(await mkdtemp(path.join(tmpdir(), "native-binding-")));
  const stateRoot = path.join(parent, "new-root");
  const options = nativeOptions();
  options.nativeBinding.stateRootDigest = digestBytes(Buffer.from(stateRoot));
  const plan = buildOpenClawInstallPlan(options);
  const paths = await installPlans.verifyOpenClawNativeInstallRoot({ plan, stateRoot });
  assert.equal(paths.workspace, path.join(stateRoot, "workspace"));
  assert.equal(paths.agentDir, path.join(stateRoot, "agents/meeting-notes/agent"));
  await assert.rejects(access(stateRoot));
  await assert.rejects(installPlans.verifyOpenClawNativeInstallRoot({ plan, stateRoot: path.join(parent, "different") }),
    { code: "AGENTMO_OPENCLAW_NATIVE_ROOT_REJECTED" });
  await mkdir(stateRoot);
  await writeFile(path.join(stateRoot, "keep.txt"), "unchanged");
  await assert.rejects(installPlans.verifyOpenClawNativeInstallRoot({ plan, stateRoot }),
    { code: "AGENTMO_OPENCLAW_NATIVE_ROOT_REJECTED" });
  assert.equal(await readFile(path.join(stateRoot, "keep.txt"), "utf8"), "unchanged");
  const alias = path.join(parent, "alias");
  await symlink(stateRoot, alias);
  const aliasedRoot = path.join(alias, "child");
  options.nativeBinding.stateRootDigest = digestBytes(Buffer.from(aliasedRoot));
  await assert.rejects(installPlans.verifyOpenClawNativeInstallRoot({
    plan: buildOpenClawInstallPlan(options), stateRoot: aliasedRoot,
  }), { code: "AGENTMO_OPENCLAW_NATIVE_ROOT_REJECTED" });
  await assert.rejects(access(path.join(stateRoot, "child")));
});

it("publishes and admits the native plan without persisting a host root or accepting altered commands", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "native-plan-publication-"));
  const filePath = path.join(root, "plan.json");
  const plan = buildOpenClawInstallPlan(nativeOptions());
  const written = await writeOpenClawInstallPlan(filePath, plan);
  const admitted = await loadAdmittedArtifact({ filePath, expectedDigest: written.digest, subject: "openclaw-install-plan" });
  assert.deepEqual(admitted.value, plan);
  assert.equal((await readFile(filePath, "utf8")).includes(root), false);
  const schema = getArtifactContract("openclaw-install-plan").jsonSchema;
  assert.equal(schema.properties.execution_profile.const, "native-chat");
  for (const change of [
    (p) => { p.sensitiveActions[0].argv.push("--extra"); },
    (p) => { p.operations[0].path = "state/config.json"; },
    (p) => { p.authorityRootBinding = authorityRootBinding(); },
    (p) => { delete p.execution_profile; },
    (p) => { p.predecessor.verifiedAbsent = true; },
  ]) {
    const candidate = structuredClone(plan); change(candidate);
    const { installPlanDigest: _, ...basis } = candidate;
    candidate.installPlanDigest = digest(basis);
    assert.equal(validateOpenClawInstallPlan(candidate).ok, false);
  }
});

it("rejects native host paths, directory aliasing, invalid bindings and unsupported lifecycle before writing", () => {
  for (const mutate of [
    (p) => { p.nativeBinding.stateRoot = "/private/tmp/private-agent"; },
    (p) => { p.nativeBinding.stateRootDigest = "/private/tmp/private-agent"; },
    (p) => { p.nativeBinding.workspace = "../host"; },
    (p) => { p.nativeBinding.workspace = "/private/tmp/workspace"; },
    (p) => { p.nativeBinding.agentDir = "workspace"; },
    (p) => { p.nativeBinding.agentId = "../host"; },
    (p) => { p.nativeBinding.gatewayPort = p.nativeBinding.proxyPort; },
    (p) => { p.nativeBinding.gatewayPort = 0; },
    (p) => { p.nativeBinding.proxyPort = 65536; },
    (p) => { p.nativeBinding.budgetReference.version = 0; },
    (p) => { p.authorityRootBinding = null; },
    (p) => { p.authorityRootBinding.rootDigest = p.nativeBinding.stateRootDigest; },
    (p) => { p.authorityRootBinding.journalIdentity.inode = "-1"; },
    (p) => { p.authorityRootBinding = authorityRootBinding(); },
    (p) => { p.execution_profile = "plugin"; },
    (p) => { p.lifecycle = "activate"; },
    (p) => { p.lifecycle = "upgrade"; },
  ]) {
    const options = nativeOptions(); mutate(options);
    assert.throws(() => buildOpenClawInstallPlan(options), {
      code: "AGENTMO_OPENCLAW_INSTALL_PLAN_INVALID",
    });
  }
});

it("builds closed absent-genesis and lifecycle authorities for all four actions", () => {
  assert.equal(
    OPENCLAW_ABSENT_GENESIS_SCHEMA_VERSION,
    "agentmo.openclaw-absent-genesis.v1",
  );
  const absent = genesis();
  assert.equal(validateOpenClawAbsentGenesisAuthority(absent).ok, true);
  assert.equal(Object.isFrozen(absent), true);

  assert.equal(
    OPENCLAW_INSTALL_PLAN_SCHEMA_VERSION,
    "agentmo.openclaw-install-plan.v1",
  );
  for (const lifecycle of ["install", "upgrade", "rollback", "uninstall"]) {
    const plan = buildOpenClawInstallPlan(planOptions(lifecycle));
    assert.equal(validateOpenClawInstallPlan(plan).ok, true, lifecycle);
    assert.equal(plan.lifecycle, lifecycle);
    assert.equal(Object.isFrozen(plan), true);
    assert.deepEqual(plan.archiveBinding, planOptions(lifecycle).archiveBinding);
  }
});

it("observed genesis derives checked paths through retained safe-fs and rejects caller absence claims", {
  skip: !NATIVE_OPENCLAW_FS,
}, async () => {
  const fixture = await buildApprovedPackageFixture();
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-observed-genesis-"));
  await chmod(root, 0o700);
  const exactOperations = operations().filter(({ operation }) => (
    operation === "write"
  ));
  await mkdir(path.join(root, ".openclaw/projects/support-triage"), {
    recursive: true,
  });
  const session = await openOpenClawSafeFsSession({
    rootPath: root,
    helperPath: fixture.publication.helperPath,
    receiptPath: fixture.publication.receiptPath,
    receiptDigest: fixture.publication.receiptDigest,
  });
  try {
    const authority = await buildOpenClawAbsentGenesisAuthority({
      target: target(),
      operations: exactOperations,
      observedAt: "2026-07-30T00:00:00.000Z",
      session,
    });
    assert.deepEqual(
      authority.checkedPaths,
      exactOperations.map(({ path: relativePath }) => relativePath),
    );
    assert.equal(validateOpenClawAbsentGenesisAuthority(authority).ok, true);

    await assert.rejects(
      async () => buildOpenClawAbsentGenesisAuthority({
        target: target(),
        checkedPaths: authority.checkedPaths,
        observedAt: authority.observedAt,
        absenceObservationDigest: authority.absenceObservationDigest,
      }),
      (error) => error?.code === "AGENTMO_OPENCLAW_INSTALL_PLAN_INVALID",
    );

    await writeFile(path.join(root, exactOperations[0].path), "appeared");
    await assert.rejects(
      async () => buildOpenClawAbsentGenesisAuthority({
        target: target(),
        operations: exactOperations,
        observedAt: "2026-07-30T00:00:01.000Z",
        session,
      }),
      (error) => error?.code === "AGENTMO_OPENCLAW_GENESIS_NOT_ABSENT",
    );
  } finally {
    await session.close();
  }
});

it("enforces exactly one lifecycle predecessor or verified genesis basis", () => {
  const invalid = [
    { lifecycle: "install", mutation: (value) => { delete value.absentGenesis; } },
    { lifecycle: "install", mutation: (value) => { value.currentReceipt = receipt("extra"); } },
    { lifecycle: "upgrade", mutation: (value) => { delete value.currentReceipt; } },
    { lifecycle: "upgrade", mutation: (value) => { value.absentGenesis = genesis(); } },
    { lifecycle: "uninstall", mutation: (value) => { delete value.currentReceipt; } },
    { lifecycle: "rollback", mutation: (value) => { delete value.selectedPredecessorReceipt; } },
    { lifecycle: "rollback", mutation: (value) => { delete value.selectedPredecessorArchiveBinding; } },
  ];
  for (const { lifecycle, mutation } of invalid) {
    const value = planOptions(lifecycle);
    mutation(value);
    assert.throws(() => buildOpenClawInstallPlan(value), { code: "AGENTMO_OPENCLAW_INSTALL_PLAN_INVALID" });
  }
  const forged = structuredClone(genesis());
  forged.verifiedAbsent = false;
  assert.equal(validateOpenClawAbsentGenesisAuthority(forged).ok, false);
  assert.equal(validateOpenClawAbsentGenesisAuthority({ ...genesis(), success: true }).ok, false);
});

it("binds the complete sorted D-42 archive closure and rejects every member drift", () => {
  const plan = buildOpenClawInstallPlan(planOptions("install"));
  const mutations = [
    (value) => { value.archiveBinding.archiveSha256 = digest("drift:archive"); },
    (value) => { value.archiveBinding.manifestDigest = digest("drift:manifest"); },
    (value) => { value.archiveBinding.inventoryDigest = digest("drift:inventory"); },
    (value) => { value.archiveBinding.members[0].relativePath = "../escape"; },
    (value) => { value.archiveBinding.members[0].type = "directory"; },
    (value) => { value.archiveBinding.members[0].mode = 0o600; },
    (value) => { value.archiveBinding.members[0].byteLength += 1; },
    (value) => { value.archiveBinding.members[0].sha256 = digest("drift:member"); },
    (value) => { value.archiveBinding.members.reverse(); },
    (value) => { value.archiveBinding.members.pop(); },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(plan);
    mutate(candidate);
    assert.equal(validateOpenClawInstallPlan(candidate).ok, false);
  }
  assert.throws(
    () => buildOpenClawInstallPlan({ ...planOptions("install"), packageRoot: "/tmp/package" }),
    { code: "AGENTMO_OPENCLAW_INSTALL_PLAN_INVALID" },
  );
  assert.throws(
    () => buildOpenClawInstallPlan({
      ...planOptions("install"),
      archiveBinding: { manifestDigest: digest("manifest-only") },
    }),
    { code: "AGENTMO_OPENCLAW_INSTALL_PLAN_INVALID" },
  );
});

it("binds target, scope, three-way ownership, operations, patches, actions and conflicts", () => {
  const plan = buildOpenClawInstallPlan(planOptions("install"));
  const mutations = [
    (value) => { value.target.probeFingerprintDigest = digest("drift:probe"); },
    (value) => { value.target.scope = "user"; },
    (value) => { value.operations[0].desiredDigest = digest("drift:desired"); },
    (value) => {
      value.operations[1].configPatch.patch = { different: true };
    },
    (value) => { value.operations[1].retainedFileIdentity.inode = "999"; },
    (value) => { value.operations[0].ownerMarker = "someone-else"; },
    (value) => { value.sensitiveActions[0].argv.push("--force"); },
    (value) => { value.conflicts[0].currentDigest = digest("drift:current"); },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(plan);
    mutate(candidate);
    assert.equal(validateOpenClawInstallPlan(candidate).ok, false);
  }

  const userPlan = buildOpenClawInstallPlan(planOptions("install", "user"));
  assert.equal(userPlan.target.scope, "user");
  assert.equal(userPlan.sensitiveActions.some(({ kind }) => kind === "user-scope"), true);
  const missingScopeAction = planOptions("install", "user");
  missingScopeAction.sensitiveActions = missingScopeAction.sensitiveActions
    .filter(({ kind }) => kind !== "user-scope");
  assert.throws(
    () => buildOpenClawInstallPlan(missingScopeAction),
    { code: "AGENTMO_OPENCLAW_INSTALL_PLAN_INVALID" },
  );
});

it("publishes absent-genesis and install plans create-only with external final-byte digests", {
  skip: !NATIVE_OPENCLAW_FS,
}, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-install-authority-writers-"));
  await chmod(root, 0o700);
  const absentFile = path.join(root, "absent-genesis.json");
  const planFile = path.join(root, "install-plan.json");
  const fixture = await buildApprovedPackageFixture();
  const exactOperations = operations().filter(({ operation }) => (
    operation === "write"
  ));
  await mkdir(path.join(root, ".openclaw/projects/support-triage"), {
    recursive: true,
  });
  const session = await openOpenClawSafeFsSession({
    rootPath: root,
    helperPath: fixture.publication.helperPath,
    receiptPath: fixture.publication.receiptPath,
    receiptDigest: fixture.publication.receiptDigest,
  });
  const absent = await buildOpenClawAbsentGenesisAuthority({
    target: target(),
    operations: exactOperations,
    observedAt: "2026-07-29T00:00:00.000Z",
    session,
  });
  await session.close();
  const installOptions = planOptions("install");
  installOptions.absentGenesis = absent;
  const plan = buildOpenClawInstallPlan(installOptions);

  const absentResult = await writeOpenClawAbsentGenesisAuthority(absentFile, absent);
  const planResult = await writeOpenClawInstallPlan(planFile, plan);
  assert.deepEqual(absentResult, {
    filePath: absentFile,
    digest: digestBytes(await readFile(absentFile)),
  });
  assert.deepEqual(planResult, {
    filePath: planFile,
    digest: digestBytes(await readFile(planFile)),
  });
  assert.deepEqual(JSON.parse(await readFile(planFile, "utf8")).archiveBinding, plan.archiveBinding);

  await assert.rejects(
    () => writeOpenClawAbsentGenesisAuthority(absentFile, absent),
    (error) => error?.code === "EEXIST",
  );
  await assert.rejects(
    () => writeOpenClawInstallPlan(planFile, plan),
    (error) => error?.code === "EEXIST",
  );
  await assert.rejects(
    () => writeOpenClawAbsentGenesisAuthority(
      path.join(root, "forged-genesis.json"),
      structuredClone(absent),
    ),
    (error) => error?.code === "AGENTMO_PERSISTABILITY_UNADMITTED_CANDIDATE",
  );
  await assert.rejects(
    () => writeOpenClawInstallPlan(
      path.join(root, "forged-plan.json"),
      structuredClone(plan),
    ),
    (error) => error?.code === "AGENTMO_PERSISTABILITY_UNADMITTED_CANDIDATE",
  );
});

it("preserves its new output when post-validation publication bytes drift", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-install-authority-drift-"));
  const output = path.join(root, "drift.json");
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
    () => writeOpenClawInstallPlan(
      output,
      buildOpenClawInstallPlan(planOptions("install")),
      { openOutput: driftingOpen },
    ),
    (error) => error?.code === "AGENTMO_PERSISTABILITY_OUTPUT_MISMATCH",
  );
  assert.equal(await readFile(output, "utf8"), "{}\n");

  const occupied = path.join(root, "occupied.json");
  await writeFile(occupied, "foreign\n", "utf8");
  await assert.rejects(
    () => writeOpenClawInstallPlan(
      occupied,
      buildOpenClawInstallPlan(planOptions("install")),
    ),
    (error) => error?.code === "EEXIST",
  );
  assert.equal(await readFile(occupied, "utf8"), "foreign\n");
});

it("fresh processes capture exact genesis and publish one archive-only install preview", {
  skip: !NATIVE_OPENCLAW_FS,
}, async () => {
  const probeFixture = await lifecycleProbeFixture();
  const {
    archiveDigest,
    archivePath,
    fixture,
    probe,
    probeDigest,
    probeFile,
  } = probeFixture;
  const root = fixture.root;
  const genesisRequestFile = path.join(root, "genesis-request.json");
  const genesisFile = path.join(root, "genesis.json");
  const targetRoot = path.join(root, "isolated-lifecycle-target");
  await mkdir(
    path.join(targetRoot, ".openclaw/projects/support-triage"),
    { recursive: true },
  );
  await chmod(targetRoot, 0o700);
  const previewRequestFile = path.join(root, "preview-request.json");
  const planFile = path.join(root, "install-plan.json");
  const authorityRootBindingFile = path.join(
    root,
    "authority-root-binding.json",
  );
  const authorityRootBinding = await createOpenClawAuthorityRootBinding({
    openClawTargetRoot: path.dirname(
      fixture.inputs.targetFiles.packageJsonPath,
    ),
    targetDescriptor: fixture.inputs.targetDescriptor.value,
  });
  const authorityRootBindingWritten = await writeOpenClawAuthorityRootBinding(
    authorityRootBindingFile,
    authorityRootBinding,
  );
  const exactTarget = {
    targetId: probe.target.id,
    targetVersion: probe.target.version,
    targetRevision: probe.target.sourceRevision,
    probeFingerprintDigest: probe.fingerprintDigest,
    scope: "project",
    projectId: "support-triage",
  };
  const genesisRequest = {
    target: exactTarget,
    operations: operations(),
    observedAt: "2026-07-30T00:00:00.000Z",
  };
  const genesisRequestDigest = await writeCanonical(
    genesisRequestFile,
    genesisRequest,
    "genesis-request",
  );
  const genesis = await runCli([
    "openclaw-install-genesis",
    "--archive", archivePath,
    "--archive-sha256", archiveDigest,
    ...probeAuthorityArgs(probeFixture),
    "--probe", probeFile,
    "--probe-sha256", probeDigest,
    "--request", genesisRequestFile,
    "--request-sha256", genesisRequestDigest,
    "--target-root", targetRoot,
    "--fs-helper", fixture.publication.helperPath,
    "--fs-helper-receipt", fixture.publication.receiptPath,
    "--fs-helper-receipt-digest", fixture.publication.receiptDigest,
    "--out", genesisFile,
    "--json",
  ]);
  assert.equal(genesis.code, 0, genesis.stderr);
  const genesisDigest = digestBytes(await readFile(genesisFile));

  const request = planOptions("install");
  delete request.lifecycle;
  delete request.archiveBinding;
  delete request.authorityRootBinding;
  delete request.absentGenesis;
  request.target = exactTarget;
  const requestDigest = await writeCanonical(
    previewRequestFile,
    request,
    "preview-request",
  );
  const preview = await runCli([
    "openclaw-install-preview",
    "--lifecycle", "install",
    "--archive", archivePath,
    "--archive-sha256", archiveDigest,
    ...probeAuthorityArgs(probeFixture),
    "--probe", probeFile,
    "--probe-sha256", probeDigest,
    "--request", previewRequestFile,
    "--request-sha256", requestDigest,
    "--target-root", targetRoot,
    "--openclaw-target-root", path.dirname(fixture.inputs.targetFiles.packageJsonPath),
    "--fs-helper", fixture.publication.helperPath,
    "--fs-helper-receipt", fixture.publication.receiptPath,
    "--fs-helper-receipt-digest", fixture.publication.receiptDigest,
    "--authority-root-binding", authorityRootBindingFile,
    "--authority-root-binding-sha256", authorityRootBindingWritten.digest,
    "--absent-genesis", genesisFile,
    "--absent-genesis-sha256", genesisDigest,
    "--out", planFile,
    "--json",
  ]);
  assert.equal(preview.code, 0, `${preview.stderr}\n${preview.stdout}`);
  const plan = JSON.parse(await readFile(planFile, "utf8"));
  assert.equal(plan.lifecycle, "install");
  assert.equal(plan.archiveBinding.archiveSha256, archiveDigest);
  assert.equal(plan.predecessor.kind, "absent-genesis");
  assert.equal(plan.certificationBoundary.installed, false);

  const rejectedOutput = path.join(root, "rejected.json");
  const rejected = await runCli([
    "openclaw-install-preview",
    "--lifecycle", "install",
    "--archive", archivePath,
    "--archive-sha256", archiveDigest,
    ...probeAuthorityArgs(probeFixture),
    "--probe", probeFile,
    "--probe-sha256", probeDigest,
    "--request", previewRequestFile,
    "--request-sha256", requestDigest,
    "--target-root", targetRoot,
    "--openclaw-target-root", path.dirname(fixture.inputs.targetFiles.packageJsonPath),
    "--fs-helper", fixture.publication.helperPath,
    "--fs-helper-receipt", fixture.publication.receiptPath,
    "--fs-helper-receipt-digest", fixture.publication.receiptDigest,
    "--absent-genesis", genesisFile,
    "--absent-genesis-sha256", digest("stale-genesis"),
    "--out", rejectedOutput,
    "--json",
  ]);
  assert.notEqual(rejected.code, 0);
  await assert.rejects(() => access(rejectedOutput));

  const archiveEnvelope = JSON.parse(await readFile(archivePath, "utf8"));
  const internalAttacks = [
    (value) => {
      value.members[0].contentBase64 = Buffer.from("member-byte-drift")
        .toString("base64");
    },
    (value) => { value.members.push(structuredClone(value.members[0])); },
    (value) => { value.members.pop(); },
    (value) => { value.members[0].type = "directory"; },
    (value) => { value.members[0].mode = 0o600; },
    (value) => {
      value.manifestContentBase64 = Buffer.from("{}\n", "utf8")
        .toString("base64");
    },
    (value) => { value.inventoryDigest = digest("inventory-drift"); },
  ];
  for (const [index, mutate] of internalAttacks.entries()) {
    const attacked = structuredClone(archiveEnvelope);
    mutate(attacked);
    const attackedFile = path.join(root, `attacked-${index}.d42`);
    const attackedBytes = Buffer.from(`${JSON.stringify(attacked, null, 2)}\n`);
    await writeFile(attackedFile, attackedBytes);
    const attackedOutput = path.join(root, `attacked-${index}.json`);
    const result = await runCli([
      "openclaw-install-preview",
      "--lifecycle", "install",
      "--archive", attackedFile,
      "--archive-sha256", digestBytes(attackedBytes),
      ...probeAuthorityArgs(probeFixture),
      "--probe", probeFile,
      "--probe-sha256", probeDigest,
      "--request", previewRequestFile,
      "--request-sha256", requestDigest,
      "--target-root", targetRoot,
      "--openclaw-target-root", path.dirname(fixture.inputs.targetFiles.packageJsonPath),
      "--fs-helper", fixture.publication.helperPath,
      "--fs-helper-receipt", fixture.publication.receiptPath,
      "--fs-helper-receipt-digest", fixture.publication.receiptDigest,
      "--absent-genesis", genesisFile,
      "--absent-genesis-sha256", genesisDigest,
      "--out", attackedOutput,
      "--json",
    ]);
    assert.notEqual(result.code, 0, `attack ${index} unexpectedly passed`);
    await assert.rejects(() => access(attackedOutput));
  }
});

it("fresh non-install previews reject structurally forged predecessor receipts", {
  skip: !NATIVE_OPENCLAW_FS,
}, async () => {
  const probeFixture = await lifecycleProbeFixture();
  const {
    archiveDigest,
    archivePath,
    fixture,
    probe,
    probeDigest,
    probeFile,
  } = probeFixture;
  const root = fixture.root;
  const targetRoot = path.join(root, "non-install-preview-target");
  await mkdir(targetRoot);
  await chmod(targetRoot, 0o700);
  const requestFile = path.join(root, "request.json");
  const currentFile = path.join(root, "current-receipt.json");
  const selectedFile = path.join(root, "selected-receipt.json");
  const exactTarget = {
    targetId: probe.target.id,
    targetVersion: probe.target.version,
    targetRevision: probe.target.sourceRevision,
    probeFingerprintDigest: probe.fingerprintDigest,
    scope: "project",
    projectId: "support-triage",
  };
  const request = planOptions("upgrade");
  delete request.lifecycle;
  delete request.archiveBinding;
  delete request.currentReceipt;
  request.target = exactTarget;
  const requestDigest = await writeCanonical(requestFile, request, "preview-request");
  const receiptTemplate = getArtifactContract(
    "openclaw-install-receipt",
  ).minimalTemplate;
  const currentReceipt = structuredClone(receiptTemplate);
  currentReceipt.authorityLedger.target = exactTarget;
  const currentDigest = await writeCanonical(
    currentFile,
    currentReceipt,
    "current-receipt",
  );
  const common = [
    "--archive", archivePath,
    "--archive-sha256", archiveDigest,
    ...probeAuthorityArgs(probeFixture),
    "--probe", probeFile,
    "--probe-sha256", probeDigest,
    "--request", requestFile,
    "--request-sha256", requestDigest,
    "--target-root", targetRoot,
    "--openclaw-target-root", path.dirname(fixture.inputs.targetFiles.packageJsonPath),
    "--fs-helper", fixture.publication.helperPath,
    "--fs-helper-receipt", fixture.publication.receiptPath,
    "--fs-helper-receipt-digest", fixture.publication.receiptDigest,
    "--current-receipt", currentFile,
    "--current-receipt-sha256", currentDigest,
    "--json",
  ];
  for (const lifecycle of ["upgrade", "uninstall"]) {
    const output = path.join(root, `${lifecycle}-plan.json`);
    const result = await runCli([
      "openclaw-install-preview",
      "--lifecycle", lifecycle,
      ...common,
      "--out", output,
    ]);
    assert.notEqual(result.code, 0, `${result.stderr}\n${result.stdout}`);
    await assert.rejects(() => access(output));
  }

  const selectedReceipt = structuredClone(receiptTemplate);
  selectedReceipt.authorityLedger.target = exactTarget;
  const selectedDigest = await writeCanonical(
    selectedFile,
    selectedReceipt,
    "selected-receipt",
  );
  const rollbackFile = path.join(root, "rollback-plan.json");
  const rollback = await runCli([
    "openclaw-install-preview",
    "--lifecycle", "rollback",
    ...common,
    "--predecessor-receipt", selectedFile,
    "--predecessor-receipt-sha256", selectedDigest,
    "--predecessor-archive", archivePath,
    "--predecessor-archive-sha256", archiveDigest,
    "--out", rollbackFile,
  ]);
  assert.notEqual(rollback.code, 0, rollback.stderr);
  await assert.rejects(() => access(rollbackFile));
});

export { archiveBinding, conflicts, digest, planOptions, sensitiveActions, target };
