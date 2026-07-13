import {
  AgentMoUnsupportedArtifactError,
} from "./artifact-registry.js";
import {
  ArtifactAdmissionError,
  admittedArtifactProvenance,
  loadAdmittedArtifact,
} from "./artifact-admission.js";
import { buildBlueprintAssessment } from "./report.js";

export const CONTROL_SNAPSHOT_SCHEMA_VERSION = "agentmo.control.v1";

const PIPELINE_PHASES = ["discover", "plan", "produce"];

export async function loadBuildState(path, options = {}) {
  if (options.subject !== "build-state") {
    throw new AgentMoUnsupportedArtifactError("subject_identity_mismatch");
  }
  const admission = await loadAdmittedArtifact({
    filePath: path,
    subject: "build-state",
    expectedDigest: options.expectedDigest,
    maxBytes: options.maxBytes,
    openInput: options.openInput,
  });
  const blueprintSource = admittedArtifactProvenance(options.blueprintAdmission, {
    subject: "blueprint",
    value: options.blueprintAdmission?.value,
  });
  if (admission.value.agentId !== options.blueprintAdmission.value.agent_id
    || admission.value.source.identity !== blueprintSource.identity
    || admission.value.source.subject !== blueprintSource.subject
    || admission.value.source.digest !== blueprintSource.digest) {
    throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_ADMISSION_RESULT_INVALID");
  }
  return admission.value;
}

export function buildControlSnapshot(blueprint, options = {}) {
  const assessment = buildBlueprintAssessment(blueprint);
  const report = {
    ok: assessment.validation.ok,
    warnings: assessment.validation.warnings,
    errors: assessment.validation.errors,
    produce_maturity: assessment.produceMaturity,
    gates: assessment.gates,
    release_readiness: {
      status: "not_evaluated",
      reason: "Control status does not establish delivery or production approval.",
      productionApproved: false,
    },
  };
  const validation = {
    ok: report.ok,
    warnings: [...report.warnings],
    errors: [...report.errors],
  };

  const latestBuildState = summarizeBuildState(options.buildState, options.buildStatePath, options.buildStateError);
  const blueprintProvenance = resolveBlueprintProvenance(blueprint, options.blueprintAdmission);
  const latestRunState = summarizeRunState(
    blueprintProvenance,
    options.runState,
    options.runStatePath,
    options.runStateError,
  );
  const risks = summarizeRisks(blueprint, validation, latestRunState);

  return {
    schemaVersion: CONTROL_SNAPSHOT_SCHEMA_VERSION,
    agentId: blueprint?.agent_id ?? null,
    status: blueprint?.status ?? "unknown",
    produce_maturity: report.produce_maturity,
    runtime: summarizeRuntime(blueprint),
    runtimeCertification: summarizeRuntimeCertification(blueprint),
    pipeline: summarizePipeline(blueprint),
    qualityGates: report.gates,
    latestBuildState,
    eval: summarizeEval(blueprint),
    evidence: summarizeEvidence(blueprint),
    release: summarizeRelease(blueprint, report),
    latestRunState,
    risks,
    nextActions: summarizeNextActions(report, latestBuildState, latestRunState, risks),
    validation,
  };
}

export function formatControlSnapshot(snapshot) {
  const buildState = snapshot.latestBuildState.available
    ? `${snapshot.latestBuildState.target.id} (${snapshot.latestBuildState.operations.domainOperationCount} domain operations)`
    : `unavailable: ${snapshot.latestBuildState.reason}`;
  const runState = snapshot.latestRunState.available
    ? `${snapshot.latestRunState.target.id} ${snapshot.latestRunState.execution.status} (${snapshot.latestRunState.freshness})`
    : `unavailable: ${snapshot.latestRunState.reason}`;
  const lines = [
    `AgentMo status: ${snapshot.agentId ?? "unknown"}`,
    `Status: ${snapshot.status}`,
    `Produce maturity: ${snapshot.produce_maturity.stage} (${snapshot.produce_maturity.reason})`,
    `Runtime: ${snapshot.runtime.primary ?? "unknown"}`,
    `Runtime profiles: ${snapshot.runtime.profiles.map((profile) => profile.id).join(", ") || "none"}`,
    `Pipeline complete: ${snapshot.pipeline.completed}/${snapshot.pipeline.total}`,
    `Quality gates: ${snapshot.qualityGates.passed} passed, ${snapshot.qualityGates.failed} failed`,
    `Build state: ${buildState}`,
    `Run state: ${runState}`,
    `Release readiness: ${snapshot.release.readiness.status}`,
  ];

  if (snapshot.risks.length > 0) {
    lines.push("", "Risks:");
    for (const risk of snapshot.risks) lines.push(`- ${risk}`);
  }

  if (snapshot.nextActions.length > 0) {
    lines.push("", "Next actions:");
    for (const action of snapshot.nextActions) lines.push(`- ${action}`);
  }

  return `${lines.join("\n")}\n`;
}

function summarizeRuntime(blueprint) {
  const profiles = Array.isArray(blueprint?.runtime_profiles)
    ? blueprint.runtime_profiles.map((profile) => ({
        id: profile.id ?? null,
        role: profile.role ?? null,
        status: profile.status ?? null,
        purpose: profile.purpose ?? null,
      }))
    : [];
  return {
    primary: blueprint?.runtime ?? null,
    profiles,
  };
}

function summarizeRuntimeCertification(blueprint) {
  const profiles = Array.isArray(blueprint?.runtime_profiles) ? blueprint.runtime_profiles : [];
  return {
    profiles: profiles.map((profile) => {
      const verificationCommands = asStringArray(profile.verification_commands);
      const unsupportedSurfaces = asStringArray(profile.unsupported_surfaces);
      const riskNotes = asStringArray(profile.risk_notes);
      return {
        id: profile.id ?? null,
        role: profile.role ?? null,
        status: profile.status ?? null,
        owner: profile.owner ?? null,
        lastVerifiedAt: profile.last_verified_at ?? null,
        supportedAssets: asStringArray(profile.supported_assets),
        unsupportedSurfaces,
        installOrOnramp: profile.install_or_onramp ?? null,
        verificationCommands,
        riskNotes,
        certificationStatus: certificationStatusFor(profile, verificationCommands, unsupportedSurfaces),
      };
    }),
  };
}

function certificationStatusFor(profile, verificationCommands, unsupportedSurfaces) {
  if (profile.status === "deprecated") return "deprecated";
  if (verificationCommands.length > 0 && unsupportedSurfaces.length > 0 && typeof profile.last_verified_at === "string") {
    return "verification_declared";
  }
  if (profile.status === "active" || profile.status === "experimental") return "needs_verification_metadata";
  return "not_certified";
}

function summarizePipeline(blueprint) {
  const phases = PIPELINE_PHASES.map((id) => {
    const phase = blueprint?.pipeline?.[id];
    const present = phase !== null && typeof phase === "object" && !Array.isArray(phase);
    return {
      id,
      complete: present,
      status: present ? "present" : "missing",
      doneWhenCount: Array.isArray(phase?.done_when) ? phase.done_when.length : 0,
    };
  });
  return {
    completed: phases.filter((phase) => phase.complete).length,
    total: phases.length,
    phases,
  };
}

function summarizeBuildState(buildState, buildStatePath, buildStateError) {
  if (buildStateError) {
    return {
      available: false,
      path: buildStatePath ?? null,
      reason: `unreadable: ${buildStateError}`,
    };
  }
  if (!buildState) {
    return {
      available: false,
      path: buildStatePath ?? null,
      reason: buildStatePath ? "not_loaded" : "not_supplied",
    };
  }
  return {
    available: true,
    path: buildStatePath ?? buildState.request?.outputDir ?? null,
    schemaVersion: buildState.schemaVersion ?? null,
    generatedAt: buildState.generatedAt ?? null,
    agentId: buildState.agentId ?? null,
    target: {
      id: buildState.target?.id ?? buildState.resolution?.selectedTargetId ?? null,
      label: buildState.target?.label ?? null,
    },
    operations: {
      domainOperationCount: buildState.resolution?.domainOperationCount ?? buildState.operations?.length ?? 0,
      recordedOperationCount: Array.isArray(buildState.operations) ? buildState.operations.length : 0,
    },
    resolution: {
      selectedTargetId: buildState.resolution?.selectedTargetId ?? null,
      selectedProfileId: buildState.resolution?.selectedProfileId ?? null,
      selectedModuleIds: Array.isArray(buildState.resolution?.selectedModuleIds) ? buildState.resolution.selectedModuleIds : [],
      warnings: Array.isArray(buildState.resolution?.warnings) ? buildState.resolution.warnings : [],
    },
  };
}

function summarizeRunState(blueprintProvenance, runState, runStatePath, runStateError) {
  if (runStateError) {
    return {
      available: false,
      path: runStatePath ?? null,
      reason: `unreadable: ${runStateError}`,
    };
  }
  if (!runState) {
    return {
      available: false,
      path: runStatePath ?? null,
      reason: runStatePath ? "not_loaded" : "not_supplied",
    };
  }
  const storedBlueprintProvenance = runState.source?.blueprint ?? null;
  const storedProvenancePresent = validBlueprintProvenance(storedBlueprintProvenance);
  const admittedProvenancePresent = validBlueprintProvenance(blueprintProvenance);
  const provenanceMatches = storedProvenancePresent
    && admittedProvenancePresent
    && sameProvenance(storedBlueprintProvenance, blueprintProvenance);
  const stale = storedProvenancePresent && admittedProvenancePresent && !provenanceMatches;
  const freshness = provenanceMatches ? "current" : stale ? "stale" : "unverifiable";
  const missingSandbox = !runState.runtimeIdentity?.sandboxScope;
  const productionState = runState.runtimeIdentity?.sandboxScope?.usesProductionState === true;
  const runEvidenceCertifiesRuntime = runState.certificationBoundary?.runEvidenceCertifiesRuntime === true;
  const usable = provenanceMatches && !missingSandbox && !productionState && !runEvidenceCertifiesRuntime;
  return {
    available: true,
    usable,
    path: runStatePath ?? null,
    schemaVersion: runState.schemaVersion ?? null,
    runId: runState.runId ?? null,
    parentRunId: runState.parentRunId ?? null,
    agentId: runState.agentId ?? null,
    target: {
      id: runState.target?.id ?? null,
      label: runState.target?.label ?? null,
    },
    execution: {
      status: runState.execution?.status ?? null,
      executed: Boolean(runState.execution?.executed),
      exitCode: runState.execution?.exitCode ?? null,
      live: Boolean(runState.execution?.live),
    },
    runtimeIdentity: {
      runtime: runState.runtimeIdentity?.runtime ?? null,
      backend: runState.runtimeIdentity?.backend ?? null,
      transport: runState.runtimeIdentity?.transport ?? null,
      fallbackFrom: runState.runtimeIdentity?.fallbackFrom ?? null,
      selector: runState.runtimeIdentity?.selector ?? null,
      sandboxScope: runState.runtimeIdentity?.sandboxScope ?? null,
    },
    message: {
      sourceDigest: runState.message?.sourceDigest ?? null,
      byteLength: runState.message?.byteLength ?? null,
      summary: runState.message?.summary ?? null,
    },
    replay: {
      eligible: Boolean(runState.replay?.eligible),
      policy: runState.replay?.policy ?? null,
      replayFidelity: runState.replay?.replayFidelity ?? runState.message?.replayFidelityIfMaterialAvailable ?? null,
    },
    freshness,
    stale,
    evidenceQualification: {
      usable,
      admittedBlueprintProvenancePresent: admittedProvenancePresent,
      storedBlueprintProvenancePresent: storedProvenancePresent,
      blueprintProvenanceMatches: provenanceMatches,
      missingSandbox,
      productionState,
      runEvidenceCertifiesRuntime,
    },
  };
}

function summarizeEval(blueprint) {
  return {
    casesPath: blueprint?.eval?.cases_path ?? null,
    rubricPath: blueprint?.eval?.rubric_path ?? null,
    requiredCaseClasses: asStringArray(blueprint?.eval?.required_case_classes),
    hardFailures: asStringArray(blueprint?.eval?.hard_failures),
  };
}

function summarizeEvidence(blueprint) {
  return {
    stores: asStringArray(blueprint?.evidence?.stores),
    requiredArtifacts: asStringArray(blueprint?.evidence?.required_artifacts),
    auditRules: asStringArray(blueprint?.evidence?.audit_rules),
  };
}

function summarizeRelease(blueprint, report) {
  return {
    readiness: report.release_readiness,
    latestCommit: blueprint?.release?.latest_commit ?? null,
    latestTag: blueprint?.release?.latest_tag ?? null,
    releaseLedgerPath: blueprint?.release?.release_ledger_path ?? null,
    knownRisks: asStringArray(blueprint?.release?.known_risks),
  };
}

function summarizeRisks(blueprint, validation, latestRunState) {
  const risks = new Set();
  for (const warning of validation.warnings) risks.add(warning);
  for (const risk of asStringArray(blueprint?.release?.known_risks)) risks.add(risk);
  for (const profile of Array.isArray(blueprint?.runtime_profiles) ? blueprint.runtime_profiles : []) {
    for (const risk of asStringArray(profile.risk_notes)) risks.add(`${profile.id ?? "runtime"}: ${risk}`);
    const activeRuntime = profile.status === "active" || profile.status === "experimental";
    if (activeRuntime && asStringArray(profile.verification_commands).length === 0) {
      risks.add(`Runtime profile ${profile.id ?? "unknown"} lacks verification_commands metadata.`);
    }
    if (activeRuntime && asStringArray(profile.unsupported_surfaces).length === 0) {
      risks.add(`Runtime profile ${profile.id ?? "unknown"} lacks unsupported_surfaces disclosure.`);
    }
  }
  if (latestRunState?.reason?.startsWith("unreadable:")) {
    risks.add(`Latest run-state is unavailable: ${latestRunState.reason}`);
  }
  if (latestRunState?.stale) {
    risks.add("Latest run-state blueprint provenance is stale.");
  }
  if (latestRunState?.available && !latestRunState?.evidenceQualification?.blueprintProvenanceMatches && !latestRunState?.stale) {
    risks.add("Latest run-state blueprint provenance cannot be verified.");
  }
  if (latestRunState?.execution?.status === "failure") {
    risks.add(`Latest run-state ${latestRunState.runId ?? "unknown"} recorded execution failure.`);
  }
  if (latestRunState?.evidenceQualification?.missingSandbox) {
    risks.add("Latest run-state is missing sandbox scope evidence.");
  }
  if (latestRunState?.evidenceQualification?.productionState) {
    risks.add("Latest run-state used production OpenClaw state.");
  }
  if (latestRunState?.evidenceQualification?.runEvidenceCertifiesRuntime) {
    risks.add("Latest run-state incorrectly claims runtime certification.");
  }
  return Array.from(risks).sort();
}

function summarizeNextActions(report, latestBuildState, latestRunState, risks) {
  const actions = [];
  if (!report.ok) actions.push("Fix blueprint validation errors before scaffold or release claims.");
  if (report.gates.failed > 0) actions.push("Repair failed quality gates and rerun validation.");
  if (!latestBuildState.available) actions.push("Run agentmo scaffold and pass --build-state to connect status to generated output.");
  if (!latestRunState.available) actions.push("Run agentmo run or pass --run-state/--run-dir to connect status to runtime evidence.");
  if (latestRunState.stale) actions.push("Refresh runtime evidence because the run-state blueprint provenance is stale.");
  if (latestRunState.available && !latestRunState.evidenceQualification?.blueprintProvenanceMatches && !latestRunState.stale) {
    actions.push("Supply exact admitted blueprint provenance before relying on runtime evidence.");
  }
  if (latestRunState.execution?.status === "failure") actions.push("Inspect failed runtime evidence and create an observe proposal if it indicates a blueprint/scaffold change.");
  if (latestRunState.evidenceQualification?.missingSandbox) actions.push("Refresh runtime evidence with sandbox scope metadata before relying on it.");
  if (latestRunState.evidenceQualification?.productionState) actions.push("Review production OpenClaw state usage before treating run evidence as safe.");
  if (latestRunState.evidenceQualification?.runEvidenceCertifiesRuntime) actions.push("Reject run evidence that claims runtime certification; certification must come from blueprint/profile eval evidence.");
  if (report.release_readiness.status !== "ready") actions.push("Record eval and release evidence before claiming release readiness.");
  if (risks.length > 0) actions.push("Review risks and either mitigate them or keep them disclosed in release evidence.");
  return actions;
}

function asStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function resolveBlueprintProvenance(blueprint, admission) {
  try {
    return admittedArtifactProvenance(admission, { subject: "blueprint", value: blueprint });
  } catch {
    return null;
  }
}

function validBlueprintProvenance(value) {
  return value?.identity === "0.1"
    && value?.subject === "blueprint"
    && /^sha256:[a-f0-9]{64}$/u.test(value?.digest ?? "");
}

function sameProvenance(left, right) {
  return left.identity === right.identity && left.subject === right.subject && left.digest === right.digest;
}
