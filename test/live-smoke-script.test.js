import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildLiveSmokeScrubReport,
  buildLiveSmokeSummary,
  persistLiveSmokeCandidate,
} from "../scripts/live-smoke-summary.js";

const SCRIPT = fileURLToPath(new URL("../scripts/openclaw-live-smoke.sh", import.meta.url));
const SUMMARY_HELPER = fileURLToPath(new URL("../scripts/live-smoke-summary.js", import.meta.url));
const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SYNTHETIC_DIGEST = `sha256:${"a".repeat(64)}`;

function runShellSyntaxCheck() {
  return new Promise((resolve) => {
    const child = spawn("bash", ["-n", SCRIPT], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

describe("OpenClaw live smoke helper", () => {
  it("runs one canonical runtime preflight after argument validation and before every shell effect", async () => {
    const script = await readFile(SCRIPT, "utf8");
    const preflight = "node ./bin/agentmo.js runtime-check --target openclaw";

    assert.equal(countOccurrences(script, preflight), 1);
    assertOrdered(script, [
      'if [[ ! "$TIMEOUT_MS" =~ ^[1-9][0-9]*$ ]]',
      'if [[ "$TRANSPORT" != "local" && "$TRANSPORT" != "gateway" ]]',
      preflight,
      'if [[ -z "$ENV_FILE" && -f .env ]]',
      'DEEPSEEK_API_KEY="$(read_env_key DEEPSEEK_API_KEY "$ENV_FILE")"',
      'RUN_ID="$(date +%Y%m%dT%H%M%S)-${AGENT}-live"',
      'OPENCLAW_STATE_DIR="$(mktemp -d ',
      'node ./bin/agentmo.js scaffold "$BLUEPRINT"',
      'run_openclaw agents add "$AGENT"',
      'run_openclaw gateway run --port "$GATEWAY_PORT"',
    ]);
    assert.doesNotMatch(script, /OPENCLAW_TARGET_NODE_RANGE|22\.19\.0|23\.11\.0/u);
    assert.doesNotMatch(
      script,
      /(?:runtimeVersion|nodeVersion|versionProvider|runtimeCompatibilityProvider|skipRuntimeCheck|bypassRuntimeCheck|runtimeOverride)/u,
    );
  });

  it("stops an unsupported runtime after only the bounded preflight process", async (t) => {
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), "agentmo-live-smoke-runtime-reject-"));
    t.after(() => rm(fixtureRoot, { force: true, recursive: true }));
    const stubBin = path.join(fixtureRoot, "bin");
    const effectsRoot = path.join(fixtureRoot, "effects");
    await Promise.all([
      mkdir(stubBin),
      mkdir(effectsRoot),
    ]);

    await writeExecutable(path.join(stubBin, "node"), `#!/bin/sh
printf '%s\n' 'raw runtime diagnostic at /private/fixture/path' >&2
exit 86
`);
    for (const command of ["date", "git", "mktemp", "openclaw", "pnpm"]) {
      await writeExecutable(path.join(stubBin, command), `#!/bin/sh
printf '%s\n' unexpected > "$AGENTMO_TEST_EFFECTS_ROOT/${command}"
exit 97
`);
    }

    const result = await runRejectedRuntimeFixture({
      env: {
        ...process.env,
        AGENTMO_TEST_EFFECTS_ROOT: effectsRoot,
        PATH: `${stubBin}:/usr/bin:/bin`,
      },
      envFile: path.join(fixtureRoot, "must-not-be-read.fixture"),
    });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "OpenClaw runtime preflight rejected the current Node.js process.\n");
    assert.deepEqual(await readdir(effectsRoot), []);
  });

  it("stays optional and isolated by default", async () => {
    const script = await readFile(SCRIPT, "utf8");
    const mode = (await stat(SCRIPT)).mode;
    const syntax = await runShellSyntaxCheck();

    assert.equal(syntax.code, 0, syntax.stderr);
    assert.notEqual(mode & 0o111, 0);
    assert.match(script, /OPENCLAW_STATE_DIR="\$\(mktemp -d "\/tmp\/agentmo-openclaw-state-/u);
    assert.match(script, /SCAFFOLD_ROOT="\$\(mktemp -d "\/tmp\/agentmo-openclaw-workspace-/u);
    assert.match(script, /WORKSPACE="\$SCAFFOLD_ROOT\/openclaw\/workspace"/u);
    assert.match(script, /RUN_OUT="\$\(mktemp -d "\/tmp\/agentmo-openclaw-runs-/u);
    assert.match(script, /git check-ignore -q -- "\$ENV_FILE"/u);
    assert.doesNotMatch(script, /set -a/u);
    assert.match(script, /read_env_key\(\)/u);
    assert.match(script, /digest_file\(\)/u);
    assert.match(script, /createHash\("sha256"\)/u);
    assert.match(script, /readFileSync\(process\.argv\[1\]\)/u);
    assert.doesNotMatch(script, /JSON\.parse/u);
    assert.match(script, /local env_args=\(env -i OPENCLAW_STATE_DIR="\$OPENCLAW_STATE_DIR"\)/u);
    assert.match(script, /for proxy_key in HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy/u);
    assert.match(script, /env_args\+=\("\$proxy_key=\$\{!proxy_key\}"\)/u);
    assert.match(script, /DEEPSEEK_API_KEY/u);
    assert.match(script, /THINKING="off"/u);
    assert.match(script, /Invalid --timeout-ms/u);
    assert.match(script, /ENV_ARGS=\(--runtime-env-file "\$EFFECTIVE_ENV_FILE"\)/u);
    assert.doesNotMatch(script, /ENV_ARGS=\(--env-file\b/u);
    assert.match(script, /OPENCLAW_GATEWAY_TOKEN=.*randomBytes/u);
    assert.match(script, /OPENCLAW_GATEWAY_URL="\$GATEWAY_URL"/u);
    assert.match(script, /OPENCLAW_GATEWAY_PORT="\$GATEWAY_PORT"/u);
    assert.match(script, /printf 'OPENCLAW_GATEWAY_URL=%s\\n' "\$OPENCLAW_GATEWAY_URL"/u);
    assert.match(script, /printf 'OPENCLAW_GATEWAY_PORT=%s\\n' "\$OPENCLAW_GATEWAY_PORT"/u);
    assert.match(script, /run_openclaw gateway run --port "\$GATEWAY_PORT" --bind loopback --auth token --allow-unconfigured --dev/u);
    assert.match(script, /kill "\$GATEWAY_PID"/u);
    assert.match(script, /--openclaw-state-dir "\$OPENCLAW_STATE_DIR"/u);
    assert.match(script, /--channel local-cli/u);
    assert.match(script, /--transport "\$TRANSPORT"/u);
    assert.match(script, /--thinking "\$THINKING"/u);
    assert.match(script, /--timeout-ms "\$TIMEOUT_MS"/u);
    assert.match(script, /--live/u);
    assert.match(script, /node \.\/bin\/agentmo\.js scaffold "\$BLUEPRINT" --digest "blueprint=\$\(digest_file "\$BLUEPRINT"\)"/u);
    assert.match(script, /node \.\/bin\/agentmo\.js run-plan "\$BLUEPRINT"[\s\S]+--digest "blueprint=\$\(digest_file "\$BLUEPRINT"\)"/u);
    assert.match(script, /node \.\/bin\/agentmo\.js run "\$RUNTIME_PLAN"[\s\S]+--digest "runtime-plan=\$\(digest_file "\$RUNTIME_PLAN"\)"/u);
    assert.doesNotMatch(script, /node \.\/bin\/agentmo\.js run "\$BLUEPRINT"/u);
    assert.match(script, /node \.\/bin\/agentmo\.js run-report "\$RUN_STATE" --digest "run-state=\$\(digest_file "\$RUN_STATE"\)" --json >"\$RUN_REPORT"/u);
    assert.match(script, /node \.\/bin\/agentmo\.js run-eval "\$RUN_STATE" --digest "run-state=\$\(digest_file "\$RUN_STATE"\)" --expect-status success --json >"\$RUN_EVAL"/u);
    assert.match(script, /RUN_EVAL_EXIT=\$\\?/u);
    assert.match(script, /node \.\/bin\/agentmo\.js status "\$BLUEPRINT" --digest "blueprint=\$\(digest_file "\$BLUEPRINT"\)" --digest "run-state=\$\(digest_file "\$RUN_STATE"\)" --run-state "\$RUN_STATE" --json >"\$RUN_STATUS"/u);
    assert.match(script, /node \.\/scripts\/live-smoke-summary\.js scrub/u);
    assert.match(script, /node \.\/scripts\/live-smoke-summary\.js summary/u);
    assert.match(script, /BLUEPRINT_DIGEST="\$\(digest_file "\$BLUEPRINT"\)"/u);
    assert.match(script, /RUN_STATE_DIGEST="\$\(digest_file "\$RUN_STATE"\)"/u);
    assert.match(script, /SCRUB_REPORT_DIGEST="\$\(digest_file "\$SCRUB_REPORT"\)"/u);
    assert.doesNotMatch(script, /fs\.writeFileSync/u);
    assert.doesNotMatch(script, /cat "\$SUMMARY_FILE"/u);
    const summaryInvocation = /OUTPUT_FILE="\$SUMMARY_FILE"[\s\S]+?node \.\/scripts\/live-smoke-summary\.js summary/u.exec(script)?.[0];
    assert.ok(summaryInvocation);
    assert.doesNotMatch(
      summaryInvocation,
      /^(?:BLUEPRINT|WORKSPACE|RUN_OUT|RUN_STATE|RUN_REPORT|RUN_EVAL|RUN_STATUS|SCRUB_REPORT|GATEWAY_URL)=/mu,
    );
    assert.match(script, /GATEWAY_LOG="\$OPENCLAW_STATE_DIR\/openclaw-gateway\.log"/u);
    assert.match(script, />"\$OPENCLAW_STATE_DIR\/openclaw-agent-add\.json"/u);
    assert.doesNotMatch(script, /openclaw\s+--version|version-gate|runtime-version/u);
    assert.match(script, /RUN_EVAL_EXIT="\$RUN_EVAL_EXIT"/u);
    assert.match(script, /cleanup_runtime_artifacts/u);
    assert.match(script, /rm -rf "\$OPENCLAW_STATE_DIR"/u);
    assert.match(script, /--keep-state/u);
  });

  it("persists and emits only the same validated path-free summary candidate", async () => {
    const helper = await readFile(SUMMARY_HELPER, "utf8");
    assert.match(helper, /assertPersistable\(candidate/u);
    assert.match(helper, /writePersistableJsonAtomic\(outputFile, candidate/u);
    assert.match(helper, /emitPersistableOutput\(\{/u);
    assert.match(helper, /serializePersistableJson\(value/u);

    const scrub = buildLiveSmokeScrubReport({
      stateAction: "deleted",
      runtimeEnvironmentAction: "not-created",
      gatewayProcessAction: "not-started",
      keepState: false,
    });
    assert.equal(scrub.credentialValuesPersistedByAgentMoEvidence, false);

    const candidate = buildLiveSmokeSummary(validSummaryInput());
    const effects = [];
    let stdout = "";
    await persistLiveSmokeCandidate(candidate, {
      subject: "live-smoke-summary",
      outputFile: "/transient/operator/output.json",
      stdout: true,
      io: {
        mkdir: async () => effects.push("mkdir"),
        writeFile: async (_file, text) => {
          effects.push("writeFile");
          effects.push(text);
        },
        rename: async () => effects.push("rename"),
      },
      sink: async (text) => {
        effects.push("sink");
        stdout += text;
      },
    });

    assert.deepEqual(effects.filter((value) => !value.startsWith?.("{")), ["mkdir", "writeFile", "rename", "sink"]);
    const persisted = effects.find((value) => typeof value === "string" && value.startsWith("{"));
    assert.equal(stdout, persisted);
    assert.deepEqual(JSON.parse(stdout), candidate);
    assert.doesNotMatch(stdout, /(?:\/private\/|\/tmp\/|[A-Za-z]:\\\\)/u);
    assert.doesNotMatch(stdout, /DEEPSEEK_API_KEY|sk-proj-|BEGIN PRIVATE KEY/iu);
  });

  it("rejects host paths and secret-like summary values before file or stdout effects", async () => {
    assert.throws(
      () => buildLiveSmokeSummary({ ...validSummaryInput(), workspacePath: "/private/tmp/ignored" }),
      (error) => error?.code === "AGENTMO_LIVE_SMOKE_SUMMARY_INVALID",
    );

    for (const candidate of [
      { ...buildLiveSmokeSummary(validSummaryInput()), providerId: "/private/tmp/provider" },
      { ...buildLiveSmokeSummary(validSummaryInput()), modelId: "DEEPSEEK_API_KEY=synthetic-value" },
    ]) {
      const effects = [];
      await assert.rejects(
        persistLiveSmokeCandidate(candidate, {
          subject: "live-smoke-summary",
          outputFile: "/transient/operator/output.json",
          stdout: true,
          io: {
            mkdir: async () => effects.push("mkdir"),
            writeFile: async () => effects.push("writeFile"),
            rename: async () => effects.push("rename"),
          },
          sink: async () => effects.push("sink"),
        }),
        (error) => error?.code === "AGENTMO_PERSISTABILITY_SENSITIVE_MATERIAL",
      );
      assert.deepEqual(effects, []);
    }
  });
});

function runRejectedRuntimeFixture(options) {
  return new Promise((resolve) => {
    const child = spawn("/bin/bash", [
      SCRIPT,
      "--provider", "synthetic-provider",
      "--env-file", options.envFile,
    ], {
      cwd: REPOSITORY_ROOT,
      env: options.env,
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

async function writeExecutable(file, source) {
  await writeFile(file, source);
  await chmod(file, 0o755);
}

function countOccurrences(source, marker) {
  return source.split(marker).length - 1;
}

function assertOrdered(source, markers) {
  let previous = -1;
  for (const marker of markers) {
    const current = source.indexOf(marker, previous + 1);
    assert.notEqual(current, -1, `missing ordering marker: ${marker}`);
    assert.equal(current > previous, true, `out-of-order marker: ${marker}`);
    previous = current;
  }
}

function validSummaryInput() {
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
