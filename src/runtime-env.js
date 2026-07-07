import path from "node:path";

export const DEFAULT_RUNTIME_ENV_ALLOWLIST = [
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "OPENCLAW_GATEWAY_PORT",
  "OPENCLAW_GATEWAY_TOKEN",
  "OPENCLAW_GATEWAY_URL",
  "OPENCLAW_GATEWAY_PASSWORD",
];

export function resolveRuntimeEnv(options = {}) {
  if (!hasEnvFile(options.envFile)) {
    return { descriptor: null, values: {}, secretValues: [] };
  }

  const allowedKeys = normalizeAllowedKeys(options.runtimeEnvAllowlist ?? DEFAULT_RUNTIME_ENV_ALLOWLIST);
  const parsed = parseEnvFileContent(options.envFileContent ?? "");
  const values = {};
  const presentKeys = [];
  const missingKeys = [];

  for (const key of allowedKeys) {
    if (Object.hasOwn(parsed, key) && parsed[key].length > 0) {
      values[key] = parsed[key];
      presentKeys.push(key);
    } else {
      missingKeys.push(key);
    }
  }

  return {
    descriptor: {
      envFile: {
        basename: path.basename(options.envFile),
        fullPathPersisted: false,
      },
      allowedKeys,
      presentKeys,
      missingKeys,
      valuesPersisted: false,
    },
    values,
    secretValues: Object.values(values),
  };
}

export function parseEnvFileContent(content) {
  const entries = {};
  const lines = String(content).split(/\r?\n/u);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const withoutExport = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trimStart() : trimmed;
    const separatorIndex = withoutExport.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = withoutExport.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) continue;
    const rawValue = withoutExport.slice(separatorIndex + 1).trim();
    entries[key] = parseEnvValue(rawValue);
  }
  return entries;
}

export function assertRuntimeEnvReady(descriptor, options = {}) {
  if (!options.live) return;
  const requiredKeys = requiredRuntimeEnvKeys(options);
  if (requiredKeys.length === 0) return;
  if (!descriptor) {
    throw new Error(`Missing required runtime env key(s): ${requiredKeys.join(", ")}.`);
  }
  const missingRequiredKeys = requiredKeys.filter((key) => !descriptor.presentKeys.includes(key));
  if (missingRequiredKeys.length > 0) {
    throw new Error(`Missing required runtime env key(s): ${missingRequiredKeys.join(", ")}.`);
  }
}

function requiredRuntimeEnvKeys(options) {
  const provider = normalizeOptionalString(options.provider);
  if (provider === "deepseek") return ["DEEPSEEK_API_KEY"];
  return [];
}

function parseEnvValue(rawValue) {
  if (rawValue.length >= 2 && rawValue.startsWith('"') && rawValue.endsWith('"')) {
    return rawValue.slice(1, -1).replace(/\\n/gu, "\n").replace(/\\"/gu, '"').replace(/\\\\/gu, "\\");
  }
  if (rawValue.length >= 2 && rawValue.startsWith("'") && rawValue.endsWith("'")) {
    return rawValue.slice(1, -1);
  }
  const commentIndex = rawValue.search(/\s#/u);
  return (commentIndex >= 0 ? rawValue.slice(0, commentIndex) : rawValue).trim();
}

function hasEnvFile(envFile) {
  return typeof envFile === "string" && envFile.trim().length > 0;
}

function normalizeAllowedKeys(keys) {
  return Array.from(
    new Set(
      keys
        .filter((key) => typeof key === "string")
        .map((key) => key.trim())
        .filter((key) => /^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)),
    ),
  ).sort();
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}
