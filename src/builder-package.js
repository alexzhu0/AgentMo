import { constants as FS_CONSTANTS } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { digestRawBytes } from "./artifact-admission.js";
import { readAppendOnlyAuthority } from "./builder-append-only-authority.js";
import {
  assertCodexMarketplaceProjectionFinalBinding,
  buildCodexHostSelector,
  digestCodexConsumerEntry,
  inspectCodexMarketplaceProjectionBinding,
} from "./builder-codex-host.js";
import {
  JavaScriptStaticAnalysisError,
  analyzeJavaScriptSource,
} from "./javascript-static-analysis.js";
import { consumeVerifiedBootstrapSnapshotCapability } from "./builder-bootstrap-snapshot.js";
import { assertBuilderPlatform } from "./builder-platform.js";
import { serializePersistableJson } from "./persistability.js";

const BUILDER_PLUGIN_SOURCE_FILES = Object.freeze([
  ".codex-plugin/plugin.json",
  "agents/agentmo.toml",
  "hooks/agentmo-hook.js",
  "hooks/hooks.json",
  "skills/agentmo/SKILL.md",
]);
const BUILDER_UAT_RELEASE_MANIFEST_SOURCE_PATH = "src/builder-codex-uat-release-manifest.json";
const BUILDER_UAT_RELEASE_MANIFEST_DESCRIPTOR = Object.freeze({
  kind: "runtime",
  sourcePath: BUILDER_UAT_RELEASE_MANIFEST_SOURCE_PATH,
  relativePath: `runtime/agentmo/${BUILDER_UAT_RELEASE_MANIFEST_SOURCE_PATH}`,
  destinationPath: `plugins/agentmo/runtime/agentmo/${BUILDER_UAT_RELEASE_MANIFEST_SOURCE_PATH}`,
});
export const BUILDER_RELEASE_ASSET_INVENTORY = buildBuilderReleaseAssetInventory();
export const BUILDER_PLUGIN_FILES = Object.freeze(BUILDER_RELEASE_ASSET_INVENTORY.map((asset) => asset.relativePath));
export const BUILDER_NPM_METADATA_FILES = Object.freeze([
  "README.md",
  "examples/ai-frontier-poc.seed.json",
  "examples/white-collar-research.sources.json",
]);
export const BUILDER_NPM_FILES_ALLOWLIST = Object.freeze([
  ...BUILDER_NPM_METADATA_FILES,
  ...BUILDER_RELEASE_ASSET_INVENTORY.map((asset) => asset.sourcePath),
  BUILDER_UAT_RELEASE_MANIFEST_SOURCE_PATH,
  "!src/builder-codex-uat-private-authority.js",
].sort((left, right) => left.localeCompare(right)));
export const BUILDER_NPM_TARBALL_INVENTORY = buildBuilderNpmTarballInventory();
export const BUILDER_PLUGIN_HOOK_IO_SURFACE_INVENTORY = Object.freeze([
  "plugin/hooks/agentmo-hook.js:206:filesystem-read:fs.lstat",
  "plugin/hooks/agentmo-hook.js:208:filesystem-read:fs.realpath",
  "plugin/hooks/agentmo-hook.js:221:filesystem-read:fs.realpath",
  "plugin/hooks/agentmo-hook.js:223:filesystem-read:fs.lstat",
  "plugin/hooks/agentmo-hook.js:224:filesystem-read:fs.lstat",
  "plugin/hooks/agentmo-hook.js:225:filesystem-read:fs.realpath",
  "plugin/hooks/agentmo-hook.js:321:filesystem-read:fs.lstat",
  "plugin/hooks/agentmo-hook.js:322:filesystem-read:fs.realpath",
  "plugin/hooks/agentmo-hook.js:333:filesystem-read:fs.lstat",
  "plugin/hooks/agentmo-hook.js:334:filesystem-read:fs.realpath",
  "plugin/hooks/agentmo-hook.js:338:filesystem-open:fs.open",
  "plugin/hooks/agentmo-hook.js:339:file-handle-read:FileHandle.stat",
  "plugin/hooks/agentmo-hook.js:342:file-handle-read:FileHandle.stat",
  "plugin/hooks/agentmo-hook.js:343:filesystem-read:fs.lstat",
  "plugin/hooks/agentmo-hook.js:414:filesystem-read:fs.lstat",
  "plugin/hooks/agentmo-hook.js:416:filesystem-read:fs.realpath",
  "plugin/hooks/agentmo-hook.js:419:filesystem-open:fs.open",
  "plugin/hooks/agentmo-hook.js:420:file-handle-read:FileHandle.stat",
  "plugin/hooks/agentmo-hook.js:423:filesystem-read:fs.lstat",
  "plugin/hooks/agentmo-hook.js:432:file-handle-read:FileHandle.stat",
  "plugin/hooks/agentmo-hook.js:434:file-handle-read:FileHandle.readFile",
  "plugin/hooks/agentmo-hook.js:655:filesystem-read:fs.lstat",
  "plugin/hooks/agentmo-hook.js:657:filesystem-open:fs.open",
  "plugin/hooks/agentmo-hook.js:661:file-handle-read:FileHandle.stat",
  "plugin/hooks/agentmo-hook.js:662:filesystem-read:fs.lstat",
  "plugin/hooks/agentmo-hook.js:688:filesystem-read:fs.lstat",
  "plugin/hooks/agentmo-hook.js:704:file-handle-read:FileHandle.stat",
  "plugin/hooks/agentmo-hook.js:705:filesystem-read:fs.lstat",
  "plugin/hooks/agentmo-hook.js:713:filesystem-read:fs.lstat",
  "plugin/hooks/agentmo-hook.js:777:filesystem-read:fs.readdir",
  "plugin/hooks/agentmo-hook.js:801:filesystem-read:fs.lstat",
  "plugin/hooks/agentmo-hook.js:813:filesystem-read:fs.lstat",
  "plugin/hooks/agentmo-hook.js:814:filesystem-read:fs.readlink",
  "plugin/hooks/agentmo-hook.js:815:filesystem-read:fs.lstat",
  "plugin/hooks/agentmo-hook.js:1924:process-spawn:child_process.spawn",
  "plugin/hooks/agentmo-hook.js:2021:stream-write:stdin.end",
  "plugin/hooks/agentmo-hook.js:2022:stream-write:null.end",
  "plugin/hooks/agentmo-hook.js:2023:stream-write:null.end",
  "plugin/hooks/agentmo-hook.js:2129:process-output:process.stdout.write",
]);
const BUILDER_PLUGIN_HOOK_LOADER_INVENTORY = Object.freeze([
  "plugin/hooks/agentmo-hook.js:3:static-import:node:child_process",
  "plugin/hooks/agentmo-hook.js:4:static-import:node:crypto",
  "plugin/hooks/agentmo-hook.js:5:static-import:node:fs",
  "plugin/hooks/agentmo-hook.js:6:static-import:node:fs/promises",
  "plugin/hooks/agentmo-hook.js:13:static-import:node:path",
  "plugin/hooks/agentmo-hook.js:14:static-import:node:url",
]);
const BUILDER_PLUGIN_HOOK_BOOTSTRAP_FUNCTION_DIGESTS = Object.freeze({
  admitBootstrapRelease: "sha256:e325ff05ed288e7ae9c073d52ab6c8fac05e70ef1a0c716aefb1a99431f798c0",
  buildAuthenticatedBootstrapGraph: "sha256:910dde7a6695a1d647c3c939251bf4a3be80f70af0ce881940a3ad867c27b190",
  runAdjacentLauncher: "sha256:894e98d0747e23186caabb72f0a755089b303da7ffe4f07cd984f11ec22ed0c2",
});
const BUILDER_PLUGIN_HOOK_LOADER_SOURCE_DIGEST =
  "sha256:28960196738bc0c1ce33bd63fc176bc91cad107aeb85337a116694071735f4fa";
const BUILDER_POSIX_EFFECT_CHILD_FUNCTION_DIGEST =
  "sha256:9ce8bd1ffc929ba3760ba6c11012deceae8fb54c46355b760dcdd77d0335541e";
const BUILDER_POSIX_EFFECT_RUN_FUNCTION_DIGEST =
  "sha256:feed5d9126c94da1db06e687aa9d1a38b86f6db0f9801104b7d769bf063054ab";
const MODULE_PACKAGE_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
// CLI aggregation is a legitimate executable source member; keep a bounded
// headroom above the historic 256 KiB ceiling without accepting arbitrary blobs.
const MAX_PACKAGE_FILE_BYTES = 320 * 1024;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const BUILDER_UAT_RELEASE_SET_COMMIT_NAME = "agentmo-builder-uat-release-set.json";
const BUILDER_UAT_RELEASE_SET_COMMIT_STAGE_NAME = ".agentmo-builder-uat-release-set.stage.json";
const BUILDER_UAT_RETAINED_TARBALL_NAMES = Object.freeze({
  baseline: ".agentmo-builder-uat-baseline.retained.tgz",
  successor: ".agentmo-builder-uat-successor.retained.tgz",
});
const PROJECTED_RUNTIME_RELATIVE_PATH = "plugins/agentmo/runtime/agentmo";
const PROJECTED_PLUGIN_RELATIVE_PATH = "plugins/agentmo";
const PROJECTED_RECEIPT_PATH = ".agentmo/builder/install-receipt.json";
const PROJECTED_MARKER_PATH = ".agentmo/builder/install-marker.json";
const STABLE_RUNTIME_RELATIVE_PATH = path.join("marketplace", "agentmo-local", "plugins", "agentmo", "runtime", "agentmo");
const BOOTSTRAP_GRAPH_MODE = "authenticated-graph-v1";
const MARKETPLACE_DESCRIPTOR_RELATIVE_PATH = ".agents/plugins/marketplace.json";

export class BuilderPackageError extends Error {
  constructor(code) {
    super("Builder package could not be admitted.");
    this.name = "BuilderPackageError";
    this.code = code;
  }
}

export async function loadBuilderPackage(options = {}) {
  assertBuilderPlatform();
  assertBuilderPackageLoadOptions(options);
  validateBuilderReleaseAssetInventory(BUILDER_RELEASE_ASSET_INVENTORY);
  const layout = await resolveBuilderPackageLayout(options);
  return loadBuilderPackageFromLayout(layout);
}

export async function loadVerifiedBootstrapSnapshotPackage(options = {}) {
  assertBuilderPlatform();
  if (!exactKeys(options, [
    "bootstrapCapability", "expectedReceiptDigest", "projectionBinding", "runnerDigest",
  ])
    || !DIGEST_PATTERN.test(options.expectedReceiptDigest ?? "")
    || !DIGEST_PATTERN.test(options.runnerDigest ?? "")) {
    fail("AGENTMO_BUILDER_PACKAGE_LAYOUT_INVALID");
  }
  const bootstrapRecord = consumeVerifiedBootstrapSnapshotCapability({
    bootstrapCapability: options.bootstrapCapability,
    projectionBinding: options.projectionBinding,
    receiptDigest: options.expectedReceiptDigest,
    runnerDigest: options.runnerDigest,
  });
  if (bootstrapRecord === null) {
    fail("AGENTMO_BUILDER_PACKAGE_LAYOUT_INVALID");
  }
  const layout = admitBootstrapSnapshotLayout(MODULE_PACKAGE_ROOT, options, bootstrapRecord.files);
  validateBuilderReleaseAssetInventory(BUILDER_RELEASE_ASSET_INVENTORY);
  return loadBuilderPackageFromLayout(layout);
}

export async function inspectBuilderPackageForDiagnostics(options = {}) {
  assertBuilderPlatform();
  const resultBasis = {
    schemaVersion: "agentmo.builder-package-diagnostic.v1",
    diagnosticOnly: true,
    trustAnchorVerified: false,
    supportCertified: false,
  };
  try {
    if (options === null || typeof options !== "object" || Array.isArray(options)
      || !exactKeys(options, [
        "expectedReceiptDigest", "packageOptions", "projectRoot",
      ].filter((key) => Object.hasOwn(options, key)))
      || (options.packageOptions !== undefined
        && !validBuilderPackageLoadOptions(options.packageOptions))) {
      fail("AGENTMO_BUILDER_PACKAGE_LAYOUT_INVALID");
    }
    const projectRoot = await admitCanonicalPackageRoot(options.projectRoot);
    const packageRootOption = options.packageOptions?.packageRoot;
    const packageRoot = await admitCanonicalPackageRoot(packageRootOption ?? MODULE_PACKAGE_ROOT);
    let layout;
    let source;
    if (packageRootOption !== undefined
      && options.packageOptions?.immutableLifecycleSelection === true) {
      layout = await admitReceiptBackedImmutableLifecycleLayout(packageRoot, {
        ...options.packageOptions,
        projectRoot,
        expectedReceiptDigest: options.expectedReceiptDigest,
      });
      source = "immutable-lifecycle";
    } else if (packageRootOption !== undefined) {
      layout = Object.freeze({ kind: "self-contained", packageRoot, pluginRoot: packageRoot });
      source = "self-contained";
    } else if (packageRoot === MODULE_PACKAGE_ROOT && await hasSelfContainedPluginEntry(packageRoot)) {
      const kind = await hasRepositorySourceMarker(packageRoot) ? "source-tree" : "self-contained";
      layout = Object.freeze({ kind, packageRoot, pluginRoot: packageRoot });
      source = kind;
    } else if (hasExactStableRuntimeSuffix(packageRoot)) {
      layout = await admitReceiptBackedStableLayout(packageRoot, options);
      source = "stable-projection";
    } else {
      layout = await admitProjectedDiagnosticLayout(packageRoot, projectRoot);
      source = "projected";
    }
    const release = await loadBuilderPackageFromLayout(layout);
    return Object.freeze({
      ...resultBasis,
      source,
      status: "observed",
      candidate: summarizeDiagnosticCandidate(release),
    });
  } catch {
    return Object.freeze({
      ...resultBasis,
      source: "unresolved",
      status: "inconsistent",
      candidate: null,
    });
  }
}

function summarizeDiagnosticCandidate(release) {
  return Object.freeze({
    name: release.name,
    version: release.version,
    adapterId: release.adapterId,
    observedReleaseDigest: release.releaseDigest,
    assetObservations: Object.freeze(release.assets.map((asset) => Object.freeze({
      kind: asset.kind,
      sourcePath: asset.sourcePath,
      relativePath: asset.relativePath,
      destinationPath: asset.destinationPath,
      observedDigest: asset.digest,
      observedByteLength: asset.byteLength,
    }))),
  });
}

async function loadBuilderPackageFromLayout(layout) {
  validateBuilderReleaseAssetInventory(BUILDER_RELEASE_ASSET_INVENTORY);
  const packageBytes = await readBuilderPackageFile(layout, "package.json", MAX_PACKAGE_FILE_BYTES);
  const packageManifest = parseJsonAsset(packageBytes);
  if (
    packageManifest?.name !== "agentmo"
    || !VERSION_PATTERN.test(packageManifest?.version ?? "")
    || packageManifest?.type !== "module"
    || packageManifest?.bin?.agentmo !== "./bin/agentmo.js"
  ) {
    fail("AGENTMO_BUILDER_PACKAGE_INVALID");
  }
  validatePackageManifestSurface(packageManifest);
  if (!sameStringArray(packageManifest.files, BUILDER_NPM_FILES_ALLOWLIST)) {
    fail("AGENTMO_BUILDER_PACKAGE_FILES_INVALID");
  }

  const packageClosure = await captureBuilderPackageFileClosure(layout);

  const assets = [];
  for (const descriptor of BUILDER_RELEASE_ASSET_INVENTORY) {
    const bytes = descriptor.sourcePath === "package.json"
      ? packageBytes
      : await readBuilderAsset(layout, descriptor);
    assets.push(Object.freeze({
      ...descriptor,
      digest: digestRawBytes(bytes),
      byteLength: bytes.byteLength,
      bytes,
    }));
  }
  if (packageClosure?.includesUatReleaseManifest === true) {
    const bytes = await readBuilderAsset(layout, BUILDER_UAT_RELEASE_MANIFEST_DESCRIPTOR);
    assets.push(Object.freeze({
      ...BUILDER_UAT_RELEASE_MANIFEST_DESCRIPTOR,
      digest: digestRawBytes(bytes),
      byteLength: bytes.byteLength,
      bytes,
    }));
  }
  validateBuilderExecutableClosure(assets);

  const pluginManifestAsset = assets.find(
    (asset) => asset.sourcePath === "plugin/.codex-plugin/plugin.json",
  );
  const pluginManifest = parseJsonAsset(pluginManifestAsset?.bytes);
  if (
    pluginManifest?.name !== packageManifest.name
    || pluginManifest?.version !== packageManifest.version
    || pluginManifest?.skills !== "./skills/"
  ) {
    fail("AGENTMO_BUILDER_PACKAGE_IDENTITY_MISMATCH");
  }
  validatePluginManifestSurface(pluginManifest);
  validatePluginHookEntrypoints(assets);
  validateUatReleaseManifestAsset(packageManifest, assets);
  await revalidateBuilderPackageFileClosure(layout, packageClosure);

  const releaseBasis = {
    schemaVersion: "agentmo.builder-release-basis.v1",
    name: packageManifest.name,
    version: packageManifest.version,
    adapterId: "codex",
    assets: assets.map(({
      kind, sourcePath, relativePath, destinationPath, digest, byteLength,
    }) => ({ kind, sourcePath, relativePath, destinationPath, digest, byteLength })),
  };
  const releaseDigest = digestRawBytes(Buffer.from(
    serializePersistableJson(releaseBasis, { subject: "builder-release-basis" }),
    "utf8",
  ));
  buildCodexHostSelector({
    name: packageManifest.name,
    version: packageManifest.version,
    adapterId: "codex",
    releaseDigest,
  });
  if (layout.kind === "projected") {
    validateProjectedReleaseBinding(layout, packageManifest, assets, releaseDigest);
  } else if (layout.kind === "stable-projection") {
    validateStableProjectionReleaseBinding(layout, packageManifest, releaseDigest);
  } else if (layout.kind === "immutable-lifecycle") {
    validateImmutableLifecycleReleaseBinding(layout, packageManifest, releaseDigest);
  } else if (layout.kind === "bootstrap-graph") {
    validateBootstrapSnapshotReleaseBinding(layout, assets, releaseDigest);
  }
  return Object.freeze({
    name: packageManifest.name,
    version: packageManifest.version,
    adapterId: "codex",
    releaseDigest,
    assets: Object.freeze(assets),
  });
}

export async function readBoundedNoFollowFile(filePath, maxBytes = MAX_PACKAGE_FILE_BYTES) {
  assertBuilderPlatform();
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  let before;
  let handle;
  try {
    before = await lstat(filePath, { bigint: true });
    if (before.isSymbolicLink() || !before.isFile() || before.size > BigInt(maxBytes)) {
      fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
    }
    const flags = FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW;
    handle = await open(filePath, flags);
    const retainedBefore = await handle.stat({ bigint: true });
    if (!sameStableFile(before, retainedBefore)) fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
    const bytes = await readHandleBounded(handle, maxBytes);
    const retainedAfter = await handle.stat({ bigint: true });
    const after = await lstat(filePath, { bigint: true });
    if (
      !sameStableFile(retainedBefore, retainedAfter)
      || !sameStableFile(retainedAfter, after)
      || BigInt(bytes.byteLength) !== retainedAfter.size
    ) {
      fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
    }
    return bytes;
  } catch (error) {
    if (error instanceof BuilderPackageError) throw error;
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function readBoundedBuilderUatReleaseFile(
  filePath,
  maxBytes = MAX_PACKAGE_FILE_BYTES,
) {
  assertBuilderPlatform();
  if (arguments.length > 2 || !Number.isInteger(maxBytes) || maxBytes <= 0) {
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }
  const admission = await readBuilderUatReleaseFileAdmission(
    filePath,
    maxBytes,
    null,
    true,
  );
  return admission.bytes;
}

export async function admitBuilderUatReleaseMember(options) {
  assertBuilderPlatform();
  if (!exactKeys(options, ["expectedRole", "maxBytes", "packageRoot", "tarballPath"])
    || !["baseline", "successor"].includes(options.expectedRole)
    || typeof options.packageRoot !== "string"
    || options.packageRoot.length === 0
    || typeof options.tarballPath !== "string"
    || options.tarballPath.length === 0
    || !Number.isInteger(options.maxBytes)
    || options.maxBytes <= 0) {
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }
  const [release, admission] = await Promise.all([
    loadBuilderPackage({ packageRoot: options.packageRoot }),
    readBuilderUatReleaseFileAdmission(
      options.tarballPath,
      options.maxBytes,
      options.expectedRole,
      false,
    ),
  ]);
  const manifestAsset = release.assets.find(
    (asset) => asset.sourcePath === BUILDER_UAT_RELEASE_MANIFEST_SOURCE_PATH,
  );
  const verifierAsset = release.assets.find(
    (asset) => asset.sourcePath === "scripts/verify-codex-uat-candidate.js",
  );
  const continuationAsset = release.assets.find(
    (asset) => asset.sourcePath === "src/builder-codex-uat-continuation.js",
  );
  await assertExactBuilderNpmTarballExtraction(
    admission.bytes,
    release,
    options.packageRoot,
  );
  const identity = admission.releaseIdentity;
  if (admission.member.role !== options.expectedRole
    || identity.packageName !== release.name
    || identity.version !== release.version
    || identity.releaseDigest !== release.releaseDigest
    || identity.tarballDigest !== admission.digest
    || identity.manifestDigest !== manifestAsset?.digest
    || identity.verifierDigest !== verifierAsset?.digest
    || identity.continuationDigest !== continuationAsset?.digest) {
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }
  return Object.freeze({
    role: admission.member.role,
    packageName: identity.packageName,
    version: identity.version,
    releaseDigest: identity.releaseDigest,
    tarballDigest: identity.tarballDigest,
    manifestDigest: identity.manifestDigest,
    verifierDigest: identity.verifierDigest,
    continuationDigest: identity.continuationDigest,
    releaseSetDigest: admission.releaseSetDigest,
    operationId: admission.operationId,
    releaseSet: admission.releaseSet,
    release,
  });
}

export async function admitBuilderUatReleasePair(options) {
  assertBuilderPlatform();
  if (!exactKeys(options, ["baseline", "maxBytes", "successor"])
    || !exactBuilderUatReleasePairMemberRequest(options.baseline)
    || !exactBuilderUatReleasePairMemberRequest(options.successor)
    || !Number.isInteger(options.maxBytes)
    || options.maxBytes <= 0) {
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }
  const [baselineAdmission, successorAdmission] = await Promise.all([
    admitBuilderUatReleaseMember({
      ...options.baseline,
      expectedRole: "baseline",
      maxBytes: options.maxBytes,
    }),
    admitBuilderUatReleaseMember({
      ...options.successor,
      expectedRole: "successor",
      maxBytes: options.maxBytes,
    }),
  ]);
  if (baselineAdmission.operationId !== successorAdmission.operationId
    || baselineAdmission.releaseSetDigest !== successorAdmission.releaseSetDigest
    || !sameBuilderUatReleaseSet(
      baselineAdmission.releaseSet,
      successorAdmission.releaseSet,
    )
    || !sameBuilderUatReleaseIdentity(
      baselineAdmission,
      baselineAdmission.releaseSet.baseline,
    )
    || !sameBuilderUatReleaseIdentity(
      successorAdmission,
      successorAdmission.releaseSet.successor,
    )) {
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }
  return Object.freeze({
    operationId: baselineAdmission.operationId,
    releaseSetDigest: baselineAdmission.releaseSetDigest,
    baseline: builderUatReleaseTuple(baselineAdmission),
    successor: builderUatReleaseTuple(successorAdmission),
    releaseSet: Object.freeze({
      baseline: Object.freeze({ ...baselineAdmission.releaseSet.baseline }),
      successor: Object.freeze({ ...baselineAdmission.releaseSet.successor }),
    }),
  });
}

function exactBuilderUatReleasePairMemberRequest(value) {
  return exactKeys(value, ["packageRoot", "tarballPath"])
    && typeof value.packageRoot === "string"
    && value.packageRoot.length > 0
    && typeof value.tarballPath === "string"
    && value.tarballPath.length > 0;
}

function builderUatReleaseTuple(admission) {
  return Object.freeze({
    packageName: admission.packageName,
    version: admission.version,
    releaseDigest: admission.releaseDigest,
    tarballDigest: admission.tarballDigest,
  });
}

function sameBuilderUatReleaseSet(left, right) {
  return sameBuilderUatReleaseIdentity(left?.baseline, right?.baseline)
    && sameBuilderUatReleaseIdentity(left?.successor, right?.successor);
}

function sameBuilderUatReleaseIdentity(left, right) {
  return left?.packageName === right?.packageName
    && left?.version === right?.version
    && left?.releaseDigest === right?.releaseDigest
    && left?.tarballDigest === right?.tarballDigest
    && left?.manifestDigest === right?.manifestDigest
    && left?.verifierDigest === right?.verifierDigest
    && left?.continuationDigest === right?.continuationDigest;
}

async function assertExactBuilderNpmTarballExtraction(tarballBytes, release, packageRoot) {
  const resolvedPackageRoot = path.resolve(packageRoot);
  const metadataEntries = await Promise.all(BUILDER_NPM_METADATA_FILES.map(async (relativePath) => [
    relativePath,
    await readBoundedNoFollowFile(
      path.join(resolvedPackageRoot, ...relativePath.split("/")),
      MAX_PACKAGE_FILE_BYTES,
    ),
  ]));
  const expectedFiles = new Map([
    ...release.assets.map((asset) => [asset.sourcePath, asset.bytes]),
    ...metadataEntries,
  ]);
  const expectedPaths = [...expectedFiles.keys()].sort((left, right) => left.localeCompare(right));
  const requiredPaths = buildBuilderNpmTarballInventory({ includeUatReleaseManifest: true });
  if (!sameStringArray(expectedPaths, requiredPaths)) {
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }
  const maximumExpandedBytes = [...expectedFiles.values()]
    .reduce((total, bytes) => total + bytes.byteLength + 1024, 1024);
  let expanded;
  try {
    expanded = gunzipSync(tarballBytes, { maxOutputLength: maximumExpandedBytes });
  } catch {
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }
  const archivedFiles = parseExactNpmTarArchive(expanded);
  const archivedPaths = [...archivedFiles.keys()].sort((left, right) => left.localeCompare(right));
  if (!sameStringArray(archivedPaths, expectedPaths)) {
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }
  for (const [relativePath, expectedBytes] of expectedFiles) {
    if (!archivedFiles.get(relativePath)?.equals(expectedBytes)) {
      fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
    }
  }
}

function parseExactNpmTarArchive(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.byteLength === 0 || bytes.byteLength % 512 !== 0) {
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }
  const files = new Map();
  let offset = 0;
  let zeroBlocks = 0;
  while (offset < bytes.byteLength) {
    const header = bytes.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) {
      zeroBlocks += 1;
      if (zeroBlocks >= 2) {
        if (!bytes.subarray(offset).every((byte) => byte === 0)) {
          fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
        }
        break;
      }
      continue;
    }
    if (zeroBlocks !== 0
      || header.subarray(257, 263).toString("ascii") !== "ustar\0"
      || header.subarray(263, 265).toString("ascii") !== "00") {
      fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
    }
    assertExactTarHeaderChecksum(header);
    const type = header[156];
    if ((type !== 0 && type !== 0x30)
      || exactTarText(header.subarray(157, 257)) !== "") {
      fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
    }
    const name = exactTarText(header.subarray(0, 100));
    const prefix = exactTarText(header.subarray(345, 500));
    const archivePath = prefix === "" ? name : `${prefix}/${name}`;
    if (!archivePath.startsWith("package/")) fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
    const relativePath = archivePath.slice("package/".length);
    if (!portableAssetPath(relativePath) || files.has(relativePath)) {
      fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
    }
    const size = exactTarOctal(header.subarray(124, 136));
    const padding = (512 - (size % 512)) % 512;
    if (offset + size + padding > bytes.byteLength) {
      fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
    }
    files.set(relativePath, Buffer.from(bytes.subarray(offset, offset + size)));
    if (!bytes.subarray(offset + size, offset + size + padding)
      .every((byte) => byte === 0)) fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
    offset += size + padding;
  }
  if (zeroBlocks < 2 || files.size === 0) fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  return files;
}

function assertExactTarHeaderChecksum(header) {
  const expected = exactTarOctal(header.subarray(148, 156));
  const normalized = Buffer.from(header);
  normalized.fill(0x20, 148, 156);
  const actual = normalized.reduce((sum, byte) => sum + byte, 0);
  if (actual !== expected) fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
}

function exactTarText(bytes) {
  const terminator = bytes.indexOf(0);
  if (terminator !== -1
    && !bytes.subarray(terminator).every((byte) => byte === 0)) {
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }
  const value = bytes.subarray(0, terminator === -1 ? bytes.length : terminator);
  if (value.some((byte) => byte < 0x20 || byte > 0x7e)) {
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }
  return value.toString("ascii");
}

function exactTarOctal(bytes) {
  const raw = bytes.toString("ascii");
  if (!/^[ 0-7]*(?:\0[ ]*)?$/u.test(raw)) fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  const text = raw.replace(/\0[ ]*$/u, "").trim();
  if (!/^[0-7]+$/u.test(text)) fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  return value;
}

async function readBuilderUatReleaseFileAdmission(
  filePath,
  maxBytes,
  expectedRole,
  allowUncommitted,
) {
  const requestedPath = path.resolve(filePath);
  let requestedBefore;
  try {
    requestedBefore = await lstat(requestedPath, { bigint: true });
  } catch {
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }
  const outputDirectory = path.dirname(requestedPath);
  const commitPath = path.join(outputDirectory, BUILDER_UAT_RELEASE_SET_COMMIT_NAME);
  let commitExists = false;
  try {
    const commitStats = await lstat(commitPath, { bigint: true });
    commitExists = true;
    if (!commitStats.isFile() || commitStats.isSymbolicLink() || commitStats.nlink !== 2n) {
      fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
    }
  } catch (error) {
    if (error instanceof BuilderPackageError) throw error;
    if (error?.code !== "ENOENT") fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }
  if (allowUncommitted && !commitExists && requestedBefore.nlink === 1n) {
    const bytes = await readBoundedNoFollowFile(requestedPath, maxBytes);
    return Object.freeze({ bytes, digest: digestRawBytes(bytes), member: null, releaseIdentity: null });
  }
  if (!commitExists
    || requestedBefore.nlink !== 2n
    || !requestedBefore.isFile()
    || requestedBefore.isSymbolicLink()
    || requestedBefore.size > BigInt(maxBytes)) {
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }

  let canonicalPath;
  try {
    canonicalPath = await realpath(requestedPath);
  } catch {
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }
  const destination = await readStableFileWithExpectedLinks(canonicalPath, maxBytes, 2n);
  if (!sameStableFileWithLinks(requestedBefore, destination.stats, 2n)) {
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }

  const canonicalOutputDirectory = path.dirname(canonicalPath);
  if (path.basename(canonicalOutputDirectory) !== path.basename(outputDirectory)) {
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }
  const outputParent = path.dirname(canonicalOutputDirectory);
  const canonicalCommitPath = path.join(
    canonicalOutputDirectory,
    BUILDER_UAT_RELEASE_SET_COMMIT_NAME,
  );
  const commitBefore = await readStableFileWithExpectedLinks(
    canonicalCommitPath,
    MAX_PACKAGE_FILE_BYTES,
    2n,
  );
  const authority = parseBuilderUatReleaseSet(commitBefore.bytes);
  const publication = authority.publication;
  if (publication.outputBasename !== path.basename(outputDirectory)
    || publication.outputBasename !== path.basename(canonicalOutputDirectory)) {
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }
  const publicRelativePath = path.basename(canonicalPath);
  const member = publication.members.find((entry) => (
    entry.publicRelativePath === publicRelativePath
  ));
  if (!member || (expectedRole !== null && member.role !== expectedRole)
    || member.digest !== digestRawBytes(destination.bytes)
    || !samePersistedFileIdentity(destination.stats, member.identity)) {
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }

  const retainedCommitPath = path.join(
    canonicalOutputDirectory,
    publication.commitRetainedRelativePath,
  );
  const retainedPath = path.join(
    canonicalOutputDirectory,
    member.retainedRelativePath,
  );
  const [outputParentBefore, outputDirectoryBefore] = await Promise.all([
    lstat(outputParent, { bigint: true }),
    lstat(canonicalOutputDirectory, { bigint: true }),
  ]);
  if (!samePersistedDirectoryIdentity(outputParentBefore, publication.outputParentIdentity)
    || !samePersistedDirectoryIdentity(outputDirectoryBefore, publication.outputDirectoryIdentity)) {
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }
  const outputChainBefore = await captureCanonicalDirectoryChain(
    outputParent,
    canonicalOutputDirectory,
  );
  const [retained, retainedCommitBefore] = await Promise.all([
    readStableFileWithExpectedLinks(retainedPath, maxBytes, 2n),
    readStableFileWithExpectedLinks(retainedCommitPath, MAX_PACKAGE_FILE_BYTES, 2n),
  ]);
  if (retainedCommitBefore.stats.dev !== commitBefore.stats.dev
    || retainedCommitBefore.stats.ino !== commitBefore.stats.ino
    || !retainedCommitBefore.bytes.equals(commitBefore.bytes)) {
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }
  const [
    destinationAfter,
    retainedAfter,
    commitAfter,
    retainedCommitAfter,
    outputMembers,
    requestedAfter,
  ] = await Promise.all([
    readStableFileWithExpectedLinks(canonicalPath, maxBytes, 2n),
    readStableFileWithExpectedLinks(retainedPath, maxBytes, 2n),
    readStableFileWithExpectedLinks(canonicalCommitPath, MAX_PACKAGE_FILE_BYTES, 2n),
    readStableFileWithExpectedLinks(retainedCommitPath, MAX_PACKAGE_FILE_BYTES, 2n),
    readdir(canonicalOutputDirectory),
    lstat(requestedPath, { bigint: true }),
  ]);
  const outputChainAfter = await captureCanonicalDirectoryChain(
    outputParent,
    canonicalOutputDirectory,
  );
  const [outputParentAfter, outputDirectoryAfter] = await Promise.all([
    lstat(outputParent, { bigint: true }),
    lstat(canonicalOutputDirectory, { bigint: true }),
  ]);
  const expectedMembers = [
    ...publication.members.flatMap((entry) => [
      entry.publicRelativePath,
      entry.retainedRelativePath,
    ]),
    BUILDER_UAT_RELEASE_SET_COMMIT_NAME,
    publication.commitRetainedRelativePath,
  ].sort((left, right) => left.localeCompare(right));
  if (new Set(expectedMembers).size !== expectedMembers.length
    || !sameDirectoryChain(outputChainBefore, outputChainAfter)
    || !samePersistedDirectoryIdentity(outputParentAfter, publication.outputParentIdentity)
    || !samePersistedDirectoryIdentity(outputDirectoryAfter, publication.outputDirectoryIdentity)
    || commitAfter.stats.dev !== commitBefore.stats.dev
    || commitAfter.stats.ino !== commitBefore.stats.ino
    || !commitAfter.bytes.equals(commitBefore.bytes)
    || retainedCommitAfter.stats.dev !== commitBefore.stats.dev
    || retainedCommitAfter.stats.ino !== commitBefore.stats.ino
    || !retainedCommitAfter.bytes.equals(commitBefore.bytes)
    || JSON.stringify(outputMembers.sort((left, right) => left.localeCompare(right)))
      !== JSON.stringify(expectedMembers)
    || retained.stats.dev !== destination.stats.dev
    || retained.stats.ino !== destination.stats.ino
    || !retained.bytes.equals(destination.bytes)
    || retainedAfter.stats.dev !== retained.stats.dev
    || retainedAfter.stats.ino !== retained.stats.ino
    || !retainedAfter.bytes.equals(retained.bytes)
    || destinationAfter.stats.dev !== destination.stats.dev
    || destinationAfter.stats.ino !== destination.stats.ino
    || !destinationAfter.bytes.equals(destination.bytes)
    || !sameStableFileWithLinks(requestedAfter, destinationAfter.stats, 2n)) {
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }
  return Object.freeze({
    bytes: destination.bytes,
    digest: member.digest,
    member,
    releaseIdentity: authority[member.role],
    releaseSet: Object.freeze({
      baseline: Object.freeze({ ...authority.baseline }),
      successor: Object.freeze({ ...authority.successor }),
    }),
    releaseSetDigest: digestRawBytes(commitBefore.bytes),
    operationId: authority.operationId,
  });
}

function parseBuilderUatReleaseSet(bytes) {
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }
  if (!exactKeys(value, [
    "baseline", "operationId", "predecessor", "publication",
    "schemaVersion", "status", "successor",
  ])
    || value.schemaVersion !== "agentmo.builder-uat-release-set.v3"
    || value.status !== "built"
    || !DIGEST_PATTERN.test(value.operationId ?? "")
    || value.predecessor !== null
    || !exactBuilderUatReleaseIdentity(value.baseline)
    || !exactBuilderUatReleaseIdentity(value.successor)
    || value.baseline.version === value.successor.version
    || !exactBuilderUatReleasePublication(value.publication, value)
    || !Buffer.from(serializePersistableJson(value, {
      subject: "builder-uat-release-set",
    }), "utf8").equals(bytes)) {
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }
  const expectedOperationId = digestRawBytes(Buffer.from(serializePersistableJson({
    schemaVersion: "agentmo.builder-uat-release-operation-basis.v2",
    predecessor: null,
    baseline: value.baseline,
    successor: value.successor,
    publication: value.publication,
  }, { subject: "builder-uat-release-operation-basis" }), "utf8"));
  if (value.operationId !== expectedOperationId) fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  return value;
}

function exactBuilderUatReleaseIdentity(value) {
  return exactKeys(value, [
    "continuationDigest", "manifestDigest", "packageName", "releaseDigest",
    "tarballDigest", "verifierDigest", "version",
  ])
    && value.packageName === "agentmo"
    && VERSION_PATTERN.test(value.version ?? "")
    && [
      value.releaseDigest,
      value.tarballDigest,
      value.continuationDigest,
      value.verifierDigest,
      value.manifestDigest,
    ].every((digest) => DIGEST_PATTERN.test(digest ?? ""));
}

function exactBuilderUatReleasePublication(value, releaseSet) {
  if (!exactKeys(value, [
    "commitRetainedRelativePath", "members", "outputBasename", "outputDirectoryIdentity",
    "outputParentIdentity", "schemaVersion",
  ])
    || value.schemaVersion !== "agentmo.builder-uat-release-publication.v2"
    || !portablePathSegment(value.outputBasename)
    || value.commitRetainedRelativePath !== BUILDER_UAT_RELEASE_SET_COMMIT_STAGE_NAME
    || !portablePathSegment(value.commitRetainedRelativePath)
    || !exactPersistedDirectoryIdentity(value.outputParentIdentity)
    || !exactPersistedDirectoryIdentity(value.outputDirectoryIdentity)
    || !Array.isArray(value.members)
    || value.members.length !== 2) return false;
  const roles = new Set();
  for (const member of value.members) {
    if (!exactKeys(member, [
      "digest", "identity", "publicRelativePath", "retainedRelativePath", "role",
    ])
      || !["baseline", "successor"].includes(member.role)
      || roles.has(member.role)
      || !portablePathSegment(member.publicRelativePath)
      || member.publicRelativePath !== `agentmo-${releaseSet[member.role].version}.tgz`
      || member.retainedRelativePath !== BUILDER_UAT_RETAINED_TARBALL_NAMES[member.role]
      || member.digest !== releaseSet[member.role].tarballDigest
      || !exactPersistedFileIdentity(member.identity)) return false;
    roles.add(member.role);
  }
  return roles.size === 2;
}

function portablePathSegment(value) {
  return typeof value === "string"
    && value.length > 0
    && value !== "."
    && value !== ".."
    && !value.includes("/")
    && !value.includes("\\")
    && !value.includes("\0");
}

function exactPersistedDirectoryIdentity(value) {
  return exactKeys(value, ["device", "inode", "mode", "owner"])
    && Object.values(value).every((item) => typeof item === "string" && /^\d+$/u.test(item));
}

function exactPersistedFileIdentity(value) {
  return exactKeys(value, [
    "changedNs", "device", "inode", "links", "mode", "modifiedNs", "owner", "size",
  ])
    && value.links === "2"
    && Object.values(value).every((item) => typeof item === "string" && /^\d+$/u.test(item));
}

function samePersistedDirectoryIdentity(stats, expected) {
  return exactPersistedDirectoryIdentity(expected)
    && stats.isDirectory()
    && !stats.isSymbolicLink()
    && stats.dev.toString(10) === expected.device
    && stats.ino.toString(10) === expected.inode
    && stats.uid.toString(10) === expected.owner
    && stats.mode.toString(10) === expected.mode;
}

function samePersistedFileIdentity(stats, expected) {
  return exactPersistedFileIdentity(expected)
    && stats.dev.toString(10) === expected.device
    && stats.ino.toString(10) === expected.inode
    && stats.nlink.toString(10) === expected.links
    && stats.size.toString(10) === expected.size
    && stats.uid.toString(10) === expected.owner
    && stats.mode.toString(10) === expected.mode
    && stats.mtimeNs.toString(10) === expected.modifiedNs
    && stats.ctimeNs.toString(10) === expected.changedNs;
}

async function readHandleBounded(handle, maxBytes) {
  const chunks = [];
  let position = 0;
  while (position <= maxBytes) {
    const chunk = Buffer.alloc(Math.min(64 * 1024, maxBytes + 1 - position));
    const result = await handle.read(chunk, 0, chunk.length, position);
    if (!Number.isInteger(result?.bytesRead) || result.bytesRead < 0) {
      fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
    }
    if (result.bytesRead === 0) break;
    chunks.push(chunk.subarray(0, result.bytesRead));
    position += result.bytesRead;
  }
  if (position > maxBytes) fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  return Buffer.concat(chunks, position);
}

function sameStableFile(left, right) {
  return Boolean(
    left
    && right
    && left.isFile()
    && right.isFile()
    && !left.isSymbolicLink?.()
    && !right.isSymbolicLink?.()
    && left.nlink === 1n
    && right.nlink === 1n
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs
  );
}

function fail(code) {
  throw new BuilderPackageError(code);
}

function buildBuilderReleaseAssetInventory() {
  const runtimeSourceFiles = [
    "bin/agentmo.js",
    "native/agentmo-nondumpable-preload.c",
    "native/openclaw-fs-kernel.c",
    "native/openclaw-process-supervisor.c",
    "native/prebuilt/linux-x64/agentmo-nondumpable-preload.so",
    "native/prebuilt/linux-x64/README.md",
    "package.json",
    "scripts/verify-codex-uat-candidate.js",
    "src/agent-idea-candidate-cli.js",
    "src/agent-idea-candidate.js",
    "src/artifact-admission.js",
    "src/artifact-contract.js",
    "src/artifact-migration.js",
    "src/artifact-registry.js",
    "src/artifact-subjects.js",
    "src/birth-report.js",
    "src/blueprint-draft.js",
    "src/blueprint.js",
    "src/build-contract.js",
    "src/build-plan.js",
    "src/build-state.js",
    "src/builder-behavior-eval.js",
    "src/builder-append-only-authority.js",
    "src/builder-bootstrap-snapshot.js",
    "src/builder-checkpoint.js",
    "src/builder-codex-host.js",
    "src/builder-codex-uat.js",
    "src/builder-codex-uat-continuation.js",
    "src/builder-doctor.js",
    "src/builder-entry.js",
    "src/builder-events.js",
    "src/builder-hook-bridge.js",
    "src/builder-install.js",
    "src/builder-immutable-journal.js",
    "src/builder-lifecycle.js",
    "src/builder-package.js",
    "src/builder-platform.js",
    "src/builder-posix-effect.js",
    "src/builder-probe.js",
    "src/builders/codex.js",
    "src/builders/contract.js",
    "src/builders/registry.js",
    "src/cli.js",
    "src/collectors/arxiv.js",
    "src/collectors/github.js",
    "src/collectors/web.js",
    "src/control-snapshot.js",
    "src/decision-ledger.js", "src/delivery-report.js",
    "src/design-plan.js",
    "src/discovery-approval.js",
    "src/discovery-db.js",
    "src/discovery-live-transport.js",
    "src/discovery-live.js",
    "src/discovery-provenance.js",
    "src/discovery-source-workspace.js",
    "src/discovery.js",
    "src/domain-eval.js",
    "src/evidence-audit.js",
    "src/handoff.js",
    "src/javascript-static-analysis.js",
    "src/migration-filesystem.js",
    "src/native-build-capture.js",
    "src/observation.js",
    "src/openclaw-authority-consumption.js",
    "src/openclaw-authority-root-binding.js",
    "src/openclaw-credential-handoff.js",
    "src/openclaw-install-approval.js",
    "src/openclaw-install-evidence.js",
    "src/openclaw-install-plan.js",
    "src/openclaw-install-receipt.js",
    "src/openclaw-install-transaction.js", "src/openclaw-official-action-runner.js",
    "src/openclaw-process-supervisor.js",
    "src/openclaw-probe-contract.js",
    "src/openclaw-probe.js",
    "src/openclaw-safe-fs.js",
    "src/openclaw-target-admission.js",
    "src/openclaw-target-descriptor.js",
    "src/package-archive.js",
    "src/package-carriers.js",
    "src/package-contract.js",
    "src/package-inspect.js",
    "src/package-produce.js",
    "src/poc-agent.js",
    "src/poc-cli.js",
    "src/poc-openclaw-runtime.js",
    "src/poc-research-brief.js",
    "src/poc-research-collector.js",
    "src/poc-research-contract.js",
    "src/poc-research-store.js",
    "src/poc-research-workspace.js",
    "src/plan-approval.js",
    "src/persistability.js",
    "src/report.js",
    "src/run-observation.js",
    "src/run-state.js",
    "src/runtime-compatibility.js",
    "src/runtime-env.js",
    "src/runtime-execution.js",
    "src/runtime-plan.js",
    "src/scaffold-files.js",
    "src/scaffold.js",
    "src/secret-redaction.js",
    "src/source-refs.js",
    "src/targets/agentmo.js",
    "src/targets/openclaw.js",
    "src/targets/openclaw-package.js",
    "src/targets/operations.js",
    "src/targets/registry.js",
    "src/user-need.js",
  ];
  const descriptors = [
    ...BUILDER_PLUGIN_SOURCE_FILES.map((relativePath) => ({
      kind: "plugin",
      sourcePath: `plugin/${relativePath}`,
      relativePath,
      destinationPath: `plugins/agentmo/${relativePath}`,
    })),
    ...runtimeSourceFiles.map((sourcePath) => ({
      kind: "runtime",
      sourcePath,
      relativePath: `runtime/agentmo/${sourcePath}`,
      destinationPath: `plugins/agentmo/runtime/agentmo/${sourcePath}`,
    })),
  ].sort((left, right) => {
    const leftPath = left.destinationPath.toLowerCase();
    const rightPath = right.destinationPath.toLowerCase();
    return leftPath < rightPath ? -1
      : leftPath > rightPath ? 1
        : left.destinationPath < right.destinationPath ? -1
          : left.destinationPath > right.destinationPath ? 1
            : 0;
  });
  return Object.freeze(descriptors.map((descriptor) => Object.freeze(descriptor)));
}

export function validateBuilderReleaseAssetInventory(inventory) {
  if (!Array.isArray(inventory) || inventory.length !== BUILDER_RELEASE_ASSET_INVENTORY.length) {
    fail("AGENTMO_BUILDER_PACKAGE_INVENTORY_INVALID");
  }
  const sourcePaths = new Set();
  const relativePaths = new Set();
  const destinationPaths = new Set();
  for (let index = 0; index < inventory.length; index += 1) {
    const descriptor = inventory[index];
    const expected = BUILDER_RELEASE_ASSET_INVENTORY[index];
    if (!descriptor || !exactKeys(descriptor, ["destinationPath", "kind", "relativePath", "sourcePath"])) {
      fail("AGENTMO_BUILDER_PACKAGE_INVENTORY_INVALID");
    }
    if (!portableAssetPath(descriptor.sourcePath)
      || !portableAssetPath(descriptor.relativePath)
      || !portableAssetPath(descriptor.destinationPath)
      || !["plugin", "runtime"].includes(descriptor.kind)
      || descriptor.destinationPath !== `plugins/agentmo/${descriptor.relativePath}`
      || (descriptor.kind === "plugin" && descriptor.sourcePath !== `plugin/${descriptor.relativePath}`)
      || (descriptor.kind === "runtime"
        && descriptor.relativePath !== `runtime/agentmo/${descriptor.sourcePath}`)
      || sourcePaths.has(descriptor.sourcePath)
      || relativePaths.has(descriptor.relativePath)
      || destinationPaths.has(descriptor.destinationPath)
      || descriptor.kind !== expected.kind
      || descriptor.sourcePath !== expected.sourcePath
      || descriptor.relativePath !== expected.relativePath
      || descriptor.destinationPath !== expected.destinationPath) {
      fail("AGENTMO_BUILDER_PACKAGE_INVENTORY_INVALID");
    }
    sourcePaths.add(descriptor.sourcePath);
    relativePaths.add(descriptor.relativePath);
    destinationPaths.add(descriptor.destinationPath);
  }
  return true;
}

export function buildBuilderNpmTarballInventory(options = {}) {
  if (!exactKeys(options, ["includeUatReleaseManifest"].filter((key) => Object.hasOwn(options, key)))
    || (options.includeUatReleaseManifest !== undefined
      && typeof options.includeUatReleaseManifest !== "boolean")) {
    fail("AGENTMO_BUILDER_PACKAGE_INVENTORY_INVALID");
  }
  const paths = [
    ...BUILDER_NPM_METADATA_FILES,
    ...BUILDER_RELEASE_ASSET_INVENTORY.map((asset) => asset.sourcePath),
    ...(options.includeUatReleaseManifest === true
      ? [BUILDER_UAT_RELEASE_MANIFEST_SOURCE_PATH]
      : []),
  ].sort((left, right) => left.localeCompare(right));
  return Object.freeze(paths);
}

export function validateBuilderNpmTarballInventory(entries) {
  if (!Array.isArray(entries)) fail("AGENTMO_BUILDER_PACKAGE_TARBALL_INVENTORY_INVALID");
  const paths = entries.map((entry) => {
    if (typeof entry === "string") return entry;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)
      || typeof entry.path !== "string") {
      fail("AGENTMO_BUILDER_PACKAGE_TARBALL_INVENTORY_INVALID");
    }
    return entry.path;
  });
  if (paths.some((entry) => !portableAssetPath(entry)) || new Set(paths).size !== paths.length) {
    fail("AGENTMO_BUILDER_PACKAGE_TARBALL_INVENTORY_INVALID");
  }
  const sorted = paths.toSorted((left, right) => left.localeCompare(right));
  const expected = buildBuilderNpmTarballInventory({
    includeUatReleaseManifest: sorted.includes(BUILDER_UAT_RELEASE_MANIFEST_SOURCE_PATH),
  });
  if (!sameStringArray(sorted, expected)) {
    fail("AGENTMO_BUILDER_PACKAGE_TARBALL_INVENTORY_INVALID");
  }
  return true;
}

async function captureBuilderPackageFileClosure(layout) {
  if (layout.kind === "source-tree") return null;
  if (layout.kind === "bootstrap-graph") {
    const boundPaths = [...layout.bootstrapFiles.keys()]
      .filter((relativePath) => relativePath !== MARKETPLACE_DESCRIPTOR_RELATIVE_PATH)
      .sort((left, right) => left.localeCompare(right));
    const uatDestinationPath = BUILDER_UAT_RELEASE_MANIFEST_DESCRIPTOR.destinationPath;
    const includesUatReleaseManifest = boundPaths.includes(uatDestinationPath);
    const expected = [
      ...BUILDER_RELEASE_ASSET_INVENTORY.map((asset) => asset.destinationPath),
      ...(includesUatReleaseManifest ? [uatDestinationPath] : []),
    ].sort((left, right) => left.localeCompare(right));
    if (!sameStringArray(boundPaths, expected)) {
      fail("AGENTMO_BUILDER_PACKAGE_MEMBER_UNLISTED");
    }
    return Object.freeze({
      root: null,
      paths: Object.freeze(boundPaths),
      includesUatReleaseManifest,
      virtual: true,
    });
  }
  const selfContained = ["self-contained", "immutable-lifecycle"].includes(layout.kind);
  const root = selfContained ? layout.packageRoot : layout.pluginRoot;
  const paths = await listCanonicalPackageFiles(root);
  const uatPath = selfContained
    ? BUILDER_UAT_RELEASE_MANIFEST_SOURCE_PATH
    : BUILDER_UAT_RELEASE_MANIFEST_DESCRIPTOR.relativePath;
  const includesUatReleaseManifest = paths.includes(uatPath);
  const immutableExpected = [
        ...BUILDER_RELEASE_ASSET_INVENTORY.map((asset) => asset.sourcePath),
        ...(includesUatReleaseManifest ? [BUILDER_UAT_RELEASE_MANIFEST_SOURCE_PATH] : []),
      ].sort((left, right) => left.localeCompare(right));
  const expected = layout.kind === "immutable-lifecycle"
    ? await immutableLifecyclePackageClosurePaths(layout, root, immutableExpected)
    : selfContained
      ? buildBuilderNpmTarballInventory({ includeUatReleaseManifest: includesUatReleaseManifest })
      : [
        ...BUILDER_RELEASE_ASSET_INVENTORY.map((asset) => asset.relativePath),
        ...(includesUatReleaseManifest
          ? [BUILDER_UAT_RELEASE_MANIFEST_DESCRIPTOR.relativePath]
          : []),
      ].sort((left, right) => left.localeCompare(right));
  if (!sameStringArray(paths, expected)) {
    fail("AGENTMO_BUILDER_PACKAGE_MEMBER_UNLISTED");
  }
  return Object.freeze({
    root,
    paths: Object.freeze(paths),
    includesUatReleaseManifest,
  });
}

async function immutableLifecyclePackageClosurePaths(layout, root, finalPaths) {
  const packagePrefix = `.agentmo/builder/releases/${layout.bundleId}/package/`;
  const stagePaths = [];
  for (const finalRelativePath of finalPaths) {
    if (!portableAssetPath(finalRelativePath)) fail("AGENTMO_BUILDER_PACKAGE_MEMBER_UNLISTED");
    const projectRelativePath = `${packagePrefix}${finalRelativePath}`;
    const finalPath = path.join(root, ...finalRelativePath.split("/"));
    const final = await readStableFileWithExpectedLinks(
      finalPath,
      MAX_PACKAGE_FILE_BYTES,
      2n,
    );
    const stageProjectRelativePath = immutableReleaseStageRelativePath(
      projectRelativePath,
      digestRawBytes(final.bytes),
    );
    if (!stageProjectRelativePath.startsWith(packagePrefix)) {
      fail("AGENTMO_BUILDER_PACKAGE_MEMBER_UNLISTED");
    }
    const stageRelativePath = stageProjectRelativePath.slice(packagePrefix.length);
    if (!portableAssetPath(stageRelativePath)) {
      fail("AGENTMO_BUILDER_PACKAGE_MEMBER_UNLISTED");
    }
    const stagePath = path.join(root, ...stageRelativePath.split("/"));
    const stage = await readStableFileWithExpectedLinks(stagePath, MAX_PACKAGE_FILE_BYTES, 2n);
    if (stage.stats.dev !== final.stats.dev
      || stage.stats.ino !== final.stats.ino
      || stage.stats.size !== final.stats.size
      || !stage.bytes.equals(final.bytes)) {
      fail("AGENTMO_BUILDER_PACKAGE_MEMBER_UNLISTED");
    }
    stagePaths.push(stageRelativePath);
  }
  const expected = [...finalPaths, ...stagePaths].sort((left, right) => left.localeCompare(right));
  if (new Set(expected).size !== expected.length) {
    fail("AGENTMO_BUILDER_PACKAGE_MEMBER_UNLISTED");
  }
  return expected;
}

async function revalidateBuilderPackageFileClosure(layout, capture) {
  if (capture === null) return;
  if (capture.virtual === true) {
    if (layout.kind !== "bootstrap-graph"
      || !sameStringArray(
        [...layout.bootstrapFiles.keys()]
          .filter((relativePath) => relativePath !== MARKETPLACE_DESCRIPTOR_RELATIVE_PATH)
          .sort((left, right) => left.localeCompare(right)),
        capture.paths,
      )) {
      fail("AGENTMO_BUILDER_PACKAGE_MEMBER_UNLISTED");
    }
    return;
  }
  const after = await listCanonicalPackageFiles(capture.root);
  if (!sameStringArray(after, capture.paths)) {
    fail("AGENTMO_BUILDER_PACKAGE_MEMBER_UNLISTED");
  }
}

async function listCanonicalPackageFiles(root) {
  const files = [];
  async function visit(directory, relativeDirectory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
    }
    for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
      const relativePath = relativeDirectory === ""
        ? entry.name
        : `${relativeDirectory}/${entry.name}`;
      if (!portableAssetPath(relativePath)) fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
      const absolutePath = path.join(directory, entry.name);
      let stats;
      let canonical;
      try {
        stats = await lstat(absolutePath, { bigint: true });
        canonical = await realpath(absolutePath);
      } catch {
        fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
      }
      if (stats.isSymbolicLink() || canonical !== absolutePath) {
        fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
      }
      if (stats.isDirectory()) {
        await visit(absolutePath, relativePath);
      } else if (stats.isFile()) {
        files.push(relativePath);
      } else {
        fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
      }
    }
  }
  await visit(root, "");
  return files.sort((left, right) => left.localeCompare(right));
}

function validateBuilderExecutableClosure(assets) {
  const releaseAssets = new Map(assets.map((asset) => [asset.relativePath, asset]));
  const roots = [
    "hooks/agentmo-hook.js",
    "runtime/agentmo/bin/agentmo.js",
    "runtime/agentmo/scripts/verify-codex-uat-candidate.js",
    "runtime/agentmo/src/builder-hook-bridge.js",
    "runtime/agentmo/src/openclaw-credential-handoff.js",
  ];
  if (roots.some((relativePath) => !releaseAssets.has(relativePath))) {
    fail("AGENTMO_BUILDER_PACKAGE_IMPORT_UNLISTED");
  }
  const admittedModules = new Set(
    [...releaseAssets.keys()].filter(isJavaScriptReleasePath),
  );
  const visited = new Set();
  const queue = [...roots];
  while (queue.length > 0) {
    const relativePath = queue.shift();
    if (visited.has(relativePath)) continue;
    const asset = releaseAssets.get(relativePath);
    if (!asset) fail("AGENTMO_BUILDER_PACKAGE_IMPORT_UNLISTED");
    visited.add(relativePath);
    const source = decodeModuleSource(asset.bytes);
    let analysis;
    try {
      analysis = analyzeJavaScriptSource(source, {
        file: asset.sourcePath,
        includeProcessEffects: asset.sourcePath === "plugin/hooks/agentmo-hook.js",
      });
    } catch (error) {
      if (error instanceof JavaScriptStaticAnalysisError) {
        fail("AGENTMO_BUILDER_PACKAGE_IMPORT_UNLISTED");
      }
      throw error;
    }
    if (asset.sourcePath === "plugin/hooks/agentmo-hook.js") {
      validatePluginHookExecutableEffects(analysis, releaseAssets, source);
    } else if (asset.sourcePath === "src/builder-posix-effect.js") {
      validateBuilderPosixEffectChild(source);
    }
    for (const { specifier } of analysis.loaders) {
      if (specifier.startsWith("node:")) continue;
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
        fail("AGENTMO_BUILDER_PACKAGE_IMPORT_UNLISTED");
      }
      const importedPath = path.posix.normalize(
        path.posix.join(path.posix.dirname(relativePath), specifier),
      );
      const extension = path.posix.extname(importedPath);
      if (!portableAssetPath(importedPath)
        || ![".js", ".mjs", ".cjs", ".json"].includes(extension)
        || !releaseAssets.has(importedPath)) {
        fail("AGENTMO_BUILDER_PACKAGE_IMPORT_UNLISTED");
      }
      if (extension !== ".json" && !visited.has(importedPath)) queue.push(importedPath);
    }
  }
  if (visited.size !== admittedModules.size
    || [...admittedModules].some((relativePath) => !visited.has(relativePath))) {
    fail("AGENTMO_BUILDER_PACKAGE_IMPORT_UNLISTED");
  }
}

function validateBuilderPosixEffectChild(source) {
  const child = sourceFunctionBody(
    source,
    "async function builderPosixEffectChildMain() {",
  );
  const run = sourceFunctionBody(
    source,
    "export async function runBuilderPosixEffect(request, options = {}) {",
  );
  if (digestRawBytes(Buffer.from(child, "utf8"))
      !== BUILDER_POSIX_EFFECT_CHILD_FUNCTION_DIGEST
    || digestRawBytes(Buffer.from(run, "utf8"))
      !== BUILDER_POSIX_EFFECT_RUN_FUNCTION_DIGEST
    || source.includes("new URL(import.meta.url)")
    || child.includes("import.meta")
    || child.includes('import("./')
    || child.includes('import("../')) {
    fail("AGENTMO_BUILDER_PACKAGE_EXECUTABLE_EFFECT_UNLISTED");
  }
  assertOrderedHookBody(run, [
    "const childBootstrap = [",
    "`const childMain = ${builderPosixEffectChildMain.toString()};`,",
    "const nodeArguments = [\"--input-type=module\", \"--eval\", childBootstrap];",
    "const child = spawn(",
  ]);
}

function isJavaScriptReleasePath(relativePath) {
  return [".js", ".mjs", ".cjs"].includes(path.posix.extname(relativePath));
}

function validatePluginHookExecutableEffects(analysis, releaseAssets, source) {
  for (const fragment of [
    "const MAX_INPUT_BYTES = 64 * 1024;",
    "const MAX_CHILD_OUTPUT_BYTES = 16 * 1024;",
    "const MAX_RECEIPT_BYTES = 256 * 1024;",
    "const MAX_BOUND_MEMBER_BYTES = 256 * 1024;",
    "const MAX_BOUND_MEMBERS = 512;",
    "const MAX_CAPTURED_RELEASE_BYTES = 16 * 1024 * 1024;",
    "const MAX_BOOTSTRAP_GRAPH_BYTES = 24 * 1024 * 1024;",
    "const CHILD_TIMEOUT_MS = 60_000;",
    "const CHILD_TIMEOUT_SETTLEMENT_GRACE_MS = 1_000;",
    'const RUNNER_RELATIVE_PATH = "plugins/agentmo/hooks/agentmo-hook.js";',
    'const LAUNCHER_RELATIVE_PATH = "plugins/agentmo/runtime/agentmo/bin/agentmo.js";',
  ]) {
    uniqueSourceOccurrence(source, fragment);
  }
  const loaderStart = uniqueSourceOccurrence(
    source,
    "const AUTHENTICATED_BOOTSTRAP_LOADER_SOURCE = String.raw`",
  );
  const loaderEndMarker = "\n`;\nconst MANAGED_PROJECT_FILES";
  const loaderEnd = uniqueSourceOccurrence(source, loaderEndMarker);
  const loaderSource = source.slice(loaderStart, loaderEnd + 3);
  if (digestRawBytes(Buffer.from(loaderSource, "utf8"))
    !== BUILDER_PLUGIN_HOOK_LOADER_SOURCE_DIGEST) {
    fail("AGENTMO_BUILDER_PACKAGE_EXECUTABLE_EFFECT_UNLISTED");
  }
  const observedLoaders = analysis.loaders.map((loader) => (
    `plugin/hooks/agentmo-hook.js:${loader.line}:${loader.kind}:${loader.specifier}`
  ));
  if (!sameStringArray(observedLoaders, BUILDER_PLUGIN_HOOK_LOADER_INVENTORY)) {
    fail("AGENTMO_BUILDER_PACKAGE_IMPORT_UNLISTED");
  }
  const observed = analysis.ioSurfaces.map((surface) => (
    `${surface.file}:${surface.line}:${surface.kind}:${surface.callee}`
  ));
  if (!sameStringArray(observed, BUILDER_PLUGIN_HOOK_IO_SURFACE_INVENTORY)) {
    fail("AGENTMO_BUILDER_PACKAGE_EXECUTABLE_EFFECT_UNLISTED");
  }
  const invocations = analysis.processInvocations.filter((invocation) => invocation.method === "spawn");
  if (invocations.length !== 1
    || !deepExactValue(invocations[0].arguments, [
      { type: "member", path: ["process", "execPath"] },
      {
        type: "array",
        values: [
          { type: "string", value: "--no-warnings" },
          { type: "string", value: "--experimental-loader" },
          { type: "member", path: ["loaderUrl"] },
          { type: "string", value: "--input-type=module" },
          { type: "string", value: "--eval" },
          { type: "member", path: ["entrySource"] },
        ],
      },
      {
        type: "object",
        properties: [
          { key: "cwd", value: { type: "member", path: ["paths", "projectRoot"] } },
          { key: "detached", value: { type: "member", path: ["true"] } },
          {
            key: "env",
            value: {
              type: "object",
              properties: [
                {
                  key: "AGENTMO_BUILDER_HOOK_BOOTSTRAP_MODE",
                  value: { type: "string", value: "authenticated-graph-v1" },
                },
                {
                  key: "AGENTMO_BUILDER_HOOK_GRAPH_DIGEST",
                  value: { type: "member", path: ["paths", "graph", "digest"] },
                },
                {
                  key: "AGENTMO_BUILDER_HOOK_RUNNER_DIGEST",
                  value: { type: "member", path: ["paths", "runnerDigest"] },
                },
                { key: "LANG", value: { type: "string", value: "C" } },
                { key: "LC_ALL", value: { type: "string", value: "C" } },
              ],
            },
          },
          { key: "shell", value: { type: "member", path: ["false"] } },
          {
            key: "stdio",
            value: {
              type: "array",
              values: [
                { type: "string", value: "pipe" },
                { type: "string", value: "pipe" },
                { type: "string", value: "pipe" },
                { type: "string", value: "pipe" },
                { type: "string", value: "pipe" },
              ],
            },
          },
        ],
      },
    ])) {
    fail("AGENTMO_BUILDER_PACKAGE_EXECUTABLE_EFFECT_UNLISTED");
  }
  if (!releaseAssets.has("runtime/agentmo/bin/agentmo.js")
    || !releaseAssets.has("runtime/agentmo/src/builder-hook-bridge.js")
    || !releaseAssets.has("hooks/agentmo-hook.js")) {
    fail("AGENTMO_BUILDER_PACKAGE_IMPORT_UNLISTED");
  }
  validatePluginHookBootstrapOrder(source);
  if (source.includes("../runtime/agentmo/")
    || source.includes("[paths.runnerPath, \"__builder-hook\"]")) {
    fail("AGENTMO_BUILDER_PACKAGE_EXECUTABLE_EFFECT_UNLISTED");
  }
}

function validatePluginHookBootstrapOrder(source) {
  const bootstrap = sourceFunctionBody(source, "async function admitBootstrapRelease(paths) {");
  const graph = sourceFunctionBody(
    source,
    "function buildAuthenticatedBootstrapGraph(options) {",
  );
  const delivery = sourceFunctionBody(source, "async function runAdjacentLauncher(inputBytes, paths) {");
  const bodies = {
    admitBootstrapRelease: bootstrap,
    buildAuthenticatedBootstrapGraph: graph,
    runAdjacentLauncher: delivery,
  };
  if (Object.entries(BUILDER_PLUGIN_HOOK_BOOTSTRAP_FUNCTION_DIGESTS).some(
    ([name, expected]) => digestRawBytes(Buffer.from(bodies[name], "utf8")) !== expected,
  )) {
    fail("AGENTMO_BUILDER_PACKAGE_EXECUTABLE_EFFECT_UNLISTED");
  }
  assertOrderedHookBody(bootstrap, [
    "const receiptBytes = await readBoundedFile(",
    "const receiptDigest = digest(receiptBytes);",
    "const receipt = parseReceipt(receiptBytes, paths.projectRoot, paths.projectStats);",
    "await assertReceiptAnchors({",
    "const files = await captureBoundProjectionFiles(marketplaceRoot, binding);",
    "const graph = buildAuthenticatedBootstrapGraph({",
  ]);
  assertOrderedHookBody(graph, [
    "const entries = [];",
    "source: file.bytes.toString(\"base64\"),",
    "const bytes = Buffer.from(JSON.stringify({",
    "digest: digest(bytes),",
  ]);
  assertOrderedHookBody(delivery, [
    "const loaderUrl = `data:text/javascript,${encodeURIComponent(AUTHENTICATED_BOOTSTRAP_LOADER_SOURCE)}`;",
    "process.kill(-child.pid, \"SIGKILL\");",
    "parentCancellationHandlers = {",
    "process.on(\"SIGTERM\", parentCancellationHandlers.SIGTERM);",
    "process.on(\"SIGINT\", parentCancellationHandlers.SIGINT);",
    "child = spawn(process.execPath, [",
    "detached: true,",
    "if (parentCancellationSignal !== null) {",
    "child.on(\"close\", (code, signal) => {",
    "child.stdio[4].end(paths.graph.bytes);",
  ]);
  if (bootstrap.includes("spawn(")
    || graph.includes("spawn(")
    || delivery.includes("paths.runnerPath")) {
    fail("AGENTMO_BUILDER_PACKAGE_EXECUTABLE_EFFECT_UNLISTED");
  }
}

function assertOrderedHookBody(body, fragments) {
  const positions = fragments.map((fragment) => uniqueSourceOccurrence(body, fragment));
  if (positions.some((position, index) => index > 0 && position <= positions[index - 1])) {
    fail("AGENTMO_BUILDER_PACKAGE_EXECUTABLE_EFFECT_UNLISTED");
  }
}

function sourceFunctionBody(source, signature) {
  const start = uniqueSourceOccurrence(source, signature);
  let depth = 0;
  let mode = "code";
  for (let index = start + signature.length - 1; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (mode === "line-comment") {
      if (char === "\n") mode = "code";
      continue;
    }
    if (mode === "block-comment") {
      if (char === "*" && next === "/") {
        mode = "code";
        index += 1;
      }
      continue;
    }
    if (mode === "single" || mode === "double" || mode === "template") {
      if (char === "\\") {
        index += 1;
        continue;
      }
      if ((mode === "single" && char === "'")
        || (mode === "double" && char === "\"")
        || (mode === "template" && char === "`")) {
        mode = "code";
      }
      continue;
    }
    if (char === "/" && next === "/") {
      mode = "line-comment";
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      mode = "block-comment";
      index += 1;
      continue;
    }
    if (char === "'") {
      mode = "single";
      continue;
    }
    if (char === "\"") {
      mode = "double";
      continue;
    }
    if (char === "`") {
      mode = "template";
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  fail("AGENTMO_BUILDER_PACKAGE_EXECUTABLE_EFFECT_UNLISTED");
}

function uniqueSourceOccurrence(source, fragment) {
  const first = source.indexOf(fragment);
  if (first < 0 || source.indexOf(fragment, first + fragment.length) >= 0) {
    fail("AGENTMO_BUILDER_PACKAGE_EXECUTABLE_EFFECT_UNLISTED");
  }
  return first;
}

function validatePluginHookEntrypoints(assets) {
  const hooksAsset = assets.find((asset) => asset.sourcePath === "plugin/hooks/hooks.json");
  const hooks = parseJsonAsset(hooksAsset?.bytes);
  const command = 'node "${PLUGIN_ROOT}/hooks/agentmo-hook.js"';
  const expected = {
    hooks: {
      SessionStart: [{
        matcher: "startup|resume|clear",
        hooks: [{ type: "command", command, async: false }],
      }],
      PreCompact: [{
        hooks: [{ type: "command", command, async: false }],
      }],
      PostCompact: [{
        hooks: [{ type: "command", command, async: false }],
      }],
    },
  };
  if (!deepExactValue(hooks, expected)) {
    fail("AGENTMO_BUILDER_PACKAGE_IMPORT_UNLISTED");
  }
}

function validateUatReleaseManifestAsset(packageManifest, assets) {
  const manifestAsset = assets.find(
    (asset) => asset.sourcePath === BUILDER_UAT_RELEASE_MANIFEST_SOURCE_PATH,
  );
  if (!manifestAsset) return;
  const continuation = assets.find(
    (asset) => asset.sourcePath === "src/builder-codex-uat-continuation.js",
  );
  const verifier = assets.find(
    (asset) => asset.sourcePath === "scripts/verify-codex-uat-candidate.js",
  );
  const expected = {
    schemaVersion: "agentmo.codex-uat-release-manifest.v1",
    packageName: packageManifest.name,
    version: packageManifest.version,
    continuation: {
      sourcePath: continuation?.sourcePath,
      sha256: continuation?.digest,
    },
    verifier: {
      sourcePath: verifier?.sourcePath,
      sha256: verifier?.digest,
    },
  };
  const parsed = parseJsonAsset(manifestAsset.bytes);
  const canonical = Buffer.from(serializePersistableJson(expected, {
    subject: "builder-codex-uat-release-manifest",
  }), "utf8");
  if (!continuation
    || !verifier
    || continuation.digest === verifier.digest
    || !deepExactValue(parsed, expected)
    || !canonical.equals(manifestAsset.bytes)) {
    fail("AGENTMO_BUILDER_PACKAGE_UAT_MANIFEST_INVALID");
  }
}

function decodeModuleSource(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("AGENTMO_BUILDER_PACKAGE_INVALID");
  }
}

function parseJsonAsset(bytes) {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail("AGENTMO_BUILDER_PACKAGE_INVALID");
  }
}

function validatePackageManifestSurface(manifest) {
  if (!exactKeys(manifest, [
    "agentmo", "bin", "description", "engines", "exports", "files", "license", "name", "scripts", "type", "version",
  ])
    || !exactKeys(manifest.bin, ["agentmo"])
    || !exactKeys(manifest.exports, ["./package.json"])
    || manifest.exports["./package.json"] !== "./package.json"
    || !exactKeys(manifest.engines, ["node"])
    || manifest.engines.node !== ">=20"
    || !exactKeys(manifest.agentmo, ["builder"])
    || !exactKeys(manifest.agentmo.builder, ["filesystemContract", "supportedPlatforms"])
    || manifest.agentmo.builder.filesystemContract !== "posix-no-follow-private-owner"
    || !sameStringArray(manifest.agentmo.builder.supportedPlatforms, ["darwin", "linux"])
    || !manifest.scripts || typeof manifest.scripts !== "object" || Array.isArray(manifest.scripts)
    || Object.keys(manifest.scripts).some((name) => [
      "preinstall", "install", "postinstall", "prepublish", "preprepare", "prepare", "prepack", "postpack",
    ].includes(name))) {
    fail("AGENTMO_BUILDER_PACKAGE_INVALID");
  }
}

function validatePluginManifestSurface(manifest) {
  if (!exactKeys(manifest, [
    "author", "description", "interface", "keywords", "license", "name", "skills", "version",
  ])
    || !exactKeys(manifest.author, ["name"])
    || !Array.isArray(manifest.keywords)
    || !manifest.keywords.every((value) => typeof value === "string")
    || manifest.skills !== "./skills/"
    || !exactKeys(manifest.interface, [
      "capabilities", "category", "defaultPrompt", "developerName", "displayName", "longDescription", "shortDescription",
    ])
    || !Array.isArray(manifest.interface.capabilities)
    || !manifest.interface.capabilities.every((value) => typeof value === "string")
    || !Array.isArray(manifest.interface.defaultPrompt)
    || !manifest.interface.defaultPrompt.every((value) => typeof value === "string")) {
    fail("AGENTMO_BUILDER_PACKAGE_IDENTITY_MISMATCH");
  }
}

function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function sameStringArray(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => typeof value === "string" && value === right[index]);
}

function deepExactValue(left, right) {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => deepExactValue(value, right[index]));
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return sameStringArray(leftKeys, rightKeys)
    && leftKeys.every((key) => deepExactValue(left[key], right[key]));
}

function portableAssetPath(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 240
    && !value.includes("\\")
    && !value.includes("\0")
    && !path.posix.isAbsolute(value)
    && value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function assertBuilderPackageLoadOptions(options) {
  if (!validBuilderPackageLoadOptions(options)) {
    fail("AGENTMO_BUILDER_PACKAGE_LAYOUT_INVALID");
  }
}

function validBuilderPackageLoadOptions(options) {
  const allowedKeys = [
    "expectedReceiptDigest",
    "immutableLifecycleSelection",
    "packageRoot",
    "projectRoot",
  ];
  return options !== null
    && typeof options === "object"
    && !Array.isArray(options)
    && Object.keys(options).every((key) => allowedKeys.includes(key))
    && (options.packageRoot === undefined
      || (typeof options.packageRoot === "string" && options.packageRoot.length > 0))
    && (options.projectRoot === undefined
      || (typeof options.projectRoot === "string" && options.projectRoot.length > 0))
    && (options.expectedReceiptDigest === undefined
      || DIGEST_PATTERN.test(options.expectedReceiptDigest))
    && (options.immutableLifecycleSelection === undefined
      || options.immutableLifecycleSelection === true);
}

async function resolveBuilderPackageLayout(options) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    fail("AGENTMO_BUILDER_PACKAGE_LAYOUT_INVALID");
  }
  const providedRoot = options.packageRoot;
  if (providedRoot !== undefined && (typeof providedRoot !== "string" || providedRoot.length === 0)) {
    fail("AGENTMO_BUILDER_PACKAGE_LAYOUT_INVALID");
  }
  const packageRoot = await admitCanonicalPackageRoot(providedRoot ?? MODULE_PACKAGE_ROOT);
  if (providedRoot !== undefined) {
    if (options.immutableLifecycleSelection === true) {
      return admitReceiptBackedImmutableLifecycleLayout(packageRoot, options);
    }
    return Object.freeze({ kind: "self-contained", packageRoot, pluginRoot: packageRoot });
  }
  if (hasExactStableRuntimeSuffix(packageRoot)) {
    return admitReceiptBackedStableLayout(packageRoot, options);
  }
  if (
    options.expectedReceiptDigest !== undefined
    && hasExactProjectedRuntimeSuffix(packageRoot)
  ) {
    return admitReceiptBackedProjectedLayout(packageRoot, options.expectedReceiptDigest);
  }
  if (await hasSelfContainedPluginEntry(packageRoot)) {
    const kind = await hasRepositorySourceMarker(packageRoot) ? "source-tree" : "self-contained";
    return Object.freeze({ kind, packageRoot, pluginRoot: packageRoot });
  }
  return admitReceiptBackedProjectedLayout(packageRoot, options.expectedReceiptDigest);
}

function admitBootstrapSnapshotLayout(packageRoot, options, bootstrapFiles) {
  if (!DIGEST_PATTERN.test(options.expectedReceiptDigest ?? "")
    || process.env.AGENTMO_BUILDER_HOOK_BOOTSTRAP_MODE !== BOOTSTRAP_GRAPH_MODE
    || packageRoot !== MODULE_PACKAGE_ROOT
    || !(bootstrapFiles instanceof Map)) {
    fail("AGENTMO_BUILDER_PACKAGE_LAYOUT_INVALID");
  }
  return Object.freeze({
    kind: "bootstrap-graph",
    packageRoot,
    pluginRoot: packageRoot,
    bootstrapFiles,
    bootstrapProjectionBinding: options.projectionBinding,
  });
}

function hasExactStableRuntimeSuffix(packageRoot) {
  const stateRoot = path.resolve(packageRoot, "..", "..", "..", "..", "..", "..");
  return packageRoot === path.join(stateRoot, STABLE_RUNTIME_RELATIVE_PATH);
}

async function admitReceiptBackedImmutableLifecycleLayout(packageRoot, options) {
  if (!DIGEST_PATTERN.test(options.expectedReceiptDigest ?? "")) {
    fail("AGENTMO_BUILDER_PACKAGE_RECEIPT_DIGEST_REQUIRED");
  }
  const releaseRoot = path.dirname(packageRoot);
  const bundleId = path.basename(releaseRoot);
  const releasesRoot = path.dirname(releaseRoot);
  const projectRoot = path.resolve(releasesRoot, "..", "..", "..");
  if (!/^[a-f0-9]{64}$/u.test(bundleId)
    || packageRoot !== path.join(
      projectRoot,
      ".agentmo", "builder", "releases", bundleId, "package",
    )
    || (options.projectRoot !== undefined
      && await admitCanonicalPackageRoot(options.projectRoot) !== projectRoot)) {
    fail("AGENTMO_BUILDER_PACKAGE_LAYOUT_INVALID");
  }
  const layout = {
    kind: "immutable-lifecycle",
    packageRoot,
    pluginRoot: packageRoot,
    projectRoot,
    releaseRoot,
    bundleId,
  };
  const receiptRelativePath = `.agentmo/builder/releases/${bundleId}/install-receipt.json`;
  const receiptBytes = await readImmutableLifecycleProjectFile(
    layout,
    receiptRelativePath,
    MAX_PACKAGE_FILE_BYTES,
  );
  if (digestRawBytes(receiptBytes) !== options.expectedReceiptDigest) {
    fail("AGENTMO_BUILDER_PACKAGE_RECEIPT_DIGEST_MISMATCH");
  }
  const receipt = parseJsonAsset(receiptBytes);
  if (!exactKeys(receipt, [
    "bundleDigest", "evidence", "files", "identity", "predecessorReceiptDigest",
    "receiptPath", "releaseRoot", "schemaVersion", "scope", "scopeDigest", "status",
  ])
    || receipt.schemaVersion !== "agentmo.builder-release-receipt.v1"
    || receipt.status !== "immutable-successor"
    || receipt.scope !== "project"
    || receipt.bundleDigest !== `sha256:${bundleId}`
    || receipt.releaseRoot !== `.agentmo/builder/releases/${bundleId}`
    || receipt.receiptPath !== receiptRelativePath
    || !DIGEST_PATTERN.test(receipt.scopeDigest ?? "")
    || !DIGEST_PATTERN.test(receipt.predecessorReceiptDigest ?? "")
    || !exactKeys(receipt.identity, ["adapterId", "name", "releaseDigest", "version"])
    || receipt.identity.name !== "agentmo"
    || receipt.identity.adapterId !== "codex"
    || !VERSION_PATTERN.test(receipt.identity.version ?? "")
    || !DIGEST_PATTERN.test(receipt.identity.releaseDigest ?? "")) {
    fail("AGENTMO_BUILDER_PACKAGE_LAYOUT_INVALID");
  }
  return Object.freeze({ ...layout, receipt });
}

async function admitReceiptBackedStableLayout(packageRoot, options) {
  if (!DIGEST_PATTERN.test(options.expectedReceiptDigest ?? "")) {
    fail("AGENTMO_BUILDER_PACKAGE_RECEIPT_DIGEST_REQUIRED");
  }
  const projectRoot = await admitCanonicalPackageRoot(options.projectRoot ?? process.cwd());
  const stateRoot = path.resolve(packageRoot, "..", "..", "..", "..", "..", "..");
  const marketplaceRoot = path.join(stateRoot, "marketplace", "agentmo-local");
  const pluginRoot = path.join(marketplaceRoot, "plugins", "agentmo");
  await captureCanonicalDirectoryChain(stateRoot, pluginRoot);
  await captureCanonicalDirectoryChain(pluginRoot, packageRoot);
  const receiptBytes = await readCanonicalProjectControlFile(
    projectRoot,
    PROJECTED_RECEIPT_PATH,
    MAX_PACKAGE_FILE_BYTES,
  );
  if (digestRawBytes(receiptBytes) !== options.expectedReceiptDigest) {
    fail("AGENTMO_BUILDER_PACKAGE_RECEIPT_DIGEST_MISMATCH");
  }
  const markerBytes = await readCanonicalProjectControlFile(
    projectRoot,
    PROJECTED_MARKER_PATH,
    MAX_PACKAGE_FILE_BYTES,
  );
  const receipt = parseJsonAsset(receiptBytes);
  const marker = parseJsonAsset(markerBytes);
  const scopeDigest = await computeProjectedScopeDigest(projectRoot);
  const files = validateProjectedLayoutEvidence({
    receipt,
    marker,
    markerDigest: digestRawBytes(markerBytes),
    scopeDigest,
  });
  if (receipt.schemaVersion !== "agentmo.builder-install-receipt.v4") {
    fail("AGENTMO_BUILDER_PACKAGE_LAYOUT_INVALID");
  }
  const binding = await inspectCodexMarketplaceProjectionBinding({ marketplaceRoot });
  const finalProjectionBinding = await assertCodexMarketplaceProjectionFinalBinding({
    marketplaceRoot,
    expectedBinding: receipt.hostActivation.finalProjectionBinding,
  });
  const { projection, ...state } = binding;
  const consumer = state.ledger.status === "valid"
    ? state.ledger.value.consumers.find((entry) => entry.consumerId === scopeDigest)
    : null;
  if (state.owner.status !== "valid" || state.ledger.status !== "valid"
    || projection.status !== "valid"
    || finalProjectionBinding.releaseDigest !== receipt.identity.releaseDigest
    || finalProjectionBinding.contentDigest !== receipt.hostActivation.marketplaceProjectionDigest
    || finalProjectionBinding.rootIdentityDigest !== projection.rootIdentityDigest
    || state.owner.digest !== receipt.hostActivation.ownerRecordDigest
    || state.ledger.digest !== receipt.hostActivation.consumerLedgerDigest
    || state.owner.value.release.releaseDigest !== receipt.identity.releaseDigest
    || consumer === null
    || digestCodexConsumerEntry(consumer) !== receipt.hostActivation.consumerEntryDigest) {
    fail("AGENTMO_BUILDER_PACKAGE_LAYOUT_INVALID");
  }
  return Object.freeze({
    kind: "stable-projection",
    packageRoot,
    pluginRoot,
    projectRoot,
    stateRoot,
    receipt,
    marker,
    files,
  });
}

function hasExactProjectedRuntimeSuffix(packageRoot) {
  const projectRoot = path.resolve(packageRoot, "..", "..", "..", "..");
  return packageRoot === path.join(
    projectRoot,
    ...PROJECTED_RUNTIME_RELATIVE_PATH.split("/"),
  );
}

async function admitCanonicalPackageRoot(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }
  try {
    const requested = path.resolve(value);
    const requestedStats = await lstat(requested, { bigint: true });
    if (requestedStats.isSymbolicLink() || !requestedStats.isDirectory()) {
      fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
    }
    const canonical = await realpath(requested);
    await captureCanonicalDirectoryChain(canonical, canonical);
    return canonical;
  } catch (error) {
    if (error instanceof BuilderPackageError) throw error;
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }
}

async function hasSelfContainedPluginEntry(packageRoot) {
  try {
    await lstat(path.join(packageRoot, "plugin"));
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }
}

async function hasRepositorySourceMarker(packageRoot) {
  try {
    const marker = await lstat(path.join(packageRoot, ".git"));
    return marker.isDirectory() || marker.isFile();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }
}

async function admitReceiptBackedProjectedLayout(packageRoot, expectedReceiptDigest) {
  if (!DIGEST_PATTERN.test(expectedReceiptDigest ?? "")) {
    fail("AGENTMO_BUILDER_PACKAGE_RECEIPT_DIGEST_REQUIRED");
  }
  const projectRoot = path.resolve(packageRoot, "..", "..", "..", "..");
  const expectedPackageRoot = path.join(
    projectRoot,
    ...PROJECTED_RUNTIME_RELATIVE_PATH.split("/"),
  );
  if (packageRoot !== expectedPackageRoot) fail("AGENTMO_BUILDER_PACKAGE_LAYOUT_INVALID");

  const canonicalProjectRoot = await admitCanonicalPackageRoot(projectRoot);
  if (canonicalProjectRoot !== projectRoot) fail("AGENTMO_BUILDER_PACKAGE_LAYOUT_INVALID");
  const pluginRoot = path.join(
    canonicalProjectRoot,
    ...PROJECTED_PLUGIN_RELATIVE_PATH.split("/"),
  );
  await captureCanonicalDirectoryChain(canonicalProjectRoot, pluginRoot);
  if (await realpath(pluginRoot) !== pluginRoot) fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  await captureCanonicalDirectoryChain(pluginRoot, packageRoot);

  const receiptBytes = await readCanonicalProjectControlFile(
    canonicalProjectRoot,
    PROJECTED_RECEIPT_PATH,
    MAX_PACKAGE_FILE_BYTES,
  );
  if (digestRawBytes(receiptBytes) !== expectedReceiptDigest) {
    fail("AGENTMO_BUILDER_PACKAGE_RECEIPT_DIGEST_MISMATCH");
  }
  const markerBytes = await readCanonicalProjectControlFile(
    canonicalProjectRoot,
    PROJECTED_MARKER_PATH,
    MAX_PACKAGE_FILE_BYTES,
  );
  const receipt = parseJsonAsset(receiptBytes);
  const marker = parseJsonAsset(markerBytes);
  const scopeDigest = await computeProjectedScopeDigest(canonicalProjectRoot);
  const files = validateProjectedLayoutEvidence({
    receipt,
    marker,
    markerDigest: digestRawBytes(markerBytes),
    scopeDigest,
  });
  if (receipt.schemaVersion !== "agentmo.builder-install-receipt.v2"
    || receipt.status !== "projected") {
    fail("AGENTMO_BUILDER_PACKAGE_LAYOUT_INVALID");
  }
  return Object.freeze({
    kind: "projected",
    packageRoot,
    pluginRoot,
    projectRoot: canonicalProjectRoot,
    receipt,
    marker,
    files,
  });
}

async function admitProjectedDiagnosticLayout(packageRoot, projectRoot) {
  const expectedPackageRoot = path.join(
    projectRoot,
    ...PROJECTED_RUNTIME_RELATIVE_PATH.split("/"),
  );
  if (packageRoot !== expectedPackageRoot) fail("AGENTMO_BUILDER_PACKAGE_LAYOUT_INVALID");
  const pluginRoot = path.join(projectRoot, ...PROJECTED_PLUGIN_RELATIVE_PATH.split("/"));
  await captureCanonicalDirectoryChain(projectRoot, pluginRoot);
  await captureCanonicalDirectoryChain(pluginRoot, packageRoot);
  return Object.freeze({
    kind: "projected-diagnostic",
    packageRoot,
    pluginRoot,
    projectRoot,
  });
}

async function computeProjectedScopeDigest(projectRoot) {
  try {
    const stats = await lstat(projectRoot, { bigint: true });
    if (stats.isSymbolicLink() || !stats.isDirectory() || await realpath(projectRoot) !== projectRoot) {
      fail("AGENTMO_BUILDER_PACKAGE_LAYOUT_INVALID");
    }
    return digestJson({
      schemaVersion: "agentmo.builder-project-scope.v1",
      canonicalRootDigest: digestRawBytes(Buffer.from(projectRoot, "utf8")),
      device: stats.dev.toString(10),
      inode: stats.ino.toString(10),
    }, "builder-project-scope");
  } catch (error) {
    if (error instanceof BuilderPackageError) throw error;
    fail("AGENTMO_BUILDER_PACKAGE_LAYOUT_INVALID");
  }
}

function validateProjectedLayoutEvidence({ receipt, marker, markerDigest, scopeDigest }) {
  const projectedReceipt = receipt?.schemaVersion === "agentmo.builder-install-receipt.v2"
    && receipt?.status === "projected"
    && receipt?.evidence?.level === "declared-ready"
    && receipt?.evidence?.codexActivationVerified === false
    && !Object.hasOwn(receipt ?? {}, "hostActivation");
  const activatedReceipt = receipt?.schemaVersion === "agentmo.builder-install-receipt.v4"
    && receipt?.status === "activated"
    && receipt?.evidence?.level === "host-observed"
    && receipt?.evidence?.codexActivationVerified === false
    && validProjectedActivationBinding(receipt?.hostActivation, receipt?.identity, scopeDigest);
  if (
    (!projectedReceipt && !activatedReceipt)
    || receipt?.scope !== "project"
    || receipt?.scopeDigest !== scopeDigest
    || receipt?.receiptPath !== PROJECTED_RECEIPT_PATH
    || receipt?.markerPath !== PROJECTED_MARKER_PATH
    || receipt?.identity?.name !== "agentmo"
    || receipt?.identity?.adapterId !== "codex"
    || !VERSION_PATTERN.test(receipt?.identity?.version ?? "")
    || !DIGEST_PATTERN.test(receipt?.identity?.releaseDigest ?? "")
    || receipt?.evidence?.mechanismOnly !== true
    || receipt?.evidence?.hostBehaviorVerified !== false
    || receipt?.evidence?.domainQualityCertified !== false
    || !Array.isArray(receipt?.files)
    || marker?.schemaVersion !== "agentmo.builder-install-marker.v2"
    || marker?.scope !== "project"
    || marker?.scopeDigest !== scopeDigest
    || marker?.receiptPath !== PROJECTED_RECEIPT_PATH
    || marker?.identity?.name !== receipt.identity.name
    || marker?.identity?.version !== receipt.identity.version
    || marker?.identity?.adapterId !== receipt.identity.adapterId
    || marker?.identity?.releaseDigest !== receipt.identity.releaseDigest
    || marker?.projectionStatus !== "receipt-required"
    || marker?.selfCertifying !== false
  ) {
    fail("AGENTMO_BUILDER_PACKAGE_LAYOUT_INVALID");
  }
  const files = new Map();
  for (const entry of receipt.files) {
    if (
      !entry
      || !exactKeys(entry, ["destinationDigest", "ownership", "relativePath", "sourceDigest"])
      || !portableAssetPath(entry.relativePath)
      || !DIGEST_PATTERN.test(entry.sourceDigest ?? "")
      || !DIGEST_PATTERN.test(entry.destinationDigest ?? "")
      || typeof entry.ownership !== "string"
      || files.has(entry.relativePath)
    ) {
      fail("AGENTMO_BUILDER_PACKAGE_LAYOUT_INVALID");
    }
    files.set(entry.relativePath, entry);
  }
  const markerEntry = files.get(PROJECTED_MARKER_PATH);
  if (
    markerEntry?.ownership !== "exclusive-marker"
    || markerEntry.sourceDigest !== markerDigest
    || markerEntry.destinationDigest !== markerDigest
  ) {
    fail("AGENTMO_BUILDER_PACKAGE_LAYOUT_INVALID");
  }
  return files;
}

function validProjectedActivationBinding(binding, identity, scopeDigest) {
  if (!binding || !exactKeys(binding, [
    "consumerEntryDigest",
    "consumerEntryOwned",
    "consumerId",
    "consumerLedgerDigest",
    "expectedPostObservation",
    "finalProjectionBinding",
    "hostScope",
    "marketplaceProjectionDigest",
    "operationOrderDigest",
    "ownerDisposition",
    "ownerRecordDigest",
    "releaseDigest",
    "schemaVersion",
    "selector",
    "selectorDeletionAuthority",
  ])) return false;
  const expected = binding.expectedPostObservation;
  return binding.schemaVersion === "agentmo.builder-codex-activation-binding.v3"
    && binding.hostScope === "user"
    && binding.releaseDigest === identity?.releaseDigest
    && binding.consumerId === scopeDigest
    && DIGEST_PATTERN.test(binding.marketplaceProjectionDigest ?? "")
    && DIGEST_PATTERN.test(binding.operationOrderDigest ?? "")
    && DIGEST_PATTERN.test(binding.ownerRecordDigest ?? "")
    && DIGEST_PATTERN.test(binding.consumerEntryDigest ?? "")
    && DIGEST_PATTERN.test(binding.consumerLedgerDigest ?? "")
    && ["created-by-agentmo", "preexisting-unowned"].includes(binding.ownerDisposition)
    && binding.consumerEntryOwned === true
    && binding.selectorDeletionAuthority === false
    && exactKeys(binding.selector, ["marketplaceName", "pluginId", "pluginName"])
    && binding.selector.pluginId === "agentmo@agentmo-local"
    && binding.selector.pluginName === "agentmo"
    && binding.selector.marketplaceName === "agentmo-local"
    && validFinalProjectionBindingShape(binding.finalProjectionBinding, identity?.releaseDigest)
    && exactKeys(expected, [
      "agentHostVisibility", "enabled", "hooksVisibility", "installation",
      "releaseMatch", "skillVisibility", "sourceMatch", "trust",
    ])
    && expected.installation === "installed"
    && expected.enabled === true
    && expected.sourceMatch === true
    && expected.releaseMatch === true
    && expected.skillVisibility === "visible"
    && expected.hooksVisibility === "visible"
    && expected.trust === "trusted-or-pending-human"
    && expected.agentHostVisibility === "unobservable";
}

function validFinalProjectionBindingShape(binding, releaseDigest) {
  if (!exactKeys(binding, [
    "contentDigest",
    "members",
    "releaseDigest",
    "rootIdentity",
    "rootIdentityDigest",
    "schemaVersion",
    "transactionDigest",
    "transactionId",
  ])
    || binding.schemaVersion !== "agentmo.codex-marketplace-projection-binding.v1"
    || binding.releaseDigest !== releaseDigest
    || !DIGEST_PATTERN.test(binding.contentDigest ?? "")
    || !DIGEST_PATTERN.test(binding.transactionDigest ?? "")
    || !DIGEST_PATTERN.test(binding.rootIdentityDigest ?? "")
    || binding.transactionId !== binding.transactionDigest.slice("sha256:".length)
    || !validProjectionIdentityShape(binding.rootIdentity, false)
    || !Array.isArray(binding.members)
    || binding.members.length < 2) return false;
  return binding.members.every((member, index) => exactKeys(member, [
    "digest", "identity", "kind", "relativePath",
  ])
    && ["directory", "file", "root"].includes(member.kind)
    && (index === 0
      ? member.kind === "root" && member.relativePath === ""
      : member.kind !== "root" && portableAssetPath(member.relativePath))
    && (member.kind === "file" ? DIGEST_PATTERN.test(member.digest ?? "") : member.digest === null)
    && validProjectionIdentityShape(member.identity, member.kind === "file"));
}

function validateBootstrapSnapshotReleaseBinding(layout, assets, releaseDigest) {
  const binding = layout.bootstrapProjectionBinding;
  if (!validFinalProjectionBindingShape(binding, releaseDigest)) {
    fail("AGENTMO_BUILDER_PACKAGE_LAYOUT_INVALID");
  }
  const expectedAssets = new Map();
  for (const asset of assets) {
    if (expectedAssets.has(asset.destinationPath)) {
      fail("AGENTMO_BUILDER_PACKAGE_LAYOUT_INVALID");
    }
    expectedAssets.set(asset.destinationPath, asset);
  }
  const boundFiles = new Map();
  for (const member of binding.members) {
    if (member.kind !== "file") continue;
    if (boundFiles.has(member.relativePath)) {
      fail("AGENTMO_BUILDER_PACKAGE_LAYOUT_INVALID");
    }
    boundFiles.set(member.relativePath, member);
  }
  for (const [destinationPath, asset] of expectedAssets) {
    const member = boundFiles.get(destinationPath);
    if (!member
      || member.digest !== asset.digest
      || member.identity.size !== String(asset.byteLength)) {
      fail("AGENTMO_BUILDER_PACKAGE_LAYOUT_INVALID");
    }
  }
  for (const relativePath of boundFiles.keys()) {
    if (relativePath !== MARKETPLACE_DESCRIPTOR_RELATIVE_PATH
      && !expectedAssets.has(relativePath)) {
      // README.md is intentionally absent from the marketplace binding. This
      // bootstrap-only path accepts no unbound metadata or executable member.
      fail("AGENTMO_BUILDER_PACKAGE_LAYOUT_INVALID");
    }
  }
}

function validProjectionIdentityShape(identity, file) {
  return exactKeys(identity, [
    "device", "group", "inode", "links", "mode", "owner", "size",
  ])
    && ["device", "group", "inode", "links", "owner", "size"].every(
      (key) => /^\d+$/u.test(identity[key] ?? ""),
    )
    && /^[0-7]{3,4}$/u.test(identity.mode ?? "")
    && (file ? identity.links === "1" : !/^0+$/u.test(identity.links));
}

async function readBuilderAsset(layout, descriptor) {
  if (layout.kind === "bootstrap-graph") {
    return readBootstrapGraphFile(layout, descriptor.destinationPath, MAX_PACKAGE_FILE_BYTES);
  }
  if (layout.kind === "immutable-lifecycle") {
    return readImmutableLifecycleLayoutFile(layout, descriptor.sourcePath, MAX_PACKAGE_FILE_BYTES);
  }
  if (descriptor.kind === "plugin" && ![
    "self-contained", "source-tree",
  ].includes(layout.kind)) {
    return readCanonicalLayoutFile(layout.pluginRoot, descriptor.relativePath, MAX_PACKAGE_FILE_BYTES);
  }
  return readCanonicalLayoutFile(layout.packageRoot, descriptor.sourcePath, MAX_PACKAGE_FILE_BYTES);
}

async function readBuilderPackageFile(layout, relativePath, maxBytes) {
  if (layout.kind === "bootstrap-graph") {
    return readBootstrapGraphFile(
      layout,
      `${PROJECTED_RUNTIME_RELATIVE_PATH}/${relativePath}`,
      maxBytes,
    );
  }
  return layout.kind === "immutable-lifecycle"
    ? readImmutableLifecycleLayoutFile(layout, relativePath, maxBytes)
    : readCanonicalLayoutFile(layout.packageRoot, relativePath, maxBytes);
}

function readBootstrapGraphFile(layout, relativePath, maxBytes) {
  const bytes = layout.bootstrapFiles.get(relativePath);
  if (!Buffer.isBuffer(bytes) || bytes.byteLength > maxBytes) {
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }
  return Buffer.from(bytes);
}

async function readCanonicalProjectControlFile(projectRoot, relativePath, maxBytes) {
  if (![PROJECTED_RECEIPT_PATH, PROJECTED_MARKER_PATH].includes(relativePath)) {
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }
  const filePath = path.join(projectRoot, ...relativePath.split("/"));
  let stats;
  try {
    stats = await lstat(filePath, { bigint: true });
  } catch {
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }
  if (stats.nlink === 1n) {
    return readCanonicalLayoutFile(projectRoot, relativePath, maxBytes);
  }
  if (stats.nlink !== 2n) fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");

  const destinationParentBefore = await captureCanonicalDirectoryChain(
    projectRoot,
    path.dirname(filePath),
  );
  const destination = await readStableFileWithExpectedLinks(filePath, maxBytes, 2n);
  const destinationDigest = digestRawBytes(destination.bytes);
  let authority;
  try {
    authority = await readAppendOnlyAuthority({
      projectRoot,
      relativeRoot: ".agentmo-install-attempt-authority",
      namespace: "builder-install",
    });
  } catch {
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }
  const candidates = [];
  for (const record of authority.records) {
    const payload = record.payload;
    if (![
      "agentmo.builder-install-attempt.v1",
      "agentmo.builder-install-attempt.v2",
    ].includes(payload?.schemaVersion)
      || payload.disposition !== "committed"
      || payload.physicalDeletion !== false
      || !Array.isArray(payload.files)
      || !Array.isArray(payload.stages)) continue;
    const file = payload.files.find((entry) => (
      entry?.relativePath === relativePath
      && entry.operation === "create"
      && entry.digest === destinationDigest
    ));
    if (!file) continue;
    for (const stage of payload.stages) {
      if (stage?.destinationPath !== relativePath
        || stage.digest !== destinationDigest
        || !portableAssetPath(stage.relativePath)
        || path.posix.dirname(stage.relativePath) !== path.posix.dirname(relativePath)
        || !/^\.agentmo-stage-[a-f0-9]{32}$/u.test(path.posix.basename(stage.relativePath))
        || !exactKeys(stage.identity, ["device", "inode", "links", "size"])
        || stage.identity.device !== destination.stats.dev.toString(10)
        || stage.identity.inode !== destination.stats.ino.toString(10)
        || stage.identity.links !== "1"
        || stage.identity.size !== destination.stats.size.toString(10)) continue;
      candidates.push(stage);
    }
  }
  if (candidates.length !== 1) fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");

  const stagePath = path.join(projectRoot, ...candidates[0].relativePath.split("/"));
  const stageParentBefore = await captureCanonicalDirectoryChain(projectRoot, path.dirname(stagePath));
  const stage = await readStableFileWithExpectedLinks(stagePath, maxBytes, 2n);
  const destinationAfter = await readStableFileWithExpectedLinks(filePath, maxBytes, 2n);
  const stageParentAfter = await captureCanonicalDirectoryChain(projectRoot, path.dirname(stagePath));
  const destinationParentAfter = await captureCanonicalDirectoryChain(
    projectRoot,
    path.dirname(filePath),
  );
  if (!sameDirectoryChain(stageParentBefore, stageParentAfter)
    || !sameDirectoryChain(destinationParentBefore, destinationParentAfter)
    || stage.stats.dev !== destination.stats.dev
    || stage.stats.ino !== destination.stats.ino
    || stage.stats.size !== destination.stats.size
    || destinationAfter.stats.dev !== destination.stats.dev
    || destinationAfter.stats.ino !== destination.stats.ino
    || destinationAfter.stats.size !== destination.stats.size
    || !stage.bytes.equals(destination.bytes)
    || !destinationAfter.bytes.equals(destination.bytes)) {
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }
  return destination.bytes;
}

async function readStableFileWithExpectedLinks(filePath, maxBytes, expectedLinks) {
  let before;
  let handle;
  try {
    before = await lstat(filePath, { bigint: true });
    if (before.isSymbolicLink() || !before.isFile()
      || before.nlink !== expectedLinks
      || before.size > BigInt(maxBytes)
      || await realpath(filePath) !== filePath) {
      fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
    }
    handle = await open(filePath, FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW);
    const retainedBefore = await handle.stat({ bigint: true });
    if (!sameStableFileWithLinks(before, retainedBefore, expectedLinks)) {
      fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
    }
    const bytes = await readHandleBounded(handle, maxBytes);
    const retainedAfter = await handle.stat({ bigint: true });
    const after = await lstat(filePath, { bigint: true });
    if (!sameStableFileWithLinks(retainedBefore, retainedAfter, expectedLinks)
      || !sameStableFileWithLinks(retainedAfter, after, expectedLinks)
      || BigInt(bytes.byteLength) !== retainedAfter.size) {
      fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
    }
    return Object.freeze({ bytes, stats: retainedAfter });
  } catch (error) {
    if (error instanceof BuilderPackageError) throw error;
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  } finally {
    await handle?.close().catch(() => {});
  }
}

function sameStableFileWithLinks(left, right, expectedLinks) {
  return Boolean(
    left
    && right
    && left.isFile()
    && right.isFile()
    && !left.isSymbolicLink?.()
    && !right.isSymbolicLink?.()
    && left.nlink === expectedLinks
    && right.nlink === expectedLinks
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs
  );
}

function validateStableProjectionReleaseBinding(layout, packageManifest, releaseDigest) {
  if (layout.receipt.identity.name !== packageManifest.name
    || layout.receipt.identity.version !== packageManifest.version
    || layout.receipt.identity.releaseDigest !== releaseDigest
    || layout.marker.identity.releaseDigest !== releaseDigest) {
    fail("AGENTMO_BUILDER_PACKAGE_LAYOUT_INVALID");
  }
}

function validateImmutableLifecycleReleaseBinding(layout, packageManifest, releaseDigest) {
  if (layout.receipt.identity.name !== packageManifest.name
    || layout.receipt.identity.version !== packageManifest.version
    || layout.receipt.identity.adapterId !== "codex"
    || layout.receipt.identity.releaseDigest !== releaseDigest) {
    fail("AGENTMO_BUILDER_PACKAGE_LAYOUT_INVALID");
  }
}

async function readImmutableLifecycleLayoutFile(layout, relativePath, maxBytes) {
  if (!portableAssetPath(relativePath)) fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  return readImmutableLifecycleProjectFile(
    layout,
    `.agentmo/builder/releases/${layout.bundleId}/package/${relativePath}`,
    maxBytes,
  );
}

async function readImmutableLifecycleProjectFile(layout, relativePath, maxBytes) {
  if (!portableAssetPath(relativePath)
    || !relativePath.startsWith(`.agentmo/builder/releases/${layout.bundleId}/`)) {
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }
  const finalPath = path.join(layout.projectRoot, ...relativePath.split("/"));
  const finalParentBefore = await captureCanonicalDirectoryChain(
    layout.projectRoot,
    path.dirname(finalPath),
  );
  const final = await readStableFileWithExpectedLinks(finalPath, maxBytes, 2n);
  const finalDigest = digestRawBytes(final.bytes);
  const stageRelativePath = immutableReleaseStageRelativePath(relativePath, finalDigest);
  const stagePath = path.join(layout.projectRoot, ...stageRelativePath.split("/"));
  const stageParentBefore = await captureCanonicalDirectoryChain(
    layout.projectRoot,
    path.dirname(stagePath),
  );
  const stage = await readStableFileWithExpectedLinks(stagePath, maxBytes, 2n);
  const finalAfter = await readStableFileWithExpectedLinks(finalPath, maxBytes, 2n);
  const [finalParentAfter, stageParentAfter] = await Promise.all([
    captureCanonicalDirectoryChain(layout.projectRoot, path.dirname(finalPath)),
    captureCanonicalDirectoryChain(layout.projectRoot, path.dirname(stagePath)),
  ]);
  if (!sameDirectoryChain(finalParentBefore, finalParentAfter)
    || !sameDirectoryChain(stageParentBefore, stageParentAfter)
    || stage.stats.dev !== final.stats.dev
    || stage.stats.ino !== final.stats.ino
    || stage.stats.size !== final.stats.size
    || finalAfter.stats.dev !== final.stats.dev
    || finalAfter.stats.ino !== final.stats.ino
    || finalAfter.stats.size !== final.stats.size
    || !stage.bytes.equals(final.bytes)
    || !finalAfter.bytes.equals(final.bytes)) {
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }
  return final.bytes;
}

function immutableReleaseStageRelativePath(relativePath, fileDigest) {
  if (!portableAssetPath(relativePath) || !DIGEST_PATTERN.test(fileDigest ?? "")) {
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }
  const parent = path.posix.dirname(relativePath);
  const basename = path.posix.basename(relativePath);
  if (parent === "." || !portablePathSegment(basename)) {
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }
  const pathKey = digestJson({ path: relativePath, digest: fileDigest }, "builder-release-stage-key")
    .slice("sha256:".length);
  return `${parent}/.${basename}.${pathKey}.stage`;
}

async function readCanonicalLayoutFile(authorizedRoot, relativePath, maxBytes) {
  if (!portableAssetPath(relativePath)) fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  const filePath = path.join(authorizedRoot, ...relativePath.split("/"));
  const before = await captureCanonicalDirectoryChain(authorizedRoot, path.dirname(filePath));
  const bytes = await readBoundedNoFollowFile(filePath, maxBytes);
  let canonicalFile;
  try {
    canonicalFile = await realpath(filePath);
  } catch {
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }
  if (canonicalFile !== filePath) fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  const after = await captureCanonicalDirectoryChain(authorizedRoot, path.dirname(filePath));
  if (!sameDirectoryChain(before, after)) fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  return bytes;
}

async function captureCanonicalDirectoryChain(authorizedRoot, targetDirectory) {
  const relative = path.relative(authorizedRoot, targetDirectory);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }
  const directories = [authorizedRoot];
  if (relative !== "") {
    let current = authorizedRoot;
    for (const segment of relative.split(path.sep)) {
      if (segment.length === 0 || segment === "." || segment === "..") {
        fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
      }
      current = path.join(current, segment);
      directories.push(current);
    }
  }
  const identities = [];
  try {
    for (const directory of directories) {
      const stats = await lstat(directory, { bigint: true });
      if (stats.isSymbolicLink() || !stats.isDirectory() || await realpath(directory) !== directory) {
        fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
      }
      identities.push(Object.freeze({
        path: directory,
        dev: stats.dev,
        ino: stats.ino,
      }));
    }
  } catch (error) {
    if (error instanceof BuilderPackageError) throw error;
    fail("AGENTMO_BUILDER_PACKAGE_READ_FAILED");
  }
  return identities;
}

function sameDirectoryChain(left, right) {
  return left.length === right.length && left.every((entry, index) => {
    const other = right[index];
    return entry.path === other.path
      && entry.dev === other.dev
      && entry.ino === other.ino;
  });
}

function validateProjectedReleaseBinding(layout, packageManifest, assets, releaseDigest) {
  if (
    layout.receipt.identity.name !== packageManifest.name
    || layout.receipt.identity.version !== packageManifest.version
    || layout.receipt.identity.releaseDigest !== releaseDigest
    || layout.marker.identity.releaseDigest !== releaseDigest
  ) {
    fail("AGENTMO_BUILDER_PACKAGE_LAYOUT_INVALID");
  }
  for (const asset of assets) {
    const entry = layout.files.get(asset.destinationPath);
    if (
      entry?.ownership !== "exclusive-plugin-file"
      || entry.sourceDigest !== asset.digest
      || entry.destinationDigest !== asset.digest
    ) {
      fail("AGENTMO_BUILDER_PACKAGE_LAYOUT_INVALID");
    }
  }
}

function digestJson(value, subject) {
  return digestRawBytes(Buffer.from(serializePersistableJson(value, { subject }), "utf8"));
}
