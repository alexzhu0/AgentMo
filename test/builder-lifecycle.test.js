import assert from "node:assert/strict";
import {
  cp,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { digestRawBytes } from "../src/artifact-admission.js";
import {
  applyBuilderInstall,
  planBuilderInstall,
} from "../src/builder-install.js";
import {
  BUILDER_NPM_METADATA_FILES,
  BUILDER_RELEASE_ASSET_INVENTORY,
} from "../src/builder-package.js";
import {
  applyBuilderDeactivate,
  applyBuilderHostProjectionMigration,
  applyBuilderHostProjectionTransfer,
  applyBuilderHostSelectorRemoval,
  applyBuilderUpgrade,
  planBuilderDeactivate,
  planBuilderHostProjectionMigration,
  planBuilderHostProjectionTransfer,
  planBuilderHostSelectorRemoval,
  planBuilderUpgrade,
  readBuilderLifecycleState,
} from "../src/builder-lifecycle.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RECEIPT = ".agentmo/builder/install-receipt.json";
const AGENT = ".codex/agents/agentmo.toml";

function probe() {
  return {
    schemaVersion: "agentmo.builder-probe.v1",
    adapter: { id: "codex" },
    host: { version: "0.144.2" },
    mutatesHost: "unknown",
    externalCommandMutation: "unknown",
    observations: [
      { id: "codex-cli", requirement: "required", status: "observed" },
      { id: "native-hooks", requirement: "required", status: "observed" },
      { id: "plugin-distribution", requirement: "required", status: "observed" },
      { id: "session-resume", requirement: "required", status: "observed" },
    ],
    required: { ok: true, missing: [], incompatible: [] },
  };
}

async function installProject() {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "agentmo-lifecycle-security-"));
  const compatible = probe();
  const preview = await planBuilderInstall({ projectRoot, probe: compatible });
  const installed = await applyBuilderInstall({
    projectRoot,
    probe: compatible,
    expectedPlanDigest: preview.planDigest,
  });
  return { projectRoot, compatible, installed };
}

async function upgradedPackage() {
  const packageRoot = await mkdtemp(path.join(tmpdir(), "agentmo-lifecycle-successor-"));
  for (const relativePath of [
    ...BUILDER_RELEASE_ASSET_INVENTORY.map((asset) => asset.sourcePath),
    ...BUILDER_NPM_METADATA_FILES,
  ]) {
    const destination = path.join(packageRoot, ...relativePath.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(REPO_ROOT, ...relativePath.split("/")), destination);
  }
  const manifest = JSON.parse(await readFile(path.join(REPO_ROOT, "package.json"), "utf8"));
  manifest.version = "0.2.0";
  await writeFile(path.join(packageRoot, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const pluginManifestPath = path.join(packageRoot, "plugin/.codex-plugin/plugin.json");
  const pluginManifest = JSON.parse(await readFile(pluginManifestPath, "utf8"));
  pluginManifest.version = "0.2.0";
  await writeFile(pluginManifestPath, `${JSON.stringify(pluginManifest, null, 2)}\n`);
  return packageRoot;
}

function absolute(projectRoot, relativePath) {
  return path.join(projectRoot, ...relativePath.split("/"));
}

function rejection(code) {
  return (error) => error?.code === code;
}

describe("append-only Builder lifecycle hostile boundaries", () => {
  it("rejects modified or extra-linked genesis bytes without moving either inode", async () => {
    const modified = await installProject();
    const receiptBefore = await readFile(absolute(modified.projectRoot, RECEIPT));
    await writeFile(absolute(modified.projectRoot, AGENT), "foreign user bytes\n");
    const foreignBefore = await stat(absolute(modified.projectRoot, AGENT), { bigint: true });
    await assert.rejects(
      planBuilderDeactivate({
        projectRoot: modified.projectRoot,
        expectedReceiptDigest: modified.installed.receipt.digest,
      }),
      rejection("AGENTMO_BUILDER_LIFECYCLE_INSTALLED_BYTES_CHANGED"),
    );
    const foreignAfter = await stat(absolute(modified.projectRoot, AGENT), { bigint: true });
    assert.equal(foreignAfter.ino, foreignBefore.ino);
    assert.deepEqual(await readFile(absolute(modified.projectRoot, RECEIPT)), receiptBefore);

    const linked = await installProject();
    const neighbor = path.join(linked.projectRoot, "agent-neighbor.toml");
    await link(absolute(linked.projectRoot, AGENT), neighbor);
    const agentBefore = await stat(absolute(linked.projectRoot, AGENT), { bigint: true });
    await assert.rejects(
      planBuilderDeactivate({
        projectRoot: linked.projectRoot,
        expectedReceiptDigest: linked.installed.receipt.digest,
      }),
      rejection("AGENTMO_BUILDER_LIFECYCLE_INSTALLED_BYTES_CHANGED"),
    );
    assert.equal((await stat(neighbor, { bigint: true })).ino, agentBefore.ino);
    assert.equal((await stat(absolute(linked.projectRoot, AGENT), { bigint: true })).ino, agentBefore.ino);
  });

  it("rejects a stale deactivation plan after one exact tombstone wins", async () => {
    const { projectRoot, installed } = await installProject();
    const preview = await planBuilderDeactivate({
      projectRoot,
      expectedReceiptDigest: installed.receipt.digest,
    });
    await applyBuilderDeactivate({
      projectRoot,
      expectedReceiptDigest: installed.receipt.digest,
      expectedPlanDigest: preview.planDigest,
    });
    await assert.rejects(
      applyBuilderDeactivate({
        projectRoot,
        expectedReceiptDigest: installed.receipt.digest,
        expectedPlanDigest: preview.planDigest,
      }),
      rejection("AGENTMO_BUILDER_LIFECYCLE_PLAN_CHANGED"),
    );
    assert.equal((await readBuilderLifecycleState({ projectRoot })).tombstones.length, 1);
  });

  it("preserves a foreign successor occupant even when its bytes match", async () => {
    const { projectRoot, compatible, installed } = await installProject();
    const packageRoot = await upgradedPackage();
    const preview = await planBuilderUpgrade({
      projectRoot,
      probe: compatible,
      packageOptions: { packageRoot },
      expectedReceiptDigest: installed.receipt.digest,
    });
    const operation = preview.operations.find((entry) => (
      entry.operation === "publish-immutable"
      && entry.relativePath.endsWith("/package/bin/agentmo.js")
    ));
    assert.ok(operation);
    const target = absolute(projectRoot, operation.relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    const bytes = await readFile(path.join(packageRoot, "bin/agentmo.js"));
    await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
    const before = await stat(target, { bigint: true });
    await assert.rejects(
      applyBuilderUpgrade({
        projectRoot,
        probe: compatible,
        packageOptions: { packageRoot },
        expectedReceiptDigest: installed.receipt.digest,
        expectedPlanDigest: preview.planDigest,
      }),
      rejection("AGENTMO_BUILDER_IMMUTABLE_RELEASE_WRITE_FAILED"),
    );
    const after = await stat(target, { bigint: true });
    assert.equal(after.ino, before.ino);
    assert.equal(digestRawBytes(await readFile(target)), digestRawBytes(bytes));
    assert.equal((await readBuilderLifecycleState({ projectRoot })).activeReceiptDigest, installed.receipt.digest);
  });

  it("rejects an extra hard link to an activated successor", async () => {
    const { projectRoot, compatible, installed } = await installProject();
    const packageRoot = await upgradedPackage();
    const preview = await planBuilderUpgrade({
      projectRoot,
      probe: compatible,
      packageOptions: { packageRoot },
      expectedReceiptDigest: installed.receipt.digest,
    });
    const upgraded = await applyBuilderUpgrade({
      projectRoot,
      probe: compatible,
      packageOptions: { packageRoot },
      expectedReceiptDigest: installed.receipt.digest,
      expectedPlanDigest: preview.planDigest,
    });
    await link(absolute(projectRoot, upgraded.receipt.path), path.join(projectRoot, "extra-receipt-link"));
    await assert.rejects(
      readBuilderLifecycleState({ projectRoot }),
      rejection("AGENTMO_BUILDER_IMMUTABLE_RELEASE_CHANGED"),
    );
  });

  it("rejects successor replay through a symlinked or rebound release parent even with unchanged leaf inodes", async () => {
    for (const [label, replaceParent] of [
      ["symlinked", async (releaseRoot, retainedRoot) => {
        await rename(releaseRoot, retainedRoot);
        await symlink(retainedRoot, releaseRoot);
      }],
      ["rebound", async (releaseRoot, retainedRoot) => {
        await rename(releaseRoot, retainedRoot);
        await mkdir(releaseRoot, { mode: 0o700 });
        for (const name of await readdir(retainedRoot)) {
          await rename(path.join(retainedRoot, name), path.join(releaseRoot, name));
        }
      }],
    ]) {
      const { projectRoot, compatible, installed } = await installProject();
      const packageRoot = await upgradedPackage();
      const preview = await planBuilderUpgrade({
        projectRoot,
        probe: compatible,
        packageOptions: { packageRoot },
        expectedReceiptDigest: installed.receipt.digest,
      });
      const upgraded = await applyBuilderUpgrade({
        projectRoot,
        probe: compatible,
        packageOptions: { packageRoot },
        expectedReceiptDigest: installed.receipt.digest,
        expectedPlanDigest: preview.planDigest,
      });
      const state = await readBuilderLifecycleState({ projectRoot });
      const leaves = state.activeReceipt.files.flatMap((file) => [
        file.relativePath,
        file.stagePath,
      ]);
      const before = new Map(await Promise.all(leaves.map(async (relativePath) => {
        const metadata = await stat(absolute(projectRoot, relativePath), { bigint: true });
        return [relativePath, {
          dev: metadata.dev,
          ino: metadata.ino,
          nlink: metadata.nlink,
        }];
      })));
      const releaseRoot = path.dirname(absolute(projectRoot, upgraded.receipt.path));
      await replaceParent(releaseRoot, `${releaseRoot}-${label}-retained`);
      for (const relativePath of leaves) {
        const metadata = await stat(absolute(projectRoot, relativePath), { bigint: true });
        assert.deepEqual(
          { dev: metadata.dev, ino: metadata.ino, nlink: metadata.nlink },
          before.get(relativePath),
          `${label}: ${relativePath} leaf identity changed`,
        );
      }
      await assert.rejects(
        readBuilderLifecycleState({ projectRoot }),
        rejection("AGENTMO_BUILDER_IMMUTABLE_RELEASE_CHANGED"),
        label,
      );
    }
  });

  it("keeps every v1 physical-removal and host rebind API unavailable", async () => {
    const calls = [
      planBuilderHostSelectorRemoval,
      applyBuilderHostSelectorRemoval,
      planBuilderHostProjectionMigration,
      applyBuilderHostProjectionMigration,
      planBuilderHostProjectionTransfer,
      applyBuilderHostProjectionTransfer,
    ];
    for (const call of calls) {
      await assert.rejects(call({}), rejection("AGENTMO_BUILDER_V1_PHYSICAL_REMOVAL_UNSUPPORTED"));
    }
  });
});
