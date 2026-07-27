---
phase: 02-codex-builder
plan: "04"
subsystem: builder-lifecycle
tags: [codex-plugin, upgrade, uninstall, receipt-ownership, behavior-eval]
requires:
  - phase: 02-codex-builder
    plan: "03"
    provides: [packed Codex projection, project-bound receipt, read-only doctor]
provides:
  - receipt-bound preview/apply upgrade and uninstall
  - three-way ownership classification with per-mutation revalidation
  - packed fresh-process mechanism evidence for the fixed Builder scenarios
affects: [future-builder-adapters, phase-03-agent-package, release-verification]
tech-stack:
  added: []
  patterns: [exact lifecycle plan digest, three-way ownership, receipt-last publication, fresh-process mechanism evidence]
key-files:
  created:
    - src/builder-lifecycle.js
    - src/builder-behavior-eval.js
    - test/builder-lifecycle.test.js
    - test/codex-builder-behavior.test.js
    - release/2026.07.15.md
  modified:
    - src/builder-install.js
    - src/cli.js
    - package.json
    - test/artifact-surface-coverage.test.js
    - test/helpers/io-surface-inventory.js
    - README.md
key-decisions:
  - "Lifecycle plans bind the exact project, admitted receipt, current bytes, and desired packed release; apply revalidates each target immediately before mutation."
  - "Modified, unknown, shared, checkpoint, missing-receipt, and corrupt-receipt state is preserved or blocks mutation instead of being repaired implicitly."
  - "Behavior evaluation proves only the packed fresh-process mechanism; it does not claim real Codex activation, host trust, Agent Package quality, domain quality, or production approval."
requirements-completed: [BLDR-06]
requirements-reopened: [BLDR-01]
requirements-pending: [BLDR-01, BLDR-07]
coverage:
  - id: D1
    description: "Upgrade and uninstall mutate only exact, pristine, receipt-owned paths under a project-bound approved plan."
    requirement: BLDR-06
    verification:
      - kind: integration
        ref: "test/builder-lifecycle.test.js#receipt-owned Builder lifecycle"
        status: pass
      - kind: other
        ref: "npm run check"
        status: pass
    human_judgment: false
  - id: D2
    description: "A packed release exercises the fixed trigger, non-trigger, checkpoint, pause, compaction, restart/resume, and duplicate-no-op scenarios in isolated fresh processes."
    requirement: BLDR-07
    verification:
      - kind: integration
        ref: "test/codex-builder-behavior.test.js#packed Codex Builder behavior evaluation"
        status: pass
      - kind: other
        ref: "npm pack --dry-run --json"
        status: pass
      - kind: manual_procedural
        ref: "fresh Codex session plugin discovery, trust, hook delivery, and recovery smoke"
        status: fail
    human_judgment: true
    rationale: "Isolated real Codex smoke found no setup-driven plugin activation, no project-local launcher, and no hook-to-checkpoint bridge; the bounded mechanism lane cannot satisfy BLDR-07."
duration: multi-pass implementation and hostile remediation
updated: 2026-07-15
status: partial
---

# Phase 2 Plan 04: Builder Lifecycle and Behavior Evidence Summary

**AgentMo now upgrades and removes its Codex Builder projection through exact receipt ownership, and emits bounded packed fresh-process behavior evidence without promoting it into a host or domain certification.**

## Performance

- **Duration:** Multi-pass implementation, hostile review, and isolated host smoke
- **Updated:** 2026-07-15
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments

- Added project-bound preview/apply upgrade and uninstall with an external receipt-digest gate, three-way installed/current/desired classification, retained-identity quarantine, no-clobber publication, and receipt-last collection postconditions.
- Preserved shared marketplace state, checkpoints, modified assets, unknown plugin assets, and prefix-neighbor files; missing or corrupt receipts fail closed.
- Added an actual packed-install mechanism lane whose installed SessionStart, PreCompact, PostCompact, and non-trigger hook projections run in isolated Node processes with a minimal environment; CLI/checkpoint scenarios bind release, receipt, host-observation, scenario, result, and evidence digests.
- Added CLI interfaces and concise README/release evidence with explicit non-certification boundaries.

## Verification

- Lifecycle plus packed behavior tests pass 21/21; hostile coverage includes forged receipts, hard links, late path swaps, checkpoint races, recreated deletes, and staged-publication faults.
- Artifact/output inventory passes 10/10; `npm run check` passes 516/516 across 57 suites.
- `npm pack --dry-run --json` passes with 58 allowlisted files; plugin and skill validators pass.
- `git diff --check` passes.

## Commits

None — the user has not authorized a Git commit.

## Deviations from Plan

- Fresh-process evidence intentionally remains `observed / fresh-process-mechanism`. Isolated real Codex 0.144.2 smoke found the repo marketplace discoverable, but setup left the plugin uninstalled/disabled; explicit official installation exposed three untrusted hooks.
- The hook remains a standalone reminder, not a host-event-to-checkpoint bridge, and the clean projection has no persistent project-local launcher. BLDR-01 is therefore reopened and BLDR-07 remains pending; this is an implementation gap, not merely a waiting human gate.
- Receipt-changing upgrade is blocked while a checkpoint exists, avoiding a checkpoint/receipt binding split instead of migrating that state implicitly.

## Issues Encountered

- Setup currently projects a discoverable marketplace but does not install/enable the Codex plugin.
- The installed hook does not translate host events into Builder event/checkpoint mutations.
- The clean project has no receipt-managed launcher/core and cannot rely on a global `agentmo` command.

## User Setup Required

None for the bounded mechanism lane. A user trust/UAT step alone cannot close the phase yet; AgentMo first needs an explicit host-install lifecycle, receipt-managed project launcher/core, and a real hook bridge.

## Next Phase Readiness

Plan 02-04's ownership-safe lifecycle is complete, but Phase 2 is not ready to hand its Builder to Phase 3 as installable/usable. The next bounded gap slice is host activation + project-local launcher + hook bridge, followed by authenticated/trusted Codex UAT.

## Implementation Self-Check: PASSED — Phase Gate Still Open

All declared 02-04 files exist; focused, inventory, package, validator, and full-regression checks pass with no credential or raw transcript evidence stored. This self-check completes BLDR-06 only and does not complete BLDR-01 or BLDR-07.
