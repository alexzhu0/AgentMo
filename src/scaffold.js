import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import {
  BUILD_STATE_FILENAME,
  buildStatePath,
  createBuildState,
  serializeBuildState,
} from "./build-state.js";
import { buildPlan } from "./build-plan.js";
import { assertCurrentOpenClawTargetRuntime } from "./runtime-compatibility.js";
import {
  preparePersistableProductText,
  writePersistableProductTextAtomic,
  writePersistableTextAtomic,
} from "./persistability.js";
import { listTargetIds } from "./targets/registry.js";

export const SCAFFOLD_TARGETS = new Set(listTargetIds());

export async function scaffoldAgent(blueprint, outputDir, options = {}) {
  const root = normalizeOutputRoot(outputDir);
  const plan = buildPlan(blueprint, {
    target: options.target,
    profile: options.profile,
    profileId: options.profileId,
  });
  if (plan.selectedTargetId === "openclaw") assertCurrentOpenClawTargetRuntime();
  const state = await createBuildState(blueprint, plan, {
    admission: options.admission,
    generatedAt: options.generatedAt,
    target: options.target,
    profile: options.profile,
    profileId: options.profileId,
  });

  // Materialize and validate the complete byte set before any mkdir/write.
  const operations = preflightScaffoldOperations(plan.operations);
  const stateText = serializeBuildState(state);

  await assertTargetWritable(root, options.force === true);
  await assertNoExistingSymlink(root, [...operations.map((operation) => operation.relativePath), BUILD_STATE_FILENAME]);

  for (const operation of operations) {
    await writePersistableProductTextAtomic(
      path.join(root, operation.relativePath),
      operation.candidate,
      { subject: "scaffold-file" },
    );
  }

  const stateFile = buildStatePath(root);
  await writePersistableTextAtomic(stateFile, stateText, { subject: "build-state-file" });

  return {
    outputDir: root,
    target: plan.selectedTargetId,
    files: operations.map((operation) => operation.relativePath),
    stateFile,
    plan,
  };
}

function preflightScaffoldOperations(plannedOperations) {
  if (!Array.isArray(plannedOperations)) fail("AGENTMO_SCAFFOLD_OPERATIONS_INVALID");
  const seen = new Set();
  const caseFolded = new Set();
  const paths = [];
  const materialized = [];
  let previous = null;

  for (const operation of plannedOperations) {
    if (!hasExactOperationShape(operation)
      || operation.kind !== "write-file"
      || operation.ownership !== "managed"
      || operation.scaffoldOnly !== true
      || typeof operation.source !== "string"
      || operation.source.length === 0
      || !isManagedRelativePath(operation.relativePath)
      || operation.relativePath === BUILD_STATE_FILENAME
      || seen.has(operation.relativePath)
      || caseFolded.has(operation.relativePath.toLowerCase())
      || (previous !== null && comparePaths(previous, operation.relativePath) >= 0)
      || paths.some((existing) => isPathPrefix(existing, operation.relativePath))) {
      fail("AGENTMO_SCAFFOLD_OPERATIONS_INVALID");
    }
    const contentDescriptor = Object.getOwnPropertyDescriptor(operation, "content");
    if (!contentDescriptor || !Object.hasOwn(contentDescriptor, "value") || typeof contentDescriptor.value !== "string") {
      fail("AGENTMO_SCAFFOLD_OPERATIONS_INVALID");
    }
    const candidate = preparePersistableProductText(contentDescriptor.value, { subject: "scaffold-file" });
    seen.add(operation.relativePath);
    caseFolded.add(operation.relativePath.toLowerCase());
    paths.push(operation.relativePath);
    previous = operation.relativePath;
    materialized.push(Object.freeze({ relativePath: operation.relativePath, candidate }));
  }
  return Object.freeze(materialized);
}

function hasExactOperationShape(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Reflect.ownKeys(value);
  const expected = new Set(["kind", "relativePath", "ownership", "source", "scaffoldOnly", "content"]);
  return keys.length === expected.size
    && keys.every((key) => typeof key === "string" && expected.has(key));
}

function isManagedRelativePath(value) {
  if (typeof value !== "string"
    || value.length === 0
    || value.includes("\0")
    || value.includes("\\")
    || path.posix.isAbsolute(value)) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
    && path.posix.normalize(value) === value;
}

function isPathPrefix(left, right) {
  return left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function comparePaths(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizeOutputRoot(outputDir) {
  if (typeof outputDir !== "string" || outputDir.length === 0 || outputDir.includes("\0")) {
    fail("AGENTMO_SCAFFOLD_OUTPUT_INVALID");
  }
  return path.resolve(outputDir);
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

async function assertNoExistingSymlink(root, relativePaths) {
  for (const relativePath of relativePaths) {
    const segments = relativePath.split("/");
    for (let index = 0; index <= segments.length; index += 1) {
      const candidate = index === 0 ? root : path.join(root, ...segments.slice(0, index));
      try {
        const metadata = await lstat(candidate);
        if (metadata.isSymbolicLink()) fail("AGENTMO_SCAFFOLD_SYMLINK_REJECTED");
      } catch (error) {
        if (error?.code === "ENOENT") break;
        throw error;
      }
    }
  }
}

function fail(code) {
  const error = new Error("Scaffold candidate is not safe to persist.");
  error.code = code;
  throw error;
}
