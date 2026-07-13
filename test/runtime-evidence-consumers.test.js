import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  NODE20_LANE_MARKER,
  OWNED_COMMAND_MANIFEST,
  readNode20Receipt,
} from "../scripts/node20-core-receipt.js";

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const THIS_FILE = fileURLToPath(import.meta.url);
const NODE20_RECEIPT_RELATIVE_PATH = "release/evidence/2026.07.13-node20-core-receipt.json";
const NODE20_RECEIPT = path.join(REPOSITORY_ROOT, NODE20_RECEIPT_RELATIVE_PATH);
const RUNTIME_COMPATIBILITY_DOCUMENT = path.join(REPOSITORY_ROOT, "docs/RUNTIME_COMPATIBILITY.md");
const RELEASE_RECORD = path.join(REPOSITORY_ROOT, "release/2026.07.13.md");
const RELEASE_INDEX = path.join(REPOSITORY_ROOT, "release/README.md");
const MAINTAINED_RUNTIME_ENV_FLAG_FILES = Object.freeze([
  "README.md",
  "AGENTS.md",
  "docs/RUNTIME_EXECUTION.md",
]);
const NODE20_ARCHIVE_SHA256 = "466e05f3477c20dfb723054dfebffe55bc74660ee77f612166fca121dacb65b6";
const NODE20_CHECKSUM_MANIFEST_SHA256 = "c6f74825d6ddf350ef06600c67fec6ea2f7996cf438a78c3cb2a89b29d4320ed";
const NODE20_EXECUTABLE_SHA256 = "38de4fc456c0c439bac48c727d378f749abb4e31f4116703bb1ee9a746fccbb6";
const NODE20_COMMAND = 'npm run check:core:node20 -- --node-bin "$NODE20_BIN" --archive "$NODE20_ARCHIVE" --checksums "$NODE20_CHECKSUMS" --expected-version 20.20.2 --expected-arch arm64 --receipt "$NODE20_RECEIPT"';
const BOUNDARY_COMMAND = "node --test test/runtime-compatibility.test.js test/runtime-compatibility-seams.test.js test/runtime-evidence-consumers.test.js test/cli.test.js test/live-smoke-script.test.js test/command-docs.test.js test/node20-core-runner.test.js test/node20-core-lane.test.js test/artifact-surface-coverage.test.js && bash -n scripts/node20-core-lane.sh scripts/openclaw-live-smoke.sh";
const BOUNDARY_EVIDENCE_REF = "test/runtime-compatibility.test.js; test/runtime-compatibility-seams.test.js; test/runtime-evidence-consumers.test.js; test/cli.test.js; test/live-smoke-script.test.js; test/command-docs.test.js; test/node20-core-runner.test.js; test/node20-core-lane.test.js; test/artifact-surface-coverage.test.js; scripts/node20-core-lane.sh#bash-n; scripts/openclaw-live-smoke.sh#bash-n";
const CURRENT_HOST_COMMAND = "npm run check";
const CURRENT_HOST_EVIDENCE_REF = "release/2026.07.13.md#phase-012-runtime-compatibility-evidence";
const CURRENT_HOST_RUNTIME = "24.18.0 arm64";
const CURRENT_HOST_RESULT = "current-host full suite PASS — 448/448 across 47 suites";
const RELEASE_EVIDENCE_CLASSES = Object.freeze([
  "upstream-declared",
  "official-supported",
  "contract-tested",
  "core-executed",
  "target-executed",
]);
const RELEASE_STATUSES = Object.freeze(["tested", "failed", "untested"]);
const RELEASE_INDEX_ROW = "| 2026.07.13 | Phase 01.2 runtime compatibility：Node 20 receipt + pre-effect OpenClaw gates | 有界复跑通过；记录与实现须同一 `main` checkpoint | [`2026.07.13.md`](./2026.07.13.md) | 待发布 |";
const VERIFY_FLAG = "--verify-published-evidence";

const verifyIndex = process.argv.indexOf(VERIFY_FLAG);
if (verifyIndex !== -1) {
  try {
    await verifyPublishedEvidence(process.argv[verifyIndex + 1]);
  } catch {
    process.stderr.write("AGENTMO_NODE20_EVIDENCE_CONSUMER_MISMATCH\n");
    process.exitCode = 1;
  }
} else {
  describe("post-publication runtime evidence consumers", () => {
    it("requires exact receipt, matrix, and release correspondence", async () => {
      await verifyPublishedEvidence(NODE20_RECEIPT);
    });

    it("keeps consumers outside the producer command manifest with exact producer counts", () => {
      const core = OWNED_COMMAND_MANIFEST.find((batch) => batch.id === "core-contracts");
      assert.notEqual(core, undefined);
      assert.deepEqual(core.expected, { pass: 45, skip: 0, fail: 0, total: 45 });
      assert.equal(core.files.includes("test/runtime-compatibility-seams.test.js"), true);
      assert.equal(core.files.includes("test/runtime-evidence-consumers.test.js"), false);
      assert.equal(
        OWNED_COMMAND_MANIFEST.some((batch) => batch.files.includes("test/runtime-evidence-consumers.test.js")),
        false,
      );
    });

    it("rejects a missing receipt even when every historical public marker is supplied", async () => {
      const directory = await mkdtemp(path.join(tmpdir(), "agentmo-node20-consumer-missing-"));
      const result = runConsumerCanary(path.join(directory, "missing-receipt.json"));

      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "AGENTMO_NODE20_EVIDENCE_CONSUMER_MISMATCH\n");
    });

    it("rejects stale receipt facts even when every historical public marker matches them", async () => {
      const directory = await mkdtemp(path.join(tmpdir(), "agentmo-node20-consumer-stale-"));
      const receipt = JSON.parse(await readFile(NODE20_RECEIPT, "utf8"));
      const stalePath = path.join(directory, "stale-receipt.json");
      const stale = {
        ...receipt,
        commandSetDigest: receipt.commandSetDigest === "f".repeat(64)
          ? "e".repeat(64)
          : "f".repeat(64),
      };
      await writeFile(stalePath, `${JSON.stringify(stale, null, 2)}\n`, "utf8");

      const result = runConsumerCanary(stalePath, stale);
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "AGENTMO_NODE20_EVIDENCE_CONSUMER_MISMATCH\n");
    });

    it("records only bounded exact release facts and leaves target live execution untested", async () => {
      const source = await readFile(RELEASE_RECORD, "utf8");
      for (const exactFact of [
        "## Phase 01.2 runtime compatibility evidence",
        "[Runtime compatibility matrix](../docs/RUNTIME_COMPATIBILITY.md)",
        "current host `v24.18.0` arm64",
        "`v20.20.2` arm64",
        NODE20_ARCHIVE_SHA256,
        CURRENT_HOST_RESULT,
        "`target-executed` | provider-backed OpenClaw live execution | official target range | `untested`",
        "collision-free `--runtime-env-file` option reaches AgentMo through real Node and shebang launchers",
        "repo-owned trust anchor",
        "post-publication consumers",
        "does not certify domain quality, approve production, or certify wider OpenClaw compatibility",
      ]) assert.equal(source.includes(exactFact), true, exactFact);
      assertValueBlindEvidence(source, "release/2026.07.13.md");
    });

    it("keeps the public runtime environment flag collision-free across maintenance surfaces", async () => {
      for (const relativePath of MAINTAINED_RUNTIME_ENV_FLAG_FILES) {
        const source = await readFile(path.join(REPOSITORY_ROOT, relativePath), "utf8");
        assert.match(source, /--runtime-env-file\b/u, relativePath);
        assert.doesNotMatch(source, /(?:^|\s)--env-file(?:\s|\]|<)/mu, relativePath);
      }
    });
  });
}

async function verifyPublishedEvidence(receiptPath) {
  const [receiptBytes, receipt, matrixSource, releaseSource, releaseIndexSource] = await Promise.all([
    readFile(receiptPath),
    readNode20Receipt(receiptPath),
    readFile(RUNTIME_COMPATIBILITY_DOCUMENT, "utf8"),
    readFile(RELEASE_RECORD, "utf8"),
    readFile(RELEASE_INDEX, "utf8"),
  ]);
  const receiptSha256 = sha256(receiptBytes);
  const node20EvidenceRef = buildNode20EvidenceRef(receipt, receiptSha256);

  assert.deepEqual(receipt.runtime, {
    version: "20.20.2",
    architecture: "arm64",
    processExecPathMatchesSelectedExecutable: true,
  });
  assert.deepEqual(receipt.batches.map((batch) => batch.id), [
    "syntax",
    "core-contracts",
    "stage-contracts",
  ]);
  assert.equal(receipt.provenance.archiveName, "node-v20.20.2-darwin-arm64.tar.gz");
  assert.equal(receipt.provenance.archiveSha256, NODE20_ARCHIVE_SHA256);
  assert.equal(receipt.provenance.checksumEntrySha256, NODE20_ARCHIVE_SHA256);
  assert.equal(receipt.provenance.checksumManifestSha256, NODE20_CHECKSUM_MANIFEST_SHA256);
  assert.equal(receipt.provenance.archiveMemberSha256, NODE20_EXECUTABLE_SHA256);
  assert.equal(receipt.provenance.executableSha256, NODE20_EXECUTABLE_SHA256);
  assertValueBlindEvidence(receiptBytes.toString("utf8"), NODE20_RECEIPT_RELATIVE_PATH);

  const matrixMatch = /<!-- agentmo:runtime-compatibility-matrix:v1 -->\s*```json\s*([\s\S]*?)\s*```/u.exec(matrixSource);
  assert.notEqual(matrixMatch, null, "missing canonical compatibility matrix block");
  const matrix = JSON.parse(matrixMatch[1]);
  assert.deepEqual(Object.keys(matrix), [
    "schemaVersion",
    "observedAt",
    "evidenceClasses",
    "statuses",
    "rows",
    "certificationBoundary",
  ]);
  assert.equal(matrix.schemaVersion, "agentmo.runtime-compatibility-matrix.v1");
  assert.equal(matrix.observedAt, "2026-07-13");
  assert.deepEqual(matrix.evidenceClasses, RELEASE_EVIDENCE_CLASSES);
  assert.deepEqual(matrix.statuses, RELEASE_STATUSES);

  const expectedRowIds = [
    "agentmo-core-declaration",
    "openclaw-package-declaration",
    "openclaw-official-support",
    "openclaw-boundary-contract",
    "current-host-core-execution",
    "node20-core-execution",
    "openclaw-target-live-execution",
  ];
  assert.deepEqual(matrix.rows.map((row) => row.id), expectedRowIds);
  for (const row of matrix.rows) {
    assert.deepEqual(Object.keys(row), [
      "id",
      "component",
      "evidenceClass",
      "claim",
      "runtimeVersion",
      "range",
      "command",
      "status",
      "evidenceRef",
      "remainingRisk",
    ], row.id);
    assert.equal(RELEASE_EVIDENCE_CLASSES.includes(row.evidenceClass), true, row.id);
    assert.equal(RELEASE_STATUSES.includes(row.status), true, row.id);
    if (row.status === "tested") {
      assert.equal(typeof row.command, "string", `${row.id} must name its observed command`);
      assert.equal(row.command.length > 0, true, row.id);
    }
  }

  const byId = new Map(matrix.rows.map((row) => [row.id, row]));
  assert.deepEqual(
    [...byId.values()].map(({ id, evidenceClass, status }) => ({ id, evidenceClass, status })),
    [
      { id: "agentmo-core-declaration", evidenceClass: "upstream-declared", status: "untested" },
      { id: "openclaw-package-declaration", evidenceClass: "upstream-declared", status: "untested" },
      { id: "openclaw-official-support", evidenceClass: "official-supported", status: "untested" },
      { id: "openclaw-boundary-contract", evidenceClass: "contract-tested", status: "tested" },
      { id: "current-host-core-execution", evidenceClass: "core-executed", status: "tested" },
      { id: "node20-core-execution", evidenceClass: "core-executed", status: "tested" },
      { id: "openclaw-target-live-execution", evidenceClass: "target-executed", status: "untested" },
    ],
  );
  assert.equal(byId.get("agentmo-core-declaration").range, ">=20");
  assert.equal(byId.get("openclaw-package-declaration").range, ">=22.19.0");
  assert.equal(byId.get("openclaw-official-support").range, ">=22.19.0 <23 || >=23.11.0");
  assert.equal(byId.get("openclaw-boundary-contract").range, ">=22.19.0 <23 || >=23.11.0");
  assert.equal(byId.get("current-host-core-execution").runtimeVersion, CURRENT_HOST_RUNTIME);
  assert.equal(byId.get("node20-core-execution").runtimeVersion, `${receipt.runtime.version} ${receipt.runtime.architecture}`);
  assert.equal(byId.get("openclaw-target-live-execution").runtimeVersion, null);
  assert.equal(
    byId.get("openclaw-boundary-contract").claim,
    "The disjoint version predicate, JavaScript mutation seams, production CLI pre-intake canaries, dynamic live-smoke shell seam, Bash syntax, bounded caller classification, and exact I/O inventory are tested.",
  );
  assert.deepEqual(
    [...byId.values()].filter((row) => row.status === "tested").map((row) => ({
      id: row.id,
      command: row.command,
      evidenceRef: row.evidenceRef,
    })),
    [
      { id: "openclaw-boundary-contract", command: BOUNDARY_COMMAND, evidenceRef: BOUNDARY_EVIDENCE_REF },
      { id: "current-host-core-execution", command: CURRENT_HOST_COMMAND, evidenceRef: CURRENT_HOST_EVIDENCE_REF },
      { id: "node20-core-execution", command: NODE20_COMMAND, evidenceRef: node20EvidenceRef },
    ],
  );
  assert.equal(byId.get("openclaw-target-live-execution").command, null);
  assert.equal(byId.get("openclaw-target-live-execution").evidenceRef, "None — deliberately not executed in Phase 01.2.");
  assert.deepEqual(matrix.certificationBoundary, {
    runtimeEvidenceCertifiesDomainQuality: false,
    runtimeEvidenceApprovesProduction: false,
    runtimeEvidenceCertifiesWiderOpenClaw: false,
  });
  assert.equal(matrixSource.includes("does not certify domain quality"), true);
  assert.equal(matrixSource.includes("does not approve production"), true);
  assert.equal(matrixSource.includes("does not certify wider OpenClaw compatibility"), true);
  assertValueBlindEvidence(matrixSource, "docs/RUNTIME_COMPATIBILITY.md");

  const aggregate = receipt.batches.reduce((counts, batch) => ({
    pass: counts.pass + batch.pass,
    skip: counts.skip + batch.skip,
    fail: counts.fail + batch.fail,
    total: counts.total + batch.total,
  }), { pass: 0, skip: 0, fail: 0, total: 0 });
  assert.equal(aggregate.total, aggregate.pass + aggregate.skip + aggregate.fail);
  assert.equal(aggregate.fail, 0);
  const byBatch = new Map(receipt.batches.map((batch) => [batch.id, batch]));
  const syntax = byBatch.get("syntax");
  const core = byBatch.get("core-contracts");
  const stage = byBatch.get("stage-contracts");
  const exactNode20Result = `Node 20 main batch PASS — ${core.pass}/${core.total}；syntax PASS — ${syntax.pass}/${syntax.total}；Stage 1/2/3 handoff subset PASS — ${stage.pass}/${stage.pass}，另有 ${stage.skip} skip；${aggregate.fail} fail。`;
  for (const exactFact of [
    NODE20_COMMAND,
    BOUNDARY_COMMAND,
    CURRENT_HOST_COMMAND,
    node20EvidenceRef,
    `receipt-sha256=${receiptSha256}`,
    `command-set-sha256=${receipt.commandSetDigest}`,
    `checksums-manifest-sha256=${NODE20_CHECKSUM_MANIFEST_SHA256}`,
    exactNode20Result,
    CURRENT_HOST_RESULT,
  ]) assert.equal(releaseSource.includes(exactFact), true, exactFact);
  assertValueBlindEvidence(releaseSource, "release/2026.07.13.md");
  assert.equal(releaseIndexSource.includes(RELEASE_INDEX_ROW), true);
  assertValueBlindEvidence(releaseIndexSource, "release/README.md");
}

function runConsumerCanary(receiptPath, receipt = null) {
  return spawnSync(process.execPath, [THIS_FILE, VERIFY_FLAG, receiptPath], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      AGENTMO_NODE20_CORE_LANE: NODE20_LANE_MARKER,
      AGENTMO_NODE20_EXPECTED_VERSION: receipt?.runtime.version ?? "20.20.2",
      AGENTMO_NODE20_EXPECTED_ARCH: receipt?.runtime.architecture ?? "arm64",
      AGENTMO_NODE20_EXECUTABLE_SHA256: receipt?.provenance.executableSha256 ?? NODE20_EXECUTABLE_SHA256,
      AGENTMO_NODE20_COMMAND_SET_DIGEST: receipt?.commandSetDigest ?? "f".repeat(64),
      AGENTMO_NODE20_PROCESS_EXECUTABLE_MATCH: "true",
    },
  });
}

function buildNode20EvidenceRef(receipt, receiptSha256) {
  const batches = receipt.batches
    .map((batch) => `${batch.id}:${batch.pass}/${batch.skip}/${batch.fail}/${batch.total}`)
    .join("|");
  return [
    `receipt=${NODE20_RECEIPT_RELATIVE_PATH}`,
    `receipt-sha256=${receiptSha256}`,
    `command-set-sha256=${receipt.commandSetDigest}`,
    `archive-sha256=${receipt.provenance.archiveSha256}`,
    `checksums-manifest-sha256=${receipt.provenance.checksumManifestSha256}`,
    `archive-member-sha256=${receipt.provenance.archiveMemberSha256}`,
    `executable-sha256=${receipt.provenance.executableSha256}`,
    `batches=${batches}`,
  ].join("; ");
}

function assertValueBlindEvidence(source, label) {
  assert.doesNotMatch(source, /\/(?:Users|home)\//u, label);
  assert.doesNotMatch(source, /[A-Za-z]:\\Users\\/u, label);
  assert.doesNotMatch(source, /\b(?:sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]+)\b/u, label);
  if (label.endsWith(".json")) {
    const parsed = JSON.parse(source);
    const forbiddenKeys = new Set([
      "stdout",
      "stderr",
      "payload",
      "transcript",
      "credentials",
      "env",
      "nodeBin",
      "archivePath",
      "checksumsPath",
      "receiptPath",
      "repositoryRoot",
      "processExecPath",
    ]);
    assert.deepEqual(findForbiddenKeys(parsed, forbiddenKeys), [], label);
  }
}

function findForbiddenKeys(value, forbiddenKeys, trail = []) {
  if (value === null || typeof value !== "object") return [];
  const found = [];
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.has(key)) found.push([...trail, key].join("."));
    found.push(...findForbiddenKeys(child, forbiddenKeys, [...trail, key]));
  }
  return found;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
