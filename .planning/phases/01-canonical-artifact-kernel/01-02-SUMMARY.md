---
phase: 01-canonical-artifact-kernel
plan: 02
subsystem: canonical-documentation
tags: [agentmo, documentation, lifecycle, evidence, node-test]

requires:
  - 01-01 canonical AgentMo machine contract
provides:
  - AgentMo-only current maintained documentation
  - Sole Discover, Plan, Produce top-level lifecycle documentation
  - Produce-internal and non-self-certifying evidence terminology
  - Per-file and per-section documentation identity regression matrix
affects: [01-03, legacy-migration, public-contract, runtime-runbooks]

tech-stack:
  added: []
  patterns:
    - Exact maintained-document path matrix
    - Explicit heading-bounded legacy identity allowlist
    - Path-specific lifecycle and evidence assertions

key-files:
  created:
    - .planning/phases/01-canonical-artifact-kernel/01-02-SUMMARY.md
  modified:
    - AGENTS.md
    - README.md
    - CONTRIBUTING.md
    - docs/BLUEPRINT_SCHEMA.md
    - docs/STAGE_CONTRACTS.md
    - docs/LIFECYCLE.md
    - docs/CONCEPT.md
    - docs/QUALITY_GATES.md
    - docs/DISCOVERY_MANIFEST.md
    - docs/MVP_RUNBOOK.md
    - docs/OMX_SESSION_MIGRATION.md
    - docs/OPENCLAW_RUNTIME_NOTES.md
    - docs/OBSERVE_EVOLVE.md
    - docs/RUNTIME_EXECUTION.md
    - docs/AGENT_BIRTH_GATE.md
    - test/canonical-identity.test.js

key-decisions:
  - "Current maintained docs use AgentMo and agentmo_version; the sole old identity example is isolated under docs/BLUEPRINT_SCHEMA.md#Legacy migration context."
  - "Discover, Plan, and Produce are the only top-level lifecycle stages; build/install/doctor/birth/eval/delivery/release/status/observe are Produce-internal surfaces."
  - "Declared, live, birth, domain-eval, delivery, and release evidence remain bounded and non-transitive rather than self-certifying."

requirements-completed: [CORE-01, CORE-03]

coverage:
  - id: D3
    description: "Maintained documentation exposes one current AgentMo product and schema identity."
    requirement: CORE-01
    verification:
      - kind: unit
        ref: "test/canonical-identity.test.js#maintained documentation matrix"
        status: pass
    human_judgment: false
  - id: D4
    description: "Lifecycle and evidence docs keep all post-plan work inside Produce and reject evidence transitivity."
    requirement: CORE-03
    verification:
      - kind: unit
        ref: "test/canonical-identity.test.js#three-stage lifecycle and evidence assertions"
        status: pass
      - kind: other
        ref: "npm run check"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-07-12
status: complete
---

# Phase 01 Plan 02: Canonical Documentation Contract Summary

**Current maintained documentation now presents AgentMo as the sole product identity and Discover → Plan → Produce as the sole top-level lifecycle, with runtime and evidence work explicitly bounded inside Produce.**

## Performance

- **Duration:** 20 min
- **Started:** 2026-07-11T16:27:39Z
- **Completed:** 2026-07-11T16:47:51Z
- **Tasks:** 2
- **Files modified:** 17, including this summary

## Accomplishments

- Replaced current public identity and schema wording with AgentMo and `agentmo_version: "0.1"` across core, contributor, runtime, runbook, and evidence documentation.
- Rewrote `docs/LIFECYCLE.md` around exactly three top-level stages and classified build, install, doctor, birth, eval, delivery, release, status, and observation as Produce-internal maturity or governance surfaces.
- Preserved fail-closed Birth/Delivery behavior, proposal-only observation, and the non-transitivity of declared, live, bounded eval, delivery, and release evidence.
- Extended `test/canonical-identity.test.js` with an exact maintained-doc path matrix, an explicit legacy-section allowlist, lifecycle shape checks, and path-specific evidence assertions.

## Verification

- RED: the new documentation matrix initially ran **7/10 passing, 3 failing** on current old identity, schema, lifecycle, and evidence wording.
- Task 1/2 GREEN: `node --test test/canonical-identity.test.js` — **10/10 passed**.
- Repository gate: `npm run check` — **209/209 passed across 33 suites**.
- Whitespace gate: `git diff --check` — **passed**.
- Bounded legacy scan: the only old identity token in the 15 maintained documents is in `docs/BLUEPRINT_SCHEMA.md` under the exact `Legacy migration context` allowlisted heading.

## Task Commits

No commits were created. `AGENTS.md` and the executor assignment prohibit staging or committing without explicit user authorization, so both task commits and the final metadata commit were skipped by project rule. All changes remain unstaged and uncommitted.

## Files Created/Modified

- `AGENTS.md`, `README.md`, `CONTRIBUTING.md` — canonical project, product, schema, lifecycle, and collaboration terminology.
- `docs/BLUEPRINT_SCHEMA.md`, `docs/STAGE_CONTRACTS.md`, `docs/LIFECYCLE.md`, `docs/CONCEPT.md`, `docs/QUALITY_GATES.md` — canonical core documentation and bounded legacy migration context.
- `docs/DISCOVERY_MANIFEST.md`, `docs/MVP_RUNBOOK.md`, `docs/OMX_SESSION_MIGRATION.md` — maintained discovery, composed demo, and session-recovery wording.
- `docs/OPENCLAW_RUNTIME_NOTES.md`, `docs/OBSERVE_EVOLVE.md`, `docs/RUNTIME_EXECUTION.md`, `docs/AGENT_BIRTH_GATE.md` — Produce-internal runtime/proposal/gate terminology and explicit non-certification boundaries.
- `test/canonical-identity.test.js` — exact documentation path matrix and section/path-specific assertions.
- `.planning/phases/01-canonical-artifact-kernel/01-02-SUMMARY.md` — execution evidence and handoff.

## Decisions Made

- Kept the legacy `agentmother_version` example only where implementers need migration context, under one exact allowlisted heading; current contracts never dual-write it.
- Used the existing `status` and `produce_maturity` concepts as internal progress labels without adding a lifecycle or runtime enforcement mechanism.
- Excluded dated release history from the maintained-doc test matrix and left all historical release records unchanged.

## Deviations from Plan

None — both documentation tasks and their planned regression coverage were completed without adding architecture, runtime/version enforcement, or repository-wide legacy scans.

## Issues Encountered

- Two multi-file patches encountered context mismatches and were reapplied as smaller `apply_patch` hunks; no semantic scope changed.
- Pre-existing `.env.example` deletion and `.gitignore` modification were preserved untouched and are not part of this plan.
- Per assignment, `.planning/STATE.md`, `.planning/ROADMAP.md`, and `.planning/REQUIREMENTS.md` were not updated; root orchestration owns those final acceptance updates.

## Known Stubs

None. The stub-pattern scan found only descriptive `TODO` wording in the contributor workflow, not unfinished product behavior.

## User Setup Required

None — no external services, credentials, or runtime changes are required.

## Next Phase Readiness

- Plan 03 can implement explicit legacy recognition and value-blind migration against a current-doc contract that no longer presents legacy identity as canonical.
- Dated historical release records remain available as history and were neither rewritten nor included in the maintained-doc identity matrix.

---
*Phase: 01-canonical-artifact-kernel*
*Completed: 2026-07-12*
