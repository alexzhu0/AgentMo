---
phase: 02-codex-builder
plan: "10"
subsystem: codex-builder-host-uat
tags: [codex-uat, bounded-failure, clean-host, value-blind-evidence, human-gate]
requires:
  - phase: 02-codex-builder
    plan: "09"
    provides: [formal value-blind UAT producer, exact candidate admission, packed runtime closure]
provides:
  - maintained Builder architecture, command, verification, and certification-boundary records
  - exact value-blind record of the first isolated host attempt's activation precondition failure
  - explicit preservation of false real-session, activation, host, package, domain, production, and deployment claims
affects: [phase-02-verification, BLDR-01, BLDR-07, codex-host-activation, future-clean-host-uat]
tech-stack:
  added: []
  patterns: [first-bounded-failure recording, private continuation non-attestation, no-retry checkpoint closure, non-transitive certification]
key-files:
  created:
    - .planning/phases/02-codex-builder/02-10-SUMMARY.md
  modified:
    - README.md
    - release/2026.07.15.md
key-decisions:
  - "The confirmed first bounded failure closes Plan 02-10's failure-record branch without closing Phase 2, BLDR-01, or BLDR-07."
  - "The private continuation handle and digest are not agentmo.codex-uat.v1, a candidate, or a real-session attestation."
  - "The activation failure was recorded without retry, substitution, relaxed validation, or broader certification."
patterns-established:
  - "Host-gate failure records contain only a bounded handle, exact digest, fixed scenario/reason, versions, digests, booleans, and remaining risk."
  - "A completed plan record and an achieved phase goal remain separate states."
requirements-completed: []
requirements-progressed: []
requirements-pending: [BLDR-01, BLDR-07]
coverage:
  - id: D1
    description: "README and release records describe the implemented Builder mechanism, commands, exact verification, bounded status, and remaining risk."
    verification:
      - kind: integration
        ref: "node --test test/builder-codex-uat.test.js test/codex-builder-behavior.test.js test/builder-packed-install.test.js test/artifact-surface-coverage.test.js"
        status: pass
      - kind: other
        ref: "npm run check"
        status: pass
    human_judgment: false
  - id: D2
    description: "The first isolated packed-runtime host attempt is recorded only as precondition:user-host-activation / AGENTMO_BUILDER_INSTALL_HOST_MUTATION_FAILED."
    verification:
      - kind: manual_procedural
        ref: "human confirmation of the first bounded failure and exact continuation-manifest digest"
        status: pass
    human_judgment: true
    rationale: "The external host attempt and its explicit checkpoint confirmation cannot be established by repository tests alone."
  - id: D3
    description: "No real session, formal UAT candidate, activation, host behavior, Agent Package, domain, production, or deployment claim was promoted."
    verification:
      - kind: manual_procedural
        ref: "exact value-blind continuation record plus README/release boundary review"
        status: pass
    human_judgment: true
    rationale: "The negative host-reachability facts originate outside the repository and remain bounded by human admission."
duration: checkpointed execution; final continuation approximately 32 minutes
completed: 2026-07-19
status: complete
---

# Phase 2 Plan 10: First Bounded Codex Host UAT Record Summary

**The packed clean-host attempt reached project setup, failed closed at user-host activation, and produced an exact value-blind failure record without promoting any support or quality claim.**

## Performance

- **Duration:** Checkpointed Wave 10 execution; final continuation approximately 32 minutes
- **Started:** 2026-07-19T04:36:22Z (final host-attempt continuation)
- **Completed:** 2026-07-19T05:07:49Z
- **Tasks:** 2/2 completed through the plan's bounded-failure branch
- **Files created or modified:** 3 documentation and planning files

## Accomplishments

- Updated `README.md` and `release/2026.07.15.md` with the packed runtime, user-host ownership, read-only doctor, sibling-safe lifecycle, installed hook bridge, formal UAT commands, exact automated evidence, and non-certification boundary.
- Published the canonical plan outcome at `.planning/phases/02-codex-builder/02-10-SUMMARY.md` without changing phase or requirement state owned by the orchestrator.
- Recorded the human-confirmed first bounded failure as status `first-bounded-failure`, fixed scenario `precondition:user-host-activation`, and reason `AGENTMO_BUILDER_INSTALL_HOST_MUTATION_FAILED`.
- Preserved the distinction between a completed Plan 02-10 failure record and an incomplete Phase 2 goal: BLDR-01 and BLDR-07 remain pending, and every real-session, activation, host, package, domain, production, and deployment flag remains false.

## Bounded Host Outcome

The exact private continuation record was admitted only by handle `uat-e98e5f95ea1370dcdbbcfb81` and manifest SHA-256 `c1340776c80d68d1aa5d2b4f81bfb1ecf8622a05283f89d1588296ce75dd5bfd`. It is not `agentmo.codex-uat.v1`, an exact candidate, or a real-session attestation.

The isolated root, project, fresh `HOME`, and fresh `CODEX_HOME` were private. The attempt used the packed artifact and project-local launcher, not the source checkout or a global AgentMo executable. Project-only setup succeeded; user-host activation preview produced an exact plan; activation apply failed closed. The receipt remained preserved and the projection remained `pristine`.

The exact UAT execution tarball SHA-256 was `9d27ddfd63c943d71b0f076555cebe336489830a729ad83a2760f4a3e1499b0a`. The installed UAT module remained `ebd07d1d01778b93ef21a31d30d3962e71f0bc6c2e6d01533bc8b5ad0f0203e0`, the installed hook bridge remained `d30feaf880decec310b0d576a056322aa462d935d4106596ee214df0f8b5f643`, and the project-local launcher digest was `5612d5f3f675fec962193df1bc79520b80662e0d7bc9416d8dc3caf9baed09f2`.

Normal trust, authentication, a real Codex session, formal eleven-scenario UAT collection, candidate production, and exact admission were never reached. The attempt was not retried or replaced with synthetic evidence.

## Final Verification

- Continuation manifest raw-byte SHA-256 — **PASS**, `c1340776c80d68d1aa5d2b4f81bfb1ecf8622a05283f89d1588296ce75dd5bfd`.
- `node --test test/builder-codex-uat.test.js test/codex-builder-behavior.test.js test/builder-packed-install.test.js test/artifact-surface-coverage.test.js` — **PASS, 36/36 across 4 suites**.
- `npm run check` — **PASS, 616/616 across 66 suites**; the environment-specific actual Node 20 lane remained an expected skip.
- One earlier full-suite run observed a transient runtime timeout-cleanup failure; the focused runtime-execution rerun passed 7/7 and the final complete rerun passed 616/616 without code changes.
- `npm pack --dry-run --json --cache <isolated-temp-cache>` — **PASS, 61 entries** after the final review/status README update, shasum `dfb9817df5a7c8cabf13c3d783cece1582d85029`, integrity `sha512-lNBITeR+zJhxmLFZd3H6ij9N6pFMlv1xa2S2MUPjSBWZg4E/7iVvnvIWBQWBAV7cjcw1IP0xnbBhZoL6k5KxuQ==`.
- `src/builder-hook-bridge.js` — **UNCHANGED**, SHA-256 `d30feaf880decec310b0d576a056322aa462d935d4106596ee214df0f8b5f643`.
- `git diff --check` — **PASS** after final documentation and summary publication.

The UAT execution tarball SHA-256 identifies the bytes used by the failed host attempt. The current npm shasum and integrity identify the package after README outcome maintenance; these are different subjects and are not interchangeable.

## Files Created/Modified

- `README.md` — current first-bounded-failure status, future retry boundary, and unchanged public UAT command contract.
- `release/2026.07.15.md` — exact value-blind continuation handle/digest, bounded failure facts, current tests/package evidence, and remaining risk.
- `.planning/phases/02-codex-builder/02-10-SUMMARY.md` — Plan 02-10 outcome, validation, and explicit pending requirements.

## Decisions Made

- Accepted only the user's exact confirmation of the fixed scenario and reason code; no host rerun, validation relaxation, or success inference followed.
- Treated the private continuation record as a bounded handoff record only. It cannot enter the formal candidate/admission lane or certify a real session.
- Completed Plan 02-10 because its specified failure branch was recorded honestly, while leaving Phase 2, BLDR-01, and BLDR-07 open.

## Deviations from Plan

None — the plan explicitly permitted recording the first bounded failed scenario instead of admitting a complete artifact. The failed host precondition is an expected bounded outcome branch, not a success substitution.

## Issues Encountered

- User-host activation apply failed before normal trust or authentication with `AGENTMO_BUILDER_INSTALL_HOST_MUTATION_FAILED`. Per the checkpoint contract, execution stopped at the first bounded failure and did not retry.
- The first post-record full-suite run had one transient timeout-cleanup test failure. The isolated test and final full suite passed without source changes, so no unrelated runtime edit was made.

## Authentication Gates

Authentication was never reached. The earlier host-activation precondition failed first, so no credential action, trust approval, or authenticated Codex session was claimed.

## Task Commits

None — project instructions prohibit committing until the user explicitly asks. No files were staged, committed, or pushed.

## User Setup Required

None to preserve this bounded record. A future formal UAT retry requires a separately approved diagnosis/remediation of the host-activation failure and a new isolated normal-trust authenticated session.

## Remaining Gaps and Next Readiness

- Phase 2 is not complete even though Plan 02-10's bounded-failure record is complete.
- BLDR-01 and BLDR-07 remain pending.
- The first blocker for any future host UAT is `precondition:user-host-activation / AGENTMO_BUILDER_INSTALL_HOST_MUTATION_FAILED`.
- No normal-trust delivery, authenticated session, formal scenario run, candidate, or exact admission exists yet.
- Agent Package quality, domain quality, production readiness, deployment approval, and wider Codex compatibility remain uncertified.

---
*Phase: 02-codex-builder*
*Completed: 2026-07-19*

## Self-Check

PASS — all three plan artifacts exist; the exact continuation digest, bounded outcome identity, automated verification, package evidence, false certification boundaries, no-commit constraint, and pending requirements are recorded without private host paths or raw runtime material.
