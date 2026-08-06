import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { writePocWorkspace } from "../src/poc-agent.js";
import {
  buildPocDashboardCommands,
  buildPocDashboardUrl,
  buildPocOpenClawCommands,
  openPocDashboardUrl,
  runPocOpenClawDashboard,
  runPocOpenClaw,
} from "../src/poc-openclaw-runtime.js";

function seed() {
  return {
    schemaVersion: "agentmo.poc-seed.v1",
    agentId: "ai-frontier-poc",
    records: [{
      id: "paper-agent-memory",
      title: "Agent Memory Paper",
      url: "https://example.com/papers/agent-memory",
      publishedAt: "2026-05-06T00:00:00.000Z",
      collectedAt: "2026-08-05T00:00:00.000Z",
      category: "agent-memory",
      sourceType: "paper",
      trustTier: "primary",
      summary: "A bounded paper summary.",
    }],
  };
}

describe("POC OpenClaw runtime", () => {
  it("builds a loopback token-authenticated Dashboard for the exact generated Agent", () => {
    const commands = buildPocDashboardCommands({
      workspace: "/private/poc/workspace",
      profileHome: "/private/poc/workspace/.agentmo-poc-home",
      profile: "agentmo-poc-white-collar",
      agentId: "white-collar-research-poc",
      model: "deepseek/deepseek-v4-flash",
      port: 18889,
      gatewayToken: "test-only-gateway-token",
      runtimeEnvValues: { DEEPSEEK_API_KEY: "test-only-provider-secret" },
    });

    assert.deepEqual(commands.configureModels.args, [
      "--profile", "agentmo-poc-white-collar", "config", "set",
      "models.providers.deepseek.models",
      "[{\"id\":\"deepseek-v4-flash\",\"name\":\"deepseek-v4-flash\"}]",
      "--strict-json",
    ]);
    assert.deepEqual(commands.gateway.args, [
      "--profile", "agentmo-poc-white-collar", "gateway", "run",
      "--port", "18889", "--bind", "loopback", "--auth", "token",
      "--allow-unconfigured",
    ]);
    assert.equal(commands.gateway.args.includes("--force"), false);
    assert.equal(commands.gateway.env.HOME, "/private/poc/workspace/.agentmo-poc-home");
    assert.equal(commands.gateway.env.OPENCLAW_GATEWAY_TOKEN, "test-only-gateway-token");
    assert.equal(commands.gateway.env.DEEPSEEK_API_KEY, "test-only-provider-secret");
    assert.deepEqual(commands.register.args, [
      "--profile", "agentmo-poc-white-collar", "agents", "add",
      "white-collar-research-poc", "--agent-dir",
      "/private/poc/workspace/.agentmo-agent", "--workspace",
      "/private/poc/workspace", "--model", "deepseek/deepseek-v4-flash",
      "--non-interactive", "--json",
    ]);
    assert.equal(buildPocDashboardUrl({
      agentId: "white-collar-research-poc",
      port: 18889,
    }), "http://127.0.0.1:18889/chat?session=agent%3Awhite-collar-research-poc%3Amain");
  });

  it("starts the isolated Dashboard after bounded setup without exposing runtime secrets", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-poc-dashboard-"));
    const workspace = path.join(root, "workspace");
    const envFile = path.join(root, "runtime.env");
    await writePocWorkspace(seed(), workspace);
    await writeFile(envFile, "DEEPSEEK_API_KEY=provider-secret-canary\n", "utf8");
    const setup = [];
    const readiness = [];
    let gatewayCommand;

    const result = await runPocOpenClawDashboard({
      workspace,
      profile: "agentmo-poc-ai-frontier",
      model: "deepseek/deepseek-v4-flash",
      runtimeEnvFile: envFile,
      port: 18889,
      gatewayTokenFactory: () => "gateway-token-canary-0123456789",
      checkPort: async () => true,
      runCommand: async (command) => {
        setup.push(command);
        return { exitCode: 0, stdout: "{}", stderr: "" };
      },
      runGateway: async (command, { onListening }) => {
        gatewayCommand = command;
        await onListening();
        return 0;
      },
      onReady: async (value) => { readiness.push(value); },
    });

    assert.deepEqual(setup.map((command) => command.args[3]), [
      "set", "set", "set", "install", "add",
    ]);
    assert.equal(gatewayCommand.env.DEEPSEEK_API_KEY, "provider-secret-canary");
    assert.equal(gatewayCommand.env.OPENCLAW_GATEWAY_TOKEN, "gateway-token-canary-0123456789");
    assert.deepEqual(readiness, [{
      ok: true,
      agentId: "ai-frontier-poc",
      profile: "agentmo-poc-ai-frontier",
      model: "deepseek/deepseek-v4-flash",
      port: 18889,
      dashboardUrl: "http://127.0.0.1:18889/chat?session=agent%3Aai-frontier-poc%3Amain",
      runtime: "isolated-openclaw-dashboard",
      scheduleExecuted: false,
      deliveryExecuted: false,
    }]);
    assert.equal(JSON.stringify({ result, readiness }).includes("provider-secret-canary"), false);
    assert.equal(JSON.stringify({ result, readiness }).includes("gateway-token-canary"), false);
    assert.deepEqual(result, { ok: true, exitCode: 0, agentId: "ai-frontier-poc" });
  });

  it("rejects an occupied Dashboard port before mutating the isolated profile", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-poc-dashboard-port-"));
    const workspace = path.join(root, "workspace");
    const envFile = path.join(root, "runtime.env");
    await writePocWorkspace(seed(), workspace);
    await writeFile(envFile, "DEEPSEEK_API_KEY=provider-secret-canary\n", "utf8");
    let setupCalls = 0;

    await assert.rejects(() => runPocOpenClawDashboard({
      workspace,
      profile: "agentmo-poc-ai-frontier",
      model: "deepseek/deepseek-v4-flash",
      runtimeEnvFile: envFile,
      port: 18889,
      checkPort: async () => false,
      runCommand: async () => { setupCalls += 1; return { exitCode: 0, stdout: "", stderr: "" }; },
    }), (error) => {
      assert.equal(error?.code, "AGENTMO_POC_DASHBOARD_PORT_OCCUPIED");
      assert.deepEqual(error?.pocDiagnostic, {
        operation: "port-check",
        exitCode: 1,
        summary: "The requested loopback port is already in use.",
      });
      return true;
    });
    assert.equal(setupCalls, 0);
  });

  it("opens only an authenticated loopback Agent URL without a shell", async () => {
    const launched = [];
    const child = new EventEmitter();
    child.unref = () => { child.unrefCalled = true; };
    const url = "http://127.0.0.1:18889/chat?session=agent%3Aai-frontier-poc%3Amain#token=test-only-token";
    const opening = openPocDashboardUrl(url, {
      platform: "darwin",
      spawnProcess: (command, args, options) => {
        launched.push({ command, args, options });
        queueMicrotask(() => child.emit("spawn"));
        return child;
      },
    });
    await opening;

    assert.deepEqual(launched, [{
      command: "open",
      args: [url],
      options: { shell: false, detached: true, stdio: "ignore" },
    }]);
    assert.equal(child.unrefCalled, true);
    assert.throws(
      () => openPocDashboardUrl("https://example.com/#token=bad"),
      (error) => error?.code === "AGENTMO_POC_DASHBOARD_URL_INVALID",
    );
  });

  it("builds isolated profile commands with no delivery or schedule action", () => {
    const commands = buildPocOpenClawCommands({
      workspace: "/private/poc/workspace",
      profileHome: "/private/poc/workspace/.agentmo-poc-home",
      profile: "agentmo-poc-ai-frontier",
      agentId: "ai-frontier-poc",
      model: "deepseek/deepseek-v4-flash",
      message: "过去七天 Agent memory 有什么进展？",
    });

    assert.deepEqual(commands.install.args, [
      "--profile", "agentmo-poc-ai-frontier", "plugins", "install",
      "@openclaw/deepseek-provider", "--pin",
    ]);
    assert.deepEqual(commands.trustPlugin.args, [
      "--profile", "agentmo-poc-ai-frontier", "config", "set",
      "plugins.allow", "[\"deepseek\"]", "--strict-json",
    ]);
    assert.deepEqual(commands.configureProvider.args, [
      "--profile", "agentmo-poc-ai-frontier", "config", "set",
      "models.providers.deepseek.apiKey",
      "{\"source\":\"env\",\"provider\":\"default\",\"id\":\"DEEPSEEK_API_KEY\"}",
      "--strict-json",
    ]);
    assert.deepEqual(commands.register.args, [
      "--profile", "agentmo-poc-ai-frontier", "agents", "add", "ai-frontier-poc",
      "--agent-dir", "/private/poc/workspace/.agentmo-agent",
      "--workspace", "/private/poc/workspace",
      "--model", "deepseek/deepseek-v4-flash", "--non-interactive", "--json",
    ]);
    assert.deepEqual(commands.invoke.args, [
      "--profile", "agentmo-poc-ai-frontier", "agent", "--local",
      "--agent", "ai-frontier-poc", "--model", "deepseek/deepseek-v4-flash",
      "--message", "过去七天 Agent memory 有什么进展？",
      "--session-key", "agent:ai-frontier-poc:poc", "--timeout", "120", "--json",
    ]);
    assert.equal(commands.register.env.HOME, "/private/poc/workspace/.agentmo-poc-home");
    assert.equal(commands.invoke.args.includes("--deliver"), false);
    assert.equal(commands.invoke.args.includes("cron"), false);
    assert.equal(commands.invoke.args.includes("browser"), false);
  });

  it("passes a value-blind runtime env file only to isolated commands and redacts the reply", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-poc-runtime-"));
    const workspace = path.join(root, "workspace");
    const envFile = path.join(root, "runtime.env");
    await writePocWorkspace(seed(), workspace);
    await writeFile(envFile, "DEEPSEEK_API_KEY=poc-secret-value\n", "utf8");
    const calls = [];

    const result = await runPocOpenClaw({
      workspace,
      profile: "agentmo-poc-ai-frontier",
      model: "deepseek/deepseek-v4-flash",
      message: "请列出证据。",
      runtimeEnvFile: envFile,
      runCommand: async (command) => {
        calls.push(command);
        return { exitCode: 0, stdout: '{"payloads":[{"text":"poc-secret-value safe answer","mediaUrl":null}],"meta":{"provider":"deepseek"}}', stderr: "" };
      },
    });

    assert.equal(calls.length, 5);
    assert.equal(calls.every((call) => call.env.HOME.endsWith(".agentmo-poc-home")), true);
    assert.equal(calls[0].env.DEEPSEEK_API_KEY, "poc-secret-value");
    assert.equal(JSON.stringify(result).includes("poc-secret-value"), false);
    assert.equal(result.reply, "[REDACTED_SECRET] safe answer");
    assert.deepEqual(result.runtimeEnv, {
      kind: "SecretPresence",
      source: "runtime-env",
      allowedNames: [
        "DEEPSEEK_API_KEY",
        "DEEPSEEK_BASE_URL",
        "OPENCLAW_GATEWAY_PASSWORD",
        "OPENCLAW_GATEWAY_PORT",
        "OPENCLAW_GATEWAY_TOKEN",
        "OPENCLAW_GATEWAY_URL",
      ],
      presentNames: ["DEEPSEEK_API_KEY"],
      missingNames: [
        "DEEPSEEK_BASE_URL",
        "OPENCLAW_GATEWAY_PASSWORD",
        "OPENCLAW_GATEWAY_PORT",
        "OPENCLAW_GATEWAY_TOKEN",
        "OPENCLAW_GATEWAY_URL",
      ],
      valuesPersisted: false,
    });
    assert.equal((await readFile(path.join(workspace, "agentmo-poc-manifest.json"), "utf8")).includes("poc-secret-value"), false);
  });

  it("returns only a bounded redacted invocation diagnostic on an OpenClaw failure", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-poc-runtime-failure-"));
    const workspace = path.join(root, "workspace");
    const envFile = path.join(root, "runtime.env");
    await writePocWorkspace(seed(), workspace);
    await writeFile(envFile, "DEEPSEEK_API_KEY=poc-secret-value\n", "utf8");
    let call = 0;

    await assert.rejects(
      () => runPocOpenClaw({
        workspace,
        profile: "agentmo-poc-ai-frontier",
        model: "deepseek/deepseek-v4-flash",
        message: "请列出证据。",
        runtimeEnvFile: envFile,
        runCommand: async () => {
          call += 1;
          return call < 5
            ? { exitCode: 0, stdout: "{}", stderr: "" }
            : { exitCode: 1, stdout: "", stderr: "api_key=poc-secret-value /private/host/problem" };
        },
      }),
      (error) => {
        assert.equal(error?.code, "AGENTMO_POC_OPENCLAW_INVOKE_FAILED");
        assert.deepEqual(error?.pocDiagnostic, {
          operation: "invoke",
          exitCode: 1,
          summary: "[REDACTED_SECRET] [REDACTED_PATH]",
        });
        return true;
      },
    );
  });

  it("bounds a runtime diagnostic before it reaches the public CLI", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-poc-runtime-bounded-diagnostic-"));
    const workspace = path.join(root, "workspace");
    const envFile = path.join(root, "runtime.env");
    await writePocWorkspace(seed(), workspace);
    await writeFile(envFile, "DEEPSEEK_API_KEY=poc-secret-value\n", "utf8");
    let call = 0;

    await assert.rejects(
      () => runPocOpenClaw({
        workspace,
        profile: "agentmo-poc-ai-frontier",
        model: "deepseek/deepseek-v4-flash",
        message: "请列出证据。",
        runtimeEnvFile: envFile,
        runCommand: async () => {
          call += 1;
          return call < 5
            ? { exitCode: 0, stdout: "{}", stderr: "" }
            : { exitCode: 1, stdout: "", stderr: "x".repeat(2_000) };
        },
      }),
      (error) => {
        assert.equal(error?.pocDiagnostic?.summary.length, 800);
        return true;
      },
    );
  });

  it("rejects an OpenClaw success exit that contains no answer bytes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-poc-runtime-empty-reply-"));
    const workspace = path.join(root, "workspace");
    const envFile = path.join(root, "runtime.env");
    await writePocWorkspace(seed(), workspace);
    await writeFile(envFile, "DEEPSEEK_API_KEY=poc-secret-value\n", "utf8");
    let call = 0;

    await assert.rejects(
      () => runPocOpenClaw({
        workspace,
        profile: "agentmo-poc-ai-frontier",
        model: "deepseek/deepseek-v4-flash",
        message: "请列出证据。",
        runtimeEnvFile: envFile,
        runCommand: async () => {
          call += 1;
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      }),
      (error) => {
        assert.equal(error?.code, "AGENTMO_POC_OPENCLAW_EMPTY_REPLY");
        assert.deepEqual(error?.pocDiagnostic, {
          operation: "invoke",
          exitCode: 0,
          summary: "OpenClaw returned no answer bytes.",
        });
        return true;
      },
    );
    assert.equal(call, 5);
  });

  it("reports only a sorted JSON shape when OpenClaw has no text payload", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-poc-runtime-in-flight-"));
    const workspace = path.join(root, "workspace");
    const envFile = path.join(root, "runtime.env");
    await writePocWorkspace(seed(), workspace);
    await writeFile(envFile, "DEEPSEEK_API_KEY=poc-secret-value\n", "utf8");
    let call = 0;

    await assert.rejects(
      () => runPocOpenClaw({
        workspace,
        profile: "agentmo-poc-ai-frontier",
        model: "deepseek/deepseek-v4-flash",
        message: "请列出证据。",
        runtimeEnvFile: envFile,
        runCommand: async () => {
          call += 1;
          return call < 5
            ? { exitCode: 0, stdout: "{}", stderr: "" }
            : { exitCode: 0, stdout: '{"sessionKey":"agent:ai-frontier-poc:poc","status":"in_flight"}', stderr: "" };
        },
      }),
      (error) => {
        assert.equal(error?.code, "AGENTMO_POC_OPENCLAW_OUTPUT_INVALID");
        assert.deepEqual(error?.pocDiagnostic, {
          operation: "invoke",
          exitCode: 0,
          summary: "OpenClaw returned no usable text payload (keys: sessionKey,status).",
        });
        return true;
      },
    );
    assert.equal(call, 5);
  });

  it("reports non-JSON OpenClaw output without exposing its contents", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-poc-runtime-non-json-"));
    const workspace = path.join(root, "workspace");
    const envFile = path.join(root, "runtime.env");
    await writePocWorkspace(seed(), workspace);
    await writeFile(envFile, "DEEPSEEK_API_KEY=poc-secret-value\n", "utf8");
    let call = 0;

    await assert.rejects(
      () => runPocOpenClaw({
        workspace,
        profile: "agentmo-poc-ai-frontier",
        model: "deepseek/deepseek-v4-flash",
        message: "请列出证据。",
        runtimeEnvFile: envFile,
        runCommand: async () => {
          call += 1;
          return call < 5
            ? { exitCode: 0, stdout: "{}", stderr: "" }
            : { exitCode: 0, stdout: "provider output must stay private", stderr: "" };
        },
      }),
      (error) => {
        assert.equal(error?.code, "AGENTMO_POC_OPENCLAW_OUTPUT_INVALID");
        assert.deepEqual(error?.pocDiagnostic, {
          operation: "invoke",
          exitCode: 0,
          summary: "OpenClaw returned non-JSON output.",
        });
        assert.equal(JSON.stringify(error).includes("provider output must stay private"), false);
        return true;
      },
    );
    assert.equal(call, 5);
  });

  it("parses a JSON envelope larger than the public reply limit without exposing metadata", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-poc-runtime-large-json-"));
    const workspace = path.join(root, "workspace");
    const envFile = path.join(root, "runtime.env");
    await writePocWorkspace(seed(), workspace);
    await writeFile(envFile, "DEEPSEEK_API_KEY=poc-secret-value\n", "utf8");
    let call = 0;
    const visibleAnswer = "可公开回答。".repeat(3_000);
    const oversizedEnvelope = JSON.stringify({
      payloads: [{ text: visibleAnswer, mediaUrl: null }],
      meta: { internal: "metadata-must-not-be-returned".repeat(2_000) },
    });

    const result = await runPocOpenClaw({
      workspace,
      profile: "agentmo-poc-ai-frontier",
      model: "deepseek/deepseek-v4-flash",
      message: "请列出证据。",
      runtimeEnvFile: envFile,
      runCommand: async () => {
        call += 1;
        return call < 5
          ? { exitCode: 0, stdout: "{}", stderr: "" }
          : { exitCode: 0, stdout: oversizedEnvelope, stderr: "" };
      },
    });

    assert.equal(call, 5);
    assert.equal(result.reply.length, 16_000);
    assert.equal(JSON.stringify(result).includes("metadata-must-not-be-returned"), false);
  });

  it("reuses the same POC agent after a bounded already-exists registration result", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-poc-runtime-retry-"));
    const workspace = path.join(root, "workspace");
    const envFile = path.join(root, "runtime.env");
    await writePocWorkspace(seed(), workspace);
    await writeFile(envFile, "DEEPSEEK_API_KEY=poc-secret-value\n", "utf8");
    let call = 0;

    const result = await runPocOpenClaw({
      workspace,
      profile: "agentmo-poc-ai-frontier",
      model: "deepseek/deepseek-v4-flash",
      message: "请列出证据。",
      runtimeEnvFile: envFile,
      runCommand: async () => {
        call += 1;
        return call < 4
          ? { exitCode: 0, stdout: "{}", stderr: "" }
          : call === 4
            ? { exitCode: 1, stdout: "", stderr: 'Agent "ai-frontier-poc" already exists. Run openclaw --profile agentmo-poc-ai-frontier agents list to inspect configured agents.\n' }
            : { exitCode: 0, stdout: '{"payloads":[{"text":"bounded answer","mediaUrl":null}]}', stderr: "" };
      },
    });

    assert.equal(call, 5);
    assert.equal(result.reply, "bounded answer");
  });

  it("reuses the pinned DeepSeek plugin after its bounded already-installed result", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-poc-runtime-plugin-retry-"));
    const workspace = path.join(root, "workspace");
    const envFile = path.join(root, "runtime.env");
    await writePocWorkspace(seed(), workspace);
    await writeFile(envFile, "DEEPSEEK_API_KEY=poc-secret-value\n", "utf8");
    let call = 0;

    const result = await runPocOpenClaw({
      workspace,
      profile: "agentmo-poc-ai-frontier",
      model: "deepseek/deepseek-v4-flash",
      message: "请列出证据。",
      runtimeEnvFile: envFile,
      runCommand: async () => {
        call += 1;
        return call === 3
          ? { exitCode: 1, stdout: "", stderr: "plugin already exists: /isolated/plugin (delete it first)\nUse `openclaw plugins update <id-or-npm-spec>` to upgrade the tracked plugin, or rerun install with `--force` to replace it.\n" }
          : { exitCode: 0, stdout: '{"payloads":[{"text":"bounded answer","mediaUrl":null}]}', stderr: "" };
      },
    });

    assert.equal(call, 5);
    assert.equal(result.reply, "bounded answer");
  });
});
