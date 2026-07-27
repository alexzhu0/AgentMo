---
phase: 02-codex-builder
plan: "19"
subsystem: codex-host-state-authority
tags: [codex, filesystem, retained-handles, inode-cas, hostile-races, lifecycle]

requires:
  - phase: 02-codex-builder
    plan: "17"
    provides: Packed release and bounded failed-host evidence that exposed the shared-state rollback gap
provides:
  - Current-user-owned, non-symlink, non-group/world-writable shared Codex state roots
  - Retained ancestor/root and file-handle authority across owner/ledger CAS finalization
  - Conflict-preserving publication, retirement, restore, retract, and cleanup behavior
  - Deterministic final-window hostile regressions and a complete Plan 02-23 I/O inventory handoff
affects: [codex-builder, host-activation, selector-owner, consumer-ledger, lifecycle, plan-02-23-inventory]

tech-stack:
  added: []
  patterns:
    - Retain every real shared-state ancestor handle and recheck pathname-to-handle identity before each effect
    - Preserve ambiguous directory entries by random private rename rather than adopting or deleting them
    - Keep write-stage and prior-state handles open through publication and compensation

key-files:
  created:
    - .planning/phases/02-codex-builder/02-19-SUMMARY.md
  modified:
    - src/builder-codex-host.js
    - test/builder-codex-host.test.js
    - test/builder-lifecycle.test.js

key-decisions:
  - "Treat uid, mode, realpath, and retained inode identity as one state-root admission contract."
  - "A final-window ambiguity preserves every observable competitor and returns a bounded conflict; it never grants owner/ledger authority to replacement bytes."
  - "Keep interrupted on-disk reservation evidence while closing process-local retained handles through explicit release, abandonment, or finalization."
  - "Leave canonical static inventory reconciliation to Plan 02-23 as required."

patterns-established:
  - "State effects use pre-effect seams followed by retained-handle/root revalidation and post-effect identity checks."
  - "Implicit owner/ledger operations execute under the exact reservation token they acquired."

requirements-completed: [BLDR-06]

coverage:
  - id: CR-05
    description: "Every mutable shared Codex state-root ancestor is current-user-owned, non-symlink, non-group/world-writable, and retained through mutation."
    requirement: BLDR-06
    verification:
      - kind: integration
        ref: "test/builder-codex-host.test.js#rejects unsafe or foreign state roots before creating reservation or authority bytes"
        status: pass
    human_judgment: false
  - id: CR-06
    description: "Owner/ledger publication, retirement, restore, retract, and cleanup preserve final-window competitors without adopting or deleting their inode."
    requirement: BLDR-06
    verification:
      - kind: integration
        ref: "test/builder-codex-host.test.js#preserves final-window publication and cleanup competitors without adopting their inode"
        status: pass
      - kind: integration
        ref: "test/builder-codex-host.test.js#retains root, retirement, restore, and retract authority through each final effect"
        status: pass
    human_judgment: false

duration: 34min
completed: 2026-07-21
status: complete
---

# Phase 02 Plan 19: Retained Shared-Host Authority Summary

**Shared Codex host roots and selector owner/consumer-ledger CAS now retain exact directory and file authority through every final filesystem effect, preserving all injected competitors on conflict.**

## Performance

- **Duration:** 34 min
- **Completed:** 2026-07-21
- **Tasks:** 3/3 complete
- **Commits:** none — prohibited by the project execution contract
- **Planning state:** intentionally unchanged

## Accomplishments

- Closed CR-05 by requiring current uid, non-symlink canonical directories, and no group/world write bits on every real shared-state ancestor, then retaining no-follow directory handles for the operation lifetime.
- Closed CR-06 by holding write stages, current owner/ledger files, retained priors, and root authority through publication, retirement, restore, retract, and cleanup.
- Added deterministic post-validation race seams that replace root, stage, prior, restore, retract, or cleanup entries and prove the exact competitor bytes/inodes survive without becoming canonical authority.
- Preserved fixed official Codex commands, D-26 sibling/modified-asset behavior, and bounded mechanism-only evidence semantics.
- Added lifecycle evidence assertions that diagnostics stay below 64 KiB, use relative non-traversing identities, and contain neither host paths nor retained bytes.

## Task Outcomes and Commits

No commits were created. The execution contract prohibited staging, committing, pushing, tagging, stashing, and branch switching.

1. **Task 1: Reproduce unsafe-root and final-window host races** — complete. Three new hostile tests failed 0/3 against the reviewed implementation, then passed after the fix; commits: none.
2. **Task 2: Retain shared-root and inode authority through CAS finalization** — complete. Root and file authorities remain retained across all state effects; commits: none.
3. **Task 3: Close shared-host caller and evidence parity** — complete. Activation, lifecycle, removal, compensation, and restart-focused coverage passes with bounded diagnostics; commits: none.

## Authority and Conflict Semantics

- Production state roots retain handles for `$HOME`, `.agentmo`, `builder`, and `codex-host`; the explicit test root models the final shared-state boundary without touching a real host.
- Directory admission requires current uid, canonical non-symlink identity, and `(mode & 0o022) === 0` before reservation creation or state bytes.
- Every reservation rechecks each retained ancestor handle against its current pathname before mutation. A replaced root invalidates the reservation and leaves the replacement untouched.
- `writeStateArtifact` keeps both the staged file and any exact current owner/ledger inode open. It revalidates before retirement/link, confirms the linked destination inode, and quarantines a stage or destination ambiguity rather than deleting it.
- `restoreExactRetained`, reserved-prior rollback, and missing-prior retract all use the same retained source/root authority. A replacement is moved to private retained evidence, never linked into canonical state.
- Successful retract retires the exact removed state into private evidence rather than unlinking it. Reservation evidence remains fail-closed and exact across restart.
- Process-local directory handles close on successful release, explicit abandonment, or reservation-token finalization; on-disk interrupted reservation evidence remains intact.

## Host I/O and Artifact Delta for Plan 02-23

Plan 02-23 must reconcile the canonical inventory once. This plan intentionally did not edit `test/helpers/io-surface-inventory.js` or `test/artifact-surface-coverage.test.js`.

### Semantic I/O changes

- Added retained directory authority: `fs.open` plus retained `FileHandle.stat` and pathname `fs.lstat` for each state-root ancestor; every reservation assertion consumes those identities.
- Added staged-file `FileHandle.stat`, post-link `fs.lstat`, and reusable retained-file open/stat/read/stat/lstat capture.
- Added exact open-file/path comparison through `FileHandle.stat` plus `fs.lstat` immediately around publication, retirement, restore, retract, and cleanup.
- Added `fs.rename` into random `.conflict-retained` evidence for ambiguous stage, destination, prior, restore, or retract entries.
- Collapsed two branch-specific stage `fs.link`/`fs.unlink` pairs into one identity-bound publication link and one guarded cleanup unlink.
- Removed the non-reservation prior unlink and the unconditional `finally` stage unlink.
- Consolidated prior restore into the shared retained restore link/cleanup path.
- Replaced retract's validated-path unlink with two exact renames: canonical to rollback evidence, then rollback evidence to retained retraction evidence.
- No new network, process-execution, public CLI, authentication, schema, durable artifact family, or real-host mutation surface was added.

### Current `src/builder-codex-host.js` static rows

The current scanner reports these behaviorally new or consolidated rows for Plan 02-23:

- Root/file authority: `1373 open`, `1380 FileHandle.stat`, `1419 lstat`, `1518 lstat`, `1522 open`, `1523 FileHandle.stat`, `1524 FileHandle.readFile`, `1525 FileHandle.stat`, `1526 lstat`, `1557 FileHandle.stat`, `1558 lstat`, `1724 open`, `1728 FileHandle.stat`, `1729 lstat`, `1783 FileHandle.stat`, `1784 lstat`.
- State effects: `1399 rename` (prior retirement), `1418 link` (publication), `1591 rename` (ambiguous retention), `1613 lstat` and `1632 unlink` (guarded stage cleanup), `1902 rename` (published-current retirement), `1976 rename` and `1990 rename` (retract retention).
- Shared retained restore: `895 link`, `896 lstat`, `913 unlink`.

Existing rows moved with the implementation. The complete current scanner output for this module is 66 rows; the key removals from the old snapshot are branch-specific `1284/1285` and `1295/1296` link/unlink pairs, prior cleanup unlink `1304`, unconditional finally unlink `1327`, retract unlink `1600`, and the duplicate restore link/unlink at `1611/1612`. Plan 02-23 must also retain the exact Plan 02-18 UAT/CLI row movements already recorded in 02-18-SUMMARY.

### Producer/consumer edges

- `retainStateRootAuthority` produces the ancestor/root identity set consumed by reservation acquire/assert/release and every state effect.
- `retainExactFile` and the open stage handle produce exact bytes/inode evidence consumed by `exactOpenFileAtPath`, publication checks, restore, retract, and ambiguity retention.
- `withStateReservation` now passes the exact acquired token into implicit owner/ledger writes and restores; `retainedPriors` therefore records and consumes one reservation-bound prior/published identity pair.
- No new artifact schema or inventory row is required beyond these static I/O and authority edges.

## Decisions Made

- Current uid and safe mode are part of directory identity, not a separate advisory check.
- Pathname equality is never sufficient after an operation starts; retained handles and device/inode comparisons remain authoritative.
- A bounded conflict may leave private retained evidence or an active interrupted reservation. It must never clean an inode whose authority became ambiguous.
- Evidence remains mechanism-only: these tests do not prove real Codex activation, host origin, domain quality, production readiness, or broader compatibility.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Passed implicit reservations into their state operations**

- **Found during:** Task 2 retained-prior implementation.
- **Issue:** `withStateReservation` acquired a token but invoked its operation without that token, so implicit writes could not bind retained priors to the reservation they later released.
- **Fix:** The wrapper now supplies the exact token to owner/ledger write and restore operations.
- **Files modified:** `src/builder-codex-host.js`.
- **Verification:** Full host/lifecycle gate 77/77 passes.
- **Commit:** none by execution contract.

**2. [Rule 2 - Missing critical functionality] Closed retained directory handles on every terminal process path**

- **Found during:** Task 2 hostile failure-path verification.
- **Issue:** Recovery-required and contaminated-reservation paths intentionally preserve disk evidence but could leave their process-local retained directory handle for garbage collection.
- **Fix:** Successful release and explicit abandonment close handles immediately; a reservation finalizer closes handles when a recovery token becomes unreachable without mutating disk evidence.
- **Files modified:** `src/builder-codex-host.js`.
- **Verification:** Focused hostile and full 77-test gates pass with no FileHandle garbage-collection warnings.
- **Commit:** none by execution contract.

**Total deviations:** 2 auto-fixed (1 Rule 1, 1 Rule 2). Both are required for exact reservation authority and bounded resource lifetime; no architecture or public API was added.

## Deferred Issues

- `npm run check` passes all syntax gates and 661/663 tests. Its only failures are the pre-existing whole-repository and Wave 16/17 canonical artifact inventory snapshots assigned to Plan 02-23.
- The Plan 02-19 host row changes above are intentionally added to that single reconciliation handoff. No canonical inventory file was modified early.

## Authentication Gates

None. No real Codex process, private locator, network access, credential path, or actual UAT was used.

## Known Stubs

None. The modified files contain no TODO, FIXME, placeholder, coming-soon, or goal-blocking empty data source.

## Verification

- TDD RED hostile subset — 0/3 passed before implementation, proving all three reviewed gaps reproduced.
- TDD GREEN hostile subset — 3/3 passed after implementation.
- `node --test test/builder-codex-host.test.js test/builder-lifecycle.test.js` — 77/77 pass; 0 failed, skipped, or todo.
- `npm run check` — syntax gates pass; 661/663 tests pass. Only the two expected Plan 02-23 inventory snapshots fail.
- `node --check` for all three modified JavaScript files — pass.
- Stub scan across all three modified files — no matches.
- `git diff --check` — pass.
- Per-file no-index whitespace checks for all three untracked target files — pass.

## Certification Boundary

This plan closes deterministic shared-host filesystem authority only. It does not prove cryptographic Codex origin, real Codex installation or activation, real session behavior, domain quality, Agent Package quality, production readiness, deployment approval, or wider Codex/OpenClaw compatibility. D-28/D-29 evidence separation remains unchanged.

## User Setup Required

None.

## Next Phase Readiness

CR-05 and CR-06 are closed. Plan 02-23 has an exact semantic and static I/O delta for the single canonical inventory reconciliation. Real Codex UAT remains gated behind the later repair plans and explicit human checkpoints.

## Self-Check: PASSED

- `src/builder-codex-host.js`, both focused test files, and this summary exist.
- All seven final-window seam families are present and consumed by hostile tests or shared production callers.
- Focused verification passes 77/77; repository-wide failures remain exactly the two documented Plan 02-23 snapshots.
- No `.env`, real host state, private locator, network, GitHub, ROADMAP, STATE, REQUIREMENTS, or 02-23-owned inventory file was read for secrets or modified.
- Commit lookup is not applicable because commits were prohibited.

---
*Phase: 02-codex-builder*
*Completed: 2026-07-21*
