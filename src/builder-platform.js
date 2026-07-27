import { constants as FS_CONSTANTS } from "node:fs";

export const BUILDER_SUPPORTED_PLATFORMS = Object.freeze(["darwin", "linux"]);

export class BuilderPlatformError extends Error {
  constructor(code = "AGENTMO_BUILDER_PLATFORM_UNSUPPORTED") {
    super("The AgentMo Builder platform contract is unsupported.");
    this.name = "BuilderPlatformError";
    this.code = code;
  }
}

export function inspectBuilderPlatform(platform = process.platform) {
  if (typeof platform !== "string" || platform.length === 0) {
    throw new BuilderPlatformError("AGENTMO_BUILDER_PLATFORM_INVALID");
  }
  return Object.freeze({
    current: platform,
    supported: BUILDER_SUPPORTED_PLATFORMS.includes(platform),
    supportedPlatforms: BUILDER_SUPPORTED_PLATFORMS,
    filesystemContract: "posix-no-follow-private-owner",
  });
}

export function assertBuilderPlatform(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new BuilderPlatformError("AGENTMO_BUILDER_PLATFORM_INVALID");
  }
  const platform = Object.hasOwn(options, "platform") ? options.platform : process.platform;
  const constants = Object.hasOwn(options, "constants") ? options.constants : FS_CONSTANTS;
  const getuid = Object.hasOwn(options, "getuid") ? options.getuid : process.getuid;
  const report = inspectBuilderPlatform(platform);
  let uid = null;
  try {
    uid = typeof getuid === "function" ? getuid() : null;
  } catch {
    throw new BuilderPlatformError();
  }
  if (!report.supported
    || !Number.isSafeInteger(uid)
    || uid < 0
    || !constants
    || typeof constants !== "object"
    || !Number.isInteger(constants.O_DIRECTORY)
    || constants.O_DIRECTORY === 0
    || !Number.isInteger(constants.O_NOFOLLOW)
    || constants.O_NOFOLLOW === 0) {
    throw new BuilderPlatformError();
  }
  return report;
}
