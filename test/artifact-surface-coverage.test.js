import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { digestRawBytes, loadAdmittedArtifact } from "../src/artifact-admission.js";
import { CLI_OUTPUT_OWNERS } from "../src/cli.js";
import {
  assertPersistable,
  preparePersistableProductText,
  writePersistableJsonAtomic,
  writePersistableProductTextAtomic,
} from "../src/persistability.js";
import { buildAgentMoReport } from "../src/report.js";
import { buildRunEval } from "../src/run-state.js";
import {
  buildLiveSmokeSummary,
  persistLiveSmokeCandidate,
} from "../scripts/live-smoke-summary.js";
import { buildAdmittedDelivery } from "./helpers/admitted-reports.js";
import {
  inventoryJavaScriptSource,
  inventoryShellSource,
  IO_SURFACE_ALLOWLIST,
  scanIoSurfaces,
  surfaceId,
} from "./helpers/io-surface-inventory.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SUPPORT_BLUEPRINT = new URL("../examples/support-triage.agentmo.json", import.meta.url);
const SYNTHETIC_DIGEST = `sha256:${"a".repeat(64)}`;

describe("artifact/output surface inventory", () => {
  it("resolves aliases, namespaces, FileHandle calls, managed writers, and output channels", () => {
    const source = [
      'import { writeFile as wf, open as openFile } from "node:fs/promises";',
      'import * as fsp from "node:fs/promises";',
      'import { readFile as sourceIntakeReadFile } from "node:fs/promises";',
      'const handle = await openFile("synthetic", "w");',
      'await sourceIntakeIo.open("synthetic", 0);',
      'await sourceIntakeIo.lstat("synthetic");',
      'await sourceIntakeIo.realpath("synthetic");',
      'await wf("synthetic", "safe");',
      'await fsp.appendFile("synthetic", "safe");',
      'await handle.writeFile("safe");',
      'await managedWriter.write("safe");',
      'process.stdout.write("safe");',
      'process.stderr.write("safe");',
      'console.error("safe");',
      'const operation = { type: "write-file", content: "safe" };',
      'await sourceIntakeReadFile("synthetic", "utf8");',
    ].join("\n");
    const signatures = inventoryJavaScriptSource(source).map((item) => `${item.kind}:${item.callee}`);
    assert.deepEqual(signatures, [
      "filesystem-open:fs.open",
      "non-artifact-intake:sourceIntakeIo.open",
      "non-artifact-intake:sourceIntakeIo.lstat",
      "non-artifact-intake:sourceIntakeIo.realpath",
      "filesystem:fs.writeFile",
      "filesystem:fs.appendFile",
      "file-handle:FileHandle.writeFile",
      "managed-writer:managedWriter.write",
      "process-output:process.stdout.write",
      "process-output:process.stderr.write",
      "console-output:console.error",
      "managed-operation:operation:write-file",
      "non-artifact-intake:fs.readFile",
    ]);
  });

  it("fails visible across durable loaders, retained reads, lifecycle calls, serializers, and aliased outputs", () => {
    const source = [
      'import { cp, open as openFile, readFile as load, rename } from "node:fs/promises";',
      'const handle = await openFile("synthetic", "r+");',
      'await load("synthetic");',
      'await handle.read(Buffer.alloc(1), 0, 1, 0);',
      'await handle.truncate(0);',
      'await rename("before", "after");',
      'await cp("before", "after");',
      'await loadAdmittedArtifact(options);',
      'await emitPersistableOutput(configuration);',
      'return sink(formatted);',
      'const out = process.stdout;',
      'out.write("safe");',
      'process["stderr"].write("safe");',
      'const logger = console;',
      'logger.warn("safe");',
      'stream.end("safe");',
    ].join("\n");
    const signatures = inventoryJavaScriptSource(source).map((item) => `${item.kind}:${item.callee}`);
    assert.deepEqual(signatures, [
      "filesystem-open:fs.open",
      "filesystem-read:fs.readFile",
      "file-handle-read:FileHandle.read",
      "file-handle-lifecycle:FileHandle.truncate",
      "filesystem-lifecycle:fs.rename",
      "unclassified:fs.cp",
      "durable-loader:loadAdmittedArtifact",
      "serializer-to-sink:emitPersistableOutput",
      "serializer-to-sink:sink",
      "process-output:process.stdout.write",
      "process-output:process.stderr.write",
      "console-output:console.warn",
      "stream-write:stream.end",
    ]);
  });

  it("detects shell byte reads, command outputs, and every redirection class", () => {
    const signatures = inventoryShellSource([
      'command > "$OUT"',
      'command | tee "$OUT"',
      'command >> "$OUT"',
      'command < "$IN"',
      'printf "%s" "$VALUE" >&2',
      'cat "$SUMMARY"',
      "node <<'NODE'",
      'node -e \'fs.writeSync(1, crypto.update(fs.readFileSync(process.argv[1])))\' "$FILE"',
      "",
    ].join("\n"))
      .map((item) => `${item.kind}:${item.callee}`);
    assert.deepEqual(signatures, [
      "shell-redirection:shell.redirect",
      "shell-redirection:shell.tee",
      "shell-redirection:shell.redirect",
      "shell-input:shell.redirect-input",
      "shell-output:shell.printf",
      "shell-redirection:shell.fd-redirect",
      "shell-file-read:shell.cat",
      "shell-output:shell.cat",
      "shell-input:shell.heredoc",
      "shell-exact-byte-read:fs.readFileSync",
      "shell-output:shell.node-fd1",
    ]);
  });

  it("classifies every current repository write/output surface with one exact owner and status", async () => {
    const discoveredIds = (await scanIoSurfaces(REPO_ROOT)).map(surfaceId).sort(compareSurfaceIds);
    const allowedIds = Array.from(IO_SURFACE_ALLOWLIST.keys()).sort(compareSurfaceIds);
    assert.deepEqual(discoveredIds, allowedIds);
    for (const [id, classification] of IO_SURFACE_ALLOWLIST) {
      assert.match(id, /^(?:src|bin|scripts)\//u);
      assert.match(
        classification.owner,
        /^(?:phase-01\.1-plan-(?:0[2-9]|1[0-3])|phase-01\.2-plan-(?:04|05|06|11|12))$/u,
      );
      assert.match(
        classification.status,
        /^(?:gated|diagnostic|non-artifact|non-artifact-intake|ephemeral-secret|transient-runtime)$/u,
      );
    }
    assert.deepEqual(
      Array.from(IO_SURFACE_ALLOWLIST.entries()).filter(([, classification]) => (
        classification.status === "unclassified" || classification.status.startsWith("pending:")
      )),
      [],
    );
    assert.deepEqual((await scanIoSurfaces(REPO_ROOT)).filter(({ kind }) => kind === "unclassified"), []);
  });

  it("proves durable reads use one exact retained capture instead of trusting a gated label", async () => {
    const bytes = await readFile(SUPPORT_BLUEPRINT);
    const expectedDigest = digestRawBytes(bytes);
    const stable = retainedInput(bytes);
    const admission = await loadAdmittedArtifact({
      filePath: "operator-blueprint",
      subject: "blueprint",
      expectedDigest,
      openInput: stable.openInput,
    });
    assert.equal(admission.digest, expectedDigest);
    assert.deepEqual(stable.effects, ["open:r", "stat", "read", "read", "stat", "close"]);

    const changed = retainedInput(bytes, { changeAfterRead: true });
    await assert.rejects(
      loadAdmittedArtifact({
        filePath: "operator-blueprint",
        subject: "blueprint",
        expectedDigest,
        openInput: changed.openInput,
      }),
      (error) => error?.code === "AGENTMO_ARTIFACT_READ_FAILED",
    );
    assert.equal(changed.effects.at(-1), "close");
  });

  it("proves managed writes require validated or branded candidates before any effect", async () => {
    for (const operation of [
      (io) => writePersistableJsonAtomic("/transient/output.json", { value: "/private/tmp/host-path" }, { io }),
      (io) => writePersistableProductTextAtomic("/transient/output.txt", { text: "forged" }, { io }),
    ]) {
      const { io, effects } = recordingIo();
      await assert.rejects(operation(io));
      assert.deepEqual(effects, []);
    }

    const { io, effects } = recordingIo();
    const branded = preparePersistableProductText("bounded generated product text");
    await writePersistableProductTextAtomic("/transient/output.txt", branded, { io });
    assert.deepEqual(effects, ["mkdir", "writeFile", "rename"]);
  });

  it("proves each report/eval builder returns a persistable candidate through a real evidence chain", async () => {
    const evidence = await buildAdmittedDelivery({ runId: "surface-behavior-proof" });
    const agentReport = await buildAgentMoReport(evidence.blueprint, {
      admissions: { blueprint: evidence.blueprintAdmission },
    });
    const unverifiedRunEval = buildRunEval(evidence.runState, { expectStatus: "declared" });
    for (const [subject, candidate] of [
      ["agentmo-report", agentReport],
      ["run-eval", unverifiedRunEval],
      ["run-eval", evidence.runEval],
      ["birth-report", evidence.birthReport],
      ["domain-eval", evidence.domainEval],
      ["delivery-report", evidence.deliveryReport],
    ]) {
      assert.doesNotThrow(() => assertPersistable(candidate, { subject }));
    }
  });

  it("proves the shell summary writes and emits one validated final candidate", async () => {
    const candidate = buildLiveSmokeSummary(validLiveSmokeSummaryInput());
    const { io, effects, writes } = recordingIo();
    let stdout = "";
    await persistLiveSmokeCandidate(candidate, {
      subject: "live-smoke-summary",
      outputFile: "/transient/live-smoke-summary.json",
      stdout: true,
      io,
      sink: async (text) => {
        effects.push("sink");
        stdout = text;
      },
    });
    assert.deepEqual(effects, ["mkdir", "writeFile", "rename", "sink"]);
    assert.equal(writes.length, 1);
    assert.equal(stdout, writes[0]);
    assert.deepEqual(JSON.parse(stdout), candidate);

    const unsafe = { ...candidate, modelId: "/private/tmp/unsafe-model" };
    const rejected = recordingIo();
    await assert.rejects(
      persistLiveSmokeCandidate(unsafe, {
        subject: "live-smoke-summary",
        outputFile: "/transient/live-smoke-summary.json",
        stdout: true,
        io: rejected.io,
        sink: async () => rejected.effects.push("sink"),
      }),
      (error) => error?.code === "AGENTMO_PERSISTABILITY_SENSITIVE_MATERIAL",
    );
    assert.deepEqual(rejected.effects, []);
  });

  it("owns every Plan 11 command branch and leaves no pending CLI or console sink", async () => {
    assert.deepEqual(CLI_OUTPUT_OWNERS, {
      help: "non-artifact",
      migrate: "artifact",
      "runtime-check": "non-artifact",
      validate: "non-artifact",
      report: "artifact",
      "discover-report": "artifact",
      "discover-pack": "artifact",
      "discover-workspace": "artifact",
      "need-report": "artifact",
      "design-plan": "artifact",
      "blueprint-draft": "artifact",
      handoff: "artifact",
      status: "artifact",
      plan: "artifact",
      "run-plan": "artifact",
      run: "artifact",
      "run-report": "artifact",
      "replay-run": "artifact",
      "run-eval": "artifact",
      "birth-report": "artifact",
      "domain-eval": "artifact",
      "delivery-report": "artifact",
      "observe-run": "artifact",
      scaffold: "non-artifact",
      observe: "artifact",
    });
    assert.equal(Object.isFrozen(CLI_OUTPUT_OWNERS), true);

    const cliSurfaces = Array.from(IO_SURFACE_ALLOWLIST.entries()).filter(([id]) => (
      id.startsWith("src/cli.js:") || id.startsWith("bin/agentmo.js:")
    ));
    assert.equal(cliSurfaces.length > 0, true);
    assert.deepEqual(
      cliSurfaces.filter(([, classification]) => classification.status.startsWith("pending:")),
      [],
    );
    assert.deepEqual(
      cliSurfaces.filter(([id]) => id.includes(":console-output:")),
      [],
    );
    assert.deepEqual(
      Array.from(new Set(cliSurfaces.map(([, classification]) => classification.status))).sort(),
      ["diagnostic", "ephemeral-secret", "gated", "non-artifact", "transient-runtime"],
    );
  });

  it("owns every Plan 12 shell read and output with zero pending script rows", () => {
    const scriptSurfaces = Array.from(IO_SURFACE_ALLOWLIST.entries()).filter(([id]) => (
      id.startsWith("scripts/openclaw-live-smoke.sh:")
    ));
    assert.equal(scriptSurfaces.length > 0, true);
    assert.deepEqual(
      scriptSurfaces.filter(([, classification]) => classification.status.startsWith("pending:")),
      [],
    );
    assert.equal(
      scriptSurfaces.some(([id]) => id.includes(":shell-exact-byte-read:fs.readFileSync")),
      true,
    );
    assert.equal(
      scriptSurfaces.some(([id]) => id.includes(":shell-input:shell.redirect-input")),
      true,
    );
    assert.equal(
      scriptSurfaces.some(([id]) => id.includes(":shell-output:")),
      true,
    );
  });
});

function compareSurfaceIds(left, right) {
  return left.localeCompare(right, undefined, { numeric: true });
}

function retainedInput(bytes, options = {}) {
  const effects = [];
  const baseStat = {
    dev: 1n,
    ino: 2n,
    size: BigInt(bytes.length),
    mtimeNs: 3n,
    ctimeNs: 4n,
    isFile: () => true,
  };
  let statCalls = 0;
  const handle = {
    async stat() {
      effects.push("stat");
      statCalls += 1;
      return statCalls === 2 && options.changeAfterRead
        ? { ...baseStat, mtimeNs: baseStat.mtimeNs + 1n }
        : baseStat;
    },
    async read(buffer, offset, length, position) {
      effects.push("read");
      if (position >= bytes.length) return { bytesRead: 0 };
      const bytesRead = Math.min(length, bytes.length - position);
      bytes.copy(buffer, offset, position, position + bytesRead);
      return { bytesRead };
    },
    async close() {
      effects.push("close");
    },
  };
  return {
    effects,
    openInput: async (_file, flags) => {
      effects.push(`open:${flags}`);
      return handle;
    },
  };
}

function recordingIo() {
  const effects = [];
  const writes = [];
  return {
    effects,
    writes,
    io: {
      mkdir: async () => effects.push("mkdir"),
      writeFile: async (_file, text) => {
        effects.push("writeFile");
        writes.push(text);
      },
      rename: async () => effects.push("rename"),
    },
  };
}

function validLiveSmokeSummaryInput() {
  return {
    agentId: "win9",
    providerId: "deepseek",
    modelId: "deepseek/deepseek-v4-flash",
    thinkingMode: "off",
    timeoutMs: 120_000,
    transportRequested: "local",
    gatewayStarted: false,
    gatewayEphemeralAuthenticationGenerated: false,
    blueprintDigest: SYNTHETIC_DIGEST,
    runtimePlanDigest: SYNTHETIC_DIGEST,
    runStateDigest: SYNTHETIC_DIGEST,
    runReportDigest: SYNTHETIC_DIGEST,
    runEvalDigest: SYNTHETIC_DIGEST,
    statusDigest: SYNTHETIC_DIGEST,
    scrubReportDigest: SYNTHETIC_DIGEST,
    runEvalExitCode: 0,
    statusExitCode: 0,
  };
}
