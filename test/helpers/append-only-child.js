import {
  abortAppendOnlyPrepared,
  appendAppendOnlyRecord,
  finalizeAppendOnlyStagedOutcome,
  readAppendOnlyAuthority,
} from "../../src/builder-append-only-authority.js";

async function main() {
  const configuration = JSON.parse(process.argv[2]);
  try {
    let value;
    if (configuration.action === "append") {
      value = await appendAppendOnlyRecord(configuration.options);
    } else if (configuration.action === "abort") {
      value = await abortAppendOnlyPrepared(configuration.options);
    } else if (configuration.action === "finalize-outcome") {
      value = await finalizeAppendOnlyStagedOutcome(configuration.options);
    } else if (configuration.action === "read") {
      value = await readAppendOnlyAuthority(configuration.options);
    } else {
      throw new Error("unknown append-only child action");
    }
    process.send?.({ type: "result", value });
  } catch (error) {
    process.send?.({
      type: "error",
      error: { name: error?.name ?? null, code: error?.code ?? null },
    });
    process.exitCode = 1;
  }
}

if (process.argv[2] !== undefined) {
  await main();
}
