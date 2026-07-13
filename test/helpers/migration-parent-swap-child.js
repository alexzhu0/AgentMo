import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  applyArtifactMigration,
  planArtifactMigration,
  verifyMigrationOutput,
} from "../../src/migration-filesystem.js";

export const MIGRATION_PARENT_SWAP_CHECKPOINTS = Object.freeze([
  "after_mkdir",
  "after_output_open",
  "before_receipt",
  "before_marker_commit",
]);

async function main() {
  const [input, out, checkpoint] = process.argv.slice(2);
  const bytes = await readFile(input);
  const digests = Object.freeze({
    "migration-input-0": `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  });
  const plan = await planArtifactMigration([input], { digests });
  let result;
  try {
    const applied = await applyArtifactMigration(
      { inputs: [input], out, plan, digests },
      {
        onCheckpoint: async (name) => {
          if (name !== checkpoint) return;
          process.send?.({ type: "checkpoint", name });
          await waitForContinue();
        },
      },
    );
    result = { code: null, ok: applied.ok };
  } catch (error) {
    result = {
      code: typeof error?.code === "string" ? error.code : "UNEXPECTED_ERROR",
      orphan_token: typeof error?.orphan_token === "string" ? error.orphan_token : null,
    };
  }
  const verification = await verifyMigrationOutput({ out, plan });
  process.send?.({
    type: "done",
    result,
    verification,
  });
}

function waitForContinue() {
  return new Promise((resolve) => {
    const listener = (message) => {
      if (message?.type !== "continue") return;
      process.off("message", listener);
      resolve();
    };
    process.on("message", listener);
  });
}

if (
  typeof process.send === "function" &&
  process.argv[1] === fileURLToPath(import.meta.url)
) {
  main()
    .catch(() => {
      process.send?.({
        type: "done",
        result: { code: "UNEXPECTED_ERROR", orphan_token: null },
        verification: { ok: false, reason: "verification_failed" },
      });
    })
    .finally(() => {
      process.disconnect?.();
    });
}
