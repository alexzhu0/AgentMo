import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { planArtifactMigrationBytes } from "../src/artifact-migration.js";
import {
  applyArtifactMigration,
  planArtifactMigration,
  verifyMigrationOutput,
} from "../src/migration-filesystem.js";

const FIXTURE_ROOT = new URL("./fixtures/migration/", import.meta.url);

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function bindings(bytesList) {
  return Object.freeze(Object.fromEntries(
    bytesList.map((bytes, index) => [`migration-input-${index}`, digest(bytes)]),
  ));
}

test("byte planner validates and transforms the exact supplied Buffers", async () => {
  const legacy = await readFile(new URL("legacy-blueprint.json", FIXTURE_ROOT));
  const canonical = await readFile(new URL("canonical-blueprint.json", FIXTURE_ROOT));
  const plan = planArtifactMigrationBytes([legacy, canonical]);

  assert.equal(plan.applicable, true);
  assert.deepEqual(plan.items.map((item) => item.result), ["ready", "already_canonical"]);
  assert.deepEqual(plan.items.map((item) => item.input_digest), [digest(legacy), digest(canonical)]);

  const invalid = Buffer.from('{"agentmother_version":"0.1"}\n', "utf8");
  const rejected = planArtifactMigrationBytes([invalid]);
  assert.equal(rejected.applicable, false);
  assert.equal(rejected.items[0].reason, "schema_validation_failed");
});

test("apply independently recaptures source bytes and rejects post-plan replacement", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-migration-read-count-"));
  const source = path.join(root, "source");
  const output = path.join(root, "output");
  await mkdir(source, { mode: 0o700 });
  await mkdir(output, { mode: 0o700 });
  const bytes = await readFile(new URL("legacy-blueprint.json", FIXTURE_ROOT));
  const input = path.join(source, "input.json");
  await writeFile(input, bytes);
  const digests = bindings([bytes]);

  const plan = await planArtifactMigration([input], { digests });
  assert.equal(plan.applicable, true);

  await writeFile(input, await readFile(new URL("legacy-report.json", FIXTURE_ROOT)));
  const rejectedOut = path.join(output, "rejected");
  await assert.rejects(
    () => applyArtifactMigration({ inputs: [input], out: rejectedOut, plan, digests }),
    (error) => error?.code === "AGENTMO_MIGRATION_BATCH_REJECTED",
  );
  await assert.rejects(() => stat(rejectedOut), { code: "ENOENT" });

  await writeFile(input, bytes);
  const out = path.join(output, "out");
  await applyArtifactMigration({ inputs: [input], out, plan, digests });
  assert.deepEqual(await verifyMigrationOutput({ out, plan }), { ok: true });
});

test("ordinal digest swaps fail before publication and leave every source unchanged", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-migration-ordinal-swap-"));
  const source = path.join(root, "source");
  const output = path.join(root, "output");
  await mkdir(source, { mode: 0o700 });
  await mkdir(output, { mode: 0o700 });
  const blueprintBytes = await readFile(new URL("legacy-blueprint.json", FIXTURE_ROOT));
  const reportBytes = await readFile(new URL("legacy-report.json", FIXTURE_ROOT));
  const blueprint = path.join(source, "blueprint.json");
  const report = path.join(source, "report.json");
  await writeFile(blueprint, blueprintBytes);
  await writeFile(report, reportBytes);
  const inputs = [blueprint, report];
  const correct = bindings([blueprintBytes, reportBytes]);
  const swapped = Object.freeze({
    "migration-input-0": correct["migration-input-1"],
    "migration-input-1": correct["migration-input-0"],
  });

  await assert.rejects(
    () => planArtifactMigration(inputs, { digests: swapped }),
    (error) => error?.code === "AGENTMO_ARTIFACT_DIGEST_MISMATCH",
  );

  const plan = await planArtifactMigration(inputs, { digests: correct });
  const out = path.join(output, "out");
  await assert.rejects(
    () => applyArtifactMigration({ inputs, out, plan, digests: swapped }),
    (error) => error?.code === "AGENTMO_MIGRATION_BATCH_REJECTED",
  );
  await assert.rejects(() => stat(out), { code: "ENOENT" });
  assert.deepEqual(await readFile(blueprint), blueprintBytes);
  assert.deepEqual(await readFile(report), reportBytes);
});

test("preview rejects symlink sources and hostile batches without staging bytes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-migration-zero-staging-"));
  const source = path.join(root, "source");
  const output = path.join(root, "output");
  await mkdir(source, { mode: 0o700 });
  await mkdir(output, { mode: 0o700 });
  const legacy = JSON.parse(await readFile(new URL("legacy-blueprint.json", FIXTURE_ROOT), "utf8"));
  const hostileCandidates = [
    { ...legacy, nested: { rawToolOutput: "synthetic raw material" } },
    { ...legacy, stdout: "synthetic process material" },
    { ...legacy, api_key: "sk-syntheticcanary1234567890" },
    { ...legacy, notes: "/Users/synthetic-agentmo/private.txt" },
  ];
  for (const [index, candidate] of hostileCandidates.entries()) {
    const hostileBytes = Buffer.from(`${JSON.stringify(candidate)}\n`, "utf8");
    const hostile = path.join(source, `hostile-${index}.json`);
    await writeFile(hostile, hostileBytes);
    const hostilePlan = await planArtifactMigration([hostile], { digests: bindings([hostileBytes]) });
    assert.equal(hostilePlan.applicable, false);
    const hostileOut = path.join(output, `hostile-out-${index}`);
    await assert.rejects(
      () => applyArtifactMigration({
        inputs: [hostile],
        out: hostileOut,
        plan: hostilePlan,
        digests: bindings([hostileBytes]),
      }),
      (error) => error?.code === "AGENTMO_MIGRATION_BATCH_REJECTED",
    );
  }
  assert.deepEqual(await readdir(output), []);

  const safeBytes = await readFile(new URL("legacy-blueprint.json", FIXTURE_ROOT));
  const safe = path.join(source, "safe.json");
  const linked = path.join(source, "linked.json");
  await writeFile(safe, safeBytes);
  await symlink(safe, linked);
  const linkedPlan = await planArtifactMigration([linked], { digests: bindings([safeBytes]) });
  assert.equal(linkedPlan.applicable, false);
  assert.equal(linkedPlan.items[0].reason, "read_failed");
  assert.deepEqual(await readdir(output), []);
});

test("removed migration test and fault controls are rejected without filesystem mutation", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-migration-options-"));
  const source = path.join(root, "source");
  const output = path.join(root, "output");
  await mkdir(source, { mode: 0o700 });
  await mkdir(output, { mode: 0o700 });
  const bytes = await readFile(new URL("legacy-blueprint.json", FIXTURE_ROOT));
  const input = path.join(source, "input.json");
  await writeFile(input, bytes);
  const digests = bindings([bytes]);

  const plan = await planArtifactMigration([input], { digests });
  for (const option of [
    { sourceIo: {} },
    { onSourceCapture() {} },
  ]) {
    await assert.rejects(
      () => planArtifactMigration([input], { digests, ...option }),
      TypeError,
    );
  }
  for (const option of [
    { sourceIo: {} },
    { onSourceCapture() {} },
    { probeCapabilities: async () => ({ ok: true }) },
    { faults: { openAt: 1 } },
    { onCheckpoint() {} },
  ]) {
    await assert.rejects(
      () => applyArtifactMigration(
        { inputs: [input], out: path.join(output, "out"), plan, digests },
        option,
      ),
      TypeError,
    );
  }
  await assert.rejects(
    () => applyArtifactMigration({
      inputs: [input],
      out: path.join(output, "out"),
      plan,
      digests,
      __testOnly: true,
    }),
    TypeError,
  );
  await assert.rejects(
    () => verifyMigrationOutput({
      out: path.join(output, "out"),
      plan,
      onCheckpoint() {},
    }),
    TypeError,
  );
  assert.deepEqual(await readdir(output), []);
  assert.deepEqual(await readFile(input), bytes);
});

test("forged hostile publication models fail before an output directory exists", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-migration-forged-publication-"));
  const source = path.join(root, "source");
  const output = path.join(root, "output");
  await mkdir(source, { mode: 0o700 });
  await mkdir(output, { mode: 0o700 });
  const bytes = await readFile(new URL("legacy-blueprint.json", FIXTURE_ROOT));
  const input = path.join(source, "input.json");
  await writeFile(input, bytes);
  const digests = bindings([bytes]);
  const plan = await planArtifactMigration([input], { digests });

  for (const [index, injection] of [
    { nested: { rawTranscript: "synthetic raw material" } },
    { toolOutput: "synthetic tool material" },
    { credential: "sk-syntheticcanary1234567890" },
    { path: "/Users/synthetic-agentmo/private.txt" },
  ].entries()) {
    const forged = structuredClone(plan);
    forged.items[0].injected = injection;
    const out = path.join(output, `out-${index}`);
    await assert.rejects(
      () => applyArtifactMigration({ inputs: [input], out, plan: forged, digests }),
      (error) => error?.code === "AGENTMO_MIGRATION_BATCH_REJECTED",
    );
    await assert.rejects(() => stat(out), { code: "ENOENT" });
  }
  assert.deepEqual(await readdir(output), []);
});
