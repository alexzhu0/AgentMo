import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const HOOK_PATH = new URL("../../plugin/hooks/agentmo-hook.js", import.meta.url);
const TEST_ONLY_SENTINEL = "--agentmo-hook-supervisor-signal-child";
const FUNCTION_SIGNATURE = "async function runAdjacentLauncher(inputBytes, paths) {";
const FUNCTION_END_MARKER = "\n}\n\nfunction admitBridgeResult";

function extractSupervisor(source) {
  const start = source.indexOf(FUNCTION_SIGNATURE);
  const end = source.indexOf(FUNCTION_END_MARKER, start);
  if (start === -1 || end === -1) throw new Error("Supervisor source unavailable.");
  return source.slice(start, end + 2);
}

function compileSupervisor(source, launcherUrl, launcherSource) {
  const loaderSource = [
    `const launcherUrl = ${JSON.stringify(launcherUrl)};`,
    `const launcherSource = ${JSON.stringify(launcherSource)};`,
    "export async function resolve(specifier, context, nextResolve) {",
    "  if (specifier === launcherUrl) return { url: launcherUrl, shortCircuit: true };",
    "  return nextResolve(specifier, context);",
    "}",
    "export async function load(url, context, nextLoad) {",
    "  if (url === launcherUrl) {",
    '    return { format: "module", source: launcherSource, shortCircuit: true };',
    "  }",
    "  return nextLoad(url, context);",
    "}",
  ].join("\n");
  return Function(
    "spawn",
    "AUTHENTICATED_BOOTSTRAP_LOADER_SOURCE",
    "CHILD_TIMEOUT_MS",
    "CHILD_TIMEOUT_SETTLEMENT_GRACE_MS",
    "MAX_CHILD_OUTPUT_BYTES",
    "process",
    `return (${extractSupervisor(source)});`,
  )(spawn, loaderSource, 5_000, 500, 16 * 1024, process);
}

async function main() {
  const root = path.resolve(process.argv[3]);
  const launcherPath = path.join(root, "virtual-launcher.js");
  const readyPath = path.join(root, "launcher-ready");
  const pidPath = path.join(root, "launcher-pid");
  const committedPath = path.join(root, "commit-before-cancel");
  const latePath = path.join(root, "late-effect");
  await writeFile(launcherPath, "", { flag: "wx", mode: 0o600 });
  const launcherUrl = pathToFileURL(launcherPath).href;
  const launcherSource = [
    'import { writeFileSync } from "node:fs";',
    `writeFileSync(${JSON.stringify(committedPath)}, "committed", { flag: "wx" });`,
    `writeFileSync(${JSON.stringify(pidPath)}, String(process.pid), { flag: "wx" });`,
    `writeFileSync(${JSON.stringify(readyPath)}, "ready", { flag: "wx" });`,
    `setTimeout(() => writeFileSync(${JSON.stringify(latePath)}, "late", { flag: "wx" }), 700);`,
    "setInterval(() => {}, 1_000);",
  ].join("\n");
  const run = compileSupervisor(await readFile(HOOK_PATH, "utf8"), launcherUrl, launcherSource);
  await run(Buffer.alloc(0), {
    projectRoot: root,
    launcherPath,
    runnerDigest: `sha256:${"a".repeat(64)}`,
    graph: {
      bytes: Buffer.from("{}\n", "utf8"),
      digest: `sha256:${"b".repeat(64)}`,
      launcherUrl,
    },
  });
  process.exitCode = 2;
}

if (process.argv[2] === TEST_ONLY_SENTINEL) {
  main().catch(() => {
    process.exitCode = 1;
  });
}
