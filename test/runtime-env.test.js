import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertRuntimeEnvReady, parseEnvFileContent, resolveRuntimeEnv } from "../src/runtime-env.js";

describe("runtime env descriptor", () => {
  it("parses dotenv files and records only key presence", () => {
    const parsed = parseEnvFileContent(`
# comment
export DEEPSEEK_API_KEY="deepseek-secret-value"
DEEPSEEK_BASE_URL=https://api.deepseek.com # public endpoint
OPENCLAW_GATEWAY_TOKEN='gateway-token-value'
OPENCLAW_GATEWAY_URL=ws://127.0.0.1:28765
OPENCLAW_GATEWAY_PORT=28765
BAD KEY=ignored
IGNORED=value
`);
    const runtimeEnv = resolveRuntimeEnv({
      envFile: "/tmp/agentmo/.env",
      envFileContent: Object.entries(parsed).map(([key, value]) => `${key}=${value}`).join("\n"),
    });

    assert.equal(runtimeEnv.values.DEEPSEEK_API_KEY, "deepseek-secret-value");
    assert.equal(runtimeEnv.values.DEEPSEEK_BASE_URL, "https://api.deepseek.com");
    assert.equal(runtimeEnv.values.OPENCLAW_GATEWAY_TOKEN, "gateway-token-value");
    assert.equal(runtimeEnv.values.OPENCLAW_GATEWAY_URL, "ws://127.0.0.1:28765");
    assert.equal(runtimeEnv.values.OPENCLAW_GATEWAY_PORT, "28765");
    assert.equal("IGNORED" in runtimeEnv.values, false);
    assert.equal(runtimeEnv.descriptor.envFile.basename, ".env");
    assert.equal(runtimeEnv.descriptor.envFile.fullPathPersisted, false);
    assert.equal(runtimeEnv.descriptor.valuesPersisted, false);
    assert.deepEqual(runtimeEnv.descriptor.presentKeys, [
      "DEEPSEEK_API_KEY",
      "DEEPSEEK_BASE_URL",
      "OPENCLAW_GATEWAY_PORT",
      "OPENCLAW_GATEWAY_TOKEN",
      "OPENCLAW_GATEWAY_URL",
    ]);
    assert.equal(JSON.stringify(runtimeEnv.descriptor).includes("deepseek-secret-value"), false);
    assert.equal(JSON.stringify(runtimeEnv.descriptor).includes("/tmp/agentmo/.env"), false);
  });

  it("fails live DeepSeek env-file preflight on missing API key names only", () => {
    const runtimeEnv = resolveRuntimeEnv({
      envFile: "/tmp/agentmo/.env",
      envFileContent: "DEEPSEEK_BASE_URL=https://api.deepseek.com\n",
    });

    assert.throws(
      () => assertRuntimeEnvReady(runtimeEnv.descriptor, { live: true, provider: "deepseek", transport: "local" }),
      /Missing required runtime env key\(s\): DEEPSEEK_API_KEY/u,
    );
    assert.doesNotThrow(() => assertRuntimeEnvReady(runtimeEnv.descriptor, { live: false, provider: "deepseek", transport: "local" }));
  });

  it("requires an env descriptor for live DeepSeek runs", () => {
    assert.throws(
      () => assertRuntimeEnvReady(null, { live: true, provider: "deepseek", transport: "local" }),
      /Missing required runtime env key\(s\): DEEPSEEK_API_KEY/u,
    );
  });
});
