---
phase: 02-codex-builder
plan: "14"
subsystem: builder-runtime-security
tags: [codex, static-analysis, package-closure, retained-handles, immutable-checkpoint, diagnostics]

requires:
  - phase: 02-codex-builder
    plan: "11"
    provides: Immutable checkpoint journal, unique-chain admission, and exact checkpoint digests
  - phase: 02-codex-builder
    plan: "13"
    provides: Stable user-owned marketplace projection and packed runtime boundary
provides:
  - Complete-or-reject JavaScript loader and I/O analysis shared by package and evidence inventory
  - Exact ESM, CJS, JSON, createRequire, worker, and fork closure in the packed runtime
  - Retained project-root-to-final diagnostic reads with identity and safe-metadata revalidation
  - Read-only doctor checkpoint status derived only from the immutable unique chain
affects: [codex-builder, builder-package, builder-doctor, artifact-surface-coverage, packed-runtime]

tech-stack:
  added: []
  patterns:
    - Dependency-free whole-file lexical analysis that rejects unresolved authority
    - Retained directory and file handles with before/after identity and metadata checks
    - Immutable journal head discovery followed by exact-digest checkpoint admission

key-files:
  created:
    - src/javascript-static-analysis.js
    - .planning/phases/02-codex-builder/02-14-SUMMARY.md
  modified:
    - src/builder-package.js
    - src/builder-doctor.js
    - package.json
    - test/builder-package-security.test.js
    - test/builder-doctor.test.js
    - test/helpers/io-surface-inventory.js
    - test/artifact-surface-coverage.test.js
    - test/builder-packed-install.test.js

key-decisions:
  - "Package closure and JavaScript I/O evidence use one dependency-free whole-file analyzer; unresolved dynamic authority rejects instead of disappearing."
  - "Doctor retains the canonical root-to-parent directory chain and final file handle, then rechecks identity, uid, mode, nlink, size, and timestamps before classification."
  - "Checkpoint diagnosis first derives one unique immutable journal head, then reloads the checkpoint with that exact expected digest; ambiguous chains expose no selected head."
  - "Diagnostic output remains bounded, relative, read-only, value-blind, and non-certifying."

patterns-established:
  - "Complete-or-reject closure: every local loader target is exact, portable, supported, inventoried, and recursively admitted."
  - "Retained diagnosis: path observations become evidence only while every retained ancestor and the final handle still match safe current metadata."
  - "No ambiguous head: fork, gap, orphan, malformed publication, or unsafe journal metadata is a diagnostic failure without resume authority."

requirements-completed: [BLDR-02, BLDR-05]

coverage:
  - id: D1
    description: "Packed runtime closure recursively accounts for exact ESM, CJS, JSON, createRequire, worker, and fork targets and rejects dynamic or escaped loader authority."
    requirement: BLDR-02
    verification:
      - kind: unit
        ref: "test/builder-package-security.test.js#Builder package trust boundaries"
        status: pass
      - kind: integration
        ref: "test/builder-packed-install.test.js#admits one deterministic fixed runtime inventory and its complete packed import closure"
        status: pass
    human_judgment: false
  - id: D2
    description: "The exact repository I/O inventory uses whole-file syntax records and rejects dynamic members, reassigned aliases, escaping aliases, and unknown calls."
    requirement: BLDR-05
    verification:
      - kind: unit
        ref: "test/artifact-surface-coverage.test.js#artifact/output surface inventory"
        status: pass
    human_judgment: false
  - id: D3
    description: "Doctor detects ancestor/final swaps and unsafe metadata while selecting checkpoint evidence only from one immutable unique chain without writing or certifying."
    requirement: BLDR-05
    verification:
      - kind: integration
        ref: "test/builder-doctor.test.js#read-only Builder doctor"
        status: pass
    human_judgment: false

duration: 33m
completed: 2026-07-20
status: complete
---

# Phase 02 Plan 14: Complete Runtime Closure and Retained Doctor Summary

**A shared complete-or-reject JavaScript analyzer now closes the packed runtime and exact I/O inventory, while retained-handle doctor reads consume only one immutable checkpoint chain.**

## Performance

- **Duration:** 33m
- **Started:** 2026-07-20T12:17:21Z
- **Completed:** 2026-07-20T12:50:23Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- Added dependency-free whole-file lexical analysis across comments, strings, regex literals, template expressions, multiline calls, aliases, optional/computed literal members, ESM, CommonJS, `createRequire`, worker, and fork loading surfaces.
- Made packed release admission recursively close exact local `.js`, `.mjs`, `.cjs`, and `.json` dependencies, include the immutable checkpoint runtime and analyzer, and reject path escape, unsupported extension, dynamic authority, or missing inventory entries.
- Replaced line-oriented JavaScript I/O evidence with the shared analyzer and reconciled exact source-line ownership without retaining prior string/template false positives.
- Made doctor retain and recheck every canonical project-root-to-parent directory plus the final no-follow handle, failing closed on parent symlinks, same-byte swaps, swap-back, unsafe uid/mode/nlink, size drift, or timestamp drift.
- Derived doctor checkpoint evidence only through immutable unique-head discovery plus exact-digest checkpoint admission; forks, gaps, orphans, malformed publications, and unsafe journal metadata expose no head digest or sequence.

## Task Commits

No commits were created. The parent execution contract explicitly prohibited staging, committing, pushing, or advancing shared planning state.

## Files Created/Modified

- `src/javascript-static-analysis.js` - Shared complete-or-reject loader and I/O syntax analysis.
- `src/builder-package.js` - Fixed runtime inventory and recursive exact ESM/CJS/JSON/worker closure.
- `src/builder-doctor.js` - Retained full-chain file admission and immutable unique-chain checkpoint diagnosis.
- `package.json` - Includes the new analyzer in the repository syntax-check gate.
- `test/builder-package-security.test.js` - Local CJS/JSON, dynamic loader, eval/Function, worker/fork, escape, and decoy regressions.
- `test/builder-doctor.test.js` - Before-open, during-read, before-classification, swap-back, parent-symlink, metadata, and hostile-journal regressions.
- `test/helpers/io-surface-inventory.js`, `test/artifact-surface-coverage.test.js` - Shared analyzer integration and exact repository I/O ownership.
- `test/builder-packed-install.test.js` - Authorized exact packed inventory count and analyzer source/destination/digest integration assertion.

## Decisions Made

- Loader discovery and I/O classification share one lexical model so package admission and evidence inventory cannot silently disagree about JavaScript syntax.
- Literal local loader targets are recursively admitted only when their normalized portable path, supported extension, and fixed runtime inventory entry all agree.
- Doctor diagnostic file evidence is classified only after two retained file-binding checks and two complete ancestor-chain checks around the read and classification boundaries.
- Checkpoint diagnostic success carries only relative path, exact head digest, and sequence; journal or checkpoint failure remains bounded and grants no lifecycle, resume, or host authority.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Updated the authorized packed fixed-inventory integration**
- **Found during:** Overall `npm run check` after Tasks 1-2
- **Issue:** The packed integration test retained the prior exact inventory totals of 61 assets and 56 runtime assets, so the required analyzer asset made the full gate fail at 653/654.
- **Fix:** After explicit parent authorization, updated the exact totals to 62 and 57 and added an exact source path, relative path, destination path, and digest assertion for `src/javascript-static-analysis.js`.
- **Files modified:** `test/builder-packed-install.test.js`
- **Verification:** Packed install 13/13, Plan 14 focused 42/42, and full repository 654/654.
- **Committed in:** Not committed by explicit instruction.

---

**Total deviations:** 1 auto-fixed (1 Rule 3)
**Impact on plan:** The authorized change closes the fixed packed-inventory integration without relaxing counts, assertions, runtime closure, or scope elsewhere.

## Issues Encountered

- The first shared-inventory pass exposed two former string/template false positives, one previously missed `FileHandle.sync`, and exact line drift in `builder-package.js`; the authoritative allowlist now matches complete syntax records exactly.
- The explicit swap-back test was shaped so the replacement is restored during the retained read; ancestor timestamp revalidation proves the transient rename cannot become pristine evidence.

## Known Stubs

None. The scan found normal empty accumulators and nullable control state, but no TODO, FIXME, placeholder, mock-only data path, or goal-blocking unwired surface.

## Verification

- `node --test test/builder-packed-install.test.js` — 13/13 pass.
- `node --test test/builder-doctor.test.js test/builder-package-security.test.js test/artifact-surface-coverage.test.js` — 42/42 pass.
- `npm run check` — 654/654 pass.
- `git diff --check` — pass.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- BLDR-02 and BLDR-05 now have exact packed-closure, hostile-syntax, retained-path, safe-metadata, immutable-chain, and zero-write diagnostic coverage.
- No implementation blocker remains. Shared planning state, release records, and commits intentionally remain untouched for the parent orchestrator/user.

## Self-Check: PASSED

- Summary and all listed implementation/test files exist.
- Required focused, packed integration, full repository, and whitespace verification commands passed.
- Commit verification is not applicable because commits were explicitly prohibited.

---
*Phase: 02-codex-builder*
*Completed: 2026-07-20*
