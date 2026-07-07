import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateBlueprint } from "./blueprint.js";
import { listTargetIds } from "./targets/registry.js";

export const HANDOFF_SCHEMA_VERSION = "agentmo.handoff.v1";

export function buildHandoffPackage(blueprint, options = {}) {
  const target = options.target ?? "openclaw";
  if (!listTargetIds().includes(target)) throw new Error(`Unknown handoff target: ${target}. Expected one of: ${listTargetIds().join(", ")}`);
  const validation = validateBlueprint(blueprint);
  const handoff = {
    schemaVersion: HANDOFF_SCHEMA_VERSION,
    ok: validation.ok,
    agentId: blueprint.agent_id ?? null,
    target,
    status: blueprint.status ?? null,
    certificationBoundary: {
      handoffCertifiesRuntime: false,
      handoffCertifiesDomain: false,
    },
    commands: buildCommands(blueprint, target),
    requiredInputs: ["validated blueprint", "discovery pack", "user-need report", "build-state", "run-state", "run-eval", "birth-report", "domain-cases", "domain-eval"],
    requiredOutputs: ["runtime scaffold", "bounded evidence", "birth report", "domain eval", "delivery report", "verification log"],
    risks: Array.isArray(blueprint.release?.known_risks) ? blueprint.release.known_risks : [],
    validation: {
      ok: validation.ok,
      warnings: validation.warnings,
      errors: validation.errors,
    },
  };
  return {
    ok: validation.ok,
    handoff,
    files: [
      { relativePath: "README.md", content: renderReadme(blueprint, handoff) },
      { relativePath: "BUILD_TASKS.md", content: renderBuildTasks(blueprint, handoff) },
      { relativePath: "ACCEPTANCE_CRITERIA.md", content: renderAcceptanceCriteria(blueprint, handoff) },
      { relativePath: "TEST_PLAN.md", content: renderTestPlan(blueprint, handoff) },
      { relativePath: "ROLLBACK_PLAN.md", content: renderRollbackPlan(blueprint, handoff) },
      { relativePath: "RUNTIME_PLAN.md", content: renderRuntimePlan(blueprint, handoff) },
      { relativePath: "EVIDENCE_REQUIREMENTS.md", content: renderEvidenceRequirements(blueprint, handoff) },
      { relativePath: "VERIFY.md", content: renderVerify(blueprint, handoff) },
      { relativePath: "agentmo-handoff.json", content: `${JSON.stringify(handoff, null, 2)}\n` },
    ],
  };
}

export async function writeHandoffPackage(outDir, handoffPackage) {
  const root = path.resolve(outDir);
  await mkdir(root, { recursive: true });
  const written = [];
  for (const file of handoffPackage.files) {
    const filePath = path.join(root, file.relativePath);
    await writeTextAtomic(filePath, file.content);
    written.push(filePath);
  }
  return { outDir: root, files: written.sort() };
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

function buildCommands(blueprint, target) {
  const blueprintPath = `<path-to-${blueprint.agent_id ?? "agent"}.agentmo.json>`;
  const commands = [
    `agentmo validate ${blueprintPath}`,
    `agentmo scaffold ${blueprintPath} --target ${target} --out <runtime-output>` ,
  ];
  if (target === "openclaw") {
    commands.push(
      `agentmo run ${blueprintPath} --target openclaw --workspace <runtime-workspace> --message <smoke-message> --out <run-output> --json`,
      `agentmo run-eval <run-state.json> --expect-status declared --json`,
      `agentmo birth-report ${blueprintPath} --build-state <agentmo-build-state.json> --run-state <run-state.json> --run-eval <run-eval.json> --expect-status declared --json`,
      `agentmo domain-eval ${blueprintPath} --cases <domain-cases.json> --target openclaw --json`,
      `agentmo delivery-report ${blueprintPath} --build-state <agentmo-build-state.json> --run-state <run-state.json> --run-eval <run-eval.json> --birth-report <birth-report.json> --domain-eval <domain-eval.json> --json`,
    );
  } else {
    commands.push(
      "Attach target-specific run-state and run-eval evidence before invoking birth-report.",
      `agentmo birth-report ${blueprintPath} --build-state <agentmo-build-state.json> --run-state <run-state.json> --run-eval <run-eval.json> --expect-status declared --json`,
      `agentmo domain-eval ${blueprintPath} --cases <domain-cases.json> --target ${target} --json`,
      `agentmo delivery-report ${blueprintPath} --build-state <agentmo-build-state.json> --run-state <run-state.json> --run-eval <run-eval.json> --birth-report <birth-report.json> --domain-eval <domain-eval.json> --json`,
    );
  }
  return commands;
}

function renderReadme(blueprint, handoff) {
  return `# ${blueprint.agent_id} AgentMo handoff\n\nThis package hands a validated AgentMo blueprint to a coding/runtime implementation lane.\n\n- Target: ${handoff.target}\n- Blueprint status: ${blueprint.status}\n- Runtime certification: not claimed by this handoff\n- Domain certification: not claimed by this handoff\n\n## Birth rule\n\nA runtime is not born until \`agentmo birth-report\` passes with the intended evidence level. Declared evidence can prove the mechanism path only; live-success evidence is required before runtime promotion.\n\n## Delivery closure\n\n\`agentmo domain-eval\` records independent domain-quality evidence from bounded case fixtures or reviewed eval artifacts. \`agentmo delivery-report\` revalidates and aggregates blueprint, build, run, run-eval, birth-report, and optional domain-eval artifacts; it does not certify runtime behavior, domain quality, or production approval by itself.\n`;
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
  lines.push("", "## Handoff boundary", "- Handoff does not certify runtime behavior.", "- Handoff does not certify domain quality.", "- Birth-report must fail closed on missing build/run/eval evidence.", "- Domain-eval is independent domain-quality evidence and does not certify runtime or production approval.", "- Delivery-report aggregates and revalidates evidence; it does not self-certify runtime, domain, or production readiness.");
  if (handoff.risks.length > 0) {
    lines.push("", "## Known risks");
    for (const risk of handoff.risks) lines.push(`- ${risk}`);
  }
  return `${lines.join("\n")}\n`;
}

function renderAcceptanceCriteria(blueprint, handoff) {
  const lines = [`# Acceptance criteria for ${blueprint.agent_id}`, "", "- Blueprint validates before scaffold.", "- Discovery and user-need inputs are bounded and reviewed.", "- Scaffold output writes managed build-state.", "- Run-state and run-eval evidence exist before birth-report.", "- Birth-report passes at the intended evidence level.", "- Domain-eval evidence exists before any domain-quality claim.", "- Delivery-report revalidates the complete evidence set before handoff closure.", "- Runtime/domain certification remains false unless separate eval evidence supports promotion."];
  if (handoff.target !== "openclaw") lines.push("- Target-specific run evidence is supplied before invoking birth-report.");
  return `${lines.join("\n")}\n`;
}

function renderTestPlan(blueprint, handoff) {
  const lines = [`# Test plan for ${blueprint.agent_id}`, "", "## Required", "- `agentmo validate <blueprint>`", `- \`agentmo scaffold <blueprint> --target ${handoff.target} --out <runtime-output>\``, "- `agentmo run-eval <run-state.json> --expect-status declared`", "- `agentmo birth-report <blueprint> --build-state <state> --run-state <state> --run-eval <eval> --expect-status declared`", "- `agentmo domain-eval <blueprint> --cases <domain-cases.json> --target <target>`", "- `agentmo delivery-report <blueprint> --build-state <state> --run-state <state> --run-eval <eval> --birth-report <birth-report.json> --domain-eval <domain-eval.json>`", "- `npm run check`", "", "## Promotion only", "- Isolated live run.", "- `run-eval --expect-status success`.", "- `birth-report --expect-status success`.", "- Production/domain approval requires evidence beyond deterministic fixtures."];
  return `${lines.join("\n")}\n`;
}

function renderRollbackPlan(blueprint, handoff) {
  return `# Rollback plan for ${blueprint.agent_id}\n\n- Do not promote runtime birth if birth-report fails.\n- Remove generated scaffold and handoff output directories; source blueprint/discovery/need inputs are unchanged.\n- Keep failed run-state/eval evidence only as bounded observe/evolve input.\n- Re-run handoff generation after fixing the blueprint or source inputs.\n- Target: ${handoff.target}\n`;
}

function renderRuntimePlan(blueprint, handoff) {
  const lines = [`# Runtime plan for ${blueprint.agent_id}`, "", `- Target: ${handoff.target}`, "- Provider/model/runtime/channel must stay separate.", "- Declared evidence is non-live and cannot promote runtime birth.", "- Live-success evidence must use isolated state and still does not certify domain quality."];
  if (handoff.target === "openclaw") lines.push("- OpenClaw run evidence is produced with `agentmo run --target openclaw`.");
  else lines.push("- This target needs target-specific run-state evidence before birth-report.");
  return `${lines.join("\n")}\n`;
}

function renderEvidenceRequirements(blueprint, handoff) {
  const lines = [`# Evidence requirements for ${blueprint.agent_id}`, "", "- No credential values.", "- No raw transcripts.", "- No raw tool bodies.", "- No production OpenClaw state for declared/live-success MVP birth evidence.", "- Store bounded summaries, artifact paths, hashes/statuses, and explicit missing-evidence notes.", "- Domain cases must be sanitized, bounded fixtures or reviewed eval artifacts.", "- Delivery reports must point to source artifacts and must not replace them.", "", "## Required artifacts"];
  for (const artifact of handoff.requiredInputs) lines.push(`- ${artifact}`);
  for (const artifact of handoff.requiredOutputs) lines.push(`- ${artifact}`);
  return `${lines.join("\n")}\n`;
}

async function writeTextAtomic(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryFile = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryFile, content, "utf8");
  await rename(temporaryFile, filePath);
}
