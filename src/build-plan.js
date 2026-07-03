import { validateBlueprint } from "./blueprint.js";
import { assertTargetAdapter } from "./targets/registry.js";

export const BUILD_PLAN_SCHEMA_VERSION = "agentmo.build-plan.v1";
export const DEFAULT_TARGET_ID = "agentmo";
export const DEFAULT_MODULE_IDS = Object.freeze(["default"]);

export function buildPlan(blueprint, options = {}) {
  const validation = validateBlueprint(blueprint);
  if (!validation.ok) {
    throw new Error(`Cannot build plan for invalid blueprint:\n${validation.errors.map((error) => `- ${error}`).join("\n")}`);
  }

  const selectedTargetId = options.target ?? DEFAULT_TARGET_ID;
  const target = assertTargetAdapter(selectedTargetId);
  if (typeof target.supports === "function" && !target.supports(blueprint)) {
    throw new Error(`Target ${selectedTargetId} does not support blueprint ${blueprint.agent_id}.`);
  }

  const warningSet = new Set(validation.warnings ?? []);
  const selectedProfileId = resolveProfileId(blueprint, target, options, warningSet);
  const selectedModuleIds = [...DEFAULT_MODULE_IDS];
  const context = {
    selectedTargetId,
    selectedProfileId,
    selectedModuleIds,
    outputDir: options.outputDir,
    addWarning: (warning) => warningSet.add(warning),
  };
  const operations = target.planOperations(blueprint, context);
  operations.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  return {
    schemaVersion: BUILD_PLAN_SCHEMA_VERSION,
    agentId: blueprint.agent_id,
    selectedTargetId,
    selectedProfileId,
    selectedModuleIds,
    warnings: Array.from(warningSet).sort(),
    domainOperationCount: operations.length,
    operations,
    target: {
      id: target.id,
      label: target.label,
      verificationHints: target.verificationHints ?? [],
      unsupportedSurfaces: target.unsupportedSurfaces ?? [],
    },
  };
}

function resolveProfileId(blueprint, target, options, warningSet) {
  const profiles = Array.isArray(blueprint.runtime_profiles) ? blueprint.runtime_profiles : [];
  const explicitProfileId = options.profileId ?? options.profile;
  if (explicitProfileId) {
    const explicitProfile = profiles.find((profile) => profile.id === explicitProfileId);
    if (explicitProfile) return explicitProfile.id;
    warningSet.add(`Requested runtime profile ${explicitProfileId} was not found; selectedProfileId is null.`);
    return null;
  }

  const targetRuntimeId = resolveTargetRuntimeId(target, blueprint);
  const matchingRuntimeProfile = profiles.find((profile) => profile.id === targetRuntimeId);
  if (matchingRuntimeProfile) return matchingRuntimeProfile.id;

  const primaryRuntimeProfile = profiles.find((profile) => profile.role === "primary") ?? profiles.find((profile) => profile.id === blueprint.runtime);
  if (primaryRuntimeProfile) {
    warningSet.add(
      `No runtime profile matched target ${target.id} runtime ${targetRuntimeId}; using primary runtime profile ${primaryRuntimeProfile.id}.`,
    );
    return primaryRuntimeProfile.id;
  }

  warningSet.add(`No runtime profile matched target ${target.id} runtime ${targetRuntimeId}; selectedProfileId is null.`);
  return null;
}

function resolveTargetRuntimeId(target, blueprint) {
  if (typeof target.runtimeId === "function") return target.runtimeId(blueprint);
  if (typeof target.runtimeId === "string") return target.runtimeId;
  return target.id;
}
