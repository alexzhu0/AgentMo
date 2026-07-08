import { createHash } from "node:crypto";
import { readFile, rename, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { DESIGN_CONTRACT_VERSION, validateBlueprint } from "./blueprint.js";
import { DISCOVERY_DB_SCHEMA_VERSION } from "./discovery-db.js";
import { USER_NEED_SCHEMA_VERSION, validateUserNeed } from "./user-need.js";

export const BLUEPRINT_DRAFT_SCHEMA_VERSION = "agentmo.blueprint-draft.v1";

export async function loadJsonFile(filePath, subject) {
  const raw = await readFile(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${subject} JSON ${filePath}: ${message}`);
  }
}

export function draftBlueprint(discoveryDb, userNeed, options = {}) {
  assertDraftInputs(discoveryDb, userNeed);
  const agentId = sanitizeAgentId(userNeed.agent_id ?? discoveryDb.agentId);
  const runtime = resolveRuntime(options.target, options.runtime);
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
  const releaseTrace = sourceHash({ discoveryDb, userNeed });

  return {
    agentmother_version: "0.1",
    agent_id: agentId,
    runtime,
    status: "draft",
    design_contract: buildDesignContractProvenance(),
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
        "Do not store credential values, raw transcripts, raw tool bodies, or production runtime state in managed evidence.",
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
    pipeline: buildPipeline(discoveryDb, userNeed, runtime),
  };
}

export function buildBlueprintDraftReport(blueprint, options = {}) {
  const validation = validateBlueprint(blueprint);
  return {
    schemaVersion: BLUEPRINT_DRAFT_SCHEMA_VERSION,
    ok: validation.ok,
    blueprintPath: options.blueprintPath ? path.resolve(options.blueprintPath) : null,
    agentId: blueprint.agent_id,
    runtime: blueprint.runtime,
    status: blueprint.status,
    validation,
  };
}

export async function writeBlueprintDraft(filePath, blueprint) {
  const target = path.resolve(filePath);
  await mkdir(path.dirname(target), { recursive: true });
  const temporaryFile = `${target}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryFile, `${JSON.stringify(blueprint, null, 2)}\n`, "utf8");
  await rename(temporaryFile, target);
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
  if (discoveryDb.validation?.ok !== true) {
    throw new Error("Cannot draft blueprint from a discovery-db whose source manifest did not validate.");
  }
}

function buildDesignContractProvenance() {
  return {
    provenance: {
      source: "agentmo-stage2",
      reviewed: true,
      review_ref: "blueprint-draft:agentmo.discovery-db.v1+agentmo.user-need.v1",
      contract_version: DESIGN_CONTRACT_VERSION,
      notes:
        "Generated by AgentMo Stage 2 from validated discovery-db and user-need artifacts; this is an admission record only, not runtime/domain certification.",
    },
  };
}

function buildPipeline(discoveryDb, userNeed, runtime) {
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
      planning_inputs: ["agentmo-discovery-db.json", "facts.jsonl", "user-need report", ...userNeed.source_refs ?? []],
      planning_outputs: ["AgentMo blueprint", "tool contracts", "evidence policy", "eval class list", "runtime profile"],
      decision_gates: ["no production claim from draft", "no build if discovery/user need is invalid", "no birth without birth-report"],
      done_when: ["blueprint validates", "handoff package is generated", "birth-report inputs are known"],
    },
    produce: {
      purpose: "Use Codex or another coding agent to implement, test, and document the specified agent.",
      coding_tools: ["Codex", "AgentMo CLI", runtime === "openclaw" ? "OpenClaw" : "selected runtime"],
      runtime_targets: [runtime],
      generated_outputs: ["agent prompt/workspace", "tool contract implementation", "eval fixtures", "runbook", "birth report"],
      verification_steps: ["agentmo validate", "agentmo scaffold", "agentmo run-eval", "agentmo birth-report", "npm run check"],
      done_when: ["declared birth gate passes", "live-success birth gate passes before runtime promotion", "known risks are recorded"],
    },
  };
}

function buildRuntimeProfiles(runtime, userNeed, options) {
  const baseProfile = {
    id: runtime,
    role: "primary",
    status: runtime === "openclaw" ? "experimental" : "planned",
    purpose: `${runtime} runtime profile for ${userNeed.agent_id} MVP production path.`,
    owned_surfaces: ["generated workspace", "agent config", "runbook", "birth report"],
    evidence_boundaries: ["bounded discovery pack", "managed run-state", "birth-report summary", "no raw transcripts by default"],
    source_refs: userNeed.source_refs ?? [],
    transfer_rules: ["Keep provider, model, runtime, channel, and target evidence separate."],
    supported_assets: ["generated scaffold", "handoff package", "declared run evidence"],
    unsupported_surfaces: ["production deployment", "domain certification", "runtime parity without live-success eval evidence"],
    install_or_onramp: `Use agentmo handoff --target ${options.target ?? "openclaw"} and run the birth gate before promotion.`,
    verification_commands: [
      "agentmo validate <blueprint>",
      "agentmo birth-report <blueprint> --build-state <agentmo-build-state.json> --run-state <run-state.json> --run-eval <run-eval.json> --expect-status declared",
      "npm run check",
    ],
    risk_notes: ["Draft runtime profile is not certified until live-success birth evidence exists."],
    owner: "AgentMo MVP operator",
    last_verified_at: "2026-07-06",
  };
  return [baseProfile];
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
