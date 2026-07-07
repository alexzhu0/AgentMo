import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { containsSecretLikeValue, redactSecrets, REDACTED_SECRET } from "../src/secret-redaction.js";

describe("secret redaction", () => {
  it("redacts explicit runtime secrets and common secret shapes", () => {
    const text = [
      "DEEPSEEK_API_KEY=deepseek-secret-value",
      '{"apiKey":"deepseek-secret-value","token":"json-token-value"}',
      "Authorization: Bearer bearer-token-value",
      "sk-abcdefghijklmnop",
      "plain deepseek-secret-value",
    ].join("\n");
    const redacted = redactSecrets(text, ["deepseek-secret-value", "json-token-value", "bearer-token-value"]);

    assert.equal(redacted.includes("deepseek-secret-value"), false);
    assert.equal(redacted.includes("json-token-value"), false);
    assert.equal(redacted.includes("bearer-token-value"), false);
    assert.equal(redacted.includes("sk-abcdefghijklmnop"), false);
    assert.equal(redacted.includes(REDACTED_SECRET), true);
    assert.equal(containsSecretLikeValue(text, ["deepseek-secret-value"]), true);
  });
});
