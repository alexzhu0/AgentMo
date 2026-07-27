---
phase: 02-codex-builder
plan: "13"
subsystem: builder-host-lifecycle
tags: [codex, marketplace, stable-projection, consumer-ledger, compensation, lifecycle]

requires:
  - phase: 02-codex-builder
    plan: "12"
    provides: Exact retirement, retained recovery, and receipt-owned lifecycle primitives
provides:
  - One stable user-owned agentmo-local marketplace projection shared by exact project consumers
  - Receipt-last compensating activation with fixed marketplace and plugin operations
  - Consumer-only uninstall plus explicit zero-reference removal, rebind, and all-consumer migration
  - Stable projected package, doctor, hook, packed-install, and behavior-evaluation admission
affects: [codex-builder, builder-install, builder-lifecycle, builder-doctor, builder-behavior]

tech-stack:
  added: []
  patterns:
    - Stable user-host projection with project receipts as consumer references
    - Reservation-held exact compensation and retained recovery
    - Fixed adjacent hook launcher with cwd-bound consumer authority

key-files:
  created:
    - .planning/phases/02-codex-builder/02-13-SUMMARY.md
  modified:
    - src/builder-codex-host.js
    - src/builder-install.js
    - src/builder-lifecycle.js
    - src/cli.js
    - src/builder-doctor.js
    - src/builder-package.js
    - src/builder-behavior-eval.js
    - src/builder-hook-bridge.js
    - plugin/hooks/agentmo-hook.js
    - test/builder-codex-host.test.js
    - test/builder-install-security.test.js
    - test/builder-lifecycle.test.js
    - test/builder-cli.test.js
    - test/builder-doctor.test.js
    - test/builder-package-security.test.js
    - test/builder-packed-install.test.js
    - test/codex-builder-behavior.test.js
    - test/builder-hook-bridge.test.js
    - test/artifact-surface-coverage.test.js
    - test/helpers/io-surface-inventory.js

key-decisions:
  - "The only marketplace source is <stateRoot>/marketplace/agentmo-local; no consumer project owns or recreates plugin/runtime bytes."
  - "Activation order is projection, exact observation, marketplace registration, re-observation, plugin add, visibility observation, owner/consumer publication, then project receipt last."
  - "Stable hooks bind the actual canonical delivery cwd to its exact receipt and consumer ledger entry; they never infer a project from module or plugin ancestry."
  - "Transfer is a closed explicit rebind, while release migration requires every admitted consumer and preserves retained recovery authority after mutation begins."

patterns-established:
  - "Shared-host ownership: project lifecycle changes consumer references; a separate zero-reference owner transaction removes shared host state."
  - "Stable runtime admission: receipt, marker, owner, ledger, projected tree, and release assets must agree before execution."
  - "Value-blind failure: host, hook, package, doctor, and behavior errors expose bounded codes without paths or payloads."

requirements-completed: [BLDR-01, BLDR-06]

coverage:
  - id: D1
    description: "A fresh Codex user host activates AgentMo from one exact stable marketplace projection independent of consumer projects."
    requirement: BLDR-01
    verification:
      - kind: integration
        ref: "test/builder-codex-host.test.js#fixed Codex user-host adapter"
        status: pass
      - kind: e2e
        ref: "test/builder-packed-install.test.js#packed Codex Builder setup"
        status: pass
    human_judgment: false
  - id: D2
    description: "Activation compensates exact shared resources at every publication boundary and publishes the project receipt last."
    requirement: BLDR-01
    verification:
      - kind: integration
        ref: "test/builder-install-security.test.js#compensates exact shared resources across every activation publication boundary"
        status: pass
    human_judgment: false
  - id: D3
    description: "Project uninstall is consumer-only; zero-reference removal, stable rebind, and all-consumer migration require distinct exact approvals."
    requirement: BLDR-06
    verification:
      - kind: integration
        ref: "test/builder-codex-host.test.js#explicit all-consumer host projection migration"
        status: pass
      - kind: integration
        ref: "test/builder-codex-host.test.js#explicit zero-reference selector owner removal"
        status: pass
      - kind: unit
        ref: "test/builder-lifecycle.test.js#receipt-owned Builder lifecycle"
        status: pass
    human_judgment: false
  - id: D4
    description: "Stable projected package, doctor, hook, and behavior consumers fail closed for tampered, missing, nested, prefix, or cross-project authority."
    requirement: BLDR-06
    verification:
      - kind: integration
        ref: "test/builder-packed-install.test.js#traverses registered packed hooks through the adjacent launcher"
        status: pass
      - kind: integration
        ref: "test/codex-builder-behavior.test.js#packed fresh-process Builder behavior evaluation"
        status: pass
      - kind: unit
        ref: "test/builder-package-security.test.js#Builder package trust boundaries"
        status: pass
    human_judgment: false

duration: 1h 47m
completed: 2026-07-20
status: complete
---

# Phase 02 Plan 13: Stable Codex User-Host Ownership Summary

**One stable `agentmo-local` marketplace projection now serves exact project consumers through receipt-last activation, consumer-safe lifecycle transactions, and fail-closed runtime admission.**

## Performance

- **Duration:** 1h 47m
- **Started:** 2026-07-20T10:23:50Z
- **Completed:** 2026-07-20T12:10:23Z
- **Tasks:** 3
- **Files modified:** 21

## Accomplishments

- Moved marketplace/plugin/runtime ownership out of projects into one fixed user-state projection with exact registration, source, cwd, owner, ledger, and filesystem identity checks.
- Implemented fixed-order activation and exact compensation across managed-file verification, projection, marketplace, plugin, owner, consumer, and receipt-last boundaries.
- Made uninstall consumer-only and added closed zero-reference owner removal, stable rebind, and atomic all-consumer migration operations.
- Migrated package inspection, doctor, packed hooks, and behavior/UAT evaluation to exact stable-projection authority without restoring a project-local compatibility source.

## Task Commits

No commits were created. The parent execution contract explicitly prohibited staging, committing, pushing, or advancing shared planning state.

## Files Created/Modified

- `src/builder-codex-host.js` - Stable marketplace root, exact host observation/mutation, projection authority, and identity-safe owner/consumer state.
- `src/builder-install.js` - Receipt-last stable activation, seven-boundary failure injection, and exact compensation.
- `src/builder-lifecycle.js` - Consumer-safe uninstall, zero-reference removal, explicit rebind, and all-consumer migration.
- `src/cli.js` - Closed transfer and migration preview/apply commands without arbitrary host command input.
- `src/builder-doctor.js` - Read-only v3 receipt and user-host projection diagnostics.
- `src/builder-package.js` - Receipt-bound stable runtime and release-asset admission.
- `src/builder-behavior-eval.js` - Activated-consumer and exact stable-asset admission for mechanism and connected UAT lanes.
- `src/builder-hook-bridge.js`, `plugin/hooks/agentmo-hook.js` - Canonical cwd-bound delivery through the fixed adjacent stable launcher.
- `test/*.test.js`, `test/helpers/io-surface-inventory.js` - Hostile ownership, compensation, packed runtime, hook, behavior, and exact I/O surface regressions.

## Decisions Made

- Project receipts retain only project-owned marker/agent evidence and exact host-consumer bindings; shared release bytes live exclusively in the stable projection.
- The host must observe the exact registered marketplace twice around registration before plugin activation is eligible.
- A hook's project authority is the canonical delivery cwd proven by its receipt and current ledger entry, never a path derived from the shared plugin or runtime location.
- Once a multi-consumer migration mutates project state, failure retains bounded recovery authority instead of reporting a mixed release as success.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Migrated downstream readers to the stable projection**
- **Found during:** Overall integration after Tasks 1-3
- **Issue:** Doctor, package, packed-install, and behavior evaluation still assumed project-local plugin/runtime bytes, so the new ownership model could not operate end to end.
- **Fix:** Bound these consumers to v3 receipts, exact owner/ledger state, the stable projection, and exact release assets.
- **Files modified:** `src/builder-doctor.js`, `src/builder-package.js`, `src/builder-behavior-eval.js`, and their tests.
- **Verification:** Package 8/8, doctor 14/14, packed 13/13, behavior 5/5.
- **Committed in:** Not committed by explicit instruction.

**2. [Rule 1 - Bug] Removed project discovery from stable hook ancestry**
- **Found during:** Packed hook-chain integration
- **Issue:** The hook runner and bridge inferred a project by walking upward from the shared plugin/runtime, resolving the marketplace root instead of the delivery consumer.
- **Fix:** Use canonical delivery cwd and exact receipt/ledger/project-scope admission while retaining the fixed adjacent launcher and minimal child environment.
- **Files modified:** `plugin/hooks/agentmo-hook.js`, `src/builder-hook-bridge.js`, `test/builder-hook-bridge.test.js`, `test/builder-packed-install.test.js`.
- **Verification:** Nested, prefix-sibling, cross-project, forged-payload, and missing-receipt deliveries fail closed without checkpoint mutation; valid packed hook chain passes.
- **Committed in:** Not committed by explicit instruction.

**3. [Rule 3 - Blocking issue] Reconciled exact repository I/O ownership after authorized downstream changes**
- **Found during:** Full integration verification
- **Issue:** Exact line-addressed I/O inventory became stale after the host, package, doctor, behavior, and install changes.
- **Fix:** Updated the exact allowlist while preserving gated, diagnostic, transient-runtime, and non-artifact classifications.
- **Files modified:** `test/helpers/io-surface-inventory.js`, `test/artifact-surface-coverage.test.js`.
- **Verification:** Artifact/output surface inventory 10/10.
- **Committed in:** Not committed by explicit instruction.

---

**Total deviations:** 3 auto-fixed (1 Rule 1, 1 Rule 2, 1 Rule 3)
**Impact on plan:** All deviations were required to make the stable ownership mechanism executable and fail-closed end to end; no project-local compatibility source or arbitrary host command surface was introduced.

## Issues Encountered

- Production stable package admission initially reused a test-only state-root seam, which the minimal hook child correctly rejected. A read-only canonical projection-binding inspection replaced that seam.
- The packed fake Codex hosts lacked marketplace list/add/remove semantics; they now model the fixed official operation order and exact registered source.

## Known Stubs

None. The scan found normal empty collections and nullable control state, but no goal-blocking placeholder, TODO, mock-only data path, or unwired runtime surface.

## Verification

- `node --test test/builder-codex-host.test.js test/builder-install-security.test.js test/builder-lifecycle.test.js test/builder-cli.test.js test/builder-doctor.test.js test/builder-package-security.test.js test/builder-packed-install.test.js test/codex-builder-behavior.test.js test/builder-hook-bridge.test.js test/builder-hook.test.js test/artifact-surface-coverage.test.js` — 170/170 pass.
- `npm run check` — 644/644 pass.
- `git diff --check` — pass.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- BLDR-01 and BLDR-06 have automated exact-ownership, compensation, hostile-path, and multi-consumer lifecycle coverage.
- No implementation blocker remains. Planning state and commits intentionally remain for the parent orchestrator/user to handle.

## Self-Check: PASSED

- Summary and all listed implementation/test files exist.
- Required verification commands passed.
- Commit verification is not applicable because commits were explicitly prohibited.

---
*Phase: 02-codex-builder*
*Completed: 2026-07-20*
