import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  materializeCitationSelections,
  normalizeDocument,
  validateCitations,
  validateDocumentBatch,
} from "../src/course-wiki-documents.js";
import { describe, it } from "node:test";

const SAMPLE_ROOT = new URL("../docs/poc/course-wiki/sample-materials/", import.meta.url);
const SAMPLE_CASES = [
  {
    name: "01-nouns.txt",
    digest: "d8e81ee21a4e769ebaac19686d1640fa3fb63fbd65e352c5de54f6c9251f2045",
    bodyRange: { fromLine: 13, toLine: 169 },
    sourceRange: { fromLine: 398, toLine: 554 },
    firstLine: "NOUNS.",
  },
  {
    name: "02-adjectives.txt",
    digest: "28e754b8d60c1ccb6fb2097760ef7b8418904de5a843df6a1c8084a23309edd1",
    bodyRange: { fromLine: 13, toLine: 86 },
    sourceRange: { fromLine: 4237, toLine: 4310 },
    firstLine: "ADJECTIVES.",
  },
  {
    name: "03-sentence-analysis.txt",
    digest: "2d2ce917752a6504e63904f9850791855cde74350333d6bced015a7eed2fb5ff",
    bodyRange: { fromLine: 13, toLine: 150 },
    sourceRange: { fromLine: 10510, toLine: 10647 },
    firstLine: "PART II.",
  },
];

function assertCode(code) {
  return (error) => error?.code === code;
}

function makeDocument(overrides = {}) {
  return {
    name: overrides.name ?? "lesson.txt",
    sourceDigest: overrides.sourceDigest ?? "sha256:a",
    text: overrides.text ?? "Nouns name things.",
    lines: overrides.lines ?? ["Nouns name things."],
    originalBytes: overrides.originalBytes ?? Buffer.from("Nouns name things."),
  };
}

function makeDocx(input, format = "txt") {
  const result = spawnSync("/usr/bin/textutil", [
    "-convert", "docx",
    "-format", format,
    "-inputencoding", "UTF-8",
    "-noload",
    "-nostore",
    "-stdin",
    "-stdout",
  ], {
    input: Buffer.from(input, "utf8"),
    maxBuffer: 2 * 1024 * 1024,
    timeout: 5_000,
  });
  assert.equal(result.status, 0, result.stderr.toString("utf8"));
  assert.equal(result.stdout.subarray(0, 2).toString("ascii"), "PK");
  return result.stdout;
}

function addRelationship(bytes, { targetMode, comment = "", declaration = "" }) {
  const root = mkdtempSync(path.join(tmpdir(), "course-wiki-docx-"));
  try {
    const docxPath = path.join(root, "linked.docx");
    const relationshipDir = path.join(root, "word", "_rels");
    mkdirSync(relationshipDir, { recursive: true });
    writeFileSync(docxPath, bytes);
    writeFileSync(path.join(relationshipDir, "document.xml.rels"), [
      '<?xml version="1.0" encoding="UTF-8"?>',
      declaration,
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      comment,
      `<Relationship Id="fixture" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item.xml"${targetMode === undefined ? "" : ` TargetMode="${targetMode}"`}/>`,
      "</Relationships>",
    ].join(""));
    const result = spawnSync("/usr/bin/zip", ["-q", docxPath, "word/_rels/document.xml.rels"], {
      cwd: root,
      maxBuffer: 1024 * 1024,
      timeout: 5_000,
    });
    assert.equal(result.status, 0, result.stderr.toString("utf8"));
    return readFileSync(docxPath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("normalizeDocument", () => {
  it("preserves UTF-8 Chinese and English while normalizing CRLF and CR", async () => {
    const bytes = Buffer.from("名词给事物命名。\r\nNouns name things.\rLast line.", "utf8");
    const result = await normalizeDocument({ name: "lesson.MD", bytes });

    assert.equal(result.name, "lesson.MD");
    assert.equal(result.sourceDigest, `sha256:${createHash("sha256").update(bytes).digest("hex")}`);
    assert.equal(result.text, "名词给事物命名。\nNouns name things.\nLast line.");
    assert.deepEqual(result.lines, ["名词给事物命名。", "Nouns name things.", "Last line."]);
    assert.deepEqual(result.originalBytes, bytes);
    assert.notStrictEqual(result.originalBytes, bytes);
    assert.equal(result.originalText, result.text);
    assert.equal(result.provenanceText, null);
    assert.equal(result.licenseText, null);
    assert.deepEqual(result.bodyRange, { fromLine: 1, toLine: 3 });
    assert.equal(result.sourceRange, null);
  });

  it("rejects empty and whitespace-only documents", async () => {
    await assert.rejects(normalizeDocument({ name: "empty.txt", bytes: Buffer.alloc(0) }),
      assertCode("COURSE_WIKI_DOCUMENT_EMPTY"));
    await assert.rejects(normalizeDocument({ name: "blank.md", bytes: Buffer.from(" \r\n\t") }),
      assertCode("COURSE_WIKI_DOCUMENT_EMPTY"));
  });

  it("rejects NUL bytes and malformed UTF-8", async () => {
    await assert.rejects(normalizeDocument({ name: "nul.txt", bytes: Buffer.from("safe\0unsafe") }),
      assertCode("COURSE_WIKI_DOCUMENT_NUL"));
    await assert.rejects(normalizeDocument({ name: "bad.txt", bytes: Buffer.from([0xc3, 0x28]) }),
      assertCode("COURSE_WIKI_DOCUMENT_INVALID_UTF8"));
  });

  it("rejects forbidden extensions and traversal names", async () => {
    await assert.rejects(normalizeDocument({ name: "lesson.pdf", bytes: Buffer.from("text") }),
      assertCode("COURSE_WIKI_DOCUMENT_EXTENSION_UNSUPPORTED"));
    await assert.rejects(normalizeDocument({ name: "../lesson.txt", bytes: Buffer.from("text") }),
      assertCode("COURSE_WIKI_DOCUMENT_NAME_INVALID"));
    await assert.rejects(normalizeDocument({ name: "..\\lesson.txt", bytes: Buffer.from("text") }),
      assertCode("COURSE_WIKI_DOCUMENT_NAME_INVALID"));
  });

  it("accepts exactly 2 MiB and rejects larger files before decoding", async () => {
    const atLimit = await normalizeDocument({
      name: "limit.txt",
      bytes: Buffer.alloc(2 * 1024 * 1024, 0x61),
    });
    assert.equal(atLimit.originalBytes.length, 2 * 1024 * 1024);
    await assert.rejects(normalizeDocument({
      name: "large.txt",
      bytes: Buffer.alloc(2 * 1024 * 1024 + 1, 0x61),
    }), assertCode("COURSE_WIKI_DOCUMENT_TOO_LARGE"));
  });

  it("extracts a controlled DOCX through the real bounded textutil path", async () => {
    const bytes = makeDocx("名词给事物命名。\nNouns name things.");
    const result = await normalizeDocument({ name: "lesson.docx", bytes });

    assert.equal(result.text, "名词给事物命名。\nNouns name things.\n");
    assert.deepEqual(result.lines, ["名词给事物命名。", "Nouns name things.", ""]);
    assert.deepEqual(result.originalBytes, bytes);
  });

  it("rejects encoded DOCX external relationships before invoking a converter", async () => {
    const bytes = addRelationship(makeDocx("lesson"), { targetMode: "&#x45;xternal" });
    const convertDocx = async () => {
      throw new Error("converter must not run for an external relationship");
    };

    await assert.rejects(normalizeDocument({ name: "linked.docx", bytes, convertDocx }),
      assertCode("COURSE_WIKI_DOCUMENT_EXTERNAL_LINK"));
  });

  it("accepts an explicit Internal DOCX relationship", async () => {
    const bytes = addRelationship(makeDocx("lesson"), { targetMode: "Internal" });
    const result = await normalizeDocument({
      name: "internal.docx",
      bytes,
      convertDocx: async () => Buffer.from("lesson"),
    });

    assert.equal(result.text, "lesson");
  });

  it("ignores TargetMode text inside DOCX relationship comments", async () => {
    const bytes = addRelationship(makeDocx("lesson"), {
      comment: '<!-- TargetMode="External" -->',
    });
    const result = await normalizeDocument({
      name: "comment.docx",
      bytes,
      convertDocx: async () => Buffer.from("lesson"),
    });

    assert.equal(result.text, "lesson");
  });

  it("shares one deadline across all DOCX relationship inspection processes", async (t) => {
    const bytes = makeDocx("lesson");
    let now = 0;
    t.mock.method(performance, "now", () => {
      const current = now;
      now += 750;
      return current;
    });

    await assert.rejects(normalizeDocument({
      name: "aggregate-timeout.docx",
      bytes,
      convertDocx: async () => Buffer.from("converter must not run"),
    }), assertCode("COURSE_WIKI_DOCUMENT_DOCX_INSPECTION_TIMEOUT"));
  });

  it("rejects unknown relationship modes and XML entity declarations", async () => {
    const convertDocx = async () => Buffer.from("lesson");
    await assert.rejects(normalizeDocument({
      name: "unknown-mode.docx",
      bytes: addRelationship(makeDocx("lesson"), { targetMode: "Unknown" }),
      convertDocx,
    }), assertCode("COURSE_WIKI_DOCUMENT_EXTERNAL_LINK"));
    await assert.rejects(normalizeDocument({
      name: "entity.docx",
      bytes: addRelationship(makeDocx("lesson"), {
        declaration: '<!DOCTYPE Relationships [<!ENTITY mode "Internal">]>',
      }),
      convertDocx,
    }), assertCode("COURSE_WIKI_DOCUMENT_DOCX_INVALID"));
  });

  it("bounds injected DOCX conversion time and output", async () => {
    const bytes = makeDocx("bounded conversion");
    await assert.rejects(normalizeDocument({
      name: "slow.docx",
      bytes,
      convertDocx: async () => new Promise(() => {}),
    }), assertCode("COURSE_WIKI_DOCUMENT_CONVERSION_TIMEOUT"));
    await assert.rejects(normalizeDocument({
      name: "noisy.docx",
      bytes,
      convertDocx: async () => Buffer.alloc(512 * 1024 + 1, 0x61),
    }), assertCode("COURSE_WIKI_DOCUMENT_CONVERSION_OUTPUT_TOO_LARGE"));
  });

  it("recognizes exact sample digests and cites only their teaching excerpts", async () => {
    for (const sample of SAMPLE_CASES) {
      const bytes = await readFile(new URL(sample.name, SAMPLE_ROOT));
      const result = await normalizeDocument({ name: sample.name, bytes });

      assert.equal(createHash("sha256").update(bytes).digest("hex"), sample.digest);
      assert.equal(result.sourceDigest, `sha256:${sample.digest}`);
      assert.deepEqual(result.originalBytes, bytes);
      assert.equal(result.originalText.includes("BEGIN TEACHING EXCERPT"), true);
      assert.equal(result.originalText.includes("THE FULL PROJECT GUTENBERG LICENSE"), true);
      assert.equal(result.text.includes("BEGIN TEACHING EXCERPT"), false);
      assert.equal(result.text.includes("PROJECT GUTENBERG LICENSE"), false);
      assert.equal(result.lines[0], sample.firstLine);
      assert.equal(result.lines.length, sample.bodyRange.toLine - sample.bodyRange.fromLine + 1);
      assert.deepEqual(result.bodyRange, sample.bodyRange);
      assert.deepEqual(result.sourceRange, sample.sourceRange);
      assert.equal(result.provenanceText.includes("Authors: W. M. Baskervill and J. W. Sewell"), true);
      assert.equal(result.licenseText.startsWith("THE FULL PROJECT GUTENBERG LICENSE"), true);
    }
  });
});

describe("validateDocumentBatch", () => {
  it("returns the same valid batch", () => {
    const documents = [makeDocument()];
    assert.strictEqual(validateDocumentBatch(documents), documents);
  });

  it("rejects more than 10 documents", () => {
    const documents = Array.from({ length: 11 }, (_, index) => makeDocument({
      name: `lesson-${index}.txt`,
      sourceDigest: `sha256:${index}`,
    }));
    assert.equal(validateDocumentBatch(documents.slice(0, 10)).length, 10);
    assert.throws(() => validateDocumentBatch(documents),
      assertCode("COURSE_WIKI_DOCUMENT_BATCH_TOO_LARGE"));
  });

  it("accepts 100000 body characters and rejects 100001", () => {
    const first = makeDocument({ text: "a".repeat(60_000), lines: ["a".repeat(60_000)] });
    const atLimit = makeDocument({ text: "b".repeat(40_000), lines: ["b".repeat(40_000)] });
    const overLimit = makeDocument({ text: "b".repeat(40_001), lines: ["b".repeat(40_001)] });
    assert.strictEqual(validateDocumentBatch([first, atLimit])[1], atLimit);
    assert.throws(() => validateDocumentBatch([first, overLimit]),
      assertCode("COURSE_WIKI_DOCUMENT_BATCH_BODY_TOO_LARGE"));
  });

  it("counts astral Unicode symbols as one body character", () => {
    const atLimit = makeDocument({ text: "😀".repeat(100_000), lines: ["😀".repeat(100_000)] });
    const overLimit = makeDocument({ text: "😀".repeat(100_001), lines: ["😀".repeat(100_001)] });
    assert.strictEqual(validateDocumentBatch([atLimit])[0], atLimit);
    assert.throws(() => validateDocumentBatch([overLimit]),
      assertCode("COURSE_WIKI_DOCUMENT_BATCH_BODY_TOO_LARGE"));
  });

  it("rejects oversized retained uploads directly", () => {
    const oversized = makeDocument({ originalBytes: Buffer.alloc(2 * 1024 * 1024 + 1) });
    assert.throws(() => validateDocumentBatch([oversized]),
      assertCode("COURSE_WIKI_DOCUMENT_TOO_LARGE"));
  });
});

describe("validateCitations", () => {
  const documents = [
    makeDocument({ sourceDigest: "a", text: "Nouns name things.\nCommon nouns name classes.", lines: [
      "Nouns name things.",
      "Common nouns name classes.",
    ] }),
    makeDocument({ sourceDigest: "b", text: "Adjectives modify nouns.", lines: ["Adjectives modify nouns."] }),
  ];

  it("accepts exact one-based quoted line ranges", () => {
    assert.equal(validateCitations([
      { sourceDigest: "a", fromLine: 1, toLine: 2, quote: "Nouns name things.\nCommon nouns name classes." },
      { sourceDigest: "b", fromLine: 1, toLine: 1, quote: "Adjectives modify nouns." },
    ], documents), true);
  });

  it("rejects a citation that attributes words to the wrong source", () => {
    assert.throws(() => validateCitations([
      { sourceDigest: "a", fromLine: 1, toLine: 1, quote: "Adjectives name things." },
    ], documents), assertCode("COURSE_WIKI_CITATION_QUOTE_MISMATCH"));
  });

  it("rejects out-of-range and reversed citation ranges", () => {
    assert.throws(() => validateCitations([
      { sourceDigest: "a", fromLine: 0, toLine: 1, quote: "Nouns name things." },
    ], documents), assertCode("COURSE_WIKI_CITATION_RANGE_INVALID"));
    assert.throws(() => validateCitations([
      { sourceDigest: "a", fromLine: 2, toLine: 1, quote: "" },
    ], documents), assertCode("COURSE_WIKI_CITATION_RANGE_INVALID"));
    assert.throws(() => validateCitations([
      { sourceDigest: "a", fromLine: 1, toLine: 3, quote: "Nouns name things." },
    ], documents), assertCode("COURSE_WIKI_CITATION_RANGE_INVALID"));
  });

  it("rejects unknown or ambiguous source digests", () => {
    assert.throws(() => validateCitations([
      { sourceDigest: "missing", fromLine: 1, toLine: 1, quote: "Nouns name things." },
    ], documents), assertCode("COURSE_WIKI_CITATION_SOURCE_UNKNOWN"));
    assert.throws(() => validateCitations([], [documents[0], { ...documents[0] }]),
      assertCode("COURSE_WIKI_CITATION_SOURCE_AMBIGUOUS"));
  });

  it("matches citation quotes byte-for-byte after document normalization", () => {
    assert.throws(() => validateCitations([
      { sourceDigest: "a", fromLine: 1, toLine: 1, quote: "Nouns  name things." },
    ], documents), assertCode("COURSE_WIKI_CITATION_QUOTE_MISMATCH"));
  });
});

describe("materializeCitationSelections", () => {
  const firstDigest = `sha256:${"a".repeat(64)}`;
  const secondDigest = `sha256:${"b".repeat(64)}`;

  it("extracts exact public quotes from normalized lines, including blank lines", async () => {
    const document = await normalizeDocument({
      name: "normalized.txt",
      bytes: Buffer.from("First line\r\n\r\nThird line\rFourth line."),
    });
    assert.deepEqual(materializeCitationSelections([{
      sourceDigest: document.sourceDigest,
      fromLine: 1,
      toLine: 4,
    }], [document]), [{
      sourceDigest: document.sourceDigest,
      fromLine: 1,
      toLine: 4,
      quote: "First line\n\nThird line\nFourth line.",
    }]);
  });

  it("rejects model quote text, unknown fields, missing fields, and malformed selections", () => {
    const document = makeDocument({
      sourceDigest: firstDigest,
      text: "Nouns name things.",
      lines: ["Nouns name things."],
    });
    const invalidSelections = [
      { sourceDigest: firstDigest, fromLine: 1, toLine: 1, quote: "Nouns name things." },
      { sourceDigest: firstDigest, fromLine: 1, toLine: 1, extra: true },
      { sourceDigest: firstDigest, fromLine: 1 },
      null,
      [],
    ];

    for (const selection of invalidSelections) {
      assert.throws(() => materializeCitationSelections([selection], [document]),
        assertCode("COURSE_WIKI_CITATION_SELECTION_INVALID"));
    }
  });

  it("rejects unknown, incomplete, and ambiguous source identities", () => {
    const document = makeDocument({
      sourceDigest: firstDigest,
      text: "Nouns name things.",
      lines: ["Nouns name things."],
    });
    assert.throws(() => materializeCitationSelections([{
      sourceDigest: secondDigest,
      fromLine: 1,
      toLine: 1,
    }], [document]), assertCode("COURSE_WIKI_CITATION_SOURCE_UNKNOWN"));
    assert.throws(() => materializeCitationSelections([{
      sourceDigest: "a".repeat(64),
      fromLine: 1,
      toLine: 1,
    }], [document]), assertCode("COURSE_WIKI_CITATION_SELECTION_INVALID"));
    assert.throws(() => materializeCitationSelections([], [document, { ...document }]),
      assertCode("COURSE_WIKI_CITATION_SOURCE_AMBIGUOUS"));
  });

  it("rejects non-integer, zero, reversed, and out-of-bounds line ranges", () => {
    const document = makeDocument({
      sourceDigest: firstDigest,
      text: "First line.\nSecond line.",
      lines: ["First line.", "Second line."],
    });
    const invalidRanges = [
      { fromLine: 1.5, toLine: 2 },
      { fromLine: 0, toLine: 1 },
      { fromLine: 2, toLine: 1 },
      { fromLine: 1, toLine: 3 },
    ];

    for (const range of invalidRanges) {
      assert.throws(() => materializeCitationSelections([{
        sourceDigest: firstDigest,
        ...range,
      }], [document]), assertCode("COURSE_WIKI_CITATION_RANGE_INVALID"));
    }
  });
});
