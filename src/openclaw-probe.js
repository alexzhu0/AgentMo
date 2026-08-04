import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as FS_CONSTANTS } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  admittedArtifactProvenance,
  digestRawBytes,
  loadAdmittedArtifact,
} from "./artifact-admission.js";
import { inspectAgentPackage } from "./package-inspect.js";
import {
  assertPersistable,
  serializePersistableJson,
} from "./persistability.js";
import {
  assertCurrentOpenClawTargetRuntime,
  observeCurrentRuntime,
} from "./runtime-compatibility.js";
import {
  OPENCLAW_PROBE_SCHEMA_VERSION,
  validateOpenClawProbe,
} from "./openclaw-probe-contract.js";

export {
  OPENCLAW_PROBE_SCHEMA_VERSION,
  validateOpenClawProbe,
} from "./openclaw-probe-contract.js";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const MAX_TARGET_MEMBER_BYTES = 16 * 1024 * 1024;
const MAX_CHILD_OUTPUT_BYTES = 64 * 1024;
const CHILD_TIMEOUT_MS = 10_000;
const RUNTIME_EXECUTION_FD = 3;
const PROBE_SCRIPT_FD = 0;
const PROBE_COMMANDS = Object.freeze([
  Object.freeze({ id: "version", args: Object.freeze(["--version"]) }),
  Object.freeze({
    id: "skill-eligibility",
    args: Object.freeze(["skills", "list", "--eligible", "--json"]),
  }),
  Object.freeze({
    id: "config-validation",
    args: Object.freeze(["config", "validate", "--json"]),
  }),
]);
const SOURCE_OPTION_BINDINGS = Object.freeze([
  Object.freeze(["blueprint", "blueprintPath", "expectedBlueprintDigest"]),
  Object.freeze(["build-contract", "buildContractPath", "expectedBuildContractDigest"]),
  Object.freeze(["plan-approval", "planApprovalPath", "expectedPlanApprovalDigest"]),
  Object.freeze([
    "openclaw-target-descriptor",
    "targetDescriptorPath",
    "expectedTargetDescriptorDigest",
  ]),
]);
const SENSITIVE_OUTPUT_PATTERN =
  /(?:sk-[A-Za-z0-9_-]{8,}|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|cookie|session)[=:]\s*\S+|\/(?:Users|home)\/[^\s"'`]+)/iu;

export class OpenClawProbeError extends Error {
  constructor(code) {
    super("OpenClaw capability probe was rejected.");
    this.name = "OpenClawProbeError";
    this.code = code;
  }
}

export async function probeOpenClawTarget(options = {}) {
  let privateRoot = null;
  let retainedExecution = null;
  let retainedTarget = null;
  let stage = "OPTIONS";
  try {
    assertProbeOptions(options);
    assertCurrentOpenClawTargetRuntime();

    stage = "ARCHIVE";
    const inspection = await inspectAgentPackage({
      packagePath: options.archivePath,
      expectedArchiveDigest: options.expectedArchiveDigest,
    });

    stage = "AUTHORITY";
    const sourceAdmissions = {};
    for (const [subject, pathKey, digestKey] of SOURCE_OPTION_BINDINGS) {
      sourceAdmissions[subject] = await loadAdmittedArtifact({
        subject,
        filePath: options[pathKey],
        expectedDigest: options[digestKey],
      });
    }
    const carrierAdmission = await loadAdmittedArtifact({
      subject: "openclaw-target-carrier-admission",
      filePath: options.targetCarrierAdmissionPath,
      expectedDigest: options.expectedTargetCarrierAdmissionDigest,
      companions: {
        blueprint: sourceAdmissions.blueprint,
        "build-contract": sourceAdmissions["build-contract"],
        "plan-approval": sourceAdmissions["plan-approval"],
        "openclaw-target-descriptor":
          sourceAdmissions["openclaw-target-descriptor"],
      },
    });
    const admission = carrierAdmission.value;
    const descriptor = sourceAdmissions["openclaw-target-descriptor"].value;
    assertArchiveSourceClosure(inspection.manifest, sourceAdmissions, admission);

    stage = "TARGET";
    const targetRoot = await admitCanonicalTargetRoot(options.targetRoot, descriptor);
    retainedTarget = await retainTargetMembers(targetRoot, descriptor, admission);

    stage = "PRIVATE_EXECUTION";
    const executionTransport = retainedExecutionTransport();
    privateRoot = await mkdtemp(path.join(tmpdir(), "agentmo-openclaw-probe-"));
    await chmod(privateRoot, 0o700);
    const privateBin = path.join(privateRoot, "bin");
    const privateCwd = path.join(privateRoot, "cwd");
    const syntheticHome = path.join(privateRoot, "home");
    const syntheticState = path.join(syntheticHome, ".openclaw");
    const syntheticWorkspace = path.join(syntheticHome, "workspace");
    for (const directory of [
      privateBin,
      privateCwd,
      syntheticHome,
      syntheticState,
      syntheticWorkspace,
    ]) {
      await mkdir(directory, { mode: 0o700 });
      await chmod(directory, 0o700);
    }
    const privateRootIdentity = statIdentity(
      await lstat(privateRoot, { bigint: true }),
    );
    const privateExecutable = path.join(privateBin, "openclaw-probe-target.mjs");
    const executable = retainedTarget.members.find(({ role }) => role === "executable");
    if (!executable) fail("AGENTMO_OPENCLAW_PROBE_TARGET_AUTHORITY_MISMATCH");
    const retainedRuntime = await retainCurrentRuntime();
    try {
      const privateExecutableIdentity = await retainPrivateExecutable(
        privateExecutable,
        executable.bytes,
        executable.sha256,
      );
      retainedExecution = {
        transport: executionTransport,
        privateRoot: {
          path: privateRoot,
          identity: privateRootIdentity,
        },
        runtime: retainedRuntime,
        script: privateExecutableIdentity,
      };
    } catch (error) {
      await retainedRuntime.handle.close().catch(() => {});
      throw error;
    }
    const environment = Object.freeze({
      HOME: syntheticHome,
      LANG: "C",
      LC_ALL: "C",
      NO_COLOR: "1",
      OPENCLAW_CONFIG_PATH: path.join(syntheticState, "openclaw.json"),
      OPENCLAW_STATE_DIR: syntheticState,
      OPENCLAW_WORKSPACE_DIR: syntheticWorkspace,
      TMPDIR: privateRoot,
    });
    const cliObservations = [];
    for (const command of PROBE_COMMANDS) {
      await revalidateExecutionAuthority(
        retainedTarget,
        descriptor,
        retainedExecution,
      );
      cliObservations.push(await runIsolatedObservation(
        retainedExecution,
        command,
        environment,
        privateCwd,
      ));
      await revalidateExecutionAuthority(
        retainedTarget,
        descriptor,
        retainedExecution,
      );
    }

    stage = "RESULT";
    const runtime = observeCurrentRuntime();
    const sourceBindings = buildSourceBindings(
      inspection,
      sourceAdmissions,
      carrierAdmission,
    );
    const archive = {
      archiveDigest: inspection.transport.archiveDigest,
      manifestDigest: inspection.transport.manifestDigest,
      inventoryDigest: inspection.transport.inventoryDigest,
      memberCount: inspection.transport.memberCount,
      memberClosureDigest: hashJson(inspection.files),
    };
    const target = {
      id: admission.target.id,
      version: admission.target.version,
      sourceRevision: admission.target.sourceRevision,
      displayRevision: admission.target.displayRevision,
      nodeRange: admission.target.nodeRange,
      descriptorDigest: sourceAdmissions["openclaw-target-descriptor"].digest,
      targetCarrierAdmissionDigest: carrierAdmission.digest,
      targetRootDigest: admission.target.targetRootDigest,
      memberClosureDigest: descriptor.targetRoot.memberClosureDigest,
      memberDigests: retainedTarget.members.map(
        ({ role, relativePath, sha256, byteLength }) => ({
          role,
          relativePath,
          sha256,
          byteLength,
        }),
      ),
      exactTargetMatch: true,
    };
    const cli = {
      executableDigest: admission.target.executableDigest,
      observations: cliObservations,
      contractDigest: hashJson(cliObservations),
    };
    const surfaces = {
      workspace: observationDigest(cliObservations, "skill-eligibility"),
      skills: observationDigest(cliObservations, "skill-eligibility"),
      plugins: "manifest-only-no-runtime-load",
      mcp: "unsupported-no-package-no-connection",
      sandboxToolPolicy: observationDigest(cliObservations, "config-validation"),
      permissionRoute: hashJson(inspection.permissions),
      config: observationDigest(cliObservations, "config-validation"),
      conflicts: hashJson(inspection.conflicts),
    };
    const satisfiedObservationIds = cliObservations
      .filter(({ exitCode, signal, timedOut }) => (
        exitCode === 0 && signal === null && timedOut === false
      ))
      .map(({ id }) => id);
    const required = {
      observationIds: PROBE_COMMANDS.map(({ id }) => id),
      satisfiedObservationIds,
      allSatisfied: satisfiedObservationIds.length === PROBE_COMMANDS.length,
    };
    const status = required.allSatisfied && runtime.supported
      ? "compatible"
      : "incompatible";
    const producer = {
      id: "agentmo.openclaw-probe",
      contractVersion: OPENCLAW_PROBE_SCHEMA_VERSION,
      freshObservation: true,
    };
    const isolation = {
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
    const compatibility = {
      exactArchiveMatch: true,
      exactTargetMatch: true,
      currentProcessSupported: runtime.supported,
      requiredObservationsSatisfied: required.allSatisfied,
      status,
      supportCertified: false,
    };
    const certificationBoundary = {
      readOnlyCapabilityObservation: true,
      installed: false,
      pluginLoaded: false,
      mcpConnected: false,
      agentInvoked: false,
      scheduleTriggered: false,
      credentialsUsed: false,
      runtime: false,
      domain: false,
      birth: false,
      delivery: false,
      production: false,
    };
    const basis = {
      schemaVersion: "agentmo.openclaw-probe-fingerprint-basis.v1",
      status,
      producer,
      sourceBindings,
      archive,
      target,
      runtime,
      cli,
      surfaces,
      required,
      isolation,
      compatibility,
      certificationBoundary,
    };
    const candidate = {
      schemaVersion: OPENCLAW_PROBE_SCHEMA_VERSION,
      status,
      fingerprintDigest: hashJson(basis),
      producer,
      sourceBindings,
      archive,
      target,
      runtime,
      cli,
      surfaces,
      required,
      isolation,
      compatibility,
      certificationBoundary,
      remainingRisks: [
        "The fingerprint proves bounded target observation only.",
        "Installation, runtime behavior, domain quality, and production readiness require separate evidence.",
      ],
    };
    const validation = validateOpenClawProbe(candidate, { sources: sourceBindings });
    if (!validation.ok) fail("AGENTMO_OPENCLAW_PROBE_RESULT_INVALID");
    assertPersistable(candidate, { subject: "openclaw-probe" });
    return deepFreeze(candidate);
  } catch (error) {
    if (error instanceof OpenClawProbeError) throw error;
    fail(`AGENTMO_OPENCLAW_PROBE_${stage}_REJECTED`);
  } finally {
    await closeRetainedExecution(retainedExecution);
    await closeRetainedTarget(retainedTarget);
    // The private tree is never removed through a reopened pathname. A failed
    // or replacement-ambiguous tree remains preserved for OS/operator recovery.
  }
}

function assertArchiveSourceClosure(manifest, sources, carrier) {
  if (manifest?.sourceBindings?.blueprintDigest !== sources.blueprint.digest
    || manifest?.sourceBindings?.buildContractDigest !== sources["build-contract"].digest
    || manifest?.sourceBindings?.planApprovalDigest !== sources["plan-approval"].digest
    || carrier?.authorities?.blueprintDigest !== sources.blueprint.digest
    || carrier?.authorities?.buildContractDigest !== sources["build-contract"].digest
    || carrier?.authorities?.planApprovalDigest !== sources["plan-approval"].digest
    || carrier?.authorities?.targetDescriptorDigest
      !== sources["openclaw-target-descriptor"].digest) {
    fail("AGENTMO_OPENCLAW_PROBE_SOURCE_CLOSURE_MISMATCH");
  }
}

function buildSourceBindings(inspection, sources, carrier) {
  return {
    archive: {
      identity: "agentmo.package-archive.v1",
      subject: "package-archive",
      digest: inspection.transport.archiveDigest,
    },
    packageManifest: {
      identity: inspection.manifest.schemaVersion,
      subject: "package-manifest",
      digest: inspection.transport.manifestDigest,
    },
    blueprint: admittedArtifactProvenance(sources.blueprint, {
      subject: "blueprint",
      value: sources.blueprint.value,
    }),
    buildContract: admittedArtifactProvenance(sources["build-contract"], {
      subject: "build-contract",
      value: sources["build-contract"].value,
    }),
    planApproval: admittedArtifactProvenance(sources["plan-approval"], {
      subject: "plan-approval",
      value: sources["plan-approval"].value,
    }),
    targetCarrierAdmission: admittedArtifactProvenance(carrier, {
      subject: "openclaw-target-carrier-admission",
      value: carrier.value,
    }),
    targetDescriptor: admittedArtifactProvenance(sources["openclaw-target-descriptor"], {
      subject: "openclaw-target-descriptor",
      value: sources["openclaw-target-descriptor"].value,
    }),
  };
}

async function admitCanonicalTargetRoot(value, descriptor) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    fail("AGENTMO_OPENCLAW_PROBE_TARGET_ROOT_INVALID");
  }
  const resolved = path.resolve(value);
  const stats = await lstat(resolved, { bigint: true });
  if (!stats.isDirectory()
    || stats.isSymbolicLink()
    || !sameIdentity(statIdentity(stats), descriptor.targetRoot.identityBasis)) {
    fail("AGENTMO_OPENCLAW_PROBE_TARGET_ROOT_INVALID");
  }
  const canonical = await realpath(resolved);
  return canonical;
}

async function retainTargetMembers(targetRoot, descriptor, admission) {
  const members = [];
  try {
    for (const expected of descriptor.members) {
      const absolutePath = path.join(targetRoot, ...expected.relativePath.split("/"));
      const handle = await open(
        absolutePath,
        FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW,
      );
      const before = await handle.stat({ bigint: true });
      if (!before.isFile()
        || before.isSymbolicLink()
        || before.nlink !== 1n
        || !sameIdentity(statIdentity(before), expected.identityBasis)) {
        await handle.close();
        fail("AGENTMO_OPENCLAW_PROBE_TARGET_DRIFT");
      }
      const bytes = await readRetainedBytes(handle, before);
      const after = await handle.stat({ bigint: true });
      const observed = {
        role: expected.role,
        relativePath: expected.relativePath,
        sha256: digestRawBytes(bytes),
        byteLength: bytes.byteLength,
        absolutePath,
        identity: statIdentity(after),
        bytes,
        handle,
      };
      if (!sameIdentity(observed.identity, expected.identityBasis)
        || observed.sha256 !== expected.sha256
        || observed.byteLength !== expected.byteLength) {
        await handle.close();
        fail("AGENTMO_OPENCLAW_PROBE_TARGET_DRIFT");
      }
      members.push(observed);
    }
    const byRole = Object.fromEntries(
      members.map((member) => [member.role, member.sha256]),
    );
    if (byRole.executable !== admission.target.executableDigest
      || byRole["package-json"] !== admission.target.packageJsonDigest
      || byRole["build-info"] !== admission.target.buildInfoDigest) {
      fail("AGENTMO_OPENCLAW_PROBE_TARGET_DRIFT");
    }
    return { root: targetRoot, members };
  } catch (error) {
    await Promise.allSettled(members.map(({ handle }) => handle.close()));
    throw error;
  }
}

async function readRetainedBytes(handle, before) {
  if (before.size <= 0n || before.size > BigInt(MAX_TARGET_MEMBER_BYTES)) {
    fail("AGENTMO_OPENCLAW_PROBE_TARGET_DRIFT");
  }
  const length = Number(before.size);
  const bytes = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const result = await handle.read(bytes, offset, length - offset, offset);
    if (!Number.isInteger(result.bytesRead) || result.bytesRead <= 0) {
      fail("AGENTMO_OPENCLAW_PROBE_TARGET_DRIFT");
    }
    offset += result.bytesRead;
  }
  return bytes;
}

async function retainPrivateExecutable(filePath, bytes, expectedDigest) {
  let writableHandle;
  let retainedHandle;
  try {
    writableHandle = await open(
      filePath,
      FS_CONSTANTS.O_RDWR
        | FS_CONSTANTS.O_CREAT
        | FS_CONSTANTS.O_EXCL
        | FS_CONSTANTS.O_NOFOLLOW,
      0o700,
    );
    await writableHandle.writeFile(bytes);
    await writableHandle.sync();
    await writableHandle.chmod(0o700);
    const writtenStats = await writableHandle.stat({ bigint: true });
    retainedHandle = await open(
      `/proc/self/fd/${writableHandle.fd}`,
      FS_CONSTANTS.O_RDONLY,
    );
    const retainedStats = await retainedHandle.stat({ bigint: true });
    const observed = await readRetainedBytes(retainedHandle, retainedStats);
    if (!sameIdentity(statIdentity(writtenStats), statIdentity(retainedStats))
      || digestRawBytes(observed) !== expectedDigest) {
      fail("AGENTMO_OPENCLAW_PROBE_PRIVATE_COPY_DRIFT");
    }
    const namedStats = await lstat(filePath, { bigint: true });
    const retainedFinalStats = await retainedHandle.stat({ bigint: true });
    if (!namedStats.isFile()
      || namedStats.isSymbolicLink()
      || namedStats.nlink !== 1n
      || !retainedFinalStats.isFile()
      || retainedFinalStats.nlink !== 1n
      || !sameIdentity(statIdentity(namedStats), statIdentity(retainedFinalStats))
      || digestRawBytes(
        await readRetainedBytes(retainedHandle, retainedFinalStats),
      ) !== expectedDigest) {
      fail("AGENTMO_OPENCLAW_PROBE_PRIVATE_COPY_DRIFT");
    }
    await writableHandle.close();
    writableHandle = null;
    return {
      path: filePath,
      digest: expectedDigest,
      identity: statIdentity(retainedFinalStats),
      handle: retainedHandle,
    };
  } catch (error) {
    await writableHandle?.close().catch(() => {});
    await retainedHandle?.close().catch(() => {});
    throw error;
  }
}

async function retainCurrentRuntime() {
  let runtimeHandle;
  let loadedRuntimeHandle;
  try {
    runtimeHandle = await open(
      process.execPath,
      FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW,
    );
    loadedRuntimeHandle = await open("/proc/self/exe", FS_CONSTANTS.O_RDONLY);
    const runtimeStats = await runtimeHandle.stat({ bigint: true });
    const loadedStats = await loadedRuntimeHandle.stat({ bigint: true });
    const pathStats = await lstat(process.execPath, { bigint: true });
    if (!runtimeStats.isFile()
      || !loadedStats.isFile()
      || !pathStats.isFile()
      || pathStats.isSymbolicLink()
      || (runtimeStats.mode & 0o111n) === 0n
      || !sameIdentity(statIdentity(runtimeStats), statIdentity(loadedStats))
      || !sameIdentity(statIdentity(runtimeStats), statIdentity(pathStats))) {
      fail("AGENTMO_OPENCLAW_PROBE_RUNTIME_DRIFT");
    }
    return {
      handle: runtimeHandle,
      identity: statIdentity(runtimeStats),
    };
  } catch (error) {
    await runtimeHandle?.close().catch(() => {});
    throw error;
  } finally {
    await loadedRuntimeHandle?.close().catch(() => {});
  }
}

async function revalidateExecutionAuthority(
  retained,
  descriptor,
  execution,
) {
  const rootStats = await lstat(retained.root, { bigint: true });
  if (!rootStats.isDirectory()
    || rootStats.isSymbolicLink()
    || !sameIdentity(statIdentity(rootStats), descriptor.targetRoot.identityBasis)) {
    fail("AGENTMO_OPENCLAW_PROBE_TARGET_DRIFT");
  }
  for (const member of retained.members) {
    const handleStats = await member.handle.stat({ bigint: true });
    const pathStats = await lstat(member.absolutePath, { bigint: true });
    if (!handleStats.isFile()
      || handleStats.nlink !== 1n
      || !pathStats.isFile()
      || pathStats.isSymbolicLink()
      || pathStats.nlink !== 1n
      || !sameIdentity(statIdentity(handleStats), member.identity)
      || !sameIdentity(statIdentity(pathStats), member.identity)) {
      fail("AGENTMO_OPENCLAW_PROBE_TARGET_DRIFT");
    }
  }
  const privateRootStats = await lstat(execution.privateRoot.path, { bigint: true });
  if (!privateRootStats.isDirectory()
    || privateRootStats.isSymbolicLink()
    || !sameIdentity(
      statIdentity(privateRootStats),
      execution.privateRoot.identity,
    )) {
    fail("AGENTMO_OPENCLAW_PROBE_PRIVATE_COPY_DRIFT");
  }
  const loadedRuntimeHandle = await open("/proc/self/exe", FS_CONSTANTS.O_RDONLY);
  try {
    const runtimeStats = await execution.runtime.handle.stat({ bigint: true });
    const loadedRuntimeStats = await loadedRuntimeHandle.stat({ bigint: true });
    if (!runtimeStats.isFile()
      || !sameIdentity(statIdentity(runtimeStats), execution.runtime.identity)
      || !sameIdentity(statIdentity(runtimeStats), statIdentity(loadedRuntimeStats))) {
      fail("AGENTMO_OPENCLAW_PROBE_RUNTIME_DRIFT");
    }
    const scriptPathStats = await lstat(execution.script.path, { bigint: true });
    const scriptHandleStats = await execution.script.handle.stat({ bigint: true });
    const bytes = await readRetainedBytes(
      execution.script.handle,
      scriptHandleStats,
    );
    if (!scriptPathStats.isFile()
      || scriptPathStats.isSymbolicLink()
      || scriptPathStats.nlink !== 1n
      || !scriptHandleStats.isFile()
      || scriptHandleStats.nlink !== 1n
      || !sameIdentity(
        statIdentity(scriptPathStats),
        execution.script.identity,
      )
      || !sameIdentity(
        statIdentity(scriptHandleStats),
        execution.script.identity,
      )
      || digestRawBytes(bytes) !== execution.script.digest) {
      fail("AGENTMO_OPENCLAW_PROBE_PRIVATE_COPY_DRIFT");
    }
  } finally {
    await loadedRuntimeHandle.close();
  }
}

function retainedExecutionTransport() {
  if (process.platform !== "linux") {
    fail("AGENTMO_OPENCLAW_PROBE_PLATFORM_FD_TRANSPORT_UNAVAILABLE");
  }
  return {
    executable: `/proc/self/fd/${RUNTIME_EXECUTION_FD}`,
    runtimeFd: RUNTIME_EXECUTION_FD,
    script: "-",
    scriptFd: PROBE_SCRIPT_FD,
  };
}

async function closeRetainedExecution(retained) {
  if (!retained) return;
  await Promise.allSettled([
    retained.runtime.handle.close(),
    retained.script.handle.close(),
  ]);
}

async function closeRetainedTarget(retained) {
  if (!retained) return;
  await Promise.allSettled(retained.members.map(({ handle }) => handle.close()));
}

async function runIsolatedObservation(execution, command, environment, cwd) {
  const result = await spawnBounded(
    execution.transport.executable,
    ["--input-type=module", execution.transport.script, ...command.args],
    environment,
    cwd,
    execution,
  );
  const stdout = normalizeChildOutput(result.stdout);
  const stderr = normalizeChildOutput(result.stderr);
  return {
    id: command.id,
    argv: [...command.args],
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    standardOutputFacts: outputFacts(stdout),
    standardErrorFacts: outputFacts(stderr),
  };
}

function spawnBounded(executable, args, env, cwd, execution) {
  return new Promise((resolve, reject) => {
    const stdio = ["ignore", "pipe", "pipe", "ignore"];
    stdio[execution.transport.runtimeFd] = execution.runtime.handle.fd;
    stdio[execution.transport.scriptFd] = execution.script.handle.fd;
    const child = spawn(executable, args, {
      cwd,
      env,
      shell: false,
      stdio,
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let rejected = false;
    let timedOut = false;
    const consume = (chunks, key) => (chunk) => {
      const bytes = Buffer.from(chunk);
      if (key === "stdout") stdoutBytes += bytes.byteLength;
      else stderrBytes += bytes.byteLength;
      if (stdoutBytes > MAX_CHILD_OUTPUT_BYTES || stderrBytes > MAX_CHILD_OUTPUT_BYTES) {
        rejected = true;
        child.kill("SIGKILL");
        return;
      }
      chunks.push(bytes);
    };
    child.stdout.on("data", consume(stdout, "stdout"));
    child.stderr.on("data", consume(stderr, "stderr"));
    child.on("error", reject);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, CHILD_TIMEOUT_MS);
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      if (rejected) {
        reject(new OpenClawProbeError("AGENTMO_OPENCLAW_PROBE_OUTPUT_REJECTED"));
        return;
      }
      resolve({
        exitCode: Number.isInteger(exitCode) ? exitCode : -1,
        signal: typeof signal === "string" ? signal : null,
        timedOut,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      });
    });
  });
}

function normalizeChildOutput(bytes) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("AGENTMO_OPENCLAW_PROBE_OUTPUT_REJECTED");
  }
  if (SENSITIVE_OUTPUT_PATTERN.test(text) || text.includes("\0")) {
    fail("AGENTMO_OPENCLAW_PROBE_OUTPUT_REJECTED");
  }
  const normalized = text.trim();
  if (normalized === "") return { kind: "empty", value: null };
  try {
    const value = JSON.parse(normalized);
    assertPersistable(value, { subject: "openclaw-probe-child-output" });
    return { kind: "json", value };
  } catch {
    if (normalized.length > 512 || /[\r\n]/u.test(normalized)) {
      fail("AGENTMO_OPENCLAW_PROBE_OUTPUT_REJECTED");
    }
    return { kind: "text", value: normalized };
  }
}

function outputFacts(output) {
  return {
    kind: output.kind,
    digest: hashJson(output),
    byteLength: Buffer.byteLength(JSON.stringify(output)),
    fields: output.kind === "json" && plainObject(output.value)
      ? Object.keys(output.value).sort()
      : [],
  };
}

function observationDigest(observations, id) {
  return observations.find((entry) => entry.id === id)?.standardOutputFacts.digest
    ?? hashJson(null);
}

function assertProbeOptions(value) {
  const keys = [
    "archivePath",
    "expectedArchiveDigest",
    "blueprintPath",
    "expectedBlueprintDigest",
    "buildContractPath",
    "expectedBuildContractDigest",
    "planApprovalPath",
    "expectedPlanApprovalDigest",
    "targetCarrierAdmissionPath",
    "expectedTargetCarrierAdmissionDigest",
    "targetDescriptorPath",
    "expectedTargetDescriptorDigest",
    "targetRoot",
  ];
  if (!plainObject(value)
    || !sameKeys(value, keys)
    || ![
      value.expectedArchiveDigest,
      value.expectedBlueprintDigest,
      value.expectedBuildContractDigest,
      value.expectedPlanApprovalDigest,
      value.expectedTargetCarrierAdmissionDigest,
      value.expectedTargetDescriptorDigest,
    ].every((digest) => DIGEST_PATTERN.test(digest ?? ""))
    || ![
      value.archivePath,
      value.blueprintPath,
      value.buildContractPath,
      value.planApprovalPath,
      value.targetCarrierAdmissionPath,
      value.targetDescriptorPath,
      value.targetRoot,
    ].every((item) => typeof item === "string" && item.length > 0)) {
    fail("AGENTMO_OPENCLAW_PROBE_OPTIONS_INVALID");
  }
}

function statIdentity(stats) {
  return {
    device: stats.dev.toString(),
    inode: stats.ino.toString(),
    size: stats.size.toString(),
    mtimeNs: stats.mtimeNs.toString(),
    ctimeNs: stats.ctimeNs.toString(),
  };
}

function sameIdentity(left, right) {
  return left?.device === right?.device
    && left?.inode === right?.inode
    && left?.size === right?.size
    && left?.mtimeNs === right?.mtimeNs
    && left?.ctimeNs === right?.ctimeNs;
}

function hashJson(value) {
  return `sha256:${createHash("sha256")
    .update(Buffer.from(serializePersistableJson(value, {
      subject: "openclaw-probe-fingerprint",
    }), "utf8"))
    .digest("hex")}`;
}

function sameKeys(value, keys) {
  return plainObject(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function plainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function fail(code) {
  throw new OpenClawProbeError(code);
}
