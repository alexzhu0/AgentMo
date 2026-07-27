---
phase: 02-codex-builder
reviewed: 2026-07-24T18:56:04Z
depth: deep
files_reviewed: 13
files_reviewed_list:
  - AGENTS.md
  - .planning/phases/02-codex-builder/02-18-PLAN.md
  - .planning/phases/02-codex-builder/02-REVIEW.md
  - .planning/phases/02-codex-builder/02-POST-FIX-REVIEW.md
  - src/builder-immutable-journal.js
  - src/builder-codex-uat.js
  - src/builder-codex-host.js
  - test/builder-immutable-journal-v1.test.js
  - test/builder-codex-uat.test.js
  - test/builder-codex-host.test.js
  - test/codex-builder-behavior.test.js
  - test/builder-codex-uat-prior-attempt.test.js
  - test/helpers/io-surface-inventory.js
findings:
  critical: 0
  warning: 1
  info: 0
  total: 1
status: issues_found
---

# Phase 02: Final Code Review Report

**Reviewed:** 2026-07-24T18:56:04Z
**Depth:** deep
**Files Reviewed:** 13
**Status:** issues_found

## Summary

Independent deep review found no Critical issue, but the zero-Warning acceptance gate is not met. The UAT journal authority boundary, generic-successor rejection, query-facade delegation, prior-attempt fixture, and package import/I/O closure were reviewed. A short-lived escaped descendant can still supply accepted host-command stdout after the direct command process exits.

The review did not read `.env`, modify source or tests, run a full suite, or certify a real Codex/OpenClaw session.

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: A short-lived escaped stdout descendant can be accepted as a direct host-command result

**Classification:** WARNING
**File:** `src/builder-codex-host.js:1862-1888`

**Issue:** `runBoundedHostCommand()` gives a clean direct-child exit a 250 ms grace period. If the inherited stdout pipe subsequently closes while the escaped process group is dead, the `close` handler proceeds to `waitForGroupReap()` and returns the accumulated stdout as a successful command response. It does not establish that those bytes came from the direct child.

A temporary PATH-shadow reproduction made the direct `codex` process exit `0` with no stdout, then used a detached, inherited-stdout grandchild to emit syntactically valid marketplace JSON and exit within the grace period. `observeCodexHost()` returned `availability: "observed"`, `registration: "registered"`, and `sourceMatch: true`. This violates the required fail-closed behavior for escaped stdout holders. Existing regressions at `test/builder-codex-host.test.js:703-813` and `test/codex-builder-behavior.test.js:1041-1076` cover descendants that keep the pipe open, not a descendant that writes and exits before grace expiry.

**Fix:** Restrict the repair to the host-command supervisor and its tests. Treat direct-child exit as an irrevocable provenance boundary: do not turn a later pipe close into a successful response merely because process-group cleanup reports dead. Use an explicit direct-process completion/provenance handoff for accepted responses (or conservatively fail closed when direct exit leaves response provenance ambiguous); retain the bounded cleanup only for teardown. Add a regression where the direct process writes nothing, a detached inherited-stdout child writes valid JSON and exits promptly, and the command is reported unavailable/failed rather than observed.

## Evidence

- `node --test --test-name-pattern='bounds an escaped stdout-holding PATH-shadow command' test/builder-codex-host.test.js` — passed (the existing long-lived-holder case).
- `node --test --test-name-pattern='packed file-URL generic successor|full synthetic real-pair history|query-suffixed UAT mutations' test/builder-codex-uat.test.js` — passed (3 tests).
- `node --test --test-name-pattern='rejects a UAT append capability on a non-UAT generic entry' test/builder-immutable-journal-v1.test.js` — passed.
- `node --test --test-name-pattern='walks the hook import, I/O, and adjacent-launcher closure' test/builder-package-security.test.js` — passed.

The checks above establish bounded mechanism behavior only; they do not certify domain quality, production readiness, or wider OpenClaw compatibility.

---

_Reviewed: 2026-07-24T18:56:04Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: deep_
