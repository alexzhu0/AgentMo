import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmod,
  cp,
  link,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  formatAgentPackageInspection,
  inspectAgentPackage,
} from "../src/package-inspect.js";
import { produceAgentPackage } from "../src/package-produce.js";
import { serializePersistableJson } from "../src/persistability.js";
import {
  buildApprovedPackageFixture,
  digestBytes,
  packageProduceOptions,
} from "./helpers/package-produce-fixture.js";

const CLI = path.resolve("bin/agentmo.js");

describe("offline Agent Package inspection", () => {
  it("returns one frozen value-blind candidate for directory, archive, human, and JSON views", async () => {
    const fixture = await buildApprovedPackageFixture();
    const packageRoot = path.join(fixture.root, "package");
    const archivePath = path.join(fixture.root, "package.d42");
    const produced = await produceAgentPackage(
      packageProduceOptions(fixture, packageRoot, archivePath),
    );
    const stateSentinel = path.join(fixture.root, "openclaw-state-sentinel.json");
    const sentinelBytes = Buffer.from('{"mustRemain":"unchanged"}\n', "utf8");
    await writeFile(stateSentinel, sentinelBytes);

    const directoryCandidate = await inspectAgentPackage({
      packagePath: packageRoot,
      expectedManifestDigest: produced.manifestDigest,
    });
    const archiveCandidate = await inspectAgentPackage({
      packagePath: archivePath,
      expectedArchiveDigest: produced.archiveDigest,
    });
    assert.deepEqual(directoryCandidate, archiveCandidate);
    assert.equal(Object.isFrozen(directoryCandidate), true);
    assert.equal(Object.isFrozen(directoryCandidate.files), true);
    assert.equal(directoryCandidate.transport.archiveDigest, produced.archiveDigest);
    assert.equal(directoryCandidate.manifest.manifestDigest, produced.manifestDigest);
    assert.equal(directoryCandidate.manifest.inventoryDigest, produced.inventoryDigest);
    assert.equal(directoryCandidate.files.length, 40);
    assert.equal(directoryCandidate.carriers.length, 26);
    assert.equal(directoryCandidate.permissions.length > 0, true);
    assert.equal(directoryCandidate.sensitiveActions.length > 0, true);
    assert.equal(directoryCandidate.targetOperations.length, directoryCandidate.carriers.length);
    assert.deepEqual(directoryCandidate.conflicts, {
      evaluated: false,
      items: [],
      reason: "offline-inspection-does-not-observe-target-state",
    });
    assert.deepEqual(directoryCandidate.certificationBoundary, {
      packageClosureVerified: true,
      installed: false,
      runtime: false,
      domain: false,
      birth: false,
      delivery: false,
      production: false,
    });

    const human = formatAgentPackageInspection(directoryCandidate);
    assert.deepEqual(parseHumanInspection(human), directoryCandidate);
    assert.equal(human.includes(fixture.root), false);
    assert.equal(human.includes(stateSentinel), false);
    assert.deepEqual(await readFile(stateSentinel), sentinelBytes);
  });

  it("exposes semantically identical fresh-process human and JSON inspection", async () => {
    const fixture = await buildApprovedPackageFixture();
    const packageRoot = path.join(fixture.root, "cli-package");
    const archivePath = path.join(fixture.root, "cli-package.d42");
    const produced = await produceAgentPackage(
      packageProduceOptions(fixture, packageRoot, archivePath),
    );
    const common = [
      CLI,
      "package-inspect",
      archivePath,
      "--archive-sha256",
      produced.archiveDigest,
    ];
    const json = spawnSync(process.execPath, [...common, "--json"], {
      cwd: path.resolve("."),
      encoding: "utf8",
      env: { PATH: process.env.PATH, TZ: "UTC", LANG: "C" },
    });
    const human = spawnSync(process.execPath, common, {
      cwd: path.resolve("."),
      encoding: "utf8",
      env: { PATH: process.env.PATH, TZ: "UTC", LANG: "C" },
    });
    assert.equal(json.status, 0, json.stderr || json.stdout);
    assert.equal(human.status, 0, human.stderr || human.stdout);
    assert.equal(json.stderr, "");
    assert.equal(human.stderr, "");
    assert.deepEqual(parseHumanInspection(human.stdout), JSON.parse(json.stdout));
    assert.equal(json.stdout.includes(fixture.root), false);
    assert.equal(human.stdout.includes(fixture.root), false);

    const directory = spawnSync(process.execPath, [
      CLI,
      "package-inspect",
      packageRoot,
      "--manifest-sha256",
      produced.manifestDigest,
      "--json",
    ], {
      cwd: path.resolve("."),
      encoding: "utf8",
      env: { PATH: process.env.PATH, TZ: "UTC", LANG: "C" },
    });
    assert.equal(directory.status, 0, directory.stderr || directory.stdout);
    assert.deepEqual(JSON.parse(directory.stdout), JSON.parse(json.stdout));
  });

  it("rejects every archive closure mutation before any target effect", async () => {
    const fixture = await buildApprovedPackageFixture();
    const packageRoot = path.join(fixture.root, "archive-package");
    const archivePath = path.join(fixture.root, "archive-package.d42");
    const produced = await produceAgentPackage(
      packageProduceOptions(fixture, packageRoot, archivePath),
    );
    const archiveBytes = await readFile(archivePath);
    const archive = JSON.parse(archiveBytes);
    const sentinel = path.join(fixture.root, "target-state.json");
    const sentinelBytes = Buffer.from('{"owner":"operator"}\n', "utf8");
    await writeFile(sentinel, sentinelBytes);

    await assert.rejects(
      inspectAgentPackage({
        packagePath: archivePath,
        expectedArchiveDigest: digestBytes("wrong-external-digest"),
      }),
      boundedInspectError,
    );

    const mutations = [
      (value) => { value.manifestDigest = value.members[0].sha256; },
      (value) => { value.inventoryDigest = value.members[0].sha256; },
      (value) => { value.members[0].contentBase64 = Buffer.from("drift").toString("base64"); },
      (value) => { value.members.push(structuredClone(value.members[0])); },
      (value) => { value.members.pop(); },
      (value) => { value.members[0].type = "symlink"; },
      (value) => { value.members[0].mode = 0o755; },
      (value) => { value.members[0].byteLength += 1; },
      (value) => { value.members[0].sha256 = digestBytes("member-digest-drift"); },
      (value) => { value.members[0].relativePath = "../escape"; },
      (value) => { value.members.reverse(); },
      (value) => {
        const manifestText = Buffer.from(value.manifestContentBase64, "base64").toString("utf8");
        const duplicate = manifestText.replace(
          '"schemaVersion": "agentmo.package-manifest.v1",',
          '"schemaVersion": "agentmo.package-manifest.v1",\n  "schemaVersion": "agentmo.package-manifest.v1",',
        );
        const bytes = Buffer.from(duplicate, "utf8");
        value.manifestContentBase64 = bytes.toString("base64");
        value.manifestDigest = digestBytes(bytes);
      },
    ];
    for (const [index, mutate] of mutations.entries()) {
      const changed = structuredClone(archive);
      mutate(changed);
      const changedBytes = Buffer.from(`${JSON.stringify(changed, null, 2)}\n`, "utf8");
      const changedPath = path.join(fixture.root, `archive-mutation-${index}.d42`);
      await writeFile(changedPath, changedBytes);
      await assert.rejects(
        inspectAgentPackage({
          packagePath: changedPath,
          expectedArchiveDigest: digestBytes(changedBytes),
        }),
        boundedInspectError,
      );
      assert.deepEqual(await readFile(sentinel), sentinelBytes);
    }

    const hardLinkedArchive = path.join(fixture.root, "archive-hard-link.d42");
    await link(archivePath, hardLinkedArchive);
    await assert.rejects(
      inspectAgentPackage({
        packagePath: hardLinkedArchive,
        expectedArchiveDigest: produced.archiveDigest,
      }),
      boundedInspectError,
    );
    assert.deepEqual(await readFile(sentinel), sentinelBytes);
  });

  it("rejects directory set, type, mode, digest, and retained-identity drift", async () => {
    const fixture = await buildApprovedPackageFixture();
    const packageRoot = path.join(fixture.root, "directory-package");
    const archivePath = path.join(fixture.root, "directory-package.d42");
    const produced = await produceAgentPackage(
      packageProduceOptions(fixture, packageRoot, archivePath),
    );
    const firstMember = JSON.parse(
      await readFile(path.join(packageRoot, "agentmo.package.json"), "utf8"),
    ).members[0];
    const mutations = [
      async (root) => writeFile(path.join(root, "unindexed-extra.txt"), "extra\n"),
      async (root) => writeFile(
        path.join(root, ...firstMember.relativePath.split("/")),
        "changed\n",
      ),
      async (root) => chmod(
        path.join(root, ...firstMember.relativePath.split("/")),
        0o755,
      ),
      async (root) => {
        const memberPath = path.join(root, ...firstMember.relativePath.split("/"));
        const hardLinkPath = `${memberPath}.hard-link`;
        await link(memberPath, hardLinkPath);
      },
    ];
    for (const [index, mutate] of mutations.entries()) {
      const changedRoot = path.join(fixture.root, `directory-mutation-${index}`);
      await cp(packageRoot, changedRoot, { recursive: true, preserveTimestamps: true });
      await mutate(changedRoot);
      await assert.rejects(
        inspectAgentPackage({
          packagePath: changedRoot,
          expectedManifestDigest: produced.manifestDigest,
        }),
        boundedInspectError,
      );
    }
  });

  it("rejects self-consistent secret, auth/session, database, transcript, provider, and process material", async () => {
    const fixture = await buildApprovedPackageFixture();
    const packageRoot = path.join(fixture.root, "hostile-package");
    const archivePath = path.join(fixture.root, "hostile-package.d42");
    await produceAgentPackage(packageProduceOptions(fixture, packageRoot, archivePath));
    const original = JSON.parse(await readFile(archivePath, "utf8"));
    const hostileValues = [
      { apiKey: "sk-private-package-canary-123456789" },
      { authSession: { bearerToken: "private-session-canary" } },
      { runtimeDatabase: "private-runtime.sqlite" },
      { rawTranscript: "private transcript canary" },
      { providerPayload: { private: "provider-payload-canary" } },
      { rawStdout: "private stdout canary", rawStderr: "private stderr canary" },
    ];
    for (const [index, hostile] of hostileValues.entries()) {
      const changed = selfConsistentMemberReplacement(original, 0, hostile);
      const changedBytes = Buffer.from(`${JSON.stringify(changed, null, 2)}\n`, "utf8");
      const changedPath = path.join(fixture.root, `hostile-${index}.d42`);
      await writeFile(changedPath, changedBytes);
      await assert.rejects(
        inspectAgentPackage({
          packagePath: changedPath,
          expectedArchiveDigest: digestBytes(changedBytes),
        }),
        (error) => {
          assert.equal(boundedInspectError(error), true);
          const serialized = JSON.stringify(error);
          assert.equal(serialized.includes(JSON.stringify(hostile)), false);
          assert.equal(serialized.includes(fixture.root), false);
          return true;
        },
      );
    }
  });
});

function selfConsistentMemberReplacement(original, index, hostile) {
  const archive = structuredClone(original);
  const bytes = Buffer.from(`${JSON.stringify(hostile, null, 2)}\n`, "utf8");
  const manifest = JSON.parse(
    Buffer.from(archive.manifestContentBase64, "base64").toString("utf8"),
  );
  const descriptor = {
    relativePath: manifest.members[index].relativePath,
    type: "file",
    mode: manifest.members[index].mode,
    byteLength: bytes.length,
    sha256: digestBytes(bytes),
  };
  manifest.members[index] = descriptor;
  manifest.inventoryDigest = digestBytes(Buffer.from(serializePersistableJson(
    manifest.members,
    { subject: "package-member-inventory" },
  ), "utf8"));
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  archive.manifestContentBase64 = manifestBytes.toString("base64");
  archive.manifestDigest = digestBytes(manifestBytes);
  archive.inventoryDigest = manifest.inventoryDigest;
  archive.members[index] = {
    ...descriptor,
    contentBase64: bytes.toString("base64"),
  };
  return archive;
}

function parseHumanInspection(text) {
  const lines = text.trimEnd().split("\n");
  assert.equal(lines.shift(), "AgentMo Package Inspection");
  return Object.fromEntries(lines.map((line) => {
    const separator = line.indexOf(": ");
    assert.notEqual(separator, -1);
    return [line.slice(0, separator), JSON.parse(line.slice(separator + 2))];
  }));
}

function boundedInspectError(error) {
  assert.equal(error?.name, "PackageInspectError");
  assert.match(error?.code ?? "", /^AGENTMO_PACKAGE_INSPECT_[A-Z0-9_]+$/u);
  assert.equal(error.message, "Agent Package inspection was rejected.");
  assert.equal(JSON.stringify(error).includes("/tmp/"), false);
  assert.equal(JSON.stringify(error).includes("/Users/"), false);
  return true;
}
