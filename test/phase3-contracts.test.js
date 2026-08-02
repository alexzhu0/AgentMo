import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";

const CLI = fileURLToPath(new URL("../bin/agentmo.js", import.meta.url));
const DISCOVERY_LIVE_MODULE = new URL("../src/discovery-live.js", import.meta.url).href;
const NEED = fileURLToPath(new URL("../examples/support-triage.need.json", import.meta.url));

function runNode(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function runCli(args) {
  return runNode([CLI, ...args]);
}

async function digestFile(file) {
  return `sha256:${createHash("sha256").update(await readFile(file)).digest("hex")}`;
}

async function listRelativeFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...await listRelativeFiles(root, absolute));
    else if (entry.isFile()) files.push(path.relative(root, absolute).split(path.sep).join("/"));
  }
  return files.sort();
}

async function mutateCopy(source, destination) {
  await copyFile(source, destination);
  await writeFile(destination, Buffer.concat([await readFile(destination), Buffer.from(" ")]));
  return destination;
}

async function assertRejectedWithoutOutput(args, out) {
  const result = await runCli(args);
  assert.equal(result.code, 1, result.stderr || result.stdout);
  await assert.rejects(() => access(out));
}

it("fresh processes compose bounded Phase 3 authority and reject every stale transition without Phase 4/5 outputs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-phase3-contract-"));
  const manifest = path.join(root, "discovery.json");
  const discoveryRoot = path.join(root, "discovery");
  const db = path.join(discoveryRoot, "agentmo-discovery-db.json");
  const approval = path.join(root, "approval.json");
  const plan = path.join(root, "design-plan.json");
  const blueprint = path.join(root, "blueprint.json");
  const buildContract = path.join(root, "build-contract.json");
  const planApproval = path.join(root, "plan-approval.json");
  const ledger = path.join(root, "decision-ledger.json");
  const decisionEntry = path.join(root, "decision-entry.json");
  const targetDescriptor = path.join(root, "openclaw-target-descriptor.json");
  const fsHelperRoot = await mkdtemp(
    path.join(tmpdir(), "agentmo-phase3-fs-helper-"),
  );
  const fsHelper = path.join(fsHelperRoot, "openclaw-fs-kernel");
  const fsHelperReceipt = path.join(
    fsHelperRoot,
    "openclaw-fs-kernel.receipt.json",
  );
  await writeFile(manifest, `${JSON.stringify({
    schemaVersion: "agentmo.discovery.v1",
    agent_id: "support-triage",
    source_inventory: [
      {
        id: "support-policy-handbook",
        type: "retrieval_corpus",
        trust_level: "verified",
        description: "Approved bounded support policy reference.",
        location: "https://example.com/support-policy",
        extraction_fields: [
          "refund eligibility rules",
          "account access escalation triggers",
          "evidence requirements for customer-facing replies",
        ],
      },
      {
        id: "ticket-taxonomy",
        type: "retrieval_corpus",
        trust_level: "trusted",
        description: "Approved bounded ticket taxonomy.",
        location: "https://example.com/ticket-taxonomy",
        extraction_fields: ["priority labels", "routing category", "required next action"],
      },
      {
        id: "quality-rubric",
        type: "retrieval_corpus",
        trust_level: "derived",
        description: "Approved bounded support quality rubric.",
        location: "https://example.com/quality-rubric",
        extraction_fields: [
          "must cite policy section",
          "must disclose missing customer facts",
          "must avoid refund or legal promises without policy evidence",
        ],
      },
    ],
    database_outputs: [
      "support source inventory",
      "ticket category table",
      "priority and escalation matrix",
    ],
    retrieval_outputs: ["bounded policy evidence cards", "support answer packet template"],
    user_need_inputs: [
      "triage incoming support tickets by category and priority",
      "draft a concise customer-facing response with evidence refs",
      "escalate when policy or customer facts are missing",
    ],
    refresh_policy: {
      cadence: "before every support policy release",
      owner: "support operations lead",
      stale_after: "30 days",
    },
    forbidden_data_handling: [
      "Do not persist credentials, full response bodies, or private payloads.",
    ],
    collector: {
      schemaVersion: "agentmo.discovery-live-policy.v1",
      adapter: "web",
      allowlist: [
        "https://example.com/support-policy",
        "https://example.com/ticket-taxonomy",
        "https://example.com/quality-rubric",
      ],
      maxSources: 3,
      maxBytesPerSource: 4096,
      perSourceTimeoutMs: 1000,
      aggregateTimeoutMs: 5000,
      maxRedirects: 0,
      allowedContentTypes: ["text/plain"],
    },
  }, null, 2)}\n`);

  const collectScript = `
    import { readFile } from "node:fs/promises";
    import { buildDiscoveryLive, writeDiscoveryLive } from ${JSON.stringify(DISCOVERY_LIVE_MODULE)};
    const [manifestPath, out] = process.argv.slice(1);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const bodies = new Map([
      ["https://example.com/support-policy", "Refunds and account access require policy evidence and escalation."],
      ["https://example.com/ticket-taxonomy", "Classify ticket category, priority, routing, and required next action."],
      ["https://example.com/quality-rubric", "Cite policy, disclose missing facts, and avoid unsupported promises."],
    ]);
    const transport = {
      async request({ url }) {
        const bytes = Buffer.from(bodies.get(url));
        return {
          status: 200,
          url,
          remoteAddress: "93.184.216.34",
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "content-length": String(bytes.length),
          },
          body: (async function* () { yield bytes; })(),
        };
      },
    };
    const live = await buildDiscoveryLive(manifest, {
      manifestPath,
      transport,
      now: () => new Date("2026-07-28T01:02:03.000Z"),
    });
    await writeDiscoveryLive(out, live);
  `;
  const collect = await runNode([
    "--input-type=module",
    "--eval",
    collectScript,
    manifest,
    discoveryRoot,
  ]);
  assert.equal(collect.code, 0, collect.stderr);

  const manifestDigest = await digestFile(manifest);
  const dbDigest = await digestFile(db);
  const preview = await runCli([
    "discovery-approve", manifest,
    "--discovery-db", db,
    "--digest", `discovery-manifest=${manifestDigest}`,
    "--digest", `discovery-db=${dbDigest}`,
    "--json",
  ]);
  assert.equal(preview.code, 0, preview.stderr);

  const apply = await runCli([
    "discovery-approve", manifest,
    "--discovery-db", db,
    "--digest", `discovery-manifest=${manifestDigest}`,
    "--digest", `discovery-db=${dbDigest}`,
    "--approve",
    "--preview-digest", JSON.parse(preview.stdout).previewDigest,
    "--out", approval,
    "--json",
  ]);
  assert.equal(apply.code, 0, apply.stderr);

  const need = JSON.parse(await readFile(NEED, "utf8"));
  const requirementRefs = [
    ...need.primary_tasks.map((_, index) => `primary-task-${String(index + 1).padStart(2, "0")}`),
    ...need.success_criteria.map((_, index) => `success-criterion-${String(index + 1).padStart(2, "0")}`),
    ...need.hard_failures.map((_, index) => `hard-failure-${String(index + 1).padStart(2, "0")}`),
  ].sort();
  await writeFile(decisionEntry, `${JSON.stringify({
    schemaVersion: "agentmo.decision-entry.v1",
    entryId: "human-decision-01",
    entryKind: "human-decision",
    subject: "Bounded Stage 2 planning scope",
    reason: "Proceed with governed gaps and preserve draft status.",
    sourceRefs: [],
    decisionRefs: [],
    requirementRefs,
  }, null, 2)}\n`);
  const ledgerAppend = await runCli([
    "decision-ledger", "append",
    "--journal", ledger,
    "--entry", decisionEntry,
    "--digest", `decision-entry=${await digestFile(decisionEntry)}`,
    "--json",
  ]);
  assert.equal(ledgerAppend.code, 0, ledgerAppend.stderr);
  const ledgerDigest = JSON.parse(ledgerAppend.stdout).head.digest;

  const design = await runCli([
    "design-plan", db,
    "--manifest", manifest,
    "--discovery-approval", approval,
    "--need", NEED,
    "--decision-ledger", ledger,
    "--digest", `discovery-manifest=${manifestDigest}`,
    "--digest", `discovery-db=${dbDigest}`,
    "--digest", `discovery-approval=${await digestFile(approval)}`,
    "--digest", `user-need=${await digestFile(NEED)}`,
    "--digest", `decision-ledger=${ledgerDigest}`,
    "--out", plan,
    "--target", "openclaw",
    "--json",
  ]);
  assert.equal(design.code, 0, design.stderr);
  assert.equal(JSON.parse(design.stdout).designPlan.source.discoveryApproval.subject, "discovery-approval");
  assert.equal(JSON.parse(design.stdout).designPlan.source.decisionLedger.digest, ledgerDigest);

  const draft = await runCli([
    "blueprint-draft", db,
    "--need", NEED,
    "--design-plan", plan,
    "--digest", `discovery-db=${dbDigest}`,
    "--digest", `user-need=${await digestFile(NEED)}`,
    "--digest", `design-plan=${await digestFile(plan)}`,
    "--out", blueprint,
    "--target", "openclaw",
    "--json",
  ]);
  assert.equal(draft.code, 0, draft.stderr);
  assert.equal(JSON.parse(await readFile(blueprint, "utf8")).status, "draft");

  const targetRoot = await mkdtemp(path.join(tmpdir(), "agentmo-phase3-openclaw-target-"));
  const targetExecutable = path.join(targetRoot, "openclaw.mjs");
  const targetPackageJson = path.join(targetRoot, "package.json");
  const targetBuildInfo = path.join(targetRoot, "dist", "build-info.json");
  await mkdir(path.dirname(targetBuildInfo), { recursive: true });
  await writeFile(targetExecutable, "#!/usr/bin/env node\n", { mode: 0o755 });
  await writeFile(targetPackageJson, `${JSON.stringify({
    name: "openclaw",
    version: "2026.7.1-2",
    engines: {
      node: ">=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0",
    },
  }, null, 2)}\n`);
  await writeFile(targetBuildInfo, `${JSON.stringify({
    version: "2026.7.1-2",
    commit: "0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c",
    builtAt: "2026-07-28T00:00:00.000Z",
  }, null, 2)}\n`);
  const helperBuild = await runCli([
    "openclaw-fs-kernel-build",
    "--binary-out", fsHelper,
    "--receipt-out", fsHelperReceipt,
    "--json",
  ]);
  assert.equal(helperBuild.code, 0, helperBuild.stderr);
  const fsHelperReceiptDigest = JSON.parse(helperBuild.stdout).receiptDigest;
  const describeTarget = await runCli([
    "openclaw-target-describe",
    "--target-executable", targetExecutable,
    "--target-package-json", targetPackageJson,
    "--target-build-info", targetBuildInfo,
    "--digest", `target-executable=${await digestFile(targetExecutable)}`,
    "--digest", `target-package-json=${await digestFile(targetPackageJson)}`,
    "--digest", `target-build-info=${await digestFile(targetBuildInfo)}`,
    "--fs-helper", fsHelper,
    "--fs-helper-receipt", fsHelperReceipt,
    "--fs-helper-receipt-digest", fsHelperReceiptDigest,
    "--out", targetDescriptor,
    "--json",
  ]);
  assert.equal(describeTarget.code, 0, describeTarget.stderr);

  const contract = await runCli([
    "build-contract", blueprint,
    "--design-plan", plan,
    "--discovery-approval", approval,
    "--decision-ledger", ledger,
    "--target-descriptor", targetDescriptor,
    "--digest", `blueprint=${await digestFile(blueprint)}`,
    "--digest", `design-plan=${await digestFile(plan)}`,
    "--digest", `discovery-approval=${await digestFile(approval)}`,
    "--digest", `decision-ledger=${ledgerDigest}`,
    "--digest", `openclaw-target-descriptor=${await digestFile(targetDescriptor)}`,
    "--out", buildContract,
    "--target", "openclaw",
    "--json",
  ]);
  assert.equal(contract.code, 0, contract.stderr);
  assert.equal(JSON.parse(await readFile(buildContract, "utf8")).schemaVersion, "agentmo.build-contract.v1");

  const approvalPreview = await runCli([
    "plan-approve", blueprint,
    "--build-contract", buildContract,
    "--digest", `blueprint=${await digestFile(blueprint)}`,
    "--digest", `build-contract=${await digestFile(buildContract)}`,
    "--json",
  ]);
  assert.equal(approvalPreview.code, 0, approvalPreview.stderr);
  await assert.rejects(() => access(planApproval));

  const approvalApply = await runCli([
    "plan-approve", blueprint,
    "--build-contract", buildContract,
    "--digest", `blueprint=${await digestFile(blueprint)}`,
    "--digest", `build-contract=${await digestFile(buildContract)}`,
    "--approve",
    "--preview-digest", JSON.parse(approvalPreview.stdout).previewDigest,
    "--out", planApproval,
    "--json",
  ]);
  assert.equal(approvalApply.code, 0, approvalApply.stderr);
  const finalApproval = JSON.parse(await readFile(planApproval, "utf8"));
  assert.equal(finalApproval.decisionScope, "enter-produce");
  assert.deepEqual(finalApproval.certificationBoundary, {
    localOperatorIntentOnly: true,
    authenticatedOrganization: false,
    packageBuilt: false,
    packageInstalled: false,
    runtime: false,
    domain: false,
    production: false,
  });

  const phase3Files = await listRelativeFiles(root);
  const journalSidecars = phase3Files.filter((relative) => (
    relative.startsWith(".decision-ledger.json.agentmo-journal.")
  ));
  assert.equal(journalSidecars.length, 5);
  assert.deepEqual(
    journalSidecars.map((relative) => relative
      .replace(/[a-f0-9]{64}/gu, "<digest>")),
    [
      ".decision-ledger.json.agentmo-journal.entry-stage.<digest>.bin",
      ".decision-ledger.json.agentmo-journal.outcome-stage.<digest>-<digest>.json",
      ".decision-ledger.json.agentmo-journal.outcome.000000000000-<digest>.json",
      ".decision-ledger.json.agentmo-journal.prepared-stage.<digest>.json",
      ".decision-ledger.json.agentmo-journal.prepared.000000000000.json",
    ],
  );
  assert.deepEqual(phase3Files.filter((relative) => !journalSidecars.includes(relative)), [
    "approval.json",
    "blueprint.json",
    "build-contract.json",
    "decision-entry.json",
    "decision-ledger.json",
    "design-plan.json",
    "discovery.json",
    "discovery/agentmo-discovery-db.json",
    "discovery/coverage.json",
    "discovery/facts.jsonl",
    "discovery/retrievals.jsonl",
    "discovery/source-cards.json",
    "discovery/source-chunks.jsonl",
    "openclaw-target-descriptor.json",
    "plan-approval.json",
  ]);
  const durableText = (await Promise.all(
    phase3Files.map((relative) => readFile(path.join(root, relative), "utf8")),
  )).join("\n");
  for (const forbiddenClaim of [
    /"domain(?:Quality)?Certified"\s*:\s*true/iu,
    /"runtime(?:Ready|Certified)"\s*:\s*true/iu,
    /"production(?:Ready|Approved)"\s*:\s*true/iu,
    /"declaredReadyIsRuntimeSuccess"\s*:\s*true/iu,
    /"liveSuccessIsDomainQuality"\s*:\s*true/iu,
  ]) {
    assert.doesNotMatch(durableText, forbiddenClaim);
  }

  const staleRoot = await mkdtemp(path.join(tmpdir(), "agentmo-phase3-stale-"));
  const staleManifest = await mutateCopy(manifest, path.join(staleRoot, "manifest.json"));
  const staleDb = await mutateCopy(db, path.join(staleRoot, "db.json"));
  const staleApproval = await mutateCopy(approval, path.join(staleRoot, "approval.json"));
  const staleNeed = await mutateCopy(NEED, path.join(staleRoot, "need.json"));
  const staleLedger = await mutateCopy(ledger, path.join(staleRoot, "ledger.json"));
  const designCases = [
    ["manifest", staleManifest, db, approval, NEED, ledger],
    ["db", manifest, staleDb, approval, NEED, ledger],
    ["approval", manifest, db, staleApproval, NEED, ledger],
    ["need", manifest, db, approval, staleNeed, ledger],
    ["ledger", manifest, db, approval, NEED, staleLedger],
  ];
  for (const [label, candidateManifest, candidateDb, candidateApproval, candidateNeed, candidateLedger] of designCases) {
    const out = path.join(staleRoot, `${label}-plan.json`);
    await assertRejectedWithoutOutput([
      "design-plan", candidateDb,
      "--manifest", candidateManifest,
      "--discovery-approval", candidateApproval,
      "--need", candidateNeed,
      "--decision-ledger", candidateLedger,
      "--digest", `discovery-manifest=${manifestDigest}`,
      "--digest", `discovery-db=${dbDigest}`,
      "--digest", `discovery-approval=${await digestFile(approval)}`,
      "--digest", `user-need=${await digestFile(NEED)}`,
      "--digest", `decision-ledger=${ledgerDigest}`,
      "--out", out,
      "--target", "openclaw",
      "--json",
    ], out);
  }

  const stalePlan = await mutateCopy(plan, path.join(staleRoot, "design-plan.json"));
  const staleBlueprintOut = path.join(staleRoot, "blueprint.json");
  await assertRejectedWithoutOutput([
    "blueprint-draft", db,
    "--need", NEED,
    "--design-plan", stalePlan,
    "--digest", `discovery-db=${dbDigest}`,
    "--digest", `user-need=${await digestFile(NEED)}`,
    "--digest", `design-plan=${await digestFile(plan)}`,
    "--out", staleBlueprintOut,
    "--target", "openclaw",
    "--json",
  ], staleBlueprintOut);

  const staleBlueprint = await mutateCopy(blueprint, path.join(staleRoot, "approved-blueprint.json"));
  const staleBuildContract = await mutateCopy(buildContract, path.join(staleRoot, "build-contract.json"));
  for (const [label, candidateBlueprint, candidateContract] of [
    ["blueprint", staleBlueprint, buildContract],
    ["build-contract", blueprint, staleBuildContract],
  ]) {
    const out = path.join(staleRoot, `${label}-approval.json`);
    await assertRejectedWithoutOutput([
      "plan-approve", candidateBlueprint,
      "--build-contract", candidateContract,
      "--digest", `blueprint=${await digestFile(blueprint)}`,
      "--digest", `build-contract=${await digestFile(buildContract)}`,
      "--approve",
      "--preview-digest", JSON.parse(approvalPreview.stdout).previewDigest,
      "--out", out,
      "--json",
    ], out);
  }
});
