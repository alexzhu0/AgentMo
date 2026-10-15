import { spawn } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { lstat, mkdir, realpath, readdir, unlink } from "node:fs/promises";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { startNativeChatProxy } from "./native-chat-proxy.js";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { buildOpenClawTargetDescriptor, validateOpenClawTargetDescriptor } from "./openclaw-target-descriptor.js";
import { publishNativeChatFiles, writeNativeChatFile } from "./native-chat-files.js";
import { admittedArtifactProvenance } from "./artifact-admission.js";
import { readBoundedNoFollowFile } from "./builder-package.js";
import { inspectAgentPackage } from "./package-inspect.js";
import { buildOpenClawInstallPlan, validateOpenClawInstallPlan, verifyOpenClawNativeInstallRoot, verifyOpenClawNativeRuntimeRoot } from "./openclaw-install-plan.js";
import { consumeNativeAuthoritySet, verifyNativeAuthorityConsumption } from "./native-chat-authority.js";
import { validateCourseBudgetBinding } from "./course-wiki-budget.js";
import { validateOpenClawInstallReceipt } from "./openclaw-install-receipt.js";
import { assertCurrentOpenClawTargetRuntime } from "./runtime-compatibility.js";
import { MINIMAX_M3_PROFILE, nativeChatModelProfile } from "./native-chat-model-profile.js";
export { startNativeChatProxy } from "./native-chat-proxy.js";

export function nativeChildEnvironment(root) {
  return { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: path.join(root, "home"),
    OPENCLAW_STATE_DIR: path.join(root, "state"), OPENCLAW_CONFIG_PATH: path.join(root, "config.json"),
    XDG_CONFIG_HOME: path.join(root, "xdg-config"), XDG_DATA_HOME: path.join(root, "xdg-data"),
    XDG_CACHE_HOME: path.join(root, "xdg-cache"), TMPDIR: path.join(root, "tmp"), LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" };
}

// Retain the existing Course Wiki watchdog, including bounded settlement after killing a child.
export function settleNativeChild(child, { timeout = 30_000, postKillTimeout = 1_000, stop, format = "json" } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = []; const stderrHash = createHash("sha256"); let bytes = 0; let stderrBytes = 0; let failure;
    let timer, postKillTimer, settled = false;
    const finish = (code, value) => {
      if (settled) return; settled = true; clearTimeout(timer); clearTimeout(postKillTimer);
      if (code) { child.stdout?.destroy?.(); child.stderr?.destroy?.(); reject(nativeError(code)); }
      else resolve(value);
    };
    const abort = (code) => { if (failure) return; failure = code; postKillTimer = setTimeout(() => finish(failure), postKillTimeout); try { stop?.(); } catch {} };
    timer = setTimeout(() => abort("TIMEOUT"), timeout);
    child.stdout.on("data", (b) => { bytes += b.length; if (bytes > 2 * 1024 * 1024) abort("OUTPUT_INVALID"); else chunks.push(b); });
    child.stderr.on("data", (b) => { stderrBytes += b.length; stderrHash.update(b); if (stderrBytes > 128 * 1024) abort("OUTPUT_INVALID"); });
    child.once("error", () => finish("SPAWN_FAILED"));
    child.once("exit", () => { if (failure) finish(failure); });
    child.once("close", (code) => {
      if (failure || code !== 0) return finish(failure || "EXIT_FAILED");
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
        finish(null, format === "observation" ? { text, stderrDigest: `sha256:${stderrHash.digest("hex")}`, stderrBytes } : JSON.parse(text));
      } catch { finish("OUTPUT_INVALID"); }
    });
  });
}

export async function probeNativeChatTarget(options) {
  assertCurrentOpenClawTargetRuntime();
  try { return await observeNativeTarget(options); }
  catch (error) {
    if (/^AGENTMO_NATIVE_[A-Z_]+$/u.test(error?.code)) throw error;
    throw nativeError("PROBE_REJECTED");
  }
}

async function observeNativeTarget(options) {
  if (!options || !exactKeys(options, ["descriptor", "executablePath", "probeRoot", ...Object.hasOwn(options, "modelProfile") ? ["modelProfile"] : []])
    || Object.hasOwn(options, "modelProfile") && options.modelProfile !== MINIMAX_M3_PROFILE) throw nativeError("OPTIONS_REJECTED");
  const { descriptor, executablePath, probeRoot } = options;
  const model = nativeChatModelProfile(options.modelProfile);
  if (!validateOpenClawTargetDescriptor(descriptor).ok || !path.isAbsolute(executablePath ?? "")) throw nativeError("TARGET_REJECTED");
  const executable = descriptor.members.find((member) => member.role === "executable");
  let targetRoot = executablePath;
  for (const part of executable.relativePath.split("/")) { void part; targetRoot = path.dirname(targetRoot); }
  const verifyTarget = async () => {
    const members = Object.fromEntries(descriptor.members.map((member) => [member.role, member]));
    const observed = await buildOpenClawTargetDescriptor({ executablePath,
      packageJsonPath: path.join(targetRoot, members["package-json"].relativePath),
      buildInfoPath: path.join(targetRoot, members["build-info"].relativePath),
      digests: { "target-executable": executable.sha256, "target-package-json": members["package-json"].sha256, "target-build-info": members["build-info"].sha256 } });
    if (!isDeepStrictEqual(observed, descriptor)) throw nativeError("TARGET_REJECTED");
  };
  await verifyTarget();
  const config = { agents: { defaults: { model: { primary: model.nativeModel, fallbacks: [] }, workspace: path.join(probeRoot, "workspace"), skipBootstrap: true, heartbeat: { every: "0m" } }, entries: {} },
    plugins: { enabled: false }, skills: { allowBundled: [] }, tools: { profile: "minimal", deny: ["*"] }, cron: { enabled: false }, hooks: { enabled: false } };
  await publishNativeChatFiles({ root: probeRoot, files: [{ relativePath: "config.json", bytes: Buffer.from(JSON.stringify(config)), mode: 0o600 }] });
  for (const directory of ["home", "state", "workspace", "xdg-config", "xdg-data", "xdg-cache", "tmp"]) await mkdir(path.join(probeRoot, directory), { mode: 0o700 });
  const observations = [];
  for (const [id, args] of [["version", ["--version"]], ["agent-registration-command", ["setup", "--help"]], ["config-validation", ["config", "validate", "--json"]]]) {
    await verifyTarget();
    const child = spawn(executablePath, args, { cwd: probeRoot, env: nativeChildEnvironment(probeRoot), shell: false, stdio: ["ignore", "pipe", "pipe"], detached: true });
    const { text, stderrDigest, stderrBytes } = await settleNativeChild(child, { format: "observation", stop: () => { try { process.kill(-child.pid, "SIGKILL"); } catch {} } });
    await verifyTarget();
    if (id === "version" && ![descriptor.target.version, `OpenClaw ${descriptor.target.version} (${descriptor.target.displayRevision})`].includes(text.trim())) throw nativeError("VERSION_REJECTED");
    if (id === "agent-registration-command" && !["--baseline", "--json"].every((flag) => text.includes(flag))) throw nativeError("COMMAND_REJECTED");
    if (id === "config-validation" && JSON.parse(text)?.valid !== true) throw nativeError("CONFIG_REJECTED");
    // Raw output stays in memory; evidence contains only fixed field names and digests.
    observations.push({ id, argv: args, exitCode: 0, signal: null, timedOut: false,
      standardOutputFacts: { kind: "text", digest: digest(text), byteLength: Buffer.byteLength(text), fields: [] },
      standardErrorFacts: { kind: stderrBytes === 0 ? "empty" : "text", digest: stderrDigest, byteLength: stderrBytes, fields: [] } });
  }
  return observations;
}

const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const installKeys = ["plan", "ordinaryApproval", "sensitiveDecisions", "conflictApproval", "authorityRoot",
  "archivePath", "executablePath", "stateRoot", "budgetRoot", "descriptorAdmission", "probeAdmission", "blueprintAdmission", "buildContractAdmission"];
const preflightKeys = ["plan", "archivePath", "executablePath", "stateRoot", "budgetRoot", "descriptorAdmission", "probeAdmission", "blueprintAdmission", "buildContractAdmission"];

export async function preflightNativeChatInstall(options) {
  try { await nativeInstallSnapshot(options); }
  catch { throw nativeError("INSTALL_REJECTED"); }
}

export async function preflightNativeChatActivation(options) {
  try { await nativeActivationSnapshot(options); }
  catch { throw nativeError("ACTIVATION_REJECTED"); }
}

export async function startNativeChat(options) {
  const signal = options?.signal;
  const keys = [...installKeys, "installReceipt", "apiKey", ...(Object.hasOwn(options ?? {}, "signal") ? ["signal"] : [])];
  let request, snapshot, token;
  try {
    if (!exactKeys(options, keys) || Object.hasOwn(options, "signal") && !(signal instanceof AbortSignal)
      || typeof options.apiKey !== "string" || !options.apiKey || /[\r\n]/u.test(options.apiKey)) throw nativeError("ACTIVATION_REJECTED");
    if (signal?.aborted) throw nativeError("ACTIVATION_CANCELLED");
    request = { ...options, ...structuredClone(Object.fromEntries(["plan", "installReceipt", "ordinaryApproval", "sensitiveDecisions", "conflictApproval"].map(k => [k, options[k]]))) };
    snapshot = await nativeActivationSnapshot(Object.fromEntries([...preflightKeys, "installReceipt", "authorityRoot"].map(k => [k, request[k]])));
    try { await lstat(path.join(request.stateRoot, "native-chat-control.json")); throw nativeError("CONTROL_BUSY"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    try {
      token = (await privateNativeFile(request.stateRoot, "native-chat-gateway-token")).toString("utf8");
      if (!/^[a-f0-9]{64}$/u.test(token)) throw nativeError("TOKEN_REJECTED");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (signal?.aborted) throw nativeError("ACTIVATION_CANCELLED");
    await consumeNativeAuthoritySet(Object.fromEntries(["authorityRoot", "stateRoot", "plan", "ordinaryApproval", "sensitiveDecisions", "conflictApproval"].map(k => [k, request[k]])));
  } catch (error) { if (error?.code === "AGENTMO_NATIVE_ACTIVATION_CANCELLED") throw error; throw nativeError("ACTIVATION_REJECTED"); }
  const { plan, stateRoot, executablePath } = request, binding = plan.nativeBinding;
  const children = new Set(); let proxy, control, controlRecord, controlIdentity, stopping, active = false, resourcesReady = false, resolveCompletion;
  const completion = new Promise(resolve => { resolveCompletion = resolve; });
  const stop = (status = "stopped") => stopping ??= (async () => {
    active = false; let clean = true;
    for (const child of children) { try { await stopOwnedNativeChild(child); } catch { clean = false; } }
    if (proxy) { try { await proxy.close(); } catch { clean = false; } }
    if (control) { control.close(); control.closeIdleConnections(); }
    if (controlRecord && clean) {
      try {
        const file = path.join(stateRoot, "native-chat-control.json");
        if (!isDeepStrictEqual(nativeIdentity(await lstat(file, { bigint: true })), controlIdentity)
          || !(await privateNativeFile(stateRoot, "native-chat-control.json")).equals(jsonBytes(controlRecord))) throw nativeError("CONTROL_CHANGED");
        await unlink(file);
      } catch { clean = false; }
    }
    token = ""; request.apiKey = "";
    signal?.removeEventListener("abort", abort);
    const result = { status: clean ? status : "failed" }; resolveCompletion(result); return result;
  })();
  const spawnOwned = async action => {
    await snapshot.verifyTarget();
    if (signal?.aborted || stopping) throw nativeError("GATEWAY_FAILED");
    const child = spawn(executablePath, action.argv, { cwd: stateRoot,
      env: { ...nativeChildEnvironment(stateRoot), AGENTMO_NATIVE_PROXY_TOKEN: proxyToken,
        OPENCLAW_GATEWAY_TOKEN: token, NODE_DISABLE_COMPILE_CACHE: "1", OPENCLAW_NO_RESPAWN: "1" },
      shell: false, stdio: ["ignore", "pipe", "pipe"] });
    children.add(child); child.once("error", () => { if (active) void stop("failed"); });
    return child;
  };
  // Before resources settle, cancellation is checked at the next acquisition boundary.
  const abort = () => { if (resourcesReady) void stop(); };
  signal?.addEventListener("abort", abort, { once: true });
  const proxyToken = randomBytes(32).toString("hex");
  try {
    if (signal?.aborted) throw nativeError("GATEWAY_FAILED");
    if (token === undefined) {
      token = randomBytes(32).toString("hex");
      await writeNativeChatFile({ filePath: path.join(stateRoot, "native-chat-gateway-token"), bytes: Buffer.from(token) });
    }
    proxy = await startNativeChatProxy({ binding, stateRoot, budgetRoot: request.budgetRoot, apiKey: request.apiKey, token: proxyToken });
    request.apiKey = "";
    if (signal?.aborted) throw nativeError("GATEWAY_FAILED");
    const controlToken = randomBytes(32).toString("hex");
    control = createHttpServer(async (req, res) => {
      res.setHeader("cache-control", "no-store");
      const supplied = req.headers.authorization;
      if (req.headers.origin !== undefined || typeof supplied !== "string" || !/^Bearer [a-f0-9]{64}$/u.test(supplied)
        || !timingSafeEqual(Buffer.from(supplied), Buffer.from(`Bearer ${controlToken}`))) { res.writeHead(401); res.end(); return; }
      if (req.method !== "POST" || req.url !== "/stop" || req.headers["transfer-encoding"] || Number(req.headers["content-length"] ?? 0) !== 0) { res.writeHead(400); res.end(); return; }
      const result = await stop(); res.writeHead(result.status === "stopped" ? 200 : 503, { "content-type": "application/json" });
      res.end(JSON.stringify({ stopped: result.status === "stopped" }));
    });
    control.requestTimeout = 1000; control.headersTimeout = 1000;
    await new Promise((resolve, reject) => { control.once("error", reject); control.listen(0, "127.0.0.1", resolve); });
    if (signal?.aborted) throw nativeError("GATEWAY_FAILED");
    controlRecord = { schemaVersion: "agentmo.native-chat-control.v1", planDigest: plan.installPlanDigest,
      bindingDigest: digest(jsonBytes(binding)), port: control.address().port, token: controlToken };
    await writeNativeChatFile({ filePath: path.join(stateRoot, "native-chat-control.json"), bytes: jsonBytes(controlRecord) });
    controlIdentity = nativeIdentity(await lstat(path.join(stateRoot, "native-chat-control.json"), { bigint: true }));
    resourcesReady = true;
    const gateway = await spawnOwned(plan.sensitiveActions[1]);
    let outputBytes = 0;
    for (const stream of [gateway.stdout, gateway.stderr]) stream.on("data", chunk => {
      outputBytes += chunk.length; if (outputBytes > 2 * 1024 * 1024) void stop("failed");
    });
    const deadline = Date.now() + plan.sensitiveActions[1].timeoutMs;
    while (true) {
      if (signal?.aborted || stopping || gateway.exitCode !== null || gateway.signalCode !== null || Date.now() >= deadline) throw nativeError("GATEWAY_FAILED");
      try {
        const response = await fetch(`http://127.0.0.1:${binding.gatewayPort}/readyz`, { redirect: "error", signal: AbortSignal.timeout(500) });
        await response.body?.cancel(); if (response.ok) break;
      } catch {}
      await delay(100);
    }
    const healthChild = await spawnOwned(plan.sensitiveActions[2]);
    const health = await settleNativeChild(healthChild, { timeout: plan.sensitiveActions[2].timeoutMs, stop: () => healthChild.kill("SIGKILL") });
    if (health?.ok !== true || health.defaultAgentId !== binding.agentId || !Array.isArray(health.agents)
      || health.agents.length !== 1 || health.agents[0].agentId !== binding.agentId) throw nativeError("HEALTH_REJECTED");
    await snapshot.verifyTarget();
    if (signal?.aborted || stopping || gateway.exitCode !== null || gateway.signalCode !== null) throw nativeError("GATEWAY_FAILED");
    active = true; gateway.once("exit", () => { if (active) void stop("failed"); });
    const sessionKey = `agent:${binding.agentId}:main`;
    return { entry: { agentId: binding.agentId, sessionKey,
      url: `http://127.0.0.1:${binding.gatewayPort}/chat?session=${encodeURIComponent(sessionKey)}` }, stop: () => stop(), completion };
  } catch {
    const outcome = await stop(signal?.aborted ? "stopped" : "failed");
    if (signal?.aborted && outcome.status === "stopped") throw nativeError("ACTIVATION_CANCELLED");
    throw nativeError("GATEWAY_FAILED");
  }
}

export async function stopNativeChat({ plan, stateRoot }) {
  try {
    await verifyOpenClawNativeRuntimeRoot({ plan, stateRoot });
    const control = JSON.parse((await privateNativeFile(stateRoot, "native-chat-control.json")).toString("utf8"));
    if (!exactKeys(control, ["schemaVersion", "planDigest", "bindingDigest", "port", "token"])
      || control.schemaVersion !== "agentmo.native-chat-control.v1" || control.planDigest !== plan.installPlanDigest
      || control.bindingDigest !== digest(jsonBytes(plan.nativeBinding)) || !Number.isInteger(control.port)
      || control.port < 1024 || control.port > 65535 || !/^[a-f0-9]{64}$/u.test(control.token)) throw nativeError("CONTROL_REJECTED");
    const response = await fetch(`http://127.0.0.1:${control.port}/stop`, { method: "POST", redirect: "error",
      headers: { authorization: `Bearer ${control.token}` }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok || response.headers.get("content-type") !== "application/json"
      || !isDeepStrictEqual(await response.json(), { stopped: true })) throw nativeError("CONTROL_REJECTED");
    return { stopped: true };
  } catch { throw nativeError("CONTROL_REJECTED"); }
}

async function stopOwnedNativeChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const ended = new Promise(resolve => { child.once("exit", resolve); child.once("error", resolve); });
  child.kill("SIGTERM");
  if (await Promise.race([ended.then(() => true), delay(2000).then(() => false)])) return;
  child.kill("SIGKILL");
  if (!await Promise.race([ended.then(() => true), delay(1000).then(() => false)])) throw nativeError("STOP_FAILED");
}

async function nativeActivationSnapshot(options) {
  if (!exactKeys(options, [...preflightKeys, "installReceipt", "authorityRoot"]) || options.plan?.lifecycle !== "activate") throw nativeError("ACTIVATION_REJECTED");
  const { plan, installReceipt, stateRoot, authorityRoot } = options;
  const snapshot = await nativeInstallSnapshot(Object.fromEntries(preflightKeys.map(k => [k, options[k]])), installReceipt);
  if (installReceipt.authorityBindingDigest !== digest(`${JSON.stringify(plan.authorityRootBinding)}\n`)) throw nativeError("ACTIVATION_REJECTED");
  await verifyNativeAuthorityConsumption({ authorityRoot, plan: snapshot.installPlan, consumptionDigest: installReceipt.consumptionDigest });
  if (!(await privateNativeFile(stateRoot, "install-receipt.json")).equals(jsonBytes(installReceipt))) throw nativeError("ACTIVATION_REJECTED");
  for (const file of snapshot.files) {
    if (!(await privateNativeFile(stateRoot, file.relativePath)).equals(file.bytes)) throw nativeError("ACTIVATION_REJECTED");
  }
  if (!isDeepStrictEqual((await readdir(path.join(stateRoot, "workspace"))).sort(), ["AGENTS.md", "IDENTITY.md", "SOUL.md", "USER.md"])) throw nativeError("ACTIVATION_REJECTED");
  const managed = snapshot.files.map(file => ({ path: file.relativePath, digest: digest(file.bytes) })).sort((a,b) => a.path.localeCompare(b.path));
  if (!isDeepStrictEqual(managed, installReceipt.managedFiles)) throw nativeError("ACTIVATION_REJECTED");
  for (const directory of ["home", "state", "xdg-config", "xdg-data", "xdg-cache", "tmp", "native-chat-attempts"]) {
    const info = await lstat(path.join(stateRoot, directory));
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o700) throw nativeError("ACTIVATION_REJECTED");
    await admitNativeRuntimeTree(path.join(stateRoot, directory));
  }
  await admitNativeRuntimeTree(path.join(stateRoot, "agents"));
  // OpenClaw otherwise loads ambient dotenv files outside the explicit runtime input.
  for (const relative of [".env", "state/.env"]) {
    try { await lstat(path.join(stateRoot, relative)); throw nativeError("ACTIVATION_REJECTED"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return snapshot;
}

async function admitNativeRuntimeTree(root) {
  const pending = [root]; let entries = 0;
  while (pending.length) {
    if (++entries > 4096) throw nativeError("ACTIVATION_REJECTED");
    const current = pending.pop(), info = await lstat(current);
    if (info.isSymbolicLink() || info.uid !== process.getuid() || !info.isDirectory() && (!info.isFile() || info.nlink !== 1)) throw nativeError("ACTIVATION_REJECTED");
    if (info.isDirectory()) pending.push(...(await readdir(current)).map(name => path.join(current, name)));
  }
}

export async function installNativeChat(options) {
  let snapshot, request, consumption;
  try {
    if (!exactKeys(options, installKeys)) throw nativeError("INSTALL_REJECTED");
    request = { ...options, plan: structuredClone(options.plan), ordinaryApproval: structuredClone(options.ordinaryApproval),
      sensitiveDecisions: structuredClone(options.sensitiveDecisions), conflictApproval: structuredClone(options.conflictApproval) };
    snapshot = await nativeInstallSnapshot(Object.fromEntries(preflightKeys.map((key) => [key, request[key]])));
    consumption = await consumeNativeAuthoritySet(Object.fromEntries(
      ["authorityRoot", "stateRoot", "plan", "ordinaryApproval", "sensitiveDecisions", "conflictApproval"].map((key) => [key, request[key]])));
  } catch { throw nativeError("INSTALL_REJECTED"); }
  const { plan, stateRoot, executablePath } = request;
  const receipt = { schemaVersion: "agentmo.openclaw-install-receipt.v1", execution_profile: "native-chat", lifecycle: "install",
    status: "incomplete", installPlanDigest: plan.installPlanDigest, archiveDigest: plan.archiveBinding.archiveSha256,
    binding: structuredClone(plan.nativeBinding), authorityBindingDigest: consumption.authorityBindingDigest,
    consumptionDigest: consumption.consumptionDigest, rootIdentity: null, managedFiles: [], commandResults: [],
    failureCode: "AGENTMO_NATIVE_INSTALL_INCOMPLETE",
    certificationBoundary: { installed: false, active: false, runtime: false, domain: false, birth: false, delivery: false, production: false } };
  try {
    await publishNativeChatFiles({ root: stateRoot, files: snapshot.files });
    receipt.rootIdentity = nativeIdentity(await lstat(stateRoot, { bigint: true }));
    for (const directory of ["home", "state", "xdg-config", "xdg-data", "xdg-cache", "tmp", "native-chat-attempts"]) {
      await mkdir(path.join(stateRoot, directory), { mode: 0o700 });
    }
    for (const action of plan.sensitiveActions) {
      await snapshot.verifyTarget();
      const child = spawn(executablePath, action.argv, { cwd: stateRoot,
        env: { ...nativeChildEnvironment(stateRoot), AGENTMO_NATIVE_PROXY_TOKEN: "offline-placeholder" },
        shell: false, stdio: ["ignore", "pipe", "pipe"], detached: true });
      const observation = await settleNativeChild(child, { timeout: action.timeoutMs, format: "observation",
        stop: () => { try { process.kill(-child.pid, "SIGKILL"); } catch {} } });
      await snapshot.verifyTarget();
      const value = JSON.parse(observation.text), binding = plan.nativeBinding;
      const matches = (agent) => agent?.workspace === path.join(stateRoot, binding.workspace)
        && agent.agentDir === path.join(stateRoot, binding.agentDir) && agent.model === nativeChatModelProfile(binding.modelProfile).nativeModel;
      if (action.actionId === "process:native-setup-baseline"
        && (value.ok !== true || value.configStatus !== "unchanged" || value.configPath !== path.join(stateRoot, "config.json")
          || value.workspaceDir !== path.join(stateRoot, binding.workspace)
          || value.sessionsDir !== path.join(stateRoot, "state", "agents", binding.agentId, "sessions"))) throw nativeError("REGISTRATION_REJECTED");
      if (action.actionId === "process:native-agents-list"
        && (!Array.isArray(value) || value.length !== 1 || value[0].id !== binding.agentId || !matches(value[0]))) throw nativeError("REGISTRATION_REJECTED");
      if (action.actionId === "process:native-config-validate" && value.valid !== true) throw nativeError("CONFIG_REJECTED");
      receipt.commandResults.push({ actionId: action.actionId, actionDigest: digest(jsonBytes(action)),
        stdoutDigest: digest(observation.text), stderrDigest: observation.stderrDigest });
    }
    const configBytes = await privateNativeFile(stateRoot, "config.json");
    if (!configBytes.equals(jsonBytes(snapshot.config))) throw nativeError("CONFIG_REJECTED");
    for (const file of snapshot.files) {
      const observed = file.relativePath === "config.json" ? configBytes : await privateNativeFile(stateRoot, file.relativePath);
      if (file.relativePath !== "config.json" && !observed.equals(file.bytes)) throw nativeError("WORKSPACE_REJECTED");
      receipt.managedFiles.push({ path: file.relativePath, digest: digest(observed) });
    }
    receipt.managedFiles.sort((a, b) => a.path.localeCompare(b.path));
    receipt.status = "complete"; receipt.failureCode = null; receipt.certificationBoundary.installed = true;
  } catch {
    // shortcut: interrupted installation stays incomplete, add explicit recovery only with a new approved lifecycle.
    receipt.managedFiles = [];
  }
  if (!validateOpenClawInstallReceipt(receipt).ok) throw nativeError("INSTALL_REJECTED");
  if (receipt.rootIdentity) {
    if (!isDeepStrictEqual(nativeIdentity(await lstat(stateRoot, { bigint: true })), receipt.rootIdentity)) throw nativeError("INSTALL_REJECTED");
    await writeNativeChatFile({ filePath: path.join(stateRoot, "install-receipt.json"), bytes: jsonBytes(receipt) });
  }
  return receipt;
}

async function nativeInstallSnapshot(options, installedReceipt) {
  assertCurrentOpenClawTargetRuntime();
  if (!exactKeys(options, preflightKeys)) throw nativeError("INSTALL_REJECTED");
  const { archivePath, executablePath, stateRoot, budgetRoot, descriptorAdmission, probeAdmission, blueprintAdmission, buildContractAdmission } = options;
  let { plan } = options;
  if (plan?.execution_profile !== "native-chat" || !validateOpenClawInstallPlan(plan).ok
    || typeof stateRoot !== "string" || path.resolve(stateRoot) !== stateRoot
    || await realpath(path.dirname(stateRoot)) !== path.dirname(stateRoot)) throw nativeError("INSTALL_REJECTED");
  if (installedReceipt !== undefined) {
    await verifyOpenClawNativeRuntimeRoot({ plan, stateRoot });
    if (!validateOpenClawInstallReceipt(installedReceipt).ok || installedReceipt.status !== "complete"
      || digest(jsonBytes(installedReceipt)) !== plan.predecessor.installReceiptDigest
      || !isDeepStrictEqual(installedReceipt.rootIdentity, plan.predecessor.rootIdentity)
      || !isDeepStrictEqual(installedReceipt.binding, plan.nativeBinding)) throw nativeError("ACTIVATION_REJECTED");
    const installPlan = buildOpenClawInstallPlan({ execution_profile: "native-chat", lifecycle: "install",
      ...Object.fromEntries(["archiveBinding", "target", "nativeBinding", "authorityRootBinding", "officialConfigDryRun"].map(k => [k, plan[k]])) });
    if (installPlan.installPlanDigest !== plan.predecessor.installPlanDigest
      || installedReceipt.installPlanDigest !== installPlan.installPlanDigest
      || installedReceipt.archiveDigest !== installPlan.archiveBinding.archiveSha256
      || installedReceipt.commandResults.some((r, i) => r.actionDigest !== digest(jsonBytes(installPlan.sensitiveActions[i])))) throw nativeError("ACTIVATION_REJECTED");
    plan = installPlan;
  } else await verifyOpenClawNativeInstallRoot({ plan, stateRoot });
  const descriptor = descriptorAdmission?.value, probe = probeAdmission?.value;
  const descriptorSource = admittedArtifactProvenance(descriptorAdmission, { subject: "openclaw-target-descriptor", value: descriptor });
  admittedArtifactProvenance(probeAdmission, { subject: "openclaw-probe", value: probe });
  const blueprint = blueprintAdmission?.value, contract = buildContractAdmission?.value;
  const blueprintSource = admittedArtifactProvenance(blueprintAdmission, { subject: "blueprint", value: blueprint });
  const contractSource = admittedArtifactProvenance(buildContractAdmission, { subject: "build-contract", value: contract });
  if (blueprint.execution_profile !== "native-chat" || contract.execution_profile !== "native-chat"
    || blueprint.agent_id !== plan.nativeBinding.agentId || contract.agentId !== blueprint.agent_id
    || blueprint.native_model_profile !== plan.nativeBinding.modelProfile
    || contract.specification.runtimeBinding.modelProfile !== plan.nativeBinding.modelProfile
    || contract.bindings.blueprint.digest !== blueprintSource.digest
    || contract.bindings.targetDescriptor.digest !== descriptorSource.digest) throw nativeError("INSTALL_REJECTED");
  if (probe.execution_profile !== "native-chat" || probe.fingerprintDigest !== plan.target.probeFingerprintDigest
    || descriptorSource.digest !== plan.nativeBinding.targetDescriptorDigest
    || !isDeepStrictEqual(descriptorSource, probe.sourceBindings.targetDescriptor)
    || descriptor.target.version !== plan.target.targetVersion || descriptor.target.sourceRevision !== plan.target.targetRevision) throw nativeError("INSTALL_REJECTED");
  const inspection = await inspectAgentPackage({ packagePath: archivePath, expectedArchiveDigest: plan.archiveBinding.archiveSha256 });
  const archiveBytes = await readBoundedNoFollowFile(archivePath, 8 * 1024 * 1024);
  if (digest(archiveBytes) !== plan.archiveBinding.archiveSha256) throw nativeError("INSTALL_REJECTED");
  const archive = JSON.parse(archiveBytes);
  const model = nativeChatModelProfile(plan.nativeBinding.modelProfile);
  const declared = JSON.parse(Buffer.from(archive.members.find(m => m.relativePath === "resources/runtime-binding.json").contentBase64, "base64")).declaredContract;
  if (declared.modelProfile !== plan.nativeBinding.modelProfile || declared.model !== model.model
    || !isDeepStrictEqual(declared, contract.specification.runtimeBinding)) throw nativeError("INSTALL_REJECTED");
  if (inspection.manifest.execution_profile !== "native-chat" || inspection.manifest.packageId !== plan.nativeBinding.agentId
    || plan.target.projectId !== plan.nativeBinding.agentId
    || inspection.manifest.sourceBindings.blueprintDigest !== blueprintSource.digest
    || inspection.manifest.sourceBindings.buildContractDigest !== contractSource.digest
    || inspection.transport.manifestDigest !== plan.archiveBinding.manifestDigest
    || inspection.transport.inventoryDigest !== plan.archiveBinding.inventoryDigest
    || !isDeepStrictEqual(inspection.files, plan.archiveBinding.members)
    || probe.archive.archiveDigest !== plan.archiveBinding.archiveSha256
    || probe.archive.manifestDigest !== plan.archiveBinding.manifestDigest
    || probe.archive.inventoryDigest !== plan.archiveBinding.inventoryDigest
    || ["blueprint", "buildContract", "planApproval"].some(key => inspection.manifest.sourceBindings[`${key}Digest`] !== probe.sourceBindings[key].digest)) throw nativeError("INSTALL_REJECTED");
  const validation = probe.cli.observations.find(x => x.id === "config-validation");
  if (!isDeepStrictEqual(plan.officialConfigDryRun, { commandDigest: digest(jsonBytes(validation.argv)), resultDigest: validation.standardOutputFacts.digest, accepted: true })) throw nativeError("INSTALL_REJECTED");
  const executable = descriptor.members.find(m => m.role === "executable");
  if (!path.isAbsolute(executablePath ?? "") || await realpath(executablePath) !== executablePath) throw nativeError("INSTALL_REJECTED");
  let targetRoot = executablePath;
  for (const part of executable.relativePath.split("/")) { void part; targetRoot = path.dirname(targetRoot); }
  const verifyTarget = async () => {
    const members = Object.fromEntries(descriptor.members.map(m => [m.role, m]));
    const observed = await buildOpenClawTargetDescriptor({ executablePath,
      packageJsonPath: path.join(targetRoot, members["package-json"].relativePath), buildInfoPath: path.join(targetRoot, members["build-info"].relativePath),
      digests: { "target-executable": executable.sha256, "target-package-json": members["package-json"].sha256, "target-build-info": members["build-info"].sha256 } });
    if (!isDeepStrictEqual(observed, descriptor)) throw nativeError("TARGET_REJECTED");
  };
  await verifyTarget();
  await validateCourseBudgetBinding({ root: budgetRoot, budgetReference: plan.nativeBinding.budgetReference });
  for (const port of [plan.nativeBinding.gatewayPort, plan.nativeBinding.proxyPort]) await availableNativePort(port);
  const config = { agents: { defaults: { model: { primary: model.nativeModel, fallbacks: [] },
    workspace: path.join(stateRoot, "workspace"), skipBootstrap: true, heartbeat: { every: "0m" },
    compaction: { enabled: false, memoryFlush: { enabled: false } } },
    entries: { [plan.nativeBinding.agentId]: { name: plan.nativeBinding.agentId, workspace: path.join(stateRoot, plan.nativeBinding.workspace),
      agentDir: path.join(stateRoot, plan.nativeBinding.agentDir), model: model.nativeModel } } },
    gateway: { mode: "local" },
    browser: { enabled: false }, discovery: { mdns: { mode: "off" } }, update: { checkOnStart: false, auto: { enabled: false } },
    memory: { search: { enabled: false } },
    models: { providers: { [model.provider]: { api: "openai-completions", baseUrl: `http://127.0.0.1:${plan.nativeBinding.proxyPort}/v1`,
      apiKey: { source: "env", provider: "default", id: "AGENTMO_NATIVE_PROXY_TOKEN" },
      models: [{ id: model.model, name: model.label, reasoning: false, input: ["text"], contextWindow: 32768, maxTokens: 2048 }] } } },
    secrets: { providers: { default: { source: "env", allowlist: ["AGENTMO_NATIVE_PROXY_TOKEN"] } } },
    plugins: { enabled: false }, skills: { allowBundled: [] }, tools: { profile: "minimal", deny: ["*"] },
    cron: { enabled: false }, hooks: { enabled: false } };
  const files = plan.operations.filter(op => op.operation === "copy-workspace").map(op => ({
    relativePath: op.path, bytes: Buffer.from(archive.members.find(m => m.relativePath === op.sourcePath).contentBase64, "base64"), mode: 0o600,
  }));
  files.push({ relativePath: "config.json", bytes: jsonBytes(config), mode: 0o600 },
    { relativePath: `${plan.nativeBinding.agentDir}/settings.json`, bytes: jsonBytes({ retry: { provider: { maxRetries: 0 } } }), mode: 0o600 });
  return { files, config, verifyTarget, installPlan: plan };
}

async function availableNativePort(port) {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen({ host: "127.0.0.1", port, exclusive: true }, resolve); });
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
async function privateNativeFile(root, relative) {
  let current = root;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink() || info.uid !== process.getuid() || (info.isDirectory() ? (info.mode & 0o777) !== 0o700 : !info.isFile() || info.nlink !== 1 || (info.mode & 0o777) !== 0o600)) throw nativeError("FILES_REJECTED");
  }
  return readBoundedNoFollowFile(current, 1024 * 1024);
}
function nativeIdentity(stat) { return { device: String(stat.dev), inode: String(stat.ino), birthtimeNs: String(stat.birthtimeNs) }; }
function exactKeys(value, keys) { return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k)); }

function digest(bytes) { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
function nativeError(suffix) { return Object.assign(new Error("Native command was rejected."), { code: `AGENTMO_NATIVE_${suffix}` }); }
