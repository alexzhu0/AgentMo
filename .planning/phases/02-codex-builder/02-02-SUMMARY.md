---
phase: 02-codex-builder
plan: "02"
subsystem: builder-recovery
tags: [checkpoint, hooks, replay, cas, codex]
requires:
  - phase: 02-codex-builder
    plan: "01"
    provides: [adapter contract, Codex probe, lifecycle entry]
provides:
  - exact-digest bounded Builder checkpoints
  - replay-safe host-neutral event reducer
  - proposal-only pause, hook, and resume CLI paths
affects: [02-03, 02-04, future-builder-adapters]
tech-stack:
  added: []
  patterns: [retained no-follow reads, event digest ledger, checkpoint CAS lock]
key-files:
  created: [src/builder-checkpoint.js, src/builder-events.js, test/builder-checkpoint.test.js, test/builder-hook.test.js, test/builder-cli.test.js]
  modified: [src/builder-entry.js, src/cli.js, package.json, test/helpers/io-surface-inventory.js]
key-decisions:
  - "Hook entry accepts hook-origin events only; approval and stage transition remain explicit core operations."
  - "Duplicate identity is bound to event ID, sequence, and canonical digest; stale events never mutate state."
  - "Checkpoint publication uses bounded bytes plus digest CAS so concurrent writers fail closed."
requirements-completed: [BLDR-03, BLDR-04]
duration: 45min
completed: 2026-07-15
status: complete
---

# Phase 2 Plan 02: Durable Builder Recovery Summary

**AgentMo can now pause, survive compaction or restart, and resume the same Discover → Plan → Produce lifecycle from an exact-digest checkpoint without trusting transcripts.**

## Delivered

- Added bounded canonical checkpoints, retained no-follow admission, atomic publication, and digest CAS.
- Added replay-safe events for restart, compaction, pause, artifacts, approval resolution, and stage transition.
- Added `builder pause`, `builder hook`, and `builder resume`; hooks cannot approve or advance stages.
- Separated the full checkpoint digest from its admitted summary digest in resume output.

## Verification

- Builder recovery tests: 23/23 passed, including concurrent writers, approval approve/reject, forged core-origin hook input, restart replay, and aged events.
- `npm run check`: 480/480 passed across 53 suites.
- Real local Codex resume: observed compatible and proposed `plan` with approval required.
- `git diff --check`: passed.

## Commits

None — the user has not authorized a Git commit.

## Deviations from Plan

- Added CAS locking and event-content binding after focused review found lost-update and collision risks.
- Added explicit approval resolution so an approval checkpoint cannot become permanently stuck.

## Self-Check: PASSED

All declared files exist; targeted, real-host, and full regression checks pass. No blocking stubs remain.
