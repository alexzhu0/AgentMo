import { createHash } from "node:crypto";
import path from "node:path";
import {
  admittedArtifactProvenance,
  ArtifactAdmissionError,
} from "./artifact-admission.js";
import { renderDigestBindings } from "./artifact-subjects.js";
import {
  BLUEPRINT_IDENTITY_FIELD,
  BLUEPRINT_SCHEMA_VERSION,
  DESIGN_CONTRACT_VERSION,
  validateBlueprint,
} from "./blueprint.js";
import { DESIGN_PLAN_SCHEMA_VERSION, validateDesignPlan } from "./design-plan.js";
import { DISCOVERY_DB_SCHEMA_VERSION } from "./discovery-db.js";
import {
  PersistabilityError,
  serializePersistableJson,
  writePersistableJsonAtomic,
} from "./persistability.js";
import { validateSourceRefs } from "./source-refs.js";
import { USER_NEED_SCHEMA_VERSION, validateUserNeed } from "./user-need.js";

export const BLUEPRINT_DRAFT_SCHEMA_VERSION = "agentmo.blueprint-draft.v1";
const ADMITTED_BLUEPRINT_DRAFT_CANDIDATES = new WeakSet();

export function draftBlueprint(discoveryDb, userNeed, options = {}) {
  assertDraftInputs(discoveryDb, userNeed);
  const designPlan = options.designPlan ?? null;
  const agentId = sanitizeAgentId(userNeed.agent_id ?? discoveryDb.agentId);
  const runtime = resolveRuntime(options.target, options.runtime);
  if (designPlan !== null) assertDesignPlanForDraft(designPlan, { agentId, domain: userNeed.domain, runtime });
  const admittedInputs = options.admissions === undefined
    ? null
    : admittedBlueprintInputs(discoveryDb, userNeed, designPlan, options.admissions);
  const sourceIds = Array.isArray(discoveryDb.sources) ? discoveryDb.sources.map((source) => source.id).filter(nonEmptyString) : [];
  const sourceDescriptions = Array.isArray(discoveryDb.sources)
    ? discoveryDb.sources.map((source) => `${source.id}: ${source.description}`).filter(nonEmptyString)
    : [];
  const taskClasses = userNeed.primary_tasks.map((task) => slug(task)).filter(nonEmptyString);
  const hardFailures = userNeed.hard_failures.map((failure) => slug(failure)).filter(nonEmptyString);
  const specialists = userNeed.primary_tasks.slice(0, 4).map((task) => ({
    id: `${agentId}-${slug(task).slice(0, 32)}`.replace(/-+$/u, ""),
    purpose: task,
  }));
  const tools = userNeed.primary_tasks.slice(0, 6).map((task) => ({
    name: `${agentId}_${slug(task).replaceAll("-", "_")}`.replace(/_+$/u, ""),
    purpose: `Support the workflow task: ${task}`,
    allowed_when: [task],
    forbidden_when: userNeed.hard_failures,
    evidence_policy: "Use bounded discovery-db fact refs and disclose missing or unverified source coverage.",
  }));
  const releaseTrace = sourceHash(admittedInputs ?? { discoveryDb, userNeed });

  const blueprint = {
    [BLUEPRINT_IDENTITY_FIELD]: BLUEPRINT_SCHEMA_VERSION,
    agent_id: agentId,
    runtime,
    status: "draft",
    design_contract: buildDesignContractProvenance(admittedInputs),
    domain_genome: {
      domain: userNeed.domain,
      purpose: userNeed.problem,
      task_classes: taskClasses.length > 0 ? taskClasses : ["general_triage"],
      knowledge_sources: sourceIds.length > 0 ? sourceIds : ["discovery-db"],
      hard_failures: hardFailures.length > 0 ? hardFailures : ["unverified_claim"],
    },
    architecture: {
      main_agent: `${agentId}-main`,
      specialists: specialists.length > 0 ? specialists : [{ id: `${agentId}-specialist`, purpose: userNeed.problem }],
      routing_modes: taskClasses.length > 0 ? taskClasses : ["default_route"],
    },
    tools: tools.length > 0 ? tools : [defaultTool(agentId, userNeed)],
    evidence: {
      stores: ["agentmo-discovery-db.json", "facts.jsonl", "coverage.json", "agentmo-birth-report.json"],
      required_artifacts: ["discovery pack", "user-need report", "blueprint validation", "handoff package", "birth report"],
      audit_rules: [
        "Do not store credential values, full conversation logs, full tool responses, or production runtime state in managed evidence.",
        "Use bounded fact refs from the discovery pack and disclose unknowns.",
        "Do not claim runtime/domain certification from declared evidence or scaffold smoke alone.",
      ],
    },
    eval: {
      cases_path: "evals/CASES.md",
      rubric_path: "evals/RUBRIC.md",
      required_case_classes: taskClasses.length > 0 ? taskClasses : ["default_route"],
      hard_failures: hardFailures.length > 0 ? hardFailures : ["unverified_claim"],
    },
    governance: {
      policies: [
        "AgentMo-generated blueprints must preserve reviewed discovery/user-need provenance; Stage 3 admission is by valid design contract.",
        "fail closed when source coverage or user need is insufficient",
        "bounded evidence by default",
        "birth requires build-state, run-state, run-eval, and birth-report evidence",
      ],
      quality_gates: [
        "domain_genome_defined",
        "pipeline_defined",
        "architecture_defined",
        "tool_contracts_defined",
        "evidence_store_defined",
        "eval_suite_defined",
        "governance_defined",
        "release_trace_defined",
      ],
    },
    release: {
      latest_commit: `draft-${releaseTrace.slice(0, 8)}`,
      release_ledger_path: "docs/AGENTMO_MVP_LEDGER.md",
      known_risks: [
        "Draft blueprint is generated from bounded discovery/user-need inputs and is not production certified.",
        "Runtime birth requires separate live-success evidence before promotion from declared status.",
      ],
    },
    runtime_profiles: buildRuntimeProfiles(runtime, userNeed, options),
    pipeline: buildPipeline(discoveryDb, userNeed, runtime, { designPlan, target: options.target }),
    ...(designPlan === null
      ? {}
      : {
          stage2_planning: {
            schemaVersion: designPlan.schemaVersion,
            ...(admittedInputs?.designPlan ? { admission: admittedInputs.designPlan } : {}),
            requirement_count: Array.isArray(designPlan.requirementsTrace) ? designPlan.requirementsTrace.length : 0,
            gap_count: Array.isArray(designPlan.gaps) ? designPlan.gaps.length : 0,
            evidence_policy: "bounded refs only; full Stage 2 evidence map remains in the design-plan artifact",
          },
        }),
  };
  if (admittedInputs !== null) ADMITTED_BLUEPRINT_DRAFT_CANDIDATES.add(blueprint);
  return blueprint;
}

export function buildBlueprintDraftReport(blueprint, options = {}) {
  const validation = validateBlueprint(blueprint);
  return {
    schemaVersion: BLUEPRINT_DRAFT_SCHEMA_VERSION,
    ok: validation.ok,
    blueprintPath: boundedPath(options.blueprintPath),
    agentId: blueprint.agent_id,
    runtime: blueprint.runtime,
    status: blueprint.status,
    validation,
  };
}

export async function writeBlueprintDraft(filePath, blueprint) {
  if (!ADMITTED_BLUEPRINT_DRAFT_CANDIDATES.has(blueprint)) {
    throw new PersistabilityError("AGENTMO_PERSISTABILITY_UNADMITTED_CANDIDATE");
  }
  const validation = validateBlueprint(blueprint);
  if (!validation.ok) throw new PersistabilityError("AGENTMO_PERSISTABILITY_INVALID_CANDIDATE");
  serializePersistableJson(blueprint, { subject: "blueprint-draft" });
  const target = path.resolve(filePath);
  await writePersistableJsonAtomic(target, blueprint, { subject: "blueprint-draft" });
  return target;
}

export function formatBlueprintDraftReport(report) {
  const lines = [
    `AgentMo blueprint draft: ${report.agentId}`,
    `Status: ${report.ok ? "pass" : "fail"}`,
    `Runtime: ${report.runtime}`,
    `Blueprint: ${report.blueprintPath ?? "not written"}`,
  ];
  for (const warning of report.validation.warnings) lines.push(`WARN ${warning}`);
  for (const error of report.validation.errors) lines.push(`ERROR ${error}`);
  return `${lines.join("\n")}\n`;
}

function assertDraftInputs(discoveryDb, userNeed) {
  if (discoveryDb?.schemaVersion !== DISCOVERY_DB_SCHEMA_VERSION) {
    throw new Error(`discovery-db schemaVersion must be ${DISCOVERY_DB_SCHEMA_VERSION}`);
  }
  if (userNeed?.schemaVersion !== USER_NEED_SCHEMA_VERSION) {
    throw new Error(`user-need schemaVersion must be ${USER_NEED_SCHEMA_VERSION}`);
  }
  const needValidation = validateUserNeed(userNeed);
  if (!needValidation.ok) {
    throw new Error(`Cannot draft blueprint for invalid user need:\n${needValidation.errors.map((error) => `- ${error}`).join("\n")}`);
  }
  if (typeof discoveryDb.agentId === "string" && discoveryDb.agentId !== userNeed.agent_id) {
    throw new Error(`discovery-db agentId ${discoveryDb.agentId} does not match user-need agent_id ${userNeed.agent_id}`);
  }
  if (discoveryDb.safety?.workspaceOk === false || discoveryDb.workspace?.ok === false) {
    throw new Error("Cannot draft blueprint from an unsafe workspace discovery-db safety state.");
  }
  if (discoveryDb.validation?.ok !== true) {
    throw new Error("Cannot draft blueprint from a discovery-db whose source manifest did not validate.");
  }
  const sourceRefValidation = validateSourceRefs(userNeed.source_refs ?? [], {
    sourceIds: Array.isArray(discoveryDb.sources) ? discoveryDb.sources.map((source) => source.id).filter(nonEmptyString) : [],
    factIds: Array.isArray(discoveryDb.facts) ? discoveryDb.facts.map((fact) => fact.id).filter(nonEmptyString) : [],
    fieldPath: "source_refs",
    requireKnownBareRefs: true,
  });
  if (!sourceRefValidation.ok) {
    throw new Error(`Cannot draft blueprint for invalid source_refs:\n${sourceRefValidation.errors.map((error) => `- ${error}`).join("\n")}`);
  }
}

function assertDesignPlanForDraft(designPlan, { agentId, domain, runtime }) {
  if (designPlan.schemaVersion !== DESIGN_PLAN_SCHEMA_VERSION) {
    throw new Error(`design-plan schemaVersion must be ${DESIGN_PLAN_SCHEMA_VERSION}`);
  }
  if (designPlan.ok !== true) throw new Error("design-plan ok must be true before blueprint drafting.");
  if (designPlan.validation?.ok !== true) throw new Error("design-plan validation.ok must be true before blueprint drafting.");
  const validation = validateDesignPlan(designPlan);
  if (!validation.ok) {
    throw new Error(`Invalid design-plan for blueprint draft:\n${validation.errors.map((error) => `- ${error}`).join("\n")}`);
  }
  if (designPlan.agentId !== agentId) throw new Error(`design-plan agent id ${designPlan.agentId} does not match blueprint agent id ${agentId}.`);
  if (designPlan.domain !== domain) throw new Error(`design-plan domain ${designPlan.domain} does not match user-need domain ${domain}.`);
  if (designPlan.targetRuntime !== runtime) throw new Error(`design-plan target runtime ${designPlan.targetRuntime} does not match blueprint runtime ${runtime}.`);
}

function buildDesignContractProvenance(admittedInputs) {
  const admittedArtifacts = admittedInputs === null
    ? []
    : [admittedInputs.discoveryDb, admittedInputs.userNeed, admittedInputs.designPlan].filter(Boolean);
  return {
    provenance: {
      source: "agentmo-stage2",
      reviewed: admittedInputs !== null,
      ...(admittedInputs === null ? {} : { review_ref: admissionReviewRef(admittedArtifacts) }),
      contract_version: DESIGN_CONTRACT_VERSION,
      notes: admittedInputs === null
        ? "In-memory Stage 2 draft; persistence requires exact admitted inputs and does not certify runtime or domain behavior."
        : "Generated from exact admitted Stage 2 artifacts; admission does not certify runtime or domain behavior.",
      admitted_artifacts: admittedArtifacts,
    },
  };
}

function buildPipeline(discoveryDb, userNeed, runtime, options = {}) {
  const planningInputs = [
    "agentmo-discovery-db.json",
    "facts.jsonl",
    "agentmo.user-need.v1",
    ...(options.designPlan ? ["agentmo.design-plan.v1"] : []),
    ...(Array.isArray(userNeed.source_refs) ? userNeed.source_refs : []),
  ];
  const planningOutputs = options.designPlan
    ? ["AgentMo blueprint", "design-plan review ref", "tool contracts", "evidence policy", "eval class list", "runtime profile"]
    : ["AgentMo blueprint", "tool contracts", "evidence policy", "eval class list", "runtime profile"];
  return {
    discover: {
      purpose: "Find bounded source data and concrete user need before designing the agent.",
      data_sources: discoveryDb.sources.map((source) => `${source.id}: ${source.description}`),
      database_outputs: discoveryDb.outputs.database,
      user_need_inputs: userNeed.primary_tasks,
      done_when: ["discovery pack validates", "user need validates", "source coverage and unknowns are explicit"],
    },
    plan: {
      purpose: "Convert discovery facts plus user need into a buildable AgentMo blueprint.",
      planning_inputs: Array.from(new Set(planningInputs.filter(nonEmptyString))),
      planning_outputs: planningOutputs,
      decision_gates: ["no production claim from draft", "no build if discovery/user need is invalid", "no birth without birth-report"],
      done_when: ["blueprint validates", "handoff package is generated", "birth-report inputs are known"],
    },
    produce: {
      purpose: "Use Codex or another coding agent to implement, test, and document the specified agent.",
      coding_tools: ["Codex", "AgentMo CLI", runtime === "openclaw" ? "OpenClaw" : "selected runtime"],
      runtime_targets: [runtime],
      generated_outputs: ["agent prompt/workspace", "tool contract implementation", "eval fixtures", "runbook", "birth report"],
      verification_steps: buildVerificationCommands(runtime, options.target),
      done_when: ["declared birth gate passes", "live-success birth gate passes before runtime promotion", "known risks are recorded"],
    },
  };
}

function boundedPath(filePath) {
  if (!nonEmptyString(filePath)) return null;
  return path.basename(filePath);
}

function buildRuntimeProfiles(runtime, userNeed, options) {
  const baseProfile = {
    id: runtime,
    role: "primary",
    status: runtime === "openclaw" ? "experimental" : "planned",
    purpose: `${runtime} runtime profile for ${userNeed.agent_id} MVP production path.`,
    owned_surfaces: ["generated workspace", "agent config", "runbook", "birth report"],
    evidence_boundaries: ["bounded discovery pack", "managed run-state", "birth-report summary", "no full conversation logs by default"],
    source_refs: userNeed.source_refs ?? [],
    transfer_rules: ["Keep provider, model, runtime, channel, and target evidence separate."],
    supported_assets: ["generated scaffold", "handoff package", "declared run evidence"],
    unsupported_surfaces: ["production deployment", "domain certification", "runtime parity without live-success eval evidence"],
    install_or_onramp: `Use agentmo handoff --target ${options.target ?? "openclaw"} and run the birth gate before promotion.`,
    verification_commands: buildVerificationCommands(runtime, options.target),
    risk_notes: ["Draft runtime profile is not certified until live-success birth evidence exists."],
    owner: "AgentMo MVP operator",
    last_verified_at: "2026-07-06",
  };
  return [baseProfile];
}

function buildVerificationCommands(runtime, requestedTarget) {
  const target = requestedTarget ?? (runtime === "openclaw" ? "openclaw" : "agentmo");
  const blueprintPath = "<blueprint.json>";
  const runtimePlanPath = "<runtime-plan.json>";
  const buildStatePath = "<agentmo-build-state.json>";
  const runStatePath = "<run-state.json>";
  const runEvalPath = "<run-eval.json>";
  const birthReportPath = "<birth-report.json>";
  const commands = [
    `agentmo validate "${blueprintPath}" ${renderDigestBindings("validate", { blueprint: blueprintPath })}`,
    `agentmo scaffold "${blueprintPath}" ${renderDigestBindings("scaffold", { blueprint: blueprintPath })} --target "${target}" --out "<runtime-output>"`,
  ];
  if (runtime === "openclaw") {
    commands.push(
      `agentmo run-plan "${blueprintPath}" ${renderDigestBindings("run-plan", { blueprint: blueprintPath })} --target "openclaw" --workspace "<runtime-workspace>" --message "<smoke-message>" --json > "${runtimePlanPath}"`,
      `agentmo run "${runtimePlanPath}" ${renderDigestBindings("run", { "runtime-plan": runtimePlanPath })} --workspace "<runtime-workspace>" --message "<smoke-message>" --out "<run-output>" --json`,
      `agentmo run-eval "${runStatePath}" ${renderDigestBindings("run-eval", { "run-state": runStatePath })} --expect-status "declared" --json > "${runEvalPath}"`,
      `agentmo birth-report "${blueprintPath}" ${renderDigestBindings("birth-report", {
        blueprint: blueprintPath,
        "build-state": buildStatePath,
        "run-state": runStatePath,
        "run-eval": runEvalPath,
      })} --build-state "${buildStatePath}" --run-state "${runStatePath}" --run-eval "${runEvalPath}" --expect-status "declared" --json > "${birthReportPath}"`,
    );
  }
  commands.push("npm run check");
  return commands;
}

function defaultTool(agentId, userNeed) {
  return {
    name: `${agentId}_default_task`,
    purpose: userNeed.problem,
    allowed_when: userNeed.primary_tasks,
    forbidden_when: userNeed.hard_failures,
    evidence_policy: "Use bounded discovery-db fact refs and disclose missing evidence.",
  };
}

function resolveRuntime(target, runtime) {
  if (nonEmptyString(runtime)) return runtime;
  if (target === "agentmo") return "codex";
  return "openclaw";
}

function sanitizeAgentId(value) {
  const candidate = slug(value);
  if (!/^[a-z][a-z0-9-]*$/u.test(candidate)) throw new Error(`Invalid generated agent_id: ${candidate}`);
  return candidate;
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .replace(/-+/gu, "-") || "agent";
}

function sourceHash(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function admittedBlueprintInputs(discoveryDb, userNeed, designPlan, admissions) {
  const expectedKeys = designPlan === null
    ? ["discoveryDb", "userNeed"]
    : ["discoveryDb", "userNeed", "designPlan"];
  if (!isObject(admissions) || !hasExactKeys(admissions, expectedKeys)) {
    throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_ADMISSION_RESULT_INVALID");
  }
  return {
    discoveryDb: admittedArtifactProvenance(admissions.discoveryDb, {
      subject: "discovery-db",
      value: discoveryDb,
    }),
    userNeed: admittedArtifactProvenance(admissions.userNeed, {
      subject: "user-need",
      value: userNeed,
    }),
    ...(designPlan === null
      ? {}
      : {
          designPlan: admittedArtifactProvenance(admissions.designPlan, {
            subject: "design-plan",
            value: designPlan,
          }),
        }),
  };
}

function admissionReviewRef(admittedArtifacts) {
  const digest = createHash("sha256")
    .update(admittedArtifacts.map((item) => `${item.subject}=${item.digest}`).join("\n"))
    .digest("hex");
  return `admitted-inputs:sha256:${digest}`;
}

function hasExactKeys(value, expected) {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
