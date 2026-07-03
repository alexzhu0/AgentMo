import { createHash } from "node:crypto";
import path from "node:path";

export const BUILD_STATE_SCHEMA_VERSION = "agentmo.build.v1";
export const BUILD_STATE_FILENAME = "agentmo-build-state.json";

export function createBuildState(blueprint, plan, options = {}) {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const outputDir = options.outputDir ? path.resolve(options.outputDir) : null;
  const operationSummaries = plan.operations.map((operation) => summarizeOperation(operation));

  return {
    schemaVersion: BUILD_STATE_SCHEMA_VERSION,
    generatedAt,
    agentId: blueprint.agent_id,
    target: {
      id: plan.selectedTargetId,
      label: plan.target?.label ?? plan.selectedTargetId,
      verificationHints: plan.target?.verificationHints ?? [],
      unsupportedSurfaces: plan.target?.unsupportedSurfaces ?? [],
    },
    request: {
      blueprintPath: options.blueprintPath ? path.resolve(options.blueprintPath) : null,
      outputDir,
      target: options.target ?? plan.selectedTargetId,
      force: options.force === true,
      profile: options.profile ?? options.profileId ?? null,
    },
    resolution: {
      selectedTargetId: plan.selectedTargetId,
      selectedProfileId: plan.selectedProfileId,
      selectedModuleIds: plan.selectedModuleIds,
      domainOperationCount: plan.domainOperationCount,
      warnings: plan.warnings,
    },
    source: {
      agentmotherVersion: blueprint.agentmother_version,
      blueprintVersion: blueprint.agentmother_version,
      blueprintPath: options.blueprintPath ? path.resolve(options.blueprintPath) : null,
      blueprintHash: hashStableJson(blueprint),
    },
    operations: operationSummaries,
  };
}

export function serializeBuildState(state) {
  return `${JSON.stringify(state, null, 2)}\n`;
}

export function buildStatePath(outputDir) {
  return path.join(outputDir, BUILD_STATE_FILENAME);
}

function summarizeOperation(operation) {
  return {
    kind: operation.kind,
    relativePath: operation.relativePath,
    ...(operation.destinationPath ? { destinationPath: operation.destinationPath } : {}),
    ownership: operation.ownership,
    source: operation.source,
    scaffoldOnly: operation.scaffoldOnly === true,
  };
}

function hashStableJson(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
