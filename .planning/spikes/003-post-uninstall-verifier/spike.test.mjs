import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  SCENARIOS,
  appendCandidateReady,
  appendEntry,
  digest,
  loadJournal,
  publishCandidate,
} from "../002-append-only-journal-order/journal.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const template = await readFile(path.join(here, "verifier-template.mjs"));
const D = (label) => digest({ label });

async function buildRelease(root, version) {
  const packageRoot = path.join(root, `release-${version}`);
  const out = path.join(root, "tarballs");
  const home = path.join(root, "home");
  const npmCache = path.join(root, "npm-cache");
  await mkdir(path.join(packageRoot, "bin"), { recursive: true });
  await mkdir(out, { recursive: true });
  await mkdir(home, { recursive: true });
  await mkdir(npmCache, { recursive: true });
  const verifierDigest = digest(template);
  const releaseDigest = digest({ name: "agentmo-verifier-spike", version, verifierDigest });
  await writeFile(path.join(packageRoot, "bin", "verify.mjs"), template, { mode: 0o700 });
  await writeFile(path.join(packageRoot, "package.json"), `${JSON.stringify({
    name: "agentmo-verifier-spike",
    version,
    type: "module",
    bin: { "agentmo-spike-verify": "bin/verify.mjs" },
    files: ["bin/verify.mjs", "release.json"],
  }, null, 2)}\n`);
  await writeFile(path.join(packageRoot, "release.json"), `${JSON.stringify({
    name: "agentmo-verifier-spike",
    version,
    verifierDigest,
    releaseDigest,
  }, null, 2)}\n`);
  const packed = spawnSync("npm", ["pack", "--json", "--pack-destination", out], {
    cwd: packageRoot,
    encoding: "utf8",
    timeout: 30_000,
    env: {
      ...process.env,
      HOME: home,
      npm_config_cache: npmCache,
      NPM_CONFIG_CACHE: npmCache,
    },
  });
  assert.equal(packed.status, 0, packed.stderr);
  const report = JSON.parse(packed.stdout);
  const tarballPath = path.join(out, report[0].filename);
  const tarballDigest = `sha256:${createHash("sha256").update(await readFile(tarballPath)).digest("hex")}`;
  const extractRoot = path.join(root, `extract-${version}`);
  await mkdir(extractRoot);
  const extracted = spawnSync("tar", ["-xzf", tarballPath, "-C", extractRoot], { encoding: "utf8" });
  assert.equal(extracted.status, 0, extracted.stderr);
  return {
    version,
    releaseDigest,
    tarballDigest,
    tarballPath,
    verifierPath: path.join(extractRoot, "package", "bin", "verify.mjs"),
  };
}

function runVerifier(verifierPath, command, values) {
  const args = [verifierPath, command];
  for (const [key, value] of Object.entries(values)) args.push(`--${key}`, value);
  const result = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 20_000 });
  return {
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    json: result.stdout ? JSON.parse(result.stdout) : null,
    error: result.stderr ? JSON.parse(result.stderr) : null,
  };
}

async function prepareAttempt(root, successor) {
  const journalRoot = path.join(root, "attempt");
  const attemptId = "post-uninstall-attempt";
  const runtime = path.join(root, "project", "plugins", "agentmo", "runtime");
  await mkdir(runtime, { recursive: true });
  await writeFile(path.join(runtime, "launcher.mjs"), "export const installed = true;\n");
  await appendEntry(journalRoot, attemptId, "attempt-started", { evidenceDigest: D("start") });
  await appendEntry(journalRoot, attemptId, "setup-applied", { evidenceDigest: D("setup") });
  await appendEntry(journalRoot, attemptId, "activation-applied", { evidenceDigest: D("activation") });
  await appendEntry(journalRoot, attemptId, "trust-auth-observed", { evidenceDigest: D("trust-auth") });
  for (const scenario of SCENARIOS.slice(0, -1)) {
    await appendEntry(journalRoot, attemptId, "scenario-observed", { scenario, evidenceDigest: D(scenario) });
  }
  await rename(runtime, `${runtime}.removed`);
  await appendEntry(journalRoot, attemptId, "scenario-observed", {
    scenario: SCENARIOS.at(-1),
    evidenceDigest: D("uninstall-observed-after-runtime-removal"),
  });
  const candidate = await publishCandidate(journalRoot, {
    version: successor.version,
    releaseDigest: successor.releaseDigest,
    tarballDigest: successor.tarballDigest,
  });
  const ready = await appendCandidateReady(journalRoot, attemptId, candidate.candidateDigest);
  return { journalRoot, runtime, candidate, ready };
}

test("successor packed verifier previews and decides after project runtime removal", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-post-uninstall-spike-"));
  const baseline = await buildRelease(root, "1.0.0");
  const successor = await buildRelease(root, "1.1.0");
  assert.notEqual(baseline.releaseDigest, successor.releaseDigest);
  assert.notEqual(baseline.tarballDigest, successor.tarballDigest);
  const attempt = await prepareAttempt(root, successor);
  await assert.rejects(access(attempt.runtime));

  const entriesBefore = await readdir(path.join(attempt.journalRoot, "entries"));
  const common = {
    journal: attempt.journalRoot,
    tarball: successor.tarballPath,
    "expected-head": attempt.ready.entryDigest,
    "expected-candidate": attempt.candidate.candidateDigest,
  };
  const preview = runVerifier(successor.verifierPath, "preview", common);
  assert.equal(preview.exitCode, 0, preview.stderr);
  assert.equal(preview.json.status, "candidate-preview");
  assert.equal(preview.json.releaseVersion, "1.1.0");
  assert.equal(preview.stdout.includes(attempt.journalRoot), false, "bounded output must omit private paths");
  assert.deepEqual(await readdir(path.join(attempt.journalRoot, "entries")), entriesBefore, "preview must be read-only");

  const baselineRejected = runVerifier(baseline.verifierPath, "preview", {
    ...common,
    tarball: baseline.tarballPath,
  });
  assert.equal(baselineRejected.exitCode, 1);
  assert.equal(baselineRejected.error.code, "VERIFIER_RELEASE_OR_CANDIDATE_MISMATCH");

  const wrongTarball = runVerifier(successor.verifierPath, "preview", {
    ...common,
    tarball: baseline.tarballPath,
  });
  assert.equal(wrongTarball.exitCode, 1);
  assert.equal(wrongTarball.error.code, "VERIFIER_RELEASE_OR_CANDIDATE_MISMATCH");

  const approved = runVerifier(successor.verifierPath, "decide", { ...common, decision: "approve" });
  assert.equal(approved.exitCode, 0, approved.stderr);
  assert.equal(approved.json.status, "human-admission");
  assert.equal((await loadJournal(attempt.journalRoot)).state.phase, "human-admission");

  const secondDecision = runVerifier(successor.verifierPath, "decide", { ...common, decision: "reject" });
  assert.equal(secondDecision.exitCode, 1);
  assert.equal(secondDecision.error.code, "EXPECTED_HEAD_MISMATCH");
});

test("tampered verifier and stale exact values are rejected", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-post-uninstall-tamper-"));
  const successor = await buildRelease(root, "2.0.0");
  const attempt = await prepareAttempt(root, successor);
  const common = {
    journal: attempt.journalRoot,
    tarball: successor.tarballPath,
    "expected-head": attempt.ready.entryDigest,
    "expected-candidate": attempt.candidate.candidateDigest,
  };

  const staleHead = runVerifier(successor.verifierPath, "preview", { ...common, "expected-head": D("stale") });
  assert.equal(staleHead.exitCode, 1);
  assert.equal(staleHead.error.code, "EXPECTED_HEAD_MISMATCH");

  const wrongCandidate = runVerifier(successor.verifierPath, "preview", { ...common, "expected-candidate": D("wrong") });
  assert.equal(wrongCandidate.exitCode, 1);
  assert.equal(wrongCandidate.error.code, "EXPECTED_CANDIDATE_MISMATCH");

  const original = await readFile(successor.verifierPath);
  await writeFile(successor.verifierPath, Buffer.concat([original, Buffer.from("\n// tampered\n")]));
  const tampered = runVerifier(successor.verifierPath, "preview", common);
  assert.equal(tampered.exitCode, 1);
  assert.equal(tampered.error.code, "VERIFIER_SELF_IDENTITY_INVALID");
});
