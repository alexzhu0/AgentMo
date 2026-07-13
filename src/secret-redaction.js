export const REDACTED_SECRET = "[REDACTED_SECRET]";
export const REDACTED_PATH = "[REDACTED_PATH]";

const SECRET_KEY_FRAGMENT = "(?:api[_-]?key|apikey|token|secret|password|authorization|credentials?|private[_-]?key|access[_-]?key)";
const SECRET_KEY_NAME = `(?:(?:[A-Za-z0-9]+[_-])*${SECRET_KEY_FRAGMENT}(?:[_-][A-Za-z0-9]+)*|[A-Za-z0-9]*(?:ApiKey|Token|Secret|Password|Authorization|Credential|Credentials|PrivateKey|AccessKey))`;
const EXPLICIT_SECRET_MIN_LENGTH = 8;
const DENIED_DURABLE_LOCATION_EXTENSIONS = new Set([".pem", ".key", ".p12", ".crt", ".cer", ".pfx"]);
const DENIED_DURABLE_LOCATION_FILENAMES = new Set([
  ".env",
  "credentials.json",
  "credential.json",
  "secrets.json",
  "secret.json",
  "tokens.json",
  "token.json",
  "credentials.txt",
  "credential.txt",
  "secrets.txt",
  "secret.txt",
  "tokens.txt",
  "token.txt",
]);
const POSIX_HOST_PATH_PATTERN =
  /(^|[\s"'`=:(\[{,;|])((?:\/(?!\/)[^\s"'`<>),\]}]+))/gu;
const WINDOWS_HOST_PATH_PATTERN = /\b[A-Za-z]:[\\/][^\s"'`<>),\]}]+/gu;
const FILE_URL_HOST_PATH_PATTERN = /\bfile:\/\/[^\s"'`<>),\]}]+/giu;
const GITHUB_TOKEN_PATTERN = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/gu;
const AWS_ACCESS_KEY_PATTERN = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu;
const PRIVATE_KEY_BLOCK_PATTERN = /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )?PRIVATE KEY-----/gu;

export function redactSecrets(value, secretValues = []) {
  let text = String(value);
  for (const secret of normalizeSecretValues(secretValues)) {
    text = text.split(secret).join(REDACTED_SECRET);
  }
  return text
    .replace(new RegExp(`\\b${SECRET_KEY_NAME}\\s*=\\s*[^\\s,}]+`, "giu"), REDACTED_SECRET)
    .replace(new RegExp(`(["']?${SECRET_KEY_NAME}["']?\\s*:\\s*)(?:"[^"]*"|'[^']*'|[^\\s,}]+)`, "giu"), `$1"${REDACTED_SECRET}"`)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/giu, `Bearer ${REDACTED_SECRET}`)
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/gu, REDACTED_SECRET)
    .replace(GITHUB_TOKEN_PATTERN, REDACTED_SECRET)
    .replace(AWS_ACCESS_KEY_PATTERN, REDACTED_SECRET)
    .replace(JWT_PATTERN, REDACTED_SECRET)
    .replace(PRIVATE_KEY_BLOCK_PATTERN, REDACTED_SECRET);
}

export function containsSecretLikeValue(value, secretValues = []) {
  return redactSecrets(value, secretValues) !== String(value);
}

export function containsSecretLikeKey(value) {
  if (typeof value !== "string") return false;
  const normalized = value.toLowerCase().replace(/[_-]/gu, "");
  return new RegExp(`^${SECRET_KEY_NAME}$`, "iu").test(value)
    || ["credential", "credentials", "privatekey", "accesskey"].some(
      (suffix) => normalized === suffix || normalized.endsWith(suffix),
    );
}

export function isSecretSafetyFlagKey(value) {
  if (typeof value !== "string") return false;
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/gu, "");
  const hasSafetySuffix = normalized.endsWith("stored") || normalized.endsWith("persisted");
  return hasSafetySuffix && ["secret", "credential", "privatekey", "accesskey", "apikey", "token"]
    .some((fragment) => normalized.includes(fragment));
}

export function redactHostAbsolutePaths(value) {
  return String(value)
    .replace(FILE_URL_HOST_PATH_PATTERN, REDACTED_PATH)
    .replace(POSIX_HOST_PATH_PATTERN, `$1${REDACTED_PATH}`)
    .replace(WINDOWS_HOST_PATH_PATTERN, REDACTED_PATH);
}

export function containsHostAbsolutePath(value) {
  return redactHostAbsolutePaths(value) !== String(value);
}

export function redactManagedText(value, secretValues = []) {
  return redactHostAbsolutePaths(redactSecrets(value, secretValues));
}

export function isDeniedDurableLocation(value) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (text.length === 0 || text.includes("\0")) return false;
  if (containsSecretLikeValue(text)) return true;
  return text
    .split(/[\\/]+/u)
    .filter((segment) => segment.length > 0)
    .some((segment) => isDeniedDurableLocationSegment(segment));
}

function normalizeSecretValues(secretValues) {
  return Array.from(
    new Set(
      secretValues.filter((secret) => typeof secret === "string" && secret.length >= EXPLICIT_SECRET_MIN_LENGTH),
    ),
  ).sort((left, right) => right.length - left.length);
}

function isDeniedDurableLocationSegment(segment) {
  const basename = segment.toLowerCase();
  if (DENIED_DURABLE_LOCATION_FILENAMES.has(basename)) return true;
  if (basename.startsWith(".env.")) return true;
  if (DENIED_DURABLE_LOCATION_EXTENSIONS.has(durableExtension(basename))) return true;
  return /^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519|private-key|private_key)$/u.test(basename);
}

function durableExtension(basename) {
  const dotIndex = basename.lastIndexOf(".");
  return dotIndex > 0 ? basename.slice(dotIndex) : "";
}
