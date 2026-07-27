---
phase: 02-codex-builder
plan: "01"
subsystem: builder
tags: [adapter-contract, codex, capability-probe, lifecycle]
requires:
  - phase: 01.2-openclaw-runtime-release-evidence
    provides: [runtime and evidence boundaries]
provides:
  - versioned host-neutral Builder adapter contract
  - bounded read-only Codex capability probe
  - shared proposal-only Builder entry engine
affects: [02-02, 02-03, future-builder-adapters]
tech-stack:
  added: []
  patterns: [fixed-argv host probe, declared-observed-verified separation, exact-byte checkpoint admission]
key-files:
  created: [src/builders/contract.js, src/builders/codex.js, src/builders/registry.js, src/builder-probe.js, src/builder-entry.js]
  modified: [src/cli.js, package.json, test/helpers/io-surface-inventory.js]
key-decisions:
  - "Adapter registration remains a candidate declaration; only external behavior evidence can establish support."
  - "Builder resume accepts an exact-byte admitted checkpoint summary, never an admitted:true self-claim."
requirements-completed: [CORE-05, BLDR-02]
coverage:
  - id: D1
    description: Versioned host-neutral Builder adapter contract
    requirement: CORE-05
    verification:
      - kind: unit
        ref: test/builder-adapter-contract.test.js
        status: pass
    human_judgment: false
  - id: D2
    description: Read-only Codex probe with fail-closed required capabilities
    requirement: BLDR-02
    verification:
      - kind: integration
        ref: node bin/agentmo.js builder probe --json
        status: pass
      - kind: unit
        ref: test/codex-builder-probe.test.js
        status: pass
    human_judgment: false
  - id: D3
    description: Shared start, direct-entry, and admitted-resume lifecycle proposal
    verification:
      - kind: unit
        ref: test/builder-entry.test.js
        status: pass
    human_judgment: false
duration: 30min
completed: 2026-07-15
status: complete
---

# Phase 2 Plan 01: Builder Contract, Probe, and Entry Summary

**AgentMo now has a host-neutral Builder contract, a real Codex 0.144.2 read-only probe, and one fail-closed lifecycle entry engine.**

## Accomplishments

- Added the versioned adapter contract and Codex candidate without granting support by registration.
- Added fixed-argv `codex` probing for version, plugins, hooks, resume, and optional doctor surfaces.
- Added `agentmo builder`, `builder probe`, and direct stage protocol routes over one lifecycle contract.
- Replaced a self-certifying checkpoint flag with canonical exact-byte admission and a process-authentic token.

## Verification

- `node --test test/builder-adapter-contract.test.js test/codex-builder-probe.test.js test/builder-entry.test.js test/artifact-surface-coverage.test.js` — 23/23 passed.
- `npm run check` — 461/461 passed.
- `git diff --check` — passed.
- Real probe observed Codex `0.144.2`; support remains `observed-compatible`, not behavior-verified.

## Commits

None — the user has not authorized a Git commit.

## Deviations from Plan

- Updated the existing exact IO-surface inventory after adding the non-artifact Builder CLI branch.
- Strengthened checkpoint summary intake to require canonical bytes plus exact digest instead of trusting a boolean admission claim.

## Self-Check: PASSED

All created files exist, targeted and full regression tests pass, and no README/release update was made before a release-sized milestone.
