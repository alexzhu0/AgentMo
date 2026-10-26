import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { publishNativeChatFiles, assertNativeChatAbsentRoot } from "./native-chat-files.js";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const MAX_BYTES = 1024 * 1024;
const hash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const line = (value) => `${JSON.stringify(value)}\n`;
const identity = (stat) => ({ device: String(stat.dev), inode: String(stat.ino), birthtimeNs: String(stat.birthtimeNs) });

// ponytail: same-UID persistence only; owner-directed history rollback needs an external authority.
export async function createNativeAuthorityStore(options = {}) {
  try {
    if (!keys(options, ["authorityRoot", "stateRoot"])) reject();
    const { authorityRoot, stateRoot } = options;
    await disjointRoots(authorityRoot, stateRoot);
    await assertNativeChatAbsentRoot(stateRoot);
    const anchor = Buffer.from(line({ schemaVersion: "agentmo.native-authority-store.v1",
      identityDigest: hash(randomBytes(32)) }));
    const anchorDigest = hash(anchor);
    await publishNativeChatFiles({ root: authorityRoot, files: [
      { relativePath: "identity.json", bytes: anchor, mode: 0o600 },
      { relativePath: "consumption.jsonl", bytes: Buffer.from(line({ anchorDigest })), mode: 0o600 },
    ] });
    return Object.freeze({ schemaVersion: "agentmo.native-authority-binding.v1",
      rootDigest: hash(authorityRoot), anchorDigest,
      rootIdentity: identity(await lstat(authorityRoot, { bigint: true })),
      anchorIdentity: identity(await lstat(path.join(authorityRoot, "identity.json"), { bigint: true })),
      journalIdentity: identity(await lstat(path.join(authorityRoot, "consumption.jsonl"), { bigint: true })),
    });
  } catch { reject(); }
}

export async function consumeNativeAuthoritySet(options = {}) {
  let journal;
  try {
    if (!keys(options, ["authorityRoot", "stateRoot", "plan", "ordinaryApproval", "sensitiveDecisions", "conflictApproval"])) reject();
    const request = structuredClone(options);
    const { authorityRoot, stateRoot, plan } = request;
    await disjointRoots(authorityRoot, stateRoot);
    if (plan.schemaVersion === "agentmo.pi-install-plan.v1") {
      const { verifyPiPlanRoot } = await import("./pi-install-plan.js");
      await verifyPiPlanRoot({ plan, stateRoot });
    } else {
      const { verifyOpenClawNativeInstallRoot, verifyOpenClawNativeRuntimeRoot } = await import("./openclaw-install-plan.js");
      await (plan.lifecycle === "activate" ? verifyOpenClawNativeRuntimeRoot : verifyOpenClawNativeInstallRoot)({ plan, stateRoot });
    }
    const record = await decisionRecord(request);
    const binding = plan.authorityRootBinding;
    await verifyStore(authorityRoot, binding);
    journal = await open(path.join(authorityRoot, "consumption.jsonl"),
      constants.O_RDWR | constants.O_APPEND | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    await checkJournal(journal, binding, record);
    const lockPath = path.join(authorityRoot, "consume.lock");
    const lock = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await lock.sync(); } finally { await lock.close(); }
    // Never clear an uncertain lock: a failed/partial attempt requires explicit recovery, not replay.
    await syncDirectory(authorityRoot);
    await verifyStore(authorityRoot, binding);
    await checkJournal(journal, binding, record);
    await decisionRecord(request);
    await journal.writeFile(line(record));
    await journal.sync();
    await journal.close();
    journal = null;
    await unlink(lockPath);
    await syncDirectory(authorityRoot);
    return Object.freeze({ schemaVersion: "agentmo.native-authority-consumption.v1",
      installPlanDigest: plan.installPlanDigest, authorityBindingDigest: hash(line(binding)),
      consumptionDigest: hash(line(record)), decisionCount: record.decisions.length });
  } catch { reject(); }
  finally { if (journal) await journal.close().catch(() => {}); }
}

export async function verifyNativeAuthorityConsumption({ authorityRoot, plan, consumptionDigest }) {
  let journal;
  try {
    const { validateOpenClawInstallPlan } = await import("./openclaw-install-plan.js");
    const { validatePiInstallPlan } = await import("./pi-install-plan.js");
    const validate = plan?.schemaVersion === "agentmo.pi-install-plan.v1" ? validatePiInstallPlan : validateOpenClawInstallPlan;
    if (plan?.execution_profile !== "native-chat" || !validate(plan).ok || !DIGEST.test(consumptionDigest ?? "")) reject();
    await verifyStore(authorityRoot, plan.authorityRootBinding);
    try { await lstat(path.join(authorityRoot, "consume.lock")); reject(); } catch (error) { if (error.code !== "ENOENT") throw error; }
    journal = await open(path.join(authorityRoot, "consumption.jsonl"), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const records = await checkJournal(journal, plan.authorityRootBinding, { decisions: [] });
    if (records.filter(record => record.installPlanDigest === plan.installPlanDigest && hash(line(record)) === consumptionDigest).length !== 1) reject();
  } catch { reject(); }
  finally { if (journal) await journal.close().catch(() => {}); }
}

async function decisionRecord({ plan, ordinaryApproval, sensitiveDecisions, conflictApproval }) {
  const pi = plan?.schemaVersion === "agentmo.pi-install-plan.v1";
  const validators = pi ? await import("./pi-install-approval.js") : await import("./openclaw-install-approval.js");
  const validateOpenClawInstallApproval = pi ? validators.validatePiInstallApproval : validators.validateOpenClawInstallApproval;
  const validateOpenClawSensitiveActionDecision = pi ? validators.validatePiSensitiveActionDecision : validators.validateOpenClawSensitiveActionDecision;
  const validateOpenClawConflictApproval = pi ? validators.validatePiConflictApproval : validators.validateOpenClawConflictApproval;
  const context = { plan, now: new Date().toISOString() };
  if (!validateOpenClawInstallApproval(ordinaryApproval, context).ok
    || !validateOpenClawConflictApproval(conflictApproval, context).ok
    || !Array.isArray(sensitiveDecisions) || sensitiveDecisions.length !== plan.sensitiveActions.length
    || sensitiveDecisions.some((decision, i) => !validateOpenClawSensitiveActionDecision(decision,
      { ...context, action: plan.sensitiveActions[i] }).ok)) reject();
  const decisions = [ordinaryApproval, ...sensitiveDecisions, conflictApproval].map((decision) => ({
    nonceDigest: hash(decision.useNonce), decisionDigest: hash(line(decision)),
  }));
  if (new Set(decisions.map((d) => d.nonceDigest)).size !== decisions.length) reject();
  return { installPlanDigest: plan.installPlanDigest, ...(pi ? { native_runtime: "pi", lifecycle: plan.lifecycle } : {}), decisions };
}

async function verifyStore(root, binding) {
  if (!validateNativeAuthorityBinding(binding) || hash(root) !== binding.rootDigest || await realpath(root) !== root) reject();
  let current = path.parse(root).root;
  for (const part of root.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await lstat(current, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) reject();
    if (current === root && (!sameIdentity(stat, binding.rootIdentity) || !privateOwned(stat, 0o700))) reject();
  }
  const anchor = await open(path.join(root, "identity.json"), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!sameIdentity(await anchor.stat({ bigint: true }), binding.anchorIdentity)) reject();
    const bytes = await privateBytes(anchor, 512);
    if (hash(bytes) !== binding.anchorDigest) reject();
  } finally { await anchor.close(); }
  const journalStat = await lstat(path.join(root, "consumption.jsonl"), { bigint: true });
  if (!journalStat.isFile() || !privateOwned(journalStat, 0o600)
    || journalStat.nlink !== 1n || !sameIdentity(journalStat, binding.journalIdentity)) reject();
}

async function checkJournal(handle, binding, next) {
  if (!sameIdentity(await handle.stat({ bigint: true }), binding.journalIdentity)) reject();
  const bytes = await privateBytes(handle, MAX_BYTES);
  const text = bytes.toString("utf8");
  if (!Buffer.from(text).equals(bytes) || !text.endsWith("\n")) reject();
  const rows = text.slice(0, -1).split("\n");
  if (rows.shift() !== JSON.stringify({ anchorDigest: binding.anchorDigest })) reject();
  const used = new Set(), records = [];
  for (const row of rows) {
    const record = JSON.parse(row); records.push(record);
    const pi = record.native_runtime === "pi";
    if (JSON.stringify(record) !== row || !keys(record, pi ? ["installPlanDigest", "native_runtime", "lifecycle", "decisions"] : ["installPlanDigest", "decisions"])
      || (pi && !["install", "activate"].includes(record.lifecycle))
      || !DIGEST.test(record.installPlanDigest) || !Array.isArray(record.decisions)
      || !(pi ? (record.lifecycle === "install" ? [2] : [4, 5]) : [5]).includes(record.decisions.length)) reject();
    for (const decision of record.decisions) {
      if (!keys(decision, ["nonceDigest", "decisionDigest"])
        || !DIGEST.test(decision.nonceDigest) || !DIGEST.test(decision.decisionDigest)
        || used.has(decision.nonceDigest)) reject();
      used.add(decision.nonceDigest);
    }
  }
  if (next.decisions.some((decision) => used.has(decision.nonceDigest))
    || bytes.length + Buffer.byteLength(line(next)) > MAX_BYTES) reject();
  return records;
}

async function privateBytes(handle, limit) {
  const stat = await handle.stat({ bigint: true });
  if (!stat.isFile() || stat.nlink !== 1n || !privateOwned(stat, 0o600) || stat.size > BigInt(limit)) reject();
  const bytes = Buffer.alloc(limit + 1);
  let size = 0;
  while (size < bytes.length) {
    const { bytesRead } = await handle.read(bytes, size, bytes.length - size, size);
    if (!bytesRead) break;
    size += bytesRead;
  }
  if (size > limit) reject();
  return bytes.subarray(0, size);
}

function privateOwned(stat, mode) {
  return typeof process.getuid === "function" && stat.uid === BigInt(process.getuid())
    && (stat.mode & 0o777n) === BigInt(mode);
}

function sameIdentity(stat, expected) {
  const actual = identity(stat);
  return Object.keys(actual).every((key) => actual[key] === expected[key]);
}

async function disjointRoots(a, b) {
  for (const root of [a, b]) {
    if (typeof root !== "string" || !path.isAbsolute(root) || path.resolve(root) !== root || root.includes("\0") || root === path.parse(root).root) reject();
  }
  if (a === b || a.startsWith(`${b}${path.sep}`) || b.startsWith(`${a}${path.sep}`)) reject();
  for (const root of [a, b]) {
    if (await realpath(path.dirname(root)) !== path.dirname(root)) reject();
  }
}

async function syncDirectory(root) {
  const handle = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}

function reject() {
  throw Object.assign(new Error("Native approval consumption was rejected."), { code: "AGENTMO_NATIVE_AUTHORITY_REJECTED" });
}

export function validateNativeAuthorityBinding(value) {
  return keys(value, ["schemaVersion", "rootDigest", "anchorDigest", "rootIdentity", "anchorIdentity", "journalIdentity"])
    && value.schemaVersion === "agentmo.native-authority-binding.v1"
    && [value.rootDigest, value.anchorDigest].every((v) => typeof v === "string" && DIGEST.test(v))
    && [value.rootIdentity, value.anchorIdentity, value.journalIdentity].every((identity) => (
      keys(identity, ["device", "inode", "birthtimeNs"])
      && Object.values(identity).every((v) => typeof v === "string" && /^(0|[1-9][0-9]*)$/u.test(v))
    ));
}

function keys(value, expected) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}
