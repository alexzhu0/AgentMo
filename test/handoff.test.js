import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdtemp, open, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it } from "node:test";
import { loadAdmittedBlueprint } from "../src/blueprint.js";
import {
  buildHandoffPackage,
  loadHandoffPackage,
  validateHandoffPackage,
  writeHandoffPackage,
} from "../src/handoff.js";

const CLI = fileURLToPath(new URL("../bin/agentmo.js", import.meta.url));
const SUPPORT_BLUEPRINT = fileURLToPath(new URL("../examples/support-triage.agentmo.json", import.meta.url));
const EXPECTED_HANDOFF_FILES = [
  "ACCEPTANCE_CRITERIA.md",
  "BUILD_TASKS.md",
  "EVIDENCE_REQUIREMENTS.md",
  "README.md",
  "ROLLBACK_PLAN.md",
  "RUNTIME_PLAN.md",
  "TEST_PLAN.md",
  "VERIFY.md",
  "agentmo-handoff.json",
];

function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function digestFile(file) {
  return digestBytes(await readFile(file));
}

async function admitBlueprint(file = SUPPORT_BLUEPRINT, options = {}) {
  return loadAdmittedBlueprint(file, {
    subject: "blueprint",
    expectedDigest: await digestFile(file),
    ...options,
  });
}

async function writeBlueprintVariant(root, name, mutate) {
  const blueprint = JSON.parse(await readFile(SUPPORT_BLUEPRINT, "utf8"));
  mutate(blueprint);
  const file = path.join(root, `${name}.agentmo.json`);
  await writeFile(file, `${JSON.stringify(blueprint, null, 2)}\n`, "utf8");
  return file;
}

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

async function listDirectoryIfPresent(directory) {
  try {
    return await readdir(directory);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function readPackageBytes(root) {
  return Promise.all(EXPECTED_HANDOFF_FILES.map(async (relativePath) => [
    relativePath,
    await readFile(path.join(root, relativePath)),
  ]));
}

describe("handoff", () => {
  it("writes deterministic, non-certifying files with exact admitted blueprint provenance", async () => {
    const admission = await admitBlueprint();
    const handoffPackage = await buildHandoffPackage(admission.value, {
      target: "openclaw",
      admission,
    });

    assert.equal(handoffPackage.ok, true);
    assert.equal(Object.isFrozen(handoffPackage), true);
    assert.equal(handoffPackage.handoff.certificationBoundary.handoffCertifiesRuntime, false);
    assert.equal(handoffPackage.handoff.certificationBoundary.handoffCertifiesDomain, false);
    assert.deepEqual(handoffPackage.handoff.provenance, {
      identity: "0.1",
      subject: "blueprint",
      digest: admission.digest,
    });
    assert.deepEqual(Object.keys(handoffPackage.handoff.provenance), ["identity", "subject", "digest"]);
    assert.equal("path" in handoffPackage.handoff.provenance, false);
    assert.equal("upstreamValid" in handoffPackage.handoff.provenance, false);
    assert.equal(
      handoffPackage.handoff.commands.some((command) => command.includes(admission.digest)),
      false,
    );
    assert.equal(
      handoffPackage.handoff.commands.some((command) => (
        command.startsWith('agentmo run-plan "<path-to-support-triage.agentmo.json>"')
        && command.includes('--digest "blueprint=$(node -e')
      )),
      true,
    );
    assert.equal(
      handoffPackage.handoff.commands.some((command) => (
        command.startsWith('agentmo run "<runtime-plan.json>"')
        && command.includes('--digest "runtime-plan=$(node -e')
      )),
      true,
    );
    assert.equal(
      handoffPackage.handoff.commands.some((command) => command.startsWith("agentmo run \"<path-to-")),
      false,
    );
    assert.deepEqual(handoffPackage.handoff.requiredInputs, handoffPackage.handoff.stage3RequiredArtifacts);
    assert.equal(handoffPackage.handoff.requiredInputs.includes("validated blueprint/design contract"), true);
    assert.equal(handoffPackage.handoff.requiredInputs.includes("discovery pack"), false);
    assert.equal(handoffPackage.handoff.requiredInputs.includes("user-need report"), false);
    assert.equal(validateHandoffPackage(handoffPackage.handoff).ok, true);

    const parent = await mkdtemp(path.join(tmpdir(), "agentmo-handoff-"));
    const firstOut = path.join(parent, "first");
    const secondOut = path.join(parent, "second");
    const firstPaths = await writeHandoffPackage(firstOut, handoffPackage);
    const secondPaths = await writeHandoffPackage(secondOut, handoffPackage);
    assert.deepEqual(firstPaths.files.map((file) => path.basename(file)).sort(), EXPECTED_HANDOFF_FILES);
    assert.deepEqual(secondPaths.files.map((file) => path.basename(file)).sort(), EXPECTED_HANDOFF_FILES);

    const firstBytes = await readPackageBytes(firstOut);
    const secondBytes = await readPackageBytes(secondOut);
    for (let index = 0; index < firstBytes.length; index += 1) {
      assert.equal(firstBytes[index][0], secondBytes[index][0]);
      assert.deepEqual(firstBytes[index][1], secondBytes[index][1]);
    }

    const readme = await readFile(path.join(firstOut, "README.md"), "utf8");
    assert.match(readme, /Runtime certification: not claimed/u);
    assert.match(await readFile(path.join(firstOut, "ROLLBACK_PLAN.md"), "utf8"), /Do not promote runtime birth/u);
    const runtimePlan = await readFile(path.join(firstOut, "RUNTIME_PLAN.md"), "utf8");
    assert.match(runtimePlan, /run-plan -> runtime-plan -> run chain/u);
    assert.doesNotMatch(runtimePlan, /agentmo run --target openclaw/u);
    const evidenceRequirements = await readFile(path.join(firstOut, "EVIDENCE_REQUIREMENTS.md"), "utf8");
    assert.match(evidenceRequirements, /No credential values/u);
    assert.match(evidenceRequirements, /Stage 3 required inputs/u);
    assert.doesNotMatch(evidenceRequirements, /raw transcripts|raw tool bodies/iu);

    const manifestPath = path.join(firstOut, "agentmo-handoff.json");
    let opens = 0;
    const loaded = await loadHandoffPackage(manifestPath, {
      subject: "handoff",
      expectedDigest: await digestFile(manifestPath),
      openInput: async (...args) => {
        opens += 1;
        return open(...args);
      },
    });
    assert.equal(opens, 1);
    assert.equal(loaded.schemaVersion, "agentmo.handoff.v1");
    assert.deepEqual(loaded.provenance, handoffPackage.handoff.provenance);
    assert.equal(Object.isFrozen(loaded), true);
  });

  it("does not hardcode OpenClaw execution for the AgentMo target", async () => {
    const admission = await admitBlueprint();
    const handoffPackage = await buildHandoffPackage(admission.value, {
      target: "agentmo",
      admission,
    });
    assert.equal(handoffPackage.ok, true);
    assert.equal(handoffPackage.handoff.commands.some((command) => command.includes("--target openclaw")), false);
    assert.equal(handoffPackage.handoff.commands.some((command) => command.includes("target-specific run-state and run-eval evidence")), true);
  });

  it("keeps external review non-authoritative and does not require Stage 1 or Stage 2 ancestry", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-external-review-handoff-"));
    const blueprintPath = await writeBlueprintVariant(root, "external-reviewed", (blueprint) => {
      blueprint.design_contract = {
        provenance: {
          source: "external-reviewed",
          reviewed: true,
          review_ref: "reviews/support-triage-stage3-admission",
          contract_version: "agentmo.design-contract.v1",
          notes: "Externally reviewed support-triage design admitted without Stage 1 or Stage 2 command ancestry.",
        },
      };
    });
    const admission = await admitBlueprint(blueprintPath);
    const handoffPackage = await buildHandoffPackage(admission.value, {
      target: "openclaw",
      admission,
    });

    assert.equal(handoffPackage.handoff.requiredInputs.includes("discovery pack"), false);
    assert.equal(handoffPackage.handoff.requiredInputs.includes("user-need report"), false);
    assert.deepEqual(handoffPackage.handoff.provenance, {
      identity: "0.1",
      subject: "blueprint",
      digest: admission.digest,
    });
    assert.equal(JSON.stringify(handoffPackage).includes("reviews/support-triage-stage3-admission"), false);
  });

  it("rejects every blueprint/handoff family swap, unknown identity, and mixed identity", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-handoff-family-"));
    const admission = await admitBlueprint();
    const handoffPackage = await buildHandoffPackage(admission.value, {
      target: "openclaw",
      admission,
    });
    const out = path.join(root, "handoff");
    await writeHandoffPackage(out, handoffPackage);
    const handoffPath = path.join(out, "agentmo-handoff.json");
    const handoffDigest = await digestFile(handoffPath);
    const blueprintDigest = await digestFile(SUPPORT_BLUEPRINT);

    await assert.rejects(
      () => loadHandoffPackage(SUPPORT_BLUEPRINT, {
        subject: "handoff",
        expectedDigest: blueprintDigest,
      }),
      (error) => error?.code === "AGENTMO_UNSUPPORTED_ARTIFACT",
    );
    await assert.rejects(
      () => loadAdmittedBlueprint(handoffPath, {
        subject: "blueprint",
        expectedDigest: handoffDigest,
      }),
      (error) => error?.code === "AGENTMO_UNSUPPORTED_ARTIFACT",
    );
    await assert.rejects(
      () => loadHandoffPackage(handoffPath, {
        subject: "blueprint",
        expectedDigest: handoffDigest,
      }),
      (error) => error?.code === "AGENTMO_UNSUPPORTED_ARTIFACT",
    );

    for (const [name, expectedCode, mutate] of [
      ["unknown", "AGENTMO_UNSUPPORTED_ARTIFACT", (handoff) => { handoff.schemaVersion = "agentmo.handoff.v9"; }],
      ["mixed", "AGENTMO_UNSUPPORTED_ARTIFACT", (handoff) => { handoff.agentmo_version = "0.1"; }],
      ["unsafe", "AGENTMO_ARTIFACT_UNSAFE_CONTENT", (handoff) => { handoff.risks.push("/Users/private/fixture-only-loader-path-canary"); }],
    ]) {
      const value = structuredClone(handoffPackage.handoff);
      mutate(value);
      const file = path.join(root, `${name}.handoff.json`);
      await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      const digest = await digestFile(file);
      await assert.rejects(
        () => loadHandoffPackage(file, {
          subject: "handoff",
          expectedDigest: digest,
        }),
        (error) => error?.code === expectedCode,
      );
    }
  });

  it("preflights every hostile candidate and forged package before creating an output root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-handoff-preflight-"));
    const hostileValues = [
      "raw transcript fixture-only-transcript-canary",
      "raw tool output fixture-only-tool-canary",
      "raw stdout fixture-only-stdout-canary",
      "DEEPSEEK_API_KEY=fixture-only-secret-canary",
      "/Users/private/fixture-only-path-canary",
    ];

    for (const [index, hostileValue] of hostileValues.entries()) {
      const blueprintPath = await writeBlueprintVariant(root, `hostile-${index}`, (blueprint) => {
        blueprint.release.known_risks.push(hostileValue);
      });
      const out = path.join(root, `must-not-exist-${index}`);
      if (hostileValue.startsWith("DEEPSEEK_API_KEY=") || hostileValue.startsWith("/Users/")) {
        await assert.rejects(
          () => admitBlueprint(blueprintPath),
          (error) => error?.code === "AGENTMO_ARTIFACT_UNSAFE_CONTENT"
            && !JSON.stringify(error).includes(hostileValue),
        );
      } else {
        const admission = await admitBlueprint(blueprintPath);
        await assert.rejects(
          () => buildHandoffPackage(admission.value, { target: "openclaw", admission }),
          (error) => error?.code?.startsWith("AGENTMO_PERSISTABILITY_")
            && !JSON.stringify(error).includes(hostileValue),
        );
      }
      await assert.rejects(() => access(out), { code: "ENOENT" });
    }

    const admission = await admitBlueprint();
    const authentic = await buildHandoffPackage(admission.value, { target: "openclaw", admission });
    const forged = structuredClone(authentic);
    forged.files.at(-1).content = "raw stderr fixture-only-forged-canary";
    const forgedOut = path.join(root, "forged-must-not-exist");
    await assert.rejects(
      () => writeHandoffPackage(forgedOut, forged),
      (error) => error?.code === "AGENTMO_HANDOFF_PACKAGE_UNTRUSTED",
    );
    assert.deepEqual(await listDirectoryIfPresent(forgedOut), []);
  });

  it("runs the exact handoff path in a fresh process and keeps failures value-blind with zero root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-handoff-cli-"));
    const successOut = path.join(root, "success");
    const success = await runCli([
      "handoff",
      SUPPORT_BLUEPRINT,
      "--digest",
      `blueprint=${await digestFile(SUPPORT_BLUEPRINT)}`,
      "--target",
      "openclaw",
      "--out",
      successOut,
      "--json",
    ]);
    assert.equal(success.code, 0, success.stderr);
    const successJson = JSON.parse(success.stdout);
    assert.equal(successJson.handoff.provenance.digest, await digestFile(SUPPORT_BLUEPRINT));
    assert.deepEqual((await readdir(successOut)).sort(), EXPECTED_HANDOFF_FILES);

    const handoffManifest = path.join(successOut, "agentmo-handoff.json");
    const handoffDigest = await digestFile(handoffManifest);
    const familyOut = path.join(root, "family-must-not-exist");
    const familyJson = await runCli([
      "handoff",
      handoffManifest,
      "--digest",
      `blueprint=${handoffDigest}`,
      "--out",
      familyOut,
      "--json",
    ]);
    assert.equal(familyJson.code, 1);
    assert.equal(JSON.parse(familyJson.stdout).code, "AGENTMO_UNSUPPORTED_ARTIFACT");
    assert.deepEqual(await listDirectoryIfPresent(familyOut), []);

    const familyHuman = await runCli([
      "plan",
      handoffManifest,
      "--digest",
      `blueprint=${handoffDigest}`,
    ]);
    assert.equal(familyHuman.code, 1);
    assert.equal(familyHuman.stdout, "");
    assert.match(familyHuman.stderr, /AGENTMO_UNSUPPORTED_ARTIFACT/u);
    for (const output of [familyJson.stdout, familyJson.stderr, familyHuman.stdout, familyHuman.stderr]) {
      assert.equal(output.includes(root), false);
      assert.equal(output.includes(path.basename(handoffManifest)), false);
    }

    const unknownPath = await writeBlueprintVariant(root, "unknown-cli", (blueprint) => {
      blueprint.agentmo_version = "9.9";
    });
    const unknown = await runCli([
      "validate",
      unknownPath,
      "--digest",
      `blueprint=${await digestFile(unknownPath)}`,
      "--json",
    ]);
    assert.equal(unknown.code, 1);
    assert.equal(JSON.parse(unknown.stdout).code, "AGENTMO_UNSUPPORTED_ARTIFACT");
    assert.equal(unknown.stdout.includes(root), false);

    const canary = "/Users/private/fixture-only-cli-path-canary";
    const hostilePath = await writeBlueprintVariant(root, "hostile-cli", (blueprint) => {
      blueprint.release.known_risks.push(canary);
    });
    const failureOut = path.join(root, "failure-must-not-exist");
    const failure = await runCli([
      "handoff",
      hostilePath,
      "--digest",
      `blueprint=${await digestFile(hostilePath)}`,
      "--target",
      "openclaw",
      "--out",
      failureOut,
      "--json",
    ]);
    assert.equal(failure.code, 1);
    assert.equal(failure.stderr, "");
    assert.equal(JSON.parse(failure.stdout).code, "AGENTMO_ARTIFACT_UNSAFE_CONTENT");
    assert.equal(failure.stdout.includes(canary), false);
    assert.deepEqual(await listDirectoryIfPresent(failureOut), []);
  });
});
