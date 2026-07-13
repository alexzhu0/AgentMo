import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  containsHostAbsolutePath,
  containsSecretLikeKey,
  containsSecretLikeValue,
  redactHostAbsolutePaths,
  redactManagedText,
  redactSecrets,
  REDACTED_PATH,
  REDACTED_SECRET,
} from "../src/secret-redaction.js";

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

  it("redacts credential assignments, access/private keys, and PEM private-key blocks", () => {
    const text = [
      "credential=review-only-credential",
      '{"privateKey":"review-only-private-key","access_key":"review-only-access-key"}',
      "-----BEGIN PRIVATE KEY-----",
      "cmV2aWV3LW9ubHktcHJpdmF0ZS1rZXk=",
      "-----END PRIVATE KEY-----",
    ].join("\n");

    const redacted = redactSecrets(text);
    assert.equal(redacted.includes("review-only-credential"), false);
    assert.equal(redacted.includes("review-only-private-key"), false);
    assert.equal(redacted.includes("review-only-access-key"), false);
    assert.equal(redacted.includes("BEGIN PRIVATE KEY"), false);
    assert.equal(containsSecretLikeValue(text), true);

    for (const benign of ["https://example.test/docs", "ordinary migration documentation"]) {
      assert.equal(redactSecrets(benign), benign);
      assert.equal(containsSecretLikeValue(benign), false);
    }
  });

  it("normalizes hostile secret key spellings without treating safety flags as stored values", () => {
    for (const key of ["api_key", "API-KEY", "private_Key", "access-key", "Credentials"]) {
      assert.equal(containsSecretLikeKey(key), true);
    }
    for (const key of ["credentialValuesStored", "rawSecretsStored", "managedEvidenceExcludes"]) {
      assert.equal(containsSecretLikeKey(key), false);
    }
  });

  it("detects and redacts synthetic host absolute paths in managed text", () => {
    const posix = "/Users/synthetic-agentmo/private.txt";
    const windows = "C:\\synthetic-agentmo\\private.txt";
    assert.equal(containsHostAbsolutePath(posix), true);
    assert.equal(containsHostAbsolutePath(windows), true);
    assert.equal(redactHostAbsolutePaths(posix).includes(posix), false);
    assert.equal(redactManagedText(`${posix} sk-syntheticcanary1234567890`).includes(REDACTED_PATH), true);
    assert.equal(redactManagedText(`${posix} sk-syntheticcanary1234567890`).includes(REDACTED_SECRET), true);
  });

  it("does not misclassify portable dot-relative references as host paths", () => {
    for (const portable of [
      "./bin/agentmo.js",
      "../pi/docs/evals.md",
      "<runtime-output>/agentmo-build-state.json",
      "${OUTPUT}/agentmo-run-state.json",
      "node ./bin/agentmo.js validate",
    ]) {
      assert.equal(containsHostAbsolutePath(portable), false, portable);
      assert.equal(redactHostAbsolutePaths(portable), portable);
    }
    assert.equal(containsHostAbsolutePath("See /private/synthetic/file.json"), true);
    assert.equal(containsHostAbsolutePath("--out=/tmp/synthetic-output"), true);
  });
});
