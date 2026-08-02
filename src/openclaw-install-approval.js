import { createHash } from "node:crypto";
import { lstat, open, readFile } from "node:fs/promises";
import path from "node:path";
import {
  assertPersistable,
  PersistabilityError,
  serializePersistableJson,
} from "./persistability.js";
import {
  validateOpenClawInstallPlan,
} from "./openclaw-install-plan.js";
import {
  isAdmittedOpenClawAuthorityReservationSet,
} from "./openclaw-authority-consumption.js";

export const OPENCLAW_INSTALL_APPROVAL_SCHEMA_VERSION =
  "agentmo.openclaw-install-approval.v1";
export const OPENCLAW_SENSITIVE_ACTION_DECISION_SCHEMA_VERSION =
  "agentmo.openclaw-sensitive-action-decision.v1";
export const OPENCLAW_CONFLICT_APPROVAL_SCHEMA_VERSION =
  "agentmo.openclaw-conflict-approval.v1";

const REVIEW_SCHEMA_VERSION = "agentmo.openclaw-install-review.v1";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const BASE_DECISION_KEYS = [
  "decision",
  "issuedAt",
  "expiresAt",
  "useNonce",
];
const ADMITTED_INSTALL_APPROVALS = new WeakMap();
const ADMITTED_SENSITIVE_DECISIONS = new WeakMap();
const ADMITTED_CONFLICT_APPROVALS = new WeakMap();

export class OpenClawInstallApprovalError extends Error {
  constructor(code = "AGENTMO_OPENCLAW_INSTALL_APPROVAL_INVALID") {
    super("OpenClaw install approval was rejected.");
    this.name = "OpenClawInstallApprovalError";
    this.code = code;
  }
}

export function buildOpenClawInstallReview(plan) {
  assertPlan(plan);
  const model = {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    installPlanDigest: plan.installPlanDigest,
    lifecycle: plan.lifecycle,
    archiveBinding: clone(plan.archiveBinding),
    authorityRootBinding: clone(plan.authorityRootBinding),
    target: clone(plan.target),
    operations: clone(plan.operations),
    sensitiveActions: clone(plan.sensitiveActions),
    conflicts: clone(plan.conflicts),
    predecessor: clone(plan.predecessor),
    officialConfigDryRun: clone(plan.officialConfigDryRun),
    certificationBoundary: clone(plan.certificationBoundary),
  };
  assertPersistable(model, { subject: "openclaw-install-review" });
  return freeze({
    schemaVersion: REVIEW_SCHEMA_VERSION,
    humanModel: clone(model),
    jsonModel: clone(model),
  });
}

export function buildOpenClawInstallApproval(options = {}) {
  assertBuilderOptions(options, ["plan", ...BASE_DECISION_KEYS]);
  const candidate = {
    schemaVersion: OPENCLAW_INSTALL_APPROVAL_SCHEMA_VERSION,
    decision: options.decision,
    installPlanDigest: options.plan.installPlanDigest,
    archiveBinding: clone(options.plan.archiveBinding),
    authorityRootBinding: clone(options.plan.authorityRootBinding),
    lifecycle: options.plan.lifecycle,
    targetId: options.plan.target.targetId,
    scope: options.plan.target.scope,
    authority: {
      ordinaryManagedWrites: true,
      sensitiveActions: false,
      conflicts: false,
      broaderScope: false,
    },
    issuedAt: options.issuedAt,
    expiresAt: options.expiresAt,
    useNonce: options.useNonce,
  };
  if (!validateOpenClawInstallApproval(
    candidate,
    buildContext(options.plan, options),
  ).ok) {
    fail();
  }
  const approval = freeze(candidate);
  ADMITTED_INSTALL_APPROVALS.set(
    approval,
    buildContext(options.plan, options),
  );
  return approval;
}

export function validateOpenClawInstallApproval(value, context = {}) {
  return validateDecision(
    value,
    context,
    {
      schemaVersion: OPENCLAW_INSTALL_APPROVAL_SCHEMA_VERSION,
      keys: [
        "schemaVersion",
        "decision",
        "installPlanDigest",
        "archiveBinding",
        "authorityRootBinding",
        "lifecycle",
        "targetId",
        "scope",
        "authority",
        "issuedAt",
        "expiresAt",
        "useNonce",
      ],
      basis(candidate, plan) {
        return same(candidate.authority, {
          ordinaryManagedWrites: true,
          sensitiveActions: false,
          conflicts: false,
          broaderScope: false,
        })
          && same(candidate.authorityRootBinding, plan.authorityRootBinding)
          && candidate.lifecycle === plan.lifecycle
          && candidate.targetId === plan.target.targetId
          && candidate.scope === plan.target.scope;
      },
    },
  );
}

export function buildOpenClawSensitiveActionDecision(options = {}) {
  assertBuilderOptions(options, ["plan", "action", ...BASE_DECISION_KEYS]);
  const candidate = {
    schemaVersion: OPENCLAW_SENSITIVE_ACTION_DECISION_SCHEMA_VERSION,
    decision: options.decision,
    installPlanDigest: options.plan.installPlanDigest,
    archiveBinding: clone(options.plan.archiveBinding),
    authorityRootBinding: clone(options.plan.authorityRootBinding),
    action: clone(options.action),
    issuedAt: options.issuedAt,
    expiresAt: options.expiresAt,
    useNonce: options.useNonce,
  };
  if (!validateOpenClawSensitiveActionDecision(
    candidate,
    { ...buildContext(options.plan, options), action: options.action },
  ).ok) {
    fail();
  }
  const decision = freeze(candidate);
  ADMITTED_SENSITIVE_DECISIONS.set(decision, {
    ...buildContext(options.plan, options),
    action: options.action,
  });
  return decision;
}

export function validateOpenClawSensitiveActionDecision(value, context = {}) {
  return validateDecision(
    value,
    context,
    {
      schemaVersion: OPENCLAW_SENSITIVE_ACTION_DECISION_SCHEMA_VERSION,
      keys: [
        "schemaVersion",
        "decision",
        "installPlanDigest",
        "archiveBinding",
        "authorityRootBinding",
        "action",
        "issuedAt",
        "expiresAt",
        "useNonce",
      ],
      basis(candidate, plan) {
        return plainObject(context.action)
          && same(candidate.authorityRootBinding, plan.authorityRootBinding)
          && plan.sensitiveActions.some((action) => same(action, context.action))
          && same(candidate.action, context.action);
      },
    },
  );
}

export function buildOpenClawConflictApproval(options = {}) {
  assertBuilderOptions(options, ["plan", "conflicts", ...BASE_DECISION_KEYS]);
  const candidate = {
    schemaVersion: OPENCLAW_CONFLICT_APPROVAL_SCHEMA_VERSION,
    decision: options.decision,
    installPlanDigest: options.plan.installPlanDigest,
    archiveBinding: clone(options.plan.archiveBinding),
    authorityRootBinding: clone(options.plan.authorityRootBinding),
    conflicts: clone(options.conflicts),
    issuedAt: options.issuedAt,
    expiresAt: options.expiresAt,
    useNonce: options.useNonce,
  };
  if (!validateOpenClawConflictApproval(
    candidate,
    buildContext(options.plan, options),
  ).ok) {
    fail();
  }
  const approval = freeze(candidate);
  ADMITTED_CONFLICT_APPROVALS.set(
    approval,
    buildContext(options.plan, options),
  );
  return approval;
}

export function validateOpenClawConflictApproval(value, context = {}) {
  return validateDecision(
    value,
    context,
    {
      schemaVersion: OPENCLAW_CONFLICT_APPROVAL_SCHEMA_VERSION,
      keys: [
        "schemaVersion",
        "decision",
        "installPlanDigest",
        "archiveBinding",
        "authorityRootBinding",
        "conflicts",
        "issuedAt",
        "expiresAt",
        "useNonce",
      ],
      basis(candidate, plan) {
        return same(candidate.conflicts, plan.conflicts)
          && same(candidate.authorityRootBinding, plan.authorityRootBinding);
      },
    },
  );
}

export function validateOpenClawInstallDecision(value, context = {}) {
  let validation;
  let family;
  if (value?.schemaVersion === OPENCLAW_INSTALL_APPROVAL_SCHEMA_VERSION) {
    validation = validateOpenClawInstallApproval(value, context);
    family = "ordinary";
  } else if (
    value?.schemaVersion === OPENCLAW_SENSITIVE_ACTION_DECISION_SCHEMA_VERSION
  ) {
    validation = validateOpenClawSensitiveActionDecision(value, context);
    family = "sensitive";
  } else if (
    value?.schemaVersion === OPENCLAW_CONFLICT_APPROVAL_SCHEMA_VERSION
  ) {
    validation = validateOpenClawConflictApproval(value, context);
    family = "conflict";
  } else {
    return result(["shape"]);
  }
  if (!validation.ok
    || !isAdmittedOpenClawAuthorityReservationSet(
      context.authorityReservation,
    )
    || context.authorityReservation.installPlanDigest
      !== context.plan.installPlanDigest) {
    return result(["reservation"]);
  }
  const decisionDigest = digestDecision(value);
  const matching = context.authorityReservation.markers.filter((marker) => (
    marker.family === family && marker.decisionDigest === decisionDigest
  ));
  if (matching.length !== 1
    || (family === "sensitive"
      && matching[0].actionDigest !== digestDecision(context.action))
    || (family === "conflict"
      && matching[0].conflictSetDigest !== digestValue(context.plan.conflicts))) {
    return result(["reservation"]);
  }
  return result([]);
}

export async function writeOpenClawInstallApproval(
  filePath,
  approval,
  context,
  options = {},
) {
  if (context?.openOutput !== undefined && options.openOutput === undefined) {
    options = context;
    context = undefined;
  }
  return writeDecision({
    filePath,
    candidate: approval,
    admissions: ADMITTED_INSTALL_APPROVALS,
    context,
    validate: validateOpenClawInstallApproval,
    subject: "openclaw-install-approval",
    options,
  });
}

export async function writeOpenClawSensitiveActionDecision(
  filePath,
  decision,
  context,
  options = {},
) {
  return writeDecision({
    filePath,
    candidate: decision,
    admissions: ADMITTED_SENSITIVE_DECISIONS,
    context,
    validate: validateOpenClawSensitiveActionDecision,
    subject: "openclaw-sensitive-action-decision",
    options,
  });
}

export async function writeOpenClawConflictApproval(
  filePath,
  approval,
  context,
  options = {},
) {
  return writeDecision({
    filePath,
    candidate: approval,
    admissions: ADMITTED_CONFLICT_APPROVALS,
    context,
    validate: validateOpenClawConflictApproval,
    subject: "openclaw-conflict-approval",
    options,
  });
}

export async function writeOpenClawInstallReviewDecisions(configuration) {
  if (!plainObject(configuration)
    || !sameKeys(configuration, ["plan", "outputs", "validation"])
    || !validateOpenClawInstallPlan(configuration.plan).ok
    || !plainObject(configuration.outputs)
    || !sameKeys(configuration.outputs, [
      "ordinary",
      "sensitive",
      "conflict",
    ])
    || !plainObject(configuration.validation)
    || !sameKeys(configuration.validation, ["now"])) {
    throw new OpenClawInstallApprovalError(
      "AGENTMO_OPENCLAW_INSTALL_APPROVAL_CARDINALITY",
    );
  }
  const { plan, outputs, validation } = configuration;
  if (!validOutput(outputs.ordinary)
    || !Array.isArray(outputs.sensitive)
    || outputs.sensitive.length !== plan.sensitiveActions.length
    || !validOutput(outputs.conflict)
    || outputs.sensitive.some((output, index) => (
      !validSensitiveOutput(output, plan.sensitiveActions[index])
    ))) {
    throw new OpenClawInstallApprovalError(
      "AGENTMO_OPENCLAW_INSTALL_APPROVAL_CARDINALITY",
    );
  }
  const descriptors = [
    {
      ...outputs.ordinary,
      admissions: ADMITTED_INSTALL_APPROVALS,
      validate: validateOpenClawInstallApproval,
      context: { plan, ...validation },
      subject: "openclaw-install-approval",
    },
    ...outputs.sensitive.map((output) => ({
      ...output,
      admissions: ADMITTED_SENSITIVE_DECISIONS,
      validate: validateOpenClawSensitiveActionDecision,
      context: { plan, action: output.action, ...validation },
      subject: "openclaw-sensitive-action-decision",
    })),
    {
      ...outputs.conflict,
      admissions: ADMITTED_CONFLICT_APPROVALS,
      validate: validateOpenClawConflictApproval,
      context: { plan, ...validation },
      subject: "openclaw-conflict-approval",
    },
  ];
  const targets = descriptors.map(({ filePath }) => path.resolve(filePath));
  if (new Set(targets).size !== targets.length) {
    throw new OpenClawInstallApprovalError(
      "AGENTMO_OPENCLAW_INSTALL_APPROVAL_CARDINALITY",
    );
  }

  for (const descriptor of descriptors) {
    assertDecisionWritable(descriptor);
  }
  await Promise.all(targets.map(assertAbsentOutput));

  const results = [];
  for (const descriptor of descriptors) {
    results.push(await writeDecision(descriptor));
  }
  return Object.freeze(results);
}

function validOutput(value) {
  return plainObject(value)
    && sameKeys(value, ["filePath", "candidate"])
    && validFilePath(value.filePath);
}

function validSensitiveOutput(value, expectedAction) {
  return plainObject(value)
    && sameKeys(value, ["filePath", "action", "candidate"])
    && validFilePath(value.filePath)
    && same(value.action, expectedAction);
}

function validFilePath(value) {
  return typeof value === "string" && value.length > 0 && !value.includes("\0");
}

async function assertAbsentOutput(filePath) {
  try {
    await lstat(filePath);
    const error = new Error("Authority output already exists.");
    error.code = "EEXIST";
    throw error;
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
}

function assertDecisionWritable({
  candidate,
  admissions,
  context,
  validate,
  subject,
}) {
  if (!admissions.has(candidate)) {
    throw new PersistabilityError(
      "AGENTMO_PERSISTABILITY_UNADMITTED_CANDIDATE",
    );
  }
  if (!validate(candidate, context ?? admissions.get(candidate)).ok) {
    throw new PersistabilityError("AGENTMO_PERSISTABILITY_INVALID_CANDIDATE");
  }
  serializePersistableJson(candidate, { subject });
}

async function writeDecision({
  filePath,
  candidate,
  admissions,
  context,
  validate,
  subject,
  options = {},
}) {
  if (!validFilePath(filePath)) {
    throw new PersistabilityError("AGENTMO_PERSISTABILITY_INVALID_OUTPUT_PATH");
  }
  assertDecisionWritable({
    candidate,
    admissions,
    context,
    validate,
    subject,
  });
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
      digest: `sha256:${createHash("sha256")
        .update(finalBytes)
        .digest("hex")}`,
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
      // Success requires the external final-byte read, never this close result.
    }
  }
}

function validateDecision(value, context, descriptor) {
  const errors = [];
  if (!plainObject(value) || !sameKeys(value, descriptor.keys)) {
    return result(["shape"]);
  }
  const plan = context?.plan;
  if (value.schemaVersion !== descriptor.schemaVersion
    || value.decision !== "approve"
    || !nonEmptyString(value.useNonce)
    || !DATE_PATTERN.test(value.issuedAt ?? "")
    || !DATE_PATTERN.test(value.expiresAt ?? "")
    || Date.parse(value.issuedAt) >= Date.parse(value.expiresAt)) {
    errors.push("decision");
  }
  if (!plainObject(plan)
    || !validateOpenClawInstallPlan(plan).ok
    || value.installPlanDigest !== plan?.installPlanDigest
    || !same(value.archiveBinding, plan?.archiveBinding)
    || !descriptor.basis(value, plan ?? {})) {
    errors.push("basis");
  }
  const contextKeys = ["plan", "now"];
  if (Object.hasOwn(context ?? {}, "action")) contextKeys.push("action");
  if (Object.hasOwn(context ?? {}, "authorityReservation")) {
    contextKeys.push("authorityReservation");
  }
  if (!sameKeys(context, contextKeys)
    || !DATE_PATTERN.test(context.now ?? "")
    || Date.parse(context.now) < Date.parse(value.issuedAt)
    || Date.parse(context.now) >= Date.parse(value.expiresAt)) {
    errors.push("lifecycle");
  }
  if (errors.length === 0) {
    try {
      assertPersistable(value, { subject: "openclaw-install-decision" });
    } catch {
      errors.push("persistability");
    }
  }
  return result(errors);
}

function buildContext(plan, options) {
  return {
    plan,
    now: options.issuedAt,
  };
}

function digestDecision(value) {
  return `sha256:${createHash("sha256")
    .update(Buffer.from(serializePersistableJson(value, {
      subject: "openclaw-install-decision",
    }), "utf8"))
    .digest("hex")}`;
}

function digestValue(value) {
  return `sha256:${createHash("sha256")
    .update(Buffer.from(serializePersistableJson(value, {
      subject: "openclaw-authority-digest",
    }), "utf8"))
    .digest("hex")}`;
}

function assertBuilderOptions(value, keys) {
  if (!plainObject(value) || !sameKeys(value, keys)) fail();
  assertPlan(value.plan);
  if (value.decision !== "approve") fail();
}

function assertPlan(plan) {
  if (!validateOpenClawInstallPlan(plan).ok) fail();
}

function same(left, right) {
  try {
    return serializePersistableJson(left, { subject: "openclaw-install-equality" })
      === serializePersistableJson(right, {
        subject: "openclaw-install-equality",
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

function result(errors) {
  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze([...errors]),
  });
}

function fail() {
  throw new OpenClawInstallApprovalError();
}
