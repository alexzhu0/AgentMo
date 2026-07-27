import { publishCodexUatObservationLeaf } from "../../src/builder-codex-uat.js";

async function main() {
  const configuration = JSON.parse(process.argv[2]);
  try {
    const result = await publishCodexUatObservationLeaf(configuration.options);
    process.send?.({
      type: "result",
      result: {
        digest: result.digest,
        filePath: result.filePath,
        created: result.created,
      },
    });
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
