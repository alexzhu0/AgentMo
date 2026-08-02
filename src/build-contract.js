import path from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  admittedArtifactProvenance,
  ArtifactAdmissionError,
  loadAdmittedArtifact,
} from "./artifact-admission.js";
import { validateBlueprint } from "./blueprint.js";
import { DECISION_LEDGER_SCHEMA_VERSION, admittedDecisionLedgerProvenance, validateDecisionLedger } from "./decision-ledger.js";
import { DESIGN_PLAN_SCHEMA_VERSION, validateDesignPlan } from "./design-plan.js";
import { DISCOVERY_APPROVAL_SCHEMA_VERSION, validateDiscoveryApproval } from "./discovery-approval.js";
import {
  PersistabilityError,
  isSecretRef,
  serializePersistableJson,
  writePersistableJsonAtomic,
} from "./persistability.js";
import {
  OPENCLAW_TARGET_DESCRIPTOR_SCHEMA_VERSION,
  validateOpenClawTargetDescriptor,
} from "./openclaw-target-descriptor.js";

export const BUILD_CONTRACT_SCHEMA_VERSION = "agentmo.build-contract.v1";
export const OPENCLAW_RESOURCE_KINDS = Object.freeze([
  "prompt",
  "workspace-context",
  "skills",
  "tools",
  "tool-policy",
  "plugins",
  "memory",
  "rag",
  "storage",
  "schedules",
  "harness",
  "agent-loop",
  "runtime-binding",
  "permissions",
  "trust-boundaries",
  "secrets",
  "install-transition",
  "load-transition",
  "execute-transition",
  "recovery",
  "acceptance-cases",
  "evidence-obligations",
]);

const TARGET_RUNTIME_KEYS = Object.freeze([
  "id",
  "sourceRevision",
  "displayRevision",
  "observedVersion",
  "nodeRange",
  "descriptorDigest",
  "targetRootDigest",
  "executableDigest",
  "packageJsonDigest",
  "buildInfoDigest",
  "driftPolicy",
]);
const PROJECTION_DISPOSITIONS = new Set([
  "generated-file",
  "config-operation",
  "install-operation",
  "schedule-operation",
  "explicit-unsupported",
  "runtime-evidence-obligation",
]);
const CONTRACT_KEYS = Object.freeze([
  "schemaVersion",
  "agentId",
  "status",
  "targetDescriptor",
  "targetRuntime",
  "nativePluginRecipe",
  "bindings",
  "specification",
  "resources",
  "permissions",
  "acceptanceCases",
  "evidenceObligations",
  "traceGraph",
  "remainingRisks",
  "certificationBoundary",
]);
const REQUIRED_CONTRACT_KEYS = Object.freeze(
  CONTRACT_KEYS.filter((key) => !["targetDescriptor", "nativePluginRecipe"].includes(key)),
);
const NATIVE_PLUGIN_RECIPE_KEYS = Object.freeze([
  "schemaVersion",
  "owner",
  "files",
  "hookMappings",
  "recipeDigest",
]);
const NATIVE_PLUGIN_FILE_KEYS = Object.freeze([
  "relativePath",
  "type",
  "mode",
  "encoding",
  "content",
  "byteLength",
  "sha256",
]);
const NATIVE_PLUGIN_HOOK_KEYS = Object.freeze([
  "abstractHook",
  "openclawEvent",
  "owner",
  "versionRange",
  "permission",
  "timeoutMs",
  "failureSemantics",
  "unsupportedBehavior",
]);
const NATIVE_PLUGIN_HOOKS = Object.freeze([
  Object.freeze(["after-attempt", "agent_end"]),
  Object.freeze(["after-tool", "after_tool_call"]),
  Object.freeze(["before-attempt", "before_agent_run"]),
  Object.freeze(["before-checkpoint", "before_compaction"]),
]);
const BINDING_KEYS = Object.freeze([
  "blueprint",
  "designPlan",
  "discoveryApproval",
  "decisionLedger",
  "targetDescriptor",
]);
const LEGACY_BINDING_KEYS = Object.freeze(
  BINDING_KEYS.filter((key) => key !== "targetDescriptor"),
);
const SPECIFICATION_KEYS = Object.freeze([
  "prompt",
  "skills",
  "tools",
  "plugins",
  "memory",
  "rag",
  "storage",
  "schedules",
  "harness",
  "loop",
  "runtimeBinding",
  "transitions",
  "recovery",
]);
const TRACE_KEYS = Object.freeze([
  "sourceIds",
  "decisionIds",
  "requirementIds",
  "capabilityIds",
  "evalCaseIds",
  "permissionIds",
  "acceptanceCaseIds",
  "resourceIds",
  "evidenceObligationIds",
  "forwardTraceEdges",
  "reverseTraceEdges",
]);
const CERTIFICATION_BOUNDARY = Object.freeze({
  constructionIntentOnly: true,
  packageBuilt: false,
  packageInstalled: false,
  runtime: false,
  domain: false,
  production: false,
});
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const ADMITTED_BUILD_CONTRACT_CANDIDATES = new WeakSet();

export class BuildContractError extends Error {
  constructor(code, errors = []) {
    super("Agent Package build contract was rejected.");
    this.name = "BuildContractError";
    this.code = code;
    this.errors = [...errors];
  }
}

export function buildBuildContract(
  blueprint,
  designPlan,
  discoveryApproval,
  decisionLedger,
  options = {},
) {
  assertInputs(blueprint, designPlan, discoveryApproval, decisionLedger, options);
  const targetDescriptorAdmission = options.admissions.targetDescriptor;
  const targetDescriptor = targetDescriptorAdmission.value;
  const targetRuntime = targetRuntimeFromDescriptor(
    targetDescriptor,
    targetDescriptorAdmission.digest,
  );
  const bindings = admittedBindings(
    blueprint,
    designPlan,
    discoveryApproval,
    decisionLedger,
    options.admissions,
  );
  const planTrace = designPlan.traceGraph;
  const requirementIds = [...planTrace.requirementIds].sort();
  const sourceIds = [...planTrace.sourceIds].sort();
  const decisionIds = [...planTrace.decisionIds].sort();
  const capabilityIds = [...planTrace.capabilityIds].sort();
  const evalCaseIds = [...planTrace.evalCaseIds].sort();
  const resources = buildResources(requirementIds, sourceIds, decisionIds);
  const permissions = resources.map((resource) => ({
    id: `permission:${resource.kind}`,
    resourceId: resource.id,
    authority: permissionAuthority(resource.kind),
    approvalRequired: mutationKinds().has(resource.kind),
    default: "deny-unless-declared",
  }));
  const acceptanceCases = requirementIds.map((requirementId) => ({
    id: `acceptance:${requirementId}`,
    requirementId,
    evalCaseId: `eval:${requirementId}`,
    expected: "bounded-evidence-or-explicit-gap",
    phase: "phase-5",
  }));
  const evidenceObligations = resources.map((resource) => ({
    id: `evidence:${resource.kind}`,
    resourceId: resource.id,
    requiredAt: evidencePhase(resource.kind),
    proves: evidenceClaim(resource.kind),
    doesNotProve: ["domain-quality", "production-readiness"],
  }));
  const traceGraph = buildTraceGraph({
    planTrace,
    resources,
    permissions,
    acceptanceCases,
    evidenceObligations,
  });
  const contract = {
    schemaVersion: BUILD_CONTRACT_SCHEMA_VERSION,
    agentId: designPlan.agentId,
    status: "construction-intent",
    targetDescriptor: structuredClone(targetDescriptor),
    targetRuntime,
    nativePluginRecipe: options.nativePluginRecipe === undefined
      ? null
      : structuredClone(options.nativePluginRecipe),
    bindings,
    specification: buildSpecification(blueprint),
    resources,
    permissions,
    acceptanceCases,
    evidenceObligations,
    traceGraph,
    remainingRisks: [
      "All declared resources require Phase 4 materialization evidence.",
      "Domain behavior remains unverified until Phase 5 acceptance.",
      "OpenClaw source drift must be checked before materialization.",
    ],
    certificationBoundary: { ...CERTIFICATION_BOUNDARY },
  };
  const validation = validateBuildContract(contract);
  if (!validation.ok) {
    throw new BuildContractError("AGENTMO_BUILD_CONTRACT_INVALID", validation.errors);
  }
  serializePersistableJson(contract, { subject: "build-contract" });
  ADMITTED_BUILD_CONTRACT_CANDIDATES.add(contract);
  return contract;
}

export function validateBuildContract(value) {
  const errors = [];
  try {
    if (!plainObject(value) || !hasClosedContractKeys(value)) {
      return { ok: false, errors: ["build contract must contain only canonical fields."] };
    }
    if (value.schemaVersion !== BUILD_CONTRACT_SCHEMA_VERSION) errors.push("invalid schemaVersion.");
    if (!ID_PATTERN.test(value.agentId ?? "")) errors.push("invalid agentId.");
    if (value.status !== "construction-intent") errors.push("invalid status.");
    validateTargetDescriptorBinding(value.targetDescriptor, value.targetRuntime, errors);
    if (Object.hasOwn(value, "nativePluginRecipe")) {
      errors.push(...validateNativePluginRecipe(
        value.nativePluginRecipe,
        value.targetRuntime,
      ).errors);
    }
    validateBindings(value.bindings, errors);
    if (value.targetDescriptor !== undefined
      && value.bindings?.targetDescriptor?.digest !== value.targetRuntime?.descriptorDigest) {
      errors.push("target descriptor provenance is stale.");
    }
    validateSpecification(value.specification, errors);
    validateResources(value.resources, errors);
    validatePermissions(value.permissions, value.resources, errors);
    validateAcceptanceCases(value.acceptanceCases, errors);
    validateEvidenceObligations(value.evidenceObligations, value.resources, errors);
    validateTraceGraph(value.traceGraph, value, errors);
    if (!sortedUniqueStrings(value.remainingRisks) || value.remainingRisks.length === 0) {
      errors.push("remainingRisks must be a non-empty sorted unique string array.");
    }
    validateCertificationBoundary(value.certificationBoundary, errors);
    serializePersistableJson(value, { subject: "build-contract" });
  } catch (error) {
    errors.push(`unsafe build contract shape${error?.code ? `: ${error.code}` : ""}.`);
  }
  return { ok: errors.length === 0, errors };
}

export async function admitNativePluginRecipe({ filePath, expectedDigest } = {}) {
  return loadAdmittedArtifact({
    filePath,
    subject: "native-plugin-recipe",
    expectedDigest,
  });
}

export function computeNativePluginRecipeDigest(recipe) {
  if (!plainObject(recipe)) {
    throw new BuildContractError("AGENTMO_NATIVE_PLUGIN_RECIPE_INVALID");
  }
  const basis = {};
  for (const key of NATIVE_PLUGIN_RECIPE_KEYS.slice(0, -1)) {
    basis[key] = recipe[key];
  }
  return `sha256:${createHash("sha256")
    .update(Buffer.from(serializePersistableJson(basis, {
      subject: "native-plugin-recipe-basis",
    }), "utf8"))
    .digest("hex")}`;
}

export function validateNativePluginRecipe(value, targetRuntime) {
  const errors = [];
  if (value === null) return { ok: true, errors };
  if (!plainObject(value) || !hasExactKeys(value, NATIVE_PLUGIN_RECIPE_KEYS)) {
    return { ok: false, errors: ["nativePluginRecipe must contain only canonical fields."] };
  }
  if (value.schemaVersion !== "agentmo.native-plugin-recipe.v1"
    || value.owner !== "agentmo-openclaw-harness"
    || !Array.isArray(value.files)
    || value.files.length === 0) {
    errors.push("nativePluginRecipe identity or file closure is invalid.");
    return { ok: false, errors };
  }
  const paths = value.files.map((file) => file?.relativePath);
  if (!sameArray(paths, [...paths].sort()) || new Set(paths).size !== paths.length) {
    errors.push("nativePluginRecipe files must be sorted and unique.");
  }
  for (const file of value.files) {
    if (!plainObject(file)
      || !hasExactKeys(file, NATIVE_PLUGIN_FILE_KEYS)
      || !portableRecipePath(file.relativePath)
      || file.type !== "file"
      || ![0o644, 0o755].includes(file.mode)
      || file.encoding !== "utf8"
      || typeof file.content !== "string"
      || file.content.length === 0
      || file.content.includes("\0")
      || file.content.includes("\r")
      || file.content !== file.content.normalize("NFC")
      || !file.content.endsWith("\n")
      || file.byteLength !== Buffer.byteLength(file.content, "utf8")
      || file.sha256 !== sha256RecipeBytes(Buffer.from(file.content, "utf8"))) {
      errors.push(`invalid nativePluginRecipe file ${String(file?.relativePath)}.`);
    }
  }
  if (!Array.isArray(value.hookMappings)
    || !sameArray(
      value.hookMappings.map((mapping) => mapping?.abstractHook),
      NATIVE_PLUGIN_HOOKS.map(([abstractHook]) => abstractHook),
    )) {
    errors.push("nativePluginRecipe hookMappings must cover the canonical four hooks.");
  } else {
    for (const [index, mapping] of value.hookMappings.entries()) {
      const [abstractHook, openclawEvent] = NATIVE_PLUGIN_HOOKS[index];
      if (!plainObject(mapping)
        || !hasExactKeys(mapping, NATIVE_PLUGIN_HOOK_KEYS)
        || mapping.abstractHook !== abstractHook
        || mapping.openclawEvent !== openclawEvent
        || mapping.owner !== value.owner
        || (targetRuntime !== undefined
          && mapping.versionRange !== targetVersionRange(targetRuntime))
        || (targetRuntime === undefined
          && (typeof mapping.versionRange !== "string"
            || mapping.versionRange.length === 0))
        || typeof mapping.permission !== "string"
        || mapping.permission.length === 0
        || !Number.isSafeInteger(mapping.timeoutMs)
        || mapping.timeoutMs <= 0
        || mapping.failureSemantics !== "fail-closed"
        || !sortedUniqueStrings(mapping.unsupportedBehavior)
        || !sameArray(mapping.unsupportedBehavior, ["automatic-external-plugin-install"])) {
        errors.push(`invalid nativePluginRecipe hook mapping ${String(mapping?.abstractHook)}.`);
      }
    }
  }
  try {
    if (value.recipeDigest !== computeNativePluginRecipeDigest(value)) {
      errors.push("nativePluginRecipe.recipeDigest does not bind canonical content.");
    }
  } catch {
    errors.push("nativePluginRecipe.recipeDigest cannot be recomputed.");
  }
  return { ok: errors.length === 0, errors };
}

export async function writeBuildContract(filePath, contract) {
  if (!ADMITTED_BUILD_CONTRACT_CANDIDATES.has(contract)) {
    throw new PersistabilityError("AGENTMO_PERSISTABILITY_UNADMITTED_CANDIDATE");
  }
  const validation = validateBuildContract(contract);
  if (!validation.ok) {
    throw new PersistabilityError("AGENTMO_PERSISTABILITY_INVALID_CANDIDATE");
  }
  if (typeof filePath !== "string" || filePath.length === 0 || filePath.includes("\0")) {
    throw new PersistabilityError("AGENTMO_PERSISTABILITY_INVALID_OUTPUT_PATH");
  }
  serializePersistableJson(contract, { subject: "build-contract" });
  await writePersistableJsonAtomic(path.resolve(filePath), contract, {
    subject: "build-contract",
  });
  return filePath;
}

function assertInputs(blueprint, designPlan, discoveryApproval, decisionLedger, options) {
  if (!validateBlueprint(blueprint).ok
    || !validateDesignPlan(designPlan).ok
    || !validateDiscoveryApproval(discoveryApproval).ok
    || !validateDecisionLedger(decisionLedger).ok) {
    throw new BuildContractError("AGENTMO_BUILD_CONTRACT_INPUT_INVALID");
  }
  if (options.target !== "openclaw"
    || blueprint.runtime !== "openclaw"
    || designPlan.targetRuntime !== "openclaw"
    || designPlan.agentId !== blueprint.agent_id
    || discoveryApproval.decisionScope !== "enter-plan"
    || decisionLedger.head === null) {
    throw new BuildContractError("AGENTMO_BUILD_CONTRACT_INPUT_MISMATCH");
  }
  if (blueprint.stage2_planning?.authority !== "draft-non-authoritative"
    || blueprint.design_contract?.provenance?.reviewed !== false) {
    throw new BuildContractError("AGENTMO_BUILD_CONTRACT_AUTHORITY_INVALID");
  }
  let targetDescriptor;
  try {
    targetDescriptor = admittedArtifactProvenance(options.admissions?.targetDescriptor, {
      subject: "openclaw-target-descriptor",
      value: options.admissions?.targetDescriptor?.value,
    });
  } catch {
    throw new BuildContractError(
      "AGENTMO_BUILD_CONTRACT_TARGET_DESCRIPTOR_REQUIRED",
    );
  }
  if (targetDescriptor.identity !== OPENCLAW_TARGET_DESCRIPTOR_SCHEMA_VERSION
    || !validateOpenClawTargetDescriptor(options.admissions.targetDescriptor.value).ok
    || options.admissions.targetDescriptor.value.target.id !== options.target) {
    throw new BuildContractError(
      "AGENTMO_BUILD_CONTRACT_TARGET_DESCRIPTOR_REQUIRED",
    );
  }
  if (options.nativePluginRecipe !== undefined) {
    admittedArtifactProvenance(options.nativePluginRecipeAdmission, {
      subject: "native-plugin-recipe",
      value: options.nativePluginRecipe,
    });
    const recipeValidation = validateNativePluginRecipe(options.nativePluginRecipe);
    if (!recipeValidation.ok) {
      throw new BuildContractError(
        "AGENTMO_NATIVE_PLUGIN_RECIPE_INVALID",
        recipeValidation.errors,
      );
    }
  } else if (options.nativePluginRecipeAdmission !== undefined) {
    throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_ADMISSION_RESULT_INVALID");
  }
}

function portableRecipePath(value) {
  return typeof value === "string"
    && value.startsWith("openclaw/plugin/")
    && value === value.normalize("NFC")
    && !value.includes("\0")
    && !value.includes("\\")
    && !value.startsWith("/")
    && value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function sha256RecipeBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function admittedBindings(blueprint, designPlan, discoveryApproval, decisionLedger, admissions) {
  if (!plainObject(admissions) || !hasExactKeys(admissions, BINDING_KEYS)) {
    throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_ADMISSION_RESULT_INVALID");
  }
  if (admissions.decisionLedger !== decisionLedger) {
    throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_ADMISSION_RESULT_INVALID");
  }
  const bindings = {
    blueprint: admittedArtifactProvenance(admissions.blueprint, {
      subject: "blueprint",
      value: blueprint,
    }),
    designPlan: admittedArtifactProvenance(admissions.designPlan, {
      subject: "design-plan",
      value: designPlan,
    }),
    discoveryApproval: admittedArtifactProvenance(admissions.discoveryApproval, {
      subject: "discovery-approval",
      value: discoveryApproval,
    }),
    decisionLedger: admittedDecisionLedgerProvenance(admissions.decisionLedger),
    targetDescriptor: admittedArtifactProvenance(admissions.targetDescriptor, {
      subject: "openclaw-target-descriptor",
      value: admissions.targetDescriptor.value,
    }),
  };
  if (bindings.designPlan.digest !== blueprint.stage2_planning?.admission?.digest
    || bindings.discoveryApproval.digest !== designPlan.source?.discoveryApproval?.digest
    || bindings.decisionLedger.digest !== designPlan.source?.decisionLedger?.digest) {
    throw new BuildContractError("AGENTMO_BUILD_CONTRACT_STALE_INPUT");
  }
  return bindings;
}

function buildSpecification(blueprint) {
  return {
    prompt: {
      profile: "openclaw-workspace-bootstrap",
      bootstrapFiles: [
        "AGENTS.md",
        "SOUL.md",
        "IDENTITY.md",
        "USER.md",
        "TOOLS.md",
        "BOOTSTRAP.md",
        "MEMORY.md",
        "HEARTBEAT.md",
      ].map((name) => ({
        path: `openclaw/workspace/${name}`,
        purpose: promptFilePurpose(name),
        required: !["BOOTSTRAP.md", "HEARTBEAT.md"].includes(name),
        owner: "phase-4",
        authority: name === "TOOLS.md" ? "operator-guidance-only" : "workspace-instruction",
        maxChars: name === "AGENTS.md" ? 32000 : 18000,
        contentSourceRefs: [],
        digest: null,
        secretAllowed: false,
      })),
      precedence: ["AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md", "TOOLS.md"],
      staticSections: [
        "runtime-identity",
        "safety-boundary",
        "effective-tool-policy",
        "workspace-context",
      ],
      dynamicSections: ["runtime-line", "channel-context", "session-context", "heartbeat-context"],
      budgets: {
        maximumBootstrapFiles: 8,
        maximumStaticChars: 72000,
        maximumDynamicChars: 18000,
        overflow: "fail-closed",
      },
      sourceDigests: [],
      secretPolicy: [],
    },
    skills: {
      discoveryRoots: ["openclaw/workspace/skills"],
      precedence: ["workspace"],
      eligibility: {
        visibility: "declared-only",
        runtimeRequirements: "must-pass-before-load",
        symlinks: "reject",
      },
      snapshot: {
        mode: "exact-digest",
        persistForScheduledSession: true,
      },
      limits: {
        maximumPerSource: 200,
        maximumInPrompt: 150,
        maximumPromptChars: 18000,
        maximumFileBytes: 256000,
      },
      activation: "explicit-package-load",
      syncMode: "declared-assets-only",
      automaticExternalInstall: false,
    },
    tools: {
      declaredNames: (blueprint.tools ?? []).map((tool) => tool.name).sort(),
      toolsMdIsAuthority: false,
      effectivePolicyPipeline: [
        "runtime-config",
        "agent-policy",
        "provider-capability",
        "per-call-authorization",
      ],
      sideEffects: "declared-per-tool",
      approvalMode: "permission-and-action-scoped",
      replaySafety: "declared-per-tool",
      failure: "deny-on-missing-policy-or-authorization",
      sandbox: "least-authority",
    },
    plugins: {
      necessity: "prefer-runtime-owned-capability",
      installLanes: ["bundled", "workspace-local", "external-reference"],
      selectedLane: "bundled",
      scanRequiredBeforeInstall: true,
      activation: "explicit-registry-load",
      loadPrecedence: ["bundled", "workspace-local"],
      rollback: "restore-preinstall-registry-and-config",
      automaticExternalInstall: false,
      externalReferencesAudited: false,
    },
    memory: {
      mode: "file-backed-plus-core-search",
      slotOwner: "memory-core",
      competingOwners: [],
      unsupportedAlternatives: ["memory-lancedb"],
      rootFile: "openclaw/workspace/MEMORY.md",
      additionalPaths: ["openclaw/workspace/memory"],
      promptInjection: "bounded-root-summary",
      flushPolicy: {
        trigger: "explicit-checkpoint",
        maximumPendingWrites: 1,
      },
      tools: ["memory_get", "memory_search"],
      publicArtifacts: ["memory-status"],
      retention: "operator-governed",
      sensitivity: "workspace-private",
      durableScope: "workspace-local",
    },
    rag: {
      status: "declared-not-materialized",
      corpora: [
        {
          id: "workspace-memory",
          source: "openclaw/workspace/memory",
          enabled: true,
          boundary: "workspace-only",
        },
      ],
      chunking: {
        strategy: "heading-aware",
        maximumChars: 2400,
        overlapChars: 240,
      },
      embedding: {
        provider: "openai-compatible",
        model: "text-embedding-3-small",
        dimensions: 1536,
        secretRef: {
          kind: "SecretRef",
          source: "runtime-env",
          name: "OPENAI_API_KEY",
        },
      },
      index: {
        owner: "memory-core",
        engine: "sqlite-vec-when-ready",
        rebuild: "transactional-shadow-swap",
      },
      search: {
        hybridWeights: { fullText: 0.4, vector: 0.6 },
        minimumScore: 0.2,
        maximumResults: 8,
      },
      fallback: "bounded-full-text-scan",
      citations: {
        required: true,
        sourceLinesRequired: true,
      },
      sync: "checkpoint-and-startup",
      dataBoundary: "declared-workspace-corpora-only",
    },
    storage: {
      owner: "agent-package",
      databases: [
        {
          id: "knowledge-index",
          scope: "per-agent",
          schemaOwner: "memory-core",
          lifecycle: "runtime-created",
          migration: "versioned-forward-with-rollback",
          backup: "operator-managed",
          retention: "operator-governed",
          sensitivity: "workspace-private",
          maximumGrowthBytes: 536870912,
          recovery: "rebuild-index-from-corpus",
        },
        {
          id: "dedup-ledger",
          scope: "named-file",
          schemaOwner: "agent-package",
          lifecycle: "runtime-created",
          migration: "versioned-forward-with-rollback",
          backup: "operator-managed",
          retention: "operator-governed",
          sensitivity: "workspace-private",
          maximumGrowthBytes: 67108864,
          recovery: "restore-or-rebuild-from-source-digests",
        },
      ],
      createAtBuildContract: false,
      migrationOwner: "phase-4",
      productionPathsPersisted: false,
    },
    schedules: {
      proposals: [
        {
          id: "daily-collection",
          enabled: true,
          cadence: "0 9 * * *",
          timezone: "Asia/Shanghai",
          agentTarget: blueprint.agent_id,
          sessionTarget: "isolated-scheduled-session",
          inputRef: "schedule-input:daily-collection",
          deliveryTarget: "operator-review-queue",
          timeoutMs: 900000,
          retry: { maximumAttempts: 2, failureAlert: true },
          concurrency: { maximumActive: 1, policy: "skip-overlap" },
          idempotency: "scheduled-window-plus-source-digest",
          skillsSnapshot: "persist-if-changed",
          retention: "operator-governed",
          requiredPermissions: ["network:approved-sources", "storage:workspace-wiki"],
        },
      ],
      registeredAtBuildContract: false,
      humanApprovalRequired: true,
    },
    harness: {
      id: "agentmo-openclaw-harness",
      kind: "openclaw-compatible",
      selectionPolicy: "exact-id-and-capability-match",
      requiredCapabilities: ["bounded-attempt", "checkpoint", "effective-tool-inventory"],
      toolOwnership: "runtime-policy-pipeline",
      responsibilities: ["bounded-loop", "checkpoint", "evidence-capture"],
      providerIndependent: true,
      fallback: "fail-closed",
      unsupported: ["infer-harness-from-provider", "unbounded-attempt"],
    },
    loop: {
      mechanism: "bounded-observe-decide-act-checkpoint",
      modelPolicy: "runtime-binding-only",
      authProfileRef: "runtime-auth-profile:default",
      fallbacks: [],
      thinking: "runtime-policy",
      maximumAttempts: 3,
      timeoutMs: 900000,
      concurrencyLane: "agentmo-package",
      compaction: {
        enabled: true,
        checkpointBeforeCompaction: true,
        successorSessionRequired: true,
      },
      toolLoopGuard: {
        maximumRepeatedCalls: 3,
        action: "stop-and-report",
      },
      hooks: ["before-attempt", "after-tool", "before-checkpoint", "after-attempt"],
      stopReasons: ["completed", "approval-required", "budget-exhausted", "policy-denied", "failed"],
      maximumUncheckpointedCycles: 1,
      automaticPromotion: false,
    },
    runtimeBinding: {
      provider: "runtime-selected-provider",
      model: "runtime-selected-model",
      harness: "agentmo-openclaw-harness",
      channel: "runtime-selected-channel",
      transport: "runtime-selected-transport",
      sessionSelector: "isolated-or-explicit-existing-session",
      target: "openclaw",
      exactRevisionRequired: true,
    },
    transitions: [
      {
        transition: "install",
        phase: "phase-4",
        mutation: true,
        approvalRequired: true,
        precondition: "exact-plan-approval-and-target-preflight",
        postcondition: "install-receipt-only",
        rollback: "restore-preinstall-state",
      },
      {
        transition: "load",
        phase: "phase-4",
        mutation: false,
        approvalRequired: false,
        precondition: "installed-package-digest-match",
        postcondition: "registry-inventory-only",
        rollback: "unload-without-state-deletion",
      },
      {
        transition: "execute",
        phase: "phase-5",
        mutation: true,
        approvalRequired: true,
        precondition: "exact-load-inventory-and-runtime-gate",
        postcondition: "bounded-runtime-receipt-only",
        rollback: "stop-isolated-run",
      },
    ],
    recovery: {
      session: "persist-versioned-session-state",
      compaction: "archive-and-create-successor",
      restart: "readback-before-resume",
      cron: "resume-from-persisted-job-and-skills-snapshot",
      pluginDoctor: "required-after-install-or-upgrade",
      migrations: "fail-closed-on-unknown-version",
      rollback: "phase-4-owned-explicit-operation",
      failureClassification: "bounded-code-no-raw-runtime-output",
      maximumRetries: 2,
      checkpoints: ["pre-install", "post-load", "post-execute"],
      resumeRequiresExactContractDigest: true,
    },
  };
}

function promptFilePurpose(name) {
  return {
    "AGENTS.md": "operating-instructions",
    "SOUL.md": "behavioral-style",
    "IDENTITY.md": "visible-agent-identity",
    "USER.md": "bounded-user-context",
    "TOOLS.md": "non-authoritative-tool-guidance",
    "BOOTSTRAP.md": "first-run-guidance",
    "MEMORY.md": "root-memory",
    "HEARTBEAT.md": "scheduled-turn-guidance",
  }[name];
}

function buildResources(requirementRefs, sourceRefs, decisionRefs) {
  return OPENCLAW_RESOURCE_KINDS.map((kind) => ({
    id: `resource:${kind}`,
    kind,
    necessity: resourceNecessity(kind),
    owner: "phase-3",
    lifecycle: {
      declared: "phase-3",
      materialized: "phase-4",
      verified: "phase-5",
    },
    sourceRefs,
    decisionRefs,
    requirementRefs,
    trustSemantics: "declaration-is-not-runtime-or-domain-proof",
    permissionSemantics: permissionAuthority(kind),
    failureSemantics: "fail-closed-when-missing-stale-or-unapproved",
    projection: projectionFor(kind),
    evidenceObligationRefs: [`evidence:${kind}`],
  }));
}

function projectionFor(kind) {
  if (kind === "plugins") {
    return {
      disposition: "explicit-unsupported",
      target: "external-plugin-auto-install",
    };
  }
  if (kind === "schedules") {
    return {
      disposition: "schedule-operation",
      target: "openclaw.schedule.proposal",
    };
  }
  if (kind === "install-transition") {
    return {
      disposition: "install-operation",
      target: "openclaw.package.install",
    };
  }
  if (["load-transition", "execute-transition", "runtime-binding", "harness", "agent-loop"].includes(kind)) {
    return {
      disposition: "runtime-evidence-obligation",
      target: `openclaw.${kind}`,
    };
  }
  if (["permissions", "trust-boundaries", "secrets", "tool-policy"].includes(kind)) {
    return {
      disposition: "config-operation",
      target: `openclaw.config.${kind}`,
    };
  }
  return {
    disposition: "generated-file",
    target: `agent-package/${kind}.json`,
  };
}

function permissionAuthority(kind) {
  if (["plugins", "schedules", "install-transition", "execute-transition", "secrets"].includes(kind)) {
    return "explicit-human-approval";
  }
  return "contract-scoped-least-authority";
}

function mutationKinds() {
  return new Set(["plugins", "schedules", "install-transition", "execute-transition", "secrets"]);
}

function resourceNecessity(kind) {
  return kind === "plugins" ? "explicit-boundary" : "required";
}

function evidencePhase(kind) {
  return ["runtime-binding", "harness", "agent-loop", "execute-transition"].includes(kind)
    ? "phase-5"
    : "phase-4";
}

function evidenceClaim(kind) {
  return evidencePhase(kind) === "phase-5"
    ? "bounded-runtime-mechanism"
    : "exact-resource-materialization";
}

function buildTraceGraph({ planTrace, resources, permissions, acceptanceCases, evidenceObligations }) {
  const forward = planTrace.forwardTraceEdges.map((edge) => ({ ...edge }));
  for (const acceptance of acceptanceCases) {
    forward.push({
      from: acceptance.requirementId,
      to: acceptance.id,
      relation: "requirement-defines-acceptance",
    });
  }
  const agentLoopId = "resource:agent-loop";
  for (const capabilityId of planTrace.capabilityIds) {
    forward.push({
      from: capabilityId,
      to: agentLoopId,
      relation: "capability-requires-resource",
    });
  }
  for (const resource of resources) {
    forward.push({
      from: resource.id,
      to: `permission:${resource.kind}`,
      relation: "resource-governed-by-permission",
    });
    forward.push({
      from: resource.id,
      to: `evidence:${resource.kind}`,
      relation: "resource-requires-evidence",
    });
  }
  const forwardTraceEdges = sortEdges(forward);
  const reverseTraceEdges = sortEdges(forwardTraceEdges.map((edge) => ({
    from: edge.to,
    to: edge.from,
    relation: edge.relation,
  })));
  return {
    sourceIds: [...planTrace.sourceIds],
    decisionIds: [...planTrace.decisionIds],
    requirementIds: [...planTrace.requirementIds],
    capabilityIds: [...planTrace.capabilityIds],
    evalCaseIds: [...planTrace.evalCaseIds],
    permissionIds: permissions.map(({ id }) => id),
    acceptanceCaseIds: acceptanceCases.map(({ id }) => id),
    resourceIds: resources.map(({ id }) => id),
    evidenceObligationIds: evidenceObligations.map(({ id }) => id),
    forwardTraceEdges,
    reverseTraceEdges,
  };
}

function validateTargetDescriptorBinding(descriptor, targetRuntime, errors) {
  if (descriptor === undefined) {
    if (!plainObject(targetRuntime)
      || !hasExactKeys(targetRuntime, [
        "id",
        "sourceRevision",
        "observedVersion",
        "nodeRange",
        "driftPolicy",
      ])
      || targetRuntime.id !== "openclaw"
      || !nonEmptyStringArray([
        targetRuntime.sourceRevision,
        targetRuntime.observedVersion,
        targetRuntime.nodeRange,
        targetRuntime.driftPolicy,
      ])) {
      errors.push("legacy targetRuntime binding is malformed.");
    }
    return;
  }
  if (!validateOpenClawTargetDescriptor(descriptor).ok
    || !plainObject(targetRuntime)
    || !hasExactKeys(targetRuntime, TARGET_RUNTIME_KEYS)) {
    errors.push("targetRuntime must bind one exact admitted descriptor.");
    return;
  }
  const expected = targetRuntimeFromDescriptor(
    descriptor,
    targetRuntime.descriptorDigest,
  );
  if (!DIGEST_PATTERN.test(targetRuntime.descriptorDigest ?? "")
    || targetRuntime.descriptorDigest !== descriptorRawDigest(descriptor)
    || !isDeepStrictEqual(targetRuntime, expected)) {
    errors.push("targetRuntime exact descriptor binding is stale.");
  }
}

function validateBindings(value, errors) {
  if (!plainObject(value)
    || (!hasExactKeys(value, BINDING_KEYS)
      && !hasExactKeys(value, LEGACY_BINDING_KEYS))) {
    errors.push("bindings must contain exact Plan authority.");
    return;
  }
  validateProvenance(value.blueprint, "0.1", "blueprint", errors);
  validateProvenance(value.designPlan, DESIGN_PLAN_SCHEMA_VERSION, "design-plan", errors);
  validateProvenance(
    value.discoveryApproval,
    DISCOVERY_APPROVAL_SCHEMA_VERSION,
    "discovery-approval",
    errors,
  );
  validateProvenance(value.decisionLedger, DECISION_LEDGER_SCHEMA_VERSION, "decision-ledger", errors);
  if (Object.hasOwn(value, "targetDescriptor")) {
    validateProvenance(
      value.targetDescriptor,
      OPENCLAW_TARGET_DESCRIPTOR_SCHEMA_VERSION,
      "openclaw-target-descriptor",
      errors,
    );
  }
}

function validateProvenance(value, identity, subject, errors) {
  if (!plainObject(value)
    || !hasExactKeys(value, ["identity", "subject", "digest"])
    || value.identity !== identity
    || value.subject !== subject
    || !DIGEST_PATTERN.test(value.digest ?? "")) {
    errors.push(`invalid ${subject} provenance.`);
  }
}

function validateSpecification(value, errors) {
  if (!plainObject(value) || !hasExactKeys(value, SPECIFICATION_KEYS)) {
    errors.push("specification must contain every canonical construction mechanism.");
    return;
  }
  const bootstrapPaths = value.prompt?.bootstrapFiles?.map((entry) => entry?.path);
  const expectedPaths = [
    "AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md",
    "TOOLS.md", "BOOTSTRAP.md", "MEMORY.md", "HEARTBEAT.md",
  ].map((name) => `openclaw/workspace/${name}`);
  if (!sameArray(bootstrapPaths, expectedPaths)) errors.push("invalid prompt bootstrap files.");
  if (value.prompt?.profile !== "openclaw-workspace-bootstrap"
    || !sameArray(value.prompt?.staticSections, [
      "runtime-identity", "safety-boundary", "effective-tool-policy", "workspace-context",
    ])
    || !sameArray(value.prompt?.dynamicSections, [
      "runtime-line", "channel-context", "session-context", "heartbeat-context",
    ])
    || value.prompt?.budgets?.overflow !== "fail-closed"
    || value.prompt?.secretPolicy?.length !== 0
    || value.prompt?.bootstrapFiles?.some((entry) => (
      entry.secretAllowed !== false
      || entry.owner !== "phase-4"
      || entry.digest !== null
      || !Array.isArray(entry.contentSourceRefs)
    ))) {
    errors.push("invalid prompt construction policy.");
  }
  if (value.skills?.limits?.maximumPerSource !== 200
    || value.skills?.limits?.maximumInPrompt !== 150
    || value.skills?.limits?.maximumPromptChars !== 18000
    || value.skills?.limits?.maximumFileBytes !== 256000
    || value.skills?.eligibility?.symlinks !== "reject"
    || value.skills?.snapshot?.mode !== "exact-digest") {
    errors.push("invalid skill loading policy.");
  }
  if (value.tools?.toolsMdIsAuthority !== false
    || !sortedUniqueStrings(value.tools?.declaredNames)
    || !nonEmptyStringArray(value.tools?.effectivePolicyPipeline)
    || value.tools?.failure !== "deny-on-missing-policy-or-authorization") {
    errors.push("invalid effective tool policy.");
  }
  if (value.plugins?.automaticExternalInstall !== false
    || value.plugins?.scanRequiredBeforeInstall !== true
    || value.plugins?.activation !== "explicit-registry-load") {
    errors.push("invalid plugin installation policy.");
  }
  if (value.memory?.slotOwner !== "memory-core"
    || !Array.isArray(value.memory?.competingOwners)
    || value.memory.competingOwners.length !== 0
    || !value.memory?.unsupportedAlternatives?.includes("memory-lancedb")
    || value.memory?.rootFile !== "openclaw/workspace/MEMORY.md"
    || value.memory?.flushPolicy?.maximumPendingWrites !== 1) {
    errors.push("invalid memory slot ownership.");
  }
  if (!isSecretRef(value.rag?.embedding?.secretRef)
    || value.rag?.embedding?.dimensions !== 1536
    || value.rag?.citations?.required !== true
    || value.rag?.dataBoundary !== "declared-workspace-corpora-only") {
    errors.push("invalid RAG contract.");
  }
  if (value.storage?.productionPathsPersisted !== false
    || value.storage?.createAtBuildContract !== false
    || value.storage?.databases?.length !== 2
    || value.storage.databases.some((database) => (
      typeof database.maximumGrowthBytes !== "number"
      || database.lifecycle !== "runtime-created"
    ))) {
    errors.push("invalid storage ownership contract.");
  }
  if (value.schedules?.registeredAtBuildContract !== false
    || value.schedules?.humanApprovalRequired !== true
    || value.schedules?.proposals?.length !== 1
    || value.schedules.proposals[0]?.timezone !== "Asia/Shanghai"
    || value.schedules.proposals[0]?.concurrency?.maximumActive !== 1) {
    errors.push("invalid schedule proposal contract.");
  }
  if (value.harness?.id === value.runtimeBinding?.provider
    || value.harness?.id === value.runtimeBinding?.model
    || value.harness?.fallback !== "fail-closed") {
    errors.push("harness must remain distinct from provider and model.");
  }
  if (value.loop?.maximumAttempts !== 3
    || value.loop?.toolLoopGuard?.maximumRepeatedCalls !== 3
    || !nonEmptyStringArray(value.loop?.stopReasons)
    || value.runtimeBinding?.harness !== value.harness?.id) {
    errors.push("invalid bounded loop/runtime binding.");
  }
  if (!sameArray(
    value.transitions?.map((entry) => entry?.transition),
    ["install", "load", "execute"],
  ) || value.transitions[0]?.phase !== "phase-4"
    || value.transitions[1]?.phase !== "phase-4"
    || value.transitions[2]?.phase !== "phase-5") {
    errors.push("install, load, and execute transitions must remain distinct.");
  }
  if (value.recovery?.maximumRetries !== 2
    || value.recovery?.migrations !== "fail-closed-on-unknown-version"
    || value.recovery?.resumeRequiresExactContractDigest !== true) {
    errors.push("invalid recovery contract.");
  }
  const agentTarget = value.schedules?.proposals?.[0]?.agentTarget;
  const declaredNames = value.tools?.declaredNames;
  if (!ID_PATTERN.test(agentTarget ?? "")
    || !sortedUniqueStrings(declaredNames)
    || !isDeepStrictEqual(
      value,
      buildSpecification({
        agent_id: agentTarget,
        tools: declaredNames.map((name) => ({ name })),
      }),
    )) {
    errors.push("specification must exactly match the canonical OpenClaw construction contract.");
  }
}

function validateResources(value, errors) {
  if (!Array.isArray(value)
    || !sameArray(value.map((resource) => resource?.kind), OPENCLAW_RESOURCE_KINDS)
    || new Set(value.map((resource) => resource?.id)).size !== OPENCLAW_RESOURCE_KINDS.length) {
    errors.push("resources must project every required resource exactly once.");
    return;
  }
  for (const [index, resource] of value.entries()) {
    const expectedKind = OPENCLAW_RESOURCE_KINDS[index];
    if (!plainObject(resource)
      || !hasExactKeys(resource, [
        "id", "kind", "necessity", "owner", "lifecycle", "sourceRefs", "decisionRefs",
        "requirementRefs", "trustSemantics", "permissionSemantics", "failureSemantics",
        "projection", "evidenceObligationRefs",
      ])
      || resource.id !== `resource:${expectedKind}`
      || resource.owner !== "phase-3"
      || !sameObject(resource.lifecycle, {
        declared: "phase-3",
        materialized: "phase-4",
        verified: "phase-5",
      })
      || resource.sourceRefs.length + resource.decisionRefs.length === 0
      || !sortedUniqueStrings(resource.sourceRefs)
      || !sortedUniqueStrings(resource.decisionRefs)
      || !sortedUniqueStrings(resource.requirementRefs)
      || resource.requirementRefs.length === 0
      || !plainObject(resource.projection)
      || !hasExactKeys(resource.projection, ["disposition", "target"])
      || !PROJECTION_DISPOSITIONS.has(resource.projection.disposition)
      || resource.projection.disposition !== projectionFor(expectedKind).disposition
      || resource.projection.target !== projectionFor(expectedKind).target
      || !sameArray(resource.evidenceObligationRefs, [`evidence:${expectedKind}`])) {
      errors.push(`invalid resource projection ${expectedKind}.`);
    }
  }
}

function validatePermissions(value, resources, errors) {
  if (!Array.isArray(value)
    || !Array.isArray(resources)
    || value.length !== resources.length
    || new Set(value.map((entry) => entry?.id)).size !== value.length) {
    errors.push("permissions must cover every resource exactly once.");
    return;
  }
  for (const [index, permission] of value.entries()) {
    const resource = resources[index];
    if (!plainObject(permission)
      || !hasExactKeys(permission, [
        "id", "resourceId", "authority", "approvalRequired", "default",
      ])
      || permission.id !== `permission:${resource.kind}`
      || permission.resourceId !== resource.id
      || permission.authority !== permissionAuthority(resource.kind)
      || permission.approvalRequired !== mutationKinds().has(resource.kind)
      || permission.default !== "deny-unless-declared") {
      errors.push(`invalid permission for ${resource.kind}.`);
    }
  }
}

function validateAcceptanceCases(value, errors) {
  if (!Array.isArray(value) || value.length === 0
    || new Set(value.map((entry) => entry?.id)).size !== value.length) {
    errors.push("acceptanceCases must be complete and unique.");
    return;
  }
  for (const entry of value) {
    if (!plainObject(entry)
      || !hasExactKeys(entry, ["id", "requirementId", "evalCaseId", "expected", "phase"])
      || entry.id !== `acceptance:${entry.requirementId}`
      || entry.evalCaseId !== `eval:${entry.requirementId}`
      || entry.expected !== "bounded-evidence-or-explicit-gap"
      || entry.phase !== "phase-5") {
      errors.push("invalid acceptance case.");
    }
  }
}

function validateEvidenceObligations(value, resources, errors) {
  if (!Array.isArray(value)
    || !Array.isArray(resources)
    || value.length !== resources.length
    || new Set(value.map((entry) => entry?.id)).size !== value.length) {
    errors.push("evidence obligations must cover every resource exactly once.");
    return;
  }
  for (const [index, entry] of value.entries()) {
    const resource = resources[index];
    if (!plainObject(entry)
      || !hasExactKeys(entry, ["id", "resourceId", "requiredAt", "proves", "doesNotProve"])
      || entry.id !== `evidence:${resource.kind}`
      || entry.resourceId !== resource.id
      || entry.requiredAt !== evidencePhase(resource.kind)
      || entry.proves !== evidenceClaim(resource.kind)
      || !sameArray(entry.doesNotProve, ["domain-quality", "production-readiness"])) {
      errors.push(`invalid evidence obligation for ${resource.kind}.`);
    }
  }
}

function validateTraceGraph(value, contract, errors) {
  if (!plainObject(value) || !hasExactKeys(value, TRACE_KEYS)) {
    errors.push("traceGraph must contain exact bidirectional graph fields.");
    return;
  }
  for (const key of TRACE_KEYS.slice(0, -2)) {
    if (!uniqueStrings(value[key]) || value[key].length === 0) {
      errors.push(`traceGraph.${key} must be non-empty and unique.`);
    }
  }
  if (!sameArray(value.resourceIds, contract.resources.map(({ id }) => id))
    || !sameArray(value.permissionIds, contract.permissions.map(({ id }) => id))
    || !sameArray(value.acceptanceCaseIds, contract.acceptanceCases.map(({ id }) => id))
    || !sameArray(
      value.evidenceObligationIds,
      contract.evidenceObligations.map(({ id }) => id),
    )) {
    errors.push("traceGraph ids do not match contract records.");
  }
  if (!Array.isArray(value.forwardTraceEdges)
    || !Array.isArray(value.reverseTraceEdges)
    || value.forwardTraceEdges.length !== value.reverseTraceEdges.length) {
    errors.push("traceGraph edges must be bidirectional.");
    return;
  }
  const expectedReverse = sortEdges(value.forwardTraceEdges.map((edge) => ({
    from: edge?.to,
    to: edge?.from,
    relation: edge?.relation,
  })));
  if (JSON.stringify(expectedReverse) !== JSON.stringify(value.reverseTraceEdges)) {
    errors.push("traceGraph reverse edges are not the exact inverse.");
  }
  for (const requirementId of value.requirementIds) {
    if (!hasEdge(value.forwardTraceEdges, requirementId, `capability:${requirementId}`)
      || !hasEdge(value.forwardTraceEdges, requirementId, `eval:${requirementId}`)
      || !hasEdge(value.forwardTraceEdges, requirementId, `acceptance:${requirementId}`)) {
      errors.push(`requirement ${requirementId} is not fully traced.`);
    }
  }
  for (const capabilityId of value.capabilityIds) {
    if (!value.forwardTraceEdges.some((edge) => edge.from === capabilityId
      && value.resourceIds.includes(edge.to))) {
      errors.push(`capability ${capabilityId} has no resource.`);
    }
  }
  for (const resourceId of value.resourceIds) {
    if (!value.forwardTraceEdges.some((edge) => edge.from === resourceId
      && value.permissionIds.includes(edge.to))
      || !value.forwardTraceEdges.some((edge) => edge.from === resourceId
        && value.evidenceObligationIds.includes(edge.to))) {
      errors.push(`resource ${resourceId} is not governed and evidenced.`);
    }
  }
}

function validateCertificationBoundary(value, errors) {
  if (!plainObject(value) || !hasExactKeys(value, Object.keys(CERTIFICATION_BOUNDARY))) {
    errors.push("invalid certification boundary.");
    return;
  }
  for (const [key, expected] of Object.entries(CERTIFICATION_BOUNDARY)) {
    if (value[key] !== expected) errors.push(`invalid certificationBoundary.${key}.`);
  }
}

function hasClosedContractKeys(value) {
  const keys = Object.keys(value);
  return REQUIRED_CONTRACT_KEYS.every((key) => keys.includes(key))
    && keys.every((key) => CONTRACT_KEYS.includes(key));
}

function targetRuntimeFromDescriptor(descriptor, descriptorDigest) {
  const memberDigest = (role) => (
    descriptor.members.find((member) => member.role === role)?.sha256
  );
  return {
    id: descriptor.target.id,
    sourceRevision: descriptor.target.sourceRevision,
    displayRevision: descriptor.target.displayRevision,
    observedVersion: descriptor.target.version,
    nodeRange: descriptor.target.nodeRange,
    descriptorDigest,
    targetRootDigest: descriptor.targetRoot.memberClosureDigest,
    executableDigest: memberDigest("executable"),
    packageJsonDigest: memberDigest("package-json"),
    buildInfoDigest: memberDigest("build-info"),
    driftPolicy: "phase-4-must-fail-closed-on-exact-descriptor-drift",
  };
}

function descriptorRawDigest(descriptor) {
  return `sha256:${createHash("sha256")
    .update(Buffer.from(serializePersistableJson(descriptor, {
      subject: "openclaw-target-descriptor",
    }), "utf8"))
    .digest("hex")}`;
}

function targetVersionRange(targetRuntime) {
  return `${targetRuntime.observedVersion}@${targetRuntime.displayRevision}`;
}

function hasEdge(edges, from, to) {
  return edges.some((edge) => edge?.from === from && edge?.to === to);
}

function sortEdges(edges) {
  return edges.map((edge) => ({ ...edge })).sort((left, right) => (
    left.from.localeCompare(right.from)
    || left.to.localeCompare(right.to)
    || left.relation.localeCompare(right.relation)
  ));
}

function sortedUniqueStrings(value) {
  return Array.isArray(value)
    && value.every((entry) => typeof entry === "string" && entry.length > 0)
    && new Set(value).size === value.length
    && sameArray(value, [...value].sort());
}

function uniqueStrings(value) {
  return Array.isArray(value)
    && value.every((entry) => typeof entry === "string" && entry.length > 0)
    && new Set(value).size === value.length;
}

function nonEmptyStringArray(value) {
  return Array.isArray(value)
    && value.length > 0
    && value.every((entry) => typeof entry === "string" && entry.length > 0);
}

function sameArray(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((entry, index) => entry === right[index]);
}

function sameObject(left, right) {
  return plainObject(left)
    && hasExactKeys(left, Object.keys(right))
    && Object.entries(right).every(([key, value]) => left[key] === value);
}

function hasExactKeys(value, expected) {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function plainObject(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
