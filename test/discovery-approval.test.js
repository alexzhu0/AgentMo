import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { loadAdmittedArtifact } from "../src/artifact-admission.js";
import {
  buildDiscoveryApproval,
  buildDiscoveryApprovalPreview,
  DISCOVERY_APPROVAL_SCHEMA_VERSION,
  validateDiscoveryApproval,
  writeDiscoveryApproval,
} from "../src/discovery-approval.js";

const CLI = fileURLToPath(new URL("../bin/agentmo.js", import.meta.url));
const MANIFEST_FILE = fileURLToPath(new URL("../examples/support-triage.discovery.json", import.meta.url));
const DB_FILE = fileURLToPath(new URL("../examples/fixtures/support-triage/prebuilt-discovery-db.json", import.meta.url));

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function admitFile(filePath, subject, companions) {
  const bytes = await readFile(filePath);
  return loadAdmittedArtifact({
    filePath,
    subject,
    expectedDigest: digest(bytes),
    ...(companions ? { companions } : {}),
  });
}

async function approvalInputs() {
  const discoveryManifest = await admitFile(MANIFEST_FILE, "discovery-manifest");
  const discoveryDb = await admitFile(DB_FILE, "discovery-db");
  return {
    manifest: discoveryManifest.value,
    discoveryDb: discoveryDb.value,
    admissions: { discoveryManifest, discoveryDb },
  };
}

function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("discovery approval", () => {
  it("builds a deterministic two-digest preview and an enter-Plan-only approval", async () => {
    const inputs = await approvalInputs();
    const first = buildDiscoveryApprovalPreview(inputs.manifest, inputs.discoveryDb, inputs);
    const second = buildDiscoveryApprovalPreview(inputs.manifest, inputs.discoveryDb, inputs);

    assert.deepEqual(second, first);
    assert.match(first.previewDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.deepEqual(Object.keys(first.bindings), ["discoveryManifest", "discoveryDb"]);
    assert.deepEqual(
      Object.values(first.bindings).map(({ subject }) => subject),
      ["discovery-manifest", "discovery-db"],
    );

    const approval = buildDiscoveryApproval(inputs.manifest, inputs.discoveryDb, {
      ...inputs,
      approve: true,
      previewDigest: first.previewDigest,
    });
    assert.equal(approval.schemaVersion, DISCOVERY_APPROVAL_SCHEMA_VERSION);
    assert.equal(approval.decision, "approve");
    assert.equal(approval.decisionScope, "enter-plan");
    assert.deepEqual(approval.certificationBoundary, {
      localOperatorIntentOnly: true,
      authenticatedOrganization: false,
      sourceQuality: false,
      runtime: false,
      package: false,
      domain: false,
      production: false,
    });
    assert.equal(validateDiscoveryApproval(approval, {
      manifest: inputs.manifest,
      discoveryDb: inputs.discoveryDb,
      sources: {
        discoveryManifest: first.bindings.discoveryManifest,
        discoveryDb: first.bindings.discoveryDb,
      },
    }).ok, true);
  });

  it("requires explicit approval and the exact preview digest", async () => {
    const inputs = await approvalInputs();
    const preview = buildDiscoveryApprovalPreview(inputs.manifest, inputs.discoveryDb, inputs);
    assert.throws(
      () => buildDiscoveryApproval(inputs.manifest, inputs.discoveryDb, {
        ...inputs,
        previewDigest: preview.previewDigest,
      }),
      (error) => error.code === "AGENTMO_DISCOVERY_APPROVAL_REQUIRED",
    );
    assert.throws(
      () => buildDiscoveryApproval(inputs.manifest, inputs.discoveryDb, {
        ...inputs,
        approve: true,
        previewDigest: `sha256:${"0".repeat(64)}`,
      }),
      (error) => error.code === "AGENTMO_DISCOVERY_APPROVAL_PREVIEW_MISMATCH",
    );
  });

  it("publishes once to an absent path and rejects a forged clone", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-discovery-approval-write-"));
    const out = path.join(root, "approval.json");
    const inputs = await approvalInputs();
    const preview = buildDiscoveryApprovalPreview(inputs.manifest, inputs.discoveryDb, inputs);
    const approval = buildDiscoveryApproval(inputs.manifest, inputs.discoveryDb, {
      ...inputs,
      approve: true,
      previewDigest: preview.previewDigest,
    });

    await writeDiscoveryApproval(out, approval);
    const original = await readFile(out, "utf8");
    await assert.rejects(() => writeDiscoveryApproval(out, approval));
    assert.equal(await readFile(out, "utf8"), original);
    await assert.rejects(
      () => writeDiscoveryApproval(path.join(root, "forged.json"), structuredClone(approval)),
      (error) => error.code === "AGENTMO_PERSISTABILITY_UNADMITTED_CANDIDATE",
    );
  });

  it("CLI preview writes nothing and apply binds exact raw bytes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-discovery-approve-cli-"));
    const out = path.join(root, "approval.json");
    const manifestDigest = digest(await readFile(MANIFEST_FILE));
    const dbDigest = digest(await readFile(DB_FILE));
    const base = [
      "discovery-approve",
      MANIFEST_FILE,
      "--discovery-db",
      DB_FILE,
      "--digest",
      `discovery-manifest=${manifestDigest}`,
      "--digest",
      `discovery-db=${dbDigest}`,
      "--json",
    ];

    const previewResult = await runCli(base);
    assert.equal(previewResult.code, 0, previewResult.stderr);
    const preview = JSON.parse(previewResult.stdout);
    assert.match(preview.previewDigest, /^sha256:[a-f0-9]{64}$/u);
    await assert.rejects(() => access(out));

    const apply = await runCli([
      ...base,
      "--approve",
      "--preview-digest",
      preview.previewDigest,
      "--out",
      out,
    ]);
    assert.equal(apply.code, 0, apply.stderr);
    assert.equal(JSON.parse(apply.stdout).schemaVersion, DISCOVERY_APPROVAL_SCHEMA_VERSION);
    assert.equal(JSON.parse(await readFile(out, "utf8")).decisionScope, "enter-plan");

    const mutatedDb = path.join(root, "mutated-db.json");
    await writeFile(mutatedDb, `${await readFile(DB_FILE, "utf8")} `, "utf8");
    const stale = await runCli([
      "discovery-approve",
      MANIFEST_FILE,
      "--discovery-db",
      mutatedDb,
      "--digest",
      `discovery-manifest=${manifestDigest}`,
      "--digest",
      `discovery-db=${digest(await readFile(mutatedDb))}`,
      "--approve",
      "--preview-digest",
      preview.previewDigest,
      "--out",
      path.join(root, "must-not-exist.json"),
      "--json",
    ]);
    assert.equal(stale.code, 1);
    await assert.rejects(() => access(path.join(root, "must-not-exist.json")));
  });
});
