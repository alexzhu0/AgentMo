import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdtemp,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const RUNNER = path.join(REPOSITORY_ROOT, "scripts/node20-core-lane.sh");
const RECEIPT_MODULE = new URL("../scripts/node20-core-receipt.js", import.meta.url);
const DISTRIBUTION_TRUST = new URL("../scripts/node20-distribution-trust.json", import.meta.url);
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

describe("Node 20 core runner fail-closed contract", () => {
  it("keeps acquisition, PATH resolution, and command ownership out of the shell entry point", async () => {
    const [runner, helper] = await Promise.all([
      readFile(RUNNER, "utf8"),
      readFile(RECEIPT_MODULE, "utf8"),
    ]);
    for (const flag of [
      "--node-bin",
      "--archive",
      "--checksums",
      "--expected-version",
      "--expected-arch",
      "--receipt",
    ]) assert.match(runner, new RegExp(flag, "u"));
    assert.doesNotMatch(runner, /--trust-anchor/u);
    assert.match(runner, /node20-core-receipt\.js/u);
    assert.match(helper, /node20-distribution-trust\.json/u);
    assert.match(helper, /spawn\(process\.execPath/u);
    assert.match(helper, /writePersistableJsonAtomic/u);
    assert.doesNotMatch(runner, /\bcommand -v\b|\bNODE20_BIN\b|\b(?:curl|wget|brew|apt|npx)\b/iu);
    assert.doesNotMatch(helper, /\b(?:curl|wget|brew|apt|npx|npm install|npm add|npm exec)\b/iu);
  });

  it("syntax-checks the shipped Candidate and Decision Entry writer modules in the owned Node 20 batch", async () => {
    const { OWNED_COMMAND_MANIFEST } = await loadReceiptModule();
    const syntax = OWNED_COMMAND_MANIFEST.find(({ id }) => id === "syntax");
    assert.equal(syntax.files.includes("src/agent-idea-candidate-cli.js"), true);
    assert.equal(syntax.files.includes("src/agent-idea-candidate.js"), true);
    assert.equal(syntax.files.includes("src/decision-entry-canonicalizer.js"), true);
    assert.deepEqual(syntax.expected, { pass: 43, skip: 0, fail: 0, total: 43 });
  });

  it("requires every explicit provenance input and never searches PATH", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "agentmo-node20-missing-"));
    const marker = path.join(directory, "path-wrapper-ran");
    const receipt = path.join(directory, "must-remain-absent.json");
    const wrapper = path.join(directory, "node");
    await writeExecutable(wrapper, `#!/usr/bin/env bash\nprintf invoked > "${marker}"\nexit 0\n`);

    const result = runRunner([], {
      PATH: `${directory}:${process.env.PATH ?? ""}`,
    });

    assert.equal(result.status, 2);
    assert.match(result.stderr, /AGENTMO_NODE20_LANE_REQUIRED_INPUT/u);
    await assertPathAbsent(marker);
    await assertPathAbsent(receipt);
  });

  it("rejects a contract-only self-reporting wrapper that runs no Node command", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "agentmo-node20-wrapper-"));
    const wrapper = path.join(directory, "node-wrapper");
    const archive = path.join(directory, "node-v20.20.2-contract-only.tar.gz");
    const checksums = path.join(directory, "SHASUMS256.txt");
    const receipt = path.join(directory, "must-remain-absent.json");
    await writeExecutable(wrapper, "#!/usr/bin/env bash\nexit 0\n");
    await writeFile(archive, "contract-only archive fixture", "utf8");
    await writeFile(checksums, `${sha256("contract-only archive fixture")}  ${path.basename(archive)}\n`, "utf8");

    const result = runRunner(runnerArguments({
      nodeBin: wrapper,
      archive,
      checksums,
      receipt,
    }));

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /AGENTMO_NODE20_LANE_RECEIPT_NOT_PUBLISHED/u);
    await assertPathAbsent(receipt);
  });

  it("cannot turn the ordinary current executable into Node 20 evidence without approved provenance", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "agentmo-node20-current-"));
    const archive = path.join(directory, "node-v20.20.2-contract-only.tar.gz");
    const checksums = path.join(directory, "SHASUMS256.txt");
    const receipt = path.join(directory, "nested", "must-remain-absent.json");
    await writeFile(archive, "not an approved distribution", "utf8");
    await writeFile(checksums, `${sha256("different bytes")}  ${path.basename(archive)}\n`, "utf8");

    const result = runRunner(runnerArguments({
      nodeBin: await canonicalPath(process.execPath),
      archive,
      checksums,
      expectedVersion: process.versions.node,
      expectedArch: process.arch,
      receipt,
    }));

    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /status[^\n]*tested/iu);
    await assertPathAbsent(receipt);
    await assertPathAbsent(path.dirname(receipt));
  });

  it("rejects a self-signed archive and manifest against the repository trust anchor", async () => {
    const {
      assertSelectedProcessIdentity,
      verifyDistributionProvenance,
    } = await loadReceiptModule();
    const directory = await mkdtemp(path.join(tmpdir(), "agentmo-node20-provenance-"));
    const selected = path.join(directory, "selected-node");
    const memberBytes = Buffer.from("contract-only archive member\n", "utf8");
    const archiveName = "node-v20.20.2-darwin-arm64.tar.gz";
    const archive = path.join(directory, archiveName);
    const memberName = "node-v20.20.2-darwin-arm64/bin/node";
    const checksums = path.join(directory, "SHASUMS256.txt");
    await writeFile(selected, memberBytes);
    await chmod(selected, 0o755);
    const archiveBytes = createTarGzip(memberName, memberBytes);
    await writeFile(archive, archiveBytes);
    await writeFile(checksums, `${sha256(archiveBytes)}  ${archiveName}\n`, "utf8");

    await assert.rejects(
      () => verifyDistributionProvenance({
        nodeBin: selected,
        archive,
        checksums,
        expectedVersion: "20.20.2",
        expectedPlatform: "darwin",
        expectedArch: "arm64",
      }),
      (error) => error?.code === "AGENTMO_NODE20_LANE_TRUST_ANCHOR_MISMATCH",
    );
    await assert.rejects(
      () => canonicalPath(selected).then((candidate) => assertSelectedProcessIdentity(candidate)),
      (error) => error?.code === "AGENTMO_NODE20_LANE_PROCESS_EXECUTABLE_MISMATCH",
    );
  });

  it("owns one closed exact Node distribution selector with no caller extension point", async () => {
    const { selectApprovedDistribution } = await loadReceiptModule();
    const trust = JSON.parse(await readFile(DISTRIBUTION_TRUST, "utf8"));
    assert.deepEqual(Object.keys(trust), ["schemaVersion", "distributions"]);
    assert.equal(trust.schemaVersion, "agentmo.node20-distribution-trust.v1");
    assert.equal(trust.distributions.length, 1);
    assert.deepEqual(
      Object.keys(trust.distributions[0]),
      [
        "version",
        "platform",
        "architecture",
        "archiveName",
        "archiveSha256",
        "checksumManifestSha256",
        "archiveMember",
        "archiveMemberSha256",
        "executableSha256",
      ],
    );
    for (const key of [
      "archiveSha256",
      "checksumManifestSha256",
      "archiveMemberSha256",
      "executableSha256",
    ]) assert.match(trust.distributions[0][key], SHA256_PATTERN);
    assert.deepEqual(trust.distributions[0], {
      version: "20.20.2",
      platform: "darwin",
      architecture: "arm64",
      archiveName: "node-v20.20.2-darwin-arm64.tar.gz",
      archiveSha256: "466e05f3477c20dfb723054dfebffe55bc74660ee77f612166fca121dacb65b6",
      checksumManifestSha256: "c6f74825d6ddf350ef06600c67fec6ea2f7996cf438a78c3cb2a89b29d4320ed",
      archiveMember: "node-v20.20.2-darwin-arm64/bin/node",
      archiveMemberSha256: "38de4fc456c0c439bac48c727d378f749abb4e31f4116703bb1ee9a746fccbb6",
      executableSha256: "38de4fc456c0c439bac48c727d378f749abb4e31f4116703bb1ee9a746fccbb6",
    });
    const selected = await selectApprovedDistribution({
      version: "20.20.2",
      platform: "darwin",
      architecture: "arm64",
    });
    assert.deepEqual(selected, trust.distributions[0]);
    assert.equal(Object.isFrozen(selected), true);
    await assert.rejects(
      () => selectApprovedDistribution({
        version: "20.20.2",
        platform: "darwin",
        architecture: "x64",
      }),
      (error) => error?.code === "AGENTMO_NODE20_LANE_TRUST_ANCHOR_NOT_FOUND",
    );
  });

  it("parses TAP counts instead of trusting a successful exit code", async () => {
    const { validateTapBatch } = await loadReceiptModule();
    const expected = { pass: 3, skip: 1, fail: 0, total: 4 };
    const valid = tapSummary(expected);

    assert.deepEqual(validateTapBatch(valid, expected), expected);
    assert.throws(
      () => validateTapBatch("TAP version 13\n1..0\n", expected),
      (error) => error?.code === "AGENTMO_NODE20_LANE_TAP_SUMMARY_MISSING",
    );
    assert.throws(
      () => validateTapBatch(tapSummary({ pass: 0, skip: 4, fail: 0, total: 4 }), expected),
      (error) => error?.code === "AGENTMO_NODE20_LANE_TAP_ZERO_MATCH",
    );
    assert.throws(
      () => validateTapBatch(tapSummary({ pass: 3, skip: 0, fail: 0, total: 3 }), expected),
      (error) => error?.code === "AGENTMO_NODE20_LANE_TAP_COUNT_MISMATCH",
    );
    assert.throws(
      () => validateTapBatch(tapSummary({ pass: 2, skip: 1, fail: 1, total: 4 }), expected),
      (error) => error?.code === "AGENTMO_NODE20_LANE_TAP_FAILURE",
    );
  });

  it("owns one immutable command manifest with pinned Stage matches and a stable digest", async () => {
    const {
      COMMAND_SET_DIGEST,
      OWNED_COMMAND_MANIFEST,
    } = await loadReceiptModule();

    assert.deepEqual(OWNED_COMMAND_MANIFEST.map(({ id, kind }) => ({ id, kind })), [
      { id: "syntax", kind: "syntax" },
      { id: "core-contracts", kind: "test" },
      { id: "stage-contracts", kind: "test" },
    ]);
    assert.deepEqual(OWNED_COMMAND_MANIFEST.find(({ id }) => id === "core-contracts").expected, {
      pass: 62,
      skip: 1,
      fail: 0,
      total: 63,
    });
    assert.deepEqual(OWNED_COMMAND_MANIFEST.at(-1).expected, {
      pass: 3,
      skip: 2,
      fail: 0,
      total: 5,
    });
    assert.equal(Object.isFrozen(OWNED_COMMAND_MANIFEST), true);
    assert.equal(Object.isFrozen(OWNED_COMMAND_MANIFEST.at(-1).expected), true);
    assert.match(COMMAND_SET_DIGEST, SHA256_PATTERN);
  });

  it("builds an exact value-blind, count-complete, non-certifying receipt", async () => {
    const {
      COMMAND_SET_DIGEST,
      assertNode20Receipt,
      buildNode20Receipt,
    } = await loadReceiptModule();
    const receipt = buildNode20Receipt(receiptInput(COMMAND_SET_DIGEST, {
      pass: 62,
      skip: 1,
      fail: 0,
      total: 63,
    }));

    assert.deepEqual(Object.keys(receipt), [
      "schemaVersion",
      "status",
      "observedAt",
      "runtime",
      "provenance",
      "commandSetDigest",
      "batches",
      "certificationBoundary",
    ]);
    assert.equal(receipt.schemaVersion, "agentmo.node20-core-lane-receipt.v1");
    assert.equal(receipt.status, "tested");
    assert.deepEqual(receipt.certificationBoundary, {
      runtimeEvidenceCertifiesDomainQuality: false,
      runtimeEvidenceApprovesProduction: false,
      runtimeEvidenceCertifiesWiderOpenClaw: false,
    });
    assert.equal(assertNode20Receipt(receipt), receipt);
    assert.doesNotMatch(JSON.stringify(receipt), /\/(?:Users|home|private|tmp)\//u);
    assert.doesNotMatch(JSON.stringify(receipt), /(?:stdout|stderr|payload|transcript|credential|envValue)/iu);

    assert.throws(
      () => assertNode20Receipt({ ...receipt, unexpected: true }),
      (error) => error?.code === "AGENTMO_NODE20_LANE_RECEIPT_INVALID",
    );
  });

  it("allows non-negative published skip shape while exact manifest counts stay fail closed", async () => {
    const {
      COMMAND_SET_DIGEST,
      assertNode20Receipt,
      buildNode20Receipt,
    } = await loadReceiptModule();
    const receipt = buildNode20Receipt(receiptInput(COMMAND_SET_DIGEST, {
      pass: 62,
      skip: 1,
      fail: 0,
      total: 63,
    }));

    assert.equal(assertNode20Receipt(receipt), receipt);
    for (const batches of [
      receipt.batches.map((batch) => batch.id === "core-contracts"
        ? { ...batch, skip: 2, total: batch.total + 1 }
        : batch),
      receipt.batches.map((batch) => batch.id === "core-contracts"
        ? { ...batch, id: "wrong-core-contracts" }
        : batch),
      receipt.batches.map((batch) => batch.id === "core-contracts"
        ? { ...batch, pass: batch.pass - 1, total: batch.total - 1 }
        : batch),
    ]) {
      assert.throws(
        () => assertNode20Receipt({ ...receipt, batches }),
        (error) => error?.code === "AGENTMO_NODE20_LANE_RECEIPT_INVALID",
      );
    }
  });
});

function receiptInput(commandSetDigest, coreCounts) {
  const digest = "a".repeat(64);
  return {
    observedAt: "2026-07-13T08:30:00.000Z",
    runtime: {
      version: "20.20.2",
      architecture: "arm64",
      processExecPathMatchesSelectedExecutable: true,
    },
    provenance: {
      archiveName: "node-v20.20.2-darwin-arm64.tar.gz",
      archiveSha256: digest,
      checksumManifestSha256: "b".repeat(64),
      checksumEntrySha256: digest,
      archiveMember: "node-v20.20.2-darwin-arm64/bin/node",
      archiveMemberSha256: "c".repeat(64),
      executableSha256: "c".repeat(64),
      executableMatchesArchiveMember: true,
    },
    commandSetDigest,
    batches: [
      { id: "syntax", pass: 43, skip: 0, fail: 0, total: 43 },
      { id: "core-contracts", ...coreCounts },
      { id: "stage-contracts", pass: 3, skip: 2, fail: 0, total: 5 },
    ],
  };
}

function runnerArguments({
  nodeBin,
  archive,
  checksums,
  expectedVersion = "20.20.2",
  expectedArch = "arm64",
  receipt,
}) {
  return [
    "--node-bin", nodeBin,
    "--archive", archive,
    "--checksums", checksums,
    "--expected-version", expectedVersion,
    "--expected-arch", expectedArch,
    "--receipt", receipt,
  ];
}

function runRunner(args, env = {}) {
  return spawnSync("bash", [RUNNER, ...args], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
      NODE20_BIN: "",
      NODE_OPTIONS: "",
      NODE_PATH: "",
    },
  });
}

async function loadReceiptModule() {
  return import(RECEIPT_MODULE.href);
}

async function writeExecutable(filePath, source) {
  await writeFile(filePath, source, "utf8");
  await chmod(filePath, 0o755);
}

async function canonicalPath(candidate) {
  const { realpath } = await import("node:fs/promises");
  return realpath(candidate);
}

async function assertPathAbsent(candidate) {
  await assert.rejects(() => stat(candidate), (error) => error?.code === "ENOENT");
}

function tapSummary({ pass, skip, fail, total }) {
  return [
    "TAP version 13",
    `1..${total}`,
    `# tests ${total}`,
    "# suites 0",
    `# pass ${pass}`,
    `# fail ${fail}`,
    "# cancelled 0",
    `# skipped ${skip}`,
    "# todo 0",
    "# duration_ms 1",
    "",
  ].join("\n");
}

function createTarGzip(memberName, content) {
  const header = Buffer.alloc(512, 0);
  header.write(memberName, 0, 100, "utf8");
  writeTarOctal(header, 100, 8, 0o755);
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(header, 124, 12, content.length);
  writeTarOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const checksumText = checksum.toString(8).padStart(6, "0");
  header.write(checksumText, 148, 6, "ascii");
  header[154] = 0;
  header[155] = 0x20;
  const padding = Buffer.alloc((512 - (content.length % 512)) % 512, 0);
  return gzipSync(Buffer.concat([header, content, padding, Buffer.alloc(1024, 0)]));
}

function writeTarOctal(buffer, offset, length, value) {
  const text = value.toString(8).padStart(length - 1, "0");
  buffer.write(text, offset, length - 1, "ascii");
  buffer[offset + length - 1] = 0;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
