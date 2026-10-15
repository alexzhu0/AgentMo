import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

const ALLOWED_EXTENSIONS = new Set([".docx", ".md", ".txt"]);
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_BATCH_FILES = 10;
const MAX_BATCH_BODY_CHARS = 100_000;
const TEXTUTIL_PATH = "/usr/bin/textutil";
const BSDTAR_PATH = "/usr/bin/bsdtar";
const XMLLINT_PATH = "/usr/bin/xmllint";
const DOCX_TIMEOUT_MS = 2_000;
const DOCX_MAX_OUTPUT_BYTES = 512 * 1024;
const DOCX_MAX_STDERR_BYTES = 64 * 1024;
const MAX_RELATIONSHIP_FILES = 64;
const MAX_RELATIONSHIP_LIST_BYTES = 64 * 1024;
const MAX_RELATIONSHIP_BYTES = 256 * 1024;
const RELATIONSHIP_NAMESPACE = "http://schemas.openxmlformats.org/package/2006/relationships";
const RELATIONSHIP_XPATH = `concat(
  boolean(/*[local-name()="Relationships" and namespace-uri()="${RELATIONSHIP_NAMESPACE}"]),
  "|",
  boolean(//*[local-name()="Relationship" and namespace-uri()="${RELATIONSHIP_NAMESPACE}"]/@TargetMode[.="External"]),
  "|",
  boolean(//*[local-name()="Relationship" and namespace-uri()="${RELATIONSHIP_NAMESPACE}"]/@TargetMode[.!="Internal" and .!="External"])
)`.replace(/\s+/gu, " ");
const SAMPLE_BY_DIGEST = new Map([
  ["d8e81ee21a4e769ebaac19686d1640fa3fb63fbd65e352c5de54f6c9251f2045", {
    bodyRange: { fromLine: 13, toLine: 169 },
    sourceRange: { fromLine: 398, toLine: 554 },
  }],
  ["28e754b8d60c1ccb6fb2097760ef7b8418904de5a843df6a1c8084a23309edd1", {
    bodyRange: { fromLine: 13, toLine: 86 },
    sourceRange: { fromLine: 4237, toLine: 4310 },
  }],
  ["2d2ce917752a6504e63904f9850791855cde74350333d6bced015a7eed2fb5ff", {
    bodyRange: { fromLine: 13, toLine: 150 },
    sourceRange: { fromLine: 10510, toLine: 10647 },
  }],
]);

export class CourseWikiDocumentError extends Error {
  constructor(code) {
    super("Course Wiki document input was rejected.");
    this.name = "CourseWikiDocumentError";
    this.code = code;
  }
}

export async function normalizeDocument(input) {
  if (!input || typeof input !== "object") fail("COURSE_WIKI_DOCUMENT_INVALID");
  const { name, bytes, convertDocx } = input;
  validateName(name);
  if (!Buffer.isBuffer(bytes)) fail("COURSE_WIKI_DOCUMENT_INVALID");
  if (bytes.length === 0) fail("COURSE_WIKI_DOCUMENT_EMPTY");
  if (bytes.length > MAX_FILE_BYTES) fail("COURSE_WIKI_DOCUMENT_TOO_LARGE");
  if (convertDocx !== undefined && typeof convertDocx !== "function") {
    fail("COURSE_WIKI_DOCUMENT_INVALID");
  }

  const originalBytes = Buffer.from(bytes);
  const digest = createHash("sha256").update(originalBytes).digest("hex");
  const extension = path.extname(name).toLowerCase();
  let textBytes = originalBytes;
  if (extension === ".docx") {
    await rejectExternalDocxRelationships(originalBytes);
    textBytes = await convertDocxBounded(convertDocx ?? runTextutil, originalBytes);
  }

  const originalText = normalizeLines(decodeUtf8(textBytes));
  if (originalText.includes("\0")) fail("COURSE_WIKI_DOCUMENT_NUL");
  if (originalText.trim().length === 0) fail("COURSE_WIKI_DOCUMENT_EMPTY");

  const sample = SAMPLE_BY_DIGEST.get(digest);
  const separated = sample ? separateSample(originalText, sample) : genericBody(originalText);
  return {
    name,
    sourceDigest: `sha256:${digest}`,
    ...separated,
    originalBytes,
    originalText,
  };
}

export function validateDocumentBatch(documents) {
  if (!Array.isArray(documents) || documents.length === 0) {
    fail("COURSE_WIKI_DOCUMENT_BATCH_INVALID");
  }
  if (documents.length > MAX_BATCH_FILES) {
    fail("COURSE_WIKI_DOCUMENT_BATCH_TOO_LARGE");
  }
  let bodyChars = 0;
  for (const document of documents) {
    if (!validNormalizedDocument(document)) fail("COURSE_WIKI_DOCUMENT_BATCH_INVALID");
    if (document.originalBytes.length > MAX_FILE_BYTES) {
      fail("COURSE_WIKI_DOCUMENT_TOO_LARGE");
    }
    for (const _character of document.text) {
      bodyChars += 1;
      if (bodyChars > MAX_BATCH_BODY_CHARS) {
        fail("COURSE_WIKI_DOCUMENT_BATCH_BODY_TOO_LARGE");
      }
    }
  }
  return documents;
}

export function validateCitations(citations, documents) {
  if (!Array.isArray(citations) || !Array.isArray(documents)) {
    fail("COURSE_WIKI_CITATION_INVALID");
  }
  const byDigest = new Map();
  for (const document of documents) {
    if (typeof document?.sourceDigest !== "string" || !Array.isArray(document.lines)) {
      fail("COURSE_WIKI_CITATION_INVALID");
    }
    if (byDigest.has(document.sourceDigest)) {
      fail("COURSE_WIKI_CITATION_SOURCE_AMBIGUOUS");
    }
    byDigest.set(document.sourceDigest, document);
  }
  for (const citation of citations) {
    if (!citation || typeof citation !== "object"
      || typeof citation.sourceDigest !== "string"
      || typeof citation.quote !== "string") {
      fail("COURSE_WIKI_CITATION_INVALID");
    }
    const document = byDigest.get(citation.sourceDigest);
    if (!document) fail("COURSE_WIKI_CITATION_SOURCE_UNKNOWN");
    if (!Number.isSafeInteger(citation.fromLine)
      || !Number.isSafeInteger(citation.toLine)
      || citation.fromLine < 1
      || citation.toLine < citation.fromLine
      || citation.toLine > document.lines.length) {
      fail("COURSE_WIKI_CITATION_RANGE_INVALID");
    }
    const quote = document.lines.slice(citation.fromLine - 1, citation.toLine).join("\n");
    if (citation.quote !== quote) fail("COURSE_WIKI_CITATION_QUOTE_MISMATCH");
  }
  return true;
}

export function materializeCitationSelections(selections, documents) {
  if (!Array.isArray(selections) || !Array.isArray(documents)) {
    fail("COURSE_WIKI_CITATION_SELECTION_INVALID");
  }
  const byDigest = new Map();
  for (const document of documents) {
    if (typeof document?.sourceDigest !== "string" || !Array.isArray(document.lines)) {
      fail("COURSE_WIKI_CITATION_INVALID");
    }
    if (byDigest.has(document.sourceDigest)) {
      fail("COURSE_WIKI_CITATION_SOURCE_AMBIGUOUS");
    }
    byDigest.set(document.sourceDigest, document);
  }

  const citations = selections.map((selection) => {
    if (!selection || typeof selection !== "object" || Array.isArray(selection)
      || Object.keys(selection).length !== 3
      || !Object.hasOwn(selection, "sourceDigest")
      || !Object.hasOwn(selection, "fromLine")
      || !Object.hasOwn(selection, "toLine")
      || typeof selection.sourceDigest !== "string"
      || !/^sha256:[a-f0-9]{64}$/u.test(selection.sourceDigest)) {
      fail("COURSE_WIKI_CITATION_SELECTION_INVALID");
    }
    const document = byDigest.get(selection.sourceDigest);
    if (!document) fail("COURSE_WIKI_CITATION_SOURCE_UNKNOWN");
    if (!Number.isSafeInteger(selection.fromLine)
      || !Number.isSafeInteger(selection.toLine)
      || selection.fromLine < 1
      || selection.toLine < selection.fromLine
      || selection.toLine > document.lines.length) {
      fail("COURSE_WIKI_CITATION_RANGE_INVALID");
    }
    return {
      sourceDigest: selection.sourceDigest,
      fromLine: selection.fromLine,
      toLine: selection.toLine,
      quote: document.lines.slice(selection.fromLine - 1, selection.toLine).join("\n"),
    };
  });
  validateCitations(citations, documents);
  return citations;
}

function validateName(name) {
  if (typeof name !== "string" || name.length === 0 || Buffer.byteLength(name, "utf8") > 255
    || name.includes("/") || name.includes("\\") || name.includes("\0")) {
    fail("COURSE_WIKI_DOCUMENT_NAME_INVALID");
  }
  if (!ALLOWED_EXTENSIONS.has(path.extname(name).toLowerCase())) {
    fail("COURSE_WIKI_DOCUMENT_EXTENSION_UNSUPPORTED");
  }
}

function validNormalizedDocument(document) {
  return Boolean(document)
    && typeof document.name === "string"
    && typeof document.sourceDigest === "string"
    && typeof document.text === "string"
    && Array.isArray(document.lines)
    && document.lines.every((line) => typeof line === "string")
    && document.lines.join("\n") === document.text
    && Buffer.isBuffer(document.originalBytes);
}

function decodeUtf8(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("COURSE_WIKI_DOCUMENT_INVALID_UTF8");
  }
}

function normalizeLines(text) {
  return text.replace(/\r\n?/gu, "\n");
}

function genericBody(originalText) {
  const lines = originalText.split("\n");
  return {
    text: originalText,
    lines,
    provenanceText: null,
    licenseText: null,
    bodyRange: { fromLine: 1, toLine: lines.length },
    sourceRange: null,
  };
}

function separateSample(originalText, sample) {
  const originalLines = originalText.split("\n");
  const beginIndex = sample.bodyRange.fromLine - 2;
  const endIndex = originalLines.indexOf("END OF TEACHING EXCERPT", sample.bodyRange.toLine);
  if (originalLines[beginIndex] !== "BEGIN TEACHING EXCERPT"
    || endIndex === -1
    || endIndex <= sample.bodyRange.toLine - 1) {
    fail("COURSE_WIKI_DOCUMENT_SAMPLE_INVALID");
  }
  const lines = originalLines.slice(sample.bodyRange.fromLine - 1, sample.bodyRange.toLine);
  return {
    text: lines.join("\n"),
    lines,
    provenanceText: trimBlankLines(originalLines.slice(0, beginIndex)).join("\n"),
    licenseText: trimBlankLines(originalLines.slice(endIndex + 1)).join("\n"),
    bodyRange: { ...sample.bodyRange },
    sourceRange: { ...sample.sourceRange },
  };
}

function trimBlankLines(lines) {
  let from = 0;
  let to = lines.length;
  while (from < to && lines[from] === "") from += 1;
  while (to > from && lines[to - 1] === "") to -= 1;
  return lines.slice(from, to);
}

async function convertDocxBounded(convertDocx, bytes) {
  let timer;
  try {
    const output = await Promise.race([
      Promise.resolve().then(() => convertDocx(Buffer.from(bytes))),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new CourseWikiDocumentError(
          "COURSE_WIKI_DOCUMENT_CONVERSION_TIMEOUT",
        )), DOCX_TIMEOUT_MS);
      }),
    ]);
    const outputBytes = typeof output === "string" ? Buffer.from(output, "utf8")
      : Buffer.isBuffer(output) ? output
        : output instanceof Uint8Array ? Buffer.from(output) : null;
    if (!outputBytes) fail("COURSE_WIKI_DOCUMENT_CONVERSION_FAILED");
    if (outputBytes.length > DOCX_MAX_OUTPUT_BYTES) {
      fail("COURSE_WIKI_DOCUMENT_CONVERSION_OUTPUT_TOO_LARGE");
    }
    return outputBytes;
  } catch (error) {
    if (error instanceof CourseWikiDocumentError) throw error;
    fail("COURSE_WIKI_DOCUMENT_CONVERSION_FAILED");
  } finally {
    clearTimeout(timer);
  }
}

function runTextutil(bytes) {
  return runBoundedProcess({
    executable: TEXTUTIL_PATH,
    args: [
      "-convert", "txt",
      "-format", "docx",
      "-encoding", "UTF-8",
      "-noload",
      "-nostore",
      "-stdin",
      "-stdout",
    ],
    bytes,
    maxOutputBytes: DOCX_MAX_OUTPUT_BYTES,
    timeoutCode: "COURSE_WIKI_DOCUMENT_CONVERSION_TIMEOUT",
    outputCode: "COURSE_WIKI_DOCUMENT_CONVERSION_OUTPUT_TOO_LARGE",
    failureCode: "COURSE_WIKI_DOCUMENT_CONVERSION_FAILED",
  });
}

async function rejectExternalDocxRelationships(bytes) {
  const deadline = performance.now() + DOCX_TIMEOUT_MS;
  let listing;
  try {
    listing = await runBoundedProcess({
      executable: BSDTAR_PATH,
      args: ["-tf", "-", "*.rels"],
      bytes,
      maxOutputBytes: MAX_RELATIONSHIP_LIST_BYTES,
      timeoutCode: "COURSE_WIKI_DOCUMENT_DOCX_INSPECTION_TIMEOUT",
      outputCode: "COURSE_WIKI_DOCUMENT_DOCX_INVALID",
      failureCode: "COURSE_WIKI_DOCUMENT_DOCX_INVALID",
      timeoutMs: remainingInspectionMs(deadline),
    });
  } catch (error) {
    if (error instanceof CourseWikiDocumentError) throw error;
    fail("COURSE_WIKI_DOCUMENT_DOCX_INVALID");
  }
  let relationshipPaths;
  try {
    relationshipPaths = new TextDecoder("utf-8", { fatal: true }).decode(listing)
      .split("\n")
      .filter((entry) => entry.length > 0);
  } catch {
    fail("COURSE_WIKI_DOCUMENT_DOCX_INVALID");
  }
  if (relationshipPaths.length === 0
    || relationshipPaths.length > MAX_RELATIONSHIP_FILES
    || new Set(relationshipPaths).size !== relationshipPaths.length
    || relationshipPaths.some((entry) => !/^(?:[A-Za-z0-9._-]+\/)*_rels\/(?:\.rels|[A-Za-z0-9._-]+\.rels)$/u.test(entry)
      || entry.includes(".."))) {
    fail("COURSE_WIKI_DOCUMENT_DOCX_INVALID");
  }

  let totalBytes = 0;
  for (const relationshipPath of relationshipPaths) {
    const relationships = await runBoundedProcess({
      executable: BSDTAR_PATH,
      args: ["-xOf", "-", relationshipPath],
      bytes,
      maxOutputBytes: MAX_RELATIONSHIP_BYTES - totalBytes,
      timeoutCode: "COURSE_WIKI_DOCUMENT_DOCX_INSPECTION_TIMEOUT",
      outputCode: "COURSE_WIKI_DOCUMENT_DOCX_INVALID",
      failureCode: "COURSE_WIKI_DOCUMENT_DOCX_INVALID",
      timeoutMs: remainingInspectionMs(deadline),
    });
    if (relationships.length === 0) fail("COURSE_WIKI_DOCUMENT_DOCX_INVALID");
    totalBytes += relationships.length;
    let xml;
    try {
      xml = new TextDecoder("utf-8", { fatal: true }).decode(relationships);
    } catch {
      fail("COURSE_WIKI_DOCUMENT_DOCX_INVALID");
    }
    if (/<!(?:DOCTYPE|ENTITY)\b/u.test(xml)) fail("COURSE_WIKI_DOCUMENT_DOCX_INVALID");
    const validation = await runBoundedProcess({
      executable: XMLLINT_PATH,
      args: ["--nonet", "--nocatalogs", "--xpath", RELATIONSHIP_XPATH, "-"],
      bytes: relationships,
      maxOutputBytes: 64,
      timeoutCode: "COURSE_WIKI_DOCUMENT_DOCX_INSPECTION_TIMEOUT",
      outputCode: "COURSE_WIKI_DOCUMENT_DOCX_INVALID",
      failureCode: "COURSE_WIKI_DOCUMENT_DOCX_INVALID",
      timeoutMs: remainingInspectionMs(deadline),
    });
    const result = validation.toString("utf8").trim();
    if (result === "true|true|false" || result === "true|false|true" || result === "true|true|true") {
      fail("COURSE_WIKI_DOCUMENT_EXTERNAL_LINK");
    }
    if (result !== "true|false|false") fail("COURSE_WIKI_DOCUMENT_DOCX_INVALID");
  }
  remainingInspectionMs(deadline);
}

function remainingInspectionMs(deadline) {
  const remaining = Math.floor(deadline - performance.now());
  if (remaining <= 0) fail("COURSE_WIKI_DOCUMENT_DOCX_INSPECTION_TIMEOUT");
  return remaining;
}

function runBoundedProcess({
  executable,
  args,
  bytes,
  maxOutputBytes,
  timeoutCode,
  outputCode,
  failureCode,
  timeoutMs = DOCX_TIMEOUT_MS,
}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: "/",
      env: { LANG: "C.UTF-8", LC_ALL: "C.UTF-8", PATH: "/usr/bin:/bin" },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let outputExceeded = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxOutputBytes) {
        outputExceeded = true;
        child.kill("SIGKILL");
      } else {
        stdout.push(chunk);
      }
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > DOCX_MAX_STDERR_BYTES) child.kill("SIGKILL");
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(new CourseWikiDocumentError(failureCode, { cause: error }));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new CourseWikiDocumentError(timeoutCode));
      if (outputExceeded) return reject(new CourseWikiDocumentError(outputCode));
      if (stderrBytes > DOCX_MAX_STDERR_BYTES || code !== 0) {
        return reject(new CourseWikiDocumentError(failureCode));
      }
      resolve(Buffer.concat(stdout, stdoutBytes));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(bytes);
  });
}

function fail(code) {
  throw new CourseWikiDocumentError(code);
}
