import { summarizeBlueprint, validateBlueprint } from "./blueprint.js";

export function buildMotherReport(blueprint) {
  const validation = validateBlueprint(blueprint);
  const summary = summarizeBlueprint(blueprint);
  const passedGates = validation.gates.filter((gate) => gate.status === "pass").length;
  const failedGates = validation.gates.filter((gate) => gate.status === "fail");
  return {
    kind: "agentmother_report",
    version: "0.1",
    ok: validation.ok,
    summary,
    lifecycle: inferLifecycle(blueprint, validation),
    gates: {
      passed: passedGates,
      failed: failedGates.length,
      items: validation.gates,
    },
    release_readiness: releaseReadiness(blueprint, validation),
    warnings: validation.warnings,
    errors: validation.errors,
  };
}

export function formatMotherReport(report) {
  const lines = [
    `AgentMother report: ${report.summary.agent_id ?? "unknown"}`,
    `Status: ${report.summary.status ?? "unknown"}`,
    `Runtime: ${report.summary.runtime ?? "unknown"}`,
    `Runtime profiles: ${(report.summary.runtime_profiles ?? []).join(", ") || "none"}`,
    `Domain: ${report.summary.domain ?? "unknown"}`,
    `Pipeline: ${(report.summary.pipeline_phases ?? []).join(" -> ") || "unknown"}`,
    `Lifecycle: ${report.lifecycle.stage} (${report.lifecycle.reason})`,
    `Quality gates: ${report.gates.passed} passed, ${report.gates.failed} failed`,
    `Release readiness: ${report.release_readiness.status}`,
  ];

  if (report.gates.items.length > 0) {
    lines.push("", "Gates:");
    for (const gate of report.gates.items) {
      lines.push(`- ${gate.status.toUpperCase()} ${gate.id}: ${gate.label}`);
    }
  }

  if (report.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const warning of report.warnings) lines.push(`- ${warning}`);
  }

  if (report.errors.length > 0) {
    lines.push("", "Errors:");
    for (const error of report.errors) lines.push(`- ${error}`);
  }

  return `${lines.join("\n")}\n`;
}

function inferLifecycle(blueprint, validation) {
  if (!validation.ok) return { stage: "blocked", reason: "blueprint validation failed" };
  if (blueprint.status === "draft") return { stage: "conceive", reason: "draft blueprint exists" };
  if (blueprint.status === "gestating") return { stage: "gestate", reason: "domain genome is being shaped" };
  if (blueprint.status === "born") return { stage: "birth", reason: "runtime scaffold exists or is expected" };
  if (blueprint.status === "training") return { stage: "train", reason: "eval suite is active" };
  if (blueprint.status === "certified") return { stage: "certify", reason: "quality gates are satisfied" };
  if (blueprint.status === "released") return { stage: "release", reason: "release evidence is recorded" };
  if (blueprint.status === "deprecated") return { stage: "retired", reason: "agent is no longer active" };
  return { stage: "unknown", reason: "unrecognized lifecycle status" };
}

function releaseReadiness(blueprint, validation) {
  if (!validation.ok) return { status: "not_ready", reason: "validation errors are present" };
  if (!["certified", "released"].includes(blueprint.status)) {
    return { status: "not_ready", reason: "agent is not certified or released" };
  }
  if (Array.isArray(blueprint.release?.known_risks) && blueprint.release.known_risks.length > 0) {
    return { status: "ready_with_risks", reason: "known risks must be disclosed" };
  }
  return { status: "ready", reason: "all required quality gates pass" };
}
