import { createHash } from 'node:crypto';
import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

const identity = s => ({ device: String(s.dev), inode: String(s.ino), birthtimeNs: String(s.birthtimeNs) });
const fail = code => { throw Object.assign(new Error(code), { code }); };
const relative = p => typeof p === 'string' && !path.isAbsolute(p) && !p.split(path.sep).includes('..');

export async function piMetadataDigest(root, { mutablePaths = [], excludePaths = [] } = {}) {
  if (!path.isAbsolute(root) || await realpath(root) !== root || ![...mutablePaths, ...excludePaths].every(relative)) fail('AGENTMO_PI_PREFLIGHT_INVALID');
  const mutable = new Set(mutablePaths), exclude = new Set(excludePaths), hash = createHash('sha256'); let entries = 0;
  async function walk(rel) {
    if (exclude.has(rel)) return;
    const file = path.join(root, rel), s = await lstat(file, { bigint: true });
    const row = { path: rel, type: s.isDirectory() ? 'directory' : s.isSymbolicLink() ? 'symlink' : 'file', ...identity(s),
      mode: String(s.mode), uid: String(s.uid), gid: String(s.gid),
      ...(mutable.has(rel) && s.isDirectory() ? {} : { links: String(s.nlink) }),
      ...(mutable.has(rel) ? {} : { size: String(s.size), mtime: String(s.mtimeNs), ctime: String(s.ctimeNs) }) };
    hash.update(JSON.stringify(row) + '\n'); entries++;
    if (s.isDirectory()) for (const name of (await readdir(file)).sort()) await walk(rel === '.' ? name : path.join(rel, name));
  }
  await walk('.'); return { digest: 'sha256:' + hash.digest('hex'), entries };
}

export async function checkPiPreflight({ identities, trees }) {
  if (!Array.isArray(identities) || !Array.isArray(trees)) fail('AGENTMO_PI_PREFLIGHT_INVALID');
  for (const item of identities) {
    const s = await lstat(item.path, { bigint: true }), got = identity(s);
    if (await realpath(item.path) !== item.path || s.isSymbolicLink()
      || ['device', 'inode', 'birthtimeNs'].some(k => got[k] !== item.identity?.[k])) fail('AGENTMO_PI_ENVIRONMENT_STALE');
  }
  for (const tree of trees) {
    const got = await piMetadataDigest(tree.root, tree.options);
    if (got.digest !== tree.digest || tree.entries !== undefined && got.entries !== tree.entries) fail('AGENTMO_PI_PRESERVATION_CHANGED');
  }
  return { identityChecks: identities.length, treeChecks: trees.length };
}
