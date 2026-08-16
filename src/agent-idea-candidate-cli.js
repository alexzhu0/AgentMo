import { resolve } from "node:path";
import {
  admittedArtifactProvenance,
  ArtifactAdmissionError,
  loadAdmittedArtifact,
  parseDigestBindings,
} from "./artifact-admission.js";
import {
  buildAgentIdeaCandidateReport,
  formatAgentIdeaCandidateReport,
} from "./agent-idea-candidate.js";
import { subjectsForCommand } from "./artifact-subjects.js";

export const AGENT_IDEA_CANDIDATE_REPORT_HELP = `AgentMo agent-idea-candidate-report
Usage: agentmo agent-idea-candidate-report <candidate.json> --discovery-db <db.json> --digest agent-idea-candidate=sha256:<64hex> --digest discovery-db=sha256:<64hex> [--json]
Contract: agentmo artifact-contract agent-idea-candidate --json
Validates one proposal-only Candidate and exact Discovery DB fact references. It does not authorize Plan, build, runtime, or production use and does not record a human decision.
`;

export async function runAgentIdeaCandidateReportCommand(
  args,
  { emitArtifactOutput, cliError },
) {
  const options = parseAgentIdeaCandidateReportArgs(args, cliError);
  const discoveryDbAdmission = await loadAdmittedArtifact({
    filePath: options.discoveryDb,
    subject: "discovery-db",
    expectedDigest: options.digests["discovery-db"],
  });
  const candidateAdmission = await loadAdmittedArtifact({
    filePath: options.file,
    subject: "agent-idea-candidate",
    expectedDigest: options.digests["agent-idea-candidate"],
    companions: { "discovery-db": discoveryDbAdmission },
  });
  const report = buildAgentIdeaCandidateReport(candidateAdmission.value, {
    discoveryDb: discoveryDbAdmission.value,
    source: admittedArtifactProvenance(discoveryDbAdmission, {
      subject: "discovery-db",
      value: discoveryDbAdmission.value,
    }),
  });
  await emitArtifactOutput(report, {
    json: options.json,
    subject: "agent-idea-candidate-report",
    format: () => formatAgentIdeaCandidateReport(report),
  });
  if (!report.ok) process.exitCode = 1;
}

function parseAgentIdeaCandidateReportArgs(args, cliError) {
  const file = args[0];
  if (!file) throw new Error("Missing Agent Idea Candidate file path.");
  let discoveryDb = null;
  let json = false;
  const digestBindings = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--discovery-db") {
      if (discoveryDb !== null) throw cliError("AGENTMO_CLI_REQUEST_REJECTED");
      discoveryDb = args[index + 1];
      index += 1;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--digest") {
      digestBindings.push(requireDigestBinding(args[index + 1]));
      index += 1;
    } else {
      throw new Error(`Unknown agent-idea-candidate-report option: ${arg}`);
    }
  }
  requireOptionValue(discoveryDb, "--discovery-db");
  const digests = parseDigestBindings(
    digestBindings,
    subjectsForCommand("agent-idea-candidate-report"),
  );
  return {
    file: resolve(file),
    discoveryDb: resolve(discoveryDb),
    json,
    digests,
  };
}

function requireDigestBinding(value) {
  if (typeof value !== "string" || value.startsWith("--")) {
    throw new ArtifactAdmissionError("AGENTMO_ARTIFACT_DIGEST_INVALID");
  }
  return value;
}

function requireOptionValue(value, optionName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing ${optionName} <value>.`);
  }
}
