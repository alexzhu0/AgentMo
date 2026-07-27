import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { CLI_OUTPUT_OWNERS } from "../src/cli.js";
import {
  DURABLE_COMMAND_SUBJECTS,
  OPTIONAL_DURABLE_COMMAND_SUBJECTS,
  subjectsForCommand,
} from "../src/artifact-subjects.js";
import { OPENCLAW_TARGET_NODE_RANGE } from "../src/runtime-compatibility.js";
import { buildTargetFiles } from "../src/scaffold-files.js";
import { openClawTarget } from "../src/targets/openclaw.js";
import {
  assertPreflightDominatesMutation,
  parseShellControlSegments,
} from "./helpers/openclaw-shell-contract.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXECUTABLE = String.raw`(?:node\s+\.\/bin\/agentmo\.js|\.\/bin\/agentmo\.js|agentmo)`;
const COMMAND_START = new RegExp(`^${EXECUTABLE}\\s+([a-z][a-z0-9-]*)\\b`, "u");
const DIGEST_BINDING = /--digest\s+"([a-z0-9-]+)=\$\((?:(digest_file)|node -e '([^']+)')\s+"([^"\n]+)"\)"/gu;
const EXACT_BYTE_HELPER = /digest_file\s*\(\)\s*\{[^\n]*createHash\("sha256"\)[^\n]*readFileSync\(process\.argv\[1\]\)[^\n]*\}/u;
const CANONICAL_OPENCLAW_PREFLIGHT = new RegExp(`${EXECUTABLE}\\s+runtime-check\\s+--target\\s+(?:"openclaw"|'openclaw'|openclaw)\\b`, "u");
const LIVE_SMOKE_CALLER = /(?:^|\s)(?:\.\/)?scripts\/openclaw-live-smoke\.sh\b/u;
const MAX_SHELL_NESTING = 2;
const ZERO_SUBJECT_COMMANDS = Object.freeze(new Set(["artifact-contract", "runtime-check"]));
const EXPECTED_GENERATED_CALLER_SURFACES = Object.freeze([
  "src/scaffold-files.js:openclaw/config/channel-bindings.examples.md",
  "src/scaffold-files.js:openclaw/RUNBOOK.md",
  "src/targets/openclaw.js:verificationHints",
]);
const EXPECTED_MAINTAINED_CALLER_FILES = Object.freeze([
  "README.md",
  "docs/MVP_RUNBOOK.md",
  "docs/OMX_SESSION_MIGRATION.md",
  "docs/OPENCLAW_RUNTIME_NOTES.md",
  "docs/RUNTIME_EXECUTION.md",
]);

const OPENCLAW_CLASSIFICATIONS = Object.freeze({
  "agents:add": "mutation",
  "agents:bind": "mutation",
  "agents:list": "inspection",
  "channels:status": "inspection",
  "gateway:run": "mutation",
  sessions: "inspection",
});

const SUBJECT_OPTION_FLAGS = Object.freeze({
  "birth-report": "--birth-report",
  "build-state": "--build-state",
  "design-plan": "--design-plan",
  "discovery-manifest": "--discovery-manifest",
  "domain-cases": "--cases",
  "domain-eval": "--domain-eval",
  "run-eval": "--run-eval",
  "user-need": "--need",
});

describe("maintained command documentation", () => {
  it("discovers every AgentMo shell-fence invocation and binds exact file bytes through the production registry", async () => {
    const files = [path.join(REPO_ROOT, "README.md"), ...(await markdownFiles(path.join(REPO_ROOT, "docs")))];
    const corpus = [];

    for (const file of files.sort()) {
      const markdown = await readFile(file, "utf8");
      const relativeFile = normalizePath(path.relative(REPO_ROOT, file));
      assert.doesNotMatch(markdown, /digest_file\s*\(\)[\s\S]{0,500}JSON\.parse\s*\(/u, `${relativeFile}: parsed JSON must not be hashed`);
      for (const block of extractShellBlocks(markdown, relativeFile)) {
        const invocations = extractAgentMoInvocations(block.source);
        if (invocations.length === 0) continue;
        if (invocations.some((invocation) => !ZERO_SUBJECT_COMMANDS.has(commandForInvocation(invocation)))) {
          assert.match(block.source, EXACT_BYTE_HELPER, `${block.label}: exact-byte digest_file helper is missing`);
        }
        for (const invocation of invocations) {
          assertDocumentInvocation(invocation, block.label);
          corpus.push([block.label, invocation]);
        }
      }
    }

    assert.equal(corpus.length > 0, true);
    assert.equal(new Set(corpus.map(([label]) => label.split(":")[0])).size >= 8, true);
  });

  it("rejects missing, duplicate, extra, unknown, operand-drifted, and parsed-JSON bindings", () => {
    const digest = (subject, file) => `--digest "${subject}=$(digest_file \"${file}\")"`;
    const valid = `agentmo validate "$BLUEPRINT" ${digest("blueprint", "$BLUEPRINT")}`;
    assert.doesNotThrow(() => assertDocumentInvocation(valid, "valid-canary"));

    for (const invalid of [
      'agentmo validate "$BLUEPRINT"',
      `${valid} ${digest("blueprint", "$BLUEPRINT")}`,
      `${valid} ${digest("extra", "$EXTRA")}`,
      `agentmo validate "$BLUEPRINT" ${digest("blueprint", "$OTHER")}`,
    ]) {
      assert.throws(() => assertDocumentInvocation(invalid, "invalid-canary"), assert.AssertionError);
    }
    assert.throws(
      () => assertDocumentInvocation('agentmo private-command "$FILE" --digest "blueprint=$(digest_file \"$FILE\")"', "unknown-canary"),
      (error) => error?.code === "AGENTMO_DURABLE_COMMAND_UNSUPPORTED",
    );
    assert.doesNotMatch(
      'digest_file() { node -e \'JSON.parse(require("node:fs").readFileSync(process.argv[1]))\' "$1"; }',
      EXACT_BYTE_HELPER,
    );
    assert.doesNotThrow(() => assertDocumentInvocation("agentmo runtime-check --target openclaw", "zero-subject-canary"));
    assert.doesNotThrow(() => assertDocumentInvocation(
      "agentmo artifact-contract discovery-manifest --json",
      "artifact-contract-zero-subject-canary",
    ));
    assert.throws(
      () => assertDocumentInvocation('agentmo runtime-check --target openclaw --digest "blueprint=$(digest_file \"$BLUEPRINT\")"', "zero-subject-digest-canary"),
      assert.AssertionError,
    );
    assert.equal(CLI_OUTPUT_OWNERS["runtime-check"], "non-artifact");
    assert.equal(Object.hasOwn(DURABLE_COMMAND_SUBJECTS, "runtime-check"), false);
    assert.throws(
      () => assertClassifiedOpenClawCommands("openclaw agents delete synthetic", "unclassified-openclaw-canary"),
      assert.AssertionError,
    );
  });

  it("normalizes bounded OpenClaw launchers and fails closed on unknown callers", () => {
    const classified = [
      ["openclaw agents list --bindings", "inspection"],
      ["env KEY=value openclaw agents add synthetic --workspace ./workspace", "mutation"],
      ["command openclaw agents bind --agent synthetic --bind telegram:*", "mutation"],
      ["/opt/openclaw/bin/openclaw channels status --probe", "inspection"],
      ['"/opt/openclaw/bin/openclaw" sessions --agent synthetic --json', "inspection"],
      ["./node_modules/.bin/openclaw agents add synthetic --workspace ./workspace", "mutation"],
      ["$OPENCLAW_BIN gateway run", "mutation"],
      ['"${OPENCLAW_BIN}" agents add synthetic --workspace ./workspace', "mutation"],
      ["run_openclaw agents add synthetic --workspace ./workspace", "mutation"],
      ["npm exec -- openclaw agents add synthetic --workspace ./workspace", "mutation"],
      ["npx openclaw agents add synthetic --workspace ./workspace", "mutation"],
      ["pnpm openclaw agents add synthetic --workspace ./workspace", "mutation"],
      ["pnpm exec openclaw agents add synthetic --workspace ./workspace", "mutation"],
      ["bunx openclaw agents add synthetic --workspace ./workspace", "mutation"],
      ["bun x openclaw agents add synthetic --workspace ./workspace", "mutation"],
      ["xargs -r openclaw agents add synthetic", "mutation"],
      ["sh -c 'openclaw agents add synthetic --workspace ./workspace'", "mutation"],
    ];

    for (const [source, expected] of classified) {
      const calls = assertClassifiedOpenClawCommands(source, `launcher-canary:${source}`);
      assert.deepEqual(calls.map(({ classification }) => classification), [expected], source);
    }

    for (const source of [
      "sudo openclaw agents add synthetic",
      "npm run openclaw agents add synthetic",
      "openclaw agents delete synthetic",
      "openclaw plugins install synthetic",
      "my-openclaw agents add synthetic",
      "sh -c '$OPENCLAW_COMMAND'",
    ]) {
      assert.throws(() => assertClassifiedOpenClawCommands(source, `rejected-launcher-canary:${source}`), assert.AssertionError, source);
    }
    assert.throws(
      () => assertClassifiedOpenClawCommands("'openclaw agents add synthetic", "ambiguous-quote-canary"),
      (error) => error?.code === "AGENTMO_SHELL_QUOTING_AMBIGUOUS",
    );
  });

  it("requires each independently copyable verification hint to carry its own preflight", () => {
    assert.throws(
      () => assertVerificationHints([
        "node ./bin/agentmo.js runtime-check --target openclaw",
        "openclaw agents add synthetic --workspace ./workspace",
      ], "cross-hint-borrowing-canary"),
      (error) => error?.code === "AGENTMO_SHELL_PREFLIGHT_MISSING",
    );
    assert.doesNotThrow(() => assertVerificationHints([
      "node ./bin/agentmo.js runtime-check --target openclaw && openclaw agents add synthetic --workspace ./workspace",
    ], "self-contained-hint-canary"));
    assertVerificationHints(openClawTarget.verificationHints, "production-verificationHints");
  });

  it("rejects bypass control edges and accepts only a dominating success edge", () => {
    const preflight = "node ./bin/agentmo.js runtime-check --target openclaw";
    const mutation = "openclaw agents add synthetic --workspace ./workspace";
    const rejected = [
      [`${preflight} || ${mutation}`, "AGENTMO_SHELL_PREFLIGHT_OR_EDGE"],
      [`${preflight} ; ${mutation}`, "AGENTMO_SHELL_PREFLIGHT_SEQUENCE_EDGE"],
      [`${preflight}\n${mutation}`, "AGENTMO_SHELL_PREFLIGHT_NEWLINE_EDGE"],
      [`${preflight} | ${mutation}`, "AGENTMO_SHELL_PREFLIGHT_PIPE_EDGE"],
      [`${mutation} && ${preflight}`, "AGENTMO_SHELL_PREFLIGHT_MISSING"],
      [`${preflight} && echo checked\n${mutation}`, "AGENTMO_SHELL_PREFLIGHT_NEWLINE_EDGE"],
      [`echo disconnected && ${mutation}`, "AGENTMO_SHELL_PREFLIGHT_DISCONNECTED"],
      [`true || ${preflight} && ${mutation}`, "AGENTMO_SHELL_PREFLIGHT_DISCONNECTED"],
      [`printf checked | ${preflight} && ${mutation}`, "AGENTMO_SHELL_PREFLIGHT_DISCONNECTED"],
    ];

    for (const [source, code] of rejected) {
      assert.throws(
        () => assertPreflightBeforeMutation(source, `control-edge-bypass:${code}`),
        (error) => error?.code === code,
        source,
      );
    }

    assert.doesNotThrow(() => assertPreflightBeforeMutation(`${preflight} && ${mutation}`, "control-edge-success"));
    assert.throws(
      () => assertPreflightBeforeMutation(`${preflight} && sudo ${mutation}`, "unknown-wrapper-bypass"),
      assert.AssertionError,
    );
  });

  it("closes the generated OpenClaw caller set across both production renderer owners", async () => {
    const blueprint = JSON.parse(await readFile(path.join(REPO_ROOT, "examples/win9.agentmo.json"), "utf8"));
    const surfaces = generatedCallerSurfaces(blueprint);

    assert.deepEqual(surfaces.map(({ id }) => id), EXPECTED_GENERATED_CALLER_SURFACES);
    for (const surface of surfaces) {
      assert.match(surface.source, new RegExp(escapeRegExp(OPENCLAW_TARGET_NODE_RANGE), "u"), `${surface.id}: canonical range missing`);
      for (const block of surface.blocks.filter(({ source }) => hasOpenClawCaller(source))) {
        const label = `${surface.id}:${block.label}`;
        const calls = assertClassifiedOpenClawCommands(block.source, label);
        if (calls.some(({ classification }) => classification === "mutation") || hasGeneratedControlEffect(block.source, label)) {
          assertGeneratedOpenClawControlFlow(block.source, label);
        }
      }
    }
  });

  it("recursively closes the maintained OpenClaw caller corpus and rejects ungated blocks", async () => {
    const files = [path.join(REPO_ROOT, "README.md"), ...(await markdownFiles(path.join(REPO_ROOT, "docs")))];
    const discovered = [];

    for (const file of files.sort()) {
      const markdown = await readFile(file, "utf8");
      const relativeFile = normalizePath(path.relative(REPO_ROOT, file));
      const callerBlocks = extractShellBlocks(markdown, relativeFile).filter(({ source }) => isMaintainedOpenClawCallerBlock(source));
      if (callerBlocks.length === 0) continue;
      discovered.push(relativeFile);
      assert.match(markdown, new RegExp(escapeRegExp(OPENCLAW_TARGET_NODE_RANGE), "u"), `${relativeFile}: canonical range missing`);
      for (const block of callerBlocks) {
        const calls = assertClassifiedOpenClawCommands(block.source, block.label);
        assert.match(block.source, CANONICAL_OPENCLAW_PREFLIGHT, `${block.label}: canonical preflight missing`);
        if (calls.some(({ classification }) => classification === "mutation")) {
          assertPreflightBeforeMutation(block.source, block.label);
        }
      }
    }

    assert.deepEqual(discovered, EXPECTED_MAINTAINED_CALLER_FILES);
  });

  it("rejects host-specific absolute paths across maintained Markdown", async () => {
    const files = [path.join(REPO_ROOT, "README.md"), ...(await markdownFiles(path.join(REPO_ROOT, "docs")))];
    for (const file of files.sort()) {
      const markdown = await readFile(file, "utf8");
      const relativeFile = normalizePath(path.relative(REPO_ROOT, file));
      assertPortableMarkdownPaths(markdown, relativeFile);
    }

    assert.doesNotThrow(() => assertPortableMarkdownPaths([
      "cd $AGENTMO_REPO",
      "--openclaw-source-root $OPENCLAW_SOURCE_ROOT",
      "--out /tmp/agentmo-run",
      "source root: <openclaw-source-root>",
    ].join("\n"), "portable-canary"));
    assert.throws(() => assertPortableMarkdownPaths("cd /home/alex/project", "posix-host-canary"), assert.AssertionError);
    assert.throws(() => assertPortableMarkdownPaths("cd C:\\Users\\alex\\project", "windows-host-canary"), assert.AssertionError);
  });

  it("keeps Builder v1 docs on the append-only CLI and indexes every dated release once", async () => {
    const readme = await readFile(path.join(REPO_ROOT, "README.md"), "utf8");
    const runbook = await readFile(path.join(REPO_ROOT, "docs/MVP_RUNBOOK.md"), "utf8");
    const currentRelease = await readFile(path.join(REPO_ROOT, "release/2026.07.22.md"), "utf8");
    const documentedCommands = Array.from(
      readme.matchAll(/```text\n([\s\S]*?)```/gu),
      (match) => match[1],
    ).join("\n");

    assert.doesNotMatch(documentedCommands, /\bbuilder\s+(?:uninstall|purge)\b/u);
    assert.doesNotMatch(documentedCommands, /--remove-host-selector\b/u);
    assert.doesNotMatch(documentedCommands, /\bbuilder\s+codex-uat\s+(?:begin|finalize)\b/u);
    for (const action of ["start", "record", "scenario-arm", "terminal", "inspect", "resume", "continue"]) {
      assert.match(documentedCommands, new RegExp(`\\bbuilder\\s+codex-uat\\s+${action}\\b`, "u"), action);
    }
    assert.match(documentedCommands, /builder behavior[\s\S]*--uat-journal[\s\S]*--uat-candidate/u);
    assert.match(runbook, /--uat-journal <journal-file>/u);
    assert.match(runbook, /--journal.*<attempt-dir>\/attempt\.journal/u);
    assert.doesNotMatch(runbook, /--(?:uat-)?journal <attempt-dir>/u);
    assert.match(currentRelease, /--journal <journal-file>/u);
    assert.doesNotMatch(currentRelease, /--journal <attempt-dir>/u);
    assert.match(documentedCommands, /verify-codex-uat-candidate\.js preview/u);
    assert.match(documentedCommands, /verify-codex-uat-candidate\.js decide approve/u);

    for (const markdown of [readme, runbook, currentRelease]) {
      assert.match(markdown, /projected-v2/u);
      assert.match(markdown, /immutable version-qualified/u);
      assert.match(markdown, /external (?:human )?decision authority|externalDecisionAuthorityRequired/iu);
      assert.match(markdown, /nonterminal/iu);
    }

    const releaseDirectory = path.join(REPO_ROOT, "release");
    const datedFiles = (await readdir(releaseDirectory))
      .filter((name) => /^\d{4}\.\d{2}\.\d{2}\.md$/u.test(name))
      .sort()
      .reverse();
    const releaseIndex = await readFile(path.join(releaseDirectory, "README.md"), "utf8");
    const indexedFiles = Array.from(
      releaseIndex.matchAll(/\[`(\d{4}\.\d{2}\.\d{2}\.md)`\]\(\.\/\1\)/gu),
      (match) => match[1],
    );
    assert.deepEqual(indexedFiles, datedFiles);
    assert.equal(new Set(indexedFiles).size, indexedFiles.length);
  });
});

function assertPortableMarkdownPaths(markdown, label) {
  const withoutUrls = markdown.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s)>\]]+/giu, "<url>");
  assert.doesNotMatch(withoutUrls, /\/(?:Users|home)\/[A-Za-z0-9._-]+(?:\/[^\s`"'<>),\]}]+)?/gu, `${label}: host-specific POSIX path`);
  assert.doesNotMatch(withoutUrls, /[A-Za-z]:[\\/]Users[\\/][^\\/\s`"'<>]+(?:[\\/][^\s`"'<>),\]}]+)?/gu, `${label}: host-specific Windows path`);
}

function assertDocumentInvocation(invocation, label) {
  const commandMatch = COMMAND_START.exec(invocation);
  assert.ok(commandMatch, `${label}: unsupported AgentMo executable form`);
  const command = commandMatch[1];
  if (ZERO_SUBJECT_COMMANDS.has(command)) {
    assert.equal(CLI_OUTPUT_OWNERS[command], "non-artifact", `${label}: zero-subject command must remain non-artifact`);
    assert.doesNotMatch(invocation, /--digest\b/u, `${label}: ${command} must remain zero-subject`);
    if (command === "runtime-check") {
      assert.match(invocation, CANONICAL_OPENCLAW_PREFLIGHT, `${label}: runtime-check contract drifted`);
    } else {
      assert.match(
        invocation,
        /(?:^|\s)artifact-contract\s+(?:discovery-manifest|user-need)(?:\s+--json)?(?:\s|$)/u,
        `${label}: artifact-contract subject drifted`,
      );
    }
    return;
  }
  if (!Object.hasOwn(DURABLE_COMMAND_SUBJECTS, command) && command !== "migrate") {
    subjectsForCommand(command);
  }

  const bindings = Array.from(invocation.matchAll(DIGEST_BINDING), (match) => ({
    text: match[0],
    subject: match[1],
    helper: match[2] ?? null,
    nodeSource: match[3] ?? null,
    fileExpression: match[4],
  }));
  const subjects = bindings.map(({ subject }) => subject);
  const optional = OPTIONAL_DURABLE_COMMAND_SUBJECTS[command] ?? [];
  const resolverOptions = command === "migrate"
    ? { inputCount: subjects.length }
    : { includeOptionalSubjects: subjects.filter((subject) => optional.includes(subject)) };
  const expected = subjectsForCommand(command, resolverOptions);

  assert.deepEqual(subjects, expected, `${label}: ${command} digest subjects drifted`);
  assert.equal(new Set(subjects).size, subjects.length, `${label}: ${command} repeats a digest subject`);
  for (const binding of bindings) {
    assert.equal(
      binding.helper === "digest_file"
        || (binding.nodeSource?.includes('createHash("sha256")')
          && binding.nodeSource.includes("readFileSync(process.argv[1])")
          && !binding.nodeSource.includes("JSON.parse")),
      true,
      `${label}: ${command}/${binding.subject} must hash exact file bytes`,
    );
    assert.equal(
      operandForSubject(invocation, command, binding.subject),
      binding.fileExpression,
      `${label}: ${command}/${binding.subject} digest operand drifted`,
    );
  }

  const withoutBindings = bindings.reduce((text, binding) => text.replace(binding.text, ""), invocation);
  assert.doesNotMatch(withoutBindings, /--digest\b/u, `${label}: ${command} has an unparsed digest binding`);
}

function commandForInvocation(invocation) {
  return COMMAND_START.exec(invocation)?.[1] ?? null;
}

function generatedCallerSurfaces(blueprint) {
  const surfaces = [];
  for (const [relativePath, source] of buildTargetFiles(blueprint, "openclaw")) {
    if (path.extname(relativePath) !== ".md") continue;
    const blocks = extractShellBlocks(source, relativePath);
    if (!blocks.some(({ source: blockSource }) => hasOpenClawCaller(blockSource))) continue;
    surfaces.push({
      id: `src/scaffold-files.js:${relativePath}`,
      source,
      blocks,
    });
  }
  const hintSource = openClawTarget.verificationHints.join("\n");
  if (hasOpenClawCaller(hintSource)) {
    surfaces.push({
      id: "src/targets/openclaw.js:verificationHints",
      source: hintSource,
      blocks: openClawTarget.verificationHints.map((source, index) => ({ source, label: `verificationHints[${index}]` })),
    });
  }
  return surfaces.sort((left, right) => left.id.localeCompare(right.id));
}

function hasOpenClawCaller(source) {
  return CANONICAL_OPENCLAW_PREFLIGHT.test(source)
    || LIVE_SMOKE_CALLER.test(source)
    || assertClassifiedOpenClawCommands(source, "caller-discovery").length > 0
    || parseShellControlSegments(source, "generated-effect-discovery").some(({ tokens }) => isOpenClawAgentMoMutation(tokens));
}

function isMaintainedOpenClawCallerBlock(source) {
  return CANONICAL_OPENCLAW_PREFLIGHT.test(source)
    || LIVE_SMOKE_CALLER.test(source)
    || assertClassifiedOpenClawCommands(source, "maintained-caller-discovery").length > 0;
}

function assertClassifiedOpenClawCommands(source, label) {
  const calls = [];
  for (const command of parseShellControlSegments(source, label)) {
    calls.push(...classifyOpenClawCommand(command.tokens, `${label}:${command.ordinal}`));
  }
  return calls;
}

function assertPreflightBeforeMutation(source, label) {
  return assertPreflightDominatesMutation(source, label, {
    isPreflight: isCanonicalPreflight,
    classifyCommand: (tokens, commandLabel) => classifyOpenClawCommand(tokens, commandLabel).map((call) => ({
      ...call,
      requiresPreflight: call.classification === "mutation",
    })),
  });
}

function assertGeneratedOpenClawControlFlow(source, label) {
  return assertPreflightDominatesMutation(source, label, {
    isPreflight: isCanonicalPreflight,
    classifyCommand: (tokens, commandLabel) => {
      const calls = classifyOpenClawCommand(tokens, commandLabel);
      if (calls.length > 0) {
        return calls.map((call) => ({
          ...call,
          requiresPreflight: call.classification === "mutation",
        }));
      }
      if (isCanonicalPreflight(tokens)) return [];
      if (isGeneratedSetupEffect(tokens)) {
        return [{ key: generatedEffectKey(tokens), classification: "effect", requiresPreflight: true }];
      }
      assert.fail(`${commandLabel}: unexamined generated OpenClaw command`);
    },
  });
}

function hasGeneratedControlEffect(source, label) {
  return parseShellControlSegments(source, label).some(({ tokens }, ordinal) => (
    classifyOpenClawCommand(tokens, `${label}:effect-discovery:${ordinal}`)
      .some(({ classification }) => classification === "mutation")
    || isGeneratedSetupEffect(tokens)
  ));
}

function assertVerificationHints(hints, label) {
  for (const [index, hint] of hints.entries()) {
    const hintLabel = `${label}[${index}]`;
    const calls = assertClassifiedOpenClawCommands(hint, hintLabel);
    if (calls.some(({ classification }) => classification === "mutation")) {
      assertPreflightBeforeMutation(hint, hintLabel);
    }
  }
}

function classifyOpenClawCommand(tokens, label, nesting = 0) {
  assert.equal(nesting <= MAX_SHELL_NESTING, true, `${label}: shell wrapper nesting limit exceeded`);
  const command = unwrapLeadingShellWrappers(tokens, label);
  if (command === null || command.length === 0) return [];

  if (isAgentMoCommand(command)) return [];
  const embeddedAgentMoIndex = command.findIndex((token, index) => (
    (token === "node" && isAgentMoCommand(command.slice(index)))
    || (token === "agentmo" && isAgentMoCommand(command.slice(index)))
  ));
  if (embeddedAgentMoIndex !== -1) return [];

  const executable = command[0];
  const executableName = path.posix.basename(executable.replaceAll("\\", "/"));
  if (["bash", "sh", "zsh"].includes(executableName)) {
    const commandIndex = command.findIndex((token) => token === "-c" || token === "-lc");
    assert.notEqual(commandIndex, -1, `${label}: shell wrapper requires a bounded -c/-lc command`);
    const nestedSource = command[commandIndex + 1];
    assert.equal(typeof nestedSource, "string", `${label}: shell wrapper command is missing`);
    assert.doesNotMatch(nestedSource, /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/u, `${label}: dynamic shell wrapper command is ambiguous`);
    return parseShellControlSegments(nestedSource, `${label}:nested`).flatMap((nested) => classifyOpenClawCommand(nested.tokens, `${label}:nested:${nested.ordinal}`, nesting + 1));
  }

  if (isLiveSmokeLauncher(executable)) {
    return [{ key: "live-smoke", classification: "mutation", launcher: executable }];
  }

  const packageCommand = unwrapPackageRunner(command, label);
  const launcher = packageCommand[0];
  if (!isOpenClawLauncher(launcher)) {
    if (packageCommand.some((token) => isOpenClawLauncher(token)) || /openclaw/u.test(launcher ?? "")) {
      assert.fail(`${label}: unknown wrapper or OpenClaw-shaped launcher`);
    }
    return [];
  }

  const args = packageCommand.slice(1).filter((token, index) => !(index === 0 && token === "--"));
  const key = args[0] === "sessions" ? "sessions" : `${args[0] ?? "<missing>"}:${args[1] ?? "<missing>"}`;
  const classification = OPENCLAW_CLASSIFICATIONS[key];
  assert.equal(typeof classification, "string", `${label}: unclassified OpenClaw caller ${key}`);
  return [{ key, classification, launcher }];
}

function unwrapLeadingShellWrappers(tokens, label) {
  let index = 0;
  while (isAssignment(tokens[index])) index += 1;
  if (tokens[index] === "env") {
    index += 1;
    while (index < tokens.length) {
      if (isAssignment(tokens[index]) || ["-i", "--ignore-environment", "--"].includes(tokens[index])) {
        index += 1;
        continue;
      }
      if (["-u", "--unset"].includes(tokens[index])) {
        assert.equal(typeof tokens[index + 1], "string", `${label}: env unset operand missing`);
        index += 2;
        continue;
      }
      if (tokens[index].startsWith("--unset=")) {
        index += 1;
        continue;
      }
      assert.doesNotMatch(tokens[index], /^-/u, `${label}: unsupported env wrapper option`);
      break;
    }
  }
  if (tokens[index] === "command") {
    index += 1;
    assert.equal(["-v", "-V"].includes(tokens[index]), false, `${label}: command lookup is not an OpenClaw invocation`);
    if (tokens[index] === "--") index += 1;
    assert.doesNotMatch(tokens[index] ?? "", /^-/u, `${label}: unsupported command wrapper option`);
  }
  if (tokens[index] === "xargs") {
    index += 1;
    while (index < tokens.length && tokens[index].startsWith("-")) {
      if (["-0", "-r", "--no-run-if-empty", "--"].includes(tokens[index]) || tokens[index].startsWith("--max-args=")) {
        index += 1;
        continue;
      }
      if (["-n", "--max-args"].includes(tokens[index])) {
        assert.match(tokens[index + 1] ?? "", /^\d+$/u, `${label}: xargs max-args must be bounded`);
        index += 2;
        continue;
      }
      assert.fail(`${label}: unsupported xargs wrapper option ${tokens[index]}`);
    }
  }
  return tokens.slice(index);
}

function unwrapPackageRunner(tokens, label) {
  const executable = path.posix.basename((tokens[0] ?? "").replaceAll("\\", "/"));
  if (executable === "npx" || executable === "bunx") return stripRunnerOptions(tokens.slice(1), label);
  if (executable === "npm") {
    if (!["exec", "x"].includes(tokens[1])) {
      if (tokens.slice(1).some((token) => isOpenClawLauncher(token))) assert.fail(`${label}: unsupported npm OpenClaw runner`);
      return tokens;
    }
    return stripRunnerOptions(tokens.slice(2), label);
  }
  if (executable === "pnpm") {
    const runner = ["exec", "dlx", "x"].includes(tokens[1]);
    if (!runner && !isOpenClawLauncher(tokens[1])) return tokens;
    const offset = runner ? 2 : 1;
    return stripRunnerOptions(tokens.slice(offset), label);
  }
  if (executable === "bun") {
    if (tokens[1] !== "x") {
      if (tokens.slice(1).some((token) => isOpenClawLauncher(token))) assert.fail(`${label}: unsupported bun OpenClaw runner`);
      return tokens;
    }
    return stripRunnerOptions(tokens.slice(2), label);
  }
  return tokens;
}

function stripRunnerOptions(tokens, label) {
  let index = 0;
  while (tokens[index] === "--" || tokens[index] === "--yes" || tokens[index] === "-y") index += 1;
  assert.equal(typeof tokens[index], "string", `${label}: package runner executable is missing`);
  const result = tokens.slice(index);
  if (result[1] === "--") result.splice(1, 1);
  return result;
}

function isCanonicalPreflight(tokens) {
  const command = unwrapLeadingShellWrappers(tokens, "preflight");
  if (command.length < 4) return false;
  const executable = command[0] === "node" ? command[1] : command[0];
  const offset = command[0] === "node" ? 2 : 1;
  return ["./bin/agentmo.js", "bin/agentmo.js", "agentmo"].includes(executable)
    && command[offset] === "runtime-check"
    && command[offset + 1] === "--target"
    && command[offset + 2] === "openclaw";
}

function isAgentMoCommand(tokens) {
  const executable = tokens[0] === "node" ? tokens[1] : tokens[0];
  return ["./bin/agentmo.js", "bin/agentmo.js", "agentmo"].includes(executable);
}

function isAssignment(token) {
  return typeof token === "string" && /^[A-Za-z_][A-Za-z0-9_]*=/u.test(token);
}

function isOpenClawLauncher(token) {
  if (typeof token !== "string") return false;
  if (["$OPENCLAW_BIN", "${OPENCLAW_BIN}"].includes(token)) return true;
  return ["openclaw", "run_openclaw"].includes(path.posix.basename(token.replaceAll("\\", "/")));
}

function isLiveSmokeLauncher(token) {
  return typeof token === "string" && /(?:^|\/)scripts\/openclaw-live-smoke\.sh$/u.test(token.replace(/^\.\//u, ""));
}

function isGeneratedSetupEffect(tokens) {
  if (tokens.length === 1 && isAssignment(tokens[0])) return true;
  if (tokens[0] === "export" && tokens.slice(1).every(isAssignment)) return true;
  if (tokens[0] === "mkdir" && tokens[1] === "-p") return true;
  if (!isAgentMoCommand(tokens)) return false;
  const offset = tokens[0] === "node" ? 2 : 1;
  return ["run-plan", "run", "replay-run", "scaffold"].includes(tokens[offset]);
}

function isOpenClawAgentMoMutation(tokens) {
  if (!isAgentMoCommand(tokens)) return false;
  const offset = tokens[0] === "node" ? 2 : 1;
  const command = tokens[offset];
  if (command === "scaffold") {
    const targetIndex = tokens.indexOf("--target", offset + 1);
    return targetIndex !== -1 && tokens[targetIndex + 1] === "openclaw";
  }
  return ["run", "replay-run"].includes(command) && tokens.includes("--live");
}

function generatedEffectKey(tokens) {
  if (tokens.length === 1 && isAssignment(tokens[0])) return "shell-assignment";
  if (tokens[0] === "export") return "shell-export";
  if (tokens[0] === "mkdir") return "mkdir";
  const offset = tokens[0] === "node" ? 2 : 1;
  return `agentmo:${tokens[offset] ?? "unknown"}`;
}

function operandForSubject(invocation, command, subject) {
  let flag = SUBJECT_OPTION_FLAGS[subject] ?? null;
  if (flag !== null && !invocation.includes(flag)) flag = null;
  if (subject === "run-state" && invocation.includes("--run-state")) flag = "--run-state";
  if (subject === "run-index" && invocation.includes("--run-index")) flag = "--run-index";
  if (flag !== null) return optionValue(invocation, flag);
  if (command === "migrate") {
    const ordinal = Number.parseInt(subject.slice("migration-input-".length), 10);
    return positionalOperands(invocation).at(ordinal) ?? null;
  }
  return positionalOperands(invocation).at(0) ?? null;
}

function optionValue(invocation, flag) {
  const match = new RegExp(`${escapeRegExp(flag)}\\s+(?:"([^"]+)"|'([^']+)'|([^\\s]+))`, "u").exec(invocation);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function positionalOperands(invocation) {
  const commandMatch = COMMAND_START.exec(invocation);
  if (!commandMatch) return [];
  const remainder = invocation.slice(commandMatch[0].length).trim();
  const values = [];
  for (const match of remainder.matchAll(/(?:^|\s)(?:"([^"]+)"|'([^']+)'|([^\s]+))/gu)) {
    const value = match[1] ?? match[2] ?? match[3];
    if (value.startsWith("--")) break;
    values.push(value);
  }
  return values;
}

function extractAgentMoInvocations(shellSource) {
  return shellSource
    .replace(/\\\r?\n\s*/gu, " ")
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter((line) => COMMAND_START.test(line));
}

function extractShellBlocks(markdown, relativeFile) {
  const blocks = [];
  const pattern = /^```(?:bash|sh|shell)\s*\n([\s\S]*?)^```\s*$/gmu;
  for (const match of markdown.matchAll(pattern)) {
    const line = markdown.slice(0, match.index).split(/\r?\n/u).length;
    blocks.push({ source: match[1], label: `${relativeFile}:${line}` });
  }
  return blocks;
}

async function markdownFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(child)));
    else if (entry.isFile() && path.extname(entry.name) === ".md") files.push(child);
  }
  return files;
}

function normalizePath(value) {
  return value.split(path.sep).join("/");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
