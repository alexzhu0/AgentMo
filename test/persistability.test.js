import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  PersistabilityError,
  assertPersistable,
  emitPersistableOutput,
  isRedactedSummary,
  isSecretPresence,
  isSecretRef,
  preparePersistableProductText,
  serializePersistableJson,
  writePersistableJsonAtomic,
  writePersistableProductTextAtomic,
  writePersistableTextAtomic,
} from "../src/persistability.js";

const SYNTHETIC_SECRET = "sk-syntheticcanary1234567890";
const SYNTHETIC_PATH = "/Users/synthetic-agentmo/private.txt";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeSummary(text = "bounded safe summary") {
  return {
    kind: "RedactedSummary",
    summaryKind: "structured-json-summary",
    sha256: sha256(text),
    length: Buffer.byteLength(text),
    redactedLength: Buffer.byteLength(text),
    text,
    redacted: true,
  };
}

function expectPersistabilityError(action, expectedCode) {
  assert.throws(action, (error) => {
    assert.equal(error instanceof PersistabilityError, true);
    assert.equal(error.code, expectedCode);
    assert.equal(error.message.includes(SYNTHETIC_SECRET), false);
    assert.equal(error.message.includes(SYNTHETIC_PATH), false);
    assert.equal(error.category, "persistability");
    assert.match(error.guidance, /bounded ordinary data/u);
    assert.equal(JSON.stringify(error).includes(SYNTHETIC_SECRET), false);
    assert.equal(JSON.stringify(error).includes(SYNTHETIC_PATH), false);
    return true;
  });
}

describe("persistability carriers", () => {
  it("accepts only the exact bounded SecretRef shape", () => {
    const value = { kind: "SecretRef", source: "runtime-env", name: "DEEPSEEK_API_KEY" };
    assert.equal(isSecretRef(value), true);
    assert.equal(assertPersistable(value), value);
    assert.equal(isSecretRef({ ...value, value: SYNTHETIC_SECRET }), false);
    assert.equal(isSecretRef({ ...value, name: "lowercase_key" }), false);
    assert.equal(isSecretRef({ ...value, name: `A${"B".repeat(128)}` }), false);
    expectPersistabilityError(() => assertPersistable({ ...value, value: SYNTHETIC_SECRET }), "AGENTMO_PERSISTABILITY_INVALID_CARRIER");
  });

  it("accepts only sorted, unique, exact SecretPresence partitions", () => {
    const value = {
      kind: "SecretPresence",
      source: "runtime-env",
      allowedNames: ["DEEPSEEK_API_KEY", "OPENCLAW_GATEWAY_TOKEN"],
      presentNames: ["DEEPSEEK_API_KEY"],
      missingNames: ["OPENCLAW_GATEWAY_TOKEN"],
      valuesPersisted: false,
    };
    assert.equal(isSecretPresence(value), true);
    assert.equal(assertPersistable(value), value);
    assert.equal(isSecretPresence({ ...value, presentNames: ["DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY"] }), false);
    assert.equal(isSecretPresence({ ...value, allowedNames: [...value.allowedNames].reverse() }), false);
    assert.equal(isSecretPresence({ ...value, missingNames: [] }), false);
    assert.equal(isSecretPresence({ ...value, valuesPersisted: true }), false);
    assert.equal(isSecretPresence({ ...value, rawValues: [SYNTHETIC_SECRET] }), false);
  });

  it("accepts only an exact internally consistent RedactedSummary", () => {
    const value = safeSummary();
    assert.equal(isRedactedSummary(value), true);
    assert.equal(assertPersistable(value), value);
    assert.equal(isRedactedSummary({ ...value, summaryKind: "raw-output-preview" }), false);
    assert.equal(isRedactedSummary({ ...value, sha256: "0".repeat(63) }), false);
    assert.equal(isRedactedSummary({ ...value, redactedLength: value.redactedLength + 1 }), false);
    assert.equal(isRedactedSummary({ ...value, text: `${value.text}!` }), false);
    assert.equal(isRedactedSummary({ ...value, text: "x".repeat(513), sha256: sha256("x".repeat(513)), length: 513, redactedLength: 513 }), false);
    assert.equal(isRedactedSummary({ ...value, raw: "forbidden" }), false);
  });
});

describe("descriptor-only persistability traversal", () => {
  it("accepts ordinary bounded AgentMo-shaped evidence", () => {
    const ordinary = {
      schemaVersion: "agentmo.discovery-db.v1",
      agentId: "wechat-ai-developer-writer",
      safety: {
        rawSecretsStored: false,
        rawTranscriptsStored: false,
        rawToolBodiesStored: false,
        credentialValuesStored: false,
        managedEvidenceExcludes: ["credential values", "raw transcripts", "raw tool bodies"],
      },
      runtimeEnv: {
        basename: ".env",
        fullPathPersisted: false,
      },
      evidence: [safeSummary("safe evidence summary")],
    };
    assert.equal(assertPersistable(ordinary), ordinary);
    assert.match(serializePersistableJson(ordinary), /agentmo\.discovery-db\.v1/u);
  });

  it("normalizes nested hostile key spellings and raw kinds", () => {
    for (const candidate of [
      { nested: { raw_Prompt: "synthetic raw material" } },
      { nested: { "RAW-TRANSCRIPT": "synthetic raw material" } },
      { nested: { tool_body: "synthetic raw material" } },
      { summaryKind: "raw-output-preview" },
      { evidenceKind: "raw-tool-body" },
      { nested: { api_key: SYNTHETIC_SECRET } },
      { stdout: { text: "synthetic full process output" } },
      { stderr: { text: "synthetic full process output" } },
      { checks: [{ note: "raw transcript canary material" }] },
      { rawTranscriptStored: {} },
      { rawSecretsStored: true },
      { credentialValuesStored: true },
      { valuesPersisted: true },
      { fullPathPersisted: true },
    ]) {
      expectPersistabilityError(() => assertPersistable(candidate), "AGENTMO_PERSISTABILITY_SENSITIVE_MATERIAL");
    }
  });

  it("rejects secret-like values, host paths, and hostile subject or pointer text without echoing them", () => {
    expectPersistabilityError(() => assertPersistable({ nested: SYNTHETIC_SECRET }), "AGENTMO_PERSISTABILITY_SENSITIVE_MATERIAL");
    expectPersistabilityError(() => assertPersistable({ nested: SYNTHETIC_PATH }), "AGENTMO_PERSISTABILITY_SENSITIVE_MATERIAL");
    expectPersistabilityError(
      () => assertPersistable({ subject: SYNTHETIC_PATH, pointer: "$.raw-transcript" }),
      "AGENTMO_PERSISTABILITY_SENSITIVE_MATERIAL",
    );
    expectPersistabilityError(
      () => assertPersistable({ ok: true }, { subject: `unsafe:${SYNTHETIC_SECRET}` }),
      "AGENTMO_PERSISTABILITY_INVALID_SUBJECT",
    );
  });

  it("never invokes getters and rejects symbols, cycles, hostile prototypes, and non-JSON values", () => {
    let getterCalls = 0;
    const getterCandidate = {};
    Object.defineProperty(getterCandidate, "safe", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return SYNTHETIC_SECRET;
      },
    });
    expectPersistabilityError(() => assertPersistable(getterCandidate), "AGENTMO_PERSISTABILITY_ACCESSOR");
    assert.equal(getterCalls, 0);

    const symbolCandidate = { ok: true };
    symbolCandidate[Symbol("hidden")] = "hidden";
    expectPersistabilityError(() => assertPersistable(symbolCandidate), "AGENTMO_PERSISTABILITY_UNSUPPORTED_VALUE");

    const cyclic = {};
    cyclic.self = cyclic;
    expectPersistabilityError(() => assertPersistable(cyclic), "AGENTMO_PERSISTABILITY_CYCLE");
    expectPersistabilityError(() => assertPersistable(Object.create({ inherited: true })), "AGENTMO_PERSISTABILITY_HOSTILE_OBJECT");
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, 1n, undefined, () => {}]) {
      expectPersistabilityError(() => assertPersistable({ value }), "AGENTMO_PERSISTABILITY_UNSUPPORTED_VALUE");
    }
  });

  it("fails closed on depth, node, and byte budgets", () => {
    let deep = { leaf: true };
    for (let index = 0; index < 12; index += 1) deep = { next: deep };
    expectPersistabilityError(
      () => assertPersistable(deep, { maxDepth: 8 }),
      "AGENTMO_PERSISTABILITY_RESOURCE_BUDGET",
    );
    expectPersistabilityError(
      () => assertPersistable({ values: Array.from({ length: 20 }, (_, index) => index) }, { maxNodes: 10 }),
      "AGENTMO_PERSISTABILITY_RESOURCE_BUDGET",
    );
    expectPersistabilityError(
      () => serializePersistableJson({ text: "x".repeat(100) }, { maxBytes: 40 }),
      "AGENTMO_PERSISTABILITY_RESOURCE_BUDGET",
    );
  });
});

describe("pre-persistence helpers", () => {
  function recordingIo() {
    const calls = [];
    return {
      calls,
      io: {
        async mkdir(...args) { calls.push(["mkdir", ...args]); },
        async writeFile(...args) { calls.push(["writeFile", ...args]); },
        async rename(...args) { calls.push(["rename", ...args]); },
      },
    };
  }

  it("validates JSON candidates before any filesystem side effect", async () => {
    const recorder = recordingIo();
    await assert.rejects(
      writePersistableJsonAtomic("/synthetic/output.json", { rawPrompt: "synthetic raw material" }, { io: recorder.io }),
      (error) => error.code === "AGENTMO_PERSISTABILITY_SENSITIVE_MATERIAL",
    );
    assert.deepEqual(recorder.calls, []);
  });

  it("validates text before mkdir, temp write, or rename", async () => {
    const recorder = recordingIo();
    await assert.rejects(
      writePersistableTextAtomic("/synthetic/output.txt", SYNTHETIC_SECRET, { io: recorder.io }),
      (error) => error.code === "AGENTMO_PERSISTABILITY_SENSITIVE_MATERIAL",
    );
    assert.deepEqual(recorder.calls, []);
  });

  it("brands schema-owned product text while still rejecting secrets and concrete host paths", async () => {
    const candidate = preparePersistableProductText(
      "Prompt policy: do not expose raw transcripts. Use ./bin/tool and <workspace>/skills.",
      { subject: "scaffold-file" },
    );
    const recorder = recordingIo();
    await writePersistableProductTextAtomic("/synthetic/product.md", candidate, {
      io: recorder.io,
      subject: "scaffold-file",
    });
    assert.deepEqual(recorder.calls.map(([name]) => name), ["mkdir", "writeFile", "rename"]);
    assert.match(recorder.calls[1][2], /raw transcripts/u);

    for (const hostile of [SYNTHETIC_SECRET, SYNTHETIC_PATH]) {
      expectPersistabilityError(
        () => preparePersistableProductText(hostile, { subject: "scaffold-file" }),
        "AGENTMO_PERSISTABILITY_SENSITIVE_MATERIAL",
      );
    }
    await assert.rejects(
      writePersistableProductTextAtomic("/synthetic/forged.md", Object.freeze({ text: "safe" }), {
        io: recordingIo().io,
        subject: "scaffold-file",
      }),
      (error) => error.code === "AGENTMO_PERSISTABILITY_UNSUPPORTED_VALUE",
    );
  });

  it("performs a validated atomic JSON write in order", async () => {
    const recorder = recordingIo();
    await writePersistableJsonAtomic("/synthetic/output.json", { ok: true }, { io: recorder.io });
    assert.deepEqual(recorder.calls.map(([name]) => name), ["mkdir", "writeFile", "rename"]);
    assert.match(recorder.calls[1][2], /"ok": true/u);
    assert.equal(recorder.calls[1][2].endsWith("\n"), true);
  });

  it("validates both emitter candidate and formatted text before invoking the sink", async () => {
    const events = [];
    await assert.rejects(
      emitPersistableOutput({
        candidate: { rawPrompt: "synthetic raw material" },
        json: false,
        format: () => { events.push("format"); return "safe"; },
        sink: async () => { events.push("sink"); },
      }),
      (error) => error.code === "AGENTMO_PERSISTABILITY_SENSITIVE_MATERIAL",
    );
    assert.deepEqual(events, []);

    await assert.rejects(
      emitPersistableOutput({
        candidate: { ok: true },
        json: false,
        format: () => { events.push("format"); return SYNTHETIC_SECRET; },
        sink: async () => { events.push("sink"); },
      }),
      (error) => error.code === "AGENTMO_PERSISTABILITY_SENSITIVE_MATERIAL",
    );
    assert.deepEqual(events, ["format"]);

    events.length = 0;
    await assert.rejects(
      emitPersistableOutput({
        candidate: { ok: true },
        json: true,
        format: () => { events.push("format"); return '{"rawTranscript":"synthetic raw material"}\n'; },
        sink: async () => { events.push("sink"); },
      }),
      (error) => error.code === "AGENTMO_PERSISTABILITY_SENSITIVE_MATERIAL",
    );
    assert.deepEqual(events, ["format"]);

    events.length = 0;
    const result = await emitPersistableOutput({
      candidate: { ok: true },
      json: true,
      format: (value) => { events.push("format"); return serializePersistableJson(value); },
      sink: async (text) => { events.push(["sink", text]); return "written"; },
    });
    assert.equal(result, "written");
    assert.deepEqual(events, ["format", ["sink", "{\n  \"ok\": true\n}\n"]]);

    events.length = 0;
    const stdoutSummary = safeSummary("safe process summary");
    await emitPersistableOutput({
      candidate: { stdout: stdoutSummary },
      json: true,
      format: (value) => serializePersistableJson(value),
      sink: async () => { events.push("sink"); },
    });
    assert.deepEqual(events, ["sink"]);
  });

  it("rejects every hostile candidate or exact formatted payload before the first sink byte", async () => {
    const hostileCandidates = [
      { nested: SYNTHETIC_SECRET },
      { nested: SYNTHETIC_PATH },
      { nested: { rawPrompt: "synthetic material" } },
      { nested: { "RAW-TRANSCRIPT": "synthetic material" } },
      { nested: { tool_body: "synthetic material" } },
      { stdout: { text: "synthetic process material" } },
      { subject: "$.raw-transcript" },
      { pointer: "$.tool-output" },
    ];
    for (const candidate of hostileCandidates) {
      const events = [];
      await assert.rejects(
        emitPersistableOutput({
          candidate,
          json: true,
          format: () => { events.push("format"); return "{}\n"; },
          sink: () => { events.push("sink"); },
        }),
        (error) => error.code === "AGENTMO_PERSISTABILITY_SENSITIVE_MATERIAL",
      );
      assert.deepEqual(events, []);
    }

    const formattedPayloads = [
      `${JSON.stringify({ nested: SYNTHETIC_SECRET })}\n`,
      `${JSON.stringify({ nested: SYNTHETIC_PATH })}\n`,
      '{"rawPrompt":"synthetic material"}\n',
      '{"RAW-TRANSCRIPT":"synthetic material"}\n',
      '{"tool_body":"synthetic material"}\n',
      '{"stdout":{"text":"synthetic process material"}}\n',
      '{"pointer":"$.raw-transcript"}\n',
    ];
    for (const formatted of formattedPayloads) {
      const events = [];
      await assert.rejects(
        emitPersistableOutput({
          candidate: { ok: true },
          json: true,
          format: () => { events.push("format"); return formatted; },
          sink: () => { events.push("sink"); },
        }),
        (error) => error.code === "AGENTMO_PERSISTABILITY_SENSITIVE_MATERIAL",
      );
      assert.deepEqual(events, ["format"]);
    }
  });

  it("requires JSON emitter text to encode the complete validated candidate exactly", async () => {
    const events = [];
    await assert.rejects(
      emitPersistableOutput({
        candidate: { ok: true, status: "safe" },
        json: true,
        format: () => { events.push("format"); return '{"ok":true}\n'; },
        sink: () => { events.push("sink"); },
      }),
      (error) => error.code === "AGENTMO_PERSISTABILITY_OUTPUT_MISMATCH",
    );
    assert.deepEqual(events, ["format"]);
  });
});
