export const REDACTED_SECRET = "[REDACTED_SECRET]";

const SECRET_KEY_FRAGMENT = "(?:api[_-]?key|apikey|token|secret|password|authorization)";
const EXPLICIT_SECRET_MIN_LENGTH = 8;

export function redactSecrets(value, secretValues = []) {
  let text = String(value);
  for (const secret of normalizeSecretValues(secretValues)) {
    text = text.split(secret).join(REDACTED_SECRET);
  }
  return text
    .replace(new RegExp(`\\b[A-Za-z0-9_-]*${SECRET_KEY_FRAGMENT}[A-Za-z0-9_-]*\\s*=\\s*[^\\s,}]+`, "giu"), REDACTED_SECRET)
    .replace(new RegExp(`(["']?[^"'\\s{}:,]*${SECRET_KEY_FRAGMENT}[^"'\\s{}:,]*["']?\\s*:\\s*)(?:"[^"]*"|'[^']*'|[^\\s,}]+)`, "giu"), `$1"${REDACTED_SECRET}"`)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/giu, `Bearer ${REDACTED_SECRET}`)
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/gu, REDACTED_SECRET);
}

export function containsSecretLikeValue(value, secretValues = []) {
  return redactSecrets(value, secretValues) !== String(value);
}

function normalizeSecretValues(secretValues) {
  return Array.from(
    new Set(
      secretValues.filter((secret) => typeof secret === "string" && secret.length >= EXPLICIT_SECRET_MIN_LENGTH),
    ),
  ).sort((left, right) => right.length - left.length);
}
