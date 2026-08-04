import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  access,
  lstat,
  mkdtemp,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  OPENCLAW_PROBE_SCHEMA_VERSION,
  OpenClawProbeError,
  probeOpenClawTarget,
  validateOpenClawProbe,
} from "../src/openclaw-probe.js";
import { loadAdmittedArtifact } from "../src/artifact-admission.js";
import {
  admitNativePluginRecipe,
  buildBuildContract,
  writeBuildContract,
} from "../src/build-contract.js";
import {
  buildOpenClawTargetCarrierAdmission,
  writeOpenClawTargetCarrierAdmission,
} from "../src/openclaw-target-admission.js";
import {
  buildOpenClawTargetDescriptor,
  writeOpenClawTargetDescriptor,
} from "../src/openclaw-target-descriptor.js";
import {
  buildPlanApproval,
  buildPlanApprovalPreview,
  writePlanApproval,
} from "../src/plan-approval.js";
import {
  buildApprovedPackageFixture,
  packageProduceOptions,
  produceAgentPackageFixture,
} from "./helpers/package-produce-fixture.js";

const CLI = path.resolve("bin/agentmo.js");
const sha256 = (bytes) => (
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`
);

describe("read-only OpenClaw capability probe", () => {
  it("binds the exact archive and target authority without touching operator state", {
    skip: process.platform !== "linux",
  }, async () => {
    const fixture = await buildApprovedPackageFixture();
    const packageRoot = path.join(fixture.root, "probe-package");
    const archivePath = path.join(fixture.root, "probe-package.d42");
    const produced = await produceAgentPackageFixture(
      packageProduceOptions(fixture, packageRoot, archivePath),
    );
    const operatorHome = await mkdtemp(path.join(tmpdir(), "agentmo-operator-home-"));
    const sentinelPath = path.join(operatorHome, "state-sentinel.json");
    const sentinelBytes = Buffer.from('{"mustRemain":"byte-identical"}\n', "utf8");
    await writeFile(sentinelPath, sentinelBytes);

    const probe = await probeOpenClawTarget(
      probeOptions(fixture, archivePath, produced.archiveDigest),
    );

    assert.equal(OPENCLAW_PROBE_SCHEMA_VERSION, "agentmo.openclaw-probe.v1");
    assert.equal(
      validateOpenClawProbe(probe, { sources: probe.sourceBindings }).ok,
      true,
    );
    assert.equal(Object.isFrozen(probe), true);
    assert.equal(probe.archive.archiveDigest, produced.archiveDigest);
    assert.equal(probe.archive.manifestDigest, produced.manifestDigest);
    assert.equal(probe.archive.inventoryDigest, produced.inventoryDigest);
    assert.equal(probe.archive.memberCount, 40);
    assert.equal(probe.target.exactTargetMatch, true);
    assert.equal(probe.isolation.shell, false);
    assert.equal(probe.isolation.inheritedEnvironment, false);
    assert.equal(probe.isolation.syntheticHomeDiscarded, true);
    assert.equal(probe.certificationBoundary.runtime, false);
    assert.equal(probe.certificationBoundary.domain, false);
    assert.equal(probe.certificationBoundary.production, false);
    assert.deepEqual(await readFile(sentinelPath), sentinelBytes);
    assert.equal(JSON.stringify(probe).includes(operatorHome), false);
    assert.equal(JSON.stringify(probe).includes(fixture.root), false);
  });

  it("fails before a child process when archive or exact target bytes drift", async () => {
    const fixture = await buildApprovedPackageFixture();
    const packageRoot = path.join(fixture.root, "drift-package");
    const archivePath = path.join(fixture.root, "drift-package.d42");
    const produced = await produceAgentPackageFixture(
      packageProduceOptions(fixture, packageRoot, archivePath),
    );
    const marker = path.join(fixture.root, "must-remain-absent");

    await assert.rejects(
      probeOpenClawTarget(
        probeOptions(fixture, archivePath, `sha256:${"0".repeat(64)}`),
      ),
      boundedProbeError,
    );
    await assert.rejects(() => lstat(marker), (error) => error?.code === "ENOENT");

    await writeFile(
      fixture.inputs.targetFiles.executablePath,
      "#!/usr/bin/env node\n// drift\n",
      { mode: 0o755 },
    );
    await assert.rejects(
      probeOpenClawTarget(
        probeOptions(fixture, archivePath, produced.archiveDigest),
      ),
      boundedProbeError,
    );
    await assert.rejects(() => lstat(marker), (error) => error?.code === "ENOENT");
  });

  it("exposes a create-only durable JSON CLI route", {
    skip: process.platform !== "linux",
  }, async () => {
    const fixture = await buildApprovedPackageFixture();
    const packageRoot = path.join(fixture.root, "cli-package");
    const archivePath = path.join(fixture.root, "cli-package.d42");
    const outPath = path.join(fixture.root, "openclaw-probe.json");
    const produced = await produceAgentPackageFixture(
      packageProduceOptions(fixture, packageRoot, archivePath),
    );
    const result = spawnSync(process.execPath, [
      CLI,
      "openclaw-probe",
      "--archive",
      archivePath,
      "--archive-sha256",
      produced.archiveDigest,
      "--blueprint",
      fixture.paths.blueprint,
      "--blueprint-sha256",
      fixture.digests.blueprint,
      "--build-contract",
      fixture.paths["build-contract"],
      "--build-contract-sha256",
      fixture.digests["build-contract"],
      "--plan-approval",
      fixture.paths["plan-approval"],
      "--plan-approval-sha256",
      fixture.digests["plan-approval"],
      "--target-carrier-admission",
      fixture.paths["openclaw-target-carrier-admission"],
      "--target-carrier-admission-sha256",
      fixture.digests["openclaw-target-carrier-admission"],
      "--target-descriptor",
      fixture.paths["openclaw-target-descriptor"],
      "--target-descriptor-sha256",
      fixture.digests["openclaw-target-descriptor"],
      "--target-root",
      path.dirname(fixture.inputs.targetFiles.packageJsonPath),
      "--out",
      outPath,
      "--json",
    ], {
      cwd: path.resolve("."),
      encoding: "utf8",
      env: { LANG: "C", LC_ALL: "C" },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const stdout = JSON.parse(result.stdout);
    const persisted = JSON.parse(await readFile(outPath, "utf8"));
    assert.deepEqual(stdout, persisted);
    assert.equal(
      validateOpenClawProbe(persisted, { sources: persisted.sourceBindings }).ok,
      true,
    );
  });

  it("rejects a self-auth probe whose internally consistent digest has no companion provenance", {
    skip: process.platform !== "linux",
  }, async () => {
    const fixture = await buildApprovedPackageFixture();
    const archivePath = path.join(fixture.root, "self-auth-package.d42");
    const produced = await produceAgentPackageFixture(
      packageProduceOptions(
        fixture,
        path.join(fixture.root, "self-auth-package"),
        archivePath,
      ),
    );
    const producedProbe = await probeOpenClawTarget(
      probeOptions(fixture, archivePath, produced.archiveDigest),
    );
    const handBuilt = structuredClone(producedProbe);

    assert.equal(validateOpenClawProbe(handBuilt).ok, false);
  });

  it("rejects an identity-only carrier when real source companions are absent", async () => {
    const fixture = await buildApprovedPackageFixture();
    const archivePath = path.join(fixture.root, "identity-only-package.d42");
    const produced = await produceAgentPackageFixture(
      packageProduceOptions(
        fixture,
        path.join(fixture.root, "identity-only-package"),
        archivePath,
      ),
    );

    await assert.rejects(
      probeOpenClawTarget(
        identityOnlyProbeOptions(fixture, archivePath, produced.archiveDigest),
      ),
      boundedProbeError,
    );
  });

  it("fails closed when the platform cannot execute both retained runtime and script objects", {
    skip: process.platform === "linux",
  }, async () => {
    const fixture = await buildApprovedPackageFixture();
    const archivePath = path.join(fixture.root, "unsupported-platform-package.d42");
    const produced = await produceAgentPackageFixture(
      packageProduceOptions(
        fixture,
        path.join(fixture.root, "unsupported-platform-package"),
        archivePath,
      ),
    );

    await assert.rejects(
      probeOpenClawTarget(
        probeOptions(fixture, archivePath, produced.archiveDigest),
      ),
      (error) => {
        assert.equal(
          error?.code,
          "AGENTMO_OPENCLAW_PROBE_PLATFORM_FD_TRANSPORT_UNAVAILABLE",
        );
        return true;
      },
    );
  });

  it("rejects a private cwd escape without reading the caller working directory", {
    skip: process.platform !== "linux",
  }, async () => {
    const callerCwd = await mkdtemp(path.join(tmpdir(), "agentmo-probe-caller-cwd-"));
    const sentinelPath = path.join(callerCwd, "attacker-module.json");
    await writeFile(sentinelPath, '{"valueBlindCanary":true}\n');
    const fixture = await buildExecutableProbeFixture(({ markerPath }) => [
      "import { existsSync, writeFileSync } from 'node:fs';",
      "import path from 'node:path';",
      "if (existsSync(path.join(process.cwd(), 'attacker-module.json'))) {",
      `  writeFileSync(${JSON.stringify(markerPath)}, 'caller-cwd-observed');`,
      "}",
      "",
    ].join("\n"));
    const previousCwd = process.cwd();
    let probe;
    try {
      process.chdir(callerCwd);
      probe = await probeOpenClawTarget(
        probeOptions(
          fixture,
          fixture.archivePath,
          fixture.produced.archiveDigest,
        ),
      );
    } finally {
      process.chdir(previousCwd);
    }

    assert.equal(probe.status, "compatible");
    await assert.rejects(
      () => access(fixture.markerPath),
      (error) => error?.code === "ENOENT",
    );
  });

  it("rejects an executable swap between observations without executing replacement bytes", {
    skip: process.platform !== "linux",
  }, async () => {
    const fixture = await buildExecutableProbeFixture(({
      executablePath,
      markerPath,
    }) => [
      "import { chmodSync, renameSync, writeFileSync } from 'node:fs';",
      "if (process.argv.includes('--version')) {",
      `  renameSync(${JSON.stringify(executablePath)}, ${JSON.stringify(`${executablePath}.retained`)});`,
      `  writeFileSync(${JSON.stringify(executablePath)}, ${JSON.stringify([
        "import { writeFileSync } from 'node:fs';",
        `writeFileSync(${JSON.stringify(markerPath)}, 'replacement-executed');`,
        "",
      ].join("\n"))});`,
      `  chmodSync(${JSON.stringify(executablePath)}, 0o755);`,
      "}",
      "",
    ].join("\n"));

    await assert.rejects(
      probeOpenClawTarget(
        probeOptions(
          fixture,
          fixture.archivePath,
          fixture.produced.archiveDigest,
        ),
      ),
      boundedProbeError,
    );
    await assert.rejects(
      () => access(fixture.markerPath),
      (error) => error?.code === "ENOENT",
    );
  });

  it("rejects a private script pathname replacement without executing it", {
    skip: process.platform !== "linux",
  }, async () => {
    const fixture = await buildExecutableProbeFixture(({ markerPath }) => [
      "import { chmodSync, writeFileSync } from 'node:fs';",
      "import path from 'node:path';",
      "if (process.argv.includes('--version')) {",
      "  const privateExecutable = path.join(process.env.TMPDIR, 'bin', 'openclaw-probe-target.mjs');",
      `  writeFileSync(privateExecutable, ${JSON.stringify([
        "import { writeFileSync } from 'node:fs';",
        `writeFileSync(${JSON.stringify(markerPath)}, 'replacement-executed');`,
        "",
      ].join("\n"))});`,
      "  chmodSync(privateExecutable, 0o700);",
      "}",
      "",
    ].join("\n"));

    await assert.rejects(
      probeOpenClawTarget(
        probeOptions(
          fixture,
          fixture.archivePath,
          fixture.produced.archiveDigest,
        ),
      ),
      boundedProbeError,
    );
    await assert.rejects(
      () => access(fixture.markerPath),
      (error) => error?.code === "ENOENT",
    );
  });

  it("preserves a replacement raced into the private script pathname", {
    skip: process.platform !== "linux",
  }, async () => {
    const isolatedRoot = await mkdtemp(
      path.join(tmpdir(), "agentmo-probe-pre-unlink-race-"),
    );
    const readyPath = path.join(isolatedRoot, "pre-unlink-ready");
    const releasePath = path.join(isolatedRoot, "pre-unlink-release");
    const isolatedModulePath = path.join(isolatedRoot, "openclaw-probe.mjs");
    const productionSource = await readFile(
      fileURLToPath(new URL("../src/openclaw-probe.js", import.meta.url)),
      "utf8",
    );
    const pathRevalidationNeedle =
      "    const namedStats = await lstat(filePath, { bigint: true });";
    assert.equal(productionSource.split(pathRevalidationNeedle).length, 2);
    const withAbsoluteImports = productionSource.replace(
      /from "(\.\/[^"]+)";/gu,
      (_match, specifier) => (
        `from ${JSON.stringify(new URL(specifier, new URL("../src/openclaw-probe.js", import.meta.url)).href)};`
      ),
    );
    const isolatedSource = withAbsoluteImports.replace(pathRevalidationNeedle, [
      "    {",
      "      const barrierFs = await import(\"node:fs/promises\");",
      `      await barrierFs.writeFile(${JSON.stringify(readyPath)}, filePath, { flag: \"wx\", mode: 0o600 });`,
      "      for (;;) {",
      "        try {",
      `          await barrierFs.access(${JSON.stringify(releasePath)});`,
      "          break;",
      "        } catch (error) {",
      "          if (error?.code !== \"ENOENT\") throw error;",
      "          await new Promise((resolve) => setTimeout(resolve, 5));",
      "        }",
      "      }",
      "    }",
      pathRevalidationNeedle,
    ].join("\n"));
    await writeFile(isolatedModulePath, isolatedSource);
    const isolated = await import(pathToFileURL(isolatedModulePath).href);
    const fixture = await buildExecutableProbeFixture(() => "\n");
    let outcome;
    const outcomePromise = isolated.probeOpenClawTarget(
      probeOptions(
        fixture,
        fixture.archivePath,
        fixture.produced.archiveDigest,
      ),
    ).then(
      (probe) => {
        outcome = { probe, error: null };
        return outcome;
      },
      (error) => {
        outcome = { probe: null, error };
        return outcome;
      },
    );
    let privateExecutable;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      try {
        privateExecutable = await readFile(readyPath, "utf8");
        break;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      if (outcome !== undefined) assert.fail("probe completed before unlink barrier");
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(typeof privateExecutable, "string");
    const retainedPath = `${privateExecutable}.retained`;
    const replacementBytes = Buffer.from("replacement-must-remain\n", "utf8");
    await rename(privateExecutable, retainedPath);
    await writeFile(privateExecutable, replacementBytes, {
      flag: "wx",
      mode: 0o600,
    });
    const replacementBefore = await lstat(privateExecutable, { bigint: true });
    await writeFile(releasePath, "release\n", { flag: "wx", mode: 0o600 });
    await outcomePromise;

    assert.deepEqual(await readFile(privateExecutable), replacementBytes);
    const replacementAfter = await lstat(privateExecutable, { bigint: true });
    assert.equal(replacementAfter.dev, replacementBefore.dev);
    assert.equal(replacementAfter.ino, replacementBefore.ino);
  });

  it("rejects a target swap between observations instead of certifying stale members", {
    skip: process.platform !== "linux",
  }, async () => {
    const fixture = await buildExecutableProbeFixture(({
      packageJsonPath,
    }) => [
      "import { writeFileSync } from 'node:fs';",
      "if (process.argv.includes('--version')) {",
      `  writeFileSync(${JSON.stringify(packageJsonPath)}, '{"valueBlindCanary":true}\\n');`,
      "}",
      "",
    ].join("\n"));

    await assert.rejects(
      probeOpenClawTarget(
        probeOptions(
          fixture,
          fixture.archivePath,
          fixture.produced.archiveDigest,
        ),
      ),
      boundedProbeError,
    );
  });

  it("preserves a private-root replacement instead of recursive pathname cleanup", {
    skip: process.platform !== "linux",
  }, async () => {
    let preservedRoot;
    const fixture = await buildExecutableProbeFixture(({ markerPath }) => {
      preservedRoot = `${markerPath}.preserved-private-root`;
      return [
        "import { mkdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';",
        "import path from 'node:path';",
        "if (process.argv.includes('--version')) {",
        "  const privateRoot = process.env.TMPDIR;",
        `  renameSync(privateRoot, ${JSON.stringify(preservedRoot)});`,
        "  mkdirSync(privateRoot, { mode: 0o700 });",
        "  const sentinel = path.join(privateRoot, 'replacement-sentinel');",
        "  writeFileSync(sentinel, 'replacement-must-remain\\n', { mode: 0o600 });",
        `  symlinkSync(sentinel, ${JSON.stringify(markerPath)});`,
        "}",
        "",
      ].join("\n");
    });

    await assert.rejects(
      probeOpenClawTarget(
        probeOptions(
          fixture,
          fixture.archivePath,
          fixture.produced.archiveDigest,
        ),
      ),
      boundedProbeError,
    );
    assert.equal(
      await readFile(fixture.markerPath, "utf8"),
      "replacement-must-remain\n",
    );
    assert.equal((await lstat(preservedRoot)).isDirectory(), true);
  });
});

function probeOptions(fixture, archivePath, archiveDigest) {
  return {
    archivePath,
    expectedArchiveDigest: archiveDigest,
    blueprintPath: fixture.paths.blueprint,
    expectedBlueprintDigest: fixture.digests.blueprint,
    buildContractPath: fixture.paths["build-contract"],
    expectedBuildContractDigest: fixture.digests["build-contract"],
    planApprovalPath: fixture.paths["plan-approval"],
    expectedPlanApprovalDigest: fixture.digests["plan-approval"],
    targetCarrierAdmissionPath:
      fixture.paths["openclaw-target-carrier-admission"],
    expectedTargetCarrierAdmissionDigest:
      fixture.digests["openclaw-target-carrier-admission"],
    targetDescriptorPath: fixture.paths["openclaw-target-descriptor"],
    expectedTargetDescriptorDigest:
      fixture.digests["openclaw-target-descriptor"],
    targetRoot: path.dirname(fixture.inputs.targetFiles.packageJsonPath),
  };
}

function identityOnlyProbeOptions(fixture, archivePath, archiveDigest) {
  const {
    blueprintPath: _blueprintPath,
    expectedBlueprintDigest: _expectedBlueprintDigest,
    buildContractPath: _buildContractPath,
    expectedBuildContractDigest: _expectedBuildContractDigest,
    planApprovalPath: _planApprovalPath,
    expectedPlanApprovalDigest: _expectedPlanApprovalDigest,
    ...identityOnly
  } = probeOptions(fixture, archivePath, archiveDigest);
  return identityOnly;
}

async function buildExecutableProbeFixture(sourceBuilder) {
  const fixture = await buildApprovedPackageFixture();
  const executablePath = fixture.inputs.targetFiles.executablePath;
  const packageJsonPath = fixture.inputs.targetFiles.packageJsonPath;
  const buildInfoPath = fixture.inputs.targetFiles.buildInfoPath;
  const markerPath = path.join(fixture.root, "replacement-marker");
  await writeFile(executablePath, sourceBuilder({
    executablePath,
    packageJsonPath,
    buildInfoPath,
    markerPath,
  }), { mode: 0o755 });

  const descriptor = await buildOpenClawTargetDescriptor({
    executablePath,
    packageJsonPath,
    buildInfoPath,
    digests: {
      "target-executable": sha256(await readFile(executablePath)),
      "target-package-json": sha256(await readFile(packageJsonPath)),
      "target-build-info": sha256(await readFile(buildInfoPath)),
    },
  });
  const descriptorPath = path.join(fixture.root, "executable-probe-descriptor.json");
  await writeOpenClawTargetDescriptor(
    descriptorPath,
    descriptor,
    fixture.publication,
  );
  const descriptorAdmission = await admitFile(
    descriptorPath,
    "openclaw-target-descriptor",
  );
  const recipePath = fixture.paths["native-plugin-recipe"];
  const recipeAdmission = await admitNativePluginRecipe({
    filePath: recipePath,
    expectedDigest: sha256(await readFile(recipePath)),
  });
  const contract = buildBuildContract(
    fixture.inputs.values.blueprint,
    fixture.inputs.values.designPlan,
    fixture.inputs.values.discoveryApproval,
    fixture.inputs.values.decisionLedger,
    {
      target: "openclaw",
      admissions: {
        ...fixture.inputs.admissions,
        targetDescriptor: descriptorAdmission,
      },
      nativePluginRecipe: recipeAdmission.value,
      nativePluginRecipeAdmission: recipeAdmission,
    },
  );
  const contractPath = path.join(fixture.root, "executable-probe-contract.json");
  await writeBuildContract(contractPath, contract);
  const contractAdmission = await admitFile(contractPath, "build-contract");
  const approvalPreview = buildPlanApprovalPreview(
    fixture.inputs.values.blueprint,
    contractAdmission.value,
    {
      admissions: {
        blueprint: fixture.inputs.blueprint,
        buildContract: contractAdmission,
      },
    },
  );
  const approval = buildPlanApproval(
    fixture.inputs.values.blueprint,
    contractAdmission.value,
    {
      admissions: {
        blueprint: fixture.inputs.blueprint,
        buildContract: contractAdmission,
      },
      approve: true,
      previewDigest: approvalPreview.previewDigest,
    },
  );
  const approvalPath = path.join(fixture.root, "executable-probe-approval.json");
  await writePlanApproval(approvalPath, approval);
  const approvalAdmission = await admitFile(approvalPath, "plan-approval");
  const carrier = await buildOpenClawTargetCarrierAdmission({
    blueprint: fixture.inputs.values.blueprint,
    buildContract: contractAdmission.value,
    planApproval: approvalAdmission.value,
    admissions: {
      blueprint: fixture.inputs.blueprint,
      buildContract: contractAdmission,
      planApproval: approvalAdmission,
      targetDescriptor: descriptorAdmission,
    },
    target: {
      executablePath,
      executableDigest: sha256(await readFile(executablePath)),
      packageJsonPath,
      packageJsonDigest: sha256(await readFile(packageJsonPath)),
      buildInfoPath,
      buildInfoDigest: sha256(await readFile(buildInfoPath)),
    },
  });
  const carrierPath = path.join(fixture.root, "executable-probe-carrier.json");
  await writeOpenClawTargetCarrierAdmission(
    carrierPath,
    carrier,
    fixture.publication,
  );
  Object.assign(fixture.paths, {
    "openclaw-target-descriptor": descriptorPath,
    "build-contract": contractPath,
    "plan-approval": approvalPath,
    "openclaw-target-carrier-admission": carrierPath,
  });
  for (const subject of [
    "openclaw-target-descriptor",
    "build-contract",
    "plan-approval",
    "openclaw-target-carrier-admission",
  ]) {
    fixture.digests[subject] = sha256(await readFile(fixture.paths[subject]));
  }
  const archivePath = path.join(fixture.root, "executable-probe-package.d42");
  const produced = await produceAgentPackageFixture(packageProduceOptions(
    fixture,
    path.join(fixture.root, "executable-probe-package"),
    archivePath,
  ));
  return {
    ...fixture,
    archivePath,
    produced,
    markerPath,
  };
}

async function admitFile(filePath, subject, companions) {
  return loadAdmittedArtifact({
    filePath,
    subject,
    expectedDigest: sha256(await readFile(filePath)),
    ...(companions ? { companions } : {}),
  });
}

function boundedProbeError(error) {
  assert.equal(error instanceof OpenClawProbeError, true);
  assert.match(error.code, /^AGENTMO_OPENCLAW_PROBE_[A-Z0-9_]+$/u);
  assert.equal(error.message, "OpenClaw capability probe was rejected.");
  assert.equal(JSON.stringify(error).includes("/tmp/"), false);
  assert.equal(JSON.stringify(error).includes("/Users/"), false);
  return true;
}
