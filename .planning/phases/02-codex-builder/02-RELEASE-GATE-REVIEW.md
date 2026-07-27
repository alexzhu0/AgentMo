# Phase 02 Release-Gate Review

**Reviewed:** 2026-07-24T19:22:46Z
**Verdict:** BLOCK

## Files reviewed

- `AGENTS.md`
- `.planning/phases/02-codex-builder/02-18-PLAN.md`
- `.planning/phases/02-codex-builder/02-REVIEW.md`
- `.planning/phases/02-codex-builder/02-POST-FIX-REVIEW.md`
- `.planning/phases/02-codex-builder/02-FINAL-REVIEW.md`
- `package.json`
- `src/builder-immutable-journal.js`
- `src/builder-codex-uat.js`
- `src/builder-codex-host.js`
- `test/builder-immutable-journal-v1.test.js`
- `test/builder-codex-uat.test.js`
- `test/builder-codex-host.test.js`
- `test/codex-builder-behavior.test.js`
- `test/builder-codex-uat-prior-attempt.test.js`
- `test/helpers/io-surface-inventory.js`
- `test/artifact-surface-coverage.test.js` (targeted static-closure verification)

## Critical findings

### CR-01 — A packaged UAT copy can mint authority for another UAT lineage

**Classification:** BLOCKER
**Files:** `src/builder-codex-uat.js:66-67,166-176,317-340,1212-1249`; `src/builder-immutable-journal.js:350-377`; `package.json:39,44`; `test/builder-codex-uat.test.js:246-335,659-711,1340-1362`

**Issue:** The supposed canonical capability is local to whichever copy of
`builder-codex-uat.js` is imported. For a packed `file:` import,
`new URL("./builder-codex-uat.js", import.meta.url)` equals that packed copy's
own URL, so it self-identifies as canonical and creates a fresh private token.
Its packaged `builder-immutable-journal.js` dynamically imports that same
sibling and accepts the fresh token. The public packed UAT module can therefore
load an existing journal, mint a valid head admission in its own WeakMap, and
append a valid canonical successor to a lineage created by the repository copy.

**Evidence:** In an isolated temporary release fixture, the repository module
created a valid `started` journal. A direct `file:` import of the extracted
successor package's `src/builder-codex-uat.js` then loaded that journal and
called its public `terminateCodexUatAttempt`. The packed result was `failed`;
the repository module reloaded the same journal as `failed` with two entries.
This is an irreversible terminal mutation without the authority intended to
own the original lineage. The current regressions only import the packed
generic journal, so they do not exercise its packaged UAT sibling.

**Impact:** A packed file importer can independently establish an append
capability and irreversibly terminate an otherwise live canonical UAT attempt.
That defeats the claimed canonical-lineage/capability boundary and makes a
same-user local package copy an authority forgery and denial-of-service path.

**Fix:** Bind UAT mutation authority to the specific lineage's trusted owner,
not to a per-module-copy object or a sibling-relative dynamic import. A packed
UAT copy must not be able to create a new accepted capability for a journal it
does not own. Add a regression that starts a journal through one module copy,
imports the packed sibling UAT module by `file:`, and proves its `start`,
`terminate`, and other successor operations leave the original journal bytes
unchanged.

## Other release-gate checks

- The narrowed generic importer rejects raw UAT genesis, generic successors,
  and full synthetic histories; the targeted four-test UAT authority group
  passed. The cross-copy path above remains outside those tests.
- The focused host suite passed all 21 tests, including both escaped stdout
  holder modes and the short-lived post-exit JSON spoof. Direct pre-exit output
  remains covered by the normal observation cases.
- The prior-attempt fixture constructs its two-entry terminal only through the
  canonical `startCodexUatAttempt` and `terminateCodexUatAttempt` path; its
  targeted preflight test passed. No separate fixture bypass was found.
- `test/artifact-surface-coverage.test.js` passed all 17 tests; no package or
  static I/O-closure weakening was found in this review.

**Targeted checks run:**

- `node --test test/builder-codex-host.test.js` — 21 passed
- `node --test test/artifact-surface-coverage.test.js` — 17 passed
- `node --test --test-name-pattern='keeps raw append authority|delegates query-suffixed UAT mutations|packed file-URL generic successor|full synthetic real-pair history' test/builder-codex-uat.test.js` — 4 passed
- `node --test --test-name-pattern='preflights an exact synthetic two-entry terminal' test/builder-codex-uat-prior-attempt.test.js` — 1 passed

critical: 1
warning: 0
verdict: BLOCK
