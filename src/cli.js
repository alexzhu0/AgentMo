import { dirname, isAbsolute, relative, resolve, win32 } from "node:path";
import { readFile } from "node:fs/promises";
import {
  ArtifactAdmissionError,
  digestRawBytes,
  loadAdmittedArtifact,
  parseDigestBindings,
} from "./artifact-admission.js";
import {
  formatArtifactContract,
  getArtifactContract,
  listArtifactContractSubjects,
} from "./artifact-contract.js";
import { formatMigrationPlan } from "./artifact-migration.js";
import { subjectsForCommand } from "./artifact-subjects.js";
import {
  applyArtifactMigration,
  planArtifactMigration,
} from "./migration-filesystem.js";
import { buildBirthReport, formatBirthReport } from "./birth-report.js";
import {
  checkpointSummaryAdmission,
  loadBuilderCheckpoint,
  writeBuilderCheckpoint,
} from "./builder-checkpoint.js";
import {
  armCodexUatScenario,
  loadCodexUatAttemptJournal,
  loadCodexUatObservationLeaf,
  recordCodexUatActivationApplied,
  recordCodexUatScenarioObservation,
  recordCodexUatSetupApplied,
  recordCodexUatTrustAuthObservation,
  resumeCodexUatAttempt,
  startCodexUatAttempt,
  terminateCodexUatAttempt,
} from "./builder-codex-uat.js";
import { continueCodexUatAfterDeactivation } from "./builder-codex-uat-continuation.js";
import { runBuilderBehaviorEvaluation } from "./builder-behavior-eval.js";
import { diagnoseBuilderInstall } from "./builder-doctor.js";
import { buildBuilderEntry } from "./builder-entry.js";
import { buildBuilderEvent, loadBuilderEvent, reduceBuilderEvent, reduceBuilderHookEvent } from "./builder-events.js";
import {
  DEFAULT_MAX_BUILDER_HOOK_INPUT_BYTES,
  deliverInstalledBuilderHook,
} from "./builder-hook-bridge.js";
import {
  applyBuilderInstall,
  applyBuilderInstallRecovery,
  inspectBuilderInstallRecovery,
  planBuilderInstall,
  planBuilderInstallRecovery,
} from "./builder-install.js";
import { readBoundedNoFollowFile } from "./builder-package.js";
import { assertBuilderPlatform } from "./builder-platform.js";
import {
  applyBuilderDeactivate,
  applyBuilderHostProjectionMigration,
  applyBuilderHostProjectionTransfer,
  applyBuilderHostSelectorRemoval,
  applyBuilderReactivate,
  applyBuilderUninstall,
  applyBuilderUpgrade,
  abortBuilderUpgradeReservation,
  planBuilderHostProjectionMigration,
  planBuilderHostProjectionTransfer,
  planBuilderHostSelectorRemoval,
  planBuilderDeactivate,
  planBuilderReactivate,
  planBuilderUninstall,
  planBuilderUpgrade,
} from "./builder-lifecycle.js";
import { probeBuilderAdapter } from "./builder-probe.js";
import { loadAdmittedBlueprint, validateBlueprint } from "./blueprint.js";
import { buildBlueprintDraftReport, draftBlueprint, formatBlueprintDraftReport, writeBlueprintDraft } from "./blueprint-draft.js";
import { buildDeliveryReport, formatDeliveryReport } from "./delivery-report.js";
import { buildDesignPlan, buildDesignPlanReport, formatDesignPlanReport, writeDesignPlan } from "./design-plan.js";
import { buildDiscoveryPack, formatDiscoveryPack, writeDiscoveryPack } from "./discovery-db.js";
import { buildDiscoveryWorkspace, formatDiscoveryWorkspace, writeDiscoveryWorkspace } from "./discovery-source-workspace.js";
import { buildDiscoveryReport, formatDiscoveryReport, loadDiscoveryManifest } from "./discovery.js";
import { buildDomainEval, formatDomainEval } from "./domain-eval.js";
import { buildHandoffPackage, formatHandoffPackage, writeHandoffPackage } from "./handoff.js";
import { buildAgentMoReport, formatAgentMoReport } from "./report.js";
import { buildPlan } from "./build-plan.js";
import { buildRuntimePlan } from "./runtime-plan.js";
import { assertCurrentOpenClawTargetRuntime } from "./runtime-compatibility.js";
import {
  buildRunEvalVerified,
  buildRunReport,
  executeRuntimeRun,
  loadRunState,
  replayRunState,
  resolveLatestRunStateFromDir,
} from "./run-state.js";
import { buildRunObservation, writeRunObservation } from "./run-observation.js";
import {
  buildControlSnapshot,
  formatControlSnapshot,
  loadBuildState,
} from "./control-snapshot.js";
import { buildObservationReport, formatObservationReport, loadObservationRecord } from "./observation.js";
import { scaffoldAgent } from "./scaffold.js";
import { emitPersistableOutput, serializePersistableJson } from "./persistability.js";
import { REDACTED_PATH, redactHostAbsolutePaths } from "./secret-redaction.js";
import { listTargetIds } from "./targets/registry.js";
import { buildUserNeedReport, formatUserNeedReport, loadUserNeed } from "./user-need.js";

export const CLI_OUTPUT_OWNERS = Object.freeze({
  help: "non-artifact",
  "artifact-contract": "non-artifact",
  builder: "non-artifact",
  migrate: "artifact",
  "runtime-check": "non-artifact",
  validate: "non-artifact",
  report: "artifact",
  "discover-report": "artifact",
  "discover-pack": "artifact",
  "discover-workspace": "artifact",
  "need-report": "artifact",
  "design-plan": "artifact",
  "blueprint-draft": "artifact",
  handoff: "artifact",
  status: "artifact",
  plan: "artifact",
  "run-plan": "artifact",
  run: "artifact",
  "run-report": "artifact",
  "replay-run": "artifact",
  "run-eval": "artifact",
  "birth-report": "artifact",
  "domain-eval": "artifact",
  "delivery-report": "artifact",
  "observe-run": "artifact",
  scaffold: "non-artifact",
  observe: "artifact",
});

const CLI_VALUE_OPTIONS = new Set([
  "--agent", "--birth-report", "--build-state", "--cases", "--channel", "--checkpoint", "--design-plan", "--digest",
  "--discovery-manifest", "--domain-eval", "--runtime-env-file", "--expect-status", "--fallback-from", "--message",
  "--event", "--event-id", "--host", "--host-scope", "--message-file", "--model", "--need", "--openclaw-source-root", "--openclaw-state-dir", "--out",
  "--plan-digest", "--project", "--provider", "--run-dir", "--run-eval", "--run-state", "--session-id", "--session-key", "--source-root",
  "--consumer", "--receipt-digest", "--target", "--thinking", "--timeout-ms", "--to", "--transport", "--workspace",
  "--attempt-id", "--code", "--evidence-sha256", "--expected-head-sha256", "--journal", "--observation", "--request",
  "--uat", "--uat-baseline-package", "--uat-baseline-tarball", "--uat-candidate", "--uat-journal",
  "--uat-successor-package", "--uat-successor-tarball",
]);

export async function main(args) {
  const internalBuilderHook = Array.isArray(args) && args[0] === "__builder-hook";
  try {
    return await runCommand(args);
  } catch (error) {
    if (internalBuilderHook) {
      process.exitCode = 1;
      return;
    }
    await emitCliError(error, { json: requestedJsonMode(args) });
    process.exitCode = 1;
  }
}

async function runCommand(args) {
  const [command, ...rest] = args;
  if (command === "__builder-hook") {
    assertBuilderCliPlatform();
    if (rest.length !== 0) throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
    const runnerDigest = process.env.AGENTMO_BUILDER_HOOK_RUNNER_DIGEST;
    const bytes = await readInternalBuilderHookInput();
    let hookInput;
    try {
      hookInput = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
    }
    const result = await deliverInstalledBuilderHook({ hookInput, runnerDigest });
    await emitNonArtifactOutput(result, {
      json: true,
      subject: "builder-hook-bridge-result",
      format: () => "",
    });
    return;
  }
  const subcommandHelpTarget = command === "help" && rest.length === 1
    ? rest[0]
    : rest.length === 1 && ["--help", "-h"].includes(rest[0])
      ? command
      : null;
  if (subcommandHelpTarget !== null) {
    const text = commandHelpText(subcommandHelpTarget);
    if (text === null) throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
    await emitNonArtifactOutput({
      schemaVersion: "agentmo.cli-text.v1",
      kind: "help",
      text,
    }, {
      json: false,
      subject: "cli-help",
      format: (value) => value.text,
    });
    return;
  }
  if (!command || (command === "help" && rest.length === 0) || command === "--help" || command === "-h") {
    await emitNonArtifactOutput({
      schemaVersion: "agentmo.cli-text.v1",
      kind: "help",
      text: helpText(),
    }, {
      json: false,
      subject: "cli-help",
      format: (value) => value.text,
    });
    return;
  }

  if (command === "artifact-contract") {
    const options = parseArtifactContractArgs(rest);
    const contract = getArtifactContract(options.subject);
    if (contract === null) throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
    await emitNonArtifactOutput(contract, {
      json: options.json,
      subject: "artifact-contract",
      format: formatArtifactContract,
    });
    return;
  }

  if (command === "builder") {
    assertBuilderCliPlatform();
    const options = parseBuilderArgs(rest);
    if (options.action === "codex-uat") {
      const output = await executeCodexUatCommand(options);
      await emitNonArtifactOutput(output, {
        json: options.json,
        subject: "builder-codex-uat-command",
        format: formatCodexUatCliOutput,
      });
      return;
    }
    if (["behavior", "behavior-eval"].includes(options.action)) {
      const report = await runBuilderBehaviorEvaluation({
        projectRoot: options.projectRoot,
        expectedReceiptDigest: options.receiptDigest,
        ...(options.uatJournalPath === null
          ? {}
          : {
              uatJournalPath: options.uatJournalPath,
              expectedUatHeadDigest: options.uatHeadDigest,
              uatCandidatePath: options.uatCandidatePath,
              expectedUatCandidateDigest: options.uatCandidateDigest,
              uatBaselinePackageRoot: options.uatBaselinePackageRoot,
              uatBaselineTarballPath: options.uatBaselineTarballPath,
              uatSuccessorPackageRoot: options.uatSuccessorPackageRoot,
              uatSuccessorTarballPath: options.uatSuccessorTarballPath,
            }),
      });
      await emitNonArtifactOutput(report, {
        json: options.json,
        subject: "builder-behavior-eval",
        format: formatBuilderBehaviorEval,
      });
      return;
    }
    if (["host-migrate", "host-transfer"].includes(options.action)) {
      const authority = {
        hostScope: options.hostScope,
        expectedOwnerRecordDigest: options.ownerRecordDigest,
        expectedConsumerLedgerDigest: options.consumerLedgerDigest,
        consumers: options.consumers,
        ...(options.action === "host-migrate"
          ? { probe: await probeBuilderAdapter({ adapterId: options.host }) }
          : { target: options.target }),
      };
      const result = options.apply
        ? options.action === "host-migrate"
          ? await applyBuilderHostProjectionMigration({
              ...authority,
              expectedPlanDigest: options.planDigest,
            })
          : await applyBuilderHostProjectionTransfer({
              ...authority,
              expectedPlanDigest: options.planDigest,
            })
        : options.action === "host-migrate"
          ? await planBuilderHostProjectionMigration(authority)
          : await planBuilderHostProjectionTransfer(authority);
      await emitNonArtifactOutput(result, {
        json: options.json,
        subject: options.apply
          ? `builder-${options.action}-result`
          : `builder-${options.action}-plan`,
        format: formatBuilderHostProjectionOperation,
      });
      return;
    }
    if (options.action === "recover") {
      const result = options.recoveryAction === "inspect"
        ? await inspectBuilderInstallRecovery({ projectRoot: options.projectRoot })
        : options.recoveryAction === "preview"
          ? await planBuilderInstallRecovery({ projectRoot: options.projectRoot })
          : await applyBuilderInstallRecovery({
              projectRoot: options.projectRoot,
              expectedPlanDigest: options.planDigest,
            });
      await emitNonArtifactOutput(result, {
        json: options.json,
        subject: `builder-install-recovery-${options.recoveryAction}`,
        format: formatBuilderInstallRecovery,
      });
      return;
    }
    if (options.action === "recover-upgrade") {
      const result = await abortBuilderUpgradeReservation({
        projectRoot: options.projectRoot,
        expectedReceiptDigest: options.receiptDigest,
        expectedPlanDigest: options.planDigest,
      });
      await emitNonArtifactOutput(result, {
        json: options.json,
        subject: "builder-lifecycle-upgrade-recovery",
        format: formatBuilderLifecycleResult,
      });
      return;
    }
    if (options.action === "setup") {
      const probe = await probeBuilderAdapter({ adapterId: options.host });
      const result = options.apply
        ? await applyBuilderInstall({
            projectRoot: options.projectRoot,
            probe,
            expectedPlanDigest: options.planDigest,
            ...(options.hostScope === null ? {} : { hostScope: options.hostScope }),
            ...(options.receiptDigest === null
              ? {}
              : { expectedPriorReceiptDigest: options.receiptDigest }),
          })
        : await planBuilderInstall({
            projectRoot: options.projectRoot,
            probe,
            ...(options.hostScope === null ? {} : { hostScope: options.hostScope }),
            ...(options.receiptDigest === null
              ? {}
              : { expectedPriorReceiptDigest: options.receiptDigest }),
          });
      await emitNonArtifactOutput(result, {
        json: options.json,
        subject: options.apply ? "builder-install-result" : "builder-install-plan",
        format: options.apply ? formatBuilderInstallResult : formatBuilderInstallPlan,
      });
      return;
    }
    if (["upgrade", "deactivate", "reactivate", "uninstall"].includes(options.action)) {
      const lifecycleOptions = {
        projectRoot: options.projectRoot,
        expectedReceiptDigest: options.receiptDigest,
        ...(options.action === "upgrade"
          ? { probe: await probeBuilderAdapter({ adapterId: options.host }) }
          : {}),
      };
      const previewByAction = {
        upgrade: planBuilderUpgrade,
        deactivate: planBuilderDeactivate,
        reactivate: planBuilderReactivate,
        uninstall: planBuilderUninstall,
      };
      const applyByAction = {
        upgrade: applyBuilderUpgrade,
        deactivate: applyBuilderDeactivate,
        reactivate: applyBuilderReactivate,
        uninstall: applyBuilderUninstall,
      };
      const result = options.apply
        ? await applyByAction[options.action]({
            ...lifecycleOptions,
            expectedPlanDigest: options.planDigest,
          })
        : await previewByAction[options.action](lifecycleOptions);
      await emitNonArtifactOutput(result, {
        json: options.json,
        subject: options.apply ? "builder-lifecycle-result" : "builder-lifecycle-plan",
        format: options.apply ? formatBuilderLifecycleResult : formatBuilderLifecyclePlan,
      });
      return;
    }
    if (options.action === "doctor") {
      const probe = await probeBuilderAdapter({ adapterId: options.host });
      const report = await diagnoseBuilderInstall({
        projectRoot: options.projectRoot,
        probe,
        observeHost: true,
      });
      await emitNonArtifactOutput(report, {
        json: options.json,
        subject: "builder-doctor",
        format: formatBuilderDoctor,
      });
      if (!["declared", "active", "activation-pending-trust"].includes(report.status)) {
        process.exitCode = 1;
      }
      return;
    }
    if (options.action === "probe") {
      const probe = await probeBuilderAdapter({ adapterId: options.host });
      await emitNonArtifactOutput(probe, {
        json: options.json,
        subject: "builder-probe",
        format: formatBuilderProbe,
      });
      return;
    }
    if (options.action === "hook" || options.action === "pause") {
      const checkpointAdmission = await loadBuilderCheckpoint(options.checkpointPath, {
        expectedDigest: options.digests["builder-checkpoint"],
      });
      const event = options.action === "hook"
        ? await loadBuilderEvent(options.eventPath, {
            expectedDigest: options.digests["builder-event"],
          })
        : buildBuilderEvent({
            workflowId: checkpointAdmission.value.workflowId,
            adapterId: checkpointAdmission.value.adapterId,
            eventId: options.eventId,
            sequence: checkpointAdmission.value.eventLedger.cursor + 1,
            origin: "user",
            type: "ManualPause",
            data: { reason: "user-request" },
          });
      const result = options.action === "hook"
        ? reduceBuilderHookEvent(checkpointAdmission.value, event)
        : reduceBuilderEvent(checkpointAdmission.value, event);
      const written = await writeBuilderCheckpoint(options.outPath, result.checkpoint, {
        expectedPreviousDigest: options.outPath === options.checkpointPath
          ? checkpointAdmission.digest
          : null,
      });
      const output = buildBuilderEventOutput(result, written.digest, options.action);
      await emitNonArtifactOutput(output, {
        json: options.json,
        subject: "builder-event-output",
        format: formatBuilderEventOutput,
      });
      return;
    }
    const checkpointAdmission = options.checkpointPath
      ? await loadBuilderCheckpoint(options.checkpointPath, {
          expectedDigest: options.digests["builder-checkpoint"],
        })
      : null;
    const probe = await probeBuilderAdapter({ adapterId: options.host });
    const entry = buildBuilderEntry({
      probe,
      requestedStage: ["start", "resume"].includes(options.action) ? null : options.action,
      ...(checkpointAdmission ? { checkpoint: checkpointSummaryAdmission(checkpointAdmission) } : {}),
    });
    await emitNonArtifactOutput(entry, {
      json: options.json,
      subject: "builder-entry",
      format: formatBuilderEntry,
    });
    return;
  }

  if (command === "migrate") {
    const options = parseMigrateArgs(rest);
    const plan = await planArtifactMigration(options.inputs, { digests: options.digests });
    if (options.out) {
      const result = await applyArtifactMigration({
        inputs: options.inputs,
        out: options.out,
        plan,
        digests: options.digests,
      });
      const output = migrationApplyOutput(result);
      await emitArtifactOutput(output, {
        json: options.json,
        subject: "migration-apply-result",
        format: formatMigrationApplyResult,
      });
      return;
    }
    await emitArtifactOutput(plan, {
      json: options.json,
      subject: "migration-plan",
      format: formatMigrationPlan,
    });
    if (!plan.applicable) process.exitCode = 1;
    return;
  }

  if (command === "runtime-check") {
    const options = parseRuntimeCheckArgs(rest);
    const observation = assertCurrentOpenClawTargetRuntime();
    await emitNonArtifactOutput(observation, {
      json: options.json,
      subject: "runtime-check",
      format: formatRuntimeCheck,
    });
    return;
  }

  if (command === "validate") {
    const { file, json, digests } = parseAdmittedBlueprintArg(rest, "validate");
    const blueprintAdmission = await loadAdmittedBlueprint(file, {
      subject: "blueprint",
      expectedDigest: digests.blueprint,
    });
    const blueprint = blueprintAdmission.value;
    const result = validateBlueprint(blueprint);
    if (!result.ok) {
      throw cliError("AGENTMO_BLUEPRINT_VALIDATION_REJECTED");
    }
    const output = {
      schemaVersion: "agentmo.blueprint-validation-result.v1",
      ok: true,
      warningCount: result.warnings.length,
      warnings: [...result.warnings],
    };
    await emitNonArtifactOutput(output, {
      json,
      subject: "blueprint-validation-output",
      format: formatBlueprintValidationResult,
    });
    return;
  }

  if (command === "report") {
    const options = parseReportArgs(rest);
    const blueprintAdmission = await loadAdmittedBlueprint(options.file, {
      subject: "blueprint",
      expectedDigest: options.digests.blueprint,
    });
    const discoveryManifestAdmission = options.discoveryManifestPath
      ? await loadAdmittedArtifact({
          filePath: options.discoveryManifestPath,
          subject: "discovery-manifest",
          expectedDigest: options.digests["discovery-manifest"],
        })
      : null;
    const report = await buildAgentMoReport(blueprintAdmission.value, {
      discoveryManifest: discoveryManifestAdmission?.value ?? null,
      admissions: {
        blueprint: blueprintAdmission,
        ...(discoveryManifestAdmission ? { discoveryManifest: discoveryManifestAdmission } : {}),
      },
    });
    await emitArtifactOutput(report, { json: options.json, subject: "report", format: formatAgentMoReport });
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (command === "discover-report") {
    const { file, json, digests } = parseDiscoverReportArgs(rest);
    const manifest = await loadDiscoveryManifest(file, {
      subject: "discovery-manifest",
      expectedDigest: digests["discovery-manifest"],
    });
    const report = buildDiscoveryReport(manifest);
    await emitArtifactOutput(report, { json, subject: "discovery-report", format: formatDiscoveryReport });
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (command === "discover-pack") {
    const options = parseDiscoverPackArgs(rest);
    const manifest = await loadDiscoveryManifest(options.file, {
      subject: "discovery-manifest",
      expectedDigest: options.digests["discovery-manifest"],
    });
    const pack = buildDiscoveryPack(manifest, { manifestPath: options.file });
    const paths = await writeDiscoveryPack(options.out, pack);
    const result = { ...pack, paths };
    await emitArtifactOutput(result, {
      json: options.json,
      subject: "discovery-pack-output",
      format: (value) => formatDiscoveryPack(value, value.paths),
    });
    if (!pack.ok) process.exitCode = 1;
    return;
  }

  if (command === "discover-workspace") {
    const options = parseDiscoverWorkspaceArgs(rest);
    const manifest = await loadDiscoveryManifest(options.file, {
      subject: "discovery-manifest",
      expectedDigest: options.digests["discovery-manifest"],
    });
    const workspace = await buildDiscoveryWorkspace(manifest, {
      manifestPath: options.file,
      sourceRoot: options.sourceRoot,
    });
    const paths = await writeDiscoveryWorkspace(options.out, workspace);
    const result = { ...workspace, paths };
    await emitArtifactOutput(result, {
      json: options.json,
      subject: "discovery-workspace-output",
      format: (value) => formatDiscoveryWorkspace(value, value.paths),
    });
    if (!workspace.ok) process.exitCode = 1;
    return;
  }

  if (command === "need-report") {
    const options = parseNeedReportArgs(rest);
    const need = await loadUserNeed(options.file, {
      subject: "user-need",
      expectedDigest: options.digests["user-need"],
    });
    const report = buildUserNeedReport(need);
    await emitArtifactOutput(report, { json: options.json, subject: "user-need-report", format: formatUserNeedReport });
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (command === "design-plan") {
    const options = parseDesignPlanArgs(rest);
    const discoveryDbAdmission = await loadAdmittedArtifact({
      filePath: options.file,
      subject: "discovery-db",
      expectedDigest: options.digests["discovery-db"],
    });
    const userNeedAdmission = await loadAdmittedArtifact({
      filePath: options.need,
      subject: "user-need",
      expectedDigest: options.digests["user-need"],
    });
    const designPlan = buildDesignPlan(discoveryDbAdmission.value, userNeedAdmission.value, {
      target: options.target,
      admissions: {
        discoveryDb: discoveryDbAdmission,
        userNeed: userNeedAdmission,
      },
    });
    await writeDesignPlan(options.out, designPlan);
    const report = buildDesignPlanReport(designPlan, { designPlanPath: options.out });
    const result = { report, designPlan, designPlanPath: report.designPlanPath };
    await emitArtifactOutput(result, {
      json: options.json,
      subject: "design-plan-output",
      format: (value) => formatDesignPlanReport(value.report),
    });
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (command === "blueprint-draft") {
    const options = parseBlueprintDraftArgs(rest);
    const discoveryDbAdmission = await loadAdmittedArtifact({
      filePath: options.file,
      subject: "discovery-db",
      expectedDigest: options.digests["discovery-db"],
    });
    const userNeedAdmission = await loadAdmittedArtifact({
      filePath: options.need,
      subject: "user-need",
      expectedDigest: options.digests["user-need"],
    });
    const designPlanAdmission = options.designPlan
      ? await loadAdmittedArtifact({
          filePath: options.designPlan,
          subject: "design-plan",
          expectedDigest: options.digests["design-plan"],
        })
      : null;
    const blueprint = draftBlueprint(discoveryDbAdmission.value, userNeedAdmission.value, {
      target: options.target,
      designPlan: designPlanAdmission?.value ?? null,
      admissions: {
        discoveryDb: discoveryDbAdmission,
        userNeed: userNeedAdmission,
        ...(designPlanAdmission ? { designPlan: designPlanAdmission } : {}),
      },
    });
    await writeBlueprintDraft(options.out, blueprint);
    const report = buildBlueprintDraftReport(blueprint, { blueprintPath: options.out });
    const result = { report, blueprint, blueprintPath: report.blueprintPath };
    await emitArtifactOutput(result, {
      json: options.json,
      subject: "blueprint-draft-output",
      format: (value) => formatBlueprintDraftReport(value.report),
    });
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (command === "handoff") {
    const options = parseHandoffArgs(rest);
    const blueprintAdmission = await loadAdmittedBlueprint(options.file, {
      subject: "blueprint",
      expectedDigest: options.digests.blueprint,
    });
    const handoffPackage = await buildHandoffPackage(blueprintAdmission.value, {
      target: options.target,
      admission: blueprintAdmission,
    });
    await writeHandoffPackage(options.out, handoffPackage);
    const paths = {
      outDir: ".",
      files: handoffPackage.files.map((file) => file.relativePath),
    };
    const result = { ...handoffPackage, paths };
    await emitArtifactOutput(result, {
      json: options.json,
      subject: "handoff-output",
      format: (value) => formatHandoffPackage(value, value.paths),
    });
    if (!handoffPackage.ok) process.exitCode = 1;
    return;
  }

  if (command === "status") {
    const options = parseStatusArgs(rest);
    const blueprintAdmission = await loadAdmittedBlueprint(options.file, {
      subject: "blueprint",
      expectedDigest: options.digests.blueprint,
    });
    const blueprint = blueprintAdmission.value;
    const buildStateOptions = await loadOptionalBuildState(
      options.buildStatePath,
      options.digests["build-state"],
      blueprintAdmission,
    );
    const runStateOptions = await loadOptionalRunState(
      options.runStatePath,
      options.runDir,
      options.digests,
    );
    const snapshot = safeControlSnapshot(buildControlSnapshot(blueprint, {
      blueprintAdmission,
      ...buildStateOptions,
      ...runStateOptions,
    }));
    await emitArtifactOutput(snapshot, {
      json: options.json,
      subject: "control-snapshot",
      format: formatControlSnapshot,
    });
    if (!snapshot.validation.ok) process.exitCode = 1;
    return;
  }

  if (command === "plan") {
    const options = parsePlanArgs(rest);
    const blueprintAdmission = await loadAdmittedBlueprint(options.file, {
      subject: "blueprint",
      expectedDigest: options.digests.blueprint,
    });
    const blueprint = blueprintAdmission.value;
    const plan = safeBuildPlanOutput(buildPlan(blueprint, { target: options.target }));
    await emitArtifactOutput(plan, { json: options.json, subject: "build-plan", format: formatBuildPlan });
    return;
  }

  if (command === "run-plan") {
    const options = await parseRunPlanArgs(rest);
    const blueprintAdmission = await loadAdmittedBlueprint(options.file, {
      subject: "blueprint",
      expectedDigest: options.digests.blueprint,
    });
    const plan = await buildRuntimePlan(blueprintAdmission.value, {
      ...options,
      admission: blueprintAdmission,
    });
    await emitArtifactOutput(plan, { json: options.json, subject: "runtime-plan", format: formatRuntimePlan });
    return;
  }

  if (command === "run") {
    const syntaxOptions = parseRunSyntaxArgs(rest);
    if (syntaxOptions.live) assertCurrentOpenClawTargetRuntime();
    const options = await materializeRunOptions(syntaxOptions);
    const runtimePlanAdmission = await loadAdmittedArtifact({
      filePath: options.file,
      subject: "runtime-plan",
      expectedDigest: options.digests["runtime-plan"],
    });
    const result = await executeRuntimeRun(runtimePlanAdmission.value, {
      ...options,
      admission: runtimePlanAdmission,
    });
    await emitArtifactOutput(result.runState, {
      json: options.json,
      subject: "run-state",
      format: (value) => formatRunState(value, { written: result.stateFile !== null }),
    });
    return;
  }

  if (command === "run-report") {
    const { file, json, digests } = parseRunStateFileArg(rest, "run-report");
    const runStateAdmission = await loadRunState(file, {
      subject: "run-state",
      expectedDigest: digests["run-state"],
      returnAdmission: true,
    });
    const runState = runStateAdmission.value;
    const report = buildRunReport(runState);
    await emitArtifactOutput(report, { json, subject: "run-report", format: formatRunReport });
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (command === "replay-run") {
    const syntaxOptions = parseReplayRunSyntaxArgs(rest);
    if (syntaxOptions.live) assertCurrentOpenClawTargetRuntime();
    const options = await materializeReplayRunOptions(syntaxOptions);
    const runStateAdmission = await loadRunState(options.file, {
      subject: "run-state",
      expectedDigest: options.digests["run-state"],
      returnAdmission: true,
    });
    const result = await replayRunState(runStateAdmission.value, {
      ...options,
      admission: runStateAdmission,
    });
    await emitArtifactOutput(result.runState, {
      json: options.json,
      subject: "run-state",
      format: (value) => formatRunState(value, { written: result.stateFile !== null }),
    });
    return;
  }

  if (command === "run-eval") {
    const options = await parseRunEvalArgs(rest);
    const runStateAdmission = await loadRunState(options.file, {
      subject: "run-state",
      expectedDigest: options.digests["run-state"],
      returnAdmission: true,
    });
    const report = await buildRunEvalVerified(runStateAdmission.value, {
      expectStatus: options.expectStatus,
      requireExactReplay: options.requireExactReplay,
      message: options.message,
      messageBytes: options.messageBytes,
      messageFileContent: options.messageFileContent,
      admission: runStateAdmission,
    });
    await emitArtifactOutput(report, { json: options.json, subject: "run-eval", format: formatRunEval });
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (command === "birth-report") {
    const options = parseBirthReportArgs(rest);
    const blueprintAdmission = await loadAdmittedBlueprint(options.file, {
      subject: "blueprint",
      expectedDigest: options.digests.blueprint,
    });
    const buildStateAdmission = await loadAdmittedArtifact({
      filePath: options.buildStatePath,
      subject: "build-state",
      expectedDigest: options.digests["build-state"],
    });
    const runStateAdmission = await loadAdmittedArtifact({
      filePath: options.runStatePath,
      subject: "run-state",
      expectedDigest: options.digests["run-state"],
    });
    const runEvalAdmission = await loadAdmittedArtifact({
      filePath: options.runEvalPath,
      subject: "run-eval",
      expectedDigest: options.digests["run-eval"],
      companions: { "run-state": runStateAdmission },
    });
    const report = await buildBirthReport(blueprintAdmission.value, {
      buildState: buildStateAdmission.value,
      runState: runStateAdmission.value,
      runEval: runEvalAdmission.value,
      expectStatus: options.expectStatus,
      admissions: {
        blueprint: blueprintAdmission,
        buildState: buildStateAdmission,
        runState: runStateAdmission,
        runEval: runEvalAdmission,
      },
    });
    await emitArtifactOutput(report, { json: options.json, subject: "birth-report", format: formatBirthReport });
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (command === "domain-eval") {
    const options = parseDomainEvalArgs(rest);
    const blueprintAdmission = await loadAdmittedBlueprint(options.file, {
      subject: "blueprint",
      expectedDigest: options.digests.blueprint,
    });
    const domainCasesAdmission = await loadAdmittedArtifact({
      filePath: options.casesPath,
      subject: "domain-cases",
      expectedDigest: options.digests["domain-cases"],
    });
    const report = await buildDomainEval(blueprintAdmission.value, domainCasesAdmission.value, {
      target: options.target,
      admissions: {
        blueprint: blueprintAdmission,
        domainCases: domainCasesAdmission,
      },
    });
    await emitArtifactOutput(report, { json: options.json, subject: "domain-eval", format: formatDomainEval });
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (command === "delivery-report") {
    const options = parseDeliveryReportArgs(rest);
    const blueprintAdmission = await loadAdmittedBlueprint(options.file, {
      subject: "blueprint",
      expectedDigest: options.digests.blueprint,
    });
    const buildStateAdmission = await loadAdmittedArtifact({
      filePath: options.buildStatePath,
      subject: "build-state",
      expectedDigest: options.digests["build-state"],
    });
    const runStateAdmission = await loadAdmittedArtifact({
      filePath: options.runStatePath,
      subject: "run-state",
      expectedDigest: options.digests["run-state"],
    });
    const runEvalAdmission = await loadAdmittedArtifact({
      filePath: options.runEvalPath,
      subject: "run-eval",
      expectedDigest: options.digests["run-eval"],
      companions: { "run-state": runStateAdmission },
    });
    const birthReportAdmission = await loadAdmittedArtifact({
      filePath: options.birthReportPath,
      subject: "birth-report",
      expectedDigest: options.digests["birth-report"],
      companions: {
        blueprint: blueprintAdmission,
        "build-state": buildStateAdmission,
        "run-state": runStateAdmission,
        "run-eval": runEvalAdmission,
      },
    });
    const domainEvalAdmission = options.domainEvalPath
      ? await loadAdmittedArtifact({
          filePath: options.domainEvalPath,
          subject: "domain-eval",
          expectedDigest: options.digests["domain-eval"],
        })
      : null;
    const report = await buildDeliveryReport(blueprintAdmission.value, {
      buildState: buildStateAdmission.value,
      runState: runStateAdmission.value,
      runEval: runEvalAdmission.value,
      birthReport: birthReportAdmission.value,
      domainEval: domainEvalAdmission?.value ?? null,
      admissions: {
        blueprint: blueprintAdmission,
        buildState: buildStateAdmission,
        runState: runStateAdmission,
        runEval: runEvalAdmission,
        birthReport: birthReportAdmission,
        ...(domainEvalAdmission ? { domainEval: domainEvalAdmission } : {}),
      },
    });
    await emitArtifactOutput(report, { json: options.json, subject: "delivery-report", format: formatDeliveryReport });
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (command === "observe-run") {
    const options = parseObserveRunArgs(rest);
    const runStateAdmission = await loadRunState(options.file, {
      subject: "run-state",
      expectedDigest: options.digests["run-state"],
      returnAdmission: true,
    });
    const observation = buildRunObservation(runStateAdmission.value, { admission: runStateAdmission });
    const observationFile = await writeRunObservation(options.out, observation);
    const report = buildObservationReport(observation);
    const result = { observationFile: REDACTED_PATH, observation, report };
    await emitArtifactOutput(result, {
      json: options.json,
      subject: "observation-output",
      format: formatRunObservationResult,
    });
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (command === "scaffold") {
    const options = parseScaffoldArgs(rest);
    if (options.target === "openclaw") assertCurrentOpenClawTargetRuntime();
    const blueprintAdmission = await loadAdmittedBlueprint(options.file, {
      subject: "blueprint",
      expectedDigest: options.digests.blueprint,
    });
    const blueprint = blueprintAdmission.value;
    const result = await scaffoldAgent(blueprint, options.out, {
      admission: blueprintAdmission,
      force: options.force,
      target: options.target,
    });
    const progress = {
      schemaVersion: "agentmo.scaffold-progress.v1",
      kind: "scaffold-progress",
      target: result.target,
      fileCount: result.files.length,
      files: [...result.files],
      buildStateRef: "agentmo-build-state.json",
    };
    await emitNonArtifactOutput(progress, {
      json: false,
      subject: "scaffold-progress",
      format: formatScaffoldProgress,
    });
    return;
  }

  if (command === "observe") {
    const options = parseObservationArgs(rest);
    const observationAdmission = await loadObservationRecord(options.file, {
      subject: "observation",
      expectedDigest: options.digests.observation,
      returnAdmission: true,
    });
    const report = buildObservationReport(observationAdmission.value);
    await emitArtifactOutput(report, { json: options.json, subject: "observation-report", format: formatObservationReport });
    if (!report.ok) process.exitCode = 1;
    return;
  }

  throw new Error(`Unknown command: ${command}\n\n${helpText()}`);
}

async function readInternalBuilderHookInput() {
  const chunks = [];
  let total = 0;
  for await (const rawChunk of process.stdin) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    total += chunk.byteLength;
    if (total > DEFAULT_MAX_BUILDER_HOOK_INPUT_BYTES) {
      throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

async function executeCodexUatCommand(options) {
  if (options.uatAction === "continue") {
    return continueCodexUatAfterDeactivation(options.continuation);
  }
  if (options.uatAction === "inspect") {
    return buildCodexUatCliOutput("inspect", await loadCodexUatAttemptJournal(options.journalPath));
  }
  if (options.uatAction === "resume") {
    const resumed = await resumeCodexUatAttempt(options.journalPath, {
      expectedHeadDigest: options.expectedHeadDigest,
    });
    return {
      schemaVersion: "agentmo.codex-uat-command-result.v1",
      action: "resume",
      status: resumed.terminal ? "terminal" : "resumable",
      headDigest: resumed.currentHeadDigest,
      phase: resumed.phase,
      nextAction: resumed.nextAction,
      nextScenario: resumed.nextScenario,
      scenarioCount: null,
      terminal: resumed.terminal,
      checkpointDigest: null,
      correlation: null,
      humanAdmissionRequired: true,
      supportCertified: false,
    };
  }

  const current = await loadCodexUatAttemptJournal(options.journalPath);
  if (options.uatAction !== "start") assertExpectedUatHead(current, options.expectedHeadDigest);
  if (options.uatAction === "scenario-arm") {
    const checkpointAdmission = await loadBuilderCheckpoint(options.checkpointPath, {
      expectedDigest: options.checkpointDigest,
    });
    const armed = await armCodexUatScenario({
      journalPath: options.journalPath,
      expectedHeadAdmission: current.head,
      checkpointPath: options.checkpointPath,
      checkpointAdmission,
    });
    return buildCodexUatCliOutput("scenario-arm", current, {
      checkpointDigest: armed.checkpointAdmission.digest,
      correlation: armed.correlation,
    });
  }
  if (options.uatAction === "terminal") {
    const next = await terminateCodexUatAttempt({
      journalPath: options.journalPath,
      expectedHeadAdmission: current.head,
      kind: options.terminalKind,
      code: options.terminalCode,
      evidencePath: options.evidencePath,
      expectedEvidenceDigest: options.evidenceDigest,
    });
    return buildCodexUatCliOutput("terminal", next);
  }

  const request = await loadCodexUatRecordRequest(options.requestPath, options.requestDigest);
  if (options.uatAction === "start") {
    if (current.head !== null || request.transition !== "attempt-started") {
      throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
    }
    const next = await startCodexUatAttempt({
      journalPath: options.journalPath,
      attemptId: options.attemptId,
      baseline: resolveUatReleaseRefs(options.requestPath, request.details.baseline),
      successor: resolveUatReleaseRefs(options.requestPath, request.details.successor),
    });
    return buildCodexUatCliOutput("start", next);
  }

  const expectedTransition = {
    started: "setup-applied",
    "setup-applied": "activation-applied",
    "activation-applied": "trust-auth-observed",
    "trust-auth-observed": "scenario-observed",
    observing: "scenario-observed",
  }[current.state.phase];
  if (request.transition !== expectedTransition) {
    throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
  }
  let next;
  if (request.transition === "scenario-observed") {
    const [checkpointAdmission, observationAdmission] = await Promise.all([
      loadBuilderCheckpoint(options.checkpointPath, {
        expectedDigest: options.checkpointDigest,
      }),
      loadCodexUatObservationLeaf(options.observationPath, {
        expectedDigest: options.observationDigest,
      }),
    ]);
    next = await recordCodexUatScenarioObservation({
      journalPath: options.journalPath,
      expectedHeadAdmission: current.head,
      checkpointAdmission,
      observationAdmission,
      evidence: request.details,
    });
  } else if (request.transition === "setup-applied") {
    const checkpointAdmission = await loadBuilderCheckpoint(options.checkpointPath, {
      expectedDigest: options.checkpointDigest,
    });
    next = await recordCodexUatSetupApplied({
      journalPath: options.journalPath,
      expectedHeadAdmission: current.head,
      installReceiptPath: resolveUatEvidenceRef(options.requestPath, request.details.installReceiptPath),
      expectedInstallReceiptDigest: request.details.expectedInstallReceiptDigest,
      checkpointAdmission,
    });
  } else if (request.transition === "activation-applied") {
    const checkpointAdmission = await loadBuilderCheckpoint(options.checkpointPath, {
      expectedDigest: options.checkpointDigest,
    });
    next = await recordCodexUatActivationApplied({
      journalPath: options.journalPath,
      expectedHeadAdmission: current.head,
      installReceiptPath: resolveUatEvidenceRef(options.requestPath, request.details.installReceiptPath),
      expectedInstallReceiptDigest: request.details.expectedInstallReceiptDigest,
      checkpointAdmission,
      hostObservationPath: resolveUatEvidenceRef(options.requestPath, request.details.hostObservationPath),
      expectedHostObservationDigest: request.details.expectedHostObservationDigest,
    });
  } else {
    next = await recordCodexUatTrustAuthObservation({
      journalPath: options.journalPath,
      expectedHeadAdmission: current.head,
      freshProcessEvidencePath: resolveUatEvidenceRef(options.requestPath, request.details.freshProcessEvidencePath),
      expectedFreshProcessDigest: request.details.expectedFreshProcessDigest,
      trustObservationPath: resolveUatEvidenceRef(options.requestPath, request.details.trustObservationPath),
      expectedTrustObservationDigest: request.details.expectedTrustObservationDigest,
      authObservationPath: resolveUatEvidenceRef(options.requestPath, request.details.authObservationPath),
      expectedAuthObservationDigest: request.details.expectedAuthObservationDigest,
    });
  }
  return buildCodexUatCliOutput("record", next);
}

function resolveUatReleaseRefs(requestPath, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== 2
    || !Object.hasOwn(value, "packageRoot")
    || !Object.hasOwn(value, "tarballPath")) {
    throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
  }
  return {
    packageRoot: resolveUatEvidenceRef(requestPath, value.packageRoot),
    tarballPath: resolveUatEvidenceRef(requestPath, value.tarballPath),
  };
}

function resolveUatEvidenceRef(requestPath, value) {
  if (typeof value !== "string"
    || value.length === 0
    || value.includes("\0")
    || value.includes("\\")
    || isAbsolute(value)
    || win32.isAbsolute(value)
    || /^[A-Za-z]:/u.test(value)
    || value.split("/").some((segment) => segment === ".." || segment === "." || segment === "")) {
    throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
  }
  const requestDirectory = dirname(requestPath);
  const candidate = resolve(requestDirectory, value);
  const bounded = relative(requestDirectory, candidate);
  if (bounded.length === 0
    || isAbsolute(bounded)
    || bounded === ".."
    || bounded.startsWith(`..${pathSeparator()}`)) {
    throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
  }
  return candidate;
}

function pathSeparator() {
  return process.platform === "win32" ? "\\" : "/";
}

function assertExpectedUatHead(view, expectedHeadDigest) {
  if (view.head === null || view.head.digest !== expectedHeadDigest) {
    const error = cliError("AGENTMO_CODEX_UAT_HEAD_MISMATCH");
    throw error;
  }
}

async function loadCodexUatRecordRequest(filePath, expectedDigest) {
  const bytes = await readBoundedNoFollowFile(filePath);
  if (digestRawBytes(bytes) !== expectedDigest) throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
  }
  if (!value
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.keys(value).length !== 3
    || value.schemaVersion !== "agentmo.codex-uat-record-request.v1"
    || !["attempt-started", "setup-applied", "activation-applied", "trust-auth-observed", "scenario-observed"]
      .includes(value.transition)
    || !value.details
    || typeof value.details !== "object"
    || Array.isArray(value.details)) {
    throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
  }
  const canonical = Buffer.from(serializePersistableJson(value, {
    subject: "builder-codex-uat-record-request",
  }), "utf8");
  if (!bytes.equals(canonical)) throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
  return value;
}

function parseObservationArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing observation file path.");
  let json = false;
  const digestBindings = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--digest") {
      digestBindings.push(requireDigestBinding(args[index + 1]));
      index += 1;
    } else {
      throw new Error(`Unknown observe option: ${arg}`);
    }
  }
  const digests = parseDigestBindings(digestBindings, subjectsForCommand("observe"));
  return { file: resolve(file), json, digests };
}

function parseBuilderArgs(args) {
  const action = args[0] && !args[0].startsWith("--") ? args[0] : "start";
  if (!["probe", "setup", "recover", "upgrade", "deactivate", "reactivate", "uninstall", "doctor", "behavior", "behavior-eval", "codex-uat", "start", "discover", "plan", "produce", "pause", "resume", "hook"].includes(action)) {
    throw cliError("AGENTMO_CLI_UNKNOWN_BUILDER_ACTION");
  }
  if (action === "codex-uat") return parseBuilderCodexUatArgs(args.slice(1));
  if (["behavior", "behavior-eval"].includes(action)) {
    return parseBuilderBehaviorEvalArgs(action, args.slice(1));
  }
  if (["host-migrate", "host-transfer"].includes(action)) {
    return parseBuilderHostProjectionArgs(action, args.slice(1));
  }
  if (action === "recover") return parseBuilderRecoveryArgs(args.slice(1));
  if (["setup", "upgrade", "deactivate", "reactivate", "uninstall", "doctor"].includes(action)) {
    return parseBuilderProjectArgs(action, args.slice(1));
  }
  const optionStart = action === "start" && args[0]?.startsWith("--") ? 0 : args[0] ? 1 : 0;
  let host = null;
  let json = false;
  let checkpointPath = null;
  let eventPath = null;
  let eventId = null;
  let outPath = null;
  const digestBindings = [];
  for (let index = optionStart; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--host" && host === null) {
      const value = args[index + 1];
      if (value !== "codex") throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
      host = value;
      index += 1;
    } else if (arg === "--checkpoint" && checkpointPath === null) {
      checkpointPath = requireBuilderOptionValue(args[index + 1]);
      index += 1;
    } else if (arg === "--event" && eventPath === null) {
      eventPath = requireBuilderOptionValue(args[index + 1]);
      index += 1;
    } else if (arg === "--event-id" && eventId === null) {
      eventId = requireBuilderOptionValue(args[index + 1]);
      index += 1;
    } else if (arg === "--out" && outPath === null) {
      outPath = requireBuilderOptionValue(args[index + 1]);
      index += 1;
    } else if (arg === "--digest") {
      digestBindings.push(requireDigestBinding(args[index + 1]));
      index += 1;
    } else if (arg === "--json" && !json) {
      json = true;
    } else {
      throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
    }
  }
  const checkpointAction = ["resume", "plan", "produce", "pause", "hook"].includes(action);
  const eventAction = action === "hook";
  const mutationAction = ["pause", "hook"].includes(action);
  if (
    (checkpointAction !== (checkpointPath !== null))
    || (eventAction !== (eventPath !== null))
    || (mutationAction !== (outPath !== null))
    || ((action === "pause") !== (eventId !== null))
  ) {
    throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
  }
  const requiredSubjects = [
    ...(checkpointAction ? ["builder-checkpoint"] : []),
    ...(eventAction ? ["builder-event"] : []),
  ];
  const digests = parseDigestBindings(digestBindings, requiredSubjects);
  return {
    action,
    host: host ?? "codex",
    json,
    checkpointPath: checkpointPath === null ? null : resolve(checkpointPath),
    eventPath: eventPath === null ? null : resolve(eventPath),
    eventId,
    outPath: outPath === null ? null : resolve(outPath),
    digests,
  };
}

function parseBuilderRecoveryArgs(args) {
  const recoveryAction = args[0];
  if (recoveryAction === "upgrade") {
    return parseBuilderProjectArgs("recover-upgrade", args.slice(1));
  }
  if (!["inspect", "preview", "apply"].includes(recoveryAction)) {
    throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
  }
  let project = null;
  let planDigest = null;
  let json = false;
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--project" && project === null) {
      project = requireBuilderOptionValue(args[index + 1]);
      index += 1;
    } else if (arg === "--plan-digest" && planDigest === null) {
      planDigest = requireBuilderOptionValue(args[index + 1]);
      index += 1;
    } else if (arg === "--json" && !json) {
      json = true;
    } else {
      throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
    }
  }
  if ((recoveryAction === "apply") !== /^sha256:[a-f0-9]{64}$/u.test(planDigest ?? "")) {
    throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
  }
  return {
    action: "recover",
    recoveryAction,
    projectRoot: resolve(project ?? "."),
    planDigest,
    json,
  };
}

function parseBuilderCodexUatArgs(args) {
  const uatAction = args[0];
  if (!["start", "scenario-arm", "record", "terminal", "inspect", "resume", "continue"].includes(uatAction)) {
    throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
  }
  if (uatAction === "continue") return parseBuilderCodexUatContinuationArgs(args.slice(1));
  const terminalKind = uatAction === "terminal" ? args[1] : null;
  if (uatAction === "terminal" && !["failure", "interruption"].includes(terminalKind)) {
    throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
  }
  let journalPath = null;
  let expectedHeadDigest = null;
  let attemptId = null;
  let requestPath = null;
  let requestDigest = null;
  let checkpointPath = null;
  let checkpointDigest = null;
  let observationPath = null;
  let observationDigest = null;
  let terminalCode = null;
  let evidencePath = null;
  let evidenceDigest = null;
  let json = false;
  for (let index = uatAction === "terminal" ? 2 : 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--journal" && journalPath === null) {
      journalPath = requireBuilderOptionValue(args[index + 1]);
      index += 1;
    } else if (arg === "--expected-head-sha256" && expectedHeadDigest === null) {
      expectedHeadDigest = requireBuilderDigest(args[index + 1]);
      index += 1;
    } else if (arg === "--attempt-id" && attemptId === null) {
      attemptId = requireBuilderOptionValue(args[index + 1]);
      index += 1;
    } else if (arg === "--request" && requestPath === null) {
      requestPath = requireBuilderOptionValue(args[index + 1]);
      index += 1;
    } else if (arg === "--checkpoint" && checkpointPath === null) {
      checkpointPath = requireBuilderOptionValue(args[index + 1]);
      index += 1;
    } else if (arg === "--observation" && observationPath === null) {
      observationPath = requireBuilderOptionValue(args[index + 1]);
      index += 1;
    } else if (arg === "--code" && terminalCode === null) {
      terminalCode = requireBuilderOptionValue(args[index + 1]);
      index += 1;
    } else if (arg === "--evidence" && evidencePath === null) {
      evidencePath = requireBuilderOptionValue(args[index + 1]);
      index += 1;
    } else if (arg === "--evidence-sha256" && evidenceDigest === null) {
      evidenceDigest = requireBuilderDigest(args[index + 1]);
      index += 1;
    } else if (arg === "--digest") {
      const binding = requireBuilderOptionValue(args[index + 1]);
      const match = binding.match(/^(builder-checkpoint|builder-codex-uat-observation|builder-codex-uat-record-request)=(sha256:[a-f0-9]{64})$/u);
      if (!match) throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
      if (match[1] === "builder-codex-uat-record-request" && requestDigest === null) requestDigest = match[2];
      else if (match[1] === "builder-checkpoint" && checkpointDigest === null) checkpointDigest = match[2];
      else if (match[1] === "builder-codex-uat-observation" && observationDigest === null) observationDigest = match[2];
      else throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
      index += 1;
    } else if (arg === "--json" && !json) {
      json = true;
    } else {
      throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
    }
  }
  const hasRequest = requestPath !== null && requestDigest !== null;
  const hasCheckpoint = checkpointPath !== null && checkpointDigest !== null;
  const hasObservation = observationPath !== null && observationDigest !== null;
  const valid = journalPath !== null && (
    (uatAction === "start"
      && attemptId !== null && hasRequest && expectedHeadDigest === null
      && !hasCheckpoint && !hasObservation && terminalCode === null
      && evidencePath === null && evidenceDigest === null)
    || (uatAction === "record"
      && expectedHeadDigest !== null && hasRequest && attemptId === null
      && terminalCode === null && evidencePath === null && evidenceDigest === null)
    || (uatAction === "scenario-arm"
      && expectedHeadDigest !== null && hasCheckpoint && attemptId === null
      && !hasRequest && !hasObservation && terminalCode === null
      && evidencePath === null && evidenceDigest === null)
    || (uatAction === "terminal"
      && expectedHeadDigest !== null && terminalCode !== null
      && evidencePath !== null && evidenceDigest !== null
      && attemptId === null && !hasRequest && !hasCheckpoint && !hasObservation)
    || (uatAction === "inspect"
      && expectedHeadDigest === null && attemptId === null && !hasRequest
      && !hasCheckpoint && !hasObservation && terminalCode === null
      && evidencePath === null && evidenceDigest === null)
    || (uatAction === "resume"
      && expectedHeadDigest !== null && attemptId === null && !hasRequest
      && !hasCheckpoint && !hasObservation && terminalCode === null
      && evidencePath === null && evidenceDigest === null)
  );
  if (!valid
    || (requestPath === null) !== (requestDigest === null)
    || (checkpointPath === null) !== (checkpointDigest === null)
    || (observationPath === null) !== (observationDigest === null)) {
    throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
  }
  return {
    action: "codex-uat",
    uatAction,
    terminalKind,
    journalPath: resolve(journalPath),
    expectedHeadDigest,
    attemptId,
    requestPath: requestPath === null ? null : resolve(requestPath),
    requestDigest,
    checkpointPath: checkpointPath === null ? null : resolve(checkpointPath),
    checkpointDigest,
    observationPath: observationPath === null ? null : resolve(observationPath),
    observationDigest,
    terminalCode,
    evidencePath: evidencePath === null ? null : resolve(evidencePath),
    evidenceDigest,
    json,
  };
}

function parseBuilderCodexUatContinuationArgs(args) {
  const names = new Map([
    ["--attempt-dir", "attemptDir"],
    ["--expected-head-sha256", "expectedHeadDigest"],
    ["--approved-deactivation-plan-sha256", "approvedDeactivationPlanDigest"],
    ["--successor-tarball", "successorTarball"],
    ["--expected-successor-version", "expectedSuccessorVersion"],
    ["--expected-release-sha256", "expectedReleaseDigest"],
    ["--expected-tarball-sha256", "expectedTarballDigest"],
    ["--expected-verifier-sha256", "expectedVerifierDigest"],
  ]);
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = names.get(args[index]);
    if (name === undefined || Object.hasOwn(values, name) || index + 1 >= args.length) {
      throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
    }
    const value = requireBuilderOptionValue(args[index + 1]);
    values[name] = value;
  }
  if (Object.keys(values).length !== names.size
    || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u
      .test(values.expectedSuccessorVersion)
    || [
      values.expectedHeadDigest,
      values.approvedDeactivationPlanDigest,
      values.expectedReleaseDigest,
      values.expectedTarballDigest,
      values.expectedVerifierDigest,
    ].some((value) => !/^sha256:[a-f0-9]{64}$/u.test(value))) {
    throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
  }
  return {
    action: "codex-uat",
    uatAction: "continue",
    json: true,
    continuation: {
      attemptDir: resolve(values.attemptDir),
      expectedHeadDigest: values.expectedHeadDigest,
      approvedDeactivationPlanDigest: values.approvedDeactivationPlanDigest,
      successorTarball: resolve(values.successorTarball),
      expectedSuccessorVersion: values.expectedSuccessorVersion,
      expectedReleaseDigest: values.expectedReleaseDigest,
      expectedTarballDigest: values.expectedTarballDigest,
      expectedVerifierDigest: values.expectedVerifierDigest,
    },
  };
}

function parseBuilderHostProjectionArgs(action, args) {
  let host = null;
  let hostScope = null;
  let target = null;
  let json = false;
  let apply = false;
  let planDigest = null;
  const projects = [];
  const receiptDigests = [];
  const authorityDigests = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--host" && host === null) {
      const value = args[index + 1];
      if (value !== "codex") throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
      host = value;
      index += 1;
    } else if (arg === "--host-scope" && hostScope === null) {
      const value = args[index + 1];
      if (value !== "user") throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
      hostScope = value;
      index += 1;
    } else if (arg === "--target" && target === null) {
      const value = args[index + 1];
      if (action !== "host-transfer" || value !== "stable-agentmo-local") {
        throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
      }
      target = value;
      index += 1;
    } else if (arg === "--consumer") {
      projects.push(resolve(requireBuilderOptionValue(args[index + 1])));
      index += 1;
    } else if (arg === "--receipt-digest") {
      const digest = requireBuilderOptionValue(args[index + 1]);
      if (!/^sha256:[a-f0-9]{64}$/u.test(digest)) throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
      receiptDigests.push(digest);
      index += 1;
    } else if (arg === "--digest") {
      authorityDigests.push(requireBuilderOptionValue(args[index + 1]));
      index += 1;
    } else if (arg === "--plan-digest" && planDigest === null) {
      planDigest = requireBuilderOptionValue(args[index + 1]);
      index += 1;
    } else if (arg === "--apply" && !apply) {
      apply = true;
    } else if (arg === "--json" && !json) {
      json = true;
    } else {
      throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
    }
  }
  let digests;
  try {
    digests = parseDigestBindings(authorityDigests, [
      "codex-selector-owner",
      "codex-consumer-ledger",
    ]);
  } catch {
    throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
  }
  if (hostScope !== "user"
    || projects.length === 0
    || projects.length !== receiptDigests.length
    || (action === "host-transfer") !== (target === "stable-agentmo-local")
    || (apply
      ? !/^sha256:[a-f0-9]{64}$/u.test(planDigest ?? "")
      : planDigest !== null)) {
    throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
  }
  return {
    action,
    host: host ?? "codex",
    hostScope,
    target,
    json,
    apply,
    planDigest,
    ownerRecordDigest: digests["codex-selector-owner"],
    consumerLedgerDigest: digests["codex-consumer-ledger"],
    consumers: projects.map((projectRoot, index) => ({
      projectRoot,
      expectedReceiptDigest: receiptDigests[index],
    })),
  };
}

function parseBuilderProjectArgs(action, args) {
  if (args.includes("--remove-host-selector")) {
    throw cliError("AGENTMO_BUILDER_V1_PHYSICAL_REMOVAL_UNSUPPORTED");
  }
  let host = null;
  let project = null;
  let json = false;
  let apply = false;
  let planDigest = null;
  let hostScope = null;
  const digestBindings = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--host" && host === null) {
      const value = args[index + 1];
      if (value !== "codex") throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
      host = value;
      index += 1;
    } else if (arg === "--project" && project === null) {
      project = requireBuilderOptionValue(args[index + 1]);
      index += 1;
    } else if (arg === "--host-scope" && hostScope === null) {
      const value = args[index + 1];
      if (action !== "setup" || value !== "user") {
        throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
      }
      hostScope = value;
      index += 1;
    } else if (arg === "--remove-host-selector") {
      throw cliError("AGENTMO_BUILDER_V1_PHYSICAL_REMOVAL_UNSUPPORTED");
    } else if (arg === "--plan-digest" && planDigest === null) {
      planDigest = requireBuilderOptionValue(args[index + 1]);
      index += 1;
    } else if (arg === "--digest") {
      digestBindings.push(requireBuilderOptionValue(args[index + 1]));
      index += 1;
    } else if (arg === "--apply" && !apply) {
      apply = true;
    } else if (arg === "--json" && !json) {
      json = true;
    } else {
      throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
    }
  }
  let digests;
  try {
    const requiredSubjects = action === "doctor"
      ? []
      : action === "setup"
        ? digestBindings.length === 0 ? [] : ["builder-install-receipt"]
        : ["builder-install-receipt"];
    digests = parseDigestBindings(digestBindings, requiredSubjects);
  } catch {
    throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
  }
  const receiptDigest = digests["builder-install-receipt"] ?? null;
  const ownerRecordDigest = digests["codex-selector-owner"] ?? null;
  const consumerLedgerDigest = digests["codex-consumer-ledger"] ?? null;
  const digestValid = /^sha256:[a-f0-9]{64}$/u.test(planDigest ?? "");
  if (
    (action === "doctor" && (apply || planDigest !== null || digestBindings.length > 0
      || hostScope !== null))
    || (action === "setup" && (apply ? !digestValid : planDigest !== null))
    || (["upgrade", "deactivate", "reactivate", "uninstall", "recover-upgrade"].includes(action)
      && (receiptDigest === null || hostScope !== null
        || (apply ? !digestValid : planDigest !== null)))
    || (action === "recover-upgrade" && host !== null)
  ) {
    throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
  }
  return {
    action,
    host: host ?? "codex",
    projectRoot: resolve(project ?? "."),
    json,
    apply,
    planDigest,
    receiptDigest,
    hostScope,
    ownerRecordDigest,
    consumerLedgerDigest,
  };
}

function parseBuilderBehaviorEvalArgs(action, args) {
  let project = null;
  let receiptDigest = null;
  let uatJournalPath = null;
  let uatCandidatePath = null;
  let uatHeadDigest = null;
  let uatCandidateDigest = null;
  let uatBaselinePackageRoot = null;
  let uatBaselineTarballPath = null;
  let uatSuccessorPackageRoot = null;
  let uatSuccessorTarballPath = null;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--project" && project === null) {
      project = requireBuilderOptionValue(args[index + 1]);
      index += 1;
    } else if (arg === "--uat") {
      throw cliError("AGENTMO_CLI_BUILDER_UAT_MIGRATION_REQUIRED");
    } else if (arg === "--uat-journal" && uatJournalPath === null) {
      uatJournalPath = requireBuilderOptionValue(args[index + 1]);
      index += 1;
    } else if (arg === "--uat-candidate" && uatCandidatePath === null) {
      uatCandidatePath = requireBuilderOptionValue(args[index + 1]);
      index += 1;
    } else if (arg === "--uat-baseline-package" && uatBaselinePackageRoot === null) {
      uatBaselinePackageRoot = requireBuilderOptionValue(args[index + 1]);
      index += 1;
    } else if (arg === "--uat-baseline-tarball" && uatBaselineTarballPath === null) {
      uatBaselineTarballPath = requireBuilderOptionValue(args[index + 1]);
      index += 1;
    } else if (arg === "--uat-successor-package" && uatSuccessorPackageRoot === null) {
      uatSuccessorPackageRoot = requireBuilderOptionValue(args[index + 1]);
      index += 1;
    } else if (arg === "--uat-successor-tarball" && uatSuccessorTarballPath === null) {
      uatSuccessorTarballPath = requireBuilderOptionValue(args[index + 1]);
      index += 1;
    } else if (arg === "--digest") {
      const binding = requireBuilderOptionValue(args[index + 1]);
      const receiptMatch = binding.match(/^builder-install-receipt=(sha256:[a-f0-9]{64})$/u);
      const uatHeadMatch = binding.match(/^builder-codex-uat-head=(sha256:[a-f0-9]{64})$/u);
      const uatCandidateMatch = binding.match(/^builder-codex-uat-candidate=(sha256:[a-f0-9]{64})$/u);
      if (receiptMatch && receiptDigest === null) receiptDigest = receiptMatch[1];
      else if (/^builder-codex-uat=/u.test(binding)) {
        throw cliError("AGENTMO_CLI_BUILDER_UAT_MIGRATION_REQUIRED");
      } else if (uatHeadMatch && uatHeadDigest === null) uatHeadDigest = uatHeadMatch[1];
      else if (uatCandidateMatch && uatCandidateDigest === null) uatCandidateDigest = uatCandidateMatch[1];
      else throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
      index += 1;
    } else if (arg === "--json" && !json) {
      json = true;
    } else {
      throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
    }
  }
  const uatParts = [
    uatJournalPath,
    uatCandidatePath,
    uatHeadDigest,
    uatCandidateDigest,
    uatBaselinePackageRoot,
    uatBaselineTarballPath,
    uatSuccessorPackageRoot,
    uatSuccessorTarballPath,
  ];
  if (receiptDigest === null || (!uatParts.every((value) => value === null)
    && !uatParts.every((value) => value !== null))) {
    throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
  }
  return {
    action,
    projectRoot: resolve(project ?? "."),
    receiptDigest,
    uatJournalPath: uatJournalPath === null ? null : resolve(uatJournalPath),
    uatCandidatePath: uatCandidatePath === null ? null : resolve(uatCandidatePath),
    uatHeadDigest,
    uatCandidateDigest,
    uatBaselinePackageRoot: uatBaselinePackageRoot === null
      ? null
      : resolve(uatBaselinePackageRoot),
    uatBaselineTarballPath: uatBaselineTarballPath === null
      ? null
      : resolve(uatBaselineTarballPath),
    uatSuccessorPackageRoot: uatSuccessorPackageRoot === null
      ? null
      : resolve(uatSuccessorPackageRoot),
    uatSuccessorTarballPath: uatSuccessorTarballPath === null
      ? null
      : resolve(uatSuccessorTarballPath),
    json,
  };
}

function requireBuilderOptionValue(value) {
  if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
    throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
  }
  return value;
}

function requireBuilderDigest(value) {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value ?? "")) {
    throw cliError("AGENTMO_CLI_BUILDER_REJECTED");
  }
  return value;
}

function parseRuntimeCheckArgs(args) {
  let target = null;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--target" && target === null) {
      const value = args[index + 1];
      if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
        throw cliError("AGENTMO_CLI_RUNTIME_CHECK_REJECTED");
      }
      target = value;
      index += 1;
    } else if (arg === "--json" && !json) {
      json = true;
    } else {
      throw cliError("AGENTMO_CLI_RUNTIME_CHECK_REJECTED");
    }
  }
  if (target !== "openclaw") {
    throw cliError("AGENTMO_CLI_RUNTIME_CHECK_REJECTED");
  }
  return { target, json };
}

function parseAdmittedBlueprintArg(args, command) {
  const file = args[0];
  if (!file) throw new Error("Missing blueprint file path.");
  let json = false;
  const digestBindings = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--digest") {
      digestBindings.push(requireDigestBinding(args[index + 1]));
      index += 1;
    } else {
      throw new Error(`Unknown ${command} option: ${arg}`);
    }
  }
  const digests = parseDigestBindings(digestBindings, subjectsForCommand(command));
  return { file: resolve(file), json, digests };
}

function parseReportArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing blueprint file path for report.");
  let discoveryManifestPath = null;
  let json = false;
  const digestBindings = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--discovery-manifest") {
      discoveryManifestPath = args[index + 1];
      index += 1;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--digest") {
      digestBindings.push(requireDigestBinding(args[index + 1]));
      index += 1;
    } else {
      throw new Error(`Unknown report option: ${arg}`);
    }
  }
  if (discoveryManifestPath !== null) requireOptionValue(discoveryManifestPath, "--discovery-manifest");
  const digests = parseDigestBindings(
    digestBindings,
    subjectsForCommand("report", {
      includeOptionalSubjects: discoveryManifestPath ? ["discovery-manifest"] : [],
    }),
  );
  return {
    file: resolve(file),
    discoveryManifestPath: discoveryManifestPath ? resolve(discoveryManifestPath) : null,
    json,
    digests,
  };
}

function parseMigrateArgs(args) {
  const inputs = [];
  const digestBindings = [];
  let json = false;
  let out = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--digest") {
      const value = args[index + 1];
      if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
        throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_DIGEST_INVALID");
      }
      digestBindings.push(value);
      index += 1;
    } else if (arg === "--out") {
      const value = args[index + 1];
      if (
        out !== null ||
        typeof value !== "string" ||
        value.length === 0 ||
        value.startsWith("--")
      ) {
        throw new Error("Migration --out requires one new dedicated directory.");
      }
      out = resolve(value);
      index += 1;
    } else if (arg.startsWith("--")) {
      throw new Error("Unknown migrate option.");
    } else {
      inputs.push(resolve(arg));
    }
  }
  if (inputs.length === 0) throw new Error("At least one migration input is required.");
  const digests = parseDigestBindings(
    digestBindings,
    subjectsForCommand("migrate", { inputCount: inputs.length }),
  );
  return { inputs, out, json, digests };
}

function migrationApplyOutput(result) {
  return {
    schemaVersion: "agentmo.migration-apply-result.v1",
    ok: true,
    status: "committed",
    plan_digest: result.plan_digest,
    verification: "passed",
  };
}

function formatMigrationApplyResult(result) {
  return [
    "AgentMo migration apply",
    "Status: committed",
    "Plan digest: " + result.plan_digest,
    "Verification: passed",
  ].join("\n") + "\n";
}

async function emitArtifactOutput(candidate, options) {
  return emitPersistableOutput({
    candidate,
    json: options.json === true,
    format: (value, mode) => mode.json
      ? serializePersistableJson(value, { subject: options.subject })
      : options.format(value),
    sink: artifactStdoutSink,
    options: { subject: options.subject },
  });
}

async function emitNonArtifactOutput(candidate, options) {
  return emitPersistableOutput({
    candidate,
    json: options.json === true,
    format: (value, mode) => mode.json
      ? serializePersistableJson(value, { subject: options.subject })
      : options.format(value),
    sink: nonArtifactStdoutSink,
    options: { subject: options.subject },
  });
}

async function emitCliError(error, options) {
  const envelope = cliErrorEnvelope(error);
  return emitPersistableOutput({
    candidate: envelope,
    json: options.json === true,
    format: (value, mode) => mode.json
      ? serializePersistableJson(value, { subject: "cli-error" })
      : formatCliError(value),
    sink: options.json === true ? diagnosticJsonStdoutSink : diagnosticHumanStderrSink,
    options: { subject: "cli-error" },
  });
}

function cliErrorEnvelope(error) {
  const code = boundedCliErrorCode(error);
  const category = cliErrorCategory(code);
  const validationDetails = boundedArtifactValidationDetails(error);
  return {
    schemaVersion: "agentmo.cli-error.v1",
    ok: false,
    code,
    category,
    guidance: validationDetails === null
      ? cliErrorGuidance(category, code)
      : `Correct the listed fields using \`agentmo artifact-contract ${validationDetails.subject} --json\`, then recompute the exact digest.`,
    ...(validationDetails ?? {}),
  };
}

function boundedArtifactValidationDetails(error) {
  if (error?.code !== "AGENTMO_UNSUPPORTED_ARTIFACT"
    || error?.reason !== "schema_validation_failed"
    || !listArtifactContractSubjects().includes(error?.subject)
    || !Array.isArray(error?.issues)
    || error.issues.length === 0) {
    return null;
  }
  const issues = error.issues
    .filter((issue) => typeof issue === "string" && issue.length > 0 && issue.length <= 240)
    .slice(0, 32);
  return issues.length === 0
    ? null
    : { subject: error.subject, issues };
}

function boundedCliErrorCode(error) {
  const code = error?.code;
  if (typeof code === "string" && /^AGENTMO_[A-Z0-9_]{1,112}$/u.test(code)) return code;
  return "AGENTMO_CLI_REQUEST_REJECTED";
}

function cliErrorCategory(code) {
  if (code === "AGENTMO_MIGRATION_REQUIRED" || code.startsWith("AGENTMO_MIGRATION_")) return "migration";
  if (code.startsWith("AGENTMO_ARTIFACT_")
    || code === "AGENTMO_UNSUPPORTED_ARTIFACT"
    || code === "AGENTMO_DURABLE_COMMAND_UNSUPPORTED") return "artifact-admission";
  if (code.startsWith("AGENTMO_PERSISTABILITY_")) return "persistability";
  if (code.startsWith("AGENTMO_CLI_")) return "request";
  return "operation";
}

function cliErrorGuidance(category, code) {
  if (code === "AGENTMO_CLI_BUILDER_UAT_MIGRATION_REQUIRED") {
    return "Replace --uat/--digest builder-codex-uat with --uat-journal, --uat-candidate, and exact builder-codex-uat-head plus builder-codex-uat-candidate digest bindings.";
  }
  const guidance = {
    "artifact-admission": "Provide one exact supported subject and digest for every required input.",
    migration: "Preview migration with exact digest bindings before applying it.",
    persistability: "Remove unsafe material and retry with a bounded complete candidate.",
    request: "Review the command contract and retry with supported bounded options.",
    operation: "Review the operation prerequisites and retry without exposing local details.",
  };
  return guidance[category];
}

function formatCliError(envelope) {
  const lines = [
    "AgentMo CLI error",
    `Code: ${envelope.code}`,
    `Category: ${envelope.category}`,
    `Guidance: ${envelope.guidance}`,
  ];
  if (Array.isArray(envelope.issues)) {
    lines.push("Issues:");
    for (const issue of envelope.issues) lines.push(`- ${issue}`);
  }
  return `${lines.join("\n")}\n`;
}

function requestedJsonMode(args) {
  const command = args[0];
  const knownPrimaryInput = Object.hasOwn(CLI_OUTPUT_OWNERS, command)
    && !["builder", "help", "migrate", "runtime-check"].includes(command);
  for (let index = knownPrimaryInput ? 2 : 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") return true;
    if (CLI_VALUE_OPTIONS.has(arg)) index += 1;
  }
  return false;
}

function assertBuilderCliPlatform() {
  try {
    assertBuilderPlatform();
  } catch {
    throw cliError("AGENTMO_CLI_BUILDER_PLATFORM_UNSUPPORTED");
  }
}

function cliError(code) {
  const error = new Error("CLI request was rejected.");
  error.code = code;
  return error;
}

function artifactStdoutSink(text) {
  process.stdout.write(text);
}

function nonArtifactStdoutSink(text) {
  process.stdout.write(text);
}

function diagnosticJsonStdoutSink(text) {
  process.stdout.write(text);
}

function diagnosticHumanStderrSink(text) {
  process.stderr.write(text);
}

function parseDiscoverPackArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing discovery manifest file path.");
  let out = null;
  let json = false;
  const digestBindings = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--out") {
      out = args[index + 1];
      index += 1;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--digest") {
      digestBindings.push(requireDigestBinding(args[index + 1]));
      index += 1;
    } else {
      throw new Error(`Unknown discover-pack option: ${arg}`);
    }
  }
  requireOptionValue(out, "--out");
  const digests = parseDigestBindings(digestBindings, subjectsForCommand("discover-pack"));
  return { file: resolve(file), out: resolve(out), json, digests };
}

function parseDiscoverWorkspaceArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing discovery manifest file path.");
  let sourceRoot = null;
  let out = null;
  let json = false;
  const digestBindings = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--source-root") {
      sourceRoot = args[index + 1];
      index += 1;
    } else if (arg === "--out") {
      out = args[index + 1];
      index += 1;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--digest") {
      digestBindings.push(requireDigestBinding(args[index + 1]));
      index += 1;
    } else {
      throw new Error(`Unknown discover-workspace option: ${arg}`);
    }
  }
  requireOptionValue(sourceRoot, "--source-root");
  requireOptionValue(out, "--out");
  const digests = parseDigestBindings(digestBindings, subjectsForCommand("discover-workspace"));
  return { file: resolve(file), sourceRoot: resolve(sourceRoot), out: resolve(out), json, digests };
}

function parseDiscoverReportArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing discovery manifest file path.");
  let json = false;
  const digestBindings = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--digest") {
      digestBindings.push(requireDigestBinding(args[index + 1]));
      index += 1;
    } else {
      throw new Error(`Unknown discover-report option: ${arg}`);
    }
  }
  const digests = parseDigestBindings(digestBindings, subjectsForCommand("discover-report"));
  return { file: resolve(file), json, digests };
}

function requireDigestBinding(value) {
  if (typeof value !== "string" || value.startsWith("--")) {
    throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_DIGEST_INVALID");
  }
  return value;
}

function parseBlueprintDraftArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing discovery-db file path.");
  let need = null;
  let out = null;
  let target = "openclaw";
  let designPlan = null;
  let json = false;
  const digestBindings = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--need") {
      need = args[index + 1];
      index += 1;
    } else if (arg === "--out") {
      out = args[index + 1];
      index += 1;
    } else if (arg === "--target") {
      target = args[index + 1];
      index += 1;
    } else if (arg === "--design-plan") {
      designPlan = args[index + 1];
      index += 1;
    } else if (arg === "--digest") {
      digestBindings.push(requireDigestBinding(args[index + 1]));
      index += 1;
    } else if (arg === "--json") {
      json = true;
    } else {
      throw new Error(`Unknown blueprint-draft option: ${arg}`);
    }
  }
  requireOptionValue(need, "--need");
  requireOptionValue(out, "--out");
  if (designPlan !== null) requireOptionValue(designPlan, "--design-plan");
  assertKnownTarget(target, "blueprint-draft target");
  const subjects = subjectsForCommand("blueprint-draft", {
    includeOptionalSubjects: designPlan ? ["design-plan"] : [],
  });
  const digests = parseDigestBindings(digestBindings, subjects);
  return {
    file: resolve(file),
    need: resolve(need),
    out: resolve(out),
    target,
    designPlan: designPlan ? resolve(designPlan) : null,
    json,
    digests,
  };
}

function parseNeedReportArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing user-need file path.");
  let json = false;
  const digestBindings = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--digest") {
      digestBindings.push(requireDigestBinding(args[index + 1]));
      index += 1;
    } else {
      throw new Error(`Unknown need-report option: ${arg}`);
    }
  }
  const digests = parseDigestBindings(digestBindings, subjectsForCommand("need-report"));
  return { file: resolve(file), json, digests };
}

function parseArtifactContractArgs(args) {
  const subject = args[0];
  let json = false;
  if (typeof subject !== "string" || subject.startsWith("--")) {
    throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
  }
  for (let index = 1; index < args.length; index += 1) {
    if (args[index] === "--json") {
      json = true;
    } else {
      throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
    }
  }
  return { subject, json };
}

function parseDesignPlanArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing discovery-db file path.");
  let need = null;
  let out = null;
  let target = "openclaw";
  let json = false;
  const digestBindings = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--need") {
      need = args[index + 1];
      index += 1;
    } else if (arg === "--out") {
      out = args[index + 1];
      index += 1;
    } else if (arg === "--target") {
      target = args[index + 1];
      index += 1;
    } else if (arg === "--digest") {
      const binding = args[index + 1];
      if (typeof binding !== "string" || binding.startsWith("--")) {
        throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_DIGEST_INVALID");
      }
      digestBindings.push(binding);
      index += 1;
    } else if (arg === "--json") {
      json = true;
    } else {
      throw new Error(`Unknown design-plan option: ${arg}`);
    }
  }
  requireOptionValue(need, "--need");
  requireOptionValue(out, "--out");
  assertKnownTarget(target, "design-plan target");
  const digests = parseDigestBindings(digestBindings, subjectsForCommand("design-plan"));
  return { file: resolve(file), need: resolve(need), out: resolve(out), target, json, digests };
}

function parseHandoffArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing blueprint file path.");
  let target = "openclaw";
  let out = null;
  let json = false;
  const digestBindings = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--target") {
      target = args[index + 1];
      index += 1;
    } else if (arg === "--out") {
      out = args[index + 1];
      index += 1;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--digest") {
      digestBindings.push(requireDigestBinding(args[index + 1]));
      index += 1;
    } else {
      throw new Error(`Unknown handoff option: ${arg}`);
    }
  }
  requireOptionValue(out, "--out");
  assertKnownTarget(target, "handoff target");
  const digests = parseDigestBindings(digestBindings, subjectsForCommand("handoff"));
  return { file: resolve(file), target, out: resolve(out), json, digests };
}

function parseBirthReportArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing blueprint file path.");
  let buildStatePath = null;
  let runStatePath = null;
  let runEvalPath = null;
  let expectStatus = null;
  let json = false;
  const digestBindings = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--build-state") {
      buildStatePath = args[index + 1];
      index += 1;
    } else if (arg === "--run-state") {
      runStatePath = args[index + 1];
      index += 1;
    } else if (arg === "--run-eval") {
      runEvalPath = args[index + 1];
      index += 1;
    } else if (arg === "--expect-status") {
      expectStatus = args[index + 1];
      index += 1;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--digest") {
      digestBindings.push(requireDigestBinding(args[index + 1]));
      index += 1;
    } else {
      throw new Error(`Unknown birth-report option: ${arg}`);
    }
  }
  requireOptionValue(buildStatePath, "--build-state");
  requireOptionValue(runStatePath, "--run-state");
  requireOptionValue(runEvalPath, "--run-eval");
  requireOptionValue(expectStatus, "--expect-status");
  if (!["success", "declared", "failure"].includes(expectStatus)) {
    throw new Error("--expect-status must be one of: success, declared, failure.");
  }
  const digests = parseDigestBindings(digestBindings, subjectsForCommand("birth-report"));
  return {
    file: resolve(file),
    buildStatePath: resolve(buildStatePath),
    runStatePath: resolve(runStatePath),
    runEvalPath: resolve(runEvalPath),
    expectStatus,
    json,
    digests,
  };
}

function parseDomainEvalArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing blueprint file path for domain-eval.");
  let casesPath = null;
  let target = null;
  let json = false;
  const digestBindings = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--cases") {
      casesPath = args[index + 1];
      index += 1;
    } else if (arg === "--target") {
      target = args[index + 1];
      index += 1;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--digest") {
      digestBindings.push(requireDigestBinding(args[index + 1]));
      index += 1;
    } else {
      throw new Error(`Unknown domain-eval option: ${arg}`);
    }
  }
  requireOptionValue(casesPath, "--cases");
  if (target !== null) {
    requireOptionValue(target, "--target");
    assertKnownTarget(target, "domain-eval target");
  }
  const digests = parseDigestBindings(digestBindings, subjectsForCommand("domain-eval"));
  return { file: resolve(file), casesPath: resolve(casesPath), target, json, digests };
}

function parseDeliveryReportArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing blueprint file path for delivery-report.");
  let buildStatePath = null;
  let runStatePath = null;
  let runEvalPath = null;
  let birthReportPath = null;
  let domainEvalPath = null;
  let json = false;
  const digestBindings = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--build-state") {
      buildStatePath = args[index + 1];
      index += 1;
    } else if (arg === "--run-state") {
      runStatePath = args[index + 1];
      index += 1;
    } else if (arg === "--run-eval") {
      runEvalPath = args[index + 1];
      index += 1;
    } else if (arg === "--birth-report") {
      birthReportPath = args[index + 1];
      index += 1;
    } else if (arg === "--domain-eval") {
      domainEvalPath = args[index + 1];
      index += 1;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--digest") {
      digestBindings.push(requireDigestBinding(args[index + 1]));
      index += 1;
    } else {
      throw new Error(`Unknown delivery-report option: ${arg}`);
    }
  }
  requireOptionValue(buildStatePath, "--build-state");
  requireOptionValue(runStatePath, "--run-state");
  requireOptionValue(runEvalPath, "--run-eval");
  requireOptionValue(birthReportPath, "--birth-report");
  if (domainEvalPath !== null) requireOptionValue(domainEvalPath, "--domain-eval");
  const digests = parseDigestBindings(
    digestBindings,
    subjectsForCommand("delivery-report", {
      includeOptionalSubjects: domainEvalPath ? ["domain-eval"] : [],
    }),
  );
  return {
    file: resolve(file),
    buildStatePath: resolve(buildStatePath),
    runStatePath: resolve(runStatePath),
    runEvalPath: resolve(runEvalPath),
    birthReportPath: resolve(birthReportPath),
    domainEvalPath: domainEvalPath ? resolve(domainEvalPath) : null,
    json,
    digests,
  };
}

function parseStatusArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing blueprint file path.");
  let json = false;
  let buildStatePath = null;
  let runStatePath = null;
  let runDir = null;
  const digestBindings = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--build-state") {
      buildStatePath = args[index + 1];
      if (!buildStatePath) throw new Error("Missing --build-state <path> for status.");
      index += 1;
    } else if (arg === "--run-state") {
      runStatePath = args[index + 1];
      if (!runStatePath) throw new Error("Missing --run-state <path> for status.");
      index += 1;
    } else if (arg === "--run-dir") {
      runDir = args[index + 1];
      if (!runDir) throw new Error("Missing --run-dir <path> for status.");
      index += 1;
    } else if (arg === "--digest") {
      digestBindings.push(requireDigestBinding(args[index + 1]));
      index += 1;
    } else {
      throw new Error(`Unknown status option: ${arg}`);
    }
  }
  const optionalSubjects = [];
  if (buildStatePath) optionalSubjects.push("build-state");
  if (runStatePath) optionalSubjects.push("run-state");
  else if (runDir) optionalSubjects.push("run-state", "run-index");
  const digests = parseDigestBindings(
    digestBindings,
    subjectsForCommand("status", {
      includeOptionalSubjects: optionalSubjects,
    }),
  );
  return {
    file: resolve(file),
    json,
    buildStatePath: buildStatePath ? resolve(buildStatePath) : null,
    runStatePath: runStatePath ? resolve(runStatePath) : null,
    runDir: runDir ? resolve(runDir) : null,
    digests,
  };
}

async function loadOptionalBuildState(buildStatePath, expectedDigest, blueprintAdmission) {
  if (!buildStatePath) return {};
  return {
    buildState: await loadBuildState(buildStatePath, {
      subject: "build-state",
      expectedDigest,
      blueprintAdmission,
    }),
    buildStatePath,
  };
}

async function loadOptionalRunState(runStatePath, runDir, digests) {
  if (runStatePath) {
    const admission = await loadRunState(runStatePath, {
      subject: "run-state",
      expectedDigest: digests["run-state"],
      returnAdmission: true,
    });
    return { runState: admission.value, runStatePath };
  }
  if (runDir) {
    const resolved = await resolveLatestRunStateFromDir(runDir, {
      runIndexDigest: digests["run-index"],
      runStateDigest: digests["run-state"],
    });
    return { runState: resolved.runState, runStatePath: resolved.runStatePath };
  }
  return {};
}

function parsePlanArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing blueprint file path.");
  let json = false;
  let target = "agentmo";
  const digestBindings = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--target") {
      target = args[index + 1];
      index += 1;
    } else if (arg === "--digest") {
      digestBindings.push(requireDigestBinding(args[index + 1]));
      index += 1;
    } else {
      throw new Error(`Unknown plan option: ${arg}`);
    }
  }
  assertKnownTarget(target, "plan target");
  const digests = parseDigestBindings(digestBindings, subjectsForCommand("plan"));
  return { file: resolve(file), json, target, digests };
}

async function parseRunPlanArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing blueprint file path.");
  const digestBindings = [];
  const options = {
    file: resolve(file),
    target: "openclaw",
    workspace: null,
    agent: null,
    sessionKey: null,
    sessionId: null,
    to: null,
    message: undefined,
    messageBytes: undefined,
    messageFile: null,
    messageFileContent: undefined,
    envFile: null,
    envFileContent: undefined,
    openClawSourceRoot: null,
    openClawStateDir: null,
    useProductionOpenClawState: false,
    provider: null,
    model: null,
    thinking: null,
    channel: null,
    transport: null,
    fallbackFrom: null,
    timeoutMs: undefined,
    json: false,
  };
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--digest") {
      digestBindings.push(requireDigestBinding(args[index + 1]));
      index += 1;
    } else if (arg === "--target") {
      options.target = args[index + 1];
      index += 1;
    } else if (arg === "--workspace") {
      options.workspace = args[index + 1];
      index += 1;
    } else if (arg === "--agent") {
      options.agent = args[index + 1];
      index += 1;
    } else if (arg === "--session-key") {
      options.sessionKey = args[index + 1];
      index += 1;
    } else if (arg === "--session-id") {
      options.sessionId = args[index + 1];
      index += 1;
    } else if (arg === "--to") {
      options.to = args[index + 1];
      index += 1;
    } else if (arg === "--message") {
      options.message = args[index + 1];
      index += 1;
    } else if (arg === "--message-file") {
      options.messageFile = args[index + 1];
      index += 1;
    } else if (arg === "--runtime-env-file") {
      options.envFile = args[index + 1];
      index += 1;
    } else if (arg === "--openclaw-source-root") {
      options.openClawSourceRoot = args[index + 1];
      index += 1;
    } else if (arg === "--openclaw-state-dir") {
      options.openClawStateDir = args[index + 1];
      index += 1;
    } else if (arg === "--use-production-openclaw-state") {
      options.useProductionOpenClawState = true;
    } else if (arg === "--provider") {
      options.provider = args[index + 1];
      index += 1;
    } else if (arg === "--model") {
      options.model = args[index + 1];
      index += 1;
    } else if (arg === "--thinking") {
      options.thinking = args[index + 1];
      index += 1;
    } else if (arg === "--channel") {
      options.channel = args[index + 1];
      index += 1;
    } else if (arg === "--transport") {
      options.transport = args[index + 1];
      index += 1;
    } else if (arg === "--fallback-from") {
      options.fallbackFrom = args[index + 1];
      index += 1;
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = args[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown run-plan option: ${arg}`);
    }
  }
  requireOptionValue(options.target, "--target");
  requireOptionValue(options.workspace, "--workspace");
  if (options.agent !== null) requireOptionValue(options.agent, "--agent");
  if (options.sessionKey !== null) requireOptionValue(options.sessionKey, "--session-key");
  if (options.sessionId !== null) requireOptionValue(options.sessionId, "--session-id");
  if (options.to !== null) requireOptionValue(options.to, "--to");
  if (options.provider !== null) requireOptionValue(options.provider, "--provider");
  if (options.model !== null) requireOptionValue(options.model, "--model");
  if (options.thinking !== null) requireOptionValue(options.thinking, "--thinking");
  if (options.channel !== null) requireOptionValue(options.channel, "--channel");
  if (options.transport !== null) requireOptionValue(options.transport, "--transport");
  if (options.fallbackFrom !== null) requireOptionValue(options.fallbackFrom, "--fallback-from");
  await materializeTransientMessageOptions(options, { required: true });
  await materializeTransientEnvOptions(options);
  if (options.openClawSourceRoot !== null) {
    requireOptionValue(options.openClawSourceRoot, "--openclaw-source-root");
    options.openClawSourceRoot = resolve(options.openClawSourceRoot);
  }
  if (options.openClawStateDir !== null) {
    requireOptionValue(options.openClawStateDir, "--openclaw-state-dir");
    options.openClawStateDir = resolve(options.openClawStateDir);
  }
  if (options.openClawStateDir !== null && options.useProductionOpenClawState) {
    throw new Error("Pass either --openclaw-state-dir or --use-production-openclaw-state, not both.");
  }
  if (options.timeoutMs !== undefined) {
    requireOptionValue(options.timeoutMs, "--timeout-ms");
    const numericTimeout = Number(options.timeoutMs);
    if (!Number.isInteger(numericTimeout) || numericTimeout <= 0) throw new Error("--timeout-ms must be a positive integer.");
    options.timeoutMs = numericTimeout;
  }
  assertKnownTarget(options.target, "run-plan target");
  options.workspace = resolve(options.workspace);
  options.digests = parseDigestBindings(digestBindings, subjectsForCommand("run-plan"));
  return options;
}

function parseRunSyntaxArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing runtime-plan file path for run.");
  const digestBindings = [];
  const options = {
    file,
    workspace: null,
    message: undefined,
    messageBytes: undefined,
    messageFile: null,
    messageFileContent: undefined,
    envFile: null,
    envFileContent: undefined,
    openClawSourceRoot: null,
    openClawStateDir: null,
    out: null,
    live: false,
    json: false,
  };
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--out") {
      options.out = args[index + 1];
      index += 1;
    } else if (arg === "--live") {
      options.live = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--digest") {
      digestBindings.push(requireDigestBinding(args[index + 1]));
      index += 1;
    } else if (arg === "--workspace") {
      options.workspace = args[index + 1];
      index += 1;
    } else if (arg === "--message") {
      options.message = args[index + 1];
      index += 1;
    } else if (arg === "--message-file") {
      options.messageFile = args[index + 1];
      index += 1;
    } else if (arg === "--runtime-env-file") {
      options.envFile = args[index + 1];
      index += 1;
    } else if (arg === "--openclaw-source-root") {
      options.openClawSourceRoot = args[index + 1];
      index += 1;
    } else if (arg === "--openclaw-state-dir") {
      options.openClawStateDir = args[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown run option: ${arg}`);
    }
  }
  requireOptionValue(options.workspace, "--workspace");
  requireOptionValue(options.out, "--out");
  validateTransientMessageOptions(options, { required: true });
  validateTransientEnvOptions(options);
  validateTransientPathOptions(options);
  options.digests = parseDigestBindings(
    digestBindings,
    subjectsForCommand("run", {
      includeOptionalSubjects: hasDigestSubject(digestBindings, "run-index") ? ["run-index"] : [],
    }),
  );
  options.runIndexDigest = options.digests["run-index"];
  return options;
}

async function materializeRunOptions(options) {
  await materializeTransientMessageOptions(options, { required: true });
  await materializeTransientEnvOptions(options);
  materializeTransientPathOptions(options);
  options.file = resolve(options.file);
  options.workspace = resolve(options.workspace);
  options.out = resolve(options.out);
  return options;
}

function parseRunStateFileArg(args, commandName) {
  const file = args[0];
  if (!file) throw new Error(`Missing run-state file path for ${commandName}.`);
  let json = false;
  const digestBindings = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") json = true;
    else if (arg === "--digest") {
      digestBindings.push(requireDigestBinding(args[index + 1]));
      index += 1;
    }
    else throw new Error(`Unknown ${commandName} option: ${arg}`);
  }
  const digests = parseDigestBindings(digestBindings, subjectsForCommand(commandName));
  return { file: resolve(file), json, digests };
}

function parseReplayRunSyntaxArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing run-state file path for replay-run.");
  const digestBindings = [];
  const options = {
    file,
    out: null,
    workspace: null,
    openClawSourceRoot: null,
    openClawStateDir: null,
    message: undefined,
    messageBytes: undefined,
    messageFile: null,
    messageFileContent: undefined,
    envFile: null,
    envFileContent: undefined,
    live: false,
    json: false,
    resumeSession: false,
    requireExactReplay: false,
  };
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--out") {
      options.out = args[index + 1];
      index += 1;
    } else if (arg === "--workspace") {
      options.workspace = args[index + 1];
      index += 1;
    } else if (arg === "--openclaw-source-root") {
      options.openClawSourceRoot = args[index + 1];
      index += 1;
    } else if (arg === "--openclaw-state-dir") {
      options.openClawStateDir = args[index + 1];
      index += 1;
    } else if (arg === "--message") {
      options.message = args[index + 1];
      index += 1;
    } else if (arg === "--message-file") {
      options.messageFile = args[index + 1];
      index += 1;
    } else if (arg === "--runtime-env-file") {
      options.envFile = args[index + 1];
      index += 1;
    } else if (arg === "--digest") {
      digestBindings.push(requireDigestBinding(args[index + 1]));
      index += 1;
    } else if (arg === "--live") {
      options.live = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--resume-session") {
      options.resumeSession = true;
    } else if (arg === "--require-exact-replay") {
      options.requireExactReplay = true;
    } else {
      throw new Error(`Unknown replay-run option: ${arg}`);
    }
  }
  requireOptionValue(options.out, "--out");
  validateTransientMessageOptions(options, { required: false });
  validateTransientEnvOptions(options);
  validateTransientPathOptions(options);
  options.digests = parseDigestBindings(
    digestBindings,
    subjectsForCommand("replay-run", {
      includeOptionalSubjects: hasDigestSubject(digestBindings, "run-index") ? ["run-index"] : [],
    }),
  );
  options.runIndexDigest = options.digests["run-index"];
  return options;
}

async function materializeReplayRunOptions(options) {
  await materializeTransientMessageOptions(options, { required: false });
  await materializeTransientEnvOptions(options);
  materializeTransientPathOptions(options);
  options.file = resolve(options.file);
  if (options.workspace !== null) options.workspace = resolve(options.workspace);
  options.out = resolve(options.out);
  return options;
}

async function parseRunEvalArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing run-state file path for run-eval.");
  const options = {
    file: resolve(file),
    json: false,
    expectStatus: null,
    requireExactReplay: false,
    message: undefined,
    messageBytes: undefined,
    messageFile: null,
    messageFileContent: undefined,
  };
  const digestBindings = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--digest") {
      digestBindings.push(requireDigestBinding(args[index + 1]));
      index += 1;
    } else if (arg === "--require-exact-replay") {
      options.requireExactReplay = true;
    } else if (arg === "--message") {
      options.message = args[index + 1];
      index += 1;
    } else if (arg === "--message-file") {
      options.messageFile = args[index + 1];
      index += 1;
    } else if (arg === "--expect-status") {
      options.expectStatus = args[index + 1];
      requireOptionValue(options.expectStatus, "--expect-status");
      index += 1;
    } else {
      throw new Error(`Unknown run-eval option: ${arg}`);
    }
  }
  await materializeTransientMessageOptions(options, { required: false });
  options.digests = parseDigestBindings(digestBindings, subjectsForCommand("run-eval"));
  return options;
}

function parseObserveRunArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing run-state file path for observe-run.");
  let out = null;
  let json = false;
  const digestBindings = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--out") {
      out = args[index + 1];
      index += 1;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--digest") {
      digestBindings.push(requireDigestBinding(args[index + 1]));
      index += 1;
    } else {
      throw new Error(`Unknown observe-run option: ${arg}`);
    }
  }
  requireOptionValue(out, "--out");
  const digests = parseDigestBindings(digestBindings, subjectsForCommand("observe-run"));
  return { file: resolve(file), out: resolve(out), json, digests };
}

async function materializeTransientMessageOptions(options, configuration = {}) {
  validateTransientMessageOptions(options, configuration);
  const hasInline = options.message !== undefined;
  const hasFile = options.messageFile !== null;
  if (!hasInline && !hasFile) return;
  if (hasInline) {
    options.messageBytes = Buffer.from(options.message, "utf8");
    return;
  }
  options.messageFile = resolve(options.messageFile);
  options.messageFileContent = await readFile(options.messageFile);
}

function validateTransientMessageOptions(options, configuration = {}) {
  const hasInline = options.message !== undefined;
  const hasFile = options.messageFile !== null;
  if (hasInline && hasFile) {
    throw new Error("Pass exactly one of --message or --message-file, not both.");
  }
  if (!hasInline && !hasFile) {
    if (configuration.required) {
      throw new Error("Missing message input. Pass --message <text> or --message-file <path>.");
    }
    return;
  }
  if (hasInline) {
    requireOptionValue(options.message, "--message");
    return;
  }
  requireOptionValue(options.messageFile, "--message-file");
}

async function materializeTransientEnvOptions(options) {
  validateTransientEnvOptions(options);
  if (options.envFile === null) return;
  options.envFile = resolve(options.envFile);
  options.envFileContent = await readFile(options.envFile, "utf8");
}

function validateTransientEnvOptions(options) {
  if (options.envFile === null) return;
  requireOptionValue(options.envFile, "--runtime-env-file");
}

function materializeTransientPathOptions(options) {
  validateTransientPathOptions(options);
  for (const [key, flag] of [
    ["openClawSourceRoot", "--openclaw-source-root"],
    ["openClawStateDir", "--openclaw-state-dir"],
  ]) {
    if (options[key] === null) continue;
    options[key] = resolve(options[key]);
  }
}

function validateTransientPathOptions(options) {
  for (const [key, flag] of [
    ["openClawSourceRoot", "--openclaw-source-root"],
    ["openClawStateDir", "--openclaw-state-dir"],
  ]) {
    if (options[key] === null) continue;
    requireOptionValue(options[key], flag);
  }
}

function requireOptionValue(value, optionName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing ${optionName} <value>.`);
  }
}

function hasDigestSubject(bindings, subject) {
  return bindings.some((binding) => typeof binding === "string" && binding.startsWith(`${subject}=`));
}

function parseScaffoldArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing blueprint file path.");
  let out;
  let force = false;
  let target = "agentmo";
  const digestBindings = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--out") {
      out = args[index + 1];
      index += 1;
    } else if (arg === "--target") {
      target = args[index + 1];
      index += 1;
    } else if (arg === "--force") {
      force = true;
    } else if (arg === "--digest") {
      digestBindings.push(requireDigestBinding(args[index + 1]));
      index += 1;
    } else {
      throw new Error(`Unknown scaffold option: ${arg}`);
    }
  }
  if (!out) throw new Error("Missing --out <dir> for scaffold.");
  assertKnownTarget(target, "scaffold target");
  const digests = parseDigestBindings(digestBindings, subjectsForCommand("scaffold"));
  return { file: resolve(file), out: resolve(out), force, target, digests };
}

function assertKnownTarget(target, subject) {
  const targets = listTargetIds();
  if (!targets.includes(target)) {
    throw new Error(`Unknown ${subject}: ${target}. Expected one of: ${targets.join(", ")}`);
  }
}

function formatBlueprintValidationResult(result) {
  const lines = ["PASS blueprint validation"];
  for (const warning of result.warnings) lines.push(`WARN ${warning}`);
  return `${lines.join("\n")}\n`;
}

function formatBuilderProbe(probe) {
  const lines = [
    `AgentMo Builder probe: ${probe.adapter.id}`,
    `Host version: ${probe.host.version ?? "not observed"}`,
    `Required capabilities: ${probe.required.ok ? "observed-compatible" : "unsupported"}`,
    `Evidence level: ${probe.support.evidenceLevel}`,
    "Support certified: no",
    "Mutation: none",
  ];
  for (const observation of probe.observations) {
    lines.push(`- ${observation.id}: ${observation.status} (${observation.requirement})`);
  }
  return `${lines.join("\n")}\n`;
}

function formatBuilderInstallPlan(plan) {
  const lines = [
    "AgentMo Builder setup preview",
    `Scope: ${plan.scope}`,
    `Release: ${plan.release.name}@${plan.release.version}`,
    `Plan digest: ${plan.planDigest}`,
    "Explicit apply required: true",
    `Host activation: ${plan.hostActivation.status}`,
  ];
  for (const operation of plan.operations) {
    lines.push(`- ${operation.currentStatus}: ${operation.relativePath}`);
  }
  const priorReceiptArgument = plan.priorReceipt === null
    ? ""
    : ` --digest builder-install-receipt=${plan.priorReceipt.digest}`;
  lines.push(
    `Apply with the same project: agentmo builder setup --project <same-project>${priorReceiptArgument}`
      + `${plan.hostActivation.hostScope === "user" ? " --host-scope user" : ""}`
      + ` --apply --plan-digest ${plan.planDigest}`,
  );
  return `${lines.join("\n")}\n`;
}

function formatBuilderInstallResult(result) {
  return [
    "AgentMo Builder setup",
    `Status: ${result.status}`,
    `Scope: ${result.scope}`,
    `Changed: ${result.changed}`,
    `Release: ${result.release.name}@${result.release.version}`,
    `Release digest: ${result.release.digest}`,
    `Receipt: ${result.receipt.path}`,
    `Receipt digest: ${result.receipt.digest}`,
    `Evidence: ${result.evidence.level}`,
    `Host activation: ${result.hostActivation.status}`,
    "Domain quality certified: no",
  ].join("\n") + "\n";
}

function formatBuilderInstallRecovery(result) {
  return [
    "AgentMo Builder install recovery",
    `Status: ${result.status}`,
    `Applicable: ${result.applicable ?? true}`,
    `Plan digest: ${result.planDigest ?? "not-created"}`,
    `Mutation: ${result.schemaVersion === "agentmo.builder-install-recovery-result.v1" ? "explicit" : "none"}`,
    "Automatic repair: no",
    "Domain quality certified: no",
  ].join("\n") + "\n";
}

function formatBuilderLifecyclePlan(plan) {
  const lines = [
    `AgentMo Builder ${plan.action} preview`,
    `Scope: ${plan.scope}`,
    `Applicable: ${plan.applicable}`,
    `Plan digest: ${plan.planDigest}`,
    "Explicit apply required: true",
  ];
  for (const operation of plan.operations) {
    const target = operation.relativePath ?? operation.receiptDigest ?? "lifecycle-authority";
    const state = operation.currentStatus === undefined ? "append-only" : operation.currentStatus;
    lines.push(`- ${operation.operation}: ${target} (${state})`);
  }
  for (const blocker of plan.blockers ?? []) lines.push(`BLOCKED ${blocker}`);
  if (plan.applicable) {
    lines.push(
      `Apply with the same project: agentmo builder ${plan.action} --project <same-project> `
      + `--digest builder-install-receipt=${plan.current.receiptDigest} `
      + `--apply --plan-digest ${plan.planDigest}`,
    );
  }
  if (plan.migrationNotice) lines.push(`Migration: ${plan.migrationNotice}`);
  return `${lines.join("\n")}\n`;
}

function formatBuilderLifecycleResult(result) {
  const lines = [
    `AgentMo Builder ${result.action}`,
    `Status: ${result.status}`,
    `Scope: ${result.scope}`,
    `Changed: ${result.changed}`,
    `Plan digest: ${result.planDigest}`,
    `Physical deletion: ${result.physicalDeletion === true ? "yes" : "no"}`,
    `Evidence: ${result.evidence.level}`,
    "Host behavior verified: no",
    "Domain quality certified: no",
  ];
  if (result.migrationNotice) lines.push(`Migration: ${result.migrationNotice}`);
  return lines.join("\n") + "\n";
}

function formatBuilderHostSelectorRemovalPlan(plan) {
  const lines = [
    "AgentMo Builder host selector removal preview",
    `Scope: ${plan.scope}`,
    `Applicable: ${plan.applicable}`,
    `Plan digest: ${plan.planDigest}`,
    `Owner disposition: ${plan.owner.disposition}`,
    `Consumer count: ${plan.consumerLedger.count}`,
    "Explicit apply required: true",
  ];
  for (const blocker of plan.blockers) lines.push(`BLOCKED ${blocker}`);
  return `${lines.join("\n")}\n`;
}

function formatBuilderHostSelectorRemovalResult(result) {
  return [
    "AgentMo Builder host selector removal",
    `Status: ${result.status}`,
    `Scope: ${result.scope}`,
    `Changed: ${result.changed}`,
    `Plan digest: ${result.planDigest}`,
    `Evidence: ${result.evidence.level}`,
    "Host behavior verified: no",
    "Domain quality certified: no",
  ].join("\n") + "\n";
}

function formatBuilderHostProjectionOperation(value) {
  const lines = [
    `AgentMo Builder ${value.action}`,
    `Status: ${value.status ?? (value.applicable ? "applicable" : "blocked")}`,
    `Host scope: ${value.hostScope}`,
    `Consumer count: ${value.consumerCount}`,
    `Plan digest: ${value.planDigest}`,
    `Evidence: ${value.evidence.level}`,
    "Host behavior verified: no",
    "Domain quality certified: no",
  ];
  for (const blocker of value.blockers ?? []) lines.push(`BLOCKED ${blocker}`);
  return `${lines.join("\n")}\n`;
}

function formatBuilderDoctor(report) {
  return [
    "AgentMo Builder doctor",
    `Status: ${report.status}`,
    `Platform: ${report.platform.current} (${report.platform.supported ? "supported POSIX" : "unsupported"})`,
    `Release match: ${report.release.match}`,
    `Required capabilities: ${report.capabilities.requiredOk ? "observed" : "degraded"}`,
    `Receipt: ${report.receipt.status}`,
    `Marker: ${report.marker.status}`,
    `Marketplace: ${report.visibility.marketplace}`,
    `Plugin: ${report.visibility.plugin}`,
    `Skill: ${report.visibility.skill}`,
    `Hook: ${report.visibility.hook}`,
    `Agent: ${report.visibility.agent}`,
    `Agent state: ${report.agent.status}`,
    `Host installation: ${report.host.installation}`,
    `Host enablement: ${report.host.enablement}`,
    `Host skill: ${report.host.skillVisibility}`,
    `Host hooks: ${report.host.hooksVisibility}`,
    `Host trust: ${report.host.trust}`,
    `Owner: ${report.ownership.ownerRecord}`,
    `Consumer: ${report.ownership.consumerPresence}`,
    `Checkpoint: ${report.checkpoint.status}`,
    "Mutation: none",
    "Repair: none",
    "Domain quality certified: no",
  ].join("\n") + "\n";
}

function formatBuilderBehaviorEval(report) {
  if (report.schemaVersion === "agentmo.builder-behavior-uat-chain.v3") {
    return [
      "AgentMo Builder Codex UAT candidate-ready chain",
      `Status: ${report.status}`,
      `Evidence: ${report.evidence.level} (${report.evidence.basis})`,
      `Scenarios: ${report.uat.scenarioCount}/${report.uat.scenarioCount}`,
      `Evidence digest: ${report.evidenceDigest}`,
      `External decision authority required: ${report.evidence.externalDecisionAuthorityRequired}`,
      "Real Codex session verified: false",
      "Host behavior verified: false",
      "Agent Package/domain/production certified: no",
    ].join("\n") + "\n";
  }
  return [
    "AgentMo Builder behavior evaluation",
    `Status: ${report.status}`,
    `Evidence: ${report.evidence.level} (${report.evidence.basis})`,
    `Scenarios: ${report.scenarios.results.filter((item) => item.passed).length}/${report.scenarios.results.length}`,
    `Evidence digest: ${report.evidenceDigest}`,
    `Codex activation verified: ${report.evidence.codexActivationVerified}`,
    `Host behavior verified: ${report.evidence.hostBehaviorVerified}`,
    "Domain quality certified: no",
  ].join("\n") + "\n";
}

function buildCodexUatCliOutput(action, view, extra = {}) {
  return {
    schemaVersion: "agentmo.codex-uat-command-result.v1",
    action,
    status: view.state.terminal ? "terminal" : action === "inspect" ? "inspected" : "recorded",
    headDigest: view.head?.digest ?? null,
    phase: view.state.phase,
    nextAction: view.state.nextAction,
    nextScenario: view.state.nextScenario,
    scenarioCount: view.state.scenarioCount,
    terminal: view.state.terminal,
    checkpointDigest: extra.checkpointDigest ?? null,
    correlation: extra.correlation ?? null,
    humanAdmissionRequired: true,
    supportCertified: false,
  };
}

function formatCodexUatCliOutput(result) {
  return [
    "AgentMo Codex UAT journal",
    `Action: ${result.action}`,
    `Status: ${result.status}`,
    `Phase: ${result.phase}`,
    `Head digest: ${result.headDigest ?? "none"}`,
    `Next action: ${result.nextAction ?? "none"}`,
    `Recorded scenarios: ${result.scenarioCount ?? "unknown"}/${11}`,
    `Next scenario: ${result.nextScenario ?? "none"}`,
    "Human admission required: true",
    "Support certified: no",
  ].join("\n") + "\n";
}

function formatBuilderEntry(entry) {
  return [
    "AgentMo Builder",
    `Mode: ${entry.mode}`,
    `Stage: ${entry.stage}`,
    `Next action: ${entry.nextAction}`,
    `Approval required: ${entry.approval.required}`,
    `Lifecycle: ${entry.lifecycle.invariant}`,
    "Mutation: proposal only",
  ].join("\n") + "\n";
}

function buildBuilderEventOutput(result, checkpointDigest, action) {
  return {
    schemaVersion: "agentmo.builder-event-output.v1",
    action,
    status: result.status,
    eventId: result.eventId,
    applied: result.applied,
    checkpoint: {
      digest: checkpointDigest,
      stage: result.checkpoint.stage,
      boundary: result.checkpoint.boundary,
      nextAction: result.checkpoint.nextAction,
      eventCursor: result.checkpoint.eventLedger.cursor,
    },
    announcement: result.announcement,
    proposal: result.proposal,
    automaticApproval: false,
    automaticStageAdvance: false,
  };
}

function formatBuilderEventOutput(result) {
  return [
    "AgentMo Builder checkpoint",
    `Action: ${result.action}`,
    `Status: ${result.status}`,
    `Event: ${result.eventId}`,
    `Stage: ${result.checkpoint.stage}`,
    `Next action: ${result.checkpoint.nextAction}`,
    `Checkpoint digest: ${result.checkpoint.digest}`,
    "Automatic approval: false",
    "Automatic stage advance: false",
  ].join("\n") + "\n";
}

function formatRuntimeCheck(report) {
  return [
    `Component: ${report.component}`,
    `Target: ${report.target}`,
    `Observed version: ${report.observedVersion}`,
    `Range: ${report.range}`,
    `Supported: ${report.supported}`,
    `Evidence class: ${report.evidenceClass}`,
  ].join("\n") + "\n";
}

function formatScaffoldProgress(progress) {
  const lines = [
    `Scaffolded ${progress.fileCount} files for target ${progress.target}`,
    ...progress.files.map((file) => `- ${file}`),
    `Build state: ${progress.buildStateRef}`,
  ];
  return `${lines.join("\n")}\n`;
}

function safeBuildPlanOutput(plan) {
  return {
    schemaVersion: plan.schemaVersion,
    agentId: plan.agentId,
    selectedTargetId: plan.selectedTargetId,
    selectedProfileId: plan.selectedProfileId,
    selectedModuleIds: [...plan.selectedModuleIds],
    warnings: [...plan.warnings],
    domainOperationCount: plan.domainOperationCount,
    operations: plan.operations.map((operation) => ({
      kind: operation.kind,
      relativePath: operation.relativePath,
      ownership: operation.ownership,
      source: operation.source,
      scaffoldOnly: operation.scaffoldOnly,
    })),
    target: {
      id: plan.target.id,
      label: plan.target.label,
      verificationHints: plan.target.verificationHints.map((item) => redactHostAbsolutePaths(item)),
      unsupportedSurfaces: plan.target.unsupportedSurfaces.map((item) => redactHostAbsolutePaths(item)),
    },
  };
}

function safeControlSnapshot(snapshot) {
  const latestBuildState = {
    ...snapshot.latestBuildState,
    path: typeof snapshot.latestBuildState?.path === "string" ? REDACTED_PATH : null,
  };
  const latestRunState = {
    ...snapshot.latestRunState,
    path: typeof snapshot.latestRunState?.path === "string" ? REDACTED_PATH : null,
  };
  const runtime = {
    primary: snapshot.runtime.primary,
    profiles: snapshot.runtime.profiles.map((profile) => ({
      id: profile.id,
      role: profile.role,
      status: profile.status,
      purposePresent: typeof profile.purpose === "string" && profile.purpose.length > 0,
    })),
  };
  const runtimeCertification = {
    profiles: snapshot.runtimeCertification.profiles.map((profile) => ({
      id: profile.id,
      role: profile.role,
      status: profile.status,
      ownerPresent: typeof profile.owner === "string" && profile.owner.length > 0,
      lastVerifiedAt: profile.lastVerifiedAt,
      supportedAssetCount: profile.supportedAssets.length,
      unsupportedSurfaceCount: profile.unsupportedSurfaces.length,
      installOrOnrampPresent: typeof profile.installOrOnramp === "string" && profile.installOrOnramp.length > 0,
      verificationCommandCount: profile.verificationCommands.length,
      riskNoteCount: profile.riskNotes.length,
      certificationStatus: profile.certificationStatus,
    })),
  };
  return {
    ...snapshot,
    runtime,
    runtimeCertification,
    latestBuildState,
    latestRunState,
    eval: {
      casesDeclared: typeof snapshot.eval.casesPath === "string" && snapshot.eval.casesPath.length > 0,
      rubricDeclared: typeof snapshot.eval.rubricPath === "string" && snapshot.eval.rubricPath.length > 0,
      requiredCaseClassCount: snapshot.eval.requiredCaseClasses.length,
      hardFailureCount: snapshot.eval.hardFailures.length,
    },
    evidence: {
      storeCount: snapshot.evidence.stores.length,
      requiredArtifactCount: snapshot.evidence.requiredArtifacts.length,
      auditRuleCount: snapshot.evidence.auditRules.length,
    },
    release: {
      readiness: snapshot.release.readiness,
      latestCommit: snapshot.release.latestCommit,
      latestTag: snapshot.release.latestTag,
      releaseLedgerDeclared: typeof snapshot.release.releaseLedgerPath === "string"
        && snapshot.release.releaseLedgerPath.length > 0,
      knownRiskCount: snapshot.release.knownRisks.length,
    },
    risks: snapshot.risks.length > 0
      ? ["Bounded risk metadata is present in the admitted blueprint."]
      : [],
    nextActions: snapshot.nextActions.length > 0
      ? ["Review the admitted evidence and bounded risk metadata before the next governed action."]
      : [],
  };
}

function formatBuildPlan(plan) {
  const lines = [
    `AgentMo build plan: ${plan.agentId}`,
    `Target: ${plan.selectedTargetId}`,
    `Runtime profile: ${plan.selectedProfileId ?? "none"}`,
    `Modules: ${plan.selectedModuleIds.join(", ")}`,
    `Domain operations: ${plan.domainOperationCount}`,
  ];
  for (const warning of plan.warnings) lines.push(`WARN ${warning}`);
  for (const operation of plan.operations) lines.push(`- ${operation.kind} ${operation.relativePath}`);
  return `${lines.join("\n")}\n`;
}

function formatRuntimePlan(plan) {
  const lines = [
    `AgentMo runtime plan: ${plan.agentId}`,
    `Target: ${plan.target.id}`,
    `Runtime profile: ${plan.selectedRuntimeProfileId ?? "none"}`,
    `Execution session policy: ${plan.executionSessionPolicy}`,
    "Workspace: transient path required at execution",
    `Command: ${plan.command.display}`,
    "Certification: not implied by runtime command planning",
  ];
  for (const digest of plan.unsupportedSurfaceDigests) lines.push(`UNSUPPORTED-DIGEST ${digest}`);
  return `${lines.join("\n")}\n`;
}

function formatRunState(state, options = {}) {
  const lines = [
    `AgentMo run: ${state.runId}`,
    `Agent: ${state.agentId}`,
    `Target: ${state.target.id}`,
    `Executed: ${state.execution.executed}`,
    `Status: ${state.execution.status}`,
    `Run state: ${options.written ? "agentmo-run-state.json" : "not written"}`,
    `Run index: ${options.written ? "agentmo-run-index.json" : "not written"}`,
    "Certification: not implied by runtime run evidence",
  ];
  return `${lines.join("\n")}\n`;
}

function formatRunReport(report) {
  const lines = [
    `AgentMo run report: ${report.summary?.runId ?? "unknown"}`,
    `Status: ${report.summary?.status ?? "unknown"}`,
    `Executed: ${report.summary?.executed ?? false}`,
    `Replay fidelity: ${report.summary?.replayFidelity ?? "unknown"}`,
    "Certification: not implied by runtime run evidence",
  ];
  return `${lines.join("\n")}\n`;
}

function formatRunEval(report) {
  const lines = [
    `AgentMo run eval: ${report.runId ?? "unknown"}`,
    `Status: ${report.ok ? "pass" : "fail"}`,
    `Actual execution status: ${report.actualStatus ?? "unknown"}`,
    `Replay fidelity: ${report.replayFidelity}`,
    "Certification: not implied by runtime run evidence",
  ];
  for (const check of report.checks) lines.push(`- ${check.pass ? "PASS" : "FAIL"} ${check.id}: ${check.message}`);
  return `${lines.join("\n")}\n`;
}

function formatRunObservationResult(result) {
  const lines = [
    `AgentMo observe-run: ${result.observation.runEvidence?.runId ?? "unknown"}`,
    `Observation: ${result.observationFile}`,
    `Status: ${result.report.ok ? "valid" : "invalid"}`,
    `Failure mode: ${result.observation.failureMode}`,
    "Mutation: proposal only",
  ];
  return `${lines.join("\n")}\n`;
}

function helpText() {
  return `AgentMo CLI

Builder platform: POSIX only (darwin, linux). Windows is unsupported.

Usage:
  agentmo builder [start] [--host codex] [--json]
  agentmo builder probe [--host codex] [--json]
  agentmo builder setup [--project <dir>] [--digest builder-install-receipt=sha256:<64hex>] [--host-scope user] [--host codex] [--json]
  agentmo builder setup [--project <dir>] [--digest builder-install-receipt=sha256:<64hex>] [--host-scope user] --apply --plan-digest sha256:<64hex> [--host codex] [--json]
  agentmo builder recover inspect [--project <dir>] [--json]
  agentmo builder recover preview [--project <dir>] [--json]
  agentmo builder recover apply [--project <dir>] --plan-digest sha256:<64hex> [--json]
  agentmo builder recover upgrade [--project <dir>] --digest builder-install-receipt=sha256:<64hex> --apply --plan-digest sha256:<64hex> [--json]
  agentmo builder upgrade [--project <dir>] --digest builder-install-receipt=sha256:<64hex> [--host codex] [--json]
  agentmo builder upgrade [--project <dir>] --digest builder-install-receipt=sha256:<64hex> --apply --plan-digest sha256:<64hex> [--host codex] [--json]
  agentmo builder deactivate [--project <dir>] --digest builder-install-receipt=sha256:<64hex> [--json]
  agentmo builder deactivate [--project <dir>] --digest builder-install-receipt=sha256:<64hex> --apply --plan-digest sha256:<64hex> [--json]
  agentmo builder reactivate [--project <dir>] --digest builder-install-receipt=sha256:<64hex> [--json]
  agentmo builder reactivate [--project <dir>] --digest builder-install-receipt=sha256:<64hex> --apply --plan-digest sha256:<64hex> [--json]
  agentmo builder doctor [--project <dir>] [--host codex] [--json]
  agentmo builder behavior [--project <dir>] --digest builder-install-receipt=sha256:<64hex> [--uat-journal <journal-file> --uat-candidate <candidate.json> --uat-baseline-package <dir> --uat-baseline-tarball <baseline.tgz> --uat-successor-package <dir> --uat-successor-tarball <successor.tgz> --digest builder-codex-uat-head=sha256:<64hex> --digest builder-codex-uat-candidate=sha256:<64hex>] [--json]
  agentmo builder behavior-eval [--project <dir>] --digest builder-install-receipt=sha256:<64hex> [--json]
  agentmo builder codex-uat start --journal <journal-file> --attempt-id <id> --request <record.json> --digest builder-codex-uat-record-request=sha256:<64hex> [--json]
  agentmo builder codex-uat scenario-arm --journal <journal-file> --expected-head-sha256 sha256:<64hex> --checkpoint <checkpoint> --digest builder-checkpoint=sha256:<64hex> [--json]
  agentmo builder codex-uat record --journal <journal-file> --expected-head-sha256 sha256:<64hex> --request <record.json> --digest builder-codex-uat-record-request=sha256:<64hex> [--checkpoint <checkpoint> --digest builder-checkpoint=sha256:<64hex> --observation <leaf.json> --digest builder-codex-uat-observation=sha256:<64hex>] [--json]
  agentmo builder codex-uat terminal failure|interruption --journal <journal-file> --expected-head-sha256 sha256:<64hex> --code <bounded-code> --evidence <evidence-file> --evidence-sha256 sha256:<64hex> [--json]
  agentmo builder codex-uat inspect --journal <journal-file> [--json]
  agentmo builder codex-uat resume --journal <journal-file> --expected-head-sha256 sha256:<64hex> [--json]
  agentmo builder codex-uat continue --attempt-dir <attempt-dir> --expected-head-sha256 sha256:<64hex> --approved-deactivation-plan-sha256 sha256:<64hex> --successor-tarball <successor.tgz> --expected-successor-version <version> --expected-release-sha256 sha256:<64hex> --expected-tarball-sha256 sha256:<64hex> --expected-verifier-sha256 sha256:<64hex>
  agentmo builder discover [--host codex] [--json]
  agentmo builder plan|produce --checkpoint <checkpoint.json> --digest builder-checkpoint=sha256:<64hex> [--host codex] [--json]
  agentmo builder resume --checkpoint <checkpoint.json> --digest builder-checkpoint=sha256:<64hex> [--host codex] [--json]
  agentmo builder pause --checkpoint <checkpoint.json> --digest builder-checkpoint=sha256:<64hex> --event-id <id> --out <checkpoint.json> [--json]
  agentmo builder hook --checkpoint <checkpoint.json> --digest builder-checkpoint=sha256:<64hex> --event <event.json> --digest builder-event=sha256:<64hex> --out <checkpoint.json> [--json]
  agentmo migrate <input-0.json> [input-N.json ...] --digest migration-input-0=sha256:<64hex> [--digest migration-input-N=sha256:<64hex> ...] [--out <new-dir>] [--json]
  agentmo runtime-check --target openclaw [--json]
  agentmo artifact-contract discovery-manifest|user-need [--json]
  agentmo validate <blueprint.json> --digest blueprint=sha256:<64hex>
  agentmo report <blueprint.json> --digest blueprint=sha256:<64hex> [--discovery-manifest <discovery.json> --digest discovery-manifest=sha256:<64hex>] [--json]
  agentmo discover-report <discovery.json> --digest discovery-manifest=sha256:<64hex> [--json]
  agentmo discover-pack <discovery.json> --digest discovery-manifest=sha256:<64hex> --out <dir> [--json]
  agentmo discover-workspace <discovery.json> --digest discovery-manifest=sha256:<64hex> --source-root <dir> --out <dir> [--json]
  agentmo need-report <need.json> --digest user-need=sha256:<64hex> [--json]
  agentmo design-plan <agentmo-discovery-db.json> --need <need.json> --digest discovery-db=sha256:<64hex> --digest user-need=sha256:<64hex> --out <agentmo-design-plan.json> [--target agentmo|openclaw] [--json]
  agentmo blueprint-draft <agentmo-discovery-db.json> --need <need.json> --digest discovery-db=sha256:<64hex> --digest user-need=sha256:<64hex> [--design-plan <agentmo-design-plan.json> --digest design-plan=sha256:<64hex>] --out <blueprint.json> [--target agentmo|openclaw] [--json]
  agentmo handoff <blueprint.json> --digest blueprint=sha256:<64hex> --target agentmo|openclaw --out <dir> [--json]
  agentmo status <blueprint.json> --digest blueprint=sha256:<64hex> [--build-state <path> --digest build-state=sha256:<64hex>] [--run-state <path> --digest run-state=sha256:<64hex>|--run-dir <dir> --digest run-index=sha256:<64hex> --digest run-state=sha256:<64hex>] [--json]
  agentmo plan <blueprint.json> --digest blueprint=sha256:<64hex> [--target agentmo|openclaw] [--json]
  agentmo run-plan <blueprint.json> --digest blueprint=sha256:<64hex> --target openclaw --workspace <dir> [--agent <id>] [--session-key <key>|--session-id <id>|--to <dest>] (--message <text>|--message-file <path>) [--runtime-env-file <path>] [--provider <name>] [--model <name>] [--thinking off|minimal|low|medium|high|adaptive|xhigh|max] [--channel <name>] [--transport gateway|local|embedded-fallback|unknown] [--fallback-from <runtime>] [--openclaw-state-dir <dir>|--use-production-openclaw-state] [--timeout-ms <ms>] [--json]
  agentmo run <runtime-plan.json> --digest runtime-plan=sha256:<64hex> [--digest run-index=sha256:<64hex>] --workspace <dir> (--message <text>|--message-file <path>) --out <dir> [--runtime-env-file <path>] [--openclaw-source-root <dir>] [--openclaw-state-dir <dir>] [--live] [--json]
  agentmo run-report <run-state.json> --digest run-state=sha256:<64hex> [--json]
  agentmo replay-run <run-state.json> --digest run-state=sha256:<64hex> [--digest run-index=sha256:<64hex>] --out <dir> [--message <text>|--message-file <path>] [--workspace <dir>] [--openclaw-source-root <dir>] [--openclaw-state-dir <dir>] [--runtime-env-file <path>] [--require-exact-replay] [--resume-session] [--live] [--json]
  agentmo run-eval <run-state.json> --digest run-state=sha256:<64hex> [--message <text>|--message-file <path>] [--expect-status success|failure|declared] [--require-exact-replay] [--json]
  agentmo birth-report <blueprint.json> --digest blueprint=sha256:<64hex> --build-state <agentmo-build-state.json> --digest build-state=sha256:<64hex> --run-state <agentmo-run-state.json> --digest run-state=sha256:<64hex> --run-eval <run-eval.json> --digest run-eval=sha256:<64hex> --expect-status success|declared|failure [--json]
  agentmo domain-eval <blueprint.json> --digest blueprint=sha256:<64hex> --cases <cases.json> --digest domain-cases=sha256:<64hex> [--target agentmo|openclaw] [--json]
  agentmo delivery-report <blueprint.json> --digest blueprint=sha256:<64hex> --build-state <agentmo-build-state.json> --digest build-state=sha256:<64hex> --run-state <agentmo-run-state.json> --digest run-state=sha256:<64hex> --run-eval <run-eval.json> --digest run-eval=sha256:<64hex> --birth-report <birth-report.json> --digest birth-report=sha256:<64hex> [--domain-eval <domain-eval.json> --digest domain-eval=sha256:<64hex>] [--json]
  agentmo observe-run <run-state.json> --digest run-state=sha256:<64hex> --out <observation.json> [--json]
  agentmo scaffold <blueprint.json> --digest blueprint=sha256:<64hex> --out <dir> [--target agentmo|openclaw] [--force]
  agentmo observe <observation.json> --digest observation=sha256:<64hex> [--json]

Concepts:
  builder          Start or inspect the single Discover -> Plan -> Produce Builder lifecycle.
  migrate          Preview or explicitly apply a value-blind legacy artifact migration.
  runtime-check    Inspect the current process against the OpenClaw target runtime contract.
  artifact-contract  Export a field-level JSON Schema and valid minimal template for an operator-authored artifact.
  validate         Check an AgentMo blueprint and its quality gates.
  report           Build a human or JSON AgentMo readiness report.
  discover-report  Validate and summarize a discovery/input manifest.
  discover-pack    Materialize a sanitized discovery database, facts JSONL, and coverage report.
  discover-workspace  Read approved repo-bound local sources into sanitized Stage 1 discovery artifacts.
  need-report      Validate and summarize a concrete user-need brief.
  design-plan      Produce a Stage 2 planning contract from discovery DB plus user need.
  blueprint-draft  Draft a valid AgentMo blueprint from discovery data plus user need, optionally gated by design-plan.
  handoff          Write a coding/runtime handoff package for the generated blueprint.
  status           Build an auditable control snapshot from blueprint plus optional build/run state.
  plan             Dry-run deterministic scaffold operations without writing files.
  run-plan         Dry-run OpenClaw runtime command/evidence planning without executing OpenClaw.
  run              Write bounded OpenClaw run-state evidence; an existing output index requires its exact run-index digest.
  run-report       Summarize run-state evidence without changing blueprint status.
  replay-run       Reconstruct a prior run; an existing output index requires its exact run-index digest.
  run-eval         Evaluate evidence completeness without certifying runtime/domain behavior.
  birth-report     Fail-closed birth gate over blueprint, build-state, run-state, and run-eval evidence.
  domain-eval      Evaluate deterministic domain cases with bounded evidence refs; certifies only supplied cases.
  delivery-report  Re-validate and aggregate delivery closure evidence; does not itself certify runtime/domain-wide/production.
  observe-run      Convert run-state evidence into a proposal-only observation record.
  scaffold         Generate a domain-agent harness. Use --target openclaw for an OpenClaw workspace scaffold.
  observe          Validate and summarize an observe/evolve record without applying changes.
`;
}

function commandHelpText(command) {
  const entries = {
    "artifact-contract": `AgentMo artifact-contract
Usage: agentmo artifact-contract discovery-manifest|user-need [--json]
Exports the complete field-level JSON Schema and a valid minimal template.
`,
    "discover-report": `AgentMo discover-report
Usage: agentmo discover-report <discovery.json> --digest discovery-manifest=sha256:<64hex> [--json]
Contract: agentmo artifact-contract discovery-manifest --json
Valid example: examples/support-triage.discovery.json
`,
    "discover-pack": `AgentMo discover-pack
Usage: agentmo discover-pack <discovery.json> --digest discovery-manifest=sha256:<64hex> --out <dir> [--json]
Contract: agentmo artifact-contract discovery-manifest --json
This is manifest materialization only; it does not crawl or fetch source locations.
`,
    "discover-workspace": `AgentMo discover-workspace
Usage: agentmo discover-workspace <discovery.json> --digest discovery-manifest=sha256:<64hex> --source-root <dir> --out <dir> [--json]
Contract: agentmo artifact-contract discovery-manifest --json
Only approved repo-bound local files are read.
`,
    "need-report": `AgentMo need-report
Usage: agentmo need-report <need.json> --digest user-need=sha256:<64hex> [--json]
Contract: agentmo artifact-contract user-need --json
Valid example: examples/support-triage.need.json
`,
  };
  return Object.hasOwn(entries, command) ? entries[command] : null;
}
