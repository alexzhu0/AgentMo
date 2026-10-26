import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPersistable } from './persistability.js';
import { PI_TARGET_NODE_RANGE, isPiTargetNodeSupported } from './runtime-compatibility.js';
export { isPiTargetNodeSupported as isPiNodeSupported } from './runtime-compatibility.js';

export const PI_TARGET_DESCRIPTOR_SCHEMA_VERSION = 'agentmo.pi-target-descriptor.v1';
export const PI_SDK_NAME = '@earendil-works/pi-coding-agent';
export const PI_SDK_VERSION = '1.2.0';
export const PI_NODE_RANGE = PI_TARGET_NODE_RANGE;
const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const json = value => Buffer.from(JSON.stringify(value));
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const keys = (value, fields) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...fields].sort().join(',');
const identity = s => ({ device: String(s.dev), inode: String(s.ino), birthtimeNs: String(s.birthtimeNs) });
const stable = s => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].map(String).join(':');
function reject() { throw Object.assign(new Error('Pi target observation rejected.'), { code: 'AGENTMO_PI_TARGET_REJECTED' }); }
const isPiNodeSupported = isPiTargetNodeSupported;

async function observedFile(file, maximum = 64 * 1024 * 1024) {
  if (['.env', '.npmrc', 'auth.json', 'credentials.json'].includes(path.basename(file))
    || path.basename(file).startsWith('.env.') && path.basename(file) !== '.env.example') reject();
  if (await realpath(path.dirname(file)) !== path.dirname(file)) reject();
  const before = await lstat(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(maximum)) reject();
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (stable(before) !== stable(await handle.stat({ bigint: true }))) reject();
    const bytes = await handle.readFile();
    if (bytes.length > maximum || stable(before) !== stable(await handle.stat({ bigint: true }))
      || stable(before) !== stable(await lstat(file, { bigint: true }))) reject();
    return { bytes, sha256: digest(bytes), byteLength: bytes.length };
  } finally { await handle.close(); }
}

async function sdkInventory(root) {
  const rows = []; let total = 0;
  async function walk(dir) {
    for (const name of (await readdir(dir)).sort()) {
      // npm's command shims are not imported by the SDK; never follow their links.
      if (name === '.bin') continue;
      const file = path.join(dir, name), info = await lstat(file);
      if (info.isSymbolicLink()) reject();
      if (info.isDirectory()) await walk(file);
      else {
        const observed = await observedFile(file);
        total += observed.byteLength;
        if (rows.length >= 20000 || total > 512 * 1024 * 1024) reject();
        rows.push({ relativePath: path.relative(root, file).split(path.sep).join('/'),
          byteLength: observed.byteLength, sha256: observed.sha256 });
      }
    }
  }
  await walk(path.join(root, 'node_modules'));
  return rows.sort((a, b) => a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0);
}

async function verifyInstalledPackages(root, lock, inventory) {
  const packages = new Map();
  for (const row of inventory) {
    if (!/^(?:.*\/)?node_modules\/(?:@[^/]+\/)?[^/]+\/package\.json$/.test(row.relativePath)) continue;
    const key = row.relativePath.slice(0, -'/package.json'.length), installed = JSON.parse((await observedFile(path.join(root, row.relativePath))).bytes);
    const record = lock.packages[key];
    if (!record || record.version !== installed.version || record.link || typeof installed.name !== 'string') reject();
    const url = new URL(record.resolved);
    if (url.protocol !== 'https:' || url.host !== 'registry.npmjs.org' || url.username || url.password || url.search || url.hash
      || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(record.integrity ?? '')) reject();
    packages.set(key, installed);
  }
  for (const [key, pkg] of packages) {
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(dep)) reject();
      let base = path.join(root, key), found = false;
      while (base === root || base.startsWith(root + path.sep)) {
        const relative = path.relative(root, path.join(base, 'node_modules', dep)).split(path.sep).join('/');
        if (packages.has(relative)) { found = true; break; }
        if (base === root) break;
        base = path.dirname(base);
      }
      if (!found && !Object.hasOwn(pkg.optionalDependencies ?? {}, dep)) reject();
    }
  }
  return packages;
}

export async function observePiRuntimeSourceClosure() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const excluded = new Set(pkg.files.filter(file => file.startsWith('!')).map(file => file.slice(1)));
  const files = ['package.json', 'bin/agentmo.js'];
  async function collect(dir) {
    for (const name of (await readdir(path.join(root, dir))).sort()) {
      const relative = `${dir}/${name}`;
      if (excluded.has(relative)) continue;
      const info = await lstat(path.join(root, relative));
      if (info.isSymbolicLink()) reject();
      if (info.isDirectory()) await collect(relative);
      else if (/\.(?:js|json|html|css)$/.test(name)) files.push(relative);
    }
  }
  await collect('src');
  const rows = [];
  for (const relativePath of files.sort()) {
    if (path.isAbsolute(relativePath) || relativePath.split('/').includes('..') || /[*?\\]/.test(relativePath)) reject();
    const file = await observedFile(path.join(root, relativePath));
    rows.push({ relativePath, sha256: file.sha256, byteLength: file.byteLength });
  }
  return { digest: digest(json(rows)), fileCount: rows.length };
}

export async function buildPiTargetDescriptor(options) {
  try {
    if (!keys(options, ['sdkRoot', 'nodeExecutablePath', 'lockFilePath']) || !isPiNodeSupported(process.versions.node)) reject();
    const { sdkRoot, nodeExecutablePath, lockFilePath } = options;
    if (![sdkRoot, nodeExecutablePath, lockFilePath].every(file => typeof file === 'string' && path.isAbsolute(file))
      || await realpath(sdkRoot) !== sdkRoot || await realpath(nodeExecutablePath) !== nodeExecutablePath
      || nodeExecutablePath !== await realpath(process.execPath) || lockFilePath !== path.join(sdkRoot, 'package-lock.json')) reject();
    const rootInfo = await lstat(sdkRoot, { bigint: true });
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || (Number(rootInfo.mode) & 0o777) !== 0o700
      || process.getuid && rootInfo.uid !== BigInt(process.getuid())) reject();
    const lockFile = await observedFile(lockFilePath), lock = JSON.parse(lockFile.bytes);
    if (lock.lockfileVersion !== 3 || lock.packages?.['']?.dependencies?.[PI_SDK_NAME] !== PI_SDK_VERSION) reject();
    const inventory = await sdkInventory(sdkRoot);
    const packages = await verifyInstalledPackages(sdkRoot, lock, inventory);
    const sdk = packages.get(`node_modules/${PI_SDK_NAME}`);
    if (sdk?.name !== PI_SDK_NAME || sdk.version !== PI_SDK_VERSION || sdk.engines?.node !== PI_NODE_RANGE
      || path.posix.normalize(sdk.main ?? '') !== 'dist/index.js'
      || !inventory.some(row => row.relativePath === `node_modules/${PI_SDK_NAME}/dist/index.js`)) reject();
    const node = await observedFile(nodeExecutablePath, 256 * 1024 * 1024), runtime = await observePiRuntimeSourceClosure();
    if (JSON.stringify(identity(rootInfo)) !== JSON.stringify(identity(await lstat(sdkRoot, { bigint: true })))
      || (await observedFile(lockFilePath)).sha256 !== lockFile.sha256
      || digest(json(await sdkInventory(sdkRoot))) !== digest(json(inventory))) reject();
    const descriptor = {
      schemaVersion: PI_TARGET_DESCRIPTOR_SCHEMA_VERSION, execution_profile: 'native-chat', native_runtime: 'pi',
      target: { id: 'pi', packageName: PI_SDK_NAME, version: PI_SDK_VERSION, nodeRange: PI_NODE_RANGE, nodeVersion: process.versions.node },
      rootBinding: { sdkRootDigest: digest(sdkRoot), nodeExecutablePathDigest: digest(nodeExecutablePath), rootIdentity: identity(rootInfo) },
      closure: { lockDigest: lockFile.sha256, sdkClosureDigest: digest(json(inventory)), sdkFileCount: inventory.length,
        nodeExecutableDigest: node.sha256, runtimeSourceDigest: runtime.digest, runtimeFileCount: runtime.fileCount },
      certificationBoundary: { targetIdentityObservationOnly: true, runtimeVerified: false, domainCertified: false, productionApproved: false },
    };
    assertPersistable(descriptor, { subject: 'pi-target-descriptor' });
    return descriptor;
  } catch { reject(); }
}

export function validatePiTargetDescriptor(value) {
  try {
    if (!keys(value, ['schemaVersion', 'execution_profile', 'native_runtime', 'target', 'rootBinding', 'closure', 'certificationBoundary'])
      || value.schemaVersion !== PI_TARGET_DESCRIPTOR_SCHEMA_VERSION || value.execution_profile !== 'native-chat' || value.native_runtime !== 'pi'
      || !keys(value.target, ['id', 'packageName', 'version', 'nodeRange', 'nodeVersion'])
      || value.target.id !== 'pi' || value.target.packageName !== PI_SDK_NAME || value.target.version !== PI_SDK_VERSION
      || value.target.nodeRange !== PI_NODE_RANGE || !isPiNodeSupported(value.target.nodeVersion)
      || !keys(value.rootBinding, ['sdkRootDigest', 'nodeExecutablePathDigest', 'rootIdentity'])
      || !DIGEST.test(value.rootBinding.sdkRootDigest) || !DIGEST.test(value.rootBinding.nodeExecutablePathDigest)
      || !keys(value.rootBinding.rootIdentity, ['device', 'inode', 'birthtimeNs'])
      || !Object.values(value.rootBinding.rootIdentity).every(field => /^[0-9]+$/.test(field))
      || !keys(value.closure, ['lockDigest', 'sdkClosureDigest', 'sdkFileCount', 'nodeExecutableDigest', 'runtimeSourceDigest', 'runtimeFileCount'])
      || !['lockDigest', 'sdkClosureDigest', 'nodeExecutableDigest', 'runtimeSourceDigest'].every(key => DIGEST.test(value.closure[key]))
      || !['sdkFileCount', 'runtimeFileCount'].every(key => Number.isSafeInteger(value.closure[key]) && value.closure[key] > 0 && value.closure[key] <= 20000)
      || !keys(value.certificationBoundary, ['targetIdentityObservationOnly', 'runtimeVerified', 'domainCertified', 'productionApproved'])
      || value.certificationBoundary.targetIdentityObservationOnly !== true
      || ['runtimeVerified', 'domainCertified', 'productionApproved'].some(key => value.certificationBoundary[key] !== false)) reject();
    assertPersistable(value, { subject: 'pi-target-descriptor' });
    return { ok: true, errors: [] };
  } catch { return { ok: false, errors: ['Pi descriptor must bind the fixed observed SDK, Node and source closure.'] }; }
}
