---
phase: 02-codex-builder
reviewed: 2026-07-24
depth: deep
files_reviewed:
  - AGENTS.md
  - .planning/phases/02-codex-builder/02-CONTEXT.md
  - .planning/phases/02-codex-builder/02-VERIFICATION.md
  - .planning/phases/02-codex-builder/02-18-PLAN.md
  - .planning/phases/02-codex-builder/02-18-SUMMARY.md
  - docs/MVP_RUNBOOK.md
  - docs/AGENT_BIRTH_GATE.md
  - package.json
  - plugin/hooks/agentmo-hook.js
  - src/builder-append-only-authority.js
  - src/builder-behavior-eval.js
  - src/builder-checkpoint.js
  - src/builder-codex-host.js
  - src/builder-codex-uat-continuation.js
  - src/builder-codex-uat-private-authority.js
  - src/builder-codex-uat.js
  - src/builder-hook-bridge.js
  - src/builder-immutable-journal.js
  - src/builder-install.js
  - src/builder-lifecycle.js
  - src/builder-package.js
  - src/builder-platform.js
  - src/builder-posix-effect.js
  - src/builder-probe.js
  - src/cli.js
  - scripts/build-builder-uat-releases.js
  - scripts/verify-codex-uat-candidate.js
  - test/builder-codex-host.test.js
  - test/builder-codex-uat.test.js
  - test/builder-package-security.test.js
  - test/codex-builder-behavior.test.js
  - test/codex-builder-probe.test.js
findings:
  critical: 1
  warning: 1
  info: 0
  total: 2
status: issues_found
---

# Phase 02 Code Review

## Summary

This fresh deep review found one closed-authority bypass and one bounded-execution failure. I inspected the packed-file inventory, UAT journal/verifier path, host command supervision, and their focused tests. The only dynamic check run was the packed hook-import/I/O/adjacent-launcher closure test in `test/builder-package-security.test.js`, which passed. I did not read `.env`, run a real Codex session, or modify source, tests, docs, release records, or git state.

## Findings

### CR-01 — Packed generic journal API bypasses the closed UAT transition authority

**Severity:** Critical

**Locations:** `package.json:9-44`; `src/builder-immutable-journal.js:88-100,312-337`; `src/builder-codex-uat.js:315-356,698-798,1231-1292,1480-1541`; `test/builder-codex-uat.test.js:48-50,1234-1264`; `test/codex-builder-behavior.test.js:643-662,685-764`.

**Call chain:** The package ships `src/builder-immutable-journal.js` (`package.json:44`). Although the package export map prevents a normal package subpath import, a same-user project-local runner can file-URL import that installed source. Its exported `appendImmutableJournalEntry()` accepts caller-chosen canonical bytes and only requires the generic predecessor admission returned by its own public loader. `loadCodexUatAttemptJournal()` then parses those bytes, applies only UAT grammar/order transitions, and mints an opaque UAT head. `verifyCodexUatCandidateDecision()` rechecks the real release pair and candidate/journal structural binding, but does not reload or re-admit the receipt, host observation, checkpoint, trust/auth, or scenario evidence whose digests appear in the raw entries.

**Reproduction:** Build or retain a valid release pair. From a project-local runner, file-URL import the packed generic journal module and append a canonical 16-entry UAT history: `attempt-started`, setup, activation, trust/auth, the eleven ordered scenarios, and `candidate-ready`. Bind the first entry and candidate to the real release pair, but use arbitrary syntactically valid SHA-256 literals for every claimed evidence digest. Write a canonical candidate whose ordered-evidence digest matches the forged entries. Reloading the journal mints a valid UAT head; passing that head, candidate, and the genuine successor package/tarball to `verifyCodexUatCandidateDecision()` returns an `eligible` preview without any referenced evidence existing. The repository already demonstrates both primitives: it constructs whole raw histories with this appender (`test/builder-codex-uat.test.js:1234-1246`) and directly appends a raw `candidate-ready` entry (`test/codex-builder-behavior.test.js:643-662`). The existing negative case changes the release pair, so it does not exercise an otherwise valid pair with invented evidence.

**Impact:** This violates D-29 and the explicit Plan 02-18 acceptance claim that synthetic raw setup/activation/scenario details cannot reach `candidate-ready`. It does not manufacture an external human decision or prove real host/session quality, but it does allow a fake UAT attempt to obtain the verifier's `eligible` result and a caller-reported approval/rejection wrapper, defeating the closed formal-evidence chain that is meant to precede those outputs.

**Fix:** Prevent raw generic append authority from being used for UAT journal locations, rather than merely omitting it from the UAT module namespace. Make the generic engine private to a narrowly typed UAT transition capability, or require an unforgeable module-private UAT transition authority for every UAT append (including genesis and `candidate-ready`). The verifier must either re-admit every referenced evidence artifact or rely on an opaque evidence-derived head only the closed transition implementation can issue. Add a packed child-process regression that file-URL imports the actual shipped generic module, attempts the complete real-pair forged history, and proves it cannot reach either `candidate-ready` or `eligible`.

### CR-02 — Escaped stdout holders can make host observation wait indefinitely

**Severity:** Warning

**Locations:** `src/builder-codex-host.js:1774-1876,1934-1951,2010-2090`; `test/builder-codex-host.test.js:83-96,590-629`.

**Call chain:** `runBoundedHostCommand()` starts a PATH-selected command in a detached process group. When its direct child exits successfully, it clears the absolute timeout (`1833-1848`). If the child has already spawned a `setsid`/detached descendant that retains inherited stdout, the original process group is dead but Node's `close` event cannot arrive while the escaped descendant owns the pipe. After the short clean-exit grace, the code marks the operation terminal and calls `requestShutdown()`, but `createIsolatedProcessGroup()` returns immediately for the now-dead original group and only destroys stdout on the non-dead force-kill branch (`2017-2070`). There is then neither a pipe close nor a final settlement timer; settlement remains reachable only through the unavailable `close` handler. `runAppServer()` has the same early-timeout-clear-on-direct-exit pattern (`1934-1951`).

**Impact:** A PATH-shadowed `codex` command can deny service to host observation and any install/behavior path waiting on it, despite the declared five-second bound. No elevated authority is gained, but a local executable can cause an unbounded CLI/host operation merely by escaping the original process group while retaining stdout.

**Fix:** Keep an absolute settlement deadline independent of direct-child exit, and on every terminal path close/destroy the parent pipe ends before resolving failure. Do not make settlement depend on group liveness once a descendant can leave that group. Add host regressions in which the fake command and fake app-server spawn a detached/`setsid` stdout-inheriting descendant, exit 0, and verify an unavailable observation returns within the configured bound without accepting descendant output. The current daemon test (`test/builder-codex-host.test.js:83-96,590-629`) covers only a descendant that remains in the original group, so it does not cover this case.
