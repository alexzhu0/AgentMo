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
    assert.match(script, /WORKSPACE="\$\(mktemp -d "\/tmp\/agentmo-openclaw-workspace-/u);
    assert.match(script, /RUN_OUT="\$\(mktemp -d "\/tmp\/agentmo-openclaw-runs-/u);
    assert.match(script, /--openclaw-state-dir "\$OPENCLAW_STATE_DIR"/u);
    assert.match(script, /--channel local-cli/u);
    assert.match(script, /--transport local/u);
    assert.match(script, /--live/u);
    assert.match(script, /node \.\/bin\/agentmo\.js status "\$BLUEPRINT" --run-dir "\$RUN_OUT" --json/u);
  });
});
