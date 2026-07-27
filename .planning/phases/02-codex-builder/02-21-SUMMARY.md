---
phase: 02-codex-builder
plan: "21"
subsystem: immutable-journal-recovery
tags: [codex, checkpoint, immutable-journal, recovery, retained-inodes, durable-commit]

requires:
  - phase: 02-codex-builder
    plan: "20"
    provides: Receipt-last project transaction recovery and retained project publication authority
provides:
  - Closed immutable-journal append outcomes for rejected-before-commit, committed-clean, and committed-recovery-required
  - Identity-bound lock/stage recovery records and restart-safe exact-head loading
  - Private retained retirement that never pathname-unlinks a final-window competitor
  - Checkpoint, hook, and UAT caller handling that never retries a committed transition
affects: [codex-builder, checkpoint, installed-hooks, codex-uat, phase-02-verification, plan-02-23-inventory]

tech-stack:
  added: []
  patterns:
    - Publish and sync the exact successor before minting a committed result
    - Bind recovery to operation, journal, predecessor, publication, stage, lock, and retained inode identities
    - Retire namespace entries by exact rename into a private retained directory without pathname unlink

key-files:
  created:
    - .planning/phases/02-codex-builder/02-21-SUMMARY.md
  modified:
    - src/builder-immutable-journal.js
    - src/builder-checkpoint.js
    - src/builder-codex-uat.js
    - src/builder-hook-bridge.js
    - test/builder-checkpoint.test.js
    - test/builder-hook.test.js
    - test/builder-hook-bridge.test.js
    - test/builder-codex-uat.test.js

key-decisions:
  - "A returned rejection means zero durable successor and an exact loadable prior head; no post-commit condition is mapped to an ordinary conflict."
  - "Operation-owned and ambiguous cleanup entries are atomically retired into a current-user private retained directory and are not pathname-unlinked there."
  - "Checkpoint and UAT callers consume the structured append result; hook replay is decided from the reloaded committed checkpoint rather than retrying delivery."
  - "Canonical inventory reconciliation remains exclusively owned by Plan 02-23."

patterns-established:
  - "Durable append result: rejected-before-commit | committed-clean | committed-recovery-required."
  - "Recovery loader accepts only canonical lock bytes bound to the exact journal key, transition, intended publication, and inode identities."
  - "Retained hardlinks are included in exact publication nlink admission; unrelated external hardlinks still fail closed."

requirements-completed: [BLDR-04]

coverage:
  - id: CR-07
    description: "Journal stage and lock cleanup preserve final-window replacements and never delete a foreign inode."
    requirement: BLDR-04
    verification:
      - kind: integration
        ref: "test/builder-checkpoint.test.js#preserves final-window stage and lock competitors without duplicating a committed successor"
        status: pass
      - kind: integration
        ref: "test/builder-checkpoint.test.js#rejects an attacker recovery lock after restart without changing its bytes or inode"
        status: pass
    human_judgment: false
  - id: CR-08
    description: "Every append outcome identifies a reloadable old or new head, including post-commit cleanup failure."
    requirement: BLDR-04
    verification:
      - kind: integration
        ref: "test/builder-checkpoint.test.js#returns an explicit committed recovery outcome after post-commit cleanup failure"
        status: pass
      - kind: integration
        ref: "test/builder-checkpoint.test.js#returns rejected-before-commit only while the exact prior head remains loadable"
        status: pass
    human_judgment: false
  - id: CALLERS
    description: "Checkpoint, hook, and UAT callers reload the exact committed head and never duplicate a committed transition after a cleanup warning."
    requirement: BLDR-07
    verification:
      - kind: integration
        ref: "test/builder-hook.test.js#does not retry a hook event after a committed checkpoint cleanup warning"
        status: pass
      - kind: integration
        ref: "test/builder-codex-uat.test.js#resumes the exact committed UAT head after cleanup failure and rejects stale retry"
        status: pass
    human_judgment: false

duration: 44min
completed: 2026-07-21
status: complete
---

# Phase 02 Plan 21: Durable Immutable-Journal Recovery Summary

**Immutable checkpoint and UAT journals now return unambiguous durable outcomes, reload exact committed heads through cleanup failures, and preserve every final-window competitor in private retained evidence.**

## Performance

- **Recovery executor started:** approximately 2026-07-21T07:54:00Z
- **Completed:** 2026-07-21T08:38:00Z
- **Duration:** approximately 44 minutes for recovery audit, closure, and verification; time used by the interrupted executor is unavailable
- **Tasks:** 2/2 complete
- **Files changed in plan scope:** 8 implementation/test files plus this summary
- **Commits:** none — explicitly prohibited by the execution contract
- **Planning state:** intentionally unchanged

## Recovery Execution Fact

The original Plan 02-21 executor was safely interrupted after exceeding the orchestration stall threshold. It had already written a substantial Task 1/Task 2 implementation but created no summary, performed no git operation, and returned no completion state. This recovery executor read the plan and required Phase 02 context, audited every plan-owned source/test path, preserved the correct implementation, ran the initial focused gate at 46/46, closed one remaining retained-cleanup race, added one missing attacker-recovery regression, and completed the plan at 47/47 focused tests.

## Accomplishments

- Closed CR-08 with a three-state append contract: `rejected-before-commit` returns the exact prior head with `committed:false`; `committed-clean` and `committed-recovery-required` return the exact durable successor with `committed:true`.
- Closed CR-07 by binding the lock record to operation id, journal key, sequence, predecessor, value/publication digests, publication name, and stage/lock inode identities, while retaining parent and file handles through final effects.
- Replaced validate-then-unlink cleanup with exact rename into `.agentmo-journal-retained`-style private evidence. Neither operation-owned tombstones nor ambiguous competitors are pathname-unlinked after retirement.
- Made restart loading admit coherent operation-owned recovery state, include retained inode links in exact publication admission, and reject malformed attacker lock/stage state without modifying its bytes or inode.
- Migrated the two direct append callers (`builder-checkpoint` and `builder-codex-uat`) to the same structured result and exact-head reload invariant. Installed hook delivery inherits the contract through `writeBuilderCheckpoint`; replay of an already committed event is a durable duplicate no-op.

## Task Outcomes and Commits

No commits were created. Staging, committing, pushing, tagging, stashing, branch switching, and planning-state updates were prohibited.

1. **Task 1: Reproduce journal cleanup and post-commit ambiguity** — complete. Deterministic stage/lock final-effect, pre-commit rejection, post-commit recovery, attacker-remainder, hook no-retry, and UAT stale-retry regressions pass; commit: none.
2. **Task 2: Implement durable append recovery and migrate callers** — complete. Structured outcomes, canonical recovery bytes, retained inode admission/retirement, restart recovery, and direct/transitive caller handling pass; commit: none.

## Durable Append and Recovery Contract

| Outcome | Durable mutation | Returned authority | Reload invariant |
| --- | --- | --- | --- |
| `rejected-before-commit` | No successor remains canonical | Exact prior head, possibly with a coherent recovery remainder | Prior head is loadable and retry requires its exact admission |
| `committed-clean` | Exact successor published and parent synced | Exact successor head | New head reloads with no active recovery record |
| `committed-recovery-required` | Exact successor published and parent synced | Exact successor head plus `recoveryRequired:true` | New head reloads; the next exact append retires coherent remainder before CAS |

The durable point is reached only after the exact publication is linked, both stage/publication bindings are rechecked, the retained parent is synced and revalidated, and the successor is reloaded as the unique head. Once that point is recorded in memory, later cleanup or sync failure returns committed recovery rather than an ordinary conflict.

The canonical recovery record is `agentmo.immutable-journal-recovery.v1`. It binds `operationId`, `journalKey`, `sequence`, `predecessorDigest`, `valueDigest`, `publicationDigest`, `publicationName`, the exact staged publication identity, and the exact lock identity. Loader admission is strict-key and canonical-byte exact. Invalid lock/stage bytes are only rejected; read paths never repair, delete, or reinterpret them.

## Caller Migration

- `src/builder-checkpoint.js` maps a committed append head directly into a checkpoint admission and exposes `appendStatus` plus `recoveryRequired`. A rejected append maps to the existing bounded checkpoint conflict and cannot masquerade as zero-write after commit.
- `src/builder-codex-uat.js` accepts only a committed result, reloads the journal, and requires the reloaded digest, entry count, and derived phase to match the returned successor before exposing the transition. A stale retry is rejected against the advanced head.
- `src/builder-hook-bridge.js` reaches the journal only through `writeBuilderCheckpoint`. Once that write returns committed recovery, restart reloads the event ledger and the same hook event reduces to `duplicate` without a second append.
- Repository-wide inspection finds no other production call to `appendImmutableJournalEntry`.

## Exact I/O and Identity Handoff for Plan 02-23

Plan 02-23 remains the single owner of canonical inventory reconciliation. Plan 02-21 intentionally did not edit `test/helpers/io-surface-inventory.js` or `test/artifact-surface-coverage.test.js`.

`src/builder-immutable-journal.js` currently contributes 43 scanner rows: 5 filesystem lifecycle, 7 filesystem open, 17 filesystem read, 5 file-handle lifecycle, 8 file-handle read, and 1 file-handle write. Exact current rows are:

```text
src/builder-immutable-journal.js:57:filesystem-lifecycle:fs.mkdir
src/builder-immutable-journal.js:127:file-handle-lifecycle:FileHandle.sync
src/builder-immutable-journal.js:142:file-handle-lifecycle:FileHandle.sync
src/builder-immutable-journal.js:167:filesystem-lifecycle:fs.link
src/builder-immutable-journal.js:188:file-handle-lifecycle:FileHandle.sync
src/builder-immutable-journal.js:245:file-handle-lifecycle:FileHandle.sync
src/builder-immutable-journal.js:397:filesystem-read:fs.lstat
src/builder-immutable-journal.js:399:filesystem-open:fs.open
src/builder-immutable-journal.js:403:file-handle-read:FileHandle.stat
src/builder-immutable-journal.js:404:filesystem-read:fs.lstat
src/builder-immutable-journal.js:408:file-handle-lifecycle:FileHandle.sync
src/builder-immutable-journal.js:426:filesystem-lifecycle:fs.mkdir
src/builder-immutable-journal.js:431:filesystem-read:fs.lstat
src/builder-immutable-journal.js:433:filesystem-open:fs.open
src/builder-immutable-journal.js:437:file-handle-read:FileHandle.stat
src/builder-immutable-journal.js:438:filesystem-read:fs.lstat
src/builder-immutable-journal.js:457:file-handle-read:FileHandle.stat
src/builder-immutable-journal.js:458:filesystem-read:fs.lstat
src/builder-immutable-journal.js:470:file-handle-read:FileHandle.stat
src/builder-immutable-journal.js:471:filesystem-read:fs.lstat
src/builder-immutable-journal.js:483:filesystem-read:fs.readdir
src/builder-immutable-journal.js:570:filesystem-read:fs.lstat
src/builder-immutable-journal.js:572:filesystem-open:fs.open
src/builder-immutable-journal.js:576:file-handle-read:FileHandle.stat
src/builder-immutable-journal.js:577:filesystem-read:fs.readdir
src/builder-immutable-journal.js:582:filesystem-read:fs.lstat
src/builder-immutable-journal.js:585:filesystem-read:fs.lstat
src/builder-immutable-journal.js:668:filesystem-read:fs.lstat
src/builder-immutable-journal.js:758:filesystem-open:fs.open
src/builder-immutable-journal.js:774:filesystem-open:fs.open
src/builder-immutable-journal.js:837:filesystem-lifecycle:fs.rename
src/builder-immutable-journal.js:838:filesystem-read:fs.lstat
src/builder-immutable-journal.js:842:file-handle-read:FileHandle.stat
src/builder-immutable-journal.js:853:filesystem-read:fs.lstat
src/builder-immutable-journal.js:858:filesystem-lifecycle:fs.rename
src/builder-immutable-journal.js:859:filesystem-read:fs.lstat
src/builder-immutable-journal.js:1040:filesystem-open:fs.open
src/builder-immutable-journal.js:1058:filesystem-open:fs.open
src/builder-immutable-journal.js:1064:file-handle-read:FileHandle.read
src/builder-immutable-journal.js:1082:file-handle:FileHandle.write
src/builder-immutable-journal.js:1090:file-handle-read:FileHandle.stat
src/builder-immutable-journal.js:1091:filesystem-read:fs.lstat
src/builder-immutable-journal.js:1107:filesystem-read:fs.lstat
```

The prior canonical Plan 02-11 snapshot had 22 rows. Its pathname cleanup row `src/builder-immutable-journal.js:560:filesystem-lifecycle:fs.unlink` is intentionally removed. New semantic surfaces are the lock recovery write/sync, retained-directory creation/admission, retained-remainder enumeration, recovery stage/lock opens, and identity-preserving renames. Existing publication, parent, file-read, and exact-write rows moved with the implementation.

The other three production files add no new Plan 02-21 static I/O callee: checkpoint and hook bridge delegate to the journal writer/loader; UAT continues to carry the ten exact leaf I/O rows already recorded in `02-18-SUMMARY.md`, now at lines 1468, 1472, 1479, 1502-1504, 1511-1512, 1611, and 1621. Plan 02-23 must reconcile this summary together with the exact Plan 02-18 through 02-20 handoffs.

## Decisions Made

- Kept one immutable chain as the recovery authority; no mutable head pointer or second repair journal was introduced.
- Kept cleanup failure observable through the append result while making the durable successor authoritative, so callers never infer zero mutation from a post-commit condition.
- Preserved retired entries as bounded private tombstones. This avoids any final pathname unlink race and lets the loader account for the exact additional hardlink without accepting an unrelated external hardlink.
- Kept real Codex UAT, private locator access, network activity, GitHub, and human admission outside this mechanism-only plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed the retained-directory pathname unlink race**

- **Found during:** Recovery audit after the interrupted executor.
- **Issue:** The recovered implementation correctly renamed stage/lock entries into a private retained directory but then unlinked the retained pathname. A final-window replacement of that pathname could still delete a foreign inode.
- **Fix:** Retirement now ends after exact retained rename and retained-handle identity verification. Loader admission counts exact retained hardlinks when validating a publication; the old journal cleanup `fs.unlink` surface is gone.
- **Files modified:** `src/builder-immutable-journal.js`, `test/builder-checkpoint.test.js`.
- **Verification:** Focused 47/47; full repository has no new failure; attacker recovery lock bytes/inode remain unchanged.
- **Commit:** none by execution contract.

**2. [Rule 2 - Missing critical coverage] Added restart rejection for attacker recovery bytes**

- **Found during:** Recovery audit of Task 1 acceptance.
- **Issue:** Coherent owned recovery was covered, but there was no direct assertion that an attacker lock survives a restart loader rejection byte-for-byte and inode-for-inode.
- **Fix:** Added a deterministic invalid recovery-lock regression with pre/post inode and byte equality.
- **Files modified:** `test/builder-checkpoint.test.js`.
- **Verification:** Named regression passes in both focused and full runs.
- **Commit:** none by execution contract.

**Total deviations:** 2 auto-fixed (1 Rule 1, 1 Rule 2). Both close the plan's stated critical foreign-inode and restart-ambiguity requirements without expanding the architecture.

## Issues Encountered

- The recovery executor inherited correct but unreported partial implementation from the interrupted executor. It audited behavior from disk rather than restarting the plan or reverting correct work.
- The first retained-tombstone refinement made publication `nlink` greater than one and correctly tripped the existing hardlink admission. Loader admission was then extended to count only matching inode links inside the retained private directory; focused tests returned to green before the full gate.

## Deferred Issues

- `npm run check` passes all JavaScript syntax gates and 682/684 tests across 71 suites. Exactly two tests fail: the whole-repository artifact/output inventory snapshot and the Wave 16/17 closure snapshot.
- Those are the same two planned Plan 02-23 snapshot failures present before Plan 02-21. This plan adds the exact 43-row journal handoff above and does not edit the inventory early.

## Authentication Gates

None. No `.env` content, credential source, real Codex process, private locator, network request, GitHub operation, or actual UAT was used.

## Known Stubs

None. No TODO, FIXME, placeholder, coming-soon, or goal-blocking empty data path exists in the plan-owned implementation.

## Verification

- Initial recovery baseline: `node --test test/builder-checkpoint.test.js test/builder-hook.test.js test/builder-hook-bridge.test.js test/builder-codex-uat.test.js` — 46/46 pass before the recovery executor's final hardening.
- Final focused gate: same command — 47/47 pass; 4 suites; 0 failed, cancelled, skipped, or todo.
- `npm run check` — syntax pass; 682/684 tests pass across 71 suites; exactly the two expected Plan 02-23 inventory snapshots fail; 0 cancelled, skipped, or todo.
- Independent compact full rerun: 684 tests, 682 pass, 2 expected inventory failures, 71 suites, 0 cancelled/skipped/todo.
- `git diff --check` — pass.
- Production caller search — exactly two direct `appendImmutableJournalEntry` callers: checkpoint and Codex UAT.
- Static I/O scan — 43 current journal rows; no unclassified Plan 02-21 side surface beyond the intentionally stale canonical snapshot.

## Certification Boundary

This plan proves deterministic immutable-journal publication, recovery, and caller no-retry mechanics only. It does not prove cryptographic Codex origin, real host activation, real-session behavior, Agent Package quality, domain quality, production readiness, deployment approval, or wider Codex/OpenClaw compatibility. BLDR-07 real human-observation evidence therefore remains outside `requirements-completed` even though its journal/caller prerequisite is closed.

## User Setup Required

None.

## Next Phase Readiness

CR-07 and CR-08 are closed. Plan 02-23 has the exact journal I/O, recovery-schema, durable-identity, and caller-edge inventory needed for the single canonical reconciliation. A future real UAT remains separately gated and was not attempted.

## Self-Check: PASSED

- All eight plan-owned implementation/test files and this summary exist.
- The three result statuses, recovery schema, retained-directory loader, final-effect seams, checkpoint/UAT result consumers, and hook/UAT no-retry regressions are present.
- Focused verification is 47/47; repository-wide verification has only the two explicitly deferred Plan 02-23 snapshots.
- No ROADMAP, STATE, REQUIREMENTS, `.env`, real host/UAT state, private locator, network, GitHub, or inventory snapshot was changed by this recovery executor.
- Commit lookup is not applicable: commits were prohibited and none were created.

---
*Phase: 02-codex-builder*
*Completed: 2026-07-21*
