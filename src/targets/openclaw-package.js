import {
  computeNativePluginRecipeDigest,
  validateNativePluginRecipe,
} from "../build-contract.js";
import { serializePersistableJson } from "../persistability.js";

const jsonBytes = (value, subject) => Buffer.from(
  serializePersistableJson(value, { subject: "openclaw-package-projection" }),
  "utf8",
);

const markdownBytes = (title, body) => Buffer.from(`# ${title}\n\n${body}\n`, "utf8");

export function buildOpenClawPackageProjection({
  buildContract,
  carrierSelection,
  targetAdmission,
}) {
  const recipe = buildContract?.nativePluginRecipe;
  const recipeValidation = validateNativePluginRecipe(recipe, buildContract?.targetRuntime);
  if (!recipeValidation.ok
    || computeNativePluginRecipeDigest(recipe) !== recipe.recipeDigest
    || targetAdmission?.authorities?.nativePluginRecipeDigest !== recipe.recipeDigest
    || targetAdmission?.carrier?.owner !== recipe.owner
    || targetAdmission?.carrier?.implementationPathAccepted !== false
    || targetAdmission?.carrier?.mcp !== false
    || carrierSelection?.mcpCarrierCount !== 0) {
    throw new Error("AGENTMO_OPENCLAW_PACKAGE_AUTHORITY_INVALID");
  }

  const entries = [
    text("projections/openclaw/workspace/AGENTS.md", "Agent Instructions",
      "Execute only the approved support-triage contract. Fail closed on stale authority, missing evidence, or unapproved transitions."),
    text("projections/openclaw/workspace/SOUL.md", "Operating Principles",
      "Be evidence-led, deterministic, least-authority, and explicit about uncertainty."),
    text("projections/openclaw/workspace/IDENTITY.md", "Identity",
      "This workspace carries the AgentMo support-triage package; package presence is not runtime or domain certification."),
    text("projections/openclaw/workspace/USER.md", "User Contract",
      "Assist with approved support-triage work while preserving approval, credential, schedule, and execution boundaries."),
    text("projections/openclaw/workspace/TOOLS.md", "Tool Boundary",
      "Use only package-declared tools and permissions. No external plugin installation is authorized."),
    text("projections/openclaw/workspace/MEMORY.md", "Memory Boundary",
      "Persist only approved, value-blind support metadata. Do not persist credentials or raw provider payloads."),
    text("projections/openclaw/workspace/skills/support-triage/SKILL.md",
      "Support Triage", "Classify, prioritize, and draft evidence-backed next actions without executing external changes."),
    json("projections/openclaw/config/openclaw.agent.patch.json", {
      schemaVersion: "agentmo.openclaw-config-patch.v1",
      proposalOnly: true,
      pluginActivation: false,
      userLevelMutation: false,
      runtimeExecution: false,
    }),
    json("projections/openclaw/capability-map.json", {
      schemaVersion: "agentmo.openclaw-capability-map.v1",
      capabilities: carrierSelection.entries.map(({ capabilityId, carrier, owner }) => ({
        capabilityId, carrier, owner,
      })),
    }),
    json("projections/openclaw/runtime-binding.json", {
      schemaVersion: "agentmo.openclaw-runtime-binding.v1",
      target: targetAdmission.target,
      executionAuthorized: false,
      installed: false,
      runtimeVerified: false,
    }),
    json("projections/openclaw/schedule-proposals/daily-collection.json", {
      schemaVersion: "agentmo.openclaw-schedule-proposal.v1",
      proposalOnly: true,
      registered: false,
      executed: false,
    }),
    json("projections/openclaw/credential-setup-proposal.json", {
      schemaVersion: "agentmo.openclaw-credential-setup-proposal.v1",
      proposalOnly: true,
      secretReference: "SecretRef:support-provider",
      credentialValueIncluded: false,
      written: false,
    }),
  ];

  for (const mapping of recipe.hookMappings) {
    entries.push(json(`projections/openclaw/hooks/${mapping.abstractHook}.json`, {
      schemaVersion: "agentmo.openclaw-hook-binding.v1",
      abstractHook: mapping.abstractHook,
      openclawEvent: mapping.openclawEvent,
      owner: mapping.owner,
      recipeDigest: recipe.recipeDigest,
      versionRange: mapping.versionRange,
      permission: mapping.permission,
      timeoutMs: mapping.timeoutMs,
      failureSemantics: mapping.failureSemantics,
      unsupportedBehavior: mapping.unsupportedBehavior,
      activated: false,
    }));
  }
  const collisionKeys = new Set(entries.map(({ relativePath }) => collisionKey(relativePath)));
  for (const file of recipe.files) {
    const recipeRelativePath = file.relativePath.slice("openclaw/plugin/".length);
    const relativePath = `projections/openclaw/plugins/${recipe.owner}/${recipeRelativePath}`;
    if (!portablePath(recipeRelativePath) || collisionKeys.has(collisionKey(relativePath))) {
      throw new Error("AGENTMO_OPENCLAW_PACKAGE_MEMBER_COLLISION");
    }
    collisionKeys.add(collisionKey(relativePath));
    entries.push({
      relativePath,
      mode: file.mode,
      bytes: Buffer.from(file.content, "utf8"),
    });
  }
  return entries.sort((left, right) => Buffer.from(left.relativePath).compare(
    Buffer.from(right.relativePath),
  ));
}

function text(relativePath, title, body) {
  return { relativePath, mode: 0o644, bytes: markdownBytes(title, body) };
}

function json(relativePath, value) {
  return { relativePath, mode: 0o644, bytes: jsonBytes(value, relativePath) };
}

function portablePath(value) {
  return typeof value === "string"
    && value.length > 0
    && value === value.normalize("NFC")
    && !value.includes("\0")
    && !value.includes("\\")
    && !value.startsWith("/")
    && value.split("/").every((segment) => (
      segment.length > 0
      && segment !== "."
      && segment !== ".."
      && !segment.endsWith(" ")
      && !segment.endsWith(".")
    ));
}

function collisionKey(value) {
  return value.normalize("NFC").toLocaleLowerCase("en-US");
}
