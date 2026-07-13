import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { digestRawBytes } from "../src/artifact-admission.js";
import {
  buildRuntimePlan,
  FRESH_RUN_SESSION_KEY_PLACEHOLDER,
  RUNTIME_PLAN_SCHEMA_VERSION,
  RUNTIME_PROXY_ENV_KEYS,
  TRANSIENT_MESSAGE_PLACEHOLDER,
  validateRuntimePlanArtifact,
} from "../src/runtime-plan.js";
import { assertPersistable, isRedactedSummary } from "../src/persistability.js";
import { admitBlueprint } from "./helpers/admitted-blueprint.js";
import { buildAndAdmitRuntimePlan as createAdmittedRuntimePlan } from "./helpers/admitted-runtime.js";

const BLUEPRINT = new URL("../examples/win9.agentmo.json", import.meta.url);

async function buildPlan(options) {
  const admission = await admitBlueprint(BLUEPRINT);
  const plan = await buildRuntimePlan(admission.value, { ...options, admission });
  return { admission, plan };
}

function transientPath(name) {
  return { kind: "TransientPathRef", name, persisted: false };
}

describe("runtime plan", () => {
  it("keeps message bytes and host paths transient while closing the durable plan", async () => {
    const blueprintAdmission = await admitBlueprint(BLUEPRINT);
    const canary = "plan-message-canary";
    const { runtimePlan: plan } = await createAdmittedRuntimePlan(blueprintAdmission.value, {
      target: "openclaw",
      workspace: "/private/host/workspace-canary",
      openClawSourceRoot: "/private/host/source-canary",
      openClawStateDir: "/private/host/state-canary",
      messageFile: "/private/host/message-canary.txt",
      messageFileContent: canary,
    });

    assert.equal(validateRuntimePlanArtifact(plan).ok, true);
    assert.equal(isRedactedSummary(plan.message.summary), true);
    assert.equal(plan.message.sourceDigest, digestRawBytes(Buffer.from(canary)));
    assert.equal(plan.message.byteLength, Buffer.byteLength(canary));
    assert.deepEqual(plan.runtimeIdentity.workspace, transientPath("workspace"));
    assert.deepEqual(plan.runtimeIdentity.sandboxScope.workspaceRoot, transientPath("workspace"));
    assert.deepEqual(plan.runtimeIdentity.sandboxScope.sourceRoot, transientPath("openclaw-source-root"));
    assert.deepEqual(plan.runtimeIdentity.sandboxScope.state, transientPath("openclaw-state"));
    assert.deepEqual(plan.command.cwd, transientPath("openclaw-source-root"));
    assert.equal(plan.command.args.includes(TRANSIENT_MESSAGE_PLACEHOLDER), true);
    assert.doesNotThrow(() => assertPersistable(plan, { subject: "runtime-plan" }));
    const serialized = JSON.stringify(plan);
    for (const forbidden of [canary, "/private/host", "message-canary.txt"]) {
      assert.equal(serialized.includes(forbidden), false);
    }
  });

  it("builds deterministic admitted OpenClaw runtime plans without writing the workspace", async () => {
    const admission = await admitBlueprint(BLUEPRINT);
    const workspace = await mkdtemp(path.join(tmpdir(), "agentmo-runtime-plan-"));
    const options = { admission, target: "openclaw", workspace, message: "ping" };
    const first = await buildRuntimePlan(admission.value, options);
    const second = await buildRuntimePlan(admission.value, options);

    assert.deepEqual(first, second);
    assert.equal(first.schemaVersion, RUNTIME_PLAN_SCHEMA_VERSION);
    assert.equal(first.agentId, "win9");
    assert.equal(first.target.id, "openclaw");
    assert.equal(first.selectedRuntimeProfileId, "openclaw");
    assert.equal(first.executionSessionPolicy, "fresh-per-run");
    assert.deepEqual(first.source, { identity: "0.1", subject: "blueprint", digest: admission.digest });
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
    assert.deepEqual(first.runtimeIdentity.workspace, transientPath("workspace"));
    assert.deepEqual(first.runtimeIdentity.sandboxScope.workspaceRoot, transientPath("workspace"));
    assert.equal(first.runtimeIdentity.sandboxScope.state, null);
    assert.equal(first.runtimeIdentity.sandboxScope.sourceRoot, null);
    assert.equal(first.runtimeIdentity.sandboxScope.usesProductionState, false);
    assert.equal(first.command.cwd, null);
    assert.equal(first.command.timeoutMs, 120000);
    assert.equal(first.message.sourceDigest, digestRawBytes(Buffer.from("ping")));
    assert.equal(first.message.byteLength, 4);
    assert.equal(isRedactedSummary(first.message.summary), true);
    assert.equal(first.command.executable, "openclaw");
    assert.deepEqual(first.command.args, [
      "agent",
      "--json",
      "--agent",
      "win9",
      "--session-key",
      FRESH_RUN_SESSION_KEY_PLACEHOLDER,
      "--message",
      TRANSIENT_MESSAGE_PLACEHOLDER,
    ]);
    assert.equal(first.command.mutatesOpenClawState, false);
    assert.equal(first.certificationBoundary.runEvidenceCertifiesRuntime, false);
    assert.equal(first.unsupportedSurfaceDigests.length > 0, true);
    assert.equal(first.unsupportedSurfaceDigests.every((digest) => /^sha256:[a-f0-9]{64}$/u.test(digest)), true);
    assert.deepEqual(await readdir(workspace), []);
  });

  it("builds source-checkout command templates without retaining the checkout path or message", async () => {
    const { plan } = await buildPlan({
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
    assert.deepEqual(plan.command.cwd, transientPath("openclaw-source-root"));
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
      TRANSIENT_MESSAGE_PLACEHOLDER,
    ]);
    const serialized = JSON.stringify(plan);
    assert.equal(serialized.includes("/tmp/openclaw-source"), false);
    assert.equal(serialized.includes("ping"), false);
  });

  it("records exact SecretPresence and message summaries without env values", async () => {
    const message = "use deepseek-secret-value carefully";
    const { plan } = await buildPlan({
      target: "openclaw",
      workspace: "/tmp/workspace",
      openClawStateDir: "/tmp/openclaw-state",
      provider: "deepseek",
      model: "deepseek/deepseek-v4-flash",
      transport: "local",
      envFile: "/tmp/agentmo/.env",
      envFileContent:
        "DEEPSEEK_API_KEY=deepseek-secret-value\nDEEPSEEK_BASE_URL=https://api.deepseek.com\nOPENCLAW_GATEWAY_URL=ws://127.0.0.1:28765\nOPENCLAW_GATEWAY_PORT=28765\nIGNORED=value\n",
      message,
    });

    assert.deepEqual(Object.keys(plan.runtimeIdentity.runtimeEnv), [
      "kind",
      "source",
      "allowedNames",
      "presentNames",
      "missingNames",
      "valuesPersisted",
    ]);
    assert.equal(plan.runtimeIdentity.runtimeEnv.kind, "SecretPresence");
    assert.equal(plan.runtimeIdentity.runtimeEnv.valuesPersisted, false);
    assert.deepEqual(plan.runtimeIdentity.runtimeEnv.presentNames, [
      "DEEPSEEK_API_KEY",
      "DEEPSEEK_BASE_URL",
      "OPENCLAW_GATEWAY_PORT",
      "OPENCLAW_GATEWAY_URL",
    ]);
    assert.equal(plan.runtimeIdentity.runtimeEnv.allowedNames.includes("IGNORED"), false);
    assert.equal(plan.runtimeIdentity.sandboxScope.environmentAllowlist.includes("DEEPSEEK_API_KEY"), true);
    assert.equal(plan.runtimeIdentity.sandboxScope.environmentAllowlist.includes("OPENCLAW_GATEWAY_URL"), true);
    assert.equal(plan.message.sourceDigest, digestRawBytes(Buffer.from(message)));
    assert.equal(plan.message.byteLength, Buffer.byteLength(message));
    assert.equal(isRedactedSummary(plan.message.summary), true);
    const serialized = JSON.stringify(plan);
    assert.equal(serialized.includes("deepseek-secret-value"), false);
    assert.equal(serialized.includes("/tmp/agentmo/.env"), false);
  });

  it("allowlists proxy env keys for runtime reachability without persisting proxy values", async () => {
    const originalProxyEnv = new Map(RUNTIME_PROXY_ENV_KEYS.map((key) => [key, process.env[key]]));
    for (const key of RUNTIME_PROXY_ENV_KEYS) delete process.env[key];
    process.env.HTTPS_PROXY = "http://127.0.0.1:7897";

    try {
      const { plan } = await buildPlan({
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

  it("represents multiline inline messages only by exact digest, byte length, and summary", async () => {
    const message = "line 1\nline 2";
    const { plan } = await buildPlan({ target: "openclaw", workspace: "/tmp/workspace", message });

    assert.equal(plan.message.sourceDigest, digestRawBytes(Buffer.from(message)));
    assert.equal(plan.message.byteLength, Buffer.byteLength(message));
    assert.equal(isRedactedSummary(plan.message.summary), true);
    assert.equal(Object.hasOwn(plan.message, "inlineMessage"), false);
    assert.equal(Object.hasOwn(plan.message, "messageFile"), false);
    assert.equal(plan.command.args.includes("--message-file"), false);
    assert.equal(plan.command.args.includes(TRANSIENT_MESSAGE_PLACEHOLDER), true);
    assert.equal(JSON.stringify(plan).includes(message), false);
  });

  it("represents message-file input without retaining its host path or bytes", async () => {
    const message = "from file";
    const { plan } = await buildPlan({
      target: "openclaw",
      workspace: "/tmp/workspace",
      messageFile: "/tmp/message.txt",
      messageFileContent: message,
    });

    assert.equal(plan.message.sourceDigest, digestRawBytes(Buffer.from(message)));
    assert.equal(plan.message.byteLength, Buffer.byteLength(message));
    assert.equal(isRedactedSummary(plan.message.summary), true);
    assert.equal(Object.hasOwn(plan.message, "messageFile"), false);
    assert.equal(plan.command.args.includes(TRANSIENT_MESSAGE_PLACEHOLDER), true);
    const serialized = JSON.stringify(plan);
    assert.equal(serialized.includes("/tmp/message.txt"), false);
    assert.equal(serialized.includes(message), false);
  });

  it("records transient sandbox scope and summarizes secret-like messages", async () => {
    const message = "api_key=secret sk-abcdefghijklmnop";
    const { plan } = await buildPlan({
      target: "openclaw",
      workspace: "/tmp/workspace",
      openClawStateDir: "/tmp/openclaw-state",
      message,
      timeoutMs: 5000,
    });

    assert.deepEqual(plan.runtimeIdentity.sandboxScope.state, transientPath("openclaw-state"));
    assert.equal(plan.runtimeIdentity.sandboxScope.usesProductionState, false);
    assert.equal(plan.command.timeoutMs, 5000);
    assert.equal(plan.message.sourceDigest, digestRawBytes(Buffer.from(message)));
    assert.equal(plan.message.byteLength, Buffer.byteLength(message));
    assert.equal(isRedactedSummary(plan.message.summary), true);
    assert.equal(plan.message.summary.text.includes("secret"), false);
    const serialized = JSON.stringify(plan);
    assert.equal(serialized.includes("api_key=secret"), false);
    assert.equal(serialized.includes("sk-abcdefghijklmnop"), false);
    assert.equal(serialized.includes("/tmp/openclaw-state"), false);
  });

  it("rejects unsupported or incomplete runtime requests after authentic blueprint admission", async () => {
    const admission = await admitBlueprint(BLUEPRINT);
    const build = (options) => buildRuntimePlan(admission.value, { ...options, admission });

    await assert.rejects(
      () => build({ target: "agentmo", workspace: "/tmp/workspace", message: "ping" }),
      /Runtime planning supports target openclaw/u,
    );
    await assert.rejects(
      () => build({ target: "openclaw", message: "ping" }),
      /Missing required workspace path/u,
    );
    await assert.rejects(
      () => build({ target: "openclaw", workspace: "/tmp/workspace" }),
      /Missing message input/u,
    );
    await assert.rejects(
      () => build({
        target: "openclaw",
        workspace: "/tmp/workspace",
        message: "ping",
        openClawStateDir: "/tmp/state",
        useProductionOpenClawState: true,
      }),
      /Pass either --openclaw-state-dir or --use-production-openclaw-state/u,
    );
    await assert.rejects(
      () => build({ target: "openclaw", workspace: "/tmp/workspace", message: "ping", timeoutMs: 0 }),
      /--timeout-ms must be a positive integer/u,
    );
    await assert.rejects(
      () => build({ target: "openclaw", workspace: "/tmp/workspace", message: "ping", transport: "telepathy" }),
      /Unsupported --transport telepathy/u,
    );
    await assert.rejects(
      () => build({ target: "openclaw", workspace: "/tmp/workspace", message: "ping", thinking: "forever" }),
      /Unsupported --thinking forever/u,
    );
    await assert.rejects(
      () => build({
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
