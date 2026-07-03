import { resolve } from "node:path";
import { loadBlueprint, validateBlueprint } from "./blueprint.js";
import { buildMotherReport, formatMotherReport } from "./report.js";
import { SCAFFOLD_TARGETS, scaffoldAgent } from "./scaffold.js";

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
    const report = buildMotherReport(blueprint);
    process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : formatMotherReport(report));
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (command === "scaffold") {
    const options = parseScaffoldArgs(rest);
    const blueprint = await loadBlueprint(options.file);
    const result = await scaffoldAgent(blueprint, options.out, { force: options.force, target: options.target });
    process.stdout.write(`Scaffolded ${result.files.length} files into ${result.outputDir} for target ${result.target}\n`);
    for (const file of result.files) process.stdout.write(`- ${file}\n`);
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
  if (!SCAFFOLD_TARGETS.has(target)) {
    throw new Error(`Unknown scaffold target: ${target}. Expected one of: ${Array.from(SCAFFOLD_TARGETS).join(", ")}`);
  }
  return { file: resolve(file), out: resolve(out), force, target };
}

function helpText() {
  return `AgentMo / AgentMother CLI\n\nUsage:\n  agentmo validate <blueprint.json>\n  agentmo report <blueprint.json> [--json]\n  agentmo scaffold <blueprint.json> --out <dir> [--target agentmo|openclaw] [--force]\n\nConcepts:\n  validate  Check an AgentMother blueprint and its quality gates.\n  report    Build a human or JSON AgentMother readiness report.\n  scaffold  Generate a domain-agent harness. Use --target openclaw for an OpenClaw workspace scaffold.\n`;
}
