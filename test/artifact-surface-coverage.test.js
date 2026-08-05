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
  BUILDER_NPM_TARBALL_INVENTORY,
  BUILDER_RELEASE_ASSET_INVENTORY,
} from "../src/builder-package.js";
import {
  buildLiveSmokeSummary,
  persistLiveSmokeCandidate,
} from "../scripts/live-smoke-summary.js";
import { buildAdmittedDelivery } from "./helpers/admitted-reports.js";
import {
  assertBuilderV1NoPhysicalMutationPolicy,
  assertBuilderV1NoPhysicalMutationSource,
  inventoryJavaScriptSource,
  inventoryShellSource,
  IO_SURFACE_ALLOWLIST,
  scanIoSurfaces,
  surfaceId,
} from "./helpers/io-surface-inventory.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SUPPORT_BLUEPRINT = new URL("../examples/support-triage.agentmo.json", import.meta.url);
const SYNTHETIC_DIGEST = `sha256:${"a".repeat(64)}`;
const PHASE_4_PACKED_SECURITY_CLOSURE = Object.freeze([
  "native/agentmo-nondumpable-preload.c",
  "native/openclaw-fs-kernel.c",
  "native/openclaw-process-supervisor.c",
  "native/prebuilt/linux-x64/README.md",
  "native/prebuilt/linux-x64/agentmo-nondumpable-preload.so",
  "src/artifact-admission.js",
  "src/artifact-contract.js",
  "src/artifact-registry.js",
  "src/cli.js",
  "src/javascript-static-analysis.js",
  "src/native-build-capture.js",
  "src/openclaw-authority-consumption.js",
  "src/openclaw-authority-root-binding.js",
  "src/openclaw-credential-handoff.js",
  "src/openclaw-install-approval.js",
  "src/openclaw-install-evidence.js",
  "src/openclaw-install-plan.js",
  "src/openclaw-install-receipt.js",
  "src/openclaw-install-transaction.js",
  "src/openclaw-official-action-runner.js",
  "src/openclaw-probe-contract.js",
  "src/openclaw-probe.js",
  "src/openclaw-safe-fs.js",
  "src/openclaw-target-admission.js",
  "src/openclaw-target-descriptor.js",
  "src/package-archive.js",
  "src/package-carriers.js",
  "src/package-contract.js",
  "src/package-inspect.js",
  "src/package-produce.js",
  "src/persistability.js",
  "src/plan-approval.js",
  "src/targets/openclaw-package.js",
]);

describe("artifact/output surface inventory", () => {
  it("resolves aliases, namespaces, FileHandle calls, managed writers, and output channels", () => {
    const source = [
      'import { access, writeFile as wf, open as openFile } from "node:fs/promises";',
      'import * as fsp from "node:fs/promises";',
      'import { readFile as sourceIntakeReadFile } from "node:fs/promises";',
      'await access("synthetic");',
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
      "filesystem-read:fs.access",
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
      'await handle.sync();',
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
    assert.throws(
      () => inventoryJavaScriptSource(source),
      (error) => error?.code === "AGENTMO_JAVASCRIPT_STATIC_ANALYSIS_REJECTED",
    );
  });

  it("classifies whole-file URL, regex, template-expression, multiline, alias, and computed I/O", () => {
    const source = [
      'import { writeFile as wf } from "node:fs/promises";',
      'import * as fs from "node:fs/promises";',
      'const url = "https://example.invalid//decoy"; await wf(',
      '  "synthetic",',
      '  url',
      ');',
      'const matcher = /https?:\\/\\/example\\.invalid/u; await fs["readFile"](',
      '  "synthetic"',
      ');',
      'const template = `decoy ${await fs?.["writeFile"](',
      '  "synthetic",',
      '  "safe"',
      ')}`;',
    ].join("\n");
    assert.deepEqual(inventoryJavaScriptSource(source), [
      { file: "fixture.js", line: 3, kind: "filesystem", callee: "fs.writeFile" },
      { file: "fixture.js", line: 7, kind: "filesystem-read", callee: "fs.readFile" },
      { file: "fixture.js", line: 10, kind: "filesystem", callee: "fs.writeFile" },
    ]);
  });

  it("rejects dynamic computed filesystem calls, reassigned aliases, and escaping aliases", () => {
    for (const source of [
      'import * as fs from "node:fs/promises"; const method = "readFile"; await fs[method]("synthetic");',
      'import { readFile as rf } from "node:fs/promises"; rf = async () => Buffer.alloc(0); await rf("synthetic");',
      'import { writeFile as wf } from "node:fs/promises"; const escaped = wf; await escaped("synthetic", "safe");',
    ]) {
      assert.throws(
        () => inventoryJavaScriptSource(source),
        (error) => error?.code === "AGENTMO_JAVASCRIPT_STATIC_ANALYSIS_REJECTED",
      );
    }
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
      "filesystem-read:fs.readFileSync",
      "shell-exact-byte-read:fs.readFileSync",
      "shell-output:shell.node-fd1",
    ]);
  });

  it("classifies every current repository write/output surface with one exact owner and status", async () => {
    const discoveredIds = (await scanIoSurfaces(REPO_ROOT)).map(surfaceId).sort(compareSurfaceIds);
    const allowedIds = Array.from(IO_SURFACE_ALLOWLIST.keys()).sort(compareSurfaceIds);
    assert.deepEqual(discoveredIds, allowedIds);
    for (const [id, classification] of IO_SURFACE_ALLOWLIST) {
      assert.match(id, /^(?:src|bin|scripts|plugin)\//u);
      assert.match(
        classification.owner,
        /^(?:phase-01\.1-plan-(?:0[2-9]|1[0-3])|phase-01\.2-plan-(?:04|05|06|11|12)|phase-02-plan-(?:02|03|04|06|07|08|09|11|12|13|14|15|16|17|18|19|20|21|22|23)|phase-03-plan-(?:01|03|04|05)|phase-04-plan-(?:03|04|05|07|08|09|12|13|14|15|16|17|19))$/u,
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

  it("keeps exact enumeration separate from the Builder v1 no-physical-mutation policy", () => {
    const file = "src/builder-v1-policy-fixture.js";
    const source = [
      'import { rename, rm, unlink } from "node:fs/promises";',
      'import { execFile } from "node:child_process";',
      'await unlink("canonical");',
      'await rm("tree", { recursive: true, force: true });',
      'await rename("stage", "occupied-canonical");',
      'await execFile("codex", ["plugin", "remove", "agentmo"]);',
    ].join("\n");
    const exactlyAllowlisted = new Map([
      [`${file}:3:filesystem-lifecycle:fs.unlink`, { owner: "fixture", status: "gated" }],
      [`${file}:4:filesystem-lifecycle:fs.rm`, { owner: "fixture", status: "gated" }],
      [`${file}:5:filesystem-lifecycle:fs.rename`, { owner: "fixture", status: "gated" }],
    ]);
    assert.deepEqual(
      inventoryJavaScriptSource(source, file).map(surfaceId),
      Array.from(exactlyAllowlisted.keys()),
    );
    assert.throws(
      () => assertBuilderV1NoPhysicalMutationSource(source, file),
      (error) => {
        assert.equal(error?.code, "AGENTMO_BUILDER_V1_PHYSICAL_MUTATION_FORBIDDEN");
        assert.deepEqual(error.violations.map((item) => item.operation), [
          "fs.unlink",
          "fs.rm",
          "fs.rename",
          "external-remove-command",
        ]);
        return true;
      },
    );
  });

  it("forbids physical delete, canonical replace, and remove commands across Builder v1", async () => {
    await assertBuilderV1NoPhysicalMutationPolicy(REPO_ROOT);
  });

  it("keeps Wave 15 production modules exactly inventoried", async () => {
    const changed = new Set([
      "src/builder-checkpoint.js",
      "src/builder-hook-bridge.js",
      "src/builder-behavior-eval.js",
    ]);
    const discovered = (await scanIoSurfaces(REPO_ROOT))
      .filter((item) => changed.has(item.file))
      .map(surfaceId)
      .sort(compareSurfaceIds);
    const allowed = Array.from(IO_SURFACE_ALLOWLIST.entries())
      .filter(([id]) => changed.has(id.split(":", 1)[0]))
      .sort(([left], [right]) => compareSurfaceIds(left, right));
    assert.deepEqual(discovered, allowed.map(([id]) => id));
    assert.equal(allowed.every(([, row]) => row.owner === "phase-02-plan-15"), true);
    assert.deepEqual(
      discovered.filter((id) => id.startsWith("src/builder-checkpoint.js:")),
      [
        "src/builder-checkpoint.js:787:filesystem-read:fs.realpath",
        "src/builder-checkpoint.js:788:filesystem-read:fs.lstat",
        "src/builder-checkpoint.js:817:filesystem-read:fs.realpath",
        "src/builder-checkpoint.js:818:filesystem-read:fs.lstat",
        "src/builder-checkpoint.js:841:filesystem-read:fs.realpath",
        "src/builder-checkpoint.js:842:filesystem-read:fs.realpath",
        "src/builder-checkpoint.js:986:filesystem-read:fs.realpath",
      ],
    );
    assert.deepEqual(
      discovered.filter((id) => id.startsWith("src/builder-hook-bridge.js:")),
      [],
    );
  });

  it("exactly reconciles the Wave 16 through Plan 23 production closure without a side surface", async () => {
    const changed = new Set([
      "scripts/build-builder-uat-releases.js",
      "scripts/verify-codex-uat-candidate.js",
      "scripts/preflight-codex-uat-prior-attempt.js",
      "src/builder-codex-host.js",
      "src/builder-install.js",
      "src/builder-immutable-journal.js",
      "src/builder-codex-uat.js",
      "src/builder-codex-uat-continuation.js",
      "src/builder-codex-uat-private-authority.js",
      "src/builder-package.js",
      "src/cli.js",
    ]);
    const discovered = (await scanIoSurfaces(REPO_ROOT))
      .filter((item) => changed.has(item.file))
      .map(surfaceId)
      .sort(compareSurfaceIds);
    const allowed = Array.from(IO_SURFACE_ALLOWLIST.entries())
      .filter(([id]) => changed.has(id.split(":", 1)[0]))
      .sort(([left], [right]) => compareSurfaceIds(left, right));
    assert.deepEqual(discovered, allowed.map(([id]) => id));
    const owners = new Map([
      ["scripts/build-builder-uat-releases.js", "phase-02-plan-17"],
      ["scripts/verify-codex-uat-candidate.js", "phase-02-plan-18"],
      ["scripts/preflight-codex-uat-prior-attempt.js", "phase-02-plan-23"],
      ["src/builder-codex-host.js", "phase-02-plan-19"],
      ["src/builder-install.js", "phase-02-plan-20"],
      ["src/builder-immutable-journal.js", "phase-02-plan-21"],
      ["src/builder-codex-uat.js", "phase-02-plan-22"],
      ["src/builder-package.js", "phase-02-plan-17"],
      ["src/builder-codex-uat-continuation.js", "phase-02-plan-22"],
      ["src/builder-codex-uat-private-authority.js", "phase-02-plan-23"],
      ["src/cli.js", "phase-02-plan-20"],
    ]);
    assert.equal(allowed.every(([id, row]) => (
      row.owner === owners.get(id.split(":", 1)[0])
        || (id.startsWith("src/cli.js:")
          && [
            "phase-03-plan-04",
            "phase-03-plan-05",
            "phase-04-plan-05",
            "phase-04-plan-08",
            "phase-04-plan-12",
            "phase-04-plan-16",
          ].includes(row.owner))
    )), true);
  });

  it("keeps the Plan 23 private authority outside package, public CLI, plugin, and runtime closure", async () => {
    const privateNames = [
      "builder-codex-uat-private-authority",
      "preflight-codex-uat-prior-attempt",
      "prior-preflight.receipt.json",
      "phase-02-final-retry",
      "continuation.json",
    ];
    const packageJson = JSON.parse(await readFile(path.join(REPO_ROOT, "package.json"), "utf8"));
    assert.equal(packageJson.files.includes("!src/builder-codex-uat-private-authority.js"), true);
    assert.equal(packageJson.files.includes("scripts/preflight-codex-uat-prior-attempt.js"), false);
    const packedClosure = JSON.stringify(BUILDER_RELEASE_ASSET_INVENTORY);
    for (const name of privateNames) assert.equal(packedClosure.includes(name), false);

    const publicSurface = (await Promise.all([
      "bin/agentmo.js",
      "src/cli.js",
      "plugin/.codex-plugin/plugin.json",
      "plugin/hooks/agentmo-hook.js",
      "plugin/hooks/hooks.json",
      "plugin/skills/agentmo/SKILL.md",
    ].map((relativePath) => readFile(path.join(REPO_ROOT, relativePath), "utf8")))).join("\n");
    for (const name of privateNames) assert.equal(publicSurface.includes(name), false);

    const privateScript = await readFile(
      path.join(REPO_ROOT, "scripts/preflight-codex-uat-prior-attempt.js"),
      "utf8",
    );
    assert.match(privateScript, /from "\.\.\/src\/builder-codex-uat-private-authority\.js"/u);
    const authorityModule = await readFile(
      path.join(REPO_ROOT, "src/builder-codex-uat-private-authority.js"),
      "utf8",
    );
    assert.match(authorityModule, /loadCodexUatAttemptJournal/u);
    assert.match(authorityModule, /diagnoseBuilderInstall/u);
  });

  it("publishes the exact Phase 4 security closure with no install authority or lifecycle hook", async () => {
    const packageJson = JSON.parse(await readFile(
      path.join(REPO_ROOT, "package.json"),
      "utf8",
    ));
    const releaseSources = BUILDER_RELEASE_ASSET_INVENTORY
      .map(({ sourcePath }) => sourcePath);
    for (const sourcePath of PHASE_4_PACKED_SECURITY_CLOSURE) {
      assert.equal(packageJson.files.includes(sourcePath), true, sourcePath);
      assert.equal(releaseSources.includes(sourcePath), true, sourcePath);
      assert.equal(BUILDER_NPM_TARBALL_INVENTORY.includes(sourcePath), true, sourcePath);
      if (sourcePath.endsWith(".js")) {
        assert.match(
          packageJson.scripts.check,
          new RegExp(`node --check ${sourcePath.replaceAll(".", "\\.")}(?: |$)`, "u"),
          sourcePath,
        );
      }
    }

    for (const hook of ["preinstall", "install", "postinstall", "prepare"]) {
      assert.equal(Object.hasOwn(packageJson.scripts, hook), false, hook);
    }
    for (const forbidden of [
      ".env",
      ".planning/",
      "openclaw-fs-kernel.receipt.json",
      "openclaw-authority-marker",
      "authority-state",
      "install-receipt.json",
      "post-state/",
      "official-action-results/",
      "finalizations/",
      "raw-transcript",
    ]) {
      assert.equal(
        packageJson.files.some((entry) => entry.includes(forbidden)),
        false,
        forbidden,
      );
      assert.equal(releaseSources.some((entry) => entry.includes(forbidden)), false, forbidden);
    }
    const nativeClosure = PHASE_4_PACKED_SECURITY_CLOSURE.filter((entry) => (
      entry.startsWith("native/")
    ));
    assert.deepEqual(
      packageJson.files.filter((entry) => entry.startsWith("native/")),
      nativeClosure,
    );
    assert.deepEqual(
      releaseSources.filter((entry) => entry.startsWith("native/")),
      nativeClosure,
    );
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
      "artifact-contract": "non-artifact",
      builder: "non-artifact",
      migrate: "artifact",
      "runtime-check": "non-artifact",
      validate: "non-artifact",
      report: "artifact",
      "discover-report": "artifact",
      "discover-pack": "artifact",
      "discover-live": "artifact",
      "discover-workspace": "artifact",
      "discovery-approve": "artifact",
      "need-report": "artifact",
      "decision-ledger": "artifact",
      "design-plan": "artifact",
      "blueprint-draft": "artifact",
      "build-contract": "artifact",
      "openclaw-target-describe": "artifact",
      "plan-approve": "artifact",
      "openclaw-target-admit": "artifact",
      "package-produce": "artifact",
      "package-inspect": "non-artifact",
      "openclaw-probe": "artifact",
      "openclaw-install-genesis": "artifact",
      "openclaw-install-preview": "artifact",
      "openclaw-install-approve": "artifact",
      "openclaw-install-apply": "artifact",
      "openclaw-fs-kernel-build": "artifact",
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
