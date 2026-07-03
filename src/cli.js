import { resolve } from "node:path";
import { loadBlueprint, validateBlueprint } from "./blueprint.js";
import { buildDiscoveryReport, formatDiscoveryReport, loadDiscoveryManifest } from "./discovery.js";
import { buildMotherReport, formatMotherReport } from "./report.js";
import { buildPlan } from "./build-plan.js";
import { buildControlSnapshot, formatControlSnapshot, loadBuildState } from "./control-snapshot.js";
import { buildObservationReport, formatObservationReport, loadObservationRecord } from "./observation.js";
import { buildMotherReport, formatMotherReport } from "./report.js";
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

  if (command === "plan") {
    const options = parsePlanArgs(rest);
    const blueprint = await loadBlueprint(options.file);
    const plan = buildPlan(blueprint, { target: options.target });
    process.stdout.write(options.json ? `${JSON.stringify(plan, null, 2)}\n` : formatBuildPlan(plan));
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
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--build-state") {
      buildStatePath = args[index + 1];
      if (!buildStatePath) throw new Error("Missing --build-state <path> for status.");
      index += 1;
    } else {
      throw new Error(`Unknown status option: ${arg}`);
    }
  }
  return { file: resolve(file), json, buildStatePath: buildStatePath ? resolve(buildStatePath) : null };
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

function helpText() {
  return `AgentMo / AgentMother CLI\n\nUsage:\n  agentmo validate <blueprint.json>\n  agentmo report <blueprint.json> [--json]\n  agentmo discover-report <discovery.json> [--json]\n  agentmo plan <blueprint.json> [--target agentmo|openclaw] [--json]\n  agentmo scaffold <blueprint.json> --out <dir> [--target agentmo|openclaw] [--force]\n\nConcepts:\n  validate  Check an AgentMother blueprint and its quality gates.\n  report    Build a human or JSON AgentMother readiness report.
  discover-report  Validate and summarize a discovery/input manifest.
  plan      Dry-run deterministic scaffold operations without writing files.
  scaffold  Generate a domain-agent harness. Use --target openclaw for an OpenClaw workspace scaffold.
  observe   Validate and summarize an observe/evolve record without applying changes.\n`;
}
