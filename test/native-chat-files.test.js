import assert from "node:assert/strict";
import { access, link, lstat, mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { publishNativeChatFiles, writeNativeChatFile } from "../src/native-chat-files.js";

const parent = async () => realpath(await mkdtemp(path.join(tmpdir(), "agentmo-native-files-")));
const file = (relativePath, text = "original") => ({ relativePath, bytes: Buffer.from(text), mode: 0o644 });

test("native publisher creates exact files and never overwrites an existing root or file", async () => {
  const base = await parent();
  const root = path.join(base, "package");
  const result = await publishNativeChatFiles({ root, files: [file("workspace/AGENTS.md"), file("agentmo.package.json", "{}\n")] });
  assert.equal(result.members.length, 2);
  assert.equal(await readFile(path.join(root, "workspace/AGENTS.md"), "utf8"), "original");
  await assert.rejects(publishNativeChatFiles({ root, files: [file("workspace/AGENTS.md", "changed")] }));
  const output = path.join(base, "approval.json");
  await writeNativeChatFile({ filePath: output, bytes: Buffer.from("original") });
  assert.equal((await lstat(output)).mode & 0o777, 0o600);
  await assert.rejects(writeNativeChatFile({ filePath: output, bytes: Buffer.from("changed") }));
  assert.equal(await readFile(output, "utf8"), "original");
});

test("native publisher rejects traversal, collisions and symlink ancestors before creating a root", async () => {
  const base = await parent();
  const target = path.join(base, "target"); await mkdir(target);
  const alias = path.join(base, "alias"); await symlink(target, alias);
  await assert.rejects(publishNativeChatFiles({ root: path.join(alias, "package"), files: [file("a")] }));
  await assert.rejects(writeNativeChatFile({ filePath: path.join(alias, "file"), bytes: Buffer.from("x") }));
  for (const files of [[file("../escape")], [file("/escape")], [file("a"), file("A")], [file("a"), file("a/b")]]) {
    const root = path.join(base, "invalid");
    await assert.rejects(publishNativeChatFiles({ root, files }));
    await assert.rejects(access(root));
  }
  await assert.rejects(access(path.join(target, "package")));
  await assert.rejects(access(path.join(target, "file")));
});

test("native single-file writer refuses hardlinks and preserves other bytes", async () => {
  const base = await parent();
  const original = path.join(base, "original"); await writeFile(original, "keep");
  const alias = path.join(base, "alias"); await link(original, alias);
  await assert.rejects(writeNativeChatFile({ filePath: alias, bytes: Buffer.from("changed") }));
  assert.equal(await readFile(original, "utf8"), "keep");
});
