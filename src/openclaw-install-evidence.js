import { createHash } from "node:crypto";
import {
  appendOpenClawCanonicalFinalization,
  createOpenClawCanonicalEvidenceRecord,
  describeOpenClawCanonicalAuthorityLedger,
  reopenOpenClawCanonicalAuthorityMarkers,
  reopenOpenClawCanonicalFinalization,
  reopenOpenClawCanonicalEvidenceRecord,
  reopenOpenClawCanonicalReservedAuthorityMarkers,
} from "./openclaw-authority-consumption.js";
import {
  validateOpenClawSensitiveActionDecision,
} from "./openclaw-install-approval.js";
import { validateOpenClawInstallPlan } from "./openclaw-install-plan.js";
import {
  assertPersistable,
  serializePersistableJson,
} from "./persistability.js";

export const OPENCLAW_INSTALL_POST_STATE_SCHEMA_VERSION =
  "agentmo.openclaw-install-post-state.v1";
export const OPENCLAW_OFFICIAL_ACTION_RESULT_SCHEMA_VERSION =
  "agentmo.openclaw-official-action-result.v1";
export const OPENCLAW_INSTALL_FINALIZATION_SCHEMA_VERSION =
  "agentmo.openclaw-install-finalization.v1";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const ATTEMPT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const REASON_PATTERN = /^[a-z][a-z0-9-]{0,127}$/u;
const POST_STATE_ADMISSIONS = new WeakSet();
const ACTION_RESULT_ADMISSIONS = new WeakSet();
const FINALIZATION_ADMISSIONS = new WeakSet();

export class OpenClawInstallEvidenceError extends Error {
  constructor(code = "AGENTMO_OPENCLAW_EVIDENCE_REJECTED") {
    super("OpenClaw install post-effect evidence was rejected.");
    this.name = "OpenClawInstallEvidenceError";
    this.code = code;
  }
}

export async function publishOpenClawInstallPostStateEvidence(options = {}) {
  assertPostStateOptions(options);
  const ledger = describeOpenClawCanonicalAuthorityLedger(options.ledger);
  const attempt = attemptBinding(options.attemptId);
  const journal = journalBinding(
    options.journalSource,
    options.plan,
    attempt,
  );
  const operations = [...options.plan.operations].sort(comparePath);
  const observations = [];
  for (const operation of operations) {
    const observed = await options.targetSession.observe(operation.path);
    observations.push(postObservation(operation, observed));
  }
  const value = {
    schemaVersion: OPENCLAW_INSTALL_POST_STATE_SCHEMA_VERSION,
    ledger: ledgerBinding(ledger),
    attempt,
    plan: planBinding(options.plan, options.planSource),
    journal,
    target: {
      descriptor: structuredClone(options.targetDescriptorSource),
      identity: structuredClone(options.plan.target),
      managedRootIdentity: structuredClone(options.targetSession.rootIdentity),
    },
    observations,
    observationSetDigest: digestJson(
      observations,
      "openclaw-install-post-state-observations",
    ),
    rawOutputPersisted: false,
  };
  assertValid(
    validateOpenClawInstallPostStateEvidence(value),
    "AGENTMO_OPENCLAW_POST_STATE_REJECTED",
  );
  const bytes = canonicalBytes(value, "openclaw-install-post-state");
  const published = await createOpenClawCanonicalEvidenceRecord({
    ledger: options.ledger,
    recordKind: "post-state",
    attemptDigest: attempt.attemptDigest,
    actionDigest: null,
    bytes,
  });
  return reopenOpenClawInstallPostStateEvidence({
    ledger: options.ledger,
    provenance: specializedProvenance(
      published,
      OPENCLAW_INSTALL_POST_STATE_SCHEMA_VERSION,
      "openclaw-install-post-state",
      { attemptDigest: attempt.attemptDigest },
    ),
    attemptId: options.attemptId,
    plan: options.plan,
    planSource: options.planSource,
    journalSource: journal,
    targetDescriptorSource: options.targetDescriptorSource,
  });
}

export async function reopenOpenClawInstallPostStateEvidence(options = {}) {
  if (!plainObject(options)
    || !sameKeys(options, [
      "ledger",
      "provenance",
      "attemptId",
      "plan",
      "planSource",
      "journalSource",
      "targetDescriptorSource",
    ])
    || !ATTEMPT_PATTERN.test(options.attemptId ?? "")
    || !validateOpenClawInstallPlan(options.plan).ok) {
    fail("AGENTMO_OPENCLAW_EVIDENCE_BINDING_REJECTED");
  }
  const attempt = attemptBinding(options.attemptId);
  assertEvidenceProvenance(
    options.provenance,
    OPENCLAW_INSTALL_POST_STATE_SCHEMA_VERSION,
    "openclaw-install-post-state",
  );
  if (options.provenance.attemptDigest !== attempt.attemptDigest) {
    fail("AGENTMO_OPENCLAW_EVIDENCE_BINDING_REJECTED");
  }
  const reopened = await reopenOpenClawCanonicalEvidenceRecord({
    ledger: options.ledger,
    recordKind: "post-state",
    attemptDigest: attempt.attemptDigest,
    actionDigest: null,
    expectedDigest: options.provenance.digest,
  });
  assertSameProvenance(options.provenance, reopened.provenance);
  const value = parseCanonical(
    reopened.bytes,
    "openclaw-install-post-state",
  );
  assertValid(
    validateOpenClawInstallPostStateEvidence(value),
    "AGENTMO_OPENCLAW_POST_STATE_REJECTED",
  );
  const expectedJournal = journalBinding(
    options.journalSource,
    options.plan,
    attempt,
  );
  const ledger = describeOpenClawCanonicalAuthorityLedger(options.ledger);
  if (!same(value.ledger, ledgerBinding(ledger))
    || !same(value.attempt, attempt)
    || !same(value.plan, planBinding(options.plan, options.planSource))
    || !same(value.journal, expectedJournal)
    || !same(value.target.descriptor, options.targetDescriptorSource)
    || !same(value.target.identity, options.plan.target)
    || options.targetDescriptorSource.digest !== ledger.targetDescriptorDigest
    || value.observations.length !== options.plan.operations.length
    || value.observations.some((observation) => {
      const operation = options.plan.operations.find(
        ({ path }) => path === observation.path,
      );
      return operation === undefined
        || observation.operationDigest !== digestJson(
          operation,
          "openclaw-managed-operation",
        );
    })) {
    fail("AGENTMO_OPENCLAW_EVIDENCE_BINDING_REJECTED");
  }
  POST_STATE_ADMISSIONS.add(value);
  return deepFreeze({
    value,
    provenance: structuredClone(options.provenance),
  });
}

export function validateOpenClawInstallPostStateEvidence(value) {
  const errors = [];
  if (!plainObject(value)
    || !sameKeys(value, [
      "schemaVersion",
      "ledger",
      "attempt",
      "plan",
      "journal",
      "target",
      "observations",
      "observationSetDigest",
      "rawOutputPersisted",
    ])) {
    return validation(["shape"]);
  }
  if (value.schemaVersion !== OPENCLAW_INSTALL_POST_STATE_SCHEMA_VERSION
    || !validLedgerBinding(value.ledger)
    || !validAttempt(value.attempt)
    || !validPlanBinding(value.plan)
    || !validJournalBinding(value.journal, value.plan, value.attempt)
    || !validPostTarget(value.target)
    || !validPostObservations(value.observations)
    || value.observationSetDigest !== digestJson(
      value.observations,
      "openclaw-install-post-state-observations",
    )
    || value.rawOutputPersisted !== false) {
    errors.push("contract");
  }
  return persistableValidation(
    value,
    errors,
    "openclaw-install-post-state",
  );
}

export function isAdmittedOpenClawInstallPostStateEvidence(value) {
  return POST_STATE_ADMISSIONS.has(value);
}

export async function publishOpenClawOfficialActionResultEvidence(
  options = {},
) {
  assertActionResultOptions(options);
  const attempt = attemptBinding(options.attemptId);
  if (options.authorityReservation.attemptId !== options.attemptId) {
    fail("AGENTMO_OPENCLAW_EVIDENCE_BINDING_REJECTED");
  }
  const actionDigest = digestJson(
    options.action,
    "openclaw-install-decision",
  );
  const decisionDigest = digestJson(
    options.decision,
    "openclaw-install-decision",
  );
  const markers = await reopenOpenClawCanonicalReservedAuthorityMarkers({
    ledger: options.ledger,
    authorityReservation: options.authorityReservation,
    plan: options.plan,
    probe: options.probe,
  });
  const matching = markers.filter((marker) => (
    marker.family === "sensitive"
    && marker.actionDigest === actionDigest
    && marker.decisionDigest === decisionDigest
  ));
  if (matching.length !== 1) {
    fail("AGENTMO_OPENCLAW_EVIDENCE_BINDING_REJECTED");
  }
  const observedResult = officialResultObservation(
    options.action,
    options.decision,
    options.probe,
    options.result,
  );
  const ledger = describeOpenClawCanonicalAuthorityLedger(options.ledger);
  const value = {
    schemaVersion: OPENCLAW_OFFICIAL_ACTION_RESULT_SCHEMA_VERSION,
    ledger: ledgerBinding(ledger),
    attempt,
    plan: planBinding(options.plan, options.planSource),
    action: {
      actionId: options.action.actionId,
      actionDigest,
      kind: options.action.kind,
      route: observedResult.route,
      scope: options.action.scope,
      targetDigest: digestBytes(Buffer.from(options.action.target, "utf8")),
    },
    decision: {
      artifact: structuredClone(options.decisionSource),
      decisionDigest,
      nonceDigest: digestBytes(Buffer.from(options.decision.useNonce, "utf8")),
    },
    marker: markerBinding(matching[0], ledger),
    executable: {
      name: options.action.executable,
      digest: options.probe.cli.executableDigest,
    },
    invocation: {
      argvDigest: digestJson(
        options.action.argv,
        "openclaw-official-action-argv",
      ),
      declaredDigest: digestJson({
        executable: options.action.executable,
        argv: options.action.argv,
        cwd: options.action.cwd,
        timeoutMs: options.action.timeoutMs,
        environmentNames: options.action.environmentNames,
      }, "openclaw-official-action-invocation"),
      producerDigest: observedResult.invocationDigest,
      cwd: options.action.cwd,
      timeoutMs: options.action.timeoutMs,
      environmentNames: structuredClone(options.action.environmentNames),
    },
    processGroup: observedResult.processGroup,
    quiescence: observedResult.quiescence,
    resultObservation: observedResult.resultObservation,
    rawOutputPersisted: false,
  };
  assertValid(
    validateOpenClawOfficialActionResultEvidence(value),
    "AGENTMO_OPENCLAW_OFFICIAL_RESULT_EVIDENCE_REJECTED",
  );
  const bytes = canonicalBytes(
    value,
    "openclaw-official-action-result-evidence",
  );
  const published = await createOpenClawCanonicalEvidenceRecord({
    ledger: options.ledger,
    recordKind: "official-action-result",
    attemptDigest: attempt.attemptDigest,
    actionDigest,
    bytes,
  });
  return reopenOpenClawOfficialActionResultEvidence({
    ledger: options.ledger,
    provenance: specializedProvenance(
      published,
      OPENCLAW_OFFICIAL_ACTION_RESULT_SCHEMA_VERSION,
      "openclaw-official-action-result-evidence",
      {
        attemptDigest: attempt.attemptDigest,
        actionId: options.action.actionId,
        actionDigest,
      },
    ),
    attemptId: options.attemptId,
    plan: options.plan,
    planSource: options.planSource,
    action: options.action,
    decision: options.decision,
    decisionSource: options.decisionSource,
    probe: options.probe,
    authorityReservation: options.authorityReservation,
  });
}

export async function reopenOpenClawOfficialActionResultEvidence(options = {}) {
  const optionKeys = [
    "ledger",
    "provenance",
    "attemptId",
    "plan",
    "planSource",
    "action",
    "decision",
    "decisionSource",
    "probe",
    options.authorityReservation === undefined
      ? "markerAuthority"
      : "authorityReservation",
  ];
  if (!plainObject(options)
    || !sameKeys(options, optionKeys)
    || !ATTEMPT_PATTERN.test(options.attemptId ?? "")
    || !validateOpenClawInstallPlan(options.plan).ok
    || !validMarkerAuthorityOption(options)) {
    fail("AGENTMO_OPENCLAW_EVIDENCE_BINDING_REJECTED");
  }
  const attempt = attemptBinding(options.attemptId);
  const actionDigest = digestJson(
    options.action,
    "openclaw-install-decision",
  );
  assertEvidenceProvenance(
    options.provenance,
    OPENCLAW_OFFICIAL_ACTION_RESULT_SCHEMA_VERSION,
    "openclaw-official-action-result-evidence",
    true,
  );
  if (options.provenance.attemptDigest !== attempt.attemptDigest
    || options.provenance.actionId !== options.action.actionId
    || options.provenance.actionDigest !== actionDigest) {
    fail("AGENTMO_OPENCLAW_EVIDENCE_BINDING_REJECTED");
  }
  const reopened = await reopenOpenClawCanonicalEvidenceRecord({
    ledger: options.ledger,
    recordKind: "official-action-result",
    attemptDigest: attempt.attemptDigest,
    actionDigest,
    expectedDigest: options.provenance.digest,
  });
  assertSameProvenance(options.provenance, reopened.provenance);
  const value = parseCanonical(
    reopened.bytes,
    "openclaw-official-action-result-evidence",
  );
  assertValid(
    validateOpenClawOfficialActionResultEvidence(value),
    "AGENTMO_OPENCLAW_OFFICIAL_RESULT_EVIDENCE_REJECTED",
  );
  const ledger = describeOpenClawCanonicalAuthorityLedger(options.ledger);
  const markers = await reopenEvidenceMarkers(options);
  const decisionDigest = digestJson(
    options.decision,
    "openclaw-install-decision",
  );
  if (!same(value.ledger, ledgerBinding(ledger))
    || !same(value.attempt, attempt)
    || !same(value.plan, planBinding(options.plan, options.planSource))
    || value.action.actionId !== options.action.actionId
    || value.action.actionDigest !== actionDigest
    || value.action.kind !== options.action.kind
    || value.action.scope !== options.action.scope
    || value.action.targetDigest
      !== digestBytes(Buffer.from(options.action.target, "utf8"))
    || value.decision.decisionDigest !== decisionDigest
    || value.decision.nonceDigest
      !== digestBytes(Buffer.from(options.decision.useNonce, "utf8"))
    || !same(value.decision.artifact, options.decisionSource)
    || value.marker.decisionDigest !== decisionDigest
    || value.marker.actionDigest !== actionDigest
    || markers.filter((marker) => (
      marker.family === "sensitive"
      && marker.relativeRef === value.marker.relativeRef
      && marker.digest === value.marker.digest
      && marker.decisionDigest === decisionDigest
      && marker.actionDigest === actionDigest
    )).length !== 1) {
    fail("AGENTMO_OPENCLAW_EVIDENCE_BINDING_REJECTED");
  }
  ACTION_RESULT_ADMISSIONS.add(value);
  return deepFreeze({
    value,
    provenance: structuredClone(options.provenance),
  });
}

export function validateOpenClawOfficialActionResultEvidence(value) {
  const errors = [];
  if (!plainObject(value)
    || !sameKeys(value, [
      "schemaVersion",
      "ledger",
      "attempt",
      "plan",
      "action",
      "decision",
      "marker",
      "executable",
      "invocation",
      "processGroup",
      "quiescence",
      "resultObservation",
      "rawOutputPersisted",
    ])) {
    return validation(["shape"]);
  }
  if (value.schemaVersion !== OPENCLAW_OFFICIAL_ACTION_RESULT_SCHEMA_VERSION
    || !validLedgerBinding(value.ledger)
    || !validAttempt(value.attempt)
    || !validPlanBinding(value.plan)
    || !validActionBinding(value.action)
    || !validDecisionBinding(value.decision)
    || !validMarkerBinding(value.marker, value.ledger)
    || value.marker.family !== "sensitive"
    || value.marker.actionDigest !== value.action.actionDigest
    || value.marker.decisionDigest !== value.decision.decisionDigest
    || value.marker.nonceDigest !== value.decision.nonceDigest
    || !validExecutable(value.executable)
    || !validInvocation(value.invocation)
    || !validProcessGroup(value.processGroup)
    || !validQuiescence(value.quiescence, value.processGroup)
    || !validResultObservation(value.resultObservation)
    || value.rawOutputPersisted !== false) {
    errors.push("contract");
  }
  return persistableValidation(
    value,
    errors,
    "openclaw-official-action-result-evidence",
  );
}

export function isAdmittedOpenClawOfficialActionResultEvidence(value) {
  return ACTION_RESULT_ADMISSIONS.has(value);
}

export async function publishOpenClawInstallFinalizationEvidence(
  options = {},
) {
  assertFinalizationOptions(options);
  const attempt = attemptBinding(options.attemptId);
  const ledger = describeOpenClawCanonicalAuthorityLedger(options.ledger);
  const markers = await reopenOpenClawCanonicalReservedAuthorityMarkers({
    ledger: options.ledger,
    authorityReservation: options.authorityReservation,
    plan: options.plan,
    probe: options.probe,
  });
  if (options.authorityReservation.attemptId !== options.attemptId
    || !exactMarkerOrder(markers, options.plan)) {
    fail("AGENTMO_OPENCLAW_EVIDENCE_BINDING_REJECTED");
  }
  assertAdmittedCompanions(options, attempt, ledger);
  const predecessor = options.predecessor === null
    ? null
    : structuredClone(options.predecessor.provenance);
  const chainDigest = digestJson({
    authorityId: ledger.authorityId,
    targetId: options.plan.target.targetId,
    scope: options.plan.target.scope,
    projectId: options.plan.target.projectId,
  }, "openclaw-install-finalization-chain");
  const value = {
    schemaVersion: OPENCLAW_INSTALL_FINALIZATION_SCHEMA_VERSION,
    ledger: ledgerBinding(ledger),
    chainDigest,
    predecessor,
    attempt,
    plan: planBinding(options.plan, options.planSource),
    journal: structuredClone(options.postState.value.journal),
    markers: markers.map((marker) => markerBinding(marker, ledger)),
    postState: structuredClone(options.postState.provenance),
    officialActionResults: options.actionResults.map(({ provenance }) => (
      structuredClone(provenance)
    )),
    rawOutputPersisted: false,
  };
  assertValid(
    validateOpenClawInstallFinalizationEvidence(value),
    "AGENTMO_OPENCLAW_FINALIZATION_REJECTED",
  );
  const bytes = canonicalBytes(value, "openclaw-install-finalization");
  const appended = await appendOpenClawCanonicalFinalization({
    ledger: options.ledger,
    chainDigest,
    predecessorDigest: predecessor?.digest ?? null,
    attemptDigest: attempt.attemptDigest,
    bytes,
  });
  return reopenOpenClawInstallFinalizationEvidence({
    ledger: options.ledger,
    provenance: specializedProvenance(
      appended.provenance,
      OPENCLAW_INSTALL_FINALIZATION_SCHEMA_VERSION,
      "openclaw-install-finalization",
      { attemptDigest: attempt.attemptDigest },
    ),
    attemptId: options.attemptId,
    plan: options.plan,
    planSource: options.planSource,
    postState: options.postState,
    actionResults: options.actionResults,
    predecessor: options.predecessor,
    probe: options.probe,
    authorityReservation: options.authorityReservation,
  });
}

export async function reopenOpenClawInstallFinalizationEvidence(options = {}) {
  const optionKeys = [
    "ledger",
    "provenance",
    "attemptId",
    "plan",
    "planSource",
    "postState",
    "actionResults",
    "predecessor",
    "probe",
    options.authorityReservation === undefined
      ? "markerAuthority"
      : "authorityReservation",
  ];
  if (!plainObject(options)
    || !sameKeys(options, optionKeys)
    || !ATTEMPT_PATTERN.test(options.attemptId ?? "")
    || !validateOpenClawInstallPlan(options.plan).ok
    || !Array.isArray(options.actionResults)
    || !validMarkerAuthorityOption(options)) {
    fail("AGENTMO_OPENCLAW_EVIDENCE_BINDING_REJECTED");
  }
  const attempt = attemptBinding(options.attemptId);
  assertEvidenceProvenance(
    options.provenance,
    OPENCLAW_INSTALL_FINALIZATION_SCHEMA_VERSION,
    "openclaw-install-finalization",
  );
  if (options.provenance.attemptDigest !== attempt.attemptDigest) {
    fail("AGENTMO_OPENCLAW_EVIDENCE_BINDING_REJECTED");
  }
  const initial = await reopenOpenClawCanonicalEvidenceRecord({
    ledger: options.ledger,
    recordKind: "finalization",
    attemptDigest: attempt.attemptDigest,
    actionDigest: null,
    expectedDigest: options.provenance.digest,
  });
  assertSameProvenance(options.provenance, initial.provenance);
  const value = parseCanonical(
    initial.bytes,
    "openclaw-install-finalization",
  );
  assertValid(
    validateOpenClawInstallFinalizationEvidence(value),
    "AGENTMO_OPENCLAW_FINALIZATION_REJECTED",
  );
  const ledger = describeOpenClawCanonicalAuthorityLedger(options.ledger);
  const predecessor = options.predecessor?.provenance ?? null;
  const reopened = await reopenOpenClawCanonicalFinalization({
    ledger: options.ledger,
    chainDigest: value.chainDigest,
    predecessorDigest: predecessor?.digest ?? null,
    attemptDigest: attempt.attemptDigest,
    expectedDigest: options.provenance.digest,
  });
  assertSameProvenance(options.provenance, reopened.provenance);
  const markers = await reopenEvidenceMarkers(options);
  if (!isAdmittedPostWrapper(options.postState)
    || options.actionResults.some((item) => !isAdmittedActionWrapper(item))
    || (options.predecessor !== null
      && !isAdmittedFinalizationWrapper(options.predecessor))
    || !same(value.ledger, ledgerBinding(ledger))
    || !same(value.attempt, attempt)
    || !same(value.plan, planBinding(options.plan, options.planSource))
    || !same(value.journal, options.postState.value.journal)
    || !same(value.postState, options.postState.provenance)
    || !same(
      value.officialActionResults,
      options.actionResults.map(({ provenance }) => provenance),
    )
    || !same(value.predecessor, predecessor)) {
    fail("AGENTMO_OPENCLAW_EVIDENCE_BINDING_REJECTED");
  }
  if (!same(
    value.markers,
    markers.map((marker) => markerBinding(marker, ledger)),
  )) {
    fail("AGENTMO_OPENCLAW_EVIDENCE_BINDING_REJECTED");
  }
  FINALIZATION_ADMISSIONS.add(value);
  return deepFreeze({
    value,
    provenance: structuredClone(options.provenance),
  });
}

export function validateOpenClawInstallFinalizationEvidence(value) {
  const errors = [];
  if (!plainObject(value)
    || !sameKeys(value, [
      "schemaVersion",
      "ledger",
      "chainDigest",
      "predecessor",
      "attempt",
      "plan",
      "journal",
      "markers",
      "postState",
      "officialActionResults",
      "rawOutputPersisted",
    ])) {
    return validation(["shape"]);
  }
  if (value.schemaVersion !== OPENCLAW_INSTALL_FINALIZATION_SCHEMA_VERSION
    || !validLedgerBinding(value.ledger)
    || !DIGEST_PATTERN.test(value.chainDigest ?? "")
    || !(value.predecessor === null
      || (validEvidenceProvenance(
        value.predecessor,
        OPENCLAW_INSTALL_FINALIZATION_SCHEMA_VERSION,
        "openclaw-install-finalization",
      )
        && value.predecessor.authorityId === value.ledger.authorityId
        && same(value.predecessor.rootIdentity, value.ledger.rootIdentity)))
    || !validAttempt(value.attempt)
    || !validPlanBinding(value.plan)
    || !validJournalBinding(value.journal, value.plan, value.attempt)
    || !validFinalizationMarkers(
      value.markers,
      value.officialActionResults,
      value.ledger,
    )
    || !validEvidenceProvenance(
      value.postState,
      OPENCLAW_INSTALL_POST_STATE_SCHEMA_VERSION,
      "openclaw-install-post-state",
    )
    || value.postState.attemptDigest !== value.attempt.attemptDigest
    || value.postState.authorityId !== value.ledger.authorityId
    || !same(value.postState.rootIdentity, value.ledger.rootIdentity)
    || !validActionResultProvenances(
      value.officialActionResults,
      value.attempt,
      value.ledger,
    )
    || value.rawOutputPersisted !== false) {
    errors.push("contract");
  }
  return persistableValidation(
    value,
    errors,
    "openclaw-install-finalization",
  );
}

export function isAdmittedOpenClawInstallFinalizationEvidence(value) {
  return FINALIZATION_ADMISSIONS.has(value);
}

function assertPostStateOptions(options) {
  if (!plainObject(options)
    || !sameKeys(options, [
      "ledger",
      "targetSession",
      "attemptId",
      "plan",
      "planSource",
      "journalSource",
      "targetDescriptorSource",
    ])
    || !ATTEMPT_PATTERN.test(options.attemptId ?? "")
    || !validateOpenClawInstallPlan(options.plan).ok
    || typeof options.targetSession?.observe !== "function"
    || !validRootIdentity(options.targetSession?.rootIdentity)
    || !validSource(
      options.planSource,
      "agentmo.openclaw-install-plan.v1",
      "openclaw-install-plan",
    )
    || options.planSource.digest !== digestJson(
      options.plan,
      "openclaw-install-plan",
    )
    || !validJournalSource(options.journalSource)
    || !validSource(
      options.targetDescriptorSource,
      "agentmo.openclaw-target-descriptor.v1",
      "openclaw-target-descriptor",
    )) {
    fail("AGENTMO_OPENCLAW_EVIDENCE_ARGUMENTS_REJECTED");
  }
  const ledger = describeOpenClawCanonicalAuthorityLedger(options.ledger);
  if (options.targetDescriptorSource.digest !== ledger.targetDescriptorDigest) {
    fail("AGENTMO_OPENCLAW_EVIDENCE_BINDING_REJECTED");
  }
}

function assertActionResultOptions(options) {
  if (!plainObject(options)
    || !sameKeys(options, [
      "ledger",
      "attemptId",
      "plan",
      "planSource",
      "probe",
      "action",
      "decision",
      "decisionSource",
      "authorityReservation",
      "result",
    ])
    || !ATTEMPT_PATTERN.test(options.attemptId ?? "")
    || !validateOpenClawInstallPlan(options.plan).ok
    || !options.plan.sensitiveActions.some((action) => (
      same(action, options.action)
    ))
    || !(options.action?.cwd === "."
      || portableRelative(options.action?.cwd))
    || !validateOpenClawSensitiveActionDecision(options.decision, {
      plan: options.plan,
      action: options.action,
      now: options.decision?.issuedAt,
    }).ok
    || !validSource(
      options.planSource,
      "agentmo.openclaw-install-plan.v1",
      "openclaw-install-plan",
    )
    || options.planSource.digest !== digestJson(
      options.plan,
      "openclaw-install-plan",
    )
    || !validSource(
      options.decisionSource,
      "agentmo.openclaw-sensitive-action-decision.v1",
      "openclaw-sensitive-action-decision",
    )
    || options.decisionSource.digest !== digestJson(
      options.decision,
      "openclaw-sensitive-action-decision",
    )
    || options.probe?.fingerprintDigest
      !== options.plan.target.probeFingerprintDigest
    || !DIGEST_PATTERN.test(options.probe?.cli?.executableDigest ?? "")
    || !plainObject(options.authorityReservation)) {
    fail("AGENTMO_OPENCLAW_EVIDENCE_ARGUMENTS_REJECTED");
  }
}

function assertFinalizationOptions(options) {
  if (!plainObject(options)
    || !sameKeys(options, [
      "ledger",
      "attemptId",
      "plan",
      "planSource",
      "probe",
      "authorityReservation",
      "postState",
      "actionResults",
      "predecessor",
    ])
    || !ATTEMPT_PATTERN.test(options.attemptId ?? "")
    || !validateOpenClawInstallPlan(options.plan).ok
    || !validSource(
      options.planSource,
      "agentmo.openclaw-install-plan.v1",
      "openclaw-install-plan",
    )
    || !plainObject(options.authorityReservation)
    || !isAdmittedPostWrapper(options.postState)
    || !Array.isArray(options.actionResults)
    || options.actionResults.length !== options.plan.sensitiveActions.length
    || options.actionResults.some((item) => !isAdmittedActionWrapper(item))
    || !(options.predecessor === null
      || isAdmittedFinalizationWrapper(options.predecessor))) {
    fail("AGENTMO_OPENCLAW_EVIDENCE_ARGUMENTS_REJECTED");
  }
}

function assertAdmittedCompanions(options, attempt, ledger) {
  if (!same(options.postState.value.ledger, ledgerBinding(ledger))
    || !same(options.postState.value.attempt, attempt)
    || !same(
      options.postState.value.plan,
      planBinding(options.plan, options.planSource),
    )
    || options.actionResults.some(({ value }, index) => (
      !same(value.ledger, ledgerBinding(ledger))
      || !same(value.attempt, attempt)
      || value.action.actionId
        !== options.plan.sensitiveActions[index].actionId
      || value.action.actionDigest !== digestJson(
        options.plan.sensitiveActions[index],
        "openclaw-install-decision",
      )
    ))
    || (options.predecessor !== null
      && (!same(options.predecessor.value.ledger, ledgerBinding(ledger))
        || options.predecessor.value.chainDigest !== digestJson({
          authorityId: ledger.authorityId,
          targetId: options.plan.target.targetId,
          scope: options.plan.target.scope,
          projectId: options.plan.target.projectId,
        }, "openclaw-install-finalization-chain")))) {
    fail("AGENTMO_OPENCLAW_EVIDENCE_BINDING_REJECTED");
  }
}

async function reopenEvidenceMarkers(options) {
  if (options.authorityReservation !== undefined) {
    return reopenOpenClawCanonicalReservedAuthorityMarkers({
      ledger: options.ledger,
      authorityReservation: options.authorityReservation,
      plan: options.plan,
      probe: options.probe,
    });
  }
  return reopenOpenClawCanonicalAuthorityMarkers({
    ledger: options.ledger,
    attemptId: options.attemptId,
    plan: options.plan,
    probe: options.probe,
    ordinaryApproval: options.markerAuthority.ordinaryApproval,
    sensitiveDecisions: options.markerAuthority.sensitiveDecisions,
    conflictApproval: options.markerAuthority.conflictApproval,
  });
}

function validMarkerAuthorityOption(options) {
  if (options.authorityReservation !== undefined) {
    return options.markerAuthority === undefined
      && plainObject(options.authorityReservation);
  }
  return plainObject(options.markerAuthority)
    && sameKeys(options.markerAuthority, [
      "ordinaryApproval",
      "sensitiveDecisions",
      "conflictApproval",
    ])
    && Array.isArray(options.markerAuthority.sensitiveDecisions);
}

function officialResultObservation(action, decision, probe, value) {
  if (!plainObject(value)
    || value.actionDigest !== digestJson(action, "openclaw-install-decision")
    || value.decisionDigest
      !== digestJson(decision, "openclaw-install-decision")
    || value.rawOutputPersisted !== false) {
    fail("AGENTMO_OPENCLAW_OFFICIAL_RESULT_EVIDENCE_REJECTED");
  }
  if (["failed", "not-attempted"].includes(value.disposition)) {
    if (!sameKeys(value, [
      "route",
      "disposition",
      "failureCode",
      "actionDigest",
      "decisionDigest",
      "processStarted",
      "processGroupClosed",
      "quiescenceVerified",
      "rawOutputPersisted",
    ])
      || value.route !== (action.kind === "credential"
        ? "official-openclaw-auth"
        : "official-openclaw-config-patch")
      || !REASON_PATTERN.test(value.failureCode ?? "")
      || typeof value.processStarted !== "boolean"
      || typeof value.processGroupClosed !== "boolean"
      || typeof value.quiescenceVerified !== "boolean"
      || (value.disposition === "not-attempted"
        && (value.processStarted !== false
          || value.processGroupClosed !== true
          || value.quiescenceVerified !== true))) {
      fail("AGENTMO_OPENCLAW_OFFICIAL_RESULT_EVIDENCE_REJECTED");
    }
    const facts = {
      processStarted: value.processStarted,
      processGroupClosed: value.processGroupClosed,
      quiescenceVerified: value.quiescenceVerified,
    };
    return {
      route: value.route,
      invocationDigest: null,
      processGroup: {
        dryRun: null,
        actual: facts,
      },
      quiescence: {
        disposition: value.processStarted
          ? value.quiescenceVerified ? "verified" : "unverified"
          : "not-started",
        processGroupClosed: value.processGroupClosed,
        verified: value.quiescenceVerified,
      },
      resultObservation: {
        disposition: value.disposition,
        resultDigest: null,
        failureCode: value.failureCode,
        unsupportedReason: null,
        publicationDisposition: "not-attempted",
      },
    };
  }
  if (value.route === "official-openclaw-auth") {
    if (action.kind !== "credential"
      || !sameKeys(value, [
        "route",
        "disposition",
        "unsupportedReason",
        "actionDigest",
        "decisionDigest",
        "credentialPresent",
        "processStarted",
        "rawOutputPersisted",
      ])
      || value.disposition !== "unsupported"
      || value.unsupportedReason
        !== "phase4-credential-state-proof-unavailable"
      || value.credentialPresent !== false
      || value.processStarted !== false) {
      fail("AGENTMO_OPENCLAW_OFFICIAL_RESULT_EVIDENCE_REJECTED");
    }
    return {
      route: value.route,
      invocationDigest: null,
      processGroup: {
        dryRun: null,
        actual: {
          processStarted: false,
          processGroupClosed: true,
          quiescenceVerified: true,
        },
      },
      quiescence: {
        disposition: "not-started",
        processGroupClosed: true,
        verified: true,
      },
      resultObservation: {
        disposition: "unsupported",
        resultDigest: null,
        failureCode: null,
        unsupportedReason: value.unsupportedReason,
        publicationDisposition: "not-attempted",
      },
    };
  }
  if (value.route !== "official-openclaw-config-patch"
    || value.executableDigest !== probe.cli.executableDigest
    || !plainObject(value.processGroupFacts)) {
    fail("AGENTMO_OPENCLAW_OFFICIAL_RESULT_EVIDENCE_REJECTED");
  }
  const processGroup = {
    dryRun: boundedProcessFacts(value.processGroupFacts.dryRun),
    actual: boundedProcessFacts(value.processGroupFacts.actual),
  };
  const unsupported = value.disposition === "unsupported";
  const published = value.publicationDisposition === "replaced"
    && DIGEST_PATTERN.test(value.resultDigest ?? "");
  if (!(unsupported || published)
    || (unsupported && value.unsupportedReason
      !== "platform-fd-config-transport-unavailable")) {
    fail("AGENTMO_OPENCLAW_OFFICIAL_RESULT_EVIDENCE_REJECTED");
  }
  return {
    route: value.route,
    invocationDigest: value.invocationDigest ?? null,
    processGroup,
    quiescence: {
      disposition: unsupported ? "not-started" : "verified",
      processGroupClosed:
        processGroup.dryRun.processGroupClosed
        && processGroup.actual.processGroupClosed,
      verified:
        processGroup.dryRun.quiescenceVerified
        && processGroup.actual.quiescenceVerified,
    },
    resultObservation: {
      disposition: unsupported ? "unsupported" : "published",
      resultDigest: value.resultDigest ?? null,
      failureCode: null,
      unsupportedReason: value.unsupportedReason ?? null,
      publicationDisposition: value.publicationDisposition,
    },
  };
}

function postObservation(operation, observed) {
  const operationDigest = digestJson(
    operation,
    "openclaw-managed-operation",
  );
  if (observed?.disposition === "observed"
    && DIGEST_PATTERN.test(observed.digest ?? "")
    && validObservedFileIdentity(observed)
    && validObservedParentIdentity(observed)) {
    return {
      path: operation.path,
      operationDigest,
      disposition: "observed",
      digest: observed.digest,
      fileIdentity: {
        device: observed.device,
        inode: observed.inode,
        mode: observed.mode,
        owner: observed.uid,
        size: observed.size,
      },
      parentIdentity: {
        device: observed.parentDevice,
        inode: observed.parentInode,
      },
      reasonCode: null,
    };
  }
  if (observed?.disposition === "absent"
    && validObservedParentIdentity(observed)) {
    return {
      path: operation.path,
      operationDigest,
      disposition: "absent",
      digest: null,
      fileIdentity: null,
      parentIdentity: {
        device: observed.parentDevice,
        inode: observed.parentInode,
      },
      reasonCode: null,
    };
  }
  return {
    path: operation.path,
    operationDigest,
    disposition: "unknown",
    digest: null,
    fileIdentity: null,
    parentIdentity: null,
    reasonCode: boundedReason(observed?.reason, "observation-unavailable"),
  };
}

function attemptBinding(attemptId) {
  return {
    attemptId,
    attemptDigest: digestBytes(Buffer.from(attemptId, "utf8")),
  };
}

function planBinding(plan, artifact) {
  return {
    artifact: structuredClone(artifact),
    installPlanDigest: plan.installPlanDigest,
  };
}

function journalBinding(source, plan, attempt) {
  if (plainObject(source)
    && sameKeys(source, ["artifact", "relativeRef"])) {
    return structuredClone(source);
  }
  return {
    artifact: structuredClone(source),
    relativeRef:
      `.agentmo-openclaw-install-${
        plan.installPlanDigest.slice("sha256:".length)
      }-${attempt.attemptDigest.slice("sha256:".length)}.journal.json`,
  };
}

function ledgerBinding(ledger) {
  return {
    authorityId: ledger.authorityId,
    rootIdentity: structuredClone(ledger.rootIdentity),
  };
}

function markerBinding(marker, ledger) {
  return {
    authorityId: ledger.authorityId,
    rootIdentity: structuredClone(ledger.rootIdentity),
    relativeRef: marker.relativeRef,
    digest: marker.digest,
    fileIdentity: structuredClone(marker.fileIdentity),
    family: marker.family,
    nonceDigest: marker.nonceDigest,
    decisionDigest: marker.decisionDigest,
    actionDigest: marker.actionDigest,
    conflictSetDigest: marker.conflictSetDigest,
  };
}

function specializedProvenance(base, identity, subject, extra) {
  return deepFreeze({
    identity,
    subject,
    digest: base.digest,
    authorityId: base.authorityId,
    rootIdentity: structuredClone(base.rootIdentity),
    relativeRef: base.relativeRef,
    fileIdentity: structuredClone(base.fileIdentity),
    ...extra,
  });
}

function validPostTarget(value) {
  return plainObject(value)
    && sameKeys(value, ["descriptor", "identity", "managedRootIdentity"])
    && validSource(
      value.descriptor,
      "agentmo.openclaw-target-descriptor.v1",
      "openclaw-target-descriptor",
    )
    && plainObject(value.identity)
    && validRootIdentity(value.managedRootIdentity);
}

function validPostObservations(value) {
  return Array.isArray(value)
    && value.length > 0
    && sortedUnique(value, ({ path }) => path)
    && value.every((item) => (
      plainObject(item)
      && sameKeys(item, [
        "path",
        "operationDigest",
        "disposition",
        "digest",
        "fileIdentity",
        "parentIdentity",
        "reasonCode",
      ])
      && portableRelative(item.path)
      && DIGEST_PATTERN.test(item.operationDigest ?? "")
      && ["observed", "absent", "unknown"].includes(item.disposition)
      && (item.digest === null || DIGEST_PATTERN.test(item.digest ?? ""))
      && (item.fileIdentity === null || validFileIdentity(item.fileIdentity))
      && (item.parentIdentity === null
        || validRootIdentity(item.parentIdentity))
      && (item.reasonCode === null
        || REASON_PATTERN.test(item.reasonCode ?? ""))
      && (item.disposition === "observed"
        ? item.digest !== null
          && item.fileIdentity !== null
          && item.parentIdentity !== null
          && item.reasonCode === null
        : item.disposition === "absent"
          ? item.digest === null
            && item.fileIdentity === null
            && item.parentIdentity !== null
            && item.reasonCode === null
          : item.digest === null
            && item.fileIdentity === null
            && item.parentIdentity === null
            && item.reasonCode !== null)
    ));
}

function validFinalizationMarkers(markers, results, ledger) {
  if (!Array.isArray(markers)
    || !Array.isArray(results)
    || markers.length !== results.length + 2
    || markers[0]?.family !== "ordinary"
    || markers.at(-1)?.family !== "conflict"
    || markers.slice(1, -1).some(({ family }) => family !== "sensitive")
    || markers.some((marker) => !validMarkerBinding(marker, ledger))
    || !unique(markers, ({ relativeRef }) => relativeRef)
    || !unique(markers, ({ nonceDigest }) => nonceDigest)
    || !unique(markers, ({ digest }) => digest)) {
    return false;
  }
  return markers.slice(1, -1).every((marker, index) => (
    marker.actionDigest === results[index]?.actionDigest
  ));
}

function validActionResultProvenances(values, attempt, ledger) {
  return Array.isArray(values)
    && values.every((value) => (
      validEvidenceProvenance(
        value,
        OPENCLAW_OFFICIAL_ACTION_RESULT_SCHEMA_VERSION,
        "openclaw-official-action-result-evidence",
        true,
      )
      && value.attemptDigest === attempt.attemptDigest
      && value.authorityId === ledger.authorityId
      && same(value.rootIdentity, ledger.rootIdentity)
    ))
    && sortedUnique(values, ({ actionId }) => actionId)
    && unique(values, ({ digest }) => digest)
    && unique(values, ({ actionDigest }) => actionDigest);
}

function exactMarkerOrder(markers, plan) {
  return markers.length === plan.sensitiveActions.length + 2
    && markers[0]?.family === "ordinary"
    && markers.at(-1)?.family === "conflict"
    && markers.slice(1, -1).every((marker, index) => (
      marker.family === "sensitive"
      && marker.actionDigest === digestJson(
        plan.sensitiveActions[index],
        "openclaw-install-decision",
      )
    ));
}

function validLedgerBinding(value) {
  return plainObject(value)
    && sameKeys(value, ["authorityId", "rootIdentity"])
    && DIGEST_PATTERN.test(value.authorityId ?? "")
    && validRootIdentity(value.rootIdentity);
}

function validAttempt(value) {
  return plainObject(value)
    && sameKeys(value, ["attemptId", "attemptDigest"])
    && ATTEMPT_PATTERN.test(value.attemptId ?? "")
    && value.attemptDigest
      === digestBytes(Buffer.from(value.attemptId, "utf8"));
}

function validPlanBinding(value) {
  return plainObject(value)
    && sameKeys(value, ["artifact", "installPlanDigest"])
    && validSource(
      value.artifact,
      "agentmo.openclaw-install-plan.v1",
      "openclaw-install-plan",
    )
    && DIGEST_PATTERN.test(value.installPlanDigest ?? "");
}

function validJournalBinding(value, plan, attempt) {
  return plainObject(value)
    && sameKeys(value, ["artifact", "relativeRef"])
    && validJournalSource(value.artifact)
    && value.relativeRef === `.agentmo-openclaw-install-${
      plan.installPlanDigest.slice("sha256:".length)
    }-${attempt.attemptDigest.slice("sha256:".length)}.journal.json`;
}

function validActionBinding(value) {
  return plainObject(value)
    && sameKeys(value, [
      "actionId",
      "actionDigest",
      "kind",
      "route",
      "scope",
      "targetDigest",
    ])
    && nonEmpty(value.actionId)
    && DIGEST_PATTERN.test(value.actionDigest ?? "")
    && ["credential", "external-command"].includes(value.kind)
    && [
      "official-openclaw-auth",
      "official-openclaw-config-patch",
    ].includes(value.route)
    && ["project", "user"].includes(value.scope)
    && DIGEST_PATTERN.test(value.targetDigest ?? "");
}

function validDecisionBinding(value) {
  return plainObject(value)
    && sameKeys(value, ["artifact", "decisionDigest", "nonceDigest"])
    && validSource(
      value.artifact,
      "agentmo.openclaw-sensitive-action-decision.v1",
      "openclaw-sensitive-action-decision",
    )
    && DIGEST_PATTERN.test(value.decisionDigest ?? "")
    && DIGEST_PATTERN.test(value.nonceDigest ?? "");
}

function validMarkerBinding(value, ledger) {
  return plainObject(value)
    && sameKeys(value, [
      "authorityId",
      "rootIdentity",
      "relativeRef",
      "digest",
      "fileIdentity",
      "family",
      "nonceDigest",
      "decisionDigest",
      "actionDigest",
      "conflictSetDigest",
    ])
    && value.authorityId === ledger.authorityId
    && same(value.rootIdentity, ledger.rootIdentity)
    && portableRelative(value.relativeRef)
    && DIGEST_PATTERN.test(value.digest ?? "")
    && validRootIdentity(value.fileIdentity)
    && ["ordinary", "sensitive", "conflict"].includes(value.family)
    && DIGEST_PATTERN.test(value.nonceDigest ?? "")
    && DIGEST_PATTERN.test(value.decisionDigest ?? "")
    && (value.actionDigest === null
      || DIGEST_PATTERN.test(value.actionDigest ?? ""))
    && (value.conflictSetDigest === null
      || DIGEST_PATTERN.test(value.conflictSetDigest ?? ""));
}

function validExecutable(value) {
  return plainObject(value)
    && sameKeys(value, ["name", "digest"])
    && value.name === "openclaw"
    && DIGEST_PATTERN.test(value.digest ?? "");
}

function validInvocation(value) {
  return plainObject(value)
    && sameKeys(value, [
      "argvDigest",
      "declaredDigest",
      "producerDigest",
      "cwd",
      "timeoutMs",
      "environmentNames",
    ])
    && DIGEST_PATTERN.test(value.argvDigest ?? "")
    && DIGEST_PATTERN.test(value.declaredDigest ?? "")
    && (value.producerDigest === null
      || DIGEST_PATTERN.test(value.producerDigest ?? ""))
    && (value.cwd === "." || portableRelative(value.cwd))
    && Number.isSafeInteger(value.timeoutMs)
    && value.timeoutMs > 0
    && Array.isArray(value.environmentNames)
    && sortedUniqueStrings(value.environmentNames);
}

function validProcessGroup(value) {
  return plainObject(value)
    && sameKeys(value, ["dryRun", "actual"])
    && (value.dryRun === null || validProcessFacts(value.dryRun))
    && validProcessFacts(value.actual);
}

function validProcessFacts(value) {
  return plainObject(value)
    && sameKeys(value, [
      "processStarted",
      "processGroupClosed",
      "quiescenceVerified",
    ])
    && Object.values(value).every((item) => typeof item === "boolean");
}

function validQuiescence(value, processGroup) {
  return plainObject(value)
    && sameKeys(value, [
      "disposition",
      "processGroupClosed",
      "verified",
    ])
    && ["verified", "not-started", "unverified"].includes(value.disposition)
    && typeof value.processGroupClosed === "boolean"
    && typeof value.verified === "boolean"
    && value.processGroupClosed === processGroup.actual.processGroupClosed
    && value.verified === processGroup.actual.quiescenceVerified
    && (processGroup.dryRun === null
      || (value.processGroupClosed
        === (
          processGroup.dryRun.processGroupClosed
          && processGroup.actual.processGroupClosed
        )
        && value.verified
          === (
            processGroup.dryRun.quiescenceVerified
            && processGroup.actual.quiescenceVerified
          )));
}

function validResultObservation(value) {
  return plainObject(value)
    && sameKeys(value, [
      "disposition",
      "resultDigest",
      "failureCode",
      "unsupportedReason",
      "publicationDisposition",
    ])
    && [
      "published",
      "failed",
      "unsupported",
      "not-attempted",
    ].includes(value.disposition)
    && (value.resultDigest === null
      || DIGEST_PATTERN.test(value.resultDigest ?? ""))
    && (value.failureCode === null
      || REASON_PATTERN.test(value.failureCode ?? ""))
    && (value.unsupportedReason === null
      || REASON_PATTERN.test(value.unsupportedReason ?? ""))
    && ["replaced", "not-attempted"].includes(
      value.publicationDisposition,
    )
    && (value.disposition === "published"
      ? value.resultDigest !== null
        && value.failureCode === null
        && value.unsupportedReason === null
        && value.publicationDisposition === "replaced"
      : value.disposition === "unsupported"
        ? value.resultDigest === null
        && value.failureCode === null
        && value.unsupportedReason !== null
        && value.publicationDisposition === "not-attempted"
        : value.resultDigest === null
          && value.failureCode !== null
          && value.unsupportedReason === null
          && value.publicationDisposition === "not-attempted");
}

function validEvidenceProvenance(value, identity, subject, action = false) {
  const keys = [
    "identity",
    "subject",
    "digest",
    "authorityId",
    "rootIdentity",
    "relativeRef",
    "fileIdentity",
    "attemptDigest",
    ...(action ? ["actionId", "actionDigest"] : []),
  ];
  return plainObject(value)
    && sameKeys(value, keys)
    && value.identity === identity
    && value.subject === subject
    && DIGEST_PATTERN.test(value.digest ?? "")
    && DIGEST_PATTERN.test(value.authorityId ?? "")
    && validRootIdentity(value.rootIdentity)
    && portableRelative(value.relativeRef)
    && validRootIdentity(value.fileIdentity)
    && DIGEST_PATTERN.test(value.attemptDigest ?? "")
    && (!action
      || (nonEmpty(value.actionId)
        && DIGEST_PATTERN.test(value.actionDigest ?? "")));
}

function assertEvidenceProvenance(value, identity, subject, action = false) {
  if (!validEvidenceProvenance(value, identity, subject, action)) {
    fail("AGENTMO_OPENCLAW_EVIDENCE_BINDING_REJECTED");
  }
}

function validSource(value, identity, subject) {
  return plainObject(value)
    && sameKeys(value, ["identity", "subject", "digest"])
    && value.identity === identity
    && value.subject === subject
    && DIGEST_PATTERN.test(value.digest ?? "");
}

function validJournalSource(value) {
  return validSource(
    value,
    "agentmo.openclaw-install-private-journal.v1",
    "openclaw-install-private-journal",
  );
}

function validRootIdentity(value) {
  return plainObject(value)
    && sameKeys(value, ["device", "inode"])
    && /^\d+$/u.test(value.device ?? "")
    && /^\d+$/u.test(value.inode ?? "");
}

function validFileIdentity(value) {
  return plainObject(value)
    && sameKeys(value, ["device", "inode", "mode", "owner", "size"])
    && ["device", "inode", "owner", "size"].every(
      (key) => /^\d+$/u.test(value[key] ?? ""),
    )
    && /^[0-7]{3,4}$/u.test(value.mode ?? "");
}

function validObservedFileIdentity(value) {
  return [value.device, value.inode, value.uid, value.size].every(
    (item) => /^\d+$/u.test(item ?? ""),
  ) && /^[0-7]{3,4}$/u.test(value.mode ?? "");
}

function validObservedParentIdentity(value) {
  return [value.parentDevice, value.parentInode].every(
    (item) => /^\d+$/u.test(item ?? ""),
  );
}

function boundedProcessFacts(value) {
  if (!validProcessFacts(value)) {
    fail("AGENTMO_OPENCLAW_OFFICIAL_RESULT_EVIDENCE_REJECTED");
  }
  return {
    processStarted: value.processStarted,
    processGroupClosed: value.processGroupClosed,
    quiescenceVerified: value.quiescenceVerified,
  };
}

function isAdmittedPostWrapper(value) {
  return plainObject(value)
    && sameKeys(value, ["value", "provenance"])
    && POST_STATE_ADMISSIONS.has(value.value)
    && validEvidenceProvenance(
      value.provenance,
      OPENCLAW_INSTALL_POST_STATE_SCHEMA_VERSION,
      "openclaw-install-post-state",
    );
}

function isAdmittedActionWrapper(value) {
  return plainObject(value)
    && sameKeys(value, ["value", "provenance"])
    && ACTION_RESULT_ADMISSIONS.has(value.value)
    && validEvidenceProvenance(
      value.provenance,
      OPENCLAW_OFFICIAL_ACTION_RESULT_SCHEMA_VERSION,
      "openclaw-official-action-result-evidence",
      true,
    );
}

function isAdmittedFinalizationWrapper(value) {
  return plainObject(value)
    && sameKeys(value, ["value", "provenance"])
    && FINALIZATION_ADMISSIONS.has(value.value)
    && validEvidenceProvenance(
      value.provenance,
      OPENCLAW_INSTALL_FINALIZATION_SCHEMA_VERSION,
      "openclaw-install-finalization",
    );
}

function assertSameProvenance(expected, actual) {
  for (const key of [
    "digest",
    "authorityId",
    "rootIdentity",
    "relativeRef",
    "fileIdentity",
  ]) {
    if (!same(expected[key], actual[key])) {
      fail("AGENTMO_OPENCLAW_EVIDENCE_BINDING_REJECTED");
    }
  }
}

function parseCanonical(bytes, subject) {
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail("AGENTMO_OPENCLAW_EVIDENCE_REJECTED");
  }
  if (!canonicalBytes(value, subject).equals(bytes)) {
    fail("AGENTMO_OPENCLAW_EVIDENCE_REJECTED");
  }
  return value;
}

function canonicalBytes(value, subject) {
  return Buffer.from(serializePersistableJson(value, { subject }), "utf8");
}

function persistableValidation(value, errors, subject) {
  if (errors.length === 0) {
    try {
      assertPersistable(value, { subject });
    } catch {
      errors.push("persistability");
    }
  }
  return validation(errors);
}

function validation(errors) {
  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze([...new Set(errors)].sort()),
  });
}

function assertValid(result, code) {
  if (!result.ok) fail(code);
}

function comparePath(left, right) {
  return Buffer.from(left.path).compare(Buffer.from(right.path));
}

function sortedUnique(value, select) {
  return Array.isArray(value)
    && value.every((item, index) => (
      index === 0
      || Buffer.from(select(item)).compare(
        Buffer.from(select(value[index - 1])),
      ) > 0
    ));
}

function unique(value, select) {
  return new Set(value.map(select)).size === value.length;
}

function sortedUniqueStrings(value) {
  return Array.isArray(value)
    && value.every((item) => typeof item === "string")
    && sortedUnique(value, (item) => item);
}

function portableRelative(value) {
  return typeof value === "string"
    && value.length > 0
    && !value.includes("\0")
    && !value.includes("\\")
    && !value.startsWith("/")
    && value.split("/").every((part) => (
      part.length > 0 && part !== "." && part !== ".."
    ));
}

function boundedReason(value, fallback) {
  const candidate = typeof value === "string"
    ? value.toLowerCase().replace(/[^a-z0-9-]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
    : "";
  return REASON_PATTERN.test(candidate) ? candidate : fallback;
}

function digestJson(value, subject) {
  return digestBytes(canonicalBytes(value, subject));
}

function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function same(left, right) {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function sameKeys(value, keys) {
  return plainObject(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function plainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype
      || Object.getPrototypeOf(value) === null);
}

function nonEmpty(value) {
  return typeof value === "string" && value.length > 0;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  if (ArrayBuffer.isView(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function fail(code) {
  throw new OpenClawInstallEvidenceError(code);
}
