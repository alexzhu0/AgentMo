import fs from "node:fs";
import path from "node:path";

function waitForMessage(type) {
  return new Promise((resolve) => {
    const receive = (message) => {
      if (message?.type !== type) return;
      process.off("message", receive);
      resolve(message);
    };
    process.on("message", receive);
  });
}

async function main() {
  const configuration = JSON.parse(process.argv[2]);
  process.send?.({ type: "ready" });
  await waitForMessage("diagnose");
  const canonicalProjectRoot = await fs.promises.realpath(configuration.projectRoot);
  const targetPath = path.resolve(
    canonicalProjectRoot,
    ...configuration.targetRelativePath.split("/"),
  );
  const probeHandle = await fs.promises.open(
    targetPath,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  );
  const targetIdentity = await probeHandle.stat({ bigint: true });
  const fileHandlePrototype = Object.getPrototypeOf(probeHandle);
  const originalReadDescriptor = Object.getOwnPropertyDescriptor(
    fileHandlePrototype,
    "read",
  );
  await probeHandle.close();
  const originalRead = originalReadDescriptor.value;
  let boundarySent = false;
  Object.defineProperty(fileHandlePrototype, "read", {
    ...originalReadDescriptor,
    value: async function interceptedRead(...readArgs) {
      const result = await Reflect.apply(originalRead, this, readArgs);
      if (boundarySent || !Number.isInteger(result?.bytesRead) || result.bytesRead <= 0) {
        return result;
      }
      const retained = await this.stat({ bigint: true });
      if (retained.dev !== targetIdentity.dev || retained.ino !== targetIdentity.ino) {
        return result;
      }
      boundarySent = true;
      const swapComplete = waitForMessage("swap-complete");
      process.send?.({
        type: "read-boundary",
        relativePath: configuration.targetRelativePath,
        identity: {
          device: retained.dev.toString(),
          inode: retained.ino.toString(),
        },
      });
      await swapComplete;
      return result;
    },
  });
  try {
    const { diagnoseBuilderInstall } = await import("../../src/builder-doctor.js");
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
  } finally {
    Object.defineProperty(fileHandlePrototype, "read", originalReadDescriptor);
  }
}

if (process.argv[2] !== undefined) {
  await main();
}
