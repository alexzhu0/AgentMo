import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  getArtifactContract,
  listArtifactContractSubjects,
} from "../src/artifact-contract.js";
import { validateAgentIdeaCandidate } from "../src/agent-idea-candidate.js";
import { validateDecisionEntry } from "../src/decision-ledger.js";
import { validateDiscoveryManifest } from "../src/discovery.js";
import { validateUserNeed } from "../src/user-need.js";
import { validateOpenClawTargetCarrierAdmission } from "../src/openclaw-target-admission.js";
import { validateOpenClawTargetDescriptor } from "../src/openclaw-target-descriptor.js";
import { validateAgentPackageManifest } from "../src/package-contract.js";
import { validateOpenClawProbe } from "../src/openclaw-probe.js";
import {
  validateOpenClawInstallJournal,
  validateOpenClawInstallReceipt,
} from "../src/openclaw-install-receipt.js";
import {
  validateOpenClawInstallFinalizationEvidence,
  validateOpenClawInstallPostStateEvidence,
  validateOpenClawOfficialActionResultEvidence,
} from "../src/openclaw-install-evidence.js";

const CLI = fileURLToPath(new URL("../bin/agentmo.js", import.meta.url));

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("operator-authored artifact contracts", () => {
  it("exports closed subjects whose minimal templates pass production validators", () => {
    assert.deepEqual(listArtifactContractSubjects(), [
      "agent-idea-candidate",
      "decision-entry",
      "discovery-manifest",
      "openclaw-probe",
      "openclaw-target-carrier-admission",
      "openclaw-target-descriptor",
      "package-manifest",
      "user-need",
    ]);

    const decision = getArtifactContract("decision-entry");
    const ideaCandidate = getArtifactContract("agent-idea-candidate");
    const discovery = getArtifactContract("discovery-manifest");
    const need = getArtifactContract("user-need");
    const targetAdmission = getArtifactContract("openclaw-target-carrier-admission");
    const targetDescriptor = getArtifactContract("openclaw-target-descriptor");
    const packageManifest = getArtifactContract("package-manifest");
    const openClawProbe = getArtifactContract("openclaw-probe");
    const installJournal = getArtifactContract(
      "openclaw-install-private-journal",
    );
    const installReceipt = getArtifactContract("openclaw-install-receipt");
    const installPostState = getArtifactContract(
      "openclaw-install-post-state",
    );
    const officialActionResult = getArtifactContract(
      "openclaw-official-action-result",
    );
    const installFinalization = getArtifactContract(
      "openclaw-install-finalization",
    );
    assert.equal(decision.schemaVersion, "agentmo.artifact-contract.v1");
    assert.equal(ideaCandidate.schemaVersion, "agentmo.artifact-contract.v1");
    assert.equal(discovery.schemaVersion, "agentmo.artifact-contract.v1");
    assert.equal(need.schemaVersion, "agentmo.artifact-contract.v1");
    assert.equal(validateDecisionEntry(decision.minimalTemplate).ok, true);
    assert.equal(validateAgentIdeaCandidate(ideaCandidate.minimalTemplate).ok, true);
    assert.equal(validateDiscoveryManifest(discovery.minimalTemplate).ok, true);
    assert.equal(validateUserNeed(need.minimalTemplate).ok, true);
    assert.equal(
      validateOpenClawTargetCarrierAdmission(targetAdmission.minimalTemplate).ok,
      true,
    );
    assert.equal(validateOpenClawTargetDescriptor(targetDescriptor.minimalTemplate).ok, true);
    assert.equal(validateAgentPackageManifest(packageManifest.minimalTemplate).ok, true);
    assert.equal(
      validateOpenClawProbe(openClawProbe.minimalTemplate, {
        sources: openClawProbe.minimalTemplate.sourceBindings,
      }).ok,
      true,
    );
    assert.equal(
      validateOpenClawInstallJournal(installJournal.minimalTemplate).ok,
      true,
    );
    assert.equal(
      validateOpenClawInstallReceipt(installReceipt.minimalTemplate).ok,
      true,
    );
    assert.equal(
      validateOpenClawInstallPostStateEvidence(
        installPostState.minimalTemplate,
      ).ok,
      true,
    );
    assert.equal(
      validateOpenClawOfficialActionResultEvidence(
        officialActionResult.minimalTemplate,
      ).ok,
      true,
    );
    assert.equal(
      validateOpenClawInstallFinalizationEvidence(
        installFinalization.minimalTemplate,
      ).ok,
      true,
    );
    assert.equal(
      installReceipt.jsonSchema.required.includes("postEffectEvidence"),
      true,
    );
    assert.deepEqual(packageManifest.jsonSchema.properties.sourceBindings.required, [
      "blueprintDigest",
      "buildContractDigest",
      "designPlanDigest",
      "discoveryApprovalDigest",
      "decisionLedgerDigest",
      "planApprovalDigest",
    ]);
    assert.deepEqual(packageManifest.jsonSchema.properties.targetCompatibility.items.required, [
      "target",
      "version",
      "sourceRevision",
      "exactRevisionRequired",
    ]);
    assert.deepEqual(packageManifest.jsonSchema.properties.capabilityLedger.items.required, [
      "capabilityId",
      "resourceId",
      "carrier",
      "owner",
      "necessity",
      "trust",
      "memberPaths",
      "recipeDigest",
      "targetMapping",
      "permission",
      "approvalRequirement",
      "timeoutMs",
      "failureSemantics",
      "unsupportedBehavior",
    ]);
    assert.deepEqual(packageManifest.jsonSchema.properties.ownership.required, [
      "packageOwner",
      "managedMemberPaths",
      "externalStateIncluded",
    ]);
    assert.deepEqual(packageManifest.jsonSchema.properties.certificationBoundary.required, [
      "deterministicPackageMechanism",
      "installed",
      "runtime",
      "domain",
      "production",
    ]);
    const packageWithUnknownField = structuredClone(packageManifest.minimalTemplate);
    packageWithUnknownField.unknown = true;
    assert.equal(validateAgentPackageManifest(packageWithUnknownField).ok, false);
    assert.deepEqual(decision.jsonSchema.properties.entryKind.enum, [
      "fact",
      "inference",
      "unknown",
      "rejected-option",
      "human-decision",
    ]);
    assert.deepEqual(discovery.jsonSchema.required, [
      "schemaVersion",
      "agent_id",
      "source_inventory",
      "database_outputs",
      "retrieval_outputs",
      "user_need_inputs",
      "refresh_policy",
      "forbidden_data_handling",
    ]);
    assert.deepEqual(discovery.jsonSchema.properties.collector.properties.adapter.enum, ["web", "github", "arxiv"]);
    assert.equal(discovery.jsonSchema.properties.collector.properties.allowlist.items.pattern, "^https://");
    assert.equal(getArtifactContract("unknown"), null);
  });

  it("exposes contracts and bounded per-command help through the public CLI", async () => {
    const contractResult = await runCli(["artifact-contract", "discovery-manifest", "--json"]);
    assert.equal(contractResult.code, 0, contractResult.stderr);
    assert.equal(contractResult.stderr, "");
    const contract = JSON.parse(contractResult.stdout);
    assert.equal(contract.subject, "discovery-manifest");
    assert.equal(contract.minimalTemplate.schemaVersion, "agentmo.discovery.v1");

    const discoverHelp = await runCli(["discover-report", "--help"]);
    assert.equal(discoverHelp.code, 0, discoverHelp.stderr);
    assert.match(discoverHelp.stdout, /artifact-contract discovery-manifest --json/u);

    const liveHelp = await runCli(["discover-live", "--help"]);
    assert.equal(liveHelp.code, 0, liveHelp.stderr);
    assert.match(liveHelp.stdout, /exact allowlisted HTTPS URLs/u);

    const needHelp = await runCli(["help", "need-report"]);
    assert.equal(needHelp.code, 0, needHelp.stderr);
    assert.match(needHelp.stdout, /artifact-contract user-need --json/u);

    const decisionHelp = await runCli(["help", "decision-ledger"]);
    assert.equal(decisionHelp.code, 0, decisionHelp.stderr);
    assert.match(decisionHelp.stdout, /artifact-contract decision-entry --json/u);

    const probeHelp = await runCli(["openclaw-probe", "--help"]);
    assert.equal(probeHelp.code, 0, probeHelp.stderr);
    for (const flag of [
      "--blueprint",
      "--blueprint-sha256",
      "--build-contract",
      "--build-contract-sha256",
      "--plan-approval",
      "--plan-approval-sha256",
    ]) {
      assert.match(probeHelp.stdout, new RegExp(flag, "u"));
    }
  });

  it("returns secret-safe field issues for a digest-bound malformed discovery manifest", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-artifact-contract-"));
    const file = path.join(root, "invalid.discovery.json");
    const privateCanary = "operator-private-description-canary";
    const bytes = Buffer.from(`${JSON.stringify({
      schemaVersion: "agentmo.discovery.v1",
      goal: privateCanary,
      sources: [],
    }, null, 2)}\n`, "utf8");
    await writeFile(file, bytes);

    const result = await runCli([
      "discover-report",
      file,
      "--digest",
      `discovery-manifest=${digest(bytes)}`,
      "--json",
    ]);
    assert.equal(result.code, 1);
    assert.equal(result.stderr, "");
    const error = JSON.parse(result.stdout);
    assert.equal(error.code, "AGENTMO_UNSUPPORTED_ARTIFACT");
    assert.equal(error.subject, "discovery-manifest");
    assert.equal(error.issues.includes("agent_id must be a non-empty string."), true);
    assert.equal(error.issues.includes("source_inventory must be an array."), true);
    assert.match(error.guidance, /artifact-contract discovery-manifest --json/u);
    assert.equal(result.stdout.includes(privateCanary), false);
    assert.equal(result.stdout.includes(root), false);
  });
});
