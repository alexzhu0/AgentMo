import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

export const OPENCLAW_PROBE_SCHEMA_VERSION = "agentmo.openclaw-probe.v1";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const TOP_LEVEL_KEYS = Object.freeze([
  "schemaVersion",
  "status",
  "fingerprintDigest",
  "producer",
  "sourceBindings",
  "archive",
  "target",
  "runtime",
  "cli",
  "surfaces",
  "required",
  "isolation",
  "compatibility",
  "certificationBoundary",
  "remainingRisks",
]);
const PRODUCER_KEYS = Object.freeze(["id", "contractVersion", "freshObservation"]);
const SOURCE_KEYS = Object.freeze([
  "archive",
  "packageManifest",
  "blueprint",
  "buildContract",
  "planApproval",
  "targetCarrierAdmission",
  "targetDescriptor",
]);
const PROVENANCE_KEYS = Object.freeze(["identity", "subject", "digest"]);
const ARCHIVE_KEYS = Object.freeze([
  "archiveDigest",
  "manifestDigest",
  "inventoryDigest",
  "memberCount",
  "memberClosureDigest",
]);
const TARGET_KEYS = Object.freeze([
  "id",
  "version",
  "sourceRevision",
  "displayRevision",
  "nodeRange",
  "descriptorDigest",
  "targetCarrierAdmissionDigest",
  "targetRootDigest",
  "memberClosureDigest",
  "memberDigests",
  "exactTargetMatch",
]);
const TARGET_MEMBER_KEYS = Object.freeze([
  "role",
  "relativePath",
  "sha256",
  "byteLength",
]);
const CLI_KEYS = Object.freeze(["executableDigest", "observations", "contractDigest"]);
const OBSERVATION_KEYS = Object.freeze([
  "id",
  "argv",
  "exitCode",
  "signal",
  "timedOut",
  "standardOutputFacts",
  "standardErrorFacts",
]);
const OUTPUT_FACT_KEYS = Object.freeze(["kind", "digest", "byteLength", "fields"]);
const REQUIRED_KEYS = Object.freeze([
  "observationIds",
  "satisfiedObservationIds",
  "allSatisfied",
]);
const ISOLATION_KEYS = Object.freeze([
  "disposableSyntheticHome",
  "explicitStateConfigWorkspace",
  "privateExecutableCopy",
  "privateWorkingDirectory",
  "retainedSourceHandles",
  "sourceRevalidatedBetweenObservations",
  "inheritedEnvironment",
  "shell",
  "syntheticHomeDiscarded",
  "operatorHomeObserved",
  "operatorStateMutated",
]);
const COMPATIBILITY_KEYS = Object.freeze([
  "exactArchiveMatch",
  "exactTargetMatch",
  "currentProcessSupported",
  "requiredObservationsSatisfied",
  "status",
  "supportCertified",
]);
const BOUNDARY_KEYS = Object.freeze([
  "readOnlyCapabilityObservation",
  "installed",
  "pluginLoaded",
  "mcpConnected",
  "agentInvoked",
  "scheduleTriggered",
  "credentialsUsed",
  "runtime",
  "domain",
  "birth",
  "delivery",
  "production",
]);

export function validateOpenClawProbe(value, context) {
  const errors = [];
  try {
    if (!plainObject(value) || !sameKeys(value, TOP_LEVEL_KEYS)) {
      return result(["probe artifact must contain only canonical fields"]);
    }
    if (value.schemaVersion !== OPENCLAW_PROBE_SCHEMA_VERSION
      || !DIGEST_PATTERN.test(value.fingerprintDigest ?? "")
      || !["compatible", "incompatible"].includes(value.status)) {
      errors.push("probe identity, status, or fingerprint is invalid");
    }
    if (!plainObject(value.producer)
      || !sameKeys(value.producer, PRODUCER_KEYS)
      || value.producer.id !== "agentmo.openclaw-probe"
      || value.producer.contractVersion !== OPENCLAW_PROBE_SCHEMA_VERSION
      || value.producer.freshObservation !== true) {
      errors.push("probe producer must identify a fresh AgentMo observation");
    }
    validateSourceBindings(value.sourceBindings, context, errors);
    if (value.sourceBindings?.archive?.digest !== value.archive?.archiveDigest
      || value.sourceBindings?.packageManifest?.digest !== value.archive?.manifestDigest
      || value.sourceBindings?.targetCarrierAdmission?.digest
        !== value.target?.targetCarrierAdmissionDigest
      || value.sourceBindings?.targetDescriptor?.digest !== value.target?.descriptorDigest) {
      errors.push("probe facts do not close over their declared source bindings");
    }
    if (!plainObject(value.archive)
      || !sameKeys(value.archive, ARCHIVE_KEYS)
      || value.archive.memberCount < 1
      || [
        value.archive.archiveDigest,
        value.archive.manifestDigest,
        value.archive.inventoryDigest,
        value.archive.memberClosureDigest,
      ].some((digest) => !DIGEST_PATTERN.test(digest ?? ""))) {
      errors.push("archive facts are not closed and digest-bound");
    }
    validateTarget(value.target, errors);
    validateCli(value.cli, errors);
    validateRequired(value.required, value.cli, errors);
    validateIsolation(value.isolation, errors);
    validateCompatibility(value.compatibility, value, errors);
    validateBoundary(value.certificationBoundary, errors);
    if (!plainObject(value.runtime)
      || !plainObject(value.surfaces)
      || !Array.isArray(value.remainingRisks)
      || value.remainingRisks.length === 0
      || value.remainingRisks.some((risk) => typeof risk !== "string" || risk.length === 0)) {
      errors.push("probe runtime, surface, or remaining-risk facts are invalid");
    }
    if (errors.length === 0 && hashJson(fingerprintBasis(value)) !== value.fingerprintDigest) {
      errors.push("fingerprintDigest must bind every normalized probe fact");
    }
  } catch {
    errors.push("probe artifact shape is unsafe");
  }
  return result(errors);
}

function validateSourceBindings(value, context, errors) {
  if (!plainObject(value) || !sameKeys(value, SOURCE_KEYS)) {
    errors.push("probe source bindings must name the complete exact source set");
    return;
  }
  for (const key of SOURCE_KEYS) {
    const binding = value[key];
    if (!plainObject(binding)
      || !sameKeys(binding, PROVENANCE_KEYS)
      || typeof binding.identity !== "string"
      || binding.identity.length === 0
      || typeof binding.subject !== "string"
      || binding.subject.length === 0
      || !DIGEST_PATTERN.test(binding.digest ?? "")) {
      errors.push(`invalid probe source binding ${key}`);
    }
  }
  if (!plainObject(context)
    || !sameKeys(context, ["sources"])
    || !plainObject(context.sources)
    || !sameKeys(context.sources, SOURCE_KEYS)
    || !isDeepStrictEqual(value, context.sources)) {
    errors.push("probe source bindings require exact external companion provenance");
  }
}

function validateTarget(value, errors) {
  if (!plainObject(value)
    || !sameKeys(value, TARGET_KEYS)
    || value.id !== "openclaw"
    || value.exactTargetMatch !== true
    || !Array.isArray(value.memberDigests)
    || value.memberDigests.length !== 3
    || [
      value.descriptorDigest,
      value.targetCarrierAdmissionDigest,
      value.targetRootDigest,
      value.memberClosureDigest,
    ].some((digest) => !DIGEST_PATTERN.test(digest ?? ""))) {
    errors.push("target facts are not a closed exact target observation");
    return;
  }
  for (const member of value.memberDigests) {
    if (!plainObject(member)
      || !sameKeys(member, TARGET_MEMBER_KEYS)
      || typeof member.role !== "string"
      || typeof member.relativePath !== "string"
      || !DIGEST_PATTERN.test(member.sha256 ?? "")
      || !Number.isSafeInteger(member.byteLength)
      || member.byteLength <= 0) {
      errors.push("invalid target member observation");
    }
  }
}

function validateCli(value, errors) {
  if (!plainObject(value)
    || !sameKeys(value, CLI_KEYS)
    || !DIGEST_PATTERN.test(value.executableDigest ?? "")
    || !DIGEST_PATTERN.test(value.contractDigest ?? "")
    || !Array.isArray(value.observations)
    || value.observations.length !== 3) {
    errors.push("CLI observations must contain the three bounded commands");
    return;
  }
  const expected = ["version", "skill-eligibility", "config-validation"];
  if (!isDeepStrictEqual(value.observations.map(({ id }) => id), expected)) {
    errors.push("CLI observations are incomplete or out of order");
  }
  for (const observation of value.observations) {
    if (!plainObject(observation)
      || !sameKeys(observation, OBSERVATION_KEYS)
      || !Array.isArray(observation.argv)
      || !Number.isInteger(observation.exitCode)
      || !(observation.signal === null || typeof observation.signal === "string")
      || typeof observation.timedOut !== "boolean") {
      errors.push("invalid CLI observation");
      continue;
    }
    for (const facts of [
      observation.standardOutputFacts,
      observation.standardErrorFacts,
    ]) {
      if (!plainObject(facts)
        || !sameKeys(facts, OUTPUT_FACT_KEYS)
        || !["empty", "json", "text"].includes(facts.kind)
        || !DIGEST_PATTERN.test(facts.digest ?? "")
        || !Number.isSafeInteger(facts.byteLength)
        || facts.byteLength < 0
        || !Array.isArray(facts.fields)
        || facts.fields.some((field) => typeof field !== "string")) {
        errors.push("invalid normalized child-output facts");
      }
    }
  }
}

function validateRequired(value, cli, errors) {
  const expected = ["version", "skill-eligibility", "config-validation"];
  const satisfied = Array.isArray(cli?.observations)
    ? cli.observations
      .filter(({ exitCode, signal, timedOut }) => exitCode === 0 && signal === null && timedOut === false)
      .map(({ id }) => id)
    : [];
  if (!plainObject(value)
    || !sameKeys(value, REQUIRED_KEYS)
    || !isDeepStrictEqual(value.observationIds, expected)
    || !isDeepStrictEqual(value.satisfiedObservationIds, satisfied)
    || value.allSatisfied !== (satisfied.length === expected.length)) {
    errors.push("required observation satisfaction is stale");
  }
}

function validateIsolation(value, errors) {
  const expected = {
    disposableSyntheticHome: true,
    explicitStateConfigWorkspace: true,
    privateExecutableCopy: true,
    privateWorkingDirectory: true,
    retainedSourceHandles: true,
    sourceRevalidatedBetweenObservations: true,
    inheritedEnvironment: false,
    shell: false,
    syntheticHomeDiscarded: true,
    operatorHomeObserved: false,
    operatorStateMutated: false,
  };
  if (!plainObject(value)
    || !sameKeys(value, ISOLATION_KEYS)
    || Object.entries(expected).some(([key, expectedValue]) => value[key] !== expectedValue)) {
    errors.push("probe isolation facts are incomplete");
  }
}

function validateCompatibility(value, probe, errors) {
  const compatible = probe.required?.allSatisfied === true
    && probe.runtime?.supported === true;
  if (!plainObject(value)
    || !sameKeys(value, COMPATIBILITY_KEYS)
    || value.exactArchiveMatch !== true
    || value.exactTargetMatch !== true
    || value.currentProcessSupported !== (probe.runtime?.supported === true)
    || value.requiredObservationsSatisfied !== (probe.required?.allSatisfied === true)
    || value.status !== (compatible ? "compatible" : "incompatible")
    || probe.status !== value.status
    || value.supportCertified !== false) {
    errors.push("compatibility status is not derived from all required observations");
  }
}

function validateBoundary(value, errors) {
  if (!plainObject(value)
    || !sameKeys(value, BOUNDARY_KEYS)
    || value.readOnlyCapabilityObservation !== true
    || BOUNDARY_KEYS
      .filter((key) => key !== "readOnlyCapabilityObservation")
      .some((key) => value[key] !== false)) {
    errors.push("probe certification boundary is invalid");
  }
}

function fingerprintBasis(value) {
  return {
    schemaVersion: "agentmo.openclaw-probe-fingerprint-basis.v1",
    status: value.status,
    producer: value.producer,
    sourceBindings: value.sourceBindings,
    archive: value.archive,
    target: value.target,
    runtime: value.runtime,
    cli: value.cli,
    surfaces: value.surfaces,
    required: value.required,
    isolation: value.isolation,
    compatibility: value.compatibility,
    certificationBoundary: value.certificationBoundary,
  };
}

function hashJson(value) {
  return `sha256:${createHash("sha256")
    .update(Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"))
    .digest("hex")}`;
}

function result(errors) {
  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze(errors),
  });
}

function plainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype
      || Object.getPrototypeOf(value) === null);
}

function sameKeys(value, expected) {
  return plainObject(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}
