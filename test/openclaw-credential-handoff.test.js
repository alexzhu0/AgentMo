import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  link,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import {
  runOpenClawOfficialAction,
} from "../src/openclaw-official-action-runner.js";
import * as openClawOfficialActions from "../src/openclaw-official-action-runner.js";
import {
  buildOpenClawInstallPlan,
} from "../src/openclaw-install-plan.js";
import {
  buildOpenClawAuthorityRootBinding,
} from "../src/openclaw-authority-root-binding.js";
import {
  buildOpenClawConflictApproval,
  buildOpenClawInstallApproval,
  buildOpenClawSensitiveActionDecision,
} from "../src/openclaw-install-approval.js";
import {
  prepareOpenClawAuthorityStateRoot,
  reserveOpenClawAuthoritySet,
} from "../src/openclaw-authority-consumption.js";
import {
  openOpenClawSafeFsSession,
} from "../src/openclaw-safe-fs.js";
import {
  serializePersistableJson,
} from "../src/persistability.js";
import {
  buildApprovedPackageFixture,
} from "./helpers/package-produce-fixture.js";

const digestBytes = (bytes) => (
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`
);
const digestJson = (value, subject) => digestBytes(Buffer.from(
  serializePersistableJson(value, { subject }),
  "utf8",
));

async function officialProcessFixture(source, options = {}) {
  const root = await mkdtemp(
    path.join(tmpdir(), "agentmo-official-process-fixture-"),
  );
  await chmod(root, 0o700);
  const executable = path.join(root, "openclaw.mjs");
  const bytes = Buffer.from(source, "utf8");
  await writeFile(executable, bytes, { mode: 0o700 });
  return {
    root,
    invocation: Object.freeze({
      executable,
      executableDigest: digestBytes(bytes),
      argv: Object.freeze([...(options.argv ?? [])]),
      timeoutMs: options.timeoutMs ?? 50,
      shell: false,
      cwd: root,
      environment: Object.freeze({
        LANG: "C",
        LC_ALL: "C",
        PATH: "/usr/bin:/bin",
      }),
    }),
  };
}

const wait = (milliseconds) => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});

it("sensitive runner rejects unsupported and ambiguous OpenClaw action routes before dispatch", async () => {
  assert.equal(typeof runOpenClawOfficialAction, "function");
  for (const route of [
    "agent",
    "config-replace",
    "mcp",
    "plugin",
    "restart",
    "schedule",
  ]) {
    await assert.rejects(
      () => runOpenClawOfficialAction({ route }),
      (error) => (
        error?.code === "AGENTMO_OPENCLAW_OFFICIAL_ACTION_REJECTED"
      ),
      route,
    );
  }
});

it("official config runner executes one exact dry-run/actual pair and preserves unknown fields", async () => {
  const fixture = await buildApprovedPackageFixture();
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-official-config-"));
  await chmod(root, 0o700);
  const configPath = path.join(root, "openclaw.json");
  const initialConfig = { unknown: { preserved: "byte-for-byte-value" } };
  const patch = {
    agents: {
      "support-triage": {
        workspace: ".agentmo/generations/generation-a",
      },
    },
  };
  const expectedConfig = {
    ...initialConfig,
    agents: patch.agents,
  };
  const beforeBytes = Buffer.from(`${JSON.stringify(initialConfig, null, 2)}\n`);
  const afterBytes = Buffer.from(`${JSON.stringify(expectedConfig, null, 2)}\n`);
  await writeFile(configPath, beforeBytes, { mode: 0o600 });

  const executableRoot = path.join(root, "private-executable");
  await mkdir(executableRoot, { mode: 0o700 });
  const executablePath = path.join(executableRoot, "openclaw.mjs");
  const executableBytes = Buffer.from([
    "import { fsyncSync, ftruncateSync, readFileSync, writeSync } from 'node:fs';",
    "const argv = process.argv.slice(2);",
    "if (argv[0] !== 'config' || argv[1] !== 'patch' || argv[2] !== '--file') process.exit(64);",
    "if (!/^\\/(?:proc\\/self\\/fd|dev\\/fd)\\/3$/.test(process.env.OPENCLAW_CONFIG_PATH ?? '')) process.exit(65);",
    "const patch = JSON.parse(readFileSync(new URL(argv[3], `file://${process.cwd()}/`), 'utf8'));",
    "const configFd = Number(process.env.OPENCLAW_CONFIG_PATH.split('/').at(-1));",
    "const current = JSON.parse(readFileSync(configFd, 'utf8'));",
    "const merge = (left, right) => Object.fromEntries(Object.entries({ ...left, ...right }).map(([key, value]) => [key, value && typeof value === 'object' && !Array.isArray(value) && left?.[key] && typeof left[key] === 'object' ? merge(left[key], value) : value]).filter(([, value]) => value !== null));",
    "if (!argv.includes('--dry-run')) { const bytes = Buffer.from(`${JSON.stringify(merge(current, patch), null, 2)}\\n`); ftruncateSync(configFd, 0); writeSync(configFd, bytes, 0, bytes.length, 0); fsyncSync(configFd); }",
    "",
  ].join("\n"));
  await writeFile(executablePath, executableBytes, { mode: 0o700 });

  const members = [{
    relativePath: "agentmo.package.json",
    type: "file",
    mode: 0o644,
    byteLength: 1,
    sha256: digestBytes(Buffer.from("x")),
  }];
  const archiveBinding = {
    archiveSha256: digestBytes(Buffer.from("archive")),
    manifestDigest: digestBytes(Buffer.from("manifest")),
    inventoryDigest: digestJson(members, "package-member-inventory"),
    members,
  };
  const target = {
    targetId: "openclaw",
    targetVersion: "2026.7.1-2",
    targetRevision: "0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c",
    probeFingerprintDigest: digestBytes(Buffer.from("probe")),
    scope: "project",
    projectId: "support-triage",
  };
  const observations = [{
    path: ".agentmo/generations/genesis",
    parentIdentity: { device: "1", inode: "2" },
  }];
  const observedAt = "2026-07-30T00:00:00.000Z";
  const absentGenesis = {
    schemaVersion: "agentmo.openclaw-absent-genesis.v1",
    target,
    checkedPaths: [observations[0].path],
    observations,
    observedAt,
    absenceObservationDigest: digestJson({
      target,
      checkedPaths: [observations[0].path],
      observations,
      observedAt,
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
  const patchDigest = digestJson(patch, "openclaw-official-config-patch");
  const patchName = `agentmo-config-patch-${patchDigest.slice(7)}.json`;
  const action = {
    actionId: "config:openclaw.json",
    kind: "external-command",
    executable: "openclaw",
    argv: ["config", "patch", "--file", patchName],
    cwd: ".",
    scope: "project",
    target: "openclaw.json",
    timeoutMs: 10_000,
    environmentNames: [],
  };
  const authorityRootBinding = buildOpenClawAuthorityRootBinding({
    targetDescriptorDigest: digestBytes(Buffer.from("target-descriptor")),
    targetRootIdentity: { device: "1", inode: "1" },
    rootIdentity: { device: "1", inode: "2" },
  });
  const plan = buildOpenClawInstallPlan({
    lifecycle: "install",
    archiveBinding,
    authorityRootBinding,
    target,
    operations: [{
      path: "openclaw.json",
      operation: "patch",
      configPatch: { patch, patchDigest },
      baseDigest: digestBytes(beforeBytes),
      currentDigest: digestBytes(beforeBytes),
      desiredDigest: digestBytes(afterBytes),
      ownerMarker: "agentmo:package:support-triage",
      retainedFileIdentity: { device: "1", inode: "3" },
      retainedParentIdentity: { device: "1", inode: "2" },
      conflict: "none",
      rollbackRule: "restore-if-owned-and-current-digest-matches",
    }],
    sensitiveActions: [action],
    conflicts: [],
    officialConfigDryRun: {
      commandDigest: digestBytes(Buffer.from("config-command")),
      resultDigest: digestBytes(Buffer.from("config-result")),
      accepted: true,
    },
    absentGenesis,
  });
  const common = {
    plan,
    decision: "approve",
    issuedAt: "2026-07-30T00:00:00.000Z",
    expiresAt: "2099-07-30T00:00:00.000Z",
  };
  const ordinaryApproval = buildOpenClawInstallApproval({
    ...common,
    useNonce: "official-config:ordinary",
  });
  const decision = buildOpenClawSensitiveActionDecision({
    ...common,
    action,
    useNonce: "official-config:sensitive",
  });
  const conflictApproval = buildOpenClawConflictApproval({
    ...common,
    conflicts: [],
    useNonce: "official-config:conflict",
  });
  const authorityRoot = path.join(root, "authority");
  await mkdir(authorityRoot, { mode: 0o700 });
  await prepareOpenClawAuthorityStateRoot(authorityRoot);
  const authoritySession = await openOpenClawSafeFsSession({
    rootPath: authorityRoot,
    helperPath: fixture.publication.helperPath,
    receiptPath: fixture.publication.receiptPath,
    receiptDigest: fixture.publication.receiptDigest,
  });
  const authorityReservation = await reserveOpenClawAuthoritySet({
    session: authoritySession,
    attemptId: "official-config-attempt",
    plan,
    probe: {
      fingerprintDigest: target.probeFingerprintDigest,
      cli: { executableDigest: digestBytes(executableBytes) },
    },
    ordinaryApproval,
    sensitiveDecisions: [decision],
    conflictApproval,
    now: "2026-07-30T00:30:00.000Z",
  });
  await authoritySession.close();
  const session = await openOpenClawSafeFsSession({
    rootPath: root,
    helperPath: fixture.publication.helperPath,
    receiptPath: fixture.publication.receiptPath,
    receiptDigest: fixture.publication.receiptDigest,
  });
  const baseObservation = await session.observe("openclaw.json");
  const executeConfig = ({
    baseObservation: observation,
    safeFsSession = session,
    runProcess = null,
  }) => runOpenClawOfficialAction({
      route: "config-patch",
      action,
      decision,
      validation: {
        plan,
        now: "2026-07-30T00:30:00.000Z",
        authorityReservation,
        probe: {
          fingerprintDigest: target.probeFingerprintDigest,
          cli: { executableDigest: digestBytes(executableBytes) },
        },
      },
      verifiedExecutable: {
        path: executablePath,
        digest: digestBytes(executableBytes),
      },
      safeFsSession,
      configRelativePath: "openclaw.json",
      configPath,
      baseObservation: observation,
      patch,
      expectedBaseDigest: digestBytes(beforeBytes),
      expectedResultDigest: digestBytes(afterBytes),
      runProcess,
    });
  const result = await executeConfig({ baseObservation });
  if (process.platform !== "linux") {
    assert.equal(result.disposition, "unsupported");
    assert.equal(
      result.unsupportedReason,
      "platform-fd-config-transport-unavailable",
    );
    assert.equal(result.publicationDisposition, "not-attempted");
    assert.equal(result.processGroupFacts.dryRun.processStarted, false);
    assert.equal(result.processGroupFacts.actual.processStarted, false);
    assert.deepEqual(await readFile(configPath), beforeBytes);
    await session.close();
    return;
  }
  assert.equal(result.base.digest, digestBytes(beforeBytes));
  assert.equal(result.base.fileIdentity.device, baseObservation.device);
  assert.equal(result.base.fileIdentity.inode, baseObservation.inode);
  assert.equal(result.result.digest, digestBytes(afterBytes));
  assert.equal(result.result.fileIdentity.device, baseObservation.device);
  assert.equal(result.result.fileIdentity.inode, baseObservation.inode);
  assert.equal(result.publication.disposition, "replaced");
  assert.equal(
    result.publication.guarantee,
    "identity-bound-durable-write",
  );

  assert.equal(result.dryRun.exitCode, 0);
  assert.equal(result.actual.exitCode, 0);
  for (const execution of [result.dryRun, result.actual]) {
    assert.equal(execution.processStarted, true);
    assert.equal(execution.processGroupClosed, true);
    assert.equal(execution.quiescenceVerified, true);
    assert.equal(execution.failureCode, null);
  }
  assert.equal(result.rawOutputPersisted, false);
  assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), expectedConfig);
  assert.deepEqual(
    JSON.parse(await readFile(configPath, "utf8")).unknown,
    initialConfig.unknown,
  );

  const resetBase = async () => {
    await unlink(path.join(executableRoot, patchName)).catch(() => {});
    await writeFile(configPath, beforeBytes);
    const observation = await session.observe("openclaw.json");
    assert.equal(observation.digest, digestBytes(beforeBytes));
    return observation;
  };
  const swapFinal = async (label) => {
    const retainedPath = path.join(root, `approved-${label}.json`);
    const sentinelBytes = Buffer.from(`external-${label}-sentinel`);
    await rename(configPath, retainedPath);
    await writeFile(configPath, sentinelBytes, { mode: 0o600 });
    return { retainedPath, sentinelBytes };
  };
  const restoreFinal = async ({ retainedPath, sentinelBytes }, label) => {
    assert.deepEqual(await readFile(configPath), sentinelBytes);
    await rename(configPath, path.join(root, `preserved-${label}.json`));
    await rename(retainedPath, configPath);
  };

  const preObservation = await resetBase();
  let observeCount = 0;
  let preSwap;
  const preDryRunSession = Object.freeze({
    async observe(relativePath) {
      observeCount += 1;
      if (observeCount === 2) preSwap = await swapFinal("pre-dry-run");
      return session.observe(relativePath);
    },
    replaceExact: (...args) => session.replaceExact(...args),
  });
  await assert.rejects(
    () => executeConfig({
      baseObservation: preObservation,
      safeFsSession: preDryRunSession,
    }),
    (error) => error?.code === "AGENTMO_OPENCLAW_CONFIG_BASE_DRIFT",
  );
  await restoreFinal(preSwap, "pre-dry-run");

  const dryRunObservation = await resetBase();
  let dryRunSwap;
  await assert.rejects(
    () => executeConfig({
      baseObservation: dryRunObservation,
      runProcess: async (invocation) => {
        const execution = await openClawOfficialActions
          .runOpenClawOfficialProcess(invocation);
        if (invocation.argv.includes("--dry-run")) {
          dryRunSwap = await swapFinal("dry-run-actual");
        }
        return execution;
      },
    }),
    (error) => error?.code === "AGENTMO_OPENCLAW_CONFIG_BASE_DRIFT",
  );
  await restoreFinal(dryRunSwap, "dry-run-actual");

  const actualObservation = await resetBase();
  let actualSwap;
  await assert.rejects(
    () => executeConfig({
      baseObservation: actualObservation,
      runProcess: async (invocation) => {
        const execution = await openClawOfficialActions
          .runOpenClawOfficialProcess(invocation);
        if (!invocation.argv.includes("--dry-run")) {
          actualSwap = await swapFinal("actual-post");
        }
        return execution;
      },
    }),
    (error) => error?.code === "AGENTMO_OPENCLAW_CONFIG_BASE_DRIFT",
  );
  await restoreFinal(actualSwap, "actual-post");

  const dryMutationObservation = await resetBase();
  await assert.rejects(
    () => executeConfig({
      baseObservation: dryMutationObservation,
      runProcess: async (invocation) => {
        const execution = await openClawOfficialActions
          .runOpenClawOfficialProcess(invocation);
        if (invocation.argv.includes("--dry-run")) {
          const { fsyncSync, ftruncateSync, writeSync } = await import("node:fs");
          ftruncateSync(invocation.retainedConfigFd, 0);
          writeSync(
            invocation.retainedConfigFd,
            afterBytes,
            0,
            afterBytes.length,
            0,
          );
          fsyncSync(invocation.retainedConfigFd);
        }
        return execution;
      },
    }),
    (error) => (
      error?.code === "AGENTMO_OPENCLAW_CONFIG_DRY_RUN_MUTATED_CANDIDATE"
    ),
  );
  assert.deepEqual(await readFile(configPath), beforeBytes);

  const candidateSwapObservation = await resetBase();
  let replacementPath;
  let retainedCandidatePath;
  let replacementBefore;
  let actualInvocationReached = false;
  await assert.rejects(
    () => executeConfig({
      baseObservation: candidateSwapObservation,
      runProcess: async (invocation) => {
        const execution = await openClawOfficialActions
          .runOpenClawOfficialProcess(invocation);
        if (invocation.argv.includes("--dry-run")) {
          const candidateRoots = (await readdir(executableRoot, {
            withFileTypes: true,
          })).filter((entry) => (
            entry.isDirectory()
              && entry.name.startsWith("agentmo-config-candidate-")
          ));
          const { fstatSync } = await import("node:fs");
          const retained = fstatSync(invocation.retainedConfigFd, {
            bigint: true,
          });
          let candidateRoot;
          for (const entry of candidateRoots) {
            const proposedRoot = path.join(executableRoot, entry.name);
            try {
              const proposed = await stat(
                path.join(proposedRoot, "candidate.json"),
                { bigint: true },
              );
              if (proposed.dev === retained.dev && proposed.ino === retained.ino) {
                candidateRoot = proposedRoot;
                break;
              }
            } catch (error) {
              if (error?.code !== "ENOENT") throw error;
            }
          }
          assert.notEqual(candidateRoot, undefined);
          replacementPath = path.join(candidateRoot, "candidate.json");
          retainedCandidatePath = path.join(
            candidateRoot,
            "candidate.preserved.json",
          );
          await rename(replacementPath, retainedCandidatePath);
          await writeFile(replacementPath, "replacement-victim", {
            mode: 0o600,
            flag: "wx",
          });
          replacementBefore = await stat(replacementPath, { bigint: true });
        } else {
          actualInvocationReached = true;
        }
        return execution;
      },
    }),
    (error) => (
      error?.code === "AGENTMO_OPENCLAW_CONFIG_CANDIDATE_NAME_DRIFT"
        && error?.recovery?.candidate?.pathnameDisposition === "replaced"
        && error?.recovery?.candidate?.cleanupAttempted === false
    ),
  );
  assert.equal(actualInvocationReached, false);
  assert.deepEqual(await readFile(replacementPath), Buffer.from("replacement-victim"));
  const replacementAfter = await stat(replacementPath, { bigint: true });
  assert.equal(replacementAfter.dev, replacementBefore.dev);
  assert.equal(replacementAfter.ino, replacementBefore.ino);
  assert.equal(replacementAfter.nlink, replacementBefore.nlink);
  assert.deepEqual(await readFile(retainedCandidatePath), beforeBytes);
  assert.deepEqual(await readFile(configPath), beforeBytes);

  const quiescenceObservation = await resetBase();
  await assert.rejects(
    () => executeConfig({
      baseObservation: quiescenceObservation,
      runProcess: async (invocation) => {
        const execution = await openClawOfficialActions
          .runOpenClawOfficialProcess(invocation);
        if (invocation.argv.includes("--dry-run")) return execution;
        return {
          ...execution,
          quiescenceVerified: false,
          failureCode: "command-failed-quiescence-unverified",
        };
      },
    }),
    (error) => (
      error?.code === "AGENTMO_OPENCLAW_OFFICIAL_RESULT_REJECTED"
    ),
  );
  assert.deepEqual(await readFile(configPath), beforeBytes);

  const hardLinkObservation = await resetBase();
  const hardLinkPath = path.join(root, "external-hardlink-sentinel.json");
  await assert.rejects(
    () => executeConfig({
      baseObservation: hardLinkObservation,
      runProcess: async (invocation) => {
        const execution = await openClawOfficialActions
          .runOpenClawOfficialProcess(invocation);
        if (!invocation.argv.includes("--dry-run")) {
          await link(configPath, hardLinkPath);
        }
        return execution;
      },
    }),
    (error) => (
      error?.code === "AGENTMO_OPENCLAW_CONFIG_OBSERVATION_REJECTED"
    ),
  );
  assert.deepEqual(await readFile(configPath), beforeBytes);
  assert.deepEqual(await readFile(hardLinkPath), beforeBytes);
  await unlink(hardLinkPath);

  const ancestorObservation = await resetBase();
  const retainedRoot = `${root}-retained`;
  const ancestorSentinel = Buffer.from("external-ancestor-sentinel");
  await assert.rejects(
    () => executeConfig({
      baseObservation: ancestorObservation,
      runProcess: async (invocation) => {
        const execution = await openClawOfficialActions
          .runOpenClawOfficialProcess(invocation);
        if (!invocation.argv.includes("--dry-run")) {
          await rename(root, retainedRoot);
          await mkdir(root, { mode: 0o700 });
          await writeFile(configPath, ancestorSentinel, { mode: 0o600 });
        }
        return execution;
      },
    }),
    (error) => (
      error?.code === "AGENTMO_OPENCLAW_CONFIG_OBSERVATION_REJECTED"
    ),
  );
  assert.deepEqual(await readFile(configPath), ancestorSentinel);
  assert.deepEqual(
    await readFile(path.join(retainedRoot, "openclaw.json")),
    beforeBytes,
  );
  await session.close();
});

it("official process runner kills a delayed-mutation grandchild before bounded settlement", {
  skip: process.platform !== "linux",
  timeout: 10_000,
}, async () => {
  assert.equal(
    typeof openClawOfficialActions.runOpenClawOfficialProcess,
    "function",
  );
  const root = await mkdtemp(
    path.join(tmpdir(), "agentmo-official-grandchild-"),
  );
  const marker = path.join(root, "grandchild-mutated.txt");
  const grandchild = [
    "const { writeFileSync } = require('node:fs');",
    "setTimeout(() => writeFileSync(process.argv[1], 'late'), 400);",
    "setInterval(() => {}, 1000);",
  ].join("");
  const fixture = await officialProcessFixture([
    "import { spawn } from 'node:child_process';",
    `spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}, process.argv[2]], { stdio: 'ignore' });`,
    "setInterval(() => {}, 1000);",
  ].join("\n"), {
    argv: [marker],
    timeoutMs: 40,
  });

  const result = await openClawOfficialActions.runOpenClawOfficialProcess(
    fixture.invocation,
  );
  await wait(500);

  assert.equal(result.timedOut, true);
  assert.equal(result.processStarted, true);
  assert.equal(result.processGroupClosed, true);
  assert.equal(result.quiescenceVerified, true);
  assert.equal(result.failureCode, "timeout");
  await assert.rejects(() => access(marker));
});

it("official process runner applies the output cap to the whole process group", {
  skip: process.platform !== "linux",
  timeout: 10_000,
}, async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "agentmo-official-output-cap-"),
  );
  const marker = path.join(root, "output-grandchild-mutated.txt");
  const grandchild = [
    "const { writeFileSync } = require('node:fs');",
    "setTimeout(() => writeFileSync(process.argv[1], 'late'), 400);",
    "setInterval(() => {}, 1000);",
  ].join("");
  const fixture = await officialProcessFixture([
    "import { spawn } from 'node:child_process';",
    `spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}, process.argv[2]], { stdio: 'ignore' });`,
    "process.stdout.write('x'.repeat(70 * 1024));",
    "setInterval(() => {}, 1000);",
  ].join("\n"), {
    argv: [marker],
    timeoutMs: 2_000,
  });

  const result = await openClawOfficialActions.runOpenClawOfficialProcess(
    fixture.invocation,
  );
  await wait(500);

  assert.equal(result.timedOut, false);
  assert.equal(result.outputLimitExceeded, true);
  assert.equal(result.processGroupClosed, true);
  assert.equal(result.quiescenceVerified, true);
  assert.equal(result.failureCode, "output-limit-exceeded");
  await assert.rejects(() => access(marker));
});

it("official process runner TERM-to-KILLs a stubborn group before returning", {
  skip: process.platform !== "linux",
  timeout: 10_000,
}, async () => {
  const fixture = await officialProcessFixture([
    "process.on('SIGTERM', () => {});",
    "setInterval(() => {}, 1000);",
  ].join("\n"), {
    timeoutMs: 300,
  });
  const startedAt = Date.now();

  const result = await openClawOfficialActions.runOpenClawOfficialProcess(
    fixture.invocation,
  );

  assert.equal(result.timedOut, true);
  assert.equal(result.processGroupClosed, true);
  assert.equal(result.quiescenceVerified, true);
  assert.equal(Date.now() - startedAt >= 500, true);
});

it("official process runner blocks setsid ignored-stdio escape before returning", {
  skip: process.platform !== "linux",
  timeout: 10_000,
}, async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "agentmo-official-escaped-stdout-"),
  );
  const markerPath = path.join(root, "escaped-canary.txt");
  const escaped = [
    "const { writeFileSync } = require('node:fs');",
    "process.on('SIGTERM', () => {});",
    "setTimeout(() => writeFileSync(process.argv[1], 'late'), 400);",
    "setInterval(() => {}, 1000);",
  ].join("");
  const fixture = await officialProcessFixture([
    "import { spawn } from 'node:child_process';",
    "let child;",
    "try {",
    `  child = spawn(process.execPath, ['-e', ${JSON.stringify(escaped)}, process.argv[2]], { detached: true, stdio: 'ignore' });`,
    "} catch { process.exit(92); }",
    "child.once('error', () => process.exit(92));",
    "child.once('spawn', () => { child.unref(); setTimeout(() => process.exit(0), 20); });",
  ].join("\n"), {
    argv: [markerPath],
    timeoutMs: 2_000,
  });
  const result = await openClawOfficialActions.runOpenClawOfficialProcess(
    fixture.invocation,
  );
  await wait(500);

  assert.equal(result.timedOut, false);
  assert.equal(result.processStarted, true);
  assert.equal(result.processGroupClosed, true);
  assert.equal(result.quiescenceVerified, true);
  assert.equal(result.failureCode, "descendant-outlived-parent");
  assert.equal(
    result.containment,
    "linux-subreaper-pidfd-proc-children",
  );
  await assert.rejects(() => access(markerPath));
});

it("official process runner settles supervisor spawn exceptions without starting OpenClaw", {
  skip: process.platform !== "linux",
}, async () => {
  const fixture = await officialProcessFixture("process.exit(0);\n");
  const synchronous = await openClawOfficialActions.runOpenClawOfficialProcess(
    fixture.invocation,
    {
      spawnProcess() {
        const error = new Error("synthetic spawn failure");
        error.code = "ENOENT";
        throw error;
      },
    },
  );

  assert.equal(synchronous.exitCode, 1);
  assert.equal(synchronous.timedOut, false);
  assert.equal(synchronous.outputLimitExceeded, false);
  assert.equal(synchronous.processStarted, false);
  assert.equal(synchronous.processGroupClosed, true);
  assert.equal(synchronous.quiescenceVerified, true);
  assert.equal(synchronous.failureCode, "spawn-failed");
});

it("official process runner rejects caller-selected liveness proof before spawn", {
  timeout: 10_000,
}, async () => {
  const fixture = await officialProcessFixture(
    "setInterval(() => {}, 1000);\n",
    { timeoutMs: 40 },
  );
  const result = await openClawOfficialActions.runOpenClawOfficialProcess(
    fixture.invocation,
    {
      processGroupLivenessProbe: () => true,
    },
  );

  assert.equal(result.processStarted, false);
  assert.equal(result.processGroupClosed, true);
  assert.equal(result.quiescenceVerified, true);
  assert.equal(result.failureCode, "invalid-supervisor-invocation");
});

it("official process runner is unsupported before spawn outside Linux", {
  skip: process.platform === "linux",
}, async () => {
  const fixture = await officialProcessFixture("process.exit(0);\n");
  let spawnReached = false;
  const result = await openClawOfficialActions.runOpenClawOfficialProcess(
    fixture.invocation,
    {
      spawnProcess() {
        spawnReached = true;
        throw new Error("must not spawn");
      },
    },
  );

  assert.equal(spawnReached, false);
  assert.equal(result.processStarted, false);
  assert.equal(result.processGroupClosed, true);
  assert.equal(result.quiescenceVerified, true);
  assert.equal(
    result.failureCode,
    "platform-descendant-containment-unavailable",
  );
});
