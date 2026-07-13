import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { loadAdmittedBlueprint } from "../../src/blueprint.js";

export function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export async function admitBlueprint(file) {
  const bytes = await readFile(file);
  return loadAdmittedBlueprint(file, {
    subject: "blueprint",
    expectedDigest: digestBytes(bytes),
  });
}
