import { createHash } from "node:crypto";
import { lstat, open, readFile } from "node:fs/promises";
import path from "node:path";
import {
  assertPersistable,
  PersistabilityError,
  serializePersistableJson,
} from "./persistability.js";
import {
  validateOpenClawAuthorityRootBinding,
} from "./openclaw-authority-root-binding.js";

export const OPENCLAW_INSTALL_PLAN_SCHEMA_VERSION =
  "agentmo.openclaw-install-plan.v1";
export const OPENCLAW_ABSENT_GENESIS_SCHEMA_VERSION =
  "agentmo.openclaw-absent-genesis.v1";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const LIFECYCLES = new Set(["install", "upgrade", "rollback", "uninstall"]);
const ACTION_KINDS = new Set([
  "network",
  "credential",
  "process",
  "external-command",
  "user-scope",
]);
const OPERATION_KINDS = new Set(["write", "patch", "remove"]);
const CONFLICT_ACTIONS = new Set(["preserve", "replace", "abort"]);
const FIXED_MODES = new Set([0o644, 0o755]);

const PLAN_KEYS = [
  "schemaVersion",
  "installPlanDigest",
  "lifecycle",
  "archiveBinding",
  "authorityRootBinding",
  "target",
  "operations",
  "sensitiveActions",
  "conflicts",
  "predecessor",
  "officialConfigDryRun",
  "certificationBoundary",
];
const INPUT_KEYS = [
  "lifecycle",
  "archiveBinding",
  "authorityRootBinding",
  "target",
  "operations",
  "sensitiveActions",
  "conflicts",
  "officialConfigDryRun",
  "absentGenesis",
  "currentReceipt",
  "selectedPredecessorReceipt",
  "selectedPredecessorArchiveBinding",
];
const GENESIS_KEYS = [
  "schemaVersion",
  "target",
  "checkedPaths",
  "observations",
  "observedAt",
  "absenceObservationDigest",
  "verifiedAbsent",
  "certificationBoundary",
];
const ADMITTED_ABSENT_GENESIS_AUTHORITIES = new WeakSet();
const ADMITTED_INSTALL_PLANS = new WeakSet();

export class OpenClawInstallPlanError extends Error {
  constructor(code = "AGENTMO_OPENCLAW_INSTALL_PLAN_INVALID") {
    super("OpenClaw install lifecycle plan was rejected.");
    this.name = "OpenClawInstallPlanError";
    this.code = code;
  }
}

export async function buildOpenClawAbsentGenesisAuthority(options = {}) {
  if (!plainObject(options)
    || !sameKeys(options, [
      "target",
      "operations",
      "observedAt",
      "session",
    ])) {
    fail();
  }
  const checkedPaths = deriveGenesisPaths(options.operations);
  const observations = await observeAbsentPaths(options.session, checkedPaths);
  const candidate = {
    schemaVersion: OPENCLAW_ABSENT_GENESIS_SCHEMA_VERSION,
    target: clone(options.target),
    checkedPaths,
    observations,
    observedAt: options.observedAt,
    absenceObservationDigest: digestJson({
      target: options.target,
      checkedPaths,
      observations,
      observedAt: options.observedAt,
    }, "openclaw-absent-genesis-observation"),
    verifiedAbsent: true,
    certificationBoundary: {
      observedAbsenceOnly: true,
      installed: false,
      runtime: false,
      domain: false,
      production: false,
    },
  };
  if (!validateOpenClawAbsentGenesisAuthority(candidate).ok) fail();
  const authority = freeze(candidate);
  ADMITTED_ABSENT_GENESIS_AUTHORITIES.add(authority);
  return authority;
}

export async function verifyOpenClawAbsentGenesisAuthority(options = {}) {
  if (!plainObject(options)
    || !sameKeys(options, ["authority", "operations", "session"])
    || !validateOpenClawAbsentGenesisAuthority(options.authority).ok) {
    fail();
  }
  const checkedPaths = deriveGenesisPaths(options.operations);
  if (!sameJson(checkedPaths, options.authority.checkedPaths)) {
    fail("AGENTMO_OPENCLAW_GENESIS_PATH_SET_CHANGED");
  }
  const observations = await observeAbsentPaths(options.session, checkedPaths);
  if (!sameJson(observations, options.authority.observations)) {
    fail("AGENTMO_OPENCLAW_GENESIS_OBSERVATION_CHANGED");
  }
  return true;
}

export function validateOpenClawAbsentGenesisAuthority(value) {
  const errors = [];
  if (!plainObject(value) || !sameKeys(value, GENESIS_KEYS)) {
    return result(["shape"]);
  }
  if (value.schemaVersion !== OPENCLAW_ABSENT_GENESIS_SCHEMA_VERSION) {
    errors.push("schemaVersion");
  }
  if (!validTarget(value.target)) errors.push("target");
  if (!sortedUniqueStrings(value.checkedPaths)
    || !value.checkedPaths.every(portableRelativePath)) {
    errors.push("checkedPaths");
  }
  if (!validGenesisObservations(value.observations, value.checkedPaths)) {
    errors.push("observations");
  }
  if (!DATE_PATTERN.test(value.observedAt ?? "")
    || !DIGEST_PATTERN.test(value.absenceObservationDigest ?? "")
    || value.verifiedAbsent !== true) {
    errors.push("observation");
  }
  if (errors.length === 0
    && value.absenceObservationDigest !== digestJson({
      target: value.target,
      checkedPaths: value.checkedPaths,
      observations: value.observations,
      observedAt: value.observedAt,
    }, "openclaw-absent-genesis-observation")) {
    errors.push("absenceObservationDigest");
  }
  if (!exactBooleanBoundary(value.certificationBoundary, {
    observedAbsenceOnly: true,
    installed: false,
    runtime: false,
    domain: false,
    production: false,
  })) {
    errors.push("certificationBoundary");
  }
  return persistableResult(value, errors, "openclaw-absent-genesis");
}

export function buildOpenClawInstallPlan(options = {}) {
  if (!plainObject(options)
    || Object.keys(options).some((key) => !INPUT_KEYS.includes(key))
    || !sameKeysForLifecycle(options)) {
    fail();
  }
  const predecessor = buildPredecessor(options);
  const normalizedOperations = options.operations.map((operation) => ({
    ...clone(operation),
    sourcePath: Object.hasOwn(operation, "sourcePath")
      ? operation.sourcePath
      : operation.operation === "write" ? operation.path : null,
  }));
  const basis = {
    schemaVersion: OPENCLAW_INSTALL_PLAN_SCHEMA_VERSION,
    lifecycle: options.lifecycle,
    archiveBinding: clone(options.archiveBinding),
    authorityRootBinding: clone(options.authorityRootBinding),
    target: clone(options.target),
    operations: normalizedOperations,
    sensitiveActions: clone(options.sensitiveActions),
    conflicts: clone(options.conflicts),
    predecessor,
    officialConfigDryRun: clone(options.officialConfigDryRun),
    certificationBoundary: {
      proposalOnly: true,
      installed: false,
      runtime: false,
      domain: false,
      birth: false,
      delivery: false,
      production: false,
    },
  };
  const candidate = {
    schemaVersion: basis.schemaVersion,
    installPlanDigest: digestJson(basis, "openclaw-install-plan-basis"),
    lifecycle: basis.lifecycle,
    archiveBinding: basis.archiveBinding,
    authorityRootBinding: basis.authorityRootBinding,
    target: basis.target,
    operations: basis.operations,
    sensitiveActions: basis.sensitiveActions,
    conflicts: basis.conflicts,
    predecessor: basis.predecessor,
    officialConfigDryRun: basis.officialConfigDryRun,
    certificationBoundary: basis.certificationBoundary,
  };
  if (!validateOpenClawInstallPlan(candidate).ok) fail();
  const plan = freeze(candidate);
  ADMITTED_INSTALL_PLANS.add(plan);
  return plan;
}

export function validateOpenClawInstallPlan(value) {
  const errors = [];
  if (!plainObject(value) || !sameKeys(value, PLAN_KEYS)) return result(["shape"]);
  if (value.schemaVersion !== OPENCLAW_INSTALL_PLAN_SCHEMA_VERSION
    || !DIGEST_PATTERN.test(value.installPlanDigest ?? "")
    || !LIFECYCLES.has(value.lifecycle)) {
    errors.push("identity");
  }
  if (!validArchiveBinding(value.archiveBinding)) errors.push("archiveBinding");
  if (!validateOpenClawAuthorityRootBinding(value.authorityRootBinding).ok) {
    errors.push("authorityRootBinding");
  }
  if (!validTarget(value.target)) errors.push("target");
  if (!validOperations(value.operations, value.archiveBinding)) {
    errors.push("operations");
  }
  if (!validSensitiveActions(value.sensitiveActions, value.target?.scope)) {
    errors.push("sensitiveActions");
  }
  if (!validConflicts(value.conflicts)) errors.push("conflicts");
  if (!validPredecessor(
    value.predecessor,
    value.lifecycle,
    value.target,
    value.authorityRootBinding,
  )) {
    errors.push("predecessor");
  }
  if (!validOfficialConfigDryRun(value.officialConfigDryRun)) {
    errors.push("officialConfigDryRun");
  }
  if (!exactBooleanBoundary(value.certificationBoundary, {
    proposalOnly: true,
    installed: false,
    runtime: false,
    domain: false,
    birth: false,
    delivery: false,
    production: false,
  })) {
    errors.push("certificationBoundary");
  }
  if (errors.length === 0) {
    const basis = {
      schemaVersion: value.schemaVersion,
      lifecycle: value.lifecycle,
      archiveBinding: value.archiveBinding,
      authorityRootBinding: value.authorityRootBinding,
      target: value.target,
      operations: value.operations,
      sensitiveActions: value.sensitiveActions,
      conflicts: value.conflicts,
      predecessor: value.predecessor,
      officialConfigDryRun: value.officialConfigDryRun,
      certificationBoundary: value.certificationBoundary,
    };
    if (value.installPlanDigest
      !== digestJson(basis, "openclaw-install-plan-basis")) {
      errors.push("installPlanDigest");
    }
  }
  return persistableResult(value, errors, "openclaw-install-plan");
}

export async function writeOpenClawAbsentGenesisAuthority(
  filePath,
  authority,
  options = {},
) {
  return writeAuthority({
    filePath,
    candidate: authority,
    admitted: ADMITTED_ABSENT_GENESIS_AUTHORITIES,
    validate: validateOpenClawAbsentGenesisAuthority,
    subject: "openclaw-absent-genesis",
    options,
  });
}

export async function writeOpenClawInstallPlan(filePath, plan, options = {}) {
  return writeAuthority({
    filePath,
    candidate: plan,
    admitted: ADMITTED_INSTALL_PLANS,
    validate: validateOpenClawInstallPlan,
    subject: "openclaw-install-plan",
    options,
  });
}

async function writeAuthority({
  filePath,
  candidate,
  admitted,
  validate,
  subject,
  options,
}) {
  if (!admitted.has(candidate)) {
    throw new PersistabilityError(
      "AGENTMO_PERSISTABILITY_UNADMITTED_CANDIDATE",
    );
  }
  if (!validate(candidate).ok) {
    throw new PersistabilityError("AGENTMO_PERSISTABILITY_INVALID_CANDIDATE");
  }
  if (typeof filePath !== "string"
    || filePath.length === 0
    || filePath.includes("\0")) {
    throw new PersistabilityError("AGENTMO_PERSISTABILITY_INVALID_OUTPUT_PATH");
  }
  const serialized = serializePersistableJson(candidate, { subject });
  const expectedBytes = Buffer.from(serialized, "utf8");
  const target = path.resolve(filePath);
  const openOutput = options?.openOutput ?? open;
  if (typeof openOutput !== "function") {
    throw new PersistabilityError(
      "AGENTMO_PERSISTABILITY_INVALID_OUTPUT_ADAPTER",
    );
  }
  let handle;
  try {
    handle = await openOutput(target, "wx", 0o600);
    await handle.stat({ bigint: true });
    await handle.writeFile(expectedBytes);
    await handle.sync();
    await handle.close();
    handle = null;
    const finalBytes = await readFile(target);
    if (!finalBytes.equals(expectedBytes)) {
      throw new PersistabilityError("AGENTMO_PERSISTABILITY_OUTPUT_MISMATCH");
    }
    return Object.freeze({
      filePath,
      digest: digestBytes(finalBytes),
    });
  } catch (error) {
    try {
      await handle?.close();
    } catch {
      // Failed or uncertain outputs remain preserved for explicit recovery.
    }
    handle = null;
    throw error;
  } finally {
    try {
      await handle?.close();
    } catch {
      // No durable success is returned unless the external final-byte read passed.
    }
  }
}

function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function buildPredecessor(options) {
  if (options.lifecycle === "install") {
    return {
      kind: "absent-genesis",
      absentGenesis: clone(options.absentGenesis),
    };
  }
  if (options.lifecycle === "upgrade" || options.lifecycle === "uninstall") {
    return {
      kind: "current-receipt",
      currentReceipt: clone(options.currentReceipt),
    };
  }
  return {
    kind: "rollback-receipts",
    currentReceipt: clone(options.currentReceipt),
    selectedPredecessorReceipt: clone(options.selectedPredecessorReceipt),
    selectedPredecessorArchiveBinding: clone(
      options.selectedPredecessorArchiveBinding,
    ),
  };
}

function sameKeysForLifecycle(value) {
  if (!LIFECYCLES.has(value.lifecycle)) return false;
  const common = [
    "lifecycle",
    "archiveBinding",
    "authorityRootBinding",
    "target",
    "operations",
    "sensitiveActions",
    "conflicts",
    "officialConfigDryRun",
  ];
  const lifecycle = value.lifecycle === "install"
    ? ["absentGenesis"]
    : value.lifecycle === "rollback"
      ? [
        "currentReceipt",
        "selectedPredecessorReceipt",
        "selectedPredecessorArchiveBinding",
      ]
      : ["currentReceipt"];
  return sameKeys(value, [...common, ...lifecycle]);
}

function validPredecessor(value, lifecycle, target, authorityRootBinding) {
  if (!plainObject(value)) return false;
  if (lifecycle === "install") {
    return sameKeys(value, ["kind", "absentGenesis"])
      && value.kind === "absent-genesis"
      && validateOpenClawAbsentGenesisAuthority(value.absentGenesis).ok
      && sameJson(value.absentGenesis.target, target);
  }
  if (lifecycle === "upgrade" || lifecycle === "uninstall") {
    return sameKeys(value, ["kind", "currentReceipt"])
      && value.kind === "current-receipt"
      && validReceipt(value.currentReceipt, target, authorityRootBinding);
  }
  return sameKeys(value, [
    "kind",
    "currentReceipt",
    "selectedPredecessorReceipt",
    "selectedPredecessorArchiveBinding",
  ])
    && value.kind === "rollback-receipts"
    && validReceipt(value.currentReceipt, target, authorityRootBinding)
    && validReceipt(
      value.selectedPredecessorReceipt,
      target,
      authorityRootBinding,
    )
    && validArchiveBinding(value.selectedPredecessorArchiveBinding)
    && sameJson(
      value.selectedPredecessorReceipt.archiveBinding,
      value.selectedPredecessorArchiveBinding,
    )
    && value.currentReceipt.receiptDigest
      !== value.selectedPredecessorReceipt.receiptDigest;
}

function validReceipt(value, target, authorityRootBinding) {
  return plainObject(value)
    && sameKeys(value, [
      "schemaVersion",
      "receiptDigest",
      "lifecycle",
      "targetId",
      "scope",
      "archiveBinding",
      "operationSetDigest",
      "ownershipDigest",
      "authorityId",
      "rootIdentity",
    ])
    && value.schemaVersion === "agentmo.openclaw-install-receipt-authority.v1"
    && DIGEST_PATTERN.test(value.receiptDigest ?? "")
    && LIFECYCLES.has(value.lifecycle)
    && value.targetId === target?.targetId
    && value.scope === target?.scope
    && validArchiveBinding(value.archiveBinding)
    && DIGEST_PATTERN.test(value.operationSetDigest ?? "")
    && DIGEST_PATTERN.test(value.ownershipDigest ?? "")
    && value.authorityId === authorityRootBinding?.authorityId
    && sameJson(value.rootIdentity, authorityRootBinding?.rootIdentity);
}

function validArchiveBinding(value) {
  if (!plainObject(value)
    || !sameKeys(value, [
      "archiveSha256",
      "manifestDigest",
      "inventoryDigest",
      "members",
    ])
    || !DIGEST_PATTERN.test(value.archiveSha256 ?? "")
    || !DIGEST_PATTERN.test(value.manifestDigest ?? "")
    || !DIGEST_PATTERN.test(value.inventoryDigest ?? "")
    || !Array.isArray(value.members)
    || value.members.length === 0) {
    return false;
  }
  const paths = [];
  for (const member of value.members) {
    if (!plainObject(member)
      || !sameKeys(member, [
        "relativePath",
        "type",
        "mode",
        "byteLength",
        "sha256",
      ])
      || !portableRelativePath(member.relativePath)
      || member.type !== "file"
      || !FIXED_MODES.has(member.mode)
      || !Number.isSafeInteger(member.byteLength)
      || member.byteLength < 0
      || !DIGEST_PATTERN.test(member.sha256 ?? "")) {
      return false;
    }
    paths.push(member.relativePath);
  }
  return sortedUniqueStrings(paths)
    && value.inventoryDigest
      === digestJson(value.members, "package-member-inventory");
}

function validTarget(value) {
  return plainObject(value)
    && sameKeys(value, [
      "targetId",
      "targetVersion",
      "targetRevision",
      "probeFingerprintDigest",
      "scope",
      "projectId",
    ])
    && value.targetId === "openclaw"
    && nonEmptyString(value.targetVersion)
    && /^[a-f0-9]{40}$/u.test(value.targetRevision ?? "")
    && DIGEST_PATTERN.test(value.probeFingerprintDigest ?? "")
    && ["project", "user"].includes(value.scope)
    && nonEmptyString(value.projectId);
}

function validOperations(value, archiveBinding) {
  if (!Array.isArray(value) || value.length === 0) return false;
  const paths = [];
  for (const operation of value) {
    if (!plainObject(operation)
      || !sameKeys(operation, [
        "path",
        "sourcePath",
        "operation",
        "configPatch",
        "baseDigest",
        "currentDigest",
        "desiredDigest",
        "ownerMarker",
        "retainedFileIdentity",
        "retainedParentIdentity",
        "conflict",
        "rollbackRule",
      ])
      || !portableRelativePath(operation.path)
      || (operation.operation === "write"
        ? !portableRelativePath(operation.sourcePath)
        : operation.sourcePath !== null)
      || !OPERATION_KINDS.has(operation.operation)
      || !nullableDigest(operation.baseDigest)
      || !nullableDigest(operation.currentDigest)
      || !DIGEST_PATTERN.test(operation.desiredDigest ?? "")
      || !nonEmptyString(operation.ownerMarker)
      || !nullableIdentity(operation.retainedFileIdentity)
      || !validIdentity(operation.retainedParentIdentity)
      || !["none", "owned-drift", "external", "unknown-owner"].includes(
        operation.conflict,
      )
      || ![
        "remove-if-created-and-pristine",
        "restore-if-owned-and-current-digest-matches",
        "preserve",
      ].includes(operation.rollbackRule)
      || (operation.operation === "patch"
        ? !validPatch(operation.configPatch)
        : operation.operation === "remove"
          ? !validPatch(operation.configPatch)
        : operation.configPatch !== null)) {
      return false;
    }
    if (operation.operation === "write") {
      const source = archiveBinding?.members?.find(
        ({ relativePath }) => relativePath === operation.sourcePath,
      );
      if (!source) return false;
    }
    paths.push(operation.path);
  }
  return sortedUniqueStrings(paths);
}

function validPatch(value) {
  return plainObject(value)
    && sameKeys(value, ["patch", "patchDigest"])
    && plainObject(value.patch)
    && validConfigValue(value.patch, new Set())
    && value.patchDigest === digestJson(
      value.patch,
      "openclaw-official-config-patch",
    );
}

function validConfigValue(value, seen) {
  if (value === null
    || typeof value === "string"
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value))) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.length <= 256
      && value.every((item) => validConfigValue(item, seen));
  }
  if (!plainObject(value) || seen.has(value)) return false;
  seen.add(value);
  const entries = Object.entries(value);
  const valid = entries.length > 0
    && entries.length <= 256
    && entries.every(([key, item]) => (
      nonEmptyString(key)
      && !["__proto__", "constructor", "prototype"].includes(key)
      && validConfigValue(item, seen)
    ));
  seen.delete(value);
  return valid;
}

function validSensitiveActions(value, scope) {
  if (!Array.isArray(value)) return false;
  const ids = [];
  for (const action of value) {
    if (!plainObject(action)
      || !sameKeys(action, [
        "actionId",
        "kind",
        "executable",
        "argv",
        "cwd",
        "scope",
        "target",
        "timeoutMs",
        "environmentNames",
      ])
      || !nonEmptyString(action.actionId)
      || !ACTION_KINDS.has(action.kind)
      || !nonEmptyString(action.executable)
      || !Array.isArray(action.argv)
      || action.argv.some((item) => !nonEmptyString(item))
      || !nonEmptyString(action.cwd)
      || action.scope !== scope
      || !nonEmptyString(action.target)
      || !Number.isSafeInteger(action.timeoutMs)
      || action.timeoutMs < 1
      || action.timeoutMs > 60_000
      || !sortedUniqueStrings(action.environmentNames)
      || action.environmentNames.some((name) => (
        !/^[A-Z][A-Z0-9_]{0,127}$/u.test(name)
      ))) {
      return false;
    }
    ids.push(action.actionId);
  }
  return sortedUniqueStrings(ids)
    && (scope !== "user"
      || value.filter(({ kind }) => kind === "user-scope").length === 1);
}

function validConflicts(value) {
  if (!Array.isArray(value)) return false;
  const paths = [];
  for (const conflict of value) {
    if (!plainObject(conflict)
      || !sameKeys(conflict, [
        "path",
        "currentDigest",
        "desiredDigest",
        "action",
      ])
      || !portableRelativePath(conflict.path)
      || !DIGEST_PATTERN.test(conflict.currentDigest ?? "")
      || !DIGEST_PATTERN.test(conflict.desiredDigest ?? "")
      || !CONFLICT_ACTIONS.has(conflict.action)) {
      return false;
    }
    paths.push(conflict.path);
  }
  return sortedUniqueStrings(paths);
}

function validOfficialConfigDryRun(value) {
  return plainObject(value)
    && sameKeys(value, ["commandDigest", "resultDigest", "accepted"])
    && DIGEST_PATTERN.test(value.commandDigest ?? "")
    && DIGEST_PATTERN.test(value.resultDigest ?? "")
    && value.accepted === true;
}

function deriveGenesisPaths(operations) {
  if (!Array.isArray(operations)) fail();
  const paths = operations
    .filter((operation) => (
      plainObject(operation)
      && operation.operation === "write"
      && operation.currentDigest === null
      && portableRelativePath(operation.path)
    ))
    .map(({ path: relativePath }) => relativePath)
    .sort(compare);
  if (paths.length === 0 || !sortedUniqueStrings(paths)) fail();
  return paths;
}

async function observeAbsentPaths(session, checkedPaths) {
  if (!plainObject(session) || typeof session.observe !== "function") fail();
  const observePass = async () => {
    const values = [];
    for (const relativePath of checkedPaths) {
      const observed = await session.observe(relativePath);
      if (observed?.disposition !== "absent"
        || !/^\d+$/u.test(observed.parentDevice ?? "")
        || !/^\d+$/u.test(observed.parentInode ?? "")) {
        fail("AGENTMO_OPENCLAW_GENESIS_NOT_ABSENT");
      }
      values.push({
        path: relativePath,
        parentIdentity: {
          device: observed.parentDevice,
          inode: observed.parentInode,
        },
      });
    }
    return values;
  };
  const first = await observePass();
  const second = await observePass();
  if (!sameJson(first, second)) {
    fail("AGENTMO_OPENCLAW_GENESIS_OBSERVATION_CHANGED");
  }
  return first;
}

function validGenesisObservations(value, checkedPaths) {
  return Array.isArray(value)
    && value.length === checkedPaths.length
    && value.every((observation, index) => (
      plainObject(observation)
      && sameKeys(observation, ["path", "parentIdentity"])
      && observation.path === checkedPaths[index]
      && validIdentity(observation.parentIdentity)
    ));
}

function persistableResult(value, errors, subject) {
  if (errors.length === 0) {
    try {
      assertPersistable(value, { subject });
    } catch {
      errors.push("persistability");
    }
  }
  return result(errors);
}

function exactBooleanBoundary(value, expected) {
  return plainObject(value)
    && sameKeys(value, Object.keys(expected))
    && Object.entries(expected).every(([key, item]) => value[key] === item);
}

function validIdentity(value) {
  return plainObject(value)
    && sameKeys(value, ["device", "inode"])
    && /^\d+$/u.test(value.device ?? "")
    && /^\d+$/u.test(value.inode ?? "");
}

function nullableIdentity(value) {
  return value === null || validIdentity(value);
}

function nullableDigest(value) {
  return value === null || DIGEST_PATTERN.test(value ?? "");
}

function portableRelativePath(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 1024
    && !value.includes("\0")
    && !value.includes("\\")
    && !value.startsWith("/")
    && !/^[A-Za-z]:/u.test(value)
    && !value.split("/").some((segment) => (
      segment === "" || segment === "." || segment === ".."
    ));
}

function sortedUniqueStrings(value) {
  return Array.isArray(value)
    && value.every(nonEmptyString)
    && value.every((item, index) => (
      index === 0 || compare(item, value[index - 1]) > 0
    ));
}

function digestJson(value, subject) {
  return `sha256:${createHash("sha256")
    .update(Buffer.from(serializePersistableJson(value, { subject }), "utf8"))
    .digest("hex")}`;
}

function sameJson(left, right) {
  try {
    return serializePersistableJson(left, { subject: "openclaw-install-compare" })
      === serializePersistableJson(right, {
        subject: "openclaw-install-compare",
      });
  } catch {
    return false;
  }
}

function clone(value) {
  return structuredClone(value);
}

function freeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

function plainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sameKeys(value, keys) {
  return plainObject(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0 && !value.includes("\0");
}

function compare(left, right) {
  return Buffer.from(left).compare(Buffer.from(right));
}

function result(errors) {
  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze([...errors]),
  });
}

function fail(code = "AGENTMO_OPENCLAW_INSTALL_PLAN_INVALID") {
  throw new OpenClawInstallPlanError(code);
}
