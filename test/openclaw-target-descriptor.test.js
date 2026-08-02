import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
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
  OPENCLAW_TARGET_DESCRIPTOR_SCHEMA_VERSION,
  buildOpenClawTargetDescriptor,
  validateOpenClawTargetDescriptor,
  writeOpenClawTargetDescriptor,
} from "../src/openclaw-target-descriptor.js";
import {
  getOpenClawFsPublicationFixture,
} from "./helpers/build-contract-fixture.js";

const sha256 = (bytes) => (
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`
);

async function makeTarget() {
  const root = await mkdtemp(path.join(tmpdir(), "agentmo-openclaw-descriptor-"));
  const executablePath = path.join(root, "openclaw.mjs");
  const packageJsonPath = path.join(root, "package.json");
  const buildInfoPath = path.join(root, "dist", "build-info.json");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.dirname(buildInfoPath));
  await writeFile(executablePath, "#!/usr/bin/env node\n", { mode: 0o755 });
  await writeFile(packageJsonPath, `${JSON.stringify({
    name: "openclaw",
    version: "2026.7.1-2",
    engines: {
      node: ">=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0",
    },
  }, null, 2)}\n`);
  await writeFile(buildInfoPath, `${JSON.stringify({
    version: "2026.7.1-2",
    commit: "0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c",
    builtAt: "2026-07-28T00:00:00.000Z",
  }, null, 2)}\n`);
  return { root, executablePath, packageJsonPath, buildInfoPath };
}

async function descriptorOptions(target) {
  return {
    executablePath: target.executablePath,
    packageJsonPath: target.packageJsonPath,
    buildInfoPath: target.buildInfoPath,
    digests: {
      "target-executable": sha256(await readFile(target.executablePath)),
      "target-package-json": sha256(await readFile(target.packageJsonPath)),
      "target-build-info": sha256(await readFile(target.buildInfoPath)),
    },
  };
}

describe("OpenClaw exact target descriptor", () => {
  it("derives a closed value-blind descriptor from exact first-party bytes", async () => {
    const target = await makeTarget();
    const descriptor = await buildOpenClawTargetDescriptor(await descriptorOptions(target));

    assert.equal(
      descriptor.schemaVersion,
      OPENCLAW_TARGET_DESCRIPTOR_SCHEMA_VERSION,
    );
    assert.deepEqual(descriptor.target, {
      id: "openclaw",
      version: "2026.7.1-2",
      sourceRevision: "0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c",
      displayRevision: "0790d9f",
      nodeRange: ">=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0",
    });
    assert.deepEqual(
      descriptor.members.map(({ relativePath }) => relativePath),
      ["dist/build-info.json", "openclaw.mjs", "package.json"],
    );
    assert.equal(
      descriptor.members.find(({ relativePath }) => relativePath === "openclaw.mjs").sha256,
      sha256(await readFile(target.executablePath)),
    );
    assert.equal(JSON.stringify(descriptor).includes(target.root), false);
    assert.equal(validateOpenClawTargetDescriptor(descriptor).ok, true);
    assert.deepEqual(descriptor.certificationBoundary, {
      targetIdentityObservationOnly: true,
      sourceQuality: false,
      packageBuilt: false,
      installedByAgentMo: false,
      runtime: false,
      domain: false,
      production: false,
    });
  });

  it("rejects caller identity claims, cross-root members, symlinks and byte drift", async () => {
    const target = await makeTarget();
    await assert.rejects(
      buildOpenClawTargetDescriptor({
        ...await descriptorOptions(target),
        version: "2026.7.1-2",
      }),
      (error) => error?.code === "AGENTMO_OPENCLAW_TARGET_DESCRIPTOR_INPUT_INVALID",
    );

    const other = await makeTarget();
    await assert.rejects(
      buildOpenClawTargetDescriptor({
        ...await descriptorOptions(target),
        buildInfoPath: other.buildInfoPath,
      }),
    );

    const descriptor = await buildOpenClawTargetDescriptor(await descriptorOptions(target));
    const changed = structuredClone(descriptor);
    changed.target.nodeRange = ">=0";
    assert.equal(validateOpenClawTargetDescriptor(changed).ok, false);
  });

  it("writes canonical bytes create-only and never accepts a forged candidate", async () => {
    const target = await makeTarget();
    const descriptor = await buildOpenClawTargetDescriptor(await descriptorOptions(target));
    const output = path.join(target.root, "target-descriptor.json");
    const publication = await getOpenClawFsPublicationFixture();
    await assert.rejects(writeOpenClawTargetDescriptor(output, descriptor));
    await writeOpenClawTargetDescriptor(output, descriptor, publication);
    await assert.rejects(writeOpenClawTargetDescriptor(output, descriptor, publication));
    await assert.rejects(
      writeOpenClawTargetDescriptor(
        path.join(target.root, "forged.json"),
        structuredClone(descriptor),
        publication,
      ),
    );
  });

  it("preserves and itemizes complete private bytes when helper admission fails before publication", async () => {
    const target = await makeTarget();
    const descriptor = await buildOpenClawTargetDescriptor(await descriptorOptions(target));
    const output = path.join(target.root, "target-descriptor-helper-rejected.json");
    const publication = await getOpenClawFsPublicationFixture();

    let failure;
    try {
      await writeOpenClawTargetDescriptor(output, descriptor, {
        ...publication,
        receiptDigest: `sha256:${"0".repeat(64)}`,
      });
    } catch (error) {
      failure = error;
    }
    const privateTemp = failure?.preservedPrivateTemps?.[0];
    assert.equal(failure?.recoveryRequired, true);
    assert.equal(privateTemp?.kind, "openclaw-target-descriptor");
    assert.equal(privateTemp?.disposition, "preserved");
    assert.equal(
      JSON.parse(await readFile(privateTemp.path, "utf8")).schemaVersion,
      OPENCLAW_TARGET_DESCRIPTOR_SCHEMA_VERSION,
    );
    await assert.rejects(() => stat(output));
  });

  it("preserves an unknown descriptor post-publication replacement", async () => {
    const target = await makeTarget();
    const descriptor = await buildOpenClawTargetDescriptor(await descriptorOptions(target));
    const output = path.join(target.root, "target-descriptor-replaced.json");
    const preservedOwned = path.join(target.root, "target-descriptor-owned.json");
    const sentinelBytes = Buffer.from('{"unknown":"descriptor replacement"}\n', "utf8");
    let sentinelIdentity;
    const publication = await getOpenClawFsPublicationFixture();

    await assert.rejects(
      writeOpenClawTargetDescriptor(output, descriptor, publication, {
        afterPublication: async () => {
          await rename(output, preservedOwned);
          await writeFile(output, sentinelBytes, { flag: "wx", mode: 0o600 });
          sentinelIdentity = await stat(output, { bigint: true });
          throw new Error("injected descriptor post-publication replacement");
        },
      }),
      (error) => {
        const publication = error?.preservedPublications?.[0];
        return error?.recoveryRequired === true
          && publication?.kind === "openclaw-target-descriptor"
          && publication?.disposition === "preserved"
          && publication?.expectedIdentity !== undefined
          && publication?.observedIdentity !== undefined;
      },
    );

    const after = await stat(output, { bigint: true });
    assert.equal(after.dev, sentinelIdentity.dev);
    assert.equal(after.ino, sentinelIdentity.ino);
    assert.deepEqual(await readFile(output), sentinelBytes);
    assert.notDeepEqual(await readFile(preservedOwned), sentinelBytes);
  });

  it("itemizes a descriptor when failure follows atomic final rename", async () => {
    const target = await makeTarget();
    const descriptor = await buildOpenClawTargetDescriptor(await descriptorOptions(target));
    const output = path.join(target.root, "target-descriptor-link-window.json");
    let linkedIdentity;
    const publicationAuthority = await getOpenClawFsPublicationFixture();

    await assert.rejects(
      writeOpenClawTargetDescriptor(output, descriptor, publicationAuthority, {
        afterNameCreated: async ({ expectedIdentity, sourceConsumed }) => {
          linkedIdentity = await stat(output, { bigint: true });
          assert.equal(String(linkedIdentity.dev), expectedIdentity.device);
          assert.equal(String(linkedIdentity.ino), expectedIdentity.inode);
          assert.equal(linkedIdentity.nlink, 1n);
          assert.equal(sourceConsumed, true);
          throw new Error("injected descriptor atomic-rename window failure");
        },
      }),
      (error) => {
        const publication = error?.preservedPublications?.[0];
        return error?.recoveryRequired === true
          && publication?.kind === "openclaw-target-descriptor"
          && publication?.expectedIdentity?.inode === String(linkedIdentity?.ino)
          && publication?.observedIdentity?.inode === String(linkedIdentity?.ino);
      },
    );

    const after = await stat(output, { bigint: true });
    assert.equal(after.dev, linkedIdentity.dev);
    assert.equal(after.ino, linkedIdentity.ino);
    assert.equal(after.nlink, 1n);
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), descriptor);
  });
});
