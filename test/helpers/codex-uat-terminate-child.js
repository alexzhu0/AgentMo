import {
  loadCodexUatAttemptJournal,
  terminateCodexUatAttempt,
} from "../../src/builder-codex-uat.js";

async function main() {
  const request = JSON.parse(process.argv[2]);
  try {
    const current = await loadCodexUatAttemptJournal(request.journalPath);
    const result = await terminateCodexUatAttempt({
      journalPath: request.journalPath,
      expectedHeadAdmission: current.head,
      kind: request.kind,
      code: request.code,
      evidencePath: request.evidencePath,
      expectedEvidenceDigest: request.expectedEvidenceDigest,
    });
    process.send?.({ type: "result", phase: result.state.phase });
  } catch (error) {
    process.send?.({
      type: "error",
      error: {
        name: error?.name,
        code: error?.code,
      },
    });
    process.exitCode = 1;
  }
}

if (process.argv[2] !== undefined) {
  await main();
}
