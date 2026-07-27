import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  applyArtifactMigration,
  planArtifactMigration,
  verifyMigrationOutput,
} from "../../src/migration-filesystem.js";

async function main() {
  const [serializedInputs, out] = process.argv.slice(2);
  const inputs = JSON.parse(serializedInputs);
  const digestEntries = [];
  for (const [index, input] of inputs.entries()) {
    const bytes = await readFile(input);
    digestEntries.push([
      `migration-input-${index}`,
      `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    ]);
  }
  const digests = Object.freeze(Object.fromEntries(digestEntries));
  const plan = await planArtifactMigration(inputs, { digests });
  process.send?.({ type: "ready" });
  await waitForContinue();
  let result;
  try {
    const applied = await applyArtifactMigration({ inputs, out, plan, digests });
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
