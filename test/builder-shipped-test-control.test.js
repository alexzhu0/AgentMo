import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const SHIPPED_SOURCE_ROOTS = Object.freeze(["bin", "plugin", "scripts", "src"]);
const SOURCE_EXTENSIONS = new Set([".cjs", ".js", ".json", ".mjs", ".sh", ".toml"]);
const FORBIDDEN_TEST_CONTROL_MARKERS = Object.freeze([
  "__testOnly",
  "NODE_TEST_CONTEXT",
  "AGENTMO_TEST",
  "TEST_SEAM",
  "admitTest",
  "runTest",
]);
const FORBIDDEN_BUILDER_CALLBACK_CONTROLS = Object.freeze([
  "onCheckpoint",
  "onJournalCheckpoint",
]);
const FORBIDDEN_MIGRATION_CONTROL_MARKERS = Object.freeze([
  "InjectedMigrationFault",
  "createFaultController",
  "faultController",
  "onCheckpoint",
  "onSourceCapture",
  "probeCapabilities",
  "sourceIo",
]);

describe("shipped Builder test-control boundary", () => {
  it("does not ship caller-controlled test or fault control markers", async () => {
    const sourceFiles = await collectShippedSourceFiles();
    const findings = [];
    for (const filePath of sourceFiles) {
      const source = await readFile(path.join(REPOSITORY_ROOT, filePath), "utf8");
      for (const marker of FORBIDDEN_TEST_CONTROL_MARKERS) {
        if (source.includes(marker)) findings.push(`${filePath}:${marker}`);
      }
      if (filePath.startsWith("src/builder-")) {
        for (const marker of FORBIDDEN_BUILDER_CALLBACK_CONTROLS) {
          if (hasStandaloneIdentifier(source, marker)) findings.push(`${filePath}:${marker}`);
        }
      }
      if (filePath === "src/migration-filesystem.js") {
        for (const marker of FORBIDDEN_MIGRATION_CONTROL_MARKERS) {
          if (source.includes(marker)) findings.push(`${filePath}:${marker}`);
        }
      }
    }
    assert.deepEqual(findings, []);
  });
});

function hasStandaloneIdentifier(source, marker) {
  return new RegExp(`\\b${marker}\\b`, "u").test(source);
}

async function collectShippedSourceFiles() {
  const files = [];
  for (const root of SHIPPED_SOURCE_ROOTS) {
    await visit(root, files);
  }
  return files.toSorted((left, right) => left.localeCompare(right));
}

async function visit(relativeDirectory, files) {
  const directory = path.join(REPOSITORY_ROOT, relativeDirectory);
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      await visit(relativePath, files);
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(relativePath);
    }
  }
}
