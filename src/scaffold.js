import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildPlan } from "./build-plan.js";
import { listTargetIds } from "./targets/registry.js";

export const SCAFFOLD_TARGETS = new Set(listTargetIds());

export async function scaffoldAgent(blueprint, outputDir, options = {}) {
  const plan = buildPlan(blueprint, { target: options.target, outputDir });

  await assertTargetWritable(outputDir, options.force === true);
  await mkdir(outputDir, { recursive: true });

  for (const operation of plan.operations) {
    if (operation.kind !== "write-file") continue;
    if (typeof operation.content !== "string") {
      throw new Error(`Cannot apply operation without generated content: ${operation.relativePath}`);
    }
    const filePath = operation.destinationPath ?? path.join(outputDir, operation.relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, operation.content, "utf8");
  }

  return {
    outputDir,
    target: plan.selectedTargetId,
    files: plan.operations.map((operation) => operation.relativePath).sort(),
    plan,
  };
}

async function assertTargetWritable(outputDir, force) {
  let entries = [];
  try {
    entries = await readdir(outputDir);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  if (entries.length > 0 && !force) {
    throw new Error(`Refusing to scaffold into non-empty directory: ${outputDir}. Pass --force to overwrite generated files.`);
  }
}
