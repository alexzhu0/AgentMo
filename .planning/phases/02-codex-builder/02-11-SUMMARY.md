---
phase: 02-codex-builder
plan: "11"
subsystem: builder-checkpoint-persistence
tags: [immutable-journal, checkpoint-admission, event-digest, replay, filesystem-identity]
requires:
  - phase: 02-codex-builder
    plan: "10"
    provides: [bounded checkpoint and event contracts, final gap findings]
provides:
  - bounded immutable checkpoint predecessor chain with no mutable head
  - exact private checkpoint admissions bound to canonical bytes and entry identity
  - canonical event digest admission immune to caller-selected wrapper digests
affects: [02-14-lifecycle-hardening, 02-15-hook-uat-journal, builder-package-inventory, io-surface-inventory]
tech-stack:
  added: []
  patterns: [exclusive hardlink publication, bounded unique-chain loading, WeakSet admission minting, canonical replay identity]
key-files:
  created:
    - src/builder-immutable-journal.js
    - .planning/phases/02-codex-builder/02-11-SUMMARY.md
  modified:
    - src/builder-checkpoint.js
    - src/builder-events.js
    - src/builder-package.js
    - src/builder-hook-bridge.js
    - src/builder-behavior-eval.js
    - test/builder-checkpoint.test.js
    - test/builder-hook.test.js
    - test/builder-hook-bridge.test.js
    - test/builder-packed-install.test.js
    - test/helpers/io-surface-inventory.js
    - test/artifact-surface-coverage.test.js
key-decisions:
  - "The logical checkpoint pathname is an absent-only immutable genesis; successors are canonical predecessor-bound sibling entries, and no mutable head or compatibility mirror is written."
  - "Checkpoint authority is a private admission over canonical checkpoint bytes, sequence, predecessor digest, publication digest, and retained inode identity."
  - "Event wrappers are accepted only when their digest equals the digest recomputed from canonical event bytes; only that recomputed digest enters recentEvents."
  - "Installed hooks derive the unique current checkpoint head through the immutable journal admission and then re-admit the checkpoint at that exact digest; the immutable genesis path is never treated as a mutable head."
  - "Behavior evaluation propagates checkpoint digests minted by writes and fresh CLI results, and proves duplicate handling without attempting an identical successor on the same journal."
patterns-established:
  - "Immutable publication: retained parent + O_EXCL/O_NOFOLLOW stage and lock + absent-only hardlink + inode/nlink/mode/uid revalidation + parent sync."
  - "Recovery: bounded directory scan derives exactly one contiguous genesis-to-head chain and rejects every fork, gap, orphan, duplicate, malformed, unsafe, unknown, locked, or unfinished state."
requirements-completed: [CORE-05, BLDR-04]
coverage:
  - id: D1
    description: "Checkpoint writes form one immutable predecessor chain and legal restarts derive the same unique head without overwriting genesis."
    requirement: CORE-05
    verification:
      - kind: unit
        ref: "test/builder-checkpoint.test.js#publishes one immutable predecessor chain and derives the same unique head after restart"
        status: pass
      - kind: unit
        ref: "node --test test/builder-checkpoint.test.js test/builder-hook.test.js"
        status: pass
    human_judgment: false
  - id: D2
    description: "Late targets, inode swaps, lock/stage replacement, parent replacement, hardlinks, forks, gaps, malformed entries, and unsafe metadata fail closed while competitors remain preserved."
    requirement: BLDR-04
    verification:
      - kind: unit
        ref: "test/builder-checkpoint.test.js#hostile immutable publication and loading regressions"
        status: pass
    human_judgment: false
  - id: D3
    description: "Checkpoint summaries and successor publication require loader/publication-minted admissions over exact canonical bytes."
    requirement: CORE-05
    verification:
      - kind: unit
        ref: "test/builder-checkpoint.test.js#rejects forged checkpoint admissions before summary or successor publication"
        status: pass
    human_judgment: false
  - id: D4
    description: "A forged event digest cannot poison recentEvents, and later canonical replay remains a duplicate no-op."
    requirement: BLDR-04
    verification:
      - kind: unit
        ref: "test/builder-hook.test.js#rejects a forged wrapper digest before ledger mutation and keeps canonical replay a no-op"
        status: pass
    human_judgment: false
duration: ~2h
completed: 2026-07-20
status: complete
---

# Phase 2 Plan 11: Immutable Checkpoint and Event Authority Summary

**Checkpoint recovery now derives one exact immutable predecessor chain, while private checkpoint admissions and recomputed event digests prevent caller-selected authority from entering resume or replay state.**

## Performance

- **Duration:** Approximately 2 hours
- **Completed:** 2026-07-20T09:32:04Z
- **Tasks:** 2
- **Files created or modified:** 13 including this summary

## Accomplishments

- Added a host-neutral immutable journal primitive with bounded same-directory scanning, absent-only hardlink publication, retained parent/file identity, current-uid and safe-mode checks, `nlink === 1` admission, exact predecessor validation, file/directory sync, and operation-owned cleanup.
- Replaced checkpoint overwrite/CAS with immutable raw genesis plus canonical predecessor-bound successor entries. Recovery accepts only one contiguous chain and has no mutable pointer or overwritten compatibility mirror.
- Added private checkpoint admission minting. Admissions bind canonical bytes, digest, sequence, predecessor, publication digest, entry identity, and checkpoint value; caller-built wrappers fail before summary or successor publication.
- Bound event wrappers to a recomputed canonical event digest before replay lookup. Only that digest enters `recentEvents`, so a forged digest cannot poison later canonical replay.
- Added hostile regressions for late target creation, target and final-window same-byte swaps, lock/stage replacement, final lock replacement, changed parent, hardlinks, competing successors, forks, gaps/orphans, duplicate sequences, malformed/unknown/unfinished publications, unsafe mode, and schema-invalid successor payloads.
- Closed packed-runtime integration by including the immutable journal in the fixed release inventory, deriving the installed hook's current head through a complete journal admission, and carrying write-minted head digests through fresh-process behavior evaluation.
- Reconciled the exact I/O surface inventory and converted legacy/packed assertions from mutable-path expectations to immutable-genesis plus unique-successor checks and full journal snapshots.

## TDD Evidence

- **Task 1 RED:** `node --test test/builder-checkpoint.test.js` failed with `ERR_MODULE_NOT_FOUND` for the not-yet-created immutable journal.
- **Task 1 GREEN:** checkpoint/journal hostile suite passed after the primitive and private checkpoint admission adapter were implemented.
- **Task 2 RED:** the new forged event-wrapper regression failed because the prior reducer accepted the caller-selected digest.
- **Task 2 GREEN:** `node --test test/builder-checkpoint.test.js test/builder-hook.test.js` passes **23/23**.

## Verification

- `node --test test/builder-checkpoint.test.js test/builder-hook.test.js` — **PASS, 23/23**.
- `node --test test/builder-cli.test.js test/builder-codex-uat.test.js` — **PASS, 14/14**.
- `node --test test/artifact-surface-coverage.test.js test/builder-checkpoint.test.js test/builder-hook.test.js test/builder-hook-bridge.test.js test/builder-packed-install.test.js test/codex-builder-behavior.test.js` — **PASS, 61/61**.
- `node --test test/builder-package-security.test.js` — **PASS, 8/8**.
- `node --test test/artifact-surface-coverage.test.js` — **PASS, 10/10**.
- `node --test test/builder-hook-bridge.test.js` — **PASS, 11/11**.
- `node --check` for all changed JavaScript implementation/test files — **PASS**.
- `git diff --check` — **PASS**.
- Stub scan across all plan-owned files — **PASS**, no TODO/FIXME/placeholder/coming-soon patterns.
- `npm run check` — **PASS, 624/624 across 66 suites**.

## Integration Deviations Closed

The root executor explicitly authorized these minimal directly related deviations after the first repository-wide check exposed them:

1. The fixed package inventory now includes `src/builder-immutable-journal.js`, and packed inventory/install/import-closure counts and assertions include that exact runtime asset.
2. The I/O surface registry owns every new journal read/write/lifecycle call under Phase 02 Plan 11, removes obsolete checkpoint overwrite rows, and preserves exact-line coverage for shifted package and behavior-eval surfaces.
3. The legacy hook-bridge regression now proves the v1 genesis bytes remain exact and read-only while one admitted v2 successor becomes the unique restart head.
4. The installed bridge no longer hashes the immutable genesis path as if it were a current head. It derives the unique head via `loadImmutableJournal`, then re-admits the checkpoint at that exact digest so a concurrent or malformed chain still fails closed.
5. The behavior evaluator consumes write/CLI-minted checkpoint digests and uses a new absent output for duplicate-event materialization, while separately re-admitting the original journal to prove it did not change.

All five deviations are covered by the focused 61-test regression and the green 624-test repository gate.

## Decisions Made

- Kept the checkpoint payload digest distinct from the immutable wrapper publication digest. The former remains the exact checkpoint/replay identity; the latter binds the sequence/predecessor envelope and entry pathname.
- Kept legacy v1 bytes exact and immutable as sequence-zero input. The loaded in-memory value is deterministically normalized to v2, but no compatibility file is rewritten.
- Treated every officially named malformed successor as a bounded conflict rather than choosing around it. Unknown lock/stage/publication names under the journal namespace also fail closed.
- Kept the primitive storage-only. It carries opaque canonical bytes and identity metadata, does not validate Builder/UAT transitions, and does not infer Codex hook origin or host verification.
- Preserved the public direct event builder for canonical core/hook construction, but made every reducer boundary recompute its digest. Privately minted loader admissions are tracked separately.
- Kept installed current-head discovery fail-closed: a bounded journal scan must derive exactly one valid head, and a second checkpoint admission must still match that digest before hook delivery.
- Kept duplicate CLI evaluation compatible with the existing absent-output contract. The evaluator never appends an identical digest to the active journal and explicitly verifies the original admitted head remains unchanged.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Registered the immutable journal in the fixed packed runtime**
- **Found during:** Repository integration verification after Task 2
- **Issue:** Packed package admission rejected the new checkpoint dependency as an unlisted import.
- **Fix:** Added the exact journal source to the fixed inventory and updated exact asset/operation/receipt counts and closure assertions.
- **Files modified:** `src/builder-package.js`, `test/builder-packed-install.test.js`
- **Commit:** None by explicit execution restriction.

**2. [Rule 3 - Blocking] Reconciled exact I/O ownership for immutable publication**
- **Found during:** Repository integration verification after Task 2
- **Issue:** The exact surface registry still described overwrite-era checkpoint I/O and did not own the journal primitive's calls.
- **Fix:** Replaced obsolete rows with the journal surface, updated shifted exact-line entries, and extended the accepted Phase 02 Plan 11 owner taxonomy.
- **Files modified:** `test/helpers/io-surface-inventory.js`, `test/artifact-surface-coverage.test.js`
- **Commit:** None by explicit execution restriction.

**3. [Rule 1 - Bug] Preserved legacy genesis instead of asserting physical overwrite**
- **Found during:** Repository integration verification after Task 2
- **Issue:** A legacy bridge test expected v1 bytes at the logical path to be overwritten by v2.
- **Fix:** Asserted exact legacy genesis preservation, one immutable v2 successor, and restart from that unique admitted head.
- **Files modified:** `test/builder-hook-bridge.test.js`
- **Commit:** None by explicit execution restriction.

**4. [Rule 1 - Bug] Derived the installed hook's actual immutable current head**
- **Found during:** Packed hook traversal verification
- **Issue:** The installed bridge hashed the read-only genesis path and supplied that stale digest after an armed-challenge successor existed.
- **Fix:** Scanned the bounded journal for its unique admitted head and re-admitted the checkpoint at that exact digest before delivery.
- **Files modified:** `src/builder-hook-bridge.js`, `test/builder-packed-install.test.js`
- **Commit:** None by explicit execution restriction.

**5. [Rule 1 - Bug] Propagated immutable head digests through behavior evaluation**
- **Found during:** Packed fresh-process behavior verification
- **Issue:** The evaluator repeatedly hashed the genesis path after successor publication and attempted duplicate publication into the same journal.
- **Fix:** Used write/CLI-minted digests, reloaded exact admissions for stability, and materialized the duplicate result only at a new absent output while proving the original head unchanged.
- **Files modified:** `src/builder-behavior-eval.js`
- **Commit:** None by explicit execution restriction.

## Evidence Boundary

The journal proves bounded storage identity, exclusive publication, unique-chain recovery, and exact replay identity only. It does not prove Codex-origin hook delivery, authenticated host execution, domain quality, Agent Package quality, production readiness, or wider Codex compatibility. Hook inputs remain proposal/recovery candidates under D-21/D-23/D-29.

## Known Stubs

None.

## Commits

None — AGENTS/user restriction; no staging, commit, or push was performed.

## User Setup Required

None.

## Self-Check: PASSED

- All 12 implementation/test files listed in `key-files` and this summary exist.
- Both plan tasks, the focused 61-test integration set, and the complete 624-test repository gate pass.
- No unexpected tracked-file deletion, generated untracked output, known stub, or unreviewed threat surface was introduced.

## Next Phase Readiness

The immutable primitive, checkpoint/event admissions, packed runtime, installed hook traversal, and behavior evaluation are green and ready for the later lifecycle and single-UAT-journal migrations. No Plan 02-11 integration blocker remains.

---
*Phase: 02-codex-builder*
*Completed: 2026-07-20*
