import {
  loadCodexUatContinuation,
  transitionCodexUatContinuation,
} from "../../src/builder-codex-uat-private-authority.js";

async function main() {
  const configuration = JSON.parse(process.argv[2]);
  try {
    const current = await loadCodexUatContinuation({
      repositoryRoot: configuration.repositoryRoot,
    });
    let result;
    if (current.value.sequence === 0) {
      result = await transitionCodexUatContinuation({
        repositoryRoot: configuration.repositoryRoot,
        expectedAdmission: current,
        next: configuration.next,
      });
    } else {
      if (current.value.sequence !== 1
        || current.value.status !== configuration.next.status
        || current.value.candidateDigest !== configuration.next.candidateDigest
        || current.value.outcomeCode !== configuration.next.outcomeCode) {
        throw new Error("fresh continuation does not match requested successor");
      }
      result = current;
    }
    process.send?.({
      type: "result",
      result: { digest: result.digest, value: result.value },
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
