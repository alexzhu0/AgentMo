import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants as FS_CONSTANTS } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
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

function countingSourceIo() {
  const state = { fileOpens: 0 };
  return {
    state,
    io: {
      lstat,
      async open(filePath, flags, ...rest) {
        if ((flags & FS_CONSTANTS.O_DIRECTORY) === 0) state.fileOpens += 1;
        return open(filePath, flags, ...rest);
      },
    },
  };
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

test("preview and apply independently capture each source once through retained no-follow handles", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-migration-read-count-"));
  const source = path.join(root, "source");
  const output = path.join(root, "output");
  await mkdir(source, { mode: 0o700 });
  await mkdir(output, { mode: 0o700 });
  const bytes = await readFile(new URL("legacy-blueprint.json", FIXTURE_ROOT));
  const input = path.join(source, "input.json");
  await writeFile(input, bytes);
  const digests = bindings([bytes]);

  const previewIo = countingSourceIo();
  let previewCaptures = 0;
  const plan = await planArtifactMigration([input], {
    digests,
    sourceIo: previewIo.io,
    onSourceCapture: () => { previewCaptures += 1; },
  });
  assert.equal(plan.applicable, true);
  assert.equal(previewIo.state.fileOpens, 1);
  assert.equal(previewCaptures, 1);

  const applyIo = countingSourceIo();
  let applyCaptures = 0;
  const out = path.join(output, "out");
  await applyArtifactMigration(
    { inputs: [input], out, plan, digests },
    {
      sourceIo: applyIo.io,
      onSourceCapture: () => { applyCaptures += 1; },
    },
  );
  assert.equal(applyIo.state.fileOpens, 1);
  assert.equal(applyCaptures, 1);
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

test("retained source-parent identity rejects a parent swap during preview", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-migration-source-parent-swap-"));
  const source = path.join(root, "source");
  const replacement = path.join(root, "replacement");
  const retained = path.join(root, "retained-source");
  await mkdir(source, { mode: 0o700 });
  await mkdir(replacement, { mode: 0o700 });
  const originalBytes = await readFile(new URL("legacy-blueprint.json", FIXTURE_ROOT));
  const replacementBytes = await readFile(new URL("legacy-report.json", FIXTURE_ROOT));
  const input = path.join(source, "input.json");
  await writeFile(input, originalBytes);
  await writeFile(path.join(replacement, "input.json"), replacementBytes);
  let parentLstats = 0;
  let swapped = false;
  const sourceIo = {
    open,
    async lstat(filePath, options) {
      if (filePath === source) {
        parentLstats += 1;
        if (parentLstats === 3) {
          await rename(source, retained);
          await rename(replacement, source);
          swapped = true;
        }
      }
      return lstat(filePath, options);
    },
  };

  const plan = await planArtifactMigration([input], {
    digests: bindings([originalBytes]),
    sourceIo,
  });
  assert.equal(swapped, true);
  assert.equal(plan.applicable, false);
  assert.equal(plan.items[0].reason, "read_failed");
  assert.deepEqual(await readFile(path.join(retained, "input.json")), originalBytes);
  assert.deepEqual(await readFile(path.join(source, "input.json")), replacementBytes);
});

test("apply rechecks output-parent exclusion inside the retained source capture", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-migration-output-parent-rebind-"));
  const source = path.join(root, "source");
  const output = path.join(root, "output");
  const retainedSource = path.join(root, "retained-source");
  await mkdir(source, { mode: 0o700 });
  await mkdir(output, { mode: 0o700 });
  const bytes = await readFile(new URL("legacy-blueprint.json", FIXTURE_ROOT));
  const input = path.join(source, "input.json");
  await writeFile(input, bytes);
  await writeFile(path.join(output, "input.json"), bytes);
  const digests = bindings([bytes]);
  const plan = await planArtifactMigration([input], { digests });
  let swapped = false;
  const sourceIo = {
    open,
    async lstat(filePath, options) {
      if (!swapped && filePath === source) {
        await rename(source, retainedSource);
        await rename(output, source);
        await mkdir(output, { mode: 0o700 });
        swapped = true;
      }
      return lstat(filePath, options);
    },
  };
  const out = path.join(output, "out");

  await assert.rejects(
    () => applyArtifactMigration(
      { inputs: [input], out, plan, digests },
      { sourceIo },
    ),
    (error) => error?.code === "AGENTMO_MIGRATION_BATCH_REJECTED",
  );
  assert.equal(swapped, true);
  await assert.rejects(() => stat(out), { code: "ENOENT" });
  assert.deepEqual(await readFile(path.join(retainedSource, "input.json")), bytes);
  assert.deepEqual(await readFile(path.join(source, "input.json")), bytes);
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
