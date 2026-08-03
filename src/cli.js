import { dirname, isAbsolute, relative, resolve, win32 } from "node:path";
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
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
  admitNativePluginRecipe,
  buildBuildContract,
  writeBuildContract,
} from "./build-contract.js";
import {
  buildOpenClawTargetCarrierAdmission,
  writeOpenClawTargetCarrierAdmission,
} from "./openclaw-target-admission.js";
import {
  buildOpenClawTargetDescriptor,
  writeOpenClawTargetDescriptor,
} from "./openclaw-target-descriptor.js";
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
import {
  appendDecisionEntry,
  loadDecisionLedger,
} from "./decision-ledger.js";
import { buildDesignPlan, buildDesignPlanReport, formatDesignPlanReport, writeDesignPlan } from "./design-plan.js";
import {
  buildDiscoveryApproval,
  buildDiscoveryApprovalPreview,
  writeDiscoveryApproval,
} from "./discovery-approval.js";
import { buildDiscoveryPack, formatDiscoveryPack, writeDiscoveryPack } from "./discovery-db.js";
import { buildDiscoveryLive, formatDiscoveryLive, writeDiscoveryLive } from "./discovery-live.js";
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
import {
  buildPlanApproval,
  buildPlanApprovalPreview,
  writePlanApproval,
} from "./plan-approval.js";
import { produceAgentPackage } from "./package-produce.js";
import {
  admitPackageArchiveManifest,
  readPackageArchiveInventory,
} from "./package-archive.js";
import {
  formatAgentPackageInspection,
  inspectAgentPackage,
} from "./package-inspect.js";
import { probeOpenClawTarget } from "./openclaw-probe.js";
import { validateOpenClawProbe } from "./openclaw-probe-contract.js";
import {
  buildOpenClawAbsentGenesisAuthority,
  buildOpenClawInstallPlan,
  verifyOpenClawAbsentGenesisAuthority,
  writeOpenClawAbsentGenesisAuthority,
  writeOpenClawInstallPlan,
} from "./openclaw-install-plan.js";
import {
  buildOpenClawConflictApproval,
  buildOpenClawInstallApproval,
  buildOpenClawSensitiveActionDecision,
  writeOpenClawInstallReviewDecisions,
} from "./openclaw-install-approval.js";
import {
  formatOpenClawInstallReceipt,
} from "./openclaw-install-receipt.js";
import {
  loadOpenClawAuthorityRootBinding,
} from "./openclaw-authority-root-binding.js";
import {
  admitOpenClawInstallReceiptWithCompanions,
  applyOpenClawInstallPlan,
  validateOpenClawInstallReceiptCompanionBindings,
} from "./openclaw-install-transaction.js";
import {
  buildOpenClawFsKernel,
  openOpenClawSafeFsSession,
} from "./openclaw-safe-fs.js";
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
  "discover-live": "artifact",
  "discover-workspace": "artifact",
  "discovery-approve": "artifact",
  "need-report": "artifact",
  "decision-ledger": "artifact",
  "design-plan": "artifact",
  "blueprint-draft": "artifact",
  "build-contract": "artifact",
  "openclaw-target-describe": "artifact",
  "plan-approve": "artifact",
  "openclaw-target-admit": "artifact",
  "package-produce": "artifact",
  "package-inspect": "non-artifact",
  "openclaw-probe": "artifact",
  "openclaw-install-genesis": "artifact",
  "openclaw-install-preview": "artifact",
  "openclaw-install-approve": "artifact",
  "openclaw-install-apply": "artifact",
  "openclaw-fs-kernel-build": "artifact",
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
  "--agent", "--archive", "--archive-sha256", "--birth-report", "--blueprint", "--blueprint-sha256", "--build-contract", "--build-contract-sha256", "--build-state", "--cases", "--channel", "--checkpoint", "--decision-ledger", "--design-plan", "--digest",
  "--discovery-approval", "--discovery-db", "--discovery-manifest", "--domain-eval", "--runtime-env-file", "--expect-status", "--fallback-from", "--manifest", "--message",
  "--entry", "--event", "--event-id", "--expected-head-digest", "--host", "--host-scope", "--journal", "--message-file", "--model", "--native-plugin-recipe", "--need", "--openclaw-source-root", "--openclaw-state-dir", "--openclaw-target-root", "--out",
  "--manifest-sha256", "--plan", "--plan-digest", "--project", "--provider", "--run-dir", "--run-eval", "--run-state", "--session-id", "--session-key", "--source-root",
  "--consumer", "--plan-approval", "--plan-approval-sha256", "--preview-digest", "--receipt-digest", "--target", "--target-carrier-admission", "--target-carrier-admission-sha256", "--target-descriptor", "--target-descriptor-sha256", "--target-executable", "--target-package-json", "--target-build-info", "--target-root", "--thinking", "--timeout-ms", "--to", "--transport", "--workspace",
  "--probe", "--probe-sha256", "--request-sha256", "--lifecycle",
  "--absent-genesis", "--absent-genesis-sha256",
  "--current-receipt", "--current-receipt-sha256",
  "--predecessor-receipt", "--predecessor-receipt-sha256",
  "--predecessor-archive", "--predecessor-archive-sha256",
  "--plan-sha256", "--ordinary-out", "--sensitive-out", "--conflict-out",
  "--install-plan", "--install-plan-sha256",
  "--ordinary-approval", "--ordinary-approval-sha256",
  "--sensitive-decision", "--sensitive-decision-sha256",
  "--conflict-approval", "--conflict-approval-sha256",
  "--binary-out", "--receipt-out",
  "--fs-helper", "--fs-helper-receipt", "--fs-helper-receipt-digest",
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

  if (command === "openclaw-fs-kernel-build") {
    const options = parseOpenClawFsKernelBuildArgs(rest);
    const result = await buildOpenClawFsKernel({
      binaryOut: options.binaryOut,
      receiptOut: options.receiptOut,
    });
    await emitArtifactOutput({
      schemaVersion: "agentmo.openclaw-fs-kernel-build-output.v1",
      receiptDigest: result.receiptDigest,
      pair: result.pair,
      buildOnly: true,
    }, {
      json: options.json,
      subject: "openclaw-fs-kernel-build-output",
      format: (value) => `${value.receiptDigest}\n`,
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

  if (command === "discover-live") {
    const options = parseDiscoverLiveArgs(rest);
    const manifest = await loadDiscoveryManifest(options.file, {
      subject: "discovery-manifest",
      expectedDigest: options.digests["discovery-manifest"],
    });
    const live = await buildDiscoveryLive(manifest, { manifestPath: options.file });
    const paths = await writeDiscoveryLive(options.out, live);
    const result = { ...live, paths };
    await emitArtifactOutput(result, {
      json: options.json,
      subject: "discovery-live-output",
      format: (value) => formatDiscoveryLive(value, value.paths),
    });
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

  if (command === "discovery-approve") {
    const options = parseDiscoveryApproveArgs(rest);
    const discoveryManifestAdmission = await loadAdmittedArtifact({
      filePath: options.file,
      subject: "discovery-manifest",
      expectedDigest: options.digests["discovery-manifest"],
    });
    const discoveryDbAdmission = await loadAdmittedArtifact({
      filePath: options.discoveryDb,
      subject: "discovery-db",
      expectedDigest: options.digests["discovery-db"],
    });
    const inputs = {
      admissions: {
        discoveryManifest: discoveryManifestAdmission,
        discoveryDb: discoveryDbAdmission,
      },
    };
    if (!options.approve) {
      const preview = buildDiscoveryApprovalPreview(
        discoveryManifestAdmission.value,
        discoveryDbAdmission.value,
        inputs,
      );
      await emitArtifactOutput(preview, {
        json: options.json,
        subject: "discovery-approval-preview",
        format: (value) => `${value.previewDigest}\n`,
      });
      return;
    }
    const approval = buildDiscoveryApproval(
      discoveryManifestAdmission.value,
      discoveryDbAdmission.value,
      {
        ...inputs,
        approve: true,
        previewDigest: options.previewDigest,
      },
    );
    await writeDiscoveryApproval(options.out, approval);
    await emitArtifactOutput(approval, {
      json: options.json,
      subject: "discovery-approval",
      format: (value) => `${value.schemaVersion} ${value.decisionScope}\n`,
    });
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

  if (command === "decision-ledger") {
    const options = parseDecisionLedgerArgs(rest);
    if (options.action === "inspect") {
      const ledger = await loadDecisionLedger({
        journalPath: options.journal,
        expectedHeadDigest: options.digests["decision-ledger"],
      });
      await emitArtifactOutput(decisionLedgerSummary(ledger), {
        json: options.json,
        subject: "decision-ledger-output",
        format: formatDecisionLedgerSummary,
      });
      return;
    }
    const entryAdmission = await loadAdmittedArtifact({
      filePath: options.entry,
      subject: "decision-entry",
      expectedDigest: options.digests["decision-entry"],
    });
    const { schemaVersion: _schemaVersion, ...entry } = entryAdmission.value;
    const appended = await appendDecisionEntry({
      journalPath: options.journal,
      expectedHeadDigest: options.expectedHeadDigest,
      entry,
    });
    const ledger = await loadDecisionLedger({
      journalPath: options.journal,
      expectedHeadDigest: appended.head.digest,
    });
    await emitArtifactOutput(decisionLedgerSummary(ledger), {
      json: options.json,
      subject: "decision-ledger-output",
      format: formatDecisionLedgerSummary,
    });
    return;
  }

  if (command === "design-plan") {
    const options = parseDesignPlanArgs(rest);
    const discoveryManifestAdmission = await loadAdmittedArtifact({
      filePath: options.manifest,
      subject: "discovery-manifest",
      expectedDigest: options.digests["discovery-manifest"],
    });
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
    const discoveryApprovalAdmission = await loadAdmittedArtifact({
      filePath: options.discoveryApproval,
      subject: "discovery-approval",
      expectedDigest: options.digests["discovery-approval"],
      companions: {
        "discovery-manifest": discoveryManifestAdmission,
        "discovery-db": discoveryDbAdmission,
      },
    });
    const decisionLedger = await loadDecisionLedger({
      journalPath: options.decisionLedger,
      expectedHeadDigest: options.digests["decision-ledger"],
    });
    const designPlan = buildDesignPlan(discoveryDbAdmission.value, userNeedAdmission.value, {
      target: options.target,
      manifest: discoveryManifestAdmission.value,
      discoveryApproval: discoveryApprovalAdmission.value,
      decisionLedger,
      admissions: {
        discoveryManifest: discoveryManifestAdmission,
        discoveryDb: discoveryDbAdmission,
        discoveryApproval: discoveryApprovalAdmission,
        userNeed: userNeedAdmission,
        decisionLedger,
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

  if (command === "build-contract") {
    const options = parseBuildContractArgs(rest);
    const blueprintAdmission = await loadAdmittedBlueprint(options.file, {
      subject: "blueprint",
      expectedDigest: options.digests.blueprint,
    });
    const designPlanAdmission = await loadAdmittedArtifact({
      filePath: options.designPlan,
      subject: "design-plan",
      expectedDigest: options.digests["design-plan"],
    });
    const discoveryApprovalAdmission = await loadAdmittedArtifact({
      filePath: options.discoveryApproval,
      subject: "discovery-approval",
      expectedDigest: options.digests["discovery-approval"],
      companions: { "design-plan": designPlanAdmission },
    });
    const decisionLedger = await loadDecisionLedger({
      journalPath: options.decisionLedger,
      expectedHeadDigest: options.digests["decision-ledger"],
    });
    const targetDescriptorAdmission = await loadAdmittedArtifact({
      filePath: options.targetDescriptor,
      subject: "openclaw-target-descriptor",
      expectedDigest: options.digests["openclaw-target-descriptor"],
    });
    const nativePluginRecipeAdmission = options.nativePluginRecipe
      ? await admitNativePluginRecipe({
          filePath: options.nativePluginRecipe,
          expectedDigest: options.digests["native-plugin-recipe"],
        })
      : null;
    const contract = buildBuildContract(
      blueprintAdmission.value,
      designPlanAdmission.value,
      discoveryApprovalAdmission.value,
      decisionLedger,
      {
        target: options.target,
        admissions: {
          blueprint: blueprintAdmission,
          designPlan: designPlanAdmission,
          discoveryApproval: discoveryApprovalAdmission,
          decisionLedger,
          targetDescriptor: targetDescriptorAdmission,
        },
        ...(nativePluginRecipeAdmission ? {
          nativePluginRecipe: nativePluginRecipeAdmission.value,
          nativePluginRecipeAdmission,
        } : {}),
      },
    );
    await writeBuildContract(options.out, contract);
    await emitArtifactOutput(contract, {
      json: options.json,
      subject: "build-contract",
      format: formatBuildContract,
    });
    return;
  }

  if (command === "openclaw-target-describe") {
    const options = parseOpenClawTargetDescribeArgs(rest);
    const descriptor = await buildOpenClawTargetDescriptor({
      executablePath: options.targetExecutable,
      packageJsonPath: options.targetPackageJson,
      buildInfoPath: options.targetBuildInfo,
      digests: {
        "target-executable": options.digests["target-executable"],
        "target-package-json": options.digests["target-package-json"],
        "target-build-info": options.digests["target-build-info"],
      },
    });
    await writeOpenClawTargetDescriptor(options.out, descriptor, {
      helperPath: options.fsHelper,
      receiptPath: options.fsHelperReceipt,
      receiptDigest: options.fsHelperReceiptDigest,
    });
    const bytes = Buffer.from(serializePersistableJson(descriptor, {
      subject: "openclaw-target-descriptor",
    }), "utf8");
    await emitArtifactOutput({ descriptor, digest: digestRawBytes(bytes) }, {
      json: options.json,
      subject: "openclaw-target-descriptor-output",
      format: (value) => `${value.digest}\n`,
    });
    return;
  }

  if (command === "openclaw-target-admit") {
    const options = parseOpenClawTargetAdmitArgs(rest);
    const blueprintAdmission = await loadAdmittedBlueprint(options.file, {
      subject: "blueprint",
      expectedDigest: options.digests.blueprint,
    });
    const buildContractAdmission = await loadAdmittedArtifact({
      filePath: options.buildContract,
      subject: "build-contract",
      expectedDigest: options.digests["build-contract"],
    });
    const planApprovalAdmission = await loadAdmittedArtifact({
      filePath: options.planApproval,
      subject: "plan-approval",
      expectedDigest: options.digests["plan-approval"],
    });
    const targetDescriptorAdmission = await loadAdmittedArtifact({
      filePath: options.targetDescriptor,
      subject: "openclaw-target-descriptor",
      expectedDigest: options.digests["openclaw-target-descriptor"],
    });
    const admission = await buildOpenClawTargetCarrierAdmission({
      blueprint: blueprintAdmission.value,
      buildContract: buildContractAdmission.value,
      planApproval: planApprovalAdmission.value,
      admissions: {
        blueprint: blueprintAdmission,
        buildContract: buildContractAdmission,
        planApproval: planApprovalAdmission,
        targetDescriptor: targetDescriptorAdmission,
      },
      target: {
        executablePath: options.targetExecutable,
        executableDigest: options.digests["target-executable"],
        packageJsonPath: options.targetPackageJson,
        packageJsonDigest: options.digests["target-package-json"],
        buildInfoPath: options.targetBuildInfo,
        buildInfoDigest: options.digests["target-build-info"],
      },
    });
    await writeOpenClawTargetCarrierAdmission(options.out, admission, {
      helperPath: options.fsHelper,
      receiptPath: options.fsHelperReceipt,
      receiptDigest: options.fsHelperReceiptDigest,
    });
    const bytes = Buffer.from(serializePersistableJson(admission, {
      subject: "openclaw-target-carrier-admission",
    }), "utf8");
    await emitArtifactOutput({
      admission,
      digest: digestRawBytes(bytes),
    }, {
      json: options.json,
      subject: "openclaw-target-carrier-admission-output",
      format: (value) => `${value.digest}\n`,
    });
    return;
  }

  if (command === "package-produce") {
    const options = parsePackageProduceArgs(rest);
    const result = await produceAgentPackage({
      artifacts: {
        blueprint: artifactBinding(options.file, options.digests.blueprint),
        designPlan: artifactBinding(options.designPlan, options.digests["design-plan"]),
        discoveryApproval: artifactBinding(
          options.discoveryApproval,
          options.digests["discovery-approval"],
        ),
        decisionLedger: artifactBinding(options.decisionLedger, options.digests["decision-ledger"]),
        buildContract: artifactBinding(options.buildContract, options.digests["build-contract"]),
        planApproval: artifactBinding(options.planApproval, options.digests["plan-approval"]),
        targetDescriptor: artifactBinding(
          options.targetDescriptor,
          options.digests["openclaw-target-descriptor"],
        ),
        targetCarrierAdmission: artifactBinding(
          options.targetCarrierAdmission,
          options.digests["openclaw-target-carrier-admission"],
        ),
      },
      outputRoot: options.out,
      archivePath: options.archive,
      helperPath: options.fsHelper,
      receiptPath: options.fsHelperReceipt,
      receiptDigest: options.fsHelperReceiptDigest,
    });
    const report = {
      schemaVersion: result.schemaVersion,
      archiveDigest: result.archiveDigest,
      manifestDigest: result.manifestDigest,
      inventoryDigest: result.inventoryDigest,
      certificationBoundary: result.certificationBoundary,
    };
    await emitArtifactOutput(report, {
      json: options.json,
      subject: "package-produce-output",
      format: (value) => `${value.archiveDigest}\n`,
    });
    return;
  }

  if (command === "package-inspect") {
    const options = parsePackageInspectArgs(rest);
    const inspection = await inspectAgentPackage({
      packagePath: options.file,
      ...(options.archiveDigest === null
        ? { expectedManifestDigest: options.manifestDigest }
        : { expectedArchiveDigest: options.archiveDigest }),
    });
    await emitNonArtifactOutput(inspection, {
      json: options.json,
      subject: "package-inspection",
      format: formatAgentPackageInspection,
    });
    return;
  }

  if (command === "openclaw-probe") {
    const options = parseOpenClawProbeArgs(rest);
    try {
      await lstat(options.out);
      throw cliError("AGENTMO_CLI_OUTPUT_REJECTED");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const probe = await probeOpenClawTarget({
      archivePath: options.archive,
      expectedArchiveDigest: options.archiveDigest,
      blueprintPath: options.blueprint,
      expectedBlueprintDigest: options.blueprintDigest,
      buildContractPath: options.buildContract,
      expectedBuildContractDigest: options.buildContractDigest,
      planApprovalPath: options.planApproval,
      expectedPlanApprovalDigest: options.planApprovalDigest,
      targetCarrierAdmissionPath: options.targetCarrierAdmission,
      expectedTargetCarrierAdmissionDigest: options.targetCarrierAdmissionDigest,
      targetDescriptorPath: options.targetDescriptor,
      expectedTargetDescriptorDigest: options.targetDescriptorDigest,
      targetRoot: options.targetRoot,
    });
    try {
      await writeFile(
        options.out,
        serializePersistableJson(probe, { subject: "openclaw-probe" }),
        { encoding: "utf8", flag: "wx", mode: 0o600 },
      );
    } catch {
      throw cliError("AGENTMO_CLI_OUTPUT_REJECTED");
    }
    await emitArtifactOutput(probe, {
      json: options.json,
      subject: "openclaw-probe",
      format: formatOpenClawProbe,
    });
    return;
  }

  if (command === "openclaw-install-genesis") {
    const options = parseOpenClawInstallGenesisArgs(rest);
    const archive = await admitPackageArchiveManifest({
      archivePath: options.archive,
      expectedArchiveDigest: options.archiveDigest,
    });
    const probe = await loadExactOpenClawProbe(options, archive);
    const request = await loadExactLifecycleJson(
      options.request,
      options.requestDigest,
      () => ({ ok: true }),
    );
    assertLifecycleTargetMatchesProbe(request.target, probe);
    const session = await openOpenClawSafeFsSession({
      rootPath: options.targetRoot,
      helperPath: options.fsHelper,
      receiptPath: options.fsHelperReceipt,
      receiptDigest: options.fsHelperReceiptDigest,
    });
    let authority;
    try {
      authority = await buildOpenClawAbsentGenesisAuthority({
        target: request.target,
        operations: request.operations,
        observedAt: request.observedAt,
        session,
      });
    } finally {
      await session.close();
    }
    const written = await writeOpenClawAbsentGenesisAuthority(
      options.out,
      authority,
    );
    await emitArtifactOutput({ authority, digest: written.digest }, {
      json: options.json,
      subject: "openclaw-absent-genesis-output",
      format: (value) => `${value.digest}\n`,
    });
    return;
  }

  if (command === "openclaw-install-preview") {
    const options = await parseOpenClawInstallPreviewArgs(rest);
    const archiveInventory = await admitPackageArchiveManifest({
      archivePath: options.archive,
      expectedArchiveDigest: options.archiveDigest,
    });
    const probe = await loadExactOpenClawProbe(options, archiveInventory);
    const request = await loadExactLifecycleJson(
      options.request,
      options.requestDigest,
      () => ({ ok: true }),
    );
    assertLifecycleTargetMatchesProbe(request.target, probe);
    const authorityRootBinding = (await loadOpenClawAuthorityRootBinding(
      options.authorityRootBinding,
      options.authorityRootBindingDigest,
    )).value;
    const basis = await loadLifecycleBasis(options, authorityRootBinding);
    if (options.lifecycle === "install") {
      const session = await openOpenClawSafeFsSession({
        rootPath: options.targetRoot,
        helperPath: options.fsHelper,
        receiptPath: options.fsHelperReceipt,
        receiptDigest: options.fsHelperReceiptDigest,
      });
      try {
        await verifyOpenClawAbsentGenesisAuthority({
          authority: basis.absentGenesis,
          operations: request.operations,
          session,
        });
      } finally {
        await session.close();
      }
    }
    const plan = buildOpenClawInstallPlan({
      lifecycle: options.lifecycle,
      archiveBinding: {
        archiveSha256: options.archiveDigest,
        manifestDigest: archiveInventory.manifestDigest,
        inventoryDigest: archiveInventory.inventoryDigest,
        members: archiveInventory.members,
      },
      authorityRootBinding,
      target: request.target,
      operations: request.operations,
      sensitiveActions: request.sensitiveActions,
      conflicts: request.conflicts,
      officialConfigDryRun: request.officialConfigDryRun,
      ...basis,
    });
    const written = await writeOpenClawInstallPlan(options.out, plan);
    await emitArtifactOutput({ plan, digest: written.digest }, {
      json: options.json,
      subject: "openclaw-install-plan-output",
      format: (value) => `${value.digest}\n`,
    });
    return;
  }

  if (command === "openclaw-install-approve") {
    const options = parseOpenClawInstallApproveArgs(rest);
    const planAdmission = await loadAdmittedArtifact({
      filePath: options.plan,
      subject: "openclaw-install-plan",
      expectedDigest: options.planDigest,
    });
    const request = await loadExactLifecycleJson(
      options.request,
      options.requestDigest,
      () => ({ ok: true }),
    );
    const plan = planAdmission.value;
    const common = {
      decision: "approve",
      issuedAt: request.issuedAt,
      expiresAt: request.expiresAt,
    };
    const ordinary = buildOpenClawInstallApproval({
      plan,
      ...common,
      useNonce: `${request.noncePrefix}:ordinary`,
    });
    const sensitive = plan.sensitiveActions.map((action, index) => ({
      filePath: options.sensitiveOutputs[index],
      action,
      candidate: buildOpenClawSensitiveActionDecision({
        plan,
        action,
        ...common,
        useNonce: `${request.noncePrefix}:sensitive:${index}`,
      }),
    }));
    const conflict = buildOpenClawConflictApproval({
      plan,
      conflicts: plan.conflicts,
      ...common,
      useNonce: `${request.noncePrefix}:conflict-set`,
    });
    const written = await writeOpenClawInstallReviewDecisions({
      plan,
      outputs: {
        ordinary: {
          filePath: options.ordinaryOut,
          candidate: ordinary,
        },
        sensitive,
        conflict: {
          filePath: options.conflictOut,
          candidate: conflict,
        },
      },
      validation: {
        now: request.validationNow,
      },
    });
    await emitArtifactOutput({
      installPlanDigest: plan.installPlanDigest,
      outputs: written.map(({ digest }, index) => ({
        subject: index === 0
          ? "openclaw-install-approval"
          : index === written.length - 1
            ? "openclaw-conflict-approval"
            : "openclaw-sensitive-action-decision",
        digest,
      })),
      certificationBoundary: {
        authorityPublicationOnly: true,
        installed: false,
        runtime: false,
        domain: false,
        production: false,
      },
    }, {
      json: options.json,
      subject: "openclaw-install-approval-output",
      format: (value) => `${value.installPlanDigest}\n`,
    });
    return;
  }

  if (command === "openclaw-install-apply") {
    const options = await parseOpenClawInstallApplyArgs(rest);
    const result = await applyOpenClawInstallPlan({
      blueprintPath: options.blueprint,
      blueprintDigest: options.blueprintDigest,
      buildContractPath: options.buildContract,
      buildContractDigest: options.buildContractDigest,
      planApprovalPath: options.planApproval,
      planApprovalDigest: options.planApprovalDigest,
      targetDescriptorPath: options.targetDescriptor,
      targetDescriptorDigest: options.targetDescriptorDigest,
      targetCarrierAdmissionPath: options.targetCarrierAdmission,
      targetCarrierAdmissionDigest: options.targetCarrierAdmissionDigest,
      archivePath: options.archive,
      archiveDigest: options.archiveDigest,
      probePath: options.probe,
      probeDigest: options.probeDigest,
      installPlanPath: options.installPlan,
      installPlanDigest: options.installPlanDigest,
      installApprovalPath: options.ordinaryApproval,
      installApprovalDigest: options.ordinaryApprovalDigest,
      sensitiveDecisions: options.sensitiveDecisions,
      conflictApprovalPath: options.conflictApproval,
      conflictApprovalDigest: options.conflictApprovalDigest,
      absentGenesisPath: options.absentGenesis,
      absentGenesisDigest: options.absentGenesisDigest,
      currentReceiptPath: options.currentReceipt,
      currentReceiptDigest: options.currentReceiptDigest,
      currentReceiptCompanions: options.currentReceiptCompanions,
      selectedPredecessorReceiptPath: options.predecessorReceipt,
      selectedPredecessorReceiptDigest: options.predecessorReceiptDigest,
      selectedPredecessorReceiptCompanions:
        options.predecessorReceiptCompanions,
      selectedPredecessorArchivePath: options.predecessorArchive,
      selectedPredecessorArchiveDigest: options.predecessorArchiveDigest,
      openClawTargetRoot: options.openClawTargetRoot,
      targetRoot: options.targetRoot,
      outputPath: options.out,
      helperPath: options.fsHelper,
      receiptPath: options.fsHelperReceipt,
      receiptDigest: options.fsHelperReceiptDigest,
      attemptId: options.attemptId,
      authorityRootBindingPath: options.authorityRootBinding,
      authorityRootBindingDigest: options.authorityRootBindingDigest,
      authorityStateRoot: await derivePublicOpenClawAuthorityStateRoot(
        options.openClawTargetRoot,
        options.targetDescriptorDigest,
      ),
    });
    await emitArtifactOutput({
      receipt: result.receipt,
      digest: result.digest,
      postEffectProvenance: structuredClone(
        result.receipt.postEffectEvidence,
      ),
      certificationBoundary: {
        lifecycleEvidenceOnly: true,
        runtime: false,
        domain: false,
        birth: false,
        delivery: false,
        production: false,
      },
    }, {
      json: options.json,
      subject: "openclaw-install-apply-output",
      format: (value) => formatOpenClawInstallReceipt(
        value.receipt,
        value.digest,
      ),
    });
    return;
  }

  if (command === "plan-approve") {
    const options = parsePlanApproveArgs(rest);
    const blueprintAdmission = await loadAdmittedBlueprint(options.file, {
      subject: "blueprint",
      expectedDigest: options.digests.blueprint,
    });
    const buildContractAdmission = await loadAdmittedArtifact({
      filePath: options.buildContract,
      subject: "build-contract",
      expectedDigest: options.digests["build-contract"],
    });
    const inputs = {
      admissions: {
        blueprint: blueprintAdmission,
        buildContract: buildContractAdmission,
      },
    };
    if (!options.approve) {
      const preview = buildPlanApprovalPreview(
        blueprintAdmission.value,
        buildContractAdmission.value,
        inputs,
      );
      await emitArtifactOutput(preview, {
        json: options.json,
        subject: "plan-approval-preview",
        format: (value) => `${value.previewDigest}\n`,
      });
      return;
    }
    const approval = buildPlanApproval(
      blueprintAdmission.value,
      buildContractAdmission.value,
      {
        ...inputs,
        approve: true,
        previewDigest: options.previewDigest,
      },
    );
    await writePlanApproval(options.out, approval);
    await emitArtifactOutput(approval, {
      json: options.json,
      subject: "plan-approval",
      format: (value) => `${value.schemaVersion} ${value.decisionScope}\n`,
    });
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
  const recovery = boundedOpenClawFsBuildRecovery(error);
  return {
    schemaVersion: "agentmo.cli-error.v1",
    ok: false,
    code,
    category,
    guidance: validationDetails === null
      ? cliErrorGuidance(category, code)
      : `Correct the listed fields using \`agentmo artifact-contract ${validationDetails.subject} --json\`, then recompute the exact digest.`,
    ...(validationDetails ?? {}),
    ...(recovery === null ? {} : { recovery }),
  };
}

function boundedOpenClawFsBuildRecovery(error) {
  const recovery = error?.recovery;
  if (error?.code !== "AGENTMO_OPENCLAW_FS_BUILD_REJECTED"
    || !exactObjectKeys(recovery, [
      "schemaVersion",
      "failurePoint",
      "disposition",
      "retry",
      "sameParent",
      "parents",
      "members",
    ])
    || recovery.schemaVersion !== "agentmo.openclaw-fs-build-recovery.v1"
    || !/^[a-z0-9-]{1,64}$/u.test(recovery.failurePoint ?? "")
    || recovery.disposition !== "recovery-required"
    || recovery.retry !== "exact-pair-admission-required"
    || typeof recovery.sameParent !== "boolean"
    || !Array.isArray(recovery.parents)
    || recovery.parents.length !== 2
    || !Array.isArray(recovery.members)
    || recovery.members.length !== 2) {
    return null;
  }
  const parentRoles = ["binary-output-parent", "receipt-output-parent"];
  const parents = recovery.parents.map((entry, index) => {
    if (!exactObjectKeys(entry, [
      "role",
      "expectedIdentity",
      "observedIdentity",
      "disposition",
    ])
      || entry.role !== parentRoles[index]
      || !["bound", "replaced", "unknown"].includes(entry.disposition)) {
      return null;
    }
    const expectedIdentity = boundedSafeFsIdentity(entry.expectedIdentity, true);
    const observedIdentity = entry.observedIdentity === null
      ? null
      : boundedSafeFsIdentity(entry.observedIdentity, true);
    if (expectedIdentity === null
      || (entry.observedIdentity !== null && observedIdentity === null)) {
      return null;
    }
    return {
      role: entry.role,
      expectedIdentity,
      observedIdentity,
      disposition: entry.disposition,
    };
  });
  const memberRoles = ["helper-binary", "build-receipt"];
  const members = recovery.members.map((entry, index) => {
    if (!exactObjectKeys(entry, [
      "role",
      "state",
      "digest",
      "identity",
      "disposition",
    ])
      || entry.role !== memberRoles[index]
      || !["created", "preserved", "unknown"].includes(entry.state)
      || !["preserved", "absent", "unknown"].includes(entry.disposition)
      || (entry.digest !== null
        && !/^sha256:[a-f0-9]{64}$/u.test(entry.digest))
      || (entry.identity === null) !== (entry.digest === null)) {
      return null;
    }
    const identity = entry.identity === null
      ? null
      : boundedSafeFsIdentity(entry.identity, false);
    if (entry.identity !== null && identity === null) return null;
    return {
      role: entry.role,
      state: entry.state,
      digest: entry.digest,
      identity,
      disposition: entry.disposition,
    };
  });
  if (parents.includes(null) || members.includes(null)) return null;
  return {
    schemaVersion: recovery.schemaVersion,
    failurePoint: recovery.failurePoint,
    disposition: recovery.disposition,
    retry: recovery.retry,
    sameParent: recovery.sameParent,
    parents,
    members,
  };
}

function boundedSafeFsIdentity(value, directory) {
  const keys = directory
    ? ["device", "inode", "mode", "owner"]
    : [
        "device",
        "inode",
        "links",
        "mode",
        "owner",
        "size",
        "modifiedNs",
        "changedNs",
      ];
  if (!exactObjectKeys(value, keys)
    || !keys.filter((key) => key !== "mode").every(
      (key) => /^\d+$/u.test(value[key] ?? ""),
    )
    || !/^[0-7]{3,4}$/u.test(value.mode ?? "")) {
    return null;
  }
  return Object.fromEntries(keys.map((key) => [key, value[key]]));
}

function exactObjectKeys(value, keys) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
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
  if (envelope.recovery !== undefined) {
    lines.push(
      `Recovery: ${envelope.recovery.failurePoint} (${envelope.recovery.disposition})`,
    );
    for (const parent of envelope.recovery.parents) {
      const identity = parent.observedIdentity ?? parent.expectedIdentity;
      lines.push(
        `- ${parent.role}: ${parent.disposition} ${identity.device}:${identity.inode}`,
      );
    }
    for (const member of envelope.recovery.members) {
      const identity = member.identity === null
        ? "identity=unknown"
        : `identity=${member.identity.device}:${member.identity.inode}`;
      const digest = member.digest ?? "digest=unknown";
      lines.push(
        `- ${member.role}: ${member.state}/${member.disposition} ${identity} ${digest}`,
      );
    }
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

function parseDiscoverLiveArgs(args) {
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
      throw new Error(`Unknown discover-live option: ${arg}`);
    }
  }
  requireOptionValue(out, "--out");
  const digests = parseDigestBindings(digestBindings, subjectsForCommand("discover-live"));
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

function parseBuildContractArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing blueprint file path.");
  let designPlan = null;
  let discoveryApproval = null;
  let decisionLedger = null;
  let targetDescriptor = null;
  let out = null;
  let target = "openclaw";
  let nativePluginRecipe = null;
  let json = false;
  const digestBindings = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--design-plan") {
      designPlan = args[index + 1];
      index += 1;
    } else if (arg === "--discovery-approval") {
      discoveryApproval = args[index + 1];
      index += 1;
    } else if (arg === "--decision-ledger") {
      decisionLedger = args[index + 1];
      index += 1;
    } else if (arg === "--target-descriptor") {
      targetDescriptor = args[index + 1];
      index += 1;
    } else if (arg === "--out") {
      out = args[index + 1];
      index += 1;
    } else if (arg === "--target") {
      target = args[index + 1];
      index += 1;
    } else if (arg === "--native-plugin-recipe") {
      nativePluginRecipe = args[index + 1];
      index += 1;
    } else if (arg === "--digest") {
      digestBindings.push(requireDigestBinding(args[index + 1]));
      index += 1;
    } else if (arg === "--json") {
      json = true;
    } else {
      throw new Error(`Unknown build-contract option: ${arg}`);
    }
  }
  requireOptionValue(designPlan, "--design-plan");
  requireOptionValue(discoveryApproval, "--discovery-approval");
  requireOptionValue(decisionLedger, "--decision-ledger");
  requireOptionValue(targetDescriptor, "--target-descriptor");
  requireOptionValue(out, "--out");
  if (target !== "openclaw") throw new Error("build-contract target must be openclaw.");
  if ((nativePluginRecipe === null) !== !digestBindings.some((binding) => (
    binding.startsWith("native-plugin-recipe=")
  ))) {
    throw new Error("--native-plugin-recipe requires exactly one native-plugin-recipe digest.");
  }
  const digests = parseDigestBindings(digestBindings, subjectsForCommand("build-contract", {
    includeOptionalSubjects: nativePluginRecipe ? ["native-plugin-recipe"] : [],
  }));
  return {
    file: resolve(file),
    designPlan: resolve(designPlan),
    discoveryApproval: resolve(discoveryApproval),
    decisionLedger: resolve(decisionLedger),
    targetDescriptor: resolve(targetDescriptor),
    out: resolve(out),
    target,
    nativePluginRecipe: nativePluginRecipe ? resolve(nativePluginRecipe) : null,
    json,
    digests,
  };
}

function parseOpenClawTargetDescribeArgs(args) {
  let targetExecutable = null;
  let targetPackageJson = null;
  let targetBuildInfo = null;
  let out = null;
  let fsHelper = null;
  let fsHelperReceipt = null;
  let fsHelperReceiptDigest = null;
  let json = false;
  const digestBindings = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--target-executable") {
      targetExecutable = args[index + 1];
      index += 1;
    } else if (arg === "--target-package-json") {
      targetPackageJson = args[index + 1];
      index += 1;
    } else if (arg === "--target-build-info") {
      targetBuildInfo = args[index + 1];
      index += 1;
    } else if (arg === "--out") {
      out = args[index + 1];
      index += 1;
    } else if (arg === "--fs-helper") {
      fsHelper = args[index + 1];
      index += 1;
    } else if (arg === "--fs-helper-receipt") {
      fsHelperReceipt = args[index + 1];
      index += 1;
    } else if (arg === "--fs-helper-receipt-digest") {
      fsHelperReceiptDigest = args[index + 1];
      index += 1;
    } else if (arg === "--digest") {
      digestBindings.push(requireDigestBinding(args[index + 1]));
      index += 1;
    } else if (arg === "--json") {
      json = true;
    } else {
      throw new Error(`Unknown openclaw-target-describe option: ${arg}`);
    }
  }
  requireOptionValue(targetExecutable, "--target-executable");
  requireOptionValue(targetPackageJson, "--target-package-json");
  requireOptionValue(targetBuildInfo, "--target-build-info");
  requireOptionValue(out, "--out");
  requireOptionValue(fsHelper, "--fs-helper");
  requireOptionValue(fsHelperReceipt, "--fs-helper-receipt");
  requireOptionValue(fsHelperReceiptDigest, "--fs-helper-receipt-digest");
  const digests = parseDigestBindings(
    digestBindings,
    subjectsForCommand("openclaw-target-describe"),
  );
  return {
    targetExecutable: resolve(targetExecutable),
    targetPackageJson: resolve(targetPackageJson),
    targetBuildInfo: resolve(targetBuildInfo),
    out: resolve(out),
    fsHelper: resolve(fsHelper),
    fsHelperReceipt: resolve(fsHelperReceipt),
    fsHelperReceiptDigest,
    json,
    digests,
  };
}

function parseOpenClawTargetAdmitArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing blueprint file path.");
  let buildContract = null;
  let planApproval = null;
  let targetExecutable = null;
  let targetDescriptor = null;
  let targetPackageJson = null;
  let targetBuildInfo = null;
  let out = null;
  let fsHelper = null;
  let fsHelperReceipt = null;
  let fsHelperReceiptDigest = null;
  let json = false;
  const digestBindings = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--build-contract") {
      buildContract = args[index + 1];
      index += 1;
    } else if (arg === "--plan-approval") {
      planApproval = args[index + 1];
      index += 1;
    } else if (arg === "--target-executable") {
      targetExecutable = args[index + 1];
      index += 1;
    } else if (arg === "--target-descriptor") {
      targetDescriptor = args[index + 1];
      index += 1;
    } else if (arg === "--target-package-json") {
      targetPackageJson = args[index + 1];
      index += 1;
    } else if (arg === "--target-build-info") {
      targetBuildInfo = args[index + 1];
      index += 1;
    } else if (arg === "--out") {
      out = args[index + 1];
      index += 1;
    } else if (arg === "--fs-helper") {
      fsHelper = args[index + 1];
      index += 1;
    } else if (arg === "--fs-helper-receipt") {
      fsHelperReceipt = args[index + 1];
      index += 1;
    } else if (arg === "--fs-helper-receipt-digest") {
      fsHelperReceiptDigest = args[index + 1];
      index += 1;
    } else if (arg === "--digest") {
      digestBindings.push(requireDigestBinding(args[index + 1]));
      index += 1;
    } else if (arg === "--json") {
      json = true;
    } else {
      throw new Error(`Unknown openclaw-target-admit option: ${arg}`);
    }
  }
  requireOptionValue(buildContract, "--build-contract");
  requireOptionValue(planApproval, "--plan-approval");
  requireOptionValue(targetDescriptor, "--target-descriptor");
  requireOptionValue(targetExecutable, "--target-executable");
  requireOptionValue(targetPackageJson, "--target-package-json");
  requireOptionValue(targetBuildInfo, "--target-build-info");
  requireOptionValue(out, "--out");
  requireOptionValue(fsHelper, "--fs-helper");
  requireOptionValue(fsHelperReceipt, "--fs-helper-receipt");
  requireOptionValue(fsHelperReceiptDigest, "--fs-helper-receipt-digest");
  const digests = parseDigestBindings(
    digestBindings,
    subjectsForCommand("openclaw-target-admit"),
  );
  return {
    file: resolve(file),
    buildContract: resolve(buildContract),
    planApproval: resolve(planApproval),
    targetDescriptor: resolve(targetDescriptor),
    targetExecutable: resolve(targetExecutable),
    targetPackageJson: resolve(targetPackageJson),
    targetBuildInfo: resolve(targetBuildInfo),
    out: resolve(out),
    fsHelper: resolve(fsHelper),
    fsHelperReceipt: resolve(fsHelperReceipt),
    fsHelperReceiptDigest,
    json,
    digests,
  };
}

function parsePackageProduceArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing blueprint file path.");
  const options = {
    file,
    designPlan: null,
    discoveryApproval: null,
    decisionLedger: null,
    buildContract: null,
    planApproval: null,
    targetDescriptor: null,
    targetCarrierAdmission: null,
    out: null,
    archive: null,
    fsHelper: null,
    fsHelperReceipt: null,
    fsHelperReceiptDigest: null,
    json: false,
  };
  const digestBindings = [];
  const names = new Map([
    ["--design-plan", "designPlan"],
    ["--discovery-approval", "discoveryApproval"],
    ["--decision-ledger", "decisionLedger"],
    ["--build-contract", "buildContract"],
    ["--plan-approval", "planApproval"],
    ["--target-descriptor", "targetDescriptor"],
    ["--target-carrier-admission", "targetCarrierAdmission"],
    ["--out", "out"],
    ["--archive", "archive"],
    ["--fs-helper", "fsHelper"],
    ["--fs-helper-receipt", "fsHelperReceipt"],
    ["--fs-helper-receipt-digest", "fsHelperReceiptDigest"],
  ]);
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (names.has(arg)) {
      options[names.get(arg)] = args[index + 1];
      index += 1;
    } else if (arg === "--digest") {
      digestBindings.push(requireDigestBinding(args[index + 1]));
      index += 1;
    } else if (arg === "--json") {
      options.json = true;
    } else {
      throw new Error(`Unknown package-produce option: ${arg}`);
    }
  }
  for (const [flag, key] of names) requireOptionValue(options[key], flag);
  options.digests = parseDigestBindings(
    digestBindings,
    subjectsForCommand("package-produce"),
  );
  for (const key of [
    "file", "designPlan", "discoveryApproval", "decisionLedger", "buildContract",
    "planApproval", "targetDescriptor", "targetCarrierAdmission", "out", "archive",
    "fsHelper", "fsHelperReceipt",
  ]) {
    options[key] = resolve(options[key]);
  }
  return options;
}

function parsePackageInspectArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing Agent Package directory or archive path.");
  let archiveDigest = null;
  let manifestDigest = null;
  let json = false;
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--archive-sha256") {
      archiveDigest = args[index + 1] ?? null;
      index += 1;
    } else if (arg === "--manifest-sha256") {
      manifestDigest = args[index + 1] ?? null;
      index += 1;
    } else if (arg === "--json") {
      json = true;
    } else {
      throw new Error(`Unknown package-inspect option: ${arg}`);
    }
  }
  if ((archiveDigest === null) === (manifestDigest === null)) {
    throw new Error(
      "Exactly one of --archive-sha256 or --manifest-sha256 is required.",
    );
  }
  return {
    file: resolve(file),
    archiveDigest,
    manifestDigest,
    json,
  };
}

function parseOpenClawProbeArgs(args) {
  const options = {
    archive: null,
    archiveDigest: null,
    blueprint: null,
    blueprintDigest: null,
    buildContract: null,
    buildContractDigest: null,
    planApproval: null,
    planApprovalDigest: null,
    targetCarrierAdmission: null,
    targetCarrierAdmissionDigest: null,
    targetDescriptor: null,
    targetDescriptorDigest: null,
    targetRoot: null,
    out: null,
    json: false,
  };
  const names = new Map([
    ["--archive", "archive"],
    ["--archive-sha256", "archiveDigest"],
    ["--blueprint", "blueprint"],
    ["--blueprint-sha256", "blueprintDigest"],
    ["--build-contract", "buildContract"],
    ["--build-contract-sha256", "buildContractDigest"],
    ["--plan-approval", "planApproval"],
    ["--plan-approval-sha256", "planApprovalDigest"],
    ["--target-carrier-admission", "targetCarrierAdmission"],
    ["--target-carrier-admission-sha256", "targetCarrierAdmissionDigest"],
    ["--target-descriptor", "targetDescriptor"],
    ["--target-descriptor-sha256", "targetDescriptorDigest"],
    ["--target-root", "targetRoot"],
    ["--out", "out"],
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (names.has(arg)) {
      options[names.get(arg)] = args[index + 1] ?? null;
      index += 1;
    } else if (arg === "--json") {
      options.json = true;
    } else {
      throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
    }
  }
  for (const [flag, key] of names) requireOptionValue(options[key], flag);
  for (const key of [
    "archive", "blueprint", "buildContract", "planApproval",
    "targetCarrierAdmission", "targetDescriptor", "targetRoot", "out",
  ]) {
    options[key] = resolve(options[key]);
  }
  return options;
}

function parseOpenClawInstallGenesisArgs(args) {
  const options = {
    archive: null,
    archiveDigest: null,
    blueprint: null,
    blueprintDigest: null,
    buildContract: null,
    buildContractDigest: null,
    planApproval: null,
    planApprovalDigest: null,
    targetCarrierAdmission: null,
    targetCarrierAdmissionDigest: null,
    targetDescriptor: null,
    targetDescriptorDigest: null,
    probe: null,
    probeDigest: null,
    request: null,
    requestDigest: null,
    targetRoot: null,
    fsHelper: null,
    fsHelperReceipt: null,
    fsHelperReceiptDigest: null,
    out: null,
    json: false,
  };
  parseClosedLifecycleArgs(args, options, new Map([
    ["--archive", "archive"],
    ["--archive-sha256", "archiveDigest"],
    ["--blueprint", "blueprint"],
    ["--blueprint-sha256", "blueprintDigest"],
    ["--build-contract", "buildContract"],
    ["--build-contract-sha256", "buildContractDigest"],
    ["--plan-approval", "planApproval"],
    ["--plan-approval-sha256", "planApprovalDigest"],
    ["--target-carrier-admission", "targetCarrierAdmission"],
    ["--target-carrier-admission-sha256", "targetCarrierAdmissionDigest"],
    ["--target-descriptor", "targetDescriptor"],
    ["--target-descriptor-sha256", "targetDescriptorDigest"],
    ["--probe", "probe"],
    ["--probe-sha256", "probeDigest"],
    ["--request", "request"],
    ["--request-sha256", "requestDigest"],
    ["--target-root", "targetRoot"],
    ["--fs-helper", "fsHelper"],
    ["--fs-helper-receipt", "fsHelperReceipt"],
    ["--fs-helper-receipt-digest", "fsHelperReceiptDigest"],
    ["--out", "out"],
  ]));
  for (const [key, flag] of [
    ["archive", "--archive"],
    ["archiveDigest", "--archive-sha256"],
    ["blueprint", "--blueprint"],
    ["blueprintDigest", "--blueprint-sha256"],
    ["buildContract", "--build-contract"],
    ["buildContractDigest", "--build-contract-sha256"],
    ["planApproval", "--plan-approval"],
    ["planApprovalDigest", "--plan-approval-sha256"],
    ["targetCarrierAdmission", "--target-carrier-admission"],
    ["targetCarrierAdmissionDigest", "--target-carrier-admission-sha256"],
    ["targetDescriptor", "--target-descriptor"],
    ["targetDescriptorDigest", "--target-descriptor-sha256"],
    ["probe", "--probe"],
    ["probeDigest", "--probe-sha256"],
    ["request", "--request"],
    ["requestDigest", "--request-sha256"],
    ["targetRoot", "--target-root"],
    ["fsHelper", "--fs-helper"],
    ["fsHelperReceipt", "--fs-helper-receipt"],
    ["fsHelperReceiptDigest", "--fs-helper-receipt-digest"],
    ["out", "--out"],
  ]) requireOptionValue(options[key], flag);
  for (const key of [
    "archive",
    "blueprint",
    "buildContract",
    "planApproval",
    "targetCarrierAdmission",
    "targetDescriptor",
    "probe",
    "request",
    "targetRoot",
    "fsHelper",
    "fsHelperReceipt",
    "out",
  ]) options[key] = resolve(options[key]);
  return options;
}

async function parseOpenClawInstallPreviewArgs(args) {
  const options = {
    lifecycle: null,
    archive: null,
    archiveDigest: null,
    blueprint: null,
    blueprintDigest: null,
    buildContract: null,
    buildContractDigest: null,
    planApproval: null,
    planApprovalDigest: null,
    targetCarrierAdmission: null,
    targetCarrierAdmissionDigest: null,
    targetDescriptor: null,
    targetDescriptorDigest: null,
    probe: null,
    probeDigest: null,
    request: null,
    requestDigest: null,
    targetRoot: null,
    openClawTargetRoot: null,
    fsHelper: null,
    fsHelperReceipt: null,
    fsHelperReceiptDigest: null,
    authorityRootBinding: null,
    authorityRootBindingDigest: null,
    absentGenesis: null,
    absentGenesisDigest: null,
    currentReceipt: null,
    currentReceiptDigest: null,
    currentReceiptCompanionArgs: emptyReceiptCompanionArgs(),
    currentReceiptCompanionBundle: null,
    currentReceiptCompanionBundleDigest: null,
    predecessorReceipt: null,
    predecessorReceiptDigest: null,
    predecessorReceiptCompanionArgs: emptyReceiptCompanionArgs(),
    predecessorReceiptCompanionBundle: null,
    predecessorReceiptCompanionBundleDigest: null,
    predecessorArchive: null,
    predecessorArchiveDigest: null,
    out: null,
    json: false,
  };
  const names = new Map([
    ["--lifecycle", "lifecycle"],
    ["--archive", "archive"],
    ["--archive-sha256", "archiveDigest"],
    ["--blueprint", "blueprint"],
    ["--blueprint-sha256", "blueprintDigest"],
    ["--build-contract", "buildContract"],
    ["--build-contract-sha256", "buildContractDigest"],
    ["--plan-approval", "planApproval"],
    ["--plan-approval-sha256", "planApprovalDigest"],
    ["--target-carrier-admission", "targetCarrierAdmission"],
    ["--target-carrier-admission-sha256", "targetCarrierAdmissionDigest"],
    ["--target-descriptor", "targetDescriptor"],
    ["--target-descriptor-sha256", "targetDescriptorDigest"],
    ["--probe", "probe"],
    ["--probe-sha256", "probeDigest"],
    ["--request", "request"],
    ["--request-sha256", "requestDigest"],
    ["--target-root", "targetRoot"],
    ["--openclaw-target-root", "openClawTargetRoot"],
    ["--fs-helper", "fsHelper"],
    ["--fs-helper-receipt", "fsHelperReceipt"],
    ["--fs-helper-receipt-digest", "fsHelperReceiptDigest"],
    ["--authority-root-binding", "authorityRootBinding"],
    ["--authority-root-binding-sha256", "authorityRootBindingDigest"],
    ["--absent-genesis", "absentGenesis"],
    ["--absent-genesis-sha256", "absentGenesisDigest"],
    ["--current-receipt", "currentReceipt"],
    ["--current-receipt-sha256", "currentReceiptDigest"],
    ["--current-receipt-companion-bundle", "currentReceiptCompanionBundle"],
    ["--current-receipt-companion-bundle-sha256", "currentReceiptCompanionBundleDigest"],
    ["--predecessor-receipt", "predecessorReceipt"],
    ["--predecessor-receipt-sha256", "predecessorReceiptDigest"],
    ["--predecessor-receipt-companion-bundle", "predecessorReceiptCompanionBundle"],
    ["--predecessor-receipt-companion-bundle-sha256", "predecessorReceiptCompanionBundleDigest"],
    ["--predecessor-archive", "predecessorArchive"],
    ["--predecessor-archive-sha256", "predecessorArchiveDigest"],
    ["--out", "out"],
  ]);
  parseClosedLifecycleArgs(args, options, names);
  if (!["install", "upgrade", "rollback", "uninstall"].includes(
    options.lifecycle,
  )) {
    throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
  }
  for (const [key, flag] of [
    ["archive", "--archive"],
    ["archiveDigest", "--archive-sha256"],
    ["blueprint", "--blueprint"],
    ["blueprintDigest", "--blueprint-sha256"],
    ["buildContract", "--build-contract"],
    ["buildContractDigest", "--build-contract-sha256"],
    ["planApproval", "--plan-approval"],
    ["planApprovalDigest", "--plan-approval-sha256"],
    ["targetCarrierAdmission", "--target-carrier-admission"],
    ["targetCarrierAdmissionDigest", "--target-carrier-admission-sha256"],
    ["targetDescriptor", "--target-descriptor"],
    ["targetDescriptorDigest", "--target-descriptor-sha256"],
    ["probe", "--probe"],
    ["probeDigest", "--probe-sha256"],
    ["request", "--request"],
    ["requestDigest", "--request-sha256"],
    ["targetRoot", "--target-root"],
    ["openClawTargetRoot", "--openclaw-target-root"],
    ["fsHelper", "--fs-helper"],
    ["fsHelperReceipt", "--fs-helper-receipt"],
    ["fsHelperReceiptDigest", "--fs-helper-receipt-digest"],
    ["authorityRootBinding", "--authority-root-binding"],
    ["authorityRootBindingDigest", "--authority-root-binding-sha256"],
    ["out", "--out"],
  ]) requireOptionValue(options[key], flag);
  const absent = options.absentGenesis !== null
    && options.absentGenesisDigest !== null;
  const current = options.currentReceipt !== null
    && options.currentReceiptDigest !== null;
  const predecessor = options.predecessorReceipt !== null
    && options.predecessorReceiptDigest !== null
    && options.predecessorArchive !== null
    && options.predecessorArchiveDigest !== null;
  const hasPartialMate = [
    ["absentGenesis", "absentGenesisDigest"],
    ["currentReceipt", "currentReceiptDigest"],
    ["predecessorReceipt", "predecessorReceiptDigest"],
    ["predecessorArchive", "predecessorArchiveDigest"],
  ].some(([left, right]) => (
    (options[left] === null) !== (options[right] === null)
  ));
  if (hasPartialMate
    || (options.lifecycle === "install" && (!absent || current || predecessor))
    || (["upgrade", "uninstall"].includes(options.lifecycle)
      && (!current || absent || predecessor))
    || (options.lifecycle === "rollback"
      && (!current || !predecessor || absent))) {
    throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
  }
  options.currentReceiptCompanions = await finalizeReceiptCompanionInput(
    options,
    "current",
    current,
  );
  options.predecessorReceiptCompanions = await finalizeReceiptCompanionInput(
    options,
    "predecessor",
    options.predecessorReceipt !== null,
  );
  delete options.currentReceiptCompanionArgs;
  delete options.predecessorReceiptCompanionArgs;
  for (const key of [
    "archive",
    "blueprint",
    "buildContract",
    "planApproval",
    "targetCarrierAdmission",
    "targetDescriptor",
    "probe",
    "request",
    "targetRoot",
    "openClawTargetRoot",
    "fsHelper",
    "fsHelperReceipt",
    "authorityRootBinding",
    "absentGenesis",
    "currentReceipt",
    "predecessorReceipt",
    "predecessorArchive",
    "out",
  ]) {
    if (options[key] !== null) options[key] = resolve(options[key]);
  }
  return options;
}

function parseOpenClawInstallApproveArgs(args) {
  const options = {
    plan: null,
    planDigest: null,
    request: null,
    requestDigest: null,
    ordinaryOut: null,
    sensitiveOutputs: [],
    conflictOut: null,
    json: false,
  };
  const names = new Map([
    ["--plan", "plan"],
    ["--plan-sha256", "planDigest"],
    ["--request", "request"],
    ["--request-sha256", "requestDigest"],
    ["--ordinary-out", "ordinaryOut"],
    ["--conflict-out", "conflictOut"],
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (names.has(arg)) {
      const key = names.get(arg);
      if (options[key] !== null) throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
      options[key] = requireLifecycleValue(args[index + 1]);
      index += 1;
    } else if (arg === "--sensitive-out") {
      options.sensitiveOutputs.push(requireLifecycleValue(args[index + 1]));
      index += 1;
    } else if (arg === "--json") {
      options.json = true;
    } else {
      throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
    }
  }
  for (const [key, flag] of [
    ["plan", "--plan"],
    ["planDigest", "--plan-sha256"],
    ["request", "--request"],
    ["requestDigest", "--request-sha256"],
    ["ordinaryOut", "--ordinary-out"],
    ["conflictOut", "--conflict-out"],
  ]) requireOptionValue(options[key], flag);
  if (options.sensitiveOutputs.length === 0
    || new Set([
      options.ordinaryOut,
      ...options.sensitiveOutputs,
      options.conflictOut,
    ]).size !== options.sensitiveOutputs.length + 2) {
    throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
  }
  for (const key of ["plan", "request", "ordinaryOut", "conflictOut"]) {
    options[key] = resolve(options[key]);
  }
  options.sensitiveOutputs = options.sensitiveOutputs.map((value) => resolve(value));
  return options;
}

function parseOpenClawFsKernelBuildArgs(args) {
  const options = {
    binaryOut: null,
    receiptOut: null,
    json: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--binary-out" || arg === "--receipt-out") {
      const key = arg === "--binary-out" ? "binaryOut" : "receiptOut";
      if (options[key] !== null) throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
      options[key] = requireLifecycleValue(args[index + 1]);
      index += 1;
    } else if (arg === "--json") {
      options.json = true;
    } else {
      throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
    }
  }
  requireOptionValue(options.binaryOut, "--binary-out");
  requireOptionValue(options.receiptOut, "--receipt-out");
  options.binaryOut = resolve(options.binaryOut);
  options.receiptOut = resolve(options.receiptOut);
  if (options.binaryOut === options.receiptOut) {
    throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
  }
  return options;
}

async function parseOpenClawInstallApplyArgs(args) {
  const options = {
    lifecycle: null,
    blueprint: null,
    blueprintDigest: null,
    buildContract: null,
    buildContractDigest: null,
    planApproval: null,
    planApprovalDigest: null,
    targetDescriptor: null,
    targetDescriptorDigest: null,
    targetCarrierAdmission: null,
    targetCarrierAdmissionDigest: null,
    archive: null,
    archiveDigest: null,
    probe: null,
    probeDigest: null,
    installPlan: null,
    installPlanDigest: null,
    ordinaryApproval: null,
    ordinaryApprovalDigest: null,
    sensitiveDecisionPaths: [],
    sensitiveDecisionDigests: [],
    conflictApproval: null,
    conflictApprovalDigest: null,
    absentGenesis: null,
    absentGenesisDigest: null,
    currentReceipt: null,
    currentReceiptDigest: null,
    currentReceiptCompanionArgs: emptyReceiptCompanionArgs(),
    currentReceiptCompanionBundle: null,
    currentReceiptCompanionBundleDigest: null,
    predecessorReceipt: null,
    predecessorReceiptDigest: null,
    predecessorReceiptCompanionArgs: emptyReceiptCompanionArgs(),
    predecessorReceiptCompanionBundle: null,
    predecessorReceiptCompanionBundleDigest: null,
    predecessorArchive: null,
    predecessorArchiveDigest: null,
    openClawTargetRoot: null,
    targetRoot: null,
    out: null,
    fsHelper: null,
    fsHelperReceipt: null,
    fsHelperReceiptDigest: null,
    authorityRootBinding: null,
    authorityRootBindingDigest: null,
    attemptId: null,
    json: false,
  };
  const names = new Map([
    ["--lifecycle", "lifecycle"],
    ["--blueprint", "blueprint"],
    ["--blueprint-sha256", "blueprintDigest"],
    ["--build-contract", "buildContract"],
    ["--build-contract-sha256", "buildContractDigest"],
    ["--plan-approval", "planApproval"],
    ["--plan-approval-sha256", "planApprovalDigest"],
    ["--target-descriptor", "targetDescriptor"],
    ["--target-descriptor-sha256", "targetDescriptorDigest"],
    ["--target-carrier-admission", "targetCarrierAdmission"],
    ["--target-carrier-admission-sha256", "targetCarrierAdmissionDigest"],
    ["--archive", "archive"],
    ["--archive-sha256", "archiveDigest"],
    ["--probe", "probe"],
    ["--probe-sha256", "probeDigest"],
    ["--install-plan", "installPlan"],
    ["--install-plan-sha256", "installPlanDigest"],
    ["--ordinary-approval", "ordinaryApproval"],
    ["--ordinary-approval-sha256", "ordinaryApprovalDigest"],
    ["--conflict-approval", "conflictApproval"],
    ["--conflict-approval-sha256", "conflictApprovalDigest"],
    ["--absent-genesis", "absentGenesis"],
    ["--absent-genesis-sha256", "absentGenesisDigest"],
    ["--current-receipt", "currentReceipt"],
    ["--current-receipt-sha256", "currentReceiptDigest"],
    ["--current-receipt-companion-bundle", "currentReceiptCompanionBundle"],
    ["--current-receipt-companion-bundle-sha256", "currentReceiptCompanionBundleDigest"],
    ["--predecessor-receipt", "predecessorReceipt"],
    ["--predecessor-receipt-sha256", "predecessorReceiptDigest"],
    ["--predecessor-receipt-companion-bundle", "predecessorReceiptCompanionBundle"],
    ["--predecessor-receipt-companion-bundle-sha256", "predecessorReceiptCompanionBundleDigest"],
    ["--predecessor-archive", "predecessorArchive"],
    ["--predecessor-archive-sha256", "predecessorArchiveDigest"],
    ["--openclaw-target-root", "openClawTargetRoot"],
    ["--target-root", "targetRoot"],
    ["--out", "out"],
    ["--fs-helper", "fsHelper"],
    ["--fs-helper-receipt", "fsHelperReceipt"],
    ["--fs-helper-receipt-digest", "fsHelperReceiptDigest"],
    ["--authority-root-binding", "authorityRootBinding"],
    ["--authority-root-binding-sha256", "authorityRootBindingDigest"],
    ["--attempt-id", "attemptId"],
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const companionFlag = parseReceiptCompanionFlag(arg);
    if (companionFlag !== null) {
      const bucket = companionFlag.prefix === "current"
        ? options.currentReceiptCompanionArgs
        : options.predecessorReceiptCompanionArgs;
      const value = requireLifecycleValue(args[index + 1]);
      if (companionFlag.repeatable) {
        bucket[companionFlag.digest ? "sensitiveDigests" : "sensitivePaths"]
          .push(value);
      } else {
        const field = `${companionFlag.key}${companionFlag.digest ? "Digest" : "Path"}`;
        if (bucket[field] !== null) {
          throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
        }
        bucket[field] = value;
      }
      index += 1;
    } else if (names.has(arg)) {
      const key = names.get(arg);
      if (options[key] !== null) throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
      options[key] = requireLifecycleValue(args[index + 1]);
      index += 1;
    } else if (arg === "--sensitive-decision") {
      options.sensitiveDecisionPaths.push(requireLifecycleValue(args[index + 1]));
      index += 1;
    } else if (arg === "--sensitive-decision-sha256") {
      options.sensitiveDecisionDigests.push(
        requireLifecycleValue(args[index + 1]),
      );
      index += 1;
    } else if (arg === "--json") {
      options.json = true;
    } else {
      throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
    }
  }
  if (!["install", "upgrade", "rollback", "uninstall"].includes(options.lifecycle)) {
    throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
  }
  for (const [key, flag] of [
    ["blueprint", "--blueprint"],
    ["blueprintDigest", "--blueprint-sha256"],
    ["buildContract", "--build-contract"],
    ["buildContractDigest", "--build-contract-sha256"],
    ["planApproval", "--plan-approval"],
    ["planApprovalDigest", "--plan-approval-sha256"],
    ["targetDescriptor", "--target-descriptor"],
    ["targetDescriptorDigest", "--target-descriptor-sha256"],
    ["targetCarrierAdmission", "--target-carrier-admission"],
    ["targetCarrierAdmissionDigest", "--target-carrier-admission-sha256"],
    ["archive", "--archive"],
    ["archiveDigest", "--archive-sha256"],
    ["probe", "--probe"],
    ["probeDigest", "--probe-sha256"],
    ["installPlan", "--install-plan"],
    ["installPlanDigest", "--install-plan-sha256"],
    ["ordinaryApproval", "--ordinary-approval"],
    ["ordinaryApprovalDigest", "--ordinary-approval-sha256"],
    ["conflictApproval", "--conflict-approval"],
    ["conflictApprovalDigest", "--conflict-approval-sha256"],
    ["openClawTargetRoot", "--openclaw-target-root"],
    ["targetRoot", "--target-root"],
    ["out", "--out"],
    ["fsHelper", "--fs-helper"],
    ["fsHelperReceipt", "--fs-helper-receipt"],
    ["fsHelperReceiptDigest", "--fs-helper-receipt-digest"],
    ["authorityRootBinding", "--authority-root-binding"],
    ["authorityRootBindingDigest", "--authority-root-binding-sha256"],
    ["attemptId", "--attempt-id"],
  ]) requireOptionValue(options[key], flag);
  if (options.sensitiveDecisionPaths.length
      !== options.sensitiveDecisionDigests.length
    || new Set(options.sensitiveDecisionPaths).size
      !== options.sensitiveDecisionPaths.length) {
    throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
  }
  const pairs = [
    ["conflictApproval", "conflictApprovalDigest"],
    ["absentGenesis", "absentGenesisDigest"],
    ["currentReceipt", "currentReceiptDigest"],
    ["predecessorReceipt", "predecessorReceiptDigest"],
    ["predecessorArchive", "predecessorArchiveDigest"],
  ];
  if (pairs.some(([left, right]) => (
    (options[left] === null) !== (options[right] === null)
  ))) {
    throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
  }
  const absent = options.absentGenesis !== null;
  const current = options.currentReceipt !== null;
  const predecessor = options.predecessorReceipt !== null
    && options.predecessorArchive !== null;
  if ((options.lifecycle === "install" && (!absent || current || predecessor))
    || (["upgrade", "uninstall"].includes(options.lifecycle)
      && (!current || absent || predecessor))
    || (options.lifecycle === "rollback"
      && (!current || !predecessor || absent))) {
    throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
  }
  options.currentReceiptCompanions = await finalizeReceiptCompanionInput(
    options,
    "current",
    current,
  );
  options.predecessorReceiptCompanions = await finalizeReceiptCompanionInput(
    options,
    "predecessor",
    options.predecessorReceipt !== null,
  );
  delete options.currentReceiptCompanionArgs;
  delete options.predecessorReceiptCompanionArgs;
  for (const key of [
    "blueprint",
    "buildContract",
    "planApproval",
    "targetDescriptor",
    "targetCarrierAdmission",
    "archive",
    "probe",
    "installPlan",
    "ordinaryApproval",
    "conflictApproval",
    "absentGenesis",
    "currentReceipt",
    "predecessorReceipt",
    "predecessorArchive",
    "openClawTargetRoot",
    "targetRoot",
    "out",
    "fsHelper",
    "fsHelperReceipt",
    "authorityRootBinding",
  ]) {
    if (options[key] !== null) options[key] = resolve(options[key]);
  }
  options.sensitiveDecisions = options.sensitiveDecisionPaths.map(
    (filePath, index) => ({
      filePath: resolve(filePath),
      digest: options.sensitiveDecisionDigests[index],
    }),
  );
  return options;
}

async function derivePublicOpenClawAuthorityStateRoot(
  openClawTargetRoot,
  targetDescriptorDigest,
) {
  const canonicalTargetRoot = await realpath(openClawTargetRoot);
  return resolve(
    dirname(canonicalTargetRoot),
    `.agentmo-openclaw-authority-${
      targetDescriptorDigest.slice("sha256:".length)
    }`,
  );
}

function emptyReceiptCompanionArgs() {
  const value = {
    sensitivePaths: [],
    sensitiveDigests: [],
  };
  for (const key of [
    "installPlan",
    "ordinaryApproval",
    "conflictApproval",
    "journal",
    "probe",
    "targetDescriptor",
    "packageManifest",
    "targetCarrierAdmission",
    "blueprint",
    "buildContract",
    "planApproval",
  ]) {
    value[`${key}Path`] = null;
    value[`${key}Digest`] = null;
  }
  return value;
}

function parseReceiptCompanionFlag(flag) {
  const match = /^--(current|predecessor)-receipt-companion-(install-plan|ordinary-approval|sensitive-decision|conflict-approval|journal|probe|target-descriptor|package-manifest|target-carrier-admission|blueprint|build-contract|plan-approval)(-sha256)?$/u
    .exec(flag);
  if (!match) return null;
  const keys = {
    "install-plan": "installPlan",
    "ordinary-approval": "ordinaryApproval",
    "sensitive-decision": "sensitiveDecision",
    "conflict-approval": "conflictApproval",
    journal: "journal",
    probe: "probe",
    "target-descriptor": "targetDescriptor",
    "package-manifest": "packageManifest",
    "target-carrier-admission": "targetCarrierAdmission",
    blueprint: "blueprint",
    "build-contract": "buildContract",
    "plan-approval": "planApproval",
  };
  return {
    prefix: match[1],
    key: keys[match[2]],
    digest: match[3] === "-sha256",
    repeatable: match[2] === "sensitive-decision",
  };
}

function finalizeReceiptCompanionArgs(value, required) {
  const any = value.sensitivePaths.length > 0
    || value.sensitiveDigests.length > 0
    || Object.entries(value).some(([key, item]) => (
      !["sensitivePaths", "sensitiveDigests"].includes(key) && item !== null
    ));
  if (!required) {
    if (any) throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
    return null;
  }
  if (value.sensitivePaths.length !== value.sensitiveDigests.length
    || new Set(value.sensitivePaths).size !== value.sensitivePaths.length
    || new Set(value.sensitiveDigests).size !== value.sensitiveDigests.length) {
    throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
  }
  const binding = (key) => {
    const filePath = value[`${key}Path`];
    const digest = value[`${key}Digest`];
    if (filePath === null || digest === null) {
      throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
    }
    return { filePath: resolve(filePath), digest };
  };
  return {
    installPlan: binding("installPlan"),
    ordinaryApproval: binding("ordinaryApproval"),
    sensitiveDecisions: value.sensitivePaths.map((filePath, index) => ({
      filePath: resolve(filePath),
      digest: value.sensitiveDigests[index],
    })),
    conflictApproval: binding("conflictApproval"),
    journal: binding("journal"),
    probe: binding("probe"),
    targetDescriptor: binding("targetDescriptor"),
    packageManifest: binding("packageManifest"),
    targetCarrierAdmission: binding("targetCarrierAdmission"),
    blueprint: binding("blueprint"),
    buildContract: binding("buildContract"),
    planApproval: binding("planApproval"),
    predecessor: null,
  };
}

function receiptCompanionArgsPresent(value) {
  return value.sensitivePaths.length > 0
    || value.sensitiveDigests.length > 0
    || Object.entries(value).some(([key, item]) => (
      !["sensitivePaths", "sensitiveDigests"].includes(key) && item !== null
    ));
}

async function finalizeReceiptCompanionInput(options, prefix, required) {
  const companionArgs = options[`${prefix}ReceiptCompanionArgs`];
  const bundlePath = options[`${prefix}ReceiptCompanionBundle`];
  const bundleDigest = options[`${prefix}ReceiptCompanionBundleDigest`];
  if ((bundlePath === null) !== (bundleDigest === null)
    || (bundlePath !== null && receiptCompanionArgsPresent(companionArgs))) {
    throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
  }
  if (bundlePath === null) {
    return finalizeReceiptCompanionArgs(companionArgs, required);
  }
  if (!required) throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
  const resolvedBundlePath = resolve(bundlePath);
  const bundle = await loadExactLifecycleJson(
    resolvedBundlePath,
    bundleDigest,
    validateOpenClawInstallReceiptCompanionBindings,
  );
  return resolveReceiptCompanionBundle(resolvedBundlePath, bundle);
}

function resolveReceiptCompanionBundle(bundlePath, value) {
  const binding = (candidate) => ({
    ...candidate,
    filePath: resolveLifecycleBundleRef(bundlePath, candidate.filePath),
  });
  return {
    installPlan: binding(value.installPlan),
    ordinaryApproval: binding(value.ordinaryApproval),
    sensitiveDecisions: value.sensitiveDecisions.map(binding),
    conflictApproval: binding(value.conflictApproval),
    journal: binding(value.journal),
    probe: binding(value.probe),
    targetDescriptor: binding(value.targetDescriptor),
    packageManifest: binding(value.packageManifest),
    targetCarrierAdmission: binding(value.targetCarrierAdmission),
    blueprint: binding(value.blueprint),
    buildContract: binding(value.buildContract),
    planApproval: binding(value.planApproval),
    predecessor: value.predecessor === null
      ? null
      : {
          filePath: resolveLifecycleBundleRef(bundlePath, value.predecessor.filePath),
          digest: value.predecessor.digest,
          companions: resolveReceiptCompanionBundle(bundlePath, value.predecessor.companions),
        },
  };
}

function resolveLifecycleBundleRef(bundlePath, value) {
  if (typeof value !== "string"
    || value.length === 0
    || value.includes("\0")
    || value.includes("\\")
    || isAbsolute(value)
    || win32.isAbsolute(value)
    || /^[A-Za-z]:/u.test(value)
    || value.split("/").some((segment) => ["", ".", ".."].includes(segment))) {
    throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
  }
  const bundleDirectory = dirname(bundlePath);
  const candidate = resolve(bundleDirectory, value);
  const bounded = relative(bundleDirectory, candidate);
  if (bounded.length === 0
    || isAbsolute(bounded)
    || bounded === ".."
    || bounded.startsWith(`..${pathSeparator()}`)) {
    throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
  }
  return candidate;
}

function parseClosedLifecycleArgs(args, options, names) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const companionFlag = parseReceiptCompanionFlag(arg);
    if (companionFlag !== null
      && options.currentReceiptCompanionArgs !== undefined
      && options.predecessorReceiptCompanionArgs !== undefined) {
      const bucket = companionFlag.prefix === "current"
        ? options.currentReceiptCompanionArgs
        : options.predecessorReceiptCompanionArgs;
      const value = requireLifecycleValue(args[index + 1]);
      if (companionFlag.repeatable) {
        bucket[companionFlag.digest ? "sensitiveDigests" : "sensitivePaths"]
          .push(value);
      } else {
        const field = `${companionFlag.key}${companionFlag.digest ? "Digest" : "Path"}`;
        if (bucket[field] !== null) {
          throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
        }
        bucket[field] = value;
      }
      index += 1;
    } else if (names.has(arg)) {
      const key = names.get(arg);
      if (options[key] !== null) throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
      options[key] = requireLifecycleValue(args[index + 1]);
      index += 1;
    } else if (arg === "--json") {
      options.json = true;
    } else {
      throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
    }
  }
}

function requireLifecycleValue(value) {
  if (typeof value !== "string" || value.length === 0 || value.startsWith("--")
    || value.includes("\0")) {
    throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
  }
  return value;
}

async function loadExactLifecycleJson(filePath, expectedDigest, validate) {
  if (!/^sha256:[a-f0-9]{64}$/u.test(expectedDigest ?? "")) {
    throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
  }
  const bytes = await readBoundedNoFollowFile(filePath, 1024 * 1024);
  if (digestRawBytes(bytes) !== expectedDigest) {
    throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_DIGEST_MISMATCH");
  }
  let value;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = JSON.parse(text);
    if (serializePersistableJson(value, { subject: "openclaw-lifecycle-input" })
      !== text) {
      throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
    }
  } catch (error) {
    if (error?.code) throw error;
    throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
  }
  const result = validate(value);
  if (result?.ok !== true) throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
  return value;
}

async function loadExactOpenClawProbe(options, archive) {
  const blueprint = await loadAdmittedArtifact({
    filePath: options.blueprint,
    subject: "blueprint",
    expectedDigest: options.blueprintDigest,
  });
  const buildContract = await loadAdmittedArtifact({
    filePath: options.buildContract,
    subject: "build-contract",
    expectedDigest: options.buildContractDigest,
  });
  const planApproval = await loadAdmittedArtifact({
    filePath: options.planApproval,
    subject: "plan-approval",
    expectedDigest: options.planApprovalDigest,
  });
  const targetDescriptor = await loadAdmittedArtifact({
    filePath: options.targetDescriptor,
    subject: "openclaw-target-descriptor",
    expectedDigest: options.targetDescriptorDigest,
  });
  const targetCarrierAdmission = await loadAdmittedArtifact({
    filePath: options.targetCarrierAdmission,
    subject: "openclaw-target-carrier-admission",
    expectedDigest: options.targetCarrierAdmissionDigest,
    companions: {
      blueprint,
      "build-contract": buildContract,
      "plan-approval": planApproval,
      "openclaw-target-descriptor": targetDescriptor,
    },
  });
  return (await loadAdmittedArtifact({
    filePath: options.probe,
    subject: "openclaw-probe",
    expectedDigest: options.probeDigest,
    companions: {
      "package-manifest": archive.manifest,
      "openclaw-target-carrier-admission": targetCarrierAdmission,
      "openclaw-target-descriptor": targetDescriptor,
    },
  })).value;
}

function assertLifecycleTargetMatchesProbe(target, probe) {
  if (target?.targetId !== "openclaw"
    || target.targetVersion !== probe?.target?.version
    || target.targetRevision !== probe?.target?.sourceRevision
    || target.probeFingerprintDigest !== probe?.fingerprintDigest
    || !["project", "user"].includes(target.scope)
    || typeof target.projectId !== "string"
    || target.projectId.length === 0) {
    throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
  }
}

async function loadLifecycleBasis(options, authorityRootBinding) {
  if (options.lifecycle === "install") {
    const genesis = await loadAdmittedArtifact({
      filePath: options.absentGenesis,
      subject: "openclaw-absent-genesis",
      expectedDigest: options.absentGenesisDigest,
    });
    return { absentGenesis: genesis.value };
  }
  const current = await admitOpenClawInstallReceiptWithCompanions(
    options.currentReceipt,
    options.currentReceiptDigest,
    options.currentReceiptCompanions,
    {
      openClawTargetRoot: options.openClawTargetRoot,
      helperPath: options.fsHelper,
      receiptPath: options.fsHelperReceipt,
      receiptDigest: options.fsHelperReceiptDigest,
      authorityRootBinding,
    },
  );
  if (options.lifecycle !== "rollback") {
    return { currentReceipt: lifecycleReceiptAuthority(current) };
  }
  const selected = await admitOpenClawInstallReceiptWithCompanions(
    options.predecessorReceipt,
    options.predecessorReceiptDigest,
    options.predecessorReceiptCompanions,
    {
      openClawTargetRoot: options.openClawTargetRoot,
      helperPath: options.fsHelper,
      receiptPath: options.fsHelperReceipt,
      receiptDigest: options.fsHelperReceiptDigest,
      authorityRootBinding,
    },
  );
  const selectedInventory = await readPackageArchiveInventory({
    archivePath: options.predecessorArchive,
    expectedArchiveDigest: options.predecessorArchiveDigest,
  });
  const selectedArchiveBinding = {
    archiveSha256: options.predecessorArchiveDigest,
    ...selectedInventory,
  };
  if (serializePersistableJson(selected.value.authorityLedger.archive, {
    subject: "openclaw-selected-receipt-archive",
  }) !== serializePersistableJson(selectedArchiveBinding, {
    subject: "openclaw-selected-receipt-archive",
  })) {
    throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
  }
  return {
    currentReceipt: lifecycleReceiptAuthority(current),
    selectedPredecessorReceipt: lifecycleReceiptAuthority(selected),
    selectedPredecessorArchiveBinding: selectedArchiveBinding,
  };
}

function lifecycleReceiptAuthority(admission) {
  const receipt = admission.value;
  const operationSetDigest = digestRawBytes(Buffer.from(
    serializePersistableJson(receipt.managedResults, {
      subject: "openclaw-receipt-operation-set",
    }),
    "utf8",
  ));
  const ownershipDigest = digestRawBytes(Buffer.from(
    serializePersistableJson(receipt.managedResults.map((operation) => ({
      path: operation.path,
      ownerMarker: operation.ownerMarker,
      beforeFileIdentity: operation.beforeFileIdentity,
      beforeParentIdentity: operation.beforeParentIdentity,
    })), { subject: "openclaw-receipt-ownership" }),
    "utf8",
  ));
  return {
    schemaVersion: "agentmo.openclaw-install-receipt-authority.v1",
    receiptDigest: admission.digest,
    lifecycle: receipt.lifecycle,
    targetId: receipt.authorityLedger.target.targetId,
    scope: receipt.authorityLedger.target.scope,
    archiveBinding: receipt.authorityLedger.archive,
    operationSetDigest,
    ownershipDigest,
    authorityId: receipt.postEffectEvidence.postState.authorityId,
    rootIdentity: receipt.postEffectEvidence.postState.rootIdentity,
  };
}

function formatOpenClawProbe(value) {
  return [
    "AgentMo OpenClaw capability probe",
    `Status: ${value.status}`,
    `Fingerprint: ${value.fingerprintDigest}`,
    "Certification: bounded observation only",
  ].join("\n") + "\n";
}

function artifactBinding(filePath, expectedDigest) {
  return { filePath, expectedDigest };
}

function parsePlanApproveArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing blueprint file path.");
  let buildContract = null;
  let approve = false;
  let previewDigest = null;
  let out = null;
  let json = false;
  const digestBindings = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--build-contract") {
      buildContract = args[index + 1];
      index += 1;
    } else if (arg === "--approve") {
      approve = true;
    } else if (arg === "--preview-digest") {
      previewDigest = args[index + 1];
      index += 1;
    } else if (arg === "--out") {
      out = args[index + 1];
      index += 1;
    } else if (arg === "--digest") {
      digestBindings.push(requireDigestBinding(args[index + 1]));
      index += 1;
    } else if (arg === "--json") {
      json = true;
    } else {
      throw new Error(`Unknown plan-approve option: ${arg}`);
    }
  }
  requireOptionValue(buildContract, "--build-contract");
  if (approve) {
    requireOptionValue(previewDigest, "--preview-digest");
    requireOptionValue(out, "--out");
  } else if (previewDigest !== null || out !== null) {
    throw new Error("Approval output requires explicit --approve.");
  }
  const digests = parseDigestBindings(digestBindings, subjectsForCommand("plan-approve"));
  return {
    file: resolve(file),
    buildContract: resolve(buildContract),
    approve,
    previewDigest,
    out: out === null ? null : resolve(out),
    json,
    digests,
  };
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

function parseDiscoveryApproveArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing discovery manifest file path.");
  let discoveryDb = null;
  let approve = false;
  let previewDigest = null;
  let out = null;
  let json = false;
  const digestBindings = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--discovery-db") {
      discoveryDb = args[index + 1];
      index += 1;
    } else if (arg === "--approve") {
      approve = true;
    } else if (arg === "--preview-digest") {
      previewDigest = args[index + 1];
      index += 1;
    } else if (arg === "--out") {
      out = args[index + 1];
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
      throw new Error(`Unknown discovery-approve option: ${arg}`);
    }
  }
  requireOptionValue(discoveryDb, "--discovery-db");
  if (approve) {
    requireOptionValue(previewDigest, "--preview-digest");
    requireOptionValue(out, "--out");
  } else if (previewDigest !== null || out !== null) {
    throw new Error("Approval output requires explicit --approve.");
  }
  const digests = parseDigestBindings(
    digestBindings,
    subjectsForCommand("discovery-approve"),
  );
  return {
    file: resolve(file),
    discoveryDb: resolve(discoveryDb),
    approve,
    previewDigest,
    out: out === null ? null : resolve(out),
    json,
    digests,
  };
}

function parseDecisionLedgerArgs(args) {
  const action = args[0];
  if (!["inspect", "append"].includes(action)) {
    throw new Error("decision-ledger action must be inspect or append.");
  }
  let journal = null;
  let entry = null;
  let expectedHeadDigest;
  let json = false;
  const digestBindings = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--journal") {
      journal = args[index + 1];
      index += 1;
    } else if (arg === "--entry") {
      entry = args[index + 1];
      index += 1;
    } else if (arg === "--expected-head-digest") {
      expectedHeadDigest = args[index + 1];
      index += 1;
    } else if (arg === "--digest") {
      digestBindings.push(requireDigestBinding(args[index + 1]));
      index += 1;
    } else if (arg === "--json") {
      json = true;
    } else {
      throw new Error(`Unknown decision-ledger option: ${arg}`);
    }
  }
  requireOptionValue(journal, "--journal");
  if (action === "inspect") {
    if (entry !== null || expectedHeadDigest !== undefined) {
      throw new Error("decision-ledger inspect is read-only.");
    }
    const digests = parseDigestBindings(digestBindings, ["decision-ledger"]);
    return { action, journal: resolve(journal), json, digests };
  }
  requireOptionValue(entry, "--entry");
  if (expectedHeadDigest !== undefined) {
    requireOptionValue(expectedHeadDigest, "--expected-head-digest");
  }
  const digests = parseDigestBindings(digestBindings, subjectsForCommand("decision-ledger"));
  return {
    action,
    journal: resolve(journal),
    entry: resolve(entry),
    expectedHeadDigest,
    json,
    digests,
  };
}

function decisionLedgerSummary(ledger) {
  return {
    schemaVersion: "agentmo.decision-ledger-summary.v1",
    identity: ledger.schemaVersion,
    entryCount: ledger.entries.length,
    head: ledger.head,
    recoveryRequired: ledger.recoveryRequired,
    entries: ledger.entries.map((entry) => ({
      entryId: entry.entryId,
      entryKind: entry.entryKind,
      sequence: entry.sequence,
      predecessorDigest: entry.predecessorDigest,
      valueDigest: entry.valueDigest,
      sourceRefs: entry.sourceRefs,
      decisionRefs: entry.decisionRefs,
      requirementRefs: entry.requirementRefs,
    })),
  };
}

function formatDecisionLedgerSummary(summary) {
  return [
    `AgentMo decision ledger: ${summary.identity}`,
    `Entries: ${summary.entryCount}`,
    `Head: ${summary.head?.digest ?? "empty"}`,
    `Recovery required: ${summary.recoveryRequired ? "yes" : "no"}`,
    "",
  ].join("\n");
}

function parseDesignPlanArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing discovery-db file path.");
  let need = null;
  let manifest = null;
  let discoveryApproval = null;
  let decisionLedger = null;
  let out = null;
  let target = "openclaw";
  let json = false;
  const digestBindings = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--manifest") {
      manifest = args[index + 1];
      index += 1;
    } else if (arg === "--discovery-approval") {
      discoveryApproval = args[index + 1];
      index += 1;
    } else if (arg === "--need") {
      need = args[index + 1];
      index += 1;
    } else if (arg === "--decision-ledger") {
      decisionLedger = args[index + 1];
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
  requireOptionValue(manifest, "--manifest");
  requireOptionValue(discoveryApproval, "--discovery-approval");
  requireOptionValue(need, "--need");
  requireOptionValue(decisionLedger, "--decision-ledger");
  requireOptionValue(out, "--out");
  assertKnownTarget(target, "design-plan target");
  const digests = parseDigestBindings(digestBindings, subjectsForCommand("design-plan"));
  return {
    file: resolve(file),
    manifest: resolve(manifest),
    discoveryApproval: resolve(discoveryApproval),
    need: resolve(need),
    decisionLedger: resolve(decisionLedger),
    out: resolve(out),
    target,
    json,
    digests,
  };
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

function formatBuildContract(contract) {
  return [
    `AgentMo build contract: ${contract.agentId}`,
    `Target: ${contract.targetRuntime.id}@${contract.targetRuntime.sourceRevision}`,
    `Resources: ${contract.resources.length}`,
    `Permissions: ${contract.permissions.length}`,
    `Acceptance cases: ${contract.acceptanceCases.length}`,
    `Evidence obligations: ${contract.evidenceObligations.length}`,
    "Package built: no",
    "Runtime certified: no",
    "",
  ].join("\n");
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
  agentmo artifact-contract decision-entry|discovery-manifest|openclaw-probe|openclaw-target-carrier-admission|openclaw-target-descriptor|package-manifest|user-need [--json]
  agentmo validate <blueprint.json> --digest blueprint=sha256:<64hex>
  agentmo report <blueprint.json> --digest blueprint=sha256:<64hex> [--discovery-manifest <discovery.json> --digest discovery-manifest=sha256:<64hex>] [--json]
  agentmo discover-report <discovery.json> --digest discovery-manifest=sha256:<64hex> [--json]
  agentmo discover-pack <discovery.json> --digest discovery-manifest=sha256:<64hex> --out <dir> [--json]
  agentmo discover-live <discovery.json> --digest discovery-manifest=sha256:<64hex> --out <absent-dir> [--json]
  agentmo discover-workspace <discovery.json> --digest discovery-manifest=sha256:<64hex> --source-root <dir> --out <dir> [--json]
  agentmo discovery-approve <discovery.json> --discovery-db <agentmo-discovery-db.json> --digest discovery-manifest=sha256:<64hex> --digest discovery-db=sha256:<64hex> [--approve --preview-digest sha256:<64hex> --out <approval.json>] [--json]
  agentmo need-report <need.json> --digest user-need=sha256:<64hex> [--json]
  agentmo decision-ledger append --journal <ledger.json> --entry <decision-entry.json> --digest decision-entry=sha256:<64hex> [--expected-head-digest sha256:<64hex>] [--json]
  agentmo decision-ledger inspect --journal <ledger.json> --digest decision-ledger=sha256:<64hex> [--json]
  agentmo design-plan <agentmo-discovery-db.json> --manifest <discovery.json> --discovery-approval <approval.json> --need <need.json> --decision-ledger <ledger.json> --digest discovery-manifest=sha256:<64hex> --digest discovery-db=sha256:<64hex> --digest discovery-approval=sha256:<64hex> --digest user-need=sha256:<64hex> --digest decision-ledger=sha256:<64hex> --out <agentmo-design-plan.json> [--target agentmo|openclaw] [--json]
  agentmo blueprint-draft <agentmo-discovery-db.json> --need <need.json> --digest discovery-db=sha256:<64hex> --digest user-need=sha256:<64hex> [--design-plan <agentmo-design-plan.json> --digest design-plan=sha256:<64hex>] --out <blueprint.json> [--target agentmo|openclaw] [--json]
  agentmo build-contract <blueprint.json> --design-plan <agentmo-design-plan.json> --discovery-approval <approval.json> --decision-ledger <ledger.json> --target-descriptor <descriptor.json> [--native-plugin-recipe <recipe.json> --digest native-plugin-recipe=sha256:<64hex>] --digest blueprint=sha256:<64hex> --digest design-plan=sha256:<64hex> --digest discovery-approval=sha256:<64hex> --digest decision-ledger=sha256:<64hex> --digest openclaw-target-descriptor=sha256:<64hex> --out <build-contract.json> --target openclaw [--json]
  agentmo plan-approve <blueprint.json> --build-contract <build-contract.json> --digest blueprint=sha256:<64hex> --digest build-contract=sha256:<64hex> [--approve --preview-digest sha256:<64hex> --out <plan-approval.json>] [--json]
  agentmo openclaw-target-describe --target-executable <file> --target-package-json <package.json> --target-build-info <build-info.json> --digest target-executable=sha256:<64hex> --digest target-package-json=sha256:<64hex> --digest target-build-info=sha256:<64hex> --fs-helper <absolute-helper> --fs-helper-receipt <receipt.json> --fs-helper-receipt-digest sha256:<64hex> --out <descriptor.json> [--json]
  agentmo openclaw-target-admit <blueprint.json> --build-contract <build-contract.json> --plan-approval <plan-approval.json> --target-descriptor <descriptor.json> --target-executable <file> --target-package-json <package.json> --target-build-info <build-info.json> --digest blueprint=sha256:<64hex> --digest build-contract=sha256:<64hex> --digest plan-approval=sha256:<64hex> --digest openclaw-target-descriptor=sha256:<64hex> --digest target-executable=sha256:<64hex> --digest target-package-json=sha256:<64hex> --digest target-build-info=sha256:<64hex> --fs-helper <absolute-helper> --fs-helper-receipt <receipt.json> --fs-helper-receipt-digest sha256:<64hex> --out <admission.json> [--json]
  agentmo package-produce <blueprint.json> --design-plan <design-plan.json> --discovery-approval <approval.json> --decision-ledger <ledger.json> --build-contract <build-contract.json> --plan-approval <plan-approval.json> --target-descriptor <descriptor.json> --target-carrier-admission <admission.json> --digest <subject=sha256:...>... --fs-helper <absolute-helper> --fs-helper-receipt <receipt.json> --fs-helper-receipt-digest sha256:<64hex> --out <absent-dir> --archive <absent.d42> [--json]
  agentmo package-inspect <directory> --manifest-sha256 sha256:<64hex> [--json]
  agentmo package-inspect <archive.d42> --archive-sha256 sha256:<64hex> [--json]
  agentmo openclaw-probe --archive <archive.d42> --archive-sha256 sha256:<64hex> --target-carrier-admission <admission.json> --target-carrier-admission-sha256 sha256:<64hex> --target-descriptor <descriptor.json> --target-descriptor-sha256 sha256:<64hex> --target-root <dir> --out <absent.json> [--json]
  agentmo openclaw-install-genesis --archive <archive.d42> --archive-sha256 sha256:<64hex> --blueprint <blueprint.json> --blueprint-sha256 sha256:<64hex> --build-contract <contract.json> --build-contract-sha256 sha256:<64hex> --plan-approval <approval.json> --plan-approval-sha256 sha256:<64hex> --target-carrier-admission <admission.json> --target-carrier-admission-sha256 sha256:<64hex> --target-descriptor <descriptor.json> --target-descriptor-sha256 sha256:<64hex> --probe <probe.json> --probe-sha256 sha256:<64hex> --request <genesis-request.json> --request-sha256 sha256:<64hex> --target-root <isolated-root> --fs-helper <binary> --fs-helper-receipt <receipt.json> --fs-helper-receipt-digest sha256:<64hex> --out <absent.json> [--json]
  agentmo openclaw-install-preview --lifecycle install|upgrade|rollback|uninstall --archive <archive.d42> --archive-sha256 sha256:<64hex> --blueprint <blueprint.json> --blueprint-sha256 sha256:<64hex> --build-contract <contract.json> --build-contract-sha256 sha256:<64hex> --plan-approval <approval.json> --plan-approval-sha256 sha256:<64hex> --target-carrier-admission <admission.json> --target-carrier-admission-sha256 sha256:<64hex> --target-descriptor <descriptor.json> --target-descriptor-sha256 sha256:<64hex> --probe <probe.json> --probe-sha256 sha256:<64hex> --request <preview-request.json> --request-sha256 sha256:<64hex> --openclaw-target-root <approved-openclaw-root> --target-root <isolated-root> --fs-helper <binary> --fs-helper-receipt <receipt.json> --fs-helper-receipt-digest sha256:<64hex> <exact lifecycle basis> --out <absent.json> [--json]
  agentmo openclaw-install-approve --plan <install-plan.json> --plan-sha256 sha256:<64hex> --request <approval-request.json> --request-sha256 sha256:<64hex> --ordinary-out <absent.json> --sensitive-out <absent.json>... --conflict-out <absent.json> [--json]
  agentmo openclaw-fs-kernel-build --binary-out <absent-private-path> --receipt-out <absent-private-path> [--json]
  agentmo openclaw-install-apply --lifecycle install|upgrade|rollback|uninstall --blueprint <blueprint.json> --blueprint-sha256 sha256:<64hex> --build-contract <contract.json> --build-contract-sha256 sha256:<64hex> --plan-approval <approval.json> --plan-approval-sha256 sha256:<64hex> --target-descriptor <descriptor.json> --target-descriptor-sha256 sha256:<64hex> --target-carrier-admission <admission.json> --target-carrier-admission-sha256 sha256:<64hex> --archive <archive.d42> --archive-sha256 sha256:<64hex> --probe <probe.json> --probe-sha256 sha256:<64hex> --install-plan <plan.json> --install-plan-sha256 sha256:<64hex> --ordinary-approval <approval.json> --ordinary-approval-sha256 sha256:<64hex> --sensitive-decision <decision.json> --sensitive-decision-sha256 sha256:<64hex> [--conflict-approval <approval.json> --conflict-approval-sha256 sha256:<64hex>] [--absent-genesis <genesis.json> --absent-genesis-sha256 sha256:<64hex> | --current-receipt <receipt.json> --current-receipt-sha256 sha256:<64hex> [--predecessor-receipt <receipt.json> --predecessor-receipt-sha256 sha256:<64hex> --predecessor-archive <archive.d42> --predecessor-archive-sha256 sha256:<64hex>]] --fs-helper <absolute-helper> --fs-helper-receipt <receipt.json> --fs-helper-receipt-digest sha256:<64hex> --openclaw-target-root <approved-openclaw-root> --target-root <isolated-project-root> --out <absent-receipt.json> [--json]
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
  discover-live    Fetch exact allowlisted HTTPS sources into bounded, provenance-bearing Stage 1 artifacts.
  discover-workspace  Read approved repo-bound local sources into sanitized Stage 1 discovery artifacts.
  discovery-approve  Preview or explicitly approve one exact manifest plus one exact discovery DB for Plan entry.
  need-report      Validate and summarize a concrete user-need brief.
  decision-ledger  Append or inspect typed predecessor-bound Plan decisions without transcript authority.
  design-plan      Produce a Stage 2 planning contract from discovery DB plus user need.
  blueprint-draft  Draft a valid AgentMo blueprint from discovery data plus user need, optionally gated by design-plan.
  build-contract   Specify the complete traceable OpenClaw Agent Package resource graph without materializing it.
  plan-approve     Preview or record exact local intent to enter Produce without certifying package or runtime.
  openclaw-target-admit  Bind one exact OpenClaw target to one approved native-plugin recipe.
  package-produce  Materialize one exact canonical Agent Package and its deterministic D-42 transport archive.
  package-inspect  Verify one complete Agent Package closure offline without installing or invoking OpenClaw.
  openclaw-probe  Fingerprint bounded read-only OpenClaw capability surfaces in a disposable synthetic HOME.
  openclaw-install-genesis  Publish verified absence authority from one exact probe and request.
  openclaw-install-preview  Publish an archive-only lifecycle proposal after exact predecessor admission.
  openclaw-install-approve  Publish independent ordinary, per-action, and exact-conflict authorities.
  openclaw-install-apply  Re-admit exact lifecycle authorities and publish one receipt-last bounded mechanism result.
  openclaw-fs-kernel-build  Build the auditable retained-dirfd helper and durable closed receipt.
  openclaw-target-describe Derive one exact target descriptor from retained first-party bytes.
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

const OPENCLAW_RECEIPT_COMPANION_NAMES = [
  "install-plan",
  "ordinary-approval",
  "sensitive-decision",
  "conflict-approval",
  "journal",
  "probe",
  "target-descriptor",
  "package-manifest",
  "target-carrier-admission",
  "blueprint",
  "build-contract",
  "plan-approval",
];
const OPENCLAW_RECEIPT_COMPANION_HELP = [
  "For a non-install receipt chain, use one exact recursive bundle instead of flat flags:",
  "--current-receipt-companion-bundle <file> --current-receipt-companion-bundle-sha256 sha256:<64hex>",
  "--predecessor-receipt-companion-bundle <file> --predecessor-receipt-companion-bundle-sha256 sha256:<64hex>",
  "Current receipt companion flags:",
  ...OPENCLAW_RECEIPT_COMPANION_NAMES.flatMap((name) => [
    `--current-receipt-companion-${name} <file>`,
    `--current-receipt-companion-${name}-sha256 sha256:<64hex>`,
  ]),
  "Rollback predecessor companion flags:",
  ...OPENCLAW_RECEIPT_COMPANION_NAMES.flatMap((name) => [
    `--predecessor-receipt-companion-${name} <file>`,
    `--predecessor-receipt-companion-${name}-sha256 sha256:<64hex>`,
  ]),
].join("\n");

function commandHelpText(command) {
  const entries = {
    "artifact-contract": `AgentMo artifact-contract
Usage: agentmo artifact-contract decision-entry|discovery-manifest|openclaw-probe|openclaw-target-carrier-admission|openclaw-target-descriptor|package-manifest|user-need [--json]
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
    "discover-live": `AgentMo discover-live
Usage: agentmo discover-live <discovery.json> --digest discovery-manifest=sha256:<64hex> --out <absent-dir> [--json]
Contract: agentmo artifact-contract discovery-manifest --json
Fetches only exact allowlisted HTTPS URLs under explicit size, timeout, redirect, address, and content-type bounds.
The resulting provenance proves bounded retrieval mechanics only; it does not certify semantic, domain, runtime, or production quality.
`,
    "discover-workspace": `AgentMo discover-workspace
Usage: agentmo discover-workspace <discovery.json> --digest discovery-manifest=sha256:<64hex> --source-root <dir> --out <dir> [--json]
Contract: agentmo artifact-contract discovery-manifest --json
Only approved repo-bound local files are read.
`,
    "discovery-approve": `AgentMo discovery-approve
Usage: agentmo discovery-approve <discovery.json> --discovery-db <agentmo-discovery-db.json> --digest discovery-manifest=sha256:<64hex> --digest discovery-db=sha256:<64hex> [--approve --preview-digest sha256:<64hex> --out <approval.json>] [--json]
Preview is write-free. Apply records local operator intent for enter-Plan only; it does not certify organizational authority, source quality, runtime, domain, package, or production readiness.
`,
    "need-report": `AgentMo need-report
Usage: agentmo need-report <need.json> --digest user-need=sha256:<64hex> [--json]
Contract: agentmo artifact-contract user-need --json
Valid example: examples/support-triage.need.json
`,
    "decision-ledger": `AgentMo decision-ledger
Usage:
  agentmo decision-ledger append --journal <ledger.json> --entry <decision-entry.json> --digest decision-entry=sha256:<64hex> [--expected-head-digest sha256:<64hex>] [--json]
  agentmo decision-ledger inspect --journal <ledger.json> --digest decision-ledger=sha256:<64hex> [--json]
Contract: agentmo artifact-contract decision-entry --json
Append accepts one closed typed entry artifact and never accepts transcript or stdin authority. Successors require the exact current head digest.
`,
    "design-plan": `AgentMo design-plan
Usage: agentmo design-plan <agentmo-discovery-db.json> --manifest <discovery.json> --discovery-approval <approval.json> --need <need.json> --decision-ledger <ledger.json> --digest discovery-manifest=sha256:<64hex> --digest discovery-db=sha256:<64hex> --digest discovery-approval=sha256:<64hex> --digest user-need=sha256:<64hex> --digest decision-ledger=sha256:<64hex> --out <agentmo-design-plan.json> [--target agentmo|openclaw] [--json]
The four file artifacts and exact current decision-ledger head are independently admitted. The approval proves local enter-Plan intent only.
`,
    "build-contract": `AgentMo build-contract
Usage: agentmo build-contract <blueprint.json> --design-plan <agentmo-design-plan.json> --discovery-approval <approval.json> --decision-ledger <ledger.json> --target-descriptor <descriptor.json> [--native-plugin-recipe <recipe.json> --digest native-plugin-recipe=sha256:<64hex>] --digest blueprint=sha256:<64hex> --digest design-plan=sha256:<64hex> --digest discovery-approval=sha256:<64hex> --digest decision-ledger=sha256:<64hex> --digest openclaw-target-descriptor=sha256:<64hex> --out <build-contract.json> --target openclaw [--json]
Creates construction intent only. It does not generate, install, load, execute, schedule, or certify an Agent Package.
`,
    "plan-approve": `AgentMo plan-approve
Usage: agentmo plan-approve <blueprint.json> --build-contract <build-contract.json> --digest blueprint=sha256:<64hex> --digest build-contract=sha256:<64hex> [--approve --preview-digest sha256:<64hex> --out <plan-approval.json>] [--json]
Preview is write-free. Apply records exact local enter-Produce intent only and does not certify package, runtime, domain, or production readiness.
`,
    "openclaw-target-describe": `AgentMo openclaw-target-describe
Usage: agentmo openclaw-target-describe --target-executable <file> --target-package-json <package.json> --target-build-info <build-info.json> --digest target-executable=sha256:<64hex> --digest target-package-json=sha256:<64hex> --digest target-build-info=sha256:<64hex> --fs-helper <absolute-helper> --fs-helper-receipt <receipt.json> --fs-helper-receipt-digest sha256:<64hex> --out <descriptor.json> [--json]
Derives version, full revision, bounded display revision, Node range, member digests, retained identity basis, and target-root identity from exact first-party bytes. It does not certify source quality, installation, runtime, domain, or production readiness.
`,
    "openclaw-target-admit": `AgentMo openclaw-target-admit
Usage: agentmo openclaw-target-admit <blueprint.json> --build-contract <build-contract.json> --plan-approval <plan-approval.json> --target-descriptor <descriptor.json> --target-executable <file> --target-package-json <package.json> --target-build-info <build-info.json> --digest blueprint=sha256:<64hex> --digest build-contract=sha256:<64hex> --digest plan-approval=sha256:<64hex> --digest openclaw-target-descriptor=sha256:<64hex> --digest target-executable=sha256:<64hex> --digest target-package-json=sha256:<64hex> --digest target-build-info=sha256:<64hex> --fs-helper <absolute-helper> --fs-helper-receipt <receipt.json> --fs-helper-receipt-digest sha256:<64hex> --out <admission.json> [--json]
The command accepts no plugin implementation path, plugin bytes, MCP route, or activation authority.
`,
    "package-produce": `AgentMo package-produce
Usage: agentmo package-produce <blueprint.json> --design-plan <design-plan.json> --discovery-approval <approval.json> --decision-ledger <ledger.json> --build-contract <build-contract.json> --plan-approval <plan-approval.json> --target-descriptor <descriptor.json> --target-carrier-admission <admission.json> --digest blueprint=sha256:<64hex> --digest design-plan=sha256:<64hex> --digest discovery-approval=sha256:<64hex> --digest decision-ledger=sha256:<64hex> --digest build-contract=sha256:<64hex> --digest plan-approval=sha256:<64hex> --digest openclaw-target-descriptor=sha256:<64hex> --digest openclaw-target-carrier-admission=sha256:<64hex> --fs-helper <absolute-helper> --fs-helper-receipt <receipt.json> --fs-helper-receipt-digest sha256:<64hex> --out <absent-dir> --archive <absent.d42> [--json]
The command re-admits every authority, writes only absent phase-local outputs, and does not install, activate, execute, schedule, or write credential values.
`,
    "package-inspect": `AgentMo package-inspect
Usage:
  agentmo package-inspect <directory> --manifest-sha256 sha256:<64hex> [--json]
  agentmo package-inspect <archive.d42> --archive-sha256 sha256:<64hex> [--json]
Contract: agentmo artifact-contract package-manifest --json
Inspection is offline and read-only. It verifies the complete manifest/inventory/member closure and does not install, activate, run OpenClaw, write credentials, register schedules, or certify runtime, domain, Birth, Delivery, or production behavior.
`,
    "openclaw-probe": `AgentMo openclaw-probe
Usage: agentmo openclaw-probe --archive <archive.d42> --archive-sha256 sha256:<64hex> --blueprint <blueprint.json> --blueprint-sha256 sha256:<64hex> --build-contract <contract.json> --build-contract-sha256 sha256:<64hex> --plan-approval <approval.json> --plan-approval-sha256 sha256:<64hex> --target-carrier-admission <admission.json> --target-carrier-admission-sha256 sha256:<64hex> --target-descriptor <descriptor.json> --target-descriptor-sha256 sha256:<64hex> --target-root <dir> --out <probe.json> [--json]
Contract: agentmo artifact-contract openclaw-probe --json
The probe binds exact package and target authorities, invokes only fixed read-only capability surfaces with shell:false in a disposable synthetic HOME, and does not install, activate, connect MCP, invoke an agent, schedule work, use credentials, or certify runtime, domain, Birth, Delivery, or production readiness.
`,
    "openclaw-install-genesis": `AgentMo openclaw-install-genesis
Usage: agentmo openclaw-install-genesis --archive <archive.d42> --archive-sha256 sha256:<64hex> --blueprint <blueprint.json> --blueprint-sha256 sha256:<64hex> --build-contract <contract.json> --build-contract-sha256 sha256:<64hex> --plan-approval <approval.json> --plan-approval-sha256 sha256:<64hex> --target-carrier-admission <admission.json> --target-carrier-admission-sha256 sha256:<64hex> --target-descriptor <descriptor.json> --target-descriptor-sha256 sha256:<64hex> --probe <probe.json> --probe-sha256 sha256:<64hex> --request <genesis-request.json> --request-sha256 sha256:<64hex> --target-root <isolated-root> --fs-helper <binary> --fs-helper-receipt <receipt.json> --fs-helper-receipt-digest sha256:<64hex> --out <absent.json> [--json]
Publishes one create-only verified-absence authority. It performs no install, target mutation, OpenClaw process, credential, MCP, or runtime action.
`,
    "openclaw-install-preview": `AgentMo openclaw-install-preview
Usage: agentmo openclaw-install-preview --lifecycle install|upgrade|rollback|uninstall --archive <archive.d42> --archive-sha256 sha256:<64hex> --blueprint <blueprint.json> --blueprint-sha256 sha256:<64hex> --build-contract <contract.json> --build-contract-sha256 sha256:<64hex> --plan-approval <approval.json> --plan-approval-sha256 sha256:<64hex> --target-carrier-admission <admission.json> --target-carrier-admission-sha256 sha256:<64hex> --target-descriptor <descriptor.json> --target-descriptor-sha256 sha256:<64hex> --probe <probe.json> --probe-sha256 sha256:<64hex> --request <preview-request.json> --request-sha256 sha256:<64hex> --openclaw-target-root <approved-openclaw-root> --target-root <isolated-root> --fs-helper <binary> --fs-helper-receipt <receipt.json> --fs-helper-receipt-digest sha256:<64hex> <exact lifecycle basis> --out <absent.json> [--json]
Install requires --absent-genesis plus its external digest. Upgrade/uninstall require --current-receipt plus its external digest. Rollback additionally requires exact predecessor receipt/archive pairs. No target mutation occurs.
${OPENCLAW_RECEIPT_COMPANION_HELP}
`,
    "openclaw-install-approve": `AgentMo openclaw-install-approve
Usage: agentmo openclaw-install-approve --plan <install-plan.json> --plan-sha256 sha256:<64hex> --request <approval-request.json> --request-sha256 sha256:<64hex> --ordinary-out <absent.json> --sensitive-out <absent.json>... --conflict-out <absent.json> [--json]
Publishes independent create-only ordinary, per-sensitive-action, and exact-conflict authority files from one frozen plan. It performs no lifecycle effect.
`,
    "openclaw-fs-kernel-build": `AgentMo openclaw-fs-kernel-build
Usage: agentmo openclaw-fs-kernel-build --binary-out <absent-private-path> --receipt-out <absent-private-path> [--json]
Builds the repository-owned retained-dirfd helper with the fixed system compiler, fixed argv, shell:false, and a closed environment. Both outputs must be absent. It performs no OpenClaw target mutation and does not use executable lookup, downloads, package lifecycle hooks, or apply-time autobuild.
`,
    "openclaw-install-apply": `AgentMo openclaw-install-apply
Usage: agentmo openclaw-install-apply --lifecycle install|upgrade|rollback|uninstall --blueprint <blueprint.json> --blueprint-sha256 sha256:<64hex> --build-contract <contract.json> --build-contract-sha256 sha256:<64hex> --plan-approval <approval.json> --plan-approval-sha256 sha256:<64hex> --target-descriptor <descriptor.json> --target-descriptor-sha256 sha256:<64hex> --target-carrier-admission <admission.json> --target-carrier-admission-sha256 sha256:<64hex> --archive <archive.d42> --archive-sha256 sha256:<64hex> --probe <probe.json> --probe-sha256 sha256:<64hex> --install-plan <plan.json> --install-plan-sha256 sha256:<64hex> --ordinary-approval <approval.json> --ordinary-approval-sha256 sha256:<64hex> --sensitive-decision <decision.json> --sensitive-decision-sha256 sha256:<64hex> [--conflict-approval <approval.json> --conflict-approval-sha256 sha256:<64hex>] [--absent-genesis <genesis.json> --absent-genesis-sha256 sha256:<64hex> | --current-receipt <receipt.json> --current-receipt-sha256 sha256:<64hex> [--predecessor-receipt <receipt.json> --predecessor-receipt-sha256 sha256:<64hex> --predecessor-archive <archive.d42> --predecessor-archive-sha256 sha256:<64hex>]] --fs-helper <absolute-helper> --fs-helper-receipt <receipt.json> --fs-helper-receipt-digest sha256:<64hex> --openclaw-target-root <approved-openclaw-root> --target-root <isolated-project-root> --out <absent-receipt.json> [--json]
Authority reservation requires --attempt-id <bounded-id>. The authority ledger path is derived from the exact target descriptor and reopened canonically; callers cannot select an authority or evidence root.
An exact --conflict-approval pair is required even when the approved conflict set is empty.
${OPENCLAW_RECEIPT_COMPANION_HELP}
Every authority is re-read from exact published bytes with its caller-supplied SHA-256 before the private journal or target effect. The command accepts no package root, manifest-only, force, purge, blanket-overwrite, credential-value, raw-output, or MCP option. Receipt evidence is bounded lifecycle mechanism evidence only and does not certify runtime, domain, Birth, Delivery, production, or wider OpenClaw compatibility.
`,
  };
  return Object.hasOwn(entries, command) ? entries[command] : null;
}
