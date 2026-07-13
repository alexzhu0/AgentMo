import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import {
  MIGRATION_INSTANCE_MARKER_BASENAME,
  MIGRATION_RECEIPT_BASENAME,
} from "../src/migration-filesystem.js";
const CLI = fileURLToPath(new URL("../bin/agentmo.js", import.meta.url));
const CLI_SOURCE = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const CLI_MODULE = new URL("../src/cli.js", import.meta.url).href;
const INCOMPATIBLE_RUNTIME_PRELOAD = fileURLToPath(
  new URL("./fixtures/incompatible-node-runtime.js", import.meta.url),
);
const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const BLUEPRINT = fileURLToPath(new URL("../examples/win9.agentmo.json", import.meta.url));
const DISCOVERY = fileURLToPath(new URL("../examples/win9.discovery.json", import.meta.url));
const DOMAIN_CASES = fileURLToPath(new URL("../examples/support-triage.domain-cases.json", import.meta.url));

const AGENTMO_BASELINE_FILES = [
  "README.md",
  "agent_policy.json",
  "agents/win9-main.md",
  "agents/win9-step1.md",
  "agents/win9-step2.md",
  "agents/win9-step3.md",
  "agents/win9-step4.md",
  "agents/win9-step5.md",
  "agents/win9-step6.md",
  "agents/win9-step7.md",
  "agents/win9-step8.md",
  "agents/win9-step9.md",
  "evals/CASES.md",
  "evals/RUBRIC.md",
  "governance/QUALITY_GATES.md",
  "history/EVIDENCE_INDEX.md",
  "history/VERSION_LEDGER.md",
];

const OPENCLAW_BASELINE_FILES = [
  ...AGENTMO_BASELINE_FILES,
  "openclaw/README.md",
  "openclaw/RUNBOOK.md",
  "openclaw/config/channel-bindings.examples.md",
  "openclaw/config/openclaw.agent.patch.json",
  "openclaw/runtime_contract.md",
  "openclaw/workspace/AGENTS.md",
  "openclaw/workspace/IDENTITY.md",
  "openclaw/workspace/SOUL.md",
  "openclaw/workspace/TOOLS.md",
  "openclaw/workspace/USER.md",
  "openclaw/workspace/memory/README.md",
  "openclaw/workspace/skills/win9/SKILL.md",
].sort();
const BUILD_STATE_FILENAME = "agentmo-build-state.json";

function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function runCliWithIncompatibleRuntime(args) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--import", INCOMPATIBLE_RUNTIME_PRELOAD, CLI, ...args],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function runCliShebangWithIncompatibleRuntime(args) {
  return new Promise((resolve) => {
    const child = spawn(CLI, args, {
      env: {
        ...process.env,
        NODE_OPTIONS: `--import=${pathToFileURL(INCOMPATIBLE_RUNTIME_PRELOAD).href}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function runCliApplicationContract(args) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `const { main } = await import(${JSON.stringify(CLI_MODULE)}); await main(JSON.parse(process.env.AGENTMO_TEST_CLI_ARGS));`,
      ],
      {
        env: { ...process.env, AGENTMO_TEST_CLI_ARGS: JSON.stringify(args) },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

const CLI_ERROR_KEYS = ["schemaVersion", "ok", "code", "category", "guidance"];

function assertJsonError(result, expectedCode, forbidden = []) {
  assert.equal(result.code, 1);
  assert.equal(result.stderr, "");
  const envelope = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(envelope), CLI_ERROR_KEYS);
  assert.equal(envelope.schemaVersion, "agentmo.cli-error.v1");
  assert.equal(envelope.ok, false);
  assert.equal(envelope.code, expectedCode);
  assert.match(envelope.category, /^(?:artifact-admission|migration|persistability|request|operation)$/u);
  assert.equal(typeof envelope.guidance, "string");
  assert.equal(envelope.guidance.length > 0, true);
  assert.equal(result.stdout.trim().split("\n").filter((line) => line.trim() === "{").length, 1);
  for (const value of forbidden) {
    assert.equal(result.stdout.includes(value), false);
    assert.equal(result.stderr.includes(value), false);
  }
  return envelope;
}

function assertHumanError(result, expectedCode, forbidden = []) {
  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^AgentMo CLI error\n/u);
  assert.match(result.stderr, new RegExp(`^Code: ${expectedCode}$`, "mu"));
  assert.match(result.stderr, /^Category: (?:artifact-admission|migration|persistability|request|operation)$/mu);
  assert.match(result.stderr, /^Guidance: .+$/mu);
  assert.equal(result.stderr.trim().split("\n").length, 4);
  for (const value of forbidden) {
    assert.equal(result.stdout.includes(value), false);
    assert.equal(result.stderr.includes(value), false);
  }
}

async function discoveryDigestBinding(file) {
  const bytes = await readFile(file);
  return `discovery-manifest=sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function blueprintDigestBinding(file) {
  const bytes = await readFile(file);
  return `blueprint=sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function artifactDigestBinding(subject, file) {
  const bytes = await readFile(file);
  return `${subject}=sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function migrationDigestArgs(files) {
  const args = [];
  for (const [index, file] of files.entries()) {
    const bytes = await readFile(file);
    args.push(
      "--digest",
      `migration-input-${index}=sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    );
  }
  return args;
}

async function listFiles(root, options = {}) {
  const results = [];
  async function visit(dir, prefix = "") {
    for (const entry of await readdir(dir)) {
      const absolute = path.join(dir, entry);
      const relative = prefix ? `${prefix}/${entry}` : entry;
      if ((await stat(absolute)).isDirectory()) await visit(absolute, relative);
      else if (!options.exclude?.has(relative)) results.push(relative);
    }
  }
  await visit(root);
  return results.sort();
}

async function assertPathAbsent(target) {
  await assert.rejects(() => stat(target), (error) => error?.code === "ENOENT");
}

function sourceSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

describe("cli", () => {
  it("prints help that exposes design-plan, domain, and delivery report commands", async () => {
    const help = await runCli(["help"]);
    assert.equal(help.code, 0, help.stderr);
    assert.match(help.stdout, /^AgentMo CLI\n/u);
    assert.doesNotMatch(help.stdout, /AgentMother|agentmother/u);
    assert.match(help.stdout, /agentmo design-plan <agentmo-discovery-db\.json> --need <need\.json>/u);
    assert.match(help.stdout, /agentmo discover-report <discovery\.json> --digest discovery-manifest=sha256:<64hex>/u);
    assert.match(help.stdout, /agentmo need-report <need\.json> --digest user-need=sha256:<64hex>/u);
    assert.match(help.stdout, /agentmo blueprint-draft <agentmo-discovery-db\.json> --need <need\.json> --digest discovery-db=sha256:<64hex> --digest user-need=sha256:<64hex> \[--design-plan/u);
    assert.match(help.stdout, /agentmo validate <blueprint\.json> --digest blueprint=sha256:<64hex>/u);
    assert.match(help.stdout, /agentmo report <blueprint\.json> --digest blueprint=sha256:<64hex>/u);
    assert.match(help.stdout, /agentmo plan <blueprint\.json> --digest blueprint=sha256:<64hex>/u);
    assert.match(help.stdout, /agentmo handoff <blueprint\.json> --digest blueprint=sha256:<64hex>/u);
    assert.match(help.stdout, /agentmo run-plan <blueprint\.json> --digest blueprint=sha256:<64hex>/u);
    assert.match(help.stdout, /agentmo run <runtime-plan\.json> --digest runtime-plan=sha256:<64hex>/u);
    assert.match(help.stdout, /agentmo run-report <run-state\.json> --digest run-state=sha256:<64hex>/u);
    assert.match(help.stdout, /agentmo replay-run <run-state\.json> --digest run-state=sha256:<64hex>/u);
    assert.match(help.stdout, /agentmo run-eval <run-state\.json> --digest run-state=sha256:<64hex>/u);
    assert.match(help.stdout, /agentmo observe-run <run-state\.json> --digest run-state=sha256:<64hex>/u);
    assert.match(help.stdout, /agentmo observe <observation\.json> --digest observation=sha256:<64hex>/u);
    assert.match(help.stdout, /agentmo birth-report <blueprint\.json> --digest blueprint=sha256:<64hex>/u);
    assert.match(help.stdout, /agentmo domain-eval <blueprint\.json> --digest blueprint=sha256:<64hex> --cases <cases\.json> --digest domain-cases=sha256:<64hex>/u);
    assert.match(help.stdout, /agentmo delivery-report <blueprint\.json> --digest blueprint=sha256:<64hex> --build-state <agentmo-build-state\.json>/u);
    assert.match(help.stdout, /agentmo runtime-check --target openclaw \[--json\]/u);
    assert.match(help.stdout, /design-plan\s+Produce a Stage 2 planning contract/u);
    assert.match(help.stdout, /domain-eval\s+Evaluate deterministic domain cases/u);
    assert.match(help.stdout, /delivery-report\s+Re-validate and aggregate delivery closure evidence/u);
    assert.match(help.stdout, /runtime-check\s+Inspect the current process against the OpenClaw target runtime contract/u);
    assert.match(help.stdout, /agentmo migrate <input-0\.json> \[input-N\.json \.\.\.\] --digest migration-input-0=sha256:<64hex>/u);
    assert.match(help.stdout, /migrate\s+Preview or explicitly apply a value-blind legacy artifact migration/u);
    assert.equal(help.stderr, "");
    for (const forbidden of [REPO_ROOT, "/Users/", "/home/", "C:\\\\", "sk-synthetic-help-canary123456"]) {
      assert.equal(help.stdout.includes(forbidden), false);
    }
  });

  it("prints the same bounded current-process runtime report in human and JSON modes", async () => {
    const jsonResult = await runCli(["runtime-check", "--target", "openclaw", "--json"]);
    assert.equal(jsonResult.code, 0, jsonResult.stderr);
    assert.equal(jsonResult.stderr, "");
    const report = JSON.parse(jsonResult.stdout);
    assert.deepEqual(Object.keys(report), [
      "component",
      "target",
      "observedVersion",
      "range",
      "supported",
      "evidenceClass",
    ]);
    assert.deepEqual(report, {
      component: "openclaw-target",
      target: "openclaw",
      observedVersion: process.versions.node,
      range: ">=22.19.0 <23 || >=23.11.0",
      supported: true,
      evidenceClass: "current-process",
    });

    const humanResult = await runCli(["runtime-check", "--target", "openclaw"]);
    assert.equal(humanResult.code, 0, humanResult.stderr);
    assert.equal(humanResult.stderr, "");
    assert.equal(humanResult.stdout, [
      "Component: openclaw-target",
      "Target: openclaw",
      `Observed version: ${process.versions.node}`,
      "Range: >=22.19.0 <23 || >=23.11.0",
      "Supported: true",
      "Evidence class: current-process",
      "",
    ].join("\n"));

    for (const output of [jsonResult.stdout, humanResult.stdout]) {
      for (const forbidden of [
        REPO_ROOT,
        "/Users/private-runtime-canary",
        "/home/private-runtime-canary",
        "PATH=private-runtime-canary",
        "sk-private-runtime-canary123456",
        "certified",
        "production-ready",
      ]) {
        assert.equal(output.includes(forbidden), false);
      }
    }
  });

  it("rejects alternate targets and every runtime override through one value-blind error", async () => {
    const cases = [
      ["runtime-check", "--json"],
      ["runtime-check", "--json", "--target", "private-target-canary"],
      ["runtime-check", "--target", "openclaw", "--version", "24.0.0", "--json"],
      ["runtime-check", "--target", "openclaw", "--node-version", "24.0.0", "--json"],
      ["runtime-check", "--target", "openclaw", "--provider", "private-provider-canary", "--json"],
      ["runtime-check", "--target", "openclaw", "--options", "private-options-canary", "--json"],
      ["runtime-check", "--target", "openclaw", "--bypass", "private-bypass-canary", "--json"],
      ["runtime-check", "--target", "openclaw", "private-positional-canary", "--json"],
    ];

    for (const args of cases) {
      assertJsonError(
        await runCli(args),
        "AGENTMO_CLI_RUNTIME_CHECK_REJECTED",
        [
          REPO_ROOT,
          "private-target-canary",
          "24.0.0",
          "private-provider-canary",
          "private-options-canary",
          "private-bypass-canary",
          "private-positional-canary",
        ],
      );
    }
  });

  it("rejects incompatible OpenClaw mutations at real launcher pre-intake through node and shebang entrypoints", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-cli-incompatible-runtime-"));
    const unreadableArtifact = path.join(root, "artifact-directory-canary");
    const unreadableMessage = path.join(root, "message-directory-canary");
    const unreadableEnv = path.join(root, "env-directory-canary");
    const messageFile = path.join(root, "message-canary.txt");
    const missingEnv = path.join(root, "missing-env-canary.txt");
    const missingBlueprint = path.join(root, "missing-blueprint-canary.json");
    const missingRuntimePlan = path.join(root, "missing-runtime-plan-canary.json");
    const missingRunState = path.join(root, "missing-run-state-canary.json");
    const workspace = path.join(root, "missing-workspace-canary");
    const canaryMessage = "contract-only-message-value-canary";
    const zeroDigest = `sha256:${"0".repeat(64)}`;

    await mkdir(unreadableArtifact);
    await mkdir(unreadableMessage);
    await mkdir(unreadableEnv);
    await writeFile(messageFile, canaryMessage, "utf8");

    const cases = [
      {
        label: "scaffold missing blueprint",
        json: false,
        out: path.join(root, "scaffold-missing-out"),
        args: [
          "scaffold", missingBlueprint,
          "--digest", `blueprint=${zeroDigest}`,
          "--target", "openclaw",
          "--out", path.join(root, "scaffold-missing-out"),
        ],
      },
      {
        label: "scaffold unreadable blueprint",
        json: false,
        out: path.join(root, "scaffold-unreadable-out"),
        args: [
          "scaffold", unreadableArtifact,
          "--digest", `blueprint=${zeroDigest}`,
          "--target", "openclaw",
          "--out", path.join(root, "scaffold-unreadable-out"),
        ],
      },
      {
        label: "live run missing runtime plan with value canaries",
        json: true,
        out: path.join(root, "run-missing-out"),
        args: [
          "run", missingRuntimePlan,
          "--digest", `runtime-plan=${zeroDigest}`,
          "--workspace", workspace,
          "--message-file", messageFile,
          "--runtime-env-file", missingEnv,
          "--out", path.join(root, "run-missing-out"),
          "--live", "--json",
        ],
      },
      {
        label: "live run unreadable transient files",
        json: true,
        out: path.join(root, "run-unreadable-out"),
        args: [
          "run", unreadableArtifact,
          "--digest", `runtime-plan=${zeroDigest}`,
          "--workspace", workspace,
          "--message-file", unreadableMessage,
          "--runtime-env-file", unreadableEnv,
          "--out", path.join(root, "run-unreadable-out"),
          "--live", "--json",
        ],
      },
      {
        label: "live replay missing run state with value canaries",
        json: true,
        entrypoint: "shebang",
        out: path.join(root, "replay-missing-out"),
        args: [
          "replay-run", missingRunState,
          "--digest", `run-state=${zeroDigest}`,
          "--workspace", workspace,
          "--message-file", messageFile,
          "--runtime-env-file", missingEnv,
          "--out", path.join(root, "replay-missing-out"),
          "--live", "--json",
        ],
      },
      {
        label: "live replay unreadable transient files",
        json: true,
        out: path.join(root, "replay-unreadable-out"),
        args: [
          "replay-run", unreadableArtifact,
          "--digest", `run-state=${zeroDigest}`,
          "--workspace", workspace,
          "--message-file", unreadableMessage,
          "--runtime-env-file", unreadableEnv,
          "--out", path.join(root, "replay-unreadable-out"),
          "--live", "--json",
        ],
      },
    ];

    const forbidden = [
      root,
      missingBlueprint,
      missingRuntimePlan,
      missingRunState,
      unreadableArtifact,
      unreadableMessage,
      unreadableEnv,
      messageFile,
      missingEnv,
      canaryMessage,
      "contract-only-env-value-canary",
    ];
    for (const entry of cases) {
      const result = entry.entrypoint === "shebang"
        ? await runCliShebangWithIncompatibleRuntime(entry.args)
        : await runCliWithIncompatibleRuntime(entry.args);
      if (entry.json) assertJsonError(result, "AGENTMO_OPENCLAW_RUNTIME_UNSUPPORTED", forbidden);
      else assertHumanError(result, "AGENTMO_OPENCLAW_RUNTIME_UNSUPPORTED", forbidden);
      await assertPathAbsent(entry.out);
    }
  });

  it("exposes runtime-env-file as the sole AgentMo application contract and rejects the removed alias", async () => {
    const help = await runCli(["help"]);
    assert.equal(help.code, 0, help.stderr);
    assert.match(help.stdout, /--runtime-env-file <path>/u);
    assert.doesNotMatch(help.stdout, /(?:^|\s)--env-file(?:\s|\]|<)/mu);

    const root = await mkdtemp(path.join(tmpdir(), "agentmo-cli-removed-env-alias-"));
    const legacyInput = path.join(root, "legacy-env-option-canary.txt");
    const missingRuntimePlan = path.join(root, "missing-runtime-plan.json");
    const out = path.join(root, "out");
    const zeroDigest = `sha256:${"0".repeat(64)}`;
    await writeFile(legacyInput, "LEGACY_OPTION_CANARY=synthetic-value\n", "utf8");

    const removedAlias = await runCliApplicationContract([
      "run", missingRuntimePlan,
      "--digest", `runtime-plan=${zeroDigest}`,
      "--workspace", root,
      "--message", "ping",
      "--env-file", legacyInput,
      "--out", out,
      "--live", "--json",
    ]);
    assertJsonError(removedAlias, "AGENTMO_CLI_REQUEST_REJECTED", [root, legacyInput]);
    await assertPathAbsent(out);
  });

  it("keeps syntax rejection and non-live/core admission behavior ahead of the target runtime gate", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-cli-incompatible-core-"));
    const missing = path.join(root, "missing-input-canary.json");
    const zeroDigest = `sha256:${"0".repeat(64)}`;

    const malformedRun = await runCliWithIncompatibleRuntime([
      "run", missing,
      "--digest", `runtime-plan=${zeroDigest}`,
      "--workspace", path.join(root, "workspace"),
      "--message", "contract-only-inline-canary",
      "--live", "--json",
    ]);
    assertJsonError(malformedRun, "AGENTMO_CLI_REQUEST_REJECTED", [root, missing, "contract-only-inline-canary"]);

    const admissionCases = [
      ["run", missing, "--digest", `runtime-plan=${zeroDigest}`, "--workspace", path.join(root, "workspace"), "--message", "ping", "--out", path.join(root, "run-out"), "--json"],
      ["replay-run", missing, "--digest", `run-state=${zeroDigest}`, "--out", path.join(root, "replay-out"), "--json"],
      ["run-plan", missing, "--digest", `blueprint=${zeroDigest}`, "--workspace", path.join(root, "workspace"), "--message", "ping", "--json"],
      ["run-report", missing, "--digest", `run-state=${zeroDigest}`, "--json"],
      ["run-eval", missing, "--digest", `run-state=${zeroDigest}`, "--json"],
      ["observe-run", missing, "--digest", `run-state=${zeroDigest}`, "--out", path.join(root, "observation.json"), "--json"],
    ];
    for (const args of admissionCases) {
      const result = await runCliWithIncompatibleRuntime(args);
      assertJsonError(result, "AGENTMO_ARTIFACT_READ_FAILED", [root, missing]);
    }

    const agentmoScaffold = await runCliWithIncompatibleRuntime([
      "scaffold", missing,
      "--digest", `blueprint=${zeroDigest}`,
      "--target", "agentmo",
      "--out", path.join(root, "agentmo-scaffold-out"),
    ]);
    assertHumanError(agentmoScaffold, "AGENTMO_ARTIFACT_READ_FAILED", [root, missing]);
    await assertPathAbsent(path.join(root, "agentmo-scaffold-out"));
  });

  it("keeps mutating CLI parsers syntax-only and gates dispatch before every materializer or loader", async () => {
    const source = await readFile(CLI_SOURCE, "utf8");
    const scaffoldDispatch = sourceSection(source, 'if (command === "scaffold")', 'if (command === "observe")');
    const runDispatch = sourceSection(source, 'if (command === "run")', 'if (command === "run-report")');
    const replayDispatch = sourceSection(source, 'if (command === "replay-run")', 'if (command === "run-eval")');
    const runParser = sourceSection(source, "function parseRunSyntaxArgs", "async function materializeRunOptions");
    const replayParser = sourceSection(source, "function parseReplayRunSyntaxArgs", "async function materializeReplayRunOptions");

    for (const parser of [runParser, replayParser]) {
      assert.doesNotMatch(parser, /\breadFile\b|Buffer\.from|\bresolve\(|materializeTransient/u);
    }
    assert.ok(scaffoldDispatch.indexOf("assertCurrentOpenClawTargetRuntime()") < scaffoldDispatch.indexOf("loadAdmittedBlueprint"));
    assert.ok(runDispatch.indexOf("assertCurrentOpenClawTargetRuntime()") < runDispatch.indexOf("materializeRunOptions"));
    assert.ok(runDispatch.indexOf("assertCurrentOpenClawTargetRuntime()") < runDispatch.indexOf("loadAdmittedArtifact"));
    assert.ok(replayDispatch.indexOf("assertCurrentOpenClawTargetRuntime()") < replayDispatch.indexOf("materializeReplayRunOptions"));
    assert.ok(replayDispatch.indexOf("assertCurrentOpenClawTargetRuntime()") < replayDispatch.indexOf("loadRunState"));
  });

  it("requires one exact ordinal digest binding per migration input", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-cli-migration-bindings-"));
    const first = path.join(root, "first.json");
    const second = path.join(root, "second.json");
    await writeFile(first, await readFile(new URL("./fixtures/migration/legacy-blueprint.json", import.meta.url)));
    await writeFile(second, await readFile(new URL("./fixtures/migration/legacy-report.json", import.meta.url)));
    const exact = await migrationDigestArgs([first, second]);

    const missing = await runCli(["migrate", first, second, ...exact.slice(0, 2), "--json"]);
    assert.equal(missing.code, 1);
    assert.equal(JSON.parse(missing.stdout).code, "AGENTMO_ARTIFACT_DIGEST_REQUIRED");

    const extra = await runCli([
      "migrate",
      first,
      ...exact.slice(0, 2),
      "--digest",
      exact[3],
      "--json",
    ]);
    assert.equal(extra.code, 1);
    assert.equal(JSON.parse(extra.stdout).code, "AGENTMO_ARTIFACT_DIGEST_UNKNOWN_SUBJECT");

    const duplicate = await runCli([
      "migrate",
      first,
      ...exact.slice(0, 2),
      ...exact.slice(0, 2),
      "--json",
    ]);
    assert.equal(duplicate.code, 1);
    assert.equal(JSON.parse(duplicate.stdout).code, "AGENTMO_ARTIFACT_DIGEST_DUPLICATE");

    const swapped = await runCli([
      "migrate",
      first,
      second,
      "--digest",
      `migration-input-0=${exact[3].slice(exact[3].indexOf("=") + 1)}`,
      "--digest",
      `migration-input-1=${exact[1].slice(exact[1].indexOf("=") + 1)}`,
      "--json",
    ]);
    assert.equal(swapped.code, 1);
    assert.equal(JSON.parse(swapped.stdout).code, "AGENTMO_ARTIFACT_DIGEST_MISMATCH");
    assert.deepEqual((await readdir(root)).sort(), ["first.json", "second.json"]);
  });

  it("previews migration deterministically in JSON and human formats without writing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-cli-migration-preview-"));
    const blueprintInput = path.join(root, "source-one.json");
    const reportInput = path.join(root, "source-two.json");
    await writeFile(blueprintInput, await readFile(new URL("./fixtures/migration/legacy-blueprint.json", import.meta.url)));
    await writeFile(reportInput, await readFile(new URL("./fixtures/migration/legacy-report.json", import.meta.url)));
    const before = (await readdir(root)).sort();
    const digestArgs = await migrationDigestArgs([blueprintInput, reportInput]);

    const first = await runCli(["migrate", blueprintInput, reportInput, ...digestArgs, "--json"]);
    const second = await runCli(["migrate", blueprintInput, reportInput, ...digestArgs, "--json"]);
    assert.equal(first.code, 0, first.stderr);
    assert.equal(first.stdout, second.stdout);
    const plan = JSON.parse(first.stdout);
    assert.equal(plan.mode, "preview");
    assert.equal(plan.applicable, true);
    assert.deepEqual(plan.items.map((item) => item.result), ["ready", "ready"]);

    const human = await runCli(["migrate", blueprintInput, reportInput, ...digestArgs]);
    assert.equal(human.code, 0, human.stderr);
    assert.match(human.stdout, /^AgentMo migration preview\n/u);
    assert.match(human.stdout, /Mutation: none \(preview only\)/u);
    for (const output of [first.stdout, first.stderr, human.stdout, human.stderr]) {
      assert.equal(output.includes(root), false);
      assert.equal(output.includes(path.basename(blueprintInput)), false);
      assert.equal(output.includes(path.basename(reportInput)), false);
    }
    assert.deepEqual((await readdir(root)).sort(), before);
  });

  it("returns a value-blind non-applicable preview for a mixed hostile batch", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-cli-migration-hostile-"));
    const valid = path.join(root, "source-one.json");
    const hostile = path.join(root, "source-private-name.json");
    await writeFile(valid, await readFile(new URL("./fixtures/migration/legacy-blueprint.json", import.meta.url)));
    await writeFile(hostile, await readFile(new URL("./fixtures/migration/hostile-secret.json", import.meta.url)));
    const before = (await readdir(root)).sort();
    const digestArgs = await migrationDigestArgs([valid, hostile]);

    const result = await runCli(["migrate", valid, hostile, ...digestArgs, "--json"]);
    assert.equal(result.code, 1);
    assert.equal(result.stderr, "");
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.applicable, false);
    assert.deepEqual(plan.items.map((item) => item.result), ["ready", "rejected"]);
    for (const forbidden of [root, path.basename(valid), path.basename(hostile), "fixture-only-sensitive-material"]) {
      assert.equal(result.stdout.includes(forbidden), false);
      assert.equal(result.stderr.includes(forbidden), false);
    }
    assert.deepEqual((await readdir(root)).sort(), before);
  });

  it("returns a value-blind JSON artifact error for an optional legacy status build-state", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-cli-migration-required-"));
    const legacyBuildState = path.join(root, "source-state.json");
    await writeFile(legacyBuildState, await readFile(new URL("./fixtures/migration/legacy-build-state.json", import.meta.url)));

    const result = await runCli([
      "status",
      BLUEPRINT,
      "--build-state",
      legacyBuildState,
      "--digest",
      await blueprintDigestBinding(BLUEPRINT),
      "--digest",
      `build-state=sha256:${createHash("sha256").update(await readFile(legacyBuildState)).digest("hex")}`,
      "--json",
    ]);
    assert.equal(result.code, 1);
    assert.equal(result.stderr, "");
    const error = assertJsonError(result, "AGENTMO_MIGRATION_REQUIRED", [root, path.basename(legacyBuildState)]);
    assert.equal(error.category, "migration");
    for (const forbidden of [root, path.basename(legacyBuildState)]) {
      assert.equal(result.stdout.includes(forbidden), false);
      assert.equal(result.stderr.includes(forbidden), false);
    }
  });

  it("returns the same exact JSON artifact error contract for legacy blueprint validation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-cli-legacy-validate-"));
    const legacyBlueprint = path.join(root, "legacy-private-blueprint.json");
    await writeFile(legacyBlueprint, await readFile(new URL("./fixtures/migration/legacy-blueprint.json", import.meta.url)));

    const result = await runCli([
      "validate",
      legacyBlueprint,
      "--digest",
      await blueprintDigestBinding(legacyBlueprint),
      "--json",
    ]);
    assert.equal(result.code, 1);
    assert.equal(result.stderr, "");
    const error = assertJsonError(result, "AGENTMO_MIGRATION_REQUIRED", [root, path.basename(legacyBlueprint)]);
    assert.equal(error.category, "migration");
    for (const forbidden of [root, path.basename(legacyBlueprint)]) {
      assert.equal(result.stdout.includes(forbidden), false);
      assert.equal(result.stderr.includes(forbidden), false);
    }
  });

  it("uses one fixed value-blind envelope for human and JSON rejections", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-cli-error-modes-"));
    const legacyBlueprint = path.join(root, "private-legacy-blueprint.json");
    const invalidJson = path.join(root, "private-invalid-blueprint.json");
    await writeFile(legacyBlueprint, await readFile(new URL("./fixtures/migration/legacy-blueprint.json", import.meta.url)));
    await writeFile(invalidJson, "{ invalid private material", "utf8");
    const cases = [
      {
        args: ["validate", legacyBlueprint, "--digest", await blueprintDigestBinding(legacyBlueprint)],
        code: "AGENTMO_MIGRATION_REQUIRED",
      },
      {
        args: ["validate", BLUEPRINT, "--digest", `blueprint=sha256:${"0".repeat(64)}`],
        code: "AGENTMO_ARTIFACT_DIGEST_MISMATCH",
      },
      {
        args: ["validate", invalidJson, "--digest", await blueprintDigestBinding(invalidJson)],
        code: "AGENTMO_ARTIFACT_INVALID_JSON",
      },
      {
        args: ["plan", BLUEPRINT, "--target", "private-target-canary"],
        code: "AGENTMO_CLI_REQUEST_REJECTED",
      },
    ];

    for (const testCase of cases) {
      const forbidden = [root, path.basename(legacyBlueprint), path.basename(invalidJson), "private material", "private-target-canary"];
      const human = await runCli(testCase.args);
      assertHumanError(human, testCase.code, forbidden);
      const json = await runCli([...testCase.args, "--json"]);
      assertJsonError(json, testCase.code, forbidden);
    }
  });

  it("does not treat an opaque --message value as the JSON error-mode flag", async () => {
    const result = await runCli([
      "run-plan",
      BLUEPRINT,
      "--digest",
      await blueprintDigestBinding(BLUEPRINT),
      "--target",
      "private-target-canary",
      "--workspace",
      "/tmp/private-workspace-canary",
      "--message",
      "--json",
    ]);
    assertHumanError(result, "AGENTMO_CLI_REQUEST_REJECTED", ["private-target-canary", "/tmp/private-workspace-canary"]);
  });

  it("explicitly applies migration to a new dedicated output in JSON and human modes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-cli-migration-apply-"));
    const sourceDirectory = path.join(root, "source");
    const firstParent = path.join(root, "first");
    const secondParent = path.join(root, "second");
    await Promise.all([
      mkdir(sourceDirectory, { mode: 0o700 }),
      mkdir(firstParent, { mode: 0o700 }),
      mkdir(secondParent, { mode: 0o700 }),
    ]);
    const input = path.join(sourceDirectory, "source.json");
    await writeFile(input, await readFile(new URL("./fixtures/migration/legacy-blueprint.json", import.meta.url)));
    const beforeSource = await readFile(input);
    const firstOut = path.join(firstParent, "out");
    const secondOut = path.join(secondParent, "out");
    const digestArgs = await migrationDigestArgs([input]);

    const jsonResult = await runCli(["migrate", input, ...digestArgs, "--out", firstOut, "--json"]);
    assert.equal(jsonResult.code, 0, jsonResult.stderr);
    assert.equal(jsonResult.stderr, "");
    const applied = JSON.parse(jsonResult.stdout);
    assert.deepEqual(Object.keys(applied), [
      "schemaVersion",
      "ok",
      "status",
      "plan_digest",
      "verification",
    ]);
    assert.equal(applied.schemaVersion, "agentmo.migration-apply-result.v1");
    assert.equal(applied.ok, true);
    assert.equal(applied.status, "committed");
    assert.equal(applied.verification, "passed");

    const humanResult = await runCli(["migrate", input, ...digestArgs, "--out", secondOut]);
    assert.equal(humanResult.code, 0, humanResult.stderr);
    assert.match(humanResult.stdout, /^AgentMo migration apply\n/u);
    assert.match(humanResult.stdout, /Status: committed/u);
    assert.match(humanResult.stdout, /Verification: passed/u);
    for (const output of [
      jsonResult.stdout,
      jsonResult.stderr,
      humanResult.stdout,
      humanResult.stderr,
    ]) {
      assert.equal(output.includes(root), false);
      assert.equal(output.includes(path.basename(input)), false);
    }
    assert.deepEqual(await readFile(input), beforeSource);

    const deterministicNames = [
      "blueprint.agentmo.json",
      MIGRATION_RECEIPT_BASENAME,
    ];
    for (const basename of deterministicNames) {
      assert.deepEqual(
        await readFile(path.join(firstOut, basename)),
        await readFile(path.join(secondOut, basename)),
      );
    }
    assert.notDeepEqual(
      await readFile(path.join(firstOut, MIGRATION_INSTANCE_MARKER_BASENAME)),
      await readFile(path.join(secondOut, MIGRATION_INSTANCE_MARKER_BASENAME)),
    );
  });

  it("apply rejects existing output and hostile batches with stable value-blind codes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-cli-migration-apply-errors-"));
    const sourceDirectory = path.join(root, "source");
    const outputParent = path.join(root, "output");
    await mkdir(sourceDirectory, { mode: 0o700 });
    await mkdir(outputParent, { mode: 0o700 });
    const valid = path.join(sourceDirectory, "private-valid-name.json");
    const hostile = path.join(sourceDirectory, "private-hostile-name.json");
    await writeFile(valid, await readFile(new URL("./fixtures/migration/legacy-blueprint.json", import.meta.url)));
    await writeFile(hostile, await readFile(new URL("./fixtures/migration/hostile-secret.json", import.meta.url)));

    const existing = path.join(outputParent, "existing");
    await mkdir(existing, { mode: 0o700 });
    const validDigestArgs = await migrationDigestArgs([valid]);
    const existingResult = await runCli(["migrate", valid, ...validDigestArgs, "--out", existing, "--json"]);
    assert.equal(existingResult.code, 1);
    assert.equal(existingResult.stderr, "");
    const existingError = JSON.parse(existingResult.stdout);
    assert.equal(existingError.ok, false);
    assert.equal(existingError.code, "AGENTMO_MIGRATION_OUTPUT_EXISTS");

    const rejectedOut = path.join(outputParent, "rejected");
    const rejectedDigestArgs = await migrationDigestArgs([valid, hostile]);
    const rejectedResult = await runCli([
      "migrate",
      valid,
      hostile,
      ...rejectedDigestArgs,
      "--out",
      rejectedOut,
      "--json",
    ]);
    assert.equal(rejectedResult.code, 1);
    assert.equal(rejectedResult.stderr, "");
    const rejectedError = JSON.parse(rejectedResult.stdout);
    assert.equal(rejectedError.ok, false);
    assert.equal(rejectedError.code, "AGENTMO_MIGRATION_BATCH_REJECTED");
    assert.equal((await readdir(outputParent)).includes("rejected"), false);

    for (const output of [
      existingResult.stdout,
      existingResult.stderr,
      rejectedResult.stdout,
      rejectedResult.stderr,
    ]) {
      for (const forbidden of [
        root,
        path.basename(valid),
        path.basename(hostile),
        "fixture-only-sensitive-material",
      ]) {
        assert.equal(output.includes(forbidden), false);
      }
    }
  });

  it("validates and reports the reference blueprint", async () => {
    const validate = await runCli(["validate", BLUEPRINT, "--digest", await blueprintDigestBinding(BLUEPRINT)]);
    assert.equal(validate.code, 0, validate.stderr);
    assert.match(validate.stdout, /PASS blueprint validation/u);
    assert.equal(validate.stdout.includes(BLUEPRINT), false);
    assert.equal(validate.stdout.includes(REPO_ROOT), false);

    const blueprintBinding = await blueprintDigestBinding(BLUEPRINT);
    const discoveryBinding = await discoveryDigestBinding(DISCOVERY);
    const reportWithoutDiscovery = await runCli([
      "report",
      BLUEPRINT,
      "--digest",
      blueprintBinding,
      "--json",
    ]);
    assert.equal(reportWithoutDiscovery.code, 0, reportWithoutDiscovery.stderr);
    assert.equal(JSON.parse(reportWithoutDiscovery.stdout).discovery.supplied, false);

    const missingDiscoveryDigest = await runCli([
      "report",
      BLUEPRINT,
      "--digest",
      blueprintBinding,
      "--discovery-manifest",
      DISCOVERY,
      "--json",
    ]);
    assert.equal(missingDiscoveryDigest.code, 1);
    assert.equal(JSON.parse(missingDiscoveryDigest.stdout).code, "AGENTMO_ARTIFACT_DIGEST_REQUIRED");

    const report = await runCli([
      "report",
      BLUEPRINT,
      "--digest",
      blueprintBinding,
      "--discovery-manifest",
      DISCOVERY,
      "--digest",
      discoveryBinding,
      "--json",
    ]);
    assert.equal(report.code, 0, report.stderr);
    const json = JSON.parse(report.stdout);
    assert.equal(json.kind, "agentmo_report");
    assert.equal(json.ok, true);
    assert.equal(json.produceMaturity.stage, "certify");
    assert.equal("lifecycle" in json, false);
    assert.equal(json.discovery.supplied, true);
    assert.equal(json.discovery.sourceCount, 3);
    assert.equal(json.runtimeCertification.find((profile) => profile.id === "openclaw").evidenceDisclosure, "evidence_disclosed");
  });

  it("fails closed for every exact blueprint binding-map boundary", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-cli-blueprint-bindings-"));
    const out = path.join(root, "must-not-exist");
    const binding = await blueprintDigestBinding(BLUEPRINT);
    const cases = [
      {
        args: ["validate", BLUEPRINT, "--json"],
        code: "AGENTMO_ARTIFACT_DIGEST_REQUIRED",
      },
      {
        args: ["report", BLUEPRINT, "--digest", binding, "--digest", binding, "--json"],
        code: "AGENTMO_ARTIFACT_DIGEST_DUPLICATE",
      },
      {
        args: [
          "report",
          BLUEPRINT,
          "--digest",
          binding,
          "--digest",
          await discoveryDigestBinding(DISCOVERY),
          "--json",
        ],
        code: "AGENTMO_ARTIFACT_DIGEST_UNKNOWN_SUBJECT",
      },
      {
        args: [
          "plan",
          BLUEPRINT,
          "--digest",
          binding,
          "--digest",
          `private-subject-canary=sha256:${"a".repeat(64)}`,
          "--json",
        ],
        code: "AGENTMO_ARTIFACT_DIGEST_UNKNOWN_SUBJECT",
      },
      {
        args: [
          "handoff",
          BLUEPRINT,
          "--digest",
          `blueprint=sha256:${"0".repeat(64)}`,
          "--target",
          "openclaw",
          "--out",
          out,
          "--json",
        ],
        code: "AGENTMO_ARTIFACT_DIGEST_MISMATCH",
      },
    ];

    for (const testCase of cases) {
      const result = await runCli(testCase.args);
      assert.equal(result.code, 1);
      assert.equal(result.stderr, "");
      assert.equal(JSON.parse(result.stdout).code, testCase.code);
      for (const forbidden of [root, "private-subject-canary"]) {
        assert.equal(result.stdout.includes(forbidden), false);
        assert.equal(result.stderr.includes(forbidden), false);
      }
    }
    await assert.rejects(() => stat(out), { code: "ENOENT" });
  });

  it("fails closed for report-family slot bindings before any builder runs", async () => {
    const blueprintBinding = await blueprintDigestBinding(BLUEPRINT);
    const rawBlueprintDigest = blueprintBinding.slice("blueprint=".length);
    const deliveryPaths = [
      "--build-state", BLUEPRINT,
      "--run-state", BLUEPRINT,
      "--run-eval", BLUEPRINT,
      "--birth-report", BLUEPRINT,
    ];
    const deliveryBindings = [
      "--digest", blueprintBinding,
      "--digest", `build-state=${rawBlueprintDigest}`,
      "--digest", `run-state=${rawBlueprintDigest}`,
      "--digest", `run-eval=${rawBlueprintDigest}`,
      "--digest", `birth-report=${rawBlueprintDigest}`,
    ];
    const cases = [
      {
        args: [
          "birth-report",
          BLUEPRINT,
          "--build-state", BLUEPRINT,
          "--run-state", BLUEPRINT,
          "--run-eval", BLUEPRINT,
          "--expect-status", "declared",
          "--json",
        ],
        code: "AGENTMO_ARTIFACT_DIGEST_REQUIRED",
      },
      {
        args: [
          "birth-report",
          BLUEPRINT,
          "--build-state", BLUEPRINT,
          "--run-state", BLUEPRINT,
          "--run-eval", BLUEPRINT,
          "--expect-status", "declared",
          "--digest", blueprintBinding,
          "--digest", `build-state=${rawBlueprintDigest}`,
          "--digest", `run-state=${rawBlueprintDigest}`,
          "--digest", `run-eval=${rawBlueprintDigest}`,
          "--json",
        ],
        code: "AGENTMO_UNSUPPORTED_ARTIFACT",
      },
      {
        args: [
          "domain-eval",
          BLUEPRINT,
          "--cases", DOMAIN_CASES,
          "--digest", blueprintBinding,
          "--digest", `domain-cases=sha256:${"0".repeat(64)}`,
          "--json",
        ],
        code: "AGENTMO_ARTIFACT_DIGEST_MISMATCH",
      },
      {
        args: [
          "delivery-report",
          BLUEPRINT,
          ...deliveryPaths,
          "--domain-eval", BLUEPRINT,
          ...deliveryBindings,
          "--json",
        ],
        code: "AGENTMO_ARTIFACT_DIGEST_REQUIRED",
      },
      {
        args: [
          "delivery-report",
          BLUEPRINT,
          ...deliveryPaths,
          ...deliveryBindings,
          "--digest", `domain-eval=${rawBlueprintDigest}`,
          "--json",
        ],
        code: "AGENTMO_ARTIFACT_DIGEST_UNKNOWN_SUBJECT",
      },
    ];

    for (const testCase of cases) {
      const result = await runCli(testCase.args);
      assert.equal(result.code, 1);
      assert.equal(result.stderr, "");
      assert.equal(JSON.parse(result.stdout).code, testCase.code);
    }
  });

  it("prints discovery report JSON for the reference manifest", async () => {
    const result = await runCli([
      "discover-report",
      DISCOVERY,
      "--digest",
      await discoveryDigestBinding(DISCOVERY),
      "--json",
    ]);
    assert.equal(result.code, 0, result.stderr);
    const json = JSON.parse(result.stdout);
    assert.equal(json.kind, "agentmo_discovery_report");
    assert.equal(json.ok, true);
    assert.equal(json.summary.agent_id, "win9");
    assert.equal(json.summary.source_count, 3);
  });

  it("scrubs denied discover-pack source locations from stdout and artifacts while preserving ordinary URLs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-cli-denied-discovery-location-"));
    const manifestPath = path.join(root, "denied-location.discovery.json");
    const out = path.join(root, "out");
    const deniedLocations = [".env", ".env.local", "private.key", "credentials.json"];
    const manifest = {
      schemaVersion: "agentmo.discovery.v1",
      agent_id: "support-triage",
      source_inventory: [
        ...deniedLocations.map((location, index) => ({
          id: `denied-location-${index + 1}`,
          type: "document",
          trust_level: "verified",
          description: `Denied location CLI fixture ${index + 1}`,
          location,
          extraction_fields: [`Denied location CLI field ${index + 1}`],
        })),
        {
          id: "ordinary-url-doc",
          type: "document",
          trust_level: "verified",
          description: "Ordinary URL documentation path",
          location: "https://example.com/docs/policy",
          extraction_fields: ["Ordinary URL field"],
        },
      ],
      database_outputs: ["safe discovery database"],
      retrieval_outputs: ["safe retrieval facts"],
      user_need_inputs: ["triage incoming support tickets by category and priority"],
      refresh_policy: {
        cadence: "before every fixture update",
        owner: "test engineer",
        stale_after: "30 days",
      },
      forbidden_data_handling: ["Do not store credentials, raw transcripts, or raw tool bodies in managed evidence."],
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const result = await runCli([
      "discover-pack",
      manifestPath,
      "--digest",
      await discoveryDigestBinding(manifestPath),
      "--out",
      out,
      "--json",
    ]);

    assert.equal(result.code, 1, result.stderr);
    const json = JSON.parse(result.stdout);
    assert.equal(json.ok, false);
    assert.equal(json.checks.find((check) => check.id === "durable_source_location_policy")?.pass, false);
    assert.equal(json.discoveryDb.safety.deniedSourceLocationCount, deniedLocations.length);
    assert.equal(json.discoveryDb.sources.find((source) => source.id === "ordinary-url-doc").location, "https://example.com/docs/policy");
    assert.deepEqual(json.discoveryDb.facts.find((fact) => fact.sourceId === "ordinary-url-doc").refs, [
      "https://example.com/docs/policy",
    ]);
    for (const sourceId of ["denied-location-1", "denied-location-2", "denied-location-3", "denied-location-4"]) {
      assert.equal(json.discoveryDb.sources.find((source) => source.id === sourceId).location, null);
      assert.deepEqual(json.discoveryDb.facts.find((fact) => fact.sourceId === sourceId).refs, []);
    }
    assert.deepEqual(await listFiles(out), ["agentmo-discovery-db.json", "coverage.json", "facts.jsonl"]);

    const discoveryDbText = await readFile(path.join(out, "agentmo-discovery-db.json"), "utf8");
    const factsText = await readFile(path.join(out, "facts.jsonl"), "utf8");
    const coverageText = await readFile(path.join(out, "coverage.json"), "utf8");
    for (const [label, text] of [
      ["discover-pack stdout", result.stdout],
      ["discover-pack stderr", result.stderr],
      ["discover-pack discovery DB", discoveryDbText],
      ["discover-pack facts JSONL", factsText],
      ["discover-pack coverage JSON", coverageText],
    ]) {
      for (const deniedLocation of deniedLocations) {
        assert.equal(text.includes(deniedLocation), false, `${label} must not contain denied location ${deniedLocation}`);
      }
    }
  });

  it("scrubs absolute paths from fatal missing and invalid discovery manifest errors", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-cli-fatal-manifest-"));
    const missingManifest = path.join(root, "missing.discovery.json");
    const invalidManifest = path.join(root, "invalid.discovery.json");
    const out = path.join(root, "out");
    await writeFile(invalidManifest, "{ not valid json", "utf8");

    const missing = await runCli([
      "discover-workspace",
      missingManifest,
      "--digest",
      `discovery-manifest=sha256:${"0".repeat(64)}`,
      "--source-root",
      ".",
      "--out",
      out,
      "--json",
    ]);
    assert.equal(missing.code, 1);
    assert.equal(JSON.parse(missing.stdout).code, "AGENTMO_ARTIFACT_READ_FAILED");
    assert.equal(missing.stderr, "");
    assert.equal(missing.stdout.includes(missingManifest), false);
    assert.equal(missing.stdout.includes(root), false);
    assert.equal(missing.stdout.includes(REPO_ROOT), false);
    assert.equal(missing.stderr.includes(missingManifest), false);
    assert.equal(missing.stderr.includes(root), false);
    assert.equal(missing.stderr.includes(REPO_ROOT), false);

    const invalid = await runCli([
      "discover-workspace",
      invalidManifest,
      "--digest",
      await discoveryDigestBinding(invalidManifest),
      "--source-root",
      ".",
      "--out",
      out,
      "--json",
    ]);
    assert.equal(invalid.code, 1);
    assert.equal(JSON.parse(invalid.stdout).code, "AGENTMO_ARTIFACT_INVALID_JSON");
    assert.equal(invalid.stderr, "");
    assert.equal(invalid.stdout.includes(invalidManifest), false);
    assert.equal(invalid.stdout.includes(root), false);
    assert.equal(invalid.stdout.includes(REPO_ROOT), false);
    assert.equal(invalid.stderr.includes(invalidManifest), false);
    assert.equal(invalid.stderr.includes(root), false);
    assert.equal(invalid.stderr.includes(REPO_ROOT), false);

    const etcManifest = "/etc/agentmo-missing-manifest-should-redact.discovery.json";
    const etcMissing = await runCli([
      "discover-pack",
      etcManifest,
      "--digest",
      `discovery-manifest=sha256:${"0".repeat(64)}`,
      "--out",
      out,
      "--json",
    ]);
    assert.equal(etcMissing.code, 1);
    assert.equal(JSON.parse(etcMissing.stdout).code, "AGENTMO_ARTIFACT_READ_FAILED");
    assert.equal(etcMissing.stderr, "");
    assert.equal(etcMissing.stdout.includes(etcManifest), false);
    assert.equal(etcMissing.stderr.includes(etcManifest), false);
  });

  it("prints deterministic plan JSON and writes no files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agentmo-cli-plan-"));
    const result = await runCli([
      "plan",
      BLUEPRINT,
      "--digest",
      await blueprintDigestBinding(BLUEPRINT),
      "--target",
      "openclaw",
      "--json",
    ]);
    assert.equal(result.code, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.selectedTargetId, "openclaw");
    assert.equal(plan.selectedProfileId, "openclaw");
    assert.deepEqual(plan.selectedModuleIds, ["default"]);
    assert.deepEqual(
      plan.operations.map((operation) => operation.relativePath),
      OPENCLAW_BASELINE_FILES,
    );
    assert.deepEqual(await readdir(dir), []);
  });

  it("prints OpenClaw runtime plan JSON and writes no files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agentmo-cli-runtime-plan-"));
    const message = "Say exactly: ok";
    const result = await runCli([
      "run-plan",
      BLUEPRINT,
      "--digest",
      await blueprintDigestBinding(BLUEPRINT),
      "--target",
      "openclaw",
      "--workspace",
      dir,
      "--agent",
      "win9",
      "--message",
      message,
      "--provider",
      "openai",
      "--model",
      "gpt-5.5",
      "--thinking",
      "off",
      "--channel",
      "local-cli",
      "--transport",
      "local",
      "--fallback-from",
      "pi",
      "--json",
    ]);
    assert.equal(result.code, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.schemaVersion, "agentmo.runtime-plan.v1");
    assert.equal(plan.target.id, "openclaw");
    assert.equal(plan.source.subject, "blueprint");
    assert.equal(plan.executionSessionPolicy, "fresh-per-run");
    assert.equal(plan.runtimeIdentity.selector.executionSelector.sessionKey, "<fresh-run-session-key>");
    assert.equal(plan.runtimeIdentity.sandboxScope.usesProductionState, false);
    assert.equal(plan.runtimeIdentity.provider, "openai");
    assert.equal(plan.runtimeIdentity.model, "gpt-5.5");
    assert.equal(plan.runtimeIdentity.thinking, "off");
    assert.equal(plan.runtimeIdentity.channel, "local-cli");
    assert.equal(plan.runtimeIdentity.transport, "local");
    assert.equal(plan.runtimeIdentity.fallbackFrom, "pi");
    assert.equal(plan.runtimeIdentity.workspace.kind, "TransientPathRef");
    assert.equal(plan.message.sourceDigest.startsWith("sha256:"), true);
    assert.equal(plan.message.byteLength, Buffer.byteLength(message));
    assert.equal(plan.command.args.includes("<transient-message>"), true);
    assert.equal(result.stdout.includes(message), false);
    assert.equal(result.stdout.includes(dir), false);
    assert.deepEqual(await readdir(dir), []);
  });

  it("prints runtime-env-file metadata without leaking env values", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agentmo-cli-runtime-env-"));
    const envFile = path.join(dir, ".env");
    await writeFile(envFile, "DEEPSEEK_API_KEY=cli-secret-value\nDEEPSEEK_BASE_URL=https://api.deepseek.com\n", "utf8");
    const result = await runCli([
      "run-plan",
      BLUEPRINT,
      "--digest",
      await blueprintDigestBinding(BLUEPRINT),
      "--target",
      "openclaw",
      "--workspace",
      dir,
      "--agent",
      "win9",
      "--message",
      "Secret is cli-secret-value",
      "--provider",
      "deepseek",
      "--model",
      "deepseek/deepseek-v4-flash",
      "--channel",
      "local-cli",
      "--transport",
      "local",
      "--runtime-env-file",
      envFile,
      "--json",
    ]);
    assert.equal(result.code, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.runtimeIdentity.runtimeEnv.kind, "SecretPresence");
    assert.equal(plan.runtimeIdentity.runtimeEnv.valuesPersisted, false);
    assert.deepEqual(plan.runtimeIdentity.runtimeEnv.presentNames, ["DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL"]);
    assert.equal(result.stdout.includes("cli-secret-value"), false);
    assert.equal(result.stdout.includes(envFile), false);
    assert.equal(plan.message.summary.kind, "RedactedSummary");
  });

  it("requires runtime digests and re-supplies message-file bytes without persisting them", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-cli-runtime-message-file-"));
    const workspace = path.join(root, "workspace");
    const messageFile = path.join(root, "message.txt");
    const runtimePlanFile = path.join(root, "runtime-plan.json");
    const out = path.join(root, "run-out");
    const missingDigestOut = path.join(root, "missing-digest-out");
    const rejectedOut = path.join(root, "rejected-out");
    const canary = "cli-transient-message-canary";
    await mkdir(workspace);
    await writeFile(messageFile, canary, "utf8");

    const missingDigest = await runCli([
      "run-plan",
      BLUEPRINT,
      "--workspace",
      workspace,
      "--message-file",
      messageFile,
      "--json",
    ]);
    assert.equal(missingDigest.code, 1);
    assert.equal(JSON.parse(missingDigest.stdout).code, "AGENTMO_ARTIFACT_DIGEST_REQUIRED");

    const planResult = await runCli([
      "run-plan",
      BLUEPRINT,
      "--digest",
      await blueprintDigestBinding(BLUEPRINT),
      "--workspace",
      workspace,
      "--message-file",
      messageFile,
      "--json",
    ]);
    assert.equal(planResult.code, 0, planResult.stderr);
    assert.equal(planResult.stdout.includes(canary), false);
    assert.equal(planResult.stdout.includes(messageFile), false);
    await writeFile(runtimePlanFile, planResult.stdout, "utf8");

    const runtimePlanBinding = await artifactDigestBinding("runtime-plan", runtimePlanFile);
    const missingRunDigest = await runCli([
      "run",
      runtimePlanFile,
      "--workspace",
      workspace,
      "--message-file",
      messageFile,
      "--out",
      missingDigestOut,
      "--json",
    ]);
    assert.equal(missingRunDigest.code, 1);
    assert.equal(JSON.parse(missingRunDigest.stdout).code, "AGENTMO_ARTIFACT_DIGEST_REQUIRED");
    await assert.rejects(() => stat(missingDigestOut), (error) => error?.code === "ENOENT");

    const run = await runCli([
      "run",
      runtimePlanFile,
      "--digest",
      runtimePlanBinding,
      "--workspace",
      workspace,
      "--message-file",
      messageFile,
      "--out",
      out,
      "--json",
    ]);
    assert.equal(run.code, 0, run.stderr);
    const runState = JSON.parse(run.stdout);
    const stateFile = path.join(out, "runs", runState.runId, "agentmo-run-state.json");
    assert.equal(run.stdout.includes(canary), false);
    assert.equal((await readFile(stateFile, "utf8")).includes(canary), false);
    assert.equal((await readFile(stateFile, "utf8")).includes(messageFile), false);

    await writeFile(messageFile, "mismatched-message", "utf8");
    const mismatch = await runCli([
      "run",
      runtimePlanFile,
      "--digest",
      runtimePlanBinding,
      "--workspace",
      workspace,
      "--message-file",
      messageFile,
      "--out",
      rejectedOut,
      "--json",
    ]);
    assert.equal(mismatch.code, 1);
    await assert.rejects(() => stat(rejectedOut), (error) => error?.code === "ENOENT");
  });

  it("writes non-live OpenClaw run-state JSON and index", async () => {
    const blueprintBinding = await blueprintDigestBinding(BLUEPRINT);
    const workspace = await mkdtemp(path.join(tmpdir(), "agentmo-cli-run-workspace-"));
    const out = await mkdtemp(path.join(tmpdir(), "agentmo-cli-run-out-"));
    const message = "Say exactly: ok";
    const runtimePlanFile = path.join(out, "runtime-plan.json");
    const runtimePlanResult = await runCli([
      "run-plan",
      BLUEPRINT,
      "--digest",
      blueprintBinding,
      "--target",
      "openclaw",
      "--workspace",
      workspace,
      "--agent",
      "win9",
      "--message",
      message,
      "--provider",
      "openai",
      "--model",
      "gpt-5.5",
      "--channel",
      "local-cli",
      "--transport",
      "local",
      "--json",
    ]);
    assert.equal(runtimePlanResult.code, 0, runtimePlanResult.stderr);
    assert.equal(runtimePlanResult.stdout.includes(message), false);
    await writeFile(runtimePlanFile, runtimePlanResult.stdout, "utf8");
    const runtimePlanBinding = await artifactDigestBinding("runtime-plan", runtimePlanFile);

    const result = await runCli([
      "run",
      runtimePlanFile,
      "--digest",
      runtimePlanBinding,
      "--workspace",
      workspace,
      "--message",
      message,
      "--out",
      out,
      "--json",
    ]);
    assert.equal(result.code, 0, result.stderr);
    const state = JSON.parse(result.stdout);
    assert.equal(state.schemaVersion, "agentmo.run.v1");
    assert.equal(state.execution.executed, false);
    assert.equal(state.execution.status, "declared");
    assert.equal(state.runtimeIdentity.selector.executionSelector.sessionKey.startsWith("agentmo-win9-"), true);
    assert.equal(state.runtimeIdentity.sandboxScope.usesProductionState, false);
    assert.equal(state.runtimeIdentity.provider, "openai");
    assert.equal(state.runtimeIdentity.model, "gpt-5.5");
    assert.equal(state.runtimeIdentity.channel, "local-cli");
    assert.equal(state.runtimeIdentity.transport, "local");
    assert.equal(state.certificationBoundary.runEvidenceCertifiesRuntime, false);
    const stateFile = path.join(out, "runs", state.runId, "agentmo-run-state.json");
    const indexFile = path.join(out, "agentmo-run-index.json");
    const savedState = JSON.parse(await readFile(stateFile, "utf8"));
    const index = JSON.parse(await readFile(indexFile, "utf8"));
    assert.equal(savedState.runId, state.runId);
    assert.equal(index.latestRunId, state.runId);
    for (const durable of [result.stdout, await readFile(stateFile, "utf8"), await readFile(indexFile, "utf8")]) {
      assert.equal(durable.includes(message), false);
      assert.equal(durable.includes(workspace), false);
    }
    const runStateBinding = await artifactDigestBinding("run-state", stateFile);

    const missingReportDigest = await runCli(["run-report", stateFile, "--json"]);
    assert.equal(missingReportDigest.code, 1);
    assert.equal(JSON.parse(missingReportDigest.stdout).code, "AGENTMO_ARTIFACT_DIGEST_REQUIRED");

    const report = await runCli(["run-report", stateFile, "--digest", runStateBinding, "--json"]);
    assert.equal(report.code, 0, report.stderr);
    const reportJson = JSON.parse(report.stdout);
    assert.equal(reportJson.schemaVersion, "agentmo.run-report.v1");
    assert.equal(reportJson.observationRef, `agentmo-run:${state.runId}`);

    const evaluation = await runCli([
      "run-eval",
      stateFile,
      "--digest",
      runStateBinding,
      "--expect-status",
      "declared",
      "--json",
    ]);
    assert.equal(evaluation.code, 0, evaluation.stderr);
    const evalJson = JSON.parse(evaluation.stdout);
    assert.equal(evalJson.schemaVersion, "agentmo.run-eval.v1");
    assert.equal(evalJson.ok, true);
    assert.equal(evalJson.certificationBoundary.runtimeCertifiedByRun, false);

    const exactEvaluation = await runCli([
      "run-eval",
      stateFile,
      "--digest",
      runStateBinding,
      "--expect-status",
      "declared",
      "--require-exact-replay",
      "--message",
      message,
      "--json",
    ]);
    assert.equal(exactEvaluation.code, 0, exactEvaluation.stderr);
    assert.equal(JSON.parse(exactEvaluation.stdout).replayFidelity, "exact");

    const mismatchedEvaluation = await runCli([
      "run-eval",
      stateFile,
      "--digest",
      runStateBinding,
      "--require-exact-replay",
      "--message",
      "different message",
      "--json",
    ]);
    assert.equal(mismatchedEvaluation.code, 1);
    assert.equal(JSON.parse(mismatchedEvaluation.stdout).replayFidelity, "reconstructed");

    const statusByState = await runCli([
      "status",
      BLUEPRINT,
      "--run-state",
      stateFile,
      "--digest",
      blueprintBinding,
      "--digest",
      runStateBinding,
      "--json",
    ]);
    assert.equal(statusByState.code, 0, statusByState.stderr);
    const stateSnapshot = JSON.parse(statusByState.stdout);
    assert.equal(stateSnapshot.latestRunState.available, true);
    assert.equal(stateSnapshot.latestRunState.runId, state.runId);
    assert.equal(stateSnapshot.latestRunState.runtimeIdentity.transport, "local");
    assert.equal(stateSnapshot.latestRunState.path, "[REDACTED_PATH]");
    assert.equal(statusByState.stdout.includes(stateFile), false);

    const observationFile = path.join(out, "declared-run.observation.json");
    const missingObservationFile = path.join(out, "missing-digest.observation.json");
    const mismatchedObservationFile = path.join(out, "mismatched-digest.observation.json");
    const missingObservationDigest = await runCli([
      "observe-run",
      stateFile,
      "--out",
      missingObservationFile,
      "--json",
    ]);
    assert.equal(missingObservationDigest.code, 1);
    assert.equal(JSON.parse(missingObservationDigest.stdout).code, "AGENTMO_ARTIFACT_DIGEST_REQUIRED");
    await assert.rejects(() => stat(missingObservationFile), (error) => error?.code === "ENOENT");

    const mismatchedObservationDigest = await runCli([
      "observe-run",
      stateFile,
      "--digest",
      `run-state=sha256:${"0".repeat(64)}`,
      "--out",
      mismatchedObservationFile,
      "--json",
    ]);
    assert.equal(mismatchedObservationDigest.code, 1);
    assert.equal(JSON.parse(mismatchedObservationDigest.stdout).code, "AGENTMO_ARTIFACT_DIGEST_MISMATCH");
    await assert.rejects(() => stat(mismatchedObservationFile), (error) => error?.code === "ENOENT");

    const observation = await runCli([
      "observe-run",
      stateFile,
      "--digest",
      runStateBinding,
      "--out",
      observationFile,
      "--json",
    ]);
    assert.equal(observation.code, 0, observation.stderr);
    const observationJson = JSON.parse(observation.stdout);
    assert.equal(observationJson.observationFile, "[REDACTED_PATH]");
    assert.equal(observation.stdout.includes(observationFile), false);
    assert.equal(observation.stdout.includes(out), false);
    assert.equal(observationJson.observation.schemaVersion, "agentmo.observation.v1");
    assert.equal(observationJson.observation.source.subject, "run-state");
    assert.equal(observationJson.observation.source.digest, runStateBinding.slice("run-state=".length));
    assert.equal(observationJson.observation.runEvidence.runId, state.runId);
    assert.equal(observationJson.observation.failureMode.includes("declared"), true);
    assert.equal(observationJson.report.ok, true);
    assert.equal((await readFile(observationFile, "utf8")).includes(stateFile), false);

    const missingObserveDigest = await runCli(["observe", observationFile, "--json"]);
    assert.equal(missingObserveDigest.code, 1);
    assert.equal(JSON.parse(missingObserveDigest.stdout).code, "AGENTMO_ARTIFACT_DIGEST_REQUIRED");
    const observationBinding = await artifactDigestBinding("observation", observationFile);
    const wrongObserveDigest = await runCli([
      "observe",
      observationFile,
      "--digest",
      `observation=sha256:${"0".repeat(64)}`,
      "--json",
    ]);
    assert.equal(wrongObserveDigest.code, 1);
    assert.equal(JSON.parse(wrongObserveDigest.stdout).code, "AGENTMO_ARTIFACT_DIGEST_MISMATCH");
    const observed = await runCli([
      "observe",
      observationFile,
      "--digest",
      observationBinding,
      "--json",
    ]);
    assert.equal(observed.code, 0, observed.stderr);
    const observedReport = JSON.parse(observed.stdout);
    assert.equal(observedReport.ok, true);
    assert.equal(observedReport.recommendedBlueprintChange.proposalOnly, true);
    assert.equal(observedReport.mutation.autoApplied, false);

    const existingIndexBytes = await readFile(indexFile);
    const missingExistingIndexBinding = await runCli([
      "run",
      runtimePlanFile,
      "--digest",
      runtimePlanBinding,
      "--workspace",
      workspace,
      "--message",
      message,
      "--out",
      out,
      "--json",
    ]);
    assert.equal(missingExistingIndexBinding.code, 1);
    assert.equal(JSON.parse(missingExistingIndexBinding.stdout).code, "AGENTMO_RUN_INDEX_DIGEST_REQUIRED");
    assert.deepEqual(await readFile(indexFile), existingIndexBytes);

    const existingRunIndexBinding = await artifactDigestBinding("run-index", indexFile);
    const second = await runCli([
      "run",
      runtimePlanFile,
      "--digest",
      runtimePlanBinding,
      "--digest",
      existingRunIndexBinding,
      "--workspace",
      workspace,
      "--message",
      message,
      "--out",
      out,
      "--json",
    ]);
    assert.equal(second.code, 0, second.stderr);
    const secondState = JSON.parse(second.stdout);
    const secondStateFile = path.join(out, "runs", secondState.runId, "agentmo-run-state.json");
    const secondStateBinding = await artifactDigestBinding("run-state", secondStateFile);
    const runIndexBinding = await artifactDigestBinding("run-index", indexFile);

    const missingIndexDigest = await runCli([
      "status",
      BLUEPRINT,
      "--run-dir",
      out,
      "--digest",
      blueprintBinding,
      "--digest",
      secondStateBinding,
      "--json",
    ]);
    assert.equal(missingIndexDigest.code, 1);
    assert.equal(JSON.parse(missingIndexDigest.stdout).code, "AGENTMO_ARTIFACT_DIGEST_REQUIRED");

    const statusByDir = await runCli([
      "status",
      BLUEPRINT,
      "--run-dir",
      out,
      "--digest",
      blueprintBinding,
      "--digest",
      secondStateBinding,
      "--digest",
      runIndexBinding,
      "--json",
    ]);
    assert.equal(statusByDir.code, 0, statusByDir.stderr);
    const dirSnapshot = JSON.parse(statusByDir.stdout);
    assert.equal(dirSnapshot.latestRunState.runId, secondState.runId);

    const explicitWins = await runCli([
      "status",
      BLUEPRINT,
      "--run-state",
      stateFile,
      "--run-dir",
      out,
      "--digest",
      blueprintBinding,
      "--digest",
      runStateBinding,
      "--json",
    ]);
    assert.equal(explicitWins.code, 0, explicitWins.stderr);
    const explicitSnapshot = JSON.parse(explicitWins.stdout);
    assert.equal(explicitSnapshot.latestRunState.runId, state.runId);

    const replayOut = await mkdtemp(path.join(tmpdir(), "agentmo-cli-replay-out-"));
    const replay = await runCli([
      "replay-run",
      stateFile,
      "--digest",
      runStateBinding,
      "--workspace",
      workspace,
      "--message",
      message,
      "--out",
      replayOut,
      "--require-exact-replay",
      "--json",
    ]);
    assert.equal(replay.code, 0, replay.stderr);
    const replayState = JSON.parse(replay.stdout);
    assert.equal(replayState.parentRunId, state.runId);
    assert.equal(replayState.replay.policy, "fresh-child-session");
    assert.notEqual(
      replayState.runtimeIdentity.selector.executionSelector.sessionKey,
      state.runtimeIdentity.selector.executionSelector.sessionKey,
    );
  });

  it("scaffolds both supported targets with expected file lists", async () => {
    const blueprintBinding = await blueprintDigestBinding(BLUEPRINT);
    const agentmoDir = await mkdtemp(path.join(tmpdir(), "agentmo-cli-agentmo-"));
    const agentmo = await runCli(["scaffold", BLUEPRINT, "--digest", blueprintBinding, "--out", agentmoDir]);
    assert.equal(agentmo.code, 0, agentmo.stderr);
    assert.match(agentmo.stdout, /Scaffolded 17 files/u);
    assert.equal(agentmo.stdout.includes(agentmoDir), false);
    assert.deepEqual(await listFiles(agentmoDir, { exclude: new Set([BUILD_STATE_FILENAME]) }), AGENTMO_BASELINE_FILES);
    assert.deepEqual(await listFiles(agentmoDir), [...AGENTMO_BASELINE_FILES, BUILD_STATE_FILENAME].sort());

    const openclawDir = await mkdtemp(path.join(tmpdir(), "agentmo-cli-openclaw-"));
    const openclaw = await runCli(["scaffold", BLUEPRINT, "--digest", blueprintBinding, "--target", "openclaw", "--out", openclawDir]);
    assert.equal(openclaw.code, 0, openclaw.stderr);
    assert.match(openclaw.stdout, /Scaffolded 29 files/u);
    assert.equal(openclaw.stdout.includes(openclawDir), false);
    assert.deepEqual(await listFiles(openclawDir, { exclude: new Set([BUILD_STATE_FILENAME]) }), OPENCLAW_BASELINE_FILES);
    assert.deepEqual(await listFiles(openclawDir), [...OPENCLAW_BASELINE_FILES, BUILD_STATE_FILENAME].sort());
  });

  it("prints a control status snapshot with optional build-state", async () => {
    const blueprintBinding = await blueprintDigestBinding(BLUEPRINT);
    const status = await runCli(["status", BLUEPRINT, "--digest", blueprintBinding, "--json"]);
    assert.equal(status.code, 0, status.stderr);
    const snapshot = JSON.parse(status.stdout);
    assert.equal(snapshot.schemaVersion, "agentmo.control.v1");
    assert.equal(snapshot.agentId, "win9");
    assert.equal(snapshot.latestBuildState.available, false);

    const dir = await mkdtemp(path.join(tmpdir(), "agentmo-cli-status-openclaw-"));
    const scaffold = await runCli(["scaffold", BLUEPRINT, "--digest", blueprintBinding, "--target", "openclaw", "--out", dir]);
    assert.equal(scaffold.code, 0, scaffold.stderr);

    const buildStatePath = path.join(dir, BUILD_STATE_FILENAME);
    const buildStateBinding = `build-state=sha256:${createHash("sha256").update(await readFile(buildStatePath)).digest("hex")}`;
    const missingBinding = await runCli(["status", BLUEPRINT, "--build-state", buildStatePath, "--digest", blueprintBinding, "--json"]);
    assert.equal(missingBinding.code, 1);
    assert.equal(JSON.parse(missingBinding.stdout).code, "AGENTMO_ARTIFACT_DIGEST_REQUIRED");

    const withState = await runCli([
      "status",
      BLUEPRINT,
      "--build-state",
      buildStatePath,
      "--digest",
      blueprintBinding,
      "--digest",
      buildStateBinding,
      "--json",
    ]);
    assert.equal(withState.code, 0, withState.stderr);
    const stateSnapshot = JSON.parse(withState.stdout);
    assert.equal(stateSnapshot.latestBuildState.available, true);
    assert.equal(stateSnapshot.latestBuildState.target.id, "openclaw");
    assert.equal(stateSnapshot.latestBuildState.operations.domainOperationCount, OPENCLAW_BASELINE_FILES.length);
    assert.equal(stateSnapshot.latestBuildState.path, "[REDACTED_PATH]");
    assert.equal(withState.stdout.includes(buildStatePath), false);

    const unexpectedBinding = await runCli([
      "status",
      BLUEPRINT,
      "--digest",
      blueprintBinding,
      "--digest",
      buildStateBinding,
      "--json",
    ]);
    assert.equal(unexpectedBinding.code, 1);
    assert.equal(JSON.parse(unexpectedBinding.stdout).code, "AGENTMO_ARTIFACT_DIGEST_UNKNOWN_SUBJECT");
  });

  it("requires exact observation admission before validating a record", async () => {
    const observationFile = fileURLToPath(new URL("../examples/win9.observation.json", import.meta.url));
    const result = await runCli(["observe", observationFile, "--json"]);
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stdout).code, "AGENTMO_ARTIFACT_DIGEST_REQUIRED");
  });

  it("rejects invalid targets consistently", async () => {
    const plan = await runCli(["plan", BLUEPRINT, "--target", "missing", "--json"]);
    assertJsonError(plan, "AGENTMO_CLI_REQUEST_REJECTED", ["missing", BLUEPRINT]);

    const runPlan = await runCli(["run-plan", BLUEPRINT, "--target", "missing", "--workspace", "/tmp/x", "--message", "ping", "--json"]);
    assertJsonError(runPlan, "AGENTMO_CLI_REQUEST_REJECTED", ["missing", "/tmp/x", BLUEPRINT]);

    const dir = await mkdtemp(path.join(tmpdir(), "agentmo-cli-missing-"));
    const scaffold = await runCli(["scaffold", BLUEPRINT, "--target", "missing", "--out", dir]);
    assertHumanError(scaffold, "AGENTMO_CLI_REQUEST_REJECTED", ["missing", dir, BLUEPRINT]);
  });
});
