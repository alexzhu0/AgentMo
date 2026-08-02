---
phase: 04-package
plan: "06"
subsystem: openclaw-install-authority
tags: [openclaw, lifecycle, d42-archive, exact-approval, ownership]
requires:
  - phase: 04-package
    plan: "05"
    provides: Exact archive-bound read-only OpenClaw capability fingerprint
provides:
  - Pure closed lifecycle plans for install, upgrade, explicit rollback, and uninstall
  - Verified absent-genesis and exact receipt/predecessor authority models
  - Independent ordinary, per-sensitive-action, and exact-conflict approval families
affects: [04-07-install-writers, 04-08-install-cli, phase-5-runtime]
tech-stack:
  added: []
  patterns:
    - Complete D-42 archive closure repeated independently in every authority
    - Subject-specific exact decisions with expiry and one-use nonce admission
    - Frozen one-screen review shared by human and JSON semantics
key-files:
  created:
    - src/openclaw-install-plan.js
    - src/openclaw-install-approval.js
    - test/openclaw-install-plan.test.js
    - test/openclaw-install-approval.test.js
    - .planning/phases/04-package/04-06-SUMMARY.md
  modified:
    - test/phase4-contracts.test.js
    - release/2026.07.29.md
key-decisions:
  - "Lifecycle authority is mutually exclusive: install uses verified absent genesis, upgrade/uninstall use the current complete receipt, and rollback uses current plus selected predecessor receipt/archive."
  - "Ordinary, sensitive-action, and conflict decisions remain non-interchangeable even though one frozen review model presents all facts."
  - "Config patches bind portable pathSegments rather than slash-prefixed JSON pointer text, preserving value-blind persistability without weakening exact path semantics."
patterns-established:
  - "Archive closure pattern: archive SHA-256, manifest digest, recomputed inventory digest, and sorted full file-member descriptors travel together."
  - "Pure boundary pattern: lifecycle builders and validators import no filesystem, process, writer, registry, subject, or CLI module."
requirements-completed: [OCLW-02, OCLW-04, EVID-05]
coverage:
  - id: D1
    description: "All four lifecycle actions use exactly one verified genesis/current/predecessor authority basis."
    requirement: OCLW-02
    verification:
      - kind: unit
        ref: "test/openclaw-install-plan.test.js#builds closed absent-genesis and lifecycle authorities for all four actions"
        status: pass
      - kind: unit
        ref: "test/openclaw-install-plan.test.js#enforces exactly one lifecycle predecessor or verified genesis basis"
        status: pass
    human_judgment: false
  - id: D2
    description: "Plans and every decision family independently bind the same complete D-42 archive closure."
    requirement: EVID-05
    verification:
      - kind: unit
        ref: "test/openclaw-install-plan.test.js#binds the complete sorted D-42 archive closure and rejects every member drift"
        status: pass
      - kind: unit
        ref: "test/openclaw-install-approval.test.js#all three decision families repeat the same complete archive closure independently"
        status: pass
    human_judgment: false
  - id: D3
    description: "Ordinary, per-sensitive-action, and exact-conflict approvals are closed, exact, expiring, and non-interchangeable."
    requirement: OCLW-04
    verification:
      - kind: unit
        ref: "test/openclaw-install-approval.test.js#ordinary approval binds the plan and D-42 closure but grants no other authority"
        status: pass
      - kind: unit
        ref: "test/openclaw-install-approval.test.js#each sensitive decision exact-binds one action and fails closed on lifecycle state"
        status: pass
      - kind: unit
        ref: "test/openclaw-install-approval.test.js#one conflict approval binds the complete sorted exact conflict set"
        status: pass
    human_judgment: false
  - id: D4
    description: "Wave 6 remains a pure model boundary with no writer, registry subject, CLI, or target effect."
    requirement: OCLW-02
    verification:
      - kind: integration
        ref: "test/phase4-contracts.test.js#Phase 4 Wave 6 exposes pure archive-bound lifecycle and independent approval models only"
        status: pass
    human_judgment: false
duration: 1h 29min
completed: 2026-07-29
status: complete
---

# Phase 4 Plan 6: Pure OpenClaw Lifecycle and Approval Authorities Summary

**Closed four-action lifecycle plans now carry full D-42 archive authority into three independent exact approval families without publishing or mutating OpenClaw**

## Performance

- **Duration:** 1h 29 min
- **Started:** 2026-07-29T14:32:00Z
- **Completed:** 2026-07-29T16:01:24Z
- **Tasks:** 2/2
- **Files created/modified:** 7

## Accomplishments

- Added closed, deeply frozen absent-genesis and lifecycle plan builders/validators for install, upgrade, explicit rollback, and uninstall with mutually exclusive predecessor bases.
- Added one complete archive authority shape containing the caller-supplied archive SHA-256, internal manifest digest, recomputed canonical inventory digest, and complete sorted file-member closure.
- Added a frozen one-screen review plus ordinary managed-write approval, one exact decision per sensitive action, and one complete exact-conflict-set approval; each repeats the archive closure and plan digest independently.
- Added drift, unknown-field, replay, expiry, reuse, scope, ownership, operation, patch, action, conflict, and non-certification coverage without adding any durable writer or public command surface.

## Task Results

### Task 1: Write failing lifecycle and archive-bound authority models

- RED was observed with `0 pass / 3 fail`: all three requested test files failed only because `src/openclaw-install-plan.js` did not yet exist.
- The focused suites cover all four lifecycle actions, the three independent authority families, every archive member field, complete-set equality, three-way ownership, user-scope escalation, and one-screen human/JSON parity.
- No fixture syntax error or unrelated regression caused the RED gate.

### Task 2: Implement pure lifecycle plan and approval services

- The builders clone and deeply freeze canonical candidates; validators require exact keys, recompute both archive inventory and install-plan digests, and fail closed on any basis drift.
- Install requires a verified exact absent-genesis authority. Upgrade and uninstall require one complete current receipt. Rollback additionally requires the selected predecessor receipt and its identical archive binding.
- Ordinary approval explicitly denies sensitive, conflict, and broader-scope authority. Sensitive approvals bind executable, argv, cwd, scope, target, timeout, and sorted environment-name set. Conflict approval binds the whole sorted path/current/desired/action set.

## Verification

| Gate | Result |
|---|---|
| RED: `node --test test/openclaw-install-plan.test.js test/openclaw-install-approval.test.js test/phase4-contracts.test.js` before production modules | expected failure: 0 pass, 3 fail, missing module only |
| GREEN: same exact Wave 6 gate | 15 pass, 0 fail |
| `node --check` for two production modules and three test files | pass |
| Pure-surface scan for filesystem/process/writer/registry/subject/CLI imports | pass; none in production modules |
| `git diff --check` | pass |

The full `npm run check` was intentionally not run because this Wave explicitly requires the bounded three-file gate.

## Certification Boundary

This plan proves pure deterministic proposal and exact approval semantics only:

- no package publication or archive writer;
- no durable authority registry subject;
- no CLI route or artifact production;
- no filesystem, HOME, state, config, or workspace mutation;
- no OpenClaw installation, upgrade, rollback, or uninstall execution;
- no process, external command, credential, network, plugin, MCP, agent, or schedule execution;
- no runtime, domain-quality, Birth, Delivery, production, publication, or deployment certification.

Plans 04-07 and 04-08 retain responsibility for create-only writers, prerequisite receipt descriptors, retained no-follow archive revalidation, remaining registry entries, CLI wiring, and mutation control.

## Decisions Made

- Kept lifecycle predecessor shapes mutually exclusive rather than accepting nullable combinations that could create ambiguous install authority.
- Repeated the full archive closure in every decision rather than allowing a plan digest or manifest digest to stand in for D-42 transport authority.
- Represented minimal config patch locations as portable `pathSegments[]`; slash-prefixed pointer strings collide with the repository's host-absolute-path safety gate.
- Required one `user-scope` sensitive action whenever the target scope is `user`; ordinary project approval cannot broaden itself.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The initial GREEN candidate represented a config patch location as a slash-prefixed JSON pointer. Existing persistability correctly rejected that string as absolute-path-shaped material. The closed model and tests now use portable path segments while preserving exact patch identity.

## AGENTS.md-Driven Adjustments

- Updated `release/2026.07.29.md` because this plan changes lifecycle, approval, and certification-boundary semantics.
- Did not run full `npm run check`; the operator explicitly constrained this Wave to the bounded gate.
- Did not stage, commit, push, stash, reset, checkout, or switch. Existing shared-worktree changes were preserved.

## Known Stubs

None. The lifecycle, review, and three approval families are fully wired pure models. Writers, receipt registration, CLI, retained archive reads, and target effects are deliberately owned by Plans 04-07 and 04-08, not stubs in this plan.

## Threat Review

- T-04-20: every authority repeats and validates the full archive/member closure, including canonical inventory recomputation and sorted portable regular-file descriptors.
- T-04-21: decisions bind the subject-specific install plan, expiry interval, and one-use nonce context; stale, mismatched, expired, or reused candidates fail closed.
- T-04-22: target scope is exact-bound and user scope requires its own sensitive action; ordinary approval grants no broader authority.
- T-04-23: sensitive actions retain environment key names only, and the complete models pass the repository persistability gate.
- No unplanned network endpoint, authentication route, file access, schema mutation, or other trust-boundary surface was introduced.

## Git Status

No commits were created. This execution obeyed the explicit prohibition on staging, committing, pushing, stashing, resetting, checkout, or switch.

## Next Phase Readiness

- Plan 04-07 can add create-only durable writers and the prerequisite receipt descriptor around these frozen validators.
- Plan 04-08 can add retained no-follow archive admission, remaining durable subjects, CLI production, and target mutation behind all independent authorities.
- Any archive, manifest, inventory, member, target, scope, operation, patch, action, ownership, receipt, or conflict-current-byte drift already invalidates the relevant model before mutation.

## Self-Check: PASSED

- Both production modules, both focused suites, the incremental Phase 4 gate, release record, and this summary exist.
- Every planned public schema constant, builder, and validator export is present.
- The final Wave 6 gate passed 15 unique tests with zero failures; focused tests no longer import or register one another.
- Production modules contain no filesystem/process/writer/registry/subject/CLI import or target-effect path.
- Syntax checks and final `git diff --check` passed.
- Commit verification is not applicable because Git writes were explicitly prohibited.
