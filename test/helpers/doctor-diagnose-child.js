import { diagnoseBuilderInstall } from "../../src/builder-doctor.js";

async function main() {
  const configuration = JSON.parse(process.argv[2]);
  process.send?.({ type: "ready" });
  await new Promise((resolve) => {
    process.once("message", resolve);
  });
  try {
    const report = await diagnoseBuilderInstall({
      projectRoot: configuration.projectRoot,
      probe: configuration.probe,
    });
    process.send?.({ type: "result", report });
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
