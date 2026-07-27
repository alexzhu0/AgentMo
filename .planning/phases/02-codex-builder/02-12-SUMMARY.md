---
phase: 02-codex-builder
plan: "12"
subsystem: builder-lifecycle-security
tags: [inode-identity, quarantine, rollback, no-follow, io-inventory]

requires:
  - phase: 02-codex-builder
    provides: Receipt-owned lifecycle, exact install publication, Codex host reference transactions, and immutable attempt evidence through Plan 11
provides:
  - Non-destructive exact-inode lifecycle retirement into random private retained evidence
  - Handle-sourced receipt rollback with absent-only no-follow exclusive publication
  - Hostile race regressions and exact inventory of open, rename, link, directory, write, and sync surfaces
affects: [builder-upgrade, builder-uninstall, builder-install, codex-host-activation, phase-2-uat]

tech-stack:
  added: []
  patterns:
    - Retain authority in an open handle while atomically moving the admitted directory entry
    - Recover canonical bytes only through O_EXCL and O_NOFOLLOW destination handles
    - Preserve ambiguous canonical and quarantine entries instead of pathname cleanup

key-files:
  created: []
  modified:
    - src/builder-lifecycle.js
    - src/builder-install.js
    - test/builder-lifecycle.test.js
    - test/builder-install-security.test.js
    - test/builder-packed-install.test.js
    - test/helpers/io-surface-inventory.js
    - test/artifact-surface-coverage.test.js

key-decisions:
  - "Successful lifecycle retirement moves the exact admitted inode into a random mode-private evidence directory and removes only the proven-empty operation container."
  - "Receipt rollback authority is the retained open handle; the retained pathname is never re-admitted, linked, unlinked, or used as a byte source."
  - "Any late canonical target, parent drift, hardlink, metadata drift, or quarantine competitor preserves all observed state and returns a bounded failure."

patterns-established:
  - "Quarantine-first retirement: anchor, revalidate handle/path/parent, rename, revalidate, then retain without pathname deletion."
  - "Exclusive recovery: read exact bounded bytes from an admitted handle, create the absent target with no-follow O_EXCL, write/sync/revalidate, then sync the exact parent."

requirements-completed: [BLDR-06]

coverage:
  - id: D1
    description: Lifecycle upgrade and uninstall retire only exact admitted inodes while preserving every raced competitor and returning value-blind retained evidence.
    requirement: BLDR-06
    verification:
      - kind: integration
        ref: test/builder-lifecycle.test.js#receipt-owned Builder lifecycle
        status: pass
      - kind: integration
        ref: test/builder-codex-host.test.js#preview-bound Codex host activation
        status: pass
    human_judgment: false
  - id: D2
    description: Receipt rollback republishes exact prior bytes only from a retained handle into an absent exclusive destination and never adopts a retained pathname.
    requirement: BLDR-06
    verification:
      - kind: integration
        ref: test/builder-install-security.test.js#Builder projection publication safety
        status: pass
      - kind: integration
        ref: test/builder-packed-install.test.js#packed Codex Builder setup
        status: pass
    human_judgment: false
  - id: D3
    description: Every new lifecycle, recovery, and FileHandle sync surface has one exact gated owner in the repository I/O inventory.
    requirement: BLDR-06
    verification:
      - kind: unit
        ref: test/artifact-surface-coverage.test.js#artifact/output surface inventory
        status: pass
    human_judgment: false

duration: 1h 5m
completed: 2026-07-20
status: complete
---

# Phase 2 Plan 12: Non-destructive Lifecycle and Receipt Recovery Summary

**Quarantine-first exact-inode retirement and retained-handle receipt recovery close CR-08 and WR-01 without deleting or adopting competitor pathnames.**

## Performance

- **Duration:** 1h 5m
- **Started:** 2026-07-20T09:13:00Z
- **Completed:** 2026-07-20T10:18:28Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Replaced lifecycle validate-close-unlink behavior with one handle-retained protocol shared by upgrade, uninstall, and standalone staging cleanup.
- Retained each exact retired inode in a random private evidence directory while making successful logical paths absent and keeping results free of raw bytes and private paths.
- Rebuilt receipt rollback around bounded reads from the admitted prior handle and absent-only `O_EXCL | O_NOFOLLOW` publication with exact file and parent sync checks.
- Added same-byte inode, late canonical, hardlink, metadata, parent, and quarantine-entry race coverage, including a packed installation rollback path.
- Extended exact I/O discovery to inventory `FileHandle.sync` and assigned every new surface to a gated plan owner.

## Task Commits

Commits: none. Per execution constraints, no files were staged or committed in the shared dirty worktree.

## Files Created/Modified

- `src/builder-lifecycle.js` - Central exact-inode retirement, private retained evidence finalization, no-clobber conflict handling, and value-blind retirement results.
- `src/builder-install.js` - Retained receipt-handle admission, exclusive canonical recovery, exact metadata and parent checks, and removal of the identity-free fallback.
- `test/builder-lifecycle.test.js` - CR-08 pre-move and post-publication race regressions plus exact retained-inode assertions.
- `test/builder-install-security.test.js` - WR-01 retained-path replacement, late destination, hardlink, and metadata regressions.
- `test/builder-packed-install.test.js` - Packed v2-to-v3 rollback regression using admitted-handle recovery.
- `test/helpers/io-surface-inventory.js` - Exact ownership rows for new lifecycle/install operations and `FileHandle.sync` discovery.
- `test/artifact-surface-coverage.test.js` - Sync scanner fixture and Phase 2 Plan 12 ownership admission.

## Decisions Made

- Kept successful retained evidence outside the active `lifecycle-quarantine` container. The exact operation directory is moved atomically to a random private sibling; only the proven-empty container is removed. This preserves retained bytes while maintaining the existing post-finalization host transaction boundary.
- Kept the prior receipt handle open from pre-rename admission through rollback and closed it on every success or failure path.
- Treated a replaced retained pathname as non-authoritative: recovery may still use the unchanged admitted handle, but the replacement and displaced admitted entry remain untouched.
- Left an exclusive recovery inode in place on ambiguous post-create failure rather than risking deletion of a pathname that may have been replaced.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Preserved post-finalization host reference semantics with retained lifecycle evidence**

- **Found during:** Repository-wide `npm run check` after Task 2
- **Issue:** Keeping successful evidence inside the active quarantine container masked the established post-finalization host drift seam, and an unknown sibling injected into that container was not rejected.
- **Fix:** Require the container to contain exactly the operation-owned active directory, move that directory to private retained evidence, require the container empty, remove only the empty container, and sync the exact parent. Unknown siblings are preserved and fail closed.
- **Files modified:** `src/builder-lifecycle.js`, `test/builder-lifecycle.test.js`, `test/helpers/io-surface-inventory.js`
- **Verification:** Both ghost-consumer regressions pass; the complete repository gate passes 632/632 tests.
- **Committed in:** none (commits prohibited for this execution)

---

**Total deviations:** 1 auto-fixed (1 Rule 1 bug)
**Impact on plan:** The correction is required for lifecycle correctness and retains all Plan 12 non-destructive guarantees without widening product scope.

## Issues Encountered

- The first repository gate exposed two ghost-consumer regressions caused by retained evidence remaining under the active transaction pathname. The finalization boundary was corrected and the full gate then passed.

## Known Stubs

None. No placeholders, TODO/FIXME paths, mock data flows, or empty UI-facing values were introduced.

## Threat Flags

None. The new filesystem trust-boundary surfaces are the exact lifecycle and receipt-recovery surfaces registered in the plan threat model and I/O inventory.

## Verification

- `node --test test/builder-lifecycle.test.js` - 30/30 passed.
- `node --test test/builder-install-security.test.js` - 16/16 passed.
- `node --test test/builder-packed-install.test.js` - 13/13 passed in the final repository gate; the standalone packed run also exited 0.
- `node --test test/artifact-surface-coverage.test.js` - 10/10 passed.
- `npm run check` - 632/632 passed.
- `git diff --check` - passed.
- Repository searches found no identity-free retained-path fallback and no lifecycle quarantine-entry pathname unlink.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- CR-08 and WR-01 have failing-before/passing-after hostile regressions and repository-wide coverage.
- BLDR-06 lifecycle mutation and receipt rollback now preserve exact ownership under reviewed races.
- No blockers remain. Lifecycle result digests are ready for one-way reference by later Phase 2 attempt evidence without creating a second authority.

## Self-Check: PASSED

- All seven declared implementation/test files and this summary exist.
- Required `status: complete`, BLDR-06 coverage, verification evidence, and `commits: none` constraints are recorded.
- Commit-hash checks are not applicable because staging and commits were explicitly prohibited for this execution.

---
*Phase: 02-codex-builder*
*Completed: 2026-07-20*
