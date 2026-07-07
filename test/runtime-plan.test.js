import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildRuntimePlan, FRESH_RUN_SESSION_KEY_PLACEHOLDER, RUNTIME_PLAN_SCHEMA_VERSION, RUNTIME_PROXY_ENV_KEYS } from "../src/runtime-plan.js";

async function loadExample() {
  return JSON.parse(await readFile(new URL("../examples/win9.agentmo.json", import.meta.url), "utf8"));
}

describe("runtime plan", () => {
  it("builds deterministic OpenClaw runtime plans without writing files", async () => {
    const blueprint = await loadExample();
    const workspace = await mkdtemp(path.join(tmpdir(), "agentmo-runtime-plan-"));
    const first = buildRuntimePlan(blueprint, { target: "openclaw", workspace, message: "ping" });
    const second = buildRuntimePlan(blueprint, { target: "openclaw", workspace, message: "ping" });

    assert.deepEqual(first, second);
    assert.equal(first.schemaVersion, RUNTIME_PLAN_SCHEMA_VERSION);
    assert.equal(first.agentId, "win9");
    assert.equal(first.target.id, "openclaw");
    assert.equal(first.selectedRuntimeProfileId, "openclaw");
    assert.equal(first.executionSessionPolicy, "fresh-per-run");
    assert.deepEqual(first.runtimeIdentity.selector.routingSelector, { agent: "win9" });
    assert.equal(first.runtimeIdentity.selector.executionSelector.sessionKey, FRESH_RUN_SESSION_KEY_PLACEHOLDER);
    assert.equal(first.runtimeIdentity.selector.executionSelector.generated, true);
    assert.equal(first.runtimeIdentity.provider, null);
    assert.equal(first.runtimeIdentity.model, null);
    assert.equal(first.runtimeIdentity.thinking, null);
    assert.equal(first.runtimeIdentity.runtime, "openclaw");
    assert.equal(first.runtimeIdentity.channel, null);
    assert.equal(first.runtimeIdentity.backend, "openclaw-cli");
    assert.equal(first.runtimeIdentity.transport, "unknown");
    assert.equal(first.runtimeIdentity.fallbackFrom, null);
    assert.equal(first.runtimeIdentity.sandboxScope.workspaceRoot, path.resolve(workspace));
    assert.equal(first.runtimeIdentity.sandboxScope.usesProductionState, false);
    assert.equal(first.runtimeIdentity.sandboxScope.stateDir, null);
    assert.equal(first.command.timeoutMs, 120000);
    assert.equal(first.message.messageMode, "inline");
    assert.equal(first.message.inlineMessage, "ping");
    assert.equal(first.command.executable, "openclaw");
    assert.deepEqual(first.command.args, ["agent", "--json", "--agent", "win9", "--session-key", FRESH_RUN_SESSION_KEY_PLACEHOLDER, "--message", "ping"]);
    assert.equal(first.command.mutatesOpenClawState, false);
    assert.equal(first.certificationBoundary.runEvidenceCertifiesRuntime, false);
    assert.equal(first.unsupportedSurfaces.includes("Runtime certification is not implied by scaffold generation."), true);
    assert.deepEqual(await readdir(workspace), []);
  });

  it("builds source checkout command plans", async () => {
    const blueprint = await loadExample();
    const plan = buildRuntimePlan(blueprint, {
      target: "openclaw",
      workspace: "/tmp/workspace",
      openClawSourceRoot: "/tmp/openclaw-source",
      agent: "win9-main",
      sessionKey: "smoke-session",
      provider: "openai",
      model: "gpt-5.5",
      thinking: "off",
      channel: "local-cli",
      transport: "local",
      fallbackFrom: "pi",
      message: "ping",
    });

    assert.equal(plan.executionSessionPolicy, "operator-supplied");
    assert.equal(plan.runtimeIdentity.provider, "openai");
    assert.equal(plan.runtimeIdentity.model, "gpt-5.5");
    assert.equal(plan.runtimeIdentity.thinking, "off");
    assert.equal(plan.runtimeIdentity.channel, "local-cli");
    assert.equal(plan.runtimeIdentity.transport, "local");
    assert.equal(plan.runtimeIdentity.fallbackFrom, "pi");
    assert.equal(plan.runtimeIdentity.selector.executionSelector.sessionKey, "smoke-session");
    assert.equal(plan.runtimeIdentity.selector.executionSelector.generated, false);
    assert.equal(plan.command.executable, "pnpm");
    assert.equal(plan.command.cwd, path.resolve("/tmp/openclaw-source"));
    assert.deepEqual(plan.command.args, [
      "openclaw",
      "agent",
      "--local",
      "--json",
      "--model",
      "gpt-5.5",
      "--thinking",
      "off",
      "--agent",
      "win9-main",
      "--session-key",
      "smoke-session",
      "--message",
      "ping",
    ]);
  });

  it("records env-file key presence without persisting secret values", async () => {
    const blueprint = await loadExample();
    const plan = buildRuntimePlan(blueprint, {
      target: "openclaw",
      workspace: "/tmp/workspace",
      openClawStateDir: "/tmp/openclaw-state",
      provider: "deepseek",
      model: "deepseek/deepseek-v4-flash",
      transport: "local",
      envFile: "/tmp/agentmo/.env",
      envFileContent:
        "DEEPSEEK_API_KEY=deepseek-secret-value\nDEEPSEEK_BASE_URL=https://api.deepseek.com\nOPENCLAW_GATEWAY_URL=ws://127.0.0.1:28765\nOPENCLAW_GATEWAY_PORT=28765\nIGNORED=value\n",
      message: "use deepseek-secret-value carefully",
    });

    assert.deepEqual(plan.runtimeIdentity.runtimeEnv.envFile, { basename: ".env", fullPathPersisted: false });
    assert.equal(plan.runtimeIdentity.runtimeEnv.valuesPersisted, false);
    assert.deepEqual(plan.runtimeIdentity.runtimeEnv.presentKeys, [
      "DEEPSEEK_API_KEY",
      "DEEPSEEK_BASE_URL",
      "OPENCLAW_GATEWAY_PORT",
      "OPENCLAW_GATEWAY_URL",
    ]);
    assert.equal(plan.runtimeIdentity.runtimeEnv.allowedKeys.includes("IGNORED"), false);
    assert.equal(plan.runtimeIdentity.sandboxScope.environmentAllowlist.includes("DEEPSEEK_API_KEY"), true);
    assert.equal(plan.runtimeIdentity.sandboxScope.environmentAllowlist.includes("OPENCLAW_GATEWAY_URL"), true);
    assert.equal(plan.runtimeIdentity.sandboxScope.environmentAllowlist.includes("OPENCLAW_GATEWAY_PORT"), true);
    assert.equal(plan.message.messageMode, "file");
    assert.equal(plan.message.messagePreview.includes("deepseek-secret-value"), false);
    assert.equal(JSON.stringify(plan).includes("deepseek-secret-value"), false);
    assert.equal(JSON.stringify(plan).includes("/tmp/agentmo/.env"), false);
  });

  it("allowlists proxy env keys for runtime reachability without persisting proxy values", async () => {
    const originalProxyEnv = new Map(RUNTIME_PROXY_ENV_KEYS.map((key) => [key, process.env[key]]));
    for (const key of RUNTIME_PROXY_ENV_KEYS) delete process.env[key];
    process.env.HTTPS_PROXY = "http://127.0.0.1:7897";

    try {
      const blueprint = await loadExample();
      const plan = buildRuntimePlan(blueprint, {
        target: "openclaw",
        workspace: "/tmp/workspace",
        provider: "deepseek",
        model: "deepseek/deepseek-v4-flash",
        thinking: "off",
        transport: "local",
        message: "ping",
      });

      assert.equal(plan.runtimeIdentity.sandboxScope.environmentAllowlist.includes("HTTPS_PROXY"), true);
      assert.equal(JSON.stringify(plan).includes("http://127.0.0.1:7897"), false);
    } finally {
      for (const key of RUNTIME_PROXY_ENV_KEYS) {
        const value = originalProxyEnv.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("plans message-file provenance for multiline inline messages", async () => {
    const blueprint = await loadExample();
    const plan = buildRuntimePlan(blueprint, { target: "openclaw", workspace: "/tmp/workspace", message: "line 1\nline 2" });

    assert.equal(plan.message.messageMode, "file");
    assert.equal(plan.message.inlineMessage, null);
    assert.equal(plan.message.messageFile.planned, true);
    assert.match(plan.message.messageFile.path, /^messages\/[a-f0-9]{16}\.txt$/u);
    assert.equal(plan.command.args.includes("--message-file"), true);
    assert.equal(plan.command.args.includes(plan.message.messageFile.path), true);
  });

  it("plans existing message-file provenance", async () => {
    const blueprint = await loadExample();
    const plan = buildRuntimePlan(blueprint, {
      target: "openclaw",
      workspace: "/tmp/workspace",
      messageFile: "/tmp/message.txt",
      messageFileContent: "from file",
    });

    assert.equal(plan.message.messageMode, "file");
    assert.equal(plan.message.messageLength, "from file".length);
    assert.equal(plan.message.messageFile.path, path.resolve("/tmp/message.txt"));
    assert.equal(plan.message.messageFile.planned, false);
    assert.equal(plan.message.messageFile.digestVerified, true);
  });

  it("records sandbox scope and redacts secret-like message evidence", async () => {
    const blueprint = await loadExample();
    const plan = buildRuntimePlan(blueprint, {
      target: "openclaw",
      workspace: "/tmp/workspace",
      openClawStateDir: "/tmp/openclaw-state",
      message: "api_key=secret sk-abcdefghijklmnop",
      timeoutMs: 5000,
    });

    assert.equal(plan.runtimeIdentity.sandboxScope.stateDir, path.resolve("/tmp/openclaw-state"));
    assert.equal(plan.runtimeIdentity.sandboxScope.usesProductionState, false);
    assert.equal(plan.command.timeoutMs, 5000);
    assert.equal(plan.message.messageMode, "file");
    assert.equal(plan.message.messagePreview.includes("secret"), false);
    assert.equal(plan.message.messagePreview.includes("[REDACTED_SECRET]"), true);
    assert.equal(JSON.stringify(plan).includes("api_key=secret"), false);
    assert.equal(JSON.stringify(plan).includes("sk-abcdefghijklmnop"), false);
  });

  it("rejects unsupported or incomplete runtime requests", async () => {
    const blueprint = await loadExample();
    assert.throws(() => buildRuntimePlan(blueprint, { target: "agentmo", workspace: "/tmp/workspace", message: "ping" }), /Runtime planning supports target openclaw/u);
    assert.throws(() => buildRuntimePlan(blueprint, { target: "openclaw", message: "ping" }), /Missing required workspace path/u);
    assert.throws(() => buildRuntimePlan(blueprint, { target: "openclaw", workspace: "/tmp/workspace" }), /Missing message input/u);
    assert.throws(
      () =>
        buildRuntimePlan(blueprint, {
          target: "openclaw",
          workspace: "/tmp/workspace",
          message: "ping",
          openClawStateDir: "/tmp/state",
          useProductionOpenClawState: true,
        }),
      /Pass either --openclaw-state-dir or --use-production-openclaw-state/u,
    );
    assert.throws(
      () => buildRuntimePlan(blueprint, { target: "openclaw", workspace: "/tmp/workspace", message: "ping", timeoutMs: 0 }),
      /--timeout-ms must be a positive integer/u,
    );
    assert.throws(
      () => buildRuntimePlan(blueprint, { target: "openclaw", workspace: "/tmp/workspace", message: "ping", transport: "telepathy" }),
      /Unsupported --transport telepathy/u,
    );
    assert.throws(
      () => buildRuntimePlan(blueprint, { target: "openclaw", workspace: "/tmp/workspace", message: "ping", thinking: "forever" }),
      /Unsupported --thinking forever/u,
    );
    assert.throws(
      () =>
        buildRuntimePlan(blueprint, {
          target: "openclaw",
          workspace: "/tmp/workspace",
          sessionKey: "one",
          sessionId: "two",
          message: "ping",
        }),
      /Pass at most one of --session-key, --session-id, or --to/u,
    );
  });
});
