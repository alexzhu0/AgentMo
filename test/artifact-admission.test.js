import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it } from "node:test";
import {
  ArtifactAdmissionError,
  admittedArtifactProvenance,
  digestRawBytes,
  loadAdmittedArtifact,
  parseDigestBindings,
} from "../src/artifact-admission.js";
import {
  DURABLE_ARTIFACT_REGISTRY,
  listDurableArtifactDescriptors,
} from "../src/artifact-registry.js";
import { admitBlueprint } from "./helpers/admitted-blueprint.js";
import {
  buildAndAdmitRuntimePlan as createAdmittedRuntimePlan,
  executeAdmittedRuntimeRun,
} from "./helpers/admitted-runtime.js";

const CLI = fileURLToPath(new URL("../bin/agentmo.js", import.meta.url));
const SUPPORT_DISCOVERY = fileURLToPath(new URL("../examples/support-triage.discovery.json", import.meta.url));
const DISCOVERY_DB = fileURLToPath(new URL("../examples/fixtures/support-triage/prebuilt-discovery-db.json", import.meta.url));
const USER_NEED = fileURLToPath(new URL("../examples/support-triage.need.json", import.meta.url));
const SUPPORT_BLUEPRINT = fileURLToPath(new URL("../examples/support-triage.agentmo.json", import.meta.url));

function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
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

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function redactedSummary(text) {
  return {
    kind: "RedactedSummary",
    summaryKind: text.length === 0 ? "empty" : "structured-json-summary",
    sha256: createHash("sha256").update(text).digest("hex"),
    length: Buffer.byteLength(text),
    redactedLength: Buffer.byteLength(text),
    text,
    redacted: true,
  };
}

async function rejectsWithCode(operation, code, forbidden = []) {
  await assert.rejects(operation, (error) => {
    if (code.startsWith("AGENTMO_ARTIFACT_")) {
      assert.equal(error instanceof ArtifactAdmissionError, true);
    }
    assert.equal(error.code, code);
    const serialized = JSON.stringify(error);
    for (const value of forbidden) {
      assert.equal(error.message.includes(value), false);
      assert.equal(serialized.includes(value), false);
    }
    return true;
  });
}

describe("artifact admission", () => {
  it("keeps the registry closed to the canonical stage and runtime artifact descriptors", () => {
    assert.equal(Object.isFrozen(DURABLE_ARTIFACT_REGISTRY), true);
    assert.deepEqual(
      DURABLE_ARTIFACT_REGISTRY.map((descriptor) => descriptor.subject),
      [
        "discovery-manifest",
        "discovery-db",
        "user-need",
        "design-plan",
        "blueprint",
        "handoff",
        "build-state",
        "runtime-plan",
        "run-state",
        "run-index",
        "observation",
        "report",
        "run-eval",
        "birth-report",
        "domain-cases",
        "domain-eval",
        "delivery-report",
      ],
    );
    assert.equal(DURABLE_ARTIFACT_REGISTRY.every(Object.isFrozen), true);
    assert.deepEqual(
      listDurableArtifactDescriptors().map((descriptor) => descriptor.identity),
      [
        "agentmo.discovery.v1",
        "agentmo.discovery-db.v1",
        "agentmo.user-need.v1",
        "agentmo.design-plan.v1",
        "0.1",
        "agentmo.handoff.v1",
        "agentmo.build-state.v1",
        "agentmo.runtime-plan.v1",
        "agentmo.run.v1",
        "agentmo.run-index.v1",
        "agentmo.observation.v1",
        "agentmo_report",
        "agentmo.run-eval.v1",
        "agentmo.birth-report.v1",
        "agentmo.domain-cases.v1",
        "agentmo.domain-eval.v1",
        "agentmo.delivery.v1",
      ],
    );
  });

  it("keeps report and evidence descriptors strict instead of accepting identity-only objects", () => {
    const descriptors = new Map(DURABLE_ARTIFACT_REGISTRY.map((descriptor) => [descriptor.subject, descriptor]));
    const identityOnly = {
      report: { kind: "agentmo_report" },
      "run-eval": { schemaVersion: "agentmo.run-eval.v1" },
      "birth-report": { schemaVersion: "agentmo.birth-report.v1" },
      "domain-cases": { schemaVersion: "agentmo.domain-cases.v1" },
      "domain-eval": { schemaVersion: "agentmo.domain-eval.v1" },
      "delivery-report": { schemaVersion: "agentmo.delivery.v1" },
    };
    for (const [subject, candidate] of Object.entries(identityOnly)) {
      assert.equal(descriptors.get(subject).validate_canonical_input(candidate), false);
    }
  });

  it("admits exact runtime-plan bytes and rejects byte mutation or a run-state subject swap", async () => {
    const blueprintAdmission = await admitBlueprint(SUPPORT_BLUEPRINT);
    const fixture = await createAdmittedRuntimePlan(blueprintAdmission.value, {
      target: "openclaw",
      workspace: "/tmp/agentmo-runtime-workspace",
      message: "ping",
    });

    assert.equal(fixture.runtimePlanAdmission.identity, "agentmo.runtime-plan.v1");
    assert.equal(fixture.runtimePlanAdmission.subject, "runtime-plan");
    const mutatedBytes = Buffer.concat([fixture.runtimePlanBytes, Buffer.from(" ")]);
    await writeFile(fixture.runtimePlanFile, mutatedBytes);
    await rejectsWithCode(
      () => loadAdmittedArtifact({
        filePath: fixture.runtimePlanFile,
        subject: "runtime-plan",
        expectedDigest: fixture.runtimePlanAdmission.digest,
      }),
      "AGENTMO_ARTIFACT_DIGEST_MISMATCH",
      [fixture.runtimePlanFile],
    );

    await writeFile(fixture.runtimePlanFile, fixture.runtimePlanBytes);
    await rejectsWithCode(
      () => loadAdmittedArtifact({
        filePath: fixture.runtimePlanFile,
        subject: "run-state",
        expectedDigest: fixture.runtimePlanAdmission.digest,
      }),
      "AGENTMO_UNSUPPORTED_ARTIFACT",
      [fixture.runtimePlanFile],
    );
  });

  it("admits exact observation bytes and rejects mutation, family swap, or unknown identity", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-observation-admission-"));
    const file = path.join(root, "observation.json");
    const observation = {
      schemaVersion: "agentmo.observation.v1",
      agentId: "support-triage",
      source: {
        identity: "agentmo.run.v1",
        subject: "run-state",
        digest: `sha256:${"a".repeat(64)}`,
      },
      failureMode: "declared evidence only",
      proposedRegression: {
        id: "support-triage-observation-fixture",
        description: "Preserve declared runtime evidence coverage.",
        expectedEvidence: "A bounded reviewed runtime evidence result.",
      },
      recommendedBlueprintChange: {
        section: "runtime_profiles",
        proposal: "Review the evidence before proposing any governed change.",
      },
      status: "proposed",
      runEvidence: {
        runId: "observation-fixture",
        parentRunId: null,
        targetId: "openclaw",
        runtime: "openclaw",
        provider: null,
        model: null,
        channel: "local-cli",
        transport: "local",
        fallbackFrom: null,
        executionStatus: "declared",
        exitCode: null,
        timedOut: false,
        replayFidelity: "unavailable",
        stdoutSummary: redactedSummary(""),
        stderrSummary: redactedSummary(""),
        certificationBoundary: {
          runtimeCertifiedByRun: false,
          domainCertifiedByRun: false,
        },
      },
      mutation: {
        autoApplied: false,
        blueprintMutated: false,
        scaffoldMutated: false,
        runtimeMutated: false,
        evalsMutated: false,
        reason: "Observation evidence is proposal-only.",
      },
    };
    const bytes = Buffer.from(`${JSON.stringify(observation, null, 2)}\n`, "utf8");
    await writeFile(file, bytes);

    const admission = await loadAdmittedArtifact({
      filePath: file,
      subject: "observation",
      expectedDigest: sha256(bytes),
    });
    assert.equal(admission.identity, "agentmo.observation.v1");
    assert.equal(admission.subject, "observation");

    await writeFile(file, Buffer.concat([bytes, Buffer.from(" ")]));
    await rejectsWithCode(
      () => loadAdmittedArtifact({ filePath: file, subject: "observation", expectedDigest: admission.digest }),
      "AGENTMO_ARTIFACT_DIGEST_MISMATCH",
      [file],
    );

    await writeFile(file, bytes);
    await rejectsWithCode(
      () => loadAdmittedArtifact({ filePath: file, subject: "run-state", expectedDigest: admission.digest }),
      "AGENTMO_UNSUPPORTED_ARTIFACT",
      [file],
    );

    const unknownBytes = Buffer.from(`${JSON.stringify({ ...observation, schemaVersion: "agentmo.observation.unknown" }, null, 2)}\n`, "utf8");
    await writeFile(file, unknownBytes);
    await rejectsWithCode(
      () => loadAdmittedArtifact({ filePath: file, subject: "observation", expectedDigest: sha256(unknownBytes) }),
      "AGENTMO_UNSUPPORTED_ARTIFACT",
      [file],
    );
  });

  it("rejects nested provenance duplicate members before JSON last-wins parsing", async () => {
    const blueprintAdmission = await admitBlueprint(SUPPORT_BLUEPRINT);
    const { runState } = await executeAdmittedRuntimeRun(blueprintAdmission.value, {
      target: "openclaw",
      workspace: "/tmp/agentmo-runtime-workspace",
      message: "ping",
      runId: "duplicate-provenance-run",
      now: "2026-07-12T00:00:00.000Z",
    });
    const original = `"identity": "agentmo.runtime-plan.v1"`;
    const duplicate = `${original},\n      ${original}`;
    const raw = `${JSON.stringify(runState, null, 2).replace(original, duplicate)}\n`;
    const directory = await mkdtemp(path.join(tmpdir(), "agentmo-run-duplicate-provenance-"));
    const file = path.join(directory, "run-state.json");
    const bytes = Buffer.from(raw, "utf8");
    await writeFile(file, bytes);

    await rejectsWithCode(
      () => loadAdmittedArtifact({
        filePath: file,
        subject: "run-state",
        expectedDigest: digestRawBytes(bytes),
      }),
      "AGENTMO_UNSUPPORTED_ARTIFACT",
      [file],
    );
  });

  it("hashes only exact Buffer bytes using the canonical digest syntax", () => {
    const bytes = Buffer.from("{\"schemaVersion\":\"agentmo.discovery-db.v1\"}\n", "utf8");
    assert.equal(digestRawBytes(bytes), sha256(bytes));
    assert.throws(
      () => digestRawBytes({ schemaVersion: "agentmo.discovery-db.v1" }),
      (error) => error.code === "AGENTMO_ARTIFACT_BYTES_REQUIRED",
    );
  });

  it("parses an exact, frozen, one-to-one binding map", () => {
    const first = `sha256:${"a".repeat(64)}`;
    const second = `sha256:${"b".repeat(64)}`;
    const bindings = parseDigestBindings(
      [`discovery-db=${first}`, `user-need=${second}`],
      ["discovery-db", "user-need"],
    );
    assert.equal(Object.getPrototypeOf(bindings), null);
    assert.equal(Object.isFrozen(bindings), true);
    assert.deepEqual({ ...bindings }, {
      "discovery-db": first,
      "user-need": second,
    });

    const cases = [
      { values: [`discovery-db=${first}`], code: "AGENTMO_ARTIFACT_DIGEST_REQUIRED" },
      { values: [`discovery-db=${first}`, `discovery-db=${first}`, `user-need=${second}`], code: "AGENTMO_ARTIFACT_DIGEST_DUPLICATE" },
      { values: [`discovery-db=${first}`, `user-need=${second}`, `private-subject-canary=${first}`], code: "AGENTMO_ARTIFACT_DIGEST_UNKNOWN_SUBJECT" },
      { values: ["discovery-db=not-a-digest", `user-need=${second}`], code: "AGENTMO_ARTIFACT_DIGEST_INVALID" },
      { values: [`discovery-db=${first}`, `user-need=${second}=trailing`], code: "AGENTMO_ARTIFACT_DIGEST_INVALID" },
    ];
    for (const testCase of cases) {
      assert.throws(
        () => parseDigestBindings(testCase.values, ["discovery-db", "user-need"]),
        (error) => {
          assert.equal(error.code, testCase.code);
          assert.equal(error.message.includes("private-subject-canary"), false);
          return true;
        },
      );
    }
  });

  it("admits canonical discovery-db and user-need bytes only after exact digest proof", async () => {
    const dbBytes = await readFile(DISCOVERY_DB);
    const needBytes = await readFile(USER_NEED);
    const db = await loadAdmittedArtifact({
      filePath: DISCOVERY_DB,
      subject: "discovery-db",
      expectedDigest: sha256(dbBytes),
    });
    const need = await loadAdmittedArtifact({
      filePath: USER_NEED,
      subject: "user-need",
      expectedDigest: sha256(needBytes),
    });
    assert.equal(db.subject, "discovery-db");
    assert.equal(db.identity, "agentmo.discovery-db.v1");
    assert.equal(db.digest, sha256(dbBytes));
    assert.equal(db.value.schemaVersion, "agentmo.discovery-db.v1");
    assert.equal(need.subject, "user-need");
    assert.equal(need.identity, "agentmo.user-need.v1");
    assert.equal(need.value.schemaVersion, "agentmo.user-need.v1");
    assert.equal(Object.isFrozen(db.value), true);
    assert.deepEqual(admittedArtifactProvenance(db, {
      subject: "discovery-db",
      value: db.value,
    }), {
      identity: "agentmo.discovery-db.v1",
      subject: "discovery-db",
      digest: sha256(dbBytes),
    });
    const forged = Object.freeze({ ...db });
    assert.throws(
      () => admittedArtifactProvenance(forged, { subject: "discovery-db", value: db.value }),
      (error) => error.code === "AGENTMO_ARTIFACT_ADMISSION_RESULT_INVALID",
    );
  });

  it("rejects host absolute paths centrally across durable families while preserving portable references", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-admission-host-path-"));
    const hostPath = "/Users/private-agentmo/should-not-persist.txt";
    const cases = [
      {
        subject: "discovery-manifest",
        source: SUPPORT_DISCOVERY,
        mutate: (value) => { value.source_inventory[0].description = hostPath; },
      },
      {
        subject: "discovery-db",
        source: DISCOVERY_DB,
        mutate: (value) => { value.facts[0].text = hostPath; },
      },
      {
        subject: "user-need",
        source: USER_NEED,
        mutate: (value) => { value.problem = hostPath; },
      },
      {
        subject: "blueprint",
        source: SUPPORT_BLUEPRINT,
        mutate: (value) => { value.runtime_profiles[0].purpose = hostPath; },
      },
    ];
    const descriptors = new Map(DURABLE_ARTIFACT_REGISTRY.map((descriptor) => [descriptor.subject, descriptor]));

    for (const [index, testCase] of cases.entries()) {
      const value = JSON.parse(await readFile(testCase.source, "utf8"));
      testCase.mutate(value);
      assert.equal(
        descriptors.get(testCase.subject).validate_canonical_input(value),
        true,
        `${testCase.subject} probe must remain schema-permitted so admission owns the boundary`,
      );
      const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
      const file = path.join(root, `candidate-${index}.json`);
      await writeFile(file, bytes);
      await rejectsWithCode(
        () => loadAdmittedArtifact({ filePath: file, subject: testCase.subject, expectedDigest: sha256(bytes) }),
        "AGENTMO_ARTIFACT_UNSAFE_CONTENT",
        [root, hostPath, "private-agentmo"],
      );
    }

    const portable = JSON.parse(await readFile(SUPPORT_DISCOVERY, "utf8"));
    portable.source_inventory[0].location = "https://example.com/support/policy";
    portable.source_inventory[0].extraction_fields.push("managed/reference.md");
    portable.source_inventory[0].extraction_fields.push("./bin/agentmo.js");
    portable.source_inventory[0].extraction_fields.push("../pi/reference.md");
    const portableBytes = Buffer.from(`${JSON.stringify(portable, null, 2)}\n`, "utf8");
    const portableFile = path.join(root, "portable.json");
    await writeFile(portableFile, portableBytes);
    const admitted = await loadAdmittedArtifact({
      filePath: portableFile,
      subject: "discovery-manifest",
      expectedDigest: sha256(portableBytes),
    });
    assert.equal(admitted.value.source_inventory[0].location, "https://example.com/support/policy");
    assert.equal(admitted.value.source_inventory[0].extraction_fields.includes("managed/reference.md"), true);
    assert.equal(admitted.value.source_inventory[0].extraction_fields.includes("./bin/agentmo.js"), true);
    assert.equal(admitted.value.source_inventory[0].extraction_fields.includes("../pi/reference.md"), true);
  });

  it("rejects byte replacement before decode, identity inspection, parse, or validation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-admission-order-"));
    const invalidUtf8 = path.join(root, "private-invalid-canary.json");
    const invalidBytes = Buffer.from([0xff, 0xfe, 0xfd]);
    await writeFile(invalidUtf8, invalidBytes);
    const wrong = `sha256:${"0".repeat(64)}`;
    await rejectsWithCode(
      () => loadAdmittedArtifact({ filePath: invalidUtf8, subject: "discovery-db", expectedDigest: wrong }),
      "AGENTMO_ARTIFACT_DIGEST_MISMATCH",
      [root, "private-invalid-canary"],
    );
    await rejectsWithCode(
      () => loadAdmittedArtifact({ filePath: invalidUtf8, subject: "discovery-db", expectedDigest: sha256(invalidBytes) }),
      "AGENTMO_ARTIFACT_INVALID_UTF8",
      [root, "private-invalid-canary"],
    );

    const duplicatePath = path.join(root, "private-duplicate-canary.json");
    const duplicateBytes = Buffer.from(
      '{"schemaVersion":"agentmo.user-need.v1","schemaVersion":"agentmo.user-need.v1"}',
      "utf8",
    );
    await writeFile(duplicatePath, duplicateBytes);
    await rejectsWithCode(
      () => loadAdmittedArtifact({ filePath: duplicatePath, subject: "user-need", expectedDigest: sha256(duplicateBytes) }),
      "AGENTMO_UNSUPPORTED_ARTIFACT",
      [root, "private-duplicate-canary"],
    );

    const canonicalBytes = await readFile(USER_NEED);
    const canonical = JSON.parse(canonicalBytes.toString("utf8"));
    const variants = [
      Buffer.from(`${JSON.stringify(canonical)}\n`, "utf8"),
      Buffer.from(`${JSON.stringify({ ...canonical, schemaVersion: canonical.schemaVersion }, null, 4)}\n`, "utf8"),
      Buffer.from(`${canonicalBytes.toString("utf8")} `, "utf8"),
    ];
    for (const [index, variant] of variants.entries()) {
      const file = path.join(root, `variant-${index}.json`);
      await writeFile(file, variant);
      await rejectsWithCode(
        () => loadAdmittedArtifact({ filePath: file, subject: "user-need", expectedDigest: sha256(canonicalBytes) }),
        "AGENTMO_ARTIFACT_DIGEST_MISMATCH",
        [root],
      );
    }
  });

  it("fails closed for unknown, swapped, and supported legacy identities without disclosure", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-admission-identity-"));
    const canary = "fixture-only-admission-canary";
    const unknownPath = path.join(root, "private-unknown-canary.json");
    const unknownBytes = Buffer.from(JSON.stringify({ schemaVersion: "agentmo.unknown.v1", note: canary }), "utf8");
    await writeFile(unknownPath, unknownBytes);
    await rejectsWithCode(
      () => loadAdmittedArtifact({ filePath: unknownPath, subject: "discovery-db", expectedDigest: sha256(unknownBytes) }),
      "AGENTMO_UNSUPPORTED_ARTIFACT",
      [root, "private-unknown-canary", canary],
    );

    const needBytes = await readFile(USER_NEED);
    await rejectsWithCode(
      () => loadAdmittedArtifact({ filePath: USER_NEED, subject: "discovery-db", expectedDigest: sha256(needBytes) }),
      "AGENTMO_UNSUPPORTED_ARTIFACT",
      [USER_NEED],
    );

    const legacyPath = fileURLToPath(new URL("./fixtures/migration/legacy-blueprint.json", import.meta.url));
    const legacyBytes = await readFile(legacyPath);
    await rejectsWithCode(
      () => loadAdmittedArtifact({ filePath: legacyPath, subject: "discovery-db", expectedDigest: sha256(legacyBytes) }),
      "AGENTMO_MIGRATION_REQUIRED",
      [legacyPath],
    );

    const unsafePath = path.join(root, "private-unsafe-canary.json");
    const unsafe = JSON.parse(await readFile(USER_NEED, "utf8"));
    unsafe.rawTranscript = canary;
    const unsafeBytes = Buffer.from(JSON.stringify(unsafe), "utf8");
    await writeFile(unsafePath, unsafeBytes);
    await rejectsWithCode(
      () => loadAdmittedArtifact({ filePath: unsafePath, subject: "user-need", expectedDigest: sha256(unsafeBytes) }),
      "AGENTMO_ARTIFACT_UNSAFE_CONTENT",
      [root, "private-unsafe-canary", canary],
    );

    await rejectsWithCode(
      () => loadAdmittedArtifact({
        filePath: USER_NEED,
        subject: "user-need",
        expectedDigest: sha256(needBytes),
        maxBytes: 8,
      }),
      "AGENTMO_ARTIFACT_INPUT_TOO_LARGE",
      [USER_NEED],
    );
  });

  it("runs design-plan in a fresh process from two exact bindings and writes nothing on mismatch", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-admission-fresh-process-"));
    const out = path.join(root, "agentmo-design-plan.json");
    const dbDigest = sha256(await readFile(DISCOVERY_DB));
    const needDigest = sha256(await readFile(USER_NEED));
    const args = [
      "design-plan",
      DISCOVERY_DB,
      "--need",
      USER_NEED,
      "--digest",
      `discovery-db=${dbDigest}`,
      "--digest",
      `user-need=${needDigest}`,
      "--out",
      out,
      "--target",
      "openclaw",
      "--json",
    ];
    const success = await runCli(args);
    assert.equal(success.code, 0, success.stderr);
    assert.equal(JSON.parse(success.stdout).designPlan.schemaVersion, "agentmo.design-plan.v1");

    const badOut = path.join(root, "must-not-exist.json");
    const mismatch = await runCli(args.map((value) => value === out ? badOut : value).map((value) =>
      value === `user-need=${needDigest}` ? `user-need=${dbDigest}` : value));
    assert.equal(mismatch.code, 1);
    await assert.rejects(() => access(badOut));
    for (const forbidden of [root, path.basename(USER_NEED), path.basename(DISCOVERY_DB)]) {
      assert.equal(mismatch.stdout.includes(forbidden), false);
      assert.equal(mismatch.stderr.includes(forbidden), false);
    }

    const blueprintDigest = sha256(await readFile(SUPPORT_BLUEPRINT));
    const plan = await runCli([
      "plan",
      SUPPORT_BLUEPRINT,
      "--digest",
      `blueprint=${blueprintDigest}`,
      "--target",
      "openclaw",
      "--json",
    ]);
    assert.equal(plan.code, 0, plan.stderr);
    assert.equal(JSON.parse(plan.stdout).target.id, "openclaw");
  });

  it("returns bounded human and JSON errors for every binding-map failure", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-admission-binding-errors-"));
    const dbDigest = sha256(await readFile(DISCOVERY_DB));
    const needDigest = sha256(await readFile(USER_NEED));
    const prefix = ["design-plan", DISCOVERY_DB, "--need", USER_NEED];
    const suffix = ["--out", path.join(root, "must-not-exist.json"), "--target", "openclaw", "--json"];
    const cases = [
      {
        bindings: ["--digest", `discovery-db=${dbDigest}`],
        code: "AGENTMO_ARTIFACT_DIGEST_REQUIRED",
      },
      {
        bindings: ["--digest", `discovery-db=${dbDigest}`, "--digest", `discovery-db=${dbDigest}`, "--digest", `user-need=${needDigest}`],
        code: "AGENTMO_ARTIFACT_DIGEST_DUPLICATE",
      },
      {
        bindings: ["--digest", `discovery-db=${dbDigest}`, "--digest", `user-need=${needDigest}`, "--digest", `private-subject-canary=${dbDigest}`],
        code: "AGENTMO_ARTIFACT_DIGEST_UNKNOWN_SUBJECT",
      },
      {
        bindings: ["--digest", "discovery-db=private-digest-canary", "--digest", `user-need=${needDigest}`],
        code: "AGENTMO_ARTIFACT_DIGEST_INVALID",
      },
    ];

    for (const testCase of cases) {
      const result = await runCli([...prefix, ...testCase.bindings, ...suffix]);
      assert.equal(result.code, 1);
      assert.equal(result.stderr, "");
      const error = JSON.parse(result.stdout);
      assert.equal(error.code, testCase.code);
      assert.equal(error.ok, false);
      for (const forbidden of [root, "private-subject-canary", "private-digest-canary"]) {
        assert.equal(result.stdout.includes(forbidden), false);
        assert.equal(result.stderr.includes(forbidden), false);
      }
    }
    await assert.rejects(() => access(path.join(root, "must-not-exist.json")));

    const human = await runCli([
      ...prefix,
      "--digest",
      `discovery-db=${dbDigest}`,
      "--digest",
      `user-need=${dbDigest}`,
      "--out",
      path.join(root, "human-must-not-exist.json"),
    ]);
    assert.equal(human.code, 1);
    assert.equal(human.stdout, "");
    assert.match(human.stderr, /AGENTMO_ARTIFACT_DIGEST_MISMATCH/u);
    assert.equal(human.stderr.includes(root), false);
  });
});
