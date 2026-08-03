import { spawn } from "node:child_process";
import {
  lstatSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SELF_PATH = fileURLToPath(import.meta.url);
const ATTACK_TIMEOUT_MS = 15_000;

export function startNativeBuildOutputAttacker(options) {
  const child = spawn(process.execPath, [
    SELF_PATH,
    "--attack",
    options.root,
    options.buildDirectoryPrefix,
    options.outputName,
  ], {
    shell: false,
    stdio: "ignore",
    windowsHide: true,
  });
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolve(signal === null ? code : 128);
    });
  });
  return Object.freeze({
    exited,
    stop() {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    },
  });
}

if (process.argv[2] === "--attack") {
  runAttacker({
    root: process.argv[3],
    buildDirectoryPrefix: process.argv[4],
    outputName: process.argv[5],
  });
}

function runAttacker(options) {
  const deadline = Date.now() + ATTACK_TIMEOUT_MS;
  const attempt = () => {
    try {
      for (const entry of readdirSync(options.root, { withFileTypes: true })) {
        if (!entry.isDirectory()
          || !entry.name.startsWith(options.buildDirectoryPrefix)) continue;
        const outputPath = path.join(options.root, entry.name, options.outputName);
        let stats;
        try {
          stats = lstatSync(outputPath);
        } catch (error) {
          if (error?.code === "ENOENT") continue;
          throw error;
        }
        if (!stats.isFile() || stats.size === 0) continue;
        renameSync(outputPath, `${outputPath}.compiler-retained`);
        writeFileSync(outputPath, "substituted-native-build-output\n", {
          flag: "wx",
          mode: 0o700,
        });
        process.exitCode = 0;
        return;
      }
    } catch {
      // Compiler output may be between create/replace transitions; retry.
    }
    if (Date.now() >= deadline) {
      process.exitCode = 2;
      return;
    }
    setImmediate(attempt);
  };
  attempt();
}
