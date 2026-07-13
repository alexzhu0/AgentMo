import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";
import {
  access,
  appendFile,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { constants as FS_CONSTANTS, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  buildDiscoveryWorkspace,
  DISCOVERY_SOURCE_INTAKE_POLICY,
  writeDiscoveryWorkspace,
} from "../src/discovery-source-workspace.js";

const CLI = fileURLToPath(new URL("../bin/agentmo.js", import.meta.url));
const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const SUPPORT_DISCOVERY = fileURLToPath(new URL("../examples/support-triage.discovery.json", import.meta.url));
const SUPPORT_NEED = fileURLToPath(new URL("../examples/support-triage.need.json", import.meta.url));
const PREBUILT_DISCOVERY_DB = fileURLToPath(
  new URL("../examples/fixtures/support-triage/prebuilt-discovery-db.json", import.meta.url),
);

const DISCOVERY_DB_FILENAME = "agentmo-discovery-db.json";
const FACTS_FILENAME = "facts.jsonl";
const COVERAGE_FILENAME = "coverage.json";
const SOURCE_CARDS_FILENAME = "source-cards.json";
const SOURCE_CHUNKS_FILENAME = "source-chunks.jsonl";
const WORKSPACE_SCHEMA_VERSION = "agentmo.discovery-workspace.v1";

const tempPaths = [];

after(async () => {
  for (const target of tempPaths.reverse()) {
    await rm(target, { recursive: true, force: true });
  }
});

function runCliRaw(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: REPO_ROOT,
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

async function runCli(args) {
  const [command, manifestPath, ...rest] = args;
  if (["discover-report", "discover-pack", "discover-workspace"].includes(command) && !args.includes("--digest")) {
    const bytes = await readFile(manifestPath);
    const binding = `discovery-manifest=sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    return runCliRaw([command, manifestPath, "--digest", binding, ...rest]);
  }
  return runCliRaw(args);
}

async function makeTempDir(prefix, parent = tmpdir()) {
  const dir = await mkdtemp(path.join(parent, prefix));
  tempPaths.push(dir);
  return dir;
}

async function makeRepoTempDir(prefix = ".agentmo-test-source-") {
  return makeTempDir(prefix, REPO_ROOT);
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, value, "utf8");
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function readJsonl(file) {
  const text = await readFile(file, "utf8");
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

function parseStdoutJson(result, label) {
  assert.notEqual(result.stdout.trim(), "", `${label} must write JSON stdout; stderr:\n${result.stderr}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    assert.fail(`${label} stdout must be JSON; stdout:\n${result.stdout}\nstderr:\n${result.stderr}\n${error}`);
  }
}

function assertWorkspaceSucceeded(result, label = "discover-workspace") {
  const json = parseStdoutJson(result, label);
  assert.equal(result.code, 0, `${label} should exit 0; stderr:\n${result.stderr}\nstdout:\n${result.stdout}`);
  assert.equal(json.schemaVersion, WORKSPACE_SCHEMA_VERSION);
  assert.equal(json.ok, true);
  return json;
}

function assertWorkspaceFailed(result, label = "discover-workspace") {
  const json = parseStdoutJson(result, label);
  assert.equal(json.schemaVersion, WORKSPACE_SCHEMA_VERSION);
  assert.equal(json.ok, false);
  return json;
}

function assertAdmissionRejectedUnsafe(result, label) {
  const json = parseStdoutJson(result, label);
  assert.equal(result.code, 1, `${label} must fail closed`);
  assert.equal(result.stderr, "");
  assert.equal(json.schemaVersion, "agentmo.cli-error.v1");
  assert.equal(json.ok, false);
  assert.equal(json.code, "AGENTMO_ARTIFACT_UNSAFE_CONTENT");
  return json;
}

async function listRelativeFiles(root, current = root) {
  if (!existsSync(root)) return [];
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listRelativeFiles(root, absolute));
    } else if (entry.isFile()) {
      files.push(path.relative(root, absolute).split(path.sep).join("/"));
    }
  }
  return files.sort();
}

async function readOutputText(outDir) {
  const files = await listRelativeFiles(outDir);
  const chunks = [];
  for (const file of files) {
    chunks.push(await readFile(path.join(outDir, file), "utf8"));
  }
  return chunks.join("\n");
}

async function collectDiagnostics(result, outDir) {
  const pieces = [result.stdout, result.stderr];
  if (outDir && existsSync(outDir)) pieces.push(await readOutputText(outDir));
  return pieces.join("\n");
}

async function readSourceCards(outDir) {
  const cardsFile = path.join(outDir, SOURCE_CARDS_FILENAME);
  const sourceCards = await readJson(cardsFile);
  assert.equal(sourceCards.schemaVersion, "agentmo.source-cards.v1");
  assert.equal(Array.isArray(sourceCards.cards), true, "source-cards.json must expose a cards array");
  return sourceCards.cards;
}

function sourceInventoryEntry(id, location, overrides = {}) {
  return {
    id,
    type: overrides.type ?? "document",
    trust_level: overrides.trustLevel ?? "verified",
    description: overrides.description ?? `Test source ${id}`,
    location,
    extraction_fields: overrides.extractionFields ?? ["bounded evidence"],
  };
}

function discoveryManifest(sources, overrides = {}) {
  return {
    schemaVersion: "agentmo.discovery.v1",
    agent_id: overrides.agentId ?? "support-triage",
    source_inventory: sources,
    database_outputs: ["workspace source inventory"],
    retrieval_outputs: ["bounded evidence chunks"],
    user_need_inputs: ["triage incoming support tickets by category and priority"],
    refresh_policy: {
      cadence: "before every fixture update",
      owner: "test engineer",
      stale_after: "30 days",
    },
    forbidden_data_handling: ["Do not store credentials, raw transcripts, or raw tool bodies in managed evidence."],
  };
}

async function writeManifest(file, sources, overrides = {}) {
  await writeJson(file, discoveryManifest(sources, overrides));
}

async function runWorkspaceWithRepoSource({ files = {}, sources, sourceRoot = null }) {
  const root = sourceRoot ?? await makeRepoTempDir();
  for (const [relativePath, content] of Object.entries(files)) {
    await writeText(path.join(root, relativePath), content);
  }
  const manifestPath = path.join(root, "manifest.discovery.json");
  await writeManifest(manifestPath, sources);
  const out = await makeTempDir("agentmo-discovery-workspace-out-");
  const result = await runCli(["discover-workspace", manifestPath, "--source-root", root, "--out", out, "--json"]);
  return { result, out, sourceRoot: root, manifestPath };
}

function assertNoRawSecret(output, rawSecret) {
  assert.equal(output.includes(rawSecret), false, `raw secret/sentinel leaked into output: ${rawSecret}`);
}

function assertSafeRelativeLocation(location, label) {
  assert.equal(typeof location, "string", `${label} must be a string`);
  assert.notEqual(location, "", `${label} must not be empty`);
  assert.equal(path.isAbsolute(location), false, `${label} must be relative: ${location}`);
  assert.equal(location.includes(REPO_ROOT), false, `${label} must not include repo root: ${location}`);
}

function assertNoHostAbsolutePaths(text, label) {
  assert.equal(text.includes(REPO_ROOT), false, `${label} must not contain repo root ${REPO_ROOT}`);
  assert.equal(text.includes("/home/alex"), false, `${label} must not contain host-specific /home/alex paths`);
}

function assertNoSpecificPath(text, absolutePath, label) {
  for (const variant of new Set([absolutePath, absolutePath.split(path.sep).join("/")])) {
    assert.equal(text.includes(variant), false, `${label} must not contain absolute path ${variant}`);
  }
}

function assertNoRawPathOrName(text, value, label) {
  assert.equal(text.includes(value), false, `${label} must not contain ${value}`);
}

function assertNoDownstreamArtifacts(files) {
  const forbiddenPatterns = [
    /(^|\/)agentmo-handoff\.json$/u,
    /(^|\/)agentmo-build-state\.json$/u,
    /(^|\/)agentmo-run-state\.json$/u,
    /(^|\/)agentmo-run-index\.json$/u,
    /(^|\/)agentmo-run-eval\.json$/u,
    /(^|\/)agentmo-birth-report\.json$/u,
    /(^|\/)birth-report\.json$/u,
    /(^|\/)delivery-report\.json$/u,
    /(^|\/)domain-eval\.json$/u,
    /\.agentmo\.json$/u,
  ];
  const downstream = files.filter((file) => forbiddenPatterns.some((pattern) => pattern.test(file)));
  assert.deepEqual(downstream, [], `discover-workspace must stay Stage 1 only; found ${downstream.join(", ")}`);
}

describe("discover-workspace support-triage happy path", () => {
  let out;
  let result;

  before(async () => {
    out = await makeTempDir("agentmo-discovery-workspace-happy-");
    result = await runCli(["discover-workspace", SUPPORT_DISCOVERY, "--source-root", ".", "--out", out, "--json"]);
  });

  it("prints an ok discovery-workspace summary for sanitized support-triage fixtures", async () => {
    const json = assertWorkspaceSucceeded(result);
    assert.equal(json.discoveryDb?.agentId ?? json.agentId, "support-triage");
  });

  it("requires a subject-bound manifest digest in a fresh CLI process", async () => {
    const out = await makeTempDir("agentmo-discovery-workspace-no-digest-");
    const withoutDigest = await runCliRaw([
      "discover-workspace",
      SUPPORT_DISCOVERY,
      "--source-root",
      ".",
      "--out",
      out,
      "--json",
    ]);
    assert.equal(withoutDigest.code, 1);
    assert.equal(JSON.parse(withoutDigest.stdout).code, "AGENTMO_ARTIFACT_DIGEST_REQUIRED");
  });

  it("writes the required Stage 1 workspace artifact set", async () => {
    assertWorkspaceSucceeded(result);
    const files = await listRelativeFiles(out);
    assert.deepEqual(
      files.filter((file) =>
        [DISCOVERY_DB_FILENAME, FACTS_FILENAME, COVERAGE_FILENAME, SOURCE_CARDS_FILENAME, SOURCE_CHUNKS_FILENAME].includes(file),
      ),
      [DISCOVERY_DB_FILENAME, FACTS_FILENAME, COVERAGE_FILENAME, SOURCE_CARDS_FILENAME, SOURCE_CHUNKS_FILENAME].sort(),
    );
  });

  it("records source cards for the three support-triage fixture sources", async () => {
    assertWorkspaceSucceeded(result);
    const cards = await readSourceCards(out);
    assert.deepEqual(
      cards.map((card) => card.sourceId).sort(),
      ["quality-rubric", "support-policy-handbook", "ticket-taxonomy"],
    );
    assert.deepEqual(new Set(cards.map((card) => card.status)), new Set(["ingested"]));
    assert.equal(cards.every((card) => typeof card.preview === "string" && card.preview.length > 0), true);
  });

  it("emits bounded source chunks for Markdown and JSON fixture content", async () => {
    assertWorkspaceSucceeded(result);
    const chunks = await readJsonl(path.join(out, SOURCE_CHUNKS_FILENAME));
    assert.equal(chunks.length >= 3, true, "expected at least one chunk per support-triage source");
    const bySource = new Map(chunks.map((chunk) => [chunk.sourceId, chunk]));
    assert.match(bySource.get("support-policy-handbook")?.id ?? "", /^support-policy-handbook:chunk:01$/u);
    assert.match(bySource.get("ticket-taxonomy")?.id ?? "", /^ticket-taxonomy:chunk:01$/u);
    assert.equal(typeof bySource.get("support-policy-handbook")?.text, "string");
    assert.equal(typeof bySource.get("ticket-taxonomy")?.text, "string");
    assert.equal(chunks.every((chunk) => chunk.text.length <= 1200), true, "chunks must stay bounded");
  });

  it("adds source_chunk facts to the discovery DB and facts JSONL", async () => {
    assertWorkspaceSucceeded(result);
    const discoveryDb = await readJson(path.join(out, DISCOVERY_DB_FILENAME));
    const factsJsonl = await readJsonl(path.join(out, FACTS_FILENAME));
    const dbSourceFacts = discoveryDb.facts.filter((fact) => fact.kind === "source_chunk");
    const jsonlSourceFacts = factsJsonl.filter((fact) => fact.kind === "source_chunk");
    assert.equal(dbSourceFacts.length >= 3, true, "discovery DB must contain source_chunk facts");
    assert.deepEqual(jsonlSourceFacts, dbSourceFacts);
    assert.equal(dbSourceFacts.every((fact) => typeof fact.text === "string" && fact.text.length > 0), true);
  });

  it("records repo-relative manifest provenance without host absolute paths in the discovery DB", async () => {
    assertWorkspaceSucceeded(result);
    const discoveryDbText = await readFile(path.join(out, DISCOVERY_DB_FILENAME), "utf8");
    assertNoHostAbsolutePaths(discoveryDbText, "workspace discovery DB");
    const discoveryDb = JSON.parse(discoveryDbText);
    assert.equal(discoveryDb.sourceManifest.path, "examples/support-triage.discovery.json");
    assertSafeRelativeLocation(discoveryDb.sourceManifest.path, "sourceManifest.path");
  });

  it("does not write blueprint, handoff, build, run, birth, domain, or delivery artifacts", async () => {
    assertWorkspaceSucceeded(result);
    const files = await listRelativeFiles(out);
    assertNoDownstreamArtifacts(files);
  });

  it("lets blueprint-draft consume the clean discovery DB without workspace sidecars", async () => {
    assertWorkspaceSucceeded(result);
    const dbOnlyDir = await makeTempDir("agentmo-discovery-workspace-db-only-");
    const dbOnlyPath = path.join(dbOnlyDir, DISCOVERY_DB_FILENAME);
    await copyFile(path.join(out, DISCOVERY_DB_FILENAME), dbOnlyPath);
    const blueprintPath = path.join(dbOnlyDir, "support-triage.agentmo.json");

    const draft = await runCli([
      "blueprint-draft",
      dbOnlyPath,
      "--need",
      SUPPORT_NEED,
      "--digest",
      `discovery-db=sha256:${createHash("sha256").update(await readFile(dbOnlyPath)).digest("hex")}`,
      "--digest",
      `user-need=sha256:${createHash("sha256").update(await readFile(SUPPORT_NEED)).digest("hex")}`,
      "--out",
      blueprintPath,
      "--target",
      "openclaw",
      "--json",
    ]);

    assert.equal(draft.code, 0, draft.stderr);
    const draftJson = parseStdoutJson(draft, "blueprint-draft");
    assert.equal(draftJson.report.ok, true);
    assert.deepEqual(
      draftJson.blueprint.design_contract.provenance.admitted_artifacts.map((item) => item.subject),
      ["discovery-db", "user-need"],
    );
  });
});

describe("discover-workspace source-root and source-location safety", () => {
  it("rejects a parent source-root before source reads", async () => {
    const out = await makeTempDir("agentmo-discovery-workspace-parent-root-");
    const result = await runCli(["discover-workspace", SUPPORT_DISCOVERY, "--source-root", "..", "--out", out, "--json"]);

    const json = assertWorkspaceFailed(result, "discover-workspace parent source-root");
    const diagnostics = await collectDiagnostics(result, out);
    assert.match(JSON.stringify(json) + diagnostics, /source[-_ ]root|repository root|outside repo/u);
  });

  it("rejects traversal source locations outside source-root without leaking outside content", async () => {
    const sourceRoot = await makeRepoTempDir();
    const outsideSentinel = "TRAVERSAL_OUTSIDE_ROOT_SENTINEL_NEVER_LEAKS";
    const outsideName = `.agentmo-outside-${Date.now()}.md`;
    const outsidePath = path.join(sourceRoot, "..", outsideName);
    await writeText(outsidePath, outsideSentinel);
    tempPaths.push(outsidePath);

    const { result, out } = await runWorkspaceWithRepoSource({
      sourceRoot,
      sources: [sourceInventoryEntry("traversal-source", `../${outsideName}`)],
    });

    assertWorkspaceFailed(result, "discover-workspace traversal source");
    const diagnostics = await collectDiagnostics(result, out);
    assert.match(diagnostics, /traversal|outside[-_ ]root|outside source[-_ ]root/u);
    assertNoRawSecret(diagnostics, outsideSentinel);
  });

  it("rejects absolute source locations outside source-root", async () => {
    const sourceRoot = await makeRepoTempDir();
    const outsideSentinel = "ABSOLUTE_OUTSIDE_SOURCE_SENTINEL_NEVER_LEAKS";
    const outsideName = `.agentmo-absolute-outside-${Date.now()}.md`;
    const absoluteOutsideRoot = path.join(REPO_ROOT, outsideName);
    await writeText(absoluteOutsideRoot, `${outsideSentinel}\n`);
    tempPaths.push(absoluteOutsideRoot);

    const { result, out, manifestPath } = await runWorkspaceWithRepoSource({
      sourceRoot,
      sources: [sourceInventoryEntry("absolute-outside-source", absoluteOutsideRoot)],
    });

    const json = assertAdmissionRejectedUnsafe(result, "discover-workspace absolute outside source");
    const diagnostics = await collectDiagnostics(result, out);
    assertNoRawSecret(diagnostics, outsideSentinel);
    assertNoHostAbsolutePaths(diagnostics, "absolute outside source diagnostics");
    for (const forbiddenPath of [absoluteOutsideRoot, sourceRoot, manifestPath, out]) {
      assertNoSpecificPath(diagnostics, forbiddenPath, "absolute outside source diagnostics");
    }
    assertNoHostAbsolutePaths(JSON.stringify(json), "absolute outside source stdout JSON");
    assert.deepEqual(await listRelativeFiles(out), []);
  });

  it("rejects absolute in-root source locations at durable admission", async () => {
    const sourceRoot = await makeRepoTempDir();
    const sourceFile = path.join(sourceRoot, "absolute-in-root.md");
    await writeText(sourceFile, "Absolute in-root source fixture with bounded evidence.\n");

    const { result, out } = await runWorkspaceWithRepoSource({
      sourceRoot,
      sources: [sourceInventoryEntry("absolute-in-root-source", sourceFile)],
    });

    const json = assertAdmissionRejectedUnsafe(result, "discover-workspace absolute in-root source");
    assertNoSpecificPath(JSON.stringify(json), sourceFile, "absolute in-root admission error");
    assert.deepEqual(await listRelativeFiles(out), []);
  });

  it("uses null manifest path provenance for manifests outside the repo instead of leaking absolute paths", async () => {
    const externalManifestRoot = await makeTempDir("agentmo-discovery-workspace-external-manifest-");
    const manifestPath = path.join(externalManifestRoot, "external.discovery.json");
    await writeManifest(manifestPath, [sourceInventoryEntry("support-policy-handbook", "examples/fixtures/support-triage/policy-handbook.md")]);
    const out = await makeTempDir("agentmo-discovery-workspace-external-manifest-out-");

    const result = await runCli(["discover-workspace", manifestPath, "--source-root", REPO_ROOT, "--out", out, "--json"]);

    assertWorkspaceSucceeded(result, "discover-workspace external manifest");
    const discoveryDbText = await readFile(path.join(out, DISCOVERY_DB_FILENAME), "utf8");
    assertNoHostAbsolutePaths(discoveryDbText, "workspace discovery DB");
    assert.equal(discoveryDbText.includes(externalManifestRoot), false, "workspace discovery DB must not contain external manifest root");
    const discoveryDb = JSON.parse(discoveryDbText);
    assert.equal(discoveryDb.sourceManifest.path, null);
  });

  it("rejects symlink escapes without leaking target content", async () => {
    const sourceRoot = await makeRepoTempDir();
    const externalRoot = await makeTempDir("agentmo-discovery-workspace-symlink-target-");
    const sentinel = "SYMLINK_ESCAPE_SENTINEL_CONTENT_MUST_NOT_LEAK";
    const externalFile = path.join(externalRoot, "external.md");
    await writeText(externalFile, sentinel);
    await symlink(externalFile, path.join(sourceRoot, "escape.md"));

    const manifestPath = path.join(sourceRoot, "manifest.discovery.json");
    await writeManifest(manifestPath, [sourceInventoryEntry("symlink-escape", "escape.md")]);
    const out = await makeTempDir("agentmo-discovery-workspace-symlink-out-");
    const result = await runCli(["discover-workspace", manifestPath, "--source-root", sourceRoot, "--out", out, "--json"]);

    assertWorkspaceFailed(result, "discover-workspace symlink escape");
    const diagnostics = await collectDiagnostics(result, out);
    assert.match(diagnostics, /symlink|outside[-_ ]root|realpath/u);
    assertNoRawSecret(diagnostics, sentinel);
  });

  it("rejects repo-local symlinks whose real target is a denied secret filename without reading it", async () => {
    const sourceRoot = await makeRepoTempDir();
    const sentinel = "SYMLINK_TO_ENV_SENTINEL_CONTENT_MUST_NOT_LEAK";
    const secretFile = path.join(sourceRoot, ".env");
    await writeText(secretFile, sentinel);
    await symlink(secretFile, path.join(sourceRoot, "allowed.md"));

    const manifestPath = path.join(sourceRoot, "manifest.discovery.json");
    await writeManifest(manifestPath, [sourceInventoryEntry("symlink-denied-target", "allowed.md")]);
    const out = await makeTempDir("agentmo-discovery-workspace-symlink-denied-out-");
    const result = await runCli(["discover-workspace", manifestPath, "--source-root", sourceRoot, "--out", out, "--json"]);

    assertWorkspaceFailed(result, "discover-workspace symlink denied target");
    const diagnostics = await collectDiagnostics(result, out);
    assert.match(diagnostics, /denied|credential|rejected/u);
    assertNoRawPathOrName(diagnostics, ".env", "symlink denied target diagnostics");
    assertNoRawSecret(diagnostics, sentinel);
    const cards = await readSourceCards(out);
    assert.equal(cards[0].sourceId, "symlink-denied-target");
    assert.equal(cards[0].status, "rejected");
    assert.equal(cards[0].location, null);
  });

  it("rejects repo-local symlinks whose real target has a secret-like durable basename without leaking it", async () => {
    const sourceRoot = await makeRepoTempDir();
    const fakeToken = "sk-agentmoworkspaceleak123456";
    const secretLikeBasename = `${fakeToken}.md`;
    const sentinel = "SYMLINK_SECRET_LIKE_REALPATH_CONTENT_MUST_NOT_LEAK";
    const secretLikeFile = path.join(sourceRoot, secretLikeBasename);
    await writeText(secretLikeFile, `${sentinel}\n`);
    await symlink(secretLikeFile, path.join(sourceRoot, "allowed.md"));

    const manifestPath = path.join(sourceRoot, "manifest.discovery.json");
    await writeManifest(manifestPath, [sourceInventoryEntry("symlink-secret-like-realpath", "allowed.md")]);
    const out = await makeTempDir("agentmo-discovery-workspace-symlink-secret-like-out-");
    const result = await runCli(["discover-workspace", manifestPath, "--source-root", sourceRoot, "--out", out, "--json"]);

    const json = assertWorkspaceFailed(result, "discover-workspace symlink secret-like realpath");
    const diagnostics = await collectDiagnostics(result, out);
    assert.match(diagnostics, /not safe to persist|unsafe_realpath_location|rejected/u);
    for (const [label, text] of [
      ["stdout JSON", JSON.stringify(json)],
      ["diagnostics", diagnostics],
    ]) {
      assertNoRawSecret(text, sentinel);
      assertNoRawPathOrName(text, fakeToken, label);
      assertNoRawPathOrName(text, secretLikeBasename, label);
      assertNoSpecificPath(text, secretLikeFile, label);
    }

    const cards = await readSourceCards(out);
    assert.equal(cards[0].sourceId, "symlink-secret-like-realpath");
    assert.equal(cards[0].status, "rejected");
    assert.equal(cards[0].location, null);

    const discoveryDb = await readJson(path.join(out, DISCOVERY_DB_FILENAME));
    const sourceRecord = discoveryDb.sources.find((source) => source.id === "symlink-secret-like-realpath");
    assert.equal(sourceRecord.location, null);
    const sourceFacts = discoveryDb.facts.filter((fact) => fact.sourceId === "symlink-secret-like-realpath");
    assert.equal(sourceFacts.length > 0, true, "expected manifest extraction facts to remain");
    for (const fact of sourceFacts) assert.deepEqual(fact.refs, []);
  });
});

describe("discover-workspace fail-closed source intake", () => {
  it("declares bounded non-artifact intake and rejects AgentMo durable JSON identities", async () => {
    assert.equal(DISCOVERY_SOURCE_INTAKE_POLICY.status, "non-artifact-intake");
    assert.equal(DISCOVERY_SOURCE_INTAKE_POLICY.durableArtifactIdentityAllowed, false);
    assert.equal(Number.isInteger(DISCOVERY_SOURCE_INTAKE_POLICY.maxSourceBytes), true);

    const sourceRoot = await makeRepoTempDir();
    const durableSource = path.join(sourceRoot, "must-not-ingest.json");
    await copyFile(PREBUILT_DISCOVERY_DB, durableSource);
    const { result, out } = await runWorkspaceWithRepoSource({
      sourceRoot,
      sources: [sourceInventoryEntry("durable-artifact-canary", "must-not-ingest.json")],
    });
    assertWorkspaceFailed(result, "discover-workspace durable source identity");
    const cards = await readSourceCards(out);
    assert.equal(cards[0].rejectionCode, "durable_artifact_identity");
    const chunks = await readJsonl(path.join(out, SOURCE_CHUNKS_FILENAME));
    assert.deepEqual(chunks, []);
  });

  it("rejects oversized source documents before reading or chunking them", async () => {
    const sourceRoot = await makeRepoTempDir();
    const oversizedPath = path.join(sourceRoot, "oversized.md");
    await writeText(oversizedPath, "x".repeat(DISCOVERY_SOURCE_INTAKE_POLICY.maxSourceBytes + 1));
    const { result, out } = await runWorkspaceWithRepoSource({
      sourceRoot,
      sources: [sourceInventoryEntry("oversized-source", "oversized.md")],
    });
    assertWorkspaceFailed(result, "discover-workspace oversized source");
    const cards = await readSourceCards(out);
    assert.equal(cards[0].rejectionCode, "source_too_large");
    assert.equal(cards[0].preview ?? null, null);
  });

  it("rejects a pathname swap after the single no-follow source open", async () => {
    const sourceRoot = await makeRepoTempDir();
    const sourcePath = path.join(sourceRoot, "swap.md");
    const retainedPath = path.join(sourceRoot, "retained.md");
    const replacementSentinel = "SOURCE_SWAP_REPLACEMENT_MUST_NOT_PERSIST";
    await writeText(sourcePath, "Original bounded discovery source.\n");
    let fileOpens = 0;
    let swapped = false;
    const sourceIntakeIo = {
      lstat,
      realpath,
      async open(filePath, flags) {
        fileOpens += 1;
        assert.equal((flags & FS_CONSTANTS.O_NOFOLLOW) === FS_CONSTANTS.O_NOFOLLOW, true);
        const handle = await open(filePath, flags);
        return {
          close: (...args) => handle.close(...args),
          stat: (...args) => handle.stat(...args),
          async read(...args) {
            const result = await handle.read(...args);
            if (!swapped && result.bytesRead > 0) {
              await rename(sourcePath, retainedPath);
              await writeText(sourcePath, `${replacementSentinel}\n`);
              swapped = true;
            }
            return result;
          },
        };
      },
    };

    const workspace = await buildDiscoveryWorkspace(
      discoveryManifest([sourceInventoryEntry("swapped-source", "swap.md")]),
      { repoRoot: REPO_ROOT, sourceRoot, sourceIntakeIo },
    );

    assert.equal(swapped, true);
    assert.equal(fileOpens, 1);
    assert.equal(workspace.ok, false);
    assert.equal(workspace.sourceCards.cards[0].rejectionCode, "read_failed");
    assert.deepEqual(workspace.sourceChunks, []);
    assert.equal(JSON.stringify(workspace).includes(replacementSentinel), false);
  });

  it("rejects source growth through the retained handle without an unbounded read", async () => {
    const sourceRoot = await makeRepoTempDir();
    const sourcePath = path.join(sourceRoot, "growth.md");
    await writeText(sourcePath, "Bounded source.\n");
    const maxSourceBytes = 64;
    let fileOpens = 0;
    let grown = false;
    const sourceIntakeIo = {
      lstat,
      realpath,
      async open(filePath, flags) {
        fileOpens += 1;
        const handle = await open(filePath, flags);
        return {
          close: (...args) => handle.close(...args),
          stat: (...args) => handle.stat(...args),
          async read(...args) {
            if (!grown) {
              await appendFile(sourcePath, "G".repeat(maxSourceBytes + 1), "utf8");
              grown = true;
            }
            return handle.read(...args);
          },
        };
      },
    };

    const workspace = await buildDiscoveryWorkspace(
      discoveryManifest([sourceInventoryEntry("grown-source", "growth.md")]),
      { repoRoot: REPO_ROOT, sourceRoot, maxSourceBytes, sourceIntakeIo },
    );

    assert.equal(grown, true);
    assert.equal(fileOpens, 1);
    assert.equal(workspace.ok, false);
    assert.equal(workspace.sourceCards.cards[0].rejectionCode, "source_too_large");
    assert.deepEqual(workspace.sourceChunks, []);
  });

  it("preflights every workspace artifact before creating the output root", async () => {
    const manifest = JSON.parse(await readFile(SUPPORT_DISCOVERY, "utf8"));
    const workspace = await buildDiscoveryWorkspace(manifest, {
      manifestPath: SUPPORT_DISCOVERY,
      sourceRoot: ".",
      repoRoot: REPO_ROOT,
    });
    workspace.sourceCards.cards[0].rawTranscript = "synthetic raw transcript";
    const parent = await makeTempDir("agentmo-workspace-preflight-");
    const out = path.join(parent, "must-not-exist");
    await assert.rejects(
      () => writeDiscoveryWorkspace(out, workspace),
      (error) => typeof error.code === "string" && error.code.startsWith("AGENTMO_PERSISTABILITY_"),
    );
    await assert.rejects(() => access(out));
  });

  it("rejects denied secret filenames before read and never emits their sentinel content", async () => {
    const sentinel = "DENIED_FILENAME_SENTINEL_CONTENT_NEVER_LEAKS";
    const deniedFilenames = [".env", ".env.local", "private.key", "token.pem"];
    const files = Object.fromEntries(deniedFilenames.map((name) => [name, `${sentinel}:${name}\n`]));
    const sources = deniedFilenames.map((name) =>
      sourceInventoryEntry(`denied-${name.replace(/[^a-z0-9]+/giu, "-").replace(/^-|-$/gu, "")}`, name),
    );

    const { result, out } = await runWorkspaceWithRepoSource({ files, sources });

    assertWorkspaceFailed(result, "discover-workspace denied filenames");
    const diagnostics = await collectDiagnostics(result, out);
    assert.match(diagnostics, /denied|credential|rejected/u);
    for (const deniedFilename of deniedFilenames) assertNoRawPathOrName(diagnostics, deniedFilename, "denied filename diagnostics");
    assertNoRawSecret(diagnostics, sentinel);
    const cards = await readSourceCards(out);
    assert.deepEqual(cards.map((card) => card.status), ["rejected", "rejected", "rejected", "rejected"]);
    assert.equal(cards.every((card) => card.location === null), true);
    assert.equal(cards.every((card) => /denied|credential/u.test(String(card.reason))), true);
    assert.equal(cards.some((card) => deniedFilenames.some((name) => String(card.reason).includes(name))), false);
  });

  it("rejects denied absolute in-root source paths before read without leaking paths or content", async () => {
    const sourceRoot = await makeRepoTempDir();
    const sentinel = "DENIED_ABSOLUTE_IN_ROOT_SENTINEL_NEVER_LEAKS";
    const secretFile = path.join(sourceRoot, "private.key");
    await writeText(secretFile, `${sentinel}\n`);

    const { result, out, manifestPath } = await runWorkspaceWithRepoSource({
      sourceRoot,
      sources: [sourceInventoryEntry("denied-absolute-private-key", secretFile)],
    });

    const json = assertAdmissionRejectedUnsafe(result, "discover-workspace denied absolute source");
    const diagnostics = await collectDiagnostics(result, out);
    assertNoRawPathOrName(diagnostics, "private.key", "denied absolute source diagnostics");
    assertNoRawSecret(diagnostics, sentinel);
    assertNoHostAbsolutePaths(diagnostics, "denied absolute source diagnostics");
    for (const forbiddenPath of [secretFile, sourceRoot, manifestPath, out]) {
      assertNoSpecificPath(diagnostics, forbiddenPath, "denied absolute source diagnostics");
    }
    assertNoHostAbsolutePaths(JSON.stringify(json), "denied absolute source stdout JSON");
    assert.deepEqual(await listRelativeFiles(out), []);
  });

  it("scrubs host absolute paths from approved source previews, chunks, and facts", async () => {
    const sourceRoot = await makeRepoTempDir();
    const repoAbsolutePath = path.join(REPO_ROOT, "private", "support-log.txt");
    const tempAbsolutePath = path.join(tmpdir(), "agentmo-path-scrub", "runtime-trace.log");
    const { result, out } = await runWorkspaceWithRepoSource({
      sourceRoot,
      files: {
        "path-content.md": [
          "Approved source may mention local operator paths.",
          `Repo path: ${repoAbsolutePath}`,
          `Temp path: ${tempAbsolutePath}`,
        ].join("\n"),
      },
      sources: [sourceInventoryEntry("approved-path-content", "path-content.md")],
    });

    assertWorkspaceSucceeded(result, "discover-workspace approved source path scrub");
    const diagnostics = await collectDiagnostics(result, out);
    assertNoSpecificPath(diagnostics, repoAbsolutePath, "approved source path diagnostics");
    assertNoSpecificPath(diagnostics, tempAbsolutePath, "approved source path diagnostics");
    assertNoHostAbsolutePaths(diagnostics, "approved source path diagnostics");
    assert.match(diagnostics, /\[REDACTED_PATH\]/u);

    const cards = await readSourceCards(out);
    assert.equal(cards[0].status, "ingested");
    assert.match(cards[0].preview, /\[REDACTED_PATH\]/u);
    assert.equal(cards[0].preview.includes(repoAbsolutePath), false);
    assert.equal(cards[0].preview.includes(tempAbsolutePath), false);

    const chunks = await readJsonl(path.join(out, SOURCE_CHUNKS_FILENAME));
    assert.equal(chunks.length > 0, true, "expected at least one source chunk");
    assert.equal(chunks.some((chunk) => chunk.text.includes("[REDACTED_PATH]")), true);
    assert.equal(chunks.some((chunk) => chunk.text.includes(repoAbsolutePath) || chunk.text.includes(tempAbsolutePath)), false);

    const discoveryDb = await readJson(path.join(out, DISCOVERY_DB_FILENAME));
    const sourceFacts = discoveryDb.facts.filter((fact) => fact.sourceId === "approved-path-content");
    assert.equal(sourceFacts.some((fact) => String(fact.text).includes("[REDACTED_PATH]")), true);
    assert.equal(sourceFacts.some((fact) => String(fact.text).includes(repoAbsolutePath) || String(fact.text).includes(tempAbsolutePath)), false);
  });

  it("rejects unsupported required sources with ok:false", async () => {
    const { result, out } = await runWorkspaceWithRepoSource({
      files: { "unsupported.pdf": "%PDF unsupported fixture\n" },
      sources: [sourceInventoryEntry("unsupported-required-source", "unsupported.pdf")],
    });

    const json = assertWorkspaceFailed(result, "discover-workspace unsupported source");
    const diagnostics = await collectDiagnostics(result, out);
    assert.match(JSON.stringify(json) + diagnostics, /unsupported|extension|required/u);
    const cards = await readSourceCards(out);
    assert.equal(cards[0].sourceId, "unsupported-required-source");
    assert.equal(cards[0].status, "rejected");
  });

  it("redacts secret-like source content and marks the discovery DB unsafe", async () => {
    const rawSecret = "workspace-secret-sentinel-123456789";
    const assignment = `OPENAI_API_KEY=${rawSecret}`;
    const { result, out } = await runWorkspaceWithRepoSource({
      files: { "allowed-secret.txt": `Allowed filename with unsafe content: ${assignment}\n` },
      sources: [sourceInventoryEntry("secret-like-source", "allowed-secret.txt")],
    });

    assertWorkspaceFailed(result, "discover-workspace secret-like content");
    const diagnostics = await collectDiagnostics(result, out);
    assertNoRawSecret(diagnostics, rawSecret);
    assertNoRawSecret(diagnostics, assignment);
    assert.match(diagnostics, /\[REDACTED_SECRET\]/u);

    const discoveryDb = await readJson(path.join(out, DISCOVERY_DB_FILENAME));
    assert.equal(discoveryDb.validation.ok, false);
    assert.equal(discoveryDb.safety.workspaceOk, false);
  });

  it("rejects whitespace-only supported sources as empty instead of ingesting zero chunks", async () => {
    const { result, out } = await runWorkspaceWithRepoSource({
      files: { "empty.md": " \n\t\n   \n" },
      sources: [sourceInventoryEntry("empty-supported-source", "empty.md")],
    });

    assertWorkspaceFailed(result, "discover-workspace empty source");
    const cards = await readSourceCards(out);
    assert.equal(cards[0].sourceId, "empty-supported-source");
    assert.equal(cards[0].status, "rejected");
    assert.equal(cards[0].rejectionCode, "empty_source");
    const chunksText = await readFile(path.join(out, SOURCE_CHUNKS_FILENAME), "utf8");
    assert.equal(chunksText, "");

    const discoveryDb = await readJson(path.join(out, DISCOVERY_DB_FILENAME));
    assert.equal(discoveryDb.validation.ok, false);
    assert.equal(discoveryDb.safety.workspaceOk, false);
    assert.match(JSON.stringify(discoveryDb.validation.errors), /empty_source|zero bounded chunks|source_rejected/u);
  });
});

describe("Stage 1 compatibility and Stage 2 safety gates", () => {
  it("keeps discover-pack manifest-only with no source sidecars", async () => {
    const out = await makeTempDir("agentmo-discover-pack-manifest-only-");
    const result = await runCli(["discover-pack", SUPPORT_DISCOVERY, "--out", out, "--json"]);

    assert.equal(result.code, 0, result.stderr);
    assertNoHostAbsolutePaths(result.stdout, "discover-pack JSON stdout");
    assertNoSpecificPath(result.stdout, out, "discover-pack JSON stdout");
    const json = parseStdoutJson(result, "discover-pack");
    assert.equal(json.schemaVersion, "agentmo.discovery-pack.v1");
    assert.equal(json.ok, true);
    assert.deepEqual(json.paths, {
      outDir: ".",
      discoveryDbPath: DISCOVERY_DB_FILENAME,
      factsPath: FACTS_FILENAME,
      coveragePath: COVERAGE_FILENAME,
    });
    assert.deepEqual(await listRelativeFiles(out), [DISCOVERY_DB_FILENAME, COVERAGE_FILENAME, FACTS_FILENAME].sort());

    const discoveryDbText = await readFile(path.join(out, DISCOVERY_DB_FILENAME), "utf8");
    const factsText = await readFile(path.join(out, FACTS_FILENAME), "utf8");
    const coverageText = await readFile(path.join(out, COVERAGE_FILENAME), "utf8");
    for (const [label, text] of [
      ["discover-pack discovery DB", discoveryDbText],
      ["discover-pack facts JSONL", factsText],
      ["discover-pack coverage JSON", coverageText],
    ]) {
      assertNoHostAbsolutePaths(text, label);
      assertNoSpecificPath(text, out, label);
    }
    const discoveryDb = JSON.parse(discoveryDbText);
    assert.equal(discoveryDb.sourceManifest.path, "examples/support-triage.discovery.json");
    assertSafeRelativeLocation(discoveryDb.sourceManifest.path, "discover-pack sourceManifest.path");
  });

  it("uses null manifest path provenance for external discover-pack manifests", async () => {
    const externalManifestRoot = await makeTempDir("agentmo-discover-pack-external-manifest-");
    const manifestPath = path.join(externalManifestRoot, "external.discovery.json");
    await writeJson(manifestPath, await readJson(SUPPORT_DISCOVERY));
    const out = await makeTempDir("agentmo-discover-pack-external-manifest-out-");

    const result = await runCli(["discover-pack", manifestPath, "--out", out, "--json"]);

    assert.equal(result.code, 0, result.stderr);
    assertNoHostAbsolutePaths(result.stdout, "external discover-pack JSON stdout");
    assertNoSpecificPath(result.stdout, externalManifestRoot, "external discover-pack JSON stdout");
    assertNoSpecificPath(result.stdout, out, "external discover-pack JSON stdout");
    const json = parseStdoutJson(result, "external discover-pack");
    assert.equal(json.schemaVersion, "agentmo.discovery-pack.v1");
    assert.equal(json.discoveryDb.sourceManifest.path, null);
    const discoveryDbText = await readFile(path.join(out, DISCOVERY_DB_FILENAME), "utf8");
    assertNoHostAbsolutePaths(discoveryDbText, "external discover-pack discovery DB");
    assertNoSpecificPath(discoveryDbText, externalManifestRoot, "external discover-pack discovery DB");
    assertNoSpecificPath(discoveryDbText, out, "external discover-pack discovery DB");
    assert.equal(JSON.parse(discoveryDbText).sourceManifest.path, null);
  });

  it("rejects repo-external absolute discover-pack source locations at durable admission", async () => {
    const probeRoot = await makeTempDir("agentmo-discover-pack-abs-source-probe-");
    const absoluteSource = path.join(probeRoot, "source.md");
    const manifestPath = path.join(probeRoot, "absolute-source.discovery.json");
    await writeManifest(manifestPath, [sourceInventoryEntry("external-absolute-source", absoluteSource)]);
    const out = await makeTempDir("agentmo-discover-pack-abs-source-probe-out-");

    const result = await runCli(["discover-pack", manifestPath, "--out", out, "--json"]);

    const json = assertAdmissionRejectedUnsafe(result, "discover-pack external absolute source");
    for (const forbiddenPath of [absoluteSource, probeRoot, out]) {
      assertNoSpecificPath(JSON.stringify(json), forbiddenPath, "discover-pack absolute admission error");
    }
    assert.deepEqual(await listRelativeFiles(out), []);
  });

  it("rejects host paths in durable manifest text before any pack or workspace publication", async () => {
    const rawPaths = [
      "/etc/agentmo-source-id",
      "/root/agentmo-source-description",
      "/home/alex/agentmo-extraction-field",
      "/tmp/agentmo-database-output",
      "/usr/local/agentmo-retrieval-output",
      "/etc/agentmo-user-need",
      "/root/agentmo-forbidden-handling",
      "/usr/local/agentmo-refresh-cadence",
      "/home/alex/agentmo-refresh-owner",
      "/tmp/agentmo-refresh-stale",
    ];
    const manifestRoot = await makeTempDir("agentmo-managed-manifest-redaction-");
    const manifestPath = path.join(manifestRoot, "managed-redaction.discovery.json");
    await writeJson(manifestPath, {
      schemaVersion: "agentmo.discovery.v1",
      agent_id: "support-triage",
      source_inventory: [
        {
          id: rawPaths[0],
          type: "document",
          trust_level: "verified",
          description: `Manifest description references ${rawPaths[1]}`,
          location: "examples/fixtures/support-triage/policy-handbook.md",
          extraction_fields: [`Extraction field references ${rawPaths[2]}`],
        },
      ],
      database_outputs: [`Database output references ${rawPaths[3]}`],
      retrieval_outputs: [`Retrieval output references ${rawPaths[4]}`],
      user_need_inputs: [`User need references ${rawPaths[5]}`],
      forbidden_data_handling: [`Forbidden handling references ${rawPaths[6]}`],
      refresh_policy: {
        cadence: `before reading ${rawPaths[7]}`,
        owner: `owner path ${rawPaths[8]}`,
        stale_after: `stale marker ${rawPaths[9]}`,
      },
    });

    const packOut = await makeTempDir("agentmo-managed-manifest-pack-out-");
    const packResult = await runCli(["discover-pack", manifestPath, "--out", packOut, "--json"]);
    const packJson = assertAdmissionRejectedUnsafe(packResult, "discover-pack host-path manifest");
    for (const rawPath of rawPaths) assertNoSpecificPath(JSON.stringify(packJson), rawPath, "discover-pack admission error");
    assert.deepEqual(await listRelativeFiles(packOut), []);

    const workspaceOut = await makeTempDir("agentmo-managed-manifest-workspace-out-");
    const workspaceResult = await runCli(["discover-workspace", manifestPath, "--source-root", REPO_ROOT, "--out", workspaceOut, "--json"]);
    const workspaceJson = assertAdmissionRejectedUnsafe(workspaceResult, "discover-workspace host-path manifest");
    for (const rawPath of rawPaths) assertNoSpecificPath(JSON.stringify(workspaceJson), rawPath, "discover-workspace admission error");
    assert.deepEqual(await listRelativeFiles(workspaceOut), []);
  });

  it("rejects an unsafe workspace discovery DB even when the legacy validation flag is true", async () => {
    const root = await makeTempDir("agentmo-unsafe-workspace-db-");
    const unsafeDbPath = path.join(root, DISCOVERY_DB_FILENAME);
    const blueprintPath = path.join(root, "support-triage.agentmo.json");
    const unsafeDb = await readJson(PREBUILT_DISCOVERY_DB);
    unsafeDb.validation = { ok: true, warnings: [], errors: [] };
    unsafeDb.safety = {
      ...unsafeDb.safety,
      workspaceOk: false,
      workspaceFindings: ["source_secret_detected"],
    };
    unsafeDb.workspace = { ok: false, checks: [{ id: "source_secret_detection", pass: false }] };
    await writeJson(unsafeDbPath, unsafeDb);

    const result = await runCli([
      "blueprint-draft",
      unsafeDbPath,
      "--need",
      SUPPORT_NEED,
      "--digest",
      `discovery-db=sha256:${createHash("sha256").update(await readFile(unsafeDbPath)).digest("hex")}`,
      "--digest",
      `user-need=sha256:${createHash("sha256").update(await readFile(SUPPORT_NEED)).digest("hex")}`,
      "--out",
      blueprintPath,
      "--target",
      "openclaw",
      "--json",
    ]);

    assert.notEqual(result.code, 0, "blueprint-draft must reject unsafe workspace DB safety state");
    assert.equal(existsSync(blueprintPath), false, "unsafe workspace DB must not produce a blueprint");
    assert.equal(JSON.parse(result.stdout).code, "AGENTMO_UNSUPPORTED_ARTIFACT");
  });
});
