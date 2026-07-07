import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/openclaw-live-smoke.sh", import.meta.url));

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
    assert.match(script, /local env_args=\(env -i OPENCLAW_STATE_DIR="\$OPENCLAW_STATE_DIR"\)/u);
    assert.match(script, /for proxy_key in HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy/u);
    assert.match(script, /env_args\+=\("\$proxy_key=\$\{!proxy_key\}"\)/u);
    assert.match(script, /DEEPSEEK_API_KEY/u);
    assert.match(script, /THINKING="off"/u);
    assert.match(script, /Invalid --timeout-ms/u);
    assert.match(script, /--env-file "\$EFFECTIVE_ENV_FILE"/u);
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
    assert.match(script, /node \.\/bin\/agentmo\.js run-report "\$RUN_STATE" --json >"\$RUN_REPORT"/u);
    assert.match(script, /node \.\/bin\/agentmo\.js run-eval "\$RUN_STATE" --expect-status success --json >"\$RUN_EVAL"/u);
    assert.match(script, /RUN_EVAL_EXIT=\$\\?/u);
    assert.match(script, /node \.\/bin\/agentmo\.js status "\$BLUEPRINT" --run-dir "\$RUN_OUT" --json >"\$RUN_STATUS"/u);
    assert.match(script, /JSON\.stringify\(summary, null, 2\)/u);
    assert.match(script, /runEvalExitCode: parseInteger\(process\.env\.RUN_EVAL_EXIT/u);
    assert.match(script, /cleanup_runtime_artifacts/u);
    assert.match(script, /rm -rf "\$OPENCLAW_STATE_DIR"/u);
    assert.match(script, /--keep-state/u);
  });
});
