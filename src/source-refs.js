import path from "node:path";
import { containsSecretLikeValue, isDeniedDurableLocation, redactSecrets } from "./secret-redaction.js";

const WINDOWS_ABSOLUTE_PATH = /^(?:[a-zA-Z]:[\\/]|\\\\)/u;
const ENV_EXPANSION = /(?:\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|%[A-Za-z_][A-Za-z0-9_]*%)/u;
const URL_WITH_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/u;
const URL_WITH_AUTHORITY = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u;
const KNOWN_NON_HTTP_SCHEME = /^(?:file|ftp|sftp|ssh|s3|gs|data|javascript|mailto):/iu;
const FACT_REF_PATTERN = /^[a-z0-9][a-z0-9-]*:field:\d{2,}$/u;

export function validateSourceRefs(sourceRefs, options = {}) {
  const errors = [];
  const warnings = [];
  if (sourceRefs === undefined) return { ok: true, errors, warnings, refs: [] };
  const fieldPath = options.fieldPath ?? "source_refs";
  if (!Array.isArray(sourceRefs)) {
    return { ok: false, errors: [`${fieldPath} must be an array.`], warnings, refs: [] };
  }

  const sourceIds = new Set(Array.isArray(options.sourceIds) ? options.sourceIds : []);
  const factIds = new Set(Array.isArray(options.factIds) ? options.factIds : []);
  const requireKnownBareRefs = options.requireKnownBareRefs === true;
  const refs = [];
  for (const [index, value] of sourceRefs.entries()) {
    const pointer = `${fieldPath}[${index}]`;
    if (typeof value !== "string" || value.trim().length === 0) {
      errors.push(`${pointer} must be a non-empty string.`);
      continue;
    }
    const ref = value.trim();
    const refErrors = validateSingleSourceRef(ref, pointer, { sourceIds, factIds, requireKnownBareRefs });
    errors.push(...refErrors);
    if (refErrors.length === 0) refs.push(redactSecrets(ref));
  }
  return { ok: errors.length === 0, errors, warnings, refs };
}

function validateSingleSourceRef(ref, pointer, options) {
  const errors = [];
  if (ref.includes("\0")) errors.push(`${pointer} must not contain NUL bytes.`);
  if (containsSecretLikeValue(ref) || isDeniedDurableLocation(ref)) {
    errors.push(`${pointer} must not reference denied sensitive values or key material.`);
  }
  if (path.posix.isAbsolute(ref) || WINDOWS_ABSOLUTE_PATH.test(ref)) {
    errors.push(`${pointer} must be a bounded repo-relative path, discovery source id, discovery fact id, or http(s) URL.`);
  }
  if (ref.startsWith("~")) errors.push(`${pointer} must not use home-directory expansion.`);
  if (ENV_EXPANSION.test(ref)) errors.push(`${pointer} must not use environment-variable expansion.`);
  if (hasParentTraversal(ref)) errors.push(`${pointer} must not use parent-directory traversal.`);

  if (isKnownDiscoveryRef(ref, options)) return errors;

  if (URL_WITH_AUTHORITY.test(ref)) {
    try {
      const url = new URL(ref);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        errors.push(`${pointer} URL scheme must be http or https.`);
      }
      if (url.username || url.password) errors.push(`${pointer} URL must not contain embedded credentials.`);
    } catch {
      errors.push(`${pointer} must be a valid URL.`);
    }
    return errors;
  }

  if (KNOWN_NON_HTTP_SCHEME.test(ref)) {
    errors.push(`${pointer} URL scheme must be http or https.`);
    return errors;
  }

  if (URL_WITH_SCHEME.test(ref) && !FACT_REF_PATTERN.test(ref) && !options.factIds.has(ref)) {
    errors.push(`${pointer} must not use a non-http(s) URL-like scheme.`);
    return errors;
  }

  if (options.requireKnownBareRefs && isBareRef(ref) && !isKnownDiscoveryRef(ref, options)) {
    errors.push(`${pointer} bare refs must match a discovery source id or fact id.`);
  }
  return errors;
}

function isKnownDiscoveryRef(ref, options) {
  return options.sourceIds.has(ref) || options.factIds.has(ref);
}

function isBareRef(ref) {
  return !ref.includes("/") && !ref.includes("\\") && !ref.includes(".") && !ref.includes(":");
}

function hasParentTraversal(ref) {
  return ref.split(/[\\/]+/u).some((segment) => segment === "..");
}
