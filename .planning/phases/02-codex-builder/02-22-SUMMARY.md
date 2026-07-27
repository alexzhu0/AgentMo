---
phase: 02-codex-builder
plan: "22"
subsystem: codex-uat-leaf-publication
tags: [codex, uat, content-addressed-leaves, retained-authority, durable-publication]

requires:
  - phase: 02-codex-builder
    plan: "21"
    provides: Durable immutable-journal outcomes and identity-bound cleanup recovery
provides:
  - Retained-parent staged publication for candidate and observation leaves
  - Exact absent-only inode publication with parent sync and bounded rollback
  - Packed continuation and installed-hook authority handoff across mutable operations
  - Fresh-process and hostile competitor regressions for WR-01
affects: [codex-builder, codex-uat, installed-hooks, packed-continuation, plan-02-23-inventory]

tech-stack:
  added: []
  patterns:
    - Random exclusive stage, exact inode validation, absent-only hard-link, retained-parent sync, exact cleanup
    - WeakSet-branded directory authority retained by callers across checkpoint or uninstall effects
    - Leaf publication remains non-authoritative until a later journal transition references its exact digest

key-files:
  created:
    - .planning/phases/02-codex-builder/02-22-SUMMARY.md
  modified:
    - src/builder-codex-uat.js
    - src/builder-codex-uat-continuation.js
    - src/builder-hook-bridge.js
    - test/builder-codex-uat.test.js
    - test/builder-packed-install.test.js
    - test/builder-hook-bridge.test.js

key-decisions:
  - "A digest-named leaf is never opened for writing: exact bytes are synced in a random exclusive stage and published only by an absent-only hard-link."
  - "A caller-provided retained authority is accepted only when it was minted by this module and still names the exact safe directory inode."
  - "Final-name competitors and ambiguous cleanup replacements are preserved; only an exact operation-owned inode is unlinked."
  - "Candidate and observation values remain acyclic false-claim leaves; only candidate-ready or scenario-observed journal entries grant later authority."
  - "Canonical inventory reconciliation remains exclusively owned by Plan 02-23."

patterns-established:
  - "Leaf publication: retain parent -> stage/write/sync -> exact link -> parent sync -> exact stage retire -> parent sync -> reload."
  - "Caller lifetime: acquire authority before journal/lifecycle mutation, await the whole operation, then close it in finally."

requirements-completed: [BLDR-04]

coverage:
  - id: WR-01
    description: "Candidate and observation leaves cannot expose partial digest-named finals and reject parent or final-name replacement without journal promotion."
    requirement: BLDR-04
    verification:
      - kind: integration
        ref: "test/builder-codex-uat.test.js#never exposes a partial observation final and preserves a final-name competitor"
        status: pass
      - kind: integration
        ref: "test/builder-codex-uat.test.js#rejects replaced retained parents and retries an operation-owned candidate stage cleanly"
        status: pass
    human_judgment: false
  - id: PACKED-AUTHORITY
    description: "Packed continuation and installed-hook leaf publication use retained authority and preserve false-claim evidence semantics across fresh processes."
    requirement: BLDR-07
    verification:
      - kind: integration
        ref: "test/builder-packed-install.test.js#crosses final uninstall only through an ephemeral synthetic packed continuation"
        status: pass
      - kind: integration
        ref: "test/builder-hook-bridge.test.js#keeps direct or installed inputs as false-claim leaves and admits them only through later head CAS"
        status: pass
    human_judgment: false

duration: 47min
completed: 2026-07-21
status: complete
---

# Phase 02 Plan 22: Retained-Authority UAT Leaf Publication Summary

**Candidate and observation leaves now publish exact staged bytes through retained directory authority, survive interruption and competition without partial final names, and remain non-authoritative until the immutable UAT journal references them.**

## Performance

- **Started:** approximately 2026-07-21T08:18:00Z
- **Completed:** 2026-07-21T09:05:13Z
- **Duration:** approximately 47 minutes
- **Tasks:** 2/2 complete
- **Files changed in plan scope:** 6 implementation/test files plus this summary
- **Commits:** none — git staging, commit, push, tag, stash, and branch operations were prohibited
- **Planning state:** ROADMAP, STATE, REQUIREMENTS, and the 02-23 inventories were intentionally unchanged

## Accomplishments

- Replaced direct final-path writes with a random `O_EXCL | O_NOFOLLOW` stage, exact full write, stage sync, inode/path revalidation, absent-only hard-link to the digest name, retained-parent sync, exact stage retirement, a second parent sync, and exact canonical reload.
- Added current-user ownership, non-group/world-writable mode, no-follow directory open, retained-handle identity, and exact path identity checks before every publication boundary. Parent drift rejects before authority can widen to a replacement directory.
- Made rollback remove only paths still bound to the operation-owned open inode. A final-name race, stage cleanup replacement, or parent replacement preserves competitor bytes and produces a bounded rejection.
- Passed retained candidate and observation directory authority through the packed uninstall continuation. Recovery uses the retained candidate authority; the fresh path keeps both handles live until the entire async continuation settles.
- Retained the installed hook observation directory before checkpoint publication and held it through observation publication, preventing a checkpoint-side operation from silently widening the later leaf path.
- Preserved D-29/D-31 false-claim semantics: observation/candidate bytes gain no host-origin, scenario-success, domain-quality, production, or wider-compatibility authority. D-30 remains acyclic because only later journal entries reference exact leaf digests.

## Task Outcomes and Commits

No commits were created under the execution contract.

1. **Task 1: Reproduce partial leaf and retained-parent failures** — complete. Added deterministic short-write, parent-sync, final-name race, stale-parent, clean retry, packed fresh-process, foreign-final, and installed-hook retained-authority assertions; commit: none.
2. **Task 2: Stage, sync, and publish leaves under retained authority** — complete. Implemented the publisher and wired continuation/hook authority lifetimes; commit: none.

## Publication Contract

| Boundary | Required proof | Rejection behavior |
| --- | --- | --- |
| Parent admission | Current-user-owned directory, no group/world write, no-follow open, retained/path inode equality | No stage or final is created |
| Stage completion | Exact open inode remains at random stage path, exact length, safe mode, full write and sync | Exact operation-owned stage is removed; no digest final exists |
| Final publication | `link(stage, digest.json)` succeeds absent-only and both names identify the open inode | Existing final is preserved byte-for-byte; owned stage is retired |
| Parent commit | Retained directory identity holds and its exact handle sync succeeds | Exact owned final/stage are rolled back when still provable; ambiguity is preserved |
| Cleanup | Stage pathname still identifies the exact open inode, parent is synced again, final reloads with one link | A replacement is never unlinked; publication rejects boundedly |

The public candidate and observation values and schemas did not change. The two new exported lifecycle helpers, `retainCodexUatLeafDirectoryAuthority` and `releaseCodexUatLeafDirectoryAuthority`, pass an in-process branded authority; callers cannot substitute a pathname-shaped object. Direct publishers retain and release their own authority when a trusted caller does not need to span another operation.

## Packed and Hook Handoff

- `continueCodexUatAfterUninstall` retains candidate and observation directories immediately after layout admission. The fresh path holds both across uninstall, final observation publication, scenario journal append, candidate publication, and candidate-ready append. The recovery path holds candidate authority through exact orphan loading and candidate-ready append.
- The continuation uses `return await` inside the authority `try/finally`; handles therefore close only after the selected async continuation path settles.
- `deliverBuilderHook` decides whether the current event can create a UAT observation, retains the exact observation directory before checkpoint CAS, publishes through that authority, then closes it in `finally`.
- Neither caller receives new journal append authority. Observation and candidate admissions still flow one way into the existing legal journal transitions.

## Exact I/O and Import Handoff for Plan 02-23

Plan 02-23 remains the sole owner of `test/helpers/io-surface-inventory.js` and `test/artifact-surface-coverage.test.js`. Plan 02-22 did not modify either snapshot.

### Import delta

- `src/builder-codex-uat.js`: added `link` and `unlink` from `node:fs/promises`; existing `mkdir`, `open`, and `lstat` imports remain.
- `src/builder-codex-uat-continuation.js`: added `retainCodexUatLeafDirectoryAuthority` and `releaseCodexUatLeafDirectoryAuthority` from `builder-codex-uat`; no new direct filesystem import.
- `src/builder-hook-bridge.js`: added the same two authority lifecycle imports; no direct filesystem I/O callee was added.

### Static I/O surface delta

`src/builder-codex-uat.js` now contributes 26 scanner rows, replacing the prior 10-row direct-final writer recorded by Plan 02-21, for a net increase of 16 rows. The complete current set is:

```text
src/builder-codex-uat.js:1494:filesystem-lifecycle:fs.mkdir
src/builder-codex-uat.js:1495:filesystem-open:fs.open
src/builder-codex-uat.js:1499:file-handle-read:FileHandle.stat
src/builder-codex-uat.js:1500:filesystem-read:fs.lstat
src/builder-codex-uat.js:1546:filesystem-open:fs.open
src/builder-codex-uat.js:1565:file-handle-lifecycle:FileHandle.sync
src/builder-codex-uat.js:1581:filesystem-lifecycle:fs.link
src/builder-codex-uat.js:1600:file-handle-lifecycle:FileHandle.sync
src/builder-codex-uat.js:1614:file-handle-lifecycle:FileHandle.sync
src/builder-codex-uat.js:1670:file-handle-read:FileHandle.stat
src/builder-codex-uat.js:1671:filesystem-read:fs.lstat
src/builder-codex-uat.js:1703:file-handle-read:FileHandle.stat
src/builder-codex-uat.js:1704:filesystem-read:fs.lstat
src/builder-codex-uat.js:1723:filesystem-lifecycle:fs.unlink
src/builder-codex-uat.js:1748:file-handle-read:FileHandle.stat
src/builder-codex-uat.js:1761:file-handle-lifecycle:FileHandle.sync
src/builder-codex-uat.js:1766:file-handle-read:FileHandle.stat
src/builder-codex-uat.js:1767:filesystem-read:fs.lstat
src/builder-codex-uat.js:1773:filesystem-lifecycle:fs.unlink
src/builder-codex-uat.js:1799:filesystem-open:fs.open
src/builder-codex-uat.js:1800:file-handle-read:FileHandle.stat
src/builder-codex-uat.js:1801:filesystem-read:fs.lstat
src/builder-codex-uat.js:1808:file-handle-read:FileHandle.stat
src/builder-codex-uat.js:1809:filesystem-read:fs.lstat
src/builder-codex-uat.js:1908:file-handle-read:FileHandle.read
src/builder-codex-uat.js:1918:file-handle:FileHandle.write
```

`src/builder-codex-uat-continuation.js` still contributes 16 scanner rows. Line movement reflects authority wiring and the existing helpers; no new direct I/O primitive was added there. `src/builder-hook-bridge.js` contributes zero direct static I/O rows because it delegates authority acquisition and publication to the UAT module.

### Artifact and public-surface delta

- No candidate, observation, journal, checkpoint, continuation-result, or hook-result schema field changed.
- No new durable artifact family, output channel, network endpoint, environment-file option, private locator, or certification claim was introduced.
- Publisher requests accept an optional branded `parentAuthority`; a test-only leaf seam is admitted only under Node's test child context and is neither persisted nor reachable as an output artifact.
- The returned leaf admission keeps the existing `digest`, `value`, `filePath`, and `created` fields. A successful new publication returns `created: true`; existing candidates are re-admitted only through the dedicated recovery loader.

## Decisions Made

- Used hard-link publication rather than rename so the final digest name is absent-only and can never overwrite a competitor.
- Kept the stage handle open through link, both parent sync boundaries, cleanup, and final reload so every deletion decision is inode-bound.
- Kept ambiguity as evidence. If a path no longer identifies the operation-owned inode, cleanup leaves it untouched and reports a bounded rejection.
- Did not reuse journal recovery records or add a reverse journal reference. Leaf publication and cleanup are independent of immutable-journal commit repair.
- Did not run real Codex UAT, inspect a private locator, access network/GitHub, or make a human admission.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Kept continuation handles alive until the selected async path settled**

- **Found during:** Task 2 packed continuation verification.
- **Issue:** Returning an un-awaited promise from inside the new authority `try/finally` closed candidate and observation handles before the continuation used them, producing `EBADF` in the packed child.
- **Fix:** Used `return await` for both fresh and recovery branches so `finally` runs after leaf publication/candidate recovery completes.
- **Files modified:** `src/builder-codex-uat-continuation.js`.
- **Verification:** The previously failing packed continuation regression passes, and the full focused gate is 37/37.
- **Commit:** none by execution contract.

**Total deviations:** 1 auto-fixed Rule 1 bug. It was required for the planned retained-authority lifetime and did not expand architecture.

## Issues Encountered

- The repository is intentionally a shared dirty main working tree and the six plan-owned source/test files are currently untracked along with prior phase work. Edits were confined to the plan-owned paths; no unrelated dirty file was staged, reverted, or rewritten.
- Full-suite inventory failures include prior line drift from earlier uncommitted plans plus the new 26-row leaf surface. Plan 02-23 owns the single canonical reconciliation.

## Deferred Issues

- `npm run check` passes all syntax checks and 684/686 tests. Exactly two tests fail: `classifies every current repository write/output surface with one exact owner and status` and `exactly re-inventories the Wave 16/17 production closure without a side surface`.
- Those are the two explicitly allowed Plan 02-23 inventory snapshots. No third failure or new failure category was observed.

## Authentication Gates

None. No `.env` content, credential source, real Codex process, private locator, network request, GitHub operation, or actual UAT was used.

## Known Stubs

None. The plan-owned implementation contains no TODO, FIXME, placeholder, coming-soon path, or goal-blocking empty data source. Existing `null`, empty collection, and empty string values are deliberate state-machine or test-fixture values rather than UI/runtime stubs.

## Verification

- TDD RED: the new focused tests initially failed at module import because retained-authority lifecycle exports did not exist.
- Focused gate: `node --test test/builder-codex-uat.test.js test/builder-packed-install.test.js test/builder-hook-bridge.test.js` — 37/37 pass; 3 suites; 0 failed, cancelled, skipped, or todo.
- `npm run check` — all syntax checks pass; 684/686 tests pass; exactly the two allowed Plan 02-23 inventory snapshots fail.
- `git diff --check` — pass.
- Static inventory scan — 26 UAT rows, 16 continuation rows, 0 hook-bridge direct rows; exact UAT rows recorded above.
- Stub/threat scan — no goal-blocking stub and no unplanned trust boundary beyond the plan's retained-parent file-publication threat model.

## Certification Boundary

This plan proves deterministic candidate/observation leaf publication, cleanup, competition handling, caller authority retention, and packed fresh-process recovery mechanics only. It does not prove cryptographic Codex origin, a real Codex session, human observation, human candidate admission, Agent Package quality, domain quality, production readiness, deployment approval, or wider Codex/OpenClaw compatibility. BLDR-07's real-observation requirement therefore remains outside `requirements-completed` even though its leaf-publication prerequisite is now closed.

## Self-Check: PASSED

- All six plan-owned implementation/test files and this summary exist.
- Both retained-authority lifecycle exports and all three caller handoffs are present.
- Focused verification is 37/37; full repository failures remain exactly the two documented Plan 02-23 inventory snapshots.
- No `.env`, real host state, private locator, network, GitHub, ROADMAP, STATE, REQUIREMENTS, release record, or 02-23-owned inventory file was modified by this plan.
- Commit lookup is not applicable because commits were prohibited.

---
*Phase: 02-codex-builder*
*Completed: 2026-07-21*
