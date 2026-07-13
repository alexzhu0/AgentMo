import path from "node:path";
import { renderDigestBindings } from "./artifact-subjects.js";
import { BLUEPRINT_SCHEMA_VERSION, validateBlueprint } from "./blueprint.js";
import {
  assertPersistable,
  serializePersistableJson,
  writePersistableTextAtomic,
} from "./persistability.js";
import { listTargetIds } from "./targets/registry.js";

export const HANDOFF_SCHEMA_VERSION = "agentmo.handoff.v1";

const HANDOFF_FILE_PATHS = Object.freeze([
  "README.md",
  "BUILD_TASKS.md",
  "ACCEPTANCE_CRITERIA.md",
  "TEST_PLAN.md",
  "ROLLBACK_PLAN.md",
  "RUNTIME_PLAN.md",
  "EVIDENCE_REQUIREMENTS.md",
  "VERIFY.md",
  "agentmo-handoff.json",
]);
const STAGE3_REQUIRED_ARTIFACTS = Object.freeze([
  "validated blueprint/design contract",
  "explicit target/runtime options",
  "build-state",
  "run-state",
  "run-eval",
  "birth-report",
  "domain-cases",
  "domain-eval",
]);
const REQUIRED_OUTPUTS = Object.freeze([
  "runtime scaffold",
  "bounded evidence",
  "birth report",
  "domain eval",
  "delivery report",
  "verification log",
]);
const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const HANDOFF_STATUSES = new Set(["draft", "gestating", "born", "training", "certified", "released", "deprecated"]);
const AUTHENTIC_HANDOFF_PACKAGES = new WeakSet();

export class HandoffPackageError extends Error {
  constructor(code) {
    super("Handoff package is not safe to persist.");
    this.name = "HandoffPackageError";
    this.code = code;
  }
}

export async function loadHandoffPackage(filePath, options = {}) {
  if (options.subject !== "handoff") {
    const { AgentMoUnsupportedArtifactError } = await import("./artifact-registry.js");
    throw new AgentMoUnsupportedArtifactError("subject_identity_mismatch");
  }
  const { loadAdmittedArtifact } = await import("./artifact-admission.js");
  return (await loadAdmittedArtifact({
    filePath,
    subject: "handoff",
    expectedDigest: options.expectedDigest,
    maxBytes: options.maxBytes,
    openInput: options.openInput,
  })).value;
}

export async function buildHandoffPackage(blueprint, options = {}) {
  const target = options.target ?? "openclaw";
  if (!listTargetIds().includes(target)) {
    throw new Error(`Unknown handoff target: ${target}. Expected one of: ${listTargetIds().join(", ")}`);
  }

  const { admittedArtifactProvenance } = await import("./artifact-admission.js");
  const provenance = admittedArtifactProvenance(options.admission, {
    subject: "blueprint",
    value: blueprint,
  });
  const validation = validateBlueprint(blueprint);
  if (!validation.ok) throw new HandoffPackageError("AGENTMO_HANDOFF_BLUEPRINT_INVALID");

  const handoff = {
    schemaVersion: HANDOFF_SCHEMA_VERSION,
    ok: true,
    agentId: blueprint.agent_id,
    target,
    status: blueprint.status,
    pipelineStage: "produce",
    certificationBoundary: {
      handoffCertifiesRuntime: false,
      handoffCertifiesDomain: false,
    },
    provenance,
    commands: buildCommands(blueprint, target),
    requiredInputs: [...STAGE3_REQUIRED_ARTIFACTS],
    stage3RequiredArtifacts: [...STAGE3_REQUIRED_ARTIFACTS],
    requiredOutputs: [...REQUIRED_OUTPUTS],
    risks: [...blueprint.release.known_risks],
    validation: {
      ok: true,
      warnings: [...validation.warnings],
      errors: [],
    },
  };
  assertPersistable(handoff, { subject: "handoff" });
  const handoffValidation = validateHandoffPackage(handoff);
  if (!handoffValidation.ok) throw new HandoffPackageError("AGENTMO_HANDOFF_PACKAGE_INVALID");

  const manifest = serializePersistableJson(handoff, { subject: "handoff" });
  const candidate = {
    ok: true,
    handoff,
    files: buildHandoffFiles(blueprint, handoff, manifest),
  };
  preflightHandoffPackage(candidate, { requireAuthentic: false });
  deepFreeze(candidate);
  AUTHENTIC_HANDOFF_PACKAGES.add(candidate);
  return candidate;
}

export async function writeHandoffPackage(outDir, handoffPackage) {
  const files = preflightHandoffPackage(handoffPackage, { requireAuthentic: true });
  if (typeof outDir !== "string" || outDir.length === 0 || outDir.includes("\0")) {
    throw new HandoffPackageError("AGENTMO_HANDOFF_OUTPUT_INVALID");
  }
  const root = path.resolve(outDir);
  const written = [];
  for (const file of files) {
    const filePath = path.join(root, file.relativePath);
    await writePersistableTextAtomic(filePath, file.content, { subject: "handoff-file" });
    written.push(filePath);
  }
  return { outDir: root, files: written.sort() };
}

export function validateHandoffPackage(value) {
  const errors = [];
  try {
    assertPersistable(value, { subject: "handoff" });
    requireExactKeys(value, [
      "schemaVersion",
      "ok",
      "agentId",
      "target",
      "status",
      "pipelineStage",
      "certificationBoundary",
      "provenance",
      "commands",
      "requiredInputs",
      "stage3RequiredArtifacts",
      "requiredOutputs",
      "risks",
      "validation",
    ], "handoff", errors);
    if (value?.schemaVersion !== HANDOFF_SCHEMA_VERSION) errors.push("schemaVersion is unsupported.");
    if (value?.ok !== true) errors.push("ok must be true.");
    if (!isKebabId(value?.agentId)) errors.push("agentId must be lowercase kebab-case.");
    if (!listTargetIds().includes(value?.target)) errors.push("target is unsupported.");
    if (!HANDOFF_STATUSES.has(value?.status)) errors.push("status is unsupported.");
    if (value?.pipelineStage !== "produce") errors.push("pipelineStage must be produce.");

    requireExactKeys(value?.certificationBoundary, [
      "handoffCertifiesRuntime",
      "handoffCertifiesDomain",
    ], "certificationBoundary", errors);
    if (value?.certificationBoundary?.handoffCertifiesRuntime !== false) {
      errors.push("handoffCertifiesRuntime must be false.");
    }
    if (value?.certificationBoundary?.handoffCertifiesDomain !== false) {
      errors.push("handoffCertifiesDomain must be false.");
    }

    requireExactKeys(value?.provenance, ["identity", "subject", "digest"], "provenance", errors);
    if (value?.provenance?.identity !== BLUEPRINT_SCHEMA_VERSION) errors.push("provenance identity is unsupported.");
    if (value?.provenance?.subject !== "blueprint") errors.push("provenance subject must be blueprint.");
    if (!SHA256_DIGEST_PATTERN.test(value?.provenance?.digest ?? "")) errors.push("provenance digest is invalid.");

    requireStringArray(value?.commands, "commands", errors, { nonEmpty: true });
    requireExactArray(value?.requiredInputs, STAGE3_REQUIRED_ARTIFACTS, "requiredInputs", errors);
    requireExactArray(value?.stage3RequiredArtifacts, STAGE3_REQUIRED_ARTIFACTS, "stage3RequiredArtifacts", errors);
    requireExactArray(value?.requiredOutputs, REQUIRED_OUTPUTS, "requiredOutputs", errors);
    requireStringArray(value?.risks, "risks", errors);

    requireExactKeys(value?.validation, ["ok", "warnings", "errors"], "validation", errors);
    if (value?.validation?.ok !== true) errors.push("validation.ok must be true.");
    requireStringArray(value?.validation?.warnings, "validation.warnings", errors);
    requireStringArray(value?.validation?.errors, "validation.errors", errors);
    if (Array.isArray(value?.validation?.errors) && value.validation.errors.length !== 0) {
      errors.push("validation.errors must be empty.");
    }
  } catch {
    errors.push("handoff contains an unsafe object shape.");
  }
  return { ok: errors.length === 0, errors };
}

export function formatHandoffPackage(result, paths = {}) {
  const lines = [
    `AgentMo handoff: ${result.handoff.agentId ?? "unknown"}`,
    `Status: ${result.ok ? "pass" : "fail"}`,
    `Target: ${result.handoff.target}`,
    `Output: ${paths.outDir ?? "not written"}`,
  ];
  for (const file of paths.files ?? []) lines.push(`- ${file}`);
  return `${lines.join("\n")}\n`;
}

function preflightHandoffPackage(candidate, options) {
  if (options.requireAuthentic && !AUTHENTIC_HANDOFF_PACKAGES.has(candidate)) {
    throw new HandoffPackageError("AGENTMO_HANDOFF_PACKAGE_UNTRUSTED");
  }
  assertPersistable(candidate, { subject: "handoff-package" });
  if (!hasExactKeys(candidate, ["ok", "handoff", "files"]) || candidate.ok !== true) {
    throw new HandoffPackageError("AGENTMO_HANDOFF_PACKAGE_INVALID");
  }
  if (!validateHandoffPackage(candidate.handoff).ok || !Array.isArray(candidate.files)) {
    throw new HandoffPackageError("AGENTMO_HANDOFF_PACKAGE_INVALID");
  }
  if (candidate.files.length !== HANDOFF_FILE_PATHS.length) {
    throw new HandoffPackageError("AGENTMO_HANDOFF_PACKAGE_INVALID");
  }

  const seen = new Set();
  for (const file of candidate.files) {
    if (!hasExactKeys(file, ["relativePath", "content"])
      || typeof file.relativePath !== "string"
      || typeof file.content !== "string"
      || path.isAbsolute(file.relativePath)
      || file.relativePath.split(/[\\/]/u).includes("..")
      || !HANDOFF_FILE_PATHS.includes(file.relativePath)
      || seen.has(file.relativePath)) {
      throw new HandoffPackageError("AGENTMO_HANDOFF_PACKAGE_INVALID");
    }
    seen.add(file.relativePath);
    assertPersistable(file, { subject: "handoff-operation" });
  }
  if (HANDOFF_FILE_PATHS.some((relativePath) => !seen.has(relativePath))) {
    throw new HandoffPackageError("AGENTMO_HANDOFF_PACKAGE_INVALID");
  }
  const manifest = candidate.files.find((file) => file.relativePath === "agentmo-handoff.json");
  if (manifest.content !== serializePersistableJson(candidate.handoff, { subject: "handoff" })) {
    throw new HandoffPackageError("AGENTMO_HANDOFF_PACKAGE_INVALID");
  }
  return candidate.files;
}

function buildCommands(blueprint, target) {
  const blueprintPath = `<path-to-${blueprint.agent_id}.agentmo.json>`;
  const runtimePlanPath = "<runtime-plan.json>";
  const buildStatePath = "<agentmo-build-state.json>";
  const runStatePath = "<run-state.json>";
  const runEvalPath = "<run-eval.json>";
  const birthReportPath = "<birth-report.json>";
  const domainCasesPath = "<domain-cases.json>";
  const domainEvalPath = "<domain-eval.json>";
  const deliveryReportPath = "<delivery-report.json>";
  const commands = [
    `agentmo validate "${blueprintPath}" ${renderDigestBindings("validate", { blueprint: blueprintPath })}`,
    `agentmo scaffold "${blueprintPath}" ${renderDigestBindings("scaffold", { blueprint: blueprintPath })} --target "${target}" --out "<runtime-output>"`,
  ];
  if (target === "openclaw") {
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
      `agentmo domain-eval "${blueprintPath}" ${renderDigestBindings("domain-eval", {
        blueprint: blueprintPath,
        "domain-cases": domainCasesPath,
      })} --cases "${domainCasesPath}" --target "openclaw" --json > "${domainEvalPath}"`,
      `agentmo delivery-report "${blueprintPath}" ${renderDigestBindings("delivery-report", {
        blueprint: blueprintPath,
        "build-state": buildStatePath,
        "run-state": runStatePath,
        "run-eval": runEvalPath,
        "birth-report": birthReportPath,
        "domain-eval": domainEvalPath,
      })} --build-state "${buildStatePath}" --run-state "${runStatePath}" --run-eval "${runEvalPath}" --birth-report "${birthReportPath}" --domain-eval "${domainEvalPath}" --json > "${deliveryReportPath}"`,
    );
  } else {
    commands.push(
      "Attach target-specific run-state and run-eval evidence before invoking birth-report.",
      `agentmo birth-report "${blueprintPath}" ${renderDigestBindings("birth-report", {
        blueprint: blueprintPath,
        "build-state": buildStatePath,
        "run-state": runStatePath,
        "run-eval": runEvalPath,
      })} --build-state "${buildStatePath}" --run-state "${runStatePath}" --run-eval "${runEvalPath}" --expect-status "declared" --json > "${birthReportPath}"`,
      `agentmo domain-eval "${blueprintPath}" ${renderDigestBindings("domain-eval", {
        blueprint: blueprintPath,
        "domain-cases": domainCasesPath,
      })} --cases "${domainCasesPath}" --target "${target}" --json > "${domainEvalPath}"`,
      `agentmo delivery-report "${blueprintPath}" ${renderDigestBindings("delivery-report", {
        blueprint: blueprintPath,
        "build-state": buildStatePath,
        "run-state": runStatePath,
        "run-eval": runEvalPath,
        "birth-report": birthReportPath,
        "domain-eval": domainEvalPath,
      })} --build-state "${buildStatePath}" --run-state "${runStatePath}" --run-eval "${runEvalPath}" --birth-report "${birthReportPath}" --domain-eval "${domainEvalPath}" --json > "${deliveryReportPath}"`,
    );
  }
  return commands;
}

function buildHandoffFiles(blueprint, handoff, manifest) {
  return [
    { relativePath: "README.md", content: renderReadme(blueprint, handoff) },
    { relativePath: "BUILD_TASKS.md", content: renderBuildTasks(blueprint, handoff) },
    { relativePath: "ACCEPTANCE_CRITERIA.md", content: renderAcceptanceCriteria(blueprint, handoff) },
    { relativePath: "TEST_PLAN.md", content: renderTestPlan(blueprint, handoff) },
    { relativePath: "ROLLBACK_PLAN.md", content: renderRollbackPlan(blueprint, handoff) },
    { relativePath: "RUNTIME_PLAN.md", content: renderRuntimePlan(blueprint, handoff) },
    { relativePath: "EVIDENCE_REQUIREMENTS.md", content: renderEvidenceRequirements(blueprint, handoff) },
    { relativePath: "VERIFY.md", content: renderVerify(blueprint, handoff) },
    { relativePath: "agentmo-handoff.json", content: manifest },
  ];
}

function renderReadme(blueprint, handoff) {
  return `# ${blueprint.agent_id} AgentMo handoff\n\nThis package hands a validated AgentMo blueprint/design contract to a coding/runtime implementation lane.\n\n- Top-level pipeline stage: Produce\n- Target: ${handoff.target}\n- Blueprint status: ${blueprint.status}\n- Blueprint provenance: ${handoff.provenance.identity}; ${handoff.provenance.subject}; ${handoff.provenance.digest}\n- Runtime certification: not claimed by this handoff\n- Domain certification: not claimed by this handoff\n\n## Produce-internal birth gate\n\nA runtime is not born until \`agentmo birth-report\` passes with the intended evidence level. Declared evidence can prove the mechanism path only; live-success evidence is required before runtime promotion.\n\n## Produce-internal delivery closure\n\n\`agentmo domain-eval\` records bounded case-suite domain-quality evidence from supplied fixtures or reviewed eval artifacts. \`agentmo delivery-report\` revalidates and aggregates blueprint, build, run, run-eval, birth-report, and optional domain-eval artifacts; it can carry bounded domain-eval status, but does not create runtime, domain-wide, or production approval by itself. Observe/evolve remains proposal-only inside Produce.\n`;
}

function renderBuildTasks(blueprint, handoff) {
  const tasks = Array.isArray(blueprint.pipeline?.produce?.generated_outputs) ? blueprint.pipeline.produce.generated_outputs : [];
  const lines = [`# Build tasks for ${blueprint.agent_id}`, "", "## Generated outputs"];
  for (const task of tasks) lines.push(`- ${task}`);
  lines.push("", "## Commands");
  for (const command of handoff.commands) lines.push(`- \`${command}\``);
  return `${lines.join("\n")}\n`;
}

function renderVerify(blueprint, handoff) {
  const steps = Array.isArray(blueprint.pipeline?.produce?.verification_steps) ? blueprint.pipeline.produce.verification_steps : [];
  const lines = [`# Verification for ${blueprint.agent_id}`, "", "## Required checks"];
  for (const step of steps) lines.push(`- ${step}`);
  lines.push("", "## Handoff boundary", "- Handoff does not certify runtime behavior.", "- Handoff does not certify domain-wide quality.", "- Birth-report must fail closed on missing build/run/eval evidence.", "- Domain-eval is bounded case-suite domain-quality evidence and does not certify runtime, production approval, or domain-wide quality.", "- Delivery-report aggregates and revalidates evidence; it can carry bounded domain-eval status but does not self-certify runtime, domain-wide quality, or production readiness.");
  if (handoff.risks.length > 0) {
    lines.push("", "## Known risks");
    for (const risk of handoff.risks) lines.push(`- ${risk}`);
  }
  return `${lines.join("\n")}\n`;
}

function renderAcceptanceCriteria(blueprint, handoff) {
  const lines = [
    `# Acceptance criteria for ${blueprint.agent_id}`,
    "",
    "- Blueprint/design contract validates before scaffold.",
    "- Blueprint authority is the admitted identity, subject, and digest; no host path or upstream success flag is authoritative.",
    "- Scaffold output writes managed build-state.",
    "- Run-state and run-eval evidence exist before birth-report.",
    "- Birth-report passes at the intended evidence level.",
    "- Domain-eval evidence exists before any bounded domain-quality claim.",
    "- Delivery-report revalidates the complete evidence set before handoff closure.",
    "- Runtime/domain-wide certification remains false unless separate reviewed eval evidence supports promotion.",
  ];
  if (handoff.target !== "openclaw") lines.push("- Target-specific run evidence is supplied before invoking birth-report.");
  return `${lines.join("\n")}\n`;
}

function renderTestPlan(blueprint, handoff) {
  const lines = [`# Test plan for ${blueprint.agent_id}`, "", "## Required"];
  for (const command of handoff.commands) {
    if (command.startsWith("agentmo ")) lines.push(`- \`${command}\``);
  }
  lines.push("- `npm run check`", "", "## Promotion only", "- Isolated live run.", "- `run-eval --expect-status success`.", "- `birth-report --expect-status success`.", "- Production/domain-wide approval requires evidence beyond deterministic fixtures.");
  return `${lines.join("\n")}\n`;
}

function renderRollbackPlan(blueprint, handoff) {
  return `# Rollback plan for ${blueprint.agent_id}\n\n- Do not promote runtime birth if birth-report fails.\n- Remove generated scaffold and handoff output directories; source blueprint and admitted provenance are unchanged.\n- Keep failed run-state/eval evidence only as bounded observe/evolve input.\n- Re-run handoff generation after fixing the blueprint/design contract or provenance review.\n- Target: ${handoff.target}\n`;
}

function renderRuntimePlan(blueprint, handoff) {
  const lines = [`# Runtime plan for ${blueprint.agent_id}`, "", `- Target: ${handoff.target}`, "- Provider/model/runtime/channel must stay separate.", "- Declared evidence is non-live and cannot promote runtime birth.", "- Live-success evidence must use isolated state and still does not certify domain-wide quality."];
  if (handoff.target === "openclaw") {
    lines.push("- OpenClaw run evidence follows the admitted run-plan -> runtime-plan -> run chain listed in BUILD_TASKS.md.");
  }
  else lines.push("- This target needs target-specific run-state evidence before birth-report.");
  return `${lines.join("\n")}\n`;
}

function renderEvidenceRequirements(blueprint, handoff) {
  const lines = [
    `# Evidence requirements for ${blueprint.agent_id}`,
    "",
    "- No credential values.",
    "- Conversation transcripts are excluded.",
    "- Tool request and response bodies are excluded.",
    "- No production OpenClaw state for declared/live-success MVP birth evidence.",
    "- Store bounded summaries, artifact references, hashes/statuses, and explicit missing-evidence notes.",
    "- Domain cases must be sanitized, bounded fixtures or reviewed eval artifacts.",
    "- Delivery reports must point to source artifacts and must not replace them.",
    "",
    "## Blueprint admission provenance",
    `- Identity: ${handoff.provenance.identity}`,
    `- Subject: ${handoff.provenance.subject}`,
    `- Digest: ${handoff.provenance.digest}`,
    "",
    "## Stage 3 required inputs",
  ];
  for (const artifact of handoff.requiredInputs) lines.push(`- ${artifact}`);
  lines.push("", "## Stage 3 required outputs");
  for (const artifact of handoff.requiredOutputs) lines.push(`- ${artifact}`);
  return `${lines.join("\n")}\n`;
}

function requireExactKeys(value, keys, label, errors) {
  if (!hasExactKeys(value, keys)) errors.push(`${label} fields are invalid.`);
}

function hasExactKeys(value, keys) {
  if (!isObject(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function requireStringArray(value, label, errors, options = {}) {
  if (!Array.isArray(value) || value.some((item) => !nonEmptyString(item))) {
    errors.push(`${label} must be a string array.`);
  } else if (options.nonEmpty && value.length === 0) {
    errors.push(`${label} must not be empty.`);
  }
}

function requireExactArray(value, expected, label, errors) {
  if (!Array.isArray(value)
    || value.length !== expected.length
    || value.some((item, index) => item !== expected[index])) {
    errors.push(`${label} is invalid.`);
  }
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isKebabId(value) {
  return typeof value === "string" && /^[a-z][a-z0-9-]*$/u.test(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
