import { spawn } from "node:child_process";
import { constants as FS_CONSTANTS } from "node:fs";
import {
  lstat,
  open,
  opendir,
  readdir,
  realpath,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { digestRawBytes } from "./artifact-admission.js";
import {
  appendAppendOnlyRecord,
  BuilderAppendOnlyAuthorityError,
  readAppendOnlyAuthority,
} from "./builder-append-only-authority.js";
import { assertBuilderPlatform } from "./builder-platform.js";
import { runBuilderPosixEffect } from "./builder-posix-effect.js";
import { serializePersistableJson } from "./persistability.js";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const MAX_HOST_BYTES = 64 * 1024;
const MAX_PROJECTION_FILE_BYTES = 256 * 1024;
const MAX_PROJECTION_TOTAL_FILE_BYTES = 32 * 1024 * 1024;
const MAX_PROJECTION_FILES = 2_048;
const MAX_PROJECTION_MEMBERS = 4_096;
const MAX_PROJECTION_PATH_DEPTH = 32;
const HOST_TIMEOUT_MS = 5_000;
const HOST_TERMINATION_GRACE_MS = 250;
const STATE_AUTHORITY_DIRECTORY = ".codex-selector-state-authority";
const STATE_AUTHORITY_NAMESPACE = "codex-selector-state";
const STATE_EVENT_SCHEMA_VERSION = "agentmo.codex-selector-state-event.v1";
const PROJECTION_EVENT_SCHEMA_VERSION = "agentmo.codex-marketplace-projection-event.v1";
const PROJECTION_BATCH_EVENT_SCHEMA_VERSION =
  "agentmo.codex-marketplace-projection-batch-event.v1";
const PROJECTION_MANIFEST_SCHEMA_VERSION = "agentmo.codex-marketplace-projection-manifest.v1";
const PROJECTION_BINDING_SCHEMA_VERSION = "agentmo.codex-marketplace-projection-binding.v1";
const MAX_PROJECTION_BATCH_MEMBERS = 16;
const PROJECTION_BATCH_EVENT_KINDS = new Set([
  "projection-batch-intent",
  "projection-batch-observed",
]);
const PROJECTION_EVENT_KINDS = new Set([
  "projection-manifest",
  "projection-intent",
  "projection-observed",
  "projection-complete",
  ...PROJECTION_BATCH_EVENT_KINDS,
]);
const STATE_CLAIM_DIRECTORY = ".codex-selector-state-claims";
const STATE_CLAIM_SCHEMA_VERSION = "agentmo.codex-selector-state-claim.v1";
const STATE_RESERVATIONS = new WeakMap();
const PROJECTION_AUTHORITIES = new WeakMap();
const RESERVATION_PURPOSES = new Set([
  "activation",
  "projection-migration",
  "projection-transfer",
  "project-lifecycle",
  "selector-removal",
  "owner-write",
  "ledger-write",
  "owner-restore",
  "ledger-restore",
]);
const SELECTOR = Object.freeze({
  pluginId: "agentmo@agentmo-local",
  pluginName: "agentmo",
  marketplaceName: "agentmo-local",
});
const OBSERVATION_REQUESTS = Object.freeze([
  Object.freeze({ id: 1, method: "initialize", params: { clientInfo: { name: "agentmo", version: "0.1.0" } } }),
  Object.freeze({ id: 2, method: "plugin/installed", params: {} }),
  Object.freeze({ id: 3, method: "skills/list", params: {} }),
  Object.freeze({ id: 4, method: "hooks/list", params: {} }),
]);

export const CODEX_SELECTOR_OWNER_FILE = "codex-selector-owner.json";
export const CODEX_CONSUMER_LEDGER_FILE = "codex-consumer-ledger.json";
const CODEX_MARKETPLACE_DIRECTORY = path.join("marketplace", SELECTOR.marketplaceName);

export class BuilderCodexHostError extends Error {
  constructor(code) {
    super("Codex host operation could not be completed.");
    this.name = "BuilderCodexHostError";
    this.code = code;
  }
}

export function buildCodexHostSelector(release) {
  validateRelease(release);
  return Object.freeze({ ...SELECTOR });
}

export async function resolveBuilderCodexMarketplaceRoot(options = {}) {
  assertBuilderPlatform();
  if (!exactKeys(options, [])) fail("AGENTMO_CODEX_HOST_STATE_ROOT_REJECTED");
  const stateRoot = await resolveStateRoot(options, false);
  return path.join(
    stateRoot ?? builderCodexStateRootPath(),
    CODEX_MARKETPLACE_DIRECTORY,
  );
}

export async function ensureBuilderCodexMarketplaceRoot(options = {}) {
  assertBuilderPlatform();
  if (!exactKeys(options, [])) fail("AGENTMO_CODEX_HOST_STATE_ROOT_REJECTED");
  const stateRoot = await resolveStateRoot(options, true);
  const marketplaceParent = path.join(stateRoot, "marketplace");
  await resolveCanonicalStateDirectory(
    marketplaceParent,
    true,
    process.getuid?.(),
  );
  return path.join(marketplaceParent, SELECTOR.marketplaceName);
}

export async function inspectCodexMarketplaceProjectionTransaction(options = {}) {
  assertBuilderPlatform();
  const normalized = normalizeProjectionRequest(options, false);
  const stateRoot = projectionStateRoot(normalized.marketplaceRoot);
  const resolvedStateRoot = await resolveStateRoot({}, false);
  if (resolvedStateRoot === null) {
    const physical = await inspectProjectionPrefix(normalized.marketplaceRoot, null);
    return deepFreeze({
      status: physical.status === "absent" ? "absent" : "foreign",
      contentDigest: normalized.manifest.contentDigest,
      rootIdentityDigest: null,
      transactionId: normalized.transactionId,
      transactionDigest: normalized.manifestDigest,
      binding: null,
    });
  }
  if (resolvedStateRoot !== stateRoot) {
    fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
  }
  const snapshot = await requireConsistentSelectorSnapshot(stateRoot);
  const transaction = snapshot.projectionTransaction;
  if (transaction === null) {
    const physical = await inspectProjectionPrefix(normalized.marketplaceRoot, null);
    return deepFreeze({
      status: physical.status === "absent" ? "absent" : "foreign",
      contentDigest: normalized.manifest.contentDigest,
      rootIdentityDigest: null,
      transactionId: normalized.transactionId,
      transactionDigest: normalized.manifestDigest,
      binding: null,
    });
  }
  if (transaction.manifestDigest !== normalized.manifestDigest
    || transaction.transactionId !== normalized.transactionId) {
    return deepFreeze({
      status: "foreign",
      contentDigest: normalized.manifest.contentDigest,
      rootIdentityDigest: null,
      transactionId: normalized.transactionId,
      transactionDigest: normalized.manifestDigest,
      binding: null,
    });
  }
  try {
    const physical = await inspectProjectionPrefix(normalized.marketplaceRoot, transaction);
    if (transaction.complete !== null) {
      const binding = buildCurrentProjectionBinding(normalized, physical.records);
      if (digestValue(binding, "codex-marketplace-projection-binding")
        !== transaction.complete.bindingDigest
        || JSON.stringify(binding) !== JSON.stringify(transaction.complete.binding)) {
        fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
      }
      return deepFreeze({
        status: "exact",
        contentDigest: normalized.manifest.contentDigest,
        rootIdentityDigest: binding.rootIdentityDigest,
        transactionId: normalized.transactionId,
        transactionDigest: normalized.manifestDigest,
        binding,
      });
    }
    return deepFreeze({
      status: "resumable",
      contentDigest: normalized.manifest.contentDigest,
      rootIdentityDigest: physical.records[0] === undefined
        ? null
        : digestProjectionRootIdentityModel(physical.records[0].identity),
      transactionId: normalized.transactionId,
      transactionDigest: normalized.manifestDigest,
      binding: null,
    });
  } catch {
    return deepFreeze({
      status: "foreign",
      contentDigest: normalized.manifest.contentDigest,
      rootIdentityDigest: null,
      transactionId: normalized.transactionId,
      transactionDigest: normalized.manifestDigest,
      binding: null,
    });
  }
}

export async function publishCodexMarketplaceProjectionTransaction(options = {}) {
  assertBuilderPlatform();
  const normalized = normalizeProjectionRequest(options, true);
  const held = await assertStateReservation(options.reservation);
  if (projectionStateRoot(normalized.marketplaceRoot) !== held.stateRoot) {
    fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
  }
  const ensuredMarketplaceRoot = await ensureBuilderCodexMarketplaceRoot();
  if (ensuredMarketplaceRoot !== normalized.marketplaceRoot) {
    fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
  }
  let snapshot = await requireConsistentSelectorSnapshot(held.stateRoot);
  let transaction = snapshot.projectionTransaction;
  if (transaction === null) {
    ({ snapshot } = await appendProjectionEvent(held, {
      schemaVersion: PROJECTION_EVENT_SCHEMA_VERSION,
      kind: "projection-manifest",
      reservationDigest: held.acquisitionDigest,
      transactionId: normalized.transactionId,
      manifestDigest: normalized.manifestDigest,
      manifest: normalized.manifest,
    }, `projection-manifest:${normalized.transactionId}`));
    transaction = snapshot.projectionTransaction;
  }
  if (transaction?.transactionId !== normalized.transactionId
    || transaction.manifestDigest !== normalized.manifestDigest
      || JSON.stringify(transaction.manifest) !== JSON.stringify(normalized.manifest)) {
    fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
  }

  // A publisher interrupted before this batching contract may leave one
  // legacy per-member intent. Complete only that already-authorized delta,
  // then continue with bounded batch events.
  if (transaction.complete === null && transaction.pendingIntent !== null) {
    const memberIndex = transaction.pendingIntent;
    let physical = await inspectProjectionPrefix(normalized.marketplaceRoot, transaction);
    let observed = physical.records[memberIndex] ?? null;
    if (observed === null) {
      await applyProjectionMemberEffect(normalized, memberIndex);
      physical = await inspectProjectionPrefix(normalized.marketplaceRoot, transaction);
      observed = physical.records[memberIndex] ?? null;
    }
    if (observed === null) fail("AGENTMO_CODEX_HOST_PROJECTION_PUBLICATION_FAILED");
    ({ snapshot } = await appendProjectionEvent(held, {
      schemaVersion: PROJECTION_EVENT_SCHEMA_VERSION,
      kind: "projection-observed",
      reservationDigest: held.acquisitionDigest,
      transactionId: normalized.transactionId,
      memberIndex,
      observed,
    }, `projection-observed:${normalized.transactionId}:${memberIndex}`));
    transaction = snapshot.projectionTransaction;
  }

  while (transaction.complete === null
    && transaction.observed.length < normalized.manifest.members.length) {
    if (transaction.pendingBatch === null) {
      const startMemberIndex = transaction.observed.length;
      const endMemberIndex = Math.min(
        startMemberIndex + MAX_PROJECTION_BATCH_MEMBERS,
        normalized.manifest.members.length,
      );
      ({ snapshot } = await appendProjectionEvent(held, {
        schemaVersion: PROJECTION_BATCH_EVENT_SCHEMA_VERSION,
        kind: "projection-batch-intent",
        reservationDigest: held.acquisitionDigest,
        transactionId: normalized.transactionId,
        manifestDigest: normalized.manifestDigest,
        startMemberIndex,
        endMemberIndex,
      }, [
        "projection-batch-intent",
        normalized.transactionId,
        startMemberIndex,
        endMemberIndex,
      ].join(":")));
      transaction = snapshot.projectionTransaction;
    }
    const pendingBatch = transaction.pendingBatch;
    if (pendingBatch === null
      || pendingBatch.startMemberIndex !== transaction.observed.length
      || pendingBatch.endMemberIndex > normalized.manifest.members.length
      || pendingBatch.endMemberIndex - pendingBatch.startMemberIndex
        > MAX_PROJECTION_BATCH_MEMBERS) {
      fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
    }

    const initialPhysical = await inspectProjectionPrefix(
      normalized.marketplaceRoot,
      transaction,
    );
    if (initialPhysical.records.length < pendingBatch.startMemberIndex
      || initialPhysical.records.length > pendingBatch.endMemberIndex) {
      fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
    }
    const retained = await retainProjectionPrefix(
      normalized,
      initialPhysical.records,
    );
    try {
      for (
        let memberIndex = initialPhysical.records.length;
        memberIndex < pendingBatch.endMemberIndex;
        memberIndex += 1
      ) {
        await assertRetainedProjectionPrefix(normalized, retained);
        const parentAuthority = await retainedProjectionParentAuthority(
          normalized,
          retained,
          memberIndex,
        );
        await applyProjectionMemberEffect(normalized, memberIndex, parentAuthority);
        const observed = await inspectExactProjectionMember(
          normalized.marketplaceRoot,
          normalized.manifest.members[memberIndex],
        );
        await retainProjectionMember(normalized, retained, memberIndex, observed);
      }
      await assertRetainedProjectionPrefix(normalized, retained);
      const physical = await inspectProjectionPrefix(
        normalized.marketplaceRoot,
        transaction,
      );
      if (physical.records.length !== pendingBatch.endMemberIndex) {
        fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
      }
      assertPhysicalProjectionMatchesRetained(retained, physical.records);
      await assertRetainedProjectionPrefix(normalized, retained);
      const observedBatch = physical.records.slice(
        pendingBatch.startMemberIndex,
        pendingBatch.endMemberIndex,
      );

      ({ snapshot } = await appendProjectionEvent(held, {
        schemaVersion: PROJECTION_BATCH_EVENT_SCHEMA_VERSION,
        kind: "projection-batch-observed",
        reservationDigest: held.acquisitionDigest,
        transactionId: normalized.transactionId,
        manifestDigest: normalized.manifestDigest,
        startMemberIndex: pendingBatch.startMemberIndex,
        endMemberIndex: pendingBatch.endMemberIndex,
        observed: observedBatch,
      }, [
        "projection-batch-observed",
        normalized.transactionId,
        pendingBatch.startMemberIndex,
        pendingBatch.endMemberIndex,
      ].join(":")));
      transaction = snapshot.projectionTransaction;
      await assertRetainedProjectionPrefix(normalized, retained);
      const admittedAfterAppend = await inspectProjectionPrefix(
        normalized.marketplaceRoot,
        transaction,
      );
      assertPhysicalProjectionMatchesRetained(
        retained,
        admittedAfterAppend.records,
      );
    } finally {
      await closeRetainedProjectionPrefix(retained);
    }
  }

  let physical = await inspectProjectionPrefix(normalized.marketplaceRoot, transaction);
  if (transaction.complete === null) {
    const binding = buildCurrentProjectionBinding(normalized, physical.records);
    const bindingDigest = digestValue(binding, "codex-marketplace-projection-binding");
    ({ snapshot } = await appendProjectionEvent(held, {
      schemaVersion: PROJECTION_EVENT_SCHEMA_VERSION,
      kind: "projection-complete",
      reservationDigest: held.acquisitionDigest,
      transactionId: normalized.transactionId,
      bindingDigest,
      binding,
    }, `projection-complete:${normalized.transactionId}`));
    transaction = snapshot.projectionTransaction;
  }
  physical = await inspectProjectionPrefix(normalized.marketplaceRoot, transaction);
  const binding = buildCurrentProjectionBinding(normalized, physical.records);
  if (transaction.complete?.bindingDigest
      !== digestValue(binding, "codex-marketplace-projection-binding")
    || JSON.stringify(transaction.complete.binding) !== JSON.stringify(binding)) {
    fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
  }
  return deepFreeze({
    status: "exact",
    created: transaction.createdDuringTransaction,
    contentDigest: normalized.manifest.contentDigest,
    rootIdentityDigest: binding.rootIdentityDigest,
    transactionId: normalized.transactionId,
    transactionDigest: transaction.manifestDigest,
    binding,
  });
}

export async function retainCodexMarketplaceProjectionFinalAuthority(options = {}) {
  assertBuilderPlatform();
  const normalized = normalizeProjectionRequest(options, true);
  const held = await assertStateReservation(options.reservation);
  if (projectionStateRoot(normalized.marketplaceRoot) !== held.stateRoot) {
    fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
  }
  const snapshot = await requireConsistentSelectorSnapshot(held.stateRoot);
  const transaction = snapshot.projectionTransaction;
  if (transaction?.complete === null
    || transaction?.transactionId !== normalized.transactionId
    || transaction.manifestDigest !== normalized.manifestDigest) {
    fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
  }
  const retained = [];
  try {
    for (const member of normalized.manifest.members) {
      const absolute = projectionMemberPath(normalized.marketplaceRoot, member);
      const handle = await open(
        absolute,
        member.kind === "file"
          ? FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW
          : FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_DIRECTORY | FS_CONSTANTS.O_NOFOLLOW,
      );
      retained.push({ member, absolute, handle });
    }
    const binding = await assertRetainedProjectionMembers(normalized, retained, transaction);
    const token = Object.freeze({ binding });
    PROJECTION_AUTHORITIES.set(token, { normalized, retained, transactionId: transaction.transactionId });
    return token;
  } catch (error) {
    await Promise.all(retained.map((entry) => entry.handle.close().catch(() => {})));
    if (error instanceof BuilderCodexHostError) throw error;
    fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
  }
}

export async function assertCodexMarketplaceProjectionFinalAuthority(authority, reservation = undefined) {
  assertBuilderPlatform();
  const retainedAuthority = PROJECTION_AUTHORITIES.get(authority);
  if (retainedAuthority === undefined) {
    fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
  }
  try {
    const stateRoot = projectionStateRoot(retainedAuthority.normalized.marketplaceRoot);
    if (reservation !== undefined) {
      const held = await assertStateReservation(reservation);
      if (stateRoot !== held.stateRoot) {
        fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
      }
    }
    const snapshot = await requireConsistentSelectorSnapshot(stateRoot);
    const transaction = snapshot.projectionTransaction;
    if (transaction?.complete === null
      || transaction?.transactionId !== retainedAuthority.transactionId) {
      fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
    }
    const binding = await assertRetainedProjectionMembers(
      retainedAuthority.normalized,
      retainedAuthority.retained,
      transaction,
    );
    if (JSON.stringify(binding) !== JSON.stringify(authority.binding)) {
      fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
    }
    return deepFreeze({ status: "exact", binding });
  } catch (error) {
    if (error instanceof BuilderCodexHostError
      && error.code === "AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED") {
      throw error;
    }
    fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
  }
}

export async function assertCodexMarketplaceProjectionFinalBinding(options = {}) {
  assertBuilderPlatform();
  if (!exactKeys(options, ["expectedBinding", "marketplaceRoot"])
    || typeof options.marketplaceRoot !== "string"
    || !path.isAbsolute(options.marketplaceRoot)
    || path.resolve(options.marketplaceRoot) !== options.marketplaceRoot) {
    fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
  }
  try {
    const stateRoot = projectionStateRoot(options.marketplaceRoot);
    const snapshot = await requireConsistentSelectorSnapshot(stateRoot);
    const transaction = snapshot.projectionTransaction;
    if (transaction?.complete === null) {
      fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
    }
    const expectedBinding = validateProjectionBinding(
      structuredClone(options.expectedBinding),
      transaction.manifest,
      transaction.observed,
    );
    if (transaction.complete.bindingDigest
        !== digestValue(expectedBinding, "codex-marketplace-projection-binding")
      || JSON.stringify(transaction.complete.binding) !== JSON.stringify(expectedBinding)) {
      fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
    }
    const physical = await inspectProjectionPrefix(
      options.marketplaceRoot,
      transaction,
    );
    const normalized = {
      marketplaceRoot: options.marketplaceRoot,
      manifest: transaction.manifest,
      manifestDigest: transaction.manifestDigest,
      transactionId: transaction.transactionId,
    };
    const currentBinding = buildCurrentProjectionBinding(normalized, physical.records);
    if (JSON.stringify(currentBinding) !== JSON.stringify(expectedBinding)
      || digestValue(currentBinding, "codex-marketplace-projection-binding")
        !== transaction.complete.bindingDigest) {
      fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
    }
    return deepFreeze(currentBinding);
  } catch (error) {
    if (error instanceof BuilderCodexHostError
      && error.code === "AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED") {
      throw error;
    }
    fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
  }
}

export async function closeCodexMarketplaceProjectionFinalAuthority(authority) {
  const retainedAuthority = PROJECTION_AUTHORITIES.get(authority);
  if (retainedAuthority === undefined) return;
  PROJECTION_AUTHORITIES.delete(authority);
  await Promise.all(retainedAuthority.retained.map((entry) => entry.handle.close().catch(() => {})));
}

export async function inspectCodexMarketplaceProjectionAuthority(options = {}) {
  assertBuilderPlatform();
  if (!exactKeys(options, [])) fail("AGENTMO_CODEX_HOST_STATE_ROOT_REJECTED");
  const marketplaceRoot = await resolveBuilderCodexMarketplaceRoot();
  const observed = await inspectProjectionTree(marketplaceRoot);
  if (observed === null) {
    return deepFreeze({ status: "missing", contentDigest: null, rootIdentityDigest: null });
  }
  if (observed.inconsistent) {
    return deepFreeze({ status: "inconsistent", contentDigest: null, rootIdentityDigest: null });
  }
  return deepFreeze({
    status: "valid",
    contentDigest: observed.contentDigest,
    rootIdentityDigest: observed.rootIdentityDigest,
  });
}

export async function inspectCodexMarketplaceProjectionBinding(options = {}) {
  assertBuilderPlatform();
  if (!options || typeof options !== "object" || Array.isArray(options)
    || Object.keys(options).length !== 1
    || typeof options.marketplaceRoot !== "string"
    || !path.isAbsolute(options.marketplaceRoot)
    || path.resolve(options.marketplaceRoot) !== options.marketplaceRoot) {
    fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
  }
  const stateRoot = path.resolve(options.marketplaceRoot, "..", "..");
  if (options.marketplaceRoot !== path.join(stateRoot, CODEX_MARKETPLACE_DIRECTORY)) {
    fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
  }
  try {
    await assertCanonicalDirectory(stateRoot);
    await assertCanonicalDirectory(options.marketplaceRoot);
  } catch (error) {
    if (error instanceof BuilderCodexHostError) throw error;
    fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
  }
  const [{ owner, ledger }, observed] = await Promise.all([
    readSelectorStateAtRoot(stateRoot),
    inspectProjectionTree(options.marketplaceRoot),
  ]);
  const projection = observed === null
    ? { status: "missing", contentDigest: null, rootIdentityDigest: null }
    : observed.inconsistent
      ? { status: "inconsistent", contentDigest: null, rootIdentityDigest: null }
      : {
          status: "valid",
          contentDigest: observed.contentDigest,
          rootIdentityDigest: observed.rootIdentityDigest,
        };
  return deepFreeze({ stateRootAvailable: true, owner, ledger, projection });
}

export async function retireCodexMarketplaceProjectionAuthority(options = {}) {
  assertBuilderPlatform();
  if (!DIGEST_PATTERN.test(options.expectedContentDigest ?? "")
    || !DIGEST_PATTERN.test(options.expectedRootIdentityDigest ?? "")) {
    fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
  }
  fail("AGENTMO_CODEX_HOST_PHYSICAL_RETIREMENT_UNSUPPORTED");
}

export async function restoreCodexMarketplaceProjectionAuthority(_token) {
  assertBuilderPlatform();
  fail("AGENTMO_CODEX_HOST_PHYSICAL_RETIREMENT_UNSUPPORTED");
}

export async function observeCodexHost(options = {}) {
  assertBuilderPlatform();
  if (!options || typeof options !== "object" || Array.isArray(options)
    || !exactKeys(options, ["projectRoot", "release"])) {
    fail("AGENTMO_CODEX_HOST_OBSERVATION_REJECTED");
  }
  const projectRoot = admitProjectRoot(options.projectRoot);
  const release = releaseIdentity(options.release);
  const selector = buildCodexHostSelector(release);
  const common = {
    command: "codex",
    cwd: projectRoot,
    env: minimalCodexEnvironment(),
    shell: false,
    timeoutMs: HOST_TIMEOUT_MS,
    maxBytes: MAX_HOST_BYTES,
  };
  const marketplaceRoot = await resolveBuilderCodexMarketplaceRoot();
  let marketplaceResult;
  let marketplaceConfirmationResult;
  let commandResult;
  let rpcResult;
  try {
    marketplaceResult = await officialObservationTransport({
      ...common,
      kind: "command",
      args: ["plugin", "marketplace", "list", "--json"],
    });
    [commandResult, rpcResult] = await Promise.all([
      officialObservationTransport({
        ...common,
        kind: "command",
        args: ["plugin", "list", "--available", "--json"],
      }),
      officialObservationTransport({
        ...common,
        kind: "rpc",
        args: ["app-server", "--stdio"],
        requests: OBSERVATION_REQUESTS,
      }),
    ]);
    marketplaceConfirmationResult = await officialObservationTransport({
      ...common,
      kind: "command",
      args: ["plugin", "marketplace", "list", "--json"],
    });
  } catch {
    marketplaceResult = { ok: false };
    marketplaceConfirmationResult = { ok: false };
    commandResult = { ok: false };
    rpcResult = { ok: false };
  }
  const projection = await inspectMarketplaceProjection(marketplaceRoot);
  const basis = normalizeObservation({
    selector,
    release,
    projectRoot,
    marketplaceRoot,
    marketplaceResult,
    marketplaceConfirmationResult,
    projection,
    commandResult,
    rpcResult,
  });
  const observationDigest = digestValue(basis, "builder-codex-host-observation");
  return deepFreeze({ ...basis, observationDigest });
}

export async function mutateCodexHost(options = {}) {
  assertBuilderPlatform();
  if (!options || typeof options !== "object" || Array.isArray(options)
    || !["marketplace-add", "plugin-add"].includes(options.operation)
    || !exactKeys(options, options.operation === "plugin-add"
      ? [
          "operation", "hostScope", "selector", "projectRoot", "release",
          "marketplaceObservation",
        ]
      : ["operation", "hostScope", "selector", "projectRoot", "release"])) {
    fail("AGENTMO_CODEX_HOST_OPERATION_REJECTED");
  }
  const release = releaseIdentity(options.release);
  const expectedSelector = buildCodexHostSelector(release);
  if (options.hostScope !== "user") fail("AGENTMO_CODEX_HOST_SCOPE_REJECTED");
  if (!sameSelector(options.selector, expectedSelector)) fail("AGENTMO_CODEX_HOST_SELECTOR_REJECTED");
  const projectRoot = admitProjectRoot(options.projectRoot);
  const stateRoot = await resolveStateRoot(options, true);
  const marketplaceRoot = path.join(stateRoot, CODEX_MARKETPLACE_DIRECTORY);
  if (options.operation === "plugin-add"
    && !exactMarketplaceObservation(options.marketplaceObservation)) {
    fail("AGENTMO_CODEX_HOST_MARKETPLACE_NOT_ADMITTED");
  }
  if (options.operation === "marketplace-add") {
    const projection = await inspectMarketplaceProjection(marketplaceRoot);
    if (!projection.available) fail("AGENTMO_CODEX_HOST_MARKETPLACE_SOURCE_NOT_ADMITTED");
  }
  const args = options.operation === "marketplace-add"
    ? ["plugin", "marketplace", "add", marketplaceRoot, "--json"]
    : ["plugin", "add", SELECTOR.pluginId, "--json"];
  let result;
  try {
    result = await officialCommandTransport({
      kind: "command",
      command: "codex",
      args,
      cwd: stateRoot,
      env: minimalCodexEnvironment(),
      shell: false,
      timeoutMs: HOST_TIMEOUT_MS,
      maxBytes: MAX_HOST_BYTES,
      releaseVersion: release.version,
    });
  } catch {
    fail("AGENTMO_CODEX_HOST_COMMAND_FAILED");
  }
  if (!result?.ok) fail("AGENTMO_CODEX_HOST_COMMAND_FAILED");
  return deepFreeze({
    schemaVersion: "agentmo.builder-codex-host-mutation.v1",
    hostScope: "user",
    operation: options.operation,
    selector: expectedSelector,
    status: "submitted",
    mutatesHost: true,
  });
}

export function buildCodexSelectorOwnerRecord(input) {
  const release = releaseIdentity(input?.release);
  const selector = buildCodexHostSelector(release);
  if (!sameSelector(input?.selector, selector)) fail("AGENTMO_CODEX_HOST_SELECTOR_REJECTED");
  if (!["created-by-agentmo", "preexisting-unowned"].includes(input?.disposition)) {
    fail("AGENTMO_CODEX_HOST_OWNER_INVALID");
  }
  if (!DIGEST_PATTERN.test(input?.sourceDigest ?? "")) fail("AGENTMO_CODEX_HOST_OWNER_INVALID");
  return deepFreeze({
    schemaVersion: "agentmo.codex-selector-owner.v1",
    selector,
    disposition: input.disposition,
    release,
    sourceDigest: input.sourceDigest,
  });
}

export function buildCodexConsumerEntry(input) {
  if (!sameSelector(input?.selector, SELECTOR)
    || !DIGEST_PATTERN.test(input?.projectScopeDigest ?? "")
    || !DIGEST_PATTERN.test(input?.releaseDigest ?? "")) {
    fail("AGENTMO_CODEX_HOST_CONSUMER_INVALID");
  }
  return deepFreeze({
    consumerId: input.projectScopeDigest,
    projectScopeDigest: input.projectScopeDigest,
    releaseDigest: input.releaseDigest,
    selector: { ...SELECTOR },
  });
}

export function buildCodexConsumerLedger(input) {
  if (!sameSelector(input?.selector, SELECTOR) || !Array.isArray(input?.consumers)) {
    fail("AGENTMO_CODEX_HOST_LEDGER_INVALID");
  }
  const consumers = input.consumers.map(validateConsumerEntry)
    .toSorted((left, right) => left.consumerId.localeCompare(right.consumerId));
  if (new Set(consumers.map((entry) => entry.consumerId)).size !== consumers.length) {
    fail("AGENTMO_CODEX_HOST_LEDGER_INVALID");
  }
  return deepFreeze({
    schemaVersion: "agentmo.codex-consumer-ledger.v1",
    selector: { ...SELECTOR },
    consumers,
  });
}

export function digestCodexSelectorOwnerRecord(record) {
  return digestValue(validateOwnerRecord(record), CODEX_SELECTOR_OWNER_FILE);
}

export function digestCodexConsumerEntry(entry) {
  return digestValue(validateConsumerEntry(entry), "codex-consumer-entry");
}

export function digestCodexConsumerLedger(ledger) {
  return digestValue(validateConsumerLedger(ledger), CODEX_CONSUMER_LEDGER_FILE);
}

export async function acquireCodexSelectorStateReservation(options = {}) {
  assertBuilderPlatform();
  const expected = admitReservationExpectation(options);
  if (!RESERVATION_PURPOSES.has(options.purpose)
    || !DIGEST_PATTERN.test(options.bindingDigest ?? "")) {
    fail("AGENTMO_CODEX_HOST_RESERVATION_INVALID");
  }
  const stateRoot = await resolveStateRoot(options, true);
  const snapshot = await requireConsistentSelectorSnapshot(stateRoot);
  if (snapshot.activeReservation !== null) {
    if (!sameActiveReservationRequest(snapshot.activeReservation, options, expected)) {
      fail("AGENTMO_CODEX_HOST_STATE_RESERVED");
    }
    return retainReservationToken(stateRoot, snapshot.activeReservation);
  }
  if (!sameExpectedState(snapshot.owner, expected.owner)
    || !sameExpectedState(snapshot.ledger, expected.ledger)) {
    fail("AGENTMO_CODEX_HOST_CAS_MISMATCH");
  }
  const tokenDigest = digestValue({
    schemaVersion: "agentmo.codex-selector-reservation-token.v1",
    purpose: options.purpose,
    bindingDigest: options.bindingDigest,
    expected,
    predecessorHeadDigest: snapshot.headDigest,
  }, "codex-selector-reservation-token");
  const payload = {
    schemaVersion: STATE_EVENT_SCHEMA_VERSION,
    kind: "reservation-acquired",
    purpose: options.purpose,
    bindingDigest: options.bindingDigest,
    expectedOwnerDigest: expected.owner.digest,
    expectedOwnerIdentityDigest: expected.owner.identityDigest,
    expectedLedgerDigest: expected.ledger.digest,
    expectedLedgerIdentityDigest: expected.ledger.identityDigest,
    predecessorHeadDigest: snapshot.headDigest,
    tokenDigest,
  };
  const appended = await appendHostStateRecord(stateRoot, {
    payload,
    expectedHeadDigest: snapshot.headDigest,
    idempotencyKey: `reservation:${tokenDigest.slice("sha256:".length)}`,
  }, "AGENTMO_CODEX_HOST_RESERVATION_CHANGED", "AGENTMO_CODEX_HOST_STATE_RESERVED");
  const after = await requireConsistentSelectorSnapshot(stateRoot);
  if (after.activeReservation?.recordDigest !== appended.digest) {
    fail("AGENTMO_CODEX_HOST_RESERVATION_CHANGED");
  }
  return retainReservationToken(stateRoot, after.activeReservation);
}

export async function releaseCodexSelectorStateReservation(reservation, outcome) {
  assertBuilderPlatform();
  if (!["committed", "aborted"].includes(outcome)) {
    fail("AGENTMO_CODEX_HOST_RESERVATION_INVALID");
  }
  const held = await assertStateReservation(reservation);
  const payload = {
    schemaVersion: STATE_EVENT_SCHEMA_VERSION,
    kind: "reservation-released",
    reservationDigest: held.acquisitionDigest,
    predecessorHeadDigest: held.headDigest,
    outcome,
  };
  const appended = await appendHostStateRecord(held.stateRoot, {
    payload,
    expectedHeadDigest: held.headDigest,
    idempotencyKey: `release:${held.acquisitionDigest.slice("sha256:".length)}:${outcome}`,
  }, "AGENTMO_CODEX_HOST_RESERVATION_CHANGED");
  const after = await requireConsistentSelectorSnapshot(held.stateRoot);
  if (after.activeReservation !== null || after.headDigest !== appended.headDigest) {
    fail("AGENTMO_CODEX_HOST_RESERVATION_CHANGED");
  }
  STATE_RESERVATIONS.delete(reservation);
  return deepFreeze({ status: "released", outcome, retained: true });
}

export async function assertCodexSelectorStateReservation(reservation) {
  assertBuilderPlatform();
  await assertStateReservation(reservation);
  return deepFreeze({ status: "held" });
}

export async function readCodexSelectorState(options = {}) {
  assertBuilderPlatform();
  if (!exactKeys(options, [])) fail("AGENTMO_CODEX_HOST_STATE_ROOT_REJECTED");
  const stateRoot = await resolveStateRoot(options, false);
  if (stateRoot === null) {
    return deepFreeze({ stateRootAvailable: false, owner: missingState(), ledger: missingState() });
  }
  const snapshot = await readSelectorStateAtRoot(stateRoot);
  return deepFreeze({ stateRootAvailable: true, owner: snapshot.owner, ledger: snapshot.ledger });
}

export async function writeCodexSelectorOwnerRecord(record, options = {}) {
  assertBuilderPlatform();
  return writeSelectorArtifact("owner", validateOwnerRecord(record), options);
}

export async function writeCodexConsumerLedger(ledger, options = {}) {
  assertBuilderPlatform();
  return writeSelectorArtifact("ledger", validateConsumerLedger(ledger), options);
}

export async function restoreCodexSelectorOwnerState(_priorState, _expectedCurrentDigest, _options = {}) {
  assertBuilderPlatform();
  fail("AGENTMO_CODEX_HOST_IMMUTABLE_STATE");
}

export async function restoreCodexConsumerLedgerState(_priorState, _expectedCurrentDigest, _options = {}) {
  assertBuilderPlatform();
  fail("AGENTMO_CODEX_HOST_IMMUTABLE_STATE");
}

export async function retractCodexSelectorState(_options = {}) {
  assertBuilderPlatform();
  fail("AGENTMO_CODEX_HOST_IMMUTABLE_STATE");
}

async function writeSelectorArtifact(kind, value, options) {
  const filename = kind === "owner" ? CODEX_SELECTOR_OWNER_FILE : CODEX_CONSUMER_LEDGER_FILE;
  const desiredDigest = digestValue(value, filename);
  return withStateReservation(
    options,
    `${kind}-write`,
    digestValue(value, `codex-${kind}-write-reservation`),
    async (reservation) => {
      const held = await assertStateReservation(reservation);
      const snapshot = await requireConsistentSelectorSnapshot(held.stateRoot);
      const current = snapshot[kind];
      const expected = admitWriteExpectation(options);
      const exactRetry = snapshot.records.toReversed().find((entry) => (
        entry.payload.kind === `${kind}-written`
        && entry.payload.reservationDigest === held.acquisitionDigest
        && entry.payload.artifactDigest === desiredDigest
        && entry.payload.predecessorDigest === expected.digest
        && entry.payload.predecessorIdentityDigest === expected.identityDigest
      ));
      if (exactRetry !== undefined) {
        return deepFreeze({
          status: "unchanged",
          digest: desiredDigest,
          identityDigest: exactRetry.digest,
          filename,
        });
      }
      if (!sameExpectedState(current, expected)) {
        fail("AGENTMO_CODEX_HOST_CAS_MISMATCH");
      }
      if (current.digest === desiredDigest) {
        return deepFreeze({
          status: "unchanged",
          digest: desiredDigest,
          identityDigest: current.identityDigest,
          filename,
        });
      }
      const payload = {
        schemaVersion: STATE_EVENT_SCHEMA_VERSION,
        kind: `${kind}-written`,
        reservationDigest: held.acquisitionDigest,
        predecessorHeadDigest: held.headDigest,
        predecessorDigest: current.digest,
        predecessorIdentityDigest: current.identityDigest,
        artifactDigest: desiredDigest,
        value,
      };
      const idempotencyDigest = digestValue(payload, `codex-${kind}-event-idempotency`);
      const appended = await appendHostStateRecord(held.stateRoot, {
        payload,
        expectedHeadDigest: held.headDigest,
        idempotencyKey: `${kind}:${idempotencyDigest.slice("sha256:".length)}`,
      }, "AGENTMO_CODEX_HOST_CAS_MISMATCH");
      held.headDigest = appended.headDigest;
      const after = await requireConsistentSelectorSnapshot(held.stateRoot);
      const effective = after[kind];
      if (effective.digest !== desiredDigest || effective.identityDigest !== appended.digest) {
        fail("AGENTMO_CODEX_HOST_PUBLICATION_FAILED");
      }
      return deepFreeze({
        status: "published",
        digest: desiredDigest,
        identityDigest: appended.digest,
        filename,
      });
    },
  );
}

async function withStateReservation(options, purpose, bindingDigest, operation) {
  if (options.reservation !== undefined) {
    const held = await assertStateReservation(options.reservation);
    const stateRoot = await resolveStateRoot({}, true);
    if (stateRoot !== held.stateRoot) fail("AGENTMO_CODEX_HOST_RESERVATION_INVALID");
    return operation(options.reservation);
  }
  const current = await readCodexSelectorState();
  const reservation = await acquireCodexSelectorStateReservation({
    purpose,
    bindingDigest,
    expectedOwnerDigest: current.owner.digest,
    expectedOwnerIdentityDigest: current.owner.identityDigest,
    expectedLedgerDigest: current.ledger.digest,
    expectedLedgerIdentityDigest: current.ledger.identityDigest,
  });
  try {
    const result = await operation(reservation);
    await releaseCodexSelectorStateReservation(reservation, "committed");
    return result;
  } catch (error) {
    if (STATE_RESERVATIONS.has(reservation)) {
      await releaseCodexSelectorStateReservation(reservation, "aborted").catch(() => {});
    }
    throw error;
  }
}

async function assertStateReservation(reservation) {
  const held = STATE_RESERVATIONS.get(reservation);
  if (held === undefined) fail("AGENTMO_CODEX_HOST_RESERVATION_INVALID");
  const snapshot = await requireConsistentSelectorSnapshot(held.stateRoot);
  if (snapshot.activeReservation?.recordDigest !== held.acquisitionDigest) {
    STATE_RESERVATIONS.delete(reservation);
    fail("AGENTMO_CODEX_HOST_RESERVATION_CHANGED");
  }
  held.headDigest = snapshot.headDigest;
  return held;
}

function retainReservationToken(stateRoot, active) {
  const reservation = Object.freeze({});
  STATE_RESERVATIONS.set(reservation, {
    stateRoot,
    acquisitionDigest: active.recordDigest,
    headDigest: active.headDigest,
  });
  return reservation;
}

function sameActiveReservationRequest(active, options, expected) {
  return active.purpose === options.purpose
    && active.bindingDigest === options.bindingDigest
    && active.expected.owner.digest === expected.owner.digest
    && active.expected.owner.identityDigest === expected.owner.identityDigest
    && active.expected.ledger.digest === expected.ledger.digest
    && active.expected.ledger.identityDigest === expected.ledger.identityDigest;
}

async function appendHostStateRecord(
  stateRoot,
  input,
  errorCode,
  conflictCode = errorCode,
) {
  try {
    const claim = await claimHostStateHead(stateRoot, input, conflictCode);
    const appended = await appendAppendOnlyRecord({
      projectRoot: stateRoot,
      relativeRoot: STATE_AUTHORITY_DIRECTORY,
      namespace: STATE_AUTHORITY_NAMESPACE,
      ...input,
    });
    await assertHostStateClaim(claim);
    return appended;
  } catch (error) {
    if (error instanceof BuilderCodexHostError) throw error;
    if (error instanceof BuilderAppendOnlyAuthorityError) fail(errorCode);
    throw error;
  }
}

async function claimHostStateHead(stateRoot, input, conflictCode) {
  if (!DIGEST_PATTERN.test(input.expectedHeadDigest ?? "")
    || typeof input.idempotencyKey !== "string"
    || input.idempotencyKey.length === 0) {
    fail("AGENTMO_CODEX_HOST_RESERVATION_CHANGED");
  }
  const claimRoot = path.join(stateRoot, STATE_CLAIM_DIRECTORY);
  const claim = hostStateClaim(input.expectedHeadDigest, input.idempotencyKey, input.payload);
  const claimPath = path.join(claimRoot, claim.filename);
  let rootAuthority;
  let claimAuthority;
  try {
    rootAuthority = await openExactDirectory(stateRoot, false);
    const directoryEffect = await runBuilderPosixEffect({
      action: "mkdir",
      name: path.basename(claimRoot),
      payload: "",
    }, {
      directoryAuthority: rootAuthority,
    });
    claimAuthority = await openExactDirectory(claimRoot, true);
    await assertExactDirectory(rootAuthority);
    if (directoryEffect.created !== true && directoryEffect.created !== false) {
      fail("AGENTMO_CODEX_HOST_RESERVATION_CHANGED");
    }
    await runBuilderPosixEffect({
      action: "write-file",
      name: path.basename(claimPath),
      payload: claim.bytes.toString("base64"),
    }, {
      directoryAuthority: claimAuthority,
    });
    await assertExactDirectory(claimAuthority);
    const exact = await readExactClaim(claimPath, claim.bytes);
    if (!exact) fail(conflictCode);
    await assertExactDirectory(rootAuthority);
    await assertExactDirectory(claimAuthority);
    return Object.freeze({ path: claimPath, bytes: claim.bytes });
  } catch (error) {
    if (error instanceof BuilderCodexHostError) throw error;
    fail("AGENTMO_CODEX_HOST_RESERVATION_CHANGED");
  } finally {
    await claimAuthority?.handle?.close().catch(() => {});
    await rootAuthority?.handle?.close().catch(() => {});
  }
}

function hostStateClaim(expectedHeadDigest, idempotencyKey, payload) {
  const value = {
    schemaVersion: STATE_CLAIM_SCHEMA_VERSION,
    expectedHeadDigest,
    idempotencyKey,
    payloadDigest: digestValue(payload, "codex-selector-state-claim-payload"),
  };
  return {
    filename: `${expectedHeadDigest.slice("sha256:".length)}.json`,
    bytes: Buffer.from(serializePersistableJson(value, {
      subject: "codex-selector-state-claim",
    }), "utf8"),
  };
}

async function assertHostStateClaim(claim) {
  if (!await readExactClaim(claim.path, claim.bytes)) {
    fail("AGENTMO_CODEX_HOST_RESERVATION_CHANGED");
  }
}

async function assertCompleteHostStateClaims(stateRoot, authority) {
  const claimRoot = path.join(stateRoot, STATE_CLAIM_DIRECTORY);
  let authorityHandle;
  try {
    authorityHandle = await openExactDirectory(claimRoot, true);
  } catch (error) {
    if (error?.code === "ENOENT" && authority.records.length === 0
      && authority.recoveryRequired === null) return null;
    if (error instanceof BuilderCodexHostError) {
      fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
    }
    throw error;
  }
  try {
    const expected = new Map();
    for (const record of authority.records) {
      const predecessor = record.payload?.predecessorHeadDigest;
      if (!DIGEST_PATTERN.test(predecessor ?? "")) {
        fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
      }
      const claim = hostStateClaim(predecessor, record.idempotencyKey, record.payload);
      if (expected.has(claim.filename)) fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
      expected.set(claim.filename, claim.bytes);
    }
    const before = await readdir(claimRoot, { withFileTypes: true });
    const after = await readdir(claimRoot, { withFileTypes: true });
    const exactTypes = (entries) => entries.every((entry) => entry.isFile()
      && !entry.isSymbolicLink());
    if (!exactTypes(before)
      || !exactTypes(after)
      || before.map((entry) => entry.name).sort().join("\n")
        !== after.map((entry) => entry.name).sort().join("\n")) {
      fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
    }
    for (const [filename, bytes] of expected) {
      if (!await readExactClaim(path.join(claimRoot, filename), bytes)) {
        fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
      }
    }
    const extras = before.filter((entry) => !expected.has(entry.name));
    if (before.length !== expected.size + extras.length || extras.length > 1) {
      fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
    }
    let pending = null;
    if (extras.length === 1) {
      const [entry] = extras;
      const expectedName = `${authority.headDigest.slice("sha256:".length)}.json`;
      if (entry.name !== expectedName) fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
      pending = await readAdmittedHostStateClaim(path.join(claimRoot, entry.name));
      if (pending.expectedHeadDigest !== authority.headDigest) {
        fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
      }
    }
    if (authority.recoveryRequired !== null) {
      if (pending === null
        || pending.idempotencyKey !== authority.recoveryRequired.idempotencyKey
        || pending.payloadDigest !== authority.recoveryRequired.payloadDigest) {
        fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
      }
    }
    await assertExactDirectory(authorityHandle);
    return pending;
  } finally {
    await authorityHandle?.handle?.close().catch(() => {});
  }
}

async function readAdmittedHostStateClaim(claimPath) {
  let handle;
  try {
    const initial = await lstat(claimPath, { bigint: true });
    if (!safeClaimFile(initial)) fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
    handle = await open(claimPath, FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const final = await lstat(claimPath, { bigint: true });
    if (!safeClaimFile(before)
      || !sameClaimFile(before, after)
      || !sameClaimFile(after, final)) {
      fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
    }
    let value;
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
    }
    if (!value
      || typeof value !== "object"
      || Array.isArray(value)
      || Object.keys(value).sort().join("\n")
        !== ["expectedHeadDigest", "idempotencyKey", "payloadDigest", "schemaVersion"].sort().join("\n")
      || value.schemaVersion !== STATE_CLAIM_SCHEMA_VERSION
      || !DIGEST_PATTERN.test(value.expectedHeadDigest ?? "")
      || typeof value.idempotencyKey !== "string"
      || value.idempotencyKey.length === 0
      || !DIGEST_PATTERN.test(value.payloadDigest ?? "")
      || !bytes.equals(Buffer.from(serializePersistableJson(value, {
        subject: "codex-selector-state-claim",
      }), "utf8"))) {
      fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
    }
    return Object.freeze(value);
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function readExactClaim(claimPath, expectedBytes) {
  let handle;
  try {
    const initial = await lstat(claimPath, { bigint: true });
    if (!safeClaimFile(initial) || initial.size !== BigInt(expectedBytes.byteLength)) return false;
    handle = await open(claimPath, FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const final = await lstat(claimPath, { bigint: true });
    return safeClaimFile(before)
      && sameClaimFile(before, after)
      && sameClaimFile(after, final)
      && bytes.equals(expectedBytes);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

function safeClaimFile(stats) {
  return Boolean(stats?.isFile() && !stats.isSymbolicLink()
    && stats.nlink === 1n
    && (stats.mode & 0o777n) === 0o600n
    && stats.uid === BigInt(process.getuid())
    && stats.size <= BigInt(MAX_HOST_BYTES));
}

function sameClaimFile(left, right) {
  return Boolean(left && right
    && left.dev === right.dev
    && left.ino === right.ino
    && left.uid === right.uid
    && left.gid === right.gid
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs);
}

async function openExactDirectory(directory, managed) {
  let handle;
  try {
    handle = await open(
      directory,
      FS_CONSTANTS.O_RDONLY
        | FS_CONSTANTS.O_DIRECTORY
        | FS_CONSTANTS.O_NOFOLLOW,
    );
    const stats = await handle.stat({ bigint: true });
    const current = await lstat(directory, { bigint: true });
    const mode = stats.mode & 0o777n;
    if (!stats.isDirectory() || stats.isSymbolicLink()
      || current.isSymbolicLink()
      || stats.dev !== current.dev
      || stats.ino !== current.ino
      || stats.uid !== BigInt(process.getuid())
      || current.uid !== stats.uid
      || (managed ? mode !== 0o700n : (mode & 0o022n) !== 0n)) {
      fail("AGENTMO_CODEX_HOST_RESERVATION_CHANGED");
    }
    return {
      directory,
      path: directory,
      managed,
      handle,
      identity: directoryIdentity(stats),
    };
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error instanceof BuilderCodexHostError) throw error;
    throw error;
  }
}

async function assertExactDirectory(authority) {
  const retained = await authority.handle.stat({ bigint: true });
  const current = await lstat(authority.directory, { bigint: true });
  const expected = authority.identity;
  const mode = retained.mode & 0o777n;
  if (!retained.isDirectory() || retained.isSymbolicLink()
    || current.isSymbolicLink()
    || retained.dev.toString(10) !== expected.device
    || retained.ino.toString(10) !== expected.inode
    || retained.uid.toString(10) !== expected.uid
    || retained.gid.toString(10) !== expected.gid
    || (retained.mode & 0o777n).toString(8) !== expected.mode
    || current.dev !== retained.dev
    || current.ino !== retained.ino
    || current.uid !== retained.uid
    || current.gid !== retained.gid
    || current.mode !== retained.mode
    || (authority.managed ? mode !== 0o700n : (mode & 0o022n) !== 0n)) {
    fail("AGENTMO_CODEX_HOST_RESERVATION_CHANGED");
  }
}

function directoryIdentity(stats) {
  return {
    device: stats.dev.toString(10),
    inode: stats.ino.toString(10),
    uid: stats.uid.toString(10),
    gid: stats.gid.toString(10),
    mode: (stats.mode & 0o777n).toString(8),
  };
}

async function readSelectorStateAtRoot(stateRoot) {
  const [legacyOwner, legacyLedger] = await Promise.all([
    readLegacyStateArtifact(
      path.join(stateRoot, CODEX_SELECTOR_OWNER_FILE),
      validateOwnerRecord,
      CODEX_SELECTOR_OWNER_FILE,
    ),
    readLegacyStateArtifact(
      path.join(stateRoot, CODEX_CONSUMER_LEDGER_FILE),
      validateConsumerLedger,
      CODEX_CONSUMER_LEDGER_FILE,
    ),
  ]);
  if (legacyOwner.status === "inconsistent" || legacyLedger.status === "inconsistent") {
    return inconsistentSelectorSnapshot();
  }
  let authority;
  try {
    authority = await readAppendOnlyAuthority({
      projectRoot: stateRoot,
      relativeRoot: STATE_AUTHORITY_DIRECTORY,
      namespace: STATE_AUTHORITY_NAMESPACE,
    });
  } catch (error) {
    if (error instanceof BuilderAppendOnlyAuthorityError) return inconsistentSelectorSnapshot();
    throw error;
  }
  try {
    const pendingClaim = await assertCompleteHostStateClaims(stateRoot, authority);
    return replaySelectorAuthority(authority, legacyOwner, legacyLedger, pendingClaim);
  } catch (error) {
    if (error instanceof BuilderCodexHostError) return inconsistentSelectorSnapshot();
    throw error;
  }
}

async function requireConsistentSelectorSnapshot(stateRoot) {
  const snapshot = await readSelectorStateAtRoot(stateRoot);
  if (snapshot.inconsistent) fail("AGENTMO_CODEX_HOST_RESERVATION_CHANGED");
  return snapshot;
}

function replaySelectorAuthority(authority, legacyOwner, legacyLedger, pendingClaim = null) {
  if (authority.recoveryRequired !== null
    && (pendingClaim === null
      || pendingClaim.idempotencyKey !== authority.recoveryRequired.idempotencyKey
      || pendingClaim.payloadDigest !== authority.recoveryRequired.payloadDigest)) {
    fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
  }
  let owner = legacyOwner;
  let ledger = legacyLedger;
  let activeReservation = null;
  let projectionTransaction = null;
  for (const record of authority.records) {
    const payload = record.payload;
    const expectedSchemaVersion = PROJECTION_BATCH_EVENT_KINDS.has(payload?.kind)
      ? PROJECTION_BATCH_EVENT_SCHEMA_VERSION
      : PROJECTION_EVENT_KINDS.has(payload?.kind)
        ? PROJECTION_EVENT_SCHEMA_VERSION
        : STATE_EVENT_SCHEMA_VERSION;
    if (payload?.schemaVersion !== expectedSchemaVersion) {
      fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
    }
    if (payload.kind === "reservation-acquired") {
      requireExactKeys(payload, [
        "schemaVersion", "kind", "purpose", "bindingDigest",
        "expectedOwnerDigest", "expectedOwnerIdentityDigest",
        "expectedLedgerDigest", "expectedLedgerIdentityDigest",
        "predecessorHeadDigest", "tokenDigest",
      ]);
      if (activeReservation !== null || !RESERVATION_PURPOSES.has(payload.purpose)
        || !DIGEST_PATTERN.test(payload.bindingDigest ?? "")
        || !DIGEST_PATTERN.test(payload.predecessorHeadDigest ?? "")
        || !DIGEST_PATTERN.test(payload.tokenDigest ?? "")) {
        fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
      }
      const expected = {
        owner: admitStatePair(payload.expectedOwnerDigest, payload.expectedOwnerIdentityDigest),
        ledger: admitStatePair(payload.expectedLedgerDigest, payload.expectedLedgerIdentityDigest),
      };
      if (!sameExpectedState(owner, expected.owner) || !sameExpectedState(ledger, expected.ledger)) {
        fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
      }
      activeReservation = {
        recordDigest: record.digest,
        purpose: payload.purpose,
        bindingDigest: payload.bindingDigest,
        expected,
        tokenDigest: payload.tokenDigest,
        headDigest: authority.headDigest,
      };
      continue;
    }
    if (payload.kind === "owner-written" || payload.kind === "ledger-written") {
      requireExactKeys(payload, [
        "schemaVersion", "kind", "reservationDigest", "predecessorDigest",
        "predecessorIdentityDigest", "predecessorHeadDigest", "artifactDigest", "value",
      ]);
      if (activeReservation === null
        || payload.reservationDigest !== activeReservation.recordDigest
        || !DIGEST_PATTERN.test(payload.predecessorHeadDigest ?? "")) {
        fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
      }
      const kind = payload.kind === "owner-written" ? "owner" : "ledger";
      const filename = kind === "owner" ? CODEX_SELECTOR_OWNER_FILE : CODEX_CONSUMER_LEDGER_FILE;
      const validator = kind === "owner" ? validateOwnerRecord : validateConsumerLedger;
      const current = kind === "owner" ? owner : ledger;
      if (payload.predecessorDigest !== current.digest
        || payload.predecessorIdentityDigest !== current.identityDigest
        || !DIGEST_PATTERN.test(payload.artifactDigest ?? "")) {
        fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
      }
      const value = validator(payload.value);
      if (digestValue(value, filename) !== payload.artifactDigest) {
        fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
      }
      const effective = deepFreeze({
        status: "valid",
        digest: payload.artifactDigest,
        identityDigest: record.digest,
        value,
      });
      if (kind === "owner") owner = effective;
      else ledger = effective;
      continue;
    }
    if (payload.kind === "projection-manifest") {
      requireExactKeys(payload, [
        "schemaVersion", "kind", "reservationDigest", "transactionId",
        "predecessorHeadDigest", "manifestDigest", "manifest",
      ]);
      if (activeReservation === null
        || payload.reservationDigest !== activeReservation.recordDigest
        || !DIGEST_PATTERN.test(payload.predecessorHeadDigest ?? "")) {
        fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
      }
      const manifest = validateProjectionManifest(payload.manifest);
      const manifestDigest = digestValue(manifest, "codex-marketplace-projection-manifest");
      const transactionId = manifestDigest.slice("sha256:".length);
      if (payload.manifestDigest !== manifestDigest
        || payload.transactionId !== transactionId
        || projectionTransaction !== null) {
        fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
      }
      projectionTransaction = {
        transactionId,
        manifestDigest,
        manifest,
        pendingIntent: null,
        pendingBatch: null,
        observed: [],
        complete: null,
        createdDuringTransaction: false,
      };
      continue;
    }
    if (payload.kind === "projection-intent") {
      requireExactKeys(payload, [
        "schemaVersion", "kind", "reservationDigest", "transactionId",
        "predecessorHeadDigest", "memberIndex",
      ]);
      if (activeReservation === null
        || payload.reservationDigest !== activeReservation.recordDigest
        || !DIGEST_PATTERN.test(payload.predecessorHeadDigest ?? "")
        || projectionTransaction === null
        || projectionTransaction.complete !== null
        || payload.transactionId !== projectionTransaction.transactionId
        || projectionTransaction.pendingIntent !== null
        || projectionTransaction.pendingBatch !== null
        || payload.memberIndex !== projectionTransaction.observed.length
        || payload.memberIndex >= projectionTransaction.manifest.members.length) {
        fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
      }
      projectionTransaction.pendingIntent = payload.memberIndex;
      continue;
    }
    if (payload.kind === "projection-observed") {
      requireExactKeys(payload, [
        "schemaVersion", "kind", "reservationDigest", "transactionId",
        "predecessorHeadDigest", "memberIndex", "observed",
      ]);
      if (activeReservation === null
        || payload.reservationDigest !== activeReservation.recordDigest
        || !DIGEST_PATTERN.test(payload.predecessorHeadDigest ?? "")
        || projectionTransaction === null
        || projectionTransaction.complete !== null
        || payload.transactionId !== projectionTransaction.transactionId
        || projectionTransaction.pendingBatch !== null
        || payload.memberIndex !== projectionTransaction.pendingIntent) {
        fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
      }
      const member = projectionTransaction.manifest.members[payload.memberIndex];
      const observed = validateProjectionObserved(payload.observed, member);
      projectionTransaction.observed.push(observed);
      projectionTransaction.pendingIntent = null;
      projectionTransaction.createdDuringTransaction = true;
      continue;
    }
    if (payload.kind === "projection-batch-intent") {
      requireExactKeys(payload, [
        "schemaVersion", "kind", "reservationDigest", "transactionId",
        "manifestDigest", "predecessorHeadDigest", "startMemberIndex",
        "endMemberIndex",
      ]);
      const memberCount = payload.endMemberIndex - payload.startMemberIndex;
      if (activeReservation === null
        || payload.reservationDigest !== activeReservation.recordDigest
        || !DIGEST_PATTERN.test(payload.predecessorHeadDigest ?? "")
        || projectionTransaction === null
        || projectionTransaction.complete !== null
        || payload.transactionId !== projectionTransaction.transactionId
        || payload.manifestDigest !== projectionTransaction.manifestDigest
        || projectionTransaction.pendingIntent !== null
        || projectionTransaction.pendingBatch !== null
        || !Number.isSafeInteger(payload.startMemberIndex)
        || !Number.isSafeInteger(payload.endMemberIndex)
        || payload.startMemberIndex !== projectionTransaction.observed.length
        || memberCount <= 0
        || memberCount > MAX_PROJECTION_BATCH_MEMBERS
        || payload.endMemberIndex > projectionTransaction.manifest.members.length) {
        fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
      }
      projectionTransaction.pendingBatch = {
        startMemberIndex: payload.startMemberIndex,
        endMemberIndex: payload.endMemberIndex,
      };
      continue;
    }
    if (payload.kind === "projection-batch-observed") {
      requireExactKeys(payload, [
        "schemaVersion", "kind", "reservationDigest", "transactionId",
        "manifestDigest", "predecessorHeadDigest", "startMemberIndex",
        "endMemberIndex", "observed",
      ]);
      const pendingBatch = projectionTransaction?.pendingBatch ?? null;
      if (activeReservation === null
        || payload.reservationDigest !== activeReservation.recordDigest
        || !DIGEST_PATTERN.test(payload.predecessorHeadDigest ?? "")
        || projectionTransaction === null
        || projectionTransaction.complete !== null
        || payload.transactionId !== projectionTransaction.transactionId
        || payload.manifestDigest !== projectionTransaction.manifestDigest
        || projectionTransaction.pendingIntent !== null
        || pendingBatch === null
        || payload.startMemberIndex !== pendingBatch.startMemberIndex
        || payload.endMemberIndex !== pendingBatch.endMemberIndex
        || !Array.isArray(payload.observed)
        || payload.observed.length
          !== pendingBatch.endMemberIndex - pendingBatch.startMemberIndex) {
        fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
      }
      for (let offset = 0; offset < payload.observed.length; offset += 1) {
        const memberIndex = pendingBatch.startMemberIndex + offset;
        projectionTransaction.observed.push(validateProjectionObserved(
          payload.observed[offset],
          projectionTransaction.manifest.members[memberIndex],
        ));
      }
      projectionTransaction.pendingBatch = null;
      projectionTransaction.createdDuringTransaction = true;
      continue;
    }
    if (payload.kind === "projection-complete") {
      requireExactKeys(payload, [
        "schemaVersion", "kind", "reservationDigest", "transactionId",
        "predecessorHeadDigest", "bindingDigest", "binding",
      ]);
      if (activeReservation === null
        || payload.reservationDigest !== activeReservation.recordDigest
        || !DIGEST_PATTERN.test(payload.predecessorHeadDigest ?? "")
        || projectionTransaction === null
        || projectionTransaction.complete !== null
        || payload.transactionId !== projectionTransaction.transactionId
        || projectionTransaction.pendingIntent !== null
        || projectionTransaction.pendingBatch !== null
        || projectionTransaction.observed.length
          !== projectionTransaction.manifest.members.length) {
        fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
      }
      const binding = validateProjectionBinding(
        payload.binding,
        projectionTransaction.manifest,
        projectionTransaction.observed,
      );
      if (payload.bindingDigest
          !== digestValue(binding, "codex-marketplace-projection-binding")) {
        fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
      }
      projectionTransaction.complete = {
        bindingDigest: payload.bindingDigest,
        binding,
      };
      continue;
    }
    if (payload.kind === "reservation-released") {
      requireExactKeys(payload, [
        "schemaVersion", "kind", "reservationDigest", "predecessorHeadDigest", "outcome",
      ]);
      if (activeReservation === null
        || payload.reservationDigest !== activeReservation.recordDigest
        || !DIGEST_PATTERN.test(payload.predecessorHeadDigest ?? "")
        || !["committed", "aborted"].includes(payload.outcome)) {
        fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
      }
      activeReservation = null;
      continue;
    }
    fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
  }
  if (activeReservation !== null) activeReservation.headDigest = authority.headDigest;
  return {
    inconsistent: false,
    owner,
    ledger,
    activeReservation,
    projectionTransaction,
    headDigest: authority.headDigest,
    records: authority.records,
  };
}

async function readLegacyStateArtifact(filePath, validator, subject) {
  let handle;
  try {
    const initial = await lstat(filePath, { bigint: true });
    if (!safeLegacyFile(initial) || initial.size > BigInt(MAX_HOST_BYTES)) return inconsistentState();
    handle = await open(filePath, FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const final = await lstat(filePath, { bigint: true });
    if (!sameStableLegacyFile(before, after) || !sameStableLegacyFile(after, final)
      || BigInt(bytes.byteLength) !== final.size) return inconsistentState();
    const value = validator(JSON.parse(bytes.toString("utf8")));
    const canonical = Buffer.from(serializePersistableJson(value, { subject }), "utf8");
    if (!canonical.equals(bytes)) return inconsistentState();
    return deepFreeze({
      status: "valid",
      digest: digestRawBytes(bytes),
      identityDigest: digestFileIdentity(final),
      value,
    });
  } catch (error) {
    if (error?.code === "ENOENT") return missingState();
    return inconsistentState();
  } finally {
    await handle?.close().catch(() => {});
  }
}

function safeLegacyFile(stats) {
  return Boolean(stats?.isFile() && !stats.isSymbolicLink() && stats.nlink === 1n
    && (Number(stats.mode) & 0o022) === 0
    && (typeof process.getuid !== "function" || stats.uid === BigInt(process.getuid())));
}

function sameStableLegacyFile(left, right) {
  return Boolean(safeLegacyFile(left) && safeLegacyFile(right)
    && left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.uid === right.uid && left.gid === right.gid && left.mode === right.mode
    && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs);
}

function inconsistentSelectorSnapshot() {
  return {
    inconsistent: true,
    owner: inconsistentState(),
    ledger: inconsistentState(),
    activeReservation: null,
    projectionTransaction: null,
    headDigest: null,
    records: [],
  };
}

function admitReservationExpectation(options) {
  const allowed = new Set([
    "purpose",
    "bindingDigest",
    "expectedOwnerDigest",
    "expectedOwnerIdentityDigest",
    "expectedLedgerDigest",
    "expectedLedgerIdentityDigest",
  ]);
  if (!options || typeof options !== "object" || Array.isArray(options)
    || Object.keys(options).some((key) => !allowed.has(key))) {
    fail("AGENTMO_CODEX_HOST_RESERVATION_INVALID");
  }
  return {
    owner: admitStatePair(options.expectedOwnerDigest, options.expectedOwnerIdentityDigest),
    ledger: admitStatePair(options.expectedLedgerDigest, options.expectedLedgerIdentityDigest),
  };
}

function admitWriteExpectation(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)
    || Object.keys(options).some((key) => ![
      "expectedPriorDigest", "expectedPriorIdentityDigest", "reservation",
    ].includes(key))
    || !["expectedPriorDigest", "expectedPriorIdentityDigest"].every(
      (key) => Object.hasOwn(options, key),
    )) {
    fail("AGENTMO_CODEX_HOST_CAS_INVALID");
  }
  return admitStatePair(options.expectedPriorDigest, options.expectedPriorIdentityDigest);
}

function admitStatePair(digest, identityDigest) {
  if (digest === null && identityDigest === null) return { digest: null, identityDigest: null };
  if (!DIGEST_PATTERN.test(digest ?? "") || !DIGEST_PATTERN.test(identityDigest ?? "")) {
    fail("AGENTMO_CODEX_HOST_CAS_INVALID");
  }
  return { digest, identityDigest };
}

function sameExpectedState(actual, expected) {
  return expected.digest === null
    ? actual.status === "missing" && actual.digest === null && actual.identityDigest === null
    : actual.status === "valid"
      && actual.digest === expected.digest
      && actual.identityDigest === expected.identityDigest;
}

async function officialObservationTransport(request) {
  if (request.kind === "command") return officialCommandTransport(request);
  if (request.kind !== "rpc") return { ok: false };
  return runAppServer(request);
}

async function officialCommandTransport(request) {
  const result = await runBoundedHostCommand(request);
  return result.ok
    ? { ok: true, stdout: result.stdout }
    : { ok: false };
}

function runBoundedHostCommand(request) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(request.command, request.args, {
        cwd: request.cwd,
        env: request.env,
        windowsHide: true,
        shell: false,
        stdio: ["ignore", "pipe", "ignore"],
        // Builder is POSIX-only. Isolate every PATH-selected command so a
        // direct child cannot leave a daemon holding this pipe after exit.
        detached: true,
      });
    } catch {
      resolve({ ok: false, stdout: "" });
      return;
    }
    const chunks = [];
    let stdoutBytes = 0;
    let terminal = false;
    let directExited = false;
    let directClosed = false;
    let settled = false;
    let timeout = null;
    let cleanExitGrace = null;
    let terminalSettlementGrace = null;
    const destroyChildStreams = () => {
      try {
        child.stdout?.destroy();
      } catch {
        // A failed or already-closed pipe cannot prevent fail-closed settlement.
      }
    };
    const lifecycle = createIsolatedProcessGroup(child, HOST_TERMINATION_GRACE_MS, () => {
      destroyChildStreams();
    });
    const capturedStdout = () => Buffer.concat(chunks).toString("utf8");
    const clearTimers = () => {
      if (timeout !== null) clearTimeout(timeout);
      if (cleanExitGrace !== null) clearTimeout(cleanExitGrace);
      if (terminalSettlementGrace !== null) clearTimeout(terminalSettlementGrace);
      timeout = null;
      cleanExitGrace = null;
      terminalSettlementGrace = null;
    };
    const settleAfterReap = (code) => {
      if (settled) return;
      settled = true;
      clearTimers();
      lifecycle.dispose();
      resolve({
        ok: !terminal && code === 0,
        stdout: terminal ? "" : capturedStdout(),
      });
    };
    const waitForGroupReap = (code) => {
      lifecycle.waitForDeath().then(() => settleAfterReap(code));
    };
    const scheduleTerminalSettlement = () => {
      waitForGroupReap(null);
      if (terminalSettlementGrace !== null || settled) return;
      terminalSettlementGrace = setTimeout(() => {
        terminalSettlementGrace = null;
        settleAfterReap(null);
      }, HOST_TERMINATION_GRACE_MS * 2);
    };
    const failClosed = () => {
      if (terminal || settled) return;
      terminal = true;
      if (cleanExitGrace !== null) clearTimeout(cleanExitGrace);
      cleanExitGrace = null;
      lifecycle.requestShutdown();
      // Close inherited stdout so an escaped descendant cannot extend this path.
      destroyChildStreams();
      try {
        child.unref();
      } catch {
        // A failed unref cannot extend the bounded terminal path.
      }
      scheduleTerminalSettlement();
    };
    child.once("error", () => {
      failClosed();
    });
    child.once("exit", (code, signal) => {
      if (code !== 0 || signal !== null) {
        failClosed();
        return;
      }
      if (chunks.length === 0) return failClosed();
      directExited = true;
      cleanExitGrace = setTimeout(() => {
        cleanExitGrace = null;
        if (terminal || settled) return;
        if (!directClosed || !lifecycle.isDead()) {
          failClosed();
        }
      }, HOST_TERMINATION_GRACE_MS);
    });
    child.once("close", (code) => {
      if (directClosed) return;
      directClosed = true;
      if (terminal) {
        scheduleTerminalSettlement();
        return;
      }
      if (lifecycle.isDead()) {
        if (cleanExitGrace !== null) clearTimeout(cleanExitGrace);
        cleanExitGrace = null;
        waitForGroupReap(code);
        return;
      }
      failClosed();
    });
    child.stdout.on("error", failClosed);
    child.stdout.on("data", (chunk) => {
      if (terminal || directExited) return;
      const bytes = Buffer.from(chunk);
      stdoutBytes += bytes.byteLength;
      if (stdoutBytes > request.maxBytes) {
        failClosed();
        return;
      }
      chunks.push(bytes);
    });
    timeout = setTimeout(failClosed, request.timeoutMs);
  });
}
async function runAppServer(request) {
  if (JSON.stringify(request.requests) !== JSON.stringify(OBSERVATION_REQUESTS)) return { ok: false };
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(request.command, request.args, {
        cwd: request.cwd,
        env: request.env,
        shell: false,
        stdio: ["pipe", "pipe", "ignore"],
        windowsHide: true,
        detached: true,
      });
    } catch {
      resolve({ ok: false });
      return;
    }
    const responses = new Map();
    let phase = "await-initialize";
    let buffered = "";
    let observedBytes = 0;
    let settled = false;
    let directClosed = false;
    let outcome = null;
    let timer = null;
    let terminalSettlementGrace = null;
    const closeInput = () => {
      if (child.stdin.destroyed || child.stdin.writableEnded) return;
      try {
        child.stdin.end();
      } catch {
        // Group reaping remains the terminal authority.
      }
    };
    const destroyChildStreams = () => {
      closeInput();
      try {
        child.stdin.destroy();
      } catch {
        // A closed input cannot prevent fail-closed settlement.
      }
      try {
        child.stdout.destroy();
      } catch {
        // A closed output cannot prevent fail-closed settlement.
      }
    };
    const lifecycle = createIsolatedProcessGroup(child, HOST_TERMINATION_GRACE_MS, () => {
      destroyChildStreams();
    });
    const clearTimers = () => {
      if (timer !== null) clearTimeout(timer);
      if (terminalSettlementGrace !== null) clearTimeout(terminalSettlementGrace);
      timer = null;
      terminalSettlementGrace = null;
    };
    const settleAfterReap = () => {
      if (settled) return;
      settled = true;
      clearTimers();
      lifecycle.dispose();
      closeInput();
      resolve(outcome ?? { ok: false });
    };
    const waitForGroupReap = () => {
      lifecycle.waitForDeath().then(settleAfterReap);
    };
    const scheduleTerminalSettlement = () => {
      waitForGroupReap();
      if (terminalSettlementGrace !== null || settled) return;
      terminalSettlementGrace = setTimeout(() => {
        terminalSettlementGrace = null;
        settleAfterReap();
      }, HOST_TERMINATION_GRACE_MS * 2);
    };
    const finish = (value) => {
      if (settled || outcome !== null) return;
      outcome = value;
      closeInput();
      lifecycle.requestShutdown();
      // A direct app-server child can leave an escaped descendant holding the
      // inherited stdout pipe. Drop both parent ends and settle on the bounded
      // reaping/fallback path instead of waiting for that descendant's close.
      destroyChildStreams();
      try {
        child.unref();
      } catch {
        // A failed unref cannot extend the bounded terminal path.
      }
      scheduleTerminalSettlement();
    };
    timer = setTimeout(() => finish({ ok: false }), request.timeoutMs);
    child.once("error", () => {
      finish({ ok: false });
    });
    child.once("exit", () => {
      if (outcome === null) finish({ ok: false });
      else scheduleTerminalSettlement();
    });
    child.stdin.on("error", () => finish({ ok: false }));
    child.stdout.once("error", () => finish({ ok: false }));
    child.once("close", () => {
      if (directClosed) return;
      directClosed = true;
      if (outcome === null) finish({ ok: false });
      else scheduleTerminalSettlement();
    });
    child.stdout.on("data", (chunk) => {
      if (outcome !== null) return;
      observedBytes += chunk.byteLength;
      if (observedBytes > request.maxBytes) return finish({ ok: false });
      buffered += chunk.toString("utf8");
      let newline = buffered.indexOf("\n");
      while (newline >= 0) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (line !== "") {
          try {
            const message = JSON.parse(line);
            if (!Number.isInteger(message?.id)) {
              newline = buffered.indexOf("\n");
              continue;
            }
            if (Object.hasOwn(message, "error") || !Object.hasOwn(message, "result")) {
              return finish({ ok: false });
            }
            if (phase === "await-initialize") {
              if (message.id !== 1) return finish({ ok: false });
              phase = "await-queries";
              for (const rpcRequest of request.requests.slice(1)) {
                child.stdin.write(`${JSON.stringify(rpcRequest)}\n`);
              }
            } else {
              if (![2, 3, 4].includes(message.id) || responses.has(message.id)) {
                return finish({ ok: false });
              }
              responses.set(message.id, message.result);
            }
          } catch {
            return finish({ ok: false });
          }
        }
        newline = buffered.indexOf("\n");
      }
      if (phase === "await-queries" && responses.size === 3
        && [2, 3, 4].every((id) => responses.has(id))) {
        finish({
          ok: true,
          responses: {
            plugin: responses.get(2),
            skills: responses.get(3),
            hooks: responses.get(4),
          },
        });
      }
    });
    try {
      child.stdin.write(`${JSON.stringify(request.requests[0])}\n`);
    } catch {
      finish({ ok: false });
    }
  });
}

function createIsolatedProcessGroup(child, graceMs, destroyStreams) {
  const processGroupId = Number.isSafeInteger(child.pid) && child.pid > 0 ? child.pid : null;
  let shutdownRequested = false;
  let confirmedDead = processGroupId === null;
  let forceKillTimer = null;
  let pollTimer = null;
  const waiters = [];
  const groupIsDead = () => {
    if (confirmedDead) return true;
    try {
      process.kill(-processGroupId, 0);
      return false;
    } catch (error) {
      if (error?.code === "ESRCH") {
        confirmedDead = true;
        return true;
      }
      return false;
    }
  };
  const signalGroup = (signal) => {
    if (processGroupId === null || groupIsDead()) return;
    try {
      process.kill(-processGroupId, signal);
    } catch {
      // The liveness probe below decides when this group is safe to release.
    }
  };
  const resolveWhenDead = () => {
    if (!groupIsDead()) return false;
    if (forceKillTimer !== null) clearTimeout(forceKillTimer);
    if (pollTimer !== null) clearTimeout(pollTimer);
    forceKillTimer = null;
    pollTimer = null;
    for (const resolve of waiters.splice(0)) resolve();
    return true;
  };
  const pollForDeath = () => {
    if (resolveWhenDead() || pollTimer !== null) return;
    pollTimer = setTimeout(() => {
      pollTimer = null;
      pollForDeath();
    }, 10);
  };
  return {
    requestShutdown() {
      if (shutdownRequested) return !confirmedDead;
      shutdownRequested = true;
      if (resolveWhenDead()) return false;
      signalGroup("SIGTERM");
      forceKillTimer = setTimeout(() => {
        if (!groupIsDead()) {
          signalGroup("SIGKILL");
          try {
            destroyStreams();
          } catch {
            // Group liveness remains the final proof of cleanup.
          }
        }
        pollForDeath();
      }, graceMs);
      pollForDeath();
      return true;
    },
    waitForDeath() {
      if (resolveWhenDead()) return Promise.resolve();
      return new Promise((resolve) => {
        waiters.push(resolve);
        pollForDeath();
      });
    },
    isDead() {
      return groupIsDead();
    },
    dispose() {
      if (forceKillTimer !== null) clearTimeout(forceKillTimer);
      if (pollTimer !== null) clearTimeout(pollTimer);
      forceKillTimer = null;
      pollTimer = null;
    },
  };
}

function normalizeObservation(input) {
  const marketplaceCandidates = extractMarketplaceCandidates(parseJson(input.marketplaceResult?.stdout))
    .filter((candidate) => marketplaceCandidateName(candidate) === SELECTOR.marketplaceName);
  const confirmedMarketplaceCandidates = extractMarketplaceCandidates(
    parseJson(input.marketplaceConfirmationResult?.stdout),
  ).filter((candidate) => marketplaceCandidateName(candidate) === SELECTOR.marketplaceName);
  const marketplaceSnapshotStable = input.marketplaceResult?.ok
    && input.marketplaceConfirmationResult?.ok
    && JSON.stringify(normalizeMarketplaceCandidates(marketplaceCandidates))
      === JSON.stringify(normalizeMarketplaceCandidates(confirmedMarketplaceCandidates));
  const marketplaceSourceMatch = marketplaceCandidates.length === 1
    && marketplaceCandidateSource(marketplaceCandidates[0]) === input.marketplaceRoot;
  const marketplaceRegistered = Boolean(input.marketplaceResult?.ok
    && marketplaceSnapshotStable
    && marketplaceCandidates.length === 1
    && marketplaceSourceMatch);
  const pluginCandidates = extractPluginCandidates(parseJson(input.commandResult?.stdout));
  const matchingPlugins = pluginCandidates.filter((candidate) => pluginCandidateId(candidate) === SELECTOR.pluginId);
  const plugin = matchingPlugins.length === 1 ? matchingPlugins[0] : null;
  const installed = Boolean(input.commandResult?.ok && plugin && marketplaceRegistered && input.projection.available);
  const enabled = installed && pluginEnabled(plugin);
  const sourceMatch = installed && pluginSourceMatches(plugin, input.projection.pluginRoot);
  const releaseMatch = installed && pluginVersion(plugin) === input.release.version;
  const skillRows = extractObservationRows(input.rpcResult?.responses?.skills);
  const hookRows = extractObservationRows(input.rpcResult?.responses?.hooks);
  const skillRowsExact = exactProjectRows(skillRows, input.projectRoot, "errors");
  const hookRowsExact = exactProjectRows(hookRows, input.projectRoot, "warnings", "errors");
  const skills = skillRowsExact ? extractNestedItems(skillRows, "skills") : [];
  const hooks = hookRowsExact ? extractNestedItems(hookRows, "hooks") : [];
  const skillVisible = Boolean(input.rpcResult?.ok && sourceMatch
    && skills.some((entry) => entry?.name === "agentmo"));
  const matchingHooks = hooks.filter((entry) => (
    entry?.pluginId === SELECTOR.pluginId && entry?.enabled === true
  ));
  const hooksVisible = Boolean(input.rpcResult?.ok && sourceMatch && matchingHooks.length === 1);
  const hookTrust = normalizeHookTrust(matchingHooks);
  // Every value above is reported by a PATH-selected external `codex` command.
  // It can establish bounded mechanism observations, but cannot supply the
  // independent immutable trust anchor required for a trusted activation.
  const trust = installed && enabled && skillVisible && hooksVisible
    ? "pending-human"
    : "unavailable";
  return {
    schemaVersion: "agentmo.builder-codex-host-observation.v1",
    availability: marketplaceSnapshotStable && input.commandResult?.ok && input.rpcResult?.ok
      ? "observed"
      : "unavailable",
    hostScope: "user",
    selector: input.selector,
    marketplace: {
      registration: !marketplaceSnapshotStable || marketplaceCandidates.length > 1
        ? "ambiguous"
        : marketplaceRegistered
          ? "registered"
          : "missing",
      sourceMatch: marketplaceSourceMatch,
      sourceAvailable: input.projection.available,
    },
    plugin: {
      installation: installed ? "installed" : input.commandResult?.ok ? "missing" : "unavailable",
      enabled: installed ? enabled : false,
      sourceMatch,
      releaseMatch,
    },
    skill: { visibility: skillVisible ? "visible" : input.rpcResult?.ok ? "missing" : "unavailable" },
    hooks: {
      visibility: hooksVisible ? "visible" : input.rpcResult?.ok ? "missing" : "unavailable",
      trust: hookTrust,
    },
    trust,
    agent: { hostVisibility: "unobservable" },
    // An external `codex` process is selected through the operator's PATH.
    // AgentMo does not grant that process a non-mutation attestation: even a
    // syntactically valid observation response can come from a command which
    // changed unrelated host state.
    mutatesHost: "unknown",
    externalCommandMutation: "unknown",
  };
}

function normalizeMarketplaceCandidates(candidates) {
  return candidates.map((candidate) => ({
    name: marketplaceCandidateName(candidate),
    source: marketplaceCandidateSource(candidate),
  })).toSorted((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function extractMarketplaceCandidates(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.marketplaces)) return value.marketplaces;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function marketplaceCandidateName(candidate) {
  return candidate?.name ?? candidate?.marketplaceName ?? candidate?.id ?? null;
}

function marketplaceCandidateSource(candidate) {
  const source = candidate?.source?.path ?? candidate?.source ?? candidate?.path;
  return typeof source === "string" && path.isAbsolute(source) ? path.resolve(source) : null;
}

function extractPluginCandidates(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.installed)) return value.installed;
  if (Array.isArray(value?.plugins)) return value.plugins;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function extractNestedItems(value, key) {
  const outer = extractObservationRows(value);
  return outer.flatMap((entry) => Array.isArray(entry?.[key]) ? entry[key] : []);
}

function extractObservationRows(value) {
  return Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : [];
}

function exactProjectRows(rows, projectRoot, ...diagnosticKeys) {
  if (rows.length !== 1 || typeof rows[0]?.cwd !== "string"
    || !canonicalPathMatches(projectRoot, rows[0].cwd)) return false;
  return diagnosticKeys.every((key) => Array.isArray(rows[0]?.[key]) && rows[0][key].length === 0);
}

function pluginCandidateId(plugin) {
  return plugin?.pluginId ?? plugin?.id ?? plugin?.selector ?? null;
}

function pluginEnabled(plugin) {
  return plugin?.enabled === true && plugin?.installed === true;
}

function pluginVersion(plugin) {
  return plugin?.version ?? plugin?.manifest?.version ?? null;
}

function pluginSourceMatches(plugin, expected) {
  const source = plugin?.source?.path ?? plugin?.sourcePath ?? plugin?.path;
  if (typeof source !== "string" || !path.isAbsolute(source)) return false;
  return path.resolve(source) === expected;
}

function exactMarketplaceObservation(value) {
  return exactKeys(value, ["registration", "sourceAvailable", "sourceMatch"])
    && value.registration === "registered"
    && value.sourceMatch === true
    && value.sourceAvailable === true;
}

async function inspectMarketplaceProjection(marketplaceRoot) {
  const pluginRoot = path.join(marketplaceRoot, "plugins", SELECTOR.pluginName);
  try {
    const [marketplaceStats, pluginStats] = await Promise.all([
      lstat(marketplaceRoot),
      lstat(pluginRoot),
    ]);
    const available = marketplaceStats.isDirectory() && !marketplaceStats.isSymbolicLink()
      && pluginStats.isDirectory() && !pluginStats.isSymbolicLink()
      && canonicalPathMatches(marketplaceRoot, await realpath(marketplaceRoot))
      && canonicalPathMatches(pluginRoot, await realpath(pluginRoot));
    return { available, pluginRoot };
  } catch {
    return { available: false, pluginRoot };
  }
}

async function inspectProjectionTree(root) {
  let rootStats;
  try {
    rootStats = await lstat(root, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    return { inconsistent: true };
  }
  if (!safeProjectionMetadata(rootStats, true)) return { inconsistent: true };
  const records = [];
  async function visit(directory, relativeDirectory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
      const relativePath = relativeDirectory === ""
        ? entry.name
        : path.join(relativeDirectory, entry.name);
      const absolute = path.join(directory, entry.name);
      const stats = await lstat(absolute, { bigint: true });
      if (entry.isSymbolicLink() || stats.isSymbolicLink()) throw new Error("unsafe");
      if (entry.isDirectory()) {
        if (!safeProjectionMetadata(stats, true)) throw new Error("unsafe");
        records.push({ kind: "directory", relativePath, identity: projectionMetadata(stats) });
        await visit(absolute, relativePath);
      } else if (entry.isFile()) {
        if (!safeProjectionMetadata(stats, false)
          || stats.size > BigInt(MAX_PROJECTION_FILE_BYTES)) throw new Error("unsafe");
        const handle = await open(absolute, FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW);
        try {
          const before = await handle.stat({ bigint: true });
          const bytes = await handle.readFile();
          const after = await handle.stat({ bigint: true });
          const final = await lstat(absolute, { bigint: true });
          if (!sameProjectionFile(before, after) || !sameProjectionFile(after, final)
            || BigInt(bytes.byteLength) !== final.size) throw new Error("unsafe");
          records.push({
            kind: "file",
            relativePath,
            digest: digestRawBytes(bytes),
            identity: projectionMetadata(final),
          });
        } finally {
          await handle.close();
        }
      } else {
        throw new Error("unsafe");
      }
    }
  }
  try {
    await visit(root, "");
    const finalRoot = await lstat(root, { bigint: true });
    if (digestProjectionRootIdentity(finalRoot) !== digestProjectionRootIdentity(rootStats)) {
      return { inconsistent: true };
    }
    return {
      inconsistent: false,
      contentDigest: digestValue({
        schemaVersion: "agentmo.codex-marketplace-projection-authority.v1",
        records,
      }, "codex-marketplace-projection-authority"),
      rootIdentityDigest: digestProjectionRootIdentity(rootStats),
    };
  } catch {
    return { inconsistent: true };
  }
}

function normalizeProjectionRequest(options, requireReservation) {
  const allowed = requireReservation
    ? ["contentDigest", "files", "marketplaceRoot", "releaseDigest", "reservation"]
    : ["contentDigest", "files", "marketplaceRoot", "releaseDigest"];
  if (!exactKeys(options, allowed)
    || typeof options.marketplaceRoot !== "string"
    || !path.isAbsolute(options.marketplaceRoot)
    || path.resolve(options.marketplaceRoot) !== options.marketplaceRoot
    || !DIGEST_PATTERN.test(options.releaseDigest ?? "")
    || !DIGEST_PATTERN.test(options.contentDigest ?? "")
    || !Array.isArray(options.files)
    || options.files.length === 0
    || options.files.length > MAX_PROJECTION_FILES) {
    fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
  }
  projectionStateRoot(options.marketplaceRoot);
  let totalProjectionBytes = 0;
  const files = options.files.map((file) => {
    if (!file || typeof file !== "object" || Array.isArray(file)
      || !exactKeys(file, ["bytes", "digest", "relativePath"])
      || !portableProjectionPath(file.relativePath)
      || !Buffer.isBuffer(file.bytes)
      || file.bytes.byteLength > MAX_PROJECTION_FILE_BYTES
      || !DIGEST_PATTERN.test(file.digest ?? "")
      || digestRawBytes(file.bytes) !== file.digest) {
      fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
    }
    totalProjectionBytes += file.bytes.byteLength;
    if (totalProjectionBytes > MAX_PROJECTION_TOTAL_FILE_BYTES) {
      fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
    }
    return Object.freeze({
      relativePath: file.relativePath,
      digest: file.digest,
      bytes: Buffer.from(file.bytes),
    });
  }).toSorted((left, right) => left.relativePath.localeCompare(right.relativePath));
  if (new Set(files.map((file) => file.relativePath)).size !== files.length) {
    fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
  }
  const directories = new Set();
  for (const file of files) {
    let directory = path.posix.dirname(file.relativePath);
    while (directory !== ".") {
      directories.add(directory);
      if (directories.size + files.length + 1 > MAX_PROJECTION_MEMBERS) {
        fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
      }
      directory = path.posix.dirname(directory);
    }
  }
  const members = [
    Object.freeze({ kind: "root", relativePath: "", digest: null }),
    ...[...directories]
      .toSorted((left, right) => {
        const depth = left.split("/").length - right.split("/").length;
        return depth === 0 ? left.localeCompare(right) : depth;
      })
      .map((relativePath) => Object.freeze({
        kind: "directory",
        relativePath,
        digest: null,
      })),
    ...files.map((file) => Object.freeze({
      kind: "file",
      relativePath: file.relativePath,
      digest: file.digest,
    })),
  ];
  if (members.length > MAX_PROJECTION_MEMBERS) {
    fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
  }
  const manifest = deepFreeze({
    schemaVersion: PROJECTION_MANIFEST_SCHEMA_VERSION,
    selector: { ...SELECTOR },
    releaseDigest: options.releaseDigest,
    contentDigest: options.contentDigest,
    members,
  });
  const manifestDigest = digestValue(manifest, "codex-marketplace-projection-manifest");
  return {
    marketplaceRoot: options.marketplaceRoot,
    files,
    fileByPath: new Map(files.map((file) => [file.relativePath, file])),
    manifest,
    manifestDigest,
    transactionId: manifestDigest.slice("sha256:".length),
  };
}

function validateProjectionManifest(value) {
  if (!exactKeys(value, [
    "schemaVersion", "selector", "releaseDigest", "contentDigest", "members",
  ])
    || value.schemaVersion !== PROJECTION_MANIFEST_SCHEMA_VERSION
    || !sameSelector(value.selector, SELECTOR)
    || !DIGEST_PATTERN.test(value.releaseDigest ?? "")
    || !DIGEST_PATTERN.test(value.contentDigest ?? "")
    || !Array.isArray(value.members)
    || value.members.length < 2
    || value.members.length > MAX_PROJECTION_MEMBERS) {
    fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
  }
  const members = value.members.map((member, index) => {
    if (!exactKeys(member, ["digest", "kind", "relativePath"])
      || !["root", "directory", "file"].includes(member.kind)
      || (index === 0) !== (member.kind === "root")
      || (member.kind === "root" && member.relativePath !== "")
      || (member.kind !== "root" && !portableProjectionPath(member.relativePath))
      || (member.kind === "file"
        ? !DIGEST_PATTERN.test(member.digest ?? "")
        : member.digest !== null)) {
      fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
    }
    return Object.freeze({ ...member });
  });
  if (new Set(members.map((member) => member.relativePath)).size !== members.length) {
    fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
  }
  const fileIndex = members.findIndex((member) => member.kind === "file");
  if (fileIndex < 1
    || members.slice(1, fileIndex).some((member) => member.kind !== "directory")
    || members.slice(fileIndex).some((member) => member.kind !== "file")
    || members.length - fileIndex > MAX_PROJECTION_FILES) {
    fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
  }
  for (const member of members.slice(1)) {
    const parent = path.posix.dirname(member.relativePath);
    if (parent !== "."
      && !members.some((candidate) => candidate.kind === "directory"
        && candidate.relativePath === parent)) {
      fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
    }
  }
  return deepFreeze({ ...value, members });
}

function validateProjectionObserved(value, member) {
  if (!exactKeys(value, ["digest", "identity", "kind", "relativePath"])
    || value.kind !== member.kind
    || value.relativePath !== member.relativePath
    || (member.kind === "file" ? value.digest !== member.digest : value.digest !== null)
    || !validProjectionIdentity(value.identity, member.kind === "file")) {
    fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
  }
  return deepFreeze({
    kind: value.kind,
    relativePath: value.relativePath,
    digest: value.digest,
    identity: { ...value.identity },
  });
}

function validateProjectionBinding(value, manifest, observed) {
  if (!exactKeys(value, [
    "schemaVersion", "transactionId", "transactionDigest", "releaseDigest",
    "contentDigest", "rootIdentity", "rootIdentityDigest", "members",
  ])
    || value.schemaVersion !== PROJECTION_BINDING_SCHEMA_VERSION
    || value.transactionDigest !== digestValue(manifest, "codex-marketplace-projection-manifest")
    || value.transactionId !== value.transactionDigest.slice("sha256:".length)
    || value.releaseDigest !== manifest.releaseDigest
    || value.contentDigest !== manifest.contentDigest
    || !validProjectionIdentity(value.rootIdentity, false)
    || value.rootIdentityDigest !== digestProjectionRootIdentityModel(value.rootIdentity)
    || !Array.isArray(value.members)
    || value.members.length !== observed.length) {
    fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
  }
  for (let index = 0; index < observed.length; index += 1) {
    const current = validateProjectionObserved(value.members[index], manifest.members[index]);
    if (!sameProjectionTransactionObserved(current, observed[index])) {
      fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
    }
  }
  return deepFreeze(value);
}

function validProjectionIdentity(value, file) {
  return exactKeys(value, [
    "device", "group", "inode", "links", "mode", "owner", "size",
  ])
    && ["device", "group", "inode", "links", "owner", "size"].every(
      (key) => /^\d+$/u.test(value[key] ?? ""),
    )
    && /^[0-7]{3,4}$/u.test(value.mode ?? "")
    && (file ? value.links === "1" : /^[1-9]\d*$/u.test(value.links ?? ""));
}

function projectionStateRoot(marketplaceRoot) {
  const marketplaceParent = path.dirname(marketplaceRoot);
  const stateRoot = path.dirname(marketplaceParent);
  if (marketplaceRoot !== path.join(stateRoot, CODEX_MARKETPLACE_DIRECTORY)) {
    fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
  }
  return stateRoot;
}

function projectionMemberPath(root, member) {
  return member.kind === "root"
    ? root
    : path.join(root, ...member.relativePath.split("/"));
}

async function appendProjectionEvent(held, payload, idempotencyKey) {
  const event = {
    ...payload,
    predecessorHeadDigest: held.headDigest,
  };
  const appended = await appendHostStateRecord(held.stateRoot, {
    payload: event,
    expectedHeadDigest: held.headDigest,
    idempotencyKey,
  }, "AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
  held.headDigest = appended.headDigest;
  const snapshot = await assertStateReservationTokenHeld(held);
  return { appended, snapshot };
}

async function assertStateReservationTokenHeld(held) {
  const snapshot = await requireConsistentSelectorSnapshot(held.stateRoot);
  if (snapshot.activeReservation?.recordDigest !== held.acquisitionDigest) {
    fail("AGENTMO_CODEX_HOST_RESERVATION_CHANGED");
  }
  held.headDigest = snapshot.headDigest;
  return snapshot;
}

async function applyProjectionMemberEffect(
  normalized,
  memberIndex,
  retainedParentAuthority = null,
) {
  const member = normalized.manifest.members[memberIndex];
  const absolute = projectionMemberPath(normalized.marketplaceRoot, member);
  const parent = path.dirname(absolute);
  let authority = retainedParentAuthority;
  let ownsAuthority = false;
  try {
    if (authority === null) {
      authority = await openExactDirectory(parent, true);
      ownsAuthority = true;
    } else if (path.resolve(authority.path) !== parent) {
      fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
    }
    const request = member.kind === "file"
      ? {
          action: "write-file",
          name: path.basename(absolute),
          payload: normalized.fileByPath.get(member.relativePath).bytes.toString("base64"),
        }
      : {
          action: "mkdir",
          name: path.basename(absolute),
          payload: "",
        };
    const effect = await runBuilderPosixEffect(request, {
      directoryAuthority: authority,
    });
    if (effect.created !== true) {
      fail("AGENTMO_CODEX_HOST_PROJECTION_PUBLICATION_FAILED");
    }
  } catch (error) {
    if (error instanceof BuilderCodexHostError) throw error;
    fail("AGENTMO_CODEX_HOST_PROJECTION_PUBLICATION_FAILED");
  } finally {
    if (ownsAuthority) await authority?.handle.close().catch(() => {});
  }
}

async function retainProjectionPrefix(normalized, records) {
  const retained = {
    entries: [],
    directoryByRelativePath: new Map(),
    rootParentAuthority: null,
  };
  try {
    for (let memberIndex = 0; memberIndex < records.length; memberIndex += 1) {
      await retainProjectionMember(
        normalized,
        retained,
        memberIndex,
        records[memberIndex],
      );
    }
    return retained;
  } catch (error) {
    await closeRetainedProjectionPrefix(retained);
    throw error;
  }
}

async function retainProjectionMember(normalized, retained, memberIndex, observed) {
  const member = normalized.manifest.members[memberIndex];
  if (member === undefined
    || retained.entries.length !== memberIndex
    || !sameProjectionTransactionObserved(
      validateProjectionObserved(observed, member),
      observed,
    )) {
    fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
  }
  const absolute = projectionMemberPath(normalized.marketplaceRoot, member);
  let handle;
  try {
    handle = await open(
      absolute,
      member.kind === "file"
        ? FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW
        : FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_DIRECTORY | FS_CONSTANTS.O_NOFOLLOW,
    );
    const entry = { member, memberIndex, absolute, handle, observed };
    await assertRetainedProjectionEntry(entry);
    retained.entries.push(entry);
    if (member.kind !== "file") {
      retained.directoryByRelativePath.set(member.relativePath, {
        directory: absolute,
        path: absolute,
        managed: true,
        handle,
        identity: directoryIdentity(await handle.stat({ bigint: true })),
      });
    }
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error instanceof BuilderCodexHostError) throw error;
    fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
  }
}

async function retainedProjectionParentAuthority(normalized, retained, memberIndex) {
  const member = normalized.manifest.members[memberIndex];
  if (member.kind === "root") {
    if (retained.rootParentAuthority === null) {
      retained.rootParentAuthority = await openExactDirectory(
        path.dirname(normalized.marketplaceRoot),
        true,
      );
    }
    await assertExactDirectory(retained.rootParentAuthority);
    return retained.rootParentAuthority;
  }
  const relativeParent = path.posix.dirname(member.relativePath);
  const authority = retained.directoryByRelativePath.get(
    relativeParent === "." ? "" : relativeParent,
  );
  if (authority === undefined) {
    fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
  }
  await assertExactDirectory(authority);
  return authority;
}

async function assertRetainedProjectionPrefix(normalized, retained) {
  if (retained.rootParentAuthority !== null) {
    await assertExactDirectory(retained.rootParentAuthority);
  }
  for (let memberIndex = 0; memberIndex < retained.entries.length; memberIndex += 1) {
    const entry = retained.entries[memberIndex];
    if (entry.memberIndex !== memberIndex
      || entry.member !== normalized.manifest.members[memberIndex]) {
      fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
    }
    await assertRetainedProjectionEntry(entry);
  }
}

function assertPhysicalProjectionMatchesRetained(retained, records) {
  if (records.length !== retained.entries.length) {
    fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
  }
  for (let memberIndex = 0; memberIndex < records.length; memberIndex += 1) {
    const entry = retained.entries[memberIndex];
    if (entry.memberIndex !== memberIndex
      || !sameProjectionTransactionObserved(records[memberIndex], entry.observed)) {
      fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
    }
  }
}

async function assertRetainedProjectionEntry(entry) {
  const before = await entry.handle.stat({ bigint: true });
  const bytes = entry.member.kind === "file"
    ? await readProjectionHandleBytes(entry.handle, before.size)
    : null;
  const after = await entry.handle.stat({ bigint: true });
  const current = await lstat(entry.absolute, { bigint: true });
  const safe = entry.member.kind === "file"
    ? sameProjectionFile(before, after) && sameProjectionFile(after, current)
    : safeProjectionMetadata(before, true) && safeProjectionMetadata(after, true)
      && safeProjectionMetadata(current, true)
      && before.dev === after.dev && before.ino === after.ino
      && after.dev === current.dev && after.ino === current.ino;
  const observed = {
    kind: entry.member.kind,
    relativePath: entry.member.relativePath,
    digest: bytes === null ? null : digestRawBytes(bytes),
    identity: projectionEntryIdentity(after),
  };
  if (!safe
    || (bytes !== null && BigInt(bytes.byteLength) !== after.size)
    || !sameProjectionTransactionObserved(observed, entry.observed)) {
    fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
  }
}

async function closeRetainedProjectionPrefix(retained) {
  const handles = retained.entries.map((entry) => entry.handle);
  if (retained.rootParentAuthority !== null) {
    handles.push(retained.rootParentAuthority.handle);
  }
  await Promise.all(handles.map((handle) => handle.close().catch(() => {})));
}

async function inspectProjectionPrefix(root, transaction) {
  let rootStats;
  try {
    rootStats = await lstat(root, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      if (transaction !== null && transaction.observed.length !== 0) {
        fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
      }
      return { status: "absent", records: [] };
    }
    fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
  }
  if (!safeProjectionMetadata(rootStats, true)) {
    fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
  }
  if (transaction === null) return { status: "present", records: [] };
  const expectedIndex = new Map(
    transaction.manifest.members.map((member, index) => [
      `${member.kind}\0${member.relativePath}`,
      index,
    ]),
  );
  const allowedCount = transaction.pendingBatch?.endMemberIndex
    ?? transaction.observed.length + (transaction.pendingIntent === null ? 0 : 1);
  if (allowedCount <= 0 || allowedCount > transaction.manifest.members.length) {
    fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
  }
  const actualByIndex = new Map();
  const rootMember = transaction.manifest.members[0];
  if (rootMember?.kind !== "root" || rootMember.relativePath !== "") {
    fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
  }
  actualByIndex.set(0, await inspectExactProjectionMember(root, rootMember));
  const pendingDirectories = [{ absolute: root, relativePath: "" }];
  let directoryIndex = 0;
  while (directoryIndex < pendingDirectories.length) {
    const directory = pendingDirectories[directoryIndex];
    directoryIndex += 1;
    const entries = await opendir(directory.absolute);
    for await (const entry of entries) {
      const relativePath = directory.relativePath === ""
        ? entry.name
        : `${directory.relativePath}/${entry.name}`;
      const kind = entry.isDirectory()
        ? "directory"
        : entry.isFile()
          ? "file"
          : "unknown";
      if (entry.isSymbolicLink() || kind === "unknown") {
        fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
      }
      const index = expectedIndex.get(`${kind}\0${relativePath}`);
      if (index === undefined
        || index >= allowedCount
        || actualByIndex.has(index)
        || actualByIndex.size >= allowedCount) {
        fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
      }
      const member = transaction.manifest.members[index];
      const admitted = await inspectExactProjectionMember(root, member);
      actualByIndex.set(index, admitted);
      if (kind === "directory") {
        pendingDirectories.push({
          absolute: projectionMemberPath(root, member),
          relativePath,
        });
      }
    }
  }
  for (const [index, observed] of actualByIndex) {
    const member = transaction.manifest.members[index];
    const admitted = validateProjectionObserved({
      ...observed,
      digest: member.kind === "file" ? observed.digest : null,
    }, member);
    if (!sameProjectionTransactionObserved(admitted, observed)) {
      fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
    }
    actualByIndex.set(index, admitted);
  }
  for (let index = 0; index < transaction.observed.length; index += 1) {
    const current = actualByIndex.get(index);
    if (current === undefined
      || !sameProjectionTransactionObserved(current, transaction.observed[index])) {
      fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
    }
  }
  const records = [];
  for (let index = 0; index < allowedCount; index += 1) {
    const record = actualByIndex.get(index);
    if (record === undefined) break;
    records.push(record);
  }
  if (records.length !== actualByIndex.size) {
    fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
  }
  return { status: "prefix", records };
}

function sameProjectionTransactionObserved(current, recorded) {
  if (current.kind !== recorded.kind
    || current.relativePath !== recorded.relativePath
    || current.digest !== recorded.digest) return false;
  if (current.kind === "file") {
    return JSON.stringify(current.identity) === JSON.stringify(recorded.identity);
  }
  return ["device", "inode", "owner", "group", "mode"].every(
    (key) => current.identity[key] === recorded.identity[key],
  );
}

async function inspectExactProjectionMember(root, member) {
  const absolute = projectionMemberPath(root, member);
  let handle;
  try {
    handle = await open(
      absolute,
      member.kind === "file"
        ? FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW
        : FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_DIRECTORY | FS_CONSTANTS.O_NOFOLLOW,
    );
    const before = await handle.stat({ bigint: true });
    if (member.kind === "file"
      ? (!safeProjectionMetadata(before, false)
        || before.size > BigInt(MAX_PROJECTION_FILE_BYTES))
      : !safeProjectionMetadata(before, true)) {
      fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
    }
    const bytes = member.kind === "file" ? await handle.readFile() : null;
    const after = await handle.stat({ bigint: true });
    const current = await lstat(absolute, { bigint: true });
    const safe = member.kind === "file"
      ? sameProjectionFile(before, after) && sameProjectionFile(after, current)
      : safeProjectionMetadata(before, true) && safeProjectionMetadata(after, true)
        && safeProjectionMetadata(current, true)
        && before.dev === after.dev && before.ino === after.ino
        && after.dev === current.dev && after.ino === current.ino;
    if (!safe || (bytes !== null && BigInt(bytes.byteLength) !== after.size)) {
      fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
    }
    return deepFreeze({
      kind: member.kind,
      relativePath: member.relativePath,
      digest: bytes === null ? null : digestRawBytes(bytes),
      identity: projectionEntryIdentity(after),
    });
  } finally {
    await handle?.close().catch(() => {});
  }
}

function projectionEntryIdentity(stats) {
  return {
    device: stats.dev.toString(10),
    inode: stats.ino.toString(10),
    links: stats.nlink.toString(10),
    size: stats.size.toString(10),
    owner: stats.uid.toString(10),
    group: stats.gid.toString(10),
    mode: (stats.mode & 0o777n).toString(8),
  };
}

function buildCurrentProjectionBinding(normalized, records) {
  if (records.length !== normalized.manifest.members.length) {
    fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
  }
  const rootIdentity = records[0].identity;
  return deepFreeze({
    schemaVersion: PROJECTION_BINDING_SCHEMA_VERSION,
    transactionId: normalized.transactionId,
    transactionDigest: normalized.manifestDigest,
    releaseDigest: normalized.manifest.releaseDigest,
    contentDigest: normalized.manifest.contentDigest,
    rootIdentity,
    rootIdentityDigest: digestProjectionRootIdentityModel(rootIdentity),
    members: records,
  });
}

function digestProjectionRootIdentityModel(identity) {
  return digestValue({
    schemaVersion: "agentmo.codex-marketplace-root-identity.v1",
    ...identity,
  }, "codex-marketplace-root-identity");
}

async function assertRetainedProjectionMembers(normalized, retained, transaction) {
  const physical = await inspectProjectionPrefix(normalized.marketplaceRoot, transaction);
  const records = physical.records;
  if (retained.length !== records.length) {
    fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
  }
  for (let index = 0; index < retained.length; index += 1) {
    const entry = retained[index];
    const stats = await entry.handle.stat({ bigint: true });
    if (JSON.stringify(projectionEntryIdentity(stats))
        !== JSON.stringify(records[index].identity)) {
      fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
    }
    if (entry.member.kind === "file") {
      const bytes = await readProjectionHandleBytes(entry.handle, stats.size);
      if (digestRawBytes(bytes) !== records[index].digest) {
        fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
      }
    }
  }
  const binding = buildCurrentProjectionBinding(normalized, records);
  if (transaction.complete?.bindingDigest
      !== digestValue(binding, "codex-marketplace-projection-binding")
    || JSON.stringify(transaction.complete.binding) !== JSON.stringify(binding)) {
    fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
  }
  return binding;
}

async function readProjectionHandleBytes(handle, size) {
  if (size > BigInt(MAX_PROJECTION_FILE_BYTES)) {
    fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
  }
  const bytes = Buffer.alloc(Number(size));
  let offset = 0;
  while (offset < bytes.byteLength) {
    const result = await handle.read(
      bytes,
      offset,
      bytes.byteLength - offset,
      offset,
    );
    if (!Number.isInteger(result?.bytesRead) || result.bytesRead <= 0) {
      fail("AGENTMO_CODEX_HOST_PROJECTION_AUTHORITY_REJECTED");
    }
    offset += result.bytesRead;
  }
  return bytes;
}

function portableProjectionPath(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 240
    && !value.includes("\\")
    && !value.includes("\0")
    && !path.posix.isAbsolute(value)
    && value.split("/").length <= MAX_PROJECTION_PATH_DEPTH
    && value.split("/").every((segment) => segment.length > 0
      && segment !== "."
      && segment !== ".."
      && segment.length <= 255);
}

function safeProjectionMetadata(stats, directory) {
  const correctKind = directory ? stats?.isDirectory() : stats?.isFile();
  if (!correctKind || stats.isSymbolicLink() || (Number(stats.mode) & 0o022) !== 0) return false;
  if (!directory && stats.nlink !== 1n) return false;
  return typeof process.getuid !== "function" || stats.uid === BigInt(process.getuid());
}

function sameProjectionFile(left, right) {
  return Boolean(left && right && safeProjectionMetadata(left, false) && safeProjectionMetadata(right, false)
    && left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.uid === right.uid && left.gid === right.gid && left.mode === right.mode
    && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs);
}

function projectionMetadata(stats) {
  return {
    links: stats.nlink.toString(10),
    size: stats.size.toString(10),
    owner: stats.uid.toString(10),
    group: stats.gid.toString(10),
    mode: (Number(stats.mode) & 0o7777).toString(8),
  };
}

function digestProjectionRootIdentity(stats) {
  return digestValue({
    schemaVersion: "agentmo.codex-marketplace-root-identity.v1",
    device: stats.dev.toString(10),
    inode: stats.ino.toString(10),
    ...projectionMetadata(stats),
  }, "codex-marketplace-root-identity");
}

function canonicalPathMatches(expected, resolved) {
  return resolved === expected || (process.platform === "darwin"
    && ["/var", "/tmp", "/etc"].some((prefix) => (
      (expected === prefix || expected.startsWith(`${prefix}${path.sep}`))
      && resolved === `/private${expected}`
    )));
}

function normalizeHookTrust(hooks) {
  if (hooks.length === 0) return "unavailable";
  // `trustStatus` is external command output, not an AgentMo trust anchor.
  // Preserve the observation as pending explicit human confirmation rather
  // than letting a PATH-shadowed command mint a trusted result.
  return "pending-human";
}

function parseJson(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_HOST_BYTES) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function minimalCodexEnvironment() {
  const env = Object.create(null);
  for (const name of ["PATH", "HOME", "CODEX_HOME", "LANG", "LC_ALL", "TMPDIR", "TERM", "SystemRoot"]) {
    if (typeof process.env[name] === "string") env[name] = process.env[name];
  }
  return env;
}

function builderCodexStateRootPath() {
  return path.join(path.resolve(homedir()), ".agentmo", "builder", "codex-host");
}

async function resolveStateRoot(options, create) {
  void options;
  const expectedUid = process.getuid?.();
  let current = path.resolve(homedir());
  try {
    await assertCanonicalDirectory(current, expectedUid);
    for (const segment of [".agentmo", "builder", "codex-host"]) {
      current = path.join(current, segment);
      const resolved = await resolveCanonicalStateDirectory(current, create, expectedUid);
      if (resolved === null) return null;
    }
    return current;
  } catch (error) {
    if (error instanceof BuilderCodexHostError) throw error;
    fail("AGENTMO_CODEX_HOST_STATE_ROOT_REJECTED");
  }
}

async function resolveCanonicalStateDirectory(directory, create, expectedUid) {
  const normalized = path.resolve(directory);
  if (normalized !== directory) fail("AGENTMO_CODEX_HOST_STATE_ROOT_REJECTED");
  try {
    await assertCanonicalDirectory(normalized, expectedUid);
    return normalized;
  } catch (error) {
    if (error instanceof BuilderCodexHostError) throw error;
    if (error?.code !== "ENOENT") fail("AGENTMO_CODEX_HOST_STATE_ROOT_REJECTED");
    if (!create) return null;
  }
  const parent = path.dirname(normalized);
  await assertCanonicalDirectory(parent, expectedUid);
  let parentAuthority;
  try {
    parentAuthority = await openExactDirectory(parent, false);
    await runBuilderPosixEffect({
      action: "mkdir",
      name: path.basename(normalized),
      payload: "",
    }, {
      directoryAuthority: parentAuthority,
    });
  } catch (error) {
    if (error instanceof BuilderCodexHostError) throw error;
    fail("AGENTMO_CODEX_HOST_STATE_ROOT_REJECTED");
  } finally {
    await parentAuthority?.handle.close().catch(() => {});
  }
  await assertCanonicalDirectory(normalized, expectedUid);
  return normalized;
}

async function assertCanonicalDirectory(directory, expectedUid = process.getuid?.()) {
  const stats = await lstat(directory, { bigint: true });
  if (!safeStateDirectoryMetadata(stats, expectedUid)) fail("AGENTMO_CODEX_HOST_STATE_ROOT_REJECTED");
  const resolved = await realpath(directory);
  if (!canonicalPathMatches(directory, resolved)) fail("AGENTMO_CODEX_HOST_STATE_ROOT_REJECTED");
}

function safeStateDirectoryMetadata(stats, expectedUid = process.getuid?.()) {
  return Boolean(stats?.isDirectory() && !stats.isSymbolicLink()
    && (Number(stats.mode) & 0o022) === 0
    && (expectedUid === undefined || stats.uid === BigInt(expectedUid)));
}

function validateOwnerRecord(value) {
  if (!exactKeys(value, ["disposition", "release", "schemaVersion", "selector", "sourceDigest"])
    || value.schemaVersion !== "agentmo.codex-selector-owner.v1") {
    fail("AGENTMO_CODEX_HOST_OWNER_INVALID");
  }
  return buildCodexSelectorOwnerRecord(value);
}

function validateConsumerEntry(value) {
  if (!exactKeys(value, ["consumerId", "projectScopeDigest", "releaseDigest", "selector"])
    || value.consumerId !== value.projectScopeDigest) fail("AGENTMO_CODEX_HOST_CONSUMER_INVALID");
  return buildCodexConsumerEntry(value);
}

function validateConsumerLedger(value) {
  if (!exactKeys(value, ["consumers", "schemaVersion", "selector"])
    || value.schemaVersion !== "agentmo.codex-consumer-ledger.v1") {
    fail("AGENTMO_CODEX_HOST_LEDGER_INVALID");
  }
  const rebuilt = buildCodexConsumerLedger(value);
  if (JSON.stringify(rebuilt) !== JSON.stringify(value)) fail("AGENTMO_CODEX_HOST_LEDGER_INVALID");
  return rebuilt;
}

function releaseIdentity(release) {
  validateRelease(release);
  return deepFreeze({
    name: release.name,
    version: release.version,
    adapterId: release.adapterId,
    releaseDigest: release.releaseDigest,
  });
}

function validateRelease(release) {
  if (!release || typeof release !== "object" || Array.isArray(release)
    || release.name !== "agentmo" || release.adapterId !== "codex"
    || typeof release.version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(release.version)
    || !DIGEST_PATTERN.test(release.releaseDigest ?? "")) fail("AGENTMO_CODEX_HOST_RELEASE_INVALID");
}

function sameSelector(left, right) {
  return exactKeys(left, ["marketplaceName", "pluginId", "pluginName"])
    && left.pluginId === right.pluginId
    && left.pluginName === right.pluginName
    && left.marketplaceName === right.marketplaceName;
}

function admitProjectRoot(value) {
  if (typeof value !== "string" || !path.isAbsolute(value) || path.resolve(value) !== value) {
    fail("AGENTMO_CODEX_HOST_PROJECT_ROOT_INVALID");
  }
  return value;
}

function exactKeys(value, keys) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).toSorted().join("\0") === [...keys].toSorted().join("\0"));
}

function requireExactKeys(value, keys) {
  if (!exactKeys(value, keys)) fail("AGENTMO_CODEX_HOST_STATE_INCONSISTENT");
}

function boundedText(value, maxBytes) {
  const text = typeof value === "string" ? value : Buffer.from(value ?? "").toString("utf8");
  if (Buffer.byteLength(text) > maxBytes) fail("AGENTMO_CODEX_HOST_COMMAND_FAILED");
  return text;
}

function digestValue(value, subject) {
  return digestRawBytes(Buffer.from(serializePersistableJson(value, { subject }), "utf8"));
}

function digestFileIdentity(stats) {
  return digestValue({
    schemaVersion: "agentmo.codex-state-file-identity.v2",
    device: stats.dev.toString(10),
    group: stats.gid.toString(10),
    inode: stats.ino.toString(10),
    links: stats.nlink.toString(10),
    mode: (Number(stats.mode) & 0o7777).toString(8),
    owner: stats.uid.toString(10),
    size: stats.size.toString(10),
  }, "codex-state-file-identity");
}

function missingState() {
  return deepFreeze({ status: "missing", digest: null, identityDigest: null, value: null });
}

function inconsistentState() {
  return deepFreeze({ status: "inconsistent", digest: null, identityDigest: null, value: null });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function fail(code) {
  throw new BuilderCodexHostError(code);
}
