import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  produceAgentPackage,
} from "../src/package-produce.js";
import {
  readPackageArchiveInventory,
} from "../src/package-archive.js";
import {
  buildApprovedPackageFixture,
  digestBytes,
  packageProduceOptions,
} from "./helpers/package-produce-fixture.js";
import { NATIVE_OPENCLAW_FS } from "./helpers/native-openclaw-fs.js";

describe("exact approved package Produce", {
  skip: !NATIVE_OPENCLAW_FS,
}, () => {
  it("works from a fresh CLI process using only exact named artifacts", async () => {
    const fixture = await buildApprovedPackageFixture();
    const outputRoot = path.join(fixture.root, "cli-package");
    const archivePath = path.join(fixture.root, "cli-package.d42");
    const subjectFlags = [
      ["blueprint", fixture.paths.blueprint],
      ["design-plan", fixture.paths["design-plan"]],
      ["discovery-approval", fixture.paths["discovery-approval"]],
      ["decision-ledger", fixture.paths["decision-ledger"]],
      ["build-contract", fixture.paths["build-contract"]],
      ["plan-approval", fixture.paths["plan-approval"]],
      ["openclaw-target-descriptor", fixture.paths["openclaw-target-descriptor"]],
      [
        "openclaw-target-carrier-admission",
        fixture.paths["openclaw-target-carrier-admission"],
      ],
    ];
    const args = [
      "bin/agentmo.js",
      "package-produce",
      fixture.paths.blueprint,
      "--design-plan", fixture.paths["design-plan"],
      "--discovery-approval", fixture.paths["discovery-approval"],
      "--decision-ledger", fixture.paths["decision-ledger"],
      "--build-contract", fixture.paths["build-contract"],
      "--plan-approval", fixture.paths["plan-approval"],
      "--target-descriptor", fixture.paths["openclaw-target-descriptor"],
      "--target-carrier-admission", fixture.paths["openclaw-target-carrier-admission"],
      ...subjectFlags.flatMap(([subject]) => [
        "--digest", `${subject}=${fixture.digests[subject]}`,
      ]),
      "--fs-helper", fixture.publication.helperPath,
      "--fs-helper-receipt", fixture.publication.receiptPath,
      "--fs-helper-receipt-digest", fixture.publication.receiptDigest,
      "--out", outputRoot,
      "--archive", archivePath,
      "--json",
    ];
    const missingTupleArgs = [...args];
    missingTupleArgs.splice(missingTupleArgs.indexOf("--fs-helper"), 6);
    const missingTuple = spawnSync(process.execPath, missingTupleArgs, {
      cwd: path.resolve("."),
      encoding: "utf8",
      env: { PATH: process.env.PATH, TZ: "UTC", LANG: "C" },
    });
    assert.notEqual(missingTuple.status, 0);
    await assert.rejects(access(outputRoot));
    await assert.rejects(access(archivePath));
    const processResult = spawnSync(process.execPath, args, {
      cwd: path.resolve("."),
      encoding: "utf8",
      env: { PATH: process.env.PATH, TZ: "UTC", LANG: "C" },
    });
    assert.equal(processResult.status, 0, processResult.stderr || processResult.stdout);
    const report = JSON.parse(processResult.stdout);
    assert.match(report.archiveDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(report.certificationBoundary.installed, false);
    assert.equal(report.certificationBoundary.runtime, false);
  });

  it("materializes a complete canonical package and D-42 archive", async () => {
    const fixture = await buildApprovedPackageFixture();
    const outputRoot = path.join(fixture.root, "package");
    const archivePath = path.join(fixture.root, "package.d42");
    const result = await produceAgentPackage(
      packageProduceOptions(fixture, outputRoot, archivePath),
    );
    assert.equal(result.schemaVersion, "agentmo.package-produce-result.v1");
    assert.equal(result.outputRoot, outputRoot);
    assert.equal(result.archivePath, archivePath);
    assert.match(result.archiveDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.match(result.manifestDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.match(result.inventoryDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(result.certificationBoundary.installed, false);
    assert.equal(result.certificationBoundary.runtime, false);
    assert.equal(result.certificationBoundary.domain, false);
    assert.equal(result.certificationBoundary.production, false);

    const manifestBytes = await readFile(path.join(outputRoot, "agentmo.package.json"));
    const manifest = JSON.parse(manifestBytes);
    assert.equal(manifest.schemaVersion, "agentmo.package-manifest.v1");
    assert.equal(manifest.members.length >= 30, true);
    assert.equal(manifest.capabilityLedger.length, manifest.capabilityIds.length);
    assert.equal(manifest.members.some(({ relativePath }) => (
      relativePath === "resources/prompts/system.md"
    )), true);
    assert.equal(manifest.members.some(({ relativePath }) => (
      relativePath === "resources/skills/support-triage/SKILL.md"
    )), true);
    assert.equal(manifest.members.some(({ relativePath }) => (
      relativePath === "resources/tools/tool-bindings.json"
    )), true);
    assert.equal(manifest.members.some(({ relativePath }) => (
      relativePath === "resources/memory/policy.json"
    )), true);
    assert.equal(manifest.members.some(({ relativePath }) => (
      relativePath === "resources/evals/acceptance-cases.json"
    )), true);
    const closure = await readPackageArchiveInventory({
      archivePath,
      expectedArchiveDigest: result.archiveDigest,
    });
    assert.equal(closure.manifestDigest, result.manifestDigest);
    assert.equal(closure.inventoryDigest, result.inventoryDigest);
    assert.deepEqual(closure.members, manifest.members);
  });

  it("rejects stale target authority and caller plugin bytes before either output exists", async () => {
    const fixture = await buildApprovedPackageFixture();
    const cases = [
      (options) => {
        options.artifacts.targetCarrierAdmission.expectedDigest = digestBytes("stale");
      },
      (options) => {
        options.pluginSourcePath = path.join(fixture.root, "plugin.js");
      },
      (options) => {
        options.pluginBytes = Buffer.from("caller-owned");
      },
    ];
    for (const [index, mutate] of cases.entries()) {
      const outputRoot = path.join(fixture.root, `rejected-${index}`);
      const archivePath = path.join(fixture.root, `rejected-${index}.d42`);
      const options = packageProduceOptions(fixture, outputRoot, archivePath);
      mutate(options);
      await assert.rejects(produceAgentPackage(options));
      await assert.rejects(access(outputRoot));
      await assert.rejects(access(archivePath));
    }
  });

  it("rejects independently drifted recipe authority before creating outputs", async () => {
    const fixture = await buildApprovedPackageFixture();
    const mutations = [
      (value) => value.nativePluginRecipe.files.reverse(),
      (value) => { value.nativePluginRecipe.files[0].relativePath = "../index.js"; },
      (value) => { value.nativePluginRecipe.files[0].mode = 0o755; },
      (value) => { value.nativePluginRecipe.files[0].content += " "; },
      (value) => { value.nativePluginRecipe.files[0].sha256 = digestBytes("member-drift"); },
      (value) => { value.nativePluginRecipe.recipeDigest = digestBytes("recipe-drift"); },
    ];
    for (const [index, mutate] of mutations.entries()) {
      const changed = structuredClone(fixture.contract);
      mutate(changed);
      const changedPath = path.join(fixture.root, `changed-contract-${index}.json`);
      const changedBytes = Buffer.from(`${JSON.stringify(changed, null, 2)}\n`, "utf8");
      await writeFile(changedPath, changedBytes);
      const outputRoot = path.join(fixture.root, `recipe-rejected-${index}`);
      const archivePath = path.join(fixture.root, `recipe-rejected-${index}.d42`);
      const options = packageProduceOptions(fixture, outputRoot, archivePath);
      options.artifacts.buildContract = {
        filePath: changedPath,
        expectedDigest: digestBytes(changedBytes),
      };
      await assert.rejects(produceAgentPackage(options));
      await assert.rejects(access(outputRoot));
      await assert.rejects(access(archivePath));
    }
  });

  it("preserves and itemizes a complete private package tree on prepublication failure", async () => {
    const fixture = await buildApprovedPackageFixture();
    const outputRoot = path.join(fixture.root, "private-recovery-package");
    const archivePath = path.join(fixture.root, "private-recovery-package.d42");
    const options = packageProduceOptions(fixture, outputRoot, archivePath);
    options.receiptDigest = `sha256:${"0".repeat(64)}`;
    let failure;

    try {
      await produceAgentPackage(options);
    } catch (error) {
      failure = error;
    }

    const privateTemp = failure?.preservedPrivateTemps?.find(
      ({ kind }) => kind === "package-directory-stage",
    );
    assert.equal(failure?.recoveryRequired, true);
    assert.equal(privateTemp?.disposition, "preserved");
    assert.equal(
      JSON.parse(await readFile(
        path.join(privateTemp.path, "agentmo.package.json"),
        "utf8",
      )).schemaVersion,
      "agentmo.package-manifest.v1",
    );
    await assert.rejects(access(outputRoot));
    await assert.rejects(access(archivePath));
  });

  it("preserves an unknown directory post-publication replacement as an orphan", async () => {
    const fixture = await buildApprovedPackageFixture();
    const outputRoot = path.join(fixture.root, "directory-replacement-package");
    const archivePath = path.join(fixture.root, "directory-replacement-package.d42");
    const preservedOwnedRoot = path.join(fixture.root, "published-package-owned");
    const sentinelBytes = Buffer.from("unknown replacement directory\n", "utf8");
    let sentinelIdentity;

    await assert.rejects(
      produceAgentPackage(
        packageProduceOptions(fixture, outputRoot, archivePath),
        {
          afterDirectoryPublication: async () => {
            await rename(outputRoot, preservedOwnedRoot);
            await mkdir(outputRoot, { mode: 0o700 });
            await writeFile(path.join(outputRoot, "unknown-sentinel"), sentinelBytes, {
              flag: "wx",
              mode: 0o600,
            });
            sentinelIdentity = await stat(outputRoot, { bigint: true });
            throw new Error("injected post-publication replacement");
          },
        },
      ),
      (error) => {
        const publication = error?.preservedPublications?.find(
          ({ kind }) => kind === "package-directory",
        );
        return error?.recoveryRequired === true
          && publication?.disposition === "preserved"
          && publication?.expectedIdentity !== undefined
          && publication?.observedIdentity !== undefined;
      },
    );

    const after = await stat(outputRoot, { bigint: true });
    assert.equal(after.dev, sentinelIdentity.dev);
    assert.equal(after.ino, sentinelIdentity.ino);
    assert.deepEqual(
      await readFile(path.join(outputRoot, "unknown-sentinel")),
      sentinelBytes,
    );
    assert.equal((await stat(preservedOwnedRoot)).isDirectory(), true);
  });

  it("itemizes a complete package tree when failure follows atomic final rename", async () => {
    const fixture = await buildApprovedPackageFixture();
    const outputRoot = path.join(fixture.root, "partial-publication-package");
    const archivePath = path.join(fixture.root, "partial-publication-package.d42");
    let createdIdentity;

    await assert.rejects(
      produceAgentPackage(
        packageProduceOptions(fixture, outputRoot, archivePath),
        {
          afterDirectoryNameCreated: async ({ identity, sourceConsumed }) => {
            createdIdentity = await stat(outputRoot, { bigint: true });
            assert.equal(String(createdIdentity.dev), identity.device);
            assert.equal(String(createdIdentity.ino), identity.inode);
            assert.equal(sourceConsumed, true);
            assert.equal(
              JSON.parse(await readFile(
                path.join(outputRoot, "agentmo.package.json"),
                "utf8",
              )).schemaVersion,
              "agentmo.package-manifest.v1",
            );
            throw new Error("injected failure after complete package rename");
          },
        },
      ),
      (error) => {
        const publication = error?.preservedPublications?.find(
          ({ kind }) => kind === "package-directory",
        );
        return error?.recoveryRequired === true
          && publication?.disposition === "preserved"
          && publication?.expectedIdentity?.inode === String(createdIdentity?.ino)
          && publication?.observedIdentity?.inode === String(createdIdentity?.ino);
      },
    );

    const after = await stat(outputRoot, { bigint: true });
    assert.equal(after.dev, createdIdentity.dev);
    assert.equal(after.ino, createdIdentity.ino);
    await assert.rejects(access(archivePath));
  });

  it("preserves an unknown archive post-publication replacement as an orphan", async () => {
    const fixture = await buildApprovedPackageFixture();
    const outputRoot = path.join(fixture.root, "archive-replacement-package");
    const archivePath = path.join(fixture.root, "archive-replacement-package.d42");
    const preservedOwnedArchive = path.join(fixture.root, "published-archive-owned.d42");
    const sentinelBytes = Buffer.from("unknown replacement archive\n", "utf8");
    let sentinelIdentity;

    await assert.rejects(
      produceAgentPackage(
        packageProduceOptions(fixture, outputRoot, archivePath),
        {
          afterArchivePublication: async () => {
            await rename(archivePath, preservedOwnedArchive);
            await writeFile(archivePath, sentinelBytes, { flag: "wx", mode: 0o600 });
            sentinelIdentity = await stat(archivePath, { bigint: true });
            throw new Error("injected post-publication replacement");
          },
        },
      ),
      (error) => {
        const publication = error?.preservedPublications?.find(
          ({ kind }) => kind === "package-archive",
        );
        return error?.recoveryRequired === true
          && publication?.disposition === "preserved"
          && publication?.expectedIdentity !== undefined
          && publication?.observedIdentity !== undefined;
      },
    );

    const after = await stat(archivePath, { bigint: true });
    assert.equal(after.dev, sentinelIdentity.dev);
    assert.equal(after.ino, sentinelIdentity.ino);
    assert.deepEqual(await readFile(archivePath), sentinelBytes);
    assert.notDeepEqual(await readFile(preservedOwnedArchive), sentinelBytes);
  });

  it("itemizes a complete private archive when helper admission fails after package publication", async () => {
    const fixture = await buildApprovedPackageFixture();
    const outputRoot = path.join(fixture.root, "archive-private-recovery-package");
    const archivePath = path.join(fixture.root, "archive-private-recovery-package.d42");
    const options = packageProduceOptions(fixture, outputRoot, archivePath);

    let failure;
    try {
      await produceAgentPackage(options, {
        afterDirectoryPublication: async () => {
          options.receiptDigest = `sha256:${"0".repeat(64)}`;
        },
      });
    } catch (error) {
      failure = error;
    }
    const publication = failure?.preservedPublications?.find(
      ({ kind }) => kind === "package-directory",
    );
    const privateTemp = failure?.preservedPrivateTemps?.find(
      ({ kind }) => kind === "package-archive-stage",
    );
    assert.equal(failure?.recoveryRequired, true);
    assert.equal(publication?.disposition, "preserved");
    assert.equal(privateTemp?.disposition, "preserved");
    assert.equal((await readFile(privateTemp.path)).length > 0, true);
    assert.equal((await stat(outputRoot)).isDirectory(), true);
    await assert.rejects(access(archivePath));
  });

  it("fails closed and itemizes nested member mutation after archive build", async () => {
    const fixture = await buildApprovedPackageFixture();
    const outputRoot = path.join(fixture.root, "nested-mutation-package");
    const archivePath = path.join(fixture.root, "nested-mutation-package.d42");
    let changedMemberPath;
    let failure;

    try {
      await produceAgentPackage(
        packageProduceOptions(fixture, outputRoot, archivePath),
        {
          afterArchiveBuild: async ({ stageRoot }) => {
            changedMemberPath = path.join(
              stageRoot,
              "resources",
              "prompts",
              "system.md",
            );
            await writeFile(
              changedMemberPath,
              Buffer.from("same-uid nested mutation\n", "utf8"),
            );
          },
        },
      );
    } catch (error) {
      failure = error;
    }

    const privateTemp = failure?.preservedPrivateTemps?.find(
      ({ kind }) => kind === "package-directory-stage",
    );
    assert.equal(failure?.recoveryRequired, true);
    assert.equal(privateTemp?.disposition, "preserved");
    assert.equal(privateTemp?.observation, "mismatch");
    assert.equal(privateTemp?.reason, "private-temp-closure-mismatch");
    assert.match(privateTemp?.expectedDigest ?? "", /^sha256:[a-f0-9]{64}$/u);
    assert.match(privateTemp?.observedDigest ?? "", /^sha256:[a-f0-9]{64}$/u);
    assert.equal(await readFile(changedMemberPath, "utf8"), "same-uid nested mutation\n");
    await assert.rejects(access(outputRoot));
    await assert.rejects(access(archivePath));
  });

  it("emits recovery evidence for every missing replaced denied or malformed private temp", async () => {
    const fixture = await buildApprovedPackageFixture();
    const cases = [
      {
        label: "missing",
        async mutate(stageRoot) {
          await rename(stageRoot, `${stageRoot}.preserved-missing`);
        },
      },
      {
        label: "replaced",
        async mutate(stageRoot) {
          await rename(stageRoot, `${stageRoot}.preserved-replaced`);
          await mkdir(stageRoot, { mode: 0o700 });
          await writeFile(
            path.join(stageRoot, "replacement-sentinel"),
            "replacement\n",
          );
        },
      },
      {
        label: "permission",
        async mutate(stageRoot) {
          await chmod(stageRoot, 0o000);
        },
        async restore(row) {
          await chmod(row.path, 0o700);
        },
      },
      {
        label: "malformed",
        async mutate(stageRoot) {
          await rename(stageRoot, `${stageRoot}.preserved-malformed`);
          await writeFile(stageRoot, "not-a-directory\n");
        },
      },
    ];

    for (const [index, attack] of cases.entries()) {
      const outputRoot = path.join(fixture.root, `temp-${attack.label}-${index}`);
      const archivePath = `${outputRoot}.d42`;
      let failure;
      try {
        await produceAgentPackage(
          packageProduceOptions(fixture, outputRoot, archivePath),
          {
            afterArchiveBuild: async ({ stageRoot }) => {
              await attack.mutate(stageRoot);
              throw new Error(`injected ${attack.label} temp observation`);
            },
          },
        );
      } catch (error) {
        failure = error;
      }

      const rows = failure?.preservedPrivateTemps ?? [];
      const directoryRow = rows.find(
        ({ kind }) => kind === "package-directory-stage",
      );
      const archiveRow = rows.find(
        ({ kind }) => kind === "package-archive-stage",
      );
      assert.equal(failure?.recoveryRequired, true, attack.label);
      assert.equal(directoryRow?.type, "directory", attack.label);
      assert.equal(directoryRow?.observation, "unknown", attack.label);
      assert.equal(directoryRow?.disposition, "unknown", attack.label);
      assert.equal(directoryRow?.observedDigest, null, attack.label);
      assert.ok(directoryRow?.expectedIdentity, attack.label);
      assert.equal(archiveRow?.type, "file", attack.label);
      assert.equal(archiveRow?.observation, "unknown", attack.label);
      assert.equal(archiveRow?.disposition, "unknown", attack.label);
      await attack.restore?.(directoryRow);
      await assert.rejects(access(outputRoot));
      await assert.rejects(access(archivePath));
    }
  });

  it("itemizes an archive when failure follows atomic final rename", async () => {
    const fixture = await buildApprovedPackageFixture();
    const outputRoot = path.join(fixture.root, "archive-link-window-package");
    const archivePath = path.join(fixture.root, "archive-link-window-package.d42");
    let linkedIdentity;

    await assert.rejects(
      produceAgentPackage(
        packageProduceOptions(fixture, outputRoot, archivePath),
        {
          afterArchiveNameCreated: async ({ identity, sourceConsumed }) => {
            linkedIdentity = await stat(archivePath, { bigint: true });
            assert.equal(String(linkedIdentity.dev), identity.device);
            assert.equal(String(linkedIdentity.ino), identity.inode);
            assert.equal(linkedIdentity.nlink, 1n);
            assert.equal(sourceConsumed, true);
            throw new Error("injected failure after archive atomic rename");
          },
        },
      ),
      (error) => {
        const publication = error?.preservedPublications?.find(
          ({ kind }) => kind === "package-archive",
        );
        return error?.recoveryRequired === true
          && publication?.disposition === "preserved"
          && publication?.expectedIdentity?.inode === String(linkedIdentity?.ino)
          && publication?.observedIdentity?.inode === String(linkedIdentity?.ino);
      },
    );

    const after = await stat(archivePath, { bigint: true });
    assert.equal(after.dev, linkedIdentity.dev);
    assert.equal(after.ino, linkedIdentity.ino);
    assert.equal(after.nlink, 1n);
    assert.equal((await readFile(archivePath)).length > 0, true);
  });
});
