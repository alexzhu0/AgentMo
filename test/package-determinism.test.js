import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { it } from "node:test";
import {
  produceAgentPackage,
} from "../src/package-produce.js";
import {
  buildPackageArchive,
  readPackageArchiveInventory,
} from "../src/package-archive.js";
import {
  buildApprovedPackageFixture,
  packageProduceOptions,
} from "./helpers/package-produce-fixture.js";

it("builds byte-identical directories and archives under different roots", async () => {
  const left = await buildApprovedPackageFixture();
  const right = left;
  const leftRoot = path.join(left.root, "left-package");
  const rightRoot = path.join(right.root, "right-package");
  const leftArchive = path.join(left.root, "left.d42");
  const rightArchive = path.join(right.root, "right.d42");
  const leftResult = await produceAgentPackage(
    packageProduceOptions(left, leftRoot, leftArchive),
  );
  const rightResult = await produceAgentPackage(
    packageProduceOptions(right, rightRoot, rightArchive),
  );
  assert.equal(leftResult.manifestDigest, rightResult.manifestDigest);
  assert.equal(leftResult.inventoryDigest, rightResult.inventoryDigest);
  assert.equal(leftResult.archiveDigest, rightResult.archiveDigest);
  assert.deepEqual(await readFile(leftArchive), await readFile(rightArchive));
  assert.deepEqual(
    await readPackageArchiveInventory({
      archivePath: leftArchive,
      expectedArchiveDigest: leftResult.archiveDigest,
    }),
    await readPackageArchiveInventory({
      archivePath: rightArchive,
      expectedArchiveDigest: rightResult.archiveDigest,
    }),
  );
  const rebuilt = await buildPackageArchive({ packageRoot: leftRoot });
  assert.deepEqual(rebuilt.bytes, await readFile(leftArchive));
});

it("rejects archive content, member-set, type, mode, and manifest-binding drift", async () => {
  const fixture = await buildApprovedPackageFixture();
  const outputRoot = path.join(fixture.root, "package");
  const archivePath = path.join(fixture.root, "package.d42");
  await produceAgentPackage(packageProduceOptions(fixture, outputRoot, archivePath));
  const archive = JSON.parse(await readFile(archivePath, "utf8"));
  const mutations = [
    (value) => { value.members[0].contentBase64 = Buffer.from("drift").toString("base64"); },
    (value) => { value.members.pop(); },
    (value) => { value.members[0].type = "symlink"; },
    (value) => { value.members[0].mode = 0o755; },
    (value) => { value.manifestDigest = value.members[0].sha256; },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const changed = structuredClone(archive);
    mutate(changed);
    const changedBytes = Buffer.from(`${JSON.stringify(changed, null, 2)}\n`, "utf8");
    const changedPath = path.join(fixture.root, `archive-drift-${index}.d42`);
    await import("node:fs/promises").then(({ writeFile }) => writeFile(changedPath, changedBytes));
    await assert.rejects(readPackageArchiveInventory({
      archivePath: changedPath,
      expectedArchiveDigest: (
        await import("./helpers/package-produce-fixture.js")
      ).digestBytes(changedBytes),
    }));
  }
});
