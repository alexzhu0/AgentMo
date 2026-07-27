---
phase: 02-codex-builder
plan: "08"
subsystem: codex-builder-recovery
tags: [codex-hooks, checkpoint-cas, replay-deduplication, packed-runtime, challenge-observation]
requires:
  - phase: 02-codex-builder
    plan: "07"
    provides: [receipt-bound projected runtime, exact shared-state lifecycle, fixed Codex plugin registration]
provides:
  - durable Codex delivery identity with restart replay and compaction epochs
  - installed runner-to-local-launcher-to-checkpoint-CAS recovery chain
  - digest-only challenge observation interface for final Codex UAT
  - packed and syntax-checked bridge closure
affects: [02-09-behavior-evidence, 02-10-clean-host-uat, codex-builder-recovery]
tech-stack:
  added: []
  patterns: [fixed adjacent launcher, receipt-backed runtime admission, durable delivery cursor, challenge-bound digest-only observation]
key-files:
  created:
    - src/builder-hook-bridge.js
    - test/builder-hook-bridge.test.js
    - .planning/phases/02-codex-builder/02-08-SUMMARY.md
    - release/2026.07.17.md
  modified:
    - src/builder-checkpoint.js
    - src/builder-events.js
    - src/builder-package.js
    - src/cli.js
    - plugin/hooks/agentmo-hook.js
    - src/builder-behavior-eval.js
    - package.json
    - test/builder-packed-install.test.js
    - test/builder-package-security.test.js
    - test/helpers/io-surface-inventory.js
    - test/artifact-surface-coverage.test.js
    - README.md
key-decisions:
  - "Only exact hook_event_name plus a bounded session_id enters delivery identity; payload workflow, stage, approval, path and transcript fields have no authority."
  - "Replay identity lives in checkpoint v2 under CAS; a completed Pre/Post pair advances the next same-session compaction to a new deterministic epoch."
  - "The installed runner uses process.execPath, a fixed adjacent launcher, a minimal child environment, a 64 KiB input bound, a 16 KiB output bound and a two-second timeout."
  - "The internal bridge route is absent from public help and derives project, receipt, release, runner and checkpoint solely from the projected runtime layout."
  - "A default module root with an external receipt digest is forced through projected admission when it has the exact installed runtime suffix; a runtime-local plugin decoy cannot reclassify it as self-contained."
  - "Challenge observations retain only runner/release/receipt/event/before/after digests and count; they cannot certify host trust or domain quality."
patterns-established:
  - "Installed hook admission: fixed runner -> adjacent launcher -> projected release/receipt/scope admission -> checkpoint admission -> canonical reducer -> expected-previous-digest CAS."
  - "Delivery replay: reconstruct the original event identity, sequence and digest from durable cursor state and return a byte-preserving no-op."
  - "Hook output: PreCompact emits only an empty object; applied SessionStart/PostCompact emit one bounded proposal; duplicate and failure paths expose no payload or child diagnostics."
requirements-completed: []
requirements-progressed: [BLDR-04, BLDR-07]
requirements-pending: [BLDR-01, BLDR-07]
coverage:
  - id: D1
    description: "Checkpoint v2 durably distinguishes replay from a second legal same-session compaction without changing workflow authority."
    requirement: BLDR-04
    verification:
      - kind: unit
        ref: "test/builder-hook-bridge.test.js#Builder installed hook bridge"
        status: pass
      - kind: unit
        ref: "test/builder-hook-bridge.test.js#normalizes a cursor-proven SessionStart replay after bounded-ledger eviction"
        status: pass
    human_judgment: false
  - id: D2
    description: "Projected packed hooks traverse the fixed runner, adjacent launcher, admitted bridge, canonical reducer and checkpoint CAS."
    requirement: BLDR-07
    verification:
      - kind: integration
        ref: "test/builder-packed-install.test.js#traverses registered packed hooks through the adjacent launcher, bridge, reducer, and checkpoint CAS"
        status: pass
      - kind: integration
        ref: "test/builder-packed-install.test.js#rejects a decoy runtime-local plugin and tampered receipt without changing the checkpoint"
        status: pass
    human_judgment: true
    rationale: "The packed integration proves bounded mechanism execution; authenticated normal-trust Codex delivery and challenge consumption remain Plans 02-09/02-10 UAT."
  - id: D3
    description: "The final challenge slot records one exact digest-only observation only through an applied matching installed delivery."
    requirement: BLDR-07
    verification:
      - kind: unit
        ref: "test/builder-hook-bridge.test.js#arms challenges only through checkpoint CAS and records one digest-only installed observation"
        status: pass
    human_judgment: false
  - id: D4
    description: "The bridge is present in the fixed release inventory, syntax-check chain and fresh packed import closure."
    requirement: BLDR-04
    verification:
      - kind: integration
        ref: "test/builder-packed-install.test.js#admits one deterministic fixed runtime inventory and its complete packed import closure"
        status: pass
    human_judgment: false
duration: multi-pass TDD and full-suite compatibility closure
completed: 2026-07-17
status: complete
---

# Phase 2 Plan 08: Installed Codex Hook Recovery Summary

**Installed Codex hooks now reach one receipt-bound local runtime, canonical Builder reducer and durable checkpoint CAS with exact replay and compaction-epoch identity.**

## Performance

- **Duration:** Multi-pass TDD plus full-suite compatibility and evidence finalization
- **Started:** 2026-07-17
- **Completed:** 2026-07-17
- **Tasks:** 3
- **Files created or modified:** 16 implementation, test, surface-contract and documentation files

## Accomplishments

- Added checkpoint v2 delivery cursor state that reconstructs duplicate SessionStart, PreCompact and PostCompact events after reload, while assigning a distinct deterministic epoch to each later legal compaction pair.
- Added a canonical bridge that strips host input to exact event/session/source identity, preserves workflow authority, invokes the existing hook-only reducer and publishes only through expected-previous-digest CAS.
- Added the final value-blind UAT challenge slot. A matching applied installed delivery records runner, release, receipt, event, before-checkpoint and reduced-after-checkpoint digests plus count one; direct reducer calls, wrong challenges, wrong scenarios and replays cannot satisfy it.
- Replaced the static hook reminder with a bounded runner that invokes the fixed adjacent launcher through `process.execPath`, strips the child environment, caps input/output/time and suppresses all child failure detail.
- Added a private internal CLI route that admits the projected project scope, receipt, full release, runner bytes and checkpoint before event construction. It is not advertised as a public command.
- Added the bridge to the canonical runtime inventory, release digest, package syntax checks and fresh packed import closure.
- Proved the complete projected chain from exact `hooks.json` registration through installed runner, local launcher, bridge, reducer and CAS, including challenge observation, non-trigger no-spawn, Pre/Post handling and replay no-write behavior.
- Closed an independently reproduced receipt-admission bypass: an added `runtime/agentmo/plugin` directory can no longer make the installed projected module ignore its supplied external receipt digest; rejection leaves the checkpoint byte-identical.
- Preserved durable replay beyond the bounded 64-event ledger: a cursor- and digest-proven SessionStart replay is normalized to `duplicate` after eviction while generic non-replay stale events remain stale and fail closed at the installed boundary.
- Updated the user-facing lifecycle description so it reflects the installed bridge while keeping BLDR-01/BLDR-07 pending on formal authenticated UAT rather than the now-closed wiring gap.

## TDD Evidence

- **Task 1 RED:** `node --test test/builder-hook-bridge.test.js` failed 1/1 with `ERR_MODULE_NOT_FOUND` for the not-yet-created bridge.
- **Task 1 GREEN:** the initial bridge suite passed 8/8; checkpoint and legacy hook regressions passed 15/15.
- **Task 2 RED:** the packed suite passed 7/10 and failed exact inventory count, missing-bridge rejection and install-operation count.
- **Task 2 GREEN:** the packed suite passed 10/10 after the bridge entered inventory, syntax and import closure.
- **Task 3 RED:** the combined bridge/packed gate passed 18/21; the old static runner did not launch the adjacent runtime, still accepted aliases and did not mutate the packed checkpoint.
- **Task 3 GREEN:** `node --test test/builder-hook-bridge.test.js test/builder-packed-install.test.js` passes 21/21.
- **Full-suite compatibility RED/GREEN:** the new fail-closed runner exposed the earlier synthetic evaluator's static-output assumption. Its admitted runner now executes in a transient fixed-adjacent synthetic harness, remains explicitly mechanism-only, and `test/codex-builder-behavior.test.js` passes 3/3 without mutating the installed project.
- **Independent-review RED/GREEN:** `node --test test/builder-package-security.test.js` first passed 7/8 with one missing expected rejection, then passed 8/8 after projected layout routing was bound to the exact installed runtime suffix. The combined package/bridge/packed gate passes 30/30, and lifecycle/host/install-security regressions pass 75/75.
- **Bounded-ledger replay RED/GREEN:** the bridge suite first passed 10/11 when a SessionStart replay after 32 legal Pre/Post pairs returned `stale`; it then passed 11/11 after cursor-proven, digest-matching stale replay was normalized to `duplicate` without changing checkpoint bytes, inode or mtime. Generic reducer/CLI tests remain 14/14 with ordinary evicted events still stale.

## Final Verification

- `node --test test/builder-hook-bridge.test.js test/builder-packed-install.test.js` — **PASS, 23/23**.
- `node --test test/builder-package-security.test.js test/builder-hook-bridge.test.js test/builder-packed-install.test.js` — **PASS, 31/31**.
- `node --test test/builder-hook.test.js test/builder-cli.test.js` — **PASS, 14/14**.
- `node --test test/builder-lifecycle.test.js test/builder-codex-host.test.js test/builder-install-security.test.js` — **PASS, 75/75**.
- `node --test test/codex-builder-behavior.test.js` — **PASS, 3/3**.
- `node --test test/artifact-surface-coverage.test.js` — **PASS, 10/10**.
- `npm run check` — **PASS, 605/605 across 65 suites**.
- `npm pack --dry-run --json --cache /tmp/agentmo-npm-cache-02-08-final-readme` — **PASS, 60 entries**, shasum `7fd77eb0573bc5c15f76f17619ccd0bb429fdbcb`, integrity `sha512-KJ2ClGrKQp5MS72iiAREuJFrpqw9nrViHZdIE/yFmVv2CiDdrdwuDi2kjnnxxac6dve5ob1DEyOB6dVr0M2UYQ==`.
- `git diff --check` — **PASS**.

## Decisions Made

- Kept hook workflow mutation inside the existing `reduceBuilderHookEvent`; the bridge owns delivery cursor/challenge merge and CAS only.
- Derived project and runtime paths from the installed module/runner location. Payload and environment cannot select a project, launcher, checkpoint or workflow field.
- Required release admission to verify the exact installed runner digest before constructing installed context.
- Returned an empty object for duplicate and PreCompact deliveries, and a bounded proposal only for newly applied SessionStart/PostCompact deliveries.
- Preserved legacy checkpoint v1 exact-byte admission as an in-memory deterministic v2 migration; no delivery or observation state is fabricated and loading does not rewrite bytes.
- Made projected-vs-source intent structural at the receipt boundary: only a default root with the exact installed runtime suffix and an external digest preempts the plugin heuristic; explicit source roots and ordinary packed-source repeat setup remain self-contained.
- Kept the 64-entry generic event ledger bounded: only the bridge's independently durable cursor may turn a digest-matching replay from reducer `stale` into canonical `duplicate`; unrelated old events retain generic stale semantics.

## Deviations from Plan

### Auto-fixed Issues

1. Direct reducer output initially dropped the new delivery/challenge fields. `src/builder-events.js` now carries both fields byte-equivalently so only the installed bridge can populate observations.
2. New CLI positions and transient behavior-harness surfaces shifted the repository's exact I/O inventory. Plan 02-08 ownership rows and all moved line identities were synchronized without broadening discovery rules.
3. The earlier mechanism-only behavior evaluator expected the old static runner to succeed without a checkpoint. It now exercises the admitted runner against a transient fixed-adjacent synthetic launcher, preserves its non-certifying evidence label, and leaves the installed project unchanged.
4. Independent review reproduced a projected receipt bypass by adding a decoy runtime-local plugin. Layout resolution now forces exact receipt-backed admission for the default installed runtime suffix, with unit and packed runner regressions proving rejection and byte-identical checkpoint preservation.
5. Final verification reproduced a legitimate SessionStart replay failing after its event aged out of the bounded ledger. The bridge now normalizes only cursor-proven, digest-matching replay to `duplicate`, with a 65-event regression proving write-free bytes, inode and mtime preservation.

**Total deviations:** 5 compatibility, repository-contract and trust-boundary fixes. None expands product authority or evidence claims.

## Evidence Boundary

This plan proves deterministic packed mechanism execution only. It does not prove that an authenticated Codex host installed, trusted or invoked the plugin; it does not certify Agent Package quality, domain behavior, production readiness, deployment approval or wider Codex compatibility. BLDR-07 remains pending until challenge-bound fresh-session UAT, and BLDR-01 remains pending until authenticated normal-trust clean-host admission.

## Commits

None — the user did not authorize staging or commits.

## User Setup Required

None for this plan. Codex trust and final clean-host UAT remain explicitly human-owned.

## Next Phase Readiness

Plan 02-09 can consume the frozen challenge/observation interface without changing the bridge. Plan 02-10 can then evaluate authenticated normal-trust clean-host support. This summary does not mark Phase 2, BLDR-01 or BLDR-07 complete.

---
*Phase: 02-codex-builder*
*Completed: 2026-07-17*
