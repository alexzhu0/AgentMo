import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AgentMoMigrationRequiredError,
  LEGACY_ARTIFACT_REGISTRY,
  inspectArtifactForMigration,
  transformLegacyArtifact,
} from "../src/artifact-registry.js";
import { loadAdmittedBlueprint } from "../src/blueprint.js";
import { loadBuildState } from "../src/control-snapshot.js";
import {
  MIGRATION_PLAN_SCHEMA_VERSION,
  MIGRATION_RECEIPT_SCHEMA_VERSION,
  buildMigrationReceipt,
  planArtifactMigrationBytes,
  serializeMigrationPlan,
  validateMigrationPlanForReceipt,
} from "../src/artifact-migration.js";
import {
  applyArtifactMigration as applyArtifactMigrationWithBindings,
  MIGRATION_INSTANCE_MARKER_BASENAME,
  MIGRATION_RECEIPT_BASENAME,
  planArtifactMigration as planArtifactMigrationFromFiles,
  probeMigrationApplyCapabilities,
  verifyMigrationOutput,
} from "../src/migration-filesystem.js";
import { auditMigrationCandidate } from "../src/evidence-audit.js";

const FIXTURE_ROOT = new URL("./fixtures/migration/", import.meta.url);
const PARENT_SWAP_CHILD = fileURLToPath(
  new URL("./helpers/migration-parent-swap-child.js", import.meta.url),
);
const PLAN_DIGEST_BINDINGS = new WeakMap();

function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function migrationDigestBindings(inputs) {
  const entries = [];
  for (const [index, input] of inputs.entries()) {
    entries.push([`migration-input-${index}`, digestBytes(await readFile(input))]);
  }
  return Object.freeze(Object.fromEntries(entries));
}

async function planArtifactMigration(inputs, options = {}) {
  const digests = options.digests ?? await migrationDigestBindings(inputs);
  const plan = await planArtifactMigrationFromFiles(inputs, { ...options, digests });
  PLAN_DIGEST_BINDINGS.set(plan, digests);
  return plan;
}

async function applyArtifactMigration(configuration, options = {}) {
  const digests = configuration.digests
    ?? PLAN_DIGEST_BINDINGS.get(configuration.plan)
    ?? await migrationDigestBindings(configuration.inputs);
  return applyArtifactMigrationWithBindings({ ...configuration, digests }, options);
}

async function readFixture(name) {
  return JSON.parse(await readFile(new URL(name, FIXTURE_ROOT), "utf8"));
}

async function copyMigrationFixture(directory, fixture = "legacy-blueprint.json") {
  const input = path.join(directory, "source.json");
  await writeFile(input, await readFile(new URL(fixture, FIXTURE_ROOT)));
  return input;
}

async function snapshotSource(input) {
  const sourceDirectory = path.dirname(input);
  const sourceStat = await stat(input);
  return {
    bytes: await readFile(input),
    entries: (await readdir(sourceDirectory)).sort(),
    metadata: {
      dev: sourceStat.dev,
      ino: sourceStat.ino,
      mode: sourceStat.mode,
      nlink: sourceStat.nlink,
      uid: sourceStat.uid,
      gid: sourceStat.gid,
      size: sourceStat.size,
      mtimeMs: sourceStat.mtimeMs,
      ctimeMs: sourceStat.ctimeMs,
    },
  };
}

async function waitForExistingPath(target, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await stat(target);
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("Migration filesystem state did not appear in time.");
}

async function runParentSwapChild({ inputs, out, swapParent, replacementParent }) {
  const child = fork(PARENT_SWAP_CHILD, [JSON.stringify(inputs), out], {
    silent: true,
  });
  return new Promise((resolve, reject) => {
    let swapped = false;
    let swapPromise;
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Migration parent-swap helper timed out."));
    }, 10_000);

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("message", async (message) => {
      try {
        if (message?.type === "ready") {
          swapPromise = waitForExistingPath(out).then(async () => {
            await rename(path.dirname(out), swapParent);
            await mkdir(replacementParent, { mode: 0o700 });
            await mkdir(path.join(replacementParent, "out"), { mode: 0o700 });
            await writeFile(
              path.join(replacementParent, "out", "replacement.txt"),
              "replacement\n",
              "utf8",
            );
            await writeFile(path.join(replacementParent, "preserve.txt"), "preserve\n", "utf8");
            swapped = true;
          });
          child.send({ type: "continue" });
          return;
        }
        if (message?.type === "done") {
          await swapPromise;
          clearTimeout(timeout);
          resolve({ ...message, swapped });
        }
      } catch (error) {
        clearTimeout(timeout);
        child.kill();
        reject(error);
      }
    });
  });
}

async function runKilledMigrationChild({ inputs, out }) {
  const child = fork(PARENT_SWAP_CHILD, [JSON.stringify(inputs), out], {
    silent: true,
  });
  return new Promise((resolve, reject) => {
    let killedAtPublishedDirectory = false;
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Migration SIGKILL helper timed out."));
    }, 10_000);
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("message", (message) => {
      if (message?.type !== "ready") return;
      waitForExistingPath(out)
        .then(() => {
          killedAtPublishedDirectory = child.kill("SIGKILL");
        })
        .catch(reject);
      child.send({ type: "continue" });
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, killedAtPublishedDirectory });
    });
  });
}

test("legacy registry is closed to the three supported families", () => {
  assert.deepEqual(
    LEGACY_ARTIFACT_REGISTRY.map(({ family, rule_id, output_basename }) => ({
      family,
      rule_id,
      output_basename,
    })),
    [
      {
        family: "blueprint",
        rule_id: "agentmo.migrate.blueprint.v0_1",
        output_basename: "blueprint.agentmo.json",
      },
      {
        family: "report",
        rule_id: "agentmo.migrate.report.v0_1",
        output_basename: "report.agentmo.json",
      },
      {
        family: "build_state",
        rule_id: "agentmo.migrate.build-state.v1",
        output_basename: "build-state.agentmo.json",
      },
    ],
  );
});

test("recognition requires an own legacy identity property", () => {
  const inherited = Object.create({ agentmother_version: "0.1" });
  inherited.name = "not-a-legacy-blueprint";

  assert.deepEqual(inspectArtifactForMigration(inherited), {
    status: "unsupported",
    reason: "unregistered_identity",
  });

  const inheritedReportVersion = Object.create({ version: "0.1" });
  inheritedReportVersion.kind = "agentmother_report";
  assert.deepEqual(inspectArtifactForMigration(inheritedReportVersion), {
    status: "unsupported",
    reason: "unknown_version",
  });

  const inheritedBuildVersion = Object.create({ schemaVersion: "agentmo.build.v1" });
  inheritedBuildVersion.source = { agentmotherVersion: "0.1" };
  assert.deepEqual(inspectArtifactForMigration(inheritedBuildVersion), {
    status: "unsupported",
    reason: "unknown_version",
  });
});

test("the three supported legacy families transform to canonical identity", async () => {
  const blueprint = await readFixture("legacy-blueprint.json");
  const report = await readFixture("legacy-report.json");
  const buildState = await readFixture("legacy-build-state.json");

  assert.equal(inspectArtifactForMigration(blueprint).family, "blueprint");
  assert.equal(inspectArtifactForMigration(report).family, "report");
  assert.equal(inspectArtifactForMigration(buildState).family, "build_state");

  const migratedBlueprint = transformLegacyArtifact(blueprint);
  assert.equal(migratedBlueprint.agentmo_version, "0.1");
  assert.equal(Object.hasOwn(migratedBlueprint, "agentmother_version"), false);

  const migratedReport = transformLegacyArtifact(report);
  assert.equal(migratedReport.kind, "agentmo_report");
  assert.deepEqual(migratedReport.produce_maturity, report.lifecycle);
  assert.equal(Object.hasOwn(migratedReport, "lifecycle"), false);

  const migratedBuildState = transformLegacyArtifact(buildState);
  assert.equal(migratedBuildState.source.agentmoVersion, "0.1");
  assert.equal(Object.hasOwn(migratedBuildState.source, "agentmotherVersion"), false);
  assert.equal(Object.hasOwn(migratedBuildState.source, "blueprintVersion"), false);
});

test("registry records enforce explicit legacy-input and canonical-output schemas", async () => {
  for (const record of LEGACY_ARTIFACT_REGISTRY) {
    assert.equal(typeof record.validate_legacy_input, "function");
    assert.equal(typeof record.validate_canonical_output, "function");
  }

  const invalidByInput = new Map([
    ["identity-only-blueprint", { agentmother_version: "0.1" }],
    [
      "report-missing-maturity",
      {
        kind: "agentmother_report",
        version: "0.1",
        ok: true,
        summary: {},
        gates: { passed: 0, failed: 0, items: [] },
        release_readiness: { status: "not_ready", reason: "fixture" },
        runtime_certification: [],
        discovery: {
          present: false,
          path: null,
          resolved_path: null,
          loaded: false,
          ok: null,
          summary: null,
          warnings: [],
          errors: [],
        },
        warnings: [],
        errors: [],
      },
    ],
    [
      "build-state-missing-provenance",
      {
        schemaVersion: "agentmo.build.v1",
        source: { agentmotherVersion: "0.1", blueprintVersion: "0.1" },
      },
    ],
  ]);

  for (const value of invalidByInput.values()) {
    const inspection = inspectArtifactForMigration(value);
    assert.equal(inspection.status, "rejected");
    assert.equal(inspection.reason, "schema_validation_failed");
    assert.equal(JSON.stringify(inspection).includes("fixture"), false);
  }

  const plan = planArtifactMigrationBytes(
    Array.from(invalidByInput.values(), (value) => (
      Buffer.from(`${JSON.stringify(value)}\n`, "utf8")
    )),
  );
  assert.equal(plan.applicable, false);
  assert.deepEqual(plan.items.map((item) => item.reason), [
    "schema_validation_failed",
    "schema_validation_failed",
    "schema_validation_failed",
  ]);
  assert.equal(plan.items.every((item) => item.output_digest === undefined), true);
});

test("canonical identity is a no-op and report ordinary loading is migrate-only", async () => {
  const canonical = await readFixture("canonical-blueprint.json");
  assert.deepEqual(inspectArtifactForMigration(canonical), {
    status: "already_canonical",
    family: "blueprint",
  });
  assert.equal(
    LEGACY_ARTIFACT_REGISTRY.find((record) => record.family === "report").ordinary_loader,
    "migrate_only",
  );
});

test("unknown, conflicting, multiple-family and non-object inputs fail closed", () => {
  assert.deepEqual(inspectArtifactForMigration({ agentmother_version: "0.2" }), {
    status: "unsupported",
    reason: "unknown_version",
  });
  assert.deepEqual(
    inspectArtifactForMigration({ agentmother_version: "0.1", agentmo_version: "0.1" }),
    { status: "rejected", reason: "conflicting_identity" },
  );
  assert.deepEqual(
    inspectArtifactForMigration({ agentmother_version: "0.1", kind: "agentmother_report", version: "0.1" }),
    { status: "rejected", reason: "multiple_families" },
  );
  assert.deepEqual(
    inspectArtifactForMigration({
      kind: "agentmother_report",
      version: "0.1",
      lifecycle: {},
      produce_maturity: {},
    }),
    { status: "rejected", reason: "conflicting_identity" },
  );
  assert.deepEqual(inspectArtifactForMigration([]), {
    status: "unsupported",
    reason: "non_object",
  });
  assert.deepEqual(inspectArtifactForMigration({ arbitrary: true }), {
    status: "unsupported",
    reason: "unregistered_identity",
  });
});

test("hostile keys, values and raw content return only bounded reason codes", async () => {
  const hostile = await readFixture("hostile-secret.json");
  const raw = { agentmother_version: "0.1", rawTranscript: "fixture raw material" };
  const hostileKey = JSON.parse('{"agentmother_version":"0.1","__proto__":{"polluted":true}}');

  for (const candidate of [hostile, raw, hostileKey]) {
    const result = inspectArtifactForMigration(candidate);
    assert.equal(result.status, "rejected");
    assert.equal(result.reason, "unsafe_content");
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /fixture-only-sensitive-material|fixture raw material|polluted/u);
  }
});

test("migration audit rejects normalized raw and credential spellings plus private-key material", async () => {
  const legacy = await readFixture("legacy-blueprint.json");
  const sensitive = "review-only-sensitive-material";
  const privateKeyBlock = [
    "-----BEGIN PRIVATE KEY-----",
    "cmV2aWV3LW9ubHktcHJpdmF0ZS1rZXk=",
    "-----END PRIVATE KEY-----",
  ].join("\n");
  const hostileCandidates = [
    { ...legacy, raw_transcript: sensitive },
    { ...legacy, "tool-output": sensitive },
    { ...legacy, Transcript: sensitive },
    { ...legacy, credential: sensitive },
    { ...legacy, privateKey: sensitive },
    { ...legacy, accessKey: sensitive },
    { ...legacy, notes: privateKeyBlock },
  ];

  for (const candidate of hostileCandidates) {
    const audited = auditMigrationCandidate(candidate);
    assert.equal(audited.ok, false);
    const inspected = inspectArtifactForMigration(candidate);
    assert.equal(inspected.status, "rejected");
    assert.equal(inspected.reason, "unsafe_content");
    assert.equal(JSON.stringify({ audited, inspected }).includes(sensitive), false);
    assert.equal(JSON.stringify({ audited, inspected }).includes(privateKeyBlock), false);
  }

  for (const benign of [
    { homepage: "https://example.test/docs?mode=ordinary" },
    { notes: "ordinary migration documentation" },
  ]) {
    assert.deepEqual(auditMigrationCandidate(benign), { ok: true, reasons: [] });
  }
});

test("preview and apply reject the whole batch without exposing normalized hostile values", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentmo-migration-normalized-hostile-"));
  const valid = await copyMigrationFixture(directory, "legacy-report.json");
  const hostile = path.join(directory, "hostile.json");
  const out = path.join(directory, "out");
  const sensitive = "review-only-sensitive-material";
  const legacy = await readFixture("legacy-blueprint.json");
  await writeFile(hostile, `${JSON.stringify({ ...legacy, raw_transcript: sensitive })}\n`, "utf8");

  const plan = await planArtifactMigration([valid, hostile]);
  assert.equal(plan.applicable, false);
  assert.deepEqual(plan.items.map((item) => item.result), ["ready", "rejected"]);
  assert.equal(serializeMigrationPlan(plan).includes(sensitive), false);

  await assert.rejects(
    () => applyArtifactMigration({ inputs: [valid, hostile], out, plan }),
    (error) => {
      assert.equal(error.code, "AGENTMO_MIGRATION_BATCH_REJECTED");
      assert.equal(JSON.stringify({ code: error.code, message: error.message }).includes(sensitive), false);
      return true;
    },
  );
  await assert.rejects(() => stat(out), { code: "ENOENT" });
});

test("ordinary blueprint and build-state loaders require explicit migration with zero writes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentmo-migration-gate-"));
  const blueprintSource = path.join(directory, "legacy-a.json");
  const buildStateSource = path.join(directory, "legacy-b.json");
  const blueprintBytes = await readFile(new URL("legacy-blueprint.json", FIXTURE_ROOT));
  const buildStateBytes = await readFile(new URL("legacy-build-state.json", FIXTURE_ROOT));
  await writeFile(blueprintSource, blueprintBytes);
  await writeFile(buildStateSource, buildStateBytes);

  const loadExactBlueprint = async (source) => loadAdmittedBlueprint(source, {
    subject: "blueprint",
    expectedDigest: digestBytes(await readFile(source)),
  });
  const loadExactBuildState = async (source) => loadBuildState(source, {
    subject: "build-state",
    expectedDigest: digestBytes(await readFile(source)),
  });
  for (const [loader, source, family] of [
    [loadExactBlueprint, blueprintSource, "blueprint"],
    [loadExactBuildState, buildStateSource, "build_state"],
  ]) {
    await assert.rejects(
      () => loader(source),
      (error) => {
        assert.equal(error instanceof AgentMoMigrationRequiredError, true);
        assert.equal(error.code, "AGENTMO_MIGRATION_REQUIRED");
        assert.equal(error.family, family);
        assert.match(error.message, /agentmo migrate <input>/u);
        assert.equal(error.message.includes(source), false);
        assert.equal(error.message.includes(path.basename(source)), false);
        return true;
      },
    );
  }

  assert.deepEqual(await readFile(blueprintSource), blueprintBytes);
  assert.deepEqual(await readFile(buildStateSource), buildStateBytes);
  assert.deepEqual((await readdir(directory)).sort(), ["legacy-a.json", "legacy-b.json"]);
});

test("migration preview is byte-deterministic, single-read and side-effect free", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentmo-migration-preview-"));
  const inputs = [
    fileURLToPath(new URL("legacy-blueprint.json", FIXTURE_ROOT)),
    fileURLToPath(new URL("legacy-report.json", FIXTURE_ROOT)),
    fileURLToPath(new URL("legacy-build-state.json", FIXTURE_ROOT)),
    fileURLToPath(new URL("canonical-blueprint.json", FIXTURE_ROOT)),
  ];
  const before = await readdir(directory);
  const first = await planArtifactMigration(inputs);
  const second = await planArtifactMigration(inputs);

  assert.equal(first.schemaVersion, MIGRATION_PLAN_SCHEMA_VERSION);
  assert.equal(first.mode, "preview");
  assert.equal(first.applicable, true);
  assert.equal(first.items.length, 4);
  assert.deepEqual(first.items.map((item) => item.ordinal), [1, 2, 3, 4]);
  assert.deepEqual(first.items.map((item) => item.result), ["ready", "ready", "ready", "already_canonical"]);
  assert.equal(first.items[3].output_basename, undefined);
  assert.deepEqual(first, second);
  assert.equal(serializeMigrationPlan(first), serializeMigrationPlan(second));
  assert.deepEqual(await readdir(directory), before);
});

test("migration byte planner accepts only exact Buffer captures", async () => {
  const bytes = [
    await readFile(new URL("legacy-blueprint.json", FIXTURE_ROOT)),
    await readFile(new URL("canonical-blueprint.json", FIXTURE_ROOT)),
  ];
  const plan = planArtifactMigrationBytes(bytes);

  assert.equal(plan.applicable, true);
  assert.throws(
    () => planArtifactMigrationBytes([bytes[0].toString("utf8")]),
    /exact Buffers/u,
  );
});

test("whole-batch preview rejects unsafe, invalid, oversized and colliding inputs without raw material", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentmo-migration-batch-"));
  const valid = path.join(directory, "one.json");
  const hostile = path.join(directory, "two.json");
  const invalid = path.join(directory, "three.json");
  const oversized = path.join(directory, "four.json");
  const validBytes = await readFile(new URL("legacy-blueprint.json", FIXTURE_ROOT));
  const hostileBytes = await readFile(new URL("hostile-secret.json", FIXTURE_ROOT));
  await writeFile(valid, validBytes);
  await writeFile(hostile, hostileBytes);
  await writeFile(invalid, "{ fixture raw material", "utf8");
  await writeFile(oversized, "x".repeat(65), "utf8");
  const before = (await readdir(directory)).sort();

  const mixed = await planArtifactMigration([valid, hostile, invalid, oversized], { maxInputBytes: 64 });
  assert.equal(mixed.applicable, false);
  assert.deepEqual(mixed.items.map((item) => item.result), ["rejected", "rejected", "rejected", "rejected"]);
  assert.deepEqual(mixed.items.map((item) => item.reason), [
    "input_too_large",
    "input_too_large",
    "invalid_json",
    "input_too_large",
  ]);
  const serialized = serializeMigrationPlan(mixed);
  for (const forbidden of [directory, path.basename(valid), path.basename(hostile), "fixture raw material", "fixture-only-sensitive-material"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.deepEqual((await readdir(directory)).sort(), before);

  const collision = await planArtifactMigration([valid, valid]);
  assert.equal(collision.applicable, false);
  assert.deepEqual(collision.items.map((item) => item.reason), ["output_collision", "output_collision"]);
});

test("mixed valid and hostile batch retains value-blind per-item status and blocks the batch", async () => {
  const valid = fileURLToPath(new URL("legacy-blueprint.json", FIXTURE_ROOT));
  const hostile = fileURLToPath(new URL("hostile-secret.json", FIXTURE_ROOT));
  const plan = await planArtifactMigration([valid, hostile]);

  assert.equal(plan.applicable, false);
  assert.deepEqual(plan.items.map((item) => item.result), ["ready", "rejected"]);
  assert.equal(plan.items[1].reason, "unsafe_content");
  assert.deepEqual(plan.items[1].warnings, ["migration_input_rejected"]);
});

test("receipt model is deterministic and contains only the fixed value-blind field set", async () => {
  const inputs = [
    fileURLToPath(new URL("legacy-report.json", FIXTURE_ROOT)),
    fileURLToPath(new URL("canonical-blueprint.json", FIXTURE_ROOT)),
  ];
  const plan = await planArtifactMigration(inputs);
  const receipt = buildMigrationReceipt(plan);

  assert.equal(receipt.schemaVersion, MIGRATION_RECEIPT_SCHEMA_VERSION);
  assert.equal(receipt.schemaVersion, "agentmo.migration-receipt.v1");
  assert.deepEqual(Object.keys(receipt), ["schemaVersion", "plan_digest", "result", "items"]);
  const allowedItemKeys = new Set([
    "ordinal",
    "result",
    "rule_id",
    "input_identity",
    "input_version",
    "input_digest",
    "output_identity",
    "output_version",
    "output_digest",
    "warnings",
  ]);
  for (const item of receipt.items) {
    assert.equal(Object.keys(item).every((key) => allowedItemKeys.has(key)), true);
  }
  const serialized = JSON.stringify(receipt);
  for (const forbidden of [...inputs, ...inputs.map((input) => path.basename(input)), "raw", "stdout", "stderr", "transcript", "secret"]) {
    assert.equal(serialized.toLowerCase().includes(forbidden.toLowerCase()), false);
  }
  assert.deepEqual(receipt, buildMigrationReceipt(plan));
});

test("bounded retained-fd reader enforces the byte ceiling on a real file", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentmo-migration-bounded-read-"));
  const input = path.join(directory, "input.json");
  const payload = Buffer.from("123456789", "utf8");
  await writeFile(input, payload);
  const plan = await planArtifactMigrationFromFiles([input], {
    maxInputBytes: 8,
    digests: { "migration-input-0": digestBytes(payload) },
  });

  assert.equal(plan.items[0].reason, "input_too_large");
  assert.deepEqual(await readFile(input), payload);
});

test("legacy build-state requires matching own source versions and preserves provenance", async () => {
  const legacy = await readFixture("legacy-build-state.json");
  legacy.source.blueprintHash = "b".repeat(64);
  const migrated = transformLegacyArtifact(legacy);
  assert.equal(migrated.source.blueprintHash, "b".repeat(64));

  const missing = structuredClone(legacy);
  delete missing.source.blueprintVersion;
  assert.deepEqual(inspectArtifactForMigration(missing), {
    status: "unsupported",
    reason: "unknown_version",
  });

  const mismatched = structuredClone(legacy);
  mismatched.source.blueprintVersion = "9.9";
  assert.deepEqual(inspectArtifactForMigration(mismatched), {
    status: "unsupported",
    reason: "unknown_version",
  });
});

test("duplicate identity members are rejected before JSON last-wins admission", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentmo-migration-duplicates-"));
  const duplicateBlueprint = path.join(directory, "input-a.json");
  const duplicateBuildState = path.join(directory, "input-b.json");
  await writeFile(
    duplicateBlueprint,
    '{"agentmother_version":"9.9","agentmother_version":"0.1"}',
    "utf8",
  );
  await writeFile(
    duplicateBuildState,
    '{"schemaVersion":"agentmo.build.v1","source":{"agentmotherVersion":"9.9","agentmotherVersion":"0.1","blueprintVersion":"0.1"}}',
    "utf8",
  );

  const plan = await planArtifactMigration([duplicateBlueprint, duplicateBuildState]);
  assert.deepEqual(plan.items.map((item) => item.reason), [
    "duplicate_identity_member",
    "duplicate_identity_member",
  ]);
  await assert.rejects(
    () => loadAdmittedBlueprint(duplicateBlueprint, {
      subject: "blueprint",
      expectedDigest: digestBytes(Buffer.from('{"agentmother_version":"9.9","agentmother_version":"0.1"}', "utf8")),
    }),
    (error) => error?.code === "AGENTMO_UNSUPPORTED_ARTIFACT" && error?.reason === "duplicate_identity_member",
  );
  await assert.rejects(
    async () => loadBuildState(duplicateBuildState, {
      subject: "build-state",
      expectedDigest: digestBytes(await readFile(duplicateBuildState)),
    }),
    (error) => error?.code === "AGENTMO_UNSUPPORTED_ARTIFACT" && error?.reason === "duplicate_identity_member",
  );
});

test("ordinary and escaped duplicate members produce valid non-applicable plans and receipts", async () => {
  const rawInputs = [
    '{"agentmother_version":"0.1","title":"private-first-canary","title":"bounded"}',
    '{"agentmother_version":"0.1","ti\\u0074le":"private-first-canary","title":"bounded"}',
  ];

  for (const raw of rawInputs) {
    const plan = planArtifactMigrationBytes([Buffer.from(raw, "utf8")]);
    assert.equal(plan.applicable, false);
    assert.equal(plan.items[0].reason, "duplicate_member");
    assert.equal(serializeMigrationPlan(plan).includes("private-first-canary"), false);
    assert.deepEqual(validateMigrationPlanForReceipt(plan), { ok: true, errors: [] });
    assert.deepEqual(buildMigrationReceipt(plan), {
      schemaVersion: MIGRATION_RECEIPT_SCHEMA_VERSION,
      plan_digest: plan.plan_digest,
      result: "non_applicable",
      items: [{
        ordinal: 1,
        result: "rejected_duplicate_member",
        input_digest: plan.items[0].input_digest,
        warnings: ["migration_input_rejected"],
      }],
    });
  }
});

test("escaped lone surrogate remains migration writer-loader compatible outside Candidate scope", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentmo-migration-unicode-roundtrip-"));
  const sourceDirectory = path.join(directory, "source");
  const outputParent = path.join(directory, "output");
  const input = path.join(sourceDirectory, "source.json");
  const out = path.join(outputParent, "out");
  const legacy = await readFile(new URL("legacy-blueprint.json", FIXTURE_ROOT), "utf8");
  const raw = legacy.replace(
    "Exercise the legacy blueprint writer contract.",
    "Exercise the legacy blueprint writer contract.\\ud800",
  );
  await mkdir(sourceDirectory, { mode: 0o700 });
  await mkdir(outputParent, { mode: 0o700 });
  await writeFile(input, raw, "utf8");
  const plan = await planArtifactMigration([input]);

  assert.equal(plan.applicable, true);
  assert.equal(plan.items[0].result, "ready");
  assert.equal(plan.items[0].reason, undefined);
  assert.deepEqual(validateMigrationPlanForReceipt(plan), { ok: true, errors: [] });
  assert.equal(buildMigrationReceipt(plan).result, "applicable");

  const result = await applyArtifactMigration({ inputs: [input], out, plan });
  assert.equal(result.plan_digest, plan.plan_digest);
  const output = path.join(out, "blueprint.agentmo.json");
  const outputBytes = await readFile(output);
  const admitted = await loadAdmittedBlueprint(output, {
    subject: "blueprint",
    expectedDigest: digestBytes(outputBytes),
  });
  assert.equal(admitted.value.domain_genome.purpose.endsWith("\ud800"), true);
});

test("receipt builder rejects forged plans and injected fields", async () => {
  const input = fileURLToPath(new URL("legacy-blueprint.json", FIXTURE_ROOT));
  const plan = await planArtifactMigration([input]);
  const forgeries = [];

  const injected = structuredClone(plan);
  injected.items[0].path = "/host/private/location";
  forgeries.push(injected);

  const ordinal = structuredClone(plan);
  ordinal.items[0].ordinal = 2;
  forgeries.push(ordinal);

  const digest = structuredClone(plan);
  digest.items[0].input_digest = "not-a-digest";
  forgeries.push(digest);

  const registry = structuredClone(plan);
  registry.items[0].rule_id = "unregistered.rule";
  forgeries.push(registry);

  const warning = structuredClone(plan);
  warning.items[0].warnings = ["stdout_injected"];
  forgeries.push(warning);

  const planDigest = structuredClone(plan);
  planDigest.plan_digest = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
  forgeries.push(planDigest);

  for (const forged of forgeries) {
    assert.throws(() => buildMigrationReceipt(forged), /valid migration plan/u);
  }
});

test("migration audit rejects raw output fields and common secret shapes without false positives", () => {
  for (const candidate of [
    { agentmother_version: "0.1", transcript: "stored output" },
    { agentmother_version: "0.1", stdout: "stored output" },
    { agentmother_version: "0.1", stderrs: ["stored output"] },
    { agentmother_version: "0.1", note: "ghp_1234567890abcdefghijklmnopqrstuvwxyz" },
    { agentmother_version: "0.1", note: "AKIAIOSFODNN7EXAMPLE" },
    { agentmother_version: "0.1", note: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturevalue" },
  ]) {
    assert.equal(auditMigrationCandidate(candidate).ok, false);
  }

  assert.equal(
    auditMigrationCandidate({
      agentmother_version: "0.1",
      note: "Ordinary migration note",
      docs: "https://example.com/path?tokenization=normal",
      output_format: "json",
    }).ok,
    true,
  );
});

test("deep hostile item exhausts an explicit budget without aborting the batch", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agentmo-migration-budget-"));
  const deep = path.join(directory, "deep.json");
  const valid = path.join(directory, "valid.json");
  const deepJson = `{"agentmother_version":"0.1","nested":${"[".repeat(300)}null${"]".repeat(300)}}`;
  await writeFile(deep, deepJson, "utf8");
  await writeFile(valid, await readFile(new URL("legacy-report.json", FIXTURE_ROOT)));

  const plan = await planArtifactMigration([deep, valid]);
  assert.equal(plan.applicable, false);
  assert.deepEqual(plan.items.map((item) => item.result), ["rejected", "ready"]);
  assert.equal(plan.items[0].reason, "resource_budget_exceeded");
});

test("migration apply capability probe uses the real filesystem and old injection is rejected", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-migration-capability-"));
  const out = path.join(root, "out");
  const input = fileURLToPath(new URL("legacy-blueprint.json", FIXTURE_ROOT));
  const plan = await planArtifactMigration([input]);

  assert.deepEqual(await probeMigrationApplyCapabilities(out), { ok: true });
  await assert.rejects(
    () => applyArtifactMigration({ inputs: [input], out, plan }, {
      probeCapabilities: async () => ({ ok: false }),
    }),
    TypeError,
  );
  assert.deepEqual(await readdir(root), []);
});

test("migration apply refuses an existing output directory", async () => {
  const out = await mkdtemp(path.join(tmpdir(), "agentmo-migration-existing-"));
  const input = fileURLToPath(new URL("legacy-blueprint.json", FIXTURE_ROOT));
  const plan = await planArtifactMigration([input]);

  await assert.rejects(
    () => applyArtifactMigration({ inputs: [input], out, plan }),
    (error) => error?.code === "AGENTMO_MIGRATION_OUTPUT_EXISTS",
  );
});

test("migration apply is successful only when the committed output verifies", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-migration-success-"));
  const out = path.join(root, "out");
  const input = fileURLToPath(new URL("legacy-blueprint.json", FIXTURE_ROOT));
  const plan = await planArtifactMigration([input]);

  const result = await applyArtifactMigration({ inputs: [input], out, plan });
  assert.equal(result.ok, true);
  assert.deepEqual(await verifyMigrationOutput({ out, plan }), { ok: true });
});

test("migration apply rejects unsafe parents, existing output aliases, and symlink sources", async (t) => {
  await t.test("group/world-writable parent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-migration-unsafe-parent-"));
    const parent = path.join(root, "parent");
    await mkdir(parent, { mode: 0o700 });
    await chmod(parent, 0o777);
    const input = await copyMigrationFixture(root);
    const plan = await planArtifactMigration([input]);
    const out = path.join(parent, "out");
    await assert.rejects(
      () => applyArtifactMigration({ inputs: [input], out, plan }),
      (error) => error?.code === "AGENTMO_MIGRATION_UNSAFE_PARENT",
    );
    assert.equal((await readdir(parent)).includes("out"), false);
  });

  await t.test("symlink parent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-migration-symlink-parent-"));
    const actualParent = path.join(root, "actual-parent");
    const parent = path.join(root, "parent");
    await mkdir(actualParent, { mode: 0o700 });
    await symlink(actualParent, parent);
    const input = await copyMigrationFixture(root);
    const plan = await planArtifactMigration([input]);
    await assert.rejects(
      () => applyArtifactMigration({ inputs: [input], out: path.join(parent, "out"), plan }),
      (error) => error?.code === "AGENTMO_MIGRATION_UNSAFE_PARENT",
    );
    assert.deepEqual(await readdir(actualParent), []);
  });

  await t.test("existing output symlink", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-migration-symlink-out-"));
    const parent = path.join(root, "parent");
    const target = path.join(root, "target");
    const out = path.join(parent, "out");
    await mkdir(parent, { mode: 0o700 });
    await mkdir(target, { mode: 0o700 });
    await symlink(target, out);
    const input = await copyMigrationFixture(root);
    const plan = await planArtifactMigration([input]);
    await assert.rejects(
      () => applyArtifactMigration({ inputs: [input], out, plan }),
      (error) => error?.code === "AGENTMO_MIGRATION_OUTPUT_EXISTS",
    );
    assert.deepEqual(await readdir(target), []);
  });

  await t.test("source symlink", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-migration-symlink-source-"));
    const sourceDirectory = path.join(root, "source");
    const outputParent = path.join(root, "output");
    await mkdir(sourceDirectory, { mode: 0o700 });
    await mkdir(outputParent, { mode: 0o700 });
    const actual = await copyMigrationFixture(sourceDirectory);
    const linked = path.join(sourceDirectory, "linked.json");
    await symlink(actual, linked);
    const plan = await planArtifactMigration([linked]);
    const out = path.join(outputParent, "out");
    await assert.rejects(
      () => applyArtifactMigration({ inputs: [linked], out, plan }),
      (error) => error?.code === "AGENTMO_MIGRATION_BATCH_REJECTED",
    );
    assert.deepEqual(await readdir(outputParent), []);
  });
});

test("apply revalidates the exact planned input set before mkdir and preserves source containers", async (t) => {
  await t.test("source bytes changed after preview", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-migration-source-change-"));
    const sourceDirectory = path.join(root, "source");
    const outputParent = path.join(root, "output");
    await mkdir(sourceDirectory, { mode: 0o700 });
    await mkdir(outputParent, { mode: 0o700 });
    const input = await copyMigrationFixture(sourceDirectory);
    const plan = await planArtifactMigration([input]);
    const changed = await readFixture("legacy-blueprint.json");
    changed.name = "changed-after-preview";
    await writeFile(input, JSON.stringify(changed) + "\n", "utf8");
    const beforeApply = await snapshotSource(input);
    await assert.rejects(
      () => applyArtifactMigration({
        inputs: [input],
        out: path.join(outputParent, "out"),
        plan,
      }),
      (error) => error?.code === "AGENTMO_MIGRATION_BATCH_REJECTED",
    );
    assert.deepEqual(await readdir(outputParent), []);
    assert.deepEqual(await snapshotSource(input), beforeApply);
  });

  await t.test("multi-input order changed after preview", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-migration-input-order-"));
    const sourceDirectory = path.join(root, "source");
    const outputParent = path.join(root, "output");
    await mkdir(sourceDirectory, { mode: 0o700 });
    await mkdir(outputParent, { mode: 0o700 });
    const blueprint = await copyMigrationFixture(sourceDirectory);
    const report = path.join(sourceDirectory, "report.json");
    await writeFile(report, await readFile(new URL("legacy-report.json", FIXTURE_ROOT)));
    const plan = await planArtifactMigration([blueprint, report]);
    await assert.rejects(
      () => applyArtifactMigration({
        inputs: [report, blueprint],
        out: path.join(outputParent, "out"),
        plan,
      }),
      (error) => error?.code === "AGENTMO_MIGRATION_BATCH_REJECTED",
    );
    assert.deepEqual(await readdir(outputParent), []);
  });

  await t.test("output parent is the source-containing directory", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-migration-source-overlap-"));
    const input = await copyMigrationFixture(root);
    const beforePlan = await snapshotSource(input);
    const plan = await planArtifactMigration([input]);
    await assert.rejects(
      () => applyArtifactMigration({
        inputs: [input],
        out: path.join(root, "out"),
        plan,
      }),
      (error) => error?.code === "AGENTMO_MIGRATION_BATCH_REJECTED",
    );
    assert.deepEqual(await snapshotSource(input), beforePlan);
  });

  await t.test("source path becomes a symlink after preview", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-migration-source-swap-"));
    const sourceDirectory = path.join(root, "source");
    const outputParent = path.join(root, "output");
    await mkdir(sourceDirectory, { mode: 0o700 });
    await mkdir(outputParent, { mode: 0o700 });
    const input = await copyMigrationFixture(sourceDirectory);
    const plan = await planArtifactMigration([input]);
    const retainedSource = path.join(sourceDirectory, "retained-source.json");
    await rename(input, retainedSource);
    await symlink(retainedSource, input);
    const entriesBeforeApply = (await readdir(sourceDirectory)).sort();
    await assert.rejects(
      () => applyArtifactMigration({
        inputs: [input],
        out: path.join(outputParent, "out"),
        plan,
      }),
      (error) => error?.code === "AGENTMO_MIGRATION_BATCH_REJECTED",
    );
    assert.deepEqual(await readdir(outputParent), []);
    assert.deepEqual((await readdir(sourceDirectory)).sort(), entriesBeforeApply);
  });
});

test("real SIGKILL after output publication never creates verifiable success", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-migration-sigkill-"));
  const sourceDirectory = path.join(root, "source");
  const outputParent = path.join(root, "output");
  await mkdir(sourceDirectory, { mode: 0o700 });
  await mkdir(outputParent, { mode: 0o700 });
  const fixtureNames = [
    "legacy-blueprint.json",
    "legacy-report.json",
    "legacy-build-state.json",
  ];
  const inputs = [];
  for (const [index, fixture] of fixtureNames.entries()) {
    const input = path.join(sourceDirectory, `input-${index}.json`);
    await writeFile(input, await readFile(new URL(fixture, FIXTURE_ROOT)));
    inputs.push(input);
  }
  const plan = await planArtifactMigration(inputs);
  const before = await Promise.all(inputs.map(snapshotSource));
  const out = path.join(outputParent, "out");
  const killed = await runKilledMigrationChild({ inputs, out });

  assert.equal(killed.killedAtPublishedDirectory, true);
  assert.equal(killed.code, null);
  assert.equal(killed.signal, "SIGKILL");
  assert.equal((await verifyMigrationOutput({ out, plan })).ok, false);
  assert.deepEqual(await Promise.all(inputs.map(snapshotSource)), before);
});

test("marker, receipt, payload, file-set, and requested-path tampering all fail verification", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-migration-tamper-"));
  const sourceDirectory = path.join(root, "source");
  await mkdir(sourceDirectory, { mode: 0o700 });
  const input = await copyMigrationFixture(sourceDirectory);
  const plan = await planArtifactMigration([input]);
  const outputBasename = plan.items.find((item) => item.result === "ready").output_basename;

  async function createVerifiedOut(name) {
    const parent = path.join(root, name);
    const out = path.join(parent, "out");
    await mkdir(parent, { mode: 0o700 });
    await applyArtifactMigration({ inputs: [input], out, plan });
    assert.equal((await verifyMigrationOutput({ out, plan })).ok, true);
    return out;
  }

  await t.test("marker state", async () => {
    const out = await createVerifiedOut("marker");
    const markerPath = path.join(out, MIGRATION_INSTANCE_MARKER_BASENAME);
    const marker = JSON.parse(await readFile(markerPath, "utf8"));
    marker.state = "staging";
    await writeFile(markerPath, JSON.stringify(marker) + "\n", "utf8");
    assert.equal((await verifyMigrationOutput({ out, plan })).ok, false);
  });

  await t.test("receipt plan digest", async () => {
    const out = await createVerifiedOut("receipt");
    const receiptPath = path.join(out, MIGRATION_RECEIPT_BASENAME);
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    receipt.plan_digest = "sha256:" + "0".repeat(64);
    await writeFile(receiptPath, JSON.stringify(receipt) + "\n", "utf8");
    assert.equal((await verifyMigrationOutput({ out, plan })).ok, false);
  });

  await t.test("receipt byte-equivalent reformat", async () => {
    const out = await createVerifiedOut("receipt-reformat");
    const receiptPath = path.join(out, MIGRATION_RECEIPT_BASENAME);
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + "\n", "utf8");
    assert.equal((await verifyMigrationOutput({ out, plan })).ok, false);
  });

  await t.test("canonical payload", async () => {
    const out = await createVerifiedOut("payload");
    await writeFile(path.join(out, outputBasename), "{}\n", "utf8");
    assert.equal((await verifyMigrationOutput({ out, plan })).ok, false);
  });

  await t.test("payload mode widened", async () => {
    const out = await createVerifiedOut("payload-mode");
    await chmod(path.join(out, outputBasename), 0o644);
    assert.equal((await verifyMigrationOutput({ out, plan })).ok, false);
  });

  await t.test("payload replaced by symlink", async () => {
    const out = await createVerifiedOut("payload-symlink");
    const payloadPath = path.join(out, outputBasename);
    const retainedPayload = path.join(root, "retained-payload");
    await rename(payloadPath, retainedPayload);
    await symlink(retainedPayload, payloadPath);
    assert.equal((await verifyMigrationOutput({ out, plan })).ok, false);
  });

  await t.test("marker gains an extra field", async () => {
    const out = await createVerifiedOut("marker-extra");
    const markerPath = path.join(out, MIGRATION_INSTANCE_MARKER_BASENAME);
    const marker = JSON.parse(await readFile(markerPath, "utf8"));
    marker.extra = true;
    await writeFile(markerPath, JSON.stringify(marker) + "\n", "utf8");
    assert.equal((await verifyMigrationOutput({ out, plan })).ok, false);
  });

  const markerByteTamperCases = [
    [
      "duplicate state",
      (raw) => raw.replace('"state":"committed"', '"state":"staging","state":"committed"'),
    ],
    [
      "escaped duplicate state",
      (raw) => raw.replace('"state":"committed"', '"\\u0073tate":"staging","state":"committed"'),
    ],
    [
      "duplicate plan digest",
      (raw) => raw.replace('"plan_digest":', '"plan_digest":"sha256:' + "0".repeat(64) + '","plan_digest":'),
    ],
    [
      "duplicate requested path digest",
      (raw) => raw.replace('"requested_path_digest":', '"requested_path_digest":"sha256:' + "0".repeat(64) + '","requested_path_digest":'),
    ],
    [
      "duplicate parent identity",
      (raw) => raw.replace("{", '{"parent_identity":{"dev":"0","ino":"0"},'),
    ],
    [
      "duplicate directory identity",
      (raw) => raw.replace("{", '{"directory_identity":{"dev":"0","ino":"0"},'),
    ],
    [
      "different key order",
      (raw) => `${JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(raw)).reverse()))}\n`,
    ],
    ["different whitespace", (raw) => `${JSON.stringify(JSON.parse(raw), null, 2)}\n`],
    ["extra newline", (raw) => `${raw}\n`],
  ];

  for (const [name, mutate] of markerByteTamperCases) {
    await t.test(`marker raw bytes reject ${name}`, async () => {
      const out = await createVerifiedOut(`marker-bytes-${name.replaceAll(" ", "-")}`);
      const markerPath = path.join(out, MIGRATION_INSTANCE_MARKER_BASENAME);
      const raw = await readFile(markerPath, "utf8");
      await writeFile(markerPath, mutate(raw), "utf8");
      assert.equal((await verifyMigrationOutput({ out, plan })).ok, false);
    });
  }

  await t.test("additional file", async () => {
    const out = await createVerifiedOut("file-set");
    await writeFile(path.join(out, "unexpected"), "unexpected\n", "utf8");
    assert.equal((await verifyMigrationOutput({ out, plan })).ok, false);
  });

  await t.test("directory moved to a different requested path", async () => {
    const out = await createVerifiedOut("path-binding");
    const moved = path.join(path.dirname(out), "moved");
    await rename(out, moved);
    assert.equal((await verifyMigrationOutput({ out, plan })).ok, false);
    assert.equal((await verifyMigrationOutput({ out: moved, plan })).ok, false);
  });
});

test("real parent swap preserves replacement path and reports owned orphan staging", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-migration-parent-swap-"));
  const sourceDirectory = path.join(root, "source");
  const parent = path.join(root, "parent");
  const orphanParent = path.join(root, "orphan-parent");
  const out = path.join(parent, "out");
  await mkdir(sourceDirectory, { mode: 0o700 });
  await mkdir(parent, { mode: 0o700 });
  const fixtureNames = [
    "legacy-blueprint.json",
    "legacy-report.json",
    "legacy-build-state.json",
  ];
  const inputs = [];
  for (const [index, fixture] of fixtureNames.entries()) {
    const input = path.join(sourceDirectory, `input-${index}.json`);
    await writeFile(input, await readFile(new URL(fixture, FIXTURE_ROOT)));
    inputs.push(input);
  }
  const plan = await planArtifactMigration(inputs);
  const before = await Promise.all(inputs.map(snapshotSource));

  const childResult = await runParentSwapChild({
    inputs,
    out,
    swapParent: orphanParent,
    replacementParent: parent,
  });
  assert.equal(childResult.swapped, true);
  assert.equal(childResult.result.code, "AGENTMO_MIGRATION_ORPHANED_STAGING");
  assert.match(childResult.result.orphan_token, /^[a-f0-9]{32,128}$/u);
  assert.equal(childResult.verification.ok, false);
  assert.deepEqual((await readdir(parent)).sort(), ["out", "preserve.txt"]);
  assert.deepEqual(await readdir(path.join(parent, "out")), ["replacement.txt"]);

  const orphanOut = path.join(orphanParent, "out");
  const orphanStat = await stat(orphanOut);
  assert.equal(orphanStat.mode & 0o777, 0o700);
  assert.equal((await verifyMigrationOutput({ out: orphanOut, plan })).ok, false);
  assert.deepEqual(await Promise.all(inputs.map(snapshotSource)), before);

  const preservedReplacement = path.join(root, "preserved-replacement");
  await rename(parent, preservedReplacement);
  await rename(orphanParent, parent);
  assert.equal((await verifyMigrationOutput({ out, plan })).ok, false);
  if ((await readdir(out)).includes(MIGRATION_INSTANCE_MARKER_BASENAME)) {
    const marker = JSON.parse(
      await readFile(path.join(out, MIGRATION_INSTANCE_MARKER_BASENAME), "utf8"),
    );
    assert.equal(marker.state, "staging");
  }
  assert.deepEqual(
    await readdir(path.join(preservedReplacement, "out")),
    ["replacement.txt"],
  );
});

test("successful repeated apply emits byte-identical canonical payloads and receipt without changing sources", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-migration-repeat-"));
  const sourceDirectory = path.join(root, "source");
  const firstParent = path.join(root, "first");
  const secondParent = path.join(root, "second");
  await mkdir(sourceDirectory, { mode: 0o700 });
  await mkdir(firstParent, { mode: 0o700 });
  await mkdir(secondParent, { mode: 0o700 });
  const input = await copyMigrationFixture(sourceDirectory);
  const plan = await planArtifactMigration([input]);
  const before = await snapshotSource(input);
  const first = path.join(firstParent, "out");
  const second = path.join(secondParent, "out");

  await applyArtifactMigration({ inputs: [input], out: first, plan });
  await applyArtifactMigration({ inputs: [input], out: second, plan });
  const outputBasenames = plan.items
    .filter((item) => item.result === "ready")
    .map((item) => item.output_basename);
  for (const basename of [...outputBasenames, MIGRATION_RECEIPT_BASENAME]) {
    assert.deepEqual(await readFile(path.join(first, basename)), await readFile(path.join(second, basename)));
  }
  assert.notDeepEqual(
    await readFile(path.join(first, MIGRATION_INSTANCE_MARKER_BASENAME)),
    await readFile(path.join(second, MIGRATION_INSTANCE_MARKER_BASENAME)),
  );
  assert.deepEqual(await snapshotSource(input), before);
});
