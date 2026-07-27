---
phase: 02-codex-builder
plan: "03"
subsystem: builder-distribution
tags: [codex-plugin, npm-pack, project-setup, receipt, doctor]
requires:
  - phase: 02-codex-builder
    plan: "02"
    provides: [checkpoint contract, hook boundaries, replay-safe lifecycle]
provides:
  - self-contained packed Codex plugin projection
  - project-bound preview and receipt-last setup
  - value-blind read-only doctor rooted in current release bytes
affects: [02-04, future-builder-adapters, release-packaging]
tech-stack:
  added: []
  patterns: [project scope digest, receipt-last publication, current-package trust root]
key-files:
  created:
    - plugin/.codex-plugin/plugin.json
    - plugin/skills/agentmo/SKILL.md
    - plugin/agents/agentmo.toml
    - plugin/hooks/hooks.json
    - plugin/hooks/agentmo-hook.js
    - src/builder-package.js
    - src/builder-install.js
    - src/builder-doctor.js
    - test/builder-packed-install.test.js
    - test/builder-doctor.test.js
  modified:
    - src/cli.js
    - package.json
    - test/artifact-surface-coverage.test.js
    - test/helpers/io-surface-inventory.js
key-decisions:
  - "A setup preview is bound to one canonical project scope and direct apply always requires that exact plan digest."
  - "Doctor derives trusted managed-file digests from the current packed release, never from receipt self-claims."
  - "Project files prove declared projection only; Codex activation, hook trust, and fresh-session behavior remain unverified."
requirements-completed: [BLDR-01, BLDR-05]
coverage:
  - id: D1
    description: "A packed npm release installs the canonical Codex plugin into one explicitly previewed project and publishes its receipt last."
    requirement: BLDR-01
    verification:
      - kind: integration
        ref: "test/builder-packed-install.test.js#packed Codex Builder setup"
        status: pass
      - kind: other
        ref: "npm pack --dry-run --json"
        status: pass
    human_judgment: false
  - id: D2
    description: "Builder doctor is read-only, value-blind, and rejects modified files plus receipt self-certification."
    requirement: BLDR-05
    verification:
      - kind: integration
        ref: "test/builder-doctor.test.js#read-only Builder doctor"
        status: pass
      - kind: other
        ref: "npm run check"
        status: pass
    human_judgment: false
duration: 70min
completed: 2026-07-15
status: complete
---

# Phase 2 Plan 03: Packed Codex Setup and Doctor Summary

**AgentMo now ships one canonical Codex plugin inside the npm package, installs it through a project-bound preview/apply contract, and diagnoses it without trusting mutable receipt claims.**

## Performance

- **Duration:** 70 min
- **Completed:** 2026-07-15T17:41:39+08:00
- **Tasks:** 2
- **Files modified:** 14

## Accomplishments

- Added the canonical plugin, skill, agent, and standalone bounded hook to the packed release.
- Added project-scoped setup with exact operations, mandatory preview digest, staged publication, per-path digests, and receipt-last success.
- Added a strictly read-only doctor that distinguishes missing, declared, degraded, and inconsistent state without claiming activation or domain quality.

## Verification

- Focused setup and doctor tests: 15/15 passed, including cross-project replay, unbound apply, symlink escape, partial install, and forged receipt/hook cases.
- Full regression: `npm run check` passed 495/495 across 55 suites.
- Codex plugin validator and AgentMo skill validator passed.
- `npm pack --dry-run --json` passed with a 56-file allowlisted package; an actual packed install is exercised by the integration suite.
- `git diff --check` passed.
- Independent P0/P1 re-review found no remaining P0/P1 after both reported issues were fixed.

## Commits

None — the user has not authorized a Git commit.

## Deviations from Plan

- Bound plan and receipt bytes to a non-disclosing project scope digest after review reproduced cross-project preview replay.
- Made current packed release bytes the doctor's trust root after review reproduced receipt self-certification of a modified hook.
- Added explicit empty-project and receipt-last interruption diagnostics.

## Issues Encountered

None unresolved.

## User Setup Required

None for this plan. Hook trust and fresh-session Codex activation are intentionally deferred to Plan 02-04.

## Next Phase Readiness

Ready for 02-04 upgrade, uninstall, real fresh-session verification, and concise README/release maintenance. Declared projection does not yet certify Codex activation or domain quality.

## Self-Check: PASSED

All declared files exist; packed, targeted, security-reproduction, validator, and full-regression checks pass.
