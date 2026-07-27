import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants as FS_CONSTANTS } from "node:fs";
import {
  lstat,
  open,
  readFile,
  readdir,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { digestRawBytes } from "../src/artifact-admission.js";
import {
  BUILDER_NPM_METADATA_FILES,
  BUILDER_RELEASE_ASSET_INVENTORY,
  loadBuilderPackage,
  validateBuilderNpmTarballInventory,
} from "../src/builder-package.js";
import { assertBuilderPlatform } from "../src/builder-platform.js";
import { runBuilderPosixEffect } from "../src/builder-posix-effect.js";
import { serializePersistableJson } from "../src/persistability.js";

const execFileAsync = promisify(execFile);
const PACKAGE_NAME = "agentmo";
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const CONTINUATION_SOURCE_PATH = "src/builder-codex-uat-continuation.js";
const VERIFIER_SOURCE_PATH = "scripts/verify-codex-uat-candidate.js";
const RELEASE_MANIFEST_PATH = "src/builder-codex-uat-release-manifest.json";
const RELEASE_SET_COMMIT_NAME = "agentmo-builder-uat-release-set.json";
const RELEASE_SET_COMMIT_STAGE_NAME = ".agentmo-builder-uat-release-set.stage.json";
const RETAINED_TARBALL_NAMES = Object.freeze({
  baseline: ".agentmo-builder-uat-baseline.retained.tgz",
  successor: ".agentmo-builder-uat-successor.retained.tgz",
});
const MODULE_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

class BuilderUatReleaseError extends Error {
  constructor(code) {
    super("Builder UAT releases could not be produced.");
    this.name = "BuilderUatReleaseError";
    this.code = code;
  }
}

function fail(code) {
  throw new BuilderUatReleaseError(code);
}

function parseArguments(argv) {
  const values = {};
  let json = false;
  for (let index = 0; index < argv.length;) {
    const flag = argv[index];
    if (flag === "--json") {
      if (json) fail("AGENTMO_BUILDER_UAT_RELEASE_ARGUMENTS_REJECTED");
      json = true;
      index += 1;
      continue;
    }
    const value = argv[index + 1];
    if (!["--out", "--baseline-version", "--successor-version"].includes(flag)
      || value === undefined
      || Object.hasOwn(values, flag)) {
      fail("AGENTMO_BUILDER_UAT_RELEASE_ARGUMENTS_REJECTED");
    }
    values[flag] = value;
    index += 2;
  }
  if (!json
    || Object.keys(values).length !== 3
    || typeof values["--out"] !== "string"
    || values["--out"].length === 0
    || !VERSION_PATTERN.test(values["--baseline-version"] ?? "")
    || !VERSION_PATTERN.test(values["--successor-version"] ?? "")
    || values["--baseline-version"] === values["--successor-version"]) {
    fail("AGENTMO_BUILDER_UAT_RELEASE_ARGUMENTS_REJECTED");
  }
  return Object.freeze({
    outDirectory: path.resolve(values["--out"]),
    baselineVersion: values["--baseline-version"],
    successorVersion: values["--successor-version"],
  });
}

async function assertAbsent(filePath) {
  try {
    await lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
  }
  fail("AGENTMO_BUILDER_UAT_RELEASE_OUTPUT_REJECTED");
}

function sameFileIdentity(left, right) {
  return left.isFile()
    && right.isFile()
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.nlink === right.nlink
    && left.uid === right.uid
    && left.gid === right.gid
    && left.mode === right.mode
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function sameDirectoryIdentity(left, right) {
  return left.isDirectory()
    && right.isDirectory()
    && !left.isSymbolicLink()
    && !right.isSymbolicLink()
    && left.dev === right.dev
    && left.ino === right.ino
    && left.uid === right.uid
    && left.gid === right.gid
    && left.mode === right.mode;
}

async function retainDirectory(directoryPath) {
  let handle;
  try {
    handle = await open(
      directoryPath,
      FS_CONSTANTS.O_RDONLY
        | FS_CONSTANTS.O_DIRECTORY
        | FS_CONSTANTS.O_NOFOLLOW,
    );
    const [heldStats, pathStats] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(directoryPath, { bigint: true }),
    ]);
    if (!sameDirectoryIdentity(heldStats, pathStats)) {
      fail("AGENTMO_BUILDER_UAT_RELEASE_PUBLISH_REJECTED");
    }
    return Object.freeze({
      path: directoryPath,
      handle,
      identity: heldStats,
    });
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error instanceof BuilderUatReleaseError) throw error;
    fail("AGENTMO_BUILDER_UAT_RELEASE_PUBLISH_REJECTED");
  }
}

function effectDirectoryAuthority(authority) {
  return Object.freeze({
    path: authority.path,
    handle: authority.handle,
    identity: Object.freeze({
      device: authority.identity.dev.toString(10),
      inode: authority.identity.ino.toString(10),
      uid: authority.identity.uid.toString(10),
      gid: authority.identity.gid.toString(10),
      mode: (authority.identity.mode & 0o777n).toString(8),
    }),
  });
}

function effectFileIdentity(stats) {
  return Object.freeze({
    device: stats.dev.toString(10),
    inode: stats.ino.toString(10),
    links: stats.nlink.toString(10),
    size: stats.size.toString(10),
  });
}

async function createRetainedDirectory(parentAuthority, name, allowExisting = false) {
  try {
    const effect = await runBuilderPosixEffect({
      action: "mkdir",
      name,
      payload: "",
    }, {
      directoryAuthority: effectDirectoryAuthority(parentAuthority),
    });
    if (!allowExisting && effect.created !== true) {
      fail("AGENTMO_BUILDER_UAT_RELEASE_PUBLISH_REJECTED");
    }
    return retainDirectory(path.join(parentAuthority.path, name));
  } catch (error) {
    if (error instanceof BuilderUatReleaseError) throw error;
    fail("AGENTMO_BUILDER_UAT_RELEASE_PUBLISH_REJECTED");
  }
}

async function writeRetainedBytes(directoryAuthority, name, bytes, allowExisting = false) {
  try {
    const effect = await runBuilderPosixEffect({
      action: "write-file",
      name,
      payload: Buffer.from(bytes).toString("base64"),
    }, {
      directoryAuthority: effectDirectoryAuthority(directoryAuthority),
    });
    if (!allowExisting && effect.created !== true) {
      fail("AGENTMO_BUILDER_UAT_RELEASE_PUBLISH_REJECTED");
    }
    return effect;
  } catch (error) {
    if (error instanceof BuilderUatReleaseError) throw error;
    fail("AGENTMO_BUILDER_UAT_RELEASE_PUBLISH_REJECTED");
  }
}

async function retainPackageDirectory(packageRoot, relativeDirectory) {
  let authority = await retainDirectory(packageRoot);
  try {
    for (const segment of relativeDirectory.split("/").filter(Boolean)) {
      const next = await createRetainedDirectory(authority, segment, true);
      await authority.handle.close().catch(() => {});
      authority = next;
    }
    return authority;
  } catch (error) {
    await authority.handle.close().catch(() => {});
    throw error;
  }
}

async function revalidateDirectory(authority) {
  try {
    const [heldStats, pathStats] = await Promise.all([
      authority.handle.stat({ bigint: true }),
      lstat(authority.path, { bigint: true }),
    ]);
    if (!sameDirectoryIdentity(authority.identity, heldStats)
      || !sameDirectoryIdentity(heldStats, pathStats)) {
      fail("AGENTMO_BUILDER_UAT_RELEASE_PUBLISH_REJECTED");
    }
  } catch (error) {
    if (error instanceof BuilderUatReleaseError) throw error;
    fail("AGENTMO_BUILDER_UAT_RELEASE_PUBLISH_REJECTED");
  }
}

async function writeRetainedCommitStage(scratchAuthority, bytes) {
  const stagePath = path.join(scratchAuthority.path, RELEASE_SET_COMMIT_STAGE_NAME);
  try {
    const effect = await runBuilderPosixEffect({
      action: "write-file",
      name: RELEASE_SET_COMMIT_STAGE_NAME,
      payload: bytes.toString("base64"),
    }, {
      directoryAuthority: effectDirectoryAuthority(scratchAuthority),
    });
    if (effect.created !== true) {
      fail("AGENTMO_BUILDER_UAT_RELEASE_PUBLISH_REJECTED");
    }
  } catch (error) {
    if (error instanceof BuilderUatReleaseError) throw error;
    fail("AGENTMO_BUILDER_UAT_RELEASE_PUBLISH_REJECTED");
  }
  const retained = await lstat(stagePath, { bigint: true });
  const pathnameStats = await lstat(stagePath, { bigint: true });
  if (!sameFileIdentity(retained, pathnameStats)
    || digestRawBytes(await readFile(stagePath)) !== digestRawBytes(bytes)) {
    fail("AGENTMO_BUILDER_UAT_RELEASE_PUBLISH_REJECTED");
  }
  return Object.freeze({ path: stagePath, identity: retained });
}

async function syncRetainedFile(filePath, expectedDigest) {
  let handle;
  try {
    const before = await lstat(filePath, { bigint: true });
    handle = await open(filePath, FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW);
    const heldBefore = await handle.stat({ bigint: true });
    if (!sameFileIdentity(before, heldBefore) || heldBefore.nlink !== 1n) {
      fail("AGENTMO_BUILDER_UAT_RELEASE_PUBLISH_REJECTED");
    }
    const bytes = await handle.readFile();
    if (digestRawBytes(bytes) !== expectedDigest) {
      fail("AGENTMO_BUILDER_UAT_RELEASE_PUBLISH_REJECTED");
    }
    await handle.sync();
    const [heldAfter, after] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(filePath, { bigint: true }),
    ]);
    if (!sameFileIdentity(heldBefore, heldAfter)
      || !sameFileIdentity(heldAfter, after)) {
      fail("AGENTMO_BUILDER_UAT_RELEASE_PUBLISH_REJECTED");
    }
  } catch (error) {
    if (error instanceof BuilderUatReleaseError) throw error;
    fail("AGENTMO_BUILDER_UAT_RELEASE_PUBLISH_REJECTED");
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function publishAbsentLink(sourcePath, destinationPath, expectedDigest) {
  let sourceHandle;
  let destinationHandle;
  let destinationAuthority;
  try {
    if (path.dirname(sourcePath) !== path.dirname(destinationPath)) {
      fail("AGENTMO_BUILDER_UAT_RELEASE_PUBLISH_REJECTED");
    }
    destinationAuthority = await retainDirectory(path.dirname(destinationPath));
    sourceHandle = await open(
      sourcePath,
      FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW,
    );
    const sourceBefore = await sourceHandle.stat({ bigint: true });
    if (!sourceBefore.isFile()
      || sourceBefore.isSymbolicLink()
      || sourceBefore.nlink !== 1n) {
      fail("AGENTMO_BUILDER_UAT_RELEASE_PUBLISH_REJECTED");
    }
    const sourceBytes = await sourceHandle.readFile();
    if (digestRawBytes(sourceBytes) !== expectedDigest) {
      fail("AGENTMO_BUILDER_UAT_RELEASE_PUBLISH_REJECTED");
    }
    const effect = await runBuilderPosixEffect({
      action: "hardlink",
      name: path.basename(destinationPath),
      payload: sourceBytes.toString("base64"),
      sourceName: path.basename(sourcePath),
      sourceIdentity: effectFileIdentity(sourceBefore),
    }, {
      directoryAuthority: effectDirectoryAuthority(destinationAuthority),
      sourceAuthority: Object.freeze({ handle: sourceHandle }),
    });
    if (effect.created !== true) fail("AGENTMO_BUILDER_UAT_RELEASE_OUTPUT_REJECTED");
    destinationHandle = await open(
      destinationPath,
      FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW,
    );
    const [sourceAfter, destinationBefore] = await Promise.all([
      sourceHandle.stat({ bigint: true }),
      destinationHandle.stat({ bigint: true }),
    ]);
    if (!sameFileIdentity(sourceAfter, destinationBefore)
      || !sameFileIdentityExceptLinks(sourceBefore, sourceAfter)
      || sourceAfter.nlink !== 2n
      || digestRawBytes(await destinationHandle.readFile()) !== expectedDigest) {
      fail("AGENTMO_BUILDER_UAT_RELEASE_PUBLISH_REJECTED");
    }
    await destinationHandle.sync();
    const [sourcePathAfter, destinationPathAfter, destinationAfter] = await Promise.all([
      lstat(sourcePath, { bigint: true }),
      lstat(destinationPath, { bigint: true }),
      destinationHandle.stat({ bigint: true }),
    ]);
    if (!sameFileIdentity(sourcePathAfter, destinationAfter)
      || !sameFileIdentity(destinationPathAfter, destinationAfter)
      || digestRawBytes(await readFile(sourcePath)) !== expectedDigest
      || digestRawBytes(await readFile(destinationPath)) !== expectedDigest) {
      fail("AGENTMO_BUILDER_UAT_RELEASE_PUBLISH_REJECTED");
    }
    return destinationAfter;
  } catch (error) {
    if (error instanceof BuilderUatReleaseError) throw error;
    fail("AGENTMO_BUILDER_UAT_RELEASE_PUBLISH_REJECTED");
  } finally {
    await destinationHandle?.close().catch(() => {});
    await sourceHandle?.close().catch(() => {});
    await destinationAuthority?.handle.close().catch(() => {});
  }
}

function sameFileIdentityExceptLinks(left, right) {
  return left.isFile()
    && right.isFile()
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.uid === right.uid
    && left.gid === right.gid
    && left.mode === right.mode
    && left.mtimeNs === right.mtimeNs;
}

async function revalidatePublishedPair(sourcePath, destinationPath, expectedDigest, expectedIdentity) {
  let sourceHandle;
  let destinationHandle;
  try {
    const [sourceBefore, destinationBefore] = await Promise.all([
      lstat(sourcePath, { bigint: true }),
      lstat(destinationPath, { bigint: true }),
    ]);
    sourceHandle = await open(sourcePath, FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW);
    destinationHandle = await open(
      destinationPath,
      FS_CONSTANTS.O_RDONLY | FS_CONSTANTS.O_NOFOLLOW,
    );
    const [sourceHeldBefore, destinationHeldBefore] = await Promise.all([
      sourceHandle.stat({ bigint: true }),
      destinationHandle.stat({ bigint: true }),
    ]);
    if (!sameFileIdentity(sourceBefore, sourceHeldBefore)
      || !sameFileIdentity(sourceHeldBefore, destinationBefore)
      || !sameFileIdentity(destinationBefore, destinationHeldBefore)
      || sourceHeldBefore.nlink !== 2n
      || (expectedIdentity !== undefined
        && !sameFileIdentity(sourceHeldBefore, expectedIdentity))) {
      fail("AGENTMO_BUILDER_UAT_RELEASE_PUBLISH_REJECTED");
    }
    const [sourceBytes, destinationBytes] = await Promise.all([
      sourceHandle.readFile(),
      destinationHandle.readFile(),
    ]);
    const [sourceHeldAfter, destinationHeldAfter, sourceAfter, destinationAfter] = await Promise.all([
      sourceHandle.stat({ bigint: true }),
      destinationHandle.stat({ bigint: true }),
      lstat(sourcePath, { bigint: true }),
      lstat(destinationPath, { bigint: true }),
    ]);
    if (!sameFileIdentity(sourceHeldBefore, sourceHeldAfter)
      || !sameFileIdentity(sourceHeldAfter, destinationHeldAfter)
      || !sameFileIdentity(destinationHeldAfter, sourceAfter)
      || !sameFileIdentity(sourceAfter, destinationAfter)
      || !sourceBytes.equals(destinationBytes)
      || digestRawBytes(sourceBytes) !== expectedDigest) {
      fail("AGENTMO_BUILDER_UAT_RELEASE_PUBLISH_REJECTED");
    }
    return sourceHeldAfter;
  } catch (error) {
    if (error instanceof BuilderUatReleaseError) throw error;
    fail("AGENTMO_BUILDER_UAT_RELEASE_PUBLISH_REJECTED");
  } finally {
    await destinationHandle?.close().catch(() => {});
    await sourceHandle?.close().catch(() => {});
  }
}

async function publishReleaseSet(scratchRoot, publishRoot, outDirectory, resultBasis) {
  const outputParent = path.dirname(outDirectory);
  const publications = [
    {
      role: "baseline",
      name: `${PACKAGE_NAME}-${resultBasis.baseline.version}.tgz`,
      digest: resultBasis.baseline.tarballDigest,
    },
    {
      role: "successor",
      name: `${PACKAGE_NAME}-${resultBasis.successor.version}.tgz`,
      digest: resultBasis.successor.tarballDigest,
    },
  ];
  const authorities = [];
  try {
    const outputParentAuthority = await retainDirectory(outputParent);
    authorities.push(outputParentAuthority);
    const scratchAuthority = await retainDirectory(scratchRoot);
    authorities.push(scratchAuthority);
    const publishAuthority = await retainDirectory(publishRoot);
    authorities.push(publishAuthority);

    // Admit every npm-produced source before copying it into the final retained
    // directory. Final publication never links across directory capabilities.
    for (const publication of publications) {
      await syncRetainedFile(
        path.join(publishRoot, publication.name),
        publication.digest,
      );
    }
    try {
      const effect = await runBuilderPosixEffect({
        action: "mkdir",
        name: path.basename(outDirectory),
        payload: "",
      }, {
        directoryAuthority: effectDirectoryAuthority(outputParentAuthority),
      });
      if (effect.created !== true) {
        fail("AGENTMO_BUILDER_UAT_RELEASE_OUTPUT_REJECTED");
      }
    } catch (error) {
      if (error instanceof BuilderUatReleaseError) throw error;
      fail("AGENTMO_BUILDER_UAT_RELEASE_OUTPUT_REJECTED");
    }
    const outputAuthority = await retainDirectory(outDirectory);
    authorities.push(outputAuthority);

    const memberIdentities = new Map();
    for (const publication of publications) {
      const retainedName = RETAINED_TARBALL_NAMES[publication.role];
      const retainedPath = path.join(outDirectory, retainedName);
      const sourceBytes = await readFile(path.join(publishRoot, publication.name));
      if (digestRawBytes(sourceBytes) !== publication.digest) {
        fail("AGENTMO_BUILDER_UAT_RELEASE_PUBLISH_REJECTED");
      }
      const stage = await runBuilderPosixEffect({
        action: "write-file",
        name: retainedName,
        payload: sourceBytes.toString("base64"),
      }, {
        directoryAuthority: effectDirectoryAuthority(outputAuthority),
      });
      if (stage.created !== true) fail("AGENTMO_BUILDER_UAT_RELEASE_OUTPUT_REJECTED");
      publication.retainedName = retainedName;
      memberIdentities.set(publication.name, await publishAbsentLink(
        retainedPath,
        path.join(outDirectory, publication.name),
        publication.digest,
      ));
    }

    const members = [];
    for (const publication of publications) {
      const retainedPath = path.join(outDirectory, publication.retainedName);
      const publicPath = path.join(outDirectory, publication.name);
      const retained = await revalidatePublishedPair(
        retainedPath,
        publicPath,
        publication.digest,
        memberIdentities.get(publication.name),
      );
      members.push(Object.freeze({
        role: publication.role,
        publicRelativePath: publication.name,
        retainedRelativePath: publication.retainedName,
        digest: publication.digest,
        identity: persistedFileIdentity(retained),
      }));
    }
    const publicationBasis = {
      schemaVersion: "agentmo.builder-uat-release-publication.v2",
      outputBasename: path.basename(outDirectory),
      outputParentIdentity: persistedDirectoryIdentity(outputParentAuthority.identity),
      outputDirectoryIdentity: persistedDirectoryIdentity(outputAuthority.identity),
      commitRetainedRelativePath: RELEASE_SET_COMMIT_STAGE_NAME,
      members,
    };
    const operationId = digestRawBytes(Buffer.from(serializePersistableJson({
      schemaVersion: "agentmo.builder-uat-release-operation-basis.v2",
      predecessor: null,
      baseline: resultBasis.baseline,
      successor: resultBasis.successor,
      publication: publicationBasis,
    }, { subject: "builder-uat-release-operation-basis" }), "utf8"));
    const resultBasisWithoutCommit = {
      schemaVersion: "agentmo.builder-uat-release-set.v3",
      status: "built",
      operationId,
      predecessor: null,
      baseline: resultBasis.baseline,
      successor: resultBasis.successor,
      publication: Object.freeze(publicationBasis),
    };
    const commitBytes = Buffer.from(serializePersistableJson(resultBasisWithoutCommit, {
      subject: "builder-uat-release-set",
    }), "utf8");
    const commitDigest = digestRawBytes(commitBytes);
    const retainedCommit = await writeRetainedCommitStage(outputAuthority, commitBytes);
    const publicCommitPath = path.join(outDirectory, RELEASE_SET_COMMIT_NAME);
    const publishedCommitIdentity = await publishAbsentLink(
      retainedCommit.path,
      publicCommitPath,
      commitDigest,
    );
    const result = Object.freeze(resultBasisWithoutCommit);

    await Promise.all(authorities.map((authority) => revalidateDirectory(authority)));
    for (const publication of publications) {
      await revalidatePublishedPair(
        path.join(outDirectory, publication.retainedName),
        path.join(outDirectory, publication.name),
        publication.digest,
        memberIdentities.get(publication.name),
      );
    }
    await revalidatePublishedPair(
      retainedCommit.path,
      publicCommitPath,
      commitDigest,
      publishedCommitIdentity,
    );
    const [actualMembers, actualRetainedMembers] = await Promise.all([
      readdir(outDirectory),
      readdir(publishRoot),
    ]);
    const expectedMembers = [
      ...publications.map((publication) => publication.retainedName),
      ...publications.map((publication) => publication.name),
      RELEASE_SET_COMMIT_STAGE_NAME,
      RELEASE_SET_COMMIT_NAME,
    ].sort((left, right) => left.localeCompare(right));
    const expectedRetainedMembers = publications
      .map((publication) => publication.name)
      .sort((left, right) => left.localeCompare(right));
    if (JSON.stringify(actualMembers.sort((left, right) => left.localeCompare(right)))
        !== JSON.stringify(expectedMembers)
      || JSON.stringify(actualRetainedMembers.sort((left, right) => left.localeCompare(right)))
        !== JSON.stringify(expectedRetainedMembers)) {
      fail("AGENTMO_BUILDER_UAT_RELEASE_OUTPUT_REJECTED");
    }
    return result;
  } finally {
    await Promise.all(authorities.map((authority) => authority.handle.close().catch(() => {})));
  }
}

function persistedDirectoryIdentity(stats) {
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    fail("AGENTMO_BUILDER_UAT_RELEASE_PUBLISH_REJECTED");
  }
  return Object.freeze({
    device: stats.dev.toString(10),
    inode: stats.ino.toString(10),
    owner: stats.uid.toString(10),
    mode: stats.mode.toString(10),
  });
}

function persistedFileIdentity(stats) {
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 2n) {
    fail("AGENTMO_BUILDER_UAT_RELEASE_PUBLISH_REJECTED");
  }
  return Object.freeze({
    device: stats.dev.toString(10),
    inode: stats.ino.toString(10),
    links: stats.nlink.toString(10),
    size: stats.size.toString(10),
    owner: stats.uid.toString(10),
    mode: stats.mode.toString(10),
    modifiedNs: stats.mtimeNs.toString(10),
    changedNs: stats.ctimeNs.toString(10),
  });
}

async function copyReleaseInventory(packageRoot, version) {
  const sourcePaths = [
    ...BUILDER_RELEASE_ASSET_INVENTORY.map((asset) => asset.sourcePath),
    ...BUILDER_NPM_METADATA_FILES,
  ];
  for (const relativePath of sourcePaths) {
    const sourcePath = path.join(MODULE_ROOT, ...relativePath.split("/"));
    const destinationPath = path.join(packageRoot, ...relativePath.split("/"));
    let bytes = await readFile(sourcePath);
    if (relativePath === "package.json"
      || relativePath === "plugin/.codex-plugin/plugin.json") {
      let manifest;
      try {
        manifest = JSON.parse(bytes.toString("utf8"));
      } catch {
        fail("AGENTMO_BUILDER_UAT_RELEASE_SOURCE_REJECTED");
      }
      manifest.version = version;
      bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    }
    const relativeDirectory = path.posix.dirname(relativePath);
    const authority = await retainPackageDirectory(
      packageRoot,
      relativeDirectory === "." ? "" : relativeDirectory,
    );
    try {
      await writeRetainedBytes(authority, path.basename(destinationPath), bytes);
    } finally {
      await authority.handle.close().catch(() => {});
    }
  }
}

async function writeReleaseManifest(packageRoot, version) {
  const [continuationBytes, verifierBytes] = await Promise.all([
    readFile(path.join(packageRoot, CONTINUATION_SOURCE_PATH)),
    readFile(path.join(packageRoot, VERIFIER_SOURCE_PATH)),
  ]);
  const continuationDigest = digestRawBytes(continuationBytes);
  const verifierDigest = digestRawBytes(verifierBytes);
  if (continuationDigest === verifierDigest) {
    fail("AGENTMO_BUILDER_UAT_RELEASE_IDENTITY_REJECTED");
  }
  const manifest = {
    schemaVersion: "agentmo.codex-uat-release-manifest.v1",
    packageName: PACKAGE_NAME,
    version,
    continuation: {
      sourcePath: CONTINUATION_SOURCE_PATH,
      sha256: continuationDigest,
    },
    verifier: {
      sourcePath: VERIFIER_SOURCE_PATH,
      sha256: verifierDigest,
    },
  };
  const bytes = Buffer.from(serializePersistableJson(manifest, {
    subject: "builder-codex-uat-release-manifest",
  }), "utf8");
  const authority = await retainPackageDirectory(
    packageRoot,
    path.posix.dirname(RELEASE_MANIFEST_PATH),
  );
  try {
    await writeRetainedBytes(authority, path.posix.basename(RELEASE_MANIFEST_PATH), bytes);
  } finally {
    await authority.handle.close().catch(() => {});
  }
  return Object.freeze({
    continuationDigest,
    verifierDigest,
    manifestDigest: digestRawBytes(bytes),
  });
}

async function npmPack(packageRoot, packDirectory, cacheDirectory, homeDirectory) {
  let result;
  try {
    result = await execFileAsync("npm", [
      "pack",
      "--json",
      "--ignore-scripts",
      "--cache", cacheDirectory,
      "--pack-destination", packDirectory,
    ], {
      cwd: packageRoot,
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      env: {
        HOME: homeDirectory,
        LANG: "C",
        PATH: process.env.PATH ?? "",
        npm_config_cache: cacheDirectory,
        npm_config_ignore_scripts: "true",
        npm_config_userconfig: path.join(homeDirectory, ".npmrc"),
      },
    });
  } catch {
    fail("AGENTMO_BUILDER_UAT_RELEASE_PACK_REJECTED");
  }
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    fail("AGENTMO_BUILDER_UAT_RELEASE_PACK_REJECTED");
  }
  if (!Array.isArray(report)
    || report.length !== 1
    || report[0]?.name !== PACKAGE_NAME
    || !VERSION_PATTERN.test(report[0]?.version ?? "")
    || report[0]?.filename !== `${PACKAGE_NAME}-${report[0].version}.tgz`) {
    fail("AGENTMO_BUILDER_UAT_RELEASE_PACK_REJECTED");
  }
  try {
    validateBuilderNpmTarballInventory(report[0].files);
  } catch {
    fail("AGENTMO_BUILDER_UAT_RELEASE_PACK_REJECTED");
  }
  return path.join(packDirectory, report[0].filename);
}

async function verifyFreshExtraction(tarballPath, extractionRoot, expected) {
  const scratchAuthority = await retainDirectory(path.dirname(extractionRoot));
  try {
    const extractionAuthority = await createRetainedDirectory(
      scratchAuthority,
      path.basename(extractionRoot),
    );
    await extractionAuthority.handle.close().catch(() => {});
  } finally {
    await scratchAuthority.handle.close().catch(() => {});
  }
  try {
    await execFileAsync("tar", ["-xzf", tarballPath, "-C", extractionRoot], {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
    });
  } catch {
    fail("AGENTMO_BUILDER_UAT_RELEASE_EXTRACT_REJECTED");
  }
  const packageRoot = path.join(extractionRoot, "package");
  const release = await loadBuilderPackage({ packageRoot });
  if (release.name !== expected.packageName
    || release.version !== expected.version
    || release.releaseDigest !== expected.releaseDigest) {
    fail("AGENTMO_BUILDER_UAT_RELEASE_IDENTITY_REJECTED");
  }
  for (const asset of release.assets.filter(
    (item) => [".js", ".mjs", ".cjs"].includes(path.extname(item.sourcePath)),
  )) {
    try {
      await execFileAsync(process.execPath, [
        "--check",
        path.join(packageRoot, ...asset.sourcePath.split("/")),
      ], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
    } catch {
      fail("AGENTMO_BUILDER_UAT_RELEASE_SYNTAX_REJECTED");
    }
  }
  const manifestDigest = digestRawBytes(await readFile(
    path.join(packageRoot, RELEASE_MANIFEST_PATH),
  ));
  const verifierDigest = digestRawBytes(await readFile(
    path.join(packageRoot, VERIFIER_SOURCE_PATH),
  ));
  if (manifestDigest !== expected.manifestDigest
    || verifierDigest !== expected.verifierDigest) {
    fail("AGENTMO_BUILDER_UAT_RELEASE_IDENTITY_REJECTED");
  }
}

async function buildOneRelease(scratchRoot, publishRoot, label, version) {
  const packageRoot = path.join(scratchRoot, `${label}-source`);
  const extractionRoot = path.join(scratchRoot, `${label}-extract`);
  const cacheDirectory = path.join(scratchRoot, `${label}-npm-cache`);
  const homeDirectory = path.join(scratchRoot, `${label}-home`);
  const scratchAuthority = await retainDirectory(scratchRoot);
  let packageAuthority;
  let cacheAuthority;
  let homeAuthority;
  try {
    packageAuthority = await createRetainedDirectory(scratchAuthority, path.basename(packageRoot));
    cacheAuthority = await createRetainedDirectory(scratchAuthority, path.basename(cacheDirectory));
    homeAuthority = await createRetainedDirectory(scratchAuthority, path.basename(homeDirectory));
    await writeRetainedBytes(homeAuthority, ".npmrc", Buffer.alloc(0));
  } finally {
    await packageAuthority?.handle.close().catch(() => {});
    await cacheAuthority?.handle.close().catch(() => {});
    await homeAuthority?.handle.close().catch(() => {});
    await scratchAuthority.handle.close().catch(() => {});
  }
  await copyReleaseInventory(packageRoot, version);
  const manifestIdentity = await writeReleaseManifest(packageRoot, version);
  const release = await loadBuilderPackage({ packageRoot });
  if (release.name !== PACKAGE_NAME || release.version !== version) {
    fail("AGENTMO_BUILDER_UAT_RELEASE_IDENTITY_REJECTED");
  }
  const manifestAsset = release.assets.find(
    (asset) => asset.sourcePath === RELEASE_MANIFEST_PATH,
  );
  if (manifestAsset?.digest !== manifestIdentity.manifestDigest) {
    fail("AGENTMO_BUILDER_UAT_RELEASE_IDENTITY_REJECTED");
  }
  const tarballPath = await npmPack(
    packageRoot,
    publishRoot,
    cacheDirectory,
    homeDirectory,
  );
  const tarballDigest = digestRawBytes(await readFile(tarballPath));
  const identity = Object.freeze({
    packageName: release.name,
    version: release.version,
    releaseDigest: release.releaseDigest,
    tarballDigest,
    continuationDigest: manifestIdentity.continuationDigest,
    verifierDigest: manifestIdentity.verifierDigest,
    manifestDigest: manifestIdentity.manifestDigest,
  });
  await verifyFreshExtraction(tarballPath, extractionRoot, identity);
  return identity;
}

async function buildReleaseSet(request) {
  await assertAbsent(request.outDirectory);
  const parent = path.dirname(request.outDirectory);
  const resolvedParent = await realpath(parent);
  const darwinSystemAlias = process.platform === "darwin"
    && ["/var", "/tmp", "/etc"].some((prefix) => (
      (parent === prefix || parent.startsWith(`${prefix}${path.sep}`))
      && resolvedParent === `/private${parent}`
    ));
  if (resolvedParent !== parent && !darwinSystemAlias) {
    fail("AGENTMO_BUILDER_UAT_RELEASE_OUTPUT_REJECTED");
  }
  const parentAuthority = await retainDirectory(parent);
  const scratchBasename = `.agentmo-builder-uat-build-${randomBytes(16).toString("hex")}`;
  let scratchAuthority;
  try {
    scratchAuthority = await createRetainedDirectory(parentAuthority, scratchBasename);
  } finally {
    await parentAuthority.handle.close().catch(() => {});
  }
  const scratchRoot = path.join(parent, scratchBasename);
  const publishRoot = path.join(scratchRoot, "publish");
  try {
    const publishAuthority = await createRetainedDirectory(scratchAuthority, "publish");
    await publishAuthority.handle.close().catch(() => {});
  } finally {
    await scratchAuthority.handle.close().catch(() => {});
  }
  const baseline = await buildOneRelease(
    scratchRoot,
    publishRoot,
    "baseline",
    request.baselineVersion,
  );
  const successor = await buildOneRelease(
    scratchRoot,
    publishRoot,
    "successor",
    request.successorVersion,
  );
  if (baseline.packageName !== successor.packageName
    || baseline.version === successor.version
    || baseline.releaseDigest === successor.releaseDigest
    || baseline.tarballDigest === successor.tarballDigest
    || baseline.verifierDigest !== successor.verifierDigest
    || baseline.continuationDigest !== successor.continuationDigest) {
    fail("AGENTMO_BUILDER_UAT_RELEASE_IDENTITY_REJECTED");
  }
  const resultBasis = Object.freeze({
    baseline,
    successor,
  });
  return publishReleaseSet(scratchRoot, publishRoot, request.outDirectory, resultBasis);
}

function writeBounded(channel, value) {
  channel.write(`${serializePersistableJson(value, {
    subject: "builder-uat-release-set",
  })}`);
}

function assertReleaseBuilderPlatform() {
  try {
    assertBuilderPlatform();
  } catch {
    fail("AGENTMO_BUILDER_UAT_RELEASE_PLATFORM_UNSUPPORTED");
  }
}

async function main() {
  assertReleaseBuilderPlatform();
  const request = parseArguments(process.argv.slice(2));
  const result = await buildReleaseSet(request);
  writeBounded(process.stdout, result);
}

try {
  await main();
} catch (error) {
  writeBounded(process.stderr, {
    status: "rejected",
    code: error instanceof BuilderUatReleaseError
      ? error.code
      : "AGENTMO_BUILDER_UAT_RELEASE_REJECTED",
  });
  process.exitCode = 1;
}
