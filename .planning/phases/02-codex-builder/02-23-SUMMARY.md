---
phase: 02-codex-builder
plan: "23"
subsystem: repository-private-uat-authority
tags: [codex, retained-handles, nofollow, immutable-journal, private-authority, io-inventory]

requires:
  - phase: 02-codex-builder/02-22
    provides: repository-private Codex UAT continuation contract and preserved failed-attempt facts
provides:
  - retained-handle preflight for the exact known two-entry failed attempt
  - value-blind prior-preflight receipt and immutable continuation authority
  - exact Plan 18-23 I/O ownership with negative product-boundary enforcement
affects: [02-24-aggregate-recheck, codex-builder-uat, artifact-surface-inventory]

tech-stack:
  added: []
  patterns: [retained no-follow handles, absent-only O_EXCL publication, closed value-blind schemas, immutable continuation transitions]

key-files:
  created:
    - src/builder-codex-uat-private-authority.js
    - scripts/preflight-codex-uat-prior-attempt.js
    - test/builder-codex-uat-prior-attempt.test.js
  modified:
    - test/helpers/io-surface-inventory.js
    - test/artifact-surface-coverage.test.js
    - package.json

key-decisions:
  - "Keep prior-attempt authority repository-private: stdin/in-process locator only, fixed private root, and no public CLI, plugin, manifest, or packed-runtime reachability."
  - "Retain the journal directory and both no-follow file handles across both semantic loads and read-only diagnosis, then prove stable identities and raw digests before publishing evidence."
  - "Use absent-only 0600 receipt/continuation files beneath an exactly admitted current-uid 0700 authority root, with immutable successor transitions and stale-head rejection."
  - "Canonically re-own the exact Phase 02 Plan 18-23 I/O closure instead of carrying stale scanner line IDs forward."

patterns-established:
  - "Private authority: exact retained-handle evidence precedes creation of any repository-private authority artifact."
  - "Value-blind evidence: durable schemas contain only bounded identities, digests, states, and error codes—not locators, paths, journal bytes, transcripts, payloads, or environment values."

requirements-completed: [BLDR-04, BLDR-05, BLDR-07]

coverage:
  - id: D1
    description: "Exact two-entry prior-attempt preflight retains no-follow handles across semantic loading and read-only diagnosis."
    requirement: BLDR-04
    verification:
      - kind: integration
        ref: "test/builder-codex-uat-prior-attempt.test.js#preflights an exact synthetic two-entry terminal and publishes closed private authority"
        status: pass
    human_judgment: false
  - id: D2
    description: "Prior receipt and continuation authority fail closed for unsafe metadata, drift, stale heads, illegal transitions, and duplicate publication."
    requirement: BLDR-05
    verification:
      - kind: integration
        ref: "test/builder-codex-uat-prior-attempt.test.js#rejects malformed locators, unsafe metadata, stale continuation, and duplicate publication without disclosure"
        status: pass
    human_judgment: false
  - id: D3
    description: "Repository-private authority has exact I/O ownership and remains absent from package, public CLI, plugin, manifest, and runtime closure."
    requirement: BLDR-07
    verification:
      - kind: integration
        ref: "test/artifact-surface-coverage.test.js#keeps the Plan 23 private authority outside package, public CLI, plugin, and runtime closure"
        status: pass
      - kind: integration
        ref: "node --test test/builder-package-security.test.js test/builder-packed-install.test.js"
        status: pass
    human_judgment: false

duration: 52min
completed: 2026-07-21
status: complete
---

# Phase 02 Plan 23: Repository-Private Prior-Attempt Preflight Summary

**Retained no-follow journal evidence now gates a value-blind, fixed-root private receipt and immutable continuation authority without exposing the real locator or entering the Builder product surface.**

## Performance

- **Duration:** 52 min
- **Started:** 2026-07-21T08:45:00Z
- **Completed:** 2026-07-21T09:36:50Z
- **Tasks:** 3/3
- **Files modified:** 6

## Accomplishments

- Added a dependency-free repository-private authority that holds the supplied journal directory, base entry, and successor entry through two production journal loads around read-only install diagnosis, then verifies stable identity, raw-byte digest, exact two-entry membership, and the known terminal failure.
- Added a thin stdin-only operator CLI for preflight, prior-receipt admission, continuation initialization/admission, and legal immutable transitions; output and errors remain bounded and value-blind.
- Added synthetic positive and hostile coverage without locating, reading, or mutating the real retained attempt, and reconciled the repository I/O inventory to exact 669 discovered/669 allowlisted surfaces with zero pending rows.
- Enforced the repository/private boundary in tests and package metadata so neither the authority module nor the operator script is packed, publicly routed, installed as plugin content, or reachable from the Builder runtime closure.

## Task Outcomes and Commits

1. **Task 1: Specify the retained preflight and hostile matrix** — complete; RED proved by `ERR_MODULE_NOT_FOUND` before implementation.
2. **Task 2: Implement the single-process no-follow preflight** — complete; production authority and thin fixed-command CLI pass synthetic exact-admission and rejection coverage.
3. **Task 3: Close preflight I/O inventory and artifact boundaries** — complete; exact inventory and negative product-boundary tests pass.

**Commits:** None. The parent executor explicitly prohibited staging or committing in the shared dirty main worktree.

## Files Created/Modified

- `src/builder-codex-uat-private-authority.js` — retained-handle preflight, exact private-root bootstrap, prior-receipt publication/admission, and immutable continuation authority.
- `scripts/preflight-codex-uat-prior-attempt.js` — repository-only stdin CLI that imports the production authority directly.
- `test/builder-codex-uat-prior-attempt.test.js` — synthetic exact terminal plus malformed locator, unsafe metadata, duplicate publication, stale-head, and illegal-transition coverage.
- `test/helpers/io-surface-inventory.js` — canonical exact ownership for the current Plan 18-23 production closure.
- `test/artifact-surface-coverage.test.js` — exact I/O equality plus private/package/public/runtime negative assertions.
- `package.json` — syntax gates for the private files and an explicit package-files negation for the private authority module.

## Retained Preflight and Authority Contract

- The locator is accepted only as a bounded in-process object/Buffer or CLI stdin JSON. Extra argv and locator-bearing environment channels are rejected.
- The preflight admits only an exact two-file journal directory and retains no-follow directory/base/successor handles throughout both `loadCodexUatAttemptJournal` calls and `diagnoseBuilderInstall`.
- Before/after evidence binds stable metadata, raw SHA-256 digests, entry-set digest/count `2`, loader/diagnosis digests, known failure kind/code/head, and `appended:false`.
- Only a complete preflight pass enables fixed-root bootstrap. The authority root is current-uid, no-symlink, mode `0700`; receipts and continuation records are absent-only, no-follow, mode `0600`, file-fsynced and parent-fsynced.
- Continuation transitions require the admitted predecessor/head, publish immutable successors, enforce the closed legal state matrix, and reject stale or replacement state.
- Durable records and process output have no schema slot for the locator, machine-absolute paths, raw journal material, transcripts, payloads, credentials, or environment values.

## I/O and Product-Boundary Reconciliation

- Repository scan: **669 discovered / 669 allowlisted / 0 pending or unclassified**.
- Plan 23 authority module: **30 discovered / 30 allowlisted**, all owned by `phase-02-plan-23`.
- Plan 23 operator script: **3 discovered / 3 allowlisted**, all owned by `phase-02-plan-23`.
- The canonical Plan 18-23 reconciliation replaced stale line-number identities with the exact current scanner result and preserved explicit ownership for verifier, host, installer/CLI, immutable journal, UAT/continuation, and this private authority.
- The two pre-existing inventory failures are closed: discovered and declared surfaces now compare exactly, and the Wave 16-through-Plan-23 ownership assertion passes.
- `npm pack --dry-run --json` confirmed that neither private authority file is present in the packed artifact. Public help/dispatch, plugin assets, packed release manifests, and Builder runtime/import closure also reject them.

## Decisions Made

- Used one production authority module for all root, receipt, and continuation semantics; the script contains no duplicate validator or alternate target selection.
- Allowed an in-process expected-head parameter only for disposable synthetic fixtures. The operator CLI always enforces the fixed known terminal head.
- Revalidated every repository-relative intermediate ancestor for current ownership, no symlink, and non-group/world-writable mode before admitting or creating the fixed authority root.
- Kept this plan non-certifying: passing synthetic and package-boundary tests proves the mechanism only, not real Codex execution, domain quality, or production readiness.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Explicitly excluded the private authority from package expansion**

- **Found during:** Task 3 (product-boundary verification)
- **Issue:** The existing broad `src/` package-files entry would otherwise include the new repository-private authority even though the plan forbids it from becoming product authority.
- **Fix:** Added an explicit negative package-files entry for `src/builder-codex-uat-private-authority.js`; the repository-only script was already outside positive package entries.
- **Files modified:** `package.json`
- **Verification:** `npm pack --dry-run --json` and the focused package/packed tests exclude both private files.
- **Committed in:** None (commits prohibited by parent executor).

**2. [Rule 2 - Missing Critical] Closed intermediate-ancestor admission**

- **Found during:** Task 2 (fixed-root hardening)
- **Issue:** Checking only the final authority root would leave unsafe writable or replaced intermediate repository-relative ancestors insufficiently bound.
- **Fix:** Added exact current-uid, no-symlink, non-group/world-writable admission for each retained intermediate ancestor and reconciled the resulting I/O IDs.
- **Files modified:** `src/builder-codex-uat-private-authority.js`, `test/helpers/io-surface-inventory.js`
- **Verification:** hostile metadata coverage, exact artifact inventory, focused gate, and the final full gate all pass.
- **Committed in:** None (commits prohibited by parent executor).

---

**Total deviations:** 2 auto-fixed (2 Rule 2)
**Impact on plan:** Both changes were required to preserve the planned repository-private and safe-ancestor trust boundaries; no public feature or external authority was added.

## Issues Encountered

- The baseline full gate initially had exactly two artifact-inventory failures caused by stale Plan 18-22 scanner identities. Canonical Plan 18-23 reconciliation removed both failures.
- After intermediate-ancestor hardening shifted exact line IDs, artifact coverage identified one omitted existing `src/cli.js` transient runtime read. Restoring its existing Plan 20 ownership returned discovered and declared sets to exact equality.

## Verification

- TDD RED: `node --test test/builder-codex-uat-prior-attempt.test.js` failed with `ERR_MODULE_NOT_FOUND` before the authority existed.
- Final focused gate: **45 tests / 4 suites / 45 pass / 0 fail / 0 cancelled / 0 skipped / 0 todo**.
- Final repository gate: `npm run check` — **690 tests / 72 suites / 690 pass / 0 fail / 0 cancelled / 0 skipped / 0 todo**.
- Exact inventory: **669 discovered / 669 allowlisted**, including **30/30** authority-module and **3/3** operator-script surfaces.
- Package dry run: both repository-private files absent from the packed file list.
- `git diff --check`: pass.

## Authentication Gates

None.

## Known Stubs

None. The real retained locator is intentionally not embedded or exercised; later operator input is the designed trust boundary, not a code stub.

## User Setup Required

None for this plan. A later repository operator supplies the real retained-attempt locator once through local stdin when executing the actual UAT gate.

## Certification Boundary

This plan proves bounded mechanism behavior against disposable synthetic private repositories. It did not search for, read, disclose, mutate, or append to the real retained attempt; it did not run real Codex UAT, access a network or GitHub, or create `.omx/codex-uat/phase-02-final-retry/` in the repository. The result does not certify domain quality, production readiness, or wider Codex/OpenClaw compatibility.

## Next Phase Readiness

- Plan 02-24 can perform aggregate rechecks against an already-green Plan 23 contract.
- The only remaining real-attempt action is the deliberately separate, single human-supplied stdin locator invocation; no locator discovery or guessed path is authorized.

## Self-Check: PASSED

- All three created files and all three modified files exist.
- Focused and full verification gates pass on the final code.
- Exact I/O discovery equals the allowlist with zero pending rows.
- No task or metadata commits were created, as required by the parent executor.
- No real private authority root or receipt was created during plan execution.

---
*Phase: 02-codex-builder*
*Completed: 2026-07-21*
