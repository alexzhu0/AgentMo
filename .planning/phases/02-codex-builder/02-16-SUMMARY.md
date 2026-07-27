---
phase: 02-codex-builder
plan: "16"
subsystem: codex-uat-continuation
tags: [codex, uat, packed-runtime, uninstall, immutable-journal, candidate, verifier-binding]

requires:
  - phase: 02-codex-builder
    plan: "15"
    provides: Sole immutable UAT journal, fixed eleven-scenario reducer, acyclic candidate leaf, and closed CLI authority
  - phase: 02-codex-builder
    plan: "14"
    provides: Exact packed runtime inventory, lifecycle receipts, stable user-owned projection, and I/O ownership inventory
provides:
  - Exact packed public pre-uninstall continuation from scenario 10 through candidate-ready
  - Manifest-bound package, release, tarball, continuation, and verifier identity preflight before mutation
  - Leaf-first candidate publication with exact inert-orphan recovery and double-publication rejection
  - Ephemeral synthetic packed-fixture proof across uninstall with complete fixture cleanup
affects: [codex-builder, codex-uat, builder-package, builder-lifecycle, packed-runtime, phase-02-plan-17]

tech-stack:
  added: []
  patterns:
    - Preload exact packed code and retain admitted filesystem handles before destructive lifecycle mutation
    - One-way leaf-first publication followed by immutable journal reference
    - Recovery only from an exact scenarios-complete head plus one matching inert orphan leaf
    - Synthetic packed release fixtures that independently bind identities and delete all bytes in finally cleanup

key-files:
  created:
    - src/builder-codex-uat-continuation.js
    - .planning/phases/02-codex-builder/02-16-SUMMARY.md
  modified:
    - src/builder-codex-uat.js
    - src/cli.js
    - src/builder-package.js
    - test/builder-codex-uat.test.js
    - test/builder-cli.test.js
    - test/builder-packed-install.test.js
    - test/artifact-surface-coverage.test.js
    - test/helpers/io-surface-inventory.js

key-decisions:
  - "The continuation checks every supplied successor and verifier identity and opens all required attempt, evidence, receipt, entrypoint, and preservation handles before exact uninstall mutation."
  - "Project-owned agent entry and current receipt are removed, while the user-owned stable marketplace runtime is identity-checked and preserved across project uninstall."
  - "The candidate leaf remains head-independent and non-authoritative; candidate-ready is the sole later one-way journal reference to its digest."
  - "Restart recovery is legal only from scenarios-complete with one exact matching orphan leaf; a missing scenario-11 observation can never be reconstructed after removal."
  - "The continuation compares the manifest-bound verifier digest but never imports or executes verifier code; actual release construction and human verifier admission remain Plan 02-17."

patterns-established:
  - "Destructive-boundary continuity: preload code, exact-admit identities and handles, discard caller authority, mutate once, then observe through retained authority."
  - "Crash-safe candidate handoff: durable content-addressed leaf first, immutable ready reference second, exact orphan reuse at most once."
  - "Mechanism-only packed proof: fixed synthetic identities and aggressive cleanup cannot be mistaken for UAT, upgrade, live-host, or release evidence."

requirements-completed: [BLDR-01, BLDR-06, BLDR-07]

coverage:
  - id: D1
    description: "The statically packed public continuation exact-admits successor, manifest, tarball, loaded continuation, and verifier identities before applying the approved uninstall."
    requirement: BLDR-01
    verification:
      - kind: integration
        ref: "test/builder-packed-install.test.js#crosses final uninstall only through an ephemeral synthetic packed continuation"
        status: pass
      - kind: unit
        ref: "test/builder-cli.test.js#exposes only the exact packed continuation argument surface with bounded failures"
        status: pass
    human_judgment: false
  - id: D2
    description: "One prestarted packed process preserves admitted runtime and attempt authority across exact project uninstall, observes removal, and appends scenario 11 without recalling deleted assets."
    requirement: BLDR-06
    verification:
      - kind: integration
        ref: "test/builder-packed-install.test.js#crosses final uninstall only through an ephemeral synthetic packed continuation"
        status: pass
    human_judgment: false
  - id: D3
    description: "Candidate bytes publish before candidate-ready, contain no reverse journal edge, recover exactly once as an inert orphan, and retain every broader certification flag as false."
    requirement: BLDR-07
    verification:
      - kind: unit
        ref: "test/builder-codex-uat.test.js#publishes an acyclic candidate leaf before candidate-ready and allows one exact human decision"
        status: pass
      - kind: unit
        ref: "test/builder-codex-uat.test.js#re-admits only the exact durable orphan candidate without publishing a replacement"
        status: pass
      - kind: integration
        ref: "test/builder-packed-install.test.js#crosses final uninstall only through an ephemeral synthetic packed continuation"
        status: pass
    human_judgment: false

duration: 43m
completed: 2026-07-20
status: complete
---

# Phase 02 Plan 16: Packed Pre-Uninstall Continuation Summary

**A statically packed continuation now carries exact admitted authority across project uninstall, records scenario 11, publishes an acyclic candidate leaf, and appends candidate-ready with verifier-bound fail-closed recovery.**

## Performance

- **Duration:** 43m
- **Started:** 2026-07-20T13:53:58Z
- **Completed:** 2026-07-20T14:36:47Z
- **Tasks:** 2
- **Files created/modified:** 10

## Accomplishments

- Added the exact `builder codex-uat continue` command and statically packed continuation module with bounded output and no caller-supplied candidate path, verifier execution, human decision, preview, or arbitrary lifecycle action.
- Bound package name, successor version, release, tarball, continuation, manifest, verifier, attempt head, receipt, project entrypoint, shared runtime, and approved uninstall plan before the first mutation.
- Kept the user-owned stable marketplace runtime intact while the exact project agent and current receipt were removed, then recorded post-removal facts through retained handles without reloading deleted paths.
- Enforced scenario-11 append, content-addressed candidate publication, and candidate-ready in that order, with exact one-time orphan recovery and no recovery path for a lost post-uninstall observation.
- Added a deterministic synthetic successor package and tarball fixture that independently derives all identities, exercises hostile child-process cases, and deletes package, extraction, attempt, and tarball bytes after every case.
- Incrementally re-inventoried all changed production I/O surfaces under Plan 16 without weakening the exact scanner or removing prior rows.

## Task Commits

No commits were created. The parent execution contract explicitly prohibited staging, committing, pushing, or advancing shared planning state.

## Files Created/Modified

- `src/builder-codex-uat-continuation.js` - Packed preflight, retained-handle admission, exact uninstall, post-removal observation, scenario-11 publication, candidate handoff, and sole orphan recovery branch.
- `src/builder-codex-uat.js` - Exact read-only durable orphan candidate re-admission used by recovery.
- `src/cli.js` - Exact continuation route, closed argument parser, bounded output, and public help entry.
- `src/builder-package.js` - Continuation module added to the fixed runtime release asset inventory and closed static import graph.
- `test/builder-codex-uat.test.js` - Acyclic orphan re-admission, tamper, stale, and duplicate candidate regressions.
- `test/builder-cli.test.js` - Exact continuation command surface, required identities, duplicate/unknown argument, candidate-path, and bounded failure coverage.
- `test/builder-packed-install.test.js` - Ephemeral synthetic package/tarball construction, independently checked identities, valid uninstall progression, verifier mismatch, stale/restart/recall/orphan/double-publication cases, and cleanup proof.
- `test/artifact-surface-coverage.test.js` - Exact Plan 16 changed-module inventory and owner assertions while retaining unchanged Plan 15 coverage.
- `test/helpers/io-surface-inventory.js` - Exact continuation/package/CLI I/O rows with preserved gated, diagnostic, non-artifact, transient-runtime, and ephemeral-secret statuses.

## Decisions Made

- The removable project entrypoint is `.codex/agents/agentmo.toml`; the stable marketplace runtime is user-owned shared state and therefore survives a project-only uninstall under exact identity checks.
- All path-based authority required after removal is converted into exact open-handle or preloaded-code authority before uninstall. The post-removal phase never re-imports the removed launcher or re-reads the removed receipt path.
- Verifier identity is a preflight binding only in this plan. The synthetic fixture includes a non-executed verifier byte identity, while real release manifest/verifier construction and human admission remain explicitly deferred to Plan 02-17.
- A scenarios-complete journal without its matching orphan candidate cannot advance. Recovery validates and reuses one deterministic existing leaf rather than publishing a replacement or re-observing removal.
- Candidate ordered evidence binds the eleven scenario entries before candidate-ready; the ready entry is not allowed to feed backward into candidate bytes or their digest.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Normalized Darwin private-path aliases during exact project admission**
- **Found during:** Task 2 synthetic packed lifecycle verification
- **Issue:** macOS may expose `/var` and `/tmp` through `/private/...`, causing byte-equivalent project paths to fail the exact containment check before the intended hostile matrix ran.
- **Fix:** Applied the repository's existing Darwin canonical-path admission pattern without weakening boundary or symlink checks.
- **Files modified:** `src/builder-codex-uat-continuation.js`
- **Verification:** Synthetic packed continuation case and full packed suite pass.
- **Committed in:** Not committed by explicit instruction.

**2. [Rule 1 - Bug] Preserved post-unlink retained-inode verification**
- **Found during:** Task 2 valid uninstall progression
- **Issue:** Lifecycle quarantine can reduce the retained removed receipt inode's link count to zero after exact preflight admitted one link; incorrectly requiring one link after deletion rejected the valid retained handle.
- **Fix:** Kept the strict pre-uninstall single-link admission and exact device/inode/size/uid/mode/mtime/byte checks, while admitting the bounded post-removal zero-link state through the already-open handle.
- **Files modified:** `src/builder-codex-uat-continuation.js`
- **Verification:** Valid scenario-11 progression, deleted-entrypoint behavior, and the complete hostile packed matrix pass.
- **Committed in:** Not committed by explicit instruction.

**3. [Rule 1 - Regression] Restored the existing distinct baseline/successor package identity contract**
- **Found during:** Full repository verification
- **Issue:** An intermediate fixture simplification inverted the existing attempt-started package-name invariant and caused two hook-bridge plus two behavior-evaluation regressions.
- **Fix:** Restored the established distinct package-name rule and kept fixed synthetic baseline/successor identities in this plan's authorized fixtures.
- **Files modified:** `src/builder-codex-uat.js`, `test/builder-codex-uat.test.js`, `test/builder-cli.test.js`, `test/builder-packed-install.test.js`
- **Verification:** Affected regression set 31/31, Plan 16 combined gate 48/48, and full repository 656/656.
- **Committed in:** Not committed by explicit instruction.

---

**Total deviations:** 3 auto-fixed (3 Rule 1)
**Impact on plan:** All fixes preserve or tighten existing path, inode, and release-identity authority; no new feature or certification claim was added.

## Issues Encountered

- The first full repository run exposed four regressions from the temporary package-name invariant inversion. The invariant was restored without editing either out-of-plan failing test file, and the full gate then passed 656/656.

## TDD Gate Compliance

- RED continuation, orphan, verifier-mismatch, argument-surface, and synthetic packed lifecycle tests were observed failing before their implementation slices; the final GREEN suites pass.
- Separate RED/GREEN commits were intentionally not created because the parent execution contract prohibited every commit.

## Known Stubs

None. No TODO, FIXME, placeholder, mock-only data path, or goal-blocking unwired surface exists. The real successor release manifest and standalone human verifier are intentionally absent under the plan boundary and remain Plan 02-17 deliverables; the Plan 16 synthetic copies are fixture-only and are deleted after each test.

## Verification

- `node --test test/builder-hook-bridge.test.js test/codex-builder-behavior.test.js test/builder-codex-uat.test.js test/builder-cli.test.js` - 31/31 pass after regression repair.
- `node --test test/builder-packed-install.test.js test/artifact-surface-coverage.test.js test/builder-codex-uat.test.js test/builder-cli.test.js` - 48/48 pass.
- `npm run check` - 656/656 pass across 70 suites; 0 failed, skipped, or todo.
- `git diff --check` - pass.
- Production `src/builder-codex-uat-release-manifest.json` and `src/builder-codex-uat-verifier.js` remain absent as required; fixture cleanup assertions pass.

## Threat Review

- All new file access, destructive lifecycle, identity, candidate-publication, replay, denial-of-service, and disclosure surfaces are the planned T-02-16 trust boundaries and implement their registered mitigations.
- Continuation output remains bounded to status and identity facts; it emits no paths, payloads, transcripts, environment values, credentials, or certification claims.
- No unplanned endpoint, authentication path, schema trust boundary, or file-access authority was introduced, so no additional threat flag is required.

## User Setup Required

None - no external service configuration, secret handling, or real UAT artifact is required.

## Next Phase Readiness

- Plan 02-17 can now supply the real release manifest and separately extracted human verifier against a packed continuation contract already proven across uninstall.
- Mechanism coverage remains explicitly non-certifying: real Codex origin, authenticated observation, package/domain quality, production readiness, and wider compatibility all remain false and human-owned.
- No implementation or verification blocker remains. Commits, requirements state, roadmap/state files, README, and release records intentionally remain untouched for the parent orchestrator/user.

## Self-Check: PASSED

- Summary and all nine listed implementation/test files exist.
- The coverage classifier parsed all three deliverables and marked each fully covered by passing automated verification.
- Plan-combined, affected-regression, full repository, whitespace, fixture-cleanup, stub, and planned-threat-surface checks passed.
- Commit verification is not applicable because commits were explicitly prohibited.

---
*Phase: 02-codex-builder*
*Completed: 2026-07-20*
