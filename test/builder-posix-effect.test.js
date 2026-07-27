import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants as FS_CONSTANTS } from "node:fs";
import {
  chmod,
  cp,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, it } from "node:test";

import { runBuilderPosixEffect } from "../src/builder-posix-effect.js";

const temporaryRoots = new Set();

afterEach(async () => {
  await Promise.all(
    [...temporaryRoots].map((root) => rm(root, { force: true, recursive: true })),
  );
  temporaryRoots.clear();
});

describe("builder POSIX effect primitive", () => {
  it("admits only fixed descriptor launch bridges and no authority-path cwd fallback", async () => {
    const source = await readFile(path.resolve("src/builder-posix-effect.js"), "utf8");
    assert.match(source, /DARWIN_DIRECTORY_FD_BRIDGE_COMMAND = "\/usr\/bin\/python3"/u);
    assert.match(source, /os\.fchdir\(4\)/u);
    assert.match(source, /process\.chdir\(`\/proc\/self\/fd\/\$\{DIRECTORY_DESCRIPTOR\}`\)/u);
    assert.match(source, /lstat\(DARWIN_DIRECTORY_FD_BRIDGE_COMMAND/u);
    assert.match(source, /stats\.uid !== 0n/u);
    assert.match(source, /stats\.mode & 0o022n/u);
    assert.match(source, /\["-I", "-c", DARWIN_DIRECTORY_FD_BRIDGE/u);
    assert.match(source, /cwd: "\/"/u);
    assert.match(source, /normalized\.directoryAuthority\.handle\.fd/u);
    assert.equal(source.includes("cwd: normalized.directoryAuthority.path"), false);
    assert.equal(source.includes("new URL(import.meta.url)"), false);
    assert.match(source, /builderPosixEffectChildMain\.toString\(\)/u);
  });

  it("executes a self-contained authenticated child after its physical module path is replaced", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentmo-posix-effect-module-swap-"));
    temporaryRoots.add(root);
    const moduleRoot = path.join(root, "module");
    const sourcePath = path.join(moduleRoot, "builder-posix-effect.js");
    const retainedPath = `${sourcePath}.retained`;
    const sentinel = path.join(root, "swapped-module-executed");
    await mkdir(moduleRoot, { mode: 0o700 });
    await Promise.all([
      cp(path.resolve("src/builder-posix-effect.js"), sourcePath),
      cp(path.resolve("src/builder-platform.js"), path.join(moduleRoot, "builder-platform.js")),
    ]);
    const effect = await import(`${pathToFileURL(sourcePath).href}?loaded=${process.pid}`);
    const fixture = await createDirectoryAuthority("agentmo-posix-effect-authenticated-child-");
    try {
      await rename(sourcePath, retainedPath);
      await writeFile(
        sourcePath,
        `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(sentinel)}, "executed");\n`,
        { mode: 0o600 },
      );
      const result = await effect.runBuilderPosixEffect({
        action: "mkdir",
        name: "authenticated-child",
        payload: "",
      }, { directoryAuthority: fixture.authority });
      assert.equal(result.kind, "directory");
      assert.equal(await exists(sentinel), false);
      assert.equal(
        (await stat(path.join(fixture.directory, "authenticated-child"))).isDirectory(),
        true,
      );
    } finally {
      await fixture.handle.close();
    }
  });

  it("uses the Darwin fchdir exec bridge with the inherited retained descriptor", {
    skip: process.platform !== "darwin",
  }, async () => {
    const fixture = await createDirectoryAuthority("agentmo-posix-effect-darwin-fd-");
    try {
      const result = await runBuilderPosixEffect({
        action: "mkdir",
        name: "fd-bound",
        payload: "",
      }, { directoryAuthority: fixture.authority });
      assert.equal(result.kind, "directory");
      assert.equal((await stat(path.join(fixture.directory, "fd-bound"))).isDirectory(), true);
    } finally {
      await fixture.handle.close();
    }
  });

  it("binds mkdir, write, claim, hardlink, and directory fsync to the retained directory inode", async () => {
    const fixture = await createDirectoryAuthority("agentmo-posix-effect-swap-");
    try {
      const mkdirResult = await runBuilderPosixEffect({
        action: "mkdir",
        name: "entries",
        payload: "",
      }, { directoryAuthority: fixture.authority });
      assert.equal(mkdirResult.kind, "directory");
      assert.equal((await stat(path.join(fixture.directory, "entries"))).isDirectory(), true);

      const bytes = Buffer.from("retained cwd bytes\n", "utf8");
      const payload = bytes.toString("base64");
      const writeResult = await runBuilderPosixEffect({
        action: "write-file",
        name: "stage.bin",
        payload,
      }, { directoryAuthority: fixture.authority });
      assert.equal(writeResult.kind, "file");
      assert.deepEqual(await readFile(path.join(fixture.directory, "stage.bin")), bytes);

      const claimResult = await runBuilderPosixEffect({
        action: "claim-symlink",
        name: "claim",
        payload: "am-claim-v2.deadbeef",
      }, { directoryAuthority: fixture.authority });
      assert.equal(claimResult.kind, "claim");
      assert.equal(await readlink(path.join(fixture.directory, "claim")), "am-claim-v2.deadbeef");

      const linkResult = await runBuilderPosixEffect({
        action: "hardlink",
        name: "entry.bin",
        payload,
        sourceIdentity: writeResult.identity,
        sourceName: "stage.bin",
      }, { directoryAuthority: fixture.authority });
      assert.equal(linkResult.kind, "link");
      const sourceStats = await lstat(path.join(fixture.directory, "stage.bin"), {
        bigint: true,
      });
      const destinationStats = await lstat(path.join(fixture.directory, "entry.bin"), {
        bigint: true,
      });
      assert.equal(sourceStats.ino, destinationStats.ino);
      assert.equal(sourceStats.dev, destinationStats.dev);
      assert.equal(sourceStats.nlink, 2n);

    } finally {
      await fixture.handle.close();
    }
  });

  it("resumes only the selected prefix inode and rejects every conflicting target state", async () => {
    const fixture = await createDirectoryAuthority("agentmo-posix-effect-selected-file-");
    const select = async (name, bytes) => runBuilderPosixEffect({
      action: "claim-symlink",
      name: `${name}.selection`,
      payload: selectedTarget(bytes),
    }, { directoryAuthority: fixture.authority });
    const resume = async (name, bytes, existingIdentity) => runBuilderPosixEffect({
      action: "write-selected-file",
      authorizationName: `${name}.selection`,
      ...(existingIdentity === null ? {} : { existingIdentity }),
      name,
      payload: bytes.toString("base64"),
    }, { directoryAuthority: fixture.authority });
    try {
      const createdBytes = Buffer.from("selector-only creation\n", "utf8");
      await select("created.bin", createdBytes);
      const created = await resume("created.bin", createdBytes, null);
      assert.equal(created.created, true);
      assert.deepEqual(await readFile(path.join(fixture.directory, "created.bin")), createdBytes);

      const bytes = Buffer.from("selected prefix resumes on its original inode\n", "utf8");
      await select("resumed.bin", bytes);
      const resumedPath = path.join(fixture.directory, "resumed.bin");
      const prefix = bytes.subarray(0, 11);
      await writeFile(resumedPath, prefix, { mode: 0o600 });
      const prefixIdentity = fileIdentity(await lstat(resumedPath, { bigint: true }));
      const resumed = await resume("resumed.bin", bytes, prefixIdentity);
      assert.equal(resumed.identity.device, prefixIdentity.device);
      assert.equal(resumed.identity.inode, prefixIdentity.inode);
      assert.deepEqual(await readFile(resumedPath), bytes);

      const linkedPath = path.join(fixture.directory, "resumed-final.bin");
      await link(resumedPath, linkedPath);
      const replay = await resume("resumed.bin", bytes, null);
      assert.equal(replay.created, false);
      assert.equal(replay.identity.links, "2");

      const replacedBytes = Buffer.from("same prefix, replacement inode must fail\n", "utf8");
      await select("replaced.bin", replacedBytes);
      const replacedPath = path.join(fixture.directory, "replaced.bin");
      const retainedPath = path.join(fixture.root, "retained-prefix.bin");
      const replacementPath = path.join(fixture.root, "replacement-prefix.bin");
      const replacedPrefix = replacedBytes.subarray(0, 12);
      await writeFile(replacedPath, replacedPrefix, { mode: 0o600 });
      const retainedIdentity = fileIdentity(await lstat(replacedPath, { bigint: true }));
      await rename(replacedPath, retainedPath);
      await writeFile(replacedPath, replacedPrefix, { mode: 0o600 });
      await assert.rejects(
        resume("replaced.bin", replacedBytes, retainedIdentity),
        hasCode("AGENTMO_BUILDER_POSIX_EFFECT_FILE_CHANGED"),
      );
      assert.deepEqual(await readFile(replacedPath), replacedPrefix);
      await rename(replacedPath, replacementPath);
      await rename(retainedPath, replacedPath);
      const restored = await resume("replaced.bin", replacedBytes, retainedIdentity);
      assert.equal(restored.identity.inode, retainedIdentity.inode);

      const linkedPrefixBytes = Buffer.from("a linked short prefix cannot grow\n", "utf8");
      await select("linked-prefix.bin", linkedPrefixBytes);
      const linkedPrefixPath = path.join(fixture.directory, "linked-prefix.bin");
      await writeFile(linkedPrefixPath, linkedPrefixBytes.subarray(0, 5), { mode: 0o600 });
      const linkedPrefixIdentity = fileIdentity(await lstat(linkedPrefixPath, { bigint: true }));
      await link(linkedPrefixPath, path.join(fixture.directory, "linked-prefix-alias.bin"));
      await assert.rejects(
        resume("linked-prefix.bin", linkedPrefixBytes, linkedPrefixIdentity),
        hasCode("AGENTMO_BUILDER_POSIX_EFFECT_FILE_CHANGED"),
      );

      const mismatchBytes = Buffer.from("expected prefix bytes\n", "utf8");
      await select("mismatch.bin", mismatchBytes);
      const mismatchPath = path.join(fixture.directory, "mismatch.bin");
      await writeFile(mismatchPath, Buffer.from("wrong", "utf8"), { mode: 0o600 });
      const mismatchIdentity = fileIdentity(await lstat(mismatchPath, { bigint: true }));
      await assert.rejects(
        resume("mismatch.bin", mismatchBytes, mismatchIdentity),
        hasCode("AGENTMO_BUILDER_POSIX_EFFECT_FILE_CHANGED"),
      );

      const oversizedBytes = Buffer.from("short\n", "utf8");
      await select("oversized.bin", oversizedBytes);
      const oversizedPath = path.join(fixture.directory, "oversized.bin");
      await writeFile(oversizedPath, Buffer.from("too many bytes\n", "utf8"), { mode: 0o600 });
      const oversizedIdentity = fileIdentity(await lstat(oversizedPath, { bigint: true }));
      await assert.rejects(
        resume("oversized.bin", oversizedBytes, oversizedIdentity),
        hasCode("AGENTMO_BUILDER_POSIX_EFFECT_FILE_CHANGED"),
      );

      const wrongSelectionBytes = Buffer.from("selected bytes\n", "utf8");
      await select("wrong-selection.bin", Buffer.from("other bytes\n", "utf8"));
      await assert.rejects(
        resume("wrong-selection.bin", wrongSelectionBytes, null),
        hasCode("AGENTMO_BUILDER_POSIX_EFFECT_CLAIM_CHANGED"),
      );
      assert.equal(await exists(path.join(fixture.directory, "wrong-selection.bin")), false);
    } finally {
      await fixture.handle.close();
    }
  });

  it("writes large selected files in bounded durable chunks under concurrent pressure", async () => {
    const fixtures = await Promise.all([
      createDirectoryAuthority("agentmo-posix-effect-large-selected-a-"),
      createDirectoryAuthority("agentmo-posix-effect-large-selected-b-"),
    ]);
    const bytes = Buffer.alloc(157_740, "a");
    const source = await readFile(path.resolve("src/builder-posix-effect.js"), "utf8");
    assert.match(source, /const APPEND_SYNC_CHUNK_BYTES = 64 \* 1024;/u);
    assert.match(
      source,
      /const length = Math\.min\(APPEND_SYNC_CHUNK_BYTES, expectedBytes\.length - offset\);\n      const \{ bytesWritten \} = await handle\.write\([\s\S]*?\n      await handle\.sync\(\);/u,
    );
    try {
      await Promise.all(fixtures.map(async ({ authority }) => {
        await runBuilderPosixEffect({
          action: "claim-symlink",
          name: "large.stage.selection",
          payload: selectedTarget(bytes),
        }, { directoryAuthority: authority });
      }));
      const results = await Promise.all(fixtures.map(({ authority }) => runBuilderPosixEffect({
        action: "write-selected-file",
        authorizationName: "large.stage.selection",
        name: "large.stage",
        payload: bytes.toString("base64"),
      }, { directoryAuthority: authority })));
      assert.deepEqual(results.map((result) => result.created), [true, true]);
      await Promise.all(fixtures.map(async ({ directory }) => {
        assert.deepEqual(await readFile(path.join(directory, "large.stage")), bytes);
      }));
    } finally {
      await Promise.all(fixtures.map(({ handle }) => handle.close()));
    }
  });

  it("rejects a replaced bootstrap pathname before a child can mutate it", async () => {
    const fixture = await createDirectoryAuthority("agentmo-posix-effect-held-cwd-");
    const displaced = `${fixture.directory}.displaced`;
    try {
      await rename(fixture.directory, displaced);
      await mkdir(fixture.directory, { mode: 0o700 });
      await assert.rejects(
        runBuilderPosixEffect({
          action: "write-file",
          name: "held.bin",
          payload: Buffer.from("held\n", "utf8").toString("base64"),
        }, { directoryAuthority: fixture.authority }),
        hasCode("AGENTMO_BUILDER_POSIX_EFFECT_DIRECTORY_CHANGED"),
      );
      assert.deepEqual(await readdir(fixture.directory), []);
      assert.deepEqual(await readdir(displaced), []);
    } finally {
      await fixture.handle.close();
    }
  });

  it("rejects directory identity drift before spawning and leaves the directory untouched", async () => {
    const fixture = await createDirectoryAuthority("agentmo-posix-effect-identity-");
    try {
      const wrongIdentity = Object.freeze({
        ...fixture.authority.identity,
        inode: (BigInt(fixture.authority.identity.inode) + 1n).toString(10),
      });
      await assert.rejects(
        runBuilderPosixEffect({
          action: "write-file",
          name: "must-not-exist.bin",
          payload: Buffer.from("x").toString("base64"),
        }, {
          directoryAuthority: Object.freeze({
            ...fixture.authority,
            identity: wrongIdentity,
          }),
        }),
        hasCode("AGENTMO_BUILDER_POSIX_EFFECT_DIRECTORY_CHANGED"),
      );
      assert.deepEqual(await readdir(fixture.directory), []);
    } finally {
      await fixture.handle.close();
    }
  });

  it("rejects a same-content source basename replacement with or without a retained source descriptor", async () => {
    const fixture = await createDirectoryAuthority("agentmo-posix-effect-source-");
    const bytes = Buffer.from("same bytes\n", "utf8");
    const sourcePath = path.join(fixture.directory, "source.bin");
    const retainedPath = path.join(fixture.directory, "retained-source.bin");
    await writeFile(sourcePath, bytes);
    await chmod(sourcePath, 0o600);
    const sourceHandle = await open(
      sourcePath,
      FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW,
    );
    try {
      const sourceIdentity = fileIdentity(await sourceHandle.stat({ bigint: true }));
      await rename(sourcePath, retainedPath);
      await writeFile(sourcePath, bytes);
      await chmod(sourcePath, 0o600);

      await assert.rejects(
        runBuilderPosixEffect({
          action: "hardlink",
          name: "descriptorless-destination.bin",
          payload: bytes.toString("base64"),
          sourceIdentity,
          sourceName: "source.bin",
        }, { directoryAuthority: fixture.authority }),
        hasCode("AGENTMO_BUILDER_POSIX_EFFECT_SOURCE_CHANGED"),
      );
      await assert.rejects(
        runBuilderPosixEffect({
          action: "hardlink",
          name: "destination.bin",
          payload: bytes.toString("base64"),
          sourceIdentity,
          sourceName: "source.bin",
        }, {
          directoryAuthority: fixture.authority,
          sourceAuthority: Object.freeze({ handle: sourceHandle }),
        }),
        hasCode("AGENTMO_BUILDER_POSIX_EFFECT_SOURCE_CHANGED"),
      );
      assert.equal(await exists(path.join(fixture.directory, "destination.bin")), false);
      assert.notEqual(
        (await lstat(sourcePath, { bigint: true })).ino,
        (await lstat(retainedPath, { bigint: true })).ino,
      );
    } finally {
      await sourceHandle.close();
      await fixture.handle.close();
    }
  });

  it("accepts only the closed basename-relative operation contract", async () => {
    const fixture = await createDirectoryAuthority("agentmo-posix-effect-contract-");
    const payload = Buffer.from("x").toString("base64");
    try {
      const rejected = [
        { action: "write-file", name: "/tmp/absolute", payload },
        { action: "write-file", name: "nested/name", payload },
        { action: "write-file", name: "..", payload },
        { action: "write-file", name: "a".repeat(256), payload },
        { action: "unlink", name: "victim", payload: "" },
        {
          action: "hardlink",
          name: "destination",
          payload,
          sourceName: "nested/source",
        },
      ];
      for (const request of rejected) {
        await assert.rejects(
          runBuilderPosixEffect(request, { directoryAuthority: fixture.authority }),
          hasCode("AGENTMO_BUILDER_POSIX_EFFECT_REQUEST_REJECTED"),
        );
      }
      await assert.rejects(
        runBuilderPosixEffect({
          action: "hardlink",
          name: "destination",
          payload,
          sourceIdentity: {
            device: "1",
            inode: "1",
            links: "3",
            size: "1",
          },
          sourceName: "source",
        }, {
          directoryAuthority: fixture.authority,
        }),
        hasCode("AGENTMO_BUILDER_POSIX_EFFECT_REQUEST_REJECTED"),
      );
      await assert.rejects(
        runBuilderPosixEffect({
          action: "mkdir",
          name: "entry",
          payload: "",
        }, {
          directoryAuthority: fixture.authority,
          onCheckpoint() {},
        }),
        hasCode("AGENTMO_BUILDER_POSIX_EFFECT_REQUEST_REJECTED"),
      );
      await assert.rejects(
        runBuilderPosixEffect({
          action: "mkdir",
          name: "entry",
          payload: "",
        }, {
          directoryAuthority: fixture.authority,
          unexpectedOption: true,
        }),
        hasCode("AGENTMO_BUILDER_POSIX_EFFECT_REQUEST_REJECTED"),
      );
      assert.deepEqual(await readdir(fixture.directory), []);
    } finally {
      await fixture.handle.close();
    }
  });
});

async function createDirectoryAuthority(prefix) {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryRoots.add(root);
  const directory = path.join(root, "authority");
  await mkdir(directory, { mode: 0o700 });
  const handle = await open(
    directory,
    FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_DIRECTORY | FS_CONSTANTS.O_NOFOLLOW,
  );
  const identity = directoryIdentity(await handle.stat({ bigint: true }));
  return Object.freeze({
    root,
    directory,
    handle,
    authority: Object.freeze({
      path: directory,
      handle,
      identity: Object.freeze(identity),
    }),
  });
}

function directoryIdentity(stats) {
  return {
    device: stats.dev.toString(10),
    inode: stats.ino.toString(10),
    uid: stats.uid.toString(10),
    gid: stats.gid.toString(10),
    mode: (stats.mode & 0o777n).toString(8),
  };
}

function fileIdentity(stats) {
  return {
    device: stats.dev.toString(10),
    inode: stats.ino.toString(10),
    links: stats.nlink.toString(10),
    size: stats.size.toString(10),
  };
}

function selectedTarget(bytes) {
  return [
    "am-selected-file-v1",
    createHash("sha256").update(bytes).digest("hex"),
    String(bytes.length),
  ].join(".");
}

function hasCode(code) {
  return (error) => error?.code === code;
}

async function exists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
