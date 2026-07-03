import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { summarizeBlueprint, validateBlueprint } from "./blueprint.js";
import { summarizeDiscoveryManifest, validateDiscoveryManifest } from "./discovery.js";

export function buildMotherReport(blueprint, options = {}) {
  const validation = validateBlueprint(blueprint);
  const summary = summarizeBlueprint(blueprint);
  const discovery = buildDiscoverySection(blueprint, options);
  const passedGates = validation.gates.filter((gate) => gate.status === "pass").length;
  const failedGates = validation.gates.filter((gate) => gate.status === "fail");
  const warnings = [...validation.warnings, ...discovery.warnings, ...discovery.errors.map((error) => `discovery manifest: ${error}`)];
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
    runtime_certification: summary.runtime_certification,
    discovery,
    warnings,
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

  if ((report.runtime_certification ?? []).length > 0) {
    lines.push("", "Runtime certification:");
    for (const profile of report.runtime_certification) {
      lines.push(
        `- ${profile.id ?? "unknown"}: ${profile.certification_status}; verification commands ${profile.verification_commands.length}; unsupported surfaces ${profile.unsupported_surfaces.length}`,
      );
    }
  }

  if (report.discovery?.present) {
    lines.push("", "Discovery:");
    if (report.discovery.loaded && report.discovery.summary) {
      lines.push(
        `- ${report.discovery.path}: ${report.discovery.summary.source_count} sources; ${report.discovery.summary.source_types.join(", ") || "no source types"}`,
      );
    } else {
      lines.push(`- ${report.discovery.path ?? "unknown"}: not loaded`);
    }
  }

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

function buildDiscoverySection(blueprint, options) {
  const manifestPath = blueprint?.discovery_manifest_path;
  const section = {
    present: typeof manifestPath !== "undefined",
    path: typeof manifestPath === "string" ? manifestPath : null,
    resolved_path: null,
    loaded: false,
    ok: null,
    summary: null,
    warnings: [],
    errors: [],
  };

  if (typeof manifestPath === "undefined") return section;
  if (typeof manifestPath !== "string" || manifestPath.trim().length === 0) {
    section.warnings.push("discovery_manifest_path is present but is not a non-empty string.");
    return section;
  }

  const baseDir = options.baseDir ?? (options.blueprintPath ? dirname(options.blueprintPath) : null);
  if (!baseDir) {
    section.warnings.push("discovery manifest path was not loaded because report was built without blueprintPath/baseDir.");
    return section;
  }

  section.resolved_path = resolve(baseDir, manifestPath);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(section.resolved_path, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    section.warnings.push(`discovery manifest could not be loaded: ${message}`);
    return section;
  }

  const validation = validateDiscoveryManifest(manifest);
  section.loaded = true;
  section.ok = validation.ok;
  section.summary = summarizeDiscoveryManifest(manifest);
  section.warnings = validation.warnings;
  section.errors = validation.errors;
  return section;
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
