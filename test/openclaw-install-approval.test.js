import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdtemp,
  open,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";
import {
  buildOpenClawInstallPlan,
  writeOpenClawInstallPlan,
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
  validateOpenClawSensitiveActionDecision,
  writeOpenClawConflictApproval,
  writeOpenClawInstallApproval,
  writeOpenClawInstallReviewDecisions,
  writeOpenClawSensitiveActionDecision,
} from "../src/openclaw-install-approval.js";
import { serializePersistableJson } from "../src/persistability.js";
import {
  buildOpenClawAuthorityRootBinding,
} from "../src/openclaw-authority-root-binding.js";

const CLI = fileURLToPath(new URL("../bin/agentmo.js", import.meta.url));
const ADMISSION_MODULE = new URL(
  "../src/artifact-admission.js",
  import.meta.url,
).href;
const digest = (value, subject = "install-approval-test") => (
  `sha256:${createHash("sha256")
    .update(Buffer.from(serializePersistableJson(value, { subject }), "utf8"))
    .digest("hex")}`
);
const digestBytes = (bytes) => (
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`
);

function archiveBinding(label = "install") {
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

function target() {
  return {
    targetId: "openclaw",
    targetVersion: "2026.7.1-2",
    targetRevision: "0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c",
    probeFingerprintDigest: digest("probe"),
    scope: "project",
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

function genesisAuthority(exactTarget, checkedPaths) {
  const observations = checkedPaths.map((relativePath) => ({
    path: relativePath,
    parentIdentity: { device: "11", inode: "22" },
  }));
  const observedAt = "2026-07-29T00:00:00.000Z";
  return {
    schemaVersion: "agentmo.openclaw-absent-genesis.v1",
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
  };
}

function planOptions() {
  const exactTarget = target();
  const exactOperations = operations();
  return {
    lifecycle: "install",
    archiveBinding: archiveBinding(),
    authorityRootBinding: buildOpenClawAuthorityRootBinding({
      targetDescriptorDigest: digest("target-descriptor"),
      targetRootIdentity: { device: "11", inode: "20" },
      rootIdentity: { device: "11", inode: "21" },
    }),
    target: exactTarget,
    operations: exactOperations,
    sensitiveActions: [{
      actionId: "process:openclaw-config-validate",
      kind: "process",
      executable: "node",
      argv: ["openclaw.mjs", "config", "validate", "--json"],
      cwd: ".openclaw/projects/support-triage",
      scope: "project",
      target: "openclaw:config",
      timeoutMs: 10_000,
      environmentNames: [
        "HOME",
        "OPENCLAW_CONFIG_PATH",
        "OPENCLAW_STATE_DIR",
      ],
    }],
    conflicts: [{
      path: ".openclaw/projects/support-triage/openclaw.json",
      currentDigest: digest("current:conflict"),
      desiredDigest: digest("desired:config"),
      action: "preserve",
    }],
    officialConfigDryRun: {
      commandDigest: digest("config-dry-run-command"),
      resultDigest: digest("config-dry-run-result"),
      accepted: true,
    },
    absentGenesis: genesisAuthority(
      exactTarget,
      exactOperations.filter(({ operation }) => operation === "write")
        .map(({ path }) => path),
    ),
  };
}

const decision = {
  decision: "approve",
  issuedAt: "2026-07-29T00:00:00.000Z",
  expiresAt: "2026-07-29T01:00:00.000Z",
  useNonce: "decision-0001",
};
const validation = {
  now: "2026-07-29T00:30:00.000Z",
};

function runProcess(args) {
  return new Promise((resolveResult) => {
    const child = spawn(process.execPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolveResult({ code, stdout, stderr }));
  });
}

it("renders one frozen review model with human/JSON semantic parity", () => {
  const plan = buildOpenClawInstallPlan(planOptions("install"));
  const review = buildOpenClawInstallReview(plan);
  assert.equal(Object.isFrozen(review), true);
  assert.deepEqual(review.humanModel, review.jsonModel);
  assert.deepEqual(review.jsonModel.archiveBinding, plan.archiveBinding);
  assert.deepEqual(review.jsonModel.operations, plan.operations);
  assert.deepEqual(review.jsonModel.sensitiveActions, plan.sensitiveActions);
  assert.deepEqual(review.jsonModel.conflicts, plan.conflicts);
  assert.deepEqual(review.jsonModel.predecessor, plan.predecessor);
});

it("ordinary approval binds the plan and D-42 closure but grants no other authority", () => {
  const plan = buildOpenClawInstallPlan(planOptions("install"));
  const approval = buildOpenClawInstallApproval({ plan, ...decision });
  assert.equal(
    OPENCLAW_INSTALL_APPROVAL_SCHEMA_VERSION,
    "agentmo.openclaw-install-approval.v1",
  );
  assert.equal(validateOpenClawInstallApproval(approval, { plan, ...validation }).ok, true);
  assert.deepEqual(approval.archiveBinding, plan.archiveBinding);
  assert.deepEqual(approval.authority, {
    ordinaryManagedWrites: true,
    sensitiveActions: false,
    conflicts: false,
    broaderScope: false,
  });
  for (const mutate of [
    (value) => { value.installPlanDigest = digest("other-plan"); },
    (value) => { value.archiveBinding.archiveSha256 = digest("other-archive"); },
    (value) => { value.archiveBinding.manifestDigest = digest("other-manifest"); },
    (value) => { value.archiveBinding.members[0].byteLength += 1; },
    (value) => { value.scope = "user"; },
    (value) => { value.lifecycle = "rollback"; },
    (value) => { value.authority.sensitiveActions = true; },
  ]) {
    const changed = structuredClone(approval);
    mutate(changed);
    assert.equal(validateOpenClawInstallApproval(changed, { plan, ...validation }).ok, false);
  }
});

it("each sensitive decision exact-binds one action and fails closed on lifecycle state", () => {
  const plan = buildOpenClawInstallPlan(planOptions("install"));
  const action = plan.sensitiveActions[0];
  const approval = buildOpenClawSensitiveActionDecision({
    plan,
    action,
    ...decision,
    useNonce: "sensitive-0001",
  });
  assert.equal(
    OPENCLAW_SENSITIVE_ACTION_DECISION_SCHEMA_VERSION,
    "agentmo.openclaw-sensitive-action-decision.v1",
  );
  assert.equal(validateOpenClawSensitiveActionDecision(
    approval,
    { plan, action, ...validation },
  ).ok, true);
  assert.deepEqual(approval.archiveBinding, plan.archiveBinding);

  const actionMutations = [
    (value) => { value.action.executable = "different"; },
    (value) => { value.action.argv.push("--force"); },
    (value) => { value.action.cwd = ".."; },
    (value) => { value.action.scope = "user"; },
    (value) => { value.action.target = "different"; },
    (value) => { value.action.timeoutMs += 1; },
    (value) => { value.action.environmentNames.push("SECRET_VALUE"); },
  ];
  for (const mutate of actionMutations) {
    const changed = structuredClone(approval);
    mutate(changed);
    assert.equal(validateOpenClawSensitiveActionDecision(
      changed,
      { plan, action, ...validation },
    ).ok, false);
  }
  for (const state of ["deny", "timeout", "cancel"]) {
    assert.throws(
      () => buildOpenClawSensitiveActionDecision({
        plan,
        action,
        ...decision,
        decision: state,
        useNonce: `sensitive-${state}`,
      }),
      { code: "AGENTMO_OPENCLAW_INSTALL_APPROVAL_INVALID" },
    );
  }
  assert.equal(validateOpenClawSensitiveActionDecision(
    approval,
    { plan, action, now: "2026-07-29T02:00:00.000Z" },
  ).ok, false);
  assert.equal(validateOpenClawSensitiveActionDecision(
    approval,
    { plan, action, ...validation, usedNonces: [] },
  ).ok, false);
});

it("one conflict approval binds the complete sorted exact conflict set", () => {
  const options = planOptions("install");
  options.conflicts.push({
    path: ".openclaw/projects/support-triage/skills/tool.md",
    currentDigest: digest("current:tool"),
    desiredDigest: digest("desired:tool"),
    action: "replace",
  });
  options.conflicts.sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
  const plan = buildOpenClawInstallPlan(options);
  const approval = buildOpenClawConflictApproval({
    plan,
    conflicts: plan.conflicts,
    ...decision,
    useNonce: "conflicts-0001",
  });
  assert.equal(
    OPENCLAW_CONFLICT_APPROVAL_SCHEMA_VERSION,
    "agentmo.openclaw-conflict-approval.v1",
  );
  assert.equal(validateOpenClawConflictApproval(
    approval,
    { plan, ...validation },
  ).ok, true);
  assert.deepEqual(approval.archiveBinding, plan.archiveBinding);
  for (const mutate of [
    (value) => { value.conflicts.reverse(); },
    (value) => { value.conflicts.pop(); },
    (value) => { value.conflicts[0].path = "different"; },
    (value) => { value.conflicts[0].currentDigest = digest("changed-current"); },
    (value) => { value.conflicts[0].desiredDigest = digest("changed-desired"); },
    (value) => { value.conflicts[0].action = "abort"; },
  ]) {
    const changed = structuredClone(approval);
    mutate(changed);
    assert.equal(validateOpenClawConflictApproval(
      changed,
      { plan, ...validation },
    ).ok, false);
  }
});

it("all three decision families repeat the same complete archive closure independently", () => {
  const plan = buildOpenClawInstallPlan(planOptions("install"));
  const ordinary = buildOpenClawInstallApproval({ plan, ...decision });
  const sensitive = buildOpenClawSensitiveActionDecision({
      plan,
      action: plan.sensitiveActions[0],
      ...decision,
      useNonce: "sensitive-0002",
    });
  const conflict = buildOpenClawConflictApproval({
      plan,
      conflicts: plan.conflicts,
      ...decision,
      useNonce: "conflicts-0002",
    });
  const authorities = [ordinary, sensitive, conflict];
  for (const authority of authorities) {
    assert.deepEqual(authority.archiveBinding, archiveBinding("install"));
    assert.notEqual(authority.archiveBinding, plan.archiveBinding);
    assert.equal(authority.installPlanDigest, plan.installPlanDigest);
  }

  const validators = [
    [ordinary, (value) => validateOpenClawInstallApproval(
      value,
      { plan, ...validation },
    )],
    [sensitive, (value) => validateOpenClawSensitiveActionDecision(
      value,
      { plan, action: plan.sensitiveActions[0], ...validation },
    )],
    [conflict, (value) => validateOpenClawConflictApproval(
      value,
      { plan, ...validation },
    )],
  ];
  for (const [authority, validate] of validators) {
    for (const mutate of [
      (value) => { value.archiveBinding.archiveSha256 = digest("drift:archive"); },
      (value) => { value.archiveBinding.manifestDigest = digest("drift:manifest"); },
      (value) => { value.archiveBinding.inventoryDigest = digest("drift:inventory"); },
      (value) => { value.archiveBinding.members[0].sha256 = digest("drift:member"); },
    ]) {
      const changed = structuredClone(authority);
      mutate(changed);
      assert.equal(validate(changed).ok, false);
    }
  }
});

function decisionCandidates(plan) {
  return {
    ordinary: buildOpenClawInstallApproval({ plan, ...decision }),
    sensitive: plan.sensitiveActions.map((action, index) => ({
      action,
      candidate: buildOpenClawSensitiveActionDecision({
        plan,
        action,
        ...decision,
        useNonce: `sensitive-writer-${index}`,
      }),
    })),
    conflict: buildOpenClawConflictApproval({
      plan,
      conflicts: plan.conflicts,
      ...decision,
      useNonce: "conflict-writer",
    }),
  };
}

it("publishes ordinary, sensitive and conflict authorities independently and create-only", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-install-decision-writers-"));
  const plan = buildOpenClawInstallPlan(planOptions("install"));
  const candidates = decisionCandidates(plan);
  const ordinaryFile = path.join(root, "ordinary.json");
  const sensitiveFile = path.join(root, "sensitive.json");
  const conflictFile = path.join(root, "conflict.json");

  const results = await Promise.all([
    writeOpenClawInstallApproval(ordinaryFile, candidates.ordinary),
    writeOpenClawSensitiveActionDecision(
      sensitiveFile,
      candidates.sensitive[0].candidate,
      { plan, action: candidates.sensitive[0].action, ...validation },
    ),
    writeOpenClawConflictApproval(
      conflictFile,
      candidates.conflict,
      { plan, ...validation },
    ),
  ]);
  for (const [index, filePath] of [ordinaryFile, sensitiveFile, conflictFile].entries()) {
    assert.equal(results[index].filePath, filePath);
    assert.equal(results[index].digest, digestBytes(await readFile(filePath)));
    assert.deepEqual(
      JSON.parse(await readFile(filePath, "utf8")).archiveBinding,
      plan.archiveBinding,
    );
  }
  assert.notEqual(
    JSON.parse(await readFile(ordinaryFile, "utf8")).schemaVersion,
    JSON.parse(await readFile(sensitiveFile, "utf8")).schemaVersion,
  );
  assert.notEqual(
    JSON.parse(await readFile(sensitiveFile, "utf8")).schemaVersion,
    JSON.parse(await readFile(conflictFile, "utf8")).schemaVersion,
  );

  await assert.rejects(
    () => writeOpenClawInstallApproval(ordinaryFile, candidates.ordinary),
    (error) => error?.code === "EEXIST",
  );
  await assert.rejects(
    () => writeOpenClawInstallApproval(
      path.join(root, "forged.json"),
      structuredClone(candidates.ordinary),
    ),
    (error) => error?.code === "AGENTMO_PERSISTABILITY_UNADMITTED_CANDIDATE",
  );
});

it("preserves a failed approval output instead of pathname cleanup", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-install-decision-failure-"));
  const output = path.join(root, "ordinary.json");
  const plan = buildOpenClawInstallPlan(planOptions("install"));
  const approval = buildOpenClawInstallApproval({ plan, ...decision });
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
    () => writeOpenClawInstallApproval(
      output,
      approval,
      { openOutput: driftingOpen },
    ),
    (error) => error?.code === "AGENTMO_PERSISTABILITY_OUTPUT_MISMATCH",
  );
  assert.equal(await readFile(output, "utf8"), "{}\n");
});

it("preflights the entire one-screen decision set before publishing its first file", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-install-review-writers-"));
  const plan = buildOpenClawInstallPlan(planOptions("install"));
  const candidates = decisionCandidates(plan);
  const outputs = {
    ordinary: {
      filePath: path.join(root, "ordinary.json"),
      candidate: candidates.ordinary,
    },
    sensitive: candidates.sensitive.map(({ action, candidate }, index) => ({
      filePath: path.join(root, `sensitive-${index}.json`),
      action,
      candidate,
    })),
    conflict: {
      filePath: path.join(root, "conflict.json"),
      candidate: candidates.conflict,
    },
  };

  const published = await writeOpenClawInstallReviewDecisions({
    plan,
    outputs,
    validation,
  });
  assert.equal(published.length, 3);
  assert.deepEqual(
    published.map(({ filePath }) => filePath),
    [
      outputs.ordinary.filePath,
      outputs.sensitive[0].filePath,
      outputs.conflict.filePath,
    ],
  );

  const secondRoot = await mkdtemp(path.join(tmpdir(), "agentmo-install-review-preflight-"));
  const blockedOutputs = {
    ordinary: {
      ...outputs.ordinary,
      filePath: path.join(secondRoot, "ordinary.json"),
    },
    sensitive: outputs.sensitive.map((output) => ({
      ...output,
      filePath: path.join(secondRoot, "sensitive.json"),
    })),
    conflict: {
      ...outputs.conflict,
      filePath: path.join(secondRoot, "conflict.json"),
    },
  };
  await writeFile(blockedOutputs.conflict.filePath, "foreign\n", "utf8");
  await assert.rejects(
    () => writeOpenClawInstallReviewDecisions({
      plan,
      outputs: blockedOutputs,
      validation,
    }),
    (error) => error?.code === "EEXIST",
  );
  await assert.rejects(() => access(blockedOutputs.ordinary.filePath));
  await assert.rejects(() => access(blockedOutputs.sensitive[0].filePath));
  assert.equal(await readFile(blockedOutputs.conflict.filePath, "utf8"), "foreign\n");

  const incomplete = {
    ordinary: blockedOutputs.ordinary,
    sensitive: [],
    conflict: {
      ...blockedOutputs.conflict,
      filePath: path.join(secondRoot, "new-conflict.json"),
    },
  };
  await assert.rejects(
    () => writeOpenClawInstallReviewDecisions({
      plan,
      outputs: incomplete,
      validation,
    }),
    (error) => error?.code === "AGENTMO_OPENCLAW_INSTALL_APPROVAL_CARDINALITY",
  );
  await assert.rejects(() => access(incomplete.ordinary.filePath));
  await assert.rejects(() => access(incomplete.conflict.filePath));
});

it("a fresh approval process publishes independently exact-admissible authority files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-install-approval-cli-"));
  const planFile = path.join(root, "plan.json");
  const requestFile = path.join(root, "approval-request.json");
  const ordinaryFile = path.join(root, "ordinary.json");
  const sensitiveFile = path.join(root, "sensitive.json");
  const conflictFile = path.join(root, "conflict.json");
  const plan = buildOpenClawInstallPlan(planOptions());
  const planWrite = await writeOpenClawInstallPlan(planFile, plan);
  const request = {
    issuedAt: "2026-07-30T00:00:00.000Z",
    expiresAt: "2026-07-30T01:00:00.000Z",
    validationNow: "2026-07-30T00:30:00.000Z",
    noncePrefix: "review-0001",
  };
  const requestBytes = Buffer.from(
    serializePersistableJson(request, { subject: "approval-request" }),
    "utf8",
  );
  await writeFile(requestFile, requestBytes);
  const result = await runProcess([
    CLI,
    "openclaw-install-approve",
    "--plan", planFile,
    "--plan-sha256", planWrite.digest,
    "--request", requestFile,
    "--request-sha256", digestBytes(requestBytes),
    "--ordinary-out", ordinaryFile,
    "--sensitive-out", sensitiveFile,
    "--conflict-out", conflictFile,
    "--json",
  ]);
  assert.equal(result.code, 0, result.stderr || result.stdout);

  const outputs = [
    [ordinaryFile, "openclaw-install-approval"],
    [sensitiveFile, "openclaw-sensitive-action-decision"],
    [conflictFile, "openclaw-conflict-approval"],
  ];
  for (const [file, subject] of outputs) {
    const bytes = await readFile(file);
    const admission = await runProcess([
      "--input-type=module",
      "--eval",
      `import {loadAdmittedArtifact} from ${JSON.stringify(ADMISSION_MODULE)};`
        + "const [filePath,subject,expectedDigest]=process.argv.slice(1);"
        + "await loadAdmittedArtifact({filePath,subject,expectedDigest});",
      file,
      subject,
      digestBytes(bytes),
    ]);
    assert.equal(admission.code, 0, admission.stderr);
  }
});
