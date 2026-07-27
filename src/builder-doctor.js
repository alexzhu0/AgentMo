import { constants as FS_CONSTANTS } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { digestRawBytes } from "./artifact-admission.js";
import {
  DEFAULT_MAX_BUILDER_CHECKPOINT_BYTES,
  loadBuilderCheckpoint,
} from "./builder-checkpoint.js";
import {
  digestCodexConsumerLedger,
  digestCodexSelectorOwnerRecord,
  observeCodexHost,
  readCodexSelectorState,
} from "./builder-codex-host.js";
import {
  BUILDER_ACTIVATED_RECEIPT_SCHEMA_VERSION,
  BUILDER_CHECKPOINT_PATH,
  BUILDER_INSTALL_MARKER_PATH,
  BUILDER_INSTALL_MARKER_SCHEMA_VERSION,
  BUILDER_INSTALL_RECEIPT_PATH,
  BUILDER_INSTALL_RECEIPT_SCHEMA_VERSION,
  BUILDER_PROJECT_AGENT_PATH,
  buildBuilderInstallPlanBasis,
  buildBuilderManagedFiles,
  computeBuilderProjectScopeDigest,
} from "./builder-install.js";
import { loadImmutableJournal } from "./builder-immutable-journal.js";
import { admitBuilderLifecycleSelection } from "./builder-lifecycle.js";
import { inspectBuilderPackageForDiagnostics } from "./builder-package.js";
import {
  assertBuilderPlatform,
  BUILDER_SUPPORTED_PLATFORMS,
  inspectBuilderPlatform,
} from "./builder-platform.js";
import { assertPersistable, serializePersistableJson } from "./persistability.js";

export { BUILDER_SUPPORTED_PLATFORMS, inspectBuilderPlatform };

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/u;
const MAX_DOCTOR_FILE_BYTES = 256 * 1024;
const OWNERSHIP = new Set([
  "exclusive-marker",
  "exclusive-project-agent",
]);
const EXPECTED_MANAGED_PATHS = Object.freeze([
  BUILDER_INSTALL_MARKER_PATH,
  BUILDER_PROJECT_AGENT_PATH,
].sort());
export async function diagnoseBuilderInstall(options = {}) {
  assertDoctorBuilderPlatform();
  if (!hasOnlyKeys(options, ["projectRoot", "probe", "packageOptions", "observeHost"])) {
    throw doctorError("AGENTMO_BUILDER_DOCTOR_REQUEST_REJECTED");
  }
  const platform = inspectBuilderPlatform();
  const projectRoot = await admitDoctorRoot(options.projectRoot ?? process.cwd());
  const inspect = (relativePath, admittedIdentity = null) => inspectProjectFile(
    projectRoot,
    relativePath,
    { admittedIdentity },
  );
  const scopeDigest = await computeBuilderProjectScopeDigest(projectRoot);
  const capabilities = normalizeCapabilities(options.probe);
  const lifecycleProjection = await admitDoctorLifecycleProjection(projectRoot);
  const receiptObservation = lifecycleProjection.receiptObservation;
  const receiptResult = parseReceipt(receiptObservation);
  const observedReceiptDigest = lifecycleProjection.admission?.receiptDigest
    ?? (receiptObservation.status === "file" ? digestRawBytes(receiptObservation.bytes) : null);
  const packageInspection = await inspectBuilderPackageForDiagnostics({
    projectRoot,
    packageOptions: lifecycleProjection.admission !== null
      && lifecycleProjection.admission.packageRoot !== null
      ? {
          packageRoot: lifecycleProjection.admission.packageRoot,
          projectRoot,
          expectedReceiptDigest: lifecycleProjection.admission.receiptDigest,
          immutableLifecycleSelection: true,
        }
      : options.packageOptions,
    ...(lifecycleProjection.admission === null ? {} : {
      expectedReceiptDigest: lifecycleProjection.admission.receiptDigest,
    }),
  });
  const release = packageInspection.candidate;

  const projectedIdentity = lifecycleProjection.admission?.release
    ?? (receiptResult.status === "valid" ? receiptResult.value.identity : null);
  const releaseMatch = projectedIdentity !== null && release !== null
    && projectedIdentity.name === release.name
    && projectedIdentity.version === release.version
    && projectedIdentity.adapterId === release.adapterId
    && projectedIdentity.releaseDigest === release.observedReleaseDigest;
  const scopeMatch = receiptResult.status === "valid"
    && receiptResult.value.scopeDigest === scopeDigest;
  const diagnosticManagedFiles = receiptResult.status === "valid" && release !== null
    && lifecycleProjection.admission?.legacyGenesis !== false
    ? buildBuilderManagedFiles(
        diagnosticCandidateAsManifestRelease(release),
        receiptResult.value.capabilitySnapshot,
        scopeDigest,
      )
    : lifecycleProjection.admission?.legacyGenesis === false
      ? receiptResult.value.files
      : null;
  const manifestMatch = lifecycleProjection.admission?.legacyGenesis === false
    ? true
    : receiptResult.status === "valid"
    && diagnosticManagedFiles !== null
    && sameManagedManifest(receiptResult.value.files, diagnosticManagedFiles);

  const fileObservations = [];
  if (receiptResult.status === "valid") {
    const comparisonFiles = packageInspection.source === "self-contained" && diagnosticManagedFiles !== null
      ? diagnosticManagedFiles
      : receiptResult.value.files;
    for (const entry of comparisonFiles) {
      const admittedFile = lifecycleProjection.admission?.genesisFiles.find(
        (item) => item.relativePath === entry.relativePath,
      );
      const observation = await inspect(entry.relativePath, admittedFile?.currentIdentity ?? null);
      fileObservations.push({
        relativePath: entry.relativePath,
        status: fileStatus(observation, entry.destinationDigest),
      });
    }
  } else {
    for (const relativePath of EXPECTED_MANAGED_PATHS) {
      const observation = await inspect(relativePath);
      fileObservations.push({
        relativePath,
        status: observation.status === "missing" ? "missing" : "unowned-present",
      });
    }
  }
  const marker = await diagnoseMarker(
    projectRoot,
    receiptResult.status === "valid" ? receiptResult.value : null,
    fileObservations,
    lifecycleProjection.admission?.genesisFiles.find(
      (item) => item.relativePath === BUILDER_INSTALL_MARKER_PATH,
    )?.currentIdentity ?? null,
  );
  const lifecycleStable = await revalidateDoctorLifecycleProjection(
    projectRoot,
    lifecycleProjection.admission,
  );
  const receiptStatus = receiptResult.status === "valid"
    && (!scopeMatch || (releaseMatch && !manifestMatch) || !lifecycleStable)
    ? "corrupt"
    : receiptResult.status;
  const receiptDigest = receiptStatus === "valid" ? observedReceiptDigest : null;
  const visibility = await diagnoseVisibility(
    projectRoot,
    receiptResult.status === "valid" ? receiptResult.value : null,
    fileObservations,
  );
  const activation = await diagnoseCodexActivation({
    projectRoot,
    receipt: receiptResult.status === "valid" ? receiptResult.value : null,
    release,
    observeHostRequested: options.observeHost === true,
  });
  const checkpoint = await diagnoseCheckpoint(
    projectRoot,
    receiptDigest,
    lifecycleProjection.admission?.receiptLineageDigests ?? [],
  );
  const projectionIssue = receiptStatus !== "valid"
    || packageInspection.status !== "observed"
    || !releaseMatch
    || marker.status !== "matching"
    || fileObservations.some((item) => item.status !== "pristine")
    || visibility.marketplace !== "user-host-unverified"
    || visibility.plugin !== "user-host-unverified"
    || visibility.skill !== "user-host-unverified"
    || visibility.hook !== "user-host-unverified"
    || visibility.agent !== "declared"
    || ["corrupt", "receipt-mismatch", "recovery-required", "unsafe"].includes(
      checkpoint.status,
    );
  const residualPresent = fileObservations.some((item) => item.status !== "missing");
  const projectionStatus = receiptStatus === "missing" && !residualPresent
    ? "missing"
    : projectionIssue
      ? "inconsistent"
      : "pristine";
  const activatedReceipt = lifecycleProjection.admission?.legacyGenesis !== false
    && receiptResult.status === "valid"
    && receiptResult.value.schemaVersion === BUILDER_ACTIVATED_RECEIPT_SCHEMA_VERSION;
  const structuralIssue = projectionIssue || (activatedReceipt && !activation.consistent);
  const status = receiptStatus === "missing" && !residualPresent
    ? "not-projected"
    : structuralIssue
      ? "inconsistent"
      : activatedReceipt
        ? "activation-pending-trust"
        : capabilities.requiredOk
          ? "declared"
          : "degraded";
  const agent = buildAgentDiagnosis({
    projectionStatus,
    activatedReceipt,
    hostVisibility: activation.hostVisibility,
  });
  const remediation = remediationCodes({
    receiptStatus,
    managedPathOwnershipAdmitted: receiptResult.status === "valid"
      && scopeMatch
      && releaseMatch
      && manifestMatch,
    residualPresent,
    releaseMatch,
    markerStatus: marker.status,
    fileObservations,
    visibility,
    checkpoint,
    capabilities,
    activatedReceipt,
    activation,
  });

  const report = {
    schemaVersion: "agentmo.builder-doctor.v1",
    status,
    platform,
    scope: "project",
    mutatesHost: options.probe?.mutatesHost === "unknown" ? "unknown" : activation.mutatesHost,
    repairsApplied: false,
    release: {
      current: release === null
        ? null
        : { name: release.name, version: release.version, digest: release.observedReleaseDigest },
      projected: projectedIdentity === null
        ? null
        : {
            name: projectedIdentity.name,
            version: projectedIdentity.version,
            digest: projectedIdentity.releaseDigest,
          },
      match: releaseMatch,
      inspection: {
        source: packageInspection.source,
        status: packageInspection.status,
        diagnosticOnly: true,
        trustAnchorVerified: false,
        supportCertified: false,
      },
    },
    capabilities,
    projection: {
      status: projectionStatus,
      receipt: receiptStatus,
      marker: marker.status,
    },
    receipt: {
      status: receiptStatus,
      digest: receiptDigest,
      path: lifecycleProjection.admission?.receiptPath ?? BUILDER_INSTALL_RECEIPT_PATH,
      scopeMatch: receiptResult.status === "valid" ? scopeMatch : null,
      manifestMatch: receiptResult.status === "valid" ? manifestMatch : null,
    },
    marker,
    files: fileObservations,
    visibility,
    host: activation.host,
    ownership: activation.ownership,
    agent,
    checkpoint,
    evidence: {
      projection: projectionStatus === "pristine" ? "declared" : "unverified",
      host: activation.observed
        ? "observed"
        : activation.attempted
          ? "unavailable"
          : capabilities.observationLevel,
      behavior: "unverified",
      mechanismOnly: true,
      packageTrustVerified: false,
      // A local receipt and external PATH-selected observations can establish
      // bounded mechanism consistency, never an independent Codex trust anchor.
      codexActivationVerified: false,
      hostBehaviorVerified: false,
      domainQualityCertified: false,
      supportCertified: false,
    },
    remediation,
  };
  assertPersistable(report, { subject: "builder-doctor" });
  return deepFreeze(report);
}

async function admitDoctorLifecycleProjection(projectRoot) {
  // These bytes only supply the digest required by lifecycle admission. A
  // two-link candidate is never diagnostic evidence until the install
  // authority proves its exact retained-stage twin below.
  let admission;
  try {
    admission = await admitBuilderLifecycleSelection({ projectRoot });
  } catch {
    admission = null;
  }
  const candidate = await inspectProjectFile(
    projectRoot,
    BUILDER_INSTALL_RECEIPT_PATH,
    { allowProvisionalTwin: true },
  );
  if (candidate.status !== "file") {
    return { admission: null, receiptObservation: candidate };
  }
  if (admission === null
    || digestRawBytes(candidate.bytes) !== admission.genesisReceiptDigest) {
    return { admission: null, receiptObservation: candidate };
  }
  const receiptObservation = await inspectProjectFile(
    projectRoot,
    BUILDER_INSTALL_RECEIPT_PATH,
    { admittedIdentity: admission.genesisReceiptIdentity },
  );
  return { admission, receiptObservation };
}

async function revalidateDoctorLifecycleProjection(projectRoot, admission) {
  if (admission === null) return false;
  try {
    const current = await admitBuilderLifecycleSelection({
      projectRoot,
      expectedReceiptDigest: admission.receiptDigest,
    });
    return sameLifecycleAdmission(admission, current);
  } catch {
    return false;
  }
}

function sameLifecycleAdmission(left, right) {
  const basis = (value) => ({
    projectRoot: value.projectRoot,
    scopeDigest: value.scopeDigest,
    receiptDigest: value.receiptDigest,
    receiptPath: value.receiptPath,
    lifecycleHeadDigest: value.lifecycleHeadDigest,
    release: value.release,
    receiptIdentity: value.receiptIdentity,
    files: value.files,
    genesisFiles: value.genesisFiles,
  });
  return JSON.stringify(basis(left)) === JSON.stringify(basis(right));
}

function parseReceipt(observation) {
  if (observation.status === "missing") return { status: "missing", value: null };
  if (observation.status !== "file") return { status: "corrupt", value: null };
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(observation.bytes));
    validateReceipt(value, observation.bytes);
  } catch {
    return { status: "corrupt", value: null };
  }
  return { status: "valid", value };
}

function sameManagedManifest(receiptFiles, expectedFiles) {
  const expected = expectedFiles.map(({
    relativePath,
    sourceDigest,
    destinationDigest,
    ownership,
  }) => ({ relativePath, sourceDigest, destinationDigest, ownership }));
  return JSON.stringify(receiptFiles) === JSON.stringify(expected);
}

function diagnosticCandidateAsManifestRelease(candidate) {
  return {
    name: candidate.name,
    version: candidate.version,
    adapterId: candidate.adapterId,
    releaseDigest: candidate.observedReleaseDigest,
    assets: candidate.assetObservations.map((asset) => ({
      kind: asset.kind,
      sourcePath: asset.sourcePath,
      relativePath: asset.relativePath,
      destinationPath: asset.destinationPath,
      digest: asset.observedDigest,
      byteLength: asset.observedByteLength,
      bytes: Buffer.alloc(0),
    })),
  };
}

function validateReceipt(receipt, bytes) {
  const activated = receipt?.schemaVersion === BUILDER_ACTIVATED_RECEIPT_SCHEMA_VERSION
    && receipt?.status === "activated";
  const receiptKeys = [
    "schemaVersion",
    "status",
    "scope",
    "scopeDigest",
    "identity",
    "planDigest",
    "capabilitySnapshot",
    "markerPath",
    "receiptPath",
    "checkpoint",
    "files",
    "evidence",
    ...(activated ? ["hostActivation"] : []),
  ];
  if (!hasExactKeys(receipt, receiptKeys)) throw new Error("invalid receipt");
  if (
    (!activated && (
      receipt.schemaVersion !== BUILDER_INSTALL_RECEIPT_SCHEMA_VERSION
      || receipt.status !== "projected"
    ))
    || receipt.scope !== "project"
    || !DIGEST_PATTERN.test(receipt.scopeDigest ?? "")
    || receipt.markerPath !== BUILDER_INSTALL_MARKER_PATH
    || receipt.receiptPath !== BUILDER_INSTALL_RECEIPT_PATH
    || !DIGEST_PATTERN.test(receipt.planDigest ?? "")
  ) throw new Error("invalid receipt");
  if (!hasExactKeys(receipt.identity, ["name", "version", "adapterId", "releaseDigest"])) {
    throw new Error("invalid receipt");
  }
  if (
    receipt.identity.name !== "agentmo"
    || receipt.identity.adapterId !== "codex"
    || typeof receipt.identity.version !== "string"
    || !DIGEST_PATTERN.test(receipt.identity.releaseDigest ?? "")
  ) throw new Error("invalid receipt");
  validateCapabilitySnapshot(receipt.capabilitySnapshot);
  if (!hasExactKeys(receipt.checkpoint, ["path", "authority", "initialized"])) {
    throw new Error("invalid receipt");
  }
  if (
    receipt.checkpoint.path !== BUILDER_CHECKPOINT_PATH
    || receipt.checkpoint.authority !== "agentmo-checkpoint"
    || receipt.checkpoint.initialized !== false
  ) throw new Error("invalid receipt");
  if (!hasExactKeys(receipt.evidence, [
    "level",
    "mechanismOnly",
    "codexActivationVerified",
    "hostBehaviorVerified",
    "domainQualityCertified",
  ])) {
    throw new Error("invalid receipt");
  }
  if (
    receipt.evidence.level !== (activated ? "host-observed" : "declared-ready")
    || receipt.evidence.mechanismOnly !== true
    || receipt.evidence.codexActivationVerified !== false
    || receipt.evidence.hostBehaviorVerified !== false
    || receipt.evidence.domainQualityCertified !== false
  ) throw new Error("invalid receipt");
  if (activated) validateHostActivationBinding(receipt.hostActivation, receipt);
  if (!Array.isArray(receipt.files) || receipt.files.length !== EXPECTED_MANAGED_PATHS.length) {
    throw new Error("invalid receipt");
  }
  const paths = [];
  for (const entry of receipt.files) {
    if (!hasExactKeys(entry, ["relativePath", "sourceDigest", "destinationDigest", "ownership"])) {
      throw new Error("invalid receipt");
    }
    if (
      !portableRelativePath(entry.relativePath)
      || !DIGEST_PATTERN.test(entry.sourceDigest ?? "")
      || !DIGEST_PATTERN.test(entry.destinationDigest ?? "")
      || !OWNERSHIP.has(entry.ownership)
    ) throw new Error("invalid receipt");
    paths.push(entry.relativePath);
  }
  if (new Set(paths).size !== paths.length || paths.some((item, index) => item !== EXPECTED_MANAGED_PATHS[index])) {
    throw new Error("invalid receipt");
  }
  const planBasis = buildBuilderInstallPlanBasis({
    release: {
      name: receipt.identity.name,
      version: receipt.identity.version,
      releaseDigest: receipt.identity.releaseDigest,
    },
    capabilitySnapshot: receipt.capabilitySnapshot,
    scopeDigest: receipt.scopeDigest,
    managedFiles: receipt.files,
  });
  if (digestJson(planBasis, "builder-install-plan-basis") !== receipt.planDigest) {
    throw new Error("invalid receipt");
  }
  const canonical = Buffer.from(serializePersistableJson(receipt, { subject: "builder-install-receipt" }), "utf8");
  if (!canonical.equals(bytes)) throw new Error("invalid receipt");
}

function validateHostActivationBinding(binding, receipt) {
  if (!hasExactKeys(binding, [
    "schemaVersion",
    "hostScope",
    "selector",
    "releaseDigest",
    "marketplaceProjectionDigest",
    "operationOrderDigest",
    "ownerDisposition",
    "ownerRecordDigest",
    "consumerId",
    "consumerEntryDigest",
    "consumerLedgerDigest",
    "consumerEntryOwned",
    "selectorDeletionAuthority",
    "expectedPostObservation",
    "finalProjectionBinding",
  ])) throw new Error("invalid activation binding");
  if (
    binding.schemaVersion !== "agentmo.builder-codex-activation-binding.v3"
    || binding.hostScope !== "user"
    || binding.releaseDigest !== receipt.identity.releaseDigest
    || !DIGEST_PATTERN.test(binding.marketplaceProjectionDigest ?? "")
    || !DIGEST_PATTERN.test(binding.operationOrderDigest ?? "")
    || binding.consumerId !== receipt.scopeDigest
    || !DIGEST_PATTERN.test(binding.ownerRecordDigest ?? "")
    || !DIGEST_PATTERN.test(binding.consumerEntryDigest ?? "")
    || !DIGEST_PATTERN.test(binding.consumerLedgerDigest ?? "")
    || !["created-by-agentmo", "preexisting-unowned"].includes(binding.ownerDisposition)
    || binding.consumerEntryOwned !== true
    || binding.selectorDeletionAuthority !== false
    || !hasExactKeys(binding.selector, ["pluginId", "pluginName", "marketplaceName"])
    || binding.selector.pluginId !== "agentmo@agentmo-local"
    || binding.selector.pluginName !== "agentmo"
    || binding.selector.marketplaceName !== "agentmo-local"
  ) throw new Error("invalid activation binding");
  validateFinalProjectionBinding(binding.finalProjectionBinding, binding);
  const expected = binding.expectedPostObservation;
  if (!hasExactKeys(expected, [
    "installation", "enabled", "sourceMatch", "releaseMatch", "skillVisibility",
    "hooksVisibility", "trust", "agentHostVisibility",
  ])
    || expected.installation !== "installed"
    || expected.enabled !== true
    || expected.sourceMatch !== true
    || expected.releaseMatch !== true
    || expected.skillVisibility !== "visible"
    || expected.hooksVisibility !== "visible"
    || expected.trust !== "trusted-or-pending-human"
    || expected.agentHostVisibility !== "unobservable") {
    throw new Error("invalid activation binding");
  }
}

function validateFinalProjectionBinding(value, activation) {
  if (!hasExactKeys(value, [
    "schemaVersion",
    "transactionId",
    "transactionDigest",
    "releaseDigest",
    "contentDigest",
    "rootIdentity",
    "rootIdentityDigest",
    "members",
  ])
    || value.schemaVersion !== "agentmo.codex-marketplace-projection-binding.v1"
    || !/^[a-f0-9]{64}$/u.test(value.transactionId ?? "")
    || value.transactionId !== value.transactionDigest?.slice("sha256:".length)
    || !DIGEST_PATTERN.test(value.transactionDigest ?? "")
    || value.releaseDigest !== activation.releaseDigest
    || value.contentDigest !== activation.marketplaceProjectionDigest
    || !validProjectionIdentity(value.rootIdentity)
    || value.rootIdentityDigest !== digestJson({
      schemaVersion: "agentmo.codex-marketplace-root-identity.v1",
      ...value.rootIdentity,
    }, "codex-marketplace-root-identity")
    || !Array.isArray(value.members)
    || value.members.length === 0) {
    throw new Error("invalid activation binding");
  }
  for (const [index, member] of value.members.entries()) {
    if (!hasExactKeys(member, ["kind", "relativePath", "digest", "identity"])
      || !["root", "directory", "file"].includes(member.kind)
      || (index === 0
        ? member.kind !== "root" || member.relativePath !== ""
        : member.kind === "root" || !portableRelativePath(member.relativePath))
      || (member.kind === "file"
        ? !DIGEST_PATTERN.test(member.digest ?? "")
        : member.digest !== null)
      || !validProjectionIdentity(member.identity)) {
      throw new Error("invalid activation binding");
    }
  }
  if (JSON.stringify(value.members[0].identity) !== JSON.stringify(value.rootIdentity)) {
    throw new Error("invalid activation binding");
  }
}

function validProjectionIdentity(value) {
  return hasExactKeys(value, [
    "device", "group", "inode", "links", "mode", "owner", "size",
  ])
    && ["device", "group", "inode", "links", "owner", "size"]
      .every((key) => /^\d+$/u.test(value[key] ?? ""))
    && /^[0-7]{3,4}$/u.test(value.mode ?? "");
}

function validateCapabilitySnapshot(snapshot) {
  if (!hasExactKeys(snapshot, [
    "schemaVersion",
    "adapterId",
    "hostVersion",
    "evidenceLevel",
    "mutatesHost",
    "externalCommandMutation",
    "required",
    "optional",
    "digest",
  ])) throw new Error("invalid snapshot");
  if (
    snapshot.schemaVersion !== "agentmo.builder-capability-snapshot.v1"
    || snapshot.adapterId !== "codex"
    || typeof snapshot.hostVersion !== "string"
    || snapshot.hostVersion.length > 64
    || snapshot.evidenceLevel !== "observed"
    || snapshot.mutatesHost !== "unknown"
    || snapshot.externalCommandMutation !== "unknown"
    || !DIGEST_PATTERN.test(snapshot.digest ?? "")
  ) throw new Error("invalid snapshot");
  validateCapabilityItems(snapshot.required, new Set(["observed"]), true);
  validateCapabilityItems(snapshot.optional, new Set(["observed", "degraded"]), false);
  const { digest, ...basis } = snapshot;
  if (digestJson(basis, "builder-capability-snapshot") !== digest) throw new Error("invalid snapshot");
}

function validateCapabilityItems(items, statuses, required) {
  if (!Array.isArray(items) || items.length > 64 || (required && items.length === 0)) {
    throw new Error("invalid capability items");
  }
  let previous = null;
  for (const item of items) {
    if (
      !hasExactKeys(item, ["id", "status"])
      || !ID_PATTERN.test(item.id ?? "")
      || !statuses.has(item.status)
      || (previous !== null && previous >= item.id)
    ) throw new Error("invalid capability items");
    previous = item.id;
  }
}

async function diagnoseMarker(
  projectRoot,
  receipt,
  files,
  admittedIdentity = null,
) {
  const file = files.find((item) => item.relativePath === BUILDER_INSTALL_MARKER_PATH);
  if (file?.status !== "pristine" || receipt === null) {
    return { path: BUILDER_INSTALL_MARKER_PATH, status: file?.status ?? "missing" };
  }
  const observation = await inspectProjectFile(
    projectRoot,
    BUILDER_INSTALL_MARKER_PATH,
    { admittedIdentity },
  );
  try {
    const marker = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(observation.bytes));
    if (!hasExactKeys(marker, [
      "schemaVersion",
      "identity",
      "scope",
      "scopeDigest",
      "receiptPath",
      "checkpointPath",
      "capabilityDigest",
      "projectionStatus",
      "selfCertifying",
    ])) throw new Error("invalid marker");
    if (
      marker.schemaVersion !== BUILDER_INSTALL_MARKER_SCHEMA_VERSION
      || marker.scope !== "project"
      || marker.scopeDigest !== receipt.scopeDigest
      || marker.receiptPath !== BUILDER_INSTALL_RECEIPT_PATH
      || marker.checkpointPath !== BUILDER_CHECKPOINT_PATH
      || marker.capabilityDigest !== receipt.capabilitySnapshot.digest
      || marker.projectionStatus !== "receipt-required"
      || marker.selfCertifying !== false
      || JSON.stringify(marker.identity) !== JSON.stringify(receipt.identity)
    ) throw new Error("invalid marker");
    return { path: BUILDER_INSTALL_MARKER_PATH, status: "matching" };
  } catch {
    return { path: BUILDER_INSTALL_MARKER_PATH, status: "mismatched" };
  }
}

async function diagnoseVisibility(projectRoot, receipt, files) {
  const statusFor = (relativePath) => files.find((item) => item.relativePath === relativePath)?.status ?? "missing";
  const declaredStatus = (relativePath, declared) => {
    const status = statusFor(relativePath);
    if (status === "missing") return "missing";
    return status === "pristine" ? declared : "inconsistent";
  };
  const marketplace = receipt === null ? "missing" : "user-host-unverified";
  const plugin = receipt === null ? "missing" : "user-host-unverified";
  const skill = receipt === null ? "missing" : "user-host-unverified";
  const hook = receipt === null ? "missing" : "user-host-unverified";
  const agent = declaredStatus(BUILDER_PROJECT_AGENT_PATH, "declared");
  return {
    marketplace,
    plugin,
    skill,
    hook,
    agent,
    activation: "unverified",
    freshSessionBehavior: "unverified",
  };
}

async function diagnoseCodexActivation({
  projectRoot,
  receipt,
  release,
  observeHostRequested,
}) {
  const activatedReceipt = receipt?.schemaVersion === BUILDER_ACTIVATED_RECEIPT_SCHEMA_VERSION;
  const shouldObserve = activatedReceipt || observeHostRequested;
  const releaseIdentity = receipt?.identity ?? (release === null ? null : {
    name: release.name,
    version: release.version,
    adapterId: release.adapterId,
    releaseDigest: release.observedReleaseDigest,
  });
  let observation = null;
  if (shouldObserve && releaseIdentity !== null) {
    observation = await observeCodexHost({
      projectRoot,
      release: releaseIdentity,
    });
  }
  const state = await readCodexSelectorState();
  const host = normalizeDoctorHost(observation, activatedReceipt ? receipt.hostActivation : null);
  const ownership = diagnoseCodexOwnership(
    activatedReceipt ? receipt.hostActivation : null,
    receipt,
    state,
  );
  const consistent = !activatedReceipt
    || (host.receiptAgreement === "matching"
      && ownership.ownerRecord === "matching"
      && ["matching", "advanced"].includes(ownership.consumerLedger)
      && ownership.consumerPresence === "present");
  return deepFreeze({
    attempted: shouldObserve,
    observed: observation?.availability === "observed",
    mutatesHost: observation?.mutatesHost ?? false,
    host,
    ownership,
    hostVisibility: observation?.agent?.hostVisibility ?? "unobservable",
    consistent,
  });
}

function normalizeDoctorHost(observation, binding) {
  if (observation === null) {
    return {
      observation: "not-requested",
      installation: "unobserved",
      enablement: "unobserved",
      skillVisibility: "unobserved",
      hooksVisibility: "unobserved",
      trust: "unavailable",
      receiptAgreement: binding === null ? "not-applicable" : "mismatched",
    };
  }
  if (observation.availability !== "observed") {
    return {
      observation: "unavailable",
      installation: "unavailable",
      enablement: "unavailable",
      skillVisibility: "unavailable",
      hooksVisibility: "unavailable",
      trust: "unavailable",
      receiptAgreement: binding === null ? "not-applicable" : "mismatched",
    };
  }
  const host = {
    observation: "observed",
    installation: observation.plugin.installation,
    enablement: observation.plugin.installation === "installed"
      ? observation.plugin.enabled ? "enabled" : "disabled"
      : "unavailable",
    skillVisibility: observation.skill.visibility,
    hooksVisibility: observation.hooks.visibility,
    trust: observation.trust,
    receiptAgreement: binding === null
      ? "not-applicable"
      : observationAgreesWithBinding(observation, binding)
        ? "matching"
        : "mismatched",
  };
  return host;
}

function observationAgreesWithBinding(observation, binding) {
  const expected = binding.expectedPostObservation;
  return observation.plugin.installation === expected.installation
    && observation.plugin.enabled === expected.enabled
    && observation.plugin.sourceMatch === expected.sourceMatch
    && observation.plugin.releaseMatch === expected.releaseMatch
    && observation.skill.visibility === expected.skillVisibility
    && observation.hooks.visibility === expected.hooksVisibility
    && observation.trust === "pending-human"
    && ["unobservable", "visible"].includes(observation.agent.hostVisibility);
}

function diagnoseCodexOwnership(binding, receipt, state) {
  if (binding === null || receipt === null) {
    return {
      ownerRecord: "not-bound",
      ownerDisposition: null,
      consumerLedger: "not-bound",
      consumerPresence: "not-bound",
      consumerId: null,
      selectorDeletionAuthority: false,
    };
  }
  let ownerRecord = state.owner.status;
  let ownerDisposition = null;
  if (state.owner.status === "valid") {
    const owner = state.owner.value;
    ownerDisposition = owner.disposition;
    const ownerMatches = state.owner.digest === binding.ownerRecordDigest
      && digestCodexSelectorOwnerRecord(owner) === binding.ownerRecordDigest
      && owner.disposition === binding.ownerDisposition
      && owner.sourceDigest === binding.releaseDigest
      && owner.release.releaseDigest === binding.releaseDigest
      && JSON.stringify(owner.selector) === JSON.stringify(binding.selector);
    ownerRecord = ownerMatches ? "matching" : "stale";
  }

  let consumerLedger = state.ledger.status;
  let consumerPresence = "missing";
  if (state.ledger.status === "valid") {
    const ledger = state.ledger.value;
    const consumer = ledger.consumers.find((entry) => entry.consumerId === binding.consumerId);
    const entryMatches = consumer !== undefined
      && consumer.projectScopeDigest === receipt.scopeDigest
      && consumer.releaseDigest === binding.releaseDigest
      && digestJson(consumer, "codex-consumer-entry") === binding.consumerEntryDigest
      && JSON.stringify(consumer.selector) === JSON.stringify(binding.selector);
    consumerPresence = entryMatches ? "present" : consumer === undefined ? "missing" : "stale";
    const ledgerStructurallyValid = digestCodexConsumerLedger(ledger) === state.ledger.digest
      && JSON.stringify(ledger.selector) === JSON.stringify(binding.selector)
      && ledger.consumers.every((entry) => entry.releaseDigest === binding.releaseDigest);
    consumerLedger = !ledgerStructurallyValid || !entryMatches
      ? "stale"
      : state.ledger.digest === binding.consumerLedgerDigest
        ? "matching"
        : "advanced";
  }
  return {
    ownerRecord,
    ownerDisposition,
    consumerLedger,
    consumerPresence,
    consumerId: binding.consumerId,
    selectorDeletionAuthority: false,
  };
}

function buildAgentDiagnosis({ projectionStatus, activatedReceipt, hostVisibility }) {
  const normalizedVisibility = hostVisibility === "visible" ? "visible" : "unobservable";
  const status = projectionStatus === "missing"
    ? "missing-projection"
    : projectionStatus !== "pristine"
      ? "inconsistent-projection"
      : normalizedVisibility === "visible"
        ? "host-visible"
        : activatedReceipt
          ? "projected-but-host-unobservable"
          : "pristine-projection";
  return {
    projection: projectionStatus,
    hostVisibility: normalizedVisibility,
    status,
  };
}

async function diagnoseCheckpoint(projectRoot, receiptDigest, receiptLineageDigests = []) {
  const checkpointPath = path.resolve(projectRoot, ...BUILDER_CHECKPOINT_PATH.split("/"));
  const checkpointParent = path.dirname(checkpointPath);
  try {
    await lstat(checkpointParent, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { path: BUILDER_CHECKPOINT_PATH, status: "idle", receiptBinding: "not-applicable" };
    }
    return { path: BUILDER_CHECKPOINT_PATH, status: "corrupt", receiptBinding: "unverified" };
  }
  try {
    const journal = await loadImmutableJournal({
      journalPath: checkpointPath,
      maxValueBytes: DEFAULT_MAX_BUILDER_CHECKPOINT_BYTES,
    });
    if (journal.recoveryRequired) {
      return {
        path: BUILDER_CHECKPOINT_PATH,
        status: "recovery-required",
        receiptBinding: "unverified",
        ...(journal.head === null
          ? {}
          : { headDigest: journal.head.digest, sequence: journal.head.sequence }),
      };
    }
    if (journal.head === null) {
      return { path: BUILDER_CHECKPOINT_PATH, status: "idle", receiptBinding: "not-applicable" };
    }
    const admission = await loadBuilderCheckpoint(checkpointPath, {
      expectedDigest: journal.head.digest,
      maxBytes: DEFAULT_MAX_BUILDER_CHECKPOINT_BYTES,
    });
    const basis = {
      path: BUILDER_CHECKPOINT_PATH,
      headDigest: admission.digest,
      sequence: admission.sequence,
    };
    if (receiptDigest === null
      || (admission.value.installReceiptDigest !== receiptDigest
        && !receiptLineageDigests.includes(admission.value.installReceiptDigest))) {
      return { ...basis, status: "receipt-mismatch", receiptBinding: "mismatched" };
    }
    return { ...basis, status: "valid", receiptBinding: "matching" };
  } catch {
    return { path: BUILDER_CHECKPOINT_PATH, status: "corrupt", receiptBinding: "unverified" };
  }
}

function normalizeCapabilities(probe) {
  const observations = Array.isArray(probe?.observations) ? probe.observations : [];
  const required = observations
    .filter((item) => item?.requirement === "required" && ID_PATTERN.test(item?.id ?? ""))
    .map((item) => ({ id: item.id, status: normalizeCapabilityStatus(item.status, false) }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const optional = observations
    .filter((item) => item?.requirement === "optional" && ID_PATTERN.test(item?.id ?? ""))
    .map((item) => ({ id: item.id, status: normalizeCapabilityStatus(item.status, true) }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const validProbe = probe?.schemaVersion === "agentmo.builder-probe.v1"
    && probe?.adapter?.id === "codex"
    && probe?.mutatesHost === "unknown"
    && probe?.externalCommandMutation === "unknown";
  return {
    adapterId: "codex",
    hostVersion: validProbe && typeof probe.host?.version === "string" ? probe.host.version : null,
    observationLevel: validProbe ? "observed" : "unavailable",
    requiredOk: validProbe && probe?.required?.ok === true && required.every((item) => item.status === "observed"),
    required,
    optional,
  };
}

function normalizeCapabilityStatus(value, optional) {
  if (["observed", "missing", "incompatible"].includes(value)) return value;
  if (optional && value === "degraded") return value;
  return optional ? "degraded" : "missing";
}

async function admitDoctorRoot(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw doctorError("AGENTMO_BUILDER_DOCTOR_SCOPE_REJECTED");
  }
  try {
    const root = await realpath(path.resolve(value));
    const stats = await lstat(root);
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error("invalid root");
    return root;
  } catch {
    throw doctorError("AGENTMO_BUILDER_DOCTOR_SCOPE_REJECTED");
  }
}

async function inspectProjectFile(projectRoot, relativePath, readAuthority = {}) {
  if (!portableRelativePath(relativePath)) return { status: "unsafe" };
  const destination = path.resolve(projectRoot, ...relativePath.split("/"));
  if (!isInside(projectRoot, destination)) return { status: "unsafe" };
  const expectedUid = typeof process.getuid === "function" ? process.getuid() : null;
  if (expectedUid === null
    || !Number.isInteger(FS_CONSTANTS.O_NOFOLLOW)
    || FS_CONSTANTS.O_NOFOLLOW === 0
    || !Number.isInteger(FS_CONSTANTS.O_DIRECTORY)) {
    return { status: "unsafe" };
  }
  const retainedDirectories = [];
  let fileHandle;
  try {
    const directoryPaths = [projectRoot];
    let current = projectRoot;
    for (const segment of path.relative(projectRoot, path.dirname(destination)).split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      directoryPaths.push(current);
    }
    for (const directoryPath of directoryPaths) {
      let before;
      try {
        before = await lstat(directoryPath, { bigint: true });
      } catch (error) {
        if (error?.code === "ENOENT") throw new DoctorReadError("missing");
        throw new DoctorReadError("unreadable");
      }
      assertSafeDoctorDirectory(before, expectedUid);
      const canonical = await realpath(directoryPath);
      if (canonical !== directoryPath) throw new DoctorReadError("unsafe");
      let handle;
      try {
        handle = await open(
          directoryPath,
          FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_DIRECTORY | FS_CONSTANTS.O_NOFOLLOW,
        );
      } catch {
        throw new DoctorReadError("unsafe");
      }
      const retained = await handle.stat({ bigint: true });
      const after = await lstat(directoryPath, { bigint: true });
      assertSafeDoctorDirectory(retained, expectedUid);
      assertSafeDoctorDirectory(after, expectedUid);
      if (!sameDoctorIdentity(before, retained) || !sameDoctorIdentity(retained, after)) {
        await handle.close().catch(() => {});
        throw new DoctorReadError("unsafe");
      }
      retainedDirectories.push({ path: directoryPath, handle, stat: retained });
    }

    let before;
    try {
      before = await lstat(destination, { bigint: true });
    } catch (error) {
      if (error?.code === "ENOENT") throw new DoctorReadError("missing");
      throw new DoctorReadError("unreadable");
    }
    if (before.isSymbolicLink()) throw new DoctorReadError("unsafe");
    if (!before.isFile()) throw new DoctorReadError("wrong-type");
    assertSafeDoctorFile(before, expectedUid, readAuthority);
    if (before.size > BigInt(MAX_DOCTOR_FILE_BYTES)) throw new DoctorReadError("unreadable");

    try {
      fileHandle = await open(destination, FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW);
    } catch {
      throw new DoctorReadError("unsafe");
    }
    const retained = await fileHandle.stat({ bigint: true });
    const currentFile = await lstat(destination, { bigint: true });
    assertSafeDoctorFile(retained, expectedUid, readAuthority);
    assertSafeDoctorFile(currentFile, expectedUid, readAuthority);
    if (!sameDoctorIdentity(before, retained) || !sameDoctorIdentity(retained, currentFile)) {
      throw new DoctorReadError("unsafe");
    }
    const bytes = Buffer.alloc(Number(retained.size));
    let offset = 0;
    while (offset < bytes.length) {
      const result = await fileHandle.read(bytes, offset, bytes.length - offset, offset);
      if (!Number.isInteger(result.bytesRead) || result.bytesRead <= 0) {
        throw new DoctorReadError("unreadable");
      }
      offset += result.bytesRead;
    }
    await assertDoctorFileBinding(destination, fileHandle, retained, expectedUid, readAuthority);
    await assertDoctorDirectoryChain(retainedDirectories, expectedUid);
    await assertDoctorFileBinding(destination, fileHandle, retained, expectedUid, readAuthority);
    await assertDoctorDirectoryChain(retainedDirectories, expectedUid);
    return { status: "file", bytes };
  } catch (error) {
    if (error instanceof DoctorReadError) return { status: error.status };
    return { status: "unsafe" };
  } finally {
    await fileHandle?.close().catch(() => {});
    await Promise.all(retainedDirectories.map((entry) => entry.handle.close().catch(() => {})));
  }
}

class DoctorReadError extends Error {
  constructor(status) {
    super("Builder doctor retained read rejected.");
    this.status = status;
  }
}

function assertSafeDoctorDirectory(stat, expectedUid) {
  if (!stat?.isDirectory?.()
    || stat.isSymbolicLink?.()
    || stat.uid !== BigInt(expectedUid)
    || (stat.mode & 0o022n) !== 0n) {
    throw new DoctorReadError("unsafe");
  }
}

function assertSafeDoctorFile(stat, expectedUid, readAuthority = {}) {
  const admittedIdentity = readAuthority.admittedIdentity ?? null;
  const identityMatchesAdmission = admittedIdentity === null
    || (admittedIdentity.links === "1"
      && admittedIdentity.device === stat.dev.toString(10)
      && admittedIdentity.inode === stat.ino.toString(10)
      && admittedIdentity.size === stat.size.toString(10));
  const linksAuthorized = stat.nlink === 1n
    || (stat.nlink === 2n
      // Provisional twins only select a digest; admitted twins are bound to
      // the exact identity returned by the full lifecycle authority.
      && (readAuthority.allowProvisionalTwin === true || admittedIdentity !== null));
  if (!stat?.isFile?.()
    || stat.isSymbolicLink?.()
    || stat.uid !== BigInt(expectedUid)
    || !linksAuthorized
    || !identityMatchesAdmission
    || (stat.mode & 0o022n) !== 0n) {
    throw new DoctorReadError("unsafe");
  }
}

async function assertDoctorFileBinding(filePath, handle, expected, expectedUid, readAuthority = {}) {
  const retained = await handle.stat({ bigint: true });
  const current = await lstat(filePath, { bigint: true });
  assertSafeDoctorFile(retained, expectedUid, readAuthority);
  assertSafeDoctorFile(current, expectedUid, readAuthority);
  if (!sameDoctorIdentity(expected, retained)
    || !sameDoctorIdentity(retained, current)
    || retained.size !== expected.size
    || retained.mtimeNs !== expected.mtimeNs
    || retained.ctimeNs !== expected.ctimeNs) {
    throw new DoctorReadError("unsafe");
  }
}

async function assertDoctorDirectoryChain(chain, expectedUid) {
  for (const entry of chain) {
    const retained = await entry.handle.stat({ bigint: true });
    const current = await lstat(entry.path, { bigint: true });
    const canonical = await realpath(entry.path);
    assertSafeDoctorDirectory(retained, expectedUid);
    assertSafeDoctorDirectory(current, expectedUid);
    if (canonical !== entry.path
      || !sameDoctorIdentity(entry.stat, retained)
      || !sameDoctorIdentity(retained, current)
      || retained.mtimeNs !== entry.stat.mtimeNs
      || retained.ctimeNs !== entry.stat.ctimeNs) {
      throw new DoctorReadError("unsafe");
    }
  }
}

function sameDoctorIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function fileStatus(observation, expectedDigest) {
  if (observation.status !== "file") return observation.status;
  return digestRawBytes(observation.bytes) === expectedDigest ? "pristine" : "modified";
}

function remediationCodes(context) {
  const codes = [];
  if (context.receiptStatus === "missing" && !context.residualPresent) codes.push("run-setup-preview");
  if (context.receiptStatus === "missing" && context.residualPresent) codes.push("review-partial-install");
  if (context.receiptStatus === "corrupt") codes.push("review-corrupt-receipt");
  if (!context.releaseMatch && context.receiptStatus === "valid") codes.push("review-release-mismatch");
  if (context.markerStatus !== "matching" && context.receiptStatus === "valid") codes.push("review-marker-mismatch");
  if (context.managedPathOwnershipAdmitted
    && context.fileObservations.some((item) => item.status !== "pristine")) {
    codes.push("review-receipt-owned-paths");
  }
  if (Object.values(context.visibility).some((status) => status === "inconsistent")) {
    codes.push("review-codex-projection");
  }
  if (["corrupt", "receipt-mismatch", "recovery-required", "unsafe"].includes(
    context.checkpoint.status,
  )) {
    codes.push("review-checkpoint-binding");
  }
  if (!context.capabilities.requiredOk) codes.push("restore-required-host-capabilities");
  if (context.receiptStatus === "valid") codes.push("verify-in-fresh-session");
  return Array.from(new Set(codes)).sort();
}

function portableRelativePath(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 240
    && !value.includes("\\")
    && !value.includes("\0")
    && !path.posix.isAbsolute(value)
    && value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function isInside(root, candidate) {
  return candidate !== root && candidate.startsWith(`${root}${path.sep}`);
}

function hasExactKeys(value, keys) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function hasOnlyKeys(value, keys) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).every((key) => keys.includes(key));
}

function digestJson(value, subject) {
  return digestRawBytes(Buffer.from(serializePersistableJson(value, { subject }), "utf8"));
}

function assertDoctorBuilderPlatform() {
  try {
    assertBuilderPlatform();
  } catch {
    throw doctorError("AGENTMO_BUILDER_DOCTOR_PLATFORM_UNSUPPORTED");
  }
}

function doctorError(code) {
  const error = new Error("Builder doctor could not inspect the project scope.");
  error.code = code;
  return error;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
