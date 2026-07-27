import { diagnoseBuilderInstall } from "../../src/builder-doctor.js";

async function main() {
  const projectRoot = process.argv[2];
  try {
    await diagnoseBuilderInstall({
      projectRoot,
      unexpectedDoctorOption: true,
    });
    process.stdout.write(JSON.stringify({ type: "unexpected-success" }));
  } catch (error) {
    process.stdout.write(JSON.stringify({
      type: "error",
      error: { name: error?.name ?? null, code: error?.code ?? null },
    }));
    process.exitCode = 1;
  }
}

if (process.argv[2] !== undefined) {
  await main();
}
