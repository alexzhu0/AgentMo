import {
  abortAppendOnlyPrepared,
  appendAppendOnlyRecord,
  finalizeAppendOnlyStagedOutcome,
  readAppendOnlyAuthority,
} from "../../src/builder-append-only-authority.js";

async function main() {
  let configurationBytes;
  if (process.argv[2] === "--stdin") {
    const chunks = [];
    let length = 0;
    for await (const chunk of process.stdin) {
      length += chunk.length;
      if (length > 2 * 1024 * 1024) throw new Error("append-only child input too large");
      chunks.push(chunk);
    }
    configurationBytes = Buffer.concat(chunks).toString("utf8");
  } else {
    configurationBytes = process.argv[2];
  }
  const configuration = JSON.parse(configurationBytes);
  let terminal;
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
    terminal = { type: "result", value };
  } catch (error) {
    terminal = {
      type: "error",
      error: { name: error?.name ?? null, code: error?.code ?? null },
    };
    process.exitCode = 1;
  }
  if (typeof process.send === "function" && process.connected) {
    await new Promise((resolve) => process.send(terminal, () => resolve()));
    if (process.connected) process.disconnect();
  }
}

if (process.argv[2] !== undefined) {
  await main();
}
