---
phase: 04-package
plan: "01"
subsystem: package-contract
tags: [package-manifest, capability-ledger, openclaw, fail-closed, deterministic-inventory]
requires:
  - phase: 03-build-contract
    provides: Exact-approved OpenClaw 2026.6.11/29d018f0 build contract and Produce-entry approval boundary
provides:
  - Closed target-neutral agentmo.package-manifest.v1 validator
  - D-42 canonical member inventory and exact observed-member closure
  - Lowest-trust carrier selection with no speculative MCP
  - Stable blocker for the current unowned four-hook Phase 3 contract
affects: [04-02-target-admission, 04-03-package-produce, 04-04-package-inspect]
tech-stack:
  added: []
  patterns:
    - Closed hand-written ESM validators over canonical persistable JSON
    - Recipe authority precedes recipe-to-byte materialization
    - Current approved intent fails closed instead of being repaired downstream
key-files:
  created:
    - src/package-contract.js
    - src/package-carriers.js
    - test/package-contract.test.js
    - test/package-carriers.test.js
    - test/phase4-contracts.test.js
    - release/2026.07.29.md
    - .planning/phases/04-package/deferred-items.md
  modified:
    - release/README.md
key-decisions:
  - "The current exact Phase 3 contract is rejected with AGENTMO_PACKAGE_HOOK_OWNER_UNAPPROVED because bundled ownership cannot be inferred."
  - "A future successor can pass only from exact Phase 3-reapproved package-local recipe bytes and all four exact hook mappings; pre-existing implementation paths are forbidden."
  - "Phase 4 v1 emits no MCP carrier because the approved resource graph has no external executable tool."
patterns-established:
  - "D-42 inventory closure: portable file path + regular-file type + fixed mode + byte length + per-member SHA-256 + canonical inventory digest."
  - "Carrier trust order: workspace-content/skill before native-plugin; MCP only for a separately approved external executable need."
requirements-completed: [PACK-01, PACK-02, PACK-03, PACK-04, EVID-05]
coverage:
  - id: D1
    description: "Target-neutral package manifest, capability ledger, ownership, evidence boundary, and D-42 inventory reject drift and declaration-only resources."
    requirement: PACK-01
    verification:
      - kind: unit
        ref: "test/package-contract.test.js#canonical Agent Package contract"
        status: pass
      - kind: integration
        ref: "node --test test/build-contract.test.js test/openclaw-resource-projection.test.js test/package-contract.test.js test/package-carriers.test.js test/phase4-contracts.test.js"
        status: pass
    human_judgment: false
  - id: D2
    description: "Carrier selection assigns lower-trust content and skill lanes, rejects speculative MCP, and requires an exact recipe for native typed hooks."
    requirement: PACK-04
    verification:
      - kind: unit
        ref: "test/package-carriers.test.js#lowest-trust package carrier selection"
        status: pass
    human_judgment: false
  - id: D3
    description: "The current approved OpenClaw 2026.6.11/29d018f0 contract fails closed for all four abstract hooks without promoting package evidence."
    requirement: EVID-05
    verification:
      - kind: integration
        ref: "test/phase4-contracts.test.js#Phase 4 starts fail-closed and cannot promote package evidence into runtime or domain proof"
        status: pass
    human_judgment: false
duration: 22min
completed: 2026-07-29
status: complete
---

# Phase 4 Plan 1: Fail-Closed Package and Carrier Contract Summary

**Target-neutral package validation with D-42 byte inventory and a stable OpenClaw hook-owner blocker before any Produce output**

## Performance

- **Duration:** 22 min
- **Started:** 2026-07-29T06:54:47Z
- **Completed:** 2026-07-29T07:16:07Z
- **Tasks:** 2
- **Files modified:** 9 including this summary

## Accomplishments

- Added a closed `agentmo.package-manifest.v1` model covering exact Plan bindings, target compatibility, capability ownership, permissions, evidence references, remaining risks, and non-transitive certification fields.
- Added a canonical D-42 member inventory with portable normalized paths, regular-file-only type, fixed `0644`/`0755` modes, byte lengths, per-member SHA-256, canonical inventory digest, exact observed-member equality, and case/Unicode collision rejection.
- Added deterministic carrier selection that keeps declarative resources in workspace/content or skill lanes, emits no speculative MCP, and uses native plugin only for exact Phase 3-reapproved typed-hook recipe authority.
- The current approved Phase 3 contract reproducibly stops with `AGENTMO_PACKAGE_HOOK_OWNER_UNAPPROVED` for `before-attempt`, `after-tool`, `before-checkpoint`, and `after-attempt`.
- A future successor must bind the exact OpenClaw mappings `before_agent_run`, `after_tool_call`, `before_compaction`, and `agent_end`, plus owner, version, permission, timeout, failure, unsupported behavior, and canonical recipe bytes.

## RED → GREEN Evidence

- **RED:** `! node --test test/package-contract.test.js test/package-carriers.test.js test/phase4-contracts.test.js`
  - The underlying `node --test` process exited 1 because `src/package-contract.js` and `src/package-carriers.js` did not exist.
  - The plan's negated shell assertion exited 0, proving the intended pre-implementation failure.
- **GREEN:** `node --test test/package-contract.test.js test/package-carriers.test.js test/phase4-contracts.test.js`
  - Exit 0; 10 passed, 0 failed, 0 cancelled, 0 skipped.
- **Adjacent focused verification:** `node --test test/build-contract.test.js test/openclaw-resource-projection.test.js test/package-contract.test.js test/package-carriers.test.js test/phase4-contracts.test.js`
  - Exit 0; 16 passed, 0 failed, 0 cancelled, 0 skipped.
- **REFACTOR:** No separate behavior-free refactor was needed after the minimal implementation.

## Task Commits

No commits were created because `AGENTS.md` requires explicit user authorization and the execution assignment explicitly prohibited staging or committing.

1. **Task 1: Write the failing package and carrier contracts** — `not-created — user authorization required`
2. **Task 2: Implement the canonical validators and blocker** — `not-created — user authorization required`
3. **Plan metadata** — `not-created — user authorization required`

## Files Created/Modified

- `src/package-contract.js` — closed manifest, ledger, member inventory, ownership, persistability, and evidence-boundary validators.
- `src/package-carriers.js` — stable current-contract blocker, canonical recipe/mapping checks, and deterministic lowest-trust carrier selection.
- `test/package-contract.test.js` — contract, declaration-only, lifecycle-promotion, sensitive-data, MCP, and D-42 drift matrix.
- `test/package-carriers.test.js` — current blocker, future recipe, four-hook mapping, escalation, and resource-set matrix.
- `test/phase4-contracts.test.js` — incremental Phase 4 authority and non-certification gate.
- `release/2026.07.29.md` — bounded mechanism evidence and remaining blocker record required by `AGENTS.md`.
- `release/README.md` — newest-first release index entry.
- `.planning/phases/04-package/deferred-items.md` — out-of-scope full-aggregate observation.

## Decisions Made

- Current `bundled` selection is not owner evidence. The gate never infers an owner from OpenClaw availability or a caller-provided success flag.
- A package-local native plugin is accepted only as future exact Phase 3 contract authority over sorted portable recipe members and canonical content digests. Plan 04-01 does not read or require a pre-existing plugin implementation.
- Manifest semantics stay target-neutral; the OpenClaw event mapping is an explicit target mapping inside the capability ledger, not the canonical identity authority.
- MCP is rejected for this approved graph instead of being emitted unused.

## Deviations from Plan

### Policy-Required Adjustments

**1. [AGENTS.md / execution constraint] No task or metadata commits**

- **Found during:** executor startup
- **Issue:** The generic GSD executor protocol normally creates task commits.
- **Adjustment:** Per repository policy and the explicit parent assignment, no `git add`, commit, push, stash, reset, checkout, or branch operation was performed.
- **Verification:** `git status --short` shows the files remain local and unstaged.
- **Commit:** `not-created — user authorization required`

**2. [Rule 2 - Missing Critical] Added release evidence record**

- **Found during:** completion review
- **Issue:** `AGENTS.md` requires a date-based release record for package/schema/Produce-gate semantic changes.
- **Fix:** Added `release/2026.07.29.md` and indexed it in `release/README.md` without raw logs, secrets, or certification overclaim.
- **Verification:** whitespace checks passed.
- **Commit:** `not-created — user authorization required`

**3. [Rule 2 - Missing Critical] Added canonical inventory digest**

- **Found during:** Task 2 implementation review
- **Issue:** Per-member descriptors alone cannot make isolated descriptor drift self-evident without an outer closure digest.
- **Fix:** Added `inventoryDigest`, recomputed from canonical persistable inventory bytes, and validated it before downstream use.
- **Files modified:** `src/package-contract.js`, `test/package-contract.test.js`, `test/phase4-contracts.test.js`
- **Verification:** independent path/type/mode/length/digest and complete-set mutations are rejected.
- **Commit:** `not-created — user authorization required`

**Total deviations:** 3 policy/correctness adjustments; no scope expansion into package generation, target mutation, or Phase 5 behavior.

## Issues Encountered

- `npm run check` was run as required but did not complete green. Under stall surveillance it was explicitly interrupted after the long packed matrix stopped producing output. Its final interrupted report was 792 passed, 1 failed, 2 cancelled, and 1 skipped.
- The reported assertion failure was `test/codex-builder-behavior.test.js` → `bounds an escaped stdout-holding PATH-shadow probe`, outside all Plan 04-01 files. `test/builder-packed-install.test.js` retained pending work at interruption and is inconclusive.
- The exact observation is recorded in `.planning/phases/04-package/deferred-items.md`; it was not auto-fixed and is not represented as a passing full aggregate.

## Verification

- New source and test `node --check`: exit 0.
- Plan 04-01 focused gate: 10/10, exit 0.
- Phase 3/4 adjacent focused gate: 16/16, exit 0.
- `git diff --check`: exit 0.
- Untracked-file `git diff --no-index --check` checks: exit 0 under the explicit no-difference-exit normalization.
- No `.env`, live OpenClaw state, credential, sibling repository, network endpoint, or external process mutation was used.

## Known Stubs

None. Empty/null values found by the stub scan are validator accumulators, explicit declarative non-applicable fields, or hostile test mutations; no production rendering or data source remains unwired.

## Threat Review

- **T-04-01:** portable path, type, fixed mode, length, digest, inventory digest, exact member set, and case/Unicode collision checks are implemented.
- **T-04-02:** unowned bundled hooks, incomplete recipe/mapping authority, pre-existing implementation paths, speculative MCP, and resource-set drift fail closed.
- **T-04-03:** both manifest and carrier results pass the shared value-blind persistability gate.
- **T-04-04:** install, runtime, domain, and production promotion fields are fixed to false.
- No new network endpoint, authentication route, filesystem writer, schema-at-trust-boundary mutation, or OpenClaw target mutation was introduced.

## User Setup Required

None.

## Next Phase Readiness

- Plan 04-02 can consume the stable owner blocker and canonical recipe contract.
- Package generation remains intentionally blocked until Phase 3 reapproves the full package-local native-plugin recipe and exact hook mappings, followed by separate target/carrier admission.
- Plan 04-03 remains the first authority allowed to materialize plugin bytes from that recipe.

## Self-Check: PASSED

- All five plan source/test artifacts exist.
- Release evidence and deferred aggregate record exist.
- Focused GREEN and adjacent focused verification both exited 0.
- No required commit hash exists because commit authorization was explicitly withheld; each commit slot is recorded as `not-created — user authorization required`.

---
*Phase: 04-package*
*Completed: 2026-07-29*
