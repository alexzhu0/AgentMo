import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  DURABLE_COMMAND_SUBJECTS,
  OPTIONAL_DURABLE_COMMAND_SUBJECTS,
  renderDigestBindings,
  subjectsForCommand,
} from "../src/artifact-subjects.js";
import { digestRawBytes, loadAdmittedArtifact } from "../src/artifact-admission.js";
import { draftBlueprint } from "../src/blueprint-draft.js";
import { buildHandoffPackage } from "../src/handoff.js";
import { buildTargetFiles } from "../src/scaffold-files.js";
import { admitBlueprint } from "./helpers/admitted-blueprint.js";

const SUPPORT_BLUEPRINT = new URL("../examples/support-triage.agentmo.json", import.meta.url);
const WIN9_BLUEPRINT = new URL("../examples/win9.agentmo.json", import.meta.url);
const SUPPORT_DISCOVERY_DB = new URL("../examples/fixtures/support-triage/prebuilt-discovery-db.json", import.meta.url);
const SUPPORT_USER_NEED = new URL("../examples/support-triage.need.json", import.meta.url);
const LIVE_SMOKE_SCRIPT = fileURLToPath(new URL("../scripts/openclaw-live-smoke.sh", import.meta.url));

describe("durable command subjects", () => {
  it("defines one deeply frozen authority for Discover, Plan, and Produce-entry commands", () => {
    assert.equal(Object.isFrozen(DURABLE_COMMAND_SUBJECTS), true);
    assert.deepEqual(Object.keys(DURABLE_COMMAND_SUBJECTS), [
      "discover-report",
      "discover-pack",
      "discover-live",
      "discover-workspace",
      "agent-idea-candidate-report",
      "discovery-approve",
      "need-report",
      "decision-ledger",
      "design-plan",
      "blueprint-draft",
      "build-contract",
      "plan-approve",
      "openclaw-target-describe",
      "openclaw-target-admit",
      "package-produce",
      "package-inspect",
      "openclaw-probe",
      "validate",
      "report",
      "plan",
      "handoff",
      "run-plan",
      "run",
      "run-report",
      "replay-run",
      "run-eval",
      "birth-report",
      "domain-eval",
      "delivery-report",
      "observe-run",
      "observe",
      "status",
      "scaffold",
    ]);
    for (const command of ["discover-report", "discover-pack", "discover-live", "discover-workspace"]) {
      assert.deepEqual(DURABLE_COMMAND_SUBJECTS[command], ["discovery-manifest"]);
      assert.equal(Object.isFrozen(DURABLE_COMMAND_SUBJECTS[command]), true);
      assert.equal(subjectsForCommand(command), DURABLE_COMMAND_SUBJECTS[command]);
    }
    assert.deepEqual(DURABLE_COMMAND_SUBJECTS["discovery-approve"], ["discovery-manifest", "discovery-db"]);
    assert.deepEqual(DURABLE_COMMAND_SUBJECTS["agent-idea-candidate-report"], [
      "agent-idea-candidate",
      "discovery-db",
    ]);
    assert.deepEqual(DURABLE_COMMAND_SUBJECTS["design-plan"], [
      "discovery-manifest",
      "discovery-db",
      "discovery-approval",
      "user-need",
      "decision-ledger",
    ]);
    assert.deepEqual(DURABLE_COMMAND_SUBJECTS["decision-ledger"], ["decision-entry"]);
    assert.deepEqual(DURABLE_COMMAND_SUBJECTS["build-contract"], [
      "blueprint",
      "design-plan",
      "discovery-approval",
      "decision-ledger",
      "openclaw-target-descriptor",
    ]);
    assert.deepEqual(DURABLE_COMMAND_SUBJECTS["plan-approve"], [
      "blueprint",
      "build-contract",
    ]);
    assert.deepEqual(DURABLE_COMMAND_SUBJECTS["openclaw-target-admit"], [
      "blueprint",
      "build-contract",
      "plan-approval",
      "openclaw-target-descriptor",
      "target-executable",
      "target-package-json",
      "target-build-info",
    ]);
    assert.deepEqual(DURABLE_COMMAND_SUBJECTS["openclaw-target-describe"], [
      "target-executable",
      "target-package-json",
      "target-build-info",
    ]);
    assert.deepEqual(DURABLE_COMMAND_SUBJECTS["package-produce"], [
      "blueprint",
      "design-plan",
      "discovery-approval",
      "decision-ledger",
      "build-contract",
      "plan-approval",
      "openclaw-target-descriptor",
      "openclaw-target-carrier-admission",
    ]);
    assert.deepEqual(DURABLE_COMMAND_SUBJECTS["package-inspect"], ["package-manifest"]);
    assert.equal(Object.isFrozen(DURABLE_COMMAND_SUBJECTS["design-plan"]), true);
    assert.equal(subjectsForCommand("design-plan"), DURABLE_COMMAND_SUBJECTS["design-plan"]);
    assert.deepEqual(DURABLE_COMMAND_SUBJECTS["need-report"], ["user-need"]);
    assert.deepEqual(DURABLE_COMMAND_SUBJECTS["blueprint-draft"], ["discovery-db", "user-need"]);
    assert.deepEqual(DURABLE_COMMAND_SUBJECTS["run-plan"], ["blueprint"]);
    assert.deepEqual(DURABLE_COMMAND_SUBJECTS.run, ["runtime-plan"]);
    assert.deepEqual(DURABLE_COMMAND_SUBJECTS["run-report"], ["run-state"]);
    assert.deepEqual(DURABLE_COMMAND_SUBJECTS["replay-run"], ["run-state"]);
    assert.deepEqual(DURABLE_COMMAND_SUBJECTS["run-eval"], ["run-state"]);
    assert.deepEqual(DURABLE_COMMAND_SUBJECTS["birth-report"], ["blueprint", "build-state", "run-state", "run-eval"]);
    assert.deepEqual(DURABLE_COMMAND_SUBJECTS["domain-eval"], ["blueprint", "domain-cases"]);
    assert.deepEqual(
      DURABLE_COMMAND_SUBJECTS["delivery-report"],
      ["blueprint", "build-state", "run-state", "run-eval", "birth-report"],
    );
    assert.deepEqual(DURABLE_COMMAND_SUBJECTS["observe-run"], ["run-state"]);
    assert.deepEqual(DURABLE_COMMAND_SUBJECTS.observe, ["observation"]);
    for (const command of [
      "run-plan",
      "run",
      "run-report",
      "replay-run",
      "run-eval",
      "birth-report",
      "domain-eval",
      "delivery-report",
      "observe-run",
      "observe",
    ]) {
      assert.equal(Object.isFrozen(DURABLE_COMMAND_SUBJECTS[command]), true);
      assert.equal(subjectsForCommand(command), DURABLE_COMMAND_SUBJECTS[command]);
    }
    for (const command of ["validate", "report", "plan", "handoff", "status", "scaffold"]) {
      assert.deepEqual(DURABLE_COMMAND_SUBJECTS[command], ["blueprint"]);
      assert.equal(Object.isFrozen(DURABLE_COMMAND_SUBJECTS[command]), true);
      assert.equal(subjectsForCommand(command), DURABLE_COMMAND_SUBJECTS[command]);
    }
    assert.deepEqual(subjectsForCommand("plan"), ["blueprint"]);
    assert.deepEqual(subjectsForCommand("design-plan"), [
      "discovery-manifest",
      "discovery-db",
      "discovery-approval",
      "user-need",
      "decision-ledger",
    ]);
    assert.deepEqual(OPTIONAL_DURABLE_COMMAND_SUBJECTS["blueprint-draft"], ["design-plan"]);
    assert.deepEqual(OPTIONAL_DURABLE_COMMAND_SUBJECTS["build-contract"], [
      "native-plugin-recipe",
    ]);
    assert.deepEqual(OPTIONAL_DURABLE_COMMAND_SUBJECTS.report, ["discovery-manifest"]);
    assert.deepEqual(OPTIONAL_DURABLE_COMMAND_SUBJECTS.run, ["run-index"]);
    assert.deepEqual(OPTIONAL_DURABLE_COMMAND_SUBJECTS["replay-run"], ["run-index"]);
    assert.deepEqual(OPTIONAL_DURABLE_COMMAND_SUBJECTS["delivery-report"], ["domain-eval"]);
    assert.deepEqual(OPTIONAL_DURABLE_COMMAND_SUBJECTS.status, ["build-state", "run-state", "run-index"]);
    assert.equal(Object.isFrozen(OPTIONAL_DURABLE_COMMAND_SUBJECTS), true);
    assert.equal(Object.isFrozen(OPTIONAL_DURABLE_COMMAND_SUBJECTS["blueprint-draft"]), true);
    assert.deepEqual(
      subjectsForCommand("blueprint-draft", { includeOptionalSubjects: ["design-plan"] }),
      ["discovery-db", "user-need", "design-plan"],
    );
    assert.deepEqual(
      subjectsForCommand("status", { includeOptionalSubjects: ["build-state"] }),
      ["blueprint", "build-state"],
    );
    assert.deepEqual(
      subjectsForCommand("status", { includeOptionalSubjects: ["run-index"] }),
      ["blueprint", "run-index"],
    );
    assert.deepEqual(subjectsForCommand("status"), ["blueprint"]);
    assert.deepEqual(
      subjectsForCommand("run", { includeOptionalSubjects: ["run-index"] }),
      ["runtime-plan", "run-index"],
    );
    assert.deepEqual(
      subjectsForCommand("replay-run", { includeOptionalSubjects: ["run-index"] }),
      ["run-state", "run-index"],
    );
    assert.deepEqual(
      subjectsForCommand("report", { includeOptionalSubjects: ["discovery-manifest"] }),
      ["blueprint", "discovery-manifest"],
    );
    assert.deepEqual(
      subjectsForCommand("delivery-report", { includeOptionalSubjects: ["domain-eval"] }),
      ["blueprint", "build-state", "run-state", "run-eval", "birth-report", "domain-eval"],
    );
    const migrationSubjects = subjectsForCommand("migrate", { inputCount: 3 });
    assert.deepEqual(migrationSubjects, [
      "migration-input-0",
      "migration-input-1",
      "migration-input-2",
    ]);
    assert.equal(Object.isFrozen(migrationSubjects), true);
    assert.deepEqual(subjectsForCommand("migrate", { inputCount: 1 }), ["migration-input-0"]);
    for (const inputCount of [undefined, 0, -1, 1.5, "2"]) {
      assert.throws(
        () => subjectsForCommand("migrate", { inputCount }),
        (error) => error.code === "AGENTMO_DURABLE_COMMAND_UNSUPPORTED",
      );
    }
    assert.throws(
      () => subjectsForCommand("blueprint-draft", { includeOptionalSubjects: ["user-need"] }),
      (error) => error.code === "AGENTMO_DURABLE_COMMAND_UNSUPPORTED",
    );
    assert.throws(
      () => DURABLE_COMMAND_SUBJECTS["design-plan"].push("blueprint"),
      TypeError,
    );
  });

  it("fails closed for a command without a durable subject contract", () => {
    assert.throws(
      () => subjectsForCommand("private-command-canary"),
      (error) => {
        assert.equal(error.code, "AGENTMO_DURABLE_COMMAND_UNSUPPORTED");
        assert.equal(error.message.includes("private-command-canary"), false);
        return true;
      },
    );
  });

  it("renders exact-byte digest bindings in production-registry order", () => {
    const rendered = renderDigestBindings("birth-report", {
      blueprint: "$BLUEPRINT",
      "build-state": "$BUILD_STATE",
      "run-state": "$RUN_STATE",
      "run-eval": "$RUN_EVAL",
    });
    const bindings = parseDigestBindings(rendered);

    assert.deepEqual(
      bindings.map((binding) => binding.subject),
      subjectsForCommand("birth-report"),
    );
    assert.deepEqual(
      bindings.map((binding) => binding.fileExpression),
      ["$BLUEPRINT", "$BUILD_STATE", "$RUN_STATE", "$RUN_EVAL"],
    );
    for (const binding of bindings) {
      assert.match(binding.nodeSource, /createHash\("sha256"\)/u);
      assert.match(binding.nodeSource, /readFileSync\(process\.argv\[1\]\)/u);
      assert.doesNotMatch(binding.nodeSource, /JSON\.parse/u);
    }
  });

  it("uses the production resolver for optional and ordinal subject contracts", () => {
    assert.deepEqual(
      parseDigestBindings(renderDigestBindings("status", {
        blueprint: "$BLUEPRINT",
        "run-state": "$RUN_STATE",
      })).map((binding) => binding.subject),
      subjectsForCommand("status", { includeOptionalSubjects: ["run-state"] }),
    );
    assert.deepEqual(
      parseDigestBindings(renderDigestBindings("delivery-report", {
        blueprint: "$BLUEPRINT",
        "build-state": "$BUILD_STATE",
        "run-state": "$RUN_STATE",
        "run-eval": "$RUN_EVAL",
        "birth-report": "$BIRTH_REPORT",
        "domain-eval": "$DOMAIN_EVAL",
      })).map((binding) => binding.subject),
      subjectsForCommand("delivery-report", { includeOptionalSubjects: ["domain-eval"] }),
    );
    assert.deepEqual(
      parseDigestBindings(renderDigestBindings("migrate", {
        "migration-input-0": "$INPUT_0",
        "migration-input-1": "$INPUT_1",
      })).map((binding) => binding.subject),
      subjectsForCommand("migrate", { inputCount: 2 }),
    );

    for (const [command, bindings] of [
      ["validate", {}],
      ["validate", { blueprint: "$BLUEPRINT", extra: "$EXTRA" }],
      ["migrate", { "migration-input-1": "$INPUT_1" }],
      ["private-command-canary", { blueprint: "$BLUEPRINT" }],
    ]) {
      assert.throws(
        () => renderDigestBindings(command, bindings),
        (error) => error?.code === "AGENTMO_DURABLE_COMMAND_UNSUPPORTED",
      );
    }
  });

  it("mechanically checks generated and scripted invocations against the production registry", async () => {
    const admission = await admitBlueprint(SUPPORT_BLUEPRINT);
    const win9Admission = await admitBlueprint(WIN9_BLUEPRINT);
    const discoveryDbAdmission = await admitArtifact(SUPPORT_DISCOVERY_DB, "discovery-db");
    const userNeedAdmission = await admitArtifact(SUPPORT_USER_NEED, "user-need");
    const generatedBlueprint = draftBlueprint(discoveryDbAdmission.value, userNeedAdmission.value, {
      target: "openclaw",
      admissions: { discoveryDb: discoveryDbAdmission, userNeed: userNeedAdmission },
    });
    const scaffoldRunbook = buildTargetFiles(admission.value, "openclaw").get("openclaw/RUNBOOK.md");
    const openClawHandoff = await buildHandoffPackage(admission.value, {
      target: "openclaw",
      admission,
    });
    const agentMoHandoff = await buildHandoffPackage(admission.value, {
      target: "agentmo",
      admission,
    });
    const liveSmoke = await readFile(LIVE_SMOKE_SCRIPT, "utf8");
    const corpora = [
      ["scaffold-runbook", extractBashInvocations(scaffoldRunbook)],
      ["openclaw-handoff", extractCommandInvocations(openClawHandoff.handoff.commands)],
      ["openclaw-generated-markdown", extractPackageMarkdownInvocations(openClawHandoff)],
      ["agentmo-handoff", extractCommandInvocations(agentMoHandoff.handoff.commands)],
      ["agentmo-generated-markdown", extractPackageMarkdownInvocations(agentMoHandoff)],
      ["blueprint-runtime-profile", generatedBlueprint.runtime_profiles.flatMap((profile) => (
        extractCommandInvocations(profile.verification_commands)
      ))],
      ["blueprint-pipeline", extractCommandInvocations(generatedBlueprint.pipeline.produce.verification_steps)],
      ["win9-runtime-profile", win9Admission.value.runtime_profiles.flatMap((profile) => (
        extractCommandInvocations(profile.verification_commands)
      ))],
      ["live-smoke", extractShellInvocations(liveSmoke)],
    ];

    assert.equal(corpora.every(([, invocations]) => invocations.length > 0), true);
    for (const [corpus, invocations] of corpora) {
      for (const invocation of invocations) assertInvocationContract(invocation, corpus);
    }

    const valid = `agentmo validate "<blueprint.json>" ${renderDigestBindings("validate", {
      blueprint: "<blueprint.json>",
    })}`;
    const duplicate = `${valid} ${renderDigestBindings("validate", {
      blueprint: "<blueprint.json>",
    })}`;
    assert.throws(() => assertInvocationContract(duplicate, "duplicate-canary"), assert.AssertionError);
    assert.throws(
      () => assertInvocationContract('agentmo private-command-canary "<artifact.json>"', "unknown-canary"),
      (error) => error?.code === "AGENTMO_DURABLE_COMMAND_UNSUPPORTED",
    );
    assert.doesNotThrow(() => assertInvocationContract(
      "agentmo runtime-check --target openclaw",
      "zero-subject-canary",
    ));
  });
});

const SUBJECT_OPTION_FLAGS = Object.freeze({
  "birth-report": "--birth-report",
  "build-state": "--build-state",
  "decision-entry": "--entry",
  "decision-ledger": "--decision-ledger",
  "design-plan": "--design-plan",
  "discovery-approval": "--discovery-approval",
  "discovery-db": "--discovery-db",
  "domain-cases": "--cases",
  "domain-eval": "--domain-eval",
  "run-eval": "--run-eval",
  "user-need": "--need",
});

function parseDigestBindings(commandText) {
  const pattern = /--digest "([a-z0-9-]+)=\$\((?:(?:node -e '([^']+)')|(digest_file)) "([^"\n]+)"\)"/gu;
  return Array.from(commandText.matchAll(pattern), (match) => ({
    text: match[0],
    subject: match[1],
    nodeSource: match[2] ?? null,
    helper: match[3] ?? null,
    fileExpression: match[4],
  }));
}

function assertInvocationContract(invocation, corpus) {
  const commandMatch = /^(?:node \.\/bin\/agentmo\.js|agentmo)\s+([a-z][a-z0-9-]*)\b/u.exec(invocation);
  assert.ok(commandMatch, `${corpus}: invocation must have a supported executable form`);
  const command = commandMatch[1];
  const bindings = parseDigestBindings(invocation);
  if (command === "runtime-check") {
    assert.match(
      invocation,
      /^(?:node \.\/bin\/agentmo\.js|agentmo)\s+runtime-check\s+--target\s+(?:"openclaw"|'openclaw'|openclaw)(?:\s+&&)?$/u,
      `${corpus}: runtime-check contract drifted`,
    );
    assert.deepEqual(bindings, [], `${corpus}: runtime-check must remain zero-subject`);
    return;
  }
  const subjects = bindings.map((binding) => binding.subject);
  const optional = OPTIONAL_DURABLE_COMMAND_SUBJECTS[command] ?? [];
  const resolverOptions = command === "migrate"
    ? { inputCount: subjects.length }
    : { includeOptionalSubjects: subjects.filter((subject) => optional.includes(subject)) };
  const expected = subjectsForCommand(command, resolverOptions);
  assert.deepEqual(subjects, expected, `${corpus}: ${command} digest subjects drifted`);
  assert.equal(new Set(subjects).size, subjects.length, `${corpus}: ${command} repeats a subject`);

  let operands = invocation;
  for (const binding of bindings) {
    operands = operands.replace(binding.text, "");
    assert.equal(
      binding.helper === "digest_file" || binding.nodeSource?.includes("readFileSync(process.argv[1])"),
      true,
      `${corpus}: ${command}/${binding.subject} must hash exact file bytes`,
    );
  }
  const primary = /^(?:node \.\/bin\/agentmo\.js|agentmo)\s+[a-z][a-z0-9-]*\s+"([^"\n]+)"/u.exec(operands)?.[1];
  for (const binding of bindings) {
    const flag = subjectOperandFlag(binding.subject, operands);
    const operand = flag
      ? new RegExp(`${escapeRegExp(flag)}\\s+"([^"\\n]+)"`, "u").exec(operands)?.[1]
      : primary;
    assert.equal(
      operand,
      binding.fileExpression,
      `${corpus}: ${command}/${binding.subject} digest must read its exact quoted operand`,
    );
  }
}

function subjectOperandFlag(subject, invocation) {
  if (subject === "discovery-manifest" && invocation.includes("--manifest")) return "--manifest";
  if (subject === "run-state" && invocation.includes("--run-state")) return "--run-state";
  if (subject === "run-index" && invocation.includes("--run-index")) return "--run-index";
  return SUBJECT_OPTION_FLAGS[subject] ?? null;
}

function extractBashInvocations(markdown) {
  const blocks = Array.from(markdown.matchAll(/```bash\n([\s\S]*?)```/gu), (match) => match[1]);
  return blocks.flatMap(extractShellInvocations);
}

function extractShellInvocations(shellText) {
  return shellText
    .replace(/\\\r?\n\s*/gu, " ")
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter((line) => /^(?:node \.\/bin\/agentmo\.js|agentmo)\s+[a-z]/u.test(line));
}

function extractCommandInvocations(commands) {
  return commands.filter((command) => /^(?:node \.\/bin\/agentmo\.js|agentmo)\s+[a-z]/u.test(command));
}

function extractInlineMarkdownInvocations(markdown) {
  return Array.from(
    markdown.matchAll(/`((?:node \.\/bin\/agentmo\.js|agentmo)\s+[a-z][^`]*)`/gu),
    (match) => match[1],
  ).filter((invocation) => invocation.trim().split(/\s+/u).length > 2);
}

function extractPackageMarkdownInvocations(handoffPackage) {
  return handoffPackage.files
    .filter((file) => file.relativePath.endsWith(".md"))
    .flatMap((file) => extractInlineMarkdownInvocations(file.content));
}

async function admitArtifact(file, subject) {
  const bytes = await readFile(file);
  return loadAdmittedArtifact({ filePath: file, subject, expectedDigest: digestRawBytes(bytes) });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
