import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { promisify } from "node:util";
import { digestRawBytes } from "../src/artifact-admission.js";
import { abortAppendOnlyPrepared } from "../src/builder-append-only-authority.js";
import {
  applyBuilderInstall,
  planBuilderInstall,
} from "../src/builder-install.js";
import {
  buildBuilderCheckpoint,
  finalizeBuilderHookCheckpoint,
  loadBuilderCheckpoint,
  loadBuilderCheckpointHead,
  prepareBuilderHookCheckpoint,
  reserveBuilderCheckpointUpgrade,
  writeBuilderCheckpoint,
} from "../src/builder-checkpoint.js";
import {
  loadImmutableJournal,
  readImmutableJournalAdmissionBytes,
} from "../src/builder-immutable-journal.js";
import { diagnoseBuilderInstall } from "../src/builder-doctor.js";
import { deliverInstalledBuilderHook } from "../src/builder-hook-bridge.js";
import {
  BUILDER_NPM_METADATA_FILES,
  BUILDER_RELEASE_ASSET_INVENTORY,
} from "../src/builder-package.js";
import {
  applyBuilderDeactivate,
  applyBuilderReactivate,
  applyBuilderUninstall,
  applyBuilderUpgrade,
  abortBuilderUpgradeReservation,
  admitBuilderLifecycleReceipt,
  admitBuilderLifecycleSelection,
  planBuilderDeactivate,
  planBuilderReactivate,
  planBuilderUninstall,
  planBuilderUpgrade,
  readBuilderLifecycleState,
} from "../src/builder-lifecycle.js";
import { serializePersistableJson } from "../src/persistability.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);

function compatibleProbe() {
  return {
    schemaVersion: "agentmo.builder-probe.v1",
    adapter: { id: "codex" },
    host: { version: "0.144.2" },
    mutatesHost: "unknown",
    externalCommandMutation: "unknown",
    observations: [
      { id: "codex-cli", requirement: "required", status: "observed" },
      { id: "native-hooks", requirement: "required", status: "observed" },
      { id: "plugin-distribution", requirement: "required", status: "observed" },
      { id: "session-resume", requirement: "required", status: "observed" },
      { id: "host-doctor", requirement: "optional", status: "degraded" },
    ],
    required: { ok: true, missing: [], incompatible: [] },
  };
}

async function installProject() {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "agentmo-lifecycle-v1-"));
  const probe = compatibleProbe();
  const preview = await planBuilderInstall({ projectRoot, probe });
  const installed = await applyBuilderInstall({
    projectRoot,
    probe,
    expectedPlanDigest: preview.planDigest,
  });
  const receiptValue = JSON.parse(await readFile(
    path.join(projectRoot, ...installed.receipt.path.split("/")),
    "utf8",
  ));
  return {
    projectRoot,
    probe,
    installed: {
      ...installed,
      receipt: { ...installed.receipt, value: receiptValue },
    },
  };
}

async function upgradedPackage() {
  const packageRoot = await mkdtemp(path.join(tmpdir(), "agentmo-lifecycle-v1-package-"));
  for (const relativePath of [
    ...BUILDER_RELEASE_ASSET_INVENTORY.map((asset) => asset.sourcePath),
    ...BUILDER_NPM_METADATA_FILES,
  ]) {
    const destination = path.join(packageRoot, ...relativePath.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(REPO_ROOT, ...relativePath.split("/")), destination);
  }
  const manifest = JSON.parse(await readFile(path.join(REPO_ROOT, "package.json"), "utf8"));
  manifest.version = "0.2.0";
  await writeFile(path.join(packageRoot, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const pluginManifestPath = path.join(packageRoot, "plugin/.codex-plugin/plugin.json");
  const pluginManifest = JSON.parse(await readFile(pluginManifestPath, "utf8"));
  pluginManifest.version = "0.2.0";
  await writeFile(pluginManifestPath, `${JSON.stringify(pluginManifest, null, 2)}\n`, "utf8");
  return packageRoot;
}

async function immutableSnapshot(projectRoot, receipt) {
  const paths = [receipt.path, ...receipt.value.files.map((entry) => entry.relativePath)];
  const snapshot = {};
  for (const relativePath of [...new Set(paths)].sort()) {
    const absolute = path.join(projectRoot, ...relativePath.split("/"));
    const metadata = await stat(absolute, { bigint: true });
    snapshot[relativePath] = {
      bytes: (await readFile(absolute)).toString("base64"),
      dev: metadata.dev.toString(10),
      ino: metadata.ino.toString(10),
      nlink: metadata.nlink.toString(10),
    };
  }
  return snapshot;
}

async function stopLifecycleAppendAtClaim(options, sequence) {
  const lifecycleModule = new URL("../src/builder-lifecycle.js", import.meta.url).href;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `const lifecycle = await import(${JSON.stringify(lifecycleModule)}); await lifecycle.applyBuilderReactivate(${JSON.stringify(options)});`,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const closed = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
  const claimsPath = path.join(
    options.projectRoot,
    ".agentmo",
    "builder",
    "lifecycle-authority",
    "claims",
  );
  const deadline = Date.now() + 15_000;
  const claimName = `${String(sequence).padStart(16, "0")}.json`;
  let stopped = false;
  while (Date.now() < deadline && child.exitCode === null) {
    const names = await readdir(claimsPath).catch((error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    });
    if (names.includes(claimName)) {
      stopped = child.kill("SIGSTOP");
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.equal(stopped, true, "lifecycle append completed before its claim was observed");
  child.kill("SIGKILL");
  assert.deepEqual(await closed, { code: null, signal: "SIGKILL" });
}

describe("AgentMo v1 append-only lifecycle", () => {
  it("deactivates by appending an idempotent tombstone without changing installed bytes or inodes", async () => {
    const { projectRoot, probe, installed } = await installProject();
    const before = await immutableSnapshot(projectRoot, installed.receipt);
    const preview = await planBuilderDeactivate({
      projectRoot,
      probe,
      expectedReceiptDigest: installed.receipt.digest,
    });
    assert.equal(preview.action, "deactivate");
    assert.equal(preview.physicalDeletion, false);
    assert.deepEqual(preview.operations.map((entry) => entry.operation), [
      "fence-checkpoint-authority",
      "append-tombstone",
    ]);

    const applied = await applyBuilderDeactivate({
      projectRoot,
      probe,
      expectedReceiptDigest: installed.receipt.digest,
      expectedPlanDigest: preview.planDigest,
    });
    assert.equal(applied.status, "deactivated");
    assert.equal(applied.changed, true);
    assert.deepEqual(await immutableSnapshot(projectRoot, installed.receipt), before);
    assert.equal((await readBuilderLifecycleState({ projectRoot })).status, "deactivated");

    const repeatedPreview = await planBuilderDeactivate({
      projectRoot,
      probe,
      expectedReceiptDigest: installed.receipt.digest,
    });
    const repeated = await applyBuilderDeactivate({
      projectRoot,
      probe,
      expectedReceiptDigest: installed.receipt.digest,
      expectedPlanDigest: repeatedPreview.planDigest,
    });
    assert.equal(repeated.status, "deactivated");
    assert.equal(repeated.changed, false);
    assert.deepEqual(await immutableSnapshot(projectRoot, installed.receipt), before);
  });

  it("keeps uninstall only as a deprecated non-delete alias for deactivate", async () => {
    const { projectRoot, probe, installed } = await installProject();
    const before = await immutableSnapshot(projectRoot, installed.receipt);
    const preview = await planBuilderUninstall({
      projectRoot,
      probe,
      expectedReceiptDigest: installed.receipt.digest,
    });
    assert.equal(preview.action, "deactivate");
    assert.equal(preview.deprecatedAlias, "uninstall");
    assert.match(preview.migrationNotice, /deactivate/u);
    const result = await applyBuilderUninstall({
      projectRoot,
      probe,
      expectedReceiptDigest: installed.receipt.digest,
      expectedPlanDigest: preview.planDigest,
    });
    assert.equal(result.status, "deactivated");
    assert.equal(result.deprecatedAlias, "uninstall");
    assert.deepEqual(await immutableSnapshot(projectRoot, installed.receipt), before);
  });

  it("publishes upgrades under immutable version-qualified paths and appends activation successors", async () => {
    const { projectRoot, probe, installed } = await installProject();
    const before = await immutableSnapshot(projectRoot, installed.receipt);
    const checkpointPath = path.join(projectRoot, ".agentmo", "checkpoints", "builder.json");
    const initialCheckpoint = await writeBuilderCheckpoint(checkpointPath, buildBuilderCheckpoint({
      workflowId: "lifecycle-upgrade-fence",
      adapterId: "codex",
      stage: "plan",
      boundary: "approval-required",
      artifactRefs: [],
      pendingDecision: {
        id: "upgrade-approval",
        kind: "approval",
        summaryDigest: installed.receipt.digest,
      },
      nextAction: "await-approval",
      installReceiptDigest: installed.receipt.digest,
      capabilitySnapshot: {
        adapterId: "codex",
        evidenceLevel: "observed",
        digest: installed.receipt.value.capabilitySnapshot.digest,
        required: installed.receipt.value.capabilitySnapshot.required,
      },
      eventLedger: { cursor: 0, recentEvents: [] },
      pauseReason: null,
    }));
    const predecessorLifecycle = await readBuilderLifecycleState({ projectRoot });
    const packageRoot = await upgradedPackage();
    const preview = await planBuilderUpgrade({
      projectRoot,
      probe,
      packageOptions: { packageRoot },
      expectedReceiptDigest: installed.receipt.digest,
    });
    assert.equal(preview.operations.some((entry) => ["replace", "delete", "remove"].includes(entry.operation)), false);
    const result = await applyBuilderUpgrade({
      projectRoot,
      probe,
      packageOptions: { packageRoot },
      expectedReceiptDigest: installed.receipt.digest,
      expectedPlanDigest: preview.planDigest,
    });
    assert.equal(result.status, "activated-successor");
    assert.equal(result.changed, true);
    assert.match(result.receipt.path, /^\.agentmo\/builder\/releases\/[a-f0-9]{64}\/install-receipt\.json$/u);
    assert.deepEqual(await immutableSnapshot(projectRoot, installed.receipt), before);
    const state = await readBuilderLifecycleState({ projectRoot });
    assert.equal(state.status, "active");
    assert.equal(state.activeReceiptDigest, result.receipt.digest);
    const checkpointJournal = await loadImmutableJournal({ journalPath: checkpointPath });
    const checkpointProtocols = checkpointJournal.entries.map((entry) => JSON.parse(
      new TextDecoder("utf8", { fatal: true }).decode(
        readImmutableJournalAdmissionBytes(entry),
      ),
    ).hookDeactivationProtocol);
    assert.deepEqual(
      checkpointProtocols.map((protocol) => protocol.state),
      ["open", "upgrade-reserved", "open"],
    );
    assert.equal(
      checkpointProtocols[1].upgradeReservation.successorReceiptDigest,
      result.receipt.digest,
    );
    const checkpointBeforeStaleHook = checkpointJournal.entries.map((entry) => entry.digest);
    await assert.rejects(
      prepareBuilderHookCheckpoint(checkpointPath, {
        checkpointAdmission: initialCheckpoint,
        checkpoint: initialCheckpoint.value,
        lifecycleHeadDigest: predecessorLifecycle.authorityHeadDigest,
        receiptDigest: installed.receipt.digest,
        delivery: {
          identity: `sha256:${"a".repeat(64)}`,
          type: "SessionStart",
          epoch: 0,
          sequence: 1,
          eventDigest: `sha256:${"b".repeat(64)}`,
          applied: false,
          status: "duplicate",
          observationRequired: true,
        },
      }),
      (error) => error?.code === "AGENTMO_BUILDER_CHECKPOINT_CONFLICT_REJECTED",
    );
    const checkpointAfterStaleHook = await loadImmutableJournal({ journalPath: checkpointPath });
    assert.deepEqual(
      checkpointAfterStaleHook.entries.map((entry) => entry.digest),
      checkpointBeforeStaleHook,
    );
    assert.equal(
      (await loadBuilderCheckpointHead(checkpointPath)).value.installReceiptDigest,
      result.receipt.digest,
    );
    for (const file of state.activeReceipt.files) {
      const pathKey = digestRawBytes(Buffer.from(serializePersistableJson({
        path: file.relativePath,
        digest: file.digest,
      }, { subject: "builder-release-stage-key" }), "utf8")).slice("sha256:".length);
      const expectedStagePath = `${path.posix.dirname(file.relativePath)}/.${path.posix.basename(
        file.relativePath,
      )}.${pathKey}.stage`;
      assert.equal(file.stagePath, expectedStagePath);
      assert.equal(path.posix.dirname(file.stagePath), path.posix.dirname(file.relativePath));
      const [stageStats, finalStats] = await Promise.all([
        stat(path.join(projectRoot, ...file.stagePath.split("/")), { bigint: true }),
        stat(path.join(projectRoot, ...file.relativePath.split("/")), { bigint: true }),
      ]);
      assert.equal(stageStats.dev, finalStats.dev);
      assert.equal(stageStats.ino, finalStats.ino);
      assert.equal(stageStats.nlink, 2n);
      assert.equal(finalStats.nlink, 2n);
    }
    const admitted = await admitBuilderLifecycleReceipt({
      projectRoot,
      expectedReceiptDigest: result.receipt.digest,
    });
    assert.equal(admitted.schemaVersion, "agentmo.builder-lifecycle-selection-admission.v1");
    assert.equal(admitted.receiptPath, result.receipt.path);
    assert.equal(admitted.receiptDigest, result.receipt.digest);
    assert.equal(admitted.release.version, "0.2.0");
    assert.equal(admitted.package.version, "0.2.0");
    assert.equal(admitted.package.releaseDigest, admitted.release.releaseDigest);
    assert.equal(admitted.files.every((file) => file.currentStatus === "pristine"), true);
    assert.deepEqual(admitted.receiptLineageDigests, [
      installed.receipt.digest,
      result.receipt.digest,
    ]);

    const repeatedPreview = await planBuilderUpgrade({
      projectRoot,
      probe,
      packageOptions: { packageRoot },
      expectedReceiptDigest: result.receipt.digest,
    });
    const repeated = await applyBuilderUpgrade({
      projectRoot,
      probe,
      packageOptions: { packageRoot },
      expectedReceiptDigest: result.receipt.digest,
      expectedPlanDigest: repeatedPreview.planDigest,
    });
    assert.equal(repeated.changed, false);
    assert.equal(repeated.receipt.path, result.receipt.path);
  });

  it("requires an exact explicit abort to release an uncommitted upgrade reservation", async () => {
    const { projectRoot, probe, installed } = await installProject();
    const checkpointPath = path.join(projectRoot, ".agentmo", "checkpoints", "builder.json");
    const checkpoint = await writeBuilderCheckpoint(checkpointPath, buildBuilderCheckpoint({
      workflowId: "lifecycle-upgrade-abort",
      adapterId: "codex",
      stage: "plan",
      boundary: "approval-required",
      artifactRefs: [],
      pendingDecision: {
        id: "upgrade-abort-approval",
        kind: "approval",
        summaryDigest: installed.receipt.digest,
      },
      nextAction: "await-approval",
      installReceiptDigest: installed.receipt.digest,
      capabilitySnapshot: {
        adapterId: "codex",
        evidenceLevel: "observed",
        digest: installed.receipt.value.capabilitySnapshot.digest,
        required: installed.receipt.value.capabilitySnapshot.required,
      },
      eventLedger: { cursor: 0, recentEvents: [] },
      pauseReason: null,
    }));
    const packageRoot = await upgradedPackage();
    const preview = await planBuilderUpgrade({
      projectRoot,
      probe,
      packageOptions: { packageRoot },
      expectedReceiptDigest: installed.receipt.digest,
    });
    const predecessor = await readBuilderLifecycleState({ projectRoot });
    const reserved = await reserveBuilderCheckpointUpgrade(checkpointPath, {
      checkpointAdmission: checkpoint,
      lifecycleHeadDigest: predecessor.authorityHeadDigest,
      receiptDigest: installed.receipt.digest,
      planDigest: preview.planDigest,
      successorReceiptDigest: preview.desired.receiptDigest,
    });
    assert.equal(reserved.value.hookDeactivationProtocol.state, "upgrade-reserved");

    const deactivate = await planBuilderDeactivate({
      projectRoot,
      expectedReceiptDigest: installed.receipt.digest,
    });
    await assert.rejects(
      applyBuilderDeactivate({
        projectRoot,
        expectedReceiptDigest: installed.receipt.digest,
        expectedPlanDigest: deactivate.planDigest,
      }),
      (error) => error?.code === "AGENTMO_BUILDER_LIFECYCLE_UPGRADE_RECOVERY_REQUIRED",
    );
    const beforeRejectedAbort = (await loadBuilderCheckpointHead(checkpointPath)).digest;
    await assert.rejects(
      abortBuilderUpgradeReservation({
        projectRoot,
        expectedReceiptDigest: installed.receipt.digest,
        expectedPlanDigest: `sha256:${"f".repeat(64)}`,
      }),
      (error) => error?.code === "AGENTMO_BUILDER_LIFECYCLE_PLAN_CHANGED",
    );
    assert.equal((await loadBuilderCheckpointHead(checkpointPath)).digest, beforeRejectedAbort);

    const recovery = await execFileAsync(process.execPath, [
      "bin/agentmo.js",
      "builder",
      "recover",
      "upgrade",
      "--project",
      projectRoot,
      "--digest",
      `builder-install-receipt=${installed.receipt.digest}`,
      "--apply",
      "--plan-digest",
      preview.planDigest,
      "--json",
    ], { cwd: REPO_ROOT });
    const aborted = JSON.parse(recovery.stdout);
    assert.equal(aborted.status, "aborted-reservation");
    assert.equal(aborted.changed, true);
    const released = await loadBuilderCheckpointHead(checkpointPath);
    assert.equal(released.value.hookDeactivationProtocol.state, "open");
    assert.equal(released.value.installReceiptDigest, installed.receipt.digest);
    assert.equal((await readBuilderLifecycleState({ projectRoot })).activeReceiptDigest, installed.receipt.digest);

    const resumed = await planBuilderUpgrade({
      projectRoot,
      probe,
      packageOptions: { packageRoot },
      expectedReceiptDigest: installed.receipt.digest,
    });
    const applied = await applyBuilderUpgrade({
      projectRoot,
      probe,
      packageOptions: { packageRoot },
      expectedReceiptDigest: installed.receipt.digest,
      expectedPlanDigest: resumed.planDigest,
    });
    assert.equal(applied.status, "activated-successor");
    assert.equal((await loadBuilderCheckpointHead(checkpointPath)).value.installReceiptDigest,
      applied.receipt.digest);
  });

  it("rejects a renamed or replacement authority root instead of resetting lifecycle history", async () => {
    const deactivated = await installProject();
    const deactivatePlan = await planBuilderDeactivate({
      projectRoot: deactivated.projectRoot,
      probe: deactivated.probe,
      expectedReceiptDigest: deactivated.installed.receipt.digest,
    });
    await applyBuilderDeactivate({
      projectRoot: deactivated.projectRoot,
      probe: deactivated.probe,
      expectedReceiptDigest: deactivated.installed.receipt.digest,
      expectedPlanDigest: deactivatePlan.planDigest,
    });
    const deactivatedAuthority = path.join(
      deactivated.projectRoot,
      ".agentmo/builder/lifecycle-authority",
    );
    const retainedGenesisReceipt = await readFile(path.join(
      deactivated.projectRoot,
      ...deactivated.installed.receipt.path.split("/"),
    ));
    await rename(deactivatedAuthority, `${deactivatedAuthority}-displaced`);
    await assert.rejects(
      readBuilderLifecycleState({ projectRoot: deactivated.projectRoot }),
      (error) => error?.code === "AGENTMO_APPEND_ONLY_LINEAGE_ROOT_MISSING",
    );
    await assert.rejects(
      planBuilderDeactivate({
        projectRoot: deactivated.projectRoot,
        probe: deactivated.probe,
        expectedReceiptDigest: deactivated.installed.receipt.digest,
      }),
      (error) => error?.code === "AGENTMO_APPEND_ONLY_LINEAGE_ROOT_MISSING",
    );
    const appendOnlyLineage = path.join(
      deactivated.projectRoot,
      ".agentmo-append-only-lineage",
    );
    await rename(appendOnlyLineage, `${appendOnlyLineage}-displaced`);
    for (const operation of [
      () => readBuilderLifecycleState({ projectRoot: deactivated.projectRoot }),
      () => planBuilderDeactivate({
        projectRoot: deactivated.projectRoot,
        probe: deactivated.probe,
        expectedReceiptDigest: deactivated.installed.receipt.digest,
      }),
    ]) {
      await assert.rejects(
        operation(),
        (error) => error?.code === "AGENTMO_APPEND_ONLY_LINEAGE_ANCHOR_MISSING",
      );
    }
    assert.deepEqual(
      await readFile(path.join(
        deactivated.projectRoot,
        ...deactivated.installed.receipt.path.split("/"),
      )),
      retainedGenesisReceipt,
    );

    const upgraded = await installProject();
    const packageRoot = await upgradedPackage();
    const upgradePlan = await planBuilderUpgrade({
      projectRoot: upgraded.projectRoot,
      probe: upgraded.probe,
      packageOptions: { packageRoot },
      expectedReceiptDigest: upgraded.installed.receipt.digest,
    });
    const upgradedResult = await applyBuilderUpgrade({
      projectRoot: upgraded.projectRoot,
      probe: upgraded.probe,
      packageOptions: { packageRoot },
      expectedReceiptDigest: upgraded.installed.receipt.digest,
      expectedPlanDigest: upgradePlan.planDigest,
    });
    const upgradedAuthority = path.join(
      upgraded.projectRoot,
      ".agentmo/builder/lifecycle-authority",
    );
    await rename(upgradedAuthority, `${upgradedAuthority}-displaced`);
    await mkdir(upgradedAuthority, { mode: 0o700 });
    for (const name of ["claims", "entries", "outcomes", "prepared", "stages"]) {
      await mkdir(path.join(upgradedAuthority, name), { mode: 0o700 });
    }
    await assert.rejects(
      readBuilderLifecycleState({ projectRoot: upgraded.projectRoot }),
      (error) => error?.code === "AGENTMO_APPEND_ONLY_LINEAGE_ROOT_CHANGED",
    );
    await assert.rejects(
      planBuilderUpgrade({
        projectRoot: upgraded.projectRoot,
        probe: upgraded.probe,
        packageOptions: { packageRoot },
        expectedReceiptDigest: upgradedResult.receipt.digest,
      }),
      (error) => error?.code === "AGENTMO_APPEND_ONLY_LINEAGE_ROOT_CHANGED",
    );
  });

  it("rejects runtime-bearing manifest expansion or semantic drift before upgrade mutation", async () => {
    const { projectRoot, probe, installed } = await installProject();
    const before = await immutableSnapshot(projectRoot, installed.receipt);
    const variants = [
      ["extra-bin", (manifest) => { manifest.bin.other = "./bin/other.js"; }],
      ["lifecycle-script", (manifest) => { manifest.scripts.postinstall = "node ./bin/agentmo.js"; }],
      ["engine", (manifest) => { manifest.engines.node = ">=22"; }],
      ["capability", (_manifest, plugin) => { plugin.interface.capabilities.push("Network"); }],
      ["default-prompt", (_manifest, plugin) => { plugin.interface.defaultPrompt[0] = "Run an unreviewed action."; }],
    ];
    for (const [label, mutate] of variants) {
      const packageRoot = await upgradedPackage();
      const packagePath = path.join(packageRoot, "package.json");
      const pluginPath = path.join(packageRoot, "plugin/.codex-plugin/plugin.json");
      const [manifest, plugin] = await Promise.all([
        readFile(packagePath, "utf8").then(JSON.parse),
        readFile(pluginPath, "utf8").then(JSON.parse),
      ]);
      mutate(manifest, plugin);
      await Promise.all([
        writeFile(packagePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
        writeFile(pluginPath, `${JSON.stringify(plugin, null, 2)}\n`, "utf8"),
      ]);
      await assert.rejects(
        planBuilderUpgrade({
          projectRoot,
          probe,
          packageOptions: { packageRoot },
          expectedReceiptDigest: installed.receipt.digest,
        }),
        (error) => error?.code === "AGENTMO_BUILDER_PACKAGE_INVALID"
          || error?.code === "AGENTMO_BUILDER_LIFECYCLE_SUCCESSOR_RUNTIME_INCOMPATIBLE",
        label,
      );
      assert.deepEqual(await immutableSnapshot(projectRoot, installed.receipt), before, label);
    }
  });

  it("reactivates only by appending a successor and leaves tombstones immutable", async () => {
    const { projectRoot, probe, installed } = await installProject();
    const deactivate = await planBuilderDeactivate({
      projectRoot,
      probe,
      expectedReceiptDigest: installed.receipt.digest,
    });
    await applyBuilderDeactivate({
      projectRoot,
      probe,
      expectedReceiptDigest: installed.receipt.digest,
      expectedPlanDigest: deactivate.planDigest,
    });
    const preview = await planBuilderReactivate({
      projectRoot,
      expectedReceiptDigest: installed.receipt.digest,
    });
    assert.equal(preview.operations[0].operation, "append-activation");
    const result = await applyBuilderReactivate({
      projectRoot,
      expectedReceiptDigest: installed.receipt.digest,
      expectedPlanDigest: preview.planDigest,
    });
    assert.equal(result.status, "active");
    assert.equal((await readBuilderLifecycleState({ projectRoot })).status, "active");
  });

  it("rejects lifecycle selection, doctor, and a deactivated hook until a prepared append is exactly recovered", async () => {
    const { projectRoot, installed, probe } = await installProject();
    const deactivate = await planBuilderDeactivate({
      projectRoot,
      probe,
      expectedReceiptDigest: installed.receipt.digest,
    });
    await applyBuilderDeactivate({
      projectRoot,
      probe,
      expectedReceiptDigest: installed.receipt.digest,
      expectedPlanDigest: deactivate.planDigest,
    });
    const before = await readBuilderLifecycleState({ projectRoot });
    assert.equal(before.status, "deactivated");
    const authority = {
      projectRoot,
      relativeRoot: ".agentmo/builder/lifecycle-authority",
      namespace: "builder-lifecycle",
    };
    const reactivation = await planBuilderReactivate({
      projectRoot,
      expectedReceiptDigest: installed.receipt.digest,
    });
    await stopLifecycleAppendAtClaim({
      projectRoot,
      expectedReceiptDigest: installed.receipt.digest,
      expectedPlanDigest: reactivation.planDigest,
    }, before.transitions.length);

    const interrupted = await readBuilderLifecycleState({ projectRoot });
    assert.ok(interrupted.recoveryRequired);
    const diagnosis = await diagnoseBuilderInstall({
      projectRoot,
      probe: compatibleProbe(),
    });
    assert.equal(diagnosis.status, "inconsistent");
    for (const admit of [admitBuilderLifecycleSelection, admitBuilderLifecycleReceipt]) {
      await assert.rejects(
        admit({
          projectRoot,
          expectedReceiptDigest: installed.receipt.digest,
        }),
        (error) => error?.code === "AGENTMO_BUILDER_LIFECYCLE_RECOVERY_REQUIRED",
      );
    }
    const previousCwd = process.cwd();
    try {
      process.chdir(projectRoot);
      await assert.rejects(
        deliverInstalledBuilderHook({
          hookInput: {},
          runnerDigest: `sha256:${"a".repeat(64)}`,
        }),
        (error) => (
          error?.code === "AGENTMO_BUILDER_HOOK_BRIDGE_LIFECYCLE_RECOVERY_REQUIRED"
        ),
      );
    } finally {
      process.chdir(previousCwd);
    }

    const aborted = await abortAppendOnlyPrepared({
      ...authority,
      expectedHeadDigest: interrupted.authorityHeadDigest,
      expectedPreparedRecordDigest: interrupted.recoveryRequired.recordDigest,
      reason: "RECOVERY_TEST_CANCELLED",
    });
    assert.equal(aborted.status, "aborted");
    const recovered = await readBuilderLifecycleState({ projectRoot });
    assert.equal(recovered.recoveryRequired, null);
    assert.equal(recovered.status, "deactivated");
    const admitted = await admitBuilderLifecycleReceipt({
      projectRoot,
      expectedReceiptDigest: installed.receipt.digest,
    });
    assert.equal(admitted.receiptDigest, installed.receipt.digest);
  });

  it("fails closed on a prepared hook, then preserves the fence through tombstone and releases it after reactivation", async () => {
    const { projectRoot, installed } = await installProject();
    const checkpointPath = path.join(projectRoot, ".agentmo", "checkpoints", "builder.json");
    const checkpoint = buildBuilderCheckpoint({
      workflowId: "lifecycle-hook-fence",
      adapterId: "codex",
      stage: "produce",
      boundary: "artifact-created",
      artifactRefs: [],
      pendingDecision: null,
      nextAction: "complete",
      installReceiptDigest: installed.receipt.digest,
      capabilitySnapshot: {
        adapterId: "codex",
        evidenceLevel: "observed",
        digest: installed.receipt.value.capabilitySnapshot.digest,
        required: installed.receipt.value.capabilitySnapshot.required,
      },
      eventLedger: { cursor: 0, recentEvents: [] },
      pauseReason: null,
    });
    const initial = await writeBuilderCheckpoint(checkpointPath, checkpoint);
    const prepared = await prepareBuilderHookCheckpoint(checkpointPath, {
      checkpointAdmission: initial,
      checkpoint: initial.value,
      lifecycleHeadDigest: (await readBuilderLifecycleState({ projectRoot })).authorityHeadDigest,
      receiptDigest: installed.receipt.digest,
      delivery: {
        identity: `sha256:${"a".repeat(64)}`,
        type: "SessionStart",
        epoch: 0,
        sequence: 1,
        eventDigest: `sha256:${"b".repeat(64)}`,
        applied: false,
        status: "duplicate",
        observationRequired: true,
      },
    });
    const deactivate = await planBuilderDeactivate({
      projectRoot,
      expectedReceiptDigest: installed.receipt.digest,
    });
    await assert.rejects(
      applyBuilderDeactivate({
        projectRoot,
        expectedReceiptDigest: installed.receipt.digest,
        expectedPlanDigest: deactivate.planDigest,
      }),
      (error) => error?.code === "AGENTMO_BUILDER_LIFECYCLE_HOOK_IN_FLIGHT",
    );
    assert.equal((await readBuilderLifecycleState({ projectRoot })).status, "active");

    await finalizeBuilderHookCheckpoint(
      checkpointPath,
      prepared,
      `sha256:${"c".repeat(64)}`,
    );
    await applyBuilderDeactivate({
      projectRoot,
      expectedReceiptDigest: installed.receipt.digest,
      expectedPlanDigest: deactivate.planDigest,
    });
    const fenced = await loadBuilderCheckpointHead(checkpointPath);
    assert.equal(fenced.value.hookDeactivationProtocol.state, "deactivation-fenced");
    assert.equal((await readBuilderLifecycleState({ projectRoot })).status, "deactivated");

    const reactivate = await planBuilderReactivate({
      projectRoot,
      expectedReceiptDigest: installed.receipt.digest,
    });
    await applyBuilderReactivate({
      projectRoot,
      expectedReceiptDigest: installed.receipt.digest,
      expectedPlanDigest: reactivate.planDigest,
    });
    const released = await loadBuilderCheckpointHead(checkpointPath);
    assert.equal(released.value.hookDeactivationProtocol.state, "open");
  });

  it("exposes deactivate/reactivate, rejects purge and selector removal, and hides uninstall from help", async () => {
    const help = await execFileAsync(process.execPath, ["bin/agentmo.js", "--help"], { cwd: REPO_ROOT });
    assert.match(help.stdout, /builder deactivate/u);
    assert.match(help.stdout, /builder reactivate/u);
    assert.match(help.stdout, /builder recover upgrade/u);
    assert.doesNotMatch(help.stdout, /builder uninstall/u);
    assert.doesNotMatch(help.stdout, /remove-host-selector/u);

    await assert.rejects(
      execFileAsync(process.execPath, ["bin/agentmo.js", "builder", "purge", "--project", REPO_ROOT], { cwd: REPO_ROOT }),
      (error) => error.code !== 0 && /UNKNOWN_BUILDER_ACTION/u.test(error.stderr),
    );
    await assert.rejects(
      execFileAsync(process.execPath, ["bin/agentmo.js", "builder", "uninstall", "--remove-host-selector", "--project", REPO_ROOT], { cwd: REPO_ROOT }),
      (error) => error.code !== 0 && /PHYSICAL_REMOVAL_UNSUPPORTED/u.test(error.stderr),
    );
  });
});
