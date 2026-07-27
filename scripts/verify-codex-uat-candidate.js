import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  verifyCodexUatCandidateDecision,
} from "../src/builder-codex-uat.js";
import { assertBuilderPlatform } from "../src/builder-platform.js";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const VERIFIER_SOURCE_PATH = "scripts/verify-codex-uat-candidate.js";
const ARGUMENT_NAMES = Object.freeze([
  "attempt-dir",
  "successor-tarball",
  "expected-head-sha256",
  "expected-candidate-sha256",
  "expected-successor-version",
  "expected-release-sha256",
  "expected-tarball-sha256",
]);

class CodexUatVerifierError extends Error {
  constructor(code) {
    super("Codex UAT candidate verification was rejected.");
    this.name = "CodexUatVerifierError";
    this.code = code;
  }
}

function fail(code) {
  throw new CodexUatVerifierError(code);
}

function parseArguments(argv) {
  const command = argv[0];
  let decision = null;
  let index = 1;
  if (command === "decide") {
    decision = argv[index];
    index += 1;
  }
  const values = {};
  while (index < argv.length) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      fail("AGENTMO_CODEX_UAT_VERIFIER_ARGUMENTS_REJECTED");
    }
    const name = flag.slice(2);
    if (!ARGUMENT_NAMES.includes(name) || Object.hasOwn(values, name)) {
      fail("AGENTMO_CODEX_UAT_VERIFIER_ARGUMENTS_REJECTED");
    }
    values[name] = value;
    index += 2;
  }
  if (!["preview", "decide"].includes(command)
    || (command === "preview" && decision !== null)
    || (command === "decide" && !["approve", "reject"].includes(decision))
    || Object.keys(values).length !== ARGUMENT_NAMES.length
    || ARGUMENT_NAMES.some((name) => !Object.hasOwn(values, name))
    || !VERSION_PATTERN.test(values["expected-successor-version"] ?? "")
    || [
      "expected-head-sha256",
      "expected-candidate-sha256",
      "expected-release-sha256",
      "expected-tarball-sha256",
    ].some((name) => !DIGEST_PATTERN.test(values[name] ?? ""))) {
    fail("AGENTMO_CODEX_UAT_VERIFIER_ARGUMENTS_REJECTED");
  }
  return Object.freeze({ command, decision, values: Object.freeze(values) });
}

function ownPackageRoot() {
  const executingPath = fileURLToPath(import.meta.url);
  const packageRoot = path.resolve(path.dirname(executingPath), "..");
  if (executingPath !== path.join(packageRoot, VERIFIER_SOURCE_PATH)) {
    fail("AGENTMO_CODEX_UAT_VERIFIER_SELF_REJECTED");
  }
  return packageRoot;
}

function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function writeBounded(channel, value) {
  channel.write(`${JSON.stringify(value)}\n`);
}

async function main() {
  assertVerifierPlatform();
  const request = parseArguments(process.argv.slice(2));
  const attemptDir = path.resolve(request.values["attempt-dir"]);
  const candidateDigest = request.values["expected-candidate-sha256"];
  let result;
  try {
    result = await verifyCodexUatCandidateDecision({
      packageRoot: ownPackageRoot(),
      successorTarballPath: path.resolve(request.values["successor-tarball"]),
      journalPath: path.join(attemptDir, "attempt.journal"),
      candidatePath: path.join(attemptDir, "candidates", `${candidateDigest.slice(7)}.json`),
      expectedHeadDigest: request.values["expected-head-sha256"],
      expectedCandidateDigest: candidateDigest,
      expectedSuccessorVersion: request.values["expected-successor-version"],
      expectedReleaseDigest: request.values["expected-release-sha256"],
      expectedTarballDigest: request.values["expected-tarball-sha256"],
      decision: request.command === "preview" ? null : request.decision,
    });
  } catch {
    fail(request.command === "preview"
      ? "AGENTMO_CODEX_UAT_VERIFIER_EVIDENCE_REJECTED"
      : "AGENTMO_CODEX_UAT_VERIFIER_DECISION_REJECTED");
  }
  if (request.command === "preview") {
    writeBounded(process.stdout, result);
    return;
  }
  const { preview, reportedDecision } = result;
  writeBounded(process.stdout, {
    schemaVersion: reportedDecision.schemaVersion,
    status: reportedDecision.status,
    headDigest: preview.headDigest,
    candidateDigest: preview.candidateDigest,
    packageName: preview.packageName,
    version: preview.version,
    releaseDigest: preview.releaseDigest,
    tarballDigest: preview.tarballDigest,
    verifierDigest: preview.verifierDigest,
    releaseSetOperationId: preview.releaseSetOperationId,
    releaseSetDigest: preview.releaseSetDigest,
    terminal: false,
    journalMutated: false,
    humanAuthorityVerified: false,
    externalDecisionAuthorityRequired: true,
  });
}

function assertVerifierPlatform() {
  try {
    assertBuilderPlatform();
  } catch {
    fail("AGENTMO_CODEX_UAT_VERIFIER_PLATFORM_UNSUPPORTED");
  }
}

try {
  await main();
} catch (error) {
  writeBounded(process.stderr, {
    status: "rejected",
    code: error instanceof CodexUatVerifierError
      ? error.code
      : "AGENTMO_CODEX_UAT_VERIFIER_REJECTED",
  });
  process.exitCode = 1;
}
