import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { buildBirthReport, formatBirthReport, loadJsonArtifact } from "./birth-report.js";
import { loadBlueprint, validateBlueprint } from "./blueprint.js";
import { buildBlueprintDraftReport, draftBlueprint, formatBlueprintDraftReport, loadJsonFile, writeBlueprintDraft } from "./blueprint-draft.js";
import { buildDeliveryReport, formatDeliveryReport } from "./delivery-report.js";
import { buildDiscoveryPack, formatDiscoveryPack, writeDiscoveryPack } from "./discovery-db.js";
import { buildDiscoveryWorkspace, formatDiscoveryWorkspace, writeDiscoveryWorkspace } from "./discovery-source-workspace.js";
import { buildDiscoveryReport, formatDiscoveryReport, loadDiscoveryManifest } from "./discovery.js";
import { buildDomainEval, formatDomainEval, loadDomainCases } from "./domain-eval.js";
import { buildHandoffPackage, formatHandoffPackage, writeHandoffPackage } from "./handoff.js";
import { buildMotherReport, formatMotherReport } from "./report.js";
import { buildPlan } from "./build-plan.js";
import { buildRuntimePlan } from "./runtime-plan.js";
import { buildRunEvalVerified, buildRunReport, executeRuntimeRun, loadRunState, replayRunState, resolveLatestRunStateFromDir } from "./run-state.js";
import { buildRunObservation, writeRunObservation } from "./run-observation.js";
import { buildControlSnapshot, formatControlSnapshot, loadBuildState } from "./control-snapshot.js";
import { buildObservationReport, formatObservationReport, loadObservationRecord } from "./observation.js";
import { scaffoldAgent } from "./scaffold.js";
import { listTargetIds } from "./targets/registry.js";
import { buildUserNeedReport, formatUserNeedReport, loadUserNeed } from "./user-need.js";

export async function main(args) {
  const [command, ...rest] = args;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(helpText());
    return;
  }

  if (command === "validate") {
    const { file } = parseBlueprintArg(rest);
    const blueprint = await loadBlueprint(file);
    const result = validateBlueprint(blueprint);
    if (result.ok) {
      process.stdout.write(`PASS blueprint validation: ${file}\n`);
      if (result.warnings.length > 0) {
        for (const warning of result.warnings) process.stdout.write(`WARN ${warning}\n`);
      }
      return;
    }
    for (const error of result.errors) process.stderr.write(`ERROR ${error}\n`);
    for (const warning of result.warnings) process.stderr.write(`WARN ${warning}\n`);
    process.exitCode = 1;
    return;
  }

  if (command === "report") {
    const { file, json } = parseBlueprintArg(rest);
    const blueprint = await loadBlueprint(file);
    const report = buildMotherReport(blueprint, { blueprintPath: file });
    process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : formatMotherReport(report));
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (command === "discover-report") {
    const { file, json } = parseBlueprintArg(rest);
    const manifest = await loadDiscoveryManifest(file);
    const report = buildDiscoveryReport(manifest);
    process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : formatDiscoveryReport(report));
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (command === "discover-pack") {
    const options = parseDiscoverPackArgs(rest);
    const manifest = await loadDiscoveryManifest(options.file);
    const pack = buildDiscoveryPack(manifest, { manifestPath: options.file });
    const paths = await writeDiscoveryPack(options.out, pack);
    const result = { ...pack, paths };
    process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : formatDiscoveryPack(pack, paths));
    if (!pack.ok) process.exitCode = 1;
    return;
  }

  if (command === "discover-workspace") {
    const options = parseDiscoverWorkspaceArgs(rest);
    const manifest = await loadDiscoveryManifest(options.file);
    const workspace = await buildDiscoveryWorkspace(manifest, {
      manifestPath: options.file,
      sourceRoot: options.sourceRoot,
    });
    const paths = await writeDiscoveryWorkspace(options.out, workspace);
    const result = { ...workspace, paths };
    process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : formatDiscoveryWorkspace(workspace, paths));
    if (!workspace.ok) process.exitCode = 1;
    return;
  }

  if (command === "need-report") {
    const { file, json } = parseBlueprintArg(rest);
    const need = await loadUserNeed(file);
    const report = buildUserNeedReport(need);
    process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : formatUserNeedReport(report));
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (command === "blueprint-draft") {
    const options = parseBlueprintDraftArgs(rest);
    const discoveryDb = await loadJsonFile(options.file, "discovery-db");
    const userNeed = await loadUserNeed(options.need);
    const blueprint = draftBlueprint(discoveryDb, userNeed, { target: options.target });
    const blueprintPath = await writeBlueprintDraft(options.out, blueprint);
    const report = buildBlueprintDraftReport(blueprint, { blueprintPath });
    const result = { report, blueprint, blueprintPath };
    process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : formatBlueprintDraftReport(report));
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (command === "handoff") {
    const options = parseHandoffArgs(rest);
    const blueprint = await loadBlueprint(options.file);
    const handoffPackage = buildHandoffPackage(blueprint, { target: options.target });
    const paths = await writeHandoffPackage(options.out, handoffPackage);
    const result = { ...handoffPackage, paths };
    process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : formatHandoffPackage(handoffPackage, paths));
    if (!handoffPackage.ok) process.exitCode = 1;
    return;
  }

  if (command === "status") {
    const options = parseStatusArgs(rest);
    const blueprint = await loadBlueprint(options.file);
    const buildStateOptions = await loadOptionalBuildState(options.buildStatePath);
    const runStateOptions = await loadOptionalRunState(options.runStatePath, options.runDir);
    const snapshot = buildControlSnapshot(blueprint, { ...buildStateOptions, ...runStateOptions });
    process.stdout.write(options.json ? `${JSON.stringify(snapshot, null, 2)}\n` : formatControlSnapshot(snapshot));
    if (!snapshot.validation.ok) process.exitCode = 1;
    return;
  }

  if (command === "plan") {
    const options = parsePlanArgs(rest);
    const blueprint = await loadBlueprint(options.file);
    const plan = buildPlan(blueprint, { target: options.target });
    process.stdout.write(options.json ? `${JSON.stringify(plan, null, 2)}\n` : formatBuildPlan(plan));
    return;
  }

  if (command === "run-plan") {
    const options = await parseRunPlanArgs(rest);
    const blueprint = await loadBlueprint(options.file);
    const plan = buildRuntimePlan(blueprint, options);
    process.stdout.write(options.json ? `${JSON.stringify(plan, null, 2)}\n` : formatRuntimePlan(plan));
    return;
  }

  if (command === "run") {
    const options = await parseRunArgs(rest);
    const blueprint = await loadBlueprint(options.file);
    const result = await executeRuntimeRun(blueprint, options);
    process.stdout.write(options.json ? `${JSON.stringify(result.runState, null, 2)}\n` : formatRunState(result));
    return;
  }

  if (command === "run-report") {
    const { file, json } = parseRunStateFileArg(rest, "run-report");
    const runState = await loadRunState(file);
    const report = buildRunReport(runState);
    process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : formatRunReport(report));
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (command === "replay-run") {
    const options = await parseReplayRunArgs(rest);
    const runState = await loadRunState(options.file);
    const result = await replayRunState(runState, options);
    process.stdout.write(options.json ? `${JSON.stringify(result.runState, null, 2)}\n` : formatRunState(result));
    return;
  }

  if (command === "run-eval") {
    const options = parseRunEvalArgs(rest);
    const runState = await loadRunState(options.file);
    const report = await buildRunEvalVerified(runState, { expectStatus: options.expectStatus, requireExactReplay: options.requireExactReplay });
    process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatRunEval(report));
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (command === "birth-report") {
    const options = parseBirthReportArgs(rest);
    const blueprint = await loadBlueprint(options.file);
    const buildState = await loadBuildState(options.buildStatePath);
    const runState = await loadRunState(options.runStatePath);
    const runEval = await loadJsonArtifact(options.runEvalPath, "run-eval");
    const report = buildBirthReport(blueprint, {
      blueprintPath: options.file,
      buildState,
      buildStatePath: options.buildStatePath,
      runState,
      runStatePath: options.runStatePath,
      runEval,
      runEvalPath: options.runEvalPath,
      expectStatus: options.expectStatus,
    });
    process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatBirthReport(report));
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (command === "domain-eval") {
    const options = parseDomainEvalArgs(rest);
    const blueprint = await loadBlueprint(options.file);
    const domainCases = await loadDomainCases(options.casesPath);
    const report = buildDomainEval(blueprint, domainCases, {
      blueprintPath: options.file,
      casesPath: options.casesPath,
      target: options.target,
    });
    process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatDomainEval(report));
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (command === "delivery-report") {
    const options = parseDeliveryReportArgs(rest);
    const blueprint = await loadBlueprint(options.file);
    const buildState = await loadJsonArtifact(options.buildStatePath, "build-state");
    const runState = await loadJsonArtifact(options.runStatePath, "run-state");
    const runEval = await loadJsonArtifact(options.runEvalPath, "run-eval");
    const birthReport = await loadJsonArtifact(options.birthReportPath, "birth-report");
    const domainEval = options.domainEvalPath ? await loadJsonArtifact(options.domainEvalPath, "domain-eval") : null;
    const report = buildDeliveryReport(blueprint, {
      blueprintPath: options.file,
      buildState,
      buildStatePath: options.buildStatePath,
      runState,
      runStatePath: options.runStatePath,
      runEval,
      runEvalPath: options.runEvalPath,
      birthReport,
      birthReportPath: options.birthReportPath,
      domainEval,
      domainEvalPath: options.domainEvalPath,
    });
    process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatDeliveryReport(report));
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (command === "observe-run") {
    const options = parseObserveRunArgs(rest);
    const runState = await loadRunState(options.file);
    const observation = buildRunObservation(runState, { runStatePath: options.file });
    const observationFile = await writeRunObservation(options.out, observation);
    const report = buildObservationReport(observation);
    const result = { observationFile, observation, report };
    process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : formatRunObservationResult(result));
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (command === "scaffold") {
    const options = parseScaffoldArgs(rest);
    const blueprint = await loadBlueprint(options.file);
    const result = await scaffoldAgent(blueprint, options.out, {
      blueprintPath: options.file,
      force: options.force,
      target: options.target,
    });
    process.stdout.write(`Scaffolded ${result.files.length} files into ${result.outputDir} for target ${result.target}\n`);
    for (const file of result.files) process.stdout.write(`- ${file}\n`);
    process.stdout.write(`Build state: ${result.stateFile}\n`);
    return;
  }

  if (command === "observe") {
    const { file, json } = parseBlueprintArg(rest);
    const observation = await loadObservationRecord(file);
    const report = buildObservationReport(observation);
    process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : formatObservationReport(report));
    if (!report.ok) process.exitCode = 1;
    return;
  }

  throw new Error(`Unknown command: ${command}\n\n${helpText()}`);
}

function parseBlueprintArg(args) {
  const json = args.includes("--json");
  const filtered = args.filter((arg) => arg !== "--json");
  const file = filtered[0];
  if (!file) throw new Error("Missing blueprint file path.");
  return { file: resolve(file), json };
}

function parseDiscoverPackArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing discovery manifest file path.");
  let out = null;
  let json = false;
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--out") {
      out = args[index + 1];
      index += 1;
    } else if (arg === "--json") {
      json = true;
    } else {
      throw new Error(`Unknown discover-pack option: ${arg}`);
    }
  }
  requireOptionValue(out, "--out");
  return { file: resolve(file), out: resolve(out), json };
}

function parseDiscoverWorkspaceArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing discovery manifest file path.");
  let sourceRoot = null;
  let out = null;
  let json = false;
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
    } else {
      throw new Error(`Unknown discover-workspace option: ${arg}`);
    }
  }
  requireOptionValue(sourceRoot, "--source-root");
  requireOptionValue(out, "--out");
  return { file: resolve(file), sourceRoot: resolve(sourceRoot), out: resolve(out), json };
}

function parseBlueprintDraftArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing discovery-db file path.");
  let need = null;
  let out = null;
  let target = "openclaw";
  let json = false;
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
    } else if (arg === "--json") {
      json = true;
    } else {
      throw new Error(`Unknown blueprint-draft option: ${arg}`);
    }
  }
  requireOptionValue(need, "--need");
  requireOptionValue(out, "--out");
  assertKnownTarget(target, "blueprint-draft target");
  return { file: resolve(file), need: resolve(need), out: resolve(out), target, json };
}

function parseHandoffArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing blueprint file path.");
  let target = "openclaw";
  let out = null;
  let json = false;
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
    } else {
      throw new Error(`Unknown handoff option: ${arg}`);
    }
  }
  requireOptionValue(out, "--out");
  assertKnownTarget(target, "handoff target");
  return { file: resolve(file), target, out: resolve(out), json };
}

function parseBirthReportArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing blueprint file path.");
  let buildStatePath = null;
  let runStatePath = null;
  let runEvalPath = null;
  let expectStatus = null;
  let json = false;
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
  return {
    file: resolve(file),
    buildStatePath: resolve(buildStatePath),
    runStatePath: resolve(runStatePath),
    runEvalPath: resolve(runEvalPath),
    expectStatus,
    json,
  };
}

function parseDomainEvalArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing blueprint file path for domain-eval.");
  let casesPath = null;
  let target = null;
  let json = false;
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
    } else {
      throw new Error(`Unknown domain-eval option: ${arg}`);
    }
  }
  requireOptionValue(casesPath, "--cases");
  if (target !== null) {
    requireOptionValue(target, "--target");
    assertKnownTarget(target, "domain-eval target");
  }
  return { file: resolve(file), casesPath: resolve(casesPath), target, json };
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
    } else {
      throw new Error(`Unknown delivery-report option: ${arg}`);
    }
  }
  requireOptionValue(buildStatePath, "--build-state");
  requireOptionValue(runStatePath, "--run-state");
  requireOptionValue(runEvalPath, "--run-eval");
  requireOptionValue(birthReportPath, "--birth-report");
  if (domainEvalPath !== null) requireOptionValue(domainEvalPath, "--domain-eval");
  return {
    file: resolve(file),
    buildStatePath: resolve(buildStatePath),
    runStatePath: resolve(runStatePath),
    runEvalPath: resolve(runEvalPath),
    birthReportPath: resolve(birthReportPath),
    domainEvalPath: domainEvalPath ? resolve(domainEvalPath) : null,
    json,
  };
}

function parseStatusArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing blueprint file path.");
  let json = false;
  let buildStatePath = null;
  let runStatePath = null;
  let runDir = null;
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
    } else {
      throw new Error(`Unknown status option: ${arg}`);
    }
  }
  return {
    file: resolve(file),
    json,
    buildStatePath: buildStatePath ? resolve(buildStatePath) : null,
    runStatePath: runStatePath ? resolve(runStatePath) : null,
    runDir: runDir ? resolve(runDir) : null,
  };
}

async function loadOptionalBuildState(buildStatePath) {
  if (!buildStatePath) return {};
  try {
    return { buildState: await loadBuildState(buildStatePath), buildStatePath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { buildStatePath, buildStateError: message };
  }
}

async function loadOptionalRunState(runStatePath, runDir) {
  if (runStatePath) {
    try {
      return { runState: await loadRunState(runStatePath), runStatePath };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { runStatePath, runStateError: message };
    }
  }
  if (runDir) {
    try {
      const resolved = await resolveLatestRunStateFromDir(runDir);
      return { runState: resolved.runState, runStatePath: resolved.runStatePath };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { runStatePath: runDir, runStateError: message };
    }
  }
  return {};
}

function parsePlanArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing blueprint file path.");
  let json = false;
  let target = "agentmo";
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--target") {
      target = args[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown plan option: ${arg}`);
    }
  }
  assertKnownTarget(target, "plan target");
  return { file: resolve(file), json, target };
}

async function parseRunPlanArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing blueprint file path.");
  const options = {
    file: resolve(file),
    target: "openclaw",
    workspace: null,
    agent: null,
    sessionKey: null,
    sessionId: null,
    to: null,
    message: undefined,
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
    } else if (arg === "--env-file") {
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
  if (options.message === undefined) {
    if (options.messageFile !== null) {
      requireOptionValue(options.messageFile, "--message-file");
      options.messageFile = resolve(options.messageFile);
      options.messageFileContent = await readFile(options.messageFile, "utf8");
    }
  } else {
    requireOptionValue(options.message, "--message");
  }
  if (options.envFile !== null) {
    requireOptionValue(options.envFile, "--env-file");
    options.envFile = resolve(options.envFile);
    options.envFileContent = await readFile(options.envFile, "utf8");
  }
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
  return options;
}

async function parseRunArgs(args) {
  const runPlanArgs = [];
  let out = null;
  let live = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--out") {
      out = args[index + 1];
      index += 1;
    } else if (arg === "--live") {
      live = true;
    } else {
      runPlanArgs.push(arg);
    }
  }
  requireOptionValue(out, "--out");
  const options = await parseRunPlanArgs(runPlanArgs);
  return { ...options, out: resolve(out), live };
}

function parseRunStateFileArg(args, commandName) {
  const file = args[0];
  if (!file) throw new Error(`Missing run-state file path for ${commandName}.`);
  let json = false;
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") json = true;
    else throw new Error(`Unknown ${commandName} option: ${arg}`);
  }
  return { file: resolve(file), json };
}

async function parseReplayRunArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing run-state file path for replay-run.");
  let out = null;
  let envFile = null;
  let envFileContent = undefined;
  let live = false;
  let json = false;
  let resumeSession = false;
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--out") {
      out = args[index + 1];
      index += 1;
    } else if (arg === "--env-file") {
      envFile = args[index + 1];
      index += 1;
    } else if (arg === "--live") {
      live = true;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--resume-session") {
      resumeSession = true;
    } else {
      throw new Error(`Unknown replay-run option: ${arg}`);
    }
  }
  requireOptionValue(out, "--out");
  if (envFile !== null) {
    requireOptionValue(envFile, "--env-file");
    envFile = resolve(envFile);
    envFileContent = await readFile(envFile, "utf8");
  }
  return { file: resolve(file), out: resolve(out), envFile, envFileContent, live, json, resumeSession };
}

function parseRunEvalArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing run-state file path for run-eval.");
  let json = false;
  let expectStatus = null;
  let requireExactReplay = false;
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--require-exact-replay") {
      requireExactReplay = true;
    } else if (arg === "--expect-status") {
      expectStatus = args[index + 1];
      requireOptionValue(expectStatus, "--expect-status");
      index += 1;
    } else {
      throw new Error(`Unknown run-eval option: ${arg}`);
    }
  }
  return { file: resolve(file), json, expectStatus, requireExactReplay };
}

function parseObserveRunArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing run-state file path for observe-run.");
  let out = null;
  let json = false;
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--out") {
      out = args[index + 1];
      index += 1;
    } else if (arg === "--json") {
      json = true;
    } else {
      throw new Error(`Unknown observe-run option: ${arg}`);
    }
  }
  requireOptionValue(out, "--out");
  return { file: resolve(file), out: resolve(out), json };
}

function requireOptionValue(value, optionName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing ${optionName} <value>.`);
  }
}

function parseScaffoldArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing blueprint file path.");
  let out;
  let force = false;
  let target = "agentmo";
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
    } else {
      throw new Error(`Unknown scaffold option: ${arg}`);
    }
  }
  if (!out) throw new Error("Missing --out <dir> for scaffold.");
  assertKnownTarget(target, "scaffold target");
  return { file: resolve(file), out: resolve(out), force, target };
}

function assertKnownTarget(target, subject) {
  const targets = listTargetIds();
  if (!targets.includes(target)) {
    throw new Error(`Unknown ${subject}: ${target}. Expected one of: ${targets.join(", ")}`);
  }
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
    `Workspace: ${plan.runtimeIdentity.workspace}`,
    `Command: ${plan.command.display}`,
    "Certification: not implied by runtime command planning",
  ];
  for (const surface of plan.unsupportedSurfaces) lines.push(`UNSUPPORTED ${surface}`);
  return `${lines.join("\n")}\n`;
}

function formatRunState(result) {
  const state = result.runState;
  const lines = [
    `AgentMo run: ${state.runId}`,
    `Agent: ${state.agentId}`,
    `Target: ${state.target.id}`,
    `Executed: ${state.execution.executed}`,
    `Status: ${state.execution.status}`,
    `Run state: ${result.stateFile ?? "not written"}`,
    `Run index: ${result.indexFile ?? "not written"}`,
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
    `AgentMo observe-run: ${result.observation.source}`,
    `Observation: ${result.observationFile}`,
    `Status: ${result.report.ok ? "valid" : "invalid"}`,
    `Failure mode: ${result.observation.failureMode}`,
    "Mutation: proposal only",
  ];
  return `${lines.join("\n")}\n`;
}

function helpText() {
  return `AgentMo / AgentMother CLI

Usage:
  agentmo validate <blueprint.json>
  agentmo report <blueprint.json> [--json]
  agentmo discover-report <discovery.json> [--json]
  agentmo discover-pack <discovery.json> --out <dir> [--json]
  agentmo discover-workspace <discovery.json> --source-root <dir> --out <dir> [--json]
  agentmo need-report <need.json> [--json]
  agentmo blueprint-draft <agentmo-discovery-db.json> --need <need.json> --out <blueprint.json> [--target agentmo|openclaw] [--json]
  agentmo handoff <blueprint.json> --target agentmo|openclaw --out <dir> [--json]
  agentmo status <blueprint.json> [--build-state <path>] [--run-state <path>|--run-dir <dir>] [--json]
  agentmo plan <blueprint.json> [--target agentmo|openclaw] [--json]
  agentmo run-plan <blueprint.json> --target openclaw --workspace <dir> [--agent <id>] [--session-key <key>|--session-id <id>|--to <dest>] [--message <text>|--message-file <path>] [--env-file <path>] [--provider <name>] [--model <name>] [--thinking off|minimal|low|medium|high|adaptive|xhigh|max] [--channel <name>] [--transport gateway|local|embedded-fallback|unknown] [--fallback-from <runtime>] [--openclaw-state-dir <dir>|--use-production-openclaw-state] [--timeout-ms <ms>] [--json]
  agentmo run <blueprint.json> --target openclaw --workspace <dir> --message <text> --out <dir> [--agent <id>] [--env-file <path>] [--provider <name>] [--model <name>] [--thinking off|minimal|low|medium|high|adaptive|xhigh|max] [--channel <name>] [--transport gateway|local|embedded-fallback|unknown] [--fallback-from <runtime>] [--openclaw-state-dir <dir>|--use-production-openclaw-state] [--timeout-ms <ms>] [--live] [--json]
  agentmo run-report <run-state.json> [--json]
  agentmo replay-run <run-state.json> --out <dir> [--env-file <path>] [--resume-session] [--live] [--json]
  agentmo run-eval <run-state.json> [--expect-status success|failure|declared] [--require-exact-replay] [--json]
  agentmo birth-report <blueprint.json> --build-state <agentmo-build-state.json> --run-state <agentmo-run-state.json> --run-eval <run-eval.json> --expect-status success|declared|failure [--json]
  agentmo domain-eval <blueprint.json> --cases <cases.json> [--target agentmo|openclaw] [--json]
  agentmo delivery-report <blueprint.json> --build-state <agentmo-build-state.json> --run-state <agentmo-run-state.json> --run-eval <run-eval.json> --birth-report <birth-report.json> [--domain-eval <domain-eval.json>] [--json]
  agentmo observe-run <run-state.json> --out <observation.json> [--json]
  agentmo scaffold <blueprint.json> --out <dir> [--target agentmo|openclaw] [--force]
  agentmo observe <observation.json> [--json]

Concepts:
  validate         Check an AgentMother blueprint and its quality gates.
  report           Build a human or JSON AgentMother readiness report.
  discover-report  Validate and summarize a discovery/input manifest.
  discover-pack    Materialize a sanitized discovery database, facts JSONL, and coverage report.
  discover-workspace  Read approved repo-bound local sources into sanitized Stage 1 discovery artifacts.
  need-report      Validate and summarize a concrete user-need brief.
  blueprint-draft  Draft a valid AgentMo blueprint from discovery data plus user need.
  handoff          Write a coding/runtime handoff package for the generated blueprint.
  status           Build an auditable control snapshot from blueprint plus optional build/run state.
  plan             Dry-run deterministic scaffold operations without writing files.
  run-plan         Dry-run OpenClaw runtime command/evidence planning without executing OpenClaw.
  run              Write bounded OpenClaw run-state evidence; --live is explicit opt-in.
  run-report       Summarize run-state evidence without changing blueprint status.
  replay-run       Reconstruct a prior run into a fresh child session unless --resume-session is explicit.
  run-eval         Evaluate evidence completeness without certifying runtime/domain behavior.
  birth-report     Fail-closed birth gate over blueprint, build-state, run-state, and run-eval evidence.
  domain-eval      Evaluate deterministic domain cases with bounded evidence refs; certifies only supplied cases.
  delivery-report  Re-validate and aggregate delivery closure evidence; does not itself certify runtime/domain-wide/production.
  observe-run      Convert run-state evidence into a proposal-only observation record.
  scaffold         Generate a domain-agent harness. Use --target openclaw for an OpenClaw workspace scaffold.
  observe          Validate and summarize an observe/evolve record without applying changes.
`;
}
