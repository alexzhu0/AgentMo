import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const CLI = fileURLToPath(new URL("../bin/agentmo.js", import.meta.url));
const DISCOVERY = fileURLToPath(new URL("../examples/support-triage.discovery.json", import.meta.url));
const NEED = fileURLToPath(new URL("../examples/support-triage.need.json", import.meta.url));
const DOMAIN_CASES = fileURLToPath(new URL("../examples/support-triage.domain-cases.json", import.meta.url));

function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { stdio: ["ignore", "pipe", "pipe"] });
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

describe("cli mvp birth loop", () => {
  it("runs support-triage through discover, need, draft, handoff, run-eval, birth-report, domain-eval, and delivery-report", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-cli-mvp-"));
    const discoveryOut = path.join(root, "discovery-pack");
    const discover = await runCli(["discover-pack", DISCOVERY, "--out", discoveryOut, "--json"]);
    assert.equal(discover.code, 0, discover.stderr);
    const discoverJson = JSON.parse(discover.stdout);
    assert.equal(discoverJson.discoveryDb.agentId, "support-triage");

    const need = await runCli(["need-report", NEED, "--json"]);
    assert.equal(need.code, 0, need.stderr);
    assert.equal(JSON.parse(need.stdout).ok, true);

    const blueprintPath = path.join(root, "support-triage.agentmo.json");
    const draft = await runCli([
      "blueprint-draft",
      path.join(discoveryOut, "agentmo-discovery-db.json"),
      "--need",
      NEED,
      "--out",
      blueprintPath,
      "--target",
      "openclaw",
      "--json",
    ]);
    assert.equal(draft.code, 0, draft.stderr);
    assert.equal(JSON.parse(draft.stdout).report.ok, true);

    const validate = await runCli(["validate", blueprintPath]);
    assert.equal(validate.code, 0, validate.stderr);

    const handoffOut = path.join(root, "handoff");
    const handoff = await runCli(["handoff", blueprintPath, "--target", "openclaw", "--out", handoffOut, "--json"]);
    assert.equal(handoff.code, 0, handoff.stderr);
    assert.equal(JSON.parse(handoff.stdout).handoff.certificationBoundary.handoffCertifiesRuntime, false);

    const scaffoldOut = path.join(root, "scaffold");
    const scaffold = await runCli(["scaffold", blueprintPath, "--target", "openclaw", "--out", scaffoldOut]);
    assert.equal(scaffold.code, 0, scaffold.stderr);

    const runOut = path.join(root, "run");
    const run = await runCli([
      "run",
      blueprintPath,
      "--target",
      "openclaw",
      "--workspace",
      path.join(root, "workspace"),
      "--message",
      "Say exactly: ok",
      "--out",
      runOut,
      "--json",
    ]);
    assert.equal(run.code, 0, run.stderr);
    const runState = JSON.parse(run.stdout);
    const runStatePath = path.join(runOut, "runs", runState.runId, "agentmo-run-state.json");

    const evaluation = await runCli(["run-eval", runStatePath, "--expect-status", "declared", "--json"]);
    assert.equal(evaluation.code, 0, evaluation.stderr);
    const runEvalJson = JSON.parse(evaluation.stdout);
    assert.equal(runEvalJson.schemaVersion, "agentmo.run-eval.v1");
    assert.equal(runEvalJson.ok, true);
    const runEvalPath = path.join(root, "run-eval.json");
    await writeFile(runEvalPath, evaluation.stdout, "utf8");

    const birth = await runCli([
      "birth-report",
      blueprintPath,
      "--build-state",
      path.join(scaffoldOut, "agentmo-build-state.json"),
      "--run-state",
      runStatePath,
      "--run-eval",
      runEvalPath,
      "--expect-status",
      "declared",
      "--json",
    ]);
    assert.equal(birth.code, 0, birth.stderr);
    const birthJson = JSON.parse(birth.stdout);
    assert.equal(birthJson.ok, true);
    assert.equal(birthJson.birthStatus, "declared-ready");
    assert.equal(birthJson.certificationBoundary.runtimeCertifiedByBirthReport, false);
    const birthReportPath = path.join(root, "birth-report.json");
    await writeFile(birthReportPath, birth.stdout, "utf8");

    const domainEval = await runCli(["domain-eval", blueprintPath, "--cases", DOMAIN_CASES, "--target", "openclaw", "--json"]);
    assert.equal(domainEval.code, 0, domainEval.stderr);
    const domainEvalJson = JSON.parse(domainEval.stdout);
    assert.equal(domainEvalJson.schemaVersion, "agentmo.domain-eval.v1");
    assert.equal(domainEvalJson.ok, true);
    assert.equal(domainEvalJson.domainCertifiedByDomainEval, true);
    const domainEvalPath = path.join(root, "domain-eval.json");
    await writeFile(domainEvalPath, domainEval.stdout, "utf8");

    const delivery = await runCli([
      "delivery-report",
      blueprintPath,
      "--build-state",
      path.join(scaffoldOut, "agentmo-build-state.json"),
      "--run-state",
      runStatePath,
      "--run-eval",
      runEvalPath,
      "--birth-report",
      birthReportPath,
      "--domain-eval",
      domainEvalPath,
      "--json",
    ]);
    assert.equal(delivery.code, 0, delivery.stderr);
    const deliveryJson = JSON.parse(delivery.stdout);
    assert.equal(deliveryJson.schemaVersion, "agentmo.delivery.v1");
    assert.equal(deliveryJson.ok, true);
    assert.equal(deliveryJson.domainCertified, true);
    assert.equal(deliveryJson.runtimePromotionEligible, false);
    assert.equal(deliveryJson.deliveryReady, false);
    assert.equal(deliveryJson.certificationBoundary.runtimeCertifiedByDeliveryReport, false);
    assert.equal(deliveryJson.certificationBoundary.domainCertifiedByDeliveryReport, false);
    assert.equal((await readFile(path.join(handoffOut, "VERIFY.md"), "utf8")).includes("Birth-report must fail closed"), true);
  });
});
