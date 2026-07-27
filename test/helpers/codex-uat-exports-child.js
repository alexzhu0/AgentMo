import * as codexUatModule from "../../src/builder-codex-uat.js";

const forbidden = [
  "appendCodexUatAttemptEntry",
  "inspectCodexUatCandidateForHumanDecision",
  "decideCodexUatCandidate",
];

process.stdout.write(JSON.stringify({
  forbidden: forbidden.filter((name) => Object.hasOwn(codexUatModule, name)),
  atomicVerifier: typeof codexUatModule.verifyCodexUatCandidateDecision,
}));
