import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import path from "node:path";

// Same-UID state isolation, not protection against malicious concurrent namespace changes.
export async function publishNativeChatFiles({ root, files }) {
  assertAbsolute(root);
  if (!Array.isArray(files) || files.length === 0) throw new Error("AGENTMO_NATIVE_FILES_INVALID");
  const paths = new Set();
  for (const file of files) {
    const name = file?.relativePath;
    if (typeof name !== "string" || name !== name.normalize("NFC") || name.includes("\\")
      || name.includes("\0") || name.split("/").some((s) => !s || s === "." || s === ".." || /[. ]$/u.test(s))
      || !Buffer.isBuffer(file.bytes) || ![0o600, 0o644, 0o755].includes(file.mode)) {
      throw new Error("AGENTMO_NATIVE_FILES_INVALID");
    }
    const folded = name.toLowerCase();
    if ([...paths].some((p) => p === folded || p.startsWith(`${folded}/`) || folded.startsWith(`${p}/`))) {
      throw new Error("AGENTMO_NATIVE_FILES_COLLISION");
    }
    paths.add(folded);
  }
  await assertNativeChatAbsentRoot(root);
  await mkdir(root, { mode: 0o700 });
  const directories = new Set([root]);
  const ordered = [...files].sort((a, b) => (
    Number(a.relativePath === "agentmo.package.json") - Number(b.relativePath === "agentmo.package.json")
      || Buffer.from(a.relativePath).compare(Buffer.from(b.relativePath))
  ));
  const members = [];
  for (const file of ordered) {
    const parts = file.relativePath.split("/");
    for (let i = 1; i < parts.length; i += 1) {
      const directory = path.join(root, ...parts.slice(0, i));
      if (!directories.has(directory)) {
        await mkdir(directory, { mode: 0o700 });
        directories.add(directory);
      }
    }
    await writeNewFile(path.join(root, ...parts), file.bytes, file.mode);
    members.push({ relativePath: file.relativePath, type: "file", mode: file.mode,
      byteLength: file.bytes.length, sha256: `sha256:${createHash("sha256").update(file.bytes).digest("hex")}` });
  }
  for (const directory of [...directories].reverse()) await syncDirectory(directory);
  await syncDirectory(path.dirname(root));
  return { members: members.sort((a, b) => Buffer.from(a.relativePath).compare(Buffer.from(b.relativePath))) };
}

export async function writeNativeChatFile({ filePath, bytes }) {
  assertAbsolute(filePath);
  if (!Buffer.isBuffer(bytes)) throw new Error("AGENTMO_NATIVE_FILES_INVALID");
  await checkAncestors(path.dirname(filePath));
  await writeNewFile(filePath, bytes, 0o600);
  await syncDirectory(path.dirname(filePath));
}

export async function assertNativeChatAbsentRoot(root) {
  assertAbsolute(root);
  await checkAncestors(path.dirname(root));
  try { await lstat(root); }
  catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  throw new Error("AGENTMO_NATIVE_FILES_ROOT_EXISTS");
}

function assertAbsolute(value) {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0") || path.normalize(value) !== value) {
    throw new Error("AGENTMO_NATIVE_FILES_PATH_INVALID");
  }
}

async function checkAncestors(directory) {
  const root = path.parse(directory).root;
  let current = root;
  for (const part of directory.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("AGENTMO_NATIVE_FILES_UNSAFE_ANCESTOR");
  }
}

async function writeNewFile(filePath, bytes, mode) {
  const handle = await open(filePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1) throw new Error("AGENTMO_NATIVE_FILES_UNSAFE_FILE");
    await handle.writeFile(bytes);
    await handle.chmod(mode);
    await handle.sync();
  } finally { await handle.close(); }
}

async function syncDirectory(directory) {
  const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}
