import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { loadBlueprint, validateBlueprint } from "./blueprint.js";
import { buildDiscoveryReport, formatDiscoveryReport, loadDiscoveryManifest } from "./discovery.js";
import { buildMotherReport, formatMotherReport } from "./report.js";
import { buildPlan } from "./build-plan.js";
import { buildRuntimePlan } from "./runtime-plan.js";
import { buildRunEvalVerified, buildRunReport, executeRuntimeRun, loadRunState, replayRunState, resolveLatestRunStateFromDir } from "./run-state.js";
import { buildRunObservation, writeRunObservation } from "./run-observation.js";
import { buildControlSnapshot, formatControlSnapshot, loadBuildState } from "./control-snapshot.js";
import { buildObservationReport, formatObservationReport, loadObservationRecord } from "./observation.js";
import { scaffoldAgent } from "./scaffold.js";
import { listTargetIds } from "./targets/registry.js";

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
    const options = parseReplayRunArgs(rest);
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
    openClawSourceRoot: null,
    openClawStateDir: null,
    useProductionOpenClawState: false,
    provider: null,
    model: null,
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

function parseReplayRunArgs(args) {
  const file = args[0];
  if (!file) throw new Error("Missing run-state file path for replay-run.");
  let out = null;
  let live = false;
  let json = false;
  let resumeSession = false;
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--out") {
      out = args[index + 1];
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
  return { file: resolve(file), out: resolve(out), live, json, resumeSession };
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
  agentmo status <blueprint.json> [--build-state <path>] [--run-state <path>|--run-dir <dir>] [--json]
  agentmo plan <blueprint.json> [--target agentmo|openclaw] [--json]
  agentmo run-plan <blueprint.json> --target openclaw --workspace <dir> [--agent <id>] [--session-key <key>|--session-id <id>|--to <dest>] [--message <text>|--message-file <path>] [--provider <name>] [--model <name>] [--channel <name>] [--transport gateway|local|embedded-fallback|unknown] [--fallback-from <runtime>] [--openclaw-state-dir <dir>|--use-production-openclaw-state] [--timeout-ms <ms>] [--json]
  agentmo run <blueprint.json> --target openclaw --workspace <dir> --message <text> --out <dir> [--agent <id>] [--provider <name>] [--model <name>] [--channel <name>] [--transport gateway|local|embedded-fallback|unknown] [--fallback-from <runtime>] [--openclaw-state-dir <dir>|--use-production-openclaw-state] [--timeout-ms <ms>] [--live] [--json]
  agentmo run-report <run-state.json> [--json]
  agentmo replay-run <run-state.json> --out <dir> [--resume-session] [--live] [--json]
  agentmo run-eval <run-state.json> [--expect-status success|failure|declared] [--require-exact-replay] [--json]
  agentmo observe-run <run-state.json> --out <observation.json> [--json]
  agentmo scaffold <blueprint.json> --out <dir> [--target agentmo|openclaw] [--force]
  agentmo observe <observation.json> [--json]

Concepts:
  validate         Check an AgentMother blueprint and its quality gates.
  report           Build a human or JSON AgentMother readiness report.
  discover-report  Validate and summarize a discovery/input manifest.
  status           Build an auditable control snapshot from blueprint plus optional build/run state.
  plan             Dry-run deterministic scaffold operations without writing files.
  run-plan         Dry-run OpenClaw runtime command/evidence planning without executing OpenClaw.
  run              Write bounded OpenClaw run-state evidence; --live is explicit opt-in.
  run-report       Summarize run-state evidence without changing blueprint status.
  replay-run       Reconstruct a prior run into a fresh child session unless --resume-session is explicit.
  run-eval         Evaluate evidence completeness without certifying runtime/domain behavior.
  observe-run      Convert run-state evidence into a proposal-only observation record.
  scaffold         Generate a domain-agent harness. Use --target openclaw for an OpenClaw workspace scaffold.
  observe          Validate and summarize an observe/evolve record without applying changes.
`;
}
