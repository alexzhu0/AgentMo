import { createHash } from "node:crypto";
import path from "node:path";
import {
  validateOpenClawInstallDecision,
} from "./openclaw-install-approval.js";
import {
  assertPersistable,
  serializePersistableJson,
} from "./persistability.js";

const SAFE_ENVIRONMENT_NAME = /^[A-Z][A-Z0-9_]{0,127}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;

export class OpenClawCredentialHandoffError extends Error {
  constructor(code) {
    super("OpenClaw credential handoff was rejected.");
    this.name = "OpenClawCredentialHandoffError";
    this.code = code;
  }
}

export function buildOpenClawCredentialSetupProposal(options = {}) {
  if (!plainObject(options)
    || !sameKeys(options, [
      "profileReference",
      "missingEnvironmentNames",
      "officialRoute",
    ])
    || !nonEmpty(options.profileReference)
    || !sortedUnique(options.missingEnvironmentNames)
    || !options.missingEnvironmentNames.every((name) => (
      SAFE_ENVIRONMENT_NAME.test(name)
    ))
    || !validOfficialRoute(options.officialRoute)) {
    fail("AGENTMO_OPENCLAW_CREDENTIAL_PROPOSAL_INVALID");
  }
  const action = {
    actionId: `setup:${options.profileReference}`,
    kind: "credential",
    executable: options.officialRoute.executable,
    argv: structuredClone(options.officialRoute.argv),
    cwd: ".",
    scope: "project",
    target: options.profileReference,
    timeoutMs: options.officialRoute.timeoutMs,
    environmentNames: [],
  };
  const proposal = {
    schemaVersion: "agentmo.openclaw-credential-setup-proposal.v1",
    profileReference: options.profileReference,
    environmentPresence: {
      kind: "SecretPresence",
      source: "runtime-env",
      allowedNames: structuredClone(options.missingEnvironmentNames),
      presentNames: [],
      missingNames: structuredClone(options.missingEnvironmentNames),
      valuesPersisted: false,
    },
    action,
    route: "official-openclaw-auth",
    certificationBoundary: {
      proposalOnly: true,
      installed: false,
      runtime: false,
      domain: false,
      production: false,
    },
  };
  assertPersistable(proposal, { subject: "openclaw-credential-setup-proposal" });
  return freeze(proposal);
}

export async function runApprovedOpenClawCredentialHandoff(options = {}) {
  if (!plainObject(options)
    || !sameKeys(options, [
      "proposal",
      "decision",
      "validation",
      "verifiedExecutable",
      "runOfficialRoute",
    ])
    || !validProposal(options.proposal)
    || !plainObject(options.decision)
    || !sameJson(options.decision.action, options.proposal.action)
    || !plainObject(options.validation)
    || !sameKeys(options.validation, [
      "plan",
      "now",
      "authorityReservation",
      "probe",
    ])
    || !plainObject(options.verifiedExecutable)
    || !sameKeys(options.verifiedExecutable, ["path", "digest"])
    || !path.isAbsolute(options.verifiedExecutable.path ?? "")
    || !DIGEST_PATTERN.test(options.verifiedExecutable.digest ?? "")
    || options.verifiedExecutable.digest
      !== options.validation.probe?.cli?.executableDigest
    || !validateOpenClawInstallDecision(options.decision, {
      plan: options.validation.plan,
      action: options.proposal.action,
      now: options.validation.now,
      authorityReservation: options.validation.authorityReservation,
    }).ok
    || typeof options.runOfficialRoute !== "function") {
    fail("AGENTMO_OPENCLAW_CREDENTIAL_APPROVAL_INVALID");
  }
  const action = options.proposal.action;
  if (!validOfficialRoute({
    executable: action.executable,
    argv: action.argv,
    timeoutMs: action.timeoutMs,
  }) || action.kind !== "credential") {
    fail("AGENTMO_OPENCLAW_CREDENTIAL_ROUTE_REJECTED");
  }
  const result = {
    route: "official-openclaw-auth",
    disposition: "unsupported",
    unsupportedReason: "phase4-credential-state-proof-unavailable",
    actionDigest: digestValue(action),
    decisionDigest: digestValue(options.decision),
    credentialPresent: false,
    processStarted: false,
    rawOutputPersisted: false,
  };
  assertPersistable(result, { subject: "openclaw-credential-handoff-result" });
  return Object.freeze(result);
}

function validOfficialRoute(value) {
  return plainObject(value)
    && sameKeys(value, ["executable", "argv", "timeoutMs"])
    && value.executable === "openclaw"
    && Array.isArray(value.argv)
    && value.argv.every(nonEmpty)
    && (validSecretsApply(value.argv) || validModelsAuthLogin(value.argv))
    && Number.isSafeInteger(value.timeoutMs)
    && value.timeoutMs > 0
    && value.timeoutMs <= 60_000;
}

function validSecretsApply(argv) {
  return (argv.length === 4 || argv.length === 5)
    && argv[0] === "secrets"
    && argv[1] === "apply"
    && argv[2] === "--from"
    && portableRelativePath(argv[3])
    && (argv.length === 4 || argv[4] === "--dry-run");
}

function validModelsAuthLogin(argv) {
  if (argv.length < 5 || argv.length > 9 || argv.length % 2 === 0
    || argv[0] !== "models"
    || argv[1] !== "auth"
    || argv[2] !== "login"
    || argv[3] !== "--provider"
    || !SAFE_ID.test(argv[4])) {
    return false;
  }
  let index = 5;
  if (index < argv.length && argv[index] === "--method") {
    if (!SAFE_ID.test(argv[index + 1] ?? "")) return false;
    index += 2;
  }
  if (index < argv.length && argv[index] === "--profile") {
    if (!SAFE_ID.test(argv[index + 1] ?? "")) return false;
    index += 2;
  }
  return index === argv.length;
}

function validProposal(value) {
  return plainObject(value)
    && sameKeys(value, [
      "schemaVersion",
      "profileReference",
      "environmentPresence",
      "action",
      "route",
      "certificationBoundary",
    ])
    && value.schemaVersion === "agentmo.openclaw-credential-setup-proposal.v1"
    && value.environmentPresence?.valuesPersisted === false
    && value.route === "official-openclaw-auth"
    && plainObject(value.action);
}

function portableRelativePath(value) {
  return nonEmpty(value)
    && value.length <= 1024
    && !value.includes("\\")
    && !path.posix.isAbsolute(value)
    && value.split("/").every((part) => (
      part.length > 0 && part !== "." && part !== ".."
    ));
}

function digestValue(value) {
  return `sha256:${createHash("sha256")
    .update(Buffer.from(serializePersistableJson(value, {
      subject: "openclaw-install-decision",
    }), "utf8"))
    .digest("hex")}`;
}

function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sameJson(left, right) {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function sortedUnique(value) {
  return Array.isArray(value)
    && value.every(nonEmpty)
    && value.every((item, index) => (
      index === 0 || Buffer.from(item).compare(Buffer.from(value[index - 1])) > 0
    ));
}

function plainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype
      || Object.getPrototypeOf(value) === null);
}

function sameKeys(value, keys) {
  return plainObject(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function nonEmpty(value) {
  return typeof value === "string" && value.length > 0 && !value.includes("\0");
}

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function fail(code) {
  throw new OpenClawCredentialHandoffError(code);
}
